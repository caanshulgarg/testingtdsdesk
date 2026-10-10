package main

// Fix 3 (2.3.0, the owner's spike run 37347773182 on TallyPrime 7.1 with two Windows users): the add-on writes every
// user's lines into the one shared recorder folder, and each user's bridge read them all, so each bridge also sent the
// other user's company lines under its own name. A bridge now takes a line only for a company its OWN Tally had open
// when the line was written (the open-company intervals it saw in its own Tally's company list). Tests written before
// the code; run in both stand modes (plain and STAND_TALLY_TYPED=1).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const ownOtherGUID, ownOtherName = "co-guid-2", "Other Co"

// a voucher line as the add-on writes it, for a company and a time (the add-on's time text: date and time to the second)
func ownLine(cguid, cname, user, mid string, at time.Time) string {
	ts := at.In(liveZone).Format("2-Jan-2006 15:04:05")
	g := cguid + "-" + strings.Repeat("0", 8-len(mid)) + mid
	return "FCR1|ev=voucher_accept_post|t0=" + ts + "|tw=" + ts + "|cguid=" + cguid + "|cname=" + cname + "|user=" + user + "|obj=Voucher|guid=" + g +
		"|mid=" + mid + "|aid=5|vtype=Payment|vno=" + mid + "|vdate=20261004|name=|parent=|narr=entry " + mid + "|t1=" + ts + "|src=live"
}

func ownFile(rec, cguid string) string {
	return filepath.Join(rec, cguid+"-"+nowFn().Format("20060102")+".txt")
}

// a bridge whose own Tally (a stand Tally) has the given company open; the recorder folder shared (rec "" : a new one).
// Nothing is seeded: what the bridge knows of its own Tally comes from its own Tally's company list
func ownBridge(t *testing.T, rec, guid, name string) (string, *standTally, *standCloud) {
	t.Helper()
	if rec == "" {
		rec, _ = r18RecorderDirs(t)
	}
	f := newStandTally(t)
	f.mu.Lock()
	f.guid, f.coName = guid, name
	f.mu.Unlock()
	c := newStandCloud(t)
	standBridge(t, f, c.cfg())
	liveResetState()
	t.Cleanup(liveResetState)
	return rec, f, c
}

// the users of the lines the stand cloud took
func ownSentUsers(c *standCloud) []string {
	var o []string
	for _, l := range c.recSent() {
		o = append(o, str(l["user"])+"@"+str(l["company_guid"]))
	}
	return o
}

func ownAt(at time.Time) { nowFn = func() time.Time { return at } }

const ownNotHereLog = "Recorder: Other Co: lines from a Tally this bridge does not read (company not open here): not sent"

// a line for a company not open in the bridge's own Tally is not sent; a line for its own open company is
func TestOwnTallyOnlyOwnCompanyLines(t *testing.T) {
	rec, f, c := ownBridge(t, "", b220CoGUID, zz)
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "11", base.Add(-20*time.Second)))
	liveAppend(t, ownFile(rec, ownOtherGUID), ownLine(ownOtherGUID, ownOtherName, "other", "21", base.Add(-20*time.Second)))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID {
		t.Fatalf("lines sent: %q (only the own company's line may go)", got)
	}
	if f.n("TDSDeskCompanies") == 0 {
		t.Fatal("the bridge did not ask its own Tally which companies are open")
	}
	if !strings.Contains(r222eLog(), ownNotHereLog) {
		t.Fatalf("the log does not say the other company's lines are not sent:\n%s", r222eLog())
	}
	// more of the other user's lines, later the same day: still not sent, and said once a day only
	ownAt(base.Add(time.Minute))
	liveAppend(t, ownFile(rec, ownOtherGUID), ownLine(ownOtherGUID, ownOtherName, "other", "22", base.Add(55*time.Second)))
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "mine", "12", base.Add(55*time.Second)))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID+",mine@"+b220CoGUID {
		t.Fatalf("lines sent: %q", got)
	}
	if n := strings.Count(r222eLog(), ownNotHereLog); n != 1 {
		t.Fatalf("the not-open line was logged %d times (once per company per day)", n)
	}
	// nothing is waiting: the other company's lines were passed over (never sent), the files read to their end
	live.mu.Lock()
	for name, st := range live.files {
		if fi, err := os.Stat(filepath.Join(rec, name)); err == nil && st.off != fi.Size() {
			t.Errorf("%s read up to %d of %d", name, st.off, fi.Size())
		}
	}
	live.mu.Unlock()
}

// a company opened later in the bridge's own Tally: its lines written before (another user's Tally) are not sent, the
// ones written after are; a restart keeps it
func TestOwnTallyCompanyOpenedLater(t *testing.T) {
	rec, f, c := ownBridge(t, "", b220CoGUID, zz)
	base := time.Now().Truncate(time.Second)
	other := ownFile(rec, ownOtherGUID)
	ownAt(base)
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "before1", "21", base.Add(-20*time.Second)))
	readAndUploadAll(t)
	ownAt(base.Add(40 * time.Second))
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "before2", "22", base.Add(35*time.Second)))
	readAndUploadAll(t)
	if got := ownSentUsers(c); len(got) != 0 {
		t.Fatalf("lines of a company not open in the own Tally were sent: %v", got)
	}
	// the user opens the other company in this bridge's own Tally
	f.mu.Lock()
	f.guid, f.coName = ownOtherGUID, ownOtherName
	f.mu.Unlock()
	ownAt(base.Add(80 * time.Second))
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "after1", "23", base.Add(75*time.Second)))
	readAndUploadAll(t)
	ownAt(base.Add(100 * time.Second))
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "after2", "24", base.Add(95*time.Second)))
	readAndUploadAll(t)
	want := "after1@" + ownOtherGUID + ",after2@" + ownOtherGUID
	if got := strings.Join(ownSentUsers(c), ","); got != want {
		t.Fatalf("lines sent: %q, want %q", got, want)
	}
	// a restart: what the bridge saw of its own Tally is kept; a line written while the company was not open here is still
	// not sent, one written after it is open again is
	liveResetState()
	ownAt(base.Add(200 * time.Second))
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "before3", "25", base.Add(20*time.Second)),
		ownLine(ownOtherGUID, ownOtherName, "after3", "26", base.Add(195*time.Second)))
	readAndUploadAll(t)
	want += ",after3@" + ownOtherGUID
	if got := strings.Join(ownSentUsers(c), ","); got != want {
		t.Fatalf("after the restart, lines sent: %q, want %q", got, want)
	}
	// the company closed in the own Tally: once the bridge has seen it closed (here the light check's company list), a
	// line written after that is not sent
	f.mu.Lock()
	f.guid, f.coName = b220CoGUID, zz
	f.mu.Unlock()
	ownAt(base.Add(300 * time.Second))
	openCompaniesWith(fin, true)
	ownAt(base.Add(310 * time.Second))
	liveAppend(t, other, ownLine(ownOtherGUID, ownOtherName, "closed1", "27", base.Add(305*time.Second)))
	readAndUploadAll(t) // the line waits for a look at the own Tally; the look says closed
	ownAt(base.Add(400 * time.Second))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != want {
		t.Fatalf("after the company closed here, lines sent: %q, want %q", got, want)
	}
}

// two bridges (two Windows users, each with their own Tally and company) reading the one shared recorder folder: each
// sends only its own company's lines
func TestOwnTallyTwoBridges(t *testing.T) {
	rec, _, ca := ownBridge(t, "", b220CoGUID, zz)
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "userA", "11", base.Add(-30*time.Second)), ownLine(b220CoGUID, zz, "userA", "12", base.Add(-20*time.Second)))
	liveAppend(t, ownFile(rec, ownOtherGUID), ownLine(ownOtherGUID, ownOtherName, "userB", "21", base.Add(-30*time.Second)), ownLine(ownOtherGUID, ownOtherName, "userB", "22", base.Add(-20*time.Second)))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(ca), ","); got != "userA@"+b220CoGUID+",userA@"+b220CoGUID {
		t.Fatalf("user A's bridge sent %q", got)
	}
	// user B's bridge: its own sync folder, its own Tally (the other company), the same recorder folder
	_, _, cb := ownBridge(t, rec, ownOtherGUID, ownOtherName)
	ownAt(base)
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(cb), ","); got != "userB@"+ownOtherGUID+",userB@"+ownOtherGUID {
		t.Fatalf("user B's bridge sent %q", got)
	}
	if !strings.Contains(r222eLog(), "Recorder: "+zz+": lines from a Tally this bridge does not read (company not open here): not sent") {
		t.Fatalf("user B's log does not say A's company lines are not sent:\n%s", r222eLog())
	}
}

// the light check's line for a company with no entry yet (ALTVCHID 0) says so plainly
func TestLightCheckNoEntryYetWording(t *testing.T) {
	f := newStandTally(t) // ledgers, no voucher yet: ALTVCHID 0, ALTMSTID above it
	standBridge(t, f, `,"CompanyCheckSec":2`)
	lightCheckOpen(openCompaniesWith(fin, true))
	if _, ok := startPointOf(zz); ok {
		t.Fatal("0 recorded as a starting point")
	}
	l := r222eLog()
	if !strings.Contains(l, "no starting point yet for "+zz+": it has no entry in Tally yet; the first entry made will set it") {
		t.Fatalf("the light check's line:\n%s", l)
	}
	if strings.Contains(l, "could not be written; see above") {
		t.Fatalf("the misleading line is still written:\n%s", l)
	}
}

// TallyPrime 7.1 writes the time to the minute ("5-Oct-26 13:55"): a line of another company waits until a look at the
// own Tally made after that whole minute, then is passed over; the own company's line goes
func TestOwnTallyMinuteTimes(t *testing.T) {
	rec, _, c := ownBridge(t, "", b220CoGUID, zz)
	base := time.Now().Truncate(time.Minute).Add(40 * time.Second)
	minute := func(l string) string {
		ts := base.In(liveZone).Format("2-Jan-2006 15:04:05")
		return strings.ReplaceAll(l, ts, base.In(liveZone).Format("2-Jan-06 15:04"))
	}
	ownAt(base)
	liveAppend(t, ownFile(rec, b220CoGUID), minute(ownLine(b220CoGUID, zz, "mine", "11", base)))
	liveAppend(t, ownFile(rec, ownOtherGUID), minute(ownLine(ownOtherGUID, ownOtherName, "other", "21", base)))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID {
		t.Fatalf("lines sent: %q", got)
	}
	live.mu.Lock()
	waiting := live.ownWant
	live.mu.Unlock()
	if !waiting {
		t.Fatal("the other company's line, written in the minute of the last look, does not wait for the next look")
	}
	ownAt(base.Add(10 * time.Second)) // within 30 s of the last look: not asked again
	readAndUploadAll(t)
	if strings.Contains(r222eLog(), ownNotHereLog) {
		t.Fatal("decided before a look after its minute")
	}
	ownAt(base.Add(35 * time.Second))
	readAndUploadAll(t)
	if got := strings.Join(ownSentUsers(c), ","); got != "mine@"+b220CoGUID || !strings.Contains(r222eLog(), ownNotHereLog) {
		t.Fatalf("lines sent: %q; log:\n%s", got, r222eLog())
	}
}
