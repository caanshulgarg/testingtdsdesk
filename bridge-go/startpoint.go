// Round 18 (2.1.9, the owner's rule of 04-Oct-2026): reading is prospective only. Each company's starting point is its
// highest AlterIDs (ALTVCHID for entries, ALTMSTID for masters) on the first FinComCompany answer the bridge sees for it,
// kept in sync\start-point.json once: never moved. Round 19: one entry per company and GUID, never overwritten (another
// GUID gets its own entry); a file that cannot be read is never rewritten. The heartbeat carries the starting points and, from every later FinComCompany
// answer, the latest numbers too; FinCom's cloud compares them. Nothing here asks Tally anything.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// round 19 (review findings 5, 6): the file read as missing (empty, may be written), readable, or unreadable (exists but
// does not parse: never rewritten from that, the numbers stay in memory only and the log says so once)
var spBadLogged string

func readStartPoints() (M, bool) {
	f := startPointFile()
	if _, err := os.Stat(f); err != nil {
		if os.IsNotExist(err) {
			return M{}, true
		}
		return nil, false
	}
	all := readObjFile(f)
	return all, all != nil
}

// the entries of a company: key -> entry
func startPointsOf(all M, company string) map[string]M {
	out := map[string]M{}
	ck := companyKey(company)
	for k, v := range all {
		if e := obj(v); e != nil && companyKey(str(e["company"])) == ck {
			out[k] = e
		}
	}
	return out
}

// a FinComCompany answer: the latest numbers noted; the starting point of the company's GUID recorded when it has none.
// Round 19: one entry per company AND GUID (companyKey|guid), recorded once and never overwritten: a restored copy or a
// second company of the same name open in another Tally gets its own entry and moves nobody's starting point
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
	all, ok := readStartPoints()
	if !ok {
		if spBadLogged != startPointFile() {
			spBadLogged = startPointFile()
			writeLog(fmt.Sprintf("Company %s: %s could not be read (cut short, or held by another program): it is not rewritten; the starting point is recorded when the file can be read again", company, startPointFile()))
		}
		return
	}
	mine := startPointsOf(all, company)
	for _, e := range mine {
		if str(e["guid"]) == guid {
			return // recorded once, never moved
		}
	}
	for k, e := range mine {
		if guid != "" && str(e["guid"]) == "" && len(mine) == 1 {
			// the GUID was not given the first time: noted, the numbers stay
			e["guid"] = guid
			all[k] = e
			if err := saveFile(startPointFile(), jsonText(all)); err != nil {
				writeLog("Company " + company + ": the starting point's GUID could not be written: " + err.Error())
			}
			return
		}
	}
	if guid == "" && len(mine) > 0 {
		return // an answer without a GUID never adds a second entry
	}
	k := companyKey(company) + "|" + guid
	all[k] = M{"company": company, "guid": guid, "altvchid": altV, "altmstid": altM, "at": nowS()}
	if err := saveFile(startPointFile(), jsonText(all)); err != nil {
		writeLog(fmt.Sprintf("Company %s: its starting point could not be written to %s: %s", company, startPointFile(), err.Error()))
		return
	}
	spBadLogged = ""
	if len(mine) == 0 {
		writeLog(fmt.Sprintf("Company %s: its starting point is recorded: ALTVCHID=%d, ALTMSTID=%d (reading is prospective only: the bridge follows what changes after this)", company, altV, altM))
	} else {
		writeLog(fmt.Sprintf("Company %s: Tally gave another GUID (%s); its own starting point is recorded: ALTVCHID=%d, ALTMSTID=%d; the starting point of every other GUID is kept", company, guid, altV, altM))
	}
}

// the entry the bridge goes by for a company: the GUID it holds (or the person confirmed), else the GUID of the latest
// answer this run, else the oldest entry
func startPointPick(mine map[string]M, held, latest string) (M, []M) {
	var pick M
	for _, g := range []string{held, latest} {
		if pick != nil || g == "" {
			continue
		}
		for _, e := range mine {
			if str(e["guid"]) == g {
				pick = e
			}
		}
	}
	if pick == nil {
		for _, e := range mine {
			if pick == nil || str(e["at"]) < str(pick["at"]) {
				pick = e
			}
		}
	}
	var others []M
	for _, e := range mine {
		if pick != nil && str(e["guid"]) != str(pick["guid"]) {
			others = append(others, e)
		}
	}
	return pick, others
}

// a company's starting point (ALTVCHID); false when none is recorded
func startPointOf(company string) (int64, bool) {
	held := heldGUID(company)
	spMu.Lock()
	defer spMu.Unlock()
	all, _ := readStartPoints()
	e, _ := startPointPick(startPointsOf(all, company), held, spGUID[company])
	if e == nil {
		return 0, false
	}
	return toI64(e["altvchid"]), true
}

// for the heartbeat: {company: {altvchid, altmstid, at, guid, otherGuids?: [{guid, altvchid, altmstid, at}]}}
func startPointBeat() M {
	all, _ := func() (M, bool) { spMu.Lock(); defer spMu.Unlock(); return readStartPoints() }()
	names := map[string]string{}
	for _, v := range all {
		if e := obj(v); e != nil && str(e["company"]) != "" {
			names[companyKey(str(e["company"]))] = str(e["company"])
		}
	}
	out := M{}
	for _, c := range names {
		held := heldGUID(c)
		spMu.Lock()
		latest := spGUID[c]
		spMu.Unlock()
		e, others := startPointPick(startPointsOf(all, c), held, latest)
		if e == nil {
			continue
		}
		row := M{"altvchid": toI64(e["altvchid"]), "altmstid": toI64(e["altmstid"]), "at": str(e["at"]), "guid": str(e["guid"])}
		if len(others) > 0 {
			var o []any
			for _, x := range others {
				o = append(o, M{"guid": str(x["guid"]), "altvchid": toI64(x["altvchid"]), "altmstid": toI64(x["altmstid"]), "at": str(x["at"])})
			}
			row["otherGuids"] = o
		}
		out[c] = row
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

// round 19 (review finding 9): a name from Tally used in a file name only when it holds no path separator, no ".." and
// no drive colon (a company name is any text the desk user types)
func plainFileName(s string) bool {
	return strings.TrimSpace(s) != "" && !strings.ContainsAny(s, `/\:`) && !strings.Contains(s, "..")
}

// the recorder's holding file for a company (<GUID>.txt, or name-<company>.txt) in the recorder folder: written in the
// last 7 days, and its last-write time ("" when there is none)
func recorderHolding(company, guid string) (bool, string) {
	var newest time.Time
	var names []string
	if plainFileName(guid) {
		names = append(names, guid+".txt")
	}
	if plainFileName(company) {
		names = append(names, "name-"+company+".txt")
	}
	for _, n := range names {
		if fi, err := os.Lstat(filepath.Join(recorderDirFn(), n)); err == nil && fi.Mode().IsRegular() && fi.ModTime().After(newest) {
			newest = fi.ModTime()
		}
	}
	if newest.IsZero() {
		return false, ""
	}
	return time.Since(newest) <= 7*24*time.Hour, newest.Format("2006-01-02T15:04:05")
}

// round 19 (review finding 8): asked again right after the light check took the Tally lock (it may have waited behind
// a read): a posting job started, this bridge took the company's lease, or an import is going: it gives way
func lightCheckYield(company string) func() bool {
	return func() bool { return len(activeJobs()) > 0 || leaseHeldHere(company) || importsInFlight.Load() > 0 }
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
			if _, err := companyCheck(&TC{copier: true, yield: lightCheckYield(name)}, name, port); err != nil {
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
