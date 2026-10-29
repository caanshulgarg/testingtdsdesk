package main

// next-bridge-248 (28-Oct-2026, staging): a company linked in FinCom a moment ago waited up to CloudLinksSec (300 s) before
// this bridge sent anything of it (its ledger list included): the bridge asks the cloud which companies are linked only
// every 5 minutes (updateCloudLinks), and FinCom's "Update now" for that company (POST /keep {now, company}, which FinCom
// now sends right after a link) did not make it ask sooner. Now a company asked for by name that this bridge does not
// hold as linked makes the next cloud push ask the cloud's links again (once); a company held as linked changes nothing.

import (
	"testing"
	"time"
)

func TestLinkNowAsksCloudLinksAgain(t *testing.T) {
	cloudMu.Lock()
	oldL, oldAt := cloudLinks, cloudLinksAt
	cloudLinks, cloudLinksAt = map[string]bool{"Linked Co": true}, time.Now()
	cloudMu.Unlock()
	holdLinks(map[string]bool{"Linked Co": true})
	cloudLinksAgain.Store(false)
	resetLinksAsked()
	t.Cleanup(func() {
		cloudMu.Lock()
		cloudLinks, cloudLinksAt = oldL, oldAt
		cloudMu.Unlock()
		cloudLinksAgain.Store(false)
		holdLinks(nil)
	})

	if cloudLinksDue(300) {
		t.Fatal("links read a moment ago: not due")
	}
	askLinksFor("Linked Co")
	if cloudLinksDue(300) {
		t.Fatal("a company held as linked: the links are not asked again")
	}
	askLinksFor("")
	if cloudLinksDue(300) {
		t.Fatal("no company named: nothing")
	}
	askLinksFor("Salesify Marketing LLP 2026-27")
	if !cloudLinksDue(300) {
		t.Fatal("a company not held as linked: the links are asked again at the next push")
	}
	if cloudLinksDue(300) {
		t.Fatal("asked again once only")
	}
	// review 2.4.8 (R1-9, R2-5): the same company again within 15 s (Update now after each posting to a company never
	// linked): the links are not asked again at every push; another company is; the same one after 15 s is
	askLinksFor("Salesify Marketing LLP 2026-27")
	if cloudLinksDue(300) {
		t.Fatal("the same company within 15 s: not asked again")
	}
	cloudLinksMu.Lock()
	linksAskedFor["Salesify Marketing LLP 2026-27"] = time.Now().Add(-16 * time.Second)
	cloudLinksMu.Unlock()
	askLinksFor("Salesify Marketing LLP 2026-27")
	if !cloudLinksDue(300) {
		t.Fatal("the same company after 15 s (linked a little later): asked again")
	}
	askLinksFor("Another Co")
	if !cloudLinksDue(300) {
		t.Fatal("another company not held as linked: asked")
	}
	cloudMu.Lock()
	cloudLinksAt = time.Now().Add(-301 * time.Second)
	cloudMu.Unlock()
	if !cloudLinksDue(300) {
		t.Fatal("the 5-minute check stays as it was")
	}
}

func TestWakeUpdateOfACompanyNotLinkedAsksLinks(t *testing.T) {
	bridgeFor(t, &standIn{}, "")
	cloudMu.Lock()
	oldL, oldAt := cloudLinks, cloudLinksAt
	cloudLinks, cloudLinksAt = map[string]bool{}, time.Now()
	cloudMu.Unlock()
	holdLinks(nil)
	cloudLinksAgain.Store(false)
	resetLinksAsked()
	t.Cleanup(func() {
		cloudMu.Lock()
		cloudLinks, cloudLinksAt = oldL, oldAt
		cloudMu.Unlock()
		cloudLinksAgain.Store(false)
		holdLinks(nil)
	})
	wakeUpdate("Salesify Marketing LLP 2026-27")
	waitIdle(t)
	if !cloudLinksAgain.Load() {
		t.Fatal("Update now of a company not held as linked: the cloud's links are asked again")
	}
}
