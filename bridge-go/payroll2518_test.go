package main

// 2.5.18: the payroll import (FinComPayrollImport), approved by the owner on 22-Nov-2026 (docs/PAYROLL.md section 4)

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func payrollFixture(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "tests", "fixtures", "payroll_voucher.xml"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func payrollEnv(v string) string {
	return importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+v+"</TALLYMESSAGE>")
}

func TestPayrollVoucherShape(t *testing.T) {
	x := payrollFixture(t)
	if !strings.HasSuffix(x, "\n") {
		x += "\n"
	}
	if why := payrollVoucherShape(x); why != "" {
		t.Fatalf("the fixture is refused: %s", why)
	}
	if checkAllowed(payrollEnv(x)) != nil {
		t.Fatal("the fixture's request is refused")
	}
	emp := x[strings.Index(x, "<EMPLOYEEENTRIES.LIST>") : strings.Index(x, "</EMPLOYEEENTRIES.LIST>")+len("</EMPLOYEEENTRIES.LIST>\n")]
	bad := map[string]string{
		"payable not the net":            strings.Replace(x, "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>", "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>1", 1),
		"alter, not create":              strings.Replace(x, `ACTION="Create"`, `ACTION="Alter"`, 1),
		"a REMOTEID":                     strings.Replace(x, `OBJVIEW="PaySlip Voucher View">`, `OBJVIEW="PaySlip Voucher View" REMOTEID="abcd-1234">`, 1),
		"an extra element":               strings.Replace(x, "</NARRATION>", "</NARRATION>\n<ISOPTIONAL>Yes</ISOPTIONAL>", 1),
		"a comment":                      strings.Replace(x, "</NARRATION>", "<!-- x --></NARRATION>", 1),
		"CDATA":                          strings.Replace(x, "</NARRATION>", "<![CDATA[x]]></NARRATION>", 1),
		"an amount changed":              strings.Replace(x, "<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-45400.00</AMOUNT>", 1),
		"a wrong sign":                   strings.Replace(x, "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>", "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>", 1),
		"a second voucher":               x + x,
		"the same employee twice (case)": strings.Replace(x, emp, emp+strings.Replace(emp, "Ravi Kumar", "RAVI KUMAR ", 1), 1),
		"an 11-digit amount":             strings.Replace(x, "<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-10000000000.00</AMOUNT>", 1),
	}
	for why, y := range bad {
		if payrollVoucherShape(y) == "" {
			t.Errorf("%s: accepted by the shape", why)
		}
		if checkAllowed(payrollEnv(y)) == nil {
			t.Errorf("%s: accepted by the allow-list", why)
		}
	}
	// 101 employees refused, 100 accepted (each employee renamed)
	var many strings.Builder
	for i := 0; i < 101; i++ {
		many.WriteString(strings.Replace(emp, "Ravi Kumar", "Employee "+strconv.Itoa(i), 1))
	}
	empAmt := prPaise(group(`<AMOUNT>(-?\d+\.\d{2})</AMOUNT>`, emp, 1))
	mk := func(n int) string {
		parts := strings.SplitAfter(many.String(), "</EMPLOYEEENTRIES.LIST>\n")[:n]
		head := x[:strings.Index(x, "<EMPLOYEEENTRIES.LIST>")]
		tail := x[strings.LastIndex(x, "</EMPLOYEEENTRIES.LIST>\n")+len("</EMPLOYEEENTRIES.LIST>\n"):]
		net := -empAmt * int64(n)
		tail = regexp.MustCompile(`(</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>)[0-9.]+`).ReplaceAllString(tail, "${1}"+fmt.Sprintf("%d.%02d", net/100, net%100))
		return head + strings.Join(parts, "") + tail
	}
	if why := payrollVoucherShape(mk(100)); why != "" {
		t.Fatalf("100 employees refused: %s", why)
	}
	if payrollVoucherShape(mk(101)) == "" {
		t.Fatal("101 employees accepted")
	}
}

func TestPayrollNeverPlainImport(t *testing.T) {
	x := payrollFixture(t)
	for _, y := range []string{
		strings.NewReplacer("EMPLOYEEENTRIES.LIST", "employeeentries.list", "PAYHEADALLOCATIONS.LIST", "payheadallocations.list", "CATEGORYENTRY.LIST", "categoryentry.list", "PaySlip Voucher View", "Payslip Voucher View").Replace(x),
		strings.NewReplacer("EMPLOYEEENTRIES.LIST", "EmployeeEntries.List", `OBJVIEW="PaySlip Voucher View"`, `OBJVIEW='PaySlip Voucher View'`).Replace(x),
		strings.Replace(strings.ToLower(x), `action="create"`, `ACTION="Alter"`, 1),
	} {
		e := payrollEnv(y)
		if tallyRequestID(e) != payrollImportID {
			t.Errorf("a case variant is routed as %q", tallyRequestID(e))
		}
		if checkAllowed(e) == nil {
			t.Error("a case variant of a payroll voucher is allowed")
		}
		if pinnedToBuilder("Import", e) {
			t.Error("a payroll-shaped body passes the plain Import pin")
		}
	}
}

func TestPayrollPostsAlone(t *testing.T) {
	x := payrollFixture(t)
	reqs := planImports(nil, []M{{"id": "j1", "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}, {"id": "p1", "xml": x}, {"id": "j2", "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}})
	alone := false
	for _, r := range reqs {
		for _, it := range r.items {
			if it["id"] == "p1" {
				alone = len(r.items) == 1
			}
		}
	}
	if !alone {
		t.Fatal("a payroll voucher shares a request with other vouchers")
	}
	// the posting job's queue too (review of e6b6994a2); review L4 of 7db75b73c: a payroll part, answered, timed out or
	// refused by its pin, leaves the company's pace (bills and bank lines) as it was
	j := func(id string) M {
		return M{"id": id, "xml": "<VOUCHER VCHTYPE=\"Journal\" ACTION=\"Create\"></VOUCHER>"}
	}
	postPaceReset()
	t.Cleanup(postPaceReset)
	for _, perr := range []error{nil, errTimeout, &pinRefusedError{payrollImportID}} {
		q := newPostQueue(nil, []M{j("j1"), j("j2"), {"id": "p1", "xml": x}, j("j3")})
		var got [][]string
		for q.left() && len(got) < 10 {
			r := q.next()
			var ids []string
			for _, it := range r.items {
				ids = append(ids, str(it["id"]))
			}
			got = append(got, ids)
			if contains(ids, "p1") {
				before := payrollPaceSnap()
				q.done(r, 0.1, perr)
				if after := payrollPaceSnap(); after != before {
					t.Fatalf("a payroll part (%v) changed the pace: %+v, was %+v", perr, after, before)
				}
			} else {
				q.done(r, 0.1, nil)
			}
		}
		for _, p := range got {
			for _, id := range p {
				if id == "p1" && len(p) != 1 {
					t.Fatalf("the job queue puts the payroll voucher with others: %v", got)
				}
			}
		}
		if len(got) < 3 {
			t.Fatalf("parts: %v", got)
		}
	}
}

// the pace of a queue with no company (bills, bank lines)
func payrollPaceSnap() [2]postPaceRec {
	return [2]postPaceRec{postPaceGet("", false), postPaceGet("", true)}
}

// review M1 (code) / L1 (security) of 7db75b73c: a payroll voucher is never a bank line, whether FinCom marks it bank or
// its voucher type is named Payment: posted alone, one a request, and its time never learned into either pace
func TestPayrollNeverBank(t *testing.T) {
	x := payrollFixture(t)
	pay := strings.NewReplacer(`VCHTYPE="Payroll"`, `VCHTYPE="Payment"`, "<VOUCHERTYPENAME>Payroll<", "<VOUCHERTYPENAME>Payment<").Replace(x)
	if checkAllowed(payrollEnv(pay)) != nil {
		t.Fatal("a payroll voucher of a type named Payment is refused")
	}
	bl := func(id string) M {
		return M{"id": id, "bank": true, "xml": `<VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>20261031</DATE></VOUCHER>`}
	}
	items := []M{bl("b1"), {"id": "p1", "xml": x, "bank": true}, bl("b2"), bl("b3"), {"id": "p2", "xml": pay}, bl("b4"), bl("b5")}
	for _, it := range items {
		if pid := str(it["id"]); pid[0] == 'p' && isBankItem(it) {
			t.Errorf("%s: a payroll voucher is a bank line", pid)
		}
	}
	seen := map[string]int{}
	for _, r := range planImports(nil, items) {
		for _, it := range r.items {
			if id := str(it["id"]); id[0] == 'p' {
				seen[id]++
				if len(r.items) != 1 || r.bank {
					t.Errorf("planImports: %s shares a request (%d vouchers, bank %v)", id, len(r.items), r.bank)
				}
			}
		}
	}
	if seen["p1"] != 1 || seen["p2"] != 1 {
		t.Fatalf("planImports: the payroll vouchers %v", seen)
	}
	postPaceReset()
	t.Cleanup(postPaceReset)
	for _, perr := range []error{nil, errTimeout, &pinRefusedError{payrollImportID}} {
		postPaceReset()
		// a known pace, so that a part of bank lines holds several
		postPaceNote("", false, 200, 100, 4)
		postPaceNote("", true, 100, 50, 8)
		q := newPostQueue(nil, items)
		seen := map[string]int{}
		for i := 0; q.left() && i < 20; i++ {
			r := q.next()
			pr := ""
			for _, it := range r.items {
				if id := str(it["id"]); id[0] == 'p' {
					pr = id
					seen[id]++
				}
			}
			if pr == "" {
				q.done(r, 0.2, nil)
				continue
			}
			if len(r.items) != 1 || r.bank {
				t.Fatalf("the job queue (%v): %s shares a part of %d (bank %v)", perr, pr, len(r.items), r.bank)
			}
			before := payrollPaceSnap()
			q.done(r, 0.7, perr)
			if after := payrollPaceSnap(); after != before {
				t.Fatalf("the job queue (%v): the payroll part %s changed the pace: %+v, was %+v", perr, pr, after, before)
			}
		}
		if q.left() || seen["p1"] != 1 || seen["p2"] != 1 {
			t.Fatalf("the job queue (%v): left %v, payroll parts %v", perr, q.left(), seen)
		}
	}
}

func TestPayrollImportOwnID(t *testing.T) {
	x := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+payrollFixture(t)+"</TALLYMESSAGE>")
	if id := tallyRequestID(x); id != payrollImportID {
		t.Fatalf("a payroll voucher's import is %q, not %s", id, payrollImportID)
	}
	plain := importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE></VOUCHER></TALLYMESSAGE>`)
	if id := tallyRequestID(plain); id != "Import" {
		t.Fatalf("a plain import is %q", id)
	}
	// a payroll body with anything wider is refused by its pin
	wide := strings.Replace(x, "</VOUCHER>", "</VOUCHER><LEDGER NAME=\"X\" ACTION=\"Create\"></LEDGER>", 1)
	if checkAllowed(wide) == nil {
		t.Fatal("a payroll import carrying a ledger master passes")
	}
	if requestClass[payrollImportID] != "import" || !readStopExempt(payrollImportID) {
		t.Fatal("the payroll import is not classed as a posting")
	}
}

// a payroll voucher of n employees, each with k pay heads of -1.00 named by name(i, j), the payable line their net
func payrollBuild(t *testing.T, n, k int, name func(i, j int) string) string {
	x := payrollFixture(t)
	head := x[:strings.Index(x, "<EMPLOYEEENTRIES.LIST>")]
	tail := x[strings.LastIndex(x, "</EMPLOYEEENTRIES.LIST>\n")+len("</EMPLOYEEENTRIES.LIST>\n"):]
	var b strings.Builder
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "<EMPLOYEEENTRIES.LIST>\n<EMPLOYEENAME>Employee %d</EMPLOYEENAME>\n<AMOUNT>-%d.00</AMOUNT>\n", i, k)
		for j := 0; j < k; j++ {
			fmt.Fprintf(&b, "<PAYHEADALLOCATIONS.LIST>\n<PAYHEADNAME>%s</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-1.00</AMOUNT>\n</PAYHEADALLOCATIONS.LIST>\n", name(i, j))
		}
		b.WriteString("</EMPLOYEEENTRIES.LIST>\n")
	}
	tail = regexp.MustCompile(`(</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>)[0-9.]+`).ReplaceAllString(tail, "${1}"+strconv.Itoa(n*k)+".00")
	return head + b.String() + tail
}

// security review L2 / code review L1 of 7db75b73c: the payroll texts (the voucher type, the narration, the category, the
// employees, the pay heads, the payable ledger, the company) are printable characters only, each of a sensible length, and
// the request itself is capped; else the pin refuses it in its own words
func TestPayrollTextPrintable(t *testing.T) {
	x := payrollFixture(t)
	if !strings.HasSuffix(x, "\n") {
		x += "\n"
	}
	refused := func(e string) bool {
		err := checkAllowed(e)
		var pin *pinRefusedError
		return err != nil && errors.As(err, &pin) && pin.id == payrollImportID && strings.Contains(err.Error(), "the payroll posting is not one payroll voucher")
	}
	if checkAllowed(payrollEnv(x)) != nil {
		t.Fatal("the fixture is refused")
	}
	// the texts as the spec's fields hold them in the fixture
	fields := map[string]string{
		"the voucher type":   "Payroll",
		"the narration":      "Salary for Oct 2026 as per the salary sheet (3 employees) | TDSDesk:dc-pay-202610",
		"the category":       "Primary Cost Category",
		"an employee":        "Ravi Kumar",
		"a pay head":         "Basic Pay",
		"the payable ledger": "Salary Payable",
	}
	for f, v := range fields {
		if !strings.Contains(x, ">"+v+"<") {
			t.Fatalf("%s: %q is not in the fixture", f, v)
		}
		set := func(w string) string {
			y := strings.Replace(x, ">"+v+"<", ">"+w+"<", 1)
			if f == "the voucher type" {
				y = strings.Replace(y, `VCHTYPE="Payroll"`, `VCHTYPE="`+w+`"`, 1)
			}
			return y
		}
		// still accepted: printable text, non-ASCII letters, the five named entities, the longest allowed
		max := payrollMaxName
		if f == "the narration" {
			max = payrollMaxNarration
		}
		for _, w := range []string{v + " Ä é ₹", v + " &amp; Co", strings.Repeat("a", max)} {
			if y := set(w); checkAllowed(payrollEnv(y)) != nil {
				t.Errorf("%s %q (%d characters): refused", f, cut(w, 40), len([]rune(w)))
			}
		}
		for why, w := range map[string]string{
			"a NUL":                  v + "\x00",
			"a control character":    v + "\x01",
			"a tab":                  v + "\tx",
			"a carriage return":      v + "\r",
			"DEL":                    v + "\x7f",
			"a C1 control (NEL)":     v + "\u0085",
			"invalid UTF-8":          v + "\xff\xfe",
			"a bidi override":        v + "‮",
			"a line separator":       v + " ",
			"one character too many": strings.Repeat("a", max+1),
			"far too long (100 KB)":  strings.Repeat("a", 100<<10),
		} {
			y := set(w)
			if payrollVoucherShape(y) == "" {
				t.Errorf("%s with %s: accepted by the shape", f, why)
			}
			if !refused(payrollEnv(y)) {
				t.Errorf("%s with %s: not refused by the payroll pin", f, why)
			}
		}
	}
	// the company (the envelope) too
	for why, co := range map[string]string{"a control character": "ZZ\x01TEST", "invalid UTF-8": "ZZ \xff", "too long": strings.Repeat("Z", payrollMaxName+1)} {
		e := importEnvelope("Vouchers", co, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+x+"</TALLYMESSAGE>")
		if tallyRequestID(e) != payrollImportID || !refused(e) {
			t.Errorf("a company with %s: not refused by the payroll pin", why)
		}
	}
	// the request: 100 employees of 50 pay heads each fits; with long pay-head names it is over the cap and refused
	short := payrollBuild(t, payrollMaxEmployees, payrollMaxPayHeads, func(i, j int) string { return "Pay Head " + strconv.Itoa(j) })
	if why := payrollVoucherShape(short); why != "" {
		t.Fatalf("100 x 50: %s", why)
	}
	if e := payrollEnv(short); len(e) > payrollMaxBytes || checkAllowed(e) != nil {
		t.Fatalf("100 employees of 50 pay heads (%d bytes) refused", len(e))
	}
	long := payrollBuild(t, payrollMaxEmployees, payrollMaxPayHeads, func(i, j int) string { return strings.Repeat("p", 150) + strconv.Itoa(j) })
	if e := payrollEnv(long); len(e) <= payrollMaxBytes || !refused(e) {
		t.Fatalf("a request of %d bytes (the cap %d) not refused", len(e), payrollMaxBytes)
	}
}

// code review L2 of 7db75b73c: the payroll marker is looked for in the voucher's own tags and attributes only, so a plain
// voucher whose narration (or other text) names the payslip view is a plain Import, batched as one; anything that cannot
// be told for certain to be text still goes to the payroll pin and is refused, never to the plain Import
func TestPayrollMarkInTextOnly(t *testing.T) {
	plain := func(narr string) string {
		return `<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE><NARRATION>` + narr + `</NARRATION></VOUCHER>`
	}
	env := func(v string) string { return payrollEnv(v) }
	if e := env(plain("x")); tallyRequestID(e) != "Import" || checkAllowed(e) != nil {
		t.Fatalf("the plain voucher is not a plain Import: %q, %v", tallyRequestID(e), checkAllowed(e))
	}
	for _, narr := range []string{
		`as in OBJVIEW='PaySlip Voucher View'`,
		`as in OBJVIEW="PaySlip Voucher View"`,
		`objview = 'payslip voucher view' for Oct`,
		`Ravi's salary, OBJVIEW='PaySlip Voucher View'`,
	} {
		v := plain(narr)
		e := env(v)
		if id := tallyRequestID(e); id != "Import" {
			t.Errorf("narration %q: routed as %q", narr, id)
		}
		if err := checkAllowed(e); err != nil {
			t.Errorf("narration %q: refused: %v", narr, err)
		}
		if isPayrollItem(M{"xml": v}) {
			t.Errorf("narration %q: taken for a payroll voucher", narr)
		}
		alone := false
		for _, r := range planImports(nil, []M{{"id": "a", "xml": v}, {"id": "b", "xml": plain("y")}}) {
			alone = alone || len(r.items) == 1
		}
		if alone {
			t.Errorf("narration %q: not batched with the other bill", narr)
		}
	}
	// fail closed: the marker inside a tag, or where text and markup cannot be told apart for certain: the payroll id,
	// refused by its pin and by the plain Import's
	x := payrollFixture(t)
	for why, v := range map[string]string{
		"in an attribute":                      `<VOUCHER VCHTYPE="Journal" ACTION="Create" X="OBJVIEW='PaySlip Voucher View'"><DATE>20261031</DATE></VOUCHER>`,
		"a '>' inside an attribute before it":  `<VOUCHER VCHTYPE="a>b" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>20261031</DATE></VOUCHER>`,
		"a quote left open":                    `<VOUCHER VCHTYPE="Journal ACTION="Create"><DATE>20261031</DATE><NARRATION>OBJVIEW='PaySlip Voucher View'</NARRATION></VOUCHER>`,
		"a tag left open":                      `<VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE><NARRATION>a</NARRATION><X OBJVIEW='PaySlip Voucher View'`,
		"a '<' inside a tag":                   `<VOUCHER VCHTYPE="Journal" ACTION="Create" <X OBJVIEW='PaySlip Voucher View'><DATE>20261031</DATE></VOUCHER>`,
		"a '>' in the text":                    plain(`a > b OBJVIEW='PaySlip Voucher View'`),
		"in a comment":                         plain(`a<!-- OBJVIEW='PaySlip Voucher View' -->`),
		"a list in a comment":                  plain(`a<!-- <EMPLOYEEENTRIES.LIST> -->`),
		"in CDATA":                             plain(`<![CDATA[ OBJVIEW='PaySlip Voucher View' ]]>`),
		"a list in CDATA":                      plain(`<![CDATA[ <PAYHEADALLOCATIONS.LIST> ]]>`),
		"in a processing instruction":          plain(`<?x OBJVIEW='PaySlip Voucher View'?>`),
		"an employee list beside the text one": strings.Replace(plain(`OBJVIEW='PaySlip Voucher View'`), "</VOUCHER>", "<EMPLOYEEENTRIES.LIST></EMPLOYEEENTRIES.LIST></VOUCHER>", 1),
		"the fixture with a mention":           strings.Replace(x, "<NARRATION>", "<NARRATION>OBJVIEW='PaySlip Voucher View' ", 1) + "<X",
		"the fixture's lists, no view":         strings.Replace(x, ` OBJVIEW="PaySlip Voucher View"`, "", 1),
	} {
		e := env(v)
		if id := tallyRequestID(e); id != payrollImportID {
			t.Errorf("%s: routed as %q", why, id)
		}
		if checkAllowed(e) == nil {
			t.Errorf("%s: allowed", why)
		}
		if pinnedToBuilder("Import", e) {
			t.Errorf("%s: passes the plain Import pin", why)
		}
		if !isPayrollItem(M{"xml": v}) {
			t.Errorf("%s: not taken for a payroll voucher by the queue", why)
		}
	}
}
