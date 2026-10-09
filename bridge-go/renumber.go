// next-renumber (the owner's decision of 08-Oct-2026: "renumbering yes"). A voucher inserted in Tally (Ctrl+I, or made
// back-dated) or deleted, of a voucher type whose numbering renumbers ("Auto Renumber"), makes Tally renumber every later
// voucher of that type silently: no voucher form, so the add-on writes no line for them; their AlterIDs do not move, and
// neither does the company's ALTVCHID for them (tally-versions share runs 37734533866 and 37754251128, P9r, TallyPrime 3.0
// and 7.1: the insert renumbered 4 receipts and moved ALTVCHID 27 -> 28, the insert's own AlterID; the delete renumbered
// 2 and moved it 28 -> 29; every renumbered receipt kept its AlterID). FinCom would keep their old numbers until a Day Book.
//
// The sign is therefore the insert's (a created entry's) or the delete's own line, never the change counter. Once such a
// line has gone to FinCom (a created entry with Tally's body: its type, date, number and MasterID as Tally gives them; a
// delete with the line's own), the bridge:
//  1. asks FinCom's cloud (tally-ingest "renumber_list": read-only, the firm's own book of that company, at most
//     RenumberMax entries, 500) for the entries FinCom holds of that voucher type from that date on (on the same date only
//     those numbered from the inserted / deleted number up), each with its MasterID, GUID, date, number and AlterID;
//  2. re-reads each, in date and number order, with the approved entry request FinComVoucherObject (one MasterID a
//     request, one request at a time, the 2 s rule and the retry schedule, a posting and a waiting save first), at most
//     RenumberPerTurn a turn and one turn every RenumberGapMs;
//  3. sends each whose number Tally changed as an altered line with Tally's body (recorder_lines, source "renumber"), so
//     FinCom stores Tally's number (migration 61: the same AlterID with another number is applied, never "duplicate").
//
// The first later entry unchanged (the type keeps its numbers, Tally's default "Auto Retain"): no renumbering, nothing more
// asked, no alert (2.4.0 review LOW: also when FinCom holds more entries than the cap: the first is checked first). An
// entry at or below the starting point is never named (security M1): after renumbering is seen, such entries are not read
// and are counted. More entries than the cap, or any so counted: one plain alert (the log and the beat; tally-ingest keeps
// it on the computer's beat and FinCom shows it under "Needs you"), never a loop: "N entries may have been renumbered in
// <company>; upload the Day Book from <date>". A company marked slow (its entry fetch over 2 s, slowco.go) is not asked at
// all. Nothing is added to the allow-list: FinComVoucherObject only.
//
// 2.4.0 review HIGH (an entry asked for ever, one job blocking every company's): no entry is asked without end. A 2 s stop
// (or Tally not answering) on an entry: the job waits and that entry is asked ONE more time RecorderStopRetrySec (5
// minutes) later (the owner's answer B, as for 2.3.4's lines); a second stop drops it into the alert. An answer that
// cannot be read, a form FinCom does not read (errFastShape) or an entry that cannot be asked: dropped into the alert at
// once. The company not open in Tally (or Tally's company list not answering): that job waits RenumberPauseSec (5 minutes),
// nothing dropped. While a job waits, the others run. 2.4.0 review MEDIUM: the entries the cloud could not list by
// MasterID (its "unknown") are counted into the alert too, unless the type is seen to keep its numbers.
package main

import (
	"errors"
	"fmt"
	"html"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

func renumMax() int     { return keepNum("RenumberMax", 500) }
func renumPerTurn() int { return keepNum("RenumberPerTurn", 10) }
func renumPause() time.Duration {
	return time.Duration(keepNum("RenumberPauseSec", 300)) * time.Second
}
func renumGap() time.Duration {
	return time.Duration(keepNumZero("RenumberGapMs", 1000)) * time.Millisecond
}

// one entry FinCom holds that Tally may have renumbered
type renumCand struct {
	Mid, GUID, Day, No string
	Alter              int64
}

// a sign (an insert's or a delete's line) and, once FinCom answered, the work it gives
type renumJob struct {
	Key, Company, CGUID, Type, Date, No, Mid, Event, Line, At string
	Asked                                                     bool
	Cands                                                     []renumCand
	Probed                                                    bool // Tally renumbered one: the rest are read without stopping
	Sent, Same, Below                                         int
	BelowFrom                                                 string
	// 2.4.0 review: Wait: not worked on before this time (RFC3339; a stop's one more ask, or the company not open); Stops:
	// the head entry's stops so far; Missed: entries dropped unread (stopped twice, an answer that cannot be read, a form
	// FinCom does not read), from MissedFrom on; Unknown: entries the cloud could not list by MasterID; More: FinCom held
	// more than the cap
	Wait       string
	Stops      int
	Missed     int
	MissedFrom string
	Unknown    int
	More       bool
	CloudFails int // release-240 review M1: FinCom's cloud did not answer renumber_list this many times in a row (the wait doubles)
}

var renum = struct {
	mu     sync.Mutex
	dir    string
	pend   map[string]*renumJob // company|GUID|type -> the earliest sign not worked on yet
	jobs   []*renumJob          // the ones started (2.4.0 review: one waiting never blocks the others), oldest first
	alerts map[string]M         // company key -> the last alert {company, words, n, from, at}
	lastAt time.Time
	said   map[string]bool
	busy   bool
}{}

func renumFile() string { return sp("renumber.json") }

// under renum.mu: the state of this sync folder, loaded once
func renumFresh() {
	if renum.dir == syncDir() && renum.pend != nil {
		return
	}
	renum.dir, renum.pend, renum.jobs, renum.alerts, renum.said = syncDir(), map[string]*renumJob{}, nil, map[string]M{}, map[string]bool{}
	renum.lastAt = time.Time{}
	o := readObjFile(renumFile())
	if o == nil {
		return
	}
	for k, v := range obj(o["pending"]) {
		if j := renumJobOf(obj(v)); j != nil {
			renum.pend[k] = j
		}
	}
	if j := renumJobOf(obj(o["job"])); j != nil { // a file written before 2.4.0: its one job
		renum.jobs = append(renum.jobs, j)
	}
	for _, x := range arr(o["jobs"]) {
		if j := renumJobOf(obj(x)); j != nil {
			renum.jobs = append(renum.jobs, j)
		}
	}
	for k, v := range obj(o["alerts"]) {
		if e := obj(v); e != nil {
			renum.alerts[k] = e
		}
	}
}

func renumJobOf(e M) *renumJob {
	if e == nil || str(e["company"]) == "" {
		return nil
	}
	j := &renumJob{Key: str(e["key"]), Company: str(e["company"]), CGUID: str(e["cguid"]), Type: str(e["type"]), Date: str(e["date"]), No: str(e["no"]),
		Mid: str(e["mid"]), Event: str(e["event"]), Line: str(e["line"]), At: str(e["at"]), Asked: e["asked"] == true, Probed: e["probed"] == true,
		Sent: toInt(e["sent"]), Same: toInt(e["same"]), Below: toInt(e["below"]), BelowFrom: str(e["belowFrom"]),
		Wait: str(e["wait"]), Stops: toInt(e["stops"]), Missed: toInt(e["missed"]), MissedFrom: str(e["missedFrom"]), Unknown: toInt(e["unknown"]), More: e["more"] == true, CloudFails: toInt(e["cloudFails"])}
	for _, x := range arr(e["cands"]) {
		c := obj(x)
		j.Cands = append(j.Cands, renumCand{Mid: str(c["mid"]), GUID: str(c["guid"]), Day: str(c["day"]), No: str(c["no"]), Alter: toI64(c["alter"])})
	}
	return j
}

func (j *renumJob) m() M {
	cs := []any{}
	for _, c := range j.Cands {
		cs = append(cs, M{"mid": c.Mid, "guid": c.GUID, "day": c.Day, "no": c.No, "alter": c.Alter})
	}
	return M{"key": j.Key, "company": j.Company, "cguid": j.CGUID, "type": j.Type, "date": j.Date, "no": j.No, "mid": j.Mid, "event": j.Event, "line": j.Line,
		"at": j.At, "asked": j.Asked, "probed": j.Probed, "sent": j.Sent, "same": j.Same, "below": j.Below, "belowFrom": j.BelowFrom, "cands": cs,
		"wait": j.Wait, "stops": j.Stops, "missed": j.Missed, "missedFrom": j.MissedFrom, "unknown": j.Unknown, "more": j.More, "cloudFails": j.CloudFails}
}

// under renum.mu
func renumSave() {
	p := M{}
	for k, j := range renum.pend {
		p[k] = j.m()
	}
	jobs := []any{}
	for _, j := range renum.jobs {
		jobs = append(jobs, j.m())
	}
	a := M{}
	for k, e := range renum.alerts {
		a[k] = e
	}
	if err := saveFile(renumFile(), jsonText(M{"pending": p, "jobs": jobs, "alerts": a})); err != nil {
		writeLog("Renumbering: " + renumFile() + " could not be written: " + err.Error())
	}
}

// --- the numbers: a voucher number's running part. Two numbers of one series differ only in it (prefix and suffix are
// the series'): compared as whole numbers once the common prefix and suffix are set aside; ok false when they are not
// both digits there
func renumNumCmp(a, b string) (int, bool) {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if a == "" || b == "" {
		return 0, false
	}
	if a == b {
		return 0, true
	}
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	for i > 0 && a[i-1] >= '0' && a[i-1] <= '9' { // a run of digits is compared whole
		i--
	}
	ra, rb := a[i:], b[i:]
	j := 0
	for j < len(ra) && j < len(rb) && ra[len(ra)-1-j] == rb[len(rb)-1-j] {
		j++
	}
	for j > 0 && ra[len(ra)-j] >= '0' && ra[len(ra)-j] <= '9' {
		j--
	}
	da, db := ra[:len(ra)-j], rb[:len(rb)-j]
	if da == "" || db == "" || onlyDigits(da) != da || onlyDigits(db) != db || len(da) > 18 || len(db) > 18 {
		return 0, false
	}
	x, _ := strconv.ParseInt(da, 10, 64)
	y, _ := strconv.ParseInt(db, 10, 64)
	switch {
	case x < y:
		return -1, true
	case x > y:
		return 1, true
	}
	return 0, true
}

// --- 0. the sign: a line FinCom took (liveUploadStep, after a 200). Under live.mu; nil when it is no sign
func renumSignOf(c *change) *renumJob {
	if c.isLedger() || c.source != "addon" || c.companyGuid == "" {
		return nil
	}
	var typ, date, no, mid string
	switch {
	case c.event == "created" && c.xml != "":
		// Tally's own type, date, number and MasterID (the body was taken as this line's entry)
		typ, date, no, mid = tagValue(c.xml, "VOUCHERTYPENAME"), normDate(tagValue(c.xml, "DATE")), tagValue(c.xml, "VOUCHERNUMBER"), onlyDigits(tagNum(c.xml, "MASTERID"))
	case c.event == "deleted":
		// held or not (a delete this computer's Tally could not prove went up held): its type, date and number are the
		// line's, and every entry read again is checked against Tally itself, so nothing is sent on the line's word
		typ, date, no, mid = c.vchType, c.vchDate, c.vchNo, c.masterId
	default:
		return nil
	}
	if typ == "" || len(date) != 8 || !liveNumberText(typ) {
		return nil
	}
	return &renumJob{Key: companyKey(c.company) + "|" + strings.ToLower(c.companyGuid) + "|" + strings.ToLower(typ), Company: c.company, CGUID: c.companyGuid,
		Type: typ, Date: date, No: no, Mid: mid, Event: c.event, Line: strings.TrimSuffix(c.lineId, ":resolved"), At: nowS()}
}

// the signs noted: one waiting per company and voucher type, the earliest (an earlier date, or on the same date a lower
// number) taking the place of a later one
func renumNote(js []*renumJob) {
	if len(js) == 0 {
		return
	}
	renum.mu.Lock()
	defer renum.mu.Unlock()
	renumFresh()
	for _, j := range js {
		old := renum.pend[j.Key]
		if old != nil {
			if old.Date < j.Date {
				continue
			}
			if old.Date == j.Date {
				if c, ok := renumNumCmp(old.No, j.No); ok && c <= 0 {
					continue
				} else if !ok {
					j.No = "" // not comparable: every entry of that day is asked
				}
			}
		}
		renum.pend[j.Key] = j
	}
	renumSave()
}

// --- the beat: the alerts of the last 7 days [{company, words, n, from, at}]
func renumBeat() []any {
	renum.mu.Lock()
	defer renum.mu.Unlock()
	renumFresh()
	o := []any{}
	var ks []string
	for k := range renum.alerts {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		e := renum.alerts[k]
		if at, err := time.Parse("2006-01-02T15:04:05", str(e["at"])); err == nil && nowFn().Sub(at) > 7*24*time.Hour {
			continue
		}
		o = append(o, e)
	}
	return o
}

// under renum.mu: the plain alert, said in the log and carried by the beat
func renumAlert(j *renumJob, n int, more bool, from string) {
	// 2.4.0 review: another job's alert for the company within the 7 days is added to, never overwritten
	if old := renum.alerts[companyKey(j.Company)]; old != nil {
		if at, err := time.Parse("2006-01-02T15:04:05", str(old["at"])); err == nil && nowFn().Sub(at) <= 7*24*time.Hour {
			n += toInt(old["n"])
			more = more || old["more"] == true
			if f := str(old["from"]); f != "" && f < from {
				from = f
			}
		}
	}
	what := fmt.Sprintf("%d entries may have been renumbered", n)
	if n == 1 {
		what = "1 entry may have been renumbered"
	}
	if more {
		what = fmt.Sprintf("more than %d entries may have been renumbered", n)
	}
	words := fmt.Sprintf("%s in %s; upload the Day Book from %s", what, j.Company, liveDay(from))
	renum.alerts[companyKey(j.Company)] = M{"company": j.Company, "words": words, "n": n, "more": more, "from": from, "type": j.Type, "at": nowS()}
	writeLog("Renumbering: " + words + " (" + j.Type + "; Tally renumbers the entries after an inserted or deleted one without any line for them)")
}

// --- 1-3. one turn (liveUploadOnce, when no save waits): the requests made and lines queued
func renumTurn() int {
	if !cloudOn() || postingGoing() {
		return 0
	}
	renum.mu.Lock()
	renumFresh()
	if renum.busy || (len(renum.jobs) == 0 && len(renum.pend) == 0) || (!renum.lastAt.IsZero() && time.Since(renum.lastAt) < renumGap()) {
		renum.mu.Unlock()
		return 0
	}
	// 2.4.0 review HIGH: the oldest job not waiting; none: the earliest sign starts a new one (a job waiting never blocks)
	var j *renumJob
	now := nowFn()
	for _, x := range renum.jobs {
		if dataStopped(x.CGUID) {
			continue // 2.4.1: FinCom reads the company from another data location: nothing of it is read here
		}
		if w, err := time.Parse(time.RFC3339, x.Wait); x.Wait == "" || err != nil || !now.Before(w) {
			j = x
			break
		}
	}
	if j == nil && len(renum.pend) > 0 {
		for _, x := range renum.pend {
			if j == nil || x.At < j.At || (x.At == j.At && x.Key < j.Key) {
				j = x
			}
		}
		delete(renum.pend, j.Key)
		renum.jobs = append(renum.jobs, j)
		renumSave()
	}
	if j == nil {
		renum.mu.Unlock()
		return 0
	}
	j.Wait = ""
	renum.busy, renum.lastAt = true, time.Now()
	renum.mu.Unlock()
	defer func() {
		renum.mu.Lock()
		renum.busy = false
		renum.mu.Unlock()
	}()
	n, done := renumWork(j)
	renum.mu.Lock()
	if done || j.Wait != "" {
		for i, x := range renum.jobs {
			if x == j {
				renum.jobs = append(renum.jobs[:i:i], renum.jobs[i+1:]...)
				break
			}
		}
		if !done {
			renum.jobs = append(renum.jobs, j) // release-240 review M1: a job that waits goes last; the others get their turn
		}
	}
	renumSave()
	renum.mu.Unlock()
	return n
}

// under renum.mu: said once per company and reason in this run
func renumSayOnce(key, text string) {
	if !renum.said[key] {
		renum.said[key] = true
		writeLog(text)
	}
}

// the job's work this turn (not under renum.mu; the job is this turn's alone): the requests made and lines queued, and
// whether the job is over
func renumWork(j *renumJob) (int, bool) {
	held := heldGUID(j.Company)
	if held != "" && !strings.EqualFold(held, j.CGUID) {
		return 0, true // another company's under this name: nothing asked
	}
	if slowMarked(j.Company, j.CGUID) {
		renum.mu.Lock()
		renumSayOnce("slow|"+companyKey(j.Company), "Renumbering: "+j.Company+" is not asked (its entries are not asked of Tally: finding one took longer than 2 s); a renumbered entry keeps its old number in FinCom until that day's Day Book is uploaded")
		renum.mu.Unlock()
		return 0, true
	}
	sp, spOK := startPointOf(j.Company)
	if !spOK {
		return 0, true // nothing of the company's entries is taken before its starting point is recorded
	}
	if !j.Asked {
		r := invokeCloud(M{"kind": "renumber_list", "company": j.Company, "company_guid": j.CGUID, "vtype": j.Type, "from": j.Date, "no": j.No, "mid": j.Mid, "limit": renumMax()}, 30)
		if r.code == 409 {
			return 0, true // not linked: nothing FinCom holds
		}
		if r.code != 200 || r.json == nil || !truthy(r.json["ok"]) {
			// release-240 review M1: never again at the next turn: the job waits (30 s, doubling to 30 minutes) and the
			// other jobs go first meanwhile (renumTurn puts a waiting job last)
			j.CloudFails++
			d := 30 * time.Second
			for i := 1; i < j.CloudFails && d < 30*time.Minute; i++ {
				d *= 2
			}
			if d > 30*time.Minute {
				d = 30 * time.Minute
			}
			renumWaitJob(j, d, "")
			renum.mu.Lock()
			renumSayOnce("cloud|"+j.Key, "Renumbering: FinCom's cloud did not list the "+j.Type+" entries of "+j.Company+" ("+cutRunes(or(r.err, fmt.Sprint("HTTP ", r.code)), 120)+"); asked again later, waiting longer each time")
			renum.mu.Unlock()
			return 0, false
		}
		j.CloudFails = 0
		var cs []renumCand
		for _, x := range arr(r.json["entries"]) {
			e := obj(x)
			c := renumCand{Mid: onlyDigits(str(e["mid"])), GUID: str(e["guid"]), Day: normDate(str(e["day"])), No: str(e["no"]), Alter: toI64(e["alter"])}
			if c.Mid == "" || c.Mid == j.Mid || c.GUID == "" || len(c.Day) != 8 || c.Day < j.Date {
				continue
			}
			cs = append(cs, c)
		}
		// 2.4.0 review LOW: more than the cap is said only once the first later entry shows Tally renumbered (a type that keeps
		// its numbers raises nothing); MEDIUM: the entries the cloud could not list by MasterID are counted the same way
		if truthy(r.json["more"]) || len(cs) > renumMax() {
			j.More = true
		}
		j.Unknown = toInt(r.json["unknown"])
		sort.SliceStable(cs, func(a, b int) bool {
			if cs[a].Day != cs[b].Day {
				return cs[a].Day < cs[b].Day
			}
			if c, ok := renumNumCmp(cs[a].No, cs[b].No); ok {
				return c < 0
			}
			return cs[a].No < cs[b].No
		})
		if len(cs) > renumMax() {
			cs = cs[:renumMax()]
		}
		j.Cands, j.Asked = cs, true
		writeLog(fmt.Sprintf("Renumbering: %s %s %s of %s in %s: FinCom holds %d later %s entr%s; each is read again from Tally to see whether Tally renumbered it",
			map[bool]string{true: "deleted", false: "made"}[j.Event == "deleted"], j.Type, or(j.No, "(no number)"), liveDay(j.Date), j.Company, len(cs), j.Type, map[bool]string{true: "y", false: "ies"}[len(cs) == 1]))
	}
	if len(j.Cands) == 0 {
		return renumFinish(j), true
	}
	port, err := ownPortErr("Renumbering", j.Company, j.CGUID)
	if err != nil {
		renumWaitJob(j, renumPause(), "Renumbering: "+j.Company+" is not open in Tally ("+cutRunes(err.Error(), 120)+"); its renumbering check waits, the other companies' go on")
		return 0, false
	}
	tc := recorderTC(nil)
	asked, queued := 0, 0
	for len(j.Cands) > 0 && asked < renumPerTurn() {
		if postingGoing() || renumLiveWaits() {
			break // a posting, or a save read from the add-on, goes first
		}
		c := j.Cands[0]
		if j.Probed && c.Alter > 0 && c.Alter <= sp {
			// security M1: never named; renumbering is seen already, so it is counted, not read
			j.Below++
			if j.BelowFrom == "" || c.Day < j.BelowFrom {
				j.BelowFrom = c.Day
			}
			j.Cands = j.Cands[1:]
			continue
		}
		// next-bankdate: an entry the bank route read since this sign was noted is not read again (bankdate.go)
		var got map[string]string
		var err error
		shared := false
		if e, ok := vchReadGet(j.CGUID, c.Mid); ok && renumReadAfter(j, e.at) {
			got, shared = map[string]string{c.Mid: e.x}, e.sent
		} else {
			got, err = fetchVouchersByMasterIn(tc, j.Company, port, c.Day, []string{c.Mid}, liveBodySec())
			asked++
			if err == nil {
				vchReadPut(j.CGUID, c.Mid, got[c.Mid], false)
			}
		}
		switch {
		case err == nil:
		case errors.Is(err, errSlowCompany):
			// marked slow meanwhile: the entries not read are left to the Day Book, and said
			for _, r := range j.Cands {
				renumMiss(j, r)
			}
			j.Cands = nil
			return asked + queued + renumFinish(j), true
		case errors.Is(err, errRetryWait) || errors.Is(err, errPreempted) || errors.Is(err, errReadStopped):
			// nothing reached Tally (the retry schedule waiting, a posting first, reading stopped from FinCom): this turn ends
			// here, nothing counted; the schedule says when Tally is asked again
			return asked + queued, false
		case errors.Is(err, errRecorderStop) || tallyNoAnswer(err):
			// 2.4.0 review HIGH (the owner's answer B): stopped at 2 s, or not answered: asked ONE more time 5 minutes later
			// (the job waits; the others run); a second time: dropped into the alert
			j.Stops++
			if j.Stops < liveObjAsksMax {
				renumWaitJob(j, liveStopRetry(), "")
				writeLog(fmt.Sprintf("Renumbering: %s %s of %s in %s: Tally took longer than 2 s; FinCom asks once more at %s",
					j.Type, c.No, liveDay(c.Day), j.Company, nowFn().Add(liveStopRetry()).Format("15:04")))
				return asked + queued, false
			}
			writeLog(fmt.Sprintf("Renumbering: %s %s of %s in %s: Tally took longer than 2 s again; not asked any more (counted in the alert: upload the Day Book)",
				j.Type, c.No, liveDay(c.Day), j.Company))
			renumMiss(j, c)
			j.Cands = j.Cands[1:]
			continue
		default:
			// an answer that cannot be read, a form FinCom does not read, an entry that cannot be asked: the same would come
			// again. Unless the company is no longer open (then the job waits, nothing dropped): dropped into the alert
			if !errors.Is(err, errFastShape) {
				if _, perr := findCompanyPortBg(j.Company, 0); perr != nil {
					renumWaitJob(j, renumPause(), "Renumbering: "+j.Company+" is not open in Tally ("+cutRunes(perr.Error(), 120)+"); its renumbering check waits, the other companies' go on")
					return asked + queued, false
				}
			}
			writeLog(fmt.Sprintf("Renumbering: %s %s of %s in %s could not be read from Tally (%s); counted in the alert: upload the Day Book",
				j.Type, c.No, liveDay(c.Day), j.Company, cutRunes(err.Error(), 120)))
			renumMiss(j, c)
			j.Cands = j.Cands[1:]
			continue
		}
		x := got[c.Mid]
		j.Cands = j.Cands[1:]
		j.Stops = 0
		if x == "" || !strings.EqualFold(tagValue(x, "GUID"), c.GUID) || tagValue(x, "VOUCHERTYPENAME") != j.Type {
			continue // gone from Tally, or not the entry FinCom holds under that MasterID
		}
		no := tagValue(x, "VOUCHERNUMBER")
		if no == c.No {
			j.Same++
			if !j.Probed && renumProbe(j, c) {
				writeLog(fmt.Sprintf("Renumbering: %s %s of %s in %s: the next entry (%s %s of %s) keeps its number in Tally: nothing renumbered",
					j.Type, or(j.No, "(no number)"), liveDay(j.Date), j.Company, j.Type, c.No, liveDay(c.Day)))
				return asked + queued, true
			}
			continue
		}
		j.Probed = true
		alter := toI64(tagNum(x, "ALTERID"))
		if alter <= sp {
			j.Below++ // read to see; never named
			if j.BelowFrom == "" || c.Day < j.BelowFrom {
				j.BelowFrom = c.Day
			}
			continue
		}
		if !shared {
			renumQueue(j, x) // (a line the bank route sent carries this entry, its number with it)
			vchReadPut(j.CGUID, c.Mid, x, true)
		}
		j.Sent++
		queued++
		writeLog(fmt.Sprintf("Renumbering: %s %s of %s in %s is %s %s in Tally now (renumbered); sent to FinCom with Tally's entry", j.Type, c.No, liveDay(c.Day), j.Company, j.Type, no))
	}
	if len(j.Cands) == 0 {
		return asked + queued + renumFinish(j), true
	}
	return asked + queued, false
}

// the first later entry unchanged proves no renumbering only when it is later for certain: a later day, or the same day
// with a number from the sign's up
func renumProbe(j *renumJob, c renumCand) bool {
	if c.Day > j.Date {
		return true
	}
	k, ok := renumNumCmp(c.No, j.No)
	return ok && k >= 0
}

// 2.4.0 review: the job waits d (its company not open, or a stop's one more ask); said once per company when words given
func renumWaitJob(j *renumJob, d time.Duration, words string) {
	j.Wait = nowFn().Add(d).Format(time.RFC3339)
	if words != "" {
		renum.mu.Lock()
		renumSayOnce("closed|"+companyKey(j.Company), words)
		renum.mu.Unlock()
	}
}

// 2.4.0 review: an entry dropped unread, counted into the alert
func renumMiss(j *renumJob, c renumCand) {
	j.Missed++
	j.Stops = 0
	if j.MissedFrom == "" || c.Day < j.MissedFrom {
		j.MissedFrom = c.Day
	}
}

func renumFinish(j *renumJob) int {
	if j.Sent > 0 {
		writeLog(fmt.Sprintf("Renumbering: %d %s entr%s of %s renumbered by Tally after the %s of %s %s (%s): sent to FinCom with Tally's numbers",
			j.Sent, j.Type, map[bool]string{true: "y", false: "ies"}[j.Sent == 1], j.Company, map[bool]string{true: "delete", false: "entry"}[j.Event == "deleted"], j.Type, or(j.No, "(no number)"), liveDay(j.Date)))
	}
	// what was not read (below the starting point, dropped unread, not listed by MasterID, over the cap): one alert. The
	// job ends here only when renumbering was seen or could not be ruled out (a type that keeps its numbers returns earlier)
	n, from := j.Below+j.Missed+j.Unknown, ""
	for _, f := range []string{j.BelowFrom, j.MissedFrom} {
		if f != "" && (from == "" || f < from) {
			from = f
		}
	}
	if j.Unknown > 0 || j.More || from == "" {
		from = j.Date
	}
	if j.More {
		n = renumMax()
	}
	if n > 0 || j.More {
		renum.mu.Lock()
		renumAlert(j, n, j.More, from)
		renum.mu.Unlock()
	}
	return 0
}

// a save read from the add-on waits (the renumbered entries' own lines do not count)
func renumLiveWaits() bool { return liveQueueReady() }

// Tally's renumbered entry as an altered line with its body (source "renumber")
func renumQueue(j *renumJob, x string) {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	no, mid := tagValue(x, "VOUCHERNUMBER"), onlyDigits(tagNum(x, "MASTERID"))
	id := liveLineID("renumber", j.Line, j.CGUID, mid, no)
	if live.sent[id] || live.queued[id] {
		return
	}
	c := &change{company: j.Company, companyGuid: j.CGUID, event: "altered", vchType: tagValue(x, "VOUCHERTYPENAME"), vchNo: no, vchDate: normDate(tagValue(x, "DATE")),
		narr: html.UnescapeString(tagRaw(x, "NARRATION")), source: "renumber", lineId: id, saveMs: -1, readAt: nowFn(), at: nowFn().In(liveZone).Format(time.RFC3339)}
	liveTakeBody(c, x)
	liveQueueAdd(c)
}

// next-bankdate: what was read at or after the sign was noted (its time, the bridge's clock as nowS writes it) is Tally's
// entry after the renumbering
func renumReadAfter(j *renumJob, at time.Time) bool {
	t, err := time.ParseInLocation("2006-01-02T15:04:05", j.At, time.Local)
	return err == nil && !at.Before(t)
}
