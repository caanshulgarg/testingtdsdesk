package main

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a port 0 is never kept: the bridge's own port goes back to its default, Tally's ports to "auto" (found each time)
func TestPortsNeverZero(t *testing.T) {
	if p, auto := cleanPorts([]any{float64(0), float64(9000), float64(9000), float64(-1), float64(70000)}); auto || len(p) != 1 || p[0] != 9000 {
		t.Fatalf("clean: %v %v", p, auto)
	}
	for _, v := range []any{nil, "auto", []any{}, []any{float64(0)}} {
		if _, auto := cleanPorts(v); !auto {
			t.Fatalf("%v is not auto", v)
		}
	}
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	defer func() { ConfigPath, Home = oldC, oldH; loadConfigRO() }()
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"Port":0,"TallyPorts":[0],"FallbackPorts":[0,9001]}`), 0o644)
	loadConfig()
	if toInt(cfg("Port")) != 9100 || cfgS("TallyPorts") != "auto" || len(arr(cfg("FallbackPorts"))) != 1 {
		t.Fatalf("guarded: %v %v %v", cfg("Port"), cfg("TallyPorts"), cfg("FallbackPorts"))
	}
	setCfg("TallyPorts", []any{float64(0)})
	setCfg("Port", float64(0))
	saveConfig()
	txt := readText(ConfigPath)
	if strings.Contains(strings.ReplaceAll(txt, " ", ""), `"Port":0`) || strings.Contains(txt, `[0]`) || !strings.Contains(txt, `"auto"`) {
		t.Fatalf("a 0 was saved: %s", txt)
	}
	c := newOrdered()
	c.Set("Mode", "test")
	c.Set("Port", float64(0))
	guardPorts(c)
	if toInt(c.Get("Port")) != 9101 {
		t.Fatal("test mode's own port")
	}
}

// the company is exactly the one named (spaces, line breaks, capitals aside); another open company is never taken
func TestCompanyGuard(t *testing.T) {
	open := []string{"GARG SHEKHAR & CO", "Other Ltd", "Garg  Shekhar &\r\n Company"}
	if name, n := matchCompany("GARG SHEKHAR & COMPANY", open); n != 1 || name != "Garg  Shekhar &\r\n Company" {
		t.Fatalf("%q %d", name, n)
	}
	if _, n := matchCompany("GARG SHEKHAR & COMPANY", []string{"Other Ltd"}); n != 0 {
		t.Fatal("fell back to the open company")
	}
	if _, n := matchCompany("GARG SHEKHAR & COMPANY", []string{"GARG SHEKHAR & CO.", "GARG SHEKHAR & COMPANY LLP"}); n != 0 {
		t.Fatal("a similar name was taken")
	}
	if _, n := matchCompany("abc ltd", []string{"ABC Ltd", "abc  LTD"}); n != 2 {
		t.Fatal("two that match are not ambiguous")
	}
	if sameCompany("", "") {
		t.Fatal("empty names match")
	}
}

// one status line for posting
func TestPostingLines(t *testing.T) {
	co := "GARG SHEKHAR & COMPANY"
	cases := map[string]string{
		waitingLine(co, &tallyWait{"notopen", "x"}):                                         "Waiting for Tally: GARG SHEKHAR & COMPANY is not open — open it in TallyPrime; it will be posted automatically",
		waitingLine(co, errors.New("dial tcp 127.0.0.1:9000: connect: connection refused")): "Waiting for Tally: TallyPrime is not open — open TallyPrime with GARG SHEKHAR & COMPANY; it will be posted automatically",
		sendingLine(2, 5):                                                       "Sending 2 of 5 to Tally",
		postedLine(5, 5, false):                                                 "Posted 5 of 5 (verified in Tally)",
		postedLine(5, 5, true):                                                  "Posted 5 of 5 (being checked in Tally)",
		failedLine("Ledger 'X' does not exist!"):                                "Failed: ledger 'X' is not in Tally — create it, then press Retry in FinCom",
		failedLine("Voucher Type 'Journal-2' does not exist!"):                  "Failed: voucher type 'Journal-2' is not in Tally — create it, then press Retry in FinCom",
		failedLine("The entry has no valid date, so it was not sent to Tally."): "Failed: the entry's date is not within the company's books in Tally — correct the date, then press Retry in FinCom",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("\n got  %q\n want %q", got, want)
		}
	}
	if !strings.HasPrefix(waitingLine(co, errors.New("Tally is busy and did not answer in time")), "Waiting for Tally: Tally is busy") {
		t.Fatal("busy")
	}
	if l := jobFailedLine(2, 5, "Ledger 'X' does not exist!"); l != "Failed: 2 of 5 entries refused by Tally; first: ledger 'X' is not in Tally — create it, then press Retry in FinCom" {
		t.Fatal(l)
	}
	if cloudPostStatus("waiting") != "taken" || cloudPostStatus("running") != "running" || cloudPostStatus("failed") != "failed" || cloudPostStatus("done") != "done" {
		t.Fatal("cloud status")
	}
	for _, c := range []struct {
		r    M
		send bool
		want string
	}{{nil, false, "waiting"}, {nil, true, "sending"}, {M{"ok": true, "verified": true}, false, "in_tally"}, {M{"ok": true, "pendingCheck": true}, false, "sent"}, {M{"ok": false}, false, "failed"}} {
		if itemState(c.r, c.send) != c.want {
			t.Fatalf("%v -> %s", c.r, itemState(c.r, c.send))
		}
	}
}

// nothing is posted twice: what has a result is never sent again; a lost answer is sent again only when Tally was read
// and the entry's tag is not there; an entry without a tag is never sent again on a guess
func TestNoDoublePost(t *testing.T) {
	v := func(id string) M {
		return M{"id": id, "kind": "voucher", "xml": "<VOUCHER><DATE>20260401</DATE><NARRATION>x TDSDesk:" + id + "</NARRATION></VOUCHER>"}
	}
	all := []M{v("a"), v("b"), v("c"), {"id": "m", "kind": "master", "xml": "<LEDGER NAME=\"L\"/>"}}
	left := itemsToSend(all, []M{{"id": "a", "ok": true, "verified": true}, {"id": "b", "ok": true, "alreadyThere": true}})
	if len(left) != 2 || str(left[0]["id"]) != "c" || str(left[1]["id"]) != "m" {
		t.Fatalf("left %v", left)
	}
	if again, _ := resendLost(v("c"), true, true); again {
		t.Fatal("found in Tally, sent again")
	}
	if again, _ := resendLost(v("c"), false, false); again {
		t.Fatal("sent again without a read of Tally")
	}
	if again, _ := resendLost(v("c"), true, false); !again {
		t.Fatal("read, not there: should go")
	}
	if again, why := resendLost(M{"id": "u", "kind": "voucher", "xml": "<VOUCHER><DATE>20260401</DATE></VOUCHER>"}, true, false); again || why == "" {
		t.Fatal("an entry without a tag was sent again")
	}
	if again, _ := resendLost(all[3], true, false); !again {
		t.Fatal("a master")
	}
	if !confirmedResult(M{"ok": true}) || confirmedResult(M{"ok": false}) || confirmedResult(nil) {
		t.Fatal("confirmed")
	}
}

// Tally not answering: the posting waits ("Waiting for Tally: ..."), never fails, keeps no port 0, and stops when cancelled
func TestJobWaitsForTally(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	defer func() { ConfigPath, Home = oldC, oldH; loadConfigRO() }()
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	_ = os.WriteFile(ConfigPath, []byte(`{"TallyPorts":"auto","FallbackPorts":[`+itoa(closed)+`],"AllowImport":true,"LogFile":"`+filepath.ToSlash(filepath.Join(dir, "b.log"))+`"}`), 0o644)
	loadConfig()
	p, err := newPostJob(M{"jobId": "job-aebb6c15", "company": "GARG SHEKHAR & COMPANY", "port": 0, "checkFirst": true,
		"vouchers": []any{M{"id": "v1", "xml": "<VOUCHER><DATE>20260401</DATE><NARRATION>TDSDesk:v1</NARRATION></VOUCHER>"}}})
	if err != nil {
		t.Fatal(err)
	}
	jd, _ := jobDir(str(p["id"]))
	var v M
	for i := 0; i < 100; i++ {
		v = readProgress(jd)
		if str(v["status"]) == "waiting" && strings.HasPrefix(str(v["message"]), "Waiting for Tally:") {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if str(v["status"]) != "waiting" || !strings.Contains(str(v["message"]), "it will be posted automatically") {
		t.Fatalf("not waiting: %v %v", v["status"], v["message"])
	}
	items := arr(v["items"])
	if len(items) != 1 || str(obj(items[0])["state"]) != "waiting" {
		t.Fatalf("items %v", items)
	}
	for _, f := range []string{"payload.json", "progress.json"} {
		if re(`"port":\s*0\b`).MatchString(readText(filepath.Join(jd, f))) {
			t.Fatalf("%s keeps port 0", f)
		}
	}
	if postingNow() == "" || cloudPostStatus(str(v["status"])) != "taken" {
		t.Fatal("the waiting posting is not shown")
	}
	if _, err := cancelJob("job-aebb6c15", "test"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 40 && str(readProgress(jd)["status"]) != "cancelled"; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if st := str(readProgress(jd)["status"]); st != "cancelled" {
		t.Fatalf("not cancelled: %s", st)
	}
	for i := 0; i < 30 && jobAlive("job-aebb6c15"); i++ {
		time.Sleep(100 * time.Millisecond)
	}
}

func itoa(i int) string { return strings.TrimSpace(jsonText(i)) }
