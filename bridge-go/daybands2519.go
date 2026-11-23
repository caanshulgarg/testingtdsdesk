package main

// FinCom Bridge 2.5.19, B1 (the owner's approval of 23-Nov-2026; docs/bridge-2.5.19-new-requests.md B.3 and B.4): a day
// whose one-day list (FinComDayHeads) was stopped at 2 s is read in the day in bands of Tally's entry numbers
// (FinComDayHeadsPart: the same day, the same four fields, only the entries whose MasterID is in a band), instead of one
// voucher type at a time. The bands run from 1 to the company's highest voucher number the company check gave
// (AltVchId), the last band open-ended, end to end without gap or overlap; only then is the day's list whole.
//   - The first band is a sixteenth of the span (200 MasterIDs at least). After each band the next is sized from what it
//     took: Tally's fixed cost for the day w = t - 0.085 ms a row, and the next band holds about the rows that bring w +
//     0.085 ms a row to 1.35 s (5,000 rows at most, 300 at least), never more than doubled or less than halved.
//   - A band stopped at 2 s is asked again in half; a band of 200 MasterIDs or fewer stopped, Tally's window held 2 s, or
//     w alone over 1.7 s: the day stops for 24 hours exactly as a slow day does today (pullStopDay).
//   - Every row is checked: of the day asked and inside its band; one row that is not: nothing of the day is used, the
//     day is held as a day whose dates were not applied.
// Every band is one request, in the heavy tier (Tally left alone 60 s), postings first, one in flight, under the 2 s stop.

import (
	"errors"
	"fmt"
	"time"
)

const (
	partTargetMs  = 1350.0
	partRowMs     = 0.085
	partMaxRows   = 5000.0
	partMinRows   = 300.0
	partMinBand   = 200
	partMaxFixed  = 1700.0
	partBandsCeil = 2000 // bands a day at most (a guard: 60 are expected for the biggest day read)
)

func pullBandsOn() bool { v := cfg("DayPullBands"); return v == nil || truthy(v) } // on unless set false

// the bands begin for the day: true when there is a span to cover (the company check's AltVchId)
func pullBandsBegin(w *pullWork) bool {
	if !pullBandsOn() || w.bands {
		return false
	}
	span := companyAlter(w.it.Company)
	if span <= 0 {
		return false // no span known: 2.5.16's way (one voucher type at a time, if on)
	}
	n := maxI64(partMinBand, span/16)
	pull.mu.Lock()
	w.bands, w.bandA, w.bandN, w.bandSpan, w.bandsN, w.bandOpen = true, 1, n, span, 0, n >= span
	w.heads = map[string]pullHead{}
	pull.mu.Unlock()
	writeLog(fmt.Sprintf("Older entries of %s: %s: the day's list took Tally over 2 s; read again in pieces of entry numbers (1 to %d)", w.it.Company, liveDay(w.it.Day), span))
	return true
}

// the band being asked now: [a, b], b 0 for the last (open-ended)
func (w *pullWork) band() (int64, int64) {
	if w.bandOpen {
		return w.bandA, 0
	}
	return w.bandA, w.bandA + w.bandN - 1
}

// the next band's width from what this band (width n) gave: k rows in t ms
func partNext(n int64, k int, tMs float64) int64 {
	if k <= 0 {
		return 2 * n
	}
	fixed := tMs - partRowMs*float64(k)
	if fixed < 0 {
		fixed = 0
	}
	kp := (partTargetMs - fixed) / partRowMs
	if kp > partMaxRows {
		kp = partMaxRows
	}
	if kp < partMinRows {
		kp = partMinRows
	}
	m := int64(kp * float64(n) / float64(k))
	if m > 2*n {
		m = 2 * n
	}
	if m < n/2 {
		m = n / 2
	}
	if m < 1 {
		m = 1
	}
	return m
}

func pullBandStep(w *pullWork, port int) (bool, bool) {
	it := w.it
	a, b := w.band()
	x := dayPartRequest(it.Company, it.Day, a, b)
	what := fmt.Sprintf("a piece of the day (entry numbers %d to %s, FinComDayHeadsPart)", a, map[bool]string{true: "the last", false: fmt.Sprint(b)}[b == 0])
	if x == "" || w.bandsN >= partBandsCeil {
		pullStopDay(w, "over2s", what+": too many pieces")
		return true, false
	}
	pull.mu.Lock()
	pull.lastAsk = nowFn()
	pull.mu.Unlock()
	held := windowHoldFn()
	var took float64
	htc := recorderTC(func(sec float64) { took += sec })
	htc.gentleMs = pullGentleMs()
	htc.sendYield = pullYield(it, pacePart)
	raw, err := invokeTally(htc, port, x, 5)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	if took == 0 {
		holdMs = 0
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	if took > 0 {
		paceNote(it.Company, it.CGUID, pacePart, int(took*1000), holdMs, err == nil)
		w.bandsN++
	}
	switch {
	case gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped) || errors.Is(err, errDayHeadsRefused):
		return false, false // nothing reached Tally; the day waits
	case holdMs >= 2000:
		pullStopDay(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s on %s", float64(holdMs)/1000, what))
		return true, false
	case errors.Is(err, errRecorderStop):
		n := w.bandN
		if w.bandOpen {
			n = maxI64(w.bandN, w.bandSpan-a+1)
		}
		if n <= partMinBand {
			pullStopDay(w, "over2s", what+" took Tally over 2 s")
			return true, false
		}
		pull.mu.Lock()
		w.bandN, w.bandOpen = n/2, false
		pull.mu.Unlock()
		writeLog(fmt.Sprintf("Older entries of %s: %s: %s took Tally over 2 s; asked again in half (%d entry numbers)", it.Company, liveDay(it.Day), what, n/2))
		return true, false
	case err == nil:
	default:
		w.fails++
		liveSayOnce("pull|err|"+it.key(), fmt.Sprintf("Older entries of %s: %s was not read (%s); asked again later", it.Company, liveDay(it.Day), cutRunes(err.Error(), 160)))
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, false
	}
	if !wholeEnvelope(raw) || reTallyLineErr.MatchString(raw) {
		w.fails++
		liveSayOnce("pull|unread|"+it.key(), "Older entries of "+it.Company+": Tally's answer for "+liveDay(it.Day)+" could not be read; asked again later")
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, false
	}
	rows, skipped, bad := pullRowsSkip(raw, it.Day)
	raw = ""
	if skipped > 0 {
		// a band's rows are all of the day asked, or none is used (the paper's B.3, rule 4)
		writeLog(fmt.Sprintf("Older entries of %s: Tally answered %s of %s with an entry of another date (%s). Nothing is stored or sent", it.Company, what, liveDay(it.Day), liveDay(bad)))
		pullStopDay(w, "dates", what+": an entry of another date")
		return true, false
	}
	for _, h := range rows {
		m := toI64(h.Mid)
		if m < a || (b > 0 && m > b) {
			writeLog(fmt.Sprintf("Older entries of %s: Tally answered %s of %s with an entry outside it (MasterID %d). Nothing is stored or sent", it.Company, what, liveDay(it.Day), m))
			pullStopDay(w, "dates", what+": an entry outside the piece")
			return true, false
		}
	}
	for _, h := range rows {
		if len(w.heads) >= pullHeadsMax() {
			pullMarkUpload(w, "toomany", "")
			return true, false
		}
		w.heads[h.Mid] = h
	}
	w.fails = 0
	ms := took * 1000
	if b == 0 {
		w.headsDone = true
		w.warmAt = nowFn()
		writeLog(fmt.Sprintf("Older entries of %s: %s read in pieces: %d entr%s in %d pieces", it.Company, liveDay(it.Day), len(w.heads), map[bool]string{true: "y", false: "ies"}[len(w.heads) == 1], w.bandsN))
		pullNote(it, "heads", w)
		return true, true
	}
	if ms-partRowMs*float64(len(rows)) > partMaxFixed {
		pullStopDay(w, "over2s", fmt.Sprintf("%s: Tally needs %.1f s for the day alone; too big to read in pieces", what, ms/1000))
		return true, false
	}
	next := partNext(w.bandN, len(rows), ms)
	pull.mu.Lock()
	w.bandA, w.bandN = b+1, next
	w.bandOpen = w.bandA+w.bandN-1 >= w.bandSpan
	pull.mu.Unlock()
	pullNote(it, "heads", w)
	return true, false
}

// --- B1's gate (tally.go datedRefused): exactly the band of the day being read in bands now, under the 2 s stop
func dayPartExact(tc *TC, x string) bool {
	if tc == nil || tc.limitMs <= 0 || tc.limitMs > 2000 || x == "" || x != dayPartRebuild(x) {
		return false
	}
	day, _ := pinDates(x)
	pull.mu.Lock()
	defer pull.mu.Unlock()
	w := pull.work
	if w == nil || !w.bands || w.headsDone || companyKey(w.it.Company) != companyKey(pinCo(x)) || w.it.Day != day {
		return false
	}
	a, b := w.band()
	return x == dayPartRequest(w.it.Company, day, a, b) || x == dayPartRequest(pinCo(x), day, a, b)
}
