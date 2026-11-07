// 2.5.5 (the owner's Option B): this login's own Tally port, the page's and the bridge's the same (loginport255.go), and
// where the bridge uses it (iniconnect253.go: a tally.ini only this login uses, no port named, the connection being
// switched on). Made-up login names only.
package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// the production hook, kept before the tests below set their own (the tests written before 2.5.5 check the 2.5.3
// choice of port: they get no per-login port, as a login name the test computer gives would make them depend on it)
var iniLoginPortProd func(func(int) bool) int

func init() {
	iniLoginPortProd = iniLoginPortFn
	iniLoginPortFn = func(func(int) bool) int { return 0 }
}

type lpCase struct {
	login string
	seen  []int
	want  int
}

// worked out by the page's own freePort (node tests/run_login_port.mjs) on 07-Nov-2026
var lpCases = []lpCase{
	{"made-up-a", nil, 9029}, {"made-up-b", nil, 9031}, {"Made-Up-A", nil, 9029}, {"  made-up   a ", nil, 9026},
	{"test.user", nil, 9086}, {"ACCOUNTS2", nil, 9061}, {"pilot-x", nil, 9096}, {"Ünal-demo", nil, 9026},
	{"İrem", nil, 9047}, {"İrem", []int{9047, 9048}, 9049}, {"ΟΔΥΣΣΕΑΣ", nil, 9057}, {"😀x", nil, 9031},
	{"", nil, 9002}, {"", []int{9002, 9003, 9004, 9005}, 9006},
}

func lpSeen(ps []int) map[int]bool {
	m := map[int]bool{}
	for _, p := range ps {
		m[p] = true
	}
	return m
}

// the bridge's port is the page's for each made-up name (the table, and the page's code itself when node is here)
func TestLoginPortSameAsPage(t *testing.T) {
	for _, c := range lpCases {
		if got := loginFreePort(lpSeen(c.seen), c.login); got != c.want {
			t.Errorf("%q seen %v: the bridge says %d, the page %d", c.login, c.seen, got, c.want)
		}
	}
	// past the last candidate: the first one; none free: 0
	all := map[int]bool{}
	for p := 9000; p <= 9099; p++ {
		all[p] = true
	}
	if p := loginFreePort(all, "made-up-a"); p != 0 {
		t.Fatalf("no port free: %d", p)
	}
	// DOMAIN\user: the part after the backslash, as the page's short()
	if p, q := loginOwnPort(`SRV02\made-up-a`), loginOwnPort("made-up-a"); p != 9029 || q != 9029 || loginOwnPort(`SRV02\ `) != 0 {
		t.Fatalf("own port %d %d", p, q)
	}
	// the page's ownPort still gives freePort's number for the login (connectSteps.js)
	cs := readText(filepath.Join("..", "app", "src", "lib", "connectSteps.js"))
	if !strings.Contains(cs, "return freePort(used, login);") || !strings.Contains(cs, `import { freePort, portHowWords } from "./tallyPort.js";`) {
		t.Fatal("connectSteps.js ownPort no longer returns tallyPort.js freePort(used, login): port the page's rule again (loginport255.go)")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Log("node not found: the page's freePort itself not run here (the table above is its answers)")
		return
	}
	in := [][]any{}
	for _, c := range lpCases {
		in = append(in, []any{c.login, c.seen})
	}
	// and a few more, with other logins' ports seen
	for _, n := range []string{"made-up-c", "made-up-d", "Made Up E", "made-up-f"} {
		for _, s := range [][]int{nil, {9029, 9031, 9033}, {9000, 9002, 9003, 9004}} {
			in = append(in, []any{n, s})
		}
	}
	// (review P2) the login's port with ports found taken: the page's freePort with those seen
	takenSets := [][]int{{9029}, {9029, 9031, 9032}, {9026, 9027, 9028, 9029, 9031}}
	for _, ts := range takenSets {
		in = append(in, []any{"made-up-a", ts})
	}
	b, _ := json.Marshal(in)
	out, err := exec.Command(node, filepath.Join("..", "tests", "run_login_port.mjs"), string(b)).CombinedOutput()
	if err != nil {
		t.Fatalf("node: %v\n%s", err, out)
	}
	var page []int
	if err := json.Unmarshal(out, &page); err != nil || len(page) != len(in) {
		t.Fatalf("node said %s (%v)", out, err)
	}
	for i, x := range in {
		var seen []int
		if s, ok := x[1].([]int); ok {
			seen = s
		}
		if got := loginFreePort(lpSeen(seen), x[0].(string)); got != page[i] {
			t.Errorf("%q seen %v: the bridge says %d, the page %d", x[0], seen, got, page[i])
		}
	}
	for i, ts := range takenSets {
		taken := lpSeen(ts)
		got := loginOwnPortFree(`PC1\made-up-a`, func(p int) bool { return taken[p] })
		if want := page[len(page)-len(takenSets)+i]; got != want {
			t.Errorf("made-up-a with %v taken: the bridge writes %d, the page offers %d", ts, got, want)
		}
	}
}

// a tally.ini only this login uses, its connection off and no port named: this login's own port is written
func TestLoginPortWrittenForOwnIni(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	old, oldS := iniLoginPortFn, iniSharedFn
	t.Cleanup(func() { iniLoginPortFn, iniSharedFn = old, oldS })
	iniSharedFn = func() bool { return false }
	iniLoginPortFn = func(used func(int) bool) int { return iniLoginPort(`PC1\made-up-a`, used) }
	_, p := r253Ini(t, "[Tally]\r\nUser TDL = Yes\r\nClient Server = None\r\n")
	e, err := tallyIniApply(p, addonIniPath())
	if err != nil || str(e["connect"]) != connectEnabled || toInt(e["serverPort"]) != 9029 {
		t.Fatalf("apply: %v %v", e, err)
	}
	if got := r253Read(t, p); !strings.Contains(got, "Client Server = Both\r\n") || !strings.Contains(got, "ServerPort = 9029\r\n") {
		t.Fatalf("file:\n%s", got)
	}
	// no Client Server line at all (the connection off): the same
	_, p = r253Ini(t, "[Tally]\r\nUser TDL = Yes\r\n")
	if e, err := tallyIniApply(p, addonIniPath()); err != nil || toInt(e["serverPort"]) != 9029 {
		t.Fatalf("apply: %v %v", e, err)
	}
}

// the per-login port taken by another tally.ini, or listened on: the login's next port, as the page gives it; all taken:
// the 2.5.3 choice; a port the file names, or a Tally working on 9000 with no port named, is kept; a shared computer
// writes nothing (2.5.4)
func TestLoginPortFallsBackAndNeverMovesAWorkingPort(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	old, oldS := iniLoginPortFn, iniSharedFn
	t.Cleanup(func() { iniLoginPortFn, iniSharedFn = old, oldS })
	iniSharedFn = func() bool { return false }
	iniLoginPortFn = func(used func(int) bool) int { return iniLoginPort(`PC1\made-up-a`, used) }

	// another TallyPrime's tally.ini names 9029
	root := t.TempDir()
	mine, other := filepath.Join(root, "TallyPrime"), filepath.Join(root, "TallyPrime (1)")
	_ = os.MkdirAll(mine, 0o755)
	_ = os.MkdirAll(other, 0o755)
	p := filepath.Join(mine, "tally.ini")
	_ = os.WriteFile(p, []byte("[Tally]\r\nClient Server = None\r\n"), 0o644)
	_ = os.WriteFile(filepath.Join(other, "tally.ini"), []byte("[Tally]\r\nClient Server = Both\r\nServer Port = 9029\r\n"), 0o644)
	oldD := tallyIniDirsFn
	tallyIniDirsFn = func() []string { return []string{mine, other} }
	t.Cleanup(func() { tallyIniDirsFn = oldD; resetIniPorts() })
	fake := filepath.Join(root, "fake.json")
	_ = os.WriteFile(fake, []byte(`{"mySession": 1, "processes": [], "listeners": []}`), 0o644)
	t.Setenv("TDSBRIDGE_FAKE", fake)
	// (review P2) the login's next port, as the page gives it with 9029 seen: 9031 (9030 is one FinCom never proposes)
	if e, err := tallyIniApply(p, addonIniPath()); err != nil || toInt(e["serverPort"]) != 9031 {
		t.Fatalf("named by another tally.ini: %v %v (want the login's next port, 9031)", e, err)
	}
	// something listens on 9029 (and on 9000): the login's next port too
	_ = os.WriteFile(filepath.Join(other, "tally.ini"), []byte("[Tally]\r\nClient Server = Both\r\nServer Port = 9070\r\n"), 0o644)
	_ = os.WriteFile(p, []byte("[Tally]\r\nClient Server = None\r\n"), 0o644)
	_ = os.Remove(p + ".fincom-bak")
	_ = os.WriteFile(fake, []byte(`{"mySession": 1, "processes": [{"pid": 30, "name": "svc", "session": 1}], "listeners": [{"port": 9029, "pid": 30}, {"port": 9000, "pid": 30}]}`), 0o644)
	resetIniPorts()
	if e, err := tallyIniApply(p, addonIniPath()); err != nil || toInt(e["serverPort"]) != 9031 {
		t.Fatalf("listened on: %v %v (want 9031)", e, err)
	}
	// every port of the login's taken: the 2.5.3 choice
	if p := iniLoginPort(`PC1\made-up-a`, func(p int) bool { return p < 9200 }); p != 0 {
		t.Fatalf("every login port taken: %d", p)
	}
	if _, _, port, _ := iniConnectPref([]byte("[Tally]\r\nClient Server = None\r\n"), func(p int) bool { return p < 9200 }, iniLoginPortFn); port != 9200 {
		t.Fatalf("every login port taken: wrote %d (want the 2.5.3 choice, 9200)", port)
	}

	// (review P1) the connection on, no port named, and the user's Tally listening on TallyPrime's own 9000: that is
	// this file's working port: nothing written
	orig := "[Tally]\r\nUser TDL = Yes\r\nClient Server = Both\r\nTDL = " + addonIniPath() + "\r\n"
	_ = os.WriteFile(p, []byte(orig), 0o644)
	_ = os.Remove(p + ".fincom-bak")
	_ = os.WriteFile(fake, []byte(`{"mySession": 1, "processes": [{"pid": 31, "name": "tally.exe", "session": 1}], "listeners": [{"port": 9000, "pid": 31}]}`), 0o644)
	resetIniPorts()
	if e, err := tallyIniApply(p, addonIniPath()); err != nil || str(e["connect"]) != connectAlready || toInt(e["serverPort"]) != 9000 || r253Read(t, p) != orig || exists(p+".fincom-bak") {
		t.Fatalf("Tally working on 9000: %v %v\n%s", e, err, r253Read(t, p))
	}
	// another program (not a Tally) on 9000: the file gets a free port, as before
	_ = os.WriteFile(fake, []byte(`{"mySession": 1, "processes": [{"pid": 32, "name": "svc", "session": 1}], "listeners": [{"port": 9000, "pid": 32}]}`), 0o644)
	resetIniPorts()
	if e, err := tallyIniApply(p, addonIniPath()); err != nil || str(e["connect"]) != connectEnabled || toInt(e["serverPort"]) != 9001 {
		t.Fatalf("another program on 9000: %v %v", e, err)
	}

	// the pure rule: a port named is kept; a connection already on (no Tally on 9000) keeps the 2.5.3 choice
	used := func(int) bool { return false }
	pref := func(func(int) bool) int { return 9029 }
	if _, st, port, _ := iniConnectPref([]byte("[Tally]\r\nClient Server = None\r\nServer Port = 9070\r\n"), used, pref); st != connectEnabled || port != 9070 {
		t.Fatalf("named port: %s %d", st, port)
	}
	if _, _, port, _ := iniConnectPref([]byte("[Tally]\r\nClient Server = Both\r\n"), used, pref); port != 9000 {
		t.Fatalf("connection already on: port %d (want 2.5.3's 9000, never the per-login port)", port)
	}
	if _, st, port, _ := iniConnectPref([]byte("[Tally]\r\nClient Server = Both\r\nServerPort = 9005\r\n"), used, pref); st != connectAlready || port != 9005 {
		t.Fatalf("already: %s %d", st, port)
	}
	// on a computer several people use: no per-login port, and nothing written (2.5.4)
	iniSharedFn = func() bool { return true }
	if p := iniLoginPort(`PC1\made-up-a`, nil); p != 0 {
		t.Fatalf("shared computer: per-login port %d", p)
	}
	_ = os.WriteFile(p, []byte("[Tally]\r\nClient Server = None\r\n"), 0o644)
	_ = os.Remove(p + ".fincom-bak")
	e, _ := tallyIniApply(p, addonIniPath())
	if got := r253Read(t, p); str(e["connect"]) != connectSharedOff || !strings.Contains(got, "Client Server = None\r\n") || strings.Contains(got, "ServerPort") {
		t.Fatalf("shared: %v\n%s", e, r253Read(t, p))
	}
}

// the hook the bridge runs with is the login's own port, from the bridge's Windows user
func TestLoginPortProductionHook(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	oldS := iniSharedFn
	t.Cleanup(func() { iniSharedFn = oldS })
	iniSharedFn = func() bool { return false }
	setCfg("Owner", `PC1\made-up-b`) // Windows
	t.Setenv("USER", "made-up-b")    // elsewhere
	if p := iniLoginPortProd(nil); p != 9031 {
		t.Fatalf("the bridge's own hook: %d (want made-up-b's 9031)", p)
	}
}
