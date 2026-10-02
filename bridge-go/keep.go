// Keeping FinCom's copy of each company in step with Tally (keep.ps1 of bridge 1.15.0), as a worker inside the service
// instead of a second program. For each open company it reads the opening balances once, copies the year's day book a
// few days at a time (or takes it from the day book files chosen in FinCom), then asks only what changed: entries with
// a change number (ALTERID) above the last one seen, and one month at a time compares the list of entries with
// Tally's, which also finds deleted ones. The copy is kept in the same files as before (sync\<company>\days\*.xml...).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

func syncDir() string {
	if d := cfgS("SyncDir"); d != "" {
		return d
	}
	return filepath.Join(Home, "sync")
}
func syncFolder(company string) string { return filepath.Join(syncDir(), safeName(company)) }
func sp(name string) string            { return filepath.Join(syncDir(), name) }

// --- when the copier reads Tally (2.1.3): only after an event (events.go). There is no timer: no light check every 30
// minutes, no watching of Tally's change counters every minute, no "quiet time" guessed from the keyboard
func keepOn() bool {
	if v := cfg("KeepInStep"); v != nil {
		return truthy(v)
	}
	return !isFake() // on by default; off in test mode unless asked for
}

// what FinCom reads as the schedule: the nightly catch-up (the "continuous" copy of older bridges is gone)
func keepSchedule() string { return "daily" }

// the hour of the nightly catch-up (KeepDailyAt in the settings, shown in the tray): 02:00 unless set
func keepDailyAt() string {
	v := cfgS("KeepDailyAt")
	if re(`^([01]?\d|2[0-3]):[0-5]\d$`).MatchString(v) {
		return v
	}
	return "02:00"
}
func keepLastRun() string { return strings.TrimSpace(readText(sp("keep-lastrun.txt"))) }
func lightFile() string   { return sp("keep-light.txt") }

// Update now (pressed in FinCom, here or on another computer): kept in a file, so a restart does not lose it
func requestKeepNow() {
	_ = saveFile(sp("keep-now.txt"), nowS())
	writeLog("Update from Tally asked for now")
}

// office hours: only for how large a share of Tally's time a background read may take (never to guess a quiet time)
func officeHours() bool {
	now := time.Now()
	return now.Weekday() != time.Sunday && now.Hour() >= keepNum("KeepOfficeFrom", 9) && now.Hour() < keepNum("KeepOfficeTo", 19)
}
func keepSharePct() int {
	if officeHours() {
		return keepNum("KeepSharePct", 10)
	}
	return keepNum("KeepNightSharePct", 40)
}
func keepRoom(port int) bool { return tallyShare(port)*100 < float64(keepSharePct()) }
func keepTargetSec() float64 {
	if officeHours() {
		return float64(keepNum("KeepTargetSec", 3))
	}
	return float64(keepNum("KeepNightTargetSec", 10))
}

// a pause between two background reads, so Tally stays free for the people using it (KeepRestMs: the tests shorten it)
func keepRest(d time.Duration) {
	if ms := toInt(cfg("KeepRestMs")); ms > 0 && time.Duration(ms)*time.Millisecond < d {
		d = time.Duration(ms) * time.Millisecond
	}
	sleepOrStop(d)
}

func setFinComReading() { _ = saveFile(sp("fincom-reading.txt"), nowS()) }

// why Tally is to be left alone right now (” when it is free)
func keepHold() string {
	for _, d := range []string{syncDir(), psSyncDir()} {
		if d == "" {
			continue
		}
		if t, ok := mtime(filepath.Join(d, "fincom-reading.txt")); ok && time.Since(t) < 120*time.Second {
			return "FinCom is reading from Tally"
		}
	}
	if isFake() && cfgS("KeepFakeHold") != "" {
		return cfgS("KeepFakeHold")
	}
	if platTallyYoung(float64(keepNum("KeepSettleMin", 3))) {
		return "Tally has just opened; letting it finish loading"
	}
	if keepUserInTally() {
		return "someone is working in Tally"
	}
	return ""
}

// --- the copy's state (keep.json): a JSON object, read and written as the PowerShell bridge did
func readKeepState(dir string) M { return readObjFile(filepath.Join(dir, "keep.json")) }
func saveKeepState(dir string, st M) {
	_ = saveFile(filepath.Join(dir, "keep.json"), jsonText(st))
}

// Tally's own change counters for a company (entries, masters): one tiny request
func keepCounters(tc *TC, company string, port int) (bool, int64, int64, error) {
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepCo</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME,ALTVCHID,ALTMSTID</FETCH><FILTERS>TDSDeskKeepThisCo</FILTERS></COLLECTION>` +
		`<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepThisCo">` + esc(`$Name = "`+strings.ReplaceAll(company, `"`, "")+`"`) + "</SYSTEM>" +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 15)
	if err != nil {
		return false, 0, 0, err
	}
	v := group(`<ALTVCHID[^>]*>\s*(\d+)\s*</ALTVCHID>`, raw, 1)
	m := group(`<ALTMSTID[^>]*>\s*(\d+)\s*</ALTMSTID>`, raw, 1)
	if v == "" || m == "" {
		return false, 0, 0, nil
	}
	return true, toI64(v), toI64(m), nil
}

// the entries of a period, as numbers only: [guid, change number, date]; 'after' asks only for those changed since
type kentry struct {
	guid  string
	alter int64
	date  string
}

func keepList(tc *TC, company string, port int, from, to string, after int64) ([]kentry, error) {
	flt, sys := "", ""
	if after > 0 {
		flt = "<FILTERS>TDSDeskKeepNew</FILTERS>"
		sys = fmt.Sprintf(`<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepNew">$AlterID &gt; %d</SYSTEM>`, after)
	}
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepList</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepList" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID,ALTERID,DATE</FETCH>` + flt + "</COLLECTION>" + sys +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 120)
	if err != nil {
		return nil, err
	}
	var out []kentry
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(raw, -1) {
		g := strings.TrimSpace(group(`<GUID>([^<]*)</GUID>`, m, 1))
		a := group(`<ALTERID>\s*(\d+)`, m, 1)
		d := group(`<DATE>(\d{8})</DATE>`, m, 1)
		if g != "" && d != "" && d >= from && d <= to { // a Tally that ignores the period is cut here
			out = append(out, kentry{g, toI64(a), d})
		}
	}
	return out, nil
}

// opening balances for a group of ledgers (all when none named), on one date: [name, parent, balance]
func keepBalances(tc *TC, company string, port int, names []string, asOn string) ([][3]string, error) {
	var parts []string
	for _, n := range names {
		parts = append(parts, `$Name = "`+strings.ReplaceAll(n, `"`, "")+`"`)
	}
	// 2.1.3: never every ledger in one request (02-Oct-2026: TDSDeskKeepBal ran 900 s and failed): a batch at a time
	if len(names) == 0 {
		return nil, errors.New("no ledgers named: opening balances are read a batch of ledgers at a time")
	}
	flt := "<FILTERS>TDSDeskKeepThese</FILTERS>"
	sys := `<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepThese">` + esc(strings.Join(parts, " OR ")) + "</SYSTEM>"
	t := tallyMaxSec()
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepBal</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + asOn + "</SVFROMDATE><SVTODATE>" + asOn + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepBal" ISMODIFY="No"><TYPE>Ledger</TYPE>` + flt + "<FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH></COLLECTION>" + sys +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, t)
	if err != nil {
		return nil, err
	}
	var out [][3]string
	for _, l := range xmlDoc(raw).All("LEDGER") {
		if n := nameOf(l); n != "" {
			out = append(out, [3]string{n, nt(l, "PARENT"), nt(l, "CLOSINGBALANCE")})
		}
	}
	return out, nil
}

// one stretch of the day book, kept as one file a day: returns the seconds it took and the entries
func copyKeepDays(tc *TC, company string, port int, dir, from, to string) (float64, int, error) {
	t0 := time.Now()
	x, err := getDayBookXML(tc, company, from, to, port)
	if err != nil {
		return 0, 0, err
	}
	sec := time.Since(t0).Seconds()
	return sec, saveKeepDays(dir, from, to, x), nil
}

// a stretch of the day book (from Tally, or from a day book file) kept as one file a day; a day with nothing is kept empty
func saveKeepDays(dir, from, to, x string) int {
	by := map[string]*strings.Builder{}
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(x, -1) {
		d := group(`<DATE>(\d{8})</DATE>`, m, 1)
		if d == "" {
			continue
		}
		if by[d] == nil {
			by[d] = &strings.Builder{}
		}
		by[d].WriteString("<TALLYMESSAGE>" + m + "</TALLYMESSAGE>")
	}
	days := filepath.Join(dir, "days")
	_ = os.MkdirAll(days, 0o755)
	where := keepWhere(dir)
	n := 0
	var written []string
	for d := from; d <= to; d = addDays(d, 1) {
		t := ""
		if b := by[d]; b != nil {
			t = b.String()
			n += countVouchers(t)
		}
		_ = saveFile(filepath.Join(days, d+".xml"), t)
		ix := indexText(t)
		_ = saveFile(filepath.Join(days, d+".idx"), ix)
		whereMu.Lock()
		for _, ln := range strings.Split(ix, "\n") {
			if g := strings.Split(ln, "\t")[0]; g != "" {
				where[g] = d
			}
		}
		whereMu.Unlock()
		written = append(written, d)
	}
	addCloudDays(dir, written)
	return n
}

func countVouchers(t string) int { return len(re(`<VOUCHER\b`).FindAllStringIndex(t, -1)) }

// how a company's year comes in: 'files' (the day book files chosen in FinCom; the default) or 'bridge'
func keepMode(company string) string {
	if m := str(obj(cfg("KeepModes"))[company]); m == "bridge" || m == "files" {
		return m
	}
	if isFake() && !cfgB("KeepFakeFilesFirst") {
		return "bridge"
	}
	return "files"
}
func setKeepMode(company, mode string) (M, error) {
	if mode != "bridge" && mode != "files" {
		return nil, errors.New("The way is files or bridge.")
	}
	cfgMu.Lock()
	h := M{}
	for k, v := range obj(Cfg.Get("KeepModes")) {
		h[k] = v
	}
	h[company] = mode
	Cfg.Set("KeepModes", h)
	cfgMu.Unlock()
	saveConfig()
	how := "from the day book files chosen in FinCom"
	if mode == "bridge" {
		how = "from Tally, read by the bridge at a quiet time"
	}
	writeLog("Keeping " + company + " in step: the year comes " + how)
	return keepStatus(company), nil
}

var keepMu sync.Mutex // the copy is changed by one at a time: the copier, or FinCom giving it files

// opening balances from a trial balance exported from Tally (as on the day before the copy starts)
func importKeepOpening(company, body string) (M, error) {
	o := parseObj(body)
	if o == nil {
		return nil, errors.New("Send the balances as JSON.")
	}
	keepMu.Lock()
	defer keepMu.Unlock()
	dir := syncFolder(company)
	st := readKeepState(dir)
	if st == nil {
		return M{"ok": true, "skipped": "The bridge has no copy of this company yet: give it the day book first, then the trial balance."}, nil
	}
	want := addDays(str(st["from"]), -1)
	if str(o["openAsOn"]) != want {
		return M{"ok": true, "skipped": "The copy starts on " + str(st["from"]) + ", so it needs the balances as on " + want + "; this trial balance is as on " + str(o["openAsOn"]) + "."}, nil
	}
	led := []any{}
	for _, x := range arr(o["ledgers"]) {
		l := obj(x)
		led = append(led, M{"name": str(l["name"]), "parent": str(l["parent"]), "open": str(l["open"]), "close": ""})
	}
	bal := M{"ok": true, "company": company, "from": st["from"], "to": today(), "openAsOn": want, "ledgers": led, "keep": true, "source": "trial balance file"}
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(bal))
	setCloudLedgers(dir)
	st["openPending"], st["balAt"], st["lastM"] = false, nowS(), 0
	saveKeepState(dir, st)
	writeKeepManifest(dir, st, today())
	writeLog(fmt.Sprintf("Keeping %s: opening balances of %d ledgers taken from the trial balance file", company, len(led)))
	return M{"ok": true, "ledgers": len(led), "openAsOn": want}, nil
}

// the day book exported from Tally once and chosen in FinCom becomes the copy, so the bridge never reads the year itself
func importKeepSeed(company, from, to, x string) (M, error) {
	if company == "" {
		return nil, errors.New("Say which company.")
	}
	if !isTallyDate(from) || !isTallyDate(to) || from > to {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	setFinComReading()
	keepMu.Lock()
	defer keepMu.Unlock()
	dir := syncFolder(company)
	_ = os.MkdirAll(dir, 0o755)
	st := readKeepState(dir)
	if st != nil && !truthy(st["seeded"]) && (str(st["phase"]) == "check" || str(st["phase"]) == "live") {
		return M{"ok": true, "skipped": "This company is already kept in step; its copy was made before."}, nil
	}
	if st == nil || !truthy(st["seeded"]) {
		st = M{"company": company, "from": from, "next": from, "slice": 1, "phase": "check", "openIdx": 0, "last": 0, "lastM": 0, "checkYm": from[:6], "months": M{}, "cycle": 0,
			"skipped": []any{}, "dayFail": 0, "balMode": "whole", "openPending": true, "seeded": true}
		writeLog("Keeping " + company + " in step: the copy starts from the day book file chosen in FinCom")
	}
	n := saveKeepDays(dir, from, to, x)
	mx := toI64(st["last"])
	for _, m := range re(`<ALTERID>\s*(\d+)`).FindAllStringSubmatch(x, -1) {
		if v := toI64(m[1]); v > mx {
			mx = v
		}
	}
	st["last"] = mx
	if from < str(st["from"]) {
		st["from"], st["checkYm"], st["openPending"], st["balMode"] = from, from[:6], true, "whole"
	}
	d, td := str(st["from"]), today()
	for d <= td && exists(filepath.Join(dir, "days", d+".xml")) {
		d = addDays(d, 1)
	}
	st["next"], st["phase"] = d, "check"
	for ym := from[:6]; ym <= to[:6]; ym = nextYm(ym) {
		writeKeepMonth(dir, ym, st)
	}
	st["at"] = nowS()
	saveKeepState(dir, st)
	writeKeepManifest(dir, st, td)
	writeLog(fmt.Sprintf("Keeping %s: %d entries of %s-%s taken from the day book file", company, n, from, to))
	return M{"ok": true, "entries": n, "from": from, "to": to, "next": st["next"]}, nil
}

// one day's entries as numbers only, one line each: guid, change number
func indexText(t string) string {
	var b strings.Builder
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(t, -1) {
		g := strings.TrimSpace(group(`<GUID>([^<]*)</GUID>`, m, 1))
		a := group(`<ALTERID>\s*(\d+)`, m, 1)
		if g != "" {
			b.WriteString(g + "\t" + a + "\n")
		}
	}
	return b.String()
}
func readKeepIndex(dayXML string) string {
	ixf := strings.TrimSuffix(dayXML, ".xml") + ".idx"
	if !exists(ixf) {
		_ = saveFile(ixf, indexText(readText(dayXML)))
	}
	return readText(ixf)
}

// where each entry sits in the copy (guid -> date); an entry moved to another date is then taken off its old date too
var (
	whereMu  sync.Mutex
	whereMap = map[string]map[string]string{}
)

func keepWhere(dir string) map[string]string {
	whereMu.Lock()
	if w, ok := whereMap[dir]; ok {
		whereMu.Unlock()
		return w
	}
	whereMu.Unlock()
	w := map[string]string{}
	for _, f := range dayFiles(dir, "") {
		base := strings.TrimSuffix(filepath.Base(f), ".xml")
		for _, ln := range strings.Split(readKeepIndex(f), "\n") {
			if g := strings.Split(ln, "\t")[0]; g != "" {
				w[g] = base
			}
		}
	}
	whereMu.Lock()
	whereMap[dir] = w
	whereMu.Unlock()
	return w
}
func whereGet(w map[string]string, g string) string {
	whereMu.Lock()
	defer whereMu.Unlock()
	return w[g]
}
func dayFiles(dir, prefix string) []string {
	m, _ := filepath.Glob(filepath.Join(dir, "days", prefix+"*.xml"))
	sort.Strings(m)
	return m
}

// the entries kept for a month: guid -> [change number, date]
type held struct {
	alter int64
	date  string
}

func keepHeld(dir, ym string) map[string]held {
	h := map[string]held{}
	for _, f := range dayFiles(dir, ym) {
		base := strings.TrimSuffix(filepath.Base(f), ".xml")
		for _, ln := range strings.Split(readKeepIndex(f), "\n") {
			p := strings.Split(ln, "\t")
			if p[0] != "" {
				a := int64(0)
				if len(p) > 1 {
					a = toI64(p[1])
				}
				h[p[0]] = held{a, base}
			}
		}
	}
	return h
}

// a month's day book file, put together from its days, for FinCom to read
func writeKeepMonth(dir, ym string, st M) {
	var b strings.Builder
	b.WriteString("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>")
	n := 0
	for _, f := range dayFiles(dir, ym) {
		t := readText(f)
		n += countVouchers(t)
		b.WriteString(t)
	}
	b.WriteString("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
	_ = saveFile(filepath.Join(dir, "daybook-"+ym+".xml"), b.String())
	months := obj(st["months"])
	if months == nil {
		months = M{}
		st["months"] = months
	}
	months[ym] = M{"at": nowS(), "n": n}
}

func writeKeepManifest(dir string, st M, td string) {
	months := []any{}
	mm := obj(st["months"])
	var yms []string
	for k := range mm {
		yms = append(yms, k)
	}
	sort.Strings(yms)
	from := str(st["from"])
	for _, ym := range yms {
		m := obj(mm[ym])
		f, e := ym+"01", monthEnd(ym)
		if e > td {
			e = td
		}
		if f < from {
			f = from
		}
		months = append(months, M{"ym": ym, "from": f, "to": e, "at": m["at"], "n": m["n"]})
	}
	doneTo := addDays(str(st["next"]), -1)
	to := td
	if ph := str(st["phase"]); ph == "first" || ph == "open" {
		to = doneTo
	}
	man := M{"ok": true, "keep": true, "company": st["company"], "at": nowS(), "from": from, "to": to, "phase": st["phase"], "doneTo": doneTo, "seen": nowS(), "months": months,
		"balancesAt": st["balAt"], "readAt": st["readAt"], "bridge": BridgeVersion, "skipped": nonEmpty(strs(st["skipped"])), "trouble": st["trouble"]}
	_ = saveFile(filepath.Join(dir, "manifest.json"), jsonText(man))
}
func nonEmpty(a []string) []any {
	o := []any{}
	for _, s := range a {
		if s != "" {
			o = append(o, s)
		}
	}
	return o
}

func addKeepSkipped(st M, d string) {
	st["skipped"] = toAny(uniqSorted(append(strs(st["skipped"]), d)))
}
func toAny(a []string) []any {
	o := make([]any, len(a))
	for i, s := range a {
		o[i] = s
	}
	return o
}

// --- the copier itself: one run at a time, started by an event (events.go), with its own state
type keepRun struct {
	tc       *TC
	kind     string   // light (a client opened in FinCom, or after a posting), now (Update now), nightly
	only     []string // these companies only (none: every company open in Tally)
	caughtUp bool
	light    bool
	force    bool
	once     bool
	allDone  bool
	told     map[string]bool
}
type keepBack struct {
	n     int
	until time.Time
}

var (
	kwMu      sync.Mutex
	kwRunning bool
	kwRun     *keepRun
	kwPending *runReq
	ledSent   = map[string]string{}
)

// a background read stopped for FinCom's request, or held back while Tally is left alone: not a failure
func gaveWay(err error) bool { return errors.Is(err, errPreempted) || errors.Is(err, errBackoff) }

// re-read some dates (changed or found different), a few at a time. A date Tally answers with an error is noted and
// tried later; Tally not answering stops here (the caller leaves Tally alone), and nothing is marked read that was not
func (k *keepRun) updateDates(company string, port int, dir string, st M, dates []string) (int, error) {
	touched := map[string]bool{}
	var list []string
	for _, d := range uniqSorted(dates) {
		if d >= str(st["from"]) {
			list = append(list, d)
		}
	}
	defer func() {
		for ym := range touched {
			writeKeepMonth(dir, ym, st)
		}
	}()
	for i := 0; i < len(list); i++ {
		a, b := list[i], list[i]
		lim := math.Max(1, math.Min(7, num(st["slice"])))
		for i+1 < len(list) && list[i+1] == addDays(b, 1) && fromTallyDate(list[i+1]).Sub(fromTallyDate(a)).Hours()/24 < lim {
			i++
			b = list[i]
		}
		sec, _, err := copyKeepDays(k.tc, company, port, dir, a, b)
		if err == nil {
			touched[a[:6]], touched[b[:6]] = true, true
			var left []string
			for _, s := range strs(st["skipped"]) {
				if s < a || s > b {
					left = append(left, s)
				}
			}
			st["skipped"] = toAny(left)
			keepRest(time.Duration(math.Max(1000, sec*1500)) * time.Millisecond)
			continue
		}
		if gaveWay(err) || isBusyErr(err) {
			return len(touched), err
		}
		for d := a; d <= b; d = addDays(d, 1) {
			addKeepSkipped(st, d)
		}
		span := a
		if b != a {
			span += "-" + b
		}
		writeLog("Keeping " + company + ": Tally did not give " + span + " (" + err.Error() + "); tried again at the next update")
	}
	return len(touched), nil
}

// the ledgers as numbers and names only: [guid, change number, name, parent]
type kled struct {
	guid         string
	alter        int64
	name, parent string
	gstin, pan   string // 02-Oct-2026: for matching a bill's supplier to its ledger by GSTIN or PAN in FinCom
}

func keepLedgers(tc *TC, company string, port int, after int64) ([]kled, error) {
	flt, sys := "", ""
	if after > 0 {
		flt = "<FILTERS>TDSDeskKeepLedNew</FILTERS>"
		sys = fmt.Sprintf(`<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepLedNew">$AlterID &gt; %d</SYSTEM>`, after)
	}
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepLed</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID,ALTERID,NAME,PARENT,PARTYGSTIN,INCOMETAXNUMBER,LEDGSTREGDETAILS.LIST</FETCH>` + flt + "</COLLECTION>" + sys +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 120)
	if err != nil {
		return nil, err
	}
	var out []kled
	for _, l := range xmlDoc(raw).All("LEDGER") {
		n, g := nameOf(l), strings.TrimSpace(nt(l, "GUID"))
		if n != "" && g != "" {
			gstin := strings.ToUpper(strings.TrimSpace(nt(l, "PARTYGSTIN")))
			if gstin == "" {
				gstin = strings.ToUpper(strings.TrimSpace(nt(l, "LEDGSTREGDETAILS.LIST/GSTIN")))
			}
			out = append(out, kled{g, toI64(re(`\D`).ReplaceAllString(nt(l, "ALTERID"), "")), n, nt(l, "PARENT"), gstin, strings.ToUpper(strings.TrimSpace(nt(l, "INCOMETAXNUMBER")))})
		}
	}
	return out, nil
}

// Tally's groups, name and parent (a primary group's parent is empty)
func keepGroups(tc *TC, company string, port int) ([][2]string, error) {
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepGrp</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepGrp" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME,PARENT</FETCH></COLLECTION>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 60)
	if err != nil {
		return nil, err
	}
	var out [][2]string
	for _, g := range xmlDoc(raw).All("GROUP") {
		if n := nameOf(g); n != "" {
			out = append(out, [2]string{n, re(`^\W*Primary$`).ReplaceAllString(nt(g, "PARENT"), "")})
		}
	}
	return out, nil
}

// a ledger renamed in Tally: the copy's entries carry the new name; nothing is asked of Tally for it
func renameKeepLedger(dir string, st M, old, nw string) int {
	ampx := func(s string) string { return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(s) }
	olds := uniqSorted([]string{esc(old), ampx(old), strings.ReplaceAll(ampx(old), "'", "&apos;")})
	nn := ampx(nw)
	touched := map[string]bool{}
	for _, f := range dayFiles(dir, "") {
		t := readText(f)
		t2 := t
		for _, o := range olds {
			for _, tag := range []string{"LEDGERNAME", "PARTYLEDGERNAME"} {
				t2 = strings.ReplaceAll(t2, "<"+tag+">"+o+"</"+tag+">", "<"+tag+">"+nn+"</"+tag+">")
			}
		}
		if t2 != t {
			base := strings.TrimSuffix(filepath.Base(f), ".xml")
			_ = saveFile(f, t2)
			touched[base[:6]] = true
			addCloudDays(dir, []string{base})
		}
	}
	for ym := range touched {
		writeKeepMonth(dir, ym, st)
	}
	return len(touched)
}

// ledger masters changed in Tally (new, renamed, opening or group changed): names put right, their opening read again
func (k *keepRun) updateLedgers(company string, port int, dir string, st M, full bool) error {
	lf := filepath.Join(dir, "ledgers.json")
	known := map[string][]any{}
	var order []string
	for g, v := range obj(readJSONFile(lf)) {
		known[g] = arr(v)
		order = append(order, g)
	}
	first := len(known) == 0 || !(toI64(st["lastM"]) > 0)
	after := toI64(st["lastM"])
	// a copy made before 2.1.2 has no GSTIN or PAN with its ledgers: read every ledger once to fill them in (a light read)
	ids := !first && !truthy(st["ledIds"])
	if full || first || ids {
		after = 0
	}
	ch, err := keepLedgers(k.tc, company, port, after)
	if err != nil {
		return err
	}
	type again struct{ name, was string }
	var redo []again
	idsChanged := false
	seen := map[string]bool{}
	for _, c := range ch {
		seen[c.guid] = true
		if c.alter > toI64(st["lastM"]) {
			st["lastM"] = c.alter
		}
		kv, had := known[c.guid]
		if first {
			known[c.guid] = []any{c.name, c.parent, c.alter, c.gstin, c.pan}
			continue
		}
		if had && toI64(kv[2]) == c.alter && str(kv[0]) == c.name {
			if len(kv) < 5 || str(at(kv, 3)) != c.gstin || str(at(kv, 4)) != c.pan {
				known[c.guid] = []any{c.name, c.parent, c.alter, c.gstin, c.pan}
				idsChanged = true
			}
			continue
		}
		if had && str(kv[0]) != c.name {
			renameKeepLedger(dir, st, str(kv[0]), c.name)
			writeLog("Keeping " + company + ": ledger " + str(kv[0]) + " is now " + c.name)
		}
		known[c.guid] = []any{c.name, c.parent, c.alter, c.gstin, c.pan}
		w := ""
		if had {
			w = str(kv[0])
		}
		redo = append(redo, again{c.name, w})
	}
	var gone []string
	if full && !first {
		for g, v := range known {
			if !seen[g] {
				gone = append(gone, str(v[0]))
				delete(known, g)
			}
		}
	}
	if !first && (len(redo) > 0 || len(gone) > 0) {
		bf := filepath.Join(dir, "balances.json")
		if bal := readObjFile(bf); bal != nil {
			rows := map[string]M{}
			var rorder []string
			for _, x := range arr(bal["ledgers"]) {
				l := obj(x)
				n := str(l["name"])
				if _, ok := rows[n]; !ok {
					rorder = append(rorder, n)
				}
				rows[n] = M{"name": n, "parent": str(l["parent"]), "open": str(l["open"]), "close": ""}
			}
			for _, x := range redo {
				if x.was != "" && x.was != x.name {
					delete(rows, x.was)
				}
			}
			for _, n := range gone {
				delete(rows, n)
			}
			var names []string
			for _, x := range redo {
				names = append(names, x.name)
			}
			// 2.1.3: only the ledgers changed in Tally have their opening read again, a batch at a time (02-Oct-2026: one
			// changed ledger made 2.1.2 read every opening balance again in one request, 16:03)
			size, min := keepBalSize(st), keepNum("KeepBalMin", 5)
			for i := 0; i < len(names); {
				chunk := names[i:minI(len(names), i+size)]
				got, err := keepBalances(k.tc, company, port, chunk, str(bal["openAsOn"]))
				if err != nil {
					if !gaveWay(err) {
						was := len(chunk)
						size = maxI(min, was/2)
						st["openSize"] = size
						saveKeepState(dir, st)
						return fmt.Errorf("the opening balances of %d changed ledger(s) did not come in a batch of %d ledgers (%s); the next try reads a batch of %d ledgers", len(names), was, err.Error(), size)
					}
					return err
				}
				for _, n := range chunk {
					delete(rows, n)
				}
				for _, r := range got {
					if _, ok := rows[r[0]]; !ok {
						rorder = append(rorder, r[0])
					}
					rows[r[0]] = M{"name": r[0], "parent": r[1], "open": r[2], "close": ""}
				}
				i += len(chunk)
			}
			led := []any{}
			done := map[string]bool{}
			for _, n := range rorder {
				if r, ok := rows[n]; ok && !done[n] {
					led = append(led, r)
					done[n] = true
				}
			}
			bal["ledgers"] = led
			_ = saveFile(bf, jsonText(bal))
			setCloudLedgers(dir)
			st["balAt"] = nowS()
			msg := fmt.Sprintf("Keeping %s: %d ledger(s) changed in Tally", company, len(names))
			if len(gone) > 0 {
				msg += fmt.Sprintf(", %d no longer there", len(gone))
			}
			writeLog(msg + "; their opening read again")
		}
	}
	o := M{}
	for g, v := range known {
		o[g] = v
	}
	_ = saveFile(lf, jsonText(o))
	st["ledIds"] = true
	if idsChanged {
		setCloudLedgers(dir) // the ledgers go to FinCom's cloud again, now with their GSTIN and PAN
		if ids {
			writeLog("Keeping " + company + ": the ledgers' GSTIN and PAN read from Tally")
		}
	}
	// the groups with every full look at the ledgers; the cloud sent the ledgers again whenever a name or a group differs
	gf := filepath.Join(dir, "groups.json")
	if full || first || !exists(gf) {
		if grp, err := keepGroups(k.tc, company, port); err != nil {
			if gaveWay(err) || isBusyErr(err) {
				return err
			}
			writeLog("Keeping " + company + ": the groups could not be read this time (" + err.Error() + ")")
		} else if len(grp) > 0 {
			a := []any{}
			for _, g := range grp {
				a = append(a, []any{g[0], g[1]})
			}
			_ = saveFile(gf, jsonText(a))
		}
	}
	var parts []string
	for _, v := range known {
		parts = append(parts, str(v[0])+">"+str(v[1]))
	}
	sort.Strings(parts)
	if exists(gf) {
		parts = append(parts, readText(gf))
	}
	h := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	sig := strings.ToUpper(hex.EncodeToString(h[:]))
	sf := filepath.Join(dir, "cloud-ledgers.sig")
	if sig != strings.TrimSpace(readText(sf)) {
		setCloudLedgers(dir)
		_ = saveFile(sf, sig)
	}
	return nil
}

// one month of the copy compared with Tally's list of entries, and the dates that differ read again; also notices when
// Tally's change numbers have gone back (a backup restored): then the company is copied again
func (k *keepRun) monthFix(company string, port int, dir string, st M, ym, td string) (int, error) {
	mf := ym + "01"
	if mf < str(st["from"]) {
		mf = str(st["from"])
	}
	mt := monthEnd(ym)
	if mt > td {
		mt = td
	}
	if mf > mt {
		return 0, nil
	}
	tl, err := keepList(k.tc, company, port, mf, mt, 0)
	if err != nil {
		return 0, err
	}
	h := keepHeld(dir, ym)
	bad := map[string]bool{}
	seen := map[string]bool{}
	back := 0
	var max int64
	for _, e := range tl {
		seen[e.guid] = true
		if e.alter > max {
			max = e.alter
		}
		x, ok := h[e.guid]
		if !ok {
			bad[e.date] = true
		} else if x.alter != e.alter || x.date != e.date {
			bad[e.date], bad[x.date] = true, true
			if x.alter > e.alter {
				back++
			}
		}
	}
	for g, x := range h {
		if !seen[g] {
			bad[x.date] = true
		}
	}
	if back > 0 && str(st["phase"]) == "live" {
		writeLog("Keeping " + company + ": Tally's change numbers have gone back (a backup restored or the data rewritten?); copying the company again, gently")
		st["phase"], st["last"], st["next"], st["slice"], st["checkYm"] = "first", 0, st["from"], keepNum("KeepSliceDays", 1), str(st["from"])[:6]
		st["openPending"], st["openIdx"], st["lastM"] = true, 0, 0 // the openings may differ too: read again, a batch at a time
		return 0, nil
	}
	if max > toI64(st["last"]) && str(st["phase"]) != "live" {
		st["last"] = max
	}
	if len(bad) > 0 {
		var ds []string
		for d := range bad {
			ds = append(ds, d)
		}
		if _, err := k.updateDates(company, port, dir, st, ds); err != nil {
			return len(bad), err
		}
		writeLog(fmt.Sprintf("Keeping %s: %s differed on %d date(s); read again", company, ym, len(bad)))
	}
	return len(bad), nil
}

// the opening balances, as FinCom reads them (balances.json), and on to the cloud
func (k *keepRun) saveOpening(company string, port int, dir string, st M, rows [][3]string, asOn, td string) error {
	led := []any{}
	for _, r := range rows {
		led = append(led, M{"name": r[0], "parent": r[1], "open": r[2], "close": ""})
	}
	bal := M{"ok": true, "company": company, "from": st["from"], "to": td, "openAsOn": asOn, "ledgers": led, "keep": true}
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(bal))
	setCloudLedgers(dir)
	st["balAt"] = nowS()
	st["lastM"] = 0
	err := k.updateLedgers(company, port, dir, st, false) // the ledgers' own numbers, to follow renames and changes
	writeLog(fmt.Sprintf("Keeping %s: opening balances read (%d ledgers)", company, len(led)))
	return err
}

// how many ledgers' opening balances one request asks for: KeepBalBatch (50) to start, halved after a failure down to
// KeepBalMin (5), doubled while Tally answers quickly up to KeepBalMax (150); kept in the copy's state
func keepBalSize(st M) int {
	size := toInt(st["openSize"])
	if size <= 0 {
		size = keepNum("KeepBalBatch", 50)
	}
	return maxI(keepNum("KeepBalMin", 5), minI(size, keepNum("KeepBalMax", 150)))
}

// The opening balances (as on the day before the copy starts), a batch of ledgers at a time (2.1.3; 2.1.2 read every
// one in one request that could hold Tally 15 minutes). Each batch is saved as it comes (open-part.json, openIdx), so a
// failure, a posting that goes first, or a restart never throws the work away: the next try starts at the first ledger
// not read yet. After a failure the next batch is half the size. true: every opening balance is in
func (k *keepRun) readOpening(company string, port int, dir string, st M, td string, inBudget func() bool) (bool, error) {
	asOn := addDays(str(st["from"]), -1)
	nf, pf := filepath.Join(dir, "open-names.json"), filepath.Join(dir, "open-part.json")
	var names []string
	if toInt(st["openIdx"]) > 0 && exists(nf) {
		names = strs(readJSONFile(nf))
	}
	if len(names) == 0 {
		// the ledgers' names once (a light read: names and groups, no balances), kept for the batches that follow
		ln, err := getLedgerNames(k.tc, company, port)
		if err != nil {
			return false, err
		}
		for _, x := range arr(ln["ledgers"]) {
			if n := str(at(arr(x), 0)); n != "" {
				names = append(names, n)
			}
		}
		names = uniqSorted(names)
		_ = saveFile(nf, jsonText(toAny(names)))
		_ = os.Remove(pf)
		st["openIdx"] = 0
	}
	var got [][3]string
	if toInt(st["openIdx"]) > 0 {
		for _, x := range arr(readJSONFile(pf)) {
			if a := arr(x); len(a) >= 3 {
				got = append(got, [3]string{str(a[0]), str(a[1]), str(a[2])})
			}
		}
	}
	size, min, max := keepBalSize(st), keepNum("KeepBalMin", 5), keepNum("KeepBalMax", 150)
	for toInt(st["openIdx"]) < len(names) && inBudget() {
		if keepHold() != "" {
			return false, nil
		}
		i0 := toInt(st["openIdx"])
		chunk := names[i0:minI(len(names), i0+size)]
		writeLog(fmt.Sprintf("Keeping %s: opening balances, batch of %d ledgers (%d-%d of %d)", company, len(chunk), i0+1, i0+len(chunk), len(names)))
		tt := time.Now()
		rows, err := keepBalances(k.tc, company, port, chunk, asOn)
		if err != nil {
			if gaveWay(err) {
				return false, err // the same batch again when Tally is free; nothing is lost
			}
			size = maxI(min, len(chunk)/2)
			st["openSize"] = size
			saveKeepState(dir, st)
			return false, fmt.Errorf("the opening balances of a batch of %d ledgers did not come (%s); %d of %d are kept, and the next try reads a batch of %d ledgers from ledger %d", len(chunk), err.Error(), i0, len(names), size, i0+1)
		}
		got = append(got, rows...)
		a := []any{}
		for _, g := range got {
			a = append(a, []any{g[0], g[1], g[2]})
		}
		_ = saveFile(pf, jsonText(a))
		st["openIdx"] = i0 + len(chunk)
		took, aim := time.Since(tt).Seconds(), keepTargetSec()
		if took > aim {
			size = maxI(min, size/2)
		} else if took < aim/3 {
			size = minI(max, size*2)
		}
		st["openSize"] = size
		st["at"] = nowS()
		saveKeepState(dir, st)
		keepRest(time.Duration(math.Max(1000, took*1500)) * time.Millisecond)
	}
	if toInt(st["openIdx"]) < len(names) {
		return false, nil
	}
	if err := k.saveOpening(company, port, dir, st, got, asOn, td); err != nil {
		return false, err
	}
	st["openIdx"], st["openPending"], st["balMode"] = 0, false, "batch"
	_ = os.Remove(pf)
	_ = os.Remove(nf)
	return true, nil
}

// an entry FinCom posted and the read-back found (with its GUID and change number): noted for the copier, which puts it
// into the copy and sends its day to the cloud without reading the day from Tally
func addPostedForCopy(company string, head M, xml string) {
	g, a, d := str(head["guid"]), strings.TrimSpace(str(head["alter"])), str(head["date"])
	if g == "" || !re(`^\d+$`).MatchString(a) || !isTallyDate(d) || xml == "" {
		return
	}
	dir := syncFolder(company)
	if !exists(filepath.Join(dir, "keep.json")) {
		return
	}
	_ = appendText(filepath.Join(dir, "posted-in.jsonl"), jsonText(M{"guid": g, "alter": toI64(a), "date": d, "number": str(head["number"]), "type": str(head["type"]), "xml": xml})+"\n")
}
func useKeepPosted(dir string, st M) int {
	f := filepath.Join(dir, "posted-in.jsonl")
	if !exists(f) {
		return 0
	}
	w := filepath.Join(dir, fmt.Sprintf("posted-in.%d.work", time.Now().UnixNano()))
	if os.Rename(f, w) != nil {
		return 0
	}
	days := filepath.Join(dir, "days")
	_ = os.MkdirAll(days, 0o755)
	where := keepWhere(dir)
	touched := map[string]bool{}
	n := 0
	for _, ln := range strings.Split(readText(w), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		e := parseObj(ln)
		if e == nil || str(e["date"]) < str(st["from"]) {
			continue
		}
		x := strings.TrimSpace(str(e["xml"]))
		open := re(`^<VOUCHER\b[^>]*>`).FindString(x)
		if open == "" {
			continue
		}
		if !strings.Contains(open, "VCHTYPE=") && str(e["type"]) != "" {
			open = `<VOUCHER VCHTYPE="` + esc(str(e["type"])) + `"` + strings.TrimPrefix(open, "<VOUCHER")
		}
		rest := x[len(re(`^<VOUCHER\b[^>]*>`).FindString(x)):]
		rest = re(`<GUID>[^<]*</GUID>`).ReplaceAllString(rest, "")
		rest = re(`<ALTERID>[^<]*</ALTERID>`).ReplaceAllString(rest, "")
		rest = re(`<VOUCHERNUMBER>[^<]*</VOUCHERNUMBER>`).ReplaceAllString(rest, "")
		if loc := re(`<DATE>[^<]*</DATE>`).FindStringIndex(rest); loc != nil {
			rest = rest[:loc[0]] + "<DATE>" + str(e["date"]) + "</DATE>" + rest[loc[1]:]
		}
		v := open + "<GUID>" + esc(str(e["guid"])) + "</GUID><ALTERID> " + fmt.Sprint(toI64(e["alter"])) + "</ALTERID>"
		if str(e["number"]) != "" {
			v += "<VOUCHERNUMBER>" + esc(str(e["number"])) + "</VOUCHERNUMBER>"
		}
		v += rest
		tag := "<GUID>" + esc(str(e["guid"])) + "</GUID>"
		for _, day := range uniqSorted([]string{str(e["date"]), whereGet(where, str(e["guid"]))}) {
			df := filepath.Join(days, day+".xml")
			t := readText(df)
			var keep strings.Builder
			for _, pc := range re(`<TALLYMESSAGE>[\s\S]*?</TALLYMESSAGE>`).FindAllString(t, -1) {
				if !strings.Contains(pc, tag) {
					keep.WriteString(pc)
				}
			}
			if day == str(e["date"]) {
				keep.WriteString("<TALLYMESSAGE>" + v + "</TALLYMESSAGE>")
			}
			t2 := keep.String()
			_ = saveFile(df, t2)
			_ = saveFile(strings.TrimSuffix(df, ".xml")+".idx", indexText(t2))
			touched[day] = true
		}
		whereMu.Lock()
		where[str(e["guid"])] = str(e["date"])
		whereMu.Unlock()
		st["verify"] = toAny(uniqSorted(append(strs(st["verify"]), str(e["date"]))))
		n++
	}
	_ = os.Remove(w)
	if len(touched) > 0 {
		var ds []string
		yms := map[string]bool{}
		for d := range touched {
			ds = append(ds, d)
			yms[d[:6]] = true
		}
		addCloudDays(dir, ds)
		for ym := range yms {
			writeKeepMonth(dir, ym, st)
		}
	}
	return n
}

// one turn for one open company: at most a few seconds of Tally's time, with pauses between reads
func (k *keepRun) step(company string, port int, booksFrom string) error {
	keepMu.Lock()
	defer keepMu.Unlock()
	dir := syncFolder(company)
	_ = os.MkdirAll(dir, 0o755)
	td := today()
	st := readKeepState(dir)
	if st == nil && keepMode(company) != "bridge" {
		wf := filepath.Join(dir, "waiting.txt")
		if !exists(wf) {
			_ = saveFile(wf, nowS())
			writeLog("Keeping " + company + " in step: waiting for the day book files from FinCom (Books, From Tally); Tally is not read for the year")
		}
		return nil
	}
	if st == nil {
		from := tallyDate(fyStart(time.Now()))
		if v := cfgS("KeepFrom"); re(`^\d{8}$`).MatchString(v) {
			from = v
		}
		if re(`^\d{8}$`).MatchString(booksFrom) && booksFrom > from {
			from = booksFrom
		}
		st = M{"company": company, "from": from, "next": from, "slice": keepNum("KeepSliceDays", 1), "phase": "open", "openIdx": 0, "last": 0, "lastM": 0, "checkYm": "", "months": M{}, "cycle": 0, "skipped": []any{}, "dayFail": 0}
		writeLog("Keeping " + company + " in step with FinCom: first copy from " + from)
	}
	k.caughtUp = false
	if k.light && str(st["phase"]) != "live" {
		k.caughtUp = true // the first copy waits for the daily update
		return nil
	}
	// 2.1.3: no "quiet time" is guessed any more (02-Oct-2026: one was "found" at 15:02 and 16:03 on a working day,
	// from nobody touching this computer's keyboard): the first copy is made by the nightly catch-up or Update now
	st["cycle"] = toInt(st["cycle"]) + 1
	budget := time.Duration(keepNum("KeepBudgetSec", 20)) * time.Second
	t0 := time.Now()
	inBudget := func() bool { return time.Since(t0) < budget }
	save := func() {
		st["at"] = nowS()
		saveKeepState(dir, st)
		writeKeepManifest(dir, st, td)
	}
	phase := func() string { return str(st["phase"]) }

	if phase() == "open" {
		// opening balances on the day before the copy starts, a batch of ledgers at a time
		done, err := k.readOpening(company, port, dir, st, td, inBudget)
		if err != nil {
			return err
		}
		if done {
			if str(st["next"]) > td {
				st["phase"] = "check"
			} else {
				st["phase"] = "first"
			}
		}
		save()
		if phase() == "open" {
			return nil
		}
	}
	// a copy whose openings were left for "a quiet time" by 2.1.2 (balMode whole): read now, a batch at a time, and
	// only these once: after that only the ledgers changed in Tally have their opening read again
	if truthy(st["openPending"]) && !k.light {
		done, err := k.readOpening(company, port, dir, st, td, inBudget)
		if err != nil {
			return err
		}
		save()
		if !done {
			return nil
		}
	}
	if phase() == "first" {
		// the year's day book, a few days at a time; smaller steps when Tally is slow, bigger when it is quick
		for str(st["next"]) <= td && inBudget() && keepRoom(port) && keepHold() == "" {
			f := str(st["next"])
			t := addDays(f, toInt(st["slice"])-1)
			if t > td {
				t = td
			}
			sec, _, err := copyKeepDays(k.tc, company, port, dir, f, t)
			if err != nil && gaveWay(err) {
				return err // the same days again when Tally is free
			}
			if err != nil {
				why := err.Error()
				if toInt(st["slice"]) > 1 {
					st["slice"] = maxI(1, toInt(st["slice"])/2)
					save()
					return fmt.Errorf("Tally did not give %s-%s (%s); next time a smaller step", f, t, why)
				}
				st["dayFail"] = toInt(st["dayFail"]) + 1
				if toInt(st["dayFail"]) >= 3 {
					addKeepSkipped(st, f)
					st["next"], st["dayFail"] = addDays(f, 1), 0
					save()
					writeLog("Keeping " + company + ": Tally could not give " + f + " after 3 tries (" + why + "); going on, and trying that day again later")
					return nil
				}
				save()
				return fmt.Errorf("Tally did not give %s (%s); try %d of 3", f, why, toInt(st["dayFail"]))
			}
			st["dayFail"] = 0
			aim := keepTargetSec()
			if sec > aim && toInt(st["slice"]) > 1 {
				st["slice"] = maxI(1, toInt(st["slice"])/2)
			} else if sec < aim/3 && toInt(st["slice"]) < 31 {
				st["slice"] = minI(31, toInt(st["slice"])*2)
			}
			writeKeepMonth(dir, f[:6], st)
			if t[:6] != f[:6] {
				writeKeepMonth(dir, t[:6], st)
			}
			st["next"] = addDays(t, 1)
			save()
			keepRest(time.Duration(math.Max(2000, sec*1500)) * time.Millisecond)
		}
		if str(st["next"]) > td {
			st["phase"], st["checkYm"] = "check", str(st["from"])[:6]
			writeLog("Keeping " + company + ": first copy done; checking it month by month")
		}
		st["trouble"] = nil
		save()
		return nil
	}
	// entries just posted from FinCom: into the copy and on to the cloud, without reading Tally
	if phase() == "live" {
		if pn := useKeepPosted(dir, st); pn > 0 {
			writeLog(fmt.Sprintf("Keeping %s: %d entries posted from FinCom put in the copy and sent to the cloud (Tally not read)", company, pn))
			save()
		}
	}
	// a new day: the days since the last turn
	if str(st["next"]) <= td {
		if _, err := k.updateDates(company, port, dir, st, dayRange(str(st["next"]), td)); err != nil {
			return err
		}
		st["next"] = addDays(td, 1)
	}
	// Tally's own change counters first: when neither has moved, nothing changed in the company
	cnOK, cv, cm := false, int64(0), int64(0)
	if phase() == "live" {
		ok, v, m, err := keepCounters(k.tc, company, port)
		if err != nil && (gaveWay(err) || isBusyErr(err)) {
			return err // Tally not answering even this tiny request: left alone, nothing more is asked
		}
		if err == nil {
			cnOK, cv, cm = ok, v, m
		}
	}
	hasCV := st["cv"] != nil
	quiet := cnOK && hasCV && toI64(st["cv"]) == cv && toI64(st["cm"]) == cm
	if cnOK && hasCV && cv < toI64(st["cv"]) {
		writeLog("Keeping " + company + ": Tally's change numbers have gone back (a backup restored or the data rewritten?); copying the company again, gently")
		st["phase"], st["last"], st["next"], st["slice"], st["checkYm"], st["cv"], st["cm"] = "first", 0, st["from"], keepNum("KeepSliceDays", 1), str(st["from"])[:6], nil, nil
		st["openPending"], st["openIdx"], st["lastM"] = true, 0, 0 // the openings may differ too: read again, a batch at a time
		save()
		return nil
	}
	st["counters"] = cnOK
	// entries changed since the last change number seen: their dates now, and where the copy had them before
	var ch []kentry
	if phase() == "live" && toI64(st["last"]) > 0 && !quiet {
		rf := time.Now().AddDate(0, -2, 0).Format("200601") + "01"
		if rf < str(st["from"]) {
			rf = str(st["from"])
		}
		var err error
		if ch, err = keepList(k.tc, company, port, rf, td, toI64(st["last"])); err != nil {
			return err
		}
		wide := false
		if cnOK {
			mx := toI64(st["last"])
			for _, c := range ch {
				if c.alter > mx {
					mx = c.alter
				}
			}
			wide = mx < cv && rf > str(st["from"])
		} else if rf > str(st["from"]) && toInt(st["cycle"])%keepNum("KeepCheckEvery", 5) == 0 {
			wide = true
		}
		if wide && keepRoom(port) {
			if ch, err = keepList(k.tc, company, port, str(st["from"]), td, toI64(st["last"])); err != nil {
				return err
			}
		}
		if len(ch) > 0 {
			where := keepWhere(dir)
			ix := map[string]map[string]int64{}
			var need []kentry
			for _, c := range ch {
				o := whereGet(where, c.guid)
				if o != "" && o == c.date {
					if _, ok := ix[o]; !ok {
						m := map[string]int64{}
						if f := filepath.Join(dir, "days", o+".xml"); exists(f) {
							for _, ln := range strings.Split(readKeepIndex(f), "\n") {
								q := strings.Split(ln, "\t")
								if q[0] != "" && len(q) > 1 {
									m[q[0]] = toI64(q[1])
								}
							}
						}
						ix[o] = m
					}
					if a, ok := ix[o][c.guid]; ok && a == c.alter {
						continue
					}
				}
				need = append(need, c)
			}
			var dates []string
			for _, c := range need {
				dates = append(dates, c.date)
				if o := whereGet(where, c.guid); o != "" && o != c.date {
					dates = append(dates, o)
				}
			}
			dates = uniqSorted(dates)
			if len(dates) > 0 {
				if _, err := k.updateDates(company, port, dir, st, dates); err != nil {
					return err
				}
			}
			var mx int64
			for _, c := range ch {
				if c.alter > mx {
					mx = c.alter
				}
			}
			st["last"] = mx
			if len(dates) > 0 {
				writeLog(fmt.Sprintf("Keeping %s: %d changed entries on %d dates brought in", company, len(ch), len(dates)))
			} else {
				writeLog(fmt.Sprintf("Keeping %s: %d changed entries, already in the copy", company, len(ch)))
			}
		}
		// the counter moved but no entry has a newer change number: most likely an entry was deleted
		if cnOK && len(ch) == 0 && cv != toI64(st["cv"]) && hasCV {
			for _, ym := range []string{td[:6], time.Now().AddDate(0, -1, 0).Format("200601")} {
				if ym >= str(st["from"])[:6] && keepRoom(port) {
					if _, err := k.monthFix(company, port, dir, st, ym, td); err != nil {
						return err
					}
				}
			}
		}
	}
	// nothing changed since the last look: up to date for today's run (the daily update also checks a whole round of months)
	if phase() == "live" && (quiet || len(ch) == 0) && (!k.once || (str(st["roundFrom"]) == td && str(st["roundAt"]) == td)) {
		k.caughtUp = true
	}
	// ledger masters changed since the last look
	if phase() == "live" && inBudget() && !(cnOK && st["cm"] != nil && toI64(st["cm"]) == cm) {
		if err := k.updateLedgers(company, port, dir, st, false); err != nil {
			return err
		}
	} else if phase() == "live" && inBudget() && !exists(filepath.Join(dir, "groups.json")) {
		if err := k.updateLedgers(company, port, dir, st, true); err != nil {
			return err
		}
	}
	// a run someone asked for (Update now, Send ledgers and groups now) reads every ledger and group once
	nowAsk := strings.TrimSpace(readText(sp("keep-now.txt")))
	kwMu.Lock()
	sent := ledSent[company]
	kwMu.Unlock()
	if phase() == "live" && nowAsk != "" && sent != nowAsk && inBudget() {
		kwMu.Lock()
		ledSent[company] = nowAsk
		kwMu.Unlock()
		if err := k.updateLedgers(company, port, dir, st, true); err != nil {
			return err
		}
		_ = os.Remove(filepath.Join(dir, "cloud-ledgers.sig"))
		setCloudLedgers(dir)
		writeLog("Keeping " + company + ": every ledger and group read from Tally, to go to the cloud")
	}
	if cnOK {
		st["cv"], st["cm"] = cv, cm
	}
	// the light check stops here: the month checks and the retries wait for the daily update
	if k.light {
		st["trouble"] = nil
		save()
		k.caughtUp = true
		return nil
	}
	// the days posted from FinCom read once from Tally, so the copy is exactly as Tally keeps them
	if vd := strs(st["verify"]); len(vd) > 0 && inBudget() {
		if _, err := k.updateDates(company, port, dir, st, vd); err != nil {
			return err
		}
		st["verify"] = []any{}
		writeLog(fmt.Sprintf("Keeping %s: %d day(s) posted from FinCom read as Tally keeps them", company, len(vd)))
	}
	// a month FinCom asked to be checked, now
	rq := filepath.Join(dir, "recheck.txt")
	if exists(rq) && inBudget() {
		want := strings.TrimSpace(readText(rq))
		_ = os.WriteFile(rq, nil, 0o644)
		if re(`^\d{6}$`).MatchString(want) {
			if _, err := k.monthFix(company, port, dir, st, want, td); err != nil {
				return err
			}
		}
	}
	// deleted entries leave no change number, so months are compared with Tally's list: this month often, others in turn
	every := keepNum("KeepCheckEvery", 5)
	if phase() == "check" {
		every = 1
	}
	nowEvery := keepNum("KeepNowEvery", 2)
	if quiet {
		every, nowEvery = every*3, nowEvery*3
	}
	if k.once {
		every = 1
	}
	if inBudget() && keepRoom(port) {
		if toInt(st["cycle"])%every == 0 {
			ym := str(st["checkYm"])
			if ym == "" {
				ym = str(st["from"])[:6]
			}
			if ym == str(st["from"])[:6] {
				st["roundFrom"] = td
			}
			if _, err := k.monthFix(company, port, dir, st, ym, td); err != nil {
				return err
			}
			if str(st["checkYm"]) == ym {
				nx := nextYm(ym)
				if nx > td[:6] {
					nx = str(st["from"])[:6]
					if str(st["roundFrom"]) == td {
						st["roundAt"] = td
					}
					if phase() == "check" {
						st["phase"] = "live"
						writeLog("Keeping " + company + ": in step with Tally")
					}
					if phase() == "live" && inBudget() {
						if err := k.updateLedgers(company, port, dir, st, true); err != nil { // once a round: ledgers no longer in Tally
							return err
						}
					}
				}
				st["checkYm"] = nx
			}
		} else if phase() == "live" && toInt(st["cycle"])%nowEvery == 0 {
			if _, err := k.monthFix(company, port, dir, st, td[:6], td); err != nil {
				return err
			}
		}
	}
	// days Tally could not give before: one more try now and then
	if sk := strs(st["skipped"]); phase() == "live" && len(sk) > 0 && toInt(st["cycle"])%every == 1 && inBudget() {
		d := sk[0]
		if _, err := k.updateDates(company, port, dir, st, []string{d}); err != nil {
			return err
		}
		if !contains(strs(st["skipped"]), d) {
			writeLog("Keeping " + company + ": " + d + " read now")
		}
	}
	st["trouble"] = nil
	save()
	return nil
}

// a turn that went wrong: noted for FinCom to show
func setKeepTrouble(company, why string) {
	dir := syncFolder(company)
	if st := readKeepState(dir); st != nil {
		st["trouble"] = M{"at": nowS(), "why": why}
		saveKeepState(dir, st)
		writeKeepManifest(dir, st, today())
	}
}

// what the copier tells FinCom about each Tally's load
func writeKeepLoad() {
	useMu.Lock()
	var ports []int
	for p := range tallyUse {
		ports = append(ports, p)
	}
	kinds := []any{}
	for _, t := range tallyStats {
		kinds = append(kinds, M{"port": t.port, "kind": t.kind, "n": t.n, "avgSec": math.Round(t.sec/float64(maxI(1, t.n))*100) / 100, "maxSec": math.Round(t.max*100) / 100, "failed": t.fail})
	}
	useMu.Unlock()
	pl := []any{}
	for _, p := range ports {
		pl = append(pl, M{"port": p, "sharePct": math.Round(tallyShare(p)*1000) / 10, "limitPct": keepSharePct()})
	}
	_ = saveFile(sp("keep-load.json"), jsonText(M{"at": nowS(), "ports": pl, "requests": kinds}))
}

// --- a run of the copier, asked for by an event (events.go): light (a client opened in FinCom, or the entries just
// posted), now (Update now), nightly (the nightly catch-up)
type runReq struct {
	kind string   // light | now | nightly
	only []string // these companies only; none: every company open in Tally
	why  string   // for the log
}

func runRank(kind string) int { return map[string]int{"light": 1, "nightly": 2, "now": 3}[kind] }

// a run starts now, or (one is going) follows it; a light update of a company a fuller run is reading anyway is dropped
func startKeepRun(r runReq) bool {
	if !keepOn() {
		return false
	}
	kwMu.Lock()
	defer kwMu.Unlock()
	if kwRunning {
		if cur := kwRun; r.kind == "light" && cur != nil && cur.kind != "light" {
			if len(cur.only) == 0 {
				return false
			}
			for _, c := range r.only {
				if contains(cur.only, c) {
					return false
				}
			}
		}
		if kwPending == nil {
			c := r
			kwPending = &c
		} else {
			m := *kwPending
			if runRank(r.kind) > runRank(m.kind) {
				m.kind, m.why = r.kind, r.why
			}
			if len(m.only) == 0 || len(r.only) == 0 {
				m.only = nil
			} else {
				m.only = uniqSorted(append(append([]string{}, m.only...), r.only...))
			}
			kwPending = &m
		}
		return true
	}
	kwRunning = true
	go keepWorker(r)
	return true
}

// the earliest end of a back-off going on now (zero: none)
func anyBackoff() time.Time {
	bgMu.Lock()
	defer bgMu.Unlock()
	var w time.Time
	for _, b := range bgBack {
		if nowFn().Before(b.until) && (w.IsZero() || b.until.Before(w)) {
			w = b.until
		}
	}
	return w
}

// sleeps until t (or the bridge stops), sending nothing
func sleepUntil(t time.Time) {
	for !stopping() && nowFn().Before(t) {
		sleepOrStop(minDur(time.Second, t.Sub(nowFn())))
	}
}
func minDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

// the time of the last read from Tally that came in, for FinCom's "last read 15:34" and "Books as of 15:34"
func markRead(company string) {
	dir := syncFolder(company)
	if st := readKeepState(dir); st != nil {
		st["readAt"] = nowS()
		saveKeepState(dir, st)
		writeKeepManifest(dir, st, today())
	}
}

// The copier: one run, started by an event, ending when every company asked for is up to date (or the run's time is
// up). Tally is asked which companies are open once, at the start; a posting or any request of FinCom's goes first (the
// read waits, or is stopped at once and goes on from where it was); after a failure Tally is left alone (one line in
// the log, nothing sent) and the next try is smaller
func keepWorker(r runReq) {
	pidf := sp("keep.pid")
	_ = saveFile(pidf, fmt.Sprint(os.Getpid()))
	_ = saveFile(sp("keep.ver"), BridgeVersion)
	k := &keepRun{tc: &TC{copier: true, readSec: keepNum("KeepReadSec", 120)}, kind: r.kind, only: r.only, light: r.kind == "light", force: r.kind == "now", once: true, told: map[string]bool{}}
	kwMu.Lock()
	kwRun = k
	kwMu.Unlock()
	defer func() {
		if x := recover(); x != nil {
			writeLog(fmt.Sprint("Keeping copies in step stopped: ", x))
		}
		if strings.TrimSpace(readText(pidf)) == fmt.Sprint(os.Getpid()) {
			_ = os.WriteFile(pidf, nil, 0o644)
		}
		kwMu.Lock()
		next := kwPending
		kwRunning, kwRun, kwPending = false, nil, nil
		kwMu.Unlock()
		if next != nil && !stopping() {
			startKeepRun(*next)
		}
	}()
	what := map[string]string{"light": "Light update", "now": "Update from Tally", "nightly": "Nightly catch-up"}[r.kind]
	switch r.kind {
	case "light":
		writeLog("Light update of " + strings.Join(r.only, ", ") + " (" + r.why + "): only what changed in Tally since the last read")
	case "now":
		writeLog("Update from Tally: asked for now")
	default:
		writeLog("Nightly catch-up (" + keepDailyAt() + "): Tally is open and nobody has used FinCom for 15 minutes")
	}
	runEnd := time.Now().Add(time.Duration(keepNum("KeepRunMin", 30)) * time.Minute)
	sent0 := tallySent.Load()
	reqs := func() string { return fmt.Sprintf(" (%d request(s) to Tally)", tallySent.Load()-sent0) }
	upToDate := map[string]bool{}
	type oc struct {
		name string
		port int
		from string
	}
	var open []oc
	asked, held, why := false, "", ""
	heldAt := time.Time{}
	for {
		syncConfig()
		if !keepOn() || stopping() {
			break
		}
		if paused() && r.kind != "now" {
			why = "background reading is paused (tray icon)"
			break
		}
		if time.Now().After(runEnd) {
			why = "time is up; the rest follows at the next update"
			break
		}
		if hold := keepHold(); hold != "" {
			if hold != held {
				writeLog(what + ": waiting, " + hold)
				heldAt = time.Now()
			}
			held = hold
			if k.light && time.Since(heldAt) > 2*time.Minute {
				why = hold
				break
			}
			sleepOrStop(5 * time.Second)
			continue
		}
		held = ""
		if len(activeJobs()) > 0 { // a posting goes first: nothing is read while one is going
			sleepOrStop(2 * time.Second)
			continue
		}
		if !asked {
			// Tally left alone after a failure: nothing is sent until the back-off ends
			if u := anyBackoff(); !u.IsZero() {
				if k.light || u.After(runEnd) {
					why = "Tally is left alone until " + u.Format("15:04")
					break
				}
				sleepUntil(u)
				continue
			}
			// which companies are open: asked once a run
			want := strs(cfg("KeepCompanies"))
			for _, s := range openCompaniesWith(k.tc, true) {
				if s["skipped"] == true || s["ok"] != true {
					continue
				}
				for _, c := range sessCompanies(s) {
					n := str(c["name"])
					if (len(want) > 0 && !contains(want, n)) || (len(r.only) > 0 && !contains(r.only, n)) {
						continue
					}
					open = append(open, oc{n, toInt(s["port"]), str(c["from"])})
				}
			}
			if len(open) == 0 && (!anyBackoff().IsZero() || tallyWanted()) {
				// the list itself was held back, or stopped for FinCom's request: asked again when Tally is free
				sleepOrStop(2 * time.Second)
				continue
			}
			asked = true
			if len(open) == 0 {
				if len(r.only) > 0 {
					why = strings.Join(r.only, ", ") + " is not open in Tally"
				} else {
					why = "no company is open in Tally"
				}
				break
			}
		}
		for _, o := range open {
			if upToDate[o.name] || !bgBackoffUntil(o.port).IsZero() || !keepRoom(o.port) || userWaiting(o.port) {
				continue
			}
			err := k.step(o.name, o.port, o.from)
			switch {
			case err == nil:
				clearBgBackoff(o.port)
				markRead(o.name)
				if k.caughtUp {
					upToDate[o.name] = true
				}
			case errors.Is(err, errPreempted):
				if !k.told["pre:"+o.name] {
					k.told["pre:"+o.name] = true
					writeLog("Keeping " + o.name + ": paused for FinCom's request (a posting goes first); it resumes from where it was")
				}
			case errors.Is(err, errBackoff):
			default:
				until := setBgBackoff(o.port)
				// one line; nothing is sent to Tally until then
				writeLog(fmt.Sprintf("Keeping %s: %s. Leaving Tally alone until %s", o.name, err.Error(), until.Format("15:04")))
				setKeepTrouble(o.name, err.Error())
			}
		}
		all := true
		var wait time.Time
		waiting := true
		for _, o := range open {
			if upToDate[o.name] {
				continue
			}
			all = false
			if u := bgBackoffUntil(o.port); !u.IsZero() {
				if wait.IsZero() || u.Before(wait) {
					wait = u
				}
			} else {
				waiting = false
			}
		}
		if all {
			k.allDone = true
			break
		}
		writeKeepLoad()
		invokeCloudPush()
		if waiting && !wait.IsZero() {
			// every company left waits for Tally to be left alone no longer: nothing is sent meanwhile
			if k.light || wait.After(runEnd) {
				why = "Tally is left alone until " + wait.Format("15:04")
				break
			}
			sleepUntil(wait)
			continue
		}
		sleepOrStop(time.Duration(minI(5, keepNum("KeepCycleSec", 5))) * time.Second)
	}
	// what came in goes on to the cloud before this stops (a few minutes at most; Tally is not asked)
	until := time.Now().Add(10 * time.Minute)
	for time.Now().Before(until) && !stopping() {
		if invokeCloudPush() == 0 {
			break
		}
		sleepOrStop(10 * time.Second)
	}
	switch {
	case k.light && k.allDone:
		_ = saveFile(lightFile(), nowS())
		writeLog("Light update: done" + reqs() + "; the bridge is idle again")
	case k.light:
		writeLog("Light update: not done (" + why + ")" + reqs() + "; the next event tries again")
	case !k.allDone:
		_ = saveFile(sp("keep-tried.txt"), nowS())
		if r.kind == "now" {
			_ = os.Remove(sp("keep-now.txt"))
		}
		if why == "" {
			why = "Tally or the company not open"
		}
		writeLog(what + ": not finished (" + why + ")" + reqs())
	default:
		_ = saveFile(sp("keep-lastrun.txt"), today())
		_ = saveFile(lightFile(), nowS())
		_ = os.Remove(sp("keep-now.txt"))
		writeLog(what + ": done" + reqs() + "; the bridge is idle again (next: the nightly catch-up at " + keepDailyAt() + ", or Update now)")
	}
}

func keepRunning() bool {
	kwMu.Lock()
	defer kwMu.Unlock()
	return kwRunning
}

// FinCom's view: each company's copy, and whether the copier is running
func keepStatus(company string) M {
	var st M
	if company != "" {
		st = readKeepState(syncFolder(company))
	}
	g := func(k string) any {
		if st == nil {
			return ""
		}
		return st[k]
	}
	return M{"ok": true, "on": keepOn(), "running": keepRunning(), "load": readJSONFile(sp("keep-load.json")), "cloud": cloudLinkStatus(), "phase": g("phase"), "next": g("next"), "from": g("from"), "at": g("at"),
		"schedule": keepSchedule(), "dailyAt": keepDailyAt(), "lastRun": keepLastRun(), "lightAt": strings.TrimSpace(readText(lightFile())), "now": exists(sp("keep-now.txt")),
		"readAt": g("readAt"), "paused": paused(), "events": true,
		"mode": func() string {
			if company != "" {
				return keepMode(company)
			}
			return ""
		}(), "seeded": st != nil && truthy(st["seeded"]), "openPending": st != nil && truthy(st["openPending"]), "balances": st != nil && truthy(st["balAt"])}
}

// the check: one month of the copy against Tally's own list of entries
func testKeepMonth(company, ym string, pref int) (M, error) {
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	dir := syncFolder(company)
	td := today()
	mf := ym + "01"
	mt := monthEnd(ym)
	if mt > td {
		mt = td
	}
	tl, err := keepList(fin, company, port, mf, mt, 0)
	if err != nil {
		return nil, err
	}
	h := keepHeld(dir, ym)
	missing, differ := 0, 0
	seen := map[string]bool{}
	for _, e := range tl {
		seen[e.guid] = true
		x, ok := h[e.guid]
		if !ok {
			missing++
		} else if x.alter != e.alter {
			differ++
		}
	}
	extra := 0
	for g := range h {
		if !seen[g] {
			extra++
		}
	}
	fixing := false
	if missing+differ+extra > 0 {
		if os.WriteFile(filepath.Join(dir, "recheck.txt"), []byte(ym), 0o644) == nil {
			fixing = true
		}
	}
	d3 := addDays(mf, 2)
	if d3 > mt {
		d3 = mt
	}
	dbx, err := getDayBookXML(fin, company, mf, d3, port)
	if err != nil {
		return nil, err
	}
	dbG := map[string]bool{}
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(dbx, -1) {
		if g := strings.TrimSpace(group(`<GUID>([^<]*)</GUID>`, m, 1)); g != "" {
			dbG[g] = true
		}
	}
	lsG := map[string]bool{}
	for _, e := range tl {
		if e.date <= d3 {
			lsG[e.guid] = true
		}
	}
	same := len(dbG) == len(lsG)
	for g := range dbG {
		if !lsG[g] {
			same = false
		}
	}
	return M{"ok": true, "ym": ym, "tally": len(tl), "copy": len(h), "missing": missing, "differ": differ, "extra": extra, "firstDays": d3, "dayBook": len(dbG), "list": len(lsG), "listMatchesDayBook": same, "fixing": fixing}, nil
}
