package main

// The duplicate check before a posting. Until 2.1.7 it read Tally live (TDSDeskDupCheck, FinComTag) and failed closed.
// Round 15 (03-Oct-2026, the owner's decision): posting is never held by a read; the check is this computer's own
// record of what it sent (sync\posted-ids.json; sentBeforeRefusal), and the cloud's tally_post_ids lock refuses a bill
// already posted when it is queued. The Tally-request cases of 2.1.4 are gone from here; the matching rule
// (sameVoucher) stays tested because the request stays in the program for Check Tally and the read test.

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// a FinCom voucher: a supplier's bill (the party credited, its bill allocation named as the bill)
func finVoucher(id, party, bill, date, amt string) string {
	return `<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>` + date + `</DATE><EFFECTIVEDATE>` + date + `</EFFECTIVEDATE>` +
		`<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>` + bill + `</VOUCHERNUMBER><REFERENCE>` + bill + `</REFERENCE><PARTYLEDGERNAME>` + party + `</PARTYLEDGERNAME>` +
		`<NARRATION>Electricity | TDSDesk:` + id + `</NARRATION><ISOPTIONAL>No</ISOPTIONAL>` +
		`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Electricity Charges</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-` + amt + `</AMOUNT></ALLLEDGERENTRIES.LIST>` +
		`<ALLLEDGERENTRIES.LIST><LEDGERNAME>` + party + `</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>` + amt + `</AMOUNT>` +
		`<BILLALLOCATIONS.LIST><NAME>` + bill + `</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>` + amt + `</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>`
}

const (
	fgParty = "Fingate"
	fgBill  = "FA/ELEC/013"
	fgDate  = "20260701"
	fgAmt   = "25535.00"
)

func postOne(t *testing.T, id, x string) M {
	t.Helper()
	res, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": id, "xml": x}}})
	if err != nil {
		t.Fatalf("the posting was refused as a whole: %v", err)
	}
	rs := arr(res["results"])
	if len(rs) != 1 {
		t.Fatalf("results: %v", rs)
	}
	return obj(rs[0])
}

func waitJob(t *testing.T, id string) M {
	t.Helper()
	dir, _ := jobDir(id)
	for i := 0; i < 300; i++ {
		p := readProgress(dir)
		if p != nil && (str(p["status"]) == "done" || str(p["status"]) == "failed") && p["checking"] != true && !jobAlive(id) {
			return p
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("the job %s did not finish", id)
	return nil
}

// (a) the same voucher posted from two browser tabs (the second with stale data), at the same moment and once more
// after: the first posts, the others are refused on this computer's record; Tally got one import and no read
func TestDupSecondTabRefused(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	x := finVoucher("e1", fgParty, fgBill, fgDate, fgAmt)
	var wg sync.WaitGroup
	out := make([]M, 2)
	for i := range out {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if res, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "e1", "xml": x}}}); err == nil && len(arr(res["results"])) == 1 {
				out[i] = obj(arr(res["results"])[0])
			}
		}(i)
	}
	wg.Wait()
	var posted, refused M
	for _, r := range out {
		if r["ok"] == true {
			posted = r
		} else {
			refused = r
		}
	}
	if posted == nil || refused == nil {
		t.Fatalf("want one posted and one refused: %v", out)
	}
	if f.n("Import") != 1 {
		t.Fatalf("Tally received %d imports, want 1", f.n("Import"))
	}
	if posted["byReply"] != true || posted["verified"] != false || str(posted["vchId"]) == "" {
		t.Fatalf("the first was not posted by Tally's reply: %v", posted)
	}
	if refused["alreadySent"] != true || !strings.HasPrefix(str(refused["message"]), "already sent from this computer on ") || !strings.Contains(str(refused["message"]), "(Tally id "+str(posted["vchId"])+")") {
		t.Fatalf("the second tab: %v", refused)
	}
	// the stale tab again, later, through a background job (Post again)
	jr, err := newPostJob(M{"jobId": "dup-tab-job-0001", "company": zz, "vouchers": []any{M{"id": "e1", "xml": x}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(jr["id"]))
	r := obj(arr(p["results"])[0])
	if r["ok"] == true || r["alreadySent"] != true || str(r["message"]) != str(refused["message"]) {
		t.Fatalf("the job: %v", r)
	}
	if it := obj(arr(p["items"])[0]); it["alreadySent"] != true || str(it["state"]) != "failed" || str(it["reason"]) != str(refused["message"]) {
		t.Fatalf("the job's item: %v", it)
	}
	if f.n("Import") != 1 {
		t.Fatalf("Tally received %d imports, want 1", f.n("Import"))
	}
	onlyPostingRequests(t, f, 0)
	if logLines("NOT SENT: already sent from this computer") != 2 {
		t.Fatalf("the log: %d lines", logLines("NOT SENT: already sent from this computer"))
	}
}

// (b) an id in Tally that this computer never sent (entered by hand, or sent from another computer): not read for, sent
// (the cloud's lock is the judge of what is posted); a different id with the same party, bill, date and amount: sent too
func TestDupRecordNotTally(t *testing.T) {
	f := newStandTally(t)
	f.add(fgDate, fgParty, "13", "Electricity", "-"+fgAmt) // in Tally by hand: no FinCom tag
	f.add(fgDate, fgParty, fgBill, "Electricity | TDSDesk:other1", "-"+fgAmt)
	standBridge(t, f, "")
	for _, id := range []string{"d1", "other1"} {
		if r := postOne(t, id, finVoucher(id, fgParty, fgBill, fgDate, fgAmt)); r["ok"] != true {
			t.Fatalf("%s: %v", id, r)
		}
	}
	if f.n("Import") != 2 || f.n(dupCheckID) != 0 || f.n(tagCheckID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
	// and now each is on the record: refused, nothing sent
	for _, id := range []string{"d1", "other1"} {
		if r := postOne(t, id, finVoucher(id, fgParty, "ANOTHER-NO", "20260702", "1.00")); r["alreadySent"] != true {
			t.Fatalf("%s again: %v", id, r)
		}
	}
	if f.n("Import") != 2 {
		t.Fatal("posted twice")
	}
	// a ledger (a master) is not checked this way
	res, err := invokeImport(M{"company": zz, "masters": []any{M{"id": "m1", "xml": `<LEDGER NAME="Fingate" ACTION="Create"><NAME>Fingate</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`}}})
	if err != nil || obj(arr(res["results"])[0])["ok"] != true {
		t.Fatalf("a master: %v %v", res, err)
	}
	onlyPostingRequests(t, f, 0)
}

// the matching rule itself, with what Tally writes (signs, commas, dates in words, an Optional or a cancelled voucher):
// kept for Check Tally and the read test; no posting calls it (round 15)
func TestDupMatchingRule(t *testing.T) {
	k := func(x string) vchKey { return keyOfVoucher(xmlDoc(x).All("VOUCHER")[0]) }
	p := k(finVoucher("a", fgParty, fgBill, fgDate, fgAmt))
	if p.amount != 2553500 || p.total != 2553500 || p.date != fgDate || p.party != "FINGATE" || p.tag != "TDSDesk:a" {
		t.Fatalf("key: %+v", p)
	}
	tally := `<VOUCHER><DATE>1-Jul-2026</DATE><VOUCHERNUMBER>7</VOUCHERNUMBER><PARTYLEDGERNAME>FINGATE</PARTYLEDGERNAME>
		<ALLLEDGERENTRIES.LIST><LEDGERNAME>Fingate</LEDGERNAME><AMOUNT>25,535.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>FA/ELEC/013</NAME></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
		<ALLLEDGERENTRIES.LIST><LEDGERNAME>Power</LEDGERNAME><AMOUNT>-25535</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`
	if !sameVoucher(p, k(tally)) {
		t.Fatal("the bill allocation in Tally, written its way")
	}
	if sameVoucher(p, k(strings.Replace(tally, "</VOUCHERNUMBER>", "</VOUCHERNUMBER><ISCANCELLED>Yes</ISCANCELLED>", 1))) {
		t.Fatal("a cancelled voucher counted")
	}
	if !sameVoucher(p, k(strings.Replace(tally, "</VOUCHERNUMBER>", "</VOUCHERNUMBER><ISOPTIONAL>Yes</ISOPTIONAL>", 1))) {
		t.Fatal("an Optional voucher is in Tally too")
	}
	// the same FinCom tag, though Tally renumbered it and the bill was not kept: the same voucher
	if !sameVoucher(p, k(`<VOUCHER><DATE>20260701</DATE><VOUCHERNUMBER>9</VOUCHERNUMBER><PARTYLEDGERNAME>Fingate</PARTYLEDGERNAME><NARRATION>x TDSDesk:a</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Fingate</LEDGERNAME><AMOUNT>25535.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`)) {
		t.Fatal("the same tag")
	}
	// a voucher kept without a party ledger in Tally: its ledger line counts
	if !sameVoucher(p, k(`<VOUCHER><DATE>20260701</DATE><REFERENCE>FA/ELEC/013</REFERENCE><ALLLEDGERENTRIES.LIST><LEDGERNAME>Fingate</LEDGERNAME><AMOUNT>25535.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Power</LEDGERNAME><AMOUNT>-25535.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`)) {
		t.Fatal("no party ledger in Tally")
	}
	// TDS: the party's line (net) differs from the total; compared line to line
	tds := strings.Replace(finVoucher("t", fgParty, fgBill, fgDate, "25000.00"), "<AMOUNT>-25000.00</AMOUNT>", "<AMOUNT>-25535.00</AMOUNT>", 1)
	if sameVoucher(p, k(tds)) {
		t.Fatal("a party line of 25,000.00 is not 25,535.00")
	}
	// a bank entry without a bill number: the same only when Tally's has none either
	bank := func(ref string) string {
		return `<VOUCHER><DATE>20260701</DATE>` + ref + `<PARTYLEDGERNAME>Fingate</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>Fingate</LEDGERNAME><AMOUNT>-500.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>500.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`
	}
	if !sameVoucher(k(bank("")), k(bank("<VOUCHERNUMBER>44</VOUCHERNUMBER>"))) || sameVoucher(k(bank("")), k(bank("<REFERENCE>INV-1</REFERENCE>"))) {
		t.Fatal("bank entries")
	}
}

// (c) the read for Check Tally and the read test still works and still asks one date (and one party): a reader's
// request, never a posting's
func TestDupReadForCheckTally(t *testing.T) {
	f := newStandTally(t)
	f.add(fgDate, fgParty, "13", "Electricity", "-"+fgAmt)
	f.add(fgDate, "Someone", "14", "Rent", "-1.00")
	standBridge(t, f, "")
	there, err := vouchersOnDate(f.port, zz, fgDate, fgParty)
	if err != nil || len(there) != 2 { // the stand does not filter by party; the rule does
		t.Fatalf("the read: %v %v", there, err)
	}
	b := f.bodiesOf(dupCheckID)
	if len(b) != 1 || !strings.Contains(b[0], "<SVFROMDATE>20260701</SVFROMDATE><SVTODATE>20260701</SVTODATE>") || !strings.Contains(b[0], `$PartyLedgerName = "Fingate"`) {
		t.Fatalf("the check was not for one date and the party: %v", b)
	}
	p := keyOfVoucher(xmlDoc(finVoucher("x", fgParty, "13", fgDate, fgAmt)).All("VOUCHER")[0])
	n := 0
	for _, e := range there {
		if sameVoucher(p, e) {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("%d of the day's entries match the bill (want the one)", n)
	}
}

// (d) a posting from FinCom's cloud queue goes through the same record check: an id this computer sent before is
// refused (FinCom's queue hears alreadySent), the new bills go in one request
func TestDupCloudQueueChecked(t *testing.T) {
	f := newStandTally(t)
	var cmu sync.Mutex
	var updates []M
	taken := false
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		o := parseObj(string(raw))
		cmu.Lock()
		defer cmu.Unlock()
		switch str(o["kind"]) {
		case "posts_take":
			if !taken {
				taken = true
				_, _ = w.Write([]byte(jsonText(M{"job": M{"id": "cloud-job-00000001", "company": zz, "payload": M{"vouchers": []any{
					M{"id": "c1", "xml": finVoucher("c1", fgParty, fgBill, fgDate, fgAmt)},
					M{"id": "c2", "xml": finVoucher("c2", fgParty, "FA/ELEC/020", fgDate, "1200.00")},
					M{"id": "c3", "xml": finVoucher("c3", fgParty, "FA/ELEC/021", fgDate, "1300.00")},
				}}}})))
				return
			}
		case "posts_update":
			updates = append(updates, o)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(cloud.Close)
	standBridge(t, f, fmt.Sprintf(`,"CloudUrl":"%s","CloudKey":"plain:test-key"`, cloud.URL))
	if err := noteSent("c1", zz, "job-earlier", "13", 1, "13", "13"); err != nil {
		t.Fatal(err)
	}
	cloudPostTake()
	p := waitJob(t, "cloud-job-00000001")
	byID := map[string]M{}
	for _, x := range arr(p["results"]) {
		byID[str(obj(x)["id"])] = obj(x)
	}
	if r := byID["c1"]; r["ok"] == true || r["alreadySent"] != true || !strings.Contains(str(r["message"]), "(Tally id 13)") {
		t.Fatalf("the duplicate from the queue: %v", r)
	}
	if r := byID["c2"]; r["ok"] != true || toInt(r["batchN"]) != 2 {
		t.Fatalf("the new bill: %v", r)
	}
	if r := byID["c3"]; r["ok"] != true {
		t.Fatalf("the other new bill: %v", r)
	}
	if f.n("Import") != 1 {
		t.Fatalf("imports %d, want 1 (the two new bills in one request)", f.n("Import"))
	}
	f.mu.Lock()
	inTally := len(f.vch)
	f.mu.Unlock()
	if inTally != 2 {
		t.Fatalf("%d vouchers in Tally, want 2", inTally)
	}
	syncCloudPosts()
	cmu.Lock()
	defer cmu.Unlock()
	if len(updates) == 0 {
		t.Fatal("FinCom's queue heard nothing")
	}
	last := updates[len(updates)-1]
	found := false
	for _, x := range arr(last["results"]) {
		r := obj(x)
		if str(r["id"]) == "c1" {
			found = r["alreadySent"] == true && r["ok"] == false && str(r["state"]) == "failed"
		}
		if str(r["id"]) == "c2" && (r["byReply"] != true || str(r["state"]) != "posted") {
			t.Fatalf("the queue's report of a posted bill: %v", r)
		}
	}
	if !found {
		t.Fatalf("the queue's report: %v", last["results"])
	}
	_ = os.RemoveAll(filepath.Join(jobsDir(), "cloud-job-00000001"))
}
