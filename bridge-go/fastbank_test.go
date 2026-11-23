package main

// Fast bank posting (23-Nov-2026, the owner: "please make bank entries fast.. this is too slow"). A Tally whose every
// import costs ~4.5 s whatever its size (a fixed cost a request) was sent bank lines one a request: 674 lines, ~78
// minutes. The owner then: "tally should not freeze at all". Bank lines on such a Tally now go in bigger parts (10 at
// most, PostQuietBankMax) only while nobody has touched the keyboard or mouse for PostQuietSec (30 s); while someone
// is active a part is never bigger than the old pace gives (one voucher on such a Tally), and nothing waits (postings
// first). Each quiet request PostSlowMaxMs (8 s) at most; a Tally whose time grows with each voucher is paced as before.
// Made-up data.

import (
	"fmt"
	"math"
	"testing"
)

func fastBankVch(prefix string, n int) []M {
	var out []M
	for i := 0; i < n; i++ {
		x := "<VOUCHER VCHTYPE=\"Payment\" ACTION=\"Create\"><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><NARRATION>ZZ TEST LINE " +
			fmt.Sprint(i) + "</NARRATION></VOUCHER>"
		out = append(out, M{"id": fmt.Sprintf("%s%04d", prefix, i), "xml": x, "bank": true})
	}
	return out
}

// runs a queue against a stand Tally of secs(n) a request: the part sizes and the total Tally time
func fastBankRun(t *testing.T, q *postQueue, secs func(n int) float64) (sizes []int, total float64) {
	t.Helper()
	for i := 0; q.left() && i < 2000; i++ {
		r := q.next()
		n := len(r.items)
		s := secs(n)
		sizes = append(sizes, n)
		total += s
		q.done(r, s, nil)
	}
	return
}

// the person's state for the queue (the tests' hook): quiet true, nobody at the keyboard for PostQuietSec
func fastBankQuiet(t *testing.T, quiet bool) {
	t.Helper()
	old := postQuietFn
	postQuietFn = func() bool { return quiet }
	t.Cleanup(func() { postQuietFn = old })
}

func TestFastBankFixedCostTally(t *testing.T) {
	reviewPaceStart(t, "")
	fastBankQuiet(t, true)
	// the slow Tally of the report: 4.5 s a request + 0.1 s a voucher (one voucher 4.6 s)
	slow := func(n int) float64 { return 4.5 + 0.1*float64(n) }
	q := newPostQueueFor("ZZ SLOWREQ CO", "g-slow-1", nil, fastBankVch("sb", 674))
	sizes, total := fastBankRun(t, q, slow)
	if q.left() {
		t.Fatal("the queue did not end")
	}
	prev, most := 0, 0
	for i, n := range sizes {
		if n > postBatchBank() {
			t.Fatalf("part %d: %d bank lines, over PostBatchBank %d", i+1, n, postBatchBank())
		}
		if prev > 0 && n > 2*prev {
			t.Fatalf("part %d more than doubled: %d after %d", i+1, n, prev)
		}
		if slow(n) > 8.0+1e-9 {
			t.Fatalf("part %d: %d lines, %.1f s at Tally, over the 8 s most a request", i+1, n, slow(n))
		}
		prev, most = n, maxI(most, n)
	}
	if most < 8 || most > 10 {
		t.Fatalf("a fixed-cost Tally's quiet bank parts: at most %d (want 8-10; sizes %v)", most, fastBankHead(sizes))
	}
	if len(sizes) > 75 {
		t.Fatalf("674 bank lines took %d requests (want 75 at most)", len(sizes))
	}
	if one := 674 * slow(1); total > one/4 {
		t.Fatalf("Tally time %.0f s, not under a quarter of one a request (%.0f s)", total, one)
	}
	// the next job of the company starts at the size learned, not at 1
	postPaceFlush()
	postPaceReset()
	if n := len(newPostQueueFor("ZZ SLOWREQ CO", "g-slow-1", nil, fastBankVch("sc", 100)).next().items); n < 8 {
		t.Fatalf("the next job's first part: %d (want the learned size)", n)
	}
}

// a company whose kept record is 1 a part at ~4.5 s (as 2.5.18 left it): the parts grow again within a few parts
func TestFastBankEscapesOneAPart(t *testing.T) {
	reviewPaceStart(t, "")
	fastBankQuiet(t, true)
	key := companyKey("ZZ STUCK CO") + "|g-stuck"
	for i := 0; i < 20; i++ {
		postPaceNote(key, true, 4500, 4500, 1)
	}
	q := newPostQueueFor("ZZ STUCK CO", "g-stuck", nil, fastBankVch("st", 200))
	sizes, _ := fastBankRun(t, q, func(n int) float64 { return 4.4 + 0.08*float64(n) })
	if len(sizes) < 5 || sizes[4] < 8 {
		t.Fatalf("still about one a part: %v", fastBankHead(sizes))
	}
}

// a Tally whose time is all a voucher's own (2.5 s each, no fixed cost): bigger parts save nothing, so after one
// probe of 2 the parts stay one each, as before
func TestFastBankPerVoucherTallyUnchanged(t *testing.T) {
	reviewPaceStart(t, "")
	fastBankQuiet(t, true)
	q := newPostQueueFor("ZZ LINEAR CO", "g-lin", nil, fastBankVch("ln", 30))
	sizes, _ := fastBankRun(t, q, func(n int) float64 { return 2.5 * float64(n) })
	for i, n := range sizes {
		if n > 2 || (i >= 3 && n != 1) {
			t.Fatalf("a per-voucher Tally got parts %v", fastBankHead(sizes))
		}
	}
	// a fast Tally (20 ms a line): under the 1350 ms target as before
	q = newPostQueueFor("ZZ FAST CO", "g-fast", nil, fastBankVch("fs", 400))
	sizes, _ = fastBankRun(t, q, func(n int) float64 { return 0.02 * float64(n) })
	for _, n := range sizes {
		if float64(n)*0.02 > 1.35+1e-9 {
			t.Fatalf("a fast Tally's part predicted over the target: %d", n)
		}
	}
}

// bills on a fixed-cost Tally stay as before (one each): only bank lines are sent in bigger parts
func TestFastBankBillsUnchanged(t *testing.T) {
	reviewPaceStart(t, "")
	fastBankQuiet(t, true)
	q := newPostQueueFor("ZZ SLOWREQ BILLS", "g-sbl", nil, reviewVch("bl", 12, 600))
	sizes, _ := fastBankRun(t, q, func(n int) float64 { return 4.5 + 0.1*float64(n) })
	for i, n := range sizes {
		if i > 0 && n != 1 {
			t.Fatalf("bills on a slow Tally: %v", sizes)
		}
	}
}

// the most a slow request may take: PostSlowMaxMs, 8000 by default, held to 2000..10000
func TestFastBankSlowMaxHeld(t *testing.T) {
	reviewPaceStart(t, "")
	if v := postSlowMaxSec(); math.Abs(v-8) > 1e-9 {
		t.Fatalf("default %v", v)
	}
	setCfg("PostSlowMaxMs", 60000)
	t.Cleanup(func() { setCfg("PostSlowMaxMs", nil) })
	if v := postSlowMaxSec(); math.Abs(v-10) > 1e-9 {
		t.Fatalf("60000 not held to 10 s: %v", v)
	}
	setCfg("PostSlowMaxMs", 500)
	if v := postSlowMaxSec(); math.Abs(v-2) > 1e-9 {
		t.Fatalf("500 not held to 2 s: %v", v)
	}
}

func fastBankHead(s []int) []int {
	if len(s) > 40 {
		return s[:40]
	}
	return s
}

// someone active at the computer (or the tray not reporting): the parts stay what one voucher costs, and still go (no
// wait: postings first); quiet again: they grow back; active again mid-job: the very next part is one voucher
func TestFastBankActivePersonOneVoucher(t *testing.T) {
	reviewPaceStart(t, "")
	quiet := false
	old := postQuietFn
	postQuietFn = func() bool { return quiet }
	t.Cleanup(func() { postQuietFn = old })
	slow := func(n int) float64 { return 4.5 + 0.1*float64(n) }
	q := newPostQueueFor("ZZ BUSY CO", "g-busy", nil, fastBankVch("bz", 120))
	var sizes []int
	step := func() int {
		r := q.next()
		n := len(r.items)
		sizes = append(sizes, n)
		q.done(r, slow(n), nil)
		return n
	}
	for i := 0; i < 12; i++ {
		if n := step(); i > 0 && slow(n) > slow(1)+1e-9 {
			t.Fatalf("someone active: a part of %d (%.1f s), longer than one voucher (sizes %v)", n, slow(n), sizes)
		}
	}
	quiet = true
	most := 0
	for i := 0; i < 8; i++ {
		most = maxI(most, step())
	}
	if most < 8 {
		t.Fatalf("quiet again: parts did not grow (sizes %v)", sizes)
	}
	quiet = false
	if n := step(); n != 1 {
		t.Fatalf("active again mid-job: the next part held %d (sizes %v)", n, sizes)
	}
}

// the quiet signal: PostQuietSec (30 by default, 5..600) without a key or click anywhere, and the tray reporting
func TestFastBankQuietSignal(t *testing.T) {
	reviewPaceStart(t, "")
	if postQuietSec() != 30 {
		t.Fatalf("PostQuietSec default %v", postQuietSec())
	}
	setCfg("PostQuietSec", 1)
	t.Cleanup(func() { setCfg("PostQuietSec", nil) })
	if postQuietSec() != 5 {
		t.Fatalf("PostQuietSec 1 not held to 5: %v", postQuietSec())
	}
	setCfg("PostQuietSec", nil)
	oi, ou := postIdleFn, postUnknownFn
	t.Cleanup(func() { postIdleFn, postUnknownFn = oi, ou })
	idle, unknown := 12.0, false
	postIdleFn = func() float64 { return idle }
	postUnknownFn = func() bool { return unknown }
	if postQuiet() {
		t.Fatal("12 s idle taken as quiet")
	}
	idle = 45
	if !postQuiet() {
		t.Fatal("45 s idle not taken as quiet")
	}
	unknown = true
	if postQuiet() {
		t.Fatal("the tray not reporting taken as quiet")
	}
}
