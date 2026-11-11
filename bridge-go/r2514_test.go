package main

// bridge 2.5.14 (11-Nov-2026, the reliability audit's bridge section): nothing new is asked of Tally.
//  1. head-of-line: a day whose own company cannot be asked gives way to the other companies' days
//  2. a company's own refusal never leaves another company's hand-out showing an old reason
//  3. an answer from Tally with no group (or no ledger) is not a list: nothing sent as a complete read
//  4. a company linked in FinCom has its masters read at once
//  5. ledger_progress for every masters read (Update now, the nightly run), the count still the ledgers-only read's
//  6. HTTP 503 from FinCom's cloud: busy, tried again after a growing wait; never "the key is not valid"
//  7. a company's name cleaned at its ends (the owner's decision of 11-Nov-2026), in SVCURRENTCOMPANY too
import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	r2514Co   = "Made Up Traders"
	r2514GUID = "11111111-2222-3333-4444-555555555555"
)

func TestR2514Version(t *testing.T) {
	if BridgeVersion != "2.5.14" || !newerVersion("2.5.14", "2.5.13") || newerVersion("2.5.13", "2.5.14") {
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.14-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.14 by the owner's standing decision of 2026-10-06", "the requests are 2.5.13's", "as for 2.5.13 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !regexp.MustCompile(`re-measured on 2026-11-11 for 2\.5\.14: no request was measured again[^\n]*allowed for 2\.5\.14 by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.5.14")
	}
	if strings.Contains(al, "allowed for 2.5.13 by") {
		t.Error("2.5.13's line is still worded as the current one")
	}
	if strings.Contains(al, "cleaned of control characters and edge spaces in SVCURRENTCOMPANY") {
		t.Error("the allow-list still says the company's name is cleaned in what goes to Tally")
	}
}

// a second company this bridge holds (its GUID and starting point) that is NOT open in this login's Tally
func r2514Other(start bool) {
	noteCompanyGUID(r2514Co, r2514GUID)
	if start {
		noteStartPoint(r2514Co, r2514GUID, 90000, 500)
	}
}

func r2514Days(chosen string, rows ...[3]string) M {
	var l []any
	for _, r := range rows {
		l = append(l, M{"company": r[0], "company_guid": r[1], "day": r[2], "fetch": true, "chosenAt": chosen, "kind": "period"})
	}
	return M{"periodDays": l}
}

func r2514AcksBy() map[string]M {
	by := map[string]M{}
	for _, a := range r2510Acks() {
		by[str(a["company"])] = a
	}
	return by
}

// 1. the first listed day is a company closed in Tally (or one with no starting point): it is said refused as before,
// and the next company's day is read in the same turn; nothing is asked of Tally for the closed one
func TestR2514HeadOfLineGivesWay(t *testing.T) {
	for _, c := range []struct {
		start bool
		code  string
	}{{true, "notOpen"}, {false, "noStart"}} {
		f, _, m := pullBridge(t)
		r2514Other(c.start)
		pullDay(f, "20250915", 700, "Sales", "Receipt")
		ch := nowFn().UTC().Format(time.RFC3339)
		applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}, [3]string{r2514Co, r2514GUID, "20250911"}, [3]string{zz, b220CoGUID, "20250915"}))
		n0 := len(f.ids())
		pullRun(t, 20)
		if m.n["20250915"] != 2 || len(m.held) != 2 {
			t.Fatalf("%s: the open company's day was not read behind the closed one's: heads %v, held %d, sent %v", c.code, m.n, len(m.held), f.ids()[n0:])
		}
		for i, b := range f.bodies[n0:] {
			if strings.Contains(b, r2514Co) {
				t.Fatalf("%s: a request named the closed company: %s", c.code, f.ids()[n0+i])
			}
		}
		by := r2514AcksBy()
		if a := by[r2514Co]; str(a["state"]) != "refused" || str(a["code"]) != c.code {
			t.Fatalf("%s: the closed company's hand-out: %v", c.code, by)
		}
		if a := by[zz]; str(a["state"]) != "started" || str(a["day"]) != "20250915" {
			t.Fatalf("%s: the open company's hand-out: %v", c.code, by)
		}
		// the closed company's days stay listed here and are looked at again every pass (still refused, still nothing sent)
		n1 := len(f.ids())
		pullRun(t, 5)
		if w := pullCurrent(); w == nil || w.it.Company != r2514Co || len(f.ids()) != n1 {
			t.Fatalf("%s: the closed company's day is not looked at again, or something was sent: %v", c.code, f.ids()[n1:])
		}
		pullReset()
	}
}

// 1b. a day FinCom no longer names, nothing asked of Tally for it yet: let go; one already begun is finished as before
func TestR2514UnstartedDayLetGoWhenNoLongerListed(t *testing.T) {
	f, _, m := pullBridge(t)
	r2514Other(true)
	pullDay(f, "20250915", 700, "Sales")
	pullDay(f, "20250916", 800, "Sales", "Sales", "Sales")
	ch := nowFn().UTC().Format(time.RFC3339)
	applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}))
	pullRun(t, 3)
	if w := pullCurrent(); w == nil || w.it.Company != r2514Co || w.began {
		t.Fatal("the closed company's day is not the one waiting")
	}
	applyPeriodDays(r2514Days(ch, [3]string{zz, b220CoGUID, "20250915"}))
	pull.mu.Lock()
	gone := pull.work == nil && len(pull.items) == 1 && pull.items[0].Company == zz
	pull.mu.Unlock()
	if !gone {
		t.Fatal("the day FinCom no longer names, not begun, is still kept")
	}
	pullRun(t, 20)
	if m.n["20250915"] != 1 {
		t.Fatalf("the listed day was not read: %v", m.n)
	}
	// a day begun (its list asked) and no longer named: kept and finished (2.4.5's rule)
	at := nowFn().Add(3 * time.Minute)
	nowFn = func() time.Time { return at }
	applyPeriodDays(r2514Days(ch, [3]string{zz, b220CoGUID, "20250916"}))
	if s, _ := pullStep(); !s {
		t.Fatal("the day's list did not go")
	}
	applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}))
	pullRun(t, 30)
	if m.n["20250916"] != 3 || len(m.held) != 4 {
		t.Fatalf("the day begun was not finished: %v, held %d", m.n, len(m.held))
	}
}

// 1c. a day begun whose company is then closed: what was read goes to FinCom, and after a minute the day is left so
// the other companies' days go on
func TestR2514BegunDayLeftWhenItsCompanyCloses(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250620", 1500, "Sales", "Sales", "Sales", "Sales")
	applyPeriodDays(pullList("20250620"))
	_, _ = pullStep() // the heads
	_, _ = pullStep() // told to FinCom
	if s, _ := pullStep(); !s || f.n(vchObjectID) != 1 {
		t.Fatalf("the start: %v", f.ids())
	}
	live.mu.Lock()
	liveFresh()
	live.own, live.ownCur = map[string]*liveOwnSt{}, map[string]bool{}
	live.mu.Unlock()
	_ = os.Remove(liveOwnTallyFile())
	n := len(f.ids())
	pullRun(t, 3)
	if w := pullCurrent(); w == nil || !w.began || w.it.Day != "20250620" {
		t.Fatal("left at once (a list a moment old must not cost the day)")
	}
	if len(m.held) != 1 {
		t.Fatalf("what was read did not go to FinCom: %d", len(m.held))
	}
	at := nowFn().Add(61 * time.Second)
	nowFn = func() time.Time { return at }
	pullRun(t, 3)
	pull.mu.Lock()
	_, done := pull.done[pullItem{Company: zz, CGUID: b220CoGUID, Day: "20250620"}.key()]
	left := pull.work == nil
	pull.mu.Unlock()
	if !left || !done || len(f.ids()) != n {
		t.Fatalf("after a minute: left %v, done %v, sent %v", left, done, f.ids()[n:])
	}
}

// 2. one company's own refusal: its own hand-out says it (a started one too); another company's hand-out that still
// showed a reason common to every book now says it waits its turn; a hold of every book never un-starts a hand-out
func TestR2514PickNoStaleStateAcrossCompanies(t *testing.T) {
	_, _, _ = pullBridge(t)
	r2514Other(true)
	ch := nowFn().UTC().Format(time.RFC3339)
	applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}, [3]string{zz, b220CoGUID, "20250915"}))
	a, b := pullItem{Company: r2514Co, CGUID: r2514GUID, Kind: "period", ChosenAt: ch, Day: "20250910"}, pullItem{Company: zz, CGUID: b220CoGUID, Kind: "period", ChosenAt: ch, Day: "20250915"}
	pickRefused(a, "typing")
	by := r2514AcksBy()
	if str(by[r2514Co]["code"]) != "typing" || str(by[zz]["code"]) != "typing" {
		t.Fatalf("a hold of every book: %v", by)
	}
	pickRefused(a, "notOpen")
	by = r2514AcksBy()
	if str(by[r2514Co]["code"]) != "notOpen" {
		t.Fatalf("the company's own reason: %v", by)
	}
	if c := str(by[zz]["code"]); c != "queued" || str(by[zz]["words"]) != pickWords["queued"] {
		t.Fatalf("the other company still shows an old reason: %v", by[zz])
	}
	// the other company's own reason is its own: untouched by this company's
	pickRefused(b, "slow")
	pickRefused(a, "noStart")
	if by = r2514AcksBy(); str(by[zz]["code"]) != "slow" || str(by[r2514Co]["code"]) != "noStart" {
		t.Fatalf("each company's own reason: %v", by)
	}
	// started, then its company closed: said refused; a hold of every book leaves a started hand-out started
	pickStarted(b)
	pickRefused(b, "typing")
	if by = r2514AcksBy(); str(by[zz]["state"]) != "started" {
		t.Fatalf("a passing hold un-started it: %v", by[zz])
	}
	pickRefused(b, "notOpen")
	if by = r2514AcksBy(); str(by[zz]["state"]) != "refused" || str(by[zz]["code"]) != "notOpen" || str(by[r2514Co]["code"]) != "queued" { // (the other company's "typing" of a moment ago: now its turn)
		t.Fatalf("started, then closed: %v", by)
	}
	pickStarted(b)
	if by = r2514AcksBy(); str(by[zz]["state"]) != "started" {
		t.Fatalf("open again: %v", by[zz])
	}
}

// 3. Tally answers with an envelope and no group: not a list. Nothing saved for sending, the reason in plain words;
// the same for a round whose every chunk named no ledger; once Tally gives its masters the read is whole
func TestR2514EmptyMastersAnswerIsNotARead(t *testing.T) {
	c := newStandCloud(t)
	f := ledgerTally(t, 30, c.cfg())
	noteCompanyGUID(zz, f.guid)
	dir, _ := companyDir(zz)
	grp := f.grp
	f.mu.Lock()
	f.grp = [][2]string{} // an envelope with no group
	f.mu.Unlock()
	err := newRun("now", "r1").step(zz, f.port, "")
	if err == nil || err.Error() != "Tally gave no masters for this company" {
		t.Fatalf("no group: %v", err)
	}
	if f.n(ledListID) != 0 || exists(ledOutFile(dir)) {
		t.Fatalf("the ledgers were read, or something waits to be sent, after an answer without groups: %v", f.ids())
	}
	f.mu.Lock()
	f.grp = grp
	f.mu.Unlock()
	if err := newRun("now", "r2").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if len(loadLedList(dir)) != 30 {
		t.Fatalf("the read once Tally gives its groups: %d ledgers", len(loadLedList(dir)))
	}
	out := readText(ledOutFile(dir))
	// 30 ledgers held, and a later round whose every chunk answers and names no ledger: not a list either
	f.mu.Lock()
	led := f.led
	f.led = nil
	f.mu.Unlock()
	err = newRun("now", "r3").step(zz, f.port, "")
	if err == nil || err.Error() != "Tally gave no masters for this company" {
		t.Fatalf("no ledger: %v", err)
	}
	if len(loadLedList(dir)) != 30 || readText(ledOutFile(dir)) != out {
		t.Fatal("an empty round replaced the list held, or queued its ledgers as gone")
	}
	f.mu.Lock()
	f.led = led
	f.mu.Unlock()
	if err := newRun("now", "r4").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if len(loadLedList(dir)) != 30 {
		t.Fatalf("the read after it: %d ledgers", len(loadLedList(dir)))
	}
}

// 4. linked in FinCom: the masters read is asked for; not again at a restart for a company linked long ago
func TestR2514LinkedStartsMastersRead(t *testing.T) {
	c := newStandCloud(t)
	f := ledgerTally(t, 5, c.cfg())
	noteCompanyGUID(zz, f.guid)
	if _, err := findCompanyPort(zz, 0); err != nil {
		t.Fatal(err)
	}
	var woke []string
	linkedWakeSeen = func(co string) { woke = append(woke, co) }
	t.Cleanup(func() { linkedWakeSeen = nil })
	ask := func() {
		cloudMu.Lock()
		updateCloudLinks()
		cloudMu.Unlock()
	}
	ask() // never seen here before: read
	if len(woke) != 1 || woke[0] != zz {
		t.Fatalf("a company linked for the first time: %v", woke)
	}
	ask() // still linked: nothing
	if len(woke) != 1 {
		t.Fatalf("asked again while linked: %v", woke)
	}
	// a restart (no link known in this run) of a company whose copy went long ago: nothing
	dir, _ := companyDir(zz)
	_ = os.MkdirAll(dir, 0o755)
	_ = saveFile(filepath.Join(dir, "cloud-all.done"), nowS())
	cloudMu.Lock()
	cloudLinks = map[string]bool{}
	cloudMu.Unlock()
	ask()
	if len(woke) != 1 {
		t.Fatalf("a restart read every linked company's masters: %v", woke)
	}
	// FinCom said "not linked" in this run, then linked: read
	cloudMu.Lock()
	cloudLinks = map[string]bool{zz: false}
	cloudMu.Unlock()
	ask()
	if len(woke) != 2 {
		t.Fatalf("linked while the bridge runs: %v", woke)
	}
	// the hook's own call: the ledgers-only run of that company, the words in the log
	linkedWakeSeen = nil
	if r := wakeLedgers(zz, "linked in FinCom", false); r["ok"] != true {
		t.Fatalf("the wake: %v", r)
	}
}

// 5. Update now says its progress too (ledger_progress, the round's end with the final count); the count itself (a
// request to Tally) stays the ledgers-only read's
func TestR2514ProgressForEveryRead(t *testing.T) {
	c := newStandCloud(t)
	var prog []M
	c.other = func(k string, b M) (int, M) {
		if k == "ledger_progress" {
			prog = append(prog, b)
		}
		return 200, M{"ok": true}
	}
	f := ledgerTally(t, 500, c.cfg()+`,"LedgerChunk":200,"LedgerChunkMin":50`) // small chunks: in time under -race too
	noteCompanyGUID(zz, f.guid)
	ledProg.mu.Lock()
	ledProg.last, ledProg.sent = map[string]M{}, map[string]time.Time{}
	ledProg.mu.Unlock()
	if err := newRun("now", "r1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	ledProgFlush()
	c.mu.Lock()
	ps := append([]M{}, prog...)
	c.mu.Unlock()
	if f.n(ledIdsID) != 0 {
		t.Fatalf("Update now asked Tally for the count: %v", f.ids())
	}
	if len(ps) < 2 {
		t.Fatalf("Update now's progress: %v", ps)
	}
	if p := ps[0]; toInt(p["read"]) <= 0 || toInt(p["of"]) != 0 || p["done"] == true || str(p["company"]) != zz {
		t.Fatalf("the first: %v", p)
	}
	if p := ps[len(ps)-1]; toInt(p["read"]) != 500 || toInt(p["of"]) != 500 || p["done"] != true || str(p["company_guid"]) != f.guid {
		t.Fatalf("the end: %v", p)
	}
	if b := ledProgressBeat(); len(b) != 1 || obj(b[0])["done"] != true {
		t.Fatalf("the beat: %v", b)
	}
}

// 6. HTTP 503: busy. The bridge's own words (never the body's "key is not valid"), the key kept, nothing sent during the
// wait (5 s, then 10 s ...; the cloud's Retry-After when longer, 120 s at most), the first other answer ends it; a day
// whose list FinCom answered 503 to is kept and sent again
func TestR2514CloudBusy503(t *testing.T) {
	f, c, m := pullBridge(t)
	key := cloudKey()
	busy := 2
	c.mu.Lock()
	prev := c.other
	c.other = func(k string, b M) (int, M) {
		if busy > 0 {
			busy--
			return 503, M{"ok": false, "busy": true, "retry": true, "error": "This computer's key is not valid any more. Connect it again from FinCom."}
		}
		return prev(k, b)
	}
	c.mu.Unlock()
	pullDay(f, "20250915", 700, "Sales")
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 5)
	n := c.count("period_heads")
	if n != 1 {
		t.Fatalf("period_heads calls: %d", n)
	}
	w := pullCurrent()
	if w == nil || w.it.Day != "20250915" || !w.cloudWait.After(nowFn()) {
		t.Fatal("the day was dropped (or does not wait) after a 503")
	}
	r := invokeCloud(M{"kind": "period_stop"}, 5)
	if r.code != 503 || r.err != cloudBusyWords || strings.Contains(strings.ToLower(r.err), "key") || c.count("period_stop") != 0 {
		t.Fatalf("a call during the wait: %v (sent %d)", r, c.count("period_stop"))
	}
	if cloudKey() != key || !cloudOn() {
		t.Fatal("the pairing was touched")
	}
	if d := cloudBusyLeft(); d <= 0 || d > 5*time.Second {
		t.Fatalf("the first wait: %s", d)
	}
	// a 503 of a call that went before the wait began (side by side): no second step
	cloudBusyNote("")
	cloudBusyNote("")
	if d := cloudBusyLeft(); d <= 0 || d > 5*time.Second {
		t.Fatalf("calls side by side grew the wait: %s", d)
	}
	step := func(d time.Duration) {
		at := nowFn().Add(d)
		nowFn = func() time.Time { return at }
	}
	step(6 * time.Second)
	if r := invokeCloud(M{"kind": "period_stop"}, 5); r.code != 503 || c.count("period_stop") != 1 {
		t.Fatalf("after the wait: %v", r)
	}
	if d := cloudBusyLeft(); d <= 5*time.Second || d > 10*time.Second {
		t.Fatalf("the second wait: %s", d)
	}
	step(11 * time.Second)
	if r := invokeCloud(M{"kind": "period_stop"}, 5); r.code != 200 || cloudBusyLeft() != 0 {
		t.Fatalf("answering again: %v", r)
	}
	step(time.Minute)
	pullRun(t, 20)
	if m.n["20250915"] != 1 || len(m.held) != 1 {
		t.Fatalf("the day after the cloud answered again: %v, held %d", m.n, len(m.held))
	}
	// the cloud's own Retry-After
	cloudBusyNote("90")
	if d := cloudBusyLeft(); d != 90*time.Second {
		t.Fatalf("Retry-After 90: %s", d)
	}
	cloudBusyClear()
	cloudBusyNote("100000")
	if d := cloudBusyLeft(); d != 120*time.Second {
		t.Fatalf("Retry-After capped: %s", d)
	}
	// the heartbeat goes during the wait; its answer ends the wait for every call (postings at once)
	c.mu.Lock()
	c.kinds = nil
	c.mu.Unlock()
	beatOnce()
	if c.count("beat") != 1 || cloudKey() != key || cloudBusyLeft() != 0 || beatBusy.Load() {
		t.Fatalf("the beat during the wait: %d sent, wait %s", c.count("beat"), cloudBusyLeft())
	}
	if r := invokeCloud(M{"kind": "period_stop"}, 5); r.code != 200 {
		t.Fatalf("a call after the beat answered: %v", r)
	}
	// the heartbeat answered busy: its next try within 30 s, whatever the back-off had grown to
	beatBusy.Store(true)
	if d := beatBusyPause(time.Minute); d != 30*time.Second {
		t.Fatalf("the beat waits %s while the cloud is busy", d)
	}
	beatBusy.Store(false)
	if d := beatBusyPause(time.Minute); d != time.Minute {
		t.Fatalf("not busy: %s", d)
	}
	cloudBusyClear()
}

// 6b. a 503 that is not "busy" (notReady: a cloud without a migration yet; index.ts) is an answer as before 2.5.14: its
// body and words reach the caller, and nothing else waits; a 503 with no body of its own (a gateway's) is busy
func TestR2514Cloud503NotReadyIsNotBusy(t *testing.T) {
	_, c, _ := pullBridge(t)
	reply := M{"ok": false, "notReady": true, "error": "FinCom's cloud is not ready for this yet."}
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) { return 503, reply }
	c.mu.Unlock()
	r := invokeCloud(M{"kind": "period_stop"}, 5)
	if r.code != 503 || r.json == nil || !truthy(r.json["notReady"]) || r.err != str(reply["error"]) || cloudBusyLeft() != 0 {
		t.Fatalf("notReady: %+v, wait %s", r, cloudBusyLeft())
	}
	if r := invokeCloud(M{"kind": "period_stop"}, 5); r.code != 503 || c.count("period_stop") != 2 {
		t.Fatalf("the next call was held after a notReady: %+v", r)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(503)
		_, _ = w.Write([]byte("<html>Service Unavailable</html>"))
	}))
	defer srv.Close()
	old := cfgS("CloudUrl")
	setCfg("CloudUrl", srv.URL)
	defer setCfg("CloudUrl", old)
	if r := invokeCloud(M{"kind": "period_stop"}, 5); r.code != 503 || r.err != cloudBusyWords || cloudBusyLeft() <= 0 {
		t.Fatalf("a gateway's 503: %+v", r)
	}
	cloudBusyClear()
}

// 7. (as the independent review of 9d546dcb1 asked) Tally is asked with the company's name exactly as its own company list
// gave it, edge characters and all; a name that came cleaned from FinCom's cloud is put back to Tally's spelling; FinCom's
// cloud is told the name cleaned (coTrim); the bridge matches on the cleaned name. A clean name: byte for byte as before
func TestR2514CompanyNameRawToTallyCleanToCloud(t *testing.T) {
	if companyKey("\x04Made Up Traders \r\n") != companyKey("made up traders") || !sameCompany(" Made Up Traders\r\n", "Made Up Traders") {
		t.Error("the bridge's own matching does not use the cleaned name")
	}
	const d = "20250915"
	raw, clean := " \x04Made  Up & Co \u00a0", "Made  Up & Co"
	build := func(co string) map[string]string {
		return map[string]string{
			"FinComDayHeads":       dayHeadsRequest(co, d),
			"FinComLedgers":        ledgerChunkRequestAt(co, "20250401", 0, 2000),
			"FinComGroups":         groupListRequest(co),
			"FinComLedgerIds":      ledgerIdsRequest(co, 0, 0),
			"Day Book":             dayBookRequestForm(co, "", d, d),
			"TDSDeskVchHeads":      vchHeadsRequest(co, d, d),
			"TDSDeskKeepList":      keepListAboveRequest(co, 5),
			"FinComVoucherObject":  voucherObjectRequest(co, "77"),
			"FinComCompanyNumbers": companyNumbersRequest(co),
			"FinComCompany":        companyCheckRequest(co),
			"TDSDeskCompanyInfo":   coInfoRequest(co),
			"the import":           importEnvelope("Vouchers", co, "<X/>"),
		}
	}
	old := tallyNames.Load()
	t.Cleanup(func() { tallyNames.Store(old) })
	// before any company list: every name as it came
	tallyNames.Store(nil)
	before := build(clean)
	// Tally's list names the company with edge characters: asked with them, byte for byte, whichever spelling asks
	noteTallyNames([]M{{"ok": true, "companies": []any{M{"name": raw}}}})
	for _, co := range []string{raw, clean, "made up & co"} {
		for id, x := range build(co) {
			if pinCo(x) != raw || !strings.Contains(x, "<SVCURRENTCOMPANY>"+esc(raw)+"</SVCURRENTCOMPANY>") {
				t.Errorf("%s asked as %q: the company sent %q", id, co, pinCo(x))
			}
		}
	}
	for _, id := range []string{"FinComCompany", "FinComCompanyNumbers", "TDSDeskCompanyInfo"} {
		if x := build(clean)[id]; !strings.Contains(x, esc(`$Name = "`+raw+`"`)) && !strings.Contains(x, `$Name = "`+esc(raw)+`"`) {
			t.Errorf("%s: its own name filter is not Tally's spelling: %s", id, x)
		}
	}
	// a clean name Tally gives as it is: every request exactly as built before the list (2.5.13's builders)
	noteTallyNames([]M{{"ok": true, "companies": []any{M{"name": clean}}}})
	for id, x := range build(clean) {
		if x != before[id] {
			t.Errorf("%s: a clean name's request changed", id)
		}
	}
	// two spellings listed: neither is guessed
	noteTallyNames([]M{{"ok": true, "companies": []any{M{"name": raw}, M{"name": clean + " "}}}})
	if g := tallyCo("Made  Up & Co"); g != "Made  Up & Co" {
		t.Errorf("two spellings: %q", g)
	}
	// to FinCom's cloud: cleaned, the caller's body untouched
	c := newStandCloud(t)
	f := newStandTally(t)
	standBridge(t, f, c.cfg())
	body := M{"kind": "period_stop", "company": raw, "open": []any{raw}, "companies": []any{M{"name": raw, "guid": "g"}}}
	invokeCloud(body, 5)
	c.mu.Lock()
	sent := parseObj(c.raw[len(c.raw)-1])
	c.mu.Unlock()
	if str(sent["company"]) != clean || str(arr(sent["open"])[0]) != clean || str(obj(arr(sent["companies"])[0])["name"]) != clean || str(obj(arr(sent["companies"])[0])["guid"]) != "g" {
		t.Fatalf("to the cloud: %v", sent)
	}
	if body["company"] != raw || arr(body["open"])[0] != raw || obj(arr(body["companies"])[0])["name"] != raw {
		t.Fatalf("the caller's body was changed: %v", body)
	}
}

// 7b. end to end: Tally lists "ZZ TEST" with edge spaces; FinCom hands out the day under the cleaned name. Tally is asked
// with its own spelling, FinCom is told the cleaned one, and the link FinCom answers is held under both
func TestR2514RawNameDayPullEndToEnd(t *testing.T) {
	f, c, m := pullBridge(t)
	rawZZ := "  " + zz + " \u00a0"
	f.mu.Lock()
	f.coName = rawZZ
	f.mu.Unlock()
	openCompanies(true)
	if g := tallyCo(zz); g != rawZZ {
		t.Fatalf("Tally's spelling not held from its list: %q", g)
	}
	pullDay(f, "20250915", 700, "Sales")
	applyPeriodDays(pullList("20250915"))
	n0 := len(f.ids())
	pullRun(t, 20)
	if m.n["20250915"] != 1 || len(m.held) != 1 {
		t.Fatalf("the day was not read: %v %d (%v)", m.n, len(m.held), f.ids()[n0:])
	}
	f.mu.Lock()
	bodies := append([]string{}, f.bodies[n0:]...)
	f.mu.Unlock()
	for _, b := range bodies {
		if co := pinCo(b); co != "" && co != rawZZ {
			t.Fatalf("Tally asked for %q, not its own %q", co, rawZZ)
		}
	}
	for _, h := range m.heads {
		if str(h["company"]) != zz {
			t.Fatalf("FinCom told %q", str(h["company"]))
		}
	}
	cloudMu.Lock()
	cloudLinks = map[string]bool{}
	updateCloudLinks()
	on := cloudLinks[rawZZ] && cloudLinks[zz]
	cloudMu.Unlock()
	c.mu.Lock()
	var cos []any
	for i := len(c.kinds) - 1; i >= 0; i-- {
		if c.kinds[i] == "companies" {
			cos = arr(parseObj(c.raw[i])["companies"])
			break
		}
	}
	c.mu.Unlock()
	if !on || len(cos) == 0 || str(obj(cos[0])["name"]) != zz {
		t.Fatalf("the links: held %v, sent %v", on, cos)
	}
}

// 5b. the cleaning rule is the cloud's coTrim, case for case (tests/fixtures/cotrim-cases.json); with node here, the
// cloud's own function is run on the same cases
func TestR2514CoTrimParity(t *testing.T) {
	fx := filepath.Join("..", "tests", "fixtures", "cotrim-cases.json")
	var f struct {
		Cases []struct{ In, Out, Why string }
	}
	if err := json.Unmarshal([]byte(readText(fx)), &f); err != nil || len(f.Cases) < 10 {
		t.Fatalf("%s: %v (%d cases)", fx, err, len(f.Cases))
	}
	for _, c := range f.Cases {
		if g := coTrim(c.In); g != c.Out {
			t.Errorf("%s: %q gives %q, the cloud keeps %q", c.Why, c.In, g, c.Out)
		}
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Log("node not here: the cloud's own function not run (the cases above still hold)")
		return
	}
	lk, _ := filepath.Abs(filepath.Join("..", "server", "tally-cloud", "linknow.js"))
	af, _ := filepath.Abs(fx)
	js := `import(` + jsonText(lk) + `).then(async (m) => { const f = JSON.parse((await import("fs")).readFileSync(` + jsonText(af) +
		`, "utf8")); const bad = f.cases.filter((c) => m.coTrim(c.in) !== c.out).map((c) => c.why); console.log(JSON.stringify({ n: f.cases.length, bad })); })`
	out, err := exec.Command(node, "--input-type=module", "-e", js).Output()
	if err != nil {
		t.Fatalf("node: %v", err)
	}
	r := parseObj(strings.TrimSpace(string(out)))
	if toInt(r["n"]) != len(f.Cases) || len(arr(r["bad"])) != 0 {
		t.Fatalf("the cloud's coTrim: %s", out)
	}
}

// 1d. (the independent review of 9d546dcb1) a day is begun under the lock before its first request: the heartbeat that
// no longer lists it lets it go only before; a day let go sends nothing; begun, it is kept and finished
func TestR2514BeginBeforeSend(t *testing.T) {
	f, _, m := pullBridge(t)
	r2514Other(true)
	pullDay(f, "20250915", 700, "Sales")
	ch := nowFn().UTC().Format(time.RFC3339)
	applyPeriodDays(r2514Days(ch, [3]string{zz, b220CoGUID, "20250915"}))
	w := pullCurrent()
	// the heartbeat drops the day between the loop taking it and its first request: nothing is sent for it
	applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}))
	if pullBegin(w) {
		t.Fatal("a day let go was begun")
	}
	// begun first: the heartbeat that no longer lists it keeps it, and it is finished
	at := nowFn().Add(3 * time.Minute)
	nowFn = func() time.Time { return at }
	applyPeriodDays(r2514Days(ch, [3]string{zz, b220CoGUID, "20250915"}))
	w = pullCurrent()
	if w == nil || !pullBegin(w) {
		t.Fatal("not begun")
	}
	applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250910"}))
	if pullCurrent() != w {
		t.Fatal("a begun day was let go")
	}
	pullRun(t, 20)
	if m.n["20250915"] != 1 || len(m.held) != 1 {
		t.Fatalf("the begun day was not finished: %v %d", m.n, len(m.held))
	}
}

// 1e. the heartbeat and the loop side by side (run with -race): the loop's steps and the beat's lists of days
func TestR2514BeatAndLoopSideBySide(t *testing.T) {
	f, _, _ := pullBridge(t)
	r2514Other(true)
	for i := 0; i < 6; i++ {
		pullDay(f, fmt.Sprintf("202509%02d", 10+i), int64(700+10*i), "Sales")
	}
	ch := nowFn().UTC().Format(time.RFC3339)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			if i%2 == 0 {
				applyPeriodDays(r2514Days(ch, [3]string{zz, b220CoGUID, fmt.Sprintf("202509%02d", 10+i%6)}, [3]string{r2514Co, r2514GUID, "20250901"}))
			} else {
				applyPeriodDays(r2514Days(ch, [3]string{r2514Co, r2514GUID, "20250901"}))
			}
			_ = pullBeat()
		}
	}()
	for i := 0; i < 300; i++ {
		_, _ = pullStep()
	}
	close(stop)
	wg.Wait()
}

// 8. the nightly check: FinCom's cloud busy (503) does not end the night's check. It is tried again 10 minutes later
// (nothing asked of Tally meanwhile), six times a night at most; an answer then: checked and recorded as any night
func TestR2514SelfCheckRetriesAfterBusy(t *testing.T) {
	f, c := scBridge(t, "")
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	busy := true
	c.mu.Lock()
	c.scReply = func(b M) (int, M) {
		if busy {
			return 503, M{"ok": false, "busy": true, "retry": true}
		}
		if str(b["step"]) == "compare" {
			return 200, M{"ok": true, "received": 1, "missing": []any{}}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	at := nowFn()
	r, err := selfCheckStart(zz, f.port)
	if r != nil || err == nil || !strings.Contains(err.Error(), "busy; tried again at") || strings.Contains(err.Error(), "not ready") {
		t.Fatalf("the first try: %v %v", r, err)
	}
	st := scState(zz, b220CoGUID)
	if str(st["night"]) != "" || toInt(st["busyN"]) != 1 || toInt(st["tries"]) != 0 {
		t.Fatalf("the night was given up (or counted as a failed try): %v", st)
	}
	n := scN(f)
	for _, d := range []time.Duration{time.Second, 9 * time.Minute} {
		scAt(t, at.Add(d))
		if r, err := selfCheckStart(zz, f.port); r != nil || err != nil || scN(f) != n || selfCheckBlocked(zz, b220CoGUID) != scBusyWords {
			t.Fatalf("asked again %s after a busy answer: %v %v", d, err, f.ids()[n:])
		}
	}
	// 10 minutes on: tried again; the cloud answers: the night's check is made and recorded
	busy = false
	scAt(t, at.Add(10*time.Minute+time.Second))
	r, err = selfCheckStart(zz, f.port)
	if err != nil || r == nil {
		t.Fatalf("the retry: %v %v", r, err)
	}
	if err := selfCheckFinish(r); err != nil {
		t.Fatal(err)
	}
	if st := scState(zz, b220CoGUID); str(st["night"]) != "20261006" || len(scSteps(c, "record")) != 1 {
		t.Fatalf("not recorded after the retry: %v", st)
	}
	// busy all night: six tries, 10 minutes apart, then the night is left; the mark does not move
	f2, c2 := scBridge(t, "")
	f2.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f2)
	c2.mu.Lock()
	c2.scReply = func(M) (int, M) { return 503, M{"ok": false, "busy": true, "retry": true} }
	c2.mu.Unlock()
	at = nowFn()
	tries := 0
	for i := 0; i < 12; i++ {
		scAt(t, at.Add(time.Duration(i)*(10*time.Minute+time.Second)))
		if _, err := selfCheckStart(zz, f2.port); err != nil {
			tries++
		}
	}
	st = scState(zz, b220CoGUID)
	if tries != scBusyTries || len(scSteps(c2, "compare")) != scBusyTries || str(st["night"]) != "20261006" || st["mark"] != nil {
		t.Fatalf("busy all night: %d tries, %d calls, %v", tries, len(scSteps(c2, "compare")), st)
	}
}

// 8b. a 503 that says notReady (a cloud without the nightly check yet): the night's check stops for the night, as
// before 2.5.14; nothing is retried tonight
func TestR2514SelfCheckNotReadyStopsTheNight(t *testing.T) {
	f, c := scBridge(t, "")
	f.add("20261006", "Party B", "2", "", "50.00")
	led231Numbers(t, f)
	c.mu.Lock()
	c.scReply = func(M) (int, M) { return 503, M{"ok": false, "notReady": true, "error": "not ready"} }
	c.mu.Unlock()
	r, err := selfCheckStart(zz, f.port)
	if r != nil || err == nil || !strings.Contains(err.Error(), "not ready for the nightly check") {
		t.Fatalf("notReady: %v %v", r, err)
	}
	if st := scState(zz, b220CoGUID); str(st["night"]) != "20261006" || st["busyN"] != nil || cloudBusyLeft() != 0 {
		t.Fatalf("notReady was taken as busy: %v", st)
	}
	scAt(t, nowFn().Add(11*time.Minute))
	if r, _ := selfCheckStart(zz, f.port); r != nil || len(scSteps(c, "compare")) != 1 {
		t.Fatal("tried again the same night after notReady")
	}
}
