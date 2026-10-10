// 2.3.0: the bridge's local web server answers only programs of its own Windows user (another user's browser on the same
// shared server gets 403 "not your FinCom Bridge"). The decision is tested here; Windows' part (which process holds the
// other end of the connection, and its user) is a stand-in in these tests and tested for real in ownuser_windows_test.go.
package main

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	sidAnshul      = "S-1-5-21-1111-2222-3333-1001"
	sidRavi        = "S-1-5-21-1111-2222-3333-1002"
	sidLocalSystem = "S-1-5-18"
)

func TestOwnUserDecision(t *testing.T) {
	own := []string{sidLocalSystem, sidAnshul} // the service runs as SYSTEM and works for anshul
	cases := []struct {
		name    string
		checked bool
		peer    string
		err     error
		ok      bool
	}{
		{"not Windows: nothing to check", false, "", nil, true},
		{"the owner's browser", true, sidAnshul, nil, true},
		{"the owner's browser, other case", true, strings.ToLower(sidAnshul), nil, true},
		{"the service's own user", true, sidLocalSystem, nil, true},
		{"another user's browser on the same server", true, sidRavi, nil, false},
		{"the asking program not found", true, "", errors.New("no such connection"), false},
		{"no user found", true, "", nil, false},
	}
	for _, c := range cases {
		ok, why := ownUserDecision(c.checked, c.peer, c.err, own)
		if ok != c.ok {
			t.Fatalf("%s: got %v (%s)", c.name, ok, why)
		}
		if !ok && !strings.Contains(why, "not your FinCom Bridge") {
			t.Fatalf("%s: the words: %q", c.name, why)
		}
	}
	// no own user known (cannot happen on Windows): nobody but an unchecked caller passes
	if ok, _ := ownUserDecision(true, sidAnshul, nil, nil); ok {
		t.Fatal("passed with no own user known")
	}
}

// the TCP table (GetExtendedTcpTable's rows, ports in network byte order): the process at the other end of a connection
func TestPeerPidFromTable(t *testing.T) {
	be := func(p int) uint32 { return uint32((p&0xff)<<8 | (p>>8)&0xff) }
	lo := uint32(0x0100007f) // 127.0.0.1 as Windows gives it
	rows := []tcpRow{
		{State: 2, LocalAddr: lo, LocalPort: be(9100), RemoteAddr: 0, RemotePort: 0, Pid: 500},                // the bridge listening
		{State: 5, LocalAddr: lo, LocalPort: be(9100), RemoteAddr: lo, RemotePort: be(50001), Pid: 500},       // its side
		{State: 5, LocalAddr: lo, LocalPort: be(50001), RemoteAddr: lo, RemotePort: be(9100), Pid: 777},       // the browser
		{State: 5, LocalAddr: lo, LocalPort: be(50002), RemoteAddr: lo, RemotePort: be(9101), Pid: 888},       // another bridge's client
		{State: 5, LocalAddr: 0x0200000a, LocalPort: be(50001), RemoteAddr: lo, RemotePort: be(9100), Pid: 9}, // not 127.0.0.1
	}
	if p := peerPidFrom(rows, 9100, 50001); p != 777 {
		t.Fatalf("pid %d", p)
	}
	if p := peerPidFrom(rows, 9100, 50002); p != 0 {
		t.Fatalf("a connection to another port: %d", p)
	}
}

// through the web server: another Windows user's program gets 403 for every address; /ping answers all, saying whose
func TestOwnUserOnlyThroughServer(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"own-user-key"`)
	oldP, oldO := peerUserOf, ownSIDsOf
	defer func() { peerUserOf, ownSIDsOf = oldP, oldO }()
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	who := sidRavi
	var asked [][2]int
	peerUserOf = func(local, remote int) (string, bool, error) {
		asked = append(asked, [2]int{local, remote})
		return who, true, nil
	}
	call := func(path string) (int, M) {
		r := httptest.NewRequest("GET", "http://127.0.0.1:9100"+path, nil)
		r.RemoteAddr = "127.0.0.1:50123"
		r.Header.Set("X-Bridge-Key", "own-user-key")
		r.Header.Set("Origin", "https://app.fincom.live")
		w := httptest.NewRecorder()
		handle(w, r)
		return w.Code, parseObj(w.Body.String())
	}
	for _, p := range []string{"/status", "/pair?code=123456", "/cloudlink", "/tray/status", "/diagnose"} {
		code, res := call(p)
		if code != 403 || str(res["error"]) != "not your FinCom Bridge" {
			t.Fatalf("%s from another user: %d %v", p, code, res)
		}
	}
	if len(asked) == 0 || asked[0][1] != 50123 {
		t.Fatalf("the client's port: %v", asked)
	}
	code, res := call("/ping")
	if code != 200 || res["yours"] != false || res["bridgeId"] != nil {
		t.Fatalf("/ping from another user: %d %v", code, res)
	}
	who = sidAnshul
	code, res = call("/ping")
	if code != 200 || res["yours"] != true || str(res["bridgeId"]) == "" {
		t.Fatalf("/ping from the owner: %d %v", code, res)
	}
	if code, res = call("/status"); code != 200 {
		t.Fatalf("/status from the owner: %d %v", code, res)
	}
}
