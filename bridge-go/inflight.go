package main

// Bridge 2.3.1, the owner's rule on a busy Tally (06-Oct-2026): the bridge never piles up requests. ONE request is in
// flight per Tally at any time, and a request the bridge has stopped waiting for still counts: Tally goes on working on
// it whether or not anyone waits. So when the bridge stops waiting (the 2-second stop of a background read, 20 s for a
// single-entry fetch, a request's own timeout, a posting that made a background read give way) the connection is NOT
// closed: the answer is read in the background and discarded, and the per-Tally lock stays held until Tally has answered
// or closed that request. A long bound (TallyAbandonMaxSec, 10 minutes) ends it: Tally is then taken as not answering
// (one log line; the small check goes before anything else) and the lock goes.
//
// While a Tally is on such an earlier request: a background read is not sent (it waits for the shared retry schedule,
// retry.go, and is not counted as a failure); a posting and a person's request wait for the lock as for any request, and
// a posting says so in plain words: "waiting for Tally to finish an earlier request".
//
// The owner's preference: if Tally keeps processing after the bridge stops waiting, prefer waiting longer over retrying
// sooner. Hence the 20 s wait for a single-entry fetch (RecorderEntryLimitMs), and nothing sent into a Tally that is
// still on an earlier request, however the retry schedule stands.

import (
	"fmt"
	"sync"
	"time"
)

// next-inflight (the owner, 07-Oct-2026): after a stop, how long the bridge waits for Tally to finish the request it
// stopped waiting for before it backs off (nothing is sent meanwhile)
func abandonWait() time.Duration {
	return time.Duration(keepNum("TallyAbandonWaitSec", 20)) * time.Second
}

// next-inflight: 0 closes the request when the bridge gives up on it (the behaviour before: the small check a minute after)
func abandonMax() time.Duration {
	return time.Duration(keepNumZero("TallyAbandonMaxSec", 600)) * time.Second
}

const earlierWords = "waiting for Tally to finish an earlier request"

// a request given up but still at Tally: set by tallyRaw (done closes when Tally answered or closed it, or the bound)
type abandonSlot struct {
	done  chan struct{}
	id    string
	at    time.Time
	bound bool          // ended by the long bound (Tally taken as not answering), set before done closes
	took  time.Duration // Tally's time on it when it finished, set before done closes
}
type abandonKey struct{}

var (
	earlierMu sync.Mutex
	earlier   = map[int]*abandonSlot{} // port -> the request Tally is still on
)

// whether this Tally is still on an earlier request the bridge stopped waiting for
func earlierBusy(port int) bool {
	earlierMu.Lock()
	defer earlierMu.Unlock()
	return earlier[port] != nil
}

// any Tally is
func earlierBusyAny() bool {
	earlierMu.Lock()
	defer earlierMu.Unlock()
	return len(earlier) > 0
}

// a background request finding its Tally on an earlier request: not sent; it waits like a retry (errRetryWait)
type earlierErr struct{ s *abandonSlot }

func (e *earlierErr) Error() string {
	return fmt.Sprintf("Tally did not answer in time; %s (%s, sent at %s); nothing was sent", earlierWords, e.s.id, e.s.at.Format("15:04:05"))
}
func (e *earlierErr) Is(t error) bool { return t == errRetryWait }

func earlierRefusal(port int) error {
	earlierMu.Lock()
	defer earlierMu.Unlock()
	if s := earlier[port]; s != nil {
		return &earlierErr{s}
	}
	return nil
}

// the lock of a request that was given up: held (the port marked) until Tally is done with it, then released
func holdUntilAnswered(port int, s *abandonSlot, unlock func()) {
	earlierMu.Lock()
	earlier[port] = s
	earlierMu.Unlock()
	go func() {
		<-s.done
		earlierMu.Lock()
		if earlier[port] == s {
			delete(earlier, port)
		}
		earlierMu.Unlock()
		unlock()
	}()
}

// next-inflight: after the long bound the small check is owed; the minute before it counts from when the bridge gave up
// on the request (as for a request closed at once), so after the 10-minute bound it goes at once
func setProbeFrom(port int, gaveUp time.Time) {
	probeMu.Lock()
	probes[port] = &probeState{need: true, last: gaveUp}
	probeMu.Unlock()
}

func resetEarlier() {
	earlierMu.Lock()
	earlier = map[int]*abandonSlot{}
	earlierMu.Unlock()
}
