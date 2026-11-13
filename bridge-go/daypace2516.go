package main

// FinCom Bridge 2.5.16 (the 2.5.17 plan, item 1, folded into 2.5.16 by the owner on 13-Nov-2026): the older days are
// read in the day while people work, in two tiers by what each request is measured to take for each company:
//   - small: a form whose last answers for the company took 0.3 s or less (the slower of the last answer and a short
//     moving average) goes 5 s after the last key or click in Tally (DayPullSmallIdleSec) and 5 s after the last save
//     in Tally for the company;
//   - heavy: a form over 0.3 s, never measured, a by-type day list, a group of entries (FinComVoucherBatch), a range of
//     days and the payroll's requests go only after DayPullIdleSec (60 s) as before.
// The smallest forms go first: the day's list, then the entries one by one in the small tier; a group of entries only
// once Tally has been left alone for the heavy wait. A window held 1 s or more moves that form to the heavy tier for the
// company until it is measured small again. Nothing new is asked of Tally: the same requests, one in flight, each under
// its 2 s stop (3 s a payroll entry), postings and saves first, the six conditions before every request.
//
// The measurements are kept in sync\day-pace.json and start again when the bridge version changes. The beat says when a
// key or click was last seen in Tally (lastKeySec: seconds since, on the bridge's own clock), so FinCom can tell typing
// from a stuck bridge.

import (
	"strings"
	"sync"
	"time"
)

const paceSmallMs = 300 // the small tier's line (ms)

// the forms the day pull measures, per company
const (
	paceHeads   = "heads"   // FinComDayHeads, one day
	paceSplit   = "split"   // FinComDayHeads, one day and one voucher type (always heavy)
	paceRange   = "range"   // FinComDayHeads, a range of days (range2512.go)
	paceObject  = "object"  // FinComVoucherObject, one entry
	paceBatch   = "batch"   // FinComVoucherBatch (always heavy)
	pacePayroll = "payroll" // the payroll's employees and entries (always heavy)
	paceRetry   = "retry"   // any request of a day tried again after Tally was slow for it (daystop2516.go; always heavy)
)

func pullSmallIdleSec() int { return maxI(1, minI(keepNum("DayPullSmallIdleSec", 5), 60)) }

type paceForm struct {
	Last, Avg, N int // ms; N answers seen
}

var pace = struct {
	mu     sync.Mutex
	dir    string
	m      map[string]*paceForm
	saveAt time.Time
	dirty  bool
}{}

func paceFile() string { return sp("day-pace.json") }

// per company GUID (a restored or test copy of the same name is another company), and form
func paceKey(company, guid, f string) string {
	return companyKey(company) + "|" + strings.ToLower(strings.TrimSpace(guid)) + "|" + f
}

// under pace.mu: this sync folder's measurements, loaded once; another version's are dropped
func paceFreshLocked() {
	d := syncDir()
	if pace.dir == d && pace.m != nil {
		return
	}
	pace.dir, pace.m = d, map[string]*paceForm{}
	o := readObjFile(paceFile())
	if o == nil || str(o["version"]) != BridgeVersion {
		return
	}
	for k, v := range obj(o["forms"]) {
		e := obj(v)
		if e == nil || toInt(e["n"]) <= 0 {
			continue
		}
		pace.m[k] = &paceForm{Last: toInt(e["last"]), Avg: toInt(e["avg"]), N: toInt(e["n"])}
	}
}

// the tests: a restart as far as this is concerned
func paceReset() {
	pace.mu.Lock()
	pace.dir, pace.m, pace.saveAt, pace.dirty = "", nil, time.Time{}, false
	pace.mu.Unlock()
	keyAt.mu.Lock()
	keyAt.t = time.Time{}
	keyAt.mu.Unlock()
}

// one request of the day pull answered (ok) or stopped (not ok), with Tally's window held holdMs while it was at Tally
func paceNote(company, guid, f string, ms, holdMs int, ok bool) {
	if company == "" {
		return
	}
	if !ok && ms < 2000 {
		ms = 2000
	}
	if holdMs >= 1000 && holdMs > ms {
		ms = holdMs // a window held 1 s or more: the form is heavy for the company
	}
	pace.mu.Lock()
	paceFreshLocked()
	k := paceKey(company, guid, f)
	p := pace.m[k]
	if p == nil {
		p = &paceForm{Avg: ms}
		pace.m[k] = p
	}
	p.Last = ms
	if p.N > 0 {
		p.Avg = (p.Avg*3 + ms) / 4
	}
	p.N++
	pace.dirty = true
	var text string
	if time.Since(pace.saveAt) >= 30*time.Second {
		text = paceTextLocked()
	}
	pace.mu.Unlock()
	if text != "" {
		_ = saveFile(paceFile(), text)
	}
}

func paceTextLocked() string {
	forms := M{}
	for k, p := range pace.m {
		forms[k] = M{"last": p.Last, "avg": p.Avg, "n": p.N}
	}
	pace.saveAt, pace.dirty = time.Now(), false
	return jsonText(M{"version": BridgeVersion, "forms": forms})
}

// the prediction (ms) for the company's form: the slower of the last answer and the moving average; known false when
// never measured
func pacePredict(company, guid, f string) (int, bool) {
	pace.mu.Lock()
	defer pace.mu.Unlock()
	paceFreshLocked()
	p := pace.m[paceKey(company, guid, f)]
	if p == nil || p.N == 0 {
		return 0, false
	}
	return maxI(p.Last, p.Avg), true
}

// the small tier: measured, and predicted 0.3 s or less (a by-type list, a group, a range and the payroll never)
func paceSmall(company, guid, f string) bool {
	switch f {
	case paceHeads, paceObject:
	default:
		return false
	}
	ms, known := pacePredict(company, guid, f)
	return known && ms <= paceSmallMs
}

// how long Tally must have been left alone before the form goes (seconds)
func paceNeedSec(company, guid, f string) int {
	if paceSmall(company, guid, f) {
		return minI(pullSmallIdleSec(), pullIdleSec())
	}
	return pullIdleSec()
}

// the next form the day's work sends
func pullNextForm(w *pullWork) string {
	if w == nil || !w.headsDone {
		if w != nil && w.split {
			return paceSplit
		}
		return paceHeads
	}
	if len(w.want) == 0 {
		return paceHeads
	}
	for _, m := range w.want {
		if !payrollEntry(w.it.Company, w.heads[m].Type) {
			return paceObject // the day's other entries go first (pullFetchStep)
		}
	}
	return pacePayroll
}

// the form the item's work sends next (the day being read, else a day not begun: its list)
func pullFormOf(it pullItem) string {
	pull.mu.Lock()
	w := pull.work
	pull.mu.Unlock()
	if pullRetryOnce(it) {
		return paceRetry
	}
	if w != nil && w.it.key() == it.key() {
		return pullNextForm(w)
	}
	return paceHeads
}

// the seconds since the person last used Tally or saved in it for the company (the smaller); 99999 when neither is seen
func pullQuietSec(it pullItem) float64 {
	q := 99999.0
	if _, last := recorderHolding(it.Company, it.CGUID); last != "" {
		if t, err := time.ParseInLocation("2006-01-02T15:04:05", last, time.Local); err == nil {
			q = time.Since(t).Seconds()
			if q < 0 {
				q = 0
			}
		}
	}
	keyNote()
	if pullFrontFn() {
		if idle := pullIdleFn(); idle < q {
			q = idle
		}
	}
	return q
}

// the form may go now: Tally left alone for its tier's wait
func pullTierOK(it pullItem, f string) bool {
	return pullQuietSec(it) >= float64(paceNeedSec(it.Company, it.CGUID, f))
}

var pullFrontFn = platFrontIsTally // Tally is the window in front (the tests replace it)

// --- the last key or click seen in Tally (the beat's lastKeyAt)
var keyAt = struct {
	mu sync.Mutex
	t  time.Time
}{}

// looked at whenever the pull looks at the person, and at every beat: Tally in front and the computer used: that moment
func keyNote() {
	idle := pullIdleFn()
	if idle < 0 || idle >= 99999 || !pullFrontFn() {
		return
	}
	t := time.Now().Add(-time.Duration(idle * float64(time.Second))) // (the monotonic clock: the beat says seconds since)
	keyAt.mu.Lock()
	if t.After(keyAt.t) {
		keyAt.t = t
	}
	keyAt.mu.Unlock()
}

// the whole seconds since the last key or click seen in Tally in this run, on this computer's own running clock (never
// a time of day: FinCom works out the moment on its own clock, so a computer whose clock is wrong never misleads it);
// nil when none was seen
func lastKeyBeat() any {
	keyNote()
	keyAt.mu.Lock()
	defer keyAt.mu.Unlock()
	if keyAt.t.IsZero() {
		return nil
	}
	return int(time.Since(keyAt.t) / time.Second)
}

// 2.5.16 (the code review's M1): the day pull's yield, looked at after the wait for Tally's lock and after the rest,
// right before each send: a posting or a save waiting to go, or typing within the form's tier since the six conditions
// were looked at: nothing is sent (the day waits for the next look)
func pullYield(it pullItem, f string) func() bool {
	return func() bool {
		return postingGoing() || importsInFlight.Load() > 0 || liveQueueReady() || !pullTierOK(it, f)
	}
}
