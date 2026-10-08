package main

// 2.3.5 (owner, 08-Oct-2026): "if one time any notification is cleared then that notification should not appear".
// The bridge's own Windows notifications (the tray's balloons / toasts) go through one gate: a problem's notification is
// shown once per problem (kind + company + day + computer, never times or counts), recorded in a per-Windows-user file
// written whole, kept 90 days; one the person dismissed (X, or a click) or cleared from the tray menu is never shown
// again for that problem; a new problem (another day, company or kind) still shows. The icon and its tooltip are not
// notifications and keep showing the state.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

type noticeShown struct {
	title, text string
	warn        bool
}

// the bridge's settings and log in a temporary folder: the gate's log lines never land in the package folder
func noticeTestHome(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	oldC, oldH := ConfigPath, Home
	ConfigPath, Home = filepath.Join(dir, "tds-bridge.config.json"), dir
	loadConfigRO()
	t.Cleanup(func() { ConfigPath, Home = oldC, oldH; loadConfigRO() })
}

// a gate on a file in a temporary folder, its clock the test's
func noticeTestGate(t *testing.T, file string, now *time.Time) (*noticeGate, *[]noticeShown, *int) {
	t.Helper()
	noticeTestHome(t)
	var shown []noticeShown
	hides := 0
	clock := func() time.Time { return *now }
	g := newNoticeGate(openNoticeStore(file, clock), "PC-ONE", clock,
		func(title, text string, warn bool) { shown = append(shown, noticeShown{title, text, warn}) },
		func() { hides++ })
	return g, &shown, &hides
}

func noticeDay(d int, hh int) time.Time {
	return time.Date(2026, 10, d, hh, 0, 0, 0, time.Local)
}

func TestNoticeStoreDismissSurvivesRestart(t *testing.T) {
	f := filepath.Join(t.TempDir(), "FinCom Bridge", "notifications-cleared.json")
	now := noticeDay(8, 11)
	g, shown, _ := noticeTestGate(t, f, &now)
	p := trayProblem{Kind: "tally", Cond: true, Title: "Tally not open", Text: "Open TallyPrime"}
	g.Check(p)
	if len(*shown) != 1 {
		t.Fatalf("first: shown %d, want 1", len(*shown))
	}
	g.BalloonEvent(ninBalloonUserClick)
	if !exists(f) {
		t.Fatalf("no file written at %s", f)
	}
	id := problemKey{Kind: "tally", Day: "2026-10-08", Computer: "PC-ONE"}.id()
	s := openNoticeStore(f, func() time.Time { return now })
	if r, ok := s.Get(id); !ok || r.Dismissed == "" || r.How != "clicked" {
		t.Fatalf("after a click and a restart: %+v %v, want dismissed (clicked)", r, ok)
	}
	// the bridge (the icon) started again: the same problem is not shown again, however often it comes back
	now = now.Add(time.Hour)
	g2, shown2, _ := noticeTestGate(t, f, &now)
	for i := 0; i < 5; i++ {
		g2.Check(p)
		g2.Check(trayProblem{Kind: "tally", Cond: false})
	}
	if len(*shown2) != 0 {
		t.Fatalf("after restart: shown %v, want nothing", *shown2)
	}
	// closed with X (Windows: NIN_BALLOONTIMEOUT) is a dismissal too
	g2.Check(trayProblem{Kind: "offline", Cond: true, Title: "Bridge offline", Text: "x"})
	g2.BalloonEvent(ninBalloonTimeout)
	s = openNoticeStore(f, func() time.Time { return now })
	if r, _ := s.Get(problemKey{Kind: "offline", Day: "2026-10-08", Computer: "PC-ONE"}.id()); r.How != "closed" {
		t.Fatalf("offline closed: %+v", r)
	}
	// written whole: no temporary file left beside it
	ents, _ := os.ReadDir(filepath.Dir(f))
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("temporary file left: %s", e.Name())
		}
	}
	// no times or counts in the id; the file names the kind, not the words
	if !regexp.MustCompile(`^tally:[0-9a-f]{16}$`).MatchString(id) {
		t.Fatalf("id %q", id)
	}
}

func TestNoticeNewFingerprintShows(t *testing.T) {
	f := filepath.Join(t.TempDir(), "n.json")
	now := noticeDay(8, 11)
	g, shown, _ := noticeTestGate(t, f, &now)
	g.Check(trayProblem{Kind: "tally", Cond: true, Title: "a", Text: "a"})
	g.BalloonEvent(ninBalloonTimeout)
	// another kind, the same day
	g.Check(trayProblem{Kind: "offline", Cond: true, Title: "b", Text: "b"})
	// another company, the same kind and day
	g.Check(trayProblem{Kind: "tally", Company: "Other Co", Cond: true, Title: "c", Text: "c"})
	// the next day: a new problem
	now = noticeDay(9, 10)
	g.Check(trayProblem{Kind: "tally", Cond: false})
	g.Check(trayProblem{Kind: "tally", Cond: true, Title: "d", Text: "d"})
	var got []string
	for _, s := range *shown {
		got = append(got, s.title)
	}
	if strings.Join(got, ",") != "a,b,c,d" {
		t.Fatalf("shown %v, want a,b,c,d", got)
	}
	// another computer is another problem
	one, two := problemKey{Kind: "tally", Day: "2026-10-08", Computer: "PC-ONE"}, problemKey{Kind: "tally", Day: "2026-10-08", Computer: "PC-TWO"}
	if one.id() == two.id() {
		t.Fatal("the computer is not in the fingerprint")
	}
}

func TestNoticeStoreExpires90Days(t *testing.T) {
	f := filepath.Join(t.TempDir(), "n.json")
	now := noticeDay(1, 10)
	g, _, _ := noticeTestGate(t, f, &now)
	g.Check(trayProblem{Kind: "down", Cond: true, Title: "x", Text: "x"})
	g.BalloonEvent(ninBalloonUserClick)
	old := problemKey{Kind: "down", Day: "2026-10-01", Computer: "PC-ONE"}.id()
	at := func(d time.Time) *noticeStore { return openNoticeStore(f, func() time.Time { return d }) }
	if !at(now.AddDate(0, 0, 89)).Has(old) {
		t.Fatal("gone before 90 days")
	}
	later := now.AddDate(0, 0, 91)
	s := at(later)
	if s.Has(old) {
		t.Fatal("kept after 90 days")
	}
	// the next write leaves it out of the file
	if err := s.Shown("tally:0000000000000000", "tally"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(readText(f), old) {
		t.Fatalf("expired entry still in the file: %s", readText(f))
	}
}

func TestNoticeStoreCorruptFileSafe(t *testing.T) {
	dir := t.TempDir()
	now := noticeDay(8, 11)
	for name, body := range map[string]string{
		"garbage":   "\x00\x01not json{{{",
		"half":      `{"tally:0123456789abcdef":{"kind":"tally","shown":"2026-10-0`,
		"array":     `[1,2,3]`,
		"badentry":  `{"x":5,"tally:0123456789abcdef":{"kind":"tally","shown":"2026-10-08T10:00:00+05:30","dismissed":"2026-10-08T10:01:00+05:30","how":"clicked"},"y":{"shown":"not a time"}}`,
		"empty":     ``,
		"bomprefix": "\ufeff{}",
	} {
		t.Run(name, func(t *testing.T) {
			f := filepath.Join(dir, name+".json")
			if err := os.WriteFile(f, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
			g, shown, _ := noticeTestGate(t, f, &now) // must not panic
			g.Check(trayProblem{Kind: "offline", Cond: true, Title: "x", Text: "x"})
			if len(*shown) != 1 {
				t.Fatalf("a problem not yet seen: shown %d, want 1 (safe default: an unreadable file hides nothing)", len(*shown))
			}
			s := openNoticeStore(f, func() time.Time { return now })
			if !s.Has(problemKey{Kind: "offline", Day: "2026-10-08", Computer: "PC-ONE"}.id()) {
				t.Fatalf("not written again after a bad file: %q", readText(f))
			}
			if name == "badentry" && !s.Has("tally:0123456789abcdef") {
				t.Fatal("a good entry beside bad ones was lost")
			}
		})
	}
	// the file's place is a folder: nothing written, no crash, shown once while running
	f := filepath.Join(dir, "afolder")
	_ = os.MkdirAll(f, 0o755)
	g, shown, _ := noticeTestGate(t, f, &now)
	for i := 0; i < 3; i++ {
		g.Check(trayProblem{Kind: "offline", Cond: true, Title: "x", Text: "x"})
	}
	if len(*shown) != 1 {
		t.Fatalf("file not writable: shown %d, want 1", len(*shown))
	}
}

// never more than once per problem, dismissed or not: a condition that comes and goes the same day is one problem
func TestNoticeGateOncePerProblemNoNag(t *testing.T) {
	f := filepath.Join(t.TempDir(), "n.json")
	now := noticeDay(8, 9)
	g, shown, _ := noticeTestGate(t, f, &now)
	p := trayProblem{Kind: "tally", Cond: true, After: 3 * time.Minute, Title: "Tally not open", Text: "x"}
	g.Check(p)
	if len(*shown) != 0 {
		t.Fatal("shown before the condition lasted its while")
	}
	for i := 0; i < 50; i++ {
		now = now.Add(5 * time.Minute)
		g.Check(p)
		now = now.Add(time.Minute)
		g.Check(trayProblem{Kind: "tally", Cond: false})
	}
	if len(*shown) != 1 {
		t.Fatalf("shown %d times in a day, want 1", len(*shown))
	}
	// not dismissed, the icon started again: still not shown again
	g2, shown2, _ := noticeTestGate(t, f, &now)
	now = now.Add(5 * time.Minute)
	g2.Check(p)
	now = now.Add(5 * time.Minute)
	g2.Check(p)
	if len(*shown2) != 0 {
		t.Fatalf("after restart, not dismissed: shown %d, want 0", len(*shown2))
	}
}

// every notification the tray shows on its own comes from trayProblems and goes through the gate
func TestNoticeEachTrayProblemThroughGate(t *testing.T) {
	up := 10 * time.Minute
	base := trayFacts{Up: up, OfficeHours: true, RestartsBy: "Windows starts it again by itself"}
	cases := []struct {
		kind  string
		facts trayFacts
		after time.Duration
	}{
		{"nostart", trayFacts{StartFailed: "No free port 9100-9199", Up: up}, 0},
		{"down", trayFacts{Up: up, RestartsBy: "Windows starts it again by itself"}, 30 * time.Second},
		{"idrefused", func() trayFacts {
			f := base
			f.St = M{"tallyOpen": true, "online": true, "cloudConnected": true, "cloudRefused": "FinCom does not know this computer key."}
			return f
		}(), 0},
		{"offline", func() trayFacts { f := base; f.St = M{"tallyOpen": true, "cloudConnected": true}; return f }(), 2 * time.Minute},
		{"tally", func() trayFacts { f := base; f.St = M{"online": true, "cloudConnected": true}; return f }(), 3 * time.Minute},
	}
	for _, c := range cases {
		t.Run(c.kind, func(t *testing.T) {
			f := filepath.Join(t.TempDir(), "n.json")
			now := noticeDay(8, 11)
			g, shown, _ := noticeTestGate(t, f, &now)
			poll := func() {
				for _, p := range trayProblems(c.facts) {
					g.Check(p)
				}
			}
			var found *trayProblem
			for _, p := range trayProblems(c.facts) {
				if p.Kind == c.kind && p.Cond {
					q := p
					found = &q
				}
			}
			if found == nil || found.After != c.after || found.Title == "" || found.Text == "" {
				t.Fatalf("trayProblems gave %+v for %s", trayProblems(c.facts), c.kind)
			}
			poll()
			now = now.Add(c.after + 5*time.Second)
			for i := 0; i < 20; i++ {
				poll()
				now = now.Add(5 * time.Second)
			}
			if len(*shown) != 1 || (*shown)[0].title != found.Title {
				t.Fatalf("%s: shown %v, want once", c.kind, *shown)
			}
			g.BalloonEvent(ninBalloonTimeout)
			g2, shown2, _ := noticeTestGate(t, f, &now)
			for i := 0; i < 20; i++ {
				for _, p := range trayProblems(c.facts) {
					g2.Check(p)
				}
				now = now.Add(time.Minute)
			}
			if len(*shown2) != 0 {
				t.Fatalf("%s dismissed, after restart: shown %v", c.kind, *shown2)
			}
		})
	}
	// the conditions that are not problems give none: Tally open, online, not refused
	ok := base
	ok.St = M{"tallyOpen": true, "online": true, "cloudConnected": true}
	for _, p := range trayProblems(ok) {
		if p.Cond {
			t.Fatalf("all well, yet %+v", p)
		}
	}
	// paused: neither offline nor Tally not open
	pz := base
	pz.St = M{"paused": true, "cloudConnected": true}
	for _, p := range trayProblems(pz) {
		if p.Cond {
			t.Fatalf("paused, yet %+v", p)
		}
	}
}

func TestNoticeClearAll(t *testing.T) {
	f := filepath.Join(t.TempDir(), "n.json")
	now := noticeDay(8, 11)
	g, shown, hides := noticeTestGate(t, f, &now)
	if n := g.ClearAll(); n != 0 || *hides != 1 {
		t.Fatalf("nothing to clear: %d (hides %d)", n, *hides)
	}
	if w := clearedWords(0); !strings.Contains(w, "No notifications") {
		t.Fatalf("words for 0: %q", w)
	}
	g.Check(trayProblem{Kind: "offline", Cond: true, Title: "o", Text: "o"})                       // shown
	g.Check(trayProblem{Kind: "tally", Cond: true, After: 3 * time.Minute, Title: "t", Text: "t"}) // not yet due
	g.Check(trayProblem{Kind: "idrefused", Cond: true, Title: "i", Text: "i"})                     // shown, then dismissed
	g.BalloonEvent(ninBalloonUserClick)
	if n := g.ClearAll(); n != 2 {
		t.Fatalf("cleared %d, want 2 (offline shown, tally waiting; idrefused was dismissed already)", n)
	}
	if *hides != 2 {
		t.Fatalf("the balloon on screen not taken away: hides %d", *hides)
	}
	if w := clearedWords(2); !strings.Contains(w, "2 notifications") || !strings.Contains(w, "not shown again") {
		t.Fatalf("words: %q", w)
	}
	if w := clearedWords(1); !strings.Contains(w, "1 notification ") {
		t.Fatalf("words: %q", w)
	}
	now = now.Add(10 * time.Minute)
	g.Check(trayProblem{Kind: "tally", Cond: true, After: 3 * time.Minute, Title: "t", Text: "t"})
	g2, shown2, _ := noticeTestGate(t, f, &now)
	for _, k := range []string{"offline", "tally", "idrefused"} {
		g2.Check(trayProblem{Kind: k, Cond: true, Title: k, Text: k})
	}
	if len(*shown) != 2 || len(*shown2) != 0 {
		t.Fatalf("after clearing: shown %v then %v", *shown, *shown2)
	}
	s := openNoticeStore(f, func() time.Time { return now })
	if r, _ := s.Get(problemKey{Kind: "tally", Day: "2026-10-08", Computer: "PC-ONE"}.id()); r.How != "cleared" {
		t.Fatalf("tally: %+v", r)
	}
	if n := g2.ClearAll(); n != 0 {
		t.Fatalf("cleared twice: %d", n)
	}
	// a new day's problem still shows
	now = noticeDay(9, 11)
	g2.Check(trayProblem{Kind: "offline", Cond: false})
	g2.Check(trayProblem{Kind: "offline", Cond: true, Title: "o2", Text: "o2"})
	if len(*shown2) != 1 {
		t.Fatalf("the next day's problem: shown %v", *shown2)
	}
}

// the answers to the person's own menu clicks ("Checking for updates...") go through the gate too: one per click, never
// repeated by the bridge, never recorded as a problem; a click on one does not dismiss a problem
func TestNoticeReplyThroughGate(t *testing.T) {
	f := filepath.Join(t.TempDir(), "n.json")
	now := noticeDay(8, 11)
	g, shown, _ := noticeTestGate(t, f, &now)
	g.Check(trayProblem{Kind: "offline", Cond: true, Title: "o", Text: "o"})
	g.Reply("FinCom Bridge", "Checking for updates...", false)
	g.BalloonEvent(ninBalloonUserClick)
	g.Reply("FinCom Bridge", "Checking for updates...", false)
	if len(*shown) != 3 || (*shown)[1].warn {
		t.Fatalf("shown %v", *shown)
	}
	s := openNoticeStore(f, func() time.Time { return now })
	r, _ := s.Get(problemKey{Kind: "offline", Day: "2026-10-08", Computer: "PC-ONE"}.id())
	if r.Shown == "" || r.Dismissed != "" {
		t.Fatalf("offline after a click on a reply: %+v (want shown, not dismissed)", r)
	}
	if len(s.all) != 1 {
		t.Fatalf("a reply was recorded: %v", s.all)
	}
}

// the source: every balloon the tray shows is a gate's (Check, Reply); the old once-until-it-clears warnIf and the unused
// notify are gone; the menu has Clear notifications
func TestNoticeEveryBalloonThroughGate(t *testing.T) {
	src := readText("win_tray.go")
	if src == "" {
		t.Fatal("win_tray.go not read")
	}
	for _, gone := range []string{"warnIf(", "func notify(", "told[", "t.balloon(\"", "tr.balloon(\""} {
		if strings.Contains(src, gone) {
			t.Fatalf("win_tray.go still has %q", gone)
		}
	}
	if n := strings.Count(src, ".balloon("); n != 1 {
		t.Fatalf("win_tray.go calls balloon %d times; want once, in the gate's wiring", n)
	}
	if !strings.Contains(src, `"Clear notifications"`) || !strings.Contains(src, "ClearAll()") || !strings.Contains(src, "BalloonEvent(") {
		t.Fatal("no Clear notifications item, or the dismissal not handed to the gate")
	}
	if strings.Contains(readText("platform_other.go"), "func notify(") {
		t.Fatal("platform_other.go still has notify")
	}
}
