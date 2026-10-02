// FinComBridge.exe sendlog [--fincom URL] [--quiet]: the install log to FinCom support, from the setup's last page (when
// something failed) or the tray ("Send install log to FinCom"). A zip of install.log (and the service's, and
// install-result.txt), the last 300 lines of the bridge's log and the settings without their keys goes to FinCom's cloud
// as a support pack ("install log"), with this computer's key from the settings (this bridge's own, or bridge 1.15.0's).
// Never connected to FinCom (no key): the Tally page in FinCom opens, where install.log can be dropped by hand, and the
// folder with install.log opens beside it.
package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// settings names whose values are keys: never sent, never shown
func secretSetting(k string) bool {
	return re(`(?i)(^key$|key$|keygo$|password|passwd|secret|token)`).MatchString(k)
}

// a settings file as text, with every key's value taken out (the names stay, so support sees what is set)
func settingsWithoutKeys(text string) string {
	o := newOrdered()
	if o.UnmarshalText(text) != nil {
		return "(the settings file could not be read)"
	}
	for _, k := range o.keys {
		if secretSetting(k) && str(o.Get(k)) != "" {
			o.Set(k, "(removed)")
		}
	}
	b, _ := o.MarshalJSON()
	return string(b)
}

// the last n lines of a text
func lastLines(t string, n int) string {
	l := strings.Split(strings.ReplaceAll(t, "\r\n", "\n"), "\n")
	if len(l) > n {
		l = l[len(l)-n:]
	}
	return strings.Join(l, "\r\n")
}

// the end of a file, at most max bytes
func fileTail(f string, max int64) string {
	b, err := os.ReadFile(f)
	if err != nil {
		return ""
	}
	if int64(len(b)) > max {
		b = b[int64(len(b))-max:]
	}
	return string(b)
}

// the setup's logs: this user's, and the service's (in ProgramData)
func installLogs() []string {
	var o []string
	if d := userInstallDir(); d != "" {
		o = append(o, filepath.Join(d, "install.log"))
	}
	if p := os.Getenv("ProgramData"); p != "" {
		o = append(o, filepath.Join(p, "FinCom Bridge", "install.log"))
	}
	return o
}

// the settings files that may hold this computer's key: the bridge's own, then the others in its folder
func settingsFiles() []string {
	var o []string
	for _, f := range []string{ConfigPath, filepath.Join(Home, "go-bridge.config.json"), filepath.Join(Home, "tds-bridge.config.json")} {
		if f != "" && exists(f) && !containsFold(o, f) {
			o = append(o, f)
		}
	}
	return o
}
func containsFold(a []string, s string) bool {
	for _, x := range a {
		if strings.EqualFold(filepath.Clean(x), filepath.Clean(s)) {
			return true
		}
	}
	return false
}

// the support pack: a zip, in memory
func supportZip(files []string, bridgeLog string) ([]byte, error) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	add := func(name, text string) error {
		w, err := z.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(text))
		return err
	}
	for i, f := range installLogs() {
		if exists(f) {
			name := "install.log"
			if i > 0 {
				name = "install-service.log"
			}
			if err := add(name, fileTail(f, 2<<20)); err != nil {
				return nil, err
			}
		}
	}
	if d := userInstallDir(); d != "" && exists(filepath.Join(d, "install-result.txt")) {
		_ = add("install-result.txt", readText(filepath.Join(d, "install-result.txt")))
	}
	if bridgeLog != "" && exists(bridgeLog) {
		_ = add("bridge-log-last-300-lines.txt", lastLines(fileTail(bridgeLog, 1<<20), 300))
	}
	for _, f := range files {
		_ = add("settings-"+filepath.Base(f), settingsWithoutKeys(readText(f)))
	}
	exe, _ := os.Executable()
	_ = add("about.txt", strings.Join([]string{
		"FinCom Bridge " + BridgeVersion + " (" + runtime.GOOS + ")",
		"Program: " + exe,
		"Computer: " + computerName(),
		"Windows: " + windowsVersion(),
		"User: " + ownerName(),
		"Settings: " + ConfigPath,
		"Sent: " + time.Now().Format("2006-01-02 15:04:05"),
	}, "\r\n"))
	if err := z.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

func sendLogCmd(args []string) int {
	logEcho = false
	quiet := contains(args, "--quiet")
	tell := func(title, text string, warn bool) {
		fmt.Println(text)
		if !quiet {
			showMessage(title, text, warn)
		}
	}
	loadConfigRO()
	fincom := flagValue(args, "fincom")
	if fincom == "" {
		fincom = fincomURL()
	}
	files, bridgeLog := settingsFiles(), logFile()
	// the key: the bridge's own settings first, else bridge 1.15.0's (both read as this Windows user, who can open them)
	found := false
	for _, f := range files {
		o := newOrdered()
		if o.UnmarshalText(readText(f)) != nil || str(o.Get("CloudUrl")) == "" {
			continue
		}
		cfgMu.Lock()
		Cfg = o
		cfgMu.Unlock()
		if cloudKey() != "" {
			found = true
			break
		}
	}
	inst := ""
	if l := installLogs(); len(l) > 0 {
		inst = l[0]
	}
	if !found {
		u := strings.TrimRight(fincom, "/") + "/#/tally"
		openURL(u)
		if inst != "" {
			showInFolder(inst)
		}
		tell("FinCom Bridge", "This computer is not connected to FinCom yet. The Tally page in FinCom has opened: drop install.log (shown in the folder) on 'Send an install log'.", true)
		return 2
	}
	z, err := supportZip(files, bridgeLog)
	if err == nil && len(z) > 9<<20 {
		err = fmt.Errorf("the logs are too large to send (%d MB)", len(z)>>20)
	}
	var r cloudResp
	if err == nil {
		r = invokeCloud(M{"kind": "support", "zip": base64.StdEncoding.EncodeToString(z), "note": "install log"}, 120)
		if r.code != 200 {
			err = fmt.Errorf("%s", r.err)
		}
	}
	if err != nil {
		if inst != "" {
			showInFolder(inst)
		}
		tell("FinCom Bridge", "The install log could not be sent to FinCom support: "+err.Error()+"\n\nIt is "+inst+" (shown in the folder): send it to FinCom support by email.", true)
		return 1
	}
	tell("FinCom Bridge", "Sent to FinCom support (reference "+str(r.json["path"])+")", false)
	return 0
}
