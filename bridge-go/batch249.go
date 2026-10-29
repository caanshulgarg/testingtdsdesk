// Bridge 2.4.9 (the owner's approval of 29-Oct-2026, docs/bridge-2.4.9-forms-for-owner.md section 9, all four points):
// the older-entries fetch (daypull.go) asks Tally for up to 100 entries of ONE day in one request, FinComVoucherBatch,
// instead of one FinComVoucherObject per entry.
//
//  1. B4, the range form: a Voucher collection of the day (FinComDayHeads' own date form, SVFROMDATE = SVTODATE,
//     yyyymmdd TYPE="Date"), filtered to $MasterID >= a AND $MasterID <= b, where a and b are the first and last of a run
//     of the day's heads (sorted by MasterID) that are all wanted; only that day's entries are looked at, so the range
//     holds exactly the entries asked. FETCH: exactly FinComVoucherObject's approved fields (its FETCHLIST, its "LIST.*"
//     items, the fields its strip keeps: 2.4.2, 2.4.3, 2.4.4, and the payroll lists the strip reads), then every
//     ALLLEDGERENTRIES field once more under LEDGERENTRIES (measured as B4 on TallyPrime 3.0-7.1, tally-versions mode
//     batch, run 40750991113: 100 entries 0.95 s worst on a day of up to 2,216 entries, 1.41 s on a day of 7,601).
//  2. B5, the list form: the same with $MasterID = m1 OR ... OR $MasterID = mN, for wanted entries not next to each other.
//  3. The converter's one rule: an entry with items keeps its LEDGERENTRIES as its ledger lines (a collection's
//     ALLLEDGERENTRIES of an item invoice also holds the items' sales ledger, summed); any other entry keeps its
//     ALLLEDGERENTRIES (the collection's extra LEDGERENTRIES copy is dropped). Then the strip FinComVoucherObject's answer
//     goes through (fastStripWhy: only the approved fields; an entry whose lines the strip cannot keep whole is held,
//     never sent short). Measured: every kept field identical to FinComVoucherObject's answer, 150 of 150 entries on
//     every release.
//  4. The slow-group rule: a group stopped at 2 s is asked again in half-size groups; a half-size group also stopped,
//     an answer that is not exactly the entries asked, or an entry the strip holds: that day goes one by one with
//     FinComVoucherObject, as before. Tally's window held 2 s or more stops the company's period (the 2.4.5 freeze
//     safety, unchanged).
//
// Every other rule of the period fetch stays: one request in flight, the six conditions before each, postings first,
// idle only, the per-computer switch, only approved fields kept (before anything is logged, stored or sent). Payroll
// entries stay one by one (their employees first, their 3 s). No AI.
package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	vchBatchID  = "FinComVoucherBatch"
	batchMaxN   = 100 // the owner's approval of 29-Oct-2026: at most 100 entries a request
	batchFilter = "$MasterID >= %d AND $MasterID <= %d"
)

// the payroll lists FinComVoucherObject's strip reads (pay heads under each employee), fetched as measured
var batchPayrollFields = []string{"CATEGORYENTRY.CATEGORY", "CATEGORYENTRY.EMPLOYEEENTRIES.EMPLOYEENAME", "CATEGORYENTRY.EMPLOYEEENTRIES.AMOUNT",
	"CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.PAYHEADNAME", "CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.ISDEEMEDPOSITIVE",
	"CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.AMOUNT"}

// the FETCH of FinComVoucherBatch, in the measured order: FinComVoucherObject's kept fields, then the ALLLEDGERENTRIES
// ones again under LEDGERENTRIES
func batchFetchFields() []string {
	var all []string
	all = append(all, liveFetchFields()...)
	all = append(all, liveFetchWild()...)
	all = append(all, liveKeepGST242...)
	all = append(all, liveKeepTDS243...)
	all = append(all, liveKeepPay244...)
	all = append(all, batchPayrollFields...)
	seen := map[string]bool{}
	var o []string
	for _, f := range all {
		if f = strings.TrimSpace(f); f != "" && !seen[f] {
			seen[f] = true
			o = append(o, f)
		}
	}
	n := len(o)
	for _, f := range o[:n] {
		if strings.HasPrefix(f, "ALLLEDGERENTRIES.") {
			o = append(o, strings.TrimPrefix(f, "ALL"))
		}
	}
	return o
}

var batchFetchText = strings.Join(batchFetchFields(), ", ")

// a MasterID as the bridge asks it: digits, no leading zero, 18 at most (as voucherObjectRequest)
func batchMidOK(m string) bool {
	return m != "" && len(m) <= 18 && onlyDigits(m) == m && m[0] != '0'
}

// B4: one day, MasterIDs a..b; "" for anything else
func voucherBatchRangeRequest(company, day string, a, b int64) string {
	if !isTallyDate(day) || a <= 0 || b < a {
		return ""
	}
	return formCollection(vchBatchID, company, formPlainT, day, day, batchFetchText, fmt.Sprintf(batchFilter, a, b))
}

// B5: one day, the MasterIDs listed (1 to 100, each once, as given); "" for anything else
func voucherBatchListRequest(company, day string, mids []string) string {
	if !isTallyDate(day) || len(mids) == 0 || len(mids) > batchMaxN {
		return ""
	}
	seen := map[string]bool{}
	parts := make([]string, 0, len(mids))
	for _, m := range mids {
		if !batchMidOK(m) || seen[m] {
			return ""
		}
		seen[m] = true
		parts = append(parts, "$MasterID = "+m)
	}
	return formCollection(vchBatchID, company, formPlainT, day, day, batchFetchText, strings.Join(parts, " OR "))
}

var (
	reBatchRange = regexp.MustCompile(`<SYSTEM TYPE="Formulae" NAME="FinComVoucherBatchOnly">\$MasterID &gt;= (\d+) AND \$MasterID &lt;= (\d+)</SYSTEM>`)
	reBatchList  = regexp.MustCompile(`<SYSTEM TYPE="Formulae" NAME="FinComVoucherBatchOnly">(\$MasterID = \d+(?: OR \$MasterID = \d+)*)</SYSTEM>`)
	reBatchMid   = regexp.MustCompile(`\$MasterID = (\d+)`)
)

// the request rebuilt from its own parameters (pinned.go): the range form or the list form, exactly as built
func voucherBatchRebuild(x string) string {
	co := pinCo(x)
	a, z := pinDates(x)
	if a == "" || a != z {
		return ""
	}
	if m := reBatchRange.FindStringSubmatch(x); m != nil {
		return voucherBatchRangeRequest(co, a, toI64(m[1]), toI64(m[2]))
	}
	if m := reBatchList.FindStringSubmatch(x); m != nil {
		var ids []string
		for _, s := range reBatchMid.FindAllStringSubmatch(m[1], -1) {
			ids = append(ids, s[1])
		}
		return voucherBatchListRequest(co, a, ids)
	}
	return ""
}

// the request being asked now by the period fetch (set right before it goes, cleared after): the only one the dated guard
// lets through (tally.go datedRefused), with the 2 s stop, for a company whose starting point is recorded
var errBatchRefused = errors.New("FinCom Bridge asks Tally for a day's older entries only as built, for the group the older-entries fetch is reading now, under the 2-second stop; nothing was sent to Tally")

func voucherBatchExact(tc *TC, x string) bool {
	if tallyRequestID(x) != vchBatchID || tc == nil || tc.limitMs <= 0 || tc.limitMs > 2000 || x != voucherBatchRebuild(x) {
		return false
	}
	if _, ok := startPointOf(pinCo(x)); !ok {
		return false
	}
	pull.mu.Lock()
	defer pull.mu.Unlock()
	return pull.batchAsk != "" && x == pull.batchAsk
}

// --- the converter's one rule (the owner's approval of 29-Oct-2026, point 3)
var (
	reBatchAllLed = regexp.MustCompile(`(?s)<ALLLEDGERENTRIES\.LIST(?:\s[^>]*)?>.*?</ALLLEDGERENTRIES\.LIST\s*>`)
	reBatchLed    = regexp.MustCompile(`(?s)<LEDGERENTRIES\.LIST(?:\s[^>]*)?>.*?</LEDGERENTRIES\.LIST\s*>`)
	reBatchItem   = regexp.MustCompile(`(?s)<ALLINVENTORYENTRIES\.LIST(?:\s[^>]*)?>.*?<STOCKITEMNAME[^>]*>\s*[^<\s]`)
	// lists a Voucher collection's answer adds that FinComVoucherObject's answer does not hold, and that FinCom never keeps:
	// Tally's working copy of the ledger lines (VCHLEDINFOS), and the cost-category view of them (CATEGORYENTRY, which the
	// strip reads only as a payroll's pay heads: payroll entries are never in a group)
	reBatchExtra = regexp.MustCompile(`(?s)<(VCHLEDINFOS|CATEGORYENTRY)\.LIST(?:\s[^>]*)?>.*?</(?:VCHLEDINFOS|CATEGORYENTRY)\.LIST\s*>`)
)

// one <VOUCHER> of a FinComVoucherBatch answer as FinComVoucherObject's answer holds it: an entry with items keeps its
// LEDGERENTRIES as its ledger lines, any other its ALLLEDGERENTRIES; never both (the collection's own extra lists out)
func batchConvert(v string) string {
	v = reBatchExtra.ReplaceAllString(v, "")
	if reBatchItem.MatchString(v) && reBatchLed.MatchString(v) {
		return reBatchAllLed.ReplaceAllString(v, "")
	}
	if reBatchAllLed.MatchString(v) {
		return reBatchLed.ReplaceAllString(v, "")
	}
	return v
}

// errBatchInexact: the answer was not exactly the entries asked (one missing, one more, one twice, another day): not used
type batchInexactError struct{ why string }

func (e batchInexactError) Error() string {
	return "the group's answer was not exactly the entries asked: " + e.why
}

var errBatchInexact = errors.New("inexact")

func (e batchInexactError) Is(t error) bool { return t == errBatchInexact }

// the group of MasterIDs to ask next of a day's wanted entries (heads: the day's list by MasterID): the first wanted
// entry that is not a payroll entry and the next ones, up to n; contiguous: every head between the first and the last
// is in the group (the range form), else the list form
func batchGroup(want []string, heads map[string]pullHead, n int, isPay func(string) bool) ([]string, bool) {
	if n > batchMaxN {
		n = batchMaxN
	}
	var g []string
	for _, m := range want {
		if len(g) >= n {
			break
		}
		if _, ok := heads[m]; !ok || isPay(m) || !batchMidOK(m) {
			continue
		}
		g = append(g, m)
	}
	sort.Slice(g, func(a, b int) bool { return toI64(g[a]) < toI64(g[b]) })
	if len(g) < 2 {
		return g, false
	}
	in := map[string]bool{}
	for _, m := range g {
		in[m] = true
	}
	lo, hi := toI64(g[0]), toI64(g[len(g)-1])
	for m := range heads {
		if v := toI64(m); v >= lo && v <= hi && !in[m] {
			return g, false
		}
	}
	return g, true
}

// one group of one day by FinComVoucherBatch: the entries as kept (fastStripWhy after batchConvert) by MasterID
// single: entries of the group left for FinComVoucherObject (one by one decides, as 2.4.8): a payroll entry (its type
// learned from the answer), or one the strip would hold
func fetchVoucherBatch(tc *TC, company string, port int, day string, mids []string, contiguous bool, sec int, listed bool) (map[string]string, map[string]bool, error) {
	x := ""
	if contiguous {
		x = voucherBatchRangeRequest(company, day, toI64(mids[0]), toI64(mids[len(mids)-1]))
	} else {
		x = voucherBatchListRequest(company, day, mids)
	}
	if x == "" || len(mids) > batchMaxN {
		return nil, nil, fmt.Errorf("not asked: a group of %d entries could not be built", len(mids))
	}
	if slowMarked(company, "") {
		return nil, nil, errSlowCompany
	}
	if err := readStopRefuses(x); err != nil {
		return nil, nil, err
	}
	if !listed {
		if err := fastCompanyListed(tc, company, port, sec); err != nil {
			return nil, nil, err
		}
	}
	pull.mu.Lock()
	pull.batchAsk = x
	pull.mu.Unlock()
	raw, err := invokeTally(tc, port, x, sec)
	pull.mu.Lock()
	pull.batchAsk = ""
	pull.mu.Unlock()
	if err != nil {
		return nil, nil, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	asked := map[string]bool{}
	for _, m := range mids {
		asked[m] = true
	}
	out, single := map[string]string{}, map[string]bool{}
	raw = reCmpInfo.ReplaceAllString(raw, "")
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		c := cleanXML(b)
		mid := strings.TrimLeft(tagNum(c, "MASTERID"), "0")
		switch {
		case mid == "" || !asked[mid]:
			return nil, nil, batchInexactError{"an entry not asked (MasterID " + or(mid, "none") + ")"}
		case out[mid] != "" || single[mid]:
			return nil, nil, batchInexactError{"MasterID " + mid + " twice"}
		case normDate(tagValue(c, "DATE")) != day:
			return nil, nil, batchInexactError{"MasterID " + mid + " dated " + or(normDate(tagValue(c, "DATE")), "no date")}
		}
		payrollLearn(company, c)
		if payrollEntry(company, tagValue(c, "VOUCHERTYPENAME")) {
			single[mid] = true
			continue
		}
		v, why := fastStripWhy(batchConvert(c))
		if why != "" || v == "" {
			single[mid] = true
			continue
		}
		out[mid] = v
	}
	if len(out)+len(single) != len(mids) {
		var miss []string
		for _, m := range mids {
			if out[m] == "" && !single[m] {
				miss = append(miss, m)
			}
		}
		return nil, nil, batchInexactError{fmt.Sprintf("%d of %d missing (%s)", len(miss), len(mids), cut(strings.Join(miss, ", "), 80))}
	}
	return out, single, nil
}

// the group size of the day being read: 100, halved after a group stopped at 2 s; 0: one by one
func pullBatchMax() int { return maxI(1, minI(keepNum("DayPullBatchMax", batchMaxN), batchMaxN)) }

// a day's group by FinComVoucherBatch (daypull.go pullFetchStep): (sent, more); handled false: one by one this step
func pullBatchStep(w *pullWork, port int) (handled, sent, more bool) {
	it := w.it
	if w.split || w.oneByOne || pullBatchMax() < 2 {
		return false, false, false
	}
	if w.batchN == 0 {
		w.batchN = pullBatchMax()
	}
	g, contiguous := batchGroup(w.want, w.heads, w.batchN, func(m string) bool { return w.single[m] || payrollEntry(it.Company, w.heads[m].Type) })
	if len(g) < 2 {
		return false, false, false
	}
	tc := recorderTC(nil)
	var took float64
	tc.timed = func(sec float64) { took += sec }
	tc.gentleMs = pullGentleMs()
	limit := recorderLimitMs()
	listed := pullCoListed(w, port)
	held := windowHoldFn()
	got, single, err := fetchVoucherBatch(tc, it.Company, port, it.Day, g, contiguous, liveBodySec(), listed)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	if took == 0 {
		holdMs = 0
	}
	pullNoteWatched(holdMs)
	pullNoteLook(err == nil && took > 0, holdMs)
	if err != nil || holdMs >= limit {
		w.coAt = time.Time{}
	} else if !listed {
		w.coAt, w.coReal, w.coPort = nowFn(), time.Now(), port
	}
	form := map[bool]string{true: "MasterIDs " + g[0] + ".." + g[len(g)-1], false: "a list of MasterIDs"}[contiguous]
	switch {
	case errors.Is(err, errRetryWait) || gaveWay(err) || errors.Is(err, errReadStopped):
		return true, false, false
	case errors.Is(err, errSlowCompany):
		pullDrop(w)
		return true, true, false
	case holdMs >= limit:
		pullStopCompany(w, "window", fmt.Sprintf("Tally's window did not answer for %.1f s while %d entries of the day were read (%s)", float64(holdMs)/1000, len(g), form))
		return true, true, false
	case errors.Is(err, errRecorderStop):
		// the owner's approval of 29-Oct-2026, point 4: halve, then one by one
		if w.batchN >= pullBatchMax() && len(g) >= 4 {
			w.batchN = maxI(2, len(g)/2)
			writeLog(fmt.Sprintf("Older entries of %s: %s: a group of %d entries (%s) took Tally over 2 s; asked again %d at a time", it.Company, liveDay(it.Day), len(g), form, w.batchN))
		} else {
			w.oneByOne = true
			writeLog(fmt.Sprintf("Older entries of %s: %s: a group of %d entries (%s) took Tally over 2 s; the day's other entries are read one by one", it.Company, liveDay(it.Day), len(g), form))
		}
		return true, true, true
	case errors.Is(err, errBatchInexact):
		w.oneByOne = true
		writeLog(fmt.Sprintf("Older entries of %s: %s: %s; not used, the day's entries are read one by one", it.Company, liveDay(it.Day), cutRunes(err.Error(), 200)))
		return true, true, true
	case err == nil:
	default:
		w.fails++
		liveSayOnce("pull|fetch|"+it.key(), fmt.Sprintf("Older entries of %s: entries of %s were not read (%s); asked again later", it.Company, liveDay(it.Day), cutRunes(err.Error(), 160)))
		if w.fails >= 5 {
			pullDrop(w)
		}
		return true, true, false
	}
	w.fails = 0
	w.asked += len(g)
	w.batches++
	in := map[string]bool{}
	for _, m := range g {
		if single[m] {
			if w.single == nil {
				w.single = map[string]bool{}
			}
			w.single[m] = true // left wanted: FinComVoucherObject reads it (a payroll entry, or one the strip would hold)
			continue
		}
		in[m] = true
		x, h := got[m], w.heads[m]
		if !strings.EqualFold(strings.TrimSpace(tagValue(x, "GUID")), h.GUID) {
			writeLog(fmt.Sprintf("Older entries of %s: the entry with MasterID %s is no longer the one %s's list named; not sent (the day is counted again)", it.Company, m, liveDay(it.Day)))
			continue
		}
		w.got = append(w.got, x)
	}
	rest := w.want[:0]
	for _, m := range w.want {
		if !in[m] {
			rest = append(rest, m)
		}
	}
	w.want = rest
	pullNote(it, "fetch", w)
	return true, true, true
}
