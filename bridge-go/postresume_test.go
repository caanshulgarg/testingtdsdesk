package main

// next-fix-post-resume (the owner's "yes to both", 23-Nov-2026): a posting taken from FinCom's queue that FinCom stopped
// part-way because its cloud could not confirm in time (post_ok: post false, stop "checking") is put back by FinCom for the
// SAME bridge a few minutes later. The bridge takes it again and carries on: what it sent before is kept (its results)
// and refused on its own record (posted-ids.json, sentBeforeRefusal), and only the rest goes to Tally. Nothing new is
// asked of Tally. Made-up entries only.
import (
	"strings"
	"sync"
	"testing"
	"time"
)

// the words FinCom's cloud answers when it could not confirm in time (tally-ingest's POST_OK_UNSURE, in short)
const prUnsure = "FinCom could not confirm in time that this posting may be sent now, so nothing more is sent now."

// how many requests to Tally carried the entry (its FinCom tag)
func prSent(f *standTally, id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	tag := re(`TDSDesk:` + id + `([^A-Za-z0-9._-]|$)`)
	for i, b := range f.bodies {
		if i < len(f.reqs) && f.reqs[i] == "Import" && tag.MatchString(b) {
			n++
		}
	}
	return n
}

// FinCom's answer to post_ok, as a test sets it: from the stopAt-th ask of the first try on, "could not confirm in time"
// (bridge 2.5.20 P1 asks again up to 3 times before it stops, so every ask of that try stays unsure, the waits short);
// else go
func prCloud(t *testing.T, c *standCloud, stopAt int) (handBack func(id string, n int)) {
	t.Helper()
	r2520Fast(t)
	var mu sync.Mutex
	asked, round := 0, 1
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			mu.Lock()
			defer mu.Unlock()
			asked++
			if round == 1 && asked >= stopAt {
				return 200, M{"ok": true, "post": false, "stop": "checking", "error": prUnsure}
			}
			return 200, M{"ok": true, "post": true}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	return func(id string, n int) {
		mu.Lock()
		round = 2
		mu.Unlock()
		c.mu.Lock()
		c.takeJobs = append(c.takeJobs, M{"id": id, "company": zz, "payload": M{"vouchers": r15Bills(strings.TrimPrefix(id, "job-r2515-"), today(), n)}})
		c.mu.Unlock()
		cloudPostTake()
	}
}

// stopped before part 2 of 3 (part 1 posted by Tally's reply); FinCom puts it back for this bridge: the bridge takes it
// again, keeps part 1 (never sent again) and sends parts 2 and 3 only
func TestPostResumeAfterCloudSlowMidway(t *testing.T) {
	f, c := r2515QueueBridge(t)
	handBack := prCloud(t, c, 2)
	r2515Take(t, c, "job-r2515-prmid", 3)
	p := r2515JobEnd(t, "job-r2515-prmid")
	if str(p["status"]) != "stopped" || f.n("Import") != 1 || len(arr(p["results"])) != 1 || !strings.Contains(str(p["message"]), "before part 2 of 3") {
		t.Fatalf("the first try: %s %q, %d imports, %d results", p["status"], p["message"], f.n("Import"), len(arr(p["results"])))
	}
	postsDirty.Store(true)
	syncCloudPosts()
	c.mu.Lock()
	last := c.posts[len(c.posts)-1]
	c.mu.Unlock()
	if str(last["status"]) != "taken" || !strings.HasPrefix(str(last["message"]), "Stopped by FinCom before part 2 of 3 was sent: ") || !strings.Contains(str(last["message"]), "could not confirm in time") {
		t.Fatalf("the report FinCom judges by: %s %q", last["status"], last["message"])
	}
	// FinCom puts it back for this bridge (a few minutes later): the same posting handed out again
	handBack("job-r2515-prmid", 3)
	p = r2515JobEnd(t, "job-r2515-prmid")
	rs := r15Results(p)
	if str(p["status"]) != "done" || f.n("Import") != 3 || len(rs) != 3 {
		t.Fatalf("after the put-back: %s %q, %d imports, %d results", p["status"], p["message"], f.n("Import"), len(rs))
	}
	for _, id := range []string{"prmid1", "prmid2", "prmid3"} {
		if n := prSent(f, id); n != 1 {
			t.Fatalf("entry %s went to Tally %d times", id, n)
		}
		if rs[id]["ok"] != true {
			t.Fatalf("entry %s: %v", id, rs[id])
		}
	}
	if logLines("job-r2515-prmid: retried (1 already sent to Tally kept, never sent again)") != 1 {
		t.Fatal("the resume is not logged as keeping what was sent")
	}
	onlyPostingRequests(t, f, 0)
}

// part 1 went to Tally and no answer came (outcome unknown), then FinCom stopped it before part 2; put back: part 1 is
// never sent again (its result kept, and refused on this computer's record), parts 2 and 3 go
func TestPostResumeKeepsUnansweredPart(t *testing.T) {
	f := newStandTally(t)
	var once sync.Once
	f.importAt = func(id, body string) (bool, time.Duration) {
		create, d := true, time.Duration(0)
		once.Do(func() { d = 3 * time.Second })
		return create, d
	}
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0,"PostBatchBills":1,"TallyMaxSec":1,"PostTimeoutSec":1,"PostTimeoutBaseSec":1,"TallyProbeEverySec":2,"PostWaitMs":200`)
	cpMu.Lock()
	cloudPosts = nil
	cpMu.Unlock()
	t.Cleanup(func() { postOKOffline.Range(func(k, _ any) bool { postOKOffline.Delete(k); return true }) })
	handBack := prCloud(t, c, 2)
	r2515Take(t, c, "job-r2515-prunk", 3)
	p := r2515JobEnd(t, "job-r2515-prunk")
	r1 := r15Results(p)["prunk1"]
	if str(p["status"]) != "stopped" || len(arr(p["results"])) != 1 || r1["outcomeUnknown"] != true || r1["sent"] != true {
		t.Fatalf("the first try: %s %q, %v", p["status"], p["message"], r1)
	}
	time.Sleep(2500 * time.Millisecond) // the late answer of part 1 ends on the stand's side
	handBack("job-r2515-prunk", 3)
	p = r2515JobEnd(t, "job-r2515-prunk")
	rs := r15Results(p)
	if str(p["status"]) != "done" || len(rs) != 3 || rs["prunk1"]["outcomeUnknown"] != true || rs["prunk2"]["ok"] != true || rs["prunk3"]["ok"] != true {
		t.Fatalf("after the put-back: %s %q, %v", p["status"], p["message"], rs)
	}
	for _, id := range []string{"prunk1", "prunk2", "prunk3"} {
		if n := prSent(f, id); n != 1 {
			t.Fatalf("entry %s went to Tally %d times", id, n)
		}
	}
}

// the bridge's own record alone: the job's kept results lost (its folder's progress gone), the posting handed back whole:
// what this computer sent is refused on posted-ids.json, never sent a second time
func TestPostResumeRecordAloneRefuses(t *testing.T) {
	f, c := r2515QueueBridge(t)
	handBack := prCloud(t, c, 3)
	r2515Take(t, c, "job-r2515-prrec", 3)
	p := r2515JobEnd(t, "job-r2515-prrec")
	if str(p["status"]) != "stopped" || f.n("Import") != 2 {
		t.Fatalf("the first try: %s %q, %d imports", p["status"], p["message"], f.n("Import"))
	}
	dir, _ := jobDir("job-r2515-prrec")
	pr := readProgress(dir)
	pr["results"], pr["done"] = []any{}, 0
	if err := writeProgress(dir, pr); err != nil {
		t.Fatal(err)
	}
	handBack("job-r2515-prrec", 3)
	p = r2515JobEnd(t, "job-r2515-prrec")
	rs := r15Results(p)
	if f.n("Import") != 3 || len(rs) != 3 || rs["prrec1"]["alreadySent"] != true || rs["prrec2"]["alreadySent"] != true || rs["prrec3"]["ok"] != true {
		t.Fatalf("after the put-back: %s %q, %d imports, %v", p["status"], p["message"], f.n("Import"), rs)
	}
	for _, id := range []string{"prrec1", "prrec2", "prrec3"} {
		if n := prSent(f, id); n != 1 {
			t.Fatalf("entry %s went to Tally %d times", id, n)
		}
	}
}
