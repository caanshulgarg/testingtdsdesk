// FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (the owner's re-scope): what keeps a read or a posting on the right
// company, never doubled, and never done by two bridges at once.
//
//   - The company's GUID. Every request names its company (SVCURRENTCOMPANY); the company's own GUID is read with a tiny
//     company-level request (FinComCompany: its name, GUID and highest AlterIDs) before a run reads it or a posting
//     posts to it, and also from the company list. The first GUID seen is held (sync\company-guids.json) and sent to
//     FinCom's cloud; a company of the same name with another GUID (a restored, re-created or other company) is refused:
//     nothing is read from it or posted to it until it is confirmed (POST /companyguid {company, accept: true}).
//   - The FinCom id. Every voucher posted carries "TDSDesk:<id>" first in its narration (FinCom writes it; the
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

// the company's highest master AlterID, as its last check said (0: not known)
func companyAlterM(company string) int64 {
	altMu.Lock()
	defer altMu.Unlock()
	return companyAltsM[companyKey(company)]
}

// the company-level check: its GUID (and its highest AlterIDs), one tiny request naming the company. "" when Tally
// does not list it that way (nothing to compare)
func companyCheck(tc *TC, company string, port int) (string, error) {
	// 2.2.0 (the owner's finding): the change numbers by the form kept for the company (a: NATIVEMETHOD; b: the report);
	// form a answering the company without numbers: form b once. Each request 15 s at most (CompanyCheckSec)
	sec := keepNum("CompanyCheckSec", 15)
	forms := []string{"a", "b"}
	if cnFormFor(company) == "b" {
		forms = []string{"b"}
	}
	guid, heads := "", []string{}
	listed := false
	for _, form := range forms {
		x := companyCheckRequest(company)
		if form == "b" {
			x = companyNumbersRequest(company)
		}
		raw, err := invokeTally(tc, port, x, sec)
		if err != nil {
			if !listed {
				return guid, err
			}
			break
		}
		heads = append(heads, answerHead(raw))
		found := false
		for _, c := range xmlDoc(raw).All("COMPANY") {
			if n := nameOf(c); n != "" && !sameCompany(n, company) {
				continue
			}
			found, listed = true, true
			if g := strings.TrimSpace(nt(c, "GUID")); g != "" {
				guid = g
			}
			if setCompanyAlts(company, c) {
				cnFormSay(company, form)
				return guid, nil
			}
			break
		}
		if !found && form == "a" {
			return "", nil // Tally does not list it that way: nothing to compare
		}
	}
	cnFormMiss(company, heads)
	return guid, nil
}

// --- the form that gave the change numbers, kept per company (sync\change-number-forms.json)
var (
	cnMu   sync.Mutex
	cnSaid = map[string]string{} // companyKey -> what was said last in this run: the form, or "none|<time>"
)

func cnFormsFile() string { return sp("change-number-forms.json") }

func cnFormFor(company string) string {
	cnMu.Lock()
	defer cnMu.Unlock()
	return str(obj(readObjFile(cnFormsFile())[companyKey(company)])["form"])
}

func cnFormSay(company, form string) {
	cnMu.Lock()
	all := readObjFile(cnFormsFile())
	if all == nil {
		all = M{}
	}
	k := companyKey(company)
	if str(obj(all[k])["form"]) != form {
		all[k] = M{"company": company, "form": form, "at": nowS()}
		_ = saveFile(cnFormsFile(), jsonText(all))
	}
	said := cnSaid[k] == form
	cnSaid[k] = form
	cnMu.Unlock()
	if !said {
		writeLog(fmt.Sprintf("Company %s: change numbers read with form %s: ALTVCHID=%d, ALTMSTID=%d", company, form, companyAlter(company), companyAlterM(company)))
	}
}

// neither form gave numbers: said with the answers' heads (tags only), once in 10 minutes per company
func cnFormMiss(company string, heads []string) {
	cnMu.Lock()
	k := companyKey(company)
	if last := cnSaid[k]; strings.HasPrefix(last, "none|") {
		if t, err := time.Parse(time.RFC3339, strings.TrimPrefix(last, "none|")); err == nil && nowFn().Sub(t) < 10*time.Minute {
			cnMu.Unlock()
			return
		}
	}
	cnSaid[k] = "none|" + nowFn().Format(time.RFC3339)
	cnMu.Unlock()
	writeLog("Company " + company + ": Tally gave no change numbers with form a or b (answer head: " + cut(strings.Join(heads, " / "), 400) + ")")
}

// the change numbers of a COMPANY element: noted; true when they are numbers above 0. Never 0 or empty as a starting
// point (the owner's finding: the real Tally answered empty tags)
func setCompanyAlts(company string, c *Node) bool {
	v, m := toI64(re(`\D`).ReplaceAllString(cnTag(c, "ALTVCHID"), "")), toI64(re(`\D`).ReplaceAllString(cnTag(c, "ALTMSTID"), ""))
	if v <= 0 && m <= 0 {
		return false
	}
	altMu.Lock()
	companyAlts[companyKey(company)] = v
	companyAltsM[companyKey(company)] = m
	altMu.Unlock()
	// round 18: the company's starting point (once, never at 0), and its latest numbers for the heartbeat (startpoint.go)
	noteStartPoint(company, strings.TrimSpace(html.UnescapeString(nt(c, "GUID"))), v, m)
	return true
}

// a change number's tag, in the spellings Tally may use (ALTVCHID, ALTVCHID.LIST)
func cnTag(c *Node, tag string) string {
	if v := strings.TrimSpace(nt(c, tag)); v != "" {
		return v
	}
	return strings.TrimSpace(nt(c, tag+".LIST"))
}

// the company check's answer to the small check after a timeout: its highest AlterIDs are noted too
func noteCompanyAlts(company, raw string) {
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if n := nameOf(c); n != "" && !sameCompany(n, company) {
			continue
		}
		setCompanyAlts(company, c)
		return
	}
}

// --- the FinCom id in the narration
const tagCheckID = "FinComTag"

// the voucher with its FinCom id FIRST in its narration ("TDSDesk:<id> | <rest>", so a narration cut at 300 characters
// can never lose it): FinCom's own when it wrote one (moved to the front when it is elsewhere in the narration), else
// the entry's id (letters and digits only, as FinCom reads tags), else one made from the voucher itself
func stampFinComID(x string, id any) (string, string) {
	if !re(`^\s*<VOUCHER\b`).MatchString(x) {
		return x, ""
	}
	if t := reTag.FindString(x); t != "" {
		return tagFirst(x, t), t
	}
	k := re(`[^A-Za-z0-9]`).ReplaceAllString(fmt.Sprint(id), "")
	if k == "" || id == nil {
		h := sha256.Sum256([]byte(x))
		k = "B" + strings.ToUpper(hex.EncodeToString(h[:]))[:16]
	}
	tag := "TDSDesk:" + k
	if loc := re(`<NARRATION>`).FindStringIndex(x); loc != nil {
		rest := x[loc[1]:]
		sep := " | "
		if re(`^\s*</NARRATION>`).MatchString(rest) {
			sep = ""
		}
		return x[:loc[1]] + tag + sep + rest, tag
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

// the voucher's narration with its tag (already in it) moved to the front: "TDSDesk:<id> | <the rest>"; the rest keeps
// its words, less the separator that stood next to the tag. A tag outside the narration is left where it is
func tagFirst(x, tag string) string {
	m := re(`<NARRATION>([\s\S]*?)</NARRATION>`).FindStringSubmatchIndex(x)
	if m == nil {
		return x
	}
	n := x[m[2]:m[3]]
	if !hasTag(n, tag) {
		return x
	}
	if first := reTag.FindStringIndex(n); first != nil && first[0] == 0 && n[:first[1]] == tag {
		return x // the exact tag is first already (not a longer tag starting with it)
	}
	// the exact token (never the prefix of a longer tag: TDSDesk:ab1 inside TDSDesk:ab12), spliced out
	rest := n
	for _, loc := range reTag.FindAllStringIndex(n, -1) {
		if n[loc[0]:loc[1]] == tag {
			rest = n[:loc[0]] + n[loc[1]:]
			break
		}
	}
	rest = re(`\s*\|\s*\|\s*`).ReplaceAllString(rest, " | ") // two separators left touching where the tag stood
	rest = re(`\s{2,}`).ReplaceAllString(rest, " ")          // the two spaces left where a tag stood between words
	rest = strings.TrimSpace(re(`^\s*\|\s*|\s*\|\s*$`).ReplaceAllString(rest, ""))
	n = tag
	if rest != "" {
		n = tag + " | " + rest
	}
	return x[:m[2]] + n + x[m[3]:]
}

// whether a narration carries this FinCom tag, anywhere in it and exactly (TDSDesk:ab1 is not TDSDesk:ab12)
func hasTag(narration, tag string) bool {
	if tag == "" {
		return false
	}
	for _, t := range reTag.FindAllString(narration, -1) {
		if t == tag {
			return true
		}
	}
	return false
}

func tagCheckRequest(company, date string) string {
	return fcCollection(tagCheckID, company, periodVars(date, date), "Voucher",
		"GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISOPTIONAL, ISCANCELLED", "")
}

// fault 1 (03-Oct-2026): the read-back by Tally's own voucher id (LASTVCHID in the import's answer = the voucher's
// MasterID), one month (the voucher's) filtered to that one id, heads and narration only
const masterCheckID = "FinComByMaster"

func masterCheckRequest(company, a, z string, master string) string {
	m := re(`\D`).ReplaceAllString(master, "")
	if m == "" {
		m = "0"
	}
	return fcCollection(masterCheckID, company, periodVars(a, z), "Voucher",
		"GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISOPTIONAL, ISCANCELLED", "$MasterID = "+m)
}

// the voucher with that MasterID in Tally, looked for in the month of the date given: nil when Tally lists none; an
// error when Tally did not answer properly
func voucherByMaster(port int, company, date, master string) (*vchKey, error) {
	if !isTallyDate(date) || re(`\D`).ReplaceAllString(master, "") == "" {
		return nil, nil
	}
	raw, err := invokeTally(fin, port, masterCheckRequest(company, date[:6]+"01", monthEnd(date[:6]), master), 0)
	if err != nil {
		return nil, err
	}
	if !goodDupAnswer(raw) {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	for _, v := range xmlDoc(raw).All("VOUCHER") {
		k := keyOfVoucher(v)
		if strings.TrimSpace(k.masterID) == strings.TrimSpace(master) {
			return &k, nil
		}
	}
	return nil, nil
}

// the head among those read back that is this entry: by its tag (wherever it is in the narration); else, when Tally
// gave a voucher id, the head with that MasterID provided its narration carries no OTHER FinCom tag (Tally's "last
// voucher id" can point at an older entry). how: "tag" or "voucher id"
func matchHead(heads []M, tag, lv string) (M, string) {
	if tag != "" {
		for _, h := range heads {
			if hasTag(str(h["narration"]), tag) {
				return h, "tag"
			}
		}
	}
	if lv != "" {
		for _, h := range heads {
			if str(h["masterId"]) == lv && !otherTag(str(h["narration"]), tag) {
				return h, "voucher id"
			}
		}
	}
	return nil, ""
}

// a FinCom tag in the narration that is not this entry's
func otherTag(narration, tag string) bool {
	for _, t := range reTag.FindAllString(narration, -1) {
		if t != tag {
			return true
		}
	}
	return false
}

// an accepted entry (CREATED/ALTERED with a voucher id) looked for in Tally: by its tag on its date, then by Tally's
// voucher id in its month. found: the head and how; not found: nil, ""; Tally not answering: an error (nothing is decided)
func findAccepted(port int, company, xml, lv string) (M, string, error) {
	date, tag := group(`<DATE>(\d{8})</DATE>`, xml, 1), reTag.FindString(xml)
	// first Tally's own voucher id, looked up directly (round 6)
	if lv != "" {
		k, err := voucherByMaster(port, company, date, lv)
		if err != nil {
			return nil, "", err
		}
		if k != nil && !k.cancelled && !otherTag(k.narration, tag) {
			return headOfKey(*k), "voucher id", nil
		}
	}
	// then the day's entries, by the tag
	var heads []M
	if date != "" {
		ks, err := tagsOnDate(port, company, date)
		if err != nil {
			return nil, "", err
		}
		for _, k := range ks {
			heads = append(heads, headOfKey(k))
		}
	}
	if h, how := matchHead(heads, tag, lv); h != nil {
		return h, how, nil
	}
	return nil, "", nil
}

// the result of an entry Tally accepted (CREATED/ALTERED with a voucher id) that the read-back could not confirm:
// never failed, never sent again; "unknown" (accepted, being checked) until it is found by its tag or by Tally's voucher
// id. heads: what the day's list held (for the log); lookedUp: what the voucher-id lookup said
func markAccepted(r M, company, job, lv string, heads []M, lookedUp string) {
	id, xs := str(r["id"]), str(r["xmlSent"])
	if xs == "" {
		xs = str(r["xml"])
	}
	date, tag := group(`<DATE>(\d{8})</DATE>`, xs, 1), reTag.FindString(xs)
	// ok false (round 5, C7): not posted as far as FinCom knows (an ALTERED one must not count as posted); accepted true:
	// never failed, never sent again (itemsToSend, confirmedResult, the job's count)
	r["ok"], r["verified"], r["outcomeUnknown"], r["accepted"], r["state"], r["lastVchId"] = false, nil, true, true, "unknown", lv
	delete(r, "altered1")
	said := "created"
	if toInt(r["altered"]) > 0 && toInt(r["created"]) == 0 {
		said = "altered"
	}
	r["message"] = fmt.Sprintf("Tally replied '%s' (voucher id %s) in job %s but the entry was not found yet in '%s' on %s; it is being checked and is not sent again", said, or(lv, "not given"), or(job, "-"), company, ddmmyyyy(date))
	key := acceptedKey(id, xs)              // one key everywhere: the id in the tag (round 7, F9)
	_ = noteAccepted(key, company, job, lv) // on disk: never sent again by any later job either
	if a := acceptedInfo(key); a != nil {
		r["acceptedAt"] = str(a["acceptedAt"])
	}
	var ids []string
	for _, h := range heads {
		ids = append(ids, str(h["masterId"]))
	}
	writeLog(fmt.Sprintf("  voucher %s: ACCEPTED BUT UNCONFIRMED: Tally replied CREATED %d ALTERED %d (LASTVCHID %s) for '%s' on %s (job %s); the day's list has %d entr%s (voucher ids: %s), none carrying %s; looked up by voucher id %s: %s; marked unknown (accepted, being checked), not sent again",
		id, toInt(r["created"]), toInt(r["altered"]), or(lv, "none"), company, date, or(job, "-"), len(heads), map[bool]string{true: "y", false: "ies"}[len(heads) == 1], or(strings.Join(ids, ", "), "-"), or(tag, "no tag"), or(lv, "none"), or(lookedUp, "not asked")))
}

// an entry Tally accepted: CREATED or ALTERED above 0 (a voucher id with it when Tally gave one)
func acceptedByTally(r M) bool { return toInt(r["created"]) > 0 || toInt(r["altered"]) > 0 }

// the results of entries Tally accepted, or held after a partial batch (round 7, F5), that are not confirmed yet:
// looked for again later, never sent again
func acceptedUnconfirmed(results []M) []M {
	var o []M
	for _, r := range results {
		if (r["accepted"] == true || r["held"] == true) && r["verified"] != true {
			o = append(o, r)
		}
	}
	return o
}

// an entry confirmed in Tally (its head h, found by how): noted on disk, and put in the copy. Round 7 (F6): a
// confirmation by Tally's voucher id with no tag in the narration goes into the copy only when the head's type, date
// and party are the entry's; otherwise the keeper reads the day
func confirmedInTally(company string, h M, xml, how, id string) {
	_ = noteVerified(acceptedKey(id, xml), company, h)
	if how == "voucher id" && !hasTag(str(h["narration"]), reTag.FindString(xml)) && !headMatchesXML(h, xml) {
		writeLog(fmt.Sprintf("  voucher %s: confirmed by Tally's voucher id %s, but the entry Tally lists (%s, %s, party %q) is not the one sent by type, date and party: not put in the copy; the keeper reads that day", id, str(h["masterId"]), str(h["type"]), str(h["date"]), str(h["party"])))
		return
	}
	addPostedForCopy(company, h, xml)
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

// this bridge holds the company's lease now (a posting or a read of its own is going)
func leaseHeldHere(company string) bool {
	leaseMu.Lock()
	defer leaseMu.Unlock()
	return time.Until(leases[company]) > 0
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
// (round 4: an AlterID not known, 0 or less, goes as null, never as 0: 0 would read as a rewind on the cloud)
func sendReadGuard(company, guid string, alter int64, count int) {
	if !cloudOn() {
		return
	}
	var alt any
	if alter > 0 {
		alt = alter
	}
	r := invokeCloud(M{"kind": "read_guard", "company": company, "guid": guid, "alter": alt, "count": count}, 30)
	if r.code == 200 && r.json != nil && str(r.json["state"]) == "needs_baseline" {
		writeLog("Keeping " + company + ": FinCom's cloud marks this company as needing its books again (" + str(r.json["why"]) + ")")
		setKeepTrouble(company, "FinCom's cloud marks this company as needing its books again: "+str(r.json["why"]))
	}
}

// the head Tally gave is the entry sent (its type, date and party): for the copy (round 7, F6: a confirmation by voucher
// id with no tag in the narration is put in the copy only when they match; else the keeper reads the day)
func headMatchesXML(h M, xml string) bool {
	vt := strings.TrimSpace(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, xml, 1))
	if vt == "" {
		vt = group(`VCHTYPE="([^"]*)"`, xml, 1)
	}
	if !strings.EqualFold(strings.TrimSpace(html.UnescapeString(vt)), strings.TrimSpace(str(h["type"]))) {
		return false
	}
	if normDate(str(h["date"])) != group(`<DATE>(\d{8})</DATE>`, xml, 1) {
		return false
	}
	party := foldName(html.UnescapeString(group(`<PARTYLEDGERNAME>([^<]*)</PARTYLEDGERNAME>`, xml, 1)))
	hp := str(h["party"])
	if party != "" && hp != "" && party != hp {
		return false
	}
	return true
}
