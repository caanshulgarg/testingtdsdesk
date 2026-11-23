package main

// FinCom Bridge 2.5.19, E (the owner's option a of 23-Nov-2026; docs/bridge-2.5.19-new-requests.md E.3): an entry FinCom
// had handed out before (the job's released / resendOnly lists) is looked for in Tally before the job's first part: one
// FinComTag (already on the allow-list, a posting's read, one in flight, under the 2 s stop) for each date such entries
// carry, never for an ordinary posting. Only the rows of the date asked are used (FinComTag carries its period as plain
// yyyymmdd: a Tally that does not apply it answers other dates, and a mark on another date is not the entry). An entry
// whose mark "TDSDesk:<id>" is in an entry of that date that is not cancelled is not sent: it is reported posted already
// with Tally's GUID and MasterID and kept in this computer's record. A date Tally did not answer in time (or could not
// be read): its entries are not sent (FinCom hands them out again later); the rest of the job goes. The read is kept for
// this job only (the lease holds the company for the job), never used after it.

import (
	"errors"
	"strings"
	"sync"
)

const resentWaitWords = "Not posted yet: Tally was busy while FinCom checked for a copy; tried again shortly"

// the ids of the job's entries FinCom handed out before
func resentIDs(pl M) map[string]bool {
	out := map[string]bool{}
	for _, x := range arr(pl["released"]) {
		if k := strings.TrimSpace(str(obj(x)["id"])); k != "" {
			out[k] = true
		}
	}
	for _, x := range append(arr(pl["checkFirst"]), arr(pl["resendOnly"])...) {
		if k := strings.TrimSpace(str(x)); k != "" {
			out[k] = true
		}
	}
	return out
}

// FinComTag for one date, under the 2 s stop with the posting's priority; only the rows of that date
func resentLook(port int, company, date string) ([]vchKey, error) {
	tc := *fin
	tc.limitMs, tc.resentLook = minI(recorderLimitMs(), 2000), true
	x := tagCheckRequest(company, date)
	resentAsk.Store(x, true)
	raw, err := invokeTally(&tc, port, x, 5)
	resentAsk.Delete(x)
	if err != nil {
		return nil, err
	}
	if !goodDupAnswer(raw) {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	var out []vchKey
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		if k := keyOfVoucher(v); k.date == date {
			out = append(out, k)
		}
	}
	return out, nil
}

// the job's vouchers to send after the look (left), and the results of those not sent (already in Tally, or the look
// not answered)
func resentLookFirst(port int, company string, todo []M, ids map[string]bool) (left []M, results []M) {
	if len(ids) == 0 {
		return todo, nil
	}
	reads := map[string][]vchKey{}
	fails := map[string]error{}
	for _, it := range todo {
		k := str(it["id"])
		x := str(it["xml"])
		if str(it["kind"]) != "voucher" || !ids[k] {
			left = append(left, it)
			continue
		}
		vs := xmlDoc(x).All("VOUCHER")
		tag := reTag.FindString(x)
		d := ""
		if len(vs) > 0 {
			d = normDate(nt(vs[0], "DATE"))
		}
		if tag == "" || !isTallyDate(d) {
			left = append(left, it) // nothing to look for (cannotSend says why, if anything)
			continue
		}
		there, had := reads[d]
		if _, failed := fails[d]; !had && !failed {
			var err error
			there, err = resentLook(port, company, d)
			if err != nil {
				fails[d] = err
				writeLog("  entry " + k + ": NOT SENT yet: FinCom had handed it out before and Tally could not be looked at for its mark on " + ddmmyyyy(d) + " (" + tallyTrouble(err.Error()) + ")")
			} else {
				reads[d] = there
			}
		}
		if err, failed := fails[d]; failed {
			results = append(results, M{"id": k, "kind": "voucher", "ok": false, "checkFailed": true, "notSent": true, "state": "failed", "company": company, "port": port,
				"message": resentWaitWords, "detail": tallyTrouble(err.Error())})
			continue
		}
		var hit *vchKey
		for i := range there {
			if hasTag(there[i].narration, tag) && !there[i].cancelled {
				hit = &there[i]
				break
			}
		}
		if hit == nil {
			left = append(left, it)
			continue
		}
		e := *hit
		msg := "Already in Tally (voucher no. " + e.number + ", " + ddmmyyyy(e.date) + ")"
		if e.number == "" {
			msg = "Already in Tally (voucher without a number, " + ddmmyyyy(e.date) + ")"
		}
		writeLog("  entry " + k + ": NOT SENT: FinCom had handed it out before and its mark is in Tally already: " + e.vtype + " no. " + e.number + " of " + ddmmyyyy(e.date) + " (GUID " + e.guid + ")")
		confirmedInTally(company, headOfKey(e), x, "FinCom id", k) // kept in this computer's record (posted-ids.json) and the copy
		results = append(results, M{"id": k, "kind": "voucher", "ok": false, "already": true, "sameId": true, "company": company, "port": port, "message": msg,
			"guid": e.guid, "vchNo": e.number, "vchNumber": e.number, "vchType": e.vtype, "masterId": e.masterID, "vchDate": e.date, "optional": e.optional})
	}
	return left, results
}

// the looks at Tally going now (the dated gate's exception for exactly them: tally.go)
var resentAsk sync.Map

func resentAsking(tc *TC, x string) bool {
	if tc == nil || !tc.resentLook || tc.limitMs <= 0 || tc.limitMs > 2000 {
		return false
	}
	a, z := pinDates(x)
	if _, on := resentAsk.Load(x); !on || a == "" || a != z || x != tagCheckRequest(pinCo(x), a) {
		return false
	}
	return true
}
