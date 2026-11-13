// The FinCom ids Tally accepted (round 6, 03-Oct-2026). Job 3b03cc5e on NWS144: Tally replied CREATED (voucher id 26298),
// the installed 2.1.5 could not read the answer back (fault 1) and reported the entry failed; the cloud handed the job
// back (tally_post_requeue) and the same entry was sent again (voucher id 26299). From here every FinCom id Tally
// accepted or that was confirmed in Tally is written to sync\posted-ids.json on this computer, across jobs and restarts,
// and an entry whose id is there is never sent again by any route. Round 7: loaded once into memory and written through
// (a temporary file renamed over the old one; on a failure the old file stays and the log says so loudly); verified
// notes older than 180 days are pruned, unverified ones never; an owner's release handed by the cloud lets the entry go
// once more. Round 15 (03-Oct-2026, the owner's decision): the record is the ONLY duplicate check before a posting
// (noteSent / sentBeforeRefusal): every voucher sent is noted with its request's size and Tally's last voucher id;
// nothing is looked for in Tally from a posting any more.
package main

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	acceptedMu     sync.Mutex
	acceptedNotes  M      // the notes loaded (nil: not yet)
	acceptedLoaded string // the file they were loaded from
)

const acceptedKeepDays = 180

func acceptedFile() string { return sp("posted-ids.json") }

// the key of an entry: the id in its FinCom tag (letters and digits, as the cloud compares ids), else its id so reduced
func acceptedKey(id, xml string) string {
	if t := reTag.FindString(xml); t != "" {
		return re(`[^A-Za-z0-9]`).ReplaceAllString(t[len("TDSDesk:"):], "")
	}
	return re(`[^A-Za-z0-9]`).ReplaceAllString(id, "")
}

// forgets what is loaded (a test's new home; the file is read again at the next use)
func acceptedReset() {
	acceptedMu.Lock()
	acceptedNotes, acceptedLoaded, acceptedBroken, acceptedBrokenFile = nil, "", nil, ""
	acceptedMu.Unlock()
}

// 2.5.15 item 4 (the owner's approval of 13-Nov-2026): posted-ids.json there but neither it nor its copy readable
var (
	acceptedBroken     error
	acceptedBrokenAt   time.Time
	acceptedBrokenFile string
	acceptedRecheck    = 5 * time.Second // while it cannot be read: looked at again at most this often
)

const postedUnreadableWords = "FinCom Bridge can't read its record of posted entries; posting paused. Nothing is sent to Tally meanwhile, so " +
	"nothing can be posted twice. What to do: on the Tally computer, close any program that may be holding the file (an antivirus scan, a backup " +
	"or sync program), then restart FinCom Bridge from its tray icon. If this message stays, the file sync\\posted-ids.json (and its copy " +
	"posted-ids.json.bak) in FinCom Bridge's folder is damaged: put it back from a backup of that folder, or call FinCom support. The waiting " +
	"postings then go on by themselves."

var errPostedUnreadable = errors.New(postedUnreadableWords)

// nil when this computer's record of what it sent can be read (or there is none yet: a computer that never posted);
// errPostedUnreadable otherwise. Read again on every call while it cannot be read (a restored file is seen at once)
func postedRecordErr() error {
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	acceptedAll()
	if acceptedBroken != nil {
		return errPostedUnreadable
	}
	return nil
}

// under the lock: the notes, loaded once from the file (verified ones older than 180 days dropped)
func acceptedAll() M {
	f := acceptedFile()
	if acceptedNotes != nil && acceptedLoaded == f {
		return acceptedNotes
	}
	// 2.5.15: the file, else its copy (.bak) when the file is missing or not whole. Item 4 (the owner's approval of
	// 13-Nov-2026): the record there but neither copy readable is NEVER taken as empty: nothing is posted until it can be
	// read (postedRecordErr), and nothing is written over it (acceptedWrite); a throwaway map answers meanwhile
	if acceptedBroken != nil && acceptedBrokenFile == f && time.Since(acceptedBrokenAt) < acceptedRecheck {
		return M{} // looked at a moment ago (each look may wait 1.5 s for a file held by another program)
	}
	all, _, err := readObjFileBakErr(f)
	if err != nil {
		acceptedBrokenAt, acceptedBrokenFile = time.Now(), f
		if acceptedBroken == nil {
			writeLog("POSTED IDS NOT READABLE: " + f + " (and its copy " + bakOf(f) + ") cannot be read (" + err.Error() + "). " + postedUnreadableWords)
		}
		acceptedBroken = err
		return M{}
	}
	if acceptedBroken != nil {
		writeLog("Posted ids: " + f + " can be read again; posting goes on")
		acceptedBroken = nil
	}
	if all == nil {
		all = M{}
	}
	// review M1: both copies read: a note the copy holds and the file lacks (a write of the file's copy that failed, or a
	// file put back from an older backup) is kept too, the file's own note winning; posting never forgets a sent entry
	if bk, err := readFileRetry(bakOf(f)); err == nil {
		if bm := parseObj(string(bk)); bm != nil {
			n := 0
			for k, v := range bm {
				if _, has := all[k]; !has && obj(v) != nil {
					all[k] = v
					n++
				}
			}
			if n > 0 {
				writeLog(fmt.Sprintf("Posted ids: %d note(s) found only in %s kept too (never sent again)", n, bakOf(f)))
			}
		}
	}
	cut := time.Now().AddDate(0, 0, -acceptedKeepDays)
	for k, v := range all {
		e := obj(v)
		if e == nil {
			delete(all, k)
			continue
		}
		if e["verified"] == true {
			if t, ok := parseTime(str(e["verifiedAt"])); ok && t.Before(cut) {
				delete(all, k)
			}
		}
	}
	acceptedNotes, acceptedLoaded = all, f
	return all
}

// under the lock: the notes written through, a temporary file renamed over the old one; the old file stays on a failure
func acceptedWrite() error {
	// 2.5.15 item 4: a record that could not be read is never written over (the notes in memory are not the record)
	if acceptedBroken != nil || acceptedNotes == nil || acceptedLoaded != acceptedFile() {
		return errPostedUnreadable
	}
	// 2.5.15 (safefile.go): flushed to the disk and put in place by one rename, then the same text as posted-ids.json.bak
	return saveFileMirror(acceptedFile(), jsonText(acceptedNotes))
}

// a write failure is said loudly: until the file can be written again, what is known lives in this process only
func acceptedWriteOrLog(what string) error {
	err := acceptedWrite()
	if err != nil {
		writeLog("POSTED IDS NOT SAVED: " + acceptedFile() + " could not be written (" + err.Error() + ") after " + what + "; the entry stays unknown and is not sent again while this bridge runs, but a restart would forget it: free the disk or the folder, then Check Tally in FinCom")
	}
	return err
}

// what is held for an id: nil when Tally never accepted it here (a copy)
func acceptedInfo(key string) M {
	if key == "" {
		return nil
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	e := obj(acceptedAll()[key])
	if e == nil {
		return nil
	}
	o := M{}
	for k, v := range e {
		o[k] = v
	}
	return o
}

// Tally accepted the entry (CREATED/ALTERED, voucher id lv when given) in this job; kept until confirmed and after.
// acceptedAt (RFC3339) is set the first time and kept: a release older than it changes nothing
func noteAccepted(key, company, jobID, lv string) error {
	if key == "" {
		return errors.New("no key")
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS(), "acceptedAt": time.Now().Format(time.RFC3339)}
	}
	if str(e["acceptedAt"]) == "" || e["resendOpen"] == true {
		// the first acceptance, or the new one after a release was honoured: it replaces the note's acceptance
		e["acceptedAt"] = time.Now().Format(time.RFC3339)
		delete(e, "resendOpen")
	}
	e["company"], e["job"] = company, or(jobID, str(e["job"]))
	delete(e, "held")
	if lv != "" {
		e["lastVchId"] = lv
	}
	if e["verified"] != true {
		e["verified"] = false
	}
	all[key] = e
	return acceptedWriteOrLog("Tally accepted " + key)
}

// Round 15 (03-Oct-2026, the owner's decision): the entry was SENT to Tally in this job and Tally's reply accepted it
// (or no answer came): recorded with the request's size (batchN), Tally's last voucher id (batchEnd) and the entry's
// own id when the request held it alone (vchId; never inferred otherwise). A later posting of the same id on this
// computer is refused on this record; nothing is read back
func noteSent(key, company, jobID, lv string, batchN int, batchEnd, vchID string) error {
	if key == "" {
		return errors.New("no key")
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	e := obj(all[key])
	now := time.Now().Format(time.RFC3339)
	if e == nil {
		e = M{"at": nowS(), "acceptedAt": now}
	}
	if str(e["acceptedAt"]) == "" || e["resendOpen"] == true {
		// the first send, or the new one after a release was honoured: it replaces the note's send
		e["acceptedAt"] = now
		delete(e, "resendOpen")
	}
	e["sent"], e["sentAt"], e["company"], e["job"], e["batchN"] = true, now, company, or(jobID, str(e["job"])), batchN
	e["lastVchId"], e["batchEnd"], e["vchId"] = lv, batchEnd, vchID
	delete(e, "held")
	if e["verified"] != true {
		e["verified"] = false
	}
	all[key] = e
	return acceptedWriteOrLog("sent " + key)
}

// the same for every voucher of one request, written to posted-ids.json ONCE (fix review of 2.1.8); an error when the
// file could not be written: nothing may then be sent
func noteSentMany(keys []string, company, jobID, lv string, batchN int, batchEnd, vchID string) error {
	if len(keys) == 0 {
		return nil
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	now := time.Now().Format(time.RFC3339)
	for _, key := range keys {
		if key == "" {
			continue
		}
		e := obj(all[key])
		if e == nil {
			e = M{"at": nowS(), "acceptedAt": now}
		}
		if str(e["acceptedAt"]) == "" || e["resendOpen"] == true {
			e["acceptedAt"] = now
			delete(e, "resendOpen")
		}
		e["sent"], e["sentAt"], e["company"], e["job"], e["batchN"] = true, now, company, or(jobID, str(e["job"])), batchN
		e["lastVchId"], e["batchEnd"], e["vchId"] = lv, batchEnd, vchID
		delete(e, "held")
		if e["verified"] != true {
			e["verified"] = false
		}
		all[key] = e
	}
	return acceptedWriteOrLog(fmt.Sprintf("sent %d entr%s", len(keys), map[bool]string{true: "y", false: "ies"}[len(keys) == 1]))
}

// the notes of a request that never reached Tally go, in one write
func acceptedForgetMany(keys []string) {
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	n := 0
	for _, key := range keys {
		if _, ok := all[key]; ok && key != "" {
			delete(all, key)
			n++
		}
	}
	if n > 0 {
		_ = acceptedWriteOrLog(fmt.Sprintf("%d entr%s not sent after all", n, map[bool]string{true: "y", false: "ies"}[n == 1]))
	}
}

// the entry was confirmed in Tally (its head): kept so a later job never sends it again
func noteVerified(key, company string, h M) error {
	if key == "" || h == nil {
		return nil
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS()}
	}
	e["company"], e["verified"], e["verifiedAt"] = company, true, time.Now().Format(time.RFC3339)
	e["masterId"], e["guid"], e["vchNumber"], e["vchType"], e["vchDate"] = str(h["masterId"]), str(h["guid"]), str(h["number"]), str(h["type"]), str(h["date"])
	all[key] = e
	return acceptedWriteOrLog(key + " confirmed in Tally")
}

// the owner released the entry ("Not in Tally — release"): its note goes, so it may be sent once more; the new
// acceptance (or confirmation) then writes a new note
func acceptedForget(key string) {
	if key == "" {
		return
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	if _, ok := all[key]; ok {
		delete(all, key)
		_ = acceptedWriteOrLog(key + " released")
	}
}

// the release the cloud sent with the job for this entry (by its tag id or its raw id) that this bridge has not honoured
// yet; nil otherwise. The cloud is the single judge of whether a release is in force (round 8, R5: no clock comparison
// here); the bridge resends once per release, remembered in the note as "honoured": [at|id, ...]
func releaseFor(released []any, key, rawID string, note M) M {
	done := strs(note["honoured"])
	for _, x := range released {
		r := obj(x)
		if r == nil {
			continue
		}
		rid := str(r["id"])
		if rid != rawID && acceptedKey(rid, "") != key {
			continue
		}
		if str(r["at"]) == "" || contains(done, str(r["at"])+"|"+rid) {
			continue
		}
		return r
	}
	return nil
}

// the release is honoured: remembered in the note (kept across the resend's new acceptance), and the entry may go once
func acceptedHonour(key string, rel M) {
	if key == "" || rel == nil {
		return
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS()}
	}
	e["honoured"] = toAny(append(strs(e["honoured"]), str(rel["at"])+"|"+str(rel["id"])))
	e["resendOpen"], e["releasedBy"], e["releasedAt"], e["releasedWhy"] = true, str(rel["by"]), str(rel["at"]), str(rel["why"])
	all[key] = e
	_ = acceptedWriteOrLog(key + " released")
}

// an entry of a batch Tally made only partly, not found by its tag (round 8, R4): noted as held, so no later job sends
// it either; confirmed later by its tag (noteVerified)
func noteHeld(key, company, jobID, date string) error {
	if key == "" {
		return errors.New("no key")
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := acceptedAll()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS()}
	}
	if str(e["acceptedAt"]) == "" || e["resendOpen"] == true {
		e["acceptedAt"] = time.Now().Format(time.RFC3339)
		delete(e, "resendOpen")
	}
	e["company"], e["job"], e["held"], e["date"] = company, or(jobID, str(e["job"])), true, date
	delete(e, "lastVchId")
	if e["verified"] != true {
		e["verified"] = false
	}
	all[key] = e
	return acceptedWriteOrLog("Tally may have made " + key + " in a batch")
}
