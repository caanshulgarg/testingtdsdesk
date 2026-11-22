package main

// The bridge audit (22-Nov-2026): one test per confirmed and low finding. Nothing here reaches a real Tally or cloud;
// the stand-ins only. Made-up names only.
import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// 1. the typing gate as a service: a session of the owner's whose tray does not report is someone in Tally; each
// session keeps its own report
func TestAuditTrayStaleIsPersonPresent(t *testing.T) {
	trayMu.Lock()
	old := trayReps
	trayReps = map[int]trayRep{}
	trayMu.Unlock()
	t.Cleanup(func() { trayMu.Lock(); trayReps = old; trayMu.Unlock() })
	now := time.Now()
	// the owner signed in (session 3), no tray report at all (Quit, crashed, not started yet)
	if idle, front, unknown := trayPersonAt([]int{3}, true, now); idle != 0 || !front || !unknown {
		t.Fatalf("no report: idle %v front %v unknown %v (must hold every gate)", idle, front, unknown)
	}
	// a stale report (40 s old): the same
	trayMu.Lock()
	trayReps[3] = trayRep{500, false, now.Add(-40 * time.Second)}
	trayMu.Unlock()
	if idle, front, unknown := trayPersonAt([]int{3}, true, now); idle != 0 || !front || !unknown {
		t.Fatalf("stale report: idle %v front %v unknown %v", idle, front, unknown)
	}
	// Windows gave no list of sessions: not known, held
	if _, front, unknown := trayPersonAt(nil, false, now); !front || !unknown {
		t.Fatal("no session list: not held")
	}
	// nobody of the owner's signed in: nobody there, as before
	if idle, front, unknown := trayPersonAt(nil, true, now); idle != 99999 || front || unknown {
		t.Fatalf("nobody signed in: idle %v front %v unknown %v", idle, front, unknown)
	}
	// two sessions: session 3 types in Tally; session 4's tray reports later, idle: never written over
	setTrayIdle(3, 0.4, true)
	setTrayIdle(4, 900, false)
	if idle, front, unknown := trayPersonAt([]int{3, 4}, true, time.Now()); idle != 0.4 || !front || unknown {
		t.Fatalf("session 4's report wrote over session 3's: idle %v front %v unknown %v", idle, front, unknown)
	}
	// both fresh and idle: free
	setTrayIdle(3, 120, true)
	if idle, front, unknown := trayPersonAt([]int{3, 4}, true, time.Now()); idle != 120 || !front || unknown {
		t.Fatalf("both idle: idle %v front %v unknown %v", idle, front, unknown)
	}
	// the hook the service uses
	oldFn := ownerActiveSessionsFn
	ownerActiveSessionsFn = func() ([]int, bool) { return []int{7}, true }
	t.Cleanup(func() { ownerActiveSessionsFn = oldFn })
	if _, _, unknown := trayPerson(); !unknown {
		t.Fatal("trayPerson: a session with no report is not unknown")
	}
}

// 2. a posting from FinCom's queue stopped on this computer: its last results go to FinCom before it is let go, and it
// is let go only on a 200 answer
func TestAuditCancelledPostingReported(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
	id := "job-audit-cancel-1"
	dir, _ := jobDir(id)
	_ = os.MkdirAll(dir, 0o755)
	res := []any{M{"id": "ac1", "kind": "voucher", "ok": false, "outcomeUnknown": true, "sent": true, "unconfirmed": true, "state": "unknown", "message": "sent"}}
	if err := writeProgress(dir, M{"id": id, "status": "cancelled", "company": zz, "total": 2, "done": 1, "results": res, "message": "Cancelled in FinCom; nothing more is sent to Tally"}); err != nil {
		t.Fatal(err)
	}
	cpMu.Lock()
	cloudPosts = map[string]string{id: ""}
	cpMu.Unlock()
	t.Cleanup(func() { cpMu.Lock(); cloudPosts = nil; cpMu.Unlock() })
	var answer atomic.Int32
	answer.Store(500)
	c.mu.Lock()
	c.postsReply = func(b M) (int, M) { return int(answer.Load()), M{"ok": answer.Load() == 200} }
	c.mu.Unlock()
	postsDirty.Store(true)
	syncCloudPosts()
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.mu.Unlock()
	if len(posts) != 1 || str(posts[0]["id"]) != id || len(arr(posts[0]["results"])) != 1 {
		t.Fatalf("no final posts_update with the results: %v", posts)
	}
	if st := str(posts[0]["status"]); st != "done" {
		t.Fatalf("a part that reached Tally is reported %q (never failed: the cloud would free its ids)", st)
	}
	cpMu.Lock()
	_, kept := cloudPosts[id]
	cpMu.Unlock()
	if !kept {
		t.Fatal("let go although FinCom did not take the report")
	}
	answer.Store(200)
	postsDirty.Store(true)
	syncCloudPosts()
	cpMu.Lock()
	_, kept = cloudPosts[id]
	cpMu.Unlock()
	if kept {
		t.Fatal("kept after FinCom took the report")
	}
	// nothing reached Tally: failed
	if cancelledEnd(M{"results": []any{M{"id": "x", "ok": false, "refused": true}}}) != "failed" {
		t.Fatal("nothing sent: not failed")
	}
}

// 3. a voucher sent from this computer (a browser's /import) between two parts of a job is refused on the record
// under postGate, never sent a second time
func TestAuditRecordRecheckUnderGate(t *testing.T) {
	td := today()
	f := newStandTally(t)
	x1, x2 := finVoucher("ar1", fgParty, "AR-1", td, "10.00"), finVoucher("ar2", fgParty, "AR-2", td, "20.00")
	var once sync.Once
	f.importAt = func(id, body string) (bool, time.Duration) {
		if strings.Contains(body, "TDSDesk:ar1") {
			// while part 1 is at Tally: the browser's /import sends ar2 (it takes postGate after this part)
			once.Do(func() { _ = noteSent(acceptedKey("ar2", x2), zz, "browser-import", "", 1, "", "") })
		}
		return true, 0
	}
	standBridge(t, f, `,"PostBatchBills":1,"PostPaceOff":true`)
	j, err := newPostJob(M{"jobId": "job-audit-gate-1", "company": zz, "guid": "co-guid-1", "vouchers": []any{M{"id": "ar1", "xml": x1}, M{"id": "ar2", "xml": x2}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	f.mu.Lock()
	bodies := append([]string{}, f.bodies...)
	f.mu.Unlock()
	for _, b := range bodies {
		if strings.Contains(b, "<TALLYREQUEST>Import") && strings.Contains(b, "TDSDesk:ar2") {
			t.Fatal("ar2 was sent again after the browser's /import sent it")
		}
	}
	var r2 M
	for _, x := range arr(p["results"]) {
		if r := obj(x); str(r["id"]) == "ar2" {
			r2 = r
		}
	}
	if r2 == nil || r2["alreadySent"] != true {
		t.Fatalf("ar2's result: %v", r2)
	}
}

// 4. two resumes at the same moment start one worker
func TestAuditOneWorkerPerJob(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	id := "job-audit-resume-1"
	dir, _ := jobDir(id)
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "payload.json"), []byte(`{"company":"`+zz+`","items":[]}`), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "progress.json"), []byte(`{"id":"`+id+`","status":"running","company":"`+zz+`","results":[],"updatedAt":"2026-01-01T00:00:00Z"}`), 0o644)
	var n atomic.Int32
	release := make(chan struct{})
	old := jobWorkerFn
	jobWorkerFn = func(string) { n.Add(1); <-release }
	t.Cleanup(func() { jobWorkerFn = old })
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, _ = resumePostJob(id) }()
	}
	close(start)
	wg.Wait()
	time.Sleep(100 * time.Millisecond)
	got := n.Load()
	close(release)
	for i := 0; i < 50 && jobAlive(id); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if got != 1 {
		t.Fatalf("%d workers started for one job", got)
	}
	// a start while one runs is refused
	jobsMu.Lock()
	jobsRunning[id] = true
	jobsMu.Unlock()
	if startJob(id, dir, M{"id": id, "status": "queued"}) {
		t.Fatal("a second worker started")
	}
	jobsMu.Lock()
	delete(jobsRunning, id)
	jobsMu.Unlock()
}

// 5. a read never picks a Tally whose owner Windows cannot tell while it tells another's (ownRule), even when the
// page names its port
func TestAuditFindCompanyOwnRule(t *testing.T) {
	r254Bridge(t)
	list := func(bool) []M {
		return []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "OTHER CO"}}},
			{"port": 9001, "ok": true, "companies": []any{M{"name": "ZZ TEST"}}}, // owner unknown
		}
	}
	for _, pref := range []int{0, 9001} {
		if p, _, err := findCompanyWith("ZZ TEST", pref, []bool{true}, list); err == nil || p == 9001 {
			t.Fatalf("preferred %d: the owner-unknown Tally was chosen (%d, %v)", pref, p, err)
		}
	}
	// another Windows user's Tally, not skipped: never chosen either
	other := func(bool) []M {
		return []M{{"port": 9000, "ok": true, "mine": true, "companies": []any{}}, {"port": 9002, "ok": true, "mine": false, "companies": []any{M{"name": "ZZ TEST"}}}}
	}
	if p, _, err := findCompanyWith("ZZ TEST", 9002, []bool{true}, other); err == nil || p == 9002 {
		t.Fatalf("another user's Tally chosen: %d %v", p, err)
	}
	// a plain PC (Windows tells no owner): every Tally that answers, as before
	blind := func(bool) []M {
		return []M{{"port": 9001, "ok": true, "companies": []any{M{"name": "ZZ TEST"}}}}
	}
	if p, _, err := findCompanyWith("ZZ TEST", 0, []bool{true}, blind); err != nil || p != 9001 {
		t.Fatalf("plain PC: %d %v", p, err)
	}
	// the user's own Tally with the company: chosen
	mine := func(bool) []M {
		return []M{{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "ZZ TEST"}}}, {"port": 9001, "ok": true, "companies": []any{M{"name": "ZZ TEST"}}}}
	}
	if p, _, err := findCompanyWith("ZZ TEST", 9001, []bool{true}, mine); err != nil || p != 9000 {
		t.Fatalf("own Tally: %d %v", p, err)
	}
}

// 6. every request of the nightly catch-up and of a plain Update now under 2 s: the company list and check, and the
// small check after Tally did not answer
func TestAuditTwoSecondCap(t *testing.T) {
	k := &keepRun{tc: &TC{copier: true, readSec: 120}, kind: "nightly"}
	if tc := k.checkTC(); tc.limitMs <= 0 || tc.limitMs > 2000 {
		t.Fatalf("a nightly run's check is not under the 2 s stop: %d", tc.limitMs)
	}
	f := newStandTally(t)
	standBridge(t, f, "")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "FinComCompany" || id == "FinComFree" {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	if _, err := companyCheck(k.checkTC(), zz, f.port); err == nil {
		t.Fatal("a 5 s check answered")
	}
	if d := time.Since(t0); d > 3500*time.Millisecond {
		t.Fatalf("the company check of a nightly run waited %v", d)
	}
	time.Sleep(5200 * time.Millisecond) // the stand finishes the request it was given
	// (the stand sets 1 s) a setting of 10 s is held to 2 s, with the read cap at its usual 20 s; the probe that the
	// failed check above set is cleared, so the small check is really sent
	setCfg("TallyProbeSec", 10)
	setCfg("TallyMaxSec", 20)
	clearProbe(f.port)
	n0 := f.n("FinComCompany")
	t0 = time.Now()
	if _, err := freeProbe(context.Background(), f.port, zz); err == nil {
		t.Fatal("a 5 s small check answered")
	}
	if f.n("FinComCompany") != n0+1 {
		t.Fatalf("the small check was not sent (%d)", f.n("FinComCompany")-n0)
	}
	if d := time.Since(t0); d > 3500*time.Millisecond {
		t.Fatalf("the small check waited %v", d)
	}
	if probeSec() != 2 {
		t.Fatal("a TallyProbeSec of 10 is not held to 2 s")
	}
	time.Sleep(5200 * time.Millisecond)
}

// 7. the light check and its follow-up reads wait while someone types or works in Tally
func TestAuditLightCheckTypingGate(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"CompanyCheckSec":2`)
	sessions := openCompaniesWith(fin, true)
	spMu.Lock()
	spChecked = map[string]time.Time{}
	spMu.Unlock()
	oldU, oldT := keepUserInTallyFn, keepTypingFn
	t.Cleanup(func() { keepUserInTallyFn, keepTypingFn = oldU, oldT })
	keepTypingFn = func() bool { return false }
	keepUserInTallyFn = func() bool { return true }
	n0 := f.n("FinComCompany")
	lightCheckOpen(sessions)
	if f.n("FinComCompany") != n0 {
		t.Fatal("the light check was sent while someone works in Tally")
	}
	if !lightDue(zz) {
		t.Fatal("the company was marked checked although nothing was sent")
	}
	// free for the check, then the person comes back: the follow-ups wait, the company is unmarked
	var calls atomic.Int32
	keepUserInTallyFn = func() bool { return calls.Add(1) > 1 }
	lightCheckOpen(sessions)
	if f.n("FinComCompany") == n0 {
		t.Fatal("the light check did not go while Tally was free")
	}
	if !lightDue(zz) || logLines("its follow-up reads go after it") < 1 {
		t.Fatalf("the follow-ups did not wait for the person: due %v", lightDue(zz))
	}
}

// 8. a part Tally plainly refused keeps Tally's words when the next look cannot confirm the company
func TestAuditUnconfirmKeepsTallyRefusal(t *testing.T) {
	in := []M{{"id": "u1", "kind": "voucher", "ok": false, "accepted": false, "refusedByTally": true, "state": "failed", "message": "Tally: Ledger 'X' does not exist"},
		{"id": "u2", "kind": "voucher", "ok": true, "byReply": true, "state": "posted"}}
	out := unconfirmResults(in, "Tally did not give its list", "")
	if out[0]["outcomeUnknown"] == true || out[0]["sent"] == true || str(out[0]["message"]) != "Tally: Ledger 'X' does not exist" {
		t.Fatalf("a refusal made unconfirmed: %v", out[0])
	}
	if out[1]["outcomeUnknown"] != true || out[1]["sent"] != true {
		t.Fatalf("a posted part not made unconfirmed: %v", out[1])
	}
}

// 9. a posting taken from FinCom's queue is on cloud-posts.txt before its worker starts
func TestAuditTakenJobTrackedFirst(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	cpMu.Lock()
	cloudPosts = nil
	cpMu.Unlock()
	t.Cleanup(func() { cpMu.Lock(); cloudPosts = nil; cpMu.Unlock() })
	var listed atomic.Int32
	listed.Store(-1)
	old := newPostJobFn
	newPostJobFn = func(pl M) (M, error) {
		// the moment the worker starts: the posting must already be on the disk's list
		if strings.Contains(readText(cloudPostsFile()), "job-audit-track-1") {
			listed.Store(1)
		} else {
			listed.Store(0)
		}
		return old(pl)
	}
	t.Cleanup(func() { newPostJobFn = old })
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-audit-track-1", "company": zz, "payload": M{"vouchers": []any{M{"id": "tk1", "xml": finVoucher("tk1", fgParty, "TK-1", today(), "1.00")}}}})
	c.mu.Unlock()
	cloudPostTake()
	waitJob(t, "job-audit-track-1")
	if listed.Load() != 1 {
		t.Fatal("the worker started before the posting was on cloud-posts.txt")
	}
}

// 10. the update list is bound to FinCom Bridge: another program's list signed with the same key is never taken
func TestAuditUpdateManifestBound(t *testing.T) {
	for name, mk := range map[string]func(base, sha string) string{
		"connector top-level": func(base, sha string) string {
			return `{"version":"9.9.9","url":"` + base + `/u/FinComBridge-9.9.9.exe","sha256":"` + sha + `"}`
		},
		"connector program": func(base, sha string) string {
			return `{"bridge":{"version":"9.9.9","url":"` + base + `/u/FinComConnector-9.9.9.exe","sha256":"` + sha + `"}}`
		},
		"other product": func(base, sha string) string {
			return `{"product":"connector","bridge":{"version":"9.9.9","url":"` + base + `/u/FinComBridge-9.9.9.exe","sha256":"` + sha + `"}}`
		},
	} {
		t.Run(name, func(t *testing.T) {
			u := auditUpdServer(t, mk)
			c := releaseBridge(t, u)
			beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
			r := checkForUpdate(false)
			if u.nApplied() != 0 || u.exeGets.Load() != 0 {
				t.Fatalf("another program's list was taken: %v", r)
			}
			if !strings.Contains(str(r["message"]), "not FinCom Bridge's") {
				t.Fatalf("the words: %v", r["message"])
			}
		})
	}
	// FinCom Bridge's own list: taken, as before
	u := auditUpdServer(t, func(base, sha string) string {
		return `{"bridge":{"version":"9.9.9","url":"` + base + `/u/FinComBridge-9.9.9.exe","sha256":"` + sha + `"}}`
	})
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	if r := checkForUpdate(false); u.nApplied() != 1 {
		t.Fatalf("the bridge's own list was not taken: %v", r)
	}
	for i := 0; i < 100; i++ {
		u.mu.Lock()
		n := u.restarted
		u.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// a signed list made by mk (the stand's address and the program's SHA-256)
func auditUpdServer(t *testing.T, mk func(base, sha string) string) *updServer {
	t.Helper()
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	dir := t.TempDir()
	pub := "<RSAKeyValue><Modulus>" + base64.StdEncoding.EncodeToString(k.N.Bytes()) + "</Modulus><Exponent>" + base64.StdEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes()) + "</Exponent></RSAKeyValue>"
	_ = os.WriteFile(filepath.Join(dir, "pub.xml"), []byte(pub), 0o644)
	t.Setenv("FINCOM_TEST", "1")
	t.Setenv("FINCOM_TEST_PUBKEY", filepath.Join(dir, "pub.xml"))
	exe := []byte("MZ another program 9.9.9")
	h := sha256.Sum256(exe)
	sha := hex.EncodeToString(h[:])
	u := &updServer{}
	var list []byte
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/latest.json"):
			_, _ = w.Write(list)
		case strings.HasSuffix(r.URL.Path, "/latest.json.sig"):
			h := sha256.Sum256(list)
			sig, _ := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, h[:])
			_, _ = w.Write([]byte(base64.StdEncoding.EncodeToString(sig)))
		case strings.HasSuffix(r.URL.Path, ".exe"):
			u.exeGets.Add(1)
			_, _ = w.Write(exe)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(u.srv.Close)
	list = []byte(mk(u.srv.URL, sha))
	oldA, oldR := applyUpdateFn, restartAfterUpdate
	applyUpdateFn = func(exe string, b []byte) error {
		u.mu.Lock()
		u.applied = append(u.applied, b)
		u.mu.Unlock()
		return nil
	}
	restartAfterUpdate = func() { u.mu.Lock(); u.restarted++; u.mu.Unlock() }
	t.Cleanup(func() { applyUpdateFn, restartAfterUpdate = oldA, oldR })
	return u
}

// 11. (speed audit) each part sized by the company's own measured time a voucher, kept in post-pace.json: an unknown
// company starts with 2 at most, no part is predicted over 2 s (but a single voucher that alone takes longer), every
// part's time is learned
func auditVch(n int) []M {
	var out []M
	for i := 0; i < n; i++ {
		out = append(out, M{"id": "pp" + string(rune('a'+i%26)) + string(rune('a'+i/26)), "xml": "<VOUCHER/>"})
	}
	return out
}

func TestAuditPostPacePerCompany(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	postPaceReset()
	t.Cleanup(postPaceReset)
	q := newPostQueueFor(zz, "co-guid-1", nil, auditVch(40))
	r := q.next()
	if n := len(r.items); n < 1 || n > 2 {
		t.Fatalf("an unknown company's first part: %d vouchers (want 1-2)", n)
	}
	// 2 vouchers in 0.6 s (300 ms each): the next part aims at 1350 ms: 4
	q.done(r, 0.6, nil)
	r = q.next()
	if len(r.items) != 4 {
		t.Fatalf("after 300 ms a voucher: %d", len(r.items))
	}
	// Tally slower now (4 in 2.4 s, 600 ms each): learned at once, the next part 2 (1.2 s), never over 2 s
	q.done(r, 2.4, nil)
	r = q.next()
	if n := len(r.items); n != 2 {
		t.Fatalf("after 600 ms a voucher: %d", n)
	}
	q.done(r, 1.2, nil)
	// kept for the company across a restart (the file), and per company: another company starts small
	postPaceFlush()
	postPaceReset()
	if !exists(postPaceFile()) {
		t.Fatal("post-pace.json not written")
	}
	if n := len(newPostQueueFor(zz, "co-guid-1", nil, auditVch(40)).next().items); n != 2 {
		t.Fatalf("the company's learned size after a restart: %d", n)
	}
	if n := len(newPostQueueFor("OTHER CO", "g-2", nil, auditVch(40)).next().items); n > 2 {
		t.Fatalf("another company's first part: %d", n)
	}
	// a voucher that alone takes 2.5 s: one a part (the only part allowed over 2 s)
	q = newPostQueueFor("SLOW CO", "g-3", nil, auditVch(10))
	r = q.next()
	q.done(r, 2.5*float64(len(r.items)), nil)
	for i := 0; i < 3; i++ {
		r = q.next()
		if len(r.items) != 1 {
			t.Fatalf("a 2.5 s voucher: parts of %d", len(r.items))
		}
		q.done(r, 2.5, nil)
	}
	// a fast Tally (20 ms each): parts grow (at most doubled a part), the predicted time never over the target
	q = newPostQueueFor("FAST CO", "g-4", nil, auditVch(400))
	prev := 0
	for i := 0; i < 8 && q.left(); i++ {
		r = q.next()
		n := len(r.items)
		if prev > 0 && n > 2*prev {
			t.Fatalf("a part more than doubled: %d after %d", n, prev)
		}
		if float64(n)*0.02 > 1.35+1e-9 {
			t.Fatalf("a part predicted over the target: %d", n)
		}
		q.done(r, 0.02*float64(n), nil)
		prev = n
	}
	if prev < 32 {
		t.Fatalf("a fast Tally's parts did not grow: %d", prev)
	}
}

// the job itself: a Tally taking 500 ms a voucher gets no request of more than 2 vouchers (about 1 s), the first 2 at most
func TestAuditPostPaceJob(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "Import" {
			return time.Duration(strings.Count(body, "<VOUCHER ")) * 500 * time.Millisecond
		}
		return 0
	}
	standBridge(t, f, "")
	postPaceReset()
	t.Cleanup(postPaceReset)
	var vs []any
	for i := 1; i <= 8; i++ {
		id := "pj" + string(rune('a'+i))
		vs = append(vs, M{"id": id, "xml": finVoucher(id, fgParty, "PJ-"+id, td, "1.00")})
	}
	j, err := newPostJob(M{"jobId": "job-audit-pace-1", "company": zz, "guid": "co-guid-1", "vouchers": vs})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	for i, b := range f.bodiesOf("Import") {
		if n := strings.Count(b, "<VOUCHER "); n > 2 {
			t.Fatalf("request %d held %d vouchers (%.1f s at Tally)", i+1, n, float64(n)*0.5)
		}
	}
}
