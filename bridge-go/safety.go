// FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (the owner's re-scope): what keeps a read or a posting on the right
// company, never doubled, and never done by two bridges at once.
//
//   - The company's GUID. Every request names its company (SVCURRENTCOMPANY); the company's own GUID is read with a tiny
//     company-level request (FinComCompany: its name, GUID and highest AlterIDs) before a run reads it or a posting
//     posts to it, and also from the company list. The first GUID seen is held (sync\company-guids.json) and sent to
//     FinCom's cloud; a company of the same name with another GUID (a restored, re-created or other company) is refused:
//     nothing is read from it or posted to it until it is confirmed (POST /companyguid {company, accept: true}).
//   - The FinCom id. Every voucher posted carries "TDSDesk:<id>" at the end of its narration (FinCom writes it; the
//     bridge adds it when it is missing, from the entry's id). Narration is used, not a UDF: a UDF needs a TDL installed
//     in Tally to be kept. Before a voucher is posted, Tally is read for that id on the voucher's date (FinComTag: the
//     date's entries, heads and narration only); found: not posted ("Already in Tally ..."). Then the 2.1.4 check of
//     party, bill number, date and amount, for bills typed in Tally directly.
//   - The lease. Only one bridge reads or posts a company at a time: before reading or posting a company the bridge
//     takes (or renews) a lease on it in FinCom's cloud (tally-ingest lease_take, migration-32), and gives way while
//     another bridge holds it. A cloud without the lease (migration-32 not applied yet, or offline): no lease, as before.
//   - The rewind guard. After each read the company's GUID, highest AlterID and the entries read go to FinCom's cloud
//     (read_guard); a GUID that changed, or numbers that went back, mark the company "needs_baseline" there.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"strings"
	"sync"
	"time"
)

// --- the company's GUID
var guidMu sync.Mutex

func guidFile() string { return sp("company-guids.json") }

func heldGUID(company string) string {
	guidMu.Lock()
	defer guidMu.Unlock()
	return str(obj(readObjFile(guidFile())[companyKey(company)])["guid"])
}

// a GUID Tally gave for a company: held when none is held yet; a different one is noted (never taken by itself)
func noteCompanyGUID(company, guid string) {
	guid = strings.TrimSpace(html.UnescapeString(guid))
	if company == "" || guid == "" {
		return
	}
	guidMu.Lock()
	defer guidMu.Unlock()
	all := readObjFile(guidFile())
	if all == nil {
		all = M{}
	}
	k := companyKey(company)
	e := obj(all[k])
	switch {
	case e == nil || str(e["guid"]) == "":
		all[k] = M{"name": company, "guid": guid, "at": nowS()}
		writeLog("Company " + company + ": its Tally GUID " + guid + " is held from now on")
	case str(e["guid"]) != guid:
		if str(e["seen"]) != guid {
			e["seen"], e["seenAt"] = guid, nowS()
			writeLog("Company " + company + ": Tally now gives another GUID (" + guid + ", held " + str(e["guid"]) + "); nothing is read from it or posted to it until it is confirmed")
		}
	default:
		if str(e["seen"]) != "" {
			delete(e, "seen")
			delete(e, "seenAt")
		}
	}
	_ = saveFile(guidFile(), jsonText(all))
}

// confirmed on this computer: the GUID Tally gives now is the company's from here on
func acceptCompanyGUID(company string) (M, error) {
	guidMu.Lock()
	defer guidMu.Unlock()
	all := readObjFile(guidFile())
	k := companyKey(company)
	e := obj(all[k])
	if e == nil || str(e["seen"]) == "" {
		return M{"ok": true, "guid": str(e["guid"]), "same": true}, nil
	}
	was := str(e["guid"])
	all[k] = M{"name": company, "guid": str(e["seen"]), "at": nowS(), "was": was}
	_ = saveFile(guidFile(), jsonText(all))
	writeLog("Company " + company + ": its new Tally GUID " + str(e["seen"]) + " was confirmed (was " + was + ")")
	return M{"ok": true, "guid": str(e["seen"]), "was": was}, nil
}

type guidError struct{ company, got, held string }

func (e *guidError) Error() string {
	return "the company named " + e.company + " in Tally is not the one this bridge keeps (its Tally GUID is " + e.got + ", the one held is " + e.held +
		": a restored, re-created or other company with the same name). Nothing is read from it or posted to it until it is confirmed on the Tally computer"
}
func isGUIDError(err error) bool {
	var g *guidError
	return errors.As(err, &g)
}

// refuse a company whose GUID is not the one held (the first one seen is held)
func guardCompanyGUID(company, guid string) error {
	guid = strings.TrimSpace(html.UnescapeString(guid))
	if guid == "" {
		return nil // Tally gave none: nothing to compare (an older Tally, or the company not listed)
	}
	noteCompanyGUID(company, guid)
	if h := heldGUID(company); h != "" && h != guid {
		return &guidError{company, guid, h}
	}
	return nil
}

var (
	altMu        sync.Mutex
	companyAlts  = map[string]int64{}
	companyAltsM = map[string]int64{}
)

func companyAlter(company string) int64 {
	altMu.Lock()
	defer altMu.Unlock()
	return companyAlts[companyKey(company)]
}

// the company-level check: its GUID (and its highest AlterIDs), one tiny request naming the company. "" when Tally
// does not list it that way (nothing to compare)
func companyCheck(tc *TC, company string, port int) (string, error) {
	raw, err := invokeTally(tc, port, companyCheckRequest(company), 15)
	if err != nil {
		return "", err
	}
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if n := nameOf(c); n != "" && !sameCompany(n, company) {
			continue
		}
		altMu.Lock()
		companyAlts[companyKey(company)] = toI64(re(`\D`).ReplaceAllString(nt(c, "ALTVCHID"), ""))
		companyAltsM[companyKey(company)] = toI64(re(`\D`).ReplaceAllString(nt(c, "ALTMSTID"), ""))
		altMu.Unlock()
		return strings.TrimSpace(nt(c, "GUID")), nil
	}
	return "", nil
}

// --- the FinCom id in the narration
const tagCheckID = "FinComTag"

// the voucher with its FinCom id at the end of its narration ("TDSDesk:<id>"): FinCom's own when it wrote one, else the
// entry's id (letters and digits only, as FinCom reads tags), else one made from the voucher itself
func stampFinComID(x string, id any) (string, string) {
	if !re(`^\s*<VOUCHER\b`).MatchString(x) {
		return x, ""
	}
	if t := reTag.FindString(x); t != "" {
		return x, t
	}
	k := re(`[^A-Za-z0-9]`).ReplaceAllString(fmt.Sprint(id), "")
	if k == "" || id == nil {
		h := sha256.Sum256([]byte(x))
		k = "B" + strings.ToUpper(hex.EncodeToString(h[:]))[:16]
	}
	tag := "TDSDesk:" + k
	if loc := re(`</NARRATION>`).FindStringIndex(x); loc != nil {
		pre := x[:loc[0]]
		sep := " | "
		if re(`<NARRATION>\s*$`).MatchString(pre) {
			sep = ""
		}
		return pre + sep + tag + x[loc[0]:], tag
	}
	if loc := re(`<NARRATION\s*/>`).FindStringIndex(x); loc != nil {
		return x[:loc[0]] + "<NARRATION>" + tag + "</NARRATION>" + x[loc[1]:], tag
	}
	if loc := re(`</DATE>`).FindStringIndex(x); loc != nil {
		return x[:loc[1]] + "<NARRATION>" + tag + "</NARRATION>" + x[loc[1]:], tag
	}
	open := re(`^\s*<VOUCHER\b[^>]*>`).FindString(x)
	return open + "<NARRATION>" + tag + "</NARRATION>" + x[len(open):], tag
}

func tagCheckRequest(company, date string) string {
	return fcCollection(tagCheckID, company, "<SVFROMDATE>"+date+"</SVFROMDATE><SVTODATE>"+date+"</SVTODATE>", "Voucher",
		"GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISOPTIONAL, ISCANCELLED", "")
}

// the entries in Tally on that date, heads and narration only, each with its FinCom id (an error when Tally did not
// answer properly)
func tagsOnDate(port int, company, date string) ([]vchKey, error) {
	raw, err := invokeTally(fin, port, tagCheckRequest(company, date), 0)
	if err != nil {
		return nil, err
	}
	if !goodDupAnswer(raw) {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	var out []vchKey
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		out = append(out, keyOfVoucher(v))
	}
	return out, nil
}

// --- the lease on a company, held in FinCom's cloud
var (
	leaseMu sync.Mutex
	leases  = map[string]time.Time{} // company -> until (held by this bridge)
)

func leaseSec() int { return keepNum("LeaseSec", 120) }

// take or renew the lease on a company: true to go on; false and who holds it when another bridge does. A cloud that
// does not keep leases (migration-32 not applied), a company not linked, or no cloud: no lease, as before
func leaseTake(company string) (bool, string) {
	if !cloudOn() || company == "" {
		return true, ""
	}
	leaseMu.Lock()
	u := leases[company]
	leaseMu.Unlock()
	if time.Until(u) > time.Duration(leaseSec()/2)*time.Second {
		return true, ""
	}
	r := invokeCloud(M{"kind": "lease_take", "company": company, "ttl": leaseSec()}, 15)
	if r.code != 200 || r.json == nil || r.json["lease"] == nil && r.json["held"] == nil {
		return true, "" // no lease kept there: as before
	}
	if truthy(r.json["held"]) {
		h := obj(r.json["holder"])
		who := strings.TrimSpace(str(h["computer"]) + " " + str(h["bridge"]))
		if who == "" {
			who = "another computer"
		}
		if t := str(h["until"]); t != "" {
			who += ", until " + t
		}
		return false, who
	}
	leaseMu.Lock()
	leases[company] = time.Now().Add(time.Duration(leaseSec()) * time.Second)
	leaseMu.Unlock()
	return true, ""
}

func leaseRelease(company string) {
	leaseMu.Lock()
	_, had := leases[company]
	delete(leases, company)
	leaseMu.Unlock()
	if had && cloudOn() {
		invokeCloud(M{"kind": "lease_release", "company": company}, 15)
	}
}
func leasesHeld() []string {
	leaseMu.Lock()
	defer leaseMu.Unlock()
	var o []string
	for c := range leases {
		o = append(o, c)
	}
	return o
}

// --- the rewind guard: what this read saw, for FinCom's cloud
func sendReadGuard(company, guid string, alter int64, count int) {
	if !cloudOn() {
		return
	}
	r := invokeCloud(M{"kind": "read_guard", "company": company, "guid": guid, "alter": alter, "count": count}, 30)
	if r.code == 200 && r.json != nil && str(r.json["state"]) == "needs_baseline" {
		writeLog("Keeping " + company + ": FinCom's cloud marks this company as needing its books again (" + str(r.json["why"]) + ")")
		setKeepTrouble(company, "FinCom's cloud marks this company as needing its books again: "+str(r.json["why"]))
	}
}
