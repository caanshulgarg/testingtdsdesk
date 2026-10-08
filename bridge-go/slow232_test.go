package main

// Bridge 2.3.2 (the owner's requirements of 07-Oct-2026, issue 232). On a large company Tally takes about 5 s (worst 13 s)
// to answer the single-entry request (FinComVoucherByMaster / ByNumber); the bridge stops each at 2 s, holds a new entry
// after 3 stops, and 2.3.1 then asked the held line again at every retry try for 7 days (a stop was "not counted as a
// try"), costing Tally about 5 s each time (staging: bridge go-c5b73700e65a, IX DESIGNS PRIVATE LIMITED, 9 lines held).
//
//   b. a held line whose fetch timed out backs off for hours: next try after 1 h, then 4 h, then it ends with the Day Book
//      words, sent to FinCom (3 timed-out tries in all, the original fetch's stops counting as one). Never 7 days.
//   c. the bridge measures each company's entry fetch (ms when answered, "over 2 s" when stopped). A company whose fetch
//      is stopped at 2 s on 2 separate occasions while Tally answered other requests in time around then (a whole-Tally
//      freeze does not count) is marked "entry fetch stopped: over 2 s": no entry request for it any more; its new lines
//      go up held at once with plain words; its held lines end with the same words; nothing is asked of Tally for them.
//      The mark is kept on disk and lifts only when the bridge's version changes. The beat carries it per company.
//
// The 2 s stop, the retry schedule, postings first and one request at a time are unchanged; no request is added or
// changed. Written before the code (red first).

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// a bridge as on NWS144 with the stop at 200 ms (the 2 s rule, scaled down: the stand answers a large company's single
// entry in 700 ms, "5 s")
func slow232Bridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := r222bBridge(t, `,"RecorderLimitMs":200`)
	retryReset()
	t.Cleanup(retryReset)
	return p, f, c
}

// the stand answers the single-entry requests (by MasterID, by number) in d; everything else at once
func slowEntries(f *standTally, d time.Duration) {
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID || id == vchByNumberID {
			return d
		}
		return 0
	}
	f.mu.Unlock()
}

// the stand answers every request in d (a whole-Tally freeze when d is over the stop); 0: at once
func slowAll(f *standTally, d time.Duration) {
	f.mu.Lock()
	f.slow = func(string, string) time.Duration { return d }
	f.mu.Unlock()
}

// the reader's look at its own Tally (the company list, a background request under the 2 s stop): Tally answers other
// requests in time (or not, in a freeze)
func slowLook() { openCompaniesAsk(bgCompaniesTC(), true) }

// an entry of NWS144 saved in Tally (pre and post of one save), its MasterID mid
func slowLine(mid int64, tm string) []string {
	g, m := r222GUID(mid), fmt.Sprint(mid)
	no := "J-" + m
	return []string{r222Line("voucher_accept_pre", tm, g, m, "54389", "Journal", no, "5-Oct-2026", "entry "+m),
		r222Line("voucher_accept_post", tm, g, m, "54389", "Journal", no, "5-Oct-2026", "entry "+m)}
}

func slowSentOf(c *standCloud, mid int64) []M {
	var o []M
	for _, s := range c.recSent() {
		if str(s["master_id"]) == fmt.Sprint(mid) || str(s["vch_no"]) == "J-"+fmt.Sprint(mid) {
			o = append(o, s)
		}
	}
	return o
}

func slowHeldItem(t *testing.T, id string) (heldLine, bool) {
	t.Helper()
	heldMu.Lock()
	defer heldMu.Unlock()
	_, items := liveHeldLoad()
	h, ok := items[id]
	return h, ok
}

// marks NWS144 as the bridge's file keeps a mark (recorder-slow.json, this version). 2.3.4 (the owner's decision of
// 08-Oct-2026, option (a)): no stop of the fast request marks a company any more (TestFast234ObjectStopEndsLineOnly);
// a mark is planted here so what a marked company means stays tested
func slowMarkIt(t *testing.T, p string, f *standTally) {
	t.Helper()
	r222Vch(f, 25700, "Journal", "J-25700", "20261005", 54500)
	slowSt.mu.Lock()
	slowFresh()
	slowSt.marks[companyKey(nwsCo)] = &slowMark{Company: nwsCo, GUID: heldGUID(nwsCo), Since: nowFn().In(liveZone).Format(time.RFC3339), TimesOver: 2, LastMs: -1,
		Why: "finding one entry took Tally longer than 2 s: stopped 2 times, on 2 separate occasions while Tally answered other requests in time"}
	slowSaveLocked()
	slowSt.mu.Unlock()
	if !slowMarked(nwsCo, nwsGUID) {
		t.Fatal("the planted mark is not read")
	}
}

// --- c. a marked company (a mark the bridge's file keeps; 2.3.4: no stop makes one any more): no entry request for it at
// all; its lines go up held with the plain words; the beat carries the mark
func TestSlow232CompanyMarkedAfterTwoStops(t *testing.T) {
	p, f, c := slow232Bridge(t)
	slowMarkIt(t, p, f)
	retryDue()
	for i := 0; i < 5; i++ {
		liveUploadOnce()
	}
	if n := f.n(vchObjectID) + f.n(vchByNumberID); n != 0 {
		t.Fatalf("entry requests for a marked company: %v", f.ids())
	}
	// a new entry of that company: held at once with the words, nothing asked (by MasterID or by number)
	r222Vch(f, 25701, "Journal", "J-25701", "20261005", 54501)
	r222Vch(f, 25702, "Journal", "J-NEW", "20261005", 54502)
	liveAppend(t, p, slowLine(25701, "07:20")...)
	liveAppend(t, p, r222Line("voucher_accept_post", "07:21", nwsGUID+"-00000000", "0", "0", "Journal", "J-NEW", "5-Oct-2026", "a new one"))
	readAndUploadAll(t)
	if n := f.n(vchObjectID) + f.n(vchByNumberID); n != 0 {
		t.Fatalf("a new line of the marked company was asked of Tally: %v", f.ids())
	}
	for _, mid := range []int64{25701} {
		s := slowSentOf(c, mid)
		if len(s) != 1 || str(s[0]["heldWhy"]) != slowWords || str(s[0]["xml"]) != "" {
			t.Fatalf("the new line %d: %v", mid, s)
		}
	}
	if s := nwsByNo(c.recSent(), "J-NEW"); len(s) != 1 || str(s[0]["heldWhy"]) != slowWords {
		t.Fatalf("the new entry without a MasterID: %v", s)
	}
	// the held resolver never asks for them, hours and days later
	base := nowFn()
	for _, h := range []int{1, 5, 30, 100} {
		retryClock(base, h*3600)
		retryDue()
		liveUploadOnce()
	}
	if n := f.n(vchObjectID) + f.n(vchByNumberID); n != 0 {
		t.Fatalf("the resolver asked Tally for a marked company's line: %v", f.ids())
	}
	// the beat: per company {company, since, timesOver, lastMs, why}, in the recorderBodyFetch shape FinCom keeps
	b := beatBody(true, "open", "", nil, nil, nil)
	e := obj(obj(b["recorderBodyFetch"])[nwsCo])
	if e["off"] != true || str(e["company"]) != nwsCo || toInt(e["timesOver"]) != 2 || str(e["since"]) == "" || str(e["at"]) != str(e["since"]) ||
		!strings.Contains(str(e["why"]), "longer than 2 s") || num(e["seconds"]) <= 0 || num(e["seconds"]) > 3600 {
		t.Fatalf("the beat: %v", b["recorderBodyFetch"])
	}
	if _, had := e["lastMs"]; had && e["lastMs"] != nil {
		t.Fatalf("lastMs without an answer: %v", e)
	}
	if len(obj(b["recorderSourceB"])) != 0 || len(obj(b["recorderSourceC"])) != 0 || b["readStopped"] != nil {
		t.Fatalf("something else is said off: %v %v %v", b["recorderSourceB"], b["recorderSourceC"], b["readStopped"])
	}
}

// --- c. a whole-Tally freeze does not mark a company: its stops while other requests were not answered either do not
// count, nor do stops in one stretch with nothing answered between them
func TestSlow232FreezeDoesNotMark(t *testing.T) {
	p, f, c := slow232Bridge(t)
	r222Vch(f, 25710, "Journal", "J-25710", "20261005", 54510)
	r222Vch(f, 25711, "Journal", "J-25711", "20261005", 54511)
	r222Vch(f, 25712, "Journal", "J-25712", "20261005", 54512)
	slowLook()
	// 1. Tally frozen: the entry and the company list alike
	slowAll(f, 700*time.Millisecond)
	liveAppend(t, p, slowLine(25710, "07:14")...)
	liveReadOnce()
	liveUploadOnce()
	retryDue()
	slowLook()
	retryDue()
	liveUploadOnce()
	retryDue()
	slowLook()
	retryDue()
	liveUploadOnce() // 2.3.4 (option (a)): ended at its first stop with the Day Book words, never asked again
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asks in the freeze: %d (want 1: its fetch, stopped, ends the line): %v", n, f.ids())
	}
	slowAll(f, 0)
	retryDue()
	slowLook()
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("marked by a whole-Tally freeze:\n%s", readText(logFile()))
	}
	// 2. a freeze in which only the entry was tried, then Tally answers again: one stretch, one occasion at most
	slowAll(f, 700*time.Millisecond)
	liveAppend(t, p, slowLine(25711, "07:30")...)
	liveReadOnce()
	retryDue()
	liveUploadOnce()
	retryDue()
	liveUploadOnce()
	retryDue()
	liveUploadOnce()
	slowAll(f, 0)
	retryDue()
	slowLook()
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("marked by stops in one stretch:\n%s", readText(logFile()))
	}
	// a new entry: fetched as before, with its body
	liveAppend(t, p, slowLine(25712, "07:40")...)
	retryDue()
	readAndUploadAll(t)
	if s := slowSentOf(c, 25712); len(s) != 1 || str(s[0]["xml"]) == "" || str(s[0]["object_guid"]) != r222GUID(25712) {
		t.Fatalf("the entry after the freeze: %v", s)
	}
	b := beatBody(true, "open", "", nil, nil, nil)
	if len(obj(b["recorderBodyFetch"])) != 0 {
		t.Fatalf("the beat says the entry fetch is off: %v", b["recorderBodyFetch"])
	}
}

// --- b, as the owner changed it for 2.3.4 (08-Oct-2026, option (a) and answer B): a new entry whose fast request is
// stopped at the limit goes up held at once ("FinCom asks once more at HH:MM"), is asked once more 5 minutes later,
// stopped again, and ends with the Day Book words; never asked a third time, whatever FinCom lists, hours and days later
func TestSlow232HeldTimedOutBacksOffHours(t *testing.T) {
	p, f, c := slow232Bridge(t)
	r222Vch(f, 25720, "Journal", "J-25720", "20261005", 54520)
	slowEntries(f, 700*time.Millisecond)
	base := nowFn()
	liveAppend(t, p, slowLine(25720, "07:14")...)
	liveReadOnce()
	liveUploadOnce() // the stop: the line goes up held at once, to be asked once more
	s := slowSentOf(c, 25720)
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "FinCom asks once more at") || !strings.HasSuffix(liveStopEndWords(), "upload that day's Day Book to settle it") {
		t.Fatalf("the line went up: %v", s)
	}
	id := str(s[0]["line_id"])
	if h, ok := slowHeldItem(t, id); !ok || !h.StopWait || h.ObjAsks != 1 {
		t.Fatalf("not in the held list for its one more ask: %+v %v", h, ok)
	}
	asks := func() int { return f.n(vchObjectID) + f.n(vchByNumberID) }
	row := M{"line_id": id, "company": nwsCo, "company_guid": nwsGUID, "event": "created", "master_id": "25720", "vch_type": "Journal", "vch_no": "J-25720", "vch_date": "20261005"}
	for _, h := range []int{0, 1, 5, 6, 24, 72, 150, 170} {
		retryClock(base, 15+h*3600)
		applyHeldLines(M{"heldLines": []any{row}})
		applyRefetch(M{"refetch": []any{row}})
		retryDue()
		liveUploadOnce()
		want := 2
		if h == 0 {
			want = 1 // 15 s after the stop: its one more ask waits 5 minutes
		}
		if asks() != want {
			t.Fatalf("at %d h: %d asks (want %d): %v", h, asks(), want, f.ids())
		}
	}
	if s := slowSentOf(c, 25720); len(s) != 2 || str(s[1]["heldWhy"]) != liveStopEndWords() {
		t.Fatalf("what went up for it: %v", s)
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatal("marked")
	}
}

// --- b (2.3.3): a held line FinCom lists (heldLines) is asked again once; its ask stops: (2.3.4, answer B) asked once
// more 5 minutes later, stopped again: it ends, never asked a third time
func TestSlow232CloudHeldLineTimedOut(t *testing.T) {
	_, f, c := slow232Bridge(t)
	r222Vch(f, 25730, "Journal", "", "20261005", 54530)
	slowEntries(f, 700*time.Millisecond)
	base := nowFn()
	applyHeldLines(M{"heldLines": retryHeldRows("25730")})
	asks := func() int { return f.n(vchObjectID) }
	for _, x := range [][2]int{{0, 1}, {15, 1}, {30 * 60, 2}, {3600, 2}, {3600 + 4*3600, 2}, {2 * 86400, 2}, {7 * 86400, 2}} {
		retryClock(base, x[0])
		retryDue()
		liveUploadOnce()
		if asks() != x[1] {
			t.Fatalf("at %s: %d asks (want %d)", time.Duration(x[0])*time.Second, asks(), x[1])
		}
	}
	if s := r222cSentID(c, "nws-25730:resolved"); len(s) != 1 || str(s[0]["heldWhy"]) != liveStopEndWords() { // 2.3.4 (answer B): stopped twice: the stop words
		t.Fatalf("the end: %v", s)
	}
}

// --- a fast company is unaffected: its entries come with their bodies, its outcome is measured (ms), nothing is marked;
// one stop (2.3.4, answer B) holds that entry's line for one more ask and marks nothing; the next entry comes
func TestSlow232FastCompanyUnaffected(t *testing.T) {
	p, f, c := slow232Bridge(t)
	r222Vch(f, 25740, "Journal", "J-25740", "20261005", 54540)
	r222Vch(f, 25741, "Journal", "J-25741", "20261005", 54541)
	liveAppend(t, p, slowLine(25740, "07:14")...)
	readAndUploadAll(t)
	if s := slowSentOf(c, 25740); len(s) != 1 || str(s[0]["xml"]) == "" {
		t.Fatalf("the fast entry: %v", s)
	}
	if st := slowSeen(nwsCo); st.answered < 1 || st.lastMs < 0 || st.over != 0 {
		t.Fatalf("the outcome is not measured: %+v", st)
	}
	// one stop, the company list answered in time around it, then the entry answers in time: not marked
	n := 0
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID {
			n++
			if n == 1 {
				return 700 * time.Millisecond
			}
		}
		return 0
	}
	f.mu.Unlock()
	slowLook()
	liveAppend(t, p, slowLine(25741, "07:20")...)
	liveReadOnce()
	liveUploadOnce()
	retryDue()
	slowLook()
	readAndUploadAll(t)
	// 2.3.4 (answer B): held at once at the stop, asked once more 5 minutes later
	if s := slowSentOf(c, 25741); len(s) != 1 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "FinCom asks once more at") {
		t.Fatalf("the entry after one stop: %v", s)
	}
	r222Vch(f, 25742, "Journal", "J-25742", "20261005", 54542)
	liveAppend(t, p, slowLine(25742, "07:25")...)
	readAndUploadAll(t)
	if s := slowSentOf(c, 25742); len(s) != 1 || str(s[0]["xml"]) == "" {
		t.Fatalf("the next entry: %v", s)
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatal("marked after one stop")
	}
	if st := slowSeen(nwsCo); st.over != 1 || st.answered < 2 {
		t.Fatalf("the outcomes: %+v", st)
	}
	if b := beatBody(true, "open", "", nil, nil, nil); len(obj(b["recorderBodyFetch"])) != 0 {
		t.Fatalf("the beat: %v", b["recorderBodyFetch"])
	}
}

// --- c. the mark survives a restart (kept on disk) and lifts only when the bridge's version changes; FinCom's held lines of
// a marked company end with the same words, nothing asked
func TestSlow232MarkSurvivesRestartLiftsOnVersion(t *testing.T) {
	p, f, c := slow232Bridge(t)
	slowMarkIt(t, p, f)
	// a restart
	liveResetState()
	slowForget()
	retryReset()
	if !slowMarked(nwsCo, nwsGUID) {
		t.Fatal("the mark did not survive a restart")
	}
	// FinCom's held lines of the company: they end with the same words; no request
	r222Vch(f, 25750, "Journal", "", "20261005", 54550)
	r222Vch(f, 25751, "Journal", "", "20261005", 54551)
	applyHeldLines(M{"heldLines": retryHeldRows("25750", "25751")})
	before := f.n(vchObjectID) + f.n(vchByNumberID)
	for i := 0; i < 3; i++ {
		liveUploadOnce()
	}
	if n := f.n(vchObjectID) + f.n(vchByNumberID); n != before {
		t.Fatalf("asked Tally for a marked company's held lines: %v", f.ids())
	}
	for _, mid := range []string{"25750", "25751"} {
		if s := r222cSentID(c, "nws-"+mid+":resolved"); len(s) != 1 || str(s[0]["heldWhy"]) != slowWords || str(s[0]["xml"]) != "" {
			t.Fatalf("held line %s did not end with the words: %v", mid, s)
		}
	}
	// a second turn sends nothing more for them
	n0 := len(c.recSent())
	nowFn = func() time.Time { return time.Date(2026, 10, 5, 9, 0, 0, 0, liveZone) }
	applyHeldLines(M{"heldLines": retryHeldRows("25750", "25751")})
	applyRefetch(M{"refetch": retryHeldRows("25750", "25751")})
	liveUploadOnce()
	if len(c.recSent()) != n0 || f.n(vchObjectID)+f.n(vchByNumberID) != before {
		t.Fatal("an ended line went again or was asked")
	}
	// a newer bridge: the mark lifts by itself, the entry is asked again (now answered in time)
	old := BridgeVersion
	BridgeVersion = "2.3.6" // a newer version than this one
	t.Cleanup(func() { BridgeVersion = old })
	liveResetState()
	slowForget()
	slowEntries(f, 0)
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatal("the mark did not lift on a version change")
	}
	if logLines("lifted") < 1 {
		t.Fatalf("the lift is not in the log:\n%s", readText(logFile()))
	}
	r222Vch(f, 25752, "Journal", "J-25752", "20261005", 54552)
	liveAppend(t, p, slowLine(25752, "08:59")...)
	readAndUploadAll(t)
	if s := slowSentOf(c, 25752); len(s) != 1 || str(s[0]["xml"]) == "" {
		t.Fatalf("after the lift: %v", s)
	}
	if b := beatBody(true, "open", "", nil, nil, nil); len(obj(b["recorderBodyFetch"])) != 0 {
		t.Fatalf("the beat after the lift: %v", b["recorderBodyFetch"])
	}
}

// --- the mark is per company: another company's fetch goes on
func TestSlow232OtherCompanyGoesOn(t *testing.T) {
	p, f, _ := slow232Bridge(t)
	slowMarkIt(t, p, f)
	if slowMarked("ANOTHER COMPANY", "") || slowMarked(zz, "") {
		t.Fatal("another company is marked")
	}
	if slowMarked(nwsCo, "another-guid") {
		t.Fatal("a company of the same name with another GUID is marked")
	}
}

// --- the version, the allow-list's decision line (no request added or changed: the table's hash does not move,
// TestAllowListUnchanged) and the notes with their test sheet
func TestSlow232VersionAndDecisionLine(t *testing.T) {
	// 2.3.3: the version and the decision line now name 2.3.3 (TestBacklog233VersionAndDecisionLine); 2.3.2's kept as history
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	if !strings.Contains(line, "as for 2.3.2: the same") {
		t.Fatalf("the decision line: %s", cut(line, 300))
	}
	if strings.Contains(al, "allowed for 2.3.1") {
		t.Fatal("the 2.3.1 line is still an exception line (release-check accepts one version only)")
	}
	notes := strings.Join(strings.Fields(readText("../docs/bridge-2.3.2-notes.md")), " ")
	for _, w := range []string{"2.3.2", "1 h", "4 h", "upload that day's Day Book", slowWords, "FinCom has stopped asking Tally for this company's entries",
		"This lifts when a faster FinCom Bridge is installed", "Test sheet", "roll back", "No Tally request was added or changed"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.3.2 notes do not say %q", w)
		}
	}
}
