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
	// review N1: two more failures with the same reason, one naming another list and company (3 in a row): no more
	_ = newRun("now", "r2").step(zz, f.port, "")
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == grpListID {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><LINEERROR>Could not set &apos;SVCurrentCompany&apos; to &apos;ZZ TEST (2)&apos;</LINEERROR></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	f.mu.Unlock()
	_ = newRun("now", "r3").step(zz, f.port, "")
	keepReleaseLeases()
	if n := toInt(obj(keepStateOf(zz)["mastersFail"])["n"]); n != 3 {
		t.Fatalf("the same reason, another company's name in it: n=%d", n)
	}
	mrMu.Lock()
	mrAt[companyKey(zz)] = time.Now().Add(-11 * time.Minute)
	mrMu.Unlock()
	if why := mastersRetryWhyNot(zz, f.port); !strings.Contains(why, "3 reads in a row") {
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
	// review S4: a run nobody pressed (short), not a pressed Update now
	var asked []runReq
	ledWakeSeen = func(r runReq) { asked = append(asked, r) }
	r := wakeLedgers(zz, "the ledger chooser opened in FinCom", false)
	ledWakeSeen = nil
	if r["started"] != true || r["now"] != true || len(asked) != 1 || asked[0].kind != "now" || !asked[0].short || asked[0].day {
		t.Fatalf("a linked company never read: %v %+v", r, asked)
	}
	evMu.Lock()
	ledSeen = map[string]time.Time{}
	evMu.Unlock()
	r = wakeLedgers(zz, "the ledger chooser opened in FinCom", false)
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
	dcAt = time.Time{}
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
	// review N4: the tries kept in day-check.json (a restart does not run it again at once), 4 a day at most
	if m := dayCheckOf(zz); toInt(m["tries"]) != 2 || str(m["triedAt"]) == "" {
		t.Fatalf("the day's tries: %v", m)
	}
	for i := 0; i < 2; i++ {
		day = day.Add(31 * time.Minute)
		if !dayCatchCheck() {
			t.Fatalf("try %d not started", i+3)
		}
	}
	day = day.Add(31 * time.Minute)
	if dayCatchCheck() || len(asked) != 4 {
		t.Fatalf("a fifth try in a day: %d", len(asked))
	}
	dayCheckNote(zz, true, "")
	dayCheckNote(zz, false, "later failure")
	if !dayCheckDone(zz) {
		t.Fatal("a day done was undone by a later failure")
	}
	if m := dayCheckOf(zz); toInt(m["tries"]) != 4 {
		t.Fatalf("the tries lost when the day was done: %v", m)
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

// review S1: a list read in full before (held in FinCom's cloud) and then lost here: a failed read sends no 0 of 0 over it
func TestMastersFailedOverHeldSaysNoEnd(t *testing.T) {
	c := newStandCloud(t)
	prog := mrProg(c)
	f := ledgerTally(t, 5, c.cfg())
	noteCompanyGUID(zz, f.guid)
	if err := newRun("now", "r1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	keepReleaseLeases()
	_ = os.Remove(ledListFile(syncFolder(zz)))
	_ = mrProgs(c, prog)
	c.mu.Lock()
	*prog = nil
	c.mu.Unlock()
	f.mu.Lock()
	f.behave = mrLineError(grpListID)
	f.mu.Unlock()
	if err := newRun("now", "r2").step(zz, f.port, ""); !errors.Is(err, errTallySaid) {
		t.Fatal(err)
	}
	for _, p := range mrProgs(c, prog) {
		if p["done"] == true {
			t.Fatalf("a 0 of 0 over masters FinCom holds: %v", p)
		}
	}
}

// review S2: nothing held, the group list failed: the next try is a new round (its start shows as reading)
func TestMastersFailedNextTryNewRound(t *testing.T) {
	c := newStandCloud(t)
	prog := mrProg(c)
	f := ledgerTally(t, 5, c.cfg())
	noteCompanyGUID(zz, f.guid)
	f.mu.Lock()
	f.behave = mrLineError(grpListID)
	f.mu.Unlock()
	_ = newRun("now", "r1").step(zz, f.port, "")
	keepReleaseLeases()
	if keepStateOf(zz)["led"] != nil {
		t.Fatalf("the failed round kept: %v", keepStateOf(zz)["led"])
	}
	ps := mrProgs(c, prog)
	failed := str(ps[len(ps)-1]["round"])
	ledProg.mu.Lock()
	ledProg.last, ledProg.sent = map[string]M{}, map[string]time.Time{}
	ledProg.mu.Unlock()
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	if err := newRun("now", "r2").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	ps = mrProgs(c, prog)
	var next []M
	for _, p := range ps {
		if str(p["round"]) != failed {
			next = append(next, p)
		}
	}
	if len(next) < 2 || next[0]["done"] == true || toInt(next[0]["read"]) != 0 {
		t.Fatalf("the next try's start under a new round: %v (failed round %s)", next, failed)
	}
}

// review S5: merged into a queued run, a run nobody pressed stays one unless a pressed one comes in; the daily catch-up
// stays one unless the night's own run comes in
func TestMastersRunMerge(t *testing.T) {
	kwMu.Lock()
	wasR, wasRun, wasP := kwRunning, kwRun, kwPending
	kwRunning, kwRun, kwPending = true, &keepRun{kind: "light"}, nil
	kwMu.Unlock()
	t.Cleanup(func() {
		kwMu.Lock()
		kwRunning, kwRun, kwPending = wasR, wasRun, wasP
		kwNowAt = time.Time{}
		kwMu.Unlock()
	})
	cfgWas := cfg("KeepInStep")
	_ = cfgWas
	q := func(rs ...runReq) runReq {
		kwMu.Lock()
		kwPending = nil
		kwMu.Unlock()
		for _, r := range rs {
			startKeepRun(r)
		}
		kwMu.Lock()
		defer kwMu.Unlock()
		return *kwPending
	}
	if !keepOn() {
		t.Skip("keeping off in this configuration")
	}
	if r := q(runReq{kind: "now", short: true, only: []string{"A"}}, runReq{kind: "ledgers", only: []string{"B"}}); r.kind != "now" || !r.short {
		t.Fatalf("a wake merged into a retry: %+v", r)
	}
	if r := q(runReq{kind: "now", short: true}, runReq{kind: "now"}); r.short {
		t.Fatalf("a pressed Update now merged in: %+v", r)
	}
	if r := q(runReq{kind: "nightly", short: true, day: true}, runReq{kind: "now", short: true}); r.kind != "now" || r.day || !r.short {
		t.Fatalf("a retry merged into the daily catch-up: %+v", r)
	}
	if r := q(runReq{kind: "nightly", short: true, day: true}, runReq{kind: "ledgers"}); !r.day || !r.short {
		t.Fatalf("a wake merged into the daily catch-up: %+v", r)
	}
	if r := q(runReq{kind: "nightly", short: true, day: true}, runReq{kind: "nightly", night: "20261118"}); r.day {
		t.Fatalf("the night's run merged in: %+v", r)
	}
}

// review N3: a step that read nothing (another company's GUID under the name) is not a read: no "read at", no day done
func TestMastersNotReadNotMarked(t *testing.T) {
	_, f := mrSetup(t)
	k := newRun("now", "r1")
	k.full = map[string]bool{}
	if err := k.step(zz, f.port, ""); err != nil || !k.full[zz] {
		t.Fatalf("a read in full: %v %v", err, k.full)
	}
	keepReleaseLeases()
	all := readObjFile(guidFile()) // the GUID held for the name: another company's
	all[companyKey(zz)] = M{"guid": "another-guid"}
	_ = saveFile(guidFile(), jsonText(all))
	k2 := newRun("now", "r2")
	k2.full = map[string]bool{}
	_ = k2.step(zz, f.port, "")
	if k2.full[zz] {
		t.Fatal("a step the GUID guard refused counted as a read in full")
	}
}

// review N5: a read that stopped after parts were read (not a failure, not a back-off): "reading" ended with what was read
func TestMastersStopNoteEndsReading(t *testing.T) {
	c := newStandCloud(t)
	prog := mrProg(c)
	_ = ledgerTally(t, 5, c.cfg())
	k := newRun("now", "r1")
	st := M{"led": M{"round": "rr", "n": 40}}
	k.ledStopNote(zz, st, errors.New("Tally did not answer"))
	k.ledStopNote(zz, st, errBackoff)
	k.ledStopNote(zz, M{"led": M{"round": "r0", "n": 0}}, errors.New("x"))
	ps := mrProgs(c, prog)
	if len(ps) != 1 || ps[0]["done"] != true || toInt(ps[0]["read"]) != 40 || toInt(ps[0]["of"]) != 40 || str(ps[0]["round"]) != "rr" {
		t.Fatalf("the stop note: %v", ps)
	}
}
