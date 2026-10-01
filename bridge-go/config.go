// The settings (tds-bridge.config.json, as the PowerShell bridge keeps them) and the log.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var reMu sync.Mutex

// Ordered is a JSON object that keeps its keys in order, so the settings file reads as before
type Ordered struct {
	keys []string
	vals map[string]any
}

func newOrdered() *Ordered          { return &Ordered{vals: map[string]any{}} }
func (o *Ordered) Get(k string) any { return o.vals[k] }
func (o *Ordered) Has(k string) bool {
	_, ok := o.vals[k]
	return ok
}
func (o *Ordered) Set(k string, v any) {
	if _, ok := o.vals[k]; !ok {
		o.keys = append(o.keys, k)
	}
	o.vals[k] = v
}
func (o *Ordered) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteString("{\n")
	for i, k := range o.keys {
		kb, _ := json.Marshal(k)
		vb, err := json.MarshalIndent(o.vals[k], "  ", "  ")
		if err != nil {
			return nil, err
		}
		b.WriteString("  ")
		b.Write(kb)
		b.WriteString(": ")
		b.Write(vb)
		if i < len(o.keys)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}")
	return b.Bytes(), nil
}
func (o *Ordered) UnmarshalText(s string) error {
	d := json.NewDecoder(strings.NewReader(strings.TrimPrefix(s, "\ufeff")))
	d.UseNumber()
	t, err := d.Token()
	if err != nil {
		return err
	}
	if t != json.Delim('{') {
		return fmt.Errorf("not an object")
	}
	for d.More() {
		kt, err := d.Token()
		if err != nil {
			return err
		}
		var v any
		if err := d.Decode(&v); err != nil {
			return err
		}
		o.Set(kt.(string), normNumbers(v))
	}
	return nil
}

// --- the running bridge's settings
var (
	cfgMu      sync.Mutex
	Cfg        = newOrdered()
	ConfigPath string
	Home       string // the bridge's folder (the PowerShell bridge's $PSScriptRoot)
)

func cfg(k string) any {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	return Cfg.Get(k)
}
func cfgS(k string) string { return str(cfg(k)) }
func cfgB(k string) bool   { return truthy(cfg(k)) }
func setCfg(k string, v any) {
	cfgMu.Lock()
	Cfg.Set(k, v)
	cfgMu.Unlock()
}

// Get-KeepNum: a whole number above 0 from the settings, else the default
func keepNum(k string, def int) int {
	v := toInt(cfg(k))
	if v > 0 {
		return v
	}
	return def
}

func newBridgeKey() string {
	chars := "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	out := make([]byte, 24)
	for i, x := range b {
		out[i] = chars[int(x)%len(chars)]
	}
	return string(out)
}

func defaultSettings() *Ordered {
	d := newOrdered()
	d.Set("Port", float64(9100))
	d.Set("TallyHost", "127.0.0.1")
	d.Set("TallyPorts", "auto")
	d.Set("OnlyMySession", true)
	d.Set("PairWindowMin", float64(15))
	d.Set("GentleMs", float64(150))
	d.Set("StatusCacheSec", float64(30))
	d.Set("FallbackPorts", []any{float64(9000), float64(9001), float64(9002), float64(9003), float64(9004), float64(9005)})
	d.Set("TallyTimeoutSec", float64(120))
	d.Set("Key", "")
	d.Set("LogFile", filepath.Join(Home, "tds-bridge.log"))
	d.Set("AllowImport", true)
	d.Set("SyncDir", "")
	d.Set("SyncCompanies", []any{})
	d.Set("AllowedOrigins", []any{"https://app.fincom.live", "https://staging.fincom.live", "https://caanshulgarg.github.io", "http://localhost", "null"})
	d.Set("KeepInStep", nil)
	d.Set("CloudUrl", "")
	d.Set("CloudKey", "")
	d.Set("KeepSchedule", "")
	d.Set("KeepDailyAt", "")
	return d
}

// loadConfig reads the settings; settings added in a newer version are written into an older file
func loadConfig() {
	d := defaultSettings()
	need := false
	if exists(ConfigPath) {
		o := newOrdered()
		if err := o.UnmarshalText(readText(ConfigPath)); err != nil {
			fmt.Println("  The settings file could not be read (" + err.Error() + "). Starting with the standard settings.")
			need = true
		} else {
			for _, k := range d.keys {
				if !o.Has(k) {
					need = true
				}
			}
			for _, k := range o.keys {
				d.Set(k, o.Get(k))
			}
		}
	} else {
		need = true
	}
	if str(d.Get("Key")) == "" {
		d.Set("Key", newBridgeKey())
		need = true
	}
	cfgMu.Lock()
	Cfg = d
	cfgMu.Unlock()
	if need {
		saveConfig()
	}
}

// loadConfigRO: the settings read for the tray and the compare tool, which never write them (the service does)
func loadConfigRO() {
	d := defaultSettings()
	o := newOrdered()
	if o.UnmarshalText(readText(ConfigPath)) == nil {
		for _, k := range o.keys {
			d.Set(k, o.Get(k))
		}
	}
	cfgMu.Lock()
	Cfg = d
	cfgMu.Unlock()
}

var cfgStamp time.Time

func saveConfig() {
	cfgMu.Lock()
	b, err := json.Marshal(Cfg)
	cfgMu.Unlock()
	if err != nil {
		writeLog("Could not save the settings: " + err.Error())
		return
	}
	if err := saveFile(ConfigPath, string(b)); err != nil {
		writeLog("Could not save the settings: " + err.Error())
		return
	}
	if t, ok := mtime(ConfigPath); ok {
		cfgStamp = t
	}
}

// settings changed by hand (or by FinCom's setup) while the bridge runs are read again (Sync-WorkerConfig)
func syncConfig() {
	t, ok := mtime(ConfigPath)
	if !ok || t.Equal(cfgStamp) {
		return
	}
	cfgStamp = t
	o := newOrdered()
	if err := o.UnmarshalText(readText(ConfigPath)); err != nil {
		return
	}
	cfgMu.Lock()
	for _, k := range o.keys {
		Cfg.Set(k, o.Get(k))
	}
	cfgMu.Unlock()
}

// --- the log: never holds keys, codes or passwords; rotated at 5 MB keeping 5 old copies
var logMu sync.Mutex

func protectLogText(msg string) string {
	m := re(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+`).ReplaceAllString(msg, "Bearer ***")
	m = re(`(?i)\b(key|token|password|passwd|secret|code|authorization|x-tds-key)("?\s*[:=]\s*"?)[^\s",;&<]+`).ReplaceAllString(m, "${1}${2}***")
	m = re(`\btdsd_[0-9a-f]{16,}\b`).ReplaceAllString(m, "tdsd_***")
	m = re(`\bfcd_[0-9a-f]{16,}\b`).ReplaceAllString(m, "fcd_***")
	if k := cfgS("Key"); len(k) >= 8 {
		m = strings.ReplaceAll(m, k, "***")
	}
	return m
}

func logFile() string {
	f := cfgS("LogFile")
	if f == "" {
		f = filepath.Join(Home, "tds-bridge.log")
	}
	return f
}

var logEcho = true

func writeLog(msg string) {
	line := time.Now().Format("2006-01-02 15:04:05") + "  " + protectLogText(msg)
	logMu.Lock()
	defer logMu.Unlock()
	if logEcho {
		fmt.Println(line)
	}
	f := logFile()
	if fi, err := os.Stat(f); err == nil && fi.Size() > 5*1024*1024 {
		for i := 4; i >= 1; i-- {
			if exists(fmt.Sprintf("%s.%d", f, i)) {
				_ = os.Rename(fmt.Sprintf("%s.%d", f, i), fmt.Sprintf("%s.%d", f, i+1))
			}
		}
		_ = os.Rename(f, f+".1")
	}
	_ = appendText(f, line+"\r\n")
}
