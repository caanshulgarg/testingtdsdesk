// The allow-list of requests to Tally (plan item 7). Every request the bridge may send to Tally has an id (the
// collection's ID, the report's name, or "Import" for every posting and deletion) and is on this fixed table with its
// purpose and the worst-case seconds measured on ZZ BIG TEST (0: not yet measured) with the date measured. invokeTally
// refuses any request whose id is not here before anything is sent. A measure-only id is sent only while the measuring
// tool runs.
//
// The table, with each request's shape (a fingerprint of the request as its builder makes it), is kept in
// docs/tally-allowlist.md; TestAllowListUnchanged fails when the two differ, so a new or changed request needs a new
// measurement (and a new row in the doc) before it can be built.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"sync/atomic"
)

type allowedReq struct {
	purpose     string
	maxSec      float64 // worst case measured on ZZ BIG TEST; 0 = not yet measured
	measuredOn  string  // yyyy-mm-dd of that measurement; "" = not yet
	measureOnly bool    // sent only by the measuring tool (Measure Tally, for FinCom support)
	aux         []string
}

// the ids allowed, and why
var tallyAllowList = map[string]allowedReq{
	"TDSDeskCompanies":   {purpose: "the companies loaded in Tally (name, books' period, GUID)"},
	"TDSDeskCompanyInfo": {purpose: "one company's GSTIN and PAN, once when it is first seen", aux: []string{"TDSDeskUnused"}},
	"FinComCompany":      {purpose: "the company check: one company's name, GUID and highest AlterIDs (also the small check after a timeout)"},
	cnReportID:           {purpose: "the company's change numbers (2.2.0, form b): a report over the one company, its name, GUID, AltVchId and AltMstId", aux: []string{"FinComCNCos"}},
	"FinComFree":         {purpose: "the small check after a timeout when no company is named: the companies' names and GUIDs"},
	"Day Book":           {purpose: "the day book of one company for one month at most (Update now, the nightly run, a FinCom read)"},
	"TDSDeskVchHeads":    {purpose: "voucher heads (Optional ones too) of one company for one month at most, no ledger lines"},
	"TDSDeskKeepList":    {purpose: "one month's entries as GUID, AlterID and date only (the copy's check)"},
	ledListID:            {purpose: "the ledger list, 2,000 MasterIDs a request at most, stored master fields only (2.3.1: the party's deductee type too)"},
	// 2.3.1 (the owner's decision of 06-Oct-2026, masters): the ledgers changed since the master counter last moved, and
	// one ledger an entry names that FinCom does not have (ledchanges.go)
	ledChangesID:        {purpose: "the ledgers created or altered since Tally's master counter last moved (2.3.1): AlterID above the last number, 200 AlterIDs a request at most, the ledger list's stored master fields only"},
	ledByNameID:         {purpose: "one ledger an entry uses that FinCom does not have, by its name (2.3.1), fetched before the entry is applied: the ledger list's stored master fields only"},
	grpListID:           {purpose: "the group list, stored master fields only"},
	"TDSDeskLedgers":    {purpose: "ledger masters for FinCom's /ledgers, 2,000 MasterIDs a request at most, stored fields only"},
	"TDSDeskGroups":     {purpose: "groups for FinCom's /ledgers (name, parent, GUID)"},
	"TDSDeskNames":      {purpose: "ledger names and groups, 2,000 MasterIDs a request at most"},
	"TDSDeskGroupNames": {purpose: "group names and parents"},
	dupCheckID:          {purpose: "the duplicate check before a posting: one date's entries (for one party)", aux: nil},
	tagCheckID:          {purpose: "the FinCom id check: one date's entries, heads and narration only"},
	masterCheckID:       {purpose: "the posting read-back by Tally's voucher id (LASTVCHID): one month's entries filtered to that one MasterID, heads and narration only"},
	"Import":            {purpose: "a posting or a deletion (Import Data)"},
	sliceID:             {purpose: "the recorder's source C (2.2.0, off by default): one month's entries above an AlterID as GUID, MasterID, AlterID and date, in the date form the read test kept"},
	datesProbeID:        {purpose: "measure (the read test): one past-year month's entries as GUID, MasterID, AlterID and date, in each date form", measureOnly: true},
	editLogProbeID:      {purpose: "measure (the read test): one entry by MasterID with its edit-log sub-collection (candidate names)", measureOnly: true},
	// next-fastfetch (the owner's approval of 07-Oct-2026 and decision of 08-Oct-2026): replaces FinComVoucherByMaster
	vchObjectID:          {purpose: "the entry request (next-fastfetch, replacing FinComVoucherByMaster): ONE voucher by its MasterID, Tally's object export ID:<MasterID> (keyed: it does not read every voucher of the company), its FETCHLIST the approved fields of FinComVoucherByMaster; Tally sends the whole voucher and the bridge keeps exactly those fields (ledger lines as ALLLEDGERENTRIES), dropping the rest before anything is logged, stored or sent; read only, no period"},
	vchByNumberID:        {purpose: "the recorder's new entry (2.2.1): one entry by its voucher type and number, the line's own date as the period, the body fetch's fields (2.3.1: the whole entry, as the body fetch)"},
	"FinComMeasureB":     {purpose: "measure: entries above an AlterID over the year", measureOnly: true},
	"FinComMeasureC":     {purpose: "measure: entries above an AlterID, one month", measureOnly: true},
	"FinComMeasureYear":  {purpose: "measure: the year's entries, dates only", measureOnly: true},
	"FinComMeasureD":     {purpose: "measure: one month's GUIDs only", measureOnly: true},
	"FinComMeasureE":     {purpose: "measure: one entry by its AlterID", measureOnly: true},
	"FinComMeasureNames": {purpose: "measure: every ledger's name", measureOnly: true},
	"FinComMeasureLedF":  {purpose: "measure: one ledger's master fields", measureOnly: true},
	"FinComMeasureLedO":  {purpose: "measure: one ledger's stored opening (the field, no period)", measureOnly: true},
	"FinComSnapshot":     {purpose: "measure: one month's entries as GUID, AlterID, date, type and number", measureOnly: true},
	// 2.2.3 (the owner's request, 05-Oct-2026): "Test fetching an entry" (fetchtest.go), the forms of
	// docs/diagnostics/2.2.2-fetch-check.ps1 for one voucher, a person's tray item only
	// 2.3.4 (the owner, 08-Oct-2026): forms A and C removed; B, D, E and F as before (their purposes name the 2.2.2 forms)
	fetchTestB: {purpose: "measure (Test fetching an entry): form B, form A with plain quote marks in the filter", measureOnly: true},
	fetchTestD: {purpose: "measure (Test fetching an entry): form D, form C with no dates", measureOnly: true},
	fetchTestE: {purpose: "measure (Test fetching an entry): form E, form C with the dates as d-MMM-yyyy TYPE=Date", measureOnly: true},
	fetchTestF: {purpose: "measure (Test fetching an entry): form F, form B with no dates", measureOnly: true},
}

// Simulated cost of one row Tally sends back (the size test, size_test.go): a conservative guess until phase 1's
// measurement on ZZ BIG TEST replaces it
const tallyPerRowMs = 0.5

// the measuring tool is running (measure-only ids may go)
var measuring atomic.Int32

// an Import Data request as importEnvelope makes it: its fixed header at the start (anchored)
func isImportRequest(x string) bool { return strings.HasPrefix(x, importHead) }

// a request's id: "Import" for every Import Data request; the object export of a voucher vchObjectID (next-fastfetch); else
// the collection's ID; else the report's name
func tallyRequestID(x string) string {
	if isImportRequest(x) {
		return "Import"
	}
	if id, ok := objectRequestID(x); ok {
		return id
	}
	if id := strings.TrimSpace(group(`<ID>([^<]+)</ID>`, x, 1)); id != "" {
		return id
	}
	return strings.TrimSpace(group(`<REPORTNAME>([^<]+)</REPORTNAME>`, x, 1))
}

type notAllowedError struct{ id, why string }

func (e *notAllowedError) Error() string {
	id := e.id
	if id == "" {
		id = "(no id)"
	}
	return "The request " + id + " is not on the bridge's allow-list of requests to Tally (" + e.why + "); nothing was sent to Tally"
}

// nil when the request may go to Tally
func checkAllowed(x string) error {
	id := tallyRequestID(x)
	a, ok := tallyAllowList[id]
	if !ok {
		return &notAllowedError{id, "not on the list"}
	}
	if a.measureOnly && measuring.Load() == 0 {
		return &notAllowedError{id, "measure-only, and the measuring tool is not running"}
	}

	if id == "Import" {
		if !pinnedToBuilder(id, x) {
			return &pinRefusedError{id}
		}
		return nil
	}
	// a collection request carries only its own collection (and its listed helpers): the id is what goes
	for _, m := range re(`<COLLECTION NAME="([^"]*)"`).FindAllStringSubmatch(x, -1) {
		if m[1] != id && !contains(a.aux, m[1]) {
			return &notAllowedError{id, "it carries another collection, " + m[1]}
		}
	}
	for _, m := range re(`<REPORTNAME>([^<]*)</REPORTNAME>`).FindAllStringSubmatch(x, -1) {
		if rn := strings.TrimSpace(m[1]); rn != id {
			return &notAllowedError{id, "it asks for the report " + rn}
		}
	}
	for _, m := range re(`<ID>([^<]*)</ID>`).FindAllStringSubmatch(x, -1) {
		if strings.TrimSpace(m[1]) != id {
			return &notAllowedError{id, "it carries another id, " + m[1]}
		}
	}
	// round 5 of the 2.2.0 reviews: the request must be exactly what the bridge's builder makes for this id (pinned.go);
	// round 6 R6-2: the words name the bridge
	if !pinnedToBuilder(id, x) {
		return &pinRefusedError{id}
	}
	return nil
}

type pinRefusedError struct{ id string }

func (e *pinRefusedError) Error() string {
	why := "the " + or(e.id, "request") + " request differs from what the bridge builds"
	if e.id == "Import" {
		why = "the posting holds something other than vouchers, ledgers, groups or a voucher type's numbering, as FinCom sends them"
	}
	return "FinCom Bridge refused to send this (it is not a request FinCom builds): " + why + "; nothing was sent to Tally"
}

// each id's request as its builder makes it, with fixed inputs: its shape is fingerprinted in the table
func allowListSamples() map[string]string {
	const c, a, z = "SAMPLE CO", "20260401", "20260430"
	return map[string]string{
		"TDSDeskCompanies":   companiesRequest(),
		"TDSDeskCompanyInfo": coInfoRequest(c),
		"FinComCompany":      companyCheckRequest(c),
		"FinComFree":         companyCheckRequest(""),
		cnReportID:           companyNumbersRequest(c),
		"Day Book":           dayBookRequest(c, a, z),
		"TDSDeskVchHeads":    vchHeadsRequest(c, a, z),
		"TDSDeskKeepList":    keepListRequest(c, a, z, 0),
		ledListID:            ledgerChunkRequest(c, 0, 2000),
		ledChangesID:         ledgerChangesRequest(c, 0, 200),
		ledByNameID:          ledgerByNameRequest(c, "SAMPLE LEDGER"),
		grpListID:            groupListRequest(c),
		"TDSDeskLedgers":     ledgersFullRequest(c, 0, 2000),
		"TDSDeskGroups":      groupsFullRequest(c),
		"TDSDeskNames":       namesRequest(c, 0, 2000),
		"TDSDeskGroupNames":  groupNamesRequest(c),
		dupCheckID:           dupCheckRequest(c, a, "SAMPLE PARTY"),
		tagCheckID:           tagCheckRequest(c, a),
		masterCheckID:        masterCheckRequest(c, a, z, "1"),
		vchObjectID:          voucherObjectRequest(c, "1"),
		vchByNumberID:        voucherByNumberRequest(c, a, "Receipt", "1"),
		sliceID:              sliceRequest(c, formPlain, "202604", 1),
		datesProbeID:         datesProbeRequest(c, collFilterGE, a, z),
		editLogProbeID:       editLogProbeRequest(c, "1"),
		"Import":             importEnvelope("Vouchers", c, ""),
		"FinComMeasureB":     measureReqB(c, a, z, 1),
		"FinComMeasureC":     measureReqC(c, a, z, 1),
		"FinComMeasureYear":  measureReqYear(c, a, z),
		"FinComMeasureD":     measureReqD(c, a, z),
		"FinComMeasureE":     measureReqE(c, a, z, 1),
		"FinComMeasureNames": measureReqNames(c),
		"FinComMeasureLedF":  measureReqLedF(c, "SAMPLE LEDGER"),
		"FinComMeasureLedO":  measureReqLedO(c, "SAMPLE LEDGER"),
		"FinComSnapshot":     snapshotRequest(c, a, z),
		fetchTestB:           fetchTestRequest("B", c, a, "Receipt", "1", ""),
		fetchTestD:           fetchTestRequest("D", c, "", "", "", "1"),
		fetchTestE:           fetchTestRequest("E", c, a, "", "", "1"),
		fetchTestF:           fetchTestRequest("F", c, "", "Receipt", "1", ""),
	}
}

func shapeOf(x string) string {
	h := sha256.Sum256([]byte(x))
	return hex.EncodeToString(h[:])[:12]
}

// the table as docs/tally-allowlist.md holds it: one row per id, sorted
func allowListRows() string {
	samples := allowListSamples()
	var ids []string
	for id := range tallyAllowList {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var b strings.Builder
	b.WriteString("| id | purpose | shape | worst case (s) | measured on | used by |\n")
	b.WriteString("|---|---|---|---|---|---|\n")
	for _, id := range ids {
		a := tallyAllowList[id]
		sec, on, by := "not yet measured", "-", "bridge"
		if a.maxSec > 0 {
			sec = fmt.Sprintf("%.1f", a.maxSec)
		}
		if a.measuredOn != "" {
			on = a.measuredOn
		}
		if a.measureOnly {
			by = "measure-only"
		}
		fmt.Fprintf(&b, "| %s | %s | %s | %s | %s | %s |\n", id, a.purpose, shapeOf(samples[id]), sec, on, by)
	}
	return b.String()
}

func allowListHash(rows string) string {
	h := sha256.Sum256([]byte(rows))
	return hex.EncodeToString(h[:])
}

// the table is measured when every row the bridge sends (measure-only rows aside) has a worst case and its date
func allowListMeasured() bool {
	for _, a := range tallyAllowList {
		if !a.measureOnly && (a.maxSec <= 0 || a.measuredOn == "") {
			return false
		}
	}
	return true
}

// in every beat (cloud.go): FinCom's cloud keeps it in the pilot's evidence and refuses to approve a version whose
// bridge reports an unmeasured table (round 2, 02-Oct-2026: 2.1.5 is allowed on the pilot unmeasured, nowhere else)
func allowListBeat() M {
	return M{"measured": allowListMeasured(), "hash": allowListHash(allowListRows())}
}
