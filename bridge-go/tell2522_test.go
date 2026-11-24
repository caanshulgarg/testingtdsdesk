package main

// bridge 2.5.22 (findings/tally-tell-autoday-plan.md A.4, the owner's decision of 24-Nov-2026): the beat's skip,
// numbersWhy and addonSilent. Made-up companies only.
import (
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// the company list held: this user's Tally on own (and own2), one whose owner Windows cannot tell, another user's
func tellSessionsFixture(own, own2 int) []M {
	co := func(names ...string) []any {
		var l []any
		for _, n := range names {
			l = append(l, M{"name": n, "guid": "g-" + strings.ToLower(strings.ReplaceAll(n, " ", "-"))})
		}
		return l
	}
	return []M{
		{"port": own, "ok": true, "mine": true, "companies": co("ZZ FINE", "ZZ TWO")},
		{"port": own2, "ok": true, "mine": true, "companies": co("ZZ TWO")},
		{"port": 9101, "ok": true, "mine": nil, "owner": "unknown", "companies": co("ZZ ADMIN", "ZZ NEVER NAMED")},
		{"port": 9102, "ok": true, "mine": false, "companies": co("ZZ OTHER", "ZZ STRANGER")},
	}
}

func tellSetup(t *testing.T) *standTally {
	t.Helper()
	f := newStandTally(t)
	standBridge(t, f, "")
	tellReset()
	addonReset()
	t.Cleanup(func() { tellReset(); addonReset(); coMu.Lock(); coCache = nil; coMu.Unlock() })
	coMu.Lock()
	coCache = tellSessionsFixture(f.port, 9100)
	coMu.Unlock()
	// FinCom named these as linked books (a day); ZZ UNLINKED with "" (not linked): never reported
	noteTellNamed(M{"booksFrom": map[string]any{"ZZ FINE": "20260401", "ZZ TWO": "20260401", "ZZ ADMIN": "20260401",
		"ZZ OTHER": "20260401", "ZZ CLOSED": "20260401", "ZZ UNLINKED": ""}})
	return f
}

func TestTell2522SkipCodes(t *testing.T) {
	tellSetup(t)
	skip, nums := tellBeat()
	want := M{"ZZ TWO": tellTwoTallys, "ZZ ADMIN": tellOwnerUnknown, "ZZ OTHER": tellOtherLogin, "ZZ CLOSED": tellNotOpen}
	if len(skip) != len(want) {
		t.Fatalf("skip %v, want %v", skip, want)
	}
	for k, v := range want {
		if skip[k] != v {
			t.Errorf("skip[%s] = %v, want %v", k, skip[k], v)
		}
	}
	wantN := M{"ZZ FINE": tellNotAsked, "ZZ TWO": tellTwoTallys, "ZZ ADMIN": tellOwnerUnknown, "ZZ OTHER": tellNotAsked}
	if len(nums) != len(wantN) {
		t.Fatalf("numbersWhy %v, want %v", nums, wantN)
	}
	for k, v := range wantN {
		if nums[k] != v {
			t.Errorf("numbersWhy[%s] = %v, want %v", k, nums[k], v)
		}
	}
	// the light check's result: stopped at 2 s, then failed, then numbers
	noteTellLight("ZZ FINE", errBackoff, false)
	if _, n := tellBeat(); n["ZZ FINE"] != tellOver2s {
		t.Errorf("after a check stopped at 2 s: %v", n["ZZ FINE"])
	}
	noteTellLight("ZZ FINE", errors.New("Tally said no such company"), false)
	if _, n := tellBeat(); n["ZZ FINE"] != tellLightFailed {
		t.Errorf("after a failed check: %v", n["ZZ FINE"])
	}
	noteStartPoint("ZZ FINE", "g-zz-fine", 40, 7)
	noteTellLight("ZZ FINE", nil, true)
	if _, n := tellBeat(); n["ZZ FINE"] != nil {
		t.Errorf("a company with numbers: %v", n["ZZ FINE"])
	}
	// FinCom says it is no longer linked: forgotten
	noteTellNamed(M{"booksFrom": map[string]any{"ZZ CLOSED": ""}})
	if s, _ := tellBeat(); s["ZZ CLOSED"] != nil {
		t.Errorf("an unlinked company still reported: %v", s)
	}
	// an answer without booksFrom changes nothing
	noteTellNamed(M{"ok": true})
	if s, _ := tellBeat(); s["ZZ TWO"] != tellTwoTallys {
		t.Errorf("an answer without booksFrom changed the named: %v", s)
	}
}

// the own-Tally privacy rule: a company on an owner-unknown or another user's Tally that FinCom never named is never in
// the beat (not as a key, not anywhere in its text)
func TestTell2522NamesOnlyFromFinCom(t *testing.T) {
	tellSetup(t)
	b := beatBody(true, "open", "", nil, nil, nil)
	txt, _ := json.Marshal(M{"skip": b["skip"], "numbersWhy": b["numbersWhy"], "addonSilent": b["addonSilent"]})
	for _, n := range []string{"ZZ NEVER NAMED", "ZZ STRANGER", "ZZ UNLINKED"} {
		if strings.Contains(string(txt), n) {
			t.Errorf("%s is in the beat: %s", n, txt)
		}
	}
	if !strings.Contains(string(txt), `"ZZ ADMIN":"ownerUnknown"`) {
		t.Errorf("the named company on the owner-unknown Tally is not said: %s", txt)
	}
}

// the skip codes taken from the pick-ups and the slow marks (otherCopy, slow), and the precedence
func TestTell2522SkipPrecedence(t *testing.T) {
	one := tellSeen{own: 1, ownAnswered: true}
	for _, c := range []struct {
		t    tellSeen
		pick string
		slow bool
		want string
	}{
		{one, "", false, ""},
		{one, "otherCompany", true, tellOtherCopy},
		{one, "", true, tellSlow},
		{one, "dayRetry", false, tellSlow},
		{tellSeen{own: 2, unknown: 1}, "otherCompany", true, tellTwoTallys},
		{tellSeen{unknown: 1, other: 1, ownAnswered: true}, "", false, tellOwnerUnknown},
		{tellSeen{ownAnswered: true}, "otherLogin", false, tellOtherLogin},
		{tellSeen{}, "", false, ""}, // no Tally of this user answers: tallyWhy says it
	} {
		if got := tellSkipOf(c.t, c.pick, c.slow); got != c.want {
			t.Errorf("%+v %q %v: %q, want %q", c.t, c.pick, c.slow, got, c.want)
		}
	}
}

// addonSilent: the counter rose above the first check after the add-on's last line, no line for 15 minutes, open in
// this user's own Tally: said with the tally.ini's reason; a line clears it
func TestTell2522AddonSilent(t *testing.T) {
	tellSetup(t)
	t0 := time.Date(2026, 11, 24, 11, 0, 0, 0, time.Local)
	now := t0
	old := nowFn
	nowFn = func() time.Time { return now }
	t.Cleanup(func() { nowFn = old })
	iniSt.mu.Lock()
	iniSt.files = map[string]M{`c:\program files\tallyprime\tally.ini`: {"path": `C:\Program Files\TallyPrime\tally.ini`, "state": iniStateShared}}
	iniSt.mu.Unlock()
	t.Cleanup(func() { iniSt.mu.Lock(); iniSt.files = map[string]M{}; iniSt.mu.Unlock() })

	addonLineSeen("ZZ FINE", "95888")
	now = t0.Add(time.Minute)
	noteStartPoint("ZZ FINE", "g-zz-fine", 95888, 3) // the first check after the line: the base
	if l := addonSilentBeat(); len(l) != 0 {
		t.Fatalf("silent at the base: %v", l)
	}
	now = t0.Add(11 * time.Minute)
	noteStartPoint("ZZ FINE", "g-zz-fine", 95937, 3) // entries changed in Tally, no line
	if l := addonSilentBeat(); len(l) != 0 {
		t.Fatalf("silent before 15 minutes: %v", l)
	}
	now = t0.Add(26 * time.Minute)
	l := addonSilentBeat()
	if len(l) != 1 {
		t.Fatalf("not silent after 15 minutes: %v", l)
	}
	e := obj(l[0])
	if str(e["company"]) != "ZZ FINE" || str(e["guid"]) != "g-zz-fine" || str(e["reason"]) != addonShared ||
		toI64(e["tallyAlter"]) != 95937 || toI64(e["lastLineAlter"]) != 95888 || str(e["since"]) != t0.Add(11*time.Minute).UTC().Format(time.RFC3339) {
		t.Fatalf("the entry: %v", e)
	}
	// the reason from this user's own tally.ini: FinCom's line there, Tally not started again
	iniSt.mu.Lock()
	iniSt.files = map[string]M{`c:\tally\tally.ini`: {"path": `C:\Tally\tally.ini`, "state": "added"}}
	iniSt.mu.Unlock()
	if l := addonSilentBeat(); len(l) != 1 || str(obj(l[0])["reason"]) != addonAdded {
		t.Fatalf("the reason with FinCom's line added: %v", l)
	}
	if r := addonReason(nil); r != addonNoFile {
		t.Errorf("no tally.ini: %s", r)
	}
	if r := addonReason([]any{M{"state": "unreadable"}}); r != addonFileUnreadable {
		t.Errorf("an unreadable tally.ini: %s", r)
	}
	// a line comes: cleared at once
	addonLineSeen("ZZ FINE", "95938")
	if l := addonSilentBeat(); len(l) != 0 {
		t.Fatalf("still silent after a line: %v", l)
	}
	// a company open only on the owner-unknown Tally is never said silent (not this user's own Tally)
	noteStartPoint("ZZ ADMIN", "g-zz-admin", 10, 1)
	now = now.Add(time.Minute)
	addonSilentBeat()
	noteStartPoint("ZZ ADMIN", "g-zz-admin", 12, 1)
	now = now.Add(20 * time.Minute)
	for _, x := range addonSilentBeat() {
		if str(obj(x)["company"]) == "ZZ ADMIN" {
			t.Fatalf("a company not open in this user's own Tally: %v", x)
		}
	}
}

// building the beat (with the three new fields filled) sends nothing to Tally: no request reaches the stand Tally and
// the bridge's own count of requests does not move
func TestTell2522BeatMakesNoTallyRequest(t *testing.T) {
	f := tellSetup(t)
	noteStartPoint("ZZ FINE", "g-zz-fine", 5, 1)
	n0, s0 := f.n(""), tallySent.Load()
	var b M
	for i := 0; i < 3; i++ {
		b = beatBody(true, "open", "", nil, nil, nil)
	}
	if f.n("") != n0 || tallySent.Load() != s0 {
		t.Fatalf("building the beat sent %d request(s) to Tally (%v)", f.n("")-n0, f.ids())
	}
	for _, k := range []string{"skip", "numbersWhy", "addonSilent"} {
		if _, ok := b[k]; !ok {
			t.Errorf("the beat has no %s", k)
		}
	}
	if obj(b["skip"])["ZZ TWO"] != tellTwoTallys {
		t.Errorf("skip not filled: %v", b["skip"])
	}
	if _, ok := b["addonSilent"].([]any); !ok {
		t.Errorf("addonSilent is not a list: %T", b["addonSilent"])
	}
}

// 2.5.22 (the plan's B.7): FinCom brings the days by itself, so no word of the bridge asks a person to upload a Day
// Book: the pick-up words, the held and slow words, and every string in the bridge's own code
func TestTell2522NoUploadAsk(t *testing.T) {
	ask := regexp.MustCompile(`(?i)upload (the|that day's|one day's) day book|day book upload|day book is to be uploaded|day book is uploaded|uploading that day's day book`)
	for code, w := range pickWords {
		if strings.Contains(strings.ToLower(w), "upload") {
			t.Errorf("pick-up word %s: %q", code, w)
		}
	}
	if pickWords["stopped"] != "Tally was too slow for this company; FinCom tries again by itself" ||
		pickWords["dayRetry"] != "Tally was slow for this day; FinCom tries it again by itself" {
		t.Errorf("the stopped / dayRetry words are not the cloud's: %q / %q", pickWords["stopped"], pickWords["dayRetry"])
	}
	for _, w := range []string{slowWords, liveHeldSlowGiveUp, liveHeldGiveUp, liveHeldOnceGiveUp, liveHeldFinalEnd, readsOffWords} {
		if strings.Contains(strings.ToLower(w), "upload") {
			t.Errorf("asks for an upload: %q", w)
		}
	}
	files, _ := filepath.Glob("*.go")
	lit := regexp.MustCompile("\"(?:[^\"\\\\\\n]|\\\\.)*\"|`[^`]*`")
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		for i, line := range strings.Split(readText(f), "\n") {
			if l := strings.TrimSpace(line); strings.HasPrefix(l, "//") {
				continue
			}
			for _, s := range lit.FindAllString(line, -1) {
				if ask.MatchString(s) {
					t.Errorf("%s:%d asks for an upload: %s", f, i+1, s)
				}
			}
		}
	}
}
