// FinCom Bridge 2.5.16 (servicestate.go): the link to FinCom carried over from the service's earlier settings (a file
// its owner could change) is kept apart, as PendingCloudUrl / PendingCloudKey, and taken only when FinCom's cloud says
// that key already holds this bridge's id for the same Windows user (key_check, read only). Then it is the link, with
// no step for anyone. FinCom says no (the key unknown, removed, or another computer's): the pending link is dropped and
// the person connects FinCom again. FinCom not reached, or a cloud that does not know key_check yet: asked again later;
// the pending link is never used for anything else meanwhile.
package main

import (
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

var reCloudURL = re(`^https://(nrtczucrlgalvtojwoes|qbocskaiewaxqcvaunzc)\.supabase\.co/functions/v1/tally-ingest$`)

// the question itself: one POST with the pending key; a hook for the tests (code 0: not reached)
var pendingCheckFn = func(url, key string, body M) (int, M) {
	req, err := http.NewRequest("POST", url, strings.NewReader(jsonText(body)))
	if err != nil {
		return 0, nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-fincom-device", key)
	c := &http.Client{Transport: cloudHTTP.Transport, Timeout: 20 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, parseObj(string(b))
}

var pendingMu sync.Mutex
var pendingAsked time.Time

// a pending link waits: asked at most every two minutes; "taken", "dropped", "later" or "" (none)
func checkPendingCloud() string {
	u, raw := cfgS("PendingCloudUrl"), cfgS("PendingCloudKey")
	if u == "" && raw == "" {
		return ""
	}
	pendingMu.Lock()
	defer pendingMu.Unlock()
	if !pendingAsked.IsZero() && time.Since(pendingAsked) < 2*time.Minute {
		return "later"
	}
	pendingAsked = time.Now()
	drop := func(why string) string {
		setCfg("PendingCloudUrl", "")
		setCfg("PendingCloudKey", "")
		saveConfig()
		writeLog("Cloud: the link to FinCom kept in the earlier settings is not taken (" + why + "): connect FinCom again (Connect FinCom on this computer... in the tray icon)")
		return "dropped"
	}
	key := unprotectKey(raw)
	if !reCloudURL.MatchString(u) || !re(`^fcd_[0-9a-f]{48}$`).MatchString(key) {
		return drop("not FinCom's address or key")
	}
	code, j := pendingCheckFn(u, key, M{"kind": "key_check", "version": BridgeVersion, "bridge": bridgeIdentity()})
	switch {
	case code == 200 && j["ok"] == true && j["known"] == true:
		pk, err := protectKey(key)
		if err != nil {
			return "later"
		}
		setCfg("CloudUrl", u)
		setCfg("CloudKey", pk)
		setCfg("CloudKeyGo", "")
		setCfg("PendingCloudUrl", "")
		setCfg("PendingCloudKey", "")
		saveConfig()
		writeLog("Cloud: FinCom confirmed the link kept in the earlier settings is this computer's; it is used (nothing to do)")
		return "taken"
	case code == 200 && j["ok"] == true:
		return drop("FinCom does not know this bridge on that key")
	case code == 401 || code == 403 || (code == 409 && j["idRefused"] == true):
		return drop("FinCom refused that key")
	default:
		// not reached, busy, or a cloud without key_check: asked again later, never used meanwhile
		return "later"
	}
}
