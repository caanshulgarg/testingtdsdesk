package main

// Bridge 2.3.1 (the owner's report of 06-Oct-2026 08:05: TDSDeskCompanies took 3,307 ms on NWS144). The company list asked
// in the background (the light check's list when it is 10 minutes old, and the recorder's look at its own Tally only while
// a line waits for a company not seen open, 30 s apart at most) is under the 2-second rule of the other
// background reads: the bridge stops waiting at 2 s (Tally finishes the request alone and the background reads leave it
// for 30 s, RecorderStopCoolSec), says so in the log, keeps the companies named last time, and leaves the background company
// list alone for 5 minutes, then 10, 20, at most 30 while it keeps taking longer; one answered in time ends the back-off.
// The request is byte for byte as before (companiesRequest). A posting, Update now, the tray's Test connection and a
// person's status ask it as before: no limit, never held. A background ask gives way to a posting or an import (yield).

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const coListLimitMs = 2000

var (
	coListMu    sync.Mutex
	coListN     int       // stops in a row
	coListUntil time.Time // no background ask of the company list before this
)

// the TC of a background ask of the company list
func coListTC() *TC {
	return &TC{copier: true, light: true, limitMs: coListLimitMs, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }}
}

// whether the background company list is backed off now
func coListHeld() bool {
	coListMu.Lock()
	defer coListMu.Unlock()
	return nowFn().Before(coListUntil)
}

func coListReset() {
	coListMu.Lock()
	coListN, coListUntil = 0, time.Time{}
	coListMu.Unlock()
}

// what a background ask of the company list came to on this Tally
func coListNote(port int, err error) {
	coListMu.Lock()
	defer coListMu.Unlock()
	if err == nil {
		coListN, coListUntil = 0, time.Time{}
		return
	}
	if !errors.Is(err, errRecorderStop) {
		return
	}
	coListN++
	w := 5 * time.Minute
	for i := 1; i < coListN && w < 30*time.Minute; i++ {
		w *= 2
	}
	if w > 30*time.Minute {
		w = 30 * time.Minute
	}
	coListUntil = nowFn().Add(w)
	writeLog(fmt.Sprintf("Tally %d: the company list (TDSDeskCompanies) took longer than 2 s; the bridge stopped waiting and leaves the company list alone until %s (the companies named last time stand)",
		port, coListUntil.Format("15:04")))
}
