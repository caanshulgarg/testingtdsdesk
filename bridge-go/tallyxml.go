package main

// Reading Tally's answers (05-Oct-2026, the root cause of NWS144's "the entry fetch finds nothing", found on a real
// TallyPrime 7.1, run 37301813638): Tally writes a typed field WITH its TYPE attribute and pads its numbers,
//   <MASTERID TYPE="Number"> 2</MASTERID>  <ALTERID TYPE="Number"> 4</ALTERID>  <DATE TYPE="Date">20261002</DATE>
//   <NARRATION TYPE="String">...</NARRATION>  <LEDGERNAME TYPE="String">...</LEDGERNAME>  <AMOUNT TYPE="Amount">...
// and every answer to a collection carries a CMPINFO block of counters ahead of the data (<COMPANY>0</COMPANY>,
// <LEDGER>21</LEDGER>, <VOUCHER>4</VOUCHER> ...). Every read of a field of Tally's answer goes through these helpers,
// which take a tag with or without attributes and white space around its value; xmlDoc drops CMPINFO, and the
// voucher and ledger patterns never take a counter.

import (
	"html"
	"regexp"
	"strings"
)

// the regexp text of an opening tag, with or without attributes and white space (<TAG>, <TAG TYPE="Number">), never a
// self-closed <TAG/> nor a longer tag (<TAGNAME>)
func tagOpenRe(tag string) string { return `<` + regexp.QuoteMeta(tag) + `(?:\s[^>]*[^/>])?\s*>` }

// the regexp text of a whole element <TAG ...>text</TAG>, the text its group 1
func tagRe(tag string) string {
	return tagOpenRe(tag) + `([^<]*)</` + regexp.QuoteMeta(tag) + `\s*>`
}

// the text of the first <TAG ...>text</TAG> in x as written (not trimmed, not unescaped); "" when there is none
func tagRaw(x, tag string) string { return group(tagRe(tag), x, 1) }

// that text unescaped and trimmed
func tagValue(x, tag string) string { return strings.TrimSpace(html.UnescapeString(tagRaw(x, tag))) }

// every such text in x, unescaped and trimmed, in order
func tagValues(x, tag string) []string {
	var o []string
	for _, m := range re(tagRe(tag)).FindAllStringSubmatch(x, -1) {
		o = append(o, strings.TrimSpace(html.UnescapeString(m[1])))
	}
	return o
}

// the field's number: its leading digits after any white space (<MASTERID TYPE="Number"> 2</MASTERID> -> "2"); "" when
// it has none
func tagNum(x, tag string) string { return group(tagOpenRe(tag)+`\s*(\d+)`, x, 1) }

// the field's date as yyyymmdd ("" when it is not one)
func tagDate(x, tag string) string {
	if d := tagValue(x, tag); isTallyDate(d) {
		return d
	}
	return ""
}

// the voucher elements of a text: <VOUCHER ...>...</VOUCHER> holding child elements. CMPINFO's counter
// <VOUCHER>4</VOUCHER> is not one (its text is a number), nor a self-closed <VOUCHER/>
var reVchBlock = re(`<VOUCHER(?:\s[^>]*[^/>])?\s*>\s*<[^/][\s\S]*?</VOUCHER\s*>`)

// the opening tags of the voucher elements of a text, a voucher cut short included (a counter is not one)
var reVchOpen = re(`<VOUCHER(?:\s[^>]*[^/>])?\s*>\s*<[^/]`)

// the ledger elements, likewise (CMPINFO's <LEDGER>21</LEDGER> is not one)
var reLedBlock = re(`<LEDGER(?:\s[^>]*[^/>])?\s*>\s*<[^/][\s\S]*?</LEDGER\s*>`)

// a Tally answer without its CMPINFO block of counters (whose <COMPANY>0</COMPANY>, <LEDGER>n</LEDGER> and
// <VOUCHER>n</VOUCHER> would otherwise be read as a company, a ledger or a voucher)
func dropCmpInfo(t string) string {
	if !strings.Contains(t, "CMPINFO") {
		return t
	}
	return re(`<CMPINFO(?:\s[^>]*)?>[\s\S]*?</CMPINFO\s*>|<CMPINFO\s*/>`).ReplaceAllString(t, "")
}

// the decoded VOUCHER elements that are vouchers: with child elements (never a counter). 2.3.1 (2.2.4 review L3): an
// empty or self-closed <VOUCHER .../> with attributes only is not one, as countVouchers counts the text
func vchNodes(doc *Node) []*Node {
	var o []*Node
	for _, v := range doc.All("VOUCHER") {
		if len(v.Kids) > 0 {
			o = append(o, v)
		}
	}
	return o
}
