// FinCom Bridge 2.5.12 (the owner's approval of 09-Nov-2026): a sale entered in voucher mode (its stock items under the
// sales ledger's line, ALLLEDGERENTRIES > INVENTORYALLOCATIONS) is read and carried; every other entry strips exactly as
// in 2.5.11; one entry of a day FinCom cannot take is held alone, with its reason, and the day's other entries go as on
// any day (never "upload the day by hand" for it). Made-up companies, ledgers and items only.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// a voucher-mode sale as Tally keeps it: the stock items inside the sales line (here written BEFORE the line's own
// amount, so the strip's order is seen), with a godown and batch, quantities and fields no list keeps
const r2512VoucherMode = `<VOUCHER REMOTEID="g-2512-1" VCHTYPE="Sales"><DATE>20261005</DATE><GUID>g-2512-1</GUID><MASTERID>5</MASTERID>` +
	`<ALTERID> 9</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>MK-17</VOUCHERNUMBER><PARTYLEDGERNAME>Made Up Market</PARTYLEDGERNAME>` +
	`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Made Up Market</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-354.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
	`<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Online</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>` +
	`<INVENTORYALLOCATIONS.LIST><DESCRIPTION>x</DESCRIPTION><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT>` +
	`<ACTUALQTY> 2 Nos</ACTUALQTY><BILLEDQTY> 2 Nos</BILLEDQTY><BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME>` +
	`<AMOUNT>200.00</AMOUNT><BILLEDQTY> 2 Nos</BILLEDQTY></BATCHALLOCATIONS.LIST></INVENTORYALLOCATIONS.LIST>` +
	`<INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Pen Red</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>100.00</AMOUNT><BILLEDQTY> 1 Nos</BILLEDQTY></INVENTORYALLOCATIONS.LIST>` +
	`<AMOUNT>300.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
	`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><AMOUNT>54.00</AMOUNT><INVENTORYALLOCATIONS.LIST>      </INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>`

// 1. the voucher-mode sale is kept: each stock item (name, rate, amount, billed quantity) inside its ledger line, after
// the line's own amount; no godown, batch, actual quantity or other field; nothing held
func TestR2512VoucherModeKept(t *testing.T) {
	got, why := fastStripWhy(r2512VoucherMode)
	if why != "" {
		t.Fatalf("held: %s", why)
	}
	want := `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Online</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>300.00</AMOUNT>` +
		`<INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><BILLEDQTY> 2 Nos</BILLEDQTY></INVENTORYALLOCATIONS.LIST>` +
		`<INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Pen Red</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>100.00</AMOUNT><BILLEDQTY> 1 Nos</BILLEDQTY></INVENTORYALLOCATIONS.LIST>` +
		`</ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><AMOUNT>54.00</AMOUNT></ALLLEDGERENTRIES.LIST>` +
		// and the entry's items as Tally's own collection gives them (fastVoucherModeItems): each with the line it sits in
		`<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>200.00</AMOUNT><BILLEDQTY> 2 Nos</BILLEDQTY>` +
		`<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales Online</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>200.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>` +
		`<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Red</STOCKITEMNAME><RATE>100.00/Nos</RATE><AMOUNT>100.00</AMOUNT><BILLEDQTY> 1 Nos</BILLEDQTY>` +
		`<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales Online</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST></VOUCHER>`
	if !strings.HasSuffix(got, want) {
		t.Fatalf("kept as\n%s\nwant it to end\n%s", got, want)
	}
	for _, no := range []string{"GODOWNNAME", "BATCHNAME", "ACTUALQTY", "DESCRIPTION", "BATCHALLOCATIONS"} {
		if strings.Contains(got, no) {
			t.Fatalf("%s kept: %s", no, got)
		}
	}
	// the line's own amount is the first one in it (what parse.js and the bridge's own line reader take)
	if ls := voucherLines(got); len(ls) < 2 || ls[1].ledger != "Sales Online" || ls[1].amount != "300.00" {
		t.Fatalf("the sales line read as %+v", ls)
	}
	// an entry with items of its own strips exactly as in 2.5.11: a stock item under a ledger line beside them is held (an
	// entry's items are never written twice), and a collection's item invoice (its sales line repeating the items) keeps
	// no INVENTORYALLOCATIONS (fastStripCollection, TestFast234StripCaptures' goldens unchanged)
	withItems := strings.Replace(r2512VoucherMode, "</VOUCHER>", `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><AMOUNT>200.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER>`, 1)
	if g, w := fastStripWhy(withItems); g != "" || !strings.Contains(w, "ALLLEDGERENTRIES.INVENTORYALLOCATIONS") {
		t.Fatalf("beside items: %q %s", w, g)
	}
	if g := fastStripCollection(withItems); strings.Contains(g, "INVENTORYALLOCATIONS") || strings.Count(g, "<ALLINVENTORYENTRIES.LIST>") != 1 {
		t.Fatalf("a collection's item invoice: %s", g)
	}
	// the object export's other form (ledger lines in LEDGERENTRIES, no ALLLEDGERENTRIES): the same
	mapped := strings.ReplaceAll(r2512VoucherMode, "ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST")
	if g2, w2 := fastStripWhy(mapped); w2 != "" || g2 != got {
		t.Fatalf("mapped form: %q\n%s", w2, g2)
	}
	// a group's answer (FinComVoucherBatch: the same lines again under LEDGERENTRIES) through the converter: the same
	group := strings.Replace(r2512VoucherMode, "</VOUCHER>", `<LEDGERENTRIES.LIST><LEDGERNAME>Made Up Market</LEDGERNAME><AMOUNT>-354.00</AMOUNT></LEDGERENTRIES.LIST></VOUCHER>`, 1)
	if v, leave := batchEntry("Made Up Traders", group); leave != "" || v != got {
		t.Fatalf("from a group: %q\n%s", leave, v)
	}
	// still held: items in INVENTORYENTRIES (no list keeps them), and ledger lines in both lists
	inv := strings.Replace(r2512VoucherMode, "</VOUCHER>", `<INVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME></INVENTORYENTRIES.LIST></VOUCHER>`, 1)
	if _, w := fastStripWhy(inv); !strings.Contains(w, "INVENTORYENTRIES") {
		t.Fatalf("INVENTORYENTRIES: %q", w)
	}
}

// 1b. the real voucher-mode invoices of TallyPrime 3.0 .. 7.1 (push-design run 37741662830, testdata/fast234kinds): read,
// their stock item inside the sales line, only approved fields
func TestR2512VoucherModeRealReleases(t *testing.T) {
	files, _ := filepath.Glob(filepath.Join("testdata", "fast234kinds", "*", "sales-voucher-mode-items-object.xml.gz"))
	if len(files) != 5 {
		t.Fatalf("%d captures", len(files))
	}
	ok := fastApprovedPaths()
	for _, f := range files {
		vs := reVchBlock.FindAllString(gz242(t, f), -1)
		s, why := fastStripWhy(cleanXML(vs[0]))
		if why != "" || !regexp.MustCompile(`<ALLLEDGERENTRIES\.LIST><LEDGERNAME>[^<]+</LEDGERNAME>.*?<AMOUNT>[^<]+</AMOUNT><INVENTORYALLOCATIONS\.LIST><STOCKITEMNAME>Item T03</STOCKITEMNAME>`).MatchString(s) {
			t.Fatalf("%s: %q\n%s", f, why, s)
		}
		for _, p := range fastLeafPaths(s) {
			if !fastPathOK(ok, p) {
				t.Fatalf("%s: %s kept", f, p)
			}
		}
		if strings.Contains(s, "GODOWNNAME") || strings.Contains(s, "BATCHALLOCATIONS") || strings.Contains(s, "ACTUALQTY") {
			t.Fatalf("%s: godown or batch kept", f)
		}
	}
}

// 2. every other entry is kept exactly as 2.5.11 kept it: the real answers of every kind of entry on every release (the
// fast234kinds and batch249 captures) strip the same with and without 2.5.12's four fields; the entry request
// (FinComVoucherObject) is byte for byte 2.5.11's
func TestR2512OrdinaryVouchersUnchanged(t *testing.T) {
	var files []string
	for _, g := range []string{filepath.Join("testdata", "fast234kinds", "*", "*-object.xml.gz"), filepath.Join("testdata", "batch249", "*", "*.xml")} {
		m, _ := filepath.Glob(g)
		files = append(files, m...)
	}
	n := 0
	for _, f := range files {
		if strings.Contains(f, "sales-voucher-mode-items") {
			continue
		}
		raw := ""
		if strings.HasSuffix(f, ".gz") {
			raw = gz242(t, f)
		} else {
			raw = readText(f)
		}
		for _, v := range reVchBlock.FindAllString(raw, -1) {
			c := cleanXML(v)
			a, wa := fastStripWhy(c)
			old := liveKeepInv2512
			liveKeepInv2512 = nil
			b, wb := fastStripWhy(c)
			liveKeepInv2512 = old
			if a != b || wa != wb {
				t.Fatalf("%s: stripped otherwise than 2.5.11:\n%s\n2.5.11:\n%s", f, a, b)
			}
			n++
		}
	}
	if n < 150 {
		t.Fatalf("%d entries compared", n)
	}
	// the entry request: its FETCHLIST is 2.5.11's (the four fields are kept by the strip only)
	x := voucherObjectRequest("Made Up Traders", "25795")
	if strings.Contains(x, "INVENTORYALLOCATIONS") || !strings.Contains(x, "<FETCH>ALLINVENTORYENTRIES.STOCKITEMNAME</FETCH>") {
		t.Fatalf("the entry request changed: %s", x)
	}
}

// 2b. the review's point 5: the group request (FinComVoucherBatch, and FinComVoucherWindow's same frozen FETCH) is byte for
// byte 2.5.11's (2.4.9's measured text, testdata/batch249/b4-range.xml and b4-list.xml); the entry request
// (FinComVoucherObject) too: 2.5.12 changes no request for a voucher-mode sale (the strip keeps what Tally sends anyway)
func TestR2512GroupRequestAs2511(t *testing.T) {
	if s := sha256.Sum256([]byte(batchFetchText)); hex.EncodeToString(s[:]) != "cd914d4c22caf66ab493da5a734baf236609f998a3cbbc7ab1f972d6d0f54280" || strings.Contains(batchFetchText, "INVENTORYALLOCATIONS") {
		t.Fatalf("the group's FETCH is not 2.5.11's: %s", batchFetchText)
	}
	if got := voucherBatchRangeRequest("@@CO@@", "20991231", 111111, 222222); got != batchTD(t, "b4-range.xml") {
		t.Fatalf("the range form is not 2.5.11's:\n%s", got)
	}
	want := strings.Replace(batchTD(t, "b4-list.xml"), "@@MIDS@@", "$MasterID = 15 OR $MasterID = 17", 1)
	if got := voucherBatchListRequest("@@CO@@", "20991231", []string{"15", "17"}); got != want {
		t.Fatalf("the list form is not 2.5.11's:\n%s", got)
	}
	if w := fastBatchRequest("@@CO@@", "20991201", "20991231", 1, 2); !strings.Contains(w, "<FETCH>"+batchFetchText+"</FETCH>") {
		t.Fatalf("the window request: %s", w)
	}
	if strings.Contains(voucherObjectRequest("@@CO@@", "7"), "INVENTORYALLOCATIONS") {
		t.Fatal("the entry request carries them")
	}
	// a group's voucher-mode entry (Tally lists its items itself and still keeps the stock item under the sales line) is
	// left for FinComVoucherObject, which reads it
	group := strings.Replace(r2512VoucherMode, "</VOUCHER>", `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><AMOUNT>200.00</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER>`, 1)
	if _, leave := batchEntry("Made Up Traders", group); leave == "" {
		t.Fatal("a group's voucher-mode entry taken from the group")
	}
}

// the held entries a day's calls told FinCom (the last call of a day says "held", [] when none)
func r2512HeldTold(m *pullModel) (held []any, said int) {
	for _, e := range m.entries {
		if hs, ok := e["held"]; ok {
			said++
			held = append(held, arr(hs)...)
		}
	}
	return held, said
}

// 3. a day with one entry FinCom cannot read (its items in INVENTORYENTRIES): the day's other entries are sent as on any
// day; only that entry is held: NOTHING of it is sent as an entry (never a head FinCom would keep as seen), and the
// day's last call names it with its reason ("held"), so FinCom keeps the day open; the day is not marked to be uploaded
// here. Listed again, that entry is asked of Tally again (FinComVoucherObject); once it reads, the day's last call says
// held [] (FinCom clears the mark). One by one, and from a group of 100
func TestR2512OneUnreadableEntryHeldDayKept(t *testing.T) {
	for name, mode := range map[string]string{"one by one": `,"DayPullBatchMax":1`, "groups": ""} {
		t.Run(name, func(t *testing.T) { r2512OneHeld(t, mode) })
	}
}

func r2512OneHeld(t *testing.T, mode string) {
	f, _, m := pullBridgeWith(t, mode)
	vs := pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt", "Payment")
	vs[1].extra = `<INVENTORYENTRIES.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME><AMOUNT>100.00</AMOUNT></INVENTORYENTRIES.LIST>`
	vs[2].extra = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Online</LEDGERNAME><AMOUNT>0.00</AMOUNT><INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Pen Blue</STOCKITEMNAME>` +
		`<BILLEDQTY> 1 Nos</BILLEDQTY><AMOUNT>0.00</AMOUNT></INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>`
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if len(m.upload) != 0 || pullCurrent() != nil {
		t.Fatalf("upload %v, still read %v", m.upload, pullCurrent() != nil)
	}
	sent := sentEntries(m)
	if len(sent) != 3 || sent[vs[1].master] != "" {
		t.Fatalf("%d entries sent (the held one: %q)", len(sent), cut(sent[vs[1].master], 100))
	}
	for i, v := range vs {
		if i != 1 && (sent[v.master] != fastStripVoucher(cleanXML(v.xml())) || !strings.Contains(sent[v.master], "<LEDGERNAME>")) {
			t.Fatalf("MasterID %s sent as %s", v.master, sent[v.master])
		}
	}
	if !strings.Contains(sent[vs[2].master], "<STOCKITEMNAME>Pen Blue</STOCKITEMNAME>") {
		t.Fatalf("the voucher-mode sale: %s", sent[vs[2].master])
	}
	if _, seen := m.held[vs[1].guid]; seen {
		t.Fatal("the held entry was given to FinCom as an entry")
	}
	held, said := r2512HeldTold(m)
	if said != 1 || len(held) != 1 {
		t.Fatalf("held told %d times: %v", said, held)
	}
	h := obj(held[0])
	if str(h["masterId"]) != vs[1].master || str(h["guid"]) != vs[1].guid || str(h["type"]) != "Sales" || toI64(h["alterId"]) != vs[1].alter ||
		!strings.HasPrefix(str(h["why"]), "Sales entry (MasterID "+vs[1].master+") of ") || !strings.Contains(str(h["why"]), "INVENTORYENTRIES") {
		t.Fatalf("held: %v", h)
	}
	if lg := readText(logFile()); !strings.Contains(lg, "Sales entry (MasterID "+vs[1].master+")") || !strings.Contains(lg, "the day stays open") || !strings.Contains(lg, "1 held") {
		t.Fatal("not in the log")
	}
	// listed again (FinCom keeps the day open): the held entry is asked of Tally again, by itself (FinComVoucherObject)
	n0 := f.n(vchObjectID)
	pullReset()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if f.n(vchObjectID) != n0+1 {
		t.Fatalf("not asked again: %d -> %d", n0, f.n(vchObjectID))
	}
	if held, said := r2512HeldTold(m); said != 2 || len(held) != 2 {
		t.Fatalf("held again: %d %v", said, held)
	}
	// it reads now (the entry altered in Tally into a form FinCom reads): sent, and the day's last call says held []
	vs[1].extra = ""
	pullReset()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if sent := sentEntries(m); sent[vs[1].master] == "" {
		t.Fatal("the retry did not send it")
	}
	last := m.entries[len(m.entries)-1]
	if hs, ok := last["held"]; !ok || len(arr(hs)) != 0 {
		t.Fatalf("the day's last call: %v", last["held"])
	}
}

// 3b. an entry larger than FinCom takes in one call (tally-ingest refused the whole day's call for it): held alone too,
// counted once as asked
func TestR2512OversizeEntryHeldAlone(t *testing.T) {
	f, _, m := pullBridge(t)
	vs := pullDay(f, "20250915", 900, "Journal", "Journal")
	vs[0].narr = strings.Repeat("n", pullEntryMax+10)
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	sent := sentEntries(m)
	if len(m.upload) != 0 || len(sent) != 1 || sent[vs[0].master] != "" || !strings.Contains(sent[vs[1].master], "<LEDGERNAME>") {
		t.Fatalf("upload %v, sent %d", m.upload, len(sent))
	}
	held, _ := r2512HeldTold(m)
	if len(held) != 1 || !strings.Contains(str(obj(held[0])["why"]), "larger than FinCom takes") || !strings.HasPrefix(str(obj(held[0])["why"]), "Journal entry") {
		t.Fatalf("held: %v", held)
	}
	pull.mu.Lock()
	asked := toInt(pull.state[companyKey(zz)]["asked"])
	pull.mu.Unlock()
	if asked != 2 {
		t.Fatalf("asked counted %d times for 2 entries", asked)
	}
}

// 4. the version
func TestR2512Version(t *testing.T) {
	for _, c := range [][3]string{{"2.5.12", "2.5.11", "1"}, {"2.5.11", "2.5.12", ""}, {"2.5.12", "2.5.12", ""}, {"2.5.12", "2.5.9", "1"}, {"2.5.13", "2.5.12", "1"}} {
		if newerVersion(c[0], c[1]) != (c[2] == "1") {
			t.Fatal(c)
		}
	}
	if BridgeVersion != "2.5.15" { // 2.5.15 (r2515_test.go); 2.5.14 (r2514_test.go); 2.5.13 (r2513_test.go)
		t.Fatalf("version %s", BridgeVersion)
	}
	if _, err := os.Stat("../docs/bridge-2.5.12-test-sheet.txt"); err != nil {
		t.Fatal(err)
	}
}

// 2.5.12's sentence in the FinComDayHeads row (the range form, range2512.go)
const allowRange2512Words = "; 2.5.12 (the owner's approval of 09-Nov-2026): also the same request for a RANGE of 2 to 31 consecutive days FinCom listed (SVFROMDATE < SVTODATE), split by day and told to FinCom day by day as before (empty days too); 7 days at the start of a period, doubled only after an answer under 1 s, halved after one over 1 s, single days after a day of more than 200 entries or any answer not whole; over 2 s or Tally's window held 2 s stops the period for that company as for one day"

func allowListRows2511() string {
	var o []string
	for _, l := range strings.SplitAfter(allowListRows(), "\n") {
		if strings.HasPrefix(l, "| "+dayHeadsID+" |") {
			// 2.5.12's sentence on the range form (range2512.go) out: the row as 2.5.11 had it
			l = strings.Replace(l, dayHeadsRangeWords, "", 1)
		}
		if strings.HasPrefix(l, "| "+ledListID+" |") {
			// 2.5.13's sentence on the date its period carries when Tally gives no BOOKSFROM (booksfrom.go) out
			l = strings.Replace(l, r2513LedgersWords, "", 1)
		}
		if strings.HasPrefix(l, "| "+stockID+" |") {
			l = strings.Replace(l, "unchanged in 2.5.14)", "unchanged in 2.5.11)", 1)
		}
		o = append(o, l)
	}
	return strings.Join(o, "")
}

// 5. the allow-list: the table is 2.5.11's but for FinComDayHeads' words on the range form (its shape unchanged) and the
// stock row's version word; FinComVoucherBatch's row and shape are 2.5.11's; the decision line names 2.5.12 by the owner's
// decision of 2026-11-09, 2.5.11's kept as history; the dated line
func TestR2512AllowList(t *testing.T) {
	if h := allowListHash(allowListRows2511()); h != "9a9d44d30ccaaf1d2b5dc2bda88adf01d4150fe52255dc45b7fe6a86c10dc94f" {
		t.Fatalf("a row other than FinComDayHeads' words changed from 2.5.11 (%s)", h)
	}
	if sh := shapeOf(allowListSamples()[vchBatchID]); sh != "97496818a7d8" {
		t.Fatalf("FinComVoucherBatch's shape %s", sh)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"the requests are 2.5.12's, as the owner's decision of 2026-11-09 allowed them", "as for 2.5.13 by the owner's standing decision of 2026-10-06", "FinComDayHeads (shape unchanged for one day) is also sent for a RANGE of 2 to 31 consecutive days",
		"FinComVoucherBatch and FinComVoucherObject unchanged", "as for 2.5.11 by the owner's standing decision of 2026-10-06"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !strings.Contains(al, "(re-measured on 2026-11-09 for 2.5.12: on the stand only, not on real TallyPrime") || strings.Contains(al, "allowed for 2.5.11 by") {
		t.Error("the dated lines")
	}
	if a := tallyAllowList[dayHeadsID]; !strings.HasSuffix(a.purpose, dayHeadsRangeWords) {
		t.Fatalf("the row: %+v", a)
	}
}
