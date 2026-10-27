// The owner's decisions of 05-Oct-2026 (migration 55), on the stand-in Tally and a stand-in cloud.
//
// B, "Not in Tally - post again" (any member, a reason): before anything is sent again the bridge looks in that company
// in Tally for the ONE voucher the entry may be (the owner's rule for entry reads: FinComVoucherByNumber, by its type
// and number on its date; else FinComVoucherByMaster, by Tally's id from its reply; never a day's list), the entry's
// FinCom id TDSDesk:<id> looked for in its narration, and tells the cloud. Found: the cloud marks it posted with the
// voucher found; nothing is sent. Not found: the cloud releases the id and hands the posting back; it is sent once.
// Unable (silent: the 2-second stop; the company not open; the voucher there with another FinCom id or none; no number
// and no Tally id; a date the read rules do not allow): nothing is sent, the cloud keeps waiting.
//
// D, two bridges and one company: a posting goes ahead of another bridge's background reading. The other bridge is
// played by the test through the cloud's lease (leaseModel, as migration 55 keeps it): the reader yields at its next
// request boundary (never cutting a request), the posting bridge gets the lease, reading resumes after; a posting never
// yields; two postings still serialize.
package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func toAnyM(ms []M) []any {
	o := make([]any, len(ms))
	for i, m := range ms {
		o[i] = m
	}
	return o
}

// --- the cloud's lease as migration 55 keeps it (tally_lease_take with p_purpose; the SQL itself: run_migration55.py)
type leaseModel struct {
	mu       sync.Mutex
	holder   string
	purpose  string
	until    time.Time
	released bool
	want     string
	wantAt   time.Time
	ttl      time.Duration
	log      []string // "take <holder> <purpose> -> <answer>"
}

func (m *leaseModel) holderNow() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.released || time.Now().After(m.until) {
		return ""
	}
	return m.holder
}

func (m *leaseModel) take(who, purpose string) M {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ttl == 0 {
		m.ttl = 2 * time.Minute
	}
	if purpose != "post" && purpose != "read" {
		purpose = ""
	}
	live := m.holder != "" && !m.released && time.Now().Before(m.until)
	fresh := m.want != "" && time.Since(m.wantAt) < 2*time.Minute
	note := func(a M) M { m.log = append(m.log, fmt.Sprintf("take %s %s -> %v", who, purpose, a)); return a }
	holder := func(b string) M { return M{"bridge": b, "computer": "PC-" + b[len(b)-1:], "until": "15:00"} }
	if live && m.holder != who {
		if purpose == "post" && m.purpose == "read" {
			if !fresh || m.want == who {
				m.want, m.wantAt = who, time.Now()
			}
			return note(M{"ok": true, "held": true, "wanted": true, "purpose": "read", "holder": holder(m.holder)})
		}
		return note(M{"ok": true, "held": true, "purpose": m.purpose, "holder": holder(m.holder)})
	}
	if live && m.holder == who && purpose == "read" && m.purpose == "read" && fresh && m.want != who {
		m.holder, m.purpose, m.until, m.released = m.want, "post", time.Now().Add(m.ttl), false
		m.want = ""
		return note(M{"ok": true, "held": true, "yield": true, "purpose": "post", "holder": holder(m.holder)})
	}
	if !live && fresh && m.want != who && purpose != "post" {
		return note(M{"ok": true, "held": true, "reserved": true, "purpose": "post", "holder": holder(m.want)})
	}
	m.holder, m.purpose, m.until, m.released, m.want = who, purpose, time.Now().Add(m.ttl), false, ""
	return note(M{"ok": true, "held": false, "purpose": purpose, "lease": M{"until": m.until.Format(time.RFC3339), "ttl": int(m.ttl.Seconds())}})
}

func (m *leaseModel) release(who string) M {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.holder == who && !m.released {
		m.released = true
		m.log = append(m.log, "release "+who)
		return M{"ok": true, "released": true}
	}
	return M{"ok": true, "released": false}
}

func myBridgeID() string { return str(bridgeIdentity()["id"]) }

// the requests the stand Tally got for one company (SVCURRENTCOMPANY), Import counted too
func (f *standTally) forCompany(co string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, b := range f.bodies {
		if strings.Contains(b, "<SVCURRENTCOMPANY>"+esc(co)+"</SVCURRENTCOMPANY>") {
			n++
		}
	}
	return n
}

func (f *standTally) tagged(tag string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, v := range f.vch {
		if hasTag(v.narr, tag) {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------- B
func checkFor(id, job, entry, co, xml string) M {
	return M{"check": id, "job": job, "entry": entry, "company": co, "why": "not in the Day Book", "xml": xml}
}

func lastReport(t *testing.T, c *standCloud) M {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.checkReports) == 0 {
		t.Fatalf("the bridge told the cloud nothing (asked: %v)", c.kinds)
	}
	return c.checkReports[len(c.checkReports)-1]
}

// the reads the check may send: the company check and ONE voucher (FinComVoucherByNumber, else FinComVoucherByMaster);
// never a day's list (FinComTag, the Day Book, ...)
func checkReadsOnly(t *testing.T, f *standTally) {
	t.Helper()
	for _, id := range f.ids() {
		switch id {
		case "FinComCompany", "TDSDeskCompanies", "TDSDeskCompanyInfo", "FinComFree", cnReportID, vchByNumberID, vchObjectID:
		default:
			t.Fatalf("the check sent %s (only one voucher may be read): %v", id, f.ids())
		}
	}
}

// Tally holds the entry (its FinCom id in the narration of the one voucher with that type and number on its date): marked
// posted with the voucher found; nothing is sent; only that one voucher read (FinComVoucherByNumber)
func TestSettleCheckFoundNothingSent(t *testing.T) {
	td := today()
	f := newStandTally(t)
	v := f.add(td, fgParty, "B-77", "TDSDesk:k1 | Electricity", "-10.00")
	f.add(td, "Other Party", "B-99", "TDSDesk:zz9 | another entry the same day", "-1.00") // never read
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	c.mu.Lock()
	c.checks = []M{checkFor("7", "job-k1", "k1", zz, finVoucher("k1", fgParty, "B-77", td, "10.00"))}
	c.mu.Unlock()
	cloudPostTake()
	r := lastReport(t, c)
	if str(r["result"]) != "found" || str(r["vch"]) != "B-77" || str(r["master"]) != v.master || str(r["company"]) != zz || toInt(r["check"]) != 7 {
		t.Fatalf("the report: %v", r)
	}
	if f.n("Import") != 0 || f.n(vchByNumberID) != 1 || f.n(tagCheckID) != 0 {
		t.Fatalf("the requests: %v", f.ids())
	}
	checkReadsOnly(t, f)
	for _, id := range f.ids() {
		if _, ok := tallyAllowList[id]; !ok || tallyAllowList[id].measureOnly {
			t.Fatalf("a request not on the allow-list: %s", id)
		}
	}
}

// the voucher with that type, number and date is in Tally but carries another FinCom id, or none: a person must look;
// never "not found" (nothing released, nothing sent)
func TestSettleCheckOtherTagUnable(t *testing.T) {
	td := today()
	f := newStandTally(t)
	v := f.add(td, fgParty, "B-81", "TDSDesk:other1 | someone else's entry", "-10.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	for i, narr := range []string{"TDSDesk:other1 | someone else's entry", "Electricity (typed by hand)"} {
		f.mu.Lock()
		v.narr = narr
		f.mu.Unlock()
		c.mu.Lock()
		c.checks = []M{checkFor(fmt.Sprint(20+i), "job-k6", "k6", zz, finVoucher("k6", fgParty, "B-81", td, "10.00"))}
		c.mu.Unlock()
		cloudPostTake()
		r := lastReport(t, c)
		if str(r["result"]) != "unable" || !strings.Contains(str(r["words"]), "a person must look") || !strings.Contains(str(r["words"]), "B-81") {
			t.Fatalf("%q: %v", narr, r)
		}
	}
	if f.n("Import") != 0 {
		t.Fatal("sent to Tally")
	}
	checkReadsOnly(t, f)
}

// no voucher number (Tally numbers it itself): Tally's own voucher id from its reply, when the result has one
// (FinComVoucherByMaster); with neither: "unable", FinCom cannot check it by itself
func TestSettleCheckNoNumber(t *testing.T) {
	td := today()
	f := newStandTally(t)
	v := f.add(td, fgParty, "", "TDSDesk:k7 | Electricity", "-10.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	x := finVoucher("k7", fgParty, "", td, "10.00")
	ck := checkFor("30", "job-k7", "k7", zz, x)
	ck["vchId"] = v.master
	c.mu.Lock()
	c.checks = []M{ck}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "found" || str(r["master"]) != v.master {
		t.Fatalf("by Tally's voucher id: %v", r)
	}
	if f.n(vchObjectID) != 1 || f.n(vchByNumberID) != 0 {
		t.Fatalf("the requests: %v", f.ids())
	}
	// Tally's id names no voucher on that date: "notseen" (one day only: a person confirms)
	ck2 := checkFor("31", "job-k8", "k8", zz, finVoucher("k8", fgParty, "", td, "10.00"))
	ck2["vchId"] = "999"
	c.mu.Lock()
	c.checks = []M{ck2}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" || !strings.Contains(str(r["words"]), "FinCom cannot see other dates") {
		t.Fatalf("Tally's id names nothing: %v", r)
	}
	// neither a number nor Tally's id
	c.mu.Lock()
	c.checks = []M{checkFor("32", "job-k9", "k9", zz, finVoucher("k9", fgParty, "", td, "10.00"))}
	c.mu.Unlock()
	n := len(f.ids())
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "unable" || !strings.Contains(str(r["words"]), "FinCom cannot check this entry by itself") {
		t.Fatalf("no number, no id: %v", r)
	}
	for _, id := range f.ids()[n:] {
		if id == vchByNumberID || id == vchObjectID {
			t.Fatalf("a voucher was asked for with nothing to ask by: %v", f.ids()[n:])
		}
	}
	// dated before the company's starting point: Tally is not asked by number (the read rule); said in words
	c.mu.Lock()
	c.checks = []M{checkFor("33", "job-k10", "k10", zz, finVoucher("k10", fgParty, "B-82", addDays(td, -1), "10.00"))}
	c.mu.Unlock()
	n = len(f.ids())
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "unable" || !strings.Contains(str(r["words"]), "starting point") {
		t.Fatalf("before the starting point: %v", r)
	}
	if f.n("Import") != 0 || f.n(vchByNumberID) != 0 {
		t.Fatalf("the requests: %v", f.ids()[n:])
	}
	checkReadsOnly(t, f)
}

// Tally does not hold it: the cloud releases it and hands the posting back; it is sent once
func TestSettleCheckNotFoundSentOnce(t *testing.T) {
	td := today()
	f := newStandTally(t)
	var once sync.Once
	f.importAt = func(id, body string) (bool, time.Duration) {
		create, d := true, time.Duration(0)
		once.Do(func() { create, d = false, 3*time.Second }) // the first send: Tally took it and did not answer (and made nothing)
		return create, d
	}
	f.add(td, "Other Party", "Z-2", "an earlier entry", "-1.00") // Tally's numbers above 0: the starting point is recorded
	c := newStandCloud(t)
	standBridge(t, f, `,"TallyMaxSec":1,"PostTimeoutSec":1,"PostTimeoutBaseSec":1,"TallyProbeEverySec":1,"PostWaitMs":200`+c.cfg())
	x := finVoucher("k2", fgParty, "B-78", td, "20.00")
	pay := M{"vouchers": []any{M{"id": "k2", "xml": x}}}
	j, err := newPostJob(M{"jobId": "job-k2-000001", "company": zz, "vouchers": pay["vouchers"]})
	if err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" || f.n("Import") != 1 {
		t.Fatalf("the first send: %v %v (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	time.Sleep(1100 * time.Millisecond) // the probe may go again
	// the owner's rule: Tally answers for ZZ and has no such voucher that day: "notseen"; nothing is sent by the report
	c.mu.Lock()
	c.checks = []M{checkFor("9", "job-k2-000001", "k2", zz, x)}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" || str(r["company"]) != zz || !strings.Contains(str(r["words"]), "FinCom cannot see other dates") || f.n("Import") != 1 {
		t.Fatalf("the report: %v (%d imports)", r, f.n("Import"))
	}
	// a member looked in Tally and confirmed "not there" (tally_post_check_confirm): the cloud hands the posting back,
	// naming that entry alone; it is sent once
	c.mu.Lock()
	c.checks = nil
	c.takeJobs = []M{{"id": "job-k2-000001", "company": zz, "payload": pay, "released": []any{M{"id": "k2", "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "not in the Day Book (confirmed)"}}, "resendOnly": []any{"k2"}}}
	c.mu.Unlock()
	cloudPostTake()
	p := waitJob(t, "job-k2-000001")
	if str(p["status"]) != "done" || f.n("Import") != 2 || f.tagged("TDSDesk:k2") != 1 {
		t.Fatalf("sent again: %v %q, %d imports, %d in Tally", p["status"], p["message"], f.n("Import"), f.tagged("TDSDesk:k2"))
	}
	// asked again (a late duplicate of the hand-back): never sent a third time
	c.mu.Lock()
	c.takeJobs = []M{{"id": "job-k2-000001", "company": zz, "payload": pay}}
	c.mu.Unlock()
	cloudPostTake()
	time.Sleep(500 * time.Millisecond)
	waitJob(t, "job-k2-000001")
	if f.n("Import") != 2 || f.tagged("TDSDesk:k2") != 1 {
		t.Fatalf("sent a third time: %d imports, %d in Tally", f.n("Import"), f.tagged("TDSDesk:k2"))
	}
}

// an entry posted and confirmed, deleted in Tally by hand since: "Not in Tally - post again" from the Posted tab; the
// bridge looks, it is not there: sent once more
func TestSettleCheckPostedDeletedByHand(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	x := finVoucher("k5", fgParty, "B-80", td, "50.00")
	pay := M{"vouchers": []any{M{"id": "k5", "xml": x}}}
	if _, err := newPostJob(M{"jobId": "job-k5-000001", "company": zz, "vouchers": pay["vouchers"]}); err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, "job-k5-000001"); str(p["status"]) != "done" || f.tagged("TDSDesk:k5") != 1 {
		t.Fatalf("the posting: %v %q", p["status"], p["message"])
	}
	f.mu.Lock()
	f.vch = nil // deleted in Tally by hand
	f.mu.Unlock()
	c.mu.Lock()
	c.checks = []M{checkFor("13", "job-k5-000001", "k5", zz, x)}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "notseen" || f.n("Import") != 1 {
		t.Fatalf("the report: %v", r)
	}
	// a member confirms after looking: handed back with that entry alone
	c.mu.Lock()
	c.checks = nil
	c.takeJobs = []M{{"id": "job-k5-000001", "company": zz, "payload": pay, "released": []any{M{"id": "k5", "at": time.Now().UTC().Format(time.RFC3339), "by": "owner", "why": "deleted in Tally by hand (confirmed)"}}, "resendOnly": []any{"k5"}}}
	c.mu.Unlock()
	cloudPostTake()
	if p := waitJob(t, "job-k5-000001"); str(p["status"]) != "done" || f.n("Import") != 2 || f.tagged("TDSDesk:k5") != 1 {
		t.Fatalf("sent again: %v %q, %d imports, %d in Tally", p["status"], p["message"], f.n("Import"), f.tagged("TDSDesk:k5"))
	}
}

// Tally cannot be asked (silent; the company not open): nothing is sent, the cloud is told to wait, the next turn asks again
func TestSettleCheckSilentWaits(t *testing.T) {
	td := today()
	f := newStandTally(t)
	log := &fakeLog{}
	f.add(td, "Other Party", "Z-1", "an earlier entry", "-1.00") // Tally's numbers above 0: the starting point is recorded
	f.behave = silentFor(func(id, body string) bool { return id == vchByNumberID }, log)
	c := newStandCloud(t)
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`+c.cfg())
	x := finVoucher("k3", fgParty, "B-79", td, "30.00")
	c.mu.Lock()
	c.checks = []M{checkFor("11", "job-k3", "k3", zz, x)}
	c.mu.Unlock()
	t0 := time.Now()
	cloudPostTake()
	r := lastReport(t, c)
	if str(r["result"]) != "unable" || !strings.Contains(str(r["words"]), "Tally") || f.n("Import") != 0 {
		t.Fatalf("Tally silent: %v (%v)", r, f.ids())
	}
	if time.Since(t0) > 8*time.Second || log.longest() > 2*time.Second {
		t.Fatalf("Tally held too long: %s (longest request %s)", time.Since(t0), log.longest())
	}
	// the company not open in Tally
	c.mu.Lock()
	c.checks = []M{checkFor("12", "job-k4", "k4", "NOT OPEN CO", x)}
	c.mu.Unlock()
	cloudPostTake()
	if r := lastReport(t, c); str(r["result"]) != "unable" || !strings.Contains(str(r["words"]), "NOT OPEN CO") {
		t.Fatalf("company not open: %v", r)
	}
	// Tally answers again: the next turn asks again (and finds nothing: not found)
	f.mu.Lock()
	f.behave = nil
	f.mu.Unlock()
	time.Sleep(1100 * time.Millisecond)
	c.mu.Lock()
	c.checks = []M{checkFor("11", "job-k3", "k3", zz, x)}
	c.mu.Unlock()
	cloudPostTake()
	// (the owner's rule: Tally answered, nothing that day: notseen, never released by the report)
	if r := lastReport(t, c); str(r["result"]) != "notseen" || toInt(r["check"]) != 11 || !strings.Contains(str(r["words"]), "FinCom cannot see other dates") {
		t.Fatalf("asked again: %v", r)
	}
	if f.n(vchByNumberID) < 2 {
		t.Fatalf("not asked again: %v", f.ids())
	}
	if f.n("Import") != 0 {
		t.Fatal("sent to Tally")
	}
}

// ---------------------------------------------------------------- D
// the other bridge reads (it holds the lease for a read); this bridge wants to post: it waits, saying so; the reader's
// next renewal hands the lease over; the posting goes, once
func TestPostingTakesLeaseFromReader(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	c.lease = &leaseModel{}
	c.lease.take("go-other00002", "read")
	standBridge(t, f, `,"PostWaitMs":200,"LeaseWantMs":100`+c.cfg())
	j, err := newPostJob(M{"jobId": "job-lease-d1", "company": zz, "vouchers": []any{M{"id": "d1", "xml": finVoucher("d1", fgParty, "D-1", td, "9.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	dir, _ := jobDir(str(j["id"]))
	time.Sleep(800 * time.Millisecond)
	if p := readProgress(dir); str(p["status"]) != "waiting" || !strings.Contains(str(p["message"]), "reading "+zz) || !strings.Contains(str(p["message"]), "gives way") || f.n("Import") != 0 {
		t.Fatalf("while the other bridge reads: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	// the reader, at its next request boundary, renews: it sees the want and yields
	if a := c.lease.take("go-other00002", "read"); a["yield"] != true || c.lease.holderNow() != myBridgeID() {
		t.Fatalf("the reader's renewal: %v (holder %s)", a, c.lease.holderNow())
	}
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || f.n("Import") != 1 || f.tagged("TDSDesk:d1") != 1 {
		t.Fatalf("after the hand-over: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	if a := c.lease.take("go-other00002", "read"); a["held"] == true {
		t.Fatalf("the lease was not given back after the posting: %v", a)
	}
}

// this bridge reads in the background; the other bridge wants to post: this one yields at its next request boundary
// (the request at Tally finishes, none is cut), sends nothing to the company while the other posts, and resumes after
func TestReaderYieldsWithinOneRequest(t *testing.T) {
	td := today()
	from := fromTallyDate(td).AddDate(0, -3, 0).Format("200601") + "01"
	f := newStandTally(t)
	for d := from; d <= td; d = addDays(d, 5) {
		f.add(d, "Party X", "", "sale", "-100.00")
	}
	var cut, served atomic.Int32
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "Day Book" {
			return false
		}
		select {
		case <-time.After(400 * time.Millisecond):
			served.Add(1)
			return false // answered in full
		case <-r.Context().Done():
			cut.Add(1)
			return true
		}
	}
	c := newStandCloud(t)
	c.lease = &leaseModel{}
	standBridge(t, f, `,"LeaseWantSec":0,"KeepSliceDays":5`+c.cfg())
	oldDaysOn()
	liveFrom(from)
	st := readKeepState(syncFolder(zz))
	st["slice"] = 5
	saveKeepState(syncFolder(zz), st)
	done := make(chan struct{})
	go func() { runNow(t, "now"); close(done) }()
	for i := 0; i < 100 && f.n("Day Book") < 2; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if c.lease.holderNow() != myBridgeID() {
		t.Fatalf("the reader does not hold the lease: %q", c.lease.holderNow())
	}
	// the other bridge wants to post
	n0 := f.forCompany(zz)
	if a := c.lease.take("go-other00002", "post"); a["held"] != true || a["wanted"] != true {
		t.Fatalf("the other bridge's want: %v", a)
	}
	for i := 0; i < 100 && c.lease.holderNow() != "go-other00002"; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if c.lease.holderNow() != "go-other00002" {
		t.Fatalf("the reader did not yield: holder %q; %v", c.lease.holderNow(), c.lease.log)
	}
	n1 := f.forCompany(zz)
	if n1-n0 > 1 {
		t.Fatalf("the reader sent %d requests after the want (at most the one at Tally may finish)", n1-n0)
	}
	if cut.Load() != 0 {
		t.Fatalf("a request was cut mid-way (%d)", cut.Load())
	}
	// the other bridge posts while it holds the lease: this bridge sends nothing to the company meanwhile
	if a := c.lease.take("go-other00002", "post"); a["held"] != false {
		t.Fatalf("the posting bridge's own lease: %v", a)
	}
	x := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+finVoucher("o1", fgParty, "O-1", td, "5.00")+`</TALLYMESSAGE>`)
	resp, err := http.Post(f.srv.URL, "text/xml", strings.NewReader(x))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	time.Sleep(1500 * time.Millisecond)
	if n2 := f.forCompany(zz); n2 != n1+1 {
		t.Fatalf("this bridge sent %d request(s) to the company while the other posted", n2-n1-1)
	}
	if f.n("Import") != 1 || f.tagged("TDSDesk:o1") != 1 {
		t.Fatalf("the other bridge's posting: %d imports, %d in Tally", f.n("Import"), f.tagged("TDSDesk:o1"))
	}
	c.lease.release("go-other00002")
	before := f.n("Day Book")
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("the read did not finish")
	}
	if f.n("Day Book") <= before || str(readKeepState(syncFolder(zz))["roundAt"]) == "" {
		t.Fatalf("reading did not resume after the posting (%d Day Book requests, before %d)", f.n("Day Book"), before)
	}
	if cut.Load() != 0 || logLines("gives way to a posting") < 1 {
		t.Fatalf("cut %d; the log does not say it gave way", cut.Load())
	}
}

// a posting never yields: neither to a read nor to another posting; the other posting waits its turn (serialized)
func TestPostingNeverYieldsTwoPostingsSerialize(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 700 * time.Millisecond }
	c := newStandCloud(t)
	c.lease = &leaseModel{}
	standBridge(t, f, `,"PostWaitMs":200,"LeaseSec":1,"PostBatchBills":1`+c.cfg())
	var vs []any
	for _, id := range []string{"s1", "s2", "s3"} {
		vs = append(vs, M{"id": id, "xml": finVoucher(id, fgParty, "S-"+id, td, "4.00")})
	}
	j, err := newPostJob(M{"jobId": "job-serial-1", "company": zz, "vouchers": vs})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100 && f.n("Import") < 1; i++ {
		time.Sleep(30 * time.Millisecond)
	}
	// the other bridge, mid-posting: a read waits, a posting waits (no want recorded: a posting never yields)
	if a := c.lease.take("go-other00002", "read"); a["held"] != true {
		t.Fatalf("a read took the lease from a posting: %v", a)
	}
	if a := c.lease.take("go-other00002", "post"); a["held"] != true || a["wanted"] == true {
		t.Fatalf("a second posting: %v", a)
	}
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || f.n("Import") != 3 {
		t.Fatalf("the posting: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	c.lease.mu.Lock()
	for _, l := range c.lease.log {
		if strings.Contains(l, "yield") {
			t.Fatalf("a posting yielded: %v", c.lease.log)
		}
	}
	c.lease.mu.Unlock()
	// now the other bridge posts; this bridge's next posting waits for it, then goes once
	if a := c.lease.take("go-other00002", "post"); a["held"] != false {
		t.Fatalf("the other bridge's turn: %v", a)
	}
	j2, err := newPostJob(M{"jobId": "job-serial-2", "company": zz, "vouchers": []any{M{"id": "s4", "xml": finVoucher("s4", fgParty, "S-s4", td, "4.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	dir, _ := jobDir(str(j2["id"]))
	time.Sleep(800 * time.Millisecond)
	if p := readProgress(dir); str(p["status"]) != "waiting" || !strings.Contains(str(p["message"]), "posting to "+zz) || f.n("Import") != 3 {
		t.Fatalf("while the other bridge posts: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	c.lease.release("go-other00002")
	if p := waitJob(t, str(j2["id"])); str(p["status"]) != "done" || f.n("Import") != 4 || f.tagged("TDSDesk:s4") != 1 {
		t.Fatalf("after the other posting: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
}
