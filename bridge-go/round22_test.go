package main

// Fixes of the 2.1.10 code and security reviews (docs/reviews/bridge-2.1.10-code-review.md, -security-review.md):
//   M1 (S1)  the trial tools turn off at once on any beat that is not a 200 answer carrying trialTools: true (a failed
//            beat, a revoked key, an error answer) and when the cloud link is turned off or changed;
//   M2 (S2)  the any-company add-on ships as addon\FinComRecorderAnyCompany.tdl; the 2.1.9 file FinComRecorderTrial.tdl
//            is never given the any-company gate (a 2.1.9 text on disk is left byte for byte; anything else there is
//            put back to the 2.1.9 ZZ TEST-only text; an absent one is not made);
//   M3 (S3)  "send results" asks first: the preview names each company whose recorder lines would go and what a line
//            holds; the bridge sends only with the tray's confirm;
//   M4 (S4)  the company-info map under a lock, never held during the Tally request;
//   L5..L8   the bench counts as a posting going; the skip log keyed on the reason's class, "unchanged" at most once an
//            hour; the company list marked fresh only when it was asked afresh; the bench starts only with the confirm.

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// --- M1: the switch turns off when FinCom's "on" does not come
func TestTrialToolsOffWithoutAnswer(t *testing.T) {
	c := newStandCloud(t)
	f := newStandTally(t)
	standBridge(t, f, c.cfg())
	on := func() {
		t.Helper()
		c.mu.Lock()
		c.beatReply = M{"trialTools": true}
		c.mu.Unlock()
		beatOnce()
		if !trialTools() {
			t.Fatal("trialTools: true did not switch them on")
		}
	}
	on()
	// the cloud cannot be reached: one failed beat turns them off, and the log says so
	c.srv.Close()
	beatOnce()
	if trialTools() {
		t.Fatal("a failed beat left the trial tools on")
	}
	if logLines("Trial tools switched off") != 1 {
		t.Fatalf("the switch-off is not in the log: %s", readText(logFile()))
	}
	// an error answer (500), and a revoked key (401): off
	for _, code := range []int{500, 401} {
		code := code
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"error":"no","trialTools":true}`))
		}))
		setCfg("CloudUrl", srv.URL+"/")
		setTrialTools(true)
		beatOnce()
		srv.Close()
		if trialTools() {
			t.Fatalf("a %d answer left the trial tools on", code)
		}
	}
	// a 200 answer that is not JSON: off
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("not json")) }))
	setCfg("CloudUrl", srv.URL+"/")
	setTrialTools(true)
	beatOnce()
	srv.Close()
	if trialTools() {
		t.Fatal("a 200 answer without JSON left the trial tools on")
	}
	// the cloud link turned off (cloudOn() false, so no beat runs any more): off at once
	setTrialTools(true)
	if _, err := setCloudLink(M{"off": true}); err != nil {
		t.Fatal(err)
	}
	if cloudOn() || trialTools() {
		t.Fatalf("after /cloudlink off: cloudOn=%v trialTools=%v", cloudOn(), trialTools())
	}
	// a link to another address (refused or not): off before anything is asked of the new cloud
	setTrialTools(true)
	_, _ = setCloudLink(M{"url": "https://example.com/x", "key": "fcd_" + strings.Repeat("1", 48)})
	if trialTools() {
		t.Fatal("a link change left the trial tools on")
	}
	if !strings.Contains(readText("cloud.go"), "trialToolsOff(") {
		t.Fatal("cloud.go does not turn the tools off")
	}
}

// --- M2: the upgrade never widens the 2.1.9 add-on file
const anyAddonName = "FinComRecorderAnyCompany.tdl"

var anyGate = "NOT $$IsEmpty:##SVCurrentCompany"

func TestAddonUpgradeLeavesOldFileAlone(t *testing.T) {
	legacy := readText(filepath.Join("addon", "legacy", "FinComRecorderTrial-2.1.9.tdl"))
	if !strings.Contains(legacy, `FCRIsTrial  : ##SVCurrentCompany = "ZZ TEST"`) || strings.Contains(legacy, anyGate) {
		t.Fatal("the kept 2.1.9 text is missing, or not the ZZ TEST-only gate")
	}
	if string(legacyAddon219) != legacy {
		t.Fatal("the embedded 2.1.9 text is not addon/legacy/FinComRecorderTrial-2.1.9.tdl")
	}
	// what ships: only the new name; it carries the any-company gate
	es, _ := addonFiles.ReadDir("addon")
	var names []string
	for _, e := range es {
		names = append(names, e.Name())
	}
	// 2.2.0: the live add-on FinComRecorder.tdl ships beside it (recorder_live_test.go); the 2.1.9 name never
	if strings.Join(names, ",") != liveAddonName+","+anyAddonName {
		t.Fatalf("the add-on files shipped: %v (want %s and %s)", names, liveAddonName, anyAddonName)
	}
	if !strings.Contains(readText(filepath.Join("addon", anyAddonName)), anyGate) {
		t.Fatal("the new add-on lacks the any-company gate")
	}
	if _, err := os.Stat(filepath.Join("addon", legacyAddonName)); err == nil {
		t.Fatal("addon/" + legacyAddonName + " is still in the source")
	}
	run := func(old []byte) (string, []byte, bool) {
		t.Helper()
		base := t.TempDir()
		add := filepath.Join(base, "FinCom", "addon")
		_ = os.MkdirAll(add, 0o755)
		op := filepath.Join(add, legacyAddonName)
		past := time.Now().Add(-48 * time.Hour).Truncate(time.Second)
		if old != nil {
			_ = os.WriteFile(op, old, 0o644)
			_ = os.Chtimes(op, past, past)
		}
		lines, err := prepareFinComFolders(base, false)
		if err != nil {
			t.Fatalf("%v\n%s", err, strings.Join(lines, "\n"))
		}
		if n := readText(filepath.Join(add, anyAddonName)); !strings.Contains(n, anyGate) {
			t.Fatalf("the new file was not written: %q\n%s", cut(n, 100), strings.Join(lines, "\n"))
		}
		b, err := os.ReadFile(op)
		if err != nil {
			return op, nil, false
		}
		fi, _ := os.Stat(op)
		return op, b, fi.ModTime().Equal(past)
	}
	// a 2.1.9 install: the old file is left byte for byte (not even rewritten)
	_, b, same := run([]byte(legacy))
	if !bytes.Equal(b, []byte(legacy)) || !same {
		t.Fatalf("the 2.1.9 file was touched (same time %v)", same)
	}
	// the old name holding the any-company text (a pre-release 2.1.10): put back to the 2.1.9 text
	cur := readText(filepath.Join("addon", anyAddonName))
	_, b, _ = run([]byte(cur))
	if string(b) != legacy || strings.Contains(string(b), anyGate) {
		t.Fatalf("the old file still carries the any-company gate: %q", cut(string(b), 200))
	}
	// no old file: none is made
	if _, b, _ := run(nil); b != nil {
		t.Fatal("the old file was made on a computer that had none")
	}
	// the sheets: the new path, and the unload step before installing
	for _, s := range []string{"../docs/bridge-2.1.10-test-sheet.txt", "../docs/recorder-trial-sheet.txt"} {
		txt := strings.Join(strings.Fields(readText(s)), " ")
		for _, w := range []string{`C:\ProgramData\FinCom\addon\FinComRecorderAnyCompany.tdl`, "before installing 2.1.10, unload any FinComRecorderTrial.tdl (PART 4)",
			"load the new file by its new path"} {
			if !strings.Contains(strings.ToLower(txt), strings.ToLower(w)) || !strings.Contains(txt, "FinComRecorderAnyCompany.tdl") {
				t.Fatalf("%s does not say %q", s, w)
			}
		}
		if strings.Contains(txt, `addon\FinComRecorderTrial.tdl and clear`) {
			t.Fatalf("%s still unloads only the old path", s)
		}
	}
}

// --- M3: "send results" names the companies first and sends only with the tray's confirm
func TestRecorderSendPreviewNamesCompanies(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	trialOn(t)
	la := strings.ReplaceAll(r18Line1, "cname=ZZ TEST", "cname=ALPHA TRADERS")
	lb := strings.ReplaceAll(r18Line1, "cname=ZZ TEST", "cname=BETA & SONS")
	_ = os.WriteFile(filepath.Join(rec, "guid-a.txt"), utf16leBOM(la+"\r\n"+la+"\r\n"), 0o644)
	_ = os.WriteFile(filepath.Join(rec, "guid-b.txt"), []byte(lb+"\r\n"), 0o644)
	code, pv := callLocal(t, "POST", "/tray/recorder-send", "", `{"preview":true}`)
	if code != 200 || pv["ok"] != true {
		t.Fatalf("the preview: %d %v", code, pv)
	}
	conf := str(pv["confirm"])
	for _, w := range []string{"ALPHA TRADERS (2 lines)", "BETA & SONS (1 line)", "narration", "party and ledger names", "Tally user name", "FinCom support"} {
		if !strings.Contains(conf, w) {
			t.Fatalf("the yes/no does not say %q: %q", w, conf)
		}
	}
	if got := strs(pv["companies"]); strings.Join(got, "|") != "ALPHA TRADERS|BETA & SONS" {
		t.Fatalf("the companies named: %v", pv["companies"])
	}
	if c.count("support") != 0 {
		t.Fatal("the preview sent something")
	}
	// no confirm: refused, nothing sent
	if code, r := callLocal(t, "POST", "/tray/recorder-send", "", "{}"); code != 200 || r["ok"] == true || !strings.Contains(str(r["error"]), "asks first") {
		t.Fatalf("a send without the confirm: %d %v", code, r)
	}
	if c.count("support") != 0 {
		t.Fatal("sent without the confirm")
	}
	if code, r := callLocal(t, "POST", "/tray/recorder-send", "", `{"confirm":true}`); code != 200 || r["ok"] != true || toInt(r["files"]) != 2 {
		t.Fatalf("the send with the confirm: %d %v", code, r)
	}
	if c.count("support") != 1 {
		t.Fatal("the confirmed send did not go")
	}
	tray := readText("win_tray.go")
	if !strings.Contains(tray, `trayCall("POST", "/tray/recorder-send", M{"preview": true})`) || !strings.Contains(tray, `trayCall("POST", "/tray/recorder-send", M{"confirm": true})`) {
		t.Fatal("the tray does not ask first (preview, then confirm)")
	}
	for _, s := range []string{"../docs/bridge-2.1.10-test-sheet.txt", "../docs/recorder-trial-sheet.txt"} {
		txt := strings.ToLower(strings.Join(strings.Fields(readText(s)), " "))
		for _, w := range []string{"narration", "party and ledger names", "tally user name", "readable by every windows user on this pc", "names the companies"} {
			if !strings.Contains(txt, w) {
				t.Fatalf("%s does not say %q", s, w)
			}
		}
	}
}

// --- M4: the company-info map under a lock: company-list refreshes, /status and direct readers at once (-race)
func TestCoInfoConcurrent(t *testing.T) {
	f := r21Stand(t, `,"Key":"tray-test-key"`)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for k := 0; k < 15; k++ {
				_ = getCoInfo(fin, fmt.Sprintf("CO %d-%d", i, k%5), f.port)
			}
		}(i)
	}
	for i := 0; i < 3; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for k := 0; k < 5; k++ {
				_ = openCompaniesWith(&TC{copier: true}, true)
			}
		}()
		go func() {
			defer wg.Done()
			for k := 0; k < 5; k++ {
				_, _ = callLocal(t, "GET", "/status", "", "")
			}
		}()
	}
	wg.Wait()
	if x := getCoInfo(fin, "CO 3-1", f.port); x == nil {
		t.Fatal("no company info")
	}
	// the lock is not held while Tally is asked: a slow company-info answer does not hold back a known company
	release := make(chan struct{})
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanyInfo" && strings.Contains(body, "SLOW CO") {
			<-release
		}
		return false
	}
	f.mu.Unlock()
	slowDone := make(chan struct{})
	go func() { _ = getCoInfo(fin, "SLOW CO", f.port); close(slowDone) }()
	t.Cleanup(func() { <-slowDone }) // stored before the test's folders go
	time.Sleep(150 * time.Millisecond)
	done := make(chan struct{})
	go func() { _ = getCoInfo(fin, "CO 3-1", f.port); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("a known company waited for another company's Tally request (the lock is held during it)")
	}
	close(release)
	if !strings.Contains(readText("ports.go"), "coInfoMu") {
		t.Fatal("ports.go has no coInfoMu")
	}
}

// --- L5: the time saving counts as a posting going: the light check does not go between its imports
func TestLightCheckYieldsToBench(t *testing.T) {
	f := r21Stand(t, `,"Key":"tray-test-key"`)
	trialOn(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "Import" {
			return 25 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	sessions := openCompaniesWith(fin, true)
	if r := startBench(gsc); r["ok"] != true {
		t.Fatalf("start: %v", r)
	}
	for i := 0; i < 200 && f.n("Import") < 3; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if !postingGoing() || lightCheckBlocked() == "" {
		t.Fatalf("during the bench: postingGoing=%v blocked=%q", postingGoing(), lightCheckBlocked())
	}
	if !lightCheckYield(gsc)() {
		t.Fatal("the light check's yield is false during the bench")
	}
	n0 := f.n("FinComCompany")
	lightCheckOpen(sessions)
	for i := 0; i < 1000 && str(benchStatus()["state"]) == "running"; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if str(benchStatus()["state"]) != "done" {
		t.Fatalf("the bench: %v", benchStatus())
	}
	if n := f.n("FinComCompany"); n != n0 { // runBench's own company check went before n0
		t.Fatalf("FinComCompany went %d time(s) during the bench (want none)", n-n0)
	}
	if postingGoing() {
		t.Fatal("postingGoing stays true after the bench")
	}
}

// --- L8: the bench starts only with the tray's confirm (after its yes/no)
func TestTrialBenchNeedsConfirm(t *testing.T) {
	f := r21Stand(t, `,"Key":"tray-test-key"`)
	trialOn(t)
	_ = openCompaniesWith(fin, true)
	n0 := f.n("")
	if code, r := callLocal(t, "POST", "/tray/recorder-bench", "", `{}`); code != 200 || r["ok"] == true || !strings.Contains(str(r["error"]), "asks first") {
		t.Fatalf("a start without the confirm: %d %v", code, r)
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("Tally was asked %v without the confirm", got)
	}
	if !strings.Contains(readText("win_tray.go"), `trayCall("POST", "/tray/recorder-bench", M{"company": company, "confirm": true})`) {
		t.Fatal("the tray does not pass the confirm")
	}
}

// --- L6: the skip log is keyed on the reason's class (digits and times do not make a new line), old keys dropped;
// "unchanged" at most once an hour per company
func TestLightSkipOncePerClass(t *testing.T) {
	td := today()
	f := r21Stand(t, "")
	base := time.Now()
	t.Cleanup(func() { nowFn = time.Now })
	for i := 0; i < 20; i++ {
		nowFn = func() time.Time { return base.Add(time.Duration(i) * 30 * time.Second) }
		lightSkip(gsc, fmt.Sprintf("Tally did not answer (Tally 9000 did not answer; next try at 10:%02d:%02d, after %d s)", i/2, (i*30)%60, 30+i))
	}
	if n := logLines("Light check of " + gsc + ": skipped: Tally did not answer"); n != 1 {
		t.Fatalf("%d skip lines over 10 minutes for one reason (want 1)", n)
	}
	lightSkip(gsc, "a posting is going (the check goes after it)")
	if logLines("Light check of "+gsc+": skipped: a posting is going") != 1 {
		t.Fatal("another reason was not said")
	}
	nowFn = func() time.Time { return base.Add(3 * time.Hour) }
	lightSkip("OTHER", "x")
	lcMu.Lock()
	left := len(lcSkipped)
	lcMu.Unlock()
	if left != 1 {
		t.Fatalf("the skip keys older than an hour are kept: %d", left)
	}
	// unchanged: once in the first hour, again after it
	nowFn = time.Now
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions)
	for _, m := range []int{11, 22, 33, 44} {
		f.add(td, fgParty, fmt.Sprint("UC-", m), "sale", "-1.00")
		nowFn = func() time.Time { return time.Now().Add(time.Duration(m) * time.Minute) }
		lightCheckOpen(sessions)
	}
	if n := logLines("Light check of " + gsc + ": unchanged starting point"); n != 1 {
		t.Fatalf("%d unchanged lines in 44 minutes (want 1)", n)
	}
	nowFn = func() time.Time { return time.Now().Add(75 * time.Minute) }
	lightCheckOpen(sessions)
	nowFn = time.Now
	if n := logLines("Light check of " + gsc + ": unchanged starting point"); n != 2 {
		t.Fatalf("%d unchanged lines after 75 minutes (want 2)", n)
	}
}

// --- L7: the company list is marked fresh only when Tally gave it afresh
func TestLightCompanyListRetriedAfterGivingWay(t *testing.T) {
	f := r21Stand(t, "")
	_ = openCompaniesWith(fin, true)
	t.Cleanup(func() { nowFn = time.Now })
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "TDSDeskCompanies" {
			panic(http.ErrAbortHandler) // no answer: the list held stands
		}
		return false
	}
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(11 * time.Minute) }
	n0 := f.n("TDSDeskCompanies")
	lightCheckOpen(openCompaniesCached())
	if f.n("TDSDeskCompanies") == n0 {
		t.Fatal("the old list was not asked afresh")
	}
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(12 * time.Minute) }
	n1 := f.n("TDSDeskCompanies")
	lightCheckOpen(openCompaniesCached())
	if f.n("TDSDeskCompanies") == n1 {
		t.Fatal("the list that was not given afresh was marked fresh: not asked again at the next turn")
	}
	// given afresh now: not asked again within 10 minutes
	nowFn = func() time.Time { return time.Now().Add(13 * time.Minute) }
	n2 := f.n("TDSDeskCompanies")
	lightCheckOpen(openCompaniesCached())
	if f.n("TDSDeskCompanies") != n2 {
		t.Fatal("a list given afresh was asked again a minute later")
	}
}
