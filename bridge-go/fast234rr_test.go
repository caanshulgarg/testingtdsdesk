package main

// 2.3.4: the independent review of 08-Oct-2026 up to a107af85 (M1-M4, L2, L5), each fix test first

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- M1: a line an older bridge kept at 20 tries, its one fast ask answered with something unreadable ("Unknown
// Request"): asked once, then ended with the Day Book words (its :resolved sent), never dropped silently, never asked again
func TestFast234RROlderLineUnreadableAnswerEnds(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25790, "Journal", "", "20261005", 54590)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID {
			fmt.Fprint(w, "<RESPONSE>Unknown Request, cannot be processed</RESPONSE>")
			return true
		}
		return false
	}
	f.mu.Unlock()
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	item := M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Journal", "no": "", "date": "20261005", "masterId": "25790", "savedAt": yest, "added": yest,
		"last": yest, "tries": 20, "event": "created", "why": liveHeldGiveUp, "final": false, "triesVersion": "2.3.2", "slow": 1}
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"old-unreadable": item}})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	for i := 0; i < 6; i++ {
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once): %v", n, f.ids())
	}
	s := r222cSentID(c, "old-unreadable:resolved")
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.HasSuffix(str(s[0]["heldWhy"]), "upload that day's Day Book to settle it") {
		t.Fatalf("not ended with the Day Book words: %v", s)
	}
	if _, left := liveHeldLoad(); len(left) != 0 {
		t.Fatalf("left in the held list: %v", left)
	}
}

// --- M4 (option (a) in the held list): a line held at once and not asked yet (fresh, two asks allowed), its fast request
// stopped at the limit: ended at its first stop with the Day Book words; exactly one request for it
func TestFast234RRHeldListStopEndsAtOnce(t *testing.T) {
	_, f, c := slow232Bridge(t)
	r222Vch(f, 25791, "Journal", "", "20261005", 54591)
	stopSlowMids(f, 700*time.Millisecond, 25791)
	now := nowFn().Format(time.RFC3339)
	item := M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Journal", "no": "", "date": "20261005", "masterId": "25791", "savedAt": now, "added": now,
		"last": "", "tries": 0, "event": "created", "why": "waiting: Tally busy", "final": false, "fresh": true, "freshTries": 0, "allow": 2, "v234": true}
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"fresh-slow": item}})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	base := nowFn()
	for i, sec := range []int{0, 20, 60, 600, 3600, 86400} {
		retryClock(base, sec)
		fastTurns(2)
		if n := f.n(vchObjectID); n > 1 {
			t.Fatalf("turn %d: %d requests for it (want 1)", i, n)
		}
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("%d requests (want 1)", n)
	}
	if s := r222cSentID(c, "fresh-slow:resolved"); len(s) != 1 || str(s[0]["heldWhy"]) != liveStopEndWords() {
		t.Fatalf("not ended with the stop words: %v", s)
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatal("marked")
	}
}

const rrVoucherMode = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>300.00</AMOUNT><INVENTORYALLOCATIONS.LIST><STOCKITEMNAME>Item T03</STOCKITEMNAME><AMOUNT>300.00</AMOUNT></INVENTORYALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>`

// --- L2: a held cancel whose voucher Tally keeps in a form the strip cannot keep whole: held for good with words (not
// "asked again" every turn); one request
func TestFast234RRGuidCheckShapeIsFinal(t *testing.T) {
	_, f, _ := r222bBridge(t, `,"RecorderResolveSec":0`)
	v := r222Vch(f, 25793, "Sales", "SV-9", "20261005", 54593)
	v.extra, v.cancelled = rrVoucherMode, true
	now := nowFn().Format(time.RFC3339)
	item := M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Sales", "no": "SV-9", "date": "20261005", "masterId": "25793", "savedAt": now, "added": now,
		"last": "", "tries": 0, "event": "cancelled", "why": "waiting", "final": false, "v234": true}
	if err := saveFile(liveHeldFile(), jsonText(M{"items": M{"cancel-shape": item}})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	base := nowFn()
	for _, sec := range []int{0, 60, 3600, 7200, 86400} {
		retryClock(base, sec)
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once, then held for good): %v", n, f.ids())
	}
}

// --- L2: the posting check meets such a voucher: a person must look (never "Tally is busy")
func TestFast234RRPostCheckShapeWords(t *testing.T) {
	err := error(fastShapeError{"its lines in ALLLEDGERENTRIES.INVENTORYALLOCATIONS, which FinCom's entry request does not read"})
	if w := postCheckShapeWords("ZZ", "25793", "20261005", err); !strings.Contains(w, "a person must look in Tally") || strings.Contains(w, "busy") {
		t.Fatalf("words: %s", w)
	}
}

// --- L5: an answer whose voucher block cannot be read at all (the strip makes nothing of it) is never taken as "Tally
// has no such voucher" (a delete check would take the entry as gone): an error that holds
func TestFast234RRUnreadableBlockNotGone(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID {
			fmt.Fprint(w, `<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER REMOTEID="unterminated><MASTERID>25794</MASTERID><DATE>20261005</DATE></VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`)
			return true
		}
		return false
	}
	f.mu.Unlock()
	port, err := findCompanyPortBg(nwsCo, 0)
	if err != nil {
		t.Fatal(err)
	}
	got, err := fetchVouchersByMasterIn(recorderTC(nil), nwsCo, port, "20261005", []string{"25794"}, 5)
	if err == nil || len(got) != 0 {
		t.Fatalf("taken as not there: %v %v", got, err)
	}
}

// --- the renumbering helper's finding (08-Oct-2026): for a MasterID Tally does not have (a deleted voucher, a ledger's
// id, one never used) the object export answers a bare <ERRORMSG>Could not find Voucher:ID:n!</ERRORMSG>, no envelope,
// on every release (testdata/fast234/notfound: push-design runs 37741662830, 37747408916). Exactly that answer, for the
// MasterID asked, is "no such voucher"; anything else stays an answer that could not be read
func TestFast234RRNotFoundAnswer(t *testing.T) {
	_, f, _ := r222bBridge(t, "")
	var answer string
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID {
			fmt.Fprint(w, answer)
			return true
		}
		return false
	}
	f.mu.Unlock()
	port, err := findCompanyPortBg(nwsCo, 0)
	if err != nil {
		t.Fatal(err)
	}
	ask := func(mid string) (map[string]string, error) {
		return fetchVouchersByMasterIn(recorderTC(nil), nwsCo, port, "20261005", []string{mid}, 5)
	}
	files, _ := filepath.Glob(filepath.Join("testdata", "fast234", "notfound", "*.xml"))
	if len(files) < 12 {
		t.Fatalf("%d captures", len(files))
	}
	for _, fl := range files {
		answer = readText(fl)
		mid := group(`Could not find Voucher:ID:(\d+)!`, answer, 1)
		if got, err := ask(mid); err != nil || len(got) != 0 {
			t.Fatalf("%s: not taken as no such voucher: %v %v", fl, got, err)
		}
		if _, err := ask(mid + "1"); err == nil {
			t.Fatalf("%s: another MasterID's answer taken as no such voucher", fl)
		}
	}
	for _, a := range []string{
		"<ERRORMSG>Could not find Voucher:ID:777!</ERRORMSG> and more",
		"<ERRORMSG>Could not find Voucher:ID:777!</ERRORMSG><ERRORMSG>Could not find Voucher:ID:778!</ERRORMSG>",
		"<ENVELOPE><ERRORMSG>Could not find Voucher:ID:777!</ERRORMSG></ENVELOPE>",
		"<ERRORMSG>Could not find Voucher:ID:7777!</ERRORMSG>",
		"<ERRORMSG>Could not find Ledger:ID:777!</ERRORMSG>",
	} {
		answer = a
		if got, err := ask("777"); err == nil {
			t.Fatalf("%q taken as no such voucher: %v", a, got)
		}
	}
}
