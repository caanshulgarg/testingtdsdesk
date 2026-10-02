// Measuring Tally for FinCom support (02-Oct-2026: nobody can measure Tally from FinCom's side). Run from the tray
// ("Measure Tally (for FinCom support)") or as
//
//	FinComBridge.exe measure --company "<name>" [--out file] [--ledgers 696-699]
//	FinComBridge.exe measure --company "<name>" --snapshot <label> [--month yyyymm]
//	FinComBridge.exe measure --compare <label1> <label2>
//
// One request at a time, each with its own 25 s cap, through the bridge's own queue (a posting still goes first), with
// the "is Tally free?" rule after a request that does not answer. Nothing is written to Tally. The report is plain text
// in the bridge's folder: times in ms, bytes, counts, errors.
//
//	a. the company-level check: its GUID and highest AlterIDs (the voucher count is not asked: Tally gives none cheaply)
//	b. entries with an AlterID above (highest - 500) over the whole financial year: about 500 entries
//	c. the same, limited to one month (the current month, and the busiest month)
//	d. the list of GUIDs only, for one month
//	e. one entry with every field FinCom needs; its size, and which fields came back
//	f. the hanging-ledger check: the opening each ledger master stores (the master's field, no period, never a balance
//	   worked out) of the ledgers numbered 696-699 in name order, one at a time, the company check between them; their
//	   other master fields first, on their own, so a hang shows which part hangs; it stops after two hangs
//	g. snapshots (each entry's GUID, MasterID and AlterID for a month, the company's GUID and highest AlterID) and their
//	   comparison, for the owner's manual tests (docs/tally-measure-sheet.txt)
package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type measureOpts struct {
	company  string
	out      string
	ledgers  string // "696-699"
	snapshot string
	month    string // yyyymm, for d and the snapshot (default: this month)
}

type mItem struct {
	key, what   string
	ms          int64
	bytes, n    int
	err, note   string
	timedOut    bool
	extraLines  []string
	requestSent bool
}

// all of a voucher FinCom needs (heads, lines, bill-wise, cost centres, GST, TDS, items, bank details)
const measureVchFetch = "GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, REFERENCE, REFERENCEDATE, NARRATION, PARTYLEDGERNAME, PARTYNAME, " +
	"PARTYGSTIN, PLACEOFSUPPLY, GSTREGISTRATIONTYPE, CMPGSTIN, ISOPTIONAL, ISCANCELLED, ISINVOICE, " +
	"ALLLEDGERENTRIES.LIST, LEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, INVENTORYENTRIES.LIST"

// the fields e. looks for, and the tags that show them
var measureFields = []struct{ name, tags string }{
	{"GUID", "GUID"}, {"MasterID", "MASTERID"}, {"AlterID", "ALTERID"}, {"date", "DATE"}, {"voucher type", "VOUCHERTYPENAME"},
	{"voucher number", "VOUCHERNUMBER"}, {"narration", "NARRATION"}, {"ledger entries", "ALLLEDGERENTRIES.LIST|LEDGERENTRIES.LIST"},
	{"ledger name and amount", "LEDGERNAME"}, {"bill-wise allocations", "BILLALLOCATIONS.LIST"},
	{"cost centres", "CATEGORYALLOCATIONS.LIST|COSTCENTREALLOCATIONS.LIST"}, {"party GSTIN", "PARTYGSTIN"}, {"place of supply", "PLACEOFSUPPLY"},
	{"GST rate details", "RATEDETAILS.LIST|GSTRATEDUTYHEAD"}, {"HSN/SAC", "GSTHSNNAME|HSNCODE"},
	{"TDS section / nature", "TDSEXPENSEALLOCATIONS.LIST|TAXOBJECTALLOCATIONS.LIST|TDSNATUREOFPAYMENT"},
	{"inventory lines", "ALLINVENTORYENTRIES.LIST|INVENTORYENTRIES.LIST"}, {"bank allocations", "BANKALLOCATIONS.LIST"},
	{"instrument number", "INSTRUMENTNUMBER"}, {"bank reconciliation date", "BANKERSDATE"},
}

var (
	measureMu   sync.Mutex
	measureLast M
)

// the bridge's own ledger list in name order (the order 2.1.3 numbered them in its batches: "ledgers 691-695")
func measureLedgerRange(spec string) (int, int) {
	a, b := 696, 699
	if m := re(`^(\d+)\s*-\s*(\d+)$`).FindStringSubmatch(strings.TrimSpace(spec)); m != nil {
		a, b = toInt(m[1]), toInt(m[2])
	}
	if a < 1 {
		a = 1
	}
	if b < a {
		b = a
	}
	if b-a > 20 {
		b = a + 20
	}
	return a, b
}

// one request, its time, size and how many of a kind came back
func measureOne(port int, key, what, x, count string) (*mItem, string) {
	it := &mItem{key: key, what: what, requestSent: true}
	t0 := time.Now()
	raw, err := invokeTally(fin, port, x, tallyMaxSec())
	it.ms = time.Since(t0).Milliseconds()
	it.bytes = len(raw)
	if err != nil {
		it.err = err.Error()
		it.timedOut = isBusyErr(err) && strings.Contains(err.Error(), "timed out")
		if !strings.Contains(err.Error(), "timed out") && !strings.Contains(err.Error(), "refused") && re(`is busy`).MatchString(err.Error()) {
			it.requestSent = false // held back: Tally had not answered the small check yet
		}
		return it, ""
	}
	if count != "" {
		it.n = len(xmlDoc(raw).All(count))
	}
	if re(`(?i)<LINEERROR>`).MatchString(raw) {
		it.err = "Tally: " + cut(flat(group(`(?i)<LINEERROR>([\s\S]*?)</LINEERROR>`, raw, 1)), 200)
	}
	return it, raw
}

// waits for Tally to answer the company check after a request that did not answer (at most maxWait)
func measureWaitFree(port int, company string, maxWait time.Duration) (bool, int) {
	end := time.Now().Add(maxWait)
	tries := 0
	for time.Now().Before(end) && !stopping() {
		if err := probeHold(port); err == nil {
			tries++
			if _, err := companyCheck(fin, company, port); err == nil {
				return true, tries
			}
		}
		sleepOrStop(2 * time.Second)
	}
	return false, tries
}

func fyBounds(t time.Time) (string, string) {
	a := fyStart(t)
	return tallyDate(a), tallyDate(a.AddDate(1, 0, -1))
}

// the measurements a-f, one at a time; the report written to a file
func runMeasure(o measureOpts) (M, error) {
	if o.company == "" {
		return nil, errors.New("Say which company: --company \"<name as in Tally>\".")
	}
	if o.snapshot != "" {
		return measureSnapshot(o)
	}
	port, err := findCompanyPort(o.company, 0)
	if err != nil {
		return nil, err
	}
	company := o.company
	var items []*mItem
	add := func(it *mItem) { items = append(items, it) }
	started := time.Now()
	fyA, fyZ := fyBounds(time.Now())
	td := today()
	month := o.month
	if !re(`^\d{6}$`).MatchString(month) {
		month = td[:6]
	}
	mA, mZ := month+"01", monthEnd(month)
	writeLog("Measure Tally: " + company + " (for FinCom support): one request at a time, 25 s each at most")

	// a. the company-level check
	it, raw := measureOne(port, "a", "the company check: its GUID and highest AlterIDs (one tiny request)", companyCheckRequest(company), "COMPANY")
	guid, altV, altM := "", int64(0), int64(0)
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if n := nameOf(c); n == "" || sameCompany(n, company) {
			guid, altV, altM = nt(c, "GUID"), toI64(re(`\D`).ReplaceAllString(nt(c, "ALTVCHID"), "")), toI64(re(`\D`).ReplaceAllString(nt(c, "ALTMSTID"), ""))
		}
	}
	it.note = fmt.Sprintf("company GUID %s; highest AlterID: entries %d, masters %d; the voucher count is not asked (Tally does not give it cheaply)", or(guid, "(not given)"), altV, altM)
	add(it)

	// b. AlterID above (highest - 500), the whole year
	after := altV - 500
	if after < 0 {
		after = 0
	}
	it, raw = measureOne(port, "b", fmt.Sprintf("entries with AlterID above %d over the year %s-%s (every field FinCom needs)", after, fyA, fyZ),
		fcCollection("FinComMeasureB", company, "<SVFROMDATE>"+fyA+"</SVFROMDATE><SVTODATE>"+fyZ+"</SVTODATE>", "Voucher", measureVchFetch, fmt.Sprintf("$AlterID > %d", after)), "VOUCHER")
	if it.n > 0 {
		it.note = fmt.Sprintf("%d bytes an entry on average", it.bytes/it.n)
	}
	add(it)
	freeOrStop := func() bool {
		if needProbe(port) {
			ok, tries := measureWaitFree(port, company, 10*time.Minute)
			add(&mItem{key: "-", what: "waiting for Tally to answer the company check after a request that did not answer", note: fmt.Sprintf("answered: %v after %d check(s)", ok, tries)})
			return ok
		}
		return true
	}
	if !freeOrStop() {
		return measureReport(o, company, port, items, started)
	}

	// c. the same, one month: this month, and the busiest month of the year
	cReq := func(key, a, z string) {
		it, _ := measureOne(port, key, fmt.Sprintf("entries with AlterID above %d, %s-%s only", after, a, z),
			fcCollection("FinComMeasureC", company, "<SVFROMDATE>"+a+"</SVFROMDATE><SVTODATE>"+z+"</SVTODATE>", "Voucher", measureVchFetch, fmt.Sprintf("$AlterID > %d", after)), "VOUCHER")
		add(it)
	}
	cReq("c1", td[:6]+"01", td)
	if !freeOrStop() {
		return measureReport(o, company, port, items, started)
	}
	busy, how := "", ""
	if man := readObjFile(filepath.Join(syncFolder(company), "manifest.json")); man != nil {
		best := -1
		for _, x := range arr(man["months"]) {
			m := obj(x)
			if toInt(m["n"]) > best && str(m["ym"]) >= fyA[:6] && str(m["ym"]) <= fyZ[:6] {
				best, busy = toInt(m["n"]), str(m["ym"])
			}
		}
		how = "from the bridge's copy"
	}
	if busy == "" {
		it, raw := measureOne(port, "c0", "the year's entries, dates only (to find the busiest month)",
			fcCollection("FinComMeasureYear", company, "<SVFROMDATE>"+fyA+"</SVFROMDATE><SVTODATE>"+fyZ+"</SVTODATE>", "Voucher", "DATE", ""), "VOUCHER")
		by := map[string]int{}
		for _, v := range xmlDoc(raw).All("VOUCHER") {
			if d := nt(v, "DATE"); isTallyDate(d) {
				by[d[:6]]++
			}
		}
		best := -1
		for ym, n := range by {
			if n > best {
				best, busy = n, ym
			}
		}
		add(it)
		how = "from the year's dates"
		if !freeOrStop() {
			return measureReport(o, company, port, items, started)
		}
	}
	if busy != "" {
		e := monthEnd(busy)
		if e > td {
			e = td
		}
		cReq("c2", busy+"01", e)
		items[len(items)-1].note = "the busiest month, " + how
		if !freeOrStop() {
			return measureReport(o, company, port, items, started)
		}
	}

	// d. the GUID list only, one month
	it, _ = measureOne(port, "d", "the list of GUIDs only, "+mA+"-"+mZ,
		fcCollection("FinComMeasureD", company, "<SVFROMDATE>"+mA+"</SVFROMDATE><SVTODATE>"+mZ+"</SVTODATE>", "Voucher", "GUID", ""), "VOUCHER")
	add(it)
	if !freeOrStop() {
		return measureReport(o, company, port, items, started)
	}

	// e. one entry with every field
	it, raw = measureOne(port, "e", fmt.Sprintf("one entry (AlterID %d) with every field FinCom needs", altV),
		fcCollection("FinComMeasureE", company, "<SVFROMDATE>"+fyA+"</SVFROMDATE><SVTODATE>"+addDays(td, 366)+"</SVTODATE>", "Voucher", measureVchFetch, fmt.Sprintf("$AlterID = %d", altV)), "VOUCHER")
	if vs := reVchBlock.FindAllString(raw, -1); len(vs) > 0 {
		v := vs[0]
		it.note = fmt.Sprintf("%d bytes for the entry", len(v))
		for _, f := range measureFields {
			st := "absent"
			for _, tg := range strings.Split(f.tags, "|") {
				if m := re(`<` + re(`\.`).ReplaceAllString(tg, `\.`) + `(\s[^>]*)?>([\s\S]*?)</` + re(`\.`).ReplaceAllString(tg, `\.`) + `>`).FindStringSubmatch(v); m != nil {
					if strings.TrimSpace(m[2]) == "" {
						st = "present, empty"
					} else {
						st = "present"
						break
					}
				} else if re(`<`+re(`\.`).ReplaceAllString(tg, `\.`)+`\s*/>`).MatchString(v) && st == "absent" {
					st = "present, empty"
				}
			}
			it.extraLines = append(it.extraLines, fmt.Sprintf("      %-26s %s", f.name, st))
		}
	} else if it.err == "" {
		it.note = "no entry with that AlterID came back (the highest AlterID may be a master's)"
	}
	add(it)
	if !freeOrStop() {
		return measureReport(o, company, port, items, started)
	}

	// f. the hanging-ledger check
	a, b := measureLedgerRange(o.ledgers)
	it, raw = measureOne(port, "f0", "every ledger's name (to number them in name order)", collectionRequest("FinComMeasureNames", "Ledger", "NAME", company, ""), "LEDGER")
	var names []string
	for _, l := range xmlDoc(raw).All("LEDGER") {
		if n := nameOf(l); n != "" {
			names = append(names, n)
		}
	}
	names = uniqSorted(names)
	it.note = fmt.Sprintf("%d ledgers", len(names))
	add(it)
	hangs := 0
	for i := a; i <= b && i <= len(names) && hangs < 2; i++ {
		n := names[i-1]
		flt := `$Name = "` + strings.ReplaceAll(n, `"`, "") + `"`
		if !freeOrStop() {
			break
		}
		// the company check between them
		pi, _ := measureOne(port, fmt.Sprintf("f%d-check", i), "the company check", companyCheckRequest(company), "COMPANY")
		add(pi)
		fi, fraw := measureOne(port, fmt.Sprintf("f%d-fields", i), fmt.Sprintf("ledger %d %q: its master's fields (no opening)", i, n),
			fcCollection("FinComMeasureLedF", company, "", "Ledger", "NAME, PARENT, GUID, MASTERID, ALTERID, ISREVENUE, AFFECTSSTOCK, ISBILLWISEON, ISCOSTCENTRESON, ISDEEMEDPOSITIVE, RESERVEDNAME", flt), "LEDGER")
		for _, l := range xmlDoc(fraw).All("LEDGER") {
			fi.note = fmt.Sprintf("parent %q, is revenue %s, affects stock %s, bill-wise %s, cost centres %s, deemed positive %s, reserved name %q, GUID %s",
				nt(l, "PARENT"), or(nt(l, "ISREVENUE"), "-"), or(nt(l, "AFFECTSSTOCK"), "-"), or(nt(l, "ISBILLWISEON"), "-"), or(nt(l, "ISCOSTCENTRESON"), "-"),
				or(nt(l, "ISDEEMEDPOSITIVE"), "-"), nt(l, "RESERVEDNAME"), nt(l, "GUID"))
		}
		add(fi)
		if fi.timedOut {
			hangs++
			fi.note = fmt.Sprintf("HANGS (no answer in %d s) ", tallyMaxSec()) + fi.note
			continue
		}
		if !freeOrStop() {
			break
		}
		oi, oraw := measureOne(port, fmt.Sprintf("f%d-opening", i), fmt.Sprintf("ledger %d %q: the opening its master stores (the field only, no period)", i, n),
			fcCollection("FinComMeasureLedO", company, "", "Ledger", "NAME, OPENINGBALANCE", flt), "LEDGER")
		for _, l := range xmlDoc(oraw).All("LEDGER") {
			oi.note = "stored opening " + or(nt(l, "OPENINGBALANCE"), "(empty)")
		}
		if oi.timedOut {
			hangs++
			oi.note = fmt.Sprintf("HANGS (no answer in %d s)", tallyMaxSec())
		}
		add(oi)
	}
	if hangs >= 2 {
		add(&mItem{key: "-", what: "the hanging-ledger check stopped after two hangs"})
	}
	freeOrStop() // Tally left answering (the check waited for) before the report is written
	return measureReport(o, company, port, items, started)
}

func or(a, b string) string {
	if strings.TrimSpace(a) == "" {
		return b
	}
	return a
}

func measureReport(o measureOpts, company string, port int, items []*mItem, started time.Time) (M, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "FinCom Bridge %s - Tally measured for FinCom support\nCompany: %s   Tally port: %d   Computer: %s\nStarted %s, took %s\n",
		BridgeVersion, company, port, computerName(), started.Format("2006-01-02 15:04:05"), time.Since(started).Round(time.Second))
	fmt.Fprintf(&b, "Each request on its own, 25 s at most; after a request that did not answer, nothing until the company check answered.\n\n")
	fmt.Fprintf(&b, "%-10s %8s %10s %7s  %s\n", "item", "ms", "bytes", "count", "what / result")
	rows := []any{}
	for _, it := range items {
		res := it.what
		if it.err != "" {
			res += "  ERROR: " + it.err
		}
		if it.note != "" {
			res += "  -- " + it.note
		}
		if !it.requestSent && it.err != "" {
			res += " (nothing was sent)"
		}
		fmt.Fprintf(&b, "%-10s %8d %10d %7d  %s\n", it.key, it.ms, it.bytes, it.n, res)
		for _, l := range it.extraLines {
			b.WriteString(l + "\n")
		}
		rows = append(rows, M{"item": it.key, "what": it.what, "ms": it.ms, "bytes": it.bytes, "count": it.n, "error": it.err, "note": it.note, "timedOut": it.timedOut})
	}
	out := o.out
	if out == "" {
		out = filepath.Join(Home, "measure-"+safeName(strings.ReplaceAll(company, " ", "_"))+"-"+time.Now().Format("20060102-150405")+".txt")
	}
	if err := saveFile(out, b.String()); err != nil {
		return nil, err
	}
	writeLog("Measure Tally: report written to " + out)
	return M{"ok": true, "file": out, "report": b.String(), "items": rows}, nil
}

// --- g. snapshots and their comparison
func snapFile(label string) string {
	return filepath.Join(Home, "measure-snap-"+re(`[^A-Za-z0-9_.-]`).ReplaceAllString(label, "_")+".json")
}

func measureSnapshot(o measureOpts) (M, error) {
	port, err := findCompanyPort(o.company, 0)
	if err != nil {
		return nil, err
	}
	month := o.month
	if !re(`^\d{6}$`).MatchString(month) {
		month = today()[:6]
	}
	a, z := month+"01", monthEnd(month)
	t0 := time.Now()
	raw, err := invokeTally(fin, port, companyCheckRequest(o.company), tallyMaxSec())
	if err != nil {
		return nil, err
	}
	guid, alt := "", int64(0)
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if n := nameOf(c); n == "" || sameCompany(n, o.company) {
			guid, alt = nt(c, "GUID"), toI64(re(`\D`).ReplaceAllString(nt(c, "ALTVCHID"), ""))
		}
	}
	raw, err = invokeTally(fin, port, fcCollection("FinComSnapshot", o.company, "<SVFROMDATE>"+a+"</SVFROMDATE><SVTODATE>"+z+"</SVTODATE>", "Voucher",
		"GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER", ""), tallyMaxSec())
	if err != nil {
		return nil, err
	}
	vs := []any{}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		d := nt(v, "DATE")
		if d != "" && (d < a || d > z) {
			continue
		}
		vs = append(vs, M{"guid": nt(v, "GUID"), "masterId": nt(v, "MASTERID"), "alter": toI64(re(`\D`).ReplaceAllString(nt(v, "ALTERID"), "")), "date": d,
			"type": voucherType(v), "number": nt(v, "VOUCHERNUMBER")})
	}
	snap := M{"label": o.snapshot, "company": o.company, "companyGuid": guid, "highestAlterId": alt, "month": month, "at": nowS(), "ms": time.Since(t0).Milliseconds(), "vouchers": vs}
	f := snapFile(o.snapshot)
	if err := saveFile(f, jsonText(snap)); err != nil {
		return nil, err
	}
	rep := fmt.Sprintf("Snapshot %q of %s, %s: company GUID %s, highest AlterID %d, %d entries; kept in %s\n", o.snapshot, o.company, month, or(guid, "(not given)"), alt, len(vs), f)
	writeLog("Measure Tally: " + strings.TrimSpace(rep))
	return M{"ok": true, "file": f, "report": rep}, nil
}

// what changed between two snapshots: the company's GUID and highest AlterID, and each entry added, gone, or with its
// AlterID, MasterID, date or number changed (an entry deleted and entered again shows as one gone and one added)
func measureCompare(l1, l2 string) (string, error) {
	a, b := readObjFile(snapFile(l1)), readObjFile(snapFile(l2))
	if a == nil || b == nil {
		return "", fmt.Errorf("No snapshot named %q or %q in %s (measure --snapshot <label> makes one)", l1, l2, Home)
	}
	var o strings.Builder
	fmt.Fprintf(&o, "Snapshots %q (%s) and %q (%s) of %s, month %s\n", l1, str(a["at"]), l2, str(b["at"]), str(a["company"]), str(a["month"]))
	same := "the same"
	if str(a["companyGuid"]) != str(b["companyGuid"]) {
		same = "DIFFERENT: " + str(a["companyGuid"]) + " -> " + str(b["companyGuid"])
	}
	fmt.Fprintf(&o, "Company GUID: %s\nHighest AlterID: %d -> %d (%+d)\n", same, toI64(a["highestAlterId"]), toI64(b["highestAlterId"]), toI64(b["highestAlterId"])-toI64(a["highestAlterId"]))
	idx := func(s M) map[string]M {
		m := map[string]M{}
		for _, x := range arr(s["vouchers"]) {
			v := obj(x)
			m[str(v["guid"])] = v
		}
		return m
	}
	A, B := idx(a), idx(b)
	var added, gone, changed []string
	for g, v := range B {
		w, ok := A[g]
		if !ok {
			added = append(added, fmt.Sprintf("  added    %s %s no. %s, %s, MasterID %s, AlterID %d", g, str(v["type"]), str(v["number"]), str(v["date"]), str(v["masterId"]), toI64(v["alter"])))
			continue
		}
		var d []string
		if toI64(w["alter"]) != toI64(v["alter"]) {
			d = append(d, fmt.Sprintf("AlterID %d -> %d", toI64(w["alter"]), toI64(v["alter"])))
		}
		if str(w["masterId"]) != str(v["masterId"]) {
			d = append(d, "MasterID "+str(w["masterId"])+" -> "+str(v["masterId"]))
		}
		if str(w["date"]) != str(v["date"]) {
			d = append(d, "date "+str(w["date"])+" -> "+str(v["date"]))
		}
		if str(w["number"]) != str(v["number"]) {
			d = append(d, "number "+str(w["number"])+" -> "+str(v["number"]))
		}
		if len(d) > 0 {
			changed = append(changed, fmt.Sprintf("  changed  %s %s no. %s: %s", g, str(v["type"]), str(v["number"]), strings.Join(d, ", ")))
		}
	}
	for g, w := range A {
		if _, ok := B[g]; !ok {
			gone = append(gone, fmt.Sprintf("  gone     %s %s no. %s, %s, MasterID %s, AlterID %d", g, str(w["type"]), str(w["number"]), str(w["date"]), str(w["masterId"]), toI64(w["alter"])))
		}
	}
	for _, l := range [][]string{changed, added, gone} {
		sort.Strings(l)
	}
	fmt.Fprintf(&o, "Entries: %d -> %d; %d changed, %d added, %d gone\n", len(A), len(B), len(changed), len(added), len(gone))
	for _, l := range [][]string{changed, added, gone} {
		for _, x := range l {
			o.WriteString(x + "\n")
		}
	}
	return o.String(), nil
}

// --- the tray and the command line reach the running bridge (its queue): POST starts, GET says how far it is
func startMeasure(o measureOpts) M {
	measureMu.Lock()
	defer measureMu.Unlock()
	if measureLast != nil && str(measureLast["state"]) == "running" {
		return measureLast
	}
	measureLast = M{"ok": true, "state": "running", "company": o.company, "at": nowS()}
	go func() {
		r, err := runMeasure(o)
		measureMu.Lock()
		defer measureMu.Unlock()
		if err != nil {
			measureLast = M{"ok": false, "state": "failed", "error": err.Error(), "company": o.company, "at": nowS()}
			return
		}
		r["state"] = "done"
		measureLast = r
	}()
	return measureLast
}
func measureStatus() M {
	measureMu.Lock()
	defer measureMu.Unlock()
	if measureLast == nil {
		return M{"ok": true, "state": "none"}
	}
	return measureLast
}

// the company to measure from the tray: the one company open in Tally (the first, if several)
func trayMeasureCompany() string {
	for _, s := range openCompaniesCached() {
		if s["skipped"] != true && s["ok"] == true {
			for _, c := range sessCompanies(s) {
				return str(c["name"])
			}
		}
	}
	return ""
}

// FinComBridge.exe measure ...: through the running bridge when it answers, else here
func measureCmd(args []string) int {
	var o measureOpts
	var cmp []string
	for i := 0; i < len(args); i++ {
		next := func() string {
			if i+1 < len(args) {
				i++
				return args[i]
			}
			return ""
		}
		switch strings.TrimLeft(strings.ToLower(args[i]), "-") {
		case "company":
			o.company = next()
		case "out":
			o.out = next()
		case "ledgers":
			o.ledgers = next()
		case "snapshot":
			o.snapshot = next()
		case "month":
			o.month = next()
		case "compare":
			cmp = append(cmp, next(), next())
		}
	}
	loadConfigRO()
	logEcho = false
	if len(cmp) == 2 {
		r, err := measureCompare(cmp[0], cmp[1])
		if err != nil {
			fmt.Println(err.Error())
			return 1
		}
		fmt.Print(r)
		return 0
	}
	if o.company == "" {
		fmt.Println(`Say which company: FinComBridge.exe measure --company "<name as in Tally>"`)
		return 2
	}
	port := toInt(cfg("Port"))
	if pingLocal(port, 3*time.Second) != nil {
		body := M{"company": o.company, "out": o.out, "ledgers": o.ledgers, "snapshot": o.snapshot, "month": o.month}
		if r := localCall("POST", "/measure", body); r != nil && r["ok"] != false {
			fmt.Println("Measuring " + o.company + " through the running bridge (one request at a time)...")
			for i := 0; i < 1800; i++ {
				time.Sleep(2 * time.Second)
				s := localCall("GET", "/measure", nil)
				if s == nil {
					continue
				}
				switch str(s["state"]) {
				case "done":
					fmt.Print(str(s["report"]))
					fmt.Println("\nReport: " + str(s["file"]))
					return 0
				case "failed":
					fmt.Println("Not measured: " + str(s["error"]))
					return 1
				}
			}
			fmt.Println("Still measuring after an hour; the report will be in " + Home)
			return 1
		}
	}
	// no bridge running: measured here
	loadConfig()
	r, err := runMeasure(o)
	if err != nil {
		fmt.Println("Not measured: " + err.Error())
		return 1
	}
	fmt.Print(str(r["report"]))
	fmt.Println("\nReport: " + str(r["file"]))
	return 0
}

// a call to the bridge running on this computer, with its key
func localCall(method, path string, body any) M {
	return bridgeCall(method, path, body, 20*time.Second)
}

func bridgeCall(method, path string, body any, timeout time.Duration) M {
	var rd io.Reader
	if body != nil {
		rd = strings.NewReader(jsonText(body))
	}
	req, _ := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", toInt(cfg("Port")), path), rd)
	req.Header.Set("X-Bridge-Key", cfgS("Key"))
	req.Header.Set("Content-Type", "application/json")
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{Proxy: nil}}
	r, err := c.Do(req)
	if err != nil {
		return nil
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return parseObj(string(b))
}
