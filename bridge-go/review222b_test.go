package main

// Bridge 2.2.2, the code review and the security review of 4dc55ef..f3a28e2 (05-Oct-2026): one test per finding,
// written before the fix.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func r222bSent(c *standCloud, no string) []M { return nwsByNo(c.recSent(), no) }

// --- code H1: a voucher duplicated from one FinCom posted copies its narration ("TDSDesk:<id>"): no FinCom-id
// exemption for a voucher saved in a form; its entry is fetched and checked; the copied id goes only as lineFid
func TestR222bH1CopiedFinComID(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	src := r222Vch(f, 25414, "Journal", "J-10", "20261005", 51986)
	src.narr = "TDSDesk:fin9 | rent"
	nv := r222Vch(f, 25683, "Journal", "J-55", "20261005", 54500)
	nv.narr = "TDSDesk:fin9 | rent"
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "10:00", src.guid, "25414", "51986", "Journal", "J-55", "5-Oct-2026", "TDSDesk:fin9 | rent"),
		r222Line("voucher_accept_post", "10:00", src.guid, "25683", "51986", "Journal", "J-55", "5-Oct-2026", "TDSDesk:fin9 | rent"))
	readAndUploadAll(t)
	got := r222bSent(c, "J-55")
	if len(got) != 1 || str(got[0]["event"]) != "created" || str(got[0]["object_guid"]) != nv.guid || str(got[0]["xml"]) == "" {
		t.Fatalf("the copied entry: %v", got)
	}
	if str(got[0]["fid"]) != "" || str(got[0]["lineFid"]) != "fin9" {
		t.Fatalf("the copied FinCom id: fid %q lineFid %q", got[0]["fid"], got[0]["lineFid"])
	}
	// its pre alone (no post): never an alteration of the source with the source's ids
	src2 := r222Vch(f, 25415, "Journal", "J-11", "20261005", 54395)
	src2.narr = "TDSDesk:fin10 | x"
	nv2 := r222Vch(f, 25690, "Journal", "J-56", "20261005", 54510)
	liveAppend(t, p, r222Line("voucher_accept_pre", "10:01", src2.guid, "25415", "54395", "Journal", "J-56", "5-Oct-2026", "TDSDesk:fin10 | x"))
	liveFlushAll()
	readAndUploadAll(t)
	got = r222bSent(c, "J-56")
	if len(got) != 1 || str(got[0]["object_guid"]) != nv2.guid || str(got[0]["event"]) != "created" || str(got[0]["fid"]) != "" {
		t.Fatalf("the pre alone: %v", got)
	}
}

// --- code H2: a duplicated voucher's pre alone carries the source's own (agreeing) ids: Tally's voucher with that
// MasterID was not saved after the line (its ALTERID is the line's): not taken; by number when the line has one
// (created), else held; the later post alone does not make a second line
func TestR222bH2LonePreSourceIds(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	src := r222Vch(f, 25500, "Journal", "", "20261005", 54395)
	liveAppend(t, p, r222Line("voucher_accept_pre", "10:10", src.guid, "25500", "54395", "Journal", "", "5-Oct-2026", "copy"))
	liveFlushAll()
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["xml"]) != "" || str(sent[0]["object_guid"]) != "" || !strings.Contains(str(sent[0]["heldWhy"]), "not saved after this line") {
		t.Fatalf("the source's body taken for an unnumbered copy: %s", jsonText(sent))
	}
	src2 := r222Vch(f, 25501, "Journal", "J-20", "20261005", 54396)
	nv := r222Vch(f, 25510, "Journal", "J-21", "20261005", 54520)
	liveAppend(t, p, r222Line("voucher_accept_pre", "10:11", src2.guid, "25501", "54396", "Journal", "J-21", "5-Oct-2026", "copy 2"))
	liveFlushAll()
	readAndUploadAll(t)
	liveAppend(t, p, r222Line("voucher_accept_post", "10:11", src2.guid, "25510", "54396", "Journal", "J-21", "5-Oct-2026", "copy 2"))
	liveFlushAll()
	readAndUploadAll(t)
	got := r222bSent(c, "J-21")
	if len(got) != 1 || str(got[0]["event"]) != "created" || str(got[0]["object_guid"]) != nv.guid {
		t.Fatalf("J-21: %v", got)
	}
}

// --- code M1: a new voucher that went WITH its body is not sent again by the next version's re-scan
func TestR222bRescanSkipsSentWithBody(t *testing.T) {
	old := BridgeVersion
	t.Cleanup(func() { BridgeVersion = old })
	p, f, c := r222bBridge(t, "")
	r222Vch(f, 25800, "Journal", "J-80", "20261005", 54540)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "10:20", nwsGUID+"-00000000", "0", "0", "Journal", "J-80", "5-Oct-2026", "new"),
		r222Line("voucher_accept_post", "10:20", nwsGUID+"-00000000", "25800", "0", "Journal", "J-80", "5-Oct-2026", "new"))
	readAndUploadAll(t)
	if s := c.recSent(); len(s) != 1 || str(s[0]["xml"]) == "" {
		t.Fatalf("first: %v", s)
	}
	BridgeVersion = "2.2.9"
	liveResetState()
	readAndUploadAll(t)
	readAndUploadAll(t)
	if s := c.recSent(); len(s) != 1 {
		t.Fatalf("sent again by the re-scan: %d lines", len(s))
	}
}

// --- code M2: a try is counted only when Tally answered
func TestR222bTriesOnlyWhenAnswered(t *testing.T) {
	p, f, _ := r222bBridge(t, `,"RecorderResolveSec":0`)
	liveAppend(t, p, r222Line("voucher_accept_pre", "10:30", nwsGUID+"-00000000", "0", "0", "Receipt", "901", "5-Oct-2026", "never"))
	liveFlushAll()
	readAndUploadAll(t)
	_, items := liveHeldLoad()
	before := -1
	for _, h := range items {
		before = h.Tries
	}
	f.srv.Close()
	for i := 0; i < 10; i++ {
		liveUploadOnce()
	}
	_, items = liveHeldLoad()
	for _, h := range items {
		if h.Tries != before {
			t.Fatalf("tries counted without an answer: %d -> %d", before, h.Tries)
		}
	}
}

// --- code M3 / security L4: after the hard stop Tally is still working: the background reads hold back (nothing more
// is sent into it); a person's read is not held; the stop is not Tally's silence
func TestR222bStopHoldsBackgroundOnly(t *testing.T) {
	p, f, _ := r222bBridge(t, "")
	setCfg("RecorderBodySec", float64(20))
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26311" {
			v.alter = 54395
		}
	}
	f.slow = func(id, body string) time.Duration {
		if id == vchByMasterID {
			return 4 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "10:40", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "a"),
		r222Line("voucher_accept_post", "10:40", r222GUID(26311), "26311", "54395", "Receipt", "191", "5-Oct-2026", "a"))
	readAndUploadAll(t)
	n := f.n(vchByMasterID)
	if n != 1 {
		t.Fatalf("asked %d", n)
	}
	// 2.3.1: never a stop of reading (the self-watch's silence is gone); the background waits for the retry schedule
	if readStop() != nil || !retryHeld() {
		t.Fatalf("after the stop: reading %v, retry pending %v", readStop(), retryHeld())
	}
	if _, err := fetchVouchersByMasterIn(recorderTC(nil), nwsCo, f.port, "20261005", []string{"26312"}, 5); err == nil || f.n(vchByMasterID) != n {
		t.Fatalf("a background read sent into Tally right after the stop: %v (%d requests)", err, f.n(vchByMasterID))
	}
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	if _, err := getLedgerNames(&TC{copier: true, person: true}, nwsCo, f.port); err != nil {
		t.Fatalf("a person's read held: %v", err)
	}
}

// --- code M4, as the coordinator corrected it (05-Oct-2026): Tally keeps an entry's ORIGINAL GUID when it came by Tally
// synchronisation or an XML import (another company's prefix, the source's MasterID in it). (a) the company's prefix and
// its own MASTERID in hex: taken; (b) another prefix: taken when Tally's MASTERID is the one asked and type, date and
// number match, sent with that GUID, an alteration staying altered and the line not flagged; (c) the company's prefix
// with another suffix: refused (it cannot be Tally's own)
func TestR222bForeignGUID(t *testing.T) {
	p, f, c := r222bBridge(t, `,"RecorderResolveSec":0`)
	foreign := "9a9a9a9a-1111-2222-3333-444444444444-00001234"
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: foreign, master: "25900", date: "20261005", typ: "Journal", no: "J-90", narr: "synced", party: "Customer A",
		alter: 54530, lines: [][2]string{{"Customer A", "1.00"}, {"Bank", "-1.00"}}},
		&tVch{guid: r222GUID(25414), master: "25901", date: "20261005", typ: "Journal", no: "J-91", narr: "odd", party: "Customer A",
			alter: 54531, lines: [][2]string{{"Customer A", "1.00"}, {"Bank", "-1.00"}}})
	f.mu.Unlock()
	own := r222Vch(f, 25902, "Journal", "J-92", "20261005", 54532)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "10:50", foreign, "25900", "54500", "Journal", "J-90", "5-Oct-2026", "synced"),
		r222Line("voucher_accept_post", "10:50", foreign, "25900", "54530", "Journal", "J-90", "5-Oct-2026", "synced"),
		r222Line("voucher_accept_pre", "10:51", own.guid, "25902", "54400", "Journal", "J-92", "5-Oct-2026", "own"),
		r222Line("voucher_accept_post", "10:51", own.guid, "25902", "54532", "Journal", "J-92", "5-Oct-2026", "own"),
		r222Line("voucher_accept_post", "10:52", nwsGUID+"-00000000", "25901", "0", "Journal", "", "5-Oct-2026", "odd"))
	readAndUploadAll(t)
	for i := 0; i < 5; i++ {
		liveUploadOnce()
	}
	b := r222bSent(c, "J-90")
	if len(b) != 1 || str(b[0]["event"]) != "altered" || str(b[0]["object_guid"]) != foreign || str(b[0]["xml"]) == "" || b[0]["idsMismatch"] != nil || toI64(b[0]["alter_id"]) != 54530 {
		t.Fatalf("(b) a synchronised voucher: %v", b)
	}
	a := r222bSent(c, "J-92")
	if len(a) != 1 || str(a[0]["object_guid"]) != own.guid || str(a[0]["xml"]) == "" {
		t.Fatalf("(a) the company's own GUID: %v", a)
	}
	var cc M
	for _, s := range c.recSent() {
		if str(s["narration"]) == "odd" {
			cc = s
		}
	}
	if cc == nil || str(cc["xml"]) != "" || str(cc["object_guid"]) != "" || !strings.Contains(str(cc["heldWhy"]), "cannot be Tally's own") {
		t.Fatalf("(c) the company's prefix with another suffix: %v", cc)
	}
	if f.n(vchByNumberID) != 0 {
		t.Fatalf("asked by number: %v", f.ids())
	}
}

// --- code L2 (and L1): the 2 s limit starts at the send, after the gentle wait (GentleMs)
func TestR222bLimitAfterGentleWait(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	setCfg("RecorderBodySec", float64(20))
	setCfg("GentleMs", float64(1500))
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26311" {
			v.alter = 54395
		}
	}
	f.slow = func(id, body string) time.Duration {
		if id == vchByMasterID {
			return time.Second
		}
		return 0
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "11:00", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "g"),
		r222Line("voucher_accept_post", "11:00", r222GUID(26311), "26311", "54395", "Receipt", "191", "5-Oct-2026", "g"))
	readAndUploadAll(t)
	if s := c.recSent(); len(s) != 1 || str(s[0]["xml"]) == "" || retryHeld() {
		t.Fatalf("a 1 s answer after a 1.5 s gentle wait was stopped: %v", s)
	}
}

// --- code L3: a voucher line with no date, or an alteration with no MasterID: plain words
func TestR222bNoDateNoMaster(t *testing.T) {
	p, _, c := r222bBridge(t, "")
	liveAppend(t, p,
		r222Line("voucher_accept_post", "11:10", r222GUID(26311), "26311", "54391", "Receipt", "191", "", "no date"),
		r222Line("voucher_accept_post", "11:11", r222GUID(26312), "", "54392", "Receipt", "192", "5-Oct-2026", "no master"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 2 {
		t.Fatalf("sent: %v", sent)
	}
	for _, s := range sent {
		if str(s["heldWhy"]) == "" {
			t.Errorf("no words: %s", jsonText(s))
		}
	}
}

// --- code L4: a pair whose pre carries another entry's GUID is flagged; a resolved line keeps the flag
func TestR222bPreMismatchFlagged(t *testing.T) {
	p, f, c := r222bBridge(t, "") // 2.3.3: its one ask again on the held list's spacing (10 minutes), by when Tally has it
	src := r222Vch(f, 25414, "Journal", "J-10", "20261005", 51986)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "11:20", src.guid, "25414", "51986", "Journal", "J-95", "5-Oct-2026", "x"),
		r222Line("voucher_accept_post", "11:20", nwsGUID+"-00000000", "25960", "0", "Journal", "J-95", "5-Oct-2026", "x"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || sent[0]["idsMismatch"] != true || str(sent[0]["lineGuid"]) != src.guid {
		t.Fatalf("the pre's GUID not flagged: %s", jsonText(sent))
	}
	r222Vch(f, 25960, "Journal", "J-95", "20261005", 54560)
	at := nowFn().Add(11 * time.Minute)
	nowFn = func() time.Time { return at }
	readAndUploadAll(t)
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 2 || !strings.HasSuffix(str(sent[1]["line_id"]), ":resolved") || sent[1]["idsMismatch"] != true || str(sent[1]["lineGuid"]) != src.guid {
		t.Fatalf("the resolved line: %s", jsonText(sent))
	}
}

// --- code L6 / security L7: recorderSeen: the daily file's name in any case, and only with a valid line of that GUID
func TestR222bRecorderSeenStrict(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	cur := func() M { return obj(obj(beatBody(true, "open", "", nil, nil, nil)["changeNumbers"])[zz]) }
	day := time.Now().Format("20060102")
	junk := filepath.Join(rec, "co-guid-1-"+day+".txt")
	_ = os.WriteFile(junk, []byte("not a recorder line"), 0o644)
	if c := cur(); c["recorderSeen"] != false {
		t.Fatalf("a file with no valid line: %v", c)
	}
	_ = os.Remove(junk)
	_ = os.WriteFile(filepath.Join(rec, "CO-GUID-1-"+day+".TXT"), utf16leBOM(r18Line1+"\r\n"), 0o644)
	if c := cur(); c["recorderSeen"] != true {
		t.Fatalf("an upper-case name: %v", c)
	}
}

// --- security M1 / L6: a voucher below the starting point is refused with generic words (nothing of it named); the
// request by MasterID needs a starting point
func TestR222bBelowStartGeneric(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	r222Vch(f, 25000, "Payment", "P-SECRET", "20261005", 54000)
	liveAppend(t, p, r222Line("voucher_accept_post", "11:30", nwsGUID+"-00000000", "25000", "0", "Journal", "", "5-Oct-2026", "forged"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 {
		t.Fatalf("sent: %v", s)
	}
	w := str(s[0]["heldWhy"])
	if w != "Tally's voucher with that MasterID is not a change after the starting point" || strings.Contains(jsonText(s[0]), "P-SECRET") || strings.Contains(jsonText(s[0]), "Payment") {
		t.Fatalf("the words: %q", w)
	}
	if err := datedRefused(&TC{copier: true}, voucherByMasterRequest("NO START CO", "20261005", []string{"1"})); err == nil {
		t.Fatal("a request by MasterID for a company with no starting point passes the guard")
	}
}

// --- security L2: the sizes: heldWhy, lineGuid, type, number and user capped; a line too big goes marked, cut
func TestR222bCaps(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	long := strings.Repeat("Q", 300)
	bad := nwsGUID + "-" + strings.Repeat("z<", 100)
	nv := r222Vch(f, 25970, "Journal", "J-97", "20261005", 54570)
	nv.narr = strings.Repeat("n", liveMaxBytes+10)
	liveAppend(t, p,
		strings.Replace(r222Line("after_delete", "11:40", bad, "25683", "1", long, long, "5-Oct-2026", "x"), "|user=owner|", "|user="+long+"|", 1),
		r222Line("voucher_accept_post", "11:41", r222GUID(25970), "25970", "54560", "Journal", "J-97", "5-Oct-2026", "big"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 2 {
		t.Fatalf("sent %d (a big line blocks the feed?)", len(sent))
	}
	a := sent[0]
	if len(str(a["lineGuid"])) > 80 || strings.Contains(str(a["lineGuid"]), "<") || len(str(a["vch_type"])) > 200 || len(str(a["vch_no"])) > 200 || len(str(a["user"])) > 200 {
		t.Fatalf("not capped: %s", cut(jsonText(a), 600))
	}
	if sent[1]["oversize"] != true || len(jsonText(sent[1])) > liveMaxBytes {
		t.Fatalf("the big line: oversize %v, %d bytes", sent[1]["oversize"], len(jsonText(sent[1])))
	}
	if len([]rune(liveCapWhy(strings.Repeat("w", 900)))) > 300 {
		t.Fatal("heldWhy not capped")
	}
}

// --- security L3: the held list is capped; the resolver does not ask by number when the MasterID gave another real
// voucher; Tally is asked outside the held list's lock
func TestR222bHeldBounds(t *testing.T) {
	p, f, _ := r222bBridge(t, `,"RecorderResolveSec":0`)
	var cs []*change
	for i := 0; i < 600; i++ {
		cs = append(cs, &change{lineId: fmt.Sprintf("cap-%03d", i), company: nwsCo, companyGuid: nwsGUID, event: "altered", vchType: "Journal", vchNo: fmt.Sprint("C-", i),
			vchDate: "20261001", masterId: "1", at: "2026-10-05T07:00:00Z"})
	}
	liveHeldAdd(cs)
	if _, items := liveHeldLoad(); len(items) != 500 {
		t.Fatalf("held list: %d (cap 500 a company)", len(items))
	}
	_ = os.Remove(liveHeldFile())
	r222Vch(f, 25683, "Payment", "P-9", "20261005", 54580)
	locked := 0
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if heldMu.TryLock() {
			heldMu.Unlock()
		} else {
			locked++
		}
		return 0
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "11:50", nwsGUID+"-00000000", "0", "0", "Journal", "J-98", "5-Oct-2026", "x"),
		r222Line("voucher_accept_post", "11:50", nwsGUID+"-00000000", "25683", "0", "Journal", "J-98", "5-Oct-2026", "x"))
	readAndUploadAll(t)
	n := f.n(vchByNumberID)
	for i := 0; i < 3; i++ {
		liveUploadOnce()
	}
	if f.n(vchByNumberID) != n {
		t.Fatalf("the resolver asked by number although the MasterID gave another voucher: %d -> %d", n, f.n(vchByNumberID))
	}
	if locked > 0 {
		t.Fatalf("Tally asked %d time(s) while the held list was locked", locked)
	}
}

// --- security L5: the by-number guard's "a line the bridge is asking for" means a real line: a request for an old day
// not tied to a queued or held line is refused
func TestR222bByNumberAskMeansALine(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	laterBy(t, 5*24*time.Hour)
	if _, err := fetchVoucherByNumber(recorderTC(nil), nwsCo, f.port, "20261005", "Receipt", "191", 5); err == nil {
		t.Fatal("a request by number for a day 5 days back, with no line asking for it, passed the guard")
	}
}

// --- security L7: Tally's voucher is taken only under the company GUID held for the company
func TestR222bHeldCompanyGUID(t *testing.T) {
	r222bBridge(t, "")
	x := (&tVch{guid: "other-co-00006453", master: "25683", date: "20261005", typ: "Journal", no: "J-1", alter: 54600}).xml()
	if why, _ := liveVoucherWrong(x, "voucher with MasterID 25683", liveWant{company: nwsCo, cguid: "other-co", typ: "Journal", no: "J-1", date: "20261005", sp: 54389, spOK: true}); why == "" {
		t.Fatal("a voucher under another company GUID than the one held was taken")
	}
}

// NWS144's bridge with the body fetch's 20 s (the background read waits its turn behind the company lookup, about 4 s
// on the stand, so 3 s leave no time for the fallback by number)
func r222bBridge(t *testing.T, extra string) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := nwsBridge(t, extra)
	setCfg("RecorderBodySec", float64(20))
	return p, f, c
}
