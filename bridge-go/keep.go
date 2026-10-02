// Keeping FinCom's copy of each company in step with Tally, as a worker inside the service. 2.1.5 (the owner's rule of
// 02-Oct-2026): each company's baseline is read once (the masters with their stored openings and the day book, a month a
// request, or taken from FinCom's cloud when it holds the books already), then only what changed, by Tally's AlterID
// (changes.go). Tally is never asked for a balance. The copy is kept in the same files as before
// (sync\<company>\days\*.xml...).
package main

import (
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
	st["balAt"], st["localDays"] = nowS(), true
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
	if st != nil && !truthy(st["seeded"]) && str(st["phase"]) == "live" {
		return M{"ok": true, "skipped": "This company is already kept in step; its copy was made before."}, nil
	}
	if st == nil || !truthy(st["seeded"]) {
		// 2.1.5: the day book given in FinCom is the baseline; from here only changes by AlterID (the masters read once,
		// with their stored openings; never a balance)
		st = M{"company": company, "from": from, "next": addDays(today(), 1), "slice": 1, "phase": "live", "lastV": 0, "lastM": 0, "mL": 0, "mG": 0,
			"months": M{}, "skipped": []any{}, "seeded": true, "localDays": exists(filepath.Join(dir, "balances.json"))}
		writeLog("Keeping " + company + " in step: the copy starts from the day book file chosen in FinCom")
	}
	n := saveKeepDays(dir, from, to, x)
	mx := toI64(st["lastV"])
	for _, m := range re(`<ALTERID>\s*(\d+)`).FindAllStringSubmatch(x, -1) {
		if v := toI64(m[1]); v > mx {
			mx = v
		}
	}
	st["lastV"] = mx
	if from < str(st["from"]) {
		st["from"] = from
	}
	td := today()
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
	id       string       // this run (the deletion check resumes within it)
	views    map[string]M // the cloud's view of each company, once a run
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

// an entry FinCom posted and the read-back found: 2.1.5 brings it in with the change read that follows the posting (its
// AlterID is above the last one held), so nothing is kept for it here any more
func addPostedForCopy(company string, head M, xml string) {}

// --- one turn for one open company: at most a few seconds of Tally's time, small requests, each saved as it comes
func (k *keepRun) step(company string, port int, booksFrom string) error {
	keepMu.Lock()
	defer keepMu.Unlock()
	dir := syncFolder(company)
	_ = os.MkdirAll(dir, 0o755)
	td := today()
	st := readKeepState(dir)
	k.caughtUp = false
	budget := time.Duration(keepNum("KeepBudgetSec", 20)) * time.Second
	t0 := time.Now()
	inBudget := func() bool { return time.Since(t0) < budget }
	save := func() {
		st["at"] = nowS()
		saveKeepState(dir, st)
		writeKeepManifest(dir, st, td)
	}
	cv := k.cloudView(company)
	st = k.begin(company, dir, st, booksFrom, cv)
	if st == nil {
		k.caughtUp = true // waiting: nothing to read for it now
		return nil
	}
	_ = os.Remove(filepath.Join(dir, "posted-in.jsonl")) // 2.1.4's note of entries posted: the change read brings them
	// the cloud holds a later AlterID (the day book given to FinCom from Tally's files after this copy was made): from there
	if cv != nil && str(st["phase"]) == "live" && toI64(cv["lastV"]) > toI64(st["lastV"]) {
		st["lastV"] = toI64(cv["lastV"])
	}
	if k.light && str(st["phase"]) != "live" {
		k.caughtUp = true // the baseline is read by Update now or the nightly run, never by a light update
		return nil
	}
	if str(st["phase"]) == "base" {
		err := k.baseStep(company, port, dir, st, td, inBudget)
		save()
		return err
	}
	// "Re-read these", asked in FinCom after the night's check: those days from the day book, the masters again
	if rr := obj(cv["reread"]); rr != nil && !k.light && !k.told["rr:"+company] {
		k.told["rr:"+company] = true
		days := uniqSorted(strs(rr["days"]))
		if len(days) > 0 {
			if _, err := k.updateDates(company, port, dir, st, days); err != nil {
				return err
			}
		}
		if truthy(rr["masters"]) {
			st["mL"], st["mG"] = 0, 0
		}
		writeLog(fmt.Sprintf("Keeping %s: read again as asked in FinCom (Re-read these): %d day(s)%s", company, len(days), map[bool]string{true: " and the masters", false: ""}[truthy(rr["masters"])]))
		queueCloudSync(dir, st, M{"rereadDone": str(rr["at"])})
		save()
	}
	// Tally's own change counters: one tiny request; nothing more when neither moved
	ok, tv, tm, err := keepCounters(k.tc, company, port)
	if err != nil {
		return err
	}
	if !ok {
		tv, tm = 0, 0 // a Tally that does not say them: one change read after the last held, without an upper end
	}
	if ok && (tv < toI64(st["lastV"]) || tm < toI64(st["lastM"])) {
		writeLog(fmt.Sprintf("Keeping %s: Tally's change numbers have gone back (%d < %d; a backup restored?); reading from Tally's numbers on, and the days are checked against Tally's lists", company, tv, toI64(st["lastV"])))
		st["lastV"], st["lastM"], st["dcRun"] = tv, tm, ""
		delete(st, "mL")
		delete(st, "mG")
		queueCloudSync(dir, st, M{"reset": true})
	}
	// masters changed (or asked again)
	if tm > toI64(st["lastM"]) || st["mL"] != nil || (!ok && k.kind != "light") {
		upto := tm
		if !ok {
			upto = toI64(st["lastM"])
		}
		done, err := k.mstChanges(company, port, dir, st, upto, false, inBudget)
		if err != nil {
			return err
		}
		if !done {
			save()
			return nil
		}
	}
	// entries changed: about 200 a request, on to Tally's own last number
	if tv > toI64(st["lastV"]) || !ok {
		done, err := k.vchChanges(company, port, dir, st, tv, inBudget)
		if err != nil {
			return err
		}
		if !done {
			save()
			return nil
		}
	}
	// days whose entries came without their lines: read again from the day book
	if rd := strs(st["redo"]); len(rd) > 0 {
		if _, err := k.updateDates(company, port, dir, st, rd); err != nil {
			return err
		}
		st["redo"] = []any{}
	}
	st["next"] = addDays(td, 1)
	if k.light {
		st["trouble"] = nil
		save()
		k.caughtUp = true
		return nil
	}
	// Update now and the nightly run: deleted entries, by each day's ids and count against the cloud's
	done, err := k.windowCheck(company, port, dir, st, inBudget)
	if err != nil {
		save()
		return err
	}
	if !done {
		save()
		return nil
	}
	// the night's totals check, only when switched on (off by default: Tally works out every ledger for it)
	if k.kind == "nightly" && cfgB("NightlyTotals") && !k.told["tot:"+company] {
		k.told["tot:"+company] = true
		if err := k.nightTotals(company, port, dir, st); err != nil {
			save()
			return err
		}
	}
	st["trouble"] = nil
	save()
	k.caughtUp = true
	return nil
}

// the copy's state at the start of a run: a 2.1.4 copy carried on, the cloud's baseline taken, or a baseline begun
func (k *keepRun) begin(company, dir string, st M, booksFrom string, cv M) M {
	if st != nil && str(st["phase"]) == "live" {
		if st["lastV"] == nil { // a copy made by 2.1.4: its numbers carried on, its openings never read again
			st["lastV"] = toI64(st["last"])
			st["localDays"] = exists(filepath.Join(dir, "balances.json")) && !truthy(st["openPending"])
			delete(st, "openPending")
			delete(st, "openIdx")
			delete(st, "openSize")
			delete(st, "verify")
			saveKeepState(dir, st)
		}
		return st
	}
	if st != nil && str(st["phase"]) == "base" {
		return st
	}
	// FinCom's cloud holds the books already (given from Tally's files, or sent before): that is the baseline
	if cloudHasBaseline(cv) {
		n := M{"company": company, "from": str(cv["from"]), "next": addDays(today(), 1), "phase": "live", "lastV": toI64(cv["lastV"]), "lastM": 0,
			"mL": 0, "mG": 0, "localDays": false, "months": M{}, "skipped": []any{}, "slice": 1, "fromCloud": true}
		if cv["lastM"] != nil {
			n["lastM"] = toI64(cv["lastM"])
			delete(n, "mL")
			delete(n, "mG")
		}
		saveKeepState(dir, n)
		writeLog(fmt.Sprintf("Keeping %s in step: FinCom's cloud holds its books from %s (entries to AlterID %d); only what changed in Tally since is read", company, str(cv["from"]), toI64(cv["lastV"])))
		return n
	}
	// a baseline: from the day the books begin in Tally (the ledger masters' stored openings are as on the day before)
	from := ""
	if isTallyDate(booksFrom) {
		from = booksFrom
	} else if v := cfgS("KeepFrom"); isTallyDate(v) {
		from = v
	} else {
		from = tallyDate(fyStart(time.Now()))
	}
	if b := obj(cv["base"]); b != nil && str(b["phase"]) == "base" && str(b["from"]) == from && isTallyDate(str(b["next"])) {
		// a baseline begun before (this computer's copy lost): its days are in the cloud up to where it stopped
		n := M{"company": company, "from": from, "next": str(b["next"]), "phase": "base", "slice": 31, "lastV": 0, "lastM": 0, "localDays": false, "months": M{}, "skipped": []any{}}
		saveKeepState(dir, n)
		writeLog("Keeping " + company + " in step: the baseline goes on from " + str(b["next"]) + " (kept in FinCom's cloud)")
		return n
	}
	n := M{"company": company, "from": from, "next": from, "phase": "base", "slice": 31, "lastV": 0, "lastM": 0, "localDays": true, "months": M{}, "skipped": []any{}, "dayFail": 0}
	if st != nil && toInt(st["slice"]) > 0 && str(st["from"]) == from && isTallyDate(str(st["next"])) && str(st["phase"]) == "first" {
		n["next"] = st["next"] // 2.1.4's first copy from the same day: its days are kept
	}
	saveKeepState(dir, n)
	writeLog("Keeping " + company + " in step: baseline from " + from + " (the day the books begin in Tally): the masters with their stored openings, then the day book a month a request")
	return n
}

// the baseline, a turn at a time: the counters noted at its start, the masters, then the day book a slice (a month,
// smaller after a slice that did not answer) at a time, each saved; it goes on from the last slice saved
func (k *keepRun) baseStep(company string, port int, dir string, st M, td string, inBudget func() bool) error {
	if st["base0V"] == nil {
		ok, cv, cm, err := keepCounters(k.tc, company, port)
		if err != nil {
			return err
		}
		if !ok {
			cv, cm = 0, 0
		}
		st["base0V"], st["base0M"] = cv, cm
		saveKeepState(dir, st)
	}
	if !truthy(st["baseMasters"]) {
		done, err := k.mstChanges(company, port, dir, st, toI64(st["base0M"]), true, inBudget)
		if err != nil || !done {
			return err
		}
		st["baseMasters"] = true
		saveKeepState(dir, st)
	}
	maxSeen := toI64(st["baseMaxV"])
	for str(st["next"]) <= td && inBudget() && keepHold() == "" {
		f := str(st["next"])
		sl := maxI(1, minI(31, toInt(st["slice"])))
		t := addDays(f, sl-1)
		if e := monthEnd(f[:6]); t > e {
			t = e // a slice never crosses a month's end
		}
		if t > td {
			t = td
		}
		t1 := time.Now()
		x, err := getDayBookXML(k.tc, company, f, t, port)
		if err != nil {
			if gaveWay(err) {
				return err
			}
			if sl > 1 {
				st["slice"] = maxI(1, sl/2)
				saveKeepState(dir, st)
				return fmt.Errorf("Tally did not give %s-%s (%s); the next try reads %d day(s) from %s", f, t, err.Error(), toInt(st["slice"]), f)
			}
			st["dayFail"] = toInt(st["dayFail"]) + 1
			if toInt(st["dayFail"]) >= 3 {
				addKeepSkipped(st, f)
				st["next"], st["dayFail"] = addDays(f, 1), 0
				saveKeepState(dir, st)
				return fmt.Errorf("Tally could not give %s after 3 tries (%s); going on from the next day, that day tried again later", f, err.Error())
			}
			saveKeepState(dir, st)
			return fmt.Errorf("Tally did not give %s (%s); try %d of 3", f, err.Error(), toInt(st["dayFail"]))
		}
		sec := time.Since(t1).Seconds()
		n := saveKeepDays(dir, f, t, x)
		for _, m := range re(`<ALTERID>\s*(\d+)`).FindAllStringSubmatch(x, -1) {
			if v := toI64(m[1]); v > maxSeen {
				maxSeen = v
			}
		}
		writeKeepMonth(dir, f[:6], st)
		st["next"], st["dayFail"], st["baseMaxV"] = addDays(t, 1), 0, maxSeen
		if aim := keepTargetSec(); sec < aim/3 && sl < 31 {
			st["slice"] = minI(31, sl*2)
		} else if sec > aim && sl > 1 {
			st["slice"] = maxI(1, sl/2)
		}
		st["at"] = nowS()
		saveKeepState(dir, st)
		queueCloudSync(dir, st, M{"base": M{"phase": "base", "from": st["from"], "next": st["next"]}})
		writeLog(fmt.Sprintf("Keeping %s: baseline %s-%s, %d entries (%.1fs); saved", company, f, t, n, sec))
		keepRest(time.Duration(math.Max(1000, sec*1500)) * time.Millisecond)
	}
	if str(st["next"]) <= td {
		return nil
	}
	// done: from here only changes. The entries changed while the baseline was read are read again by AlterID
	lastV := toI64(st["base0V"])
	if lastV <= 0 {
		lastV = maxSeen
	}
	st["phase"], st["lastV"], st["lastM"] = "live", lastV, toI64(st["base0M"])
	for _, f := range []string{"base0V", "base0M", "baseMasters", "baseMaxV", "dayFail"} {
		delete(st, f)
	}
	queueCloudSync(dir, st, M{"base": M{"phase": "live", "from": st["from"], "next": st["next"]}})
	writeLog(fmt.Sprintf("Keeping %s: baseline done (from %s); from now on only what changed in Tally (AlterID above %d)", company, str(st["from"]), lastV))
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
	k := &keepRun{tc: &TC{copier: true, readSec: keepNum("KeepReadSec", 120)}, kind: r.kind, only: r.only, light: r.kind == "light", force: r.kind == "now", once: true, told: map[string]bool{},
		id: fmt.Sprint(time.Now().UnixNano()), views: map[string]M{}}
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
					bf := str(c["booksFrom"])
					if !isTallyDate(bf) {
						bf = str(c["from"])
					}
					open = append(open, oc{n, toInt(s["port"]), bf})
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
			// Update now (a person waiting) is not held to the background share of Tally's time
			if upToDate[o.name] || !bgBackoffUntil(o.port).IsZero() || (r.kind != "now" && !keepRoom(o.port)) || userWaiting(o.port) {
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
