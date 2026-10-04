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
	"FinComFree":         {purpose: "the small check after a timeout when no company is named: the companies' names and GUIDs"},
	"Day Book":           {purpose: "the day book of one company for one month at most (Update now, the nightly run, a FinCom read)"},
	"TDSDeskVchHeads":    {purpose: "voucher heads (Optional ones too) of one company for one month at most, no ledger lines"},
	"TDSDeskKeepList":    {purpose: "one month's entries as GUID, AlterID and date only (the copy's check)"},
	ledListID:            {purpose: "the ledger list, 2,000 MasterIDs a request at most, stored master fields only"},
	grpListID:            {purpose: "the group list, stored master fields only"},
	"TDSDeskLedgers":     {purpose: "ledger masters for FinCom's /ledgers, 2,000 MasterIDs a request at most, stored fields only"},
	"TDSDeskGroups":      {purpose: "groups for FinCom's /ledgers (name, parent, GUID)"},
	"TDSDeskNames":       {purpose: "ledger names and groups, 2,000 MasterIDs a request at most"},
	"TDSDeskGroupNames":  {purpose: "group names and parents"},
	dupCheckID:           {purpose: "the duplicate check before a posting: one date's entries (for one party)", aux: nil},
	tagCheckID:           {purpose: "the FinCom id check: one date's entries, heads and narration only"},
	masterCheckID:        {purpose: "the posting read-back by Tally's voucher id (LASTVCHID): one month's entries filtered to that one MasterID, heads and narration only"},
	"Import":             {purpose: "a posting or a deletion (Import Data)"},
	vchByMasterID:        {purpose: "the recorder's body fetch (2.2.0): the entries just changed, by MasterID (50 at most), the line's own date as the period, the fields FinCom's day parse reads"},
	"FinComMeasureB":     {purpose: "measure: entries above an AlterID over the year", measureOnly: true},
	"FinComMeasureC":     {purpose: "measure: entries above an AlterID, one month", measureOnly: true},
	"FinComMeasureYear":  {purpose: "measure: the year's entries, dates only", measureOnly: true},
	"FinComMeasureD":     {purpose: "measure: one month's GUIDs only", measureOnly: true},
	"FinComMeasureE":     {purpose: "measure: one entry by its AlterID", measureOnly: true},
	"FinComMeasureNames": {purpose: "measure: every ledger's name", measureOnly: true},
	"FinComMeasureLedF":  {purpose: "measure: one ledger's master fields", measureOnly: true},
	"FinComMeasureLedO":  {purpose: "measure: one ledger's stored opening (the field, no period)", measureOnly: true},
	"FinComSnapshot":     {purpose: "measure: one month's entries as GUID, AlterID, date, type and number", measureOnly: true},
}

// Simulated cost of one row Tally sends back (the size test, size_test.go): a conservative guess until phase 1's
// measurement on ZZ BIG TEST replaces it
const tallyPerRowMs = 0.5

// the measuring tool is running (measure-only ids may go)
var measuring atomic.Int32

// an Import Data request as importEnvelope makes it: its fixed header at the start (anchored)
func isImportRequest(x string) bool { return strings.HasPrefix(x, importHead) }

// a request's id: "Import" for every Import Data request; else the collection's ID; else the report's name
func tallyRequestID(x string) string {
	if isImportRequest(x) {
		return "Import"
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
	return nil
}

// each id's request as its builder makes it, with fixed inputs: its shape is fingerprinted in the table
func allowListSamples() map[string]string {
	const c, a, z = "SAMPLE CO", "20260401", "20260430"
	return map[string]string{
		"TDSDeskCompanies":   companiesRequest(),
		"TDSDeskCompanyInfo": coInfoRequest(c),
		"FinComCompany":      companyCheckRequest(c),
		"FinComFree":         companyCheckRequest(""),
		"Day Book":           dayBookRequest(c, a, z),
		"TDSDeskVchHeads":    vchHeadsRequest(c, a, z),
		"TDSDeskKeepList":    keepListRequest(c, a, z, 0),
		ledListID:            ledgerChunkRequest(c, 0, 2000),
		grpListID:            groupListRequest(c),
		"TDSDeskLedgers":     ledgersFullRequest(c, 0, 2000),
		"TDSDeskGroups":      groupsFullRequest(c),
		"TDSDeskNames":       namesRequest(c, 0, 2000),
		"TDSDeskGroupNames":  groupNamesRequest(c),
		dupCheckID:           dupCheckRequest(c, a, "SAMPLE PARTY"),
		tagCheckID:           tagCheckRequest(c, a),
		masterCheckID:        masterCheckRequest(c, a, z, "1"),
		vchByMasterID:        voucherByMasterRequest(c, a, []string{"1", "2"}),
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
