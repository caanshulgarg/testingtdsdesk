// Bridge 2.2.0, the owner's additions (04-Oct-2026, during the build):
//
//	A. The dates of a Voucher COLLECTION (not only the Day Book report), tried by the person-started "Test reading from
//	   Tally" (readtest.go) on a PAST-year month: the newest day of a past year the copy holds is the anchor, and a form
//	   passes when Tally answers exactly that month's entries (each dated in it, as many as the copy holds). Seven forms:
//	   SVFROMDATE/SVTODATE as yyyymmdd and d-MMM-yyyy, each without and with TYPE="Date"; and the period set inside
//	   the TDL, a collection FILTER on $Date with the dates as TDL date literals ($$Date:"1-Apr-2025"), as ">= AND <="
//	   or $$IsBetween, together with the static variables (d-MMM-yyyy TYPE="Date"), and the ">= AND <=" filter alone.
//	   (Not run on a real Tally yet: the $$Date literal and $$IsBetween are the TDL reference's; if Tally rejects them
//	   the form fails and is logged so. Neither works out a figure.) One log line per form: "Dates (collection) form X:
//	   N entries for <yyyy-mm>, Y.Y s, applied: yes/no". The first form that passes is kept per company and Tally
//	   program (sync\date-forms.json) and used by source C.
//	C. One Edit Log probe in the read test (measurement only): Tally's program (the running tally.exe: its path, size
//	   and date; no request gives Tally's version without a $$ function), and ONE Voucher collection for the newest
//	   changed entry (by MasterID) fetching the edit-log sub-collection under the names it may have (EDITLOG.LIST,
//	   AUDITLOG.LIST, ALTERATIONLOG.LIST: candidates, not known; a name Tally does not have is simply not answered).
//	   Logged: answered or not, bytes, seconds, the first 300 characters of the answer's tags. Nothing else is built on it.
//	B. Source C, "month slices" (RecorderSource "slices"; "both" is the add-on and the slices): when the light check sees
//	   ALTVCHID above the highest received and a collection form passed, the keep list (GUID, MASTERID, ALTERID, DATE)
//	   for ONE month with AlterID above it, newest month first, month by month back to the copy's earliest month (never
//	   before the books' start), stopping when the AlterIDs found account for the rise. One request at a time, 60 s
//	   apart at least, never during a posting or an import. Default off.
//
// The 2 s rule on every method (source B, source C, the body fetch): a request that takes more than 2.0 s from its send
// to its full answer turns that method off for that company (sync\recorder-offsets.json, so a restart keeps it off),
// says so in the log and the beat; it comes back only when the owner switches where the changes come from (a beat
// value other than the one in force when it stopped).
package main

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	datesProbeID   = "FinComDatesProbe"   // measure-only: the read test's collection date forms
	editLogProbeID = "FinComEditLogProbe" // measure-only: the read test's one Edit Log probe
	sliceID        = "FinComSlice"        // source C: one month's entries above an AlterID, in the kept form
	sliceFetch     = "GUID, MASTERID, ALTERID, DATE"

	collFilterGE   = "TDL filter >= <= with d-MMM-yyyy TYPE=Date"
	collFilterBtw  = "TDL filter IsBetween with d-MMM-yyyy TYPE=Date"
	collFilterOnly = "TDL filter >= <= alone"
)

// the forms tried, in order
var collForms = []string{formPlain, formDMY, formPlainT, formDMYT, collFilterGE, collFilterBtw, collFilterOnly}

// a Voucher collection for a period in one form; filter (may be "") is added to the date filter
func formCollection(id, company, form, from, to, fetch, filter string) string {
	lit := func(d string) string { return `$$Date:"` + tallyDMY(d) + `"` }
	statics, df := "", ""
	switch form {
	case collFilterGE, collFilterOnly:
		df = "$Date >= " + lit(from) + " AND $Date <= " + lit(to)
	case collFilterBtw:
		df = "$$IsBetween:$Date:" + lit(from) + ":" + lit(to)
	default:
		statics = dateVars(form, from, to)
	}
	if form == collFilterGE || form == collFilterBtw {
		statics = dateVars(formDMYT, from, to)
	}
	f := filter
	if df != "" {
		f = df
		if filter != "" {
			f = "(" + df + ") AND " + filter
		}
	}
	return fcCollection(id, company, statics, "Voucher", fetch, f)
}

func datesProbeRequest(company, form, from, to string) string {
	return formCollection(datesProbeID, company, form, from, to, sliceFetch, "")
}

// source C's request: one month (ym) in the kept form, the entries above an AlterID
func sliceRequest(company, form, ym string, after int64) string {
	return formCollection(sliceID, company, form, ym+"01", monthEnd(ym), sliceFetch, fmt.Sprintf("$AlterID > %d", after))
}

// the one Edit Log probe: the voucher with that MasterID, its edit-log sub-collection under the candidate names
func editLogProbeRequest(company, master string) string {
	m := onlyDigits(master)
	if m == "" {
		m = "0"
	}
	return fcCollection(editLogProbeID, company, "", "Voucher", "GUID, MASTERID, ALTERID, EDITLOG.LIST, AUDITLOG.LIST, ALTERATIONLOG.LIST", "$MasterID = "+m)
}

// the dated guard's second exception (tally.go): exactly source C's request for one month, in the form kept for that
// company, AlterID above a number
func sliceExact(x string) bool {
	if tallyRequestID(x) != sliceID {
		return false
	}
	co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
	form := dateFormFor(co)
	m := regexp.MustCompile(`\$AlterID &gt; (\d+)`).FindStringSubmatch(x)
	// the month: from SVFROMDATE, or (the filter forms) from the first $$Date literal
	from := normDate(html.UnescapeString(group(`<SVFROMDATE[^>]*>([^<]*)</SVFROMDATE>`, x, 1)))
	if from == "" {
		from = normDate(html.UnescapeString(group(`\$\$Date:&#34;([^&]*)&#34;`, x, 1)))
	}
	if form == "" || m == nil || len(from) != 8 {
		return false
	}
	// round 2 R2-2: the values too: an AlterID at or above the starting point, a month from the starting point's to now
	sp, ok := startPointOf(co)
	ym, first := from[:6], startPointMonth(co)
	if !ok || toI64(m[1]) < sp || first == "" || ym < first || ym > nowFn().Format("200601") {
		return false
	}
	return x == sliceRequest(co, form, ym, toI64(m[1]))
}

// --- the kept form, per company and Tally program
func dateFormsFile() string { return sp("date-forms.json") }

// the running Tally's program: "tally.exe, <size> bytes, <date>" (the first under Program Files); "not known" when none
// is seen (no request gives Tally's version without a $$ function)
func tallyProgram() (string, string) {
	if ok, ps, _ := platNetState(); ok {
		pf, pf86 := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")
		var cand []proc
		for _, p := range ps {
			if p.Path == "" || !reTally.MatchString(p.Name) || !(underDir(p.Path, pf) || underDir(p.Path, pf86)) {
				continue
			}
			if _, err := os.Stat(p.Path); err == nil {
				cand = append(cand, p)
			}
		}
		if p, ok := pickTallyProgram(cand); ok {
			if fi, err := os.Stat(p.Path); err == nil {
				id := fmt.Sprintf("%s, %d bytes, %s", filepath.Base(p.Path), fi.Size(), fi.ModTime().Format("2006-01-02"))
				return id, p.Path
			}
		}
	}
	return "not known", ""
}

// 2.3.1 (the version tests, run 37418469212): TallyPrime 7.1 also runs tallyscheduler.exe from its install folder. The
// Tally program is exactly tally.exe; failing that a program named TallyPrime.exe (^tally(prime)?\.exe$); never
// tallyscheduler or any other helper program
var reTallyExe = regexp.MustCompile(`(?i)^tally(prime)?\.exe$`)

func tallyExeName(p proc) string {
	if p.Path != "" {
		b := p.Path
		if i := strings.LastIndexAny(b, `\/`); i >= 0 {
			b = b[i+1:]
		}
		return strings.ToLower(b)
	}
	return strings.ToLower(p.Name) + ".exe" // Get-Process names a program without .exe
}

func pickTallyProgram(ps []proc) (proc, bool) {
	for _, p := range ps {
		if tallyExeName(p) == "tally.exe" {
			return p, true
		}
	}
	for _, p := range ps {
		if reTallyExe.MatchString(tallyExeName(p)) {
			return p, true
		}
	}
	return proc{}, false
}

// round 2 R2-11: kept per company (the Tally program is recorded with it, as data)
func dateFormKey(company string) string { return companyKey(company) }

// the month (yyyymm) the company's starting point was recorded in ("" : none)
func startPointMonth(company string) string {
	held := heldGUID(company)
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	all, _ := readStartPoints()
	all = spWithPending(all)
	e, _ := startPointPick(startPointsOf(all, company), held, spGUID[company])
	if e == nil {
		return ""
	}
	at := strings.ReplaceAll(str(e["at"]), "-", "")
	if len(at) < 6 {
		return ""
	}
	return at[:6]
}

func saveDateForm(company, form, month string, n int) {
	all := readObjFile(dateFormsFile())
	if all == nil {
		all = M{}
	}
	prog, _ := tallyProgram()
	all[dateFormKey(company)] = M{"company": company, "form": form, "month": month, "entries": n, "at": nowS(), "program": prog}
	if err := saveFile(dateFormsFile(), jsonText(all)); err != nil {
		writeLog("Dates (collection): " + dateFormsFile() + " could not be written: " + err.Error())
	}
}

// the form kept for the company on this Tally program ("" : none passed)
func dateFormFor(company string) string {
	f := str(obj(readObjFile(dateFormsFile())[dateFormKey(company)])["form"])
	for _, x := range collForms {
		if x == f {
			return f
		}
	}
	return ""
}

// --- A, in the read test: the anchor month and the forms
func readTestPastAnchor(company string) string {
	dir, err := companyDir(company)
	if err != nil {
		return ""
	}
	fy := tallyDate(fyStart(nowFn()))
	files := dayFiles(dir, "")
	for i := len(files) - 1; i >= 0; i-- {
		d := strings.TrimSuffix(filepath.Base(files[i]), ".xml")
		if isTallyDate(d) && d < fy && countVouchers(readText(files[i])) > 0 {
			return d
		}
	}
	return ""
}

func readTestCollectionForms(port int, company string) {
	d := readTestPastAnchor(company)
	if d == "" {
		writeLog("Dates (collection): the copy holds no day of a past year; the collection forms are not tried")
		return
	}
	ym := d[:6]
	dir, _ := companyDir(company)
	want := copyVouchers(dir, ym+"01", monthEnd(ym))
	kept := ""
	svStop := false
	for _, form := range collForms {
		filterForm := strings.HasPrefix(form, "TDL filter")
		if svStop && !filterForm {
			continue
		}
		t0 := time.Now()
		raw, err := invokeTally(readTestTC, port, datesProbeRequest(company, form, ym+"01", monthEnd(ym)), 60)
		sec := time.Since(t0).Seconds()
		n, inMonth := 0, true
		for _, v := range reVoucher.FindAllString(raw, -1) {
			n++
			if dd := tagDate(v, "DATE"); dd[:minI(6, len(dd))] != ym {
				inMonth = false
			}
		}
		ok := err == nil && n > 0 && n == want && inMonth
		applied := ok && kept == ""
		if applied {
			kept = form
			saveDateForm(company, form, ym, n)
		}
		what := fmt.Sprintf("%d entries", n)
		if err != nil {
			what = "not answered (" + cutRunes(err.Error(), 120) + ")"
		}
		writeLog(fmt.Sprintf("Dates (collection) form %s: %s for %s-%s, %.1f s, applied: %s", form, what, ym[:4], ym[4:], sec, map[bool]string{true: "yes", false: "no"}[applied]))
		// round 2 R2-6: an answer that ignores the period (over 4 times the month's entries) or takes over 2 s: the other
		// forms with the dates in the static variables are not tried (the filter forms bound themselves)
		if !filterForm && !svStop && err == nil && (n > 4*maxI(want, 1) || sec > liveLimitSec()) {
			svStop = true
			writeLog(fmt.Sprintf("Dates (collection): the form %s gave %d entries for %s-%s (more than 4 times its %d) or took %.1f s: the other forms with dates in the static variables are not tried",
				form, n, ym[:4], ym[4:], want, sec))
		}
	}
	if kept == "" {
		writeLog(fmt.Sprintf("Dates (collection): no form answered %s-%s with exactly its %d entries; source C stays unusable on this Tally", ym[:4], ym[4:], want))
	}
}

// --- C, in the read test: the program and the one probe for the newest changed entry (the highest AlterID among the
// answers the test already has)
func readTestEditLogProbe(port int, company string, answers ...string) {
	id, path := tallyProgram()
	writeLog("Tally program: " + id + map[bool]string{true: " (" + path + ")", false: ""}[path != ""])
	best, mid := int64(-1), ""
	for _, raw := range answers {
		for _, v := range reVoucher.FindAllString(raw, -1) {
			a, m := toI64(tagNum(v, "ALTERID")), tagNum(v, "MASTERID")
			if m != "" && a > best {
				best, mid = a, m
			}
		}
	}
	if mid == "" {
		writeLog("Edit Log probe: no changed entry known to ask about; not sent")
		return
	}
	t0 := time.Now()
	raw, err := invokeTally(readTestTC, port, editLogProbeRequest(company, mid), 60)
	sec := time.Since(t0).Seconds()
	if err != nil {
		writeLog(fmt.Sprintf("Edit Log probe (%s, MasterID %s): not answered (%s), %.1f s", editLogProbeID, mid, cutRunes(err.Error(), 160), sec))
		return
	}
	tags := strings.Join(regexp.MustCompile(`<[/?!]?[\w.:-]*`).FindAllString(raw, -1), ">") + ">"
	writeLog(fmt.Sprintf("Edit Log probe (%s, MasterID %s): answered, %d bytes, %.1f s; tags: %s", editLogProbeID, mid, len(raw), sec, cut(tags, 300)))
}

// --- the 2 s hard stop, every background read (2.3.1, the owner's last change: never a switch-off; a request stopped or
// not answered is asked again by the shared retry schedule, retry.go)
// release-240 review Low: the 2-second rule, never above 2,000 ms whatever the settings say (a lower value stays)
func recorderLimitMs() int { return minI(keepNum("RecorderLimitMs", 2000), 2000) }

func liveLimitSec() float64 { return float64(recorderLimitMs()) / 1000 }

// 2.2.2 (the owner's condition b): a recorder background read: it gives way to a posting, is told its time, is stopped
// HARD at RecorderLimitMs (2000): the bridge stops waiting for Tally then (tally.go), and follows the retry schedule
func recorderTC(timed func(sec float64)) *TC {
	return &TC{copier: true, bg: true, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }, timed: timed, limitMs: recorderLimitMs()}
}

// --- B. source C
type liveCSt struct {
	company, guid   string
	seen, maxMaster int64
	lastAsk         time.Time
	round           *liveRound
}

type liveRound struct {
	target, from int64
	ym, earliest string
	found        map[int64]bool
}

// the oldest month source C goes back to: the starting point's month (round 2 R2-10; this month when it is not known),
// never before the books' start
func liveEarliestMonth(company string) string {
	e := startPointMonth(company)
	if now := nowFn().Format("200601"); e == "" || e > now {
		e = now
	}
	if dir, err := companyDir(company); err == nil {
		if b := str(readKeepState(dir)["booksFrom"]); isTallyDate(b) && b[:6] > e {
			e = b[:6]
		}
	}
	return e
}

var liveCNoForm = map[string]bool{} // under live.mu: said once per company

// one month of source C (at most one request); the changes queued
func liveSourceC(company string, port int) (int, error) {
	cur, guid := latestNumbers(company)
	if cur == nil {
		return 0, nil
	}
	if guid == "" {
		guid = heldGUID(company)
	}
	v := toI64(cur["altvchid"])
	key := companyKey(company) + "|" + guid
	form := dateFormFor(company)
	live.mu.Lock()
	liveFresh()
	if form == "" {
		said := liveCNoForm[company]
		liveCNoForm[company] = true
		live.mu.Unlock()
		if !said {
			writeLog("Source C: no dated collection form has passed the read test for " + company + " on this Tally; no month slice is asked")
		}
		return 0, nil
	}
	st := live.c[key]
	if st == nil {
		sp, ok := startPointOf(company)
		if !ok {
			live.mu.Unlock()
			return 0, nil
		}
		// round 2 R2-1: from the switch on: the starting point, the highest AlterID the add-on gave, or ALTVCHID now,
		// whichever is highest (what changed before the switch is the gap check's)
		seen := sp
		if h := live.high[key]; h > seen {
			seen = h
		}
		if v > seen {
			seen = v
		}
		st = &liveCSt{company: company, guid: guid, seen: seen}
		live.c[key] = st
	}
	if st.round == nil {
		liveSkipWindows(key, &st.seen)
	}
	if st.round == nil && v <= st.seen {
		live.mu.Unlock()
		return 0, nil
	}
	if !st.lastAsk.IsZero() && nowFn().Sub(st.lastAsk) < time.Duration(keepNum("RecorderBGapSec", 60))*time.Second {
		live.mu.Unlock()
		return 0, nil
	}
	if postingGoing() || importsInFlight.Load() > 0 {
		live.mu.Unlock()
		return 0, nil
	}
	if span := v - st.seen; st.round == nil && span > int64(keepNum("RecorderBMaxSpan", 500)) {
		// round 2 R2-1: too many to ask for, month by month; left to the gap check and the Day Book
		st.seen = v
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder (month slices) for %s: too many changes for Source C (%d); the gap check and Day Book cover them", company, span))
		liveSaveOffsets()
		return 0, nil
	}
	if st.round == nil {
		st.round = &liveRound{target: v, from: st.seen, ym: nowFn().Format("200601"), earliest: liveEarliestMonth(company), found: map[int64]bool{}}
	}
	r := st.round
	ym, from := r.ym, r.from
	st.lastAsk = nowFn()
	live.mu.Unlock()
	liveSaveOffsets()                                                                                                        // round 2 R2-9
	raw, err := invokeTally(recorderTC(nil), port, sliceRequest(company, form, ym, from), keepNum("RecorderBTimeoutSec", 5)) // R2-1: 5 s
	if err != nil {
		return 0, err
	}
	live.mu.Lock()
	n := 0
	top := st.maxMaster
	var aids []int64
	ents := reVoucher.FindAllString(raw, -1)
	sort.SliceStable(ents, func(i, j int) bool {
		return toI64(tagNum(ents[i], "ALTERID")) < toI64(tagNum(ents[j], "ALTERID"))
	})
	for _, m := range ents {
		g := tagValue(m, "GUID")
		a, mid := toI64(tagNum(m, "ALTERID")), toI64(tagNum(m, "MASTERID"))
		d := normDate(tagValue(m, "DATE"))
		if g == "" || a <= from || (len(d) == 8 && d[:6] != ym) || liveInWindow(key, a) {
			continue
		}
		if a <= r.target {
			r.found[a] = true
		}
		aids = append(aids, a)
		if mid > top {
			top = mid
		}
		ev := "altered"
		if st.maxMaster > 0 && mid > st.maxMaster {
			ev = "created"
		}
		id := liveLineID("slice", guid, g, fmt.Sprint(a))
		if live.sent[id] || live.queued[id] {
			continue
		}
		c := &change{company: company, companyGuid: guid, event: ev, guid: g, masterId: fmt.Sprint(mid), alterId: fmt.Sprint(a), vchDate: d, source: "slice",
			lineId: id, saveMs: -1, readAt: nowFn(), at: nowFn().In(liveZone).Format(time.RFC3339)}
		liveQueueAdd(c)
		n++
	}
	st.maxMaster = top
	if int64(len(r.found)) >= r.target-r.from || ym <= r.earliest {
		st.seen = r.target
		for _, a := range aids {
			if a > st.seen {
				st.seen = a
			}
		}
		st.round = nil
	} else {
		r.ym = fromTallyDate(ym+"01").AddDate(0, -1, 0).Format("200601")
	}
	live.mu.Unlock()
	liveSaveOffsets()
	return n, nil
}
