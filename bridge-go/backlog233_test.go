package main

// Bridge 2.3.3 (a High in 2.3.2, seen live on NWS144, 07-Oct-2026): with yesterday's held lines in the backlog and Tally
// slow, a NEW save sat unsent for 35 minutes and more, nothing of it in the cloud. The resolver ran first in every turn
// and took the retry schedule's one try for an old held line; the new line's own fetch then found the schedule waiting
// (errRetryWait, "not counted as a try"), so it never reached its 3-stop limit, and while it still needed its body it held
// the queue head for every company. The slow-company rule never counted either: only entry requests went, so no other
// request answered in time around a stop.
//
// The owner's rule: "A save must always show on the Tally page, at least as held with a reason. Silence is not
// acceptable." Written before the code (red first), on the stand Tally in slow mode (the 2 s stop scaled to 200 ms; Tally
// answering a single entry in 220 ms is "2.2 s").
//
//  1. A line whose body is not there on its first attempt, for any reason, goes up held at once with plain words
//     ("waiting: ... FinCom asks again at HH:MM") and joins the held list due at the next try; its body goes later as
//     "<line id>:resolved".
//  2. The held lines cannot starve the new ones: the newest first; the resolver takes at most every other try while live
//     lines wait for a body; a queue head never blocks the others.
//  3. A company slow on every entry is marked even when the only background traffic is entry requests: the beat's small
//     check counts as another request answered in time. A whole-Tally freeze still never marks.
//  4. The beat says, per company, the lines waiting, the oldest, and the held lines being asked again; the Tally page shows
//     one line while lines wait.

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// NWS144 with the 2 s stop at 200 ms, Tally answering every single entry in 500 ms ("5 s": always stopped; 220 ms left
// only 20 ms between the stop and the answer, which a loaded machine could read first: the 2.3.4 coordinator, 08-Oct-2026)
func backlog233Bridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := slow232Bridge(t)
	slowEntries(f, 500*time.Millisecond)
	return p, f, c
}

// yesterday's held lines: n lines of NWS144 sent without their entry the day before, each due to be asked again now
func backlog233Held(t *testing.T, f *standTally, n int) []string {
	t.Helper()
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	last := nowFn().Add(-2 * time.Hour).Format(time.RFC3339)
	heldMu.Lock()
	all, items := liveHeldLoad()
	var ids []string
	for i := 0; i < n; i++ {
		mid := int64(25000 + i)
		id := fmt.Sprintf("old-%d", mid)
		ids = append(ids, id)
		items[id] = heldLine{ID: id, Company: nwsCo, CGUID: nwsGUID, Type: "Journal", No: fmt.Sprintf("J-%d", mid), Date: "20261005", MID: fmt.Sprint(mid),
			At: yest, Added: yest, Last: last, Ev: "created", Why: "the entry was not read from Tally"}
	}
	liveHeldSave(all, items)
	heldMu.Unlock()
	for i := 0; i < n; i++ {
		mid := int64(25000 + i)
		r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 54400+int64(i))
	}
	return ids
}

var reAskedMID = regexp.MustCompile(`(?:\$MasterID = |<ID TYPE="Name">ID:)(\d+)`)

// the MasterIDs Tally was asked for (by MasterID), in order
func backlog233Asked(f *standTally) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var o []string
	for i, b := range f.bodies {
		if i < len(f.reqs) && f.reqs[i] == vchObjectID {
			if m := reAskedMID.FindStringSubmatch(b); m != nil {
				o = append(o, m[1])
			}
		}
	}
	return o
}

// the first line sent for this MasterID that is not a ":resolved" one
func backlog233First(c *standCloud, mid int64) M {
	for _, s := range slowSentOf(c, mid) {
		if !strings.HasSuffix(str(s["line_id"]), ":resolved") {
			return s
		}
	}
	return nil
}

// the words a line goes up held with while Tally is slow or busy
func backlog233Waiting(t *testing.T, s M) {
	t.Helper()
	w := str(s["heldWhy"])
	if str(s["xml"]) != "" || !strings.HasPrefix(w, "waiting: ") || !strings.Contains(w, "FinCom asks again at ") ||
		!(strings.Contains(w, "Tally took longer than") || strings.Contains(w, "Tally busy")) {
		t.Fatalf("not held with the plain words: %q (%v)", w, s)
	}
	if !regexp.MustCompile(`FinCom asks again at \d\d:\d\d`).MatchString(w) {
		t.Fatalf("no time in the words: %q", w)
	}
}

// --- 1. with 40 held lines in the backlog and Tally at 2.2 s on every entry, a NEW save reaches the cloud within 5 s, held
// with the words; once Tally answers in time, its body goes as ":resolved" (the newest first)
func TestBacklog233NewSaveHeldAtOnceThenResolved(t *testing.T) {
	p, f, c := backlog233Bridge(t)
	backlog233Held(t, f, 40)
	// the resolver's turn: an old held line asked, stopped at the limit; the retry schedule now waits
	liveUploadOnce()
	if !retryHeld() {
		t.Fatalf("the backlog's ask was not stopped: %v", f.ids())
	}
	r222Vch(f, 25800, "Journal", "J-25800", "20261005", 54800)
	liveAppend(t, p, slowLine(25800, "07:16")...)
	t0 := time.Now()
	var got M
	for time.Since(t0) < 5*time.Second && got == nil {
		liveReadOnce()
		liveUploadOnce()
		got = backlog233First(c, 25800)
	}
	if got == nil {
		t.Fatalf("the new save is not in the cloud after %s (silence):\n%s", time.Since(t0).Round(time.Millisecond), cutTail(readText(logFile()), 3000))
	}
	backlog233Waiting(t, got)
	id := str(got["line_id"])
	if h, ok := slowHeldItem(t, id); !ok || h.Final {
		t.Fatalf("not in the held list to be asked again: %+v %v", h, ok)
	}
	// Tally answers in time again: at the next try the new line is asked first and goes up with its body
	slowEntries(f, 0)
	retryDue()
	n0 := len(backlog233Asked(f))
	liveUploadOnce()
	asked := backlog233Asked(f)
	if len(asked) <= n0 || asked[n0] != "25800" {
		t.Fatalf("the try did not go to the newest line first: %v (from %d)", asked, n0)
	}
	r := r222cSentID(c, id+":resolved")
	if len(r) != 1 || str(r[0]["xml"]) == "" || str(r[0]["object_guid"]) != r222GUID(25800) || str(r[0]["heldWhy"]) != "" {
		t.Fatalf("the body did not go as %s:resolved: %v", cut(id, 8), r)
	}
	// and the backlog is resolved by itself afterwards (10 a turn; old-25000, whose ask was stopped, waits its hour as
	// 2.3.2 says)
	for i := 0; i < 8; i++ {
		liveUploadOnce()
	}
	if n := len(r222cSentID(c, "old-25001:resolved")) + len(r222cSentID(c, "old-25039:resolved")); n != 2 {
		t.Fatalf("the backlog did not resolve: %d of 2 checked (%v / %v)", n, r222cSentID(c, "old-25001:resolved"), r222cSentID(c, "old-25039:resolved"))
	}
}

// --- 1. no line ever stays unsent more than 5 s: new saves every 300 ms for 4 s, Tally slow, the backlog asked, a new
// entry without a MasterID (asked by its number a few seconds after its line) among them
func TestBacklog233NoLineUnsentOver5s(t *testing.T) {
	p, f, c := backlog233Bridge(t)
	setCfg("RecorderNumberWaitMs", float64(1500))
	backlog233Held(t, f, 40)
	liveUploadOnce()
	type want struct {
		at  time.Time
		key string
	}
	var ws []want
	seen := map[string]time.Time{}
	look := func() {
		for _, s := range c.recSent() {
			for _, k := range []string{str(s["master_id"]), "no:" + str(s["vch_no"])} {
				if _, had := seen[k]; !had && k != "" && k != "no:" {
					seen[k] = time.Now()
				}
			}
		}
	}
	start := time.Now()
	next := start
	for i := 0; time.Since(start) < 9*time.Second; {
		if i < 12 && !time.Now().Before(next) {
			mid := int64(25900 + i)
			if i == 5 {
				// a new entry: no MasterID on its line (found by its type and number)
				r222Vch(f, mid, "Journal", "J-NEW5", "20261005", 54900+int64(i))
				liveAppend(t, p, r222Line("voucher_accept_post", "07:17", nwsGUID+"-00000000", "0", "0", "Journal", "J-NEW5", "5-Oct-2026", "a new one"))
				ws = append(ws, want{time.Now(), "no:J-NEW5"})
			} else {
				r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 54900+int64(i))
				liveAppend(t, p, slowLine(mid, "07:17")...)
				ws = append(ws, want{time.Now(), fmt.Sprint(mid)})
			}
			i++
			next = next.Add(300 * time.Millisecond)
		}
		liveReadOnce()
		liveUploadOnce()
		look()
		if i >= 12 {
			done := true
			for _, w := range ws {
				if _, had := seen[w.key]; !had {
					done = false
				}
			}
			if done {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	for _, w := range ws {
		at, had := seen[w.key]
		if !had {
			t.Errorf("line %s never reached the cloud (silence)", w.key)
			continue
		}
		if d := at.Sub(w.at); d > 5*time.Second {
			t.Errorf("line %s waited %s unsent (over 5 s)", w.key, d.Round(time.Millisecond))
		}
	}
	for _, s := range c.recSent() {
		if str(s["xml"]) == "" && !strings.HasSuffix(str(s["line_id"]), ":resolved") && str(s["heldWhy"]) == "" && str(s["event"]) == "created" {
			t.Errorf("a line went without its body and without words: %v", s)
		}
	}
}

// --- 2. the resolver cannot starve new lines: with the backlog due at every try, each new save is asked at the first or
// second try after it, and is in the cloud (held) before that try
func TestBacklog233ResolverCannotStarve(t *testing.T) {
	p, f, c := backlog233Bridge(t)
	backlog233Held(t, f, 40)
	liveUploadOnce() // the backlog takes the first ask; stopped
	for k := 0; k < 4; k++ {
		mid := int64(25960 + k)
		r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 54960+int64(k))
		liveAppend(t, p, slowLine(mid, "07:18")...)
		liveReadOnce()
		liveUploadOnce() // no try due: the line's own fetch waits for the schedule
		if s := backlog233First(c, mid); s == nil {
			t.Fatalf("save %d: not sent held while the schedule waits (it sat at the queue head)", mid)
		} else {
			backlog233Waiting(t, s)
		}
		hit := false
		for try := 0; try < 2 && !hit; try++ {
			n0 := len(backlog233Asked(f))
			retryDue()
			liveUploadOnce()
			for _, m := range backlog233Asked(f)[n0:] {
				if m == fmt.Sprint(mid) {
					hit = true
				}
			}
		}
		if !hit {
			t.Fatalf("save %d was not asked within 2 tries; asked: %v", mid, backlog233Asked(f))
		}
	}
	// the old ones still get their turn once the new ones have had their 3 asks: not starved either
	for try := 0; try < 12; try++ {
		retryDue()
		liveUploadOnce()
	}
	old := 0
	for _, m := range backlog233Asked(f) {
		if strings.HasPrefix(m, "250") {
			old++
		}
	}
	if old < 2 {
		t.Fatalf("the backlog got %d tries: %v", old, backlog233Asked(f))
	}
}

// --- 2. at most every other try goes to the resolver while live lines wait for a body (the queue's own fetch alternates
// with it), and a company's line waiting never holds another company's line
func TestBacklog233EveryOtherTry(t *testing.T) {
	_, f, _ := backlog233Bridge(t)
	backlog233Held(t, f, 40)
	liveUploadOnce()
	// six live lines of today needing their body, queued at once
	var mu sync.Mutex
	took := []string{}
	n := 0
	live.mu.Lock()
	for i := 0; i < 6; i++ {
		c := &change{company: nwsCo, companyGuid: nwsGUID, event: "created", masterId: fmt.Sprint(26000 + i), vchType: "Journal", vchNo: fmt.Sprintf("J-%d", 26000+i),
			vchDate: "20261005", source: "addon", lineId: fmt.Sprintf("q-%d", i), saveMs: -1, readAt: nowFn(), at: nowFn().Format(time.RFC3339)}
		liveQueueAdd(c)
	}
	live.mu.Unlock()
	for try := 0; try < 6; try++ {
		n0 := len(backlog233Asked(f))
		retryDue()
		liveUploadOnce()
		for _, m := range backlog233Asked(f)[n0:] {
			mu.Lock()
			if strings.HasPrefix(m, "250") {
				took = append(took, "old")
			} else {
				took = append(took, "live")
			}
			n++
			mu.Unlock()
		}
	}
	for i := 1; i < len(took); i++ {
		if took[i] == "old" && took[i-1] == "old" {
			t.Fatalf("the resolver took two tries in a row while live lines waited: %v", took)
		}
	}
	if n == 0 {
		t.Fatal("nothing asked")
	}
}

// --- 3. a company at 2.2 s on every entry, the only background requests its entry requests and the beat's small check:
// 2.3.3 marked it; 2.3.4 (the owner's decision of 08-Oct-2026, option (a)) never marks it: each entry's line ends with the
// Day Book words, asked once
func TestBacklog233SlowMarkedWithOnlyEntryRequests(t *testing.T) {
	p, f, c := backlog233Bridge(t)
	slowEntries(f, 0)
	slowLook() // the company list as the reader had it (Tally answering in time)
	slowEntries(f, 500*time.Millisecond)
	base := nowFn()
	f.mu.Lock()
	reqs0 := len(f.reqs)
	f.mu.Unlock()
	marked := -1
	for s, k := 0, 0; s <= 45*60; s += 60 {
		retryClock(base, s)
		if s%180 == 0 {
			mid := int64(26100 + k)
			k++
			r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 55100+int64(k))
			liveAppend(t, p, slowLine(mid, "07:20")...)
			liveReadOnce()
		}
		liveUploadOnce()
		lightCheckOpen(openCompaniesCached()) // the beat's small check (every beat; due every 10 minutes a company)
		if slowMarked(nwsCo, nwsGUID) {
			marked = s
			break
		}
	}
	if marked >= 0 {
		t.Fatalf("a company at 2.2 s on every entry was marked after %d s:\n%s", marked, cutTail(readText(logFile()), 4000))
	}
	f.mu.Lock()
	for _, id := range f.reqs[reqs0:] {
		if id != vchObjectID && id != vchByNumberID && id != "FinComCompany" && id != "FinComCompanyNumbers" && id != "TDSDeskCompanies" {
			f.mu.Unlock()
			t.Fatalf("a request other than the entry, the small check and the company list: %s", id)
		}
	}
	f.mu.Unlock()
	// every line of it is in the cloud, held: at once with the once-more words, and (the owner's answer B) asked once
	// more 5 minutes later and ended with the Day Book words; each entry asked twice at most
	lines := 0
	for _, s := range c.recSent() {
		w := str(s["heldWhy"])
		if !strings.HasSuffix(str(s["line_id"]), ":resolved") {
			lines++
		}
		if str(s["xml"]) != "" || !(strings.HasPrefix(w, "waiting: ") || strings.HasSuffix(w, "upload that day's Day Book to settle it")) {
			t.Fatalf("a line: %v", s)
		}
	}
	for k := 0; k < 16; k++ {
		if n := objAsksOf(f, int64(26100+k)); n > 2 {
			t.Fatalf("entry %d: %d asks", 26100+k, n)
		}
	}
	if lines != 16 {
		t.Fatalf("16 entries: %d lines", lines)
	}
}

// --- 3. a whole-Tally freeze (the small check slow too) never marks, whatever only entry requests go
func TestBacklog233FreezeStillDoesNotMark(t *testing.T) {
	p, f, _ := backlog233Bridge(t)
	slowEntries(f, 0)
	slowLook()
	slowAll(f, 500*time.Millisecond)
	base := nowFn()
	for s, k := 0, 0; s <= 45*60; s += 60 {
		retryClock(base, s)
		if s%180 == 0 {
			mid := int64(26200 + k)
			k++
			r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 55200+int64(k))
			liveAppend(t, p, slowLine(mid, "07:20")...)
			liveReadOnce()
		}
		liveUploadOnce()
		lightCheckOpen(openCompaniesCached())
	}
	if slowMarked(nwsCo, nwsGUID) {
		t.Fatalf("marked by a whole-Tally freeze:\n%s", cutTail(readText(logFile()), 3000))
	}
}

// --- 4. the beat per company: the lines waiting, the oldest, the held lines being asked again; one plain line for the
// Tally page while lines wait (none when nothing waits)
func TestBacklog233BeatWaiting(t *testing.T) {
	p, f, _ := backlog233Bridge(t)
	backlog233Held(t, f, 40)
	b := beatBody(true, "open", "", nil, nil, nil)
	e := obj(obj(b["recorderState"])[nwsCo])
	if toInt(e["heldAsking"]) != 40 {
		t.Fatalf("the held lines being asked again: %v", obj(b["recorderState"]))
	}
	if str(b["recorderWaitWords"]) != "" {
		t.Fatalf("words while nothing waits: %q", b["recorderWaitWords"])
	}
	// two lines read a minute ago and not sent yet (the uploader has not turned since)
	r222Vch(f, 26300, "Journal", "J-26300", "20261005", 55300)
	liveAppend(t, p, slowLine(26300, "07:21")...)
	r222Vch(f, 26301, "Journal", "J-26301", "20261005", 55301)
	liveAppend(t, p, slowLine(26301, "07:21")...)
	liveReadOnce()
	live.mu.Lock()
	for _, c := range live.queue {
		c.readAt = nowFn().Add(-time.Minute)
	}
	live.mu.Unlock()
	b = beatBody(true, "open", "", nil, nil, nil)
	e = obj(obj(b["recorderState"])[nwsCo])
	if toInt(e["waiting"]) != 2 || str(e["oldestWaiting"]) == "" || toInt(e["heldAsking"]) != 40 {
		t.Fatalf("the beat's recorderState: %v", e)
	}
	w := str(b["recorderWaitWords"])
	if !strings.Contains(w, "2 changes of "+nwsCo+" waiting to go to FinCom") || !strings.Contains(w, "oldest since") || !strings.Contains(w, "40 held") ||
		strings.Contains(w, "\n") || len(w) > 300 {
		t.Fatalf("the Tally page's line: %q", w)
	}
}

// --- the version, the allow-list's decision line (no request added or changed: TestAllowListUnchanged keeps the table's
// hash) and the notes with their test sheet
func TestBacklog233VersionAndDecisionLine(t *testing.T) {
	if BridgeVersion != "2.3.4" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	if !strings.Contains(line, "as for 2.3.3: the owner's standing decision of 2026-10-06: no request on the list and no request shape changed") {
		t.Fatalf("the decision line: %s", cut(line, 300))
	}
	if strings.Contains(al, "allowed for 2.3.2 by") {
		t.Fatal("the 2.3.2 line is still an exception line (release-check accepts one version only)")
	}
	// 2.3.4: the table changed with the entry request (FinComVoucherObject), said in the doc
	if !strings.Contains(al, "1c17806d483e0a31477bc93bcf0646334c156eda88e8a401a8df155d0bca02dd") && !strings.Contains(al, "(2.3.4, from branch next-fastfetch, 08-Oct-2026") {
		t.Fatal("the table's hash moved")
	}
	notes := strings.Join(strings.Fields(readText("../docs/bridge-2.3.3-notes.md")), " ")
	for _, w := range []string{"2.3.3", "Silence is not acceptable", "waiting: ", "FinCom asks again at", ":resolved", "Test sheet", "roll back",
		"No Tally request was added or changed", "every other try", "the beat's small check"} {
		if !strings.Contains(notes, w) {
			t.Errorf("the 2.3.3 notes do not say %q", w)
		}
	}
}

func cutTail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

// --- the owner's rules of 07-Oct-2026 (evening), replacing 2.3.2's back-off where they differ:
//
//	a. an old held line is asked again AT MOST ONCE; if that ask stops or fails it ends at once with the Day Book words;
//	c. every line reaches FinCom within 10 s of its save, at least held with its reason;
//	d. nothing is sent to a Tally that has not answered the previous request: after a 2 s stop the request is kept open
//	   until Tally answers it (inflight.go), and only then does the next one go.
//
// With 40 old held lines, Tally at 2.2 s on every entry and the abandoned requests kept open: Tally gets ONE request per
// old line, never two at once, every old line ends, and a new save is in the cloud within 5 s
func TestBacklog233OldLinesAskedOnceOneAtATime(t *testing.T) {
	p, f, c := slow232Bridge(t)
	setCfg("TallyAbandonMaxSec", float64(600))
	t.Cleanup(resetEarlier)
	var now, most atomic.Int32
	f.mu.Lock()
	f.slow = nil
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		n := now.Add(1)
		defer now.Add(-1)
		for {
			m := most.Load()
			if n <= m || most.CompareAndSwap(m, n) {
				break
			}
		}
		if id == vchObjectID || id == vchByNumberID {
			// Tally itself busy 5 s (the stop is at 2 s), whether or not anyone waits. Not 2.2 s: the 20 ms between the stop
			// and the answer let a loaded machine read the answer before the stop fired (line 25014 sent with its body,
			// the 2.3.4 coordinator, 08-Oct-2026)
			time.Sleep(500 * time.Millisecond)
		}
		return false
	}
	f.mu.Unlock()
	t.Cleanup(func() { earlierQuiet(f.port) })
	ids := backlog233Held(t, f, 40)
	r222Vch(f, 25990, "Journal", "J-25990", "20261005", 54990)
	start := time.Now()
	var newAt time.Duration
	saved := false
	for time.Since(start) < 40*time.Second {
		if !saved && time.Since(start) > 2*time.Second {
			liveAppend(t, p, slowLine(25990, "07:30")...)
			saved = true
			start2 := time.Now()
			for newAt == 0 && time.Since(start2) < 10*time.Second {
				liveReadOnce()
				liveUploadOnce()
				if backlog233First(c, 25990) != nil {
					newAt = time.Since(start2)
				}
				time.Sleep(20 * time.Millisecond)
			}
			if newAt == 0 {
				t.Fatalf("the new save is not in the cloud 10 s after it (silence):\n%s", cutTail(readText(logFile()), 3000))
			}
		}
		retryDue()
		liveReadOnce()
		liveUploadOnce()
		asked := map[string]int{}
		for _, m := range backlog233Asked(f) {
			asked[m]++
		}
		all := 0
		for _, id := range ids {
			if asked[strings.TrimPrefix(id, "old-")] > 0 {
				all++
			}
		}
		if all == len(ids) && saved {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	// the owner's answer B (08-Oct-2026): each was stopped; none ends at its first stop, each is asked once more 5 minutes on
	for _, id := range ids {
		if s := r222cSentID(c, id+":resolved"); len(s) != 0 {
			t.Errorf("old held line %s ended at its first stop: %v", id, s)
		}
	}
	perFirst := map[string]int{}
	for _, m := range backlog233Asked(f) {
		perFirst[m]++
	}
	retryClock(time.Now(), 360)
	t.Cleanup(func() { nowFn = time.Now })
	for start3 := time.Now(); time.Since(start3) < 40*time.Second; {
		retryDue()
		liveUploadOnce()
		ended := 0
		for _, id := range ids {
			if len(r222cSentID(c, id+":resolved")) > 0 {
				ended++
			}
		}
		if ended == len(ids) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if newAt > 5*time.Second {
		t.Errorf("the new save took %s to reach the cloud (over 5 s)", newAt.Round(time.Millisecond))
	}
	per := map[string]int{}
	for _, m := range backlog233Asked(f) {
		per[m]++
	}
	for _, id := range ids {
		mid := strings.TrimPrefix(id, "old-")
		if perFirst[mid] != 1 || per[mid] != 2 {
			t.Errorf("old held line %s: %d requests in the first turn, %d in all (want 1 and 2)", mid, perFirst[mid], per[mid])
		}
		s := r222cSentID(c, id+":resolved")
		if len(s) != 1 || str(s[0]["xml"]) != "" || str(s[0]["heldWhy"]) != liveStopEndWords() { // 2.3.4 (answer B): stopped twice: the stop words
			t.Errorf("old held line %s did not end with the Day Book words: %v", mid, s)
		}
	}
	if most.Load() != 1 {
		t.Errorf("%d requests at Tally at once (want 1: nothing sent while a stopped request is still at Tally)", most.Load())
	}
}

// --- a. an old held line Tally answers without its entry ("not there"): its one ask is used; it ends with the words
func TestBacklog233OldLineNotFoundEndsAfterOneAsk(t *testing.T) {
	_, f, c := slow232Bridge(t)
	heldMu.Lock()
	all, items := liveHeldLoad()
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	items["old-x"] = heldLine{ID: "old-x", Company: nwsCo, CGUID: nwsGUID, Type: "Journal", No: "J-X", Date: "20261005", MID: "25555", At: yest, Added: yest, Last: yest, Ev: "created"}
	liveHeldSave(all, items)
	heldMu.Unlock()
	for i := 0; i < 5; i++ {
		liveUploadOnce()
	}
	if n := f.n(vchObjectID) + f.n(vchByNumberID); n != 1 {
		t.Fatalf("asked %d times (want one request): %v", n, f.ids())
	}
	if s := r222cSentID(c, "old-x:resolved"); len(s) != 1 || str(s[0]["heldWhy"]) != liveHeldOnceGiveUp {
		t.Fatalf("the end: %v", s)
	}
}

// --- review M1 and M2 of b1e5858..ce79426 (rule c: every line in FinCom within 10 s), scaled as the rest (the stop 200 ms
// = 2 s; 10 s = 1 s; the 4 s safety net = 400 ms). A loop like the bridge's own (recorderLiveLoop) runs the reader and the
// uploader while the test saves; each save's first line in the cloud is timed from the save
type b233Loop struct {
	stop chan struct{}
	done chan struct{}
}

func b233Run() *b233Loop {
	l := &b233Loop{stop: make(chan struct{}), done: make(chan struct{})}
	// the reader (the bridge's 1 s watch) and the uploader (recorderLiveLoop) run side by side, as in the bridge
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-l.stop:
				return
			default:
			}
			liveReadOnce()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-l.stop:
				return
			default:
			}
			for i := 0; i < 20 && liveUploadOnce() > 0; i++ {
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	go func() { wg.Wait(); close(l.done) }()
	return l
}

func (l *b233Loop) end() { close(l.stop); <-l.done }

// when each MasterID's first line reached the cloud (polled every 10 ms until all are in, or the limit)
func b233Arrivals(c *standCloud, mids []int64, limit time.Duration) map[int64]time.Time {
	got := map[int64]time.Time{}
	until := time.Now().Add(limit)
	for time.Now().Before(until) && len(got) < len(mids) {
		for _, m := range mids {
			if _, had := got[m]; !had && backlog233First(c, m) != nil {
				got[m] = time.Now()
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	return got
}

// M1: a company answering in 1.5 s (never stopped, never marked) with 10 held lines due: a save made while the resolver
// asks them reaches the cloud within 10 s (the resolver yields to it, one ask at most while a live line waits)
func TestBacklog233M1SaveDuringHealthyResolverTurn(t *testing.T) {
	p, f, c := slow232Bridge(t)
	setCfg("RecorderHoldAfterMs", float64(400))
	slowEntries(f, 150*time.Millisecond) // 1.5 s: answered in time
	backlog233Held(t, f, 12)
	r222Vch(f, 26500, "Journal", "J-26500", "20261005", 55500)
	l := b233Run()
	defer l.end()
	time.Sleep(60 * time.Millisecond) // the resolver's turn has started
	t0 := time.Now()
	liveAppend(t, p, slowLine(26500, "07:40")...)
	got := b233Arrivals(c, []int64{26500}, 3*time.Second)
	at, had := got[26500]
	if !had || at.Sub(t0) > time.Second {
		t.Fatalf("the save during a healthy resolver turn: in the cloud %v after %s (10 s scaled: 1 s)", had, at.Sub(t0).Round(time.Millisecond))
	}
}

// M2: 8 saves together, Tally at 1.8 s each (answered in time): each line in the cloud within 10 s of its save
func TestBacklog233M2BurstOfEight(t *testing.T) {
	p, f, c := slow232Bridge(t)
	setCfg("RecorderHoldAfterMs", float64(400))
	// 1.2 s each, scaled (under the 2 s stop with room: 1.8 s left 20 ms between the answer and the stop, which a loaded
	// machine crossed: a stop, then the one more ask 5 minutes on, and the body not in this test's time; with 2.3.4's
	// company list before each entry request the 20 ms are gone)
	slowEntries(f, 120*time.Millisecond)
	var mids []int64
	var lines []string
	for i := 0; i < 8; i++ {
		mid := int64(26600 + i)
		mids = append(mids, mid)
		r222Vch(f, mid, "Journal", fmt.Sprintf("J-%d", mid), "20261005", 55600+int64(i))
		lines = append(lines, slowLine(mid, "07:45")...)
	}
	l := b233Run()
	defer l.end()
	t0 := time.Now()
	liveAppend(t, p, lines...)
	got := b233Arrivals(c, mids, 4*time.Second)
	for _, m := range mids {
		at, had := got[m]
		if !had || at.Sub(t0) > time.Second {
			t.Errorf("save %d: in the cloud %v after %s (10 s scaled: 1 s)", m, had, at.Sub(t0).Round(time.Millisecond))
		}
	}
	// and every entry's body comes, at once or as ":resolved"
	time.Sleep(1500 * time.Millisecond)
	for _, m := range mids {
		ok := false
		for _, s := range slowSentOf(c, m) {
			if str(s["xml"]) != "" {
				ok = true
			}
		}
		if !ok {
			t.Errorf("save %d never went with its body: %v", m, slowSentOf(c, m))
		}
	}
}

// --- re-review (b1e5858..a6cfda0): M2 for ledger lines. A burst of 8 changed ledgers (a masters import) at "1.8 s" each,
// with a voucher in the same group: every line in the cloud within "10 s" (the ledgers not read by then go without their
// body, FinCom takes them from the ledger changes)
func TestBacklog233M2LedgerBurst(t *testing.T) {
	rec, f, c := liveBridge(t, `,"RecorderLimitMs":200,"RecorderHoldAfterMs":400`)
	td := today()
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	v := f.add(td, "Party L", "PL-1", "with ledgers", "-1.00")
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == ledListID {
			return 180 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	var lines []string
	var names []string
	for i := 0; i < 8; i++ {
		n := fmt.Sprintf("Burst Ledger %d", i)
		names = append(names, n)
		l := f.addLed(n, "Sundry Creditors", "0.00")
		lines = append(lines, lLine("ledger_accept_pre", "", "", "", n, "Sundry Creditors"), lLine("ledger_accept_post", l.guid, fmt.Sprint(l.mid), fmt.Sprint(l.alter), n, "Sundry Creditors"))
	}
	lines = append(lines, liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "1", "Journal", "PL-1", td, "", "", "with ledgers"))
	l := b233Run()
	defer l.end()
	t0 := time.Now()
	liveAppend(t, liveFilePath(rec, ""), lines...)
	seen := map[string]time.Duration{}
	for time.Since(t0) < 4*time.Second && len(seen) < 9 {
		for _, s := range c.recSent() {
			k := str(s["name"])
			if str(s["event"]) != "ledger_created" && str(s["event"]) != "ledger_altered" {
				k = "voucher " + str(s["master_id"])
			}
			if _, had := seen[k]; !had {
				seen[k] = time.Since(t0)
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	want := append(append([]string{}, names...), "voucher "+v.master)
	for _, k := range want {
		if d, had := seen[k]; !had || d > time.Second {
			t.Errorf("%s: in the cloud %v after %s (10 s scaled: 1 s)", k, had, d.Round(time.Millisecond))
		}
	}
}

// --- re-review L1: a held line's ask that never reached Tally (refused by the posting's yield before it was sent) is NOT
// counted, whatever other requests reached Tally meanwhile (the global request counter moved)
func TestBacklog233L1UnsentAskNotCounted(t *testing.T) {
	_, f, c := slow232Bridge(t)
	heldMu.Lock()
	all, items := liveHeldLoad()
	yest := nowFn().Add(-20 * time.Hour).Format(time.RFC3339)
	items["old-l1"] = heldLine{ID: "old-l1", Company: nwsCo, CGUID: nwsGUID, Type: "Journal", No: "J-L1", Date: "20261005", MID: "25444", At: yest, Added: yest, Last: yest, Ev: "created"}
	liveHeldSave(all, items)
	heldMu.Unlock()
	_, _ = findCompanyPortBg(nwsCo, 0)
	liveResolveAskHook = func() {
		tallySent.Add(1)       // another request reached Tally meanwhile (a posting's import, a small check)
		importsInFlight.Add(1) // and a posting is going: the ask gives way before it is sent
	}
	defer func() { liveResolveAskHook = nil; importsInFlight.Store(0) }()
	n := f.n(vchObjectID)
	liveResolveTurn()
	liveResolveAskHook = nil
	importsInFlight.Store(0)
	if f.n(vchObjectID) != n {
		t.Fatalf("the ask reached Tally: %v", f.ids())
	}
	if s := r222cSentID(c, "old-l1:resolved"); len(s) != 0 {
		t.Fatalf("a held line never asked was ended: %v", s)
	}
	if h, ok := slowHeldItem(t, "old-l1"); !ok || h.Asked != 0 {
		t.Fatalf("its ask was counted: %+v %v", h, ok)
	}
	// then asked, once, after the posting (its next turn: the held list's spacing)
	at := nowFn().Add(11 * time.Minute)
	nowFn = func() time.Time { return at }
	liveResolveTurn()
	if f.n(vchObjectID) != n+1 {
		t.Fatalf("not asked after the posting: %v", f.ids())
	}
}
