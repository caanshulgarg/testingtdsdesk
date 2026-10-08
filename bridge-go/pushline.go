// Next (branch next-push; the owner's decision of 07-Oct-2026): the voucher is identified and read by "full entry at save
// without read-back". Evidence: the push-design re-run 37580283590 (branch tally-versions, docs/push-design-results.md, the
// harness add-on .github/tally-spike/push/FCPFullNR.tdl): on a 30,012-voucher company, on TallyPrime 3.0, 4.1, 5.1, 6.2 and
// 7.1, writing the whole entry at save took 49-57 ms median and 71 ms worst on a 50-item invoice, payroll for 200 14-23 ms,
// no freeze in 100 saves; the MasterID of the saved form was right 25 of 25 times; every voucher's GUID was its company's
// GUID, "-" and its MasterID as 8 lowercase hex digits; the add-on cannot read the change counter.
//
// The add-on (addon/FinComRecorder.tdl, FCRLiveFull) writes, in the voucher form's Form Accept AFTER Tally's own save and
// after the heads lines it always wrote (unchanged, so an older bridge keeps working), ONE full-entry line: the entry as
// the form holds it in memory (no read-back of any kind). That line is an ordinary recorder line for every reader:
//
//	FCR1|ev=voucher_full|t0=|tw=|w=|cguid=|cname=|user=|obj=Voucher|guid=|mid=|aid=|vtype=|vno=|vdate=|name=|parent=|narr=FE1|part=1|<fields>|end=1|t1=|src=live
//
// An older bridge reads it as a complete line (it ends "|t1=...|src=live") of an event it does not know and drops it. This
// bridge takes the entry from what follows "|narr=" (the payload, up to the LAST "|t1="):
//
//   - fields: "|key=value"; a record (key starting with a capital: L1, L1B2, I3b1 ...) is "~"-separated sub-fields
//     "name=value". Free text is escaped by the add-on with $$StringFindAndReplace (proven on 3.0, 4.1, 5.1, 6.2 and 7.1 by
//     tally-versions run 37608273503): "%" -> %25, "|" -> %7C, "~" -> %7E, so a value can never hold a separator, nor start
//     a physical line with "FCR1|"; a line break inside a value stays as it is and is read from the raw text. Tally's own
//     words (amounts, dates, Yes/No, rate heads) are written plain and never hold "|" or "~". ($$String of a function giving
//     a number is left unset by every release (same run): never used; a length goes through a Number variable.)
//   - the size cap: a record that would take the line past FCRCap characters ends it ("|len=<n>|more=1|t1=...|src=live")
//     and opens the next part with the same head and "|part=<k>"; the last part ends "|len=<n>|end=1". n is the length of
//     the part's records ($$StringLength, added up in a Number variable). A record is never split. The bridge joins the
//     parts of one entry in order; a part missing, out of order, or whose length is not n: no full entry.
//   - the fields: the entry's own (mid, aid, guid, date, vtype, vno, party, canc, opt, ref, refdt, pgstin, pos, cgstin, irn,
//     irnack, irnackdt, ewb, view, narr) and the counts nL, nI, nO, nSO, nSI, nCE; the records: L<i> a ledger line (led,
//     amt, neg, dp, party, hsn) with R<j> GST rate (head, vt, rate), B<j> bill (name, type, amt, neg, cp, tdssec), K<j> bank
//     (date, name, tt, ino, idt, bdt, utr, amt, neg), C<j> cost category (cat) and C<j>c<k> cost centre (cc, amt, neg), T<j>
//     TDS (tt, cat, pl, ref) and T<j>s<k> its sub-category (sub, duty, rate, ass, assneg, tax, taxneg); I<i> an item line
//     (item, qty, aq, rate, amt, neg, dp, hsn) with R<j>, A<j> the ledger under it (led, amt, neg, dp) with its C/c, b<j>
//     its batches (god, bat, trk, ord, due, aq, bq, rate, amt, neg); O<i> the order list (no, dt); SO<i> / SI<i> the lines
//     out and in of a stock journal with b<j>; CE<i> a payroll category (cat), CE<i>E<j> an employee (emp, amt, neg) with
//     p<k> pay heads (ph, amt, neg) and a<k> attendance (att, val).
//   - amounts: Tally's $$String gives the amount without its sign (1,180.00); the sign is the record's neg (Yes: below 0 in
//     Tally, a debit), its sense checked on the ledger lines against IsDeemedPositive, else IsDeemedPositive itself.
//
// The bridge maps the line to the XML Tally gives its entry request (FinComVoucherByMaster) for the same voucher, so FinCom's
// cloud reads it unchanged (parse.js; tally_ingest_details), and sends it as a full entry ("full": true). The GUID is built
// by the rule and cross-checked against the GUIDs the lines carry; the line carries no AlterID (the form holds the old one).
// No entry request goes to Tally for such a line. Lines without a full entry (an older add-on) keep the 2.3.2 route.
package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	pushEv    = "voucher_full" // the add-on's full-entry line
	pushMagic = "FE1"          // the payload's first word (the format's version)
)

// one entry as the full-entry line(s) carry it
type pushEntry struct {
	scal  map[string]string            // the entry's own fields and the counts
	recs  map[string]map[string]string // a record by its key: its sub-fields
	order []string                     // the records in the order written
	parts int                          // the parts joined
	done  bool                         // the last part ("|end=1") seen
}

func newPushEntry() *pushEntry {
	return &pushEntry{scal: map[string]string{}, recs: map[string]map[string]string{}}
}

func (e *pushEntry) s(k string) string { return e.scal[k] }

func (e *pushEntry) n(k string) int {
	v, err := strconv.Atoi(strings.TrimSpace(e.scal[k]))
	if err != nil || v < 0 {
		return -1
	}
	return v
}

func (e *pushEntry) rec(k string) map[string]string { return e.recs[k] }

// the payload of one full-entry line: the text after the first "|narr=" up to the last "|t1=" (as written: raw)
func pushPayload(raw string) (string, bool) {
	i := strings.Index(raw, "|narr=")
	j := strings.LastIndex(raw, "|t1=")
	if i < 0 || j < i+len("|narr=") {
		return "", false
	}
	p := raw[i+len("|narr=") : j]
	return p, strings.HasPrefix(p, pushMagic+"|part=")
}

// the length of a text as the add-on counts it ($$StringLength): UTF-16 units (code points accepted too: lenOK)
func u16len(s string) int { return len(utf16.Encode([]rune(s))) }

func lenOK(s string, n int) bool { return u16len(s) == n || utf8.RuneCountInString(s) == n }

// the add-on's escaping undone: %25 %, %7C |, %7E ~ (any %XX; a "%" not followed by two hex digits is not the add-on's)
func pushUnesc(v string) (string, error) {
	if !strings.Contains(v, "%") {
		return v, nil
	}
	var b strings.Builder
	for i := 0; i < len(v); i++ {
		if v[i] != '%' {
			b.WriteByte(v[i])
			continue
		}
		if i+2 >= len(v) {
			return "", fmt.Errorf("a %% without its code in %q", cut(v, 60))
		}
		x, err := strconv.ParseUint(v[i+1:i+3], 16, 8)
		if err != nil {
			return "", fmt.Errorf("a %% without its code in %q", cut(v, 60))
		}
		b.WriteByte(byte(x))
		i += 2
	}
	return b.String(), nil
}

var rePushKey = regexp.MustCompile(`^[A-Za-z0-9]{1,24}$`)

// a record's key: L1, L1C2c3, I4b1, SO2, CE1E3p2 ... (a capital first)
func pushIsRec(k string) bool { return k != "" && k[0] >= 'A' && k[0] <= 'Z' }

var rePushPartEnd = regexp.MustCompile(`\|len=(\d{1,9})\|(end|more)=1$`)

// one part's payload taken into e; want: the part expected (1 for the first). The payload:
//
//	FE1|part=<k><records>|len=<n>|end=1   (or |more=1 for a part that is not the last)
//
// <records> are "|key=value" (a capital key: "~"-separated "sub=value" fields); n is their length in characters, as the
// add-on added it up record by record: a record Tally could not evaluate (left out, or a stale value) shows there
func pushParsePart(p string, e *pushEntry, want int) error {
	head := fmt.Sprintf("%s|part=%d", pushMagic, want)
	if !strings.HasPrefix(p, head) || (len(p) > len(head) && p[len(head)] != '|') {
		return fmt.Errorf("not part %d of a full entry", want)
	}
	m := rePushPartEnd.FindStringSubmatchIndex(p)
	if m == nil {
		return errors.New("the part does not end with its length and end=1 or more=1")
	}
	n, _ := strconv.Atoi(p[m[2]:m[3]])
	body := p[len(head):m[0]]
	if !lenOK(body, n) {
		return fmt.Errorf("the part says %d characters, %d came", n, u16len(body))
	}
	if p[m[4]:m[5]] == "end" {
		e.done = true
	}
	if body == "" {
		return nil
	}
	for _, f := range strings.Split(body[1:], "|") {
		key, val, ok := strings.Cut(f, "=")
		if !ok || !rePushKey.MatchString(key) {
			return fmt.Errorf("a field without its key: %q", cut(f, 60))
		}
		if !pushIsRec(key) {
			if key == "part" || key == "len" || key == "end" || key == "more" {
				return fmt.Errorf("%s inside the part", key)
			}
			if _, had := e.scal[key]; had {
				return fmt.Errorf("%s twice", key)
			}
			v, err := pushUnesc(val)
			if err != nil {
				return err
			}
			e.scal[key] = v
			continue
		}
		if _, had := e.recs[key]; had {
			return fmt.Errorf("record %s twice", key)
		}
		r := map[string]string{}
		for _, sf := range strings.Split(val, "~") {
			sk, sv, ok := strings.Cut(sf, "=")
			if !ok || !rePushKey.MatchString(sk) {
				return fmt.Errorf("record %s: a field without its key: %q", key, cut(sf, 60))
			}
			if _, had := r[sk]; had {
				return fmt.Errorf("record %s: %s twice", key, sk)
			}
			v, err := pushUnesc(sv)
			if err != nil {
				return fmt.Errorf("record %s: %v", key, err)
			}
			r[sk] = v
		}
		e.recs[key] = r
		e.order = append(e.order, key)
	}
	return nil
}

// the whole entry from its parts' payloads, in order
func pushParse(payloads []string) (*pushEntry, error) {
	e := newPushEntry()
	for i, p := range payloads {
		if e.done {
			return nil, errors.New("a part after the last")
		}
		if err := pushParsePart(p, e, i+1); err != nil {
			return nil, fmt.Errorf("part %d: %v", i+1, err)
		}
	}
	if !e.done {
		return nil, errors.New("the last part is missing")
	}
	return e, nil
}

// --- the GUID rule (push-design run 37580283590: 30,086 of 30,086 vouchers on every release, imports and a sync-like one
// included): the company's GUID, "-", and the MasterID in hexadecimal, lower case, 8 digits at least ("-0000000e" for 14)
func pushGUID(cguid, mid string) string {
	cg := liveGUID(strings.TrimSpace(cguid))
	m, err := strconv.ParseInt(strings.TrimSpace(mid), 10, 64)
	if cg == "" || err != nil || m <= 0 {
		return ""
	}
	return fmt.Sprintf("%s-%08x", cg, m)
}

// the GUID by the rule, cross-checked against a GUID a line of the same save carries (the form's): "" why when it holds.
// A placeholder ("<company>-00000000") or none says nothing; the rule's own GUID agrees; a GUID under the company's prefix
// that is not the MasterID's is the entry the new one was copied from (Alt+2: the form keeps its GUID), right only for a
// created entry; a GUID under ANOTHER company's prefix (an entry that came by synchronisation keeping a foreign GUID: not
// seen in the push-design run, never assumed) is a reason to ask Tally instead (the 2.3.2 route)
func pushGuidCheck(cguid, mid, ev string, lineGuids ...string) (string, string) {
	g := pushGUID(cguid, mid)
	if g == "" {
		if liveGUID(strings.TrimSpace(cguid)) == "" {
			return "", "the line has no company GUID"
		}
		return "", "the line has no MasterID"
	}
	cg := strings.ToLower(liveGUID(strings.TrimSpace(cguid)))
	for _, lg := range lineGuids {
		lg = strings.TrimSpace(lg)
		switch {
		case lg == "" || livePlaceholder(lg) || strings.EqualFold(lg, g):
		case strings.HasPrefix(strings.ToLower(lg), cg+"-"):
			if ev != "created" {
				return "", "the line's GUID " + cut(lg, 80) + " is not the GUID MasterID " + strings.TrimSpace(mid) + " makes, and the entry was not a new one"
			}
		default:
			return "", "the line's GUID " + cut(lg, 80) + " is under another company's GUID"
		}
	}
	return g, ""
}

// whether a full line can be trusted for the cloud: "" when it can, else why not (the entry is then confirmed from Tally's
// own record: the fast request by MasterID, the owner's decision of 08-Oct-2026; until then the 2.3.2 route). The line is
// the voucher FORM at Form Accept; tally-versions run 37722273938 (each kind typed on Tally's screens, 3.0-7.1, the line
// against Tally's stored entry) showed the two cases where the form is not what Tally stores, and only those:
//   - an invoice made new (Invoice Voucher View): no bills in the line; Tally allocates the bill as it stores the entry
//   - an Alt+2 copy (the line's GUID is the entry it was copied from) carrying a New Ref bill: Tally stores Agst Ref
//
// A bill type that may be wrong is never sent. Alterations, receipts / payments / journals made new and copies without a
// New Ref bill matched every bill field (their empty party is Tally's to fill from the ledger lines: the same run's rule)
func pushTrust(e *pushEntry, ev, cguid, mid, lineGuid string) string {
	if ev != "created" {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(e.s("view")), "Invoice Voucher View") {
		return "an invoice made new: Tally allocates its bills as it stores the entry, after the form the line is read from"
	}
	g, lg := pushGUID(cguid, mid), strings.TrimSpace(lineGuid)
	if lg != "" && g != "" && !livePlaceholder(lg) && !strings.EqualFold(lg, g) {
		for k, r := range e.recs {
			if rePushBillRec.MatchString(k) && strings.EqualFold(strings.TrimSpace(r["type"]), "New Ref") {
				return "an Alt+2 copy with a New Ref bill: Tally stores it as Agst Ref"
			}
		}
	}
	return ""
}

var rePushBillRec = regexp.MustCompile(`^L\d+B\d+$`)

// --- the XML: what Tally gives the entry request (FinComVoucherByMaster) for the same voucher, typed as a real TallyPrime
// 7.1 writes it; nothing the line does not carry

// XML text: escaped as the bridge escapes; a control character as Tally writes it (&#13;&#10; for a line break; the others
// dropped, as cleanXML drops them from Tally's own answer)
func pushX(s string) string {
	var b strings.Builder
	for _, r := range esc(s) {
		switch {
		case r == '\r' || r == '\n' || r == '\t':
			fmt.Fprintf(&b, "&#%d;", r)
		case r < 0x20 || r == 0xFFFE || r == 0xFFFF:
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func pushTag(b *strings.Builder, tag, typ, v string) {
	if typ != "" {
		fmt.Fprintf(b, "<%s TYPE=\"%s\">%s</%s>", tag, typ, pushX(v), tag)
	} else {
		fmt.Fprintf(b, "<%s>%s</%s>", tag, pushX(v), tag)
	}
}

// the entry's own fields every full line carries (each its own record since tally-real run 37677491784)
var pushHeadKeys = []string{"mid", "aid", "guid", "date", "canc", "opt", "vtype", "vno", "party", "view", "ref", "refdt", "pgstin", "pos", "cgstin", "irn", "irnack", "irnackdt", "ewb", "narr"}

// a date as the line gives it ("1-Oct-26", "1-Oct-2026", yyyymmdd) as yyyymmdd; "" for none; ok false when it is not one
func pushDate(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", true
	}
	d := normDate(s)
	return d, d != ""
}

var rePushNum = regexp.MustCompile(`^\d+(\.\d+)?$`)

// an amount as $$String gives it (1,180.00; 2,00,000.00; "(-)50.00"; a foreign amount "$17000.00 @ ₹ 86.40/$ = ₹ 1468800.00")
// without its sign: the rupee digits
func pushAbs(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "="); i >= 0 {
		s = s[i+1:]
	}
	s = strings.NewReplacer(",", "", "(-)", "", "-", "", "₹", "", " ", "", "Dr", "", "Cr", "").Replace(s)
	if s == "" {
		return "", true
	}
	return s, rePushNum.MatchString(s)
}

// the sign rule of one entry. neg is "the amount below 0", checked against IsDeemedPositive on the ledger lines. On a real
// TallyPrime (tally-versions run 37611204899, 3.0 to 7.1) a voucher form's $Amount is the amount without its sign after
// Form Accept: $$String gives "700.00" for the Cash debit and "$Amount < 0" is No on every line. A neg that is never Yes on
// a voucher with amounts says nothing (blind), and the sign is then Tally's own XML rule: IsDeemedPositive Yes is an
// amount below 0 (a debit), a "(-)" amount the other way. A record without its own IsDeemedPositive (a bill, a bank or
// cost-centre line, a batch) takes its line's; a TDS sub-category's assessable amount and tax are magnitudes (pushMagnitude);
// an amount the cloud signs with nothing to sign it by (an employee's pay heads) refuses the entry. The ledger lines must
// still add up to zero.
type pushSign struct{ flip, none, blind bool }

func pushSignOf(e *pushEntry) pushSign {
	agree, differ, yes, any := 0, 0, false, false
	for k, r := range e.recs {
		if !rePushLedRec.MatchString(k) {
			continue
		}
		// blind or not is told by the ledger lines alone: a balanced entry has a ledger line below 0, so a neg that says
		// something says Yes there (tally-real run 37677491784: the form's assneg was Yes on a TDS assessable amount
		// while every ledger line's neg was No)
		if r["neg"] == "Yes" {
			yes = true
		}
		n, d := r["neg"], r["dp"]
		if a, _ := pushAbs(r["amt"]); a == "" || strings.Trim(a, "0.") == "" {
			continue
		}
		any = true
		if (n != "Yes" && n != "No") || (d != "Yes" && d != "No") {
			continue
		}
		if n == d {
			agree++
		} else {
			differ++
		}
	}
	if any && !yes {
		return pushSign{blind: true}
	}
	return pushSign{flip: differ > 0 && agree == 0, none: agree+differ == 0}
}

var rePushLedRec = regexp.MustCompile(`^L\d+$`)

// the amount with Tally's sign (a debit below 0, as Tally's XML has it); dp: the IsDeemedPositive that rules when the
// record has no usable neg
func (g pushSign) amt(r map[string]string, amtKey, negKey, dp string) (string, error) {
	a, ok := pushAbs(r[amtKey])
	if !ok {
		return "", fmt.Errorf("the amount %q cannot be read", r[amtKey])
	}
	if a == "" {
		return "", nil
	}
	neg := false
	switch n := r[negKey]; {
	case g.blind && dp == pushMagnitude:
		// written as Tally writes it: the magnitude
	case g.blind && (dp == "Yes" || dp == "No"):
		neg = (dp == "Yes") != pushMinus(r[amtKey])
	case g.blind:
		if strings.Trim(a, "0.") != "" {
			return "", fmt.Errorf("the sign of the amount %q is not on the line (no IsDeemedPositive to take it from)", r[amtKey])
		}
	case n == "Yes" || n == "No":
		neg = (n == "Yes") != g.flip
	case dp == "Yes" || dp == "No":
		neg = dp == "Yes"
	}
	if neg && strings.Trim(a, "0.") != "" {
		return "-" + a, nil
	}
	return a, nil
}

// the dp of an amount Tally's XML writes as a plain magnitude whatever the form shows: a TDS sub-category's assessable
// amount and tax (push-design run 37591395905, all five releases: the form "(-)1,00,000.00", Tally's Day Book export and its
// answer to the entry request ASSESSABLEAMOUNT 100000.00, TAX 2000.00; the cloud reads them as they are)
const pushMagnitude = "magnitude"

// an amount as $$String writes one below 0 in a voucher form ("(-)50.00", "-50.00"): the other way from its IsDeemedPositive
func pushMinus(s string) bool {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "="); i >= 0 {
		s = strings.TrimSpace(s[i+1:])
	}
	return strings.HasPrefix(s, "(-)") || strings.HasPrefix(s, "-")
}

// the records under a key: key + tag + 1, 2, ... while there is one
func (e *pushEntry) list(prefix, tag string) []string {
	var o []string
	for j := 1; ; j++ {
		k := prefix + tag + strconv.Itoa(j)
		if e.recs[k] == nil {
			return o
		}
		o = append(o, k)
	}
}

// the payroll blocks go only with a payroll or attendance entry: on any other voucher Tally's in-memory CategoryEntry is
// its cost centres (push-design captures: a receipt's "employee" was its cost centre)
func (e *pushEntry) payroll() bool {
	v := strings.ToLower(e.s("view") + " " + e.s("vtype"))
	return strings.Contains(v, "pay") || strings.Contains(v, "attendance") || (e.n("nL") == 0 && e.n("nCE") > 0)
}

// the entry as Tally's XML for the entry request, its GUID by the rule; alter: Tally's AlterID when known (the light check's
// counter, unambiguous), else none (the line has none). Checked: every count against its records, the dates, the amounts,
// and the ledger lines adding up to zero (an uncancelled entry with ledger lines)
func pushEntryXML(e *pushEntry, guid string, alter int64) (string, error) {
	mid := strings.TrimSpace(e.s("mid"))
	if m, err := strconv.ParseInt(mid, 10, 64); err != nil || m <= 0 {
		return "", errors.New("no MasterID")
	}
	date, ok := pushDate(e.s("date"))
	if !ok || date == "" {
		return "", fmt.Errorf("the date %q cannot be read", e.s("date"))
	}
	if strings.TrimSpace(e.s("vtype")) == "" {
		return "", errors.New("no voucher type")
	}
	// every field of the entry's own head: one whose record failed in the voucher form is missing, and the cloud would
	// store a blank where Tally may hold a value (tally-real run 37677491784: no real line had the reference, GST and
	// e-invoice fields); such a line is not taken
	var lack []string
	for _, k := range pushHeadKeys {
		if _, ok := e.scal[k]; !ok {
			lack = append(lack, k)
		}
	}
	if len(lack) > 0 {
		return "", fmt.Errorf("the line lacks %s (its record failed in the voucher form: what Tally holds there is not known)", strings.Join(lack, ", "))
	}
	for _, c := range []struct{ n, p string }{{"nL", "L"}, {"nI", "I"}, {"nO", "O"}, {"nSO", "SO"}, {"nSI", "SI"}, {"nCE", "CE"}} {
		n := e.n(c.n)
		if n < 0 && c.n == "nO" {
			// the invoice order list: no longer written by the add-on (tally-real run 37677491784: its record failed in a
			// voucher form; not in the entry request's shape, not read by the cloud); none may come without its count
			n = 0
		}
		if n < 0 {
			return "", fmt.Errorf("the count %s is missing", c.n)
		}
		if got := len(e.list("", c.p)); got != n {
			return "", fmt.Errorf("%s says %d, %d written", c.n, n, got)
		}
	}
	sg := pushSignOf(e)
	var err error
	date8 := func(s string) string {
		d, ok := pushDate(s)
		if !ok && err == nil {
			err = fmt.Errorf("the date %q cannot be read", s)
		}
		return d
	}
	money := func(r map[string]string, ak, nk, dp string) string {
		a, e2 := sg.amt(r, ak, nk, dp)
		if e2 != nil && err == nil {
			err = e2
		}
		return a
	}
	yes := func(s string) string {
		if s == "Yes" || s == "No" {
			return s
		}
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<VOUCHER REMOTEID="%s" VCHTYPE="%s"`, pushX(guid), pushX(e.s("vtype")))
	if v := e.s("view"); v != "" {
		fmt.Fprintf(&b, ` OBJVIEW="%s"`, pushX(v))
	}
	b.WriteString(">")
	pushTag(&b, "DATE", "Date", date)
	pushTag(&b, "REFERENCEDATE", "Date", date8(e.s("refdt")))
	pushTag(&b, "IRNACKDATE", "Date", date8(e.s("irnackdt")))
	pushTag(&b, "GUID", "", guid)
	pushTag(&b, "NARRATION", "String", e.s("narr"))
	pushTag(&b, "PARTYGSTIN", "String", e.s("pgstin"))
	pushTag(&b, "PLACEOFSUPPLY", "String", e.s("pos"))
	pushTag(&b, "VOUCHERTYPENAME", "", e.s("vtype"))
	pushTag(&b, "CMPGSTIN", "String", e.s("cgstin"))
	pushTag(&b, "PARTYLEDGERNAME", "String", e.s("party"))
	pushTag(&b, "VOUCHERNUMBER", "", e.s("vno"))
	pushTag(&b, "REFERENCE", "String", e.s("ref"))
	pushTag(&b, "IRN", "String", e.s("irn"))
	pushTag(&b, "IRNACKNO", "String", e.s("irnack"))
	if v := e.s("view"); v != "" {
		pushTag(&b, "PERSISTEDVIEW", "", v)
	}
	pushTag(&b, "ISOPTIONAL", "Logical", yes(e.s("opt")))
	pushTag(&b, "ISCANCELLED", "Logical", yes(e.s("canc")))
	if alter > 0 {
		fmt.Fprintf(&b, `<ALTERID TYPE="Number"> %d</ALTERID>`, alter)
	}
	fmt.Fprintf(&b, `<MASTERID TYPE="Number"> %s</MASTERID>`, mid)
	b.WriteString("<EWAYBILLDETAILS.LIST>")
	if v := e.s("ewb"); v != "" {
		pushTag(&b, "BILLNUMBER", "String", v)
	}
	b.WriteString("</EWAYBILLDETAILS.LIST>")
	rates := func(p string) {
		for _, k := range e.list(p, "R") {
			r := e.recs[k]
			if r["head"] == "" && r["vt"] == "" && r["rate"] == "" {
				continue
			}
			b.WriteString("<RATEDETAILS.LIST>")
			pushTag(&b, "GSTRATEDUTYHEAD", "String", r["head"])
			pushTag(&b, "GSTRATEVALUATIONTYPE", "String", r["vt"])
			pushTag(&b, "GSTRATE", "Number", r["rate"])
			b.WriteString("</RATEDETAILS.LIST>")
		}
	}
	costs := func(p, dp string) {
		for _, k := range e.list(p, "C") {
			cs := e.list(k, "c")
			if e.recs[k]["cat"] == "" && len(cs) == 0 {
				continue
			}
			b.WriteString("<CATEGORYALLOCATIONS.LIST>")
			pushTag(&b, "CATEGORY", "String", e.recs[k]["cat"])
			for _, c := range cs {
				r := e.recs[c]
				b.WriteString("<COSTCENTREALLOCATIONS.LIST>")
				pushTag(&b, "NAME", "String", r["cc"])
				pushTag(&b, "AMOUNT", "Amount", money(r, "amt", "neg", dp))
				b.WriteString("</COSTCENTREALLOCATIONS.LIST>")
			}
			b.WriteString("</CATEGORYALLOCATIONS.LIST>")
		}
	}
	batches := func(p, dp string) {
		for _, k := range e.list(p, "b") {
			r := e.recs[k]
			b.WriteString("<BATCHALLOCATIONS.LIST>")
			pushTag(&b, "GODOWNNAME", "String", r["god"])
			pushTag(&b, "BATCHNAME", "String", r["bat"])
			pushTag(&b, "ORDERNO", "String", r["ord"])
			pushTag(&b, "TRACKINGNUMBER", "String", r["trk"])
			pushTag(&b, "ORDERDUEDATE", "Date", date8(r["due"]))
			pushTag(&b, "AMOUNT", "Amount", money(r, "amt", "neg", dp))
			pushTag(&b, "ACTUALQTY", "Quantity", r["aq"])
			pushTag(&b, "BILLEDQTY", "Quantity", r["bq"])
			pushTag(&b, "BATCHRATE", "Rate", r["rate"])
			b.WriteString("</BATCHALLOCATIONS.LIST>")
		}
	}
	// the items (an invoice's item lines; a stock journal's lines out and in below)
	for _, k := range e.list("", "I") {
		r := e.recs[k]
		dp := yes(r["dp"])
		b.WriteString("<ALLINVENTORYENTRIES.LIST>")
		pushTag(&b, "STOCKITEMNAME", "String", r["item"])
		pushTag(&b, "GSTHSNNAME", "String", r["hsn"])
		pushTag(&b, "ISDEEMEDPOSITIVE", "Logical", dp)
		pushTag(&b, "RATE", "Rate", r["rate"])
		pushTag(&b, "AMOUNT", "Amount", money(r, "amt", "neg", dp))
		pushTag(&b, "ACTUALQTY", "Quantity", or(r["aq"], r["qty"]))
		pushTag(&b, "BILLEDQTY", "Quantity", r["qty"])
		batches(k, dp)
		for _, a := range e.list(k, "A") {
			ra := e.recs[a]
			adp := yes(ra["dp"])
			b.WriteString("<ACCOUNTINGALLOCATIONS.LIST>")
			pushTag(&b, "LEDGERNAME", "String", ra["led"])
			pushTag(&b, "ISDEEMEDPOSITIVE", "Logical", adp)
			pushTag(&b, "AMOUNT", "Amount", money(ra, "amt", "neg", adp))
			costs(a, adp)
			b.WriteString("</ACCOUNTINGALLOCATIONS.LIST>")
		}
		rates(k)
		b.WriteString("</ALLINVENTORYENTRIES.LIST>")
	}
	// the ledger lines and what each carries
	var total int64
	nl := 0
	for _, k := range e.list("", "L") {
		r := e.recs[k]
		dp := yes(r["dp"])
		a := money(r, "amt", "neg", dp)
		if p, ok := paise(a); ok && a != "" {
			if strings.HasPrefix(a, "-") {
				total -= p
			} else {
				total += p
			}
			nl++
		}
		b.WriteString("<ALLLEDGERENTRIES.LIST>")
		pushTag(&b, "LEDGERNAME", "String", r["led"])
		pushTag(&b, "GSTHSNNAME", "String", r["hsn"])
		pushTag(&b, "ISDEEMEDPOSITIVE", "Logical", dp)
		if v := yes(r["party"]); v != "" {
			pushTag(&b, "ISPARTYLEDGER", "Logical", v)
		}
		pushTag(&b, "AMOUNT", "Amount", a)
		costs(k, dp)
		for _, q := range e.list(k, "K") {
			rk := e.recs[q]
			if rk["date"]+rk["name"]+rk["tt"]+rk["ino"]+rk["idt"]+rk["bdt"]+rk["utr"]+rk["amt"] == "" {
				continue
			}
			b.WriteString("<BANKALLOCATIONS.LIST>")
			pushTag(&b, "DATE", "Date", date8(rk["date"]))
			pushTag(&b, "NAME", "String", rk["name"])
			pushTag(&b, "TRANSACTIONTYPE", "String", rk["tt"])
			pushTag(&b, "INSTRUMENTNUMBER", "String", rk["ino"])
			pushTag(&b, "INSTRUMENTDATE", "Date", date8(rk["idt"]))
			pushTag(&b, "BANKERSDATE", "Date", date8(rk["bdt"]))
			pushTag(&b, "UNIQUEREFERENCENUMBER", "String", rk["utr"])
			pushTag(&b, "AMOUNT", "Amount", money(rk, "amt", "neg", dp))
			b.WriteString("</BANKALLOCATIONS.LIST>")
		}
		for _, q := range e.list(k, "B") {
			rb := e.recs[q]
			if rb["name"]+rb["type"]+rb["amt"] == "" {
				continue
			}
			b.WriteString("<BILLALLOCATIONS.LIST>")
			pushTag(&b, "NAME", "", rb["name"])
			pushTag(&b, "BILLCREDITPERIOD", "", rb["cp"])
			pushTag(&b, "TDSDEDUCTEESECTIONNUMBER", "", rb["tdssec"])
			pushTag(&b, "BILLTYPE", "", rb["type"])
			pushTag(&b, "AMOUNT", "Amount", money(rb, "amt", "neg", dp))
			b.WriteString("</BILLALLOCATIONS.LIST>")
		}
		rates(k)
		for _, q := range e.list(k, "T") {
			rt := e.recs[q]
			subs := e.list(q, "s")
			if rt["tt"]+rt["cat"]+rt["pl"] == "" && len(subs) == 0 {
				continue
			}
			b.WriteString("<TAXOBJECTALLOCATIONS.LIST>")
			pushTag(&b, "CATEGORY", "String", rt["cat"])
			pushTag(&b, "TAXTYPE", "String", rt["tt"])
			pushTag(&b, "PARTYLEDGER", "String", rt["pl"])
			if rt["ref"] != "" {
				pushTag(&b, "REFTYPE", "String", rt["ref"])
			}
			for _, s := range subs {
				rs := e.recs[s]
				b.WriteString("<SUBCATEGORYALLOCATION.LIST>")
				pushTag(&b, "SUBCATEGORY", "String", rs["sub"])
				pushTag(&b, "DUTYLEDGER", "String", rs["duty"])
				pushTag(&b, "TAXRATE", "Number", rs["rate"])
				pushTag(&b, "ASSESSABLEAMOUNT", "Amount", money(rs, "ass", "assneg", pushMagnitude))
				pushTag(&b, "TAX", "Amount", money(rs, "tax", "taxneg", pushMagnitude))
				b.WriteString("</SUBCATEGORYALLOCATION.LIST>")
			}
			b.WriteString("</TAXOBJECTALLOCATIONS.LIST>")
		}
		b.WriteString("</ALLLEDGERENTRIES.LIST>")
	}
	// (the invoice order list is not written: Tally's answer to the entry request has none, tally-real run 37677491784)
	// a stock journal's lines out and in (on an invoice Tally's in-memory lists repeat its items: left out there)
	if e.n("nI") == 0 {
		for _, io := range []struct{ p, tag string }{{"SO", "INVENTORYENTRIESOUT.LIST"}, {"SI", "INVENTORYENTRIESIN.LIST"}} {
			for _, k := range e.list("", io.p) {
				r := e.recs[k]
				dp := yes(r["dp"])
				b.WriteString("<" + io.tag + ">")
				pushTag(&b, "STOCKITEMNAME", "String", r["item"])
				if dp != "" {
					pushTag(&b, "ISDEEMEDPOSITIVE", "Logical", dp)
				}
				pushTag(&b, "RATE", "Rate", r["rate"])
				pushTag(&b, "AMOUNT", "Amount", money(r, "amt", "neg", dp))
				pushTag(&b, "ACTUALQTY", "Quantity", r["aq"])
				pushTag(&b, "BILLEDQTY", "Quantity", or(r["bq"], r["aq"]))
				batches(k, dp)
				b.WriteString("</" + io.tag + ">")
			}
		}
	}
	if e.payroll() {
		for _, k := range e.list("", "CE") {
			b.WriteString("<CATEGORYENTRY.LIST>")
			pushTag(&b, "CATEGORY", "String", e.recs[k]["cat"])
			for _, em := range e.list(k, "E") {
				r := e.recs[em]
				b.WriteString("<EMPLOYEEENTRIES.LIST>")
				pushTag(&b, "EMPLOYEENAME", "String", r["emp"])
				pushTag(&b, "AMOUNT", "Amount", money(r, "amt", "neg", ""))
				for _, p := range e.list(em, "p") {
					rp := e.recs[p]
					b.WriteString("<PAYHEADALLOCATIONS.LIST>")
					pushTag(&b, "PAYHEADNAME", "String", rp["ph"])
					pushTag(&b, "AMOUNT", "Amount", money(rp, "amt", "neg", ""))
					b.WriteString("</PAYHEADALLOCATIONS.LIST>")
				}
				for _, a := range e.list(em, "a") {
					ra := e.recs[a]
					b.WriteString("<ATTENDANCEENTRIES.LIST>")
					pushTag(&b, "ATTENDANCETYPE", "String", ra["att"])
					pushTag(&b, "ATTDTYPEVALUE", "Number", ra["val"])
					b.WriteString("</ATTENDANCEENTRIES.LIST>")
				}
				b.WriteString("</EMPLOYEEENTRIES.LIST>")
			}
			b.WriteString("</CATEGORYENTRY.LIST>")
		}
	}
	b.WriteString("</VOUCHER>")
	if err != nil {
		return "", err
	}
	// every record written is one the XML has a place for (a record of an unknown kind: a newer add-on; not guessed)
	for _, k := range e.order {
		if !rePushKnown.MatchString(k) {
			return "", fmt.Errorf("record %s is of a kind this bridge does not know", k)
		}
	}
	if total != 0 && nl > 0 && e.s("canc") != "Yes" {
		return "", fmt.Errorf("the ledger lines do not add up to zero (%s)", fmtPaise(total))
	}
	return cleanXML(b.String()), nil
}

var rePushKnown = regexp.MustCompile(`^(L\d+(R\d+|B\d+|K\d+|C\d+(c\d+)?|T\d+(s\d+)?)?|I\d+(R\d+|A\d+(C\d+(c\d+)?)?|b\d+)?|O\d+|S[OI]\d+(b\d+)?|CE\d+(E\d+(p\d+|a\d+)?)?)$`)

func fmtPaise(p int64) string {
	s := ""
	if p < 0 {
		s, p = "-", -p
	}
	return fmt.Sprintf("%s%d.%02d", s, p/100, p%100)
}

// the ALTERID of an entry's XML set (the light check's counter, unambiguous)
func pushSetAlter(x string, alter int64) string {
	t := fmt.Sprintf(`<ALTERID TYPE="Number"> %d</ALTERID>`, alter)
	if loc := re(tagOpenRe("ALTERID") + `[^<]*</ALTERID>`).FindStringIndex(x); loc != nil {
		return x[:loc[0]] + t + x[loc[1]:]
	}
	if i := strings.Index(x, "<MASTERID"); i >= 0 {
		return x[:i] + t + x[i:]
	}
	return x
}

// --- the version of a full entry: the line carries no AlterID (the form holds the one before the save; the add-on cannot
// read the company's counter). Each full entry this bridge sends carries push_seq: the time the bridge took the line, to
// the millisecond, times 100, plus a sequence, never below the last one (one bridge's full entries in the order it took
// them, the order Tally saved them in its user's file). FinCom keeps it apart from Tally's AlterID (migration 69)
var pushSeqLast atomic.Int64

func livePushSeq(ms int64) int64 {
	v := ms * 100
	for {
		last := pushSeqLast.Load()
		if v <= last {
			v = last + 1
		}
		if pushSeqLast.CompareAndSwap(last, v) {
			return v
		}
	}
}

// the records of an entry in a stable order (the tests)
func (e *pushEntry) keys() []string {
	ks := append([]string{}, e.order...)
	sort.Strings(ks)
	return ks
}
