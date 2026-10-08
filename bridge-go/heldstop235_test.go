package main

// 2.3.5: the add-on's lines saved while reading from Tally is stopped from FinCom (the owner's read stop), found 08-Oct-2026
// with a stand-in test:
//  1. a delete held because this bridge's Tally could not be asked (the stop, Tally not answering, no starting point yet)
//     kept no GUID: after the stop lifted and Tally proved it gone, it went with "deleted in Tally; FinCom could not tell
//     which entry". The line's own GUID is now kept through the hold (the held list, a restart too) and the proven
//     delete goes with it; a delete is still never sent unproven (review H1), and never without a GUID: a line whose
//     GUID nobody knows stays held with the Day Book words;
//  2. the held lines said "waiting: Tally busy; FinCom asks again at …": they now say reading is stopped from FinCom,
//     and the words go when it is resumed (the ":resolved" lines carry none);
//  3. a fetch the stop refused (nothing sent to Tally) counted as a try (freshTries 1): it no longer does; a timeout, a
//     2 s stop, an empty answer or a closed connection still count.

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

const hs235Words = "waiting: reading from Tally is stopped from FinCom; asked again when it is resumed"

type hs235 struct {
	rec              string
	f                *standTally
	c                *standCloud
	td               string
	vNew, vAlt, vDel *tVch
	preAlt           int64
	base             time.Time
}

// three entries saved in Tally: one created, one altered (a higher AlterID), one deleted (gone from this Tally unless
// keepDel: then still there, as when it was deleted in another user's copy of the company)
func hs235Bridge(t *testing.T, extra string, keepDel bool) *hs235 {
	t.Helper()
	rec, f, c := liveBridge(t, extra)
	h := &hs235{rec: rec, f: f, c: c, td: today(), base: time.Now()}
	old := nowFn
	t.Cleanup(func() { nowFn = old })
	f.alter = 10
	noteStartPoint(zz, b220CoGUID, 5, 1)
	h.vNew = f.add(h.td, "Party A", "PA-1", "rent", "-12.00")
	h.vAlt = f.add(h.td, "Party B", "PB-1", "fees", "-5.00")
	h.vDel = f.add(h.td, "Party C", "PC-1", "gone", "-7.00")
	h.preAlt = h.vAlt.alter
	f.mu.Lock()
	f.alter++
	h.vAlt.alter, h.vAlt.narr = f.alter, "fees 2"
	if !keepDel {
		var keep []*tVch
		for _, v := range f.vch {
			if v != h.vDel {
				keep = append(keep, v)
			}
		}
		f.vch = keep
	}
	f.mu.Unlock()
	return h
}

func (h *hs235) stop(t *testing.T) {
	t.Helper()
	h.c.mu.Lock()
	h.c.beatReply = M{"readStop": M{"by": "fincom", "reason": "Stopped by the owner from FinCom", "at": "2026-10-08T10:00:00"}}
	h.c.mu.Unlock()
	beatOnce()
	if st := readStop(); st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("the stop was not taken: %v", st)
	}
}

func (h *hs235) lift(t *testing.T) {
	t.Helper()
	h.c.mu.Lock()
	h.c.beatReply = M{"readStop": nil}
	h.c.mu.Unlock()
	beatOnce()
	if st := readStop(); st != nil {
		t.Fatalf("the stop was not lifted: %v", st)
	}
}

// the add-on's lines of the three saves (the delete with its own GUID, as the add-on gives it on an older Tally)
func (h *hs235) write(t *testing.T) {
	t.Helper()
	td := h.td
	liveAppend(t, liveFilePath(h.rec, ""),
		liveLine("voucher_accept_pre", "Voucher", "", "", "", "Journal", "PA-1", td, "", "", "rent"),
		liveLine("voucher_accept_post", "Voucher", h.vNew.guid, h.vNew.master, fmt.Sprint(h.vNew.alter), "Journal", "PA-1", td, "", "", "rent"),
		liveLine("voucher_accept_pre", "Voucher", h.vAlt.guid, h.vAlt.master, fmt.Sprint(h.preAlt), "Journal", "PB-1", td, "", "", "fees"),
		liveLine("voucher_accept_post", "Voucher", h.vAlt.guid, h.vAlt.master, fmt.Sprint(h.vAlt.alter), "Journal", "PB-1", td, "", "", "fees 2"),
		liveLine("before_delete", "Voucher", h.vDel.guid, h.vDel.master, fmt.Sprint(h.vDel.alter), "Journal", "PC-1", td, "", "", "gone"),
		liveLine("after_delete", "Voucher", h.vDel.guid, h.vDel.master, fmt.Sprint(h.vDel.alter), "Journal", "PC-1", td, "", "", "gone"))
}

// the recorder's loop until n lines are in the cloud (5 s at most)
func (h *hs235) drain(t *testing.T, n int) {
	t.Helper()
	t0 := time.Now()
	for time.Since(t0) < 5*time.Second {
		liveReadOnce()
		for i := 0; i < 20 && liveUploadOnce() > 0; i++ {
		}
		if len(h.c.recSent()) >= n {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%d line(s) in the cloud, %d wanted: %v", len(h.c.recSent()), n, h.c.recSent())
}

// the recorder's turns with the clock moved on by add (the held list's spacing passed)
func (h *hs235) turns(add time.Duration) {
	at := h.base.Add(add)
	nowFn = func() time.Time { return at }
	retryDue()
	for i := 0; i < 6; i++ {
		liveReadOnce()
		for j := 0; j < 20 && liveUploadOnce() > 0; j++ {
		}
	}
}

func (h *hs235) entryAsks() int { return h.f.n(vchObjectID) + h.f.n(vchByNumberID) }

func hs235First(sent []M, ev string, resolved bool) M {
	for _, m := range sent {
		if str(m["event"]) == ev && strings.HasSuffix(str(m["line_id"]), ":resolved") == resolved {
			return m
		}
	}
	return nil
}

// the owner's condition (2.3.5): no delete / cancel ever leaves this bridge as one without its GUID. A line with no
// object_guid goes held (heldWhy, FinCom keeps it held: the Day Book words), and a line held for its proof (guidHeld)
// never carries a GUID
func hs235NoBareDelete(t *testing.T, sent []M) {
	t.Helper()
	for _, m := range sent {
		ev := str(m["event"])
		if ev != "deleted" && ev != "cancelled" {
			continue
		}
		g, why := str(m["object_guid"]), str(m["heldWhy"])
		if g == "" && why == "" {
			t.Errorf("a %s went without its GUID and not held: %v", ev, m)
		}
		if truthy(m["guidHeld"]) && g != "" {
			t.Errorf("a %s held for its proof carries a GUID: %v", ev, m)
		}
	}
}

func hs235Held(t *testing.T, id string) heldLine {
	t.Helper()
	h, ok := slowHeldItem(t, id)
	if !ok {
		t.Fatalf("line %s is not in the held list", id)
	}
	return h
}

// --- 1 and 2: created, altered and deleted while stopped: nothing asked of Tally, each up held at once with the stop's
// words; after the lift all three settle: the two bodies, and the delete proven gone here with its own GUID
func TestHeldStop235CreateAlterDeleteSettleAfterLift(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	if n := h.entryAsks(); n != 0 {
		t.Fatalf("Tally was asked for an entry while reading is stopped: %v", h.f.ids())
	}
	sent := h.c.recSent()
	for _, ev := range []string{"created", "altered", "deleted"} {
		m := hs235First(sent, ev, false)
		if m == nil {
			t.Fatalf("no %s line while stopped: %v", ev, sent)
		}
		if str(m["xml"]) != "" || str(m["object_guid"]) != "" || str(m["heldWhy"]) == "" {
			t.Fatalf("%s while stopped: not held without its body and GUID: %v", ev, m)
		}
	}
	del := hs235First(sent, "deleted", false)
	if !truthy(del["guidHeld"]) {
		t.Fatalf("the delete was not held for its proof: %v", del)
	}
	// the line's own GUID is kept through the hold (the held list), so the delete can go with it once proven
	if hd := hs235Held(t, str(del["line_id"])); hd.KeepGuid != h.vDel.guid || hd.Final || hd.MID != h.vDel.master {
		t.Fatalf("the held delete lost its GUID (or is not asked again): %+v", hd)
	}
	// later turns while still stopped: still nothing asked, nothing more sent
	h.turns(15 * time.Minute)
	if n := h.entryAsks(); n != 0 {
		t.Fatalf("asked while still stopped: %v", h.f.ids())
	}
	n0 := len(h.c.recSent())

	h.lift(t)
	h.turns(16 * time.Minute)
	h.turns(30 * time.Minute)
	after := h.c.recSent()[n0:]
	cr, al, dl := hs235First(after, "created", true), hs235First(after, "altered", true), hs235First(after, "deleted", true)
	if cr == nil || str(cr["xml"]) == "" || str(cr["object_guid"]) != h.vNew.guid || str(cr["heldWhy"]) != "" {
		t.Fatalf("the new entry did not settle with its body: %v\nall: %v", cr, after)
	}
	if al == nil || str(al["xml"]) == "" || str(al["object_guid"]) != h.vAlt.guid || fmt.Sprint(al["alter_id"]) != fmt.Sprint(h.vAlt.alter) || str(al["heldWhy"]) != "" {
		t.Fatalf("the altered entry did not settle with its body: %v\nall: %v", al, after)
	}
	if dl == nil || str(dl["object_guid"]) != h.vDel.guid || str(dl["heldWhy"]) != "" || truthy(dl["guidHeld"]) || fmt.Sprint(dl["master_id"]) != h.vDel.master {
		t.Fatalf("the delete did not go with its own GUID once proven gone: %v\nall: %v\n%s", dl, after, cutTail(readText(logFile()), 3000))
	}
	if !logHas("delete of mid " + h.vDel.master + ": GUID from the line (gone from this Tally): " + h.vDel.guid) {
		t.Fatalf("the GUID's source is not in the log:\n%s", cutTail(readText(logFile()), 3000))
	}
	hs235NoBareDelete(t, h.c.recSent())
	_, items := liveHeldLoad()
	if len(items) != 0 {
		t.Fatalf("lines left held after they settled: %v", items)
	}
}

func logHas(s string) bool { return strings.Contains(readText(logFile()), s) }

// --- 1 (review H1 kept): deleted in another copy of the company while stopped: after the lift this bridge's Tally still
// has it: held for good, never sent as a delete, and its GUID never sent
func TestHeldStop235DeleteStillInTallyStaysHeld(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, true)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	n0 := len(h.c.recSent())
	h.lift(t)
	h.turns(16 * time.Minute)
	h.turns(30 * time.Minute)
	for _, m := range h.c.recSent()[n0:] {
		if str(m["event"]) == "deleted" && (str(m["object_guid"]) != "" || str(m["heldWhy"]) == "") {
			t.Fatalf("a delete still in this Tally went as a delete: %v", m)
		}
	}
	id := str(hs235First(h.c.recSent(), "deleted", false)["line_id"])
	if hd := hs235Held(t, id); !hd.Final || !strings.Contains(hd.Why, liveDeleteHeldWords) {
		t.Fatalf("not held for good as not deleted here: %+v", hd)
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// --- 1: a restart while the delete is held (the bridge's memory gone, the held list on disk): the GUID comes back
// from the held list, and the delete goes with it after the lift
func TestHeldStop235DeleteGuidSurvivesRestart(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	n0 := len(h.c.recSent())
	liveResetState() // the bridge restarts: its state is read again from the sync folder
	liveSeedOwnOpen(b220CoGUID, zz)
	h.lift(t)
	h.turns(16 * time.Minute)
	h.turns(30 * time.Minute)
	dl := hs235First(h.c.recSent()[n0:], "deleted", true)
	if dl == nil || str(dl["object_guid"]) != h.vDel.guid || str(dl["heldWhy"]) != "" {
		t.Fatalf("after a restart the delete did not go with its GUID: %v", dl)
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// Tally drops the connection of every entry request (no answer)
func hs235Drop(w http.ResponseWriter, r *http.Request, id, body string) bool {
	if id != vchObjectID {
		return false
	}
	if hj, ok := w.(http.Hijacker); ok {
		if conn, _, err := hj.Hijack(); err == nil {
			conn.Close()
		}
	}
	return true
}

// --- 1: Tally not answering (not the stop) at the delete's first ask: held with its GUID kept; Tally answers later and
// proves it gone: it goes with its GUID. Then the delete whose GUID nobody knows (a real TallyPrime 7.1's line has
// none, and the bridge's record has no entry): held with the Day Book words, never sent as a delete. (A 2 s stop of
// the delete's own request ends it held for good, 2.3.4 option (a): TestHeldStop235DeleteEndsHeldNeverBare)
func TestHeldStop235DeleteNotAnsweredThenProven(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.f.mu.Lock()
	h.f.behave = hs235Drop
	h.f.mu.Unlock()
	td := h.td
	liveAppend(t, liveFilePath(h.rec, ""),
		liveLine("after_delete", "Voucher", h.vDel.guid, h.vDel.master, fmt.Sprint(h.vDel.alter), "Journal", "PC-1", td, "", "", "gone"))
	h.drain(t, 1)
	del := hs235First(h.c.recSent(), "deleted", false)
	if del == nil || !truthy(del["guidHeld"]) || str(del["object_guid"]) != "" {
		t.Fatalf("the delete Tally did not answer for was not held: %v", del)
	}
	if hd := hs235Held(t, str(del["line_id"])); hd.KeepGuid != h.vDel.guid {
		t.Fatalf("the held delete lost its GUID: %+v", hd)
	}
	h.f.mu.Lock()
	h.f.behave = nil
	h.f.mu.Unlock()
	n0 := len(h.c.recSent())
	h.turns(16 * time.Minute)
	dl := hs235First(h.c.recSent()[n0:], "deleted", true)
	if dl == nil || str(dl["object_guid"]) != h.vDel.guid || str(dl["heldWhy"]) != "" {
		t.Fatalf("the delete did not go with its GUID once Tally answered: %v\n%s", dl, cutTail(readText(logFile()), 3000))
	}
	// no GUID anywhere: proven gone, but which entry is not known: held with the Day Book words
	gone := h.f.add(td, "Party D", "PD-1", "gone too", "-3.00")
	h.f.mu.Lock()
	h.f.vch = h.f.vch[:len(h.f.vch)-1]
	h.f.mu.Unlock()
	n1 := len(h.c.recSent())
	liveAppend(t, liveFilePath(h.rec, ""),
		liveLine("after_delete", "Voucher", "", gone.master, "", "Journal", "PD-1", td, "", "", "gone too"))
	h.drain(t, n1+1)
	for _, m := range h.c.recSent()[n1:] {
		if str(m["event"]) == "deleted" && (str(m["object_guid"]) != "" || !strings.Contains(str(m["heldWhy"]), "Day Book")) {
			t.Fatalf("a delete nobody knows the GUID of was not held with the Day Book words: %v", m)
		}
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// --- 1: a held delete that ends (its ask used, or 7 days in the list) never goes as a delete without its GUID
func TestHeldStop235DeleteEndsHeldNeverBare(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2,"RecorderLimitMs":200`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	h.lift(t)
	// Tally stops at 2 s on every ask now: each held line uses its ask(s) and ends with the Day Book words
	h.f.mu.Lock()
	h.f.slow = func(id, body string) time.Duration {
		if id == vchObjectID {
			return 400 * time.Millisecond
		}
		return 0
	}
	h.f.mu.Unlock()
	for i := 1; i <= 6; i++ {
		h.turns(time.Duration(i*16) * time.Minute)
	}
	if e := hs235First(h.c.recSent(), "deleted", true); e == nil || str(e["object_guid"]) != "" || !strings.Contains(str(e["heldWhy"]), "Day Book") || !truthy(e["guidHeld"]) {
		t.Fatalf("the held delete did not end held with the Day Book words: %v\nall: %v", e, h.c.recSent())
	}
	hs235NoBareDelete(t, h.c.recSent())
	// 7 days in the list: dropped, nothing sent as a delete
	h.f.mu.Lock()
	h.f.slow = nil
	h.f.mu.Unlock()
	heldMu.Lock()
	all, items := liveHeldLoad()
	old := h.base.Add(-8 * 24 * time.Hour).Format(time.RFC3339)
	items["hs235-old-del"] = heldLine{V234: true, ID: "hs235-old-del", Company: zz, CGUID: b220CoGUID, Type: "Journal", No: "PC-9", Date: h.td, MID: "99",
		At: old, Added: old, Ev: "deleted", Why: liveDeleteUnprovenWords, KeepGuid: "co-guid-1-00000063"}
	liveHeldSave(all, items)
	heldMu.Unlock()
	n0 := len(h.c.recSent())
	h.turns(200 * time.Minute)
	for _, m := range h.c.recSent()[n0:] {
		if strings.HasPrefix(str(m["line_id"]), "hs235-old-del") {
			t.Fatalf("a held delete 8 days old was sent: %v", m)
		}
	}
	if _, had := slowHeldItem(t, "hs235-old-del"); had {
		t.Fatal("a held delete 8 days old was kept")
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// --- 2: the words while stopped say so; no "Tally busy", no time; the delete says the same inside its own words
func TestHeldStop235Wording(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	for _, m := range h.c.recSent() {
		w := str(m["heldWhy"])
		if strings.Contains(w, "Tally busy") || strings.Contains(w, "FinCom asks again at") {
			t.Errorf("%s: the words do not say reading is stopped from FinCom: %q", str(m["event"]), w)
		}
		switch str(m["event"]) {
		case "created", "altered":
			if w != hs235Words {
				t.Errorf("%s: %q, want %q", str(m["event"]), w, hs235Words)
			}
		case "deleted":
			if !strings.Contains(w, "("+hs235Words+")") {
				t.Errorf("deleted: %q does not carry %q", w, hs235Words)
			}
		}
	}
	// resumed: the lines settle and carry no waiting words any more
	n0 := len(h.c.recSent())
	h.lift(t)
	h.turns(16 * time.Minute)
	for _, m := range h.c.recSent()[n0:] {
		if w := str(m["heldWhy"]); w != "" {
			t.Errorf("%s after the resume still held: %q", str(m["event"]), w)
		}
	}
	if len(h.c.recSent()) < n0+3 {
		t.Fatalf("not all settled after the resume: %v", h.c.recSent()[n0:])
	}
}

// --- 2 and 3: a new entry with no MasterID on its line (asked by its type and number) while stopped: the same words,
// not counted
func TestHeldStop235ByNumberWhileStopped(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2,"RecorderNumberWaitMs":0`, false)
	h.stop(t)
	liveAppend(t, liveFilePath(h.rec, ""),
		liveLine("voucher_accept_post", "Voucher", "", "", "", "Journal", "PA-1", h.td, "", "", "rent"))
	h.drain(t, 1)
	m := hs235First(h.c.recSent(), "created", false)
	if w := str(m["heldWhy"]); w != hs235Words {
		t.Fatalf("by number while stopped: %q, want %q", w, hs235Words)
	}
	if hd := hs235Held(t, str(m["line_id"])); hd.FreshTries != 0 || hd.allow() != 2 || hd.Final {
		t.Fatalf("the refused ask was counted: %+v", hd)
	}
	if h.entryAsks() != 0 {
		t.Fatalf("asked while stopped: %v", h.f.ids())
	}
}

// --- 3: a fetch the stop refused is not a try: its first fetch and its one ask again are both still there
func TestHeldStop235RefusedFetchNotATry(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	for _, ev := range []string{"created", "altered"} {
		hd := hs235Held(t, str(hs235First(h.c.recSent(), ev, false)["line_id"]))
		if hd.FreshTries != 0 || hd.allow() != 2 || hd.Asked != 0 || !hd.Fresh {
			t.Errorf("%s: the refused fetch counted as a try: %+v", ev, hd)
		}
	}
}

// --- 3: only the stop's own refusal (nothing sent) is exempt: a 2 s stop, a closed connection, an empty answer still count
func TestHeldStop235RealFailuresStillCount(t *testing.T) {
	for _, tc := range []struct {
		name  string
		extra string
		set   func(f *standTally)
	}{
		{"2 s stop", `,"RecorderLimitMs":200`, func(f *standTally) {
			f.slow = func(id, body string) time.Duration {
				if id == vchObjectID {
					return 400 * time.Millisecond
				}
				return 0
			}
		}},
		{"connection closed", "", func(f *standTally) { f.behave = hs235Drop }},
		{"empty answer", "", func(f *standTally) { f.vch = nil }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := hs235Bridge(t, `,"RecorderBodySec":2`+tc.extra, false)
			h.f.mu.Lock()
			tc.set(h.f)
			h.f.mu.Unlock()
			liveAppend(t, liveFilePath(h.rec, ""),
				liveLine("voucher_accept_post", "Voucher", h.vNew.guid, h.vNew.master, fmt.Sprint(h.vNew.alter), "Journal", "PA-1", h.td, "", "", "rent"))
			h.drain(t, 1)
			if h.f.n(vchObjectID) == 0 {
				t.Fatalf("Tally was not asked: %v", h.f.ids())
			}
			m := h.c.recSent()[0] // a lone post line goes as altered
			if w := str(m["heldWhy"]); w == "" || strings.Contains(w, "stopped from FinCom") {
				t.Fatalf("held with the wrong words: %q", w)
			}
			if tc.name == "2 s stop" {
				// 2.3.4, the owner's answer B (08-Oct-2026, merged from next-fastfetch; option (a) before): held with "FinCom asks
				// once more", the stopped ask counted as one of its two fast asks (liveObjAsksMax), its one more ask due
				hd, had := slowHeldItem(t, str(m["line_id"]))
				if !had || !strings.Contains(str(m["heldWhy"]), "FinCom asks once more") || hd.ObjAsks != 1 || !hd.StopWait {
					t.Fatalf("a 2 s stop was not counted as a fast ask: %v (in the held list: %v, %+v)", m, had, hd)
				}
				return
			}
			hd := hs235Held(t, str(m["line_id"]))
			if hd.allow() != 1 || (hd.Fresh && hd.FreshTries != 1) {
				t.Fatalf("the failed ask was not counted: %+v", hd)
			}
		})
	}
}

// --- 3: the exemption is the stop's refusal alone, and only when nothing reached Tally
func TestHeldStop235OnlyTheStopsRefusalIsExempt(t *testing.T) {
	stopErr := fmt.Errorf("%w on this computer from FinCom (x, y); nothing was sent to Tally", errReadStopped)
	if !liveStopRefused(stopErr, false) {
		t.Fatal("the stop's refusal is not exempt")
	}
	if !liveStopRefused(fmt.Errorf("fetch: %w", stopErr), false) {
		t.Fatal("the stop's refusal, wrapped, is not exempt")
	}
	if liveStopRefused(stopErr, true) {
		t.Fatal("a refusal after a request reached Tally is exempt")
	}
	for _, err := range []error{nil, errTimeout, errClosed, errRecorderStop, errBackoff, errors.New("Reading from Tally is stopped (a look-alike)"),
		errors.New("No connection could be made because the target machine actively refused it")} {
		if liveStopRefused(err, false) {
			t.Errorf("exempt: %v", err)
		}
	}
}

// --- review L1 (the words' promise, "asked again when it is resumed"): a held delete, and lines whose ask again the stop
// refused, are asked at the first turn after the resume, not after the held list's 10-minute spacing; no try is spent
func TestHeldStop235AskedAtOnceAfterResume(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	// the resolver's turns while stopped: every ask refused (nothing sent to Tally)
	h.turns(15 * time.Minute)
	if n := h.entryAsks(); n != 0 {
		t.Fatalf("asked while stopped: %v", h.f.ids())
	}
	for _, ev := range []string{"created", "altered", "deleted"} {
		if hd := hs235Held(t, str(hs235First(h.c.recSent(), ev, false)["line_id"])); hd.Asked != 0 || hd.Tries != 0 || hd.FreshTries != 0 {
			t.Fatalf("%s: a refused ask was counted: %+v", ev, hd)
		}
	}
	n0 := len(h.c.recSent())
	h.lift(t)
	h.turns(15*time.Minute + 30*time.Second) // the first turn after the resume: well inside the 10-minute spacing
	after := h.c.recSent()[n0:]
	for _, ev := range []string{"created", "altered", "deleted"} {
		m := hs235First(after, ev, true)
		if m == nil || str(m["heldWhy"]) != "" || str(m["object_guid"]) == "" {
			t.Fatalf("%s not settled at the first turn after the resume: %v\nall: %v\n%s", ev, m, after, cutTail(readText(logFile()), 2500))
		}
	}
	if dl := hs235First(after, "deleted", true); str(dl["object_guid"]) != h.vDel.guid {
		t.Fatalf("the delete went without its own GUID: %v", dl)
	}
	hs235NoBareDelete(t, h.c.recSent())
}

// --- review L2: a read stop longer than 7 days never drops the held lines silently (FinCom shows them waiting): they are
// kept while the stop is on, and settle after the resume (the delete with its GUID)
func TestHeldStop235KeptOverSevenDaysWhileStopped(t *testing.T) {
	h := hs235Bridge(t, `,"RecorderBodySec":2`, false)
	h.stop(t)
	h.write(t)
	h.drain(t, 3)
	n0 := len(h.c.recSent())
	h.turns(8 * 24 * time.Hour)
	h.turns(15 * 24 * time.Hour)
	if _, items := liveHeldLoad(); len(items) != 3 {
		t.Fatalf("held lines dropped during a long stop: %d left: %v", len(items), items)
	}
	if s := h.c.recSent()[n0:]; len(s) != 0 {
		t.Fatalf("sent while stopped: %v", s)
	}
	h.lift(t)
	h.turns(15*24*time.Hour + time.Minute)
	after := h.c.recSent()[n0:]
	for _, ev := range []string{"created", "altered", "deleted"} {
		if m := hs235First(after, ev, true); m == nil || str(m["heldWhy"]) != "" || str(m["object_guid"]) == "" {
			t.Fatalf("%s did not settle after a long stop: %v\nall: %v", ev, m, after)
		}
	}
	if dl := hs235First(after, "deleted", true); str(dl["object_guid"]) != h.vDel.guid {
		t.Fatalf("the delete went without its own GUID: %v", dl)
	}
	hs235NoBareDelete(t, h.c.recSent())
}
