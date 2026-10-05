// 2.3.0: the bridge's local web server answers only programs of its own Windows user. On a shared Windows server every
// signed-in user can reach 127.0.0.1:9100..9119, so without this another user's browser (or any program of theirs)
// could ask this user's bridge for this user's Tally. On Windows the other end of each connection is looked up (the TCP
// table gives the process, its token the Windows user, win_peer.go); anything not of this bridge's own user gets 403
// "not your FinCom Bridge". /ping still answers everyone (it says nothing of the books and needs no key) and says whether
// the bridge is the asker's own ("yours"), so FinCom finds its own bridge among several on the server.
package main

import (
	"net"
	"net/http"
	"strconv"
	"strings"
)

const notYours = "not your FinCom Bridge"

// one row of Windows' TCP table (MIB_TCPROW_OWNER_PID): addresses as Windows gives them, ports in network byte order
type tcpRow struct {
	State, LocalAddr, LocalPort, RemoteAddr, RemotePort, Pid uint32
}

func netPort(v uint32) int { return int((v&0xff)<<8 | (v>>8)&0xff) }

// the process at the other end of a connection to this bridge: the row whose local end is the client's port on
// 127.0.0.1 and whose remote end is the bridge's port; 0 when there is none
func peerPidFrom(rows []tcpRow, serverPort, clientPort int) int {
	const loopback = 0x0100007f
	for _, r := range rows {
		if r.LocalAddr == loopback && netPort(r.LocalPort) == clientPort && netPort(r.RemotePort) == serverPort {
			return int(r.Pid)
		}
	}
	return 0
}

// the decision: checked false (not Windows) passes; else the asking program's user must be one of this bridge's own
// (the user it runs as, and the owner it works for when it runs as the service)
func ownUserDecision(checked bool, peer string, err error, own []string) (bool, string) {
	if !checked {
		return true, ""
	}
	if err != nil {
		return false, notYours + " (the program asking could not be told: " + err.Error() + ")"
	}
	if peer == "" {
		return false, notYours + " (the program asking has no Windows user)"
	}
	for _, s := range own {
		if s != "" && strings.EqualFold(s, peer) {
			return true, ""
		}
	}
	return false, notYours
}

// the Windows user of the program at the other end (platform; a stand-in in the tests)
var peerUserOf = platPeerUser

// this bridge's own Windows users (platform; a stand-in in the tests)
var ownSIDsOf = platOwnSIDs

// the ports of a request's connection: the bridge's (local) and the client's (remote)
func connPorts(r *http.Request) (local, remote int) {
	if a, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		if _, p, err := net.SplitHostPort(a.String()); err == nil {
			local, _ = strconv.Atoi(p)
		}
	}
	if local == 0 {
		local = toInt(cfg("Port"))
	}
	if _, p, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		remote, _ = strconv.Atoi(p)
	}
	return local, remote
}

// whether the request comes from a program of this bridge's own Windows user, and why not
func fromOwnUser(r *http.Request) (bool, string) {
	local, remote := connPorts(r)
	peer, checked, err := peerUserOf(local, remote)
	return ownUserDecision(checked, peer, err, ownSIDsOf())
}
