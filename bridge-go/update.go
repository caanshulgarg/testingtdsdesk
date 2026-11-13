// Updates from FinCom. 2.1.5: an update is installed only when FinCom's heartbeat answer allows that version on this
// computer (release: {version, allowed}; see setRelease below). The list of updates (latest.json) is signed by FinCom with the same key as the FinCom Connector's
// (RSA, SHA-256; latest.json.sig): a list without a good signature is refused. The new program must match the SHA-256
// in the list, and, when the list asks for it (requireSignature) or the settings do (RequireSignedUpdates), carry a valid
// Windows code signature: ready for when the program is signed. The service puts the new program in place and starts
// again; if the new one does not start properly, the previous one is put back.
package main

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	mrand "math/rand"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const updatePublicKeyXML = "<RSAKeyValue><Modulus>1rseJE/fmVCEIZPmyUAV+nPrRk6zP5TwYfRRdtpVV8yWUJUADJBBkxqlQXdSI1ZxuZ8CAhhxYbpRcKx3Yiz+ugUDTjpYiWPrQCBRwcZjENOzYAwO72ziWfC3os8huXVpSK1XIOZhPkejyldjWAtdWU+mOfTVsdUGoC31086OYJU/FD7HfgJeiRLKsi7MTG8q/QzKcIvtqA8cYJk+0pSv4zDpo4nLg21OkcTVJPYxXH/aZSk4vSwk+VGnYJo1kmZy2MsLehXD50KA5DIqFPJ9MDuGB10PCfJLe8PVNzGpzAmOyzZPT5VaVVq4ilM2ijnG2qCt+rVzoCao0WxOcp3pbZrhxYofnpDvs+h0sq29Fqwj68R02OOVpIW0U2ssLA8Xe2RkplVNyGbs75Gi1Yt1r418XvQH++PAQSNrUgdzWNlwOSWZFxB+u+SPeVeJ2/jbPWy4E4xNOi/5fJebJ7rH5Mm1nHVx5yYMDa4/HsEudg1Q+1u39kwlmQ5nNMJaaGUh</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>"

func publicKey() (*rsa.PublicKey, error) {
	x := updatePublicKeyXML
	if os.Getenv("FINCOM_TEST") == "1" && os.Getenv("FINCOM_TEST_PUBKEY") != "" { // the tests' own key
		x = readText(os.Getenv("FINCOM_TEST_PUBKEY"))
	}
	m, _ := base64.StdEncoding.DecodeString(group(`<Modulus>([^<]+)</Modulus>`, x, 1))
	e, _ := base64.StdEncoding.DecodeString(group(`<Exponent>([^<]+)</Exponent>`, x, 1))
	if len(m) == 0 || len(e) == 0 {
		return nil, errors.New("no key")
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(m), E: int(new(big.Int).SetBytes(e).Int64())}, nil
}
func verifySigned(body []byte, sigB64 string) error {
	pk, err := publicKey()
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(sigB64))
	if err != nil {
		return err
	}
	h := sha256.Sum256(body)
	return rsa.VerifyPKCS1v15(pk, crypto.SHA256, h[:], sig)
}

// 2.0.10 > 2.0.9
func newerVersion(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < maxI(len(pa), len(pb)); i++ {
		var x, y int
		if i < len(pa) {
			x = toInt(pa[i])
		}
		if i < len(pb) {
			y = toInt(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func updateBase() string {
	if u := cfgS("UpdateUrl"); u != "" {
		return strings.TrimRight(u, "/") + "/"
	}
	return strings.TrimRight(fincomURL(), "/") + "/assets/bridge-go/"
}

var (
	updMu   sync.Mutex
	updLast = M{"checked": "", "latest": "", "message": "", "applying": false}
)

func updateInfo() M {
	updMu.Lock()
	defer updMu.Unlock()
	o := M{}
	for k, v := range updLast {
		o[k] = v
	}
	return o
}
func setUpd(k string, v any) { updMu.Lock(); updLast[k] = v; updMu.Unlock() }

// 2.5.4: the update's state for the heartbeat, kept small: the last look's time, its words (200 letters at most), the
// version FinCom's list offered, whether it is being put in place or looked for now, and whether automatic updates are
// off on this computer (NoAutoUpdate) and the next look's time
func updateBeat() M {
	u := updateInfo()
	o := M{"checked": str(u["checked"]), "message": cutRunes(str(u["message"]), 200), "offered": str(u["latest"]),
		"applying": u["applying"] == true, "checking": updChecking.Load(), "noAutoUpdate": cfgB("NoAutoUpdate"), "next": updNextAt()}
	if f := updFailNow(); f != nil {
		o["failed"] = f // 2.5.15 item 5: the version that could not be put in place, the step and why, how many looks
	}
	return o
}

// when the schedule looks next ("" before the first wait is set)
var updNext atomic.Int64

func updNextAt() string {
	if t := updNext.Load(); t > 0 {
		return time.Unix(0, t).Format(time.RFC3339)
	}
	return ""
}

// 2.5.4: the download never hangs: 10 s to connect and to get the answer's head, 5 minutes for the whole
func fetch(u string, max int64) ([]byte, error) {
	c := &http.Client{Timeout: 5 * time.Minute, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 30 * time.Second}}
	r, err := c.Get(u)
	if err != nil {
		return nil, plainNetErr(err)
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", r.StatusCode)
	}
	return io.ReadAll(io.LimitReader(r.Body, max))
}

// asked from the tray (now=true) or every few hours; returns what happened
func checkForUpdate(now bool) M {
	// 2.5.4 review S1: an update already put in place (waiting to start again, or not yet confirmed as running well:
	// update-pending.json) is never put in place again: that would replace FinComBridge.old.exe, the real previous
	// version a failed update is undone to
	if updatePending() {
		u := updateInfo()
		if str(u["message"]) == "" || u["applying"] != true {
			u["message"] = "An update is being put in place; the bridge starts again when the work with Tally now has finished."
		}
		return u
	}
	setUpd("checked", nowS())
	base := updateBase()
	body, err := fetch(base+"latest.json", 1<<20)
	if err != nil {
		setUpd("message", "Could not reach FinCom for updates: "+err.Error())
		return updateInfo()
	}
	sig, err := fetch(base+"latest.json.sig", 1<<16)
	if err != nil {
		setUpd("message", "The list of updates has no signature, so nothing was changed.")
		return updateInfo()
	}
	if err := verifySigned(body, string(sig)); err != nil {
		setUpd("message", "The list of updates is not signed by FinCom, so nothing was changed.")
		writeLog("Update: the list of updates is not signed by FinCom; nothing changed")
		return updateInfo()
	}
	man := parseObj(string(body))
	b := obj(man["bridge"])
	if b == nil {
		b = man
	}
	ver, u, want := str(b["version"]), str(b["url"]), strings.ToLower(str(b["sha256"]))
	setUpd("latest", ver)
	if !newerVersion(ver, BridgeVersion) {
		setUpd("message", "This is the newest FinCom Bridge ("+BridgeVersion+").")
		updFailClear()
		return updateInfo()
	}
	// only the version FinCom allowed this computer (nothing is downloaded otherwise)
	if why := releaseRefuses(ver); why != "" {
		setUpd("message", "Version "+ver+" is available but not approved for this computer yet ("+why+"); nothing was changed.")
		writeLog("Update " + ver + ": FinCom has not approved it for this computer yet (" + why + "); nothing changed")
		// review L6: a release withdrawn (none named, held, rolled back, another version named) is no longer an update that
		// failed; one only not let through now (FinCom's update gate) still is
		if !strings.Contains(why, "has not allowed it") && !strings.Contains(why, "has not answered") {
			updFailClear()
		}
		return updateInfo()
	}
	if !strings.HasPrefix(u, "https://") && !(os.Getenv("FINCOM_TEST") == "1") {
		setUpd("message", "The update's address is not secure, so it was not used.")
		return updateInfo()
	}
	// 2.5.15 item 5: the download tried a second way when the first fails or does not match (downloadUpdate)
	exeB, err := downloadUpdate(u, want)
	if errors.Is(err, errUpdateSHA) {
		setUpd("message", "The downloaded update does not match FinCom's list (SHA-256), so it was not used.")
		writeLog("Update " + ver + ": the download does not match its SHA-256 (tried two ways); not used")
		noteUpdFail(ver, "sha", "the download does not match FinCom's list (SHA-256), tried two ways")
		return updateInfo()
	}
	if err != nil {
		setUpd("message", "The update could not be downloaded: "+err.Error())
		noteUpdFail(ver, "download", "the update could not be downloaded (tried two ways): "+err.Error())
		return updateInfo()
	}
	if truthy(b["requireSignature"]) || cfgB("RequireSignedUpdates") {
		if err := checkCodeSignature(exeB); err != nil {
			setUpd("message", "The update is not signed by FinCom ("+err.Error()+"), so it was not used.")
			writeLog("Update " + ver + ": no valid code signature; not used")
			noteUpdFail(ver, "signature", "no valid code signature ("+err.Error()+")")
			return updateInfo()
		}
	}
	exe, _ := os.Executable()
	writeLog("Update: putting FinCom Bridge " + ver + " in place of " + BridgeVersion)
	if err := applyUpdateFn(exe, exeB); err != nil {
		// 2.5.15 item 5: the program running is kept as it is; looked for again shortly (updateLoop) and FinCom told
		setUpd("message", "The update could not be put in place: "+err.Error()+"; this version keeps running and the update is tried again shortly.")
		writeLog("Update " + ver + " could not be put in place: " + err.Error() + "; " + BridgeVersion + " keeps running, tried again shortly")
		noteUpdFail(ver, "apply", "the update could not be put in place: "+err.Error())
		return updateInfo()
	}
	updFailClear()
	setUpd("applying", true)
	setUpd("message", "Updating to "+ver+"; the bridge starts again in a few seconds.")
	go restartAfterUpdate()
	return updateInfo()
}

// putting the new program in place and starting again (the tests put their own). 2.5.4: the start again waits until
// nothing goes to Tally (updateRestartWhenQuiet): never during a posting or while a request is at Tally
var (
	applyUpdateFn      = applyUpdate
	restartAfterUpdate = func() { updateRestartWhenQuiet(time.Second, func() { requestStop(3) }) }
)

// 2.5.4: nothing goes to Tally now: no posting being sent (postingGoing: an import in flight, a job starting or
// sending, a posting being taken from FinCom's queue), no request at Tally (inflight), and no request Tally is still
// on after the bridge stopped waiting for it (inflight.go earlier). A posting only waiting for Tally resumes after the
// start again, as before (nothing is posted twice)
var tallyQuietFn = func() bool {
	if postingGoing() {
		return false
	}
	busyMu.Lock()
	n := len(inflight)
	busyMu.Unlock()
	earlierMu.Lock()
	m := len(earlier)
	earlierMu.Unlock()
	return n == 0 && m == 0
}

// the start again after an update: once nothing has gone to Tally for two looks in a row (every tick); it says so
// once. Review S1: after updQuietMax (30 minutes) one quiet look is enough (the moment between two requests: never in
// the middle of one); the new program is already in place, so any start from now on is the new one
var updQuietMax = 30 * time.Minute

func updateRestartWhenQuiet(tick time.Duration, restart func()) {
	quiet, said, start := 0, false, time.Now()
	for !stopping() {
		if tallyQuietFn() {
			quiet++
			if quiet >= 2 || time.Since(start) >= updQuietMax {
				restart()
				return
			}
		} else {
			quiet = 0
			if !said {
				said = true
				writeLog("Update: in place; the bridge starts again as soon as the posting or the request at Tally now has finished")
				setUpd("message", "Updating: the bridge starts again as soon as the work with Tally now has finished.")
			}
		}
		sleepOrStop(tick)
	}
}

// 2.5.4: a random wait on top of the schedule (UpdateJitterMin minutes, 0-n). Off by default (0): FinCom's update gate
// (migration 139, server/tally-cloud/updategate.js) already lets the bridges of one computer through one at a time, each
// only while idle with Tally, and it expects each bridge's look exactly 2 minutes after its start and then every 6 hours
// (from 4 minutes before to 6 after); a random wait would put the bridge outside that window, and it would never be let
// through. The knob stays for a cloud without the gate
var updateJitterFn = func() time.Duration {
	m := keepNum("UpdateJitterMin", 0)
	if m <= 0 {
		return 0
	}
	return time.Duration(mrand.Int63n(int64(m) * int64(time.Minute)))
}

// the wait before the next look: the first after 2 minutes, then UpdateCheckHours (6); each plus the jitter
func updateWait(first bool) time.Duration {
	base := time.Duration(keepNum("UpdateCheckHours", 6)) * time.Hour
	if first {
		base = 2 * time.Minute
	}
	return base + updateJitterFn()
}

// 2.5.4: one look for an update at a time (the schedule's and the tray's "Check for updates" never run together).
// Review S1: an update put in place keeps the flag until the bridge starts again
var updChecking atomic.Bool

func checkForUpdateOnce(now bool) (M, bool) {
	if !updChecking.CompareAndSwap(false, true) {
		return updateInfo(), false
	}
	m := checkForUpdate(now)
	// re-review N1: kept only while an update this bridge put in place waits to start again (applying); a look that
	// only found update-pending.json (the new program not yet two minutes running) clears it, as every other look
	if updateInfo()["applying"] != true {
		updChecking.Store(false)
	}
	return m, true
}

// an update is in place and the bridge has not started again yet (applying), or the new program has not run well for
// two minutes yet (update-pending.json beside it)
func updatePending() bool {
	if u := updateInfo(); u["applying"] == true {
		return true
	}
	if exe := exePathFn(); exe != "" && exists(filepath.Join(filepath.Dir(exe), "update-pending.json")) {
		return true
	}
	return false
}

// 2.5.4: the tray's "Check for updates" never waits for a download: the look runs in the background and the tray gets
// what is known after at most updTrayWait (the tray asks again for the rest)
var updTrayWait = 8 * time.Second

func checkForUpdateTray() M {
	done := make(chan M, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("Update check: ", r))
				done <- updateInfo()
			}
		}()
		m, ran := checkForUpdateOnce(true)
		if !ran {
			m["message"] = "Already looking for an update; the result shows here in a moment."
		}
		done <- m
	}()
	select {
	case m := <-done:
		return m
	case <-time.After(updTrayWait):
		m := updateInfo()
		m["checking"] = true
		m["message"] = "Looking for an update in the background; the result shows here in a moment. FinCom Bridge keeps working meanwhile."
		return m
	}
}

func updateLoop() {
	wait := func(first bool, spent time.Duration) {
		d := updateWait(first) - spent // 2.5.15: the schedule kept to its own times (the gate expects them)
		if d < time.Minute {
			d = time.Minute
		}
		updNext.Store(time.Now().Add(d).UnixNano())
		sleepOrStop(d)
	}
	wait(true, 0)
	for !stopping() {
		t0 := time.Now()
		if !cfgB("NoAutoUpdate") {
			updateLookWithRetries()
		}
		wait(false, time.Since(t0))
	}
}

// one scheduled look. 2.5.15 item 5: a download or a putting in place that failed is tried again a little later, within
// the look's own time (FinCom's update gate lets a bridge through for a few minutes); never during a posting (the start
// again waits for quiet as before)
func updateLookWithRetries() {
	look := func() {
		defer func() { recover() }()
		checkForUpdateOnce(false)
	}
	look()
	for _, d := range updRetryWaits {
		if !updFailRetryable() || stopping() {
			break
		}
		updNext.Store(time.Now().Add(d).UnixNano())
		sleepOrStop(d)
		look()
	}
}

// --- 2.5.15 item 5 (the owner's approval of 13-Nov-2026): a computer never stays on an old bridge silently. The download
// is tried a second way (a fresh connection over HTTP/1.1, then FinCom's own copy of the same file) when the first fails
// or does not match FinCom's list; a download or a putting in place that fails is looked for again 2 and 4 minutes later
// (within the update gate's few minutes), then at the usual times; the version, the step and why go to FinCom with every
// beat (update.failed) until an update is put in place or this is the newest. Signing and the installer are unchanged:
// the SHA-256 and the code signature are checked as before on whatever was downloaded
var updRetryWaits = []time.Duration{2 * time.Minute, 2 * time.Minute}

var errUpdateSHA = errors.New("the download does not match FinCom's list (SHA-256)")

// the second way: a new connection of its own, HTTP/1.1, no connection kept, more time for the whole
var fetchAltFn = func(u string, max int64) ([]byte, error) {
	tr := &http.Transport{Proxy: http.ProxyFromEnvironment, DisableKeepAlives: true, ForceAttemptHTTP2: false,
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{}, // HTTP/1.1 only
		DialContext:  (&net.Dialer{Timeout: 20 * time.Second}).DialContext, TLSHandshakeTimeout: 20 * time.Second, ResponseHeaderTimeout: 60 * time.Second}
	c := &http.Client{Timeout: 10 * time.Minute, Transport: tr}
	r, err := c.Get(u)
	if err != nil {
		return nil, plainNetErr(err)
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", r.StatusCode)
	}
	return io.ReadAll(io.LimitReader(r.Body, max))
}

var (
	fetchFn       = fetch
	updAltPauseFn = func() { sleepOrStop(5 * time.Second) }
)

// the program from u, matching want (SHA-256 hex): the usual way, then the second way, then the second way from
// FinCom's own copy of the same file (when u is elsewhere); errUpdateSHA when what came never matched
func downloadUpdate(u, want string) ([]byte, error) {
	urls := []string{u}
	if i := strings.LastIndex(u, "/"); i >= 0 {
		if own := updateBase() + u[i+1:]; own != u && (strings.HasPrefix(own, "https://") || os.Getenv("FINCOM_TEST") == "1") {
			urls = append(urls, own)
		}
	}
	var last error
	sawWrong := false
	for n := 0; n < 1+len(urls); n++ {
		get, at, how := fetchAltFn, urls[minI(maxI(n-1, 0), len(urls)-1)], "the second way"
		if n == 0 {
			get, how = fetchFn, "the usual way"
		} else {
			updAltPauseFn()
			if stopping() {
				break
			}
		}
		b, err := get(at, 200<<20)
		if err == nil {
			h := sha256.Sum256(b)
			if hex.EncodeToString(h[:]) == want {
				if n > 0 {
					writeLog("Update: downloaded " + how + " (" + at + ") after the first try did not work (" + or(errText(last), "no match") + ")")
				}
				return b, nil
			}
			sawWrong, err = true, errUpdateSHA
		}
		writeLog("Update: the download " + how + " (" + at + ") did not work: " + err.Error())
		last = err
	}
	if sawWrong && errors.Is(last, errUpdateSHA) {
		return nil, errUpdateSHA
	}
	return nil, last
}

var updFail struct {
	mu   sync.Mutex
	last M // {version, from, step, words, at, tries}; nil: none
	now  bool
}

// a look ended without the update in place: kept (tries counted per version) for the beat; said in the log once a look
func noteUpdFail(ver, step, words string) {
	updFail.mu.Lock()
	tries := 1
	if updFail.last != nil && str(updFail.last["version"]) == ver {
		tries = toInt(updFail.last["tries"]) + 1
	}
	updFail.last = M{"version": ver, "from": BridgeVersion, "step": step, "words": cutRunes(words, 300), "at": nowFn().Format(time.RFC3339), "tries": tries}
	updFail.now = step == "download" || step == "apply" || step == "sha"
	updFail.mu.Unlock()
	writeLog(fmt.Sprintf("Update %s: not put in place (%s, look %d): %s; FinCom is told with the heartbeat", ver, step, tries, words))
}

func updFailClear() {
	updFail.mu.Lock()
	updFail.last, updFail.now = nil, false
	updFail.mu.Unlock()
}

// the failure FinCom is told of (nil: none)
func updFailNow() M {
	updFail.mu.Lock()
	defer updFail.mu.Unlock()
	if updFail.last == nil {
		return nil
	}
	o := M{}
	for k, v := range updFail.last {
		o[k] = v
	}
	return o
}

// the last look failed in a way a look a little later may mend (download, SHA-256, putting in place); consumed
func updFailRetryable() bool {
	updFail.mu.Lock()
	defer updFail.mu.Unlock()
	r := updFail.now
	updFail.now = false
	return r && !cfgB("NoAutoUpdate") && updateInfo()["applying"] != true
}

// the new program put in place of the running one (Windows: win_platform.go applyUpdate): written whole and flushed
// beside it, the running one renamed aside (FinComBridge.old.exe), the new one renamed into its place. 2.5.15 item 5:
// each rename tried again for a moment (a program holding the file), and if the new one cannot be put in place the
// running one is put back, by a rename or else by a copy of its bytes, so the computer is never left without a program
func replaceProgram(exe string, b []byte) error {
	dir := filepath.Dir(exe)
	nw := filepath.Join(dir, "FinComBridge.new.exe")
	old := filepath.Join(dir, "FinComBridge.old.exe")
	tmp, err := writeTempSynced(nw, b)
	if err != nil {
		return err
	}
	if err := updRename(tmp, nw); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Remove(old)
	if err := updRename(exe, old); err != nil {
		_ = os.Remove(nw)
		return err
	}
	if err := updRename(nw, exe); err != nil {
		// review L6: the running program put back, and FinComBridge.old.exe kept until the program is in place again: a
		// rename back, else a copy of its bytes (the old one stays beside it either way), tried again for a few seconds
		if e2 := updRename(old, exe); e2 != nil {
			for i := 0; i < 5 && !exists(exe); i++ {
				if ob, e3 := os.ReadFile(old); e3 == nil {
					if t, e4 := writeTempSynced(exe, ob); e4 == nil {
						if updRename(t, exe) != nil {
							_ = os.Remove(t)
						}
					}
				}
				if !exists(exe) {
					time.Sleep(time.Second)
				}
			}
		}
		if !exists(exe) {
			writeLog("UPDATE: " + exe + " could not be put back; the program is kept as " + old + " (copy it to " + filepath.Base(exe) + " or run the setup again)")
		}
		_ = os.Remove(nw)
		return err
	}
	fsyncDir(dir)
	// review H2 (2.2.0): the SHA-256 of the program replaced, recorded while it is the running one, for the rollback
	_ = saveFile(filepath.Join(dir, "update-pending.json"), jsonText(M{"from": BridgeVersion, "at": nowS(), "starts": 0, "sha256": fileSHA256(old)}))
	return nil
}

var updRenameFn = os.Rename

func updRename(a, b string) error {
	var err error
	for i := 0; i < 5; i++ {
		if err = updRenameFn(a, b); err == nil {
			return nil
		}
		time.Sleep(time.Duration(i+1) * 100 * time.Millisecond)
	}
	return err
}

// --- 2.5.4: an update runs well only when the new program really works: its web server is up (serving) and its main
// loop turns (loopSec); updateHealth (the service and the per-user worker) waits for that before it keeps the new one.
// A new program that does not get there within updHealthMax stops with a failure, so Windows (or the supervisor) starts
// it again and undoFailedUpdate puts the previous one back after three such starts
var (
	serving      atomic.Bool
	updHealthMax = 6 * time.Minute
)

func updateLooksHealthy() bool {
	return serving.Load() && loopAt.Load() > 0 && loopSec() < 30
}

// waits 2 minutes, then until healthy (every 15 s) or updHealthMax; true when healthy
func updateWaitHealthy(first, every time.Duration) bool {
	sleepOrStop(first)
	end := time.Now().Add(updHealthMax - first)
	for !stopping() {
		if updateLooksHealthy() {
			return true
		}
		if time.Now().After(end) {
			return false
		}
		sleepOrStop(every)
	}
	return false
}

// --- the release: FinCom's heartbeat answer says what this computer may take. The owner's rule of 05-Oct-2026 (migration
// 54): release: {newest: true, allowed: true, held: [versions]}: the newest version on FinCom's signed list goes to every
// computer by itself, unless the firm's owner held it (or withdrew it); release: {version, allowed: true, rollback: true}:
// the owner rolled the bridge back to that version (ownerRollback below; nothing newer installs meanwhile). An older
// cloud's release: {version, allowed} (plan item 12, the staged release) works as before. Without a release in the last
// answer (none named, an older cloud, or no answer yet) nothing is installed
var (
	relMu   sync.Mutex
	relNow  M // {version, allowed} from the last heartbeat answer; nil: none
	relSeen bool
)

func setRelease(rel M, seen bool) {
	relMu.Lock()
	relNow, relSeen = rel, seen
	relMu.Unlock()
}

// from the heartbeat's answer: its release, or none; the owner's rollback acted on (ownerRollback)
func applyRelease(j M) {
	if j == nil {
		return
	}
	setRelease(obj(j["release"]), true)
	ownerRollback(obj(j["release"]))
}

// the owner's rule of 05-Oct-2026: the firm's owner rolled FinCom Bridge back to a version (FinCom's Tally page; the beat
// says release: {version, allowed: true, rollback: true}). A bridge newer than that version which keeps exactly it as its
// previous program puts it back, as the tray's "Roll back to the previous version" does (automatic updates stay on: the
// owner's rollback holds newer versions back until the owner clears it); one that keeps another version (or none) stays
// as it is, takes no newer version, and says so once. Tried once a version while the bridge runs
var rollbackDone = map[string]bool{}

func ownerRollback(rel M) {
	if rel == nil || !truthy(rel["rollback"]) || !truthy(rel["allowed"]) {
		return
	}
	v := str(rel["version"])
	if !reBridgeVersion.MatchString(v) || v == BridgeVersion || !newerVersion(BridgeVersion, v) {
		return
	}
	relMu.Lock()
	done := rollbackDone[v]
	rollbackDone[v] = true
	relMu.Unlock()
	if done {
		return
	}
	pv := readObjFile(filepath.Join(filepath.Dir(exePathFn()), "previous-version.json"))
	if str(pv["version"]) != v {
		writeLog("The firm's owner rolled FinCom Bridge back to " + v + " (FinCom's Tally page), but this computer keeps " + or(str(pv["version"]), "no earlier version") +
			" for a rollback, so it stays on " + BridgeVersion + " and takes no newer version. To go back to " + v + " here, run the setup of " + v + ".")
		return
	}
	if _, err := rollBackBridgeBy("owner"); err != nil {
		writeLog("The firm's owner rolled FinCom Bridge back to " + v + ", but it could not be put back: " + err.Error())
	}
}

// "" when version may be installed on this computer; else why not
func releaseRefuses(version string) string {
	relMu.Lock()
	rel, seen := relNow, relSeen
	relMu.Unlock()
	switch {
	case !seen:
		return "FinCom has not answered this computer yet"
	case rel == nil:
		return "FinCom names no release for this computer"
	// the owner's rule of 05-Oct-2026: the owner's rollback holds every other version back
	case truthy(rel["rollback"]) && str(rel["version"]) != version:
		return "the firm's owner rolled FinCom Bridge back to " + str(rel["version"]) + " on FinCom's Tally page"
	// the newest version goes to every computer by itself, unless the firm's owner held it
	case truthy(rel["newest"]) && !truthy(rel["rollback"]):
		for _, h := range arr(rel["held"]) {
			if str(h) == version {
				return "the firm's owner has held version " + version + " on FinCom's Tally page"
			}
		}
		if !truthy(rel["allowed"]) {
			return "FinCom has not allowed it on this computer"
		}
		return ""
	case str(rel["version"]) != version:
		return "FinCom names version " + str(rel["version"]) + " for this computer, not " + version
	case !truthy(rel["allowed"]):
		return "FinCom has not allowed it on this computer yet (the pilot computer takes a new version first; the others after the owner approves it)"
	}
	return ""
}

// --- 2.2.0: "Roll back to the previous version" (the tray, for anyone at the computer; it asks yes/no first). An update
// that ran well keeps the program it replaced as FinComBridge.previous.exe (one, the latest; before 2.2.0 it was
// deleted), with its version in previous-version.json. The rollback puts it back the way an update that does not start
// is undone (win_service.go undoFailedUpdate): the running program renamed aside (FinComBridge.rolledback.exe), the
// previous one put in its place, then the bridge starts again. Automatic updates are turned off on this computer
// (NoAutoUpdate), else the previous version would take the newer one again at once. (putBackOldBridge, the uninstall's
// step, puts back bridge 1.15.0's TDSBridge.ps1; it is not this.)
var (
	exePathFn       = func() string { e, _ := os.Executable(); return e }
	rollbackRestart = func() { time.Sleep(time.Second); requestStop(3) }
)

func previousExe(dir string) string { return filepath.Join(dir, "FinComBridge.previous.exe") }

// the SHA-256 of a file as hex ("" when it cannot be read)
func fileSHA256(f string) string {
	b, err := os.ReadFile(f)
	if err != nil {
		return ""
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// after an update ran well (updateHealth): FinComBridge.old.exe kept as FinComBridge.previous.exe, with the SHA-256 the
// update recorded while that program was the running one (update-pending.json, review H2)
func keepPreviousVersion(dir, from string) {
	pend := readObjFile(filepath.Join(dir, "update-pending.json"))
	sum := str(pend["sha256"])
	if truthy(pend["rollback"]) {
		// round 2 R2-7: after a rollback the program left is the newer one: not kept as "the previous version"
		_ = os.Remove(filepath.Join(dir, "FinComBridge.old.exe"))
		writeLog("Rollback: the version rolled back from (" + or(from, "not known") + ") is not kept as the previous version")
		return
	}
	old := filepath.Join(dir, "FinComBridge.old.exe")
	if !exists(old) {
		return
	}
	prev := previousExe(dir)
	_ = os.Remove(prev)
	if err := os.Rename(old, prev); err != nil {
		_ = os.Remove(old)
		writeLog("Update: the previous version could not be kept for a rollback: " + err.Error())
		return
	}
	_ = saveFile(filepath.Join(dir, "previous-version.json"), jsonText(M{"version": from, "at": nowS(), "sha256": sum}))
	writeLog("Update: the previous version (" + or(from, "not known") + ") is kept for \"Roll back to the previous version\"")
}

// the tray's yes/no: the version it would go back to
func rollbackPreview() (M, error) {
	exe := exePathFn()
	dir := filepath.Dir(exe)
	fi, err := os.Lstat(previousExe(dir))
	if exe == "" || err != nil || !fi.Mode().IsRegular() {
		return nil, errors.New("No previous version is kept on this computer (one is kept from the next update on).")
	}
	pv := readObjFile(filepath.Join(dir, "previous-version.json"))
	v := str(pv["version"])
	// review H2: the kept program must be the one recorded when it was kept (its SHA-256), and signed when updates must be
	if want := str(pv["sha256"]); want == "" || fileSHA256(previousExe(dir)) != want {
		return nil, errors.New("The kept previous version has changed since it was kept (or was kept without its fingerprint), so it is not put back. Nothing was changed. Run the setup of the version you want instead.")
	}
	if cfgB("RequireSignedUpdates") {
		b, _ := os.ReadFile(previousExe(dir))
		if err := checkCodeSignature(b); err != nil {
			return nil, errors.New("The kept previous version is not signed by FinCom (" + err.Error() + "), so it is not put back. Nothing was changed.")
		}
	}
	return M{"ok": true, "version": v, "confirm": "Roll FinCom Bridge back from " + BridgeVersion + " to " + or(v, "the previous version") + "?\n\n" +
		"The bridge stops, the previous program is put back and starts in a few seconds. Automatic updates are turned off on this computer until FinCom support turns them on again. " +
		"A posting going on resumes after the restart; nothing is posted twice."}, nil
}

func rollBackBridge() (M, error) { return rollBackBridgeBy("tray") }

// by: "tray" (anyone at the computer: automatic updates are then turned off) or "owner" (the firm's owner on FinCom's
// Tally page: they stay on, the owner's rollback holds newer versions back)
func rollBackBridgeBy(by string) (M, error) {
	pv, err := rollbackPreview()
	if err != nil {
		return nil, err
	}
	exe := exePathFn()
	dir := filepath.Dir(exe)
	// review H2: set up as an update: the running program goes aside as FinComBridge.old.exe with update-pending.json,
	// so a previous version that does not start is undone by undoFailedUpdate (three starts) and this one comes back;
	// a copy stays as FinComBridge.rolledback.exe
	// round 2 R2-8: the kept program is moved to a private name first, hashed there, and put in place only if it matches
	pv0 := readObjFile(filepath.Join(dir, "previous-version.json"))
	chk := filepath.Join(dir, "FinComBridge.rollback-check.exe")
	_ = os.Remove(chk)
	if err := os.Rename(previousExe(dir), chk); err != nil {
		return nil, errors.New("The kept previous version could not be taken: " + err.Error())
	}
	if fileSHA256(chk) != str(pv0["sha256"]) {
		_ = os.Rename(chk, previousExe(dir))
		return nil, errors.New("The kept previous version has changed since it was kept, so it is not put back. Nothing was changed.")
	}
	old := filepath.Join(dir, "FinComBridge.old.exe")
	cur := fileSHA256(exe)
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		_ = os.Rename(chk, previousExe(dir))
		return nil, errors.New("The program could not be moved aside: " + err.Error())
	}
	if err := os.Rename(chk, exe); err != nil {
		_ = os.Rename(old, exe)
		_ = os.Rename(chk, previousExe(dir))
		return nil, errors.New("The previous version could not be put back: " + err.Error())
	}
	if b, err := os.ReadFile(old); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "FinComBridge.rolledback.exe"), b, 0o755)
	}
	_ = saveFile(filepath.Join(dir, "update-pending.json"), jsonText(M{"from": BridgeVersion, "at": nowS(), "starts": 0, "rollback": true, "sha256": cur}))
	_ = saveFile(filepath.Join(dir, "update-undone.json"), jsonText(M{"version": BridgeVersion, "back": str(pv["version"]), "at": nowS(), "by": by}))
	if by == "owner" {
		writeLog("Rolled back from " + BridgeVersion + " to " + or(str(pv["version"]), "the previous version") + " by the firm's owner (FinCom's Tally page); starting again")
	} else {
		setCfg("NoAutoUpdate", true)
		saveConfig()
		writeLog("Rolled back from " + BridgeVersion + " to " + or(str(pv["version"]), "the previous version") + " from the tray icon; automatic updates are off on this computer (NoAutoUpdate); starting again")
	}
	go rollbackRestart()
	return M{"ok": true, "version": str(pv["version"])}, nil
}

// 2.2.0, round 2 R2-4: the setup's copy of the program it replaced. The setup copies FinComBridge.exe to
// FinComBridge.previous.new and keeps the replaced program as FinComBridge.setup-old.exe; the install step (this) takes
// the copy only when its SHA-256 equals the replaced program's (a whole copy), the replaced program is not the one now
// installed (a reinstall of the same program keeps the kept pair), and the replaced program's own version can be read
// (it is asked: "FinComBridge.exe version"; the registry is not trusted). Only then the kept pair (previous.exe and
// previous-version.json) is replaced; otherwise it stays as it was. Both temporary files go either way
var exeVersionFn = func(path string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, path, "version")
	hideWindow(c)
	out, err := c.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

var reBridgeVersion = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func notePreviousFromSetup(dir string) {
	nw, old, cur := filepath.Join(dir, "FinComBridge.previous.new"), filepath.Join(dir, "FinComBridge.setup-old.exe"), filepath.Join(dir, "FinComBridge.exe")
	defer func() { _ = os.Remove(nw); _ = os.Remove(old) }()
	if !exists(nw) {
		return
	}
	h := fileSHA256(nw)
	switch {
	case h == "" || h != fileSHA256(old):
		installLogFn("Install: the copy of the program replaced is not whole (its fingerprint differs); the version kept for a rollback is left as it was")
		return
	case h == fileSHA256(cur):
		return // the same program installed again: the kept pair stays
	}
	v := exeVersionFn(old)
	if v == BridgeVersion {
		// round 3 R3-3: another build of the same version (not the same bytes): not a version to roll back to
		installLogFn("Install: the program replaced is the same version (" + v + ") as the one installed, another build of it: it is not kept for a rollback; the version kept is left as it was")
		return
	}
	if !reBridgeVersion.MatchString(v) {
		installLogFn("Install: the version of the program replaced could not be read (" + or(v, "no answer") + "); the version kept for a rollback is left as it was")
		return
	}
	if err := os.Rename(nw, previousExe(dir)); err != nil {
		installLogFn("Install: the program replaced could not be kept for a rollback: " + err.Error())
		return
	}
	_ = saveFile(filepath.Join(dir, "previous-version.json"), jsonText(M{"version": v, "at": nowS(), "by": "setup", "sha256": h}))
	installLogFn("Install: FinCom Bridge " + v + " is kept for \"Roll back to the previous version\"")
}

// the install log (win_service.go installLog) where there is one; the bridge's log otherwise
var installLogFn = func(s string) { writeLog(s) }

// --- review S4: whether automatic updates are on, and the last rollback, go in the beat; FinCom's answer (the owner's
// action, autoUpdateOn: true, top-level or in release) turns them on again
func autoUpdateBeat() (bool, M) {
	return !cfgB("NoAutoUpdate"), readObjFile(filepath.Join(filepath.Dir(exePathFn()), "update-undone.json"))
}

func applyAutoUpdateOn(j M) {
	if j == nil || !(truthy(j["autoUpdateOn"]) || truthy(obj(j["release"])["autoUpdateOn"])) || !cfgB("NoAutoUpdate") {
		return
	}
	setCfg("NoAutoUpdate", false)
	saveConfig()
	writeLog("Automatic updates turned on again by FinCom (the owner's choice on the Tally page)")
}
