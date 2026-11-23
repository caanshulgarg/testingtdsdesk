package main

// FinCom Bridge 2.5.19, E (the owner's option a of 23-Nov-2026; docs/bridge-2.5.19-new-requests.md E.3): an entry FinCom
// had handed out before (the job's released / resendOnly lists) is looked for in Tally before it goes: one FinComTag
// (already on the allow-list, a posting's read, one in flight, under the 2 s stop) for each date such entries carry,
// never for an ordinary posting. The look is this worker run's own: a job resumed after a stop, handed back, or whose
// lease had to be taken anew looks again (the code review's B1).
//   - The answer is used only when it is whole and every entry in it is of the date asked; one entry of another date, an
//     answer cut short or not answered in time: the look failed for that date and its entries are not sent (B2).
//   - An entry whose mark "TDSDesk:<id>" is in an entry of that date that is not cancelled is not sent: it is reported
//     posted already with Tally's GUID and MasterID and kept in this computer's record (posted-ids.json). It goes into
//     the local copy only when Tally's entry is the one sent by type, date and party (the security review's L1).
//   - Held for a person, never sent unchecked: an entry with no FinCom mark or no valid date to look for (N1); the
//     entries of a date whose look failed twice (E.3.4, N2); the entries beyond the first 7 dates of one job (I1).

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	resentWaitWords   = "Not posted yet: Tally was busy while FinCom checked for a copy; tried again shortly"
	resentHeldWords   = "Not posted: FinCom could not check Tally for a copy of this entry twice. Look for it in Tally; if it is not there, release it in FinCom to post it."
	resentNoMarkWords = "Not posted: FinCom had sent this entry before and cannot look for it in Tally (it has no FinCom mark or no date). Look for it in Tally; if it is not there, release it in FinCom to post it."
	resentDatesWords  = "Not posted: FinCom had sent this entry before, and this posting has more than 7 dates to check in Tally. Look for it in Tally; if it is not there, release it in FinCom to post it."
	resentMaxDates    = 7
)

// the ids of the job's entries FinCom handed out before, as given and in the record's form (acceptedKey), so they match
// the way a release matches (releaseFor)
func resentIDs(pl M) map[string]bool {
	out := map[string]bool{}
	add := func(k string) {
		if k = strings.TrimSpace(k); k != "" {
			out[k] = true
			if a := acceptedKey(k, ""); a != "" {
				out[a] = true
			}
		}
	}
	for _, x := range arr(pl["released"]) {
		add(str(obj(x)["id"]))
	}
	for _, x := range append(arr(pl["checkFirst"]), arr(pl["resendOnly"])...) {
		add(str(x))
	}
	return out
}

func resentOne(ids map[string]bool, k, x string) bool {
	return ids[strings.TrimSpace(k)] || ids[acceptedKey(k, x)]
}

// the look's stop: 2 s, whatever RecorderLimitMs says (0 or more never takes it away: N1)
func resentLimitMs() int {
	if l := recorderLimitMs(); l > 0 && l < 2000 {
		return l
	}
	return 2000
}

// FinComTag for one date, under the 2 s stop with the posting's priority; an error unless the answer is whole and of
// that date only
func resentLook(port int, company, date string) ([]vchKey, error) {
	tc := *fin
	tc.limitMs, tc.resentLook = resentLimitMs(), true
	x := tagCheckRequest(company, date)
	resentAsk.Store(x, true)
	raw, err := invokeTally(&tc, port, x, 5)
	resentAsk.Delete(x)
	if err != nil {
		return nil, err
	}
	if !wholeEnvelope(raw) || !goodDupAnswer(raw) {
		return nil, errors.New("Tally's answer could not be read whole: " + cut(flat(raw), 120))
	}
	var out []vchKey
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		k := keyOfVoucher(v)
		if k.date != date {
			return nil, fmt.Errorf("Tally answered an entry of another date (%s) for %s: the date was not applied", or(k.date, "none"), ddmmyyyy(date))
		}
		out = append(out, k)
	}
	return out, nil
}

// --- the looks that failed, by company and date (resent-looks.json): the second failure holds that date's entries for
// a person; a look that answers clears it
var resentFailMu sync.Mutex

func resentFailFile() string { return sp("resent-looks.json") }

func resentFailNote(company, date string) int {
	resentFailMu.Lock()
	defer resentFailMu.Unlock()
	all := readObjFile(resentFailFile())
	if all == nil {
		all = M{}
	}
	k := companyKey(company) + "|" + date
	n := toInt(obj(all[k])["n"]) + 1
	all[k] = M{"n": n, "at": time.Now().Format(time.RFC3339)}
	_ = saveFile(resentFailFile(), jsonText(all))
	return n
}

func resentFailClear(company, date string) {
	resentFailMu.Lock()
	defer resentFailMu.Unlock()
	all := readObjFile(resentFailFile())
	k := companyKey(company) + "|" + date
	if all == nil || all[k] == nil {
		return
	}
	delete(all, k)
	_ = saveFile(resentFailFile(), jsonText(all))
}

func resentHeld(k, company string, port int, words, detail string) M {
	r := M{"id": k, "kind": "voucher", "ok": false, "notSent": true, "needsReview": true, "checkFailed": true, "state": "failed", "company": company, "port": port, "message": words}
	if detail != "" {
		r["detail"] = detail
	}
	return r
}

// the job's items to send after the look (left), and the results of the entries not sent
func resentLookFirst(port int, company string, todo []M, ids map[string]bool) (left []M, results []M) {
	if len(ids) == 0 {
		return todo, nil
	}
	reads := map[string][]vchKey{}
	fails := map[string]error{}
	held := map[string]bool{} // a date whose look failed twice
	var dates []string
	for _, it := range todo {
		k := str(it["id"])
		x := str(it["xml"])
		if str(it["kind"]) != "voucher" || !resentOne(ids, k, x) {
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
			writeLog("  entry " + k + ": NOT SENT: FinCom had handed it out before and it carries no FinCom mark or date to look for in Tally; held for a person")
			results = append(results, resentHeld(k, company, port, resentNoMarkWords, ""))
			continue
		}
		_, had := reads[d]
		_, failed := fails[d]
		if !had && !failed {
			if !contains(dates, d) {
				if len(dates) >= resentMaxDates {
					writeLog("  entry " + k + ": NOT SENT: more than 7 dates of entries FinCom had handed out before in one posting; held for a person")
					results = append(results, resentHeld(k, company, port, resentDatesWords, ""))
					continue
				}
				dates = append(dates, d)
			}
			there, err := resentLook(port, company, d)
			if err != nil {
				fails[d] = err
				if resentFailNote(company, d) >= 2 {
					held[d] = true
				}
				writeLog("  entries of " + ddmmyyyy(d) + ": NOT SENT: FinCom had handed them out before and Tally could not be looked at for their mark (" + tallyTrouble(err.Error()) + ")" + map[bool]string{true: "; the second time: held for a person", false: ""}[held[d]])
			} else {
				reads[d] = there
				resentFailClear(company, d)
			}
		}
		if err, failed := fails[d]; failed {
			if held[d] {
				results = append(results, resentHeld(k, company, port, resentHeldWords, tallyTrouble(err.Error())))
			} else {
				results = append(results, M{"id": k, "kind": "voucher", "ok": false, "checkFailed": true, "notSent": true, "state": "failed", "company": company, "port": port,
					"message": resentWaitWords, "detail": tallyTrouble(err.Error())})
			}
			continue
		}
		var hit *vchKey
		for i, e := range reads[d] {
			if hasTag(e.narration, tag) && !e.cancelled {
				hit = &reads[d][i]
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
		h := headOfKey(e)
		_ = noteVerified(acceptedKey(k, x), company, h) // this computer's record: never sent again
		if headMatchesXML(h, x) {
			addPostedForCopy(company, h, x) // the local copy only when Tally's entry is the one sent (L1); else the keeper reads it
		}
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
