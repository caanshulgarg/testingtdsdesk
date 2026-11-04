// FinCom Bridge 2.5.4 (the owner's rule: each request to Tally 2 s at most): the company list (TDSDeskCompanies, the
// same request as before) waits 2 s instead of 8 s (tally.go tallyRaw caps it whoever asks). A Tally that does not give
// its list in 2 s (a very large list, or Tally busy) keeps the list it gave last, and its list is not asked again
// until a wait has passed: 15 s, then 30 s, 1, 2, 4, 8 minutes, 10 minutes at most; an answer in time ends the wait.
// While it waits nothing is sent for the list, so other requests (postings first) are never held behind it. Review B2:
// never for a fresh ask (a posting, Test connection, Connect: Tally is asked), and never for another program on the port. A Tally with
// no list held is always asked (the small check after no answer still decides when, as before), so a Tally found once
// is never lost by the wait; a background ask follows the shared retry schedule instead (retry.go).
package main

import (
	"errors"
	"sync"
	"time"
)

const colistMaxSec = 2

type colistWait struct {
	until time.Time
	n     int
	pid   int // the Tally program on the port when it was slow (review B2: another program there, a Tally restarted, waits nothing)
}

var (
	colistMu   sync.Mutex
	colistBack = map[int]colistWait{}
)

// the list of the Tally on this port is not asked now: until when ("" / false when it may be asked). pid: the program
// listening on the port now (0: not known); a wait noted for another program is dropped
func colistHold(port, pid int) (time.Time, bool) {
	colistMu.Lock()
	defer colistMu.Unlock()
	w, ok := colistBack[port]
	if ok && w.pid != 0 && pid != 0 && w.pid != pid {
		delete(colistBack, port)
		return time.Time{}, false
	}
	if !ok || !nowFn().Before(w.until) {
		return time.Time{}, false
	}
	return w.until, true
}

// the list's outcome: in time ends the wait; not in time (no answer in 2 s, stopped, Tally busy) starts or doubles it;
// anything else (refused, closed, given way to a posting) leaves it as it is
func colistNote(port, pid int, err error) {
	colistMu.Lock()
	defer colistMu.Unlock()
	switch {
	case err == nil:
		delete(colistBack, port)
	case tallyNoAnswer(err) || errors.Is(err, errRecorderStop) || isBusyErr(err):
		w := colistBack[port]
		w.n++
		d := 15 * time.Second
		for i := 1; i < w.n && d < 10*time.Minute; i++ {
			d *= 2
		}
		if d > 10*time.Minute {
			d = 10 * time.Minute
		}
		w.until, w.pid = nowFn().Add(d), pid
		colistBack[port] = w
	}
}

// the tests: no wait held
func resetColist() {
	colistMu.Lock()
	colistBack = map[int]colistWait{}
	colistMu.Unlock()
}
