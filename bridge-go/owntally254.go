// FinCom Bridge 2.5.4: "your Tally's connection is off" in the beat's tallyWhy, ranked above "owner unknown" and
// "another user". Before, a Tally running in this login that takes no connection (TallyPrime acts as Client or None, or
// its port held by someone else) does not show among the ports at all, so a port of another user's Tally (9000) made
// the beat say "another user", and the person was never told that their own Tally's connection is off.
//
// Off when (nothing is sent to Tally for any of it):
//  1. Windows lists a Tally of this login (ports.go sessionOwner "mine", running a minute or more) that listens on no
//     port; the words say why from its tally.ini (acts as Client / None; its port used by another program; or set,
//     not on yet: one restart), or
//  2. Windows does not list programs, every port tried is closed, and every tally.ini known says the connection is
//     off and may not be changed by FinCom ("cannot write", or shared by every user: iniconnect254.go).
//
// The person's words go in the beat's tallyConnectSay (200 letters at most). 2.5.11: the words of case 1 and its details
// (the beat's tallyOff) are owntally2511.go's.
package main

import (
	"sync"
	"time"
)

const whyConnOff = "connection off"

const (
	connOffWordsMode   = "Your Tally's connection is off. In TallyPrime: F1 Help > Settings > Connectivity > TallyPrime acts as: Both, then close and reopen Tally."
	connOffWordsPort   = "Your Tally cannot take FinCom's connection: port %d is used by another program (on a shared server often another user's Tally). Ask the computer's administrator for a port of your own."
	connOffWordsReopen = "Your Tally's connection is set but not on yet. Close and reopen Tally once."
)

// whether this login's Tally takes no connection, the person's words and (2.5.11) its details for the beat's tallyOff
// (nil when Windows does not list programs); a hook for the tests
var connOffFn = connOffNow

var connOffLast struct {
	mu     sync.Mutex
	words  string
	detail M
}

// the words of the last "connection off" found (tallyConnectSay)
func connOffWords() string {
	connOffLast.mu.Lock()
	defer connOffLast.mu.Unlock()
	return connOffLast.words
}

// 2.5.11: the details of the last "connection off" found (tallyOff; owntally2511.go)
func connOffDetail() M {
	connOffLast.mu.Lock()
	defer connOffLast.mu.Unlock()
	return connOffLast.detail
}

func noteConnOff(words string, detail M) {
	connOffLast.mu.Lock()
	connOffLast.words, connOffLast.detail = words, detail
	connOffLast.mu.Unlock()
}

func connOffNow(ports []any) (bool, string, M) {
	ok, procs, lis := netState()
	if ok {
		listens := map[int]bool{}
		for _, l := range lis {
			listens[l.Pid] = true
		}
		for _, p := range procs {
			if !reTally.MatchString(p.Name) || sessionOwner(p) != "mine" || listens[p.ID] {
				continue
			}
			if !p.Started.IsZero() && time.Since(p.Started) < time.Minute {
				continue // just opened: Tally takes its port a moment after it starts
			}
			// 2.5.11 (owntally2511.go): "set but not on yet" only when its tally.ini changed after it started; else why
			d, words := tallyOffOf(p, procs, lis)
			return true, words, d
		}
		return false, "", nil
	}
	// Windows does not list programs: by the ports tried and the tally.ini files known
	for _, x := range ports {
		o := obj(x)
		if o == nil || o["skipped"] == true {
			continue
		}
		if str(o["reason"]) != "closed" {
			return false, "", nil
		}
	}
	ini := tallyIniBeat()
	if len(ini) == 0 {
		return false, "", nil
	}
	words := ""
	for _, x := range ini {
		o := obj(x)
		c := str(o["connect"])
		if c != connectCannotWrite && c != connectSharedOff {
			return false, "", nil
		}
		if words == "" {
			words = connectWhyOf(c)
		}
	}
	return true, words, nil
}
