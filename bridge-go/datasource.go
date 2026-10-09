// 2.4.1 (the owner's approval of 09-Oct-2026, items 1-2; docs/bridge-2.4.1-notes.md): two copies of a company must never
// mix. On 09-Oct the owner opened GARG SHEKHAR & COMPANY (one company GUID) in two Tallys with different data folders; both
// add-ons wrote into the one recorder folder and the owner's bridge took the second copy's lines (Sales 2026-27/GST/297,
// whose MasterID 25743 is an older voucher in the owner's own Tally).
//
// The add-on now writes the company's data folder on every line ("|dp=<path>", recorderline.go). Here:
//   - the data id of a folder: sha256 of its case-folded, trimmed path, the first 16 hex characters (dataIDOf); the path
//     itself is kept for display only;
//   - the bridge learns its OWN Tally's data id per company (company GUID) only from a line that proved itself (the review
//     of next-241, H1): w= this Windows user, its entry asked of this bridge's own Tally by its MasterID and Tally's answer
//     under the line's own GUID with an AlterID above the line's (dataProve). A known own id is never replaced without
//     FinCom's choice (a second folder of the same user goes as another location's);
//   - FinCom's beat answer names the chosen data id of each company (dataSources: tally_company_sources, migration 71):
//     kept in sync\recorder-data.json with the own ids;
//   - a line whose data id is not the own one (or, with no own one proven, not among the chosen ones), or any line of a
//     company whose own location FinCom decided is NOT read ('other': the bridge stops reading it; a pending one goes on,
//     its lines held by FinCom in a form it can still apply), also one without dp= then (H2), is never asked of
//     Tally and never sent as an entry: it goes as event "other_source" (the company, its GUID, the data id, the path, w=,
//     the computer, the line's date, type and number, nothing of the entry: wire);
//   - a line without dp= (an older add-on, or an empty one) is as in 2.4.0.
//
// The heartbeat carries the own data ids (dataSources); every line the bridge reads from its own Tally carries the own data
// id (data_id), so FinCom holds anything of a data id that is not the chosen one. Nothing here asks Tally anything.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type dataOwnSt struct {
	ID, Path, Company, CGUID, W, At string
}

// FinCom's answer for a company: the data ids it reads (a set), and what it decided for the own one it was told of
type dataChoiceSt struct {
	IDs         []string
	Own, Choice string // the data id the beat named as this bridge's own, and FinCom's word for it: chosen | pending | other
	Company     string
}

var dataSt struct {
	mu     sync.Mutex
	dir    string                  // the sync folder it belongs to ("" : not loaded)
	own    map[string]dataOwnSt    // company GUID (lower case) -> this bridge's own data id (proven)
	chosen map[string]dataChoiceSt // company GUID (lower case) -> FinCom's answer
	seen   map[string][]string     // company GUID (lower case) -> the data ids this Windows user's lines named (the re-review's H1-r(b))
}

func dataFile() string { return sp("recorder-data.json") }

// review SR-L1 of next-241: control characters (C0, C1) and the bidi marks and overrides are no part of a path, a Windows
// user or a computer's name (FinCom strips the same, and measures lengths in characters as cutRunes does)
func dataClean(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) || r == 0x200e || r == 0x200f || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) {
			return -1
		}
		return r
	}, s)
}

// the data id of a data folder ("" for none): control characters dropped, case-folded, trimmed of spaces and of trailing
// path separators (the same folder written D:\x\100000 or D:\x\100000\ is one location)
func dataIDOf(path string) string {
	p := strings.ToLower(strings.TrimRight(strings.TrimSpace(dataClean(path)), `\/ `))
	if p == "" {
		return ""
	}
	h := sha256.Sum256([]byte(p))
	return hex.EncodeToString(h[:])[:16]
}

func dataKey(cguid string) string {
	return strings.ToLower(strings.TrimSpace(liveGUID(strings.TrimSpace(cguid))))
}

// a restart (the tests): read again from disk at the next use
func dataResetState() {
	dataSt.mu.Lock()
	dataSt.dir = ""
	dataSt.mu.Unlock()
}

func dataHexID(id string) bool { return len(id) == 16 && strings.Trim(id, "0123456789abcdef") == "" }

// under dataSt.mu
func dataFresh() {
	d := syncDir()
	if dataSt.dir == d && dataSt.own != nil {
		return
	}
	dataSt.dir = d
	dataSt.own, dataSt.chosen, dataSt.seen = map[string]dataOwnSt{}, map[string]dataChoiceSt{}, map[string][]string{}
	o := readObjFile(dataFile())
	for k, v := range obj(o["seen"]) {
		for _, x := range arr(v) {
			if id := str(x); dataHexID(id) && !dataIn(dataSt.seen[k], id) && len(dataSt.seen[k]) < dataSeenMax {
				dataSt.seen[k] = append(dataSt.seen[k], id)
			}
		}
	}
	for k, v := range obj(o["own"]) {
		e := obj(v)
		if id := str(e["id"]); dataHexID(id) {
			dataSt.own[k] = dataOwnSt{ID: id, Path: str(e["path"]), Company: str(e["company"]), CGUID: str(e["cguid"]), W: str(e["w"]), At: str(e["at"])}
		}
	}
	for k, v := range obj(o["chosen"]) {
		e := obj(v)
		var ids []string
		for _, x := range arr(e["ids"]) {
			if id := str(x); dataHexID(id) {
				ids = append(ids, id)
			}
		}
		dataSt.chosen[k] = dataChoiceSt{IDs: ids, Own: str(e["own"]), Choice: str(e["choice"]), Company: str(e["company"])}
	}
}

// under dataSt.mu
func dataSave() {
	own, ch := M{}, M{}
	for k, v := range dataSt.own {
		own[k] = M{"id": v.ID, "path": v.Path, "company": v.Company, "cguid": v.CGUID, "w": v.W, "at": v.At}
	}
	for k, v := range dataSt.chosen {
		ids := []any{}
		for _, x := range v.IDs {
			ids = append(ids, x)
		}
		ch[k] = M{"ids": ids, "own": v.Own, "choice": v.Choice, "company": v.Company}
	}
	seen := M{}
	for k, v := range dataSt.seen {
		ids := []any{}
		for _, x := range v {
			ids = append(ids, x)
		}
		seen[k] = ids
	}
	if err := saveFile(dataFile(), jsonText(M{"own": own, "chosen": ch, "seen": seen})); err != nil {
		writeLog("Recorder: " + dataFile() + " could not be written: " + err.Error())
	}
}

func dataIn(ids []string, id string) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// under dataSt.mu: FinCom decided this bridge's own location is not read ('other')
func dataStoppedLocked(k string) bool {
	own, ch := dataSt.own[k].ID, dataSt.chosen[k]
	if own == "" {
		return false
	}
	if ch.Own == own && ch.Choice != "" {
		return ch.Choice == "other"
	}
	return len(ch.IDs) > 0 && !dataIn(ch.IDs, own) && ch.Choice != "pending"
}

// a company whose own data location FinCom decided is not read: this bridge stops reading it (nothing of it is asked of
// Tally). A pending one (FinCom has not decided) is not stopped (review H5 of next-241)
func dataStopped(cguid string) bool {
	k := dataKey(cguid)
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	return dataStoppedLocked(k)
}

// whether a line of this data folder is another location's for its company (never asked of Tally, never an entry).
// Decided BEFORE anything of the line is learned (review H1). A line without dp= (an add-on before 2.4.1): as in 2.4.0,
// unless this bridge stopped reading the company (H2)
func dataOther(cguid, dp string) bool {
	id, k := dataIDOf(dp), dataKey(cguid)
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	stopped := dataStoppedLocked(k)
	if id == "" {
		return stopped
	}
	own, ch := dataSt.own[k].ID, dataSt.chosen[k]
	switch {
	case own != "" && id == own:
		return stopped
	case own != "":
		// a known own id is replaced only by FinCom's choice: a location FinCom reads while the own one it is not
		return !(dataIn(ch.IDs, id) && !dataIn(ch.IDs, own))
	case len(ch.IDs) > 0:
		return !dataIn(ch.IDs, id)
	}
	return false // nothing proven, nothing chosen: a candidate (its own fetch may prove it: dataProve)
}

// under live.mu: the line's entry came from this bridge's own Tally by its MasterID, under the line's own GUID (or the
// GUID its MasterID makes, for a new entry's placeholder) with an AlterID above the line's: the line's data folder is
// this bridge's own (review H1). Only a line of this Windows user; a known own id only by FinCom's choice
func dataProve(c *change, x string) {
	if c.dataId == "" || strings.TrimSpace(c.winUser) == "" || !liveUserSame(c.winUser, liveWinUserFn()) || c.byNumber {
		return
	}
	want := strings.TrimSpace(c.addonGuid)
	if want == "" || livePlaceholder(want) {
		if toI64(c.masterId) <= 0 || c.companyGuid == "" {
			return
		}
		want = fmt.Sprintf("%s-%08x", c.companyGuid, toI64(c.masterId))
	}
	if !strings.EqualFold(tagValue(x, "GUID"), want) || toI64(tagNum(x, "ALTERID")) <= c.lineAlter {
		return
	}
	// the re-review's H1-r(b): a line with a narration proves only when Tally's is the same (a forked copy's entry under the
	// same MasterID and GUID is another entry)
	if !dataNarrSame(c.addonNarr, tagValue(x, "NARRATION")) {
		return
	}
	k := dataKey(c.companyGuid)
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	if dataForkedLocked(k) {
		return
	}
	was, ch := dataSt.own[k], dataSt.chosen[k]
	if was.ID == c.dataId {
		return
	}
	if was.ID != "" && !(dataIn(ch.IDs, c.dataId) && !dataIn(ch.IDs, was.ID)) {
		return
	}
	if was.ID == "" && len(ch.IDs) > 0 && !dataIn(ch.IDs, c.dataId) {
		return
	}
	dataSt.own[k] = dataOwnSt{ID: c.dataId, Path: c.dataPath, Company: c.company, CGUID: c.companyGuid, W: c.winUser, At: nowFn().In(liveZone).Format("2006-01-02T15:04:05")}
	dataSave()
	if was.ID != "" {
		writeLog("Recorder: " + c.company + ": FinCom reads the company from " + c.dataPath + ", and this bridge's own Tally has it there now (was " + was.Path + ")")
	} else {
		writeLog("Recorder: " + c.company + ": this bridge's own Tally has the company's data in " + c.dataPath)
	}
}

// the re-review of next-241, H1-r(b): two forked copies of one company continue the same MasterID, GUID and number
// sequences, so Tally's answer by MasterID cannot tell them apart. The data folders THIS Windows user's lines named for a
// company are kept (recorder-data.json, at most dataSeenMax); while there are two or more and FinCom has chosen none of
// them, nothing is proven (dataProve): every one goes as a candidate (FinCom keeps them pending, with the alert)
const dataSeenMax = 20

func dataSeenNote(cguid, id, w string) {
	if id == "" || strings.TrimSpace(w) == "" || !liveUserSame(w, liveWinUserFn()) {
		return
	}
	k := dataKey(cguid)
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	if k == "" || dataIn(dataSt.seen[k], id) || len(dataSt.seen[k]) >= dataSeenMax {
		return
	}
	dataSt.seen[k] = append(dataSt.seen[k], id)
	dataSave()
}

// under dataSt.mu: two or more folders of this user for the company, none of them chosen by FinCom
func dataForkedLocked(k string) bool {
	seen := dataSt.seen[k]
	if len(seen) < 2 {
		return false
	}
	for _, id := range seen {
		if dataIn(dataSt.chosen[k].IDs, id) {
			return false
		}
	}
	return true
}

// the same narration: control characters and runs of white space as one space, trimmed; a cut line (liveNarrMax) by its
// start
func dataNarrSame(line, tally string) bool {
	n := func(s string) string {
		return strings.Join(strings.Fields(dataClean(strings.ReplaceAll(strings.ReplaceAll(s, "\r", " "), "\n", " "))), " ")
	}
	a, b := n(line), n(tally)
	if a == "" {
		return true
	}
	if len([]rune(line)) >= liveNarrMax {
		return strings.HasPrefix(b, a[:len(a)/2])
	}
	return a == b
}

// this bridge's own (proven) data id of a company ("" : not known)
func dataOwnID(cguid string) string {
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	return dataSt.own[dataKey(cguid)].ID
}

// the heartbeat's dataSources: this bridge's own (proven) data id per company, at most 50
func dataBeat() []any {
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	var ks []string
	for k := range dataSt.own {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	out := []any{}
	for _, k := range ks {
		if len(out) >= 50 {
			break
		}
		o := dataSt.own[k]
		out = append(out, M{"company": o.Company, "company_guid": o.CGUID, "data_id": o.ID, "path": o.Path, "w": o.W, "at": o.At})
	}
	return out
}

// FinCom's beat answer: dataSources [{company, company_guid, dataId (the own one it was told of), chosenIds [...], choice
// (chosen | pending | other), chosenId (the first chosen, for an older reader)}]. A company not named keeps what was known
func applyDataSources(j M) {
	list, had := j["dataSources"]
	if !had || list == nil {
		return
	}
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	changed := false
	for _, x := range arr(list) {
		e := obj(x)
		k := dataKey(str(e["company_guid"]))
		if k == "" {
			continue
		}
		var ids []string
		for _, y := range arr(e["chosenIds"]) {
			if id := strings.ToLower(strings.TrimSpace(str(y))); dataHexID(id) && !dataIn(ids, id) {
				ids = append(ids, id)
			}
		}
		if id := strings.ToLower(strings.TrimSpace(str(e["chosenId"]))); len(ids) == 0 && dataHexID(id) {
			ids = append(ids, id)
		}
		own, choice := strings.ToLower(strings.TrimSpace(str(e["dataId"]))), str(e["choice"])
		if choice == "" && own != "" && len(ids) > 0 {
			choice = map[bool]string{true: "chosen", false: "other"}[dataIn(ids, own)]
		}
		if choice != "" && choice != "chosen" && choice != "pending" && choice != "other" {
			continue
		}
		was := dataSt.chosen[k]
		now := dataChoiceSt{IDs: ids, Own: own, Choice: choice, Company: cutRunes(dataClean(str(e["company"])), 200)}
		if strings.Join(was.IDs, ",") == strings.Join(now.IDs, ",") && was.Own == now.Own && was.Choice == now.Choice {
			continue
		}
		wasStopped := dataStoppedLocked(k)
		dataSt.chosen[k] = now
		changed = true
		switch st := dataStoppedLocked(k); {
		case st && !wasStopped:
			writeLog("Recorder: " + or(now.Company, k) + ": FinCom reads the company from another data location; this bridge stops reading it (its saves go to FinCom as another data location's)")
		case !st && wasStopped:
			writeLog("Recorder: " + or(now.Company, k) + ": FinCom reads this bridge's data location of the company again")
		}
	}
	if changed {
		dataSave()
	}
}
