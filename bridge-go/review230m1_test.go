package main

// Review of bridge 2.3.0 (97764f7), M1: DNS rebinding and an unbound pairProof. A web page of any name that resolves to
// 127.0.0.1 is "same origin" with the bridge, and a browser sends no Origin on its same-origin GET, which the bridge took
// as a program of this computer: such a page could read /ping's proof and, while the pairing window is open (15 minutes
// after every start), the pairProof. Now:
//   - every request whose Host is not exactly 127.0.0.1:<port> or localhost:<port> (the bridge's own port) is refused;
//   - /ping gives proof and pairProof only to an allowed, non-empty Origin (FinCom's pages) or to the tray (a program of
//     this computer that holds the bridge key and sends it as X-Bridge-Key, as every tray request does);
//   - pairProof is bound to the bridge's id and port as the key's proof is: HMAC-SHA256(code, nonce || bridge id || port).

import (
	"fmt"
	"net/http/httptest"
	"testing"
)

func m1Req(t *testing.T, host, path string, hdr map[string]string) (int, M) {
	t.Helper()
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100"+path, nil)
	r.Host = host
	r.RemoteAddr = "127.0.0.1:50999"
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	handle(w, r)
	return w.Code, parseObj(w.Body.String())
}

func m1Setup(t *testing.T) {
	standBridge(t, newStandTally(t), `,"Key":"proof-key-123456"`)
	oldP, oldO := peerUserOf, ownSIDsOf
	t.Cleanup(func() { peerUserOf, ownSIDsOf = oldP, oldO })
	ownSIDsOf = func() []string { return []string{sidAnshul} }
	peerUserOf = func(local, remote int) (string, bool, error) { return sidAnshul, true, nil }
}

func TestM1ForeignHostRefused(t *testing.T) {
	m1Setup(t)
	port := toInt(cfg("Port"))
	for _, h := range []string{"evil.example:" + fmt.Sprint(port), "evil.example", "127.0.0.1", "127.0.0.1:" + fmt.Sprint(port+1), "localhost.evil.example:" + fmt.Sprint(port),
		"127.0.0.2:" + fmt.Sprint(port), "[::1]:" + fmt.Sprint(port), ""} {
		for _, p := range []string{"/ping?n=nonce0123456789abcdefXYZ", "/status", "/pair?code=123456"} {
			code, o := m1Req(t, h, p, map[string]string{"X-Bridge-Key": "proof-key-123456"})
			if code != 403 || o["proof"] != nil || o["key"] != nil || o["version"] != nil {
				t.Fatalf("Host %q %s: %d %v (want 403, nothing said)", h, p, code, o)
			}
		}
	}
	for _, h := range []string{"127.0.0.1:" + fmt.Sprint(port), "localhost:" + fmt.Sprint(port), "LOCALHOST:" + fmt.Sprint(port)} {
		if code, o := m1Req(t, h, "/ping", nil); code != 200 || o["ok"] != true {
			t.Fatalf("Host %q: %d %v", h, code, o)
		}
	}
	if logLines("Refused a request for another address") < 1 {
		t.Fatalf("said in the log:\n%s", readText(logFile()))
	}
}

func TestM1EmptyOriginNoProof(t *testing.T) {
	m1Setup(t)
	host := "127.0.0.1:" + fmt.Sprint(toInt(cfg("Port")))
	n := "nonce0123456789abcdefXYZ"
	openPairWindow(15)
	// a page (or any program) sending no Origin, without the key: neither proof
	if _, o := m1Req(t, host, "/ping?n="+n, nil); o["proof"] != nil || o["pairProof"] != nil || o["ok"] != true {
		t.Fatalf("empty Origin: %v", o)
	}
	// a page not FinCom's: neither
	if _, o := m1Req(t, host, "/ping?n="+n, map[string]string{"Origin": "http://evil.example"}); o["proof"] != nil || o["pairProof"] != nil {
		t.Fatalf("another page: %v", o)
	}
	// FinCom's page: both
	if _, o := m1Req(t, host, "/ping?n="+n, map[string]string{"Origin": "https://app.fincom.live"}); str(o["proof"]) == "" || str(o["pairProof"]) == "" {
		t.Fatalf("FinCom's page: %v", o)
	}
	// the tray (a program of this computer holding the key, no Origin): the proof
	if _, o := m1Req(t, host, "/ping?n="+n, map[string]string{"X-Bridge-Key": "proof-key-123456"}); str(o["proof"]) == "" {
		t.Fatalf("the tray: %v", o)
	}
	if _, o := m1Req(t, host, "/ping?n="+n, map[string]string{"X-Bridge-Key": "wrong-key"}); o["proof"] != nil || o["pairProof"] != nil {
		t.Fatalf("a wrong key is not the tray: %v", o)
	}
}

func TestM1PairProofBound(t *testing.T) {
	m1Setup(t)
	port := toInt(cfg("Port"))
	n := "nonce0123456789abcdefXYZ"
	openPairWindow(15)
	pairMu.Lock()
	code := pairCode
	pairMu.Unlock()
	_, o := m1Req(t, "127.0.0.1:"+fmt.Sprint(port), "/ping?n="+n, map[string]string{"Origin": "https://app.fincom.live"})
	if str(o["pairProof"]) != hmacOf(code, n+"go-"+instanceID()+fmt.Sprint(port)) {
		t.Fatalf("pairProof bound to the bridge's id and port: %v", o["pairProof"])
	}
	if str(o["pairProof"]) == hmacOf(code, n) {
		t.Fatal("an unbound pairProof")
	}
}
