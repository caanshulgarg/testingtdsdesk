package main

// 2.3.5 (owner, 08-Oct-2026): the bridge's own Windows notifications (the tray icon's balloons, which Windows 10 and 11
// show as toasts) can be cleared, and one cleared is never shown again for the same problem.
//
// Every notification the tray shows goes through one gate (noticeGate):
//   - a problem (trayProblems: the bridge could not start, is not running, FinCom refused this computer's id, offline,
//     Tally not open) is shown at most once per problem, dismissed or not: its id is the kind plus a fingerprint of the
//     problem (kind, company, day, computer; never times or counts), recorded when shown in a file of this Windows user
//     (%LOCALAPPDATA%\FinCom Bridge\notifications-cleared.json), written whole (a temporary file renamed over it), kept
//     90 days. Closed with X or clicked (Windows' NIN_BALLOONTIMEOUT / NIN_BALLOONUSERCLICK) it is marked dismissed;
//     "Clear notifications" in the tray menu marks every current one cleared. A new problem (another day, company or
//     kind) still shows, once.
//   - the answer to the person's own click in the tray menu ("Checking for updates...") is shown once per click and not
//     recorded: it is not a problem and the bridge never repeats it by itself.
// The icon (green / red) and its tooltip are not notifications: they always show the state.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const noticeKeepDays = 90

// Windows' messages to the icon's window about its balloon (lParam, the icon not set to NOTIFYICON_VERSION_4)
const (
	ninBalloonShow      = 0x402
	ninBalloonHide      = 0x403 // taken away by the program (another balloon, the icon removed): not the person; ignored
	ninBalloonTimeout   = 0x404 // closed with X, or it timed out (Windows does not tell the two apart)
	ninBalloonUserClick = 0x405
)

// what the person did to the balloon, from Windows' message; "" when it is not a dismissal
func balloonHow(code uintptr) string {
	switch code {
	case ninBalloonTimeout:
		return "closed"
	case ninBalloonUserClick:
		return "clicked"
	}
	return ""
}

// this Windows user's file (the icon runs as the signed-in user, so each user has their own)
func noticeFile() string {
	if d := userInstallDir(); d != "" {
		return filepath.Join(d, "notifications-cleared.json")
	}
	if d, err := os.UserConfigDir(); err == nil && d != "" {
		return filepath.Join(d, "FinCom Bridge", "notifications-cleared.json")
	}
	return ""
}

// the problem a notification is about; its id never holds times or counts
type problemKey struct{ Kind, Company, Day, Computer string }

func (k problemKey) id() string {
	h := sha256.Sum256([]byte(strings.Join([]string{k.Kind, strings.ToLower(strings.TrimSpace(k.Company)), k.Day, strings.ToLower(k.Computer)}, "\x1f")))
	return k.Kind + ":" + hex.EncodeToString(h[:8])
}

type noticeRec struct {
	Kind      string `json:"kind"`
	Shown     string `json:"shown,omitempty"`
	Dismissed string `json:"dismissed,omitempty"`
	How       string `json:"how,omitempty"` // clicked, closed (X or timed out), cleared (the tray menu)
}

func (r noticeRec) last() (time.Time, bool) {
	var best time.Time
	ok := false
	for _, s := range []string{r.Shown, r.Dismissed} {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			if !ok || t.After(best) {
				best, ok = t, true
			}
		}
	}
	return best, ok
}

type noticeStore struct {
	mu       sync.Mutex
	file     string
	now      func() time.Time
	all      map[string]noticeRec
	saidFail bool
}

// the file read; an unreadable or half-written file is started again empty (a problem not yet recorded is shown once,
// never hidden), said in the log; entries older than 90 days are left out
func openNoticeStore(file string, now func() time.Time) *noticeStore {
	s := &noticeStore{file: file, now: now, all: map[string]noticeRec{}}
	if file == "" {
		return s
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return s
	}
	text := strings.TrimSpace(strings.TrimPrefix(string(b), "\ufeff"))
	if text == "" {
		return s
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		writeLog("Notifications: " + file + " could not be read (" + err.Error() + "); started again empty")
		return s
	}
	for id, v := range raw {
		var r noticeRec
		if json.Unmarshal(v, &r) != nil || r.Kind == "" || !strings.HasPrefix(id, r.Kind+":") {
			continue
		}
		if _, ok := r.last(); !ok {
			continue
		}
		s.all[id] = r
	}
	s.prune()
	return s
}

func (s *noticeStore) prune() {
	cut := s.now().AddDate(0, 0, -noticeKeepDays)
	for id, r := range s.all {
		if t, ok := r.last(); !ok || t.Before(cut) {
			delete(s.all, id)
		}
	}
}

// under s.mu: the file written whole; on a failure what is known stays in this process (said once in the log)
func (s *noticeStore) save() error {
	if s.file == "" {
		return nil
	}
	s.prune()
	b, _ := json.MarshalIndent(s.all, "", " ")
	err := saveFile(s.file, string(b))
	if err != nil && !s.saidFail {
		s.saidFail = true
		writeLog("Notifications: " + s.file + " could not be written (" + err.Error() + "); a notification shown or cleared is remembered until the icon starts again")
	}
	return err
}

func (s *noticeStore) Has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.all[id]
	return ok
}

func (s *noticeStore) Get(id string) (noticeRec, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.all[id]
	return r, ok
}

func (s *noticeStore) Shown(id, kind string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.all[id]
	r.Kind = kind
	if r.Shown == "" {
		r.Shown = s.now().Format(time.RFC3339)
	}
	s.all[id] = r
	return s.save()
}

// marks the ids dismissed (those not dismissed yet); how many were
func (s *noticeStore) dismiss(ids map[string]string, how string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for id, kind := range ids {
		r := s.all[id]
		if r.Dismissed != "" {
			continue
		}
		r.Kind, r.Dismissed, r.How = kind, s.now().Format(time.RFC3339), how
		s.all[id] = r
		n++
	}
	if n > 0 {
		_ = s.save()
	}
	return n
}

// one problem the tray checks on each look at the bridge (every 5 seconds)
type trayProblem struct {
	Kind, Company string
	Cond          bool          // the problem is there now
	After         time.Duration // shown only once it has lasted this long
	Title, Text   string
}

type noticeGate struct {
	mu       sync.Mutex
	store    *noticeStore
	computer string
	now      func() time.Time
	show     func(title, text string, warn bool)
	hide     func()
	since    map[string]time.Time
	current  map[string]string // kind -> id of a problem there now (shown or still waiting its while)
	showing  string            // the problem whose balloon is on screen; "" for none or a reply
}

func newNoticeGate(store *noticeStore, computer string, now func() time.Time, show func(title, text string, warn bool), hide func()) *noticeGate {
	return &noticeGate{store: store, computer: computer, now: now, show: show, hide: hide, since: map[string]time.Time{}, current: map[string]string{}}
}

func (g *noticeGate) key(p trayProblem) problemKey {
	return problemKey{Kind: p.Kind, Company: p.Company, Day: g.now().Format("2006-01-02"), Computer: g.computer}
}

// a problem: shown once it has lasted its while, if it was never shown (nor dismissed, nor cleared) before
func (g *noticeGate) Check(p trayProblem) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !p.Cond {
		delete(g.since, p.Kind)
		delete(g.current, p.Kind)
		return
	}
	now := g.now()
	if _, ok := g.since[p.Kind]; !ok {
		g.since[p.Kind] = now
	}
	id := g.key(p).id()
	g.current[p.Kind] = id
	if now.Sub(g.since[p.Kind]) < p.After || g.store.Has(id) {
		return
	}
	_ = g.store.Shown(id, p.Kind) // recorded first: shown once even if the icon stops right after
	g.showing = id
	writeLog("Notification shown: " + p.Title + " (" + id + "; not shown again for this problem)")
	g.show(p.Title, p.Text, true)
}

// the answer to the person's own click in the tray menu: once per click, not recorded
func (g *noticeGate) Reply(title, text string, warn bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.showing = ""
	g.show(title, text, warn)
}

// Windows' message about the balloon: closed with X or clicked marks the problem shown dismissed (a balloon taken
// away by the program, NIN_BALLOONHIDE, is not the person's doing; it can arrive after the next balloon is shown)
func (g *noticeGate) BalloonEvent(code uintptr) {
	how := balloonHow(code)
	g.mu.Lock()
	defer g.mu.Unlock()
	if how == "" || g.showing == "" {
		return
	}
	id := g.showing
	g.showing = ""
	g.store.dismiss(map[string]string{id: strings.SplitN(id, ":", 2)[0]}, how)
}

// "Clear notifications": every current one shown (the problems there now whose notification was shown, and the balloon
// on screen) marked cleared; one already dismissed is not counted again. A problem still waiting its while was never
// seen: it is left alone and still shows, once, when due (review Low, 08-Oct), the balloon on screen taken away; how many
func (g *noticeGate) ClearAll() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	ids := map[string]string{}
	for kind, id := range g.current {
		if g.store.Has(id) { // shown (a problem still waiting its while was never seen: it still shows when due)
			ids[id] = kind
		}
	}
	if g.showing != "" {
		ids[g.showing] = strings.SplitN(g.showing, ":", 2)[0]
	}
	g.showing = ""
	g.hide()
	n := g.store.dismiss(ids, "cleared")
	kinds := []string{}
	for _, k := range ids {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	writeLog(fmt.Sprintf("Notifications cleared from the tray menu: %d (%s)", n, strings.Join(kinds, ", ")))
	return n
}

func clearedWords(n int) string {
	switch n {
	case 0:
		return "No notifications to clear. The icon keeps showing the bridge's state."
	case 1:
		return "1 notification cleared: it is not shown again for the same problem. A new problem still shows once. The icon keeps showing the bridge's state."
	}
	return fmt.Sprintf("%d notifications cleared: they are not shown again for the same problems. A new problem still shows once. The icon keeps showing the bridge's state.", n)
}

// what the tray knows on each look at the bridge
type trayFacts struct {
	St          M // the bridge's /tray/status; nil when it did not answer
	StartFailed string
	Up          time.Duration // since the icon started
	TallySeen   bool
	OfficeHours bool
	RestartsBy  string
}

// the problems the tray tells of on its own (2.3.4's warnIf calls, the same conditions, words and waits). With no
// answer from the bridge only "nostart" or "down" is looked at; the others keep their state until it answers again.
func trayProblems(f trayFacts) []trayProblem {
	st := f.St
	if st == nil && f.StartFailed != "" {
		// 2.3.0: the bridge found no free port (9100..9199) and stopped
		return []trayProblem{{Kind: "nostart", Cond: true, Title: "FinCom Bridge could not start", Text: f.StartFailed}}
	}
	if st == nil {
		return []trayProblem{{Kind: "down", Cond: f.Up > 30*time.Second, After: 30 * time.Second, Title: "FinCom Bridge is not running",
			Text: "The bridge on this computer has stopped. " + f.RestartsBy + "; if this stays, choose Restart from this icon."}}
	}
	tally, online, cloud, paused := truthy(st["tallyOpen"]), truthy(st["online"]), truthy(st["cloudConnected"]), truthy(st["paused"])
	return []trayProblem{
		{Kind: "down", Cond: false},
		// the owner's condition (Fix 2c): FinCom refused this computer key the bridge's id: its words
		{Kind: "idrefused", Cond: str(st["cloudRefused"]) != "", Title: "FinCom Bridge", Text: str(st["cloudRefused"])},
		{Kind: "offline", Cond: cloud && !online && !paused, After: 2 * time.Minute, Title: "Bridge offline",
			Text: "This computer cannot reach FinCom. Changes from Tally wait here and go as soon as FinCom can be reached."},
		{Kind: "tally", Cond: !tally && !paused && f.Up > 2*time.Minute && (f.TallySeen || f.OfficeHours), After: 3 * time.Minute, Title: "Tally not open",
			Text: "Open TallyPrime with your company, so FinCom stays up to date and postings reach Tally."},
	}
}
