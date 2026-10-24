//go:build !windows

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
		"https://staging.fincom.live/review/":               "https://staging.fincom.live/review/#pair=123456",
		"https://app.fincom.live/":                          "https://app.fincom.live/#pair=123456",
		"https://app.fincom.live":                           "https://app.fincom.live#pair=123456",
		"https://fincom.live/x/?next=https://evil.example/": "https://fincom.live/x/#pair=123456", // its query dropped
		"https://caanshulgarg.github.io/testing/":           "https://caanshulgarg.github.io/testing/#pair=123456",
		"https://staging.fincom.live/review/#/tally":        "https://staging.fincom.live/review/#pair=123456", // its own fragment replaced
		"HTTPS://Staging.FinCom.live/review/":               "https://staging.fincom.live/review/#pair=123456",
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
	pairOpenMu.Lock()
	pairOpenStuck = false
	pairOpenMu.Unlock()
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
	notePairOpen(filePairStore{Home}, []string{"--pairopen"}, 0, func(string) {})
	if !dueExists() {
		t.Fatal("the install did not note the first start")
	}
	at := time.Now().Add(-ago)
	b, _ := json.Marshal(M{"at": fmtTime(at), "atUnix": at.Unix(), "version": BridgeVersion})
	_ = os.WriteFile(filepath.Join(Home, pairOpenDueName), b, 0o644)
	if now && connectCmd([]string{"--first"}) != 0 {
		t.Fatal("connect --first")
	}
}

func dueExists() bool { return exists(filepath.Join(Home, pairOpenDueName)) }

// the install notes the first start only when a person ran the setup (--pairopen) and the bridge answers; an earlier
// install's note is cleared either way
func TestInstallNotesFirstStart(t *testing.T) {
	newPairStand(t, "")
	var said []string
	logf := func(s string) { said = append(said, s) }
	notePairOpen(filePairStore{Home}, []string{"--mode", "sole"}, 0, logf) // silent setup: no --pairopen
	if dueExists() {
		t.Fatal("noted without --pairopen")
	}
	notePairOpen(filePairStore{Home}, []string{"--pairopen"}, 4, logf) // installed but not answering
	if dueExists() {
		t.Fatal("noted for a failed install")
	}
	dueAt(t, time.Hour, true)
	notePairOpen(filePairStore{Home}, []string{"--pairopen"}, 1, logf) // the next install fails: the earlier note goes
	if dueExists() || exists(filepath.Join(Home, pairOpenNowName)) {
		t.Fatal("an earlier install's note kept")
	}
	notePairOpen(filePairStore{Home}, []string{"--per-user", "--pairopen"}, 0, logf)
	m := readObjFile(filepath.Join(Home, pairOpenDueName))
	if str(m["version"]) != BridgeVersion || str(m["at"]) == "" || len(said) != 0 {
		t.Fatalf("the note: %v %v", m, said)
	}
}

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
	if !truthy(trayStatus()["pairOpenReady"]) || !dueExists() {
		t.Fatal("not ready after the grace (or the status read changed it)")
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
	if logLines("FinCom opened in the browser to connect this computer (the first start after the setup, session 1)") != 1 {
		t.Error("no log line for the first-start open")
	}
	if tallySent.Load() != sent {
		t.Fatal("a request went to Tally")
	}
}

func TestFinishPageAsksAtOnceOrDrops(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, time.Second, true) // ticked
	if r := p.call("GET", "/tray/pairopen", nil); !truthy(r["due"]) || !truthy(r["now"]) || !truthy(r["ready"]) {
		t.Fatalf("ticked: %v", r)
	}
	if !truthy(trayStatus()["pairOpenReady"]) || !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("Finish ticked: opened %v", p.opened)
	}
	if logLines("Open FinCom to connect ticked") != 1 {
		t.Error("the log does not say the Finish page asked")
	}
	// ticked again after it was done (or with no install asking): nothing is made up
	connectCmd([]string{"--first"})
	if dueExists() || truthy(trayStatus()["pairOpenReady"]) || trayFirstOpen(p.env(ownSessionFacts), fincomURL()) {
		t.Fatal("connect --first with nothing due opened FinCom")
	}
	// unticked: dropped for good
	dueAt(t, time.Second, false)
	connectCmd([]string{"--skip"})
	if dueExists() {
		t.Fatal("unticked, still due")
	}
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("opened after unticked: %v", p.opened)
	}
	if r := p.call("POST", "/tray/pairopen", M{"action": "now"}); truthy(r["ok"]) {
		t.Fatalf("the web server takes only the tray's take: %v", r)
	}
}

func TestFirstStartNotWhenConnectedOrPaired(t *testing.T) {
	// connected to FinCom already (an upgrade of a working computer): the first start opens nothing; the ask is dropped
	// (a later disconnect never finds it)
	p := newPairStand(t, `,"CloudUrl":"http://127.0.0.1:1","CloudKey":"plain:fcd_test"`)
	dueAt(t, 10*time.Second, false)
	if truthy(trayStatus()["pairOpenReady"]) || trayFirstOpen(p.env(ownSessionFacts), fincomURL()) {
		t.Fatal("connected: taken within the grace")
	}
	dueAt(t, pairOpenGrace+time.Second, false)
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 || len(p.shown) != 0 {
		t.Fatalf("connected: opened %v shown %v", p.opened, p.shown)
	}
	if dueExists() || logLines("Already connected to FinCom: the install's first-start opening of FinCom is not needed") != 1 {
		t.Fatal("connected: the ask kept, or not said once")
	}
	// the service of an upgrade whose computer key is still protected for the Windows user (not handed over yet): the
	// same (connected before), though it cannot read the key
	p = newPairStand(t, `,"CloudUrl":"http://127.0.0.1:1","CloudKey":"dpapi:AAAA"`)
	if cloudOn() {
		t.Fatal("the stand reads a dpapi key")
	}
	dueAt(t, pairOpenGrace+time.Second, false)
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 {
		t.Fatalf("connected, key not handed over: opened %v", p.opened)
	}
	// connected, the Finish page ticked: FinCom opens, without a code (no pairing window opened)
	dueAt(t, time.Second, true)
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

// the ask that cannot be removed is not taken (else every look of the tray would open FinCom again)
func TestFirstStartNotTakenWhenStuck(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, 0, true)
	pairStoreRemove = func(string) error { return os.ErrPermission }
	t.Cleanup(func() { pairStoreRemove = os.Remove })
	for i := 0; i < 3; i++ {
		if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) {
			t.Fatal("taken though the ask stays")
		}
	}
	if len(p.opened) != 0 || logLines("could not be taken") != 1 || truthy(trayStatus()["pairOpenReady"]) {
		t.Fatalf("opened %v; said %d times", p.opened, logLines("could not be taken"))
	}
}

// the grace is timed in Unix seconds: a clock change never moves it; a clock set back over an hour counts as old
func TestFirstStartGraceClock(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, -30*time.Minute, false) // written "in the future" (a clock stepped back): not yet
	if truthy(trayStatus()["pairOpenReady"]) {
		t.Fatal("ready 30 minutes ahead")
	}
	dueAt(t, -30*time.Minute, true) // the same, the Finish page ticked: opened at once
	if !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatalf("ticked, 30 minutes ahead: opened %v", p.opened)
	}
	p.opened = nil
	dueAt(t, -2*time.Hour, false) // the clock set back by hours
	if !truthy(trayStatus()["pairOpenReady"]) {
		t.Fatal("not ready after a clock set back")
	}
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 || dueExists() {
		t.Fatal("a clock set back by hours: opened (or kept) as if fresh")
	}
	b, _ := json.Marshal(M{"at": "garbled"})
	_ = os.WriteFile(filepath.Join(Home, pairOpenDueName), b, 0o644)
	if !truthy(trayStatus()["pairOpenReady"]) || trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 || dueExists() {
		t.Fatal("an unreadable time not dropped as old")
	}
	// over a day old (the first sign-in days after the setup): dropped, never opened
	dueAt(t, pairOpenMaxAge+time.Minute, false)
	if trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 0 || dueExists() {
		t.Fatal("an ask over a day old opened FinCom")
	}
	if logLines("over a day old") != 1 || logLines("has a time that cannot be trusted") != 2 {
		t.Errorf("the log: %d / %d lines", logLines("over a day old"), logLines("has a time that cannot be trusted"))
	}
	// within the day: opened
	dueAt(t, pairOpenMaxAge-time.Minute, false)
	if !trayFirstOpen(p.env(ownSessionFacts), fincomURL()) || len(p.opened) != 1 {
		t.Fatal("an ask of 23 hours not opened")
	}
}

// a stray "at once" from a connect that lost the race with the tray: removed, a later install keeps its grace
func TestConnectAfterTakeLeavesNoStray(t *testing.T) {
	newPairStand(t, "")
	connectCmd([]string{"--first"}) // nothing due
	if exists(filepath.Join(Home, pairOpenNowName)) {
		t.Fatal("a stray at-once file")
	}
	_ = os.WriteFile(filepath.Join(Home, pairOpenNowName), []byte("x"), 0o644)
	clearPairOpen(filePairStore{Home}) // the next install's start
	dueAt(t, time.Second, false)
	if truthy(trayStatus()["pairOpenReady"]) {
		t.Fatal("the stray made a later install's ask ready at once")
	}
}

// the address FinCom is configured with but not one of FinCom's sites: the ask is taken, nothing opened, the code shown
func TestFirstStartNotFinComSite(t *testing.T) {
	p := newPairStand(t, "")
	setCfg("FinComUrl", "https://evil.example/")
	dueAt(t, 0, true)
	trayFirstOpen(p.env(ownSessionFacts), fincomURL())
	if len(p.opened) != 0 || len(p.shown) != 1 || !strings.Contains(p.shown[0], "Open FinCom in a browser on this computer, go to the Tally page and type this code") ||
		strings.Contains(p.shown[0], "evil") {
		t.Fatalf("opened %v shown %v", p.opened, p.shown)
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
	// the bridge program: the install notes the first start at its end (only with --pairopen and an answering bridge),
	// the tray item uses the shared path, the old words gone
	svc, usr, tray, mainGo := readText("win_service.go"), readText("win_user.go"), readText("win_tray.go"), readText("main.go")
	for name, src := range map[string]string{"win_service.go": svc, "win_user.go": usr} {
		if !regexp.MustCompile(`rc := waitAnswer\(cfgPath, [a-z]+, "[^"]+"\)\n.*\n\tnotePairOpen\(regPairStore\{registry\.(LOCAL_MACHINE|CURRENT_USER)\}, args, rc, installLog\)\n\treturn rc\n`).MatchString(src) {
			t.Errorf("%s does not note the first start at the install's end", name)
		}
		if !regexp.MustCompile(`_ = os\.MkdirAll\(o\.home, 0o755\)\n\tclearPairOpen\(regPairStore\{registry\.(LOCAL_MACHINE|CURRENT_USER)\}\)`).MatchString(src) {
			t.Errorf("%s does not clear an earlier ask at the install's start", name)
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

// the program that answered the take is not this install's bridge (any more) when FinCom would open: nothing opened, no
// code shown
func TestFirstStartPortNotOwn(t *testing.T) {
	p := newPairStand(t, "")
	dueAt(t, 0, true)
	e := p.env(ownSessionFacts)
	e.verify = func() bool { return false }
	trayFirstOpen(e, fincomURL())
	if len(p.opened) != 0 || len(p.shown) != 0 {
		t.Fatalf("opened %v shown %v", p.opened, p.shown)
	}
}
