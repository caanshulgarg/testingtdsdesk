// 2.4.1 (the owner's approval of 09-Oct-2026, items 1-2; docs/bridge-2.4.1-notes.md): two copies of a company must never
// mix. On 09-Oct the owner opened GARG SHEKHAR & COMPANY (one company GUID) in two Tallys with different data folders; both
// add-ons wrote into the one recorder folder and the owner's bridge took the second copy's lines (Sales 2026-27/GST/297,
// whose MasterID 25743 is an older voucher in the owner's own Tally).
//
// The add-on now writes the company's data folder on every line ("|dp=<path>", recorderline.go). Here:
//   - the data id of a folder: sha256 of its case-folded, trimmed path, the first 16 hex characters (dataIDOf); the path
//     itself is kept for display only;
//   - the bridge learns its OWN Tally's data id per company (company GUID) from its own add-on lines: w= this Windows user,
//     the company open in its own Tally (liveTake has checked that), the most recent dp (dataLearn);
//   - FinCom's beat answer names the chosen data id of each company (dataSources: tally_company_sources, migration 71):
//     kept in sync\recorder-data.json with the own ids;
//   - a line whose data id is not the one this bridge reads (the chosen one when FinCom named it, else the own one), or any
//     line of a company whose own data id is not the chosen one (the bridge stops reading that company), is never asked of
//     Tally and never sent as an entry: it goes as event "other_source" (the company, its GUID, the data id, the path, w=,
//     the computer, the line's date, type and number, nothing of the entry: wire);
//   - a line without dp= (an older add-on, or the add-on's placeholder formula) is as in 2.4.0.
//
// The heartbeat carries the own data ids (dataSources); every line the bridge reads from its own Tally carries the own data
// id (data_id), so FinCom holds anything of a data id that is not the chosen one. Nothing here asks Tally anything.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
)

type dataOwnSt struct {
	ID, Path, Company, CGUID, W, At string
}

type dataChoiceSt struct {
	ID, Company string
}

var dataSt struct {
	mu     sync.Mutex
	dir    string                  // the sync folder it belongs to ("" : not loaded)
	own    map[string]dataOwnSt    // company GUID (lower case) -> this bridge's own data id
	chosen map[string]dataChoiceSt // company GUID (lower case) -> the data id FinCom reads ("" : none named)
}

func dataFile() string { return sp("recorder-data.json") }

// the data id of a data folder ("" for none)
func dataIDOf(path string) string {
	p := strings.ToLower(strings.TrimSpace(path))
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

// under dataSt.mu
func dataFresh() {
	d := syncDir()
	if dataSt.dir == d && dataSt.own != nil {
		return
	}
	dataSt.dir = d
	dataSt.own, dataSt.chosen = map[string]dataOwnSt{}, map[string]dataChoiceSt{}
	o := readObjFile(dataFile())
	for k, v := range obj(o["own"]) {
		e := obj(v)
		if id := str(e["id"]); len(id) == 16 {
			dataSt.own[k] = dataOwnSt{ID: id, Path: str(e["path"]), Company: str(e["company"]), CGUID: str(e["cguid"]), W: str(e["w"]), At: str(e["at"])}
		}
	}
	for k, v := range obj(o["chosen"]) {
		e := obj(v)
		if id := str(e["id"]); len(id) == 16 {
			dataSt.chosen[k] = dataChoiceSt{ID: id, Company: str(e["company"])}
		}
	}
}

// under dataSt.mu
func dataSave() {
	own, ch := M{}, M{}
	for k, v := range dataSt.own {
		own[k] = M{"id": v.ID, "path": v.Path, "company": v.Company, "cguid": v.CGUID, "w": v.W, "at": v.At}
	}
	for k, v := range dataSt.chosen {
		ch[k] = M{"id": v.ID, "company": v.Company}
	}
	if err := saveFile(dataFile(), jsonText(M{"own": own, "chosen": ch})); err != nil {
		writeLog("Recorder: " + dataFile() + " could not be written: " + err.Error())
	}
}

// a line taken by liveTake (its company open in this bridge's own Tally): a line of this Windows user with a data folder
// teaches the company's own data id (the most recent one)
func dataLearn(l recLine) {
	id, k := dataIDOf(l.DP), dataKey(l.CGUID)
	if id == "" || k == "" || strings.TrimSpace(l.W) == "" || !liveUserSame(l.W, liveWinUserFn()) {
		return
	}
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	was := dataSt.own[k]
	if was.ID == id && was.Path == strings.TrimSpace(l.DP) {
		return
	}
	dataSt.own[k] = dataOwnSt{ID: id, Path: cutRunes(strings.TrimSpace(l.DP), 260), Company: strings.TrimSpace(l.CName), CGUID: liveGUID(strings.TrimSpace(l.CGUID)),
		W: strings.TrimSpace(l.W), At: nowFn().In(liveZone).Format("2006-01-02T15:04:05")}
	dataSave()
	if was.ID != "" {
		writeLog("Recorder: " + strings.TrimSpace(l.CName) + ": this bridge's own Tally now has the company's data in " + strings.TrimSpace(l.DP) + " (was " + was.Path + ")")
	}
}

// the data id this bridge reads for a company: the chosen one when FinCom named it and this bridge's own is it (or its own
// is not known), the own one when FinCom named none; stopped: FinCom reads another data id than this bridge's own
func dataReads(cguid string) (id string, stopped bool) {
	k := dataKey(cguid)
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	own, ch := dataSt.own[k].ID, dataSt.chosen[k].ID
	switch {
	case ch != "" && own != "" && own != ch:
		return "", true
	case ch != "":
		return ch, false
	}
	return own, false
}

// a company whose own data id is not the one FinCom reads: this bridge stops reading it (nothing of it is asked of Tally)
func dataStopped(cguid string) bool {
	_, s := dataReads(cguid)
	return s
}

// whether a line of this data folder is another source's for its company (never asked of Tally, never an entry)
func dataOther(cguid, dp string) bool {
	id := dataIDOf(dp)
	if id == "" {
		return false // an older add-on, or the add-on's placeholder: as in 2.4.0
	}
	r, stopped := dataReads(cguid)
	return stopped || (r != "" && r != id)
}

// this bridge's own data id of a company ("" : not known)
func dataOwnID(cguid string) string {
	dataSt.mu.Lock()
	defer dataSt.mu.Unlock()
	dataFresh()
	return dataSt.own[dataKey(cguid)].ID
}

// the heartbeat's dataSources: this bridge's own data id per company, at most 50
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

// FinCom's beat answer: dataSources [{company, company_guid, chosenId, chosen}]: the chosen data id of each company named
// (chosenId "" : none chosen). A company not named keeps what was known (an older cloud names none)
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
		id := strings.ToLower(strings.TrimSpace(str(e["chosenId"])))
		if id != "" && (len(id) != 16 || strings.Trim(id, "0123456789abcdef") != "") {
			continue
		}
		was := dataSt.chosen[k]
		if id == "" {
			if was.ID != "" {
				delete(dataSt.chosen, k)
				changed = true
			}
			continue
		}
		if was.ID != id {
			dataSt.chosen[k] = dataChoiceSt{ID: id, Company: cutRunes(str(e["company"]), 200)}
			changed = true
			own := dataSt.own[k]
			switch {
			case own.ID != "" && own.ID != id:
				writeLog("Recorder: " + or(str(e["company"]), k) + ": FinCom reads the company from another data location; this bridge stops reading it (its saves go to FinCom as another data location's)")
			case was.ID != "" && own.ID == id:
				writeLog("Recorder: " + or(str(e["company"]), k) + ": FinCom reads this bridge's data location of the company again")
			}
		}
	}
	if changed {
		dataSave()
	}
}
