package main

// Plan item 9: the size test, on every build (go test -run Size). A made-up company of 50,000 ledgers and 200,000
// vouchers, generated in memory. The fake Tally works out, for every request, how many rows Tally would send back and
// the time that would take (rows x tallyPerRowMs, allowlist.go) without sleeping; the test fails when a request would
// take more than 20 s, asks for more than 2,000 ledgers, or for more than one month of entries.
//
// The limit of this test: it proves the bridge's requests stay small. Real Tally's time is proven only by the NWS144
// measurement (docs/tally-measure-sheet.txt), which also replaces tallyPerRowMs.
//
// To keep the test fast, voucher requests are answered with their row count simulated but no voucher sent back (the
// bridge's handling of entries is covered by the other tests); ledger requests get their real rows.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	bigLedgers  = 50000
	bigVouchers = 200000
	bigFrom     = "20260401" // the books' year
	bigDays     = 365
)

type simReq struct {
	id       string
	rows     int
	simMs    float64
	ledgers  int // ledger rows asked
	spanDays int // the period asked, in days (0: none)
}

type bigTally struct {
	mu     sync.Mutex
	perDay []int // vouchers on each day of the year
	reqs   []simReq
}

func newBigTally() *bigTally {
	b := &bigTally{perDay: make([]int, bigDays)}
	for i := 0; i < bigVouchers; i++ {
		// more entries at month and quarter ends, as in real books
		d := (i*7919 + (i%13)*31) % bigDays
		if i%10 == 0 {
			d = (d/30)*30 + 29
			if d >= bigDays {
				d = bigDays - 1
			}
		}
		b.perDay[d]++
	}
	return b
}

func bigDayIndex(d string) int {
	return int(fromTallyDate(d).Sub(fromTallyDate(bigFrom)).Hours() / 24)
}

// the vouchers from a to z (yyyymmdd), within the year
func (b *bigTally) vouchersIn(a, z string) int {
	if a == "" {
		a = bigFrom
	}
	if z == "" {
		z = addDays(bigFrom, bigDays-1)
	}
	n := 0
	for i := maxI(0, bigDayIndex(a)); i <= minI(bigDays-1, bigDayIndex(z)); i++ {
		n += b.perDay[i]
	}
	return n
}

func (b *bigTally) handle(w http.ResponseWriter, r *http.Request, id, body string) bool {
	from, to := group(`<SVFROMDATE>(\d{8})</SVFROMDATE>`, body, 1), group(`<SVTODATE>(\d{8})</SVTODATE>`, body, 1)
	sr := simReq{id: id}
	if from != "" && to != "" {
		sr.spanDays = int(fromTallyDate(to).Sub(fromTallyDate(from)).Hours()/24) + 1
	}
	var out strings.Builder
	out.WriteString("<ENVELOPE><BODY><DATA><COLLECTION>")
	isLedger := strings.Contains(body, "<TYPE>Ledger</TYPE>")
	switch {
	case id == "Import":
		sr.rows = 1
		out.Reset()
		out.WriteString("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>")
		b.record(sr)
		_, _ = w.Write([]byte(out.String()))
		return true
	case strings.Contains(body, "<TYPE>Company</TYPE>"):
		sr.rows = 1
		fmt.Fprintf(&out, `<COMPANY NAME="%s"><NAME>%s</NAME><GUID>big-guid</GUID><STARTINGFROM>%s</STARTINGFROM><ENDINGAT>20270331</ENDINGAT><ALTVCHID>%d</ALTVCHID><ALTMSTID>%d</ALTMSTID></COMPANY>`,
			zz, zz, bigFrom, bigLedgers+bigVouchers, bigLedgers+40)
	case isLedger:
		var after, upto int64 = 0, 1 << 62
		if m := reMidRange.FindStringSubmatch(body); m != nil {
			after = toI64(m[1])
			if m[2] != "" {
				upto = toI64(m[2])
			}
		} else if strings.Contains(body, "$Name =") || strings.Contains(body, "$Name = ") {
			after, upto = 0, 1 // one ledger by name
		}
		for mid := maxI64(after+1, 41); mid <= upto && mid <= bigLedgers+40; mid++ {
			sr.rows++
			fmt.Fprintf(&out, `<LEDGER NAME="Big Party %05d"><GUID>big-led-%d</GUID><MASTERID> %d</MASTERID><ALTERID> %d</ALTERID><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>0.00</OPENINGBALANCE></LEDGER>`,
				mid-40, mid, mid, mid)
		}
		sr.ledgers = sr.rows
	case strings.Contains(body, "<TYPE>Group</TYPE>"):
		sr.rows = 40
		for i := 1; i <= 40; i++ {
			fmt.Fprintf(&out, `<GROUP NAME="Big Group %02d"><GUID>big-grp-%d</GUID><MASTERID> %d</MASTERID><PARENT></PARENT></GROUP>`, i, i, i)
		}
	default: // vouchers: a collection of Voucher or the Day Book
		sr.rows = b.vouchersIn(from, to)
		if strings.Contains(body, "$PartyLedgerName") {
			sr.rows = (sr.rows + 99) / 100 // one party's entries on the date
		}
		if id == "Day Book" {
			out.Reset()
			out.WriteString("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
			b.record(sr)
			_, _ = w.Write([]byte(out.String()))
			return true
		}
	}
	out.WriteString("</COLLECTION></DATA></BODY></ENVELOPE>")
	b.record(sr)
	_, _ = w.Write([]byte(out.String()))
	return true
}

func maxI64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func (b *bigTally) record(sr simReq) {
	sr.simMs = float64(sr.rows) * tallyPerRowMs
	b.mu.Lock()
	b.reqs = append(b.reqs, sr)
	b.mu.Unlock()
}

func TestSizeBigCompany(t *testing.T) {
	t0 := time.Now()
	big := newBigTally()
	f := newStandTally(t)
	f.behave = big.handle
	standBridge(t, f, `,"KeepBudgetSec":600`)
	liveFrom(bigFrom)
	td := today()

	// Update now, then the nightly run: the ledger list and the day book of the year so far
	runNow(t, "now")
	runNow(t, "nightly")
	// FinCom's reads: the ledger lists, a ledger's entries for the year, the day book, the voucher list, a month's check
	if _, err := getLedgers(zz, f.port); err != nil {
		t.Fatalf("/ledgers: %v", err)
	}
	if r, err := getLedgerNames(fin, zz, f.port); err != nil || len(arr(r["ledgers"])) != bigLedgers {
		t.Fatalf("/ledgernames: %v (%d ledgers)", err, len(arr(r["ledgers"])))
	}
	if _, err := getVouchers(zz, bigFrom, td, "", "", f.port); err != nil {
		t.Fatalf("/vouchers for the year: %v", err)
	}
	if _, err := getLedgerLines(zz, "Big Party 00001", bigFrom, td, f.port); err != nil {
		t.Fatalf("/ledgerlines for the year: %v", err)
	}
	if _, err := getDayBookXML(fin, zz, td[:6]+"01", td, f.port); err != nil {
		t.Fatalf("/daybook for a month: %v", err)
	}
	if _, err := readTest(zz, f.port); err != nil {
		t.Fatalf("/readtest: %v", err)
	}
	if _, err := testKeepMonth(zz, td[:6], f.port); err != nil {
		t.Fatalf("the month's check: %v", err)
	}
	// more than a month at once is refused, nothing sent
	n0 := len(big.reqs)
	if _, err := getDayBookXML(fin, zz, bigFrom, td, f.port); err == nil {
		t.Fatal("/daybook for half a year was not refused")
	}
	if _, err := voucherHeads(fin, f.port, zz, bigFrom, td); err == nil {
		t.Fatal("the voucher list for half a year was not refused")
	}
	if len(big.reqs) != n0 {
		t.Fatal("a refused read reached Tally")
	}
	// a posting: its checks are one date
	if r := postOne(t, "big1", finVoucher("big1", fgParty, "BIG-1", td, "1.00")); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}

	big.mu.Lock()
	reqs := append([]simReq{}, big.reqs...)
	big.mu.Unlock()
	var longest simReq
	total, ledRows := 0.0, 0
	for i, r := range reqs {
		total += r.simMs
		ledRows += r.ledgers
		if r.simMs > longest.simMs {
			longest = r
		}
		if r.simMs > 20000 {
			t.Errorf("request %d (%s) would hold Tally %.1f s (%d rows at %.2f ms): over 20 s", i, r.id, r.simMs/1000, r.rows, tallyPerRowMs)
		}
		if r.ledgers > 2000 {
			t.Errorf("request %d (%s) asks for %d ledgers (2,000 at most)", i, r.id, r.ledgers)
		}
		if r.spanDays > 31 {
			t.Errorf("request %d (%s) asks for %d days of entries (one month at most)", i, r.id, r.spanDays)
		}
	}
	if ledRows < 3*bigLedgers {
		t.Fatalf("the ledger lists were not read in full (%d ledger rows)", ledRows)
	}
	t.Logf("%d requests; the longest %s, %d rows, %.1f s simulated; all requests %.0f s simulated; real time %s",
		len(reqs), longest.id, longest.rows, longest.simMs/1000, total/1000, time.Since(t0).Round(time.Millisecond))
	if el := time.Since(t0); el > 60*time.Second {
		t.Fatalf("the size test took %s (60 s at most)", el)
	}
}
