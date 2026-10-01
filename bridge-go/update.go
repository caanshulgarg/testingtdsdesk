// Updates from FinCom. The list of updates (latest.json) is signed by FinCom with the same key as the FinCom Connector's
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
	if err := applyUpdate(exe, exeB); err != nil {
		setUpd("message", "The update could not be put in place: "+err.Error())
		writeLog("Update " + ver + " could not be put in place: " + err.Error())
		return updateInfo()
	}
	setUpd("applying", true)
	setUpd("message", "Updating to "+ver+"; the bridge starts again in a few seconds.")
	go func() { time.Sleep(time.Second); requestStop(3) }()
	return updateInfo()
}

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
