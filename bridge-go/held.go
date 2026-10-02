// Balances worked out by the bridge from the copy it keeps (the openings it holds and its day files), for FinCom's
// /balances, /tb and /ledgerbalance: Tally is never asked for a balance (owner's rule, 02-Oct-2026). Also the
// request-only TDL builder the bridge's newer requests use (nothing is installed in Tally).
package main

import (
	"errors"
	"fmt"
	"html"
	"math"
	"path/filepath"
	"sort"
	"strings"
)

var reVchBlock = re(`<VOUCHER\b[\s\S]*?</VOUCHER>`)

// --- the requests (request-only TDL)
func fcCollection(id, company, statics, typ, fetch, filter string) string {
	sv := "<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"
	if company != "" {
		sv += "<SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY>"
	}
	flt, sys := "", ""
	if filter != "" {
		flt = "<FILTERS>" + id + "Only</FILTERS>"
		sys = `<SYSTEM TYPE="Formulae" NAME="` + id + `Only">` + esc(filter) + "</SYSTEM>"
	}
	return "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>" + id + "</ID></HEADER>" +
		"<BODY><DESC><STATICVARIABLES>" + sv + statics + "</STATICVARIABLES><TDL><TDLMESSAGE>" +
		`<COLLECTION NAME="` + id + `" ISMODIFY="No"><TYPE>` + typ + "</TYPE><FETCH>" + fetch + "</FETCH>" + flt + "</COLLECTION>" + sys +
		"</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>"
}

// the AlterID range of one request: (after, upto]; upto 0: no upper end
func alterRange(after, upto int64) string {
	f := fmt.Sprintf("$AlterID > %d", after)
	if upto > 0 {
		f += fmt.Sprintf(" AND $AlterID <= %d", upto)
	}
	return f
}

func cleanGUID(g string) string {
	return re(`[^\w\-.:]`).ReplaceAllString(strings.TrimSpace(html.UnescapeString(g)), "")
}

// an amount as Tally writes it ("-1,234.50", "1234.50 Dr"): a plain number, a debit negative as Tally's XML has it
func amtText(s string) string {
	t := strings.TrimSpace(s)
	if i := strings.LastIndex(t, "="); i >= 0 {
		t = t[i+1:]
	}
	neg := strings.Contains(t, "-") || strings.HasSuffix(strings.ToLower(t), "dr")
	t = re(`[^0-9.]`).ReplaceAllString(t, "")
	if t == "" {
		return "0"
	}
	v := num(t)
	if neg {
		v = -v
	}
	return fmt.Sprintf("%.2f", math.Round(v*100)/100)
}

// --- balances, worked out here from the copy (the opening the copy holds and its day files); Tally is never asked
type heldCopy struct {
	from, openAsOn string
	open, parent   map[string]float64
	par            map[string]string
	dir            string
}

func loadHeld(company string) (*heldCopy, error) {
	dir := syncFolder(company)
	st := readKeepState(dir)
	bal := readObjFile(filepath.Join(dir, "balances.json"))
	if st == nil || bal == nil || !isTallyDate(str(bal["openAsOn"])) || !isTallyDate(str(st["from"])) {
		return nil, errors.New("FinCom works balances out from its copy of the books (Reports, Look up); the bridge no longer asks Tally for a balance, and it does not keep the whole day book of " + company + " here")
	}
	h := &heldCopy{from: str(st["from"]), openAsOn: str(bal["openAsOn"]), open: map[string]float64{}, par: map[string]string{}, dir: dir}
	for _, x := range arr(bal["ledgers"]) {
		l := obj(x)
		h.open[str(l["name"])] += num(l["open"])
		h.par[str(l["name"])] = str(l["parent"])
	}
	return h, nil
}

// one ledger line of a voucher as FinCom counts it: the ledger lines, and the accounting allocations of items (an item
// invoice's sales or purchase ledger), wherever they sit in the voucher
type vLine struct{ ledger, amount, body string }

func voucherLines(v string) []vLine {
	var out []vLine
	for _, tag := range []string{"ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST", "ACCOUNTINGALLOCATIONS.LIST"} {
		parts := strings.Split(v, "<"+tag+">")
		for _, p := range parts[1:] {
			e := strings.Split(p, "</"+tag+">")[0]
			n := html.UnescapeString(strings.TrimSpace(group(`<LEDGERNAME>([^<]*)</LEDGERNAME>`, e, 1)))
			if n == "" {
				continue
			}
			out = append(out, vLine{n, group(`<AMOUNT>([^<]*)</AMOUNT>`, e, 1), e})
		}
	}
	return out
}

// each ledger's movement from a to b (inclusive), from the copy's day files, as FinCom counts it (not Optional, not
// cancelled; ledger lines, accounting allocations of items)
func (h *heldCopy) moves(a, b string) map[string]float64 {
	out := map[string]float64{}
	if a < h.from {
		a = h.from
	}
	for _, f := range dayFiles(h.dir, "") {
		d := strings.TrimSuffix(filepath.Base(f), ".xml")
		if d < a || d > b {
			continue
		}
		for _, v := range reVchBlock.FindAllString(readText(f), -1) {
			if strings.EqualFold(group(`<ISOPTIONAL>([^<]*)<`, v, 1), "Yes") || strings.EqualFold(group(`<ISCANCELLED>([^<]*)<`, v, 1), "Yes") {
				continue
			}
			for _, l := range voucherLines(v) {
				out[l.ledger] += num(amtText(l.amount))
			}
		}
	}
	return out
}

// every ledger's balance at the end of asOn (Tally's sign: a debit negative)
func (h *heldCopy) balanceOn(asOn string) (map[string]float64, error) {
	if asOn < h.openAsOn {
		return nil, fmt.Errorf("the copy here starts on %s; a balance on %s is worked out in FinCom", h.from, asOn)
	}
	out := map[string]float64{}
	for n, o := range h.open {
		out[n] = o
	}
	for n, m := range h.moves(h.from, asOn) {
		out[n] += m
	}
	return out, nil
}

func r2s(v float64) string {
	v = math.Round(v*100) / 100
	if v == 0 {
		return "0.00"
	}
	return fmt.Sprintf("%.2f", v)
}

// /balances (the answer as before: each ledger's opening, the day before from, and closing on to)
func heldBalances(company, from, to string, openOnly bool) (M, error) {
	if !isTallyDate(from) || !isTallyDate(to) {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	h, err := loadHeld(company)
	if err != nil {
		return nil, err
	}
	before := addDays(from, -1)
	o, err := h.balanceOn(before)
	if err != nil {
		return nil, err
	}
	c := map[string]float64{}
	if !openOnly {
		if c, err = h.balanceOn(to); err != nil {
			return nil, err
		}
	}
	var names []string
	for n := range o {
		names = append(names, n)
	}
	for n := range c {
		names = append(names, n)
	}
	list := []any{}
	for _, n := range uniqSorted(names) {
		cb := ""
		if !openOnly {
			cb = r2s(c[n])
		}
		list = append(list, M{"name": n, "parent": h.par[n], "open": r2s(o[n]), "close": cb})
	}
	return M{"ok": true, "company": company, "from": from, "to": to, "openAsOn": before, "openOnly": openOnly, "ledgers": list, "source": "copy"}, nil
}

// /tb: the ledgers with a balance on a date
func heldTB(company, asOn string) (M, error) {
	if !isTallyDate(asOn) {
		return nil, errors.New("The date is to be given as yyyymmdd.")
	}
	h, err := loadHeld(company)
	if err != nil {
		return nil, err
	}
	b, err := h.balanceOn(asOn)
	if err != nil {
		return nil, err
	}
	var names []string
	for n, v := range b {
		if math.Abs(v) >= 0.005 {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	list := []any{}
	for _, n := range names {
		list = append(list, []any{n, h.par[n], r2s(b[n])})
	}
	return M{"ok": true, "company": company, "asOn": asOn, "ledgers": list, "source": "copy"}, nil
}

// /ledgerbalance: one ledger's opening (the day before from) and closing (on to)
func heldLedgerBalance(company, ledger, from, to string, closeOnly bool) (M, error) {
	if !isTallyDate(from) || !isTallyDate(to) {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	h, err := loadHeld(company)
	if err != nil {
		return nil, err
	}
	before := addDays(from, -1)
	end := to
	if td := today(); end > td {
		end = td // nothing is held after today
	}
	c, err := h.balanceOn(end)
	if err != nil {
		return nil, err
	}
	if _, ok := c[ledger]; !ok {
		if _, ok := h.par[ledger]; !ok {
			return nil, errors.New("Ledger " + ledger + " was not found in " + company + ".")
		}
	}
	o := ""
	if !closeOnly {
		ob, err := h.balanceOn(before)
		if err != nil {
			return nil, err
		}
		o = r2s(ob[ledger])
	}
	return M{"ok": true, "ledger": ledger, "openAsOn": before, "open": o, "close": r2s(c[ledger]), "source": "copy"}, nil
}

// one ledger's vouchers for a period, from the copy kept here (its day files), with every ledger line; an error saying
// so when the copy does not cover the period (FinCom then shows them from its own copy). Tally is not asked
func heldLedgerVouchers(company, ledger, from, to string) ([]M, error) {
	if !isTallyDate(from) || !isTallyDate(to) {
		return nil, errors.New("Dates are to be given as yyyymmdd.")
	}
	dir := syncFolder(company)
	st := readKeepState(dir)
	start := str(st["from"])
	if st == nil || !isTallyDate(start) {
		return nil, errors.New("A ledger's entries are shown from FinCom's copy of the books; the bridge does not ask Tally for them, and it keeps no copy of " + company + " here")
	}
	if from < start {
		return nil, errors.New("A ledger's entries before " + start + " are shown from FinCom's copy of the books; the copy here starts on " + start + ", and the bridge does not ask Tally for them")
	}
	want := foldName(ledger)
	list := []M{}
	for _, f := range dayFiles(dir, "") {
		d := strings.TrimSuffix(filepath.Base(f), ".xml")
		if d < from || d > to {
			continue
		}
		for _, vx := range reVchBlock.FindAllString(readText(f), -1) {
			entries := []any{}
			touches := false
			for _, l := range voucherLines(vx) {
				if foldName(l.ledger) == want {
					touches = true
				}
				bills := []any{}
				for _, m := range re(`<BILLALLOCATIONS\.LIST>[\s\S]*?<NAME>([^<]*)</NAME>`).FindAllStringSubmatch(l.body, -1) {
					if bn := html.UnescapeString(strings.TrimSpace(m[1])); bn != "" {
						bills = append(bills, bn)
					}
				}
				entries = append(entries, M{"ledger": l.ledger, "amount": strings.TrimSpace(l.amount), "instrument": strings.TrimSpace(group(`<INSTRUMENTNUMBER>([^<]*)</INSTRUMENTNUMBER>`, l.body, 1)), "bills": bills})
			}
			if !touches {
				continue
			}
			v := xmlDoc(vx).One("VOUCHER")
			vd := nt(v, "DATE")
			if vd == "" {
				vd = d
			}
			list = append(list, M{"guid": nt(v, "GUID"), "masterId": nt(v, "MASTERID"), "alter": nt(v, "ALTERID"), "date": vd, "type": voucherType(v), "number": nt(v, "VOUCHERNUMBER"), "reference": nt(v, "REFERENCE"),
				"party": nt(v, "PARTYLEDGERNAME"), "narration": nt(v, "NARRATION"), "optional": nt(v, "ISOPTIONAL"), "cancelled": nt(v, "ISCANCELLED"), "entries": entries})
		}
	}
	return list, nil
}
