// 2.1.4: a duplicate check at the moment of every posting, failing closed. Immediately before a voucher is sent to
// Tally (first post, Retry, Post again; from the browser or from FinCom's cloud queue), Tally is read live for that one
// date, filtered to the voucher's party: a voucher already there with the same party ledger, the same bill/reference
// number, the same date and the same amount is not posted again ("Already in Tally (voucher no. X, dd-mm-yyyy)").
// When Tally does not answer that read properly (busy, closed, a timeout, a bad answer) nothing is posted ("Could not
// check Tally, not posted. Try again."). Nothing bypasses it, a deliberate re-post of something removed from Tally
// included (it is simply not found). Masters (ledgers, groups, voucher types) are not vouchers and are not checked.
// 02-Oct-2026: a stale browser tab, and a cloud read made while Tally was timing out, offered FA/ELEC/013 (Fingate,
// 25,535.00, 01-Jul-2026) for posting again although it may already have been in Tally.
package main

import (
	"errors"
	"fmt"
	"html"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	dupCheckFailedMsg = "Could not check Tally, not posted. Try again."
	dupCheckID        = "TDSDeskDupCheck"
)

// one posting at a time per Tally from the check to the end of its import: two tabs posting the same voucher at once
// cannot both pass the check before either reaches Tally
var (
	postGateMu sync.Mutex
	postGates  = map[int]*sync.Mutex{}
)

func postGate(port int) *sync.Mutex {
	postGateMu.Lock()
	defer postGateMu.Unlock()
	g, ok := postGates[port]
	if !ok {
		g = &sync.Mutex{}
		postGates[port] = g
	}
	return g
}

// what identifies a voucher for the check
type vchKey struct {
	party  string   // the party ledger, folded ("" when the voucher names none)
	date   string   // yyyymmdd
	amount int64    // in paise: the party's line(s); -1 when the party has no line
	total  int64    // the voucher's total in paise (half the sum of every line); -1 unknown
	ids    []string // voucher number, reference, bill allocation names, folded
	tag    string   // TDSDesk:<id> in the narration
	ledger map[string]bool
	// the existing voucher in Tally (for the answer)
	guid, masterID, number, vtype, rawDate string
	optional, cancelled                    bool
}

func foldName(s string) string {
	return strings.ToUpper(strings.Join(strings.Fields(html.UnescapeString(s)), " "))
}

var reAmt = re(`-?\d[\d,]*(?:\.\d+)?`)

// an amount as Tally writes it ("-25535.00", "25,535.00") in paise, without its sign
func paise(s string) (int64, bool) {
	m := reAmt.FindString(strings.TrimSpace(s))
	if m == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(strings.ReplaceAll(m, ",", ""), 64)
	if err != nil {
		return 0, false
	}
	return int64(math.Round(math.Abs(f) * 100)), true
}

// a date as Tally gives it (20260701, 1-Jul-2026, 01-Jul-26) as yyyymmdd; "" when it cannot be read
func normDate(s string) string {
	s = strings.TrimSpace(s)
	if re(`^\d{8}$`).MatchString(s) {
		return s
	}
	for _, f := range []string{"2-Jan-2006", "02-Jan-2006", "2-Jan-06", "02-Jan-06", "2006-01-02", "02-01-2006"} {
		if t, err := time.Parse(f, s); err == nil {
			return t.Format("20060102")
		}
	}
	return ""
}

// a voucher (FinCom's XML or one Tally sent back) as its key
func keyOfVoucher(v *Node) vchKey {
	k := vchKey{party: foldName(nt(v, "PARTYLEDGERNAME")), date: normDate(nt(v, "DATE")), amount: -1, total: -1,
		tag: reTag.FindString(nt(v, "NARRATION")), guid: nt(v, "GUID"), masterID: nt(v, "MASTERID"), number: nt(v, "VOUCHERNUMBER"),
		vtype: voucherType(v), rawDate: nt(v, "DATE"), ledger: map[string]bool{}, optional: strings.EqualFold(nt(v, "ISOPTIONAL"), "Yes"), cancelled: strings.EqualFold(nt(v, "ISCANCELLED"), "Yes")}
	seen := map[string]bool{}
	addID := func(s string) {
		if f := foldName(s); f != "" && !seen[f] {
			seen[f] = true
			k.ids = append(k.ids, f)
		}
	}
	addID(nt(v, "VOUCHERNUMBER"))
	addID(nt(v, "REFERENCE"))
	var sum, partySum int64
	lines, partyLines := 0, 0
	for _, e := range v.Sel("ALLLEDGERENTRIES.LIST | LEDGERENTRIES.LIST") {
		for _, b := range e.Sel("BILLALLOCATIONS.LIST") {
			addID(nt(b, "NAME"))
		}
		k.ledger[foldName(nt(e, "LEDGERNAME"))] = true
		a, ok := paise(nt(e, "AMOUNT"))
		if !ok {
			continue
		}
		lines++
		sum += a
		if k.party != "" && foldName(nt(e, "LEDGERNAME")) == k.party {
			partyLines++
			partySum += a
		}
	}
	if lines > 0 {
		k.total = sum / 2
	}
	if partyLines > 0 {
		k.amount = partySum
	}
	return k
}

// the existing voucher e is the voucher p (about to be posted): same party, same date, same amount, same bill number
func sameVoucher(p, e vchKey) bool {
	if e.cancelled || p.date == "" || e.date != p.date {
		return false
	}
	// the party: Tally's party ledger, or (a voucher Tally keeps without one) one of its ledger lines
	if p.party != "" && e.party != p.party && (e.party != "" || !e.ledger[p.party]) {
		return false
	}
	if !sameAmount(p, e) {
		return false
	}
	// the bill: FinCom's own tag, or any of its numbers (voucher number, reference, bill allocation) among Tally's
	if p.tag != "" && e.tag == p.tag {
		return true
	}
	if len(p.ids) == 0 {
		// a voucher with no bill number (a bank entry): the same only when the one in Tally has none either (Tally's own
		// voucher numbering aside)
		for _, id := range e.ids {
			if id != foldName(e.number) {
				return false
			}
		}
		return true
	}
	for _, a := range p.ids {
		for _, b := range e.ids {
			if a == b {
				return true
			}
		}
	}
	return false
}

// the amount to the paisa: the party's line(s) on both sides; else the voucher's total. An amount Tally did not give is
// not taken as different (the check refuses rather than doubles)
func sameAmount(p, e vchKey) bool {
	if p.amount >= 0 && e.amount >= 0 {
		return p.amount == e.amount
	}
	if p.total >= 0 && e.total >= 0 {
		return p.total == e.total
	}
	return true
}

func dupCheckRequest(company, date, party string) string {
	filter, formula := "", ""
	if party != "" {
		filter = "<FILTERS>TDSDeskDupParty</FILTERS>"
		formula = `<SYSTEM TYPE="Formulae" NAME="TDSDeskDupParty">$PartyLedgerName = "` + esc(party) + `"</SYSTEM>`
	}
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>" + dupCheckID + "</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + date + "</SVFROMDATE><SVTODATE>" + date + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="` + dupCheckID + `" ISMODIFY="No"><TYPE>Voucher</TYPE>` + filter +
		"<FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ISOPTIONAL,ISCANCELLED,ALLLEDGERENTRIES.LIST</FETCH></COLLECTION>" +
		formula + "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

// an answer the check can trust: Tally's envelope, without an error line
func goodDupAnswer(raw string) bool {
	return re(`(?i)<ENVELOPE[\s>]`).MatchString(raw) && !re(`(?i)<LINEERROR>`).MatchString(raw)
}

// the vouchers in Tally on that date (for that party), as keys; an error when Tally did not answer properly
func vouchersOnDate(port int, company, date, party string) ([]vchKey, error) {
	// a name with a quote cannot be put in Tally's formula: that date is read whole, and the party matched here
	filterBy := html.UnescapeString(party)
	if strings.Contains(filterBy, `"`) {
		filterBy = ""
	}
	raw, err := invokeTally(fin, port, dupCheckRequest(company, date, filterBy), 0)
	if err == nil && !goodDupAnswer(raw) && filterBy != "" {
		// a Tally that did not take the party filter: the one date, unfiltered (one more small request)
		raw, err = invokeTally(fin, port, dupCheckRequest(company, date, ""), 0)
	}
	if err != nil {
		return nil, err
	}
	if !goodDupAnswer(raw) {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	var out []vchKey
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		out = append(out, keyOfVoucher(v))
	}
	return out, nil
}

func ddmmyyyy(d string) string {
	if len(d) == 8 {
		return d[6:8] + "-" + d[4:6] + "-" + d[0:4]
	}
	return d
}

// the check before one voucher is posted. nil: not in Tally, post it. Otherwise the voucher's result instead of
// posting: already (ok:false, already:true, with the existing voucher's GUID and number) or checkFailed (ok:false,
// checkFailed:true). Called with the posting's priority (fin): a background read gives way to it at once
func dupCheck(port int, company string, id any, x string) M {
	return dupCheckWith(port, company, id, x, nil)
}

// one read of a date (and party) for the check
type dupRead struct {
	there []vchKey
	err   error
}

// the same, sharing one read per date and party among the vouchers of one batch (cache: nil for none). Only for vouchers
// checked together before any of them is sent: the read is not used again after a posting
func dupCheckWith(port int, company string, id any, x string, cache map[string]dupRead) M {
	vs := xmlDoc(x).All("VOUCHER")
	if len(vs) == 0 {
		return nil
	}
	p := keyOfVoucher(vs[0])
	label := p.tag
	if label == "" {
		label = fmt.Sprint(id)
	}
	amt := p.amount
	if amt < 0 {
		amt = p.total
	}
	what := fmt.Sprintf("%s (%s, %s, %s, %.2f)", label, nt(vs[0], "PARTYLEDGERNAME"), strings.Join(p.ids, "/"), ddmmyyyy(p.date), float64(amt)/100)
	party := nt(vs[0], "PARTYLEDGERNAME")
	ck := p.date + "|" + foldName(party)
	rd, had := cache[ck]
	if !had {
		rd.there, rd.err = vouchersOnDate(port, company, p.date, party)
		if cache != nil {
			cache[ck] = rd
		}
	}
	there, err := rd.there, rd.err
	if err != nil {
		writeLog("  duplicate check " + what + ": NOT POSTED, could not check Tally: " + tallyTrouble(err.Error()))
		return M{"id": id, "kind": "voucher", "ok": false, "checkFailed": true, "company": company, "port": port, "message": dupCheckFailedMsg, "detail": tallyTrouble(err.Error())}
	}
	for _, e := range there {
		if !sameVoucher(p, e) {
			continue
		}
		d := e.date
		msg := "Already in Tally (voucher no. " + e.number + ", " + ddmmyyyy(d) + ")"
		if e.number == "" {
			msg = "Already in Tally (voucher without a number, " + ddmmyyyy(d) + ")"
		}
		writeLog("  duplicate check " + what + ": NOT POSTED, already in Tally as " + e.vtype + " no. " + e.number + " of " + ddmmyyyy(d) + " (GUID " + e.guid + ")")
		return M{"id": id, "kind": "voucher", "ok": false, "already": true, "company": company, "port": port, "message": msg,
			"guid": e.guid, "vchNo": e.number, "vchNumber": e.number, "vchType": e.vtype, "masterId": e.masterID, "vchDate": d, "optional": e.optional}
	}
	return nil
}
