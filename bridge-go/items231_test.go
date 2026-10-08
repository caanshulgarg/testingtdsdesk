package main

// Bridge 2.3.1 (the owner's decision of 06-Oct-2026): "change the entry request so the bridge also asks Tally for the
// ledger lines kept under the items of a sales or purchase invoice (item invoice mode). Conditions: one entry per
// request as today, read only, inside the 2-second rule, nothing else added to the request."
//
// An item invoice keeps its sales or purchase ledger under each item (ALLINVENTORYENTRIES.LIST >
// ACCOUNTINGALLOCATIONS.LIST); the party and the GST ledgers are its ledger entries. Up to 2.3.0 the entry request
// fetched only ALLLEDGERENTRIES, so such an entry reached FinCom with the party and GST lines alone: a body that does
// not balance. 2.3.1 adds exactly ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.{LEDGERNAME, AMOUNT, ISDEEMEDPOSITIVE} to
// both forms (FinComVoucherByMaster and FinComVoucherByNumber) and nothing else.
//
// The fixtures (testdata/typed-like-7.1/{sales-invoice,purchase-invoice,credit-note}-items.xml) are typed exactly as the
// real TallyPrime 7.1 answers in testdata/real-tally-7.1 (TYPE attributes, padded numbers, Tally's own extra fields, the
// CMPINFO counters ahead of the data); they are not captured from a real Tally. The stand Tally here answers as a
// collection export does: the items' lines come back only when the request fetches them (items231Answer).
// Tests written before the code.

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// the 2.3.0 fetch, byte for byte (the shapes b6b4d3b5f221 and 42ccf0c70605 of the 2.3.0 table)
const items231OldFetch = "GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, ISCANCELLED, ISOPTIONAL, " +
	"ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, " +
	"ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD"

// what 2.3.1 adds, and only this
const items231Added = ", ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT, " +
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE"

// the request as 2.3.0 built it
func items231Old(x string) string {
	return strings.Replace(x, "<FETCH>"+liveFetchField+"</FETCH>", "<FETCH>"+items231OldFetch+"</FETCH>", 1)
}

type items231Vch struct {
	file, mid, typ, no string
	lines              map[string]float64 // ledger -> its total in the voucher (credit positive, as Tally's AMOUNT)
}

var items231Vchs = []items231Vch{
	{"sales-invoice-items.xml", "11", "Sales", "101", map[string]float64{
		"Spike Customer": -4130, "CGST Output 9%": 315, "SGST Output 9%": 315, "Sales GST 18%": 3500}},
	{"purchase-invoice-items.xml", "12", "Purchase", "55", map[string]float64{
		"Spike Supplier": 11800, "CGST Input 9%": -900, "SGST Input 9%": -900, "Purchase GST 18%": -10000}},
	{"credit-note-items.xml", "13", "Credit Note", "7", map[string]float64{
		"Spike Customer": 1180, "CGST Output 9%": -90, "SGST Output 9%": -90, "Sales GST 18%": -1000}},
}

func items231Fixture(t *testing.T, file string) string {
	t.Helper()
	b := readText("testdata/typed-like-7.1/" + file)
	if b == "" {
		t.Fatalf("no fixture %s", file)
	}
	return b
}

var reItems231Inv = regexp.MustCompile(`\s*<ALLINVENTORYENTRIES\.LIST>[\s\S]*?</ALLINVENTORYENTRIES\.LIST>`)

// Tally's answer to this request for this voucher, as a collection export gives it: the items (and the ledger lines
// under them) only when the request fetches ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS
func items231Answer(fixture, request string) string {
	fetch := testFetchOf(request)
	if strings.Contains(fetch, "ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.") {
		return fixture
	}
	return reItems231Inv.ReplaceAllString(fixture, "")
}

// each ledger's total in a body, and the body's sum (every ledger line: ledger entries and the items' allocations)
func items231Totals(x string) (map[string]float64, float64) {
	m, sum := map[string]float64{}, 0.0
	for _, l := range voucherLines(x) {
		a := num(amtText(l.amount))
		m[l.ledger] = round2(m[l.ledger] + a)
		sum = round2(sum + a)
	}
	return m, sum
}

func round2(v float64) float64 {
	if v < 0 {
		return -float64(int64(-v*100+0.5)) / 100
	}
	return float64(int64(v*100+0.5)) / 100
}

func items231Same(a, b map[string]float64) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}

// a bridge whose stand Tally holds the three item invoices of 02-Oct-2026 and answers both forms of the entry request
// for one of them, as a collection export does
func items231Bridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := realTallyBridge(t, "", nil)
	empty := realTally(t, "fetch-H.xml")
	fx := map[string]string{}
	for _, v := range items231Vchs {
		fx[v.mid] = items231Fixture(t, v.file)
	}
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != vchObjectID && id != vchByNumberID {
			return false
		}
		var hit []string
		for _, v := range items231Vchs {
			byMid := id == vchObjectID && strings.Contains(body, `<ID TYPE="Name">ID:`+v.mid+`</ID>`)
			byNo := id == vchByNumberID && pinQuoted(body, "$VoucherTypeName") == v.typ && strings.Contains(body, "$VoucherNumber = &#34;"+v.no+"&#34;")
			if byMid || byNo {
				hit = append(hit, items231Answer(fx[v.mid], body))
			}
		}
		if len(hit) == 0 {
			_, _ = w.Write([]byte(empty))
			return true
		}
		// one answer: the first's envelope, each voucher named in it
		a := hit[0]
		out := a[:strings.Index(a, "    <VOUCHER REMOTEID")]
		for _, h := range hit {
			out += h[strings.Index(h, "    <VOUCHER REMOTEID"):strings.Index(h, "   </COLLECTION>")]
		}
		_, _ = w.Write([]byte(out + a[strings.Index(a, "   </COLLECTION>"):]))
		return true
	}
	f.mu.Unlock()
	return p, f, c
}

// --- 1. the request: the 2.3.0 request with exactly the items' ledger lines added to its fetch; read only; one entry;
// the same filters and period; the test forms A and C still byte for byte the two forms
func TestItems231RequestAddsOnlyTheItemsLedgerLines(t *testing.T) {
	// part A (the owner's later decision of 06-Oct-2026) adds the rest of the entry (parta231_test.go)
	if liveFetchField != items231OldFetch+items231Added+partAAdded {
		t.Fatalf("the entry request's fetch is not the 2.3.0 fetch plus the items' ledger lines and part A:\n%s", liveFetchField)
	}
	// the added fields before part A: exactly three, all under the items' accounting allocations
	old := map[string]bool{}
	for _, f := range strings.Split(items231OldFetch+partAAdded, ", ") {
		old[f] = true
	}
	var added []string
	for _, f := range strings.Split(liveFetchField, ", ") {
		if !old[f] {
			added = append(added, f)
		}
	}
	sort.Strings(added)
	if strings.Join(added, " ") != "ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME" {
		t.Fatalf("added: %v", added)
	}
	// next-fastfetch: by MasterID the object export (fast234form_test.go); by number the 2.3.0 request with the fetch added
	byNumber := voucherByNumberRequest(spikeCo, "20261002", "Sales", "101")
	o := items231Old(byNumber)
	if o == byNumber || o != fcCollection(vchByNumberID, spikeCo, periodVars("20261002", "20261002"), "Voucher", items231OldFetch, `$VoucherNumber = "101" AND $VoucherTypeName = "Sales"`) {
		t.Fatalf("by number: more than the fetch changed:\n%s", o)
	}
	if !strings.Contains(byNumber, "<TALLYREQUEST>Export</TALLYREQUEST>") || strings.Count(byNumber, "<COLLECTION ") != 1 || !strings.Contains(byNumber, `ISMODIFY="No"`) || isImportRequest(byNumber) {
		t.Fatalf("by number: not a read: %s", byNumber)
	}
	if err := checkAllowed(byNumber); err != nil {
		t.Fatalf("by number refused: %v", err)
	}
	if err := checkAllowed(o); err == nil {
		t.Fatal("by number: the 2.3.0 request still passes")
	}
	if strings.Count(byNumber, "$VoucherNumber = ") != 1 || strings.Count(byNumber, "$VoucherTypeName = ") != 1 {
		t.Fatalf("not one entry: %s", byNumber)
	}
	s := allowListSamples()
	for id, sh := range map[string]string{vchByNumberID: "42ccf0c70605"} {
		if got := shapeOf(items231Old(s[id])); got != sh {
			t.Errorf("%s without the added fields has shape %s, not 2.3.0's %s", id, got, sh)
		}
	}
	// 2.3.4 (the owner, 08-Oct-2026): the trial forms A and C are removed
	if fetchTestRequest("A", spikeCo, "20261002", "Sales", "101", "") != "" || fetchTestRequest("C", spikeCo, "20261002", "", "", "11") != "" {
		t.Fatal("the trial forms A and C are still built")
	}
}

// --- 2. both forms, the stand Tally answering typed item invoices: one request per entry, and the body balances with
// the invoice's own figures (the sales or purchase ledger from under the items, the party, CGST and SGST)
func TestItems231StandItemInvoicesBalance(t *testing.T) {
	_, f, _ := items231Bridge(t)
	for _, v := range items231Vchs {
		fx := items231Fixture(t, v.file)
		// the fixture itself: the invoice's figures, summing to 0
		if m, sum := items231Totals(fx); sum != 0 || !items231Same(m, v.lines) {
			t.Fatalf("%s: the fixture's lines %v (sum %v)", v.file, m, sum)
		}
		// 2.3.0's request: the items' lines never came, so the body did not balance (what 2.3.1 fixes)
		if _, sum := items231Totals(items231Answer(fx, items231Old(voucherByNumberRequest(spikeCo, "20261002", v.typ, v.no)))); sum == 0 {
			t.Fatalf("%s: the 2.3.0 request's body balances on the stand: the stand does not tell the two apart", v.file)
		}

		// by MasterID
		n := f.n(vchObjectID)
		got, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{v.mid}, 5)
		if err != nil || len(got) != 1 || got[v.mid] == "" {
			t.Fatalf("%s by MasterID: %v %v", v.file, mapKeys(got), err)
		}
		if f.n(vchObjectID) != n+1 {
			t.Fatalf("%s by MasterID: %d requests for one entry", v.file, f.n(vchObjectID)-n)
		}
		if b := f.bodiesOf(vchObjectID); b[len(b)-1] != voucherObjectRequest(spikeCo, v.mid) {
			t.Fatalf("%s by MasterID: the request sent: %s", v.file, b[len(b)-1])
		}
		w := spikeWant
		w.typ, w.no, w.mid = v.typ, v.no, v.mid
		if why, _ := liveVoucherWrong(got[v.mid], "voucher with MasterID "+v.mid, w); why != "" {
			t.Fatalf("%s by MasterID: refused: %s", v.file, why)
		}
		if m, sum := items231Totals(got[v.mid]); sum != 0 || !items231Same(m, v.lines) {
			t.Fatalf("%s by MasterID: the body's lines %v (sum %v), want %v", v.file, m, sum, v.lines)
		}

		// by type and number
		liveNumberAsk(spikeCo, "20261002", v.typ, v.no)
		n = f.n(vchByNumberID)
		xs, err := fetchVoucherByNumber(recorderTC(nil), spikeCo, f.port, "20261002", v.typ, v.no, 5)
		if err != nil || len(xs) != 1 {
			t.Fatalf("%s by number: %d %v", v.file, len(xs), err)
		}
		if f.n(vchByNumberID) != n+1 {
			t.Fatalf("%s by number: %d requests for one entry", v.file, f.n(vchByNumberID)-n)
		}
		w.mid = ""
		if why, _ := liveVoucherWrong(xs[0], v.typ+" "+v.no, w); why != "" {
			t.Fatalf("%s by number: refused: %s", v.file, why)
		}
		if m, sum := items231Totals(xs[0]); sum != 0 || !items231Same(m, v.lines) {
			t.Fatalf("%s by number: the body's lines %v (sum %v), want %v", v.file, m, sum, v.lines)
		}
	}
	f.noBalance(t)
}

// --- 3. end to end, both forms: an add-on line for each invoice (by MasterID; a new entry with MasterID 0 by its type
// and number) goes to FinCom with Tally's body, and that body balances; one request per entry
func TestItems231LinesGoWithBalancedBodies(t *testing.T) {
	for _, byNumber := range []bool{false, true} {
		p, f, c := items231Bridge(t)
		setCfg("RecorderBodySec", float64(20)) // the turn's time for the three (the company lookup takes about 4 s on the stand)
		var ls []string
		for _, v := range items231Vchs {
			mid := v.mid
			if byNumber {
				mid = "0"
			}
			ls = append(ls, "FCR1|ev=voucher_accept_post|t0=2-Oct-26 10:55|tw=2-Oct-26 10:55|cguid="+spikeCoGUID+"|cname="+spikeCo+
				"|user=TALLY User|obj=Voucher|guid="+spikeCoGUID+"-00000000|mid="+mid+"|aid=0|vtype="+v.typ+"|vno="+v.no+"|vdate=2-Oct-26|name=|parent=|narr=|t1=2-Oct-26 10:55|src=live")
		}
		liveAppend(t, p, ls...)
		readAndUploadAll(t)
		sent := c.recSent()
		if len(sent) != 3 {
			t.Fatalf("by number %v: sent %d lines: %v", byNumber, len(sent), sent)
		}
		for _, v := range items231Vchs {
			var g M
			for _, s := range sent {
				if str(s["object_guid"]) == fmt.Sprintf("%s-%08x", spikeCoGUID, toI64(v.mid)) {
					g = s
				}
			}
			if g == nil || str(g["heldWhy"]) != "" || str(g["master_id"]) != v.mid {
				t.Fatalf("by number %v, %s: the line went as %v", byNumber, v.file, g)
			}
			if m, sum := items231Totals(str(g["xml"])); sum != 0 || !items231Same(m, v.lines) {
				t.Fatalf("by number %v, %s: the body sent: %v (sum %v)", byNumber, v.file, m, sum)
			}
		}
		if byNumber {
			if f.n(vchByNumberID) != 3 || f.n(vchObjectID) != 0 {
				t.Fatalf("asked: %v", f.ids())
			}
			for _, b := range f.bodiesOf(vchByNumberID) {
				if strings.Count(b, "$VoucherNumber = ") != 1 {
					t.Fatalf("more than one entry in a request: %s", b)
				}
			}
		} else {
			// part A (the owner, 06-Oct-2026): strictly one entry per request, by Tally's own id: three requests, one MasterID each
			bs := f.bodiesOf(vchObjectID)
			if len(bs) != 3 || f.n(vchByNumberID) != 0 {
				t.Fatalf("asked: %v", f.ids())
			}
			for _, b := range bs {
				if strings.Count(b, `<ID TYPE="Name">ID:`) != 1 {
					t.Fatalf("more than one entry in a request: %s", b)
				}
			}
		}
	}
}

// --- 3b. the item invoices the cloud held under 2.3.0 (the balance guard: "its lines do not add up") come back in the
// beat's refetch list; 2.3.1 asks its own Tally again (by MasterID; the new entry by type and number) and sends each
// "<line id>:resolved" with a body that balances
func TestItems231HeldUnder230SettleByRefetch(t *testing.T) {
	_, f, c := items231Bridge(t)
	setCfg("RecorderResolveSec", float64(0))
	row := func(id, mid string, v items231Vch) M {
		return M{"line_id": id, "company": spikeCo, "company_guid": spikeCoGUID, "event": "created", "master_id": mid, "vch_type": v.typ, "vch_no": v.no, "vch_date": "20261002"}
	}
	rows := []any{row("S1", "11", items231Vchs[0]), row("P1", "12", items231Vchs[1]), row("C1", "", items231Vchs[2])}
	applyRefetch(M{"refetch": rows})
	b230Turns(6)
	for i, id := range []string{"S1", "P1", "C1"} {
		v := items231Vchs[i]
		r := b230Resolved(c, id)
		if r == nil || str(r["object_guid"]) != fmt.Sprintf("%s-%08x", spikeCoGUID, toI64(v.mid)) {
			t.Fatalf("%s not settled: %v (%v)", id, r, f.ids())
		}
		if m, sum := items231Totals(str(r["xml"])); sum != 0 || !items231Same(m, v.lines) {
			t.Fatalf("%s: the body sent: %v (sum %v)", id, m, sum)
		}
	}
	for _, b := range append(f.bodiesOf(vchObjectID), f.bodiesOf(vchByNumberID)...) {
		if testFetchOf(b) != liveFetchField {
			t.Fatalf("a request without the 2.3.1 fetch: %s", b)
		}
	}
}

// --- 3c. review H1: an item invoice a 2.3.0 bridge already refetched (its "S1:resolved" went with 2.3.0's body, without
// the items' ledger lines, and the cloud's guard held it). FinCom lists S1 again: 2.3.1 does not take 2.3.0's sent mark as
// done, asks its own Tally once more and sends "S1:resolved" once (the same id) with a body that balances; listed again
// after that (or after a restart), nothing more is asked or sent. A line still in the held list from 2.3.0 (P1) the same
func TestItems231RefetchAfter230Resolved(t *testing.T) {
	_, f, c := items231Bridge(t)
	setCfg("RecorderResolveSec", float64(0))
	row := func(id, mid string, v items231Vch) M {
		return M{"line_id": id, "company": spikeCo, "company_guid": spikeCoGUID, "event": "created", "master_id": mid, "vch_type": v.typ, "vch_no": v.no, "vch_date": "20261002"}
	}
	// what 2.3.0 left on disk: S1:resolved and P1:resolved sent (with a body), P1 still in the held list, tried once by 2.3.0
	live.mu.Lock()
	liveFresh()
	live.sent["S1:resolved"], live.sent["P1:resolved"] = true, true
	live.mu.Unlock()
	liveSaveSent([]string{"S1:resolved", "P1:resolved"})
	heldMu.Lock()
	all, items := liveHeldLoad()
	items["P1"] = heldLine{ID: "P1", Company: spikeCo, CGUID: spikeCoGUID, Type: items231Vchs[1].typ, No: items231Vchs[1].no, Date: "20261002", MID: "12", Ev: "created",
		Added: nowFn().Add(-2 * time.Hour).Format(time.RFC3339), Last: nowFn().Add(-time.Hour).Format(time.RFC3339), Tries: 1, TriesVer: "2.3.0", Refetch: true, Cloud: true}
	liveHeldSave(all, items)
	heldMu.Unlock()
	rows := []any{row("S1", "11", items231Vchs[0]), row("P1", "12", items231Vchs[1])}
	applyRefetch(M{"refetch": rows})
	_, items = liveHeldLoad()
	for _, id := range []string{"S1", "P1"} {
		if h := items[id]; h.ID == "" || !h.Again || h.Tries != 0 {
			t.Fatalf("%s not in the held list to be asked once more: %+v", id, h)
		}
	}
	b230Turns(6)
	for i, id := range []string{"S1", "P1"} {
		v := items231Vchs[i]
		s := r222cSentID(c, id+":resolved")
		if len(s) != 1 || str(s[0]["object_guid"]) != fmt.Sprintf("%s-%08x", spikeCoGUID, toI64(v.mid)) {
			t.Fatalf("%s: sent %d times: %v (%v)", id, len(s), s, f.ids())
		}
		if m, sum := items231Totals(str(s[0]["xml"])); sum != 0 || !items231Same(m, v.lines) {
			t.Fatalf("%s: the body sent: %v (sum %v)", id, m, sum)
		}
	}
	// once: listed again (the cloud's answer not in yet), and again after a restart (the state read from disk)
	k := f.n(vchObjectID) + f.n(vchByNumberID)
	for _, restart := range []bool{false, true} {
		if restart {
			live.mu.Lock()
			live.dir = ""
			live.mu.Unlock()
		}
		applyRefetch(M{"refetch": rows})
		b230Turns(3)
		if f.n(vchObjectID)+f.n(vchByNumberID) != k || len(r222cSentID(c, "S1:resolved")) != 1 || len(r222cSentID(c, "P1:resolved")) != 1 {
			t.Fatalf("restart %v: asked or sent again: %d -> %d asks; %v", restart, k, f.n(vchObjectID)+f.n(vchByNumberID), f.ids())
		}
	}
	// a line no older bridge resolved, which this version resolved: never asked again (the rule before 2.3.1)
	if _, items = liveHeldLoad(); items["S1"].ID != "" || items["P1"].ID != "" {
		t.Fatalf("still in the held list: %+v %+v", items["S1"], items["P1"])
	}
}

// --- 4. the 2-second rule holds for the new request: a Tally slow to answer it is left at 2 s
func TestItems231TwoSecondRule(t *testing.T) {
	_, f, _ := items231Bridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID || id == vchByNumberID {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	_, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{"11"}, 20)
	if el := time.Since(t0); err == nil || el > 3500*time.Millisecond {
		t.Fatalf("the request was not stopped at 2 s: %v after %s", err, el)
	}
}

// --- 5. the version and the allow-list's decision line for 2.3.1
func TestItems231VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.3.4" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	// review M1: what the two requests ask, as built (part A: one entry each, by Tally's own id or by type and number), and
	// the stand named as not real Tally; review M2: the four other trial forms unchanged, so "no other row changed" holds
	for _, s := range []string{"re-measured on 2026-10-06 on the stand (not real Tally)", "not yet measured on NWS144",
		// part A (the owner's decisions of 06-Oct-2026): the whole entry, strictly one entry per request
		"as for 2.3.1: the owner's decision of 2026-10-06: FinComVoucherByMaster and FinComVoucherByNumber fetch the whole entry: the ledger lines kept under an invoice's items (ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS); the items",
		"one entry per request, by Tally's own id (FinComVoucherByMaster) or by type and number (FinComVoucherByNumber); read only, within the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only",
		"TDSDeskCompanies, when asked in the background (the recorder's own-Tally look, the light check), stops hard at 2 seconds too",
		"FinComFetchTestB, D, E and F stay byte for byte as in 2.3.0; no other row changed",
		"as for 2.3.0: the owner's standing decision of 2026-10-06",
		// the owner's approval (06-Oct-2026, after review L1): the two trial forms that copy the entry request
		"the trial forms FinComFetchTestA and FinComFetchTestC, approved by the owner: tray only, started by the owner, read only, and copy the 2.3.1 entry request exactly"} {
		if !strings.Contains(line, s) {
			t.Errorf("the decision line does not say %q", s)
		}
	}
	if regexp.MustCompile(`allowed for 2\.3\.0`).MatchString(al) {
		t.Error("the 2.3.0 line is still an exception line (release-check accepts one version only)")
	}
	for _, f := range []string{"../docs/bridge-2.3.1-test-sheet.txt", "../docs/bridge-2.3.1-notes.md"} {
		s := strings.Join(strings.Fields(readText(f)), " ")
		// part A (the owner's decisions of 06-Oct-2026): the whole entry, the accuracy checks, one entry per request, 57; with parts B and C and the owner's rename decision: 56, 57, 58, 59 and 60
		for _, w := range []string{"2.3.1", "two items", "CGST", "SGST", "Purchase", "Credit Note", "HSN", "IRN", "e-way bill", "UTR",
			"cost centre", "TDS", "accuracy checks", "nothing of", "One entry per request", "migrations 56, 57, 58, 59 and 60"} {
			if !strings.Contains(s, w) {
				t.Errorf("%s does not say %q", f, w)
			}
		}
	}
}
