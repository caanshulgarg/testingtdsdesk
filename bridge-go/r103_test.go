package main

import (
	"strings"
	"testing"
	"time"
)

// ROUND 103 (1d): "Test reading old days (read-only)": a person's (the tray), never a web page's; F1 for the 1st, the
// 15th and the last day of the month before, one at a time under the 2 s stop; rows counted only (nothing kept, stored,
// posted or sent to FinCom but the result in the beat); a stop ends the test there; any other FinComDayHeads still refused
func TestR103OldDaysTest(t *testing.T) {
	f, c, _ := pullBridge(t)
	n0 := f.n("")
	for _, origin := range []string{"https://app.fincom.live", "https://evil.example"} {
		for _, method := range []string{"POST", "GET"} {
			if code, _ := callLocal(t, method, "/tray/oldtest", origin, `{"company":"ZZ TEST"}`); code != 403 {
				t.Fatalf("%s from %s: %d (want 403)", method, origin, code)
			}
		}
	}
	if code, _ := callLocalHeaders(t, "POST", "/tray/oldtest", map[string]string{"Sec-Fetch-Site": "same-site"}, `{"company":"ZZ TEST"}`); code != 403 {
		t.Fatal("a Sec-Fetch header not refused")
	}
	if f.n("") != n0 {
		t.Fatal("a refused call reached Tally")
	}
	// the days: the 1st, 15th and last of the month before (nowFn: 21-Oct-2026 in pullBridge)
	if d := oldTestDays(nowFn()); strings.Join(d, ",") != "20260901,20260915,20260930" {
		t.Fatalf("the days: %v", d)
	}
	_, pv := callLocal(t, "POST", "/tray/oldtest", "", `{"preview":true}`)
	if pv["ok"] != true || len(arr(pv["companies"])) == 0 || str(obj(arr(pv["companies"])[0])["company"]) != zz {
		t.Fatalf("the preview: %v", pv)
	}
	if f.n("") != n0 {
		t.Fatal("the preview asked Tally")
	}
	pullDay(f, "20260901", 5000, "Sales", "Receipt")
	kinds0 := len(c.kinds)
	_, r := callLocal(t, "POST", "/tray/oldtest", "", `{"company":"`+zz+`"}`)
	if r["ok"] != true {
		t.Fatalf("not started: %v", r)
	}
	var s M
	for i := 0; i < 100; i++ {
		_, s = callLocal(t, "GET", "/tray/oldtest", "", "")
		if str(s["state"]) == "done" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(s["state"]) != "done" || len(arr(s["results"])) != 3 || toInt(obj(arr(s["results"])[0])["rows"]) != 2 || !strings.HasSuffix(str(s["line"]), "· no freeze") {
		t.Fatalf("the result: %v", s)
	}
	if f.n(dayHeadsID) != 3 || f.n("")-n0 != 3 {
		t.Fatalf("asked of Tally: %v", f.ids()[n0:])
	}
	for _, k := range c.kinds[kinds0:] {
		if k != "beat" && k != "hello" {
			t.Fatalf("sent to FinCom during the test: %v", c.kinds[kinds0:])
		}
	}
	if b := oldTestBeat(); b == nil || str(b["line"]) != str(s["line"]) {
		t.Fatalf("the beat: %v", b)
	}
	// after the test: the same request is refused again (no listed day)
	if _, err := invokeTally(recorderTC(nil), f.port, dayHeadsRequest(zz, "20260901"), 5); err == nil {
		t.Fatal("FinComDayHeads went after the test ended")
	}
	// review 103: Tally's window not watched (no window seen, e.g. a Windows service): said so, never "no freeze"
	ow := windowHoldFn
	windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return -1 } }

	_, _ = callLocal(t, "POST", "/tray/oldtest", "", `{"company":"`+zz+`"}`)
	for i := 0; i < 200; i++ {
		_, s = callLocal(t, "GET", "/tray/oldtest", "", "")
		if str(s["state"]) == "done" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(s["state"]) != "done" || strings.Contains(str(s["line"]), "no freeze") || !strings.Contains(str(s["line"]), "could not be watched") {
		t.Fatalf("not watched: %v", s)
	}
	windowHoldFn = ow
	// over 2 s on the first day: the test stops there
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == dayHeadsID {
			return 2500 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	n1 := f.n(dayHeadsID)
	_, r = callLocal(t, "POST", "/tray/oldtest", "", `{"company":"`+zz+`"}`)
	for i := 0; i < 200; i++ {
		_, s = callLocal(t, "GET", "/tray/oldtest", "", "")
		if str(s["state"]) == "done" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if f.n(dayHeadsID)-n1 != 1 || !strings.Contains(str(s["line"]), "longer than 2 s") {
		t.Fatalf("a stop: %d asked, %v", f.n(dayHeadsID)-n1, s["line"])
	}
}
