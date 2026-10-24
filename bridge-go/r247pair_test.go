//go:build !windows

package main

// FinCom Bridge 2.4.7 (the owner's "yes" of 24-Oct-2026: close the pairing gap of the 2.4.6 security review). Written
// before the code (pairspake.go, server.go, pairopen.go):
//   1. FinCom's pages only: the default allowed origins no longer hold "null" (any website's sandboxed frame) or
//      "http://localhost" (any local web server); a settings file that still names them is not obeyed unless the
//      test/dev switch DevOrigins is on (off by default).
//   2. No offline oracle for the typed 6-digit code: /ping no longer gives pairProof = HMAC(code, ...). A typed code is
//      checked by SPAKE2 (RFC 9382's shape, RFC 3526's 2048-bit group): each run tests one guess, online, counted against
//      the window's five tries; nothing the bridge answers lets anyone test codes offline.
//   3. FinCom opened by the bridge (the tray, the first start) carries the code and a 128-bit secret of the window
//      (#pair=<code>-<secret>); the bridge proves it holds that secret (pairProofS), and /pair takes it once.
//   4. The tray (and the measuring tool) send the bridge key only to a program on the port that proved it holds the key
//      (a fresh nonce's HMAC), never to whatever answers there.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestR247GroupIsRFC3526(t *testing.T) {
	if spakeP.BitLen() != 2048 || !spakeP.ProbablyPrime(32) || !spakeQ.ProbablyPrime(32) {
		t.Fatal("p or q is not the safe prime of RFC 3526 group 14")
	}
	if new(big.Int).Exp(spakeG, spakeQ, spakeP).Cmp(big.NewInt(1)) != 0 {
		t.Fatal("g is not of order q")
	}
	for name, e := range map[string]*big.Int{"M": spakeM, "N": spakeN} {
		if e.Cmp(big.NewInt(1)) <= 0 || new(big.Int).Exp(e, spakeQ, spakeP).Cmp(big.NewInt(1)) != 0 {
			t.Fatalf("%s is not in the subgroup", name)
		}
	}
	if spakeM.Cmp(spakeN) == 0 || spakeM.Cmp(spakeG) == 0 {
		t.Fatal("M, N and g must differ")
	}
}

func TestR247DevOriginsOffByDefault(t *testing.T) {
	p := newPairStand(t, `,"AllowedOrigins":["https://app.fincom.live","http://localhost","null"]`)
	_ = p
	for _, o := range []string{"null", "http://localhost", "http://localhost:5173", "http://127.0.0.1:8080"} {
		if allowedOrigin(o) {
			t.Errorf("%s allowed by default", o)
		}
	}
	for _, o := range fincomSites {
		if !allowedOrigin(o) {
			t.Errorf("%s refused", o)
		}
	}
	setCfg("DevOrigins", true)
	if !allowedOrigin("null") || !allowedOrigin("http://localhost:5173") {
		t.Error("the dev switch does not allow the dev origins named in the settings")
	}
	setCfg("DevOrigins", false)
	def := readText("config.go")
	if strings.Contains(group(`(?m)^\s*d\.Set\("AllowedOrigins", (.*)\)$`, def, 1), "null") || strings.Contains(group(`(?m)^\s*d\.Set\("AllowedOrigins", (.*)\)$`, def, 1), "localhost") {
		t.Error("the defaults still name null or localhost")
	}
}

// /ping, from FinCom's page, while the window is open
func pingAs(t *testing.T, origin, nonce string, headers map[string]string) M {
	t.Helper()
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/ping?n="+nonce, nil)
	r.RemoteAddr = "127.0.0.1:50130"
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	handle(w, r)
	return parseObj(w.Body.String())
}

func TestR247PingGivesNoCodeOracle(t *testing.T) {
	newPairStand(t, "")
	code, secret, _ := freshPairCode(10)
	n := "nonce0123456789abcdefXYZ"
	j := pingAs(t, "https://staging.fincom.live", n, nil)
	bound := str(j["bridgeId"]) + fmt.Sprint(toInt(j["port"]))
	if _, has := j["pairProof"]; has {
		t.Fatal("pairProof (HMAC of the 6-digit code) is still given")
	}
	for _, v := range j {
		if s, ok := v.(string); ok && s == proofFor(code, n, bound) {
			t.Fatal("a value of /ping is the code's HMAC")
		}
	}
	if !truthy(j["pairWindow"]) || toInt(j["pairV"]) != 2 || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(str(j["pairSalt"])) {
		t.Fatalf("the window's facts: %v", j)
	}
	if str(j["pairProofS"]) != proofFor(secret, n, bound) || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(secret) {
		t.Fatalf("pairProofS: %v (secret %q)", j["pairProofS"], secret)
	}
	// a page FinCom does not own gets nothing of the window (and null/localhost are not FinCom's by default)
	for _, o := range []string{"null", "http://localhost:5173", "https://evil.example"} {
		k := pingAs(t, o, n, nil)
		if k["pairWindow"] != nil || k["pairSalt"] != nil || k["pairProofS"] != nil || k["proof"] != nil {
			t.Fatalf("%s got %v", o, k)
		}
	}
	// a program of this user with no Origin and no X-FinCom-Tray header: nothing (review M1 of 2.3.0)
	if k := pingAs(t, "", n, nil); k["proof"] != nil {
		t.Fatalf("an empty Origin got the key's proof: %v", k)
	}
	// the tray (no Origin, no Sec-Fetch headers, X-FinCom-Tray: 1) gets the key's proof only, never the window's
	k := pingAs(t, "", n, map[string]string{"X-FinCom-Tray": "1"})
	if str(k["proof"]) != proofFor("k246", n, bound) || k["pairSalt"] != nil || k["pairProofS"] != nil {
		t.Fatalf("the tray's ping: %v", k)
	}
	// a page's request with no Origin (DNS rebinding sends Sec-Fetch-Site) gets no proof
	if k := pingAs(t, "", n, map[string]string{"X-FinCom-Tray": "1", "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors"}); k["proof"] != nil {
		t.Fatalf("a page with no Origin got the key's proof: %v", k)
	}
}

// the page's side of SPAKE2, as src/js/24-tally-bridge.js does it (the test's own copy: spakeClient*)
type spakePage struct {
	x, w *big.Int
	X    string
	ctx  string
}

func newSpakePage(t *testing.T, code string, ping M) *spakePage {
	t.Helper()
	ctx := str(ping["bridgeId"]) + fmt.Sprint(toInt(ping["port"])) + "|" + str(ping["pairSalt"])
	x, X := spakeClientStart(code, ctx, nil)
	return &spakePage{x: x, w: spakeW(code, ctx), X: X, ctx: ctx}
}

func (p *pairStand) get(path string) (int, M) {
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100"+path, nil)
	r.RemoteAddr = "127.0.0.1:50131"
	r.Header.Set("Origin", "https://staging.fincom.live")
	w := httptest.NewRecorder()
	handle(w, r)
	return w.Code, parseObj(w.Body.String())
}

func TestR247SpakePairsWithTheTypedCode(t *testing.T) {
	p := newPairStand(t, "")
	sent := tallySent.Load()
	code, _, _ := freshPairCode(10)
	ping := pingAs(t, "https://staging.fincom.live", "nonce0123456789abcdefXYZ", nil)
	pg := newSpakePage(t, code, ping)
	c, r := p.get("/pair2?X=" + pg.X)
	if c != 200 || len(str(r["Y"])) != 512 || len(str(r["confirm"])) != 64 {
		t.Fatalf("/pair2: %d %v", c, r)
	}
	confirmA, ok := spakeClientFinish(pg.x, pg.w, pg.ctx, pg.X, str(r["Y"]), str(r["confirm"]))
	if !ok {
		t.Fatal("the bridge's confirmation does not verify with the right code")
	}
	c, r = p.get("/pair?X=" + pg.X + "&confirm=" + confirmA)
	if c != 200 || str(r["key"]) != "k246" {
		t.Fatalf("finish: %d %v", c, r)
	}
	// one use: the window is closed
	if c, _ := p.get("/pair?X=" + pg.X + "&confirm=" + confirmA); c == 200 {
		t.Fatal("the run was taken twice")
	}
	if c, _ := p.get("/pair2?X=" + newSpakePage(t, code, ping).X); c == 200 {
		t.Fatal("a new run after pairing")
	}
	if tallySent.Load() != sent {
		t.Fatal("a request went to Tally")
	}
}

func TestR247SpakeWrongCodeOnlineOnly(t *testing.T) {
	p := newPairStand(t, "")
	code, _, _ := freshPairCode(10)
	wrong := "000000"
	if code == wrong {
		wrong = "000001"
	}
	ping := pingAs(t, "https://staging.fincom.live", "nonce0123456789abcdefXYZ", nil)
	pg := newSpakePage(t, wrong, ping)
	c, r := p.get("/pair2?X=" + pg.X)
	if c != 200 {
		t.Fatalf("/pair2: %d %v", c, r)
	}
	if _, ok := spakeClientFinish(pg.x, pg.w, pg.ctx, pg.X, str(r["Y"]), str(r["confirm"])); ok {
		t.Fatal("the bridge's confirmation verified with a wrong code")
	}
	// the attacker's view: it knows x and the bridge's answer; testing the real code against that answer fails too, so
	// the answer is no oracle for any code but the one sent in X
	if _, ok := spakeClientFinish(pg.x, spakeW(code, pg.ctx), pg.ctx, pg.X, str(r["Y"]), str(r["confirm"])); ok {
		t.Fatal("the bridge's answer to a wrong guess verifies the right code offline")
	}
	// finishing with a made-up confirmation: refused
	if c, _ := p.get("/pair?X=" + pg.X + "&confirm=" + strings.Repeat("0", 64)); c == 200 {
		t.Fatal("a wrong confirmation paired")
	}
	// five runs in all per window (the first above), then closed for the right code too
	for i := 0; i < 4; i++ {
		if c, _ := p.get("/pair2?X=" + newSpakePage(t, wrong, ping).X); c != 200 {
			t.Fatalf("run %d refused early", i+2)
		}
	}
	right := newSpakePage(t, code, ping)
	if c, _ := p.get("/pair2?X=" + right.X); c == 200 {
		t.Fatal("a sixth run in one window")
	}
	if logLines("connecting is closed until") < 1 {
		t.Error("the log does not say the window closed")
	}
}

func TestR247SpakeRefusesBadElements(t *testing.T) {
	p := newPairStand(t, "")
	freshPairCode(10)
	pm1 := new(big.Int).Sub(spakeP, big.NewInt(1))
	for name, x := range map[string]string{
		"zero": strings.Repeat("0", 512), "one": fmt.Sprintf("%0512x", 1), "p-1": fmt.Sprintf("%0512x", pm1), "p": fmt.Sprintf("%0512x", spakeP),
		"short": "abcd", "not hex": strings.Repeat("z", 512), "outside the subgroup (-2)": fmt.Sprintf("%0512x", new(big.Int).Sub(spakeP, big.NewInt(2))),
	} {
		if c, r := p.get("/pair2?X=" + x); c == 200 {
			t.Errorf("%s taken: %v", name, r)
		}
	}
	// refused elements use up no try
	pairMu.Lock()
	tries := pairTries
	pairMu.Unlock()
	if tries != 0 {
		t.Fatalf("tries %d", tries)
	}
	// the page refuses a bridge's bad Y as well
	x, X := spakeClientStart("123456", "ctx", nil)
	if _, ok := spakeClientFinish(x, spakeW("123456", "ctx"), "ctx", X, fmt.Sprintf("%0512x", pm1), strings.Repeat("0", 64)); ok {
		t.Fatal("the page took Y = p-1")
	}
}

// review round 1: no 6th guess (the 6 digits alone are not taken by /pair, nothing after five tries), and no try used
// up by a request without FinCom's Origin (another site's image or link)
func TestR247FiveTriesInAllAndOriginOnly(t *testing.T) {
	p := newPairStand(t, "")
	code, secret, _ := freshPairCode(10)
	if c, _ := p.get("/pair?code=" + code); c == 200 {
		t.Fatal("the 6 digits alone paired (an online guess outside SPAKE2)")
	}
	ping := pingAs(t, "https://staging.fincom.live", "nonce0123456789abcdefXYZ", nil)
	for i := 0; i < 4; i++ { // 1 wrong code above + 4 runs = 5 tries
		if c, _ := p.get("/pair2?X=" + newSpakePage(t, "000000", ping).X); c != 200 {
			t.Fatalf("run %d refused early", i+1)
		}
	}
	if c, _ := p.get("/pair?code=" + secret); c == 200 {
		t.Fatal("paired after five tries")
	}
	// another site: no Origin, no try used
	p2 := newPairStand(t, "")
	freshPairCode(10)
	pg := newSpakePage(t, "000000", pingAs(t, "https://staging.fincom.live", "nonce0123456789abcdefXYZ", nil))
	for _, path := range []string{"/pair2?X=" + pg.X, "/pair?code=" + strings.Repeat("a", 32)} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:9100"+path, nil)
		r.RemoteAddr = "127.0.0.1:50140"
		r.Header.Set("Sec-Fetch-Mode", "no-cors")
		w := httptest.NewRecorder()
		handle(w, r)
		if w.Code != 403 {
			t.Fatalf("%s without an Origin: %d", path, w.Code)
		}
	}
	pairMu.Lock()
	tries := pairTries
	pairMu.Unlock()
	if tries != 0 {
		t.Fatalf("tries used by requests without an Origin: %d", tries)
	}
	_ = p2
}

func TestR247SecretFromTheAddress(t *testing.T) {
	p := newPairStand(t, "")
	_, secret, _ := freshPairCode(10)
	if c, _ := p.get("/pair?code=" + strings.Repeat("a", 32)); c == 200 {
		t.Fatal("a wrong secret paired")
	}
	c, r := p.get("/pair?code=" + secret)
	if c != 200 || str(r["key"]) != "k246" {
		t.Fatalf("the secret: %d %v", c, r)
	}
	if c, _ := p.get("/pair?code=" + secret); c == 200 {
		t.Fatal("the secret worked twice")
	}
}

func TestR247TrayOpensWithCodeAndSecret(t *testing.T) {
	p := newPairStand(t, "")
	trayConnectNow(p.env(ownSessionFacts), fincomURL())
	m := regexp.MustCompile(`^https://staging\.fincom\.live/review/#pair=(\d{6})-([0-9a-f]{32})$`).FindStringSubmatch(strings.Join(p.opened, ""))
	if len(p.opened) != 1 || m == nil {
		t.Fatalf("opened %v", p.opened)
	}
	if len(p.shown) != 1 || !strings.Contains(p.shown[0], m[1]) || strings.Contains(p.shown[0], m[2]) {
		t.Fatalf("the message: %v", p.shown)
	}
	if c, _ := p.get("/pair?code=" + m[2]); c != 200 {
		t.Fatal("the address's secret did not pair")
	}
	for _, bad := range []string{"123456-" + strings.Repeat("A", 32), "123456-abc", "12345-" + strings.Repeat("a", 32), "123456-" + strings.Repeat("a", 33)} {
		if u, ok := pairOpenURL("https://app.fincom.live/", bad); ok {
			t.Errorf("%q opened as %q", bad, u)
		}
	}
}

// a server on 127.0.0.1 that answers as the real bridge's handler does, or as an impostor that records what it gets
type keyWatch struct {
	mu   sync.Mutex
	keys []string
}

func startOn(t *testing.T, h http.HandlerFunc) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &http.Server{Handler: h}
	go s.Serve(ln)
	t.Cleanup(func() { s.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

func TestR247KeyOnlyToAProvenBridge(t *testing.T) {
	newPairStand(t, "")
	// the real handler on its own port
	real := startOn(t, handle)
	setCfg("Port", float64(real))
	if !bridgeProves(real, "k246", 2*time.Second) {
		t.Fatal("the real bridge did not prove itself")
	}
	if bridgeProves(real, "another-key", 2*time.Second) {
		t.Fatal("proved with a key it does not hold")
	}
	// an impostor: answers /ping (with a made-up proof, or none) and records any key it is sent
	kw := &keyWatch{}
	imp := startOn(t, func(w http.ResponseWriter, r *http.Request) {
		kw.mu.Lock()
		if k := r.Header.Get("X-Bridge-Key"); k != "" {
			kw.keys = append(kw.keys, r.URL.Path+" "+k)
		}
		kw.mu.Unlock()
		b, _ := json.Marshal(M{"ok": true, "yours": true, "bridgeId": "go-fake", "port": 0, "proof": strings.Repeat("0", 64), "version": BridgeVersion})
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	})
	if bridgeProves(imp, "k246", 2*time.Second) {
		t.Fatal("the impostor proved itself")
	}
	setCfg("Port", float64(imp))
	if r := bridgeCall("GET", "/status", nil, 2*time.Second); r != nil {
		t.Fatalf("bridgeCall talked to the impostor: %v", r)
	}
	kw.mu.Lock()
	got := append([]string{}, kw.keys...)
	kw.mu.Unlock()
	if len(got) != 0 {
		t.Fatalf("the key went to the impostor: %v", got)
	}
	// the real bridge: the call goes through (review round 2: a positive check)
	setCfg("Port", float64(real))
	if r := bridgeCall("GET", "/status", nil, 2*time.Second); r == nil || r["ok"] != true {
		t.Fatalf("bridgeCall to the real bridge: %v", r)
	}
	// and the tray's own call (win_tray.go's trayCall): a proof for each request, never the key
	tray := readText("win_tray.go")
	body := group(`(?s)func trayCall\(method, path string, body any\) M \{(.*?)\n\}`, tray, 1)
	if !strings.Contains(body, "bridgeAuthorize(") || strings.Index(body, "bridgeAuthorize(") > strings.Index(body, `req.Header.Set("X-Bridge-Auth"`) || strings.Contains(body, "X-Bridge-Key") {
		t.Fatalf("trayCall sends the key, or no proof first:\n%s", body)
	}
}

// review round 2: the tray never sends the key; its proof is good once, for that request only
func TestR247TrayNeverSendsTheKey(t *testing.T) {
	newPairStand(t, "")
	var mu sync.Mutex
	var keys, auths []string
	port := startOn(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if k := r.Header.Get("X-Bridge-Key"); k != "" {
			keys = append(keys, r.URL.Path)
		}
		if a := r.Header.Get("X-Bridge-Auth"); a != "" {
			auths = append(auths, a)
		}
		mu.Unlock()
		handle(w, r)
	})
	setCfg("Port", float64(port))
	if r := bridgeCall("GET", "/tray/status", nil, 2*time.Second); r == nil || r["ok"] != true {
		t.Fatalf("the tray's status: %v", r)
	}
	mu.Lock()
	k, a := append([]string{}, keys...), append([]string{}, auths...)
	mu.Unlock()
	if len(k) != 0 || len(a) != 1 {
		t.Fatalf("keys sent %v, proofs %v", k, a)
	}
	do := func(method, path, auth string) int {
		req, _ := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", port, path), nil)
		req.Header.Set("X-Bridge-Auth", auth)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode
	}
	if c := do("GET", "/tray/status", a[0]); c != 401 {
		t.Fatalf("a proof used twice: %d", c)
	}
	// a fresh proof for one request does not open another
	ch, ok := bridgeChallenge(port, "k246", 2*time.Second)
	if !ok {
		t.Fatal("no challenge")
	}
	if c := do("POST", "/tray/pause", ch+"."+trayAuthMAC("k246", ch, "GET", "/tray/status")); c != 401 {
		t.Fatalf("a proof for /tray/status opened /tray/pause: %d", c)
	}
	// a made-up challenge
	if c := do("GET", "/tray/status", strings.Repeat("a", 64)+"."+trayAuthMAC("k246", strings.Repeat("a", 64), "GET", "/tray/status")); c != 401 {
		t.Fatalf("a challenge the bridge never issued: %d", c)
	}
	// a challenge is given only to the tray's kind of request (no Origin, X-FinCom-Tray), and only with the key's proof
	if j := pingAs(t, "https://staging.fincom.live", "nonce0123456789abcdefXYZ&challenge=1", nil); j["challenge"] != nil {
		t.Fatalf("FinCom's page got a tray challenge: %v", j)
	}
}

// the vectors the app's JavaScript is checked against (tests/run_pair_spake.mjs): fixed x and y, the same results here
func TestR247SpakeVectors(t *testing.T) {
	f := filepath.Join("testdata", "r247", "spake-vectors.json")
	var v struct {
		Code, Ctx, Xe, Ye, X, Y, ConfirmB, ConfirmA, W string
	}
	if b, err := os.ReadFile(f); err != nil || json.Unmarshal(b, &v) != nil {
		if os.Getenv("FINCOM_WRITE_FIXTURES") != "1" {
			t.Fatalf("%s missing (FINCOM_WRITE_FIXTURES=1 writes it): %v", f, err)
		}
		xe, ye := randHex(t, 32), randHex(t, 32)
		v.Code, v.Ctx, v.Xe, v.Ye = "482917", "go-0123456789ab9100|"+randHex(t, 16), xe, ye
	}
	xe, _ := new(big.Int).SetString(v.Xe, 16)
	ye, _ := new(big.Int).SetString(v.Ye, 16)
	w := spakeW(v.Code, v.Ctx)
	x, X := spakeClientStart(v.Code, v.Ctx, xe)
	Y, confirmB, confirmA, err := spakeServerStep(X, w, v.Ctx, ye)
	if err != nil {
		t.Fatal(err)
	}
	ca, ok := spakeClientFinish(x, w, v.Ctx, X, Y, confirmB)
	if !ok || ca != confirmA {
		t.Fatal("the two sides do not agree")
	}
	got := map[string]string{"X": X, "Y": Y, "ConfirmB": confirmB, "ConfirmA": confirmA, "W": fmt.Sprintf("%x", w)}
	if os.Getenv("FINCOM_WRITE_FIXTURES") == "1" {
		v.X, v.Y, v.ConfirmB, v.ConfirmA, v.W = X, Y, confirmB, confirmA, got["W"]
		_ = os.MkdirAll(filepath.Dir(f), 0o755)
		b, _ := json.MarshalIndent(v, "", " ")
		_ = os.WriteFile(f, b, 0o644)
		return
	}
	want := map[string]string{"X": v.X, "Y": v.Y, "ConfirmB": v.ConfirmB, "ConfirmA": v.ConfirmA, "W": v.W}
	for k := range want {
		if got[k] != want[k] {
			t.Errorf("%s differs from the vector", k)
		}
	}
}

func randHex(t *testing.T, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

var _ = hmac.Equal
var _ = sha256.New

// the version; no request added or changed (the allow-list's table and hash as at 2.4.5 and 2.4.6); the decision line
// names 2.4.7 by the owner's standing decision, 2.4.6's kept as history; the dated line; the test sheet's new steps
func TestRelease247VersionAllowListUnchanged(t *testing.T) {
	if BridgeVersion != "2.4.7" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	const table245 = "b4df290484f57e3cba053d16cc29f68209eda6a1f087c3c4a1616e69886e9391"
	if h := allowListHash(allowListRows()); h != table245 {
		t.Fatalf("the allow-list's table changed (%s): 2.4.7 adds or changes no request", h)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.4.7 by the owner's standing decision of 2026-10-06 (no request on the list and no request shape changed",
		"as for 2.4.6: the owner's standing decision of 2026-10-06", "as for 2.4.5: the owner's decision of 2026-10-21"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if strings.Contains(al, "allowed for 2.4.6 by") || strings.Contains(al, "allowed for 2.4.5 by") {
		t.Error("an earlier version's decision still worded as the current one")
	}
	if !regexp.MustCompile(`re-measured on 2026-10-25 for 2\.4\.7: no request was measured again[^\n]*allowed for 2\.4\.7 by the owner's standing decision of 2026-10-06`).MatchString(al) {
		t.Error("no dated line for 2.4.7")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.4.7-test-sheet.txt"))
	for _, w := range []string{"2.4.7", "#pair=", "five tries", "DevOrigins", "Connect FinCom on this computer"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}
