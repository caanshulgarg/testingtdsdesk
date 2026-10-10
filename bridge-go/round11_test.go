package main

// Round 11 (03-Oct-2026, owner-approved): the PostOnly guard, the ledger's state in the ledger list, the installer define

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- 2. PostOnly: a posting aimed at a company not in the list is refused before one request goes to Tally
func TestPostOnlyRefusesOtherCompany(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"PostOnly":["ZZ TEST"]`)
	before := f.n("")
	j, err := newPostJob(M{"jobId": "job-postonly-1", "company": "GARG SHEKHAR & COMPANY", "vouchers": []any{
		M{"id": "po1", "xml": finVoucher("po1", fgParty, "PO-1", today(), "1.00")}, M{"id": "po2", "xml": finVoucher("po2", fgParty, "PO-2", today(), "2.00")}}})
	if err != nil {
		t.Fatal(err)
	}
	p := waitJob(t, str(j["id"]))
	if f.n("") != before {
		t.Fatalf("%d request(s) went to Tally for a refused posting", f.n("")-before)
	}
	want := "This computer posts only to ZZ TEST (PostOnly); posting to GARG SHEKHAR & COMPANY refused"
	if str(p["status"]) != "failed" || !strings.Contains(str(p["message"]), want) {
		t.Fatalf("the job: %s %q", p["status"], p["message"])
	}
	if len(arr(p["results"])) != 2 || len(arr(p["items"])) != 2 {
		t.Fatalf("results %v items %v", p["results"], p["items"])
	}
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if r["ok"] != false || r["refused"] != true || r["postOnly"] != true || str(r["state"]) != "failed" || str(r["message"]) != want {
			t.Fatalf("a result: %v", r)
		}
	}
	for _, x := range arr(p["items"]) {
		e := obj(x)
		if str(e["state"]) != "failed" || str(e["reason"]) != want {
			t.Fatalf("an item: %v", e)
		}
	}
	if logLines("PostOnly") < 1 {
		t.Fatal("the refusal is not logged")
	}
}

// --- 2. no PostOnly (missing or empty): every company may be posted to; the names are compared folded
func TestPostOnlyEmptyAllowsAll(t *testing.T) {
	for _, extra := range []string{"", `,"PostOnly":[]`, `,"PostOnly":"  "`, `,"PostOnly":["zz   test"]`} {
		f := newStandTally(t)
		standBridge(t, f, extra)
		if r := postOne(t, "ok1", finVoucher("ok1", fgParty, "OK-1", today(), "1.00")); r["ok"] != true || r["byReply"] != true {
			t.Fatalf("with %q the posting to ZZ TEST was refused: %v", extra, r)
		}
		j, err := newPostJob(M{"jobId": "job-postonly-ok", "company": zz, "vouchers": []any{M{"id": "ok2", "xml": finVoucher("ok2", fgParty, "OK-2", today(), "2.00")}}})
		if err != nil {
			t.Fatal(err)
		}
		if p := waitJob(t, str(j["id"])); str(p["status"]) != "done" {
			t.Fatalf("with %q the job: %v", extra, p)
		}
	}
}

// --- 2. the beat carries the list
func TestBeatCarriesPostOnly(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"PostOnly":["ZZ TEST","ZZ TEST 2"]`)
	b := beatBody(true, "", "", nil, nil, nil)
	if got := strs(b["postOnly"]); strings.Join(got, "|") != "ZZ TEST|ZZ TEST 2" {
		t.Fatalf("the beat's postOnly: %v", b["postOnly"])
	}
	setCfg("PostOnly", []any{})
	if got := strs(beatBody(true, "", "", nil, nil, nil)["postOnly"]); len(got) != 0 {
		t.Fatalf("an empty PostOnly in the beat: %v", got)
	}
}

// --- 2. the installer: -DPOSTONLY (default empty) reaches the install command; an existing PostOnly set by hand is kept
func TestInstallerPostOnly(t *testing.T) {
	nsi := readText(filepath.Join("installer", "FinComBridge.nsi"))
	if !strings.Contains(nsi, `!define POSTONLY ""`) || strings.Count(nsi, `--postonly "${POSTONLY}"`) != 2 {
		t.Fatal("FinComBridge.nsi: POSTONLY is not defined empty by default or not passed to both install commands")
	}
	if b := readText("build.sh"); !strings.Contains(b, `-DPOSTONLY="${POSTONLY:-}"`) {
		t.Fatal("build.sh does not pass POSTONLY from the environment")
	}
	c := newOrdered()
	setPostOnly(c, "")
	if c.Has("PostOnly") {
		t.Fatal("an empty define wrote PostOnly")
	}
	setPostOnly(c, "ZZ TEST")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "ZZ TEST" {
		t.Fatalf("PostOnly written: %v", c.Get("PostOnly"))
	}
	c.Set("PostOnly", []any{"BY HAND"}) // a hand edit: the owner's list, marked as such (PostOnlyBy not "installer")
	c.Set("PostOnlyBy", "owner")
	setPostOnly(c, "ZZ TEST")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "BY HAND" {
		t.Fatalf("an existing PostOnly was overwritten: %v", c.Get("PostOnly"))
	}
	setPostOnly(c, "")
	if strings.Join(strs(c.Get("PostOnly")), "|") != "BY HAND" {
		t.Fatalf("an empty define touched PostOnly: %v", c.Get("PostOnly"))
	}
}

// --- 3. the ledger list rows carry the ledger's state (LEDSTATENAME) as the 10th column (2.3.1: the deductee type the 11th)
func TestLedgerListCarriesState(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	for i := 1; i <= 3; i++ {
		f.addLed(fmt.Sprintf("Party %02d", i), "Sundry Creditors", "0.00")
	}
	f.mu.Lock()
	f.led[1].state = "Delhi"
	f.mu.Unlock()
	td := today()
	standBridge(t, f, `,"KeepBudgetSec":600`+c.cfg())
	liveFrom(td)
	runNow(t, "now")
	cloudMu.Lock()
	cloudLinksAt = time.Time{}
	cloudMu.Unlock()
	invokeCloudPush()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.ledList) != 1 {
		t.Fatalf("%d ledger_list calls", len(c.ledList))
	}
	byGUID := map[string][]any{}
	for _, x := range arr(c.ledList[0]["ledgers"]) {
		a := arr(x)
		byGUID[str(at(a, 0))] = a
	}
	for i, want := range map[int]string{0: "", 1: "Delhi", 2: ""} {
		a := byGUID[f.led[i].guid]
		if len(a) != 11 || str(at(a, 9)) != want { // 2.3.1: the deductee type after the state (deductee231_test.go)
			t.Fatalf("the row of %s: %v (want 11 columns, state %q)", f.led[i].name, a, want)
		}
	}
}

// --- security M1 (round 11): PostOnly covers every import path, the local /import route and /unpost included
func TestPostOnlyCoversLocalImport(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key","PostOnly":["ZZ TEST"]`)
	before := f.n("")
	body := jsonText(M{"company": "GARG SHEKHAR & COMPANY", "vouchers": []any{M{"id": "li1", "xml": finVoucher("li1", fgParty, "LI-1", today(), "1.00")}}})
	code, res := callLocal(t, "POST", "/import", "", body)
	want := "This computer posts only to ZZ TEST (PostOnly); posting to GARG SHEKHAR & COMPANY refused"
	if code == 200 && res["ok"] != false {
		t.Fatalf("POST /import for another company was taken: %d %v", code, res)
	}
	if !strings.Contains(str(res["error"])+str(res["message"]), want) {
		t.Fatalf("the refusal does not carry the words: %d %v", code, res)
	}
	if f.n("") != before {
		t.Fatalf("%d request(s) reached Tally", f.n("")-before)
	}
	// invokeImport itself (any caller) refuses too
	if _, err := invokeImport(M{"company": "GARG SHEKHAR & COMPANY", "vouchers": []any{M{"id": "li2", "xml": finVoucher("li2", fgParty, "LI-2", today(), "2.00")}}}); err == nil || err.Error() != want {
		t.Fatalf("invokeImport: %v", err)
	}
	if f.n("") != before {
		t.Fatalf("%d request(s) reached Tally", f.n("")-before)
	}
	// the company in the list still posts
	if r := postOne(t, "li3", finVoucher("li3", fgParty, "LI-3", today(), "3.00")); r["ok"] != true {
		t.Fatalf("ZZ TEST refused: %v", r)
	}
}

func TestPostOnlyCoversUnpost(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"tray-test-key","PostOnly":["ZZ TEST"]`)
	before := f.n("")
	body := jsonText(M{"company": "GARG SHEKHAR & COMPANY", "guid": "g-1", "masterId": "1", "vchType": "Journal", "vchDate": today(), "vchNumber": "1"})
	code, res := callLocal(t, "POST", "/unpost", "", body)
	want := "This computer posts only to ZZ TEST (PostOnly); removing from GARG SHEKHAR & COMPANY refused"
	if code == 200 && res["ok"] != false {
		t.Fatalf("POST /unpost for another company was taken: %d %v", code, res)
	}
	if !strings.Contains(str(res["error"])+str(res["message"]), want) {
		t.Fatalf("the refusal does not carry the words: %d %v", code, res)
	}
	if f.n("") != before || f.n("Import") != 0 {
		t.Fatalf("%d request(s) reached Tally", f.n("")-before)
	}
}
