// FinCom Bridge 2.5.22 (the owner's decision of 24-Nov-2026: "There should be proper way to tell and auto import of
// tally days into fincom"; findings/tally-tell-autoday-plan.md A.4): the beat says, per company, why the bridge cannot
// read it (skip) and why it has no change numbers for it (numbersWhy). Codes only: FinCom's cloud owns the words.
//
// Both come from what the bridge already holds: the company list it last had (coCache, or the one saved with the open
// companies), the light check's last result per company, the pick-ups it said and the companies marked slow. Building
// them sends NOTHING to Tally (tell2522_test.go counts the requests).
//
// The own-Tally privacy rule: both name ONLY companies FinCom's cloud itself named to this bridge as linked books (the
// beat answer's booksFrom with a day: tellNamed), and the first days FinCom gave before (fincom-books-from.json). A
// company open on a Tally whose owner Windows cannot tell, or on another user's, is never reported unless FinCom
// already linked it.
package main

import (
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// the codes (A.4); nothing else is ever sent
const (
	tellOwnerUnknown = "ownerUnknown" // seen only on a Tally whose owner Windows cannot tell (run as administrator)
	tellTwoTallys    = "twoTallys"    // open on two or more of this user's own Tallys
	tellOtherLogin   = "otherLogin"   // open only in another Windows user's Tally
	tellNotOpen      = "notOpen"      // this user's Tally answers, without the company
	tellOtherCopy    = "otherCopy"    // the company open here is another copy (its GUID differs from the book's)
	tellSlow         = "slow"         // its entries are not asked: Tally took over 2 s
	tellLightFailed  = "lightFailed"  // the light check (FinComCompany) went and gave no numbers
	tellOver2s       = "over2s"       // the light check was stopped at 2 s, or Tally did not answer in time
	tellNotAsked     = "notAsked"     // no light check of it has gone in this run yet
)

// at most this many companies in each field (the cloud caps the same)
const tellMax = 50

// how long a company FinCom named stays named while it is not named again (closed in Tally, the bridge running on)
const tellNamedKeep = 7 * 24 * time.Hour

var tellSt = struct {
	sync.Mutex
	named map[string]tellName // companyKey -> FinCom's name for it and when it was last named
	light map[string]tellLight
}{named: map[string]tellName{}, light: map[string]tellLight{}}

type tellName struct {
	name string
	at   time.Time
}

type tellLight struct {
	code string // tellLightFailed, tellOver2s; "" after a check that gave numbers
	at   time.Time
}

// the beat answer's booksFrom {company: yyyymmdd | ""}: a company with a day is a linked book FinCom named (kept);
// "" (not linked, or another copy of that name) forgets it; an answer without booksFrom changes nothing
func noteTellNamed(j M) {
	m, ok := j["booksFrom"].(map[string]any)
	if !ok {
		return
	}
	now := nowFn()
	tellSt.Lock()
	defer tellSt.Unlock()
	n := 0
	for co, v := range m {
		if n++; n > 200 {
			break
		}
		k := companyKey(co)
		if k == "" {
			continue
		}
		if finComDay(v) == "" {
			delete(tellSt.named, k)
			continue
		}
		if _, had := tellSt.named[k]; !had && len(tellSt.named) >= 1000 {
			continue
		}
		tellSt.named[k] = tellName{name: cutRunes(strings.Join(strings.Fields(co), " "), 200), at: now}
	}
}

// the light check's result for a company (startpoint.go lightCheckOpen): err nil and numbers given clears it
func noteTellLight(company string, err error, gave bool) {
	k := companyKey(company)
	if k == "" {
		return
	}
	code := ""
	switch {
	case err != nil && (isBusyErr(err) || errors.Is(err, errBackoff) || strings.Contains(err.Error(), "2 s")):
		code = tellOver2s
	case err != nil || !gave:
		code = tellLightFailed
	}
	tellSt.Lock()
	tellSt.light[k] = tellLight{code: code, at: nowFn()}
	tellSt.Unlock()
}

// the companies FinCom named (companyKey -> the name to report): tellNamed, and the first days FinCom gave before
// (named by Tally's own name then, from the list held)
func tellNamedNow(sessions []M) map[string]string {
	out := map[string]string{}
	now := nowFn()
	tellSt.Lock()
	for k, v := range tellSt.named {
		if now.Sub(v.at) > tellNamedKeep {
			delete(tellSt.named, k)
			continue
		}
		out[k] = v.name
	}
	tellSt.Unlock()
	booksFromMu.Lock()
	finComFromLoad()
	held := make([]string, 0, len(finComFromHeld))
	for k := range finComFromHeld {
		held = append(held, k)
	}
	booksFromMu.Unlock()
	for _, k := range held {
		if _, had := out[k]; had {
			continue
		}
		out[k] = k
		for _, s := range sessions {
			for _, c := range sessCompanies(s) {
				if companyKey(str(c["name"])) == k {
					out[k] = cutRunes(strings.TrimSpace(str(c["name"])), 200)
				}
			}
		}
	}
	return out
}

// the company list the bridge holds now (no request: the last list, or the one saved with the open companies)
func tellSessions() []M {
	coMu.Lock()
	c := coCache
	coMu.Unlock()
	if c == nil {
		c = sessionsFromFile(filepath.Join(syncDir(), "open-companies.json"))
	}
	return c
}

// where a company is seen in the list held: on how many of this user's own Tallys, whether on a Tally whose owner is
// not known (not this user's by the postings' rule), on another user's, and whether any own Tally answered at all
type tellSeen struct {
	own, unknown, other int
	ownAnswered         bool
}

func tellSeenOf(sessions []M, key string) tellSeen {
	var t tellSeen
	own := ownRule(sessions)
	for _, s := range sessions {
		if s["skipped"] == true || s["ok"] != true {
			continue
		}
		mine := own(s)
		if mine {
			t.ownAnswered = true
		}
		listed := false
		for _, c := range sessCompanies(s) {
			if companyKey(str(c["name"])) == key {
				listed = true
				break
			}
		}
		switch {
		case !listed:
		case mine:
			t.own++
		case s["mine"] == false:
			t.other++
		default:
			t.unknown++
		}
	}
	return t
}

// the newest pick-up refusal code per company (pickack.go: said in the last hours), and the companies marked slow
func tellPickCodes() map[string]string {
	out := map[string]string{}
	for _, x := range pickBeat() { // newest first
		e := obj(x)
		if e == nil || str(e["state"]) != "refused" {
			continue
		}
		if k := companyKey(str(e["company"])); k != "" {
			if _, had := out[k]; !had {
				out[k] = str(e["code"])
			}
		}
	}
	return out
}

func tellSlowKeys() map[string]bool {
	out := map[string]bool{}
	for co := range slowBeat() {
		out[companyKey(co)] = true
	}
	return out
}

// skip: why the bridge does not read a company FinCom named ("" : it does, or there is nothing to say)
func tellSkipOf(t tellSeen, pick string, slow bool) string {
	switch {
	case t.own >= 2:
		return tellTwoTallys
	case t.own == 1 && pick == "otherCompany":
		return tellOtherCopy
	case t.own == 1 && (slow || pick == "slow" || pick == "dayRetry"):
		return tellSlow
	case t.own == 1:
		return ""
	case t.unknown > 0:
		return tellOwnerUnknown
	case t.other > 0 || pick == "otherLogin":
		return tellOtherLogin
	case t.ownAnswered:
		return tellNotOpen
	}
	return "" // no Tally of this user answers: tallyWhy says it for the whole computer
}

// numbersWhy: why the bridge has no change numbers (altvchid) for a company FinCom named that is seen open ("" : it has)
func tellNumbersWhyOf(t tellSeen, has bool, light tellLight, lightKnown bool) string {
	switch {
	case has || t.own+t.unknown+t.other == 0:
		return ""
	case t.own >= 2:
		return tellTwoTallys
	case t.own == 0 && t.unknown > 0:
		return tellOwnerUnknown
	case lightKnown && light.code != "":
		return light.code
	}
	return tellNotAsked
}

// the beat's skip and numbersWhy {company: code}; at most tellMax each, by name
func tellBeat() (M, M) {
	sessions := tellSessions()
	named := tellNamedNow(sessions)
	picks, slow := tellPickCodes(), tellSlowKeys()
	tellSt.Lock()
	light := make(map[string]tellLight, len(tellSt.light))
	for k, v := range tellSt.light {
		light[k] = v
	}
	tellSt.Unlock()
	keys := make([]string, 0, len(named))
	for k := range named {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	skip, nums := M{}, M{}
	for _, k := range keys {
		t := tellSeenOf(sessions, k)
		if c := tellSkipOf(t, picks[k], slow[k]); c != "" && len(skip) < tellMax {
			skip[named[k]] = c
		}
		cur, _ := latestNumbers(k)
		l, known := light[k]
		if c := tellNumbersWhyOf(t, cur != nil, l, known); c != "" && len(nums) < tellMax {
			nums[named[k]] = c
		}
	}
	return skip, nums
}

// for the tests
func tellReset() {
	tellSt.Lock()
	tellSt.named, tellSt.light = map[string]tellName{}, map[string]tellLight{}
	tellSt.Unlock()
}
