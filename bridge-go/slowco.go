package main

// Bridge 2.3.2 (the owner's requirement c of 07-Oct-2026, issue 232): on a large company Tally takes about 5 s (worst 13 s)
// to find one entry (FinComVoucherByMaster / FinComVoucherByNumber), so every ask is stopped at 2 s and costs Tally its
// full time all the same. The bridge measures each company's entry fetch: the time Tally took when it answered, "over
// 2 s" when the 2 s stop ended it. A company whose entry fetch is stopped on 2 separate occasions while Tally answered
// other requests in time around each of them is marked "entry fetch stopped: over 2 s": no entry request is sent for it
// any more; its new lines go up held at once with plain words (slowWords), and its held lines end with the same words,
// nothing asked of Tally. The mark is kept on disk (sync\recorder-slow.json) and lifts only when the bridge's version
// changes (a newer bridge, with a faster request). No manual resume. The beat carries it per company (recorderBodyFetch,
// the shape FinCom's cloud keeps as recorderOff.bodies).
//
// What counts as an occasion (a whole-Tally freeze must not count against one company). Every background request that
// reached Tally is noted with its port and outcome: answered in time (within the 2 s stop), or not (stopped, or not
// answered). For one company's entry stop, the other requests on that Tally are looked at: the last one before the stop
// and the first one after it must both have been answered in time, within RecorderSlowAroundSec (15 minutes since 2.3.3: the beat's small check comes every 10 minutes a company). Another
// company's entry stop is neither for nor against (that company may be large too). The stops between the same two
// answers are ONE occasion; two occasions therefore always have an answer in time of another request between them, and a
// single freeze (everything stopped, or only this company's entries tried while Tally was frozen) makes one occasion at
// most. An answer in time to the company's own entry request clears what was counted (it is not slow after all).
//
// 2.3.3 (GARG SHEKHAR at 2.1-2.5 s on every entry, NWS144): when the only background traffic is entry requests, every
// retry try went to an entry request and no other request was ever answered around a stop, so the company was never
// marked and paid 2 s a try for ever. The beat's small check (the light company check, and the company list) that finds
// the retry schedule waiting now has the next try kept for it (retry.go retryTake), so its answer in time is seen between
// two entry stops; the whole-Tally freeze exclusion is unchanged (in a freeze the small check is not answered in time).

import (
	"errors"
	"fmt"
	"html"
	"sort"
	"strings"
	"sync"
	"time"
)

// the words a marked company's lines go up held with, and its held lines end with (the owner's words)
const slowWords = "FinCom does not ask Tally for this company's entries: finding one entry took Tally longer than 2 s. Upload that day's Day Book to settle it."

// requirement b (2.3.3: the owner's rule): a held line whose one ask again timed out ends with these words
const liveHeldSlowGiveUp = "Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it"

// the entry request was not sent: the company is marked (no entry request for it)
var errSlowCompany = errors.New("FinCom does not ask Tally for this company's entries (finding one entry took Tally longer than 2 s)")

const slowEvMax = 400 // the outcomes kept (the last ones; each older than RecorderSlowAroundSec is of no use)

type slowEv struct {
	seq   int64
	at    time.Time
	port  int
	co    string // an entry request's company key; "" for any other request
	entry bool
	ok    bool // answered in time
}

type slowStop struct {
	seq  int64
	at   time.Time
	port int
}

// one company's entry fetch as measured (this run; the counts and the last time are kept on disk too)
type slowCoSt struct {
	name           string
	answered, over int
	lastMs         int64 // -1: never answered
	lastAt, overAt time.Time
	stops          []slowStop // stops not decided yet (no request of another kind after them yet)
	occ            int        // occasions counted since its entry last answered in time
}

type slowMark struct {
	Company, GUID, Since, Why string
	TimesOver                 int
	LastMs                    int64 // -1: never answered
}

var slowSt = struct {
	mu     sync.Mutex
	dir    string // the sync folder loaded ("" : not loaded)
	marks  map[string]*slowMark
	cos    map[string]*slowCoSt
	evs    []slowEv
	seq    int64
	saveAt time.Time
}{}

func slowFile() string { return sp("recorder-slow.json") }
func slowAround() time.Duration {
	return time.Duration(keepNum("RecorderSlowAroundSec", 900)) * time.Second
}

// a restart, as far as this is concerned (the tests): read again from disk at the next use
func slowForget() {
	slowSt.mu.Lock()
	slowSt.dir = ""
	slowSt.mu.Unlock()
}

// under slowSt.mu: the state of this sync folder, loaded once; a mark made by another version lifts here
func slowFresh() {
	d := syncDir()
	if slowSt.dir == d && slowSt.marks != nil {
		return
	}
	slowSt.dir = d
	slowSt.marks, slowSt.cos, slowSt.evs, slowSt.saveAt = map[string]*slowMark{}, map[string]*slowCoSt{}, nil, time.Time{}
	o := readObjFile(slowFile())
	if o == nil {
		return
	}
	ver := str(o["version"])
	var lifted []string
	for k, v := range obj(o["marks"]) {
		e := obj(v)
		m := &slowMark{Company: str(e["company"]), GUID: str(e["guid"]), Since: str(e["since"]), Why: str(e["why"]), TimesOver: toInt(e["timesOver"]), LastMs: -1}
		if e["lastMs"] != nil {
			m.LastMs = toI64(e["lastMs"])
		}
		if m.Company == "" {
			continue
		}
		if ver != BridgeVersion {
			lifted = append(lifted, m.Company)
			continue
		}
		slowSt.marks[k] = m
	}
	for k, v := range obj(o["seen"]) {
		e := obj(v)
		st := &slowCoSt{name: str(e["company"]), answered: toInt(e["answered"]), over: toInt(e["over"]), lastMs: -1}
		if e["lastMs"] != nil {
			st.lastMs = toI64(e["lastMs"])
		}
		st.lastAt, _ = time.Parse(time.RFC3339, str(e["lastAt"]))
		st.overAt, _ = time.Parse(time.RFC3339, str(e["overAt"]))
		if st.name != "" {
			slowSt.cos[k] = st
		}
	}
	if len(lifted) > 0 {
		sort.Strings(lifted)
		writeLog(fmt.Sprintf("Recorder: the entry fetch of %s was stopped (over 2 s) by FinCom Bridge %s; lifted: this is FinCom Bridge %s, whose request may be faster. Its entries are asked of Tally again",
			strings.Join(lifted, ", "), or(ver, "an earlier version"), BridgeVersion))
	}
	if ver != BridgeVersion {
		slowSaveLocked()
	}
}

// under slowSt.mu
func slowSaveLocked() {
	marks, seen := M{}, M{}
	for k, m := range slowSt.marks {
		e := M{"company": m.Company, "guid": m.GUID, "since": m.Since, "why": m.Why, "timesOver": m.TimesOver}
		if m.LastMs >= 0 {
			e["lastMs"] = m.LastMs
		}
		marks[k] = e
	}
	for k, st := range slowSt.cos {
		e := M{"company": st.name, "answered": st.answered, "over": st.over}
		if st.lastMs >= 0 {
			e["lastMs"] = st.lastMs
		}
		if !st.lastAt.IsZero() {
			e["lastAt"] = st.lastAt.Format(time.RFC3339)
		}
		if !st.overAt.IsZero() {
			e["overAt"] = st.overAt.Format(time.RFC3339)
		}
		seen[k] = e
	}
	slowSt.saveAt = time.Now()
	if err := saveFile(slowFile(), jsonText(M{"version": BridgeVersion, "marks": marks, "seen": seen})); err != nil {
		writeLog("Recorder: " + slowFile() + " could not be written: " + err.Error())
	}
}

// whether the company's entries are not asked of Tally (marked); a company of that name under another GUID is not
func slowMarked(company, cguid string) bool {
	slowSt.mu.Lock()
	defer slowSt.mu.Unlock()
	slowFresh()
	m := slowSt.marks[companyKey(company)]
	if m == nil {
		return false
	}
	g := strings.TrimSpace(cguid)
	return m.GUID == "" || g == "" || strings.EqualFold(m.GUID, g)
}

// what was measured of a company's entry fetch (the tests)
type slowSeenSt struct {
	answered, over int
	lastMs         int64
}

func slowSeen(company string) slowSeenSt {
	slowSt.mu.Lock()
	defer slowSt.mu.Unlock()
	slowFresh()
	st := slowSt.cos[companyKey(company)]
	if st == nil {
		return slowSeenSt{lastMs: -1}
	}
	return slowSeenSt{st.answered, st.over, st.lastMs}
}

// one background request's outcome (invokeTally): sent says it reached Tally (a request held back, refused or stopped for
// a posting is nothing); took: the time Tally had it
func slowNote(port int, x string, sent bool, took time.Duration, err error) {
	if !sent || errors.Is(err, errPreempted) {
		return
	}
	id := tallyRequestID(x)
	entry := id == vchObjectID || id == vchByNumberID
	co := ""
	name := ""
	if entry {
		name = strings.TrimSpace(html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1)))
		co = companyKey(name)
	}
	limit := time.Duration(liveLimitSec() * float64(time.Second))
	ok := err == nil && took <= limit
	stopped := errors.Is(err, errRecorderStop)
	if err != nil && !stopped && !tallyNoAnswer(err) {
		return // Tally answered with an error, or the answer could not be read: neither in time nor not
	}
	now := nowFn()
	var marked []string
	slowSt.mu.Lock()
	slowFresh()
	slowSt.seq++
	ev := slowEv{seq: slowSt.seq, at: now, port: port, co: co, entry: entry, ok: ok}
	slowSt.evs = append(slowSt.evs, ev)
	if len(slowSt.evs) > slowEvMax {
		slowSt.evs = append([]slowEv{}, slowSt.evs[len(slowSt.evs)-slowEvMax:]...)
	}
	save := false
	if entry && co != "" {
		st := slowSt.cos[co]
		if st == nil {
			st = &slowCoSt{name: name, lastMs: -1}
			slowSt.cos[co] = st
		}
		st.name = name
		switch {
		case ok:
			st.answered++
			st.lastMs, st.lastAt = took.Milliseconds(), now
			st.stops, st.occ = nil, 0 // answered in time: not slow after all
		case stopped:
			st.over++
			st.overAt = now
			st.stops = append(st.stops, slowStop{ev.seq, now, port})
			save = true
		}
	}
	marked = slowDecideLocked(now)
	if len(marked) > 0 || save || time.Since(slowSt.saveAt) > time.Minute {
		slowSaveLocked()
	}
	slowSt.mu.Unlock()
	if entry {
		w := "answered in " + fmt.Sprint(took.Milliseconds()) + " ms"
		switch {
		case stopped:
			w = "over 2 s (stopped)"
		case tallyNoAnswer(err):
			w = "not answered"
		case !ok:
			w = "answered in " + fmt.Sprint(took.Milliseconds()) + " ms (over the limit)"
		}
		liveSayOnce("slowfetch|"+co+"|"+w, fmt.Sprintf("Recorder: entry fetch of %s: %s", name, w))
	}
	for _, m := range marked {
		writeLog("Recorder: " + m)
	}
}

// under slowSt.mu: the stops decided by what came after them; the companies marked now (their log lines)
func slowDecideLocked(now time.Time) []string {
	w := slowAround()
	var out []string
	for co, st := range slowSt.cos {
		if len(st.stops) == 0 {
			continue
		}
		closers := map[int64]bool{}
		var keep []slowStop
		for _, s := range st.stops {
			// another request on the same Tally: not this company's entry, and not another company's entry stopped
			other := func(e slowEv) bool { return e.port == s.port && !(e.entry && e.co == co) && !(e.entry && !e.ok) }
			var before, after *slowEv
			for i := len(slowSt.evs) - 1; i >= 0; i-- {
				if e := slowSt.evs[i]; e.seq < s.seq && other(e) {
					before = &slowSt.evs[i]
					break
				}
			}
			for i := range slowSt.evs {
				if e := slowSt.evs[i]; e.seq > s.seq && other(e) {
					after = &slowSt.evs[i]
					break
				}
			}
			switch {
			case before == nil || !before.ok || s.at.Sub(before.at) > w:
				// Tally was not seen answering other requests in time just before: not counted
			case after == nil:
				if now.Sub(s.at) <= w {
					keep = append(keep, s) // not decided yet
				}
			case after.ok && after.at.Sub(s.at) <= w:
				closers[after.seq] = true // the stops between the same two answers are one occasion
			}
		}
		st.stops = keep
		st.occ += len(closers)
		if st.occ >= 2 && slowSt.marks[co] == nil {
			m := &slowMark{Company: st.name, GUID: heldGUID(st.name), Since: now.In(liveZone).Format(time.RFC3339), TimesOver: st.over, LastMs: st.lastMs,
				Why: fmt.Sprintf("finding one entry took Tally longer than 2 s: stopped %d times, on %d separate occasions while Tally answered other requests in time", st.over, st.occ)}
			slowSt.marks[co] = m
			last := "never answered in time"
			if st.lastMs >= 0 {
				last = fmt.Sprintf("last answered in %d ms", st.lastMs)
			}
			out = append(out, fmt.Sprintf("%s: entry fetch stopped: over 2 s (stopped %d times, %s). No entry of it is asked of Tally any more; its lines go up held (upload that day's Day Book to settle them). This lifts when a newer FinCom Bridge is installed",
				st.name, st.over, last))
		}
	}
	return out
}

// the beat's recorderBodyFetch: per company marked {off, seconds, at, why} (the shape FinCom's cloud keeps as
// recorderOff.bodies) and {company, since, timesOver, lastMs (when it ever answered)}; {} when none
func slowBeat() M {
	slowSt.mu.Lock()
	defer slowSt.mu.Unlock()
	slowFresh()
	out := M{}
	for _, m := range slowSt.marks {
		e := M{"off": true, "seconds": liveLimitSec(), "at": m.Since, "why": m.Why, "company": m.Company, "since": m.Since, "timesOver": m.TimesOver}
		if m.LastMs >= 0 {
			e["lastMs"] = m.LastMs
		}
		out[m.Company] = e
	}
	return out
}
