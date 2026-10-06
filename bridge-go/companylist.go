package main

// Bridge 2.3.1 (the owner's report of 06-Oct-2026 08:05: TDSDeskCompanies took 3,307 ms on NWS144): the company list is asked
// LESS OFTEN in the background. Part A put the background asks (the light check's list when it is 10 minutes old, and the
// recorder's look at its own Tally while a line waits for a company not seen open, 30 s apart at most) under the 2-second
// hard stop (bgCompaniesTC, recorder_owntally.go; the companies named last time stand). On top of it: after a stopped ask
// the bridge leaves the background company list alone for 5 minutes, then 10, 20, at most 30 while it keeps taking longer
// than 2 s, and says so in the log; one answered in time ends the back-off. The request is byte for byte as before
// (companiesRequest). A posting, Update now, the tray's Test connection and a person's status ask it as before: never held.

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	coListMu    sync.Mutex
	coListN     int       // stops in a row
	coListUntil time.Time // no background ask of the company list before this
)

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
