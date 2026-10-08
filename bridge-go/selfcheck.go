package main

// The nightly self-check (next release, item e; docs/selfcheck-requests-for-approval.md). Once a night per company open in
// this bridge's own Tally, after hours and while nobody uses Tally: did every change Tally made since the last good check
// reach FinCom's copy? Tally's change counter (the light check's FinComCompany answer, nothing sent here) against the
// company's checked mark; Tally's own list of the entries changed above the mark (TDSDeskKeepList in its undated form above
// an AlterID, source B's request, exactly as keepListAboveRequest builds it) compared by FinCom's cloud with its copy
// (kind selfcheck, step compare); the entries missing fetched through the live recorder (one entry a request,
// FinComVoucherByMaster, the recorder's own rules); the result recorded by the cloud (step record, migration 65's
// tally_selfchecks) with its words for the Tally page. ONLY requests already on the allow-list, byte for byte as built:
// no Tally request is added or changed here. Tally's own balances need a new, computed request and wait for the owner
// (the document above, section 8).
//
// The rules: after hours (SelfCheckFrom..SelfCheckTo, 22:00..06:00), once a night per company, Tally idle (no posting,
// no import, nobody at the computer for SelfCheckIdleSec, keepHold's reasons, the retry schedule not waiting), one company
// at a time, a background request with the 2-second hard stop that gives way to a posting; a list stopped at 2 s, or too
// many changes for one list (SelfCheckMaxSpan), is not asked again that night and is recorded with words for a Day Book
// upload; while 2.3.2's per-company stop of the entry fetch holds (entryFetchOffFor) nothing is fetched and the missing
// entries' days are listed for a Day Book upload.

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// 2.3.2 stops the entry fetch for a company whose entry took over 2 s: it says why here ("" : the fetch is on). The
// self-check never fetches while it says something
var entryFetchOffFor = func(company, guid string) string { return "" }

// on unless the settings say "SelfCheck": false; off in test mode (and in the package's tests) unless asked for
var selfCheckDefault = true

func selfCheckOn() bool {
	if v := cfg("SelfCheck"); v != nil {
		return truthy(v)
	}
	return selfCheckDefault && !isFake()
}

// Tally idle: keepHold's reasons and the time since the person at this computer last used it (the tests replace them)
var (
	selfCheckHoldFn = keepHold
	selfCheckIdleFn = idleSec
)

func scClock(k, def string) int {
	v := cfgS(k)
	if !re(`^([01]?\d|2[0-3]):[0-5]\d$`).MatchString(v) {
		v = def
	}
	var h, m int
	fmt.Sscanf(v, "%d:%d", &h, &m)
	return h*60 + m
}

// the night a moment belongs to (yyyymmdd of the evening it began) and whether it is inside the window
func selfCheckNight(t time.Time) (string, bool) {
	from, to := scClock("SelfCheckFrom", "22:00"), scClock("SelfCheckTo", "06:00")
	m := t.Hour()*60 + t.Minute()
	in := false
	if from <= to {
		in = m >= from && m < to
	} else {
		in = m >= from || m < to
	}
	day := t
	if from > to && m < to {
		day = t.AddDate(0, 0, -1)
	}
	return day.Format("20060102"), in
}

func selfCheckMaxSpan() int64 { return int64(keepNum("SelfCheckMaxSpan", 2000)) }
func selfCheckFetchMax() int  { return keepNum("SelfCheckFetchMax", 200) }
func selfCheckWaitSec() int   { return keepNum("SelfCheckWaitSec", 900) }

// --- the state per company and Tally GUID (sync\selfcheck.json): {night, mark, since, tries}
var scMu sync.Mutex

func scFile() string                    { return sp("selfcheck.json") }
func scKey(company, guid string) string { return companyKey(company) + "|" + strings.ToLower(guid) }

func scState(company, guid string) M {
	scMu.Lock()
	defer scMu.Unlock()
	return obj(readObjFile(scFile())[scKey(company, guid)])
}

func scSave(company, guid string, set M) {
	scMu.Lock()
	defer scMu.Unlock()
	all := readObjFile(scFile())
	if all == nil {
		all = M{}
	}
	k := scKey(company, guid)
	e := obj(all[k])
	if e == nil {
		e = M{}
	}
	for a, v := range set {
		e[a] = v
	}
	all[k] = e
	_ = saveFile(scFile(), jsonText(all))
}

// why the check cannot go for this company now ("" : it may)
func selfCheckBlocked(company, guid string) string {
	if !selfCheckOn() {
		return "the nightly check is off on this computer"
	}
	if !cloudOn() {
		return "FinCom's cloud is not set up on this computer"
	}
	night, in := selfCheckNight(nowFn())
	if !in {
		return "not after hours"
	}
	if guid == "" {
		return "Tally gave no GUID for the company"
	}
	if st := scState(company, guid); str(st["night"]) == night {
		return "already checked tonight"
	}
	if postingGoing() || importsInFlight.Load() > 0 {
		return "a posting is going (the check goes after it)"
	}
	if leaseHeldHere(company) {
		return "this bridge holds the company for a posting"
	}
	if why := selfCheckHoldFn(); why != "" {
		return why
	}
	if selfCheckIdleFn() < float64(keepNum("SelfCheckIdleSec", 300)) {
		return "someone used this computer in the last few minutes"
	}
	if retryHeld() {
		return "Tally did not answer in time earlier; the bridge is waiting to try again"
	}
	return ""
}

// one entry Tally listed that FinCom's copy lacks
type scMiss struct {
	guid, why, date string
	mid, alter      int64
}

// one check of one company: what was found, what was queued, why it stopped
type scRun struct {
	company, guid, night string
	port                 int
	ranAt                time.Time
	altV, altM, after    int64
	received             int64
	listed               int
	missing              []scMiss
	queued               map[*change]scMiss
	notQueued            []scMiss
	stopped              string // why Tally's list was not taken (the check is "not checked")
	fetchOff             string // why nothing was fetched
	mastersBehind        int64
	since                string // yyyymmdd of the last good check (the Day Book's first day when not checked)
}

var (
	scBusy atomic.Bool
	scWG   sync.WaitGroup
)

// after the light check (startpoint.go): when due, the check of this company in the background, one at a time
func selfCheckAfterLightCheck(company string, port int) {
	cur, guid := latestNumbers(company)
	if cur == nil {
		return
	}
	if guid == "" {
		guid = heldGUID(company)
	}
	if why := selfCheckBlocked(company, guid); why != "" {
		if why != "not after hours" && why != "already checked tonight" && why != "the nightly check is off on this computer" {
			liveSayOnce("selfcheck|"+companyKey(company)+"|"+why, "Nightly check of "+company+": not now: "+why)
		}
		return
	}
	if !scBusy.CompareAndSwap(false, true) {
		return
	}
	scWG.Add(1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("Nightly check: ", r))
			}
			scBusy.Store(false)
			scWG.Done()
		}()
		r, err := selfCheckStart(company, port)
		if err != nil {
			writeLog("Nightly check of " + company + ": " + cutRunes(err.Error(), 200))
		}
		if r == nil {
			return
		}
		selfCheckWait(r, time.Duration(selfCheckWaitSec())*time.Second)
		if err := selfCheckFinish(r); err != nil {
			writeLog("Nightly check of " + company + ": " + cutRunes(err.Error(), 200))
		}
	}()
}

// steps a-c: the counters, Tally's list above the mark, the cloud's answer, the missing entries queued. nil: nothing to
// record now (not due, gave way to a posting, the cloud not reachable: tried again at the next light check)
func selfCheckStart(company string, port int) (*scRun, error) {
	cur, guid := latestNumbers(company)
	if cur == nil {
		return nil, nil
	}
	if guid == "" {
		guid = heldGUID(company)
	}
	if why := selfCheckBlocked(company, guid); why != "" {
		return nil, nil
	}
	if held := heldGUID(company); held != "" && !strings.EqualFold(held, guid) {
		return nil, nil // another company's GUID under this name: nothing is asked
	}
	sp, ok := startPointOf(company)
	if !ok {
		return nil, nil // no starting point: nothing of the company is taken (prospective only)
	}
	if p, why := ledOwnPort(company, guid, port); why != "" {
		liveSayOnce("selfcheck|"+companyKey(company)+"|own", "Nightly check of "+company+": not asked: "+why)
		return nil, nil
	} else {
		port = p
	}
	night, _ := selfCheckNight(nowFn())
	st := scState(company, guid)
	if toInt(st["tries"]) >= 3 && str(st["triesNight"]) == night {
		return nil, nil // three tries that could not reach FinCom's cloud tonight
	}
	r := &scRun{company: company, guid: guid, night: night, port: port, ranAt: nowFn(), altV: toI64(cur["altvchid"]), altM: toI64(cur["altmstid"]),
		after: sp, since: str(st["since"]), queued: map[*change]scMiss{}}
	if m := toI64(st["mark"]); st["mark"] != nil && m > r.after {
		r.after = m
	}
	if after, ok := ledChangesAfter(company, guid); ok && r.altM > after {
		r.mastersBehind = r.altM - after
	}
	switch {
	case r.altV < r.after:
		r.stopped = fmt.Sprintf("Tally's change counter went back (from %d to %d): the company may have been restored from a backup", r.after, r.altV)
		return r, nil
	case r.altV == r.after:
		return r, nil // nothing changed since the last good check: nothing is asked of Tally
	case r.altV-r.after > selfCheckMaxSpan():
		r.stopped = fmt.Sprintf("too many changes since the last check (%d) for Tally to list within 2 s", r.altV-r.after)
		return r, nil
	}
	// b. Tally's list of the entries changed above the mark (source B's request, the 2-second hard stop)
	raw, err := invokeTally(recorderTC(nil), port, keepListAboveRequest(company, r.after), keepNum("RecorderBTimeoutSec", 5))
	switch {
	case errors.Is(err, errRecorderStop):
		r.stopped = "Tally took longer than 2 s to list its changes"
		return r, nil
	case err != nil:
		if gaveWay(err) || errors.Is(err, errRetryWait) {
			return nil, nil // a posting goes first, or Tally is being left alone: tried again at the next light check
		}
		return nil, err
	case !strings.Contains(raw, "<ENVELOPE"):
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	type ent struct {
		guid, date string
		mid, aid   int64
	}
	var es []ent
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		g := tagValue(m, "GUID")
		a, mid := toI64(tagNum(m, "ALTERID")), toI64(tagNum(m, "MASTERID"))
		if g == "" || a <= r.after {
			continue
		}
		es = append(es, ent{g, normDate(tagValue(m, "DATE")), mid, a})
	}
	sort.Slice(es, func(i, j int) bool { return es[i].aid < es[j].aid })
	r.listed = len(es)
	if len(es) == 0 {
		return r, nil
	}
	// the cloud's answer: which of them its copy lacks
	rows := make([]any, 0, len(es))
	byGuid := map[string]ent{}
	for _, e := range es {
		rows = append(rows, []any{e.guid, e.aid, e.mid, e.date})
		byGuid[e.guid] = e
	}
	ans := invokeCloud(M{"kind": "selfcheck", "step": "compare", "company": company, "company_guid": guid, "after": r.after, "altvchid": r.altV, "entries": rows}, 60)
	if ans.code != 200 || ans.json == nil {
		return nil, scCloudErr(r, ans)
	}
	r.received = toI64(ans.json["received"])
	for _, x := range arr(ans.json["missing"]) {
		o := obj(x)
		e, ok := byGuid[str(o["guid"])]
		if !ok {
			continue // never anything Tally did not list
		}
		r.missing = append(r.missing, scMiss{guid: e.guid, why: or(str(o["why"]), "absent"), date: e.date, mid: e.mid, alter: e.aid})
	}
	sort.Slice(r.missing, func(i, j int) bool { return r.missing[i].alter < r.missing[j].alter })
	if len(r.missing) == 0 {
		return r, nil
	}
	// c. the missing entries fetched through the live recorder (its body fetch, one entry a request), or listed
	if why := entryFetchOffFor(company, guid); why != "" {
		r.fetchOff = why
		r.notQueued = append(r.notQueued, r.missing...)
		return r, nil
	}
	live.mu.Lock()
	liveFresh()
	for _, m := range r.missing {
		if m.why == "deleted" || m.mid <= 0 || len(r.queued) >= selfCheckFetchMax() || len(live.queue) >= liveQueueCap() {
			r.notQueued = append(r.notQueued, m)
			continue
		}
		ev := "altered"
		if m.why == "absent" {
			ev = "created"
		}
		id := liveLineID("selfcheck", night, guid, m.guid, fmt.Sprint(m.alter))
		if live.queued[id] {
			continue
		}
		c := &change{company: company, companyGuid: guid, event: ev, guid: m.guid, masterId: fmt.Sprint(m.mid), alterId: fmt.Sprint(m.alter), vchDate: m.date,
			source: "selfcheck", lineId: id, saveMs: -1, readAt: nowFn(), at: nowFn().In(liveZone).Format(time.RFC3339), alterN: m.alter}
		liveQueueAdd(c)
		r.queued[c] = m
	}
	live.mu.Unlock()
	if n := len(r.queued); n > 0 {
		writeLog(fmt.Sprintf("Nightly check of %s: %d entr%s missing from FinCom's copy asked of Tally (one a request)", company, n, map[bool]string{true: "y", false: "ies"}[n == 1]))
	}
	return r, nil
}

// the cloud could not take the step: tried again at the next light check (three times a night at most); a cloud without
// the nightly check (migration 65) is said once and not asked again tonight
func scCloudErr(r *scRun, ans cloudResp) error {
	st := scState(r.company, r.guid)
	n := toInt(st["tries"]) + 1
	if str(st["triesNight"]) != r.night {
		n = 1
	}
	set := M{"tries": n, "triesNight": r.night}
	why := or(ans.err, fmt.Sprint("HTTP ", ans.code))
	if ans.json != nil && str(ans.json["error"]) != "" {
		why = str(ans.json["error"])
	}
	if ans.code == 400 || ans.code == 503 || ans.code == 404 {
		set["night"] = r.night // the cloud has no nightly check yet: nothing more tonight
		why = "FinCom's cloud is not ready for the nightly check yet (" + why + ")"
	}
	scSave(r.company, r.guid, set)
	return errors.New(why)
}

// until every line the check queued has left the recorder's queue (sent, with or without Tally's entry), or the time is up
func selfCheckWait(r *scRun, max time.Duration) {
	end := time.Now().Add(max)
	for time.Now().Before(end) && !stopping() {
		if selfCheckWaiting(r) == 0 {
			return
		}
		sleepOrStop(time.Second)
	}
}

func selfCheckWaiting(r *scRun) int {
	live.mu.Lock()
	defer live.mu.Unlock()
	n := 0
	for c := range r.queued {
		if live.queued[c.lineId] {
			n++
		}
	}
	return n
}

// the result counted, recorded by FinCom's cloud, and the mark moved
func selfCheckFinish(r *scRun) error {
	fetched := 0
	var still []scMiss
	live.mu.Lock()
	for c, m := range r.queued {
		if live.sent[c.lineId] && c.xml != "" {
			fetched++
		} else {
			still = append(still, m)
		}
	}
	live.mu.Unlock()
	still = append(still, r.notQueued...)
	sort.Slice(still, func(i, j int) bool { return still[i].alter < still[j].alter })
	days := map[string]bool{}
	var gap []any
	for _, m := range still {
		if m.date != "" && !days[m.date] {
			days[m.date] = true
			gap = append(gap, m.date)
		}
	}
	sort.Slice(gap, func(i, j int) bool { return str(gap[i]) < str(gap[j]) })
	deleted := 0
	for _, m := range still {
		if m.why == "deleted" {
			deleted++
		}
	}
	body := M{"kind": "selfcheck", "step": "record", "company": r.company, "company_guid": r.guid, "night": r.night,
		"ran_at": r.ranAt.In(liveZone).Format(time.RFC3339), "altvchid": r.altV, "altmstid": r.altM, "after": r.after,
		"listed": r.listed, "missing": len(r.missing), "fetched": fetched, "still": len(still), "deleted": deleted,
		"mastersBehind": r.mastersBehind, "stopped": r.stopped, "fetchOff": r.fetchOff, "gapDays": gap, "since": r.since}
	if gap == nil {
		body["gapDays"] = []any{}
	}
	ans := invokeCloud(body, 60)
	if ans.code != 200 || ans.json == nil {
		return scCloudErr(r, ans)
	}
	set := M{"night": r.night, "tries": 0}
	switch {
	case r.stopped != "":
		// not checked: the mark stays, the Day Book covers it
	case len(still) == 0 && fetched == 0:
		set["mark"], set["since"] = r.altV, r.night
	default:
		low := r.altV
		for _, m := range r.missing {
			if m.alter-1 < low {
				low = m.alter - 1
			}
		}
		if low > r.after {
			set["mark"] = low
		} else {
			set["mark"] = r.after
		}
	}
	scSave(r.company, r.guid, set)
	writeLog("Nightly check of " + r.company + ": " + or(str(ans.json["words"]), fmt.Sprintf("%d listed, %d missing, %d fetched, %d still missing", r.listed, len(r.missing), fetched, len(still))))
	return nil
}
