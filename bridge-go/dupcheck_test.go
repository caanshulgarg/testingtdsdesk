package main

// FinCom Bridge 2.1.4: the duplicate check at the moment of every posting, failing closed. A stand-in Tally that keeps
// what it is sent: an import adds its vouchers, and the check (and the read-back) lists them for the date and party asked.

import (
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type bookTally struct {
	standIn
	vouchers []string // the vouchers in Tally, as Tally would give them back
	imports  int      // import requests received
	checks   []string // the check requests received
	onCheck  func(w http.ResponseWriter) bool
}

func (b *bookTally) importsN() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.imports
}

func (b *bookTally) add(x string) {
	n := len(b.vouchers) + 1
	if !strings.Contains(x, "<VOUCHERNUMBER>") {
		x = strings.Replace(x, "</DATE>", fmt.Sprintf("</DATE><VOUCHERNUMBER>%d</VOUCHERNUMBER>", n), 1)
	}
	x = strings.Replace(x, "</DATE>", fmt.Sprintf("</DATE><GUID>guid-%d</GUID><MASTERID>%d</MASTERID>", n, 100+n), 1)
	b.vouchers = append(b.vouchers, x)
}

var reTestParty = re(`\$PartyLedgerName = "([^"]*)"`)

func newBookTally(t *testing.T) *bookTally {
	b := &bookTally{}
	b.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body := string(raw)
		id := group(`<ID>([^<]+)</ID>`, body, 1)
		if strings.Contains(body, "Import Data") {
			id = "Import"
		}
		b.mu.Lock()
		b.reqs = append(b.reqs, id)
		b.bodies = append(b.bodies, body)
		slow, onCheck := b.slow, b.onCheck
		if id == dupCheckID {
			b.checks = append(b.checks, body)
		}
		b.mu.Unlock()
		if id == dupCheckID && onCheck != nil && onCheck(w) {
			return
		}
		if slow != nil {
			if d := slow(id, body); d > 0 {
				select {
				case <-time.After(d):
				case <-r.Context().Done():
					return
				}
			}
		}
		out := "<ENVELOPE></ENVELOPE>"
		switch id {
		case "TDSDeskCompanies":
			out = `<ENVELOPE><COLLECTION><COMPANY NAME="` + zz + `"><NAME>` + zz + `</NAME><STARTINGFROM>20260401</STARTINGFROM><ENDINGAT>20270331</ENDINGAT><GUID>g-1</GUID></COMPANY></COLLECTION></ENVELOPE>`
		case "Import":
			b.mu.Lock()
			b.imports++
			n := 0
			for _, m := range re(`(?s)<VOUCHER\b.*?</VOUCHER>`).FindAllString(body, -1) {
				b.add(m)
				n++
			}
			n += strings.Count(body, "<LEDGER ")
			b.mu.Unlock()
			out = fmt.Sprintf("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>%d</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>", n)
		case dupCheckID, "TDSDeskVchHeads", tagCheckID:
			from, to := group(`<SVFROMDATE>(\d+)</SVFROMDATE>`, body, 1), group(`<SVTODATE>(\d+)</SVTODATE>`, body, 1)
			party := ""
			if m := reTestParty.FindStringSubmatch(body); m != nil {
				party = foldName(html.UnescapeString(m[1]))
			}
			var l strings.Builder
			b.mu.Lock()
			for _, v := range b.vouchers {
				d := group(`<DATE>(\d+)</DATE>`, v, 1)
				if d < from || d > to {
					continue
				}
				if party != "" && foldName(group(`<PARTYLEDGERNAME>([^<]*)</PARTYLEDGERNAME>`, v, 1)) != party {
					continue
				}
				l.WriteString(v)
			}
			b.mu.Unlock()
			out = "<ENVELOPE><COLLECTION>" + l.String() + "</COLLECTION></ENVELOPE>"
		}
		_, _ = w.Write([]byte(out))
	}))
	b.port = b.srv.Listener.Addr().(*net.TCPAddr).Port
	t.Cleanup(b.srv.Close)
	return b
}

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

// (a) the same voucher posted from two browser tabs (the second with stale data), at the same moment and once more
// after: the first posts, the others are refused "Already in Tally" with the first one's number; Tally got one import
func TestDupSecondTabRefused(t *testing.T) {
	b := newBookTally(t)
	bridgeFor(t, &b.standIn, "")
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
	if b.importsN() != 1 {
		t.Fatalf("Tally received %d imports, want 1", b.importsN())
	}
	if posted["verified"] != true || str(posted["vchNumber"]) != fgBill {
		t.Fatalf("the first was not read back: %v", posted)
	}
	want := "Already in Tally (voucher no. FA/ELEC/013, 01-07-2026)"
	if refused["already"] != true || str(refused["message"]) != want || str(refused["vchNo"]) != fgBill || str(refused["guid"]) != "guid-1" || refused["checkFailed"] == true {
		t.Fatalf("the second tab: %v", refused)
	}
	// the stale tab again, later, through a background job (Post again)
	jr, err := newPostJob(M{"jobId": "dup-tab-job-0001", "company": zz, "vouchers": []any{M{"id": "e1", "xml": x}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(jr["id"]))
	r := obj(arr(p["results"])[0])
	if r["ok"] == true || r["already"] != true || str(r["message"]) != want || str(r["guid"]) != "guid-1" {
		t.Fatalf("the job: %v", r)
	}
	if it := obj(arr(p["items"])[0]); it["already"] != true || str(it["vchNo"]) != fgBill || str(it["reason"]) != want {
		t.Fatalf("the job's item: %v", it)
	}
	if b.importsN() != 1 {
		t.Fatalf("Tally received %d imports, want 1", b.importsN())
	}
	// the check was one date, one party
	b.mu.Lock()
	c := b.checks[0]
	b.mu.Unlock()
	if !strings.Contains(c, "<SVFROMDATE>20260701</SVFROMDATE><SVTODATE>20260701</SVTODATE>") || !strings.Contains(c, `$PartyLedgerName = "Fingate"`) {
		t.Fatalf("the check was not for one date and the party: %s", c)
	}
	// 2.1.5: the stand-in answers FinComTag too, so the same FinCom id is found by the exact check first
	if n := logLines("NOT POSTED, already in Tally") + logLines("NOT POSTED, its FinCom id is in Tally already"); n != 2 {
		t.Fatalf("the log: %d lines", n)
	}
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

// (b) Tally times out on the check: nothing imported, checkFailed; Tally then left alone (busy): the next posting is not
// sent either
func TestDupCheckTimeoutNotPosted(t *testing.T) {
	b := newBookTally(t)
	b.slow = func(id, body string) time.Duration {
		if id == dupCheckID {
			return 3 * time.Second
		}
		return 0
	}
	bridgeFor(t, &b.standIn, `,"TallyMaxSec":1`)
	r := postOne(t, "e2", finVoucher("e2", fgParty, fgBill, fgDate, fgAmt))
	if r["ok"] == true || r["checkFailed"] != true || str(r["message"]) != "Could not check Tally, not posted. Try again." || r["already"] == true {
		t.Fatalf("timeout: %v", r)
	}
	// busy (Tally did not answer a moment ago): the next posting's check is not answered either: not posted
	b.mu.Lock()
	b.slow = nil
	b.mu.Unlock()
	r = postOne(t, "e3", finVoucher("e3", fgParty, "FA/ELEC/099", fgDate, fgAmt))
	if r["ok"] == true || r["checkFailed"] != true {
		t.Fatalf("busy: %v", r)
	}
	if b.importsN() != 0 || b.count("Import") != 0 {
		t.Fatalf("Tally received %d imports", b.importsN())
	}
	if logLines("NOT POSTED, could not check Tally") != 2 {
		t.Fatal("the log does not say so")
	}
	if failedLine(str(r["message"])) != "Could not check Tally, not posted. Try again." {
		t.Fatal(failedLine(str(r["message"])))
	}
}

// (b) a bad answer to the check (an error line, with or without the party filter): not posted
func TestDupCheckBadAnswerNotPosted(t *testing.T) {
	b := newBookTally(t)
	b.onCheck = func(w http.ResponseWriter) bool {
		_, _ = w.Write([]byte("<RESPONSE>Unknown Request, cannot be processed</RESPONSE>"))
		return true
	}
	bridgeFor(t, &b.standIn, "")
	r := postOne(t, "e4", finVoucher("e4", fgParty, fgBill, fgDate, fgAmt))
	if r["ok"] == true || r["checkFailed"] != true || b.importsN() != 0 {
		t.Fatalf("bad answer: %v, %d imports", r, b.importsN())
	}
	b.mu.Lock()
	n := len(b.checks)
	unfiltered := !strings.Contains(b.checks[len(b.checks)-1], "PartyLedgerName")
	b.mu.Unlock()
	if n != 2 || !unfiltered {
		t.Fatalf("the check is tried once more without the party filter: %d checks", n)
	}
}

// (c) Tally closed during the check (the connection dropped, the program gone): nothing posted, checkFailed
func TestDupCheckTallyClosed(t *testing.T) {
	b := newBookTally(t)
	b.onCheck = func(w http.ResponseWriter) bool {
		_ = b.srv.Listener.Close()
		if hj, ok := w.(http.Hijacker); ok {
			if c, _, err := hj.Hijack(); err == nil {
				_ = c.Close()
			}
		}
		return true
	}
	bridgeFor(t, &b.standIn, "")
	r := postOne(t, "e5", finVoucher("e5", fgParty, fgBill, fgDate, fgAmt))
	if r["ok"] == true || r["checkFailed"] != true || str(r["message"]) != dupCheckFailedMsg {
		t.Fatalf("closed: %v", r)
	}
	if b.importsN() != 0 || b.count("Import") != 0 {
		t.Fatal("posted while Tally closed")
	}
}

// (d) the same party and date, but a different amount, or a different bill number: not a duplicate
func TestDupOnlyTheSameVoucher(t *testing.T) {
	b := newBookTally(t)
	bridgeFor(t, &b.standIn, "")
	// in Tally: entered by hand (no FinCom tag), Tally's own number 13, the bill as its reference
	b.mu.Lock()
	b.add(strings.Replace(strings.Replace(finVoucher("x", fgParty, fgBill, fgDate, fgAmt), "<VOUCHERNUMBER>"+fgBill, "<VOUCHERNUMBER>13", 1), " | TDSDesk:x", "", 1))
	b.mu.Unlock()
	for _, c := range []struct{ id, party, bill, date, amt string }{
		{"d1", fgParty, fgBill, fgDate, "25536.00"},         // another amount
		{"d2", fgParty, "FA/ELEC/014", fgDate, fgAmt},       // another bill
		{"d3", fgParty, fgBill, "20260702", fgAmt},          // another date
		{"d4", "Fingate Two", fgBill, fgDate, fgAmt},        // another party
		{"d5", fgParty, "fa/elec/014 ", fgDate, "25536.00"}, // both
	} {
		if r := postOne(t, c.id, finVoucher(c.id, c.party, c.bill, c.date, c.amt)); r["ok"] != true || r["already"] == true {
			t.Fatalf("%s was taken for a duplicate: %v", c.id, r)
		}
	}
	if b.importsN() != 5 {
		t.Fatalf("imports %d", b.importsN())
	}
	// and the same one (its bill a reference in Tally, spaces and capitals aside): refused, with Tally's number 13
	r := postOne(t, "d6", finVoucher("d6", " fingate", "fa/elec/013", fgDate, "25,535.00"))
	if r["ok"] == true || r["already"] != true || str(r["vchNo"]) != "13" || str(r["guid"]) != "guid-1" || str(r["message"]) != "Already in Tally (voucher no. 13, 01-07-2026)" {
		t.Fatalf("the same bill: %v", r)
	}
	if b.importsN() != 5 {
		t.Fatal("posted twice")
	}
	// a ledger (a master) is not checked this way
	res, err := invokeImport(M{"company": zz, "masters": []any{M{"id": "m1", "xml": `<LEDGER NAME="Fingate" ACTION="Create"><NAME>Fingate</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`}}})
	if err != nil || obj(arr(res["results"])[0])["ok"] != true {
		t.Fatalf("a master: %v %v", res, err)
	}
}

// the rule itself, with what Tally writes (signs, commas, dates in words, an Optional or a cancelled voucher)
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

// (e) a posting from FinCom's cloud queue goes through the same check: the duplicate is not posted (it was entered in
// Tally another way, so no FinCom tag finds it), the new bill is; FinCom's queue hears already:true with the GUID
func TestDupCloudQueueChecked(t *testing.T) {
	b := newBookTally(t)
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
					M{"id": "c3", "xml": finVoucher("c3", fgParty, "FA/ELEC/020", fgDate, "1200.00")}, // the same bill twice in one batch
				}}}})))
				return
			}
		case "posts_update":
			updates = append(updates, o)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(cloud.Close)
	bridgeFor(t, &b.standIn, fmt.Sprintf(`,"CloudUrl":"%s","CloudKey":"plain:test-key"`, cloud.URL))
	b.mu.Lock()
	b.add(strings.Replace(finVoucher("old", fgParty, fgBill, fgDate, fgAmt), "<VOUCHERNUMBER>"+fgBill, "<VOUCHERNUMBER>13", 1))
	b.mu.Unlock()
	cloudPostTake()
	p := waitJob(t, "cloud-job-00000001")
	byID := map[string]M{}
	for _, x := range arr(p["results"]) {
		byID[str(obj(x)["id"])] = obj(x)
	}
	if r := byID["c1"]; r["ok"] == true || r["already"] != true || str(r["vchNo"]) != "13" || str(r["guid"]) != "guid-1" {
		t.Fatalf("the duplicate from the queue: %v", r)
	}
	if r := byID["c2"]; r["ok"] != true {
		t.Fatalf("the new bill: %v", r)
	}
	if r := byID["c3"]; r["ok"] == true || r["already"] != true {
		t.Fatalf("the same bill twice in one batch: %v", r)
	}
	if b.importsN() != 1 {
		t.Fatalf("imports %d, want 1 (the new bill only)", b.importsN())
	}
	b.mu.Lock()
	inTally := len(b.vouchers)
	b.mu.Unlock()
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
			found = r["already"] == true && str(r["guid"]) == "guid-1" && str(r["vchNo"]) == "13" && r["ok"] == false
		}
	}
	if !found {
		t.Fatalf("the queue's report: %v", last["results"])
	}
	_ = os.RemoveAll(filepath.Join(jobsDir(), "cloud-job-00000001"))
}
