package main

// next-renumber (the owner's decision of 08-Oct-2026: "renumbering yes"). A voucher inserted in Tally (Ctrl+I, or made
// back-dated) or deleted, of a voucher type set to renumber, makes Tally renumber every later voucher of that type
// silently: the add-on writes no line for them, their AlterIDs do not move and neither does the company's ALTVCHID for
// them (tally-versions share runs 37734533866 and 37754251128, P9r, TallyPrime 3.0 and 7.1: insert, 4 renumbered,
// ALTVCHID 27 -> 28; delete, 2 renumbered, ALTVCHID 28 -> 29; every renumbered AlterID unchanged). So the insert's or
// delete's own line is the only sign. After such a line is sent, the bridge asks FinCom's cloud (tally-ingest
// "renumber_list", read-only) for the entries FinCom holds of that type from that date on, re-reads each with the approved
// FinComVoucherObject (one MasterID a request, one request at a time, the 2 s rule) and sends those whose number Tally
// changed as altered lines with Tally's body. The first later entry unchanged: no renumbering (one request). Written
// before the code (red first).

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// the Receipts of NWS144 as Tally and FinCom hold them before the insert: 190 (cancelled), 191, 192 of 05-Oct (nwsBridge)
// and 193 of 06-Oct, 194 of 07-Oct
func renumBridge(t *testing.T, extra string) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := r222bBridge(t, `,"RenumberGapMs":0`+extra)
	r222Vch(f, 26313, "Receipt", "193", "20261006", 54393)
	r222Vch(f, 26314, "Receipt", "194", "20261007", 54394)
	// FinCom's cloud: the Receipts it holds from the asked date on (the cloud's own filter: tests/run_renumber_list.py)
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"])), "more": false}
	}
	c.mu.Unlock()
	return p, f, c
}

// what FinCom held before the insert: the stand's receipts as first made (number by MasterID)
var renumBefore = map[string]string{"26309": "190", "26311": "191", "26312": "192", "26313": "193", "26314": "194"}

func renumCopy(f *standTally, from, no, mid string) []any {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []any
	for _, v := range f.vch {
		old, had := renumBefore[v.master]
		if !had || v.master == mid || v.date < from {
			continue
		}
		if v.date == from && no != "" && toI64(old) < toI64(no) {
			continue
		}
		o = append(o, M{"mid": v.master, "guid": v.guid, "day": v.date, "no": old, "alter": v.alter})
	}
	return o
}

// Tally inserts a Receipt dated date numbered no (MasterID mid) and renumbers every later Receipt (+1)
func renumInsert(f *standTally, mid int64, date, no string) {
	f.mu.Lock()
	for _, v := range f.vch {
		if v.typ == "Receipt" && (v.date > date || (v.date == date && toI64(v.no) >= toI64(no))) {
			v.no = fmt.Sprint(toI64(v.no) + 1)
		}
	}
	f.mu.Unlock()
	r222Vch(f, mid, "Receipt", no, date, 54400)
}

func renumInsertLines(mid int64, no, date string) []string {
	ph := nwsGUID + "-00000000"
	return []string{r222Line("voucher_accept_pre", "07:20", ph, "0", "0", "Receipt", no, date, "inserted"),
		r222Line("voucher_accept_post", "07:20", ph, fmt.Sprint(mid), "0", "Receipt", no, date, "inserted")}
}

func renumAltered(c *standCloud) map[string][]M {
	o := map[string][]M{}
	for _, s := range c.recSent() {
		if str(s["event"]) == "altered" && str(s["source"]) == "renumber" {
			o[str(s["master_id"])] = append(o[str(s["master_id"])], s)
		}
	}
	return o
}

func renumAsked(f *standTally) map[string]int {
	f.mu.Lock()
	defer f.mu.Unlock()
	o := map[string]int{}
	for i, id := range f.reqs {
		if id == vchObjectID {
			o[group(`ID:(\d+)</ID>`, f.bodies[i], 1)]++
		}
	}
	return o
}

// --- 1. a receipt inserted before 191 on 05-Oct: 191, 192, 193 and 194 renumbered in Tally; the bridge asks FinCom once,
// re-reads exactly those four once each (never 190, never the inserted one again), sends each as an altered line with
// Tally's new number and body, one request at a time; more turns ask nothing more
func TestRenumberInsertRereadsLaterOnce(t *testing.T) {
	p, f, c := renumBridge(t, "")
	renumInsert(f, 26400, "20261005", "191")
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	readAndUploadAll(t)
	for i := 0; i < 5; i++ {
		readAndUploadAll(t)
	}
	if n := c.count("renumber_list"); n != 1 {
		t.Fatalf("FinCom asked %d times (want once)", n)
	}
	a := c.renumAsks[0]
	if str(a["company"]) != nwsCo || !strings.EqualFold(str(a["company_guid"]), nwsGUID) || str(a["vtype"]) != "Receipt" || str(a["from"]) != "20261005" || str(a["no"]) != "191" || str(a["mid"]) != "26400" {
		t.Fatalf("the ask: %v", a)
	}
	asked := renumAsked(f)
	want := map[string]int{"26400": 1, "26311": 1, "26312": 1, "26313": 1, "26314": 1}
	if fmt.Sprint(asked) != fmt.Sprint(want) {
		t.Fatalf("Tally asked %v, want %v", asked, want)
	}
	alt := renumAltered(c)
	for mid, no := range map[string]string{"26311": "192", "26312": "193", "26313": "194", "26314": "195"} {
		s := alt[mid]
		if len(s) != 1 || str(s[0]["vch_no"]) != no || !strings.Contains(str(s[0]["xml"]), "<VOUCHERNUMBER>"+no+"</VOUCHERNUMBER>") || str(s[0]["object_guid"]) != r222GUID(toI64(mid)) {
			t.Fatalf("MasterID %s: sent %v (want one altered line numbered %s with Tally's body)", mid, s, no)
		}
	}
	if len(alt) != 4 {
		t.Fatalf("altered lines for %d entries: %v", len(alt), alt)
	}
	if f.maxFlight != 1 {
		t.Fatalf("%d requests at Tally at once", f.maxFlight)
	}
	if !strings.Contains(readText(logFile()), "renumbered") {
		t.Fatalf("the log does not say it:\n%s", readText(logFile()))
	}
}

// --- 2. the voucher type keeps its numbers (Tally's default, Auto Retain): the first later entry is unchanged: one
// request, nothing sent
func TestRenumberRetainOneProbe(t *testing.T) {
	p, f, c := renumBridge(t, "")
	r222Vch(f, 26400, "Receipt", "195", "20261005", 54400) // made back-dated, numbered at the end: nothing renumbered
	liveAppend(t, p, renumInsertLines(26400, "195", "5-Oct-2026")...)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if n := c.count("renumber_list"); n != 1 {
		t.Fatalf("FinCom asked %d times", n)
	}
	// FinCom lists 193 and 194 (later days): 193 is asked, unchanged: no renumbering
	if asked := renumAsked(f); fmt.Sprint(asked) != fmt.Sprint(map[string]int{"26400": 1, "26313": 1}) {
		t.Fatalf("Tally asked %v", asked)
	}
	if alt := renumAltered(c); len(alt) != 0 {
		t.Fatalf("sent %v", alt)
	}
}

// --- 3. an entry made at the end (no later entry in FinCom): FinCom asked once, Tally nothing more; an altered entry is
// no insert: FinCom is not asked
func TestRenumberNoLaterEntries(t *testing.T) {
	p, f, c := renumBridge(t, "")
	r222Vch(f, 26400, "Receipt", "195", "20261008", 54400)
	liveAppend(t, p, renumInsertLines(26400, "195", "8-Oct-2026")...)
	g := r222GUID(26312)
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, "26312", "54392", "Receipt", "192", "5-Oct-2026", "altered"),
		r222Line("voucher_accept_post", "07:21", g, "26312", "54392", "Receipt", "192", "5-Oct-2026", "altered"))
	f.mu.Lock()
	f.vch[2].alter = 54401
	f.mu.Unlock()
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if n := c.count("renumber_list"); n != 1 {
		t.Fatalf("FinCom asked %d times (want once, for the new entry only)", n)
	}
	if asked := renumAsked(f); fmt.Sprint(asked) != fmt.Sprint(map[string]int{"26400": 1, "26312": 1}) {
		t.Fatalf("Tally asked %v", asked)
	}
}

// --- 4. more entries than the cap: nothing re-read, one plain alert (the log and the beat), never a loop
func TestRenumberOverCapAlert(t *testing.T) {
	p, f, c := renumBridge(t, `,"RenumberMax":3`)
	renumInsert(f, 26400, "20261005", "191")
	c.mu.Lock()
	c.renumReply = func(b M) (int, M) {
		return 200, M{"ok": true, "entries": renumCopy(f, str(b["from"]), str(b["no"]), str(b["mid"]))[:3], "more": true}
	}
	c.mu.Unlock()
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if asked := renumAsked(f); fmt.Sprint(asked) != fmt.Sprint(map[string]int{"26400": 1}) {
		t.Fatalf("Tally asked %v (want the new entry only)", asked)
	}
	if n := c.count("renumber_list"); n != 1 {
		t.Fatalf("FinCom asked %d times", n)
	}
	if lim := toInt(c.renumAsks[0]["limit"]); lim != 3 {
		t.Fatalf("the ask's limit %d (want the cap, 3)", lim)
	}
	words := "more than 3 entries may have been renumbered in " + nwsCo + "; upload the Day Book from 05-Oct-2026"
	if !strings.Contains(readText(logFile()), words) {
		t.Fatalf("the log does not say %q:\n%s", words, readText(logFile()))
	}
	b := renumBeat()
	if len(b) != 1 || !strings.Contains(str(obj(b[0])["words"]), words) {
		t.Fatalf("the beat: %v", b)
	}
	if alt := renumAltered(c); len(alt) != 0 {
		t.Fatalf("sent %v", alt)
	}
}

// --- 5. a company marked slow (its entry fetch over 2 s): nothing of it is asked of Tally, FinCom is not asked
func TestRenumberSlowCompanyNotAsked(t *testing.T) {
	p, f, c := renumBridge(t, "")
	slowSt.mu.Lock()
	slowFresh()
	slowSt.marks[companyKey(nwsCo)] = &slowMark{Company: nwsCo, GUID: nwsGUID, LastMs: -1}
	slowSt.mu.Unlock()
	t.Cleanup(slowForget)
	renumInsert(f, 26400, "20261005", "191")
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if n := f.n(vchObjectID); n != 0 {
		t.Fatalf("Tally asked %d times", n)
	}
	if n := c.count("renumber_list"); n != 0 {
		t.Fatalf("FinCom asked %d times", n)
	}
}

// --- 6. at most RenumberPerTurn re-reads a turn; a posting going: none (it goes after it)
func TestRenumberPerTurnAndPostingFirst(t *testing.T) {
	p, f, c := renumBridge(t, `,"RenumberPerTurn":2`)
	setCfg("RenumberGapMs", float64(60000)) // one turn a minute
	renumInsert(f, 26400, "20261005", "191")
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	for i := 0; i < 3; i++ {
		readAndUploadAll(t)
	}
	got := renumAsked(f)
	if n := len(got) - 1; n != 2 {
		t.Fatalf("%d re-reads in the first minute (one turn, cap 2): %v", n, got)
	}
	if alt := renumAltered(c); len(alt) != 2 {
		t.Fatalf("the first turn's two not sent: %v", alt)
	}
	setCfg("RenumberGapMs", float64(0))
	importsInFlight.Add(1)
	before := f.n(vchObjectID)
	liveUploadOnce()
	liveUploadOnce()
	if f.n(vchObjectID) != before {
		t.Fatalf("asked during a posting")
	}
	importsInFlight.Add(-1)
	for i := 0; i < 6; i++ {
		readAndUploadAll(t)
	}
	if alt := renumAltered(c); len(alt) != 4 {
		t.Fatalf("after the posting: %d sent", len(alt))
	}
	for mid, n := range renumAsked(f) {
		if n != 1 {
			t.Fatalf("MasterID %s asked %d times", mid, n)
		}
	}
}

// --- 7. a 2 s stop: the re-reads stop for the turn and go on by the retry schedule; each entry still once in the end
func TestRenumberBacksOffOnStop(t *testing.T) {
	p, f, c := renumBridge(t, `,"RecorderLimitMs":200,"RenumberPerTurn":1`)
	retryReset()
	t.Cleanup(retryReset)
	setCfg("RenumberGapMs", float64(60000))
	renumInsert(f, 26400, "20261005", "191")
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	readAndUploadAll(t) // the new entry, then one turn: one re-read
	if n := len(renumAsked(f)); n != 2 {
		t.Fatalf("first turn: %v", renumAsked(f))
	}
	slowEntries(f, 700*time.Millisecond) // every entry request now over the stop
	setCfg("RenumberGapMs", float64(0))
	before := f.n(vchObjectID)
	for i := 0; i < 4; i++ {
		liveUploadOnce()
	}
	if n := f.n(vchObjectID) - before; n != 1 {
		t.Fatalf("%d requests after the stop (want the stopped one only, then the back-off)", n)
	}
	slowEntries(f, 0)
	base := nowFn()
	for _, sec := range []int{60, 180, 600, 1800} {
		retryClock(base, sec)
		for j := 0; j < 3; j++ {
			readAndUploadAll(t)
		}
	}
	if alt := renumAltered(c); len(alt) != 4 {
		t.Fatalf("in the end %d sent: %v", len(alt), alt)
	}
	if f.maxFlight != 1 {
		t.Fatalf("%d at once", f.maxFlight)
	}
}

// --- 8. a receipt deleted in the middle: the later ones renumbered down; the delete's own line is the sign
func TestRenumberDelete(t *testing.T) {
	p, f, c := renumBridge(t, "")
	f.mu.Lock()
	var keep []*tVch
	for _, v := range f.vch {
		if v.master == "26312" {
			continue
		}
		if v.typ == "Receipt" && toI64(v.no) > 192 {
			v.no = fmt.Sprint(toI64(v.no) - 1)
		}
		keep = append(keep, v)
	}
	f.vch = keep
	f.mu.Unlock()
	liveAppend(t, p, "FCR1|ev=after_delete|t0=5-Oct-2026 07:20|tw=5-Oct-2026 07:20|cguid="+nwsGUID+"|cname="+nwsCo+"|user=owner|obj=Voucher|guid="+r222GUID(26312)+
		"|mid=26312|aid=54392|vtype=Receipt|vno=192|vdate=5-Oct-2026|name=|parent=|narr=Received again|t1=5-Oct-2026 07:20|src=live")
	for i := 0; i < 5; i++ {
		readAndUploadAll(t)
	}
	if n := c.count("renumber_list"); n != 1 || str(c.renumAsks[0]["from"]) != "20261005" || str(c.renumAsks[0]["no"]) != "192" {
		t.Fatalf("FinCom asked %d: %v", n, c.renumAsks)
	}
	alt := renumAltered(c)
	if len(alt) != 2 || str(alt["26313"][0]["vch_no"]) != "192" || str(alt["26314"][0]["vch_no"]) != "193" {
		t.Fatalf("sent %v", alt)
	}
}

// --- 9. entries at or below the starting point are never named (security M1): the first is read only to see whether
// Tally renumbered; the rest are not read; the alert says how many and from when
func TestRenumberBelowStartPoint(t *testing.T) {
	p, f, c := renumBridge(t, "")
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26313" || v.master == "26314" {
			v.alter -= 100 // saved before the starting point (54389)
		}
	}
	f.mu.Unlock()
	renumInsert(f, 26400, "20261005", "191")
	liveAppend(t, p, renumInsertLines(26400, "191", "5-Oct-2026")...)
	for i := 0; i < 5; i++ {
		readAndUploadAll(t)
	}
	alt := renumAltered(c)
	if len(alt) != 2 || alt["26311"] == nil || alt["26312"] == nil {
		t.Fatalf("sent %v (want 26311 and 26312 only)", alt)
	}
	if asked := renumAsked(f); asked["26313"] != 0 || asked["26314"] != 0 {
		t.Fatalf("entries below the starting point read: %v", asked)
	}
	words := "2 entries may have been renumbered in " + nwsCo + "; upload the Day Book from 06-Oct-2026"
	if !strings.Contains(readText(logFile()), words) {
		t.Fatalf("the log does not say %q:\n%s", words, readText(logFile()))
	}
}
