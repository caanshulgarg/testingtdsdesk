// next-fix-mastersread: the first read of a linked company's masters (made-up companies only)
//  1. Tally's own error to the group list or a ledger part is an error with Tally's words (never "no masters")
//  2. a read with no masters (errNoMasters, Tally's error) ends its round at 0 of 0 with the reason; kept on the company
//  6. one more read on the light check while the company is open in this user's own Tally and FinCom holds none
//  7. the "ledgers" wake of a linked company never read here starts its first read (Update from Tally of it)
//  8. the daily catch-up: once a day by day, at a quiet moment, for the linked companies open in this user's own Tally
//  9. every read says its start (ledger_progress at 0) before the first part
package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const mrWords = "Could not set &apos;SVCurrentCompany&apos; to &apos;ZZ TEST&apos;"

func mrLineError(ids ...string) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if contains(ids, id) {
			_, _ = w.Write([]byte("<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DATA><LINEERROR>" + mrWords + "</LINEERROR></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
}

func mrProg(c *standCloud) *[]M {
	var prog []M
	c.other = func(k string, b M) (int, M) {
		if k == "ledger_progress" {
			prog = append(prog, b)
		}
		return 200, M{"ok": true}
	}
	ledProg.mu.Lock()
	ledProg.last, ledProg.sent = map[string]M{}, map[string]time.Time{}
	ledProg.mu.Unlock()
	return &prog
}

func mrProgs(c *standCloud, p *[]M) []M {
	ledProgFlush()
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]M{}, (*p)...)
}

// 1, 2: the group list answered with Tally's error
func TestMastersReadGroupListTallyError(t *testing.T) {
	c := newStandCloud(t)
	prog := mrProg(c)
	f := ledgerTally(t, 20, c.cfg())
	noteCompanyGUID(zz, f.guid)
	f.mu.Lock()
	f.behave = mrLineError(grpListID)
	f.mu.Unlock()
	err := newRun("now", "r1").step(zz, f.port, "")
	if !errors.Is(err, errTallySaid) || !strings.Contains(err.Error(), "Could not set 'SVCurrentCompany' to 'ZZ TEST'") || !strings.Contains(err.Error(), "group list") {
		t.Fatalf("Tally's own words lost: %v", err)
	}
	if errors.Is(err, errNoMasters) || f.n(ledListID) != 0 {
		t.Fatalf("read on after Tally's error: %v %v", err, f.ids())
	}
	st := keepStateOf(zz)
	if mf := obj(st["mastersFail"]); str(mf["why"]) != err.Error() || toInt(mf["n"]) != 1 {
		t.Fatalf("the failure kept on the company: %v", st["mastersFail"])
	}
	ps := mrProgs(c, prog)
	last := ps[len(ps)-1]
	if last["done"] != true || toInt(last["read"]) != 0 || toInt(last["of"]) != 0 || !strings.Contains(str(last["why"]), "SVCurrentCompany") {
		t.Fatalf("the round's end at 0 of 0 with the reason: %v", ps)
	}
	// the company's trouble (as the keep loop says it) carries the words to FinCom's cloud
	setKeepTrouble(zz, err.Error())
	if !strings.Contains(str(obj(keepStateOf(zz)["trouble"])["why"]), "SVCurrentCompany") {
		t.Fatalf("trouble: %v", keepStateOf(zz)["trouble"])
	}
	// the same reason again: counted; then Tally gives its masters: the failure goes
	if err := newRun("now", "r2").step(zz, f.port, ""); !errors.Is(err, errTallySaid) || toInt(obj(keepStateOf(zz)["mastersFail"])["n"]) != 2 {
		t.Fatalf("the second failure: %v %v", err, keepStateOf(zz)["mastersFail"])
	}
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	if err := newRun("now", "r3").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if keepStateOf(zz)["mastersFail"] != nil || len(loadLedList(syncFolder(zz))) != 20 {
		t.Fatalf("read in full: %v", keepStateOf(zz)["mastersFail"])
	}
}

// 1: a ledger part answered with Tally's error: not halved, not marked, Tally's words
func TestMastersReadLedgerPartTallyError(t *testing.T) {
	c := newStandCloud(t)
	f := ledgerTally(t, 20, c.cfg())
	noteCompanyGUID(zz, f.guid)
	f.mu.Lock()
	f.behave = mrLineError(ledListID)
	f.mu.Unlock()
	err := newRun("now", "r1").step(zz, f.port, "")
	if !errors.Is(err, errTallySaid) || !strings.Contains(err.Error(), "SVCurrentCompany") || !strings.Contains(err.Error(), "ledger list") {
		t.Fatalf("Tally's own words lost: %v", err)
	}
	if st := keepStateOf(zz); len(poisonMids(st)) != 0 || toInt(st["ledSize"]) != 0 && toInt(st["ledSize"]) < ledChunkDefault() {
		t.Fatalf("a Tally error halved or marked the part: %v", st)
	}
}

// 2: no group at all: the round's end at 0 of 0 with the reason, as the bridge says it
func TestMastersReadNoMastersSaysEnd(t *testing.T) {
	c := newStandCloud(t)
	prog := mrProg(c)
	f := ledgerTally(t, 5, c.cfg())
	noteCompanyGUID(zz, f.guid)
	f.mu.Lock()
	f.grp = [][2]string{}
	f.mu.Unlock()
	if err := newRun("now", "r1").step(zz, f.port, ""); !errors.Is(err, errNoMasters) {
		t.Fatal(err)
	}
	ps := mrProgs(c, prog)
	if len(ps) < 2 {
		t.Fatalf("progress: %v", ps)
	}
	// 9: the start first (0, not done), then the end
	if p := ps[0]; p["done"] == true || toInt(p["read"]) != 0 || str(p["company"]) != zz || str(p["round"]) == "" {
		t.Fatalf("the read's start: %v", p)
	}
	if p := ps[len(ps)-1]; p["done"] != true || toInt(p["read"]) != 0 || str(p["why"]) != errNoMasters.Error() || str(p["round"]) != str(ps[0]["round"]) {
		t.Fatalf("the read's end: %v", ps)
	}
}

func mrSetup(t *testing.T) (*standCloud, *standTally) {
	c := newStandCloud(t)
	f := ledgerTally(t, 5, c.cfg()+`,"KeepInStep":true`)
	noteCompanyGUID(zz, f.guid)
	holdLinks(map[string]bool{zz: true})
	t.Cleanup(func() { holdLinks(map[string]bool{}) })
	mrMu.Lock()
	mrAt, mrTold = map[string]time.Time{}, map[string]string{}
	mrMu.Unlock()
	own, start := mrOwnTally, mrStart
	mrOwnTally = func(string, int) string { return "" }
	t.Cleanup(func() { mrOwnTally, mrStart = own, start })
	return c, f
}

// 6: one more read on the light check; at most once in 10 minutes; not while typing; not after 3 failures in a row
func TestMastersRetryOnLightCheck(t *testing.T) {
	_, f := mrSetup(t)
	var asked []runReq
	mrStart = func(r runReq) bool { asked = append(asked, r); return true }
	// a company with no failed read: nothing
	if mastersRetryAfterLightCheck(zz, f.port) || len(asked) != 0 {
		t.Fatalf("asked with no failed read: %v", asked)
	}
	f.mu.Lock()
	f.behave = mrLineError(grpListID)
	f.mu.Unlock()
	_ = newRun("now", "r1").step(zz, f.port, "")
	keepReleaseLeases() // (as the run's end does)
	// typing in Tally: not now
	typing := keepTypingFn
	keepTypingFn = func() bool { return true }
	if mastersRetryAfterLightCheck(zz, f.port) {
		t.Fatal("asked while someone types")
	}
	keepTypingFn = typing
	// not open in this user's own Tally: not now
	mrOwnTally = func(string, int) string { return "the company is not open in this bridge's own Tally" }
	if mastersRetryAfterLightCheck(zz, f.port) {
		t.Fatal("asked with the company not open in the own Tally")
	}
	mrOwnTally = func(string, int) string { return "" }
	if !mastersRetryAfterLightCheck(zz, f.port) || len(asked) != 1 {
		t.Fatalf("not asked: %v", asked)
	}
	if r := asked[0]; r.kind != "now" || !r.short || r.day || len(r.only) != 1 || r.only[0] != zz {
		t.Fatalf("the run: %+v", r)
	}
	// 10 minutes
	if mastersRetryAfterLightCheck(zz, f.port) || len(asked) != 1 {
		t.Fatal("asked again within 10 minutes")
	}
	mrMu.Lock()
	mrAt[companyKey(zz)] = time.Now().Add(-11 * time.Minute)
	mrMu.Unlock()
	if !mastersRetryAfterLightCheck(zz, f.port) || len(asked) != 2 {
		t.Fatal("not asked 11 minutes on")
	}
	// three more failures with the same reason (4 in a row): no more
	for i := 2; i <= 4; i++ {
		_ = newRun("now", "r"+string(rune('0'+i))).step(zz, f.port, "")
	}
	keepReleaseLeases()
	mrMu.Lock()
	mrAt[companyKey(zz)] = time.Now().Add(-11 * time.Minute)
	mrMu.Unlock()
	if why := mastersRetryWhyNot(zz, f.port); !strings.Contains(why, "4 reads in a row") {
		t.Fatalf("why not: %q", why)
	}
	// masters held (read in full): nothing
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	if err := newRun("now", "r9").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if why := mastersRetryWhyNot(zz, f.port); why != "no failed masters read" {
		t.Fatalf("why not, read in full: %q", why)
	}
}

// 6: the run nobody pressed: every request under the 2 s stop, the company check too
func TestMastersShortRunUnderStop(t *testing.T) {
	k := &keepRun{tc: &TC{copier: true, readSec: 120}, short: true}
	if k.checkTC().limitMs != recorderLimitMs() || k.checkTC().limitMs <= 0 {
		t.Fatalf("the company check of a short run: %+v", k.checkTC())
	}
	if (&keepRun{tc: &TC{copier: true, readSec: 120}}).checkTC().limitMs != 0 {
		t.Fatal("a pressed run's check under the stop")
	}
}

// 7: the "ledgers" wake of a linked company never read here: its first read now
func TestMastersWakeNeverReadLinked(t *testing.T) {
	_, _ = mrSetup(t)
	ks, _ := filepath.Glob(filepath.Join(syncFolder(zz), "keep.json*"))
	for _, p := range ks {
		_ = os.Remove(p)
	}
	if keepStateOf(zz) != nil {
		t.Fatal("the company is kept here already")
	}
	r := wakeLedgers(zz, "the ledger chooser opened in FinCom", false)
	if r["started"] != true || r["now"] != true {
		t.Fatalf("a linked company never read: %v", r)
	}
	for keepRunning() {
		time.Sleep(50 * time.Millisecond)
	}
	if st := keepStateOf(zz); st == nil || str(st["ledAt"]) == "" {
		t.Fatalf("its first read did not read the masters: %v", st)
	}
	// not linked: refused as before
	holdLinks(map[string]bool{})
	if r := wakeLedgers("ZZ OTHER", "x", false); r["started"] == true || !strings.Contains(str(r["why"]), "not kept") {
		t.Fatalf("a company not linked: %v", r)
	}
}

// 8: the daily catch-up
func TestDailyCatchUp(t *testing.T) {
	_, _ = mrSetup(t)
	var asked []runReq
	dcStart = func(r runReq) bool { asked = append(asked, r); return true }
	open := dcOwnOpen
	dcOwnOpen = func() []string { return []string{zz, "ZZ NOT LINKED"} }
	t.Cleanup(func() { dcStart, dcOwnOpen = func(r runReq) bool { return startKeepRun(r) }, open })
	dcMu.Lock()
	dcTried, dcAt = map[string]time.Time{}, time.Time{}
	dcMu.Unlock()
	day := time.Date(2026, 11, 18, 11, 0, 0, 0, time.Local) // a Wednesday, office hours
	nowWas := nowFn
	nowFn = func() time.Time { return day }
	t.Cleanup(func() { nowFn = nowWas })
	// FinCom used a moment ago: not now
	noteUse()
	ownWas := ownUseAt
	if dayCatchCheck() || len(asked) != 0 {
		t.Fatalf("started while FinCom is in use: %v", asked)
	}
	evMu.Lock()
	ownUseAt, cloudUseAt = day.Add(-5*time.Minute), time.Time{}
	evMu.Unlock()
	t.Cleanup(func() { evMu.Lock(); ownUseAt = ownWas; evMu.Unlock() })
	// someone typing: not now
	typing := keepTypingFn
	keepTypingFn = func() bool { return true }
	dcMu.Lock()
	dcAt = time.Time{}
	dcMu.Unlock()
	if dayCatchCheck() {
		t.Fatal("started while someone types")
	}
	keepTypingFn = typing
	dcMu.Lock()
	dcAt = time.Time{}
	dcMu.Unlock()
	if !dayCatchCheck() || len(asked) != 1 {
		t.Fatalf("not started at a quiet moment: %v", asked)
	}
	if r := asked[0]; r.kind != "nightly" || !r.day || !r.short || r.night != "" || len(r.only) != 1 || r.only[0] != zz {
		t.Fatalf("the run: %+v", r)
	}
	// tried a moment ago: not again for 30 minutes; done today: not again today
	day = day.Add(time.Minute)
	if dayCatchCheck() || len(asked) != 1 {
		t.Fatal("started again a minute on")
	}
	dayCheckNote(zz, false, "Tally gave no masters for this company")
	if m := dayCheckOf(zz); m == nil || truthy(m["ok"]) || str(m["why"]) == "" {
		t.Fatalf("the day's reason: %v", m)
	}
	day = day.Add(31 * time.Minute)
	if !dayCatchCheck() || len(asked) != 2 {
		t.Fatal("not tried again 30 minutes on")
	}
	dayCheckNote(zz, true, "")
	dayCheckNote(zz, false, "later failure")
	if !dayCheckDone(zz) {
		t.Fatal("a day done was undone by a later failure")
	}
	day = day.Add(31 * time.Minute)
	if dayCatchCheck() || len(asked) != 2 {
		t.Fatal("started again on a day done")
	}
	// the night's window: the nightly catch-up's own (never this)
	day = time.Date(2026, 11, 18, 21, 0, 0, 0, time.Local)
	if why := dayCatchWhyNot(day); why == "" {
		t.Fatal("the daily catch-up ran in the night's window")
	}
}

// 8: a full read (Update from Tally) marks the day done; the beat's lastRun says it
func TestDailyCatchUpDoneByFullRead(t *testing.T) {
	_, f := mrSetup(t)
	_ = f
	if !startKeepRun(runReq{kind: "nightly", only: []string{zz}, why: "test", short: true, day: true}) {
		t.Fatal("not started")
	}
	time.Sleep(100 * time.Millisecond)
	for keepRunning() {
		time.Sleep(50 * time.Millisecond)
	}
	if !dayCheckDone(zz) {
		t.Fatalf("the day's check: %v (log: %s)", dayCheckOf(zz), tailText(readText(logFile()), 1500))
	}
	if keepLastRun() != today() || keepLastNight() != "" {
		t.Fatalf("lastRun %q, the night's key %q", keepLastRun(), keepLastNight())
	}
	if !strings.Contains(readText(logFile()), "Daily catch-up") {
		t.Fatal("the log does not say the daily catch-up")
	}
}

func tailText(s string, n int) string {
	if len(s) > n {
		return s[len(s)-n:]
	}
	return s
}
