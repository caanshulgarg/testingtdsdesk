package main

// Bridge 2.2.0: the fixes of the code and security reviews of 3fbc965 (docs/reviews/bridge-2.2.0-code-review.md and
// -security-review.md). Each test names its finding. Written before the fixes.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const otherCo, otherGUID = "OTHER CO", "other-guid"

func otherLine(ev, guid, mid, aid, narr string) string {
	l := liveLine(ev, "Voucher", guid, mid, aid, "Payment", "9", "20261004", "", "", narr)
	l = strings.ReplaceAll(l, "|cguid="+b220CoGUID+"|cname="+zz+"|", "|cguid="+otherGUID+"|cname="+otherCo+"|")
	return l
}

// a stand cloud that knows only ZZ TEST: recorder_lines of another company answers 409 notLinked
func notLinkedCloud(c *standCloud, probes *atomic.Int32) {
	c.mu.Lock()
	c.recReply = func(b M) (int, M) {
		if str(b["company"]) == otherCo {
			if len(arr(b["lines"])) == 0 && probes != nil {
				probes.Add(1)
			}
			return 409, M{"ok": false, "notLinked": true, "error": "This Tally company is not linked to a FinCom client yet."}
		}
		res := []any{}
		for _, x := range arr(b["lines"]) {
			res = append(res, M{"line_id": obj(x)["line_id"], "state": "applied"})
		}
		c.recBodies = append(c.recBodies, b)
		return 200, M{"ok": true, "results": res}
	}
	c.mu.Unlock()
}

// --- H1 / S1: a company not linked: nothing asked of Tally, nothing of it sent but an empty probe, its lines skipped
// (counted in the beat), the others flow; asked again after an hour
func TestUnlinkedCompanyNoBodyNoStall(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	var probes atomic.Int32
	notLinkedCloud(c, &probes)
	td := today()
	po := filepath.Join(rec, otherGUID+"-"+nowFn().Format("20060102")+".txt")
	liveAppend(t, po, otherLine("voucher_accept_pre", "", "", "", "private"), otherLine("voucher_accept_post", "o-1", "5", "6", "private"),
		otherLine("after_delete", "o-2", "7", "8", "private"))
	readAndUploadAll(t)
	if f.n(vchByMasterID) != 0 {
		t.Fatal("a body of a company not linked was asked of Tally")
	}
	c.mu.Lock()
	for _, r := range c.recRaw {
		if strings.Contains(r, otherCo) && (strings.Contains(r, "&lt;VOUCHER") || strings.Contains(r, "<VOUCHER") || strings.Contains(r, "private")) {
			t.Errorf("sent for the company not linked: %s", cut(r, 200))
		}
	}
	c.mu.Unlock()
	if probes.Load() != 1 {
		t.Fatalf("probes: %d", probes.Load())
	}
	for _, q := range liveQueue() {
		if q.company == otherCo {
			t.Fatal("its lines are still queued")
		}
	}
	st := obj(obj(beatBody(true, "open", "", nil, nil, nil)["recorderState"])[otherCo])
	if st["notLinked"] != true || toInt(st["skipped"]) != 2 {
		t.Fatalf("the beat: %v", st)
	}
	if logLines("Recorder: "+otherCo+" is not linked to a FinCom client: its lines are skipped") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	// the linked company flows; new lines of the other are skipped without a call
	liveAppend(t, liveFilePath(rec, ""), vchLine("after_delete", "g-1", "1", "1", "linked"))
	liveAppend(t, po, otherLine("after_delete", "o-3", "9", "9", "private"))
	readAndUploadAll(t)
	if len(c.recSent()) != 1 || probes.Load() != 1 {
		t.Fatalf("sent %d, probes %d", len(c.recSent()), probes.Load())
	}
	// asked again after an hour, not before
	laterBy(t, 30*time.Minute)
	liveAppend(t, po, otherLine("after_delete", "o-4", "10", "10", "private"))
	readAndUploadAll(t)
	if probes.Load() != 1 {
		t.Fatal("asked again within the hour")
	}
	laterBy(t, 31*time.Minute)
	liveAppend(t, po, otherLine("after_delete", "o-5", "11", "11", "private"))
	readAndUploadAll(t)
	if probes.Load() != 2 {
		t.Fatalf("not asked again after an hour: %d", probes.Load())
	}
	_ = td
}

// --- H1: a cap per company: one company's waiting lines never stop another's being read
func TestLiveQueueCapPerCompany(t *testing.T) {
	rec, _, c := liveBridge(t, `,"RecorderQueueMax":5`)
	c.mu.Lock()
	c.recReply = func(b M) (int, M) {
		if str(b["company"]) == otherCo {
			return 500, M{"ok": false} // down for it: its lines wait
		}
		res := []any{}
		for _, x := range arr(b["lines"]) {
			res = append(res, M{"line_id": obj(x)["line_id"], "state": "applied"})
		}
		c.recBodies = append(c.recBodies, b)
		return 200, M{"ok": true, "results": res}
	}
	c.mu.Unlock()
	po := filepath.Join(rec, otherGUID+"-"+nowFn().Format("20060102")+".txt")
	for i := 0; i < 10; i++ {
		liveAppend(t, po, otherLine("after_delete", fmt.Sprint("o-", i), fmt.Sprint(i+1), fmt.Sprint(i+1), "x"))
	}
	liveLinkedMark(otherCo, otherGUID, true) // linked, but its calls fail
	liveReadOnce()
	liveUploadOnce()
	liveAppend(t, liveFilePath(rec, ""), vchLine("after_delete", "g-1", "1", "1", "mine"))
	readAndUploadAll(t)
	if len(c.recSent()) != 1 {
		t.Fatal("the other company's waiting lines stopped this one's")
	}
	n := 0
	for _, q := range liveQueue() {
		if q.company == otherCo {
			n++
		}
	}
	if n > 5 {
		t.Fatalf("the cap: %d queued", n)
	}
}

// --- H2 / S3: the rollback checks the kept program against its SHA-256 and leaves a way back
func TestRollbackVerifiesKeptVersion(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	dir := t.TempDir()
	exe := filepath.Join(dir, "FinComBridge.exe")
	_ = os.WriteFile(exe, []byte("new 2.2.0"), 0o755)
	oldExe, oldRestart := exePathFn, rollbackRestart
	exePathFn, rollbackRestart = func() string { return exe }, func() {}
	defer func() { exePathFn, rollbackRestart = oldExe, oldRestart }()
	// an update ran: the replaced program and its hash recorded while it was the running one
	old := []byte("old 2.1.10")
	h := sha256.Sum256(old)
	_ = os.WriteFile(filepath.Join(dir, "FinComBridge.old.exe"), old, 0o755)
	_ = saveFile(filepath.Join(dir, "update-pending.json"), jsonText(M{"from": "2.1.10", "sha256": hex.EncodeToString(h[:])}))
	keepPreviousVersion(dir, "2.1.10")
	if str(readObjFile(filepath.Join(dir, "previous-version.json"))["sha256"]) != hex.EncodeToString(h[:]) {
		t.Fatal("the kept version's SHA-256 is not recorded")
	}
	// changed since: refused, nothing moved
	_ = os.WriteFile(previousExe(dir), []byte("anything at all"), 0o755)
	if code, r := callLocal(t, "POST", "/tray/rollback", "", `{"confirm":true}`); code == 200 || !strings.Contains(str(r["error"]), "has changed since it was kept") {
		t.Fatalf("a changed kept program: %d %v", code, r)
	}
	if readText(exe) != "new 2.2.0" || readText(previousExe(dir)) != "anything at all" {
		t.Fatal("files moved on a refusal")
	}
	// the good one: put back, the running one kept as old.exe with update-pending.json, so a start that fails is undone
	_ = os.WriteFile(previousExe(dir), old, 0o755)
	if code, r := callLocal(t, "POST", "/tray/rollback", "", `{"confirm":true}`); code != 200 || r["ok"] != true {
		t.Fatalf("rollback: %d %v", code, r)
	}
	if readText(exe) != "old 2.1.10" || readText(filepath.Join(dir, "FinComBridge.old.exe")) != "new 2.2.0" || readText(filepath.Join(dir, "FinComBridge.rolledback.exe")) != "new 2.2.0" {
		t.Fatal("the programs after the rollback")
	}
	if str(readObjFile(filepath.Join(dir, "update-pending.json"))["from"]) != BridgeVersion {
		t.Fatal("no update-pending.json naming the version rolled back from")
	}
	// a kept version from the setup gets its hash at the install
	d2 := t.TempDir()
	oldV := exeVersionFn
	exeVersionFn = func(string) string { return "2.1.10" }
	defer func() { exeVersionFn = oldV }()
	_ = os.WriteFile(filepath.Join(d2, "FinComBridge.exe"), []byte("new 2.2.0"), 0o755)
	_ = os.WriteFile(filepath.Join(d2, "FinComBridge.setup-old.exe"), old, 0o755)
	_ = os.WriteFile(filepath.Join(d2, "FinComBridge.previous.new"), old, 0o755)
	notePreviousFromSetup(d2)
	if str(readObjFile(filepath.Join(d2, "previous-version.json"))["sha256"]) != hex.EncodeToString(h[:]) {
		t.Fatal("the setup's kept version has no SHA-256")
	}
}

// --- S4: the beat says whether automatic updates are on and a rollback; the owner's answer turns them on again
func TestRecorderAutoUpdateInBeat(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	setCfg("NoAutoUpdate", true)
	b := beatBody(true, "open", "", nil, nil, nil)
	if b["autoUpdate"] != false {
		t.Fatalf("the beat: %v", b["autoUpdate"])
	}
	applyAutoUpdateOn(M{"autoUpdateOn": true})
	if cfgB("NoAutoUpdate") || logLines("Automatic updates turned on again by FinCom") != 1 {
		t.Fatal("the owner's answer did not turn them on")
	}
	if b := beatBody(true, "open", "", nil, nil, nil); b["autoUpdate"] != true {
		t.Fatalf("the beat after: %v", b["autoUpdate"])
	}
}

// --- M3 / S2: a forged line (in a narration, or in a file of another company) is not taken; nothing is asked for an
// entry at or below the starting point, and a body at or below it is not used
func TestForgedLineDropped(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	forged := strings.ReplaceAll(vchLine("after_delete", "victim-guid", "3", "4", "x"), "|cguid="+b220CoGUID+"|cname="+zz+"|", "|cguid=OTHER-GUID|cname=Other Co|")
	p := liveFilePath(rec, "")
	liveAppend(t, p, vchLine("after_cancel", "g-1", "1", "2", "first line\r\n"+forged))
	liveAppend(t, p, forged) // a whole line naming another company in this company's file
	liveReadOnce()
	q := liveQueue()
	if len(q) != 1 || q[0].event != "cancelled" || !strings.Contains(q[0].narr, "FCR1|ev=after_delete") {
		t.Fatalf("queued: %+v", q)
	}
	if logLines("Recorder: "+filepath.Base(p)+": a line naming another company (OTHER-GUID) is not taken") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	// the starting point: nothing asked for an AlterID at or below it; a body at or below it not used
	td := today()
	v := f.add(td, "Party", "P-1", "x", "-1.00") // alter 1
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // starting point 1
	f.mu.Lock()
	w := f.add(td, "Party", "P-2", "y", "-1.00") // alter 2
	f.mu.Unlock()
	liveAppend(t, p, liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "1", "Journal", "P-1", td, "", "", "old"),
		liveLine("voucher_accept_post", "Voucher", w.guid, w.master, "2", "Journal", "P-2", td, "", "", "new"))
	liveReadOnce()
	uploadAll(t)
	bs := f.bodiesOf(vchByMasterID)
	if len(bs) != 1 || strings.Contains(bs[0], "$MasterID = "+v.master+" ") || !strings.Contains(bs[0], "$MasterID = "+w.master) {
		t.Fatalf("asked: %v", bs)
	}
	for _, l := range c.recSent() {
		if str(l["object_guid"]) == v.guid && str(l["xml"]) != "" {
			t.Fatal("a body at the starting point was sent")
		}
		if str(l["object_guid"]) == w.guid && str(l["xml"]) == "" {
			t.Fatal("the new entry's body is missing")
		}
	}
}

// --- M4: source B does not take FinCom's own postings for foreign changes
func TestSourceBSkipsOwnPosting(t *testing.T) {
	_, f, c := liveBridge(t, `,"CloudPostSyncSec":0`)
	applyRecorderSource(M{"recorderSource": "alterid"})
	td := today()
	f.add(td, fgParty, "OP-0", "before", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions)
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-own-1", "company": zz, "payload": M{"vouchers": r15Bills("op", td, 5)}})
	c.mu.Unlock()
	cloudPostTake()
	waitJob(t, "job-own-1")
	laterBy(t, 11*time.Minute)
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n("TDSDeskKeepList") != 0 {
		t.Fatal("source B asked for FinCom's own posting")
	}
	// a person's entry during a job: the window is not clean, the list is asked
	f.mu.Lock()
	f.importAt = func(id, body string) (bool, time.Duration) {
		f.add(td, fgParty, "BY-HAND", "typed meanwhile", "-1.00") // under f.mu already
		return true, 0
	}
	f.mu.Unlock()
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-own-2", "company": zz, "payload": M{"vouchers": r15Bills("oq", td, 2)}})
	c.mu.Unlock()
	cloudPostTake()
	waitJob(t, "job-own-2")
	laterBy(t, 11*time.Minute)
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("a person's change in the window: %d lists", f.n("TDSDeskKeepList"))
	}
}

// --- M5: source B starts at what was received, asks nothing for a rise above 500, and waits 5 s at most
func TestSourceBBounded(t *testing.T) {
	_, f, _ := liveBridge(t, "")
	applyRecorderSource(M{"recorderSource": "alterid"})
	td := today()
	f.add(td, fgParty, "BB-0", "x", "-1.00")
	lightCheckOpen(openCompaniesWith(fin, true)) // starting point 1
	f.mu.Lock()
	f.alter += 700
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 0 {
		t.Fatal("asked for 700 changes")
	}
	if logLines("too many changes for Source B (700); the gap check and Day Book cover them") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	f.mu.Lock()
	f.add(td, fgParty, "BB-1", "x", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 {
		t.Fatalf("a rise of 1: %d %v", n, err)
	}
	// Tally not answering: given up within about 5 s
	f.mu.Lock()
	f.behave = silentFor(isID("TDSDeskKeepList"), nil)
	f.add(td, fgParty, "BB-2", "x", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	_, _ = liveSourceB(zz, f.port)
	// the request's own limit is 5 s (the 2 s rule then turns source B off): "Tally took 5.x s"
	if logLines("Source B off: Tally took 5.") != 1 {
		t.Fatalf("the request's limit: %s", readText(logFile()))
	}
}

// --- M6 / S5: never back on without the owner: an answer without the field, or the same value after a restart
func TestSourceBNeverBackWithoutOwner(t *testing.T) {
	f, _, _ := sourceBReady(t)
	slowKeepList(f, 2500*time.Millisecond)
	_, _ = liveSourceB(zz, f.port)
	slowKeepList(f, 0)
	applyRecorderSource(M{"ok": true}) // no recorderSource
	laterBy(t, 10*time.Minute)
	f.mu.Lock()
	f.add(today(), fgParty, "NB-1", "x", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatal("on again by an answer without the field")
	}
	if recorderSource() != "alterid" {
		t.Fatalf("an answer without the field changed the source: %s", recorderSource())
	}
	liveResetState() // a restart, before any beat
	if recorderSource() != "alterid" {
		t.Fatalf("the owner's source after a restart: %s", recorderSource())
	}
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatal("on again after a restart")
	}
}

// --- M7 / S6: older files with unread lines, and failed.txt, are read; a file whose size did not change is not opened
func TestLiveOldAndFailedLines(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	noteCompanyGUID(zz, b220CoGUID) // round 2 R2-3: a failed.txt line is taken only for the company's held GUID
	old := liveFilePath(rec, nowFn().AddDate(0, 0, -9).Format("20060102"))
	liveAppend(t, old, vchLine("after_delete", "g-old", "1", "1", "nine days"))
	inner := vchLine("after_cancel", "g-f", "2", "2", "via failed")
	i := strings.Index(inner, "|t1=")
	failed := "FCR1|ev=write_failed|file=" + liveFilePath(rec, "") + "|was=" + inner[:i] + inner[i:]
	liveAppend(t, filepath.Join(rec, "failed.txt"), failed)
	readAndUploadAll(t)
	var got []string
	for _, l := range c.recSent() {
		got = append(got, str(l["object_guid"]))
	}
	if strings.Join(got, ",") != "g-old,g-f" && strings.Join(got, ",") != "g-f,g-old" {
		t.Fatalf("sent: %v", got)
	}
	var mu sync.Mutex
	opened := 0
	readSharedHold = func(string) { mu.Lock(); opened++; mu.Unlock() }
	defer func() { readSharedHold = nil }()
	liveReadOnce()
	if opened != 0 {
		t.Fatalf("files opened with nothing new: %d", opened)
	}
	readAndUploadAll(t)
	if len(c.recSent()) != 2 {
		t.Fatal("sent twice")
	}
}

// --- M8: a daily file name in another date form is still read, and the beat names the files seen
func TestLiveOtherNameForms(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	p := filepath.Join(rec, b220CoGUID+"-4-Oct-2026.txt")
	liveAppend(t, p, vchLine("after_delete", "g-n", "1", "1", "odd name"))
	readAndUploadAll(t)
	if len(c.recSent()) != 1 {
		t.Fatal("not read")
	}
	if fs := strs(beatBody(true, "open", "", nil, nil, nil)["recorderFiles"]); !contains(fs, filepath.Base(p)) {
		t.Fatalf("the beat's files: %v", fs)
	}
}

// --- Lows: 10 (a pair across midnight), 11 (the narration cut at 4,000 characters)
func TestLiveLowsPairAndNarration(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	y := nowFn().AddDate(0, 0, -1).Format("20060102")
	liveAppend(t, liveFilePath(rec, y), vchLine("voucher_accept_pre", "", "", "", "late"))
	liveAppend(t, liveFilePath(rec, ""), vchLine("voucher_accept_post", "g-m", "1", "1", "late"), vchLine("after_cancel", "g-l", "2", "2", strings.Repeat("n", 9000)))
	liveReadOnce()
	q := liveQueue()
	if len(q) != 2 || q[0].event != "created" || len([]rune(q[1].narr)) != 4000 {
		t.Fatalf("queued: %d %v %d", len(q), eventsOf(q), len([]rune(q[len(q)-1].narr)))
	}
}
