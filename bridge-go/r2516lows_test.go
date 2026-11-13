//go:build !windows

package main

// FinCom Bridge 2.5.16, the 2.5.16 review's lows: /forget with the single key of earlier versions says plainly that it
// disconnects every browser paired before 2.5.16; the FVU's return file is capped and its name never a device name;
// a company name Windows keeps for itself gets no folder; the tray icon of the service install keeps its own log.
// Nothing here asks anything of Tally. Made-up names only.
import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestR2516ForgetOldKeySaysAll(t *testing.T) {
	newPairStand(t, "")
	q := r2516Req("POST", "/forget", "k246")
	if q.Code != 200 || !strings.Contains(q.Body.String(), "Every browser connected before FinCom Bridge 2.5.16 is disconnected") {
		t.Fatalf("forget with the old key: %d %s", q.Code, q.Body.String())
	}
	if r2516Call("/status", "k246", "GET") == 200 {
		t.Fatal("the old key still works")
	}
}

func TestR2516FvuCapsAndDeviceNames(t *testing.T) {
	_, _, javaLog := r2516FvuHere(t)
	r2516Confirm(t)
	if r := invokeFvu(M{"text": strings.Repeat("x", fvuMaxText+1), "name": "a.txt"}); r["ok"] == true || exists(javaLog) {
		t.Fatalf("a return file over the cap: %v", r)
	}
	if r := invokeFvu(M{"text": "x", "name": "CON.txt"}); r["accepted"] != true || !strings.HasSuffix(str(r["input"]), "return.txt") {
		t.Fatalf("a device name: %v", r)
	}
	for _, n := range []string{"CON", "nul", "COM3", "LPT1.txt", "Aux."} {
		if _, err := safeName(n); err == nil {
			t.Errorf("company %q got a folder", n)
		}
	}
	if n, err := safeName("ZZ HERON CO"); err != nil || n != "ZZ HERON CO" {
		t.Fatalf("a plain name: %q %v", n, err)
	}
}

func TestR2516TrayLogOverride(t *testing.T) {
	dir := t.TempDir()
	r2515LogHere(t, dir)
	logFileOverride = filepath.Join(dir, "tray.log")
	t.Cleanup(func() { logFileOverride = "" })
	writeLog("from the tray (stand)")
	if !strings.Contains(readText(filepath.Join(dir, "tray.log")), "from the tray") || strings.Contains(readText(filepath.Join(dir, "b.log")), "from the tray") {
		t.Fatal("the tray's line went to the bridge's log")
	}
	_ = os.Remove(filepath.Join(dir, "tray.log"))
}
