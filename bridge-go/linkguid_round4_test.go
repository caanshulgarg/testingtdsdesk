package main

// The owner's hard rule (19-Nov-2026), the third review of next-fix-linkedguid. Made-up companies and a fake Tally only:
//   - a company open only in a Tally a posting would not use is said in the beat with where (openElsewhere: its port and
//     why, no GUID), so FinCom's reason matches the bridge's own words; still not open, no GUID
//   - the wait's words name only a Tally that answered its list now (never one skipped or not answering)
//   - the lock of one hand-out of a posting is let go once no hand-out holds it

import (
	"testing"
)

func TestBeatOpenElsewhere(t *testing.T) {
	bridgeFor(t, &standIn{}, "")
	for _, c := range []struct {
		name, why string
		sess      []M
	}{
		{"another user's Tally", "other user", []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
			{"port": 9001, "ok": true, "mine": false, "companies": []any{M{"name": "B Co", "guid": "g9"}}}}},
		{"a Tally whose owner is not told", "owner unknown", []M{
			{"port": 9000, "ok": true, "mine": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
			{"port": 9001, "ok": true, "companies": []any{M{"name": "B Co", "guid": "g9"}}}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			var b, a M
			for _, x := range beatCompanies(c.sess, []any{"A Co", "B Co"}) {
				switch o := obj(x); str(o["name"]) {
				case "B Co":
					b = o
				case "A Co":
					a = o
				}
			}
			oe := obj(b["openElsewhere"])
			if b == nil || b["open"] != false || str(b["guid"]) != "" || oe == nil || toInt(oe["port"]) != 9001 || str(oe["why"]) != c.why || oe["guid"] != nil {
				t.Fatalf("open only on an excluded Tally: %v", b)
			}
			if a == nil || a["openElsewhere"] != nil {
				t.Fatalf("open on this user's Tally: no hint wanted: %v", a)
			}
		})
	}
}

func TestElsewhereWordsAnsweredOnly(t *testing.T) {
	sess := []M{
		{"port": 9000, "ok": true, "mine": true, "companies": []any{}},
		{"port": 9001, "ok": false, "error": "Tally timed out", "companies": []any{M{"name": "A Co", "guid": "g1"}}},
		{"port": 9002, "ok": true, "mine": false, "skipped": true, "companies": []any{M{"name": "A Co", "guid": "g1"}}},
	}
	if w := elsewhereWords(sess, "g1", false); w != "" {
		t.Fatalf("named a Tally that did not answer now, or one skipped: %q", w)
	}
}

func TestJobLockLetGo(t *testing.T) {
	_, l := lgSetup(t)
	id := "job-lg-lock-gone"
	if _, err := newPostJob(M{"jobId": id, "company": zz, "guid": lgGUID, "vouchers": lgVouchers("k", 1)}); err != nil {
		t.Fatal(err)
	}
	waitJob(t, id)
	if _, err := newPostJob(M{"jobId": id, "company": zz, "guid": lgGUID, "vouchers": lgVouchers("k", 1)}); err != nil {
		t.Fatal(err)
	}
	n := 0
	jobLocks.Range(func(k, v any) bool { n++; return true })
	if n != 0 || l.n() != 1 {
		t.Fatalf("locks kept after the hand-outs: %d (%d imports)", n, l.n())
	}
}
