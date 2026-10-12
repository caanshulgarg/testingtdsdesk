// FinCom Bridge 2.4.4 (the owner's decisions of 12-Oct-2026, payroll and salary TDS; the field list measured on real
// TallyPrime 3.0, 5.1 and 7.1, tally-versions mode payroll, runs 38236438871, 38251672564 and 38253610530):
//
//  1. FinComEmployees, one new request: Tally's Cost Centre masters in the bridge's fcCollection form, 2,000 MasterIDs a
//     request (EmployeeChunk) up to the company's highest master number (ALTMSTID), then one last request with no upper
//     end, as the ledger list is read. It asks exactly GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL,
//     ISEMPLOYEEGROUP, PANNUMBER, DATEOFJOIN, DEACTIVATIONDATE and DESIGNATION: stored master fields only, no period, nothing
//     Tally works out. The bridge keeps only payroll rows (FORPAYROLL Yes, or an employee group) and drops every other cost
//     centre as the answer is read, before anything is logged, stored or sent. For changes the chunks are read again when
//     Tally's master counter moves (the light check, every 10 minutes per open company; at most once in EmployeeGapMin, 30
//     minutes), never by a second id (the owner did not approve FinComEmployeeChanges). A background read: through the one
//     gate to Tally, never during a posting, stopped hard at 2 s (RecorderLimitMs), only this bridge's own Windows user's
//     Tally. The list goes to FinCom's cloud as tally-ingest "employees" (the whole payroll list, complete) only when it
//     differs from the list last sent.
//  2. The pay-head fields on the ledger reads (ledFetch: FinComLedgers, FinComLedgerChanges, FinComLedgerByName): PAYTYPE,
//     PAYSTATTYPE, ITCOMPONENT, FORPAYROLL (ledgers.go). "Not Applicable" and FORPAYROLL No are kept as blank, so a ledger
//     that is not a pay head compares as before.
//  3. The salary paid to each employee (no request change): from a salary payment's bank allocations the strip keeps
//     BANKEMPLOYEENAME and its AMOUNT, and only in an allocation that names an employee (fastvch.go). Never ACCOUNTNUMBER,
//     IFSCODE or PAYMENTFAVOURING.
//  4. The 2-second rule's one exception: FinComVoucherObject may wait up to 3 s (PayrollLimitMs, never above 3,000) when the
//     entry is a payroll voucher: its voucher type, as the add-on's line names it, is Tally's "Payroll", or a type this
//     bridge has already seen carrying employees' pay heads (sync\payroll-types.json). Every other request keeps 2 s, and
//     one request in flight stays the rule.
//
// No date of birth, Aadhaar, bank account or other personal field is read or kept.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	empListID = "FinComEmployees"
	// exactly the twelve fields the owner approved (12-Oct-2026), in the order measured
	empFetch = "GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP, PANNUMBER, DATEOFJOIN, DEACTIVATIONDATE, DESIGNATION"
)

// 2,000 MasterIDs a request at most (as LedgerChunk); a smaller setting stays
func empChunk() int { return maxI(1, minI(keepNum("EmployeeChunk", 2000), 2000)) }

// the requests of one check at most (the next check goes on from where this one stopped)
func empMaxReqs() int { return maxI(1, keepNum("EmployeeMaxReqs", 30)) }

// the least time between two reads of the list when the counter moves
func empGap() time.Duration { return time.Duration(keepNum("EmployeeGapMin", 30)) * time.Minute }

func empSec() int { return keepNum("EmployeeSec", 5) }

// the employees whose MasterID is in (after, upto] (upto 0: no upper end)
func employeeChunkRequest(company string, after, upto int64) string {
	return fcCollection(empListID, company, "", "CostCentre", empFetch, masterRange(after, upto))
}

// one payroll row as kept: an employee or an employee group
type empRow struct {
	guid                     string
	mid, alter               int64
	name, parent, category   string
	group                    bool
	pan, joined, left, desig string
}

func (r empRow) arr() []any {
	g := 0
	if r.group {
		g = 1
	}
	return []any{r.guid, r.mid, r.alter, r.name, r.parent, r.category, g, r.pan, r.joined, r.left, r.desig}
}

// a stored text as Tally writes it: control characters out (Tally writes "&#4; Not Applicable"), trimmed, cut to n runes
func payText(s string, n int) string {
	s = strings.TrimSpace(re(`[\x00-\x1f\x7f]`).ReplaceAllString(html.UnescapeString(s), ""))
	return cutRunes(s, n)
}

// a pay-head field: "Not Applicable" is blank (every ledger that is not a pay head carries it)
func payField(s string) string {
	s = payText(s, 100)
	if strings.EqualFold(s, "Not Applicable") {
		return ""
	}
	return s
}

// a Logical: "Yes" or blank
func payYes(s string) string {
	if strings.EqualFold(payText(s, 10), "Yes") {
		return "Yes"
	}
	return ""
}

// a date as yyyymmdd, else blank
func payDate(s string) string {
	s = payText(s, 20)
	if len(s) == 8 && onlyDigits(s) == s {
		return s
	}
	return ""
}

// the payroll rows of an answer (FORPAYROLL Yes, or an employee group), how many cost centres were dropped, and the
// highest MasterID among every cost centre of the answer. A cost centre that is not payroll's is dropped here, as the
// answer is read: nothing of it is logged, stored or sent
func empRowsOf(raw string) ([]empRow, int, int64) {
	var out []empRow
	var top int64
	dropped := 0
	for _, n := range xmlDoc(raw).All("COSTCENTRE") {
		mid := digits(nt(n, "MASTERID"))
		if mid > top {
			top = mid
		}
		group := payYes(nt(n, "ISEMPLOYEEGROUP")) == "Yes"
		if payYes(nt(n, "FORPAYROLL")) != "Yes" && !group {
			dropped++
			continue
		}
		name, g := payText(nameOf(n), 200), cleanGUID(nt(n, "GUID"))
		if name == "" || g == "" {
			dropped++
			continue
		}
		pan := strings.ToUpper(payText(nt(n, "PANNUMBER"), 10))
		if !rePAN.MatchString(pan) {
			pan = strings.ToUpper(re(`[^A-Za-z0-9]`).ReplaceAllString(payText(nt(n, "PANNUMBER"), 20), ""))
			if len(pan) > 10 {
				pan = pan[:10]
			}
		}
		out = append(out, empRow{guid: g, mid: mid, alter: digits(nt(n, "ALTERID")), name: name,
			parent: re(`^\W*Primary$`).ReplaceAllString(payText(nt(n, "PARENT"), 200), ""), category: payText(nt(n, "CATEGORY"), 200), group: group,
			pan: pan, joined: payDate(nt(n, "DATEOFJOIN")), left: payDate(nt(n, "DEACTIVATIONDATE")), desig: payText(nt(n, "DESIGNATION"), 100)})
	}
	return out, dropped, top
}

var rePAN = re(`^[A-Z]{5}[0-9]{4}[A-Z]$`)

// --- the state, per company and GUID (sync\employees.json): the master number the list was last read at (after), when
// (at), the list's fingerprint (hash) and whether FinCom's cloud took that list (sent)
var empMu sync.Mutex

func empFile() string { return sp("employees.json") }

func empGet(key string) M {
	empMu.Lock()
	defer empMu.Unlock()
	return obj(readObjFile(empFile())[key])
}

func empPut(key string, e M) {
	empMu.Lock()
	defer empMu.Unlock()
	o := readObjFile(empFile())
	if o == nil {
		o = M{}
	}
	o[key] = e
	if err := saveFile(empFile(), jsonText(o)); err != nil {
		writeLog("Employees: " + empFile() + " could not be written: " + err.Error())
	}
}

// the read under way, per company and GUID (in memory only: a restart reads the list again from the start)
type empRead struct {
	after, bound int64
	rows         map[string]empRow
	dropped      int
}

var (
	empReads  = map[string]*empRead{}
	empBusy   = map[string]bool{}
	empReadMu sync.Mutex
)

// the fingerprint of a list (in GUID order)
func empHash(rows []empRow) string {
	sort.Slice(rows, func(i, j int) bool { return rows[i].guid < rows[j].guid })
	h := sha256.New()
	for _, r := range rows {
		h.Write([]byte(jsonText(r.arr()) + "\n"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// --- after the light check: Tally's master counter moved (or the list was never read): the payroll list read again
func employeesAfterLightCheck(company string, port int) {
	if n, err := employeesCheckOn(company, port); err != nil && !gaveWay(err) {
		writeLog("Employees of " + company + ": " + cutRunes(err.Error(), 200))
	} else if n > 0 {
		writeLog(fmt.Sprintf("Employees of %s: the payroll list (%d) sent to FinCom", company, n))
	}
}

func employeesCheck(company string) (int, error) { return employeesCheckOn(company, 0) }

func employeesCheckOn(company string, preferred int) (int, error) {
	if !cloudOn() {
		return 0, nil
	}
	cur, guid := latestNumbers(company)
	if cur == nil {
		return 0, nil
	}
	held := heldGUID(company)
	if guid == "" {
		guid = held
	}
	if guid == "" || (held != "" && !strings.EqualFold(held, guid)) {
		return 0, nil // no GUID, or another company's under this name: nothing is asked
	}
	if _, has := startPointOf(company); !has {
		return 0, nil // no starting point recorded: nothing of the company is taken (as for the ledgers)
	}
	key := companyKey(company) + "|" + guid
	m := toI64(cur["altmstid"])
	e := empGet(key)
	empReadMu.Lock()
	rd := empReads[key]
	if empBusy[key] {
		empReadMu.Unlock()
		return 0, nil
	}
	empBusy[key] = true
	empReadMu.Unlock()
	defer func() {
		empReadMu.Lock()
		delete(empBusy, key)
		empReadMu.Unlock()
	}()
	if rd == nil {
		if e != nil && truthy(e["sent"]) && toI64(e["after"]) >= m {
			return 0, nil // the master counter has not moved since the list was read
		}
		if t, ok := parseTime(str(e["at"])); e != nil && ok && nowFn().Sub(t) < empGap() && !nowFn().Before(t) {
			return 0, nil // read a short while ago: the next check after the gap
		}
		rd = &empRead{rows: map[string]empRow{}}
	}
	if m > rd.bound {
		rd.bound = m
	}
	if postingGoing() {
		return 0, nil // a posting goes first
	}
	if retryPending() {
		return 0, nil // Tally has not answered in time lately: the entries come first, the employees after (never the schedule's try)
	}
	port, why := ledOwnPort(company, guid, preferred)
	if why != "" {
		liveSayOnce("emp|"+key+"|"+why, "Employees of "+company+": not asked: "+why)
		return 0, nil
	}
	done, reqs, err := empReadOn(company, port, rd)
	empReadMu.Lock()
	if done {
		delete(empReads, key)
	} else {
		empReads[key] = rd
	}
	empReadMu.Unlock()
	if !done {
		if err == nil {
			writeLog(fmt.Sprintf("Employees of %s: read up to MasterID %d of %d (%d request(s)); the next check goes on", company, rd.after, rd.bound, reqs))
		}
		return 0, err
	}
	rows := make([]empRow, 0, len(rd.rows))
	for _, r := range rd.rows {
		rows = append(rows, r)
	}
	h := empHash(rows)
	ne := M{"company": company, "guid": guid, "after": rd.bound, "at": nowFn().Format(time.RFC3339), "n": len(rows), "hash": h, "sent": true}
	if e != nil && str(e["hash"]) == h && truthy(e["sent"]) || e == nil && len(rows) == 0 {
		// the same list as FinCom has (or a company with no payroll that never sent one): nothing to send
		empPut(key, ne)
		writeLog(fmt.Sprintf("Employees of %s: Tally's master counter %d: the payroll list read (%d request(s), %d row(s)); unchanged, nothing sent", company, rd.bound, reqs, len(rows)))
		return 0, nil
	}
	if serr := empSend(company, guid, rows, rd.bound); serr != nil {
		ne["sent"], ne["hash"] = false, ""
		ne["after"] = toI64(e["after"])
		empPut(key, ne)
		return 0, serr // read and sent again at the next check after the gap
	}
	empPut(key, ne)
	writeLog(fmt.Sprintf("Employees of %s: Tally's master counter %d: %d request(s), %d payroll row(s) kept (%d other cost centre(s) not kept)", company, rd.bound, reqs, len(rows), rd.dropped))
	return len(rows), nil
}

// the chunks from where the read stands: true when the list is read whole (the last request with no upper end answered)
func empReadOn(company string, port int, rd *empRead) (bool, int, error) {
	reqs := 0
	for reqs < empMaxReqs() {
		if postingGoing() {
			return false, reqs, errBackoff
		}
		if retryPending() {
			return false, reqs, nil // a stop meanwhile: the rest at a later check
		}
		tail := rd.after >= rd.bound
		upto := rd.after + int64(empChunk())
		if tail {
			upto = 0
		}
		raw, err := invokeTally(recorderTC(nil), port, employeeChunkRequest(company, rd.after, upto), empSec())
		reqs++
		if err != nil {
			return false, reqs, err
		}
		if !strings.Contains(raw, "<ENVELOPE") {
			return false, reqs, errors.New("Tally's answer to the employees could not be read: " + cut(flat(raw), 120))
		}
		got, dropped, top := empRowsOf(raw)
		raw = ""
		rd.dropped += dropped
		for _, r := range got {
			if len(rd.rows) < keepNum("EmployeeMax", 50000) {
				rd.rows[r.guid] = r
			}
		}
		if tail {
			return true, reqs, nil
		}
		rd.after = upto
		if top > rd.bound {
			rd.bound = top
		}
		keepRest(200 * time.Millisecond)
	}
	return false, reqs, nil
}

// to FinCom's cloud: tally-ingest "employees", the whole payroll list: [[guid, MasterID, AlterID, name, group (the
// parent), cost category, employee group 1/0, PAN, date of joining, date of leaving, designation]]; nil only when taken
func empSend(company, guid string, rows []empRow, upto int64) error {
	sort.Slice(rows, func(i, j int) bool { return rows[i].mid < rows[j].mid })
	l := []any{}
	for _, r := range rows {
		l = append(l, r.arr())
	}
	body := M{"kind": "employees", "company": company, "company_guid": guid, "employees": l, "complete": true, "upto": upto}
	r := invokeCloud(body, 120)
	if r.code == 409 {
		return errors.New("FinCom says this company is not linked")
	}
	if r.code != 200 || r.json == nil || !truthy(r.json["ok"]) {
		w := or(r.err, fmt.Sprint("HTTP ", r.code))
		if r.json != nil && str(r.json["error"]) != "" {
			w += ": " + str(r.json["error"])
		}
		return errors.New("FinCom did not take the employees (" + cutRunes(w, 160) + "); read and sent again later")
	}
	return nil
}

// --- 4. the payroll entry's limit
func payrollLimitMs() int {
	return maxI(recorderLimitMs(), minI(keepNum("PayrollLimitMs", 3000), 3000))
}

// the voucher types this bridge has seen carrying employees' pay heads, per company (lower case)
var (
	payTypesMu sync.Mutex
	payTypes   map[string]map[string]bool
)

func payTypesFile() string { return sp("payroll-types.json") }

func payTypesLoad() {
	if payTypes != nil {
		return
	}
	payTypes = map[string]map[string]bool{}
	for co, v := range readObjFile(payTypesFile()) {
		m := map[string]bool{}
		for _, t := range strs(v) {
			m[strings.ToLower(t)] = true
		}
		payTypes[co] = m
	}
}

// a payroll voucher: its type is Tally's own "Payroll", or one this bridge has seen with employees' pay heads
func payrollEntry(company, vchType string) bool {
	t := strings.ToLower(strings.TrimSpace(vchType))
	if t == "" {
		return false
	}
	if t == "payroll" {
		return true
	}
	payTypesMu.Lock()
	defer payTypesMu.Unlock()
	payTypesLoad()
	return payTypes[companyKey(company)][t]
}

// a body Tally gave with employees' pay heads (CATEGORYENTRY / EMPLOYEEENTRIES): its type is remembered as payroll's
func payrollLearn(company, voucher string) {
	if !strings.Contains(voucher, "<EMPLOYEEENTRIES.LIST") || !strings.Contains(voucher, "<PAYHEADALLOCATIONS.LIST") {
		return
	}
	t := strings.TrimSpace(tagValue(voucher, "VOUCHERTYPENAME"))
	if t == "" || len([]rune(t)) > 200 {
		return
	}
	lt, co := strings.ToLower(t), companyKey(company)
	payTypesMu.Lock()
	defer payTypesMu.Unlock()
	payTypesLoad()
	if payTypes[co][lt] || lt == "payroll" {
		return
	}
	if payTypes[co] == nil {
		payTypes[co] = map[string]bool{}
	}
	if len(payTypes[co]) >= 50 {
		return
	}
	payTypes[co][lt] = true
	o := M{}
	for c, m := range payTypes {
		var l []string
		for x := range m {
			l = append(l, x)
		}
		sort.Strings(l)
		o[c] = toAny(l)
	}
	_ = saveFile(payTypesFile(), jsonText(o))
	writeLog("Payroll: the voucher type '" + cutRunes(t, 100) + "' of " + company + " carries employees' pay heads; its entries may take Tally up to 3 s")
}

// the entry request's TC for a line of this voucher type: the payroll entry's 3 s, else as given
func entryTC(tc *TC, company, vchType string) *TC {
	if tc == nil || !tc.bg || tc.person || tc.limitMs != recorderLimitMs() || !payrollEntry(company, vchType) {
		return tc
	}
	t2 := *tc
	t2.limitMs = payrollLimitMs()
	return &t2
}
