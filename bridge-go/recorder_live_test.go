package main

// Bridge 2.2.0 (plan round 20, a and b): the live add-on, the change stream (source A: the add-on's daily files; source
// B: Tally's change numbers), the body fetch, the uploader (recorder_lines), the posting window, the touched-ledger
// hook, the recorder state in the beat, the rollback tray item and the 30-day logs. Tests written before the code.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// --- helpers

const b220CoGUID = "co-guid-1"

// one line as the live add-on writes it (heads only, src=live), with the add-on's own time text
func liveLine(ev, obj, guid, mid, aid, vtype, vno, vdate, name, parent, narr string) string {
	return "FCR1|ev=" + ev + "|t0=4-Oct-2026 10:15:02|tw=4-Oct-2026 10:15:02|cguid=" + b220CoGUID + "|cname=" + zz + "|user=owner|obj=" + obj +
		"|guid=" + guid + "|mid=" + mid + "|aid=" + aid + "|vtype=" + vtype + "|vno=" + vno + "|vdate=" + vdate + "|name=" + name + "|parent=" + parent +
		"|narr=" + narr + "|t1=4-Oct-2026 10:15:03|src=live"
}

func vchLine(ev, guid, mid, aid, narr string) string {
	return liveLine(ev, "Voucher", guid, mid, aid, "Payment", "7", "20261004", "", "", narr)
}

func lLine(ev, guid, mid, aid, name, parent string) string {
	return liveLine(ev, "Master", guid, mid, aid, "", "", "", name, parent, "")
}

func le16(s string) []byte { return utf16leBOM(s)[2:] }

// the daily file of the test company for a day (nowFn's day when day is "")
func liveFilePath(rec, day string) string {
	if day == "" {
		day = nowFn().Format("20060102")
	}
	return filepath.Join(rec, b220CoGUID+"-"+day+".txt")
}

// appends lines to a daily file as the add-on does (UTF-16LE; the BOM when the file is new)
func liveAppend(t *testing.T, path string, lines ...string) {
	t.Helper()
	var b []byte
	if _, err := os.Stat(path); err != nil {
		b = append(b, 0xFF, 0xFE)
	}
	for _, l := range lines {
		b = append(b, le16(l+"\r\n")...)
	}
	appendBytes(t, path, b)
}

func appendBytes(t *testing.T, path string, b []byte) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Write(b)
	f.Close()
}

// a bridge with a stand Tally and a stand cloud, the recorder folder the test's own, the live state fresh
func liveBridge(t *testing.T, extra string) (rec string, f *standTally, c *standCloud) {
	t.Helper()
	rec, _ = r18RecorderDirs(t)
	f = newStandTally(t)
	c = newStandCloud(t)
	standBridge(t, f, c.cfg()+extra)
	liveResetState()
	t.Cleanup(liveResetState)
	liveSeedOwnOpen(b220CoGUID, zz)
	return rec, f, c
}

// fix 3: these tests' bridge reads lines its own Tally wrote: the company was open in its own Tally all along (a stretch
// over every line's time, kept on disk like the bridge's own looks, so a restart keeps it)
func liveSeedOwnOpen(guid, name string) {
	from, to := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	live.mu.Lock()
	liveFresh()
	for _, k := range []string{liveOwnKey(guid, name), liveOwnKey("", name)} {
		live.own[k] = &liveOwnSt{name: name, ivs: []liveOwnIv{{from: from, to: to}}}
	}
	live.ownAt = to
	path, text := liveOwnTallyFile(), liveOwnText()
	live.mu.Unlock()
	_ = saveFile(path, text)
}

// the lines the stand cloud took (200 answers only), in order
func (c *standCloud) recSent() []M {
	c.mu.Lock()
	defer c.mu.Unlock()
	var o []M
	for _, b := range c.recBodies {
		for _, x := range arr(b["lines"]) {
			o = append(o, obj(x))
		}
	}
	return o
}

func uploadAll(t *testing.T) {
	t.Helper()
	for i := 0; i < 50; i++ {
		if liveUploadOnce() == 0 {
			return
		}
	}
}

// the watch and the uploader until nothing moves (the reader takes 1 MB of a file a turn)
func readAndUploadAll(t *testing.T) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if liveReadOnce() == 0 && liveUploadOnce() == 0 {
			return
		}
	}
}

func eventsOf(cs []change) []string {
	var o []string
	for _, c := range cs {
		o = append(o, c.event)
	}
	return o
}

// --- 1. the live add-on: the trial's FCRLog, heads only, src=live, a daily file per company GUID; no company name check
func TestLiveAddonFile(t *testing.T) {
	tdl := readText(filepath.Join("addon", liveAddonName))
	if tdl == "" {
		t.Fatal("addon/" + liveAddonName + " is missing")
	}
	for _, s := range []string{`FCRIsLive   : NOT $$IsEmpty:##SVCurrentCompany`, `"|src=live"`, `@@FCRFolder + ##vGuid + "-" + @@FCRDay + ".txt"`, `$$MachineDate`,
		`"UniversalDate"`, "$$ZeroFill", `"failed.txt"`, "On : Form Accept : Yes          : Form Accept", "silent", "never blocks", "OPEN FILE : ##vFile : Text : Write : Unicode",
		"voucher_accept_pre", "voucher_accept_post", "ledger_accept_pre", "ledger_accept_post", "before_delete", "after_delete", "before_cancel", "after_cancel",
		"start_import", "import_object", "after_import_object", "end_import", "RETURN : Yes"} {
		if !strings.Contains(tdl, s) {
			t.Errorf("the live add-on lacks %q", s)
		}
	}
	// no company name check, nothing but the append
	for _, s := range []string{"ZZ ", "GARG"} {
		if strings.Contains(tdl, s) {
			t.Errorf("the live add-on names %q", s)
		}
	}
	// no text logic inside Tally: FinCom's tag is the bridge's to find (a comment may say so)
	if regexp.MustCompile(`(?m)^[^;]*TDSDesk`).MatchString(tdl) {
		t.Error("the live add-on looks for FinCom's tag")
	}
	if regexp.MustCompile(`##SVCurrentCompany\s*=`).MatchString(tdl) {
		t.Error("the live add-on compares the company's name")
	}
	for _, s := range []string{"Message", "Query", "Menu", "Key :", "Log :", "HTTP", "Execute"} {
		if regexp.MustCompile(`(?m)^[^;]*\b` + regexp.QuoteMeta(s)).MatchString(tdl) {
			t.Errorf("the live add-on has %q outside a comment", s)
		}
	}
	// the same function body as the trial's, apart from the file name and src=live
	trial := readText(filepath.Join("addon", anyAddonName))
	body := func(s string) string {
		s = s[strings.Index(s, "    01 : SET"):]
		// next-userfile: the Windows user's own file (06a-06c: the shared name when Tally gives no user) and w= after tw
		s = regexp.MustCompile(`(?m)^    06[abc]:.*\n`).ReplaceAllString(s, "")
		s = strings.ReplaceAll(s, `@@FCRFolder + ##vGuid + "-" + @@FCRDay + "-" + @@FCRWinUser + ".txt"`, `@@FCRFolder + ##vGuid + ".txt"`)
		s = strings.ReplaceAll(s, `"|tw=" + ##vTW + "|w=" + @@FCRWinUser`, `"|tw=" + ##vTW`)
		s = strings.ReplaceAll(s, `@@FCRFolder + ##vGuid + "-" + @@FCRDay + ".txt"`, `@@FCRFolder + ##vGuid + ".txt"`)
		s = strings.ReplaceAll(s, `"|t1=" + ##vT1 + "|src=live"`, `"|t1=" + ##vT1`)
		s = strings.ReplaceAll(s, `SET : vGuid : "noguid"`, `SET : vGuid : "name-" + ##SVCurrentCompany`) // review Low 17
		return regexp.MustCompile(`(?m)^\s*;;.*\n`).ReplaceAllString(s, "")
	}
	if body(tdl) != body(trial) {
		t.Errorf("the live writer differs from the trial's FCRLog beyond the file name and src=live:\n%s\n---\n%s", body(tdl), body(trial))
	}
	// a line as it writes it parses, with src=live
	l := liveLine("voucher_accept_post", "Voucher", "g-1", "1", "2", "Payment", "7", "4-Oct-2026", "", "", "a | b")
	r, ok := parseRecorderLine(l)
	if !ok || r.Src != "live" || r.T1 != "4-Oct-2026 10:15:03" || r.Narr != "a | b" {
		t.Fatalf("the live line: %v %+v", ok, r)
	}
	// built into the exe beside the trial file; the install step writes both, the trial file unchanged
	es, _ := addonFiles.ReadDir("addon")
	var names []string
	for _, e := range es {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	if strings.Join(names, ",") != liveAddonName+","+anyAddonName {
		t.Fatalf("the add-on files shipped: %v", names)
	}
	base := t.TempDir()
	if lines, err := prepareFinComFolders(base, false); err != nil {
		t.Fatalf("%v\n%s", err, strings.Join(lines, "\n"))
	}
	add := filepath.Join(base, "FinCom", "addon")
	if readText(filepath.Join(add, liveAddonName)) != tdl || readText(filepath.Join(add, anyAddonName)) != trial {
		t.Fatal("the install step did not write both add-ons as built")
	}
}

// --- 2a. the reader: the add-on's events mapped to the cloud's
func TestLiveEventMapping(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	p := liveFilePath(rec, "")
	// Tally's GUIDs: the company's GUID and the MasterID in hex (2.2.2: a GUID that is not its MasterID's is not trusted)
	ga, gb, gc, gd := b220CoGUID+"-00000065", b220CoGUID+"-00000066", b220CoGUID+"-00000067", b220CoGUID+"-00000068"
	liveAppend(t, p,
		vchLine("voucher_accept_pre", "", "", "", "Rent paid"),
		vchLine("voucher_accept_post", ga, "101", "201", "Rent paid"),
		vchLine("voucher_accept_pre", ga, "101", "201", "Rent paid (changed)"),
		vchLine("voucher_accept_post", ga, "101", "202", "Rent paid (changed)"),
		vchLine("before_delete", ga, "101", "202", ""),
		vchLine("after_delete", ga, "101", "202", ""),
		vchLine("before_cancel", gb, "102", "203", ""),
		vchLine("after_cancel", gb, "102", "204", ""),
		vchLine("start_import", "", "", "", ""),
		vchLine("import_object", gc, "103", "205", "Bill 1 | TDSDesk:f1"),
		vchLine("after_import_object", gc, "103", "205", "Bill 1 | TDSDesk:f1"),
		vchLine("end_import", "", "", "", ""),
		lLine("ledger_accept_pre", "", "", "", "New Ledger", "Sundry Creditors"),
		lLine("ledger_accept_post", "l-1", "55", "300", "New Ledger", "Sundry Creditors"),
		lLine("ledger_accept_pre", "l-1", "55", "300", "Renamed Ledger", "Sundry Creditors"),
		lLine("ledger_accept_post", "l-1", "55", "301", "Renamed Ledger", "Sundry Creditors"),
		lLine("after_delete", "l-1", "55", "301", "Renamed Ledger", "Sundry Creditors"),
		"FCR1|ev=write_failed|file=x|was=y",
	)
	if n := liveReadOnce(); n != 8 {
		t.Fatalf("changes read: %d (%v)", n, eventsOf(liveQueue()))
	}
	q := liveQueue()
	if got := strings.Join(eventsOf(q), ","); got != "created,altered,deleted,cancelled,imported,ledger_created,ledger_altered,ledger_deleted" {
		t.Fatalf("events: %s", got)
	}
	cr := q[0]
	// 2.2.2: the line's GUID and AlterID are never the entry's: Tally gives them with the body
	if cr.guid != "" || cr.masterId != "101" || cr.alterId != "" || cr.vchType != "Payment" || cr.vchNo != "7" || cr.vchDate != "20261004" || cr.narr != "Rent paid" ||
		cr.company != zz || cr.companyGuid != b220CoGUID || cr.source != "addon" || cr.user != "owner" || cr.fid != "" || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(cr.lineId) {
		t.Fatalf("created: %+v", cr)
	}
	if q[1].alterId != "" || q[1].masterId != "101" || q[1].narr != "Rent paid (changed)" {
		t.Fatalf("altered: %+v", q[1])
	}
	if q[4].fid != "f1" || q[4].guid != gc {
		t.Fatalf("imported (the pair once, the FinCom id from the narration): %+v", q[4])
	}
	if q[5].name != "New Ledger" || q[5].parent != "Sundry Creditors" || q[5].guid != "l-1" || q[6].name != "Renamed Ledger" {
		t.Fatalf("ledger lines: %+v %+v", q[5], q[6])
	}
	ids := map[string]bool{}
	for _, c := range q {
		if ids[c.lineId] {
			t.Fatalf("a line id twice: %s", c.lineId)
		}
		ids[c.lineId] = true
	}
	// read again: nothing new
	if n := liveReadOnce(); n != 0 {
		t.Fatalf("read again: %d", n)
	}
	// a pre with a GUID whose post never comes is an alteration once it has waited; a pre without a GUID alone is dropped
	liveAppend(t, p, vchLine("voucher_accept_pre", gd, "104", "206", "edit"), vchLine("voucher_accept_pre", "", "", "", "never saved"))
	liveReadOnce()
	old := nowFn
	nowFn = func() time.Time { return old().Add(time.Minute) }
	defer func() { nowFn = old }()
	liveReadOnce()
	q = liveQueue()
	if got := strings.Join(eventsOf(q[8:]), ","); got != "altered" || q[8].guid != "" || q[8].masterId != "104" {
		t.Fatalf("pending pres: %s %+v", got, q[8:])
	}
}

// --- 2b. complete lines only: a partial last line (even half a character) waits; a narration over several lines is one
func TestLivePartialAndMultiline(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	p := liveFilePath(rec, "")
	l1 := vchLine("after_delete", "g-1", "1", "2", "one")
	l2 := vchLine("after_cancel", "g-2", "2", "3", "two\r\nlines | and a bar")
	all := append([]byte{0xFF, 0xFE}, le16(l1+"\r\n"+l2+"\r\n")...)
	cut1 := 2 + len(le16(l1+"\r\n"+l2[:strings.Index(l2, "\r\n")+2])) // the narration's first line, then nothing
	appendBytes(t, p, all[:cut1])
	if n := liveReadOnce(); n != 1 {
		t.Fatalf("first read: %d", n)
	}
	appendBytes(t, p, all[cut1:len(all)-7]) // all but half a character and the line end
	if n := liveReadOnce(); n != 0 {
		t.Fatalf("a partial line was read: %v", eventsOf(liveQueue()))
	}
	appendBytes(t, p, all[len(all)-7:])
	if n := liveReadOnce(); n != 1 {
		t.Fatalf("the completed line: %d", n)
	}
	q := liveQueue()
	if q[1].event != "cancelled" || q[1].narr != "two\nlines | and a bar" {
		t.Fatalf("the multi-line narration: %+v", q[1])
	}
}

// --- 2c. a restart resumes: what was sent is not sent again; what was read but not sent is sent
func TestLiveRestartResume(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	for i := 0; i < 3; i++ {
		liveAppend(t, p, vchLine("after_delete", fmt.Sprint("g-", i), fmt.Sprint(i+1), fmt.Sprint(i+10), fmt.Sprint("n=", i)))
	}
	liveReadOnce()
	uploadAll(t)
	if n := len(c.recSent()); n != 3 {
		t.Fatalf("sent: %d", n)
	}
	for i := 3; i < 5; i++ {
		liveAppend(t, p, vchLine("after_delete", fmt.Sprint("g-", i), fmt.Sprint(i+1), fmt.Sprint(i+10), fmt.Sprint("n=", i)))
	}
	c.mu.Lock()
	c.recReply = func(M) (int, M) { return 500, M{"ok": false, "error": "down"} }
	c.mu.Unlock()
	liveReadOnce()
	liveUploadOnce()
	if n := len(c.recSent()); n != 3 {
		t.Fatalf("a 500 counted as sent: %d", n)
	}
	if !exists(sp("recorder-offsets.json")) {
		t.Fatal("no sync\\recorder-offsets.json")
	}
	// the restart: everything in memory forgotten
	liveResetState()
	c.mu.Lock()
	c.recReply = nil
	c.mu.Unlock()
	liveReadOnce()
	uploadAll(t)
	var got []string
	for _, l := range c.recSent() {
		got = append(got, str(l["narration"]))
	}
	if strings.Join(got, ",") != "n=0,n=1,n=2,n=3,n=4" {
		t.Fatalf("after the restart: %v", got)
	}
	// the sent ids are kept 7 days in sync\recorder-sent\
	if m, _ := filepath.Glob(filepath.Join(syncDir(), "recorder-sent", "*.txt")); len(m) == 0 {
		t.Fatal("no sync\\recorder-sent\\ file")
	}
	// even when the offset is lost, the sent ids keep a line from going twice
	_ = os.Remove(sp("recorder-offsets.json"))
	liveResetState()
	liveReadOnce()
	uploadAll(t)
	if n := len(c.recSent()); n != 5 {
		t.Fatalf("sent again after the offsets were lost: %d", n)
	}
}

// --- 2d. the newest 7 days of daily files are read, older ones only up to 31 days and only for bytes not read yet
// (review M7); the trial's files (<GUID>.txt) give nothing
func TestLiveOnlyNewest7Days(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	old := nowFn().AddDate(0, 0, -35).Format("20060102")
	recent := nowFn().AddDate(0, 0, -6).Format("20060102")
	liveAppend(t, liveFilePath(rec, old), vchLine("after_delete", "g-old", "1", "1", ""))
	liveAppend(t, liveFilePath(rec, recent), vchLine("after_delete", b220CoGUID+"-00000002", "2", "2", ""))
	liveAppend(t, filepath.Join(rec, b220CoGUID+".txt"), vchLine("after_delete", "g-trial", "3", "3", ""))
	liveReadOnce()
	q := liveQueue()
	// review H1 of 2.3.0: a delete's own GUID is kept aside (guidKeep) until this Tally shows the voucher gone
	if len(q) != 1 || q[0].guidKeep != b220CoGUID+"-00000002" || q[0].masterId != "2" {
		t.Fatalf("read: %+v", q)
	}
}

// --- 2e. source B: the light check sees ALTVCHID above what was received; the undated keep list is asked once
func TestLiveSourceB(t *testing.T) {
	_, f, _ := liveBridge(t, `,"RecorderSource":"alterid"`)
	td := today()
	f.add(td, fgParty, "B-1", "one", "-1.00")
	f.add(td, fgParty, "B-2", "two", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // the starting point: ALTVCHID 2
	if sp, ok := startPointOf(zz); !ok || sp != 2 {
		t.Fatalf("starting point: %d %v", sp, ok)
	}
	// nothing above it: nothing asked
	n0 := f.n("")
	if n, err := liveSourceB(zz, f.port); err != nil || n != 0 || f.n("TDSDeskKeepList") != 0 {
		t.Fatalf("nothing changed: %d %v %v", n, err, f.ids()[n0:])
	}
	f.mu.Lock()
	f.add(td, fgParty, "B-3", "three", "-1.00") // master 3, alter 3
	f.alter++
	f.vch[0].alter = f.alter // B-1 altered: alter 4
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, time.Minute) // 60 s at least between two source B requests (the owner's rule)
	n0 = f.n("")
	n, err := liveSourceB(zz, f.port)
	if err != nil || n != 2 {
		t.Fatalf("source B: %d %v", n, err)
	}
	ids := f.ids()[n0:]
	if len(ids) != 1 || ids[0] != "TDSDeskKeepList" {
		t.Fatalf("asked: %v", ids)
	}
	f.mu.Lock()
	body := f.bodies[len(f.bodies)-1]
	f.mu.Unlock()
	if strings.Contains(body, "SVFROMDATE") || !strings.Contains(body, "$AlterID &gt; 2") || !strings.Contains(body, "MASTERID") {
		t.Fatalf("the request: %s", body)
	}
	q := liveQueue()
	got := map[string]change{}
	for _, c := range q {
		got[c.guid] = c
	}
	if got[b220CoGUID+"-00000001"].source != "alterid" || got[b220CoGUID+"-00000001"].masterId != "1" || got[b220CoGUID+"-00000001"].alterId != "4" || got[b220CoGUID+"-00000003"].masterId != "3" || got[b220CoGUID+"-00000001"].vchDate != td {
		t.Fatalf("changes: %+v", q)
	}
	// a second change: a new entry (MasterID above every one seen) is created, an old one altered
	f.mu.Lock()
	f.add(td, fgParty, "B-4", "four", "-1.00") // master 5, alter 5
	f.alter++
	f.vch[1].alter = f.alter // B-2: alter 6
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 2*time.Minute)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 2 {
		t.Fatalf("second: %d %v", n, err)
	}
	f.mu.Lock()
	body = f.bodies[len(f.bodies)-1]
	f.mu.Unlock()
	if !strings.Contains(body, "$AlterID &gt; 4") {
		t.Fatalf("the second request does not start above the highest received: %s", body)
	}
	got = map[string]change{}
	for _, c := range liveQueue()[2:] {
		got[c.guid] = c
	}
	if got[b220CoGUID+"-00000005"].event != "created" || got[b220CoGUID+"-00000002"].event != "altered" {
		t.Fatalf("second changes: %+v", got)
	}
	// the light check asks it by itself when the source includes alterid, and not with the add-on alone
	f.mu.Lock()
	f.add(td, fgParty, "B-5", "five", "-1.00")
	f.mu.Unlock()
	laterBy(t, 3*time.Minute)
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	n0 = f.n("TDSDeskKeepList")
	lightCheckOpen(sessions)
	if f.n("TDSDeskKeepList") != n0+1 {
		t.Fatal("the light check did not ask source B")
	}
	setCfg("RecorderSource", "addon")
	f.mu.Lock()
	f.add(td, fgParty, "B-6", "six", "-1.00")
	f.mu.Unlock()
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n("TDSDeskKeepList") != n0+1 {
		t.Fatal("source B asked with the add-on as the source")
	}
}

// --- 2f. the source setting: config default addon, the beat's recorderSource over it; the uploader is the same
func TestLiveSourceSwitchKeepsUploader(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	if recorderSource() != "addon" {
		t.Fatalf("default: %s", recorderSource())
	}
	setCfg("RecorderSource", "both")
	if recorderSource() != "both" {
		t.Fatal("config")
	}
	applyRecorderSource(M{"recorderSource": "alterid"})
	if recorderSource() != "alterid" {
		t.Fatal("the beat's answer")
	}
	// review M6: a bad value or an answer without the field keeps the owner's last choice (kept on disk)
	applyRecorderSource(M{"recorderSource": "nonsense"})
	if recorderSource() != "alterid" {
		t.Fatalf("a bad answer: %s", recorderSource())
	}
	applyRecorderSource(M{})
	if recorderSource() != "alterid" {
		t.Fatalf("an answer without the field: %s", recorderSource())
	}
	applyRecorderSource(M{"recorderSource": "addon"})
	setCfg("RecorderSource", "addon")
	// 2.3.3: the lines here wait several seconds for the test's own steps; the 4 s safety net is not what this test is about
	setCfg("RecorderHoldAfterMs", float64(60000))
	// lines read from the add-on, then the source switched: the queued lines still go, by the same uploader
	liveAppend(t, liveFilePath(rec, ""), vchLine("after_delete", b220CoGUID+"-00000009", "9", "1", "from the add-on"))
	liveReadOnce()
	applyRecorderSource(M{"recorderSource": "alterid"})
	liveAppend(t, liveFilePath(rec, ""), vchLine("after_delete", b220CoGUID+"-0000000a", "10", "1", "not read now"))
	if n := liveReadOnce(); n != 0 {
		t.Fatal("the add-on's file read with the source alterid")
	}
	td := today()
	f.add(td, fgParty, "S-1", "one", "-1.00")
	lightCheckOpen(openCompaniesWith(fin, true))
	f.mu.Lock()
	f.add(td, fgParty, "S-2", "two", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 {
		t.Fatalf("source B: %d %v", n, err)
	}
	uploadAll(t)
	sent := c.recSent()
	if len(sent) != 2 || str(sent[0]["source"]) != "addon" || str(sent[1]["source"]) != "alterid" {
		t.Fatalf("sent: %v", sent)
	}
	keys := func(m M) string {
		var k []string
		for x := range m {
			if x != "save_ms" { // "if known": the add-on's own time on the line; source B has none
				k = append(k, x)
			}
		}
		sort.Strings(k)
		return strings.Join(k, ",")
	}
	if keys(sent[0]) != keys(sent[1]) {
		t.Fatalf("the two sources' lines differ in shape:\n%s\n%s", keys(sent[0]), keys(sent[1]))
	}
	// back to the add-on: the line written meanwhile is read then
	applyRecorderSource(M{"recorderSource": "addon"})
	if n := liveReadOnce(); n != 1 {
		t.Fatalf("back to the add-on: %d", n)
	}
}

// --- 3a. the entry request's exception: next-fastfetch, the object export of ONE voucher (no period), exactly as built,
// for a company whose starting point is recorded, whatever ReadDays says; nothing else dated passes
func TestLiveDatedGuardException(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	if readDaysOn() {
		t.Fatal("ReadDays is on by default")
	}
	ok := voucherObjectRequest(zz, "5")
	// 2.2.2 security review: only for a company whose starting point is recorded
	if datedRefused(fin, ok) == nil {
		t.Fatal("the body fetch passes for a company with no starting point")
	}
	noteStartPoint(zz, b220CoGUID, 1, 1)
	if datedRefused(fin, ok) != nil {
		t.Fatal("the body fetch is refused with ReadDays off")
	}
	if _, err := invokeTally(&TC{copier: true}, f.port, ok, 5); err != nil {
		t.Fatalf("the body fetch: %v", err)
	}
	bad := map[string]string{
		"a period":    strings.Replace(ok, "</SVCURRENTCOMPANY>", "</SVCURRENTCOMPANY><SVFROMDATE>20261004</SVFROMDATE><SVTODATE>20261004</SVTODATE>", 1),
		"two ids":     strings.Replace(ok, "ID:5<", "ID:5,9<", 1),
		"no id":       strings.Replace(ok, "ID:5<", "<", 1),
		"no fetch":    regexp.MustCompile(`<FETCHLIST>.*</FETCHLIST>`).ReplaceAllString(ok, ""),
		"more fields": strings.Replace(ok, "<FETCHLIST>", "<FETCHLIST><FETCH>LEDGERENTRIES.*</FETCH>", 1),
	}
	for name, x := range bad {
		if datedRefused(fin, x) == nil && checkAllowed(x) == nil {
			t.Errorf("%s: passes", name)
		}
	}
	// every dated request the bridge can build stays refused with ReadDays off
	for id, x := range allowListSamples() {
		if id == vchObjectID || (!strings.Contains(x, "<SVFROMDATE") && !strings.Contains(x, "<SVTODATE")) {
			continue
		}
		if datedRefused(fin, x) == nil {
			t.Errorf("%s passes the dated guard with ReadDays off", id)
		}
	}
	if strings.Contains(allowListSamples()[vchObjectID], "<SVFROMDATE") {
		t.Fatal("the entry request's sample carries a period")
	}
}

// --- 3b. the body fetch: a created / altered / imported entry that is not FinCom's gets its voucher from Tally
func TestLiveBodyFetch(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderBodySec":2`)
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1) // 2.2.2: nothing is taken without a starting point
	v := f.add(td, "Party A", "PA-1", "rent", "-12.00")
	p := liveFilePath(rec, "")
	liveAppend(t, p,
		liveLine("voucher_accept_pre", "Voucher", "", "", "", "Journal", "PA-1", td, "", "", "rent"),
		liveLine("voucher_accept_post", "Voucher", v.guid, v.master, fmt.Sprint(v.alter), "Journal", "PA-1", td, "", "", "rent"),
		// 2.2.2 second review L-D: FinCom's own import is exempt only with a GUID Tally made for its MasterID (77 = 0x4d)
		vchLine("import_object", b220CoGUID+"-0000004d", "77", "78", "TDSDesk:fin1 | bill"),
		vchLine("after_import_object", b220CoGUID+"-0000004d", "77", "78", "TDSDesk:fin1 | bill"))
	liveReadOnce()
	// a posting going: no Tally request, the line waits for its body
	postTaking.Store(true)
	n0 := f.n("")
	liveUploadOnce()
	postTaking.Store(false)
	if f.n("") != n0 || len(c.recSent()) != 0 {
		t.Fatalf("during a posting: %v, %d sent", f.ids()[n0:], len(c.recSent()))
	}
	uploadAll(t)
	if f.n(vchObjectID) != 1 {
		t.Fatalf("body fetches: %v", f.ids()[n0:])
	}
	body := f.bodiesOf(vchObjectID)[0]
	if body != voucherObjectRequest(zz, v.master) {
		t.Fatalf("the request: %s", body)
	}
	sent := c.recSent()
	if len(sent) != 2 {
		t.Fatalf("sent: %v", sent)
	}
	x := str(sent[0]["xml"])
	if !strings.HasPrefix(x, "<VOUCHER ") || !strings.HasSuffix(x, "</VOUCHER>") || !strings.Contains(x, "<GUID>"+v.guid+"</GUID>") || !strings.Contains(x, "<ALLLEDGERENTRIES.LIST>") || tagValue(x[strings.Index(x, "<ALLLEDGERENTRIES.LIST>"):], "LEDGERNAME") != "Party A" {
		t.Fatalf("the voucher sent: %s", x)
	}
	if lg := fmt.Sprint(sent[0]["ledgers"]); !strings.Contains(lg, "Party A") || !strings.Contains(lg, "Sales") {
		t.Fatalf("ledgers: %s", lg)
	}
	if str(sent[1]["fid"]) != "fin1" || str(sent[1]["xml"]) != "" || str(sent[1]["event"]) != "imported" {
		t.Fatalf("FinCom's own entry (no body asked): %v", sent[1])
	}
	// Tally not answering: the line goes without its body within the cap
	f.mu.Lock()
	f.behave = silentFor(isID(vchObjectID), nil)
	f.mu.Unlock()
	liveAppend(t, p, liveLine("voucher_accept_pre", "Voucher", v.guid, v.master, "99", "Journal", "PA-1", td, "", "", "rent 2"),
		liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "100", "Journal", "PA-1", td, "", "", "rent 2"))
	liveReadOnce()
	t0 := time.Now()
	uploadAll(t)
	if el := time.Since(t0); el > 6*time.Second {
		t.Fatalf("the body fetch held the line %s", el)
	}
	// 2.3.3 (the owner's rule): stopped at 2 s, it goes up held at once with the words; asked again once at the retry's
	// try, stopped again, it ends with the Day Book words (2.3.1: asked 3 times before it went up at all)
	sent = c.recSent()
	if len(sent) != 3 || str(sent[2]["xml"]) != "" || str(sent[2]["event"]) != "altered" || !strings.HasPrefix(str(sent[2]["heldWhy"]), "waiting: ") {
		t.Fatalf("without a body: %v", sent[len(sent)-1])
	}
	// Tally did not answer at all: nothing more is sent to it until it answers the small check (once a minute); the held
	// line's one ask again waits for that, not spent meanwhile
	n := f.n(vchObjectID)
	for i := 0; i < 2; i++ {
		retryDue()
		uploadAll(t)
	}
	if sent = c.recSent(); len(sent) != 3 || f.n(vchObjectID) != n {
		t.Fatalf("while Tally owes the small check: %v (asked %d more)", sent[2:], f.n(vchObjectID)-n)
	}
	if logLines("held at once: waiting: ") < 1 {
		t.Fatal("the held line is not in the log")
	}
}

// --- 3c. a ledger created or altered: that one ledger by MasterID, the ledger list's request with a one-ID range
func TestLiveLedgerBody(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	l := f.addLed("New Ledger", "Sundry Creditors", "0.00")
	liveAppend(t, liveFilePath(rec, ""), lLine("ledger_accept_pre", "", "", "", "New Ledger", "Sundry Creditors"),
		lLine("ledger_accept_post", l.guid, fmt.Sprint(l.mid), fmt.Sprint(l.alter), "New Ledger", "Sundry Creditors"))
	liveReadOnce()
	uploadAll(t)
	bs := f.bodiesOf(ledListID)
	if len(bs) != 1 || !strings.Contains(bs[0], fmt.Sprintf("$MasterID &gt; %d AND $MasterID &lt;= %d", l.mid-1, l.mid)) {
		t.Fatalf("the ledger request: %v", bs)
	}
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["event"]) != "ledger_created" || str(sent[0]["name"]) != "New Ledger" || str(sent[0]["object_guid"]) != l.guid || !strings.Contains(str(sent[0]["xml"]), "<LEDGER ") {
		t.Fatalf("sent: %v", sent)
	}
}

// --- 4a. groups of 500 lines or 1 MB at most; marked sent only on a 200 with results or queued; backoff otherwise
func TestUploaderGroupsAndMarkSent(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	var ls []string
	for i := 0; i < 1200; i++ {
		ls = append(ls, vchLine("after_delete", fmt.Sprint("g-", i), fmt.Sprint(i+1), fmt.Sprint(i+1), fmt.Sprint("n=", i)))
	}
	liveAppend(t, p, ls...)
	liveReadOnce()
	uploadAll(t)
	c.mu.Lock()
	var sizes []int
	for _, b := range c.recBodies {
		sizes = append(sizes, len(arr(b["lines"])))
		if str(b["company"]) != zz || str(b["company_guid"]) != b220CoGUID {
			t.Errorf("the group's company: %v %v", b["company"], b["company_guid"])
		}
	}
	c.mu.Unlock()
	if fmt.Sprint(sizes) != "[500 500 200]" {
		t.Fatalf("groups: %v", sizes)
	}
	// 1 MB: long narrations
	long := strings.Repeat("x", 3000)
	ls = nil
	for i := 0; i < 400; i++ {
		ls = append(ls, vchLine("after_delete", fmt.Sprint("h-", i), fmt.Sprint(i+5000), fmt.Sprint(i+5000), long))
	}
	liveAppend(t, p, ls...)
	c.mu.Lock()
	c.recBodies, c.recRaw = nil, nil
	c.mu.Unlock()
	readAndUploadAll(t)
	c.mu.Lock()
	for _, r := range c.recRaw {
		if len(r) > 1<<20 {
			t.Errorf("a group of %d bytes", len(r))
		}
	}
	n := len(c.recRaw)
	c.mu.Unlock()
	if n < 2 || len(c.recSent()) != 400 {
		t.Fatalf("1 MB groups: %d calls, %d lines", n, len(c.recSent()))
	}
	// not marked sent: a 500, a 503, a 200 without results or queued; then backoff (nothing sent at once)
	for _, reply := range []func(M) (int, M){
		func(M) (int, M) { return 500, M{"ok": false} },
		func(M) (int, M) { return 503, M{"ok": false, "notReady": true} },
		func(M) (int, M) { return 200, M{"ok": true} },
	} {
		liveResetBackoff()
		liveAppend(t, p, vchLine("after_delete", "g-r", "1", "1", "retry"))
		liveReadOnce()
		c.mu.Lock()
		c.recReply, c.recBodies = reply, nil
		c.mu.Unlock()
		calls := c.count("recorder_lines")
		liveUploadOnce()
		liveUploadOnce()
		if got := c.count("recorder_lines"); got != calls+1 {
			t.Fatalf("not backed off: %d calls", got-calls)
		}
		if len(liveQueue()) == 0 {
			t.Fatal("marked sent without results or queued")
		}
		c.mu.Lock()
		c.recReply = nil
		c.mu.Unlock()
		liveResetBackoff()
		uploadAll(t)
		if len(liveQueue()) != 0 {
			t.Fatal("not sent after the backoff")
		}
	}
	// queued: marked sent
	c.mu.Lock()
	c.recReply = func(b M) (int, M) { return 200, M{"ok": true, "queued": len(arr(b["lines"]))} }
	c.mu.Unlock()
	liveAppend(t, p, vchLine("after_delete", "g-q", "1", "1", "queued"))
	liveReadOnce()
	liveUploadOnce()
	if len(liveQueue()) != 0 {
		t.Fatal("a queued answer not marked sent")
	}
}

// --- 4b. the request body, as the cloud's tests read it (tests/fixtures/recorder-lines-2.2.0.json)
func TestRecorderLinesFixture(t *testing.T) {
	if standTyped.Load() {
		t.Skip("the fixture is the request the plain stand Tally's answers make, byte for byte")
	}
	rec, f, c := liveBridge(t, "")
	oldPC, oldZone := liveComputerFn, liveZone
	liveComputerFn, liveZone = func() string { return "NWS144" }, time.FixedZone("IST", 19800)
	defer func() { liveComputerFn, liveZone = oldPC, oldZone }()
	// 2.2.2: Tally's GUIDs (the company's GUID and the MasterID in hex): a GUID that is not its MasterID's is not trusted
	v := &tVch{guid: b220CoGUID + "-00001005", master: "4101", date: "20261004", typ: "Payment", no: "17", narr: "Rent for October", party: "Landlord A", alter: 9001,
		lines: [][2]string{{"Landlord A", "25000.00"}, {"HDFC Bank", "-25000.00"}}}
	f.mu.Lock()
	f.vch = append(f.vch, v)
	f.mu.Unlock()
	noteStartPoint(zz, b220CoGUID, 9000, 1) // 2.2.2: nothing is taken without a starting point
	l := f.addLed("Landlord B", "Sundry Creditors", "0.00")
	liveAppend(t, liveFilePath(rec, "20261004"),
		liveLine("voucher_accept_pre", "Voucher", "", "", "", "Payment", "17", "4-Oct-2026", "", "", "Rent for October"),
		liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "9001", "Payment", "17", "4-Oct-2026", "", "", "Rent for October"),
		liveLine("after_import_object", "Voucher", b220CoGUID+"-00001006", "4102", "9002", "Journal", "J-5", "4-Oct-2026", "", "", "TDSDesk:abc123 | TDS on rent"),
		liveLine("after_delete", "Voucher", b220CoGUID+"-00001007", "4103", "9003", "Sales", "S-9", "3-Oct-2026", "", "", "old sale"),
		liveLine("ledger_accept_pre", "Master", "", "", "", "", "", "", "Landlord B", "Sundry Creditors", ""),
		liveLine("ledger_accept_post", "Master", l.guid, fmt.Sprint(l.mid), fmt.Sprint(l.alter), "", "", "", "Landlord B", "Sundry Creditors", ""))
	old := nowFn
	nowFn = func() time.Time { return time.Date(2026, 10, 4, 10, 20, 0, 0, liveZone) }
	defer func() { nowFn = old }()
	liveReadOnce()
	uploadAll(t)
	c.mu.Lock()
	var raws []string
	for _, r := range c.recRaw {
		if len(arr(parseObj(r)["lines"])) > 0 { // the empty call before is the link check (review H1)
			raws = append(raws, r)
		}
	}
	c.mu.Unlock()
	if len(raws) != 1 {
		t.Fatalf("calls: %d", len(raws))
	}
	raw := raws[0]
	b := parseObj(raw)
	if str(b["kind"]) != "recorder_lines" || str(b["company"]) != zz || str(b["company_guid"]) != b220CoGUID {
		t.Fatalf("the body: %s", cut(raw, 300))
	}
	want := []string{"line_id", "event", "object_guid", "master_id", "alter_id", "vch_type", "vch_no", "vch_date", "saved_at", "pc", "user", "company_guid", "ledgers", "narration", "fid", "xml", "source"}
	lines := arr(b["lines"])
	if len(lines) != 4 {
		t.Fatalf("lines: %d", len(lines))
	}
	for _, x := range lines {
		for _, k := range want {
			if _, ok := obj(x)[k]; !ok {
				t.Fatalf("a line lacks %s: %v", k, x)
			}
		}
	}
	l0 := obj(lines[0])
	if str(l0["event"]) != "created" || str(l0["vch_date"]) != "20261004" || str(l0["saved_at"]) != "2026-10-04T10:15:03+05:30" || toInt(l0["alter_id"]) != 9001 || str(l0["pc"]) != "NWS144" {
		t.Fatalf("the first line: %v", l0)
	}
	// the request as sent, the bridge's identity fixed (it is machine-dependent: review Low 18); compared with the
	// fixture the cloud's tests read, written only with FINCOM_WRITE_FIXTURES=1
	b["bridge"] = M{"computer": "NWS144", "id": "go-fixture000000", "mode": "main", "runMode": "service", "user": "owner", "version": BridgeVersion}
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, []byte(jsonText(b)), "", "  "); err != nil {
		t.Fatal(err)
	}
	pretty.WriteString("\n")
	fx := filepath.Join("..", "tests", "fixtures", "recorder-lines-2.2.0.json")
	if os.Getenv("FINCOM_WRITE_FIXTURES") == "1" {
		if err := os.WriteFile(fx, pretty.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", fx)
	} else if cur, _ := os.ReadFile(fx); !bytes.Equal(cur, pretty.Bytes()) {
		t.Fatalf("the recorder_lines request differs from %s (run with FINCOM_WRITE_FIXTURES=1 when the change is meant):\n%s", fx, pretty.String())
	}
}

// --- 4c. a posting goes first: 2,000 lines written while a 2,000-entry posting runs. No upload starts while an import
// is at Tally, at most one group per gap between imports; every line is sent once and in order
func TestLiveUploaderDuringPosting(t *testing.T) {
	rec, f, c := liveBridge(t, `,"PostBatchBills":100,"CloudPostSyncSec":0`)
	td := today()
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 30 * time.Millisecond }
	var mu sync.Mutex
	var during, gapsSeen []int64
	var importStarts []time.Time
	liveSendHook = func() {
		mu.Lock()
		defer mu.Unlock()
		during = append(during, importsInFlight.Load())
		if postingGoing() {
			gapsSeen = append(gapsSeen, importGaps.Load())
		}
	}
	defer func() { liveSendHook = nil }()
	f.mu.Lock()
	prev := f.behave
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "Import" {
			mu.Lock()
			importStarts = append(importStarts, time.Now())
			mu.Unlock()
		}
		return prev != nil && prev(w, r, id, body)
	}
	f.mu.Unlock()
	c.mu.Lock()
	c.recDelay = 20 * time.Millisecond
	c.mu.Unlock()
	var stop atomic.Bool
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { // the bridge's watch and uploader
		defer wg.Done()
		for !stop.Load() {
			liveReadOnce()
			liveUploadOnce()
			time.Sleep(5 * time.Millisecond)
		}
	}()
	vs := r15Bills("lv", td, 2000)
	if _, err := newPostJob(M{"jobId": "job-live-2000", "company": zz, "vouchers": vs}); err != nil {
		t.Fatal(err)
	}
	go func() { // the add-on, writing while the posting runs
		defer wg.Done()
		p := liveFilePath(rec, "")
		for i := 0; i < 2000; i += 40 {
			var ls []string
			for k := i; k < i+40; k++ {
				ls = append(ls, vchLine("after_import_object", fmt.Sprintf("%s-%08x", b220CoGUID, k+1), fmt.Sprint(k+1), fmt.Sprint(k+1), fmt.Sprintf("TDSDesk:lv%d | n=%d", k+1, k)))
			}
			liveAppend(t, p, ls...)
			time.Sleep(10 * time.Millisecond)
		}
	}()
	p := waitJob(t, "job-live-2000")
	if str(p["status"]) != "done" {
		t.Fatalf("the posting: %v", p["message"])
	}
	for i := 0; i < 400 && len(c.recSent()) < 2000; i++ {
		time.Sleep(25 * time.Millisecond)
	}
	stop.Store(true)
	wg.Wait()
	sent := c.recSent()
	if len(sent) != 2000 {
		t.Fatalf("sent %d of 2000 lines", len(sent))
	}
	seen := map[string]bool{}
	for i, l := range sent {
		if want := fmt.Sprintf("n=%d", i); !strings.HasSuffix(str(l["narration"]), want) {
			t.Fatalf("line %d out of order: %v", i, l["narration"])
		}
		if seen[str(l["line_id"])] {
			t.Fatalf("line %s sent twice", l["line_id"])
		}
		seen[str(l["line_id"])] = true
	}
	mu.Lock()
	defer mu.Unlock()
	for _, n := range during {
		if n != 0 {
			t.Fatal("an upload started while an import was at Tally")
		}
	}
	g := map[int64]bool{}
	for _, x := range gapsSeen {
		if g[x] {
			t.Fatalf("two groups in one gap between imports (gap %d)", x)
		}
		g[x] = true
	}
	if len(importStarts) != 20 {
		t.Fatalf("imports: %d", len(importStarts))
	}
	t.Logf("%d groups during the posting, %d calls in all", len(gapsSeen), len(during))
}

// --- 5. the posting window: a0 from the company check before the job, a1 from one FinComCompany after it, the counts
// from Tally's replies by kind, in the job's last posts_update
func TestWindowValues(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0,"PostBatchBills":2`)
	td := today()
	f.add(td, fgParty, "W-0", "before", "-1.00")
	f.add(td, fgParty, "W-00", "before", "-1.00") // ALTVCHID 2 before the job
	master := `<LEDGER NAME="Window Party" ACTION="Create"><NAME>Window Party</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-window-1", "company": zz, "payload": M{"masters": []any{M{"id": "m1", "xml": master}}, "vouchers": r15Bills("wn", td, 3)}})
	c.mu.Unlock()
	cloudPostTake()
	p := waitJob(t, "job-window-1")
	syncCloudPosts()
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	f.mu.Lock()
	a1 := f.alter
	f.mu.Unlock()
	var win M
	c.mu.Lock()
	for _, b := range c.posts {
		if str(b["id"]) == "job-window-1" && b["window"] != nil {
			if str(b["status"]) != "done" {
				t.Errorf("a window on a %s update", b["status"])
			}
			win = obj(b["window"])
		}
	}
	c.mu.Unlock()
	if win == nil {
		t.Fatal("no window in the job's last posts_update")
	}
	if toI64(win["a0"]) != 2 || toI64(win["a1"]) != a1 || toInt(win["vouchersCreated"]) != 3 || toInt(win["mastersCreated"]) != 1 || str(win["guid"]) != "co-guid-1" {
		t.Fatalf("the window: %v (a1 %d)", win, a1)
	}
	// the FinComCompany reads: one before the first import, one after the last, none between
	ids := f.ids()
	first, last := -1, -1
	for i, id := range ids {
		if id == "Import" {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	for i := first; i <= last; i++ {
		if ids[i] == "FinComCompany" {
			t.Fatalf("a company check during the job: %v", ids[first:last+1])
		}
	}
	if !contains(ids[last:], "FinComCompany") || !contains(ids[:first], "FinComCompany") {
		t.Fatalf("the company checks around the job: %v", ids)
	}
}

// --- 6. the touched-ledger hook: ledgers named in lines read during a posting, one call after the last job ends
func TestLiveTouchedLedgerHook(t *testing.T) {
	rec, _, _ := liveBridge(t, `,"RecorderTouchedQuietMs":150`)
	var mu sync.Mutex
	var calls [][]string
	old := touchedLedgerHookFn
	touchedLedgerHookFn = func(company string, names []string) {
		mu.Lock()
		calls = append(calls, append([]string{company}, names...))
		mu.Unlock()
		old(company, names)
	}
	defer func() { touchedLedgerHookFn = old }()
	n := func() int { mu.Lock(); defer mu.Unlock(); return len(calls) }
	p := liveFilePath(rec, "")
	// read with no posting: nothing collected
	liveAppend(t, p, lLine("after_delete", "l-0", "1", "1", "Quiet Ledger", "Sundry Debtors"))
	liveReadOnce()
	liveTouchedTick()
	time.Sleep(200 * time.Millisecond)
	liveTouchedTick()
	if n() != 0 {
		t.Fatal("the hook ran with no posting")
	}
	// two jobs back to back: lines during both; nothing during them; once after the last
	postTaking.Store(true)
	liveAppend(t, p, lLine("after_delete", "l-1", "2", "2", "Ledger One", "Sundry Debtors"))
	liveReadOnce()
	liveTouchedTick()
	postTaking.Store(false)
	liveTouchedTick() // the gap between the jobs (shorter than the quiet time)
	postTaking.Store(true)
	liveAppend(t, p, lLine("after_delete", "l-2", "3", "3", "Ledger Two", "Sundry Debtors"))
	liveReadOnce()
	time.Sleep(200 * time.Millisecond)
	liveTouchedTick()
	if n() != 0 {
		t.Fatal("the hook ran during a posting")
	}
	postTaking.Store(false)
	liveTouchedTick()
	if n() != 0 {
		t.Fatal("the hook ran before the quiet time")
	}
	time.Sleep(200 * time.Millisecond)
	liveTouchedTick()
	liveTouchedTick()
	mu.Lock()
	got := fmt.Sprint(calls)
	mu.Unlock()
	if got != "[["+zz+" Ledger One Ledger Two]]" {
		t.Fatalf("hook calls: %s", got)
	}
	if logLines("Touched ledgers after the posting in "+zz+": Ledger One, Ledger Two (the ledger check is not built; it is off)") != 1 {
		t.Fatal("the hook's log line")
	}
}

// --- 7a. the recorder state in the beat, per company: read, sent, waiting, the oldest waiting, the source
func TestRecorderBeatState(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	liveAppend(t, p, vchLine("after_delete", "g-1", "1", "1", "a"), vchLine("after_delete", "g-2", "2", "2", "b"))
	liveReadOnce()
	liveUploadOnce()
	liveAppend(t, p, vchLine("after_delete", "g-3", "3", "3", "c"))
	c.mu.Lock()
	c.recReply = func(M) (int, M) { return 500, M{"ok": false} }
	c.mu.Unlock()
	liveReadOnce()
	liveUploadOnce()
	b := beatBody(true, "open", "", nil, nil, nil)
	st := obj(obj(b["recorderState"])[zz])
	if toInt(st["read"]) != 3 || toInt(st["sent"]) != 2 || toInt(st["waiting"]) != 1 || str(st["oldestWaiting"]) == "" || str(st["source"]) != "addon" {
		t.Fatalf("the beat's recorder state: %v", b["recorderState"])
	}
	if str(b["recorderSource"]) != "addon" {
		t.Fatalf("recorderSource: %v", b["recorderSource"])
	}
}

// --- 7b. "Roll back to the previous version": always in the tray, asks yes/no; the kept previous program put back
func TestRecorderRollbackItem(t *testing.T) {
	src := readText("win_tray.go")
	i := strings.Index(src, `"Roll back to the previous version"`)
	if i < 0 {
		t.Fatal("the tray has no rollback item")
	}
	if !regexp.MustCompile(`(?s)case 23:.{0,600}yesNo\(.{0,400}/tray/rollback`).MatchString(src) {
		t.Fatal("the rollback item does not ask yes/no before it calls /tray/rollback")
	}
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key"`)
	dir := t.TempDir()
	exe := filepath.Join(dir, "FinComBridge.exe")
	_ = os.WriteFile(exe, []byte("new 2.2.0"), 0o755)
	oldExe, oldRestart := exePathFn, rollbackRestart
	var restarted atomic.Bool
	exePathFn, rollbackRestart = func() string { return exe }, func() { restarted.Store(true) }
	defer func() { exePathFn, rollbackRestart = oldExe, oldRestart }()
	if code, r := callLocal(t, "POST", "/tray/rollback", "", `{"preview":true}`); code == 200 || !strings.Contains(str(r["error"]), "No previous version is kept on this computer") {
		t.Fatalf("no previous: %d %v", code, r)
	}
	// an update that ran well keeps the previous program (no longer deleted)
	_ = os.WriteFile(filepath.Join(dir, "FinComBridge.old.exe"), []byte("old 2.1.10"), 0o755)
	_ = saveFile(filepath.Join(dir, "update-pending.json"), jsonText(M{"from": "2.1.10", "sha256": fileSHA256(filepath.Join(dir, "FinComBridge.old.exe"))}))
	keepPreviousVersion(dir, "2.1.10")
	if exists(filepath.Join(dir, "FinComBridge.old.exe")) || readText(filepath.Join(dir, "FinComBridge.previous.exe")) != "old 2.1.10" {
		t.Fatal("the previous program is not kept")
	}
	code, pv := callLocal(t, "POST", "/tray/rollback", "", `{"preview":true}`)
	if code != 200 || !strings.Contains(str(pv["confirm"]), "2.1.10") {
		t.Fatalf("preview: %d %v", code, pv)
	}
	if code, _ := callLocal(t, "POST", "/tray/rollback", "https://app.fincom.live", `{"confirm":true}`); code != 403 {
		t.Fatalf("from a web page: %d", code)
	}
	if code, _ := callLocal(t, "POST", "/tray/rollback", "", `{}`); code == 200 {
		t.Fatal("rolled back without the yes")
	}
	if code, r := callLocal(t, "POST", "/tray/rollback", "", `{"confirm":true}`); code != 200 || r["ok"] != true {
		t.Fatalf("rollback: %d %v", code, r)
	}
	time.Sleep(600 * time.Millisecond)
	if readText(exe) != "old 2.1.10" || readText(filepath.Join(dir, "FinComBridge.rolledback.exe")) != "new 2.2.0" || !restarted.Load() {
		t.Fatal("the previous program was not put back")
	}
	loadConfig()
	if !cfgB("NoAutoUpdate") {
		t.Fatal("the rolled-back bridge would update itself again at once")
	}
}

// --- 7c. logs kept 30 days: a date-named copy when rotating; only the bridge's own copies older than 30 days deleted
func TestRecorderLogsKept30Days(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	lf := logFile()
	dir := filepath.Dir(lf)
	base := filepath.Base(lf)
	old, recent := time.Now().AddDate(0, 0, -40), time.Now().AddDate(0, 0, -4)
	mk := func(name string, at time.Time) string {
		p := filepath.Join(dir, name)
		_ = os.WriteFile(p, []byte("x"), 0o644)
		_ = os.Chtimes(p, at, at)
		return p
	}
	o1 := mk(base+"."+old.Format("2006-01-02"), old)
	r1 := mk(base+"."+recent.Format("2006-01-02"), recent)
	other := mk("tally.imp", old)
	otherLog := mk("someone-else.log."+old.Format("2006-01-02"), old)
	// yesterday's log: renamed to its date at the first line of today
	_ = os.WriteFile(lf, []byte("yesterday\r\n"), 0o644)
	y := time.Now().AddDate(0, 0, -1)
	_ = os.Chtimes(lf, y, y)
	writeLog("first line today")
	if readText(filepath.Join(dir, base+"."+y.Format("2006-01-02"))) != "yesterday\r\n" {
		t.Fatal("yesterday's log was not kept under its date")
	}
	if exists(o1) || !exists(r1) || !exists(other) || !exists(otherLog) {
		t.Fatalf("pruned: old %v recent %v other %v otherLog %v", exists(o1), exists(r1), exists(other), exists(otherLog))
	}
	// 5 MB in a day: a second copy of the same date
	big := strings.Repeat("y", 5*1024*1024+10)
	_ = os.WriteFile(lf, []byte(big), 0o644)
	// the copy is named by the log's own date (its time), read once here: a midnight between writing it and the
	// check must not make the test look for the next day's name (CI 06-Oct-2026 ran across midnight)
	bigDay := ""
	if fi, err := os.Stat(lf); err == nil {
		bigDay = fi.ModTime().Format("2006-01-02")
	}
	writeLog("after five megabytes")
	if m, _ := filepath.Glob(filepath.Join(dir, base+"."+bigDay+"*")); len(m) != 1 {
		t.Fatalf("the size rotation: %v", m)
	}
	if !strings.Contains(readText(lf), "after five megabytes") || len(readText(lf)) > 1000 {
		t.Fatal("the log after the rotation")
	}
}

// --- 8. the version, the sheets and the allow-list decision line
func TestRecorderVersion220Sheets(t *testing.T) {
	if BridgeVersion != "2.3.5" { // 2.3.1 (the ledger lines under an invoice's items); the 2.2.0 sheet stays as it was
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	sheet := strings.Join(strings.Fields(readText("../docs/bridge-2.2.0-test-sheet.txt")), " ")
	live := strings.Join(strings.Fields(readText("../docs/recorder-live-sheet.txt")), " ")
	for _, s := range []string{"2.2.0", `C:\ProgramData\FinCom\addon\FinComRecorder.tdl`, "Roll back to the previous version", "recorder-live-sheet.txt"} {
		if !strings.Contains(sheet, s) {
			t.Errorf("the 2.2.0 test sheet does not say %q", s)
		}
	}
	for _, s := range []string{`C:\ProgramData\FinCom\addon\FinComRecorder.tdl`, "F1 (Help) > TDLs & Add-Ons > F4 (Manage Local TDLs)", "FinComRecorderAnyCompany.tdl",
		"never both", "every company", "Loaded", "UNLOAD", "<company GUID>-<yyyymmdd>.txt"} {
		if !strings.Contains(live, s) {
			t.Errorf("the live sheet does not say %q", s)
		}
	}
	for _, f := range []string{sheet, live} {
		if strings.Contains(f, "ZZ TEST") || strings.Contains(f, "GARG") {
			t.Error("a sheet names a company")
		}
	}
	// the fingerprint: the placeholder until the build, then the setup's SHA-256 (as the 2.1.10 sheet test)
	if !strings.Contains(sheet, "(filled in when the setup is built") && !regexp.MustCompile(`Fingerprint: SHA-256 [0-9a-f]{64} \(FinComBridge-Setup-2\.2\.0\.exe`).MatchString(sheet) {
		t.Error("the 2.2.0 test sheet has neither the fingerprint placeholder nor the setup's SHA-256")
	}
	al := readText("../docs/tally-allowlist.md")
	if !regexp.MustCompile(`not yet measured[^;]*; allowed for 2\.3\.5 (only )?by the owner's (standing )?decision of \d{4}-\d{2}-\d{2}`).MatchString(al) || !strings.Contains(al, vchObjectID) ||
		!strings.Contains(al, vchByNumberID) {
		t.Fatal("docs/tally-allowlist.md: no decision line for 2.3.5, or no FinComVoucherByMaster / FinComVoucherByNumber row")
	}
}

// --- the owner's rule for source B (04-Oct, during the build): never on unless allowed; off by itself when Tally takes
// more than 2 s for the list; 60 s at least between two requests, never during a posting

// a bridge with source B switched on by the owner, the starting point recorded, and changes above it in Tally
func sourceBReady(t *testing.T) (*standTally, *standCloud, []M) {
	t.Helper()
	_, f, c := liveBridge(t, "")
	applyRecorderSource(M{"recorderSource": "alterid"})
	td := today()
	f.add(td, fgParty, "SB-1", "one", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions) // the starting point (nothing above it: nothing asked)
	f.mu.Lock()
	f.add(td, fgParty, "SB-2", "two", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	return f, c, sessions
}

func laterBy(t *testing.T, d time.Duration) {
	t.Helper()
	old := nowFn
	at := old().Add(d)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = old })
}

func slowKeepList(f *standTally, d time.Duration) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskKeepList" {
			return d
		}
		return 0
	}
	f.mu.Unlock()
}

func TestSourceBNotDefault(t *testing.T) {
	_, f, _ := liveBridge(t, "")
	if recorderSource() != "addon" {
		t.Fatalf("default source: %s", recorderSource())
	}
	td := today()
	f.add(td, fgParty, "ND-1", "one", "-1.00")
	sessions := openCompaniesWith(fin, true)
	lightCheckOpen(sessions)
	f.mu.Lock()
	f.add(td, fgParty, "ND-2", "two", "-1.00")
	f.mu.Unlock()
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions)
	if f.n("TDSDeskKeepList") != 0 {
		t.Fatal("source B ran without the owner's switch")
	}
	if b := beatBody(true, "open", "", nil, nil, nil); str(b["recorderSource"]) != "addon" {
		t.Fatalf("beat: %v", b["recorderSource"])
	}
}

func TestSourceBSpacingAndPosting(t *testing.T) {
	f, _, _ := sourceBReady(t)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 || f.n("TDSDeskKeepList") != 1 {
		t.Fatalf("first: %d %v", n, err)
	}
	f.mu.Lock()
	f.add(today(), fgParty, "SB-3", "three", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	laterBy(t, 30*time.Second)
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatal("a second request within 60 s")
	}
	laterBy(t, 31*time.Second)
	postTaking.Store(true)
	n, _ := liveSourceB(zz, f.port)
	postTaking.Store(false)
	if n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatal("a request during a posting")
	}
	if n, err := liveSourceB(zz, f.port); err != nil || n != 1 || f.n("TDSDeskKeepList") != 2 {
		t.Fatalf("after 61 s: %d %v", n, err)
	}
}

// 2.3.1 (the owner's last change): a list stopped at 2 s never turns source B off; it is asked again by itself on the
// shared retry schedule (retry.go), and the beat carries no switch-off
func TestSourceBOffAfterSlowAnswer(t *testing.T) {
	f, _, sessions := sourceBReady(t)
	slowKeepList(f, 2500*time.Millisecond)
	_, _ = liveSourceB(zz, f.port)
	if f.n("TDSDeskKeepList") != 1 {
		t.Fatal("not asked")
	}
	// 2.2.2 (the owner's condition b): a hard stop at 2 s: the bridge stops waiting then (not at 2.5 s)
	if logLines("off: Tally took") != 0 || logLines("(TDSDeskKeepList, try 1); trying again by itself at") != 1 {
		t.Fatalf("the log: %s", readText(logFile()))
	}
	b := beatBody(true, "open", "", nil, nil, nil)
	if len(obj(b["recorderSourceB"])) != 0 || !strings.HasPrefix(str(obj(b["tallyRetry"])["words"]), "Tally did not answer in time at ") {
		t.Fatalf("the beat: %v %v", b["recorderSourceB"], b["tallyRetry"])
	}
	slowKeepList(f, 0)
	f.mu.Lock()
	f.add(today(), fgParty, "SB-4", "four", "-1.00")
	f.mu.Unlock()
	laterBy(t, 10*time.Minute)
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	lightCheckOpen(sessions) // the light check sees the counter moved and asks source B (by itself: no owner's switch)
	// the stopped request took nothing: SB-2 comes now with SB-4
	if f.n("TDSDeskKeepList") != 2 || logLines("Recorder (Tally's change list) for "+zz+": 2 change(s) found") != 1 {
		t.Fatalf("source B not asked again by itself: %v\n%s", f.ids(), readText(logFile()))
	}
	if b := beatBody(true, "open", "", nil, nil, nil); b["tallyRetry"] != nil {
		t.Fatalf("the beat after an answer in time: %v", b["tallyRetry"])
	}
}

// nothing is kept switched off across a restart (2.3.1)
func TestSourceBStaysOffAfterRestart(t *testing.T) {
	f, _, _ := sourceBReady(t)
	slowKeepList(f, 2500*time.Millisecond)
	_, _ = liveSourceB(zz, f.port)
	slowKeepList(f, 0)
	liveResetState()                                    // a restart
	applyRecorderSource(M{"recorderSource": "alterid"}) // the same value the beat gave when it stopped
	laterBy(t, 10*time.Minute)
	f.mu.Lock()
	f.add(today(), fgParty, "SB-5", "five", "-1.00")
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	if n, err := liveSourceB(zz, f.port); err != nil || n != 2 || f.n("TDSDeskKeepList") != 2 {
		t.Fatalf("source B not asked after a restart: %d %v", n, err)
	}
	if st := obj(beatBody(true, "open", "", nil, nil, nil)["recorderSourceB"]); len(st) != 0 {
		t.Fatalf("the beat after the restart: %v", st)
	}
}

// no owner's switch is needed: it goes again by itself (2.3.1); the owner's switch changes nothing of it
func TestSourceBBackOnOwnerSwitch(t *testing.T) {
	f, _, _ := sourceBReady(t)
	slowKeepList(f, 2500*time.Millisecond)
	_, _ = liveSourceB(zz, f.port)
	slowKeepList(f, 0)
	laterBy(t, 10*time.Second)
	if n, _ := liveSourceB(zz, f.port); n != 0 || f.n("TDSDeskKeepList") != 1 {
		t.Fatal("asked before the retry's time")
	}
	f.mu.Lock()
	f.add(today(), fgParty, "SB-6", "six", "-1.00")
	f.mu.Unlock()
	laterBy(t, 10*time.Minute)
	_, _ = companyCheck(fin, zz, f.port)
	// 2.2.2: the slow request was stopped at 2 s (nothing taken from it): SB-2 comes now with SB-6
	if n, err := liveSourceB(zz, f.port); err != nil || n != 2 || f.n("TDSDeskKeepList") != 2 {
		t.Fatalf("by itself: %d %v", n, err)
	}
	if logLines("Source B on again for "+zz) != 0 {
		t.Fatal("an owner's switch was needed")
	}
}
