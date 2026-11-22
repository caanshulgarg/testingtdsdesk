// Bridge 2.5.18 (owner approved the payroll request on 22-Nov-2026; docs/PAYROLL.md section 4).
package main

// Bridge 2.5.18 (next-payroll, docs/PAYROLL.md section 4, signed off by the owner on 22-Nov-2026): FinComPayrollImport, the
// one new request: a month's salary posted as Tally's own payroll voucher, each employee with their pay-head allocations.
// It is an Import Data request like every posting (the Vouchers report, the company, one TALLYMESSAGE), with its own id on
// the allow-list so that it is held to its own exact shape and to nothing wider:
//
//   - exactly ONE VOUCHER, ACTION="Create", OBJVIEW="PaySlip Voucher View", in the order and elements of the spec (date,
//     effective date, type, narration, view, one cost category with its employees and their pay heads, then the one
//     salary payable line); no other element, attribute, CDATA, comment or markup in a text;
//   - each employee once, at most payrollMaxEmployees (100) of them: one voucher a request, sized for the 2-second rule
//     (FinCom splits a larger month into several vouchers, each its own posting);
//   - the figures add up to the paisa: earnings negative (ISDEEMEDPOSITIVE Yes), deductions positive (No), an employee's
//     AMOUNT the sum of their pay heads, the salary payable line the net (minus the employees' sum, above zero).
//
// Nothing else changes: it goes through invokeImport / the posting job like any posting (the typing gate, postings
// first, one request in flight, the linked company, this computer's own Tally, the record before the send). No master is
// ever created by it: an employee or a pay head Tally does not have is the owner's to create (FinCom asks). No AI.

import (
	"regexp"
	"strconv"
	"strings"
)

const (
	payrollImportID     = "FinComPayrollImport"
	payrollMaxEmployees = 100
	payrollMaxPayHeads  = 50 // per employee (B2)
	payrollView         = "PaySlip Voucher View"
)

var (
	// the markers of a payroll voucher's body: an Import carrying any of them is this id's, never the plain Import's
	// any letter case and spacing, either quote (review of 9b30a5702, B1): such a body is never the plain Import's
	rePayrollMarks = regexp.MustCompile(`(?i)<\s*/?\s*(EMPLOYEEENTRIES\.LIST|PAYHEADALLOCATIONS\.LIST|CATEGORYENTRY\.LIST)\b|OBJVIEW\s*=\s*["']\s*PAYSLIP\s+VOUCHER\s+VIEW`)
	prText         = `((?:[^<>&]|&(?:amp|lt|gt|quot|apos);)*)`
	prAmt          = `(-?\d{1,10}\.\d{2})`                                                                                                               // at most 10 digits of rupees (B2: no sum can overflow)
	rePrOpen       = regexp.MustCompile(`^<VOUCHER VCHTYPE="((?:[^"<>&]|&(?:amp|lt|gt|quot|apos);)*)" ACTION="Create" OBJVIEW="` + payrollView + `">\n`) // no REMOTEID (M1: Create only, never an existing object)
	rePrHead       = regexp.MustCompile(`^<DATE>(\d{8})</DATE>\n<EFFECTIVEDATE>(\d{8})</EFFECTIVEDATE>\n<VOUCHERTYPENAME>` + prText + `</VOUCHERTYPENAME>\n<NARRATION>` + prText +
		`</NARRATION>\n<PERSISTEDVIEW>` + payrollView + `</PERSISTEDVIEW>\n<CATEGORYENTRY\.LIST>\n<CATEGORY>` + prText + `</CATEGORY>\n`)
	rePrEmp  = regexp.MustCompile(`^<EMPLOYEEENTRIES\.LIST>\n<EMPLOYEENAME>` + prText + `</EMPLOYEENAME>\n<AMOUNT>` + prAmt + `</AMOUNT>\n`)
	rePrPay  = regexp.MustCompile(`^<PAYHEADALLOCATIONS\.LIST>\n<PAYHEADNAME>` + prText + `</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>(Yes|No)</ISDEEMEDPOSITIVE>\n<AMOUNT>` + prAmt + `</AMOUNT>\n</PAYHEADALLOCATIONS\.LIST>\n`)
	rePrEnd  = regexp.MustCompile(`^</EMPLOYEEENTRIES\.LIST>\n`)
	rePrTail = regexp.MustCompile(`^</CATEGORYENTRY\.LIST>\n<ALLLEDGERENTRIES\.LIST>\n<LEDGERNAME>` + prText + `</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>` + prAmt +
		`</AMOUNT>\n</ALLLEDGERENTRIES\.LIST>\n</VOUCHER>\n?$`)
)

// an Import Data request that carries a payroll voucher (its id is payrollImportID)
func isPayrollImport(x string) bool { return isImportRequest(x) && rePayrollMarks.MatchString(x) }

// an item of a posting that is a payroll voucher (it goes in a request of its own)
func isPayrollItem(v M) bool { return rePayrollMarks.MatchString(str(v["xml"])) }

// a request id that is a posting: the plain Import or the payroll import
func isImportID(id string) bool { return id == "Import" || id == payrollImportID }

// paise of an amount the spec allows (two decimals)
func prPaise(s string) int64 {
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	i := strings.IndexByte(s, '.')
	a, _ := strconv.ParseInt(s[:i], 10, 64)
	b, _ := strconv.ParseInt(s[i+1:], 10, 64)
	p := a*100 + b
	if neg {
		return -p
	}
	return p
}

func prRealDate(d string) bool {
	y, _ := strconv.Atoi(d[:4])
	m, _ := strconv.Atoi(d[4:6])
	dd, _ := strconv.Atoi(d[6:8])
	if y < 1900 || y >= 2100 || m < 1 || m > 12 || dd < 1 {
		return false
	}
	days := []int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}[m-1]
	if m == 2 && (y%4 == 0 && (y%100 != 0 || y%400 == 0)) {
		days = 29
	}
	return dd <= days
}

// "" when x is one payroll voucher exactly as the spec has it (FinCom's builder, app/src/lib/tallyPayroll.js); else why not
func payrollVoucherShape(x string) string {
	m := rePrOpen.FindStringSubmatch(x)
	if m == nil {
		return "not a payroll voucher's opening"
	}
	vt := m[1]
	s := x[len(m[0]):]
	if m = rePrHead.FindStringSubmatch(s); m == nil {
		return "the date, type, narration, view or category is not as the spec has it"
	}
	if m[1] != m[2] || !prRealDate(m[1]) {
		return "the date is not a real date, or the effective date differs"
	}
	if m[3] != vt {
		return "the voucher type differs from VCHTYPE"
	}
	if strings.TrimSpace(m[5]) == "" {
		return "no cost category"
	}
	s = s[len(m[0]):]
	seen := map[string]bool{}
	var total int64
	n := 0
	for {
		e := rePrEmp.FindStringSubmatch(s)
		if e == nil {
			break
		}
		name, ea := e[1], prPaise(e[2])
		s = s[len(e[0]):]
		key := foldName(name)
		if strings.TrimSpace(name) == "" || seen[key] {
			return "an employee with no name, or twice"
		}
		seen[key] = true
		n++
		if n > payrollMaxEmployees {
			return "more than " + strconv.Itoa(payrollMaxEmployees) + " employees in one voucher"
		}
		var sum int64
		k := 0
		heads := map[string]bool{}
		for {
			p := rePrPay.FindStringSubmatch(s)
			if p == nil {
				break
			}
			a := prPaise(p[3])
			s = s[len(p[0]):]
			k++
			if k > payrollMaxPayHeads {
				return "more than " + strconv.Itoa(payrollMaxPayHeads) + " pay heads for one employee"
			}
			if strings.TrimSpace(p[1]) == "" || a == 0 || (p[2] == "Yes") != (a < 0) {
				return "a pay head with no name, no amount, or the wrong sign"
			}
			if hk := foldName(p[1]); heads[hk] {
				return "the same pay head twice for one employee"
			} else {
				heads[hk] = true
			}
			sum += a
		}
		if k == 0 {
			return "an employee with no pay head"
		}
		if sum != ea {
			return "an employee's amount is not the sum of their pay heads"
		}
		if ea >= 0 {
			return "an employee's net pay is not above zero"
		}
		end := rePrEnd.FindString(s)
		if end == "" {
			return "something else inside an employee's entry"
		}
		s = s[len(end):]
		total += ea
	}
	if n == 0 {
		return "no employee"
	}
	t := rePrTail.FindStringSubmatch(s)
	if t == nil {
		return "something other than the one salary payable line after the employees"
	}
	if strings.TrimSpace(t[1]) == "" || prPaise(t[2]) <= 0 || prPaise(t[2]) != -total {
		return "the salary payable line is not the net of the employees"
	}
	return ""
}

// the pin (pinned.go): the request is the Import envelope of the Vouchers report with ONE TALLYMESSAGE holding exactly one
// payroll voucher of the spec's shape (white space around it as FinCom sends it); rebuilt from its own company and voucher
func payrollImportRebuild(x string) []string {
	head := importHead + "Vouchers</REPORTNAME>"
	if !strings.HasPrefix(x, head) {
		return nil
	}
	a := strings.Index(x, "<REQUESTDATA>")
	z := strings.LastIndex(x, "</REQUESTDATA>")
	if a < 0 || z < a {
		return nil
	}
	body := x[a+len("<REQUESTDATA>") : z]
	const open, close = `<TALLYMESSAGE xmlns:UDF="TallyUDF">`, "</TALLYMESSAGE>"
	if !strings.HasPrefix(body, open) || !strings.HasSuffix(body, close) {
		return nil
	}
	obj := strings.Trim(body[len(open):len(body)-len(close)], " \t\r\n")
	if strings.Count(obj, "<VOUCHER ") != 1 || reImportNever.MatchString(obj) || cannotSend(obj) != "" || payrollVoucherShape(obj+"\n") != "" {
		return nil
	}
	return []string{importEnvelope("Vouchers", pinCo(x), body)}
}

// the allow-list's sample (allowListSamples): the shape fingerprinted in docs/tally-allowlist.md, a made-up month
func payrollImportSample(company string) string {
	v := `<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="` + payrollView + `">` + "\n" +
		"<DATE>20260430</DATE>\n<EFFECTIVEDATE>20260430</EFFECTIVEDATE>\n<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>\n<NARRATION>TDSDesk:sample | Salary for Apr 2026</NARRATION>\n" +
		"<PERSISTEDVIEW>" + payrollView + "</PERSISTEDVIEW>\n<CATEGORYENTRY.LIST>\n<CATEGORY>Primary Cost Category</CATEGORY>\n" +
		"<EMPLOYEEENTRIES.LIST>\n<EMPLOYEENAME>SAMPLE EMPLOYEE</EMPLOYEENAME>\n<AMOUNT>-9800.00</AMOUNT>\n" +
		"<PAYHEADALLOCATIONS.LIST>\n<PAYHEADNAME>Basic Pay</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-10000.00</AMOUNT>\n</PAYHEADALLOCATIONS.LIST>\n" +
		"<PAYHEADALLOCATIONS.LIST>\n<PAYHEADNAME>Professional Tax</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>200.00</AMOUNT>\n</PAYHEADALLOCATIONS.LIST>\n" +
		"</EMPLOYEEENTRIES.LIST>\n</CATEGORYENTRY.LIST>\n<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Salary Payable</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>9800.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n</VOUCHER>\n"
	return importEnvelope("Vouchers", company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+v+"</TALLYMESSAGE>")
}
