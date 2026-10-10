package main

// Round 7 (03-Oct-2026): the code review of be5542f..adabade, bridge side (F2, F4, F5, F6, F9). Round 15 (the owner's
// decision of 03-Oct-2026): the held-entry and read-back rules are replaced by Tally's reply and this computer's record.

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- F2. an owner's release ("Not in Tally — release") handed by the cloud with a job lets an entry on this computer's
// record go ONCE more; the same release handed again does not (round 8: the cloud alone judges a release)
func TestReleasedEntrySentOnceMore(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	id := "emuqtw0683g090"
	x := f1Voucher(id, "")
	vch := []any{M{"id": id, "xml": x}}
	if _, err := newPostJob(M{"jobId": "job-rel-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-rel-1")
	a := acceptedInfo(id)
	if a == nil || a["sent"] != true || str(a["sentAt"]) == "" {
		t.Fatalf("no record with its time: %v", a)
	}
	if _, err := time.Parse(time.RFC3339, str(a["sentAt"])); err != nil {
		t.Fatalf("sentAt %q is not RFC3339", a["sentAt"])
	}
	// without a release: refused on the record
	if _, err := newPostJob(M{"jobId": "job-rel-2", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	if p := r6Done(t, "job-rel-2"); f.n("Import") != 1 || r6States(p)[id] != "failed" {
		t.Fatalf("sent again without a release: %d imports, %v", f.n("Import"), r6States(p))
	}
	// a release handed over by the cloud with the job (posts_take): sent once more
	time.Sleep(1100 * time.Millisecond) // record times are to the second
	newer := time.Now().Format(time.RFC3339)
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-rel-3", "company": zz, "payload": M{"vouchers": vch}, "released": []any{M{"id": id, "at": newer, "by": "Anshul", "why": "not in Tally"}}})
	c.mu.Unlock()
	cloudPostTake()
	p := r6Done(t, "job-rel-3")
	if f.n("Import") != 2 {
		t.Fatalf("the released entry was not sent once more (%d imports)", f.n("Import"))
	}
	if r6States(p)[id] != "posted" {
		t.Fatalf("after the resend: %v", r6States(p))
	}
	if logLines("entry "+id+": released by Anshul at "+newer+" (not in Tally); sent once more") < 1 {
		t.Fatal("the release is not logged as required")
	}
	if a2 := acceptedInfo(id); a2 == nil || str(a2["sentAt"]) < newer || str(a2["job"]) != "job-rel-3" {
		t.Fatalf("the record was not replaced by the new send: %v", a2)
	}
	// the same release again (honoured already): not sent a third time
	if _, err := newPostJob(M{"jobId": "job-rel-4", "company": zz, "vouchers": vch, "released": []any{M{"id": id, "at": newer, "by": "Anshul", "why": "not in Tally"}}}); err != nil {
		t.Fatal(err)
	}
	r6Done(t, "job-rel-4")
	if f.n("Import") != 2 {
		t.Fatalf("a release honoured already sent it again (%d imports)", f.n("Import"))
	}
	// the posting reported to the cloud carries sentAt (RFC3339) and byReply
	syncCloudPosts()
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.mu.Unlock()
	found := false
	for _, b := range posts {
		for _, x := range arr(b["results"]) {
			r := obj(x)
			if r["byReply"] == true && str(r["sentAt"]) != "" {
				if _, err := time.Parse(time.RFC3339, str(r["sentAt"])); err == nil {
					found = true
				}
			}
		}
	}
	if !found {
		t.Fatalf("no posts_update carries sentAt for the posted entry: %d bodies", len(posts))
	}
}

// --- F4. every posts_update of a job carries a strictly increasing seq (kept in progress.json across a restart) and updatedAt
func TestPostsUpdateSeqIncreases(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
	id := "emuqtw0683g090"
	refuse := true
	f.importSkip = func(string) bool { return refuse } // Tally refuses at first: the job fails and is retried
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
	// a restart: the worker gone, the job handed back and retried: seq goes on from progress.json
	p := readProgress(dir)
	before := toInt(p["seq"])
	if before <= 0 || str(p["status"]) != "failed" {
		t.Fatalf("no seq in progress.json, or the first run did not fail: %v %v", p["seq"], p["status"])
	}
	f.mu.Lock()
	refuse = false
	f.mu.Unlock()
	// handed back by the cloud (posts_take with the same id): the retry reports under the same job
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-seq-1", "company": zz, "payload": M{"vouchers": []any{M{"id": id, "xml": f1Voucher(id, "")}}}})
	c.mu.Unlock()
	cloudPostTake()
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

// --- F5. a partial batch (CREATED 2, ERRORS 1 of 3): round 15 (the owner's decision of 03-Oct-2026): every entry of
// the request needs review with Tally's counts, all three are recorded as sent (which ones Tally made is not known and
// no voucher id is inferred), nothing is imported one by one, and a later job never sends them; Check Tally settles it
func TestPartialBatchNeedsReview(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.ansi = true
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:fb3") } // Tally refuses the third
	standBridge(t, f, "")
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
	if st["fb1"] != "needs_review" || st["fb2"] != "needs_review" || st["fb3"] != "needs_review" || str(p["status"]) != "done" {
		t.Fatalf("after the batch: %v (%s)", st, p["status"])
	}
	if str(p["message"]) != "Posted 0 of 3; 3 need review" {
		t.Fatalf("the job's line: %q", p["message"])
	}
	for _, k := range []string{"fb1", "fb2", "fb3"} {
		if a := acceptedInfo(k); a == nil || a["sent"] != true || toInt(a["batchN"]) != 3 || str(a["vchId"]) != "" {
			t.Fatalf("%s: the record: %v", k, a)
		}
	}
	// a later job with the same ids: refused on the record, still one import
	if _, err := newPostJob(M{"jobId": "job-fast-partial-2", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-fast-partial-2")
	st = r6States(p)
	if f.n("Import") != 1 || st["fb1"] != "failed" || st["fb3"] != "failed" {
		t.Fatalf("after the later job: %v (%d imports)", st, f.n("Import"))
	}
	for _, x := range arr(p["results"]) {
		if r := obj(x); r["alreadySent"] != true || !strings.Contains(str(r["message"]), "sent in a batch of 3") {
			t.Fatalf("the later job's result: %v", r)
		}
	}
	f.mu.Lock()
	n := len(f.vch)
	f.mu.Unlock()
	if n != 2 {
		t.Fatalf("%d vouchers in Tally, want 2", n)
	}
}

// --- F6. the head-matches-the-entry rule (kept for Check Tally and the copy; round 15: no posting confirms by voucher id)
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
	// a posting writes nothing into the copy itself: the keeper reads the day after the posting (afterPosting)
	f := newStandTally(t)
	f.ansi = true
	f.storeNarr = f1NoTag
	standBridge(t, f, "")
	liveFrom(f1Date[:6] + "01")
	if r := postOne(t, "m1", x); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	if line := readText(filepath.Join(syncFolder(zz), "posted-in.jsonl")); strings.Contains(line, "TDSDesk:m1") {
		t.Fatal("the posting wrote the entry into the copy without a read (round 15: the keeper reads the day)")
	}
}

// --- F9. one key for an entry everywhere (the id in its tag): a bank-line id "sid-3" and an entry with a hash tag
func TestAcceptedKeyOneForBankLine(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, "")
	bank := strings.Replace(f1Voucher("sid-3", ""), "| TDSDesk:sid-3", "", 1) // no tag of its own: the bridge stamps TDSDesk:sid3
	hash := strings.Replace(f1Voucher("x", ""), "| TDSDesk:x", "", 1)         // an id with no letters or digits: a hash tag
	if _, err := newPostJob(M{"jobId": "job-sid-1", "company": zz, "vouchers": []any{M{"id": "sid-3", "xml": bank}, M{"id": "-#-", "xml": hash}}}); err != nil {
		t.Fatal(err)
	}
	p := r6Done(t, "job-sid-1")
	if str(p["status"]) != "done" {
		t.Fatalf("the first job: %v", p["message"])
	}
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
	// the same two again in another job: refused on the one key, the reason naming job-sid-1; nothing sent
	imports := f.n("Import")
	if _, err := newPostJob(M{"jobId": "job-sid-x2", "company": zz, "vouchers": []any{M{"id": "sid-3", "xml": bank}, M{"id": "-#-", "xml": hash}}}); err != nil {
		t.Fatal(err)
	}
	p = r6Done(t, "job-sid-x2")
	if f.n("Import") != imports {
		t.Fatalf("the second job sent again: %d imports, had %d", f.n("Import"), imports)
	}
	for _, x := range arr(p["items"]) {
		e := obj(x)
		if str(e["state"]) != "failed" || e["alreadySent"] != true || !strings.Contains(str(e["reason"]), "job job-sid-1") {
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

// --- L1. posted-ids.json: loaded once, written through atomically; a write failure is logged loudly and stops every
// send (F1 of the fix review); verified notes older than 180 days are pruned, unverified ones never
func TestPostedIdsWriteFailureHolds(t *testing.T) {
	f := r6Tally(t, func() bool { return true })
	standBridge(t, f, "")
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
	noteSent("k1", zz, "j2", "8", 1, "8", "8")
	after := readObjFile(acceptedFile())
	if after["oldver"] != nil || after["oldunver"] == nil || after["k1"] == nil {
		t.Fatalf("the file after a write-through: %v", after)
	}
	if _, err := os.Stat(acceptedFile() + ".tmp"); err == nil {
		t.Fatal("the temporary file was left behind")
	}
	// older notes still refuse: one Tally accepted (unverified) and one confirmed in Tally before
	td := today()
	for _, id := range []string{"oldunver", "newver"} {
		if r := postOne(t, id, finVoucher(id, fgParty, "OLD-"+id, td, "1.00")); r["alreadySent"] != true {
			t.Fatalf("an older note did not refuse %s: %v", id, r)
		}
	}
	// a write failure: the file's place taken by a directory. Fix review of 2.1.8 (F1): nothing goes to Tally without the
	// record on disk: the job waits ("record not written; nothing sent"), sends nothing, and goes on once the file can be
	// written (TestNoSendWhenRecordNotWritable); here it is cancelled while waiting
	_ = os.Remove(acceptedFile())
	_ = os.MkdirAll(acceptedFile(), 0o755)
	t.Cleanup(func() { _ = os.RemoveAll(acceptedFile()) })
	id := "emuqtw0683g090"
	vch := []any{M{"id": id, "xml": f1Voucher(id, "")}}
	if _, err := newPostJob(M{"jobId": "job-wf-1", "company": zz, "vouchers": vch}); err != nil {
		t.Fatal(err)
	}
	jd, _ := jobDir("job-wf-1")
	var p M
	for i := 0; i < 100; i++ {
		p = readProgress(jd)
		if p != nil && str(p["status"]) == "waiting" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(p["status"]) != "waiting" || f.n("Import") != 0 {
		t.Fatalf("with the record unwritable: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	if logLines("posted-ids.json") < 1 || logLines("could not be written") < 1 || logLines("record not written; nothing sent") < 1 {
		t.Fatal("the write failure is not logged loudly")
	}
	if _, err := cancelJob("job-wf-1", "test"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 60 && jobAlive("job-wf-1"); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if f.n("Import") != 0 {
		t.Fatalf("sent without the record on disk (%d imports)", f.n("Import"))
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
