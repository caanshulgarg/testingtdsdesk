// Uninstall: the bridge's own files in its folder go with it. Its folder is bridge 1.15.0's (TDS Desk Bridge), so only
// what this bridge made there is removed: its copy and postings of test mode (go-sync, go-jobs), its log
// (go-bridge.log), the shadow checks (shadow-*.json), the compare report, and its own settings. In sole mode its settings
// are bridge 1.15.0's file, which stays, unless bridge 1.15.0 never lived in that folder (this bridge made the file).
// "Keep this computer's pairing" keeps the settings with only the key FinCom pairs with and the cloud's address and key,
// so a later install connects without a new code.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// the settings with only the pairing: Key, CloudUrl, CloudKey (the key handed over from bridge 1.15.0, CloudKeyGo, is
// kept as CloudKey: the bridge opens either way of keeping it)
func pairingOnly(text string) string {
	c := newOrdered()
	if c.UnmarshalText(text) != nil {
		return ""
	}
	o := newOrdered()
	o.Set("Key", str(c.Get("Key")))
	o.Set("CloudUrl", str(c.Get("CloudUrl")))
	k := str(c.Get("CloudKeyGo"))
	if k == "" {
		k = str(c.Get("CloudKey"))
	}
	o.Set("CloudKey", k)
	b, _ := o.MarshalJSON()
	return string(b)
}

// removes the bridge's own files from its folder; returns what was removed, for the install log
func removeOwnFiles(home, mode string, keepPairing bool) []string {
	if home == "" || !exists(home) {
		return nil
	}
	var gone []string
	rm := func(p string) {
		if exists(p) && os.RemoveAll(p) == nil {
			gone = append(gone, p)
		}
	}
	oldLived := exists(filepath.Join(home, "TDSBridge.ps1")) || exists(filepath.Join(home, "TDSBridge.ps1.replaced-by-go"))
	for _, n := range []string{"go-sync", "go-jobs", "go-bridge.log", "compare-report.txt"} {
		rm(filepath.Join(home, n))
	}
	for i := 1; i <= 5; i++ {
		rm(filepath.Join(home, fmt.Sprintf("go-bridge.log.%d", i)))
	}
	var shadows []string
	_ = filepath.WalkDir(home, func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && re(`^shadow-.*\.json$`).MatchString(d.Name()) {
			shadows = append(shadows, p)
		}
		return nil
	})
	for _, p := range shadows {
		rm(p)
	}
	own := []string{filepath.Join(home, "go-bridge.config.json")}
	if mode == "sole" && !oldLived {
		own = append(own, filepath.Join(home, "tds-bridge.config.json"))
	}
	for _, f := range own {
		if !exists(f) {
			continue
		}
		if keepPairing {
			if t := pairingOnly(readText(f)); t != "" && saveFile(f, t) == nil {
				gone = append(gone, f+" (all but the pairing with FinCom)")
				continue
			}
		}
		rm(f)
	}
	return gone
}
