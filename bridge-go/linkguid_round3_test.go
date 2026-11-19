package main

// The owner's hard rule (19-Nov-2026), the second review of next-fix-linkedguid: a posting or deletion goes only into the
// Tally company the client is linked to, by the company's GUID; never split, never twice; never stuck without a plain
// reason a person can act on. Made-up companies and a fake Tally only:
//   - /status says the bridge takes the linked GUID (linkGuid: FinCom sends a posting or deletion straight to a bridge
//     only when it says so)
//   - the beat: a company open only in a Tally a posting would not use (another Windows user's, or one whose owner
//     Windows cannot tell) is said not open, with no GUID (never the GUID held here or Tally's for that Tally)
//   - a browser's job naming no GUID ends failed at once, each entry not sent (Retry is safe), so nothing stays active
//   - the wait when the GUID is open only in a Tally a posting would not use says so, and what to do
//   - a posting handed again for two GUIDs at the same moment takes at most one of them

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestStatusSaysLinkGUID(t *testing.T) {
	lgSetup(t)
	code, res := callLocal(t, "GET", "/status", "", "")
	if code != 200 || res["linkGuid"] != true {
		t.Fatalf("/status does not say it takes the linked GUID: %d %v", code, res["linkGuid"])
	}
}

// a company open only on a Tally a posting would not use: not open in the beat, no GUID (the one held for its name
// is never said)
func TestBeatExcludedOnlyNotOpen(t *testing.T) {
	bridgeFor(t, &standIn{}, "")
	noteCompanyGUID("B Co", "g-held")
	for _, c := range []struct {
		name string
		sess []M
	}{
		{"another user's Tally", []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
			{"port": 9001, "ok": true, "mine": false, "companies": []any{M{"name": "B Co", "guid": "g9"}}}}},
		{"a Tally whose owner is not told", []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
			{"port": 9001, "ok": true, "companies": []any{M{"name": "B Co", "guid": "g9"}}}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			var b M
			for _, x := range beatCompanies(c.sess, []any{"A Co", "B Co"}) {
				if o := obj(x); str(o["name"]) == "B Co" {
					if b != nil {
						t.Fatalf("B Co twice: %v", x)
					}
					b = o
				}
			}
			if b == nil || b["open"] != false || str(b["guid"]) != "" {
				t.Fatalf("a company open only on an excluded Tally: %v", b)
			}
		})
	}
	// open on this user's Tally, which gives no GUID: open, no GUID (never the one held for the name)
	sess := []M{{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "B Co"}}}}
	for _, x := range beatCompanies(sess, []any{"B Co"}) {
		if o := obj(x); str(o["name"]) == "B Co" && (o["open"] != true || str(o["guid"]) != "") {
			t.Fatalf("open with no GUID from Tally: %v", o)
		}
	}
}

// a browser's job naming no GUID: failed at once, each entry not sent; nothing stays active; Retry with the GUID posts
func TestBrowserJobNoGUIDFails(t *testing.T) {
	_, l := lgSetup(t)
	noteCompanyGUID(zz, lgGUID)
	vs := lgVouchers("n", 2)
	id := "job-lg-browser-fail"
	if _, err := newPostJob(M{"jobId": id, "company": zz, "vouchers": vs}); err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, id, "the end", func(p M) bool { return str(p["status"]) == "failed" })
	for i := 0; i < 100 && jobAlive(id); i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if l.n() != 0 || str(p["message"]) != noBrowserGUID || jobAlive(id) {
		t.Fatalf("%d imports, %q, alive %v", l.n(), p["message"], jobAlive(id))
	}
	if n := lgCount(p, func(r M) bool { return r["notSent"] == true && r["ok"] == false && str(r["message"]) == noBrowserGUID }); n != 2 {
		t.Fatalf("each entry not sent, with the reason: %v", p["results"])
	}
	for _, x := range activeJobs() {
		if str(obj(x)["id"]) == id {
			t.Fatalf("still active: %v", x)
		}
	}
	if _, err := newPostJob(M{"jobId": id, "company": zz, "guid": lgGUID, "vouchers": vs}); err != nil {
		t.Fatal(err)
	}
	p = waitJob(t, id)
	if str(p["status"]) != "done" || l.n() != 1 || str(p["companyGuid"]) != lgGUID {
		t.Fatalf("Retry with the GUID: %v %q, %d imports", p["status"], p["message"], l.n())
	}
	l.checkSafe(t, lgGUID)
	if !strings.Contains(noBrowserGUID, "remove") {
		t.Fatalf("the words do not fit a removal: %q", noBrowserGUID)
	}
}

// the GUID open only on a Tally a posting would not use: the wait says where, and what to do
func TestLinkedWaitExcludedTally(t *testing.T) {
	cases := []struct {
		name, want string
		sess       []M
	}{
		{"owner not told", "Tally on port 9001 has it open, but Windows cannot tell whose Tally that is", []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "Other", "guid": "g0"}}},
			{"port": 9001, "ok": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}}}},
		{"another user's", "open only in another Windows user's Tally", []M{
			{"port": 9002, "ok": true, "mine": false, "companies": []any{M{"name": "A Co", "guid": "g1"}}}}},
	}
	for _, c := range cases {
		_, err := linkedIn(c.sess, "g1", "A Co")
		var lw *linkWait
		if err == nil || !errorsAs(err, &lw) || lw.kind != "notopen" || !strings.HasPrefix(lw.text, "Open A Co in Tally to post") || !strings.Contains(lw.text, c.want) {
			t.Errorf("%s: %v", c.name, err)
		}
	}
	_, err := linkedIn([]M{{"port": 9001, "ok": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}}, {"port": 9000, "ok": true, "mine": true, "companies": []any{}}}, "g1", "A Co")
	if err == nil || !strings.Contains(err.Error(), "run Tally normally as your own Windows user") {
		t.Errorf("what to do: %v", err)
	}
}

// a posting naming no GUID handed again for two GUIDs at the same moment: at most one taken, the other refused
func TestHandAgainOneGUIDOnly(t *testing.T) {
	lgSetup(t)
	id := "job-lg-two-guids"
	if _, err := newPostJob(M{"jobId": id, "company": zz, "fromCloud": true, "vouchers": lgVouchers("w", 1)}); err != nil {
		t.Fatal(err)
	}
	lgWaitFor(t, id, "the wait", func(p M) bool { return str(p["status"]) == "waiting" })
	was := jobPayHook
	jobPayHook = func() { time.Sleep(80 * time.Millisecond) }
	t.Cleanup(func() { jobPayHook = was })
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, g := range []string{"co-guid-a", "co-guid-b"} {
		wg.Add(1)
		go func(i int, g string) {
			defer wg.Done()
			_, errs[i] = newPostJob(M{"jobId": id, "company": zz, "guid": g, "fromCloud": true, "vouchers": lgVouchers("w", 1)})
		}(i, g)
	}
	wg.Wait()
	dir, _ := jobDir(id)
	g := str(readObjFileBak(filepath.Join(dir, "payload.json"))["guid"])
	refused := 0
	for _, e := range errs {
		if e != nil && e.Error() == linkedElsewhere {
			refused++
		}
	}
	if refused != 1 || (g != "co-guid-a" && g != "co-guid-b") || (errs[0] == nil) == (errs[1] == nil) {
		t.Fatalf("two GUIDs at once: payload %q, %v", g, errs)
	}
	winner := map[bool]string{true: "co-guid-a", false: "co-guid-b"}[errs[0] == nil]
	if g != winner {
		t.Fatalf("the payload took %q, the refused one's (%v)", g, errs)
	}
}

// a posting handed back for another GUID after it posted here: refused, and FinCom told what was already sent (never
// "nothing reached Tally" for entries that did)
func TestHandBackElsewhereSendsResults(t *testing.T) {
	f := newStandTally(t)
	l := &listTally{}
	l.set(coPair{zz, lgGUID})
	f.behave = l.behave(f)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"PostWaitMs":100,"PostBatchBills":10,"PostPaceOff":true,"CloudPostSyncSec":0`)
	t.Cleanup(lgEndJobs)
	id := "job-lg-elsewhere-res"
	c.mu.Lock()
	c.takeJobs = []M{{"id": id, "company": zz, "guid": lgGUID, "payload": M{"vouchers": lgVouchers("e", 2)}}}
	c.mu.Unlock()
	cloudPostTake()
	if p := waitJob(t, id); str(p["status"]) != "done" || l.n() != 1 {
		t.Fatalf("the first hand-out: %v %q, %d imports", p["status"], p["message"], l.n())
	}
	c.mu.Lock()
	c.takeJobs = []M{{"id": id, "company": zz, "guid": "co-guid-new", "payload": M{"vouchers": lgVouchers("e", 2)}}}
	c.posts = nil
	c.mu.Unlock()
	cloudPostTake()
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.takeJobs = nil
	c.mu.Unlock()
	var last M
	for _, b := range posts {
		if str(b["id"]) == id && str(b["status"]) == "failed" {
			last = b
		}
	}
	if last == nil || !strings.Contains(str(last["message"]), linkedElsewhere) {
		t.Fatalf("no refusal reported: %v", posts)
	}
	okN := 0
	for _, x := range arr(last["results"]) {
		if obj(x)["ok"] == true {
			okN++
		}
	}
	if okN != 2 || l.n() != 1 {
		t.Fatalf("the refusal does not carry what was sent: %v (%d imports)", last["results"], l.n())
	}
}
