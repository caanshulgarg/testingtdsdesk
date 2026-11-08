// next-fast-entries (PROTOTYPE, not released; the owner's "Yes, design it"; docs/fast-entries-design.md): the
// older-entries fetch (daypull.go) reads several of the days FinCom listed in one go, behind the setting FastEntries,
// OFF by default. With it off nothing here runs and no request below can reach Tally (the dated guard refuses both ids).
//
//  1. W1, FinComWindowHeads: the entry heads (GUID, MASTERID, ALTERID, DATE: FinComDayHeads' own fields and date form,
//     yyyymmdd TYPE="Date") of a WINDOW of consecutive listed days of one company (SVFROMDATE < SVTODATE, 31 days at
//     most), instead of one FinComDayHeads per day. Every row must be dated inside the window; the rows are split by
//     day and each day is told to FinCom exactly as today (period_heads, the same body), so FinCom answers what it lacks.
//  2. W2, FinComVoucherWindow: the wanted entries of the window, a group at a time, by a MasterID run a..b inside the
//     dates the group spans (FinComVoucherBatch's FETCH, frozen by its SHA, and the same converter and strip:
//     batchEntry), so each entry is kept exactly as FinComVoucherObject's answer would be. A group is only built when
//     every head of the window inside a..b and those dates is wanted (the answer must then be exactly the group).
//  3. Adaptive sizes: the window starts at FastEntriesWindowDays (7) and the group at FastEntriesBatchStart (10); a
//     request answered well under 2 s grows the next one (x2, up to 31 days and 100 entries), a slow one (over 1 s for a
//     window, over 1.2 s for a group) shrinks the next at once; a group stopped at 2 s is halved once, then the rest is
//     read one by one. The sizes are kept per company and choice (fast-entries.json), so a restart does not start over.
//  4. Fallbacks: any error, a reply that cannot be read, a row of another date, a group not answered exactly, an entry
//     a group gives otherwise than FinComVoucherObject: the fast read stops for that window and today's path reads what
//     is left (the window's days one by one where a group failed). Tally's window held 2 s, or Tally not finished with a
//     stopped request: the company's period stops, exactly as today (pullStopCompany).
//
// What the bridge sends FinCom is unchanged: the same period_heads per day, the same period_entries per day (pullFlush),
// the same entries. Every rule of the period fetch stays: one request in flight, the six conditions before each request
// (pullMayAsk), postings first, idle only, the 2 s stop, only approved fields kept. No AI.
package main

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	fastHeadsID     = "FinComWindowHeads"
	fastBatchID     = "FinComVoucherWindow"
	fastBatchFilter = "$MasterID >= %d AND $MasterID <= %d"
	fastMaxDays     = 31
)

// the switch (off unless set to true by hand) and the sizes
func fastOn() bool { return cfgB("FastEntries") }

func clampI(v, lo, hi int) int { return maxI(lo, minI(v, hi)) }

func fastWinMax() int {
	return clampI(keepNum("FastEntriesWindowMaxDays", fastMaxDays), 2, fastMaxDays)
}
func fastWinStart() int   { return clampI(keepNum("FastEntriesWindowDays", 7), 2, fastWinMax()) }
func fastBatchMax() int   { return clampI(keepNum("FastEntriesBatchMax", batchMaxN), 2, batchMaxN) }
func fastBatchStart() int { return clampI(keepNum("FastEntriesBatchStart", 10), 2, fastBatchMax()) }

// a window's answer above this many rows: the next window is halved (a big window is a long walk for Tally)
func fastRowsCap() int { return clampI(keepNum("FastEntriesWindowRows", 3000), 100, 30000) }

// the pace: grow below, shrink above (ms of the request at Tally)
const (
	fastHeadsGrowMs   = 500
	fastHeadsShrinkMs = 1000
	fastBatchGrowMs   = 600
	fastBatchShrinkMs = 1200
	fastReadyTTL      = 5 * time.Minute
)

// --- the two requests
func fastWindowOK(from, to string) bool {
	if !isTallyDate(from) || !isTallyDate(to) || to < from || tallyDate(fromTallyDate(from)) != from || tallyDate(fromTallyDate(to)) != to {
		return false
	}
	return addDays(from, fastMaxDays-1) >= to
}

// W1: the heads of the days from..to (two days at least; one day is FinComDayHeads, unchanged); "" for anything else
func fastHeadsRequest(company, from, to string) string {
	if !fastWindowOK(from, to) || from == to {
		return ""
	}
	return formCollection(fastHeadsID, company, formPlainT, from, to, dayHeadsFetch, "")
}

// W2: the entries dated from..to with a MasterID in a..b; "" for anything else
func fastBatchRequest(company, from, to string, a, b int64) string {
	if !fastWindowOK(from, to) || a <= 0 || b < a || !batchFetchOK() {
		return ""
	}
	return formCollection(fastBatchID, company, formPlainT, from, to, batchFetchText, fmt.Sprintf(fastBatchFilter, a, b))
}

var reFastRange = regexp.MustCompile(`<SYSTEM TYPE="Formulae" NAME="` + fastBatchID + `Only">\$MasterID &gt;= (\d+) AND \$MasterID &lt;= (\d+)</SYSTEM>`)

func fastHeadsRebuild(x string) string {
	a, z := pinDates(x)
	return fastHeadsRequest(pinCo(x), a, z)
}

func fastBatchRebuild(x string) string {
	a, z := pinDates(x)
	m := reFastRange.FindStringSubmatch(x)
	if m == nil {
		return ""
	}
	return fastBatchRequest(pinCo(x), a, z, toI64(m[1]), toI64(m[2]))
}

var errFastRefused = errors.New("FinCom Bridge asks Tally for a window of older entries only with FastEntries switched on, as built, for the window being read now, under the 2-second stop; nothing was sent to Tally")

// the dated guard's exception for the two ids (tally.go datedRefused): the switch on, the period fetch's own background
// request under the 2 s stop, exactly as built, a company with a starting point, and the request being asked now
func fastExact(tc *TC, x string) bool { return fastExactWith(tc, x, fastOn()) }

// next-fast-measure: the same rules with the switch given (the measurement runs with FastEntries off)
func fastExactWith(tc *TC, x string, on bool) bool {
	id := tallyRequestID(x)
	if !on || (id != fastHeadsID && id != fastBatchID) || tc == nil || !tc.copier || tc.person || !tc.bg || tc.limitMs <= 0 || tc.limitMs > 2000 {
		return false
	}
	rb := fastHeadsRebuild
	if id == fastBatchID {
		rb = fastBatchRebuild
	}
	if x != rb(x) {
		return false
	}
	if _, ok := startPointOf(pinCo(x)); !ok {
		return false
	}
	fast.mu.Lock()
	defer fast.mu.Unlock()
	return fast.ask != "" && x == fast.ask
}

// --- the state
type fastEng struct {
	choice    string              // company|guid|chosenAt|fetch
	items     map[string]pullItem // the window's days as FinCom listed them
	days      []string            // ascending
	heads     map[string]pullHead // the window's heads by MasterID
	headsDone bool
	headsAt   time.Time
	tell      int             // the next day to tell FinCom
	told      map[string]bool // days FinCom took the heads of
	want      []string        // MasterIDs FinCom lacks, by MasterID
	got       map[string]string
	one       map[string]bool // days to read one by one (a group of theirs failed)
	pw        *pullWork       // the company list's bookkeeping (pullCoListed)
}

// a day read by the window, waiting for its per-day work (daypull.go) to take it
type fastDay struct {
	heads    map[string]pullHead
	want     []string
	got      []string
	single   []string // left by a group for FinComVoucherObject (not grouped again on the day's turn)
	oneByOne bool
	headsAt  time.Time
	at       time.Time
}

type fastSize struct {
	Win   int    `json:"win"`
	Batch int    `json:"batch"` // 1: one by one for this choice
	Off   string `json:"off,omitempty"`
	// review of 0de692f49 (3): the window or group size that took Tally over 2 s in this read (this choice): never asked
	// at that size or above again (the read stopped then, as the per-day path stops it)
	WinCap   int `json:"winCap,omitempty"`
	BatchCap int `json:"batchCap,omitempty"`
}

type rateMark struct {
	at time.Time
	n  int
}

var fast = struct {
	mu      sync.Mutex
	ask     string
	eng     *fastEng
	ready   map[string]*fastDay // pullItem.key()
	sizes   map[string]fastSize // company|guid|chosenAt
	offPort map[int]string      // a Tally that answered a window with a row of another date: not asked a window until restart
	rate    map[string][]rateMark
	rateCo  map[string][2]string // company key -> {the company's name as listed, its GUID}
	fails   map[string]int       // review (4): failed window reads of a day (fastDayKey); 2: the day is read as before
	reqs    atomic.Int64         // requests of the two ids sent (the tests, the beat)
}{ready: map[string]*fastDay{}, sizes: map[string]fastSize{}, offPort: map[int]string{}, rate: map[string][]rateMark{}, rateCo: map[string][2]string{}, fails: map[string]int{}}

// review (8): a day read by a window, by its key and its phase (counting or fetching), as the per-day work keys it
func fastDayKey(it pullItem) string { return it.key() + "|" + fmt.Sprint(it.Fetch) }

const fastFailMax = 2

func fastReset() {
	fast.mu.Lock()
	fast.ask, fast.eng = "", nil
	fast.ready, fast.sizes, fast.offPort, fast.rate = map[string]*fastDay{}, map[string]fastSize{}, map[int]string{}, map[string][]rateMark{}
	fast.rateCo, fast.fails = map[string][2]string{}, map[string]int{}
	fast.mu.Unlock()
	fast.reqs.Store(0)
}

func fastChoiceKey(it pullItem) string {
	return companyKey(it.Company) + "|" + strings.ToLower(it.CGUID) + "|" + it.ChosenAt
}
func fastEngKey(it pullItem) string { return fastChoiceKey(it) + "|" + fmt.Sprint(it.Fetch) }

func fastSizeOf(it pullItem) fastSize {
	fast.mu.Lock()
	defer fast.mu.Unlock()
	s := fast.sizes[fastChoiceKey(it)]
	if s.Win == 0 {
		s.Win = fastWinStart()
	}
	if s.Batch == 0 {
		s.Batch = fastBatchStart()
	}
	s.Win, s.Batch = clampI(s.Win, 2, fastWinMax()), clampI(s.Batch, 1, fastBatchMax())
	if s.WinCap > 0 {
		s.Win = minI(s.Win, maxI(2, s.WinCap/2))
	}
	if s.BatchCap > 0 {
		s.Batch = minI(s.Batch, maxI(1, s.BatchCap/2))
	}
	return s
}

func fastSizeSet(it pullItem, f func(s *fastSize)) {
	s := fastSizeOf(it)
	f(&s)
	fast.mu.Lock()
	fast.sizes[fastChoiceKey(it)] = s
	text := jsonText(M{"sizes": fast.sizes})
	fast.mu.Unlock()
	fastSaveText.Store(text)
	fastSaveNow() // a few bytes, written now (no lock held): never later into another folder

}

func fastOff(it pullItem, why string) {
	fastSizeSet(it, func(s *fastSize) { s.Off = cutRunes(why, 200) })
	writeLog("Older entries of " + it.Company + ": the fast read is off for this choice (" + why + "); entries are read as before, day by day")
}

// --- kept on disk: the sizes (a restart goes on at the size reached, and a choice the fast read was stopped for stays off)
func fastFile() string { return sp("fast-entries.json") }

var (
	fastSaveText atomic.Value
	fastSaveMu   sync.Mutex
)

func fastSaveNow() {
	fastSaveMu.Lock()
	defer fastSaveMu.Unlock()
	if t, ok := fastSaveText.Load().(string); ok && t != "" {
		_ = saveFile(fastFile(), t)
		fastSaveText.CompareAndSwap(t, "")
	}
}

func fastLoad() {
	j := readObjFile(fastFile())
	if j == nil {
		return
	}
	fast.mu.Lock()
	defer fast.mu.Unlock()
	for k, v := range obj(j["sizes"]) {
		e := obj(v)
		if e == nil {
			continue
		}
		fast.sizes[k] = fastSize{Win: toInt(e["win"]), Batch: toInt(e["batch"]), Off: cutRunes(str(e["off"]), 200), WinCap: toInt(e["winCap"]), BatchCap: toInt(e["batchCap"])}
	}
}

// --- the speed told in the beat: entries FinCom took in the last 10 minutes, a minute
// review of 0de692f49 (1, 7): only with FastEntries on, and only for the period's entries being brought (a fetch day of the
// person's choice; never a counting day or a "Check for changes" day)
func fastRateNote(it pullItem, n int) {
	if n <= 0 || !fastOn() || !it.Fetch || it.Check {
		return
	}
	fast.mu.Lock()
	defer fast.mu.Unlock()
	k := companyKey(it.Company)
	fast.rate[k] = append(fast.rate[k], rateMark{nowFn(), n})
	fast.rateCo[k] = [2]string{it.Company, strings.ToLower(it.CGUID)}
	fastRateTrimLocked(k)
}

func fastRateTrimLocked(k string) {
	l := fast.rate[k]
	i := 0
	for i < len(l) && nowFn().Sub(l[i].at) > 10*time.Minute {
		i++
	}
	fast.rate[k] = append([]rateMark(nil), l[i:]...)
}

// entries a minute, 0 until two sends at least a minute apart were taken (no figure made up from one send)
func fastRate(company string) int {
	fast.mu.Lock()
	defer fast.mu.Unlock()
	k := companyKey(company)
	fastRateTrimLocked(k)
	l := fast.rate[k]
	if len(l) < 2 {
		return 0
	}
	span := nowFn().Sub(l[0].at)
	if span < time.Minute {
		return 0
	}
	n := 0
	for _, r := range l[1:] { // the first send's entries were read before the span began
		n += r.n
	}
	return int(float64(n)/span.Minutes() + 0.5)
}

// the beat's periodPull.fast, only with FastEntries on (pullBeat): the switch, the sizes, the window requests sent, and
// each company's speed [{company, guid, perMin}] (entries FinCom took in the last 10 minutes, a minute; none until known)
func fastBeat() M {
	fast.mu.Lock()
	sz := M{}
	for k, v := range fast.sizes {
		sz[k] = M{"windowDays": v.Win, "batch": v.Batch, "off": v.Off}
	}
	var cos [][2]string
	for _, c := range fast.rateCo {
		cos = append(cos, c)
	}
	fast.mu.Unlock()
	sort.Slice(cos, func(a, b int) bool { return cos[a][0] < cos[b][0] })
	speed := []any{}
	for _, c := range cos {
		if r := fastRate(c[0]); r > 0 {
			speed = append(speed, M{"company": c[0], "guid": c[1], "perMin": r})
		}
	}
	return M{"on": true, "sizes": sz, "requests": fast.reqs.Load(), "speed": speed}
}

// review (5): a wait before a request of the window (pullMayAsk): the company list is asked again before the next group
func fastWaited() {
	fast.mu.Lock()
	defer fast.mu.Unlock()
	if fast.eng != nil {
		fast.eng.pw.coAt = time.Time{}
	}
}

// review (4): a failed window read counts against each of its days; at fastFailMax the day is read as before
func fastFail(e *fastEng, n int) {
	fast.mu.Lock()
	defer fast.mu.Unlock()
	for _, d := range e.days {
		fast.fails[fastDayKey(e.items[d])] += n
	}
}

// --- the per-day work takes a day the window read (daypull.go pullStep): its heads told, what was read, what is left
func fastTake(w *pullWork) bool {
	if !fastOn() || w == nil {
		return false
	}
	fast.mu.Lock()
	d := fast.ready[fastDayKey(w.it)]
	delete(fast.ready, fastDayKey(w.it))
	for k, x := range fast.ready {
		if nowFn().Sub(x.at) > fastReadyTTL || nowFn().Before(x.at) {
			delete(fast.ready, k) // a day FinCom no longer lists, or read too long ago
		}
	}
	fast.mu.Unlock()
	if d == nil || nowFn().Sub(d.at) > fastReadyTTL || nowFn().Before(d.at) {
		return false // nothing, or read too long ago: the day as before (FinCom is told its heads again; what it holds stands)
	}
	w.heads, w.headsDone, w.sentHeads, w.warmAt = d.heads, true, true, d.headsAt
	w.want, w.got, w.oneByOne = append([]string(nil), d.want...), append([]string(nil), d.got...), d.oneByOne
	w.asked += len(d.got)
	for _, m := range d.single {
		if w.single == nil {
			w.single = map[string]bool{}
		}
		w.single[m] = true
	}
	pullNote(w.it, "fetch", w)
	return true
}

// --- one step of the window (pullStep, after pullMayAsk said the request may go): handled false: today's path
func fastStep(w *pullWork, port int) (handled, sent, more bool) {
	if !fastOn() || w == nil || w.split {
		return false, false, false
	}
	it := w.it
	if fastSizeOf(it).Off != "" {
		return false, false, false
	}
	fast.mu.Lock()
	portOff := fast.offPort[port]
	e := fast.eng
	fast.mu.Unlock()
	if portOff != "" {
		return false, false, false
	}
	if e == nil || e.choice != fastEngKey(it) || e.items[it.Day].Day == "" || e.pw.coPort != 0 && e.pw.coPort != port {
		e = fastPlan(it)
		fast.mu.Lock()
		fast.eng = e
		fast.mu.Unlock()
		if e == nil {
			return false, false, false
		}
	}
	switch {
	case !e.headsDone:
		return fastHeads(e, w, port)
	case e.tell < len(e.days):
		d := e.days[e.tell]
		e.tell++
		tmp := &pullWork{it: e.items[d], heads: fastDayHeads(e, d), stops: map[string]int{}}
		if pullSendHeads(tmp) {
			e.told[d] = true
			e.want = append(e.want, tmp.want...)
			sort.Slice(e.want, func(a, b int) bool { return toI64(e.want[a]) < toI64(e.want[b]) })
			return true, false, true
		}
		pull.mu.Lock()
		_, ended := pull.done[tmp.it.key()] // refused for good (pullCloudOK dropped it or marked it "upload")
		pull.mu.Unlock()
		if !ended {
			// review (8): FinCom did not answer: as the per-day path, the day waits 60 s (DayPullCloudWaitSec) and the window
			// is left (the days told already are told again then; what FinCom holds stands)
			w.cloudWait = tmp.cloudWait
			fastDrop()
			return true, false, false
		}
		if d == it.Day {
			pullFinish(w, "waiting") // the day being read was refused: it ends here, as the per-day path ends it
			fastDrop()
			return true, false, false
		}
		return true, false, true
	case len(e.want) > 0:
		return fastBatch(e, w, port)
	}
	fastFinish(e)
	return true, false, true
}

// the window around the day being read: the run of consecutive days FinCom lists for the same company, choice and phase,
// not finished, not marked "upload", not read already; nil when that is one day (FinComDayHeads, as today)
func fastPlan(it pullItem) *fastEng {
	win := fastSizeOf(it).Win
	pull.mu.Lock()
	cand := map[string]pullItem{}
	for _, x := range pull.items {
		if fastEngKey(x) != fastEngKey(it) {
			continue
		}
		if _, d := pull.done[x.key()]; d {
			continue
		}
		if _, up := pull.upload[x.key()]; up {
			continue
		}
		cand[x.Day] = x
	}
	pull.mu.Unlock()
	fast.mu.Lock()
	if fast.fails[fastDayKey(it)] >= fastFailMax {
		fast.mu.Unlock()
		return nil // review (4): this day's windows failed: read as before
	}
	for d, x := range cand {
		if fast.ready[fastDayKey(x)] != nil || fast.fails[fastDayKey(x)] >= fastFailMax {
			delete(cand, d)
		}
	}
	fast.mu.Unlock()
	cand[it.Day] = it
	days := []string{it.Day}
	for lo, hi := it.Day, it.Day; len(days) < win; {
		if p := addDays(lo, -1); cand[p].Day != "" {
			lo, days = p, append([]string{p}, days...)
			continue
		}
		if n := addDays(hi, 1); cand[n].Day != "" {
			hi, days = n, append(days, n)
			continue
		}
		break
	}
	if len(days) < 2 {
		return nil
	}
	e := &fastEng{choice: fastEngKey(it), items: map[string]pullItem{}, days: days, heads: map[string]pullHead{}, told: map[string]bool{}, got: map[string]string{},
		one: map[string]bool{}, pw: &pullWork{it: it}}
	for _, d := range days {
		e.items[d] = cand[d]
	}
	return e
}

func fastDayHeads(e *fastEng, d string) map[string]pullHead {
	o := map[string]pullHead{}
	for m, h := range e.heads {
		if h.Date == d {
			o[m] = h
		}
	}
	return o
}

// the rows of a window's answer; bad: a row dated outside the window (or with no date)
func fastRowsOf(raw, from, to string) ([]pullHead, string) {
	raw = reCmpInfo.ReplaceAllString(raw, "")
	var out []pullHead
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		h := pullHead{GUID: cut(strings.TrimSpace(tagValue(b, "GUID")), 100), Mid: strings.TrimLeft(tagNum(b, "MASTERID"), "0"), Alter: toI64(tagNum(b, "ALTERID")),
			Date: normDate(tagValue(b, "DATE")), Type: html.UnescapeString(group(`<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"`, b, 1))}
		if h.Type == "" {
			h.Type = tagValue(b, "VOUCHERTYPENAME")
		}
		if h.Date == "" || h.Date < from || h.Date > to {
			return nil, or(h.Date, "no date")
		}
		if h.Mid == "" || h.GUID == "" {
			continue
		}
		out = append(out, h)
	}
	return out, ""
}

// the request at Tally, timed and its window watched (as pullHeadsStep and pullBatchStep do)
type fastAnswer struct {
	raw        string
	err        error
	took       float64
	holdMs     int
	unfinished bool
}

func fastAsk(e *fastEng, port int, x string, guarded func(tc *TC) (string, error)) fastAnswer {
	var a fastAnswer
	tc := recorderTC(nil)
	tc.timed = func(sec float64) { a.took += sec }
	tc.gentleMs = pullGentleMs()
	held := windowHoldFn()
	fast.mu.Lock()
	fast.ask = x
	fast.mu.Unlock()
	fast.reqs.Add(1)
	a.raw, a.err = guarded(tc)
	fast.mu.Lock()
	fast.ask = ""
	fast.mu.Unlock()
	from := time.Now().Add(-time.Duration(a.took * float64(time.Second)))
	if errors.Is(a.err, errRecorderStop) && a.took > 0 {
		a.unfinished = abandonMax() <= 0 || !pullAwaitEarlier(port, abandonWait())
	}
	a.holdMs = held(from)
	if a.took == 0 {
		a.holdMs = 0
	}
	pullNoteWatched(a.holdMs)
	pullNoteLook(a.err == nil && a.took > 0, a.holdMs)
	return a
}

// W1: the window's heads
func fastHeads(e *fastEng, w *pullWork, port int) (bool, bool, bool) {
	it := w.it
	from, to := e.days[0], e.days[len(e.days)-1]
	x := fastHeadsRequest(it.Company, from, to)
	if x == "" {
		fastOff(it, "the window's request could not be built")
		return false, false, false
	}
	pull.mu.Lock()
	pull.lastAsk = nowFn()
	pull.mu.Unlock()
	a := fastAsk(e, port, x, func(tc *TC) (string, error) { return invokeTally(tc, port, x, 5) })
	what := fmt.Sprintf("the heads of %s .. %s (%d days)", liveDay(from), liveDay(to), len(e.days))
	if a.err != nil || a.holdMs >= recorderLimitMs() {
		e.pw.coAt = time.Time{}
	}
	switch {
	case errors.Is(a.err, errRetryWait) || gaveWay(a.err) || errors.Is(a.err, errReadStopped):
		return true, false, false // nothing reached Tally; the window waits
	case a.holdMs >= recorderLimitMs():
		fastDrop()
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while %s were read", float64(a.holdMs)/1000, what))
		return true, true, false
	case a.unfinished:
		fastDrop()
		pullStopCompany(w, "over2s", what+": Tally had not finished it after the 2 s stop (or could not be watched)")
		return true, true, false
	case errors.Is(a.err, errRecorderStop):
		// review (3), the owner's freeze rule: a request of the read stopped at 2 s stops the company's read, exactly as
		// the per-day path does (pullHeadsStep); nothing is asked again by itself. The size is kept as this choice's cap
		fastDrop()
		fastSizeSet(it, func(s *fastSize) { s.WinCap = len(e.days) })
		pullStopCompany(w, "over2s", what+" (FinComWindowHeads)")
		return true, true, false
	case a.err != nil:
		var na *notAllowedError
		if errors.As(a.err, &na) || errors.Is(a.err, errFastRefused) {
			fastDrop()
			fastOff(it, "refused before sending: "+cutRunes(a.err.Error(), 160))
			return false, false, false // nothing went: today's path at once
		}
		// review (4): not answered, reset, ...: counted against the window's days (at 2 they are read as before); the
		// window waits for the next round
		fastDrop()
		fastFail(e, 1)
		liveSayOnce("pull|fasterr|"+it.key(), fmt.Sprintf("Older entries of %s: %s not read (%s); asked again later", it.Company, what, cutRunes(a.err.Error(), 160)))
		return true, true, false
	}
	if why := tallyCollectionWhy(a.raw); why != "" {
		// review (2): a Tally error (LINEERROR), or no collection in the answer, is never taken as "no entries"
		fastDrop()
		fastFail(e, 1)
		liveSayOnce("pull|fastbad|"+it.key(), fmt.Sprintf("Older entries of %s: %s: %s; not used, asked again later", it.Company, what, why))
		return true, true, false
	}
	rows, bad := fastRowsOf(a.raw, from, to)
	if bad != "" {
		fast.mu.Lock()
		fast.offPort[port] = "an entry of " + liveDay(bad) + " came for " + liveDay(from) + " .. " + liveDay(to)
		fast.mu.Unlock()
		fastDrop()
		writeLog(fmt.Sprintf("Older entries of %s: Tally answered %s (FinComWindowHeads) with an entry dated %s: the window was not applied. The answer is dropped, nothing is stored or sent; no window is asked of this Tally until the bridge restarts (days are read one by one, as before)", it.Company, what, liveDay(bad)))
		return true, true, true
	}
	perDay := map[string]int{}
	for _, h := range rows {
		perDay[h.Date]++
		if perDay[h.Date] > pullHeadsMax() {
			fastDrop()
			fastFail(e, fastFailMax) // review (4): a day of more entries than a day may hold: read as before (it marks the day)
			return true, true, true
		}
		e.heads[h.Mid] = h
	}
	e.headsDone, e.headsAt = true, nowFn()
	ms := int(a.took * 1000)
	switch {
	case ms > fastHeadsShrinkMs || len(rows) > fastRowsCap():
		fastSizeSet(it, func(s *fastSize) { s.Win = maxI(2, len(e.days)/2) })
	case ms < fastHeadsGrowMs && len(rows) < fastRowsCap()/2 && len(e.days) >= fastSizeOf(it).Win:
		fastSizeSet(it, func(s *fastSize) { s.Win = minI(fastWinMax(), s.Win*2) })
	}
	writeLog(fmt.Sprintf("Older entries of %s: %s: Tally lists %d entries (%d ms)", it.Company, what, len(rows), ms))
	pullNote(it, "heads", w)
	return true, true, true
}

// the next group of the window's wanted entries: a run by MasterID of at most n, its dates; exact: every head of the
// window with a MasterID in a..b and a date in the group's dates is in the group (so Tally's answer is the group)
func fastGroup(e *fastEng, n int) (g []string, from, to string) {
	isPay := func(m string) bool { return payrollEntry(e.pw.it.Company, e.heads[m].Type) }
	var cand []string
	for _, m := range e.want {
		_, left := e.got[m] // read already, or left for one by one
		if _, ok := e.heads[m]; ok && !left && !isPay(m) && batchMidOK(m) && !e.one[e.heads[m].Date] {
			cand = append(cand, m)
		}
	}
	in := map[string]bool{}
	exact := func(lo, hi int64, a, z string) bool {
		for m, h := range e.heads {
			if v := toI64(m); v >= lo && v <= hi && h.Date >= a && h.Date <= z && !in[m] {
				return false
			}
		}
		return true
	}
	for _, m := range cand {
		if len(g) >= n {
			break
		}
		d := e.heads[m].Date
		a, z := d, d
		if len(g) > 0 {
			a, z = from, to
			if d < a {
				a = d
			}
			if d > z {
				z = d
			}
		}
		in[m] = true
		lo := toI64(m)
		if len(g) > 0 {
			lo = toI64(g[0])
		}
		if !exact(lo, toI64(m), a, z) {
			delete(in, m)
			if len(g) > 0 {
				break
			}
			continue
		}
		g, from, to = append(g, m), a, z
	}
	return g, from, to
}

// W2: one group of the window
func fastBatch(e *fastEng, w *pullWork, port int) (bool, bool, bool) {
	it := w.it
	sz := fastSizeOf(it)
	if sz.Batch < 2 {
		fastFinish(e)
		return true, false, true
	}
	if nowFn().Sub(e.headsAt) > pullHeadsFresh() || nowFn().Before(e.headsAt) {
		fastFinish(e) // the window's heads are not fresh: what is left is read day by day (its heads asked again)
		return true, false, true
	}
	g, from, to := fastGroup(e, sz.Batch)
	if len(g) < 2 {
		fastFinish(e)
		return true, false, true
	}
	a0, b0 := toI64(g[0]), toI64(g[len(g)-1])
	x := fastBatchRequest(it.Company, from, to, a0, b0)
	what := fmt.Sprintf("%d entries of %s .. %s (MasterIDs %d..%d)", len(g), liveDay(from), liveDay(to), a0, b0)
	if x == "" {
		fastOff(it, "a group's request could not be built")
		fastFinish(e)
		return true, false, true
	}
	listed := pullCoListed(e.pw, port)
	a := fastAsk(e, port, x, func(tc *TC) (string, error) {
		if slowMarked(it.Company, "") {
			return "", errSlowCompany
		}
		if err := readStopRefuses(x); err != nil {
			return "", err
		}
		if !listed {
			if err := fastCompanyListed(tc, it.Company, port, liveBodySec()); err != nil {
				return "", err
			}
		}
		return invokeTally(tc, port, x, liveBodySec())
	})
	if a.err != nil || a.holdMs >= recorderLimitMs() {
		e.pw.coAt = time.Time{}
	} else if !listed {
		e.pw.coAt, e.pw.coReal, e.pw.coPort = nowFn(), time.Now(), port
	}
	groupDays := func() {
		for _, m := range g {
			e.one[e.heads[m].Date] = true
		}
	}
	switch {
	case errors.Is(a.err, errRetryWait) || gaveWay(a.err) || errors.Is(a.err, errReadStopped):
		return true, false, false
	case errors.Is(a.err, errSlowCompany):
		fastDrop()
		pullDrop(w)
		return true, true, false
	case a.holdMs >= recorderLimitMs():
		fastDrop()
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while %s were read", float64(a.holdMs)/1000, what))
		return true, true, false
	case a.unfinished:
		fastDrop()
		pullStopCompany(w, "over2s", what+": Tally had not finished it after the 2 s stop (or could not be watched)")
		return true, true, false
	case errors.Is(a.err, errRecorderStop):
		// review (3), the owner's freeze rule: stopped at 2 s: the company's read stops, as the per-day path stops it;
		// the size is kept as this choice's cap (never asked at it or above again)
		fastDrop()
		fastSizeSet(it, func(s *fastSize) { s.BatchCap = len(g) })
		pullStopCompany(w, "over2s", what+" (FinComVoucherWindow)")
		return true, true, false
	case a.err != nil:
		var na *notAllowedError
		if errors.As(a.err, &na) || errors.Is(a.err, errFastRefused) {
			fastOff(it, "refused before sending: "+cutRunes(a.err.Error(), 160))
			fastFinish(e)
			return true, false, true
		}
		groupDays()
		liveSayOnce("pull|fastgrp|"+it.key(), fmt.Sprintf("Older entries of %s: %s not read (%s); those days are read one by one", it.Company, what, cutRunes(a.err.Error(), 160)))
		fastFinish(e)
		return true, true, true
	}
	got, single, err := fastParse(it.Company, a.raw, g, e.heads, from, to)
	if err != nil {
		groupDays()
		writeLog(fmt.Sprintf("Older entries of %s: %s: %s; not used, those days are read one by one", it.Company, what, cutRunes(err.Error(), 200)))
		fastFinish(e)
		return true, true, true
	}
	ms := int(a.took * 1000)
	switch {
	case ms > fastBatchShrinkMs:
		fastSizeSet(it, func(s *fastSize) { s.Batch = maxI(2, len(g)/2) })
	case ms < fastBatchGrowMs && len(g) >= sz.Batch:
		fastSizeSet(it, func(s *fastSize) { s.Batch = minI(fastBatchMax(), s.Batch*2) })
	}
	e.pw.warmAt = nowFn()
	in := map[string]bool{}
	for _, m := range g {
		if single[m] {
			continue // left wanted: FinComVoucherObject reads it on the day's own turn (as 2.4.9 leaves it)
		}
		in[m] = true
		e.got[m] = got[m]
	}
	var rest []string
	for _, m := range e.want {
		if !in[m] {
			rest = append(rest, m)
		}
	}
	e.want = rest
	fastSkip(e, single)
	writeLog(fmt.Sprintf("Older entries of %s: %s read in one request (%d ms)", it.Company, what, ms))
	return true, true, true
}

// entries a group left for one by one: kept out of the next groups (they stay wanted, for the day's own turn)
func fastSkip(e *fastEng, single map[string]bool) {
	if len(single) == 0 {
		return
	}
	if e.got == nil {
		e.got = map[string]string{}
	}
	for m := range single {
		e.got[m] = "" // a mark: not grouped again, not sent from the window
	}
}

// a group's answer: exactly the entries asked, each once, each dated as its head and with its head's GUID; each kept as
// FinComVoucherObject's answer would be (batchEntry), or left for one by one
func fastParse(company, raw string, g []string, heads map[string]pullHead, from, to string) (map[string]string, map[string]bool, error) {
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, nil, batchInexactError{"Tally's answer could not be read: " + cut(flat(raw), 120)}
	}
	asked := map[string]bool{}
	for _, m := range g {
		asked[m] = true
	}
	out, single := map[string]string{}, map[string]bool{}
	raw = reCmpInfo.ReplaceAllString(raw, "")
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		c := cleanXML(b)
		mid := strings.TrimLeft(tagNum(c, "MASTERID"), "0")
		d := normDate(tagValue(c, "DATE"))
		switch {
		case mid == "" || !asked[mid]:
			return nil, nil, batchInexactError{"an entry not asked (MasterID " + or(mid, "none") + ")"}
		case out[mid] != "" || single[mid]:
			return nil, nil, batchInexactError{"MasterID " + mid + " twice"}
		case d == "" || d < from || d > to || d != heads[mid].Date:
			return nil, nil, batchInexactError{"MasterID " + mid + " dated " + or(d, "no date")}
		case !strings.EqualFold(strings.TrimSpace(tagValue(c, "GUID")), heads[mid].GUID):
			return nil, nil, batchInexactError{"MasterID " + mid + " is no longer the entry the window's list named"}
		}
		v, leave := batchEntry(company, c)
		if leave != "" {
			single[mid] = true
			continue
		}
		out[mid] = v
	}
	if len(out)+len(single) != len(g) {
		return nil, nil, batchInexactError{fmt.Sprintf("%d of %d missing", len(g)-len(out)-len(single), len(g))}
	}
	return out, single, nil
}

// the window read: each day FinCom took the heads of is handed to its per-day work (fastTake)
func fastFinish(e *fastEng) {
	fast.mu.Lock()
	defer fast.mu.Unlock()
	if fast.eng == e {
		fast.eng = nil
	}
	now := nowFn()
	for _, d := range e.days {
		if !e.told[d] {
			continue
		}
		fd := &fastDay{heads: map[string]pullHead{}, oneByOne: e.one[d], headsAt: e.headsAt, at: now}
		var mids []string
		for m, h := range e.heads {
			if h.Date == d {
				fd.heads[m] = h
				mids = append(mids, m)
			}
		}
		sort.Slice(mids, func(a, b int) bool { return toI64(mids[a]) < toI64(mids[b]) })
		wanted := map[string]bool{}
		for _, m := range e.want {
			wanted[m] = true
		}
		for _, m := range mids {
			if x, ok := e.got[m]; ok && x != "" {
				fd.got = append(fd.got, x)
			} else if wanted[m] || ok {
				if ok {
					fd.single = append(fd.single, m)
				}
				fd.want = append(fd.want, m) // not read by the window (left for one by one, payroll, or the window ended)
			}
		}
		fast.ready[fastDayKey(e.items[d])] = fd
	}
}

// the window given up: nothing it read is used (its days are read as before)
func fastDrop() {
	fast.mu.Lock()
	fast.eng = nil
	fast.mu.Unlock()
}

// review (2): why a collection answer of Tally is not a list ("" when it is): a Tally error (LINEERROR), or no
// <COLLECTION> under the answer (an answer with no data root is never "no entries")
var (
	reTallyLineErr = regexp.MustCompile(`(?i)<LINEERROR[\s>]`)
	reTallyColl    = regexp.MustCompile(`(?i)<COLLECTION[\s>/]`)
)

func tallyCollectionWhy(raw string) string {
	switch {
	case !strings.Contains(raw, "<ENVELOPE"):
		return "Tally's answer could not be read"
	case reTallyLineErr.MatchString(raw):
		return "Tally answered with an error: " + cut(flat(group(`(?is)<LINEERROR(?:\s[^>]*)?>(.*?)</LINEERROR>`, raw, 1)), 160)
	case !reTallyColl.MatchString(raw):
		return "Tally's answer holds no list"
	}
	return ""
}
