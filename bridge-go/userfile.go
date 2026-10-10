// Next (branch next-userfile; the owner's item b): the recorder folder C:\ProgramData\FinCom\recorder is shared by every
// Windows user on a computer (NWS144: anshul, Ranjeet). From this add-on on, each Windows user's Tally writes its own
// daily file
//
//	<company GUID>-<day>-<Windows user>.txt
//
// and every line carries "|w=<Windows user>" after tw (recorderline.go). The Windows user is Tally's own
// ($$SysInfo, proven on a real TallyPrime: addon/FinComRecorder.tdl); when Tally gives none, the add-on writes the
// shared <company GUID>-<day>.txt with no w= as before.
//
// A bridge running just for one Windows user (runMode "user", the per-user install) reads only:
//   - its own user's files (a file of another user is never opened), and
//   - the shared files of an older add-on (no user in the name),
//
// and takes a line with w= only when w= is its own user (2.4.0 review: compared whole, DOMAIN\user, liveUserSame) AND its
// company is open in this bridge's own Tally (the 2.3.0 look, cached: 2.4.0 review MEDIUM, w= alone is not enough); a
// line without w= (an older add-on) keeps the 2.3.0 rule (recorder_owntally.go). A bridge that is not
// one user's (the Windows service, a window) reads every file and takes every line by the 2.3.0 rule, as before.
//
// Compatibility: a bridge before this one reads the new files too (any <GUID>-*.txt; its day from the file's time) and the
// new lines (w= sits inside tw for it), by the 2.3.0 rule; only its beat's recorderSeen does not count the new names.
package main

import (
	"regexp"
	"strings"
)

// the bridge's own Windows user (the beat's "user"); a variable for the tests
var liveWinUserFn = ownerName

// the key of a Windows user name: without its computer or domain ("NWS144\anshul" -> anshul), trimmed, lower case
func liveUserKey(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndexAny(s, `\/`); i >= 0 {
		s = s[i+1:]
	}
	return strings.ToLower(strings.TrimSpace(s))
}

// 2.4.0 review LOW: whether two Windows user names are the same user: compared whole, DOMAIN\user without regard to case
// (NWS144\anshul and FINCOM\anshul are two users). A name without its domain or computer (Tally's $$SysInfo:WindowsUser
// gives the bare name, and a daily file's name cannot hold "\") is compared by the name alone; the own-Tally look
// (recorder_owntally.go) still decides whether such a line is this bridge's (recorder_live.go liveTake)
func liveUserSame(a, b string) bool {
	a, b = strings.TrimSpace(a), strings.TrimSpace(b)
	if liveUserKey(a) == "" || liveUserKey(a) != liveUserKey(b) {
		return false
	}
	da, db := liveUserDomain(a), liveUserDomain(b)
	return da == "" || db == "" || strings.EqualFold(da, db)
}

// the domain or computer part of DOMAIN\user ("" when none)
func liveUserDomain(s string) string {
	if i := strings.LastIndexAny(s, `\/`); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return ""
}

// the Windows user whose lines this bridge reads alone: its own when it runs just for one user, else "" (every user's)
func liveOwnWinUser() string {
	if runMode != "user" {
		return ""
	}
	return liveUserKey(liveWinUserFn())
}

// a daily file's name: <prefix>-<day>[-<user>].txt, the day yyyymmdd, yyyy-mm-dd or d-Mon-yy (TallyPrime 7.1). The prefix
// is the shortest that leaves a day after it (a company GUID has no part that reads as a day), so a user name that reads
// as one is still the user's
var reLiveFileUser = regexp.MustCompile(`(?i)^(.+?)-(\d{8}|\d{4}-\d{2}-\d{2}|\d{1,2}-[a-z]{3}-\d{2})(?:-(.+))?\.txt$`)

// the day (yyyymmdd) and the Windows user ("" for an older add-on's shared file) a daily file's name gives
func liveFileDayUser(name string) (string, string) {
	g := reLiveFileUser.FindStringSubmatch(name)
	if g == nil {
		return "", ""
	}
	return normDate(g[2]), strings.TrimSpace(g[3])
}

// a file this bridge reads: an older add-on's shared file, or its own user's (every file when it is not one user's)
func liveFileMine(name string) bool {
	me := liveOwnWinUser()
	if me == "" {
		return true
	}
	_, u := liveFileDayUser(name)
	return u == "" || liveUserSame(u, liveWinUserFn())
}

// under live.mu: a line of another Windows user (its w= not this bridge's user): counted with the lines not taken here;
// said once per company and user a day
func liveOtherUser(l recLine) {
	name := strings.TrimSpace(l.CName)
	if name == "" {
		name = strings.TrimSpace(l.CGUID)
	}
	liveCo(name).notHere++
	k := "otheruser|" + liveOwnKey(l.CGUID, l.CName) + "|" + liveUserKey(l.W) + "|" + nowFn().Format("20060102")
	if live.logged[k] {
		return
	}
	live.logged[k] = true
	writeLog("Recorder: " + name + ": lines of another Windows user (" + strings.TrimSpace(l.W) + ") are not read by this bridge")
}
