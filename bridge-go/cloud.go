// The copy goes to FinCom's cloud (cloud.ps1 of bridge 1.15.0): each day's day book that changed (gzip), the ledgers
// with their opening balances and groups, and the copy's state; a heartbeat; the posting queue; and the wake-up channel
// (Supabase Realtime) where FinCom's database wakes this computer the moment a posting is queued or an update asked for.
// Days waiting to go are kept in a queue on disk (cloud-out.txt in the company's folder): without internet, or with
// FinCom's cloud down, nothing is lost; it goes when it can, a little at a time.
//
// Test mode (beside bridge 1.15.0): every call says "shadow". FinCom's cloud then never hands this bridge a posting, keeps
// its heartbeat apart, and compares the days it sends with the copy bridge 1.15.0 sent instead of keeping them.
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// --- the computer's key (made in FinCom): kept protected for this Windows user (dpapi:) or, for the service, for this
// computer (dpapim:); never in the log
func cloudKey() string {
	for _, k := range []string{"CloudKeyGo", "CloudKey"} {
		v := cfgS(k)
		if v == "" {
			continue
		}
		if s := unprotectKey(v); s != "" {
			return s
		}
	}
	return ""
}
func cloudOn() bool { return cfgS("CloudUrl") != "" && cloudKey() != "" }

type cloudResp struct {
	code int
	json M
	err  string
}

var cloudHTTP = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConns: 4, IdleConnTimeout: 60 * time.Second}}

// test mode: nothing but the heartbeat goes until FinCom's cloud has answered that it keeps a test bridge's calls apart
// (an older cloud would take them as bridge 1.15.0's): shadowOK, set by the heartbeat; hello, make_main and support carry
// no books and go at once
// one call to the cloud; every call says which bridge it is (body.bridge): FinCom tells the bridges on one key apart by it
func invokeCloud(body M, timeoutSec int) cloudResp {
	body["version"] = BridgeVersion
	body["bridge"] = bridgeIdentity()
	if testMode() {
		body["shadow"] = true
		if k := str(body["kind"]); !shadowOK.Load() && k != "beat" && k != "hello" && k != "make_main" && k != "support" {
			return cloudResp{0, nil, "FinCom's cloud has not confirmed test mode yet; nothing is sent"}
		}
	}
	req, _ := http.NewRequest("POST", cfgS("CloudUrl"), strings.NewReader(jsonText(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-fincom-device", cloudKey())
	ctxC := &http.Client{Transport: cloudHTTP.Transport, Timeout: time.Duration(timeoutSec) * time.Second}
	resp, err := ctxC.Do(req)
	if err != nil {
		return cloudResp{0, nil, plainNetErr(err).Error()}
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	o := parseObj(string(b))
	e := ""
	if o != nil && str(o["error"]) != "" {
		e = str(o["error"])
	} else if resp.StatusCode >= 400 {
		e = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return cloudResp{resp.StatusCode, o, e}
}

func gzipB64(t string) string {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, _ = w.Write([]byte(t))
	_ = w.Close()
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

// --- the queue: days waiting to go, one a line; and a mark that the ledgers are to go
var outMu sync.Mutex

func addCloudDays(dir string, days []string) {
	if !cloudOn() || len(days) == 0 {
		return
	}
	var ok []string
	for _, d := range days {
		if d != "" {
			ok = append(ok, d)
		}
	}
	outMu.Lock()
	_ = appendText(filepath.Join(dir, "cloud-out.txt"), strings.Join(ok, "\n")+"\n")
	outMu.Unlock()
}
func setCloudLedgers(dir string) {
	if cloudOn() {
		_ = saveFile(filepath.Join(dir, "cloud-ledgers.flag"), nowS())
	}
}
func cloudQueue(dir string) []string {
	outMu.Lock()
	defer outMu.Unlock()
	var o []string
	for _, l := range strings.Split(readText(filepath.Join(dir, "cloud-out.txt")), "\n") {
		if l = strings.TrimSpace(l); re(`^\d{8}$`).MatchString(l) {
			o = append(o, l)
		}
	}
	return uniqSorted(o)
}
func removeCloudDays(dir string, sent []string) {
	left := []string{}
	for _, d := range cloudQueue(dir) {
		if !contains(sent, d) {
			left = append(left, d)
		}
	}
	outMu.Lock()
	defer outMu.Unlock()
	t := ""
	if len(left) > 0 {
		t = strings.Join(left, "\n") + "\n"
	}
	_ = saveFile(filepath.Join(dir, "cloud-out.txt"), t)
}

var (
	cloudMu      sync.Mutex // one push at a time
	cloudLinks   = map[string]bool{}
	cloudLinksAt time.Time
	cloudBack    = map[string]keepBack{}
	cloudStateAt = map[string]time.Time{}
	cloudLast    = M{"at": "", "error": "", "sentDays": 0}
	shadowStats  = M{"same": 0, "differ": 0, "new": 0, "at": ""}
)

func keptDirs() []string {
	ents, _ := os.ReadDir(syncDir())
	var o []string
	for _, e := range ents {
		if e.IsDir() {
			o = append(o, filepath.Join(syncDir(), e.Name()))
		}
	}
	return o
}

func updateCloudLinks() {
	cos := []any{}
	names := map[string]bool{}
	for _, s := range openCompaniesCached() { // 2.1.3: what Tally named after the last event; Tally is not asked
		if s["skipped"] != true && s["ok"] == true {
			for _, c := range sessCompanies(s) {
				// rebuilt 2.1.4: the company's Tally GUID, as held here
				cos = append(cos, M{"name": str(c["name"]), "gstin": str(c["gstin"]), "guid": heldGUID(str(c["name"]))})
				names[str(c["name"])] = true
			}
		}
	}
	// companies kept here but not open now are asked about too
	for _, d := range keptDirs() {
		if st := readKeepState(d); st != nil && str(st["company"]) != "" && !names[str(st["company"])] {
			cos = append(cos, M{"name": str(st["company"]), "gstin": "", "guid": heldGUID(str(st["company"]))})
			names[str(st["company"])] = true
		}
	}
	if len(cos) == 0 {
		return
	}
	r := invokeCloud(M{"kind": "companies", "companies": cos}, 60)
	if r.code != 200 || r.json == nil {
		cloudLast["error"] = r.err
		return
	}
	was := map[string]bool{}
	for k, v := range cloudLinks {
		was[k] = v
	}
	for k, v := range obj(r.json["links"]) {
		cloudLinks[k] = truthy(v)
	}
	cloudLinksAt = time.Now()
	// a company linked just now: everything kept for it goes
	for k, on := range cloudLinks {
		if on && !was[k] {
			dir := syncFolder(k)
			mark := filepath.Join(dir, "cloud-all.done")
			if exists(dir) && !exists(mark) {
				var days []string
				for _, f := range dayFiles(dir, "") {
					days = append(days, strings.TrimSuffix(filepath.Base(f), ".xml"))
				}
				addCloudDays(dir, days)
				setCloudLedgers(dir)
				_ = saveFile(mark, nowS())
				writeLog(fmt.Sprintf("Cloud: %s is linked in FinCom; sending its copy (%d days)", k, len(days)))
			}
		}
	}
}

func rows2(v any) []any {
	o := []any{}
	for _, x := range arr(v) {
		a := arr(x)
		if len(a) >= 2 {
			o = append(o, []any{str(a[0]), str(a[1])})
		}
	}
	return o
}

// one company's queue: ledgers first, then days, a batch at a time (a few MB at most), within a time budget
func pushCloudCompany(company, dir string, budget time.Duration) error {
	t0 := time.Now()
	lf, bf := filepath.Join(dir, "cloud-ledgers.flag"), filepath.Join(dir, "balances.json")
	notLinked := errors.New("not linked")
	// no opening balances yet: the ledgers and their groups go on their own
	if exists(lf) && !exists(bf) {
		kj, gj := readObjFile(filepath.Join(dir, "ledgers.json")), readJSONFile(filepath.Join(dir, "groups.json"))
		if kj != nil && gj != nil {
			led := []any{}
			for _, v := range kj {
				a := arr(v)
				if len(a) > 0 && str(a[0]) != "" {
					led = append(led, []any{str(a[0]), str(at(a, 1))})
				}
			}
			grp := rows2(gj)
			r := invokeCloud(M{"kind": "groups", "company": company, "ledgers": led, "groups": grp}, 120)
			if r.code == 409 {
				cloudLinks[company] = false
				return notLinked
			}
			if r.code != 200 {
				return errors.New("the ledger groups did not go: " + r.err)
			}
			_ = os.Remove(lf)
			writeLog(fmt.Sprintf("Cloud: %s: %d ledgers with their groups and %d groups sent%s", company, len(led), len(grp), shadowNote(r)))
		}
	}
	if exists(lf) && exists(bf) {
		bal := readObjFile(bf)
		if bal != nil && str(bal["from"]) != "" && str(bal["openAsOn"]) != "" {
			// every ledger in Tally goes, with its group; the opening from the balances (0 when a ledger has none)
			type row struct{ n, p, o, g, pan string }
			rows := map[string]*row{}
			var order []string
			for _, x := range arr(bal["ledgers"]) {
				l := obj(x)
				if n := str(l["name"]); n != "" {
					if rows[n] == nil {
						order = append(order, n)
					}
					rows[n] = &row{n, str(l["parent"]), str(l["open"]), "", ""}
				}
			}
			if kj := readObjFile(filepath.Join(dir, "ledgers.json")); kj != nil {
				var ks []string
				for k := range kj {
					ks = append(ks, k)
				}
				sort.Strings(ks)
				for _, k := range ks {
					a := arr(kj[k])
					n, par := str(at(a, 0)), str(at(a, 1))
					if n == "" {
						continue
					}
					if r := rows[n]; r != nil {
						if r.p == "" {
							r.p = par
						}
						r.g, r.pan = str(at(a, 3)), str(at(a, 4))
					} else {
						rows[n] = &row{n, par, "0", str(at(a, 3)), str(at(a, 4))}
						order = append(order, n)
					}
				}
			}
			led := []any{}
			for _, n := range order {
				r := rows[n]
				// name, group, opening, and (2.1.2) the ledger's GSTIN and PAN when Tally has them
				if r.g != "" || r.pan != "" {
					led = append(led, []any{r.n, r.p, r.o, r.g, r.pan})
				} else {
					led = append(led, []any{r.n, r.p, r.o})
				}
			}
			grp := rows2(readJSONFile(filepath.Join(dir, "groups.json")))
			r := invokeCloud(M{"kind": "ledgers", "company": company, "from": str(bal["from"]), "openAsOn": str(bal["openAsOn"]), "ledgers": led, "groups": grp}, 120)
			if r.code == 200 && r.json != nil && str(r.json["kept"]) != "" {
				writeLog("Cloud: " + company + ": " + str(r.json["kept"]))
			}
			if r.code == 409 {
				cloudLinks[company] = false
				return notLinked
			}
			if r.code != 200 {
				return errors.New("the ledgers did not go: " + r.err)
			}
			_ = os.Remove(lf)
		}
	}
	// 2.1.4: the ledger list (new, changed, renamed and deleted ledgers, and the groups), before the days
	if err := pushLedgerList(company, dir); err != nil {
		return err
	}
	q := cloudQueue(dir)
	pf := filepath.Join(dir, "cloud-plain.txt")
	var plain []string
	for _, l := range strings.Split(readText(pf), "\n") {
		if l = strings.TrimSpace(l); re(`^\d{8}$`).MatchString(l) {
			plain = append(plain, l)
		}
	}
	maxB := keepNum("CloudBatchKB", 3000) * 1024
	for i := 0; i < len(q) && time.Since(t0) < budget; {
		var batch []any
		var bdays []string
		size := 0
		for i < len(q) && len(batch) < 31 {
			d := q[i]
			t := readText(filepath.Join(dir, "days", d+".xml"))
			var one M
			var n int
			// packed here (gzip); a day the cloud could not open that way is sent again as plain text
			if contains(plain, d) {
				b := base64.StdEncoding.EncodeToString([]byte(t))
				one, n = M{"day": d, "b64": b}, len(b)
			} else {
				g := gzipB64(t)
				one, n = M{"day": d, "gz": g}, len(g)
			}
			if len(batch) > 0 && size+n > maxB {
				break
			}
			batch, bdays = append(batch, one), append(bdays, d)
			size += n
			i++
		}
		r := invokeCloud(M{"kind": "days", "company": company, "days": batch}, 180)
		if r.code == 409 {
			cloudLinks[company] = false
			return notLinked
		}
		if r.code != 200 {
			return errors.New("days did not go: " + r.err)
		}
		done := strs(r.json["done"])
		if testMode() {
			noteShadowDays(company, dir, r.json)
		}
		// a day the cloud could not open (gzip): sent again as plain text; any other refusal is logged and left out
		var again, dropped []string
		for _, x := range arr(r.json["bad"]) {
			b := obj(x)
			if b == nil {
				continue
			}
			d := str(b["day"])
			if re(`gzip|checksum|corrupt|invalid`).MatchString(str(b["error"])) && !contains(plain, d) {
				again = append(again, d)
			} else {
				dropped = append(dropped, d)
				writeLog("Cloud: " + company + " " + d + " was not taken: " + str(b["error"]))
			}
		}
		if len(again) > 0 {
			plain = uniqSorted(append(plain, again...))
			_ = saveFile(pf, strings.Join(plain, "\r\n")+"\r\n")
			writeLog(fmt.Sprintf("Cloud: %s: %d day(s) go again as plain text", company, len(again)))
		}
		removeCloudDays(dir, append(append([]string{}, done...), dropped...))
		all := append(append(append([]string{}, done...), dropped...), again...)
		if len(again) > 0 {
			i = len(q)
		}
		cloudLast["sentDays"] = toInt(cloudLast["sentDays"]) + len(all)
		if len(all) < len(batch) {
			return fmt.Errorf("only %d of %d days were taken", len(all), len(batch))
		}
	}
	return nil
}
func at(a []any, i int) any {
	if i < len(a) {
		return a[i]
	}
	return nil
}

// test mode: what FinCom's cloud found comparing the days sent here with bridge 1.15.0's copy. A day that differs is
// compared again a little later (bridge 1.15.0 may not have sent the same change yet), three times, before it is reported
func noteShadowDays(company, dir string, j M) {
	same, differ, nw := strs(j["same"]), strs(j["differ"]), len(strs(j["new"]))
	rf := filepath.Join(dir, "shadow-recheck.json")
	rc := readObjFile(rf)
	if rc == nil {
		rc = M{}
	}
	for _, d := range same {
		delete(rc, d)
	}
	var still, again []string
	for _, d := range differ {
		n := toInt(obj(rc[d])["n"]) + 1
		if n >= 3 {
			still = append(still, d)
			delete(rc, d)
		} else {
			rc[d] = M{"n": n, "at": time.Now().Add(time.Duration(keepNum("ShadowRecheckSec", 120)) * time.Second).Format("2006-01-02T15:04:05")}
			again = append(again, d)
		}
	}
	_ = saveFile(rf, jsonText(rc))
	shadowStats["same"] = toInt(shadowStats["same"]) + len(same)
	shadowStats["differ"] = toInt(shadowStats["differ"]) + len(still)
	shadowStats["new"] = toInt(shadowStats["new"]) + nw
	shadowStats["at"] = nowS()
	msg := fmt.Sprintf("Shadow check: %s: %d day(s) the same as bridge 1.15.0's copy in the cloud", company, len(same))
	if len(again) > 0 {
		msg += fmt.Sprintf(", %d not the same yet (compared again in a moment: bridge 1.15.0 may not have sent it yet)", len(again))
	}
	if len(still) > 0 {
		msg += fmt.Sprintf(", %d STILL DIFFERENT after 3 checks (%s)", len(still), strings.Join(still[:minI(10, len(still))], ", "))
		shadowStats["lastDifferent"] = strings.Join(still[:minI(10, len(still))], ", ")
	}
	if nw > 0 {
		msg += fmt.Sprintf(", %d not in the cloud yet", nw)
	}
	writeLog(msg)
	_ = saveFile(sp("shadow-check.json"), jsonText(shadowStats))
}

// the days to compare again, when their time has come
func shadowRecheckDue(dir string) {
	rf := filepath.Join(dir, "shadow-recheck.json")
	rc := readObjFile(rf)
	var due []string
	for d, v := range rc {
		if t, ok := parseTime(str(obj(v)["at"])); ok && time.Now().After(t) {
			due = append(due, d)
		}
	}
	if len(due) > 0 {
		addCloudDays(dir, due)
		for _, d := range due {
			obj(rc[d])["at"] = time.Now().Add(time.Hour).Format("2006-01-02T15:04:05")
		}
		_ = saveFile(rf, jsonText(rc))
	}
}
func shadowNote(r cloudResp) string {
	if testMode() {
		return " (test mode: compared, not kept)"
	}
	return ""
}

// the copy's state for FinCom, once a minute at most
func pushCloudState(company, dir string) {
	if t, ok := cloudStateAt[company]; ok && time.Since(t).Seconds() < float64(keepNum("CloudStateSec", 60)) {
		return
	}
	m := readObjFile(filepath.Join(dir, "manifest.json"))
	if m == nil {
		return
	}
	st := M{"phase": m["phase"], "from": m["from"], "to": m["to"], "doneTo": m["doneTo"], "seen": m["seen"], "skipped": arr(m["skipped"]), "trouble": m["trouble"], "bridge": BridgeVersion,
		"queue": len(cloudQueue(dir)), "computer": computerName()}
	if r := invokeCloud(M{"kind": "state", "company": company, "state": st}, 30); r.code == 200 {
		cloudStateAt[company] = time.Now()
	}
}

// every turn: all companies kept here, whether open in Tally or not (sending needs no Tally); returns the days waiting
func invokeCloudPush() int {
	if !cloudOn() {
		return 0
	}
	cloudMu.Lock()
	defer cloudMu.Unlock()
	if time.Since(cloudLinksAt).Seconds() >= float64(keepNum("CloudLinksSec", 300)) {
		updateCloudLinks()
	}
	left := 0
	for _, d := range keptDirs() {
		st := readKeepState(d)
		if st == nil || str(st["company"]) == "" {
			continue
		}
		co := str(st["company"])
		if !cloudLinks[co] {
			continue
		}
		if testMode() {
			shadowRecheckDue(d)
		}
		bk, had := cloudBack[co]
		if had && time.Now().Before(bk.until) {
			left += len(cloudQueue(d))
			continue
		}
		err := pushCloudCompany(co, d, time.Duration(keepNum("CloudBudgetSec", 30))*time.Second)
		if err == nil {
			pushCloudState(co, d)
			delete(cloudBack, co)
			cloudLast["error"], cloudLast["at"] = "", nowS()
		} else if err.Error() != "not linked" {
			n := 1
			if had {
				n = bk.n + 1
			}
			w := math.Min(1800, 30*math.Pow(2, float64(n)))
			cloudBack[co] = keepBack{n, time.Now().Add(time.Duration(w) * time.Second)}
			cloudLast["error"] = err.Error()
			writeLog(fmt.Sprintf("Cloud: %s: %s - trying again in %ds; nothing is lost", co, err.Error(), int(w)))
		}
		left += len(cloudQueue(d))
	}
	links := M{}
	for k, v := range cloudLinks {
		links[k] = v
	}
	_ = saveFile(sp("cloud-status.json"), jsonText(M{"at": nowS(), "lastSent": cloudLast["at"], "error": cloudLast["error"], "sentDays": cloudLast["sentDays"], "waiting": left, "links": links}))
	return left
}

// from FinCom: connect this computer (the key made in FinCom) or disconnect it
func setCloudLink(o M) (M, error) {
	if truthy(o["off"]) {
		setCfg("CloudKey", "")
		setCfg("CloudKeyGo", "")
		saveConfig()
		writeLog("Cloud: this computer was disconnected from FinCom")
		return M{"ok": true, "connected": false}, nil
	}
	u, key := str(o["url"]), str(o["key"])
	// only FinCom's own cloud (the live database, and the test site's): the books go nowhere else
	if !re(`^https://(nrtczucrlgalvtojwoes|qbocskaiewaxqcvaunzc)\.supabase\.co/functions/v1/tally-ingest$`).MatchString(u) && !(isFake() && re(`^http://127\.0\.0\.1:\d+/`).MatchString(u)) {
		return nil, errors.New("That is not FinCom's cloud address.")
	}
	if !re(`^fcd_[0-9a-f]{48}$`).MatchString(key) {
		return nil, errors.New("That is not a FinCom computer key.")
	}
	oldU, oldK, oldG := cfg("CloudUrl"), cfg("CloudKey"), cfg("CloudKeyGo")
	pk, err := protectKey(key)
	if err != nil {
		return nil, err
	}
	setCfg("CloudUrl", u)
	setCfg("CloudKey", "")
	setCfg("CloudKeyGo", pk)
	r := invokeCloud(M{"kind": "hello", "info": M{"computer": computerName(), "user": ownerName()}}, 60)
	if r.code != 200 {
		setCfg("CloudUrl", oldU)
		setCfg("CloudKey", oldK)
		setCfg("CloudKeyGo", oldG)
		return nil, errors.New("FinCom's cloud did not accept this computer: " + r.err)
	}
	saveConfig()
	cloudLinksAt = time.Time{}
	// everything kept so far is queued for when its company is linked
	for _, d := range keptDirs() {
		_ = os.Remove(filepath.Join(d, "cloud-all.done"))
	}
	writeLog("Cloud: this computer is connected to " + str(r.json["firm"]) + " as \"" + str(r.json["device"]) + "\"")
	return M{"ok": true, "connected": true, "firm": r.json["firm"], "device": r.json["device"]}, nil
}
func cloudLinkStatus() M {
	return M{"ok": true, "connected": cloudOn(), "url": cfgS("CloudUrl"), "status": readJSONFile(sp("cloud-status.json"))}
}

// --- the heartbeat: every 30 seconds (CloudBeatSec), on its own, so FinCom always knows the bridge is there. It is made
// only from what the bridge already knows (Tally is asked nothing), and nothing it does waits for Tally or a posting:
// a slow Tally shows as "busy", not as a bridge gone. A beat that does not reach FinCom is tried again at the next tick
var (
	beatMu     sync.Mutex
	beatOK     time.Time // the last heartbeat the cloud answered (for the tray: "Bridge offline")
	beatFailAt time.Time // since when the heartbeat has not reached FinCom (zero: it does)
	shadowOK   atomic.Bool
	postTaking atomic.Bool
	beatNow    = make(chan struct{}, 1)
)

func beatTimes() (time.Time, time.Time) {
	beatMu.Lock()
	defer beatMu.Unlock()
	return beatOK, beatFailAt
}
func beatEvery() int { return keepNum("CloudBeatSec", 30) }

// the state of the owner's Tally overall: open, busy (open, slow to answer), or closed
func tallyOverall(sessions []M) (string, string) {
	st, since := "closed", ""
	for _, s := range sessions {
		if s["skipped"] == true {
			continue
		}
		switch str(s["tallyState"]) {
		case "open":
			st = "open"
		case "busy":
			if st != "open" {
				st = "busy"
				if b, t := tallyBusy(toInt(s["port"])); b {
					since = t.Format("2006-01-02T15:04:05")
				}
			}
		}
	}
	return st, since
}

func beatLoop() {
	sleepOrStop(3 * time.Second)
	for !stopping() {
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeLog(fmt.Sprint("Heartbeat: ", r))
				}
			}()
			selfWatchTick()
			if cloudOn() {
				beatOnce()
				claimMainOnce()
			}
		}()
		select {
		case <-stopCh:
			return
		case <-beatNow:
		case <-time.After(time.Duration(beatEvery()) * time.Second):
		}
	}
}

func beatOnce() {
	open, ports := []any{}, []any{}
	sessions := openCompaniesCached()
	tally := false
	for _, s := range sessions {
		ports = append(ports, M{"port": toInt(s["port"]), "ok": s["ok"] == true, "skipped": s["skipped"] == true, "n": len(sessCompanies(s)), "error": cut(str(s["error"]), 120), "state": str(s["tallyState"])})
		if s["skipped"] == true {
			continue
		}
		if s["ok"] == true {
			tally = true
			for _, c := range sessCompanies(s) {
				open = append(open, str(c["name"]))
			}
		}
	}
	tstate, tsince := tallyOverall(sessions)
	cos := []any{}
	for _, d := range keptDirs() {
		st := readKeepState(d)
		if st == nil || str(st["company"]) == "" {
			continue
		}
		isOpen := false
		for _, o := range open {
			if o == str(st["company"]) {
				isOpen = true
			}
		}
		cos = append(cos, M{"name": str(st["company"]), "open": isOpen, "at": str(st["at"]), "phase": str(st["phase"]), "waiting": len(cloudQueue(d)), "lastRead": str(st["readAt"]),
			"guid": heldGUID(str(st["company"]))})
	}
	r := invokeCloud(beatBody(tally, tstate, tsince, open, ports, cos), 10)
	if r.code == 200 && r.json != nil {
		if testMode() && !truthy(r.json["shadow"]) {
			if shadowOK.Swap(false) || beatMissedSince().IsZero() {
				writeLog("Test mode: FinCom's cloud does not keep a test bridge apart yet, so nothing is sent to it (only the heartbeat)")
			}
			beatMu.Lock()
			if beatFailAt.IsZero() {
				beatFailAt = time.Now()
			}
			beatMu.Unlock()
			return
		}
		shadowOK.Store(true)
		applyReadControl(r.json) // FinCom's stop or resume of reading on this computer
		applyRelease(r.json)     // the version this computer may take (update.go)
		// made the main bridge on FinCom's Tally page: this test bridge switches itself to main, once
		if testMode() && truthy(r.json["makeMain"]) && makeMainSeen.CompareAndSwap(false, true) {
			writeLog("FinCom made this the main bridge")
			if err := switchToMain(false); err != nil {
				writeLog("Switching to the main bridge: " + err.Error())
			}
		}
		// another bridge is the main one on this computer: this one reads only (said once in the log)
		if !testMode() {
			if truthy(r.json["notMain"]) {
				noteNotMain(str(r.json["error"]), true)
			} else {
				clearNotMainByBeat()
			}
		}
		beatMu.Lock()
		was := beatFailAt
		beatOK, beatFailAt = time.Now(), time.Time{}
		beatMu.Unlock()
		if !was.IsZero() {
			writeLog(fmt.Sprintf("Heartbeat: FinCom reached again (not reached for %s)", time.Since(was).Round(time.Second)))
		}
		setCloudWake(obj(r.json["wake"]))
		// FinCom's last-activity signal (for the nightly catch-up), and clients opened in FinCom (the fallback for the
		// wake-up channel)
		if a := str(r.json["activityAt"]); a != "" {
			noteCloudUse(a)
		}
		if o := obj(r.json["opened"]); len(o) > 0 {
			go openedFromBeat(o)
		}
		if o := obj(r.json["ledgers"]); len(o) > 0 {
			go ledgersFromBeat(o)
		}
		// Update now pressed in FinCom on another computer; postings waiting: started, never waited for here. Neither is
		// stopped by "Pause background reading"
		if truthy(r.json["updateNow"]) {
			go wakeUpdate("")
		}
		if toInt(r.json["posts"]) > 0 && cfgB("AllowImport") && readOnlyWhy() == "" && postTaking.CompareAndSwap(false, true) {
			go func() { defer postTaking.Store(false); cloudPostTake() }()
		}
		return
	}
	beatMu.Lock()
	first := beatFailAt.IsZero()
	if first {
		beatFailAt = time.Now()
	}
	beatMu.Unlock()
	if first { // said once; tried again quietly every 30 seconds
		writeLog("Heartbeat: FinCom could not be reached (" + r.err + "); tried again every " + fmt.Sprint(beatEvery()) + " s, nothing is lost")
	}
}
func beatMissedSince() time.Time { _, f := beatTimes(); return f }

// the heartbeat (2.1.3): also whether background reading is paused, since when Tally has not answered, the hour of the
// nightly catch-up, the last read of each company, and that this bridge reads Tally only after an event
func beatBody(tally bool, tstate, tsince string, open, ports, cos []any) M {
	return M{"reqs": beatReqs(), "readStopped": readStopAny(), "kind": "beat", "tally": tally, "tallyState": tstate, "busySince": tsince, "every": beatEvery(), "open": open, "ports": ports, "companies": cos,
		"updating": keepRunning(), "dailyAt": keepDailyAt(), "nightlyAt": keepDailyAt(), "lastRun": keepLastRun(), "paused": paused(), "notAnsweringSince": notAnsweringSince(),
		"lastRead": lastReadAt(), "events": true, "computer": computerName()}
}

// --- the posting queue (build 199): postings queued in FinCom on any computer, taken one at a time
var (
	cpMu        sync.Mutex
	cloudPosts  map[string]string
	cloudPostAt time.Time
)

func cloudPostsFile() string { return sp("cloud-posts.txt") }
func getCloudPosts() map[string]string {
	if cloudPosts == nil {
		cloudPosts = map[string]string{}
		for _, l := range strings.Split(readText(cloudPostsFile()), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				cloudPosts[l] = ""
			}
		}
	}
	return cloudPosts
}
func saveCloudPosts() {
	var ks []string
	for k := range cloudPosts {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	t := ""
	if len(ks) > 0 {
		t = strings.Join(ks, "\r\n") + "\r\n"
	}
	_ = saveFile(cloudPostsFile(), t)
}

func cloudPostTake() {
	if readOnlyWhy() != "" { // only the one bridge that posts takes postings
		return
	}
	cpMu.Lock()
	defer cpMu.Unlock()
	cp := getCloudPosts()
	for i := 0; i < 5; i++ {
		r := invokeCloud(M{"kind": "posts_take"}, 30)
		if r.code == 403 && r.json != nil && truthy(r.json["notMain"]) {
			noteNotMain(r.err, false)
			return
		}
		if r.code != 200 || r.json == nil || obj(r.json["job"]) == nil {
			return
		}
		j := obj(r.json["job"])
		pl := obj(j["payload"])
		id := str(j["id"])
		v, err := newPostJob(M{"jobId": id, "company": str(j["company"]), "masters": arr(pl["masters"]), "vouchers": arr(pl["vouchers"]), "ledger": str(pl["ledger"]), "checkFirst": true})
		if err != nil {
			invokeCloud(M{"kind": "posts_update", "id": id, "status": "failed", "done": 0, "message": "The Tally computer could not start this posting: " + err.Error(), "results": []any{}}, 30)
			continue
		}
		cp[id] = ""
		saveCloudPosts()
		writeLog(fmt.Sprintf("Posting from FinCom's queue: %v item(s) for %s (job %s)", v["total"], str(j["company"]), id))
	}
}

// the job's status as FinCom's queue knows it (taken, running, done, failed): a posting waiting for Tally is "taken",
// with its "Waiting for Tally: ..." message
func cloudPostStatus(st string) string {
	switch st {
	case "done", "failed":
		return st
	case "waiting", "queued", "interrupted":
		return "taken"
	}
	return "running"
}

// postings taken from the queue are followed and reported every few seconds while they run, and at once when they change
func syncCloudPosts() {
	cpMu.Lock()
	defer cpMu.Unlock()
	cp := getCloudPosts()
	dirty := postsDirty.Swap(false) // a job changed (an entry finished, a wait began): reported now
	if len(cp) == 0 || (!dirty && time.Since(cloudPostAt).Seconds() < float64(keepNum("CloudPostSyncSec", 3))) {
		return
	}
	cloudPostAt = time.Now()
	for id, last := range cp {
		dir, err := jobDir(id)
		if err != nil {
			delete(cp, id)
			saveCloudPosts()
			continue
		}
		v := jobView(dir)
		if v == nil {
			delete(cp, id)
			saveCloudPosts()
			continue
		}
		if str(v["status"]) == "interrupted" && readOnlyWhy() == "" {
			if r, err := resumePostJob(id); err == nil {
				v = r
			}
		}
		if str(v["status"]) == "cancelled" {
			delete(cp, id)
			saveCloudPosts()
			continue
		}
		st := cloudPostStatus(str(v["status"]))
		sig := fmt.Sprint(st, "|", v["done"], "|", v["message"], "|", v["checking"], "|", jsonText(v["items"]))
		if sig == last {
			continue
		}
		res := []any{}
		for _, x := range arr(v["results"]) {
			r := obj(x)
			if r == nil {
				continue
			}
			res = append(res, M{"id": str(r["id"]), "kind": str(r["kind"]), "ok": r["ok"] == true, "verified": r["verified"], "message": str(r["message"]), "vchNumber": str(r["vchNumber"]), "vchType": str(r["vchType"]),
				"guid": str(r["guid"]), "masterId": str(r["masterId"]), "vchDate": str(r["vchDate"]), "optional": truthy(r["optional"]), "alreadyThere": truthy(r["alreadyThere"]),
				"already": truthy(r["already"]), "checkFailed": truthy(r["checkFailed"]), "vchNo": str(r["vchNo"]),
				// rebuilt 2.1.4: sent when Tally stopped answering, being looked for by its FinCom id (state "unknown"); the
				// FinCom id found in Tally already (sameId); the company's GUID not the one held (guidMismatch)
				"outcomeUnknown": truthy(r["outcomeUnknown"]), "sameId": truthy(r["sameId"]), "guidMismatch": truthy(r["guidMismatch"]),
				"state": itemState(r, false), "reason": map[bool]string{true: "", false: failedLine(str(r["message"]))}[r["ok"] == true]})
		}
		// items: every entry's state (waiting, sending, sent, in_tally, failed with its reason), for FinCom to show live
		r := invokeCloud(M{"kind": "posts_update", "id": id, "status": st, "done": toInt(v["done"]), "message": str(v["message"]), "results": res, "items": arr(v["items"]), "checking": v["checking"] == true}, 30)
		if r.json != nil && (truthy(r.json["cancelled"]) || truthy(r.json["gone"])) {
			// cancelled in FinCom (or no longer there): it stops, also while it waits for Tally
			_, _ = cancelJob(id, "cancelled in FinCom")
			delete(cp, id)
			saveCloudPosts()
			continue
		}
		if r.code == 403 && r.json != nil && truthy(r.json["notMain"]) {
			// FinCom no longer takes this bridge's reports: another bridge is the main one now
			noteNotMain(r.err, false)
			delete(cp, id)
			saveCloudPosts()
			continue
		}
		if r.code == 200 {
			cp[id] = sig
			if (st == "done" || st == "failed") && v["checking"] != true {
				delete(cp, id)
				saveCloudPosts()
				writeLog("Posting from FinCom's queue " + id + ": " + str(v["message"]))
			}
		}
	}
}

// --- the wake-up channel (1.15.0): the computer's own Realtime channel; the heartbeat's answer names it
type wakeState struct {
	mu      sync.Mutex
	info    string
	url     string
	key     string
	topic   string
	joined  bool
	kick    chan struct{}
	started bool
}

var wake = &wakeState{kick: make(chan struct{}, 1)}

func setCloudWake(w M) {
	if w == nil || str(w["topic"]) == "" || str(w["url"]) == "" {
		return
	}
	n := str(w["url"]) + "|" + str(w["topic"])
	wake.mu.Lock()
	if n == wake.info {
		wake.mu.Unlock()
		return
	}
	wake.info, wake.url, wake.key, wake.topic = n, str(w["url"]), str(w["key"]), str(w["topic"])
	start := !wake.started
	wake.started = true
	wake.mu.Unlock()
	select {
	case wake.kick <- struct{}{}:
	default:
	}
	if start {
		go wakeLoop()
	}
}
func wakeStatus() M {
	wake.mu.Lock()
	defer wake.mu.Unlock()
	return M{"on": wake.topic != "", "joined": wake.joined}
}

func wakeLoop() {
	wait := 5 * time.Second
	for !stopping() {
		wake.mu.Lock()
		u, key, topic := wake.url, wake.key, wake.topic
		wake.mu.Unlock()
		if topic == "" || !cloudOn() || cfgS("CloudWake") == "off" {
			sleepOrStop(10 * time.Second)
			continue
		}
		err := wakeSession(u, key, topic)
		wake.mu.Lock()
		wake.joined = false
		wake.mu.Unlock()
		if stopping() {
			return
		}
		if err != nil && wait <= 10*time.Second {
			writeLog("Wake-up channel: could not connect (" + err.Error() + "); the heartbeat carries on meanwhile")
		}
		if err == nil {
			wait = 5 * time.Second
		}
		select {
		case <-wake.kick:
			wait = 5 * time.Second
		case <-time.After(wait):
			wait = time.Duration(math.Min(300, wait.Seconds()*2)) * time.Second
		case <-stopCh:
			return
		}
	}
}

// one connection: join the channel, answer its heartbeat, act on each wake-up; returns when it drops or the channel changes
func wakeSession(u, key, topic string) error {
	d := websocket.Dialer{HandshakeTimeout: 10 * time.Second, Proxy: http.ProxyFromEnvironment}
	conn, _, err := d.Dial(u+"?apikey="+url.QueryEscape(key)+"&vsn=1.0.0", nil)
	if err != nil {
		return errors.New(plainNetErr(err).Error())
	}
	defer conn.Close()
	var wmu sync.Mutex
	ref := 0
	send := func(t, ev string, payload any) (string, error) {
		wmu.Lock()
		defer wmu.Unlock()
		ref++
		r := fmt.Sprint(ref)
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		return r, conn.WriteMessage(websocket.TextMessage, []byte(jsonText(M{"topic": t, "event": ev, "payload": payload, "ref": r})))
	}
	joinRef, err := send("realtime:"+topic, "phx_join", M{"config": M{"broadcast": M{"self": false, "ack": false}, "presence": M{"key": ""}, "postgres_changes": []any{}, "private": false}})
	if err != nil {
		return err
	}
	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(25 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-t.C:
				if _, err := send("phoenix", "heartbeat", M{}); err != nil {
					conn.Close()
					return
				}
			case <-wake.kick:
				conn.Close() // the channel changed
				return
			case <-stopCh:
				conn.Close()
				return
			}
		}
	}()
	for {
		_ = conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			wake.mu.Lock()
			j := wake.joined
			wake.mu.Unlock()
			if j {
				return nil
			}
			return err
		}
		m := parseObj(string(data))
		if m == nil {
			continue
		}
		if str(m["event"]) == "phx_reply" && str(m["ref"]) == joinRef {
			ok := str(obj(m["payload"])["status"]) == "ok"
			wake.mu.Lock()
			wake.joined = ok
			wake.mu.Unlock()
			if ok {
				writeLog("Wake-up channel: connected (postings and Update now reach this computer at once)")
			} else {
				writeLog("Wake-up channel: not taken by FinCom's cloud; the heartbeat carries on")
			}
			continue
		}
		if str(m["event"]) != "broadcast" || obj(m["payload"]) == nil {
			continue
		}
		wakeEvent(str(obj(m["payload"])["event"]), obj(obj(m["payload"])["payload"]))
	}
}

// one wake-up from FinCom's cloud: a posting waiting, Update now, a client opened, FinCom in use, or (2.1.4) the ledger
// list wanted ("ledgers", {company, at}: a bill's ledger chooser opened with a list older than the last posting)
func wakeEvent(ev string, inner M) {
	switch ev {
	case "post":
		writeLog("Woken by FinCom: a posting is waiting")
		noteUse()
		if why := readOnlyWhy(); why != "" {
			writeLog("Not taken here: " + why)
		} else if cfgB("AllowImport") && postTaking.CompareAndSwap(false, true) {
			go func() { defer postTaking.Store(false); cloudPostTake() }()
		}
	case "update":
		writeLog("Woken by FinCom: Update now")
		go wakeUpdate(str(inner["company"]))
	case "open":
		// a client opened in FinCom: one light update of its company (at most one every few minutes), then idle
		co := str(inner["company"])
		if a := str(inner["at"]); a != "" {
			noteCloudUse(a)
		} else {
			noteUse()
		}
		go wakeOpen(co, "opened in FinCom")
	case "active":
		if a := str(inner["at"]); a != "" {
			noteCloudUse(a)
		}
	case "ledgers":
		co := str(inner["company"])
		writeLog("Woken by FinCom: the ledger list of " + co + " wanted (the ledger chooser)")
		if a := str(inner["at"]); a != "" {
			noteCloudUse(a)
			evMu.Lock()
			if a > ledFromBeat[co] {
				ledFromBeat[co] = a // the heartbeat's copy of the same wake-up is not taken again
			}
			evMu.Unlock()
		}
		go wakeLedgers(co, "the ledger chooser opened in FinCom", false)
	}
}
