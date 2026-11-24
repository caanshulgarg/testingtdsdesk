package main

// next-bridge-reupload (24-Nov-2026; the owner's rule: an entry that is not really in the books never counts as posted).
// A sales invoice was posted as an Optional voucher, deleted in Tally by a person, then posted again from FinCom. This
// computer's record of what it sent (posted-ids.json, accepted.go) answered "already sent from this computer" without
// looking, so it could never go again; and 2.5.19's look before a re-sent entry took an Optional voucher for the entry.
//
//   - An entry FinCom hands with lookFirst (a person pressed "Not in Tally? Check and post again" and FinCom Bridge found
//     it not in the books) that this computer's record says was sent is looked for in Tally first: resentLook, 2.5.19's
//     look (FinComTag as built for its date, already on the allow-list, a posting's read, one in flight, under the 2 s
//     stop; no new request). Tally has a regular entry with its mark: refused on the record as before, said seen in
//     Tally. Tally has a regular entry of its type and number without the mark (fault 1 of 03-Oct-2026: a Tally that kept
//     the narration without it): refused as before, a person looks. Neither (deleted in Tally, or only an Optional or
//     cancelled voucher carries the mark): its note goes and it is sent again. The look could not be made: refused as
//     before, never sent on a guess. An entry held for a person, or whose date changed since it was sent: refused as
//     before. Without lookFirst the record is the only check, as since round 15 (fault 1 again: a look that does not see
//     the mark proves nothing by itself).
//   - /lookone: the same look for one entry, its answer only (there, unmarked, optional, cancelled, missing, unable);
//     nothing is sent and the record is not changed.

import (
	"errors"
	"html"
	"strings"
)

// whether the record's note for this entry may be looked past in Tally (see above), and why not when not
func recordLookable(id any, x string) (bool, string) {
	a := acceptedInfo(acceptedKey(str(id), x))
	if a == nil {
		return false, ""
	}
	if a["held"] == true {
		return false, "held for a person"
	}
	d, _ := voucherDateType(x)
	if !isTallyDate(d) {
		return false, "no date"
	}
	// the date it was sent with (kept since this branch), else the one Tally confirmed; none kept: notes of 2.5.20 and
	// before, looked for on the entry's own date
	if kd := or(str(a["date"]), str(a["vchDate"])); kd != "" && normDate(kd) != d {
		return false, "dated otherwise when it was sent"
	}
	return true, ""
}

// what Tally's entries of the entry's day say of it: there (a regular entry with its mark), unmarked (a regular entry of
// its type and number without the mark), optional or cancelled (only such a voucher carries the mark), or missing
func entryInDay(ks []vchKey, x string) (string, *vchKey) {
	tag := reTag.FindString(x)
	_, vt := voucherDateType(x)
	no := strings.TrimSpace(html.UnescapeString(tagRaw(x, "VOUCHERNUMBER")))
	var opt, can *vchKey
	for i := range ks {
		k := &ks[i]
		if tag == "" || !hasTag(k.narration, tag) {
			continue
		}
		switch {
		case k.cancelled:
			can = k
		case k.optional:
			opt = k
		default:
			return "there", k
		}
	}
	if no != "" {
		for i := range ks {
			k := &ks[i]
			if !k.cancelled && !k.optional && strings.EqualFold(strings.TrimSpace(k.vtype), strings.TrimSpace(vt)) && strings.TrimSpace(k.number) == no {
				return "unmarked", k
			}
		}
	}
	if opt != nil {
		return "optional", opt
	}
	if can != nil {
		return "cancelled", can
	}
	return "missing", nil
}

// the entries on the record (each lookable, handed with lookFirst) looked for in Tally: those to send again (their
// notes gone), and the refusals of the others (the record's, as before)
func recordLookFirst(port int, company string, items []M) (send []M, results []M) {
	reads := map[string][]vchKey{}
	fails := map[string]error{}
	for _, it := range items {
		k, x := str(it["id"]), str(it["xml"])
		d, _ := voucherDateType(x)
		if _, had := reads[d]; !had && fails[d] == nil {
			if ks, err := resentLook(port, company, d); err != nil {
				fails[d] = err
			} else {
				reads[d] = ks
			}
		}
		ref := sentBeforeRefusal(it["id"], x)
		if ref == nil {
			send = append(send, it)
			continue
		}
		ref["company"], ref["port"] = company, port
		if err := fails[d]; err != nil {
			ref["lookWords"] = "Tally could not be looked at for it (" + tallyTrouble(err.Error()) + ")"
			writeLog("  voucher " + k + ": NOT SENT: " + str(ref["message"]) + "; Tally could not be looked at for it, so it is not sent on a guess")
			results = append(results, ref)
			continue
		}
		st, e := entryInDay(reads[d], x)
		if st == "there" || st == "unmarked" {
			ref["seenInTally"] = true
			ref["seenVch"] = M{"guid": e.guid, "vchNo": e.number, "vchType": e.vtype, "vchDate": e.date, "masterId": e.masterID, "unmarked": st == "unmarked"}
			writeLog("  voucher " + k + ": NOT SENT: " + str(ref["message"]) + "; Tally has " + e.vtype + " no. " + e.number + " of " + ddmmyyyy(e.date) + map[bool]string{true: " without FinCom's mark (a person looks)", false: ", a regular entry"}[st == "unmarked"])
			results = append(results, ref)
			continue
		}
		writeLog("  voucher " + k + ": sent before from this computer, but not in Tally as a regular entry (" + st + "): sent again, as asked")
		acceptedForget(acceptedKey(k, x))
		send = append(send, it)
	}
	return send, results
}

// POST /lookone {company, guid, id, xml}: whether Tally has this one entry (its FinCom mark, on its date)
func lookOneEntry(p M) (M, error) {
	company := str(p["company"])
	if err := postingAllowedFor(company); err != nil {
		return nil, err
	}
	if company == "" {
		return nil, errors.New("No company given.")
	}
	unable := func(words string) (M, error) {
		return M{"ok": false, "state": "unable", "company": company, "message": words}, nil
	}
	x, _ := stampFinComID(str(p["xml"]), p["id"])
	tag := reTag.FindString(x)
	d, _ := voucherDateType(x)
	if str(p["id"]) == "" || tag == "" || !isTallyDate(d) {
		return unable("FinCom cannot look for this entry in Tally: it has no FinCom mark or no date. Look for it in Tally yourself.")
	}
	look, guid, err := findLinkedNow(p)
	if err != nil {
		return unable("Could not check Tally: " + err.Error())
	}
	port, name := look.port, look.name
	g, _, err := companyCheckSaid(fin, name, port)
	if err != nil {
		return unable("Could not check Tally (" + tallyTrouble(err.Error()) + "). Nothing was changed; try again when Tally is free.")
	}
	if normGUID(g) == "" || normGUID(g) != guid {
		return unable(openToPost(company))
	}
	// no posting to this Tally interleaves with the look (postings first: it waits for one going on)
	gate := postGate(port)
	gate.Lock()
	ks, err := resentLook(port, name, d)
	gate.Unlock()
	if err != nil {
		writeLog("Look in Tally for " + tag + " (" + name + ", " + ddmmyyyy(d) + "): could not be made: " + tallyTrouble(err.Error()))
		return unable("Tally could not be looked at for this entry (" + tallyTrouble(err.Error()) + "). Nothing was changed; try again when Tally is free.")
	}
	st, k := entryInDay(ks, x)
	out := M{"ok": true, "state": st, "company": name, "port": port, "date": d, "tag": tag}
	what := ""
	if k != nil {
		no := "without a number"
		if k.number != "" {
			no = "no. " + k.number
		}
		what = k.vtype + " " + no + " of " + ddmmyyyy(k.date)
		out["vchNo"], out["vchType"], out["vchDate"], out["guid"], out["masterId"] = k.number, k.vtype, k.date, k.guid, k.masterID
	}
	switch st {
	case "there":
		out["message"] = "It is in Tally: " + what + ", a regular entry."
	case "unmarked":
		out["message"] = "Tally has " + what + " without FinCom's mark: it may be this entry. Look at it in Tally; nothing was changed."
	case "optional":
		out["message"] = "In Tally only as an Optional voucher (" + what + "), which is not in the books."
	case "cancelled":
		out["message"] = "In Tally only as a cancelled voucher (" + what + "), which is not in the books."
	default:
		out["message"] = "Not in Tally: no entry of " + ddmmyyyy(d) + " in " + name + " carries FinCom's mark " + tag + "."
	}
	writeLog("Look in Tally for " + tag + " (" + name + ", " + ddmmyyyy(d) + "): " + st)
	return out, nil
}
