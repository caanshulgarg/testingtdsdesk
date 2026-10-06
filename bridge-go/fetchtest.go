// 2.2.2 (05-Oct-2026, the owner's request): "Test fetching an entry", a tray item. On NWS144 the entry fetch (by type and
// number, then by MasterID) finds nothing, and PowerShell cannot be run there, so the six forms of
// docs/diagnostics/2.2.2-fetch-check.ps1 are sent by the bridge itself, for ONE voucher the person names (type, number,
// date), one at a time, through the same gate as every request (invokeTally: one request to Tally at a time), each capped
// at 25 s, never during a posting. Per form the log holds its letter and description, the period sent, the time taken,
// the number of vouchers, the ids of each (5 at most) and the first 400 characters of Tally's answer. Nothing is kept,
// nothing goes to the cloud.
//
//	A  FinComVoucherByNumber as the bridge sends it (&#34; quotes, SVFROMDATE/SVTODATE yyyymmdd)
//	B  A with plain " quote marks
//	C  FinComVoucherByMaster as the bridge sends it, for the MasterID found by B (else A, else F; else the person's)
//	D  C with no dates
//	E  C with the dates as d-MMM-yyyy TYPE="Date"
//	F  B with no dates
//
// Every form goes under a measure-only id of its own (FinComFetchTestA..F, allowlist.go): the bridge's own two ids are
// the narrow dated exceptions (a line waiting on them, within 3 days, a starting point recorded) and never go as a
// person's; A and C are otherwise byte for byte what voucherByNumberRequest and voucherByMasterRequest build. 2.3.1: every
// form carries the entry request's fetch as built (liveFetchField, with the ledger lines under an invoice's items), so the
// forms are the ps1's with that fetch; the ps1 stays the record of what 2.2.2 sent.
package main

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	fetchTestA   = "FinComFetchTestA"
	fetchTestB   = "FinComFetchTestB"
	fetchTestC   = "FinComFetchTestC"
	fetchTestD   = "FinComFetchTestD"
	fetchTestE   = "FinComFetchTestE"
	fetchTestF   = "FinComFetchTestF"
	fetchTestSec = 25 // each request's cap
)

// a person's (the tray item): the one way a dated measure-only request goes with ReadDays off
var fetchTestTC = &TC{person: true}

var fetchTestWhat = map[string]string{
	"A": "FinComVoucherByNumber as sent (&#34; quotes, dates yyyymmdd)",
	"B": "by number with plain quote marks, dates yyyymmdd",
	"C": "FinComVoucherByMaster as sent, MasterID %s (dates yyyymmdd)",
	"D": "by MasterID %s with no dates",
	"E": "by MasterID %s with the dates as d-MMM-yyyy TYPE=Date",
	"F": "by number with plain quote marks and no dates",
}

// one form's request ("" when its inputs cannot go: a type or number that cannot be in a TDL string, a date that is not
// yyyymmdd for a dated form, a MasterID that is not a number for C, D, E)
func fetchTestRequest(letter, company, date, typ, no, mid string) string {
	id := "FinComFetchTest" + letter
	byNumber := letter == "A" || letter == "B" || letter == "F"
	statics := ""
	switch letter {
	case "A", "B", "C", "E":
		if !isTallyDate(date) || normDate(tallyDMY(date)) != date {
			return ""
		}
		statics = periodVars(date, date)
		if letter == "E" {
			statics = dateVars(formDMYT, date, date)
		}
	case "D", "F":
	default:
		return ""
	}
	var filter string
	if byNumber {
		if !liveNumberText(typ) || !liveNumberText(no) {
			return ""
		}
		filter = `$VoucherNumber = "` + no + `" AND $VoucherTypeName = "` + typ + `"`
	} else {
		if mid == "" || len(mid) > 18 || onlyDigits(mid) != mid {
			return ""
		}
		filter = "$MasterID = " + mid
	}
	x := fcCollection(id, company, statics, "Voucher", liveFetchField, filter)
	if letter == "B" || letter == "F" {
		e := esc(filter)
		i := strings.LastIndex(x, e)
		x = x[:i] + strings.ReplaceAll(e, "&#34;", `"`) + x[i+len(e):]
	}
	return x
}

// the request rebuilt from its own parameters (pinned.go)
var reFetchTestNumber = regexp.MustCompile(`\$VoucherNumber = (?:&#34;|")(.*?)(?:&#34;|") AND \$VoucherTypeName = (?:&#34;|")(.*?)(?:&#34;|")</SYSTEM>`)

func fetchTestRebuild(letter string) func(string) []string {
	return pinOne(func(x string) string {
		a, _ := pinDates(x)
		typ, no := "", ""
		if m := reFetchTestNumber.FindStringSubmatch(x); m != nil {
			no, typ = html.UnescapeString(m[1]), html.UnescapeString(m[2])
		}
		return fetchTestRequest(letter, pinCo(x), a, typ, no, group(`\$MasterID = (\d+)</SYSTEM>`, x, 1))
	})
}

// the VOUCHER elements of an answer that are vouchers: with attributes, or holding a MASTERID (real TallyPrime 7.1 also
// answers a <VOUCHER>n</VOUCHER> counter inside CMPINFO)
var reFetchTestVch = regexp.MustCompile(`<VOUCHER(\s[^>]*)?>([\s\S]*?)</VOUCHER>`)

func fetchTestVouchers(raw string) []string {
	var o []string
	for _, m := range reFetchTestVch.FindAllStringSubmatch(raw, -1) {
		if strings.TrimSpace(m[1]) != "" || tagNum(m[2], "MASTERID") != "" {
			o = append(o, m[0])
		}
	}
	return o
}

func fetchTestCount(raw string) int { return len(fetchTestVouchers(raw)) }

// the ids of each voucher (5 at most): MASTERID, VOUCHERNUMBER, DATE, VOUCHERTYPENAME
func fetchTestIDs(raw string) string {
	vs := fetchTestVouchers(raw)
	var o []string
	for i, v := range vs {
		if i == 5 {
			o = append(o, fmt.Sprintf("(and %d more)", len(vs)-5))
			break
		}
		var f []string
		for _, k := range []string{"MASTERID", "VOUCHERNUMBER", "DATE", "VOUCHERTYPENAME"} {
			f = append(f, k+"="+tagValue(v, k))
		}
		o = append(o, strings.Join(f, " "))
	}
	return strings.Join(o, "; ")
}

// the first 400 characters of Tally's answer, white space collapsed (as the ps1 shows it)
func fetchTestHead(raw string) string {
	r := []rune(raw)
	if len(r) > 400 {
		r = r[:400]
	}
	return flat(string(r))
}

func fetchTestPeriodSent(x string) string {
	s := group(`(<SVFROMDATE[^>]*>[^<]*</SVFROMDATE><SVTODATE[^>]*>[^<]*</SVTODATE>)`, x, 1)
	if s == "" {
		return "no SVFROMDATE/SVTODATE"
	}
	return s
}

func vouchersWord(n int) string {
	if n == 1 {
		return "1 voucher"
	}
	return fmt.Sprintf("%d vouchers", n)
}

const fetchTestPostingWords = "A posting is going on in Tally now: Test fetching an entry is never sent during a posting. Try again when the posting has finished; nothing was sent."

func fetchTestPosting() bool { return postingGoing() || importsInFlight.Load() > 0 }

// the company's period as Tally listed it (the open-company list, no request): "" when not known
func fetchTestPeriod(company string) string {
	for _, s := range openCompaniesCached() {
		for _, c := range sessCompanies(s) {
			if sameCompany(str(c["name"]), company) && (str(c["from"]) != "" || str(c["to"]) != "") {
				return "books from " + or(str(c["from"]), "?") + " to " + or(str(c["to"]), "?")
			}
		}
	}
	return ""
}

type fetchTestOpts struct {
	company, typ, no, date string // date: yyyymmdd
	master                 string // used for C, D, E when no form found a MasterID ("" : ask, else skip)
}

// the six forms, one at a time. ask (the tray's question, nil when run directly) gives a MasterID when none was found,
// "" to skip C, D and E
func runFetchTest(o fetchTestOpts, ask func() string) (M, error) {
	if o.company == "" {
		o.company = trayMeasureCompany()
	}
	if o.company == "" {
		return nil, errors.New("No company is open in Tally: open the company to test, then try again.")
	}
	if fetchTestRequest("A", o.company, o.date, o.typ, o.no, "") == "" {
		return nil, errors.New("The voucher type, number or date cannot be asked of Tally (a type and a number with no quote mark, a date as 05-Oct-2026).")
	}
	if fetchTestPosting() {
		return nil, errors.New(fetchTestPostingWords)
	}
	port, err := findCompanyPort(o.company, 0)
	if err != nil {
		return nil, err
	}
	pre := "Test fetching an entry: " + o.company + ", " + o.typ + " " + o.no + ", " + tallyDMY(o.date) + ": "
	writeLog(pre + "the company's period in Tally: " + or(fetchTestPeriod(o.company), "not known (the open-company list gives none)"))
	var results []any
	var parts []string
	stopped := ""
	send := func(l, mid string) string {
		if stopped != "" {
			return ""
		}
		if fetchTestPosting() {
			stopped = l
			writeLog(pre + l + " not sent: a posting started; the test stops here (nothing more is sent)")
			parts = append(parts, l+" not sent (a posting started)")
			results = append(results, M{"form": l, "error": "not sent: a posting started"})
			return ""
		}
		what := fetchTestWhat[l]
		if strings.Contains(what, "%s") {
			what = fmt.Sprintf(what, mid)
		}
		x := fetchTestRequest(l, o.company, o.date, o.typ, o.no, mid)
		t0 := time.Now()
		// the forms are measure-only: measuring is raised around each send only (2.2.3 review M1), never while the
		// test waits for the person's MasterID (up to 10 minutes), so the measure-only gate and the self-watch stay as
		// they are the rest of the time
		measuring.Add(1)
		raw, err := invokeTally(fetchTestTC, port, x, fetchTestSec)
		measuring.Add(-1)
		ms := time.Since(t0).Milliseconds()
		head := fmt.Sprintf("%s%s. %s: sent %s: %d ms", pre, l, what, fetchTestPeriodSent(x), ms)
		if err != nil {
			writeLog(head + ", not answered: " + err.Error())
			parts = append(parts, fmt.Sprintf("%s not answered %d ms", l, ms))
			results = append(results, M{"form": l, "what": what, "ms": ms, "vouchers": 0, "error": err.Error()})
			return ""
		}
		n := fetchTestCount(raw)
		writeLog(fmt.Sprintf("%s, %s, %d bytes", head, vouchersWord(n), len(raw)))
		writeLog(pre + l + " vouchers: " + or(fetchTestIDs(raw), "none"))
		writeLog(pre + l + " answer starts: " + fetchTestHead(raw))
		parts = append(parts, fmt.Sprintf("%s %s %d ms", l, vouchersWord(n), ms))
		results = append(results, M{"form": l, "what": what, "ms": ms, "vouchers": n, "bytes": len(raw), "error": ""})
		for _, v := range fetchTestVouchers(raw) {
			if m := onlyDigits(tagNum(v, "MASTERID")); m != "" && m != "0" {
				return m
			}
		}
		return ""
	}
	mA := send("A", "")
	mB := send("B", "")
	mid, fSent := or(mB, mA), false
	if mid == "" && stopped == "" {
		mid, fSent = send("F", ""), true
	}
	if mid == "" && stopped == "" {
		switch {
		case o.master != "":
			mid = o.master
		case ask != nil:
			mid = ask()
		}
		if mid != "" {
			writeLog(pre + "no MasterID found by A, B or F; C, D and E use MasterID " + mid + " (given by the person)")
		} else {
			writeLog(pre + "C, D and E not sent: no MasterID found by A, B or F, and none given")
			parts = append(parts, "C, D, E skipped (no MasterID)")
		}
	}
	if mid != "" {
		send("C", mid)
		send("D", mid)
		send("E", mid)
	}
	if !fSent {
		send("F", "")
	}
	sum := strings.Join(parts, " · ")
	writeLog(pre + "summary: " + sum)
	return M{"ok": true, "company": o.company, "type": o.typ, "number": o.no, "date": o.date, "masterId": mid, "results": results,
		"summary": sum, "stopped": stopped != ""}, nil
}

// --- the tray's route: POST starts it and answers at once, GET says how far; while it waits for a MasterID the tray
// asks the person and POSTs {masterId} or {skip: true}
var (
	fetchTestMu     sync.Mutex
	fetchTestLast   M
	fetchTestAnswer chan string
)

// the inputs as the tray sends them (defaults: Receipt, 212, 05-Oct-2026)
func fetchTestInputs(o M) fetchTestOpts {
	return fetchTestOpts{company: strings.TrimSpace(str(o["company"])), typ: strings.TrimSpace(or(str(o["type"]), "Receipt")),
		no: strings.TrimSpace(or(str(o["number"]), "212")), date: normDate(or(str(o["date"]), "05-Oct-2026"))}
}

func fetchTestPreview(company string) M {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return M{"ok": false, "error": "No company is open in Tally: open the company to test, then try again."}
	}
	return M{"ok": true, "company": company}
}

func startFetchTest(o fetchTestOpts) M {
	if o.company == "" {
		o.company = trayMeasureCompany()
	}
	if o.company == "" {
		return M{"ok": false, "error": "No company is open in Tally: open the company to test, then try again."}
	}
	if fetchTestRequest("A", o.company, o.date, o.typ, o.no, "") == "" {
		return M{"ok": false, "error": "The voucher type, number or date cannot be asked of Tally (a type and a number with no quote mark, a date as 05-Oct-2026). Nothing was sent."}
	}
	if fetchTestPosting() {
		return M{"ok": false, "error": fetchTestPostingWords}
	}
	fetchTestMu.Lock()
	defer fetchTestMu.Unlock()
	if fetchTestLast != nil && (str(fetchTestLast["state"]) == "running" || str(fetchTestLast["state"]) == "needMaster") {
		return M{"ok": false, "error": "A test is already running; wait for its message box."}
	}
	ch := make(chan string, 1)
	fetchTestAnswer = ch
	base := M{"ok": true, "company": o.company, "type": o.typ, "number": o.no, "date": o.date, "at": nowS()}
	fetchTestLast = M{"state": "running"}
	for k, v := range base {
		fetchTestLast[k] = v
	}
	ask := func() string {
		fetchTestMu.Lock()
		fetchTestLast["state"] = "needMaster"
		fetchTestLast["question"] = "No MasterID was found by A, B or F for " + o.typ + " " + o.no + ". Type the voucher's MasterID to send C, D and E, or Cancel to skip them."
		fetchTestMu.Unlock()
		var mid string
		select {
		case mid = <-ch:
		case <-time.After(10 * time.Minute):
		}
		fetchTestMu.Lock()
		fetchTestLast["state"] = "running"
		delete(fetchTestLast, "question")
		fetchTestMu.Unlock()
		return mid
	}
	go func() {
		r, err := runFetchTest(o, ask)
		fetchTestMu.Lock()
		defer fetchTestMu.Unlock()
		if err != nil {
			fetchTestLast = M{"ok": false, "state": "failed", "error": err.Error(), "company": o.company, "at": nowS()}
			return
		}
		r["state"] = "done"
		fetchTestLast = r
	}()
	return M{"ok": true, "started": true, "company": o.company, "type": o.typ, "number": o.no, "date": o.date}
}

// POST {masterId} or {skip: true} while the test waits for a MasterID
func answerFetchTest(o M) M {
	mid := strings.TrimSpace(str(o["masterId"]))
	if !truthy(o["skip"]) && (mid == "" || len(mid) > 18 || onlyDigits(mid) != mid) {
		return M{"ok": false, "error": "A MasterID is a number (as Tally shows it), e.g. 26312."}
	}
	if truthy(o["skip"]) {
		mid = ""
	}
	fetchTestMu.Lock()
	defer fetchTestMu.Unlock()
	if fetchTestLast == nil || str(fetchTestLast["state"]) != "needMaster" || fetchTestAnswer == nil {
		return M{"ok": false, "error": "The test is not waiting for a MasterID."}
	}
	select {
	case fetchTestAnswer <- mid:
	default:
	}
	return M{"ok": true}
}

func fetchTestStatus() M {
	fetchTestMu.Lock()
	defer fetchTestMu.Unlock()
	if fetchTestLast == nil {
		return M{"ok": true, "state": "none"}
	}
	c := M{}
	for k, v := range fetchTestLast {
		c[k] = v
	}
	return c
}
