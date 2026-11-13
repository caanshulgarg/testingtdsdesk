package main

// bridge 2.5.15, item 1 (the owner's approval of 13-Nov-2026): a posting taken from FinCom's queue asks FinCom before
// each part goes to Tally (post_ok, read only, 3 s at most). Told to stop: nothing more is sent, the job ends "stopped",
// is reported as taken (FinCom judges and answers cancelled) and is cancelled here. No answer in 3 s: what is on this
// computer is posted (the owner's decision: "Then go ahead"), and the report says how many parts went so. A posting
// started from FinCom's page on this computer (not the queue) asks nothing. Nothing new is asked of Tally.
import (
	"strings"
	"sync"
	"testing"
	"time"
)

func r2515QueueBridge(t *testing.T) (*standTally, *standCloud) {
	t.Helper()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0,"PostBatchBills":1`)
	cpMu.Lock()
	cloudPosts = nil
	cpMu.Unlock()
	t.Cleanup(func() { postOKOffline.Range(func(k, _ any) bool { postOKOffline.Delete(k); return true }) })
	return f, c
}

func r2515Take(t *testing.T, c *standCloud, id string, n int) {
	t.Helper()
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": id, "company": zz, "payload": M{"vouchers": r15Bills(strings.TrimPrefix(id, "job-r2515-"), today(), n)}})
	c.mu.Unlock()
	cloudPostTake()
}

func r2515JobEnd(t *testing.T, id string) M {
	t.Helper()
	dir, _ := jobDir(id)
	for i := 0; i < 300; i++ {
		p := readProgress(dir)
		if st := str(p["status"]); p != nil && (st == "done" || st == "failed" || st == "stopped" || st == "cancelled") && !jobAlive(id) {
			return p
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the job %s did not end", id)
	return nil
}

// FinCom says go: asked once before each part, every part sent
func TestR2515AskedBeforeEachPart(t *testing.T) {
	f, c := r2515QueueBridge(t)
	var asked []string
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			asked = append(asked, str(b["id"]))
			return 200, M{"ok": true, "post": true}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	r2515Take(t, c, "job-r2515-go", 3)
	p := r2515JobEnd(t, "job-r2515-go")
	c.mu.Lock()
	n := len(asked)
	c.mu.Unlock()
	if str(p["status"]) != "done" || f.n("Import") != 3 || n != 3 || asked[0] != "job-r2515-go" {
		t.Fatalf("the job %s %q: %d imports, FinCom asked %d times (%v)", p["status"], p["message"], f.n("Import"), n, asked)
	}
	if toInt(p["offlineSends"]) != 0 {
		t.Fatalf("parts counted as sent without FinCom: %v", p["offlineSends"])
	}
	onlyPostingRequests(t, f, 0)
}

// FinCom says stop after the first part: nothing more is sent; reported as taken; FinCom's "cancelled" ends it here
func TestR2515StopBeforeAPart(t *testing.T) {
	f, c := r2515QueueBridge(t)
	const why = "Not posted: posting into Tally was stopped for ZZ Kestrel after this was queued."
	var mu sync.Mutex
	n := 0
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			mu.Lock()
			defer mu.Unlock()
			if n++; n >= 2 {
				return 200, M{"ok": true, "post": false, "stop": "stopped", "error": why}
			}
			return 200, M{"ok": true, "post": true}
		}
		return 200, M{"ok": true}
	}
	c.postsReply = func(b M) (int, M) {
		if str(b["status"]) == "taken" && len(arr(b["results"])) == 1 {
			return 200, M{"ok": false, "cancelled": true, "stopped": true, "status": "done", "error": why}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	r2515Take(t, c, "job-r2515-stop", 3)
	p := r2515JobEnd(t, "job-r2515-stop")
	if str(p["status"]) != "stopped" || f.n("Import") != 1 || !strings.Contains(str(p["message"]), why) || len(arr(p["results"])) != 1 {
		t.Fatalf("after the stop: %s %q, %d imports, %d results", p["status"], p["message"], f.n("Import"), len(arr(p["results"])))
	}
	postsDirty.Store(true)
	syncCloudPosts()
	c.mu.Lock()
	last := c.posts[len(c.posts)-1]
	c.mu.Unlock()
	if str(last["status"]) != "taken" || len(arr(last["results"])) != 1 {
		t.Fatalf("the report of the stopped posting: %s, %d results", last["status"], len(arr(last["results"])))
	}
	waiting := 0
	for _, x := range arr(last["items"]) {
		if str(obj(x)["state"]) == "waiting" {
			waiting++
		}
	}
	if waiting != 2 {
		t.Fatalf("the parts not sent are not shown waiting: %v", last["items"])
	}
	dir, _ := jobDir("job-r2515-stop")
	if st := str(readProgress(dir)["status"]); st != "cancelled" || strings.Contains(readText(cloudPostsFile()), "job-r2515-stop") {
		t.Fatalf("FinCom's answer did not end it here: %s", st)
	}
	if logLines("FinCom said to stop before part 2 of 3") != 1 {
		t.Fatal("the stop is not logged")
	}
}

// no answer from FinCom in 3 s: posted (the owner's decision), counted, told with the report
func TestR2515NoAnswerGoesAhead(t *testing.T) {
	f, c := r2515QueueBridge(t)
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			c.mu.Unlock()
			time.Sleep(3500 * time.Millisecond)
			c.mu.Lock()
			return 200, M{"ok": true, "post": false, "stop": "stopped", "error": "too late to count"}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	t0 := time.Now()
	r2515Take(t, c, "job-r2515-off", 2)
	p := r2515JobEnd(t, "job-r2515-off")
	if str(p["status"]) != "done" || f.n("Import") != 2 || toInt(p["offlineSends"]) != 2 {
		t.Fatalf("with no answer: %s %q, %d imports, %v parts counted", p["status"], p["message"], f.n("Import"), p["offlineSends"])
	}
	if d := time.Since(t0); d > 12*time.Second {
		t.Fatalf("the posting was held %s by the checks (3 s once, then not asked for 15 s)", d)
	}
	if logLines("could not be reached before part 1 of 2") != 1 {
		t.Fatal("not logged")
	}
	postsDirty.Store(true)
	syncCloudPosts()
	c.mu.Lock()
	last := c.posts[len(c.posts)-1]
	c.mu.Unlock()
	if toInt(last["offlineSends"]) != 2 || logLines("FinCom told of 2 part(s) sent while it could not be reached") != 1 {
		t.Fatalf("the report does not tell FinCom: %v", last["offlineSends"])
	}
}

// a posting from FinCom's page on this computer (not the queue): nothing asked of FinCom before its parts
func TestR2515LocalPostingAsksNothing(t *testing.T) {
	f, c := r2515QueueBridge(t)
	p := r15Job(t, "job-r2515-local", r15Bills("lo", today(), 2))
	if str(p["status"]) != "done" || f.n("Import") != 2 || c.count("post_ok") != 0 {
		t.Fatalf("a local posting: %s, %d imports, %d checks", p["status"], f.n("Import"), c.count("post_ok"))
	}
}
