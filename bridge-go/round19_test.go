package main

// Round 19 (FinCom Bridge 2.1.9, the code and security reviews of 04-Oct-2026, docs/reviews/bridge-2.1.9-*.md):
//   - finding 1 / S0: GET /readtest refused with ReadDays off; every request carrying a period refused in invokeTally
//     unless ReadDays is on or a person started it (the tray's read test, the measuring tool);
//   - finding 2 / S1: the change numbers are kept in the bridge's own sync folder, never in recorder\;
//   - finding 3 / S2: the recorder\ and addon\ folders made by the exe's install step, links refused;
//   - finding 4 / S3: the support pack reads bounded regular files only;
//   - findings 5, 6: start-point.json never rewritten from an unreadable file; one starting point per company GUID;
//   - finding 7: the measuring tool's dated items only with ReadDays on or --old-days typed at the console;
//   - the lows: the light check gives way after the lock, recorderHolding's name, a company that does not answer,
//     the folder watch's file count, the read test's yes/no.

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// the requests the stand-in Tally got since n0 that carry a period
func r19Dated(f *standTally, n0 int) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for i := n0; i < len(f.bodies); i++ {
		if strings.Contains(f.bodies[i], "<SVFROMDATE") || strings.Contains(f.bodies[i], "<SVTODATE") {
			out = append(out, f.reqs[i])
		}
	}
	return out
}

func r19Count(f *standTally) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.bodies)
}

// --- finding 1: GET /readtest (the older "what reading works" route) with ReadDays off: 409 and the words, nothing sent
func TestReadTestRouteRefusedWhenReadDaysOff(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "RT-1", "sale", "-1.00")
	standBridge(t, f, `,"Key":"tray-test-key","ReadDays":false`)
	_ = findCompanyPortQuiet(zz)
	n0 := r19Count(f)
	code, res := callLocal(t, "GET", "/readtest?company="+strings.ReplaceAll(zz, " ", "%20"), "", "")
	if code != 409 || str(res["error"]) != readsOffWords {
		t.Fatalf("/readtest with ReadDays off: %d %v (want 409 and the words)", code, res)
	}
	if n := r19Count(f) - n0; n != 0 {
		t.Fatalf("Tally was asked %d request(s) by /readtest with ReadDays off: %v", n, f.ids()[n0:])
	}
	// ReadDays on: the route works as before
	oldDaysOn()
	if code, res := callLocal(t, "GET", "/readtest?company="+strings.ReplaceAll(zz, " ", "%20"), "", ""); code != 200 || res["ok"] != true {
		t.Fatalf("/readtest with ReadDays on: %d %v", code, res)
	}
}

// --- finding 1 (belt and braces): with ReadDays off no request carrying SVFROMDATE/SVTODATE reaches Tally, whatever
// calls it: every dated builder, every route with a company and a period, Update now, the nightly run, a posting. The
// person-started read test still sends its Day Book forms
func TestNoDatedRequestWhenReadDaysOff(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "ND-1", "sale", "-1.00")
	f.add(addDays(td, -3), fgParty, "ND-2", "sale", "-2.00")
	f.addLed("Ledger A", "Sundry Debtors", "0.00")
	standBridge(t, f, `,"Key":"tray-test-key","ReadDays":false`)
	_ = findCompanyPortQuiet(zz)
	liveFrom(addDays(td, -10))
	n0 := r19Count(f)
	dir, _ := companyDir(zz)

	// every dated builder, called directly (the dead ones included)
	item := M{"id": "nd1", "kind": "voucher", "xml": `<VOUCHER ACTION="Create"><DATE>` + td + `</DATE><NARRATION>TDSDesk:nd1 | x</NARRATION></VOUCHER>`}
	_ = findPostedTags(f.port, zz, []M{item}, "")
	_, _, _ = findAccepted(f.port, zz, str(item["xml"]), "1")
	_ = dupCheck(f.port, zz, "nd2", finVoucher("nd2", fgParty, "ND-9", td, "9.00"))
	_, _, _ = copyKeepDays(fin, zz, f.port, dir, td, td)
	_, _ = getDayBookXML(fin, zz, td, td, f.port)
	_, _ = getDayBookXML(&TC{copier: true}, zz, td, td, f.port)
	_, _ = dayBookHeads(fin, f.port, zz, td, td)
	_, _ = voucherHeads(fin, f.port, zz, td, td)
	_, _ = tagsOnDate(f.port, zz, td)
	_, _ = voucherByMaster(f.port, zz, td, "1")
	_, _ = keepList(fin, zz, f.port, td, td, 0)
	for _, form := range dateForms {
		if _, err := invokeTally(fin, f.port, dayBookRequestForm(zz, form, td, td), 10); err == nil {
			t.Fatalf("a Day Book request (%s) went with ReadDays off", form)
		}
	}
	if _, err := invokeTally(fin, f.port, tagCheckRequest(zz, td), 10); err == nil || !strings.Contains(err.Error(), readsOffWords) {
		t.Fatalf("FinComTag with ReadDays off: %v (want the reads-off words)", err)
	}

	// every route with a company and a period
	q := "?company=" + strings.ReplaceAll(zz, " ", "%20") + "&from=" + td + "&to=" + td
	for _, p := range []string{"/readtest" + q, "/daybook" + q, "/vouchers" + q, "/tags" + q, "/keepcheck" + q + "&ym=" + td[:6],
		"/ledgerlines" + q + "&ledger=" + fgParty, "/ledgervouchers" + q + "&ledger=" + fgParty, "/ledgerbalance" + q + "&ledger=" + fgParty,
		"/balances" + q, "/tb" + q, "/ledgers" + q, "/companies", "/diagnose"} {
		_, _ = callLocal(t, "GET", p, "", "")
	}
	// Update now, the nightly run, a posting
	runNow(t, "now")
	runNow(t, "nightly")
	if r := postOne(t, "nd3", finVoucher("nd3", fgParty, "ND-3", td, "3.00")); r["ok"] != true {
		t.Fatalf("posting with ReadDays off: %v", r)
	}
	if got := r19Dated(f, n0); len(got) != 0 {
		t.Fatalf("dated request(s) reached Tally with ReadDays off: %v", got)
	}
	if logLines("refused before sending: it carries a period and reading old entries is off") == 0 {
		t.Fatal("the refusal is not in the log")
	}
	// the person-started read test is the exception: its Day Book forms still go
	n1 := r19Count(f)
	if _, err := runReadTest(zz); err != nil {
		t.Fatal(err)
	}
	if got := r19Dated(f, n1); len(got) < len(dateForms) {
		t.Fatalf("the read test's dated requests: %v (want at least the %d Day Book forms)", got, len(dateForms))
	}
}

// --- finding 7: with ReadDays off the measuring tool runs only its undated items (a, a2, the ledger items); its dated
// items (b, c, c0, d, e, the snapshot) only with --old-days typed by a person at the console, never from /measure or
// the tray
func TestMeasureUndatedOnlyWhenReadDaysOff(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "M-1", "sale", "-1.00")
	f.addLed("Ledger A", "Sundry Debtors", "0.00")
	standBridge(t, f, `,"Key":"tray-test-key","ReadDays":false`)
	n0 := r19Count(f)
	r, err := runMeasure(measureOpts{company: zz})
	if err != nil {
		t.Fatal(err)
	}
	if got := r19Dated(f, n0); len(got) != 0 {
		t.Fatalf("the measuring tool sent dated requests with ReadDays off: %v", got)
	}
	keys := map[string]bool{}
	for _, x := range arr(r["items"]) {
		keys[str(obj(x)["item"])] = true
	}
	for _, k := range []string{"a", "a2", "f0"} {
		if !keys[k] {
			t.Fatalf("item %s not measured: %v", k, r["items"])
		}
	}
	for _, k := range []string{"b", "c1", "c0", "d", "e"} {
		if keys[k] {
			t.Fatalf("dated item %s measured with ReadDays off: %v", k, r["items"])
		}
	}
	if !strings.Contains(str(r["report"]), "--old-days") {
		t.Fatalf("the report does not say how the dated items are run:\n%s", str(r["report"]))
	}
	// from the tray or /measure: an oldDays in the body is not taken
	n1 := r19Count(f)
	if code, res := callLocal(t, "POST", "/measure", "", `{"company":"ZZ TEST","oldDays":true,"old-days":true,"olddays":true}`); code != 200 || res["ok"] != true {
		t.Fatalf("/measure: %d %v", code, res)
	}
	for i := 0; i < 300 && str(measureStatus()["state"]) == "running"; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if got := r19Dated(f, n1); len(got) != 0 {
		t.Fatalf("/measure with oldDays in its body sent dated requests: %v", got)
	}
	// the snapshot is dated: refused
	if _, err := runMeasure(measureOpts{company: zz, snapshot: "s1"}); err == nil || !strings.Contains(err.Error(), "--old-days") {
		t.Fatalf("a snapshot with ReadDays off: %v", err)
	}
	// the console with a running bridge and --old-days: not sent through the bridge's web server
	posted := false
	code, said := consoleMeasure(measureOpts{company: zz, oldDays: true}, "up", func() M { posted = true; return M{"ok": true} }, func() M { return nil }, func() (M, error) { return nil, nil })
	if code == 0 || posted || !strings.Contains(said, "--old-days") {
		t.Fatalf("the console with --old-days and a running bridge: %d %v %q", code, posted, said)
	}
	// --old-days typed at the console (no bridge running): the dated items go
	n2 := r19Count(f)
	if _, err := runMeasure(measureOpts{company: zz, oldDays: true}); err != nil {
		t.Fatal(err)
	}
	if got := r19Dated(f, n2); len(got) == 0 || f.n("FinComMeasureB") == 0 {
		t.Fatalf("--old-days: no dated item measured: %v", f.ids()[n2:])
	}
	// the command line parses it
	if o := measureArgs([]string{"--company", zz, "--old-days"}); !o.oldDays || o.company != zz {
		t.Fatalf("measureArgs: %+v", o)
	}
}

// --- finding 2 / S1: "note change numbers" writes in the bridge's own sync folder (not writable by Users), never in
// recorder\ (a link planted there is not followed); the support pack carries the bridge's file
func TestChangeNumbersNotWrittenInRecorderFolder(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "CN-1", "sale", "-1.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	outside := filepath.Join(t.TempDir(), "victim.txt")
	_ = os.WriteFile(outside, []byte("not to be touched\n"), 0o644)
	if err := os.Symlink(outside, filepath.Join(rec, "changenumbers.txt")); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	code, res := callLocal(t, "POST", "/tray/recorder-note", "", "{}")
	if code != 200 || res["ok"] != true {
		t.Fatalf("note change numbers: %d %v", code, res)
	}
	if got := readText(outside); got != "not to be touched\n" {
		t.Fatalf("the link's target was written: %q", got)
	}
	own := sp("recorder-changenumbers.txt")
	if str(res["file"]) != own || !strings.HasPrefix(readText(own), "ZZ TEST: ALTVCHID=1, ALTMSTID=3, at ") {
		t.Fatalf("the bridge's own file: %v %q", res["file"], readText(own))
	}
	_ = os.Remove(filepath.Join(rec, "changenumbers.txt"))
	if code, res := callLocal(t, "POST", "/tray/recorder-send", "", `{"confirm":true}`); code != 200 || res["ok"] != true {
		t.Fatalf("send results: %d %v", code, res)
	}
	got := r19Pack(t, c)
	if !strings.HasPrefix(got["bridge/changenumbers.txt"], "ZZ TEST: ALTVCHID=1") {
		t.Fatalf("the pack lacks the bridge's change numbers: %v", keysOf(got))
	}
}

// the last support pack the stand-in cloud got, file name -> content
func r19Pack(t *testing.T, c *standCloud) map[string]string {
	t.Helper()
	var body M
	c.mu.Lock()
	for _, r := range c.raw {
		if o := parseObj(r); str(o["kind"]) == "support" {
			body = o
		}
	}
	c.mu.Unlock()
	if body == nil {
		t.Fatal("no support pack sent")
	}
	zb, _ := base64.StdEncoding.DecodeString(str(body["zip"]))
	zr, err := zip.NewReader(bytes.NewReader(zb), int64(len(zb)))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, zf := range zr.File {
		rc, _ := zf.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		got[zf.Name] = string(b)
	}
	return got
}

// --- finding 4 / S3: the support pack reads regular files only (a link skipped), only their end (a 64 MB file sent as
// its last 4 MB), at most 50 recorder files; a recorder folder that is itself a link: nothing read; Tally's files only
// from Program Files
func TestRecorderSendSkipsLinksAndBoundsSize(t *testing.T) {
	rec, tdir := r18RecorderDirs(t)
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	secret := filepath.Join(t.TempDir(), "secret.txt")
	_ = os.WriteFile(secret, []byte("SECRET OF ANOTHER USER"), 0o644)
	if err := os.Symlink(secret, filepath.Join(rec, "a-link.txt")); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	_ = os.Symlink(secret, filepath.Join(tdir, "tally.ini"))
	big := filepath.Join(rec, "b-big.txt")
	h, _ := os.Create(big)
	_ = h.Truncate(64 << 20)
	_, _ = h.WriteAt([]byte("TAIL-MARK"), 64<<20-9)
	h.Close()
	for i := 0; i < 200; i++ {
		_ = os.WriteFile(filepath.Join(rec, fmt.Sprintf("f%03d.txt", i)), []byte(r18Line1+"\r\n"), 0o644)
	}
	code, res := callLocal(t, "POST", "/tray/recorder-send", "", `{"confirm":true}`)
	if code != 200 || res["ok"] != true {
		t.Fatalf("send results: %d %v", code, res)
	}
	got := r19Pack(t, c)
	n := 0
	for k, v := range got {
		if strings.Contains(v, "SECRET OF ANOTHER USER") {
			t.Fatalf("%s carries the link's target", k)
		}
		if strings.HasPrefix(k, "recorder/") {
			n++
		}
	}
	if _, ok := got["recorder/a-link.txt"]; ok {
		t.Fatal("the link went into the pack")
	}
	if _, ok := got["tally/tally.ini"]; ok {
		t.Fatal("tally.ini (a link) went into the pack")
	}
	if n > 50 || toInt(res["files"]) > 50 {
		t.Fatalf("%d recorder files in the pack (at most 50)", n)
	}
	if b := got["recorder/b-big.txt"]; len(b) != 4<<20 || !strings.HasSuffix(b, "TAIL-MARK") {
		t.Fatalf("the 64 MB file: %d bytes sent (want its last 4 MB)", len(b))
	}
	// the recorder folder itself a link: nothing read
	other := t.TempDir()
	_ = os.WriteFile(filepath.Join(other, "co-guid-1.txt"), []byte(r18Line1+"\r\n"), 0o644)
	lnk := filepath.Join(t.TempDir(), "recorder")
	_ = os.Symlink(other, lnk)
	recorderDirFn = func() string { return lnk }
	if code, res := callLocal(t, "POST", "/tray/recorder-send", "", `{"confirm":true}`); code != 200 || toInt(res["files"]) != 0 {
		t.Fatalf("a recorder folder that is a link: %d %v", code, res)
	}
	// Tally's files: only from Program Files
	if !underDir(`/pf/TallyPrime/tally.exe`, `/pf`) || underDir(`/pf/../home/x/tally.exe`, `/pf`) || underDir(`/pfx/tally.exe`, `/pf`) {
		t.Fatal("underDir")
	}
}

// --- finding 5: a start-point.json that cannot be read (cut short, held by a backup) is never rewritten: the numbers
// stay in memory, the log names the file; once readable again the new company is added and the others kept
func TestStartPointFileUnreadableNotOverwritten(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "SP-1", "sale", "-1.00")
	standBridge(t, f, "")
	cut := `{"other co|g-o": {"company": "OTHER CO", "guid": "g-o", "altvchid": 5, "altmstid": 6, "at": "2026-10-01T10:00:00"`
	_ = os.WriteFile(sp("start-point.json"), []byte(cut), 0o644)
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	if got := readText(sp("start-point.json")); got != cut {
		t.Fatalf("an unreadable start-point.json was rewritten:\n%s", got)
	}
	if logLines("start-point.json could not be read") == 0 {
		t.Fatal("the log does not name the unreadable file")
	}
	if logLines("its starting point is recorded") != 0 {
		t.Fatal("the log says recorded although nothing was written")
	}
	// readable again: ZZ TEST added, OTHER CO kept
	_ = os.WriteFile(sp("start-point.json"), []byte(cut+"}}"), 0o644)
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	all := readObjFile(sp("start-point.json"))
	if all == nil || toI64(obj(all["other co|g-o"])["altvchid"]) != 5 {
		t.Fatalf("OTHER CO's starting point lost: %v", all)
	}
	if b := startPointBeat(); toI64(obj(b[zz])["altvchid"]) != 1 || toI64(obj(b["OTHER CO"])["altvchid"]) != 5 {
		t.Fatalf("the beat's starting points: %v", b)
	}
}

// --- finding 6: one starting point per company GUID, recorded once and never overwritten: a (10), b (50), a again (12):
// a stays 10, b 50; the beat shows the held GUID's
func TestStartPointKeptPerGUID(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	setAlt := func(n int) {
		for len(f.vch) < n {
			f.add(td, fgParty, fmt.Sprint("G-", len(f.vch)), "sale", "-1.00")
		}
	}
	setGUID := func(g string) {
		f.mu.Lock()
		f.guid = g
		f.mu.Unlock()
	}
	setAlt(10)
	_, _ = companyCheck(fin, zz, f.port) // GUID co-guid-1 at 10: held
	setGUID("g-b")
	setAlt(50)
	_, _ = companyCheck(fin, zz, f.port)
	setGUID("co-guid-1")
	setAlt(52)
	_, _ = companyCheck(fin, zz, f.port)
	var a, b M
	for _, v := range readObjFile(sp("start-point.json")) {
		switch e := obj(v); str(e["guid"]) {
		case "co-guid-1":
			a = e
		case "g-b":
			b = e
		}
	}
	if toI64(a["altvchid"]) != 10 || toI64(b["altvchid"]) != 50 {
		t.Fatalf("per GUID: a %v, b %v (want 10 and 50)", a, b)
	}
	if v, ok := startPointOf(zz); !ok || v != 10 {
		t.Fatalf("startPointOf: %d %v (want the held GUID's 10)", v, ok)
	}
	bt := obj(startPointBeat()[zz])
	if toI64(bt["altvchid"]) != 10 || str(bt["guid"]) != "co-guid-1" || len(arr(bt["otherGuids"])) != 1 {
		t.Fatalf("the beat: %v", bt)
	}
}

// --- finding 9 / L1: recorderHolding looks only inside the recorder folder: a company name or GUID holding a path
// separator or ".." is not looked at
func TestRecorderHoldingNoTraversal(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	parent := filepath.Dir(rec)
	_ = os.WriteFile(filepath.Join(parent, "outside.txt"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(rec, "name-ZZ TEST.txt"), []byte("x"), 0o644)
	if seen, _ := recorderHolding("ZZ TEST", ""); !seen {
		t.Fatal("the company's own holding file is not seen")
	}
	for _, c := range []struct{ co, guid string }{{"../outside", ""}, {`..\outside`, ""}, {"x/../../outside", ""}, {"", "../outside"}, {"", `..\outside`}} {
		if seen, at := recorderHolding(c.co, c.guid); seen || at != "" {
			t.Fatalf("recorderHolding(%q, %q) looked outside the folder: %v %q", c.co, c.guid, seen, at)
		}
	}
}

// --- finding 8: a background read that took the Tally lock while a posting job started gives the lock back at once and
// sends nothing (TC.yield, consulted right after the lock is taken)
func TestLightCheckYieldsAfterLock(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	_ = findCompanyPortQuiet(zz)
	n0 := r19Count(f)
	asked := 0
	_, err := invokeTally(&TC{copier: true, yield: func() bool { asked++; return true }}, f.port, companyCheckRequest(zz), 10)
	if err != errBackoff || asked != 1 {
		t.Fatalf("a background read told to give way: %v (asked %d)", err, asked)
	}
	if n := r19Count(f) - n0; n != 0 {
		t.Fatalf("%d request(s) sent after giving way", n)
	}
	if !gaveWay(errBackoff) {
		t.Fatal("errBackoff is not taken as giving way (the light check would mark the company)")
	}
	if lightCheckYield(zz)() {
		t.Fatal("the light check gives way with no job, no lease, no import")
	}
}

// --- finding 3 / S2: the exe's install step makes C:\ProgramData\FinCom, recorder\ and addon\: a link or junction at any
// of them (or, for all users, a FinCom folder not owned by SYSTEM / Administrators) is moved aside and the folder made
// anew; every icacls names the folder itself (/L), never a link's target; the .tdl written without following a link
func TestRecorderFolderLinkRefused(t *testing.T) {
	base := t.TempDir()
	target := t.TempDir()
	victim := filepath.Join(t.TempDir(), "victim.tdl")
	_ = os.WriteFile(victim, []byte("victim"), 0o644)
	fc := filepath.Join(base, "FinCom")
	_ = os.MkdirAll(filepath.Join(fc, "addon"), 0o755)
	if err := os.Symlink(target, filepath.Join(fc, "recorder")); err != nil {
		t.Skip("no symlinks here: " + err.Error())
	}
	_ = os.Symlink(victim, filepath.Join(fc, "addon", "FinComRecorderTrial.tdl"))
	_ = os.Symlink(victim, filepath.Join(fc, "addon", "FinComRecorderAnyCompany.tdl")) // round 22: the new name too
	var calls [][]string
	oldI := icaclsFn
	icaclsFn = func(args ...string) (string, error) { calls = append(calls, args); return "processed", nil }
	t.Cleanup(func() { icaclsFn = oldI })
	lines, err := prepareFinComFolders(base, true)
	if err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(lines, "\n"))
	}
	for _, d := range []string{fc, filepath.Join(fc, "recorder"), filepath.Join(fc, "addon")} {
		fi, err := os.Lstat(d)
		if err != nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
			t.Fatalf("%s is not a plain folder: %v %v", d, fi, err)
		}
	}
	if m, _ := filepath.Glob(filepath.Join(fc, "recorder.moved-*")); len(m) != 1 {
		t.Fatalf("the link at recorder was not moved aside: %v\n%s", m, strings.Join(lines, "\n"))
	}
	if es, _ := os.ReadDir(target); len(es) != 0 {
		t.Fatalf("something was made in the link's target: %v", es)
	}
	if readText(victim) != "victim" {
		t.Fatal("the .tdl was written through a link")
	}
	if b, _ := os.ReadFile(filepath.Join(fc, "addon", "FinComRecorderAnyCompany.tdl")); len(b) == 0 {
		t.Fatal("the add-on .tdl is not in addon")
	}
	// round 22: a link at the 2.1.9 name is replaced by the 2.1.9 text (ZZ TEST only), not followed
	if b, _ := os.ReadFile(filepath.Join(fc, "addon", "FinComRecorderTrial.tdl")); !bytes.Equal(b, legacyAddon219) {
		t.Fatal("the 2.1.9 name does not hold the 2.1.9 text")
	}
	if len(calls) == 0 {
		t.Fatal("no permissions set for all users")
	}
	var rec []string
	for _, c := range calls {
		j := strings.Join(c, " ")
		if strings.Contains(j, target) || !contains(c, "/L") {
			t.Fatalf("icacls %s (a link's target, or no /L)", j)
		}
		if c[0] == filepath.Join(fc, "recorder") {
			rec = append(rec, j)
		}
	}
	all := strings.Join(rec, " | ")
	for _, want := range []string{"/inheritance:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(RX,WD)", "*S-1-5-32-545:(OI)(IO)M"} {
		if !strings.Contains(all, want) {
			t.Fatalf("recorder's permissions lack %s: %s", want, all)
		}
	}
	if strings.Contains(all, "(OI)(CI)M") {
		t.Fatalf("Users get Modify (with DELETE) on the recorder folder itself: %s", all)
	}
	// for all users, a FinCom folder not owned by SYSTEM or Administrators: moved aside, made anew
	oldO := ownerIsAdmin
	ownerIsAdmin = func(p string) (bool, string) { return p != fc, "S-1-5-21-user" }
	t.Cleanup(func() { ownerIsAdmin = oldO })
	_ = os.WriteFile(filepath.Join(fc, "recorder", "planted.txt"), []byte("x"), 0o644)
	if _, err := prepareFinComFolders(base, true); err != nil {
		t.Fatal(err)
	}
	if m, _ := filepath.Glob(filepath.Join(base, "FinCom.moved-*")); len(m) != 1 || exists(filepath.Join(fc, "recorder", "planted.txt")) {
		t.Fatalf("a FinCom folder owned by a user was kept: %v", m)
	}
	// the setup script no longer makes them nor sets their permissions; the exe's install step does
	nsi := readText(filepath.Join("installer", "FinComBridge.nsi"))
	if strings.Contains(nsi, `FinCom\recorder`) || strings.Contains(nsi, `FinCom\addon`) || strings.Contains(nsi, "S-1-5-32-545:(OI)(CI)M") {
		t.Fatal("the NSI still makes the recorder or add-on folder")
	}
	for _, f := range []string{"win_service.go", "win_user.go"} {
		if !strings.Contains(readText(f), "installFinComFolders(") {
			t.Fatalf("%s's install step does not make the folders", f)
		}
	}
}

// --- the owner's question (04-Oct-2026, "can the add-on hang Tally"), A: the bridge never opens a recorder holding file
// for writing, never creates, renames, deletes or locks one, and reads it only through readShared (read-only, sharing
// read, write and delete, its end only, closed at once). Every function of the bridge's own code that names the recorder
// folder (recorderDirFn, recorderFiles) is looked through: none of the calls that write, move or open a file directly
func TestNoWriteToRecorderFiles(t *testing.T) {
	banned := map[string]bool{"os.OpenFile": true, "os.Create": true, "os.WriteFile": true, "os.Rename": true, "os.Remove": true, "os.RemoveAll": true,
		"os.Truncate": true, "os.Chmod": true, "os.Chtimes": true, "os.Mkdir": true, "os.MkdirAll": true, "os.Open": true, "os.ReadFile": true,
		"appendText": true, "saveFile": true, "writeFresh": true, "readText": true, "fileTail": true}
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	looked := 0
	for _, fn := range files {
		if strings.HasSuffix(fn, "_test.go") {
			continue
		}
		af, err := parser.ParseFile(fset, fn, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range af.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			names := false
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				if id, ok := n.(*ast.Ident); ok && (id.Name == "recorderDirFn" || id.Name == "recorderFiles") {
					names = true
				}
				return true
			})
			if !names {
				continue
			}
			looked++
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				c, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				name := ""
				switch f := c.Fun.(type) {
				case *ast.Ident:
					name = f.Name
				case *ast.SelectorExpr:
					if x, ok := f.X.(*ast.Ident); ok {
						name = x.Name + "." + f.Sel.Name
					}
				}
				if banned[name] {
					t.Errorf("%s: %s calls %s in a function that names the recorder folder", fset.Position(c.Pos()), fd.Name.Name, name)
				}
				return true
			})
		}
	}
	if looked < 3 {
		t.Fatalf("only %d function(s) name the recorder folder: the check looked at nothing", looked)
	}
	// the watch only looks at times and sizes; the holding files are read through readShared alone
	src := readText("recorder.go")
	if strings.Contains(src, "os.ReadFile(") || strings.Contains(src, "os.Open(") || strings.Contains(src, "os.OpenFile(") {
		t.Fatal("recorder.go opens a file other than through readShared")
	}
}

// readShared itself: a regular file's end; a link, a folder, a FIFO refused; the tests' hook sees it open
func TestReadSharedBounds(t *testing.T) {
	d := t.TempDir()
	p := filepath.Join(d, "a.txt")
	_ = os.WriteFile(p, []byte("0123456789"), 0o644)
	held := false
	readSharedHold = func(string) { held = true }
	t.Cleanup(func() { readSharedHold = nil })
	if b, err := readShared(p, 4); err != nil || string(b) != "6789" || !held {
		t.Fatalf("the end of a file: %q %v %v", b, err, held)
	}
	_ = os.Symlink(p, filepath.Join(d, "l.txt"))
	if _, err := readShared(filepath.Join(d, "l.txt"), 4); err == nil {
		t.Fatal("a link was read")
	}
	if _, err := readShared(d, 4); err == nil {
		t.Fatal("a folder was read")
	}
	_ = os.Link(p, filepath.Join(d, "h.txt"))
	if _, err := readShared(p, 4); err == nil {
		t.Fatal("a file with two names (a hard link) was read")
	}
}

// --- the owner's question, C: "Recorder trial: time saving": through the import request and invokeTally, the two
// bench ledgers made when missing, then 50 small journals (2 lines) and 50 journals of 50 lines, one per request,
// narration "TRIAL FinCom bench <n>" (no FinCom tag); the median, 90th percentile and total per kind; nothing kept for
// the cloud; with ReadDays off too; person-only. Round 21 (2.1.10): any company (here ZZ TEST is just the company open;
// TestRecorderBenchAnyCompany runs it on another), the company asked for must be the one open, owner only
func TestRecorderBenchTrialTagged(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key","ReadDays":false`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	_ = findCompanyPortQuiet(zz)
	for _, origin := range []string{"https://app.fincom.live"} {
		if code, _ := callLocal(t, "POST", "/tray/recorder-bench", origin, `{"company":"ZZ TEST"}`); code != 403 {
			t.Fatalf("from a web page: %d", code)
		}
	}
	if r := startBench("OTHER CO"); r["ok"] == true {
		t.Fatalf("another company: %v", r)
	}
	if code, r := callLocal(t, "POST", "/tray/recorder-bench", "", `{"preview":true}`); code != 200 || r["ok"] != true || str(r["company"]) != zz || f.n("Import") != 0 {
		t.Fatalf("the preview (for the yes/no): %d %v", code, r)
	}
	n0 := r19Count(f)
	if code, r := callLocal(t, "POST", "/tray/recorder-bench", "", `{"company":"ZZ TEST","confirm":true}`); code != 200 || r["ok"] != true {
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
	var small, large, masters int
	for i := n0; i < len(f.bodies); i++ {
		b := f.bodies[i]
		if f.reqs[i] != "Import" {
			continue
		}
		if strings.Contains(b, "<LEDGER NAME=") {
			masters++
			continue
		}
		if strings.Contains(b, "TDSDesk:") || !strings.Contains(b, "<NARRATION>TRIAL FinCom bench ") || strings.Count(b, "<VOUCHER ") != 1 {
			t.Errorf("a bench voucher's shape: %s", cut(b, 300))
		}
		switch strings.Count(b, "<ALLLEDGERENTRIES.LIST>") {
		case 2:
			small++
		case 50:
			large++
		default:
			t.Errorf("a voucher with %d lines", strings.Count(b, "<ALLLEDGERENTRIES.LIST>"))
		}
	}
	f.mu.Unlock()
	if small != 50 || large != 50 || masters != 1 {
		t.Fatalf("imports: %d small, %d large, %d masters (want 50, 50, 1)", small, large, masters)
	}
	for _, k := range []string{"small", "large"} {
		m := obj(s[k])
		if toInt(m["requests"]) != 50 || m["medianMs"] == nil || m["p90Ms"] == nil || m["totalMs"] == nil {
			t.Fatalf("the %s summary: %v", k, m)
		}
	}
	if logLines("Recorder trial: time saving (ZZ TEST): small journals (2 lines): 50 requests, median") != 1 {
		t.Fatal("the summary is not in the log")
	}
	// the ledgers are there now: a second run makes none
	n1 := r19Count(f)
	_ = startBench(zz)
	for i := 0; i < 500 && str(benchStatus()["state"]) == "running"; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	f.mu.Lock()
	for i := n1; i < len(f.bodies); i++ {
		if strings.Contains(f.bodies[i], "<LEDGER NAME=") {
			t.Error("the bench ledgers were made again")
		}
	}
	f.mu.Unlock()
	// nothing kept for the cloud: no posting noted
	evMu.Lock()
	_, noted := postedFor[zz]
	evMu.Unlock()
	if noted {
		t.Fatal("the bench was noted as a posting (it would be read back and sent to the cloud)")
	}
}

// --- finding 13: the tray asks a yes/no naming the company before the read test; the preview sends nothing to Tally
func TestReadTestPreviewNamesCompany(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	_ = findCompanyPortQuiet(zz)
	_ = openCompaniesWith(fin, true)
	n0 := r19Count(f)
	st0 := str(readTestStatus()["at"])
	code, r := callLocal(t, "POST", "/tray/readtest", "", `{"preview":true}`)
	if code != 200 || r["ok"] != true || str(r["company"]) != zz {
		t.Fatalf("preview: %d %v", code, r)
	}
	if n := r19Count(f) - n0; n != 0 || str(readTestStatus()["at"]) != st0 {
		t.Fatalf("the preview sent %d request(s) or started the test: %v", n, readTestStatus())
	}
	if !strings.Contains(readText("win_tray.go"), `"/tray/readtest", M{"preview": true}`) {
		t.Fatal("the tray does not ask first")
	}
}
