package main

// The root cause of NWS144's "the entry fetch finds nothing" (a real TallyPrime 7.1, run 37301813638, the spike's
// round 2, 05-Oct-2026): Tally writes its typed fields WITH attributes and padded numbers
// (<MASTERID TYPE="Number"> 2</MASTERID>, <ALTERID TYPE="Number"> 4</ALTERID>, <DATE TYPE="Date">20261002</DATE>,
// <NARRATION TYPE="String">...), and every answer to a collection carries a CMPINFO block of counters
// (<COMPANY>0</COMPANY> ... <VOUCHER>4</VOUCHER>) ahead of the data. The bridge read the fields with attribute-free
// patterns, so the body fetch always concluded "Tally gave no voucher with MasterID N". The fixtures are Tally's own
// answers (testdata/real-tally-7.1): fetch-C the body by MasterID 2, fetch-An by type and number (Receipt 1), fetch-H
// a MasterID Tally does not have, vouchers-d five vouchers (MasterID 2 cancelled), company-list the company list.
// Tests written before the code.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

const (
	spikeCoGUID = "226fb516-9d2d-45ad-ad78-304d86b64500"
	spikeCo     = "FinCom Spike Co"
)

func realTally(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "real-tally-7.1", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// a bridge whose stand Tally answers the request with this id by a real Tally's answer, on 02-Oct-2026 (the day of the
// spike's vouchers)
func realTallyBridge(t *testing.T, extra string, answers map[string]string) (string, *standTally, *standCloud) {
	t.Helper()
	rec, f, c := liveBridge(t, `,"RecorderNumberWaitMs":0,"RecorderNumberRetryMs":0,"RecorderBodySec":3`+extra)
	at := time.Date(2026, 10, 2, 11, 0, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	f.mu.Lock()
	f.guid, f.coName = spikeCoGUID, spikeCo
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if a, ok := answers[id]; ok {
			_, _ = w.Write([]byte(a))
			return true
		}
		return false
	}
	f.mu.Unlock()
	noteCompanyGUID(spikeCo, spikeCoGUID)
	noteStartPoint(spikeCo, spikeCoGUID, 1, 1)
	liveSeedOwnOpen(spikeCoGUID, spikeCo) // fix 3: the company open in this bridge's own Tally all along
	return filepath.Join(rec, spikeCoGUID+"-20261002.txt"), f, c
}

var spikeWant = liveWant{company: spikeCo, cguid: spikeCoGUID, typ: "Receipt", no: "1", date: "20261002", mid: "2", sp: 1, spOK: true}

// --- 1. the body by MasterID (fetch-C): found under MasterID 2, and the CMPINFO counter is no voucher
func TestRealTally71ByMaster(t *testing.T) {
	_, f, _ := realTallyBridge(t, "", map[string]string{vchObjectID: realTally(t, "fetch-C.xml")})
	got, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{"2"}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got["2"] == "" {
		t.Fatalf("Tally's answer for MasterID 2 read as %d voucher(s): %v", len(got), mapKeys(got))
	}
	x := got["2"]
	if !strings.HasPrefix(x, `<VOUCHER REMOTEID="`+spikeCoGUID+`-00000002"`) || !strings.HasSuffix(x, "</VOUCHER>") {
		t.Fatalf("the body taken is not the voucher: %s", cut(x, 200))
	}
	if why, _ := liveVoucherWrong(x, "voucher with MasterID 2", spikeWant); why != "" {
		t.Fatalf("Tally's own voucher refused: %s", why)
	}
}

// --- 2. a MasterID Tally does not have (fetch-H): nothing, so "no voucher"; the counter <VOUCHER>4</VOUCHER> is not one
func TestRealTally71ByMasterMissing(t *testing.T) {
	_, f, _ := realTallyBridge(t, "", map[string]string{vchObjectID: realTally(t, "fetch-H.xml")})
	got, err := fetchVouchersByMasterIn(recorderTC(nil), spikeCo, f.port, "20261002", []string{"52"}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("a missing MasterID gave %v", mapKeys(got))
	}
	w := spikeWant
	w.mid = "52"
	if why, kind := liveVoucherWrong(got["52"], "voucher with MasterID 52", w); !strings.HasPrefix(why, "Tally gave no voucher with MasterID 52") || kind != wrongRetry {
		t.Fatalf("missing: %q %q", why, kind)
	}
}

// --- 3. by type and number (fetch-An): the one Receipt 1 of 02-Oct-2026, accepted by the check
func TestRealTally71ByNumber(t *testing.T) {
	_, f, _ := realTallyBridge(t, "", map[string]string{vchByNumberID: realTally(t, "fetch-An.xml")})
	liveNumberAsk(spikeCo, "20261002", "Receipt", "1")
	got, err := fetchVoucherByNumber(recorderTC(nil), spikeCo, f.port, "20261002", "Receipt", "1", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("Receipt 1 read as %d voucher(s)", len(got))
	}
	w := spikeWant
	w.mid = ""
	if why, _ := liveVoucherWrong(got[0], "voucher Receipt 1", w); why != "" {
		t.Fatalf("Tally's own voucher refused: %s", why)
	}
	x, why, _, err := liveOneByNumber(recorderTC(nil), spikeCo, f.port, w, 5)
	if err != nil || why != "" || x == "" {
		t.Fatalf("by number: %q %v", why, err)
	}
}

// --- 4. the entry takes Tally's GUID, MasterID, AlterID, narration and ledgers from the real answer
func TestRealTally71TakesTallyFields(t *testing.T) {
	realTallyBridge(t, "", nil) // the bridge's own folders (its log never in the package folder)
	x := reVchBlock.FindAllString(realTally(t, "fetch-C.xml"), -1)
	if len(x) != 1 {
		t.Fatalf("the real answer read as %d voucher block(s)", len(x))
	}
	c := &change{company: spikeCo}
	liveTakeBody(c, cleanXML(x[0]))
	if c.guid != spikeCoGUID+"-00000002" || c.masterId != "2" || c.alterId != "4" {
		t.Fatalf("taken: guid %q masterId %q alterId %q", c.guid, c.masterId, c.alterId)
	}
	if c.narr != "spike receipt 212" || c.vchType != "Receipt" || c.vchNo != "1" {
		t.Fatalf("taken: narr %q type %q no %q", c.narr, c.vchType, c.vchNo)
	}
	if strings.Join(c.ledgers, "|") != "Spike Customer|Spike Cash" {
		t.Fatalf("ledgers: %v", c.ledgers)
	}
	// a wrong date or number is still refused (the check reads Tally's DATE, never skips it)
	w := spikeWant
	w.date = "20261003"
	if why, _ := liveVoucherWrong(x[0], "voucher with MasterID 2", w); why == "" || !strings.Contains(why, "02-Oct-2026") {
		t.Fatalf("another date: %q", why)
	}
	w = spikeWant
	w.mid = "3"
	w.cguid = "another-co"
	if why, _ := liveVoucherWrong(x[0], "voucher with MasterID 3", w); why == "" {
		t.Fatal("another MasterID taken")
	}
}

// --- 5. the CMPINFO counters are never vouchers, companies or ledgers
func TestRealTally71CountersAreNotObjects(t *testing.T) {
	for name, want := range map[string]int{"fetch-C.xml": 1, "fetch-An.xml": 1, "fetch-H.xml": 0, "vouchers-d.xml": 5} {
		raw := realTally(t, name)
		if n := len(reVchBlock.FindAllString(raw, -1)); n != want {
			t.Errorf("%s: reVchBlock found %d, want %d", name, n, want)
		}
		if n := len(reVoucher.FindAllString(raw, -1)); n != want {
			t.Errorf("%s: reVoucher found %d, want %d", name, n, want)
		}
		if n := countVouchers(raw); n != want {
			t.Errorf("%s: countVouchers %d, want %d", name, n, want)
		}
		if n := len(fetchTestVouchers(raw)); n != want {
			t.Errorf("%s: fetchTestVouchers %d, want %d", name, n, want)
		}
		if n := len(vchNodes(xmlDoc(raw))); n != want {
			t.Errorf("%s: decoded %d vouchers, want %d", name, n, want)
		}
	}
	// the company list: the one company, never the counter <COMPANY>0</COMPANY>
	cos := xmlDoc(realTally(t, "company-list.xml")).All("COMPANY")
	if len(cos) != 1 || nameOf(cos[0]) != spikeCo || nt(cos[0], "GUID") != spikeCoGUID {
		t.Fatalf("the company list read as %d companies", len(cos))
	}
}

// --- 6. the company check reads the company, never CMPINFO's counter <COMPANY>0</COMPANY> that comes first (2.2.2
// took the counter as the company: no GUID, no change numbers)
func TestRealTally71CompanyNotCounter(t *testing.T) {
	_, f, _ := realTallyBridge(t, "", map[string]string{"FinComCompany": strings.Replace(realTally(t, "company-list.xml"), "</GUID>",
		`</GUID><ALTVCHID TYPE="Number"> 9</ALTVCHID><ALTMSTID TYPE="Number"> 21</ALTMSTID>`, 1)})
	g, given, err := companyCheckNumbers(&TC{copier: true}, spikeCo, f.port)
	if err != nil || g != spikeCoGUID || !given || companyAlter(spikeCo) != 9 || companyAlterM(spikeCo) != 21 {
		t.Fatalf("the company check: guid %q given %v (%d, %d) %v", g, given, companyAlter(spikeCo), companyAlterM(spikeCo), err)
	}
}

// --- 7. the keeper's list and the day files read the real answer (five vouchers, Tally's AlterIDs and dates)
func TestRealTally71KeepList(t *testing.T) {
	raw := realTally(t, "vouchers-d.xml")
	_, f, _ := realTallyBridge(t, `,"ReadDays":true`, map[string]string{"TDSDeskKeepList": raw})
	got, err := keepList(&TC{copier: true}, spikeCo, f.port, "20260401", "20270331", 0)
	if err != nil {
		t.Fatal(err)
	}
	var s []string
	for _, e := range got {
		s = append(s, e.guid[len(spikeCoGUID)+1:]+"/"+fmt.Sprint(e.alter)+"/"+e.date)
	}
	sort.Strings(s)
	if strings.Join(s, " ") != "00000001/1/20260401 00000002/9/20261002 00000003/5/20261002 00000004/7/20261002 00000005/8/20261002" {
		t.Fatalf("the keep list: %v", s)
	}
	if ix := indexText(raw); strings.Count(ix, "\n") != 5 || !strings.Contains(ix, spikeCoGUID+"-00000002\t9\n") {
		t.Fatalf("the day index: %q", ix)
	}
	dir := t.TempDir()
	if n, _ := saveKeepDaysChanged(dir, "20260401", "20261031", raw, true); n != 5 {
		t.Fatalf("the day files hold %d vouchers", n)
	}
	if n := copyVouchers(dir, "20261002", "20261002"); n != 4 {
		t.Fatalf("02-Oct-2026 holds %d vouchers", n)
	}
	if why := dayBookIncomplete(raw); why != "" {
		t.Fatalf("a complete real answer called incomplete: %s", why)
	}
}

// --- 8. the held copy: a cancelled voucher (ISCANCELLED TYPE="Logical" Yes) moves no ledger; a live one does, with
// its typed LEDGERNAME and AMOUNT
func TestRealTally71HeldCopy(t *testing.T) {
	vs := reVchBlock.FindAllString(realTally(t, "vouchers-d.xml"), -1)
	byMid := map[string]string{}
	for _, v := range vs {
		if m := regexp.MustCompile(`<MASTERID[^>]*>\s*(\d+)`).FindStringSubmatch(v); m != nil {
			byMid[m[1]] = v
		}
	}
	if len(vs) != 5 || len(byMid) != 5 || !strings.Contains(byMid["2"], `<ISCANCELLED TYPE="Logical">Yes</ISCANCELLED>`) {
		t.Fatalf("the fixture: %d blocks, %d vouchers", len(vs), len(byMid))
	}
	if ls := voucherLines(byMid["3"]); len(ls) != 2 || ls[0].ledger == "" || strings.TrimSpace(ls[0].amount) == "" {
		t.Fatalf("the lines of MasterID 3: %+v", ls)
	}
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	h := &heldCopy{dir: dir, from: "20260401"}
	_ = os.WriteFile(filepath.Join(dir, "days", "20261002.xml"), []byte(byMid["2"]), 0o644)
	for l, v := range h.moves("20261002", "20261002") {
		if v != 0 {
			t.Fatalf("a cancelled voucher moved %s by %v", l, v)
		}
	}
	_ = os.WriteFile(filepath.Join(dir, "days", "20261002.xml"), []byte(byMid["3"]), 0o644)
	m := h.moves("20261002", "20261002")
	moved := 0
	for _, v := range m {
		if v != 0 {
			moved++
		}
	}
	if moved != 2 {
		t.Fatalf("a live voucher moved %d ledgers: %v", moved, m)
	}
}

// --- 9. end to end: a line of the real add-on for Receipt 212 (MasterID 2), the body fetch answered by the real Tally's
// own answer: the line goes with Tally's GUID, MasterID, AlterID and body (2.2.2 sent it held, "no voucher")
func TestRealTally71LineTakesBody(t *testing.T) {
	p, f, c := realTallyBridge(t, "", map[string]string{vchObjectID: realTally(t, "fetch-C.xml")})
	liveAppend(t, p, "FCR1|ev=voucher_accept_post|t0=2-Oct-26 10:55|tw=2-Oct-26 10:55|cguid="+spikeCoGUID+"|cname="+spikeCo+
		"|user=TALLY User|obj=Voucher|guid="+spikeCoGUID+"-00000000|mid=2|aid=0|vtype=Receipt|vno=1|vdate=2-Oct-26|name=|parent=|narr=spike receipt 212|t1=2-Oct-26 10:55|src=live")
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 {
		t.Fatalf("sent %d lines: %v", len(sent), sent)
	}
	g := sent[0]
	if str(g["object_guid"]) != spikeCoGUID+"-00000002" || str(g["master_id"]) != "2" || toI64(g["alter_id"]) != 4 || str(g["heldWhy"]) != "" {
		t.Fatalf("the line went as %v", g)
	}
	if !strings.Contains(str(g["xml"]), `<MASTERID> 2</MASTERID>`) { // next-fastfetch: stripped, no attributes
		t.Fatalf("the body: %s", cut(str(g["xml"]), 300))
	}
	if f.n(vchObjectID) != 1 {
		t.Fatalf("requests: %v", f.ids())
	}
}

func mapKeys(m map[string]string) []string {
	var o []string
	for k := range m {
		o = append(o, k)
	}
	sort.Strings(o)
	return o
}
