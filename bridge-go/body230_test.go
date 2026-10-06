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
