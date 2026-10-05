//go:build windows

package main

import (
	"net"
	"strconv"
	"testing"

	"golang.org/x/sys/windows"
)

// 2.3.0, on real Windows (the CI's Windows job runs tests named Windows*): a connection from this test to a listener of
// its own is found in the TCP table, and its process's user is this test's own user, so it is let through
func TestWindowsPeerUserIsOwn(t *testing.T) {
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
	sid, checked, err := platPeerUser(server, client)
	if err != nil || !checked {
		t.Fatalf("peer user: %q %v %v", sid, checked, err)
	}
	me, _ := windows.GetCurrentProcessToken().GetTokenUser()
	if sid != me.User.Sid.String() {
		t.Fatalf("peer %s, own %s", sid, me.User.Sid.String())
	}
	if ok, why := ownUserDecision(checked, sid, err, platOwnSIDs()); !ok {
		t.Fatalf("own connection refused: %s", why)
	}
	// a port nobody holds: not let through
	if _, _, err := platPeerUser(server, 1); err == nil {
		t.Fatal("a connection that does not exist was found")
	}
}
