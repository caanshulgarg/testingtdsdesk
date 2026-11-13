// FinCom Bridge 2.5.12 (the owner's approval of 09-Nov-2026: "Yes but no missing days at all", "and no hang of Tally at
// all"; the independent review of f1b3e700b, points 1, 2, 4): the older-entries read asks Tally for the day lists
// (FinComDayHeads) of a RANGE of consecutive days FinCom listed in one request, for SPARSE books only. The request is
// FinComDayHeads exactly, its fields and date form, with SVFROMDATE < SVTODATE (2 to 31 days): the only request change
// approved for it. The answer is split by date and each day goes on exactly as today: its own turn, its own period_heads
// (an empty day an empty list), its entries asked as today; tally-ingest is not changed for it.
//
// Only a book shown sparse: a range is asked only after 3 single-day lists of the company in a row, each of 50 entries
// at most and answered in under 300 ms. Its size starts at 3 days; before each range its cost is predicted from the
// days' own times (the slower of the single days' average and the last range's time a day) and the range is cut so the
// prediction stays under 0.8 s. It grows by half (at least a day) only after an answer under 0.5 s, up to 31 days, and
// halves after one over 0.8 s; a day of more than 200 entries ends ranges for the period.
//
// No missing days:
//   - only consecutive days FinCom handed this bridge (pull.items: the same company, GUID, choice, kind), never others;
//   - the first range of each company in each run is a CHECK only: its answer is not used, the same days are read one by
//     one, and each day's GUIDs are compared with the range's; any difference turns ranges off for that company for good
//     (kept in sync\range-off.json, logged); only after the run's check passed are its later ranges used;
//   - a row dated outside the range is the single-day rule's "date not applied": the answer is dropped, the day marked as
//     that rule marks it, and no day is asked of that Tally until the bridge restarts;
//   - an answer cut, in error, not adding up (rows Tally gave not equal to the days' lists) or over the 2 s stop: not
//     used, and NOT a stop of the company: as Tally being busy (the shared retry schedule's wait after a stop, Tally's
//     own end of the request awaited), single days for that company for the rest of this run, logged. Review 2: Tally
//     not finished with a range stopped at 2 s within TallyAbandonWaitSec (or not watchable: TallyAbandonMaxSec 0, when
//     no range is asked at all), or Tally's window held 2 s, stops the company as for one day;
//   - a day's list from a range is used only by that day's turn and only while fresh (DayPullHeadsFreshSec).
//
// No hang: the same gate as one day's list (the six conditions just before, postings first, the typing gate, one request
// in flight, the 2 s stop, Tally's window watched). With FastEntries on (its own window read) no range is asked. A single
// day's list over 2 s still stops the company exactly as before.
package main

import (
	"errors"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var reRangeVchOpen = regexp.MustCompile(`<VOUCHER[\s>]`)

// the allow-list row's words on the range form (allowlist.go FinComDayHeads)
const dayHeadsRangeWords = "; 2.5.12 (the owner's approval of 09-Nov-2026): also the same request for a RANGE of 2 to 31 consecutive days FinCom listed (SVFROMDATE < SVTODATE), only for a book shown sparse (3 single days in a row of 50 entries at most, each under 300 ms), split by day and told to FinCom day by day as before (empty days too); 3 days first, cut so its predicted time stays under 0.8 s, grown by half only after an answer under 0.5 s, halved after one over 0.8 s; each run's first range of a company checked against the same days read one by one (any difference: ranges off for that company for good); an answer over 2 s, cut or not whole: not used, single days for the rest of the run (no stop); a row outside the range: the date not applied, as for one day"

const (
	pullRangeStart     = 3
	pullRangeMaxDays   = 31
	pullRangeGrowMs    = 500 // grow (by half) only below
	pullRangeShrinkMs  = 800 // halve above
	pullRangeBudgetMs  = 800 // a range's predicted time at most
	pullRangeLargeDay  = 200 // a day list this long: single days for the period
	pullRangeSparseN   = 3   // single-day lists in a row that show a sparse book
	pullRangeSparseMax = 50  // rows of such a day at most
	pullRangeSparseMs  = 300 // and its time under
	pullRangeNoneValue = 1
)

type pullRangeDay struct {
	heads []pullHead
	at    time.Time
}

// a run's first range of a company: its days' GUIDs, compared with the same days read one by one
type pullRangeCheck struct {
	company, cguid string
	days           map[string]map[string]bool // day -> GUIDs the range gave
	left           map[string]bool
	at             time.Time
}

var rng = struct {
	mu       sync.Mutex
	sparse   map[string][]int           // per company and choice: the single-day lists in a row that showed it sparse (their ms)
	perDay   map[string]int             // per company and choice: the last range's time a day (ms)
	offRun   map[string]string          // per company and GUID: ranges off for this run, and why
	verified map[string]bool            // per company and GUID: this run's check passed
	check    map[string]*pullRangeCheck // per company and GUID: the check under way
	offSaved M                          // sync\range-off.json, read once
	offBad   bool                       // that file is there but cannot be read: off for every company
}{}

func pullRangeReset() {
	rng.mu.Lock()
	rng.sparse, rng.perDay, rng.offRun, rng.verified, rng.check, rng.offSaved = map[string][]int{}, map[string]int{}, map[string]string{}, map[string]bool{}, map[string]*pullRangeCheck{}, nil
	rng.offBad = false
	rng.mu.Unlock()
}

func init() { pullRangeReset() }

func pullRangeCoKey(it pullItem) string {
	return companyKey(it.Company) + "|" + strings.ToLower(it.CGUID)
}
func pullRangeOffFile() string { return filepath.Join(syncDir(), "range-off.json") }

// under rng.mu: ranges off for good for the company (a check that found a difference)
// review 2 (L4): a file there that cannot be read keeps ranges off for EVERY company (never back on by itself) and is
// never written over (its entries would be lost); logged once
func pullRangeOffLocked(k string) bool {
	if rng.offSaved == nil {
		f := pullRangeOffFile()
		rng.offSaved = readObjFile(f)
		if rng.offSaved == nil {
			rng.offSaved = M{}
			if _, err := os.Stat(f); err == nil {
				rng.offBad = true
				writeLog("Older entries: " + f + " cannot be read; ranges of day lists are off for every company (the file is left as it is)")
			}
		}
	}
	if rng.offBad {
		return true
	}
	_, off := rng.offSaved[k]
	return off
}

func pullRangeOffForGood(it pullItem, why string) {
	k := pullRangeCoKey(it)
	rng.mu.Lock()
	pullRangeOffLocked(k)
	rng.offSaved[k] = M{"company": it.Company, "why": cutRunes(why, 300), "at": nowFn().Format(time.RFC3339)}
	text, bad := jsonText(rng.offSaved), rng.offBad
	delete(rng.check, k)
	rng.mu.Unlock()
	// the old entries kept (read first), written through a temp file and a rename (saveFile); never over an unreadable file
	if bad {
		writeLog("Older entries: " + pullRangeOffFile() + " cannot be read, so it is not written (ranges stay off for every company)")
	} else if err := saveFile(pullRangeOffFile(), text); err != nil {
		writeLog("Older entries: " + pullRangeOffFile() + " could not be written: " + err.Error())
	}
	writeLog(fmt.Sprintf("Older entries of %s: the day lists of a range differ from the same days read one by one (%s); ranges are off for this company for good, its days are read one by one", it.Company, why))
}

func pullRangeOffThisRun(it pullItem, why string) {
	rng.mu.Lock()
	rng.offRun[pullRangeCoKey(it)] = why
	rng.mu.Unlock()
	writeLog(fmt.Sprintf("Older entries of %s: %s; taken as Tally being busy (nothing stopped): its days are read one by one for the rest of this run", it.Company, why))
}

// the range form of F1: the days a..z (2 to 31 days), FinComDayHeads' own fields and date form; "" for anything else
func dayHeadsRangeRequest(company, a, z string) string {
	if !isTallyDate(a) || !isTallyDate(z) || z <= a || tallyDate(fromTallyDate(a)) != a || tallyDate(fromTallyDate(z)) != z || addDays(a, pullRangeMaxDays-1) < z {
		return ""
	}
	return formCollection(dayHeadsID, company, formPlainT, a, z, dayHeadsFetch, "")
}

// the dated guard's exception for the range form (dayHeadsExact): exactly as built, the range being asked now, every day
// of it listed by FinCom for that company now
func dayHeadsRangeExact(x, co, a, z string) bool {
	if x != dayHeadsRangeRequest(co, a, z) {
		return false
	}
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if pull.rangeAsk == "" || x != pull.rangeAsk {
		return false
	}
	for d := a; d <= z; d = addDays(d, 1) {
		ok := false
		for _, it := range pull.items {
			if companyKey(it.Company) == companyKey(co) && it.Day == d {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// the range size for the item's company and choice: 3 at the start of every period (choice), 1 once ranges ended
func pullRangeN(it pullItem) int {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if n := pull.rangeN[pullBatchCoKey(it)]; n > 0 {
		return n
	}
	return pullRangeStart
}

func pullRangeSet(it pullItem, n int) {
	pull.mu.Lock()
	defer pull.mu.Unlock()
	if pull.rangeN == nil {
		pull.rangeN = map[string]int{}
	}
	pull.rangeN[pullBatchCoKey(it)] = n
}

// the next range size after an answer that took ms: by half (at least a day more) under 0.5 s, 31 days at most; halved
// over 0.8 s; else kept
func pullRangeNext(n, ms int) int {
	switch {
	case ms < pullRangeGrowMs:
		return minI(pullRangeMaxDays, maxI(n+1, int(math.Ceil(float64(n)*1.5))))
	case ms > pullRangeShrinkMs:
		return maxI(pullRangeNoneValue, n/2)
	}
	return n
}

// the days a range may hold, from the time a day is predicted to take: the prediction under 0.8 s
func pullRangeCap(n, perDayMs int) int {
	if perDayMs < 1 {
		perDayMs = 1
	}
	return minI(n, pullRangeBudgetMs/perDayMs)
}

// a single day's list answered (pullHeadsStep): the sparse evidence, and this run's check of the company's first range
func pullRangeNoteDay(it pullItem, rows, ms int, heads map[string]pullHead) {
	k, kc := pullBatchCoKey(it), pullRangeCoKey(it)
	rng.mu.Lock()
	if rows <= pullRangeSparseMax && ms < pullRangeSparseMs {
		rng.sparse[k] = append(rng.sparse[k], ms)
		if l := len(rng.sparse[k]); l > 5 {
			rng.sparse[k] = rng.sparse[k][l-5:]
		}
	} else {
		delete(rng.sparse, k)
	}
	c := rng.check[kc]
	var diff string
	passed := false
	if c != nil && c.left[it.Day] {
		got := map[string]bool{}
		for _, h := range heads {
			got[strings.ToLower(h.GUID)] = true
		}
		want := c.days[it.Day]
		if len(got) != len(want) {
			diff = fmt.Sprintf("%s: %d entries one by one, %d in the range", liveDay(it.Day), len(got), len(want))
		} else {
			for g := range got {
				if !want[g] {
					diff = fmt.Sprintf("%s: an entry one by one that the range did not give", liveDay(it.Day))
					break
				}
			}
		}
		delete(c.left, it.Day)
		if diff == "" && len(c.left) == 0 {
			rng.verified[kc] = true
			delete(rng.check, kc)
			passed = true
		}
	}
	rng.mu.Unlock()
	if diff != "" {
		pullRangeOffForGood(it, diff)
	}
	if passed {
		writeLog(fmt.Sprintf("Older entries of %s: the check of a range against the same days read one by one passed; its later ranges are used in this run", it.Company))
	}
}

// a single day's list that did not come (an error, a stop): the evidence starts again
func pullRangeNoteFail(it pullItem) {
	rng.mu.Lock()
	delete(rng.sparse, pullBatchCoKey(it))
	rng.mu.Unlock()
}

// two listed days may share a range: the same company, GUID, choice, kind and reading
func pullRangeSame(a, b pullItem) bool {
	return companyKey(a.Company) == companyKey(b.Company) && strings.EqualFold(a.CGUID, b.CGUID) && a.ChosenAt == b.ChosenAt &&
		a.Fetch == b.Fetch && a.Check == b.Check && a.Kind == b.Kind && strings.Join(a.types(), "\x00") == strings.Join(b.types(), "\x00")
}

// the consecutive days from it.Day on that FinCom listed and this bridge has not finished, n at most (under pull.mu)
func pullRangeDaysLocked(it pullItem, n int) []string {
	days := []string{it.Day}
	for len(days) < n {
		next := addDays(days[len(days)-1], 1)
		found := false
		for _, x := range pull.items {
			if x.Day != next || !pullRangeSame(x, it) {
				continue
			}
			if _, d := pull.done[x.key()]; d {
				break
			}
			if _, up := pull.upload[x.key()]; up {
				break
			}
			if _, had := pull.rangeHeads[x.key()]; had {
				break
			}
			found = true
			break
		}
		if !found {
			break
		}
		days = append(days, next)
	}
	return days
}

// a day's list from an earlier range answer, still fresh: taken (once)
func pullRangeTake(w *pullWork) bool {
	pull.mu.Lock()
	rd, had := pull.rangeHeads[w.it.key()]
	delete(pull.rangeHeads, w.it.key())
	pull.mu.Unlock()
	if !had || nowFn().Before(rd.at) || nowFn().Sub(rd.at) >= pullHeadsFresh() {
		return false
	}
	for _, h := range rd.heads {
		w.heads[h.Mid] = h
	}
	w.headsDone, w.warmAt = true, rd.at
	pullNote(w.it, "heads", w)
	return true
}

// whether a range may be asked for the company now, and the predicted time of a day (ms); why not (for the tests)
func pullRangeMay(it pullItem) (int, string) {
	k, kc := pullBatchCoKey(it), pullRangeCoKey(it)
	rng.mu.Lock()
	defer rng.mu.Unlock()
	if pullRangeOffLocked(kc) {
		return 0, "off for good"
	}
	if why := rng.offRun[kc]; why != "" {
		return 0, "off this run"
	}
	if abandonMax() <= 0 {
		// review 2 (M2): with TallyAbandonMaxSec 0 a request given up at 2 s is closed and Tally's end cannot be watched:
		// no range (a single day's list keeps its own rule)
		return 0, "Tally's end of a request cannot be watched"
	}
	if c := rng.check[kc]; c != nil {
		if nowFn().Sub(c.at) < 15*time.Minute && !nowFn().Before(c.at) {
			return 0, "check under way"
		}
		delete(rng.check, kc) // a check whose days never came: asked again later
	}
	s := rng.sparse[k]
	if len(s) < pullRangeSparseN {
		return 0, "not shown sparse"
	}
	sum := 0
	for _, v := range s {
		sum += v
	}
	per := (sum + len(s) - 1) / len(s)
	if p := rng.perDay[k]; p > per {
		per = p
	}
	return maxI(per, 1), ""
}

// one step of the range read (pullStep, before one day's list): handled false: one day's list as before
func pullRangeStep(w *pullWork, port int) (handled, sent, more bool) {
	it := w.it
	if w.split || w.noRange || fastOn() {
		return false, false, false
	}
	if pullRangeTake(w) {
		return true, false, true
	}
	if !pullTierOK(it, paceRange) {
		return false, false, false // 2.5.16 (daypace2516.go): a range of days is the heavy tier; the day alone goes first
	}
	per, why := pullRangeMay(it)
	if why != "" {
		return false, false, false
	}
	n := pullRangeCap(pullRangeN(it), per)
	if n < 2 {
		return false, false, false
	}
	pull.mu.Lock()
	days := pullRangeDaysLocked(it, minI(n, pullRangeMaxDays))
	pull.mu.Unlock()
	if len(days) < 2 {
		return false, false, false
	}
	a, z := days[0], days[len(days)-1]
	x := dayHeadsRangeRequest(it.Company, a, z)
	if x == "" {
		return false, false, false
	}
	kc := pullRangeCoKey(it)
	rng.mu.Lock()
	checking := !rng.verified[kc]
	rng.mu.Unlock()
	form := fmt.Sprintf("the days %s to %s (%d days, FinComDayHeads, yyyymmdd TYPE=Date)", liveDay(a), liveDay(z), len(days))
	pull.mu.Lock()
	pull.lastAsk, pull.rangeAsk = nowFn(), x
	pull.mu.Unlock()
	held := windowHoldFn()
	var took float64
	htc := recorderTC(func(sec float64) { took += sec })
	htc.gentleMs = pullGentleMs()
	htc.sendYield = pullYield(it, paceRange) // 2.5.16: looked at again right before the send
	raw, err := invokeTally(htc, port, x, 5)
	pull.mu.Lock()
	pull.rangeAsk = ""
	pull.mu.Unlock()
	// the final review (as batch249.go): Tally's end of a range stopped at 2 s awaited FIRST, then the window measured
	// from the send over that wait too, then window -> over2s -> the stop as Tally being busy
	from := time.Now().Add(-time.Duration(took * float64(time.Second)))
	unfinished := false
	if errors.Is(err, errRecorderStop) && took > 0 {
		// not finished within TallyAbandonWaitSec, or its end not watchable: never a second request at Tally
		unfinished = abandonMax() <= 0 || !pullAwaitEarlier(port, abandonWait())
	}
	holdMs := held(from)
	if took == 0 {
		holdMs = 0
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	ms := int(took * 1000)
	if took > 0 && (err == nil || errors.Is(err, errRecorderStop)) {
		paceNote(it.Company, it.CGUID, paceRange, ms, holdMs, err == nil) // 2.5.16 (daypace2516.go)
	}
	busy := func(what string) (bool, bool, bool) {
		// the review's point 1: a range over 2 s (Tally finished it, its window answering) or cut is not a stop of the
		// company; as Tally being busy: single days for the rest of the run
		w.noRange = true
		pullRangeOffThisRun(it, "the day lists of "+form+": "+what)
		return true, took > 0, false
	}
	switch {
	case took == 0 && (gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped) || errors.Is(err, errDayHeadsRefused)):
		return true, false, false // nothing reached Tally; the day waits
	case holdMs >= 2000:
		// review 2 (L3): Tally's window held 2 s stops the company exactly as for one day's list (also when the range was
		// stopped at 2 s, and while Tally finished it)
		pullStopDay(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while %s were read", float64(holdMs)/1000, form))
		return true, true, false
	case unfinished:
		// review 2 (M2): as the group read, Tally had not finished the range it was stopped on: the company's period stops
		pullStopDay(w, "over2s", fmt.Sprintf("the day lists of %s: Tally had not finished them %d s after the 2 s stop (or could not be watched)", form, int(pullAwaitBound(abandonWait()).Seconds())))
		return true, true, false
	case errors.Is(err, errRecorderStop):
		return busy("over the 2-second stop")
	case err != nil:
		return busy("not answered (" + cutRunes(err.Error(), 160) + ")")
	}
	if !strings.Contains(raw, "<ENVELOPE") || !strings.Contains(raw, "</ENVELOPE>") || reTallyLineErr.MatchString(raw) {
		return busy("Tally's answer was cut or could not be read")
	}
	body := reCmpInfo.ReplaceAllString(raw, "")
	raw = ""
	in := map[string]bool{}
	for _, d := range days {
		in[d] = true
	}
	byDay := map[string][]pullHead{}
	blocks := reVchBlock.FindAllString(body, -1)
	if len(blocks) > pullHeadsMax() {
		return busy(fmt.Sprintf("%d rows, more than one read takes", len(blocks)))
	}
	for _, b := range blocks {
		h := pullHead{GUID: cut(strings.TrimSpace(tagValue(b, "GUID")), 100), Mid: strings.TrimLeft(tagNum(b, "MASTERID"), "0"), Alter: toI64(tagNum(b, "ALTERID")),
			Date: normDate(tagValue(b, "DATE")), Type: html.UnescapeString(group(`<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"`, b, 1))}
		if h.Type == "" {
			h.Type = tagValue(b, "VOUCHERTYPENAME")
		}
		if !in[h.Date] {
			// the review's point 4: the single-day rule's "date not applied", as for one day
			// 2.5.16 (the code review's L1): the answer is dropped and the day held 24 hours (daystop2516.go), as for one
			// day's list; single days are never stopped on this Tally for it
			bad := or(h.Date, "no date")
			writeLog(fmt.Sprintf("Older entries of %s: Tally answered the request for %s with an entry dated %s: the date was not applied. The answer is dropped and nothing is stored or sent", it.Company, form, liveDay(bad)))
			w.noRange = true
			pullStopDay(w, "dates", form+": an entry dated "+liveDay(bad))
			return true, true, false
		}
		if h.Mid == "" || h.GUID == "" {
			continue // as for one day's list
		}
		byDay[h.Date] = append(byDay[h.Date], h)
	}
	if len(reRangeVchOpen.FindAllString(body, -1)) != len(blocks) {
		return busy("the rows Tally gave do not add up to the days' lists")
	}
	large := false
	total := 0
	for _, d := range days {
		total += len(byDay[d])
		if len(byDay[d]) > pullRangeLargeDay {
			large = true
		}
	}
	next := pullRangeNext(pullRangeN(it), ms)
	if large {
		next = pullRangeNoneValue
	}
	pullRangeSet(it, next)
	rng.mu.Lock()
	rng.perDay[pullBatchCoKey(it)] = (ms + len(days) - 1) / len(days)
	rng.mu.Unlock()
	now := nowFn()
	if checking {
		// the run's first range of the company: a check only; the same days are read one by one and compared
		c := &pullRangeCheck{company: it.Company, cguid: it.CGUID, days: map[string]map[string]bool{}, left: map[string]bool{}, at: now}
		for _, d := range days {
			c.days[d], c.left[d] = map[string]bool{}, true
			for _, h := range byDay[d] {
				c.days[d][strings.ToLower(h.GUID)] = true
			}
		}
		rng.mu.Lock()
		rng.check[kc] = c
		rng.mu.Unlock()
		w.noRange = true
		writeLog(fmt.Sprintf("Older entries of %s: Tally lists %d entr%s for %s in %d ms; this run's first range is checked: the same days are read one by one and compared before ranges are used",
			it.Company, total, map[bool]string{true: "y", false: "ies"}[total == 1], form, ms))
		return true, true, true
	}
	pull.mu.Lock()
	if pull.rangeHeads == nil {
		pull.rangeHeads = map[string]pullRangeDay{}
	}
	for _, d := range days[1:] {
		x := it
		x.Day = d
		pull.rangeHeads[x.key()] = pullRangeDay{heads: byDay[d], at: now}
	}
	pull.mu.Unlock()
	for _, h := range byDay[it.Day] {
		w.heads[h.Mid] = h
	}
	w.fails, w.headsDone, w.warmAt = 0, true, now
	writeLog(fmt.Sprintf("Older entries of %s: Tally lists %d entr%s for %s in %d ms; each day goes to FinCom on its own (next range %d day%s)%s",
		it.Company, total, map[bool]string{true: "y", false: "ies"}[total == 1], form, ms, next, map[bool]string{true: "", false: "s"}[next == 1],
		map[bool]string{true: "; a day of more than 200 entries: single days for this period", false: ""}[large]))
	pullNote(it, "heads", w)
	return true, true, true
}
