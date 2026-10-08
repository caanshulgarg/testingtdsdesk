package main

// 2.4.0 part 2 review (08-Oct-2026). M1: FinCom answers 200 for a group but 'failed' for one of its lines (a lock timeout,
// a deadlock) or no result at all for it: that line is NOT marked sent; it stays on the PC and goes again after a wait
// (RecorderRetrySec doubling, at most 30 minutes), never given up (every 30 minutes from RecorderFailedTries on); the other lines of the
// group are marked sent. FinCom's repeat check (migration 63) keeps a resend from being stored twice. L2: a line held in
// failed.txt (no day in its name) keeps the sent ids from the day it was first held, not from "00000000" (for ever).
// Written before the code.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a cloud as obCloud (each line stored once, a repeat answered "already have"), but a line of a given MasterID is
// answered 'failed' (fail) or left out of the results (missing) as many times as asked; sends counts each line's arrivals
type obFailCloud struct {
	*obCloud
	fail, missing map[string]int // MasterID -> answers still to give that way
	sends         map[string]int // MasterID -> times the line arrived
}

func obFailModel(c *standCloud) *obFailCloud {
	o := &obFailCloud{obCloud: &obCloud{stored: map[string]int{}, repeat: map[string]int{}}, fail: map[string]int{}, missing: map[string]int{}, sends: map[string]int{}}
	c.mu.Lock()
	c.recReply = func(b M) (int, M) {
		if o.down != nil && o.down(b) {
			return 500, M{"ok": false, "error": "down"}
		}
		res := []any{}
		for _, x := range arr(b["lines"]) {
			id, mid := str(obj(x)["line_id"]), str(obj(x)["master_id"])
			o.sends[mid]++
			if o.missing[mid] > 0 {
				o.missing[mid]--
				continue // no result for this line
			}
			if o.fail[mid] > 0 {
				o.fail[mid]--
				res = append(res, M{"line_id": id, "state": "failed", "why": "canceling statement due to lock timeout"})
				continue
			}
			if o.stored[id] > 0 {
				o.repeat[id]++
				res = append(res, M{"line_id": id, "state": "applied", "why": "already have this line", "already": true})
				continue
			}
			o.stored[id]++
			res = append(res, M{"line_id": id, "state": "applied", "why": nil})
		}
		return 200, M{"ok": true, "results": res}
	}
	c.mu.Unlock()
	return o
}

func liveSentHas(id string) bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	return live.sent[id]
}

// --- M1: one line of a group answered failed (a lock timeout) and one left without a result: those two stay and go again
// after the wait; the third is marked sent at once and never goes again; each entry reaches the books once
func TestOutboxFailedLineResent(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	o := obFailModel(c)
	p := liveFilePath(rec, "")
	for i := 0; i < 3; i++ {
		liveAppend(t, p, obImport(zz, 0xa0+i, "fh"+itoa(i))...)
	}
	o.fail[itoa(0xa1)] = 1
	o.missing[itoa(0xa2)] = 1
	readAndUploadAll(t)
	if o.sends[itoa(0xa0)] != 1 || o.sends[itoa(0xa1)] != 1 || o.sends[itoa(0xa2)] != 1 {
		t.Fatalf("first send: %v", o.sends)
	}
	q := liveQueue()
	if len(q) != 2 {
		t.Fatalf("the failed line and the one without a result were not kept: %d waiting (want 2)", len(q))
	}
	for _, x := range q {
		if liveSentHas(x.lineId) {
			t.Fatalf("%s is marked sent though FinCom answered failed / nothing", x.lineId)
		}
	}
	// not again at once: after the wait
	uploadAll(t)
	if o.sends[itoa(0xa1)] != 1 || o.sends[itoa(0xa2)] != 1 {
		t.Fatalf("sent again before the wait: %v", o.sends)
	}
	laterBy(t, 2*time.Minute)
	uploadAll(t)
	if len(liveQueue()) != 0 {
		t.Fatalf("after the wait: %d still waiting", len(liveQueue()))
	}
	if o.sends[itoa(0xa0)] != 1 || o.sends[itoa(0xa1)] != 2 || o.sends[itoa(0xa2)] != 2 {
		t.Fatalf("resent: %v (want the applied line once, the two others twice)", o.sends)
	}
	if len(o.stored) != 3 || len(o.repeat) != 0 {
		t.Fatalf("in the books: %d entries, %d repeats (want 3 entries, each once)", len(o.stored), len(o.repeat))
	}
	for id, n := range o.stored {
		if n != 1 {
			t.Fatalf("%s stored %d times", id, n)
		}
	}
	// a restart sends nothing again
	n := len(c.recRaw)
	liveResetState()
	readAndUploadAll(t)
	if len(c.recRaw) != n {
		t.Fatalf("lines went again after a restart (%d calls, was %d)", len(c.recRaw), n)
	}
}

// --- M1 (the coordinator, 08-Oct-2026: "nothing lost"): a line FinCom always answers failed is NEVER given up. After
// RecorderFailedTries it stays on the PC (not marked sent, its offset held), is sent again every 30 minutes and no more
// often, and the beat carries it per company: how many, since when, and the oldest one's day. A restart keeps it
func TestOutboxFailedLineKeptAtCap(t *testing.T) {
	rec, _, c := liveBridge(t, `,"RecorderFailedTries":4`)
	o := obFailModel(c)
	p := liveFilePath(rec, "")
	liveAppend(t, p, obImport(zz, 0xb0, "fi0")...)
	o.fail[itoa(0xb0)] = 1000
	readAndUploadAll(t)
	first := nowFn()
	liveAppend(t, p, obImport(zz, 0xb1, "fi1")...)
	readAndUploadAll(t)
	if o.sends[itoa(0xb1)] != 1 || len(o.stored) != 1 {
		t.Fatalf("the line after the failed one waited for it: %v", o.sends)
	}
	if b := obj(liveBeat()[zz]); toInt(b["stuck"]) != 0 {
		t.Fatalf("counted before RecorderFailedTries: %v", b)
	}
	for i := 0; i < 6; i++ {
		laterBy(t, 31*time.Minute)
		uploadAll(t)
	}
	if o.sends[itoa(0xb0)] != 7 {
		t.Fatalf("a line always failed went %d times in 6 x 31 minutes (want 7: kept, every 30 minutes at most)", o.sends[itoa(0xb0)])
	}
	q := liveQueue()
	if len(q) != 1 || liveSentHas(q[0].lineId) {
		t.Fatalf("the line was given up after RecorderFailedTries: waiting %d", len(q))
	}
	// at the cap: not more often than every 30 minutes
	laterBy(t, 10*time.Minute)
	uploadAll(t)
	laterBy(t, 10*time.Minute)
	uploadAll(t)
	if o.sends[itoa(0xb0)] != 7 {
		t.Fatalf("sent again within 30 minutes at the cap: %d", o.sends[itoa(0xb0)])
	}
	laterBy(t, 11*time.Minute)
	uploadAll(t)
	if o.sends[itoa(0xb0)] != 8 {
		t.Fatalf("not sent again after 30 minutes at the cap: %d", o.sends[itoa(0xb0)])
	}
	// the beat: one line of ZZ TEST that FinCom could not store, since the first failure, and the day of its entry
	b := obj(liveBeat()[zz])
	if toInt(b["stuck"]) != 1 || str(b["stuckSince"]) != first.In(liveZone).Format("2006-01-02T15:04:05") || str(b["stuckDay"]) == "" {
		t.Fatalf("the beat does not carry the line kept: %v", b)
	}
	if lg := readText(logFile()); !strings.Contains(lg, "could not be stored in FinCom") || strings.Contains(lg, "not sent again") {
		t.Fatalf("the log: %s", lastLines(lg, 5))
	}
	// a restart: still there, still not marked sent; once FinCom takes it, it is stored once and the beat clears
	liveResetState()
	o.fail[itoa(0xb0)] = 0
	readAndUploadAll(t)
	laterBy(t, 31*time.Minute)
	uploadAll(t)
	if len(liveQueue()) != 0 || len(o.stored) != 2 || len(o.repeat) != 0 {
		t.Fatalf("after FinCom took it: waiting %d, stored %d, repeats %d", len(liveQueue()), len(o.stored), len(o.repeat))
	}
	if b := obj(liveBeat()[zz]); toInt(b["stuck"]) != 0 {
		t.Fatalf("the beat still counts it: %v", b)
	}
}

// --- L2: a line held in failed.txt (no day in its name) keeps the sent ids from the day it was first held; the ids of
// days long before are rotated as usual (before: "00000000", every id kept for ever)
func TestOutboxFailedTxtKeepsFromItsDay(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	noteCompanyGUID(zz, b220CoGUID)
	noteCompanyGUID("ZZ OLD", b220CoGUID)
	liveSeedOwnOpen(b220CoGUID, "ZZ OLD")
	o := obModel(c)
	o.down = func(b M) bool { return str(b["company"]) == "ZZ OLD" && len(arr(b["lines"])) > 0 }
	old := filepath.Join(syncDir(), "recorder-sent", nowFn().AddDate(0, 0, -60).Format("20060102")+".txt")
	_ = os.MkdirAll(filepath.Dir(old), 0o755)
	if err := os.WriteFile(old, []byte("ancient-line-id\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	wrap := func(l string) string { return "FCR1|ev=write_failed|file=" + liveFilePath(rec, "") + "|was=" + l }
	for _, l := range append(obImport("ZZ OLD", 0xc0, "fj0"), obImport(zz, 0xc1, "fj1")...) {
		liveAppend(t, filepath.Join(rec, "failed.txt"), wrap(l))
	}
	readAndUploadAll(t)
	uploadAll(t)
	if len(o.stored) != 1 || len(liveQueue()) != 1 {
		t.Fatalf("stored %d, waiting %d (want 1 and 1)", len(o.stored), len(liveQueue()))
	}
	kf := str(readObjFile(sp("recorder-offsets.json"))["keepFrom"])
	if kf != nowFn().Format("20060102") {
		t.Fatalf("keepFrom %q (want the day the failed.txt line was first held, %s)", kf, nowFn().Format("20060102"))
	}
	var sent string
	for id := range o.stored {
		sent = id
	}
	// days later, a restart: the line sent behind the held one is still known as sent; the ids of 60 days ago are gone
	laterBy(t, 3*24*time.Hour)
	liveResetState()
	if !liveSentHas(sent) {
		t.Fatal("the line sent behind the held failed.txt line is no longer known as sent")
	}
	if liveSentHas("ancient-line-id") {
		t.Fatal("sent ids of 60 days ago kept while a failed.txt line waits (keepFrom \"00000000\": for ever)")
	}
	if kf := str(readObjFile(sp("recorder-offsets.json"))["keepFrom"]); kf == "00000000" {
		t.Fatal("keepFrom is 00000000")
	}
}
