package main

// bridge 2.5.15, item 4 (the owner's approval of 13-Nov-2026): posted-ids.json (and its copy) there but unreadable is
// never taken as empty: nothing is posted, by a job or by /import; FinCom (the posting's message, the beat) and the tray
// say "FinCom Bridge can't read its record of posted entries; posting paused"; the damaged file is never written over;
// once it can be read the posting goes on by itself. A computer that never posted (no file at all) posts as before.
import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestR2515PostingPausedWhileRecordUnreadable(t *testing.T) {
	td := today()
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	bad := `{"Made7": {"sent": true, "job": "job-ear`
	_ = os.WriteFile(acceptedFile(), []byte(bad), 0o644)
	_ = os.WriteFile(bakOf(acceptedFile()), []byte(`{"Made7": `), 0o644)
	acceptedReset()
	if err := postedRecordErr(); err == nil {
		t.Fatal("a damaged record (and copy) is read as fine")
	}
	// the browser's /import: refused as a whole, with the words; nothing reaches Tally
	if _, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "rp0", "xml": finVoucher("rp0", fgParty, "RP-0", td, "1.00")}}}); err == nil ||
		!strings.Contains(err.Error(), "FinCom Bridge can't read its record of posted entries; posting paused") {
		t.Fatalf("/import with the record unreadable: %v", err)
	}
	// a job: waits with the words (FinCom hears them in the posting's message), never fails, sends nothing
	if _, err := newPostJob(M{"jobId": "job-r2515-rec", "company": zz, "vouchers": r15Bills("rp", td, 2)}); err != nil {
		t.Fatal(err)
	}
	jd, _ := jobDir("job-r2515-rec")
	var p M
	for i := 0; i < 100; i++ {
		if p = readProgress(jd); p != nil && str(p["status"]) == "waiting" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if str(p["status"]) != "waiting" || !strings.HasPrefix(str(p["message"]), "FinCom Bridge can't read its record of posted entries; posting paused") || f.n("Import") != 0 {
		t.Fatalf("the job with the record unreadable: %v %q (%d imports)", p["status"], p["message"], f.n("Import"))
	}
	if f.n("FinCompany")+f.n("FinComCompany") != 0 {
		t.Fatalf("Tally was asked for the company while posting is paused: %v", f.ids())
	}
	if !strings.Contains(postingNow(), "posting paused") || !strings.Contains(str(beatBody(true, "", "", nil, nil, nil)["postedRecord"]), "posting paused") {
		t.Fatalf("the tray / the beat do not say it: %q / %q", postingNow(), beatBody(true, "", "", nil, nil, nil)["postedRecord"])
	}
	if logLines("POSTED IDS NOT READABLE") != 1 {
		t.Fatalf("the log says it %d times (once)", logLines("POSTED IDS NOT READABLE"))
	}
	if readText(acceptedFile()) != bad {
		t.Fatal("the damaged record was written over")
	}
	// the record restored (FinCom support): the posting goes on by itself, the earlier entry still refused
	_ = os.WriteFile(acceptedFile(), []byte(`{"Made7": {"sent": true, "job": "job-earlier", "acceptedAt": "2026-11-01T10:00:00Z"}}`), 0o644)
	p = waitJob(t, "job-r2515-rec")
	if str(p["status"]) != "done" || f.n("Import") != 1 || postingNow() != "" {
		t.Fatalf("after the record is readable again: %s %q (%d imports), tray %q", p["status"], p["message"], f.n("Import"), postingNow())
	}
	if a := acceptedInfo("Made7"); a == nil || a["sent"] != true {
		t.Fatalf("the restored record lost its note: %v", a)
	}
}

// no record at all (a computer that never posted): posting as before
func TestR2515NoRecordYetPosts(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	_ = os.Remove(acceptedFile())
	_ = os.Remove(bakOf(acceptedFile()))
	acceptedReset()
	if err := postedRecordErr(); err != nil {
		t.Fatal(err)
	}
	if p := r15Job(t, "job-r2515-first", r15Bills("fp", today(), 1)); str(p["status"]) != "done" || f.n("Import") != 1 {
		t.Fatalf("the first posting: %s %q", p["status"], p["message"])
	}
}
