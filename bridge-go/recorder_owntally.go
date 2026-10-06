// Fix 3 (2.3.0; the owner's spike run 37347773182 on TallyPrime 7.1, two Windows users, each with their own Tally on
// ports 9000 / 9001 and their own companies): the live add-on writes every user's lines into the one shared folder
// C:\ProgramData\FinCom\recorder\<company GUID>-<date>.txt, and each user's bridge read every file there, so each bridge
// also sent the other user's company lines under its own name (no GUID, no body, held). The owner's rule: no line from
// another user's session enters a client's books.
//
// The rule: a bridge takes a recorder line only when its OWN Tally had the line's company open at the time the line was
// written (the line's t0, the PC's clock, which every user's Tally on the computer shares). What the bridge knows of its
// own Tally comes from its own Tally's company list (the light company-list request TDSDeskCompanies, already on the
// allow-list: no new request shape), asked by the light check, a posting, Update now, and, here, by the reader itself
// when a line was written after the last look (at most every 30 s, as a background read that gives way to a posting).
// Each complete look (every one of the bridge's own Tallys answered, or is closed) is one observation; a company's
// open stretches are kept in sync\recorder-own-tally.json (the bridge's own folder: a restart keeps them):
//
//   - a line within a stretch (from the first look that saw the company open to the last), or after the last look of a
//     stretch still open in this run: taken;
//   - a line written in the 2 minutes before a stretch began, but after the look before it (the company opened in the
//     meantime): taken (the look the line itself asked for found it open);
//   - a line written after the last look: it waits (not read past) for the next look;
//   - anything else (the company not open here, or no look tells): passed over, never sent, once a day in the log. If
//     in doubt the line is not sent: the Day Book upload remains the fallback for the owner's own entries.
//
// A look at another user's Tally (a port Windows shows as another user's: mine false) never counts as the own Tally's.
//
// The shared-server case (two users open the SAME company data, so the same company GUID, in their own Tallys): both
// bridges take those lines while the company is open in their own Tally. The line id is a hash of the shared file's name,
// generation and the line's offset, so both bridges send the same line id and the cloud keeps it once (recorder_lines
// dedupes by line_id); each bridge asks its own Tally for the entry's body by MasterID, and the H1 checks (the entry must
// be in the asking bridge's own Tally with the line's MasterID and an AlterID not below the line's) keep a body from
// another copy of the data out. A company GUID open in two Tallys at once is the same data by Tally's own GUID, so the
// entry read is that company's.
package main

import (
	"html"
	"strings"
	"time"
)

const (
	liveOwnTake = iota
	liveOwnSkip
	liveOwnWait
)

var (
	liveOwnLead     = 2 * time.Minute  // a line this long before a stretch began (after the look before it) is taken
	liveOwnAskEvery = 30 * time.Second // the reader's own looks at the own Tally, at most this often
	liveOwnKeep     = 32 * 24 * time.Hour
)

// one stretch the company was open in the own Tally: seen open at every look from from to to; after: the look before
// it (zero: none known), when it was not open
type liveOwnIv struct{ after, from, to time.Time }

type liveOwnSt struct {
	name string
	ivs  []liveOwnIv
}

func liveOwnTallyFile() string { return sp("recorder-own-tally.json") }

// the key of a company for this rule: its GUID (lower case), or, for a line the add-on could not give a GUID for
// ("noguid", "name-<company>"), "name:" and its name's key
func liveOwnKey(guid, name string) string {
	g := strings.ToLower(strings.TrimSpace(html.UnescapeString(guid)))
	if g == "" || g == "noguid" || strings.HasPrefix(g, "name-") {
		return "name:" + companyKey(name)
	}
	return g
}

func liveOwnParse(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// under live.mu (liveFresh): the stretches kept on disk; nothing is taken as open in this run until a look says so
func liveOwnLoad() {
	live.own, live.ownCur, live.ownWant, live.ownAskAt = map[string]*liveOwnSt{}, map[string]bool{}, false, time.Time{}
	o := readObjFile(liveOwnTallyFile())
	live.ownAt = liveOwnParse(str(o["at"]))
	for k, v := range obj(o["companies"]) {
		e := obj(v)
		st := &liveOwnSt{name: str(e["name"])}
		for _, x := range arr(e["open"]) {
			iv := obj(x)
			from, to := liveOwnParse(str(iv["from"])), liveOwnParse(str(iv["to"]))
			if from.IsZero() || to.IsZero() {
				continue
			}
			st.ivs = append(st.ivs, liveOwnIv{after: liveOwnParse(str(iv["after"])), from: from, to: to})
		}
		if len(st.ivs) > 0 {
			live.own[k] = st
		}
	}
}

// the stretches as written to disk (under live.mu); stretches ended over 32 days ago are dropped, 200 kept per company
func liveOwnText() string {
	cut := nowFn().Add(-liveOwnKeep)
	cs := M{}
	for k, st := range live.own {
		var ivs []any
		var kept []liveOwnIv
		for _, iv := range st.ivs {
			if iv.to.Before(cut) {
				continue
			}
			kept = append(kept, iv)
		}
		if len(kept) > 200 {
			kept = kept[len(kept)-200:]
		}
		st.ivs = kept
		for _, iv := range kept {
			e := M{"from": iv.from.Format(time.RFC3339Nano), "to": iv.to.Format(time.RFC3339Nano)}
			if !iv.after.IsZero() {
				e["after"] = iv.after.Format(time.RFC3339Nano)
			}
			ivs = append(ivs, e)
		}
		if len(ivs) == 0 {
			delete(live.own, k)
			continue
		}
		cs[k] = M{"name": st.name, "open": ivs}
	}
	o := M{"companies": cs}
	if !live.ownAt.IsZero() {
		o["at"] = live.ownAt.Format(time.RFC3339Nano)
	}
	return jsonText(o)
}

// one look at the own Tally's company list (ports.go openCompaniesAsk): open, the companies its own Tallys listed
// (key -> name); complete: every own Tally answered afresh or is closed. An incomplete look tells nothing (a Tally that
// did not answer may have the company open): it is not used
func liveNoteOwnTally(open map[string]string, complete bool) {
	if !complete {
		return
	}
	now := nowFn()
	live.mu.Lock()
	liveFresh()
	for k, name := range open {
		st := live.own[k]
		if st == nil {
			st = &liveOwnSt{}
			live.own[k] = st
		}
		st.name = name
		if n := len(st.ivs); n > 0 && live.ownCur[k] && !now.Before(st.ivs[n-1].to) {
			st.ivs[n-1].to = now // open at the look before and at this one: the stretch goes on
			continue
		}
		st.ivs = append(st.ivs, liveOwnIv{after: live.ownAt, from: now, to: now})
	}
	live.ownCur = map[string]bool{}
	for k := range open {
		live.ownCur[k] = true
	}
	if now.After(live.ownAt) {
		live.ownAt = now
	}
	path, text := liveOwnTallyFile(), liveOwnText()
	live.mu.Unlock()
	if err := saveFile(path, text); err != nil {
		writeLog("Recorder: " + path + " could not be written: " + err.Error())
	}
}

// the time a line was written (its t0, else tw, else t1) and how fine the add-on's time text is (TallyPrime 7.1 writes
// minutes only: "5-Oct-26 13:55")
func liveOwnLineTime(l recLine) (time.Time, time.Duration) {
	for _, s := range []string{l.T0, l.Tw, l.T1} {
		if t := liveTime(s); !t.IsZero() {
			if strings.Count(strings.TrimSpace(s), ":") >= 2 {
				return t, time.Second
			}
			return t, time.Minute
		}
	}
	return time.Time{}, 0
}

// under live.mu: whether a line is taken, passed over, or waits for a look at the own Tally
func liveOwnVerdict(l recLine) int {
	t, res := liveOwnLineTime(l)
	if t.IsZero() {
		return liveOwnSkip // no time on the line: nothing tells whose Tally wrote it
	}
	k := liveOwnKey(l.CGUID, l.CName)
	if st := live.own[k]; st != nil {
		for i, iv := range st.ivs {
			if !t.Before(iv.from) && (!t.After(iv.to) || (i == len(st.ivs)-1 && live.ownCur[k])) {
				return liveOwnTake
			}
			if t.Before(iv.from) && iv.from.Sub(t) <= liveOwnLead && (iv.after.IsZero() || t.After(iv.after)) {
				return liveOwnTake
			}
		}
	}
	if t.Add(res).After(live.ownAt) {
		// written after the last look (or within the time text's precision of it): the next look tells
		live.ownWant = true
		return liveOwnWait
	}
	return liveOwnSkip
}

// under live.mu: a line passed over (not open in the own Tally when written): counted; said once per company a day
func liveNotHere(l recLine) {
	name := strings.TrimSpace(l.CName)
	if name == "" {
		name = strings.TrimSpace(l.CGUID)
	}
	liveCo(name).notHere++
	k := "nothere|" + liveOwnKey(l.CGUID, l.CName) + "|" + nowFn().Format("20060102")
	if live.logged[k] {
		return
	}
	live.logged[k] = true
	writeLog("Recorder: " + name + ": lines from a Tally this bridge does not read (company not open here): not sent")
}

// the reader's own look at the own Tally, when a line waits for one: the light company-list request as a background
// read (it gives way to a posting or an import; never while reading is stopped), 30 s apart at most. True: a look went
func liveOwnAskNow() bool {
	now := nowFn()
	live.mu.Lock()
	go1 := live.ownWant && (now.Sub(live.ownAskAt) >= liveOwnAskEvery || now.Before(live.ownAskAt))
	live.mu.Unlock()
	if !go1 || lightCheckBlocked() != "" {
		return false
	}
	live.mu.Lock()
	live.ownWant, live.ownAskAt = false, now
	live.mu.Unlock()
	openCompaniesAsk(bgCompaniesTC(), true)
	return true
}

// 2.3.1 (the owner, 06-Oct-2026): the company list (TDSDeskCompanies) asked in the background - the reader's own look
// here, when a line waits for one, and the light check's list (startpoint.go lightCompanyList) - is a background read
// under the same 2-second HARD stop as the entry request (RecorderLimitMs): the bridge stops waiting then, and a look so
// stopped is incomplete (it tells nothing; liveNoteOwnTally). It gives way to a posting. A person's look (Update now, the
// tray, the setup) is not cut
func bgCompaniesTC() *TC {
	return &TC{copier: true, light: true, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }, limitMs: keepNum("RecorderLimitMs", 2000)}
}

// After 2.3.0 (refetch): under live.mu, whether this bridge's own Tally has the company open now: its last look saw it open, or
// a stretch of looks covers now or ended within the last 15 minutes (the looks come every few minutes while Tally is open)
func liveOwnOpenNow(guid, name string) bool {
	k := liveOwnKey(guid, name)
	if live.ownCur[k] {
		return true
	}
	st := live.own[k]
	if st == nil {
		return false
	}
	now := nowFn()
	for _, iv := range st.ivs {
		if !now.Before(iv.from) && now.Sub(iv.to) <= 15*time.Minute {
			return true
		}
	}
	return false
}
