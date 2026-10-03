// Round 13 (03-Oct-2026): "Test reading from Tally", a tray item. On the owner's computer the Day Book export (the
// request the copier reads with) answers a whole envelope and no voucher for every month of a company with entries,
// while the TDL collections (the ledger list, FinComTag, the posting's read-back) list them. Only the tray can be used
// there, so the bridge gathers the evidence itself: for one day (the newest the copy holds an entry for), the Day Book
// with yyyymmdd dates, the Day Book with d-MMM-yyyy dates and the FinComTag collection, one after the other, each with
// its count, size, time and head (tags only) in the log. Nothing is written: no day file, no mark, no cloud queue, no
// state; nothing goes to the cloud.
package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var readTestMu sync.Mutex

// the day to test with: the newest day file of the copy that holds a voucher; today when there is none
func readTestDay(company string) string {
	dir, err := companyDir(company)
	if err != nil {
		return today()
	}
	files := dayFiles(dir, "")
	for i := len(files) - 1; i >= 0; i-- {
		if countVouchers(readText(files[i])) > 0 {
			return strings.TrimSuffix(filepath.Base(files[i]), ".xml")
		}
	}
	return today()
}

// the three requests, one at a time, through the same gate as FinCom's reads (one request to Tally at a time); each
// answer counted and its head logged, nothing kept
func runReadTest(company string) (M, error) {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return nil, errors.New("No company is open in Tally: open the company to test, then try again.")
	}
	if !readTestMu.TryLock() {
		return nil, errors.New("A test is already running; wait for its message box.")
	}
	defer readTestMu.Unlock()
	// as the measuring tool runs: a slow answer here is evidence, not a reason for the self-watch to stop reading
	measuring.Add(1)
	defer measuring.Add(-1)
	port, err := findCompanyPort(company, 0)
	if err != nil {
		return nil, err
	}
	d := readTestDay(company)
	type probe struct{ label, x string }
	probes := []probe{
		{"Day Book, dates yyyymmdd", dayBookRequest(company, d, d)},
		{"Day Book, dates d-MMM-yyyy", dayBookRequestDMY(company, d, d)},
		{"FinComTag (the posting read-back's request)", tagCheckRequest(company, d)},
	}
	results := []any{}
	for _, p := range probes {
		t0 := time.Now()
		raw, err := invokeTally(fin, port, p.x, 60)
		sec := time.Since(t0).Seconds()
		pre := "Test reading from Tally: " + company + ", " + d + ": " + p.label + ": "
		if err != nil {
			writeLog(pre + "not answered (" + err.Error() + ")")
			results = append(results, M{"label": p.label, "vouchers": 0, "bytes": 0, "seconds": sec, "head": "", "error": err.Error()})
			continue
		}
		n, head := countVouchers(raw), answerHead(raw)
		writeLog(fmt.Sprintf("%s%d vouchers, %d bytes, %.1f s; head: %s", pre, n, len(raw), sec, head))
		results = append(results, M{"label": p.label, "vouchers": n, "bytes": len(raw), "seconds": sec, "head": head, "error": ""})
	}
	return M{"ok": true, "company": company, "day": d, "results": results}, nil
}
