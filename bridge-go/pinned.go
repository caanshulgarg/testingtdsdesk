// Bridge 2.2.0, round 5 of the reviews: every request id is pinned to its builder. checkAllowed (allowlist.go) lets a
// request go only when it is byte-identical to what the bridge's own builder makes for that id, rebuilt from the
// request's own parameters (company, dates, AlterIDs, MasterIDs, ledger ranges, a party or ledger name). A wrong caller
// can no longer widen an id: another TYPE, field, filter, report or one character more is refused before anything is
// sent. Import (a posting, free content) is held to its fixed envelope: the Import Data header, one of the bridge's two
// reports, the company, and one TALLYMESSAGE holding VOUCHER and LEDGER objects only. The id-based ReadDays-off guard
// and the value checks (tally.go datedRefused, sliceExact, voucherByMasterExact, keepAboveExact) stay on top.
package main

import (
	"html"
	"regexp"
	"strings"
)

// the request's own parameters, as text
func pinCo(x string) string {
	return html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
}

// the period: SVFROMDATE / SVTODATE in any of the bridge's forms, else the $$Date literals of a filter form; yyyymmdd
func pinDates(x string) (string, string) {
	a := normDate(html.UnescapeString(group(`<SVFROMDATE[^>]*>([^<]*)</SVFROMDATE>`, x, 1)))
	z := normDate(html.UnescapeString(group(`<SVTODATE[^>]*>([^<]*)</SVTODATE>`, x, 1)))
	if a == "" {
		lits := regexp.MustCompile(`\$\$Date:&#34;([^&]*)&#34;`).FindAllStringSubmatch(x, 2)
		if len(lits) == 2 {
			a, z = normDate(lits[0][1]), normDate(lits[1][1])
		}
	}
	return a, z
}

func pinNum(x, pattern string) int64 { return toI64(group(pattern, x, 1)) }

// the MasterID range of a ledger request: (after, upto], upto 0 when there is none
func pinMasterRange(x string) (int64, int64) {
	m := regexp.MustCompile(`\$MasterID &gt; (\d+)(?: AND \$MasterID &lt;= (\d+))?`).FindStringSubmatch(x)
	if m == nil {
		return -1, -1
	}
	return toI64(m[1]), toI64(m[2])
}

// a name in a filter: "field = &#34;name&#34;" (a filter escaped whole) or "field = "name"" (dupCheckRequest)
func pinQuoted(x, field string) string {
	if m := regexp.MustCompile(regexp.QuoteMeta(field) + ` = &#34;(.*?)&#34;</SYSTEM>`).FindStringSubmatch(x); m != nil {
		return html.UnescapeString(m[1])
	}
	return html.UnescapeString(group(regexp.QuoteMeta(field)+` = "(.*?)"</SYSTEM>`, x, 1))
}

func pinOne(f func(x string) string) func(string) []string {
	return func(x string) []string { return []string{f(x)} }
}

// id -> the requests its builders make from this request's parameters
var requestRebuild = map[string]func(x string) []string{
	"TDSDeskCompanies":   pinOne(func(string) string { return companiesRequest() }),
	"TDSDeskCompanyInfo": pinOne(func(x string) string { return coInfoRequest(pinCo(x)) }),
	"FinComCompany":      pinOne(func(x string) string { return companyCheckRequest(pinCo(x)) }),
	"FinComFree":         pinOne(func(string) string { return companyCheckRequest("") }),
	cnReportID:           pinOne(func(x string) string { return companyNumbersRequest(pinCo(x)) }),
	"Day Book": func(x string) []string {
		a, z := pinDates(x)
		var o []string
		for _, f := range dateForms {
			o = append(o, dayBookRequestForm(pinCo(x), f, a, z))
		}
		return o
	},
	"TDSDeskVchHeads": pinOne(func(x string) string { a, z := pinDates(x); return vchHeadsRequest(pinCo(x), a, z) }),
	"TDSDeskKeepList": func(x string) []string {
		a, z := pinDates(x)
		n := pinNum(x, `\$AlterID &gt; (\d+)`)
		return []string{keepListRequest(pinCo(x), a, z, n), keepListAboveRequest(pinCo(x), n)}
	},
	ledListID: pinOne(func(x string) string { a, u := pinMasterRange(x); return ledgerChunkRequest(pinCo(x), a, u) }),
	// 2.3.1 (masters): an AlterID span with both ends, and one ledger by its name
	ledChangesID: func(x string) []string {
		m := regexp.MustCompile(`\$AlterID &gt; (\d+) AND \$AlterID &lt;= (\d+)</SYSTEM>`).FindStringSubmatch(x)
		if m == nil {
			return nil
		}
		return []string{ledgerChangesRequest(pinCo(x), toI64(m[1]), toI64(m[2]))}
	},
	ledByNameID:         pinOne(func(x string) string { return ledgerByNameRequest(pinCo(x), pinQuoted(x, "$Name")) }),
	grpListID:           pinOne(func(x string) string { return groupListRequest(pinCo(x)) }),
	"TDSDeskLedgers":    pinOne(func(x string) string { a, u := pinMasterRange(x); return ledgersFullRequest(pinCo(x), a, u) }),
	"TDSDeskGroups":     pinOne(func(x string) string { return groupsFullRequest(pinCo(x)) }),
	"TDSDeskNames":      pinOne(func(x string) string { a, u := pinMasterRange(x); return namesRequest(pinCo(x), a, u) }),
	"TDSDeskGroupNames": pinOne(func(x string) string { return groupNamesRequest(pinCo(x)) }),
	dupCheckID: pinOne(func(x string) string {
		a, _ := pinDates(x)
		return dupCheckRequest(pinCo(x), a, pinQuoted(x, "$PartyLedgerName"))
	}),
	tagCheckID: pinOne(func(x string) string { a, _ := pinDates(x); return tagCheckRequest(pinCo(x), a) }),
	masterCheckID: pinOne(func(x string) string {
		a, z := pinDates(x)
		return masterCheckRequest(pinCo(x), a, z, group(`\$MasterID = (\d+)`, x, 1))
	}),
	vchByMasterID: pinOne(func(x string) string {
		a, _ := pinDates(x)
		var ids []string
		for _, m := range regexp.MustCompile(`\$MasterID = (\d+)`).FindAllStringSubmatch(x, -1) {
			ids = append(ids, m[1])
		}
		return voucherByMasterRequest(pinCo(x), a, ids)
	}),
	vchByNumberID: pinOne(func(x string) string {
		a, _ := pinDates(x)
		no := html.UnescapeString(group(`\$VoucherNumber = &#34;(.*?)&#34; AND`, x, 1))
		return voucherByNumberRequest(pinCo(x), a, pinQuoted(x, "$VoucherTypeName"), no)
	}),
	sliceID: func(x string) []string {
		a, _ := pinDates(x)
		if len(a) != 8 {
			return nil
		}
		var o []string
		for _, f := range collForms {
			o = append(o, sliceRequest(pinCo(x), f, a[:6], pinNum(x, `\$AlterID &gt; (\d+)`)))
		}
		return o
	},
	datesProbeID: func(x string) []string {
		a, z := pinDates(x)
		var o []string
		for _, f := range collForms {
			o = append(o, datesProbeRequest(pinCo(x), f, a, z))
		}
		return o
	},
	editLogProbeID: pinOne(func(x string) string { return editLogProbeRequest(pinCo(x), group(`\$MasterID = (\d+)`, x, 1)) }),
	"Import":       func(x string) []string { return importRebuild(x) },
	"FinComMeasureB": pinOne(func(x string) string {
		a, z := pinDates(x)
		return measureReqB(pinCo(x), a, z, pinNum(x, `\$AlterID &gt; (\d+)`))
	}),
	"FinComMeasureC": pinOne(func(x string) string {
		a, z := pinDates(x)
		return measureReqC(pinCo(x), a, z, pinNum(x, `\$AlterID &gt; (\d+)`))
	}),
	"FinComMeasureYear": pinOne(func(x string) string { a, z := pinDates(x); return measureReqYear(pinCo(x), a, z) }),
	"FinComMeasureD":    pinOne(func(x string) string { a, z := pinDates(x); return measureReqD(pinCo(x), a, z) }),
	"FinComMeasureE": pinOne(func(x string) string {
		a, z := pinDates(x)
		return measureReqE(pinCo(x), a, z, pinNum(x, `\$AlterID = (\d+)`))
	}),
	"FinComMeasureNames": pinOne(func(x string) string { return measureReqNames(pinCo(x)) }),
	"FinComMeasureLedF":  pinOne(func(x string) string { return measureReqLedF(pinCo(x), pinQuoted(x, "$Name")) }),
	"FinComMeasureLedO":  pinOne(func(x string) string { return measureReqLedO(pinCo(x), pinQuoted(x, "$Name")) }),
	"FinComSnapshot":     pinOne(func(x string) string { a, z := pinDates(x); return snapshotRequest(pinCo(x), a, z) }),
	// 2.2.2: "Test fetching an entry" (fetchtest.go)
	fetchTestA: fetchTestRebuild("A"), fetchTestB: fetchTestRebuild("B"), fetchTestC: fetchTestRebuild("C"),
	fetchTestD: fetchTestRebuild("D"), fetchTestE: fetchTestRebuild("E"), fetchTestF: fetchTestRebuild("F"),
}

// the bridge's two import reports, and the objects a posting may carry
var importReports = []string{"Vouchers", "All Masters"}

var (
	reImportObj   = regexp.MustCompile(`^<(VOUCHER|LEDGER|GROUP|VOUCHERTYPE)\b[^>]*>`)
	reImportNever = regexp.MustCompile(`(?i)<\s*/?\s*(TDL|TDLMESSAGE|COLLECTION|REPORT|FORM|PART|LINE|FIELD|SYSTEM|TALLYMESSAGE|ENVELOPE|HEADER|BODY|DESC|STATICVARIABLES|IMPORTDATA|EXPORTDATA|REQUESTDESC|REQUESTDATA|TALLYREQUEST)\b|<!\[CDATA\[|<!DOCTYPE|<\?`)
)

// an Import as importEnvelope builds it: the request itself when its report is one of the two and its body is one
// TALLYMESSAGE (or none) holding objects the posting rule accepts (post.go cannotSend, the one source of truth: VOUCHER
// with a date, LEDGER, GROUP, a VOUCHERTYPE's numbering), with white space before, after and between them, none
// carrying a request's own markup, CDATA, a DOCTYPE or a processing instruction (round 6 R6-1: FinCom's own XML ends
// each object with a line break)
func importRebuild(x string) []string {
	if !strings.HasPrefix(x, importHead) {
		return nil
	}
	rest := x[len(importHead):]
	i := strings.Index(rest, "</REPORTNAME>")
	if i < 0 || !contains(importReports, rest[:i]) {
		return nil
	}
	report := rest[:i]
	a := strings.Index(x, "<REQUESTDATA>")
	z := strings.LastIndex(x, "</REQUESTDATA>")
	if a < 0 || z < a {
		return nil
	}
	body := x[a+len("<REQUESTDATA>") : z]
	if body != "" {
		const open, close = `<TALLYMESSAGE xmlns:UDF="TallyUDF">`, "</TALLYMESSAGE>"
		if !strings.HasPrefix(body, open) || !strings.HasSuffix(body, close) {
			return nil
		}
		in := body[len(open) : len(body)-len(close)]
		for {
			in = strings.TrimLeft(in, " \t\r\n")
			if in == "" {
				break
			}
			m := reImportObj.FindStringSubmatch(in)
			if m == nil {
				return nil
			}
			end := strings.Index(in, "</"+m[1]+">")
			if end < 0 {
				return nil
			}
			obj := in[:end+len("</"+m[1]+">")]
			if reImportNever.MatchString(obj) || (cannotSend(obj) != "" && !deletionShape(obj)) {
				return nil
			}
			in = in[len(obj):]
		}
	}
	return []string{importEnvelope(report, pinCo(x), body)}
}

// the request is exactly one its id's builders make from its own parameters
func pinnedToBuilder(id, x string) bool {
	rb := requestRebuild[id]
	if rb == nil {
		return false
	}
	for _, y := range rb(x) {
		if y == x {
			return true
		}
	}
	return false
}
