package main

// Round 12 (03-Oct-2026): a whole, well-formed Day Book answer that lists NO voucher for a period whose local copy
// holds entries is not trusted. The 2.1.6 code took it as a complete read, wrote every day of the slice empty, marked
// it read in full and sent it as empty:true (which marks entries deleted in the cloud). Now such a slice fails like a
// timeout (halved, dayFail, skipped after 3 tries) and a round that read 0 entries over a copy that holds some sets
// the company's trouble and sends no read guard. A copy that holds nothing for the slice keeps the old behaviour.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// a keeper state whose round starts at from with a slice of one day
func r12State(from string) {
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	saveKeepState(dir, M{"company": zz, "from": from, "next": from, "slice": 1, "phase": "live", "months": M{}, "skipped": []any{}})
}

func r12Voucher(d string) string {
	v := &tVch{guid: "copy-1", master: "901", date: d, typ: "Journal", no: "1", narr: "kept", party: "Party X", alter: 901,
		lines: [][2]string{{"Party X", "-10.00"}, {"Sales", "10.00"}}}
	return "<TALLYMESSAGE>" + v.xml() + "</TALLYMESSAGE>"
}

func r12Keeper(id string) *keepRun {
	return &keepRun{tc: &TC{copier: true, readSec: 5}, kind: "now", force: true, told: map[string]bool{}, id: id, alter: map[string]int64{}}
}

// --- 1. the copy holds an entry for the slice; Tally lists none: nothing kept, no .full mark, nothing for the cloud,
// the slice counted as a failed try
func TestZeroEntriesSliceOnNonEmptyCopyNotKept(t *testing.T) {
	td := today()
	f := newStandTally(t) // no voucher: every Day Book answer is a whole envelope with none
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	r12State(td)
	dir := syncFolder(zz)
	text := r12Voucher(td)
	writeDayFile(dir, td, text, false)
	err := r10Round(t, r12Keeper("r12-slice"), f.port)
	if err == nil || !strings.Contains(err.Error(), "try 1 of 3") {
		t.Fatalf("the untrusted slice did not fail like a timeout: %v", err)
	}
	if got := readText(filepath.Join(dir, "days", td+".xml")); got != text {
		t.Fatalf("the day file was changed: %q", got)
	}
	if exists(dayFullMark(dir, td)) {
		t.Fatal("the day carries the full-read mark")
	}
	if strings.Contains(readText(filepath.Join(dir, "cloud-out.txt")), td) {
		t.Fatal("the day is queued for the cloud")
	}
	// the cloud push sends the copy on linking: the day may go with its own one entry, never as empty or with 0
	if e := c.dayEntries()[td]; e != nil && (e["empty"] == true || toInt(e["n"]) != 1) {
		t.Fatalf("the day went to the cloud as the untrusted answer had it: %v", e)
	}
	noEmptyDay(t, c)
	if logLines("the answer is not trusted") != 1 {
		t.Fatalf("the log says 'the answer is not trusted' %d time(s), want once", logLines("the answer is not trusted"))
	}
	if logLines("nothing kept, it is read again") != 1 || logLines("Tally listed no entries but the copy holds 1 for these days") != 1 {
		t.Fatal("the log line is not the agreed one")
	}
	st := readKeepState(dir)
	if toInt(st["dayFail"]) != 1 || str(st["roundNext"]) != td || str(st["roundAt"]) != "" {
		t.Fatalf("the slice was not counted as a failed try: %v", st)
	}
	if c.count("read_guard") != 0 {
		t.Fatal("a read guard was sent for a round that did not finish")
	}
}

// --- 1b. the copy holds nothing for the slice (a genuinely empty period, a new copy): the old behaviour, the empty
// days written, marked read in full and sent as empty:true
func TestZeroEntriesOnEmptyCopyKept(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	r12State(td)
	dir := syncFolder(zz)
	if err := r10Round(t, r12Keeper("r12-empty"), f.port); err != nil {
		t.Fatalf("an empty period on an empty copy: %v", err)
	}
	if !exists(filepath.Join(dir, "days", td+".xml")) || readText(filepath.Join(dir, "days", td+".xml")) != "" {
		t.Fatal("the empty day was not written")
	}
	if !exists(dayFullMark(dir, td)) {
		t.Fatal("the empty day read in full carries no mark")
	}
	e := c.dayEntries()[td]
	if e == nil || e["empty"] != true || toInt(e["n"]) != 0 {
		t.Fatalf("the empty day did not go as empty:true: %v", e)
	}
	if logLines("not trusted") != 0 {
		t.Fatal("an empty copy's empty answer was distrusted")
	}
	if c.count("read_guard") != 1 {
		t.Fatalf("%d read guard(s), want one", c.count("read_guard"))
	}
	if st := readKeepState(dir); st["trouble"] != nil {
		t.Fatalf("trouble set on a good round: %v", st["trouble"])
	}
}

// --- 2. a round that read 0 entries while the copy holds some (here on a day before the round's period): no read
// guard (a 0 would be recorded as a real read), the trouble set, the log line
func TestZeroRoundNoReadGuardAndTrouble(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	r12State(td)
	dir := syncFolder(zz)
	old := "20250115"
	writeDayFile(dir, old, r12Voucher(old), true)
	if err := r10Round(t, r12Keeper("r12-round"), f.port); err != nil {
		t.Fatalf("the round: %v", err)
	}
	if c.count("read_guard") != 0 {
		t.Fatalf("%d read guard(s) sent for a round of 0 entries over a copy that holds some: %v", c.count("read_guard"), c.guard)
	}
	st := readKeepState(dir)
	tr := obj(st["trouble"])
	if tr == nil || !strings.Contains(str(tr["why"]), "read fault") || str(tr["at"]) == "" {
		t.Fatalf("the trouble is not set with 'read fault': %v", st["trouble"])
	}
	if logLines("the round read 0 entries but the copy holds 1: a read fault; nothing was sent as empty and the read guard is not sent") != 1 {
		t.Fatal("the log line is not there")
	}
	if got := readText(filepath.Join(dir, "days", old+".xml")); !strings.Contains(got, "<VOUCHER") {
		t.Fatal("the copy's entry was lost")
	}
}

// --- 3. answerHead: the first 200 characters of an answer, tags only, no values (no figure or name is logged)
func TestAnswerHeadTagsOnly(t *testing.T) {
	x := "<ENVELOPE>\n  <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>\n  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>" +
		`<STATICVARIABLES><SVCURRENTCOMPANY>Some Company 99</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>` +
		`<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="abc-123" VCHTYPE="Sales"><DATE>20260401</DATE><AMOUNT>1234.50</AMOUNT></VOUCHER></TALLYMESSAGE>` +
		"</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
	h := answerHead(x)
	if len(h) > 200 {
		t.Fatalf("%d characters: %q", len(h), h)
	}
	if regexp.MustCompile(`\d`).MatchString(h) {
		t.Fatalf("a figure in the head: %q", h)
	}
	for _, w := range []string{"Some Company", "All Masters", "abc", "Sales", "\n", "  "} {
		if strings.Contains(h, w) {
			t.Fatalf("%q in the head: %q", w, h)
		}
	}
	if !strings.HasPrefix(h, "<ENVELOPE><HEADER><VERSION></VERSION><STATUS></STATUS></HEADER><BODY>") {
		t.Fatalf("the tags are not kept in order: %q", h)
	}
	if answerHead("") != "" || answerHead("   plain text, no tags 42 ") != "" {
		t.Fatalf("text without tags: %q", answerHead("   plain text, no tags 42 "))
	}
	short := "<ENVELOPE><BODY></BODY></ENVELOPE>"
	if answerHead(short) != short {
		t.Fatalf("a short answer: %q", answerHead(short))
	}
	long := "<ENVELOPE>" + strings.Repeat("<A>x</A>", 100) + "</ENVELOPE>"
	if h := answerHead(long); len(h) != 200 || strings.Contains(h, "x") {
		t.Fatalf("a long answer: %d %q", len(h), h)
	}
}

// round 12 (the owner's decision, 03-Oct night): an installer built with POSTONLY="any" clears an installer-set list
// (PostOnly [] = any company) and marks it the owner's, so a later installer never puts a list back; a list set by
// hand, or already marked the owner's, is left as it is
func TestInstallPostOnlyAnyClearsInstallerList(t *testing.T) {
	c := newOrdered()
	setPostOnly(c, "ZZ TEST")
	setPostOnly(c, "any")
	if len(strs(c.Get("PostOnly"))) != 0 || str(c.Get("PostOnlyBy")) != "owner" {
		t.Fatalf("POSTONLY=any did not clear the installer-set list and mark it the owner's: %v / %v", c.Get("PostOnly"), c.Get("PostOnlyBy"))
	}
	setPostOnly(c, "ZZ TEST") // a later installer with a list: the owner's clearing stands
	if len(strs(c.Get("PostOnly"))) != 0 || str(c.Get("PostOnlyBy")) != "owner" {
		t.Fatalf("a later installer put a list back over the owner's clearing: %v", c.Get("PostOnly"))
	}
	n := newOrdered() // no PostOnly at all: "any" writes the empty list marked the owner's, so a later installer leaves it
	setPostOnly(n, " ANY ")
	if !n.Has("PostOnly") || len(strs(n.Get("PostOnly"))) != 0 || str(n.Get("PostOnlyBy")) != "owner" {
		t.Fatalf("on a fresh settings file: %v / %v", n.Get("PostOnly"), n.Get("PostOnlyBy"))
	}
	h := newOrdered()
	h.Set("PostOnly", []any{"BY HAND"})
	setPostOnly(h, "any")
	if strings.Join(strs(h.Get("PostOnly")), "|") != "BY HAND" || h.Has("PostOnlyBy") {
		t.Fatalf("a hand-set list was cleared by an installer: %v", h.Get("PostOnly"))
	}
}
