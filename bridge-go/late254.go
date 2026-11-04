// FinCom Bridge 2.5.4, review B1: the late answer. The company list (TDSDeskCompanies) and one company's GSTIN / PAN
// (TDSDeskCompanyInfo) wait 2 s at most; Tally keeps working on a request the bridge stopped waiting for, and the bridge
// keeps Tally's lock until Tally has finished it (one request in flight, inflight.go). Before this, that late answer
// was read and thrown away, so a Tally that always takes 2-8 s for its list never had a list: its open company was never
// found, and postings said "Tally is busy". Now, when Tally finishes such a request within the wait after the stop
// (TallyAbandonWaitSec, 20 s), its answer is kept, with the Tally program then listening on the port, and the next ask
// for the same request within lateMaxAge takes it instead of sending anything: nothing new is sent to Tally. Tally's
// "not responding" and "busy" marks go with it (it answered). A Tally restarted since (another program on the port) never
// gets a kept answer.
package main

import (
	"sync"
	"time"
)

const lateMaxAge = 60 * time.Second

type lateAnswer struct {
	text string
	at   time.Time
	pid  int
}

var (
	lateMu  sync.Mutex
	lateMap = map[int]map[string]lateAnswer{} // port -> the request's text -> its late answer
)

func keepsLateAnswer(id string) bool { return id == "TDSDeskCompanies" || id == "TDSDeskCompanyInfo" }

// the program listening on a port now (0 when Windows does not say; a hook for the tests)
var listenerPidFn = func(port int) int {
	ok, _, lis := netState()
	if !ok {
		return 0
	}
	for _, l := range lis {
		if l.Port == port {
			return l.Pid
		}
	}
	return 0
}

func noteLateAnswer(port int, x, text string) {
	pid := listenerPidFn(port)
	lateMu.Lock()
	if lateMap[port] == nil {
		lateMap[port] = map[string]lateAnswer{}
	}
	lateMap[port][x] = lateAnswer{text, nowFn(), pid}
	lateMu.Unlock()
	busyMu.Lock()
	delete(busySince, port)
	busyMu.Unlock()
	clearProbe(port)
	clearTallyStuck(port)
	select {
	case beatNow <- struct{}{}: // the beat says it at once
	default:
	}
}

// the late answer to this request on this port, when Tally gave it within lateMaxAge and the same program still
// listens there (pid: the plan's; 0: not known, then Windows is asked)
func takeLateAnswer(port int, x string, pid int) (string, bool) {
	lateMu.Lock()
	a, ok := lateMap[port][x]
	lateMu.Unlock()
	if !ok || nowFn().Sub(a.at) > lateMaxAge || nowFn().Before(a.at.Add(-time.Minute)) {
		return "", false
	}
	if pid == 0 {
		pid = listenerPidFn(port)
	}
	if a.pid != 0 && pid != 0 && a.pid != pid {
		forgetLate(port)
		return "", false
	}
	return a.text, true
}

// an answer in time replaces it; a Tally gone forgets it
func forgetLateFor(port int, x string) {
	lateMu.Lock()
	delete(lateMap[port], x)
	lateMu.Unlock()
}

func forgetLate(port int) {
	lateMu.Lock()
	delete(lateMap, port)
	lateMu.Unlock()
}

func resetLate() {
	lateMu.Lock()
	lateMap = map[int]map[string]lateAnswer{}
	lateMu.Unlock()
}
