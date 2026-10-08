// next-fastfetch (the owner's approval of 07-Oct-2026 and decision of 08-Oct-2026, "Allow, strip in bridge"): the entry
// request is Tally's object export of ONE voucher by its MasterID ("ID:<MasterID>"), keyed: 7-57 ms at 4,003 vouchers on
// TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (push-design run 37657679690), where FinComVoucherByMaster (a Voucher collection
// filtered by $MasterID) read every voucher of the company (0.13-0.17 ms each: 3.5-4.2 s at 25,000). It replaces
// FinComVoucherByMaster everywhere (the entry fetch, the held lines, the cancel / delete check, the posting check, the
// trial form C); there is no fallback.
//
// Its FETCHLIST names the approved fields (it documents the intent; Tally ignores it and sends the whole stored voucher:
// 1,000-1,500 fields, 3-7 times the bytes). So the bridge keeps EXACTLY the approved fields (liveFetchFields: today's
// FinComVoucherByMaster FETCH, every field approved by the owner: the last 13 on 08-Oct-2026) and turns the voucher's
// LEDGERENTRIES.LIST into ALLLEDGERENTRIES.LIST (an item invoice's object holds its party and tax lines there, the
// collection answer held them in ALLLEDGERENTRIES); every other field, list, attribute and user-defined field is dropped
// in fetchVouchersByMasterIn, before the answer is logged, stored or sent (fastStripVoucher). FinCom's reader (parse.js)
// reads the stripped voucher exactly as it read today's answer: tests/run_parse_fast234.mjs on the five releases' captures.
package main

import (
	"errors"
	"html"
	"regexp"
	"strings"
)

const vchObjectID = "FinComVoucherObject" // the allow-list's id of the object export of one voucher (tallyRequestID)

// never sent (checkAllowed refuses anything but voucherObjectRequest exactly): on every release (run 37657679690) these
// two got no answer and Tally answered nothing more until it was restarted
const fastNeverForms = "the object export with no FETCHLIST, and a TDL report whose part's object is the voucher: both froze Tally on 3.0 .. 7.1"

// the 13 fields of the entry request the owner approved on 08-Oct-2026 ("13 fields: all approved. They are read only, inside
// requests already made, and needed for GST, TDS and bank accuracy."; docs/tally-allowlist.md). Kept here as the record of
// that approval; the one place the request's fields (and so the strip's) change is liveFetchField (recorder_live.go)
var liveFetchApproved0810 = []string{"PARTYGSTIN", "PLACEOFSUPPLY", "CMPGSTIN", "IRNACKDATE", "ALLLEDGERENTRIES.GSTHSNNAME",
	"ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATE",
	"ALLLEDGERENTRIES.BANKALLOCATIONS.DATE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE", "ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER",
	"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT", "ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE"}

// the approved fields, in today's order (liveFetchField, the FETCH of FinComVoucherByMaster at 2.3.3): the request's
// FETCHLIST and the fields the strip keeps
func liveFetchFields() []string {
	var o []string
	for _, f := range strings.Split(liveFetchField, ",") {
		if f = strings.TrimSpace(f); f != "" {
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

// 2.3.4 (the independent review, M3: a 500-item invoice's object is about 13 MB; the regular expression above took 2 s
// on it): the same tags as reFastTag finds, by a plain scan (TestFast234TagScanMatchesRegexp): at each "<", an optional
// "/", a name, then either nothing or white space and attributes (quoted values may hold ">") up to ">" or "/>"
func fastScan(v string, each func(start, end int, closing bool, name, attrs string, self bool) bool) {
	word := func(c byte) bool {
		return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_'
	}
	space := func(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' }
	for i := 0; i < len(v); {
		j := strings.IndexByte(v[i:], '<')
		if j < 0 {
			return
		}
		p := i + j
		k := p + 1
		closing := k < len(v) && v[k] == '/'
		if closing {
			k++
		}
		if k >= len(v) || !(word(v[k]) && (v[k] < '0' || v[k] > '9')) {
			i = p + 1
			continue
		}
		ns := k
		for k++; k < len(v) && (word(v[k]) || v[k] == '.' || v[k] == ':' || v[k] == '-'); k++ {
		}
		name, attrs, self, end := v[ns:k], "", false, -1
		switch {
		case k < len(v) && space(v[k]):
			q := k + 1
			for q < len(v) && v[q] != '>' {
				if c := v[q]; c == '"' || c == '\'' {
					e := strings.IndexByte(v[q+1:], c)
					if e < 0 {
						q = len(v)
						break
					}
					q += e + 2
					continue
				}
				q++
			}
			if q < len(v) {
				ae := q
				if v[q-1] == '/' && q-1 > k {
					ae, self = q-1, true
				}
				attrs, end = v[k:ae], q+1
			}
		case k+1 < len(v) && v[k] == '/' && v[k+1] == '>':
			self, end = true, k+2
		case k < len(v) && v[k] == '>':
			end = k + 1
		}
		if end < 0 {
			i = p + 1
			continue
		}
		if !each(p, end, closing, name, attrs, self) {
			return
		}
		i = end
	}
}

// one <VOUCHER ...>...</VOUCHER> as a tree (its text kept as Tally wrote it); nil when it is not one
func fastTree(v string) *fastEl {
	var root *fastEl
	var st []*fastEl
	last := 0
	fastScan(v, func(start, end int, closing bool, name, attrs string, self bool) bool {
		text := v[last:start]
		last = end
		if len(st) > 0 && !st[len(st)-1].hasKids {
			st[len(st)-1].text += text
		}
		if closing {
			if len(st) > 0 && st[len(st)-1].name == name {
				st = st[:len(st)-1]
			}
			return true
		}
		e := &fastEl{name: name, attrs: attrs}
		if len(st) == 0 {
			if root != nil {
				return false
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
		return true
	})
	if root == nil || root.name != "VOUCHER" {
		return nil
	}
	return root
}

var reFastAttr = regexp.MustCompile(`\s(REMOTEID|VCHTYPE)="([^"]*)"`)

// Tally's whole voucher -> only the approved fields, LEDGERENTRIES.LIST as ALLLEDGERENTRIES.LIST, the VOUCHER element's
// REMOTEID and VCHTYPE (its GUID and type, both approved fields) and nothing else; "" when it is not a voucher, or when
// its lines cannot be kept whole (fastStripWhy)
func fastStripVoucher(v string) string {
	x, _ := fastStripWhy(v)
	return x
}

// 2.3.4 (the independent review, L1 and L2): the names of a voucher's lines FinCom stores (a ledger line, an item, a pay
// head). One of them, filled, at a place the strip does not keep (a stock item under a ledger line: voucher mode; a stock
// journal's lines in and out; items in INVENTORYENTRIES; pay heads by employee; ledger lines in both LEDGERENTRIES and
// ALLLEDGERENTRIES) would be dropped, the body sent short and its stored rows marked gone (migration 57): such a voucher
// is held instead ("" and the place, in plain words)
var fastLineNames = map[string]bool{"LEDGERNAME": true, "STOCKITEMNAME": true, "PAYHEADNAME": true}

func fastStripWhy(v string) (string, string) { return fastStrip(v, true) }

// 2.3.4 (the independent review, M2): a Voucher collection's answer (FinComVoucherByNumber) to the same approved fields.
// Not held: the collection gives what its FETCH names (its ALLLEDGERENTRIES the entry's every ledger line, the items'
// sales lines with their INVENTORYALLOCATIONS among them, and LEDGERENTRIES beside: parse.js reads ALLLEDGERENTRIES), so
// only the extra fields Tally adds go
func fastStripCollection(v string) string {
	x, _ := fastStrip(v, false)
	return x
}

func fastStrip(v string, hold bool) (string, string) {
	root := fastTree(v)
	if root == nil {
		return "", ""
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
	ok0 := fastApprovedPaths()
	var lost string
	var walk func(e *fastEl, prefix string)
	walk = func(e *fastEl, prefix string) {
		seg := strings.TrimSuffix(e.name, ".LIST")
		if prefix == "" && seg == "LEDGERENTRIES" && !hasAll {
			seg = "ALLLEDGERENTRIES"
		}
		p := seg
		if prefix != "" {
			p = prefix + "." + seg
		}
		if !e.hasKids {
			if lost == "" && fastLineNames[seg] && strings.TrimSpace(e.text) != "" && !ok0[p] {
				lost = strings.TrimSuffix(p, "."+seg)
			}
			return
		}
		for _, k := range e.kids {
			walk(k, p)
		}
	}
	for _, k := range root.kids {
		walk(k, "")
	}
	if lost != "" && hold {
		return "", "its lines in " + lost + ", which FinCom's entry request does not read"
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
	return b.String(), ""
}

// 2.3.4: an entry Tally keeps in a form the strip cannot keep whole (fastStripWhy): held, never sent short, never taken
// as not found or deleted; the same answer would come again, so it is not asked again
var errFastShape = errors.New("Tally keeps this entry in a form FinCom does not read")

type fastShapeError struct{ why string }

func (e fastShapeError) Error() string {
	return "Tally keeps this entry with " + e.why + "; upload that day's Day Book to settle it"
}
func (e fastShapeError) Is(t error) bool { return t == errFastShape }

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
