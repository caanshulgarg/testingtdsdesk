package main

// The speed round of the linked-GUID rule (19-Nov-2026, the owner's condition: posting never slower than before). A
// posting's parts are no longer planned once at fixed sizes (PostBatchBills 10, PostBatchBank 50): each part is sized
// by how long Tally took for the part before, aiming at PostTargetMs (1350 ms: under the 2-second rule for a request
// with room to spare). PostBatchBills / PostBatchBank are where it starts; it never more than doubles from one part to
// the next, never goes over 500 (maxBatch), and halves after a part Tally did not answer. Masters still go one each.
// PostPaceOff true: the fixed sizes as before. Nothing about what is sent changes: the same entries, in the same order,
// each request still Tally's own import with its reply rule (sendImport).

import (
	"errors"
	"math"
)

func postTargetSec() float64 {
	ms := keepNum("PostTargetMs", 1350)
	if ms < 200 {
		ms = 200
	}
	if ms > 1800 {
		ms = 1800 // the 2-second rule
	}
	return float64(ms) / 1000
}

type postQueue struct {
	masters, bills, bank []M
	size                 map[bool]int // bank? -> the next part's size
	fixed                bool
}

func newPostQueue(masters, vouchers []M) *postQueue {
	q := &postQueue{masters: masters, size: map[bool]int{false: postBatchBills(), true: postBatchBank()}, fixed: cfgB("PostPaceOff")}
	for _, v := range vouchers {
		if isBankItem(v) {
			q.bank = append(q.bank, v)
		} else {
			q.bills = append(q.bills, v)
		}
	}
	return q
}

func (q *postQueue) left() bool { return len(q.masters)+len(q.bills)+len(q.bank) > 0 }

// how many parts are left at the sizes known now (for the words and the log)
func (q *postQueue) parts() int {
	c := func(n, k int) int {
		if n == 0 {
			return 0
		}
		return (n + k - 1) / k
	}
	return len(q.masters) + c(len(q.bills), q.size[false]) + c(len(q.bank), q.size[true])
}

// the next part (not taken off until done says it went)
func (q *postQueue) next() importReq {
	switch {
	case len(q.masters) > 0:
		return importReq{kind: "master", report: "All Masters", items: q.masters[:1]}
	case len(q.bills) > 0:
		// 2.5.18: a payroll voucher always goes alone (its own allow-list id holds exactly one voucher); a part of
		// other bills stops before one
		if isPayrollItem(q.bills[0]) {
			return importReq{kind: "voucher", report: "Vouchers", items: q.bills[:1]}
		}
		k := minI(q.size[false], len(q.bills))
		for i := 1; i < k; i++ {
			if isPayrollItem(q.bills[i]) {
				k = i
				break
			}
		}
		return importReq{kind: "voucher", report: "Vouchers", items: q.bills[:k]}
	default:
		return importReq{kind: "voucher", report: "Vouchers", bank: true, items: q.bank[:minI(q.size[true], len(q.bank))]}
	}
}

// a part went (or was answered for, or refused): taken off, and the next size worked out from how long it took.
// Not reached at all (err and not tallyNoAnswer): nothing taken off, the same part goes again
func (q *postQueue) done(r importReq, secs float64, err error) {
	var pin *pinRefusedError
	if err != nil && !tallyNoAnswer(err) && !errors.As(err, &pin) {
		return
	}
	n := len(r.items)
	switch {
	case r.kind == "master":
		q.masters = q.masters[n:]
		return
	case r.bank:
		q.bank = q.bank[n:]
	default:
		payroll := n == 1 && isPayrollItem(r.items[0])
		q.bills = q.bills[n:]
		if payroll {
			return // a payroll voucher's time says nothing of the bills' pace
		}
	}
	if q.fixed {
		return
	}
	cur := q.size[r.bank]
	switch {
	case err != nil && tallyNoAnswer(err):
		cur = cur / 2
	case err == nil && n >= cur && secs > 0.02:
		// a full part: sized to the target by its time, at most doubled
		want := int(math.Floor(float64(n) * postTargetSec() / secs))
		if want > 2*cur {
			want = 2 * cur
		}
		cur = want
	case err == nil && secs > postTargetSec() && n > 0:
		cur = int(float64(n) * postTargetSec() / secs) // a short part (the last) that was slow: smaller still
	}
	q.size[r.bank] = clampBatch(cur)
}
