package main

// Round 21 (FinCom Bridge 2.1.10, the plan's ROUND 19 of 04-Oct-2026, evening):
//   A. the missing starting point: the light FinComCompany check runs while background reading is paused; only a
//      posting actually going (not an interrupted or waiting job) holds it back; the company list is asked afresh
//      (the light company-list request) when it is older than 10 minutes; one log line per check; the heartbeat lists
//      every open company with its GUID and change numbers (the shape is written to tests/fixtures/beat-2.1.10.json for
//      the cloud's own test); FinCom's answer switches the trial tools on or off for this computer;
//   B. the trial tools for any company: no company-name check; owner only (FinCom's switch); a yes/no naming the
//      company; TRIAL in every narration and ledger the trial makes.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

const gsc = "GARG SHEKHAR & COMPANY"

// the trial tools switched on for this computer (FinCom's Tally page, the owner) for one test
func trialOn(t *testing.T) {
	t.Helper()
	setTrialTools(true)
	t.Cleanup(func() { setTrialTools(false) })
}

func r21Count(ids []string, id string) int {
	n := 0
	for _, x := range ids {
		if x == id {
			n++
		}
	}
	return n
}

func r21Stand(t *testing.T, extra string) *standTally {
	f := newStandTally(t)
	f.coName = gsc
	standBridge(t, f, extra)
	return f
}

// --- A1: paused (as NWS144 has been since 03-Oct), nothing asked of Tally yet: the light check asks the company list
// (the light request) and then FinComCompany, and records the starting point
func TestLightCheckRunsWhilePaused(t *testing.T) {
	td := today()
	f := r21Stand(t, "")
	f.add(td, fgParty, "P-1", "sale", "-1.00")
	f.add(td, fgParty, "P-2", "sale", "-2.00")
	setPaused(true)
	t.Cleanup(func() { setPaused(false) })
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	n0 := f.n("")
	lightCheckOpen(openCompaniesCached())
	got := f.ids()[n0:]
	if len(got) == 0 || got[0] != "TDSDeskCompanies" || got[len(got)-1] != "FinComCompany" {
		t.Fatalf("paused, nothing asked yet: %v (want the company list, then FinComCompany)", got)
	}
	for _, id := range got {
		if id != "TDSDeskCompanies" && id != "TDSDeskCompanyInfo" && id != "FinComCompany" {
			t.Fatalf("another request went: %v", got)
		}
	}
	if v, ok := startPointOf(gsc); !ok || v != 2 {
		t.Fatalf("the starting point while paused: %d %v", v, ok)
	}
	if logLines("Light check of "+gsc+": starting point recorded (ALTVCHID=2, ALTMSTID=3)") != 1 {
		t.Fatalf("the check's log line: %s", readText(logFile()))
	}
	// a FinCom stop still stops it, and says so
	setCfg("ReadStop", M{"by": "fincom", "reason": "stopped in FinCom", "at": nowS()})
	n1 := f.n("")
	nowFn = func() time.Time { return time.Now().Add(11 * time.Minute) }
	lightCheckOpen(openCompaniesCached())
	nowFn = time.Now
	if got := f.ids()[n1:]; len(got) != 0 {
		t.Fatalf("reading stopped from FinCom, yet %v went", got)
	}
	if logLines("Light check of "+gsc+": skipped: reading is stopped") != 1 {
		t.Fatalf("the skip is not in the log: %s", readText(logFile()))
	}
	setCfg("ReadStop", nil)
}

// --- A2: an interrupted job (the bridge restarted mid-posting) or a job waiting for Tally does not hold the light
// check back; a posting actually going does
func TestLightCheckNotBlockedByInterruptedJob(t *testing.T) {
	f := r21Stand(t, "")
	sessions := openCompaniesWith(fin, true)
	mk := func(id, status string, alive bool) {
		d := filepath.Join(jobsDir(), id)
		_ = os.MkdirAll(d, 0o755)
		_ = saveFile(filepath.Join(d, "progress.json"), jsonText(M{"id": id, "status": status, "company": gsc, "total": 1, "done": 0,
			"updatedAt": time.Now().Add(-time.Hour).Format(time.RFC3339Nano)}))
		if alive {
			jobsMu.Lock()
			jobsRunning[id] = true
			jobsMu.Unlock()
		}
	}
	t.Cleanup(func() {
		jobsMu.Lock()
		delete(jobsRunning, "job-wait-21")
		delete(jobsRunning, "job-run-21")
		jobsMu.Unlock()
	})
	mk("job-int-21", "running", false) // the worker gone: interrupted
	if len(activeJobs()) != 1 || str(obj(activeJobs()[0])["status"]) != "interrupted" {
		t.Fatalf("the interrupted job: %v", activeJobs())
	}
	n0 := f.n("")
	lightCheckOpen(sessions)
	if got := f.ids()[n0:]; len(got) != 1 || got[0] != "FinComCompany" {
		t.Fatalf("with an interrupted job: %v (want one FinComCompany)", got)
	}
	// a job waiting for Tally (its worker alive): the check goes too
	mk("job-wait-21", "waiting", true)
	nowFn = func() time.Time { return time.Now().Add(11 * time.Minute) }
	n1 := f.n("")
	lightCheckOpen(openCompaniesCached())
	if got := f.ids()[n1:]; len(got) == 0 || got[len(got)-1] != "FinComCompany" || r21Count(got, "FinComCompany") != 1 {
		t.Fatalf("with a job waiting for Tally: %v (want one FinComCompany)", got)
	}
	// a posting going (its worker alive and running): nothing goes, the skip is logged
	mk("job-run-21", "running", true)
	nowFn = func() time.Time { return time.Now().Add(22 * time.Minute) }
	n2 := f.n("")
	lightCheckOpen(openCompaniesCached())
	nowFn = time.Now
	if got := f.ids()[n2:]; len(got) != 0 {
		t.Fatalf("a posting going, yet %v went", got)
	}
	if logLines("Light check of "+gsc+": skipped: a posting is going") != 1 {
		t.Fatalf("the skip is not in the log: %s", readText(logFile()))
	}
	if lightCheckYield(gsc)() != true {
		t.Fatal("the light check does not give way to a posting going")
	}
	jobsMu.Lock()
	delete(jobsRunning, "job-run-21")
	jobsMu.Unlock()
	if lightCheckYield(gsc)() {
		t.Fatal("the light check gives way to a waiting or interrupted job")
	}
}

// --- A3: the company list older than 10 minutes is asked afresh (the light company-list request, on the allow-list)
// when a check is due: a company opened later is seen and checked
func TestLightCheckRefreshesOldCompanyList(t *testing.T) {
	if _, ok := tallyAllowList["TDSDeskCompanies"]; !ok {
		t.Fatal("the company-list request is not on the allow-list")
	}
	f := r21Stand(t, "")
	f.add(today(), fgParty, "RF-1", "sale", "-1.00") // 2.2.0: a starting point is never 0 (the owner's finding)
	_ = openCompaniesWith(fin, true)
	n0 := f.n("")
	lightCheckOpen(openCompaniesCached())
	if got := f.ids()[n0:]; len(got) != 1 || got[0] != "FinComCompany" {
		t.Fatalf("a fresh list: %v (want FinComCompany only)", got)
	}
	// another company opened in Tally since; the list is 11 minutes old
	f.mu.Lock()
	f.coName = "SECOND CO"
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(11 * time.Minute) }
	n1 := f.n("")
	lightCheckOpen(openCompaniesCached())
	nowFn = time.Now
	got := f.ids()[n1:]
	if len(got) < 2 || got[0] != "TDSDeskCompanies" || got[len(got)-1] != "FinComCompany" {
		t.Fatalf("an old list: %v (want the company list, then FinComCompany)", got)
	}
	if _, ok := startPointOf("SECOND CO"); !ok {
		t.Fatal("the company opened later got no starting point")
	}
}

// --- A4: one log line per check: recorded, unchanged, skipped and why
func TestLightCheckLogsEachCheck(t *testing.T) {
	td := today()
	f := r21Stand(t, "")
	f.add(td, fgParty, "U-1", "sale", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions)
	if logLines("Light check of "+gsc+": starting point recorded (ALTVCHID=1, ALTMSTID=3)") != 1 {
		t.Fatalf("recorded: %s", readText(logFile()))
	}
	f.add(td, fgParty, "U-2", "sale", "-2.00")
	nowFn = func() time.Time { return time.Now().Add(11 * time.Minute) }
	lightCheckOpen(sessions)
	if logLines("Light check of "+gsc+": unchanged starting point ALTVCHID=1; now ALTVCHID=2, ALTMSTID=3") != 1 {
		t.Fatalf("unchanged: %s", readText(logFile()))
	}
	// the company's lease held by this bridge (a posting holds it): skipped, said once, not every turn
	leaseMu.Lock()
	leases[gsc] = time.Now().Add(time.Hour)
	leaseMu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(22 * time.Minute) }
	lightCheckOpen(sessions)
	lightCheckOpen(sessions)
	nowFn = time.Now
	leaseMu.Lock()
	delete(leases, gsc)
	leaseMu.Unlock()
	if logLines("Light check of "+gsc+": skipped: this bridge holds the company for a posting") != 1 {
		t.Fatalf("skipped (lease): %s", readText(logFile()))
	}
	// Tally does not answer: said, with why
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComCompany" {
			panic(http.ErrAbortHandler) // the connection dropped: no answer
		}
		return false
	}
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(33 * time.Minute) }
	lightCheckOpen(sessions)
	nowFn = time.Now
	if logLines("Light check of "+gsc+": skipped: Tally did not answer") != 1 {
		t.Fatalf("skipped (no answer): %s", readText(logFile()))
	}
	// Tally answers without the company's numbers: said, not taken as unchanged
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComCompany" {
			_, _ = w.Write([]byte("<ENVELOPE></ENVELOPE>"))
			return true
		}
		return false
	}
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(44 * time.Minute) }
	lightCheckOpen(sessions)
	nowFn = time.Now
	if logLines("Light check of "+gsc+": skipped: Tally gave no change numbers for it") != 1 || logLines("unchanged starting point") != 1 {
		t.Fatalf("skipped (no numbers): %s", readText(logFile()))
	}
}

// the fields of each company in the heartbeat (the cloud reads these)
var beatCompanyKeys = []string{"altmstid", "altvchid", "at", "guid", "lastRead", "name", "open", "phase", "recorderSeen", "waiting"}

// --- A5: the heartbeat lists every open company (not only the kept ones) with its GUID and change numbers; the real
// beat body, after a light check while paused, is written to tests/fixtures/beat-2.1.10.json for the cloud's test
func TestBeatCompaniesFixture(t *testing.T) {
	r18RecorderDirs(t)
	t.Setenv("COMPUTERNAME", "TEST-PC")
	td := "20261004"
	f := r21Stand(t, "")
	f.add(td, fgParty, "B-1", "sale", "-1.00")
	f.add(td, fgParty, "B-2", "sale", "-2.00")
	f.add(td, fgParty, "B-3", "sale", "-3.00")
	clock := time.Date(2026, 10, 4, 18, 30, 0, 0, time.Local)
	nowFn = func() time.Time { return clock }
	setPaused(true)
	t.Cleanup(func() { setPaused(false) })
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	lightCheckOpen(openCompaniesCached())
	sessions := openCompaniesCached()
	open, ports, tally, cos := beatParts(sessions)
	b := beatBody(tally, "open", "", open, ports, cos)
	nowFn = time.Now
	cs := arr(b["companies"])
	if len(cs) != 1 {
		t.Fatalf("companies: %v (want the one open company, though it is not kept)", cs)
	}
	c := obj(cs[0])
	var keys []string
	for k := range c {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != strings.Join(beatCompanyKeys, ",") {
		t.Fatalf("a company's fields: %v (want %v)", keys, beatCompanyKeys)
	}
	if str(c["name"]) != gsc || c["open"] != true || str(c["guid"]) != "co-guid-1" || toI64(c["altvchid"]) != 3 || toI64(c["altmstid"]) != 3 || c["recorderSeen"] != false {
		t.Fatalf("the company: %v", c)
	}
	if obj(obj(b["startPoint"])[gsc]) == nil || obj(obj(b["changeNumbers"])[gsc]) == nil || b["readDays"] == nil || b["paused"] != true {
		t.Fatalf("the top-level fields kept: %v %v", b["startPoint"], b["changeNumbers"])
	}
	if _, ok := b["trialTools"]; !ok {
		t.Fatal("the beat does not carry trialTools")
	}
	// the fixture: the beat as sent (invokeCloud adds the version); what depends on this run (the stand's port, the
	// day of the request counts) set to fixed values
	b["version"] = BridgeVersion
	for _, p := range arr(b["ports"]) {
		obj(p)["port"] = 9000
	}
	// reqs (the bridge's own count of its Tally requests today, selfwatch.go) runs on the wall clock: its day and
	// times set to the test clock, its milliseconds to 0, and the longest shown as the last (which one was longest
	// depends on the run)
	if rq := obj(b["reqs"]); rq != nil {
		rq["day"] = "2026-10-04"
		for _, k := range []string{"last", "longest"} {
			if e := obj(rq[k]); e != nil {
				e["at"], e["ms"] = "2026-10-04T18:30:00", 0
			}
		}
		if l := obj(rq["last"]); l != nil {
			rq["longest"] = M{"at": l["at"], "kind": l["kind"], "ms": 0}
		}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	// 2.3.0: the stand Tally's port changes every run; the fixture keeps Tally's usual port, so it does not change by itself
	if toInt(b["tallyPort"]) > 0 {
		b["tallyPort"] = 9000
	}
	if err := enc.Encode(b); err != nil {
		t.Fatal(err)
	}
	txt := buf.String()
	if m := regexp.MustCompile(`"at": "([^"]+)"`).FindAllStringSubmatch(txt, -1); len(m) == 0 {
		t.Fatal("no times in the fixture")
	} else {
		for _, x := range m {
			if x[1] != "2026-10-04T18:30:00" && x[1] != "" {
				t.Fatalf("a time not from the test clock: %s", x[1])
			}
		}
	}
	out := filepath.Join("..", "tests", "fixtures", "beat-2.1.10.json")
	if err := os.WriteFile(out, []byte(txt), 0o644); err != nil {
		t.Fatal(err)
	}
	// unknown numbers: null, the key still there
	cs2 := beatCompanies([]M{{"port": 9000, "ok": true, "companies": []any{M{"name": "NEVER CHECKED"}}}}, []any{"NEVER CHECKED"})
	if n := obj(cs2[0]); n["altvchid"] != nil || n["altmstid"] != nil {
		t.Fatalf("a company never checked: %v", n)
	} else if _, ok := n["altvchid"]; !ok {
		t.Fatalf("a company never checked has no altvchid key: %v", n)
	}
}

// --- A6: FinCom's answer to the heartbeat switches the trial tools on (trialTools: true) or off (false, or absent);
// the heartbeat carries the state
func TestTrialToolsFromBeatAnswer(t *testing.T) {
	c := newStandCloud(t)
	f := newStandTally(t)
	standBridge(t, f, c.cfg())
	if trialTools() {
		t.Fatal("trial tools on by default")
	}
	c.mu.Lock()
	c.beatReply = M{"trialTools": true}
	c.mu.Unlock()
	beatOnce()
	if !trialTools() {
		t.Fatal("trialTools: true in FinCom's answer did not switch them on")
	}
	beatOnce()
	c.mu.Lock()
	sent := c.lastBeat["trialTools"]
	c.beatReply = M{}
	c.mu.Unlock()
	if sent != true {
		t.Fatalf("the beat's trialTools: %v", sent)
	}
	beatOnce()
	if trialTools() {
		t.Fatal("an answer without trialTools left them on")
	}
	c.mu.Lock()
	c.beatReply = M{"trialTools": "yes"}
	c.mu.Unlock()
	beatOnce()
	if trialTools() {
		t.Fatal("a trialTools that is not the boolean true switched them on")
	}
	if logLines("Trial tools switched on for this computer in FinCom") != 1 || logLines("Trial tools switched off for this computer in FinCom") != 1 {
		t.Fatalf("the switch is not in the log: %s", readText(logFile()))
	}
}

// --- B4: owner only: the five trial items are in the tray menu and their routes answer only while FinCom's switch is
// on; otherwise 403 with the words
func TestTrialToolsSwitch(t *testing.T) {
	f := r21Stand(t, `,"Key":"tray-test-key"`)
	_ = openCompaniesWith(fin, true)
	setTrialTools(false)
	n0 := f.n("")
	for _, c := range []struct{ method, path, body string }{
		{"POST", "/tray/readtest", `{"preview":true}`}, {"GET", "/tray/readtest", ""},
		{"POST", "/tray/recorder-note", "{}"}, {"POST", "/tray/recorder-send", "{}"},
		{"POST", "/tray/recorder-lock", "{}"}, {"POST", "/tray/recorder-bench", `{"preview":true}`}, {"GET", "/tray/recorder-bench", ""},
	} {
		code, res := callLocal(t, c.method, c.path, "", c.body)
		if code != 403 || str(res["error"]) != trialOffWords {
			t.Fatalf("%s %s with the trial tools off: %d %v", c.method, c.path, code, res)
		}
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("Tally was asked %v with the trial tools off", got)
	}
	if trialOffWords != "Trial tools are switched off for this computer in FinCom (Tally page, owner)" {
		t.Fatalf("the words: %q", trialOffWords)
	}
	if items := trayTrialItems(M{"trialTools": false}); len(items) != 0 {
		t.Fatalf("the menu with the trial tools off: %v", items)
	}
	if items := trayTrialItems(nil); len(items) != 0 {
		t.Fatalf("the menu with no status: %v", items)
	}
	setTrialTools(true)
	t.Cleanup(func() { setTrialTools(false) })
	if st := trayStatus(); st["trialTools"] != true {
		t.Fatalf("the tray's status: %v", st["trialTools"])
	}
	items := trayTrialItems(trayStatus())
	var texts []string
	for _, it := range items {
		texts = append(texts, it.text)
	}
	// 2.2.2: "Test fetching an entry" (the owner's request) after "Test reading from Tally"
	want := []string{"Test reading from Tally", "Test fetching an entry", "Recorder trial: note change numbers", "Recorder trial: send results", "Recorder trial: lock the holding file for 30 s", "Recorder trial: time saving"}
	if strings.Join(texts, "|") != strings.Join(want, "|") || items[0].id != 18 || items[1].id != 24 || items[5].id != 22 {
		t.Fatalf("the menu with the trial tools on: %v", items)
	}
	if code, res := callLocal(t, "POST", "/tray/readtest", "", `{"preview":true}`); code != 200 || str(res["company"]) != gsc {
		t.Fatalf("the read test's preview with the trial tools on: %d %v", code, res)
	}
	if code, res := callLocal(t, "POST", "/tray/recorder-bench", "", `{"preview":true}`); code != 200 || res["ok"] != true || str(res["company"]) != gsc ||
		str(res["confirm"]) != "This will add 100 test entries (and 2 ledgers if missing) to "+gsc+". Continue?" {
		t.Fatalf("the time saving's preview with the trial tools on: %d %v", code, res)
	}
	// a web page is still refused first
	if code, _ := callLocal(t, "POST", "/tray/recorder-bench", "https://app.fincom.live", `{"preview":true}`); code != 403 {
		t.Fatalf("a web page: %d", code)
	}
	tray := readText("win_tray.go")
	if strings.Contains(tray, "ZZ TEST") || !strings.Contains(tray, "trayTrialItems(st)") || !strings.Contains(tray, `str(pv["confirm"])`) {
		t.Fatal("win_tray.go: a hard-coded ZZ TEST, or the trial items not from trayTrialItems, or the yes/no not the bridge's words")
	}
}

// --- B1, B5 (TestRecorderBenchZZTest before): the time saving on any company open in Tally: a yes/no naming it,
// TRIAL in every narration and in the two ledgers' names; the company asked for must be the one open
func TestRecorderBenchAnyCompany(t *testing.T) {
	f := r21Stand(t, `,"Key":"tray-test-key","ReadDays":false`)
	trialOn(t)
	_ = findCompanyPortQuiet(gsc)
	if r := startBench("OTHER CO"); r["ok"] == true || !strings.Contains(str(r["error"]), "OTHER CO") {
		t.Fatalf("a company not open: %v", r)
	}
	if strings.Contains(readText("trial.go"), "ZZ TEST") {
		t.Fatal("trial.go still names ZZ TEST")
	}
	if benchConfirmText(gsc) != "This will add 100 test entries (and 2 ledgers if missing) to "+gsc+". Continue?" {
		t.Fatalf("the yes/no: %q", benchConfirmText(gsc))
	}
	n0 := r19Count(f)
	if code, r := callLocal(t, "POST", "/tray/recorder-bench", "", `{"confirm":true}`); code != 200 || r["ok"] != true || str(r["company"]) != gsc {
		t.Fatalf("start: %d %v", code, r)
	}
	var s M
	for i := 0; i < 500; i++ {
		_, s = callLocal(t, "GET", "/tray/recorder-bench", "", "")
		if str(s["state"]) != "running" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if str(s["state"]) != "done" {
		t.Fatalf("the bench: %v", s)
	}
	f.mu.Lock()
	small, large, masters := 0, 0, 0
	for i := n0; i < len(f.bodies); i++ {
		b := f.bodies[i]
		if f.reqs[i] != "Import" {
			continue
		}
		if !strings.Contains(b, "<SVCURRENTCOMPANY>"+esc(gsc)+"</SVCURRENTCOMPANY>") {
			t.Errorf("an import not for %s: %s", gsc, cut(b, 300))
		}
		if strings.Contains(b, "<LEDGER NAME=") {
			masters++
			if !strings.Contains(b, `<LEDGER NAME="TRIAL Bench Dr" ACTION="Create"><NAME>TRIAL Bench Dr</NAME><PARENT>Indirect Expenses</PARENT>`) ||
				!strings.Contains(b, `<LEDGER NAME="TRIAL Bench Cr" ACTION="Create"><NAME>TRIAL Bench Cr</NAME><PARENT>Sundry Creditors</PARENT>`) {
				t.Errorf("the bench ledgers: %s", cut(b, 400))
			}
			continue
		}
		narr := group(`<NARRATION>([^<]*)</NARRATION>`, b, 1)
		if !strings.HasPrefix(narr, "TRIAL FinCom bench ") || strings.Contains(b, "TDSDesk:") || strings.Contains(b, "ZZ ") {
			t.Errorf("a bench voucher: %s", cut(b, 300))
		}
		switch strings.Count(b, "<ALLLEDGERENTRIES.LIST>") {
		case 2:
			small++
		case 50:
			large++
		}
	}
	f.mu.Unlock()
	if small != 50 || large != 50 || masters != 1 {
		t.Fatalf("imports: %d small, %d large, %d masters (want 50, 50, 1)", small, large, masters)
	}
	if logLines("Recorder trial: time saving ("+gsc+"): small journals (2 lines): 50 requests, median") != 1 {
		t.Fatal("the summary is not in the log")
	}
}

// --- B1: the holding-file lock and the change numbers for the company asked for (any company): errors name it
func TestRecorderLockAnyCompanyWords(t *testing.T) {
	r18RecorderDirs(t)
	r21Stand(t, `,"Key":"tray-test-key"`)
	trialOn(t)
	if _, err := recorderLockHolding("OTHER CO"); err == nil || !strings.Contains(err.Error(), "OTHER CO") {
		t.Fatalf("a company with no GUID held: %v", err)
	}
	_ = findCompanyPortQuiet(gsc)
	_ = openCompaniesWith(fin, true)
	if _, err := recorderLockHolding(""); err == nil || !strings.Contains(err.Error(), "No holding file for "+gsc) {
		t.Fatalf("the open company, no holding file yet: %v", err)
	}
}

// --- B3: the add-on writes for whichever company is open: FCRIsTrial is "a company is current"; every other rule kept
func TestAddonAnyCompany(t *testing.T) {
	tdl := readText(filepath.Join("addon", "FinComRecorderAnyCompany.tdl"))
	if strings.Contains(tdl, "ZZ TEST") || strings.Contains(tdl, "ZZ ") {
		t.Fatal("the add-on still names ZZ TEST")
	}
	if !regexp.MustCompile(`(?m)^\s*FCRIsTrial\s*:\s*NOT \$\$IsEmpty:##SVCurrentCompany\s*$`).MatchString(tdl) {
		t.Fatal("FCRIsTrial is not 'NOT $$IsEmpty:##SVCurrentCompany'")
	}
	for _, s := range []string{"silent", "never blocks", "On : Form Accept : Yes          : Form Accept"} {
		if !strings.Contains(tdl, s) {
			t.Fatalf("the add-on lost %q", s)
		}
	}
	for _, s := range []string{"Message", "Query", "Menu", "Key :"} {
		if regexp.MustCompile(`(?m)^[^;]*\b` + regexp.QuoteMeta(s)).MatchString(tdl) {
			t.Fatalf("the add-on has %q outside a comment", s)
		}
	}
}

// --- C, D: the version, and the sheets name no company
func TestVersionAndSheets2110(t *testing.T) {
	if BridgeVersion != "2.4.2" { // 2.3.1: the entry request also fetches the ledger lines under an invoice's items
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	for _, f := range []string{"../docs/bridge-2.1.10-test-sheet.txt", "../docs/recorder-trial-sheet.txt"} {
		raw := readText(f)
		txt := strings.Join(strings.Fields(raw), " ")
		if raw == "" || strings.Contains(txt, "ZZ TEST") || strings.Contains(txt, "GARG") {
			t.Fatalf("%s: missing, or names a company", f)
		}
		for _, s := range []string{"the company you test on (it must be linked to a FinCom client)", "Trial tools on this computer", "type TRIAL at the start of every narration",
			"not tested yet (the owner, 04-Oct)", "about 1,200", "all marked TRIAL", "unload", "cancelling them in Tally afterwards is the owner's choice"} {
			if !strings.Contains(strings.ToLower(txt), strings.ToLower(s)) {
				t.Fatalf("%s does not say %q", f, s)
			}
		}
	}
	sheet := strings.Join(strings.Fields(readText("../docs/bridge-2.1.10-test-sheet.txt")), " ")
	for _, s := range []string{"2.1.10", "starting point", "up to 2 changes not received"} {
		if !strings.Contains(sheet, s) {
			t.Fatalf("the 2.1.10 test sheet does not say %q", s)
		}
	}
	// the fingerprint: the placeholder before the build, the setup's SHA-256 after it (the build fills it in)
	if !strings.Contains(sheet, "(filled in when the setup is built") && !regexp.MustCompile(`Fingerprint: SHA-256 [0-9a-f]{64} \(FinComBridge-Setup-2\.1\.10\.exe`).MatchString(sheet) {
		t.Fatal("the 2.1.10 test sheet has neither the fingerprint placeholder nor the setup's SHA-256")
	}
}
