// FinCom Bridge 2.5.22 (findings/tally-tell-autoday-plan.md A.4): addonSilent, "recorderStuck with a reason". Entries
// change in this user's own Tally while the FinCom add-on writes no line for them: the bridge says so per company, with
// why it thinks the add-on is not loaded, so FinCom can say the one plain sentence. A new beat key: the cloud already
// writes info.beat.recorderStuck from recorderState (failed lines), so that name is not reused.
//
// The rule, per company FinCom named (tell2522.go, the own-Tally privacy rule):
//   - the company is open in this user's own Tally (the company list held, the postings' rule);
//   - a light check (FinComCompany, the request already sent every 10 minutes) taken after the last add-on line of the
//     company gave a voucher counter (ALTVCHID) at least 1 above the first such check (since: that later check's time);
//   - no add-on line of the company has come for 15 minutes since then (a line clears it at once).
//
// The reason comes from the tally.ini step's results (tallyini.go, read only here): a shared tally.ini, where FinCom
// never adds the add-on: addonShared; FinCom's line in this user's own tally.ini (added by FinCom, or there already)
// while the running Tally loads nothing: addonAdded (Tally loads it when it starts again); a tally.ini that could not be
// read: fileUnreadable; none found, or without FinCom's line: noFile.
//
// Nothing here asks Tally anything: it reads the bridge's own memory and the tally.ini results it already holds.
package main

import (
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	addonShared         = "addonShared"
	addonAdded          = "addonAdded"
	addonNoFile         = "noFile"
	addonFileUnreadable = "fileUnreadable"
)

// how long the counter may stand above the add-on's last line with no line before the company is said silent
const addonSilentAfter = 15 * time.Minute

type addonCo struct {
	lineAt    time.Time // the last add-on line of the company (this run)
	lineAlter int64     // the highest AlterID an add-on line of the company carried (this run)
	seq       int       // the light check answer last looked at (spSeqOf)
	base      int64     // the counter of the first check after the last line (0: none yet)
	riseAt    time.Time // the check that first gave a counter above base
	top       int64     // the counter of the latest check
}

var addonSt = struct {
	sync.Mutex
	co map[string]*addonCo // companyKey ->
}{co: map[string]*addonCo{}}

// an add-on line of a company was read (recorder_live.go liveEmitFrom); it clears the company's silence
func addonLineSeen(company, alterID string) {
	k := companyKey(company)
	if k == "" {
		return
	}
	addonSt.Lock()
	defer addonSt.Unlock()
	c := addonSt.co[k]
	if c == nil {
		if len(addonSt.co) >= 1000 {
			return
		}
		c = &addonCo{}
		addonSt.co[k] = c
	}
	c.lineAt = nowFn()
	if a := toI64(onlyDigits(alterID)); a > c.lineAlter {
		c.lineAlter = a
	}
	c.base, c.riseAt = 0, time.Time{}
}

// the light check's latest answer of the company looked at (each answer once): the base after a line, the rise above it
func addonLook(key string) *addonCo {
	cur, _ := latestNumbers(key)
	seq := spSeqOf(key)
	addonSt.Lock()
	defer addonSt.Unlock()
	c := addonSt.co[key]
	if c == nil {
		if len(addonSt.co) >= 1000 {
			return nil
		}
		c = &addonCo{}
		addonSt.co[key] = c
	}
	if cur == nil || seq == c.seq {
		cp := *c
		return &cp
	}
	c.seq = seq
	v := toI64(cur["altvchid"])
	at := nowFn()
	if t, err := time.ParseInLocation("2006-01-02T15:04:05", str(cur["at"]), time.Local); err == nil {
		at = t
	}
	if v > 0 && (c.lineAt.IsZero() || !at.Before(c.lineAt)) {
		switch {
		case c.base == 0:
			c.base = v
		case v > c.base && c.riseAt.IsZero():
			c.riseAt = at
		}
		c.top = v
	}
	cp := *c
	return &cp
}

// why the add-on is not heard, from the tally.ini step's results held
func addonReason(inis []any) string {
	has := map[string]bool{}
	for _, x := range inis {
		if e := obj(x); e != nil {
			has[str(e["state"])] = true
		}
	}
	switch {
	case has[iniStateShared]:
		return addonShared
	case has["added"] || has["already"]:
		return addonAdded
	case has["unreadable"] || has["refused"] || has["failed"]:
		return addonFileUnreadable
	}
	return addonNoFile
}

// the beat's addonSilent: [{company, guid, reason, since, tallyAlter, lastLineAlter}], at most tellMax, by name.
// lastLineAlter: the highest AlterID an add-on line of the company carried in this run (0: no line in this run)
func addonSilentBeat() []any {
	sessions := tellSessions()
	named := tellNamedNow(sessions)
	keys := make([]string, 0, len(named))
	for k := range named {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := []any{}
	var reason string
	now := nowFn()
	for _, k := range keys {
		if len(out) >= tellMax {
			break
		}
		c := addonLook(k)
		if c == nil || c.riseAt.IsZero() || now.Sub(c.riseAt) < addonSilentAfter || tellSeenOf(sessions, k).own == 0 {
			continue
		}
		if reason == "" {
			reason = addonReason(tallyIniBeat())
		}
		_, g := latestNumbers(k)
		if g == "" {
			g = heldGUID(k)
		}
		out = append(out, M{"company": named[k], "guid": cut(strings.TrimSpace(g), 100), "reason": reason,
			"since": c.riseAt.UTC().Format(time.RFC3339), "tallyAlter": c.top, "lastLineAlter": c.lineAlter})
	}
	return out
}

// for the tests
func addonReset() {
	addonSt.Lock()
	addonSt.co = map[string]*addonCo{}
	addonSt.Unlock()
}
