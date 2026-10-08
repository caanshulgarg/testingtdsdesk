package main

// next-fastfetch (the owner's approval of 07-Oct-2026: "Fast request 'voucher object by MasterID' ... held lines of GARG
// SHEKHAR, IX DESIGNS and VMS EVENTS should be fetched by it without a Day Book upload"). Lines 2.3.3 ENDED with the Day
// Book words (their ids kept 7 days in sync\recorder-sent\*.ended.txt; FinCom still holds them and lists them in the beat's
// heldLines / refetch, its only ":resolved" row being the held one without a body) get ONE fresh ask with the fast
// request after the upgrade: answered, "<line id>:resolved" goes again with Tally's GUID and body (the cloud's second
// ":resolved" row, which replaces the held line and the held ":resolved" row); not answered, nothing more goes and the line
// is never asked again. A line this version ended is never asked again. Written before the code (red first).

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 2.3.3 ended this line: its ":resolved" went up held with the Day Book words (sent), its id noted ended
func fastEndedBy233(t *testing.T, id string, resolvedSent bool) {
	t.Helper()
	day := nowFn().Format("20060102")
	if err := os.MkdirAll(liveSentDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := appendText(filepath.Join(liveSentDir(), day+liveEndedSuffix), id+"\n"); err != nil {
		t.Fatal(err)
	}
	sent := id
	if resolvedSent {
		sent = id + ":resolved"
	}
	if err := appendText(filepath.Join(liveSentDir(), day+".txt"), sent+"\n"); err != nil {
		t.Fatal(err)
	}
	fastRestart()
}

// a start of the bridge: its state read again from disk
func fastRestart() {
	live.mu.Lock()
	live.dir = ""
	live.mu.Unlock()
}

func fastTurns(n int) {
	for i := 0; i < n; i++ {
		retryDue()
		liveUploadOnce()
	}
}

func fastBodied(c *standCloud, id string) (n, withBody int) {
	for _, s := range r222cSentID(c, id) {
		n++
		if str(s["xml"]) != "" && str(s["object_guid"]) != "" {
			withBody++
		}
	}
	return
}

// --- a line 2.3.3 ended (GARG SHEKHAR's Journal of 05-Oct, its company marked slow by 2.3.3): FinCom lists it; the fast
// request asks it once; its ":resolved" goes with Tally's GUID and body; listed again (FinCom's answer not in yet), after a
// restart too: never asked or sent again
func TestFast234EndedLineAskedOnceMore(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25730, "Journal", "", "20261005", 54530)
	fastEndedBy233(t, "nws-25730", true)
	rows := M{"heldLines": retryHeldRows("25730")}
	applyHeldLines(rows)
	fastTurns(3)
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once): %v", n, f.ids())
	}
	if n, b := fastBodied(c, "nws-25730:resolved"); n != 1 || b != 1 {
		t.Fatalf("the resolution: %d sent, %d with Tally's GUID and body", n, b)
	}
	for _, restart := range []bool{false, true} {
		if restart {
			fastRestart()
		}
		applyHeldLines(rows)
		applyRefetch(M{"refetch": retryHeldRows("25730")})
		fastTurns(3)
		if n := f.n(vchObjectID); n != 1 {
			t.Fatalf("restart %v: asked again (%d asks)", restart, n)
		}
		if n, _ := fastBodied(c, "nws-25730:resolved"); n != 1 {
			t.Fatalf("restart %v: sent again (%d)", restart, n)
		}
	}
	if !strings.Contains(readText(logFile()), "asked once more with the fast request") {
		t.Fatalf("the log does not say it:\n%s", readText(logFile()))
	}
}

// --- FinCom's refetch lists it (its body missing): the same, once
func TestFast234EndedLineRefetchOnce(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25731, "Journal", "", "20261005", 54531)
	fastEndedBy233(t, "nws-25731", true)
	for i := 0; i < 3; i++ {
		applyRefetch(M{"refetch": retryHeldRows("25731")})
		applyHeldLines(M{"heldLines": retryHeldRows("25731")})
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once)", n)
	}
	if n, b := fastBodied(c, "nws-25731:resolved"); n != 1 || b != 1 {
		t.Fatalf("the resolution: %d sent, %d with body", n, b)
	}
}

// --- its one ask is not answered in time: its ":resolved" goes up once more, held with the Day Book words and no body
// (review L4: FinCom then holds two and stops listing it), and it is never asked again, whatever FinCom lists
func TestFast234EndedLineReaskTimesOut(t *testing.T) {
	_, f, c := r222bBridge(t, `,"RecorderLimitMs":200`)
	retryReset()
	t.Cleanup(retryReset)
	r222Vch(f, 25732, "Journal", "", "20261005", 54532)
	slowEntries(f, 700*time.Millisecond)
	fastEndedBy233(t, "nws-25732", true)
	base := nowFn()
	for i, sec := range []int{0, 60, 3600, 86400} {
		retryClock(base, sec)
		applyHeldLines(M{"heldLines": retryHeldRows("25732")})
		fastTurns(2)
		if n := f.n(vchObjectID); n != 1 {
			t.Fatalf("round %d: %d asks (want 1)", i, n)
		}
	}
	if n, b := fastBodied(c, "nws-25732:resolved"); n != 1 || b != 0 {
		t.Fatalf("the second held row: %d sent, %d with body (want 1, 0)", n, b)
	}
	if s := r222cSentID(c, "nws-25732:resolved"); len(s) != 1 || !strings.Contains(str(s[0]["heldWhy"]), "upload that day's Day Book to settle it") {
		t.Fatalf("its words: %v", s)
	}
}

// --- a live line 2.3.3 sent held at once with the slow words (its company marked; no ":resolved" ever sent): FinCom lists
// it; asked once with the fast request; its ":resolved" goes with the body
func TestFast234SlowWordsLineAskedOnce(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25733, "Journal", "", "20261005", 54533)
	fastEndedBy233(t, "nws-25733", false)
	for i := 0; i < 2; i++ {
		applyHeldLines(M{"heldLines": retryHeldRows("25733")})
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once)", n)
	}
	if n, b := fastBodied(c, "nws-25733:resolved"); n != 1 || b != 1 {
		t.Fatalf("the resolution: %d sent, %d with body", n, b)
	}
}

// --- a line THIS version ended (its one ask with the fast request stopped): never asked again when FinCom lists it
func TestFast234LineEndedByThisVersionNotReasked(t *testing.T) {
	_, f, _ := r222bBridge(t, `,"RecorderLimitMs":200`)
	retryReset()
	t.Cleanup(retryReset)
	r222Vch(f, 25734, "Journal", "", "20261005", 54534)
	slowEntries(f, 700*time.Millisecond)
	applyHeldLines(M{"heldLines": retryHeldRows("25734")})
	fastTurns(2)
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("first: %d asks", n)
	}
	slowEntries(f, 0)
	for _, restart := range []bool{false, true} {
		if restart {
			fastRestart()
		}
		applyHeldLines(M{"heldLines": retryHeldRows("25734")})
		applyRefetch(M{"refetch": retryHeldRows("25734")})
		fastTurns(2)
		if n := f.n(vchObjectID); n != 1 {
			t.Fatalf("restart %v: asked again (%d asks)", restart, n)
		}
	}
}

// --- 2.3.4 (the owner's 30-day window for lines ended by the slow-company rule): FinCom lists such a line up to 30 days;
// the ended id and the one fresh ask are kept 31 days, so a line 2.3.3 ended 20 days ago is asked once more, then never
// again; the sent ids keep their 7 days
func TestFast234EndedKept31Days(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25740, "Journal", "", "20261005", 54540)
	base := nowFn()
	old := base.AddDate(0, 0, -20).Format("20060102")
	if err := os.MkdirAll(liveSentDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = appendText(filepath.Join(liveSentDir(), old+liveEndedSuffix), "nws-25740\n")
	_ = appendText(filepath.Join(liveSentDir(), old+".txt"), "nws-25740:resolved\n")
	fastRestart()
	for i := 0; i < 3; i++ {
		retryClock(base, i*86400)
		applyHeldLines(M{"heldLines": retryHeldRows("25740")})
		fastTurns(2)
		fastRestart()
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (want once)", n)
	}
	if n, b := fastBodied(c, "nws-25740:resolved"); n != 1 || b != 1 {
		t.Fatalf("the resolution: %d sent, %d with body", n, b)
	}
	// 32 days on: the files are gone (FinCom no longer lists such a line after 30)
	retryClock(base, 32*86400)
	fastRestart()
	live.mu.Lock()
	liveFresh()
	gone := !live.ended["nws-25740"] && !live.fastAsked["nws-25740"]
	live.mu.Unlock()
	if !gone {
		t.Fatal("the ended and fresh-ask ids are kept beyond 31 days")
	}
	if liveFastKeepDays != 31 {
		t.Fatalf("kept %d days", liveFastKeepDays)
	}
}

// --- 2.3.4 (the owner's goal, 08-Oct-2026: no company should need marking slow): only the fast entry request's stops count
// toward the slow mark. Lines with no MasterID are asked by type and number (FinComVoucherByNumber, a scan of the company):
// stopped at the limit again and again on separate occasions, they never mark the company; each gets its one try plus one
// ask again, then ends with the Day Book words; the company's entries by MasterID still go (the fast request)
func TestFast234ByNumberStopsDoNotMark(t *testing.T) {
	p, f, c := slow232Bridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchByNumberID {
			return 700 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	for i, no := range []string{"N-1", "N-2", "N-3"} {
		r222Vch(f, int64(25760+i), "Journal", no, "20261005", int64(54560+i))
		slowLook()
		liveAppend(t, p, r222Line("voucher_accept_pre", "07:1"+fmt.Sprint(i), nwsGUID+"-00000000", "0", "0", "Journal", no, "5-Oct-2026", "no mid "+no),
			r222Line("voucher_accept_post", "07:1"+fmt.Sprint(i), nwsGUID+"-00000000", "0", "0", "Journal", no, "5-Oct-2026", "no mid "+no))
		for k := 0; k < 4; k++ {
			liveReadOnce()
			liveUploadOnce()
			retryDue()
			slowLook()
		}
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("marked by the by-number stops (%d by-number asks)", f.n(vchByNumberID))
	}
	if f.n(vchByNumberID) < 3 {
		t.Fatalf("the lines were not asked by number: %v", f.ids())
	}
	// the company's entry by MasterID still goes, with its body
	r222Vch(f, 25770, "Journal", "J-25770", "20261005", 54570)
	liveAppend(t, p, slowLine(25770, "07:30")...)
	readAndUploadAll(t)
	if s := slowSentOf(c, 25770); len(s) == 0 || str(s[len(s)-1]["xml"]) == "" {
		t.Fatalf("the entry by MasterID: %v", s)
	}
}

// --- 2.3.4 (a live finding on NWS144, 08-Oct-2026: of ~53 held lines only 8 were asked in the first hour): a held line
// from an older bridge (2.3.2's file: tries 20, final, refetch) is never skipped for ever. On the upgrade each gets exactly
// one ask with FinComVoucherObject whatever its old tries or final: Tally gives the entry, it goes as ":resolved" with its
// body; else (or nothing to ask by) it ends with the Day Book words. Asked once, never again, after a restart too
func TestFast234OlderHeldLinesAskedOnce(t *testing.T) {
	_, f, c := r222bBridge(t, "")
	r222Vch(f, 25780, "Journal", "", "20261005", 54580)
	r222Vch(f, 25781, "Journal", "", "20261005", 54581)
	r222Vch(f, 25782, "Journal", "", "20261005", 54582)
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	last := nowFn().Add(-2 * time.Hour).Format(time.RFC3339)
	item := func(mid string, tries int, final, refetch bool, why string) M {
		return M{"company": nwsCo, "companyGuid": nwsGUID, "type": "Journal", "no": "", "date": "20261005", "masterId": mid, "savedAt": yest, "added": yest,
			"last": last, "tries": tries, "event": "created", "why": why, "lineGuid": "", "lineFid": "", "idsMismatch": false, "final": final, "lineAlter": 0,
			"fromFinCom": refetch, "keepGuid": "", "keepAlter": "", "refetch": refetch, "triesVersion": "2.3.2", "again": false, "ledgerAgain": false, "slow": 1}
	}
	items := M{
		"old-tries20": item("25780", 20, false, false, liveHeldGiveUp),
		"old-final":   item("25781", 3, true, false, "Tally gave no voucher with MasterID 25781 of 05-Oct-2026"),
		"old-refetch": item("25782", 20, false, true, "the entry was not read from Tally"),
		"old-nothing": item("", 0, true, false, "the line has no MasterID, so Tally cannot be asked for its entry"),
	}
	if err := saveFile(liveHeldFile(), jsonText(M{"items": items})); err != nil {
		t.Fatal(err)
	}
	fastRestart()
	for i := 0; i < 6; i++ {
		fastTurns(2)
	}
	if n := f.n(vchObjectID); n != 3 {
		t.Fatalf("asked %d times by the fast request (want 3: one each): %v", n, f.ids())
	}
	for _, id := range []string{"old-tries20", "old-final", "old-refetch"} {
		if n, b := fastBodied(c, id+":resolved"); n != 1 || b != 1 {
			t.Fatalf("%s: %d sent, %d with Tally's body", id, n, b)
		}
	}
	if s := r222cSentID(c, "old-nothing:resolved"); len(s) != 1 || !strings.Contains(str(s[0]["heldWhy"]), "Day Book") {
		t.Fatalf("the line with nothing to ask by is not ended with the Day Book words: %v", s)
	}
	for _, restart := range []bool{false, true} {
		if restart {
			fastRestart()
		}
		fastTurns(3)
	}
	if n := f.n(vchObjectID); n != 3 {
		t.Fatalf("asked again: %d", n)
	}
	if _, left := liveHeldLoad(); len(left) != 0 {
		t.Fatalf("lines left in the held list (skipped, never ended): %v", left)
	}
}
