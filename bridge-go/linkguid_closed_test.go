package main

// The owner's hard rule (19-Nov-2026), after the staging incident of "Could not set SVCurrentCompany": a posting goes only
// into the Tally company with the linked GUID, and every doubt FAILS CLOSED. Made-up companies and a fake Tally only:
//   (a) the company check before a posting answers no company, or the company with no GUID: the posting waits "Open
//       <company> in Tally to post" (with Tally's own words when it said any); nothing is sent
//   (b) only this Windows user's own Tally; a Tally whose owner Windows cannot tell only while no Tally of this user
//       runs at all, and then only with the GUID matching
//   (c) the port and the company name used go to FinCom with the results
//   (d) Tally created nothing of a request: failed plainly in Tally's words, never "needs review"
//   and a posting from FinCom's queue that names no GUID: it waits ("Waiting for FinCom to name the linked company"),
//   nothing is sent (no fallback to the GUID held here by name)

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// the fake Tally's company check (FinComCompany and the numbers report) answered by ans while it is set
func lgCheckAnswer(f *standTally, l *listTally, ans func() string) {
	inner := l.behave(f)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if (id == "FinComCompany" || id == cnReportID) && ans != nil {
			if a := ans(); a != "" {
				_, _ = w.Write([]byte(a))
				return true
			}
		}
		return inner(w, r, id, body)
	}
	f.mu.Unlock()
}

const lgNoCompany = "<ENVELOPE><BODY><DATA><LINEERROR>Could not set &apos;SVCurrentCompany&apos; to &apos;ZZ TEST&apos;</LINEERROR></DATA></BODY></ENVELOPE>"
const lgEmptyGUID = `<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="ZZ TEST"><NAME>ZZ TEST</NAME><GUID></GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>`

// (a) a job: the company check answers no company (Tally's own words), then the company without a GUID: it waits, never sent
func TestLinkedCheckFailsClosed(t *testing.T) {
	for _, c := range []struct{ name, ans, words string }{{"no company", lgNoCompany, "Could not set 'SVCurrentCompany' to 'ZZ TEST'"}, {"no GUID", lgEmptyGUID, ""}} {
		t.Run(c.name, func(t *testing.T) {
			f, l := lgSetup(t)
			answer := c.ans
			mu := &sync.Mutex{}
			lgCheckAnswer(f, l, func() string { mu.Lock(); defer mu.Unlock(); return answer })
			j, err := newPostJob(M{"jobId": "job-lg-closed-" + strings.ReplaceAll(c.name, " ", ""), "company": zz, "guid": lgGUID, "vouchers": lgVouchers("q", 3)})
			if err != nil {
				t.Fatal(err)
			}
			p := lgWaitFor(t, str(j["id"]), "the wait", func(p M) bool {
				return str(p["status"]) == "waiting" && strings.HasPrefix(str(p["message"]), "Open ZZ TEST in Tally to post")
			})
			if c.words != "" && !strings.Contains(str(p["message"]), c.words) {
				t.Fatalf("Tally's own words not said: %q", p["message"])
			}
			time.Sleep(300 * time.Millisecond)
			if l.n() != 0 {
				t.Fatalf("sent with the company check answering %s: %d imports", c.name, l.n())
			}
			mu.Lock()
			answer = ""
			mu.Unlock()
			if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" || l.n() != 1 {
				t.Fatalf("the company check answering again: %v %q, %d imports", p["status"], p["message"], l.n())
			}
			l.checkSafe(t, lgGUID)
		})
	}
}

// (a) the browser's /import: the company check answering no company: nothing sent, each entry says so
func TestLinkedDirectImportCheckFailsClosed(t *testing.T) {
	f, l := lgSetup(t)
	lgCheckAnswer(f, l, func() string { return lgNoCompany })
	res, err := invokeImport(M{"company": zz, "guid": lgGUID, "vouchers": lgVouchers("w", 2)})
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range arr(res["results"]) {
		r := obj(x)
		if r["ok"] == true || r["notSent"] != true || !strings.HasPrefix(str(r["message"]), "Open ZZ TEST in Tally to post") || !strings.Contains(str(r["message"]), "Could not set") {
			t.Fatalf("an entry: %v", r)
		}
	}
	if l.n() != 0 || len(arr(res["results"])) != 2 {
		t.Fatalf("%d imports, %v", l.n(), res["results"])
	}
}

// (b) whose Tally: this user's own only; owner unknown only while none of this user's runs, with the GUID matching
func TestLinkedOwnTallyOnly(t *testing.T) {
	s := func(port int, mine any, cs ...coPair) M {
		var l []any
		for _, c := range cs {
			l = append(l, M{"name": c.name, "guid": c.guid})
		}
		e := M{"port": port, "ok": true, "companies": l}
		if mine != nil {
			e["mine"] = mine
		}
		return e
	}
	cases := []struct {
		name     string
		sess     []M
		kind     string
		wantPort int
	}{
		{"mine", []M{s(9000, true, coPair{"A Co", "g1"})}, "", 9000},
		{"mine, and an owner-unknown one with the same GUID: mine", []M{s(9000, true, coPair{"A Co", "g1"}), s(9001, nil, coPair{"A Co", "g1"})}, "", 9000},
		{"mine runs without it; an owner-unknown one has it: waits", []M{s(9000, true, coPair{"B Co", "g2"}), s(9001, nil, coPair{"A Co", "g1"})}, "notopen", 0},
		{"mine runs with no company; an owner-unknown one has it: waits", []M{s(9000, true), s(9001, nil, coPair{"A Co", "g1"})}, "notopen", 0},
		{"none of mine runs; an owner-unknown one has it: taken", []M{s(9001, nil, coPair{"A Co", "g1"})}, "", 9001},
		{"none of mine runs; an owner-unknown one has the name, another GUID: waits", []M{s(9001, nil, coPair{"A Co", "g9"})}, "notopen", 0},
		{"another user's: never", []M{s(9001, false, coPair{"A Co", "g1"})}, "notopen", 0},
		{"mine not answering, an owner-unknown one has it: waits", []M{{"port": 9000, "ok": false, "mine": true, "error": "Tally timed out"}, s(9001, nil, coPair{"A Co", "g1"})}, "stale", 0},
	}
	for _, c := range cases {
		h, err := linkedIn(c.sess, "g1", "A Co")
		var lw *linkWait
		switch {
		case c.kind == "" && (err != nil || h.port != c.wantPort):
			t.Errorf("%s: %v %v", c.name, h, err)
		case c.kind != "" && (err == nil || !errorsAs(err, &lw) || lw.kind != c.kind):
			t.Errorf("%s: want a wait %s, got %v %v", c.name, c.kind, h, err)
		}
	}
	// the confirmation after a part reads the same Tallies: an owner-unknown Tally is never what confirms a part sent
	// into this user's own
	if ok, _, _ := confirmLinked([]M{s(9000, true, coPair{"B Co", "g2"}), s(9001, nil, coPair{"A Co", "g1"})}, "g1", linkLook{9001, "A Co"}); ok {
		t.Fatal("confirmed by another Tally while one of this user's runs")
	}
}

// (c) the port and the company name used go with the results; and a posting from FinCom's queue that names no GUID
// is never posted, even with this computer's GUID for the name open (no fallback by name): it waits
func TestLinkedCloudPortCompanyNoGUID(t *testing.T) {
	f := newStandTally(t)
	l := &listTally{}
	l.set(coPair{zz, lgGUID})
	f.behave = l.behave(f)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":100,"PostBatchBills":10,"PostPaceOff":true`+c.cfg())
	t.Cleanup(lgEndJobs)
	was := postOKFn
	postOKFn = func(string) (string, bool) { return "", true }
	t.Cleanup(func() { postOKFn = was })
	noteCompanyGUID(zz, lgGUID)
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-lg-cloud-guid", "company": zz, "guid": lgGUID, "payload": M{"vouchers": lgVouchers("u", 2)}}}
	c.mu.Unlock()
	cloudPostTake()
	p := waitJob(t, "job-lg-cloud-guid")
	if str(p["status"]) != "done" || l.n() != 1 || str(p["guidFrom"]) != "fincom" {
		t.Fatalf("a posting naming its GUID: %v %q (%d imports, from %q)", p["status"], p["message"], l.n(), p["guidFrom"])
	}
	l.checkSafe(t, lgGUID)
	postsDirty.Store(true)
	syncCloudPosts()
	c.mu.Lock()
	var up M
	for _, o := range c.posts {
		if str(o["id"]) == "job-lg-cloud-guid" {
			up = o
		}
	}
	c.mu.Unlock()
	if up == nil || toInt(up["port"]) == 0 || str(up["tallyCompany"]) != zz || str(up["companyGuid"]) != lgGUID || str(up["guidFrom"]) != "fincom" {
		t.Fatalf("the update does not say where it went: %v", up)
	}
	for _, x := range arr(up["results"]) {
		if r := obj(x); toInt(r["port"]) == 0 || str(r["company"]) != zz {
			t.Fatalf("a result without its port and company: %v", r)
		}
	}
	// FinCom names no GUID (the company of that name open, its GUID held here): never posted, it waits
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-lg-cloud-noguid", "company": zz, "guid": "", "payload": M{"vouchers": lgVouchers("v", 2)}}}
	c.mu.Unlock()
	cloudPostTake()
	p = lgWaitFor(t, "job-lg-cloud-noguid", "the wait", func(p M) bool { return str(p["status"]) == "waiting" })
	time.Sleep(300 * time.Millisecond)
	if l.n() != 1 || str(p["message"]) != "Waiting for FinCom to name the linked company" {
		t.Fatalf("posted with no GUID from FinCom: %d imports, %q", l.n(), p["message"])
	}
	cancelJob("job-lg-cloud-noguid", "test")
}

// (d) Tally created nothing of a request: failed in Tally's words, never "needs review"; something created: needs review
func TestNothingCreatedIsFailedNotReview(t *testing.T) {
	f := newStandTally(t)
	f.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT>" +
		"<LINEERROR>Could not set &apos;SVCurrentCompany&apos; to &apos;ZZ TEST&apos;</LINEERROR></DATA></BODY></ENVELOPE>")
	standBridge(t, f, "")
	r := postOne(t, "nc0", finVoucher("nc0", fgParty, "NC-0", today(), "1.00"))
	if r["ok"] != false || r["needsReview"] == true || r["accepted"] == true || itemState(r, false) != "failed" || !strings.Contains(str(r["message"]), "Could not set 'SVCurrentCompany' to 'ZZ TEST'") {
		t.Fatalf("created 0: %v (state %s)", r, itemState(r, false))
	}
	if acceptedInfo("nc0") != nil {
		t.Fatal("an entry Tally made nothing of was recorded as sent")
	}
	f2 := newStandTally(t)
	f2.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><EXCEPTIONS>0</EXCEPTIONS><LASTVCHID>77</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>")
	standBridge(t, f2, "")
	r = postOne(t, "nc1", finVoucher("nc1", fgParty, "NC-1", today(), "1.00"))
	if r["needsReview"] != true || r["accepted"] != true {
		t.Fatalf("created 1 with an error: %v", r)
	}
}
