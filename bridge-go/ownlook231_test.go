package main

// Review H1 (06-Oct-2026): a slow company list (TDSDeskCompanies at 3,307 ms, as on NWS144 at 08:05) must never lose or
// silently pass over a line of the bridge's own company, and never send another Windows user's line. Looks stopped at 2 s
// or backed off decide nothing; the last complete list keeps attributing lines (kept on disk, so a restart keeps it); a
// line written while no complete look could be had waits for the next complete look (never the 2-minute pass-over); with
// no complete list at all the lines wait, said in plain words on the Tally page (the beat). Tests written before the code.

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func ownSlowList(f *standTally, on bool) {
	f.mu.Lock()
	if on {
		f.slow = func(id, body string) time.Duration {
			if id == "TDSDeskCompanies" {
				return 3307 * time.Millisecond
			}
			return 0
		}
	} else {
		f.slow = nil
	}
	f.mu.Unlock()
}

// the reviewer's probe: no complete list ever until a person's look at +76 minutes
func TestOwnLookSlowListNoCompleteList(t *testing.T) {
	rec, f, c := ownBridge(t, "", b220CoGUID, zz)
	t.Cleanup(func() { nowFn = time.Now; coListReset() })
	ownSlowList(f, true)
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "11", base.Add(-20*time.Second)))
	liveAppend(t, ownFile(rec, ownOtherGUID), ownLine(ownOtherGUID, ownOtherName, "other", "21", base.Add(-10*time.Second)))
	for _, m := range []int{0, 1, 6, 16, 40, 75} {
		ownAt(base.Add(time.Duration(m) * time.Minute))
		readAndUploadAll(t)
	}
	live.mu.Lock()
	nh := liveCo(zz).notHere
	live.mu.Unlock()
	if len(ownSentUsers(c)) != 0 || nh != 0 {
		t.Fatalf("without a complete look: sent %v, passed over %d (nothing may go, nothing may be passed over)", ownSentUsers(c), nh)
	}
	w := liveOwnWaitWords()
	if !strings.Contains(w, "took longer than 2 s to list its open companies") || !strings.Contains(w, "this computer's changes are waiting") {
		t.Fatalf("the Tally page is not told why the lines wait: %q", w)
	}
	if b := beatBody(true, "open", "", nil, nil, nil); str(b["recorderWaitWords"]) != w {
		t.Fatalf("the beat does not carry the words: %v", b["recorderWaitWords"])
	}
	// a person's look (Update now / Test connection: not cut at 2 s) at +76 minutes, then the reader again
	ownAt(base.Add(76 * time.Minute))
	openCompaniesWith(fin, true)
	ownAt(base.Add(77 * time.Minute))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID {
		t.Fatalf("after the complete look, lines sent: %q (the own company's line, never the other user's)", got)
	}
	if w := liveOwnWaitWords(); w != "" {
		t.Fatalf("still said waiting after a complete look: %q", w)
	}
}

// a complete list first, then the list slow: lines go by the last complete list at once, after a restart too; a line of a
// company not in it waits, and is passed over (never sent) once a complete look says the company is not open here
func TestOwnLookSlowListAfterCompleteList(t *testing.T) {
	rec, f, c := ownBridge(t, "", b220CoGUID, zz)
	t.Cleanup(func() { nowFn = time.Now; coListReset() })
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "11", base.Add(-20*time.Second)))
	readAndUploadAll(t) // a complete look (the list answers at once): zz open
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID {
		t.Fatalf("the first line: %q", got)
	}
	ownSlowList(f, true)
	for i, m := range []int{3, 9, 25} {
		ownAt(base.Add(time.Duration(m) * time.Minute))
		if i == 1 {
			liveResetState() // a restart in the middle: the last complete list is kept on disk
		}
		liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", fmt_mid(12+i), base.Add(time.Duration(m)*time.Minute-30*time.Second)))
		liveAppend(t, ownFile(rec, ownOtherGUID), ownLine(ownOtherGUID, ownOtherName, "other", fmt_mid(30+i), base.Add(time.Duration(m)*time.Minute-30*time.Second)))
		readAndUploadAll(t)
		if n := len(ownSentUsers(c)); n != 2+i {
			t.Fatalf("+%d min: %d lines sent, want %d (the own company's line at once, by the last complete list): %v", m, n, 2+i, ownSentUsers(c))
		}
	}
	for _, u := range ownSentUsers(c) {
		if strings.HasPrefix(u, "other@") {
			t.Fatalf("another user's line was sent: %v", ownSentUsers(c))
		}
	}
	// the list answers in time again: a complete look says the other company is not open here: its lines passed over
	ownSlowList(f, false)
	coListReset()
	ownAt(base.Add(40 * time.Minute))
	readAndUploadAll(t)
	for _, u := range ownSentUsers(c) {
		if strings.HasPrefix(u, "other@") {
			t.Fatalf("another user's line was sent after the complete look: %v", ownSentUsers(c))
		}
	}
	live.mu.Lock()
	nh := liveCo(ownOtherName).notHere
	live.mu.Unlock()
	if nh != 3 {
		t.Fatalf("the other company's 3 lines: %d passed over (want 3, once a complete look decided)", nh)
	}
}

func fmt_mid(n int) string { return fmt.Sprint(n) }
