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
	"regexp"
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

// the folder of a company's copy, inside the sync folder; an error for a name that cannot be a folder there (safeName)
func companyDir(company string) (string, error) {
	n, err := safeName(company)
	if err != nil {
		return "", err
	}
	return filepath.Join(syncDir(), n), nil
}

// a company's kept state; nil when there is none, or when its name cannot be a folder here
func keepStateOf(company string) M {
	dir, err := companyDir(company)
	if err != nil {
		return nil
	}
	return readKeepState(dir)
}
func sp(name string) string { return filepath.Join(syncDir(), name) }

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
	if st := readStop(); st != nil {
		return "reading from Tally is stopped on this computer (" + str(st["reason"]) + ")"
	}
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

// the entries of a period, as numbers only: [guid, change number, date]; 'after' asks only for those changed since
type kentry struct {
	guid  string
	alter int64
	date  string
}

// round 18: whether the Day Book rounds read old days at all (the owner's rule of 04-Oct-2026: off). Only the settings
// file on this computer sets it (applyCloudSettings never does)
func readDaysOn() bool { return cfgB("ReadDays") }

// round 18 (the owner's decision of 04-Oct-2026): FinCom's direct reads of entries (/daybook, /vouchers, /keepcheck)
// are refused with these words while ReadDays is off; nothing is sent to Tally
const readsOffWords = "Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload)."

func readsOffErr() error {
	if readDaysOn() {
		return nil
	}
	return &httpErr{409, M{"ok": false, "error": readsOffWords, "readDays": false}}
}

// round 18 (the read test and the measuring tool; 2.2.0 also the recorder's source B): the entries above an AlterID
// with NO period at all (no SVFROMDATE/SVTODATE), as GUID, MasterID, AlterID and date; the same collection as the
// copy's check
// 2.2.0: MASTERID is fetched too (the recorder's source B turns each entry into a created or altered change by it, and
// the body fetch asks Tally by it); still undated, the AlterID filter only
func keepListAboveRequest(company string, after int64) string {
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepList</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"</STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepList" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID,MASTERID,ALTERID,DATE</FETCH><FILTERS>TDSDeskKeepNew</FILTERS></COLLECTION>` +
		fmt.Sprintf(`<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepNew">$AlterID &gt; %d</SYSTEM>`, after) +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

func keepListRequest(company, from, to string, after int64) string {
	flt, sys := "", ""
	if after > 0 {
		flt = "<FILTERS>TDSDeskKeepNew</FILTERS>"
		sys = fmt.Sprintf(`<SYSTEM TYPE="Formulae" NAME="TDSDeskKeepNew">$AlterID &gt; %d</SYSTEM>`, after)
	}
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskKeepList</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		periodVars(from, to) + "</STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskKeepList" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID,ALTERID,DATE</FETCH>` + flt + "</COLLECTION>" + sys +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

func keepList(tc *TC, company string, port int, from, to string, after int64) ([]kentry, error) {
	raw, err := invokeTally(tc, port, keepListRequest(company, from, to, after), 120)
	if err != nil {
		return nil, err
	}
	var out []kentry
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		g := strings.TrimSpace(tagRaw(m, "GUID"))
		a := tagNum(m, "ALTERID")
		d := tagDate(m, "DATE")
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
// (a stretch that is not a full read of Tally: the seed file chosen in FinCom; no day of it is marked as read in full)
func saveKeepDays(dir, from, to, x string) int {
	n, _ := saveKeepDaysChanged(dir, from, to, x, false)
	return n
}

// the same, and how many days changed: only a day whose text differs from the copy's is written again and goes to the
// cloud (an Update now that reads the year again sends only what changed, deleted entries included)
func saveKeepDaysChanged(dir, from, to, x string, full bool) (int, int) {
	by := map[string]*strings.Builder{}
	for _, m := range reVchBlock.FindAllString(x, -1) {
		d := tagDate(m, "DATE")
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
		df := filepath.Join(days, d+".xml")
		if exists(df) && readText(df) == t {
			if full && !exists(dayFullMark(dir, d)) {
				_ = saveFile(dayFullMark(dir, d), nowS()) // unchanged, and now known to be read in full
			}
			continue
		}
		writeDayFile(dir, d, t, full)
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
	return n, len(written)
}

// the vouchers a text shows: their opening tags (a voucher cut short counts; CMPINFO's counter <VOUCHER>n</VOUCHER> does not)
func countVouchers(t string) int { return len(reVchOpen.FindAllStringIndex(t, -1)) }

// round 12 (03-Oct-2026): how many vouchers the copy holds for the days from..to (the day files, days/<d>.xml; the
// posting read-back writes those too)
func copyVouchers(dir, from, to string) int {
	n := 0
	for d := from; d <= to; d = addDays(d, 1) {
		if df := filepath.Join(dir, "days", d+".xml"); exists(df) {
			n += countVouchers(readText(df))
		}
	}
	return n
}

// the same over every day file of the copy
func copyVouchersAll(dir string) int {
	n := 0
	for _, df := range dayFiles(dir, "") {
		n += countVouchers(readText(df))
	}
	return n
}

// the head of a Tally answer for the log: its first 200 characters with the tags only (attributes and every value
// between tags dropped, so no figure or name is logged) and runs of white space collapsed to one space
func answerHead(x string) string {
	t := re(`<([/?!]?[\w.:-]*)[^>]*>`).ReplaceAllString(x, "<$1>")
	t = re(`>[^<]*<`).ReplaceAllString(t, "><")
	if i := strings.Index(t, "<"); i >= 0 {
		t = t[i:]
	} else {
		return ""
	}
	if i := strings.LastIndex(t, ">"); i >= 0 {
		t = t[:i+1]
	}
	return cut(strings.TrimSpace(flat(t)), 200)
}

// why a Day Book answer is not a complete one ("" when it is): Tally's whole envelope, opened and closed; no error
// line; and every voucher the text shows is one the XML decoder read (a decoder stop would drop the rest)
func dayBookIncomplete(x string) string {
	t := strings.TrimSpace(x)
	if !re(`(?i)<ENVELOPE[\s>]`).MatchString(t) {
		return "not a Tally envelope"
	}
	if !re(`(?i)</ENVELOPE>\s*$`).MatchString(t) {
		return "the envelope is not closed: the answer stopped part-way"
	}
	if re(`(?i)<LINEERROR[\s>]`).MatchString(t) {
		return "Tally: " + cut(flat(group(`(?i)<LINEERROR(?:\s[^>]*)?>([\s\S]*?)</LINEERROR>`, t, 1)), 160)
	}
	if a, b := countVouchers(t), len(vchNodes(xmlDoc(t))); a != b {
		return fmt.Sprintf("the text shows %d vouchers but %d could be decoded", a, b)
	}
	return ""
}

// the mark of a day read in full (round 10): only with it may an empty day go to the cloud as empty:true
func dayFullMark(dir, d string) string { return filepath.Join(dir, "days", d+".full") }

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
	dir, err := companyDir(company)
	if err != nil {
		return nil, err
	}
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
	st["balAt"] = nowS()
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
	dir, err := companyDir(company)
	if err != nil {
		return nil, err
	}
	_ = os.MkdirAll(dir, 0o755)
	st := readKeepState(dir)
	if st != nil && !truthy(st["seeded"]) && str(st["phase"]) == "live" {
		return M{"ok": true, "skipped": "This company is already kept in step; its copy was made before."}, nil
	}
	if st == nil || !truthy(st["seeded"]) {
		// the day book given in FinCom is the copy; Update now reads the same period again, a month a request
		st = M{"company": company, "from": from, "next": addDays(today(), 1), "slice": 31, "phase": "live", "months": M{}, "skipped": []any{}, "seeded": true}
		writeLog("Keeping " + company + " in step: the copy starts from the day book file chosen in FinCom")
	}
	n := saveKeepDays(dir, from, to, x)
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
	for _, m := range reVchBlock.FindAllString(t, -1) {
		g := strings.TrimSpace(tagRaw(m, "GUID"))
		a := tagNum(m, "ALTERID")
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
	kind     string   // light (a client opened in FinCom, or after a posting), now (Update now), nightly, ledgers (the ledger list only)
	only     []string // these companies only (none: every company open in Tally)
	caughtUp bool
	light    bool
	force    bool
	once     bool
	allDone  bool
	told     map[string]bool
	id       string           // this run (a round of slices resumes within it)
	alter    map[string]int64 // each company's highest AlterID, as its check said (for the rewind guard)
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
				// the field as Tally writes it, with or without its TYPE attribute (real TallyPrime 7.1)
				r := re(`(` + tagOpenRe(tag) + `)` + regexp.QuoteMeta(o) + `(</` + tag + `\s*>)`)
				t2 = r.ReplaceAllStringFunc(t2, func(m string) string { sm := r.FindStringSubmatch(m); return sm[1] + nn + sm[2] })
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

// an entry FinCom posted and the read-back found (with its GUID and change number): noted for the copier, which puts it
// into the copy and sends its day to the cloud without reading the day from Tally
func addPostedForCopy(company string, head M, xml string) {
	g, a, d := str(head["guid"]), strings.TrimSpace(str(head["alter"])), str(head["date"])
	if g == "" || !re(`^\d+$`).MatchString(a) || !isTallyDate(d) || xml == "" {
		return
	}
	dir, err := companyDir(company)
	if err != nil || !exists(filepath.Join(dir, "keep.json")) {
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
		rest = re(tagRe("GUID")).ReplaceAllString(rest, "")
		rest = re(tagRe("ALTERID")).ReplaceAllString(rest, "")
		rest = re(tagRe("VOUCHERNUMBER")).ReplaceAllString(rest, "")
		if loc := re(tagRe("DATE")).FindStringIndex(rest); loc != nil {
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
			writeDayFile(dir, day, t2, false) // not a read: the day's full-read mark goes
			_ = saveFile(strings.TrimSuffix(df, ".xml")+".idx", indexText(t2))
			touched[day] = true
		}
		whereMu.Lock()
		where[str(e["guid"])] = str(e["date"])
		whereMu.Unlock()
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

// --- one turn for one open company. 2.1.4 as rebuilt on 02-Oct-2026 (the owner's re-scope): until the change read is
// measured, the books come from the Master.xml / DayBook.xml given to FinCom, and from Update now (and the nightly run):
// the day book of the copy's period, a month a request (a slice that does not answer is halved, down to a day), each
// slice saved as it comes, so a stop resumes from the last slice saved. Nothing else is read: no balance, no list of
// changes. A light update (a client opened, a posting) asks Tally nothing: the entries just posted go into the copy and
// to the cloud from what the posting read back
func (k *keepRun) step(company string, port int, booksFrom string) error {
	keepMu.Lock()
	defer keepMu.Unlock()
	dir, err := companyDir(company)
	if err != nil {
		return err
	}
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
	if k.light {
		// nothing is asked of Tally: only the entries just posted (read back by the posting) go into the copy
		if st != nil {
			if pn := useKeepPosted(dir, st); pn > 0 {
				writeLog(fmt.Sprintf("Keeping %s: %d entries posted from FinCom put in the copy and sent to the cloud (Tally not read)", company, pn))
				save()
			}
		}
		k.caughtUp = true
		return nil
	}
	if k.kind == "ledgers" {
		// the ledger list only (after a posting with a ledger master, or the ledger chooser in FinCom): a company not kept
		// here has nothing to compare with; the entries just posted go into the copy first (Tally not read for them)
		if st == nil {
			k.caughtUp = true
			return nil
		}
		if pn := useKeepPosted(dir, st); pn > 0 {
			writeLog(fmt.Sprintf("Keeping %s: %d entries posted from FinCom put in the copy and sent to the cloud (Tally not read)", company, pn))
			save()
		}
	}
	if st == nil {
		from := tallyDate(fyStart(time.Now()))
		if v := cfgS("KeepFrom"); isTallyDate(v) {
			from = v
		}
		if isTallyDate(booksFrom) && booksFrom > from {
			from = booksFrom
		}
		st = M{"company": company, "from": from, "next": from, "slice": 31, "phase": "live", "months": M{}, "skipped": []any{}}
		writeLog("Keeping " + company + " in step: its day book from " + from + " is read at Update now (and the nightly run), a month a request")
	}
	// what 2.1.3 left for balances (read a batch of ledgers at a time) is never read again: no balance is asked of Tally
	for _, f := range []string{"openPending", "openIdx", "openSize", "balMode"} {
		delete(st, f)
	}
	if str(st["phase"]) != "live" {
		st["phase"] = "live"
	}
	// only one bridge reads or posts a company at a time (a lease held in FinCom's cloud)
	if ok, who := leaseTake(company); !ok {
		if !k.told["lease:"+company] {
			k.told["lease:"+company] = true
			writeLog("Keeping " + company + ": another FinCom Bridge (" + who + ") is reading or posting this company now; this one gives way")
		}
		k.caughtUp = true
		return nil
	}
	// the company's GUID: the one held for it, or nothing is read (a restored or re-created company, another company of
	// the same name). Round 4 (03-Oct-2026): the check is made once per ROUND (k.id), not once per keeper, so the rewind
	// guard sent at the round's end carries the company's highest AlterID as of this round, never a stale one
	if ck := "check:" + company + ":" + k.id; !k.told[ck] {
		g, err := companyCheck(k.tc, company, port)
		if err != nil {
			return err
		}
		if err := guardCompanyGUID(company, g); err != nil {
			k.told[ck], k.told["guid:"+company] = true, true
			st["trouble"] = M{"at": nowS(), "why": err.Error()}
			save()
			writeLog("Keeping " + company + ": nothing read: " + err.Error())
			k.caughtUp = true
			return nil
		}
		k.told[ck], k.told["guid:"+company] = true, true
		st["guid"] = g
		k.alter[company] = companyAlter(company)
	}
	// 2.1.4 (02-Oct-2026): the plain ledger and group lists (ledgers.go), in chunks, before the day book
	done, err := k.ledgerList(company, port, dir, st, inBudget, save)
	if err != nil {
		return err
	}
	if !done {
		save()
		return nil // the time of this turn is up: the next turn goes on from the last chunk saved
	}
	if k.kind == "ledgers" {
		k.caughtUp = true
		return nil
	}
	// round 18 (the owner's rule of 04-Oct-2026): reading is prospective only. The bridge never reads earlier entries
	// from Tally in normal running (reading old months is what risks hanging Tally): with ReadDays off (the default; it
	// is never set from the cloud) the round is the company check (FinComCompany) and the ledger list above, and no day
	// is read or sent. FY 2026-27's history comes from the owner's Day Book upload
	if !readDaysOn() {
		if nk := "nodays:" + company + ":" + k.id; !k.told[nk] {
			k.told[nk] = true
			writeLog(fmt.Sprintf("Keeping %s: Reading old entries is off (prospective only); FinComCompany ALTVCHID=%d ALTMSTID=%d", company, companyAlter(company), companyAlterM(company)))
		}
		save()
		k.caughtUp = true
		return nil
	}
	// a round of the copy's period, a slice at a time; a new round each run, resumed within the run
	if str(st["round"]) != k.id {
		st["round"], st["roundNext"], st["roundDays"], st["roundN"] = k.id, str(st["from"]), 0, 0
		if toInt(st["slice"]) <= 0 {
			st["slice"] = 31
		}
		save()
	}
	for str(st["roundNext"]) <= td && inBudget() && keepHold() == "" {
		f := str(st["roundNext"])
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
		// round 10 (03-Oct-2026): a day counts as read only when its answer came in full. An answer that is not a whole
		// Tally envelope (the connection dropped, the decoder stopped), or one taken while the self-watch stopped reading,
		// is thrown away like a timeout: nothing of it is kept, no day of it goes to the cloud, the slice is read again.
		// Only then can an empty day be told from a failed read (an empty day read in full goes as empty:true)
		if err == nil {
			if why := dayBookIncomplete(x); why != "" {
				writeLog(fmt.Sprintf("Keeping %s: day book %s-%s: the answer was not complete (%s); nothing of it is kept, it is read again", company, f, t, why))
				err = errors.New("the answer was not complete: " + why)
			} else if cn := copyVouchers(dir, f, t); countVouchers(x) == 0 && cn > 0 {
				// round 12 (03-Oct-2026): a whole envelope that lists NO voucher for days whose copy holds some is not
				// trusted (Tally answered the owner's Day Book request so for every month of a company of ~2,750
				// entries): it fails like a timeout, nothing of it is kept, no day of it is marked full or sent as empty.
				// Round 13b: a day whose every entry was really removed in Tally (a posted test entry deleted later) must
				// not be distrusted for ever: on the third try of a one-day slice Tally is asked once more with a
				// different request kind, FinComTag (the posting read-back's collection); when that lists none either,
				// the empty day is trusted and goes the normal way (written empty, marked full, sent as empty:true)
				more := ""
				if f == t && toInt(st["dayFail"]) >= 2 {
					if raw, e := invokeTally(k.tc, port, tagCheckRequest(company, f), 60); e != nil || !goodDupAnswer(raw) {
						more = "; the entry list did not answer"
					} else if ln := len(xmlDoc(raw).All("VOUCHER")); ln > 0 {
						more = fmt.Sprintf("; the entry list (FinComTag) lists %d", ln)
					} else {
						writeLog(fmt.Sprintf("Keeping %s: day book %s: Tally listed no entries three times and its entry list (FinComTag) lists none either; the day is taken as empty", company, f))
						more = "ok"
					}
				}
				if more != "ok" {
					writeLog(fmt.Sprintf("Keeping %s: day book %s-%s: Tally listed no entries but the copy holds %d for these days; the answer is not trusted (%s); nothing kept, it is read again%s", company, f, t, cn, answerHead(x), more))
					err = fmt.Errorf("Tally listed no entries but the copy holds %d for these days; the answer is not trusted", cn)
				}
			} else if st := readStop(); st != nil {
				writeLog(fmt.Sprintf("Keeping %s: day book %s-%s: reading was stopped on this computer while it was read (%s); nothing of it is kept", company, f, t, str(st["reason"])))
				err = errors.New("reading stopped: " + str(st["reason"]))
			}
		}
		if err != nil {
			if gaveWay(err) {
				return err // the same slice again when Tally is free
			}
			if sl > 1 {
				st["slice"] = maxI(1, sl/2)
				save()
				return fmt.Errorf("Tally did not give %s-%s (%s); the next try reads %d day(s) from %s", f, t, err.Error(), toInt(st["slice"]), f)
			}
			st["dayFail"] = toInt(st["dayFail"]) + 1
			if toInt(st["dayFail"]) >= 3 {
				addKeepSkipped(st, f)
				st["roundNext"], st["dayFail"] = addDays(f, 1), 0
				save()
				return fmt.Errorf("Tally could not give %s after 3 tries (%s); going on from the next day, that day tried again at the next Update now", f, err.Error())
			}
			save()
			return fmt.Errorf("Tally did not give %s (%s); try %d of 3", f, err.Error(), toInt(st["dayFail"]))
		}
		sec := time.Since(t1).Seconds()
		n, changed := saveKeepDaysChanged(dir, f, t, x, true) // a full answer (checked above): the days are marked read in full
		var left []string
		for _, s := range strs(st["skipped"]) {
			if s < f || s > t {
				left = append(left, s)
			}
		}
		st["skipped"] = toAny(left)
		writeKeepMonth(dir, f[:6], st)
		st["roundNext"], st["dayFail"] = addDays(t, 1), 0
		st["roundDays"], st["roundN"] = toInt(st["roundDays"])+changed, toInt(st["roundN"])+n
		if aim := keepTargetSec(); sec < aim/3 && sl < 31 {
			st["slice"] = minI(31, sl*2)
		} else if sec > aim && sl > 1 {
			st["slice"] = maxI(1, sl/2)
		}
		save()
		writeLog(fmt.Sprintf("Keeping %s: day book %s-%s, %d entries (%.1fs), %d day(s) changed; saved", company, f, t, n, sec, changed))
		keepRest(time.Duration(math.Max(500, sec*1000)) * time.Millisecond)
	}
	if str(st["roundNext"]) <= td {
		save()
		return nil
	}
	st["next"], st["roundAt"], st["trouble"] = addDays(td, 1), nowS(), nil
	save()
	writeLog(fmt.Sprintf("Keeping %s: the day book from %s to %s read (%d entries); %d day(s) changed since the last read", company, str(st["from"]), td, toInt(st["roundN"]), toInt(st["roundDays"])))
	// round 12 (03-Oct-2026): a round that read 0 entries while the copy holds some is a read fault, not a read: the
	// read guard is not sent (a count of 0 would be recorded in the cloud as a real read) and the trouble is noted
	if toInt(st["roundN"]) == 0 {
		if cn := copyVouchersAll(dir); cn > 0 {
			why := fmt.Sprintf("the round read 0 entries but the copy holds %d: a read fault; nothing was sent as empty and the read guard is not sent", cn)
			writeLog("Keeping " + company + ": " + why)
			st["trouble"] = M{"at": nowS(), "why": why}
			save()
			k.caughtUp = true
			return nil
		}
	}
	// the rewind guard: the company's GUID, its highest AlterID (the latest company check's, this round's or a later
	// one's; null when none is known) and the entries read, to FinCom's cloud
	sendReadGuard(company, str(st["guid"]), companyAlter(company), toInt(st["roundN"]))
	k.caughtUp = true
	return nil
}

// a turn that went wrong: noted for FinCom to show
func setKeepTrouble(company, why string) {
	dir, err := companyDir(company)
	if err != nil {
		return
	}
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
	kind string   // light | now | nightly | ledgers
	only []string // these companies only; none: every company open in Tally
	why  string   // for the log
}

func runRank(kind string) int {
	return map[string]int{"light": 1, "ledgers": 2, "nightly": 3, "now": 4}[kind]
}

// a run starts now, or (one is going) follows it; a light update of a company a fuller run is reading anyway is dropped
func startKeepRun(r runReq) bool {
	if !keepOn() {
		return false
	}
	if readStopped() {
		return false // reading is stopped on this computer (selfwatch.go): no run starts
	}
	kwMu.Lock()
	defer kwMu.Unlock()
	if kwRunning {
		if cur := kwRun; r.kind == "light" && cur != nil && (cur.kind == "now" || cur.kind == "nightly") {
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
	dir, err := companyDir(company)
	if err != nil {
		return
	}
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
		id: fmt.Sprint(time.Now().UnixNano()), alter: map[string]int64{}}
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
	what := map[string]string{"light": "Light update", "now": "Update from Tally", "nightly": "Nightly catch-up", "ledgers": "Ledger list"}[r.kind]
	switch r.kind {
	case "ledgers":
		writeLog("Ledger list of " + strings.Join(r.only, ", ") + " (" + r.why + "): the plain ledger and group lists read from Tally, nothing else")
	case "light":
		writeLog("Light update of " + strings.Join(r.only, ", ") + " (" + r.why + "): the entries just posted into the copy; Tally is not read (Update now reads it)")
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
		if st := readStop(); st != nil {
			why = "reading from Tally is stopped on this computer (" + str(st["reason"]) + ")"
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
		if !asked && k.light {
			// a light update asks Tally nothing (not even which companies are open): only the copy is brought up to date
			for _, c := range r.only {
				if keepStateOf(c) != nil {
					open = append(open, oc{c, 0, ""})
				}
			}
			asked = true
			if len(open) == 0 {
				why = "nothing kept for it here"
				break
			}
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
			if k.light {
				if err := k.step(o.name, 0, ""); err == nil {
					upToDate[o.name] = true
				}
				continue
			}
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
	for _, c := range leasesHeld() {
		leaseRelease(c)
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
	case r.kind == "ledgers" && k.allDone:
		writeLog("Ledger list: done" + reqs() + "; the bridge is idle again")
	case r.kind == "ledgers":
		if why == "" {
			why = "Tally or the company not open"
		}
		writeLog("Ledger list: not finished (" + why + ")" + reqs() + "; the next event tries again")
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
		st = keepStateOf(company)
	}
	g := func(k string) any {
		if st == nil {
			return ""
		}
		return st[k]
	}
	return M{"ok": true, "on": keepOn(), "running": keepRunning(), "load": readJSONFile(sp("keep-load.json")), "cloud": cloudLinkStatus(), "phase": g("phase"), "next": g("next"), "from": g("from"), "at": g("at"),
		"schedule": keepSchedule(), "dailyAt": keepDailyAt(), "lastRun": keepLastRun(), "lightAt": strings.TrimSpace(readText(lightFile())), "now": exists(sp("keep-now.txt")),
		"readAt": g("readAt"), "paused": paused(), "events": true, "ledgersAt": g("ledAt"),
		"mode": func() string {
			if company != "" {
				return keepMode(company)
			}
			return ""
		}(), "seeded": st != nil && truthy(st["seeded"]), "openPending": st != nil && truthy(st["openPending"]), "balances": st != nil && truthy(st["balAt"])}
}

// the check: one month of the copy against Tally's own list of entries
func testKeepMonth(company, ym string, pref int) (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	dir, err := companyDir(company)
	if err != nil {
		return nil, err
	}
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
	for _, m := range reVchBlock.FindAllString(dbx, -1) {
		if g := strings.TrimSpace(tagRaw(m, "GUID")); g != "" {
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

// a day's file of the copy (round 11 review, items 3 and 4): written by a full read of Tally (full: the day's mark is
// set, so an empty day may go to the cloud as empty:true) or by anything else, a seed file or a posting's read-back
// (the mark goes: an emptied day is then sent as readFailed, never as empty)
func writeDayFile(dir, d, text string, full bool) {
	_ = saveFile(filepath.Join(dir, "days", d+".xml"), text)
	m := dayFullMark(dir, d)
	if full {
		if !exists(m) {
			_ = saveFile(m, nowS())
		}
		return
	}
	_ = os.Remove(m)
}
