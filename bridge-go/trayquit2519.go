package main

// The tray icon's keeper state (as a service): when each of the owner's sessions last had its icon report, and when Quit
// was pressed in it. 2.5.19 (the owner's decision A of 23-Nov-2026): Quit no longer keeps the icon away (and with it,
// background reading, which the typing gate holds while no icon reports, mode.go trayPerson) until the next sign-in:
// the service starts the icon again in that session 10 minutes after Quit. Until the started icon reports, the typing
// gate still holds every background read, as in 2.5.18. Kept here, not in win_service.go, so the tests run everywhere.
// Nothing here asks anything of Tally.
import (
	"sync"
	"time"
)

// how long after Quit the service starts the tray icon again in that session (the owner: 10 minutes)
const trayQuitRestartAfter = 10 * time.Minute

// an icon that has not reported for this long has stopped (crashed): started again (as before 2.5.19)
const trayDeadAfter = 40 * time.Second

var (
	trayQuitMu sync.Mutex
	trayQuitAt = map[int]time.Time{} // session -> when Quit was pressed there
	trayPing   = map[int]time.Time{} // session -> the icon's last report (or the keeper's start of it)
)

func trayAlive(session int)       { trayAliveAt(session, time.Now()) }
func trayQuitSession(session int) { trayQuitSessionAt(session, time.Now()) }

func trayAliveAt(session int, at time.Time) {
	trayQuitMu.Lock()
	trayPing[session] = at
	trayQuitMu.Unlock()
}

func trayQuitSessionAt(session int, at time.Time) {
	trayQuitMu.Lock()
	trayQuitAt[session] = at
	trayQuitMu.Unlock()
}

// whether the keeper starts the icon in this session now
func trayStartDue(session int, now time.Time) bool {
	due, _ := trayStartDueWhy(session, now)
	return due
}

// afterQuit: this start is the one 10 minutes after Quit (the keeper's log says so). A Quit 10 minutes old is
// forgotten here, so from then on the icon is kept as before: started again when it has not reported for 40 s (an
// icon the person started again by hand in between keeps reporting, so no second one is started)
func trayStartDueWhy(session int, now time.Time) (due, afterQuit bool) {
	trayQuitMu.Lock()
	defer trayQuitMu.Unlock()
	if at, quit := trayQuitAt[session]; quit {
		if now.Sub(at) < trayQuitRestartAfter {
			return false, false
		}
		delete(trayQuitAt, session)
		afterQuit = true
	}
	return now.Sub(trayPing[session]) >= trayDeadAfter, afterQuit
}

// the sessions no longer signed in forget their Quit: the next sign-in gets the icon at once
func trayForgetSignedOut(live map[int]bool) {
	trayQuitMu.Lock()
	for id := range trayQuitAt {
		if !live[id] {
			delete(trayQuitAt, id)
		}
	}
	trayQuitMu.Unlock()
}

// the tray's hide item, true for the way the bridge runs (the code re-review's R1): while no icon reports, background
// reading waits and only postings go; as a service the icon comes back by itself in 10 minutes, installed just for one
// user it comes back when the bridge starts again (the next sign-in)
func trayHideWords(runMode string) string {
	switch runMode {
	case "service":
		return "Hide this icon (postings continue; reading waits until the icon is back, in 10 minutes)"
	case "user":
		return "Hide this icon (postings continue; reading waits until the icon is back, at your next sign-in)"
	}
	return "Hide this icon (postings continue; reading waits until the icon is back)"
}
