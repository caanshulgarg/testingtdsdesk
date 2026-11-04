// FinCom Bridge 2.5.4: TallyPrime's connection is no longer switched on in a tally.ini that every user of the computer
// shares. 2.5.3 wrote "Client Server = Both" and a "ServerPort" into the tally.ini next to tally.exe under Program
// Files; every Windows login that runs that TallyPrime reads the same file, so on a shared server two users' Tallys then
// wanted the same port (only the first one gets it), and the words "Close and reopen Tally once" reached users for whom
// they were not true.
//
// TallyPrime keeps its connection settings (TallyPrime acts as, Port) only in that tally.ini: it has no per-user copy
// and no documented start-up switch for another file or another port (TallyPrime's command-line options load or skip
// TDLs and companies; none chooses the settings file or the port), and the bridge does not start Tally, so it could not
// pass one anyway. So on a computer several people use (Windows Server, the multi-session edition, more than one person
// signed in, or another login's Tally running) the connection settings are not written at all: the file's state is
// connectSharedOff, its plain words say what to do (connectWhy, and why when the add-on step left none), and while the
// user's Tally does not answer the beat says "Tally's connection is off" with the fix (owntally254.go). On a computer
// one person uses, the 2.5.3 step stays as it was (a port no other tally.ini names and nothing listens on, read back).
// FinCom's add-on line (2.4.5) is unchanged. Nothing is sent to Tally.
package main

import (
	"sync"
	"testing"
	"time"
)

const (
	// the file's connection state when the bridge does not write it because others share it (not a failure)
	connectSharedOff = "off; shared by every user of this computer, not changed"
	// the plain words for each state the person must act on (the beat's tallyIni[].connectWhy)
	connectWhyCannotWrite = "Tally's connection is off, and this Windows user may not change TallyPrime's settings. In TallyPrime: F1 Help > Settings > Connectivity > TallyPrime acts as: Both, then close and reopen Tally."
	connectWhyShared      = "Tally's connection is off. Every user of this computer shares this TallyPrime's settings, so FinCom does not change them: ask the computer's administrator to give each user's Tally its own port."
)

// a computer several people use (cached a minute: the beat asks often); a hook for the tests
var iniSharedFn = func() bool { return sharedNow.get() }

var sharedNow = &sharedCache{}

type sharedCache struct {
	mu sync.Mutex
	at time.Time
	v  bool
}

func (c *sharedCache) get() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	// (under go test each look is the test's own: nothing kept from another test)
	if !testing.Testing() && !c.at.IsZero() && time.Since(c.at) < time.Minute {
		return c.v
	}
	c.v, c.at = sharedComputerNow(), time.Now()
	return c.v
}

// Windows says several people use this computer, or a Tally of another login runs on it now
func sharedComputerNow() bool {
	if platSharedComputer() {
		return true
	}
	ok, procs, _ := netState()
	if !ok {
		return false
	}
	for _, p := range procs {
		if reTally.MatchString(p.Name) && sessionOwner(p) == "other" {
			return true
		}
	}
	return false
}

// the plain words for a file's connection state ("" when nothing is for the person to do)
func connectWhyOf(state string) string {
	switch state {
	case connectCannotWrite:
		return connectWhyCannotWrite
	case connectSharedOff:
		return connectWhyShared
	}
	return ""
}

// the file's entry gets its plain words: connectWhy, and why too when the add-on step left none (FinCom reads why)
func noteConnectWhy(e M) {
	w := connectWhyOf(str(e["connect"]))
	if w == "" {
		return
	}
	e["connectWhy"] = w
	if str(e["why"]) == "" {
		e["why"] = w
	}
}
