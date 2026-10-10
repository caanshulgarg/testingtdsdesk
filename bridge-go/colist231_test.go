package main

// Bridge 2.3.1 (the owner's report of 06-Oct-2026 08:05: TDSDeskCompanies took 3,307 ms on NWS144): the company list asked
// in the background is under the 2-second rule of the other background reads, and asked less often. Tests written first.
// 2.3.1, the owner's last change: after a stop it follows the shared retry schedule (retry.go: 15 s, 30 s, 1 min, 2 min, then
// 5 min), in place of the 5/10/20/30-minute back-off

import (
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompanyListTwoSecondRule(t *testing.T) {
	f := r21Stand(t, "")
	_ = openCompaniesWith(fin, true) // the list as Tally gave it in time
	t.Cleanup(func() { nowFn = time.Now; retryReset() })
	base := time.Now()
	var arrived atomic.Int64
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == "TDSDeskCompanies" {
			arrived.Store(time.Now().UnixNano())
			return 3307 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	nowFn = func() time.Time { return base.Add(11 * time.Minute) }
	n0 := f.n("TDSDeskCompanies")
	got := lightCompanyList(openCompaniesCached())
	took := time.Since(time.Unix(0, arrived.Load())) // from the send (a background read first waits out FinCom's own request)
	if f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("the old list was not asked afresh")
	}
	if took >= 2800*time.Millisecond {
		t.Fatalf("the bridge waited %s for the company list (the 2-second rule)", took)
	}
	f.mu.Lock()
	body := f.bodies[len(f.bodies)-1]
	f.mu.Unlock()
	if body != companiesRequest() {
		t.Fatalf("the request is not the company list as built: %s", body)
	}
	named := false
	for _, s := range got {
		for _, c := range sessCompanies(s) {
			named = named || str(c["name"]) == gsc
		}
	}
	if !named {
		t.Fatalf("a stopped list dropped the companies named last time: %v", got)
	}
	if logLines("did not answer in time at") != 1 || logLines("(TDSDeskCompanies, try 1); trying again by itself at") != 1 {
		t.Fatalf("the stop is not in the log: %s", readText(logFile()))
	}
	// the retry is pending: 10 s later neither the light check nor the recorder's look asks it
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	nowFn = func() time.Time { return base.Add(11*time.Minute + 10*time.Second) }
	_ = lightCompanyList(openCompaniesCached())
	live.mu.Lock()
	live.ownWant, live.ownAskAt = true, time.Time{}
	live.mu.Unlock()
	if liveOwnAskNow() || f.n("TDSDeskCompanies") != n0+1 {
		t.Fatal("the company list was asked again before the retry")
	}
	// at the retry (15 s): asked again by itself; answered in time, back to normal
	nowFn = func() time.Time { return base.Add(11*time.Minute + 16*time.Second) }
	_ = lightCompanyList(openCompaniesCached())
	if f.n("TDSDeskCompanies") != n0+2 || retryHeld() {
		t.Fatalf("not asked again at the retry (%d), or still held (%v)", f.n("TDSDeskCompanies")-n0, retryHeld())
	}
	if !strings.Contains(readText(logFile()), "answered in time again (TDSDeskCompanies)") {
		t.Fatal("the log does not say it is back to normal")
	}
}
