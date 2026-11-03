// 2.5.3: the user's OWN Tally is never ignored on a shared Windows server. Finding the Tally is a chain that cannot
// silently end empty:
//  1. a Tally positively in this user's Windows session;
//  2. a Tally whose owner is unknown (its session could not be read: run as administrator, access denied, session 0);
//  3. the ports the settings name, every tally.ini's Server Port, and the default 9000, whether or not Windows' listener
//     list showed them;
//  4. (as 1 and 2) any port a TallyPrime program listens on that is not positively another user's.
//
// A Tally is skipped only when it is positively another signed-in user's (or another FinCom Bridge on this computer
// already uses a Tally whose owner is unknown). Each port in the beat says why: open, not answering, owner unknown,
// another user, another bridge, nothing listening; the beat's tallyWhy says it for the whole.
package main

import (
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// one server, two users: durgesh (session 1, this bridge's) and hemant (session 2). procs/listeners as JSON fragments
func r253Server(t *testing.T, procs, listeners string, iniPorts ...int) {
	t.Helper()
	dir := t.TempDir()
	fake := filepath.Join(dir, "fake.json")
	_ = os.WriteFile(fake, []byte(fmt.Sprintf(`{"mySession": 1, "users": {"1": "durgesh", "2": "hemant"}, "processes": [%s], "listeners": [%s]}`, procs, listeners)), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", fake)
	var dirs []string
	for i, p := range iniPorts {
		d := filepath.Join(dir, fmt.Sprint("TallyPrime", i))
		_ = os.MkdirAll(d, 0o755)
		_ = os.WriteFile(filepath.Join(d, "tally.ini"), []byte(fmt.Sprintf("[Tally]\r\nClient Server = Both\r\nServer Port = %d\r\n", p)), 0o644)
		dirs = append(dirs, d)
	}
	old := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return dirs }
	oldClaim := otherBridgeClaimFn
	otherBridgeClaimFn = func(int) string { return "" }
	oldAsk := askAfreshFn
	askAfreshFn = func() { openCompaniesAsk(bgCompaniesTC(), true) }
	t.Cleanup(func() { tallyIniDirsFn, otherBridgeClaimFn, askAfreshFn = old, oldClaim, oldAsk })
	resetIniPorts()
	resetOtherUser()
	askAfreshAt.Store(0) // the once-a-minute guard, as at a bridge's start
	setCfg("TallyPorts", "auto")
	setCfg("OnlyMySession", true)
	coMu.Lock()
	coCache = nil
	coMu.Unlock()
	_ = os.Remove(filepath.Join(syncDir(), "open-companies.json"))
	forgetTallyOpen()
}

func r253Entry(t *testing.T, ss []M, port int) M {
	t.Helper()
	for _, s := range ss {
		if toInt(s["port"]) == port {
			return s
		}
	}
	t.Fatalf("port %d not in the list: %s", port, jsonText(ss))
	return nil
}

// step 1: the Tally positively in this user's session answers and is used
func TestR253StepOwnSession(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || e["skipped"] == true || e["mine"] != true || str(e["reason"]) != "open" {
		t.Fatalf("own Tally: %v", e)
	}
}

// step 2, the Durgesh case: the user's own Tally whose session Windows would not give (run as administrator: the
// old bridge read the failure as session 0 and skipped it as "Tally of Windows session 0") is asked the company list,
// used when it answers, and the beat says the owner is unknown
func TestR253StepOwnerUnknownSessionNotRead(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 0, "sessionUnknown": true}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || e["skipped"] == true || str(e["owner"]) != "unknown" {
		t.Fatalf("owner-unknown Tally not used: %v", e)
	}
	if port, _, err := findCompanyNow("ZZ TEST", 0); err != nil || port != mine.port {
		t.Fatalf("company not found in the owner-unknown Tally: %d %v", port, err)
	}
	_, ports, _, _ := beatParts(openCompaniesCached())
	b := obj(ports[0])
	if str(b["owner"]) != "unknown" || b["skipped"] == true {
		t.Fatalf("beat port: %v", b)
	}
}

// step 2: a Tally that Windows places in session 0 (no signed-in user's session) is not another user's: asked
func TestR253StepOwnerUnknownSessionZero(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 0}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["ok"] != true || e["skipped"] == true || str(e["owner"]) != "unknown" {
		t.Fatalf("session-0 Tally skipped: %v", e)
	}
}

// step 2: an owner-unknown Tally that another FinCom Bridge on this computer already uses is left to it (nothing sent)
func TestR253OwnerUnknownClaimedByAnotherBridge(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 0, "sessionUnknown": true}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	otherBridgeClaimFn = func(p int) string {
		if p == mine.port {
			return "hemant"
		}
		return ""
	}
	e := r253Entry(t, openCompanies(true), mine.port)
	if e["skipped"] != true || str(e["reason"]) != "another bridge" || !strings.Contains(str(e["error"]), "owner unknown") {
		t.Fatalf("claimed Tally: %v", e)
	}
	if n := len(mine.ids()); n != 0 {
		t.Fatalf("a Tally another bridge uses was asked %d time(s)", n)
	}
}

// step 3, the Durgesh case: 9070 is missing from Windows' listener list altogether, but tally.ini names it: it is
// probed and used
func TestR253StepIniPortMissingFromScan(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	// other users' Tallys on other ports; the own Tally's port is not in the list
	r253Server(t, `{"pid": 20, "name": "tally", "session": 2}`, `{"port": 1318, "pid": 20}`, mine.port)
	ss := openCompanies(true)
	e := r253Entry(t, ss, mine.port)
	if e["ok"] != true || e["skipped"] == true {
		t.Fatalf("tally.ini's port not used: %v", e)
	}
	if o := r253Entry(t, ss, 1318); o["skipped"] != true || str(o["reason"]) != "another user" {
		t.Fatalf("another user's Tally: %v", o)
	}
}

// step 3: the settings' port and the default 9000 are always in the plan
func TestR253StepDefaultAndSettingsPorts(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, ``, ``)
	_, plan := portPlan()
	has := func(p int) bool {
		for _, x := range plan {
			if toInt(x["port"]) == p {
				return true
			}
		}
		return false
	}
	if !has(9000) {
		t.Fatalf("9000 not tried: %s", jsonText(plan))
	}
	setCfg("TallyPorts", []any{float64(mine.port)})
	_, plan = portPlan()
	if !has(mine.port) || !has(9000) {
		t.Fatalf("settings' port or 9000 not tried: %s", jsonText(plan))
	}
}

// step 4: any port of a TallyPrime program not positively another user's (an odd port, the owner unknown) is tried
func TestR253StepAnyTallyListener(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "TallyPrime", "sessionUnknown": true}, {"pid": 20, "name": "tally", "session": 2}`,
		fmt.Sprintf(`{"port": %d, "pid": 10}, {"port": 9898, "pid": 20}`, mine.port))
	ss := openCompanies(true)
	if e := r253Entry(t, ss, mine.port); e["ok"] != true {
		t.Fatalf("TallyPrime listener not used: %v", e)
	}
	if e := r253Entry(t, ss, 9898); e["skipped"] != true {
		t.Fatalf("positively another user's Tally not skipped: %v", e)
	}
}

// a Tally positively in another signed-in user's session is still never asked
func TestR253OtherUserNeverAsked(t *testing.T) {
	theirs := newStandTally(t)
	standBridge(t, theirs, "")
	r253Server(t, `{"pid": 20, "name": "tally", "session": 2}`, fmt.Sprintf(`{"port": %d, "pid": 20}`, theirs.port), theirs.port)
	e := r253Entry(t, openCompanies(true), theirs.port)
	if e["skipped"] != true || str(e["reason"]) != "another user" || str(e["error"]) != "Tally of hemant" {
		t.Fatalf("another user's Tally: %v", e)
	}
	if n := len(theirs.ids()); n != 0 {
		t.Fatalf("another user's Tally asked %d time(s)", n)
	}
}

// the Durgesh beat: the list held from an earlier ask names an old port (1817, closed now); the own Tally opened since
// on 9070 must reach the beat without waiting for an event, and the beat's state follows it
func TestR253BeatFollowsWindowsNotTheOldList(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	_ = saveFile(filepath.Join(syncDir(), "open-companies.json"), jsonText([]M{{"port": 1817, "ok": true, "companies": []any{M{"name": "ZZ TEST"}}, "error": "", "mine": true, "skipped": false}}))
	ss := openCompaniesCached()
	for _, s := range ss {
		if toInt(s["port"]) == 1817 {
			t.Fatalf("a port Windows no longer shows stays in the beat: %s", jsonText(ss))
		}
	}
	e := r253Entry(t, ss, mine.port)
	if e["ok"] != true || len(sessCompanies(e)) == 0 {
		t.Fatalf("own Tally not in the beat: %s", jsonText(ss))
	}
	if st, _ := tallyOverall(ss); st != "open" {
		t.Fatalf("beat state %s", st)
	}
}

// the beat's tallyWhy when nothing answers
func TestR253BeatWhy(t *testing.T) {
	cases := []struct {
		ports []any
		want  string
	}{
		{[]any{}, "no Tally running in this login"},
		{[]any{M{"port": 9000, "reason": "closed"}}, "no Tally running in this login"},
		{[]any{M{"port": 9000, "reason": "another user", "skipped": true}}, "another user"},
		{[]any{M{"port": 9070, "reason": "not answering"}, M{"port": 9000, "reason": "another user", "skipped": true}}, "not answering"},
		{[]any{M{"port": 9070, "reason": "owner unknown"}}, "owner unknown"},
		{[]any{M{"port": 9070, "reason": "another bridge", "skipped": true}}, "owner unknown"},
		{[]any{M{"port": 9070, "reason": "open", "ok": true}}, ""},
	}
	for i, c := range cases {
		if got := tallyWhy(c.ports); got != c.want {
			t.Fatalf("case %d: %q, want %q", i, got, c.want)
		}
	}
}

// the ports this bridge uses are told on /ping, for the other users' bridges on the computer
func TestR253ClaimedPorts(t *testing.T) {
	mine := newStandTally(t)
	standBridge(t, mine, "")
	r253Server(t, `{"pid": 10, "name": "tally", "sessionUnknown": true}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, mine.port))
	openCompanies(true)
	own, unknown := claimedPorts()
	if len(own) != 0 || len(unknown) != 1 || unknown[0] != mine.port {
		t.Fatalf("claims: own %v unknown %v", own, unknown)
	}
	// a claim's decision: an own Tally's claim always wins; of two owner-unknown claims, the lower bridge port's
	if !claimWins(bridgeClaim{port: 9105, unknown: false}, 9101) || !claimWins(bridgeClaim{port: 9101, unknown: true}, 9105) || claimWins(bridgeClaim{port: 9105, unknown: true}, 9101) {
		t.Fatal("claim decisions")
	}
}

// one FinCom login on a shared server: /ping says whether the asking browser runs in this bridge's owner's Windows
// session (sameSession true / false / "unknown") and the bridge's own port; /status says it too
func TestR253SameSession(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"same-session-key","Port":9103`)
	r253Server(t, `{"pid": 10, "name": "tally", "session": 1}`, fmt.Sprintf(`{"port": %d, "pid": 10}`, f.port))
	oldS := peerSessionOf
	t.Cleanup(func() { peerSessionOf = oldS })
	var asked [2]int
	ping := func() M {
		r := httptest.NewRequest("GET", "http://127.0.0.1:9103/ping", nil)
		r.RemoteAddr = "127.0.0.1:50999"
		w := httptest.NewRecorder()
		handle(w, r)
		return parseObj(w.Body.String())
	}
	for _, c := range []struct {
		sess  int
		known bool
		want  any
	}{{1, true, true}, {2, true, false}, {0, true, false}, {0, false, "unknown"}} {
		peerSessionOf = func(local, remote int) (int, bool) { asked = [2]int{local, remote}; return c.sess, c.known }
		res := ping()
		if res["sameSession"] != c.want || toInt(res["bridgePort"]) != 9103 {
			t.Fatalf("session %d known %v: %v", c.sess, c.known, res)
		}
	}
	if asked[1] != 50999 {
		t.Fatalf("the browser's port: %v", asked)
	}
	// /status (the owner's own programs) carries it too
	peerSessionOf = func(int, int) (int, bool) { return 1, true }
	r := httptest.NewRequest("GET", "http://127.0.0.1:9103/status", nil)
	r.RemoteAddr = "127.0.0.1:50998"
	r.Header.Set("X-Bridge-Key", "same-session-key")
	w := httptest.NewRecorder()
	handle(w, r)
	if res := parseObj(w.Body.String()); res["sameSession"] != true {
		t.Fatalf("/status: %d %v", w.Code, res)
	}
}
