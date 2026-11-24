package main

// next-bridge-reupload (24-Nov-2026, the owner's rule: an entry that is not really in the books never counts as posted).
// A sales invoice was posted as an Optional voucher, deleted in Tally, then posted again: this computer's record of what
// it sent (posted-ids.json) refused it without looking in Tally, and a look before a re-sent entry took an Optional
// voucher for the entry. Now an entry handed with lookFirst (a person's "Not in Tally? Check and post again") is looked
// for in Tally first (FinComTag for its date, the approved look under the 2 s stop) and goes again when Tally has no
// regular entry with its mark or of its type and number; and /lookone answers whether Tally has it.

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// the stand Tally's entries carrying the mark
func reupTagged(f *standTally, tag string) []*tVch {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*tVch
	for _, v := range f.vch {
		if strings.Contains(v.narr, tag) {
			out = append(out, v)
		}
	}
	return out
}

func reupSet(t *testing.T, f *standTally, tag string, set func(v *tVch)) {
	t.Helper()
	vs := reupTagged(f, tag)
	if len(vs) != 1 {
		t.Fatalf("%d entries carry %s in the stand Tally", len(vs), tag)
	}
	f.mu.Lock()
	set(vs[0])
	f.mu.Unlock()
}

// the entries again, handed with lookFirst (a person's "Not in Tally? Check and post again")
func reupLook(vs []any) []any {
	var out []any
	for _, v := range vs {
		o := M{}
		for k, x := range obj(v) {
			o[k] = x
		}
		o["lookFirst"] = true
		out = append(out, o)
	}
	return out
}

func reupJob(t *testing.T, job string, vs []any) M {
	t.Helper()
	if _, err := newPostJob(M{"jobId": job, "company": zz, "guid": "co-guid-1", "vouchers": vs}); err != nil {
		t.Fatal(err)
	}
	return waitJob(t, job)
}

func reupResult(t *testing.T, p M, id string) M {
	t.Helper()
	for _, r := range arr(p["results"]) {
		if o := obj(r); str(o["id"]) == id {
			return o
		}
	}
	t.Fatalf("no result for %s: %v", id, p["results"])
	return nil
}

// posted once by this computer, then changed in Tally (how), then posted again in a new job: the result and the look
func reupAgain(t *testing.T, how func(v *tVch), deleted bool) (*standTally, M, int) {
	t.Helper()
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	va := []any{M{"id": "u1", "xml": finVoucher("u1", fgParty, "U-1", td, "41.00")}}
	if r := reupResult(t, reupJob(t, "job-reup-a-0001", va), "u1"); r["ok"] != true {
		t.Fatalf("the first posting: %v", r)
	}
	if deleted {
		vs := reupTagged(f, "TDSDesk:u1")
		f.remove(vs[0])
	} else if how != nil {
		reupSet(t, f, "TDSDesk:u1", how)
	}
	n0 := f.n(tagCheckID)
	p := reupJob(t, "job-reup-b-0001", reupLook(va))
	looks := r2516Bodies(f, tagCheckID)[n0:]
	for _, b := range looks {
		if b != tagCheckRequest(zz, td) {
			t.Fatalf("the look is not FinComTag as built for the entry's date: %s", b)
		}
	}
	return f, reupResult(t, p, "u1"), len(looks)
}

// the live case: the entry was deleted in Tally; posted again, it is looked for once and sent again
func TestReupRecordDeletedSentAgain(t *testing.T) {
	f, r, looks := reupAgain(t, nil, true)
	if r["ok"] != true || r["alreadySent"] == true {
		t.Fatalf("an entry deleted in Tally was not sent again: %v", r)
	}
	if len(reupTagged(f, "TDSDesk:u1")) != 1 || looks != 1 {
		t.Fatalf("%d in Tally, %d looks", len(reupTagged(f, "TDSDesk:u1")), looks)
	}
	if logLines("not in Tally as a regular entry") == 0 {
		t.Fatal("the log does not say why it was sent again")
	}
}

// an Optional voucher carrying the mark is not the entry posted: sent again
func TestReupRecordOptionalSentAgain(t *testing.T) {
	f, r, looks := reupAgain(t, func(v *tVch) { v.optional = true }, false)
	if r["ok"] != true || r["alreadySent"] == true || looks != 1 {
		t.Fatalf("an entry Tally holds only as Optional was not sent again (%d looks): %v", looks, r)
	}
	if len(reupTagged(f, "TDSDesk:u1")) != 2 {
		t.Fatalf("%d in Tally", len(reupTagged(f, "TDSDesk:u1")))
	}
}

// a cancelled voucher carrying the mark is not the entry posted: sent again
func TestReupRecordCancelledSentAgain(t *testing.T) {
	f, r, _ := reupAgain(t, func(v *tVch) { v.cancelled = true }, false)
	if r["ok"] != true || len(reupTagged(f, "TDSDesk:u1")) != 2 {
		t.Fatalf("an entry Tally holds only as cancelled was not sent again: %v", r)
	}
}

// still in Tally as a regular entry: refused on the record as before (never sent twice), said seen in Tally
func TestReupRecordStillThereRefused(t *testing.T) {
	f, r, looks := reupAgain(t, nil, false)
	if r["ok"] == true || r["alreadySent"] != true || r["seenInTally"] != true || looks != 1 {
		t.Fatalf("an entry in Tally (%d looks): %v", looks, r)
	}
	if !strings.HasPrefix(str(r["message"]), "already sent from this computer on ") {
		t.Fatalf("the words: %v", r["message"])
	}
	if len(reupTagged(f, "TDSDesk:u1")) != 1 {
		t.Fatalf("sent twice: %d in Tally", len(reupTagged(f, "TDSDesk:u1")))
	}
}

// the look cannot be made (Tally's answer cut short): refused on the record as before, never sent on a guess
func TestReupRecordLookFailedRefused(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	va := []any{M{"id": "u2", "xml": finVoucher("u2", fgParty, "U-2", td, "42.00")}}
	reupJob(t, "job-reup-c-0001", va)
	f.remove(reupTagged(f, "TDSDesk:u2")[0])
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != tagCheckID {
			return false
		}
		_, _ = w.Write([]byte(`<ENVELOPE><BODY><DATA><COLLECTION>`))
		return true
	}
	f.mu.Unlock()
	r := reupResult(t, reupJob(t, "job-reup-c-0002", reupLook(va)), "u2")
	if r["ok"] == true || r["alreadySent"] != true || len(reupTagged(f, "TDSDesk:u2")) != 0 {
		t.Fatalf("sent without a look: %v", r)
	}
}

// the entry's date changed since it was sent: the look on the new date proves nothing; refused as before
func TestReupRecordDateChangedRefused(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	reupJob(t, "job-reup-d-0001", []any{M{"id": "u3", "xml": finVoucher("u3", fgParty, "U-3", td, "43.00")}})
	other := time.Now().AddDate(0, 0, -1).Format("20060102")
	r := reupResult(t, reupJob(t, "job-reup-d-0002", []any{M{"id": "u3", "xml": finVoucher("u3", fgParty, "U-3", other, "43.00"), "lookFirst": true}}), "u3")
	if r["ok"] == true || r["alreadySent"] != true || len(reupTagged(f, "TDSDesk:u3")) != 1 {
		t.Fatalf("an entry re-dated in FinCom: %v", r)
	}
}

// the browser's /import: the same rule
func TestReupImportDeletedSentAgain(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	x := finVoucher("u4", fgParty, "U-4", td, "44.00")
	if r := postOne(t, "u4", x); r["ok"] != true {
		t.Fatalf("the first posting: %v", r)
	}
	imp := func() M {
		t.Helper()
		res, err := invokeImport(M{"company": zz, "guid": "co-guid-1", "vouchers": []any{M{"id": "u4", "xml": x, "lookFirst": true}}})
		if err != nil {
			t.Fatal(err)
		}
		return obj(arr(res["results"])[0])
	}
	if r := imp(); r["alreadySent"] != true || r["seenInTally"] != true {
		t.Fatalf("in Tally: %v", r)
	}
	f.remove(reupTagged(f, "TDSDesk:u4")[0])
	n0 := f.n(tagCheckID)
	if r := postOne(t, "u4", x); r["alreadySent"] != true || f.n(tagCheckID) != n0 {
		t.Fatalf("without lookFirst the record is the only check, as since round 15: %v", r)
	}
	if r := imp(); r["ok"] != true {
		t.Fatalf("deleted in Tally, posted again: %v", r)
	}
	if len(reupTagged(f, "TDSDesk:u4")) != 1 {
		t.Fatalf("%d in Tally", len(reupTagged(f, "TDSDesk:u4")))
	}
}

// 2.5.19's look before a re-sent entry (released by FinCom): an Optional voucher carrying the mark is not "already posted"
func TestReupResentOptionalNotAlready(t *testing.T) {
	td := today()
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, `,"PostWaitMs":200`+c.cfg())
	v := f.add(td, fgParty, "R-91", "TDSDesk:r91 | posted as Optional, then left", "-91.00")
	v.optional = true
	p := r2519Resent(t, c, "job-reup-e-0001", "r91", finVoucher("r91", fgParty, "R-91", td, "91.00"))
	if r2519Result(p, "r91", "already") || len(reupTagged(f, "TDSDesk:r91")) != 2 {
		t.Fatalf("an Optional voucher was taken for the entry: %d in Tally, %v", len(reupTagged(f, "TDSDesk:r91")), p["results"])
	}
}

// /lookone: the one entry looked for in Tally (FinComTag for its date, under the 2 s stop): there, Optional, cancelled,
// or missing; nothing is sent, the record is not changed
func TestReupLookOne(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, "")
	ask := func(id string) M {
		t.Helper()
		n0, i0 := f.n(tagCheckID), f.n("Import")
		r, err := lookOneEntry(M{"company": zz, "guid": "co-guid-1", "id": id, "xml": finVoucher(id, fgParty, "L-"+id, td, "50.00")})
		if err != nil {
			t.Fatal(err)
		}
		if f.n(tagCheckID)-n0 != 1 || f.n("Import") != i0 {
			t.Fatalf("%s: %d looks, %d imports", id, f.n(tagCheckID)-n0, f.n("Import")-i0)
		}
		return r
	}
	f.add(td, fgParty, "L-la", "TDSDesk:la | regular", "-50.00")
	f.add(td, fgParty, "L-lb", "TDSDesk:lb | optional", "-50.00").optional = true
	f.add(td, fgParty, "L-lc", "TDSDesk:lc | cancelled", "-50.00").cancelled = true
	for id, want := range map[string]string{"la": "there", "lb": "optional", "lc": "cancelled", "ld": "missing"} {
		r := ask(id)
		if r["ok"] != true || str(r["state"]) != want || str(r["message"]) == "" {
			t.Fatalf("%s: want %s: %v", id, want, r)
		}
		if want == "there" && str(r["vchNo"]) != "L-la" {
			t.Fatalf("the entry found: %v", r)
		}
	}
	// Tally's answer cut short: unable, never "missing"
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id != tagCheckID {
			return false
		}
		_, _ = w.Write([]byte(`<ENVELOPE><BODY><DATA><COLLECTION>`))
		return true
	}
	f.mu.Unlock()
	if r := ask("ld"); r["ok"] == true || str(r["state"]) != "unable" {
		t.Fatalf("a look that failed: %v", r)
	}
	// no FinCom mark or date to look for: unable, nothing asked
	if r, err := lookOneEntry(M{"company": zz, "guid": "co-guid-1", "id": "", "xml": "<VOUCHER></VOUCHER>"}); err == nil && (r["ok"] == true || str(r["state"]) != "unable") {
		t.Fatalf("no mark: %v", r)
	}
}

// the live case's note: written by 2.5.19 (a batch, no date kept); the entry deleted in Tally since: refused as before
// when simply posted again; handed with lookFirst, looked for and sent again
func TestReupOldNoteLookedPast(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	if err := noteSentMany([]string{"u5"}, zz, "job-2519-old", "45174", 10, "45174", ""); err != nil {
		t.Fatal(err)
	}
	va := []any{M{"id": "u5", "xml": finVoucher("u5", fgParty, "U-5", td, "45.00")}}
	r := reupResult(t, reupJob(t, "job-reup-f-0001", va), "u5")
	if r["alreadySent"] != true || f.n(tagCheckID) != 0 || len(reupTagged(f, "TDSDesk:u5")) != 0 {
		t.Fatalf("posted again without lookFirst: refused on the record, nothing asked: %v", r)
	}
	r = reupResult(t, reupJob(t, "job-reup-f-0002", reupLook(va)), "u5")
	if r["ok"] != true || len(reupTagged(f, "TDSDesk:u5")) != 1 || f.n(tagCheckID) != 1 {
		t.Fatalf("a 2.5.19 note of an entry not in Tally: %v (%d looks)", r, f.n(tagCheckID))
	}
}

// fault 1 (03-Oct-2026): a Tally that kept the narration without FinCom's mark: a regular voucher of the entry's type and
// number on its day is taken for it, never sent twice (and /lookone says so)
func TestReupUnmarkedEntryNotSentTwice(t *testing.T) {
	td := today()
	f := newStandTally(t)
	f.storeNarr = f1NoTag
	standBridge(t, f, `,"PostWaitMs":200`)
	va := []any{M{"id": "u7", "xml": finVoucher("u7", fgParty, "U-7", td, "47.00")}}
	reupJob(t, "job-reup-g-0001", va)
	r := reupResult(t, reupJob(t, "job-reup-g-0002", reupLook(va)), "u7")
	if r["alreadySent"] != true || r["seenInTally"] != true || f.n("Import") != 1 {
		t.Fatalf("an entry Tally kept without the mark was sent again: %v (%d imports)", r, f.n("Import"))
	}
	l, err := lookOneEntry(M{"company": zz, "guid": "co-guid-1", "id": "u7", "xml": finVoucher("u7", fgParty, "U-7", td, "47.00")})
	if err != nil || str(l["state"]) != "unmarked" || str(l["vchNo"]) != "U-7" {
		t.Fatalf("/lookone: %v %v", l, err)
	}
}
