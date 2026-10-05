package main

// FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (the owner's re-scope): no balance asked of Tally; one request at a time
// with postings first; after a timeout only the company check until it answers; the company's GUID; the FinCom id in
// every posted voucher and the exact-id check; a posting whose outcome is unknown; the lease; the measuring tool; Update
// now reading month slices only. A stand-in Tally keeps made-up books and answers the bridge's requests; a stand-in
// FinCom cloud keeps the lease.

import (
	"fmt"
	"html"
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

type tVch struct {
	guid, master, date, typ, no, narr, party string
	alter                                    int64
	lines                                    [][2]string
}
type standTally struct {
	srv       *httptest.Server
	port      int
	mu        sync.Mutex
	guid      string
	vch       []*tVch
	ledgers   []string
	reqs      []string
	bodies    []string
	inflight  int
	maxFlight int
	alter     int64
	slow      func(id, body string) time.Duration
	importAt  func(id, body string) (create bool, delay time.Duration)           // a posting: made or not, and how late it answers
	led       []*tLed                                                            // the ledger masters (the ledger list; ledgers_test.go)
	behave    func(w http.ResponseWriter, r *http.Request, id, body string) bool // a failure (faketally_test.go): true when it answered (or never will)
	coName    string                                                             // the company's name as this Tally gives it ("" : ZZ TEST)
	grp       [][2]string
	mid       int64 // the last MasterID given
	// fault 1 (03-Oct-2026, NWS144): how this Tally stores and answers
	storeNarr     func(narr string) string // the narration as Tally keeps it (nil: as sent)
	ansi          bool                     // answers in Windows-1252 bytes (an em dash as 0x97), as a real Tally does for non-ASCII text
	lastMaster    string                   // the MasterID of the last voucher an Import made (LASTVCHID)
	importAltered bool                     // an Import answers ALTERED n (CREATED 0): this Tally altered an entry it had
	importSkip    func(x string) bool      // round 7: a voucher of a batch this Tally refuses (counted in ERRORS, not made)
	storeParty    func(p string) string    // round 7: the party as this Tally keeps it (nil: as sent)
	// round 18 (2.1.9): how this Tally applies the period of a request (nil: plain yyyymmdd SVFROMDATE/SVTODATE only);
	// the Content-Type of every request (the stand decodes a body sent as UTF-16 by its Content-Type)
	dates  func(id, body string) (from, to string)
	ctypes []string
	// 2.2.0: the Voucher collections of the date-form probe and source C: svIgnored, SVFROMDATE/SVTODATE are ignored
	// (Tally's current period: every entry); filterDates, a TDL filter on $Date with $$Date literals is applied
	svIgnored, filterDates bool
	cnMode                 string // how the change numbers are given (the company check above)
}

// a ledger master of the stand-in Tally (its stored fields only)
type tLed struct {
	guid, name, parent, open, gstin, pan string
	state                                string // LEDSTATENAME (round 11)
	mid, alter                           int64
}

var reMidRange = regexp.MustCompile(`\$MasterID &gt; (\d+)(?: AND \$MasterID &lt;= (\d+))?`)

// a ledger made in the stand-in Tally (under its lock)
func (f *standTally) addLedLocked(name, parent, open string) *tLed {
	f.mid++
	f.alter++
	l := &tLed{guid: fmt.Sprintf("led-%d", f.mid), name: name, parent: parent, open: open, mid: f.mid, alter: f.alter}
	f.led = append(f.led, l)
	return l
}
func (f *standTally) addLed(name, parent, open string) *tLed {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.addLedLocked(name, parent, open)
}
func (f *standTally) altMst() int64 {
	if f.mid > 0 {
		return f.alter
	}
	return 3
}

var (
	reBalance  = regexp.MustCompile(`(?i)closingbalance|trial balance|group summary|balance sheet|ledger vouchers|TDSDeskKeepBal|TDSDeskBalances|TDSDeskOneLed|TDSDeskTB|\$\$(Closing|Opening)Balance|OnAccountValue`)
	reAltAbove = regexp.MustCompile(`\$AlterID (&gt;|=) (\d+)`)
	reNameIs   = regexp.MustCompile(`\$Name = (?:&#34;|&quot;|")([^&"]+)`)
)

func (f *standTally) ids() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.reqs...)
}
func (f *standTally) n(id string) int {
	c := 0
	for _, r := range f.ids() {
		if id == "" || r == id {
			c++
		}
	}
	return c
}

// no request asks Tally for a balance; a ledger's stored opening only without a period
func (f *standTally) noBalance(t *testing.T) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, b := range f.bodies {
		if m := reBalance.FindString(b); m != "" {
			t.Fatalf("request %d (%s) asks Tally for a balance (%q): %s", i, f.reqs[i], m, cut(b, 300))
		}
		if strings.Contains(strings.ToUpper(b), "OPENINGBALANCE") && strings.Contains(b, "SVFROMDATE") {
			t.Fatalf("request %d (%s) asks for an opening with a period", i, f.reqs[i])
		}
	}
}

func (v *tVch) xml() string {
	var b strings.Builder
	fmt.Fprintf(&b, `<VOUCHER REMOTEID="%s" VCHTYPE="%s"><DATE>%s</DATE><GUID>%s</GUID><MASTERID>%s</MASTERID><ALTERID> %d</ALTERID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>`+
		`<VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>%s</NARRATION><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED>`,
		v.guid, v.typ, v.date, v.guid, v.master, v.alter, v.typ, v.no, esc(v.party), esc(v.narr))
	for _, l := range v.lines {
		fmt.Fprintf(&b, `<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST>`, esc(l[0]), l[1])
	}
	b.WriteString("</VOUCHER>")
	return b.String()
}

func (f *standTally) add(date, party, no, narr, amt string) *tVch {
	f.alter++
	v := &tVch{guid: fmt.Sprintf("%s-%08x", f.guid, f.alter), master: fmt.Sprint(f.alter), date: date, typ: "Journal", no: no, narr: narr, party: party, alter: f.alter,
		lines: [][2]string{{party, amt}, {"Sales", strings.TrimPrefix("-"+amt, "--")}}}
	f.vch = append(f.vch, v)
	return v
}

func newStandTally(t *testing.T) *standTally {
	f := &standTally{guid: "co-guid-1"}
	for i := 1; i <= 8; i++ {
		f.ledgers = append(f.ledgers, fmt.Sprintf("Ledger %02d", i))
	}
	f.ledgers = append(f.ledgers, "Profit & Loss A/c")
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body := string(b)
		ct := r.Header.Get("Content-Type")
		if strings.Contains(strings.ToLower(ct), "utf-16") {
			body = textFromBytes(b) // round 18: decoded per Content-Type (UTF-16LE, its BOM first)
		}
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
		f.ctypes = append(f.ctypes, ct)
		f.inflight++
		if f.inflight > f.maxFlight {
			f.maxFlight = f.inflight
		}
		slow := f.slow
		imp := f.importAt
		f.mu.Unlock()
		defer func() { f.mu.Lock(); f.inflight--; f.mu.Unlock() }()
		wait := func(d time.Duration) bool {
			select {
			case <-time.After(d):
				return true
			case <-r.Context().Done():
				return false
			}
		}
		if slow != nil {
			if d := slow(id, body); d > 0 && !wait(d) {
				return
			}
		}
		f.mu.Lock()
		behave, coName := f.behave, f.coName
		f.mu.Unlock()
		if behave != nil && behave(w, r, id, body) {
			return
		}
		if coName == "" {
			coName = zz
		}
		from, to := group(`<SVFROMDATE>(\d{8})</SVFROMDATE>`, body, 1), group(`<SVTODATE>(\d{8})</SVTODATE>`, body, 1)
		f.mu.Lock()
		dh := f.dates
		f.mu.Unlock()
		if dh != nil {
			from, to = dh(id, body)
		}
		inDates := func(v *tVch) bool { return from == "" || (v.date >= from && v.date <= to) }
		var o strings.Builder
		o.WriteString("<ENVELOPE><BODY><DATA><COLLECTION>")
		f.mu.Lock()
		switch id {
		case "TDSDeskCompanies", "FinComFree", "FinComCompany", cnReportID:
			// 2.2.0 (the owner's finding on NWS144): how this Tally gives the change numbers. cnMode "": to the company
			// check (by NATIVEMETHOD) and the report alike; "none": never (empty tags, as the real Tally answered the
			// FETCH); "native": only to the NATIVEMETHOD form; "report": only to the report form; "zero": 0
			v, m := fmt.Sprint(f.alter), fmt.Sprint(f.altMst())
			native := strings.Contains(body, "<NATIVEMETHOD>AltVchId</NATIVEMETHOD>")
			switch {
			case f.cnMode == "none", f.cnMode == "native" && !native, f.cnMode == "report" && id != cnReportID, id == "FinComCompany" && !native:
				v, m = "", ""
			case f.cnMode == "zero":
				v, m = "0", "0"
			}
			if id == cnReportID {
				o.Reset()
				fmt.Fprintf(&o, `<ENVELOPE><FINCOMNUMBERS><COMPANY><NAME>%s</NAME><GUID>%s</GUID><ALTVCHID>%s</ALTVCHID><ALTMSTID>%s</ALTMSTID></COMPANY></FINCOMNUMBERS></ENVELOPE>`, esc(coName), f.guid, v, m)
				f.mu.Unlock()
				_, _ = w.Write([]byte(o.String()))
				return
			}
			fmt.Fprintf(&o, `<COMPANY NAME="%s"><NAME>%s</NAME><GUID>%s</GUID><STARTINGFROM>20260401</STARTINGFROM><ALTVCHID>%s</ALTVCHID><ALTMSTID>%s</ALTMSTID></COMPANY>`, esc(coName), esc(coName), f.guid, v, m)
		case "FinComLedgers":
			var after, upto int64 = 0, -1
			if m := reMidRange.FindStringSubmatch(body); m != nil {
				after = toI64(m[1])
				if m[2] != "" {
					upto = toI64(m[2])
				}
			}
			for _, l := range f.led {
				if l.mid > after && (upto < 0 || l.mid <= upto) {
					fmt.Fprintf(&o, `<LEDGER NAME="%s" RESERVEDNAME=""><GUID>%s</GUID><MASTERID> %d</MASTERID><ALTERID> %d</ALTERID><PARENT>%s</PARENT><OPENINGBALANCE>%s</OPENINGBALANCE>`+
						`<PARTYGSTIN>%s</PARTYGSTIN><INCOMETAXNUMBER>%s</INCOMETAXNUMBER><LEDSTATENAME>%s</LEDSTATENAME></LEDGER>`, esc(l.name), l.guid, l.mid, l.alter, esc(l.parent), l.open, l.gstin, l.pan, esc(l.state))
				}
			}
		case "FinComGroups":
			for _, g := range f.grp {
				fmt.Fprintf(&o, `<GROUP NAME="%s"><PARENT>%s</PARENT></GROUP>`, esc(g[0]), esc(g[1]))
			}
		case "Day Book":
			o.Reset()
			o.WriteString("<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>")
			for _, v := range f.vch {
				if inDates(v) {
					o.WriteString("<TALLYMESSAGE>" + v.xml() + "</TALLYMESSAGE>")
				}
			}
			o.WriteString("</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>")
			f.mu.Unlock()
			_, _ = w.Write([]byte(o.String()))
			return
		case "FinComTag", dupCheckID, "TDSDeskVchHeads", "TDSDeskKeepList", "FinComMeasureC", "FinComMeasureD", "FinComMeasureYear", "FinComSnapshot", "FinComMeasureB", "FinComMeasureE":
			var above, eq int64 = -1, -1
			if m := reAltAbove.FindStringSubmatch(body); m != nil {
				if m[1] == "=" {
					eq = toI64(m[2])
				} else {
					above = toI64(m[2])
				}
			}
			for _, v := range f.vch {
				if inDates(v) && (above < 0 || v.alter > above) && (eq < 0 || v.alter == eq) {
					o.WriteString(v.xml())
				}
			}
		case vchByMasterID: // 2.2.0: the recorder's body fetch, every MasterID named (one day)
			want := map[string]bool{}
			for _, m := range regexp.MustCompile(`\$MasterID = (\d+)`).FindAllStringSubmatch(body, -1) {
				want[m[1]] = true
			}
			for _, v := range f.vch {
				if inDates(v) && want[v.master] {
					o.WriteString(v.xml())
				}
			}
		case vchByNumberID: // 2.2.1: a new entry by its type and number (one day)
			no := html.UnescapeString(group(`\$VoucherNumber = &#34;(.*?)&#34; AND`, body, 1))
			typ := pinQuoted(body, "$VoucherTypeName")
			for _, v := range f.vch {
				if inDates(v) && v.no == no && v.typ == typ {
					o.WriteString(v.xml())
				}
			}
		case datesProbeID, sliceID:
			a, z := from, to
			if f.svIgnored {
				a, z = "", ""
			}
			if f.filterDates {
				if m := regexp.MustCompile(`\$\$Date:&#34;([^&]+)&#34;\S* AND \$Date &lt;= \$\$Date:&#34;([^&]+)&#34;|\$\$IsBetween:\$Date:\$\$Date:&#34;([^&]+)&#34;:\$\$Date:&#34;([^&]+)&#34;`).FindStringSubmatch(body); m != nil {
					a, z = normDate(m[1]+m[3]), normDate(m[2]+m[4])
				}
			}
			above := int64(-1)
			if m := reAltAbove.FindStringSubmatch(body); m != nil {
				above = toI64(m[2])
			}
			for _, v := range f.vch {
				if (a == "" || (v.date >= a && v.date <= z)) && v.alter > above {
					o.WriteString(v.xml())
				}
			}
		case editLogProbeID:
			want := group(`\$MasterID = (\d+)`, body, 1)
			for _, v := range f.vch {
				if v.master == want {
					fmt.Fprintf(&o, `<VOUCHER REMOTEID="%s"><GUID>%s</GUID><MASTERID>%s</MASTERID><EDITLOG.LIST><ALTERID>%d</ALTERID><USERNAME>owner</USERNAME></EDITLOG.LIST></VOUCHER>`, v.guid, v.guid, v.master, v.alter)
				}
			}
		case "FinComByMaster":
			want := group(`\$MasterID = (\d+)`, body, 1)
			for _, v := range f.vch {
				if inDates(v) && v.master == want {
					o.WriteString(v.xml())
				}
			}
		case "FinComMeasureNames":
			for _, n := range f.ledgers {
				fmt.Fprintf(&o, `<LEDGER NAME="%s"><NAME>%s</NAME></LEDGER>`, esc(n), esc(n))
			}
		case "FinComMeasureLedF", "FinComMeasureLedO":
			n := ""
			if m := reNameIs.FindStringSubmatch(body); m != nil {
				n = m[1]
			}
			fmt.Fprintf(&o, `<LEDGER NAME="%s"><PARENT>Indirect Expenses</PARENT><ISREVENUE>Yes</ISREVENUE><AFFECTSSTOCK>No</AFFECTSSTOCK><GUID>l-%s</GUID><OPENINGBALANCE>-10.00</OPENINGBALANCE></LEDGER>`, n, n)
		case "Import":
			create, delay := true, time.Duration(0)
			if imp != nil {
				create, delay = imp(id, body)
			}
			made, errs := 0, 0
			if create {
				for _, m := range regexp.MustCompile(`<LEDGER NAME="([^"]+)"[^>]*>[\s\S]*?<PARENT>([^<]*)</PARENT>`).FindAllStringSubmatch(body, -1) {
					f.addLedLocked(html.UnescapeString(m[1]), html.UnescapeString(m[2]), "0.00")
					made++
				}
				for _, x := range regexp.MustCompile(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(body, -1) {
					if f.importSkip != nil && f.importSkip(x) {
						errs++
						continue
					}
					narr := html.UnescapeString(group(`<NARRATION>([^<]*)</NARRATION>`, x, 1))
					if f.storeNarr != nil {
						narr = f.storeNarr(narr)
					}
					party := html.UnescapeString(group(`<PARTYLEDGERNAME>([^<]*)</PARTYLEDGERNAME>`, x, 1))
					if f.storeParty != nil {
						party = f.storeParty(party)
					}
					v := f.add(group(`<DATE>(\d{8})</DATE>`, x, 1), party, group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, x, 1), narr, "-1.00")
					f.lastMaster = v.master
					made++
				}
			}
			f.mu.Unlock()
			if delay > 0 && !wait(delay) {
				return
			}
			f.mu.Lock()
			lastMaster := f.lastMaster
			f.mu.Unlock()
			lv := ""
			if made > 0 && lastMaster != "" {
				lv = "<LASTVCHID>" + lastMaster + "</LASTVCHID>"
			}
			created, altered := made, 0
			if f.importAltered {
				created, altered = 0, made
			}
			_, _ = w.Write([]byte(fmt.Sprintf("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>%d</CREATED><ALTERED>%d</ALTERED><ERRORS>%d</ERRORS><EXCEPTIONS>0</EXCEPTIONS>%s</IMPORTRESULT></DATA></BODY></ENVELOPE>", created, altered, errs, lv)))
			return
		}
		ansi := f.ansi
		f.mu.Unlock()
		o.WriteString("</COLLECTION></DATA></BODY></ENVELOPE>")
		if ansi {
			// a real Tally answers non-ASCII text in its Windows code page: an em dash is the one byte 0x97
			_, _ = w.Write(cp1252Bytes(o.String()))
			return
		}
		_, _ = w.Write([]byte(o.String()))
	}))
	f.port = f.srv.Listener.Addr().(*net.TCPAddr).Port
	t.Cleanup(f.srv.Close)
	return f
}

// a stand-in FinCom cloud: the lease (held by another bridge while held is set), the days sent
type standCloud struct {
	srv       *httptest.Server
	mu        sync.Mutex
	held      bool
	kinds     []string
	guard     []M
	raw       []string // every body as sent (round 4: null against 0 in read_guard)
	ledList   []M      // the ledger lists sent (kind ledger_list)
	lastBeat  M        // the last heartbeat
	beatReply M        // added to the heartbeat's answer (readStop, readResume, release)
	takeJobs  []M      // round 7: jobs posts_take hands out, one per call
	posts     []M      // round 7: every posts_update body
	dayPosts  []M      // round 10: every "days" body (per day: day, n, empty / readFailed)
	// 2.2.0: recorder_lines: the bodies answered 200 with results (recBodies) and every body as sent (recRaw); recReply
	// answers instead (nil: results, every line applied); recDelay: how long each answer takes
	recBodies []M
	recRaw    []string
	recReply  func(b M) (int, M)
	recDelay  time.Duration
}

func newStandCloud(t *testing.T) *standCloud {
	c := &standCloud{}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		o := parseObj(string(b))
		c.mu.Lock()
		defer c.mu.Unlock()
		k := str(o["kind"])
		c.kinds = append(c.kinds, k)
		c.raw = append(c.raw, string(b))
		out := M{"ok": true}
		switch k {
		case "companies":
			out["links"] = M{zz: true}
		case "lease_take":
			if c.held {
				out = M{"ok": true, "held": true, "holder": M{"computer": "PC-2", "bridge": "go-other", "until": "15:00"}}
			} else {
				out = M{"ok": true, "held": false, "lease": M{"until": time.Now().Add(2 * time.Minute).Format(time.RFC3339)}}
			}
		case "beat":
			c.lastBeat = o
			for k, v := range c.beatReply {
				out[k] = v
			}
		case "read_guard":
			c.guard = append(c.guard, o)
			out["state"] = "ok"
		case "posts_take":
			if len(c.takeJobs) > 0 {
				out["job"] = c.takeJobs[0]
				c.takeJobs = c.takeJobs[1:]
			}
		case "posts_update":
			c.posts = append(c.posts, o)
		case "ledger_list":
			c.ledList = append(c.ledList, o)
			out["added"], out["renamed"], out["deleted"] = len(arr(o["ledgers"])), len(arr(o["renamed"])), 0
		case "recorder_lines":
			c.recRaw = append(c.recRaw, string(b))
			if c.recDelay > 0 {
				c.mu.Unlock()
				time.Sleep(c.recDelay)
				c.mu.Lock()
			}
			if c.recReply != nil {
				code, ans := c.recReply(o)
				if code != 200 {
					w.WriteHeader(code)
				}
				_, _ = w.Write([]byte(jsonText(ans)))
				return
			}
			res := []any{}
			for _, x := range arr(o["lines"]) {
				res = append(res, M{"line_id": obj(x)["line_id"], "state": "applied", "why": nil})
			}
			if len(res) > 0 { // an empty call is the bridge's link check
				c.recBodies = append(c.recBodies, o)
			}
			out["results"], out["applied"] = res, len(res)
		case "days":
			c.dayPosts = append(c.dayPosts, o)
			done := []any{}
			for _, x := range arr(o["days"]) {
				done = append(done, obj(x)["day"])
			}
			out["done"] = done
		}
		_, _ = w.Write([]byte(jsonText(out)))
	}))
	t.Cleanup(c.srv.Close)
	return c
}
func (c *standCloud) cfg() string {
	return fmt.Sprintf(`,"CloudUrl":"%s/","CloudKeyGo":"plain:fcd_%s"`, c.srv.URL, strings.Repeat("0", 48))
}
func (c *standCloud) count(kind string) int {
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

func standBridge(t *testing.T, f *standTally, extra string) string {
	dir := bridgeFor(t, &standIn{port: f.port}, extra)
	cloudMu.Lock()
	cloudLinks, cloudLinksAt, cloudBack, cloudStateAt = map[string]bool{}, time.Time{}, map[string]keepBack{}, map[string]time.Time{}
	cloudMu.Unlock()
	probeMu.Lock()
	probes = map[int]*probeState{}
	probeMu.Unlock()
	bgMu.Lock()
	stopHold = map[int]time.Time{}
	bgMu.Unlock()
	decideMu.Lock()
	decideAt = map[string]time.Time{} // the decision log's once-in-10-minutes, per test
	decideMu.Unlock()
	numberAskMu.Lock()
	numberAsks = map[string]time.Time{}
	numberAskMu.Unlock()
	leaseMu.Lock()
	leases = map[string]time.Time{}
	leaseMu.Unlock()
	whereMu.Lock()
	whereMap = map[string]map[string]string{}
	whereMu.Unlock()
	measureMu.Lock()
	measureLast = nil
	measureMu.Unlock()
	altMu.Lock()
	companyAlts, companyAltsM = map[string]int64{}, map[string]int64{}
	altMu.Unlock()
	acceptedReset()
	return dir
}

func liveFrom(from string) {
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	saveKeepState(dir, M{"company": zz, "from": from, "next": from, "slice": 31, "phase": "live", "months": M{}, "skipped": []any{}})
}

// --- Update now reads month slices only (the company check aside): no balance, no list of changes; a second Update now
// sends the cloud only the days that changed; a slice that does not answer is halved and the read goes on from it
func TestUpdateNowReadsMonthSlicesOnly(t *testing.T) {
	td := today()
	from := fromTallyDate(td).AddDate(0, -2, 0).Format("200601") + "01"
	f := newStandTally(t)
	for d := from; d <= td; d = addDays(d, 3) {
		f.add(d, "Party X", "", "sale", "-100.00")
	}
	standBridge(t, f, "")
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(from)
	runNow(t, "now")
	var slices []string
	f.mu.Lock()
	for i, id := range f.reqs {
		switch id {
		case "Day Book":
			a, z := group(`<SVFROMDATE>(\d{8})`, f.bodies[i], 1), group(`<SVTODATE>(\d{8})`, f.bodies[i], 1)
			if a[:6] != z[:6] {
				t.Errorf("a slice crosses a month: %s-%s", a, z)
			}
			slices = append(slices, a+"-"+z)
		case "FinComCompany", "TDSDeskCompanies", "TDSDeskCompanyInfo", ledListID, grpListID: // 2.1.4: the plain ledger and group lists too
		default:
			t.Errorf("Update now sent %q", id)
		}
	}
	f.mu.Unlock()
	want := []string{from + "-" + monthEnd(from[:6]), nextYm(from[:6]) + "01-" + monthEnd(nextYm(from[:6])), td[:6] + "01-" + td}
	if strings.Join(slices, " ") != strings.Join(want, " ") {
		t.Fatalf("slices %v, want %v", slices, want)
	}
	st := readKeepState(syncFolder(zz))
	if str(st["roundAt"]) == "" || logLines("day(s) changed since the last read") != 1 {
		t.Fatalf("the round did not finish: %v", st)
	}
	// the same again: nothing changed, so no day goes to the cloud again
	runNow(t, "now")
	if toInt(readKeepState(syncFolder(zz))["roundDays"]) != 0 {
		t.Fatal("days were taken as changed with nothing changed in Tally")
	}
	// a slice that does not answer: halved, and the next try starts from it (the slices before it are kept)
	f.mu.Lock()
	var once sync.Once
	mid := nextYm(from[:6]) + "01"
	f.slow = func(id, body string) time.Duration {
		d := time.Duration(0)
		if id == "Day Book" && strings.Contains(body, "<SVFROMDATE>"+mid+"</SVFROMDATE>") {
			once.Do(func() { d = 3 * time.Second })
		}
		return d
	}
	f.mu.Unlock()
	setCfg("TallyMaxSec", 1)
	k := &keepRun{tc: &TC{copier: true}, kind: "now", told: map[string]bool{}, id: "r9", alter: map[string]int64{}}
	var err error
	for i := 0; i < 4 && err == nil; i++ {
		err = k.step(zz, f.port, "")
	}
	if err == nil || !strings.Contains(err.Error(), "the next try reads 15 day(s) from "+mid) {
		t.Fatalf("the slice that did not answer: %v", err)
	}
	if str(readKeepState(syncFolder(zz))["roundNext"]) != mid {
		t.Fatal("the slice before was not kept")
	}
	f.noBalance(t)
}

// --- one request at a time; a posting waiting goes before another FinCom request that waits longer
func TestOneAtATimePostingsFirst(t *testing.T) {
	f := newStandTally(t)
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 1500 * time.Millisecond
		}
		return 0
	}
	standBridge(t, f, "")
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		_, _ = invokeTally(fin, f.port, namesRequest(zz, 0, 2000), 0)
	}()
	time.Sleep(300 * time.Millisecond)
	go func() {
		defer wg.Done()
		_, _ = invokeTally(fin, f.port, groupsFullRequest(zz), 0)
	}()
	time.Sleep(200 * time.Millisecond)
	go func() {
		defer wg.Done()
		_, _ = invokeTally(fin, f.port, importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+finVoucher("p1", fgParty, fgBill, fgDate, fgAmt)+`</TALLYMESSAGE>`), 0)
	}()
	wg.Wait()
	got := f.ids()
	if strings.Join(got, ",") != "TDSDeskNames,Import,TDSDeskGroups" {
		t.Fatalf("order %v: the posting did not go first", got)
	}
	f.mu.Lock()
	mx := f.maxFlight
	f.mu.Unlock()
	if mx != 1 {
		t.Fatalf("%d requests at Tally at once", mx)
	}
	f.noBalance(t)
}

// --- after a request that did not answer: nothing is sent until the company check may go (once a minute), and only it
// until it answers; then the request
func TestTimeoutOnlyProbeUntilItAnswers(t *testing.T) {
	f := newStandTally(t)
	busy := true
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" || (id == "FinComCompany" && busy) {
			return 3 * time.Second
		}
		return 0
	}
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeSec":1`)
	start := time.Now()
	nowFn = func() time.Time { return start }
	if _, err := getLedgerNames(fin, zz, f.port); err == nil {
		t.Fatal("the slow request answered")
	}
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "FinComCompany" && busy {
			return 3 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	n0 := f.n("")
	// within the minute: refused at once, nothing sent (a posting too)
	for _, sec := range []int{1, 30, 59} {
		nowFn = func() time.Time { return start.Add(time.Duration(sec) * time.Second) }
		if _, err := getLedgerNames(fin, zz, f.port); err == nil || !isBusyErr(err) {
			t.Fatalf("at %ds: %v", sec, err)
		}
		r := postOne(t, fmt.Sprintf("q%d", sec), finVoucher(fmt.Sprintf("q%d", sec), fgParty, fgBill, fgDate, fgAmt))
		if r["ok"] == true {
			t.Fatal("posted to a Tally that did not answer")
		}
	}
	if f.n("") != n0 {
		t.Fatalf("within the minute %v went to Tally", f.ids()[n0:])
	}
	// after a minute: the check alone; Tally still busy, so nothing else
	nowFn = func() time.Time { return start.Add(61 * time.Second) }
	if _, err := getLedgerNames(fin, zz, f.port); err == nil {
		t.Fatal("answered while busy")
	}
	if s := f.ids()[n0:]; len(s) != 1 || s[0] != "FinComCompany" {
		t.Fatalf("after a minute: %v (want the check only)", s)
	}
	// and not again for a minute
	nowFn = func() time.Time { return start.Add(90 * time.Second) }
	_, _ = getLedgerNames(fin, zz, f.port)
	if f.n("") != n0+1 {
		t.Fatal("the check went again within the minute")
	}
	// Tally free: the check answers, then the request goes
	busy = false
	nowFn = func() time.Time { return start.Add(125 * time.Second) }
	if _, err := getLedgerNames(fin, zz, f.port); err != nil {
		t.Fatalf("Tally free: %v", err)
	}
	if s := f.ids()[n0+1:]; strings.Join(s, ",") != "FinComCompany,TDSDeskNames,TDSDeskGroupNames" {
		t.Fatalf("Tally free: %v", s)
	}
	f.noBalance(t)
}

// --- the company's GUID: a company of the same name with another GUID is refused, nothing posted to it or read from it
func TestCompanyGUIDDifferentRefused(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	liveFrom(td)
	if r := postOne(t, "g1", finVoucher("g1", fgParty, "B-1", td, "10.00")); r["ok"] != true {
		t.Fatalf("the first posting: %v", r)
	}
	if heldGUID(zz) != "co-guid-1" {
		t.Fatalf("the GUID held: %q", heldGUID(zz))
	}
	f.mu.Lock()
	f.guid = "co-guid-2" // restored, or another company of the same name
	f.mu.Unlock()
	imports := f.n("Import")
	r := postOne(t, "g2", finVoucher("g2", fgParty, "B-2", td, "20.00"))
	if r["ok"] == true || r["guidMismatch"] != true || !strings.Contains(str(r["message"]), "co-guid-2") {
		t.Fatalf("posted to another company: %v", r)
	}
	if f.n("Import") != imports {
		t.Fatal("an import went to the other company")
	}
	// Update now reads nothing from it either
	books := f.n("Day Book")
	runNow(t, "now")
	if f.n("Day Book") != books {
		t.Fatal("the other company's day book was read")
	}
	// confirmed on this computer: the new GUID is held, and postings go again
	if _, err := acceptCompanyGUID(zz); err != nil || heldGUID(zz) != "co-guid-2" {
		t.Fatalf("confirm: %v %q", err, heldGUID(zz))
	}
	if r := postOne(t, "g3", finVoucher("g3", fgParty, "B-3", td, "30.00")); r["ok"] != true {
		t.Fatalf("after confirming: %v", r)
	}
	f.noBalance(t)
}

// --- the FinCom id: stamped when FinCom did not write one; the same id in Tally already: not posted (the exact check)
func TestFinComIDStampedAndExactDuplicateRefused(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	x := strings.Replace(finVoucher("unused", fgParty, "S-1", td, "50.00"), "Electricity | TDSDesk:unused", "Electricity", 1)
	if reTag.MatchString(x) {
		t.Fatal("the test voucher has a tag")
	}
	r := postOne(t, "bill-77", x)
	if r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	f.mu.Lock()
	var imp string
	for i, id := range f.reqs {
		if id == "Import" {
			imp = f.bodies[i]
		}
	}
	f.mu.Unlock()
	if !strings.Contains(imp, "<NARRATION>TDSDesk:bill77 | Electricity</NARRATION>") { // round 4: the tag first
		t.Fatalf("the FinCom id was not stamped: %s", cut(imp, 600))
	}
	// the same FinCom id again, other details changed (another amount and number): refused on the id alone (round 15,
	// the owner's decision of 03-Oct-2026: on this computer's record of what it sent, not on a read of Tally)
	again := strings.Replace(finVoucher("bill77", fgParty, "S-1-REV", td, "55.00"), "Electricity |", "Electricity revised |", 1)
	imports := f.n("Import")
	n0 := f.n("")
	r = postOne(t, "bill-77", again)
	if r["ok"] == true || r["alreadySent"] != true || !strings.HasPrefix(str(r["message"]), "already sent from this computer on ") {
		t.Fatalf("the same FinCom id was posted again: %v", r)
	}
	if f.n("Import") != imports {
		t.Fatal("an import was sent for it")
	}
	onlyPostingRequests(t, f, n0)
	f.noBalance(t)
}

// --- a posting whose answer was lost (Tally took the import and did not answer): round 15 (the owner's decision of
// 03-Oct-2026): the entry is "unknown" (outcomeUnknown, state unknown), recorded as sent and NEVER sent again by this
// bridge, whether Tally made it or not; no checking starts (Check Tally or the next comparison settles it); the job
// ends done, saying so
func TestTimedOutPostingOutcomeUnknown(t *testing.T) {
	for _, made := range []bool{true, false} {
		t.Run(fmt.Sprintf("reached-%v", made), func(t *testing.T) {
			td := today()
			f := newStandTally(t)
			var once sync.Once
			f.importAt = func(id, body string) (bool, time.Duration) {
				create, d := true, time.Duration(0)
				once.Do(func() { create, d = made, 3*time.Second })
				return create, d
			}
			standBridge(t, f, `,"TallyMaxSec":1,"PostTimeoutSec":1,"PostTimeoutBaseSec":1,"TallyProbeEverySec":2,"PostWaitMs":200`) // the import's own timeout (review finding 7)
			j, err := newPostJob(M{"jobId": "job-unknown-" + fmt.Sprint(made), "company": zz, "vouchers": []any{M{"id": "u1", "xml": finVoucher("u1", fgParty, "U-1", td, "70.00")}}})
			if err != nil {
				t.Fatal(err)
			}
			p := waitJob(t, str(j["id"]))
			if str(p["status"]) != "done" || !strings.Contains(str(p["message"]), "1 sent with no answer from Tally") {
				t.Fatalf("the job: %s %q", p["status"], p["message"])
			}
			r := obj(arr(p["results"])[0])
			e := obj(arr(p["items"])[0])
			if r["ok"] == true || r["outcomeUnknown"] != true || r["sent"] != true || str(r["message"]) != unknownLine {
				t.Fatalf("the entry: %v", r)
			}
			if str(e["state"]) != "unknown" || str(e["reason"]) != unknownLine {
				t.Fatalf("the item: %v", e)
			}
			if f.n("Import") != 1 {
				t.Fatalf("sent again after no answer (%d imports)", f.n("Import"))
			}
			if a := acceptedInfo("u1"); a == nil || a["sent"] != true || str(a["vchId"]) != "" {
				t.Fatalf("not recorded as sent: %v", a)
			}
			n := 0
			f.mu.Lock()
			for _, v := range f.vch {
				if strings.Contains(v.narr, "TDSDesk:u1") {
					n++
				}
			}
			f.mu.Unlock()
			if (made && n != 1) || (!made && n != 0) {
				t.Fatalf("%d copies in Tally (made %v)", n, made)
			}
			// the same id again (Retry in FinCom, a new job): refused on the record, nothing sent
			if r := postOne(t, "u1", finVoucher("u1", fgParty, "U-1", td, "70.00")); r["alreadySent"] != true || f.n("Import") != 1 {
				t.Fatalf("sent again after an unknown outcome: %v (%d imports)", r, f.n("Import"))
			}
			if f.n(tagCheckID)+f.n(masterCheckID)+f.n(dupCheckID) != 0 {
				t.Fatalf("a read went with the posting: %v", f.ids())
			}
			f.noBalance(t)
		})
	}
}

// --- the lease: while another bridge holds the company, this one neither reads nor posts it; when it is free, it does
func TestLeaseHonoured(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, "Party X", "", "sale", "-5.00")
	c := newStandCloud(t)
	c.held = true
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	liveFrom(td)
	runNow(t, "now")
	if f.n("Day Book") != 0 || f.n("FinComCompany") != 0 {
		t.Fatalf("read while another bridge holds the lease: %v", f.ids())
	}
	if logLines("another FinCom Bridge (PC-2 go-other, until 15:00) is reading or posting this company now; this one gives way") != 1 {
		t.Fatal("the log does not say it gave way")
	}
	j, err := newPostJob(M{"jobId": "job-lease-1", "company": zz, "vouchers": []any{M{"id": "l1", "xml": finVoucher("l1", fgParty, "L-1", td, "9.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	dir, _ := jobDir(str(j["id"]))
	time.Sleep(800 * time.Millisecond)
	if p := readProgress(dir); str(p["status"]) != "waiting" || !strings.Contains(str(p["message"]), "another FinCom Bridge (PC-2 go-other") || f.n("Import") != 0 {
		t.Fatalf("posting while another bridge holds the lease: %v %v", p["status"], p["message"])
	}
	c.mu.Lock()
	c.held = false
	c.mu.Unlock()
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || f.n("Import") != 1 {
		t.Fatalf("after the lease was free: %v", p["message"])
	}
	if c.count("lease_release") < 1 {
		t.Fatal("the lease was not given back")
	}
	f.noBalance(t)
}

// --- the measuring tool: each item, one request at a time; a ledger that hangs is reported, the check waited for;
// snapshots and their comparison
func TestMeasureTool(t *testing.T) {
	td := today()
	f := newStandTally(t)
	for i := 0; i < 30; i++ {
		f.add(td, "Party X", fmt.Sprint(i), "sale", "-1.00")
	}
	f.slow = func(id, body string) time.Duration {
		if id == "FinComMeasureLedO" && strings.Contains(body, "Profit") {
			return 3 * time.Second // the stored opening of Profit & Loss A/c hangs
		}
		return 0
	}
	dir := standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
	sort.Strings(f.ledgers)
	r, err := runMeasure(measureOpts{company: zz, ledgers: "8-9"})
	if err != nil {
		t.Fatal(err)
	}
	rep := str(r["report"])
	t.Log("\n" + rep)
	for _, want := range []string{"\na ", "\nb ", "\nc1 ", "\nc2 ", "\nd ", "\ne ", "\nf0 ", "f8-fields", "f8-opening", "f9-fields", "f9-opening",
		"company GUID co-guid-1", "ledger entries", "bill-wise allocations", "bank reconciliation date", "HANGS", "waiting for Tally to answer the company check", "is revenue Yes"} {
		if !strings.Contains(rep, want) {
			t.Errorf("the report lacks %q", want)
		}
	}
	if !strings.HasPrefix(str(r["file"]), dir) || !exists(str(r["file"])) {
		t.Fatalf("the report file: %v", r["file"])
	}
	f.mu.Lock()
	mx := f.maxFlight
	f.mu.Unlock()
	if mx != 1 {
		t.Fatal("more than one request at a time")
	}
	// snapshots: an entry altered, one deleted, one added
	if _, err := measureSnapshot(measureOpts{company: zz, snapshot: "before"}); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.alter++
	f.vch[0].alter = f.alter
	f.vch = f.vch[:len(f.vch)-1]
	f.mu.Unlock()
	f.add(td, "Party Y", "new", "sale", "-2.00")
	if _, err := measureSnapshot(measureOpts{company: zz, snapshot: "after"}); err != nil {
		t.Fatal(err)
	}
	cmp, err := measureCompare("before", "after")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cmp, "1 changed, 1 added, 1 gone") || !strings.Contains(cmp, "Company GUID: the same") {
		t.Fatalf("the comparison:\n%s", cmp)
	}
	f.noBalance(t)
}

// --- no request of any kind asks Tally for a balance: Update now, a light update, the night, a posting, the measuring
// tool; and the bridge's balance answers come from its copy without a request
func TestNoBalanceAsked(t *testing.T) {
	td := today()
	f := newStandTally(t)
	for i := 0; i < 5; i++ {
		f.add(td, "Party X", fmt.Sprint(i), "sale", "-3.00")
	}
	standBridge(t, f, "")
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td)
	runNow(t, "now")
	wakeOpen(zz, "opened")
	waitIdle(t)
	runNow(t, "nightly")
	if r := postOne(t, "n1", finVoucher("n1", fgParty, "N-1", td, "4.00")); r["ok"] != true {
		t.Fatalf("posting: %v", r)
	}
	if _, err := runMeasure(measureOpts{company: zz, ledgers: "1-2"}); err != nil {
		t.Fatal(err)
	}
	_ = saveFile(filepath.Join(syncFolder(zz), "balances.json"), jsonText(M{"ok": true, "from": td, "openAsOn": addDays(td, -1), "ledgers": []any{M{"name": "Party X", "parent": "Sundry Debtors", "open": "-1.00"}}}))
	n0 := f.n("")
	b, err := heldLedgerBalance(zz, "Party X", td, td, false)
	if err != nil || str(b["open"]) != "-1.00" || str(b["close"]) != "-16.00" {
		t.Fatalf("a balance from the copy: %v %v", b, err)
	}
	if _, err := heldTB(zz, td); err != nil {
		t.Fatal(err)
	}
	if f.n("") != n0 {
		t.Fatal("a balance was asked of Tally")
	}
	f.noBalance(t)
}

func runNow(t *testing.T, kind string) {
	t.Helper()
	if !startKeepRun(runReq{kind: kind, why: "test"}) {
		t.Fatal("no run started")
	}
	time.Sleep(50 * time.Millisecond)
	waitIdle(t)
}

// --- 2.1.5 (plan 1a): "Vouchers : Ledger" is never asked of Tally (Tally builds that list ledger by ledger, the same
// shape of read that hung on 696-699), nor anything CHILDOF a ledger
var reLedgerCollection = regexp.MustCompile(`(?i)vouchers\s*:\s*ledger|childof`)

func (f *standTally) noLedgerCollection(t *testing.T) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, b := range f.bodies {
		if m := reLedgerCollection.FindString(b); m != "" {
			t.Fatalf("request %d (%s) asks Tally for a ledger's own list (%q): %s", i, f.reqs[i], m, cut(b, 300))
		}
	}
}

func TestNoLedgerCollectionAsked(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "S-0", "sale | TDSDesk:old1", "-12.00")
	standBridge(t, f, "")
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td)
	runNow(t, "now") // the copy here holds today's entries
	// a posting naming its ledger, checked first (a resumed or queued posting): what reached Tally is looked for
	j, err := newPostJob(M{"jobId": "job-ledcoll-1", "company": zz, "ledger": fgParty, "checkFirst": true,
		"vouchers": []any{M{"id": "lc1", "xml": finVoucher("lc1", fgParty, "LC-1", td, "8.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" {
		t.Fatalf("the posting: %v", p["message"])
	}
	// FinCom's /ledgervouchers and /ledgerlines: from the copy here, Tally not asked
	n0 := f.n("")
	lv, err := getLedgerVouchers(zz, fgParty, td, td, f.port)
	if err != nil {
		t.Fatalf("/ledgervouchers: %v", err)
	}
	if toInt(lv["count"]) < 1 || str(lv["source"]) != "copy" {
		t.Fatalf("/ledgervouchers did not answer from the copy: %v", lv)
	}
	ll, err := getLedgerLines(zz, fgParty, td, td, f.port)
	if err != nil || len(arr(ll["vouchers"])) < 1 || str(ll["via"]) != "copy" {
		t.Fatalf("/ledgerlines: %v %v", ll, err)
	}
	if f.n("") != n0 {
		t.Fatalf("a ledger's entries were asked of Tally: %v", f.ids()[n0:])
	}
	// before the copy starts: said plainly, Tally not asked
	if _, err := getLedgerVouchers(zz, fgParty, addDays(td, -400), td, f.port); err == nil || !strings.Contains(err.Error(), "FinCom's copy") {
		t.Fatalf("before the copy: %v", err)
	}
	if f.n("") != n0 {
		t.Fatalf("Tally was asked: %v", f.ids()[n0:])
	}
	f.noLedgerCollection(t)
	f.noBalance(t)
}

// --- the tag read for Check Tally (findPostedTags) asks FinComTag alone: one request per date, that date only; a posting
// never calls it (round 15)
func TestPostedTagFoundByDate(t *testing.T) {
	d1, d2 := "20260701", "20260705"
	f := newStandTally(t)
	f.add(d1, fgParty, "T-1", "Electricity | TDSDesk:t1", "-5.00")
	f.add(d2, fgParty, "T-2", "Electricity | TDSDesk:t2", "-6.00")
	f.add("20260703", fgParty, "T-X", "other | TDSDesk:tx", "-7.00")
	standBridge(t, f, "")
	oldDaysOn() // round 19: ReadDays on: invokeTally refuses every dated request with it off; this test is about the dated logic
	items := []M{{"id": "t1", "xml": finVoucher("t1", fgParty, "T-1", d1, "5.00")}, {"id": "t2", "xml": finVoucher("t2", fgParty, "T-2", d2, "6.00")},
		{"id": "t3", "xml": finVoucher("t3", fgParty, "T-3", d2, "9.00")}}
	n0 := f.n("")
	there := findPostedTags(f.port, zz, items, fgParty)
	if there == nil || str(there["t1"]["guid"]) == "" || str(there["t2"]["date"]) != d2 || there["t3"] != nil || len(there) != 2 {
		t.Fatalf("found: %v", there)
	}
	f.mu.Lock()
	sent, bodies := append([]string{}, f.reqs[n0:]...), append([]string{}, f.bodies[n0:]...)
	f.mu.Unlock()
	if strings.Join(sent, ",") != "FinComTag,FinComTag" {
		t.Fatalf("asked %v (want FinComTag once per date)", sent)
	}
	for i, d := range []string{d1, d2} {
		if !strings.Contains(bodies[i], "<SVFROMDATE>"+d+"</SVFROMDATE><SVTODATE>"+d+"</SVTODATE>") {
			t.Fatalf("request %d is not for %s alone: %s", i, d, cut(bodies[i], 400))
		}
	}
	// a posting: no read-back at all (round 15, the owner's decision of 03-Oct-2026)
	n1 := f.n("")
	if r := postOne(t, "t4", finVoucher("t4", fgParty, "T-4", d1, "4.00")); r["ok"] != true || r["byReply"] != true {
		t.Fatalf("posting: %v", r)
	}
	onlyPostingRequests(t, f, n1)
	f.noLedgerCollection(t)
	f.noBalance(t)
}

// text as a Windows-1252 Tally writes it: the em dash, en dash and curly quotes as their one-byte codes
func cp1252Bytes(s string) []byte {
	var b []byte
	for _, r := range s {
		switch {
		case r == '\u2014':
			b = append(b, 0x97)
		case r == '\u2013':
			b = append(b, 0x96)
		case r == '\u2019':
			b = append(b, 0x92)
		case r < 0x80:
			b = append(b, byte(r))
		default:
			b = append(b, '?')
		}
	}
	return b
}
