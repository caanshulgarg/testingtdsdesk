// FinCom Bridge 2.1.5, the owner's rule (02-Oct-2026): read each Tally company's baseline once, then only what changed;
// never ask Tally for a balance. Every balance (a ledger's, a group's, the trial balance, what customers owe) is worked
// out in FinCom's cloud from the openings and the entries it holds, or here from the copy the bridge keeps.
//
//   - Baseline, once per company: the masters with the opening Tally's ledger master stores (OPENINGBALANCE: a stored
//     value, never a balance Tally works out), and the day book from the day the books begin in Tally, a month a request
//     (smaller after a request that did not answer), each slice saved as it comes so a failure resumes from the last one.
//     Where FinCom's cloud already holds the books (the day book and masters exported from Tally and given to FinCom),
//     that is the baseline and Tally is not read for it.
//   - Then only changes, by Tally's change number (AlterID): masters and entries with an AlterID above the last one held,
//     in requests of about 200 (an AlterID range), each saved, going on to Tally's own last number. The last AlterIDs are
//     kept in the cloud (tally_books.sync, migration-32) as well as here.
//   - A deleted entry leaves no change number: per day, the entries' ids and count (no amounts) are compared with the
//     cloud's, a month a request, on Update now and at night, for this year and the last; only a day that differs is read
//     again.
//   - At night only, if switched on (NightlyTotals, off by default): Tally's primary-group totals, one request, against the
//     cloud's. Tally works these out from every ledger (the whole profit and loss too), which is what held NWS144's Tally
//     for 15 minutes on 02-Oct-2026, so it stays off unless the owner turns it on for a company where it is quick.
//
// Request-only TDL: every collection is defined inside the request; nothing is installed in Tally.
package main

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

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

const fcVchFetch = "GUID, MasterID, AlterID, Date, VoucherTypeName, VoucherNumber, PartyLedgerName, PartyName, Narration, Reference, ReferenceDate, IsCancelled, IsOptional, " +
	"PartyGSTIN, PlaceOfSupply, CmpGSTIN, ALLLEDGERENTRIES.LIST, LEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST"

// the entries changed in an AlterID range, with their lines. The period is the whole copy (and a year ahead), so a change
// to an entry of any date is seen
func changedVouchersRequest(company, from, to string, after, upto int64) string {
	return fcCollection("FinComChanged", company, "<SVFROMDATE>"+from+"</SVFROMDATE><SVTODATE>"+to+"</SVTODATE>", "Voucher", fcVchFetch, alterRange(after, upto))
}

// masters changed in an AlterID range: ledgers with the opening their master stores (no period is set, so Tally works
// nothing out), groups with their parent
func changedLedgersRequest(company string, after, upto int64) string {
	return fcCollection("FinComChangedLed", company, "", "Ledger", "GUID, MasterID, AlterID, Name, Parent, OpeningBalance, PartyGSTIN, IncomeTaxNumber, LEDGSTREGDETAILS.LIST", alterRange(after, upto))
}
func changedGroupsRequest(company string, after, upto int64) string {
	return fcCollection("FinComChangedGrp", company, "", "Group", "GUID, AlterID, Name, Parent", alterRange(after, upto))
}

// one month's entries as ids only (no amounts, no lines): the deletion check
func dayIdsRequest(company, from, to string) string {
	return fcCollection("FinComDayIds", company, "<SVFROMDATE>"+from+"</SVFROMDATE><SVTODATE>"+to+"</SVTODATE>", "Voucher", "GUID, AlterID, Date, IsOptional, IsCancelled, VoucherNumber", "")
}

// the night's check (NightlyTotals on): the primary groups' closing, one request. Tally works these out from every ledger
func totalsRequest(company, fy, asOn string) string {
	return fcCollection("FinComTotals", company, "<SVFROMDATE>"+fy+"</SVFROMDATE><SVTODATE>"+asOn+"</SVTODATE>", "Group", "Name, ClosingBalance", "$$IsEqual:$Parent:$$SysName:Primary")
}

// the "is Tally free?" probe after a request that did not answer: one tiny request (the companies' names)
func probeRequest() string { return fcCollection("FinComFree", "", "", "Company", "Name", "") }

// --- a voucher from a collection as the day book has it: the cloud and FinCom read the day book's shape (no TYPE
// attributes on the fields, the voucher type on the VOUCHER element)
var (
	reAttrTag  = re(`<([A-Za-z][\w.:]*)\s+[^<>]*?(/?)>`)
	reVchOpen  = re(`^<VOUCHER\b[^>]*>`)
	reVchBlock = re(`<VOUCHER\b[\s\S]*?</VOUCHER>`)
)

func normVoucher(v string) string {
	open := reVchOpen.FindString(v)
	if open == "" {
		return ""
	}
	rest := v[len(open):]
	rest = reAttrTag.ReplaceAllString(rest, "<$1$2>")
	if !strings.Contains(open, "VCHTYPE=") {
		if t := strings.TrimSpace(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, rest, 1)); t != "" {
			open = `<VOUCHER VCHTYPE="` + t + `"` + strings.TrimPrefix(open, "<VOUCHER")
		}
	}
	return open + rest
}

type cvch struct {
	guid, date, xml string
	alter           int64
	optional        bool
	cancelled       bool
	lines           bool
}

func cleanGUID(g string) string {
	return re(`[^\w\-.:]`).ReplaceAllString(strings.TrimSpace(html.UnescapeString(g)), "")
}

func parseChanged(raw string) []cvch {
	var out []cvch
	for _, b := range reVchBlock.FindAllString(raw, -1) {
		x := normVoucher(b)
		if x == "" {
			continue
		}
		g := cleanGUID(group(`<GUID>([^<]*)</GUID>`, x, 1))
		d := group(`<DATE>\s*(\d{8})\s*</DATE>`, x, 1)
		if g == "" || d == "" {
			continue
		}
		out = append(out, cvch{guid: g, date: d, xml: x, alter: toI64(group(`<ALTERID>\s*(\d+)`, x, 1)),
			optional:  strings.EqualFold(group(`<ISOPTIONAL>([^<]*)<`, x, 1), "Yes"),
			cancelled: strings.EqualFold(group(`<ISCANCELLED>([^<]*)<`, x, 1), "Yes"),
			lines:     re(`<(ALLLEDGERENTRIES|LEDGERENTRIES|ACCOUNTINGALLOCATIONS|PAYHEADALLOCATIONS)\.LIST>[\s\S]*?<LEDGERNAME>|<PAYHEADNAME>`).MatchString(x)})
	}
	return out
}

// --- the outboxes for the cloud (in the company's folder; nothing is lost offline): changed entries, changed masters,
// and the last AlterIDs (sent after the entries and masters they cover)
func vchOutFile(dir string) string  { return filepath.Join(dir, "cloud-vch.jsonl") }
func mstOutFile(dir string) string  { return filepath.Join(dir, "cloud-masters.json") }
func syncOutFile(dir string) string { return filepath.Join(dir, "cloud-sync.json") }

func queueCloudVouchers(dir string, vs []cvch) {
	if !cloudOn() || len(vs) == 0 {
		return
	}
	var b strings.Builder
	for _, v := range vs {
		b.WriteString(jsonText(M{"day": v.date, "guid": v.guid, "alter": v.alter, "xml": v.xml}) + "\n")
	}
	outMu.Lock()
	_ = appendText(vchOutFile(dir), b.String())
	outMu.Unlock()
}
func queueCloudSync(dir string, st M, extra M) {
	if !cloudOn() {
		return
	}
	o := readObjFile(syncOutFile(dir))
	if o == nil {
		o = M{}
	}
	o["lastV"], o["lastM"] = toI64(st["lastV"]), toI64(st["lastM"])
	for k, v := range extra {
		o[k] = v
	}
	_ = saveFile(syncOutFile(dir), jsonText(o))
}

// --- the change number windows: about cap entries (or masters) a request, by AlterID range. A window that came back
// sparse doubles; one that came back full shrinks; one that did not answer halves (kept in the copy's state)
func changeCap() int { return keepNum("KeepChangeCap", 200) }
func nextWindow(w int64, n int) int64 {
	c := int64(changeCap())
	switch {
	case n > changeCap():
		w = maxI64(1, w*c/int64(n))
	case int64(n) < c/2:
		w = minI64(w*2, 1<<24)
	}
	return w
}
func maxI64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func minI64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// the entries changed since the last AlterID held, to Tally's own last one (upto); true when all are in
func (k *keepRun) vchChanges(company string, port int, dir string, st M, upto int64, inBudget func() bool) (bool, error) {
	from := str(st["from"])
	to := addDays(today(), 366)
	w := toI64(st["vchWin"])
	if w <= 0 {
		w = int64(changeCap())
	}
	before := 0
	for toI64(st["lastV"]) < upto || upto <= 0 {
		if !inBudget() {
			return false, nil
		}
		a := toI64(st["lastV"])
		b := a + w
		if upto > 0 && b > upto {
			b = upto
		}
		if upto <= 0 {
			b = 0 // Tally did not say its last number: one request for all after the last held
		}
		raw, err := invokeTally(k.tc, port, changedVouchersRequest(company, from, to, a, b), 0)
		if err != nil {
			if !gaveWay(err) && w > 1 {
				st["vchWin"] = maxI64(1, w/2)
				saveKeepState(dir, st)
			}
			return false, err
		}
		vs := parseChanged(raw)
		k.takeVouchers(company, port, dir, st, vs, &before)
		mx := b
		for _, v := range vs {
			if v.alter > mx {
				mx = v.alter
			}
		}
		if upto <= 0 {
			mx = maxI64(a, mx)
		}
		st["lastV"] = mx
		w = nextWindow(w, len(vs))
		st["vchWin"] = w
		st["at"] = nowS()
		saveKeepState(dir, st)
		queueCloudSync(dir, st, nil)
		if len(vs) > 0 {
			writeLog(fmt.Sprintf("Keeping %s: %d changed entr%s (AlterID %d-%d)", company, len(vs), map[bool]string{true: "y", false: "ies"}[len(vs) == 1], a+1, mx))
		}
		if upto <= 0 {
			break
		}
	}
	if before > 0 {
		writeLog(fmt.Sprintf("Keeping %s: %d changed entr%s dated before the copy starts (%s) left out; the night's check shows if the openings differ", company, before,
			map[bool]string{true: "y", false: "ies"}[before == 1], str(st["from"])))
	}
	return true, nil
}

// changed entries into the copy (when the bridge keeps the whole day book here) and to the cloud; an entry that came
// without its lines (a Tally that does not give them in a collection) has its day read again from the day book instead
func (k *keepRun) takeVouchers(company string, port int, dir string, st M, vs []cvch, before *int) {
	var send []cvch
	var redo []string
	where := keepWhere(dir)
	for _, v := range vs {
		if v.date < str(st["from"]) {
			*before++
			continue
		}
		if !v.lines && !v.cancelled && !v.optional || cfgB("KeepChangeDays") {
			redo = append(redo, v.date)
			if o := whereGet(where, v.guid); o != "" && o != v.date {
				redo = append(redo, o)
			}
			continue
		}
		send = append(send, v)
	}
	if truthy(st["localDays"]) {
		mergeLocalVouchers(dir, st, send)
	}
	queueCloudVouchers(dir, send)
	if len(redo) > 0 {
		var stale []string
		for _, d := range uniqSorted(redo) {
			stale = append(stale, d)
		}
		st["redo"] = toAny(uniqSorted(append(strs(st["redo"]), stale...)))
	}
}

// changed entries put into the copy's day files (taken off the day they were on), as FinCom reads them from here
func mergeLocalVouchers(dir string, st M, vs []cvch) {
	if len(vs) == 0 {
		return
	}
	days := filepath.Join(dir, "days")
	_ = os.MkdirAll(days, 0o755)
	where := keepWhere(dir)
	touched := map[string]bool{}
	for _, v := range vs {
		tag := "<GUID>" + v.guid + "</GUID>"
		for _, day := range uniqSorted([]string{v.date, whereGet(where, v.guid)}) {
			if day == "" {
				continue
			}
			df := filepath.Join(days, day+".xml")
			t := readText(df)
			var keep strings.Builder
			for _, pc := range re(`<TALLYMESSAGE>[\s\S]*?</TALLYMESSAGE>`).FindAllString(t, -1) {
				if !strings.Contains(pc, tag) {
					keep.WriteString(pc)
				}
			}
			if day == v.date {
				keep.WriteString("<TALLYMESSAGE>" + v.xml + "</TALLYMESSAGE>")
			}
			t2 := keep.String()
			_ = saveFile(df, t2)
			_ = saveFile(strings.TrimSuffix(df, ".xml")+".idx", indexText(t2))
			touched[day] = true
		}
		whereMu.Lock()
		where[v.guid] = v.date
		whereMu.Unlock()
	}
	yms := map[string]bool{}
	for d := range touched {
		yms[d[:6]] = true
	}
	for ym := range yms {
		writeKeepMonth(dir, ym, st)
	}
}

// --- masters: ledgers then groups, each from the last master AlterID held (or from 0: a baseline, or "Re-read these")
type mled struct {
	guid, name, parent, open, gstin, pan string
	alter                                int64
}

func (k *keepRun) mstChanges(company string, port int, dir string, st M, upto int64, base bool, inBudget func() bool) (bool, error) {
	start := toI64(st["lastM"])
	if base {
		start = 0
	}
	if st["mL"] == nil {
		st["mL"] = start
	}
	if st["mG"] == nil {
		st["mG"] = start
	}
	w := toI64(st["mstWin"])
	if w <= 0 {
		w = int64(changeCap())
	}
	for _, kind := range []string{"mL", "mG"} {
		for toI64(st[kind]) < upto {
			if !inBudget() {
				return false, nil
			}
			a := toI64(st[kind])
			b := minI64(a+w, upto)
			req := changedLedgersRequest(company, a, b)
			if kind == "mG" {
				req = changedGroupsRequest(company, a, b)
			}
			raw, err := invokeTally(k.tc, port, req, 0)
			if err != nil {
				if !gaveWay(err) && w > 1 {
					st["mstWin"] = maxI64(1, w/2)
					saveKeepState(dir, st)
				}
				return false, err
			}
			doc := xmlDoc(raw)
			n := 0
			if kind == "mL" {
				var rows []mled
				for _, l := range doc.All("LEDGER") {
					nm, g := nameOf(l), strings.TrimSpace(nt(l, "GUID"))
					if nm == "" {
						continue
					}
					gstin := strings.ToUpper(strings.TrimSpace(nt(l, "PARTYGSTIN")))
					if gstin == "" {
						gstin = strings.ToUpper(strings.TrimSpace(nt(l, "LEDGSTREGDETAILS.LIST/GSTIN")))
					}
					rows = append(rows, mled{g, nm, re(`^\W*Primary$`).ReplaceAllString(nt(l, "PARENT"), ""), amtText(nt(l, "OPENINGBALANCE")), gstin,
						strings.ToUpper(strings.TrimSpace(nt(l, "INCOMETAXNUMBER"))), toI64(re(`\D`).ReplaceAllString(nt(l, "ALTERID"), ""))})
				}
				n = len(rows)
				applyLedgers(company, dir, st, rows, base)
			} else {
				var grp [][2]string
				for _, g := range doc.All("GROUP") {
					if nm := nameOf(g); nm != "" {
						grp = append(grp, [2]string{nm, re(`^\W*Primary$`).ReplaceAllString(nt(g, "PARENT"), "")})
					}
				}
				n = len(grp)
				applyGroups(dir, grp)
			}
			st[kind] = b
			w = nextWindow(w, n)
			st["mstWin"] = w
			st["at"] = nowS()
			saveKeepState(dir, st)
			if n > 0 {
				what := map[string]string{"mL": "ledger", "mG": "group"}[kind]
				writeLog(fmt.Sprintf("Keeping %s: %d %s master(s) read (AlterID %d-%d)", company, n, what, a+1, b))
			}
		}
	}
	if upto > toI64(st["lastM"]) || base {
		st["lastM"] = upto
	}
	delete(st, "mL")
	delete(st, "mG")
	saveKeepState(dir, st)
	queueCloudSync(dir, st, nil)
	return true, nil
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

// changed ledgers: into the copy's list (ledgers.json: guid -> [name, parent, alter, gstin, pan, stored opening]), the
// openings the bridge keeps (balances.json, when the whole day book is kept here), renames followed; and to the cloud
func applyLedgers(company, dir string, st M, rows []mled, base bool) {
	if len(rows) == 0 {
		return
	}
	lf := filepath.Join(dir, "ledgers.json")
	known := obj(readJSONFile(lf))
	if known == nil {
		known = M{}
	}
	bf := filepath.Join(dir, "balances.json")
	bal := readObjFile(bf)
	local := truthy(st["localDays"]) || base
	if local && bal == nil {
		bal = M{"ok": true, "company": company, "from": st["from"], "to": today(), "openAsOn": addDays(str(st["from"]), -1), "ledgers": []any{}, "keep": true, "source": "ledger masters"}
	}
	brow := map[string]M{}
	var border []string
	if bal != nil {
		for _, x := range arr(bal["ledgers"]) {
			l := obj(x)
			n := str(l["name"])
			if _, ok := brow[n]; !ok {
				border = append(border, n)
			}
			brow[n] = M{"name": n, "parent": str(l["parent"]), "open": str(l["open"]), "close": ""}
		}
	}
	out := readObjFile(mstOutFile(dir))
	if out == nil {
		out = M{}
	}
	ol := obj(out["ledgers"])
	if ol == nil {
		ol = M{}
	}
	for _, r := range rows {
		key := r.guid
		if key == "" {
			key = "name:" + r.name
		}
		kv := arr(known[key])
		had := len(kv) > 0
		was := ""
		if had && str(kv[0]) != r.name {
			was = str(kv[0])
			if truthy(st["localDays"]) {
				renameKeepLedger(dir, st, was, r.name)
			}
			writeLog("Keeping " + company + ": ledger " + was + " is now " + r.name)
		}
		if local {
			row := brow[r.name]
			if row == nil && was != "" && brow[was] != nil {
				row = brow[was]
				delete(brow, was)
				row["name"] = r.name
			}
			if row == nil {
				row = M{"name": r.name, "parent": r.parent, "open": r.open, "close": ""}
				border = append(border, r.name)
			} else if base || !had || at(kv, 5) == nil {
				if base || !had {
					row["open"] = r.open
				}
			} else {
				row["open"] = fmt.Sprintf("%.2f", math.Round((num(row["open"])+num(r.open)-num(at(kv, 5)))*100)/100)
			}
			row["parent"] = r.parent
			brow[r.name] = row
		}
		known[key] = []any{r.name, r.parent, r.alter, r.gstin, r.pan, r.open}
		prev := arr(ol[key])
		w := was
		if len(prev) > 7 && str(prev[7]) != "" {
			w = str(prev[7])
		}
		ol[key] = []any{r.name, r.parent, r.open, r.gstin, r.pan, r.guid, r.alter, w}
	}
	_ = saveFile(lf, jsonText(known))
	if local && bal != nil {
		led := []any{}
		done := map[string]bool{}
		for _, n := range border {
			if r, ok := brow[n]; ok && !done[n] {
				led = append(led, r)
				done[n] = true
			}
		}
		bal["ledgers"] = led
		_ = saveFile(bf, jsonText(bal))
		st["balAt"] = nowS()
	}
	if cloudOn() {
		out["ledgers"] = ol
		if base {
			out["base"], out["from"], out["openAsOn"] = true, st["from"], addDays(str(st["from"]), -1)
		}
		_ = saveFile(mstOutFile(dir), jsonText(out))
	}
}

func applyGroups(dir string, grp [][2]string) {
	if len(grp) == 0 {
		return
	}
	gf := filepath.Join(dir, "groups.json")
	have := map[string]string{}
	var order []string
	for _, x := range arr(readJSONFile(gf)) {
		a := arr(x)
		if len(a) >= 2 {
			if _, ok := have[str(a[0])]; !ok {
				order = append(order, str(a[0]))
			}
			have[str(a[0])] = str(a[1])
		}
	}
	for _, g := range grp {
		if _, ok := have[g[0]]; !ok {
			order = append(order, g[0])
		}
		have[g[0]] = g[1]
	}
	a := []any{}
	for _, n := range order {
		a = append(a, []any{n, have[n]})
	}
	_ = saveFile(gf, jsonText(a))
	if cloudOn() {
		out := readObjFile(mstOutFile(dir))
		if out == nil {
			out = M{}
		}
		og := obj(out["groups"])
		if og == nil {
			og = M{}
		}
		for _, g := range grp {
			og[g[0]] = g[1]
		}
		out["groups"] = og
		_ = saveFile(mstOutFile(dir), jsonText(out))
	}
}

// --- the deletion check: per day, the entries' ids and count against the cloud's (else the copy's)
type dayIds struct {
	n int
	h string
}

func idsHash(pairs []string) string {
	sort.Strings(pairs) // byte order, as the cloud's "order by guid collate C" (a GUID has no ':' inside)
	s := md5.Sum([]byte(strings.Join(pairs, ",")))
	return hex.EncodeToString(s[:])
}

// Tally's side, one month a request: the entries of the period, ids only; Optional ones are left out (the day book
// leaves them out too), and a cancelled entry without a number (the cloud keeps none)
func tallyDayIds(tc *TC, company string, port int, from, to string) (map[string]dayIds, error) {
	raw, err := invokeTally(tc, port, dayIdsRequest(company, from, to), 0)
	if err != nil {
		return nil, err
	}
	by := map[string][]string{}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		d, g := nt(v, "DATE"), cleanGUID(nt(v, "GUID"))
		if g == "" || !isTallyDate(d) || d < from || d > to || strings.EqualFold(nt(v, "ISOPTIONAL"), "Yes") {
			continue
		}
		if strings.EqualFold(nt(v, "ISCANCELLED"), "Yes") && nt(v, "VOUCHERNUMBER") == "" {
			continue
		}
		by[d] = append(by[d], g+":"+fmt.Sprint(toI64(re(`\D`).ReplaceAllString(nt(v, "ALTERID"), ""))))
	}
	out := map[string]dayIds{}
	for d, p := range by {
		out[d] = dayIds{len(p), idsHash(p)}
	}
	return out, nil
}

// the cloud's side (FinCom's copy), or the copy here when there is no cloud
func heldDayIds(company, dir, from, to string) (map[string]dayIds, bool) {
	out := map[string]dayIds{}
	if cloudOn() && cloudLinks[company] {
		r := invokeCloud(M{"kind": "day_ids", "company": company, "from": from, "to": to}, 60)
		if r.code != 200 || r.json == nil {
			return nil, false
		}
		for _, x := range arr(r.json["days"]) {
			a := arr(x)
			if len(a) >= 3 {
				out[str(a[0])] = dayIds{toInt(a[1]), str(a[2])}
			}
		}
		return out, true
	}
	for _, f := range dayFiles(dir, "") {
		d := strings.TrimSuffix(filepath.Base(f), ".xml")
		if d < from || d > to {
			continue
		}
		var p []string
		for _, ln := range strings.Split(readKeepIndex(f), "\n") {
			if q := strings.Split(ln, "\t"); q[0] != "" {
				a := int64(0)
				if len(q) > 1 {
					a = toI64(q[1])
				}
				p = append(p, cleanGUID(q[0])+":"+fmt.Sprint(a))
			}
		}
		if len(p) > 0 {
			out[d] = dayIds{len(p), idsHash(p)}
		}
	}
	return out, true
}

// one month compared; the days that differ (and whose Tally list changed since they were last read for this reason)
func (k *keepRun) monthDiff(company string, port int, dir string, st M, ym string) ([]string, map[string]dayIds, error) {
	mf, mt := ym+"01", monthEnd(ym)
	if mf < str(st["from"]) {
		mf = str(st["from"])
	}
	if td := today(); mt > td {
		mt = td
	}
	if mf > mt {
		return nil, nil, nil
	}
	tl, err := tallyDayIds(k.tc, company, port, mf, mt)
	if err != nil {
		return nil, nil, err
	}
	hl, ok := heldDayIds(company, dir, mf, mt)
	if !ok {
		return nil, nil, errors.New("FinCom's cloud did not give its list of entries")
	}
	var diff []string
	for d := mf; d <= mt; d = addDays(d, 1) {
		if tl[d] != hl[d] {
			diff = append(diff, d)
		}
	}
	return diff, tl, nil
}

// the window checked on Update now and at night: this financial year and the last (KeepCheckYears), from the copy's start
func checkWindow(st M) (string, string) {
	fy := tallyDate(fyStart(time.Now()).AddDate(-(keepNum("KeepCheckYears", 2) - 1), 0, 0))
	from := str(st["from"])
	if fy > from {
		from = fy
	}
	return from[:6], today()[:6]
}

// the deletion check over the window, a month a request, resumed within the run; days that differ are read again (one
// at a time). true when the window is done
func (k *keepRun) windowCheck(company string, port int, dir string, st M, inBudget func() bool) (bool, error) {
	if str(st["dcRun"]) != k.id {
		st["dcRun"], st["dcYm"], st["dcFound"] = k.id, "", 0
	}
	a, z := checkWindow(st)
	ym := str(st["dcYm"])
	if ym == "" {
		ym = a
	}
	seen := obj(st["dayChecked"])
	if seen == nil {
		seen = M{}
	}
	for ; ym <= z; ym = nextYm(ym) {
		if !inBudget() {
			st["dcYm"] = ym
			saveKeepState(dir, st)
			return false, nil
		}
		diff, tl, err := k.monthDiff(company, port, dir, st, ym)
		if err != nil {
			st["dcYm"] = ym
			saveKeepState(dir, st)
			return false, err
		}
		var redo []string
		for _, d := range diff {
			// a day read again for this already, and Tally's list of it the same since: not read again (an entry Tally
			// lists but the day book leaves out would otherwise be read every time)
			if str(seen[d]) != "" && str(seen[d]) == tl[d].h {
				continue
			}
			redo = append(redo, d)
		}
		if len(redo) > 0 {
			if _, err := k.updateDates(company, port, dir, st, redo); err != nil {
				st["dcYm"] = ym
				saveKeepState(dir, st)
				return false, err
			}
			for _, d := range redo {
				seen[d] = tl[d].h
			}
			st["dcFound"] = toInt(st["dcFound"]) + len(redo)
			writeLog(fmt.Sprintf("Keeping %s: %s: %d day(s) differ from Tally's list of entries (an entry deleted or not in the copy); read again: %s", company, ym, len(redo), strings.Join(redo, ", ")))
		}
		st["dcYm"] = nextYm(ym)
		saveKeepState(dir, st)
	}
	// keep the remembered days few
	if len(seen) > 2000 {
		var ks []string
		for d := range seen {
			ks = append(ks, d)
		}
		sort.Strings(ks)
		for _, d := range ks[:len(ks)-2000] {
			delete(seen, d)
		}
	}
	st["dayChecked"] = seen
	st["checkedAt"] = nowS()
	return true, nil
}

// --- the night's check (NightlyTotals on; off by default): Tally's primary-group totals, one request, against the
// cloud's; if they differ, the days that differ over the whole copy are found from the lists (no amounts, nothing read
// again) and FinCom shows "Tally's totals differ from FinCom's: N ledgers to check · Re-read these"
func (k *keepRun) nightTotals(company string, port int, dir string, st M) error {
	if !cloudOn() || !cloudLinks[company] {
		return nil
	}
	td := today()
	fy := tallyDate(fyStart(time.Now()))
	raw, err := invokeTally(k.tc, port, totalsRequest(company, fy, td), 0)
	if err != nil {
		return err
	}
	groups := []any{}
	for _, g := range xmlDoc(raw).All("GROUP") {
		if n := nameOf(g); n != "" {
			groups = append(groups, []any{n, amtText(nt(g, "CLOSINGBALANCE"))})
		}
	}
	r := invokeCloud(M{"kind": "verify", "company": company, "asOn": td, "groups": groups}, 60)
	if r.code != 200 || r.json == nil {
		return errors.New("the night's check: FinCom's cloud did not answer (" + r.err + ")")
	}
	v := obj(r.json["verify"])
	res := M{"asOn": td, "totals": true, "differ": toInt(v["differ"]), "groups": arr(v["groups"]), "days": []any{}, "masters": []any{}}
	if toInt(v["differ"]) > 0 {
		writeLog(fmt.Sprintf("Night's check of %s: Tally's totals differ from FinCom's in %d group(s); finding the days that differ (lists of entries only, nothing read again)", company, toInt(v["differ"])))
		var days []string
		for ym := str(st["from"])[:6]; ym <= td[:6]; ym = nextYm(ym) {
			diff, _, err := k.monthDiff(company, port, dir, st, ym)
			if err != nil {
				return err
			}
			days = append(days, diff...)
		}
		res["days"] = toAny(days)
	} else {
		writeLog("Night's check of " + company + ": Tally's totals are FinCom's")
	}
	s := invokeCloud(M{"kind": "verify_save", "company": company, "result": res}, 60)
	if s.code == 200 && s.json != nil {
		if n := toInt(obj(s.json["verify"])["n"]); toInt(v["differ"]) > 0 {
			writeLog(fmt.Sprintf("Night's check of %s: %d ledger(s) to check, on %d day(s); FinCom shows them with Re-read these", company, n, len(arr(res["days"]))))
		}
	}
	return nil
}

// --- the cloud's view of a company, once a run: what it holds (the baseline), the last AlterIDs, a re-read asked for
func (k *keepRun) cloudView(company string) M {
	if !cloudOn() {
		return nil
	}
	if v, ok := k.views[company]; ok {
		return v
	}
	if time.Since(cloudLinksAt).Seconds() >= float64(keepNum("CloudLinksSec", 300)) {
		cloudMu.Lock()
		updateCloudLinks()
		cloudMu.Unlock()
	}
	var v M
	if cloudLinks[company] {
		r := invokeCloud(M{"kind": "sync_get", "company": company}, 30)
		if r.code == 200 && r.json != nil {
			v = obj(r.json["book"])
		}
	}
	k.views[company] = v
	return v
}

// the cloud holds this company's baseline already: masters and the day book (given from Tally's exported files, or sent
// by a bridge before)
func cloudHasBaseline(v M) bool {
	return v != nil && toInt(v["ledgers"]) > 0 && toInt(v["days"]) > 0 && isTallyDate(str(v["from"]))
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
	if st == nil || bal == nil || !truthy(st["localDays"]) || str(st["phase"]) != "live" {
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
			for _, tag := range []string{"ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST", "ACCOUNTINGALLOCATIONS.LIST"} {
				parts := strings.Split(v, "<"+tag+">")
				for _, p := range parts[1:] {
					e := strings.Split(p, "</"+tag+">")[0]
					n := html.UnescapeString(strings.TrimSpace(group(`<LEDGERNAME>([^<]*)</LEDGERNAME>`, e, 1)))
					if n == "" {
						continue
					}
					out[n] += num(amtText(group(`<AMOUNT>([^<]*)</AMOUNT>`, e, 1)))
				}
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
