// Fix in place (the owner's approval of 23-Nov-2026, findings/fix-in-place-plan.md section 2.3, decisions 1, 2, 4-7):
// FinCom's "What to fix" lists correct an entry where it is shown. Two requests, each with its own id on the allow-list
// and pinned to its one builder (as FinComPayrollImport):
//
//   - FinComFixVoucher (report Vouchers): ONE existing voucher, by its GUID (REMOTEID), ACTION="Alter", its date and type
//     as read, and one to three of VOUCHERNUMBER (1-16 of A-Z a-z 0-9 / -, not only zeros), PLACEOFSUPPLY (a state of
//     the GST list, Tally's spelling) and PARTYGSTIN (a GSTIN whose check digit holds); no list, no amount, no narration;
//   - FinComFixLedger (report All Masters): ONE existing ledger by its name as Tally gives it, ACTION="Alter", either its
//     GST registration (LEDGSTREGDETAILS.LIST: the dated record's APPLICABLEFROM and registration type as read, the GSTIN,
//     the state from the GSTIN's first two digits; and PARTYGSTIN) or its PAN (INCOMETAXNUMBER); never a rename, a
//     parent, an opening or bank details.
//
// The plain Import never carries an Alter of a voucher, ledger or group any more (decision 7: cannotSend and the pin
// refuse it), so these two are the only way an existing entry or ledger is changed. A voucher type's numbering stays.
//
// One fix (runFix, the local route /fix): only this user's own Tally and the company with the linked GUID (as a
// posting and /unpost); held while someone types in Tally or a posting goes (postings first); under the posting gate of
// that Tally (one at a time); the entry read first by its MasterID (FinComVoucherObject, approved) and NOTHING sent when
// its AlterID is not the one FinCom showed (the entry as it is now is given back instead); the one Alter, stopped at 2 s;
// the entry read again, and given to the cloud as an "altered" line with its body (the recorder does not read back an
// imported entry carrying FinCom's own tag); Tally's own words when it refuses. A ledger: read by its name first
// (FinComLedgerByName, approved), its GSTIN or PAN compared with the one FinCom showed, read again and sent as the
// ledger list sends it. No AI.
//
// The review of 595554fbe (24-Nov-2026): the entry's date and type FinCom sends must be the ones just read, else
// "changed since" and nothing is sent; the typing gate is looked at again right before the send; what Tally changed
// beyond what was asked is said in the answer (alsoChanged); a ledger fix needs the ledger's AlterID; the
// registration type goes as read (Regular when there is none, or when it is unregistered: a GSTIN is given); the recorder line's source is "fix"; an ACTION
// with '&' in its value is refused by the posting rule (post.go cannotSend)
//
// The owner's decision of 24-Nov-2026 (amends decision 5, "ledger only"): a GSTIN fix corrects the party ledger AND that
// party's invoices carrying the wrong GSTIN. Each invoice is one /fix of target "voucher" with fields {gstin} only
// through shape A's PARTYGSTIN, a 15-character GSTIN whose check digit holds, and every check of a voucher fix (this
// user's Tally open, the AlterID unchanged, the date and type as read, the typing gate before the read and the send).
// A ledger FinCom has no AlterID for is read first in the same Save ({readFirst: true}: FinComLedgerByName under every
// gate, nothing sent, the ledger and its AlterID given back); the fix itself still goes only with that AlterID.
package main

import (
	"errors"
	"fmt"
	"html"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	fixVoucherID = "FinComFixVoucher"
	fixLedgerID  = "FinComFixLedger"
	fixMaxBytes  = 16 << 10
	fixSec       = 2 // every request of a fix is stopped at 2 s
)

// the GST state codes and Tally's names of the states
var fixStates = map[string]string{
	"01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
	"07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
	"13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
	"20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
	"26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
	"32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
	"37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
}

func fixStateOK(s string) bool {
	for _, v := range fixStates {
		if v == s {
			return true
		}
	}
	return false
}

var (
	reFixGSTIN  = regexp.MustCompile(`^\d{2}[A-Z0-9]{10}[1-9A-Z][A-Z0-9][0-9A-Z]$`)
	reFixPAN    = regexp.MustCompile(`^[A-Z]{5}\d{4}[A-Z]$`)
	reFixNumber = regexp.MustCompile(`^[A-Za-z0-9/-]{1,16}$`)
	reFixGUID   = regexp.MustCompile(`^[A-Za-z0-9-]{1,100}$`)
	// review of 595554fbe: the ledger's registration type goes as Tally gave it (Regular, Composition,
	// Unregistered/Consumer, ...): letters, digits, spaces, / ( ) and -, 1 to 40
	reFixRegType = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9 /()-]{0,39}$`)
	// review of 595554fbe: an ACTION attribute whose value holds a character reference ('&'): never sent (Tally would
	// read "&#65;lter" as Alter, which the plain Import's rule would not see)
	reActionAmp = regexp.MustCompile(`(?i)\bACTION\s*=\s*(?:"[^"]*&|'[^']*&|[^\s"'>]*&)`)
)

// a GSTIN of the form with its check digit right and a known state
func fixGSTINOK(g string) bool {
	if !reFixGSTIN.MatchString(g) || fixStates[g[:2]] == "" {
		return false
	}
	const cs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	sum := 0
	for i := 0; i < 14; i++ {
		p := strings.IndexByte(cs, g[i]) * (1 + i%2)
		sum += p/36 + p%36
	}
	return cs[(36-sum%36)%36] == g[14]
}

func fixNumberOK(n string) bool {
	return reFixNumber.MatchString(n) && strings.Trim(n, "0/-") != ""
}

// the fields one voucher fix may change
type fixFields struct{ number, pos, gstin string }

func fixMsg(obj string) string {
	return `<TALLYMESSAGE xmlns:UDF="TallyUDF">` + obj + "</TALLYMESSAGE>"
}

// FinComFixVoucher as approved; why it cannot be built ("" when it is)
func fixVoucherRequest(company, guid, vtype, date string, f fixFields) (string, string) {
	switch {
	case !prTextOK(company, payrollMaxName) || strings.TrimSpace(company) == "":
		return "", "no company"
	case !reFixGUID.MatchString(guid):
		return "", "the entry has no Tally id (GUID)"
	case !prTextOK(vtype, payrollMaxName) || strings.TrimSpace(vtype) == "":
		return "", "the entry has no voucher type"
	case !isTallyDate(date) || !prRealDate(date):
		return "", "the entry has no date"
	case f.number == "" && f.pos == "" && f.gstin == "":
		return "", "nothing to change"
	case f.number != "" && !fixNumberOK(f.number):
		return "", "the number takes 1 to 16 letters, digits, / and -, and not only zeros"
	case f.pos != "" && !fixStateOK(f.pos):
		return "", "the place of supply is not a state of the GST list"
	case f.gstin != "" && !fixGSTINOK(f.gstin):
		return "", "the GSTIN is not valid"
	}
	o := `<VOUCHER REMOTEID="` + esc(guid) + `" VCHTYPE="` + esc(vtype) + `" ACTION="Alter">` + "\n" +
		"<DATE>" + date + "</DATE>\n<VOUCHERTYPENAME>" + esc(vtype) + "</VOUCHERTYPENAME>\n"
	if f.number != "" {
		o += "<VOUCHERNUMBER>" + esc(f.number) + "</VOUCHERNUMBER>\n"
	}
	if f.pos != "" {
		o += "<PLACEOFSUPPLY>" + esc(f.pos) + "</PLACEOFSUPPLY>\n"
	}
	if f.gstin != "" {
		o += "<PARTYGSTIN>" + f.gstin + "</PARTYGSTIN>\n"
	}
	return importEnvelope("Vouchers", company, fixMsg(o+"</VOUCHER>\n")), ""
}

func fixLedgerHead(company, name string) string {
	if !prTextOK(company, payrollMaxName) || strings.TrimSpace(company) == "" || !prTextOK(name, payrollMaxName) || strings.TrimSpace(name) == "" {
		return ""
	}
	return `<LEDGER NAME="` + esc(name) + `" ACTION="Alter">` + "\n<NAME>" + esc(name) + "</NAME>\n"
}

// FinComFixLedger, the GST registration form
func fixLedgerGSTRequest(company, name, from, regType, gstin string) (string, string) {
	h := fixLedgerHead(company, name)
	switch {
	case h == "":
		return "", "no company or ledger name"
	case !isTallyDate(from) || !prRealDate(from):
		return "", "no date the registration applies from"
	case !reFixRegType.MatchString(regType):
		return "", "the registration type is not one Tally gives"
	case !fixGSTINOK(gstin):
		return "", "the GSTIN is not valid"
	}
	o := h + "<LEDGSTREGDETAILS.LIST>\n<APPLICABLEFROM>" + from + "</APPLICABLEFROM>\n<GSTREGISTRATIONTYPE>" + esc(regType) +
		"</GSTREGISTRATIONTYPE>\n<GSTIN>" + gstin + "</GSTIN>\n<PLACEOFSUPPLY>" + esc(fixStates[gstin[:2]]) + "</PLACEOFSUPPLY>\n</LEDGSTREGDETAILS.LIST>\n" +
		"<PARTYGSTIN>" + gstin + "</PARTYGSTIN>\n</LEDGER>\n"
	return importEnvelope("All Masters", company, fixMsg(o)), ""
}

// FinComFixLedger, the PAN form
func fixLedgerPANRequest(company, name, pan string) (string, string) {
	h := fixLedgerHead(company, name)
	if h == "" {
		return "", "no company or ledger name"
	}
	if !reFixPAN.MatchString(pan) {
		return "", "the PAN is not 5 letters, 4 digits and a letter"
	}
	return importEnvelope("All Masters", company, fixMsg(h+"<INCOMETAXNUMBER>"+pan+"</INCOMETAXNUMBER>\n</LEDGER>\n")), ""
}

// --- the pin (pinned.go): the request is rebuilt from its own values by the builder; only byte-identical goes
const fxT = `((?:[^<>&"]|&(?:amp|lt|gt|#34|#39);)*)`

var (
	reFixMark = regexp.MustCompile(`(?i)<\s*(VOUCHER|LEDGER|GROUP)\b[^>]*\bACTION\s*=\s*["']?\s*ALTER\b`)
	reFixV    = regexp.MustCompile(`^<VOUCHER REMOTEID="` + fxT + `" VCHTYPE="` + fxT + `" ACTION="Alter">\n<DATE>(\d{8})</DATE>\n<VOUCHERTYPENAME>` + fxT +
		`</VOUCHERTYPENAME>\n(?:<VOUCHERNUMBER>` + fxT + `</VOUCHERNUMBER>\n)?(?:<PLACEOFSUPPLY>` + fxT + `</PLACEOFSUPPLY>\n)?(?:<PARTYGSTIN>` + fxT + `</PARTYGSTIN>\n)?</VOUCHER>\n$`)
	reFixLHead = regexp.MustCompile(`^<LEDGER NAME="` + fxT + `" ACTION="Alter">\n`)
	reFixLGST  = regexp.MustCompile(`<APPLICABLEFROM>(\d{8})</APPLICABLEFROM>\n<GSTREGISTRATIONTYPE>` + fxT + `</GSTREGISTRATIONTYPE>\n<GSTIN>` + fxT + `</GSTIN>\n`)
	reFixLPAN  = regexp.MustCompile(`<INCOMETAXNUMBER>` + fxT + `</INCOMETAXNUMBER>\n</LEDGER>\n$`)
)

// the id of an Import that alters a voucher or a ledger ("" : none); a group's Alter stays the plain Import's (refused there)
func fixImportID(x string) string {
	m := reFixMark.FindStringSubmatch(x)
	if m == nil {
		return ""
	}
	switch strings.ToUpper(m[1]) {
	case "VOUCHER":
		return fixVoucherID
	case "LEDGER":
		return fixLedgerID
	}
	return ""
}

// the one object of an Import of this report ("", false when it is not one)
func fixObject(x, report string) (string, bool) {
	head := importHead + report + "</REPORTNAME>"
	if len(x) > fixMaxBytes || !strings.HasPrefix(x, head) {
		return "", false
	}
	a, z := strings.Index(x, "<REQUESTDATA>"), strings.LastIndex(x, "</REQUESTDATA>")
	if a < 0 || z < a {
		return "", false
	}
	body := x[a+len("<REQUESTDATA>") : z]
	const open, close = `<TALLYMESSAGE xmlns:UDF="TallyUDF">`, "</TALLYMESSAGE>"
	if !strings.HasPrefix(body, open) || !strings.HasSuffix(body, close) {
		return "", false
	}
	return body[len(open) : len(body)-len(close)], true
}

func fixVoucherRebuild(x string) []string {
	o, ok := fixObject(x, "Vouchers")
	m := reFixV.FindStringSubmatch(o)
	if !ok || m == nil {
		return nil
	}
	u := html.UnescapeString
	y, why := fixVoucherRequest(pinCo(x), u(m[1]), u(m[2]), m[3], fixFields{number: u(m[5]), pos: u(m[6]), gstin: u(m[7])})
	if why != "" {
		return nil
	}
	return []string{y}
}

func fixLedgerRebuild(x string) []string {
	o, ok := fixObject(x, "All Masters")
	h := reFixLHead.FindStringSubmatch(o)
	if !ok || h == nil {
		return nil
	}
	u := html.UnescapeString
	name := u(h[1])
	if m := reFixLPAN.FindStringSubmatch(o); m != nil {
		y, why := fixLedgerPANRequest(pinCo(x), name, u(m[1]))
		if why == "" {
			return []string{y}
		}
	}
	if m := reFixLGST.FindStringSubmatch(o); m != nil {
		y, why := fixLedgerGSTRequest(pinCo(x), name, m[1], u(m[2]), u(m[3]))
		if why == "" {
			return []string{y}
		}
	}
	return nil
}

// the allow-list's samples (allowListSamples), made-up values
func fixVoucherSample(c string) string {
	x, _ := fixVoucherRequest(c, "00000000-0000-0000-0000-000000000000-00000001", "Sales", "20260401", fixFields{number: "INV-1", pos: "Delhi", gstin: "27AAPFU0939F1ZV"})
	return x
}

func fixLedgerSample(c string) string {
	x, _ := fixLedgerGSTRequest(c, "SAMPLE PARTY", "20250401", "Regular", "27AAPFU0939F1ZV")
	return x
}

// --- the fix
var (
	fixPortFn        = fixPort
	fixTypingFn      = func() bool { return typingInTally() }
	fixReadVoucherFn = fixReadVoucher
	fixSendFn        = fixSend
	fixQueueFn       = fixQueue
	fixReadLedgerFn  = fixReadLedger
	fixLedgerSendFn  = func(company, guid, bf string, rows []ledRow) error {
		return ledSend(company, guid, bf, rows, "fix", 0, 0)
	}
	fixBooksFromFn = func(company string) (string, error) { return booksFromForRead(fixTC(), company) }
	// review of cd7b81337: the company's groups as this computer last read them from Tally (FinComGroupList's
	// group-list.json; nothing is asked for a fix)
	// review of 0e0e0f3a1: the company's own folder (keep.go companyDir), where the masters read writes it; a name with
	// no folder: no list (the group is then not known, and the fix refused)
	fixGroupsFn = func(company string) [][2]string {
		dir, err := companyDir(company)
		if err != nil {
			return nil
		}
		return heldGroupList(dir)
	}
)

// the group list held in dir (group-list.json: [name, parent] rows; a primary group's parent is empty); nil when none
func heldGroupList(dir string) [][2]string {
	var out [][2]string
	for _, x := range arr(readJSONFile(filepath.Join(dir, "group-list.json"))) {
		a := arr(x)
		if n := strings.TrimSpace(str(at(a, 0))); n != "" {
			out = append(out, [2]string{n, strings.TrimSpace(str(at(a, 1)))})
		}
	}
	return out
}

// review of cd7b81337: a ledger is a party when its group (PARENT as read) is Sundry Debtors or Sundry Creditors, or a
// group under one of them by the group list held (party); known is false when that cannot be told (no parent read, a
// group not in the list, a loop), and then the fix is refused too
func fixPartyGroup(parent string, groups [][2]string) (party, known bool) {
	up := map[string]string{}
	for _, g := range groups {
		up[foldName(g[0])] = g[1]
	}
	seen := map[string]bool{}
	for g := strings.TrimSpace(parent); g != ""; {
		f := foldName(g)
		if f == "SUNDRY DEBTORS" || f == "SUNDRY CREDITORS" {
			return true, true
		}
		p, ok := up[f]
		if !ok || seen[f] {
			return false, false
		}
		seen[f] = true
		g = strings.TrimSpace(re(`^\W*Primary$`).ReplaceAllString(p, ""))
	}
	return false, strings.TrimSpace(parent) != ""
}

// review of 0e0e0f3a1: the entry's party ledger (PARTYLEDGERNAME, as just read) is a party: nil; else the refusal
// (Tally not answering the ledger read: held, as any read of a fix)
func fixVoucherParty(raw string, port int, company string) M {
	name := strings.TrimSpace(html.UnescapeString(tagRaw(raw, "PARTYLEDGERNAME")))
	if name == "" || !ledNameOK(name) {
		writeLog("Fix in place: an entry's GSTIN is not changed: it names no party ledger")
		return M{"ok": false, "notParty": true, "message": "This entry names no party ledger, so its GSTIN is not changed."}
	}
	bf, err := fixBooksFromFn(company)
	if err != nil {
		return fixHeldWhy(err)
	}
	lr, err := fixReadLedgerFn(port, company, bf, name)
	if err != nil {
		return fixHeldWhy(err)
	}
	rows, _ := ledRowsOf(lr)
	var row *ledRow
	for i := range rows {
		if strings.EqualFold(rows[i].name, name) {
			row = &rows[i]
		}
	}
	parent := ""
	if row != nil {
		parent = row.parent
	}
	if why := fixNotPartyWords(parent, fixGroupsFn(company), "GSTIN"); why != "" {
		writeLog("Fix in place: an entry's GSTIN is not changed: its party " + name + " is not a party ledger (its group: " + or(parent, "not read") + ")")
		return M{"ok": false, "notParty": true, "message": why}
	}
	return nil
}

// the refusal's words when the ledger is not a party ("" when it is one)
func fixNotPartyWords(parent string, groups [][2]string, what string) string {
	party, known := fixPartyGroup(parent, groups)
	switch {
	case party:
		return ""
	case known:
		return "This ledger is not a party (it is under " + parent + "), so its " + what + " is not changed."
	case strings.TrimSpace(parent) == "":
		return "Tally did not say which group this ledger is under, so its " + what + " is not changed."
	}
	return "FinCom cannot tell that this ledger is a party (it is under " + parent + "), so its " + what + " is not changed."
}

// a person's request (the person pressed Save): sent at once, never on the background schedule
func fixTC() *TC { return &TC{person: true, limitMs: fixSec * 1000} }

// the port and the company's name in this user's own Tally, the company with the linked GUID only
func fixPort(p M) (int, string, error) {
	company := str(p["company"])
	if err := postingAllowedFor(company); err != nil {
		return 0, "", err
	}
	look, guid, err := findLinkedNow(M{"company": company, "guid": p["companyGuid"]})
	if err != nil {
		return 0, "", err
	}
	g, _, err := companyCheckSaid(fin, look.name, look.port)
	if err != nil || normGUID(g) == "" || normGUID(g) != guid {
		return 0, "", errors.New(openToPost(company))
	}
	return look.port, look.name, nil
}

// one voucher as Tally holds it now (the approved fields), "" when Tally has none of that MasterID
func fixReadVoucher(port int, company, mid, date string) (string, error) {
	m, err := fetchVouchersByMasterIn(fixTC(), company, port, date, []string{mid}, fixSec)
	if err != nil {
		return "", err
	}
	return m[mid], nil
}

func fixSend(port int, x string) (string, error) {
	importsInFlight.Add(1)
	defer func() { importsInFlight.Add(-1); importGaps.Add(1) }()
	return invokeTally(fin, port, x, fixSec)
}

// the entry read back goes to FinCom's cloud as an altered line, as the recorder's own (source B's) lines go
func fixQueue(c *change) {
	live.mu.Lock()
	defer live.mu.Unlock()
	if !live.sent[c.lineId] && !live.queued[c.lineId] {
		liveQueueAdd(c)
	}
}

func fixReadLedger(port int, company, bf, name string) (string, error) {
	return invokeTally(fixTC(), port, ledgerByNameRequestAt(company, bf, name), fixSec)
}

// what FinCom shows of an entry
func fixHead(x string) M {
	t := func(tag string) string { return strings.TrimSpace(html.UnescapeString(tagRaw(x, tag))) }
	return M{"guid": t("GUID"), "masterId": t("MASTERID"), "alterId": t("ALTERID"), "date": t("DATE"), "type": t("VOUCHERTYPENAME"),
		"number": t("VOUCHERNUMBER"), "pos": t("PLACEOFSUPPLY"), "gstin": t("PARTYGSTIN")}
}

func fixHeld(msg string) M { return M{"ok": false, "held": true, "message": msg} }

// Tally's trouble in a person's words: closed, busy or not answering
func fixHeldWhy(err error) M {
	if err == nil {
		return fixHeld("Tally is closed. The change is made when it opens.")
	}
	return M{"ok": false, "held": true, "message": "Tally is closed. The change is made when it opens.", "detail": cutRunes(err.Error(), 200)}
}

// runFix: one fix asked by FinCom (POST /fix): {company, companyGuid, target "voucher" | "ledger", ...}
func runFix(p M) M {
	f := obj(p["fields"])
	switch str(p["target"]) {
	case "voucher":
		for k, v := range f {
			if k != "number" && k != "pos" && k != "gstin" {
				return M{"ok": false, "message": "Only an entry's number, place of supply or party GSTIN is changed here."}
			}
			if _, ok := v.(string); !ok {
				return M{"ok": false, "message": "Not sent: the " + k + " is not a text."}
			}
		}
		if strings.TrimSpace(str(p["alterId"])) == "" {
			return M{"ok": false, "message": "Open the entry again: FinCom needs its change number from Tally first."}
		}
		ff := fixFields{number: strings.TrimSpace(str(f["number"])), pos: strings.TrimSpace(str(f["pos"]))}
		if g, asked := f["gstin"]; asked {
			// the owner's decision of 24-Nov-2026: the party's invoices carrying the wrong GSTIN are corrected too, by the
			// approved shape A's PARTYGSTIN; only a 15-character GSTIN whose check digit holds, else nothing is read or sent
			ff.gstin = strings.ToUpper(strings.TrimSpace(str(g)))
			if !fixGSTINOK(ff.gstin) {
				return M{"ok": false, "message": "Not sent: the GSTIN is not valid (15 characters, its check digit right)."}
			}
		}
		if n, ok := fixStates[ff.pos]; ok { // FinCom names the state by its GST code; Tally's spelling is the bridge's
			ff.pos = n
		}
		if _, why := fixVoucherRequest("x", str(p["guid"]), str(p["vchType"]), str(p["vchDate"]), ff); why != "" {
			return M{"ok": false, "message": "Not sent: " + why + "."}
		}
		return fixOne(p, func(port int, company string) M { return fixVoucher(p, ff, port, company) })
	case "ledger":
		for k := range f {
			if k != "gstin" && k != "pan" {
				return M{"ok": false, "message": "Only a party's GSTIN or PAN is changed here."}
			}
		}
		g, pan := strings.ToUpper(strings.TrimSpace(str(f["gstin"]))), strings.ToUpper(strings.TrimSpace(str(f["pan"])))
		if (g == "") == (pan == "") || (g != "" && !fixGSTINOK(g)) || (pan != "" && !reFixPAN.MatchString(pan)) {
			return M{"ok": false, "message": "Not sent: give one valid GSTIN or one valid PAN."}
		}
		if onlyDigits(strings.TrimSpace(str(p["alterId"]))) == "" {
			if p["readFirst"] == true {
				// the owner's decision of 24-Nov-2026: FinCom holds no AlterID for this ledger, so the same Save reads it
				// first (FinComLedgerByName, every gate of a fix); nothing is sent, FinCom sends the fix with this AlterID
				return fixOne(p, func(port int, company string) M { return fixLedgerReadOnly(p, port, company) })
			}
			// the plan's AlterID check for a ledger (section 2.4 step 3): FinCom sends the ledger's ALTERID
			return M{"ok": false, "message": "Open the party again: FinCom needs its change number from Tally first."}
		}
		return fixOne(p, func(port int, company string) M { return fixLedger(p, g, pan, port, company) })
	}
	return M{"ok": false, "message": "Only an entry's number, place of supply or party GSTIN, or a party's GSTIN or PAN, is changed here."}
}

// the gates every fix passes: typing, postings first, this user's own Tally and the linked company, one at a time
func fixOne(p M, do func(port int, company string) M) M {
	if fixTypingFn() {
		return fixHeld("Someone is working in Tally. The change is made in a moment.")
	}
	if postingGoing() {
		return fixHeld("Entries are going to Tally. The change is made right after.")
	}
	port, company, err := fixPortFn(p)
	if err != nil {
		return fixHeldWhy(err)
	}
	gate := postGate(port)
	gate.Lock()
	defer gate.Unlock()
	r := do(port, company)
	writeLog(fmt.Sprintf("Fix in place (%s) in %s: ok=%v %s", str(p["target"]), company, r["ok"], cutRunes(str(r["message"]), 200)))
	return r
}

func fixVoucher(p M, ff fixFields, port int, company string) M {
	guid, vt, date := str(p["guid"]), str(p["vchType"]), str(p["vchDate"])
	mid := onlyDigits(str(p["masterId"]))
	if mid == "" {
		if n := guidMaster(guid); n > 0 {
			mid = fmt.Sprint(n)
		}
	}
	if mid == "" {
		return M{"ok": false, "message": "Not sent: the entry has no Tally MasterID."}
	}
	raw, err := fixReadVoucherFn(port, company, mid, date)
	if err != nil {
		return fixHeldWhy(err)
	}
	if raw == "" {
		return M{"ok": false, "gone": true, "message": "Tally no longer has this entry."}
	}
	now := fixHead(raw)
	if !strings.EqualFold(str(now["guid"]), guid) {
		return M{"ok": false, "message": "Tally gives another entry for this id. Nothing was changed."}
	}
	// review of 595554fbe (B1): the AlterID, and the date and type FinCom sent, must be what was just read; the
	// request carries the date and type, so any other is "changed since" and nothing is sent
	if str(now["alterId"]) != strings.TrimSpace(str(p["alterId"])) || str(now["date"]) != date || str(now["type"]) != vt {
		return M{"ok": false, "changed": true, "now": now, "alterNow": now["alterId"], "xml": raw,
			"message": "Changed in Tally since it was opened here. This is how it is now."}
	}
	// review of 0e0e0f3a1: a GSTIN fix only on an entry whose party ledger is a party, the ledger fix's rule and words
	// (its PARENT read by FinComLedgerByName, the group list held); nothing is sent otherwise
	if ff.gstin != "" {
		if r := fixVoucherParty(raw, port, company); r != nil {
			return r
		}
	}
	x, why := fixVoucherRequest(company, guid, vt, date, ff)
	if why != "" {
		return M{"ok": false, "message": "Not sent: " + why + "."}
	}
	if fixTypingFn() { // the typing gate again, right before the send
		return fixHeld("Someone is working in Tally. The change is made in a moment.")
	}
	reply, serr := fixSendFn(port, x)
	rr := M{}
	if serr == nil {
		rr = readImportResult(reply)
		if rr["ok"] != true {
			return M{"ok": false, "refused": true, "message": "Tally did not change it: " + or(str(rr["message"]), "it gave no reason") + "."}
		}
	}
	// read back: what Tally holds now decides (also when its answer was lost)
	raw2, rerr := fixReadVoucherFn(port, company, mid, date)
	if rerr != nil || raw2 == "" {
		if serr != nil {
			return M{"ok": false, "unknown": true, "message": "Tally did not answer. Ask Tally again to see whether it changed."}
		}
		return M{"ok": false, "unknown": true, "message": "Tally took the change; reading it back did not work. Ask Tally again."}
	}
	after := fixHead(raw2)
	moved := str(after["alterId"]) != str(now["alterId"])
	if moved {
		c := &change{company: company, companyGuid: normGUID(str(p["companyGuid"])), event: "altered", guid: str(after["guid"]), masterId: mid,
			alterId: str(after["alterId"]), vchType: str(after["type"]), vchNo: str(after["number"]), vchDate: or(str(after["date"]), date),
			narr: html.UnescapeString(tagRaw(raw2, "NARRATION")), source: "fix", saveMs: -1, readAt: time.Now(),
			at: time.Now().In(liveZone).Format(time.RFC3339), xml: raw2, bodyTried: true, full: liveFetchFull(), ledgers: fixLedgersOf(raw2)}
		c.lineId = liveLineID("fix", c.companyGuid, c.guid, c.alterId)
		fixQueueFn(c)
	}
	same := (ff.number == "" || after["number"] == ff.number) && (ff.pos == "" || strings.EqualFold(str(after["pos"]), ff.pos)) && (ff.gstin == "" || after["gstin"] == ff.gstin)
	out := M{"before": now, "after": after, "alterBefore": now["alterId"], "alterAfter": after["alterId"], "xml": raw2}
	also := fixAlsoChanged(raw, raw2, ff)
	if len(also) > 0 {
		out["alsoChanged"] = also
		writeLog("Fix in place: Tally also changed " + strings.Join(also, ", ") + " of " + guid + " (not asked)")
	}
	switch {
	case same && moved:
		out["ok"], out["message"] = true, "Saved in Tally."
		if len(also) > 0 {
			out["message"] = "Saved in Tally. Tally also changed the " + strings.Join(also, ", the ") + " of this entry, which was not asked. Check it in Tally."
		}
	case serr != nil:
		out["ok"], out["message"] = false, "Tally did not answer and the entry is as it was. Try again."
	default:
		out["ok"], out["kept"], out["message"] = false, true, "Tally kept its own value. This is how the entry is now."
	}
	return out
}

// review of 595554fbe: what Tally changed in the entry that the fix did not ask (the entry read before and after, field by
// field; its change number and the fields asked left out), in a person's words for the head fields, Tally's tag else
var (
	reFixLeaf   = regexp.MustCompile(`<([A-Za-z0-9._]+)(?:\s[^<>]*)?>([^<>]*)</([A-Za-z0-9._]+)>`)
	fixLeafWord = map[string]string{"DATE": "date", "VOUCHERTYPENAME": "voucher type", "VOUCHERNUMBER": "number", "PLACEOFSUPPLY": "place of supply",
		"PARTYGSTIN": "party GSTIN", "NARRATION": "narration", "PARTYLEDGERNAME": "party", "LEDGERNAME": "ledger lines", "AMOUNT": "amounts",
		"GUID": "Tally id", "MASTERID": "Tally id", "REFERENCE": "reference"}
)

func fixAlsoChanged(before, after string, ff fixFields) []string {
	skip := map[string]bool{"ALTERID": true}
	if ff.number != "" {
		skip["VOUCHERNUMBER"] = true
	}
	if ff.pos != "" {
		skip["PLACEOFSUPPLY"] = true
	}
	if ff.gstin != "" {
		skip["PARTYGSTIN"] = true
	}
	leaves := func(x string) map[string][]string {
		o := map[string][]string{}
		for _, m := range reFixLeaf.FindAllStringSubmatch(x, -1) {
			if k := strings.ToUpper(m[1]); m[1] == m[3] && !skip[k] {
				o[k] = append(o[k], strings.TrimSpace(html.UnescapeString(m[2])))
			}
		}
		return o
	}
	a, b := leaves(before), leaves(after)
	tags := map[string]bool{}
	for k := range a {
		tags[k] = true
	}
	for k := range b {
		tags[k] = true
	}
	keys := make([]string, 0, len(tags))
	for k := range tags {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	seen := map[string]bool{}
	var out []string
	for _, k := range keys {
		if strings.Join(a[k], "\x00") == strings.Join(b[k], "\x00") {
			continue
		}
		w := fixLeafWord[k]
		if w == "" {
			w = k
		}
		if !seen[w] {
			seen[w] = true
			out = append(out, w)
		}
	}
	return out
}

func fixLedgersOf(x string) []string {
	seen := map[string]bool{}
	var o []string
	for _, m := range regexp.MustCompile(`<LEDGERNAME>([^<]*)</LEDGERNAME>`).FindAllStringSubmatch(x, -1) {
		n := strings.TrimSpace(html.UnescapeString(m[1]))
		if n != "" && !seen[strings.ToLower(n)] {
			seen[strings.ToLower(n)] = true
			o = append(o, n)
		}
	}
	return o
}

// review of c00b14edb: Tally's types with no registration (Unregistered/Consumer, the older Unregistered, Consumer,
// Unknown), in any case or spacing
func fixUnregistered(typ string) bool {
	t := strings.ToLower(strings.Join(strings.Fields(strings.ReplaceAll(typ, "/", " / ")), ""))
	// review of 0e0e0f3a1: Consumer and Unknown given a GSTIN go as Regular too
	return t == "unregistered" || t == "unregistered/consumer" || t == "consumer" || t == "unknown"
}

// the ledger's dated GST registration as read: the latest APPLICABLEFROM and its registration type ("" when none)
func fixLedgerReg(raw, name string) (from, regType string) {
	type reg struct{ from, typ string }
	var regs []reg
	for _, b := range regexp.MustCompile(`(?s)<LEDGER\b[^>]*>.*?</LEDGER>`).FindAllString(raw, -1) {
		n := html.UnescapeString(or(group(`<LEDGER NAME="([^"]*)"`, b, 1), tagRaw(b, "NAME")))
		if !strings.EqualFold(strings.TrimSpace(n), name) {
			continue
		}
		for _, l := range regexp.MustCompile(`(?s)<LEDGSTREGDETAILS\.LIST>.*?</LEDGSTREGDETAILS\.LIST>`).FindAllString(b, -1) {
			regs = append(regs, reg{strings.TrimSpace(tagRaw(l, "APPLICABLEFROM")), strings.TrimSpace(html.UnescapeString(tagRaw(l, "GSTREGISTRATIONTYPE")))})
		}
	}
	sort.Slice(regs, func(i, j int) bool { return regs[i].from < regs[j].from })
	if len(regs) == 0 {
		return "", ""
	}
	return regs[len(regs)-1].from, regs[len(regs)-1].typ
}

// the ledger as Tally holds it now, read by its name, nothing sent (a fix's read first, when FinCom has no AlterID)
func fixLedgerReadOnly(p M, port int, company string) M {
	name := strings.TrimSpace(str(p["ledger"]))
	bf, err := fixBooksFromFn(company)
	if err != nil {
		return fixHeldWhy(err)
	}
	raw, err := fixReadLedgerFn(port, company, bf, name)
	if err != nil {
		return fixHeldWhy(err)
	}
	rows, _ := ledRowsOf(raw)
	for _, r := range rows {
		if strings.EqualFold(r.name, name) {
			now := M{"gstin": r.gstin, "pan": r.pan, "alterId": fmt.Sprint(r.alter), "state": r.state}
			return M{"ok": false, "read": true, "now": now, "alterNow": now["alterId"], "ledger": r.name, "message": "Read from Tally."}
		}
	}
	return M{"ok": false, "gone": true, "message": "Tally has no ledger named " + name + "."}
}

func fixLedger(p M, gstin, pan string, port int, company string) M {
	name := strings.TrimSpace(str(p["ledger"]))
	bf, err := fixBooksFromFn(company)
	if err != nil {
		return fixHeldWhy(err)
	}
	raw, err := fixReadLedgerFn(port, company, bf, name)
	if err != nil {
		return fixHeldWhy(err)
	}
	rows, _ := ledRowsOf(raw)
	var row *ledRow
	for i := range rows {
		if strings.EqualFold(rows[i].name, name) {
			row = &rows[i]
		}
	}
	if row == nil {
		return M{"ok": false, "gone": true, "message": "Tally has no ledger named " + name + "."}
	}
	// review of cd7b81337: only a party's GSTIN or PAN (a ledger under Sundry Debtors or Sundry Creditors, or a group
	// under them); never Cash, a bank or any other ledger; its group not known: refused too. Nothing is sent
	what := "GSTIN"
	if pan != "" {
		what = "PAN"
	}
	if why := fixNotPartyWords(row.parent, fixGroupsFn(company), what); why != "" {
		writeLog("Fix in place: " + row.name + " is not changed: not a party ledger (its group: " + or(row.parent, "not read") + ")")
		return M{"ok": false, "notParty": true, "message": why}
	}
	was := M{"gstin": row.gstin, "pan": row.pan, "alterId": fmt.Sprint(row.alter)}
	// the AlterID check of a ledger: the value FinCom showed (and its AlterID, when FinCom has one) is Tally's now
	shown := obj(p["was"])
	if a := strings.TrimSpace(str(p["alterId"])); a != fmt.Sprint(row.alter) ||
		(gstin != "" && !strings.EqualFold(strings.TrimSpace(str(shown["gstin"])), row.gstin)) || (pan != "" && !strings.EqualFold(strings.TrimSpace(str(shown["pan"])), row.pan)) {
		return M{"ok": false, "changed": true, "now": was, "alterNow": was["alterId"], "message": "Changed in Tally since it was opened here. This is how it is now."}
	}
	var x, why string
	if pan != "" {
		x, why = fixLedgerPANRequest(company, row.name, pan)
	} else {
		from, typ := fixLedgerReg(raw, row.name)
		if from == "" {
			from = bf
		}
		if typ == "" || fixUnregistered(typ) {
			// review of 595554fbe: the type as read; Regular when the ledger has none. Review of c00b14edb: a party read
			// as unregistered (Unregistered/Consumer, Unregistered, Consumer, Unknown) that is given a GSTIN: Regular
			// (Composition, or any other type read, goes as read)
			typ = "Regular"
		}
		x, why = fixLedgerGSTRequest(company, row.name, from, typ, gstin)
	}
	if why != "" {
		return M{"ok": false, "message": "Not sent: " + why + "."}
	}
	if fixTypingFn() { // the typing gate again, right before the send
		return fixHeld("Someone is working in Tally. The change is made in a moment.")
	}
	reply, serr := fixSendFn(port, x)
	if serr == nil {
		if rr := readImportResult(reply); rr["ok"] != true {
			return M{"ok": false, "refused": true, "message": "Tally did not change it: " + or(str(rr["message"]), "it gave no reason") + "."}
		}
	}
	raw2, rerr := fixReadLedgerFn(port, company, bf, row.name)
	if rerr != nil {
		return M{"ok": false, "unknown": true, "message": "Tally did not answer. Ask Tally again to see whether it changed."}
	}
	rows2, _ := ledRowsOf(raw2)
	for i := range rows2 {
		r := rows2[i]
		if !strings.EqualFold(r.name, row.name) {
			continue
		}
		after := M{"gstin": r.gstin, "pan": r.pan, "alterId": fmt.Sprint(r.alter), "state": r.state}
		out := M{"before": was, "after": after, "alterBefore": was["alterId"], "alterAfter": after["alterId"], "ledger": r.name}
		if r.alter != row.alter {
			if err := fixLedgerSendFn(company, normGUID(str(p["companyGuid"])), bf, []ledRow{r}); err != nil {
				writeLog("Fix in place: the ledger " + r.name + " read back was not sent to FinCom's cloud now (" + cutRunes(err.Error(), 160) + "); the ledger list's next round sends it")
			}
		}
		if (gstin != "" && strings.EqualFold(r.gstin, gstin)) || (pan != "" && strings.EqualFold(r.pan, pan)) {
			out["ok"], out["message"] = true, "Saved in Tally."
		} else {
			out["ok"], out["kept"], out["message"] = false, true, "Tally kept its own value. This is how the ledger is now."
		}
		return out
	}
	return M{"ok": false, "unknown": true, "message": "Tally took the change; reading it back did not work. Ask Tally again."}
}
