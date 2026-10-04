// Round 13 (03-Oct-2026): "Test reading from Tally", a tray item. On the owner's computer the Day Book export (the
// request the copier reads with) answers a whole envelope and no voucher for every month of a company with entries,
// while the TDL collections (the ledger list, FinComTag, the posting's read-back) list them. Only the tray can be used
// there, so the bridge gathers the evidence itself: for one day (the newest the copy holds an entry for), the Day Book
// with yyyymmdd dates, the Day Book with d-MMM-yyyy dates and the FinComTag collection, one after the other, each with
// its count, size, time and head (tags only) in the log. Nothing is written: no day file, no mark, no cloud queue, no
// state; nothing goes to the cloud. Round 18 (2.1.9): the full matrix on an anchor day (runReadTest); it still changes
// nothing.
package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// 13b: as the measuring tool (measure.go startMeasure): the tray's POST starts the test in the bridge and is answered at
// once; its GET says how far it is; the tray polls (the three requests, each up to 60 s plus the wait for Tally behind a
// copier or posting request, can outlast one tray call)
// round 19 (review finding 1): the read test is a person's (the tray item): the one exception to ReadDays off
var readTestTC = &TC{person: true}

var (
	readTestMu   sync.Mutex
	readTestLast M
)

// POST /tray/readtest: {ok, started, company, day} at once; {ok:false} while one runs or when no company is open
func startReadTest(company string) M {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return M{"ok": false, "error": "No company is open in Tally: open the company to test, then try again."}
	}
	readTestMu.Lock()
	defer readTestMu.Unlock()
	if readTestLast != nil && str(readTestLast["state"]) == "running" {
		return M{"ok": false, "error": "A test is already running; wait for its message box."}
	}
	d := readTestDay(company)
	readTestLast = M{"ok": true, "state": "running", "company": company, "day": d, "at": nowS()}
	go func() {
		r, err := runReadTest(company)
		readTestMu.Lock()
		defer readTestMu.Unlock()
		if err != nil {
			readTestLast = M{"ok": false, "state": "failed", "error": err.Error(), "company": company, "day": d, "at": nowS()}
			return
		}
		r["state"] = "done"
		readTestLast = r
	}()
	return M{"ok": true, "started": true, "company": company, "day": d}
}

// POST /tray/readtest {preview: true}: the company the test would read (the tray names it in a yes/no); nothing is sent
func readTestPreview(company string) M {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return M{"ok": false, "error": "No company is open in Tally: open the company to test, then try again."}
	}
	return M{"ok": true, "company": company, "day": readTestDay(company)}
}

// GET /tray/readtest: {state: none | running | done | failed, ...the result when done, error when failed}
func readTestStatus() M {
	readTestMu.Lock()
	defer readTestMu.Unlock()
	if readTestLast == nil {
		return M{"ok": true, "state": "none"}
	}
	return readTestLast
}

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

// round 18 (2.1.9): the anchor day: the newest date among the entries FinComTag lists (FinComTag with any date answers
// Tally's current period on NWS144; on a Tally that applies the date it lists today's); else the newest day of the copy
// that holds an entry, else today. days: how many entries FinComTag listed on each date
func readTestAnchor(port int, company string) (string, map[string]int) {
	days := map[string]int{}
	anchor := ""
	if raw, err := invokeTally(readTestTC, port, tagCheckRequest(company, today()), 60); err == nil {
		for _, v := range reVoucher.FindAllString(raw, -1) {
			if d := group(`<DATE>(\d{8})</DATE>`, v, 1); d != "" {
				days[d]++
				if d > anchor {
					anchor = d
				}
			}
		}
	}
	if anchor == "" {
		return readTestDay(company), map[string]int{}
	}
	return anchor, days
}

var reVoucher = re(`<VOUCHER\b[\s\S]*?</VOUCHER>`)

// a day FinComTag's list shows with no entry, inside the list's span, the nearest before the anchor ("" when none): a
// form that answers it with entries ignores the period
func readTestEmptyDay(anchor string, days map[string]int) string {
	first := anchor
	for d := range days {
		if d < first {
			first = d
		}
	}
	for d := addDays(anchor, -1); d >= first; d = addDays(d, -1) {
		if days[d] == 0 {
			return d
		}
	}
	return ""
}

// every voucher of a Day Book answer is dated d (and there is at least one)
func onlyDay(raw, d string) bool {
	vs := reVoucher.FindAllString(raw, -1)
	if len(vs) == 0 {
		return false
	}
	for _, v := range vs {
		if group(`<DATE>(\d{8})</DATE>`, v, 1) != d {
			return false
		}
	}
	return true
}

// the read test, one request at a time, through the same gate as FinCom's reads (one request to Tally at a time); each
// answer counted and its head logged, nothing kept. Round 18 (2.1.9): the full matrix on the anchor day: the Day Book in
// the four date forms (each that answers the day with only that day's entries is asked an empty day too), FinComTag,
// FinComCompany (the change numbers), one measurement of the entries above the starting point with no dates, and
// FinComCompany sent as UTF-16 and as UTF-8 (when TallyRequestUTF16 is off). It logs which form answered the anchor day
// with exactly its entries; nothing goes to the cloud. 2.2.0 (the owner's additions): the collection date forms on a
// past-year month, the first that passes KEPT per company and Tally program (sync\date-forms.json, for source C), and
// one Edit Log probe (recorder_probes.go). Run by startReadTest (one at a time); callable directly too
func runReadTest(company string) (M, error) {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return nil, errors.New("No company is open in Tally: open the company to test, then try again.")
	}
	// as the measuring tool runs: a slow answer here is evidence, not a reason for the self-watch to stop reading
	measuring.Add(1)
	defer measuring.Add(-1)
	port, err := findCompanyPort(company, 0)
	if err != nil {
		return nil, err
	}
	d, days := readTestAnchor(port, company)
	empty := readTestEmptyDay(d, days)
	pre := "Test reading from Tally: " + company + ", " + d + ": "
	results := []any{}
	ask := func(label, x string, tc *TC) (M, string) {
		t0 := time.Now()
		raw, err := invokeTally(tc, port, x, 60)
		sec := time.Since(t0).Seconds()
		if err != nil {
			writeLog(pre + label + ": not answered (" + err.Error() + ")")
			m := M{"label": label, "vouchers": 0, "bytes": 0, "seconds": sec, "head": "", "error": err.Error()}
			results = append(results, m)
			return m, ""
		}
		n, head := countVouchers(raw), answerHead(raw)
		writeLog(fmt.Sprintf("%s%s: %d vouchers, %d bytes, %.1f s; head: %s", pre, label, n, len(raw), sec, head))
		m := M{"label": label, "vouchers": n, "bytes": len(raw), "seconds": sec, "head": head, "error": ""}
		results = append(results, m)
		return m, raw
	}
	passed := ""
	for _, form := range dateForms {
		m, raw := ask("Day Book, dates "+form, dayBookRequestForm(company, form, d, d), readTestTC)
		ok := raw != "" && dayBookIncomplete(raw) == "" && onlyDay(raw, d)
		if ok && empty != "" {
			// the same form for a day the list shows empty: it must answer none (the period applied, not ignored)
			raw2, err := invokeTally(readTestTC, port, dayBookRequestForm(company, form, empty, empty), 60)
			n2 := countVouchers(raw2)
			ok = err == nil && dayBookIncomplete(raw2) == "" && n2 == 0
			m["emptyDay"], m["emptyDayVouchers"] = empty, n2
			writeLog(fmt.Sprintf("%sDay Book, dates %s, the empty day %s: %d vouchers%s", pre, form, empty, n2, map[bool]string{true: "", false: " (or not answered in full)"}[ok]))
		}
		m["passed"] = ok
		writeLog(fmt.Sprintf("%sDay Book, dates %s answers the day with exactly its entries: %s", pre, form, map[bool]string{true: "yes", false: "no"}[ok]))
		if ok && passed == "" {
			passed = form
			m["entries"] = countVouchers(raw)
		}
	}
	if passed != "" {
		n := 0
		for _, x := range results {
			if str(obj(x)["label"]) == "Day Book, dates "+passed {
				n = toInt(obj(x)["vouchers"])
			}
		}
		writeLog(fmt.Sprintf("%sDates on this Tally: %s (anchor %s, %d entries)", pre, passed, d, n))
	} else {
		passed = "none"
		writeLog(fmt.Sprintf("%sDates on this Tally: none of the %d forms answered %s with exactly its entries", pre, len(dateForms), d))
	}
	_, traw := ask("FinComTag (the posting read-back's request)", tagCheckRequest(company, d), readTestTC) // also the Edit Log probe's entry when none is above the starting point
	// the change numbers, read here without being kept (the starting point is not touched by the test)
	cm, craw := ask("FinComCompany (change numbers)", companyCheckRequest(company), readTestTC)
	altV, altM := int64(-1), int64(-1)
	for _, c := range xmlDoc(craw).All("COMPANY") {
		if n := nameOf(c); n == "" || sameCompany(n, company) {
			altV, altM = toI64(re(`\D`).ReplaceAllString(nt(c, "ALTVCHID"), "")), toI64(re(`\D`).ReplaceAllString(nt(c, "ALTMSTID"), ""))
			cm["altvchid"], cm["altmstid"] = altV, altM
			writeLog(fmt.Sprintf("%schange numbers ALTVCHID=%d, ALTMSTID=%d", pre, altV, altM))
			break
		}
	}
	// 2.2.0 (the owner's finding): the change numbers' report form too, its head in the log as every answer's
	ask("FinComCompanyNumbers (change numbers, form b: the report)", companyNumbersRequest(company), readTestTC)
	// measurement only: the entries above the starting point, the AlterID filter alone, no dates
	after, how := startPointOf(company)
	kraw := ""
	if how {
		_, kraw = ask(fmt.Sprintf("Entries above the starting point (TDSDeskKeepList, AlterID above %d, no dates)", after), keepListAboveRequest(company, after), readTestTC)
	} else {
		// round 5 R5-1: never without a starting point (a list above anything lower is a full read)
		why := "not sent: no starting point is recorded (Tally gave no change numbers yet)"
		writeLog(pre + "Entries above the starting point (TDSDeskKeepList): " + why)
		results = append(results, M{"label": "Entries above the starting point (TDSDeskKeepList)", "vouchers": 0, "bytes": 0, "seconds": 0.0, "head": "", "error": why})
	}
	_ = altV
	// 2.2.0 (the owner's additions A and C): the collection date forms on a past-year month (the first that passes is
	// kept for source C), then Tally's program and one Edit Log probe for the newest changed entry
	readTestCollectionForms(port, company)
	readTestEditLogProbe(port, company, kraw, traw)
	// item 89: FinComCompany sent once as UTF-16 and once as UTF-8 (when the bridge sends UTF-8)
	if !cfgB("TallyRequestUTF16") {
		const lb = "FinComCompany sent as UTF-16 and as UTF-8"
		a, e1 := invokeTally(&TC{enc: "utf-16", person: true}, port, companyCheckRequest(company), 60)
		b, e2 := invokeTally(&TC{enc: "utf-8", person: true}, port, companyCheckRequest(company), 60)
		m := M{"label": lb, "bytes16": len(a), "bytes8": len(b), "same": e1 == nil && e2 == nil && a == b, "error": ""}
		switch {
		case e1 != nil || e2 != nil:
			m["error"] = fmt.Sprint(e1, " / ", e2)
			writeLog(fmt.Sprintf("%s%s: not answered (UTF-16: %v; UTF-8: %v)", pre, lb, e1, e2))
		case a == b:
			writeLog(fmt.Sprintf("%s%s: the same answer (%d bytes)", pre, lb, len(a)))
		default:
			writeLog(fmt.Sprintf("%s%s: different answers (%d and %d bytes)", pre, lb, len(a), len(b)))
		}
		results = append(results, m)
	}
	return M{"ok": true, "company": company, "day": d, "emptyDay": empty, "passed": passed, "results": results}, nil
}

func maxI64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
