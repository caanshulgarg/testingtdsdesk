package main

// Next (branch next-push; the owner's decision of 07-Oct-2026): the voucher is identified and read by "full entry at save
// without read-back". The add-on writes ONE full-entry line after the save (FinComRecorder.tdl FCRLiveFull); the bridge
// reads it (pushline.go, recorder_push.go), builds Tally's XML for the entry with its GUID by the rule, and sends it in full
// with NO entry request to Tally. Tests written before the code; run in both stand modes (plain and STAND_TALLY_TYPED=1).
//
// The add-on is not run here (no Tally): pushEmu writes the lines the add-on writes, from a voucher's XML, by the add-on's
// own rules (each value as $$String gives it: amounts without their sign and with Indian grouping, dates d-Mon-yy; free text
// with its length; a new part past the size cap). PUSH233_UPDATE=1 rewrites testdata/push233/*.lines.json and *.push.xml
// (the fixtures tests/run_push233_parse.mjs reads with the cloud's parse.js).

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --- the add-on's lines, from a voucher's XML (the emulator of FCRLiveFull)

type pushEmu struct {
	cguid, cname, tuser, winUser string
	at                           time.Time
	cap                          int    // FCRCap (0: 16000)
	formGuid, formAid            string // the form's after the save ("" : the voucher's own GUID; AlterID one below its own)
}

// $$String of an amount: no sign, Indian grouping (2,00,000.00)
func emuAmt(s string) (string, string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", "No"
	}
	neg := "No"
	if strings.HasPrefix(s, "-") {
		neg, s = "Yes", s[1:]
	}
	ip, fp := s, ""
	if i := strings.Index(s, "."); i >= 0 {
		ip, fp = s[:i], s[i:]
	}
	if len(ip) > 3 {
		head, tail := ip[:len(ip)-3], ip[len(ip)-3:]
		var g []string
		for len(head) > 2 {
			g = append([]string{head[len(head)-2:]}, g...)
			head = head[:len(head)-2]
		}
		if head != "" {
			g = append([]string{head}, g...)
		}
		ip = strings.Join(g, ",") + "," + tail
	}
	return ip + fp, neg
}

// $$String of a date: d-Mon-yy
func emuDate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) != 8 {
		return s
	}
	t, err := time.Parse("20060102", s)
	if err != nil {
		return s
	}
	return t.Format("2-Jan-06")
}

func emuLP(k, v string) string { return k + ":" + strconv.Itoa(u16len(v)) + "=" + v }

func emuNode(n *Node, tag string) string { return strings.TrimSpace(n.One(tag).InnerText()) }

// a list's elements as the add-on's in-memory list: an empty top-level placeholder is no element; an empty sub-list
// element is one with empty fields (as Tally's in-memory lists gave "L1C1=cat=" in run 37580283590)
func emuList(n *Node, tag string, top bool) []*Node {
	var o []*Node
	for _, k := range n.Sel(tag) {
		if top && len(k.Kids) == 0 {
			continue
		}
		o = append(o, k)
	}
	return o
}

func pushLinesFromXML(t *testing.T, x string, o pushEmu) []string {
	t.Helper()
	vs := xmlDoc(x).All("VOUCHER")
	var v *Node
	for _, c := range vs {
		if len(c.Kids) > 0 {
			v = c
			break
		}
	}
	if v == nil {
		t.Fatal("no voucher in the XML")
	}
	g := emuNode(v, "GUID")
	if o.cguid == "" {
		o.cguid = g[:strings.LastIndex(g, "-")]
	}
	mid := emuNode(v, "MASTERID")
	aid := emuNode(v, "ALTERID")
	if o.formGuid == "" {
		o.formGuid = g
	}
	if o.formAid == "" {
		n, _ := strconv.Atoi(aid)
		o.formAid = strconv.Itoa(maxI(0, n-1))
	}
	if o.cap == 0 {
		o.cap = 16000
	}
	ts := o.at.In(liveZone).Format("2-Jan-06 15:04")
	vt := emuNode(v, "VOUCHERTYPENAME")
	head := "FCR1|ev=voucher_full|t0=" + ts + "|tw=" + ts + "|w=" + o.winUser + "|cguid=" + o.cguid + "|cname=" + o.cname + "|user=" + o.tuser +
		"|obj=Voucher|guid=" + o.formGuid + "|mid=" + mid + "|aid=" + o.formAid + "|vtype=" + vt + "|vno=" + emuNode(v, "VOUCHERNUMBER") +
		"|vdate=" + emuDate(emuNode(v, "DATE")) + "|name=|parent=|narr=FE1"
	var recs []string
	add := func(s string) { recs = append(recs, s) }
	amt := func(n *Node, tag string) (string, string) { return emuAmt(emuNode(n, tag)) }
	text := func(n *Node, tag string) string { return strings.TrimSpace(n.One(tag).InnerText()) }
	dpOf := func(n *Node) string {
		if d := text(n, "ISDEEMEDPOSITIVE"); d != "" {
			return d
		}
		_, ng := amt(n, "AMOUNT")
		return ng
	}
	add("|mid=" + mid + "|aid=" + o.formAid + "|guid=" + o.formGuid + "|date=" + emuDate(emuNode(v, "DATE")) + "|canc=" + emuNode(v, "ISCANCELLED") + "|opt=" + emuNode(v, "ISOPTIONAL"))
	add("|" + emuLP("vtype", vt) + "|" + emuLP("vno", emuNode(v, "VOUCHERNUMBER")) + "|" + emuLP("party", emuNode(v, "PARTYLEDGERNAME")) + "|" + emuLP("view", emuNode(v, "PERSISTEDVIEW")))
	add("|" + emuLP("ref", emuNode(v, "REFERENCE")) + "|refdt=" + emuDate(emuNode(v, "REFERENCEDATE")) + "|" + emuLP("pgstin", emuNode(v, "PARTYGSTIN")) + "|" +
		emuLP("pos", emuNode(v, "PLACEOFSUPPLY")) + "|" + emuLP("cgstin", emuNode(v, "CMPGSTIN")))
	ewb := ""
	if l := v.Sel("EWAYBILLDETAILS.LIST"); len(l) > 0 {
		ewb = emuNode(l[0], "BILLNUMBER")
	}
	add("|" + emuLP("irn", emuNode(v, "IRN")) + "|" + emuLP("irnack", emuNode(v, "IRNACKNO")) + "|irnackdt=" + emuDate(emuNode(v, "IRNACKDATE")) + "|" + emuLP("ewb", ewb))
	// the narration as Tally holds it (a line break is CR LF in Tally's text)
	narr := strings.ReplaceAll(strings.ReplaceAll(v.One("NARRATION").InnerText(), "\r\n", "\n"), "\n", "\r\n")
	add("|" + emuLP("narr", strings.TrimSpace(narr)))
	rates := func(p string, n *Node) {
		for j, r := range emuList(n, "RATEDETAILS.LIST", false) {
			add(fmt.Sprintf("|%sR%d=head=%s~vt=%s~rate=%s", p, j+1, text(r, "GSTRATEDUTYHEAD"), text(r, "GSTRATEVALUATIONTYPE"), text(r, "GSTRATE")))
		}
	}
	costs := func(p string, n *Node) {
		for j, c := range emuList(n, "CATEGORYALLOCATIONS.LIST", false) {
			add(fmt.Sprintf("|%sC%d=%s", p, j+1, emuLP("cat", text(c, "CATEGORY"))))
			for k, cc := range emuList(c, "COSTCENTREALLOCATIONS.LIST", false) {
				a, ng := amt(cc, "AMOUNT")
				add(fmt.Sprintf("|%sC%dc%d=%s~amt=%s~neg=%s", p, j+1, k+1, emuLP("cc", text(cc, "NAME")), a, ng))
			}
		}
	}
	batches := func(p string, n *Node) {
		for j, b := range emuList(n, "BATCHALLOCATIONS.LIST", false) {
			a, ng := amt(b, "AMOUNT")
			add(fmt.Sprintf("|%sb%d=%s~%s~%s~%s~due=%s~%s~%s~%s~amt=%s~neg=%s", p, j+1, emuLP("god", text(b, "GODOWNNAME")), emuLP("bat", text(b, "BATCHNAME")),
				emuLP("trk", text(b, "TRACKINGNUMBER")), emuLP("ord", text(b, "ORDERNO")), emuDate(text(b, "ORDERDUEDATE")), emuLP("aq", text(b, "ACTUALQTY")),
				emuLP("bq", text(b, "BILLEDQTY")), emuLP("rate", text(b, "BATCHRATE")), a, ng))
		}
	}
	les := emuList(v, "ALLLEDGERENTRIES.LIST", true)
	add("|nL=" + strconv.Itoa(len(les)))
	for i, e := range les {
		p := "L" + strconv.Itoa(i+1)
		a, ng := amt(e, "AMOUNT")
		add(fmt.Sprintf("|%s=%s~amt=%s~neg=%s~dp=%s~party=%s~%s", p, emuLP("led", text(e, "LEDGERNAME")), a, ng, dpOf(e), text(e, "ISPARTYLEDGER"), emuLP("hsn", text(e, "GSTHSNNAME"))))
		rates(p, e)
		for j, b := range emuList(e, "BILLALLOCATIONS.LIST", false) {
			a, ng := amt(b, "AMOUNT")
			add(fmt.Sprintf("|%sB%d=%s~type=%s~amt=%s~neg=%s~%s~%s", p, j+1, emuLP("name", text(b, "NAME")), text(b, "BILLTYPE"), a, ng, emuLP("cp", text(b, "BILLCREDITPERIOD")),
				emuLP("tdssec", text(b, "TDSDEDUCTEESECTIONNUMBER"))))
		}
		for j, b := range emuList(e, "BANKALLOCATIONS.LIST", false) {
			a, ng := amt(b, "AMOUNT")
			add(fmt.Sprintf("|%sK%d=date=%s~%s~tt=%s~%s~idt=%s~bdt=%s~%s~amt=%s~neg=%s", p, j+1, emuDate(text(b, "DATE")), emuLP("name", text(b, "NAME")), text(b, "TRANSACTIONTYPE"),
				emuLP("ino", text(b, "INSTRUMENTNUMBER")), emuDate(text(b, "INSTRUMENTDATE")), emuDate(text(b, "BANKERSDATE")), emuLP("utr", text(b, "UNIQUEREFERENCENUMBER")), a, ng))
		}
		costs(p, e)
		for j, tx := range emuList(e, "TAXOBJECTALLOCATIONS.LIST", false) {
			add(fmt.Sprintf("|%sT%d=tt=%s~%s~%s~ref=%s", p, j+1, text(tx, "TAXTYPE"), emuLP("cat", text(tx, "CATEGORY")), emuLP("pl", text(tx, "PARTYLEDGER")), text(tx, "REFTYPE")))
			for k, s := range emuList(tx, "SUBCATEGORYALLOCATION.LIST", false) {
				as, an := amt(s, "ASSESSABLEAMOUNT")
				ts, tn := amt(s, "TAX")
				add(fmt.Sprintf("|%sT%ds%d=%s~%s~rate=%s~ass=%s~assneg=%s~tax=%s~taxneg=%s", p, j+1, k+1, emuLP("sub", text(s, "SUBCATEGORY")), emuLP("duty", text(s, "DUTYLEDGER")),
					text(s, "TAXRATE"), as, an, ts, tn))
			}
		}
	}
	its := emuList(v, "ALLINVENTORYENTRIES.LIST", true)
	add("|nI=" + strconv.Itoa(len(its)))
	for i, it := range its {
		p := "I" + strconv.Itoa(i+1)
		a, ng := amt(it, "AMOUNT")
		add(fmt.Sprintf("|%s=%s~%s~%s~%s~amt=%s~neg=%s~dp=%s~%s", p, emuLP("item", text(it, "STOCKITEMNAME")), emuLP("qty", text(it, "BILLEDQTY")), emuLP("aq", text(it, "ACTUALQTY")),
			emuLP("rate", text(it, "RATE")), a, ng, text(it, "ISDEEMEDPOSITIVE"), emuLP("hsn", text(it, "GSTHSNNAME"))))
		rates(p, it)
		for j, ac := range emuList(it, "ACCOUNTINGALLOCATIONS.LIST", false) {
			a, ng := amt(ac, "AMOUNT")
			q := fmt.Sprintf("%sA%d", p, j+1)
			add(fmt.Sprintf("|%s=%s~amt=%s~neg=%s~dp=%s", q, emuLP("led", text(ac, "LEDGERNAME")), a, ng, text(ac, "ISDEEMEDPOSITIVE")))
			costs(q, ac)
		}
		batches(p, it)
	}
	os := emuList(v, "INVOICEORDERLIST.LIST", true)
	add("|nO=" + strconv.Itoa(len(os)))
	for i, or := range os {
		add(fmt.Sprintf("|O%d=%s~dt=%s", i+1, emuLP("no", text(or, "BASICPURCHASEORDERNO")), emuDate(text(or, "BASICORDERDATE"))))
	}
	for _, io := range []struct{ p, tag string }{{"SO", "INVENTORYENTRIESOUT.LIST"}, {"SI", "INVENTORYENTRIESIN.LIST"}} {
		l := emuList(v, io.tag, true)
		add("|n" + io.p + "=" + strconv.Itoa(len(l)))
		for i, it := range l {
			p := io.p + strconv.Itoa(i+1)
			a, ng := amt(it, "AMOUNT")
			add(fmt.Sprintf("|%s=%s~%s~%s~%s~amt=%s~neg=%s~dp=%s", p, emuLP("item", text(it, "STOCKITEMNAME")), emuLP("aq", text(it, "ACTUALQTY")), emuLP("bq", text(it, "BILLEDQTY")),
				emuLP("rate", text(it, "RATE")), a, ng, text(it, "ISDEEMEDPOSITIVE")))
			batches(p, it)
		}
	}
	ces := emuList(v, "CATEGORYENTRY.LIST", true)
	add("|nCE=" + strconv.Itoa(len(ces)))
	for i, ce := range ces {
		p := "CE" + strconv.Itoa(i+1)
		add(fmt.Sprintf("|%s=%s", p, emuLP("cat", text(ce, "CATEGORY"))))
		for j, em := range emuList(ce, "EMPLOYEEENTRIES.LIST", false) {
			a, ng := amt(em, "AMOUNT")
			q := fmt.Sprintf("%sE%d", p, j+1)
			add(fmt.Sprintf("|%s=%s~amt=%s~neg=%s", q, emuLP("emp", text(em, "EMPLOYEENAME")), a, ng))
			for k, ph := range emuList(em, "PAYHEADALLOCATIONS.LIST", false) {
				a, ng := amt(ph, "AMOUNT")
				add(fmt.Sprintf("|%sp%d=%s~amt=%s~neg=%s", q, k+1, emuLP("ph", text(ph, "PAYHEADNAME")), a, ng))
			}
			for k, at := range emuList(em, "ATTENDANCEENTRIES.LIST", false) {
				add(fmt.Sprintf("|%sa%d=%s~%s", q, k+1, emuLP("att", text(at, "ATTENDANCETYPE")), emuLP("val", text(at, "ATTDTYPEVALUE"))))
			}
		}
	}
	// the parts: a new line once this one passes the cap (the record that passes it opens the next part), as FCRLiveFull
	var lines []string
	cur := head + "|part=1"
	n, part := 0, 1
	for _, r := range recs {
		n += u16len(r)
		if n > o.cap {
			lines = append(lines, cur+"|more=1|t1="+ts+"|src=live")
			part++
			cur = head + "|part=" + strconv.Itoa(part)
			n = u16len(r)
		}
		cur += r
	}
	return append(lines, cur+"|end=1|t1="+ts+"|src=live")
}

// --- the canonical entry: what the line carries, read from an XML (Tally's capture or the bridge's), to compare

func canonAmt(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if s == "" {
		return ""
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return "?" + s
	}
	if f == 0 {
		return "0.00"
	}
	return strconv.FormatFloat(f, 'f', 2, 64)
}

func canonTxt(s string) string { return strings.Join(strings.Fields(s), " ") }

func pushCanon(t *testing.T, x string) M {
	t.Helper()
	var v *Node
	for _, c := range xmlDoc(x).All("VOUCHER") {
		if len(c.Kids) > 0 {
			v = c
			break
		}
	}
	if v == nil {
		t.Fatal("no voucher")
	}
	tx := func(n *Node, tag string) string { return canonTxt(n.One(tag).InnerText()) }
	dt := func(n *Node, tag string) string { return normDate(tx(n, tag)) }
	nonEmpty := func(m M) bool {
		for _, v := range m {
			switch x := v.(type) {
			case string:
				if x != "" {
					return true
				}
			case []any:
				if len(x) > 0 {
					return true
				}
			}
		}
		return false
	}
	var list func(n *Node, tag string, f func(*Node) M) []any
	list = func(n *Node, tag string, f func(*Node) M) []any {
		o := []any{}
		for _, k := range n.Sel(tag) {
			if m := f(k); nonEmpty(m) {
				o = append(o, m)
			}
		}
		return o
	}
	rates := func(n *Node) []any {
		return list(n, "RATEDETAILS.LIST", func(r *Node) M {
			return M{"head": tx(r, "GSTRATEDUTYHEAD"), "vt": tx(r, "GSTRATEVALUATIONTYPE"), "rate": tx(r, "GSTRATE")}
		})
	}
	costs := func(n *Node) []any {
		return list(n, "CATEGORYALLOCATIONS.LIST", func(c *Node) M {
			return M{"cat": tx(c, "CATEGORY"), "cc": list(c, "COSTCENTREALLOCATIONS.LIST", func(cc *Node) M {
				return M{"name": tx(cc, "NAME"), "amt": canonAmt(tx(cc, "AMOUNT"))}
			})}
		})
	}
	batches := func(n *Node) []any {
		return list(n, "BATCHALLOCATIONS.LIST", func(b *Node) M {
			return M{"god": tx(b, "GODOWNNAME"), "bat": tx(b, "BATCHNAME"), "trk": tx(b, "TRACKINGNUMBER"), "ord": tx(b, "ORDERNO"), "due": dt(b, "ORDERDUEDATE"),
				"aq": tx(b, "ACTUALQTY"), "bq": tx(b, "BILLEDQTY"), "rate": tx(b, "BATCHRATE"), "amt": canonAmt(tx(b, "AMOUNT"))}
		})
	}
	ewb := ""
	if l := v.Sel("EWAYBILLDETAILS.LIST"); len(l) > 0 {
		ewb = tx(l[0], "BILLNUMBER")
	}
	out := M{"guid": tx(v, "GUID"), "mid": tx(v, "MASTERID"), "date": dt(v, "DATE"), "vtype": tx(v, "VOUCHERTYPENAME"), "vno": tx(v, "VOUCHERNUMBER"),
		"party": tx(v, "PARTYLEDGERNAME"), "narr": tx(v, "NARRATION"), "canc": tx(v, "ISCANCELLED"), "opt": tx(v, "ISOPTIONAL"), "ref": tx(v, "REFERENCE"),
		"refdt": dt(v, "REFERENCEDATE"), "pgstin": tx(v, "PARTYGSTIN"), "pos": tx(v, "PLACEOFSUPPLY"), "cgstin": tx(v, "CMPGSTIN"), "irn": tx(v, "IRN"),
		"irnack": tx(v, "IRNACKNO"), "irnackdt": dt(v, "IRNACKDATE"), "ewb": ewb}
	out["ledgers"] = list(v, "ALLLEDGERENTRIES.LIST", func(e *Node) M {
		return M{"led": tx(e, "LEDGERNAME"), "amt": canonAmt(tx(e, "AMOUNT")), "dp": tx(e, "ISDEEMEDPOSITIVE"), "hsn": tx(e, "GSTHSNNAME"), "rates": rates(e),
			"bills": list(e, "BILLALLOCATIONS.LIST", func(b *Node) M {
				return M{"name": tx(b, "NAME"), "type": tx(b, "BILLTYPE"), "amt": canonAmt(tx(b, "AMOUNT")), "cp": tx(b, "BILLCREDITPERIOD"), "sec": tx(b, "TDSDEDUCTEESECTIONNUMBER")}
			}),
			"banks": list(e, "BANKALLOCATIONS.LIST", func(b *Node) M {
				return M{"date": dt(b, "DATE"), "name": tx(b, "NAME"), "tt": tx(b, "TRANSACTIONTYPE"), "ino": tx(b, "INSTRUMENTNUMBER"), "idt": dt(b, "INSTRUMENTDATE"),
					"bdt": dt(b, "BANKERSDATE"), "utr": tx(b, "UNIQUEREFERENCENUMBER"), "amt": canonAmt(tx(b, "AMOUNT"))}
			}),
			"costs": costs(e),
			"tds": list(e, "TAXOBJECTALLOCATIONS.LIST", func(q *Node) M {
				return M{"tt": tx(q, "TAXTYPE"), "cat": tx(q, "CATEGORY"), "pl": tx(q, "PARTYLEDGER"), "subs": list(q, "SUBCATEGORYALLOCATION.LIST", func(s *Node) M {
					return M{"sub": tx(s, "SUBCATEGORY"), "duty": tx(s, "DUTYLEDGER"), "rate": tx(s, "TAXRATE"), "ass": canonAmt(tx(s, "ASSESSABLEAMOUNT")), "tax": canonAmt(tx(s, "TAX"))}
				})}
			})}
	})
	out["items"] = list(v, "ALLINVENTORYENTRIES.LIST", func(i *Node) M {
		return M{"item": tx(i, "STOCKITEMNAME"), "qty": tx(i, "BILLEDQTY"), "aq": tx(i, "ACTUALQTY"), "rate": tx(i, "RATE"), "amt": canonAmt(tx(i, "AMOUNT")),
			"hsn": tx(i, "GSTHSNNAME"), "rates": rates(i), "batches": batches(i),
			"alloc": list(i, "ACCOUNTINGALLOCATIONS.LIST", func(a *Node) M {
				return M{"led": tx(a, "LEDGERNAME"), "amt": canonAmt(tx(a, "AMOUNT")), "costs": costs(a)}
			})}
	})
	out["orders"] = list(v, "INVOICEORDERLIST.LIST", func(o *Node) M {
		return M{"no": tx(o, "BASICPURCHASEORDERNO"), "dt": dt(o, "BASICORDERDATE")}
	})
	for _, io := range []string{"INVENTORYENTRIESOUT.LIST", "INVENTORYENTRIESIN.LIST"} {
		out[io] = list(v, io, func(i *Node) M {
			return M{"item": tx(i, "STOCKITEMNAME"), "aq": tx(i, "ACTUALQTY"), "bq": tx(i, "BILLEDQTY"), "rate": tx(i, "RATE"), "amt": canonAmt(tx(i, "AMOUNT")), "batches": batches(i)}
		})
	}
	out["payroll"] = list(v, "CATEGORYENTRY.LIST", func(c *Node) M {
		return M{"cat": tx(c, "CATEGORY"), "emps": list(c, "EMPLOYEEENTRIES.LIST", func(e *Node) M {
			return M{"emp": tx(e, "EMPLOYEENAME"), "amt": canonAmt(tx(e, "AMOUNT")),
				"heads": list(e, "PAYHEADALLOCATIONS.LIST", func(p *Node) M { return M{"ph": tx(p, "PAYHEADNAME"), "amt": canonAmt(tx(p, "AMOUNT"))} }),
				"att":   list(e, "ATTENDANCEENTRIES.LIST", func(a *Node) M { return M{"att": tx(a, "ATTENDANCETYPE"), "val": tx(a, "ATTDTYPEVALUE")} })}
		})}
	})
	return out
}

// the lines' payloads, as the reader takes them (each part's raw text), into Tally's XML for the entry
func pushXMLOf(t *testing.T, lines []string) (string, *pushEntry) {
	t.Helper()
	var ps []string
	var head recLine
	for i, l := range lines {
		r, ok := parseRecorderLine(l)
		if !ok || r.Ev != pushEv {
			t.Fatalf("part %d is not a recorder line of the full entry: %q", i+1, cut(l, 300))
		}
		if i == 0 {
			head = r
		}
		p, ok := pushPayload(l)
		if !ok {
			t.Fatalf("part %d: no payload", i+1)
		}
		ps = append(ps, p)
	}
	e, err := pushParse(ps)
	if err != nil {
		t.Fatalf("the full entry: %v", err)
	}
	g, why := pushGuidCheck(head.CGUID, e.s("mid"), "altered", head.GUID)
	if why != "" {
		t.Fatalf("the GUID: %s", why)
	}
	x, err := pushEntryXML(e, g, 0)
	if err != nil {
		t.Fatalf("the XML: %v", err)
	}
	return x, e
}

// the fixtures the equivalence runs on: every captured entry of the real TallyPrime 7.1 run (231), the typed-like TDS
// payment, and the made-up vouchers with godowns, batches, TDS, an order list, payroll and a stock journal
func pushSources(t *testing.T) map[string]string {
	t.Helper()
	src := map[string]string{}
	m, _ := filepath.Glob(filepath.Join("testdata", "real-tally-7.1", "231", "*.entry.xml"))
	for _, f := range m {
		src["real231-"+strings.TrimSuffix(filepath.Base(f), ".entry.xml")] = f
	}
	src["typed-partA-payment-tds"] = filepath.Join("testdata", "typed-like-7.1", "partA-payment-tds.xml")
	for _, n := range []string{"typed-like-purchase-godown-tds", "typed-like-payroll", "typed-like-stock-journal"} {
		src[n] = filepath.Join("testdata", "push233", n+".xml")
	}
	if len(src) < 20 {
		t.Fatalf("fixtures: %d", len(src))
	}
	return src
}

var pushAt = time.Date(2026, 10, 7, 10, 15, 0, 0, time.UTC)

func pushEmuFor(cap int) pushEmu {
	return pushEmu{cname: "Push Co", tuser: "TALLY User", winUser: "anshul", at: pushAt, cap: cap}
}

// --- 1. the line: every block, TDS and inventory with godown and batch included
func TestPushLineEveryBlock(t *testing.T) {
	x := readText(filepath.Join("testdata", "push233", "typed-like-purchase-godown-tds.xml"))
	lines := pushLinesFromXML(t, x, pushEmuFor(0))
	if len(lines) != 1 {
		t.Fatalf("one line under the cap: %d", len(lines))
	}
	l := lines[0]
	if !strings.HasPrefix(l, "FCR1|ev=voucher_full|") || !reLiveDone.MatchString(l) || !strings.HasSuffix(l, "|end=1|t1=7-Oct-26 10:15|src=live") {
		t.Fatalf("the line's frame: %q", cut(l, 200))
	}
	built, e := pushXMLOf(t, lines)
	if e.s("mid") != "42" || e.s("vtype") != "Purchase" || e.s("vno") != "P/42" || e.s("party") != "Rich Supplier | Delhi" || e.s("view") != "Invoice Voucher View" ||
		e.s("narr") != "made-up purchase: goods a|b~c=d\r\nsecond line: two godowns, 194Q" || e.s("ewb") != "EWB 1234 5678" || e.n("nL") != 5 || e.n("nI") != 2 || e.n("nO") != 1 {
		t.Fatalf("the entry's own fields: %v", e.scal)
	}
	for k, want := range map[string]map[string]string{
		"L1":       {"led": "Rich Supplier | Delhi", "amt": "11,790.00", "neg": "No", "dp": "No", "party": "Yes"},
		"L1B1":     {"name": "RS/77", "type": "New Ref", "cp": "30 Days", "tdssec": "194Q", "amt": "11,790.00"},
		"L2":       {"led": "Purchase 18%", "amt": "10,000.00", "neg": "Yes", "dp": "Yes"},
		"L5T1":     {"tt": "TDS", "cat": "Purchase of Goods", "pl": "Rich Supplier | Delhi", "ref": "New Ref"},
		"L5T1s1":   {"sub": "Income Tax", "duty": "TDS Payable 194Q", "rate": "0.10", "ass": "10,000.00", "tax": "10.00"},
		"I1":       {"item": "Widget ~A", "qty": "50 Nos", "rate": "100.00/Nos", "amt": "5,000.00", "neg": "Yes", "hsn": "8471"},
		"I1b1":     {"god": "Main Store", "bat": "B-01", "trk": "GRN=1", "ord": "PO|9", "due": "10-Oct-26", "aq": "30 Nos", "amt": "3,000.00"},
		"I1b2":     {"god": "Annex|Store", "bat": "B-02", "amt": "2,000.00"},
		"I1A1":     {"led": "Purchase 18%", "amt": "5,000.00", "neg": "Yes"},
		"I1A1C1":   {"cat": "Region"},
		"I1A1C1c2": {"cc": "South: Zone=2", "amt": "2,000.00"},
		"I1R3":     {"head": "IGST", "vt": "Based on Value", "rate": "18"},
		"I2b1":     {"god": "Main Store", "bat": "Lot ~7"},
		"O1":       {"no": "PO|9", "dt": "1-Oct-26"},
	} {
		r := e.rec(k)
		if r == nil {
			t.Errorf("record %s missing (have %v)", k, e.keys())
			continue
		}
		for f, v := range want {
			if r[f] != v {
				t.Errorf("%s.%s = %q, want %q", k, f, r[f], v)
			}
		}
	}
	// the XML: every block where Tally's answer has it, signed as Tally signs
	for _, s := range []string{`<GUID>5b7e2c10-4f1a-4d2e-9a3b-0c1d2e3f4a5b-0000002a</GUID>`, `<MASTERID TYPE="Number"> 42</MASTERID>`, `<GODOWNNAME TYPE="String">Annex|Store</GODOWNNAME>`,
		`<BATCHNAME TYPE="String">Lot ~7</BATCHNAME>`, `<SUBCATEGORY TYPE="String">Income Tax</SUBCATEGORY>`, `<DUTYLEDGER TYPE="String">TDS Payable 194Q</DUTYLEDGER>`,
		`<ASSESSABLEAMOUNT TYPE="Amount">10000.00</ASSESSABLEAMOUNT>`, `<TAX TYPE="Amount">10.00</TAX>`, `<PARTYLEDGER TYPE="String">Rich Supplier | Delhi</PARTYLEDGER>`,
		`<TDSDEDUCTEESECTIONNUMBER>194Q</TDSDEDUCTEESECTIONNUMBER>`, `<AMOUNT TYPE="Amount">-10000.00</AMOUNT>`, `<AMOUNT TYPE="Amount">11790.00</AMOUNT>`,
		`<NAME TYPE="String">South: Zone=2</NAME>`, `<BASICPURCHASEORDERNO TYPE="String">PO|9</BASICPURCHASEORDERNO>`, `a|b~c=d&#13;&#10;second line`} {
		if !strings.Contains(built, s) {
			t.Errorf("the XML lacks %s", s)
		}
	}
	if strings.Contains(built, "<ALTERID") {
		t.Error("the line has no AlterID: the XML must not invent one")
	}
	if got, want := jsonText(pushCanon(t, built)), jsonText(pushCanon(t, x)); got != want {
		t.Fatalf("the entry differs from Tally's:\n%s\n%s", got, want)
	}
}

// --- 2. separators in values, and the size cap
func TestPushEscapingAndParts(t *testing.T) {
	x := readText(filepath.Join("testdata", "push233", "typed-like-purchase-godown-tds.xml"))
	// every separator, a forged key, a forged end, a line break, a non-BMP character, and Tally's not-applicable mark
	nasty := "x|nL=9~amt=1|L9=led:3=abc|end=1|t1=7-Oct-26 10:15|src=live\r\nFCR1|ev=after_delete|y :12=😀\x04 Not Applicable"
	x = strings.Replace(x, "Rich Supplier | Delhi</PARTYLEDGERNAME>", pushX(nasty)+"</PARTYLEDGERNAME>", 1)
	x = strings.Replace(x, "<NAME>RS/77</NAME>", "<NAME>"+pushX(nasty)+"</NAME>", 1)
	lines := pushLinesFromXML(t, x, pushEmuFor(0))
	_, e := pushXMLOf(t, lines)
	nasty = strings.ReplaceAll(nasty, "\x04", "") // Tally's own answer carries &#4;, which the bridge drops (cleanXML) as it does from Tally's XML
	if e.s("party") != nasty || e.rec("L1B1")["name"] != nasty || e.n("nL") != 5 {
		t.Fatalf("a value holding the separators: %q / %q / nL %d", e.s("party"), e.rec("L1B1")["name"], e.n("nL"))
	}
	// a length that is off: not the entry (never a guess)
	bad := strings.Replace(lines[0], "|party:", "|party:1", 1)
	if p, _ := pushPayload(bad); p != "" {
		if _, err := pushParse([]string{p}); err == nil {
			t.Fatal("a wrong length was taken")
		}
	}
	// the cap: the 50-item invoice in parts, each a complete recorder line no longer than the cap and one record
	big := readText(filepath.Join("testdata", "real-tally-7.1", "231", "s10-sales-50-items.entry.xml"))
	one := pushLinesFromXML(t, big, pushEmuFor(0))
	parts := pushLinesFromXML(t, big, pushEmuFor(2000))
	if len(one) < 2 || len(parts) < 10 {
		t.Fatalf("parts: %d at 16000, %d at 2000", len(one), len(parts))
	}
	for i, l := range parts {
		r, ok := parseRecorderLine(l)
		p, pok := pushPayload(l)
		if !ok || !pok || r.Ev != pushEv || !reLiveDone.MatchString(l) || !strings.Contains(p, fmt.Sprintf("FE1|part=%d|", i+1)) {
			t.Fatalf("part %d is not a complete line: %q", i+1, cut(l, 200))
		}
		if (i == len(parts)-1) != strings.HasSuffix(p, "|end=1") || (i < len(parts)-1) != strings.HasSuffix(p, "|more=1") {
			t.Fatalf("part %d's end: %q", i+1, p[maxI(0, len(p)-20):])
		}
		if n := u16len(p); n > 2000+1500 {
			t.Fatalf("part %d: %d characters", i+1, n)
		}
	}
	a, _ := pushXMLOf(t, one)
	b, _ := pushXMLOf(t, parts)
	if a != b {
		t.Fatal("the entry in parts differs from the entry in one line")
	}
	// a part missing, out of order, or the last missing: no entry
	for _, c := range [][]string{append(append([]string{}, parts[:2]...), parts[3:]...), append([]string{parts[1]}, parts[2:]...), parts[:len(parts)-1]} {
		var ps []string
		for _, l := range c {
			p, _ := pushPayload(l)
			ps = append(ps, p)
		}
		if _, err := pushParse(ps); err == nil {
			t.Fatal("an entry with a part missing was taken")
		}
	}
}

// --- 3. the GUID rule, as Tally's own export of run 37580283590 (TallyPrime 7.1, 30,012-voucher company) has it
func TestPushGUIDRule(t *testing.T) {
	var ids []struct {
		Guid string `json:"guid"`
		Mid  int64  `json:"mid"`
	}
	if err := json.Unmarshal([]byte(readText(filepath.Join("testdata", "push233", "tally-ids-7.1-run37580283590.json"))), &ids); err != nil || len(ids) < 20 {
		t.Fatalf("fixture: %v %d", err, len(ids))
	}
	for _, v := range ids {
		cg := v.Guid[:strings.LastIndex(v.Guid, "-")]
		if g := pushGUID(cg, fmt.Sprint(v.Mid)); g != v.Guid {
			t.Errorf("MasterID %d: %s, Tally's %s", v.Mid, g, v.Guid)
		}
	}
	cg := "fd3c65f7-3356-4b09-8177-48e9c18577ed"
	for mid, want := range map[string]string{"14": cg + "-0000000e", "26305": cg + "-000066c1", "4294967295": cg + "-ffffffff", "4294967296": cg + "-100000000"} {
		if g := pushGUID(cg, mid); g != want {
			t.Errorf("%s: %s, want %s (lower case, 8 digits at least)", mid, g, want)
		}
	}
	for _, c := range []struct{ cg, mid string }{{"", "14"}, {"noguid", "14"}, {cg, "0"}, {cg, ""}, {cg, "x"}} {
		if g := pushGUID(c.cg, c.mid); g != "" {
			t.Errorf("%q %q: %s", c.cg, c.mid, g)
		}
	}
	// the cross-check against the GUIDs the lines carry
	g := cg + "-0000000e"
	for _, c := range []struct {
		ev, line string
		ok       bool
	}{
		{"altered", g, true}, {"altered", strings.ToUpper(g), true}, {"created", cg + "-00000000", true}, {"created", "", true},
		{"created", cg + "-0000000d", true},  // a new entry copied from another (Alt+2): the form keeps the source's GUID
		{"altered", cg + "-0000000d", false}, // an alteration whose GUID is not its MasterID's: Tally is asked
		{"altered", "aaaaaaaa-3356-4b09-8177-48e9c18577ed-0000000e", false},
		{"created", "aaaaaaaa-3356-4b09-8177-48e9c18577ed-00000001", false},
	} {
		got, why := pushGuidCheck(cg, "14", c.ev, c.line)
		if (why == "") != c.ok || (c.ok && got != g) {
			t.Errorf("%s with the line's GUID %q: %q %q", c.ev, c.line, got, why)
		}
	}
}

// --- 4. equivalence: a line built from a captured voucher gives the voucher Tally gave the entry request (shared fixture:
// testdata/push233/*.lines.json and *.push.xml, read by tests/run_push233_parse.mjs with the cloud's parse.js)
func TestPushEquivalenceWithCapture(t *testing.T) {
	update := os.Getenv("PUSH233_UPDATE") == "1"
	src := pushSources(t)
	var names []string
	for n := range src {
		names = append(names, n)
	}
	sort.Strings(names)
	man := M{}
	for _, n := range names {
		x := readText(src[n])
		lines := pushLinesFromXML(t, x, pushEmuFor(0))
		built, _ := pushXMLOf(t, lines)
		got, want := pushCanon(t, built), pushCanon(t, x)
		if jsonText(got) != jsonText(want) {
			t.Errorf("%s: the entry from the line differs from Tally's:\n%s\n%s", n, jsonText(got), jsonText(want))
		}
		lf, xf := filepath.Join("testdata", "push233", n+".lines.json"), filepath.Join("testdata", "push233", n+".push.xml")
		rel, _ := filepath.Rel("testdata", src[n])
		man[n] = M{"capture": filepath.ToSlash(rel), "lines": n + ".lines.json", "push": n + ".push.xml"}
		lj, _ := json.MarshalIndent(lines, "", " ")
		if update {
			_ = os.WriteFile(lf, append(lj, '\n'), 0o644)
			_ = os.WriteFile(xf, []byte(built+"\n"), 0o644)
			continue
		}
		if readText(lf) != string(lj)+"\n" {
			t.Errorf("%s: the add-on's lines changed (PUSH233_UPDATE=1 rewrites the fixture)", n)
		}
		if readText(xf) != built+"\n" {
			t.Errorf("%s: the bridge's XML changed (PUSH233_UPDATE=1 rewrites the fixture)", n)
		}
	}
	mj, _ := json.MarshalIndent(man, "", " ")
	mf := filepath.Join("testdata", "push233", "manifest.json")
	if update {
		_ = os.WriteFile(mf, append(mj, '\n'), 0o644)
	} else if readText(mf) != string(mj)+"\n" {
		t.Error("testdata/push233/manifest.json changed (PUSH233_UPDATE=1 rewrites it)")
	}
}

// --- the stand: a bridge with a stand Tally and a stand cloud, the lines in the user's own file

// a voucher of the stand Tally as the add-on writes its save: pre, post, then the full entry (from Tally's own XML of it)
func pushSave(t *testing.T, f *standTally, v *tVch, created bool, win string) []string {
	t.Helper()
	f.mu.Lock()
	x := v.xml()
	f.mu.Unlock()
	ts := nowFn().In(liveZone)
	pre, post := v.guid, v.guid
	aid := fmt.Sprint(v.alter - 1)
	mid := v.master
	if created {
		pre, aid = b220CoGUID+"-00000000", "0"
		post = pre
	}
	h := func(ev, g, m, a string) string {
		s := ts.Format("2-Jan-06 15:04")
		return "FCR1|ev=" + ev + "|t0=" + s + "|tw=" + s + "|w=" + win + "|cguid=" + b220CoGUID + "|cname=" + zz + "|user=owner|obj=Voucher|guid=" + g + "|mid=" + m +
			"|aid=" + a + "|vtype=" + v.typ + "|vno=" + v.no + "|vdate=" + emuDate(v.date) + "|name=|parent=|narr=" + v.narr + "|t1=" + s + "|src=live"
	}
	preMid := mid
	if created {
		preMid = "0"
	}
	o := pushEmu{cguid: b220CoGUID, cname: zz, tuser: "owner", winUser: win, at: ts, formGuid: post, formAid: aid}
	return append([]string{h("voucher_accept_pre", pre, preMid, aid), h("voucher_accept_post", post, mid, aid)}, pushLinesFromXML(t, x, o)...)
}

func pushTallyAsks(f *standTally) int { return f.n(vchByMasterID) + f.n(vchByNumberID) }

// --- 5. a full line: NO entry request at the stand; the cloud gets the entry in full, its GUID by the rule, ledger
// totals zero; the heads go with it, never on their own; an alteration is a full entry again
func TestPushNoTallyRequestForFullLine(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	noteStartPoint(zz, b220CoGUID, 5, 1)
	td := today()
	v := f.add(td, "Party A", "PA-1", "rent | march", "-1180.00")
	p := liveFilePath(rec, "")
	n0 := len(f.ids())
	liveAppend(t, p, pushSave(t, f, v, true, "")...)
	readAndUploadAll(t)
	if k := pushTallyAsks(f); k != 0 || len(f.ids()) != n0 {
		t.Fatalf("Tally was asked: %v", f.ids()[n0:])
	}
	sent := c.recSent()
	if len(sent) != 1 {
		t.Fatalf("sent %d lines: %v", len(sent), sent)
	}
	l := sent[0]
	x := str(l["xml"])
	if str(l["event"]) != "created" || l["full"] != true || l["push"] != true || toI64(l["push_seq"]) <= 0 || l["alter_id"] != nil ||
		str(l["object_guid"]) != pushGUID(b220CoGUID, v.master) || str(l["object_guid"]) != v.guid || str(l["master_id"]) != v.master {
		t.Fatalf("the line: %v", l)
	}
	if !strings.HasPrefix(x, "<VOUCHER ") || tagValue(x, "GUID") != v.guid || strings.Contains(x, "<ALTERID") {
		t.Fatalf("the body: %s", x)
	}
	var sum int64
	for _, a := range tagValues(x, "AMOUNT") {
		if pp, ok := paise(a); ok {
			if strings.HasPrefix(a, "-") {
				pp = -pp
			}
			sum += pp
		}
	}
	if sum != 0 || len(tagValues(x, "LEDGERNAME")) < 2 {
		t.Fatalf("ledger totals %d paise: %s", sum, x)
	}
	// the heads lines went with it: re-read after a restart sends nothing
	liveResetState()
	readAndUploadAll(t)
	if len(c.recSent()) != 1 {
		t.Fatalf("after a restart: %d sent", len(c.recSent()))
	}
	// the alteration: a full entry again, "altered", a later push_seq
	nowFn = func() time.Time { return time.Now().Add(time.Minute) }
	t.Cleanup(func() { nowFn = time.Now })
	v.narr = "rent | march, corrected"
	v.alter++
	liveAppend(t, p, pushSave(t, f, v, false, "")...)
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 2 || str(sent[1]["event"]) != "altered" || sent[1]["full"] != true || toI64(sent[1]["push_seq"]) <= toI64(sent[0]["push_seq"]) ||
		str(sent[1]["object_guid"]) != v.guid || !strings.Contains(str(sent[1]["xml"]), "corrected") {
		t.Fatalf("the alteration: %v", sent[len(sent)-1])
	}
	if pushTallyAsks(f) != 0 {
		t.Fatalf("Tally was asked: %v", f.ids()[n0:])
	}
	// a delete: heads with the MasterID, unchanged (asked of this bridge's Tally by its MasterID, as 2.3.0 does)
	liveAppend(t, p, liveLine("before_delete", "Voucher", v.guid, v.master, "", v.typ, v.no, td, "", "", ""), liveLine("after_delete", "Voucher", v.guid, v.master, "", v.typ, v.no, td, "", "", ""))
	f.mu.Lock()
	for i, x := range f.vch {
		if x == v {
			f.vch = append(f.vch[:i], f.vch[i+1:]...)
			break
		}
	}
	f.mu.Unlock()
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 3 || str(sent[2]["event"]) != "deleted" || sent[2]["push"] != nil {
		t.Fatalf("the delete: %v", sent[len(sent)-1])
	}
}

// --- 6. an older add-on (heads only): today's 2.3.2 route, the entry asked of Tally by its MasterID; a full line that
// cannot be taken (cut short, a wrong length, another company's GUID) takes the same route
func TestPushFallbackOldLines(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderFullWaitMs":50`)
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	td := today()
	v := f.add(td, "Party B", "PB-1", "old add-on", "-500.00")
	p := liveFilePath(rec, "")
	all := pushSave(t, f, v, true, "")
	liveAppend(t, p, all[:2]...) // pre and post only
	liveReadOnce()
	if len(liveQueue()) != 1 {
		t.Fatal("an older add-on's save waited: its file never gave a full entry, so today's timing is kept")
	}
	readAndUploadAll(t)
	if f.n(vchByMasterID) != 1 {
		t.Fatalf("the entry request: %v", f.ids())
	}
	sent := c.recSent()
	if len(sent) != 1 || sent[0]["push"] != nil || tagValue(str(sent[0]["xml"]), "GUID") != v.guid {
		t.Fatalf("the old route: %v", sent)
	}
	// a full line cut short (its last part never comes), and one whose length is off: the 2.3.2 route each
	w := f.add(td, "Party C", "PC-1", "cut short", "-700.00")
	l := pushSave(t, f, w, true, "")
	full := l[2]
	cutL := strings.Replace(full, "|end=1|", "|more=1|", 1)
	liveAppend(t, p, l[0], l[1], cutL)
	liveReadOnce()
	if len(liveQueue()) != 0 {
		t.Fatal("in the new add-on's file a save waits for its full entry")
	}
	time.Sleep(80 * time.Millisecond)
	nowFn = func() time.Time { return time.Now().Add(11 * time.Second) }
	t.Cleanup(func() { nowFn = time.Now })
	readAndUploadAll(t)
	nowFn = time.Now
	u := f.add(td, "Party D", "PD-1", "bad length", "-900.00")
	l = pushSave(t, f, u, true, "")
	liveAppend(t, p, l[0], l[1], strings.Replace(l[2], "|party:", "|party:9", 1))
	readAndUploadAll(t)
	time.Sleep(80 * time.Millisecond)
	readAndUploadAll(t)
	if f.n(vchByMasterID) != 3 {
		t.Fatalf("entry requests: %d (%v)", f.n(vchByMasterID), f.ids())
	}
	sent = c.recSent()
	if len(sent) != 3 || sent[1]["push"] != nil || sent[2]["push"] != nil || str(sent[1]["object_guid"]) != w.guid || str(sent[2]["object_guid"]) != u.guid {
		t.Fatalf("sent: %v", sent)
	}
	if logLines("the full entry is not taken") < 1 || logLines("Tally is asked for the entry as before") < 2 {
		t.Fatal("the fallback is not said in the log")
	}
}

// security L6 (2.2.2) holds for a full entry: a company whose starting point is not recorded has nothing taken; its
// full line goes the 2.3.2 way (held there with the same words)
func TestPushNeedsStartingPoint(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	v := f.add(today(), "Party S", "PS-1", "no starting point", "-10.00")
	liveAppend(t, liveFilePath(rec, ""), pushSave(t, f, v, true, "")...)
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || sent[0]["push"] != nil || str(sent[0]["xml"]) != "" || !strings.Contains(str(sent[0]["heldWhy"]), "starting point") || pushTallyAsks(f) != 0 {
		t.Fatalf("without a starting point: %v (asks %d)", sent, pushTallyAsks(f))
	}
}

// --- 7. each Windows user's own file: the full entry goes from its user's bridge only; the other user's file is never opened
func TestPushPerUserFiles(t *testing.T) {
	for _, me := range []string{"anshul", "Ranjeet"} {
		t.Run(me, func(t *testing.T) {
			rec, f, c := liveBridge(t, "")
			ufAs(t, "user", `NWS144\`+me)
			noteStartPoint(zz, b220CoGUID, 5, 1)
			td := today()
			va := f.add(td, "Party A", "UA-1", "anshul's", "-100.00")
			vr := f.add(td, "Party R", "UR-1", "Ranjeet's", "-200.00")
			liveAppend(t, ufFile(rec, b220CoGUID, "anshul"), pushSave(t, f, va, true, "anshul")...)
			liveAppend(t, ufFile(rec, b220CoGUID, "Ranjeet"), pushSave(t, f, vr, true, "Ranjeet")...)
			readAndUploadAll(t)
			sent := c.recSent()
			want := map[string]*tVch{"anshul": va, "Ranjeet": vr}[me]
			if len(sent) != 1 || str(sent[0]["object_guid"]) != want.guid || sent[0]["push"] != true || pushTallyAsks(f) != 0 {
				t.Fatalf("the bridge of %s sent %v (asks %d)", me, sent, pushTallyAsks(f))
			}
			other := map[string]string{"anshul": "Ranjeet", "Ranjeet": "anshul"}[me]
			live.mu.Lock()
			_, opened := live.files[filepath.Base(ufFile(rec, b220CoGUID, other))]
			live.mu.Unlock()
			if opened {
				t.Fatalf("the bridge of %s opened %s's file", me, other)
			}
		})
	}
}

// --- 8. the order: push_seq strictly rising; the light check's counter only when unambiguous, never a request of its own
func TestPushOrderAndCounter(t *testing.T) {
	a, b := livePushSeq(1000), livePushSeq(1000)
	if b <= a || livePushSeq(10) <= b {
		t.Fatalf("push_seq: %d %d", a, b)
	}
	rec, f, c := liveBridge(t, "")
	noteStartPoint(zz, b220CoGUID, 5, 1)
	td := today()
	base := time.Now()
	at := func(d time.Duration) { nowFn = func() time.Time { return base.Add(d) } }
	t.Cleanup(func() { nowFn = time.Now })
	at(0)
	livePushCounter(zz, 100) // the first check: nothing to compare
	at(time.Minute)
	v := f.add(td, "Party E", "PE-1", "one save", "-300.00")
	liveAppend(t, liveFilePath(rec, ""), pushSave(t, f, v, true, "")...)
	liveReadOnce() // read, not sent yet (the cloud unreachable, say)
	at(10 * time.Minute)
	n0 := len(f.ids())
	livePushCounter(zz, 101) // moved by 1, one save between: Tally's AlterID 101
	if len(f.ids()) != n0 {
		t.Fatal("the counter asked Tally")
	}
	q := liveQueue()
	if len(q) != 1 || q[0].alterId != "101" || tagNum(q[0].xml, "ALTERID") != "101" {
		t.Fatalf("the counter: %+v", q)
	}
	uploadAll(t)
	if s := c.recSent(); len(s) != 1 || toI64(s[0]["alter_id"]) != 101 {
		t.Fatalf("sent: %v", s)
	}
	// moved by 2 (another computer's save), or two saves read here: no AlterID
	at(11 * time.Minute)
	w := f.add(td, "Party F", "PF-1", "two", "-10.00")
	liveAppend(t, liveFilePath(rec, ""), pushSave(t, f, w, true, "")...)
	liveReadOnce()
	at(20 * time.Minute)
	livePushCounter(zz, 103)
	if q := liveQueue(); len(q) != 1 || q[0].alterId != "" {
		t.Fatalf("ambiguous counter taken: %+v", q)
	}
}

// --- 9. the add-on: the full entry after Tally's own save, no read-back, nothing written into Tally, nothing shown
func TestPushAddon(t *testing.T) {
	tdl := readText(filepath.Join("addon", liveAddonName))
	i := strings.Index(tdl, "[#Form: Voucher]")
	form := tdl[i : i+strings.Index(tdl[i:], "\n\n")]
	want := []string{`On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : "voucher_accept_pre"`, `On : Form Accept : Yes          : Form Accept`,
		`On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : "voucher_accept_post"`, `On : Form Accept : @@FCRIsLive : Call : FCRLiveFull : "voucher_full"`}
	var got []string
	for _, l := range strings.Split(form, "\n")[1:] {
		got = append(got, strings.TrimSpace(l))
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("the voucher form's lines:\n%s", strings.Join(got, "\n"))
	}
	fn := tdl[strings.Index(tdl, "[Function: FCRLiveFull]"):]
	fn = fn[:strings.Index(fn, "\n;; ----")]
	code := regexp.MustCompile(`(?m)^\s*;;.*$`).ReplaceAllString(tdl, "")
	// no read-back: no collection of its own, no filter, nothing asked of the company but its GUID (as the heads writer)
	for _, s := range []string{"[Collection", "Filter", "AltVchID", "AltMstID", "Form Accept", "Message", "Query", "Menu", "Execute", "HTTP", "Key :", "Log :",
		"CREATE", "ALTER", "Import", "Export", "Display", "MODIFY", "Set Value"} {
		if strings.Contains(fn, s) {
			t.Errorf("FCRLiveFull has %q", s)
		}
	}
	if strings.Count(code, "[Collection") != 0 {
		t.Error("the add-on defines a collection (a read-back)")
	}
	if strings.Count(fn, "OPEN FILE") != 1 || strings.Count(fn, "CLOSE TARGET FILE") != 1 || !strings.Contains(fn, "RETURN : Yes") || strings.Contains(fn, "RETURN : No") {
		t.Error("one open, one close, every path returns Yes")
	}
	// every free text with its length: the same method on both sides of each "name:" + length + "=" + value
	reLP := regexp.MustCompile(`"\|?~?([a-z]+):" \+ \(\$\$String:\(\$\$StringLength:\(\$\$String:(\$[A-Za-z]+|\(\$\$CollectionField:\$BillNumber:1:EWayBillDetails\))\)\)\) \+ "=" \+ \(\$\$String:(\$[A-Za-z]+|\(\$\$CollectionField:\$BillNumber:1:EWayBillDetails\))\)`)
	lps := reLP.FindAllStringSubmatch(tdl, -1)
	if len(lps) < 40 {
		t.Fatalf("free text with its length: %d", len(lps))
	}
	for _, m := range lps {
		if m[2] != m[3] {
			t.Errorf("%s: length of %s, text of %s", m[1], m[2], m[3])
		}
	}
	// the functions it uses: those proven on a real Tally by the heads writer and the push-design add-on, and $$StringLength
	// (new: the push233 scenario is its first real run)
	ok := map[string]bool{"$$String": true, "$$IsEmpty": true, "$$MachineDate": true, "$$MachineTime": true, "$$CmpUserName": true, "$$SysInfo": true,
		"$$LastResult": true, "$$NumItems": true, "$$CollectionField": true, "$$ZeroFill": true, "$$YearOfDate": true, "$$MonthOfDate": true, "$$DayOfDate": true,
		"$$StringLength": true}
	for _, f := range regexp.MustCompile(`\$\$[A-Za-z]+`).FindAllString(code, -1) {
		if !ok[f] {
			t.Errorf("the add-on uses %s", f)
		}
	}
	// the cap, the parts, and the line's end as an older bridge's reader requires
	for _, s := range []string{"FCRCap", `"|more=1|t1=" + ##vT + "|src=live"`, `"|end=1|t1=" + ##vT + "|src=live"`, `"|name=|parent=|narr=FE1"`, `##vHead + "|part=" + ($$String:##vPart)`,
		`@@FCRFolder + ##vGuid + "-" + @@FCRDay + "-" + @@FCRWinUser + ".txt"`, `"|w=" + @@FCRWinUser`} {
		if !strings.Contains(tdl, s) {
			t.Errorf("the add-on lacks %s", s)
		}
	}
	// the records the bridge reads, each written by the add-on
	for _, s := range []string{`"|L" +`, `"R" +`, `"B" +`, `"K" +`, `"C" +`, `"c" +`, `"T" +`, `"s" +`, `"|I" +`, `"A" +`, `"b" +`, `"|O" +`, `"|SO" +`, `"|SI" +`, `"|CE" +`, `"E" +`, `"p" +`, `"a" +`,
		"SubCategory", "DutyLedger", "GodownName", "BatchName", "PayHeadName", "EmployeeName", "TaxObjectAllocations", "SubCategoryAllocation", "BankAllocations", "BillAllocations"} {
		if !strings.Contains(fn+tdl[:strings.Index(tdl, "[Function: FCRLiveFull]")], s) {
			t.Errorf("the add-on does not write %s", s)
		}
	}
}

// keep the test helpers in use (a stand voucher's XML as Tally's entry request gives it)
var _ = canonAmt

// --- 6b. (after the merge of 2.3.2) a company 2.3.2 marked slow: an older add-on's line keeps 2.3.2's slow-company stop
// (held with its words, nothing asked); a full entry of the same company goes in full, nothing asked either
func TestPushSlowCompanyStopKept(t *testing.T) {
	p, f, c := slow232Bridge(t)
	slowMarkIt(t, p, f)
	retryDue()
	for i := 0; i < 5; i++ {
		liveUploadOnce()
	}
	asks := f.n(vchByMasterID) + f.n(vchByNumberID)
	// an older add-on's save: the 2.3.2 route, its stop kept
	r222Vch(f, 25801, "Journal", "J-25801", "20261005", 54601)
	liveAppend(t, p, slowLine(25801, "07:30")...)
	readAndUploadAll(t)
	if s := slowSentOf(c, 25801); len(s) != 1 || str(s[0]["heldWhy"]) != slowWords || str(s[0]["xml"]) != "" || s[0]["push"] != nil {
		t.Fatalf("an older add-on's line of the marked company: %v", s)
	}
	// the new add-on's save of the same company: its full entry, nothing asked
	v := r222Vch(f, 25802, "Journal", "J-25802", "20261005", 54602)
	f.mu.Lock()
	x := v.xml()
	f.mu.Unlock()
	o := pushEmu{cguid: nwsGUID, cname: nwsCo, tuser: "owner", at: nowFn(), formGuid: v.guid, formAid: "54601"}
	liveAppend(t, p, append([]string{r222Line("voucher_accept_pre", "07:31", v.guid, "25802", "54601", "Journal", "J-25802", "5-Oct-2026", v.narr),
		r222Line("voucher_accept_post", "07:31", v.guid, "25802", "54601", "Journal", "J-25802", "5-Oct-2026", v.narr)}, pushLinesFromXML(t, x, o)...)...)
	readAndUploadAll(t)
	s := slowSentOf(c, 25802)
	if len(s) != 1 || s[0]["push"] != true || s[0]["full"] != true || str(s[0]["object_guid"]) != v.guid || str(s[0]["heldWhy"]) != "" {
		t.Fatalf("the full entry of the marked company: %v", s)
	}
	if n := f.n(vchByMasterID) + f.n(vchByNumberID); n != asks {
		t.Fatalf("Tally was asked: %d entry requests, %d before (%v)", n, asks, f.ids())
	}
}
