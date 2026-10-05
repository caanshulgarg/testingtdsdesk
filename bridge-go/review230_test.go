// Review of per-user-bridge (3d10b61): M1, the bridge proves itself to FinCom (/ping?n=<nonce> answers HMAC(key, nonce)
// to its own Windows user only, and HMAC(pairing code, nonce) while the pairing window is open) and never trusts another
// listener's word (a taken port is this user's own bridge only when Windows says the listening process is this user's);
// L2, "Changes only" is kept in the bridge's settings, so a restart or a cloud outage never opens local posting again.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

func hmacOf(key, msg string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

func TestPingProof(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"proof-key-123456"`)
	oldP, oldO := peerUserOf, ownSIDsOf
	defer func() { peerUserOf, ownSIDsOf = oldP, oldO }()
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	who := sidAnshul
	peerUserOf = func(local, remote int) (string, bool, error) { return who, true, nil }
	ping := func(q string) M {
		r := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping"+q, nil)
		r.RemoteAddr = "127.0.0.1:50999"
		w := httptest.NewRecorder()
		handle(w, r)
		return parseObj(w.Body.String())
	}
	n := "nonce0123456789abcdefXYZ"
	openPairWindow(15)
	pairMu.Lock()
	code := pairCode
	pairMu.Unlock()
	o := ping("?n=" + n)
	if str(o["proof"]) != hmacOf("proof-key-123456", n) || str(o["pairProof"]) != hmacOf(code, n) {
		t.Fatalf("own user: proof %v pairProof %v", o["proof"], o["pairProof"])
	}
	if o := ping("?n=short"); o["proof"] != nil {
		t.Fatalf("a nonce too short is not answered: %v", o["proof"])
	}
	who = sidRavi
	if o := ping("?n=" + n); o["proof"] != nil || o["pairProof"] != nil || o["yours"] != false {
		t.Fatalf("another user gets no proof: %v", o)
	}
	who = sidAnshul
	pairMu.Lock()
	pairUntil = time.Now().Add(-time.Minute)
	pairMu.Unlock()
	if o := ping("?n=" + n); o["pairProof"] != nil || str(o["proof"]) == "" {
		t.Fatalf("pairing window closed: no pairProof (%v)", o)
	}
}

// a listener of another Windows user on 9100 that says it is "yours": the bridge takes the next free port and does not stop
func TestOwnBridgeOnForeignListener(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	oldL, oldO := listenerUserOf, ownSIDsOf
	defer func() { listenerUserOf, ownSIDsOf = oldL, oldO }()
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	// a rogue answering /ping {yours: true} on a real port: Windows says its process is ravi's
	rogue := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"impl":"go","yours":true,"bridgeId":"go-aaaa000001","version":"2.3.0"}`))
	}))
	defer rogue.Close()
	_, ps, _ := net.SplitHostPort(strings.TrimPrefix(rogue.URL, "http://"))
	var rp int
	fmt.Sscan(ps, &rp)
	listenerUserOf = func(p int) (string, bool, error) { return sidRavi, true, nil }
	if ownBridgeOn(rp) {
		t.Fatal("another user's listener saying 'yours' was taken for this user's own bridge")
	}
	ln, port, err := bindBridgePort(rp, func(p int) (net.Listener, error) {
		if p == rp {
			return nil, &net.OpError{Op: "listen", Net: "tcp", Err: os.NewSyscallError("bind", syscall.EADDRINUSE)}
		}
		return net.Listen("tcp", "127.0.0.1:0")
	}, ownBridgeOn)
	if err != nil || port != 9100 {
		t.Fatalf("a foreign listener on the remembered port: port %d, %v (want the next free port, no stop)", port, err)
	}
	ln.Close()
	// the same listener, Windows saying it is this user's process: this user's own bridge runs there
	listenerUserOf = func(p int) (string, bool, error) { return sidAnshul, true, nil }
	if !ownBridgeOn(rp) {
		t.Fatal("this user's own bridge (Windows says so, and it answers as a FinCom Bridge) was not recognised")
	}
	// not Windows / Windows cannot tell: never taken as this user's
	listenerUserOf = func(p int) (string, bool, error) { return "", false, nil }
	if ownBridgeOn(rp) {
		t.Fatal("unchecked: taken as own")
	}
}

func TestListenerPidFromTable(t *testing.T) {
	be := func(p int) uint32 { return uint32((p&0xff)<<8 | (p>>8)&0xff) }
	lo := uint32(0x0100007f)
	rows := []tcpRow{
		{State: 5, LocalAddr: lo, LocalPort: be(9100), RemoteAddr: lo, RemotePort: be(50001), Pid: 11}, // a connection, not the listener
		{State: 2, LocalAddr: lo, LocalPort: be(9101), Pid: 22},
		{State: 2, LocalAddr: 0, LocalPort: be(9100), Pid: 33}, // 0.0.0.0:9100 listening
	}
	if p := listenerPidFrom(rows, 9100); p != 33 {
		t.Fatalf("listener of 9100: %d", p)
	}
	if p := listenerPidFrom(rows, 9102); p != 0 {
		t.Fatalf("nothing on 9102: %d", p)
	}
}

// L2: FinCom's "Changes only" is kept in the settings: after a restart with FinCom's cloud out of reach, the bridge still
// refuses local posting; FinCom's answer without it clears it
func TestChangesOnlyKeptInSettings(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	c.mu.Lock()
	c.beatReply = M{"notMain": true, "changesOnly": true, "error": "This bridge is set to changes only in FinCom (Tally page): it reads Tally's changes and never posts."}
	c.mu.Unlock()
	beatOnce()
	if !strings.Contains(readText(ConfigPath), `"ChangesOnly":true`) && !strings.Contains(readText(ConfigPath), `"ChangesOnly": true`) {
		t.Fatalf("not kept in the settings: %s", readText(ConfigPath))
	}
	// the bridge started again, FinCom's cloud out of reach: still changes only
	c.srv.Close()
	clearNotMainForTest()
	loadConfig()
	if w := readOnlyWhy(); !strings.Contains(w, "changes only") {
		t.Fatalf("after a restart: %q", w)
	}
	if err := postingAllowedFor(zz); err == nil || !strings.Contains(err.Error(), "changes only") {
		t.Fatalf("local posting not refused: %v", err)
	}
	// FinCom answers without it: posting again
	c2 := newStandCloud(t)
	setCfg("CloudUrl", c2.srv.URL+"/")
	beatOnce()
	if w := readOnlyWhy(); w != "" {
		t.Fatalf("switched off in FinCom: still %q", w)
	}
	if strings.Contains(readText(ConfigPath), `"ChangesOnly":true`) {
		t.Fatal("still kept in the settings")
	}
}

func clearNotMainForTest() {
	notMainMu.Lock()
	notMainAt, notMainBeat, notMainTold = time.Time{}, false, false
	notMainMu.Unlock()
}
