package main

// FinCom Bridge 2.4.6 (the owner's approval of 24-Oct-2026: "the bridge opens FinCom with the code already filled in, so
// after installing you'd only press Add as client"). Written before the code (pairopen.go):
//   1. the tray's "Connect FinCom on this computer..." opens FinCom's own address with #pair=<code> of the window it just
//      opened (the code works once, 10 minutes, as before), and its words no longer name "Settings > Tally Bridge > Connect";
//   2. the first start after the installer (its install command given --pairopen) does the same once per install, in the
//      bridge owner's own signed-in session only (never the service, session 0 or another Windows user), not when this
//      computer is already connected to FinCom; the installer's Finish page "Open FinCom to connect" (ticked) asks for it
//      at once, unticked it is dropped;
//   3. only to FinCom's own https sites (the built-in list allowedOrigin trusts), only the 6-digit code in the address's
//      fragment (no key), and nothing is sent to Tally.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPairOpenURLOnlyFinComSites(t *testing.T) {
	good := map[string]string{
		"https://staging.fincom.live/review/":        "https://staging.fincom.live/review/#pair=123456",
		"https://app.fincom.live/":                   "https://app.fincom.live/#pair=123456",
		"https://app.fincom.live":                    "https://app.fincom.live#pair=123456",
		"https://fincom.live/x/?a=1":                 "https://fincom.live/x/?a=1#pair=123456",
		"https://caanshulgarg.github.io/testing/":    "https://caanshulgarg.github.io/testing/#pair=123456",
		"https://staging.fincom.live/review/#/tally": "https://staging.fincom.live/review/#pair=123456", // its own fragment replaced
		"HTTPS://Staging.FinCom.live/review/":        "https://staging.fincom.live/review/#pair=123456",
	}
	for base, want := range good {
		if got, ok := pairOpenURL(base, "123456"); !ok || got != want {
			t.Errorf("%q: got %q %v, want %q", base, got, ok, want)
		}
	}
	for _, base := range []string{
		"", "http://staging.fincom.live/review/", "https://staging.fincom.live.evil.example/review/",
		"https://evil.example/https://staging.fincom.live/", "https://user@staging.fincom.live/review/",
		"https://staging.fincom.live:8443/review/", "javascript:alert(1)", "file:///C:/x.html", "https://localhost/",
		"https://127.0.0.1:9100/", "//staging.fincom.live/review/", "https://fincom.live.", "https://xfincom.live/",
	} {
		if got, ok := pairOpenURL(base, "123456"); ok || got != "" {
			t.Errorf("%q opened as %q", base, got)
		}
	}
	for _, code := range []string{"", "12345", "1234567", "12345a", "123 456", "12345\n"} {
		if got, ok := pairOpenURL("https://app.fincom.live/", code); ok || got != "" {
			t.Errorf("code %q opened as %q", code, got)
		}
	}
	// the same sites the bridge's own server trusts as FinCom (allowedOrigin), no more
	for _, s := range fincomSites {
		if !strings.HasPrefix(s, "https://") || !allowedOrigin(s) {
			t.Errorf("site %q", s)
		}
	}
}

func TestMayOpenBrowserOwnSessionOnly(t *testing.T) {
	cases := []struct {
		f  browserFacts
		ok bool
	}{
		{browserFacts{Session: 1, OwnerOK: true}, true},
		{browserFacts{Session: 0, OwnerOK: true}, false},                // session 0: the services' session
		{browserFacts{Session: 2, Service: true, OwnerOK: true}, false}, // the Windows service itself
		{browserFacts{Session: 2, OwnerOK: false}, false},               // another Windows user's session
	}
	for _, c := range cases {
		if ok, why := mayOpenBrowser(c.f); ok != c.ok || (!ok && why == "") {
			t.Errorf("%+v: %v %q", c.f, ok, why)
		}
	}
}

// --- a stand bridge reached as the tray reaches it (the key, no Origin), through its own web server
type pairStand struct {
	t      *testing.T
	opened []string
	shown  []string
	warned int
}

func newPairStand(t *testing.T, extra string) *pairStand {
	f := newStandTally(t)
	standBridge(t, f, `,"Key":"k246","FinComUrl":"https://staging.fincom.live/review/"`+extra)
	pairMu.Lock()
	pairUntil, pairTries = time.Time{}, 0
	pairMu.Unlock()
	return &pairStand{t: t}
}

func (p *pairStand) call(method, path string, body any) M {
	var b *strings.Reader
	if body != nil {
		j, _ := json.Marshal(body)
		b = strings.NewReader(string(j))
	} else {
		b = strings.NewReader("")
	}
	r := httptest.NewRequest(method, "http://127.0.0.1:9100"+path, b)
	r.RemoteAddr = "127.0.0.1:50123"
	r.Header.Set("X-Bridge-Key", "k246")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handle(w, r)
	return parseObj(w.Body.String())
}

// FinCom's page pairing with the code taken from the address (as src/js/49-tally-cloud.js does)
func (p *pairStand) pair(code string) (int, M) {
	r := httptest.NewRequest("GET", "http://127.0.0.1:9100/pair?code="+code, nil)
	r.RemoteAddr = "127.0.0.1:50124"
	r.Header.Set("Origin", "https://staging.fincom.live")
	w := httptest.NewRecorder()
	handle(w, r)
	return w.Code, parseObj(w.Body.String())
}

func (p *pairStand) env(f browserFacts) pairOpenEnv {
	return pairOpenEnv{
		call: p.call,
		open: func(u string) { p.opened = append(p.opened, u) },
		show: func(title, text string, warn bool) {
			p.shown = append(p.shown, title+": "+text)
			if warn {
				p.warned++
			}
		},
		facts: f,
	}
}

var ownSessionFacts = browserFacts{Session: 1, OwnerOK: true}

var rePairURL = regexp.MustCompile(`^https://staging\.fincom\.live/review/#pair=(\d{6})$`)

// 1. the tray item: the browser opens with the code of the window just opened; the code works once
func TestTrayConnectOpensFinComWithCode(t *testing.T) {
	p := newPairStand(t, "")
	sent := tallySent.Load()
	trayConnectNow(p.env(ownSessionFacts), fincomURL())
	if len(p.opened) != 1 || !rePairURL.MatchString(p.opened[0]) {
		t.Fatalf("opened %v", p.opened)
	}
	code := rePairURL.FindStringSubmatch(p.opened[0])[1]
	pairMu.Lock()
	open, now := time.Now().Before(pairUntil), pairCode
	left := time.Until(pairUntil)
	pairMu.Unlock()
	if !open || now != code || left > 10*time.Minute || left < 9*time.Minute {
		t.Fatalf("the window: open %v, code %s (opened with %s), %v left", open, now, code, left)
	}
	if len(p.shown) != 1 {
		t.Fatalf("shown %v", p.shown)
	}
	msg := p.shown[0]
	for _, w := range []string{"FinCom is opening in your browser", "https://staging.fincom.live/review/", code, "until "} {
		if !strings.Contains(msg, w) {
			t.Errorf("the message does not say %q: %s", w, msg)
		}
	}
	if strings.Contains(msg, "Settings > Tally Bridge") || strings.Contains(msg, "#pair") {
		t.Errorf("the message: %s", msg)
	}
	if c, r := p.pair(code); c != 200 || str(r["key"]) != "k246" {
		t.Fatalf("pairing with the code from the address: %d %v", c, r)
	}
	if c, _ := p.pair(code); c == 200 {
		t.Fatal("the code worked twice")
	}
	if tallySent.Load() != sent {
		t.Fatal("a request went to Tally")
	}
}

func TestTrayConnectNotFinComSiteShowsCodeOnly(t *testing.T) {
	p := newPairStand(t, "")
	trayConnectNow(p.env(ownSessionFacts), "http://evil.example/")
	if len(p.opened) != 0 {
		t.Fatalf("opened %v", p.opened)
	}
	if len(p.shown) != 1 || strings.Contains(p.shown[0], "is opening") || !regexp.MustCompile(`\d{6}`).MatchString(p.shown[0]) {
		t.Fatalf("shown %v", p.shown)
	}
	// not this user's own session: the code is shown, nothing opened
	p = newPairStand(t, "")
	trayConnectNow(p.env(browserFacts{Session: 0, OwnerOK: true}), fincomURL())
	if len(p.opened) != 0 || len(p.shown) != 1 {
		t.Fatalf("session 0: opened %v shown %v", p.opened, p.shown)
	}
}

func TestTrayConnectBridgeNotAnswering(t *testing.T) {
	p := newPairStand(t, "")
	e := p.env(ownSessionFacts)
	e.call = func(string, string, any) M { return nil }
	trayConnectNow(e, fincomURL())
	if len(p.opened) != 0 || p.warned != 1 || !strings.Contains(p.shown[0], "not answering") {
		t.Fatalf("opened %v shown %v", p.opened, p.shown)
	}
}

func dueAt(t *testing.T, ago time.Duration, now bool) {
	t.Helper()
	if err := markPairOpenDue(Home); err != nil {
		t.Fatal(err)
	}
	m := readObjFile(filepath.Join(Home, pairOpenDueName))
	m["at"] = fmtTime(time.Now().Add(-ago))
	m["now"] = now
	b, _ := json.Marshal(m)
	_ = os.WriteFile(filepath.Join(Home, pairOpenDueName), b, 0o644)
}

func dueExists() bool { return exists(filepath.Join(Home, pairOpenDueName)) }

// 2. the first start after the installer: once, after the Finish page had its chance (2 minutes), or at once when asked
func TestFirstStartOpensOncePerInstall(t *testing.T) {
	p := newPairStand(t, "")
	sent := tallySent.Load()
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 {
		t.Fatal("opened with no install asking")
	}
	if truthy(trayStatus()["pairOpenReady"]) {
		t.Fatal("ready with no install asking")
	}
	dueAt(t, 10*time.Second, false) // the installer's Finish page still on screen
	if truthy(trayStatus()["pairOpenReady"]) || trayFirstOpen(p.env(ownSessionFacts), fincomURL()) {
		t.Fatal("opened before the Finish page had its chance")
	}
	dueAt(t, pairOpenGrace+time.Second, false)
	if !truthy(trayStatus()["pairOpenReady"]) {
		t.Fatal("not ready after the grace")
	}
	if !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 || !rePairURL.MatchString(p.opened[0]) {
		t.Fatalf("first start: opened %v", p.opened)
	}
	if dueExists() {
		t.Fatal("the install's ask not taken")
	}
	code := rePairURL.FindStringSubmatch(p.opened[0])[1]
	if len(p.shown) != 1 || !strings.Contains(p.shown[0], code) || !strings.Contains(p.shown[0], "FinCom is opening in your browser") {
		t.Fatalf("shown %v", p.shown)
	}
	// once per install: the next start (or the next look of the tray) opens nothing
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("opened twice: %v", p.opened)
	}
	if c, _ := p.pair(code); c != 200 {
		t.Fatal("the code did not pair")
	}
	if logLines("FinCom opened in the browser to connect this computer") != 1 {
		t.Error("no log line for the first-start open")
	}
	if tallySent.Load() != sent {
		t.Fatal("a request went to Tally")
	}
}

func TestFinishPageAsksAtOnceOrDrops(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, time.Second, false)
	if r := p.call("POST", "/tray/pairopen", M{"action": "now"}); !truthy(r["ok"]) || !truthy(r["due"]) {
		t.Fatalf("now: %v", r)
	}
	if !truthy(trayStatus()["pairOpenReady"]) || !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("Finish ticked: opened %v", p.opened)
	}
	// ticked again after it was done (or with no install asking): nothing is made up
	if r := p.call("POST", "/tray/pairopen", M{"action": "now"}); truthy(r["due"]) || dueExists() {
		t.Fatalf("now with nothing due: %v", r)
	}
	// unticked: dropped for good
	dueAt(t, time.Second, false)
	p.call("POST", "/tray/pairopen", M{"action": "skip"})
	if dueExists() {
		t.Fatal("unticked, still due")
	}
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("opened after unticked: %v", p.opened)
	}
	if r := p.call("POST", "/tray/pairopen", M{"action": "other"}); truthy(r["ok"]) {
		t.Fatalf("an unknown action: %v", r)
	}
}

func TestFirstStartNotWhenConnectedOrPaired(t *testing.T) {
	// connected to FinCom already (an upgrade of a working computer): the first start opens nothing, the ask is dropped
	p := newPairStand(t, `,"CloudUrl":"http://127.0.0.1:1","CloudKey":"plain:fcd_test"`)
	dueAt(t, pairOpenGrace+time.Second, false)
	if truthy(trayStatus()["pairOpenReady"]) || trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 {
		t.Fatalf("connected: opened %v", p.opened)
	}
	if dueExists() {
		t.Fatal("connected: the ask kept")
	}
	// connected, the Finish page ticked: FinCom opens, without a code (no pairing window opened)
	dueAt(t, time.Second, false)
	p.call("POST", "/tray/pairopen", M{"action": "now"})
	if !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 || p.opened[0] != "https://staging.fincom.live/review/" {
		t.Fatalf("connected, ticked: opened %v", p.opened)
	}
	pairMu.Lock()
	open := time.Now().Before(pairUntil)
	pairMu.Unlock()
	if open {
		t.Fatal("a pairing window was opened for a connected computer")
	}
	// paired by typing the code before the first open: the ask is dropped
	p = newPairStand(t, "")
	dueAt(t, time.Second, false)
	r := p.call("POST", "/paircode", M{})
	if c, _ := p.pair(str(r["code"])); c != 200 {
		t.Fatal("pairing")
	}
	if dueExists() {
		t.Fatal("paired, the ask kept")
	}
}

// never for the service, session 0 or another Windows user: the ask is not even taken (left for the owner's own tray)
func TestFirstStartNotForServiceOrOtherUser(t *testing.T) {
	for _, f := range []browserFacts{{Session: 0, OwnerOK: true}, {Session: 1, Service: true, OwnerOK: true}, {Session: 3, OwnerOK: false}} {
		p := newPairStand(t, "")
		dueAt(t, pairOpenGrace+time.Second, true)
		if trayFirstOpen(p.env(f), fincomURL()) || len(p.opened) != 0 || len(p.shown) != 0 {
			t.Fatalf("%+v: opened %v", f, p.opened)
		}
		if !dueExists() {
			t.Fatalf("%+v: the ask was taken", f)
		}
	}
}

// two trays of the owner (two sessions): one takes the ask, the other opens nothing
func TestFirstStartOneTrayOnly(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, 0, true)
	a, b := trayFirstOpen(p.env(ownSessionFacts), fincomURL()), trayFirstOpen(p.env(browserFacts{Session: 2, OwnerOK: true}), fincomURL())
	if a == b || len(p.opened) != 1 {
		t.Fatalf("%v %v %v", a, b, p.opened)
	}
}

// the address FinCom is configured with but not one of FinCom's sites: the ask is taken, nothing opened, the code shown
func TestFirstStartNotFinComSite(t *testing.T) {
	p := newPairStand(t, "")
	setCfg("FinComUrl", "https://evil.example/")
	dueAt(t, 0, true)
	trayFirstOpen(p.env(ownSessionFacts), fincomURL())
	if len(p.opened) != 0 {
		t.Fatalf("opened %v", p.opened)
	}
}

// the tray's own address only: a web page (FinCom's own included) cannot ask for it
func TestPairOpenRefusedForWebPages(t *testing.T) {
	newPairStand(t, "")
	dueAt(t, 0, true)
	r := httptest.NewRequest("POST", "http://127.0.0.1:9100/tray/pairopen", strings.NewReader(`{"action":"take"}`))
	r.RemoteAddr = "127.0.0.1:50125"
	r.Header.Set("X-Bridge-Key", "k246")
	r.Header.Set("Origin", "https://staging.fincom.live")
	w := httptest.NewRecorder()
	handle(w, r)
	if w.Code != 403 || !dueExists() {
		t.Fatalf("a web page: %d %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest("POST", "http://127.0.0.1:9100/tray/pairopen", strings.NewReader(`{"action":"take"}`))
	r.RemoteAddr = "127.0.0.1:50126"
	w = httptest.NewRecorder()
	handle(w, r) // no key
	if w.Code == 200 || !dueExists() {
		t.Fatalf("no key: %d %s", w.Code, w.Body.String())
	}
}

// the installer's command: --first asks at once, --skip drops; a bridge still starting is asked again, for 30 s at most
func TestConnectCommand(t *testing.T) {
	var asked []string
	n := 0
	oldCall, oldWait := connectCall, connectWait
	t.Cleanup(func() { connectCall, connectWait = oldCall, oldWait })
	connectWait = func(time.Duration) {}
	connectCall = func(method, path string, body any) M {
		n++
		if n < 3 {
			return nil
		}
		asked = append(asked, method+" "+path+" "+str(obj(body)["action"]))
		return M{"ok": true}
	}
	if connectCmd([]string{"--first"}) != 0 || len(asked) != 1 || asked[0] != "POST /tray/pairopen now" {
		t.Fatalf("--first: %v", asked)
	}
	n, asked = 10, nil
	if connectCmd([]string{"--skip"}) != 0 || len(asked) != 1 || asked[0] != "POST /tray/pairopen skip" {
		t.Fatalf("--skip: %v", asked)
	}
	n, asked = -1000, nil
	if connectCmd([]string{"--first"}) != 0 || len(asked) != 0 || n > -1000+16 {
		t.Fatalf("never answering: asked %d times", n+1000)
	}
}

// the installer: Finish's ticked "Open FinCom to connect" runs the bridge's connect, unticked drops it; both installs ask
func TestInstallerFinishOpensToConnect(t *testing.T) {
	nsi := readText(filepath.Join("installer", "FinComBridge.nsi"))
	for _, w := range []string{
		`StrCpy $RunText "Open FinCom to connect"`,
		`Exec '"$INSTDIR\FinComBridge.exe" connect --first'`,
		`Exec '"$INSTDIR\FinComBridge.exe" connect --skip'`,
		`!define MUI_PAGE_CUSTOMFUNCTION_LEAVE FinishLeave`,
		`install --mode $Mode --fincom "${FINCOM}" --postonly "${POSTONLY}"$PairOpen'`,
		`install --per-user --mode $Mode --fincom "${FINCOM}" --postonly "${POSTONLY}"$PairOpen'`,
		"StrCpy $PairOpen \" --pairopen\"\n  ${If} ${Silent}\n    StrCpy $PairOpen \"\"",
	} {
		if !strings.Contains(nsi, w) {
			t.Errorf("the installer does not have %s", w)
		}
	}
	run := group(`(?s)Function FinishRun\n(.*?)FunctionEnd`, nsi, 1)
	ok := group(`(?s)\$\{If\} \$Failed == "0"(.*?)Return`, run, 1)
	if strings.Contains(ok, "ExecShell") || !strings.Contains(ok, "connect --first") {
		t.Errorf("FinishRun on success: %s", ok)
	}
	// the bridge program: the install marks the first start only when the setup asks (--pairopen), the tray item uses
	// the shared path, the old words gone
	svc, usr, tray, mainGo := readText("win_service.go"), readText("win_user.go"), readText("win_tray.go"), readText("main.go")
	for name, src := range map[string]string{"win_service.go": svc, "win_user.go": usr} {
		if !strings.Contains(src, `if contains(args, "--pairopen") {`) || !strings.Contains(src, "markPairOpenDue(filepath.Dir(cfgPath))") {
			t.Errorf("%s does not mark the first start", name)
		}
	}
	if strings.Contains(tray, "Settings > Tally Bridge > Connect") || !strings.Contains(tray, "trayConnectNow(") || !strings.Contains(tray, "trayFirstOpen(") {
		t.Error("win_tray.go: the tray item or the first start")
	}
	if !strings.Contains(mainGo, `case "connect":`) || !strings.Contains(mainGo, `fs.Bool("pairopen"`) {
		t.Error("main.go: the connect command or the --pairopen flag")
	}
}

// the version; no request added or changed: docs/tally-allowlist.md byte for byte as at 2.4.5's release (its sha256 in
// the release log's last 2.4.5 row), the table's hash as the code's; the test sheet names this version's new steps
func TestRelease246VersionAllowListUnchanged(t *testing.T) {
	if BridgeVersion != "2.4.6" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	sum := sha256.Sum256([]byte(al))
	if h := hex.EncodeToString(sum[:]); !strings.HasPrefix(h, "6bf9d43c248e097c") {
		t.Fatalf("docs/tally-allowlist.md changed since 2.4.5 (sha256 %s): 2.4.6 adds no request", h)
	}
	if !strings.Contains(al, "Table hash (SHA-256): "+allowListHash(allowListRows())) {
		t.Fatal("the table hash in the doc is not the table's")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.4.6-test-sheet.txt"))
	for _, w := range []string{"2.4.6", "#pair=", "Open FinCom to connect", "Connect FinCom on this computer"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}
