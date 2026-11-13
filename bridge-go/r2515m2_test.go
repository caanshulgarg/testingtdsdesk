package main

// bridge 2.5.15 after the independent review of next-bridge-safe: M2, a day file not written is never read or sent as empty. Made-up names only.
import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// M2: a day file not written is neither marked read nor queued; a queued day whose file is missing never goes as empty
func TestR2515ReviewDayFileNotWritten(t *testing.T) {
	f := newStandTally(t)
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	dir := syncFolder(zz)
	_ = os.MkdirAll(filepath.Join(dir, "days", "20260405.xml"), 0o755) // the day's file cannot be written
	_, _, err := saveKeepDaysChangedErr(dir, "20260404", "20260405", "", true)
	if err == nil || exists(dayFullMark(dir, "20260405")) || !exists(dayFullMark(dir, "20260404")) {
		t.Fatalf("a day file not written: %v, marked %v", err, exists(dayFullMark(dir, "20260405")))
	}
	for _, d := range cloudQueue(dir) {
		if d == "20260405" {
			t.Fatal("a day file not written was queued for FinCom")
		}
	}
	// a queued day, marked read in full, whose file is gone: not read, never empty:true
	_ = os.RemoveAll(filepath.Join(dir, "days", "20260405.xml"))
	_ = saveFile(dayFullMark(dir, "20260406"), nowS())
	addCloudDays(dir, []string{"20260406"})
	cloudMu.Lock()
	cloudLinks[zz] = true
	err = pushCloudCompany(zz, dir, time.Minute)
	cloudMu.Unlock()
	if e := c.dayEntries()["20260406"]; err != nil || e == nil || e["empty"] == true || e["readFailed"] != true {
		t.Fatalf("a missing day file: %v %v", err, e)
	}
}
