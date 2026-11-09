// FinCom Bridge 2.5.12 (the owner's approval of 09-Nov-2026: "Yes but no missing days at all", "and no hang of Tally at
// all"): the older-entries read asks Tally for the day lists (FinComDayHeads) of a RANGE of consecutive days FinCom
// listed in one request, for sparse books (a book of 420 entries a year needed one request a day). The request is
// FinComDayHeads exactly, its fields and date form, with SVFROMDATE < SVTODATE (2 to 31 days): the only request change
// approved for it. The answer is split by date and each day goes on exactly as today: its own turn, its own period_heads
// (an empty day an empty list), its entries asked as today; tally-ingest is not changed.
//
// No missing days:
//   - a range holds only consecutive days FinCom handed this bridge (pull.items, the same company, GUID, choice and kind;
//     never a day it was not given: days not next to each other are never put together);
//   - its answer is used only when it is whole: an envelope and its end, no Tally error, every row dated inside the
//     range, every row counted into one day (the rows Tally gave = the sum of the days' lists, rows without GUID or
//     MasterID aside as for one day), not more than DayPullHeadsMax rows. Else NOTHING of it is used: each day of the
//     range asks its own list as before (a row dated outside the range is so never dropped: its date is read in its own
//     turn), and later ranges of the company are single days;
//   - each day's list is used only by that day's turn and only while fresh (DayPullHeadsFreshSec, as the group read's
//     rule); an older one is asked again for that day alone.
//
// No hang: the same gate as one day's list (the six conditions just before, postings first, the typing gate, one request
// in flight, the 2 s stop, Tally's window watched). A range starts at 7 days for each company and choice, never above 31;
// it doubles only after an answer under 1 s, halves after one over 1 s; over the 2 s stop, or Tally's window held 2 s,
// the company's period stops exactly as for one day's list (never the same range asked again); a day of more than 200
// entries (a large day list) ends ranges for the company and choice (single days from then on). With FastEntries on
// (its own window read) no range is asked.
package main

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"
)

var reRangeVchOpen = regexp.MustCompile(`<VOUCHER[\s>]`)

const (
	pullRangeStart     = 7
	pullRangeMaxDays   = 31
	pullRangeGrowMs    = 1000 // grow only below
	pullRangeShrinkMs  = 1000 // halve above
	pullRangeLargeDay  = 200  // a day list this long: single days from then on
	pullRangeNoneValue = 1
)

type pullRangeDay struct {
	heads []pullHead
	at    time.Time
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

// the range size for the item's company and choice: 7 at the start of every period (choice), 1 once ranges ended
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

// the next range size after an answer that took ms: doubled under 1 s (31 days at most), halved over 1 s, else kept
func pullRangeNext(n, ms int) int {
	switch {
	case ms < pullRangeGrowMs:
		return minI(n*2, pullRangeMaxDays)
	case ms > pullRangeShrinkMs:
		return maxI(pullRangeNoneValue, n/2)
	}
	return n
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

// one step of the range read (pullStep, before one day's list): handled false: one day's list as before
func pullRangeStep(w *pullWork, port int) (handled, sent, more bool) {
	it := w.it
	if w.split || w.noRange || fastOn() {
		return false, false, false
	}
	if pullRangeTake(w) {
		return true, false, true
	}
	n := pullRangeN(it)
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
	form := fmt.Sprintf("the days %s to %s (%d days, yyyymmdd TYPE=Date)", liveDay(a), liveDay(z), len(days))
	pull.mu.Lock()
	pull.lastAsk, pull.rangeAsk = nowFn(), x
	pull.mu.Unlock()
	held := windowHoldFn()
	var took float64
	htc := recorderTC(func(sec float64) { took += sec })
	htc.gentleMs = pullGentleMs()
	raw, err := invokeTally(htc, port, x, 5)
	pull.mu.Lock()
	pull.rangeAsk = ""
	pull.mu.Unlock()
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	if took == 0 {
		holdMs = 0
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	ms := int(took * 1000)
	single := func(why string) (bool, bool, bool) {
		// nothing of the range used: each of its days asks its own list; the company's later ranges are single days
		w.noRange = true
		pullRangeSet(it, pullRangeNoneValue)
		writeLog(fmt.Sprintf("Older entries of %s: the day lists of %s: %s; not used, each day is asked alone", it.Company, form, why))
		return true, took > 0, true
	}
	switch {
	case gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped) || errors.Is(err, errDayHeadsRefused):
		if took == 0 {
			return true, false, false // nothing reached Tally; the day waits
		}
		return single(cutRunes(err.Error(), 160))
	case errors.Is(err, errRecorderStop):
		// the owner's freeze safety, exactly as for one day's list: the period of the company stops (never asked again)
		pullStopCompany(w, "over2s", form)
		return true, true, false
	case holdMs >= 2000:
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s (%s)", float64(holdMs)/1000, form))
		return true, true, false
	case err != nil:
		return single("not answered (" + cutRunes(err.Error(), 160) + ")")
	}
	if !strings.Contains(raw, "<ENVELOPE") || !strings.Contains(raw, "</ENVELOPE>") || reTallyLineErr.MatchString(raw) {
		return single("Tally's answer was cut or could not be read")
	}
	body := reCmpInfo.ReplaceAllString(raw, "")
	raw = ""
	in := map[string]bool{}
	for _, d := range days {
		in[d] = true
	}
	byDay := map[string][]pullHead{}
	blocks, counted := reVchBlock.FindAllString(body, -1), 0
	if len(blocks) > pullHeadsMax() {
		return single(fmt.Sprintf("%d rows, more than one read takes", len(blocks)))
	}
	for _, b := range blocks {
		h := pullHead{GUID: cut(strings.TrimSpace(tagValue(b, "GUID")), 100), Mid: strings.TrimLeft(tagNum(b, "MASTERID"), "0"), Alter: toI64(tagNum(b, "ALTERID")),
			Date: normDate(tagValue(b, "DATE")), Type: html.UnescapeString(group(`<VOUCHER\b[^>]*\bVCHTYPE="([^"]*)"`, b, 1))}
		if h.Type == "" {
			h.Type = tagValue(b, "VOUCHERTYPENAME")
		}
		if !in[h.Date] {
			// never dropped silently: the range is not used, and that date is read in its own turn
			return single("an entry dated " + or(liveDay(h.Date), "no date") + " came, outside the range")
		}
		counted++
		if h.Mid == "" || h.GUID == "" {
			continue // as for one day's list
		}
		byDay[h.Date] = append(byDay[h.Date], h)
	}
	if counted != len(blocks) || len(reRangeVchOpen.FindAllString(body, -1)) != len(blocks) {
		return single("the rows Tally gave do not add up to the days' lists")
	}
	large := false
	for _, d := range days {
		if len(byDay[d]) > pullRangeLargeDay {
			large = true
		}
	}
	next := pullRangeNext(n, ms)
	if large {
		next = pullRangeNoneValue
	}
	pullRangeSet(it, next)
	now := nowFn()
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
	total := 0
	for _, d := range days {
		total += len(byDay[d])
	}
	writeLog(fmt.Sprintf("Older entries of %s: Tally lists %d entr%s for %s in %d ms; each day goes to FinCom on its own (next range %d day%s)%s",
		it.Company, total, map[bool]string{true: "y", false: "ies"}[total == 1], form, ms, next, map[bool]string{true: "", false: "s"}[next == 1],
		map[bool]string{true: "; a day of more than 200 entries: single days from now on", false: ""}[large]))
	pullNote(it, "heads", w)
	return true, true, true
}
