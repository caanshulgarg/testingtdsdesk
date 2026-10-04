// Round 18 (2.1.9, the owner's rule of 04-Oct-2026): reading is prospective only. Each company's starting point is its
// highest AlterIDs (ALTVCHID for entries, ALTMSTID for masters) on the first FinComCompany answer the bridge sees for it,
// kept in sync\start-point.json once: never moved, never recorded again unless the company's GUID changes (then it is
// recorded anew and the log says so). The heartbeat carries the starting points and, from every later FinComCompany
// answer, the latest numbers too; FinCom's cloud compares them. Nothing here asks Tally anything.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	spMu      sync.Mutex
	spLatest  = map[string]M{}         // company -> its latest {altvchid, altmstid, at} (this bridge's run)
	spLatestD string                   // the sync folder spLatest belongs to (a test's own folder starts it afresh)
	spGUID    = map[string]string{}    // company -> the GUID its latest FinComCompany answer gave
	spChecked = map[string]time.Time{} // company -> when its light check last went (this run)
)

func startPointFile() string { return sp("start-point.json") }

// a FinComCompany answer: the latest numbers noted; the starting point recorded when there is none (or the GUID changed)
func noteStartPoint(company, guid string, altV, altM int64) {
	if company == "" {
		return
	}
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	spLatest[company] = M{"altvchid": altV, "altmstid": altM, "at": nowS()}
	if guid != "" {
		spGUID[company] = guid
	}
	all := readObjFile(startPointFile())
	if all == nil {
		all = M{}
	}
	k := companyKey(company)
	e := obj(all[k])
	switch {
	case e == nil:
		all[k] = M{"company": company, "guid": guid, "altvchid": altV, "altmstid": altM, "at": nowS()}
		writeLog(fmt.Sprintf("Company %s: its starting point is recorded: ALTVCHID=%d, ALTMSTID=%d (reading is prospective only: the bridge follows what changes after this)", company, altV, altM))
	case guid != "" && str(e["guid"]) != "" && str(e["guid"]) != guid:
		all[k] = M{"company": company, "guid": guid, "altvchid": altV, "altmstid": altM, "at": nowS(),
			"was": M{"guid": e["guid"], "altvchid": e["altvchid"], "altmstid": e["altmstid"], "at": e["at"]}}
		writeLog(fmt.Sprintf("Company %s: its Tally GUID changed (%s, was %s); its starting point is recorded anew: ALTVCHID=%d, ALTMSTID=%d", company, guid, str(e["guid"]), altV, altM))
	case guid != "" && str(e["guid"]) == "":
		e["guid"] = guid // the GUID was not given the first time: noted, the numbers stay
	default:
		return
	}
	_ = saveFile(startPointFile(), jsonText(all))
}

// a company's starting point (ALTVCHID); false when none is recorded
func startPointOf(company string) (int64, bool) {
	spMu.Lock()
	defer spMu.Unlock()
	e := obj(readObjFile(startPointFile())[companyKey(company)])
	if e == nil {
		return 0, false
	}
	return toI64(e["altvchid"]), true
}

// for the heartbeat: {company: {altvchid, altmstid, at}}
func startPointBeat() M {
	spMu.Lock()
	defer spMu.Unlock()
	out := M{}
	for _, v := range readObjFile(startPointFile()) {
		e := obj(v)
		if e != nil && str(e["company"]) != "" {
			out[str(e["company"])] = M{"altvchid": toI64(e["altvchid"]), "altmstid": toI64(e["altmstid"]), "at": str(e["at"])}
		}
	}
	return out
}

// a test's own sync folder starts the run's memory afresh (under spMu)
func spFresh() {
	if spLatestD != syncDir() {
		spLatest, spGUID, spChecked, spLatestD = map[string]M{}, map[string]string{}, map[string]time.Time{}, syncDir()
	}
}

// for the heartbeat: the latest FinComCompany numbers of each company this run, and whether the recorder add-on writes
// for it: {company: {altvchid, altmstid, at, recorderSeen, recorderLastAt}}. FinCom's cloud compares ALTVCHID with the
// highest change number any computer sent: a computer without the add-on shows there
func changeNumbersBeat() M {
	spMu.Lock()
	spFresh()
	type row struct {
		c, guid string
		v       M
	}
	var rows []row
	for c, v := range spLatest {
		rows = append(rows, row{c, spGUID[c], v})
	}
	spMu.Unlock()
	out := M{}
	for _, r := range rows {
		g := r.guid
		if g == "" {
			g = heldGUID(r.c)
		}
		seen, last := recorderHolding(r.c, g)
		e := M{"recorderSeen": seen, "recorderLastAt": last}
		for k, v := range r.v {
			e[k] = v
		}
		out[r.c] = e
	}
	return out
}

// the recorder's holding file for a company (<GUID>.txt, or name-<company>.txt) in the recorder folder: written in the
// last 7 days, and its last-write time ("" when there is none)
func recorderHolding(company, guid string) (bool, string) {
	var newest time.Time
	for _, n := range []string{guid + ".txt", "name-" + company + ".txt"} {
		if n == ".txt" {
			continue
		}
		if fi, err := os.Stat(filepath.Join(recorderDirFn(), n)); err == nil && !fi.IsDir() && fi.ModTime().After(newest) {
			newest = fi.ModTime()
		}
	}
	if newest.IsZero() {
		return false, ""
	}
	return time.Since(newest) <= 7*24*time.Hour, newest.Format("2006-01-02T15:04:05")
}

// the owner's addition of 04-Oct-2026: a company seen open in Tally for the first time in this run, and at most every
// 10 minutes while it stays open, gets the light FinComCompany request (its GUID and change numbers; nothing else is
// asked). As a background read: a posting goes first. The sessions are the company list the bridge already holds
func lightCheckOpen(sessions []M) {
	if readStopped() || paused() || len(activeJobs()) > 0 {
		return
	}
	for _, s := range sessions {
		if s["skipped"] == true || s["ok"] != true {
			continue
		}
		port := toInt(s["port"])
		for _, c := range sessCompanies(s) {
			name := str(c["name"])
			if name == "" {
				continue
			}
			// a posting goes first (the owner, 04-Oct-2026): while a posting job is going, or while this bridge holds the
			// company's lease (a posting holds it), nothing is sent and the company is not marked, so the check goes at
			// the next turn after the posting (the same rule as the copier's, keep.go)
			if len(activeJobs()) > 0 {
				return
			}
			if leaseHeldHere(name) {
				continue
			}
			now := nowFn()
			spMu.Lock()
			spFresh()
			last, had := spChecked[name]
			due := !had || now.Sub(last) >= 10*time.Minute
			if due {
				spChecked[name] = now
			}
			spMu.Unlock()
			if !due {
				continue
			}
			if _, err := companyCheck(&TC{copier: true}, name, port); err != nil {
				if gaveWay(err) {
					// stopped for a posting (or held back): not marked, it goes again at the next turn
					spMu.Lock()
					if spChecked[name].Equal(now) {
						delete(spChecked, name)
					}
					spMu.Unlock()
					continue
				}
				writeLog("Light check of " + name + ": " + err.Error())
			}
		}
	}
}
