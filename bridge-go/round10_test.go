package main

// Round 10 (03-Oct-2026), the owner's gap 2: FinCom marks a day's entries deleted only when the bridge POSITIVELY says
// the day is empty. Per day the "days" upload carries n (vouchers read) and empty:true only when the Day Book answer
// for that day came in full (a well-formed Tally answer, no timeout, no decode stop, no self-watch stop, the company's
// GUID the one held) and listed no voucher. A day whose read failed in any way is not sent at all and is read again.

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// every day entry the fake cloud received, by day
func (c *standCloud) dayEntries() map[string]M {
	c.mu.Lock()
	defer c.mu.Unlock()
	o := map[string]M{}
	for _, b := range c.dayPosts {
		for _, x := range arr(b["days"]) {
			d := obj(x)
			o[str(d["day"])] = d
		}
	}
	return o
}

// one keeper driven step by step (no worker, no backoff waits): the first error, or nil when the round finished; then
// the cloud push
func r10Round(t *testing.T, k *keepRun, port int) error {
	t.Helper()
	k.caughtUp = false
	var err error
	for i := 0; i < 20 && !k.caughtUp && err == nil; i++ {
		err = k.step(zz, port, "")
	}
	invokeCloudPush()
	return err
}

func noEmptyDay(t *testing.T, c *standCloud) {
	t.Helper()
	for d, e := range c.dayEntries() {
		if e["empty"] == true {
			t.Fatalf("the day %s went as empty:true: %v", d, e)
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, l := range c.ledList {
		if _, has := l["empty"]; has {
			t.Fatalf("the ledger list carries an empty flag: %v", l)
		}
	}
}

// --- an empty day answered in full: empty:true, n 0; a day with entries: n = their count, no empty flag
func TestEmptyDayAnsweredInFull(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	f.add(td, "Party X", "1", "sale", "-100.00")
	f.add(td, "Party X", "2", "sale", "-200.00")
	standBridge(t, f, c.cfg())
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	from := td[:6] + "01"
	liveFrom(from)
	runNow(t, "now")
	days := c.dayEntries()
	if len(days) == 0 {
		t.Fatal("no day went to the cloud")
	}
	for d := from; d <= td; d = addDays(d, 1) {
		e := days[d]
		if e == nil {
			t.Fatalf("the day %s was not sent (a complete read sends every day)", d)
		}
		if d == td {
			if toInt(e["n"]) != 2 || e["empty"] == true || e["readFailed"] == true {
				t.Fatalf("the day with entries: %v", e)
			}
			continue
		}
		if e["empty"] != true || toInt(e["n"]) != 0 || e["readFailed"] == true {
			t.Fatalf("an empty day read in full: %v", e)
		}
	}
}

// --- the same day with a timeout: not sent (as empty or at all) and read again later; then empty:true
func TestTimedOutDayNotEmpty(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	slow := true
	f.slow = func(id, body string) time.Duration {
		if id == "Day Book" && slow {
			return 3 * time.Second
		}
		return 0
	}
	standBridge(t, f, c.cfg()+`,"TallyMaxSec":1,"TallyProbeEverySec":1`)
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td)
	k := &keepRun{tc: &TC{copier: true, readSec: 1}, kind: "now", force: true, told: map[string]bool{}, id: "r10-timeout", alter: map[string]int64{}}
	if err := r10Round(t, k, f.port); err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("the timeout: %v", err)
	}
	if len(c.dayEntries()) != 0 {
		t.Fatalf("a day Tally did not answer went to the cloud: %v", c.dayEntries())
	}
	noEmptyDay(t, c)
	if st := readKeepState(syncFolder(zz)); str(st["roundNext"]) > td || str(st["roundAt"]) != "" {
		t.Fatalf("the day is not queued to be read again: %v", st)
	}
	f.mu.Lock()
	slow = false
	f.mu.Unlock()
	var err error
	for i := 0; i < 5; i++ {
		time.Sleep(1100 * time.Millisecond) // the small check after the timeout goes first
		if err = r10Round(t, k, f.port); err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("after Tally answered again: %v", err)
	}
	e := c.dayEntries()[td]
	if e == nil || e["empty"] != true || toInt(e["n"]) != 0 {
		t.Fatalf("after Tally answered in full: %v", e)
	}
}

// --- an answer cut mid-way (the decoder stops): no day of that read is sent; read again; the log says why
func TestCutAnswerNotEmpty(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	f.add(td, "Party X", "1", "sale", "-100.00")
	cut := true
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == "Day Book" && cut {
			full := "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>"
			f.mu.Lock()
			for _, v := range f.vch {
				full += "<TALLYMESSAGE>" + v.xml() + "</TALLYMESSAGE>"
			}
			f.mu.Unlock()
			_, _ = w.Write([]byte(full[:len(full)/2])) // Tally's connection dropped half-way: no closing envelope
			return true
		}
		return false
	}
	standBridge(t, f, c.cfg()+`,"TallyMaxSec":2`)
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td[:6] + "01")
	k := &keepRun{tc: &TC{copier: true, readSec: 2}, kind: "now", force: true, told: map[string]bool{}, id: "r10-cut", alter: map[string]int64{}}
	if err := r10Round(t, k, f.port); err == nil || !strings.Contains(err.Error(), "not complete") {
		t.Fatalf("the cut answer: %v", err)
	}
	if len(c.dayEntries()) != 0 {
		t.Fatalf("days of a cut answer went to the cloud: %v", c.dayEntries())
	}
	noEmptyDay(t, c)
	if logLines("answer was not complete") < 1 {
		t.Fatal("the log does not say the answer was cut")
	}
	if st := readKeepState(syncFolder(zz)); str(st["roundAt"]) != "" {
		t.Fatalf("the round counted as finished: %v", st)
	}
	f.mu.Lock()
	cut = false
	f.mu.Unlock()
	if err := r10Round(t, k, f.port); err != nil {
		t.Fatalf("after a full answer: %v", err)
	}
	days := c.dayEntries()
	if e := days[td]; e == nil || toInt(e["n"]) != 1 || e["empty"] == true {
		t.Fatalf("after a full answer: %v", e)
	}
	if e := days[td[:6]+"01"]; td != td[:6]+"01" && (e == nil || e["empty"] != true) {
		t.Fatalf("the empty day of the full answer: %v", e)
	}
}

// --- the company in Tally is not the one held (another GUID): nothing is read, no day is sent, nothing is empty
func TestWrongCompanyNotEmpty(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	noteCompanyGUID(zz, "co-guid-OTHER")
	liveFrom(td[:6] + "01")
	runNow(t, "now")
	if len(c.dayEntries()) != 0 || f.n("Day Book") != 0 {
		t.Fatalf("a company with another GUID was read: %d day book requests, %v", f.n("Day Book"), c.dayEntries())
	}
	noEmptyDay(t, c)
	if logLines("nothing read") < 1 {
		t.Fatal("the log does not say nothing was read")
	}
}

// --- reading stopped (2.3.1: only the owner's stop from FinCom; the bridge never stops itself) while a day was being read:
// the day is not taken as read, not sent, not empty; nothing in any payload says empty:true
func TestSelfStopDayNotEmpty(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	f.slow = func(id, body string) time.Duration {
		if id == "Day Book" {
			setReadStop("fincom", "Stopped by the owner from FinCom") // FinCom's answer arriving while the day is read
			return 1500 * time.Millisecond
		}
		return 0
	}
	standBridge(t, f, c.cfg()+`,"SelfStopSec":1,"TallyMaxSec":5`)
	oldDaysOn() // the owner's rule of 04-Oct-2026 turns reading old days off (ReadDays); the round's day logic is still tested here
	liveFrom(td)
	k := &keepRun{tc: &TC{copier: true, readSec: 5}, kind: "now", force: true, told: map[string]bool{}, id: "r10-selfstop", alter: map[string]int64{}}
	err := r10Round(t, k, f.port)
	if st := readStop(); st == nil || str(st["by"]) != "fincom" {
		t.Fatalf("not stopped: %v (%v)", st, err)
	}
	if err == nil || !strings.Contains(err.Error(), "stopped") {
		t.Fatalf("the read under the stop did not fail: %v", err)
	}
	if len(c.dayEntries()) != 0 {
		t.Fatalf("a day read under a stop went to the cloud: %v", c.dayEntries())
	}
	noEmptyDay(t, c)
	if st := readKeepState(syncFolder(zz)); str(st["roundAt"]) != "" || str(st["roundNext"]) > td {
		t.Fatalf("the day counted as read: %v", st)
	}
	if logLines("reading was stopped on this computer while it was read") < 1 {
		t.Fatal("the stop is not logged with the read")
	}
}
