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
// freezing it for the person. Each part is now sized by the company's own measured time a voucher (bills and bank lines
// apart), kept in sync\post-pace.json as day-pace.json is: the part aims at PostTargetMs (1350 ms); a company whose
// time is not known starts with 2 vouchers at most; no part is predicted over 2 s, except a single voucher that alone
// takes longer; every part's time is learned. It grows at most doubled a part; PostBatchBills / PostBatchBank, when set,
// are the most a part holds. PostPaceOff true: the fixed sizes as before.
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

// the next part's size from the company's time a voucher (ms): unknown, 2 at most; else the target over it, at most
// doubled from the part before in this job, never predicted over 2 s (one voucher when it alone takes longer)
func (q *postQueue) paceSize(bank bool) int {
	c := paceCap(bank)
	per := postPaceMs(q.key, bank)
	if per <= 0 {
		return clampBatch(minI(paceStartMax, c))
	}
	target := postTargetSec() * 1000
	n := int(math.Floor(target / per))
	if hard := int(math.Floor(paceHardMs / per)); n > hard {
		n = hard
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
	switch {
	case r.kind == "master":
		q.masters = q.masters[n:]
		return
	case r.bank:
		q.bank = q.bank[n:]
	default:
		q.bills = q.bills[n:]
	}
	if q.fixed {
		return
	}
	if n > 0 && !errors.As(err, &pin) {
		ms := secs * 1000 / float64(n)
		if err != nil {
			ms = math.Max(ms, paceHardMs/float64(n)) // no answer: at least the 2 s over the part, so the next is smaller
		}
		if err != nil || secs > 0 {
			postPaceNote(q.key, r.bank, ms)
		}
	}
	q.sent[r.bank] = n
	if err != nil && tallyNoAnswer(err) {
		q.size[r.bank] = clampBatch(minI(q.paceSize(r.bank), maxI(1, n/2)))
		return
	}
	q.size[r.bank] = q.paceSize(r.bank)
}

// --- the companies' times a voucher (sync\post-pace.json), as day-pace.json keeps the day pull's
type postPaceRec struct {
	Last, Avg float64 // ms a voucher
	N         int
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
	if o == nil || str(o["version"]) != BridgeVersion {
		return
	}
	for k, v := range obj(o["companies"]) {
		e := obj(v)
		if e == nil || toInt(e["n"]) <= 0 || num(e["avg"]) <= 0 {
			continue
		}
		postPace.m[k] = &postPaceRec{Last: num(e["last"]), Avg: num(e["avg"]), N: toInt(e["n"])}
	}
}

// the time a voucher to plan by (ms): the larger of the last part's and the running average (a Tally slower now is
// believed at once); 0 when not known
func postPaceMs(key string, bank bool) float64 {
	postPace.mu.Lock()
	defer postPace.mu.Unlock()
	var p *postPaceRec
	if key == "" {
		p = postPace.mem[postPaceKey(key, bank)]
	} else {
		postPaceFreshLocked()
		p = postPace.m[postPaceKey(key, bank)]
	}
	if p == nil || p.N <= 0 {
		return 0
	}
	return math.Max(p.Last, p.Avg)
}

func postPaceNote(key string, bank bool, ms float64) {
	if ms <= 0 {
		return
	}
	postPace.mu.Lock()
	m := postPace.mem
	if key != "" {
		postPaceFreshLocked()
		m = postPace.m
	} else if m == nil {
		postPace.mem = map[string]*postPaceRec{}
		m = postPace.mem
	}
	k := postPaceKey(key, bank)
	p := m[k]
	if p == nil {
		p = &postPaceRec{Avg: ms}
		m[k] = p
	}
	p.Last = ms
	if p.N > 0 {
		p.Avg = (p.Avg*3 + ms) / 4
	}
	p.N++
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
		cos[k] = M{"last": round3(p.Last), "avg": round3(p.Avg), "n": p.N}
	}
	postPace.saveAt, postPace.dirty = time.Now(), false
	return jsonText(M{"version": BridgeVersion, "companies": cos})
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
