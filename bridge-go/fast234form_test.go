package main

// next-fastfetch (the owner's decision of 08-Oct-2026, "Allow, strip in bridge"): the entry request is the object export
// "ID:<MasterID>" (one voucher, read only, keyed: 7-57 ms at every company size on 3.0 .. 7.1, run 37657679690), its
// FETCHLIST the approved fields (Tally ignores it and sends the whole voucher). The bridge keeps EXACTLY the approved
// fields of FinComVoucherByMaster (liveFetchFields: all approved, the last 13 on 08-Oct-2026) and turns
// LEDGERENTRIES.LIST into ALLLEDGERENTRIES.LIST; everything else is dropped before anything is logged, stored or sent.
// FinComVoucherByMaster is gone (no fallback). The object export with NO FETCHLIST and the TDL report over the voucher
// object froze Tally on every release: refused before anything is sent. Written before the code (red first).

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// --- the request, byte for byte
func TestFast234RequestShape(t *testing.T) {
	var fl strings.Builder
	for _, f := range liveFetchFields() {
		fl.WriteString("<FETCH>" + f + "</FETCH>")
	}
	want := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE>` +
		`<ID TYPE="Name">ID:4002</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
		`<SVCURRENTCOMPANY>ZZ &amp; Co</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST>` + fl.String() + `</FETCHLIST></DESC></BODY></ENVELOPE>`
	if got := voucherObjectRequest("ZZ & Co", "4002"); got != want {
		t.Fatalf("the request:\n got %s\nwant %s", got, want)
	}
	if len(liveFetchFields()) != 61 {
		t.Fatalf("%d fields (today's request fetches 61)", len(liveFetchFields()))
	}
	// one MasterID, a number: nothing else can be built
	for _, mid := range []string{"", "0", "12a", "1 2", "1234567890123456789", "-5"} {
		if x := voucherObjectRequest("ZZ", mid); x != "" {
			t.Fatalf("built for MasterID %q: %s", mid, x)
		}
	}
	if tallyRequestID(voucherObjectRequest("ZZ", "7")) != vchObjectID {
		t.Fatalf("its id: %q", tallyRequestID(voucherObjectRequest("ZZ", "7")))
	}
}

// --- the 13 fields the owner approved on 08-Oct-2026: in the request and kept by the strip; the request's bytes unchanged
func TestFast234ApprovedFields0810(t *testing.T) {
	want := []string{"PARTYGSTIN", "PLACEOFSUPPLY", "CMPGSTIN", "IRNACKDATE", "ALLLEDGERENTRIES.GSTHSNNAME",
		"ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATE",
		"ALLLEDGERENTRIES.BANKALLOCATIONS.DATE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER",
		"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT", "ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE"}
	if strings.Join(liveFetchApproved0810, ",") != strings.Join(want, ",") {
		t.Fatalf("the fields approved on 08-Oct: %v", liveFetchApproved0810)
	}
	ok := fastApprovedPaths()
	x := voucherObjectRequest("ZZ", "1")
	for _, f := range append(want, "ALLLEDGERENTRIES.BANKALLOCATIONS.NAME") { // and BANKALLOCATIONS.NAME, approved 07-Oct
		if !ok[f] || !strings.Contains(x, "<FETCH>"+f+"</FETCH>") {
			t.Fatalf("%s not in the request or not kept by the strip", f)
		}
	}
	if s := fastStripVoucher(`<VOUCHER REMOTEID="g-1" VCHTYPE="Sales"><GUID>g-1</GUID><PARTYGSTIN>07AAA</PARTYGSTIN></VOUCHER>`); !strings.Contains(s, "<PARTYGSTIN>07AAA</PARTYGSTIN>") {
		t.Fatalf("the strip dropped PARTYGSTIN: %s", s)
	}
	// the request's bytes are the ones measured and proven on real Tally (push-design 37718386662, tally-real 37723589664)
	if shapeOf(voucherObjectRequest("SAMPLE CO", "1")) != shapeOf(allowListSamples()[vchObjectID]) || shapeOf(allowListSamples()[vchObjectID]) != "ce0e72f74e72" {
		t.Fatalf("the request's shape moved: %s", shapeOf(allowListSamples()[vchObjectID]))
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	if !strings.Contains(al, `"13 fields: all approved. They are read only, inside requests already made, and needed for GST, TDS and bank accuracy."`) ||
		!strings.Contains(al, "ALLLEDGERENTRIES.BANKALLOCATIONS.NAME approved") || strings.Contains(al, "and the ledger lines' GST fields the Day Book path reads; one entry") {
		t.Fatal("docs/tally-allowlist.md: the 08-Oct approval is not quoted, or the 2.3.1 line still credits the owner with the 13 fields")
	}
}

// --- the two forms that froze Tally on every release are never sent; nor anything but the request exactly as built
func TestFast234RefusesFormsThatFreezeTally(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	noFetchList := regexp.MustCompile(`<FETCHLIST>.*</FETCHLIST>`).ReplaceAllString(voucherObjectRequest("ZZ TEST", "5"), "")
	reportOnObject := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>FCPRpt</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>ZZ TEST</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><REPORT NAME="FCPRpt"><FORMS>FCPRpt</FORMS></REPORT><FORM NAME="FCPRpt"><TOPPARTS>FCPRpt</TOPPARTS><XMLTAG>"FCPVCH"</XMLTAG></FORM><PART NAME="FCPRpt"><TOPLINES>FCPRpt</TOPLINES><OBJECT>Voucher : &quot;ID:5&quot;</OBJECT></PART><LINE NAME="FCPRpt"><LEFTFIELDS>FCPMid</LEFTFIELDS></LINE><FIELD NAME="FCPMid"><SET>$MasterID</SET><XMLTAG>"MASTERID"</XMLTAG></FIELD></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
	oneField := strings.Replace(voucherObjectRequest("ZZ TEST", "5"), "<FETCHLIST><FETCH>GUID</FETCH>", "<FETCHLIST><FETCH>NAME</FETCH><FETCH>GUID</FETCH>", 1)
	twoIds := strings.Replace(voucherObjectRequest("ZZ TEST", "5"), "ID:5", "ID:5,6", 1)
	other := strings.Replace(voucherObjectRequest("ZZ TEST", "5"), "<SUBTYPE>Voucher</SUBTYPE>", "<SUBTYPE>Ledger</SUBTYPE>", 1)
	for name, x := range map[string]string{"no FETCHLIST": noFetchList, "report on the voucher object": reportOnObject, "a field more": oneField, "two ids": twoIds, "another object type": other} {
		if err := checkAllowed(x); err == nil {
			t.Fatalf("%s: allowed", name)
		}
		n := len(f.ids())
		if _, err := invokeTally(recorderTC(nil), f.port, x, 5); err == nil {
			t.Fatalf("%s: sent", name)
		}
		if len(f.ids()) != n {
			t.Fatalf("%s: reached Tally: %v", name, f.ids())
		}
	}
	if !strings.Contains(fastNeverForms, "no FETCHLIST") || !strings.Contains(fastNeverForms, "report") {
		t.Fatal("the reason is not written beside the guard")
	}
}

// --- FinComVoucherByMaster is gone: no builder, no id, no allow-list row; the bridge's code never builds a voucher
// collection filtered by MasterID
func TestFast234NoOldRequest(t *testing.T) {
	fs, _ := filepath.Glob("*.go")
	for _, f := range fs {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		b := readText(f)
		for _, bad := range []string{`"FinComVoucherByMaster"`, "voucherByMasterRequest(", "voucherByMasterExact("} {
			if strings.Contains(b, bad) {
				t.Errorf("%s still has %s", f, bad)
			}
		}
	}
	if _, ok := tallyAllowList["FinComVoucherByMaster"]; ok {
		t.Error("FinComVoucherByMaster is still on the allow-list")
	}
	doc := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	if strings.Contains(doc, "| FinComVoucherByMaster |") || !strings.Contains(doc, "| "+vchObjectID+" |") {
		t.Error("docs/tally-allowlist.md: the old row is there or the new one is not")
	}
	// the entry fetch, the held resolver, the cancel / delete check and the posting check all ask by the new request
	f := newStandTally(t)
	standBridge(t, f, "")
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: "co-guid-1-00000005", master: "5", date: "20261001", typ: "Receipt", no: "1", narr: "x", party: "Customer A", alter: 9,
		lines: [][2]string{{"Customer A", "10.00"}, {"Bank", "-10.00"}}})
	f.mu.Unlock()
	noteStartPoint(zz, "co-guid-1", 1, 1)
	got, err := fetchVouchersByMasterIn(recorderTC(nil), zz, f.port, "20261001", []string{"5"}, 5)
	if err != nil || got["5"] == "" {
		t.Fatalf("the fetch: %v %v", got, err)
	}
	if ids := f.ids(); len(ids) == 0 || ids[len(ids)-1] != vchObjectID || !strings.Contains(f.bodiesOf(vchObjectID)[0], `<ID TYPE="Name">ID:5</ID>`) {
		t.Fatalf("asked by: %v", ids)
	}
}

// --- the strip on Tally's real answers (run 37657679690, five releases): only approved fields, the ledger lines as
// ALLLEDGERENTRIES.LIST; the result kept beside the captures for parse.js's comparison (tests/run_parse_fast234.mjs), run
// here when node is on this computer
func TestFast234StripCaptures(t *testing.T) {
	ok := fastApprovedPaths()
	rels, _ := filepath.Glob(filepath.Join("testdata", "fast234", "*.*"))
	n := 0
	for _, d := range rels {
		if fi, err := os.Stat(d); err != nil || !fi.IsDir() {
			continue
		}
		for _, tgt := range []string{"sales", "receipt"} {
			raw := readText(filepath.Join(d, tgt+"-objfl.xml"))
			vs := reVchBlock.FindAllString(raw, -1)
			if len(vs) != 1 {
				t.Fatalf("%s %s: %d vouchers in Tally's answer", d, tgt, len(vs))
			}
			s := fastStripVoucher(cleanXML(vs[0]))
			for _, p := range fastLeafPaths(s) {
				if !fastPathOK(ok, p) {
					t.Errorf("%s %s: %s kept (not an approved field)", d, tgt, p)
				}
			}
			if strings.Contains(s, "<LEDGERENTRIES.LIST") || strings.Contains(s, "UDF:") || len(s)*3 > len(vs[0]) {
				t.Errorf("%s %s: not stripped (%d of %d bytes)", d, tgt, len(s), len(vs[0]))
			}
			if !strings.Contains(s, "<ALLLEDGERENTRIES.LIST>") || !strings.HasPrefix(s, `<VOUCHER VCHTYPE="`) {
				t.Errorf("%s %s: shape: %.200s", d, tgt, s)
			}
			out := filepath.Join(d, tgt+"-stripped.xml")
			if os.Getenv("FAST234_GOLDEN") != "" {
				if err := os.WriteFile(out, []byte(s), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if readText(out) != s {
				t.Errorf("%s: not what the strip makes now (FAST234_GOLDEN=1 rewrites it)", out)
			}
			if fastStripVoucher(s) != s {
				t.Errorf("%s %s: the strip of the strip is not the same", d, tgt)
			}
			// 2.3.4 (the independent review, M2): the by-number answer (a collection, the same FETCH) to the same fields
			bn := reVchBlock.FindAllString(readText(filepath.Join(d, tgt+"-bynumber.xml")), -1)
			if len(bn) != 1 {
				t.Fatalf("%s %s: %d vouchers in the by-number answer", d, tgt, len(bn))
			}
			sb := fastStripCollection(cleanXML(bn[0]))
			for _, p := range fastLeafPaths(sb) {
				if !fastPathOK(ok, p) {
					t.Errorf("%s %s by number: %s kept (not an approved field)", d, tgt, p)
				}
			}
			if sb == "" || fastStripCollection(sb) != sb || strings.Contains(sb, "<LEDGERENTRIES.LIST") || strings.Contains(sb, "INVENTORYALLOCATIONS") {
				t.Errorf("%s %s by number: %.300s", d, tgt, sb)
			}
			outN := filepath.Join(d, tgt+"-bynumber-stripped.xml")
			if os.Getenv("FAST234_GOLDEN") != "" {
				if err := os.WriteFile(outN, []byte(sb), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if readText(outN) != sb {
				t.Errorf("%s: not what the strip makes now (FAST234_GOLDEN=1 rewrites it)", outN)
			}
			n++
		}
	}
	if n != 10 {
		t.Fatalf("%d captures (want 5 releases x 2)", n)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Log("node not found: tests/run_parse_fast234.mjs not run here (CI runs it)")
		return
	}
	o, err := exec.Command(node, filepath.Join("..", "tests", "run_parse_fast234.mjs")).CombinedOutput()
	if err != nil {
		t.Fatalf("parse.js comparison:\n%s", o)
	}
}

// --- everything else dropped: UDF fields, attributes, unapproved fields and lists; LEDGERENTRIES becomes the list
func TestFast234StripDropsEverythingElse(t *testing.T) {
	in := `<VOUCHER REMOTEID="g-9" VCHKEY="k" VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE TYPE="Date">20261001</DATE>` +
		`<GUID TYPE="String">g-9</GUID><MASTERID>9</MASTERID><ALTERID>12</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-1</VOUCHERNUMBER>` +
		`<NARRATION>a &amp; b</NARRATION><BASICBUYERADDRESS.LIST><BASICBUYERADDRESS>Secret Street 1</BASICBUYERADDRESS></BASICBUYERADDRESS.LIST>` +
		`<UDF:SECRET.LIST DESC="x"><UDF:SECRET>hidden</UDF:SECRET></UDF:SECRET.LIST><CONSIGNEEMAILINGNAME>Mr X</CONSIGNEEMAILINGNAME>` +
		`<LEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT><VATEXPAMOUNT>1</VATEXPAMOUNT>` +
		`<BILLALLOCATIONS.LIST><NAME>S-1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-100.00</AMOUNT><INTERESTCOLLECTION.LIST>q</INTERESTCOLLECTION.LIST></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>` +
		`<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item</STOCKITEMNAME><AMOUNT>100.00</AMOUNT><BATCHALLOCATIONS.LIST><GODOWNNAME>Main</GODOWNNAME></BATCHALLOCATIONS.LIST>` +
		`<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>`
	want := `<VOUCHER REMOTEID="g-9" VCHTYPE="Sales"><DATE>20261001</DATE><GUID>g-9</GUID><MASTERID>9</MASTERID><ALTERID>12</ALTERID>` +
		`<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-1</VOUCHERNUMBER><NARRATION>a &amp; b</NARRATION>` +
		`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>` +
		`<BILLALLOCATIONS.LIST><NAME>S-1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-100.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>` +
		`<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item</STOCKITEMNAME><AMOUNT>100.00</AMOUNT>` +
		`<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(in); got != want {
		t.Fatalf("the strip:\n got %s\nwant %s", got, want)
	}
	// both lists in Tally's answer with ledger lines: held, nothing dropped (the independent review, L1;
	// TestFast234StripHoldsBothLists)
	both := `<VOUCHER REMOTEID="g"><ALLLEDGERENTRIES.LIST><LEDGERNAME>A</LEDGERNAME></ALLLEDGERENTRIES.LIST><LEDGERENTRIES.LIST><LEDGERNAME>B</LEDGERNAME></LEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(both); got != "" {
		t.Fatalf("both lists: %s", got)
	}
	// the approved paths are exactly today's fetch (release-240: and the TDS list and its sub-list whole, the owner's
	// decision of 07-Oct-2026, next-tds: kept by the strip, not in the FETCHLIST)
	var ps []string
	for p := range fastApprovedPaths() {
		ps = append(ps, p)
	}
	sort.Strings(ps)
	if len(ps) != 61+2 || strings.Join(liveFetchWild(), ", ") != strings.TrimPrefix(tdsWildAdded, ", ") {
		t.Fatalf("%d approved paths: %v", len(ps), ps)
	}
}

// a request's fetch as one list: a collection's <FETCH>a, b</FETCH>, or the object export's <FETCHLIST><FETCH>a</FETCH>...
func testFetchOf(request string) string {
	if strings.Contains(request, "<FETCHLIST>") {
		var o []string
		for _, m := range regexp.MustCompile(`<FETCH>([^<]*)</FETCH>`).FindAllStringSubmatch(group(`<FETCHLIST>(.*?)</FETCHLIST>`, request, 1), -1) {
			o = append(o, m[1])
		}
		return strings.Join(o, ", ")
	}
	return group(`<FETCH>([^<]*)</FETCH>`, request, 1)
}

// --- 2.3.4: the version, the allow-list's decision line naming FinComVoucherObject with the owner's words of 08-Oct-2026,
// the notes and the test sheet
func TestFast234VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.3.5" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"as for 2.3.4: the owner's decision of 2026-10-08: the entry request is FinComVoucherObject",
		`"Allow, strip in bridge."`, `"1. Fast request form (FinComVoucherObject): YES. 2. The 13 fields: all approved, keep all 13.`,
		"the trial forms FinComFetchTestA and FinComFetchTestC removed", "as for 2.3.3: the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !strings.Contains(al, "(re-measured on 2026-10-08 on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1") {
		t.Error("no re-measured line for 2.3.4")
	}
	for _, f := range []string{"bridge-2.3.4-notes.md", "bridge-2.3.4-test-sheet.txt"} {
		s := strings.Join(strings.Fields(readText(filepath.Join("..", "docs", f))), " ")
		for _, w := range []string{"2.3.4", "FinComVoucherObject", "30 days", "B, D, E and F", "Roll", "2.3.3"} {
			if !strings.Contains(strings.ToLower(s), strings.ToLower(w)) {
				t.Errorf("%s does not say %q", f, w)
			}
		}
	}
}
