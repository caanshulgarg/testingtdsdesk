package main

// 2.2.2 (05-Oct-2026): on real TallyPrime 7.1 the live add-on's @@FCRDay gives "5-Oct-26", so its daily files are named
// <GUID>-5-Oct-26.txt: read and dated by that name too. Written before the code.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- 6. the live add-on's file names on TallyPrime 7.1: <GUID>-5-Oct-26.txt (d-Mon-yy), dated 2026-10-05; yyyymmdd and
// yyyy-mm-dd still read
func TestLiveFileNameDMonYY(t *testing.T) {
	for name, want := range map[string]string{
		"co-guid-1-5-Oct-26.txt":   "20261005",
		"co-guid-1-15-Oct-26.txt":  "20261015",
		"co-guid-1-20261005.txt":   "20261005",
		"co-guid-1-2026-10-05.txt": "20261005",
	} {
		if got := liveFileDay(name); got != want {
			t.Errorf("%s: %q, want %q", name, got, want)
		}
	}
	if liveFileDay("co-guid-1.txt") != "" || liveFileDay("failed.txt") != "" {
		t.Error("a name with no date dated")
	}
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, "")
	at := time.Date(2026, 10, 5, 12, 0, 0, 0, time.Local)
	nowFn = func() time.Time { return at }
	t.Cleanup(func() { nowFn = time.Now })
	// dated by its name, not by its last write: written 40 days ago, named today: read; named August, written today: not
	today := filepath.Join(rec, "co-guid-1-5-Oct-26.txt")
	old := filepath.Join(rec, "co-guid-1-5-Aug-26.txt")
	_ = os.WriteFile(today, utf16leBOM(r18Line1+"\r\n"), 0o644)
	_ = os.WriteFile(old, utf16leBOM(r18Line1+"\r\n"), 0o644)
	long := time.Now().AddDate(0, 0, -40)
	_ = os.Chtimes(today, long, long)
	got := strings.Join(liveFiles(), "|")
	if !strings.Contains(got, "co-guid-1-5-Oct-26.txt") || strings.Contains(got, "5-Aug-26") {
		t.Fatalf("the files read: %s", got)
	}
}

func TestRecorderSeenDMonYY(t *testing.T) {
	rec, _ := r18RecorderDirs(t)
	f := newStandTally(t)
	standBridge(t, f, "")
	if _, err := companyCheck(fin, zz, f.port); err != nil {
		t.Fatal(err)
	}
	cur := func() M { return obj(obj(beatBody(true, "open", "", nil, nil, nil)["changeNumbers"])[zz]) }
	if c := cur(); c["recorderSeen"] != false {
		t.Fatalf("no file: %v", c)
	}
	_ = os.WriteFile(filepath.Join(rec, "co-guid-1-5-Oct-26.txt"), utf16leBOM(r18Line1+"\r\n"), 0o644)
	if c := cur(); c["recorderSeen"] != true || str(c["recorderLastAt"]) == "" {
		t.Fatalf("a daily file named 5-Oct-26: %v", c)
	}
}
