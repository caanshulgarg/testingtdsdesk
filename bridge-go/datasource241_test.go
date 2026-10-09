package main

// 2.4.1 (the owner's approval of 09-Oct-2026, item 1-2): the add-on writes each company's data folder on every line
// ("|dp=<path>", between tw and w); the bridge learns its own Tally's data id per company from its own lines (w= this
// Windows user, the company open in its own Tally, the most recent dp) and a line of ANOTHER data id for the same company
// GUID is never fetched from Tally, never sent as an entry: it goes as kind 'other_source' (company, its GUID, the data id,
// the path, w=, the computer, the line's date, type and number; no body). A line without dp= (an older add-on) is as in
// 2.4.0. FinCom's beat answer names the chosen data id of each company: a bridge whose own is not the chosen one stops
// reading that company (every line of it goes as 'other_source'). Tests written before the code.

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

const (
	d241Path1 = `C:\Users\Public\TallyPrime\Data`
	d241Path2 = `D:\Copy of Tally\DATA`
)

// a line of NWS144 as the 2.4.1 add-on writes it: dp= (the company's data folder) and w= (the Windows user) after tw
func d241Line(ev, tm, guid, mid, aid, typ, no, date, narr, dp, w string) string {
	return strings.Replace(r222Line(ev, tm, guid, mid, aid, typ, no, date, narr), "|cguid=", "|dp="+dp+"|w="+w+"|cguid=", 1)
}

func d241ID(p string) string {
	h := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(p))))
	return hex.EncodeToString(h[:])[:16]
}

// the parser: dp= between tw and w (and the older forms: w= alone, neither)
func TestData241ParserTakesDP(t *testing.T) {
	l := d241Line("voucher_accept_post", "11:30", nwsGUID+"-00006667", "26215", "54400", "Receipt", "191", "5-Oct-2026", "x|dp=no", d241Path1, "anshul")
	r, ok := parseRecorderLine(l)
	if !ok || r.DP != d241Path1 || r.W != "anshul" || r.CGUID != nwsGUID || r.Tw != "5-Oct-2026 11:30" || r.Narr != "x|dp=no" || r.Src != "live" {
		t.Fatalf("2.4.1 line: %v %+v", ok, r)
	}
	r, ok = parseRecorderLine(strings.Replace(l, "|w=anshul", "|w=", 1))
	if !ok || r.DP != d241Path1 || r.W != "" {
		t.Fatalf("no Windows user: %v %+v", ok, r)
	}
	r, ok = parseRecorderLine(strings.Replace(l, "|dp="+d241Path1, "|dp=", 1))
	if !ok || r.DP != "" || r.W != "anshul" {
		t.Fatalf("an empty dp= (the add-on's placeholder): %v %+v", ok, r)
	}
	r, ok = parseRecorderLine(r222Line("voucher_accept_post", "11:30", nwsGUID+"-00006667", "26215", "54400", "Receipt", "191", "5-Oct-2026", "x"))
	if !ok || r.DP != "" || r.W != "" {
		t.Fatalf("an older add-on's line: %v %+v", ok, r)
	}
	// 2.4.0's reader (w= after tw) reads the new line with dp= inside tw, a time it needs only without t0: the user whole
	old := strings.Replace(l, "|dp=", "\x00", 1)
	if r, ok := parseRecorderLine(old); !ok || r.W != "anshul" || r.CGUID != nwsGUID {
		t.Fatalf("as 2.4.0 reads it: %v %+v", ok, r)
	}
}

// the data id: sha256 of the case-folded, trimmed path, its first 16 hex characters; the path itself only for display
func TestData241ID(t *testing.T) {
	if a, b := dataIDOf(" "+d241Path1+" "), dataIDOf(strings.ToUpper(d241Path1)); a != b || a != d241ID(d241Path1) || len(a) != 16 {
		t.Fatalf("data id %q %q, want %q", a, b, d241ID(d241Path1))
	}
	if dataIDOf(d241Path1) == dataIDOf(d241Path2) || dataIDOf("  ") != "" {
		t.Fatal("two folders, one id; or an id for no folder")
	}
}

func d241Sent(c *standCloud, no string) []M { return nwsByNo(c.recSent(), no) }

func d241Asked(f *standTally, mid string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, b := range f.bodies {
		if strings.Contains(b, "ID:"+mid+"</ID>") || strings.Contains(b, mid+"</MASTERID>") {
			return true
		}
	}
	return false
}

// two data folders of one company (the same GUID) write into the recorder folder: the own one (w= this user) is fetched
// and sent with its data id; the other is never asked of Tally and goes as 'other_source', heads only
func TestData241TwoSourcesOtherNeverFetched(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p,
		d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"),
		d241Line("voucher_accept_post", "11:31", r222GUID(25743), "25743", "0", "Sales", "2026-27/GST/297", "5-Oct-2026", "SECRET-NARR", d241Path2, ""))
	readAndUploadAll(t)
	own := d241Sent(c, "191")
	if len(own) != 1 || str(own[0]["event"]) != "created" && str(own[0]["event"]) != "altered" || str(own[0]["data_id"]) != d241ID(d241Path1) || str(own[0]["xml"]) == "" {
		t.Fatalf("the own line: %v", own)
	}
	o := d241Sent(c, "2026-27/GST/297")
	if len(o) != 1 {
		t.Fatalf("the other source's line: %v (all %v)", o, c.recSent())
	}
	x := o[0]
	if str(x["event"]) != "other_source" || str(x["data_id"]) != d241ID(d241Path2) || str(x["data_path"]) != d241Path2 || str(x["company_guid"]) != nwsGUID ||
		str(x["vch_type"]) != "Sales" || str(x["vch_date"]) != "20261005" || str(x["pc"]) == "" || str(x["of"]) != "created" || x["received_at"] == nil {
		t.Fatalf("other_source: %v", x)
	}
	for _, k := range []string{"xml", "narration", "object_guid", "master_id", "alter_id", "ledgers", "fid"} {
		if v, had := x[k]; had && v != nil && str(v) != "" && str(v) != "[]" {
			t.Errorf("other_source carries %s: %v", k, v)
		}
	}
	if strings.Contains(jsonText(x), "SECRET-NARR") {
		t.Fatal("the other source's narration was sent")
	}
	if d241Asked(f, "25743") {
		t.Fatal("the other source's entry was asked of Tally")
	}
	if !d241Asked(f, "26311") {
		t.Fatal("the own entry was not asked of Tally")
	}
	// the beat names the own data id per company (never the other's)
	b := beatBody(true, "open", "", nil, nil, nil)
	ds := arr(b["dataSources"])
	if len(ds) != 1 || str(obj(ds[0])["data_id"]) != d241ID(d241Path1) || str(obj(ds[0])["company_guid"]) != nwsGUID || str(obj(ds[0])["path"]) != d241Path1 {
		t.Fatalf("the beat's dataSources: %v", ds)
	}
}

// the same for a bridge that reads every Windows user's lines (the service): another user's line of another data folder
func TestData241OtherUserOtherFolderService(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "service", "anshul")
	liveAppend(t, p,
		d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"),
		d241Line("voucher_accept_post", "11:31", r222GUID(26312), "26312", "54392", "Receipt", "192", "5-Oct-2026", "theirs", d241Path2, "Ranjeet"))
	readAndUploadAll(t)
	if o := d241Sent(c, "192"); len(o) != 1 || str(o[0]["event"]) != "other_source" || str(o[0]["w"]) != "Ranjeet" {
		t.Fatalf("another folder's line: %v", o)
	}
	if d241Asked(f, "26312") {
		t.Fatal("asked of Tally")
	}
}

// FinCom's choice (the beat's answer): the chosen data id is another one: this bridge's own lines go as 'other_source'
// (it stops reading the company); the chosen one's bridge sends its lines as before
func TestData241ChosenElsewhereStopsReading(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "own", d241Path1, "anshul"))
	readAndUploadAll(t)
	if s := d241Sent(c, "191"); len(s) != 1 || str(s[0]["event"]) == "other_source" {
		t.Fatalf("before a choice: %v", s)
	}
	applyDataSources(M{"dataSources": []any{M{"company": nwsCo, "company_guid": nwsGUID, "chosenId": d241ID(d241Path2), "chosen": false}}})
	if !dataStopped(nwsGUID) {
		t.Fatal("the company is not stopped here")
	}
	liveAppend(t, p, d241Line("voucher_accept_post", "11:40", r222GUID(26312), "26312", "54392", "Receipt", "192", "5-Oct-2026", "own after", d241Path1, "anshul"))
	readAndUploadAll(t)
	if s := d241Sent(c, "192"); len(s) != 1 || str(s[0]["event"]) != "other_source" || str(s[0]["data_id"]) != d241ID(d241Path1) {
		t.Fatalf("after FinCom chose the other folder: %v", s)
	}
	if d241Asked(f, "26312") {
		t.Fatal("asked of Tally after the choice")
	}
	// the choice is kept across a restart
	liveResetState()
	dataResetState()
	if !dataStopped(nwsGUID) {
		t.Fatal("the choice was not kept")
	}
	// FinCom answers the own one chosen: read again
	applyDataSources(M{"dataSources": []any{M{"company": nwsCo, "company_guid": nwsGUID, "chosenId": d241ID(d241Path1), "chosen": true}}})
	if dataStopped(nwsGUID) {
		t.Fatal("still stopped with the own folder chosen")
	}
}

// the chosen folder's own bridge (another Windows user's): its lines go as before, with their data id
func TestData241ChosenBridgeApplies(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "Ranjeet")
	applyDataSources(M{"dataSources": []any{M{"company": nwsCo, "company_guid": nwsGUID, "chosenId": d241ID(d241Path2), "chosen": true}}})
	liveAppend(t, p, d241Line("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "5-Oct-2026", "two", d241Path2, "Ranjeet"))
	readAndUploadAll(t)
	if s := d241Sent(c, "191"); len(s) != 1 || str(s[0]["event"]) == "other_source" || str(s[0]["data_id"]) != d241ID(d241Path2) || str(s[0]["xml"]) == "" {
		t.Fatalf("the chosen folder's line: %v", s)
	}
	if !d241Asked(f, "26311") {
		t.Fatal("not asked of Tally")
	}
}

// an older add-on (no dp=): as in 2.4.0, whatever the choice FinCom names
func TestData241OldAddonUnchanged(t *testing.T) {
	p, f, c := r222bBridge(t, "")
	ufAs(t, "user", "anshul")
	liveAppend(t, p, ufLineNWS("voucher_accept_post", "11:30", r222GUID(26311), "26311", "54391", "Receipt", "191", "anshul"))
	readAndUploadAll(t)
	s := d241Sent(c, "191")
	if len(s) != 1 || str(s[0]["event"]) == "other_source" || str(s[0]["xml"]) == "" {
		t.Fatalf("an older add-on's line: %v", s)
	}
	if _, had := s[0]["data_id"]; had {
		t.Fatalf("an older add-on's line carries a data id: %v", s[0])
	}
	if !d241Asked(f, "26311") {
		t.Fatal("not asked of Tally")
	}
	if ds := arr(beatBody(true, "open", "", nil, nil, nil)["dataSources"]); len(ds) != 0 {
		t.Fatalf("dataSources without dp=: %v", ds)
	}
}

func ufLineNWS(ev, tm, guid, mid, aid, typ, no, w string) string {
	return strings.Replace(r222Line(ev, tm, guid, mid, aid, typ, no, "5-Oct-2026", "x"), "|cguid=", "|w="+w+"|cguid=", 1)
}

// the add-on: dp= from ONE named formula (its measured text is dropped in later), between tw and w
func TestData241Addon(t *testing.T) {
	tdl := readText("addon/" + liveAddonName)
	for _, s := range []string{"FCRDataPath", `"|tw=" + ##vTW + "|dp=" + @@FCRDataPath + "|w=" + @@FCRWinUser`} {
		if !strings.Contains(tdl, s) {
			t.Errorf("the live add-on lacks %q", s)
		}
	}
	if strings.Count(tdl, "FCRDataPath  :") != 1 && strings.Count(tdl, "FCRDataPath :") != 1 {
		t.Error("FCRDataPath is not ONE named formula")
	}
}
