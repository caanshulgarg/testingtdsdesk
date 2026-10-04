package main

// Plan item 7: the allow-list of requests to Tally. Every request the bridge can send is driven through a stand-in
// Tally; each one must be on the list, none may ask Tally for a figure it computes, an unknown one is refused before
// anything is sent, and the table must match docs/tally-allowlist.md (the measured table).

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// every request builder, run against the stand-in Tally: the bodies Tally received
func driveEveryRequest(t *testing.T) *standTally {
	t.Helper()
	td := today()
	f := newStandTally(t)
	for i := 0; i < 4; i++ {
		f.add(td, fgParty, fmt.Sprint("D-", i), fmt.Sprintf("sale | TDSDesk:d%d", i), "-2.00")
	}
	f.addLed("Ledger A", "Sundry Debtors", "0.00")
	standBridge(t, f, "")
	oldDaysOn() // round 19: ReadDays on: every builder is driven, the dated ones too (refused with it off)
	liveFrom(td)
	must := func(what string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}
	// companies, company info, company check
	_, err := findCompanyPort(zz, 0)
	must("companies", err)
	_, err = companyCheck(fin, zz, f.port)
	must("company check", err)
	// day book, voucher heads, the copy's check list
	_, err = getDayBookXML(fin, zz, td, td, f.port)
	must("day book", err)
	_, err = voucherHeads(fin, f.port, zz, td, td)
	must("voucher heads", err)
	_, err = keepList(fin, zz, f.port, td, td, 0)
	must("keep list", err)
	// ledger chunk, groups, FinCom's ledger reads, names
	_, _, err = readLedgerChunk(fin, zz, f.port, 0, 2000)
	must("ledger chunk", err)
	_, err = readGroupList(fin, zz, f.port)
	must("groups", err)
	_, err = getLedgers(zz, f.port)
	must("ledgers", err)
	_, err = getLedgerNames(fin, zz, f.port)
	must("names", err)
	_, err = getVouchers(zz, td, td, "", "", f.port)
	must("vouchers", err)
	// a posting (the import alone, round 15); the reads kept for Check Tally and the read test; then a deletion
	if r := postOne(t, "every1", finVoucher("every1", fgParty, "EV-1", td, "3.00")); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	_, err = vouchersOnDate(f.port, zz, td, fgParty)
	must("dup check", err)
	_, err = tagsOnDate(f.port, zz, td)
	must("tag check", err)
	_, err = voucherByMaster(f.port, zz, td, "1")
	must("voucher-id check", err)
	// 2.2.0: the recorder's body fetch (the entries just changed, by MasterID, the line's own date)
	_, err = fetchVouchersByMaster(&TC{copier: true}, zz, f.port, td, []string{"1"})
	must("body fetch", err)
	// 2.2.0: source C's month slice, the read test's date-form probe and Edit Log probe
	_, err = invokeTally(&TC{copier: true}, f.port, sliceRequest(zz, formPlain, td[:6], 0), 20)
	must("month slice", err)
	measuring.Add(1)
	_, err = invokeTally(readTestTC, f.port, datesProbeRequest(zz, collFilterBtw, td, td), 20)
	must("dates probe", err)
	_, err = invokeTally(readTestTC, f.port, editLogProbeRequest(zz, "1"), 20)
	must("edit log probe", err)
	measuring.Add(-1)
	_, err = removeTallyVoucher(f.port, zz, "g-1", "1", "Journal", td, "D-0")
	must("delete", err)
	// the measuring tool (before Update now: with no copy here it reads the year's dates) and its snapshot
	_, err = runMeasure(measureOpts{company: zz, ledgers: "1-2"})
	must("measure", err)
	// Update now
	runNow(t, "now")
	_, err = measureSnapshot(measureOpts{company: zz, snapshot: "every"})
	must("snapshot", err)
	// the small checks after a timeout: with a company (FinComCompany) and without (FinComFree)
	start := time.Now()
	setProbeAfterTimeout(f.port)
	nowFn = func() time.Time { return start.Add(2 * time.Minute) }
	_, err = invokeTally(fin, f.port, companiesRequest(), 0)
	must("free probe", err)
	nowFn = time.Now
	return f
}

func TestEveryRequestOnList(t *testing.T) {
	// each builder's request, as the table fingerprints it
	samples := allowListSamples()
	for id := range tallyAllowList {
		if _, ok := samples[id]; !ok {
			t.Errorf("%s is on the list but no builder makes it (allowListSamples)", id)
		}
	}
	for id, x := range samples {
		if got := tallyRequestID(x); got != id {
			t.Errorf("the builder for %s makes a request with the id %q", id, got)
		}
		measuring.Add(1)
		err := checkAllowed(x)
		measuring.Add(-1)
		if err != nil {
			t.Errorf("%s: %v", id, err)
		}
	}
	// every request actually sent, driving every path
	f := driveEveryRequest(t)
	if n := logLines("refused: The request"); n != 0 {
		t.Fatalf("%d request(s) refused while driving the bridge's own requests", n)
	}
	seen := map[string]bool{}
	f.mu.Lock()
	for i, b := range f.bodies {
		id := tallyRequestID(b)
		if _, ok := tallyAllowList[id]; !ok {
			t.Errorf("request %d (%s) is not on the allow-list", i, id)
		}
		seen[id] = true
	}
	f.mu.Unlock()
	var missing []string
	for id := range tallyAllowList {
		if !seen[id] {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("driving every request did not send %v: a builder is not driven, or the id is dead", missing)
	}
}

func TestUnknownRequestRefused(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
	n0, s0 := f.n(""), tallySent.Load()
	bad := map[string]string{
		"unknown id":        collectionRequest("FinComEvil", "Ledger", "NAME", zz, ""),
		"no id":             "<ENVELOPE><HEADER><TALLYREQUEST>Export</TALLYREQUEST></HEADER><BODY></BODY></ENVELOPE>",
		"a computed report": strings.Replace(dayBookRequest(zz, "20260401", "20260430"), "<REPORTNAME>Day Book</REPORTNAME>", "<REPORTNAME>Trial Balance</REPORTNAME>", 1),
		"smuggled":          collectionRequest(tagCheckID, "Voucher", "GUID", zz, `</COLLECTION><COLLECTION NAME="FinComOther" ISMODIFY="No"><TYPE>Ledger</TYPE>`),
		"day book renamed":  strings.Replace(dayBookRequest(zz, "20260401", "20260430"), "<STATICVARIABLES>", "<ID>Day Book</ID><REPORTNAME>Ledger Vouchers</REPORTNAME><STATICVARIABLES>", 1),
		"measure-only":      measureReqD(zz, "20260401", "20260430"),
	}
	for name, x := range bad {
		_, err := invokeTally(fin, f.port, x, 0)
		if err == nil || !strings.Contains(err.Error(), "allow-list") || !strings.Contains(err.Error(), "nothing was sent") {
			t.Errorf("%s: not refused: %v", name, err)
		}
	}
	if f.n("") != n0 || tallySent.Load() != s0 {
		t.Fatalf("a refused request reached Tally: %v", f.ids()[n0:])
	}
	if logLines("refused: The request FinComEvil is not on the bridge's allow-list") != 1 {
		t.Fatal("the refusal is not in the log")
	}
	// an allowed request still goes
	if _, err := invokeTally(fin, f.port, tagCheckRequest(zz, "20260401"), 0); err != nil || f.n(tagCheckID) != 1 {
		t.Fatalf("an allowed request: %v", err)
	}
}

// a figure Tally works out: a balance for a period, a trial balance, profit and loss, the Ledger Vouchers report, a $$
// function (other than $$SysName), a ledger's own list, an on-account value
var reComputed = []*regexp.Regexp{
	regexp.MustCompile(`(?i)trial\s*balance`),
	regexp.MustCompile(`(?i)profit`),
	regexp.MustCompile(`(?i)balance\s*sheet|group\s*summary`),
	regexp.MustCompile(`(?i)ledger\s*vouchers`),
	regexp.MustCompile(`(?i)childof`),
	regexp.MustCompile(`(?i)on\s*account`),
	regexp.MustCompile(`(?i)vouchers\s*:\s*ledger`),
}
var reDollar = regexp.MustCompile(`\$\$(\w+)`)
var reBalField = regexp.MustCompile(`(?i)(closing|opening)\s*balance`)

func computedFigure(x string) string {
	for _, r := range reComputed {
		if m := r.FindString(x); m != "" {
			return m
		}
	}
	// 2.2.0 (the owner's date forms; round 2 R2-12): inside a request's Formulae only, the exact shapes of a date literal
	// ($$Date:"d-MMM-yyyy") and of the period comparison ($$IsBetween:$Date:<literal>:<literal>) compute no figure; they
	// are taken out before the $$ check, and any other use of $$Date or $$IsBetween is caught
	lit := `\$\$Date:&#34;\d{1,2}-[A-Z][a-z]{2}-\d{4}&#34;`
	shapes := regexp.MustCompile(`\$\$IsBetween:\$Date:` + lit + `:` + lit + `|` + lit)
	y := regexp.MustCompile(`(?s)<SYSTEM TYPE="Formulae"[^>]*>.*?</SYSTEM>`).ReplaceAllStringFunc(x, func(b string) string { return shapes.ReplaceAllString(b, "") })
	for _, m := range reDollar.FindAllStringSubmatch(y, -1) {
		if m[1] != "SysName" {
			return m[0]
		}
	}
	if m := reBalField.FindString(x); m != "" && (strings.Contains(x, "SVFROMDATE") || strings.Contains(x, "SVTODATE")) {
		return m + " with a period"
	}
	if m := regexp.MustCompile(`(?i)closing\s*balance`).FindString(x); m != "" {
		return m
	}
	return ""
}

func TestNoComputedFigure(t *testing.T) {
	// the check itself catches each kind
	for _, x := range []string{"<REPORTNAME>Trial Balance</REPORTNAME>", "<FETCH>NAME, CLOSINGBALANCE</FETCH>", "<SVFROMDATE>20260401</SVFROMDATE><FETCH>OPENINGBALANCE</FETCH>",
		"<REPORTNAME>Ledger Vouchers</REPORTNAME>", "$$ClosingBalance:Ledger", "<CHILDOF>X</CHILDOF>", "<FETCH>OnAccountValue</FETCH>", "Profit and Loss"} {
		if computedFigure(x) == "" {
			t.Fatalf("the check misses %q", x)
		}
	}
	if m := computedFigure(measureReqLedO(zz, "Ledger 01")); m != "" {
		t.Fatalf("a master's stored opening, no period, is not computed: %q", m)
	}
	for id, x := range allowListSamples() {
		if m := computedFigure(x); m != "" {
			t.Errorf("%s asks for a computed figure (%q)", id, m)
		}
	}
	f := driveEveryRequest(t)
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, b := range f.bodies {
		if m := computedFigure(b); m != "" {
			t.Errorf("request %d (%s) asks for a computed figure (%q): %s", i, f.reqs[i], m, cut(b, 300))
		}
	}
}

// the table in docs/tally-allowlist.md, between its markers
func docAllowList(t *testing.T) (rows, hash string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "docs", "tally-allowlist.md"))
	if err != nil {
		t.Fatalf("docs/tally-allowlist.md: %v", err)
	}
	s := strings.ReplaceAll(string(b), "\r\n", "\n")
	a, z := strings.Index(s, "<!-- allowlist:begin -->\n"), strings.Index(s, "<!-- allowlist:end -->")
	if a < 0 || z < a {
		t.Fatal("docs/tally-allowlist.md has no table between <!-- allowlist:begin --> and <!-- allowlist:end -->")
	}
	rows = s[a+len("<!-- allowlist:begin -->\n") : z]
	hash = group(`Table hash \(SHA-256\): ([0-9a-f]{64})`, s, 1)
	return
}

func TestAllowListUnchanged(t *testing.T) {
	rows, hash := docAllowList(t)
	want := allowListRows()
	if allowListHash(rows) != allowListHash(want) || hash != allowListHash(want) {
		t.Fatalf("the allow-list in allowlist.go (or a request's shape) differs from docs/tally-allowlist.md: a new or changed "+
			"request is measured on ZZ BIG TEST again and the doc updated.\nThe table now:\n%s\nTable hash (SHA-256): %s\n(doc hash %s)", want, allowListHash(want), hash)
	}
}
