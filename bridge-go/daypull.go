// FinCom Bridge 2.4.5 (ROUND 102; the owner's decisions of 21-Oct-2026): older entries brought in from Tally for a
// period the PERSON chooses in FinCom (a financial year, or Apr-Sep / Oct-Mar when the year holds more than 20,000
// vouchers), one day at a time, only while Tally is idle. Never a blanket fetch, never the Day Book report.
//
// The cloud holds the queue (tally-ingest, migration 98): the beat answer names at most 3 days (periodDays: company,
// company GUID, day, fetch, types). For each day the bridge:
//  1. asks that day's entry heads, FinComDayHeads (F1, the owner's approved form: GUID, MASTERID, ALTERID, DATE of the
//     Vouchers of ONE day, SVFROMDATE = SVTODATE, yyyymmdd TYPE="Date"), under the 2 s hard stop;
//  2. stopped at 2 s: the day asked again one voucher type at a time (F2: the same id, d-MMM-yyyy TYPE="Date", the filter
//     $Date >= $$Date:"d" AND $Date <= $$Date:"d" AND $VoucherTypeName = "<type>"), the types the cloud names (else
//     Tally's six standard accounting types); a type still over 2 s: the day is marked "upload" and the person sees ONE
//     quiet line ("Tally took too long to give 31-Aug-2026. Please upload that day's Day Book."), once; it is never asked
//     again. A late answer after a stop is thrown away (the next-inflight wait, tally.go), never used;
//  3. checks every row is dated the day asked (the round 18 rule): one row of another date and the whole answer is
//     dropped, the day marked "upload", and day reading stops on that Tally until the bridge restarts (one log line names
//     the form);
//  4. sends the heads to FinCom (period_heads: its count of the day, by type); while the period is being counted that is
//     all. In the fetch phase FinCom answers the MasterIDs it lacks (or holds at a lower AlterID), and each is asked with
//     the existing FinComVoucherObject (unchanged, one entry a request, after the company list as 2.3.4 asks it), its date
//     checked, and sent (period_entries, through the cloud's entry path). A day is done when FinCom holds every entry Tally
//     lists for it.
//
// Before EVERY request all six conditions of plan section 3.2 hold, each looked at without sending anything to Tally:
// Tally running, its window answering and its port open; Tally not busy (no request at it, no stop or no-answer spell);
// background reading not paused and not stopped from FinCom; no posting queued or running (postings first) and no save
// waiting to go; idle (no recorder line for the company and no typing in Tally in the last 60 s); the shared retry
// schedule clear. Any one false: the bridge waits for the next round and shows nothing. One request in flight per Tally
// (the one gate, tally.go). Nothing else is added to any Tally request. No AI.
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
	dayHeadsID    = "FinComDayHeads"
	dayHeadsFetch = "GUID, MASTERID, ALTERID, DATE"
)

// Tally's six standard accounting voucher types: the split's types when the cloud names none
var pullStdTypes = []string{"Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra"}

// F1: one day's entry heads (the owner's approval of 21-Oct-2026; collection form 3, formPlainT)
func dayHeadsRequest(company, day string) string {
	return formCollection(dayHeadsID, company, formPlainT, day, day, dayHeadsFetch, "")
}

// F2: the same day, one voucher type (the owner's approval of 21-Oct-2026; measured as S3-5)
func dayHeadsTypeRequest(company, day, vtype string) string {
	return formCollection(dayHeadsID, company, collFilterGE, day, day, dayHeadsFetch, `$VoucherTypeName = "`+vtype+`"`)
}

// a voucher type name that may be asked (no quote mark, no control character, not empty, 60 characters at most). "&",
// "<" and ">" are allowed (review 245 R1: "Sales & Returns"): fcCollection escapes the formula for XML, and inside the
// formula's quotes they are plain characters; a quote mark could end the string, so a type with one is never asked
func pullTypeOK(t string) bool {
	if t == "" || len([]rune(t)) > 60 || strings.ContainsAny(t, "\"") || strings.TrimSpace(t) != t {
		return false
	}
	for _, r := range t {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func pullIdleSec() int      { return keepNum("DayPullIdleSec", 60) }
func pullPerTurnDay() int   { return maxI(1, keepNum("DayPullPerTurn", 40)) }
func pullFlushAtDay() int   { return maxI(1, minI(keepNum("DayPullBatch", 50), 200)) }
func pullNightDays() int    { return maxI(1, minI(keepNum("DayPullNightDays", 30), 30)) }
func pullNightBeatSec() int { return maxI(5, keepNum("DayPullNightBeatSec", 10)) }

// ROUND 103 (the owner's decision of 21-Oct-2026, evening): outside office hours (FinCom's beat answer says periodNight;
// the hours are the owner's, per computer, on FinCom's Tally page: 20:00-08:00 IST and Sunday unless he changes them) the
// period is read day after day while Tally is idle: more requests a turn, no rest between them (the conditions are still looked at before each), bigger batches to
// FinCom. Every request keeps its own 2 s stop (a payroll entry its 3 s), one in flight, the six conditions before each,
// postings first and the freeze safety; the per-computer switch (periodFetch) wins
func pullPerTurn() int {
	if pullNight() {
		return maxI(1, keepNum("DayPullNightPerTurn", 400))
	}
	return pullPerTurnDay()
}
func pullFlushAt() int {
	if pullNight() {
		return maxI(1, minI(keepNum("DayPullNightBatch", 200), 200))
	}
	return pullFlushAtDay()
}
func pullGapMs() int {
	if pullNight() {
		return keepNumZero("DayPullNightGapMs", 0)
	}
	return keepNumZero("DayPullGapMs", 100)
}

// the night pace holds only while FinCom's answers keep saying so (an answer older than three beats: the day pace)
func pullNight() bool {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return pull.night && nowFn().Sub(pull.nightAt) < time.Duration(3*beatEvery()+60)*time.Second && !nowFn().Before(pull.nightAt)
}
func pullHeadsMax() int { return keepNum("DayPullHeadsMax", 30000) }
func pullWait() time.Duration {
	return time.Duration(keepNum("DayPullCloudWaitSec", 60)) * time.Second
}

// one day the cloud listed
type pullItem struct {
	Company, CGUID, Day string
	ChosenAt            string // FinCom's time of the person's choice (ROUND 103: a stop holds until another choice)
	Fetch               bool
	Types               []string
}

func (it pullItem) key() string {
	return companyKey(it.Company) + "|" + strings.ToLower(it.CGUID) + "|" + it.Day
}

func (it pullItem) types() []string {
	if len(it.Types) > 0 {
		return it.Types
	}
	return pullStdTypes
}

// one head of Tally's list of a day
type pullHead struct {
	GUID, Mid, Type, Date string
	Alter                 int64
}

// the work on the day being read
type pullWork struct {
	it        pullItem
	heads     map[string]pullHead // by MasterID
	split     bool
	typeIdx   int
	headsDone bool
	sentHeads bool
	want      []string
	got       []string // the entries read, as kept (fastvch.go), not yet sent
	gone      []string // MasterIDs Tally no longer has
	stops     map[string]int
	asked     int
	cloudWait time.Time
	fails     int
	// review 245 R15 (M1): the payroll's employees waited for: tries that did not get them, since when, the next try, and
	// the payroll entries left out when the wait ended (the day is then marked "upload")
	empTries int
	empSince time.Time
	empNext  time.Time
	paySkip  int
	// ROUND 104 (a): Tally's company list named the company for this day at coAt (the bridge's clock) / coReal (the
	// wall clock), on coPort; zero: to be asked before the next entry
	coAt   time.Time
	coReal time.Time
	coPort int
	// 2.4.9 (the owner's approval of 29-Oct-2026): the group size of FinComVoucherBatch for this day (0: not set yet; halved
	// after a group stopped at 2 s), one by one from here (a half-size group stopped, an inexact answer, an entry held),
	// and the groups asked
	batchN   int
	oneByOne bool
	batches  int
	single   map[string]bool // entries a group's answer left for FinComVoucherObject
	warmAt   time.Time       // review R1-5: the day's heads, or its last group, answered (the bridge's clock)
}

// review 245 R15 (M1): a payroll entry waits for its employees at most EmployeeWaitTries tries (a minute apart) and
// EmployeeWaitMin minutes a day; then the day's other entries are read and sent, its payroll entries are left out and the
// day is marked "upload" (one quiet line), and the other days and companies go on
func pullEmpTries() int { return maxI(1, keepNum("EmployeeWaitTries", 3)) }
func pullEmpWait() time.Duration {
	return time.Duration(maxI(1, keepNum("EmployeeWaitMin", 10))) * time.Minute
}

var pull = struct {
	mu      sync.Mutex
	items   []pullItem
	work    *pullWork
	stopped map[int]string       // a Tally whose answer carried another date: no day asked of it until the bridge restarts
	upload  map[string]M         // the days marked "upload" (said once): key -> {company, day, words, at}
	tell    map[string]M         // the "upload" days FinCom has not taken yet: key -> {body, at}
	stopCo  map[string]M         // ROUND 103 (1b): companies whose older entries are stopped: company key -> {company, day, why, words, at, atN}
	done    map[string]time.Time // days finished in this run: not asked again for 2 minutes
	state   map[string]M         // per company, for the beat: {day, phase, heads, asked, at, waiting}
	said    map[string]string    // the last "waiting" reason said per company (said once)
	lastAsk time.Time
	night   bool                 // FinCom's last answer said: outside office hours (periodNight)
	nightAt time.Time            // when it said so
	beatAt  time.Time            // the last early beat asked at night
	empAt   map[string]time.Time // payroll: the employees found read and taken by FinCom (per company and GUID), looked at again after 10 minutes
	// ROUND 104 (b): the last period request answered with Tally's window watched to its end (wall clock) and its hold
	lookAt   time.Time
	lookHold int
	// 2.4.9: the FinComVoucherBatch request being asked now (the dated guard lets only it through; batch249.go)
	batchAsk string
	batchCo  map[string]int // review R1-4: the group size a company's slow days came down to (batch249.go pullBatchCo)
}{empAt: map[string]time.Time{}, stopped: map[int]string{}, upload: map[string]M{}, tell: map[string]M{}, stopCo: map[string]M{}, done: map[string]time.Time{}, state: map[string]M{}, said: map[string]string{}}

// --- the beat answer: periodDays [{company, company_guid, day, fetch, types}], at most 3
func applyPeriodDays(j M) {
	// an empty list (paused in FinCom, the period done, reading stopped): nothing listed, and the day being read is left at
	// once (review 245 R1: Pause stops the reads). No list at all (the cloud could not work it out this time, or a cloud
	// without migration 98): nothing changes (review 245 R2: a passing fault never throws away what was read)
	v, has := j["periodDays"]
	if pf, ok := j["periodFetch"]; ok && !truthy(pf) {
		v, has = []any{}, true // ROUND 103 (1c): this computer's switch is off in FinCom: nothing is read
	}
	if !has {
		return
	}
	nightAns := truthy(j["periodNight"]) && len(arr(v)) > 0
	max := 3
	if nightAns {
		max = pullNightDays()
	}
	var items []pullItem
	for _, x := range arr(v) {
		e := obj(x)
		co, cg, d := cutRunes(strings.TrimSpace(str(e["company"])), 200), cut(cleanGUID(str(e["company_guid"])), 100), normDate(str(e["day"]))
		if co == "" || cg == "" || len(d) != 8 || !isTallyDate(d) || d > nowFn().Format("20060102") || d < "19900101" {
			continue
		}
		if held := heldGUID(co); held == "" || !strings.EqualFold(held, cg) {
			liveSayOnce("pull|notown|"+companyKey(co), "Older entries: "+co+": not asked (FinCom names another company GUID than this bridge holds)")
			continue
		}
		it := pullItem{Company: co, CGUID: cg, Day: d, Fetch: truthy(e["fetch"]), ChosenAt: cutRunes(str(e["chosenAt"]), 60)}
		if pullStoppedFor(co, str(e["chosenAt"])) {
			continue // ROUND 103 (1b): stopped for this company; only a newer choice in FinCom starts it again
		}
		for _, t := range arr(e["types"]) {
			if s := str(t); pullTypeOK(s) && len(it.Types) < 40 && !contains(it.Types, s) {
				it.Types = append(it.Types, s)
			}
		}
		items = append(items, it)
		if len(items) >= max {
			break
		}
	}
	pull.mu.Lock()
	defer pull.mu.Unlock()
	keep := map[string]bool{}
	for _, it := range items {
		keep[it.key()] = true
	}
	if pull.work != nil && !keep[pull.work.it.key()] {
		if len(items) == 0 {
			pull.work = nil // FinCom lists nothing (paused, done, stopped): nothing more is asked of it
		} else {
			// FinCom lists other days first (the day being read was handed out a moment ago): it is finished here; FinCom
			// refuses it in words if it is no longer wanted (pullCloudOK), and nothing more is asked then
			items = append(items, pull.work.it)
		}
	}
	// a day finished here is not asked again for 2 minutes (review 245 R2: a day FinCom still lists is not read again at
	// every beat; other days go first)
	var fresh []pullItem
	for _, it := range items {
		if _, up := pull.upload[it.key()]; up {
			continue // marked "upload": never asked again
		}
		fresh = append(fresh, it)
	}
	for k, t := range pull.done {
		if nowFn().Sub(t) >= 2*time.Minute {
			delete(pull.done, k)
		}
	}
	pull.items = fresh
	// review 245 R15 (L1): the night pace (and its early beats) only while a listed day is left to read here once the list
	// is filtered (another company GUID, stopped, marked "upload", finished a moment ago): else the beat keeps its own time
	night := false
	if nightAns {
		for _, it := range fresh {
			if _, d := pull.done[it.key()]; !d {
				night = true
				break
			}
		}
	}
	pull.night, pull.nightAt = night, nowFn()
}

// the dated guard's FinComDayHeads exception (tally.go): exactly F1 or F2 as built, one day (SVFROMDATE = SVTODATE),
// a day the cloud listed now for that company, a type of that day's list, under the 2 s hard stop
func dayHeadsExact(tc *TC, x string) bool {
	if tallyRequestID(x) != dayHeadsID || tc == nil || tc.limitMs <= 0 || tc.limitMs > 2000 {
		return false
	}
	co := pinCo(x)
	a, z := pinDates(x)
	if a == "" || a != z {
		return false
	}
	// ROUND 103 (1d): the tray's old-days test (a person's, read only): F1 exactly, one of its three days, its company
	if x == dayHeadsRequest(co, a) && oldTestAllows(co, a) {
		return true
	}
	pull.mu.Lock()
	defer pull.mu.Unlock()
	for _, it := range pull.items {
		if companyKey(it.Company) != companyKey(co) || it.Day != a {
			continue
		}
		if x == dayHeadsRequest(co, a) {
			return true // ROUND 103: F1 only; the by-type form is no longer sent (the gate refuses it)
		}
	}
	return false
}

// the tests: Tally's window "not answering"
var tallyNotResponding atomic.Bool

var errDayHeadsRefused = errors.New("FinCom Bridge asks Tally for one day's entries only as built, for a day FinCom listed, under the 2-second stop; nothing was sent to Tally")

// --- the rows of a heads answer: each <VOUCHER> of the collection (Tally's own CMPINFO counters never taken); bad: a row
// dated another day (the date was not applied)
var reCmpInfo = regexp.MustCompile(`(?s)<CMPINFO\b.*?</CMPINFO\s*>`)

func pullRowsOf(raw, day string) ([]pullHead, string) {
	raw = reCmpInfo.ReplaceAllString(raw, "")
	var out []pullHead
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		h := pullHead{GUID: cut(strings.TrimSpace(tagValue(b, "GUID")), 100), Mid: strings.TrimLeft(tagNum(b, "MASTERID"), "0"), Alter: toI64(tagNum(b, "ALTERID")),
			Date: normDate(tagValue(b, "DATE")), Type: html.UnescapeString(group(`<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"`, b, 1))}
		if h.Type == "" {
			h.Type = tagValue(b, "VOUCHERTYPENAME")
		}
		if h.Date != day {
			return nil, or(h.Date, "no date")
		}
		if h.Mid == "" || h.GUID == "" {
			continue
		}
		out = append(out, h)
	}
	return out, ""
}

// --- the six conditions (plan section 3.2), nothing sent to Tally; why the day waits ("" when it may be asked now)
func pullMayAsk(it pullItem) (int, string) {
	if !tallyRunning() {
		return 0, "Tally is not open"
	}
	if paused() {
		return 0, "background reading is paused"
	}
	if readStop() != nil {
		return 0, "reading is stopped from FinCom"
	}
	if postingGoing() || importsInFlight.Load() > 0 {
		return 0, "a posting goes first"
	}
	if liveQueueReady() {
		return 0, "a save in Tally goes to FinCom first"
	}
	if pullBusyPerson(it) {
		return 0, "someone is working in Tally"
	}
	if retryWaiting() != nil {
		return 0, "Tally did not answer in time lately; the shared retry schedule waits"
	}
	if _, ok := startPointOf(it.Company); !ok {
		return 0, "the company's starting point is not recorded yet"
	}
	if slowMarked(it.Company, it.CGUID) {
		return 0, "this company's entries are not asked (finding one took longer than 2 s)"
	}
	port, why := pullPort(it)
	if why != "" {
		return 0, why
	}
	if !tallyPortOpen(port) {
		return 0, "Tally's port is closed"
	}
	if busy, _ := tallyBusy(port); busy {
		return 0, "Tally is busy"
	}
	// the holds every background read keeps (review 245 R1): FinCom's own reading, Tally just opened and still loading
	if h := keepHold(); h != "" {
		return 0, h
	}
	if !pullWindowOK() {
		return 0, "Tally's window is not answering"
	}
	if earlierRefusal(port) != nil {
		return 0, "Tally is still on an earlier request"
	}
	pull.mu.Lock()
	stop := pull.stopped[port]
	pull.mu.Unlock()
	if stop != "" {
		return 0, "single days are not read from this Tally until the bridge restarts (" + stop + ")"
	}
	return port, ""
}

// the port of this bridge's own Tally with the company open, from the list as last seen (nothing asked of Tally here:
// the beat and the light check keep that list)
func pullPort(it pullItem) (int, string) {
	live.mu.Lock()
	liveFresh()
	open := liveOwnOpenNow(it.CGUID, it.Company)
	live.mu.Unlock()
	if !open {
		return 0, "the company is not open in this bridge's own Tally"
	}
	cached := openCompaniesCached()
	p, _, err := findCompanyWith(it.Company, 0, []bool{false}, func(bool) []M { return cached })
	if err != nil {
		return 0, "the company is not open in Tally (" + cutRunes(err.Error(), 120) + ")"
	}
	for _, s := range cached {
		if toInt(s["port"]) == p && s["mine"] == false {
			return 0, fmt.Sprintf("the Tally on port %d is another Windows user's", p)
		}
	}
	return p, ""
}

// the person at Tally comes first: a recorder line for the company (a save in Tally) in the last minute, or typing in
// Tally (Tally the window in front, the keyboard or mouse used) in the last minute
func pullBusyPerson(it pullItem) bool {
	idle := time.Duration(pullIdleSec()) * time.Second
	if _, last := recorderHolding(it.Company, it.CGUID); last != "" {
		if t, err := time.ParseInLocation("2006-01-02T15:04:05", last, time.Local); err == nil && time.Since(t) < idle {
			return true
		}
	}
	return platFrontIsTally() && platIdleSec() < idle.Seconds()
}

// said once per company while the reason lasts (no notice: only the log)
func pullSayWait(it pullItem, why string) {
	pull.mu.Lock()
	same := pull.said[companyKey(it.Company)] == why
	pull.said[companyKey(it.Company)] = why
	st := pull.state[companyKey(it.Company)]
	if st == nil {
		st = M{}
		pull.state[companyKey(it.Company)] = st
	}
	st["waiting"], st["day"] = why, it.Day
	pull.mu.Unlock()
	if !same {
		writeLog("Older entries of " + it.Company + ": " + liveDay(it.Day) + " waits (" + why + "); nothing was sent to Tally")
	}
}

func pullNote(it pullItem, phase string, w *pullWork) {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	delete(pull.said, companyKey(it.Company))
	st := M{"day": it.Day, "phase": phase, "at": nowFn().Format(time.RFC3339)}
	if w != nil {
		st["heads"], st["asked"], st["left"] = len(w.heads), w.asked, len(w.want)
	}
	pull.state[companyKey(it.Company)] = st
}

// --- the loop: one request at a time, at most DayPullPerTurn a turn, the conditions looked at before every one
func dayPullLoop() {
	pullLoad()
	sleepOrStop(20 * time.Second)
	for !stopping() {
		n := 0
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeLog(fmt.Sprint("Older entries: ", r))
					crashReport("day_pull", r)
				}
			}()
			n = pullTurn()
			pullAfterTurn(n)
		}()
		if n == 0 {
			sleepOrStop(2 * time.Second)
		} else {
			sleepOrStop(500 * time.Millisecond)
		}
	}
}

// at night, the listed days done: FinCom is asked for the next ones now (an early beat, at most one every
// DayPullNightBeatSec), so the period is read day after day; by day the beat keeps its own time
func pullAfterTurn(sent int) {
	if sent > 0 || !pullNight() || pullCurrent() != nil {
		return
	}
	pull.mu.Lock()
	due := nowFn().Sub(pull.beatAt) >= time.Duration(pullNightBeatSec())*time.Second || nowFn().Before(pull.beatAt)
	if due {
		pull.beatAt = nowFn()
	}
	pull.mu.Unlock()
	if !due {
		return
	}
	select {
	case beatNow <- struct{}{}:
	default:
	}
}

// one turn: the requests sent to Tally
func pullTurn() int {
	if !cloudOn() {
		return 0
	}
	pullTellAgain()
	sent := 0
	for i := 0; i < pullPerTurn()*2 && sent < pullPerTurn(); i++ {
		s, more := pullStep()
		if s {
			sent++
			if g := pullGapMs(); g > 0 {
				keepRest(time.Duration(g) * time.Millisecond)
			}
		}
		if !more {
			break
		}
	}
	return sent
}

// the day being read now (the first listed not finished here), or nil
func pullCurrent() *pullWork {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if pull.work != nil {
		return pull.work
	}
	for _, it := range pull.items {
		if _, d := pull.done[it.key()]; d {
			continue
		}
		if _, up := pull.upload[it.key()]; up {
			continue
		}
		pull.work = &pullWork{it: it, heads: map[string]pullHead{}, stops: map[string]int{}}
		return pull.work
	}
	return nil
}

// one step: sent (a request reached the gate to Tally), more (another step may follow now)
func pullStep() (bool, bool) {
	w := pullCurrent()
	if w == nil {
		return false, false
	}
	if nowFn().Before(w.cloudWait) {
		return false, false
	}
	switch {
	case !w.headsDone:
		port, why := pullMayAsk(w.it)
		if why != "" {
			pullSayWait(w.it, why)
			return false, false
		}
		return pullHeadsStep(w, port)
	case !w.sentHeads:
		return false, pullSendHeads(w)
	case len(w.want) > 0:
		if len(w.got)+len(w.gone) >= pullFlushAt() || pullGotBytes(w) >= 4<<20 {
			return false, pullFlush(w)
		}
		port, why := pullMayAsk(w.it)
		if why != "" {
			w.coAt = time.Time{} // ROUND 104 (a): after any wait the company list is asked again before the next entry
			pullSayWait(w.it, why)
			if len(w.got)+len(w.gone) > 0 {
				pullFlush(w) // what was read goes now (the cloud only)
			}
			return false, false
		}
		return pullFetchStep(w, port)
	case len(w.got)+len(w.gone) > 0:
		return false, pullFlush(w)
	case w.paySkip > 0:
		// review 245 R15 (M1): what was read is sent; the payroll entries left out: the day to be uploaded (one quiet line)
		pullMarkUpload(w, "payroll", "")
		return false, true
	}
	pullFinish(w, "")
	return false, true
}

// F1, else (after a stop) F2 for the next type
func pullHeadsStep(w *pullWork, port int) (bool, bool) {
	it := w.it
	x, form := dayHeadsRequest(it.Company, it.Day), "one day (yyyymmdd TYPE=Date)"
	typ := ""
	if w.split {
		typ = it.types()[w.typeIdx]
		x, form = dayHeadsTypeRequest(it.Company, it.Day, typ), "one day, the voucher type "+typ+" (d-MMM-yyyy TYPE=Date and the date filter)"
	}
	pull.mu.Lock()
	pull.lastAsk = nowFn()
	pull.mu.Unlock()
	// ROUND 103 (1b): Tally's window watched while the request is at Tally (from its send: the wait for the lock not counted)
	held := windowHoldFn()
	var took float64
	htc := recorderTC(func(sec float64) { took += sec })
	htc.gentleMs = pullGentleMs() // ROUND 104 (b): the night's shorter rest before the send
	raw, err := invokeTally(htc, port, x, 5)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	if took == 0 {
		holdMs = 0 // nothing reached Tally
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	_ = typ
	switch {
	case gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped) || errors.Is(err, errDayHeadsRefused):
		return false, false // nothing reached Tally; the day waits
	case errors.Is(err, errRecorderStop):
		// ROUND 103 (1b, the owner's freeze safety): a day's list over 2 s stops reading older entries of this company;
		// the days still missing are to be uploaded by hand (one quiet line); never asked again by itself
		pullStopCompany(w, "over2s", form)
		return true, false
	case holdMs >= 2000:
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s", float64(holdMs)/1000))
		return true, false
	case err == nil:
	default:
		// not answered (Tally closed, reset), refused or an answer that could not be read: the day stays pending and is
		// asked again after the shared retry schedule; nothing is shown
		w.fails++
		liveSayOnce("pull|err|"+it.key(), fmt.Sprintf("Older entries of %s: %s was not read (%s); asked again later", it.Company, liveDay(it.Day), cutRunes(err.Error(), 160)))
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, false
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		w.fails++
		liveSayOnce("pull|unread|"+it.key(), "Older entries of "+it.Company+": Tally's answer for "+liveDay(it.Day)+" could not be read; asked again later")
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, false
	}
	rows, bad := pullRowsOf(raw, it.Day)
	raw = ""
	if bad != "" {
		pull.mu.Lock()
		pull.stopped[port] = "an entry of " + liveDay(bad) + " came for " + liveDay(it.Day)
		pull.mu.Unlock()
		writeLog(fmt.Sprintf("Older entries of %s: Tally answered the request for %s (%s, FinComDayHeads) with an entry dated %s: the date was not applied. The answer is dropped, nothing is stored or sent, and no single day is asked of this Tally until the bridge restarts", it.Company, liveDay(it.Day), form, liveDay(bad)))
		pullMarkUpload(w, "dates", "")
		return true, false
	}
	for _, h := range rows {
		if len(w.heads) >= pullHeadsMax() {
			pullMarkUpload(w, "toomany", "")
			return true, false
		}
		w.heads[h.Mid] = h
	}
	w.fails = 0
	if !w.split {
		w.headsDone = true
	} else if w.typeIdx++; w.typeIdx >= len(it.types()) {
		w.headsDone = true
	}
	if w.headsDone {
		w.warmAt = nowFn()
	}
	pullNote(it, "heads", w)
	return true, w.headsDone
}

// the heads to FinCom: its count of the day; in the fetch phase it answers the MasterIDs it lacks
func pullSendHeads(w *pullWork) bool {
	it := w.it
	mids := make([]string, 0, len(w.heads))
	for m := range w.heads {
		mids = append(mids, m)
	}
	sort.Slice(mids, func(a, b int) bool { return toI64(mids[a]) < toI64(mids[b]) })
	rows := make([]any, 0, len(mids))
	for _, m := range mids {
		h := w.heads[m]
		rows = append(rows, []any{h.GUID, toI64(h.Mid), h.Alter, h.Type})
	}
	via := "day"
	if w.split {
		via = "split"
	}
	r := invokeCloud(M{"kind": "period_heads", "company": it.Company, "company_guid": it.CGUID, "day": it.Day, "via": via, "n": len(rows), "heads": rows, "fetch": it.Fetch}, 60)
	if !pullCloudOK(w, r, "the day's list") {
		return false
	}
	w.sentHeads = true
	if it.Fetch {
		for _, x := range arr(r.json["want"]) {
			m := onlyDigits(str(x))
			if _, ok := w.heads[m]; ok && !contains(w.want, m) {
				w.want = append(w.want, m)
			}
		}
	}
	writeLog(fmt.Sprintf("Older entries of %s: %s: Tally lists %d entr%s (%s); FinCom lacks %d", it.Company, liveDay(it.Day), len(rows), map[bool]string{true: "y", false: "ies"}[len(rows) == 1], via, len(w.want)))
	pullNote(it, "fetch", w)
	return true
}

// a cloud answer taken; else the day waits (the cloud's queue keeps it)
var rePullRefusedRead = regexp.MustCompile(`another date|larger than FinCom takes`)

func pullCloudOK(w *pullWork, r cloudResp, what string) bool {
	if r.code == 200 && r.json != nil && truthy(r.json["ok"]) {
		return true
	}
	w.cloudWait = nowFn().Add(pullWait())
	why := or(r.err, fmt.Sprint("HTTP ", r.code))
	if r.json != nil && str(r.json["error"]) != "" {
		why += ": " + str(r.json["error"])
	}
	liveSayOnce("pull|cloud|"+w.it.key(), "Older entries of "+w.it.Company+": FinCom did not take "+what+" of "+liveDay(w.it.Day)+" ("+cutRunes(why, 160)+"); sent again later")
	if r.code == 413 || (r.code == 400 && r.json != nil && rePullRefusedRead.MatchString(str(r.json["error"]))) {
		// refused for what was read (an entry too large, another date): the same would be read again; to be uploaded
		pullMarkUpload(w, "shape", "")
		return false
	}
	if (r.code >= 400 && r.code < 500 && r.code != 429) || (r.code == 200 && r.json != nil) {
		// refused (no longer wanted, paused, another choice, too large, not linked): left, nothing more asked of Tally for
		// it; FinCom lists it again if it still wants it (review 245 R3: never the same refused body for ever)
		pullDrop(w)
	}
	return false
}

// one entry FinCom lacks, by FinComVoucherObject (unchanged; after the company list, as 2.3.4 asks it)
func pullFetchStep(w *pullWork, port int) (bool, bool) {
	it := w.it
	// 2.4.9 (the owner's approval of 29-Oct-2026): up to 100 of the day's wanted entries in one request (batch249.go);
	// payroll entries, a day read by type, and a day gone one by one: one entry a request as below
	if handled, sent, more := pullBatchStep(w, port); handled {
		return sent, more
	}
	mid := w.want[0]
	// ROUND 103 (B, the owner's decision of 12-Oct-2026 kept for older days): a payroll voucher (its type as Tally's list of
	// the day names it: Tally's own Payroll, or a type this bridge has seen carrying employees' pay heads) goes through the
	// payroll path: its employees read and taken by FinCom first, its entry request stopped at 3 s and its window watched
	// against 3 s; every other entry 2 s
	pay := payrollEntry(it.Company, w.heads[mid].Type)
	if pay && !pullEmpReady(it) {
		// review 245 R15 (M1): the day's other entries first, while the payroll's employees are not in FinCom yet
		for i := 1; i < len(w.want); i++ {
			if !payrollEntry(it.Company, w.heads[w.want[i]].Type) {
				w.want[0], w.want[i] = w.want[i], w.want[0]
				return false, true
			}
		}
		sent, more := pullEmployeesStep(w, port)
		pull.mu.Lock()
		still := pull.work == w
		pull.mu.Unlock()
		if !more && still && len(w.got)+len(w.gone) > 0 {
			pullFlush(w) // the day waits for the employees: what was read goes now (the cloud only)
		}
		return sent, more
	}
	tc := recorderTC(nil)
	var took float64
	tc.timed = func(sec float64) { took += sec }
	tc = entryTC(tc, it.Company, w.heads[mid].Type)
	tc.gentleMs = pullGentleMs() // ROUND 104 (b): the night's shorter rest before the send (entryTC gives a copy or tc)
	limit := recorderLimitMs()
	if pay {
		limit = tc.limitMs
	}
	// ROUND 104 (a): Tally's company list asked once for the day (and again after any error, wait, use of the computer,
	// save in Tally or 10 minutes), not before every entry
	listed := pullCoListed(w, port)
	held := windowHoldFn()
	got, err := fetchVouchersByMasterListed(tc, it.Company, port, it.Day, []string{mid}, liveBodySec(), listed)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	if took == 0 {
		holdMs = 0
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	if err != nil || holdMs >= limit {
		w.coAt = time.Time{}
	} else if !listed {
		w.coAt, w.coReal, w.coPort = nowFn(), time.Now(), port // the list named the company just now (asked in the call)
	}
	switch {
	case errors.Is(err, errRetryWait) || gaveWay(err) || errors.Is(err, errReadStopped):
		return false, false
	case errors.Is(err, errSlowCompany):
		pullDrop(w) // marked slow meanwhile: not asked (the company's rule, slowco.go)
		return true, false
	case errors.Is(err, errRecorderStop):
		// ROUND 103 (1b, review): an entry's request over 2 s stops the period too (the freeze safety covers every
		// request of it, not only the day's list)
		pullStopCompany(w, "over2s", "the entry with MasterID "+mid)
		return true, false
	case holdMs >= limit:
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while the entry with MasterID %s was read", float64(holdMs)/1000, mid))
		return true, false
	case err == nil:
	case errors.Is(err, errFastShape):
		pullMarkUpload(w, "shape", "")
		return true, false
	default:
		w.fails++
		liveSayOnce("pull|fetch|"+it.key(), fmt.Sprintf("Older entries of %s: an entry of %s was not read (%s); asked again later", it.Company, liveDay(it.Day), cutRunes(err.Error(), 160)))
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, false
	}
	w.asked++
	w.fails = 0
	w.want = w.want[1:]
	x := got[mid]
	h := w.heads[mid]
	switch {
	case x == "":
		w.gone = append(w.gone, mid) // Tally no longer has it
	case normDate(tagValue(x, "DATE")) != it.Day || !strings.EqualFold(strings.TrimSpace(tagValue(x, "GUID")), h.GUID):
		// moved to another day, or not the entry the day's list named: not sent; the day is counted again on its next turn
		writeLog(fmt.Sprintf("Older entries of %s: the entry with MasterID %s is no longer of %s in Tally; not sent (the day is counted again)", it.Company, mid, liveDay(it.Day)))
	default:
		w.got = append(w.got, x)
	}
	pullNote(it, "fetch", w)
	return true, true
}

// payroll (ROUND 103, B): the company's employees (FinComEmployees, 2.4.4's read) read and taken by FinCom before the first
// payroll entry of the period, so the entry's employee rows link. Taken for the day's own company GUID (review 245 R15,
// L2), looked at again after 10 minutes (the master counter may have moved)
func pullEmpKey(it pullItem) string { return companyKey(it.Company) + "|" + strings.ToLower(it.CGUID) }

func pullEmpReady(it pullItem) bool {
	pull.mu.Lock()
	at, ok := pull.empAt[pullEmpKey(it)]
	pull.mu.Unlock()
	return ok && nowFn().Sub(at) < 10*time.Minute && !nowFn().Before(at)
}

// review 245 R15 (M2): one step of the employees' read inside the period fetch: at most ONE request to Tally (the six
// conditions, pause and read-stop were looked at just before, by pullStep), Tally's window watched; a request over its
// 2 s stop or a window held 2 s or more stops the company (never asked again by itself). (M1): the wait is bounded: a try
// that does not get them (FinCom did not take them, nothing could be asked, a request not answered) counts; after
// EmployeeWaitTries tries or EmployeeWaitMin minutes the day's payroll entries are left out (pullPayrollGiveUp)
func pullEmployeesStep(w *pullWork, port int) (bool, bool) {
	it := w.it
	if w.empSince.IsZero() {
		w.empSince = nowFn()
	}
	if nowFn().Sub(w.empSince) >= pullEmpWait() {
		pullPayrollGiveUp(w, fmt.Sprintf("waited %d minutes", int(pullEmpWait().Minutes())))
		return false, true
	}
	if nowFn().Before(w.empNext) {
		pullSayWait(it, "the payroll's employees are read first (FinComEmployees), then its payroll entries")
		return false, false
	}
	var holdMs int
	ask := func(port int, x string) (string, error) {
		held := windowHoldFn()
		var took float64
		raw, err := invokeTally(recorderTC(func(sec float64) { took += sec }), port, x, empSec())
		holdMs = held(time.Now().Add(-time.Duration(took * float64(time.Second))))
		if took == 0 {
			holdMs = 0
		}
		pullNoteWatched(holdMs)
		return raw, err
	}
	_, reqs, err := employeesCheckWith(it.Company, port, empOpt{guid: it.CGUID, port: port, maxReqs: 1, ask: ask})
	switch {
	case errors.Is(err, errRecorderStop):
		pullStopCompany(w, "over2s", "the payroll's employees")
		return true, false
	case holdMs >= recorderLimitMs():
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while the payroll's employees were read", float64(holdMs)/1000))
		return true, false
	case reqs == 0 && (gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped)):
		return false, false // nothing reached Tally; the day waits
	case err != nil && !gaveWay(err):
		writeLog("Older entries of " + it.Company + ": the payroll's employees: " + cutRunes(err.Error(), 200))
	}
	if employeesTakenFor(it.Company, it.CGUID) {
		pull.mu.Lock()
		pull.empAt[pullEmpKey(it)] = nowFn()
		pull.mu.Unlock()
		w.empTries, w.empSince, w.empNext = 0, time.Time{}, time.Time{}
		return reqs > 0, true
	}
	if reqs > 0 && err == nil && empReading(it.Company, it.CGUID) {
		pullNote(it, "employees", w)
		return true, true // read on at the next step (its conditions looked at again)
	}
	w.empTries++
	if w.empTries >= pullEmpTries() {
		pullPayrollGiveUp(w, fmt.Sprintf("%d tries", w.empTries))
		return reqs > 0, true
	}
	w.empNext = nowFn().Add(time.Minute)
	pullSayWait(it, "the payroll's employees are read first (FinComEmployees), then its payroll entries")
	return reqs > 0, false
}

// the employees' read of the company (that GUID) is under way (read in part)
func empReading(company, guid string) bool {
	_, g := empGUIDFor(company, guid)
	if g == "" {
		return false
	}
	empReadMu.Lock()
	defer empReadMu.Unlock()
	return empReads[companyKey(company)+"|"+g] != nil
}

// review 245 R15 (M1): the payroll entries of the day are left out (their employees did not reach FinCom); the rest of the
// day goes on, and the day is then marked "upload" with words naming the payroll
func pullPayrollGiveUp(w *pullWork, how string) {
	var keep []string
	for _, m := range w.want {
		if payrollEntry(w.it.Company, w.heads[m].Type) {
			w.paySkip++
		} else {
			keep = append(keep, m)
		}
	}
	w.want = keep
	writeLog(fmt.Sprintf("Older entries of %s: %s: the payroll's employees did not reach FinCom (%s): %d payroll entr%s of the day not asked; the day's Day Book is to be uploaded", w.it.Company, liveDay(w.it.Day), how, w.paySkip, map[bool]string{true: "y", false: "ies"}[w.paySkip == 1]))
}

// the size of the entries read and not sent (review 245 R3: a batch stays far below the cloud's body limit)
func pullGotBytes(w *pullWork) int {
	n := 0
	for _, x := range w.got {
		n += len(x)
	}
	return n
}

// the entries read go to FinCom (period_entries); taken: they are not sent again
func pullFlush(w *pullWork) bool {
	if len(w.got) == 0 && len(w.gone) == 0 {
		return true
	}
	it := w.it
	// 2.4.9 review R1-3: a body of at most DayPullBatch entries and 4 MB (one entry over it at most), the rest in the next
	// (a group adds up to 100 entries at once)
	n, size := 0, 0
	for n < len(w.got) && n < pullFlushAt() && (n == 0 || size+len(w.got[n]) <= 4<<20) {
		size += len(w.got[n])
		n++
	}
	vs := make([]any, 0, n)
	for _, x := range w.got[:n] {
		vs = append(vs, x)
	}
	r := invokeCloud(M{"kind": "period_entries", "company": it.Company, "company_guid": it.CGUID, "day": it.Day, "vouchers": vs, "gone": toAny(w.gone), "full": true}, 120)
	if !pullCloudOK(w, r, "the entries") {
		return false
	}
	writeLog(fmt.Sprintf("Older entries of %s: %s: %d entr%s sent to FinCom%s", it.Company, liveDay(it.Day), n, map[bool]string{true: "y", false: "ies"}[n == 1],
		map[bool]string{true: fmt.Sprintf(" (%d no longer in Tally)", len(w.gone)), false: ""}[len(w.gone) > 0]))
	w.got, w.gone = append([]string(nil), w.got[n:]...), nil
	// an entry whose lines did not total zero was not taken: FinCom marked the day to be uploaded by hand (its words)
	if words := str(r.json["upload"]); words != "" {
		pullNoteUpload(it, "entries", words)
		pullFinish(w, "upload")
		return false
	}
	return true
}

// a day FinCom marked to be uploaded by hand: kept here for the tray's one quiet line (FinCom was told already)
func pullNoteUpload(it pullItem, why, words string) {
	pull.mu.Lock()
	pull.upload[it.key()] = M{"company": it.Company, "day": it.Day, "words": cutRunes(words, 300), "why": why, "at": nowFn().Format(time.RFC3339), "atN": nowFn().UnixNano()}
	// at most 500 kept (the oldest dropped from the tray's list first; FinCom keeps every one)
	for len(pull.upload) > 500 {
		ok, oldest := "", int64(-1)
		for k, v := range pull.upload {
			if a := toI64(v["atN"]); oldest < 0 || a < oldest {
				ok, oldest = k, a
			}
		}
		delete(pull.upload, ok)
	}
	pullSaveLocked()
	pull.mu.Unlock()
	writeLog("Older entries of " + it.Company + ": " + liveDay(it.Day) + " is not asked again (" + why + "): " + words)
}

// ROUND 103 (1b): reading older entries of the company stops: FinCom is told (period_stop: no day of the period is listed
// again until the person chooses again) and keeps one quiet line; here, no day of the company is asked again unless
// FinCom lists it under a newer choice (chosenAt after the stop). Told again until FinCom takes it (pullTell)
func pullStopCompany(w *pullWork, why, what string) {
	it := w.it
	words := "Tally took too long to give " + liveDay(it.Day) + ", so FinCom stopped reading older entries of " + it.Company + ". Please upload the Day Book for the days still missing."
	if why == "window" {
		words = "Tally stopped answering while FinCom read " + liveDay(it.Day) + ", so FinCom stopped reading older entries of " + it.Company + ". Please upload the Day Book for the days still missing."
	}
	writeLog(fmt.Sprintf("Older entries of %s: stopped at %s (%s): nothing more is asked of Tally for the period; FinCom shows one line to upload the Day Book of the days still missing", it.Company, liveDay(it.Day), what))
	pull.mu.Lock()
	pull.stopCo[companyKey(it.Company)] = M{"company": it.Company, "day": it.Day, "why": why, "words": words, "at": nowFn().Format(time.RFC3339), "atN": nowFn().UnixNano(), "chosenAt": it.ChosenAt}
	var keep []pullItem
	for _, x := range pull.items {
		if companyKey(x.Company) != companyKey(it.Company) {
			keep = append(keep, x)
		}
	}
	pull.items = keep
	pullSaveLocked()
	pull.mu.Unlock()
	pullFinish(w, "stopped")
	pullTell("stop|"+companyKey(it.Company), M{"kind": "period_stop", "company": it.Company, "company_guid": it.CGUID, "day": it.Day, "why": why, "words": words, "chosenAt": it.ChosenAt})
}

// the day's turn ends: the cloud's next answer says whether it is done
func pullFinish(w *pullWork, how string) {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if pull.work == w {
		pull.work = nil
	}
	pull.done[w.it.key()] = nowFn()
	st := pull.state[companyKey(w.it.Company)]
	if st != nil {
		st["phase"] = or(how, "sent")
	}
}

// the day left for now (the cloud lists it again)
func pullDrop(w *pullWork) { pullFinish(w, "waiting") }

// the day marked "upload": FinCom is told (it never lists the day again) and the person sees one quiet line, once
func pullMarkUpload(w *pullWork, why, typ string) {
	it := w.it
	words := "Tally took too long to give " + liveDay(it.Day) + ". Please upload that day's Day Book."
	if why == "payroll" {
		words = "FinCom could not read the payroll entries of " + liveDay(it.Day) + " from Tally (the payroll's employees did not reach FinCom). Please upload that day's Day Book."
	} else if why != "over2s" {
		words = "FinCom could not read " + liveDay(it.Day) + " from Tally. Please upload that day's Day Book."
	}
	body := M{"kind": "period_heads", "company": it.Company, "company_guid": it.CGUID, "day": it.Day, "upload": true, "why": why, "type": typ, "words": words}
	pullNoteUpload(it, why+map[bool]string{true: ", type " + typ, false: ""}[typ != ""], words)
	pullFinish(w, "upload")
	pullTell(it.key(), body)
}

// FinCom told that a day is to be uploaded: until it takes it (an answer 200 with ok), told again at most once a minute
// from the loop (review 245 R1: else FinCom kept listing the day and the year's count never ended). Nothing is asked of Tally.
func pullTell(key string, body M) {
	r := invokeCloud(body, 10)
	if r.code == 200 && r.json != nil && truthy(r.json["ok"]) {
		pull.mu.Lock()
		delete(pull.tell, key)
		pullSaveLocked()
		pull.mu.Unlock()
		return
	}
	pull.mu.Lock()
	pull.tell[key] = M{"body": body, "at": nowFn()}
	pullSaveLocked()
	pull.mu.Unlock()
	liveSayOnce("pull|upcloud|"+key, "Older entries of "+str(body["company"])+": FinCom was not told that "+liveDay(str(body["day"]))+" is to be uploaded; it is told again later")
}

// in the background, one at a time (review 245 R2: an unreachable cloud never holds the day reads)
var pullTelling atomic.Bool

func pullTellAgain() {
	if !pullTelling.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer pullTelling.Store(false)
		pullTellDue()
	}()
}

func pullTellDue() {
	pull.mu.Lock()
	var due []string
	var bodies []M
	for k, v := range pull.tell {
		if t, ok := v["at"].(time.Time); !ok || nowFn().Sub(t) >= time.Minute {
			due, bodies = append(due, k), append(bodies, obj(v["body"]))
		}
	}
	pull.mu.Unlock()
	for i, k := range due {
		pullTell(k, bodies[i])
	}
}

// the days to upload and those FinCom has not taken yet, kept on disk (review 245 R2: a restart never asks such a day of
// Tally again)
func pullFile() string { return sp("period-upload.json") }

// a snapshot taken under the lock; written to disk after it is let go (review 245 R3: no disk write while holding the lock
// the request gate reads), in order (pullSaveMu)
// stopped for this company, unless FinCom lists the day under a choice made after the stop (the person chose again)
func pullStoppedFor(company, chosenAt string) bool {
	pull.mu.Lock()
	st := pull.stopCo[companyKey(company)]
	pull.mu.Unlock()
	if st == nil {
		return false
	}
	// a different choice than the one stopped (FinCom's own time of the choice, compared as FinCom gives it: no clock of
	// this computer is involved); the stop of the old choice is not told again
	if chosenAt != "" && chosenAt != str(st["chosenAt"]) {
		pull.mu.Lock()
		delete(pull.stopCo, companyKey(company))
		delete(pull.tell, "stop|"+companyKey(company))
		pullSaveLocked()
		pull.mu.Unlock()
		writeLog("Older entries of " + company + ": chosen again in FinCom after the stop; read again, one day at a time")
		return false
	}
	return true
}

func pullSaveLocked() {
	tell := M{}
	for k, v := range pull.tell {
		tell[k] = obj(v["body"])
	}
	up := M{}
	for k, v := range pull.upload {
		up[k] = v
	}
	stop := M{}
	for k, v := range pull.stopCo {
		stop[k] = v
	}
	pullSaveText.Store(jsonText(M{"upload": up, "tell": tell, "stop": stop}))
	go pullSaveNow()
}

var (
	pullSaveText atomic.Value
	pullSaveMu   sync.Mutex
)

func pullSaveNow() {
	pullSaveMu.Lock()
	defer pullSaveMu.Unlock()
	if t, ok := pullSaveText.Load().(string); ok && t != "" {
		_ = saveFile(pullFile(), t)
		pullSaveText.CompareAndSwap(t, "") // a newer snapshot stored meanwhile stays, for its own write
	}
}

func pullLoad() {
	j := readObjFile(pullFile())
	if j == nil {
		return
	}
	pull.mu.Lock()
	defer pull.mu.Unlock()
	for k, v := range obj(j["upload"]) {
		if e := obj(v); e != nil {
			pull.upload[k] = e
		}
	}
	for k, v := range obj(j["tell"]) {
		if b := obj(v); b != nil {
			pull.tell[k] = M{"body": b, "at": time.Time{}}
		}
	}
	for k, v := range obj(j["stop"]) {
		if e := obj(v); e != nil {
			pull.stopCo[k] = e
		}
	}
}

// --- for the beat and the tray
func pullBeat() M {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	cos := M{}
	for k, v := range pull.state {
		cos[k] = v
	}
	stopped := []any{}
	for p, why := range pull.stopped {
		stopped = append(stopped, M{"port": p, "why": why})
	}
	stopCo := []any{}
	for _, v := range pull.stopCo {
		stopCo = append(stopCo, v)
	}
	return M{"companies": cos, "uploadDays": pullUploadListLocked(), "stopped": stopped, "stoppedCompanies": stopCo}
}

func pullUploadList() []any {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return pullUploadListLocked()
}

func pullUploadListLocked() []any {
	var ks []string
	for k := range pull.upload {
		ks = append(ks, k)
	}
	// the newest last (review 245 R1: the 50 kept are the latest marked, of every company)
	sort.Slice(ks, func(a, b int) bool {
		x, y := toI64(pull.upload[ks[a]]["atN"]), toI64(pull.upload[ks[b]]["atN"])
		if x != y {
			return x < y
		}
		return ks[a] < ks[b]
	})
	out := []any{}
	for _, k := range ks {
		out = append(out, pull.upload[k])
	}
	if len(out) > 50 {
		out = out[len(out)-50:]
	}
	return out
}

// ROUND 103 (1b): started just before a request goes to Tally; the function it gives back stops the probe and says how
// long, at most, Tally's window did not answer (ms) while the request was at Tally. Windows: WM_NULL sent to each visible
// window of this user's tally.exe every 200 ms with a 250 ms limit (SendMessageTimeout, SMTO_ABORTIFHUNG); nothing is
// sent to Tally's port. Elsewhere: the tests' stand-in
var windowHoldFn = platWindowHold

// a spell of Tally's window not answering
type spell struct{ a, z time.Time }

// the longest spell (ms) after from (the moment the request was sent: the wait for Tally's lock is not counted)
func worstSpellFrom(sp []spell, from time.Time) int {
	worst := 0
	for _, x := range sp {
		a := x.a
		if a.Before(from) {
			a = from
		}
		if ms := int(x.z.Sub(a).Milliseconds()); ms > worst {
			worst = ms
		}
	}
	return worst
}

// ROUND 103 (1b): the companies whose older entries are stopped, for the tray's one quiet notice each
func pullStoppedList() []any {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	out := []any{}
	for _, v := range pull.stopCo {
		out = append(out, v)
	}
	return out
}

// --- ROUND 104 (the owner's choice (a) of 22-Oct-2026: g10 of the real-Tally gate 39647340380, about 165 entries a
// minute). No request added or changed; one in flight, postings first, the 2 s stop (3 s a payroll entry) and the
// freeze safety as before
var (
	pullIdleFn     = platIdleSec       // seconds since the person last used this computer (the tests replace it)
	pullRespondsFn = platTallyResponds // a fresh look at Tally's window (the tests replace it)
	pullSavedFn    = pullLastSave      // the last save in Tally for the company (its recorder file), zero when none
)

func pullCoListSec() int { return maxI(60, minI(keepNum("DayPullCompanyListSec", 600), 600)) }

func pullLastSave(it pullItem) time.Time {
	if _, last := recorderHolding(it.Company, it.CGUID); last != "" {
		if t, err := time.ParseInLocation("2006-01-02T15:04:05", last, time.Local); err == nil {
			return t
		}
	}
	return time.Time{}
}

// (a) Tally's company list on this port named the company for the day being read and still stands: asked under 10
// minutes ago (DayPullCompanyListSec, never more), on the same port, with no error and no wait since (both clear coAt),
// nobody using the computer since and no save in Tally for the company since. Anything else: asked again before the
// entry (the crash guard of 2.3.4: an object export naming a company that is not open stops Tally)
func pullCoListed(w *pullWork, port int) bool {
	if w == nil || w.coAt.IsZero() || w.coReal.IsZero() || w.coPort != port {
		return false
	}
	lim := time.Duration(pullCoListSec()) * time.Second
	if d := nowFn().Sub(w.coAt); d < 0 || d >= lim {
		return false
	}
	since := time.Since(w.coReal)
	if since < 0 || since >= lim {
		return false
	}
	if idle := pullIdleFn(); idle >= 99999 || idle < since.Seconds() {
		// the keyboard or mouse used since the list was asked (a company may have been closed), or not known here (the
		// bridge as a service with no tray to tell it): asked again
		return false
	}
	if s := pullSavedFn(w.it); !s.IsZero() && !s.Before(w.coReal.Add(-time.Second)) {
		return false // a save in Tally for the company since (its file's time is to the second)
	}
	return true
}

// (b) at night (FinCom's periodNight) the period's requests rest DayPullNightGentleMs (100 ms, at least 50) before the
// send instead of GentleMs; 0 (the setting's) by day or when GentleMs is not longer
func pullGentleMs() int {
	if !pullNight() {
		return 0
	}
	g := maxI(50, keepNum("DayPullNightGentleMs", 100))
	if g >= toInt(cfg("GentleMs")) {
		return 0
	}
	return g
}

// (b) the window look before a step: at night, the probe of the period request just answered (Tally's window watched to
// that request's end, never 250 ms without answering) stands for it for 2 s; else a fresh look
func pullWindowOK() bool {
	if tallyNotResponding.Load() {
		return false
	}
	if pullNight() {
		pull.mu.Lock()
		at, hold := pull.lookAt, pull.lookHold
		pull.mu.Unlock()
		if !at.IsZero() && hold >= 0 && hold < 250 && time.Since(at) >= 0 && time.Since(at) < 2*time.Second {
			return true
		}
	}
	return pullRespondsFn()
}

func pullNoteLook(ok bool, holdMs int) {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if ok && holdMs >= 0 && holdMs < 250 {
		pull.lookAt, pull.lookHold = time.Now(), holdMs
		return
	}
	pull.lookAt, pull.lookHold = time.Time{}, -1
}

// ROUND 103 (review): Tally's window could not be watched (no window of Tally seen: the bridge as a Windows service, in
// session 0): said once in the log; the 2 s stop of every request still holds
func pullNoteWatched(holdMs int) {
	if holdMs < 0 {
		liveSayOnce("pull|nowatch", "Older entries: Tally's window cannot be watched from here (no window of Tally seen, e.g. the bridge runs as a Windows service); the 2 s stop of every request still applies")
	}
}
