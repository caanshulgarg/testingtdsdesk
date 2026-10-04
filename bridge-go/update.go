// Updates from FinCom. 2.1.5: an update is installed only when FinCom's heartbeat answer allows that version on this
// computer (release: {version, allowed}; see setRelease below). The list of updates (latest.json) is signed by FinCom with the same key as the FinCom Connector's
// (RSA, SHA-256; latest.json.sig): a list without a good signature is refused. The new program must match the SHA-256
// in the list, and, when the list asks for it (requireSignature) or the settings do (RequireSignedUpdates), carry a valid
// Windows code signature: ready for when the program is signed. The service puts the new program in place and starts
// again; if the new one does not start properly, the previous one is put back.
package main

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

func fetch(u string, max int64) ([]byte, error) {
	c := &http.Client{Timeout: 5 * time.Minute, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
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
		return updateInfo()
	}
	// only the version FinCom allowed this computer (nothing is downloaded otherwise)
	if why := releaseRefuses(ver); why != "" {
		setUpd("message", "Version "+ver+" is available but not approved for this computer yet ("+why+"); nothing was changed.")
		writeLog("Update " + ver + ": FinCom has not approved it for this computer yet (" + why + "); nothing changed")
		return updateInfo()
	}
	if !strings.HasPrefix(u, "https://") && !(os.Getenv("FINCOM_TEST") == "1") {
		setUpd("message", "The update's address is not secure, so it was not used.")
		return updateInfo()
	}
	exeB, err := fetch(u, 200<<20)
	if err != nil {
		setUpd("message", "The update could not be downloaded: "+err.Error())
		return updateInfo()
	}
	h := sha256.Sum256(exeB)
	if hex.EncodeToString(h[:]) != want {
		setUpd("message", "The downloaded update does not match FinCom's list (SHA-256), so it was not used.")
		writeLog("Update " + ver + ": the download does not match its SHA-256; not used")
		return updateInfo()
	}
	if truthy(b["requireSignature"]) || cfgB("RequireSignedUpdates") {
		if err := checkCodeSignature(exeB); err != nil {
			setUpd("message", "The update is not signed by FinCom ("+err.Error()+"), so it was not used.")
			writeLog("Update " + ver + ": no valid code signature; not used")
			return updateInfo()
		}
	}
	exe, _ := os.Executable()
	writeLog("Update: putting FinCom Bridge " + ver + " in place of " + BridgeVersion)
	if err := applyUpdateFn(exe, exeB); err != nil {
		setUpd("message", "The update could not be put in place: "+err.Error())
		writeLog("Update " + ver + " could not be put in place: " + err.Error())
		return updateInfo()
	}
	setUpd("applying", true)
	setUpd("message", "Updating to "+ver+"; the bridge starts again in a few seconds.")
	go restartAfterUpdate()
	return updateInfo()
}

// putting the new program in place and starting again (the tests put their own)
var (
	applyUpdateFn      = applyUpdate
	restartAfterUpdate = func() { time.Sleep(time.Second); requestStop(3) }
)

func updateLoop() {
	sleepOrStop(2 * time.Minute)
	for !stopping() {
		if !cfgB("NoAutoUpdate") {
			func() {
				defer func() { recover() }()
				checkForUpdate(false)
			}()
		}
		sleepOrStop(time.Duration(keepNum("UpdateCheckHours", 6)) * time.Hour)
	}
}

// --- the staged release (plan item 12): no update installs by itself. FinCom's heartbeat answer names the version this
// computer may take, release: {version, allowed}: the pilot computer is allowed a new version first, every other one
// only after the owner approves it. Without a release in the last answer (none named, an older cloud, or no answer
// yet) nothing is installed
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

// from the heartbeat's answer: its release, or none
func applyRelease(j M) {
	if j == nil {
		return
	}
	setRelease(obj(j["release"]), true)
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

// after an update ran well (updateHealth): FinComBridge.old.exe kept as FinComBridge.previous.exe
func keepPreviousVersion(dir, from string) {
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
	_ = saveFile(filepath.Join(dir, "previous-version.json"), jsonText(M{"version": from, "at": nowS()}))
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
	v := str(readObjFile(filepath.Join(dir, "previous-version.json"))["version"])
	return M{"ok": true, "version": v, "confirm": "Roll FinCom Bridge back from " + BridgeVersion + " to " + or(v, "the previous version") + "?\n\n" +
		"The bridge stops, the previous program is put back and starts in a few seconds. Automatic updates are turned off on this computer until FinCom support turns them on again. " +
		"A posting going on resumes after the restart; nothing is posted twice."}, nil
}

func rollBackBridge() (M, error) {
	pv, err := rollbackPreview()
	if err != nil {
		return nil, err
	}
	exe := exePathFn()
	dir := filepath.Dir(exe)
	bad := filepath.Join(dir, "FinComBridge.rolledback.exe")
	_ = os.Remove(bad)
	if err := os.Rename(exe, bad); err != nil {
		return nil, errors.New("The program could not be moved aside: " + err.Error())
	}
	if err := os.Rename(previousExe(dir), exe); err != nil {
		_ = os.Rename(bad, exe)
		return nil, errors.New("The previous version could not be put back: " + err.Error())
	}
	setCfg("NoAutoUpdate", true)
	saveConfig()
	_ = os.Remove(filepath.Join(dir, "update-pending.json"))
	_ = saveFile(filepath.Join(dir, "update-undone.json"), jsonText(M{"version": BridgeVersion, "back": str(pv["version"]), "at": nowS(), "by": "tray"}))
	writeLog("Rolled back from " + BridgeVersion + " to " + or(str(pv["version"]), "the previous version") + " from the tray icon; automatic updates are off on this computer (NoAutoUpdate); starting again")
	go rollbackRestart()
	return M{"ok": true, "version": str(pv["version"])}, nil
}
