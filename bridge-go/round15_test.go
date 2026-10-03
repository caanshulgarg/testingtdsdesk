package main

// Round 15 (03-Oct-2026, the owner's decision): posting is fast and never held by a read-back; Tally's import reply is
// trusted; no voucher id is ever inferred. A posting sends Tally one company check, the master imports and the voucher
// imports (bills in requests of PostBatchBills, bank lines of PostBatchBank), nothing else: no duplicate check against
// Tally, no tag read-back, no voucher-id lookup, no "checking" cycle. The only duplicate check is this computer's own
// record of what it sent (sync\posted-ids.json). The job reports every request's timing.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// the requests a posting may send: finding Tally (the company list), the one company check, and the imports
func onlyPostingRequests(t *testing.T, f *standTally, from int) {
	t.Helper()
	for _, id := range f.ids()[from:] {
		switch id {
		case "TDSDeskCompanies", "TDSDeskCompanyInfo", "FinComCompany", "FinComFree", "Import":
		default:
			t.Fatalf("a posting sent %q to Tally (read-backs are gone by the owner's decision of 03-Oct-2026): %v", id, f.ids()[from:])
		}
	}
}

// n bills (Journal vouchers) with ids prefix1..prefixN
func r15Bills(prefix, date string, n int) []any {
	var o []any
	for i := 1; i <= n; i++ {
		id := fmt.Sprintf("%s%d", prefix, i)
		o = append(o, M{"id": id, "xml": finVoucher(id, fgParty, strings.ToUpper(prefix)+"-"+fmt.Sprint(i), date, fmt.Sprintf("%d.00", i))})
	}
	return o
}

// a bank line: a Payment voucher (no bill number), as the bank page posts it
func bankVoucher(id, date, amt string) string {
	x := finVoucher(id, fgParty, "", date, amt)
	x = strings.ReplaceAll(x, `VCHTYPE="Journal"`, `VCHTYPE="Payment"`)
	x = strings.ReplaceAll(x, "<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>", "<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>")
	return strings.Replace(x, "Electricity Charges", "HDFC Bank", 1)
}
func r15Bank(prefix, date string, n int) []any {
	var o []any
	for i := 1; i <= n; i++ {
		id := fmt.Sprintf("%s%d", prefix, i)
		o = append(o, M{"id": id, "xml": bankVoucher(id, date, fmt.Sprintf("%d.00", i))})
	}
	return o
}

func r15Job(t *testing.T, id string, vouchers []any) M {
	t.Helper()
	if _, err := newPostJob(M{"jobId": id, "company": zz, "vouchers": vouchers}); err != nil {
		t.Fatal(err)
	}
	return waitJob(t, id)
}

func r15Results(p M) map[string]M {
	o := map[string]M{}
	for _, x := range arr(p["results"]) {
		r := obj(x)
		o[str(r["id"])] = r
	}
	return o
}

// the import requests the stand received: how many vouchers each carried, and how many TALLYMESSAGE each had
func r15Imports(f *standTally) (sizes []int, messages []int) {
	for _, b := range f.bodiesOf("Import") {
		sizes = append(sizes, strings.Count(b, "<VOUCHER "))
		messages = append(messages, strings.Count(b, "<TALLYMESSAGE"))
	}
	return
}

// --- A2. CREATED + ALTERED == S, no error, no exception, no LINEERROR: every entry of the request is posted, by Tally's
// reply, with the request's size and Tally's last voucher id; verified is false (nothing was read back)
func TestPostTrustsCreatedReply(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	p := r15Job(t, "job-r15-trust", r15Bills("tr", td, 3))
	if str(p["status"]) != "done" || p["checking"] == true {
		t.Fatalf("the job: %s %q checking %v", p["status"], p["message"], p["checking"])
	}
	if f.n("Import") != 1 {
		t.Fatalf("%d imports for 3 bills (want one request)", f.n("Import"))
	}
	f.mu.Lock()
	last := f.lastMaster
	f.mu.Unlock()
	rs := r15Results(p)
	if len(rs) != 3 {
		t.Fatalf("results: %v", p["results"])
	}
	for _, id := range []string{"tr1", "tr2", "tr3"} {
		r := rs[id]
		if r["ok"] != true || r["verified"] != false || r["byReply"] != true || toInt(r["batchN"]) != 3 || str(r["batchEnd"]) != last || str(r["lastVchId"]) != last {
			t.Fatalf("%s is not posted by Tally's reply: %v", id, r)
		}
		if _, has := r["vchId"]; has {
			t.Fatalf("%s carries a vchId though the request held 3 vouchers (no voucher id is ever inferred): %v", id, r)
		}
		if str(r["vchDate"]) != td || str(r["vchType"]) != "Journal" || str(r["company"]) != zz || str(r["kind"]) != "voucher" {
			t.Fatalf("%s: date, type, company: %v", id, r)
		}
		if _, err := time.Parse(time.RFC3339, str(r["sentAt"])); err != nil {
			t.Fatalf("%s: sentAt %q is not RFC3339", id, r["sentAt"])
		}
		if _, ok := r["secondsReq"].(float64); !ok {
			t.Fatalf("%s: secondsReq %v is not a number", id, r["secondsReq"])
		}
		if itemState(r, false) != "posted" {
			t.Fatalf("%s: state %q, want posted", id, itemState(r, false))
		}
		// recorded as sent on this computer
		a := acceptedInfo(id)
		if a == nil || a["sent"] != true || str(a["job"]) != "job-r15-trust" || toInt(a["batchN"]) != 3 || str(a["batchEnd"]) != last {
			t.Fatalf("%s is not in posted-ids.json as sent: %v", id, a)
		}
	}
	for _, x := range arr(p["items"]) {
		if e := obj(x); str(e["state"]) != "posted" || e["byReply"] != true {
			t.Fatalf("the item: %v", e)
		}
	}
	if !strings.HasPrefix(str(p["message"]), "Posted 3 of 3") {
		t.Fatalf("the job's line: %q", p["message"])
	}
	onlyPostingRequests(t, f, 0)
}

// --- A2. anything else in the reply: every entry of the request needs review, with Tally's counts and words; accepted
// when Tally made any; those ids are recorded as sent and never sent again by this bridge; nothing is retried
func TestPostNeedsReviewOnLineError(t *testing.T) {
	td := today()
	t.Run("errors in a batch", func(t *testing.T) {
		f := newStandTally(t)
		f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:nr3") } // Tally refuses the third (ERRORS 1)
		standBridge(t, f, "")
		p := r15Job(t, "job-r15-review", r15Bills("nr", td, 3))
		if f.n("Import") != 1 {
			t.Fatalf("%d imports (nothing is retried by the bridge)", f.n("Import"))
		}
		if str(p["status"]) != "done" || str(p["message"]) != "Posted 0 of 3; 3 need review" || p["checking"] == true {
			t.Fatalf("a request Tally made only partly ended %q %q (checking %v)", p["status"], p["message"], p["checking"])
		}
		rs := r15Results(p)
		for _, id := range []string{"nr1", "nr2", "nr3"} {
			r := rs[id]
			if r["ok"] != false || r["needsReview"] != true || r["accepted"] != true || toInt(r["created"]) != 2 || toInt(r["errors"]) != 1 || str(r["lastVchId"]) == "" {
				t.Fatalf("%s: %v", id, r)
			}
			if !strings.HasPrefix(str(r["message"]), "Tally's reply: created 2 of 3") || !strings.Contains(str(r["message"]), "errors 1") {
				t.Fatalf("%s: the message %q", id, r["message"])
			}
			if itemState(r, false) != "needs_review" {
				t.Fatalf("%s: state %q", id, itemState(r, false))
			}
			if a := acceptedInfo(id); a == nil || a["sent"] != true {
				t.Fatalf("%s accepted by Tally is not recorded as sent: %v", id, a)
			}
		}
		for _, x := range arr(p["items"]) {
			if e := obj(x); str(e["state"]) != "needs_review" || e["needsReview"] != true || !strings.HasPrefix(str(e["reason"]), "Tally's reply:") {
				t.Fatalf("the item: %v", e)
			}
		}
		// the same three again (Retry, or a new job): refused on this computer's record, nothing sent
		p = r15Job(t, "job-r15-review-2", r15Bills("nr", td, 3))
		if f.n("Import") != 1 {
			t.Fatalf("the second job sent an entry recorded as sent (%d imports)", f.n("Import"))
		}
		for id, r := range r15Results(p) {
			if r["alreadySent"] != true || !strings.HasPrefix(str(r["message"]), "already sent from this computer on ") {
				t.Fatalf("%s in the second job: %v", id, r)
			}
		}
		onlyPostingRequests(t, f, 0)
	})
	t.Run("a LINEERROR", func(t *testing.T) {
		f := newStandTally(t)
		f.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS><LASTVCHID>501</LASTVCHID></IMPORTRESULT>" +
			"<LINEERROR>Ledger &apos;Electricity Charges&apos; does not exist!</LINEERROR></DATA></BODY></ENVELOPE>")
		standBridge(t, f, "")
		r := postOne(t, "le1", finVoucher("le1", fgParty, "LE-1", td, "1.00"))
		if r["ok"] != false || r["needsReview"] != true || r["accepted"] != true || str(r["lastVchId"]) != "501" {
			t.Fatalf("a reply with a LINEERROR: %v", r)
		}
		le := strs(r["lineError"])
		if len(le) != 1 || !strings.Contains(le[0], "Ledger 'Electricity Charges' does not exist!") || !strings.Contains(str(r["message"]), "Ledger 'Electricity Charges' does not exist!") {
			t.Fatalf("the LINEERROR text: %v / %q", le, r["message"])
		}
		if a := acceptedInfo("le1"); a == nil || a["sent"] != true {
			t.Fatalf("not recorded as sent: %v", a)
		}
	})
	t.Run("nothing made", func(t *testing.T) {
		f := newStandTally(t)
		f.importSkip = func(string) bool { return true }
		standBridge(t, f, "")
		r := postOne(t, "nm1", finVoucher("nm1", fgParty, "NM-1", td, "1.00"))
		if r["ok"] != false || r["needsReview"] != true || r["accepted"] != false || toInt(r["created"]) != 0 || toInt(r["errors"]) != 1 {
			t.Fatalf("a reply that made nothing: %v", r)
		}
		if !strings.HasPrefix(str(r["message"]), "Tally's reply: created 0 of 1") {
			t.Fatalf("the message: %q", r["message"])
		}
		if acceptedInfo("nm1") != nil {
			t.Fatal("an entry Tally made nothing of was recorded as sent")
		}
		// so it may go again (Retry in FinCom): sent once more, and then recorded
		f.mu.Lock()
		f.importSkip = nil
		f.mu.Unlock()
		if r := postOne(t, "nm1", finVoucher("nm1", fgParty, "NM-1", td, "1.00")); r["ok"] != true || f.n("Import") != 2 {
			t.Fatalf("the retry: %v (%d imports)", r, f.n("Import"))
		}
	})
}

// a stand behaviour: every Import answered with this reply (nothing kept)
func importReply(reply string) func(w http.ResponseWriter, r *http.Request, id, body string) bool {
	return func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "Import" {
			return false
		}
		_, _ = w.Write([]byte(reply))
		return true
	}
}

// --- A1. during a posting Tally sees one company check, the master imports and the voucher imports, nothing else
func TestPostNoReadBackRequests(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "OLD-1", "Electricity | TDSDesk:rb1", "-1.00") // the same tag in Tally already: not asked about
	standBridge(t, f, "")
	master := `<LEDGER NAME="Round Fifteen" ACTION="Create"><NAME>Round Fifteen</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`
	if _, err := newPostJob(M{"jobId": "job-r15-norb", "company": zz, "masters": []any{M{"id": "m1", "xml": master}}, "vouchers": r15Bills("rb", td, 5), "checkFirst": true}); err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, "job-r15-norb")
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	onlyPostingRequests(t, f, 0)
	if f.n("FinComCompany") != 1 {
		t.Fatalf("the company check went %d times (want once per job): %v", f.n("FinComCompany"), f.ids())
	}
	if f.n("Import") != 2 { // the master, then the five bills in one request
		t.Fatalf("%d imports: %v", f.n("Import"), f.ids())
	}
	for _, id := range []string{dupCheckID, tagCheckID, masterCheckID, "TDSDeskVchHeads", "Day Book"} {
		if f.n(id) != 0 {
			t.Fatalf("%s was sent during a posting", id)
		}
	}
	// the one-request path (POST /import) too
	n0 := f.n("")
	if r := postOne(t, "rb9", finVoucher("rb9", fgParty, "RB-9", td, "9.00")); r["ok"] != true {
		t.Fatalf("postOne: %v", r)
	}
	onlyPostingRequests(t, f, n0)
	f.noBalance(t)
	f.noLedgerCollection(t)
}

// --- A3. bills go in requests of PostBatchBills (default 10), each request one envelope with one TALLYMESSAGE
func TestPostBatchesBillsByTen(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	p := r15Job(t, "job-r15-ten", r15Bills("bt", td, 25))
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	sizes, msgs := r15Imports(f)
	if fmt.Sprint(sizes) != "[10 10 5]" || fmt.Sprint(msgs) != "[1 1 1]" {
		t.Fatalf("requests of %v vouchers with %v TALLYMESSAGE each (want [10 10 5], one message each)", sizes, msgs)
	}
	reqs := arr(p["reqs"])
	if len(reqs) != 3 || toInt(obj(reqs[0])["n"]) != 10 || toInt(obj(reqs[2])["n"]) != 5 {
		t.Fatalf("the job's reqs: %v", reqs)
	}
	for id, r := range r15Results(p) {
		if r["ok"] != true || r["byReply"] != true {
			t.Fatalf("%s: %v", id, r)
		}
	}
	// the setting from the file
	f2 := newStandTally(t)
	standBridge(t, f2, `,"PostBatchBills":7`)
	r15Job(t, "job-r15-seven", r15Bills("bs", td, 25))
	if sizes, _ := r15Imports(f2); fmt.Sprint(sizes) != "[7 7 7 4]" {
		t.Fatalf("with PostBatchBills 7: %v", sizes)
	}
}

// --- A3. bank lines go in requests of PostBatchBank (default 50), apart from the bills
func TestPostBankBatchFifty(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	vch := append(r15Bills("bb", td, 3), r15Bank("bk", td, 60)...)
	p := r15Job(t, "job-r15-bank", vch)
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	sizes, _ := r15Imports(f)
	if fmt.Sprint(sizes) != "[3 50 10]" {
		t.Fatalf("requests of %v vouchers (want the 3 bills, then 50 and 10 bank lines)", sizes)
	}
	bodies := f.bodiesOf("Import")
	if strings.Contains(bodies[1], `VCHTYPE="Journal"`) || !strings.Contains(bodies[1], `VCHTYPE="Payment"`) {
		t.Fatal("a bank request carries a bill")
	}
	rs := r15Results(p)
	if r := rs["bk60"]; r["ok"] != true || toInt(r["batchN"]) != 10 || str(r["vchType"]) != "Payment" {
		t.Fatalf("the last bank line: %v", r)
	}
	// an item marked bank by FinCom goes with the bank lines whatever its type
	f2 := newStandTally(t)
	standBridge(t, f2, `,"PostBatchBank":4`)
	marked := []any{}
	for i, x := range r15Bills("mk", td, 5) {
		o := obj(x)
		o["bank"] = true
		_ = i
		marked = append(marked, o)
	}
	r15Job(t, "job-r15-marked", marked)
	if sizes, _ := r15Imports(f2); fmt.Sprint(sizes) != "[4 1]" {
		t.Fatalf("items marked bank with PostBatchBank 4: %v", sizes)
	}
}

// --- A2. one voucher in the request: Tally's LASTVCHID is its own id (vchId); more than one: no vchId, batchEnd only
func TestPostOneVoucherRequestCarriesVchId(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	r := postOne(t, "one1", finVoucher("one1", fgParty, "ONE-1", td, "1.00"))
	f.mu.Lock()
	last := f.lastMaster
	f.mu.Unlock()
	if r["ok"] != true || str(r["vchId"]) != last || toInt(r["batchN"]) != 1 || str(r["batchEnd"]) != last || str(r["lastVchId"]) != last {
		t.Fatalf("one voucher: %v (Tally's last id %s)", r, last)
	}
	if a := acceptedInfo("one1"); a == nil || str(a["vchId"]) != last {
		t.Fatalf("the record: %v", a)
	}
	p := r15Job(t, "job-r15-two", r15Bills("two", td, 2))
	f.mu.Lock()
	last = f.lastMaster
	f.mu.Unlock()
	for id, r := range r15Results(p) {
		if _, has := r["vchId"]; has {
			t.Fatalf("%s of a request of 2 carries a vchId: %v", id, r)
		}
		if str(r["batchEnd"]) != last || toInt(r["batchN"]) != 2 {
			t.Fatalf("%s: %v", id, r)
		}
		if a := acceptedInfo(id); a == nil || str(a["vchId"]) != "" || str(a["batchEnd"]) != last {
			t.Fatalf("%s record: %v", id, a)
		}
	}
	// the refusal names what is known
	r = postOne(t, "one1", finVoucher("one1", fgParty, "ONE-1", td, "1.00"))
	if r["alreadySent"] != true || !strings.Contains(str(r["message"]), "(Tally id "+str(acceptedInfo("one1")["vchId"])+")") {
		t.Fatalf("the refusal of a known voucher: %v", r)
	}
	r = postOne(t, "two1", finVoucher("two1", fgParty, "TWO-1", td, "1.00"))
	if r["alreadySent"] != true || strings.Contains(str(r["message"]), "(Tally id "+last+")") || !strings.Contains(str(r["message"]), "batch of 2") {
		t.Fatalf("the refusal of a voucher sent in a batch must not give it a Tally id: %v", r)
	}
}

// --- A2. the queue is never held: a job whose reply needs review ends at once, and the next job runs at once
func TestPostQueueNeverHeld(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:qa") } // Tally refuses job A's entries
	standBridge(t, f, "")
	t0 := time.Now()
	if _, err := newPostJob(M{"jobId": "job-r15-qa", "company": zz, "vouchers": r15Bills("qa", td, 3)}); err != nil {
		t.Fatal(err)
	}
	if _, err := newPostJob(M{"jobId": "job-r15-qb", "company": zz, "vouchers": r15Bills("qb", td, 2)}); err != nil {
		t.Fatal(err)
	}
	pb := waitJob(t, "job-r15-qb")
	el := time.Since(t0)
	pa := waitJob(t, "job-r15-qa")
	if str(pa["status"]) == "done" || pa["checking"] == true || jobAlive("job-r15-qa") {
		t.Fatalf("job A: %s checking %v alive %v", pa["status"], pa["checking"], jobAlive("job-r15-qa"))
	}
	if str(pb["status"]) != "done" {
		t.Fatalf("job B: %v", pb["message"])
	}
	if el > 4*time.Second {
		t.Fatalf("job B finished %s after both were queued: the queue was held", el.Round(time.Millisecond))
	}
	if f.n("Import") != 2 {
		t.Fatalf("%d imports", f.n("Import"))
	}
	if logLines("accepted by Tally but not confirmed yet") > 0 || logLines("being checked") > 0 {
		t.Fatal("the checking cycle ran")
	}
}

// --- A3. settings from FinCom in the beat answer: applied at once over the file's, kept in the file, logged; null
// leaves the file's value; the beat body carries what is applied; bounds 1..500
func TestBeatSettingsApplied(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"PostBatchBills":12`)
	c.mu.Lock()
	c.beatReply = M{"settings": M{"postOnly": []any{"ZZ TEST"}, "postBatchBills": 7, "postBatchBank": 20, "at": "2026-10-03T10:00:00Z"}}
	c.mu.Unlock()
	beatOnce()
	if postBatchBills() != 7 || postBatchBank() != 20 || strings.Join(postOnlyList(), ",") != "ZZ TEST" {
		t.Fatalf("not applied: bills %d bank %d postOnly %v", postBatchBills(), postBatchBank(), postOnlyList())
	}
	if cfgS("PostOnlyBy") != "fincom" || cfgS("PostBatchBy") != "fincom" || cfgS("SettingsAt") != "2026-10-03T10:00:00Z" {
		t.Fatalf("not marked FinCom's: %v %v %v", cfg("PostOnlyBy"), cfg("PostBatchBy"), cfg("SettingsAt"))
	}
	if logLines("Settings from FinCom: posts only to ZZ TEST; bills per request 7; bank lines per request 20 (set at 2026-10-03T10:00:00Z)") != 1 {
		t.Fatal("the log line")
	}
	// written to the file: a restart keeps them
	txt := readText(ConfigPath)
	if !strings.Contains(txt, `"PostBatchBills":7`) || !strings.Contains(txt, `"PostBatchBank":20`) || !strings.Contains(txt, `"PostBatchBy":"fincom"`) {
		t.Fatalf("the settings file: %s", txt)
	}
	loadConfig()
	if postBatchBills() != 7 || postBatchBank() != 20 || cfgS("PostOnlyBy") != "fincom" {
		t.Fatal("the settings did not survive a restart")
	}
	// the next beat body carries them
	beatOnce()
	c.mu.Lock()
	b := c.lastBeat
	c.mu.Unlock()
	if toInt(b["postBatchBills"]) != 7 || toInt(b["postBatchBank"]) != 20 || str(b["settingsAt"]) != "2026-10-03T10:00:00Z" || fmt.Sprint(b["postOnly"]) != "[ZZ TEST]" {
		t.Fatalf("the beat body: bills %v bank %v at %v postOnly %v", b["postBatchBills"], b["postBatchBank"], b["settingsAt"], b["postOnly"])
	}
	if logLines("Settings from FinCom:") != 1 {
		t.Fatal("the same settings were logged again")
	}
	// null leaves the value; a new 'at' with other values is applied and logged once more; bounds
	c.mu.Lock()
	c.beatReply = M{"settings": M{"postOnly": nil, "postBatchBills": 0, "postBatchBank": 900, "at": "2026-10-03T11:00:00Z"}}
	c.mu.Unlock()
	beatOnce()
	if postBatchBills() != 1 || postBatchBank() != 500 || strings.Join(postOnlyList(), ",") != "ZZ TEST" || cfgS("PostOnlyBy") != "fincom" {
		t.Fatalf("bounds / null: bills %d bank %d postOnly %v", postBatchBills(), postBatchBank(), postOnlyList())
	}
	if logLines("Settings from FinCom: posts only to ZZ TEST; bills per request 1; bank lines per request 500 (set at 2026-10-03T11:00:00Z)") != 1 {
		t.Fatal("the second log line")
	}
	// an answer without settings changes nothing
	c.mu.Lock()
	c.beatReply = M{}
	c.mu.Unlock()
	beatOnce()
	if postBatchBills() != 1 || postBatchBank() != 500 {
		t.Fatal("an answer without settings changed them")
	}
	// and a posting batches by the applied value
	c.mu.Lock()
	c.beatReply = M{"settings": M{"postBatchBills": 4, "at": "2026-10-03T12:00:00Z"}}
	c.mu.Unlock()
	beatOnce()
	r15Job(t, "job-r15-beatbatch", r15Bills("bb", td, 9))
	if sizes, _ := r15Imports(f); fmt.Sprint(sizes) != "[4 4 1]" {
		t.Fatalf("after FinCom set 4 per request: %v", sizes)
	}
}

// --- A4. every request's timing in the log and in the job view / posts_update
func TestPostTimingLogged(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"CloudPostSyncSec":0`)
	c.mu.Lock()
	c.takeJobs = append(c.takeJobs, M{"id": "job-r15-timing", "company": zz, "payload": M{"vouchers": r15Bills("tm", td, 12)}})
	c.mu.Unlock()
	cloudPostTake()
	p := waitJob(t, "job-r15-timing")
	syncCloudPosts()
	if str(p["status"]) != "done" {
		t.Fatalf("the job: %v", p["message"])
	}
	f.mu.Lock()
	last := f.lastMaster
	f.mu.Unlock()
	for _, want := range []string{"Posting job job-r15-timing: request 1 of 2: 10 vouchers in ", "Posting job job-r15-timing: request 2 of 2: 2 vouchers in ", " s (created 2, altered 0, exceptions 0, ignored 0, last Tally id " + last + ")",
		"Posting job job-r15-timing: 2 requests, 12 vouchers, "} {
		if logLines(want) < 1 {
			t.Fatalf("the log lacks %q", want)
		}
	}
	reqs := arr(p["reqs"])
	if len(reqs) != 2 {
		t.Fatalf("reqs: %v", reqs)
	}
	r2 := obj(reqs[1])
	if toInt(r2["n"]) != 2 || toInt(r2["created"]) != 2 || str(r2["lastVchId"]) != last {
		t.Fatalf("the second request's note: %v", r2)
	}
	for _, k := range []string{"seconds", "created", "altered", "exceptions", "ignored", "lastVchId", "n"} {
		if _, has := r2[k]; !has {
			t.Fatalf("the request's note lacks %s: %v", k, r2)
		}
	}
	if _, ok := p["secondsTotal"].(float64); !ok {
		t.Fatalf("secondsTotal: %v", p["secondsTotal"])
	}
	c.mu.Lock()
	posts := append([]M{}, c.posts...)
	c.mu.Unlock()
	found := false
	for _, b := range posts {
		if str(b["id"]) == "job-r15-timing" && len(arr(b["reqs"])) == 2 && b["secondsTotal"] != nil {
			found = true
		}
	}
	if !found {
		t.Fatalf("no posts_update carries reqs and secondsTotal: %d bodies", len(posts))
	}
}

// --- A5. the duplicate check is this computer's record alone: an id recorded as sent is refused with the date and
// Tally's id, nothing asked of Tally; an id in Tally that this computer never sent goes (the cloud's lock judges)
func TestDupCheckRecordsOnly(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "IN-1", "Electricity | TDSDesk:intally1", "-1.00") // in Tally, not sent from here
	standBridge(t, f, "")
	if err := noteSent("rec1", zz, "job-old", "77", 1, "77", "77"); err != nil {
		t.Fatal(err)
	}
	n0 := f.n("")
	r := postOne(t, "rec1", finVoucher("rec1", fgParty, "REC-1", td, "1.00"))
	if r["ok"] != false || r["alreadySent"] != true || !strings.HasPrefix(str(r["message"]), "already sent from this computer on ") || !strings.Contains(str(r["message"]), "(Tally id 77)") {
		t.Fatalf("a recorded id: %v", r)
	}
	onlyPostingRequests(t, f, n0) // finding Tally and the company check only
	if f.n("Import") != 0 || f.n(tagCheckID) != 0 || f.n(dupCheckID) != 0 || f.n(masterCheckID) != 0 {
		t.Fatalf("Tally was asked about a recorded id: %v", f.ids()[n0:])
	}
	// through a job: refused in the results and the items, the job failed with the reason
	p := r15Job(t, "job-r15-rec", []any{M{"id": "rec1", "xml": finVoucher("rec1", fgParty, "REC-1", td, "1.00")}})
	if f.n("Import") != 0 || str(p["status"]) != "failed" {
		t.Fatalf("the job: %s %v (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	e := obj(arr(p["items"])[0])
	if e["alreadySent"] != true || str(e["state"]) != "failed" || !strings.HasPrefix(str(e["reason"]), "already sent from this computer on ") {
		t.Fatalf("the item: %v", e)
	}
	// an id in Tally already but never sent from here: sent (Tally is not read), then recorded
	r = postOne(t, "intally1", finVoucher("intally1", fgParty, "IN-1", td, "1.00"))
	if r["ok"] != true || f.n("Import") != 1 || f.n(tagCheckID) != 0 || f.n(dupCheckID) != 0 {
		t.Fatalf("an id this computer never sent: %v (%v)", r, f.ids())
	}
	if a := acceptedInfo("intally1"); a == nil || a["sent"] != true {
		t.Fatalf("not recorded: %v", a)
	}
	// the record is the one key everywhere: the raw id and the tag id
	if r := postOne(t, "in-tally-1", finVoucher("intally1", fgParty, "IN-1", td, "1.00")); r["alreadySent"] != true {
		t.Fatalf("the same tag under another raw id went again: %v", r)
	}
	onlyPostingRequests(t, f, 0)
}

// --- A4. the bridge's own overhead on the stand: a posting of 1, 10, 50 and 100 bills with the default batch, and 100
// with batches of 1, 50 and 100 (the real numbers come from NWS144)
func TestPostTimingsOnStand(t *testing.T) {
	td := today()
	type row struct {
		n, batch int
		el       time.Duration
		reqs     int
	}
	var rows []row
	run := func(n, batch int) {
		f := newStandTally(t)
		standBridge(t, f, fmt.Sprintf(`,"PostBatchBills":%d`, batch))
		t0 := time.Now()
		p := r15Job(t, fmt.Sprintf("job-r15-time-%d-%d", n, batch), r15Bills("tt", td, n))
		el := time.Since(t0)
		if str(p["status"]) != "done" {
			t.Fatalf("%d bills by %d: %v", n, batch, p["message"])
		}
		rows = append(rows, row{n, batch, el, f.n("Import")})
	}
	for _, n := range []int{1, 10, 50, 100} {
		run(n, 10)
	}
	for _, b := range []int{1, 50, 100} {
		run(100, b)
	}
	var b strings.Builder
	b.WriteString("\nbills  batch  requests  wall time\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "%5d  %5d  %8d  %s\n", r.n, r.batch, r.reqs, r.el.Round(time.Millisecond))
	}
	t.Log(b.String())
}

// --- the coordinator's correction (03-Oct-2026): a posting with needs-review entries is "neither posted nor failed":
// the job ends "done" when anything was posted or Tally created something ("Posted N of M; K need review"); only when
// nothing was posted and nothing accepted does it end "failed" (a "failed" from the bridge stands in the cloud)
func TestNeedsReviewJobEndsDone(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostBatchBills":3`)
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:nd5") } // the second request (nd4, nd5): created 1 of 2
	p := r15Job(t, "job-r15-review-done", r15Bills("nd", td, 5))
	if str(p["status"]) != "done" || str(p["message"]) != "Posted 3 of 5; 2 need review" {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	st := r6States(p)
	if st["nd1"] != "posted" || st["nd3"] != "posted" || st["nd4"] != "needs_review" || st["nd5"] != "needs_review" {
		t.Fatalf("states: %v", st)
	}
	if f.n("Import") != 2 {
		t.Fatalf("%d imports", f.n("Import"))
	}
	// nothing posted but Tally created something: still done
	f2 := newStandTally(t)
	f2.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:nc2") }
	standBridge(t, f2, "")
	p = r15Job(t, "job-r15-review-done-2", r15Bills("nc", td, 2))
	if str(p["status"]) != "done" || str(p["message"]) != "Posted 0 of 2; 2 need review" {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	if postedLine(3, 5, 2, 1) != "Posted 3 of 5; 2 need review; 1 sent with no answer from Tally — Check Tally in FinCom" {
		t.Fatal(postedLine(3, 5, 2, 1))
	}
}

func TestNothingMadeEndsFailed(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importSkip = func(string) bool { return true } // created 0, errors n, no LINEERROR
	standBridge(t, f, "")
	p := r15Job(t, "job-r15-nothing", r15Bills("nf", td, 2))
	if str(p["status"]) != "failed" || !strings.HasPrefix(str(p["message"]), "Failed: 2 of 2 entries refused by Tally; first: Tally's reply: created 0 of 2, errors 2") {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	for id, r := range r15Results(p) {
		if r["needsReview"] != true || r["accepted"] != false || acceptedInfo(id) != nil {
			t.Fatalf("%s: %v", id, r)
		}
	}
}

// --- the code review of 2.1.8 (docs/reviews/bridge-2.1.8-code-review.md), findings 1, 2, 6, 7, 9

// finding 1: the bridge dies while a request is in flight (the reply delayed, progress.json and posted-ids.json as they
// stood during the request, the worker gone): the resumed job never sends the vouchers again; they are unknown (sent,
// no answer) with "Check Tally"
func TestRestartMidRequestNeverResends(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 2 * time.Second }
	dir := standBridge(t, f, "")
	if _, err := newPostJob(M{"jobId": "job-r15-crash", "company": zz, "vouchers": r15Bills("cr", td, 2)}); err != nil {
		t.Fatal(err)
	}
	jd, _ := jobDir("job-r15-crash")
	// during the request: snapshot the files as a crash would leave them
	var inReq bool
	for i := 0; i < 200 && !inReq; i++ {
		f.mu.Lock()
		inReq = f.inflight > 0 && len(f.reqs) > 0 && f.reqs[len(f.reqs)-1] == "Import"
		f.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	if !inReq {
		t.Fatal("the import never went")
	}
	time.Sleep(200 * time.Millisecond) // the progress written before the request lands
	prog, notes := readText(filepath.Join(jd, "progress.json")), readText(acceptedFile())
	p0 := parseObj(prog)
	if ids := strs(p0["inflight"]); len(ids) != 2 || ids[0] != "cr1" {
		t.Fatalf("progress.json during the request does not name the in-flight entries: %v", p0["inflight"])
	}
	n0 := parseObj(notes)
	if obj(n0["cr1"]) == nil || obj(n0["cr1"])["sent"] != true || obj(n0["cr2"]) == nil {
		t.Fatalf("posted-ids.json during the request does not hold the entries as sent: %s", notes)
	}
	waitJob(t, "job-r15-crash")
	// the crash: the files as snapshotted, the worker gone
	p0["status"], p0["updatedAt"] = "running", time.Now().Add(-time.Minute).Format(time.RFC3339Nano)
	_ = saveFile(filepath.Join(jd, "progress.json"), jsonText(p0))
	_ = saveFile(acceptedFile(), notes)
	acceptedReset()
	if str(jobView(jd)["status"]) != "interrupted" {
		t.Fatal("not seen as interrupted")
	}
	if _, err := resumePostJob("job-r15-crash"); err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, "job-r15-crash")
	if f.n("Import") != 1 {
		t.Fatalf("the resumed job sent the in-flight vouchers again (%d imports)", f.n("Import"))
	}
	if str(p["status"]) != "done" || !strings.Contains(str(p["message"]), "2 sent with no answer from Tally") {
		t.Fatalf("the resumed job: %s %q", p["status"], p["message"])
	}
	for _, x := range arr(p["items"]) {
		if e := obj(x); str(e["state"]) != "unknown" || !strings.Contains(str(e["reason"]), "Check Tally") {
			t.Fatalf("the item after the resume: %v", e)
		}
	}
	if _, has := p["inflight"]; has && len(arr(p["inflight"])) != 0 {
		t.Fatalf("inflight left after the job: %v", p["inflight"])
	}
	_ = dir
}

// finding 2: a job whose only answered request Tally refused (nothing made) and whose other request got no answer ends
// "done", never "failed" (the cloud frees the no-answer ids on a failed row)
func TestNoAnswerPlusRefusedEndsDone(t *testing.T) {
	td := today()
	f := newStandTally(t)
	var once sync.Once
	f.importAt = func(id, body string) (bool, time.Duration) {
		d := time.Duration(0)
		once.Do(func() { d = 3 * time.Second })
		return true, d
	}
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:uf2") }
	standBridge(t, f, `,"PostBatchBills":1,"TallyMaxSec":1,"PostTimeoutSec":1,"PostTimeoutBaseSec":1,"TallyProbeEverySec":2,"PostWaitMs":200`)
	p := r15Job(t, "job-r15-unknown-refused", r15Bills("uf", td, 2))
	if str(p["status"]) != "done" || str(p["message"]) != "Posted 0 of 2; 1 need review; 1 sent with no answer from Tally — Check Tally in FinCom" {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	st := r6States(p)
	if st["uf1"] != "unknown" || st["uf2"] != "needs_review" {
		t.Fatalf("states: %v", st)
	}
}

// finding 6: the needs-review message and lineError are capped (a request of 50 with 50 line errors)
func TestNeedsReviewMessageCapped(t *testing.T) {
	td := today()
	f := newStandTally(t)
	var errs strings.Builder
	for i := 1; i <= 50; i++ {
		fmt.Fprintf(&errs, "<LINEERROR>Ledger &apos;Some Long Ledger Name Number %02d That Does Not Exist In This Company&apos; does not exist!</LINEERROR>", i)
	}
	f.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>50</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT>" + errs.String() + "</DATA></BODY></ENVELOPE>")
	standBridge(t, f, `,"PostBatchBills":50`)
	p := r15Job(t, "job-r15-capped", r15Bills("cp", td, 50))
	for id, r := range r15Results(p) {
		m := str(r["message"])
		if len(m) >= 1000 || !strings.HasPrefix(m, "Tally's reply: created 0 of 50, errors 50: ") || !strings.Contains(m, "and 47 more") || !strings.Contains(m, "Number 01") || strings.Contains(m, "Number 04") {
			t.Fatalf("%s: the message (%d bytes): %q", id, len(m), m)
		}
		if le := arr(r["lineError"]); len(le) != 5 {
			t.Fatalf("%s: lineError holds %d texts (want 5)", id, len(le))
		}
	}
	if len(readText(filepath.Join(jobsDir(), "job-r15-capped", "progress.json"))) > 200000 {
		t.Fatal("progress.json grew with the square of the batch")
	}
	// a long single LINEERROR is cut to 200
	long := strings.Repeat("x", 500)
	l := replyLine(1, M{"created": 0, "errors": 1}, []string{long})
	if len(l) > 260 || !strings.HasSuffix(l, strings.Repeat("x", 200)+"...") {
		t.Fatalf("a long LINEERROR is not cut: %d bytes", len(l))
	}
}

// finding 7: an import request has its own timeout (PostTimeoutSec, default 120 s, or 20 s + 0.5 s per voucher, whichever
// is larger, capped at 300 s), not the 20 s read cap; a slow import is trusted, not unknown, and the self-watch does not
// stop reading for it
func TestImportTimeoutScalesWithBatch(t *testing.T) {
	setCfg("PostTimeoutSec", nil)
	if importTimeoutSec(1) != 120 || importTimeoutSec(500) != 270 {
		t.Fatalf("defaults: %d %d", importTimeoutSec(1), importTimeoutSec(500))
	}
	setCfg("PostTimeoutSec", float64(30))
	if importTimeoutSec(1) != 30 || importTimeoutSec(100) != 70 {
		t.Fatalf("PostTimeoutSec 30: %d %d", importTimeoutSec(1), importTimeoutSec(100))
	}
	setCfg("PostTimeoutSec", float64(400))
	if importTimeoutSec(1) != 300 {
		t.Fatalf("the cap: %d", importTimeoutSec(1))
	}
	setCfg("PostTimeoutSec", nil)
	td := today()
	f := newStandTally(t)
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 3 * time.Second }
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1,"PostBatchBills":50,"SelfStopSec":1`)
	p := r15Job(t, "job-r15-slow-import", r15Bills("sl", td, 50))
	if str(p["status"]) != "done" || !strings.HasPrefix(str(p["message"]), "Posted 50 of 50") {
		t.Fatalf("a 3 s import with a 1 s read cap: %s %q", p["status"], p["message"])
	}
	if readStopped() {
		t.Fatalf("the self-watch stopped reading for an import: %v", readStop())
	}
	if toInt(beatReqs()["over20"]) != 0 {
		t.Fatalf("the import counted in over20: %v", beatReqs())
	}
	if logLines("an import request") < 1 {
		t.Fatal("the slow import is not logged as an import time")
	}
	// a read is still cut at the read cap
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 3 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	if _, err := getLedgerNames(fin, zz, f.port); err == nil || time.Since(t0) > 2500*time.Millisecond {
		t.Fatalf("a read was not cut at the read cap: %v after %s", err, time.Since(t0))
	}
}

// finding 9: the cloud's PostOnly list is bounded here too (20 names, 200 characters each)
func TestBeatSettingsBounded(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	var names []any
	for i := 0; i < 30; i++ {
		names = append(names, fmt.Sprintf("Company %02d %s", i, strings.Repeat("x", 300)))
	}
	c.mu.Lock()
	c.beatReply = M{"settings": M{"postOnly": names, "at": "2026-10-03T13:00:00Z"}}
	c.mu.Unlock()
	beatOnce()
	list := postOnlyList()
	if len(list) != 20 {
		t.Fatalf("%d names kept (want 20)", len(list))
	}
	for _, n := range list {
		if len(n) > 200 {
			t.Fatalf("a name of %d characters kept", len(n))
		}
	}
	if !strings.HasPrefix(list[19], "Company 19 ") {
		t.Fatalf("the first 20 are not the ones kept: %q", list[19])
	}
}

// --- the fix review of 2.1.8, F1 and F2

// F1: nothing goes to Tally without the record on disk: posted-ids.json unwritable (a directory in its place) → the job
// waits ("record not written; nothing sent"), 0 imports; writable again → it posts. The /import route says so too
func TestNoSendWhenRecordNotWritable(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	_ = os.MkdirAll(acceptedFile(), 0o755)
	t.Cleanup(func() { _ = os.RemoveAll(acceptedFile()) })
	acceptedReset()
	r := postOne(t, "nw0", finVoucher("nw0", fgParty, "NW-0", td, "1.00"))
	if r["ok"] == true || r["notSent"] != true || !strings.Contains(str(r["message"]), "record not written; nothing sent") || f.n("Import") != 0 {
		t.Fatalf("/import with the record unwritable: %v (%d imports)", r, f.n("Import"))
	}
	if _, err := newPostJob(M{"jobId": "job-r15-norecord", "company": zz, "vouchers": r15Bills("nw", td, 2)}); err != nil {
		t.Fatal(err)
	}
	jd, _ := jobDir("job-r15-norecord")
	var p M
	for i := 0; i < 100; i++ {
		p = readProgress(jd)
		if p != nil && str(p["status"]) == "waiting" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(p["status"]) != "waiting" || f.n("Import") != 0 {
		t.Fatalf("the job with the record unwritable: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	if logLines("record not written; nothing sent") < 1 {
		t.Fatal("the log does not say why nothing was sent")
	}
	_ = os.RemoveAll(acceptedFile())
	acceptedReset()
	p = waitJob(t, "job-r15-norecord")
	if str(p["status"]) != "done" || f.n("Import") != 1 {
		t.Fatalf("after the record is writable again: %s %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	if a := acceptedInfo("nw1"); a == nil || a["sent"] != true {
		t.Fatalf("the record after the posting: %v", a)
	}
}

// F2: "Tally not reached" (a probe hold here) inside sendImport forgets the pre-send notes on both routes, so a browser
// retry is not refused as "already sent"
func TestImportNotReachedForgetsNotes(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 3 * time.Second
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	if _, err := findCompanyPort(zz, 0); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	nowFn = func() time.Time { return start }
	if _, err := getLedgerNames(fin, zz, f.port); err == nil {
		t.Fatal("the slow read answered")
	}
	// within the minute: the import is held (nothing reached Tally); the note made before the send is forgotten
	imports := f.n("Import")
	res, err := invokeImport(M{"company": zz, "guidChecked": true, "vouchers": []any{M{"id": "nr1", "xml": finVoucher("nr1", fgParty, "NR-1", td, "1.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	r := obj(arr(res["results"])[0])
	if r["ok"] == true || r["notSent"] != true || f.n("Import") != imports {
		t.Fatalf("held import: %v", r)
	}
	if acceptedInfo("nr1") != nil {
		t.Fatalf("the note stayed though nothing reached Tally: %v", acceptedInfo("nr1"))
	}
	// the probe may go and Tally is free: the retry posts, not refused as already sent
	nowFn = func() time.Time { return start.Add(2 * time.Minute) }
	r = postOne(t, "nr1", finVoucher("nr1", fgParty, "NR-1", td, "1.00"))
	nowFn = time.Now
	if r["ok"] != true || r["alreadySent"] == true {
		t.Fatalf("the retry: %v", r)
	}
}
