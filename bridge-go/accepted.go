// The FinCom ids Tally accepted (round 6, 03-Oct-2026). Job 3b03cc5e on NWS144: Tally replied CREATED (voucher id 26298),
// the installed 2.1.5 could not read the answer back (fault 1) and reported the entry failed; the cloud handed the job
// back (tally_post_requeue) and the same entry was sent again (voucher id 26299). From here every FinCom id Tally
// accepted or that was confirmed in Tally is written to sync\posted-ids.json on this computer, across jobs and restarts,
// and an entry whose id is there is never sent again by any route: it is only looked for (by Tally's voucher id, then
// by its tag) until it is confirmed.
package main

import (
	"sync"
	"time"
)

var acceptedMu sync.Mutex

func acceptedFile() string { return sp("posted-ids.json") }

// the key of an entry: the id in its FinCom tag (letters and digits, as the cloud compares ids), else its id so reduced
func acceptedKey(id, xml string) string {
	if t := reTag.FindString(xml); t != "" {
		return re(`[^A-Za-z0-9]`).ReplaceAllString(t[len("TDSDesk:"):], "")
	}
	return re(`[^A-Za-z0-9]`).ReplaceAllString(id, "")
}

func readAccepted() M {
	m := readObjFile(acceptedFile())
	if m == nil {
		m = M{}
	}
	return m
}

// what is held for an id: nil when Tally never accepted it here
func acceptedInfo(key string) M {
	if key == "" {
		return nil
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	return obj(readAccepted()[key])
}

// Tally accepted the entry (CREATED/ALTERED, voucher id lv when given) in this job; kept until confirmed and after
func noteAccepted(key, company, jobID, lv string) {
	if key == "" {
		return
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := readAccepted()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS()}
	}
	e["company"], e["job"] = company, or(jobID, str(e["job"]))
	if lv != "" {
		e["lastVchId"] = lv
	}
	if e["verified"] != true {
		e["verified"] = false
	}
	all[key] = e
	_ = saveFile(acceptedFile(), jsonText(all))
}

// the entry was confirmed in Tally (its head): kept so a later job never sends it again
func noteVerified(key, company string, h M) {
	if key == "" || h == nil {
		return
	}
	acceptedMu.Lock()
	defer acceptedMu.Unlock()
	all := readAccepted()
	e := obj(all[key])
	if e == nil {
		e = M{"at": nowS()}
	}
	e["company"], e["verified"], e["verifiedAt"] = company, true, time.Now().Format(time.RFC3339)
	e["masterId"], e["guid"], e["vchNumber"], e["vchType"], e["vchDate"] = str(h["masterId"]), str(h["guid"]), str(h["number"]), str(h["type"]), str(h["date"])
	all[key] = e
	_ = saveFile(acceptedFile(), jsonText(all))
}
