package main

// Bridge 2.3.1 part A (the owner's decisions of 06-Oct-2026): "Item invoices enter complete" — the entry request
// (FinComVoucherByMaster, FinComVoucherByNumber) also fetches the items (name, quantity and unit, rate, taxable value,
// HSN or SAC and the GST rate Tally applied to that line), the ledger lines' bill-wise details, cost centre allocations
// (on ledger lines and on the ledger lines under items), bank details, TDS details, narration, reference number and
// date, the e-invoice IRN and acknowledgement, the e-way bill number, and the party GSTIN, place of supply and company
// GSTIN plus the ledger lines' GST fields the Day Book path reads (so the live route no longer blanks them).
// "One entry per request: strictly one, asked for by Tally's own id": FinComVoucherByMaster names exactly ONE MasterID.
// Read only, inside the 2-second rule, after postings, nothing else added. Also: the company-list request
// TDSDeskCompanies, sent in the background (the recorder's own-Tally look, the light check), stops hard at 2 s.
//
// The fixtures testdata/typed-like-7.1/partA-*.xml are typed as the real TallyPrime 7.1 answers in real-tally-7.1 (TYPE
// attributes, padded numbers, CMPINFO counters, Tally's own extra fields); they are NOT captured from a real Tally: the
// tag names of the items, the e-invoice, the e-way bill, the bank and the TDS details follow TallyPrime's XML as
// documented and as FinCom's own postings use them (tests/fixtures/post-shapes/bank-batch.xml). The stand Tally here
// answers as a collection export does: only the fields the request fetches come back (partAAnswer), so a field the cloud
// reads but the request does not fetch would be missing from the body.
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

// what part A adds to the 2.3.1 fetch (liveFetchField222 + items231Added), and only this
const partAAdded = ", REFERENCE, REFERENCEDATE, PARTYGSTIN, PLACEOFSUPPLY, CMPGSTIN, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, " +
	"ALLLEDGERENTRIES.GSTHSNNAME, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, " +
	"ALLLEDGERENTRIES.RATEDETAILS.GSTRATE, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY, " +
	"ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, " +
	"ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER, " +
	"ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, " +
	"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY, " +
	"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE, " +
	"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX, " +
	"ALLINVENTORYENTRIES.STOCKITEMNAME, ALLINVENTORYENTRIES.BILLEDQTY, ALLINVENTORYENTRIES.RATE, ALLINVENTORYENTRIES.AMOUNT, " +
	"ALLINVENTORYENTRIES.GSTHSNNAME, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, " +
	"ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY, " +
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, " +
	"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT"

// the 2.3.1 fetch before part A (the items' ledger lines only)
const partABefore = liveFetchField222 + items231Added

type partAVch struct {
	file, mid, typ, no string
	want               []string // values the body must carry (each as Tally writes it)
}

var partAVchs = []partAVch{
	{"partA-sales-two-rates.xml", "21", "Sales", "201", []string{"<STOCKITEMNAME TYPE=\"String\">Widget A</STOCKITEMNAME>", "<STOCKITEMNAME TYPE=\"String\">Rice B</STOCKITEMNAME>",
		"<BILLEDQTY TYPE=\"Quantity\"> 20 Kg</BILLEDQTY>", "<RATE TYPE=\"Rate\">50.00/Kg</RATE>", "<GSTHSNNAME TYPE=\"String\">1006</GSTHSNNAME>",
		"<GSTRATE TYPE=\"Number\"> 2.5</GSTRATE>", "<IRNACKNO TYPE=\"String\">112610020345678</IRNACKNO>", "<BILLNUMBER TYPE=\"String\">381001234567</BILLNUMBER>",
		"<PARTYGSTIN TYPE=\"String\">07AAJFQ3158R1ZH</PARTYGSTIN>", "<CMPGSTIN TYPE=\"String\">07AAGCL4827M1Z3</CMPGSTIN>", "<PLACEOFSUPPLY TYPE=\"String\">Delhi</PLACEOFSUPPLY>",
		"<NAME TYPE=\"String\">Retail</NAME>", "<REFERENCE TYPE=\"String\">PO-88</REFERENCE>", "30 Days</BILLCREDITPERIOD>"}},
	{"partA-purchase-igst.xml", "22", "Purchase", "77", []string{"<REFERENCEDATE TYPE=\"Date\">20261001</REFERENCEDATE>", "15-Nov-2026</BILLCREDITPERIOD>",
		"<LEDGERNAME TYPE=\"String\">IGST Input</LEDGERNAME>", "<AMOUNT TYPE=\"Amount\">-5000.00</AMOUNT>"}},
	{"partA-credit-note-items.xml", "23", "Credit Note", "8", []string{"<BILLTYPE TYPE=\"String\">Agst Ref</BILLTYPE>", "<BILLEDQTY TYPE=\"Quantity\"> 1 Nos</BILLEDQTY>"}},
	{"partA-receipt-against-bill.xml", "24", "Receipt", "31", []string{"<INSTRUMENTNUMBER TYPE=\"String\">000451</INSTRUMENTNUMBER>",
		"<BANKERSDATE TYPE=\"Date\">20261003</BANKERSDATE>", "<TRANSACTIONTYPE TYPE=\"String\">Cheque</TRANSACTIONTYPE>"}},
	{"partA-payment-tds.xml", "25", "Payment", "12", []string{"<CATEGORY TYPE=\"String\">Payment to Contractors</CATEGORY>", "<TAXRATE TYPE=\"Number\"> 2</TAXRATE>",
		"<ASSESSABLEAMOUNT TYPE=\"Amount\">100000.00</ASSESSABLEAMOUNT>", "<PARTYLEDGER TYPE=\"String\">Spike Contractor</PARTYLEDGER>", "UTR26100200991"}},
	{"partA-journal-cost-centres.xml", "26", "Journal", "5", []string{"<NAME TYPE=\"String\">Head Office</NAME>", "<AMOUNT TYPE=\"Amount\">-10000.00</AMOUNT>"}},
	{"partA-bank-payment-utr.xml", "27", "Payment", "13", []string{"<INSTRUMENTNUMBER TYPE=\"String\">SBIN526275123456</INSTRUMENTNUMBER>",
		"<TRANSACTIONTYPE TYPE=\"String\">e-Fund Transfer</TRANSACTIONTYPE>", "<INSTRUMENTDATE TYPE=\"Date\">20261002</INSTRUMENTDATE>"}},
}

// --- the stand's collection export: the voucher with only the fields the request fetches (its attributes kept); a
// sub-list comes back only when one of its fields is fetched
type paNode struct {
	name, open, text string
	kids             []*paNode
	leaf             bool
}

var rePaTok = regexp.MustCompile(`<(/?)([A-Za-z0-9.:_]+)([^>]*?)(/?)>([^<]*)`)

func paParse(x string) *paNode {
	root := &paNode{}
	stack := []*paNode{root}
	for _, m := range rePaTok.FindAllStringSubmatch(x, -1) {
		top := stack[len(stack)-1]
		switch {
		case m[1] == "/":
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case m[4] == "/":
			top.kids = append(top.kids, &paNode{name: m[2], open: "<" + m[2] + m[3] + "/>", leaf: true})
		default:
			n := &paNode{name: m[2], open: "<" + m[2] + m[3] + ">", text: m[5]}
			top.kids = append(top.kids, n)
			stack = append(stack, n)
		}
	}
	var mark func(n *paNode)
	mark = func(n *paNode) {
		if len(n.kids) == 0 && !strings.HasSuffix(n.name, ".LIST") {
			n.leaf = true
		}
		for _, k := range n.kids {
			mark(k)
		}
	}
	mark(root)
	return root
}

func partAFilter(voucher, fetch string) string {
	want := map[string]bool{}
	for _, f := range strings.Split(fetch, ", ") {
		want[f] = true
	}
	root := paParse(voucher)
	if len(root.kids) != 1 {
		return ""
	}
	var emit func(n *paNode, path string) string
	emit = func(n *paNode, path string) string {
		p := strings.TrimSuffix(n.name, ".LIST")
		if path != "" {
			p = path + "." + p
		}
		if n.leaf {
			if !want[p] {
				return ""
			}
			if strings.HasSuffix(n.open, "/>") {
				return n.open
			}
			return n.open + n.text + "</" + n.name + ">"
		}
		var b strings.Builder
		for _, k := range n.kids {
			b.WriteString(emit(k, p))
		}
		if b.Len() == 0 {
			return ""
		}
		return n.open + b.String() + "</" + n.name + ">"
	}
	v := root.kids[0]
	var b strings.Builder
	for _, k := range v.kids {
		b.WriteString(emit(k, ""))
	}
	return v.open + b.String() + "</VOUCHER>"
}

// Tally's answer to this request for this fixture: the envelope with the voucher as the request's fetch gives it
func partAAnswer(fixture, request string) string {
	fetch := group(`<FETCH>([^<]*)</FETCH>`, request, 1)
	a, z := strings.Index(fixture, "    <VOUCHER REMOTEID"), strings.Index(fixture, "   </COLLECTION>")
	return fixture[:a] + partAFilter(fixture[a:z], fetch) + "\n" + fixture[z:]
}

func partABridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := realTallyBridge(t, "", nil)
	empty := realTally(t, "fetch-H.xml")
	fx := map[string]string{}
	for _, v := range partAVchs {
		fx[v.mid] = items231Fixture(t, v.file)
	}
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != vchByMasterID && id != vchByNumberID {
			return false
		}
		var hit []string
		for _, v := range partAVchs {
			byMid := id == vchByMasterID && regexp.MustCompile(`\$MasterID = `+v.mid+`\b`).MatchString(body)
			byNo := id == vchByNumberID && pinQuoted(body, "$VoucherTypeName") == v.typ && strings.Contains(body, "$VoucherNumber = &#34;"+v.no+"&#34;")
			if byMid || byNo {
				hit = append(hit, partAAnswer(fx[v.mid], body))
			}
		}
		if len(hit) == 0 {
			_, _ = w.Write([]byte(empty))
			return true
		}
		a := hit[0]
		out := a[:strings.Index(a, "<VOUCHER REMOTEID")]
		for _, h := range hit {
			out += h[strings.Index(h, "<VOUCHER REMOTEID"):strings.Index(h, "   </COLLECTION>")]
		}
		_, _ = w.Write([]byte(out + a[strings.Index(a, "   </COLLECTION>"):]))
		return true
	}
	f.mu.Unlock()
	return p, f, c
}

// --- 1. the fetch: exactly the 2.3.1 fetch plus the part A fields; each a stored field of the voucher (nothing Tally
// works out); the request otherwise as before; A and C byte for byte the two requests; B, D, E, F as in 2.3.0
func TestPartAFetchExactly(t *testing.T) {
	if liveFetchField != partABefore+partAAdded {
		t.Fatalf("the entry request's fetch is not the 2.3.1 fetch plus part A's fields:\n%s", liveFetchField)
	}
	seen := map[string]bool{}
	for _, f := range strings.Split(liveFetchField, ", ") {
		if seen[f] {
			t.Errorf("fetched twice: %s", f)
		}
		seen[f] = true
		if !regexp.MustCompile(`^[A-Z]+(\.[A-Z]+)*$`).MatchString(f) || strings.Contains(f, "$") || strings.Contains(f, "CLOSING") || strings.Contains(f, "OPENING") {
			t.Errorf("not a plain stored field: %q", f)
		}
	}
	if n := len(strings.Split(partAAdded, ", ")) - 1; n != 37 {
		t.Errorf("part A adds %d fields, want 37", n)
	}
	byMaster := voucherByMasterRequest(spikeCo, "20261002", []string{"21"})
	byNumber := voucherByNumberRequest(spikeCo, "20261002", "Sales", "201")
	for name, x := range map[string]string{"by MasterID": byMaster, "by number": byNumber} {
		id, filter := vchByMasterID, "$MasterID = 21"
		if name == "by number" {
			id, filter = vchByNumberID, `$VoucherNumber = "201" AND $VoucherTypeName = "Sales"`
		}
		// the request diff: only the fetch moved
		if strings.Replace(x, "<FETCH>"+liveFetchField+"</FETCH>", "<FETCH>"+partABefore+"</FETCH>", 1) != fcCollection(id, spikeCo, periodVars("20261002", "20261002"), "Voucher", partABefore, filter) {
			t.Fatalf("%s: more than the fetch changed:\n%s", name, x)
		}
		if !strings.Contains(x, "<TALLYREQUEST>Export</TALLYREQUEST>") || strings.Count(x, "<COLLECTION ") != 1 || !strings.Contains(x, `ISMODIFY="No"`) || isImportRequest(x) {
			t.Fatalf("%s: not a read: %s", name, x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("%s refused: %v", name, err)
		}
	}
	if strings.ReplaceAll(fetchTestRequest("A", spikeCo, "20261002", "Sales", "201", ""), fetchTestA, vchByNumberID) != byNumber ||
		strings.ReplaceAll(fetchTestRequest("C", spikeCo, "20261002", "", "", "21"), fetchTestC, vchByMasterID) != byMaster {
		t.Fatal("the test forms A and C are no longer the two requests as built")
	}
	for _, l := range []string{"B", "D", "E", "F"} {
		if x := fetchTestRequest(l, spikeCo, "20261002", "Sales", "201", "21"); !strings.Contains(x, "<FETCH>"+liveFetchField222+"</FETCH>") {
			t.Errorf("trial form %s does not keep the 2.3.0 fetch", l)
		}
	}
}

// --- 2. strictly one entry per request by Tally's own id: FinComVoucherByMaster names exactly one MasterID
func TestPartAOneMasterIDPerRequest(t *testing.T) {
	if liveMaxIDs != 1 {
		t.Fatalf("liveMaxIDs %d", liveMaxIDs)
	}
	if x := voucherByMasterRequest(spikeCo, "20261002", []string{"21", "22"}); x != "" {
		t.Fatalf("two MasterIDs built a request: %s", x)
	}
	if x := voucherByMasterRequest(spikeCo, "20261002", nil); x != "" {
		t.Fatalf("no MasterID built a request: %s", x)
	}
	_, f, _ := partABridge(t) // its starting point recorded
	two := fcCollection(vchByMasterID, spikeCo, periodVars("20261002", "20261002"), "Voucher", liveFetchField, "$MasterID = 21 OR $MasterID = 22")
	if voucherByMasterExact(two) || checkAllowed(two) == nil {
		t.Fatal("a request naming two MasterIDs passes")
	}
	if !voucherByMasterExact(voucherByMasterRequest(spikeCo, "20261002", []string{"21"})) {
		t.Fatal("the one-MasterID request does not pass")
	}
	if s := allowListSamples()[vchByMasterID]; strings.Count(s, "$MasterID = ") != 1 {
		t.Fatalf("the allow-list sample names %d MasterIDs", strings.Count(s, "$MasterID = "))
	}
	n := tallySent.Load()
	if _, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{"21", "22"}, 5); err == nil {
		t.Fatal("two MasterIDs were asked")
	}
	if tallySent.Load() != n || f.n(vchByMasterID) != 0 {
		t.Fatal("a request went for two MasterIDs")
	}
}

// --- 3. both forms on the stand: each scenario the owner named comes back with every field the cloud reads, one
// request per entry, and its lines add up
func TestPartAStandBothForms(t *testing.T) {
	_, f, _ := partABridge(t)
	for _, v := range partAVchs {
		fx := items231Fixture(t, v.file)
		if _, sum := items231Totals(fx); sum != 0 {
			t.Fatalf("%s: the fixture's lines sum to %v", v.file, sum)
		}
		// the 2.3.1 fetch before part A drops what the owner asked for
		old := partAAnswer(fx, fcCollection(vchByMasterID, spikeCo, "", "Voucher", partABefore, ""))
		lost := 0
		for _, w := range v.want {
			if !strings.Contains(old, w) {
				lost++
			}
		}
		if lost == 0 {
			t.Fatalf("%s: the stand does not tell the fetches apart", v.file)
		}
		check := func(how, x string) {
			if _, sum := items231Totals(x); sum != 0 {
				t.Fatalf("%s %s: the body's lines sum to %v", v.file, how, sum)
			}
			for _, w := range v.want {
				if !strings.Contains(x, w) {
					t.Errorf("%s %s: the body lacks %s", v.file, how, w)
				}
			}
		}
		n := f.n(vchByMasterID)
		got, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{v.mid}, 5)
		if err != nil || got[v.mid] == "" || f.n(vchByMasterID) != n+1 {
			t.Fatalf("%s by MasterID: %v %v (%d requests)", v.file, mapKeys(got), err, f.n(vchByMasterID)-n)
		}
		w := spikeWant
		w.typ, w.no, w.mid = v.typ, v.no, v.mid
		if why, _ := liveVoucherWrong(got[v.mid], "voucher with MasterID "+v.mid, w); why != "" {
			t.Fatalf("%s by MasterID refused: %s", v.file, why)
		}
		check("by MasterID", got[v.mid])
		liveNumberAsk(spikeCo, "20261002", v.typ, v.no)
		n = f.n(vchByNumberID)
		xs, err := fetchVoucherByNumber(recorderTC(nil), spikeCo, f.port, "20261002", v.typ, v.no, 5)
		if err != nil || len(xs) != 1 || f.n(vchByNumberID) != n+1 {
			t.Fatalf("%s by number: %d %v", v.file, len(xs), err)
		}
		check("by number", xs[0])
	}
	f.noBalance(t)
}

// --- 4. end to end: seven add-on lines of one day go one request each (by MasterID: exactly one MasterID in each; a
// new entry by its type and number), each with its whole body
func TestPartALinesOneRequestEach(t *testing.T) {
	for _, byNumber := range []bool{false, true} {
		p, f, c := partABridge(t)
		setCfg("RecorderBodySec", float64(20))
		var ls []string
		for _, v := range partAVchs {
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
		if len(sent) != len(partAVchs) {
			t.Fatalf("by number %v: sent %d lines", byNumber, len(sent))
		}
		for _, v := range partAVchs {
			var g M
			for _, s := range sent {
				if str(s["object_guid"]) == fmt.Sprintf("%s-%08x", spikeCoGUID, toI64(v.mid)) {
					g = s
				}
			}
			if g == nil || str(g["heldWhy"]) != "" {
				t.Fatalf("by number %v, %s: went as %v", byNumber, v.file, g)
			}
			for _, w := range v.want {
				if !strings.Contains(str(g["xml"]), w) {
					t.Errorf("by number %v, %s: the body sent lacks %s", byNumber, v.file, w)
				}
			}
		}
		id := vchByMasterID
		if byNumber {
			id = vchByNumberID
		}
		bs := f.bodiesOf(id)
		if len(bs) != len(partAVchs) {
			t.Fatalf("by number %v: %d requests for %d entries (%v)", byNumber, len(bs), len(partAVchs), f.ids())
		}
		var mids []string
		for _, b := range bs {
			if byNumber && strings.Count(b, "$VoucherNumber = ") != 1 || !byNumber && strings.Count(b, "$MasterID = ") != 1 {
				t.Fatalf("more than one entry in a request: %s", b)
			}
			mids = append(mids, group(`\$MasterID = (\d+)`, b, 1))
		}
		sort.Strings(mids)
		if !byNumber && strings.Join(mids, ",") != "21,22,23,24,25,26,27" {
			t.Fatalf("asked: %v", mids)
		}
	}
}

// --- 4b. one entry a request: when the turn's time (RecorderBodySec) is used, the entries not asked yet wait for the next
// turn, in order; none is sent without its body for want of time, each is asked once
func TestPartATurnTimeUsedNextTurn(t *testing.T) {
	p, f, c := partABridge(t)
	setCfg("RecorderBodySec", float64(1)) // less than the first request takes on the stand: one entry a turn
	var ls []string
	for _, v := range partAVchs {
		ls = append(ls, "FCR1|ev=voucher_accept_post|t0=2-Oct-26 10:55|tw=2-Oct-26 10:55|cguid="+spikeCoGUID+"|cname="+spikeCo+
			"|user=TALLY User|obj=Voucher|guid="+spikeCoGUID+"-00000000|mid="+v.mid+"|aid=0|vtype="+v.typ+"|vno="+v.no+"|vdate=2-Oct-26|name=|parent=|narr=|t1=2-Oct-26 10:55|src=live")
	}
	liveAppend(t, p, ls...)
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != len(partAVchs) {
		t.Fatalf("sent %d lines of %d", len(sent), len(partAVchs))
	}
	for i, s := range sent {
		if str(s["heldWhy"]) != "" || str(s["xml"]) == "" || str(s["master_id"]) != partAVchs[i].mid {
			t.Fatalf("line %d went as %v", i, s)
		}
	}
	if n := f.n(vchByMasterID); n != len(partAVchs) {
		t.Fatalf("%d requests for %d entries: %v", n, len(partAVchs), f.ids())
	}
	if logLines("this turn's 1 s are used (one entry a request); asked in the next turn") == 0 {
		t.Fatal("the log does not say why the rest wait")
	}
}

// --- 5. the 2-second rule for the part A request (a Tally slow to answer it is left at 2 s)
func TestPartATwoSecondRule(t *testing.T) {
	_, f, _ := partABridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchByMasterID {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	if _, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{"21"}, 20); err == nil || time.Since(t0) > 3500*time.Millisecond {
		t.Fatalf("not stopped at 2 s: %v after %s", err, time.Since(t0))
	}
}

// --- 6. the company list asked in the background (the recorder's own-Tally look, the light check) stops hard at 2 s;
// asked by the reader only when a line waits for it; a person's look (Update now, the tray) is not cut
func TestPartACompanyListTwoSecondStop(t *testing.T) {
	if tc := bgCompaniesTC(); tc.limitMs != keepNum("RecorderLimitMs", 2000) || !tc.light || !tc.copier || tc.yield == nil {
		t.Fatalf("the background company list's TC: %+v", tc)
	}
	_, f, _ := partABridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	// no line waits: the reader asks nothing
	live.mu.Lock()
	live.ownWant = false
	live.mu.Unlock()
	n := f.n("TDSDeskCompanies")
	if liveOwnAskNow() || f.n("TDSDeskCompanies") != n {
		t.Fatal("the own-Tally look went with no line waiting for it")
	}
	// a line waits: one look, stopped at 2 s, telling nothing (an incomplete look is not used)
	live.mu.Lock()
	live.ownWant, live.ownAskAt = true, time.Time{}
	at := live.ownAt
	live.mu.Unlock()
	t0 := time.Now()
	if !liveOwnAskNow() {
		t.Fatal("no look for the waiting line")
	}
	if el := time.Since(t0); el > 3500*time.Millisecond {
		t.Fatalf("the own-Tally look was not stopped at 2 s: %s", el)
	}
	live.mu.Lock()
	moved := !live.ownAt.Equal(at)
	live.mu.Unlock()
	if moved {
		t.Fatal("a look stopped at 2 s was taken as a complete look")
	}
	// the light check's list: stopped at 2 s too
	t0 = time.Now()
	_, _ = openCompaniesAsk(bgCompaniesTC(), true)
	if el := time.Since(t0); el > 3500*time.Millisecond {
		t.Fatalf("the light check's company list was not stopped at 2 s: %s", el)
	}
	for _, src := range []string{readText("recorder_owntally.go"), readText("startpoint.go")} {
		if strings.Contains(src, "openCompaniesAsk(&TC{") {
			t.Fatal("a background company list is asked without the 2 s stop")
		}
	}
}
