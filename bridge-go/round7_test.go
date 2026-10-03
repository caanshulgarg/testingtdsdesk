package main

// Round 7 (03-Oct-2026): the code review of be5542f..adabade, bridge side (F2, F4, F5, F6, F9)

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- F2. an owner's release ("Not in Tally — release") newer than the acceptance lets the entry go ONCE more (through
// the sameId check); a release older than the acceptance does not. The release comes with the job from posts_take
func TestReleasedEntrySentOnceMore(t *testing.T) {
	hide := true
	f := r6Tally(t, func() bool { return hide })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"PostRecheckMs":200,"PostRecheckTries":1`)
	id := "emuqtw0683g090"
	x := f1Voucher(id, "")
	vch := []any{M{"id": id, "xml": x}}
	if _, err := newPostJob(M{"jobId": "job-rel-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-rel-1")
	a := acceptedInfo(id)
	if a == nil || str(a["acceptedAt"]) == "" {
		t.Fatalf("no acceptance with its time: %v", a)
	}
	if _, err := time.Parse(time.RFC3339, str(a["acceptedAt"])); err != nil {
		t.Fatalf("acceptedAt %q is not RFC3339", a["acceptedAt"])
	}
	// a release OLDER than the acceptance (a stale one): not sent
	older := time.Now().Add(-time.Hour).Format(time.RFC3339)
	if _, err := newPostJob(M{"jobId": "job-rel-2", "company": zz, "vouchers": vch, "released": []any{M{"id": id, "at": older, "by": "Anshul", "why": "stale"}}}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-rel-2")
	if f.n("Import") != 1 || r6States(p)[id] != "unknown" {
		t.Fatalf("a stale release sent the entry again: %d imports, %v", f.n("Import"), r6States(p))
	}
	// a release NEWER than the acceptance (the owner pressed it after Tally's acceptance), handed over by the cloud with
	// the job (posts_take): sent once more
	time.Sleep(1100 * time.Millisecond) // acceptance times are to the second
	newer := time.Now().Format(time.RFC3339)
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-rel-3", "company": zz, "payload": M{"vouchers": vch}, "released": []any{M{"id": id, "at": newer, "by": "Anshul", "why": "not in Tally"}}})
	c.mu.Unlock()
	cloudPostTake()
	p = r6Done(t, "job-rel-3")
	if f.n("Import") != 2 {
		t.Fatalf("the released entry was not sent once more (%d imports)", f.n("Import"))
	}
	if logLines("entry "+id+": released by Anshul at "+newer+" (not in Tally); sent once more") < 1 {
		t.Fatal("the release is not logged as required")
	}
	if a2 := acceptedInfo(id); a2 == nil || str(a2["acceptedAt"]) < newer || str(a2["job"]) != "job-rel-3" {
		t.Fatalf("the note was not replaced by the new acceptance: %v", a2)
	}
	if r6States(p)[id] != "unknown" {
		t.Fatalf("after the second send: %v", r6States(p))
	}
	// the same release again (now older than the new acceptance): not sent a third time
	if _, err := newPostJob(M{"jobId": "job-rel-4", "company": zz, "vouchers": vch, "released": []any{M{"id": id, "at": newer, "by": "Anshul", "why": "not in Tally"}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-rel-4")
	if f.n("Import") != 2 {
		t.Fatalf("a release older than the new acceptance sent it again (%d imports)", f.n("Import"))
	}
	// the acceptance reported to the cloud carries acceptedAt
	syncCloudPosts()
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.mu.Unlock()
	found := false
	for _, b := range posts {
		for _, x := range arr(b["results"]) {
			r := obj(x)
			if r["accepted"] == true && str(r["acceptedAt"]) != "" {
				if _, err := time.Parse(time.RFC3339, str(r["acceptedAt"])); err == nil {
					found = true
				}
			}
		}
	}
	if !found {
		t.Fatalf("no posts_update carries acceptedAt for the accepted entry: %d bodies", len(posts))
	}
}

// --- F4. every posts_update of a job carries a strictly increasing seq (kept in progress.json across a restart) and updatedAt
func TestPostsUpdateSeqIncreases(t *testing.T) {
	hide := true
	f := r6Tally(t, func() bool { return hide })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"PostRecheckMs":200,"PostRecheckTries":1,"CloudPostSyncSec":0`)
	id := "emuqtw0683g090"
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-seq-1", "company": zz, "payload": M{"vouchers": []any{M{"id": id, "xml": f1Voucher(id, "")}}}})
	c.mu.Unlock()
	cloudPostTake()
	dir, _ := jobDir("job-seq-1")
	for i := 0; i < 100 && jobAlive("job-seq-1"); i++ {
		syncCloudPosts()
		time.Sleep(50 * time.Millisecond)
	}
	syncCloudPosts()
	// a restart: the worker gone, the job handed back and run again (recheck): seq goes on from progress.json
	p := readProgress(dir)
	before := toInt(p["seq"])
	if before <= 0 {
		t.Fatalf("no seq in progress.json: %v", p["seq"])
	}
	hide = false
	if _, err := newPostJob(M{"jobId": "job-seq-1", "company": zz, "vouchers": []any{M{"id": id, "xml": f1Voucher(id, "")}}}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100 && jobAlive("job-seq-1"); i++ {
		syncCloudPosts()
		time.Sleep(50 * time.Millisecond)
	}
	syncCloudPosts()
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.mu.Unlock()
	last, n := 0, 0
	for _, b := range posts {
		if str(b["id"]) != "job-seq-1" {
			continue
		}
		n++
		seq := toInt(b["seq"])
		if seq <= last {
			t.Fatalf("posts_update seq %d after %d (update %d of the job)", seq, last, n)
		}
		if _, err := time.Parse(time.RFC3339Nano, str(b["updatedAt"])); err != nil {
			t.Fatalf("posts_update without a proper updatedAt: %v", b["updatedAt"])
		}
		last = seq
	}
	if n < 2 || last <= before { // at least one update before and one after the restart (how many in between depends on timing)
		t.Fatalf("%d updates, last seq %d (before the restart %d)", n, last, before)
	}
}

// --- F5. a partial fast batch (CREATED 2, ERRORS 1 of 3): the entries not found by tag are HELD (unknown), never imported
// one by one; a later check confirms the one Tally made
func TestPartialFastBatchHolds(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.ansi = true
	hide := true
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:fb3") } // Tally refuses the third
	f.storeNarr = func(n string) string {                                            // the second is kept without its tag: not found by the day's read
		if strings.Contains(n, "TDSDesk:fb2") {
			return f1NoTag(n)
		}
		return n
	}
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "FinComByMaster" && hide {
			_, _ = w.Write([]byte("<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>"))
			return true
		}
		return false
	}
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	vch := []any{
		M{"id": "fb1", "xml": finVoucher("fb1", fgParty, "FB-1", td, "1.00")},
		M{"id": "fb2", "xml": finVoucher("fb2", fgParty, "FB-2", td, "2.00")},
		M{"id": "fb3", "xml": finVoucher("fb3", fgParty, "FB-3", td, "3.00")},
	}
	if _, err := newPostJob(M{"jobId": "job-fast-partial", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-fast-partial")
	if f.n("Import") != 1 {
		t.Fatalf("%d imports: an entry of the partial batch was imported again one by one", f.n("Import"))
	}
	st := r6States(p)
	if st["fb1"] != "in_tally" || st["fb2"] != "unknown" || st["fb3"] != "unknown" || str(p["status"]) == "failed" {
		t.Fatalf("after the batch: %v (%s)", st, p["status"])
	}
	// the one Tally made shows up (its tag read back): confirmed, still one import; the refused one stays unknown (held)
	f.mu.Lock()
	for _, v := range f.vch {
		if v.no == "FB-2" {
			v.narr = "Electricity | TDSDesk:fb2"
		}
	}
	f.mu.Unlock()
	if _, err := newPostJob(M{"jobId": "job-fast-partial", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-fast-partial")
	st = r6States(p)
	if f.n("Import") != 1 || st["fb2"] != "in_tally" || st["fb3"] != "unknown" {
		t.Fatalf("after the recheck: %v (%d imports)", st, f.n("Import"))
	}
	f.mu.Lock()
	n := len(f.vch)
	f.mu.Unlock()
	if n != 2 {
		t.Fatalf("%d vouchers in Tally, want 2", n)
	}
}

// --- F6. a confirmation by Tally's voucher id with no tag in the narration goes into the copy only when the head's
// type, date and party are those of the entry sent; otherwise the keeper reads the day
func TestVoucherIdConfirmNeedsMatchForCopy(t *testing.T) {
	x := f1Voucher("m1", "")
	h := M{"type": "Journal", "date": f1Date, "party": foldName("VIVEK GUPTA & ASSOCIATES")}
	if !headMatchesXML(h, x) {
		t.Fatal("the matching head is refused")
	}
	for _, bad := range []M{{"type": "Payment", "date": f1Date, "party": h["party"]}, {"type": "Journal", "date": "20260205", "party": h["party"]}, {"type": "Journal", "date": f1Date, "party": foldName("Someone Else")}} {
		if headMatchesXML(bad, x) {
			t.Fatalf("a head that is not the entry's is accepted: %v", bad)
		}
	}
	for _, same := range []bool{true, false} {
		f := newStandTally(t)
		f.ansi = true
		f.storeNarr = f1NoTag
		if !same {
			f.storeParty = func(p string) string { return "Someone Else" }
		}
		standBridge(t, f, "")
		liveFrom(f1Date[:6] + "01")
		r := postOne(t, "m1", x)
		if r["verified"] != true {
			t.Fatalf("not confirmed by the voucher id: %v", r)
		}
		line := readText(filepath.Join(syncFolder(zz), "posted-in.jsonl"))
		if same && !strings.Contains(line, "TDSDesk:m1") {
			t.Fatal("the matching entry was not put in the copy")
		}
		if !same && strings.Contains(line, "TDSDesk:m1") {
			t.Fatal("an entry whose head does not match was put in the copy")
		}
		if !same && logLines("not put in the copy") < 1 {
			t.Fatal("the log does not say the copy was left to the keeper")
		}
	}
}

// --- F9. one key for an entry everywhere (the id in its tag): a bank-line id "sid-3" and an entry with a hash tag
func TestAcceptedKeyOneForBankLine(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	bank := strings.Replace(f1Voucher("sid-3", ""), "| TDSDesk:sid-3", "", 1) // no tag of its own: the bridge stamps TDSDesk:sid3
	hash := strings.Replace(f1Voucher("x", ""), "| TDSDesk:x", "", 1)         // an id with no letters or digits: a hash tag
	if _, err := newPostJob(M{"jobId": "job-sid-1", "company": zz, "vouchers": []any{M{"id": "sid-3", "xml": bank}, M{"id": "-#-", "xml": hash}}}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-sid-1")
	notes := readObjFile(acceptedFile())
	if len(notes) != 2 || obj(notes["sid3"]) == nil || str(obj(notes["sid3"])["job"]) != "job-sid-1" {
		t.Fatalf("posted-ids.json: %v", notes)
	}
	hashKey := ""
	for k := range notes {
		if strings.HasPrefix(k, "B") && len(k) == 17 {
			hashKey = k
		}
	}
	if hashKey == "" || str(obj(notes[hashKey])["job"]) != "job-sid-1" {
		t.Fatalf("the hash-tagged entry is not under its tag key with its job: %v", notes)
	}
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if !strings.Contains(str(r["message"]), "job") || strings.Contains(str(r["message"]), "job )") {
			t.Fatalf("the message names no job: %v", r)
		}
	}
	// the same two again in another job: refused on the one key, the reason naming job-sid; nothing sent
	imports := f.n("Import") // the first job: one import per voucher
	if _, err := newPostJob(M{"jobId": "job-sid-x2", "company": zz, "vouchers": []any{M{"id": "sid-3", "xml": bank}, M{"id": "-#-", "xml": hash}}}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-sid-x2")
	if f.n("Import") != imports {
		t.Fatalf("the second job sent again: %d imports, had %d", f.n("Import"), imports)
	}
	for _, x := range arr(p["items"]) {
		e := obj(x)
		if str(e["state"]) != "unknown" || !strings.Contains(str(e["reason"]), "job-sid-1") {
			t.Fatalf("the item: %v", e)
		}
	}
	_ = os.Remove(filepath.Join(syncFolder(zz), "x"))
}

// --- M3. the measure routes never take a report path: the report is always under Home with the safe default name
func TestMeasureRouteIgnoresOut(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key","TallyMaxSec":1`)
	elsewhere := filepath.Join(t.TempDir(), "x", "y.bat")
	for _, p := range []string{"/measure", "/tray/measure"} {
		code, res := callLocal(t, "POST", p, "", `{"company":"ZZ TEST","out":`+jsonText(elsewhere)+`}`)
		if code != 200 || res["ok"] != true {
			t.Fatalf("POST %s: %d %v", p, code, res)
		}
		var st M
		for i := 0; i < 200; i++ {
			st = measureStatus()
			if str(st["state"]) != "running" {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if str(st["state"]) != "done" {
			t.Fatalf("%s: %v", p, st)
		}
		if exists(elsewhere) {
			t.Fatalf("%s wrote the report to the caller's path %s", p, elsewhere)
		}
		file := str(st["file"])
		if !strings.HasPrefix(file, Home) || !strings.HasPrefix(filepath.Base(file), "measure-ZZ_TEST-") || !exists(file) {
			t.Fatalf("%s: the report is not under Home with the default name: %q", p, file)
		}
		measureMu.Lock()
		measureLast = nil
		measureMu.Unlock()
	}
}

// --- L1. posted-ids.json: loaded once, written through atomically; a write failure is logged loudly and the entry stays
// unknown (held in memory, never sent); verified notes older than 180 days are pruned, unverified ones never
func TestPostedIdsWriteFailureHolds(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, `,"PostRecheckMs":200,"PostRecheckTries":1`)
	// pruning on load
	old := time.Now().AddDate(0, 0, -200).Format(time.RFC3339)
	_ = saveFile(acceptedFile(), jsonText(M{
		"oldver":   M{"verified": true, "verifiedAt": old, "acceptedAt": old, "job": "j0", "masterId": "5"},
		"oldunver": M{"verified": false, "acceptedAt": old, "job": "j0", "lastVchId": "6"},
		"newver":   M{"verified": true, "verifiedAt": time.Now().Format(time.RFC3339), "job": "j1", "masterId": "7"},
	}))
	acceptedReset()
	if acceptedInfo("oldver") != nil || acceptedInfo("oldunver") == nil || acceptedInfo("newver") == nil {
		t.Fatalf("pruning: oldver %v, oldunver %v, newver %v", acceptedInfo("oldver"), acceptedInfo("oldunver"), acceptedInfo("newver"))
	}
	noteAccepted("k1", zz, "j2", "8")
	after := readObjFile(acceptedFile())
	if after["oldver"] != nil || after["oldunver"] == nil || after["k1"] == nil {
		t.Fatalf("the file after a write-through: %v", after)
	}
	if _, err := os.Stat(acceptedFile() + ".tmp"); err == nil {
		t.Fatal("the temporary file was left behind")
	}
	// a write failure: the file's place taken by a directory
	_ = os.Remove(acceptedFile())
	_ = os.MkdirAll(acceptedFile(), 0o755)
	t.Cleanup(func() { _ = os.RemoveAll(acceptedFile()) })
	id := "emuqtw0683g090"
	vch := []any{M{"id": id, "xml": f1Voucher(id, "")}}
	if _, err := newPostJob(M{"jobId": "job-wf-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-wf-1")
	if logLines("posted-ids.json") < 1 || logLines("could not be written") < 1 {
		t.Fatal("the write failure is not logged loudly")
	}
	if r6States(p)[id] != "unknown" {
		t.Fatalf("the entry: %v", r6States(p))
	}
	// held in memory: a second job for the id is still refused, nothing sent
	if _, err := newPostJob(M{"jobId": "job-wf-2", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-wf-2")
	if f.n("Import") != 1 || r6States(p)[id] != "unknown" {
		t.Fatalf("after the write failure the entry went again: %d imports, %v", f.n("Import"), r6States(p))
	}
}

// --- L3. the console: a bridge that listens but does not answer is "busy" (not measured, exit 1), only "connection
// refused" means no bridge; the follow of a running bridge ends after its cap with a message
func TestConsoleMeasureBusyAndCap(t *testing.T) {
	local := 0
	localRun := func() (M, error) { local++; return M{"report": "r", "file": "f"}, nil }
	code, said := consoleMeasure(measureOpts{company: zz}, "busy", nil, nil, localRun)
	if code != 1 || local != 0 || !strings.Contains(said, "Not measured: the bridge on this computer is busy") {
		t.Fatalf("busy: code %d, local %d, said %q", code, local, said)
	}
	wasEvery, wasMax := measureFollowEvery, measureFollowMax
	measureFollowEvery, measureFollowMax = 5*time.Millisecond, 60*time.Millisecond
	t.Cleanup(func() { measureFollowEvery, measureFollowMax = wasEvery, wasMax })
	polls := 0
	code, said = consoleMeasure(measureOpts{company: zz}, "up", func() M { return M{"ok": true, "state": "running"} }, func() M { polls++; return M{"state": "running"} }, localRun)
	if code != 1 || local != 0 || polls < 3 || !strings.Contains(said, "still running in the bridge; see the tray") {
		t.Fatalf("the cap: code %d, local %d, polls %d, said %q", code, local, polls, said)
	}
	// the classification of the ping: nothing listening -> none; a listener that never answers -> busy
	free := freePort(t)
	if st := bridgeState(free); st != "none" {
		t.Fatalf("no listener: %q", st)
	}
	ln := slowListener(t)
	if st := bridgeState(ln); st != "busy" {
		t.Fatalf("a listener that does not answer: %q", st)
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return p
}

// a port with a listener that accepts and never answers
func slowListener(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() { time.Sleep(10 * time.Second); _ = c.Close() }()
		}
	}()
	return l.Addr().(*net.TCPAddr).Port
}
