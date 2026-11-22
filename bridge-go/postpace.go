package main

// The speed round of the linked-GUID rule (19-Nov-2026, the owner's condition: posting never slower than before). A
// posting's parts are no longer planned once at fixed sizes (PostBatchBills 10, PostBatchBank 50): each part is sized
// by how long Tally took for the part before, aiming at PostTargetMs (1350 ms: under the 2-second rule for a request
// with room to spare). It never more than doubles from one part to the next, never goes over 500 (maxBatch), and halves
// after a part Tally did not answer. Masters still go one each. Since the bridge audit (22-Nov-2026) the first part is
// no longer PostBatchBills / PostBatchBank (the most a part holds, when set): it comes from the company's own measured
// time a voucher (post-pace.json, below).
// PostPaceOff true: the fixed sizes as before. Nothing about what is sent changes: the same entries, in the same order,
// each request still Tally's own import with its reply rule (sendImport).

import (
	"errors"
	"math"
	"strings"
	"sync"
	"time"
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
	key                  string       // speed audit: the company's pace key ("" : none kept)
	sent                 map[bool]int // bank? -> the last part's size sent in this job (0: none yet)
}

// speed audit (22-Nov-2026, the owner's approval): single imports of 9 and 42 bills took 14.5 s and 12.1 s at Tally,
// freezing it for the person. Each part is now sized by the company's own measured time a voucher and a KB of XML
// (bills and bank lines apart; the larger estimate decides), kept in sync\post-pace.json across bridge versions: the
// part aims at PostTargetMs (1350 ms); a company whose time is not known starts with 2 vouchers at most; a job's first
// part is at most PostBatchBills (10) / PostBatchBank (50) and the company's last whole part; no part is predicted over
// 2 s, except a single voucher that alone takes longer; every answered part's time is learned (a timeout is not: the
// next part is half). It grows at most doubled a part; PostBatchBills / PostBatchBank, when set, are the most a part
// holds. PostPaceOff true: the fixed sizes as before.
const (
	paceStartMax = 2    // vouchers in a part while the company's time is not known
	paceHardMs   = 2000 // the owner's rule: each request 2 s at most
)

func newPostQueue(masters, vouchers []M) *postQueue {
	return newPostQueueFor("", "", masters, vouchers)
}

func newPostQueueFor(company, guid string, masters, vouchers []M) *postQueue {
	q := &postQueue{masters: masters, size: map[bool]int{false: postBatchBills(), true: postBatchBank()}, fixed: cfgB("PostPaceOff"), sent: map[bool]int{}}
	if company != "" {
		q.key = companyKey(company) + "|" + strings.ToLower(strings.TrimSpace(guid))
	}
	for _, v := range vouchers {
		if isBankItem(v) {
			q.bank = append(q.bank, v)
		} else {
			q.bills = append(q.bills, v)
		}
	}
	if !q.fixed {
		q.size[false], q.size[true] = q.paceSize(false), q.paceSize(true)
	}
	return q
}

// the most a part holds: PostBatchBills / PostBatchBank when set, else maxBatch
func paceCap(bank bool) int {
	k, f := "PostBatchBills", postBatchBills
	if bank {
		k, f = "PostBatchBank", postBatchBank
	}
	if cfg(k) != nil {
		return f()
	}
	return maxBatch
}

// review of the speed audit: the most a job's FIRST part holds: PostBatchBills (10) / PostBatchBank (50), and no more
// than the company's last part in good time (the previous job's), so a new job never starts bigger than the last went
func paceFirstCap(bank bool, rec postPaceRec) int {
	c := postBatchBills()
	if bank {
		c = postBatchBank()
	}
	if rec.Part > 0 {
		c = minI(c, rec.Part)
	}
	return c
}

// a voucher's size in KB (its XML), for the time a KB
func paceKB(it M) float64 { return float64(maxI(len(str(it["xml"])), 1)) / 1024 }

// the next part's size from the company's times (ms a voucher and ms a KB of XML, bills and bank lines apart): unknown,
// 2 at most; else as many as the target holds by the LARGER of the two estimates (heavy bills after light ones are
// sized by their size, not their count), at most doubled from the part before in this job, the first part of a job
// under paceFirstCap; never predicted over 2 s (one voucher when it alone takes longer)
func (q *postQueue) paceSize(bank bool) int {
	c := paceCap(bank)
	rec := postPaceGet(q.key, bank)
	if q.sent[bank] == 0 {
		c = minI(c, paceFirstCap(bank, rec))
	}
	per, perK := rec.perVch(), rec.perKB()
	if per <= 0 {
		return clampBatch(minI(paceStartMax, c))
	}
	target := postTargetSec() * 1000 // 1350 ms by default, 1800 at most: under the 2 s rule
	items := q.bills
	if bank {
		items = q.bank
	}
	n := 0
	if len(items) == 0 {
		n = int(math.Floor(target / per))
	} else {
		kb := 0.0
		for i := 0; i < len(items) && i < c; i++ {
			kb += paceKB(items[i])
			if math.Max(float64(i+1)*per, kb*perK) > target {
				break
			}
			n = i + 1
		}
	}
	if prev := q.sent[bank]; prev > 0 && n > 2*prev {
		n = 2 * prev
	}
	return clampBatch(minI(maxI(n, 1), c))
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
		return importReq{kind: "voucher", report: "Vouchers", items: q.bills[:minI(q.size[false], len(q.bills))]}
	default:
		return importReq{kind: "voucher", report: "Vouchers", bank: true, items: q.bank[:minI(q.size[true], len(q.bank))]}
	}
}

// a part went (or was answered for, or refused): taken off, its time learned for the company and the next size worked
// out from it. Not reached at all (err and not tallyNoAnswer): nothing taken off, the same part goes again
func (q *postQueue) done(r importReq, secs float64, err error) {
	var pin *pinRefusedError
	if err != nil && !tallyNoAnswer(err) && !errors.As(err, &pin) {
		return
	}
	n := len(r.items)
	left := 0 // what is left after this part (0: it was the last, maybe cut short by the queue's end)
	switch {
	case r.kind == "master":
		q.masters = q.masters[n:]
		return
	case r.bank:
		q.bank = q.bank[n:]
		left = len(q.bank)
	default:
		q.bills = q.bills[n:]
		left = len(q.bills)
	}
	if q.fixed {
		return
	}
	planned := q.size[r.bank]
	q.sent[r.bank] = n
	if errors.As(err, &pin) {
		q.size[r.bank] = q.paceSize(r.bank)
		return
	}
	if err != nil {
		// review: a part Tally did not answer in time teaches nothing of its time (its seconds are the wait, not Tally's):
		// never folded in; the next part is half of it, and the company's last part in good time no bigger
		q.size[r.bank] = clampBatch(minI(q.paceSize(r.bank), maxI(1, n/2)))
		postPaceNote(q.key, r.bank, 0, 0, q.size[r.bank])
		return
	}
	if n > 0 && secs > 0 {
		kb := 0.0
		for _, it := range r.items {
			kb += paceKB(it)
		}
		part := 0
		if n >= planned && left > 0 {
			part = n // a whole part (not the last one, cut short by the queue's end): the size the next job may start at
		}
		postPaceNote(q.key, r.bank, secs*1000/float64(n), secs*1000/kb, part)
	}
	q.size[r.bank] = q.paceSize(r.bank)
}

// --- the companies' times (sync\post-pace.json), as day-pace.json keeps the day pull's. Review: kept across bridge
// versions (an update is never slower than before); started again only when the file's format changes
const postPaceFormat = 2

type postPaceRec struct {
	Last, Avg   float64 // ms a voucher
	N           int
	KLast, KAvg float64 // ms a KB of the vouchers' XML
	KN          int
	Part        int // the company's last whole part in good time (0: none)
}

// the time to plan by: the larger of the last part's and the running average (a Tally slower now is believed at once)
func (p postPaceRec) perVch() float64 {
	if p.N <= 0 {
		return 0
	}
	return math.Max(p.Last, p.Avg)
}
func (p postPaceRec) perKB() float64 {
	if p.KN <= 0 {
		return 0
	}
	return math.Max(p.KLast, p.KAvg)
}

var postPace = struct {
	mu     sync.Mutex
	dir    string
	m      map[string]*postPaceRec
	saveAt time.Time
	dirty  bool
	mem    map[string]*postPaceRec // a queue with no company (no key): this run only
}{}

func postPaceFile() string { return sp("post-pace.json") }

func postPaceKey(key string, bank bool) string {
	if bank {
		return key + "|bank"
	}
	return key + "|bills"
}

func postPaceFreshLocked() {
	d := syncDir()
	if postPace.dir == d && postPace.m != nil {
		return
	}
	postPace.dir, postPace.m = d, map[string]*postPaceRec{}
	o := readObjFile(postPaceFile())
	if o == nil || toInt(o["format"]) != postPaceFormat {
		return
	}
	for k, v := range obj(o["companies"]) {
		e := obj(v)
		if e == nil {
			continue
		}
		r := &postPaceRec{Last: num(e["last"]), Avg: num(e["avg"]), N: toInt(e["n"]), KLast: num(e["klast"]), KAvg: num(e["kavg"]), KN: toInt(e["kn"]), Part: toInt(e["part"])}
		if r.N <= 0 || r.Avg <= 0 {
			r.N, r.Last, r.Avg = 0, 0, 0
		}
		if r.KN <= 0 || r.KAvg <= 0 {
			r.KN, r.KLast, r.KAvg = 0, 0, 0
		}
		if r.N > 0 || r.Part > 0 {
			postPace.m[k] = r
		}
	}
}

func postPaceMapLocked(key string) map[string]*postPaceRec {
	if key != "" {
		postPaceFreshLocked()
		return postPace.m
	}
	if postPace.mem == nil {
		postPace.mem = map[string]*postPaceRec{}
	}
	return postPace.mem
}

// the company's record (a copy; empty when none)
func postPaceGet(key string, bank bool) postPaceRec {
	postPace.mu.Lock()
	defer postPace.mu.Unlock()
	if p := postPaceMapLocked(key)[postPaceKey(key, bank)]; p != nil {
		return *p
	}
	return postPaceRec{}
}

// the time a voucher to plan by (ms); 0 when not known
func postPaceMs(key string, bank bool) float64 { return postPaceGet(key, bank).perVch() }

// a part's times learned (ms a voucher, ms a KB; 0: not learned) and the company's last whole part (0: unchanged)
func postPaceNote(key string, bank bool, ms, msKB float64, part int) {
	if ms <= 0 && msKB <= 0 && part <= 0 {
		return
	}
	postPace.mu.Lock()
	m := postPaceMapLocked(key)
	k := postPaceKey(key, bank)
	p := m[k]
	if p == nil {
		p = &postPaceRec{}
		m[k] = p
	}
	if ms > 0 {
		p.Last = ms
		if p.N > 0 {
			p.Avg = (p.Avg*3 + ms) / 4
		} else {
			p.Avg = ms
		}
		p.N++
	}
	if msKB > 0 {
		p.KLast = msKB
		if p.KN > 0 {
			p.KAvg = (p.KAvg*3 + msKB) / 4
		} else {
			p.KAvg = msKB
		}
		p.KN++
	}
	if part > 0 {
		p.Part = part
	}
	var text string
	if key != "" {
		postPace.dirty = true
		if time.Since(postPace.saveAt) >= 30*time.Second {
			text = postPaceTextLocked()
		}
	}
	postPace.mu.Unlock()
	if text != "" {
		_ = saveFile(postPaceFile(), text)
	}
}

func postPaceTextLocked() string {
	cos := M{}
	for k, p := range postPace.m {
		cos[k] = M{"last": round3(p.Last), "avg": round3(p.Avg), "n": p.N, "klast": round3(p.KLast), "kavg": round3(p.KAvg), "kn": p.KN, "part": p.Part}
	}
	postPace.saveAt, postPace.dirty = time.Now(), false
	return jsonText(M{"format": postPaceFormat, "version": BridgeVersion, "companies": cos})
}

// written now when anything is not on the disk yet (the end of a posting)
func postPaceFlush() {
	postPace.mu.Lock()
	var text string
	if postPace.dirty && postPace.m != nil {
		text = postPaceTextLocked()
	}
	postPace.mu.Unlock()
	if text != "" {
		_ = saveFile(postPaceFile(), text)
	}
}

// the tests: a restart as far as this is concerned
func postPaceReset() {
	postPace.mu.Lock()
	postPace.dir, postPace.m, postPace.saveAt, postPace.dirty, postPace.mem = "", nil, time.Time{}, false, nil
	postPace.mu.Unlock()
}

// audit fix: entries taken off the queue without being sent (refused on the record under postGate)
func (q *postQueue) drop(items []M) {
	gone := map[string]bool{}
	for _, it := range items {
		gone[str(it["id"])] = true
	}
	keep := func(l []M) []M {
		var o []M
		for _, it := range l {
			if !gone[str(it["id"])] {
				o = append(o, it)
			}
		}
		return o
	}
	q.masters, q.bills, q.bank = keep(q.masters), keep(q.bills), keep(q.bank)
}
