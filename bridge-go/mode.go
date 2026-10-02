// The bridge's two ways of running, its main loop, and what the tray icon is told.
//
//   - Test mode (Mode = "test" in the settings): installed beside bridge 1.15.0 to compare the two. It answers on its own
//     port (9101), keeps its own copy (go-sync), reads Tally and sends to FinCom's cloud marked "shadow" (compared there,
//     never kept), and NEVER posts to Tally: posting stays with bridge 1.15.0.
//   - Sole mode (the default): the one bridge on this computer, on port 9100, with the copy, pairing and settings bridge
//     1.15.0 left. It still refuses to post while bridge 1.15.0 is found on the computer: only one bridge may ever post.
//     It is the "main" bridge for FinCom, which may still answer that another bridge is the main one (it then reads only).
//   - A test bridge becomes the main one from its tray menu (Switch to main bridge) or from FinCom's Tally page: see
//     identity.go.
package main

import (
	"crypto/rand"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func testMode() bool { return strings.EqualFold(cfgS("Mode"), "test") }

// How this program was started, for the tray and the log: "service" (a Windows service for all users, started by
// Windows), "user" (installed just for one Windows user: started at sign-in, watched by its own supervisor, no
// administrator needed) or "window" (started by hand, for support and the tests).
var runMode = "window"

// the main loop's last turn (Unix seconds): the per-user supervisor restarts a bridge whose loop has stopped turning
var loopAt atomic.Int64

func loopSec() int64 {
	if t := loopAt.Load(); t > 0 {
		return time.Now().Unix() - t
	}
	return 0
}

// bridge 1.15.0's folder, beside which this one runs in test mode
func psHome() string {
	if h := cfgS("PsHome"); h != "" {
		return h
	}
	return Home
}

// bridge 1.15.0's copy (test mode only): its marks that FinCom is reading from Tally count here too
func psSyncDir() string {
	if !testMode() {
		return ""
	}
	pc := newOrdered()
	if pc.UnmarshalText(readText(filepath.Join(psHome(), "tds-bridge.config.json"))) == nil {
		if d := str(pc.Get("SyncDir")); d != "" {
			return d
		}
	}
	d := filepath.Join(psHome(), "sync")
	if d == syncDir() {
		return ""
	}
	return d
}

var (
	oldMu    sync.Mutex
	oldAt    time.Time
	oldFound bool
)

// why this bridge does not post (” when it may): only one bridge may ever post
func readOnlyWhy() string {
	if testMode() {
		return "This FinCom Bridge is the test install beside bridge 1.15.0: it reads Tally but never posts. Postings go through bridge 1.15.0."
	}
	if why := notMainNow(); why != "" {
		return why
	}
	oldMu.Lock()
	defer oldMu.Unlock()
	if time.Since(oldAt) > 30*time.Second {
		oldAt, oldFound = time.Now(), oldBridgePresent()
	}
	if oldFound {
		return "An older bridge is still on this computer, so FinCom Bridge does not post: only one bridge may post. Run the FinCom Bridge setup again: it takes the older bridge off."
	}
	return ""
}

// --- stopping, restarting, pausing
var (
	stopCh   = make(chan struct{})
	stopOnce sync.Once
	stopCode = 0
	pauseMu  sync.Mutex
	pausedB  bool
)

func requestStop(code int) {
	stopOnce.Do(func() { stopCode = code; close(stopCh) })
}
func stopping() bool {
	select {
	case <-stopCh:
		return true
	default:
		return false
	}
}
func sleepOrStop(d time.Duration) {
	select {
	case <-stopCh:
	case <-time.After(d):
	}
}
func paused() bool {
	pauseMu.Lock()
	defer pauseMu.Unlock()
	return pausedB
}
func setPaused(on bool) {
	pauseMu.Lock()
	pausedB = on
	pauseMu.Unlock()
	setCfg("Paused", on)
	saveConfig()
	if on {
		writeLog("Background reading paused from the tray icon: opening a client in FinCom and the nightly catch-up do not read Tally; postings and Update now still work")
	} else {
		writeLog("Background reading resumed from the tray icon")
	}
}

// --- the person at the computer, as the tray in the owner's session sees it
var (
	trayMu     sync.Mutex
	trayIdle   float64
	trayFront  bool
	trayIdleAt time.Time
)

func setTrayIdle(idle float64, front bool) {
	trayMu.Lock()
	trayIdle, trayFront, trayIdleAt = idle, front, time.Now()
	trayMu.Unlock()
}
func trayIdleFresh() (float64, bool, bool) {
	trayMu.Lock()
	defer trayMu.Unlock()
	return trayIdle, trayFront, time.Since(trayIdleAt) < 30*time.Second
}

// what the tray shows: green when the bridge can reach Tally and FinCom, red when not
func trayStatus() M {
	tallyOpen := false
	cos := []any{}
	for _, s := range openCompaniesCached() {
		if s["skipped"] != true && s["ok"] == true {
			tallyOpen = true
			for _, c := range sessCompanies(s) {
				cos = append(cos, str(c["name"]))
			}
		}
	}
	cloud := cloudOn()
	bOK, bFail := beatTimes()
	// offline only after three missed heartbeats (about two minutes); in between it is "reconnecting"
	missed := cloud && !bFail.IsZero()
	online := cloud && !bOK.IsZero() && (!missed || time.Since(bFail) < time.Duration(3*beatEvery()+30)*time.Second)
	reconnecting := missed && online
	tstate, tsince := tallyOverall(openCompaniesCached())
	return M{"ok": true, "version": BridgeVersion, "runMode": runMode, "testMode": testMode(), "readOnly": readOnlyWhy(), "paused": paused(), "tallyOpen": tallyOpen, "companies": cos,
		"nightlyAt": keepDailyAt(), "lastRead": lastReadAt(), "notAnsweringSince": notAnsweringSince(), "tallyRequests": tallySent.Load(), "tallyLastRequest": unixText(tallySentAt.Load()),
		"cloudConnected": cloud, "online": online, "reconnecting": reconnecting, "tallyState": tstate, "busySince": tsince, "needKey": cfgS("CloudUrl") != "" && cloudKey() == "", "lastBeat": fmtTime(bOK), "beatFailed": fmtTime(bFail), "wake": wakeStatus(), "updating": keepRunning(),
		"port": toInt(cfg("Port")), "fincomUrl": fincomURL(), "log": logFile(), "shadow": shadowStats, "update": updateInfo(), "owner": ownerName(),
		"switching": switching.Load(), "bridgeId": "go-" + instanceID(), "posting": postingNow(), "readStopped": readStopAny()}
}

// the way it runs, in words for the log and the tray
func runModeText() string {
	switch runMode {
	case "service":
		return "as a Windows service for all users"
	case "user":
		return "just for this Windows user (starts at sign-in, no service)"
	}
	return "in a window"
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02T15:04:05")
}

// FinCom's address for this computer's cloud: the test site for the staging database, else the live one
func fincomURL() string {
	if u := cfgS("FinComUrl"); u != "" {
		return u
	}
	if strings.Contains(cfgS("CloudUrl"), "qbocskaiewaxqcvaunzc") {
		return "https://staging.fincom.live/review/"
	}
	return "https://app.fincom.live/"
}

// the tray hands over bridge 1.15.0's computer key (protected for the Windows user): kept protected for the service
func adoptCloudKey(key string) (M, error) {
	if !re(`^fcd_[0-9a-f]{48}$`).MatchString(key) {
		return nil, fmt.Errorf("That is not a FinCom computer key.")
	}
	if cloudKey() == key {
		return M{"ok": true, "same": true}, nil
	}
	pk, err := protectKey(key)
	if err != nil {
		return nil, err
	}
	setCfg("CloudKeyGo", pk)
	saveConfig()
	writeLog("Cloud: this computer's FinCom key was taken over from bridge 1.15.0")
	return M{"ok": true}, nil
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// test mode, first start: bridge 1.15.0's copy (days, ledgers, balances, state) is the starting point of this one's, so
// Tally is not read for the whole year again; from there this bridge reads Tally itself
func seedFromOldCopy() {
	src := psSyncDir()
	dst := syncDir()
	if src == "" || !exists(src) || exists(filepath.Join(dst, ".seeded")) {
		return
	}
	n := 0
	skip := re(`^(cloud-out\.txt|cloud-ledgers\.(flag|sig)|cloud-plain\.txt|posted-in.*|recheck\.txt|waiting\.txt|open-part\.json)$`)
	ents, _ := os.ReadDir(src)
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		from, to := filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())
		if !exists(filepath.Join(from, "keep.json")) {
			continue
		}
		_ = filepath.WalkDir(from, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || skip.MatchString(d.Name()) || strings.HasSuffix(d.Name(), ".tmp") || strings.HasSuffix(d.Name(), ".work") {
				return nil
			}
			rel, _ := filepath.Rel(from, p)
			b, err := os.ReadFile(p)
			if err == nil {
				_ = saveFile(filepath.Join(to, rel), string(b))
			}
			return nil
		})
		// what was sent so far is bridge 1.15.0's; only what this bridge reads itself goes (as a shadow)
		_ = saveFile(filepath.Join(to, "cloud-all.done"), nowS())
		if st := readKeepState(to); st != nil {
			st["verify"] = []any{}
			saveKeepState(to, st)
		}
		n++
	}
	_ = saveFile(filepath.Join(dst, ".seeded"), nowS())
	if n > 0 {
		writeLog(fmt.Sprintf("Test mode: started from bridge 1.15.0's copy of %d compan%s (%s); from here on this bridge reads Tally itself", n, map[bool]string{true: "y", false: "ies"}[n == 1], src))
	}
}

// --- the bridge itself
var lastDiag string

func showDiagnosis() {
	d := diagnosis()
	var parts []string
	for _, f := range arr(d["findings"]) {
		m := obj(f)
		parts = append(parts, str(m["level"])+"|"+str(m["text"]))
	}
	txt := strings.Join(parts, "\n")
	if txt == lastDiag {
		return
	}
	lastDiag = txt
	for _, f := range arr(d["findings"]) {
		m := obj(f)
		writeLog("Check: " + str(m["level"]) + " - " + str(m["text"]))
	}
}

// runBridge runs until it is asked to stop; returns the exit code (non-zero: start me again)
func runBridge(console bool) int {
	loadConfig()
	_ = os.MkdirAll(syncDir(), 0o755)
	pausedB = cfgB("Paused")
	if testMode() {
		seedFromOldCopy()
	}
	var err error
	for i := 0; ; i++ {
		if _, err = serve(); err == nil {
			break
		}
		if console || i >= 60 {
			fmt.Printf("Could not start on port %d: %s\n", toInt(cfg("Port")), err)
			fmt.Println("Another program already uses this port. Usually a bridge is already running. Stop it, or change \"Port\" in the settings.")
			writeLog(fmt.Sprintf("Could not start on port %d: %s", toInt(cfg("Port")), err))
			return 1
		}
		if i == 0 {
			writeLog(fmt.Sprintf("Port %d is taken; trying again every 5 seconds (another bridge may be stopping)", toInt(cfg("Port"))))
		}
		sleepOrStop(5 * time.Second)
		if stopping() {
			return stopCode
		}
	}
	openPairWindow(toInt(cfg("PairWindowMin")))
	mode := "the only bridge on this computer"
	if testMode() {
		mode = "TEST MODE beside bridge 1.15.0 (reads Tally, sends to FinCom as a shadow, never posts)"
	}
	writeLog(fmt.Sprintf("FinCom Bridge %s (Go) started on 127.0.0.1:%d: %s; working for %s, Windows session %d; runs %s", BridgeVersion, toInt(cfg("Port")), mode, ownerName(), mySession(), runModeText()))
	if why := readOnlyWhy(); why != "" && !testMode() {
		writeLog(why)
	}
	if console {
		pairMu.Lock()
		fmt.Printf("\n  FinCom - Tally Bridge %s\n  Address : http://127.0.0.1:%d\n  To connect FinCom: press Connect there and type the code  %s  (until %s).\n\n", BridgeVersion, toInt(cfg("Port")), pairCode, pairUntil.Format("15:04"))
		pairMu.Unlock()
	}
	// 2.1.3: Tally is asked nothing at the start (no company list, no warm-up): only whether it is open
	if p := tallyOpenNow(); p > 0 {
		writeLog(fmt.Sprintf("Tally is open on port %d; the bridge reads it only after an event (a client opened in FinCom, Update now, a posting, the nightly catch-up at %s)", p, keepDailyAt()))
	} else {
		writeLog("Tally is not open; the bridge reads it only after an event (a client opened in FinCom, Update now, a posting, the nightly catch-up at " + keepDailyAt() + ")")
	}
	coMu.Lock()
	planMode, _ = portPlan()
	if planMode == "fallback" {
		writeLog("Windows did not say which Tally belongs to you; ports from the settings are used. Choose your Tally in FinCom.")
	}
	coMu.Unlock()
	safe := func(name string, f func()) {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprintf("%s: %v", name, r))
			}
		}()
		f()
	}
	go updateLoop()
	go beatLoop()
	for !stopping() {
		loopAt.Store(time.Now().Unix())
		sleepOrStop(100 * time.Millisecond)
		bridgeTurn(safe)
	}
	time.Sleep(300 * time.Millisecond)
	return stopCode
}

func unixText(u int64) string {
	if u <= 0 {
		return ""
	}
	return time.Unix(u, 0).Format("2006-01-02T15:04:05")
}
