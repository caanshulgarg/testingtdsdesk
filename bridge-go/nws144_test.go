package main

// Bridge 2.2.1 (the owner's real-Tally result on NWS144, 05-Oct-2026): a new entry was sent as "altered" with a
// placeholder GUID (company GUID + "-00000000") and no body. The four lines Tally wrote are the fixtures
// (tests/fixtures/recorder-lines-nws144-0510.*). Tests written before the code.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

const (
	nwsGUID = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
	nwsCo   = "THE COMPANY ON NWS144"
)

func nwsFixture(t *testing.T) (lines []string, fx M) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "tests", "fixtures", "recorder-lines-nws144-0510.txt"))
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		lines = append(lines, strings.TrimRight(l, "\r"))
	}
	if err := json.Unmarshal([]byte(readText(filepath.Join("..", "tests", "fixtures", "recorder-lines-nws144-0510.json"))), &fx); err != nil {
		t.Fatal(err)
	}
	return lines, fx
}

// a bridge as on NWS144 at 07:15 on 05-Oct-2026: the starting point 54389 / 14507 (07:09), Receipt 190 in Tally
// (cancelled), 191 and 192 saved by the owner (189 deleted). Its daily file's path
func nwsBridge(t *testing.T, extra string) (string, *standTally, *standCloud) {
	t.Helper()
	rec, f, c := liveBridge(t, `,"RecorderNumberWaitMs":0,"RecorderNumberRetryMs":0,"RecorderBodySec":3`+extra)
	at := time.Date(2026, 10, 5, 7, 15, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	f.mu.Lock()
	f.guid, f.coName = nwsGUID, nwsCo
	add := func(no, mid string, alter int64, narr, amt string) {
		f.vch = append(f.vch, &tVch{guid: fmt.Sprintf("%s-%08x", nwsGUID, toI64(mid)), master: mid, date: "20261005", typ: "Receipt", no: no, narr: narr,
			party: "Customer A", alter: alter, lines: [][2]string{{"Customer A", amt}, {"Bank", strings.TrimPrefix("-"+amt, "--")}}})
	}
	add("190", "26309", 54390, "Receipt 190", "100.00")
	add("191", "26311", 54391, "Received from customer", "500.00")
	add("192", "26312", 54392, "Received again", "700.00")
	f.mu.Unlock()
	noteCompanyGUID(nwsCo, nwsGUID)
	noteStartPoint(nwsCo, nwsGUID, 54389, 14507)
	return filepath.Join(rec, nwsGUID+"-20261005.txt"), f, c
}

func nwsByNo(sent []M, no string) []M {
	var o []M
	for _, s := range sent {
		if str(s["vch_no"]) == no {
			o = append(o, s)
		}
	}
	return o
}

// --- 1. the four real lines: 191 and 192 created with their real GUID, MasterID, AlterID and body; 189 deleted; 190
// cancelled; no placeholder GUID ever sent; Tally's minute kept as saved_at, the bridge's own second as received_at
func TestNWS144RealLines(t *testing.T) {
	lines, fx := nwsFixture(t)
	p, f, c := nwsBridge(t, "")
	liveAppend(t, p, lines...)
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 4 {
		t.Fatalf("sent %d lines: %v", len(sent), sent)
	}
	for _, e := range arr(fx["expected_2_2_1"]) {
		want := obj(e)
		got := nwsByNo(sent, str(want["vch_no"]))
		if len(got) != 1 {
			t.Fatalf("Receipt %s sent %d times", str(want["vch_no"]), len(got))
		}
		g := got[0]
		if str(g["event"]) != str(want["event"]) || str(g["object_guid"]) != str(want["object_guid"]) || str(g["master_id"]) != str(want["master_id"]) {
			t.Errorf("Receipt %s: %s %s %s, want %s %s %s", str(want["vch_no"]), str(g["event"]), str(g["object_guid"]), str(g["master_id"]),
				str(want["event"]), str(want["object_guid"]), str(want["master_id"]))
		}
		if strings.HasSuffix(str(g["object_guid"]), "-00000000") {
			t.Errorf("Receipt %s: a placeholder GUID sent", str(want["vch_no"]))
		}
		if str(want["event"]) == "created" {
			x := str(g["xml"])
			if !strings.Contains(x, "<GUID>"+str(want["object_guid"])+"</GUID>") || !strings.Contains(x, "<VOUCHERNUMBER>"+str(want["vch_no"])+"</VOUCHERNUMBER>") {
				t.Errorf("Receipt %s: the body sent: %s", str(want["vch_no"]), x)
			}
			if toI64(g["alter_id"]) <= 54389 {
				t.Errorf("Receipt %s: alter_id %v, not Tally's", str(want["vch_no"]), g["alter_id"])
			}
		}
		if !strings.Contains(str(g["saved_at"]), "T07:1") || !regexp.MustCompile(`^2026-10-05T07:15:00`).MatchString(str(g["received_at"])) {
			t.Errorf("Receipt %s: saved_at %v received_at %v", str(want["vch_no"]), g["saved_at"], g["received_at"])
		}
		if _, had := g["save_ms"]; had {
			t.Errorf("Receipt %s: save_ms %v sent from times to the minute", str(want["vch_no"]), g["save_ms"])
		}
	}
	// 191 (MasterID 0) by its type and number, once, for its own day; 192 by its MasterID
	if f.n(vchByNumberID) != 1 || f.n(vchByMasterID) != 1 {
		t.Fatalf("requests: %v", f.ids())
	}
	b := f.bodiesOf(vchByNumberID)[0]
	if !strings.Contains(b, "$VoucherNumber = &#34;191&#34; AND $VoucherTypeName = &#34;Receipt&#34;") || !strings.Contains(b, "<SVFROMDATE>20261005</SVFROMDATE>") ||
		!strings.Contains(b, "<SVTODATE>20261005</SVTODATE>") || !strings.Contains(b, "GUID, MASTERID, ALTERID") {
		t.Fatalf("the request by number: %s", b)
	}
	if b != voucherByNumberRequest(nwsCo, "20261005", "Receipt", "191") {
		t.Fatal("the request by number is not as built")
	}
	if !strings.Contains(f.bodiesOf(vchByMasterID)[0], "$MasterID = 26312") {
		t.Fatalf("the body by MasterID: %s", f.bodiesOf(vchByMasterID)[0])
	}
}

// --- 2. an entry altered (Tally's own numbers on the line before the save) stays altered; a new one made in one save
// (pre and post) is one created line; a pre already sent is not followed by a second created line
func TestNWS144AlteredAndOneCreated(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	g191 := nwsGUID + "-000066c7"
	l := func(ev, tm, guid, mid, aid, no, narr string) string {
		return "FCR1|ev=" + ev + "|t0=5-Oct-2026 " + tm + "|tw=5-Oct-2026 " + tm + "|cguid=" + nwsGUID + "|cname=" + nwsCo + "|user=owner|obj=Voucher|guid=" + guid +
			"|mid=" + mid + "|aid=" + aid + "|vtype=Receipt|vno=" + no + "|vdate=5-Oct-2026|name=|parent=|narr=" + narr + "|t1=5-Oct-2026 " + tm + "|src=live"
	}
	liveAppend(t, p, l("voucher_accept_pre", "07:20", g191, "26311", "54391", "191", "Received from customer"),
		l("voucher_accept_post", "07:20", g191, "26311", "54395", "191", "Received from customer"))
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["event"]) != "altered" || str(sent[0]["object_guid"]) != g191 {
		t.Fatalf("an alteration: %v", sent)
	}
	// a new entry: its pre is taken alone (another line between), its post comes with the MasterID: one created line
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: nwsGUID + "-000066c9", master: "26313", date: "20261005", typ: "Receipt", no: "193", narr: "new", party: "Customer A",
		alter: 54396, lines: [][2]string{{"Customer A", "10.00"}, {"Bank", "-10.00"}}})
	f.mu.Unlock()
	liveAppend(t, p, l("voucher_accept_pre", "07:21", nwsGUID+"-00000000", "0", "0", "193", "new"),
		l("after_cancel", "07:21", nwsGUID+"-000066c5", "26309", "54390", "190", "Receipt 190"),
		l("voucher_accept_post", "07:21", nwsGUID+"-00000000", "26313", "0", "193", "new"))
	readAndUploadAll(t)
	sent = c.recSent()
	got := nwsByNo(sent, "193")
	if len(got) != 1 || str(got[0]["event"]) != "created" || str(got[0]["object_guid"]) != nwsGUID+"-000066c9" || str(got[0]["master_id"]) != "26313" ||
		!strings.Contains(str(got[0]["xml"]), "<VOUCHERNUMBER>193</VOUCHERNUMBER>") {
		t.Fatalf("one created line for 193: %v", got)
	}
	// the pre went first (another entry's post came only later): the post adds nothing
	liveAppend(t, p, l("voucher_accept_pre", "07:22", nwsGUID+"-00000000", "0", "0", "194", "next"))
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: nwsGUID + "-000066ca", master: "26314", date: "20261005", typ: "Receipt", no: "194", narr: "next", party: "Customer A",
		alter: 54397, lines: [][2]string{{"Customer A", "20.00"}, {"Bank", "-20.00"}}})
	f.mu.Unlock()
	liveFlushAll()
	readAndUploadAll(t)
	liveAppend(t, p, l("voucher_accept_post", "07:22", nwsGUID+"-00000000", "26314", "0", "194", "next"))
	readAndUploadAll(t)
	liveFlushAll()
	readAndUploadAll(t)
	got = nwsByNo(c.recSent(), "194")
	if len(got) != 1 || str(got[0]["event"]) != "created" || str(got[0]["object_guid"]) != nwsGUID+"-000066ca" {
		t.Fatalf("194: %v", got)
	}
}

// --- 3. by type and number: none found (asked 3 times) or two found: the line goes without its body and GUID, held by
// FinCom, and the log says why
func TestNWS144ByNumberNoneOrTwo(t *testing.T) {
	p, f, c := nwsBridge(t, "")
	l := func(no string) string {
		return "FCR1|ev=voucher_accept_pre|t0=5-Oct-2026 07:30|tw=5-Oct-2026 07:30|cguid=" + nwsGUID + "|cname=" + nwsCo + "|user=owner|obj=Voucher|guid=" +
			nwsGUID + "-00000000|mid=0|aid=0|vtype=Receipt|vno=" + no + "|vdate=5-Oct-2026|name=|parent=|narr=x|t1=5-Oct-2026 07:30|src=live"
	}
	liveAppend(t, p, l("300"))
	liveFlushAll()
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["event"]) != "created" || str(sent[0]["object_guid"]) != "" || str(sent[0]["xml"]) != "" || sent[0]["alter_id"] != nil {
		t.Fatalf("none found: %v", sent)
	}
	if f.n(vchByNumberID) != 3 {
		t.Fatalf("asked %d times, want 3", f.n(vchByNumberID))
	}
	if logLines("Receipt 300") < 1 || logLines("not found by its type and number") < 1 {
		t.Fatal("the log does not say why")
	}
	// two entries with that type and number on that day: not asked again, sent without
	f.mu.Lock()
	for _, m := range []string{"26400", "26401"} {
		f.vch = append(f.vch, &tVch{guid: fmt.Sprintf("%s-%08x", nwsGUID, toI64(m)), master: m, date: "20261005", typ: "Receipt", no: "301", alter: 54400 + toI64(m) - 26400})
	}
	f.mu.Unlock()
	n0 := f.n(vchByNumberID)
	liveAppend(t, p, l("301"))
	liveFlushAll()
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 2 || str(sent[1]["object_guid"]) != "" || str(sent[1]["xml"]) != "" || f.n(vchByNumberID) != n0+1 {
		t.Fatalf("two found: %v (%d asks)", sent, f.n(vchByNumberID)-n0)
	}
	if logLines("2 entries") < 1 {
		t.Fatal("the log does not say two were found")
	}
}

// --- 4. the request by number: exactly as built, one day, on or after the starting point's day and (with ReadDays off)
// within the last 3 days or the day of a line waiting for it; a quote in the type or number is never asked
func TestNWS144ByNumberGuard(t *testing.T) {
	nwsBridge(t, `,"ReadDays":false`)
	if readDaysOn() {
		t.Fatal("ReadDays on")
	}
	tc := &TC{copier: true}
	ok := voucherByNumberRequest(nwsCo, "20261005", "Receipt", "191")
	if err := datedRefused(tc, ok); err != nil {
		t.Fatalf("refused: %v", err)
	}
	if err := checkAllowed(ok); err != nil {
		t.Fatalf("not pinned: %v", err)
	}
	for name, x := range map[string]string{
		"two days":              strings.Replace(ok, "<SVTODATE>20261005", "<SVTODATE>20261006", 1),
		"before the start":      voucherByNumberRequest(nwsCo, "20261004", "Receipt", "191"),
		"older than 3 days":     voucherByNumberRequest(nwsCo, "20261001", "Receipt", "191"),
		"after today":           voucherByNumberRequest(nwsCo, "20261006", "Receipt", "191"),
		"another filter":        strings.Replace(ok, " AND $VoucherTypeName", " OR $VoucherTypeName", 1),
		"no company start":      voucherByNumberRequest("ANOTHER COMPANY", "20261005", "Receipt", "191"),
		"a field more":          strings.Replace(ok, "GUID, MASTERID", "GUID, MASTERID, ADDRESS", 1),
		"a quote in the number": voucherByNumberRequest(nwsCo, "20261005", "Receipt", `1" OR "1`),
	} {
		if datedRefused(tc, x) == nil {
			t.Errorf("%s: passes the guard", name)
		}
	}
	if voucherByNumberRequest(nwsCo, "20261005", "Receipt", `1"`) != "" {
		t.Error("a quote in the number builds a request")
	}
}

// --- 5. the lines 2.2.0 sent with a placeholder GUID (Receipts 191 and 192): on 2.2.1's first run the holding files of
// the last 7 days are read again, each found by its type, number and date, and a created line goes with the real GUID
// and body, line_id = the original's + ":resolved"; once each, never twice (a restart, another turn)
func TestNWS144ResolveOnce(t *testing.T) {
	lines, _ := nwsFixture(t)
	p, f, c := nwsBridge(t, "")
	liveAppend(t, p, lines...)
	// what 2.2.0 left: the file read to its end and its four line ids sent
	name := filepath.Base(p)
	starts, off := []int64{}, int64(2)
	for _, l := range lines {
		starts = append(starts, off)
		off += int64(len(le16(l + "\r\n")))
	}
	id := func(i int) string { return liveLineID(name, "0", fmt.Sprint(starts[i])) }
	old := []string{id(0), id(1), id(2), id(4)} // 191 (its pre alone), 189, 190, 192 (its pair: the post's start)
	if err := saveFile(liveOffsetsFile(), jsonText(M{"files": M{name: M{"off": off, "gen": 0, "enc": "utf16"}}})); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(liveSentDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	liveSaveSent(old)
	liveResetState()
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 2 {
		t.Fatalf("resolved lines sent: %v", sent)
	}
	want := map[string][2]string{id(0) + ":resolved": {"191", nwsGUID + "-000066c7"}, id(4) + ":resolved": {"192", nwsGUID + "-000066c8"}}
	for _, s := range sent {
		w, had := want[str(s["line_id"])]
		if !had || str(s["event"]) != "created" || str(s["vch_no"]) != w[0] || str(s["object_guid"]) != w[1] || !strings.Contains(str(s["xml"]), "<GUID>"+w[1]+"</GUID>") {
			t.Errorf("resolved: %v", s)
		}
		delete(want, str(s["line_id"]))
	}
	if len(want) != 0 {
		t.Fatalf("not resolved: %v", want)
	}
	// never twice: another turn, a restart, a day later
	readAndUploadAll(t)
	liveResetState()
	readAndUploadAll(t)
	nowFn = func() time.Time { return time.Date(2026, 10, 6, 9, 0, 0, 0, liveZone) }
	liveResetState()
	readAndUploadAll(t)
	if n := len(c.recSent()); n != 2 {
		t.Fatalf("sent again: %d lines", n)
	}
	_ = f
}

// --- 6. a line 2.2.1 itself sent held (none found) is resolved later, once, when Tally has the entry
func TestNWS144HeldResolvedLater(t *testing.T) {
	p, f, c := nwsBridge(t, `,"RecorderResolveSec":0`)
	liveAppend(t, p, "FCR1|ev=voucher_accept_pre|t0=5-Oct-2026 07:40|tw=5-Oct-2026 07:40|cguid="+nwsGUID+"|cname="+nwsCo+"|user=owner|obj=Voucher|guid="+
		nwsGUID+"-00000000|mid=0|aid=0|vtype=Receipt|vno=400|vdate=5-Oct-2026|name=|parent=|narr=late|t1=5-Oct-2026 07:40|src=live")
	liveFlushAll()
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["object_guid"]) != "" {
		t.Fatalf("held: %v", sent)
	}
	f.mu.Lock()
	f.vch = append(f.vch, &tVch{guid: nwsGUID + "-00006a00", master: "27136", date: "20261005", typ: "Receipt", no: "400", narr: "late", party: "Customer A",
		alter: 54410, lines: [][2]string{{"Customer A", "1.00"}, {"Bank", "-1.00"}}})
	f.mu.Unlock()
	readAndUploadAll(t)
	readAndUploadAll(t)
	sent = c.recSent()
	if len(sent) != 2 || str(sent[1]["line_id"]) != str(sent[0]["line_id"])+":resolved" || str(sent[1]["object_guid"]) != nwsGUID+"-00006a00" {
		t.Fatalf("resolved later: %v", sent)
	}
}

// --- 7. the add-on's times are to the minute: its note says so, and the sheet tells the owner to use a stopwatch
func TestNWS144TimeToTheMinute(t *testing.T) {
	tdl := readText(filepath.Join("addon", liveAddonName))
	sheet := readText(filepath.Join("..", "docs", "bridge-2.2.1-test-sheet.txt"))
	const said = "TDL gives the time to the minute only; save time is measured by the owner with a stopwatch"
	if !strings.Contains(tdl, said) || !strings.Contains(sheet, said) {
		t.Fatal("the add-on note or the 2.2.1 sheet does not say the time is to the minute")
	}
	for _, s := range []string{"Created", "Altered", "Deleted", "Cancelled", "Receipts 191 and 192"} {
		if !strings.Contains(sheet, s) {
			t.Errorf("the 2.2.1 sheet lacks %q", s)
		}
	}
}

// the lines read, and the pairs waiting taken alone now (as after RecorderPairSec)
func liveFlushAll() {
	liveReadOnce()
	live.mu.Lock()
	liveFresh()
	for k, p := range live.pending {
		delete(live.pending, k)
		liveFlush(p, false)
	}
	live.mu.Unlock()
}
