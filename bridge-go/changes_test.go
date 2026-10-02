package main

// FinCom Bridge 2.1.5: the baseline once, then only changes by AlterID; never a balance asked of Tally. A stand-in Tally
// that holds made-up books (entries with AlterIDs and lines, ledgers with stored openings, groups) answers the bridge's
// request-only TDL: AlterID-filtered collections, a month's ids, the day book, the company's change counters, the "is it
// free?" probe and (when switched on) the primary-group totals. A stand-in FinCom cloud keeps what the bridge sends.

import (
	"bytes"
	"compress/gzip"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type fVch struct {
	guid, date, typ, no, narr string
	alter                     int64
	lines                     [][2]string // ledger, amount (Tally's sign)
	optional                  bool
}
type fLed struct {
	guid, name, parent, open string
	alter                    int64
}
type fakeTally struct {
	srv       *httptest.Server
	port      int
	mu        sync.Mutex
	booksFrom string
	vch       map[string]*fVch
	led       map[string]*fLed
	grp       map[string][2]any // name -> parent, alter
	reqs      []string
	bodies    []string
	answered  map[string][]int // request id -> entries/masters in each answer
	returned  map[string]int   // guid -> times a change read returned it
	cancelled int
	slow      func(id, body string) time.Duration
}

var (
	reAfter    = regexp.MustCompile(`\$AlterID &gt; (\d+)(?: AND \$AlterID &lt;= (\d+))?`)
	reBalWords = regexp.MustCompile(`(?i)closingbalance|trial balance|group summary|balance sheet|ledger vouchers|TDSDeskKeepBal|TDSDeskBalances|TDSDeskOneLed|TDSDeskTB|\$\$(Closing|Opening)Balance|OnAccountValue`)
)

func (f *fakeTally) count(id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, r := range f.reqs {
		if id == "" || r == id {
			n++
		}
	}
	return n
}
func (f *fakeTally) since(n int) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.reqs[n:]...)
}

// every request sent: none asks Tally for a balance (only FinComTotals may, when the night's check is switched on), and a
// ledger's stored opening is never asked with a period (that would be a balance Tally works out)
func (f *fakeTally) assertNoBalance(t *testing.T, allowTotals bool) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, b := range f.bodies {
		if f.reqs[i] == "FinComTotals" && allowTotals {
			continue
		}
		if m := reBalWords.FindString(b); m != "" {
			t.Fatalf("request %d (%s) asks Tally for a balance (%q): %s", i, f.reqs[i], m, cut(b, 400))
		}
		if strings.Contains(strings.ToUpper(b), "OPENINGBALANCE") && strings.Contains(b, "SVFROMDATE") {
			t.Fatalf("request %d (%s) asks for an opening with a period: %s", i, f.reqs[i], cut(b, 400))
		}
	}
}

func (f *fakeTally) maxVAlter() int64 {
	var m int64
	for _, v := range f.vch {
		if v.alter > m {
			m = v.alter
		}
	}
	return m
}
func (f *fakeTally) maxMAlter() int64 {
	var m int64
	for _, l := range f.led {
		if l.alter > m {
			m = l.alter
		}
	}
	for _, g := range f.grp {
		if a := g[1].(int64); a > m {
			m = a
		}
	}
	return m
}
func (f *fakeTally) sortedVch() []*fVch {
	var a []*fVch
	for _, v := range f.vch {
		a = append(a, v)
	}
	sort.Slice(a, func(i, j int) bool { return a[i].alter < a[j].alter })
	return a
}

// a voucher as a collection gives it (TYPE attributes) or as the day book does (VCHTYPE on the element)
func (v *fVch) xml(collection bool) string {
	t := func(tag, typ, val string) string {
		if collection {
			return fmt.Sprintf(`<%s TYPE="%s">%s</%s>`, tag, typ, val, tag)
		}
		return fmt.Sprintf(`<%s>%s</%s>`, tag, val, tag)
	}
	var b strings.Builder
	if collection {
		b.WriteString(`<VOUCHER NAME="` + v.no + `">`)
	} else {
		b.WriteString(`<VOUCHER REMOTEID="` + v.guid + `" VCHTYPE="` + v.typ + `" ACTION="Create">`)
	}
	b.WriteString(t("DATE", "Date", v.date) + t("GUID", "String", v.guid) + t("ALTERID", "Number", fmt.Sprint(" ", v.alter)) + t("VOUCHERTYPENAME", "String", v.typ) +
		t("VOUCHERNUMBER", "String", v.no) + t("NARRATION", "String", esc(v.narr)) + t("ISOPTIONAL", "Logical", map[bool]string{true: "Yes", false: "No"}[v.optional]) + t("ISCANCELLED", "Logical", "No"))
	for _, l := range v.lines {
		b.WriteString("<ALLLEDGERENTRIES.LIST>" + t("LEDGERNAME", "String", esc(l[0])) + t("AMOUNT", "Amount", l[1]) + "</ALLLEDGERENTRIES.LIST>")
	}
	b.WriteString("</VOUCHER>")
	return b.String()
}

func newFakeTally(t *testing.T, booksFrom string) *fakeTally {
	f := &fakeTally{booksFrom: booksFrom, vch: map[string]*fVch{}, led: map[string]*fLed{}, grp: map[string][2]any{}, answered: map[string][]int{}, returned: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body := string(b)
		id := group(`<ID>([^<]+)</ID>`, body, 1)
		if id == "" {
			id = group(`<REPORTNAME>([^<]+)</REPORTNAME>`, body, 1)
		}
		if strings.Contains(body, "Import Data") {
			id = "Import"
		}
		f.mu.Lock()
		f.reqs = append(f.reqs, id)
		f.bodies = append(f.bodies, body)
		slow := f.slow
		f.mu.Unlock()
		if slow != nil {
			if d := slow(id, body); d > 0 {
				select {
				case <-time.After(d):
				case <-r.Context().Done():
					f.mu.Lock()
					f.cancelled++
					f.mu.Unlock()
					return
				}
			}
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		from, to := group(`<SVFROMDATE>(\d{8})</SVFROMDATE>`, body, 1), group(`<SVTODATE>(\d{8})</SVTODATE>`, body, 1)
		var after, upto int64 = -1, 0
		if m := reAfter.FindStringSubmatch(body); m != nil {
			after, upto = toI64(m[1]), toI64(m[2])
		}
		in := func(a int64) bool { return after < 0 || (a > after && (upto == 0 || a <= upto)) }
		var o strings.Builder
		o.WriteString("<ENVELOPE><BODY><DATA><COLLECTION>")
		n := 0
		switch id {
		case "TDSDeskCompanies", "FinComFree":
			o.WriteString(`<COMPANY NAME="` + zz + `"><NAME>` + zz + `</NAME><STARTINGFROM>` + f.booksFrom + `</STARTINGFROM><BOOKSFROM>` + f.booksFrom + `</BOOKSFROM></COMPANY>`)
		case "TDSDeskKeepCo":
			fmt.Fprintf(&o, `<COMPANY><NAME>%s</NAME><ALTVCHID>%d</ALTVCHID><ALTMSTID>%d</ALTMSTID></COMPANY>`, zz, f.maxVAlter(), f.maxMAlter())
		case "FinComChanged":
			for _, v := range f.sortedVch() {
				if in(v.alter) && (from == "" || (v.date >= from && v.date <= to)) {
					o.WriteString(v.xml(true))
					f.returned[v.guid]++
					n++
				}
			}
		case "FinComChangedLed":
			for _, l := range f.led {
				if in(l.alter) {
					fmt.Fprintf(&o, `<LEDGER NAME="%s"><GUID TYPE="String">%s</GUID><ALTERID TYPE="Number"> %d</ALTERID><PARENT TYPE="String">%s</PARENT><OPENINGBALANCE TYPE="Amount">%s</OPENINGBALANCE></LEDGER>`,
						esc(l.name), l.guid, l.alter, esc(l.parent), l.open)
					n++
				}
			}
		case "FinComChangedGrp":
			for nm, g := range f.grp {
				if in(g[1].(int64)) {
					p := g[0].(string)
					if p == "" {
						p = "&#4; Primary"
					}
					fmt.Fprintf(&o, `<GROUP NAME="%s"><ALTERID> %d</ALTERID><PARENT TYPE="String">%s</PARENT></GROUP>`, esc(nm), g[1].(int64), p)
					n++
				}
			}
		case "FinComDayIds":
			for _, v := range f.sortedVch() {
				if v.date >= from && v.date <= to {
					fmt.Fprintf(&o, `<VOUCHER><GUID>%s</GUID><ALTERID> %d</ALTERID><DATE>%s</DATE><ISOPTIONAL>%s</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED><VOUCHERNUMBER>%s</VOUCHERNUMBER></VOUCHER>`,
						v.guid, v.alter, v.date, map[bool]string{true: "Yes", false: "No"}[v.optional], v.no)
					n++
				}
			}
		case "Day Book":
			o.Reset()
			o.WriteString("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>")
			for _, v := range f.sortedVch() {
				if v.date >= from && v.date <= to && !v.optional {
					o.WriteString("<TALLYMESSAGE>" + v.xml(false) + "</TALLYMESSAGE>")
					n++
				}
			}
			o.WriteString("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
			f.answered[id] = append(f.answered[id], n)
			_, _ = w.Write([]byte(o.String()))
			return
		case "FinComTotals":
			// each primary group's closing: openings and every entry (a stand-in: no year end)
			prim := func(p string) string {
				for i := 0; i < 10; i++ {
					g, ok := f.grp[p]
					if !ok || g[0].(string) == "" {
						return p
					}
					p = g[0].(string)
				}
				return p
			}
			tot := map[string]float64{}
			for _, l := range f.led {
				tot[prim(l.parent)] += num(l.open)
			}
			par := map[string]string{}
			for _, l := range f.led {
				par[l.name] = l.parent
			}
			for _, v := range f.vch {
				if !v.optional {
					for _, ln := range v.lines {
						tot[prim(par[ln[0]])] += num(ln[1])
					}
				}
			}
			for g, v := range tot {
				fmt.Fprintf(&o, `<GROUP NAME="%s"><CLOSINGBALANCE TYPE="Amount">%.2f</CLOSINGBALANCE></GROUP>`, esc(g), v)
			}
		case "Import":
			// a posting: the entry is in Tally now, with the next AlterID
			for _, x := range regexp.MustCompile(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(body, -1) {
				g := fmt.Sprintf("posted-%d", len(f.vch))
				f.vch[g] = &fVch{guid: g, date: group(`<DATE>(\d{8})</DATE>`, x, 1), typ: "Journal", no: g, narr: group(`<NARRATION>([^<]*)</NARRATION>`, x, 1),
					alter: f.maxVAlter() + 1, lines: [][2]string{{"Cash", "-1.00"}, {"Sales", "1.00"}}}
			}
			o.Reset()
			o.WriteString("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>")
			_, _ = w.Write([]byte(o.String()))
			return
		}
		o.WriteString("</COLLECTION></DATA></BODY></ENVELOPE>")
		f.answered[id] = append(f.answered[id], n)
		_, _ = w.Write([]byte(o.String()))
	}))
	f.port = f.srv.Listener.Addr().(*net.TCPAddr).Port
	t.Cleanup(f.srv.Close)
	// the masters: groups, then ledgers with stored openings (AlterIDs 1-8); the entries follow
	f.grp["Current Assets"] = [2]any{"", int64(1)}
	f.grp["Sundry Debtors"] = [2]any{"Current Assets", int64(2)}
	f.grp["Sales Accounts"] = [2]any{"", int64(3)}
	f.grp["Capital Account"] = [2]any{"", int64(4)}
	f.led["l-cash"] = &fLed{"l-cash", "Cash", "Current Assets", "-1000.00", 5}
	f.led["l-px"] = &fLed{"l-px", "Party X", "Sundry Debtors", "-500.00", 6}
	f.led["l-sales"] = &fLed{"l-sales", "Sales", "Sales Accounts", "0.00", 7}
	f.led["l-cap"] = &fLed{"l-cap", "Capital", "Capital Account", "1500.00", 8}
	return f
}

// n entries, one a day from a date, AlterIDs from a, each a sale to Party X
func (f *fakeTally) addEntries(from string, n int, a int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := from
	for i := 0; i < n; i++ {
		g := fmt.Sprintf("v-%05d", a)
		f.vch[g] = &fVch{guid: g, date: d, typ: "Sales", no: fmt.Sprint(a), alter: a, lines: [][2]string{{"Party X", "-100.00"}, {"Sales", "100.00"}}}
		a++
		if d < today() {
			d = addDays(d, 1)
		}
	}
}

// --- a stand-in FinCom cloud (tally-ingest): what the bridge sends is kept, and the lists the bridge compares with
type fakeCloud struct {
	srv   *httptest.Server
	mu    sync.Mutex
	kinds []string
	vch   map[string][2]string // guid -> day, alter
	sync  M
	book  M // sync_get's answer (nil: the cloud holds nothing)
	diff  int
	saved M
	mst   []any
}

func newFakeCloud(t *testing.T) *fakeCloud {
	c := &fakeCloud{vch: map[string][2]string{}, sync: M{}}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		o := parseObj(string(b))
		c.mu.Lock()
		defer c.mu.Unlock()
		k := str(o["kind"])
		c.kinds = append(c.kinds, k)
		out := M{"ok": true}
		take := func(x string) {
			for _, v := range reVchBlock.FindAllString(x, -1) {
				g := cleanGUID(group(`<GUID>([^<]*)</GUID>`, v, 1))
				c.vch[g] = [2]string{group(`<DATE>(\d{8})</DATE>`, v, 1), fmt.Sprint(toI64(group(`<ALTERID>\s*(\d+)`, v, 1)))}
			}
		}
		switch k {
		case "companies":
			out["links"] = M{zz: true}
		case "sync_get":
			bk := M{"lastV": c.sync["lastV"], "lastM": c.sync["lastM"]}
			for kk, v := range c.book {
				bk[kk] = v
			}
			out["book"] = bk
		case "sync_set":
			for _, f := range []string{"lastV", "lastM", "base"} {
				if v, ok := o[f]; ok {
					c.sync[f] = v
				}
			}
		case "days":
			done := []any{}
			for _, x := range arr(o["days"]) {
				d := obj(x)
				raw, _ := base64.StdEncoding.DecodeString(str(d["gz"]))
				zr, err := gzip.NewReader(bytes.NewReader(raw))
				if err != nil {
					continue
				}
				t, _ := io.ReadAll(zr)
				for g, v := range c.vch {
					if v[0] == str(d["day"]) {
						delete(c.vch, g)
					}
				}
				take(string(t))
				done = append(done, d["day"])
			}
			out["done"] = done
		case "vouchers":
			for _, x := range arr(o["vouchers"]) {
				take(str(obj(x)["xml"]))
			}
			out["days"] = []any{}
		case "masters":
			c.mst = append(c.mst, o)
		case "day_ids":
			by := map[string][]string{}
			for g, v := range c.vch {
				if v[0] >= str(o["from"]) && v[0] <= str(o["to"]) {
					by[v[0]] = append(by[v[0]], g+":"+v[1])
				}
			}
			days := []any{}
			for d, p := range by {
				sort.Strings(p)
				h := md5.Sum([]byte(strings.Join(p, ",")))
				days = append(days, []any{d, len(p), hex.EncodeToString(h[:])})
			}
			out["days"] = days
		case "verify":
			out["verify"] = M{"differ": c.diff, "groups": arr(o["groups"])}
		case "verify_save":
			c.saved = obj(o["result"])
			out["verify"] = M{"n": 2}
		}
		_, _ = w.Write([]byte(jsonText(out)))
	}))
	t.Cleanup(c.srv.Close)
	return c
}
func (c *fakeCloud) cfg() string {
	return fmt.Sprintf(`,"CloudUrl":"%s/","CloudKeyGo":"plain:fcd_%s"`, c.srv.URL, strings.Repeat("0", 48))
}
func (c *fakeCloud) count(kind string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, k := range c.kinds {
		if k == kind {
			n++
		}
	}
	return n
}

// a bridge on the stand-in Tally (and cloud), its memory of earlier tests forgotten
func fakeBridge(t *testing.T, f *fakeTally, extra string) string {
	dir := bridgeFor(t, &standIn{port: f.port}, extra)
	cloudMu.Lock()
	cloudLinks, cloudLinksAt, cloudBack, cloudStateAt = map[string]bool{}, time.Time{}, map[string]keepBack{}, map[string]time.Time{}
	cloudMu.Unlock()
	probeMu.Lock()
	probeWhy = map[int]string{}
	probeMu.Unlock()
	whereMu.Lock()
	whereMap = map[string]map[string]string{}
	whereMu.Unlock()
	return dir
}
func runNow(t *testing.T, kind string) {
	t.Helper()
	if !startKeepRun(runReq{kind: kind, why: "test"}) {
		t.Fatal("no run started")
	}
	time.Sleep(50 * time.Millisecond)
	waitIdle(t)
}
func dayHas(company, day, guid string) bool {
	return strings.Contains(readText(filepath.Join(syncFolder(company), "days", day+".xml")), "<GUID>"+guid+"</GUID>")
}

// 1. the baseline: the masters with their stored openings, the day book a month a request; a slice that does not answer
// is halved and the baseline resumes from the last slice saved (the slices before are not read again)
func TestBaselineResumesFromLastSlice(t *testing.T) {
	td := today()
	start := fromTallyDate(td).AddDate(0, -2, 0).Format("200601") + "01" // three months: two whole, this one to today
	f := newFakeTally(t, start)
	f.addEntries(start, 40, 101)
	second := nextYm(start[:6]) + "01"
	var once sync.Once
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == "Day Book" && strings.Contains(body, "<SVFROMDATE>"+second+"</SVFROMDATE>") {
			once.Do(func() { d = 3 * time.Second }) // the second month does not answer the first time
		}
		return d
	}
	fakeBridge(t, f, `,"TallyMaxSec":1,"KeepBackoffSec":1,"KeepModes":{"ZZ TEST":"bridge"}`)
	k := &keepRun{tc: &TC{copier: true}, kind: "now", told: map[string]bool{}, id: "r1", views: map[string]M{}}
	var err error
	for i := 0; i < 5; i++ {
		if err = k.step(zz, f.port, start); err != nil {
			break
		}
	}
	if err == nil || !strings.Contains(err.Error(), "the next try reads 15 day(s) from "+second) {
		t.Fatalf("the failing slice: %v", err)
	}
	st := readKeepState(syncFolder(zz))
	if str(st["next"]) != second || str(st["phase"]) != "base" || !truthy(st["baseMasters"]) {
		t.Fatalf("the slices before were not kept: %v", st)
	}
	bal := readObjFile(filepath.Join(syncFolder(zz), "balances.json"))
	if bal == nil || len(arr(bal["ledgers"])) != 4 || str(bal["openAsOn"]) != addDays(start, -1) {
		t.Fatalf("the stored openings: %v", bal)
	}
	// later (Tally free again): from the last slice saved, on to the end
	coolMu.Lock()
	tallyCool = map[int]cool{}
	coolMu.Unlock()
	for i := 0; i < 20 && str(readKeepState(syncFolder(zz))["phase"]) != "live"; i++ {
		if err := k.step(zz, f.port, start); err != nil {
			t.Fatalf("resumed: %v", err)
		}
	}
	st = readKeepState(syncFolder(zz))
	if str(st["phase"]) != "live" || toI64(st["lastV"]) != 140 || toI64(st["lastM"]) != 8 || !truthy(st["localDays"]) {
		t.Fatalf("baseline done: %v", st)
	}
	firstSlices := 0
	f.mu.Lock()
	for i, b := range f.bodies {
		if f.reqs[i] == "Day Book" && strings.Contains(b, "<SVFROMDATE>"+start+"</SVFROMDATE>") {
			firstSlices++
		}
	}
	f.mu.Unlock()
	if firstSlices != 1 {
		t.Fatalf("the first month was read %d times: the work was thrown away", firstSlices)
	}
	for i := 0; i < 40; i++ {
		v := f.vch[fmt.Sprintf("v-%05d", 101+i)]
		if !dayHas(zz, v.date, v.guid) {
			t.Fatalf("%s of %s is not in the copy", v.guid, v.date)
		}
	}
	// balances worked out here from the stored openings and the entries: Party X -500 - 40 x 100
	b, err := heldLedgerBalance(zz, "Party X", start, td, false)
	if err != nil || str(b["open"]) != "-500.00" || str(b["close"]) != "-4500.00" {
		t.Fatalf("the balance from the copy: %v %v", b, err)
	}
	f.assertNoBalance(t, false)
}

// 2. after the baseline only what changed: entries and masters with an AlterID above the last one held, about 200 a
// request, continuing to Tally's own last number; nothing at or below it is read
func TestOnlyChangesAboveAlterID(t *testing.T) {
	td := today()
	start := fromTallyDate(td).Format("200601") + "01"
	f := newFakeTally(t, start)
	f.addEntries(start, 450, 101) // AlterIDs 101-550
	fakeBridge(t, f, `,"KeepModes":{"ZZ TEST":"bridge"}`)
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	saveKeepState(dir, M{"company": zz, "from": start, "next": addDays(td, 1), "phase": "live", "lastV": 150, "lastM": 6, "localDays": true, "months": M{}, "skipped": []any{}})
	_ = saveFile(filepath.Join(dir, "balances.json"), jsonText(M{"ok": true, "from": start, "openAsOn": addDays(start, -1), "ledgers": []any{}}))
	// a master changed in Tally: Party X's stored opening, and a new ledger
	f.mu.Lock()
	f.led["l-px"].open, f.led["l-px"].alter = "-700.00", 551
	f.led["l-new"] = &fLed{"l-new", "Bank Z", "Current Assets", "-25.00", 552}
	f.mu.Unlock()
	runNow(t, "light")
	st := readKeepState(dir)
	if toI64(st["lastV"]) != 550 || toI64(st["lastM"]) != 552 {
		t.Fatalf("the last AlterIDs: %v %v", st["lastV"], st["lastM"])
	}
	f.mu.Lock()
	for g, n := range f.returned {
		if toI64(strings.TrimPrefix(g, "v-")) <= 150 {
			t.Errorf("%s (at or below the last AlterID held) was read", g)
		}
		if n != 1 {
			t.Errorf("%s was read %d times", g, n)
		}
	}
	if len(f.returned) != 400 {
		t.Errorf("%d changed entries read, want 400", len(f.returned))
	}
	ans := append([]int{}, f.answered["FinComChanged"]...)
	ledAns := append([]int{}, f.answered["FinComChangedLed"]...)
	f.mu.Unlock()
	if len(ans) < 2 {
		t.Fatalf("one request for 400 changes: %v", ans)
	}
	for _, n := range ans {
		if n > 200 {
			t.Fatalf("a change read answered %d entries (cap 200): %v", n, ans)
		}
	}
	if len(ledAns) == 0 || ledAns[0] != 2 {
		t.Fatalf("the masters read: %v (want the 2 changed only)", ledAns)
	}
	if !dayHas(zz, f.vch["v-00400"].date, "v-00400") {
		t.Fatal("a changed entry is not in the copy")
	}
	// Party X's stored opening moved by -200: so did the opening kept here; Bank Z came with its own
	bal := readObjFile(filepath.Join(dir, "balances.json"))
	got := map[string]string{}
	for _, x := range arr(bal["ledgers"]) {
		got[str(obj(x)["name"])] = str(obj(x)["open"])
	}
	if got["Bank Z"] != "-25.00" {
		t.Fatalf("openings: %v", got)
	}
	// nothing changed since: one tiny request (the counters), nothing more
	n0 := f.count("")
	evMu.Lock()
	openSeen = map[string]time.Time{}
	evMu.Unlock()
	runNow(t, "light")
	if s := f.since(n0); len(s) != 2 || s[0] != "TDSDeskCompanies" || s[1] != "TDSDeskKeepCo" {
		t.Fatalf("nothing changed, yet: %v", s)
	}
	f.assertNoBalance(t, false)
}

// 3. a deleted entry: found by the per-day ids and count (no amounts) on Update now, and only its day read again; the
// cloud (FinCom's copy) loses it
func TestDeletedVoucherFoundByDayCheck(t *testing.T) {
	td := today()
	start := fromTallyDate(td).Format("200601") + "01"
	f := newFakeTally(t, start)
	f.addEntries(start, 10, 101)
	c := newFakeCloud(t)
	fakeBridge(t, f, `,"KeepModes":{"ZZ TEST":"bridge"}`+c.cfg())
	runNow(t, "now") // the baseline (the cloud holds nothing yet)
	dir := syncFolder(zz)
	if st := readKeepState(dir); str(st["phase"]) != "live" {
		t.Fatalf("baseline: %v", st)
	}
	c.mu.Lock()
	held := len(c.vch)
	c.mu.Unlock()
	if held != 10 {
		t.Fatalf("the cloud holds %d entries", held)
	}
	// deleted in Tally: no change number shows it
	f.mu.Lock()
	gone := f.vch["v-00104"]
	delete(f.vch, "v-00104")
	f.mu.Unlock()
	n0 := f.count("")
	runNow(t, "now")
	var dayBooks []string
	f.mu.Lock()
	for i := n0; i < len(f.reqs); i++ {
		if f.reqs[i] == "Day Book" {
			dayBooks = append(dayBooks, group(`<SVFROMDATE>(\d{8})`, f.bodies[i], 1)+"-"+group(`<SVTODATE>(\d{8})`, f.bodies[i], 1))
		}
	}
	f.mu.Unlock()
	if len(dayBooks) != 1 || dayBooks[0] != gone.date+"-"+gone.date {
		t.Fatalf("days read again: %v (want only %s)", dayBooks, gone.date)
	}
	if f.count("FinComChanged") != 0 {
		t.Fatal("a change read with nothing changed")
	}
	if dayHas(zz, gone.date, "v-00104") {
		t.Fatal("the deleted entry is still in the copy")
	}
	c.mu.Lock()
	_, still := c.vch["v-00104"]
	c.mu.Unlock()
	if still {
		t.Fatal("the deleted entry is still in FinCom's cloud")
	}
	// the last AlterIDs are kept in the cloud
	if toI64(c.sync["lastV"]) != 110 || toI64(c.sync["lastM"]) != 8 {
		t.Fatalf("the cloud's last AlterIDs: %v", c.sync)
	}
	// once more: the day is the same now, nothing read again
	n1 := f.count("Day Book")
	runNow(t, "now")
	if f.count("Day Book") != n1 {
		t.Fatal("a day read again with nothing different")
	}
	f.assertNoBalance(t, false)
}

// 4. the night's totals check: off by default (no balance asked at all); switched on, one request, only on the nightly
// run; when the totals differ the days that differ are found from the lists and FinCom is told (nothing read again)
func TestNightTotalsOneRequestOnlyAtNight(t *testing.T) {
	td := today()
	start := fromTallyDate(td).Format("200601") + "01"
	f := newFakeTally(t, start)
	f.addEntries(start, 5, 101)
	c := newFakeCloud(t)
	fakeBridge(t, f, `,"KeepModes":{"ZZ TEST":"bridge"}`+c.cfg())
	runNow(t, "now")
	runNow(t, "nightly")
	if f.count("FinComTotals") != 0 || c.count("verify") != 0 {
		t.Fatal("the totals were asked with the check switched off")
	}
	f.assertNoBalance(t, false)
	setCfg("NightlyTotals", true)
	runNow(t, "now")
	if f.count("FinComTotals") != 0 {
		t.Fatal("the totals were asked by Update now")
	}
	c.mu.Lock()
	c.diff = 1
	c.mu.Unlock()
	// an entry the cloud lacks: its day differs
	f.mu.Lock()
	f.vch["v-x"] = &fVch{guid: "v-x", date: start, typ: "Sales", no: "x", alter: 0, lines: [][2]string{{"Party X", "-1.00"}, {"Sales", "1.00"}}}
	f.mu.Unlock()
	n0 := f.count("Day Book")
	runNow(t, "nightly")
	if n := f.count("FinComTotals"); n != 1 {
		t.Fatalf("the night's check sent %d totals requests, want 1", n)
	}
	c.mu.Lock()
	saved := c.saved
	c.mu.Unlock()
	if saved == nil || toInt(saved["differ"]) != 1 || !contains(strs(saved["days"]), start) {
		t.Fatalf("FinCom was not told the days to check: %v", saved)
	}
	f.assertNoBalance(t, true)
	_ = n0
	// "only at night": the nightly run starts only in its window
	day := time.Now()
	if due, _ := nightlyDue(time.Date(day.Year(), day.Month(), day.Day(), 11, 0, 0, 0, time.Local)); due {
		t.Fatal("the nightly run is due by day")
	}
}

// 5. a posting during a background read goes at once: the read is stopped (its request closed), the posting is sent
// and answered, and the read resumes from the last AlterID saved
func TestPostingNeverRefusedForARead(t *testing.T) {
	td := today()
	start := fromTallyDate(td).Format("200601") + "01"
	f := newFakeTally(t, start)
	f.addEntries(start, 300, 101)
	var once sync.Once
	slowStarted := make(chan struct{})
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == "FinComChanged" && strings.Contains(body, "$AlterID &gt; 300") {
			once.Do(func() { d = 20 * time.Second; close(slowStarted) })
		}
		return d
	}
	fakeBridge(t, f, `,"TallyMaxSec":25,"KeepModes":{"ZZ TEST":"bridge"}`)
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	saveKeepState(dir, M{"company": zz, "from": start, "next": addDays(td, 1), "phase": "live", "lastV": 100, "lastM": 8, "localDays": true, "months": M{}, "skipped": []any{}})
	wakeUpdate("")
	select {
	case <-slowStarted:
	case <-time.After(15 * time.Second):
		t.Fatalf("the read did not reach AlterID 300: %v", f.since(0))
	}
	time.Sleep(300 * time.Millisecond)
	t0 := time.Now()
	res, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "v1", "xml": "<VOUCHER><DATE>" + td + "</DATE><NARRATION>TDSDesk:v1</NARRATION></VOUCHER>"}}})
	if err != nil {
		t.Fatalf("the posting was refused: %v", err)
	}
	if took := time.Since(t0); took > 4*time.Second {
		t.Fatalf("the posting waited %s for the read", took)
	}
	if r := obj(arr(res["results"])[0]); r["ok"] != true {
		t.Fatalf("not posted: %v", r)
	}
	f.mu.Lock()
	c := f.cancelled
	f.mu.Unlock()
	if c < 1 {
		t.Fatal("the read's request to Tally was not closed")
	}
	waitIdle(t)
	// on to the end, and the entry just posted came in with the change read (AlterID 401)
	if st := readKeepState(dir); toI64(st["lastV"]) != 401 || !dayHas(zz, td, "posted-300") {
		t.Fatalf("the read did not resume and finish: lastV %v", st["lastV"])
	}
	// the windows before the stopped one were not read again
	f.mu.Lock()
	n := 0
	for i, b := range f.bodies {
		if f.reqs[i] == "FinComChanged" && strings.Contains(b, "$AlterID &gt; 100 ") {
			n++
		}
	}
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("the first window was read %d times", n)
	}
	f.assertNoBalance(t, false)
}

// 6. after a request that did not answer (Tally keeps working on it), nothing heavy goes until the "is it free?" probe
// answers: the probe alone while Tally is still busy, then the request
func TestTimeoutThenOnlyProbe(t *testing.T) {
	td := today()
	f := newFakeTally(t, td)
	f.addEntries(td, 3, 101)
	busy := true
	f.slow = func(id, body string) time.Duration {
		if id == "FinComChanged" && len(f.answered["FinComChanged"]) == 0 && f.cancelled == 0 {
			return 3 * time.Second
		}
		if id == "FinComFree" && busy {
			return 3 * time.Second
		}
		return 0
	}
	fakeBridge(t, f, `,"TallyMaxSec":1,"TallyProbeSec":1`)
	tc := &TC{copier: true}
	heavy := changedVouchersRequest(zz, td, td, 0, 200)
	if _, err := invokeTally(tc, f.port, heavy, 0); err == nil {
		t.Fatal("the slow request answered")
	}
	// the cool-down over, Tally still busy: only the probe is sent, and nothing else
	clearCool := func() { coolMu.Lock(); tallyCool = map[int]cool{}; coolMu.Unlock() }
	clearCool()
	n0 := f.count("")
	_, err := invokeTally(tc, f.port, heavy, 0)
	if err == nil || !isBusyErr(err) {
		t.Fatalf("a busy Tally: %v", err)
	}
	if s := f.since(n0); len(s) != 1 || s[0] != "FinComFree" {
		t.Fatalf("after a timeout, sent: %v (want the probe only)", s)
	}
	// FinCom's own request waits for the probe too (Tally did not answer)
	clearCool()
	n0 = f.count("")
	if _, err := getLedgerNames(fin, zz, f.port); err == nil || !isBusyErr(err) {
		t.Fatalf("FinCom's request with Tally still busy: %v", err)
	}
	if s := f.since(n0); len(s) != 1 || s[0] != "FinComFree" {
		t.Fatalf("FinCom's request after a timeout: %v", s)
	}
	// Tally free: the probe answers, then the request goes
	busy = false
	clearCool()
	n0 = f.count("")
	if _, err := invokeTally(tc, f.port, heavy, 0); err != nil {
		t.Fatalf("Tally free: %v", err)
	}
	if s := f.since(n0); len(s) != 2 || s[0] != "FinComFree" || s[1] != "FinComChanged" {
		t.Fatalf("Tally free: %v", s)
	}
	// and no probe once Tally has answered
	n0 = f.count("")
	_, _ = invokeTally(tc, f.port, heavy, 0)
	if s := f.since(n0); len(s) != 1 {
		t.Fatalf("a probe with Tally answering: %v", s)
	}
}

// 7. every kind of request, one after the other: none asks Tally for a balance, and the bridge's balance answers come
// from the copy (no request to Tally at all)
func TestNoRequestAsksForABalance(t *testing.T) {
	td := today()
	start := fromTallyDate(td).AddDate(0, -1, 0).Format("200601") + "01"
	f := newFakeTally(t, start)
	f.addEntries(start, 30, 101)
	c := newFakeCloud(t)
	fakeBridge(t, f, `,"KeepModes":{"ZZ TEST":"bridge"}`+c.cfg())
	runNow(t, "now")         // the baseline
	f.addEntries(td, 5, 131) // changes
	f.mu.Lock()
	delete(f.vch, "v-00105")  // a deletion
	f.led["l-px"].alter = 200 // a master changed
	f.mu.Unlock()
	runNow(t, "light")   // a change read
	runNow(t, "now")     // Update now, with the deletion check
	runNow(t, "nightly") // the night (the totals check off)
	if _, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "p1", "xml": "<VOUCHER><DATE>" + td + "</DATE><NARRATION>TDSDesk:p1</NARRATION></VOUCHER>"}}}); err != nil {
		t.Fatalf("posting: %v", err)
	}
	waitIdle(t)
	n0 := f.count("")
	for _, q := range []func() (M, error){
		func() (M, error) { return heldBalances(zz, start, td, false) },
		func() (M, error) { return heldTB(zz, td) },
		func() (M, error) { return heldLedgerBalance(zz, "Party X", start, td, false) },
	} {
		if _, err := q(); err != nil {
			t.Fatalf("a balance from the copy: %v", err)
		}
	}
	if f.count("") != n0 {
		t.Fatal("a balance was asked of Tally")
	}
	tb, _ := heldTB(zz, td)
	tot := 0.0
	for _, x := range arr(tb["ledgers"]) {
		tot += num(arr(x)[2])
	}
	if tot > 0.005 || tot < -0.005 {
		t.Fatalf("the trial balance from the copy does not balance: %.2f %v", tot, tb["ledgers"])
	}
	if logLines("KeepBal") > 0 || logLines("opening balances, batch") > 0 {
		t.Fatal("the log shows a balance read")
	}
	f.assertNoBalance(t, false)
}
