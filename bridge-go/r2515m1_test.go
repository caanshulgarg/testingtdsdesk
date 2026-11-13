package main

// bridge 2.5.15 after the independent review of next-bridge-safe: M1, a file held by another program is never read from its older copy. Made-up names only.
import (
	"os"
	"path/filepath"
	"testing"
)

// M1: posted-ids.json there but not opened (another program holding it; a folder in its place stands for that here):
// its copy is NEVER read for it (it may be older): posting pauses; a note only the copy holds is kept with the file's
func TestR2515ReviewRecordHeldNeverFromCopy(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, `,"PostWaitMs":200`)
	old := acceptedRecheck
	acceptedRecheck = 0
	t.Cleanup(func() { acceptedRecheck = old })
	durableWaitAll()
	_ = os.WriteFile(bakOf(acceptedFile()), []byte(`{"Made9": {"sent": true, "job": "job-old"}}`), 0o644)
	_ = os.Remove(acceptedFile())
	_ = os.MkdirAll(acceptedFile(), 0o755)
	acceptedReset()
	if err := postedRecordErr(); err == nil {
		t.Fatal("a record held by another program was read from its copy")
	}
	if _, err := invokeImport(M{"company": zz, "vouchers": []any{M{"id": "hd0", "xml": finVoucher("hd0", fgParty, "HD-0", today(), "1.00")}}}); err == nil || f.n("Import") != 0 {
		t.Fatalf("posted while the record is held: %v", err)
	}
	_ = os.RemoveAll(acceptedFile())
	_ = os.WriteFile(acceptedFile(), []byte(`{"Made8": {"sent": true, "job": "job-new"}}`), 0o644)
	acceptedReset()
	if postedRecordErr() != nil || acceptedInfo("Made8") == nil || acceptedInfo("Made9") == nil {
		t.Fatalf("the file and the note only its copy holds: %v %v", acceptedInfo("Made8"), acceptedInfo("Made9"))
	}
	if logLines("note(s) found only in") != 1 {
		t.Fatal("the note kept from the copy is not logged")
	}
}

// M1: a posting's progress.json there but not opened: never its copy (nil, as before 2.5.15); a copy not written is said
func TestR2515ReviewProgressHeldNeverFromCopy(t *testing.T) {
	standBridge(t, newStandTally(t), "")
	jd := filepath.Join(jobsDir(), "job-r2515-held")
	_ = writeProgress(jd, M{"id": "job-r2515-held", "status": "running"})
	durableWait(filepath.Join(jd, "progress.json"))
	_ = os.Remove(filepath.Join(jd, "progress.json"))
	_ = os.MkdirAll(filepath.Join(jd, "progress.json"), 0o755)
	if p := readProgress(jd); p != nil {
		t.Fatalf("read from the copy while the file is held: %v", p)
	}
	_ = os.RemoveAll(filepath.Join(jd, "progress.json"))
	_ = os.Remove(bakOf(filepath.Join(jd, "progress.json")))
	_ = os.MkdirAll(bakOf(filepath.Join(jd, "progress.json")), 0o755)
	err := writeProgress(jd, M{"id": "job-r2515-held", "status": "running"})
	durableWait(filepath.Join(jd, "progress.json"))
	if err != nil || logLines("progress.json.bak could not be written") < 1 {
		t.Fatalf("a copy not written is not said: %v", err)
	}
	_ = noteSent("Made11", zz, "job-x", "", 1, "", "")
	durableWait(acceptedFile())
	_ = os.Remove(bakOf(acceptedFile()))
	_ = os.MkdirAll(bakOf(acceptedFile()), 0o755)
	acceptedReset()
	_ = noteSent("Made10", zz, "job-x", "", 1, "", "")
	durableWait(acceptedFile())
	if logLines("posted-ids.json.bak could not be written") < 1 || acceptedInfo("Made10") == nil {
		t.Fatal("posted-ids.json's copy not written is not said")
	}
}
