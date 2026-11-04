//go:build windows

package main

import (
	"net"
	"strconv"
	"testing"

	"golang.org/x/sys/windows"
)

// 2.5.3, on real Windows (the CI's Windows job runs tests named Windows*): a connection from this test to a listener of
// its own is found in the TCP table, and its process's session is this test's own session (sameSession's source); a
// connection that does not exist gives no session ("unknown"); the Remote Desktop service names this process's session
// too (the fallback when ProcessIdToSessionId is refused); every Tally process the bridge lists says whether its session
// is known
func TestWindowsR253PeerSession(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		if c, err := ln.Accept(); err == nil {
			defer c.Close()
			b := make([]byte, 1)
			_, _ = c.Read(b)
		}
	}()
	c, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_, sp, _ := net.SplitHostPort(ln.Addr().String())
	_, cp, _ := net.SplitHostPort(c.LocalAddr().String())
	server, _ := strconv.Atoi(sp)
	client, _ := strconv.Atoi(cp)
	var own uint32
	if err := windows.ProcessIdToSessionId(windows.GetCurrentProcessId(), &own); err != nil {
		t.Fatal(err)
	}
	s, known := platPeerSession(server, client)
	if !known || s != int(own) {
		t.Fatalf("peer session %d known %v, own %d", s, known, own)
	}
	if _, known := platPeerSession(server, 1); known {
		t.Fatal("a connection that does not exist has a session")
	}
	ps, ok := processes()
	if !ok || len(ps) == 0 {
		t.Fatal("no process list")
	}
	for _, p := range ps {
		if p.ID == int(windows.GetCurrentProcessId()) && (p.SessionUnknown || p.Session != int(own)) {
			t.Fatalf("this process in the list: %+v", p)
		}
	}
	ws := wtsProcessSessionsNow()
	if ws == nil {
		t.Skip("the Remote Desktop service lists no processes on this runner")
	}
	if got, ok := ws[windows.GetCurrentProcessId()]; !ok || got.session != own {
		t.Fatalf("the Remote Desktop service: this process's session %d (listed %v), own %d", got.session, ok, own)
	}
	// 2.5.4: the service also gives the process's user, the same as its own token's
	if u, err := windows.GetCurrentProcessToken().GetTokenUser(); err == nil {
		if got := ws[windows.GetCurrentProcessId()].sid; got != "" && got != u.User.Sid.String() {
			t.Fatalf("the Remote Desktop service: this process's user %s, its token's %s", got, u.User.Sid.String())
		}
	}
}
