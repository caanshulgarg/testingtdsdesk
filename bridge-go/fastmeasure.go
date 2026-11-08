// next-fast-measure (the owner's "ok to build faster old books", 08-Nov-2026; docs/fast-entries-design.md section 9b,
// docs/fast-entries-measure-steps.md): "Measure the fast read (ZZ TEST only)", a tray item. Before FastEntries may be
// switched on for a computer, its two window requests (FinComWindowHeads, FinComVoucherWindow; 2.5.7, unchanged) are
// timed on that computer's own TallyPrime, on a company named exactly ZZ TEST, open alone.
//
// Started by a person only: the tray item (a web page, FinCom's own included, is refused: server.go). Refused unless the
// one company open in this bridge's own Tally is named exactly "ZZ TEST", its starting point is recorded, and FastEntries
// is OFF. The fixed plan (section 9b scaled to one company), one request at a time, the six conditions of the period
// read before every request (pullMayAsk: postings first, nobody working in Tally, ...), each request stopped at 2 s:
//  1. find the busiest day: W1 over 7-day windows back from today, at most 53 (a year);
//  2. W1 windows of 2, 7, 14 and 31 days ending at the busiest day;
//  3. W2 groups of 10, 50 and 100 entries over 1, 3 and 7 days ending at that day, each group's entries then asked one
//     by one with FinComVoucherObject (unchanged) and compared as FinCom keeps them (50 entries at most in all).
//
// The run STOPS at the first request over 2 s, or one during which Tally's window did not answer for 1 s or more. What
// is kept and sent to FinCom (tally-ingest kind fast_measure) is per request: its kind, days, rows, Tally's time, the
// longest window hold, and for W2 the counts of entries the same / different / left for one by one with the NAMES of the
// fields that differed; with TallyPrime's version (tally.exe's file version) and the bridge's. No entry data: no
// GUID, number, date of an entry, party, ledger, amount or narration. Nothing is written to Tally. No AI.
package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const fastMeasureCompany = "ZZ TEST"

// the tray's words for it (win_tray.go names no company itself: round 21's check)
const (
	fastMeasureMenuText = "Measure the fast read (" + fastMeasureCompany + " only)"
	fastMeasureConfirm  = "Measure the fast read on " + fastMeasureCompany + "?\n\nRead only: FinCom Bridge asks Tally for lists of entries and groups of entries of " + fastMeasureCompany +
		", one request at a time, only while nobody is working in Tally, and stops at once if Tally takes longer than 2 seconds or its window stops answering for 1 second. Nothing is changed in Tally. The times (no entry data) go to FinCom.\n\n" +
		fastMeasureCompany + " must be the only company open. It takes a few minutes."
	fastMeasureRunning = "Measuring the fast read on " + fastMeasureCompany + ": one request at a time, a few minutes. A message box says the result."
)

var fastMeasure = struct {
	mu      sync.Mutex
	last    M
	running atomic.Bool
}{}

// TallyPrime's version: the file version of this user's tally.exe (no request to Tally); the tests replace it
var tallyVersionFn = platTallyVersion

// the plan's sizes
var (
	fastMeasureWins   = []int{2, 7, 14, 31}
	fastMeasureGroups = []int{10, 50, 100}
	fastMeasureSpans  = []int{1, 3, 7}
)

const (
	fastMeasureLocate  = 53   // 7-day windows looked at to find the busiest day (a year)
	fastMeasureCompare = 50   // entries compared with FinComVoucherObject in all
	fastMeasureHoldMs  = 1000 // the run stops at a window hold this long (stricter than the read's 2 s)
	fastMeasurePassMs  = 1500 // the result passes below this worst time
)

// why the measurement may not start now ("" when it may), and the company's GUID
func fastMeasureWhyNot() (string, string) {
	guid, why := fastMeasureWhyNotOf(fmOpenNames())
	if why == "" && windowHoldFn()(time.Now()) < 0 {
		// never run the plan unwatched: the 1 s stop could not see Tally's window
		return "", "FinCom Bridge cannot watch Tally's window on this computer (Tally not shown on this desktop, or the bridge running as a service): open Tally on this desktop, then try again."
	}
	return guid, why
}

// the companies open in this bridge's own Tally, by their names as Tally gives them (NOT companyKey-folded: "ZZ TEST" and
// "zz test" open together are two companies, and the measurement refuses); the tests replace it
var fmOpenNames = func() []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range openCompaniesCached() {
		if s["skipped"] == true || s["ok"] != true || s["mine"] == false {
			continue
		}
		for _, c := range sessCompanies(s) {
			if n := str(c["name"]); n != "" && !seen[n] {
				seen[n] = true
				out = append(out, n)
			}
		}
	}
	return out
}

// ZZ TEST still open alone (checked before every request of the plan)
func fmAloneNow() bool {
	o := fmOpenNames()
	return len(o) == 1 && o[0] == fastMeasureCompany
}

// the company's starting point (startpoint.go; the tests replace it)
var fmStartPoint = startPointOf

func fastMeasureWhyNotOf(open []string) (string, string) {
	switch {
	case len(open) == 0:
		return "", "No company is open in Tally: open ZZ TEST alone, then try again."
	case len(open) > 1:
		return "", "Open ZZ TEST alone in Tally (close the other companies), then try again."
	case open[0] != fastMeasureCompany:
		return "", "This measures only a company named exactly ZZ TEST; the company open in Tally is " + cutRunes(open[0], 80) + "."
	case fastOn():
		return "", "FastEntries is switched on on this computer: switch it off, then measure."
	}
	if _, ok := fmStartPoint(fastMeasureCompany); !ok {
		return "", "ZZ TEST's starting point is not recorded yet: leave it open in Tally for a few minutes, then try again."
	}
	g := heldGUID(fastMeasureCompany)
	if g == "" {
		return "", "The bridge does not hold ZZ TEST's Tally GUID yet: leave it open for a minute, then try again."
	}
	return g, ""
}

// POST /tray/fastmeasure: started at once; GET: how far (the tray polls)
func startFastMeasure() M {
	guid, why := fastMeasureWhyNot()
	if why != "" {
		return M{"ok": false, "error": why}
	}
	if !fastMeasure.running.CompareAndSwap(false, true) {
		return M{"ok": false, "error": "A measurement is already running; wait for its message box."}
	}
	fastMeasure.mu.Lock()
	fastMeasure.last = M{"ok": true, "state": "running", "company": fastMeasureCompany, "at": nowFn().Format(time.RFC3339)}
	fastMeasure.mu.Unlock()
	go func() {
		defer fastMeasure.running.Store(false)
		r := runFastMeasure(fastMeasureCompany, guid)
		r["sent"] = fastMeasureSend(guid, r)
		fastMeasure.mu.Lock()
		fastMeasure.last = r
		fastMeasure.mu.Unlock()
	}()
	return M{"ok": true, "started": true, "company": fastMeasureCompany}
}

func fastMeasureStatus() M {
	fastMeasure.mu.Lock()
	defer fastMeasure.mu.Unlock()
	if fastMeasure.last == nil {
		return M{"ok": true, "state": "none"}
	}
	return fastMeasure.last
}

// the dated guard's exception while the measurement runs: exactly the window or group being asked now, as built, the
// company ZZ TEST, the period read's own background request under the 2 s stop
func fastMeasureExact(tc *TC, x string) bool {
	return fastMeasure.running.Load() && pinCo(x) == fastMeasureCompany && fastExactWith(tc, x, true)
}

// the allow-list's entry for an id: the list in force, and the two window requests while the measurement runs
func allowedEntry(id string) (allowedReq, bool) {
	if a, ok := allowListNow()[id]; ok {
		return a, true
	}
	if fastMeasure.running.Load() {
		a, ok := fastAllowList[id]
		return a, ok
	}
	return allowedReq{}, false
}

// one request of the plan: the six conditions first (waited for, 2 minutes at most), then the request, timed and
// Tally's window watched
type fmAnswer struct {
	raw          string
	err          error
	ms, holdMs   int
	watched      bool
	nothingAsked bool
	otherOpen    bool // another company was open in Tally when the request was due: not asked
}

var fastMeasureWaitMax = 2 * time.Minute

func fastMeasureAsk(company, guid string, x string, guarded func(tc *TC, port int) (string, error)) fmAnswer {
	it := pullItem{Company: company, CGUID: guid}
	end := time.Now().Add(fastMeasureWaitMax)
	port, why := pullMayAsk(it)
	for why != "" {
		if time.Now().After(end) || stopping() {
			// pullMayAsk's words may name another company's entry dates: in this computer's log only, never sent
			writeLog("Fast-read measurement: Tally was not free for " + fmt.Sprint(int(fastMeasureWaitMax.Seconds())) + " s: " + cutRunes(why, 200))
			return fmAnswer{err: errFmNotFree, nothingAsked: true}
		}
		time.Sleep(500 * time.Millisecond)
		port, why = pullMayAsk(it)
	}
	if !fmAloneNow() {
		return fmAnswer{err: errFmOtherOpen, nothingAsked: true, otherOpen: true}
	}
	var a fmAnswer
	var took float64
	tc := recorderTC(func(sec float64) { took += sec })
	held := windowHoldFn()
	t0 := time.Now()
	if x != "" {
		fast.mu.Lock()
		fast.ask = x
		fast.mu.Unlock()
	}
	a.raw, a.err = guarded(tc, port)
	if x != "" {
		fast.mu.Lock()
		fast.ask = ""
		fast.mu.Unlock()
	}
	a.ms = int(took * 1000)
	a.holdMs = held(t0) // from the step's start: a two-request step's pause between its requests is counted too
	if took == 0 {
		a.holdMs = 0
	}
	a.watched = a.holdMs >= 0
	if a.holdMs < 0 {
		a.holdMs = 0
	}
	if took == 0 && (gaveWay(a.err) || errors.Is(a.err, errRetryWait) || errors.Is(a.err, errReadStopped)) {
		a.nothingAsked = true
	}
	return a
}

var (
	errFmNotFree   = errors.New("Tally was not free")
	errFmOtherOpen = errors.New("another company open in Tally")
)

// why a request ends the run ("" when it does not). Fixed words only: what is uploaded never carries Tally's or the
// period read's own text (the details are in this computer's log)
func fastMeasureStop(a fmAnswer) string {
	switch {
	case a.otherOpen:
		return "another company was opened in Tally (ZZ TEST must stay open alone); the measurement stopped there"
	case a.nothingAsked:
		if !errors.Is(a.err, errFmNotFree) {
			writeLog("Fast-read measurement: nothing was sent to Tally: " + cutRunes(errText(a.err), 200))
		}
		return "not measured: Tally was not free (a posting waiting, someone working in Tally, or another read); try again in a few minutes"
	case !a.watched:
		return "Tally's window could not be watched; the measurement stopped there"
	case errors.Is(a.err, errRecorderStop):
		return "Tally took longer than 2 s; the measurement stopped there"
	case a.holdMs >= fastMeasureHoldMs:
		return fmt.Sprintf("Tally's window did not answer for %.1f s; the measurement stopped there", float64(a.holdMs)/1000)
	case a.err != nil:
		// the details only in this computer's log: an error may name an entry (a MasterID, a date), never sent
		writeLog("Fast-read measurement: a request ended the run: " + cutRunes(a.err.Error(), 200))
		if errors.Is(a.err, errBatchInexact) {
			return "Tally's answer to a group was not exactly the entries asked; the measurement stopped there"
		}
		return "Tally did not answer, or its answer could not be used; the measurement stopped there (see the bridge's log)"
	}
	return ""
}

func runFastMeasure(company, guid string) M {
	res := M{"ok": true, "state": "done", "company": company, "at": nowFn().Format(time.RFC3339), "bridge": BridgeVersion,
		"tallyVersion": cutRunes(tallyVersionFn(), 40), "plan": "9b", "results": []any{}}
	var rs []any
	watched := true
	stop := func(e M, a fmAnswer) bool {
		e["ms"], e["holdMs"] = a.ms, a.holdMs
		if !a.watched {
			watched = false
		}
		if s := fastMeasureStop(a); s != "" {
			e["stopped"] = s
			res["stopped"] = s
			rs = append(rs, e)
			return true
		}
		rs = append(rs, e)
		return false
	}
	finish := func() M {
		res["results"], res["watched"] = rs, watched
		fastMeasureVerdict(res)
		writeLog("Fast-read measurement of " + company + ": " + str(res["line"]) + " (nothing written to Tally; no entry data kept or sent)")
		return res
	}
	heads := func(from, to string) ([]pullHead, fmAnswer) {
		x := fastHeadsRequest(company, from, to)
		a := fastMeasureAsk(company, guid, x, func(tc *TC, port int) (string, error) { return invokeTally(tc, port, x, 5) })
		if a.err != nil {
			return nil, a
		}
		if why := tallyCollectionWhy(a.raw); why != "" {
			a.err = errors.New(why)
			return nil, a
		}
		rows, bad := fastRowsOf(a.raw, from, to)
		a.raw = ""
		if bad != "" {
			a.err = errors.New("Tally answered with an entry outside the dates asked (the dates were not applied)")
			return nil, a
		}
		return rows, a
	}
	// 1. the busiest day
	perDay := map[string]int{}
	today := nowFn().Format("20060102")
	for i := 0; i < fastMeasureLocate; i++ {
		to := addDays(today, -7*i)
		from := addDays(to, -6)
		rows, a := heads(from, to)
		e := M{"kind": "locate", "days": 7, "rows": len(rows)}
		if stop(e, a) {
			if a.nothingAsked {
				res["ok"], res["state"], res["error"] = false, "failed", str(res["stopped"])
			}
			return finish()
		}
		for _, h := range rows {
			perDay[h.Date]++
		}
		keepRest(300 * time.Millisecond)
	}
	best, bestN := "", 0
	for d, n := range perDay {
		if n > bestN || n == bestN && d > best {
			best, bestN = d, n
		}
	}
	if best == "" {
		res["ok"], res["state"], res["error"] = false, "failed", "ZZ TEST has no entries in the last year: fill it first (docs/fast-entries-measure-steps.md)"
		return finish()
	}
	busiest31 := 0
	for d, n := range perDay {
		if d <= best && d > addDays(best, -31) {
			busiest31 += n
		}
	}
	res["busiestDay"], res["busiest31"] = bestN, busiest31 // counts only (the day itself is not sent)
	// 2. windows ending at the busiest day
	var wide []pullHead
	for _, n := range fastMeasureWins {
		rows, a := heads(addDays(best, -(n-1)), best)
		if stop(M{"kind": "W1", "days": n, "rows": len(rows)}, a) {
			return finish()
		}
		wide = rows
		keepRest(300 * time.Millisecond)
	}
	// 3. groups over 1, 3 and 7 days, each compared with FinComVoucherObject
	byMid := map[string]pullHead{}
	for _, h := range wide {
		byMid[h.Mid] = h
	}
	compared := 0
	for _, span := range fastMeasureSpans {
		from := addDays(best, -(span - 1))
		for _, n := range fastMeasureGroups {
			e := &fastEng{heads: map[string]pullHead{}, got: map[string]string{}, one: map[string]bool{}, pw: &pullWork{it: pullItem{Company: company, CGUID: guid}}}
			for m, h := range byMid {
				if h.Date >= from && h.Date <= best {
					e.heads[m] = h
					e.want = append(e.want, m)
				}
			}
			sort.Slice(e.want, func(a, b int) bool { return toI64(e.want[a]) < toI64(e.want[b]) })
			g, gf, gt := fastGroup(e, n)
			r := M{"kind": "W2", "days": span, "asked": n, "rows": len(g)}
			if len(g) < 2 {
				r["note"] = "not enough entries"
				rs = append(rs, r)
				continue
			}
			x := fastBatchRequest(company, gf, gt, toI64(g[0]), toI64(g[len(g)-1]))
			a := fastMeasureAsk(company, guid, x, func(tc *TC, port int) (string, error) {
				if err := fastCompanyListed(tc, company, port, liveBodySec()); err != nil {
					return "", err
				}
				return invokeTally(tc, port, x, liveBodySec())
			})
			var got map[string]string
			var single map[string]bool
			if a.err == nil {
				var perr error
				if got, single, perr = fastParse(company, a.raw, g, e.heads, gf, gt); perr != nil {
					a.err = perr
				}
			}
			a.raw = ""
			if stop(r, a) {
				return finish()
			}
			same, differ, oMs, oHold := 0, 0, 0, 0
			fields := map[string]bool{}
			var mids []string
			for m := range got {
				mids = append(mids, m)
			}
			sort.Slice(mids, func(a, b int) bool { return toI64(mids[a]) < toI64(mids[b]) })
			for _, m := range mids {
				if compared >= fastMeasureCompare {
					break
				}
				compared++
				var one map[string]string
				oa := fastMeasureAsk(company, guid, "", func(tc *TC, port int) (string, error) {
					var err error
					one, err = fetchVouchersByMasterListed(tc, company, port, "", []string{m}, liveBodySec(), false)
					return "", err
				})
				oMs, oHold = maxI(oMs, oa.ms), maxI(oHold, oa.holdMs)
				r["objectMs"], r["objectHoldMs"] = oMs, oHold
				if !oa.watched {
					watched = false
				}
				if s := fastMeasureStop(oa); s != "" {
					rs = append(rs, M{"kind": "object", "days": span, "ms": oa.ms, "holdMs": oa.holdMs, "stopped": s})
					res["stopped"] = s
					r["compare"] = M{"same": same, "differ": differ, "left": len(single), "fields": fastSortedKeys(fields)}
					return finish()
				}
				if d := fastFieldDiff(got[m], one[m]); len(d) == 0 {
					same++
				} else {
					differ++
					for _, f := range d {
						fields[f] = true
					}
				}
			}
			r["compare"] = M{"same": same, "differ": differ, "left": len(single), "fields": fastSortedKeys(fields)}
			keepRest(300 * time.Millisecond)
		}
	}
	return finish()
}

func fastSortedKeys(m map[string]bool) []any {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	sort.Strings(k)
	o := []any{}
	for _, x := range k {
		if len(o) >= 40 {
			break
		}
		o = append(o, x)
	}
	return o
}

var reFmRemote = regexp.MustCompile(` REMOTEID="[^"]*"`)

// the NAMES of the fields whose values differ between two entries as FinCom keeps them (paths of leaf tags, e.g.
// "ALLLEDGERENTRIES.LIST/AMOUNT"); nil when they are the same (Tally's REMOTEID attribute aside, as the 2.4.9 gate)
func fastFieldDiff(a, b string) []string {
	a, b = reFmRemote.ReplaceAllString(a, ""), reFmRemote.ReplaceAllString(b, "")
	if a == b {
		return nil
	}
	va, vb := fastLeaves(a), fastLeaves(b)
	diff := map[string]bool{}
	for k, x := range va {
		if strings.Join(x, "\x00") != strings.Join(vb[k], "\x00") {
			diff[k] = true
		}
	}
	for k := range vb {
		if _, ok := va[k]; !ok {
			diff[k] = true
		}
	}
	if len(diff) == 0 {
		diff["(the order or the attributes of the fields)"] = true
	}
	var o []string
	for k := range diff {
		o = append(o, cutRunes(k, 120))
	}
	sort.Strings(o)
	return o
}

func fastLeaves(v string) map[string][]string {
	out := map[string][]string{}
	root := fastTree(v)
	if root == nil {
		return out
	}
	var walk func(e *fastEl, path string)
	walk = func(e *fastEl, path string) {
		for _, k := range e.kids {
			p := k.name
			if path != "" {
				p = path + "/" + k.name
			}
			if k.hasKids {
				walk(k, p)
				continue
			}
			out[p] = append(out[p], strings.TrimSpace(k.text))
		}
	}
	walk(root, "")
	for k := range out {
		sort.Strings(out[k])
	}
	return out
}

// pass: every request under 1.5 s, every window hold under 1 s, every compared entry the same, the plan run to its end
func fastMeasureVerdict(res M) {
	worst, hold, differ, n := 0, 0, 0, 0
	for _, x := range arr(res["results"]) {
		e := obj(x)
		worst = maxI(worst, maxI(toInt(e["ms"]), toInt(e["objectMs"])))
		hold = maxI(hold, maxI(toInt(e["holdMs"]), toInt(e["objectHoldMs"])))
		if c := obj(e["compare"]); c != nil {
			differ += toInt(c["differ"])
			n += toInt(c["same"]) + toInt(c["differ"])
		}
	}
	res["worstMs"], res["worstHoldMs"], res["compared"], res["differ"] = worst, hold, n, differ
	pass := res["ok"] == true && res["stopped"] == nil && worst < fastMeasurePassMs && hold < fastMeasureHoldMs && differ == 0 && n > 0 && res["watched"] == true
	res["pass"] = pass
	line := fmt.Sprintf("worst %.2f s, Tally's window held %.2f s at most, %d of %d entries the same", float64(worst)/1000, float64(hold)/1000, n-differ, n)
	switch {
	case str(res["error"]) != "":
		line = str(res["error"])
	case res["stopped"] != nil:
		line += " · " + str(res["stopped"])
	case res["watched"] != true:
		line += " · Tally's window could not be watched from here (not a pass)"
	}
	res["line"] = map[bool]string{true: "PASS: ", false: "NOT A PASS: "}[pass] + line
}

// the result to FinCom (tally-ingest kind fast_measure); false when FinCom did not take it (it stays in the log and the
// tray's box)
func fastMeasureSend(guid string, res M) bool {
	r := invokeCloud(M{"kind": "fast_measure", "company": fastMeasureCompany, "company_guid": guid, "result": fastMeasureUpload(res)}, 30)
	ok := r.code == 200 && r.json != nil && truthy(r.json["ok"])
	if !ok {
		writeLog("Fast-read measurement: FinCom did not take the result (" + or(r.err, fmt.Sprint("HTTP ", r.code)) + "); it is in this log")
	}
	return ok
}

// exactly the fields the upload carries (a copy: nothing else of the run is sent)
func fastMeasureUpload(res M) M {
	keep := func(e M, keys ...string) M {
		o := M{}
		for _, k := range keys {
			if v, ok := e[k]; ok {
				o[k] = v
			}
		}
		return o
	}
	var rs []any
	for _, x := range arr(res["results"]) {
		e := obj(x)
		o := keep(e, "kind", "days", "asked", "rows", "ms", "holdMs", "objectMs", "objectHoldMs", "stopped", "note")
		if c := obj(e["compare"]); c != nil {
			o["compare"] = keep(c, "same", "differ", "left", "fields")
		}
		rs = append(rs, o)
	}
	o := keep(res, "ok", "state", "at", "bridge", "tallyVersion", "plan", "busiestDay", "busiest31", "stopped", "error", "watched",
		"worstMs", "worstHoldMs", "compared", "differ", "pass", "line")
	o["results"] = rs
	return o
}
