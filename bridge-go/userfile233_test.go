package main

// Next (branch next-userfile): each Windows user's add-on lines go to that user's own daily file
// <company GUID>-<day>-<Windows user>.txt, every line carrying "|w=<Windows user>" after "|src=live", and a bridge
// running just for one Windows user (runMode "user") reads only its own user's files and lines. Lines of an older add-on
// (no w=, the shared <company GUID>-<day>.txt) keep the 2.3.0 own-Tally attribution. Tests written before the code; run
// in both stand modes (plain and STAND_TALLY_TYPED=1).

import (
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// a line as the new add-on writes it: the old line with "|w=<user>" after tw (an older bridge reads it as part of tw, a
// time it does not need: t0 comes first; the line still ends "|t1=...|src=live", as an older bridge's reader requires)
func ufLine(cguid, cname, tallyUser, winUser, mid string, at time.Time) string {
	return strings.Replace(ownLine(cguid, cname, tallyUser, mid, at), "|cguid=", "|w="+winUser+"|cguid=", 1)
}

// a user's own daily file, as the new add-on names it (the date as TallyPrime 7.1 writes it: d-Mon-yy)
func ufFile(rec, cguid, winUser string) string {
	return filepath.Join(rec, cguid+"-"+nowFn().Format("2-Jan-06")+"-"+winUser+".txt")
}

// this bridge runs just for the Windows user "user" (as the per-user install runs it)
func ufAs(t *testing.T, mode, user string) {
	t.Helper()
	m, u := runMode, liveWinUserFn
	runMode, liveWinUserFn = mode, func() string { return user }
	t.Cleanup(func() { runMode, liveWinUserFn = m, u })
}

func sortedUsers(c *standCloud) string {
	u := ownSentUsers(c)
	sort.Strings(u)
	return strings.Join(u, ",")
}

// the parser takes w= after tw; older lines have none; a narration holding "|w=" is the narration's
func TestUserFileParserTakesW(t *testing.T) {
	at := time.Date(2026, 10, 7, 10, 15, 2, 0, liveZone)
	r, ok := parseRecorderLine(ufLine("g-1", "Co", "TALLY User", "anshul", "11", at))
	if !ok || r.W != "anshul" || r.Src != "live" || r.T1 != "7-Oct-2026 10:15:02" || r.User != "TALLY User" {
		t.Fatalf("new line: %v %+v", ok, r)
	}
	r, ok = parseRecorderLine(ownLine("g-1", "Co", "TALLY User", "11", at))
	if !ok || r.W != "" || r.Src != "live" {
		t.Fatalf("old line: %v %+v", ok, r)
	}
	l := strings.Replace(ufLine("g-1", "Co", "u", "Ranjeet", "11", at), "|narr=entry 11|", "|narr=paid|w=anshul to x|", 1)
	r, ok = parseRecorderLine(l)
	if !ok || r.W != "Ranjeet" || r.Narr != "paid|w=anshul to x" {
		t.Fatalf("narration with |w=: %v %+v", ok, r)
	}
	// a user name with a space and a dot (Windows allows both)
	r, _ = parseRecorderLine(ufLine("g-1", "Co", "u", "Anshul Garg.FC", "11", at))
	if r.W != "Anshul Garg.FC" {
		t.Fatalf("w= with a space and a dot: %q", r.W)
	}
	// an older bridge's view of a new line: complete as before (its end unchanged), t0, the company, the narration and the
	// names as before; the user name only inside tw
	if !reLiveDone.MatchString(l) || !strings.HasSuffix(l, "|t1=7-Oct-2026 10:15:02|src=live") {
		t.Fatalf("the line's end changed: %q", l)
	}
	old := func(l string) recLine {
		r, ok := parseRecorderLine(strings.Replace(l, "|w=", "\x00", 1))
		if !ok {
			t.Fatalf("not a line: %q", l)
		}
		r.Tw = strings.Replace(r.Tw, "\x00", "|w=", 1)
		return r
	}
	if o := old(l); o.T0 != "7-Oct-2026 10:15:02" || o.CGUID != "g-1" || o.Narr != "paid|w=anshul to x" || o.Tw != "7-Oct-2026 10:15:02|w=Ranjeet" {
		t.Fatalf("as an older bridge reads it: %+v", o)
	}
}

// the file name: <company GUID>-<day>-<Windows user>.txt; the day in each form the add-on writes; the user may hold "-"
func TestUserFileNameParts(t *testing.T) {
	g := "cf60d26a-89b1-4c33-811b-bff6eb4c5923"
	for _, c := range []struct{ name, day, user string }{
		{g + "-7-Oct-26-anshul.txt", "20261007", "anshul"},
		{g + "-20261007-Ranjeet.txt", "20261007", "Ranjeet"},
		{g + "-2026-10-07-ab-cd.txt", "20261007", "ab-cd"},
		{g + "-7-Oct-26-20261007.txt", "20261007", "20261007"},
		{g + "-7-Oct-26.txt", "20261007", ""},
		{g + "-20261007.txt", "20261007", ""},
	} {
		day, user := liveFileDayUser(c.name)
		if day != c.day || user != c.user {
			t.Errorf("%s: day %q user %q, want %q %q", c.name, day, user, c.day, c.user)
		}
	}
	for _, c := range []struct{ a, b string }{{"anshul", "ANSHUL"}, {`NWS144\anshul`, "anshul"}, {" anshul ", "Anshul"}} {
		if liveUserKey(c.a) != liveUserKey(c.b) {
			t.Errorf("%q and %q are the same Windows user", c.a, c.b)
		}
	}
	if liveUserKey("anshul") == liveUserKey("ranjeet") || liveUserKey("") != "" {
		t.Error("liveUserKey")
	}
}

// two Windows users on one PC with the SAME company open (a shared data folder): each bridge sends only its own user's
// lines; the shared file of an older add-on still goes by the own-Tally rule
func TestUserFileEachBridgeReadsOnlyItsOwn(t *testing.T) {
	for _, me := range []string{"anshul", "Ranjeet"} {
		t.Run(me, func(t *testing.T) {
			rec, _, c := ownBridge(t, "", b220CoGUID, zz)
			ufAs(t, "user", `NWS144\`+me)
			base := time.Now().Truncate(time.Second)
			ownAt(base)
			liveAppend(t, ufFile(rec, b220CoGUID, "anshul"), ufLine(b220CoGUID, zz, "a-tally", "anshul", "11", base.Add(-20*time.Second)))
			liveAppend(t, ufFile(rec, b220CoGUID, "Ranjeet"), ufLine(b220CoGUID, zz, "r-tally", "Ranjeet", "12", base.Add(-20*time.Second)))
			liveAppend(t, ownFile(rec, b220CoGUID), ownLine(b220CoGUID, zz, "old-addon", "13", base.Add(-20*time.Second)))
			readAndUploadAll(t)
			want := map[string]string{"anshul": "a-tally@" + b220CoGUID + ",old-addon@" + b220CoGUID, "Ranjeet": "old-addon@" + b220CoGUID + ",r-tally@" + b220CoGUID}[me]
			if got := sortedUsers(c); got != want {
				t.Fatalf("bridge of %s sent %q, want %q", me, got, want)
			}
			// the other user's file is never opened: no offset is kept for it
			other := map[string]string{"anshul": "Ranjeet", "Ranjeet": "anshul"}[me]
			live.mu.Lock()
			_, opened := live.files[filepath.Base(ufFile(rec, b220CoGUID, other))]
			live.mu.Unlock()
			if opened {
				t.Fatalf("the bridge of %s opened %s's file", me, other)
			}
			for _, s := range strs(liveFilesSeen()) {
				if strings.HasSuffix(strings.ToLower(s), "-"+strings.ToLower(other)+".txt") {
					t.Fatalf("the beat lists %s's file %s", other, s)
				}
			}
		})
	}
}

// the new add-on's own line is taken without the own-Tally look (the company need not be open in the bridge's own Tally:
// the Windows user says whose Tally wrote it); another user's line in this user's file (never the add-on's way) is not
func TestUserFileOwnLineNeedsNoLook(t *testing.T) {
	rec, f, c := ownBridge(t, "", b220CoGUID, zz)
	ufAs(t, "user", "anshul")
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	// a company the own Tally does not list (the stand Tally lists only ZZ)
	liveAppend(t, ufFile(rec, ownOtherGUID, "anshul"), ufLine(ownOtherGUID, ownOtherName, "mine", "anshul", "21", base.Add(-20*time.Second)),
		ufLine(ownOtherGUID, ownOtherName, "intruder", "Ranjeet", "22", base.Add(-10*time.Second)))
	readAndUploadAll(t)
	if got := sortedUsers(c); got != "mine@"+ownOtherGUID {
		t.Fatalf("sent %q: only the own user's line", got)
	}
	_ = f
	if !strings.Contains(r222eLog(), "Recorder: Other Co: lines of another Windows user (Ranjeet) are not read by this bridge") {
		t.Fatalf("the log does not say another user's line was passed over:\n%s", r222eLog())
	}
}

// failed.txt is shared by every user's add-on: its lines go by their w= too
func TestUserFileFailedTxtByUser(t *testing.T) {
	rec, _, c := ownBridge(t, "", b220CoGUID, zz)
	ufAs(t, "user", "anshul")
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	openCompaniesAsk(bgCompaniesTC(), true) // the light check's look, which holds the company's GUID (failed.txt's own check)
	meant := ufFile(rec, b220CoGUID, "x")
	wf := func(l string) string { return "FCR1|ev=write_failed|file=" + meant + "|was=" + l }
	liveAppend(t, filepath.Join(rec, "failed.txt"), wf(ufLine(b220CoGUID, zz, "mine", "anshul", "31", base.Add(-20*time.Second))),
		wf(ufLine(b220CoGUID, zz, "theirs", "Ranjeet", "32", base.Add(-20*time.Second))))
	readAndUploadAll(t)
	if got := sortedUsers(c); got != "mine@"+b220CoGUID {
		t.Fatalf("sent %q from failed.txt", got)
	}
}

// a bridge that does not run for one Windows user (the service, a window) reads every file, and every line goes by the
// own-Tally rule, as in 2.3.2
func TestUserFileServiceReadsAllByOwnTally(t *testing.T) {
	rec, _, c := ownBridge(t, "", b220CoGUID, zz)
	ufAs(t, "service", "SYSTEM")
	base := time.Now().Truncate(time.Second)
	ownAt(base)
	liveAppend(t, ufFile(rec, b220CoGUID, "anshul"), ufLine(b220CoGUID, zz, "a", "anshul", "41", base.Add(-20*time.Second)))
	liveAppend(t, ufFile(rec, b220CoGUID, "Ranjeet"), ufLine(b220CoGUID, zz, "r", "Ranjeet", "42", base.Add(-20*time.Second)))
	liveAppend(t, ufFile(rec, ownOtherGUID, "Ranjeet"), ufLine(ownOtherGUID, ownOtherName, "r2", "Ranjeet", "43", base.Add(-20*time.Second)))
	readAndUploadAll(t)
	if got := sortedUsers(c); got != "a@"+b220CoGUID+",r@"+b220CoGUID {
		t.Fatalf("sent %q: every user's line of the company open here, none of the other", got)
	}
}

// the add-on: the Windows user in the file name and on every line, the old name when Tally gives no user
func TestUserFileAddon(t *testing.T) {
	tdl := readText(filepath.Join("addon", liveAddonName))
	for _, s := range []string{
		"FCRWinUser",
		`@@FCRFolder + ##vGuid + "-" + @@FCRDay + "-" + @@FCRWinUser + ".txt"`,
		`"|tw=" + ##vTW + "|w=" + @@FCRWinUser`,
		`"|src=live"`,
		`IF     : $$IsEmpty:@@FCRWinUser`,
	} {
		if !strings.Contains(tdl, s) {
			t.Errorf("the live add-on lacks %q", s)
		}
	}
}
