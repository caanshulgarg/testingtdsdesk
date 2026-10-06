// Bridge 2.3.1, part B (the owner's scope of 06-Oct-2026): "Masters, one change: When Tally's master counter moves, ask
// only for ledgers created or altered since the last number. Keep name, group, GSTIN, PAN, state and opening balance
// current. If an entry uses a ledger FinCom does not have, fetch the ledger first, then apply the entry." Approved: read
// only, inside the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only.
//
//  1. The counter. The light check (startpoint.go, every 10 minutes per open company) reads Tally's ALTMSTID. When it is
//     above the last number processed for the company (sync\ledger-changes.json, per company and GUID; the first number is
//     the starting point's ALTMSTID), FinComLedgerChanges asks Tally for the ledgers whose AlterID is in (last, ALTMSTID]:
//     a Ledger collection, the full ledger list's own fields (ledFetch) and nothing else, 200 AlterIDs a request
//     (LedgerChangesSpan) so no answer holds more than 200 ledgers, each request continuing from the span the one before
//     ended at, 10 requests a check at most (the next check goes on). A span over 5,000 (a big import of masters) is left
//     to the full ledger list (Update now, the nightly run) and said in the log. The ledgers go to FinCom's cloud as
//     tally-ingest "ledger_changes" (the ledger list's row shape): FinCom keeps name, group, GSTIN, PAN, state and opening
//     current; it marks nothing gone, renames nothing and moves no ledger to another group (2.3.2). The number moves on
//     only when FinCom's cloud took them (a 200 answer, ok).
//  2. The ledger an entry needs. FinCom's cloud holds an entry naming a ledger it does not have ("waiting for the ledger
//     '<name>' from Tally") and names the ledger in the beat's answer (ledgersWanted: company, company GUID, name). The
//     bridge asks its own Tally for each by its name, one request a ledger (FinComLedgerByName: the same collection and
//     fields, filtered by the one name; an entry names its ledgers by name only, and an older ledger is not reached by
//     AlterID), at most once in 10 minutes per name, and sends what Tally gave as "ledger_changes" (why: wanted). FinCom
//     then lists the held entry in the beat's refetch, and the bridge asks Tally for the entry again (recorder_resolve.go):
//     the ledger is in first, then the entry.
//
// Both are background reads through the one gate to Tally (recorderTC): never during a posting (and they give way to
// one), stopped hard at 2 s (RecorderLimitMs), a request over 2 s turns them off for the company until the owner switches
// where the changes come from (the 2 s rule, recorder_probes.go: "ledgers"); only a company open in this bridge's own
// Windows user's Tally (recorder_owntally.go), never another user's Tally on the computer.
package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	ledChangesID = "FinComLedgerChanges"
	ledByNameID  = "FinComLedgerByName"
)

func ledChangesSpan() int      { return keepNum("LedgerChangesSpan", 200) }
func ledChangesMaxReqs() int   { return keepNum("LedgerChangesMaxReqs", 10) }
func ledChangesMaxSpan() int64 { return int64(keepNum("LedgerChangesMaxSpan", 5000)) }
func ledChangesSec() int       { return keepNum("LedgerChangesSec", 5) }

// the ledgers whose AlterID is in (after, upto]: the full list's fields; "" when the span is not one (upto above after)
func ledgerChangesRequest(company string, after, upto int64) string {
	if after < 0 || upto <= after {
		return ""
	}
	return fcCollection(ledChangesID, company, "", "Ledger", ledFetch, alterRange(after, upto))
}

// the one ledger of that name: the full list's fields; "" when the name cannot go in a TDL string
func ledgerByNameRequest(company, name string) string {
	if !ledNameOK(name) {
		return ""
	}
	return fcCollection(ledByNameID, company, "", "Ledger", ledFetch, `$Name = "`+name+`"`)
}

func ledNameOK(s string) bool {
	return s != "" && s == strings.TrimSpace(s) && len([]rune(s)) <= 200 && !strings.ContainsAny(s, "\"") && !re(`[\x00-\x1f\x7f]`).MatchString(s)
}

// --- the last number processed, per company and GUID (sync\ledger-changes.json)
var ledChMu sync.Mutex

func ledChFile() string { return sp("ledger-changes.json") }

func ledChangesAfter(company, guid string) (int64, bool) {
	ledChMu.Lock()
	defer ledChMu.Unlock()
	e := obj(readObjFile(ledChFile())[companyKey(company)+"|"+guid])
	if e == nil {
		return 0, false
	}
	return toI64(e["after"]), true
}

func ledChSet(company, guid string, after int64) {
	ledChMu.Lock()
	defer ledChMu.Unlock()
	o := readObjFile(ledChFile())
	if o == nil {
		o = M{}
	}
	o[companyKey(company)+"|"+guid] = M{"company": company, "guid": guid, "after": after, "at": nowS()}
	if err := saveFile(ledChFile(), jsonText(o)); err != nil {
		writeLog("Ledger changes: " + ledChFile() + " could not be written: " + err.Error())
	}
}

// the starting point's ALTMSTID (the first number), as startPointOf picks the entry
func startMasterOf(company string) (int64, bool) {
	held := heldGUID(company)
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	all, _ := readStartPoints()
	all = spWithPending(all)
	e, _ := startPointPick(startPointsOf(all, company), held, spGUID[company])
	if e == nil {
		return 0, false
	}
	return toI64(e["altmstid"]), true
}

// the port of this bridge's own Tally with the company open; why not, in words
func ledOwnPort(company, guid string, preferred int) (int, string) {
	live.mu.Lock()
	liveFresh()
	open := liveOwnOpenNow(guid, company)
	live.mu.Unlock()
	if !open {
		return 0, "the company is not open in this bridge's own Tally"
	}
	port, err := findCompanyPortBg(company, preferred)
	if err != nil {
		return 0, err.Error()
	}
	for _, s := range openCompaniesCached() {
		if toInt(s["port"]) == port && s["mine"] == false {
			return 0, fmt.Sprintf("the Tally on port %d is another Windows user's", port)
		}
	}
	return port, ""
}

// --- 1. after the light check: the ledgers changed since the last number (the number of ledgers sent)
func ledChangesAfterLightCheck(company string, port int) {
	if n, err := ledChangesCheckOn(company, port); err != nil && !gaveWay(err) {
		writeLog("Ledger changes for " + company + ": " + cutRunes(err.Error(), 200))
	} else if n > 0 {
		writeLog(fmt.Sprintf("Ledger changes for %s: %d ledger(s) created or altered in Tally sent to FinCom", company, n))
	}
}

func ledChangesCheck(company string) (int, error) { return ledChangesCheckOn(company, 0) }

func ledChangesCheckOn(company string, preferred int) (int, error) {
	if !cloudOn() {
		return 0, nil
	}
	cur, guid := latestNumbers(company)
	if cur == nil {
		return 0, nil
	}
	held := heldGUID(company)
	if guid == "" {
		guid = held
	}
	if guid == "" || (held != "" && !strings.EqualFold(held, guid)) {
		return 0, nil // no GUID, or another company's under this name: nothing is asked
	}
	m := toI64(cur["altmstid"])
	after, ok := ledChangesAfter(company, guid)
	if !ok {
		sp, has := startMasterOf(company)
		if !has {
			return 0, nil // no starting point recorded: nothing of the company is taken (as for the entries)
		}
		after = sp
		ledChSet(company, guid, after)
	}
	if m <= after {
		return 0, nil
	}
	key := companyKey(company) + "|" + guid
	if liveIsOff("ledgers", key) || postingGoing() {
		return 0, nil // off by the 2 s rule (the owner switches it back on), or a posting goes first
	}
	if m-after > ledChangesMaxSpan() {
		ledChSet(company, guid, m)
		writeLog(fmt.Sprintf("Ledger changes for %s: Tally's master counter moved by %d since %d (more than %d): not asked one by one; the full ledger list (Update now or the nightly run) brings them",
			company, m-after, after, ledChangesMaxSpan()))
		return 0, nil
	}
	port, why := ledOwnPort(company, guid, preferred)
	if why != "" {
		liveSayOnce("ledch|"+key+"|"+why, "Ledger changes for "+company+": not asked: "+why)
		return 0, nil
	}
	rows, reached, reqs, err := ledAskChanges(company, key, port, after, m)
	if reached <= after {
		return 0, err
	}
	if len(rows) > 0 {
		if serr := ledSend(company, guid, rows, "counter", after, reached); serr != nil {
			return 0, serr // the number stays: asked and sent again at the next check
		}
	}
	ledChSet(company, guid, reached)
	writeLog(fmt.Sprintf("Ledger changes for %s: Tally's master counter %d -> %d: %d request(s) for AlterID %d-%d, %d ledger(s)%s; the last number is %d",
		company, after, m, reqs, after+1, reached, len(rows), map[bool]string{true: " sent to FinCom", false: ""}[len(rows) > 0], reached))
	return len(rows), err
}

// the ledgers with an AlterID in (after, m], 200 AlterIDs a request, 10 requests at most; how far it got
func ledAskChanges(company, key string, port int, after, m int64) ([]ledRow, int64, int, error) {
	var rows []ledRow
	a, reqs := after, 0
	for reqs < ledChangesMaxReqs() && a < m {
		if postingGoing() {
			return rows, a, reqs, errBackoff
		}
		upto := a + int64(ledChangesSpan())
		if upto > m {
			upto = m
		}
		took := -1.0
		tc := recorderTC(func(sec float64) { took = sec })
		raw, err := invokeTally(tc, port, ledgerChangesRequest(company, a, upto), ledChangesSec())
		reqs++
		if took > liveLimitSec() {
			liveTurnOff("ledgers", key, company, took)
			if err == nil {
				err = fmt.Errorf("Tally took %.1f s", took)
			}
			return rows, a, reqs, err
		}
		if err != nil {
			return rows, a, reqs, err
		}
		if !strings.Contains(raw, "<ENVELOPE") {
			return rows, a, reqs, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
		}
		got, _ := ledRowsOf(raw)
		for _, r := range got {
			if r.alter > a && r.alter <= upto {
				rows = append(rows, r)
			}
		}
		a = upto
		if a < m {
			keepRest(200 * time.Millisecond)
		}
	}
	return rows, a, reqs, nil
}

// to FinCom's cloud: tally-ingest "ledger_changes", the ledger list's rows [guid, MasterID, AlterID, name, parent,
// opening, GSTIN, PAN, openingChanged (0: FinCom compares with the opening it was sent), state, deductee type], 500 a call; nil only when
// every call was taken
func ledSend(company, guid string, rows []ledRow, why string, after, upto int64) error {
	sort.Slice(rows, func(i, j int) bool { return rows[i].alter < rows[j].alter })
	for len(rows) > 0 {
		n := minI(500, len(rows))
		led := []any{}
		for _, r := range rows[:n] {
			led = append(led, []any{r.guid, r.mid, r.alter, r.name, r.parent, r.open, r.gstin, r.pan, 0, r.state, r.dtype})
		}
		body := M{"kind": "ledger_changes", "company": company, "company_guid": guid, "ledgers": led, "why": why}
		if why == "counter" {
			body["after"], body["upto"] = after, upto
		}
		r := invokeCloud(body, 60)
		if r.code == 409 {
			return errors.New("FinCom says this company is not linked")
		}
		if r.code != 200 || r.json == nil || !truthy(r.json["ok"]) {
			w := or(r.err, fmt.Sprint("HTTP ", r.code))
			if r.json != nil && str(r.json["error"]) != "" {
				w += ": " + str(r.json["error"])
			}
			return errors.New("FinCom did not take the ledgers (" + cutRunes(w, 160) + "); asked and sent again later")
		}
		// what FinCom left for 2.3.2 (a ledger renamed or moved to another group in Tally): said in the log
		for _, k := range arr(r.json["kept"]) {
			writeLog("Ledger changes for " + company + ": " + cutRunes(str(k), 300))
		}
		rows = rows[n:]
	}
	return nil
}

// --- 2. the beat's ledgersWanted: [{company, company_guid, name}], at most 20; one Tally request per ledger, by name
var (
	ledWantMu    sync.Mutex
	ledWantAt    = map[string]time.Time{}
	ledWantNever = map[string]bool{} // review L4: names Tally has no ledger of: not asked again in this run
	ledWantBusy  atomic.Bool
)

func applyLedgersWanted(j M) {
	if len(arr(j["ledgersWanted"])) == 0 || !ledWantBusy.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer ledWantBusy.Store(false)
		ledWantedRun(j)
	}()
}

func ledWantedRun(j M) {
	rows := arr(j["ledgersWanted"])
	if len(rows) > 20 {
		rows = rows[:20]
	}
	type want struct{ company, guid string }
	names := map[want][]string{}
	heldAt := map[string]time.Time{} // re-review M-A: the latest hold FinCom says waits for each name
	var order []want
	for _, x := range rows {
		e := obj(x)
		co, cg, name := cutRunes(strings.TrimSpace(str(e["company"])), 200), cut(cleanGUID(str(e["company_guid"])), 100), str(e["name"])
		held := heldGUID(co)
		if co == "" || cg == "" || held == "" || !strings.EqualFold(held, cg) {
			continue // not the company this bridge holds under that name
		}
		if !ledNameOK(name) {
			// review L4: said once, never asked (a TDL string cannot hold it)
			bk := "bad|" + companyKey(co) + "|" + strings.ToLower(name)
			ledWantMu.Lock()
			said := ledWantNever[bk]
			ledWantNever[bk] = true
			ledWantMu.Unlock()
			if !said {
				writeLog("Ledger '" + cutRunes(name, 200) + "' of " + co + ": FinCom waits for it, but it cannot be asked from Tally by its name (a quote mark, a line break or over 200 characters); its entry stays held: uploading that day's Day Book settles it")
			}
			continue
		}
		w := want{co, held}
		if names[w] == nil {
			order = append(order, w)
		}
		if !contains(names[w], name) {
			names[w] = append(names[w], name)
		}
		if h, err := time.Parse(time.RFC3339Nano, str(e["heldAt"])); err == nil {
			k := companyKey(co) + "|" + held + "|" + strings.ToLower(name)
			if h.After(heldAt[k]) {
				heldAt[k] = h
			}
		}
	}
	gap := time.Duration(keepNum("LedgerWantedGapSec", 600)) * time.Second
	for _, w := range order {
		key := companyKey(w.company) + "|" + w.guid
		if !cloudOn() || liveIsOff("ledgers", key) || postingGoing() {
			continue
		}
		port, why := ledOwnPort(w.company, w.guid, 0)
		if why != "" {
			liveSayOnce("ledwant|"+key+"|"+why, "Ledgers FinCom waits for in "+w.company+": not asked: "+why)
			continue
		}
		var got []ledRow
		var asked []string
		for _, name := range names[w] {
			k := key + "|" + strings.ToLower(name)
			ledWantMu.Lock()
			if ledWantNever[k] {
				ledWantMu.Unlock()
				continue // review L4: Tally has no ledger of that name: said once, not asked again in this run
			}
			last, had := ledWantAt[k]
			// re-review M-A: a hold after the last ask has its own fetch (only a fetch made for that hold maps its entry)
			if had && nowFn().Sub(last) < gap && !nowFn().Before(last) && !heldAt[k].After(last) {
				ledWantMu.Unlock()
				continue // asked a short while ago
			}
			ledWantAt[k] = nowFn()
			ledWantMu.Unlock()
			unmark := func() {
				ledWantMu.Lock()
				delete(ledWantAt, k)
				ledWantMu.Unlock()
			}
			if postingGoing() {
				unmark()
				break
			}
			took := -1.0
			tc := recorderTC(func(sec float64) { took = sec })
			raw, err := invokeTally(tc, port, ledgerByNameRequest(w.company, name), ledChangesSec())
			if took > liveLimitSec() {
				liveTurnOff("ledgers", key, w.company, took)
				break
			}
			if gaveWay(err) {
				unmark()
				break
			}
			if err != nil || !strings.Contains(raw, "<ENVELOPE") {
				writeLog("Ledger " + name + " of " + w.company + ": not read from Tally (" + cutRunes(or(errText(err), "an answer that could not be read"), 160) + "); its entry stays held")
				continue
			}
			rs, _ := ledRowsOf(raw)
			n := 0
			for _, r := range rs {
				if strings.EqualFold(r.name, name) {
					got = append(got, r)
					n++
				}
			}
			if n == 0 {
				ledWantMu.Lock()
				ledWantNever[k] = true
				ledWantMu.Unlock()
				writeLog("Ledger " + name + " of " + w.company + ": Tally has no ledger of that name (FinCom may keep it cleaned, e.g. a line break as a space); its entry stays held (uploading that day's Day Book settles it); not asked again")
				continue
			}
			asked = append(asked, name)
		}
		if len(got) == 0 {
			continue
		}
		if err := ledSend(w.company, w.guid, got, "wanted", 0, 0); err != nil {
			writeLog("Ledgers FinCom waits for in " + w.company + ": " + err.Error())
			ledWantMu.Lock()
			for _, name := range asked {
				delete(ledWantAt, key+"|"+strings.ToLower(name))
			}
			ledWantMu.Unlock()
			continue
		}
		for _, name := range asked {
			writeLog("Ledger " + name + " of " + w.company + ": fetched from Tally before its entry (FinCom held the entry for it); the entry follows")
		}
	}
}
