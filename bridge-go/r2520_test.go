package main

// bridge 2.5.20 (the owner's decisions of 23-Nov-2026, ~20:10 IST, and the request for reading on by default):
//   P1. post_ok "unsure" (FinCom could not confirm in time): asked again 3 times about 10 s apart, nothing sent
//       meanwhile; still unsure: stopped as before. Any other stop is a stop at once.
//   P2. a reply Tally made only partly (some created or excepted, with errors or line errors): only that part is read
//       back by FinComTag (the request the posting check already uses; no new request XML), the part's dates only:
//       found = posted (in Tally); not found with Tally's error = refused, off this computer's record, may go again;
//       the rest of the part is not held for review.
//   P3. a posting taken from FinCom's queue still waiting here for Tally is reported again every 20 minutes even when
//       nothing changed, so FinCom never puts it back as "no word for 2 hours" and its words are the bridge's own.
//   R.  ReadDays on by default: a settings file without ReadDays reads days; ReadDays false (a person's) stays off.
import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const r2520Unsure = "FinCom could not confirm in time that this posting may be sent now, so nothing more is sent now."

// the read back after a reply Tally made partly, off for a test of what stays needs review (readBackMaxDays 0)
func noReadBack(t *testing.T) {
	t.Helper()
	was := readBackMaxDays
	readBackMaxDays = 0
	t.Cleanup(func() { readBackMaxDays = was })
}

func r2520Fast(t *testing.T) {
	t.Helper()
	was := postOKUnsureWait
	postOKUnsureWait = 50 * time.Millisecond
	t.Cleanup(func() { postOKUnsureWait = was })
}

// P1: unsure twice, then go: nothing sent between the answers, every part sent after
func TestR2520UnsureAskedAgainThenGoes(t *testing.T) {
	f, c := r2515QueueBridge(t)
	r2520Fast(t)
	var mu sync.Mutex
	n, importsAtUnsure := 0, []int{}
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k != "post_ok" {
			return 200, M{"ok": true}
		}
		mu.Lock()
		defer mu.Unlock()
		n++
		if n <= 2 {
			importsAtUnsure = append(importsAtUnsure, f.n("Import"))
			return 200, M{"ok": true, "post": false, "stop": "checking", "error": r2520Unsure}
		}
		return 200, M{"ok": true, "post": true}
	}
	c.mu.Unlock()
	r2515Take(t, c, "job-r2520-unsure", 2)
	p := r2515JobEnd(t, "job-r2520-unsure")
	mu.Lock()
	defer mu.Unlock()
	if str(p["status"]) != "done" || f.n("Import") != 2 {
		t.Fatalf("unsure twice, then yes: %s %q, %d imports", p["status"], p["message"], f.n("Import"))
	}
	if n != 4 || len(importsAtUnsure) != 2 || importsAtUnsure[0] != 0 || importsAtUnsure[1] != 0 {
		t.Fatalf("asked %d times (want 3 before part 1, 1 before part 2); imports at the unsure answers %v", n, importsAtUnsure)
	}
	if logLines("FinCom could not confirm in time before part 1 of 2; asked again") < 1 {
		t.Fatal("the asking again is not logged")
	}
}

// P1: still unsure after 3 more asks: stopped as before (4 asks, nothing sent)
func TestR2520UnsureThreeTimesStops(t *testing.T) {
	f, c := r2515QueueBridge(t)
	r2520Fast(t)
	var mu sync.Mutex
	n := 0
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			mu.Lock()
			n++
			mu.Unlock()
			return 200, M{"ok": true, "post": false, "stop": "checking", "error": r2520Unsure}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	r2515Take(t, c, "job-r2520-unsure3", 2)
	p := r2515JobEnd(t, "job-r2520-unsure3")
	mu.Lock()
	defer mu.Unlock()
	if str(p["status"]) != "stopped" || f.n("Import") != 0 || n != 4 || !strings.Contains(str(p["message"]), "could not confirm in time") {
		t.Fatalf("always unsure: %s %q, %d imports, asked %d times", p["status"], p["message"], f.n("Import"), n)
	}
}

// P1: any other stop (here held for checking with other words) stops at once: asked once
func TestR2520OtherStopAtOnce(t *testing.T) {
	f, c := r2515QueueBridge(t)
	r2520Fast(t)
	var mu sync.Mutex
	n := 0
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "post_ok" {
			mu.Lock()
			n++
			mu.Unlock()
			return 200, M{"ok": true, "post": false, "stop": "checking", "error": "This posting is held for checking in FinCom; nothing more is sent until an owner settles it."}
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	r2515Take(t, c, "job-r2520-held", 2)
	p := r2515JobEnd(t, "job-r2520-held")
	mu.Lock()
	defer mu.Unlock()
	if str(p["status"]) != "stopped" || f.n("Import") != 0 || n != 1 {
		t.Fatalf("held for checking: %s, %d imports, asked %d times (want once)", p["status"], f.n("Import"), n)
	}
}

// P2: Tally made 2 of 3 (ERRORS 1): the part read back by FinComTag; the two found are in Tally, the one not found is
// refused by Tally, off the record, and goes again on a retry
func TestR2520MixedReplyReadBack(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:mx3") }
	standBridge(t, f, `,"PostPaceOff":true`)
	p := r15Job(t, "job-r2520-mixed", r15Bills("mx", td, 3))
	rs := r15Results(p)
	for _, id := range []string{"mx1", "mx2"} {
		r := rs[id]
		if r["ok"] != true || r["verified"] != true || r["needsReview"] == true || itemState(r, false) != "in_tally" || str(r["guid"]) == "" {
			t.Fatalf("%s, found by its FinCom tag: %v", id, r)
		}
		if a := acceptedInfo(id); a == nil || a["sent"] != true {
			t.Fatalf("%s is not on the record as sent: %v", id, a)
		}
	}
	r := rs["mx3"]
	if r["ok"] != false || r["accepted"] != false || r["needsReview"] == true || r["refusedByTally"] != true || itemState(r, false) != "failed" {
		t.Fatalf("mx3, not found, Tally's error: %v", r)
	}
	if acceptedInfo("mx3") != nil {
		t.Fatal("mx3 Tally did not make stays on the record (it could never go again)")
	}
	if n := f.n("FinComTag"); n != 1 {
		t.Fatalf("the read back: %d FinComTag requests (want 1: the part's one date)", n)
	}
	if !strings.HasPrefix(str(p["message"]), "Posted 2 of 3") {
		t.Fatalf("the job's line: %q", p["message"])
	}
	// a retry: only mx3 goes again (mx1, mx2 refused on the record)
	f.mu.Lock()
	f.importSkip = nil
	f.mu.Unlock()
	p = r15Job(t, "job-r2520-mixed-2", r15Bills("mx", td, 3))
	if r := r15Results(p)["mx3"]; r["ok"] != true || f.n("Import") != 2 {
		t.Fatalf("the retry: mx3 %v, %d imports", r, f.n("Import"))
	}
	if logLines("read back by FinComTag after a reply Tally made only partly: 2 found, 1 not found") != 1 {
		t.Fatal("the read back is not logged")
	}
}

// P2: Tally's read back not answered: as before (every entry of the part needs review, all on the record)
func TestR2520ReadBackNoAnswerAsBefore(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:mn3") }
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != "FinComTag" {
			return false
		}
		_, _ = w.Write([]byte("<ENVELOPE>not an answer"))
		return true
	}
	standBridge(t, f, `,"PostPaceOff":true`)
	p := r15Job(t, "job-r2520-noread", r15Bills("mn", td, 3))
	for id, r := range r15Results(p) {
		if r["needsReview"] != true || r["accepted"] != true || acceptedInfo(id) == nil {
			t.Fatalf("%s with no read back: %v", id, r)
		}
	}
}

// P2: Tally says it made 2 but only 1 is found: nothing is judged "not in Tally" (needs review, on the record)
func TestR2520FewerFoundThanMade(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:ff3") }
	f.storeNarr = func(n string) string { return strings.ReplaceAll(n, "TDSDesk:ff2", "changed") } // Tally kept ff2 without its mark
	standBridge(t, f, `,"PostPaceOff":true`)
	p := r15Job(t, "job-r2520-fewer", r15Bills("ff", td, 3))
	rs := r15Results(p)
	if r := rs["ff1"]; r["ok"] != true || r["verified"] != true {
		t.Fatalf("ff1 found: %v", r)
	}
	for _, id := range []string{"ff2", "ff3"} {
		if r := rs[id]; r["needsReview"] != true || r["accepted"] != true || acceptedInfo(id) == nil {
			t.Fatalf("%s (2 made, 1 found): %v", id, r)
		}
	}
}

// P2: an exception in the reply: an entry not found is never called refused (needs review, on the record)
func TestR2520ExceptionNotJudged(t *testing.T) {
	f := newStandTally(t)
	f.behave = importReply("<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><EXCEPTIONS>1</EXCEPTIONS></IMPORTRESULT></DATA></BODY></ENVELOPE>")
	standBridge(t, f, `,"PostPaceOff":true`)
	x := finVoucher("ex1", fgParty, "EX-1", today(), "1.00")
	r := postOne(t, "ex1", x)
	if r["needsReview"] != true || r["accepted"] != true || r["refusedByTally"] == true || acceptedInfo(acceptedKey("ex1", x)) == nil {
		t.Fatalf("an exception, not found: %v", r)
	}
}

// P2: only a part Tally made partly is read back: a whole reply reads nothing
func TestR2520WholeReplyNoReadBack(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"PostPaceOff":true`)
	_ = r15Job(t, "job-r2520-whole", r15Bills("wh", today(), 3))
	onlyPostingRequests(t, f, 0)
}

// P3: a posting from FinCom's queue waiting here for Tally (Tally closed): reported again after postStillEvery even
// with nothing changed; not before
func TestR2520WaitingReportedAgain(t *testing.T) {
	f, c := r2515QueueBridge(t)
	f.srv.Close() // Tally closed
	was := postStillEvery
	postStillEvery = time.Hour
	t.Cleanup(func() { postStillEvery = was })
	r2515Take(t, c, "job-r2520-wait", 1)
	t.Cleanup(func() { // (its worker ends before the test's settings go, also when the test fails: no log in the package folder)
		_, _ = cancelJob("job-r2520-wait", "test over")
		_ = r2515JobEnd(t, "job-r2520-wait")
	})
	dir, _ := jobDir("job-r2520-wait")
	for i := 0; i < 200 && str(readProgress(dir)["status"]) != "waiting"; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if st := str(readProgress(dir)["status"]); st != "waiting" {
		t.Fatalf("the posting is not waiting for Tally: %s", st)
	}
	sync := func() { cloudPostAt = time.Time{}; syncCloudPosts() } // (CloudPostSyncSec 0 reads as its 3 s default)
	postsDirty.Store(true)
	sync()
	count := func() int {
		c.mu.Lock()
		defer c.mu.Unlock()
		n := 0
		for _, b := range c.posts {
			if str(b["id"]) == "job-r2520-wait" {
				n++
			}
		}
		return n
	}
	n0 := count()
	sync()
	if count() != n0 {
		t.Fatal("reported again with nothing changed before postStillEvery")
	}
	postStillEvery = 0
	sync()
	c.mu.Lock()
	last := c.posts[len(c.posts)-1]
	c.mu.Unlock()
	if count() != n0+1 || str(last["status"]) != "taken" || !strings.HasPrefix(str(last["message"]), "Waiting for Tally: ") || !strings.HasSuffix(str(last["message"]), str(readProgress(dir)["message"])) {
		t.Fatalf("not reported again as taken with its own words: %d -> %d, %s %q", n0, count(), last["status"], last["message"])
	}
}

// R: ReadDays on by default (no ReadDays, or null); any value a person wrote read as before (false, 0, "" off; true on)
func TestR2520ReadDaysDefaultOn(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	cfgMu.Lock()
	Cfg.Delete("ReadDays")
	cfgMu.Unlock()
	if !readDaysOn() {
		t.Fatal("no ReadDays in the settings: reading is off (want on by default)")
	}
	for _, c := range []struct {
		v    any
		want bool
	}{{false, false}, {float64(0), false}, {"", false}, {true, true}, {nil, true}} {
		setCfg("ReadDays", c.v)
		if readDaysOn() != c.want {
			t.Errorf("ReadDays %#v: on %v, want %v", c.v, readDaysOn(), c.want)
		}
	}
	setCfg("ReadDays", false)
	// the default is never written into the settings file (a later default still applies to a file that never chose)
	if defaultSettings().Has("ReadDays") {
		t.Fatal("ReadDays written into the standard settings")
	}
}

// A1 (review of 2.5.20): the default (no ReadDays, or null) turns on only the background day rounds, under the 2 s stop.
// FinCom's direct reads (/vouchers, /daybook, /ledgerlines, /tags, /keepcheck, /readtest) and every other dated request
// stay refused exactly as before 2.5.20 unless ReadDays is literally true
func TestR2520DirectReadsOnlyWhenReadDaysTrue(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.add(td, fgParty, "DR-1", "sale", "-1.00")
	standBridge(t, f, `,"Key":"tray-test-key"`)
	_ = findCompanyPortQuiet(zz)
	co := strings.ReplaceAll(zz, " ", "%20")
	routes := []string{
		"/vouchers?company=" + co + "&from=" + td + "&to=" + td,
		"/daybook?company=" + co + "&from=" + td + "&to=" + td,
		"/tags?company=" + co + "&from=" + td + "&to=" + td,
		"/keepcheck?company=" + co + "&ym=" + td[:6],
		"/readtest?company=" + co,
	}
	round := ledgerTC(&TC{copier: true})
	round.dayRound = true
	for _, c := range []struct {
		name         string
		set          func()
		rounds, read bool
	}{
		{"none", func() { cfgMu.Lock(); Cfg.Delete("ReadDays"); cfgMu.Unlock() }, true, false},
		{"null", func() { setCfg("ReadDays", nil) }, true, false},
		{"true", func() { setCfg("ReadDays", true) }, true, true},
		{"false", func() { setCfg("ReadDays", false) }, false, false},
	} {
		c.set()
		if readDaysOn() != c.rounds {
			t.Errorf("ReadDays %s: day rounds on %v, want %v", c.name, readDaysOn(), c.rounds)
		}
		if got := readsOffErr() == nil; got != c.read {
			t.Errorf("ReadDays %s: direct reads allowed %v, want %v", c.name, got, c.read)
		}
		for _, p := range routes {
			n0 := r19Count(f)
			code, res := callLocal(t, "GET", p, "", "")
			refused := code == 409 && str(res["error"]) == readsOffWords
			if !c.read && (!refused || r19Count(f) != n0) {
				t.Errorf("ReadDays %s: %s not refused as before (%d %v, %d sent)", c.name, p, code, res, r19Count(f)-n0)
			}
			if c.read && refused {
				t.Errorf("ReadDays %s: %s refused", c.name, p)
			}
		}
		// /ledgerlines: from the copy only, never Tally, unless literally true
		n0 := r19Count(f)
		_, res := callLocal(t, "GET", "/ledgerlines?company="+co+"&ledger=X%20Ledger&from="+td+"&to="+td, "", "")
		if !c.read && (res["readDays"] != false || r19Count(f) != n0) {
			t.Errorf("ReadDays %s: /ledgerlines asked Tally (%v, %d sent)", c.name, res, r19Count(f)-n0)
		}
		// a dated request with no 2 s stop (a direct read's TC) is refused unless literally true
		if _, err := invokeTally(fin, f.port, dayBookRequest(zz, td, td), 10); (err == nil) != c.read {
			t.Errorf("ReadDays %s: Day Book without the 2 s stop: %v", c.name, err)
		}
		// the measuring tool's dated items as before (only with ReadDays true or --old-days)
		if (measureDatedTC(measureOpts{}) != nil) != c.read {
			t.Errorf("ReadDays %s: the measuring tool's dated items", c.name)
		}
		// the background day round's own request, under the 2 s stop: goes unless ReadDays is off
		if _, err := invokeTally(round, f.port, dayBookRequest(zz, td, td), 10); (err == nil) != c.rounds {
			t.Errorf("ReadDays %s: the day round's Day Book: %v", c.name, err)
		}
		// the day round's mark without its 2 s stop is not a day round
		loose := *round
		loose.limitMs = 0
		if _, err := invokeTally(&loose, f.port, dayBookRequest(zz, td, td), 10); (err == nil) != c.read {
			t.Errorf("ReadDays %s: a day-round request without the 2 s stop: %v", c.name, err)
		}
	}
	setCfg("ReadDays", false)
}

// A2 (review of 2.5.20): the read back after a reply Tally made partly skips cancelled and optional entries, in the
// matching and in the count, as the look before a re-sent entry does (resentLookFirst): a cancelled (or optional) earlier
// copy carrying the mark of the entry Tally refused never makes it "posted"; that entry is refused by Tally and goes again
func TestR2520ReadBackSkipsCancelledAndOptional(t *testing.T) {
	for _, c := range []struct{ prefix, how string }{{"cx", "cancelled"}, {"ox", "optional"}} {
		t.Run(c.how, func(t *testing.T) {
			td := today()
			f := newStandTally(t)
			old := f.add(td, fgParty, "OLD-2", "Electricity | TDSDesk:"+c.prefix+"2", "2.00")
			old.cancelled, old.optional = c.how == "cancelled", c.how == "optional"
			f.importSkip = func(x string) bool { return strings.Contains(x, "TDSDesk:"+c.prefix+"2") }
			standBridge(t, f, `,"PostPaceOff":true`)
			p := r15Job(t, "job-r2520-"+c.prefix, r15Bills(c.prefix, td, 2))
			rs := r15Results(p)
			if r := rs[c.prefix+"1"]; r["ok"] != true || r["verified"] != true {
				t.Fatalf("%s1 made by Tally: %v", c.prefix, r)
			}
			r := rs[c.prefix+"2"]
			if r["ok"] != false || r["refusedByTally"] != true || r["needsReview"] == true || str(r["guid"]) == old.guid {
				t.Fatalf("%s2, refused by Tally, a %s earlier copy holds its mark: %v", c.prefix, c.how, r)
			}
			if acceptedInfo(c.prefix+"2") != nil {
				t.Fatalf("%s2 stays on the record (it could never go again)", c.prefix)
			}
			f.mu.Lock()
			f.importSkip = nil
			f.mu.Unlock()
			p = r15Job(t, "job-r2520-"+c.prefix+"-2", r15Bills(c.prefix, td, 2))
			if r := r15Results(p)[c.prefix+"2"]; r["ok"] != true || f.n("Import") != 2 {
				t.Fatalf("the retry: %s2 %v, %d imports", c.prefix, r, f.n("Import"))
			}
		})
	}
}

// P1 (review of 2.5.20): after the wait for FinCom's answer (about 30 s), the job looks again at a cancel or the bridge
// stopping, and at the company's lease (taken again when it ran low), before the part goes
func TestR2520UnsureWaitThenLooksAgain(t *testing.T) {
	t.Run("cancelled", func(t *testing.T) {
		f, c := r2515QueueBridge(t)
		r2520Fast(t)
		n := 0
		c.mu.Lock()
		c.other = func(k string, b M) (int, M) {
			if k != "post_ok" {
				return 200, M{"ok": true}
			}
			n++
			if n == 1 {
				dir, _ := jobDir("job-r2520-uc")
				_ = os.WriteFile(filepath.Join(dir, "cancel"), []byte("x"), 0o644) // cancelled in FinCom while it waits
				return 200, M{"ok": true, "post": false, "stop": "checking", "error": r2520Unsure}
			}
			return 200, M{"ok": true, "post": true}
		}
		c.mu.Unlock()
		r2515Take(t, c, "job-r2520-uc", 1)
		p := r2515JobEnd(t, "job-r2520-uc")
		if str(p["status"]) != "cancelled" || f.n("Import") != 0 {
			t.Fatalf("cancelled during the wait: %s %q, %d imports", p["status"], p["message"], f.n("Import"))
		}
	})
	t.Run("lease", func(t *testing.T) {
		f, c := r2515QueueBridge(t)
		r2520Fast(t)
		n := 0
		var atImport []string
		f.mu.Lock()
		f.slow = func(id, body string) time.Duration {
			if id == "Import" && atImport == nil {
				c.mu.Lock()
				atImport = append([]string{}, c.kinds...)
				c.mu.Unlock()
			}
			return 0
		}
		f.mu.Unlock()
		c.mu.Lock()
		c.other = func(k string, b M) (int, M) {
			if k != "post_ok" {
				return 200, M{"ok": true}
			}
			n++
			if n == 1 {
				leaseMu.Lock()
				leases[zz] = time.Now() // the lease ran out while FinCom was slow
				leaseMu.Unlock()
				return 200, M{"ok": true, "post": false, "stop": "checking", "error": r2520Unsure}
			}
			return 200, M{"ok": true, "post": true}
		}
		c.mu.Unlock()
		r2515Take(t, c, "job-r2520-ul", 1)
		p := r2515JobEnd(t, "job-r2520-ul")
		if str(p["status"]) != "done" || f.n("Import") != 1 {
			t.Fatalf("after the wait: %s %q, %d imports", p["status"], p["message"], f.n("Import"))
		}
		last := -1
		for i, k := range atImport {
			if k == "post_ok" {
				last = i
			}
		}
		taken := false
		for _, k := range atImport[last+1:] {
			taken = taken || k == "lease_take"
		}
		if last < 0 || !taken {
			t.Fatalf("the lease not taken again after the wait, before the part went: %v", atImport)
		}
	})
}
