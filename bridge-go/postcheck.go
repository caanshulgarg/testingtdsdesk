// Decision B (the owner, 05-Oct-2026; migration 55): "Not in Tally - post again". Any member of the firm may settle a
// posting whose result is uncertain, but before anything is sent again this bridge (the posting's own) looks in that
// company in Tally for the ONE voucher it may be, and tells FinCom's cloud what it saw:
//
//	found     the voucher with the entry's type and number on its date (FinComVoucherByNumber), or with Tally's own id
//	          from its reply (FinComVoucherObject since 2.3.4), carries the entry's FinCom id (TDSDesk:<id>) in its narration: the
//	          cloud marks it posted with the voucher found; nothing is sent;
//	notseen   Tally answered for that exact company (its GUID the one held) and has no such voucher ON THAT DAY. Both
//	          reads are one-day reads (Tally may also have numbered the entry itself: Automatic numbering), so this is
//	          never "not found": the cloud releases nothing and nothing is sent. The owner's rule ("a duplicate entry must
//	          never be possible from this button"): a person looks in Tally and presses "I looked in Tally: not there -
//	          post again" (a reason required); only then is that entry alone handed back and sent once;
//	unable    anything else, in plain words: Tally not asked (the company not open, busy, the 2-second stop), the voucher
//	          there but with another FinCom id or none (a person must look), no number and no Tally id to ask by, a date
//	          the read rules do not allow (before the starting point, or more than 3 days back by number). Nothing is
//	          sent; the cloud keeps the check waiting and hands it again on a later turn (the one tried longest ago first), at
//	          most 10 tries or 24 hours, then "given up" in words; it never releases on "unable". At most 5 checks a turn,
//	          none while a posting is going on (postings first).
//
// The owner's rule for entry reads ("one voucher only, never a day's list or any earlier voucher"): only the two
// owner-approved one-voucher reads, exactly as the recorder builds them (the allow-list and its hash unchanged), as
// background requests (postings go first) with the 2-second stop, and only within their own date rules (tally.go
// datedRefused: never widened here; a date outside them is said, not asked). The bridge drops anything else Tally gives.
// No AI: plain matching of the id, the type, the number and the date.
package main

import (
	"errors"
	"fmt"
	"html"
	"path/filepath"
	"strings"
)

func checkMs() int { return keepNum("CheckMs", 2000) }

// the read's TC: a background read (FinCom's postings go first), stopped after CheckMs
func checkTC() *TC { return &TC{copier: true, limitMs: checkMs()} }

// Tally's own id for the entry from the posting's results: the cloud's (vchId), else this computer's record of the job
// (vchId, or LASTVCHID when the request held this one voucher only); "" when none
func checkVchID(c M, entry string) string {
	if v := onlyDigits(str(c["vchId"])); v != "" {
		return v
	}
	dir, err := jobDir(str(c["job"]))
	if err != nil {
		return ""
	}
	p := readObjFile(filepath.Join(dir, "progress.json"))
	for _, x := range arr(p["results"]) {
		r := obj(x)
		if r == nil || str(r["id"]) != entry {
			continue
		}
		if v := onlyDigits(str(r["vchId"])); v != "" {
			return v
		}
		if toInt(r["batchN"]) <= 1 {
			return onlyDigits(str(r["lastVchId"]))
		}
	}
	return ""
}

// one check from the cloud ({check, job, entry, company, xml, why, vchId}): the report to send (kind post_check)
func checkPostedEntry(c M) M {
	co, entry, xml := str(c["company"]), str(c["entry"]), str(c["xml"])
	rep := M{"kind": "post_check", "check": c["check"], "company": co}
	unable := func(why string) M { rep["result"], rep["words"] = "unable", cut(why, 480); return rep }
	look := "; look in Tally and use Mark posted, or post again only after checking"
	if xml == "" || entry == "" {
		return unable("FinCom sent no voucher for this entry; it is asked again")
	}
	if jobAlive(str(c["job"])) {
		return unable("The posting is still going on on this computer; Tally is looked in when it ends")
	}
	if err := postingAllowed(); err != nil {
		return unable(err.Error())
	}
	x, tag := stampFinComID(xml, entry) // the FinCom id exactly as the posting carried it
	date, vtype := voucherDateType(x)
	no := strings.TrimSpace(html.UnescapeString(tagRaw(x, "VOUCHERNUMBER")))
	if !isTallyDate(date) {
		return unable("The entry has no date to look for it on" + look)
	}
	mid := checkVchID(c, entry)
	// what may be asked (tally.go datedRefused, never widened): by number, one day from the starting point's day to
	// today and within the last 3 days; by Tally's id, one day once a starting point is recorded
	byNumber := no != "" && voucherByNumberRequest(co, date, vtype, no) != ""
	if !byNumber && mid == "" {
		return unable("FinCom cannot check this entry by itself (it has no voucher number and Tally gave no voucher id)" + look)
	}
	port, name, err := findCompanyNow(co, 0)
	if err != nil {
		return unable("Waiting for Tally to have " + co + " open (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	rep["company"] = name
	g, err := companyCheck(&TC{copier: true, light: true}, name, port) // the light company check, as a background one
	if err != nil {
		return unable("Tally did not answer for " + name + " (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	if gerr := guardCompanyGUID(name, g); gerr != nil {
		return unable("Not looked in: " + gerr.Error())
	}
	if _, ok := startPointOf(name); !ok {
		return unable("FinCom cannot look in " + name + " yet: no starting point is recorded for it on this computer; looked in again by itself")
	}
	if byNumber {
		day, today := startPointDay(name), nowFn().Format("20060102")
		why := ""
		switch {
		case day == "" || date < day:
			why = fmt.Sprintf("The entry is dated %s, before FinCom's starting point for %s (%s): FinCom reads no earlier entry, so it cannot check it by itself", ddmmyyyy(date), name, ddmmyyyy(day))
		case date > today:
			why = "The entry is dated " + ddmmyyyy(date) + ", after today: FinCom cannot check it by itself"
		case date < nowFn().AddDate(0, 0, -3).Format("20060102") && !liveNumberAsked(name, date, vtype, no):
			why = "The entry is dated " + ddmmyyyy(date) + ", more than 3 days ago: FinCom looks up an entry by its number only for recent days, so it cannot check it by itself"
		}
		if why != "" {
			if mid == "" {
				return unable(why + look)
			}
			byNumber = false // Tally's own id instead (no day bound but the starting point)
		}
	}
	// review H1 (05-Oct-2026): FinCom's voucher types number automatically, so Tally may have numbered the entry itself.
	// The voucher carrying the entry's FinCom id is found; the one asked carries another id or none: a person must look
	tagged := func(vs []string, by string) M {
		for _, v := range vs {
			if hasTag(tagValue(v, "NARRATION"), tag) {
				rep["result"], rep["vch"], rep["master"] = "found", tagValue(v, "VOUCHERNUMBER"), tagNum(v, "MASTERID")
				rep["words"] = cut(fmt.Sprintf("Found in %s: %s (Tally id %s), carrying %s", name, by, or(tagNum(v, "MASTERID"), "-"), tag), 480)
				return rep
			}
		}
		return nil
	}
	other := func(v, by string) M {
		carries := "no FinCom id"
		if o := reTag.FindString(tagValue(v, "NARRATION")); o != "" {
			carries = "another FinCom id (" + o + ")"
		}
		return unable(fmt.Sprintf("In %s, %s is there but carries %s, not %s: a person must look in Tally; use Mark posted if it is this entry, post again only if it is not", name, by, carries, tag))
	}
	// the owner's rule ("a duplicate entry must never be possible from this button"): both reads are one-day reads, so an
	// empty answer is never "not found": notseen (Tally answered for that exact company, no such voucher on that day). The
	// cloud releases nothing on it; a person looks in Tally and confirms "not there" (the only path to send again)
	notSeen := func(what string) M {
		rep["result"] = "notseen"
		rep["words"] = cut(fmt.Sprintf("Tally has no voucher %s on %s in %s. FinCom cannot see other dates, so a person must confirm: look in Tally (Day Book, or search the narration %s); if it is not there, press 'I looked in Tally: not there – post again' (reason required).", what, ddmmyyyy(date), name, tag), 480)
		return rep
	}
	busy := func(err error) M {
		return unable("Tally is busy or did not answer within " + fmt.Sprint(checkMs()/1000) + " s (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	byNumberWords := ""
	if byNumber {
		vs, err := fetchVoucherByNumber(checkTC(), name, port, date, vtype, no, 2)
		if err != nil {
			return busy(err)
		}
		byNumberWords = fmt.Sprintf("%s %s of %s", vtype, no, ddmmyyyy(date))
		if r := tagged(vs, byNumberWords); r != nil {
			return r
		}
		if mid == "" {
			if len(vs) > 0 {
				return other(vs[0], byNumberWords)
			}
			return notSeen(vtype + " " + no)
		}
	}
	// Tally's own id from its reply: the one voucher with that id
	got, err := fetchVouchersByMasterIn(checkTC(), name, port, date, []string{mid}, 2)
	if errors.Is(err, errFastShape) {
		return unable(postCheckShapeWords(name, mid, date, err)) // 2.3.4 (re-review L2): a person looks, never "busy"
	}
	if err != nil {
		return busy(err)
	}
	byID := fmt.Sprintf("Tally's voucher id %s of %s", mid, ddmmyyyy(date))
	if v := got[mid]; v != "" {
		if r := tagged([]string{v}, byID); r != nil {
			return r
		}
		return other(v, byID) // anything else Tally gave is dropped
	}
	// Tally has no voucher with that id (2.3.4: FinComVoucherObject asks the one voucher by its id, whatever its date; the
	// entry may have been deleted, or the id is another voucher's)
	what := "with Tally's id " + mid
	if byNumberWords != "" {
		what = vtype + " " + no + " / Tally's id " + mid
	}
	return notSeen(what)
}

// review M4: at most this many checks a turn (each may ask Tally for one voucher)
const checksPerTurn = 5

// a posting is going on on this computer (any job's worker running): no check asks Tally meanwhile (postings first)
func anyJobAlive() bool {
	jobsMu.Lock()
	defer jobsMu.Unlock()
	return len(jobsRunning) > 0
}

// the checks the cloud handed with posts_take, one at a time, at most checksPerTurn, none while a posting is going on;
// true when one came back "not found" and the cloud handed the posting back to be sent again (posts_take is then
// asked again)
func runPostChecks(list []any) bool {
	resent, seen, n := false, map[string]bool{}, 0
	for _, x := range list {
		c := obj(x)
		if c == nil || seen[fmt.Sprint(c["check"])] {
			continue
		}
		if n >= checksPerTurn || anyJobAlive() {
			break
		}
		n++
		seen[fmt.Sprint(c["check"])] = true
		rep := checkPostedEntry(c)
		r := invokeCloud(rep, 30)
		writeLog(fmt.Sprintf("Not in Tally - post again (entry %s of posting %s): %s: %s; FinCom: %s", str(c["entry"]), str(c["job"]), str(rep["result"]), str(rep["words"]),
			or(str(obj(r.json)["state"]), or(r.err, fmt.Sprint("HTTP ", r.code)))))
		if r.code == 200 && r.json != nil && truthy(r.json["resent"]) {
			resent = true
		}
	}
	return resent
}

// 2.3.4 (re-review L2): Tally keeps the voucher with that id in a form FinCom's entry request does not read whole: the check
// cannot read it by itself; a person looks in Tally
func postCheckShapeWords(name, mid, date string, err error) string {
	return fmt.Sprintf("In %s, Tally's voucher id %s of %s is kept in a form FinCom does not read by itself (%s): a person must look in Tally; use Mark posted if it is this entry, post again only if it is not",
		name, mid, ddmmyyyy(date), cutRunes(err.Error(), 200))
}
