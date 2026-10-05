// 2.3.0: one bridge for each Windows user on a shared server: the first free port of 9100..9119, remembered; when none
// is free, one plain message and the bridge stops (no endless retry).
package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"syscall"
	"testing"
)

// a stand-in for net.Listen: the ports in busy answer "address in use", those in odd another reason; the rest bind
func fakeListen(busy map[int]bool, odd map[int]error, tried *[]int) func(int) (net.Listener, error) {
	return func(p int) (net.Listener, error) {
		*tried = append(*tried, p)
		if busy[p] {
			return nil, &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", syscall.EADDRINUSE)}
		}
		if e := odd[p]; e != nil {
			return nil, &net.OpError{Op: "listen", Net: "tcp", Err: e}
		}
		return net.Listen("tcp", "127.0.0.1:0")
	}
}

func TestBridgePortFirstFree(t *testing.T) {
	var tried []int
	// the second user on the server: 9100 is the first user's bridge
	ln, port, err := bindBridgePort(9100, fakeListen(map[int]bool{9100: true}, nil, &tried), func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	ln.Close()
	if port != 9101 || fmt.Sprint(tried) != "[9100 9101]" {
		t.Fatalf("port %d, tried %v", port, tried)
	}
	// remembered 9105: tried first, and kept while it is free
	tried = nil
	ln, port, _ = bindBridgePort(9105, fakeListen(nil, nil, &tried), func(int) bool { return false })
	ln.Close()
	if port != 9105 || fmt.Sprint(tried) != "[9105]" {
		t.Fatalf("remembered: port %d, tried %v", port, tried)
	}
	// remembered 9105 taken by another user's bridge since: the first free of the range from 9100
	tried = nil
	ln, port, _ = bindBridgePort(9105, fakeListen(map[int]bool{9105: true, 9100: true}, nil, &tried), func(int) bool { return false })
	ln.Close()
	if port != 9101 || fmt.Sprint(tried) != "[9105 9100 9101]" {
		t.Fatalf("remembered taken: port %d, tried %v", port, tried)
	}
	// a port of 0 or none: from 9100
	tried = nil
	ln, port, _ = bindBridgePort(0, fakeListen(nil, nil, &tried), func(int) bool { return false })
	ln.Close()
	if port != 9100 {
		t.Fatalf("no port remembered: %d", port)
	}
}

func TestBridgePortAllTakenGivesUp(t *testing.T) {
	busy := map[int]bool{}
	for p := 9100; p <= 9119; p++ {
		busy[p] = true
	}
	var tried []int
	ln, _, err := bindBridgePort(9100, fakeListen(busy, nil, &tried), func(int) bool { return false })
	if ln != nil || err == nil {
		t.Fatal("bound with every port taken")
	}
	want := "FinCom Bridge could not start: ports 9100–9119 are all in use on " + computerName()
	if err.Error() != want {
		t.Fatalf("message:\n got %q\nwant %q", err.Error(), want)
	}
	if len(tried) != 20 {
		t.Fatalf("each port once, then stop (no retry): %v", tried)
	}
}

func TestBridgePortWindowsReason(t *testing.T) {
	odd := map[int]error{}
	for p := 9100; p <= 9119; p++ {
		odd[p] = errors.New("An attempt was made to access a socket in a way forbidden by its access permissions.")
	}
	var tried []int
	_, _, err := bindBridgePort(9100, fakeListen(nil, odd, &tried), func(int) bool { return false })
	if err == nil || !strings.HasPrefix(err.Error(), "FinCom Bridge could not start on "+computerName()+": ") || !strings.Contains(err.Error(), "forbidden by its access permissions") {
		t.Fatalf("the Windows reason: %v", err)
	}
	// one port refused for a reason, the next free: that one is taken
	tried = nil
	ln, port, err := bindBridgePort(9100, fakeListen(nil, map[int]error{9100: errors.New("forbidden")}, &tried), func(int) bool { return false })
	if err != nil || port != 9101 {
		t.Fatalf("next port after a refusal: %d %v", port, err)
	}
	ln.Close()
}

// this Windows user's own bridge already answers on a port: this one does not start beside it (one bridge per user)
func TestBridgePortOwnBridgeAlreadyRuns(t *testing.T) {
	var tried []int
	_, _, err := bindBridgePort(9100, fakeListen(map[int]bool{9100: true, 9101: true}, nil, &tried), func(p int) bool { return p == 9101 })
	if err == nil || err.Error() != "FinCom Bridge could not start: your own FinCom Bridge already runs on port 9101 on "+computerName() {
		t.Fatalf("own bridge: %v", err)
	}
}

// runBridge gives up once: the message in the log and in the file the tray shows, the exit code that is not restarted,
// and the port it took remembered in the settings
func TestRunBridgeNoPortStops(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	old := listenLocal
	defer func() { listenLocal = old }()
	listenLocal = func(p int) (net.Listener, error) {
		return nil, &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", syscall.EADDRINUSE)}
	}
	ownBridgeOnTest = func(int) bool { return false }
	defer func() { ownBridgeOnTest = nil }()
	if code := runBridge(false); code != exitNoPort {
		t.Fatalf("exit code %d, want %d", code, exitNoPort)
	}
	msg := readText(startFailedFile())
	if !strings.Contains(msg, "ports 9100–9119 are all in use on") {
		t.Fatalf("the tray's message: %q", msg)
	}
	if n := strings.Count(readText(logFile()), "could not start"); n != 1 {
		t.Fatalf("one message in the log, got %d:\n%s", n, readText(logFile()))
	}
	if strings.Contains(readText(logFile()), "trying again") {
		t.Fatal("no endless retry")
	}
	if restartAfter(exitNoPort) {
		t.Fatal("the supervisor must not start a bridge again that found no port")
	}
}

func TestBridgePortRemembered(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	setCfg("Port", float64(9100))
	ln, err := bindAndRemember(func(p int) (net.Listener, error) {
		if p == 9100 {
			return nil, &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", syscall.EADDRINUSE)}
		}
		return net.Listen("tcp", "127.0.0.1:0")
	}, func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	ln.Close()
	if toInt(cfg("Port")) != 9101 || !strings.Contains(readText(ConfigPath), "9101") {
		t.Fatalf("not remembered: %v %s", cfg("Port"), readText(ConfigPath))
	}
}

// the setup keeps a port of the range the user's bridge took before; anything else becomes the default
func TestInstallPortKept(t *testing.T) {
	for _, c := range []struct{ had, def, want int }{{9103, 9100, 9103}, {0, 9100, 9100}, {9200, 9100, 9100}, {9119, 9101, 9119}, {8080, 9101, 9101}} {
		o := newOrdered()
		if c.had != 0 {
			o.Set("Port", float64(c.had))
		}
		installPort(o, c.def)
		if toInt(o.Get("Port")) != c.want {
			t.Fatalf("had %d: got %v want %d", c.had, o.Get("Port"), c.want)
		}
	}
}
