package main

// The owner's NWS144 line 18 (bridge 2.2.4, 06-Oct-2026 05:50 IST, staging tally_recorder_lines id 18): Receipt 213,
// created, MasterID 26409, GUID ...-00006729, AlterID 54493, sent WITH Tally's voucher XML (3,060 characters), held by
// the cloud with an empty body (its reader did not take typed fields; fixed in server/tally-cloud/parse.js). Here: the
// bridge's side, that the XML it sends is the whole voucher element as Tally gave it (every ledger line and bill-wise
// allocation, nothing cut). Tests written first.

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// the owner's voucher answered by FinComVoucherByMaster, typed as a real TallyPrime 7.1 writes it (testdata/typed-like-7.1)
func b230Answer(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "typed-like-7.1", "receipt-213-by-master.xml"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func b230Element(x string) string {
	i := strings.Index(x, "<VOUCHER REMOTEID")
	return x[i : strings.Index(x[i:], "</VOUCHER>")+i+len("</VOUCHER>")]
}

// a voucher line of NWS144 on a given day as the live add-on writes it ("6-Oct-2026")
func b230Line(ev, day, tm, guid, mid, aid, typ, no, narr string) string {
	return "FCR1|ev=" + ev + "|t0=" + day + " " + tm + "|tw=" + day + " " + tm + "|cguid=" + nwsGUID + "|cname=" + nwsCo + "|user=owner|obj=Voucher|guid=" + guid +
		"|mid=" + mid + "|aid=" + aid + "|vtype=" + typ + "|vno=" + no + "|vdate=" + day + "|name=|parent=|narr=" + narr + "|t1=" + day + " " + tm + "|src=live"
}

// NWS144's bridge on 06-Oct-2026 at 05:50 IST (the starting point 54389 as on staging)
func b230Bridge(t *testing.T, extra string) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := r222bBridge(t, extra)
	at := time.Date(2026, 10, 6, 5, 50, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	return filepath.Join(filepath.Dir(p), nwsGUID+"-20261006.txt"), f, c
}

// --- Part 1: the line goes with the WHOLE voucher element Tally gave: its two ledger lines, the bill-wise allocation
// (NAME, BILLTYPE, AMOUNT) inside the party's line, the typed fields as they are; nothing cut or rebuilt
func TestBody230BridgeSendsWholeTypedVoucher(t *testing.T) {
	p, f, c := b230Bridge(t, "")
	ans := b230Answer(t)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchByMasterID && strings.Contains(body, "$MasterID = 26409") {
			_, _ = w.Write([]byte(ans))
			return true
		}
		return false
	}
	f.mu.Unlock()
	g := r222GUID(26409)
	liveAppend(t, p, b230Line("voucher_accept_post", "6-Oct-2026", "05:50", nwsGUID+"-00000000", "26409", "0", "Receipt", "213", "x")) // a new entry: Form Accept, before the save
	readAndUploadAll(t)
	var s M
	for _, x := range c.recSent() {
		if str(x["vch_no"]) == "213" {
			s = x
		}
	}
	if s == nil {
		t.Fatalf("Receipt 213 not sent: %v", c.recSent())
	}
	x, want := str(s["xml"]), cleanXML(b230Element(ans))
	if str(s["event"]) != "created" || str(s["object_guid"]) != g || toI64(s["alter_id"]) != 54493 || str(s["master_id"]) != "26409" {
		t.Fatalf("Receipt 213's ids: %v %v %v %v", s["event"], s["object_guid"], s["alter_id"], s["master_id"])
	}
	if x != want {
		t.Fatalf("the XML sent is not Tally's whole voucher element (%d characters, Tally's %d):\n%s", len(x), len(want), x)
	}
	for _, part := range []string{`<LEDGERNAME TYPE="String">Salesify Marketing LLP</LEDGERNAME>`, `<LEDGERNAME TYPE="String">Cash</LEDGERNAME>`,
		`<AMOUNT TYPE="Amount">59000.00</AMOUNT>`, `<AMOUNT TYPE="Amount">-59000.00</AMOUNT>`, "<NAME>GSC/2026-27/118</NAME>", `<BILLTYPE TYPE="String">Agst Ref</BILLTYPE>`,
		"<AMOUNT>59000.00</AMOUNT>", "</BILLALLOCATIONS.LIST>", "</VOUCHER>"} {
		if !strings.Contains(x, part) {
			t.Fatalf("the XML sent lacks %q", part)
		}
	}
	if n := strings.Count(x, "<ALLLEDGERENTRIES.LIST>"); n != 2 || len(x) < 2900 {
		t.Fatalf("%d ledger lines, %d characters", n, len(x))
	}
}

// --- Part 2 (the owner: "the bridge must ask again for held lines of its own user and settle them"). FinCom's beat answer
// carries refetch: at most 20 of THIS bridge's own held lines whose body is missing or whose GUID is a placeholder. The
// bridge asks its own Tally again with the allow-listed reads it has (FinComVoucherByMaster when a MasterID is known,
// else FinComVoucherByNumber), only for a company its own Tally has open, never during a posting, within its 2-second
// stop, one refetch line a turn, each at most every 10 minutes, 20 tries at most over 7 days (a try counted by an older
// bridge, which could not read a real Tally's typed answer, does not count), and sends "<line id>:resolved" with Tally's
// own GUID, AlterID and body. Staging's lines: 4 (Receipt 192 altered, MasterID 26312, placeholder GUID, AlterID 0), 17
// (Receipt 212 of 05-Oct created, no MasterID: asked by type and number) and 18 (Receipt 213 created, MasterID 26409,
// sent WITH its body, which the cloud could not read: the bridge thinks it sent it)

func b230Row(id, event, mid, typ, no, date string) M { return r222cRow(id, event, mid, typ, no, date) }

// NWS144's Tally with Receipts 212 (no MasterID on its line) and 213 besides 190..192
func b230Tally(f *standTally) {
	f.mu.Lock()
	f.vch = append(f.vch,
		&tVch{guid: r222GUID(26408), master: "26408", date: "20261005", typ: "Receipt", no: "212", narr: "Receipt 212", party: "Customer A", alter: 54480,
			lines: [][2]string{{"Customer A", "1200.00"}, {"Cash", "-1200.00"}}},
		&tVch{guid: r222GUID(26409), master: "26409", date: "20261006", typ: "Receipt", no: "213", narr: "Receipt 213", party: "Salesify Marketing LLP", alter: 54493,
			lines: [][2]string{{"Salesify Marketing LLP", "59000.00"}, {"Cash", "-59000.00"}}})
	f.mu.Unlock()
}

func b230Resolved(c *standCloud, id string) M {
	s := r222cSentID(c, id+":resolved")
	if len(s) == 0 {
		return nil
	}
	return s[len(s)-1]
}

// every refetch line resolved, one a turn
func b230Turns(n int) {
	for i := 0; i < n; i++ {
		liveResolveTurn()
		liveUploadOnce()
	}
}

func TestBody230RefetchSettlesLines4_17_18(t *testing.T) {
	_, f, c := b230Bridge(t, `,"RecorderResolveSec":0`)
	b230Tally(f)
	// line 18: the bridge sent it WITH its body (2.2.4), so it counts it sent; the old heldLines list skips it
	live.mu.Lock()
	liveFresh()
	live.sent["L18"], live.bodied["L18"] = true, true
	live.mu.Unlock()
	rows := []any{b230Row("L4", "altered", "26312", "Receipt", "192", "20261005"), b230Row("L17", "created", "", "Receipt", "212", "20261005"),
		b230Row("L18", "created", "26409", "Receipt", "213", "20261006")}
	applyHeldLines(M{"heldLines": rows})
	if _, items := liveHeldLoad(); items["L18"].ID != "" {
		t.Fatal("precondition: heldLines takes line 18 (sent with its body) already")
	}
	// line 4 sat in the held list with 20 tries counted by 2.2.3 (which could not read Tally's typed answer)
	heldMu.Lock()
	all, items := liveHeldLoad()
	items["L4"] = heldLine{ID: "L4", Company: nwsCo, CGUID: nwsGUID, Type: "Receipt", No: "192", Date: "20261005", MID: "26312", Ev: "altered",
		Added: nowFn().Add(-20 * time.Hour).Format(time.RFC3339), Tries: liveHeldMaxTries, Why: liveHeldGiveUp}
	liveHeldSave(all, items)
	heldMu.Unlock()
	c.mu.Lock()
	c.beatReply = M{"refetch": rows}
	c.mu.Unlock()
	beatOnce() // the cloud stub sends the list in the beat's answer
	_, items = liveHeldLoad()
	for _, id := range []string{"L4", "L17", "L18"} {
		if h := items[id]; h.ID == "" || !h.Refetch || h.Tries != 0 {
			t.Fatalf("%s not in the held list to be asked again: %+v", id, h)
		}
	}
	b230Turns(6)
	s4, s17, s18 := b230Resolved(c, "L4"), b230Resolved(c, "L17"), b230Resolved(c, "L18")
	if s4 == nil || str(s4["event"]) != "altered" || str(s4["object_guid"]) != r222GUID(26312) || toI64(s4["alter_id"]) != 54392 || !strings.Contains(str(s4["xml"]), "<VOUCHERNUMBER>192</VOUCHERNUMBER>") {
		t.Fatalf("line 4: %v", s4)
	}
	if s17 == nil || str(s17["event"]) != "created" || str(s17["object_guid"]) != r222GUID(26408) || str(s17["master_id"]) != "26408" || toI64(s17["alter_id"]) != 54480 {
		t.Fatalf("line 17 (by type and number): %v", s17)
	}
	if s18 == nil || str(s18["event"]) != "created" || str(s18["object_guid"]) != r222GUID(26409) || toI64(s18["alter_id"]) != 54493 || !strings.Contains(str(s18["xml"]), "Salesify Marketing LLP") {
		t.Fatalf("line 18: %v", s18)
	}
	if f.n(vchByNumberID) < 1 || f.n(vchByMasterID) < 2 {
		t.Fatalf("asked by number %d, by MasterID %d", f.n(vchByNumberID), f.n(vchByMasterID))
	}
	// once: listed again (the cloud has not answered yet), nothing more is asked or sent
	k := f.n(vchByMasterID) + f.n(vchByNumberID)
	applyRefetch(M{"refetch": rows})
	b230Turns(3)
	if f.n(vchByMasterID)+f.n(vchByNumberID) != k || len(r222cSentID(c, "L4:resolved")) != 1 || len(r222cSentID(c, "L17:resolved")) != 1 || len(r222cSentID(c, "L18:resolved")) != 1 {
		t.Fatalf("asked or sent again: %d -> %d asks", k, f.n(vchByMasterID)+f.n(vchByNumberID))
	}
}

// line 17 on 09-Oct (four days after its date, outside the 3-day window of the request by number): the resolver's ask is
// the line's own (registered first), so it still goes; asked by type and number on 05-Oct only
func TestBody230RefetchByNumberAfterThreeDays(t *testing.T) {
	_, f, c := b230Bridge(t, `,"RecorderResolveSec":0`)
	b230Tally(f)
	at := time.Date(2026, 10, 9, 11, 0, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	applyRefetch(M{"refetch": []any{b230Row("L17", "created", "", "Receipt", "212", "20261005")}})
	b230Turns(2)
	if s := b230Resolved(c, "L17"); s == nil || str(s["object_guid"]) != r222GUID(26408) {
		t.Fatalf("line 17 not settled on 09-Oct: %v (%v)", s, f.ids())
	}
}

// another user's lines never: a row of a company this bridge's own Tally does not have open is not taken (the cloud lists
// only the bridge's own lines; this is the bridge's own check besides), nothing asked of Tally for it
func TestBody230RefetchOwnTallyOnly(t *testing.T) {
	_, f, c := b230Bridge(t, `,"RecorderResolveSec":0`)
	b230Tally(f)
	other := M{"line_id": "LO", "company": "ANOTHER USER'S CO", "company_guid": "aaaaaaaa-1111-2222-3333-444444444444", "event": "created", "master_id": "26409",
		"vch_type": "Receipt", "vch_no": "213", "vch_date": "20261006"}
	wrongGUID := M{"line_id": "LG", "company": nwsCo, "company_guid": "bbbbbbbb-1111-2222-3333-444444444444", "event": "created", "master_id": "26409",
		"vch_type": "Receipt", "vch_no": "213", "vch_date": "20261006"}
	n := f.n("")
	applyRefetch(M{"refetch": []any{other, wrongGUID}})
	b230Turns(3)
	_, items := liveHeldLoad()
	if items["LO"].ID != "" || items["LG"].ID != "" || b230Resolved(c, "LO") != nil || b230Resolved(c, "LG") != nil || f.n(vchByMasterID) != 0 || f.n(vchByNumberID) != 0 {
		t.Fatalf("another user's line taken: %v / asked %v", items, f.ids()[n:])
	}
}

// postings first, the 2-second stop, one refetch line a turn; 2.3.3: each asked again once, then it ends
func TestBody230RefetchSpacedAndStopped(t *testing.T) {
	_, f, c := b230Bridge(t, "")
	b230Tally(f)
	rows := []any{b230Row("L4", "altered", "26312", "Receipt", "192", "20261005"), b230Row("L18", "created", "26409", "Receipt", "213", "20261006"),
		b230Row("LN", "created", "26999", "Receipt", "299", "20261006")} // not in Tally (yet)
	applyRefetch(M{"refetch": rows})
	// a posting going: nothing asked
	postTaking.Store(true)
	b230Turns(2)
	postTaking.Store(false)
	if f.n(vchByMasterID)+f.n(vchByNumberID) != 0 {
		t.Fatalf("asked during a posting: %v", f.ids())
	}
	// the 2-second stop (2.3.1: never a switch-off): nothing asked until the shared retry schedule's next try
	retryNote(f.port, vchByMasterID, errRecorderStop)
	b230Turns(2)
	if f.n(vchByMasterID)+f.n(vchByNumberID) != 0 {
		t.Fatalf("asked before the retry: %v", f.ids())
	}
	retryDue() // the retry's time: it goes by itself
	// one refetch line a turn
	liveResolveTurn()
	if n := f.n(vchByMasterID) + f.n(vchByNumberID); n != 1 {
		t.Fatalf("%d asks in one turn (one refetch line a turn)", n)
	}
	b230Turns(4)
	if b230Resolved(c, "L4") == nil || b230Resolved(c, "L18") == nil {
		t.Fatalf("not resolved: %v", c.recSent())
	}
	// LN: asked once (2.3.3, the owner's rule: a held line is asked again at most once); Tally answered without it: it ends
	// at once with the Day Book words, never asked again, whatever FinCom lists (2.3.2: asked every 10 minutes, 20 tries)
	k := f.n(vchByMasterID) + f.n(vchByNumberID)
	if s := r222cSentID(c, "LN:resolved"); len(s) != 1 || str(s[0]["xml"]) != "" || str(s[0]["heldWhy"]) != liveHeldOnceGiveUp {
		t.Fatalf("LN did not end after its one ask: %v", s)
	}
	applyRefetch(M{"refetch": rows})
	at := nowFn().Add(11 * time.Minute)
	nowFn = func() time.Time { return at }
	b230Turns(3)
	if f.n(vchByMasterID)+f.n(vchByNumberID) != k {
		t.Fatal("LN asked again after its one ask")
	}
}
