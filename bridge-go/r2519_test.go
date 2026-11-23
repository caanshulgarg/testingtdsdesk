package main

// 2.5.19 (the owner's decision A of 23-Nov-2026): Quit on the tray icon no longer stops background reading until the
// next sign-in. As a service, the bridge starts the icon again in that session 10 minutes after Quit; once it reports
// again, the typing gate decides as before. Until it reports, the gate holds (nothing in the background goes). Nothing
// here reaches a real Tally; no request to Tally is added or changed. Made-up sessions only.
import (
	"testing"
	"time"
)

func resetTrayKeeperState(t *testing.T) {
	t.Helper()
	trayQuitMu.Lock()
	oldQ, oldP := trayQuitAt, trayPing
	trayQuitAt, trayPing = map[int]time.Time{}, map[int]time.Time{}
	trayQuitMu.Unlock()
	trayMu.Lock()
	oldR := trayReps
	trayReps = map[int]trayRep{}
	trayMu.Unlock()
	t.Cleanup(func() {
		trayQuitMu.Lock()
		trayQuitAt, trayPing = oldQ, oldP
		trayQuitMu.Unlock()
		trayMu.Lock()
		trayReps = oldR
		trayMu.Unlock()
	})
}

// A1. after Quit the icon is not started again for 10 minutes, then it is
func TestR2519TrayQuitRestartsAfterTenMinutes(t *testing.T) {
	resetTrayKeeperState(t)
	t0 := time.Date(2026, 11, 23, 11, 0, 0, 0, time.Local)
	trayAliveAt(3, t0.Add(-5*time.Second)) // the icon was running and reporting
	trayQuitSessionAt(3, t0)
	for _, d := range []time.Duration{0, 41 * time.Second, 5 * time.Minute, 9*time.Minute + 59*time.Second} {
		if trayStartDue(3, t0.Add(d)) {
			t.Fatalf("%s after Quit: the icon is started again (must wait 10 minutes)", d)
		}
	}
	if !trayStartDue(3, t0.Add(trayQuitRestartAfter)) {
		t.Fatal("10 minutes after Quit: the icon is not started again, so background reading stays stopped")
	}
	if trayQuitRestartAfter != 10*time.Minute {
		t.Fatalf("restart after %s, the owner asked for 10 minutes", trayQuitRestartAfter)
	}
	// started again (the keeper marks it alive, giving it time to start): not started twice
	trayAliveAt(3, t0.Add(trayQuitRestartAfter))
	if trayStartDue(3, t0.Add(trayQuitRestartAfter+20*time.Second)) {
		t.Fatal("the icon is started a second time while the first is starting")
	}
	// the Quit is forgotten once the icon is started again: a later crash is handled as before (started in 40 s)
	if trayStartDue(3, t0.Add(trayQuitRestartAfter+39*time.Second)) || !trayStartDue(3, t0.Add(trayQuitRestartAfter+41*time.Second)) {
		t.Fatal("after the restart, an icon that does not report is not started again as before (40 s)")
	}
}

// A2. Quit pressed again on the restarted icon: another 10 minutes from that press
func TestR2519TrayQuitAgainStartsTheClockAgain(t *testing.T) {
	resetTrayKeeperState(t)
	t0 := time.Date(2026, 11, 23, 11, 0, 0, 0, time.Local)
	trayQuitSessionAt(4, t0)
	trayAliveAt(4, t0.Add(trayQuitRestartAfter)) // restarted
	t1 := t0.Add(trayQuitRestartAfter + 2*time.Minute)
	trayQuitSessionAt(4, t1)
	if trayStartDue(4, t1.Add(9*time.Minute)) {
		t.Fatal("a second Quit: the icon came back before 10 minutes")
	}
	if !trayStartDue(4, t1.Add(10*time.Minute)) {
		t.Fatal("a second Quit: the icon did not come back after 10 minutes")
	}
}

// A3. a session never quit: as before (started when it has not reported for 40 s); sessions are apart
func TestR2519TrayNotQuitAsBefore(t *testing.T) {
	resetTrayKeeperState(t)
	t0 := time.Date(2026, 11, 23, 11, 0, 0, 0, time.Local)
	if !trayStartDue(5, t0) {
		t.Fatal("a session with no icon at all: not started")
	}
	trayAliveAt(5, t0)
	if trayStartDue(5, t0.Add(39*time.Second)) || !trayStartDue(5, t0.Add(40*time.Second)) {
		t.Fatal("the 40 s rule for a crashed icon changed")
	}
	trayQuitSessionAt(6, t0)
	if !trayStartDue(5, t0.Add(41*time.Second)) || trayStartDue(6, t0.Add(41*time.Second)) {
		t.Fatal("a Quit in session 6 changed session 5, or session 6 came back at once")
	}
}

// A4. signing out forgets the Quit (the next sign-in gets the icon at once, as before)
func TestR2519TraySignOutForgetsQuit(t *testing.T) {
	resetTrayKeeperState(t)
	t0 := time.Date(2026, 11, 23, 11, 0, 0, 0, time.Local)
	trayQuitSessionAt(3, t0)
	trayQuitSessionAt(4, t0)
	trayForgetSignedOut(map[int]bool{4: true}) // session 3 signed out, 4 still there
	if !trayStartDue(3, t0.Add(time.Minute)) {
		t.Fatal("signed out and in again: the icon waits for the old Quit")
	}
	if trayStartDue(4, t0.Add(time.Minute)) {
		t.Fatal("a session still signed in lost its Quit")
	}
}

// A5. the typing gate is kept: from Quit until the restarted icon reports, every background gate holds; once it
// reports an idle keyboard, background reading goes by itself; typing in Tally holds it again
func TestR2519TypingGateKeptAroundQuit(t *testing.T) {
	resetTrayKeeperState(t)
	now := time.Now()
	setTrayIdle(3, 300, true)
	if _, _, unknown := trayPersonAt([]int{3}, true, now); unknown {
		t.Fatal("a fresh report counts as unknown")
	}
	// Quit: the icon stops reporting; 31 s later the gate holds (someone may be typing: the service cannot see)
	trayQuitSessionAt(3, now)
	later := now.Add(31 * time.Second)
	if idle, front, unknown := trayPersonAt([]int{3}, true, later); idle != 0 || !front || !unknown {
		t.Fatalf("after Quit the gate does not hold: idle %v front %v unknown %v", idle, front, unknown)
	}
	// 9 minutes on: still held, and the icon not back yet
	if _, _, unknown := trayPersonAt([]int{3}, true, now.Add(9*time.Minute)); !unknown {
		t.Fatal("the gate opened without a report")
	}
	// the restarted icon reports an idle keyboard: the gate opens by itself
	trayMu.Lock()
	trayReps[3] = trayRep{120, true, now.Add(10*time.Minute + 30*time.Second)}
	trayMu.Unlock()
	if idle, _, unknown := trayPersonAt([]int{3}, true, now.Add(10*time.Minute+31*time.Second)); unknown || idle != 120 {
		t.Fatalf("after the restart the gate does not open: idle %v unknown %v", idle, unknown)
	}
	// and it reports typing in Tally: held again
	trayMu.Lock()
	trayReps[3] = trayRep{0.5, true, now.Add(11 * time.Minute)}
	trayMu.Unlock()
	if idle, front, _ := trayPersonAt([]int{3}, true, now.Add(11*time.Minute+time.Second)); idle != 0.5 || !front {
		t.Fatalf("typing after the restart: idle %v front %v", idle, front)
	}
}

// A6. the tray's /tray/quit and /tray/idle routes feed the same state
func TestR2519TrayRoutesFeedKeeper(t *testing.T) {
	resetTrayKeeperState(t)
	trayQuitSession(8)
	trayQuitMu.Lock()
	at, ok := trayQuitAt[8]
	trayQuitMu.Unlock()
	if !ok || time.Since(at) > time.Minute {
		t.Fatal("trayQuitSession did not note the time of Quit")
	}
	if trayStartDue(8, time.Now()) {
		t.Fatal("started again at once after Quit")
	}
	trayAlive(8)
	trayQuitMu.Lock()
	p := trayPing[8]
	trayQuitMu.Unlock()
	if time.Since(p) > time.Minute {
		t.Fatal("trayAlive did not note the report")
	}
}
