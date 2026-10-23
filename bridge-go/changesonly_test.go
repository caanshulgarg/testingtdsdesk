// 2.3.0 (part 6): "Changes only", an owner's switch per bridge in FinCom: the heartbeat's answer says notMain + changesOnly
// and the bridge then reads only (it never asks for a posting); the switch off, it posts again. Each posts_take names the
// bridge (its id), so FinCom's cloud hands it only the postings for it (or naming none, when it is the main bridge).
package main

import (
	"strings"
	"testing"
)

func TestChangesOnlyFromFinCom(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	const why = "This bridge is set to changes only in FinCom (Tally page): it reads Tally's changes and never posts."
	c.mu.Lock()
	c.beatReply = M{"notMain": true, "changesOnly": true, "error": why}
	c.takeJobs = []M{{"id": "job-co-1", "company": zz, "payload": M{"vouchers": []any{}}}}
	c.mu.Unlock()
	beatOnce()
	if w := readOnlyWhy(); w != why {
		t.Fatalf("changes only: the bridge does not read only (%q)", w)
	}
	cloudPostTake()
	if n := c.count("posts_take"); n != 0 {
		t.Fatalf("changes only: the bridge asked for a posting (%d)", n)
	}
	if !strings.Contains(str(trayStatus()["readOnly"]), "changes only") {
		t.Fatalf("the tray does not say it: %v", trayStatus()["readOnly"])
	}
	// switched off in FinCom: it posts again, and asks naming itself
	c.mu.Lock()
	c.beatReply = M{}
	c.takeJobs = nil // asked, nothing handed out (no posting runs on after the test)
	c.mu.Unlock()
	beatOnce()
	if w := readOnlyWhy(); w != "" {
		t.Fatalf("switched off: still reads only (%q)", w)
	}
	cloudPostTake()
	if c.count("posts_take") == 0 {
		t.Fatal("switched off: no posting asked for")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, raw := range c.raw {
		if o := parseObj(raw); str(o["kind"]) == "posts_take" && str(obj(o["bridge"])["id"]) != "go-"+instanceID() {
			t.Fatalf("posts_take does not name the bridge: %s", raw)
		}
	}
}
