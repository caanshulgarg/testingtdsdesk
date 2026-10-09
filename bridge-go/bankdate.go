// next-bankdate (FinCom Bridge 2.4.0, the owner's agreed fallback). Setting a bank date in Tally's Bank Reconciliation
// fires NO add-on event (probe runs 37763910797, 37766812255, 37770857500 and 37776378311, TallyPrime 3.0 .. 7.1): the
// voucher's AlterID jumps to the company's new ALTVCHID (ALTVCHID rises by exactly 1 per bank-dated voucher) and the bank
// date is stored (BANKALLOCATIONS.BANKERSDATE), which FinComVoucherObject's whole-voucher answer carries (an approved field:
// the strip keeps it). Without a line, FinCom would keep the entry without its bank date until a Day Book.
//
// The sign is therefore ALTVCHID moving by more than the add-on's lines explain (each voucher save, delete, cancel or
// import the add-on wrote a line for moves it by one; FinCom's own postings are their clean posting windows and their
// lines carry FinCom's id, so they count once). Only requests already on the allow-list are sent, exactly as built:
// FinComCompany (the light check's, every 10 minutes a company), the undated TDSDeskKeepList "above an AlterID" with
// MASTERID (keepListAboveRequest, from the bank route's last processed number, never below the starting point), and
// FinComVoucherObject (one MasterID a request).
//
//   - Small companies (the route "small", where every company starts): the light check that sees an unexplained move asks
//     the list above the last processed number once, with the 2 s rule; each entry listed that the add-on's own read did
//     not already take at that AlterID is re-read with FinComVoucherObject (one at a time, a posting and a waiting save
//     first, BankPerTurn a turn, one turn every BankGapMs; the 2 s rule, and the 2.3.4 rule: an entry whose read was
//     stopped or not answered is asked once more BankAgainMin (5 minutes) later, never a third time, and is then said in
//     plain words; an entry waiting for its one more ask holds back nothing else) and sent as an
//     altered line with Tally's entry (source "bankdate"), so FinCom stores the bank date.
//   - "Small" is measured, never guessed: a list stopped at the 2 s rule, or answered slower than BankSmallMs (1,500 ms),
//     moves the company to the nightly route (said once in the log). The stopped list is not asked again by day: no loop.
//   - Large companies (the route "night"): one list a night, in the night's window (nightWindow: from KeepDailyAt, 19:00,
//     to the next office start; release-240, the owner's decision of 2026-10-09) and outside office hours (KeepOfficeFrom .. KeepOfficeTo, never on a Sunday counted as office), not
//     while FinCom is in use (NightlyQuietMin), never while the tray's pause or FinCom's read stop is on, never during a
//     posting; the list stopped at BankNightLimitMs (10,000 ms: 10 s for the nightly bank-date list, outside office hours
//     only, by the owner's decision of 2026-10-09; never sent inside office hours in the PC's time or in IST, nor when
//     its 10 s would reach them; every other request keeps the 2 s rule); at most BankMax (500) entries a night (the
//     rest the next night), read one a turn every BankNightGapMs; a list stopped even then: one plain alert, not asked again
//     that night.
//   - Renumbering (renumber.go) and this route share what each read from Tally (vchReadPut / vchReadGet): an entry read by
//     one is not read again by the other, and one line goes to FinCom for it.
//   - A company marked slow (its entry fetch over 2 s, slowco.go) is not asked at all: one plain alert.
//
// Alerts (the log and the beat's bankAlerts): "N bank dates set in Tally may not have reached FinCom for <company>; upload
// the Day Book from <date>". Nothing is added to the allow-list and no request shape changes (TestAllowListUnchanged).
package main

import (
	"errors"
	"fmt"
	"html"
	"sort"
	"strings"
	"sync"
	"time"
)

func bankGap() time.Duration { return time.Duration(keepNumZero("BankGapMs", 1000)) * time.Millisecond }
func bankNightGap() time.Duration {
	return time.Duration(keepNumZero("BankNightGapMs", 1000)) * time.Millisecond
}
func bankPerTurn() int   { return keepNum("BankPerTurn", 10) }
func bankMax() int       { return keepNum("BankMax", 500) }
func bankSmallMs() int64 { return int64(keepNum("BankSmallMs", 1500)) }

// release-240, the owner's decision of 2026-10-09 ("You can take 10 sec"): 10 s for the nightly bank-date list, outside
// office hours only. 10,000 ms by default (04ef3782 had 2,000 while the answer was pending); stopped then, one plain
// alert, not asked again that night. Only this one request (bankNightTurn's list) has it: every other request keeps the
// 2-second rule (RecorderLimitMs)
func bankNightLimitMs() int {
	return minI(keepNum("BankNightLimitMs", 10000), 10000) // release-240 review Low: never above 10 s, whatever the settings say
}

// India's time (no daylight saving; a fixed zone needs no time-zone data on Windows)
var istZone = time.FixedZone("IST", 5*3600+1800)

// the nightly list is never sent inside office hours (officeHoursAt: 09:00 to 19:00, Monday to Saturday), whether in
// the PC's own time or in IST, nor when its limit would reach into them
func bankNightListInOfficeHours(now time.Time) bool {
	end := now.Add(time.Duration(bankNightLimitMs()) * time.Millisecond)
	for _, t := range []time.Time{now, end} {
		if officeHoursAt(t) || officeHoursAt(t.In(istZone)) {
			return true
		}
	}
	return false
}

// one entry to read again
type bankCand struct {
	Mid, GUID, Day string
	Alter          int64
	Asks           int    // reads that reached Tally and were stopped or not answered (2 at most: once, and once more)
	Night          bool   // listed by the nightly check: read in the night's window only
	Next           string // after a stopped read: not asked again before this (RFC3339; BankAgainMin, 5 minutes)
}

// next-renumber's review rule (the owner's answer B), shared: one more ask RecorderStopRetrySec (5 minutes) later
func bankAgain() time.Duration { return liveStopRetry() }

// not waiting for its one more ask
func (c bankCand) due(now time.Time) bool {
	t, err := time.Parse(time.RFC3339, c.Next)
	return c.Next == "" || err != nil || !now.Before(t)
}

// a company's bank route
type bankCo struct {
	Company, CGUID string
	Seen           int64  // ALTVCHID processed up to
	Route          string // small | night
	Why            string
	ListMs         int64  // the last list's time (-1: stopped)
	Night          string // the night (its window's start, yyyymmdd) the nightly list went
	ReadAt         string // release-240: when Tally's list was last read (RFC3339); the nightly route's 3-day notice
	Cands          []bankCand
	// 2.4.1 (the coordinator's item from the real-Tally dry run 37938029402): kept in bankdate.json WITH Seen (one write),
	// no longer this run only: a restart before the next light check forgot the add-on's lines and read again (and sent
	// again) the entries they explained
	addonN int              // the add-on's voucher lines read since Seen moved
	addon  map[string]int64 // MasterID -> the AlterID its add-on line's read took (0: not read yet)
	listed map[string]bool  // MasterIDs the last list named (their late add-on lines are not counted again)
	// 2.4.1 (the real-Tally gate 37981697177, upg u2): the saved state has no add-on line count (a bridge older than 2.4.1
	// wrote it): its counter is not trusted against this run's lines; Tally's counter of now is taken (bankFromOlder)
	older bool
}

var bank = struct {
	mu     sync.Mutex
	dir    string
	cos    map[string]*bankCo
	alerts map[string]M
	said   map[string]bool
	lastAt time.Time
	busy   bool
}{}

func bankFile() string { return sp("bankdate.json") }

// under bank.mu
func bankFresh() {
	if bank.dir == syncDir() && bank.cos != nil {
		return
	}
	bank.dir, bank.cos, bank.alerts, bank.said, bank.lastAt = syncDir(), map[string]*bankCo{}, map[string]M{}, map[string]bool{}, time.Time{}
	o := readObjFile(bankFile())
	if o == nil {
		return
	}
	for k, v := range obj(o["companies"]) {
		e := obj(v)
		if e == nil || str(e["company"]) == "" {
			continue
		}
		st := &bankCo{Company: str(e["company"]), CGUID: str(e["cguid"]), Seen: toI64(e["seen"]), Route: or(str(e["route"]), "small"), Why: str(e["why"]),
			ListMs: toI64(e["listMs"]), Night: str(e["night"]), ReadAt: str(e["readAt"]), addon: map[string]int64{}, listed: map[string]bool{}}
		if _, has := e["addonN"]; !has {
			st.older = true
		}
		if n := toI64(e["addonN"]); n > 0 && n < 1<<31 {
			st.addonN = int(n)
		}
		for mid, a := range obj(e["addon"]) {
			if onlyDigits(mid) == mid && mid != "" && len(st.addon) < 20000 {
				st.addon[mid] = toI64(a)
			}
		}
		for _, mid := range arr(e["listed"]) {
			if m := str(mid); m != "" && onlyDigits(m) == m && len(st.listed) < 20000 {
				st.listed[m] = true
			}
		}
		for _, x := range arr(e["cands"]) {
			c := obj(x)
			st.Cands = append(st.Cands, bankCand{Mid: str(c["mid"]), GUID: str(c["guid"]), Day: str(c["day"]), Alter: toI64(c["alter"]), Asks: toInt(c["asks"]), Night: c["night"] == true, Next: str(c["next"])})
		}
		bank.cos[k] = st
	}
	for k, v := range obj(o["alerts"]) {
		if e := obj(v); e != nil {
			bank.alerts[k] = e
		}
	}
}

// under bank.mu
func bankSave() {
	cs := M{}
	for k, st := range bank.cos {
		l := []any{}
		for _, c := range st.Cands {
			l = append(l, M{"mid": c.Mid, "guid": c.GUID, "day": c.Day, "alter": c.Alter, "asks": c.Asks, "night": c.Night, "next": c.Next})
		}
		ad, ls := M{}, []any{}
		for mid, a := range st.addon {
			ad[mid] = a
		}
		for mid := range st.listed {
			ls = append(ls, mid)
		}
		sort.Slice(ls, func(i, j int) bool { return str(ls[i]) < str(ls[j]) })
		cs[k] = M{"company": st.Company, "cguid": st.CGUID, "seen": st.Seen, "route": st.Route, "why": st.Why, "listMs": st.ListMs, "night": st.Night, "readAt": st.ReadAt, "cands": l,
			"addonN": st.addonN, "addon": ad, "listed": ls}
	}
	a := M{}
	for k, e := range bank.alerts {
		a[k] = e
	}
	if err := saveFile(bankFile(), jsonText(M{"companies": cs, "alerts": a, "at": nowS()})); err != nil {
		writeLog("Bank dates: " + bankFile() + " could not be written: " + err.Error())
	}
}

func bankKey(company, cguid string) string {
	return companyKey(company) + "|" + strings.ToLower(strings.TrimSpace(cguid))
}

// under bank.mu: said once per key in this run
func bankSayOnce(key, text string) {
	if !bank.said[key] {
		bank.said[key] = true
		writeLog(text)
	}
}

// --- the add-on's lines (recorder_live.go, under live.mu; bank.mu is taken inside it, never the other way round)

// a voucher line of the add-on read (not FinCom's own posting coming back: its posting window explains it)
func bankNoteAddon(c *change) {
	if c == nil || c.isLedger() || c.source != "addon" || c.fid != "" {
		return
	}
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	st := bank.cos[bankKey(c.company, c.companyGuid)]
	if st == nil {
		return // the route starts at its first check, from the numbers it sees then
	}
	mid := onlyDigits(c.masterId)
	if liveZero(mid) {
		mid = ""
	}
	if mid != "" && st.listed[mid] {
		return // its entry was in the last list already (the line came late)
	}
	st.addonN++
	if mid != "" {
		if _, had := st.addon[mid]; !had && len(st.addon) < 20000 {
			st.addon[mid] = 0
		}
	}
	bankSave() // 2.4.1: the count kept with the counter (a restart must not forget it)
}

// the add-on's line took Tally's entry at this AlterID
func bankNoteTaken(c *change) {
	if c == nil || c.source != "addon" || c.isLedger() {
		return
	}
	mid, a := onlyDigits(c.masterId), toI64(c.alterId)
	if mid == "" {
		return
	}
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	if st := bank.cos[bankKey(c.company, c.companyGuid)]; st != nil && a > st.addon[mid] && len(st.addon) < 20000 {
		st.addon[mid] = a
		bankSave() // 2.4.1: kept with the counter
	}
}

// FinCom's clean posting windows of the company (recorder_live.go, M4)
func bankWindows(company, cguid string) [][2]int64 {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	var o [][2]int64
	for k, w := range live.windows {
		if i := strings.LastIndex(k, "|"); i > 0 && k[:i] == companyKey(company) && strings.EqualFold(k[i+1:], cguid) {
			o = append(o, w...)
		}
	}
	return o
}

func bankSkipWindows(ws [][2]int64, seen int64) int64 {
	for moved := true; moved; {
		moved = false
		for _, w := range ws {
			if seen >= w[0] && seen < w[1] {
				seen, moved = w[1], true
			}
		}
	}
	return seen
}

func bankInWindow(ws [][2]int64, a int64) bool {
	for _, w := range ws {
		if a > w[0] && a <= w[1] {
			return true
		}
	}
	return false
}

// the company's numbers from its latest light check, its GUID (the one held), the starting point; ok false: nothing to do
func bankNumbers(company string) (v int64, guid string, sp int64, ok bool) {
	cur, g := latestNumbers(company)
	if cur == nil {
		return 0, "", 0, false
	}
	held := heldGUID(company)
	if g == "" {
		g = held
	}
	if g == "" || (held != "" && !strings.EqualFold(held, g)) {
		return 0, "", 0, false // no GUID, or another company's under this name
	}
	sp, spOK := startPointOf(company)
	if !spOK {
		return 0, "", 0, false // nothing of the company is taken before its starting point is recorded
	}
	return toI64(cur["altvchid"]), g, sp, true
}

// the route applies: the add-on is this computer's source of changes (source B, Tally's change list, reads every change
// above the highest received already, the bank-dated ones among them)
func bankOn() bool { return cloudOn() && sourceHas("addon") && !sourceHas("alterid") }

// under bank.mu: the company's state, made at its first check from the numbers seen then (prospective, as everything)
func bankState(company, guid string, v, sp int64) (*bankCo, bool) {
	k := bankKey(company, guid)
	st := bank.cos[k]
	if st != nil {
		return st, false
	}
	st = &bankCo{Company: company, CGUID: guid, Seen: v, Route: "small", ListMs: 0, addon: map[string]int64{}, listed: map[string]bool{}}
	if st.Seen < sp {
		st.Seen = sp
	}
	bank.cos[k] = st
	return st, true
}

// under bank.mu: 2.4.1 (the real-Tally gate 37981697177, upg from 2.4.0, u2): a company whose saved state has no add-on line
// count (2.4.0 or older kept it in memory only) takes Tally's counter of now as the route's starting point, as 2.4.0 did
// at its own first check (bankState), instead of counting the whole move since that bridge's last processed counter as
// entries with no add-on line (which read again and sent again the entries its add-on lines had sent). A bank date set in
// that stretch is not listed by this route; the nightly self-check (selfcheck.go, its own mark) finds it. Said once
func bankFromOlder(st *bankCo, v, sp int64) bool {
	if !st.older {
		return false
	}
	st.older = false
	st.Seen, st.addonN, st.addon, st.listed = v, 0, map[string]int64{}, map[string]bool{}
	if st.Seen < sp {
		st.Seen = sp
	}
	writeLog(fmt.Sprintf("Bank dates: %s: state from an older bridge, counter taken as the starting point (ALTVCHID=%d)", st.Company, st.Seen))
	return true
}

// under bank.mu: whether the move from Seen to v is explained by the add-on's lines (and FinCom's posting windows); when
// it is, Seen moves on
func bankExplained(st *bankCo, v int64, ws [][2]int64) bool {
	st.Seen = bankSkipWindows(ws, st.Seen)
	if v <= st.Seen {
		return true
	}
	if int64(st.addonN) >= v-st.Seen {
		st.Seen, st.addonN, st.addon, st.listed = v, 0, map[string]int64{}, map[string]bool{}
		return true
	}
	return false
}

// --- 1. after the light check (startpoint.go): the small route
func bankAfterLightCheck(company string, port int) {
	if !bankOn() {
		return
	}
	v, guid, sp, ok := bankNumbers(company)
	if !ok {
		return
	}
	// release-240 re-review (M6 remainder): only this bridge's own Windows user's Tally, with the company open there
	// (ledOwnPort, as the self-check): the port the light check passed is not used unless it is that one; nothing is
	// sent otherwise
	own, err := ownPortErr("Bank dates", company, guid)
	if err != nil {
		return
	}
	port = own
	ws := bankWindows(company, guid)
	bank.mu.Lock()
	bankFresh()
	st, made := bankState(company, guid, v, sp)
	if made {
		writeLog(fmt.Sprintf("Bank dates: %s: following Tally's voucher counter from ALTVCHID=%d (a move the add-on's lines do not explain is a bank date set, or another change Tally makes without a voucher form)", company, st.Seen))
	}
	if made || bankFromOlder(st, v, sp) || bankExplained(st, v, ws) {
		bankSave()
		bank.mu.Unlock()
		return
	}
	if slowMarked(company, guid) {
		bankAlertLocked(st, int(v-st.Seen), "", true)
		st.Seen, st.addonN, st.addon, st.listed = v, 0, map[string]int64{}, map[string]bool{}
		bankSave()
		bank.mu.Unlock()
		return
	}
	if st.Route == "night" || bank.busy || postingGoing() {
		bank.mu.Unlock()
		return // the nightly check lists it; a posting goes first (the next check)
	}
	bank.busy = true
	after := st.Seen
	bank.mu.Unlock()
	raw, ms, err := bankList(company, port, after, recorderLimitMs())
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bank.busy = false
	bankFresh()
	if st = bank.cos[bankKey(company, guid)]; st == nil || st.Seen != after {
		return
	}
	switch {
	case errors.Is(err, errRecorderStop):
		st.Route, st.ListMs = "night", -1
		if st.ReadAt == "" {
			st.ReadAt = bankNowS()
		}
		st.Why = fmt.Sprintf("its list of changed entries took longer than %d ms", recorderLimitMs())
		writeLog(fmt.Sprintf("Bank dates: %s goes to the nightly check (%s): bank dates set in Tally are read outside office hours, from %s", company, st.Why, keepDailyAt()))
		bankSave()
		return
	case err != nil:
		if !gaveWay(err) && !errors.Is(err, errRetryWait) {
			bankSayOnce("list|"+bankKey(company, guid)+"|"+cutRunes(err.Error(), 40), "Bank dates: the list of changed entries of "+company+" could not be read ("+cutRunes(err.Error(), 160)+"); asked again at the next check")
		}
		return // Seen kept: the next check asks again
	}
	st.ListMs, st.ReadAt = ms, bankNowS()
	n := bankTake(st, raw, after, v, sp, ws, false)
	if ms > bankSmallMs() {
		st.Route = "night"
		st.Why = fmt.Sprintf("its list of changed entries took %d ms", ms)
		writeLog(fmt.Sprintf("Bank dates: %s goes to the nightly check (%s, near the 2 s rule): bank dates set in Tally are read outside office hours, from %s", company, st.Why, keepDailyAt()))
	}
	if n > 0 {
		writeLog(fmt.Sprintf("Bank dates: %s: Tally's voucher counter moved with no add-on line for %d entr%s (a bank date set in Bank Reconciliation, or another change Tally makes without a voucher form); each is read again from Tally", company, n, map[bool]string{true: "y", false: "ies"}[n == 1]))
	}
	bankSave()
}

// the undated list above an AlterID (keepListAboveRequest, exactly as built), stopped at limitMs: Tally's answer and its time
func bankList(company string, port int, after int64, limitMs int) (string, int64, error) {
	var took float64
	tc := recorderTC(func(s float64) { took = s })
	tc.limitMs = limitMs
	raw, err := invokeTally(tc, port, keepListAboveRequest(company, after), limitMs/1000+5)
	ms := int64(took * 1000)
	if err == nil && !strings.Contains(raw, "<ENVELOPE") {
		err = errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	return raw, ms, err
}

// under bank.mu: the list's entries become entries to read again; Seen moves on. The number of entries added
func bankTake(st *bankCo, raw string, after, v, sp int64, ws [][2]int64, night bool) int {
	var es []bankCand
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		g, a, mid := tagValue(m, "GUID"), toI64(tagNum(m, "ALTERID")), onlyDigits(tagNum(m, "MASTERID"))
		if g == "" || mid == "" || a <= after || a <= sp || bankInWindow(ws, a) {
			continue // FinCom's own postings, and nothing at or below the starting point
		}
		if t, had := st.addon[mid]; had && (t == 0 || t >= a) {
			continue // the add-on's line of it is read (or will be) at this AlterID or later: its read takes the bank date
		}
		es = append(es, bankCand{Mid: mid, GUID: g, Day: normDate(tagValue(m, "DATE")), Alter: a, Night: night})
	}
	sort.Slice(es, func(i, j int) bool { return es[i].Alter < es[j].Alter })
	top := v
	for _, e := range es {
		if e.Alter > top {
			top = e.Alter
		}
	}
	if len(es) > bankMax() {
		es = es[:bankMax()]
		top = es[len(es)-1].Alter // the rest from here at the next list (the next check, or the next night)
	}
	listed := map[string]bool{}
	n := 0
	for _, e := range es {
		listed[e.Mid] = true
		merged := false
		for i := range st.Cands {
			if st.Cands[i].Mid == e.Mid {
				if e.Alter > st.Cands[i].Alter {
					st.Cands[i].Alter, st.Cands[i].Asks = e.Alter, 0
				}
				st.Cands[i].Night = st.Cands[i].Night && night
				merged = true
			}
		}
		if !merged {
			st.Cands = append(st.Cands, e)
			n++
		}
	}
	if top > st.Seen {
		st.Seen = top
	}
	st.addonN, st.addon, st.listed = 0, map[string]int64{}, listed
	return n
}

// --- 2. the nightly check (the recorder's loop, every quarter second; nothing is asked outside the night's window)

// the night's window (nightWindow, keep.go: from 19:00 outside office hours, release-240). The night's key: its start's date
func bankNightNow(now time.Time) (bool, string) {
	in, night := nightWindow(now)
	if !in {
		return false, ""
	}
	return true, night
}

func officeHoursAt(now time.Time) bool {
	return now.Weekday() != time.Sunday && now.Hour() >= keepNum("KeepOfficeFrom", 9) && now.Hour() < keepNum("KeepOfficeTo", 19)
}

// nothing of the night's work goes: the tray's pause, FinCom's read stop, a posting, FinCom in use
func bankNightHeld(now time.Time) bool {
	if paused() || readStopped() || postingGoing() {
		return true
	}
	q := time.Duration(keepNum("NightlyQuietMin", 15)) * time.Minute
	a := lastActivity()
	return !a.IsZero() && now.Sub(a) < q && !a.After(now)
}

func bankNightTurn() {
	if !bankOn() {
		return
	}
	now := nowFn()
	in, night := bankNightNow(now)
	if !in || bankNightHeld(now) {
		return
	}
	bank.mu.Lock()
	bankFresh()
	if bank.busy {
		bank.mu.Unlock()
		return
	}
	var ks []string
	for k, st := range bank.cos {
		if st.Route == "night" && st.Night != night {
			ks = append(ks, k)
		}
	}
	sort.Strings(ks)
	var st *bankCo
	var v, sp int64
	var ws [][2]int64
	for _, k := range ks {
		c := bank.cos[k]
		cv, guid, csp, ok := bankNumbers(c.Company)
		if !ok || !strings.EqualFold(guid, c.CGUID) {
			continue // not checked in this run yet (the light check comes every 10 minutes a company), or another company
		}
		bank.mu.Unlock()
		cws := bankWindows(c.Company, c.CGUID)
		bank.mu.Lock()
		if bankFromOlder(c, cv, csp) {
			bankSave()
			continue
		}
		if bankExplained(c, cv, cws) {
			c.Night = night // nothing tonight
			bankSave()
			continue
		}
		if slowMarked(c.Company, c.CGUID) {
			bankAlertLocked(c, int(cv-c.Seen), "", true)
			c.Seen, c.addonN, c.addon, c.listed, c.Night = cv, 0, map[string]int64{}, map[string]bool{}, night
			bankSave()
			continue
		}
		st, v, sp, ws = c, cv, csp, cws
		break
	}
	if st == nil {
		bank.mu.Unlock()
		return
	}
	bank.busy = true
	company, guid, after := st.Company, st.CGUID, st.Seen
	bank.mu.Unlock()
	port, err := ownPortErr("Bank dates", company, guid)
	var raw string
	var ms int64
	held := false
	if err == nil {
		// the clock read again just before the list (finding the port takes time): never inside office hours
		if held = bankNightListInOfficeHours(nowFn()); !held {
			raw, ms, err = bankList(company, port, after, bankNightLimitMs())
		}
	}
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bank.busy = false
	if held {
		return // office hours (or its 10 s would reach them): asked the next night, nothing marked
	}
	bankFresh()
	if st = bank.cos[bankKey(company, guid)]; st == nil || st.Seen != after {
		return
	}
	switch {
	case errors.Is(err, errRecorderStop):
		st.Night, st.ListMs = night, -1
		bankAlertLocked(st, int(v-after), "", false)
		writeLog(fmt.Sprintf("Bank dates: %s: the nightly list of changed entries took longer than %d ms; not asked again tonight", company, bankNightLimitMs()))
		bankSave()
		return
	case err != nil:
		return // asked again later tonight (the retry schedule, a posting, Tally closed)
	}
	st.Night, st.ListMs, st.ReadAt = night, ms, bankNowS()
	n := bankTake(st, raw, after, v, sp, ws, true)
	writeLog(fmt.Sprintf("Bank dates: %s (nightly check, %d ms): %d entr%s changed in Tally with no add-on line; each is read again from Tally", company, ms, n, map[bool]string{true: "y", false: "ies"}[n == 1]))
	bankSave()
}

// --- 3. the reads (liveUploadOnce, when no save waits): one at a time, the requests made and lines queued
func bankTurn() int {
	if !bankOn() || postingGoing() || readStopped() {
		return 0
	}
	now := nowFn()
	inNight, _ := bankNightNow(now)
	bank.mu.Lock()
	bankFresh()
	if bank.busy {
		bank.mu.Unlock()
		return 0
	}
	var ks []string
	for k, st := range bank.cos {
		if len(st.Cands) > 0 {
			ks = append(ks, k)
		}
	}
	sort.Strings(ks)
	var st *bankCo
	var todo []bankCand
	gap := bankGap()
	for _, k := range ks {
		c := bank.cos[k]
		var day, nt []bankCand
		for _, x := range c.Cands {
			if !x.due(now) {
				continue // its one more ask comes later; the company's other entries, and other companies, go on
			}
			if x.Night {
				nt = append(nt, x)
			} else {
				day = append(day, x)
			}
		}
		switch {
		case len(day) > 0:
			todo = day
		case len(nt) > 0 && inNight && !bankNightHeld(now):
			todo, gap = nt[:1], bankNightGap() // the nightly route: one a turn, paced
		default:
			continue
		}
		st = c
		break
	}
	if st == nil || (!bank.lastAt.IsZero() && time.Since(bank.lastAt) < gap) {
		bank.mu.Unlock()
		return 0
	}
	if len(todo) > bankPerTurn() {
		todo = todo[:bankPerTurn()]
	}
	bank.busy, bank.lastAt = true, time.Now()
	company, guid := st.Company, st.CGUID
	bank.mu.Unlock()
	n := bankWork(company, guid, todo)
	bank.mu.Lock()
	bank.busy = false
	bank.mu.Unlock()
	return n
}

// the outcome of one entry's read
type bankDone struct {
	mid   string
	alter int64
	drop  bool   // read (sent or not needed), gone from Tally, or given up
	asked bool   // the read reached Tally and was stopped or not answered
	fail  string // an answer that cannot be read (the same would come again): dropped into the alert at once
}

func bankWork(company, guid string, todo []bankCand) int {
	sp, spOK := startPointOf(company)
	held := heldGUID(company)
	if !spOK || (held != "" && !strings.EqualFold(held, guid)) {
		return 0
	}
	port, err := ownPortErr("Bank dates", company, guid)
	if err != nil {
		return 0
	}
	var done []bankDone
	asked, queued, slow := 0, 0, false
	for _, c := range todo {
		if postingGoing() || liveQueueReady() || readStopped() {
			break // a posting, or a save read from the add-on, goes first; FinCom's stop
		}
		if e, ok := vchReadGet(guid, c.Mid); ok && e.alter >= c.Alter {
			// read already at this AlterID or later (renumbering's read): not asked again
			if !e.sent && e.alter > sp && strings.EqualFold(tagValue(e.x, "GUID"), c.GUID) {
				bankQueue(company, guid, e.x)
				vchReadPut(guid, c.Mid, e.x, true)
				queued++
			}
			done = append(done, bankDone{mid: c.Mid, alter: c.Alter, drop: true})
			continue
		}
		sent := false
		tc := recorderTC(nil)
		tc.sentOut = &sent
		got, err := fetchVouchersByMasterIn(tc, company, port, c.Day, []string{c.Mid}, liveBodySec())
		if sent {
			asked++
		}
		switch {
		case errors.Is(err, errSlowCompany):
			slow = true
		case errors.Is(err, errFastShape):
			done = append(done, bankDone{mid: c.Mid, alter: c.Alter, drop: true}) // a form FinCom does not read: the Day Book
			continue
		case errors.Is(err, errRetryWait) || errors.Is(err, errPreempted) || errors.Is(err, errReadStopped) || gaveWay(err):
			// nothing reached Tally (the retry schedule, a posting first, FinCom's read stop): not an ask; this turn ends
		case errors.Is(err, errRecorderStop) || tallyNoAnswer(err):
			// as renumbering (the owner's answer B): stopped at 2 s or not answered: one more ask 5 minutes later, then the
			// alert; the entry waits, nothing else does
			done = append(done, bankDone{mid: c.Mid, alter: c.Alter, asked: true})
		case err != nil:
			if _, perr := findCompanyPortBg(company, 0); perr != nil {
				break // the company is no longer open: it waits, nothing dropped
			}
			done = append(done, bankDone{mid: c.Mid, alter: c.Alter, drop: true, fail: cutRunes(err.Error(), 120)})
		}
		if err != nil {
			break
		}
		x := got[c.Mid]
		done = append(done, bankDone{mid: c.Mid, alter: c.Alter, drop: true})
		if x == "" || !strings.EqualFold(tagValue(x, "GUID"), c.GUID) {
			continue // gone from Tally, or not the entry listed
		}
		vchReadPut(guid, c.Mid, x, false)
		if toI64(tagNum(x, "ALTERID")) <= sp {
			continue // never at or below the starting point
		}
		bankQueue(company, guid, x)
		vchReadPut(guid, c.Mid, x, true)
		queued++
	}
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	st := bank.cos[bankKey(company, guid)]
	if st == nil {
		return asked + queued
	}
	if slow {
		n, from := len(st.Cands), ""
		for _, c := range st.Cands {
			if from == "" || c.Day < from {
				from = c.Day
			}
		}
		st.Cands = nil
		bankAlertLocked(st, n, from, true)
		bankSave()
		return asked + queued
	}
	for _, d := range done {
		for i := 0; i < len(st.Cands); i++ {
			c := &st.Cands[i]
			if c.Mid != d.mid || c.Alter > d.alter {
				continue // a later change of it listed meanwhile: read again
			}
			if d.asked {
				c.Asks++
				c.Next = nowFn().Add(bankAgain()).Format(time.RFC3339) // the 2.3.4 rule: one more ask, 5 minutes later
			}
			if d.fail != "" {
				bankAlertLocked(st, 1, c.Day, false)
				writeLog(fmt.Sprintf("Bank dates: %s: the entry with MasterID %s (%s) could not be read from Tally (%s); not asked again", company, c.Mid, liveDay(c.Day), d.fail))
			}
			if d.drop || c.Asks >= liveObjAsksMax {
				if !d.drop {
					bankAlertLocked(st, 1, c.Day, false)
					writeLog(fmt.Sprintf("Bank dates: %s: the entry with MasterID %s (%s) did not come from Tally in time when asked again; not asked a third time", company, c.Mid, liveDay(c.Day)))
				}
				st.Cands = append(st.Cands[:i], st.Cands[i+1:]...)
				i--
			}
		}
	}
	bankSave()
	return asked + queued
}

// Tally's entry as an altered line with its body (source "bankdate")
func bankQueue(company, cguid, x string) {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	mid, alter := onlyDigits(tagNum(x, "MASTERID")), onlyDigits(tagNum(x, "ALTERID"))
	id := liveLineID("bankdate", strings.ToLower(cguid), mid, alter)
	if live.sent[id] || live.queued[id] {
		return
	}
	c := &change{company: company, companyGuid: cguid, event: "altered", vchType: tagValue(x, "VOUCHERTYPENAME"), vchNo: tagValue(x, "VOUCHERNUMBER"), vchDate: normDate(tagValue(x, "DATE")),
		narr: html.UnescapeString(tagRaw(x, "NARRATION")), source: "bankdate", lineId: id, saveMs: -1, readAt: nowFn(), at: nowFn().In(liveZone).Format(time.RFC3339)}
	liveTakeBody(c, x)
	liveQueueAdd(c)
}

// --- the alert: said in the log and carried by the beat (7 days). Under bank.mu. n entries (or changes) whose bank date
// may not be in FinCom; from: the earliest day known ("" : the starting point's)
func bankAlertLocked(st *bankCo, n int, from string, slow bool) {
	if n < 1 {
		n = 1
	}
	k := companyKey(st.Company)
	if e := bank.alerts[k]; e != nil {
		if at, err := time.Parse("2006-01-02T15:04:05", str(e["at"])); err == nil && time.Since(at) < 7*24*time.Hour {
			n += toInt(e["n"])
			if f := str(e["from"]); f != "" && (from == "" || f < from) {
				from = f
			}
		}
	}
	what := fmt.Sprintf("%d bank dates set in Tally may not have reached FinCom", n)
	if n == 1 {
		what = "1 bank date set in Tally may not have reached FinCom"
	}
	day := "the day it was set"
	if from != "" {
		day = liveDay(from)
	}
	words := fmt.Sprintf("%s for %s; upload the Day Book from %s", what, st.Company, day)
	if slow {
		words += " (FinCom does not ask Tally for this company's entries: finding one took longer than 2 s)"
	}
	bank.alerts[k] = M{"company": st.Company, "words": words, "n": n, "from": from, "at": nowS()}
	writeLog("Bank dates: " + words)
}

// the beat: the alerts of the last 7 days [{company, words, n, from, at}]
func bankBeat() []any {
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	o := []any{}
	var ks []string
	for k := range bank.alerts {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		e := bank.alerts[k]
		if at, err := time.Parse("2006-01-02T15:04:05", str(e["at"])); err == nil && time.Since(at) > 7*24*time.Hour {
			continue
		}
		o = append(o, e)
	}
	return o
}

// the company's route ("" : not seen yet)
func bankRoute(company string) string {
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	for _, st := range bank.cos {
		if companyKey(st.Company) == companyKey(company) {
			return st.Route
		}
	}
	return ""
}

// the tests (and support): a company put on the nightly route
func bankForceNight(company string) {
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	for _, st := range bank.cos {
		if companyKey(st.Company) == companyKey(company) {
			st.Route, st.Why = "night", "set so"
			if st.ReadAt == "" {
				st.ReadAt = bankNowS()
			}
		}
	}
	bankSave()
}

// --- what was read of an entry, shared by renumbering (renumber.go) and the bank route: an entry one of them read is not
// read again by the other (30 minutes; this run only)
type vchReadE struct {
	alter int64
	x     string
	at    time.Time
	sent  bool // a line with this body went to the queue
}

var vchRead = struct {
	mu  sync.Mutex
	dir string
	m   map[string]vchReadE
}{m: map[string]vchReadE{}}

// under vchRead.mu: what this sync folder's bridge read
func vchReadFresh() {
	if d := syncDir(); vchRead.dir != d {
		vchRead.dir, vchRead.m = d, map[string]vchReadE{}
	}
}

func vchReadKey(cguid, mid string) string {
	return strings.ToLower(strings.TrimSpace(cguid)) + "|" + mid
}

func vchReadPut(cguid, mid, x string, sent bool) {
	if mid == "" || x == "" {
		return
	}
	vchRead.mu.Lock()
	defer vchRead.mu.Unlock()
	vchReadFresh()
	k := vchReadKey(cguid, mid)
	e, had := vchRead.m[k]
	a := toI64(tagNum(x, "ALTERID"))
	if had && e.x == x {
		e.sent = e.sent || sent
		vchRead.m[k] = e
		return
	}
	if len(vchRead.m) > 5000 {
		for kk, ee := range vchRead.m {
			if time.Since(ee.at) > 30*time.Minute {
				delete(vchRead.m, kk)
			}
		}
	}
	vchRead.m[k] = vchReadE{alter: a, x: x, at: time.Now(), sent: sent}
}

func vchReadGet(cguid, mid string) (vchReadE, bool) {
	vchRead.mu.Lock()
	defer vchRead.mu.Unlock()
	vchReadFresh()
	e, ok := vchRead.m[vchReadKey(cguid, mid)]
	if !ok || time.Since(e.at) > 30*time.Minute {
		return vchReadE{}, false
	}
	return e, true
}

// --- release-240 (the owner's decision of 2026-10-09): a company on the nightly route whose bank dates were not read for
// 3 days (Tally closed every evening) is told once per problem through the tray's notices gate (notices.go: its day is
// the date since when, so it shows once whatever the days it lasts), and said once in the log

func bankNowS() string { return nowFn().Format(time.RFC3339) }

func bankStaleWords(company, since string) string {
	return "Bank dates for " + company + " not read since " + since + ". Keep Tally open for a few minutes after 7 pm, or upload the Day Book."
}

// the companies not read for 3 days: [{company, since (dd-Mon-yyyy), day (yyyymmdd)}]
func bankStaleList(now time.Time) []any {
	bank.mu.Lock()
	defer bank.mu.Unlock()
	bankFresh()
	var ks []string
	for k := range bank.cos {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	out := []any{}
	for _, k := range ks {
		st := bank.cos[k]
		at, err := time.Parse(time.RFC3339, st.ReadAt)
		if st.Route != "night" || err != nil || now.Sub(at) < 72*time.Hour {
			continue
		}
		at = at.In(now.Location())
		since := at.Format("02-Jan-2006")
		bankSayOnce("stale|"+companyKey(st.Company)+"|"+at.Format("20060102"), "Bank dates: "+bankStaleWords(st.Company, since))
		out = append(out, M{"company": st.Company, "since": since, "day": at.Format("20060102")})
	}
	return out
}
