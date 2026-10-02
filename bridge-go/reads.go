// Reading from Tally for FinCom: ledgers, entries, the day book, balances. The same requests as bridge 1.15.0, and the
// same answers.
package main

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

func getLedgers(company string, pref int) (M, error) {
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	fetch := "NAME,PARENT,INCOMETAXNUMBER,PARTYGSTIN,GSTREGISTRATIONTYPE,LEDSTATENAME,ISBILLWISEON,GUID,ALTERID,LEDGSTREGDETAILS.LIST,PAYMENTDETAILS.LIST,TAXTYPE,GSTDUTYHEAD,RATEOFTAXCALCULATION,TDSNATUREOFPAYMENT,NATUREOFPAYMENT,TDSDEDUCTEETYPE,TDSAPPLICABLE,EMAIL,LEDGERPHONE,LEDGERMOBILE,ADDRESS.LIST,LEDMAILINGDETAILS.LIST"
	raw, err := invokeTally(fin, port, collectionRequest("TDSDeskLedgers", "Ledger", fetch, company, ""), 0)
	if err != nil {
		return nil, err
	}
	ledgers := []any{}
	for _, l := range xmlDoc(raw).All("LEDGER") {
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
	graw, err := invokeTally(fin, port, collectionRequest("TDSDeskGroups", "Group", "NAME,PARENT,GUID", company, ""), 0)
	if err != nil {
		return nil, err
	}
	groups := []any{}
	for _, g := range xmlDoc(graw).All("GROUP") {
		if n := nameOf(g); n != "" {
			groups = append(groups, M{"name": n, "parent": nt(g, "PARENT")})
		}
	}
	return M{"ok": true, "company": company, "port": port, "ledgers": ledgers, "groups": groups}, nil
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

// one ledger's vouchers, filtered by Tally itself (the Ledger Vouchers report)
func getLedgerVouchers(company, ledger, from, to string, pin int) (M, error) {
	port, err := findCompanyPort(company, pin)
	if err != nil {
		return nil, err
	}
	x := "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Ledger Vouchers</REPORTNAME>" +
		"<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE><LEDGERNAME>" + esc(ledger) + "</LEDGERNAME>" +
		"</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>"
	raw, err := invokeTally(fin, port, x, 0)
	if err != nil {
		return nil, err
	}
	rows := []any{}
	var cur M
	for _, n := range xmlDoc(raw).All("*") {
		t := strings.TrimSpace(n.InnerText())
		switch n.Name {
		case "DSPVCHDATE":
			if cur != nil {
				rows = append(rows, cur)
			}
			cur = M{"date": t, "other": "", "type": "", "dr": "", "cr": ""}
		case "DSPVCHLEDACCOUNT":
			if cur != nil && cur["other"] == "" {
				cur["other"] = t
			}
		case "DSPVCHTYPE":
			if cur != nil {
				cur["type"] = t
			}
		case "DSPVCHDRAMT":
			if cur != nil {
				cur["dr"] = t
			}
		case "DSPVCHCRAMT":
			if cur != nil {
				cur["cr"] = t
			}
		}
	}
	if cur != nil {
		rows = append(rows, cur)
	}
	return M{"ok": true, "company": company, "port": port, "ledger": ledger, "count": len(rows), "rows": rows}, nil
}

// the vouchers of a period, heads only (Optional ones too)
func voucherHeads(tc *TC, port int, company, from, to string) ([]M, error) {
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskVchHeads</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskVchHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ALTERID,ISOPTIONAL,ISCANCELLED</FETCH></COLLECTION>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 0)
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
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	to := time.Now()
	f, t := tallyDate(to.AddDate(0, 0, -90)), tallyDate(to)
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
	probe("Day Book, last 90 days", func() ([]M, error) { return dayBookHeads(fin, port, company, f, t) })
	probe("Voucher list, last 90 days (includes Optional)", func() ([]M, error) { return voucherHeads(fin, port, company, f, t) })
	return M{"ok": true, "company": company, "port": port, "from": f, "to": t, "tests": tests}, nil
}

// the vouchers of one ledger for a period, with every ledger line; nil when this Tally will not give them this way
func ledgerVoucherList(tc *TC, port int, company, ledger, from, to string) ([]M, error) {
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskLedVch</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + from + "</SVFROMDATE><SVTODATE>" + to + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskLedVch" ISMODIFY="No"><TYPE>Vouchers : Ledger</TYPE><CHILDOF>` + esc(ledger) + "</CHILDOF>" +
		"<FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,REFERENCE,PARTYLEDGERNAME,NARRATION,MASTERID,GUID,ALTERID,ISOPTIONAL,ISCANCELLED,ALLLEDGERENTRIES.LIST</FETCH></COLLECTION>" +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(tc, port, x, 0)
	if err != nil {
		return nil, err
	}
	if re(`<LINEERROR>|Could not find|Unknown Request`).MatchString(raw) {
		return nil, nil
	}
	list := []M{}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		d := nt(v, "DATE")
		if d != "" && (d < from || d > to) {
			continue
		}
		entries := []any{}
		for _, e := range v.Sel("ALLLEDGERENTRIES.LIST | LEDGERENTRIES.LIST") {
			bills := []any{}
			for _, b := range e.Sel("BILLALLOCATIONS.LIST") {
				if bn := nt(b, "NAME"); bn != "" {
					bills = append(bills, bn)
				}
			}
			entries = append(entries, M{"ledger": nt(e, "LEDGERNAME"), "amount": nt(e, "AMOUNT"), "instrument": nt(e.One("BANKALLOCATIONS.LIST"), "INSTRUMENTNUMBER"), "bills": bills})
		}
		list = append(list, M{"guid": nt(v, "GUID"), "masterId": nt(v, "MASTERID"), "alter": nt(v, "ALTERID"), "date": d, "type": voucherType(v), "number": nt(v, "VOUCHERNUMBER"), "reference": nt(v, "REFERENCE"),
			"party": nt(v, "PARTYLEDGERNAME"), "narration": nt(v, "NARRATION"), "optional": nt(v, "ISOPTIONAL"), "cancelled": nt(v, "ISCANCELLED"), "entries": entries})
	}
	return list, nil
}

// one ledger's balance as on a date (Tally: a debit balance is negative); "", false when not found this way
func oneLedgerBalance(port int, company, ledger, asOn string) (string, bool, error) {
	f := strings.ReplaceAll(ledger, `"`, "")
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskOneLed</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + asOn + "</SVFROMDATE><SVTODATE>" + asOn + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskOneLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FILTERS>TDSDeskThisLed</FILTERS><FETCH>NAME,CLOSINGBALANCE</FETCH></COLLECTION>` +
		`<SYSTEM TYPE="Formulae" NAME="TDSDeskThisLed">$Name = "` + esc(f) + `"</SYSTEM>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	raw, err := invokeTally(fin, port, x, 0)
	if err != nil {
		return "", false, err
	}
	for _, l := range xmlDoc(raw).All("LEDGER") {
		if nameOf(l) == ledger {
			return nt(l, "CLOSINGBALANCE"), true, nil
		}
	}
	return "", false, nil
}

// every ledger's name and group, and every group's parent: no balances, so Tally answers at once
func getLedgerNames(tc *TC, company string, pref int) (M, error) {
	port, err := readerPort(tc, company, pref)
	if err != nil {
		return nil, err
	}
	raw, err := invokeTally(tc, port, collectionRequest("TDSDeskNames", "Ledger", "NAME,PARENT", company, ""), 0)
	if err != nil {
		return nil, err
	}
	led := []any{}
	for _, l := range xmlDoc(raw).All("LEDGER") {
		if n := nameOf(l); n != "" {
			led = append(led, []any{n, nt(l, "PARENT")})
		}
	}
	graw, err := invokeTally(tc, port, collectionRequest("TDSDeskGroupNames", "Group", "NAME,PARENT", company, ""), 0)
	if err != nil {
		return nil, err
	}
	grp := []any{}
	for _, g := range xmlDoc(graw).All("GROUP") {
		if n := nameOf(g); n != "" {
			grp = append(grp, []any{n, nt(g, "PARENT")})
		}
	}
	return M{"ok": true, "company": company, "port": port, "ledgers": led, "groups": grp}, nil
}

// the trial balance on one date: one read, only ledgers with a balance
func getTrialBalance(company, asOn string, pref int) (M, error) {
	if !isTallyDate(asOn) {
		return nil, errors.New("The date is to be given as yyyymmdd.")
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskTB</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
		"<SVFROMDATE>" + asOn + "</SVFROMDATE><SVTODATE>" + asOn + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="TDSDeskTB" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH><FILTERS>TDSDeskHasBal</FILTERS></COLLECTION>` +
		`<SYSTEM TYPE="Formulae" NAME="TDSDeskHasBal">NOT $$IsEmpty:$ClosingBalance</SYSTEM>` +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
	t0 := time.Now()
	raw, err := invokeTally(fin, port, x, 0)
	if err != nil {
		return nil, err
	}
	list := []any{}
	for _, l := range xmlDoc(raw).All("LEDGER") {
		n, b := nameOf(l), nt(l, "CLOSINGBALANCE")
		if n != "" && b != "" {
			list = append(list, []any{n, nt(l, "PARENT"), b})
		}
	}
	ms := int(time.Since(t0).Milliseconds())
	writeLog(fmt.Sprintf("Trial balance of %s on %s: %d ledgers in %d ms", company, asOn, len(list), ms))
	return M{"ok": true, "company": company, "port": port, "asOn": asOn, "ms": ms, "ledgers": list}, nil
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
	if company == "" {
		return "", errors.New("Say which company.")
	}
	if !isTallyDate(from) || !isTallyDate(to) {
		return "", errors.New("Dates are to be given as yyyymmdd.")
	}
	if from > to {
		return "", errors.New("The period ends before it starts.")
	}
	if fromTallyDate(to).Sub(fromTallyDate(from)).Hours()/24 > 92 {
		return "", errors.New("Ask for three months at most at a time, so Tally is not held up.")
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

// every ledger's balance as Tally works it out: at the end of the day before the period, and at its end
func getBalances(company, from, to string, pref int, openOnly bool) (M, error) {
	if !isTallyDate(from) || !isTallyDate(to) {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	port, err := findCompanyPort(company, pref)
	if err != nil {
		return nil, err
	}
	before := addDays(from, -1)
	read := func(asOn string) (map[string][2]string, error) {
		x := "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>TDSDeskBalances</ID></HEADER>" +
			"<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>" +
			"<SVFROMDATE>" + asOn + "</SVFROMDATE><SVTODATE>" + asOn + "</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE>" +
			`<COLLECTION NAME="TDSDeskBalances" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME,PARENT,CLOSINGBALANCE</FETCH></COLLECTION>` +
			"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
		raw, err := invokeTally(fin, port, x, 0)
		if err != nil {
			return nil, err
		}
		h := map[string][2]string{}
		for _, l := range xmlDoc(raw).All("LEDGER") {
			if n := nameOf(l); n != "" {
				h[n] = [2]string{nt(l, "PARENT"), nt(l, "CLOSINGBALANCE")}
			}
		}
		return h, nil
	}
	open, err := read(before)
	if err != nil {
		return nil, err
	}
	close := map[string][2]string{}
	if !openOnly {
		if close, err = read(to); err != nil {
			return nil, err
		}
	}
	var names []string
	for n := range open {
		names = append(names, n)
	}
	for n := range close {
		names = append(names, n)
	}
	list := []any{}
	for _, n := range uniqSorted(names) {
		o, ho := open[n]
		c, hc := close[n]
		parent := o[0]
		if hc {
			parent = c[0]
		}
		ob, cb := "", ""
		if ho {
			ob = o[1]
		}
		if hc {
			cb = c[1]
		}
		list = append(list, M{"name": n, "parent": parent, "open": ob, "close": cb})
	}
	return M{"ok": true, "company": company, "port": port, "from": from, "to": to, "openAsOn": before, "openOnly": openOnly, "ledgers": list}, nil
}
