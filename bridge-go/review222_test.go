package main

// Bridge 2.2.2 (the owner's NWS144 findings of 05-Oct-2026, staging tally_recorder_lines): the add-on's line may carry a
// GUID, MasterID and AlterID that do not belong together (a voucher duplicated from an older one: the SOURCE's GUID and
// AlterID with the new entry's MasterID, type, number and date). The bridge trusts neither the line's GUID nor its
// AlterID: it fetches the one voucher from Tally by MasterID (else by type, number and date) and sends Tally's GUID,
// MasterID and AlterID, or holds the line with plain words. Tests written before the code.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a voucher line of NWS144 as the live add-on writes it (date as the add-on gives it, e.g. "5-Oct-2026")
func r222Line(ev, tm, guid, mid, aid, typ, no, date, narr string) string {
	return "FCR1|ev=" + ev + "|t0=5-Oct-2026 " + tm + "|tw=5-Oct-2026 " + tm + "|cguid=" + nwsGUID + "|cname=" + nwsCo + "|user=owner|obj=Voucher|guid=" + guid +
		"|mid=" + mid + "|aid=" + aid + "|vtype=" + typ + "|vno=" + no + "|vdate=" + date + "|name=|parent=|narr=" + narr + "|t1=5-Oct-2026 " + tm + "|src=live"
}

func r222GUID(mid int64) string { return fmt.Sprintf("%s-%08x", nwsGUID, mid) }

// a voucher in the stand Tally of NWS144 (under no lock)
func r222Vch(f *standTally, mid int64, typ, no, date string, alter int64) *tVch {
	v := &tVch{guid: r222GUID(mid), master: fmt.Sprint(mid), date: date, typ: typ, no: no, narr: typ + " " + no, party: "Customer A", alter: alter,
		lines: [][2]string{{"Customer A", "10.00"}, {"Bank", "-10.00"}}}
	f.mu.Lock()
	f.vch = append(f.vch, v)
	f.mu.Unlock()
	return v
}

// the source voucher an entry is duplicated from: MasterID 25414 (GUID ...-00006346), AlterID 51986 (below the starting
// point 54389), a Journal of 01-Aug-2026
func r222Source(f *standTally) *tVch { return r222Vch(f, 25414, "Journal", "J-10", "20260801", 51986) }

// --- 1. the duplicated voucher's pair: the pre carries the SOURCE's GUID and AlterID, the post the new MasterID. The
// body is fetched by the new MasterID and sent with Tally's GUID, MasterID and AlterID; created; flagged idsMismatch
// with the line's GUID only as lineGuid
func TestR222DuplicatedVoucherPair(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	src := r222Source(f)
	nv := r222Vch(f, 25683, "Journal", "J-55", "20261005", 54500)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "08:00", src.guid, "25414", "51986", "Journal", "J-55", "5-Oct-2026", "duplicated"),
		r222Line("voucher_accept_post", "08:00", src.guid, "25683", "51986", "Journal", "J-55", "5-Oct-2026", "duplicated"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 {
		t.Fatalf("sent %d lines: %v", len(sent), sent)
	}
	s := sent[0]
	if str(s["event"]) != "created" || str(s["object_guid"]) != nv.guid || str(s["master_id"]) != "25683" || toI64(s["alter_id"]) != 54500 {
		t.Fatalf("the duplicated entry: event %v guid %v master %v alter %v (want created %s 25683 54500)", s["event"], s["object_guid"], s["master_id"], s["alter_id"], nv.guid)
	}
	if !strings.Contains(str(s["xml"]), "<GUID>"+nv.guid+"</GUID>") || !strings.Contains(str(s["xml"]), "<VOUCHERNUMBER>J-55</VOUCHERNUMBER>") {
		t.Fatalf("the body: %v", s["xml"])
	}
	if s["idsMismatch"] != true || str(s["lineGuid"]) != src.guid {
		t.Fatalf("not flagged: idsMismatch %v lineGuid %v", s["idsMismatch"], s["lineGuid"])
	}
	if strings.Contains(jsonText(s), "51986") {
		t.Fatalf("the source's AlterID went: %s", jsonText(s))
	}
	if f.n(vchObjectID) != 1 || !strings.Contains(f.bodiesOf(vchObjectID)[0], "ID:25683</ID>") || f.n(vchByNumberID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
}

// --- 2. a line whose GUID is not its MasterID in hex (a delete, nothing to fetch): its GUID only as lineGuid, flagged;
// a line whose GUID and MasterID agree goes as before
func TestR222MismatchFlag(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	// review H1 of 2.3.0: 191 deleted in this Tally (a delete goes on only when this Tally shows it gone)
	for _, v := range append([]*tVch{}, f.vch...) {
		if v.master == "26311" {
			f.remove(v)
		}
	}
	liveAppend(t, p,
		r222Line("after_delete", "08:10", r222GUID(25414), "25683", "51986", "Journal", "J-55", "5-Oct-2026", "x"),
		r222Line("after_delete", "08:11", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "y"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 2 {
		t.Fatalf("sent: %v", sent)
	}
	if str(sent[0]["object_guid"]) != "" || sent[0]["idsMismatch"] != true || str(sent[0]["lineGuid"]) != r222GUID(25414) || sent[0]["alter_id"] != nil {
		t.Fatalf("a mismatched line: %s", jsonText(sent[0]))
	}
	if str(sent[1]["object_guid"]) != r222GUID(26311) || sent[1]["idsMismatch"] != nil || sent[1]["lineGuid"] != nil {
		t.Fatalf("a line whose ids agree: %s", jsonText(sent[1]))
	}
}

// --- 3. the voucher Tally gives for the line's MasterID is another type and date: refused with words, the line held
// (no number: nothing else to ask)
func TestR222WrongVoucherRefused(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	r222Vch(f, 25683, "Payment", "P-3", "20260812", 54501)
	f.mu.Lock()
	f.dates = func(id, body string) (string, string) { return "", "" } // this Tally gives the MasterID whatever the period
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "08:20", nwsGUID+"-00000000", "0", "0", "Journal", "", "5-Oct-2026", "unnumbered"),
		r222Line("voucher_accept_post", "08:20", nwsGUID+"-00000000", "25683", "0", "Journal", "", "5-Oct-2026", "unnumbered"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 {
		t.Fatalf("sent: %v", sent)
	}
	const why = "Tally's voucher with MasterID 25683 is a Payment of 12-Aug-2026, not this Journal of 05-Oct-2026"
	if str(sent[0]["object_guid"]) != "" || str(sent[0]["xml"]) != "" || sent[0]["alter_id"] != nil || str(sent[0]["heldWhy"]) != why {
		t.Fatalf("the wrong voucher was taken, or no words: %s", jsonText(sent[0]))
	}
	if logLines(why) < 1 {
		t.Fatal("the log does not say why")
	}
	if f.n(vchByNumberID) != 0 {
		t.Fatal("asked by number for a line with no number")
	}
}

// --- 4. an unnumbered Journal (332 of 1,152 on NWS144) duplicated from another: found by its MasterID alone
func TestR222UnnumberedJournalByMaster(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	src := r222Source(f)
	nv := r222Vch(f, 25700, "Journal", "", "20261005", 54510)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "08:30", src.guid, "25414", "51986", "Journal", "", "5-Oct-2026", "copy"),
		r222Line("voucher_accept_post", "08:30", src.guid, "25700", "51986", "Journal", "", "5-Oct-2026", "copy"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["object_guid"]) != nv.guid || toI64(sent[0]["alter_id"]) != 54510 || str(sent[0]["event"]) != "created" ||
		!strings.Contains(str(sent[0]["xml"]), "<GUID>"+nv.guid+"</GUID>") {
		t.Fatalf("the unnumbered Journal: %v", sent)
	}
	if f.n(vchByNumberID) != 0 {
		t.Fatal("asked by number")
	}
}

// --- 5. the MasterID gives another voucher (a Payment, not this Journal): 2.3.4 (the independent review, L5) held for
// good, never asked by its type, number and date (a scan of the company); Tally's own voucher J-77 is not taken
func TestR222FallbackByNumber(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	setCfg("RecorderBodySec", float64(20)) // the background read waits its turn behind the company lookup (about 4 s here)
	r222Vch(f, 25683, "Payment", "P-4", "20261005", 54502)
	r222Vch(f, 25800, "Journal", "J-77", "20261005", 54520)
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "08:40", nwsGUID+"-00000000", "0", "0", "Journal", "J-77", "5-Oct-2026", "j77"),
		r222Line("voucher_accept_post", "08:40", nwsGUID+"-00000000", "25683", "0", "Journal", "J-77", "5-Oct-2026", "j77"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["xml"]) != "" || !strings.Contains(str(sent[0]["heldWhy"]), "is a Payment of 05-Oct-2026, not this Journal") {
		t.Fatalf("held: %v", sent)
	}
	if f.n(vchObjectID) != 1 || f.n(vchByNumberID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
}

// --- 6. (2.3.3, the owner's rule of 07-Oct-2026, replacing 2.2.2's 20 tries) a held entry is asked again ONCE: Tally
// still not giving it, it ends with the Day Book words (sent as its ":resolved" line), never asked again
func TestR222HeldTwentyTries(t *testing.T) {
	p, f, c := nwsBridge(t, `,"RecorderResolveSec":0`)
	liveAppend(t, p, r222Line("voucher_accept_pre", "08:50", nwsGUID+"-00000000", "0", "0", "Receipt", "900", "5-Oct-2026", "never"))
	liveFlushAll()
	readAndUploadAll(t)
	for i := 0; i < 30; i++ {
		liveUploadOnce()
	}
	// its first ask, then the one ask again
	if got := f.n(vchByNumberID); got != 2 {
		t.Fatalf("the held entry was asked %d times in all, want 2", got)
	}
	s := c.recSent()
	if len(s) != 2 || str(s[1]["line_id"]) != str(s[0]["line_id"])+":resolved" || str(s[1]["heldWhy"]) != liveHeldOnceGiveUp {
		t.Fatalf("held, then ended: %v", s)
	}
	if _, items := liveHeldLoad(); len(items) != 0 {
		t.Fatalf("held list: %v", items)
	}
}

// --- 7. a HARD 2 s stop for the recorder's background reads (the entry fetch here): the bridge stops waiting at 2 s and
// (2.3.1) tries again by itself on the shared schedule; a posting (Import) is never cut by it
func TestR222HardTwoSecondStop(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	setCfg("RecorderBodySec", float64(20))
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == vchObjectID {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	liveAppend(t, p,
		r222Line("voucher_accept_pre", "09:00", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "slow"),
		r222Line("voucher_accept_post", "09:00", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "slow"))
	liveReadOnce()
	t0 := time.Now()
	uploadAll(t)
	// the read waits its turn behind the company lookup (about 4 s on the stand), then is stopped at 2 s, not at 5
	if el := time.Since(t0); el > 7500*time.Millisecond {
		t.Fatalf("the recorder read took %s (a hard stop at 2 s)", el)
	}
	// 2.3.1 (the owner's last change): never switched off; the line waits for the shared retry schedule (retry.go)
	if logLines("off: Tally took") != 0 || logLines("(FinComVoucherObject, try 1); trying again by itself at") != 1 {
		t.Fatalf("switched off, or the retry not said: %s", readText(logFile()))
	}
	// 2.3.4 (the owner's answer B, 08-Oct-2026): up held at once, asked once more 5 minutes later
	if sent := c.recSent(); len(sent) != 1 || str(sent[0]["xml"]) != "" || !strings.HasPrefix(str(sent[0]["heldWhy"]), "waiting: Tally took longer than 2 s; FinCom asks once more at ") {
		t.Fatalf("not held at once: %v", sent)
	}
	// not asked again before those 5 minutes
	for i := 0; i < 3; i++ {
		retryDue()
		uploadAll(t)
	}
	if n := f.n(vchObjectID); n != 1 {
		t.Fatalf("asked %d times (its fetch only)", n)
	}
	if sent := c.recSent(); len(sent) != 1 {
		t.Fatalf("sent: %v", sent)
	}
}

func TestR222HardStopNotForImport(t *testing.T) {
	f := newStandTally(t)
	f.importAt = func(id, body string) (bool, time.Duration) { return true, 3 * time.Second }
	standBridge(t, f, `,"RecorderLimitMs":2000`)
	t0 := time.Now()
	pj := r15Job(t, "job-r222-import", r15Bills("hs", today(), 1))
	if str(pj["status"]) != "done" || time.Since(t0) < 3*time.Second {
		t.Fatalf("a 3 s import: %s %q after %s", pj["status"], pj["message"], time.Since(t0))
	}
	// a person's read and a read that is not the recorder's are not cut at 2 s either
	f.mu.Lock()
	f.importAt = nil
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskNames" {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	if _, err := getLedgerNames(&TC{copier: true, person: true}, zz, f.port); err != nil {
		t.Fatalf("a person's read was cut: %v", err)
	}
}

// --- 8. recorderSeen: the live add-on's daily files (<GUID>-<yyyymmdd>.txt) count, not only the trial's names
func TestR222RecorderSeenDailyFiles(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	cur := func() M { return obj(obj(beatBody(true, "open", "", nil, nil, nil)["changeNumbers"])[zz]) }
	if c := cur(); c["recorderSeen"] != false {
		t.Fatalf("no file: %v", c)
	}
	day := time.Now().Format("20060102") // read once: a midnight between writing and removing the file must not leave it behind
	_ = os.WriteFile(filepath.Join(rec, "co-guid-1-"+day+".txt"), utf16leBOM(r18Line1+"\r\n"), 0o644)
	if c := cur(); c["recorderSeen"] != true || str(c["recorderLastAt"]) == "" {
		t.Fatalf("a daily file: %v", c)
	}
	// another company's daily file is not this one's
	f2 := filepath.Join(rec, "co-guid-1-20261005.txt")
	_ = os.Remove(filepath.Join(rec, "co-guid-1-"+day+".txt"))
	_ = os.Remove(f2)
	_ = os.WriteFile(filepath.Join(rec, "co-guid-9-"+day+".txt"), []byte("x"), 0o644)
	if c := cur(); c["recorderSeen"] != false {
		t.Fatalf("another company's file: %v", c)
	}
}

// --- 9. the first run of a new version reads the add-on's files again for the voucher lines an earlier bridge sent
// without a body (not only placeholder GUIDs: a line whose GUID is not its MasterID); once per version
func TestR222RescanBodilessOncePerVersion(t *testing.T) {
	old := BridgeVersion
	t.Cleanup(func() { BridgeVersion = old })
	p, f, c := nwsBridge(t, "")
	src := r222Source(f)
	nv := r222Vch(f, 25683, "Journal", "J-55", "20261005", 54500)
	lines := []string{
		r222Line("voucher_accept_pre", "07:30", src.guid, "25414", "51986", "Journal", "J-55", "5-Oct-2026", "duplicated"),
		r222Line("voucher_accept_post", "07:30", src.guid, "25683", "51986", "Journal", "J-55", "5-Oct-2026", "duplicated"),
	}
	liveAppend(t, p, lines...)
	name := filepath.Base(p)
	off := int64(2)
	var starts []int64
	for _, l := range lines {
		starts = append(starts, off)
		off += int64(len(le16(l + "\r\n")))
	}
	id := liveLineID(name, "0", fmt.Sprint(starts[1])) // a pair: the post's start
	if err := saveFile(liveOffsetsFile(), jsonText(M{"files": M{name: M{"off": off, "gen": 0, "enc": "utf16"}}})); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(liveSentDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	liveSaveSent([]string{id})
	// what 2.2.1 left: its scan done (a time, no version)
	if err := saveFile(liveHeldFile(), jsonText(M{"scanned": "2026-10-05T07:00:00+05:30", "items": M{}})); err != nil {
		t.Fatal(err)
	}
	BridgeVersion = "2.2.2"
	liveResetState()
	readAndUploadAll(t)
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["line_id"]) != id+":resolved" || str(sent[0]["object_guid"]) != nv.guid || toI64(sent[0]["alter_id"]) != 54500 {
		t.Fatalf("re-asked: %v", sent)
	}
	if all, _ := liveHeldLoad(); str(all["scannedVersion"]) != "2.2.2" {
		t.Fatalf("the version that scanned: %v", all["scannedVersion"])
	}
	// the same version again (a restart): not scanned again. A line sent bodiless later is not picked up by a scan
	more := r222Line("voucher_accept_post", "07:31", r222GUID(25414), "25690", "51986", "Journal", "J-56", "5-Oct-2026", "two")
	liveAppend(t, p, more)
	id2 := liveLineID(name, "0", fmt.Sprint(off))
	off2 := off + int64(len(le16(more+"\r\n")))
	liveSaveSent([]string{id2})
	if err := saveFile(liveOffsetsFile(), jsonText(M{"files": M{name: M{"off": off2, "gen": 0, "enc": "utf16"}}})); err != nil {
		t.Fatal(err)
	}
	r222Vch(f, 25690, "Journal", "J-56", "20261005", 54530)
	liveResetState()
	readAndUploadAll(t)
	if n := len(c.recSent()); n != 1 {
		t.Fatalf("scanned twice in one version: %d lines", n)
	}
	// a newer version: scanned once more
	BridgeVersion = "2.2.3"
	liveResetState()
	readAndUploadAll(t)
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 2 || str(sent[1]["line_id"]) != id2+":resolved" || str(sent[1]["object_guid"]) != r222GUID(25690) {
		t.Fatalf("the next version's scan: %v", sent)
	}
}
