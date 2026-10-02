// Reading from Tally for FinCom: ledgers, entries, the day book. 2.1.5: never a balance. Tally's balance reports (a
// ledger's closing on a date, the trial balance, every ledger's balance, the Ledger Vouchers report with its running
// balance) are gone: /balances, /tb and /ledgerbalance are answered from the copy kept here (changes.go), and FinCom
// works every other balance out in its cloud.
package main

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

func ledgersFullRequest(company string, after, upto int64) string {
	fetch := "NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,RATEOFTAXCALCULATION,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE,EMAIL,LEDGERPHONE,LEDGERMOBILE,ADDRESS.LIST,LEDMAILINGDETAILS.LIST"
	return fcCollection("TDSDeskLedgers", company, "", "Ledger", fetch, masterRange(after, upto))
}
func groupsFullRequest(company string) string {
	return collectionRequest("TDSDeskGroups", "Group", "NAME,PARENT,GUID", company, "")
}

func getLedgers(company string, pref int) (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	nodes, err := ledgerChunks(fin, company, port, ledgersFullRequest)
	if err != nil {
		return nil, err
	}
	ledgers := []any{}
	for _, l := range nodes {
		name := nameOf(l)
		if name == "" {
			continue
		}
		gstin := nt(l, "PARTYGSTIN")
		if gstin == "" {
			gstin = nt(l, "LEDGSTREGDETAILS.LIST/GSTIN")
		}
		addr := []any{}
		for _, a := range l.Sel("ADDRESS.LIST/ADDRESS") {
			if t := strings.TrimSpace(a.InnerText()); t != "" {
				addr = append(addr, t)
			}
		}
		if len(addr) == 0 {
			for _, a := range l.Sel("LEDMAILINGDETAILS.LIST/ADDRESS.LIST/ADDRESS") {
				if t := strings.TrimSpace(a.InnerText()); t != "" {
					addr = append(addr, t)
				}
			}
		}
		nature := nt(l, "TDSNATUREOFPAYMENT")
		if nature == "" {
			nature = nt(l, "NATUREOFPAYMENT")
		}
		ledgers = append(ledgers, M{"name": name, "group": nt(l, "PARENT"), "pan": nt(l, "INCOMETAXNUMBER"), "gstin": gstin,
			"email": nt(l, "EMAIL"), "phone": nt(l, "LEDGERPHONE"), "mobile": nt(l, "LEDGERMOBILE"), "address": addr,
			"billwise": nt(l, "ISBILLWISEON"), "guid": nt(l, "GUID"), "alterId": nt(l, "ALTERID"),
			"acNo": nt(l, "PAYMENTDETAILS.LIST/ACCOUNTNUMBER"), "ifsc": nt(l, "PAYMENTDETAILS.LIST/IFSCODE"),
			"taxType": nt(l, "TAXTYPE"), "dutyHead": nt(l, "GSTDUTYHEAD"), "tdsNature": nature, "rate": nt(l, "RATEOFTAXCALCULATION")})
	}
	graw, err := invokeTally(fin, port, groupsFullRequest(company), 0)
	if err != nil {
		return nil, err
	}
	groups := []any{}
	for _, g := range xmlDoc(graw).All("GROUP") {
		if n := nameOf(g); n != "" {
			groups = append(groups, M{"name": n, "parent": nt(g, "PARENT")})
		}
	}
	return M{"ok": true, "company": company, "port": port, "ledgers": ledgers, "groups": groups, "skipped": skippedLedgers(company)}, nil
}

func voucherType(v *Node) string {
	if t := nt(v, "VOUCHERTYPENAME"); t != "" {
		return t
	}
	return v.A("VCHTYPE")
}

func dayBookRequest(company, from, to string) string {
	return "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>" +
		"<STATICVARIABLES><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY><SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE>" +
		"<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>"
}

// vouchers from the Day Book, a month at a time; optionally only those touching one ledger
func getVouchers(company, from, to, ledger, types string, pref int) (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	if !isTallyDate(from) || !isTallyDate(to) {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	var typeList []string
	for _, t := range strings.Split(types, ",") {
		if t = strings.TrimSpace(t); t != "" {
			typeList = append(typeList, t)
		}
	}
	out := []any{}
	end := fromTallyDate(to)
	for cur := fromTallyDate(from); !cur.After(end); {
		ce := cur.AddDate(0, 1, -1)
		if ce.After(end) {
			ce = end
		}
		raw, err := invokeTally(fin, port, dayBookRequest(company, tallyDate(cur), tallyDate(ce)), 0)
		if err != nil {
			return nil, err
		}
		known := map[string]bool{}
		for _, v := range xmlDoc(raw).All("VOUCHER") {
			typ := voucherType(v)
			if len(typeList) > 0 && !contains(typeList, typ) {
				continue
			}
			entries := []any{}
			touches := ledger == ""
			for _, e := range v.Sel("ALLLEDGERENTRIES.LIST | LEDGERENTRIES.LIST") {
				ln := nt(e, "LEDGERNAME")
				if ledger != "" && ln == ledger {
					touches = true
				}
				bank := e.One("BANKALLOCATIONS.LIST")
				bills := []any{}
				for _, b := range e.Sel("BILLALLOCATIONS.LIST") {
					bills = append(bills, M{"name": nt(b, "NAME"), "type": nt(b, "BILLTYPE"), "amount": nt(b, "AMOUNT")})
				}
				entries = append(entries, M{"ledger": ln, "amount": nt(e, "AMOUNT"), "deemedPositive": nt(e, "ISDEEMEDPOSITIVE"),
					"bankDate": nt(bank, "BANKERSDATE"), "instrument": nt(bank, "INSTRUMENTNUMBER"), "txType": nt(bank, "TRANSACTIONTYPE"), "bills": bills})
			}
			if !touches {
				continue
			}
			g := nt(v, "GUID")
			out = append(out, M{"guid": g, "masterId": nt(v, "MASTERID"), "date": nt(v, "DATE"), "type": typ,
				"number": nt(v, "VOUCHERNUMBER"), "reference": nt(v, "REFERENCE"), "party": nt(v, "PARTYLEDGERNAME"),
				"narration": nt(v, "NARRATION"), "optional": nt(v, "ISOPTIONAL"), "cancelled": nt(v, "ISCANCELLED"), "entries": entries})
		}
		for _, x := range out {
			if g := str(x.(M)["guid"]); g != "" {
				known[g] = true
			}
		}
		// Optional entries do not show in the Day Book: the voucher list adds them
		if heads, err := voucherHeads(fin, port, company, tallyDate(cur), tallyDate(ce)); err == nil {
			for _, h := range heads {
				if g := str(h["guid"]); g != "" && known[g] {
					continue
				}
				if len(typeList) > 0 && !contains(typeList, str(h["type"])) {
					continue
				}
				if !strings.EqualFold(str(h["optional"]), "yes") {
					continue
				}
				out = append(out, h)
			}
		}
		cur = ce.AddDate(0, 0, 1)
	}
	return M{"ok": true, "company": company, "port": port, "count": len(out), "vouchers": out}, nil
}

// the vouchers of a period, heads only (Optional ones too)
func vchHeadsRequest(company, from, to string) string {
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskVchHeads</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskVchHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ALTERID,ISOPTIONAL,ISCANCELLED</FETCH></COLLECTION>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

func voucherHeads(tc *TC, port int, company, from, to string) ([]M, error) {
	if err := withinMonth(from, to); err != nil {
		return nil, err
	}
	raw, err := invokeTally(tc, port, vchHeadsRequest(company, from, to), 0)
	if err != nil {
		return nil, err
	}
	list := []M{}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		d := nt(v, "DATE")
		if d != "" && (d < from || d > to) {
			continue
		}
		list = append(list, M{"guid": nt(v, "GUID"), "masterId": nt(v, "MASTERID"), "alter": nt(v, "ALTERID"), "date": d, "type": voucherType(v), "number": nt(v, "VOUCHERNUMBER"),
			"reference": nt(v, "REFERENCE"), "party": nt(v, "PARTYLEDGERNAME"), "narration": nt(v, "NARRATION"),
			"optional": nt(v, "ISOPTIONAL"), "cancelled": nt(v, "ISCANCELLED"), "entries": []any{}})
	}
	return list, nil
}

// the Day Book report for a date range (regular vouchers only), as voucher heads
func dayBookHeads(tc *TC, port int, company, from, to string) ([]M, error) {
	if err := withinMonth(from, to); err != nil {
		return nil, err
	}
	raw, err := invokeTally(tc, port, dayBookRequest(company, from, to), 0)
	if err != nil {
		return nil, err
	}
	list := []M{}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		list = append(list, M{"guid": nt(v, "GUID"), "masterId": nt(v, "MASTERID"), "alter": nt(v, "ALTERID"), "date": nt(v, "DATE"), "type": voucherType(v), "number": nt(v, "VOUCHERNUMBER"),
			"reference": nt(v, "REFERENCE"), "party": nt(v, "PARTYLEDGERNAME"), "narration": nt(v, "NARRATION"), "optional": nt(v, "ISOPTIONAL")})
	}
	return list, nil
}

// what reading works on this Tally (nothing is written)
func readTest(company string, pref int) (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	to := time.Now()
	f, t := tallyDate(to.AddDate(0, 0, -30)), tallyDate(to)
	tests := []any{}
	probe := func(name string, run func() ([]M, error)) {
		t0 := time.Now()
		r, err := run()
		if err != nil {
			tests = append(tests, M{"name": name, "ok": false, "error": err.Error(), "ms": time.Since(t0).Milliseconds()})
			return
		}
		opt := 0
		for _, x := range r {
			if strings.EqualFold(str(x["optional"]), "yes") {
				opt++
			}
		}
		tests = append(tests, M{"name": name, "ok": true, "count": len(r), "ms": time.Since(t0).Milliseconds(), "optional": opt})
	}
	probe("Ledgers", func() ([]M, error) {
		l, err := getLedgers(company, port)
		if err != nil {
			return nil, err
		}
		var o []M
		for _, x := range arr(l["ledgers"]) {
			o = append(o, obj(x))
		}
		return o, nil
	})
	probe("Day Book, last 30 days", func() ([]M, error) { return dayBookHeads(fin, port, company, f, t) })
	probe("Voucher list, last 30 days (includes Optional)", func() ([]M, error) { return voucherHeads(fin, port, company, f, t) })
	return M{"ok": true, "company": company, "port": port, "from": f, "to": t, "tests": tests}, nil
}

func namesRequest(company string, after, upto int64) string {
	return fcCollection("TDSDeskNames", company, "", "Ledger", "NAME,PARENT", masterRange(after, upto))
}

// the MasterID range of a ledger request, (after, upto] (upto 0: no upper end)
func masterRange(after, upto int64) string {
	f := fmt.Sprintf("$MasterID > %d", after)
	if upto > 0 {
		f += fmt.Sprintf(" AND $MasterID <= %d", upto)
	}
	return f
}

// every ledger, read 2,000 MasterIDs a request (LedgerChunk) so no request holds Tally for long on a company with
// 50,000 ledgers: up to the company's highest master AlterID (its company check); the chunk that reaches it has no upper
// end, so whatever is past it comes too. A ledger seen twice (a Tally that ignores the range) counts once
func ledgerChunks(tc *TC, company string, port int, build func(string, int64, int64) string) ([]*Node, error) {
	bound := companyAlterM(company)
	if bound <= 0 {
		if _, err := companyCheck(tc, company, port); err != nil {
			return nil, err
		}
		bound = companyAlterM(company)
	}
	// a ledger found to hang Tally (ledgers.go) is never asked for: the chunks stop short of it
	st := keepStateOf(company)
	size := int64(ledChunkDefault())
	var out []*Node
	seen := map[string]bool{}
	for after := int64(0); ; {
		upto := after + size
		last := upto >= bound // the last chunk takes whatever is past the bound too
		if last {
			upto = 0
		}
		if p := nextPoison(st, after); p > 0 && (upto == 0 || p <= upto) {
			if p == after+1 {
				after = p
				continue
			}
			upto, last = p-1, false
		}
		raw, err := invokeTally(tc, port, build(company, after, upto), 0)
		if err != nil {
			return nil, err
		}
		for _, l := range xmlDoc(raw).All("LEDGER") {
			k := nameOf(l)
			if k == "" || seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, l)
		}
		if last {
			return out, nil
		}
		after = upto
	}
}

// the ledgers skipped because they hang Tally, for FinCom's answer: [[MasterID, name, why]]
func skippedLedgers(company string) []any {
	sk := arr(keepStateOf(company)["ledPoison"])
	if sk == nil {
		return []any{}
	}
	return sk
}
func groupNamesRequest(company string) string {
	return collectionRequest("TDSDeskGroupNames", "Group", "NAME,PARENT", company, "")
}

// every ledger's name and group, and every group's parent: no balances, so Tally answers at once
func getLedgerNames(tc *TC, company string, pref int) (M, error) {
	if err := readsAllowed(); err != nil {
		return nil, err
	}
	port, err := readerPort(tc, company, pref)
	if err != nil {
		return nil, err
	}
	nodes, err := ledgerChunks(tc, company, port, namesRequest)
	if err != nil {
		return nil, err
	}
	led := []any{}
	for _, l := range nodes {
		if n := nameOf(l); n != "" {
			led = append(led, []any{n, nt(l, "PARENT")})
		}
	}
	graw, err := invokeTally(tc, port, groupNamesRequest(company), 0)
	if err != nil {
		return nil, err
	}
	grp := []any{}
	for _, g := range xmlDoc(graw).All("GROUP") {
		if n := nameOf(g); n != "" {
			grp = append(grp, []any{n, nt(g, "PARENT")})
		}
	}
	return M{"ok": true, "company": company, "port": port, "ledgers": led, "groups": grp, "skipped": skippedLedgers(company)}, nil
}

// the port to read from: a background read uses the Tally its run found at its start (it asks no company list of its
// own: that would be a request of FinCom's, not given way); FinCom's reads find the company now
func readerPort(tc *TC, company string, pref int) (int, error) {
	if tc.copier && pref > 0 {
		return pref, nil
	}
	return findCompanyPort(company, pref)
}

// the Day Book of one company for a period, as Tally exports it (every voucher, every line, bill-wise details)
func getDayBookXML(tc *TC, company, from, to string, pref int) (string, error) {
	if err := readsAllowed(); err != nil {
		return "", err
	}
	if company == "" {
		return "", errors.New("Say which company.")
	}
	if !isTallyDate(from) || !isTallyDate(to) {
		return "", errors.New("Dates are to be given as yyyymmdd.")
	}
	if from > to {
		return "", errors.New("The period ends before it starts.")
	}
	if err := withinMonth(from, to); err != nil {
		return "", err
	}
	port, err := readerPort(tc, company, pref)
	if err != nil {
		return "", err
	}
	t := maxI(toInt(cfg("TallyTimeoutSec")), 900)
	if tc.readSec > 0 {
		t = tc.readSec
	}
	raw, err := invokeTally(tc, port, dayBookRequest(company, from, to), t)
	if err != nil {
		return "", err
	}
	return cleanXML(raw), nil
}

// one ledger's entries (FinCom's /ledgervouchers): 2.1.5 from the copy kept here (held.go), in the rows the Ledger
// Vouchers report gave: date, the other ledger, type, Dr, Cr. Tally is never asked: its per-ledger voucher list ("Vouchers
// : Ledger") is built ledger by ledger, the shape of read that hung Tally on 02-Oct-2026
func getLedgerVouchers(company, ledger, from, to string, pin int) (M, error) {
	lv, err := heldLedgerVouchers(company, ledger, from, to)
	if err != nil {
		return nil, err
	}
	rows := []any{}
	for _, v := range lv {
		if strings.EqualFold(str(v["cancelled"]), "yes") || strings.EqualFold(str(v["optional"]), "yes") {
			continue
		}
		a, other := 0.0, ""
		for _, e := range arr(v["entries"]) {
			m := obj(e)
			if str(m["ledger"]) == ledger {
				a += num(amtText(str(m["amount"])))
			} else if other == "" {
				other = str(m["ledger"])
			}
		}
		dr, cr := "", ""
		if a < 0 {
			dr = r2s(-a)
		} else if a > 0 {
			cr = r2s(a)
		}
		rows = append(rows, M{"date": str(v["date"]), "other": other, "type": str(v["type"]), "dr": dr, "cr": cr})
	}
	return M{"ok": true, "company": company, "ledger": ledger, "count": len(rows), "rows": rows, "source": "copy"}, nil
}

// one ledger's vouchers for a period (FinCom's /ledgerlines): from the copy kept here; when the copy does not cover the
// period, the Day Book a month at a time (never Tally's per-ledger list)
func getLedgerLines(co, ledger, from, to string, pin int) (M, error) {
	if lv, err := heldLedgerVouchers(co, ledger, from, to); err == nil {
		a := make([]any, len(lv))
		for i, x := range lv {
			a[i] = x
		}
		return M{"ok": true, "via": "copy", "vouchers": a}, nil
	}
	port, err := findCompanyPort(co, pin)
	if err != nil {
		return nil, err
	}
	r0, err := getVouchers(co, from, to, ledger, "", port)
	if err != nil {
		return nil, err
	}
	r0["via"] = "daybook"
	return r0, nil
}

// no request asks Tally for more than a month of entries (31 days from the first to the last), so none holds it long
func withinMonth(from, to string) error {
	if !isTallyDate(from) || !isTallyDate(to) {
		return errors.New("Dates are to be given as yyyymmdd.")
	}
	if fromTallyDate(to).Sub(fromTallyDate(from)).Hours()/24 > 31 {
		return errors.New("Ask for one month at most at a time, so Tally is not held up.")
	}
	return nil
}
