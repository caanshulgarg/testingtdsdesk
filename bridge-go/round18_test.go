package main

// Round 18 (FinCom Bridge 2.1.9, 04-Oct-2026). The owner's rule of 04-Oct-2026: reading is prospective only; the
// bridge never reads earlier vouchers from Tally in normal running (reading old months is what risks hanging Tally).
//   - ReadDays (default off, never set from the cloud): Update now and the nightly run ask only FinComCompany and the
//     ledger list; no Day Book, no voucher list, no day goes to the cloud. Postings go on.
//   - The starting point: each company's ALTVCHID/ALTMSTID on its first FinComCompany answer, kept in
//     sync\start-point.json once (anew only when the company's GUID changes); the heartbeat carries it and the latest.
//   - "Test reading from Tally" (person-started) tries the four date forms on an anchor day and logs which one answered
//     with exactly that day's entries; it changes nothing. It also measures one request for the entries above the
//     starting point (TDSDeskKeepList, its AlterID filter, no dates), and FinComCompany sent as UTF-16 and as UTF-8.
//   - Every dated request renders its dates through one function (dateVars), unchanged: yyyymmdd.
//   - The recorder trial: "Recorder trial: send results" and "Recorder trial: note change numbers" (tray only), the
//     recorder line parser, the folder watch; the installer's recorder and add-on folders.
//   - TallyRequestUTF16 (default off): the request body as UTF-16LE with its BOM.

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf16"
)

// --- a stand-in Tally that applies a request's period in one date form only. Any other form is not applied: the Day
// Book answers Tally's current date (cur), a collection the whole current period (what NWS144 did on 04-Oct-2026)
var r18Forms = map[string]*regexp.Regexp{
	formPlain:  regexp.MustCompile(`<SVFROMDATE>(\d{8})</SVFROMDATE><SVTODATE>(\d{8})</SVTODATE>`),
	formDMY:    regexp.MustCompile(`<SVFROMDATE>(\d{1,2}-[A-Za-z]{3}-\d{4})</SVFROMDATE><SVTODATE>(\d{1,2}-[A-Za-z]{3}-\d{4})</SVTODATE>`),
	formPlainT: regexp.MustCompile(`<SVFROMDATE TYPE="Date">(\d{8})</SVFROMDATE><SVTODATE TYPE="Date">(\d{8})</SVTODATE>`),
	formDMYT:   regexp.MustCompile(`<SVFROMDATE TYPE="Date">(\d{1,2}-[A-Za-z]{3}-\d{4})</SVFROMDATE><SVTODATE TYPE="Date">(\d{1,2}-[A-Za-z]{3}-\d{4})</SVTODATE>`),
}

func r18Ymd(s string) string {
	if isTallyDate(s) {
		return s
	}
	t, err := time.Parse("2-Jan-2006", s)
	if err != nil {
		return ""
	}
	return tallyDate(t)
}

func r18Dates(accept, cur string) func(id, body string) (string, string) {
	return func(id, body string) (string, string) {
		if rx := r18Forms[accept]; rx != nil {
			if m := rx.FindStringSubmatch(body); m != nil {
				return r18Ymd(m[1]), r18Ymd(m[2])
			}
		}
		if id == "Day Book" {
			return cur, cur
		}
		return "", ""
	}
}

// entries of 01-Jul, 28-Jul and 01-Aug-2026 (the owner's four entries); Tally's current date 01-Aug-2026
func r18Tally(t *testing.T, accept string) *standTally {
	f := newStandTally(t)
	f.add("20260701", "Party X", "J-1", "rent", "-10.00")
	f.add("20260701", "Party X", "J-2", "rent", "-11.00")
	f.add("20260728", "Party X", "J-3", "rent", "-12.00")
	f.add("20260801", "Party X", "J-4", "rent", "-13.00")
	f.dates = r18Dates(accept, "20260801")
	return f
}

func r18Result(r M, prefix string) M {
	for _, x := range arr(r["results"]) {
		if str(obj(x)["label"]) == prefix {
			return obj(x)
		}
	}
	for _, x := range arr(r["results"]) {
		if strings.HasPrefix(str(obj(x)["label"]), prefix) {
			return obj(x)
		}
	}
	return nil
}

// the read test only tests and logs: no date-form file, every request's dates as before
func r18NothingChanged(t *testing.T) {
	t.Helper()
	if exists(sp("date-form.json")) {
		t.Fatal("the read test wrote sync\\date-form.json")
	}
	if x := dayBookRequest(zz, "20260701", "20260731"); !strings.Contains(x, "<SVFROMDATE>20260701</SVFROMDATE><SVTODATE>20260731</SVTODATE>") {
		t.Fatalf("the Day Book request's dates changed after the read test: %s", x)
	}
	if x := tagCheckRequest(zz, "20260701"); !strings.Contains(x, "<SVFROMDATE>20260701</SVFROMDATE><SVTODATE>20260701</SVTODATE>") {
		t.Fatalf("FinComTag's dates changed after the read test: %s", x)
	}
}

func r18Matrix(t *testing.T, accept, want string) M {
	t.Helper()
	f := r18Tally(t, accept)
	standBridge(t, f, "")
	r, err := runReadTest(zz)
	if err != nil {
		t.Fatal(err)
	}
	if str(r["day"]) != "20260801" {
		t.Fatalf("the anchor day: %q, want 20260801 (the newest date FinComTag lists)", str(r["day"]))
	}
	if str(r["passed"]) != want {
		t.Fatalf("the form that answered the anchor day: %q, want %q (%v)", str(r["passed"]), want, r["results"])
	}
	for _, fm := range dateForms {
		if r18Result(r, "Day Book, dates "+fm) == nil {
			t.Fatalf("no result for the Day Book with %s: %v", fm, r["results"])
		}
	}
	if r18Result(r, "FinComTag") == nil || r18Result(r, "FinComCompany (change numbers)") == nil {
		t.Fatalf("FinComTag or FinComCompany missing: %v", r["results"])
	}
	line := "Dates on this Tally: " + want + " (anchor 20260801, 1 entries)"
	if want == "none" {
		line = "Dates on this Tally: none of the 4 forms answered 20260801 with exactly its entries"
	}
	if logLines(line) != 1 {
		t.Fatalf("the log does not say %q:\n%s", line, strings.Join(r13LogLines("Test reading from Tally"), "\n"))
	}
	r18NothingChanged(t)
	return r
}

// --- 1. the read test's matrix: a Tally that applies dates only with TYPE="Date"
func TestReadTestPicksTypeDate(t *testing.T) {
	r := r18Matrix(t, formPlainT, formPlainT)
	// the plain form answered the anchor day (Tally's current date) but also the empty day: not applied
	if p := r18Result(r, "Day Book, dates yyyymmdd"); p == nil || p["passed"] == true {
		t.Fatalf("plain yyyymmdd: %v", p)
	}
}

func TestReadTestPicksDMY(t *testing.T) { r18Matrix(t, formDMY, formDMY) }

// no form applies the period: "none" is logged; nothing changes, and normal running reads no old day anyway
func TestReadTestNoFormPasses(t *testing.T) { r18Matrix(t, "", "none") }

// --- 2. every dated request renders its dates through dateVars, as before (yyyymmdd, no TYPE)
func TestEveryDatedRequestUsesDateVars(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") || f == "dates.go" {
			continue
		}
		if s := readText(f); strings.Contains(s, "<SVFROMDATE>") || strings.Contains(s, "<SVTODATE>") {
			t.Errorf("%s writes SVFROMDATE/SVTODATE itself (every request renders them with dateVars, dates.go)", f)
		}
	}
	const a, z = "20260401", "20260430"
	plain := "<SVFROMDATE>" + a + "</SVFROMDATE><SVTODATE>" + z + "</SVTODATE>"
	one := "<SVFROMDATE>" + a + "</SVFROMDATE><SVTODATE>" + a + "</SVTODATE>"
	if dateVars(formPlain, a, z) != plain {
		t.Fatalf("dateVars plain: %s", dateVars(formPlain, a, z))
	}
	for form, want := range map[string]string{
		formDMY:    "<SVFROMDATE>1-Apr-2026</SVFROMDATE><SVTODATE>30-Apr-2026</SVTODATE>",
		formPlainT: `<SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260430</SVTODATE>`,
		formDMYT:   `<SVFROMDATE TYPE="Date">1-Apr-2026</SVFROMDATE><SVTODATE TYPE="Date">30-Apr-2026</SVTODATE>`,
	} {
		if got := dateVars(form, a, z); got != want {
			t.Errorf("dateVars %s: %s, want %s", form, got, want)
		}
	}
	for name, x := range map[string]string{
		"Day Book": dayBookRequest(zz, a, z), "TDSDeskVchHeads": vchHeadsRequest(zz, a, z), "TDSDeskKeepList": keepListRequest(zz, a, z, 0),
		"FinComByMaster": masterCheckRequest(zz, a, z, "1"), "FinComMeasureB": measureReqB(zz, a, z, 1), "FinComMeasureC": measureReqC(zz, a, z, 1),
		"FinComMeasureYear": measureReqYear(zz, a, z), "FinComMeasureD": measureReqD(zz, a, z), "FinComMeasureE": measureReqE(zz, a, z, 1),
		"FinComSnapshot": snapshotRequest(zz, a, z),
	} {
		if !strings.Contains(x, plain) {
			t.Errorf("%s: its dates are not rendered as before: %s", name, cut(x, 400))
		}
	}
	for name, x := range map[string]string{"FinComTag": tagCheckRequest(zz, a), "TDSDeskDupCheck": dupCheckRequest(zz, a, "P")} {
		if !strings.Contains(x, one) {
			t.Errorf("%s: its date is not rendered as before: %s", name, cut(x, 400))
		}
	}
	if dayBookRequestDMY(zz, a, z) != dayBookRequestForm(zz, formDMY, a, z) {
		t.Fatal("the d-MMM-yyyy Day Book is not the d-MMM-yyyy form")
	}
}

// --- 3. the owner's rule of 04-Oct-2026: with ReadDays off (the default) Update now and the nightly run ask Tally only
// FinComCompany and the ledger list; no Day Book, no voucher list, no day to the cloud; a posting goes on
func TestReadDaysOffNoOldEntriesRead(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "O-1", "sale", "-1.00")
	f.add(addDays(td, -40), fgParty, "O-2", "sale", "-2.00")
	f.addLed("Ledger A", "Sundry Debtors", "0.00")
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"ReadDays":false`)
	liveFrom(addDays(td, -60))
	if readDaysOn() {
		t.Fatal("ReadDays is on")
	}
	runNow(t, "now")
	runNow(t, "nightly")
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	for _, id := range []string{"Day Book", "TDSDeskVchHeads", "TDSDeskKeepList", "FinComTag", dupCheckID, "FinComByMaster"} {
		if n := f.n(id); n != 0 {
			t.Fatalf("%s asked %d time(s) with ReadDays off: %v", id, n, f.ids())
		}
	}
	if f.n("FinComCompany") < 2 || f.n(ledListID) < 1 {
		t.Fatalf("the company check and the ledger list: %v", f.ids())
	}
	if n := logLines("Reading old entries is off (prospective only); FinComCompany ALTVCHID=3 ALTMSTID=3"); n != 2 {
		t.Fatalf("the log line: %d, want one per run", n)
	}
	if n := c.count("days"); n != 0 {
		t.Fatalf("%d days call(s) to the cloud with ReadDays off", n)
	}
	if m, _ := filepath.Glob(filepath.Join(syncFolder(zz), "days", "*.xml")); len(m) != 0 {
		t.Fatalf("day files written: %v", m)
	}
	// not settable from the cloud
	applyCloudSettings(M{"settings": M{"at": nowS(), "readDays": true, "ReadDays": true}})
	if readDaysOn() {
		t.Fatal("the cloud switched ReadDays on")
	}
	// a posting goes on
	if r := postOne(t, "rd1", finVoucher("rd1", fgParty, "RD-1", td, "3.00")); r["ok"] != true {
		t.Fatalf("posting with ReadDays off: %v", r)
	}
	f.noBalance(t)
}

// --- 4. the starting point: recorded once on the first FinComCompany answer, never moved; anew when the GUID changes;
// the heartbeat carries it and the latest numbers
func TestStartPointRecordedOnce(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "S-1", "sale", "-1.00")
	f.add(td, fgParty, "S-2", "sale", "-2.00")
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	e := obj(readObjFile(sp("start-point.json"))[companyKey(zz)+"|co-guid-1"]) // round 19: one entry per company and GUID
	if e == nil || toI64(e["altvchid"]) != 2 || toI64(e["altmstid"]) != 3 || str(e["at"]) == "" || str(e["guid"]) != "co-guid-1" {
		t.Fatalf("start-point.json: %v", readObjFile(sp("start-point.json")))
	}
	f.add(td, fgParty, "S-3", "sale", "-3.00")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	if e2 := obj(readObjFile(sp("start-point.json"))[companyKey(zz)+"|co-guid-1"]); toI64(e2["altvchid"]) != 2 || str(e2["at"]) != str(e["at"]) {
		t.Fatalf("the starting point moved: %v", e2)
	}
	b := beatBody(true, "open", "", nil, nil, nil)
	sp0, cur := obj(obj(b["startPoint"])[zz]), obj(obj(b["changeNumbers"])[zz])
	if toI64(sp0["altvchid"]) != 2 || toI64(sp0["altmstid"]) != 3 || str(sp0["at"]) == "" {
		t.Fatalf("beat startPoint: %v", b["startPoint"])
	}
	if toI64(cur["altvchid"]) != 3 || str(cur["at"]) == "" {
		t.Fatalf("beat changeNumbers: %v", b["changeNumbers"])
	}
	// the company's GUID changes (a restored company): round 19, the new GUID gets its own entry, the first is kept
	f.mu.Lock()
	f.guid = "co-guid-2"
	f.mu.Unlock()
	_, _ = companyCheck(fin, zz, f.port)
	all := readObjFile(sp("start-point.json"))
	if e3 := obj(all[companyKey(zz)+"|co-guid-2"]); toI64(e3["altvchid"]) != 3 || str(e3["guid"]) != "co-guid-2" {
		t.Fatalf("after a GUID change: %v", all)
	}
	if e4 := obj(all[companyKey(zz)+"|co-guid-1"]); toI64(e4["altvchid"]) != 2 {
		t.Fatalf("the first GUID's starting point moved: %v", all)
	}
	if logLines("its own starting point is recorded") != 1 {
		t.Fatal("the new GUID's starting point is not in the log")
	}
}

// --- 5. measurement only: the read test asks the entries above the starting point once, with no dates
func TestReadTestAboveStartPoint(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "A-1", "sale", "-1.00")
	f.add(td, fgParty, "A-2", "sale", "-2.00")
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil { // the starting point: ALTVCHID 2
		t.Fatal(err)
	}
	f.add(td, fgParty, "A-3", "sale", "-3.00")
	f.add(addDays(td, -100), fgParty, "A-4", "sale", "-4.00")
	f.add(td, fgParty, "A-5", "sale", "-5.00")
	n0 := f.n("")
	r, err := runReadTest(zz)
	if err != nil {
		t.Fatal(err)
	}
	m := r18Result(r, "Entries above the starting point")
	if m == nil || toInt(m["vouchers"]) != 3 || str(m["label"]) != "Entries above the starting point (TDSDeskKeepList, AlterID above 2, no dates)" {
		t.Fatalf("the measurement: %v", m)
	}
	if logLines("Entries above the starting point (TDSDeskKeepList, AlterID above 2, no dates): 3 vouchers, ") != 1 {
		t.Fatal("the measurement is not in the log")
	}
	f.mu.Lock()
	var kl []string
	for i, id := range f.reqs[n0:] {
		if id == "TDSDeskKeepList" {
			kl = append(kl, f.bodies[n0+i])
		}
	}
	f.mu.Unlock()
	if len(kl) != 1 || strings.Contains(kl[0], "SVFROMDATE") || strings.Contains(kl[0], "SVTODATE") || !strings.Contains(kl[0], "$AlterID &gt; 2") {
		t.Fatalf("the request: %v", kl)
	}
	// FinComCompany sent as UTF-16 and as UTF-8 (TallyRequestUTF16 off): the same answer
	if u := r18Result(r, "FinComCompany sent as UTF-16 and as UTF-8"); u == nil || u["same"] != true {
		t.Fatalf("the UTF-16 probe: %v", u)
	}
	r18NothingChanged(t)
}

// the measuring tool asks the same on the size test's stand (50,000 ledgers, 200,000 vouchers): the bridge's side
// only; the real time comes from NWS144
func TestMeasureAboveStartOnBigStand(t *testing.T) {
	big := newBigTally()
	f := newStandTally(t)
	f.behave = big.handle
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	start := int64(bigLedgers + bigVouchers)
	t0 := time.Now()
	r, err := runMeasure(measureOpts{company: zz, ledgers: "1-2"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(str(r["report"]), fmt.Sprintf("entries with AlterID above the starting point %d, no dates (TDSDeskKeepList)", start)) {
		t.Fatalf("the report has no line for it:\n%s", str(r["report"]))
	}
	big.mu.Lock()
	var got *simReq
	for i := range big.reqs {
		if big.reqs[i].id == "TDSDeskKeepList" {
			got = &big.reqs[i]
		}
	}
	big.mu.Unlock()
	if got == nil || got.spanDays != 0 || got.scanned != bigVouchers {
		t.Fatalf("the request on the big stand: %+v", got)
	}
	t.Logf("entries above the starting point on the size stand: %d returned; the fake Tally had to look at all %d vouchers (no period narrows it); "+
		"%.1f s simulated at %.2f ms a row returned (%.0f s if Tally looked at every entry at that rate); bridge side %s for the whole measure run. The real time comes from NWS144 only.",
		got.rows, got.scanned, got.simMs/1000, tallyPerRowMs, float64(got.scanned)*tallyPerRowMs/1000, time.Since(t0).Round(time.Millisecond))
}

// --- 6. TallyRequestUTF16: the body as UTF-16LE with its BOM; an em dash, a Hindi word and the rupee sign round-trip
// in both encodings
func TestUTF16Option(t *testing.T) {
	b, ct := tallyBody("<A>Rent — किराया ₹</A>", true)
	if len(b) < 2 || b[0] != 0xFF || b[1] != 0xFE || ct != "text/xml;charset=utf-16" || textFromBytes(b) != "<A>Rent — किराया ₹</A>" {
		t.Fatalf("UTF-16 body: % x %q", b[:minI(8, len(b))], ct)
	}
	if b, ct := tallyBody("<A>₹</A>", false); string(b) != "<A>₹</A>" || ct != "text/xml;charset=utf-8" {
		t.Fatalf("UTF-8 body: %q %q", b, ct)
	}
	td := today()
	for i, on := range []bool{true, false} {
		f := newStandTally(t)
		standBridge(t, f, fmt.Sprintf(`,"TallyRequestUTF16":%v`, on))
		oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
		narr := "Rent — किराया ₹1,500"
		id := fmt.Sprint("u", i)
		x := strings.Replace(finVoucher(id, fgParty, "U-"+id, td, "5.00"), "<NARRATION>Electricity", "<NARRATION>"+narr, 1)
		if r := postOne(t, id, x); r["ok"] != true {
			t.Fatalf("posting (UTF-16 %v): %v", on, r)
		}
		f.mu.Lock()
		cts := append([]string{}, f.ctypes...)
		stored := ""
		for _, v := range f.vch {
			stored = v.narr
		}
		f.mu.Unlock()
		want := "utf-8"
		if on {
			want = "utf-16"
		}
		for _, c := range cts {
			if !strings.HasSuffix(c, "charset="+want) {
				t.Fatalf("Content-Type %q with TallyRequestUTF16 %v", c, on)
			}
		}
		if !strings.Contains(stored, narr) {
			t.Fatalf("Tally kept %q (UTF-16 %v)", stored, on)
		}
		ks, err := tagsOnDate(f.port, zz, td)
		if err != nil || len(ks) != 1 || !strings.Contains(ks[0].narration, narr) {
			t.Fatalf("read back (UTF-16 %v): %v %v", on, ks, err)
		}
	}
}

// --- 7. the recorder trial
func r18RecorderDirs(t *testing.T) (rec, tally string) {
	rec, tally = t.TempDir(), t.TempDir()
	oldR, oldT := recorderDirFn, tallyDirsFn
	recorderDirFn = func() string { return rec }
	tallyDirsFn = func() []string { return []string{tally} }
	t.Cleanup(func() { recorderDirFn, tallyDirsFn = oldR, oldT; recorderWatchReset() })
	recorderWatchReset()
	return
}

func utf16leBOM(s string) []byte {
	b := []byte{0xFF, 0xFE}
	for _, u := range utf16.Encode([]rune(s)) {
		b = append(b, byte(u), byte(u>>8))
	}
	return b
}

const r18Line1 = "FCR1|ev=create|t0=36000|tw=36001|cguid=co-guid-1|cname=ZZ TEST|user=owner|obj=Voucher|guid=g-9|mid=9|aid=19|vtype=Journal|vno=7|vdate=20260801|name=|parent=|narr=Rent — किराया ₹500 | July|t1=36002"
const r18Line2 = "FCR1|ev=delete|t0=36100|tw=36101|cguid=co-guid-1|cname=ZZ TEST|user=owner|obj=Voucher|guid=g-9|mid=9|aid=20|vtype=Journal|vno=7|vdate=20260801|name=|parent=|narr=two\r\nlines|t1=36102"

func TestRecorderLineParse(t *testing.T) {
	text := r18Line1 + "\r\n" + r18Line2 + "\r\n"
	for _, b := range [][]byte{utf16leBOM(text), utf16leBOM(text)[2:]} {
		ls := parseRecorderText(decodeRecorderText(b))
		if len(ls) != 2 {
			t.Fatalf("lines: %d %+v", len(ls), ls)
		}
		a, z := ls[0], ls[1]
		if a.Ev != "create" || a.T0 != "36000" || a.Tw != "36001" || a.CGUID != "co-guid-1" || a.CName != "ZZ TEST" || a.User != "owner" || a.Obj != "Voucher" ||
			a.GUID != "g-9" || a.MID != "9" || a.AID != "19" || a.VType != "Journal" || a.VNo != "7" || a.VDate != "20260801" || a.Narr != "Rent — किराया ₹500 | July" || a.T1 != "36002" {
			t.Fatalf("line 1: %+v", a)
		}
		if z.Ev != "delete" || z.Narr != "two\nlines" || z.T1 != "36102" || z.AID != "20" {
			t.Fatalf("line 2 (a narration over two lines): %+v", z)
		}
	}
	// plain UTF-8 too; a narration holding "|t1=" itself: up to the LAST one
	ls := parseRecorderText(decodeRecorderText([]byte("FCR1|ev=alter|t0=1|tw=2|cguid=c|cname=n|user=u|obj=Voucher|guid=g|mid=1|aid=2|vtype=J|vno=1|vdate=20260801|name=|parent=|narr=a|t1=b|t1=3\n")))
	if len(ls) != 1 || ls[0].Narr != "a|t1=b" || ls[0].T1 != "3" {
		t.Fatalf("UTF-8, |t1= in the narration: %+v", ls)
	}
	if _, ok := parseRecorderLine("not a recorder line"); ok {
		t.Fatal("a line without FCR1| was taken")
	}
}

func TestTrialSendResultsPersonOnly(t *testing.T) {
	rec, tdir := r18RecorderDirs(t)
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	writeLog("a line of the bridge's log")
	rf := filepath.Join(rec, "co-guid-1.txt")
	_ = os.WriteFile(rf, utf16leBOM(r18Line1+"\r\n"), 0o644)
	recorderWatchOnce()
	time.Sleep(20 * time.Millisecond)
	_ = os.WriteFile(rf, utf16leBOM(r18Line1+"\r\n"+r18Line2+"\r\n"), 0o644)
	_ = os.Chtimes(rf, time.Now().Add(time.Second), time.Now().Add(time.Second))
	recorderWatchOnce()
	_ = os.WriteFile(filepath.Join(rec, "changenumbers.txt"), []byte("ZZ TEST: ALTVCHID=1, ALTMSTID=2, at 2026-10-04 10:00:00\r\n"), 0o644)
	_ = os.WriteFile(filepath.Join(rec, "other.log"), []byte("not sent"), 0o644)
	_ = os.WriteFile(filepath.Join(tdir, "tdlerror.log"), []byte("no errors"), 0o644)
	_ = os.WriteFile(filepath.Join(tdir, "tally.ini"), []byte("[Tally]"), 0o644)
	sup0 := c.count("support")
	for _, origin := range []string{"https://app.fincom.live", "https://evil.example"} {
		if code, res := callLocal(t, "POST", "/tray/recorder-send", origin, "{}"); code != 403 {
			t.Fatalf("from the web page %s: %d %v", origin, code, res)
		}
	}
	if code, res := callLocalHeaders(t, "POST", "/tray/recorder-send", map[string]string{"Sec-Fetch-Dest": "empty"}, "{}"); code != 403 || !strings.Contains(str(res["error"]), "tray icon only") {
		t.Fatalf("with a Sec-Fetch header: %d %v", code, res)
	}
	if c.count("support") != sup0 {
		t.Fatal("a refused request sent something")
	}
	code, res := callLocal(t, "POST", "/tray/recorder-send", "", `{"confirm":true}`)
	if code != 200 || res["ok"] != true || toInt(res["files"]) != 2 || toInt(res["lines"]) != 4 {
		t.Fatalf("from the tray: %d %v", code, res)
	}
	if logLines("Recorder trial: 4 lines in 2 files sent") != 1 {
		t.Fatal("the log line")
	}
	var body M
	c.mu.Lock()
	for _, r := range c.raw {
		if o := parseObj(r); str(o["kind"]) == "support" {
			body = o
		}
	}
	c.mu.Unlock()
	if body == nil || str(body["note"]) != "recorder trial" {
		t.Fatalf("the support pack: %v", body)
	}
	zb, _ := base64.StdEncoding.DecodeString(str(body["zip"]))
	zr, err := zip.NewReader(bytes.NewReader(zb), int64(len(zb)))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, zf := range zr.File {
		rc, _ := zf.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		got[zf.Name] = string(b)
	}
	for _, n := range []string{"recorder/co-guid-1.txt", "recorder/changenumbers.txt", "tally/tdlerror.log", "tally/tally.ini", "bridge-log-last-500-lines.txt", "recorder-summary.txt"} {
		if _, ok := got[n]; !ok {
			t.Fatalf("%s not in the pack: %v", n, keysOf(got))
		}
	}
	if _, ok := got["recorder/other.log"]; ok {
		t.Fatal("a file that is not .txt went")
	}
	s := got["recorder-summary.txt"]
	if !strings.Contains(s, "Computer: "+computerName()) || !strings.Contains(s, "co-guid-1.txt: 2 FCR1 line(s): create 1, delete 1") || !strings.Contains(s, "observed write ") {
		t.Fatalf("the summary:\n%s", s)
	}
	if !strings.Contains(got["bridge-log-last-500-lines.txt"], "a line of the bridge's log") {
		t.Fatal("the log lines")
	}
}

func keysOf(m map[string]string) []string {
	var o []string
	for k := range m {
		o = append(o, k)
	}
	return o
}

func TestChangeNumbersNoted(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "C-1", "sale", "-1.00")
	standBridge(t, f, `,"Key":"tray-test-key"`)
	trialOn(t) // round 21 (2.1.10): the owner's trial tools switched on for this computer in FinCom
	if code, _ := callLocal(t, "POST", "/tray/recorder-note", "https://app.fincom.live", "{}"); code != 403 {
		t.Fatalf("from a web page: %d", code)
	}
	if exists(filepath.Join(rec, "changenumbers.txt")) || exists(changeNumbersFile()) {
		t.Fatal("written for a web page")
	}
	for i := 0; i < 2; i++ {
		code, res := callLocal(t, "POST", "/tray/recorder-note", "", "{}")
		if code != 200 || res["ok"] != true {
			t.Fatalf("from the tray: %d %v", code, res)
		}
		f.add(td, fgParty, "C-2", "sale", "-2.00")
	}
	// round 19 (S1): in the bridge's own sync folder, never in the recorder folder
	if exists(filepath.Join(rec, "changenumbers.txt")) {
		t.Fatal("written in the recorder folder")
	}
	lines := strings.Split(strings.TrimSpace(readText(changeNumbersFile())), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "ZZ TEST: ALTVCHID=1, ALTMSTID=3, at ") || !strings.HasPrefix(lines[1], "ZZ TEST: ALTVCHID=2, ALTMSTID=3, at ") {
		t.Fatalf("recorder-changenumbers.txt:\n%s", strings.Join(lines, "\n"))
	}
}

// --- 8. the installer: the recorder folder (writable by Users) and the add-on folder with the .tdl files
func TestInstallerRecorderAndAddonFolders(t *testing.T) {
	// round 19 (S2): the setup script no longer makes the folders nor sets their permissions (an icacls without /L on a
	// path a user could have made a junction); the exe's install step does, for all users and for one user
	nsi := readText(filepath.Join("installer", "FinComBridge.nsi"))
	a := strings.Index(nsi, "Function PutFiles")
	z := strings.Index(nsi[a:], "FunctionEnd")
	if a < 0 || z < 0 {
		t.Fatal("no PutFiles")
	}
	put := nsi[a : a+z]
	for _, s := range []string{`CreateDirectory "$R1\FinCom\recorder"`, `CreateDirectory "$R1\FinCom\addon"`, "icacls", `SetOutPath "$R1\FinCom\addon"`, `File /nonfatal "..\addon\*.tdl"`} {
		if strings.Contains(put, s) {
			t.Errorf("PutFiles still has %s", s)
		}
	}
	if !strings.Contains(put, `"FinComBridge.exe install" (folders.go)`) {
		t.Error("PutFiles does not name the exe's install step")
	}
	if !strings.Contains(readText("win_service.go"), "installFinComFolders(true, installLog)") || !strings.Contains(readText("win_user.go"), "installFinComFolders(false, installLog)") {
		t.Error("the install steps do not make the folders")
	}
	if es, _ := addonFiles.ReadDir("addon"); len(es) == 0 {
		t.Error("no .tdl built into the exe")
	}
	if BridgeVersion != "2.2.4" { // 2.2.4: Tally's answers read with or without TYPE attributes, CMPINFO's counters never objects
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
}

// --- 9. the owner's addition of 04-Oct-2026: a company seen open in Tally for the first time in a run (and at most every
// 10 minutes while it stays open) gets the light FinComCompany request, and nothing else
func TestOpenCompanyLightCheckOnce(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "L-1", "sale", "-1.00")
	standBridge(t, f, "")
	sessions := openCompaniesWith(fin, true)
	start := time.Now()
	n0 := f.n("")
	lightCheckOpen(sessions)
	if got := f.ids()[n0:]; len(got) != 1 || got[0] != "FinComCompany" {
		t.Fatalf("first sight: %v (want one FinComCompany)", got)
	}
	for _, m := range []time.Duration{0, 5 * time.Minute, 9 * time.Minute} {
		mm := m
		nowFn = func() time.Time { return start.Add(mm) }
		lightCheckOpen(sessions)
	}
	if got := f.ids()[n0:]; len(got) != 1 {
		t.Fatalf("within 10 minutes: %v", got)
	}
	nowFn = func() time.Time { return start.Add(11 * time.Minute) }
	lightCheckOpen(sessions)
	nowFn = time.Now
	// round 21 (2.1.10): the company list, 11 minutes old by then, is asked afresh first (the light company-list
	// request), then FinComCompany
	if got := f.ids()[n0:]; len(got) < 3 || got[1] != "TDSDeskCompanies" || got[len(got)-1] != "FinComCompany" || r21Count(got, "FinComCompany") != 2 {
		t.Fatalf("after 10 minutes: %v", got)
	}
	for _, id := range f.ids() {
		if id != "FinComCompany" && id != "TDSDeskCompanies" && id != "TDSDeskCompanyInfo" {
			t.Fatalf("another request went: %v", f.ids())
		}
	}
	if cur := obj(changeNumbersBeat()[zz]); toI64(cur["altvchid"]) != 1 {
		t.Fatalf("the beat's numbers: %v", changeNumbersBeat())
	}
}

// the beat carries, per company, whether the recorder's holding file for its GUID was written in the last 7 days
func TestBeatCarriesRecorderState(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	cur := func() M { return obj(obj(beatBody(true, "open", "", nil, nil, nil)["changeNumbers"])[zz]) }
	if c := cur(); c["recorderSeen"] != false || str(c["recorderLastAt"]) != "" || str(c["at"]) == "" {
		t.Fatalf("no holding file: %v", c)
	}
	hf := filepath.Join(rec, "co-guid-1.txt")
	_ = os.WriteFile(hf, utf16leBOM(r18Line1+"\r\n"), 0o644)
	if c := cur(); c["recorderSeen"] != true || str(c["recorderLastAt"]) == "" {
		t.Fatalf("a fresh holding file: %v", c)
	}
	old := time.Now().AddDate(0, 0, -8)
	_ = os.Chtimes(hf, old, old)
	if c := cur(); c["recorderSeen"] != false || str(c["recorderLastAt"]) != old.Format("2006-01-02T15:04:05") {
		t.Fatalf("a holding file 8 days old: %v", c)
	}
	// by the company's name when the add-on names it so
	_ = os.Remove(hf)
	_ = os.WriteFile(filepath.Join(rec, "name-"+zz+".txt"), []byte("x"), 0o644)
	if c := cur(); c["recorderSeen"] != true {
		t.Fatalf("name-<company>.txt: %v", c)
	}
}

// the old-day logic of the Day Book rounds, still tested with ReadDays on (the owner's rule of 04-Oct-2026 turns it
// off in normal running)
func oldDaysOn() { setCfg("ReadDays", true) }

// --- 10. the owner (04-Oct-2026): the light check sends nothing while a posting is going, and a posting always goes
// first. A running posting job, or this bridge's lease on the company (held by a posting): nothing is sent and the
// company is not marked as checked, so the check goes at the next turn after the posting
func TestLightCheckNothingDuringPosting(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 1500 * time.Millisecond }
	standBridge(t, f, "")
	sessions := openCompaniesWith(fin, true)
	j, err := newPostJob(M{"jobId": "job-light-1", "company": zz, "vouchers": []any{M{"id": "lp1", "xml": finVoucher("lp1", fgParty, "LP-1", td, "4.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 200 && f.n("Import") == 0; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if len(activeJobs()) == 0 || f.n("Import") != 1 {
		t.Fatalf("the posting is not going: %v %v", activeJobs(), f.ids())
	}
	n0 := f.n("")
	lightCheckOpen(sessions)
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("the light check sent %v while a posting was going", got)
	}
	if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" {
		t.Fatalf("the posting: %v", p["message"])
	}
	// this bridge's lease on the company (as a posting holds it): nothing either, and not marked
	leaseMu.Lock()
	leases[zz] = time.Now().Add(time.Minute)
	leaseMu.Unlock()
	n1 := f.n("")
	lightCheckOpen(sessions)
	if got := f.ids()[n1:]; len(got) != 0 {
		t.Fatalf("the light check sent %v while the company's lease was held", got)
	}
	leaseMu.Lock()
	delete(leases, zz)
	leaseMu.Unlock()
	// the posting over: the next turn sends exactly one FinComCompany
	lightCheckOpen(sessions)
	if got := f.ids()[n1:]; len(got) != 1 || got[0] != "FinComCompany" {
		t.Fatalf("after the posting: %v (want one FinComCompany)", got)
	}
}

// the light check's request at Tally is stopped when a posting arrives; the posting's import goes first; the check
// goes again at the next turn
func TestPostingGoesFirstOverLightCheck(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	sessions := openCompaniesWith(fin, true)
	var once sync.Once
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == "FinComCompany" {
			once.Do(func() { d = 15 * time.Second })
		}
		return d
	}
	f.mu.Unlock()
	n0 := f.n("")
	done := make(chan struct{})
	t.Cleanup(func() { <-done })
	go func() { lightCheckOpen(sessions); close(done) }()
	// (a background request waits a few seconds after FinCom's own company list: the light check goes then)
	for i := 0; i < 1000; i++ {
		f.mu.Lock()
		in := f.inflight > 0 && len(f.reqs) > n0 && f.reqs[len(f.reqs)-1] == "FinComCompany"
		f.mu.Unlock()
		if in {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	t0 := time.Now()
	r := postOne(t, "pf1", finVoucher("pf1", fgParty, "PF-1", td, "6.00"))
	if el := time.Since(t0); r["ok"] != true || el > 3*time.Second {
		t.Fatalf("the posting during the light check: %v in %s", r, el)
	}
	<-done
	if logLines("a background read was stopped at once so FinCom's request goes first") < 1 {
		t.Fatal("the light check's request was not stopped for the posting")
	}
	ids := f.ids()[n0:]
	imp := -1
	for i, id := range ids {
		if id == "Import" {
			imp = i
		}
	}
	if imp < 0 || ids[0] != "FinComCompany" {
		t.Fatalf("requests: %v", ids)
	}
	// the next turn: the light check goes again (it was not marked as done), after the import
	lightCheckOpen(sessions)
	ids = f.ids()[n0:]
	if ids[len(ids)-1] != "FinComCompany" || len(ids)-1 <= imp {
		t.Fatalf("the light check did not go again after the posting: %v", ids)
	}
}

// --- 11. the owner's decision (04-Oct-2026): with ReadDays off, FinCom's direct reads of entries do not reach Tally
// either: /daybook, /vouchers and /keepcheck are refused with 409 and the words; /ledgerlines answers from the copy only
func TestDirectReadsRefusedWhenReadDaysOff(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "D-1", "sale", "-1.00")
	standBridge(t, f, `,"Key":"tray-test-key","ReadDays":false`)
	_ = findCompanyPortQuiet(zz)
	n0 := f.n("")
	q := "?company=" + strings.ReplaceAll(zz, " ", "%20")
	for _, p := range []string{"/daybook" + q + "&from=" + td + "&to=" + td, "/vouchers" + q + "&from=" + td + "&to=" + td, "/keepcheck" + q + "&ym=" + td[:6], "/tags" + q + "&from=" + td + "&to=" + td} {
		code, res := callLocal(t, "GET", p, "", "")
		if code != 409 || str(res["error"]) != readsOffWords {
			t.Fatalf("%s: %d %v (want 409 and the words)", p, code, res)
		}
	}
	// /ledgerlines: no copy covers the period: said in the answer, Tally not asked
	code, res := callLocal(t, "GET", "/ledgerlines"+q+"&ledger="+fgParty+"&from="+td+"&to="+td, "", "")
	if code != 200 || res["ok"] != true || str(res["via"]) != "copy" || len(arr(res["vouchers"])) != 0 || !strings.Contains(str(res["note"]), "the copy here does not cover") {
		t.Fatalf("/ledgerlines without a copy: %d %v", code, res)
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("Tally was asked %v with ReadDays off", got)
	}
	// the copy covers it: answered from the copy as before
	liveFrom(td)
	writeDayFile(syncFolder(zz), td, "<TALLYMESSAGE>"+(&tVch{guid: "c-1", master: "1", date: td, typ: "Journal", no: "1", narr: "x", party: fgParty, alter: 1,
		lines: [][2]string{{fgParty, "-5.00"}, {"Sales", "5.00"}}}).xml()+"</TALLYMESSAGE>", false)
	code, res = callLocal(t, "GET", "/ledgerlines"+q+"&ledger="+fgParty+"&from="+td+"&to="+td, "", "")
	if code != 200 || str(res["via"]) != "copy" || len(arr(res["vouchers"])) != 1 {
		t.Fatalf("/ledgerlines from the copy: %d %v", code, res)
	}
	if got := f.ids()[n0:]; len(got) != 0 {
		t.Fatalf("Tally was asked %v with ReadDays off", got)
	}
	// the person-started read test is the one exception
	if _, err := runReadTest(zz); err != nil || f.n("Day Book") == 0 {
		t.Fatalf("the read test with ReadDays off: %v %v", err, f.ids())
	}
}

func findCompanyPortQuiet(c string) error { _, err := findCompanyPort(c, 0); return err }
