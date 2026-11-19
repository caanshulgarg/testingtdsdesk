package main

// The owner's hard rule (19-Nov-2026): a posting goes only into the Tally company with the linked GUID (linkguid.go).
// A fake Tally (the stand-in, its company list answered from a list the test changes as the posting goes) and made-up
// companies only: the company closed mid-job, a same-name duplicate, the GUID changed, a held (stale) list, a link with
// no GUID, the company renamed mid-job, the browser's /import, a deletion.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type coPair struct{ name, guid string }

// the fake Tally's company list (TDSDeskCompanies) from cur(); each Import seen: the company it named and what that
// name was in the list at that moment
type listTally struct {
	mu      sync.Mutex
	list    []coPair
	imports []string // "<SVCURRENTCOMPANY>|<guid of that name now>|<ids>"
	after   func(n int, l *listTally)
}

func (l *listTally) set(p ...coPair) {
	l.mu.Lock()
	l.list = p
	l.mu.Unlock()
}

func (l *listTally) behave(f *standTally) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		switch id {
		case "TDSDeskCompanies":
			l.mu.Lock()
			var b strings.Builder
			b.WriteString("<ENVELOPE><BODY><DATA><COLLECTION>")
			for _, c := range l.list {
				fmt.Fprintf(&b, `<COMPANY NAME="%s" RESERVEDNAME="">%s%s%s%s</COMPANY>`, esc(c.name), standField("NAME", "String", esc(c.name)), standField("GUID", "String", c.guid),
					standField("STARTINGFROM", "Date", "20260401"), standField("BOOKSFROM", "Date", "20260401"))
			}
			b.WriteString("</COLLECTION></DATA></BODY></ENVELOPE>")
			l.mu.Unlock()
			_, _ = w.Write([]byte(b.String()))
			return true
		case "Import":
			co := html2(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, body, 1))
			var ids []string
			for _, m := range reTag.FindAllString(body, -1) {
				ids = append(ids, strings.TrimPrefix(m, "TDSDesk:"))
			}
			l.mu.Lock()
			g := ""
			for _, c := range l.list {
				if c.name == co {
					g += c.guid + ";"
				}
			}
			l.imports = append(l.imports, co+"|"+g+"|"+strings.Join(ids, ","))
			n := len(l.imports)
			after := l.after
			l.mu.Unlock()
			if after != nil {
				after(n, l)
			}
		}
		return false
	}
}

func html2(s string) string {
	return strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&apos;", "'").Replace(s)
}

func (l *listTally) n() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.imports)
}

// every import went to a company of the linked GUID, and no entry was sent twice
func (l *listTally) checkSafe(t *testing.T, guid string) {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	seen := map[string]bool{}
	for _, im := range l.imports {
		p := strings.SplitN(im, "|", 3)
		if p[1] != guid+";" {
			t.Fatalf("an import went to a company that was not the linked one alone (%s)", im)
		}
		for _, id := range strings.Split(p[2], ",") {
			if id != "" && seen[id] {
				t.Fatalf("entry %s sent twice (%v)", id, l.imports)
			}
			seen[id] = true
		}
	}
}

const lgGUID = "co-guid-1" // the stand Tally's own GUID

func lgSetup(t *testing.T) (*standTally, *listTally) {
	f := newStandTally(t)
	l := &listTally{}
	l.set(coPair{zz, lgGUID})
	f.behave = l.behave(f)
	standBridge(t, f, `,"PostWaitMs":100,"PostBatchBills":10,"PostPaceOff":true`)
	// a posting left waiting by a test is cancelled and has ended before the next test (it would hold Tally for it)
	t.Cleanup(lgEndJobs)
	return f, l
}

func lgEndJobs() {
	jobsMu.Lock()
	var ids []string
	for id := range jobsRunning {
		ids = append(ids, id)
	}
	jobsMu.Unlock()
	for _, id := range ids {
		_, _ = cancelJob(id, "test over")
	}
	for i := 0; i < 500; i++ {
		alive := false
		for _, id := range ids {
			alive = alive || jobAlive(id)
		}
		if !alive {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func lgVouchers(prefix string, n int) []any {
	var vs []any
	for i := 1; i <= n; i++ {
		id := fmt.Sprintf("%s%02d", prefix, i)
		vs = append(vs, M{"id": id, "xml": finVoucher(id, fgParty, "B-"+id, fgDate, "1.00")})
	}
	return vs
}

func lgWaitFor(t *testing.T, id string, what string, ok func(p M) bool) M {
	t.Helper()
	dir, _ := jobDir(id)
	for i := 0; i < 300; i++ {
		if p := readProgress(dir); p != nil && ok(p) {
			return p
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("job %s: %s did not come (%v)", id, what, readProgress(dir)["message"])
	return nil
}

func lgCount(p M, f func(r M) bool) int {
	n := 0
	for _, x := range arr(p["results"]) {
		if f(obj(x)) {
			n++
		}
	}
	return n
}

func TestLinkedInRules(t *testing.T) {
	s := func(port int, extra M, cs ...coPair) M {
		var l []any
		for _, c := range cs {
			l = append(l, M{"name": c.name, "guid": c.guid})
		}
		e := M{"port": port, "ok": true, "companies": l}
		for k, v := range extra {
			e[k] = v
		}
		return e
	}
	cases := []struct {
		name string
		sess []M
		guid string
		kind string
		want string
	}{
		{"one", []M{s(9000, nil, coPair{"A Co", "g1"}, coPair{"B Co", "g2"})}, "g1", "", "A Co"},
		{"GUID case and spaces", []M{s(9000, nil, coPair{"A Co", " G1 "})}, "g1", "", "A Co"},
		{"renamed: the current name", []M{s(9000, nil, coPair{"A Co Renamed", "g1"})}, "g1", "", "A Co Renamed"},
		{"no GUID on the link", []M{s(9000, nil, coPair{"A Co", "g1"})}, "", "noguid", ""},
		{"closed", []M{s(9000, nil, coPair{"B Co", "g2"})}, "g1", "notopen", ""},
		{"same name, other GUID", []M{s(9000, nil, coPair{"A Co", "g9"})}, "g1", "notopen", ""},
		{"same-name duplicate", []M{s(9000, nil, coPair{"A Co", "g1"}, coPair{"A Co", "g9"})}, "g1", "samename", ""},
		{"duplicate on another Tally", []M{s(9000, nil, coPair{"A Co", "g1"}), s(9001, nil, coPair{"a co", "g9"})}, "g1", "samename", ""},
		{"open twice", []M{s(9000, nil, coPair{"A Co", "g1"}), s(9001, nil, coPair{"A Co", "g1"})}, "g1", "many", ""},
		{"a late answer", []M{s(9000, M{"late": true}, coPair{"A Co", "g1"})}, "g1", "stale", ""},
		{"a list kept from before", []M{s(9000, M{"kept": true}, coPair{"A Co", "g1"})}, "g1", "stale", ""},
		{"busy: the last list", []M{s(9000, M{"busy": true}, coPair{"A Co", "g1"})}, "g1", "stale", ""},
		{"another user's Tally left out", []M{s(9000, nil, coPair{"A Co", "g1"}), s(9001, M{"mine": false}, coPair{"A Co", "g9"})}, "g1", "", "A Co"},
	}
	for _, c := range cases {
		h, err := linkedIn(c.sess, c.guid, "A Co")
		var lw *linkWait
		switch {
		case c.kind == "" && (err != nil || h.name != c.want):
			t.Errorf("%s: %v %v", c.name, h, err)
		case c.kind != "" && (err == nil || !errorsAs(err, &lw) || lw.kind != c.kind || !strings.HasPrefix(lw.text, "Open A Co in Tally to post")):
			t.Errorf("%s: want a wait %s, got %v %v", c.name, c.kind, h, err)
		}
	}
}

// the company closed in Tally right after the first part: that part is unconfirmed (never sent again), the posting
// waits "Open <company> in Tally to post", and goes on by itself once it is open again
func TestLinkedClosedMidJob(t *testing.T) {
	_, l := lgSetup(t)
	l.after = func(n int, l *listTally) {
		if n == 1 {
			l.list = nil
		}
	}
	j, err := newPostJob(M{"jobId": "job-lg-closed", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("c", 30)})
	if err != nil {
		t.Fatal(err)
	}
	lgWaitFor(t, str(j["id"]), "the wait", func(p M) bool {
		return str(p["status"]) == "waiting" && str(p["message"]) == "Open ZZ TEST in Tally to post"
	})
	time.Sleep(300 * time.Millisecond)
	if l.n() != 1 {
		t.Fatalf("sent while the company was closed: %d imports", l.n())
	}
	l.set(coPair{zz, lgGUID})
	p := waitJob(t, str(j["id"]))
	if l.n() != 3 || lgCount(p, func(r M) bool { return r["ok"] == true }) != 20 || lgCount(p, func(r M) bool { return r["unconfirmed"] == true && r["outcomeUnknown"] == true }) != 10 {
		t.Fatalf("after it opened again: %d imports, results %v", l.n(), p["results"])
	}
	l.checkSafe(t, lgGUID)
}

// two open companies with the linked name (one the linked GUID): nothing is sent until the other is closed
func TestLinkedSameNameDuplicate(t *testing.T) {
	_, l := lgSetup(t)
	l.set(coPair{zz, lgGUID}, coPair{zz, "co-guid-twin"})
	j, err := newPostJob(M{"jobId": "job-lg-dup", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("d", 5)})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, str(j["id"]), "the wait", func(p M) bool { return str(p["status"]) == "waiting" })
	if !strings.Contains(str(p["message"]), "two open companies in Tally are named ZZ TEST") || l.n() != 0 {
		t.Fatalf("%q, %d imports", p["message"], l.n())
	}
	l.set(coPair{zz, lgGUID})
	p = waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || l.n() != 1 {
		t.Fatalf("%v %q %d", p["status"], p["message"], l.n())
	}
	l.checkSafe(t, lgGUID)
}

// the company of that name has another GUID right after a part: that part is unconfirmed with wrongCompany, nothing
// more is sent while it stays so
func TestLinkedGUIDChangedMidJob(t *testing.T) {
	_, l := lgSetup(t)
	l.after = func(n int, l *listTally) {
		if n == 1 {
			l.list = []coPair{{zz, "co-guid-restored"}}
		}
	}
	j, err := newPostJob(M{"jobId": "job-lg-guid", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("g", 20)})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, str(j["id"]), "the part unconfirmed", func(p M) bool { return lgCount(p, func(r M) bool { return r["unconfirmed"] == true }) == 10 })
	if str(p["status"]) != "waiting" || str(p["message"]) != "Open ZZ TEST in Tally to post" {
		t.Fatalf("%v %q", p["status"], p["message"])
	}
	for _, x := range arr(p["results"]) {
		if r := obj(x); !strings.Contains(str(r["wrongCompany"]), "co-guid-restored") || r["ok"] == true {
			t.Fatalf("not marked as perhaps in another company: %v", r)
		}
	}
	time.Sleep(400 * time.Millisecond)
	if l.n() != 1 {
		t.Fatalf("sent into the other company: %d imports", l.n())
	}
	if _, err := cancelJob(str(j["id"]), "test"); err != nil {
		t.Fatal(err)
	}
	l.checkSafe(t, lgGUID)
}

// a list held from before (the cache, 30 s) names the company; Tally now does not: never posted on the held list
func TestLinkedStaleCache(t *testing.T) {
	f, l := lgSetup(t)
	if c := openCompanies(false); len(c) == 0 || len(sessCompanies(c[0])) != 1 {
		t.Fatalf("the list was not held: %v", c)
	}
	asked := f.n("TDSDeskCompanies")
	l.set()
	j, err := newPostJob(M{"jobId": "job-lg-stale", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("s", 3)})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, str(j["id"]), "the wait", func(p M) bool { return str(p["status"]) == "waiting" })
	if l.n() != 0 || f.n("TDSDeskCompanies") <= asked || str(p["message"]) != "Open ZZ TEST in Tally to post" {
		t.Fatalf("posted on a held list, or Tally not asked: %d imports, %d asks, %q", l.n(), f.n("TDSDeskCompanies")-asked, p["message"])
	}
	cancelJob(str(j["id"]), "test")
}

// a posting from FinCom's queue that names no GUID: never posted, even with the company of that name open and its GUID
// held on this computer (the coordinator's decision of 19-Nov-2026: the bridge needs FinCom's company_guid; no fallback
// by name); it waits in plain words
func TestLinkedNoGUID(t *testing.T) {
	_, l := lgSetup(t)
	noteCompanyGUID(zz, lgGUID)
	was := postOKFn
	postOKFn = func(string) (string, bool) { return "", true }
	t.Cleanup(func() { postOKFn = was })
	j, err := newPostJob(M{"jobId": "job-lg-noguid", "company": zz, "fromCloud": true, "vouchers": lgVouchers("n", 3)})
	if err != nil {
		t.Fatal(err)
	}
	p := lgWaitFor(t, str(j["id"]), "the wait", func(p M) bool { return str(p["status"]) == "waiting" })
	time.Sleep(300 * time.Millisecond)
	if l.n() != 0 || str(p["message"]) != "Waiting for FinCom to name the linked company" {
		t.Fatalf("%d imports, %q", l.n(), p["message"])
	}
	cancelJob(str(j["id"]), "test")
}

// renamed in Tally right after a part: that part unconfirmed; the rest goes under the company's name as Tally gives it now
func TestLinkedRenamedMidJob(t *testing.T) {
	_, l := lgSetup(t)
	l.after = func(n int, l *listTally) {
		if n == 1 {
			l.list = []coPair{{"ZZ TEST RENAMED", lgGUID}}
		}
	}
	j, err := newPostJob(M{"jobId": "job-lg-rename", "company": zz, "guid": lgGUID, "vouchers": lgVouchers("r", 30)})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	if l.n() != 3 || lgCount(p, func(r M) bool { return r["unconfirmed"] == true }) != 10 || lgCount(p, func(r M) bool { return r["ok"] == true }) != 20 {
		t.Fatalf("%d imports, %v", l.n(), p["results"])
	}
	l.mu.Lock()
	later := l.imports[1:]
	l.mu.Unlock()
	for _, im := range later {
		if !strings.HasPrefix(im, "ZZ TEST RENAMED|") {
			t.Fatalf("not under the current name: %v", im)
		}
	}
	l.checkSafe(t, lgGUID)
}

// the browser's /import: a same-name duplicate refuses it whole; the GUID changed after a part: that part unconfirmed,
// the rest not sent
func TestLinkedDirectImport(t *testing.T) {
	_, l := lgSetup(t)
	l.set(coPair{zz, lgGUID}, coPair{zz, "co-guid-twin"})
	if _, err := invokeImport(M{"company": zz, "guid": lgGUID, "vouchers": lgVouchers("i", 2)}); err == nil || !strings.Contains(err.Error(), "two open companies") || l.n() != 0 {
		t.Fatalf("a duplicate: %v, %d imports", err, l.n())
	}
	l.set(coPair{zz, lgGUID})
	l.after = func(n int, l *listTally) {
		if n == 1 {
			l.list = []coPair{{zz, "co-guid-restored"}}
		}
	}
	res, err := invokeImport(M{"company": zz, "guid": lgGUID, "vouchers": lgVouchers("k", 15)})
	if err != nil {
		t.Fatal(err)
	}
	un, notSent := 0, 0
	for _, x := range arr(res["results"]) {
		r := obj(x)
		if r["unconfirmed"] == true && strings.Contains(str(r["wrongCompany"]), "co-guid-restored") {
			un++
		}
		if r["notSent"] == true && str(r["message"]) == "Open ZZ TEST in Tally to post" {
			notSent++
		}
	}
	if un != 10 || notSent != 5 || l.n() != 1 {
		t.Fatalf("unconfirmed %d, not sent %d, imports %d: %v", un, notSent, l.n(), res["results"])
	}
	l.checkSafe(t, lgGUID)
}

// a deletion only in the linked company: another company of that name refuses it before anything is sent
func TestLinkedUnpost(t *testing.T) {
	f, l := lgSetup(t)
	noteCompanyGUID(zz, lgGUID)
	l.set(coPair{zz, "co-guid-twin"})
	code, res := callLocal(t, "POST", "/unpost", "", `{"company":"`+zz+`","companyGuid":"`+lgGUID+`","vchType":"Journal","vchDate":"20260701","vchNumber":"B-1","masterId":"5"}`)
	if f.n("Import") != 0 || code == 200 && truthy(res["ok"]) {
		t.Fatalf("deleted in another company: %d %v (%d imports)", code, res, f.n("Import"))
	}
}

func errorsAs(err error, target **linkWait) bool {
	for e := err; e != nil; {
		if lw, ok := e.(*linkWait); ok {
			*target = lw
			return true
		}
		u, ok := e.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}
