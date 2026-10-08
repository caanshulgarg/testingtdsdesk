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
// asked. An entry at or below the starting point is never named (security M1): after renumbering is seen, such entries are
// not read and are counted. More entries than the cap, or any so counted: one plain alert (the log and the beat), never a
// loop: "N entries may have been renumbered in <company>; upload the Day Book from <date>". A company marked slow (its entry
// fetch over 2 s, slowco.go) is not asked at all. Nothing is added to the allow-list: FinComVoucherObject only.
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
}

var renum = struct {
	mu     sync.Mutex
	dir    string
	pend   map[string]*renumJob // company|GUID|type -> the earliest sign not worked on yet
	job    *renumJob            // the one worked on
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
	renum.dir, renum.pend, renum.job, renum.alerts, renum.said = syncDir(), map[string]*renumJob{}, nil, map[string]M{}, map[string]bool{}
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
	renum.job = renumJobOf(obj(o["job"]))
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
		Sent: toInt(e["sent"]), Same: toInt(e["same"]), Below: toInt(e["below"]), BelowFrom: str(e["belowFrom"])}
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
		"at": j.At, "asked": j.Asked, "probed": j.Probed, "sent": j.Sent, "same": j.Same, "below": j.Below, "belowFrom": j.BelowFrom, "cands": cs}
}

// under renum.mu
func renumSave() {
	p := M{}
	for k, j := range renum.pend {
		p[k] = j.m()
	}
	var job any
	if renum.job != nil {
		job = renum.job.m()
	}
	a := M{}
	for k, e := range renum.alerts {
		a[k] = e
	}
	if err := saveFile(renumFile(), jsonText(M{"pending": p, "job": job, "alerts": a})); err != nil {
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
	if renum.busy || (renum.job == nil && len(renum.pend) == 0) || (!renum.lastAt.IsZero() && time.Since(renum.lastAt) < renumGap()) {
		renum.mu.Unlock()
		return 0
	}
	if renum.job == nil {
		var pick *renumJob
		for _, j := range renum.pend {
			if pick == nil || j.At < pick.At || (j.At == pick.At && j.Key < pick.Key) {
				pick = j
			}
		}
		delete(renum.pend, pick.Key)
		renum.job = pick
		renumSave()
	}
	renum.busy, renum.lastAt = true, time.Now()
	j := renum.job
	renum.mu.Unlock()
	defer func() {
		renum.mu.Lock()
		renum.busy = false
		renum.mu.Unlock()
	}()
	n, done := renumWork(j)
	renum.mu.Lock()
	if done && renum.job == j {
		renum.job = nil
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
			renum.mu.Lock()
			renumSayOnce("cloud|"+j.Key, "Renumbering: FinCom's cloud did not list the "+j.Type+" entries of "+j.Company+" ("+cutRunes(or(r.err, fmt.Sprint("HTTP ", r.code)), 120)+"); asked again later")
			renum.mu.Unlock()
			return 0, false
		}
		var cs []renumCand
		for _, x := range arr(r.json["entries"]) {
			e := obj(x)
			c := renumCand{Mid: onlyDigits(str(e["mid"])), GUID: str(e["guid"]), Day: normDate(str(e["day"])), No: str(e["no"]), Alter: toI64(e["alter"])}
			if c.Mid == "" || c.Mid == j.Mid || c.GUID == "" || len(c.Day) != 8 || c.Day < j.Date {
				continue
			}
			cs = append(cs, c)
		}
		if truthy(r.json["more"]) || len(cs) > renumMax() {
			renum.mu.Lock()
			renumAlert(j, renumMax(), true, j.Date)
			renum.mu.Unlock()
			return 0, true
		}
		sort.SliceStable(cs, func(a, b int) bool {
			if cs[a].Day != cs[b].Day {
				return cs[a].Day < cs[b].Day
			}
			if c, ok := renumNumCmp(cs[a].No, cs[b].No); ok {
				return c < 0
			}
			return cs[a].No < cs[b].No
		})
		j.Cands, j.Asked = cs, true
		writeLog(fmt.Sprintf("Renumbering: %s %s %s of %s in %s: FinCom holds %d later %s entr%s; each is read again from Tally to see whether Tally renumbered it",
			map[bool]string{true: "deleted", false: "made"}[j.Event == "deleted"], j.Type, or(j.No, "(no number)"), liveDay(j.Date), j.Company, len(cs), j.Type, map[bool]string{true: "y", false: "ies"}[len(cs) == 1]))
	}
	if len(j.Cands) == 0 {
		return renumFinish(j), true
	}
	port, err := findCompanyPortBg(j.Company, 0)
	if err != nil {
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
		got, err := fetchVouchersByMasterIn(tc, j.Company, port, c.Day, []string{c.Mid}, liveBodySec())
		asked++
		switch {
		case errors.Is(err, errSlowCompany):
			return asked + queued, true
		case errors.Is(err, errFastShape):
			j.Cands = j.Cands[1:] // Tally keeps it in a form FinCom does not read: left to the Day Book
			continue
		case err != nil:
			// a 2 s stop, the retry schedule waiting, a posting, Tally not answering: this turn ends here; the retry
			// schedule (retry.go) says when Tally is asked again
			return asked + queued, false
		}
		x := got[c.Mid]
		j.Cands = j.Cands[1:]
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
		renumQueue(j, x)
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

func renumFinish(j *renumJob) int {
	if j.Sent > 0 {
		writeLog(fmt.Sprintf("Renumbering: %d %s entr%s of %s renumbered by Tally after the %s of %s %s (%s): sent to FinCom with Tally's numbers",
			j.Sent, j.Type, map[bool]string{true: "y", false: "ies"}[j.Sent == 1], j.Company, map[bool]string{true: "delete", false: "entry"}[j.Event == "deleted"], j.Type, or(j.No, "(no number)"), liveDay(j.Date)))
	}
	if j.Below > 0 {
		renum.mu.Lock()
		renumAlert(j, j.Below, false, j.BelowFrom)
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
