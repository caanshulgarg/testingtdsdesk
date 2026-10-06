package main

// Bridge 2.2.2, the owner's requirement before publishing (05-Oct-2026): ONE log line every time the bridge decides to
// fetch or not to fetch a voucher line's entry from Tally, with the reason; one line per resolver / heldLines turn; the
// same line and reason at most once in 10 minutes; no silent skip anywhere. Written before the code.

import (
	"strings"
	"testing"
)

func r222eLog() string { return readText(logFile()) }

func TestR222eDecisionLog(t *testing.T) {
	p, f, _ := r222bBridge(t, `,"RecorderResolveSec":0`)
	src := r222Source(f)
	r222Vch(f, 25683, "Journal", "J-55", "20261005", 54500)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "14:00", src.guid, "25414", "51986", "Journal", "J-55", "5-Oct-2026", "x"),
		r222Line("voucher_accept_post", "14:00", src.guid, "25683", "51986", "Journal", "J-55", "5-Oct-2026", "x"))
	readAndUploadAll(t)
	for _, want := range []string{
		"Recorder: Journal J-55 of 05-Oct-2026 (MasterID 25683, line ",
		"): asking Tally by MasterID",
		"): taken: Tally's GUID " + r222GUID(25683) + ", AlterID 54500",
	} {
		if !strings.Contains(r222eLog(), want) {
			t.Fatalf("the log lacks %q:\n%s", want, r222eLog())
		}
	}
	// a voucher whose MasterID gives another one, no number: held, with the words
	r222Vch(f, 25684, "Payment", "P-1", "20261005", 54501)
	liveAppend(t, p, r222Line("voucher_accept_post", "14:01", nwsGUID+"-00000000", "25684", "0", "Journal", "", "5-Oct-2026", "y"))
	readAndUploadAll(t)
	if !strings.Contains(r222eLog(), "(MasterID 25684, line ") || !strings.Contains(r222eLog(), "): held: Tally's voucher with MasterID 25684 is a Payment") {
		t.Fatalf("no held line in the log:\n%s", r222eLog())
	}
	// FinCom's own posting coming back
	v := r222Vch(f, 26400, "Journal", "J-300", "20261005", 54600)
	liveAppend(t, p,
		r222Line("import_object", "14:02", v.guid, "26400", "54600", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"),
		r222Line("after_import_object", "14:02", v.guid, "26400", "54600", "Journal", "J-300", "5-Oct-2026", "Bill | TDSDesk:fp1"))
	readAndUploadAll(t)
	if !strings.Contains(r222eLog(), "(MasterID 26400, line ") || !strings.Contains(r222eLog(), "): not asked: FinCom's own posting coming back (matched by FinCom id)") {
		t.Fatalf("FinCom's own posting not in the log:\n%s", r222eLog())
	}
	// a posting going: said once, however many turns
	liveAppend(t, p, r222Line("voucher_accept_post", "14:03", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "z"))
	liveReadOnce()
	postTaking.Store(true)
	for i := 0; i < 5; i++ {
		liveUploadOnce()
	}
	postTaking.Store(false)
	if n := logLines("): not asked: a posting is going on; asked after it"); n != 1 {
		t.Fatalf("the posting reason said %d times", n)
	}
	// 2.3.1: waiting for the retry schedule (never a switch-off): said in the decision log too
	retryNote(f.port, vchByMasterID, errRecorderStop)
	uploadAll(t)
	if !strings.Contains(r222eLog(), "): not asked yet: Tally did not answer in time at ") || !strings.Contains(r222eLog(), "; trying again by itself at ") {
		t.Fatalf("the wait not in the log:\n%s", r222eLog())
	}
	// the resolver's turn: one line
	retryDue()
	applyHeldLines(M{"heldLines": []any{r222cRow("st-1", "altered", "26312", "Receipt", "192", "20261005")}})
	liveUploadOnce()
	if logLines("Recorder: held lines: ") < 1 || !strings.Contains(r222eLog(), " from FinCom, ") || !strings.Contains(r222eLog(), " asked, ") || !strings.Contains(r222eLog(), " resolved, ") ||
		!strings.Contains(r222eLog(), " still held") {
		t.Fatalf("no resolver line:\n%s", r222eLog())
	}
}

// no starting point: said, never silent
func TestR222eNoStartPointSaid(t *testing.T) {
	rec, f, _ := liveBridge(t, "")
	td := today() // read once: the voucher and its live line on the same day
	v := f.add(td, "Party", "N-1", "x", "-1.00")
	liveAppend(t, liveFilePath(rec, ""), liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "1", "Journal", "N-1", td, "", "", "x"))
	readAndUploadAll(t)
	if !strings.Contains(r222eLog(), "): not asked: no starting point recorded for this company") {
		t.Fatalf("not said:\n%s", r222eLog())
	}
}

// the first run's re-scan says what it found, even nothing
func TestR222eRescanSaid(t *testing.T) {
	r222bBridge(t, "")
	liveReadOnce()
	if logLines("Recorder: re-scan of the add-on's files for ") != 1 {
		t.Fatalf("the re-scan not in the log:\n%s", r222eLog())
	}
}
