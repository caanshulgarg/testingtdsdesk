// FinCom Bridge 2.5.19: the read requests the owner approved on 23-Nov-2026 (docs/bridge-2.5.19-new-requests.md, "The
// owner's decisions"): B1 FinComDayHeadsPart (a heavy day's heads in MasterID bands), C1 FinComBillOpenings, C2
// FinComVoucherTypes, C3 FinComCostCentres, C4 FinComCostCategories, C5 ISPOSTDATED on the entries (fastvch.go,
// batch249.go), C6 FinComGstRegistrations, C7 the added ledger fields (ledgers.go), C8 FinComGroupClosing (the daily
// tie-out, option a). Every one reads only (an Export of a collection), each has ONE builder here and is pinned to it
// (requestRebuild: byte-identical from the request's own parameters). None is measured yet: each row says "NOT yet
// measured" until ZZ BIG TEST times it.
//
// A field name the paper marks "to confirm" (checked first by a person's export on ZZ TEST) stays behind a switch that is
// off (cfg Confirmed2519*): with it off the request is built without that field, and a request whose every name is to
// confirm (C6, and C8's filter) is not sent at all. The switch is turned on only after the export confirms the names.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	dayPartID      = "FinComDayHeadsPart"
	billOpenID     = "FinComBillOpenings"
	vchTypesID     = "FinComVoucherTypes"
	costCentresID  = "FinComCostCentres"
	costCatsID     = "FinComCostCategories"
	gstRegsID      = "FinComGstRegistrations"
	groupClosingID = "FinComGroupClosing"

	billOpenFetch      = "GUID, MASTERID, ALTERID, NAME, ISBILLWISEON, BILLALLOCATIONS.NAME, BILLALLOCATIONS.BILLDATE, BILLALLOCATIONS.OPENINGBALANCE, BILLALLOCATIONS.BILLCREDITPERIOD, BILLALLOCATIONS.ISADVANCE"
	vchTypesFetch      = "GUID, MASTERID, ALTERID, NAME, PARENT, NUMBERINGMETHOD, ISACTIVE, AFFECTSSTOCK, ISOPTIONAL, ISDEEMEDPOSITIVE"
	vchTypesFetchGst   = ", GSTREGISTRATION" // (to confirm)
	costCentresFetch   = "GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP"
	costCatsFetch      = "GUID, MASTERID, ALTERID, NAME, ALLOCATEREVENUE, ALLOCATENONREVENUE"
	gstRegsFetch       = "GUID, MASTERID, ALTERID, NAME, GSTREGNUMBER, STATENAME, GSTREGISTRATIONTYPE, APPLICABLEFROM, ISACTIVE" // (all to confirm)
	groupClosingFetch  = "GUID, NAME, PARENT, CLOSINGBALANCE"
	groupClosingFilter = `$Parent = ""` // (to confirm)
)

// the words C5 and C7 add to the four changed rows (the history tests take them out again)
var allowChanged2519 = map[string]string{
	ledListID:    "; 2.5.19 (C7, the owner's decision of 2026-11-23): GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, ADDRESS.LIST, PINCODE, COUNTRYNAME added at the end of the FETCH (LEDMAILINGDETAILS.LIST and LEDMSMEREGDETAILS.LIST only once confirmed on ZZ TEST), this shape NOT yet measured (the worst case shown is 2.5.18's shape)",
	ledChangesID: "; 2.5.19 (C7, the owner's decision of 2026-11-23): the ledger list's added fields at the end of the FETCH, this shape NOT yet measured (the worst case shown is 2.5.18's shape)",
	ledByNameID:  "; 2.5.19 (C7, the owner's decision of 2026-11-23): the ledger list's added fields at the end of the FETCH, this shape NOT yet measured (the worst case shown is 2.5.18's shape)",
	vchBatchID:   "; 2.5.19 (C5, the owner's decision of 2026-11-23): ISPOSTDATED added at the end of the FETCH (and kept by FinComVoucherObject's strip), this shape NOT yet measured (the worst case shown is 2.5.18's shape)",
}

// --- the switches for the names to confirm (off until a person's ZZ TEST export confirms them)
func confirmedVchTypeGst() bool   { return cfgB("Confirmed2519VchTypeGst") }
func confirmedGstRegs() bool      { return cfgB("Confirmed2519GstRegs") }
func confirmedLedgerLists() bool  { return cfgB("Confirmed2519LedgerLists") }
func confirmedGroupClosing() bool { return cfgB("Confirmed2519GroupClosing") }

// the names a person checks on ZZ TEST before a switch goes on (said in the tray's report and the 2.5.19 test sheet)
var toConfirm2519 = []string{
	"FinComVoucherTypes: GSTREGISTRATION (Confirmed2519VchTypeGst)",
	"FinComGstRegistrations: the collection TaxUnit and GSTREGNUMBER, STATENAME, GSTREGISTRATIONTYPE, APPLICABLEFROM, ISACTIVE (Confirmed2519GstRegs)",
	"FinComLedgers: LEDMAILINGDETAILS.LIST and LEDMSMEREGDETAILS.LIST (Confirmed2519LedgerLists)",
	"FinComGroupClosing: the filter $Parent = \"\" picks exactly the primary groups (Confirmed2519GroupClosing)",
}

// --- B1: one day's heads, the entries whose MasterID is in [a, b] (b 0: no upper end); "" for anything else
func dayPartRequest(company, day string, a, b int64) string {
	if !isTallyDate(day) || a < 1 || (b != 0 && b < a) {
		return ""
	}
	f := fmt.Sprintf("$MasterID >= %d", a)
	if b > 0 {
		f += fmt.Sprintf(" AND $MasterID <= %d", b)
	}
	return formCollection(dayPartID, company, formPlainT, day, day, dayHeadsFetch, f)
}

var reDayPart = regexp.MustCompile(`<SYSTEM TYPE="Formulae" NAME="FinComDayHeadsPartOnly">\$MasterID &gt;= (\d{1,18})(?: AND \$MasterID &lt;= (\d{1,18}))?</SYSTEM>`)

func dayPartRebuild(x string) string {
	m := reDayPart.FindStringSubmatch(x)
	a, z := pinDates(x)
	if m == nil || a == "" || a != z || strings.HasPrefix(m[1], "0") || (m[2] != "" && strings.HasPrefix(m[2], "0")) {
		return ""
	}
	return dayPartRequest(pinCo(x), a, toI64(m[1]), toI64(m[2]))
}

// --- C1: the opening bills of bill-wise ledgers, the books' first year as the period (as FinComLedgers)
func billOpenRequest(company, booksFrom string, after, upto int64) string {
	sv := ledgerPeriodVars(booksFrom)
	if sv == "" || after < 0 {
		return ""
	}
	return fcCollection(billOpenID, company, sv, "Ledger", billOpenFetch, "$IsBillWiseOn AND "+masterRange(after, upto))
}

// --- C2 to C4, C6: masters, no period
func vchTypesFetchNow() string {
	if confirmedVchTypeGst() {
		return vchTypesFetch + vchTypesFetchGst
	}
	return vchTypesFetch
}
func vchTypesRequest(company string, after, upto int64) string {
	return fcCollection(vchTypesID, company, "", "VoucherType", vchTypesFetchNow(), masterRange(after, upto))
}
func costCentresRequest(company string, after, upto int64) string {
	return fcCollection(costCentresID, company, "", "CostCentre", costCentresFetch, masterRange(after, upto))
}
func costCatsRequest(company string) string {
	return fcCollection(costCatsID, company, "", "CostCategory", costCatsFetch, "")
}

// "" while the names are not confirmed (never sent)
func gstRegsRequest(company string) string {
	if !confirmedGstRegs() {
		return ""
	}
	return gstRegsRequestBuilt(company)
}
func gstRegsRequestBuilt(company string) string {
	return fcCollection(gstRegsID, company, "", "TaxUnit", gstRegsFetch, "")
}

// --- C8: the primary groups' closing balances at day d (yyyymmdd), from the first day of d's financial year
func fyStartOf(d string) string {
	if !isTallyDate(d) {
		return ""
	}
	y := toInt(d[:4])
	if d[4:] < "0401" {
		y--
	}
	return fmt.Sprintf("%04d0401", y)
}
func groupClosingRequest(company, d string) string {
	if !confirmedGroupClosing() {
		return ""
	}
	return groupClosingRequestBuilt(company, d)
}
func groupClosingRequestBuilt(company, d string) string {
	f := fyStartOf(d)
	if f == "" {
		return ""
	}
	return fcCollection(groupClosingID, company, dateVars(formPlainT, f, d), "Group", groupClosingFetch, groupClosingFilter)
}
func groupClosingRebuild(x string) string {
	a, z := pinDates(x)
	if a == "" || a != fyStartOf(z) {
		return ""
	}
	return groupClosingRequestBuilt(pinCo(x), z)
}

// --- pinned (pinned.go's requestRebuild), the allow-list (allowlist.go) and the request classes (tally.go)
func init() {
	requestRebuild[dayPartID] = pinOne(dayPartRebuild)
	requestRebuild[billOpenID] = pinOne(func(x string) string {
		a, z := pinMasterRange(x)
		if a < 0 {
			return ""
		}
		return billOpenRequest(pinCo(x), pinLedgerFrom(x), a, z)
	})
	requestRebuild[vchTypesID] = pinOne(func(x string) string {
		a, z := pinMasterRange(x)
		if a < 0 {
			return ""
		}
		return vchTypesRequest(pinCo(x), a, z)
	})
	requestRebuild[costCentresID] = pinOne(func(x string) string {
		a, z := pinMasterRange(x)
		if a < 0 {
			return ""
		}
		return costCentresRequest(pinCo(x), a, z)
	})
	requestRebuild[costCatsID] = pinOne(func(x string) string { return costCatsRequest(pinCo(x)) })
	requestRebuild[gstRegsID] = pinOne(func(x string) string { return gstRegsRequest(pinCo(x)) })
	requestRebuild[groupClosingID] = pinOne(func(x string) string {
		if !confirmedGroupClosing() {
			return ""
		}
		return groupClosingRebuild(x)
	})
	ledgerPeriodIDs[billOpenID] = true
	requestClass[dayPartID] = "exception"
	requestClass[billOpenID] = "ledgerPeriod"
	requestClass[vchTypesID], requestClass[costCentresID], requestClass[costCatsID], requestClass[gstRegsID] = "undated", "undated", "undated", "undated"
	requestClass[groupClosingID] = "exception"
	const nm = "; allowed for 2.5.19 by the owner's decision of 2026-11-23, NOT yet measured"
	// C5 and C7 change four requests' FETCH (at the end): their rows say so; the worst case shown stays 2.5.18's shape's
	// until ZZ BIG TEST times the new one
	for id, add := range allowChanged2519 {
		a := tallyAllowList[id]
		a.purpose += add
		tallyAllowList[id] = a
	}
	tallyAllowList[dayPartID] = allowedReq{purpose: "a heavy day's entry heads in pieces (2.5.19, B1): ONE day FinCom listed (SVFROMDATE = SVTODATE, yyyymmdd TYPE=\"Date\"), GUID, MASTERID, ALTERID, DATE of the entries whose MasterID is in a band a..b (the last band open-ended), only after that day's FinComDayHeads was stopped at 2 s; the bands sized to about 1.35 s, every row's date and band checked; heavy tier, idle only, postings first, stopped at 2 s" + nm}
	tallyAllowList[billOpenID] = allowedReq{purpose: "the opening bills of bill-wise ledgers (2.5.19, C1): Tally's Ledger masters with ISBILLWISEON, 500 MasterIDs a request at most, GUID, MASTERID, ALTERID, NAME and the opening BILLALLOCATIONS (name, bill date, opening, credit period, advance), stored master fields, the books' first year as the period as FinComLedgers" + nm}
	tallyAllowList[vchTypesID] = allowedReq{purpose: "the voucher-type masters (2.5.19, C2): name, base type (PARENT), numbering method, active, affects stock, optional, deemed positive, 2,000 MasterIDs a request at most, stored master fields only, no period (GSTREGISTRATION only once confirmed)" + nm}
	tallyAllowList[costCentresID] = allowedReq{purpose: "every cost centre (2.5.19, C3): GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP (no employee fields), 2,000 MasterIDs a request at most, stored master fields only; payroll rows dropped (FinComEmployees reads them)" + nm}
	tallyAllowList[costCatsID] = allowedReq{purpose: "the cost categories (2.5.19, C4): GUID, MASTERID, ALTERID, NAME, ALLOCATEREVENUE, ALLOCATENONREVENUE, stored master fields only, one request" + nm}
	tallyAllowList[gstRegsID] = allowedReq{purpose: "the company's GST registrations (2.5.19, C6; TallyPrime 3.0 and later): Tally's TaxUnit masters, name, GSTIN, state, registration type, from when, active, stored master fields only, one request; NOT sent until the names are confirmed on ZZ TEST (Confirmed2519GstRegs)" + nm}
	tallyAllowList[groupClosingID] = allowedReq{purpose: "the daily tie-out (2.5.19, C8, the owner's option a): the primary groups' (PARENT empty) CLOSINGBALANCE at a day D, SVFROMDATE the first day of D's financial year, SVTODATE D (yyyymmdd TYPE=\"Date\"), a figure Tally works out: at most once a day per company, in the daily idle catch-up only, after the company's other reads, stopped at 2 s; NOT sent until the filter is confirmed on ZZ TEST (Confirmed2519GroupClosing)" + nm}
}

// the samples of the table (allowListSamples): the builders with fixed inputs; a request held behind its switch is
// sampled as it will be built
func samples2519(c, a string) map[string]string {
	return map[string]string{
		dayPartID:      dayPartRequest(c, a, 1, 4000),
		billOpenID:     billOpenRequest(c, "20250401", 0, 500),
		vchTypesID:     vchTypesRequest(c, 0, 2000),
		costCentresID:  costCentresRequest(c, 0, 2000),
		costCatsID:     costCatsRequest(c),
		gstRegsID:      gstRegsRequestBuilt(c),
		groupClosingID: groupClosingRequestBuilt(c, "20261122"),
	}
}

// --- the rows of the answers (stored fields only; nothing else is kept, logged or sent)

func yes(s string) bool { return strings.EqualFold(strings.TrimSpace(s), "Yes") }

// C1: [guid, MasterID, AlterID, name, [[bill, bill date, opening, credit period, advance], ...]] for a ledger with bills
func billOpenRowsOf(raw string) ([]any, int64) {
	var out []any
	var top int64
	for _, l := range xmlDoc(raw).All("LEDGER") {
		n, g, mid := strings.TrimSpace(nameOf(l)), cleanGUID(nt(l, "GUID")), digits(nt(l, "MASTERID"))
		if mid > top {
			top = mid
		}
		if n == "" || g == "" {
			continue
		}
		bills := []any{}
		for _, b := range l.Sel("BILLALLOCATIONS.LIST") {
			name := tdsText(nt(b, "NAME"), 200)
			if name == "" || len(bills) >= 5000 {
				continue
			}
			bills = append(bills, []any{name, tdsText(nt(b, "BILLDATE"), 20), amtText(nt(b, "OPENINGBALANCE")), tdsText(nt(b, "BILLCREDITPERIOD"), 30), yes(nt(b, "ISADVANCE"))})
		}
		out = append(out, []any{g, mid, digits(nt(l, "ALTERID")), tdsText(n, 300), bills})
	}
	return out, top
}

// C2: [guid, MasterID, AlterID, name, parent, numbering, active, affects stock, optional, deemed positive, GST registration]
func vchTypeRowsOf(raw string) ([]any, int64) {
	var out []any
	var top int64
	for _, v := range xmlDoc(raw).All("VOUCHERTYPE") {
		n, g, mid := strings.TrimSpace(nameOf(v)), cleanGUID(nt(v, "GUID")), digits(nt(v, "MASTERID"))
		if mid > top {
			top = mid
		}
		if n == "" || g == "" {
			continue
		}
		out = append(out, []any{g, mid, digits(nt(v, "ALTERID")), tdsText(n, 200), tdsText(re(`^\W*Primary$`).ReplaceAllString(nt(v, "PARENT"), ""), 200),
			tdsText(nt(v, "NUMBERINGMETHOD"), 60), yes(nt(v, "ISACTIVE")), yes(nt(v, "AFFECTSSTOCK")), yes(nt(v, "ISOPTIONAL")), yes(nt(v, "ISDEEMEDPOSITIVE")),
			tdsText(nt(v, "GSTREGISTRATION"), 200)})
	}
	return out, top
}

// C3: [guid, MasterID, AlterID, name, parent, category, employee group]. Dropped here, before anything is kept, logged or
// sent: a payroll centre (FORPAYROLL Yes), an employee group (ISEMPLOYEEGROUP Yes) and every centre under one, at any
// depth (the security review's I2: a second guard, should a Tally not mark an employee FORPAYROLL). Employees come from
// FinComEmployees as before. (A centre is not dropped for its cost category: payroll often uses the Primary Cost
// Category, which every other centre shares.)
func costCentreRowsOf(raw string) ([]any, int64) {
	type cc struct {
		g, n, parent, cat string
		mid, alt          int64
		pay, grp          bool
	}
	var all []cc
	var top int64
	for _, c := range xmlDoc(raw).All("COSTCENTRE") {
		r := cc{cleanGUID(nt(c, "GUID")), strings.TrimSpace(nameOf(c)), strings.TrimSpace(re(`^\W*Primary$`).ReplaceAllString(nt(c, "PARENT"), "")), nt(c, "CATEGORY"),
			digits(nt(c, "MASTERID")), digits(nt(c, "ALTERID")), yes(nt(c, "FORPAYROLL")), yes(nt(c, "ISEMPLOYEEGROUP"))}
		if r.mid > top {
			top = r.mid
		}
		all = append(all, r)
	}
	parent, off := map[string]string{}, map[string]bool{}
	for _, r := range all {
		parent[strings.ToLower(r.n)] = strings.ToLower(r.parent)
		if r.pay || r.grp {
			off[strings.ToLower(r.n)] = true
		}
	}
	under := func(n string) bool {
		for i, p := 0, strings.ToLower(n); p != "" && i < 50; i, p = i+1, parent[p] {
			if off[p] {
				return true
			}
		}
		return false
	}
	var out []any
	for _, r := range all {
		if r.n == "" || r.g == "" || r.pay || r.grp || under(r.parent) {
			continue
		}
		out = append(out, []any{r.g, r.mid, r.alt, tdsText(r.n, 200), tdsText(r.parent, 200), tdsText(r.cat, 200), r.grp})
	}
	return out, top
}

// C4: [guid, MasterID, AlterID, name, revenue, non-revenue]
func costCatRowsOf(raw string) ([]any, int64) {
	var out []any
	var top int64
	for _, c := range xmlDoc(raw).All("COSTCATEGORY") {
		n, g, mid := strings.TrimSpace(nameOf(c)), cleanGUID(nt(c, "GUID")), digits(nt(c, "MASTERID"))
		if mid > top {
			top = mid
		}
		if n == "" || g == "" {
			continue
		}
		out = append(out, []any{g, mid, digits(nt(c, "ALTERID")), tdsText(n, 200), yes(nt(c, "ALLOCATEREVENUE")), yes(nt(c, "ALLOCATENONREVENUE"))})
	}
	return out, top
}

// C6: [guid, MasterID, AlterID, name, GSTIN, state, registration type, from, active]
func gstRegRowsOf(raw string) ([]any, int64) {
	var out []any
	var top int64
	for _, r := range xmlDoc(raw).All("TAXUNIT") {
		n, g, mid := strings.TrimSpace(nameOf(r)), cleanGUID(nt(r, "GUID")), digits(nt(r, "MASTERID"))
		if mid > top {
			top = mid
		}
		if n == "" || g == "" {
			continue
		}
		out = append(out, []any{g, mid, digits(nt(r, "ALTERID")), tdsText(n, 200), strings.ToUpper(tdsText(nt(r, "GSTREGNUMBER"), 15)), tdsText(nt(r, "STATENAME"), 60),
			tdsText(nt(r, "GSTREGISTRATIONTYPE"), 60), tdsText(nt(r, "APPLICABLEFROM"), 20), yes(nt(r, "ISACTIVE"))})
	}
	return out, top
}

// C8: [guid, name, closing] for each primary group (a row with a PARENT is dropped here, whatever the filter did)
func groupClosingRowsOf(raw string) []any {
	out := []any{}
	for _, g := range xmlDoc(raw).All("GROUP") {
		n := strings.TrimSpace(nameOf(g))
		if n == "" || strings.TrimSpace(re(`^\W*Primary$`).ReplaceAllString(nt(g, "PARENT"), "")) != "" {
			continue
		}
		cl := nt(g, "CLOSINGBALANCE")
		out = append(out, []any{cleanGUID(nt(g, "GUID")), tdsText(n, 200), amtText(cl)})
	}
	return out
}

// C7: the ledger's added fields as one JSON object text ("" when Tally gave none of them), so a row compares whole
func ledBooks2519(l *Node) string {
	o := map[string]any{}
	put := func(k, v string) {
		if v = strings.TrimSpace(v); v != "" {
			o[k] = tdsText(v, 300)
		}
	}
	put("gstRegType", nt(l, "GSTREGISTRATIONTYPE"))
	if v := nt(l, "LEDGSTREGDETAILS.LIST/GSTREGISTRATIONTYPE"); v != "" && o["gstRegType"] == nil {
		put("gstRegType", v)
	}
	put("billWise", nt(l, "ISBILLWISEON"))
	put("creditPeriod", nt(l, "BILLCREDITPERIOD"))
	put("costCentres", nt(l, "ISCOSTCENTRESON"))
	var addr []string
	for _, a := range l.Sel("ADDRESS.LIST/ADDRESS") {
		if s := strings.TrimSpace(a.InnerText()); s != "" && len(addr) < 6 {
			addr = append(addr, tdsText(s, 200))
		}
	}
	put("pincode", nt(l, "PINCODE"))
	put("country", nt(l, "COUNTRYNAME"))
	if confirmedLedgerLists() {
		for _, a := range l.Sel("LEDMAILINGDETAILS.LIST/ADDRESS.LIST/ADDRESS") {
			if s := strings.TrimSpace(a.InnerText()); s != "" && len(addr) < 6 {
				addr = append(addr, tdsText(s, 200))
			}
		}
		if o["pincode"] == nil {
			put("pincode", nt(l, "LEDMAILINGDETAILS.LIST/PINCODE"))
		}
		if o["country"] == nil {
			put("country", nt(l, "LEDMAILINGDETAILS.LIST/COUNTRY"))
		}
		put("mailingState", nt(l, "LEDMAILINGDETAILS.LIST/STATE"))
		put("msmeType", nt(l, "LEDMSMEREGDETAILS.LIST/MSMEENTERPRISETYPE"))
		put("udyam", nt(l, "LEDMSMEREGDETAILS.LIST/UDYAMREGNUMBER"))
	}
	if len(addr) > 0 {
		o["address"] = addr
	}
	if len(o) == 0 {
		return ""
	}
	b, _ := json.Marshal(o)
	return string(b)
}

// the ledger request's FETCH now: 2.5.19's fields, the two lists only once confirmed
const ledFetch2519 = ", GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, ADDRESS.LIST, PINCODE, COUNTRYNAME"

func ledFetchNow() string {
	if confirmedLedgerLists() {
		return ledFetch244 + ", GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, LEDMAILINGDETAILS.LIST, ADDRESS.LIST, PINCODE, COUNTRYNAME, LEDMSMEREGDETAILS.LIST"
	}
	return ledFetch
}

// C7's column on a ledger_changes / ledger_list row: the object, or nothing (the row as 2.5.18 sent it)
func ledBooksCol(b string) []any {
	if b == "" {
		return nil
	}
	return []any{parseJSONLoose(b)}
}

// --- C1 to C4 and C6 in the masters read (ledgers.go ledgerList, after the natures of payment): stored master fields,
// in chunks of MasterIDs up to the company's highest master number and one last open request (as the natures), one
// request in flight, each under the 2 s stop, inside the round's budget and its holds (the person typing, a posting).
// A kind Tally does not answer in time never holds the ledger list: the round goes on without that kind (FinCom keeps
// what it has), and after two rounds Tally did not answer it at all it is not asked again until the bridge is updated
type booksSpec struct {
	key, id, what string
	chunk         int // MasterIDs a request; 0: one request
	build         func(company, bf string, after, upto int64) string
	rows          func(raw string) ([]any, int64)
	daily         bool // the code review's N7: read at most once a day (the opening bills: many requests, rarely changed)
}

var booksSpecs = []booksSpec{
	{"voucherTypes", vchTypesID, "the voucher types", 2000, func(c, _ string, a, z int64) string { return vchTypesRequest(c, a, z) }, vchTypeRowsOf, false},
	{"costCentres", costCentresID, "the cost centres", 2000, func(c, _ string, a, z int64) string { return costCentresRequest(c, a, z) }, costCentreRowsOf, false},
	{"costCategories", costCatsID, "the cost categories", 0, func(c, _ string, _, _ int64) string { return costCatsRequest(c) }, costCatRowsOf, false},
	{"gstRegistrations", gstRegsID, "the GST registrations", 0, func(c, _ string, _, _ int64) string { return gstRegsRequest(c) }, gstRegRowsOf, false},
	{"billOpenings", billOpenID, "the opening bills", 500, func(c, bf string, a, z int64) string { return billOpenRequest(c, bf, a, z) }, billOpenRowsOf, true},
}

func (k *keepRun) booksMasters(company string, port int, bf string, st, ls M, inBudget func() bool, save func()) (bool, error) {
	for _, sp := range booksSpecs {
		dk := "bm_" + sp.key
		for !truthy(ls[dk+"Done"]) {
			if str(st[dk+"Off"]) == BridgeVersion || (sp.daily && str(st[dk+"Day"]) == tallyDate(nowFn()) && !truthy(ls[dk+"Began"])) {
				ls[dk+"Done"], ls[dk+"Skip"] = true, true // (a daily kind read today already: FinCom keeps what it has)
				break
			}
			if !inBudget() || k.holdNow() != "" {
				return false, nil
			}
			if pullQuietSec(pullItem{Company: company, CGUID: heldGUID(company)}) < float64(pullIdleSec()) {
				// the heavy tier (the owner's rule for every 2.5.19 read): only once Tally has been left alone a minute; else
				// this kind waits for the next round (the ledger list goes on; FinCom keeps what it has)
				ls[dk+"Done"], ls[dk+"Skip"] = true, true
				save()
				break
			}
			after, bound := toI64(ls[dk+"After"]), toI64(ls["bound"])
			tail := sp.chunk == 0 || bound <= 0 || after >= bound
			upto := after + int64(sp.chunk)
			if tail {
				upto = 0
			}
			x := sp.build(company, bf, after, upto)
			if sp.id == billOpenID && truthy(ls["standIn"]) {
				x = "" // 2.5.13's stand-in day: the openings are not known this round, nor the opening bills
			}
			if x == "" {
				ls[dk+"Done"], ls[dk+"Skip"] = true, true // not built (its names not confirmed yet, or no books-from)
				save()
				break
			}
			t1 := time.Now()
			raw, err := invokeTally(ledgerTC(k.tc), port, x, ledChunkSec())
			if err == nil && !strings.Contains(raw, "<ENVELOPE") {
				err = fmt.Errorf("Tally's answer could not be read: %s", cut(flat(raw), 120))
			}
			if err == nil && reTallyLineErr.MatchString(raw) {
				err = fmt.Errorf("Tally answered with an error: %s", cut(flat(raw), 160))
			}
			if err != nil {
				if gaveWay(err) || (!tallyNoAnswer(err) && probeHold(port) != nil) {
					return false, err // not sent, or Tally still busy with it: the round goes on later
				}
				if tallyNoAnswer(err) {
					st[dk+"Miss"] = toInt(st[dk+"Miss"]) + 1
					if toInt(st[dk+"Miss"]) >= 2 {
						st[dk+"Off"], st[dk+"Miss"] = BridgeVersion, 0
					}
				}
				why := cut(err.Error(), 200)
				if errors.Is(err, errRecorderStop) {
					why = "Tally took longer than 2 s"
				}
				writeLog(fmt.Sprintf("Keeping %s: %s were not read (%s); the ledger list goes on without them this time", company, sp.what, why))
				ls[dk+"Done"], ls[dk+"Skip"], ls[dk] = true, true, nil
				save()
				break
			}
			rows, top := sp.rows(raw)
			ls[dk] = append(arr(ls[dk]), rows...)
			ls[dk+"Began"] = true
			ls["reqs"] = toInt(ls["reqs"]) + 1
			if tail {
				ls[dk+"Done"] = true
				delete(st, dk+"Miss")
				if sp.daily {
					st[dk+"Day"] = tallyDate(nowFn())
				}
			} else {
				ls[dk+"After"] = upto
				if top > bound {
					ls["bound"] = top
				}
			}
			save()
			sec := time.Since(t1).Seconds()
			writeLog(fmt.Sprintf("Keeping %s: %s, %d (%.1fs)", company, sp.what, len(rows), sec))
			keepRest(time.Duration(maxI(200, int(sec*500))) * time.Millisecond)
		}
	}
	return true, nil
}

// the round's books masters, by kind, each once by GUID (the last read wins); a kind the round gave up is left out
// (FinCom keeps what it has); nil when none
func booksOfRound(ls M) M {
	o := M{}
	for _, sp := range booksSpecs {
		dk := "bm_" + sp.key
		if !truthy(ls[dk+"Done"]) || truthy(ls[dk+"Skip"]) {
			continue
		}
		by, order := map[string]any{}, []string{}
		for _, x := range arr(ls[dk]) {
			g := str(at(arr(x), 0))
			if g == "" {
				continue
			}
			if _, had := by[g]; !had {
				order = append(order, g)
			}
			by[g] = x
		}
		l := []any{}
		for _, g := range order {
			l = append(l, by[g])
		}
		o[sp.key] = l
	}
	if len(o) == 0 {
		return nil
	}
	return o
}

// the books' masters into the outbox (ledOutMu held); nil: the last sent stay
func setLedOutBooksLocked(dir string, books M) {
	if books == nil {
		return
	}
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		return
	}
	o["books"] = books
	_ = saveFile(ledOutFile(dir), jsonText(o))
}

var errGroupClosingRefused = errors.New("FinCom Bridge asks Tally for the groups' closing balances only in the daily tie-out, as built, under the 2-second stop; nothing was sent to Tally")

// --- C8's gate: the tie-out's request now
var tieAsking struct {
	sync.Mutex
	x string
}

func groupClosingAsking(tc *TC, x string) bool {
	if tc == nil || tc.limitMs <= 0 || tc.limitMs > 2000 || x != groupClosingRequest(pinCo(x), group(`<SVTODATE[^>]*>(\d{8})</SVTODATE>`, x, 1)) {
		return false
	}
	tieAsking.Lock()
	defer tieAsking.Unlock()
	return tieAsking.x != "" && tieAsking.x == x
}

// --- C8 (option a): the daily tie-out, in the daily idle catch-up only (runReq.day), once a day per company, after the
// company's other reads of the run answered (Tally warm; never the first request after Tally starts), only while Tally
// has been left alone for the heavy tier's wait (60 s), no posting going, one request in flight, under the 2 s stop. A
// stop, a window held 2 s or no answer: not asked again that day ("Tally was slow, tried tomorrow"). Kept in
// tieout.json ({company: {day, ok, why}}), so a restart or a second catch-up the same day does not ask again
func tieOutFile() string { return sp("tieout.json") }

var tieMu sync.Mutex

func tieOutDone(company, day string) bool {
	tieMu.Lock()
	defer tieMu.Unlock()
	return str(obj(readObjFile(tieOutFile())[companyKey(company)])["day"]) == day
}

func tieOutNote(company, day string, ok bool, why string) {
	tieMu.Lock()
	defer tieMu.Unlock()
	all := readObjFile(tieOutFile())
	if all == nil {
		all = M{}
	}
	all[companyKey(company)] = M{"company": company, "day": day, "ok": ok, "why": cutRunes(why, 200), "at": nowS()}
	_ = saveFile(tieOutFile(), jsonText(all))
}

func (k *keepRun) tieOut(company string, port int) {
	if !k.day || !confirmedGroupClosing() || port <= 0 {
		return
	}
	d := tallyDate(nowFn())
	if tieOutDone(company, d) || postingGoing() || k.holdNow() != "" {
		return
	}
	if pullQuietSec(pullItem{Company: company, CGUID: heldGUID(company)}) < float64(pullIdleSec()) {
		return // the heavy tier: Tally left alone a minute (tried at the next catch-up of the day)
	}
	x := groupClosingRequest(company, d)
	if x == "" {
		return
	}
	tieAsking.Lock()
	tieAsking.x = x
	tieAsking.Unlock()
	defer func() {
		tieAsking.Lock()
		tieAsking.x = ""
		tieAsking.Unlock()
	}()
	held := windowHoldFn()
	var took float64
	tc := ledgerTC(k.tc)
	tc.timed = func(sec float64) { took += sec }
	tc.yield = func() bool { return postingGoing() || importsInFlight.Load() > 0 }
	raw, err := invokeTally(tc, port, x, 5)
	holdMs := 0
	if took > 0 {
		holdMs = held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	}
	if gaveWay(err) {
		return // nothing reached Tally: tried at the next catch-up
	}
	if err == nil && (!wholeEnvelope(raw) || reTallyLineErr.MatchString(raw)) {
		err = errors.New("Tally's answer could not be read")
	}
	if err == nil && holdMs >= 2000 {
		err = fmt.Errorf("Tally's window did not answer for %.1f s", float64(holdMs)/1000)
	}
	if err != nil {
		why := cut(err.Error(), 160)
		if errors.Is(err, errRecorderStop) {
			why = "Tally took longer than 2 s"
		}
		tieOutNote(company, d, false, why)
		writeLog(fmt.Sprintf("Tie-out of %s: Tally was slow (%s); tried tomorrow", company, why))
		return
	}
	rows := groupClosingRowsOf(raw)
	r := invokeCloud(M{"kind": "tieout_groups", "company": company, "company_guid": heldGUID(company), "at": d, "groups": rows}, 30)
	ok := r.code == 200 && r.json != nil && truthy(r.json["ok"])
	tieOutNote(company, d, ok, map[bool]string{true: "", false: or(r.err, fmt.Sprint("HTTP ", r.code))}[ok])
	writeLog(fmt.Sprintf("Tie-out of %s: the main groups' closing balances at %s, %d groups (%.1fs)%s", company, liveDay(d), len(rows), took,
		map[bool]string{true: "", false: "; FinCom did not take them (" + or(r.err, fmt.Sprint("HTTP ", r.code)) + "), asked again tomorrow"}[ok]))
}
