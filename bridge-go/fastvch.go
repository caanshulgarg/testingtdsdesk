// next-fastfetch (the owner's approval of 07-Oct-2026 and decision of 08-Oct-2026, "Allow, strip in bridge"): the entry
// request is Tally's object export of ONE voucher by its MasterID ("ID:<MasterID>"), keyed: 7-57 ms at 4,003 vouchers on
// TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (push-design run 37657679690), where FinComVoucherByMaster (a Voucher collection
// filtered by $MasterID) read every voucher of the company (0.13-0.17 ms each: 3.5-4.2 s at 25,000). It replaces
// FinComVoucherByMaster everywhere (the entry fetch, the held lines, the cancel / delete check, the posting check, the
// trial form C); there is no fallback.
//
// Its FETCHLIST names the approved fields (it documents the intent; Tally ignores it and sends the whole stored voucher:
// 1,000-1,500 fields, 3-7 times the bytes). So the bridge keeps EXACTLY the approved fields (liveFetchFields: today's
// FinComVoucherByMaster FETCH, the 13 the owner is still deciding on listed in liveFetchUndecided) and turns the voucher's
// LEDGERENTRIES.LIST into ALLLEDGERENTRIES.LIST (an item invoice's object holds its party and tax lines there, the
// collection answer held them in ALLLEDGERENTRIES); every other field, list, attribute and user-defined field is dropped
// in fetchVouchersByMasterIn, before the answer is logged, stored or sent (fastStripVoucher). FinCom's reader (parse.js)
// reads the stripped voucher exactly as it read today's answer: tests/run_parse_fast234.mjs on the five releases' captures.
package main

import (
	"html"
	"regexp"
	"strings"
)

const vchObjectID = "FinComVoucherObject" // the allow-list's id of the object export of one voucher (tallyRequestID)

// never sent (checkAllowed refuses anything but voucherObjectRequest exactly): on every release (run 37657679690) these
// two got no answer and Tally answered nothing more until it was restarted
const fastNeverForms = "the object export with no FETCHLIST, and a TDL report whose part's object is the voucher: both froze Tally on 3.0 .. 7.1"

// the 13 fields of today's request the owner has not decided on yet (07-Oct-2026): kept until the owner decides; set
// liveFetchUndecidedKept to false and the request and the strip both drop them
var liveFetchUndecided = []string{"PARTYGSTIN", "PLACEOFSUPPLY", "CMPGSTIN", "IRNACKDATE", "ALLLEDGERENTRIES.GSTHSNNAME",
	"ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATE",
	"ALLLEDGERENTRIES.BANKALLOCATIONS.DATE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER",
	"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT", "ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE"}

var liveFetchUndecidedKept = true

// the approved fields, in today's order (liveFetchField, the FETCH of FinComVoucherByMaster at 2.3.3)
func liveFetchFields() []string {
	drop := map[string]bool{}
	if !liveFetchUndecidedKept {
		for _, f := range liveFetchUndecided {
			drop[f] = true
		}
	}
	var o []string
	for _, f := range strings.Split(liveFetchField, ",") {
		if f = strings.TrimSpace(f); f != "" && !drop[f] {
			o = append(o, f)
		}
	}
	return o
}

func fastApprovedPaths() map[string]bool {
	m := map[string]bool{}
	for _, f := range liveFetchFields() {
		m[f] = true
	}
	return m
}

// the request: one voucher by its MasterID (a number, 1 to 18 digits); "" for anything else
func voucherObjectRequest(company, mid string) string {
	if mid == "" || len(mid) > 18 || onlyDigits(mid) != mid || strings.TrimLeft(mid, "0") == "" {
		return ""
	}
	var fl strings.Builder
	for _, f := range liveFetchFields() {
		fl.WriteString("<FETCH>" + f + "</FETCH>")
	}
	return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE>` +
		`<ID TYPE="Name">ID:` + mid + `</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
		`<SVCURRENTCOMPANY>` + esc(company) + `</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST>` + fl.String() + `</FETCHLIST></DESC></BODY></ENVELOPE>`
}

var reObjMid = regexp.MustCompile(`<ID TYPE="Name">ID:(\d+)</ID>`)

// the request's id: the object export of a voucher is vchObjectID; another object type "Object:<type>" (on no list)
func objectRequestID(x string) (string, bool) {
	if !strings.Contains(x, "<TYPE>Object</TYPE>") {
		return "", false
	}
	if st := strings.TrimSpace(group(`<SUBTYPE>([^<]*)</SUBTYPE>`, x, 1)); st != "Voucher" {
		return "Object:" + st, true
	}
	return vchObjectID, true
}

func voucherObjectRebuild(x string) string {
	return voucherObjectRequest(html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)), group(reObjMid.String(), x, 1))
}

// the entry request goes (whatever ReadDays says) only exactly as built, for a company whose starting point is recorded
// (as FinComVoucherByMaster did: Tally's ALTERID above the starting point is the guard on what is taken)
func voucherObjectExact(x string) bool {
	if tallyRequestID(x) != vchObjectID || x != voucherObjectRebuild(x) {
		return false
	}
	_, ok := startPointOf(html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)))
	return ok
}

// --- the strip
type fastEl struct {
	name, attrs, text string
	kids              []*fastEl
	hasKids           bool
}

var reFastTag = regexp.MustCompile(`<(/?)([A-Za-z_][\w.:\-]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*?)?)(/?)>`)

// one <VOUCHER ...>...</VOUCHER> as a tree (its text kept as Tally wrote it); nil when it is not one
func fastTree(v string) *fastEl {
	var root *fastEl
	var st []*fastEl
	last := 0
	for _, m := range reFastTag.FindAllStringSubmatchIndex(v, -1) {
		text := v[last:m[0]]
		last = m[1]
		closing, name := v[m[2]:m[3]] == "/", v[m[4]:m[5]]
		attrs, self := v[m[6]:m[7]], v[m[8]:m[9]] == "/"
		if len(st) > 0 && !st[len(st)-1].hasKids {
			st[len(st)-1].text += text
		}
		if closing {
			if len(st) > 0 && st[len(st)-1].name == name {
				st = st[:len(st)-1]
			}
			continue
		}
		e := &fastEl{name: name, attrs: attrs}
		if len(st) == 0 {
			if root != nil {
				break
			}
			root = e
		} else {
			p := st[len(st)-1]
			p.kids = append(p.kids, e)
			p.hasKids, p.text = true, ""
		}
		if !self {
			st = append(st, e)
		}
	}
	if root == nil || root.name != "VOUCHER" {
		return nil
	}
	return root
}

var reFastAttr = regexp.MustCompile(`\s(REMOTEID|VCHTYPE)="([^"]*)"`)

// Tally's whole voucher -> only the approved fields, LEDGERENTRIES.LIST as ALLLEDGERENTRIES.LIST, the VOUCHER element's
// REMOTEID and VCHTYPE (its GUID and type, both approved fields) and nothing else; "" when it is not a voucher
func fastStripVoucher(v string) string {
	root := fastTree(v)
	if root == nil {
		return ""
	}
	ok := fastApprovedPaths()
	hasAll := false
	for _, k := range root.kids {
		if k.name == "ALLLEDGERENTRIES.LIST" {
			for _, q := range k.kids {
				if q.name == "LEDGERNAME" && strings.TrimSpace(q.text) != "" {
					hasAll = true
				}
			}
		}
	}
	var b strings.Builder
	b.WriteString("<VOUCHER")
	for _, a := range reFastAttr.FindAllStringSubmatch(root.attrs, -1) {
		b.WriteString(" " + a[1] + `="` + a[2] + `"`)
	}
	b.WriteString(">")
	for _, k := range root.kids {
		name := k.name
		if name == "LEDGERENTRIES.LIST" && !hasAll {
			name = "ALLLEDGERENTRIES.LIST"
		}
		fastEmit(&b, k, name, "", ok)
	}
	b.WriteString("</VOUCHER>")
	return b.String()
}

func fastEmit(b *strings.Builder, e *fastEl, name, prefix string, ok map[string]bool) bool {
	seg := strings.TrimSuffix(name, ".LIST")
	p := seg
	if prefix != "" {
		p = prefix + "." + seg
	}
	if e.hasKids || strings.HasSuffix(name, ".LIST") {
		var kb strings.Builder
		any := false
		for _, k := range e.kids {
			if fastEmit(&kb, k, k.name, p, ok) {
				any = true
			}
		}
		if any {
			b.WriteString("<" + name + ">" + kb.String() + "</" + name + ">")
		}
		return any
	}
	if !ok[p] {
		return false
	}
	b.WriteString("<" + name + ">" + e.text + "</" + name + ">")
	return true
}

// the fields a stripped voucher holds, as fetch paths (ALLLEDGERENTRIES.BILLALLOCATIONS.NAME)
func fastLeafPaths(s string) []string {
	root := fastTree(s)
	if root == nil {
		return nil
	}
	var o []string
	var walk func(e *fastEl, prefix string)
	walk = func(e *fastEl, prefix string) {
		seg := strings.TrimSuffix(e.name, ".LIST")
		p := seg
		if prefix != "" {
			p = prefix + "." + seg
		}
		if !e.hasKids {
			o = append(o, p)
			return
		}
		for _, k := range e.kids {
			walk(k, p)
		}
	}
	for _, k := range root.kids {
		walk(k, "")
	}
	return o
}
