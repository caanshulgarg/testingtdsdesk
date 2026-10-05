// Decision B (the owner, 05-Oct-2026; migration 55): "Not in Tally - post again". Any member of the firm may settle a
// posting whose result is uncertain, but before anything is sent again this bridge (the posting's own) looks in that
// company in Tally for the entry and tells FinCom's cloud what it saw:
//
//	found     its FinCom id (TDSDesk:<id>) in a narration on the entry's date, else the entry's type and number on that
//	          date (an entry altered by hand): the cloud marks it posted with the voucher found; nothing is sent;
//	notfound  Tally answered the read in full for that exact company (its GUID the one held) and no entry is it: the cloud
//	          releases the id and hands the posting back, and it is sent once;
//	unable    Tally could not be asked (the company not open, Tally busy or not answering within CheckSec, the company's
//	          GUID not the one held, the posting still going on here): nothing is sent; the cloud keeps the check waiting
//	          and hands it again on the next turn.
//
// The read is FinComTag (tagCheckRequest: one date's heads and narrations), the one a posting's read-back already uses,
// built by the same builder: no new request shape, the allow-list unchanged. It goes through invokeTally like every
// request, after the company check (FinComCompany), and is stopped after CheckSec (2 s) so Tally is never held. It is a
// person's request (TC.person: a member pressed the button), as the tray's read test is, so it goes with ReadDays off.
// No AI: plain matching of the id, the type, the number and the date.
package main

import (
	"fmt"
	"html"
	"strings"
)

func checkSec() int { return keepNum("CheckSec", 2) }

// one check from the cloud ({check, job, entry, company, xml, why}): the report to send (kind post_check)
func checkPostedEntry(c M) M {
	co, entry, xml := str(c["company"]), str(c["entry"]), str(c["xml"])
	rep := M{"kind": "post_check", "check": c["check"], "company": co}
	unable := func(why string) M { rep["result"], rep["words"] = "unable", cut(why, 480); return rep }
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
		return unable("The entry has no date to look for it on")
	}
	port, name, err := findCompanyNow(co, 0)
	if err != nil {
		return unable("Waiting for Tally to have " + co + " open (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	rep["company"] = name
	g, err := companyCheck(fin, name, port)
	if err != nil {
		return unable("Tally did not answer for " + name + " (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	if gerr := guardCompanyGUID(name, g); gerr != nil {
		return unable("Not looked in: " + gerr.Error())
	}
	ks, err := tagsOnDateWithin(port, name, date, checkSec())
	if err != nil {
		return unable("Tally is busy or did not answer within " + fmt.Sprint(checkSec()) + " s (" + tallyTrouble(err.Error()) + "); looked in again by itself")
	}
	found := func(k vchKey, how string) M {
		rep["result"], rep["vch"], rep["master"] = "found", strings.TrimSpace(k.number), strings.TrimSpace(k.masterID)
		rep["words"] = cut(fmt.Sprintf("Found in %s on %s %s: %s %s (Tally id %s)", name, ddmmyyyy(date), how, or(k.vtype, vtype), or(strings.TrimSpace(k.number), "no number"), or(k.masterID, "-")), 480)
		return rep
	}
	for _, k := range ks {
		if hasTag(k.narration, tag) {
			return found(k, "by its FinCom id "+tag)
		}
	}
	if no != "" {
		for _, k := range ks {
			if strings.EqualFold(strings.TrimSpace(k.number), no) && strings.EqualFold(strings.TrimSpace(k.vtype), strings.TrimSpace(vtype)) && normDate(k.rawDate) == date && !otherTag(k.narration, tag) {
				return found(k, "by type, number and date")
			}
		}
	}
	rep["result"] = "notfound"
	rep["words"] = cut(fmt.Sprintf("Looked in %s on %s (FinComTag): %d entr%s, none with %s%s", name, ddmmyyyy(date), len(ks), map[bool]string{true: "y", false: "ies"}[len(ks) == 1], tag,
		map[bool]string{true: "", false: " or " + vtype + " " + no}[no == ""]), 480)
	return rep
}

// the entries on that date (FinComTag, as tagsOnDate), the bridge stopping after sec seconds
func tagsOnDateWithin(port int, company, date string, sec int) ([]vchKey, error) {
	// a person's request (a member pressed "Not in Tally - post again"): one date's heads, as the posting's read-back;
	// it passes "reading is prospective only" as the other reads a person starts do (datedRefused), never a background one
	raw, err := invokeTally(&TC{person: true}, port, tagCheckRequest(company, date), sec)
	if err != nil {
		return nil, err
	}
	if !goodDupAnswer(raw) {
		return nil, fmt.Errorf("Tally's answer could not be read: %s", cut(flat(raw), 120))
	}
	var out []vchKey
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		out = append(out, keyOfVoucher(v))
	}
	return out, nil
}

// the checks the cloud handed with posts_take, one at a time; true when one came back "not found" and the cloud handed
// the posting back to be sent again (posts_take is then asked again)
func runPostChecks(list []any) bool {
	resent, seen := false, map[string]bool{}
	for _, x := range list {
		c := obj(x)
		if c == nil || seen[fmt.Sprint(c["check"])] {
			continue
		}
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
