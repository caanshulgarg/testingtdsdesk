//go:build windows

package main

// 2.3.5 on real Windows (the workflow's "Go tests on Windows" job runs -run 'Windows|Shared'): the icon's window hands
// Windows' "closed with X" / "clicked" messages about its balloon to the gate, which records the problem shown as
// dismissed in this Windows user's file; "taken away" (NIN_BALLOONHIDE) is not a dismissal; the file is this user's
// (%LOCALAPPDATA%\FinCom Bridge); the menu's Clear notifications id is no other item's.

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNoticesWindowsBalloonDismissedThroughWindowProc(t *testing.T) {
	f := filepath.Join(t.TempDir(), "notifications-cleared.json")
	now := time.Date(2026, 10, 8, 11, 0, 0, 0, time.Local)
	clock := func() time.Time { return now }
	shown := 0
	g := newNoticeGate(openNoticeStore(f, clock), "PC-ONE", clock, func(string, string, bool) { shown++ }, func() {})
	old := tr.gate
	tr.gate = g
	defer func() { tr.gate = old }()
	id := problemKey{Kind: "offline", Day: "2026-10-08", Computer: "PC-ONE"}.id()
	wait := func() noticeRec {
		for i := 0; i < 100; i++ {
			if r, _ := g.store.Get(id); r.Dismissed != "" {
				return r
			}
			time.Sleep(10 * time.Millisecond)
		}
		r, _ := g.store.Get(id)
		return r
	}

	g.Check(trayProblem{Kind: "offline", Cond: true, Title: "Bridge offline", Text: "x"})
	if r := wndProc(0, wmTray, 0, ninBalloonHide); r != 0 {
		t.Fatalf("wndProc NIN_BALLOONHIDE: %d", r)
	}
	time.Sleep(100 * time.Millisecond)
	if r, _ := g.store.Get(id); r.Dismissed != "" {
		t.Fatalf("taken away by the program counted as dismissed: %+v", r)
	}
	wndProc(0, wmTray, 0, ninBalloonUserClick)
	if r := wait(); r.How != "clicked" {
		t.Fatalf("clicked: %+v", r)
	}
	// after a restart of the icon: not shown again
	g2 := newNoticeGate(openNoticeStore(f, clock), "PC-ONE", clock, func(string, string, bool) { shown++ }, func() {})
	g2.Check(trayProblem{Kind: "offline", Cond: true, Title: "Bridge offline", Text: "x"})
	if shown != 1 {
		t.Fatalf("shown %d, want 1", shown)
	}
	// closed with X
	tr.gate = g2
	id = problemKey{Kind: "tally", Day: "2026-10-08", Computer: "PC-ONE"}.id()
	g2.Check(trayProblem{Kind: "tally", Cond: true, Title: "Tally not open", Text: "x"})
	wndProc(0, wmTray, 0, ninBalloonTimeout)
	if r := wait(); r.How != "closed" {
		t.Fatalf("closed: %+v", r)
	}
}

func TestNoticesWindowsFileIsThisUsers(t *testing.T) {
	f := noticeFile()
	la := localAppData()
	if la == "" || !strings.EqualFold(f, filepath.Join(la, "FinCom Bridge", "notifications-cleared.json")) {
		t.Fatalf("notice file %q, LOCALAPPDATA %q", f, la)
	}
	for _, it := range trayTrialItems(M{"trialTools": true}) {
		if it.id == 25 {
			t.Fatalf("menu id 25 (Clear notifications) is also %q", it.text)
		}
	}
}
