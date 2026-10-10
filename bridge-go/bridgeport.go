// 2.3.0: one FinCom Bridge for each Windows user on a shared Windows server (several users' Tally, each in its own Windows
// session). Each user's bridge listens on its own local port: the first free one of 9100..9199, remembered in that user's
// settings ("Port") and tried first at the next start. FinCom finds its bridge by asking 9100..9199 (/ping says whether
// the bridge there is the asking Windows user's own). When no port of the range is free, or Windows refuses for another
// reason, the bridge says so once (log and tray) and stops: no endless retry, and the supervisor does not start it again.
package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const (
	bridgePortFirst = 9100
	bridgePortLast  = 9199
	// the bridge stopped because it found no port: the per-user supervisor and the service do not start it again
	exitNoPort = 4
)

// restartAfter: whether the supervisor starts the bridge again after it ended with this code
func restartAfter(code int) bool { return code != exitNoPort && code != exitTwice }

// the ports tried, in order: the remembered one first (when it is a port), then 9100..9199
func bridgePortOrder(remembered int) []int {
	var l []int
	if remembered > 0 && remembered <= 65535 {
		l = append(l, remembered)
	}
	for p := bridgePortFirst; p <= bridgePortLast; p++ {
		if p != remembered {
			l = append(l, p)
		}
	}
	return l
}

// bindBridgePort binds the first port that is free. listen binds one port; mine says whether a port that is taken
// answers as this Windows user's own FinCom Bridge (then this one does not start beside it: one bridge per user).
func bindBridgePort(remembered int, listen func(int) (net.Listener, error), mine func(int) bool) (net.Listener, int, error) {
	var reason error
	for _, p := range bridgePortOrder(remembered) {
		ln, err := listen(p)
		if err == nil {
			return ln, p, nil
		}
		if addrInUse(err) {
			if mine != nil && mine(p) {
				return nil, 0, fmt.Errorf("FinCom Bridge could not start: your own FinCom Bridge already runs on port %d on %s", p, computerName())
			}
			continue
		}
		if reason == nil {
			reason = err
		}
	}
	if reason != nil {
		return nil, 0, fmt.Errorf("FinCom Bridge could not start on %s: %s", computerName(), bindReason(reason))
	}
	return nil, 0, fmt.Errorf("FinCom Bridge could not start: ports %d–%d are all in use on %s", bridgePortFirst, bridgePortLast, computerName())
}

// the port is taken (Linux: EADDRINUSE; Windows: WSAEADDRINUSE, 10048)
func addrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, syscall.Errno(10048))
}

// Windows' own words for a refused bind, without Go's "listen tcp 127.0.0.1:9100: bind: " in front
func bindReason(err error) string {
	var se *os.SyscallError
	if errors.As(err, &se) {
		return se.Err.Error()
	}
	var oe *net.OpError
	if errors.As(err, &oe) && oe.Err != nil {
		return oe.Err.Error()
	}
	return err.Error()
}

// the real bind: this computer only
var listenLocal = func(p int) (net.Listener, error) { return net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p)) }

// a taken port is this Windows user's own FinCom Bridge: Windows says the process listening there is this user's (its
// token's SID, from the TCP table's LISTEN row; review M1: never the listener's own word, which another user's program
// could fake), and it answers as a FinCom Bridge. Not Windows, or Windows cannot tell: not this user's
var ownBridgeOnTest func(int) bool

func ownBridgeOn(p int) bool {
	if ownBridgeOnTest != nil {
		return ownBridgeOnTest(p)
	}
	sid, checked, err := listenerUserOf(p)
	if !checked || err != nil {
		return false
	}
	if ok, _ := ownUserDecision(true, sid, nil, ownSIDsOf()); !ok {
		return false
	}
	o := pingLocal(p, 2*time.Second)
	return o != nil && str(o["impl"]) == "go"
}

// bindAndRemember: the port bound is kept in this user's settings, so the next start (and the tray, the supervisor and
// the setup, which read the settings) use the same one
func bindAndRemember(listen func(int) (net.Listener, error), mine func(int) bool) (net.Listener, error) {
	ln, p, err := bindBridgePort(toInt(cfg("Port")), listen, mine)
	if err != nil {
		return nil, err
	}
	if toInt(cfg("Port")) != p {
		writeLog(fmt.Sprintf("Port %d is taken (another Windows user's FinCom Bridge, or another program); this bridge uses port %d and remembers it", toInt(cfg("Port")), p))
		setCfg("Port", float64(p))
		saveConfig()
	}
	return ln, nil
}

// the message the tray shows when the bridge could not start (kept beside the settings; gone at the next good start)
func startFailedFile() string {
	return filepath.Join(filepath.Dir(ConfigPath), "bridge-start-failed.txt")
}
func startFailedText() string {
	if exists(startFailedFile()) {
		return readText(startFailedFile())
	}
	return ""
}

// the setup: a port of 9100..9199 this user's bridge took before is kept; anything else becomes def
func installPort(c *Ordered, def int) {
	if p := toInt(c.Get("Port")); p >= bridgePortFirst && p <= bridgePortLast {
		return
	}
	c.Set("Port", float64(def))
}

// the port a settings file names (9100 when none)
func settingsPort(cfgPath string) int {
	c := newOrdered()
	if c.UnmarshalText(readText(cfgPath)) == nil {
		if p := toInt(c.Get("Port")); p > 0 && p <= 65535 {
			return p
		}
	}
	return bridgePortFirst
}
