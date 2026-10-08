package main

// 2.3.4: the independent review of 08-Oct-2026 (M2, L1, L2, L5): every voucher body the bridge sends holds only the
// approved fields, whatever request brought it; a voucher whose lines the strip cannot map is held (never sent short,
// so migration 57 never marks its rows gone); a line WITH a MasterID is never asked by its number (a scan of the company)

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// the body holds only approved leaf paths, the VOUCHER element's REMOTEID and VCHTYPE and no other attribute, no
// user-defined field
func fastOnlyApproved(t *testing.T, what, x string) {
	t.Helper()
	if x == "" {
		return
	}
	ok := fastApprovedPaths()
	for _, p := range fastLeafPaths(x) {
		if !ok[p] {
			t.Fatalf("%s: a field outside the approved list left: %s\n%s", what, p, x)
		}
	}
	for _, m := range regexp.MustCompile(`<([A-Za-z][\w.:]*)(\s[^>]*)?>`).FindAllStringSubmatch(x, -1) {
		if m[2] == "" {
			continue
		}
		if m[1] != "VOUCHER" || strings.TrimSpace(reFastAttr.ReplaceAllString(m[2], "")) != "" {
			t.Fatalf("%s: an attribute left: <%s%s>", what, m[1], m[2])
		}
	}
	if strings.Contains(x, "UDF:") {
		t.Fatalf("%s: a user-defined field left", what)
	}
}

func fastSentBodies(t *testing.T, c *standCloud) int {
	t.Helper()
	n := 0
	for _, s := range c.recSent() {
		if x := str(s["xml"]); x != "" {
			n++
			fastOnlyApproved(t, str(s["line_id"]), x)
		}
	}
	return n
}

// what Tally keeps beside the approved fields (the review's list from the real answers): every one must go
const fastExtras = `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><VOUCHERKEY>198839805935624</VOUCHERKEY><ISDELETED>No</ISDELETED>` +
	`<BASICBUYERADDRESS.LIST><BASICBUYERADDRESS>12 Mall Road</BASICBUYERADDRESS></BASICBUYERADDRESS.LIST><UDF:FCNOTE.LIST DESC="FC"><UDF:FCNOTE>x</UDF:FCNOTE></UDF:FCNOTE.LIST>`

// --- M2: an entry found by its type and number (no MasterID on its line; Tally answering typed, with attributes and
// fields outside the list): sent with the approved fields only
func TestFast234ByNumberAnswerStripped(t *testing.T) {
	for _, typed := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "typed"}[typed], func(t *testing.T) {
			was := standTyped.Load()
			standTyped.Store(typed)
			t.Cleanup(func() { standTyped.Store(was) })
			p, f, c := r222bBridge(t, "")
			v := r222Vch(f, 25790, "Journal", "N-90", "20261005", 54590)
			v.extra = fastExtras
			liveAppend(t, p, r222Line("voucher_accept_pre", "07:20", nwsGUID+"-00000000", "0", "0", "Journal", "N-90", "5-Oct-2026", "no mid"),
				r222Line("voucher_accept_post", "07:20", nwsGUID+"-00000000", "0", "0", "Journal", "N-90", "5-Oct-2026", "no mid"))
			readAndUploadAll(t)
			if f.n(vchByNumberID) == 0 {
				t.Fatalf("not asked by number: %v", f.ids())
			}
			if fastSentBodies(t, c) != 1 {
				t.Fatalf("sent: %v", c.recSent())
			}
		})
	}
}

// --- M2: every body that leaves, whatever brought it (the entry by MasterID, by number, a held line asked again):
// only the approved fields
func TestFast234NoBodyLeavesUnapproved(t *testing.T) {
	was := standTyped.Load()
	standTyped.Store(true)
	t.Cleanup(func() { standTyped.Store(was) })
	p, f, c := r222bBridge(t, `,"RecorderResolveSec":0`)
	r222Vch(f, 25791, "Journal", "J-25791", "20261005", 54591).extra = fastExtras
	r222Vch(f, 25792, "Journal", "", "20261005", 54592).extra = fastExtras
	r222Vch(f, 25793, "Journal", "N-93", "20261005", 54593).extra = fastExtras
	liveAppend(t, p, slowLine(25791, "07:21")...)
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:22", nwsGUID+"-00000000", "0", "0", "Journal", "N-93", "5-Oct-2026", "no mid"),
		r222Line("voucher_accept_post", "07:22", nwsGUID+"-00000000", "0", "0", "Journal", "N-93", "5-Oct-2026", "no mid"))
	readAndUploadAll(t)
	applyHeldLines(M{"heldLines": retryHeldRows("25792")})
	fastTurns(3)
	if n := fastSentBodies(t, c); n < 3 {
		t.Fatalf("%d bodies sent (want the three entries'): %v", n, c.recSent())
	}
}

// --- L1: both line lists carry ledger lines: held (""), never one dropped
func TestFast234StripHoldsBothLists(t *testing.T) {
	v := `<VOUCHER REMOTEID="g-1" VCHTYPE="Sales"><MASTERID>5</MASTERID><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
		`<LEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>-118.00</AMOUNT></LEDGERENTRIES.LIST></VOUCHER>`
	if got := fastStripVoucher(v); got != "" {
		t.Fatalf("both lists with ledger lines: not held:\n%s", got)
	}
	if _, why := fastStripWhy(v); !strings.Contains(why, "LEDGERENTRIES") {
		t.Fatalf("why: %q", why)
	}
	// an empty ALLLEDGERENTRIES list beside the ledger lines (Tally's item invoice): mapped as before
	v2 := strings.Replace(v, "<LEDGERNAME>Sales</LEDGERNAME>", "<LEDGERNAME></LEDGERNAME>", 1)
	if got := fastStripVoucher(v2); !strings.Contains(got, "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME>") {
		t.Fatalf("the item invoice's form: %s", got)
	}
}

// --- L2: the shapes whose lines the strip would drop (a stock item under a ledger line: voucher mode; a stock journal's
// lines in and out; the items in INVENTORYENTRIES; pay heads by employee): held, with the place named
func TestFast234StripHoldsUnreadShapes(t *testing.T) {
	head := `<VOUCHER REMOTEID="g-1" VCHTYPE="X"><MASTERID>5</MASTERID><DATE>20261005</DATE>`
	item := `<STOCKITEMNAME>Item T03</STOCKITEMNAME><AMOUNT>300.00</AMOUNT>`
	for name, body := range map[string]string{
		"voucher mode":        `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>300.00</AMOUNT><INVENTORYALLOCATIONS.LIST>` + item + `</INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>`,
		"voucher mode mapped": `<LEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>300.00</AMOUNT><INVENTORYALLOCATIONS.LIST>` + item + `</INVENTORYALLOCATIONS.LIST></LEDGERENTRIES.LIST>`,
		"stock journal in":    `<INVENTORYENTRIESIN.LIST>` + item + `</INVENTORYENTRIESIN.LIST>`,
		"stock journal out":   `<INVENTORYENTRIESOUT.LIST>` + item + `</INVENTORYENTRIESOUT.LIST>`,
		"inventory entries":   `<INVENTORYENTRIES.LIST>` + item + `</INVENTORYENTRIES.LIST>`,
		"payroll":             `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Salary Payable</LEDGERNAME><AMOUNT>1500.00</AMOUNT></ALLLEDGERENTRIES.LIST><CATEGORYENTRY.LIST><EMPLOYEEENTRIES.LIST><EMPLOYEENAME>E1</EMPLOYEENAME><PAYHEADALLOCATIONS.LIST><PAYHEADNAME>Basic</PAYHEADNAME><AMOUNT>-1500.00</AMOUNT></PAYHEADALLOCATIONS.LIST></EMPLOYEEENTRIES.LIST></CATEGORYENTRY.LIST>`,
	} {
		v := head + body + `</VOUCHER>`
		got, why := fastStripWhy(v)
		if got != "" || why == "" || fastStripVoucher(v) != "" {
			t.Fatalf("%s: not held (%q):\n%s", name, why, got)
		}
	}
	// empty lists Tally writes everywhere hold nothing
	v := head + `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>10.00</AMOUNT><INVENTORYALLOCATIONS.LIST>      </INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>` +
		`<INVENTORYENTRIESIN.LIST><STOCKITEMNAME></STOCKITEMNAME></INVENTORYENTRIESIN.LIST></VOUCHER>`
	if got := fastStripVoucher(v); !strings.Contains(got, "<LEDGERNAME>Bank</LEDGERNAME>") {
		t.Fatalf("empty lists: %q", got)
	}
}

// --- L2: such an entry asked by its MasterID: held with the place named and the Day Book words, its body never sent,
// never taken as deleted or not found, never asked by its number, and its held line not asked again
func TestFast234UnreadShapeHeld(t *testing.T) {
	p, f, c := r222bBridge(t, `,"RecorderResolveSec":0`)
	v := r222Vch(f, 25795, "Sales", "SV-1", "20261005", 54595)
	v.extra = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>300.00</AMOUNT><INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Item T03</STOCKITEMNAME><AMOUNT>300.00</AMOUNT></INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>`
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:25", nwsGUID+"-00000000", "0", "0", "Sales", "SV-1", "5-Oct-2026", "vm"),
		r222Line("voucher_accept_post", "07:25", nwsGUID+"-00000000", "25795", "0", "Sales", "SV-1", "5-Oct-2026", "vm"))
	readAndUploadAll(t)
	fastTurns(3)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "INVENTORYALLOCATIONS") ||
		!strings.Contains(str(s[0]["heldWhy"]), "upload that day's Day Book to settle it") {
		t.Fatalf("sent: %v", s)
	}
	if f.n(vchByNumberID) != 0 || f.n(vchObjectID) != 1 {
		t.Fatalf("asked: %v", f.ids())
	}
}

// --- L5: a line WITH a MasterID whose voucher is another entry: held (the Day Book words), never asked by its type and
// number (a scan of the company: 12-17 s at 100,000 vouchers)
func TestFast234MasterIDLineNeverByNumber(t *testing.T) {
	p, f, c := r222bBridge(t, `,"RecorderResolveSec":0`)
	r222Vch(f, 25683, "Payment", "P-4", "20261005", 54502)
	r222Vch(f, 25800, "Journal", "J-77", "20261005", 54520)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "08:40", nwsGUID+"-00000000", "0", "0", "Journal", "J-77", "5-Oct-2026", "j77"),
		r222Line("voucher_accept_post", "08:40", nwsGUID+"-00000000", "25683", "0", "Journal", "J-77", "5-Oct-2026", "j77"))
	readAndUploadAll(t)
	fastTurns(3)
	if f.n(vchByNumberID) != 0 {
		t.Fatalf("asked by number: %v", f.ids())
	}
	s := c.recSent()
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "is a Payment of 05-Oct-2026, not this Journal") {
		t.Fatalf("sent: %v", s)
	}
}

// --- M3: the strip's tag scan finds exactly the tags the regular expression found (every capture of testdata, and
// awkward forms), and a 501-item invoice's object (13.7 MB, built from the real 7.1 capture) is stripped fast
func TestFast234TagScanMatchesRegexp(t *testing.T) {
	type tag struct {
		a, z        int
		cl, sf      bool
		name, attrs string
	}
	viaRe := func(v string) (o []tag) {
		for _, m := range reFastTag.FindAllStringSubmatchIndex(v, -1) {
			o = append(o, tag{m[0], m[1], v[m[2]:m[3]] == "/", v[m[8]:m[9]] == "/", v[m[4]:m[5]], v[m[6]:m[7]]})
		}
		return
	}
	viaScan := func(v string) (o []tag) {
		fastScan(v, func(a, z int, cl bool, name, attrs string, sf bool) bool {
			o = append(o, tag{a, z, cl, sf, name, attrs})
			return true
		})
		return
	}
	in := []string{`<A>x</A>`, `<A/>`, `<A />`, `<A x="1"/>`, `<A x="a>b" y='c"d'>t</A>`, `< A>`, `<1A>`, `<!-- c --><?x?><A>`, `<A x="open>`, `<A	b="1"	/>`,
		`<UDF:X.LIST DESC="` + "`" + `a` + "`" + `" ISLIST="YES" TYPE="String"><UDF:X>1</UDF:X></UDF:X.LIST>`, `<A/ >`, `<A x=1/>`, `<A_b-c.d:e>`, `text<`, `<`, `</>`, `</A >`, `<A&B>`}
	files, _ := filepath.Glob(filepath.Join("testdata", "*", "*", "*.xml"))
	more, _ := filepath.Glob(filepath.Join("testdata", "*", "*.xml"))
	for _, f := range append(files, more...) {
		in = append(in, readText(f))
	}
	for i, v := range in {
		a, b := viaRe(v), viaScan(v)
		if len(a) != len(b) {
			t.Fatalf("input %d: %d tags by the expression, %d by the scan", i, len(a), len(b))
		}
		for k := range a {
			if a[k] != b[k] {
				t.Fatalf("input %d tag %d: %+v by the expression, %+v by the scan", i, k, a[k], b[k])
			}
		}
	}
	if len(in) < 40 {
		t.Fatalf("only %d inputs", len(in))
	}
	raw := readText(filepath.Join("testdata", "fast234", "7.1", "sales-objfl.xml"))
	v := cleanXML(reVchBlock.FindAllString(raw, -1)[0])
	a := strings.Index(v, "<ALLINVENTORYENTRIES.LIST>")
	z := strings.LastIndex(v, "</ALLINVENTORYENTRIES.LIST>") + len("</ALLINVENTORYENTRIES.LIST>")
	big := v[:a] + strings.Repeat(v[a:z], 167) + v[z:]
	t0 := time.Now()
	s, why := fastStripWhy(big)
	d := time.Since(t0)
	t.Logf("a 501-item invoice's object: %d bytes in, %d out, stripped in %v", len(big), len(s), d)
	if why != "" || strings.Count(s, "<ALLINVENTORYENTRIES.LIST>") != 501 || d > 1500*time.Millisecond {
		t.Fatalf("the 501-item strip: %q, %d items, %v", why, strings.Count(s, "<ALLINVENTORYENTRIES.LIST>"), d)
	}
}
