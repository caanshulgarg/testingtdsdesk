package main

// The review of the bridge audit's fixes (22-Nov-2026): the first part after history, the pace by size, a timeout,
// the version change, the PostBatchBills cap with pacing on, and the cancelled posting's report. Stand-ins only.
import (
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// vouchers of a given XML size (bytes)
func reviewVch(prefix string, n, size int) []M {
	var out []M
	for i := 0; i < n; i++ {
		x := "<VOUCHER>" + strings.Repeat("x", maxI(0, size-19)) + "</VOUCHER>"
		out = append(out, M{"id": fmt.Sprintf("%s%03d", prefix, i), "xml": x})
	}
	return out
}

// a part's time at a stand Tally that costs msKB a KB of XML
func reviewSecs(r importReq, msKB float64) float64 {
	kb := 0.0
	for _, it := range r.items {
		kb += paceKB(it)
	}
	return kb * msKB / 1000
}

func reviewPaceStart(t *testing.T, extra string) {
	t.Helper()
	f := newStandTally(t)
	standBridge(t, f, extra)
	postPaceReset()
	t.Cleanup(postPaceReset)
}

// 1. the reviewer's case: a company whose history is light bills (200 bytes, fast), then a job of heavy bills (8 KB
// each): the first request is predicted, and takes, 2 s at most, never 10 heavy bills at the light bills' pace
func TestReviewHeavyBillsAfterLightHistory(t *testing.T) {
	reviewPaceStart(t, "")
	const msKB = 250.0 // the stand: 250 ms a KB (a 200-byte bill ~50 ms, an 8 KB bill 2 s... 8 KB = 2000 ms)
	q := newPostQueueFor(zz, "co-guid-1", nil, reviewVch("lt", 200, 200))
	for i := 0; i < 12 && q.left(); i++ {
		r := q.next()
		q.done(r, reviewSecs(r, msKB), nil)
	}
	postPaceFlush()
	// heavy bills: 6 KB each (1.5 s each at the stand)
	q = newPostQueueFor(zz, "co-guid-1", nil, reviewVch("hv", 20, 6*1024))
	r := q.next()
	if secs := reviewSecs(r, msKB); secs > 2.0 || len(r.items) > 1 {
		t.Fatalf("the first heavy part: %d bills, %.2f s at Tally (over 2 s)", len(r.items), secs)
	}
	for i := 0; i < 6 && q.left(); i++ {
		q.done(r, reviewSecs(r, msKB), nil)
		r = q.next()
		if len(r.items) > 1 && reviewSecs(r, msKB) > 2.0 {
			t.Fatalf("a heavy part of %d: %.2f s", len(r.items), reviewSecs(r, msKB))
		}
	}
}

// 1. a job's first part: min(PostBatchBills 10, the company's last whole part), with pacing on
func TestReviewFirstPartAfterHistory(t *testing.T) {
	reviewPaceStart(t, "")
	// a fast company (10 ms a voucher): its parts grow to 40 in a job
	q := newPostQueueFor(zz, "co-guid-1", nil, reviewVch("fa", 400, 200))
	for i := 0; i < 6 && q.left(); i++ {
		r := q.next()
		q.done(r, 0.01*float64(len(r.items)), nil)
	}
	if n := len(newPostQueueFor(zz, "co-guid-1", nil, reviewVch("fb", 400, 200)).next().items); n != 10 {
		t.Fatalf("the next job's first part after parts of 40+: %d (want PostBatchBills 10)", n)
	}
	// a company whose last whole part was 3: the next job starts at 3 at most
	postPaceNote(companyKey("SMALL CO")+"|g-5", false, 10, 0, 3)
	if n := len(newPostQueueFor("SMALL CO", "g-5", nil, reviewVch("sm", 40, 200)).next().items); n != 3 {
		t.Fatalf("after a last part of 3: %d", n)
	}
	// the short last part of a job (1 left) does not shrink the next job's start
	q = newPostQueueFor("SHORT CO", "g-6", nil, reviewVch("sh", 7, 200))
	for q.left() {
		r := q.next()
		q.done(r, 0.01*float64(len(r.items)), nil)
	}
	if p := postPaceGet(companyKey("SHORT CO")+"|g-6", false).Part; p < 2 {
		t.Fatalf("the short last part was taken as the company's part: %d", p)
	}
}

// 9. PostBatchBills is the most a part holds with pacing on (the setting, never a fixed size)
func TestReviewPostBatchBillsCapPacingOn(t *testing.T) {
	reviewPaceStart(t, `,"PostBatchBills":4`)
	q := newPostQueueFor(zz, "co-guid-1", nil, reviewVch("cp", 60, 200))
	sizes := []int{}
	for q.left() {
		r := q.next()
		sizes = append(sizes, len(r.items))
		if len(r.items) > 4 {
			t.Fatalf("a part over PostBatchBills 4: %v", sizes)
		}
		q.done(r, 0.001*float64(len(r.items)), nil)
	}
	if sizes[0] > 2 || sizes[len(sizes)-2] != 4 {
		t.Fatalf("the parts: %v", sizes)
	}
}

// 6. a timeout teaches nothing of the time: Avg and Last as before, the next part half
func TestReviewTimeoutHalvesNotPoison(t *testing.T) {
	reviewPaceStart(t, "")
	key := companyKey(zz) + "|co-guid-1"
	q := newPostQueueFor(zz, "co-guid-1", nil, reviewVch("to", 200, 200))
	for i := 0; i < 4; i++ {
		r := q.next()
		q.done(r, 0.05*float64(len(r.items)), nil) // 50 ms a voucher
	}
	before := postPaceGet(key, false)
	r := q.next()
	n := len(r.items)
	if n < 8 {
		t.Fatalf("the part before the timeout: %d", n)
	}
	q.done(r, 20, fmt.Errorf("import: %w", errTimeout))
	after := postPaceGet(key, false)
	if after.Last != before.Last || after.Avg != before.Avg || after.N != before.N || after.KAvg != before.KAvg {
		t.Fatalf("the timeout was folded in: before %+v after %+v", before, after)
	}
	if m := len(q.next().items); m != n/2 {
		t.Fatalf("after a timeout of %d: the next part %d (want %d)", n, m, n/2)
	}
}

// 7. the learned pace is kept across a version change; a file of another format starts again
func TestReviewPaceKeptAcrossVersions(t *testing.T) {
	reviewPaceStart(t, "")
	key := postPaceKey(companyKey(zz)+"|co-guid-1", false)
	write := func(format int) {
		postPaceReset()
		_ = saveFile(postPaceFile(), jsonText(M{"format": format, "version": "1.0.0-older", "companies": M{key: M{"last": 100, "avg": 100, "n": 5, "part": 6}}}))
	}
	write(postPaceFormat)
	if ms := postPaceMs(companyKey(zz)+"|co-guid-1", false); ms != 100 {
		t.Fatalf("the pace of an older version's file: %v (want 100, kept)", ms)
	}
	if n := len(newPostQueueFor(zz, "co-guid-1", nil, reviewVch("vk", 40, 200)).next().items); n != 6 {
		t.Fatalf("the first part from the kept pace: %d (want 6)", n)
	}
	write(postPaceFormat - 1)
	if ms := postPaceMs(companyKey(zz)+"|co-guid-1", false); ms != 0 {
		t.Fatalf("a file of another format was taken: %v", ms)
	}
	_ = os.Remove(postPaceFile())
}

// the production default (pacing on) through the real job: a stand Tally at 300 ms a voucher; every request 2 s or
// less, the first 2 at most, all posted
func TestReviewPacedJobDefault(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "Import" {
			return time.Duration(strings.Count(body, "<VOUCHER ")) * 300 * time.Millisecond
		}
		return 0
	}
	standBridge(t, f, "")
	postPaceReset()
	t.Cleanup(postPaceReset)
	p := r15Job(t, "job-review-paced", r15Bills("pd", td, 12))
	if str(p["status"]) != "done" || !strings.HasPrefix(str(p["message"]), "Posted 12 of 12") {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	sizes, _ := r15Imports(f)
	if len(sizes) == 0 || sizes[0] > 2 {
		t.Fatalf("the first part: %v", sizes)
	}
	for _, n := range sizes {
		if float64(n)*0.3 > 2.0 {
			t.Fatalf("a part predicted over 2 s: %v", sizes)
		}
	}
}

// 2. and 9. a posting stopped on this computer: entries never sent go up failed, "not sent: stopped on this
// computer"; with nothing sent the posting is failed; with something sent, done
func TestReviewCancelledNotSentReported(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
	cpMu.Lock()
	cloudPosts = map[string]string{}
	cpMu.Unlock()
	t.Cleanup(func() { cpMu.Lock(); cloudPosts = nil; cpMu.Unlock() })
	var mu sync.Mutex
	got := map[string]M{}
	c.mu.Lock()
	c.postsReply = func(b M) (int, M) {
		mu.Lock()
		got[str(b["id"])] = b
		mu.Unlock()
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	mk := func(id string, res []any, items []any) {
		dir, _ := jobDir(id)
		_ = os.MkdirAll(dir, 0o755)
		if err := writeProgress(dir, M{"id": id, "status": "cancelled", "company": zz, "total": len(items), "done": len(res), "results": res, "items": items, "message": "Stopped on this computer"}); err != nil {
			t.Fatal(err)
		}
		cpMu.Lock()
		cloudPosts[id] = ""
		cpMu.Unlock()
	}
	mk("job-review-none", []any{}, []any{M{"id": "n1", "kind": "voucher", "state": "waiting"}, M{"id": "n2", "kind": "voucher", "state": "waiting"}})
	mk("job-review-some", []any{M{"id": "s1", "kind": "voucher", "ok": true, "byReply": true, "state": "posted"}},
		[]any{M{"id": "s1", "kind": "voucher", "state": "posted"}, M{"id": "s2", "kind": "voucher", "state": "waiting"}})
	postsDirty.Store(true)
	syncCloudPosts()
	mu.Lock()
	defer mu.Unlock()
	none, some := got["job-review-none"], got["job-review-some"]
	if none == nil || str(none["status"]) != "failed" {
		t.Fatalf("nothing sent: %v", none)
	}
	for _, x := range arr(none["results"]) {
		r := obj(x)
		if r["ok"] != false || str(r["state"]) != "failed" || str(r["message"]) != stoppedNotSentWords || r["sent"] == true || r["outcomeUnknown"] == true {
			t.Fatalf("an entry never sent: %v", r)
		}
	}
	if len(arr(none["results"])) != 2 {
		t.Fatalf("the entries never sent are not all there: %v", none["results"])
	}
	for _, x := range arr(none["items"]) {
		if e := obj(x); str(e["state"]) != "failed" || str(e["reason"]) != stoppedNotSentWords {
			t.Fatalf("an item never sent: %v", e)
		}
	}
	if some == nil || str(some["status"]) != "done" || len(arr(some["results"])) != 2 {
		t.Fatalf("something sent: %v", some)
	}
	for _, x := range arr(some["results"]) {
		r := obj(x)
		if str(r["id"]) == "s1" && (r["ok"] != true || str(r["state"]) != "posted") {
			t.Fatalf("the posted entry changed: %v", r)
		}
		if str(r["id"]) == "s2" && str(r["message"]) != stoppedNotSentWords {
			t.Fatalf("the entry never sent: %v", r)
		}
	}
	// this computer's own record is not changed (a retry here still sends them)
	dir, _ := jobDir("job-review-none")
	if v := jobView(dir); len(arr(v["results"])) != 0 {
		t.Fatalf("progress.json changed: %v", v["results"])
	}
	cpMu.Lock()
	defer cpMu.Unlock()
	if len(cloudPosts) != 0 {
		t.Fatalf("not let go after 200: %v", cloudPosts)
	}
}

// 5. and 9. the cancelled posting's report answered with a 4xx (not "another bridge is main"): let go and logged,
// never asked again for ever; a 409 / 429 / 5xx: kept
func TestReviewCancelled4xxLetGo(t *testing.T) {
	for _, tc := range []struct {
		code int
		gone bool
	}{{404, true}, {400, true}, {409, false}, {429, false}, {503, false}} {
		t.Run(fmt.Sprint(tc.code), func(t *testing.T) {
			f := newStandTally(t)
			c := newStandCloud(t)
			standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
			id := fmt.Sprintf("job-review-4xx-%d", tc.code)
			dir, _ := jobDir(id)
			_ = os.MkdirAll(dir, 0o755)
			_ = writeProgress(dir, M{"id": id, "status": "cancelled", "company": zz, "total": 1, "done": 0, "results": []any{}, "items": []any{M{"id": "q1", "kind": "voucher", "state": "waiting"}}})
			cpMu.Lock()
			cloudPosts = map[string]string{id: ""}
			cpMu.Unlock()
			t.Cleanup(func() { cpMu.Lock(); cloudPosts = nil; cpMu.Unlock() })
			var n atomic.Int32
			c.mu.Lock()
			c.postsReply = func(b M) (int, M) { n.Add(1); return tc.code, M{"error": "no"} }
			c.mu.Unlock()
			for i := 0; i < 3; i++ {
				postsDirty.Store(true)
				syncCloudPosts()
			}
			cpMu.Lock()
			_, kept := cloudPosts[id]
			cpMu.Unlock()
			if kept == tc.gone {
				t.Fatalf("code %d: kept %v (%d reports)", tc.code, kept, n.Load())
			}
			if tc.gone && (n.Load() != 1 || logLines("FinCom did not take its last report ("+fmt.Sprint(tc.code)+"); let go") < 1) {
				t.Fatalf("code %d: %d reports, logged %d", tc.code, n.Load(), logLines("let go"))
			}
		})
	}
}

// 8. the re-check under postGate: only the entries that get a refusal are taken off; one whose note changed but
// gives no refusal (its note gone again meanwhile) stays in the part, never dropped unreported
func TestReviewRecheckDropsOnlyRefused(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	x1, x2 := "<VOUCHER>a</VOUCHER>", "<VOUCHER>b</VOUCHER>"
	r := importReq{kind: "voucher", items: []M{{"id": "rk1", "xml": x1}, {"id": "rk2", "xml": x2}}}
	k1, k2 := acceptedKey("rk1", x1), acceptedKey("rk2", x2)
	seen := map[string]string{k1: recSig(nil), k2: recSig(nil)}
	_ = noteSent(k1, zz, "browser-import", "", 1, "", "")
	_ = noteSent(k2, zz, "browser-import", "", 1, "", "")
	refuse := func(id any, xml string) M {
		if str(id) == "rk2" {
			return nil // its note gone again before the refusal was made
		}
		return sentBeforeRefusal(id, xml)
	}
	refused, refusals := recheckRefusals(r, seen, refuse)
	if len(refused) != 1 || str(refused[0]["id"]) != "rk1" || len(refusals) != 1 || refusals[0]["alreadySent"] != true {
		t.Fatalf("refused %v (%v)", refused, refusals)
	}
	if again, _ := recheckRefusals(importReq{kind: "voucher", items: []M{{"id": "rk2", "xml": x2}}}, seen, refuse); len(again) != 0 {
		t.Fatal("rk2 not taken as seen now")
	}
}
