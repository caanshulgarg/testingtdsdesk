package main

// Round 2 (02-Oct-2026, the owner's answers): the beat says whether the allow-list is measured; every ledger_list call
// carries its round id, the rows read in that round and whether the round was complete (deletions only then); the
// measuring tool runs the per-ledger items (696-699) only when asked.

import (
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// --- the beat: allowlist {measured, hash}; measured only when every row the bridge sends has a time and a date
func TestBeatCarriesAllowListMeasured(t *testing.T) {
	b := beatBody(true, "open", "", nil, nil, nil)
	al := obj(b["allowlist"])
	if al == nil {
		t.Fatalf("no allowlist in the beat: %v", b)
	}
	if al["measured"] != false || str(al["hash"]) != allowListHash(allowListRows()) {
		t.Fatalf("the first table is not measured yet: want measured false and the table hash, got %v", al)
	}
	// a table stub: every row the bridge sends measured (measure-only rows may stay unmeasured)
	saved := map[string]allowedReq{}
	for id, a := range tallyAllowList {
		saved[id] = a
	}
	t.Cleanup(func() {
		for id, a := range saved {
			tallyAllowList[id] = a
		}
	})
	for id, a := range tallyAllowList {
		if !a.measureOnly {
			a.maxSec, a.measuredOn = 1.5, "2026-10-02"
			tallyAllowList[id] = a
		}
	}
	al = obj(beatBody(true, "open", "", nil, nil, nil)["allowlist"])
	if al["measured"] != true || str(al["hash"]) != allowListHash(allowListRows()) {
		t.Fatalf("every row measured: want measured true and the new hash, got %v", al)
	}
	// one row with a time but no date: not measured
	a := tallyAllowList["Import"]
	a.measuredOn = ""
	tallyAllowList["Import"] = a
	if al = obj(beatBody(true, "open", "", nil, nil, nil)["allowlist"]); al["measured"] != false {
		t.Fatalf("a row without a date: %v", al)
	}
}

// --- every ledger_list call of a round: the same round id, rowsRead = the whole list, complete true; deleted only on
// the last batch
func TestLedgerListSendsRoundAndCount(t *testing.T) {
	const n = 5000
	c := newStandCloud(t)
	f := ledgerTally(t, n, c.cfg())
	push := func() {
		cloudMu.Lock()
		cloudLinksAt = time.Time{}
		cloudMu.Unlock()
		invokeCloudPush()
	}
	runNow(t, "now")
	push()
	c.mu.Lock()
	got := append([]M{}, c.ledList...)
	c.ledList = nil
	c.mu.Unlock()
	if len(got) != 3 {
		t.Fatalf("%d ledger_list calls for %d ledgers in batches of 2,000, want 3", len(got), n)
	}
	round := str(got[0]["round"])
	if !regexp.MustCompile(`^[0-9a-f]{16,64}$`).MatchString(round) {
		t.Fatalf("the round id: %q", round)
	}
	for i, b := range got {
		if str(b["round"]) != round {
			t.Fatalf("call %d has round %q, call 0 %q", i, b["round"], round)
		}
		if b["complete"] != true {
			t.Fatalf("call %d: complete %v", i, b["complete"])
		}
		if toInt(b["rowsRead"]) != n {
			t.Fatalf("call %d: rowsRead %v, want %d (the whole list read, not the rows in this batch)", i, b["rowsRead"], n)
		}
		_, hasDel := b["deleted"]
		if last := i == len(got)-1; hasDel != last || (b["last"] == true) != last {
			t.Fatalf("call %d: deleted present %v, last %v", i, hasDel, b["last"])
		}
	}
	// the next round: a new id, and a deletion goes with it
	f.mu.Lock()
	f.led = f.led[1:]
	f.mu.Unlock()
	nowFn = func() time.Time { return time.Now().Add(10 * time.Minute) }
	defer func() { nowFn = time.Now }()
	if r := wakeLedgers(zz, "test", false); r["started"] != true {
		t.Fatalf("not started: %v", r)
	}
	waitIdle(t)
	push()
	c.mu.Lock()
	got = append([]M{}, c.ledList...)
	c.mu.Unlock()
	if len(got) != 1 || str(got[0]["round"]) == round || str(got[0]["round"]) == "" || got[0]["complete"] != true ||
		toInt(got[0]["rowsRead"]) != n-1 || len(arr(got[0]["deleted"])) != 1 {
		t.Fatalf("the second round: %d call(s) %v", len(got), got)
	}
}

// --- a round cut short (a chunk that does not answer): nothing goes to the cloud for it, so no call can carry deleted;
// once the round completes (the ledger that hangs isolated and skipped) the list goes as complete, naming it
func TestIncompleteRoundSendsNoDeletes(t *testing.T) {
	const n, poison = 40, int64(13)
	c := newStandCloud(t)
	f := ledgerTally(t, n, `,"TallyMaxSec":1,"TallyProbeSec":1,"LedgerChunk":8,"LedgerChunkMin":4`+c.cfg())
	push := func() {
		cloudMu.Lock()
		cloudLinksAt = time.Time{}
		cloudMu.Unlock()
		invokeCloudPush()
	}
	runNow(t, "now")
	push()
	c.mu.Lock()
	first := len(c.ledList)
	c.ledList = nil
	c.mu.Unlock()
	if first != 1 {
		t.Fatalf("the first round: %d call(s)", first)
	}
	dir := syncFolder(zz)
	// now one ledger is gone from Tally and the ledger with MasterID 13 hangs it
	f.mu.Lock()
	f.led = f.led[:n-1]
	f.behave = poisonLedger(poison)
	f.mu.Unlock()
	off := time.Duration(0)
	k := newRun("now", "cut")
	var err error
	var steps atomic.Int32
	for i := 0; i < 30; i++ {
		err = k.step(zz, f.port, "")
		steps.Add(1)
		if len(poisonMids(readKeepState(dir))) > 0 || err == nil {
			break
		}
		off += 2 * time.Minute
		o := off
		nowFn = func() time.Time { return time.Now().Add(o) }
	}
	defer func() { nowFn = time.Now }()
	if err == nil {
		t.Fatal("the round completed in the same step the ledger was isolated; the test needs it cut short first")
	}
	if ls := obj(readKeepState(dir)["led"]); ls == nil || truthy(ls["done"]) {
		t.Fatalf("the round is not in progress: %v", readKeepState(dir)["led"])
	}
	// the outbox names the skipped ledger, but the round is not complete: nothing goes, nothing carries deleted
	push()
	c.mu.Lock()
	sent := append([]M{}, c.ledList...)
	c.mu.Unlock()
	for i, b := range sent {
		if _, has := b["deleted"]; has || b["complete"] == true {
			t.Fatalf("call %d went while the round was cut short: complete %v, deleted %v", i, b["complete"], b["deleted"])
		}
	}
	if len(sent) != 0 {
		t.Fatalf("%d ledger_list call(s) went for a round cut short (want none): %v", len(sent), sent)
	}
	// the round finishes: complete, the skipped ledger named, the gone ledger deleted, the read count without the skipped one
	for i := 0; i < 30 && err != nil; i++ {
		off += 2 * time.Minute
		o := off
		nowFn = func() time.Time { return time.Now().Add(o) }
		err = k.step(zz, f.port, "")
	}
	if err != nil {
		t.Fatalf("the round did not finish: %v", err)
	}
	push()
	c.mu.Lock()
	sent = append([]M{}, c.ledList...)
	c.mu.Unlock()
	if len(sent) != 1 {
		t.Fatalf("%d call(s) after the round completed", len(sent))
	}
	b := sent[0]
	if b["complete"] != true || str(b["round"]) == "" || toInt(b["rowsRead"]) != n-2 || len(arr(b["skipped"])) != 1 || len(arr(b["deleted"])) != 1 {
		t.Fatalf("the completed round: round %q complete %v rowsRead %v skipped %v deleted %v", b["round"], b["complete"], b["rowsRead"], b["skipped"], b["deleted"])
	}
	if str(at(arr(at(arr(b["deleted"]), 0)), 1)) != fmt.Sprintf("Party %05d", n) {
		t.Fatalf("deleted: %v", b["deleted"])
	}
}

// --- the measuring tool: the per-ledger items (f696..f699) only with --ledgers; one ledger ("--ledgers 696") or a range
func TestMeasureDefaultSkipsLedgers(t *testing.T) {
	for spec, want := range map[string][2]int{"": {0, 0}, "696": {696, 696}, "696-699": {696, 699}, " 7 ": {7, 7}} {
		if a, b := measureLedgerRange(spec); a != want[0] || b != want[1] {
			t.Errorf("measureLedgerRange(%q) = %d-%d, want %d-%d", spec, a, b, want[0], want[1])
		}
	}
	f := newStandTally(t)
	standBridge(t, f, `,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	r, err := runMeasure(measureOpts{company: zz})
	if err != nil {
		t.Fatal(err)
	}
	rep := str(r["report"])
	if !strings.Contains(rep, "\nf0 ") || regexp.MustCompile(`f\d+-(check|fields|opening)`).MatchString(rep) || f.n("FinComMeasureLedF") != 0 {
		t.Fatalf("the default run must measure f0 and no ledger (f<N>-...): %d ledger-field requests\n%s", f.n("FinComMeasureLedF"), rep)
	}
	if !strings.Contains(rep, "--ledgers 696") || !strings.Contains(rep, "after working hours") {
		t.Fatalf("the report does not say how to measure the ledgers after working hours:\n%s", rep)
	}
	r, err = runMeasure(measureOpts{company: zz, ledgers: "2"})
	if err != nil {
		t.Fatal(err)
	}
	rep = str(r["report"])
	if !strings.Contains(rep, "f2-fields") || !strings.Contains(rep, "f2-opening") || strings.Contains(rep, "f3-") || strings.Contains(rep, "f1-") {
		t.Fatalf("--ledgers 2 must measure ledger 2 alone:\n%s", rep)
	}
}
