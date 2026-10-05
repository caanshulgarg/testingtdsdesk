// Which bridge this is, for FinCom's cloud, and which bridge on the computer posts.
//
// Every call to FinCom's cloud carries body.bridge: this install's own id ("go-" and 12 hex, kept in the settings as
// InstanceId, made once), the computer, the Windows user it works for, test or main, how it runs and its version.
// FinCom tells the bridges on one computer key apart by it (bridge 1.15.0 sends none), lists them on its Tally page and
// gives postings only to the main one. A bridge that is not the main one is answered "notMain": it then reads only.
// A test bridge becomes the main one from its tray menu (Switch to main bridge) or from FinCom's Tally page (the
// heartbeat's answer says makeMain): it then installs itself again in sole mode, exactly as the setup would.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

func validInstanceID(s string) bool { return re(`^[0-9a-f]{12}$`).MatchString(s) }
func newInstanceID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var (
	tempIDOnce sync.Once
	tempID     string
)

// this install's id: from the settings (loadConfig writes one the first time); settings read only (the tray, sendlog)
// without one get one for this run only
func instanceID() string {
	if id := cfgS("InstanceId"); validInstanceID(id) {
		return id
	}
	tempIDOnce.Do(func() { tempID = newInstanceID() })
	return tempID
}

func bridgeIdentity() M {
	mode := "main"
	if testMode() {
		mode = "test"
	}
	return M{"id": "go-" + instanceID(), "computer": computerName(), "user": ownerName(), "mode": mode, "runMode": runMode, "version": BridgeVersion, "port": toInt(cfg("Port"))}
}

// the install keeps the id: a test install switched to main (its settings are then bridge 1.15.0's file) stays the same
// bridge for FinCom, which made it the main one by that id. from: other settings files to take it from
func carryInstanceID(c *Ordered, from ...string) {
	if validInstanceID(str(c.Get("InstanceId"))) {
		return
	}
	for _, f := range from {
		o := newOrdered()
		if o.UnmarshalText(readText(f)) == nil && validInstanceID(str(o.Get("InstanceId"))) {
			c.Set("InstanceId", str(o.Get("InstanceId")))
			return
		}
	}
	c.Set("InstanceId", newInstanceID())
}

// --- another bridge is the main one (FinCom answered notMain): this one reads only. Said once in the log, not every beat
var (
	notMainMu   sync.Mutex
	notMainAt   time.Time
	notMainWhy  string
	notMainBeat bool // the heartbeat said so (and the heartbeat clears it)
	notMainTold bool
)

const notMainText = "FinCom says another bridge is the main bridge on this computer (chosen in FinCom), so this one reads Tally but does not post."

func noteNotMain(why string, fromBeat bool) {
	if why == "" {
		why = notMainText
	}
	notMainMu.Lock()
	defer notMainMu.Unlock()
	notMainAt, notMainWhy = time.Now(), why
	notMainBeat = notMainBeat || fromBeat
	if !notMainTold {
		notMainTold = true
		writeLog("Not the main bridge: " + why)
	}
}

// the heartbeat answered without notMain: this bridge may post again (an older cloud never says notMain on the heartbeat:
// a refusal of posts_take then stands for ten minutes)
func clearNotMainByBeat() {
	notMainMu.Lock()
	defer notMainMu.Unlock()
	if notMainAt.IsZero() || !notMainBeat {
		return
	}
	notMainAt, notMainBeat, notMainTold = time.Time{}, false, false
	writeLog("FinCom: this is the main bridge again; it posts")
}

// why this bridge does not post because of FinCom's answer ("" when FinCom has not refused it lately)
func notMainNow() string {
	notMainMu.Lock()
	defer notMainMu.Unlock()
	if notMainAt.IsZero() || time.Since(notMainAt) > 10*time.Minute {
		return ""
	}
	return notMainWhy
}

// --- switching to main (tray "Switch to main bridge...", or makeMain in the heartbeat's answer): once
var (
	switching    atomic.Bool
	makeMainSeen atomic.Bool // the heartbeat's makeMain is acted on once
)

// tellCloud: call make_main first, so FinCom refuses bridge 1.15.0's postings at once (made on FinCom's Tally page, FinCom
// knows already). Then the program's own install in sole mode runs, detached, exactly as the setup would run it: it stops
// bridge 1.15.0 for the user, carries the settings and starts this bridge again on port 9100.
func switchToMain(tellCloud bool) error {
	if !testMode() {
		return errors.New("This FinCom Bridge is the main bridge already.")
	}
	if runMode != "user" && runMode != "service" {
		return errors.New("This bridge was started by hand (in a window), so it cannot install itself. Run the FinCom Bridge setup and choose \"Replace bridge 1.15.0\".")
	}
	if !switching.CompareAndSwap(false, true) {
		return errors.New("Switching to the main bridge has started already.")
	}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("Switching to the main bridge: ", r))
				switching.Store(false)
			}
		}()
		if tellCloud && cloudOn() {
			if r := invokeCloud(M{"kind": "make_main"}, 30); r.code == 200 {
				writeLog("FinCom: this bridge is now the main bridge on this computer; bridge 1.15.0's postings are refused from now on")
			} else {
				writeLog("Switching to the main bridge: FinCom's cloud could not be told now (" + r.err + "); the switch goes on")
			}
		}
		writeLog("Switching to the main bridge: installing again in sole mode (bridge 1.15.0 is stopped; its pairing, settings and copy are kept)")
		if err := platSwitchToMain(fincomURL()); err != nil {
			writeLog("Switching to the main bridge did not start: " + err.Error())
			switching.Store(false)
		}
	}()
	return nil
}

// --- the setup's own files, in the folder of the Windows user running it: %LOCALAPPDATA%\FinCom Bridge
func userInstallDir() string {
	if la := localAppData(); la != "" {
		return filepath.Join(la, "FinCom Bridge")
	}
	return ""
}

// install-result.txt, read by the setup for its last page: "ok", or line 1 what went wrong and line 2 what to do
func installResultText(reason, todo string) string {
	if reason == "" {
		return "ok\r\n"
	}
	one := func(s string) string { return re(`\s*[\r\n]+\s*`).ReplaceAllString(s, " ") }
	if todo == "" {
		todo = "Run the setup again; if it fails again, send the install log to FinCom."
	}
	return one(reason) + "\r\n" + one(todo) + "\r\n"
}
func writeInstallResult(reason, todo string) {
	if d := userInstallDir(); d != "" {
		_ = saveFile(filepath.Join(d, "install-result.txt"), installResultText(reason, todo))
	}
}

// --- the setup made this the only bridge (02-Oct-2026: FinCom Bridge is the only bridge): it tells FinCom on its first
// contact that it is the main bridge on this computer, with no click; FinCom then gives postings to it alone. Once done
// (or refused for good) the setting is cleared; while FinCom cannot be reached it is tried again at each heartbeat
var claimLogged atomic.Bool

func claimMainOnce() {
	if testMode() || !cfgB("ClaimMain") {
		return
	}
	r := invokeCloud(M{"kind": "make_main"}, 30)
	switch {
	case r.code == 200:
		writeLog("FinCom: this bridge is now the main bridge on this computer (set by the setup); it reads and posts")
	case r.code >= 400 && r.code < 500:
		writeLog("FinCom could not make this the main bridge (" + r.err + "); with no main bridge chosen it posts anyway")
	default:
		if claimLogged.CompareAndSwap(false, true) {
			writeLog("FinCom could not be told yet that this is the main bridge (" + r.err + "); tried again at each heartbeat")
		}
		return
	}
	setCfg("ClaimMain", false)
	saveConfig()
	clearNotMainByBeat()
}
