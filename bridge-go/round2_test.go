package main

// Round 2 and 3 (02-Oct-2026, the owner's answers): the beat says whether the allow-list is measured; every ledger_list
// call carries its round id, whether the round was complete, the count of GUIDs read and the GUIDs themselves (seen),
// from which the cloud works deletions out; the measuring tool runs the per-ledger items (696-699) only when asked.

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

// --- every ledger_list call of a round: the same round id, complete true, rowsRead = the whole list, and seen: the
// GUIDs read, split across the batches (at most 2,000 each, none twice), their union the whole list. No deleted field:
// the cloud works deletions out from seen. A round with no changed rows still sends ceil(n/2000) batches of seen
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
	all := map[string]bool{}
	for i := 1; i <= n; i++ {
		all[fmt.Sprintf("led-%d", i)] = true
	}
	checkRound := func(got []M, want map[string]bool) {
		t.Helper()
		union := map[string]bool{}
		for i, b := range got {
			if str(b["round"]) != str(got[0]["round"]) {
				t.Fatalf("call %d has round %q, call 0 %q", i, b["round"], got[0]["round"])
			}
			if b["complete"] != true {
				t.Fatalf("call %d: complete %v", i, b["complete"])
			}
			if toInt(b["rowsRead"]) != len(want) {
				t.Fatalf("call %d: rowsRead %v, want %d (the whole list read, not the rows in this batch)", i, b["rowsRead"], len(want))
			}
			if _, has := b["deleted"]; has {
				t.Fatalf("call %d carries deleted %v: the cloud works deletions out from seen", i, b["deleted"])
			}
			if (b["last"] == true) != (i == len(got)-1) {
				t.Fatalf("call %d: last %v", i, b["last"])
			}
			seen := strs(b["seen"])
			if len(seen) == 0 || len(seen) > 2000 {
				t.Fatalf("call %d: %d seen (want 1 to 2,000)", i, len(seen))
			}
			for _, g := range seen {
				if union[g] {
					t.Fatalf("call %d: %s seen twice in the round", i, g)
				}
				if !want[g] {
					t.Fatalf("call %d: %s seen but not in Tally's list", i, g)
				}
				union[g] = true
			}
		}
		if len(union) != len(want) {
			t.Fatalf("%d GUIDs seen across the batches, want %d (every GUID read)", len(union), len(want))
		}
	}
	checkRound(got, all)
	rows := 0
	for _, b := range got {
		rows += len(arr(b["ledgers"]))
	}
	if rows != n {
		t.Fatalf("%d rows in the first round, want %d", rows, n)
	}
	// the next round: a new id; one ledger gone and nothing changed: three batches of seen with no rows, without it
	f.mu.Lock()
	f.led = f.led[1:]
	f.mu.Unlock()
	delete(all, "led-1")
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
	if len(got) != 3 || str(got[0]["round"]) == round || str(got[0]["round"]) == "" {
		t.Fatalf("the second round: %d call(s) (want 3 of seen alone): %v", len(got), got)
	}
	checkRound(got, all)
	for i, b := range got {
		if len(arr(b["ledgers"])) != 0 {
			t.Fatalf("call %d of the second round carries %d rows (nothing changed)", i, len(arr(b["ledgers"])))
		}
	}
}

// --- a round cut short (a chunk that does not answer): nothing of it goes to the cloud (no batch, no seen); once the
// round completes (the ledger that hangs isolated and skipped) the list goes as complete, naming it, with the gone
// ledger missing from seen
func TestIncompleteRoundSendsNothing(t *testing.T) {
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
	// the outbox names the skipped ledger, but the round is not complete: nothing goes
	push()
	c.mu.Lock()
	sent := append([]M{}, c.ledList...)
	c.mu.Unlock()
	if len(sent) != 0 {
		t.Fatalf("%d ledger_list call(s) went for a round cut short (want none): %v", len(sent), sent)
	}
	// the round finishes: complete, the skipped ledger named and in seen, the gone one not; rowsRead counts the skipped one
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
	if _, has := b["deleted"]; has {
		t.Fatalf("deleted sent: %v", b["deleted"])
	}
	seen := map[string]bool{}
	for _, g := range strs(b["seen"]) {
		seen[g] = true
	}
	if b["complete"] != true || str(b["round"]) == "" || toInt(b["rowsRead"]) != n-1 || len(arr(b["skipped"])) != 1 || len(seen) != n-1 {
		t.Fatalf("the completed round: round %q complete %v rowsRead %v skipped %v seen %d", b["round"], b["complete"], b["rowsRead"], b["skipped"], len(seen))
	}
	if !seen[fmt.Sprintf("led-%d", poison)] || seen[fmt.Sprintf("led-%d", n)] {
		t.Fatalf("seen must hold the skipped ledger's GUID and not the gone one's: %v", b["seen"])
	}
}

// --- a ledger that hangs Tally is skipped, not gone: its GUID (from the list held) is in seen and counted in rowsRead,
// so the cloud never marks it deleted
func TestPoisonGuidInSeen(t *testing.T) {
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
	c.ledList = nil
	c.mu.Unlock()
	dir := syncFolder(zz)
	f.mu.Lock()
	f.behave = poisonLedger(poison)
	f.mu.Unlock()
	off := time.Duration(0)
	k := newRun("now", "poison")
	var err error
	for i := 0; i < 30; i++ {
		if err = k.step(zz, f.port, ""); err == nil {
			break
		}
		off += 2 * time.Minute
		o := off
		nowFn = func() time.Time { return time.Now().Add(o) }
	}
	defer func() { nowFn = time.Now }()
	if err != nil {
		t.Fatalf("the round did not finish: %v", err)
	}
	if p := poisonMids(readKeepState(dir)); len(p) != 1 || p[0] != poison {
		t.Fatalf("the ledger that hangs: %v", readKeepState(dir)["ledPoison"])
	}
	push()
	c.mu.Lock()
	sent := append([]M{}, c.ledList...)
	c.mu.Unlock()
	if len(sent) != 1 {
		t.Fatalf("%d call(s) for the round with the skipped ledger", len(sent))
	}
	b := sent[0]
	seen := strs(b["seen"])
	found := false
	for _, g := range seen {
		if g == fmt.Sprintf("led-%d", poison) {
			found = true
		}
	}
	if !found || len(seen) != n || toInt(b["rowsRead"]) != n {
		t.Fatalf("the skipped ledger's GUID must be in seen (%d seen, rowsRead %v, found %v)", len(seen), b["rowsRead"], found)
	}
	if _, has := b["deleted"]; has {
		t.Fatalf("deleted sent: %v", b["deleted"])
	}
	if ls := loadLedList(dir); len(ls) != n {
		t.Fatalf("%d ledgers held (the skipped one stays held)", len(ls))
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
