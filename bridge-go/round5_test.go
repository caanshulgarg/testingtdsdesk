package main

// Round 5 (03-Oct-2026): the code and security reviews of round 4, bridge side (C4, C5, C7, C8, S5)

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- C4. the tray is a program of its own, calling the service's web server: its Measure Tally item works in every run
// mode, the service included; a web page is still refused; the service never starts a measure by itself
func TestMeasureFromTrayUnderService(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key","TallyMaxSec":1`)
	was := runMode
	runMode = "service"
	t.Cleanup(func() { runMode = was })
	for _, origin := range []string{"https://app.fincom.live", "http://localhost:5173"} {
		for _, p := range []string{"/measure", "/tray/measure"} {
			if code, _ := callLocal(t, "POST", p, origin, `{"company":"ZZ TEST"}`); code != 403 {
				t.Fatalf("POST %s from the web page %s under the service: %d (want 403)", p, origin, code)
			}
		}
	}
	code, res := callLocal(t, "POST", "/tray/measure", "", `{"company":"ZZ TEST"}`)
	if code != 200 || res["ok"] != true || str(res["state"]) != "running" {
		t.Fatalf("the tray's Measure Tally under the service: %d %v", code, res)
	}
	for i := 0; i < 200 && str(measureStatus()["state"]) == "running"; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if st := measureStatus(); str(st["state"]) != "done" {
		t.Fatalf("the tray's measure did not run under the service: %v", st)
	}
	if code, _ := callLocal(t, "GET", "/measure", "", ""); code != 200 {
		t.Fatalf("the console's GET /measure under the service: %d", code)
	}
	if n := logLines("not run by the Windows service"); n != 0 {
		t.Fatal("the service refused a measure the tray started")
	}
}

// --- C5. the console command never measures from its own process while a bridge is running (its reads and postings
// go through that bridge's one-at-a-time gate): a bridge that refuses or is busy ends the command with the reason; only
// when no bridge answers at all does the console measure itself
func TestConsoleMeasureNeverParallel(t *testing.T) {
	local := 0
	localRun := func() (M, error) { local++; return M{"report": "r", "file": "f"}, nil }
	// a running bridge that refuses
	code, said := consoleMeasure(measureOpts{company: zz}, "up", func() M { return M{"ok": false, "error": "busy with a posting"} }, nil, localRun)
	if code == 0 || local != 0 || !strings.Contains(said, "busy with a posting") || !strings.Contains(strings.ToLower(said), "not measured") {
		t.Fatalf("a refusing bridge: code %d, local runs %d, said %q", code, local, said)
	}
	// a running bridge that does not answer the start (busy)
	code, said = consoleMeasure(measureOpts{company: zz}, "up", func() M { return nil }, nil, localRun)
	if code == 0 || local != 0 || !strings.Contains(strings.ToLower(said), "not measured") {
		t.Fatalf("a bridge not answering the start: code %d, local runs %d, said %q", code, local, said)
	}
	// a running bridge that takes it: followed to the end, nothing local
	n := 0
	code, said = consoleMeasure(measureOpts{company: zz}, "up", func() M { return M{"ok": true, "state": "running"} }, func() M {
		n++
		return M{"state": "done", "report": "the report", "file": "x.txt"}
	}, localRun)
	if code != 0 || local != 0 || n == 0 || !strings.Contains(said, "the report") {
		t.Fatalf("through the bridge: code %d, local %d, polls %d, said %q", code, local, n, said)
	}
	// no bridge at all: measured here
	code, _ = consoleMeasure(measureOpts{company: zz}, "none", nil, nil, localRun)
	if code != 0 || local != 1 {
		t.Fatalf("no bridge: code %d, local runs %d", code, local)
	}
}

// --- C7. an entry Tally ALTERED: round 15 (the owner's decision of 03-Oct-2026) trusts Tally's reply: ALTERED counts as
// posted (CREATED + ALTERED == the request's size), marked altered1, with Tally's voucher id; nothing is read back and
// no "unknown, accepted" state remains (round 5's rule is replaced)
func TestAlteredReplyIsPosted(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	f.importAltered = true
	f.storeNarr = f1NoTag
	standBridge(t, f, "")
	r := postOne(t, "alt1", f1Voucher("alt1", ""))
	if r["ok"] != true || r["byReply"] != true || r["altered1"] != true || toInt(r["altered"]) != 1 || toInt(r["created"]) != 0 || str(r["vchId"]) == "" {
		t.Fatalf("an ALTERED entry: %v", r)
	}
	if itemState(r, false) != "posted" || !confirmedResult(r) {
		t.Fatalf("state %s, kept on Retry %v", itemState(r, false), confirmedResult(r))
	}
	if left := itemsToSend([]M{{"id": "alt1", "kind": "voucher"}}, []M{r}); len(left) != 0 {
		t.Fatalf("queued again: %v", left)
	}
	// the job: done, nothing checking, the item posted with Tally's voucher id
	j, err := newPostJob(M{"jobId": "job-c7-altered", "company": zz, "vouchers": []any{M{"id": "alt2", "xml": f1Voucher("alt2", "")}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	if str(p["status"]) != "done" || p["checking"] == true {
		t.Fatalf("the job: %v", p)
	}
	e := obj(arr(p["items"])[0])
	if str(e["state"]) != "posted" || e["byReply"] != true || str(e["vchId"]) == "" {
		t.Fatalf("the item: %v", e)
	}
	if strings.Contains(str(p["message"]), "being checked") {
		t.Fatalf("the job's line: %q", p["message"])
	}
	if f.n("Import") != 2 || f.n(masterCheckID)+f.n(tagCheckID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
}

// --- C8. a cancel arriving after the posting is done changes nothing: there are no later checks to stop (round 15),
// the posting stays done, its results kept
func TestCancelAfterDoneKeepsDone(t *testing.T) {
	f := newStandTally(t)
	f.ansi = true
	standBridge(t, f, "")
	td := today()
	j, err := newPostJob(M{"jobId": "job-c8-cancel", "company": zz, "vouchers": []any{
		M{"id": "ok1", "xml": finVoucher("ok1", fgParty, "OK-1", td, "10.00")},
		M{"id": "un1", "xml": f1Voucher("un1", "")},
	}})
	if err != nil {
		t.Fatal(err)
	}
	id := str(j["id"])
	dir, _ := jobDir(id)
	p := waitJob(t, id)
	if str(p["status"]) != "done" || jobAlive(id) {
		t.Fatalf("the job: %v", p)
	}
	if _, err := cancelJob(id, "the owner pressed Cancel"); err != nil {
		t.Fatal(err)
	}
	p = readProgress(dir)
	if str(p["status"]) != "done" {
		t.Fatalf("the cancel re-finished a done posting as %q: %v", p["status"], p["message"])
	}
	states := map[string]string{}
	for _, x := range arr(p["items"]) {
		e := obj(x)
		states[str(e["id"])] = str(e["state"])
	}
	if states["ok1"] != "posted" || states["un1"] != "posted" {
		t.Fatalf("the items after the cancel: %v", states)
	}
	if logLines("Posting job "+id+" cancelled:") > 0 {
		t.Fatal("the job was finished as cancelled")
	}
	_ = filepath.Join(dir, "cancel")
}

// --- S5. tagFirst moves the exact token, never the prefix of a longer tag (TDSDesk:ab1 inside TDSDesk:ab12)
func TestTagFirstExactToken(t *testing.T) {
	for in, want := range map[string]string{
		`<VOUCHER><NARRATION>x TDSDesk:ab12 y | TDSDesk:ab1</NARRATION></VOUCHER>`:         "TDSDesk:ab1 | x TDSDesk:ab12 y",
		`<VOUCHER><NARRATION>TDSDesk:ab12 | TDSDesk:ab1</NARRATION></VOUCHER>`:             "TDSDesk:ab1 | TDSDesk:ab12",
		`<VOUCHER><NARRATION>see TDSDesk:ab1.2 then TDSDesk:ab1 end</NARRATION></VOUCHER>`: "TDSDesk:ab1 | see TDSDesk:ab1.2 then end",
		`<VOUCHER><NARRATION>TDSDesk:ab1 | rent</NARRATION></VOUCHER>`:                     "TDSDesk:ab1 | rent",
		`<VOUCHER><NARRATION>rent TDSDesk:ab12</NARRATION></VOUCHER>`:                      "rent TDSDesk:ab12", // not this entry's tag: untouched
	} {
		got := group(`<NARRATION>([\s\S]*?)</NARRATION>`, tagFirst(in, "TDSDesk:ab1"), 1)
		if got != want {
			t.Errorf("tagFirst(%s) narration %q, want %q", in, got, want)
		}
	}
}
