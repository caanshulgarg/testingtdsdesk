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
	"html"
	"regexp"
	"sort"
	"strings"
	"sync"
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

// 2.4.9's gate (tally-versions mode bdiff, run 40800355969, the tdsgst and payroll test companies): what a Voucher
// collection gives otherwise than FinComVoucherObject's answer, found field by field. An entry showing it is not taken
// from the group: FinComVoucherObject reads it one by one (FinCom gets exactly what 2.4.8 sends):
//   - every release adds an "On Account" bill allocation with no name to a bill-wise party's line that has none
//     (FinComVoucherObject's answer has no allocation there): such an entry is always read one by one;
//   - TallyPrime 3.0 .. 6.2 leave a line's GST type of supply (GSTOVRDNTYPEOFSUPPLY) empty in a collection where the
//     object export gives the one the ledger (or stock item) holds, "Goods" or "Services"; where neither holds one both
//     are empty (ZZ BIG TEST, run 40750991113). So a line with a GST nature or taxability and no type of supply is taken
//     from a group only for a ledger / stock item this bridge has seen FinComVoucherObject answer with no type of supply
//     too: the first entry naming an unknown one is read one by one (FinComVoucherObject), which settles it for the company;
//     the group's other entries naming it are asked again in the next group.

// the lines of an entry with a GST nature or taxability and no type of supply, as "<list>|<name>" (the ledger's or the
// stock item's name), and why the entry is to be read one by one whatever the lines ("" when not)
func batchTOSLines(v string) (keys []string, always string) {
	root := fastTree(v)
	if root == nil {
		return nil, ""
	}
	seen := map[string]bool{}
	var walk func(e *fastEl)
	walk = func(e *fastEl) {
		if always != "" || !e.hasKids {
			return
		}
		kid := map[string]string{}
		has := map[string]bool{}
		for _, k := range e.kids {
			if !k.hasKids {
				kid[k.name] = strings.Trim(html.UnescapeString(k.text), "\x04 \t\r\n")
				has[k.name] = true
			}
		}
		if e.name == "BILLALLOCATIONS.LIST" && strings.EqualFold(kid["BILLTYPE"], "On Account") && kid["NAME"] == "" {
			always = "an On Account bill allocation with no name, as a group gives it"
			return
		}
		if (kid["GSTOVRDNTAXABILITY"] != "" || kid["GSTOVRDNNATURE"] != "") && has["GSTOVRDNTYPEOFSUPPLY"] && kid["GSTOVRDNTYPEOFSUPPLY"] == "" {
			name := kid["LEDGERNAME"]
			if name == "" {
				name = kid["STOCKITEMNAME"]
			}
			if k := strings.TrimSuffix(e.name, ".LIST") + "|" + strings.ToLower(name); !seen[k] {
				seen[k] = true
				keys = append(keys, k)
			}
		}
		for _, k := range e.kids {
			walk(k)
		}
	}
	walk(root)
	sort.Strings(keys)
	return keys, always
}

// what this bridge has learned per company: "<list>|<name>" -> FinComVoucherObject also gives no type of supply (true)
// or gives one (false)
var batchTOS = struct {
	mu    sync.Mutex
	known map[string]bool
	probe map[string][]string // company|MasterID -> the keys its one-by-one answer settles
}{known: map[string]bool{}, probe: map[string][]string{}}

func batchTOSKey(company, k string) string { return companyKey(company) + "|" + k }

// the entry may be taken from the group: every line without a type of supply names a ledger / item known to have none
// in FinComVoucherObject's answer too. probe: the keys still unknown (the entry is to be read one by one to learn them)
func batchTOSTake(company string, keys []string) (ok bool, unknown []string) {
	batchTOS.mu.Lock()
	defer batchTOS.mu.Unlock()
	ok = true
	for _, k := range keys {
		same, known := batchTOS.known[batchTOSKey(company, k)]
		if !known {
			unknown = append(unknown, k)
			ok = false
		} else if !same {
			ok = false
		}
	}
	return ok, unknown
}

func batchTOSProbe(company, mid string, keys []string) {
	batchTOS.mu.Lock()
	batchTOS.probe[companyKey(company)+"|"+mid] = keys
	batchTOS.mu.Unlock()
}

func batchTOSProbing(company, mid string) bool {
	batchTOS.mu.Lock()
	defer batchTOS.mu.Unlock()
	_, ok := batchTOS.probe[companyKey(company)+"|"+mid]
	return ok
}

// FinComVoucherObject's kept answer for an entry read one by one: what it gives for the lines its group left unknown
func batchTOSLearn(company, mid, kept string) {
	batchTOS.mu.Lock()
	defer batchTOS.mu.Unlock()
	pk := companyKey(company) + "|" + mid
	keys, ok := batchTOS.probe[pk]
	if !ok {
		return
	}
	delete(batchTOS.probe, pk)
	root := fastTree(kept)
	if root == nil {
		return
	}
	got := map[string]string{}
	var walk func(e *fastEl, path string)
	walk = func(e *fastEl, path string) {
		if !e.hasKids {
			return
		}
		name, tos := "", ""
		for _, k := range e.kids {
			if !k.hasKids {
				switch k.name {
				case "LEDGERNAME", "STOCKITEMNAME":
					name = strings.ToLower(strings.TrimSpace(html.UnescapeString(k.text)))
				case "GSTOVRDNTYPEOFSUPPLY":
					tos = strings.Trim(html.UnescapeString(k.text), "\x04 \t\r\n")
				}
			}
		}
		// the strip writes ALLLEDGERENTRIES for an entry's own lines whichever list Tally used
		list := strings.TrimSuffix(e.name, ".LIST")
		if list == "ALLLEDGERENTRIES" {
			got["LEDGERENTRIES|"+name] += tos
		}
		got[list+"|"+name] += tos
		for _, k := range e.kids {
			walk(k, path)
		}
	}
	walk(root, "")
	for _, k := range keys {
		v, seen := got[k]
		if !seen {
			continue // not settled by this answer
		}
		batchTOS.known[batchTOSKey(company, k)] = v == ""
	}
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
	out, single, again := map[string]string{}, map[string]bool{}, map[string]bool{}
	probing := map[string]bool{}
	raw = reCmpInfo.ReplaceAllString(raw, "")
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		c := cleanXML(b)
		mid := strings.TrimLeft(tagNum(c, "MASTERID"), "0")
		switch {
		case mid == "" || !asked[mid]:
			return nil, nil, batchInexactError{"an entry not asked (MasterID " + or(mid, "none") + ")"}
		case out[mid] != "" || single[mid] || again[mid]:
			return nil, nil, batchInexactError{"MasterID " + mid + " twice"}
		case normDate(tagValue(c, "DATE")) != day:
			return nil, nil, batchInexactError{"MasterID " + mid + " dated " + or(normDate(tagValue(c, "DATE")), "no date")}
		}
		payrollLearn(company, c)
		if payrollEntry(company, tagValue(c, "VOUCHERTYPENAME")) {
			single[mid] = true
			continue
		}
		cv := batchConvert(c)
		keys, always := batchTOSLines(cv)
		if always != "" {
			single[mid] = true
			continue
		}
		if ok, unknown := batchTOSTake(company, keys); !ok {
			if len(unknown) > 0 && !probing[strings.Join(unknown, "\n")] {
				// the first entry naming these unknown lines: read one by one, which settles them for the company
				probing[strings.Join(unknown, "\n")] = true
				batchTOSProbe(company, mid, unknown)
				single[mid] = true
			} else if len(unknown) > 0 {
				again[mid] = true // asked again in the next group, once its probe has settled the lines
			} else {
				single[mid] = true // a line whose ledger / item FinComVoucherObject gives a type of supply for
			}
			continue
		}
		v, why := fastStripWhy(cv)
		if why != "" || v == "" {
			single[mid] = true
			continue
		}
		out[mid] = v
	}
	if len(out)+len(single)+len(again) != len(mids) {
		var miss []string
		for _, m := range mids {
			if out[m] == "" && !single[m] && !again[m] {
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
	// an entry read one by one to settle what a group left unknown goes before the next group
	for _, m := range w.want {
		if w.single[m] && batchTOSProbing(it.Company, m) {
			return false, false, false
		}
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
	var probes []string
	for _, m := range g {
		if single[m] {
			if w.single == nil {
				w.single = map[string]bool{}
			}
			w.single[m] = true // left wanted: FinComVoucherObject reads it (a payroll entry, one the strip would hold, a probe)
			if batchTOSProbing(it.Company, m) {
				probes = append(probes, m)
			}
			continue
		}
		if got[m] == "" {
			continue // asked again in the next group (its lines settled by a probe first)
		}
		in[m] = true
		x, h := got[m], w.heads[m]
		if !strings.EqualFold(strings.TrimSpace(tagValue(x, "GUID")), h.GUID) {
			writeLog(fmt.Sprintf("Older entries of %s: the entry with MasterID %s is no longer the one %s's list named; not sent (the day is counted again)", it.Company, m, liveDay(it.Day)))
			continue
		}
		w.got = append(w.got, x)
	}
	// the probes first (FinComVoucherObject reads them next), then the rest as they were
	rest := append([]string{}, probes...)
	isProbe := map[string]bool{}
	for _, m := range probes {
		isProbe[m] = true
	}
	for _, m := range w.want {
		if !in[m] && !isProbe[m] {
			rest = append(rest, m)
		}
	}
	w.want = rest
	pullNote(it, "fetch", w)
	return true, true, true
}
