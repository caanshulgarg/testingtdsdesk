package main

// bridge 2.5.15, item 2 (the owner's approval of 13-Nov-2026): an unreadable day is never sent as empty. A read that
// fails or an answer that cannot be read whole (its envelope not closed, or a whole answer without the entry asked) is
// a read that failed, asked again: never a day of fewer or no entries, never an entry "no longer in Tally"; a kept day
// file that cannot be read is not sent (it stays queued), never as empty:true. Nothing new is asked of Tally. Made-up
// names only.
import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestR2515WholeEnvelope(t *testing.T) {
	for raw, want := range map[string]bool{
		"<ENVELOPE><BODY><DATA></DATA></BODY></ENVELOPE>": true,
		"<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER>":     false,
		"": false,
		"<ERRORMSG>Could not find Voucher:ID:7!</ERRORMSG>": false,
	} {
		if wholeEnvelope(raw) != want {
			t.Errorf("wholeEnvelope(%q) != %v", raw, want)
		}
	}
}

// a day's list cut short: nothing goes to FinCom for the day (no count, no heads); read whole later, it goes as it is
func TestR2515CutDayListNeverSent(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250915", 700, "Sales", "Sales", "Receipt")
	var cutNow atomic.Bool
	cutNow.Store(true)
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == dayHeadsID && cutNow.Load() {
			_, _ = w.Write([]byte(`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>`))
			return true
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 8)
	if f.n(dayHeadsID) == 0 {
		t.Fatal("the day's list was not asked")
	}
	if _, told := m.n["20250915"]; told || len(m.heads) != 0 {
		t.Fatalf("a cut answer went to FinCom as the day's list: %v %v", m.n, m.heads)
	}
	cutNow.Store(false)
	at := nowFn().Add(30 * time.Minute)
	nowFn = func() time.Time { return at }
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 30)
	if m.n["20250915"] != 3 {
		t.Fatalf("read whole later, the day did not go as it is: %v", m.n)
	}
}

// an entry's answer cut short, or whole without the entry asked: never sent as "no longer in Tally"
func TestR2515EntryNotInAnswerNeverGone(t *testing.T) {
	for _, ans := range []string{`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA>`,
		`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA></DATA></BODY></ENVELOPE>`} {
		f, _, m := pullBridge(t)
		pullDay(f, "20250915", 700, "Sales", "Receipt")
		f.mu.Lock()
		f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
			if id == vchObjectID && strings.Contains(body, "ID:701<") {
				_, _ = w.Write([]byte(ans))
				return true
			}
			return false
		}
		f.mu.Unlock()
		applyPeriodDays(pullList("20250915"))
		pullRun(t, 20)
		if f.n(vchObjectID) == 0 {
			t.Fatalf("%q: no entry was asked: %v", ans, f.ids())
		}
		for _, b := range m.entries {
			for _, g := range strs(b["gone"]) {
				if g == "701" {
					t.Fatalf("%q: the entry Tally's answer did not hold went to FinCom as no longer in Tally: %v", ans, b)
				}
			}
		}
		pullReset()
	}
}

// Tally's exact "Could not find Voucher" still says an entry is gone (unchanged)
func TestR2515NotFoundStillGone(t *testing.T) {
	f, _, m := pullBridge(t)
	pullDay(f, "20250915", 700, "Sales", "Receipt")
	f.mu.Lock()
	f.behave = func(w http.ResponseWriter, r *http.Request, id, body string) bool {
		if id == vchObjectID && strings.Contains(body, "ID:701<") {
			_, _ = w.Write([]byte(fastNotFound("701")))
			return true
		}
		return false
	}
	f.mu.Unlock()
	applyPeriodDays(pullList("20250915"))
	pullRun(t, 20)
	gone := false
	for _, b := range m.entries {
		for _, g := range strs(b["gone"]) {
			gone = gone || g == "701"
		}
	}
	if !gone {
		t.Fatalf("Tally's own 'Could not find' no longer says the entry is gone: %v", m.entries)
	}
}

// a kept day file that cannot be read now: not sent (never as empty:true), still queued; the other days go
func TestR2515UnreadableDayFileNotSentEmpty(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days"), 0o755)
	good, bad := "20260402", "20260403"
	_ = saveFile(filepath.Join(dir, "days", good+".xml"), "")
	_ = saveFile(dayFullMark(dir, good), nowS())
	_ = os.MkdirAll(filepath.Join(dir, "days", bad+".xml"), 0o755) // there, but cannot be read as a file
	_ = saveFile(dayFullMark(dir, bad), nowS())
	addCloudDays(dir, []string{good, bad})
	cloudMu.Lock()
	cloudLinks[zz] = true
	err := pushCloudCompany(zz, dir, time.Minute)
	cloudMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	es := c.dayEntries()
	if e := es[bad]; e != nil {
		t.Fatalf("the unreadable day was sent: %v", e)
	}
	if e := es[good]; e == nil || e["empty"] != true {
		t.Fatalf("the day read in full and empty: %v", e)
	}
	if q := cloudQueue(dir); len(q) != 1 || q[0] != bad {
		t.Fatalf("the unreadable day is not queued still: %v", q)
	}
}
