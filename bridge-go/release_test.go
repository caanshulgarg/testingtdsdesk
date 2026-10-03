package main

// Plan item 12: no update installs by itself. FinCom's heartbeat answer names the version this computer may take
// (release: {version, allowed}); the bridge installs only that version, only when allowed, and still only with FinCom's
// signature on the list and the download's SHA-256 matching it.

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type updServer struct {
	srv       *httptest.Server
	exeGets   atomic.Int32
	mu        sync.Mutex
	applied   [][]byte
	restarted int
}

// a signed list offering version ver (sha: the program's SHA-256 as listed, "" for the right one)
func newUpdServer(t *testing.T, ver, sha string) *updServer {
	t.Helper()
	k, _ := rsa.GenerateKey(rand.Reader, 2048)
	dir := t.TempDir()
	pub := "<RSAKeyValue><Modulus>" + base64.StdEncoding.EncodeToString(k.N.Bytes()) + "</Modulus><Exponent>" + base64.StdEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes()) + "</Exponent></RSAKeyValue>"
	_ = os.WriteFile(filepath.Join(dir, "pub.xml"), []byte(pub), 0o644)
	t.Setenv("FINCOM_TEST", "1")
	t.Setenv("FINCOM_TEST_PUBKEY", filepath.Join(dir, "pub.xml"))
	exe := []byte("MZ new bridge " + ver)
	if sha == "" {
		h := sha256.Sum256(exe)
		sha = hex.EncodeToString(h[:])
	}
	u := &updServer{}
	var list []byte
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/latest.json"):
			_, _ = w.Write(list)
		case strings.HasSuffix(r.URL.Path, "/latest.json.sig"):
			h := sha256.Sum256(list)
			sig, _ := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, h[:])
			_, _ = w.Write([]byte(base64.StdEncoding.EncodeToString(sig)))
		case strings.HasSuffix(r.URL.Path, ".exe"):
			u.exeGets.Add(1)
			_, _ = w.Write(exe)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(u.srv.Close)
	list = []byte(`{"bridge":{"version":"` + ver + `","url":"` + u.srv.URL + `/u/FinComBridge-` + ver + `.exe","sha256":"` + sha + `"}}`)
	oldA, oldR := applyUpdateFn, restartAfterUpdate
	applyUpdateFn = func(exe string, b []byte) error {
		u.mu.Lock()
		u.applied = append(u.applied, b)
		u.mu.Unlock()
		return nil
	}
	restartAfterUpdate = func() { u.mu.Lock(); u.restarted++; u.mu.Unlock() }
	t.Cleanup(func() { applyUpdateFn, restartAfterUpdate = oldA, oldR })
	return u
}
func (u *updServer) nApplied() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.applied)
}

// a bridge with a stand-in cloud whose heartbeat answer carries release (absent when nil)
func releaseBridge(t *testing.T, u *updServer) *standCloud {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg()+`,"UpdateUrl":"`+u.srv.URL+`/u/"`)
	setRelease(nil, false)
	return c
}
func beatWith(c *standCloud, m M) {
	c.mu.Lock()
	c.beatReply = m
	c.mu.Unlock()
	beatOnce()
}

func TestNoUpdateWithoutApproval(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	// no heartbeat yet, and a heartbeat without a release: never installed
	for i, m := range []M{nil, {}, {"release": nil}, {"release": M{"version": "9.9.9", "allowed": false}}, {"release": M{"version": "9.9.8", "allowed": true}}} {
		if m != nil {
			beatWith(c, m)
		}
		r := checkForUpdate(false)
		if u.nApplied() != 0 || u.exeGets.Load() != 0 {
			t.Fatalf("case %d (%v): the update was downloaded or put in place", i, m)
		}
		if str(r["latest"]) != "9.9.9" || !strings.Contains(str(r["message"]), "not approved") {
			t.Fatalf("case %d: %v", i, r)
		}
	}
	// the tray's Check for updates neither
	checkForUpdate(true)
	if u.nApplied() != 0 {
		t.Fatal("installed from the tray without approval")
	}
	if logLines("Update 9.9.9: FinCom has not approved it for this computer yet") < 1 {
		t.Fatal("the log does not say why")
	}
}

func TestPilotGetsVersionFirst(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	// this computer is the pilot: FinCom allows it the version
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	r := checkForUpdate(false)
	if u.nApplied() != 1 || truthy(r["applying"]) != true {
		t.Fatalf("the pilot did not get the version: %v", r)
	}
	for i := 0; i < 100; i++ {
		u.mu.Lock()
		n := u.restarted
		u.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	u.mu.Lock()
	if string(u.applied[0]) != "MZ new bridge 9.9.9" || u.restarted != 1 {
		t.Fatalf("the program put in place: %q, restarted %d", u.applied[0], u.restarted)
	}
	u.mu.Unlock()
	// the beat said which version it runs (the cloud records the pilot from it)
	c.mu.Lock()
	if str(c.lastBeat["version"]) != BridgeVersion {
		t.Fatalf("the beat's version: %v", c.lastBeat["version"])
	}
	c.mu.Unlock()
}

func TestPilotStillChecksSignatureAndSHA(t *testing.T) {
	u := newUpdServer(t, "9.9.9", strings.Repeat("0", 64))
	c := releaseBridge(t, u)
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	r := checkForUpdate(false)
	if u.nApplied() != 0 || !strings.Contains(str(r["message"]), "SHA-256") {
		t.Fatalf("a download not matching its SHA-256 was put in place: %v", r)
	}
}

func TestOthersWaitForApproval(t *testing.T) {
	u := newUpdServer(t, "9.9.9", "")
	c := releaseBridge(t, u)
	// another computer while the pilot runs the version: the release is named, not allowed here
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": false}})
	for i := 0; i < 3; i++ {
		checkForUpdate(false)
	}
	if u.nApplied() != 0 {
		t.Fatal("installed before FinCom approved it")
	}
	// approved for everyone
	beatWith(c, M{"release": M{"version": "9.9.9", "allowed": true}})
	checkForUpdate(false)
	if u.nApplied() != 1 {
		t.Fatal("not installed after approval")
	}
	// approval taken back (the next heartbeat): no more
	beatWith(c, M{})
	checkForUpdate(false)
	if u.nApplied() != 1 {
		t.Fatal("installed again after the release left the heartbeat")
	}
}
