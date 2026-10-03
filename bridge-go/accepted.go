// The FinCom ids Tally accepted (round 6, 03-Oct-2026). Job 3b03cc5e on NWS144: Tally replied CREATED (voucher id 26298),
// the installed 2.1.5 could not read the answer back (fault 1) and reported the entry failed; the cloud handed the job
// back (tally_post_requeue) and the same entry was sent again (voucher id 26299). From here every FinCom id Tally
// accepted or that was confirmed in Tally is written to sync\posted-ids.json on this computer, across jobs and restarts,
// and an entry whose id is there is never sent again by any route: it is only looked for (by Tally's voucher id, then
// by its tag) until it is confirmed. Round 7: loaded once into memory and written through (a temporary file renamed
// over the old one; on a failure the old file stays and the log says so loudly); verified notes older than 180 days
// are pruned, unverified ones never; an owner's release newer than the acceptance lets the entry go once more.
package main

import (
	"errors"
	"os"
	"path/filepath"
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
	acceptedNotes, acceptedLoaded = nil, ""
	acceptedMu.Unlock()
}

// under the lock: the notes, loaded once from the file (verified ones older than 180 days dropped)
func acceptedAll() M {
	f := acceptedFile()
	if acceptedNotes != nil && acceptedLoaded == f {
		return acceptedNotes
	}
	all := readObjFile(f)
	if all == nil {
		all = M{}
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
	f := acceptedFile()
	_ = os.MkdirAll(filepath.Dir(f), 0o755)
	tmp := f + ".tmp"
	if err := os.WriteFile(tmp, []byte(jsonText(acceptedNotes)), 0o644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, f); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
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
