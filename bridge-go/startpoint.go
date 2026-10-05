// Round 18 (2.1.9, the owner's rule of 04-Oct-2026): reading is prospective only. Each company's starting point is its
// highest AlterIDs (ALTVCHID for entries, ALTMSTID for masters) on the first FinComCompany answer the bridge sees for it,
// kept in sync\start-point.json once: never moved. Round 19: one entry per company and GUID, never overwritten (another
// GUID gets its own entry); a file that cannot be read is never rewritten. Round 20: while it cannot be read the first
// numbers seen are kept for the run and written once it can be (never the later, higher ones); saveFile never removes it. The heartbeat carries the starting points and, from every later FinComCompany
// answer, the latest numbers too; FinCom's cloud compares them. Nothing here asks Tally anything.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	// round 20 (the re-review's Low 2): companyKey|guid -> the numbers first seen while start-point.json could not be
	// read (this run); written, never replaced by later numbers, once the file can be read again
	spPending = map[string]M{}
	// round 21: companyKey -> how many FinComCompany answers with numbers this run (a light check sees whether its own
	// answer gave numbers)
	spSeq = map[string]int{}
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
	spLatest[company] = M{"altvchid": altV, "altmstid": altM, "at": spNow()}
	spSeq[companyKey(company)]++
	if guid != "" {
		spGUID[company] = guid
	}
	if altV <= 0 {
		return // 2.2.0 (the owner's finding): never 0 or empty as a starting point; the latest numbers are noted
	}
	all, ok := readStartPoints()
	if !ok {
		// round 20 (Low 2): the first numbers seen are kept for the run (later, higher ones never replace them)
		if k := companyKey(company) + "|" + guid; spPending[k] == nil {
			spPending[k] = M{"company": company, "guid": guid, "altvchid": altV, "altmstid": altM, "at": spNow()}
		}
		if spBadLogged != startPointFile() {
			spBadLogged = startPointFile()
			writeLog(fmt.Sprintf("Company %s: %s could not be read (cut short, or held by another program): it is not rewritten; the starting point is recorded when the file can be read again", company, startPointFile()))
		}
		return
	}
	if !spRecordPending(all) {
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
	all[k] = M{"company": company, "guid": guid, "altvchid": altV, "altmstid": altM, "at": spNow()}
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

// round 20 (Low 2): the numbers first seen while the file could not be read, written now that it can be (under spMu, the
// file read as all): an entry already recorded for that company and GUID is kept and the pending one dropped. False:
// the file could not be written (the pending numbers stay for the next answer)
func spRecordPending(all M) bool {
	if len(spPending) == 0 {
		return true
	}
	var added []M
	for k, e := range spPending {
		company, guid := str(e["company"]), str(e["guid"])
		mine := startPointsOf(all, company)
		had := guid == "" && len(mine) > 0
		for _, x := range mine {
			if str(x["guid"]) == guid {
				had = true
			}
		}
		if had {
			delete(spPending, k)
			continue
		}
		all[k] = e
		added = append(added, e)
	}
	if len(added) == 0 {
		return true
	}
	if err := saveFile(startPointFile(), jsonText(all)); err != nil {
		writeLog(fmt.Sprintf("The starting points first seen while %s could not be read are not written yet: %s", startPointFile(), err.Error()))
		for _, e := range added {
			delete(all, companyKey(str(e["company"]))+"|"+str(e["guid"]))
		}
		return false
	}
	spBadLogged = ""
	for _, e := range added {
		delete(spPending, companyKey(str(e["company"]))+"|"+str(e["guid"]))
		writeLog(fmt.Sprintf("Company %s: its starting point is recorded: ALTVCHID=%d, ALTMSTID=%d, the numbers first seen at %s while %s could not be read (reading is prospective only: the bridge follows what changes after this)",
			str(e["company"]), toI64(e["altvchid"]), toI64(e["altmstid"]), str(e["at"]), startPointFile()))
	}
	return true
}

// the starting points as the file has them, with the numbers still pending (first seen while it could not be read)
// added where the file has none: the beat and startPointOf carry them meanwhile (under spMu)
func spWithPending(all M) M {
	out := M{}
	for k, v := range all {
		out[k] = v
	}
	for k, e := range spPending {
		if _, ok := out[k]; !ok {
			out[k] = e
		}
	}
	return out
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
	spFresh()
	all, _ := readStartPoints()
	all = spWithPending(all)
	e, _ := startPointPick(startPointsOf(all, company), held, spGUID[company])
	if e == nil {
		return 0, false
	}
	return toI64(e["altvchid"]), true
}

// for the heartbeat: {company: {altvchid, altmstid, at, guid, otherGuids?: [{guid, altvchid, altmstid, at}]}}
func startPointBeat() M {
	all := func() M {
		spMu.Lock()
		defer spMu.Unlock()
		spFresh()
		a, _ := readStartPoints()
		return spWithPending(a)
	}()
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
		spPending, spSeq = map[string]M{}, map[string]int{}
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

// the recorder's holding file for a company (<GUID>.txt, or name-<company>.txt; 2.2.2: or the live add-on's daily
// <GUID>-<yyyymmdd>.txt) in the recorder folder: written in the last 7 days, and its last-write time ("" when there is none)
func recorderHolding(company, guid string) (bool, string) {
	var newest time.Time
	var names []string
	if plainFileName(guid) {
		names = append(names, guid+".txt")
	}
	if plainFileName(company) {
		names = append(names, "name-"+company+".txt")
	}
	// round 20 (the re-review's Medium 1): C:\ProgramData\FinCom and recorder\ checked first
	dir, ok := recorderDirChecked()
	if !ok {
		return false, ""
	}
	// 2.2.2: the live add-on's daily files, <GUID>-<yyyymmdd>.txt (any case), count as well: the newest one holding at
	// least one valid recorder line of that GUID (review L6, security L7). The folder is listed at most once in 10 s
	if plainFileName(guid) {
		for _, f := range liveDailyFiles(dir) {
			if g := reLiveFileAnyCase.FindStringSubmatch(filepath.Base(f.name)); g != nil && strings.EqualFold(g[1], guid) && f.mod.After(newest) && dailyHasLine(dir, f, guid) {
				newest = f.mod
			}
		}
	}
	for _, n := range names {
		if fi, err := os.Lstat(filepath.Join(dir, n)); err == nil && fi.Mode().IsRegular() && fi.ModTime().After(newest) {
			newest = fi.ModTime()
		}
	}
	if newest.IsZero() {
		return false, ""
	}
	return time.Since(newest) <= 7*24*time.Hour, newest.Format("2006-01-02T15:04:05")
}

var (
	reLiveFileAnyCase = regexp.MustCompile(`(?i)^(.+)-(\d{8}|\d{4}-\d{2}-\d{2})\.txt$`)
	dailyMu           sync.Mutex
	dailyAt           time.Time
	dailyDirMod       time.Time
	dailyDir          string
	dailyList         []dailyFile
	dailyValid        = map[string]bool{} // name|size|time|guid -> it holds a valid line of that GUID
)

type dailyFile struct {
	name string
	mod  time.Time
	size int64
}

// the recorder folder's .txt files (any case), listed at most once in 10 s
func liveDailyFiles(dir string) []dailyFile {
	dailyMu.Lock()
	defer dailyMu.Unlock()
	var mod time.Time
	if fi, err := os.Stat(dir); err == nil {
		mod = fi.ModTime()
	}
	if dir == dailyDir && mod.Equal(dailyDirMod) && time.Since(dailyAt) < 10*time.Second {
		return dailyList // nothing added or removed since (a file written to changes its own time: it is read below)
	}
	dailyDir, dailyDirMod, dailyAt, dailyList = dir, mod, time.Now(), nil
	es, _ := os.ReadDir(dir)
	for _, e := range es {
		if !e.Type().IsRegular() || !strings.EqualFold(filepath.Ext(e.Name()), ".txt") {
			continue
		}
		if fi, err := e.Info(); err == nil {
			dailyList = append(dailyList, dailyFile{e.Name(), fi.ModTime(), fi.Size()})
		}
	}
	return dailyList
}

// a daily file holds at least one valid recorder line of that company GUID (its first 64 KB, read shared)
func dailyHasLine(dir string, f dailyFile, guid string) bool {
	k := f.name + "|" + fmt.Sprint(f.size) + "|" + f.mod.String() + "|" + strings.ToLower(guid)
	dailyMu.Lock()
	v, had := dailyValid[k]
	dailyMu.Unlock()
	if had {
		return v
	}
	ok := false
	if b, _, err := readSharedFrom(filepath.Join(dir, f.name), 0, 64<<10); err == nil {
		for _, l := range parseRecorderText(decodeRecorderText(b)) {
			if strings.EqualFold(strings.TrimSpace(l.CGUID), guid) {
				ok = true
				break
			}
		}
	}
	dailyMu.Lock()
	if len(dailyValid) > 500 {
		dailyValid = map[string]bool{}
	}
	dailyValid[k] = ok
	dailyMu.Unlock()
	return ok
}

// round 19 (review finding 8): asked again right after the light check took the Tally lock (it may have waited behind
// a read): a posting going, this bridge took the company's lease, or an import is going: it gives way. Round 21
// (2.1.10): a posting going (postingGoing), not any job of the last 12 hours: an interrupted or waiting job never
// holds the light check back
func lightCheckYield(company string) func() bool {
	return func() bool { return postingGoing() || leaseHeldHere(company) || importsInFlight.Load() > 0 }
}

// round 21 (2.1.10): the light check's own log: one line per check (recorded, unchanged, or skipped and why). A skip
// for the same reason is said once per company and reason every 10 minutes (the heartbeat turns every 30 s). Round 22
// (the 2.1.10 code review's Low 6): the reason is compared by its class (its words without digits: an error's own
// seconds or "next at hh:mm:ss" make no new line), the line keeps the full words, and a key older than an hour is
// dropped; "unchanged" is said at most once an hour per company (lcUnchanged)
var (
	lcMu        sync.Mutex
	lcSkipped   = map[string]time.Time{} // company|class of why -> when said
	lcUnchanged = map[string]time.Time{} // company -> when "unchanged" was last said
)

// a skip reason's class: its words without digits
func skipClass(why string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return -1
		}
		return r
	}, why)
}

func lightSkip(company, why string) {
	k := companyKey(company) + "|" + skipClass(why)
	now := nowFn()
	lcMu.Lock()
	for key, at := range lcSkipped {
		if now.Sub(at) >= time.Hour {
			delete(lcSkipped, key)
		}
	}
	last, had := lcSkipped[k]
	if had && now.Sub(last) < 10*time.Minute && !now.Before(last) {
		lcMu.Unlock()
		return
	}
	lcSkipped[k] = now
	lcMu.Unlock()
	if company == "" {
		writeLog("Light check: skipped: " + why)
		return
	}
	writeLog("Light check of " + company + ": skipped: " + why)
}

// why the light check cannot go now ("" : it may). Round 21 (2.1.10): "Pause background reading" does not hold it
// back: the pause was for the old heavy reads (the Day Book rounds), all off now, and this is the only read left
func lightCheckBlocked() string {
	if st := readStop(); st != nil {
		why := "reading is stopped"
		if str(st["by"]) == "fincom" {
			why += " from FinCom"
		} else {
			why += " by the bridge itself"
		}
		if r := str(st["reason"]); r != "" {
			why += " (" + cutRunes(r, 80) + ")"
		}
		return why
	}
	if postingGoing() {
		return "a posting is going (the check goes after it)"
	}
	return ""
}

// round 21 (2.1.10): the company list the bridge holds, asked afresh with the light company-list request
// (TDSDeskCompanies, on the allow-list) when it is older than 10 minutes, or was never asked, and Tally is open: a
// company opened since is seen. A company not seen before also gets the light, undated company-info request
// (TDSDeskCompanyInfo: its GSTIN and PAN, once; on the allow-list). As a background read: a posting goes first (the list
// held stays then). Round 22 (the 2.1.10 code review's Low 7): the list is marked fresh only when Tally gave it afresh;
// when it gave way or did not answer, its age stays as it was, so it is asked again at the next turn
func lightCompanyList(sessions []M) []M {
	shared := filepath.Join(syncDir(), "open-companies.json")
	before, had := mtime(shared)
	if had && nowFn().Sub(before) < 10*time.Minute {
		return sessions
	}
	open := false
	for _, s := range sessions {
		if s["skipped"] != true && s["ok"] == true {
			open = true
		}
	}
	if !open {
		return sessions
	}
	fresh, ok := openCompaniesAsk(&TC{copier: true, light: true, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }}, true)
	switch {
	case ok:
		_ = os.Chtimes(shared, nowFn(), nowFn()) // its age by the bridge's clock
	case had:
		_ = os.Chtimes(shared, before, before) // not given afresh: as old as it was
	default:
		old := nowFn().Add(-time.Hour)
		_ = os.Chtimes(shared, old, old)
	}
	return fresh
}

// the owner's addition of 04-Oct-2026: a company seen open in Tally for the first time in this run, and at most every
// 10 minutes while it stays open, gets the light FinComCompany request (its GUID and change numbers; nothing else is
// asked). As a background read: a posting goes first. The sessions are the company list the bridge already holds,
// asked afresh when it is older than 10 minutes (round 21). Round 21 (2.1.10): it runs while background reading is
// paused; it stops for a stop of reading (FinCom's, or the bridge's own) and for a posting going; each check says in
// the log what it found
func lightCheckOpen(sessions []M) {
	if why := lightCheckBlocked(); why != "" {
		names := 0
		for _, s := range sessions {
			if s["skipped"] == true || s["ok"] != true {
				continue
			}
			for _, c := range sessCompanies(s) {
				if name := str(c["name"]); name != "" && lightDue(name) {
					lightSkip(name, why)
					names++
				}
			}
		}
		if names == 0 {
			lightSkip("", why)
		}
		return
	}
	sessions = lightCompanyList(sessions)
	for _, s := range sessions {
		if s["skipped"] == true || s["ok"] != true {
			continue
		}
		port := toInt(s["port"])
		for _, c := range sessCompanies(s) {
			name := str(c["name"])
			if name == "" || !lightDue(name) {
				continue
			}
			// a posting goes first (the owner, 04-Oct-2026): while a posting is going, or while this bridge holds the
			// company's lease (a posting holds it), nothing is sent and the company is not marked, so the check goes at
			// the next turn after the posting (the same rule as the copier's, keep.go)
			if why := lightCheckBlocked(); why != "" {
				lightSkip(name, why)
				return
			}
			if leaseHeldHere(name) {
				lightSkip(name, "this bridge holds the company for a posting (the check goes after it)")
				continue
			}
			now, due := lightMark(name)
			if !due {
				continue
			}
			_, had := startPointOf(name)
			seq := spSeqOf(name)
			if _, err := companyCheck(&TC{copier: true, light: true, yield: lightCheckYield(name)}, name, port); err != nil {
				// not marked: it goes again at the next turn
				spMu.Lock()
				if spChecked[name].Equal(now) {
					delete(spChecked, name)
				}
				spMu.Unlock()
				if gaveWay(err) {
					lightSkip(name, "it gave way to a posting (the check goes after it)")
					continue
				}
				lightSkip(name, "Tally did not answer ("+cutRunes(err.Error(), 160)+")")
				continue
			}
			if spSeqOf(name) == seq {
				lightSkip(name, "Tally gave no change numbers for it")
				continue
			}
			lightLogResult(name, had)
			// 2.2.0: the recorder's source B (Tally's change list), when it is the source or one of them
			liveAfterLightCheck(name, port)
		}
	}
}

// due: not checked in this run, or the last check 10 minutes ago or more
func lightDue(name string) bool {
	now := nowFn()
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	last, had := spChecked[name]
	return !had || now.Sub(last) >= 10*time.Minute
}

// due, and then marked as checked at the time returned (unmarked by that time when the check does not go)
func lightMark(name string) (time.Time, bool) {
	now := nowFn()
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	last, had := spChecked[name]
	if had && now.Sub(last) < 10*time.Minute {
		return now, false
	}
	spChecked[name] = now
	return now, true
}

// the check's one line: the starting point recorded now, or unchanged with the latest numbers
func lightLogResult(name string, had bool) {
	cur, _ := latestNumbers(name)
	if cur == nil {
		lightSkip(name, "Tally gave no change numbers for it")
		return
	}
	v, m := toI64(cur["altvchid"]), toI64(cur["altmstid"])
	sp, ok := startPointOf(name)
	switch {
	case !ok:
		writeLog(fmt.Sprintf("Light check of %s: no starting point recorded (start-point.json could not be written; see above); now ALTVCHID=%d, ALTMSTID=%d", name, v, m))
	case !had:
		writeLog(fmt.Sprintf("Light check of %s: starting point recorded (ALTVCHID=%d, ALTMSTID=%d)", name, sp, m))
	default:
		// round 22 (Low 6): at most once an hour per company
		k, now := companyKey(name), nowFn()
		lcMu.Lock()
		last, said := lcUnchanged[k]
		if said && now.Sub(last) < time.Hour && !now.Before(last) {
			lcMu.Unlock()
			return
		}
		lcUnchanged[k] = now
		lcMu.Unlock()
		writeLog(fmt.Sprintf("Light check of %s: unchanged starting point ALTVCHID=%d; now ALTVCHID=%d, ALTMSTID=%d", name, sp, v, m))
	}
}

// the latest FinComCompany numbers of a company in this run ({altvchid, altmstid, at}) and the GUID that answer gave;
// nil when it was not checked in this run
func latestNumbers(company string) (M, string) {
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	ck := companyKey(company)
	for c, v := range spLatest {
		if companyKey(c) == ck {
			return v, spGUID[c]
		}
	}
	return nil, ""
}

func spSeqOf(company string) int {
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	return spSeq[companyKey(company)]
}

// the time the starting points and the latest numbers carry (the bridge's clock, so a test can fix it)
func spNow() string { return nowFn().Format("2006-01-02T15:04:05") }
