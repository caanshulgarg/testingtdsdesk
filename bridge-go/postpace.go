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

// fast bank posting (23-Nov-2026): the most one bank request may take on a Tally whose single voucher already takes
// over 2 s (its fixed cost a request): PostSlowMaxMs, 10000 by default, held to 2000..10000 (review B2: a probe of 2
// goes only when twice the last part's time fits under it; the parts themselves stay at PostQuietBankMax, 10)
func postSlowMaxSec() float64 {
	ms := keepNum("PostSlowMaxMs", 10000)
	if ms < paceHardMs {
		ms = paceHardMs
	}
	if ms > 10000 {
		ms = 10000
	}
	return float64(ms) / 1000
}

type postQueue struct {
	masters, bills, bank []M
	size                 map[bool]int // bank? -> the next part's size
	fixed                bool
	key                  string       // speed audit: the company's pace key ("" : none kept)
	sent                 map[bool]int // bank? -> the last part's size sent in this job (0: none yet)
	calm                 map[bool]int // fast bank posting: the bank part while someone is at the computer (0: no cap)
	noFast               bool         // review M: a bank part Tally did not answer: no fixed-cost size for the rest of the job
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
	q := &postQueue{masters: masters, size: map[bool]int{false: postBatchBills(), true: postBatchBank()}, fixed: cfgB("PostPaceOff"), sent: map[bool]int{}, calm: map[bool]int{}}
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
	prev := q.sent[bank]
	if prev > 0 && n > 2*prev {
		n = 2 * prev
	}
	calm := clampBatch(minI(maxI(n, 1), c))
	if !bank {
		return calm
	}
	// fast bank posting: on a Tally whose time is mostly a fixed cost a request, bigger bank parts while nobody is at
	// the computer (next: postQuiet); q.calm keeps the part by the time a voucher, for when someone is
	if one := rec.oneMs(); one > paceHardMs {
		calm = 1 // review: one voucher alone over 2 s: someone active gets one voucher a part, whatever the pace says
	}
	q.calm[bank] = calm
	if q.noFast {
		return clampBatch(minI(maxI(n, 1), c))
	}
	if f := minI(paceFixedSize(rec, prev), postQuietBankMax()); f > n {
		n = f
		if prev > 0 && n > 2*prev {
			n = 2 * prev
		}
	}
	return clampBatch(minI(maxI(n, 1), c))
}

// fast bank posting, the owner's "tally should not freeze at all" (23-Nov-2026): the bigger bank parts go only while
// nobody has pressed a key or moved the mouse for PostQuietSec (30 s by default, 5..600; the tray icon's report, as
// the typing gate's) and the tray is reporting. Otherwise a part is what the time a voucher gives (one voucher on a
// slow Tally: never longer than a single voucher takes) and still goes at once: postings first, nothing waits
func postQuietSec() float64 {
	v := keepNum("PostQuietSec", 30)
	if v < 5 {
		v = 5
	}
	if v > 600 {
		v = 600
	}
	return float64(v)
}

var (
	postIdleFn    = idleSec           // seconds since the last key or click (the tray's report as a service)
	postUnknownFn = platPersonUnknown // the tray does not report for a session the owner works in
	postQuietFn   = postQuiet         // the tests' hook
)

// review: an idle time of 99999 (GetLastInputInfo failed, or no report at all) is unknown, never quiet
func postQuiet() bool {
	if postUnknownFn() {
		return false
	}
	idle := postIdleFn()
	return idle >= postQuietSec() && idle < 99999
}

// the most bank lines a quiet part holds: PostQuietBankMax, 10 by default, never over PostBatchBank
func postQuietBankMax() int { return maxI(1, minI(keepNum("PostQuietBankMax", 10), postBatchBank())) }

// fast bank posting (23-Nov-2026, the owner: "please make bank entries fast"). A part's time at Tally is a fixed cost
// a request (F) and a cost a voucher (m), fitted from the company's recent parts (n, ms) of different sizes. When the
// fixed cost is most of it (F at least 2 m) the bank part is as big as the budget holds: the 1350 ms target, or 2 s
// when one voucher alone is over the target; on a Tally whose single voucher already takes over 2 s (the 2-second rule
// cannot be met at any size) PostSlowMaxMs (10 s), never past what the best measured time a voucher fits in it. A
// positive slope without a fixed cost of twice it: none (kept in the file). A slope of 0 or less (noise, or all of the
// time fixed): unproven, sized by the measured time a voucher alone (doubling at most a part, halved after overruns). 0: no fixed-cost size (the per-voucher pace decides). Only
// one size seen yet: a probe of 2 after a part of one voucher over 2 s, when twice its time is under PostSlowMaxMs.
// The last part over its budget: half of it at most. Nothing about what is sent changes: the same Import, more lines.
func paceFixedSize(rec postPaceRec, prev int) int {
	hs := rec.hist()
	if len(hs) == 0 {
		return 0
	}
	maxMs := postSlowMaxSec() * 1000
	last := hs[len(hs)-1]
	F, m, ok := rec.fit()
	budget := maxMs
	n := 0
	if ok {
		if m > 1e-6 && !fitSound(F, m) {
			return 0 // the time grows with each voucher (no fixed cost to share): bigger parts save nothing (kept, B2)
		}
		budget = postTargetSec() * 1000
		if one := rec.oneMs(); one > paceHardMs {
			budget = maxMs
		} else if one > budget {
			budget = paceHardMs
		}
		n = maxBatch
		if fitSound(F, m) {
			n = int(math.Floor((budget - F) / m))
		} // else a time that did not grow with the size (noise, or all of it fixed): unproven, sized by the measured times
		// review B1: never more than the best measured time a voucher fits in the budget
		b := rec.bestPerVch()
		if b <= 0 {
			return 0
		}
		n = minI(n, int(math.Floor(budget/b)))
	} else {
		// one size seen: a probe of 2 only after a part of one voucher over 2 s, and only when twice its time is under
		// PostSlowMaxMs (review B2)
		if int(last[0]) != 1 || last[1] <= paceHardMs || 2*last[1] > maxMs {
			return 0
		}
		n = 2
	}
	// review B1: a part over its budget (whatever the budget): the next half of it at most
	if last[1] > budget {
		n = minI(n, maxI(1, int(last[0])/2))
	}
	return maxI(n, 0)
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
		k := q.size[true]
		if c := q.calm[true]; c > 0 && c < k && !postQuietFn() {
			k = c // someone at the computer: no bigger part than one by the time a voucher
		}
		return importReq{kind: "voucher", report: "Vouchers", bank: true, items: q.bank[:minI(k, len(q.bank))]}
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
		payroll := n == 1 && isPayrollItem(r.items[0])
		q.bills = q.bills[n:]
		left = len(q.bills)
		if payroll {
			return // a payroll voucher's time says nothing of the bills' pace
		}
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
		if r.bank {
			q.noFast = true // review M: no 10/5/10 loop of no-answers
		}
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
		postPacePart(q.key, r.bank, n, secs*1000)
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
	// fast bank posting: the company's last parts (vouchers, ms; paceHistMax at most) and the last fit of them
	Hist  [paceHistMax][2]float64 // a fixed array (the record stays comparable); HN of it in use, oldest first
	HN    int
	FixMs float64 // ms a request (the fixed cost), from the last fit with two sizes or more
	VchMs float64 // ms a voucher over it
	FitOK bool
}

const paceHistMax = 8

// the recent parts in use, oldest first
func (p postPaceRec) hist() [][2]float64 { return p.Hist[:minI(maxI(p.HN, 0), paceHistMax)] }

// a part added to the recent parts (the oldest dropped past paceHistMax)
func (p *postPaceRec) addHist(n, ms float64) {
	if p.HN >= paceHistMax {
		copy(p.Hist[:], p.Hist[1:])
		p.HN = paceHistMax - 1
	}
	p.Hist[p.HN] = [2]float64{n, ms}
	p.HN++
}

// the fixed cost a request and the cost a voucher, by least squares over the recent parts, as fitted (review B1: never
// clamped; a slope of 0 or less, or no fixed cost, is no fixed-cost Tally: sound() says); with one size only the last
// fit of two sizes or more is kept (ok false when none)
func (p postPaceRec) fit() (F, m float64, ok bool) {
	var sn, st, snn, snt float64
	k := float64(len(p.hist()))
	for _, h := range p.hist() {
		sn, st, snn, snt = sn+h[0], st+h[1], snn+h[0]*h[0], snt+h[0]*h[1]
	}
	if d := k*snn - sn*sn; k >= 2 && d > 1e-9 {
		m = (k*snt - sn*st) / d
		F = st/k - m*sn/k
		return F, m, true
	}
	return p.FixMs, p.VchMs, p.FitOK
}

// a fit that says the time is mostly a fixed cost a request: a positive cost a voucher, and a fixed cost of at least
// twice it
func fitSound(F, m float64) bool { return m > 1e-6 && F > 0 && F >= 2*m }

// review: the best measured ms a voucher over the recent parts (0: none); a part of n at it never under-predicts
// on a Tally with a fixed cost, so no part is sized past what the measured times show
func (p postPaceRec) bestPerVch() float64 {
	b := 0.0
	for _, h := range p.hist() {
		if r := h[1] / h[0]; b == 0 || r < b {
			b = r
		}
	}
	return b
}

// what one voucher alone takes (ms; 0: not known): the sound fit's, else the quickest part of one seen
func (p postPaceRec) oneMs() float64 {
	if F, m, ok := p.fit(); ok && fitSound(F, m) {
		return F + m
	}
	o := 0.0
	for _, h := range p.hist() {
		if h[0] == 1 && (o == 0 || h[1] < o) {
			o = h[1]
		}
	}
	return o
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
		for _, h := range arr(e["hist"]) {
			if a := arr(h); len(a) == 2 && toInt(a[0]) >= 1 && num(a[1]) > 0 {
				r.addHist(float64(toInt(a[0])), num(a[1]))
			}
		}
		if truthy(e["fit"]) {
			r.FixMs, r.VchMs, r.FitOK = num(e["fix"]), num(e["vch"]), true // review B2: a no-fixed-cost fit kept too
		}
		if r.N <= 0 || r.Avg <= 0 {
			r.N, r.Last, r.Avg = 0, 0, 0
		}
		if r.KN <= 0 || r.KAvg <= 0 {
			r.KN, r.KLast, r.KAvg = 0, 0, 0
		}
		if r.N > 0 || r.Part > 0 || r.HN > 0 {
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

// fast bank posting: an answered part (vouchers, ms) kept in the company's recent parts, and the fit refreshed when
// they hold two sizes or more
func postPacePart(key string, bank bool, n int, ms float64) {
	if n < 1 || ms <= 0 {
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
	p.addHist(float64(n), ms)
	if hs := p.hist(); len(hs) >= 2 {
		lo, hi := hs[0][0], hs[0][0]
		for _, h := range hs {
			lo, hi = math.Min(lo, h[0]), math.Max(hi, h[0])
		}
		if hi > lo {
			p.FitOK = false
			p.FixMs, p.VchMs, p.FitOK = p.fit()
		}
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
		e := M{"last": round3(p.Last), "avg": round3(p.Avg), "n": p.N, "klast": round3(p.KLast), "kavg": round3(p.KAvg), "kn": p.KN, "part": p.Part}
		if p.HN > 0 {
			var h []any
			for _, x := range p.hist() {
				h = append(h, []any{int(x[0]), round3(x[1])})
			}
			e["hist"] = h
		}
		if p.FitOK {
			e["fit"], e["fix"], e["vch"] = true, round3(p.FixMs), round3(p.VchMs)
		}
		cos[k] = e
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

// 2.5.19 (E): the vouchers still to send (as the job's items: id, kind, xml)
func (q *postQueue) pending() []M {
	var o []M
	for _, it := range append(append([]M{}, q.bills...), q.bank...) {
		o = append(o, M{"id": str(it["id"]), "kind": "voucher", "xml": str(it["xml"])})
	}
	return o
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
