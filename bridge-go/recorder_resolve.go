// Bridge 2.2.1 (the owner's real-Tally result on NWS144, 05-Oct-2026): a NEW entry arrives as created with its real
// GUID, MasterID, AlterID and body.
//
// Tally writes the add-on's line for a new entry at Form Accept, before the save: GUID "<company GUID>-00000000",
// MasterID 0, AlterID 0. When the line has the MasterID (the post line), the GUID is rebuilt from it and the body asked
// by MasterID (recorder_live.go). When it has none, the entry is found straight after the save by its type and number
// on its own date: FinComVoucherByNumber (one day, one entry expected; asked a few seconds after the line, again 10 s
// apart, 3 times at most). None or two found: the line goes without its body and GUID (FinCom holds it) and is kept in
// a small list (sync\recorder-held.json) to be resolved later: a created line with the real GUID and body, its line id
// the held line's + ":resolved", once.
//
// On 2.2.1's first run the add-on's files of the last 7 days are read again (read only, as always) for the lines 2.2.0
// sent with a placeholder GUID (Receipts 191 and 192 on NWS144): they join the list.
//
// 2.2.2 (the owner's NWS144 findings, 05-Oct-2026): the line's GUID and AlterID are never trusted (a voucher duplicated
// from an older one carries the SOURCE's). Every voucher's entry is fetched by its MasterID (else by type, number and
// date) and taken only when Tally's GUID is its own MASTERID in hex under the company's GUID and its type, date and
// number are the line's (liveVoucherWrong); else the line goes held with plain words (heldWhy). Every voucher line sent
// without its entry joins the list; each is asked again 20 times at most. The add-on's files are read again once per
// version of the bridge.
package main

import (
	"errors"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// --- the request's guard (tally.go datedRefused): exactly as built, one day, from the starting point's day to today,
// and within the last 3 days or the day of a line the bridge is asking for
var (
	numberAskMu sync.Mutex
	numberAsks  = map[string]time.Time{}
)

func numberAskKey(company, date, typ, no string) string {
	return companyKey(company) + "|" + normDate(date) + "|" + typ + "|" + no
}

// the bridge is about to ask for this line's entry
func liveNumberAsk(company, date, typ, no string) {
	numberAskMu.Lock()
	defer numberAskMu.Unlock()
	for k, at := range numberAsks {
		if time.Since(at) > 2*time.Minute {
			delete(numberAsks, k)
		}
	}
	numberAsks[numberAskKey(company, date, typ, no)] = time.Now()
}

func liveNumberAsked(company, date, typ, no string) bool {
	numberAskMu.Lock()
	defer numberAskMu.Unlock()
	at, ok := numberAsks[numberAskKey(company, date, typ, no)]
	return ok && time.Since(at) <= 2*time.Minute
}

func voucherByNumberExact(x string) bool {
	if tallyRequestID(x) != vchByNumberID {
		return false
	}
	a, z := requestFrom(x)
	if len(a) != 8 || a != z {
		return false
	}
	co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
	no := html.UnescapeString(group(`\$VoucherNumber = &#34;(.*?)&#34; AND \$VoucherTypeName = &#34;`, x, 1))
	typ := pinQuoted(x, "$VoucherTypeName")
	if b := voucherByNumberRequest(co, a, typ, no); b == "" || x != b {
		return false
	}
	if _, ok := startPointOf(co); !ok {
		return false
	}
	day, today := startPointDay(co), nowFn().Format("20060102")
	if day == "" || a < day || a > today {
		return false
	}
	return a >= nowFn().AddDate(0, 0, -3).Format("20060102") || liveNumberAsked(co, a, typ, no)
}

// the day (yyyymmdd) the company's starting point was recorded on ("" : none)
func startPointDay(company string) string {
	held := heldGUID(company)
	spMu.Lock()
	defer spMu.Unlock()
	spFresh()
	all, _ := readStartPoints()
	all = spWithPending(all)
	e, _ := startPointPick(startPointsOf(all, company), held, spGUID[company])
	if e == nil {
		return ""
	}
	at := strings.ReplaceAll(str(e["at"]), "-", "")
	if len(at) < 8 || !isTallyDate(at[:8]) {
		return ""
	}
	return at[:8]
}

// --- the ask
// the entries Tally gives with this type and number on that date (each <VOUCHER ...>...</VOUCHER>)
func fetchVoucherByNumber(tc *TC, company string, port int, date, typ, no string, sec int) ([]string, error) {
	x := voucherByNumberRequest(company, date, typ, no)
	if x == "" {
		return nil, errors.New("its type or number cannot be asked of Tally (a quote or a line break in it)")
	}
	raw, err := invokeTally(tc, port, x, sec)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	var out []string
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		if strings.TrimSpace(html.UnescapeString(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, m, 1))) == typ &&
			strings.TrimSpace(html.UnescapeString(group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, m, 1))) == no &&
			normDate(group(`<DATE>([^<]*)</DATE>`, m, 1)) == normDate(date) {
			out = append(out, cleanXML(m))
		}
	}
	return out, nil
}

// 2.2.2 (the owner's rule, NWS144 05-Oct-2026): what the line says of its entry, to check Tally's voucher against.
// The line's GUID and AlterID are never trusted: its MasterID is the one asked, and its AlterID before the save
// (lineAlter) is only a lower bound for Tally's
type liveWant struct {
	company, cguid, typ, no, date, mid string
	sp                                 int64 // the company's starting point
	spOK                               bool  // a starting point is recorded (security L6: else nothing is taken)
	lineAlter                          int64
}

func liveWantOf(c *change, sp int64, spOK bool) liveWant {
	return liveWant{company: c.company, cguid: c.companyGuid, typ: c.vchType, no: c.vchNo, date: c.vchDate, mid: c.masterId, sp: sp, spOK: spOK, lineAlter: c.lineAlter}
}

// a yyyymmdd date as the owner reads it (05-Oct-2026)
func liveDay(d string) string {
	if isTallyDate(d) {
		return fromTallyDate(d).Format("02-Jan-2006")
	}
	return d
}

func aOr(w string) string {
	if w != "" && strings.ContainsRune("AEIOUaeiou", rune(w[0])) {
		return "an " + w
	}
	return "a " + w
}

// what a refusal means for asking again: "retry" (Tally may give it later), "final" (another voucher, or one below the
// starting point: no ask can change it), "nosave" (the voucher with that MasterID was not saved after the line: the
// line is about another entry, found by its number if it has one)
const (
	wrongRetry  = "retry"
	wrongFinal  = "final"
	wrongNoSave = "nosave"
)

// Tally's voucher is the line's entry only when (the owner's rule, with the coordinator's correction of 05-Oct-2026):
//   - its GUID is the line company's GUID and its own MASTERID in hex; or a GUID with ANOTHER prefix (an entry that came
//     by Tally synchronisation or an XML import keeps its original GUID: Tally answers within the company, so it is
//     this company's) when its MASTERID is the MasterID asked; a GUID with the company's prefix and another suffix is
//     never Tally's own: refused;
//   - its ALTERID (Tally's, never the line's) is above the starting point, checked first after the GUIDs (security M1:
//     nothing of a voucher below it is named), and above the line's AlterID before the save (review H2);
//   - its type and date are the line's, its number too when the line has one.
//
// "" : it is; else plain words (never Tally's GUID) and what they mean for asking again. who: "voucher with MasterID
// 25683"
func liveVoucherWrong(x, who string, w liveWant) (string, string) {
	if strings.TrimSpace(x) == "" {
		return "Tally gave no " + who + " on " + liveDay(w.date), wrongRetry
	}
	field := func(tag string) string {
		return strings.TrimSpace(html.UnescapeString(group(`<`+tag+`>([^<]*)</`+tag+`>`, x, 1)))
	}
	g, typ, no, date := field("GUID"), field("VOUCHERTYPENAME"), field("VOUCHERNUMBER"), normDate(field("DATE"))
	mid, alter := toI64(group(`<MASTERID>\s*(\d+)`, x, 1)), toI64(group(`<ALTERID>\s*(\d+)`, x, 1))
	cg := w.cguid
	held := heldGUID(w.company)
	if cg == "" {
		cg = held
	}
	lineType := or(w.typ, "entry")
	own := cg != "" && strings.HasPrefix(strings.ToLower(g), strings.ToLower(cg)+"-")
	switch {
	case g == "" || livePlaceholder(g):
		return "Tally's " + who + " came without its GUID", wrongRetry
	case cg == "":
		return "the company's GUID is not known here, so Tally's " + who + " cannot be checked", wrongRetry
	case held != "" && !strings.EqualFold(cg, held):
		return "the line's company GUID is not the one held for this company", wrongFinal
	case !w.spOK:
		return "the company's starting point is not recorded yet, so its entries are not taken from Tally", wrongRetry
	case alter <= w.sp:
		return "Tally's voucher with that MasterID is not a change after the starting point", wrongFinal
	case own && (mid <= 0 || guidHexIs(g[len(cg)+1:], mid) == false):
		return "Tally's voucher with that MasterID has a GUID that is not its MasterID, so it cannot be Tally's own", wrongFinal
	case !own && w.mid != "" && mid != toI64(w.mid):
		return "Tally's voucher came with another MasterID than the one asked", wrongFinal
	case w.lineAlter > 0 && alter <= w.lineAlter:
		return "Tally's " + who + " was not saved after this line (its AlterID is still the line's): no save of it happened here", wrongNoSave
	case (w.typ != "" && typ != w.typ) || date != w.date:
		return fmt.Sprintf("Tally's %s is %s of %s, not this %s of %s", who, aOr(or(typ, "voucher")), liveDay(date), lineType, liveDay(w.date)), wrongFinal
	case w.no != "" && no != w.no:
		return fmt.Sprintf("Tally's %s is %s %s, not this %s %s", who, typ, or(no, "(no number)"), lineType, w.no), wrongFinal
	}
	return "", ""
}

// the hex digits s are exactly the number n
func guidHexIs(s string, n int64) bool {
	if s == "" || len(s) > 15 {
		return false
	}
	v, ok := int64(0), true
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= '0' && r <= '9':
			v = v*16 + int64(r-'0')
		case r >= 'a' && r <= 'f':
			v = v*16 + int64(r-'a'+10)
		default:
			ok = false
		}
	}
	return ok && v == n
}

// the one entry with the line's type and number on its date, checked as above: its XML, or why not and what that
// means. The line asking is registered first (security L5: the guard's "a line the bridge is asking for")
func liveOneByNumber(tc *TC, company string, port int, w liveWant, sec int) (string, string, string, error) {
	liveNumberAsk(company, w.date, w.typ, w.no)
	got, err := fetchVoucherByNumber(tc, company, port, w.date, w.typ, w.no, sec)
	if err != nil {
		return "", "", "", err
	}
	switch len(got) {
	case 0:
		return "", fmt.Sprintf("Tally gave no %s %s of %s", w.typ, w.no, liveDay(w.date)), wrongRetry, nil
	case 1:
	default:
		return "", fmt.Sprintf("%d entries with that type and number on that date", len(got)), wrongRetry, nil
	}
	w.mid = "" // found by number: its MasterID is Tally's own
	if why, kind := liveVoucherWrong(got[0], fmt.Sprintf("voucher %s %s", w.typ, w.no), w); why != "" {
		return "", why, kind, nil
	}
	return got[0], "", "", nil
}

// under live.mu: a change takes the entry's GUID, numbers and body
func liveTakeBody(c *change, x string) {
	c.xml, c.bodyTried, c.byNumber = x, true, false
	c.guid = strings.TrimSpace(html.UnescapeString(group(`<GUID>([^<]*)</GUID>`, x, 1)))
	c.masterId = onlyDigits(group(`<MASTERID>\s*(\d+)`, x, 1))
	c.alterId = onlyDigits(group(`<ALTERID>\s*(\d+)`, x, 1))
	if c.narr == "" {
		c.narr = html.UnescapeString(group(`<NARRATION>([^<]*)</NARRATION>`, x, 1))
	}
	if c.vchType == "" {
		c.vchType = strings.TrimSpace(html.UnescapeString(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, x, 1)))
	}
	if c.vchNo == "" {
		c.vchNo = strings.TrimSpace(html.UnescapeString(group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, x, 1)))
	}
	c.heldWhy = ""
	c.ledgers = voucherLedgerNames(x)
	if c.during {
		for _, n := range c.ledgers {
			liveTouch(c.company, n)
		}
	}
}

// a line that goes without its entry, and why (sent as heldWhy; FinCom holds it; the held list asks again)
func liveNumberHeld(c *change, why string) { liveHeldAs(c, why, false) }

// final: no further ask can change why (not asked again by the held list)
func liveHeldAs(c *change, why string, final bool) {
	why = liveCapWhy(why)
	live.mu.Lock()
	c.bodyTried, c.heldWhy = true, why
	c.heldFinal = c.heldFinal || final
	live.mu.Unlock()
	writeLog(fmt.Sprintf("Recorder: %s of %s in %s: %s; sent without its body and GUID (FinCom holds the line until it is resolved)",
		or(strings.TrimSpace(c.vchType+" "+c.vchNo), "an entry"), c.vchDate, c.company, cutRunes(why, 200)))
}

// the new entries of one company (MasterID 0 on their line) by type and number, as a background read like the body
// fetch: it gives way to a posting, the 2 s rule turns it off for the company, 20 s in all
func liveFetchByNumber(cs []*change, sp int64, spOK bool) {
	if len(cs) == 0 {
		return
	}
	company, key := cs[0].company, cs[0].key()
	deadline := time.Now().Add(time.Duration(liveBodySec()) * time.Second)
	yield := func() bool { return postingGoing() || importsInFlight.Load() > 0 }
	slow := false
	tc := recorderTC(func(sec float64) {
		if sec > liveLimitSec() && !slow {
			slow = true
			liveTurnOff("bodies", key, company, sec)
		}
	})
	port, err := findCompanyPort(company, 0)
	if err != nil {
		if yield() {
			return
		}
		for _, c := range cs {
			liveNumberHeld(c, "not found by its type and number ("+err.Error()+")")
		}
		return
	}
	retry := time.Duration(keepNumZero("RecorderNumberRetryMs", 10000)) * time.Millisecond
	for _, c := range cs {
		if c.vchNo == "" {
			// 2.2.2: an entry without a voucher number (many Journals) and no MasterID on its line: nothing to ask by
			liveNumberHeld(c, "the line has no MasterID and the entry no voucher number, so Tally cannot be asked for it")
			continue
		}
		if slow || time.Now().After(deadline) {
			liveNumberHeld(c, "not found by its type and number (the body fetch is off for this company, the 2 s rule, or 20 s passed)")
			continue
		}
		left := maxI(2, int(time.Until(deadline).Seconds()+0.999))
		x, why, kind, err := liveOneByNumber(tc, company, port, liveWantOf(c, sp, spOK), left)
		if gaveWay(err) {
			return
		}
		live.mu.Lock()
		switch {
		case err == nil && x != "":
			liveTakeBody(c, x)
			live.mu.Unlock()
			continue
		case err == nil && !strings.HasPrefix(why, "Tally gave no "):
			// two entries, or another entry than the line's: held at once
			live.mu.Unlock()
			liveHeldAs(c, why, kind == wrongFinal)
			continue
		}
		c.numTries++
		if c.numTries < 3 {
			c.askAfter = time.Now().Add(retry)
			live.mu.Unlock()
			continue
		}
		live.mu.Unlock()
		why = "not found by its type and number (asked 3 times)"
		if err != nil {
			why = "not found by its type and number: " + err.Error()
		}
		liveNumberHeld(c, why)
	}
}

// --- the held list: lines sent without their entry's GUID and body (sync\recorder-held.json), resolved once
type heldLine struct {
	ID, Company, CGUID, Type, No, Date, MID, At, Added, Last string
	Tries                                                    int
	Ev, Why                                                  string // 2.2.2: the event the line went as ("" : created); why it stays held
	// 2.2.2 review: the line's flag and GUID (kept on its :resolved line), its FinCom id not the entry's, its AlterID before
	// the save (a lower bound for Tally's), and held for a reason no ask can change (never asked again)
	LineGuid, LineFid string
	Mismatch, Final   bool
	LineAlter         int64
}

var heldMu sync.Mutex

func liveHeldFile() string { return sp("recorder-held.json") }

func liveHeldLoad() (M, map[string]heldLine) {
	all := readObjFile(liveHeldFile())
	if all == nil {
		all = M{}
	}
	items := map[string]heldLine{}
	for id, v := range obj(all["items"]) {
		e := obj(v)
		items[id] = heldLine{ID: id, Company: str(e["company"]), CGUID: str(e["companyGuid"]), Type: str(e["type"]), No: str(e["no"]), Date: str(e["date"]),
			MID: str(e["masterId"]), At: str(e["savedAt"]), Added: str(e["added"]), Last: str(e["last"]), Tries: toInt(e["tries"]), Ev: str(e["event"]), Why: str(e["why"]),
			LineGuid: str(e["lineGuid"]), LineFid: str(e["lineFid"]), Mismatch: truthy(e["idsMismatch"]), Final: truthy(e["final"]), LineAlter: toI64(e["lineAlter"])}
	}
	return all, items
}

func liveHeldSave(all M, items map[string]heldLine) {
	o := M{}
	for id, h := range items {
		o[id] = M{"company": h.Company, "companyGuid": h.CGUID, "type": h.Type, "no": h.No, "date": h.Date, "masterId": h.MID, "savedAt": h.At,
			"added": h.Added, "last": h.Last, "tries": h.Tries, "event": h.Ev, "why": liveCapWhy(h.Why), "lineGuid": h.LineGuid, "lineFid": h.LineFid,
			"idsMismatch": h.Mismatch, "final": h.Final, "lineAlter": h.LineAlter}
	}
	all["items"] = o
	if err := saveFile(liveHeldFile(), jsonText(all)); err != nil {
		writeLog("Recorder: " + liveHeldFile() + " could not be written: " + err.Error())
	}
}

// lines just sent held: kept to be resolved (asked again after RecorderResolveSec, 10 minutes)
func liveHeldAdd(cs []*change) {
	if len(cs) == 0 {
		return
	}
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	now := nowFn().Format(time.RFC3339)
	for _, c := range cs {
		mid := c.masterId
		if strings.Contains(c.heldWhy, "was not saved after this line") {
			mid = "" // review H2: the voucher with that MasterID is not this line's entry: asked by its number only
		}
		items[c.lineId] = heldLine{ID: c.lineId, Company: c.company, CGUID: c.companyGuid, Type: c.vchType, No: c.vchNo, Date: c.vchDate, MID: mid,
			At: c.at, Added: now, Last: now, Ev: c.event, Why: c.heldWhy, LineGuid: c.lineGuid, LineFid: c.lineFid, Mismatch: c.idsMismatch,
			Final: c.heldFinal || (mid == "" && c.vchNo == ""), LineAlter: c.lineAlter}
	}
	liveHeldCap(items)
	liveHeldSave(all, items)
}

// security L3: the held list is bounded: 500 lines a company, 2,000 in all; the oldest go first (said in the log)
func liveHeldCap(items map[string]heldLine) {
	type it struct{ id, co, added string }
	var all []it
	for id, h := range items {
		all = append(all, it{id, h.Company + "|" + h.CGUID, h.Added})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].added != all[j].added {
			return all[i].added > all[j].added
		}
		return all[i].id > all[j].id
	}) // newest first
	per := map[string]int{}
	n, dropped := 0, 0
	for _, x := range all {
		per[x.co]++
		n++
		if per[x.co] > keepNum("RecorderHeldMaxCompany", 500) || n > keepNum("RecorderHeldMax", 2000) {
			delete(items, x.id)
			dropped++
			n--
			per[x.co]--
		}
	}
	if dropped > 0 {
		writeLog(fmt.Sprintf("Recorder: the held list is full: the %d oldest line(s) left it (FinCom still holds them; the Day Book upload settles them)", dropped))
	}
}

// --- the first run: the lines 2.2.0 sent with a placeholder GUID, from the add-on's files of the last 7 days (read only)
func liveRescanOnce() {
	live.mu.Lock()
	liveFresh()
	if live.scanned {
		live.mu.Unlock()
		return
	}
	live.scanned = true
	live.mu.Unlock()
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	// 2.2.2: once per version of the bridge (2.2.1 kept only the time of its scan)
	if str(all["scannedVersion"]) == BridgeVersion {
		return
	}
	// review M1: 2.2.1 scanned already (its time is kept): its placeholder lines whose post had a MasterID went with their
	// body then; only a line with no MasterID, a GUID of another entry, or read while the body fetch was off is asked
	found := liveRescanFiles(str(all["scanned"]) != "")
	now := nowFn().Format(time.RFC3339)
	for _, h := range found {
		if _, had := items[h.ID]; !had {
			h.Added = now
			items[h.ID] = h
		}
	}
	all["scanned"], all["scannedVersion"] = now, BridgeVersion
	liveHeldSave(all, items)
	if len(found) > 0 {
		writeLog(fmt.Sprintf("Recorder: %d line(s) sent earlier without their entry (a placeholder GUID, a GUID that is not the MasterID's, or the body fetch off) found in the add-on's files; each is sent again with Tally's GUID and body once Tally gives it", len(found)))
	}
}

func liveRescanFiles(scannedBefore bool) []heldLine {
	var out []heldLine
	cutDay := nowFn().AddDate(0, 0, -7).Format("20060102")
	type pend struct {
		l     recLine
		name  string
		gen   int
		start int64
	}
	pending := map[string]*pend{}
	// 2.2.2: the body fetch switched off (the 2 s rule) for a company since a time: its lines after it went without
	offSince := map[string]time.Time{}
	live.mu.Lock()
	liveFresh()
	for k, o := range live.off {
		if o.method == "bodies" {
			if at, err := time.ParseInLocation("2006-01-02T15:04:05", o.at, liveZone); err == nil {
				offSince[strings.TrimPrefix(k, "bodies|")] = at
			}
		}
	}
	live.mu.Unlock()
	// 2.2.2: a voucher line (saved in a form, whatever FinCom id its narration carries: review H1) an earlier bridge sent
	// without its entry: one with no MasterID (a new entry's pre alone); a GUID of another entry than its MasterID's (a
	// duplicated voucher: 2.2.0 / 2.2.1 refused Tally's body for it); one read while the body fetch was off; and, when
	// no bridge scanned before (coming from 2.2.0, which sent every new entry with its placeholder GUID and no body), a
	// placeholder GUID. Never a line this bridge sent WITH its body (kept in sync\recorder-sent\*.body.txt, review M1).
	// Other bodies that failed (a timeout, the 20 s) left no note: the Day Book upload settles those
	consider := func(name string, gen int, m recLine, ev string, lineStart int64) {
		if !strings.EqualFold(m.Obj, "Voucher") || !strings.HasPrefix(m.Ev, "voucher_accept_") || (ev != "created" && ev != "altered") {
			return
		}
		at := liveTime(m.T1)
		if at.IsZero() {
			at = liveTime(m.T0)
		}
		off, wasOff := offSince[strings.TrimSpace(m.CName)+"|"+liveGUID(strings.TrimSpace(m.CGUID))]
		mismatch := liveIdsMismatch(m.GUID, m.CGUID, m.MID) || liveIdsMismatch(m.PreGUID, m.CGUID, m.MID)
		if !((livePlaceholder(m.GUID) && !scannedBefore) || toI64(onlyDigits(m.MID)) <= 0 || mismatch || (wasOff && !at.IsZero() && !at.Before(off))) {
			return
		}
		id := liveLineID(name, fmt.Sprint(gen), fmt.Sprint(lineStart))
		live.mu.Lock()
		was := live.sent[id] && !live.sent[id+":resolved"] && !live.bodied[id]
		live.mu.Unlock()
		if !was {
			return
		}
		mid := onlyDigits(m.MID)
		if toI64(mid) <= 0 {
			mid = ""
		}
		lg := ""
		if liveIdsMismatch(m.GUID, m.CGUID, m.MID) {
			lg = m.GUID
		} else if mismatch {
			lg = m.PreGUID
		}
		out = append(out, heldLine{ID: id, Company: strings.TrimSpace(m.CName), CGUID: liveGUID(strings.TrimSpace(m.CGUID)), Type: cutRunes(strings.TrimSpace(m.VType), 200),
			No: cutRunes(strings.TrimSpace(m.VNo), 200), Date: normDate(m.VDate), MID: mid, At: at.Format(time.RFC3339), Ev: ev, Mismatch: mismatch,
			LineGuid: cut(cleanGUID(lg), 80), LineAlter: toI64(onlyDigits(m.PreAID))})
	}
	for _, path := range liveFiles() {
		name := filepath.Base(path)
		if strings.EqualFold(name, "failed.txt") {
			continue
		}
		day := ""
		if g := reLiveFile.FindStringSubmatch(name); g != nil {
			day = strings.ReplaceAll(g[2], "-", "")
		} else if fi, err := os.Lstat(path); err == nil {
			day = fi.ModTime().Format("20060102")
		}
		if day < cutDay {
			continue
		}
		live.mu.Lock()
		gen := 0
		if st := live.files[name]; st != nil {
			gen = st.gen
		}
		live.mu.Unlock()
		head, _, err := readSharedFrom(path, 0, 400)
		if err != nil || len(head) == 0 {
			continue
		}
		enc, off := liveEncoding(head)
		for i := 0; i < 64; i++ {
			b, size, err := readSharedFrom(path, off, liveReadMax)
			if err != nil || len(b) == 0 {
				break
			}
			lines, upto := liveLogical(b, off, enc == "utf16", liveStarts(name), false)
			for _, ll := range lines {
				l, ok := parseRecorderLine(ll.text)
				if !ok || !liveOwnFile(name, ll.text, l.CGUID) {
					continue
				}
				// 2.2.0's pairing: a pair's line id is its second half's; a first half alone, its own
				if p := pending[l.CGUID]; p != nil {
					delete(pending, l.CGUID)
					if livePair[p.l.Ev] == l.Ev {
						m, ev := liveMerge(p.l, l)
						consider(name, gen, m, ev, ll.start)
						continue
					}
					consider(p.name, p.gen, rescanAlone(p.l), rescanAloneEv(p.l), p.start)
				}
				if _, first := livePair[l.Ev]; first {
					pending[l.CGUID] = &pend{l, name, gen, ll.start}
					continue
				}
				_, ev := liveSingle(l)
				consider(name, gen, l, ev, ll.start)
			}
			if upto <= off || upto >= size {
				break
			}
			off = upto
		}
	}
	for k, p := range pending {
		delete(pending, k)
		consider(p.name, p.gen, rescanAlone(p.l), rescanAloneEv(p.l), p.start)
	}
	return out
}

// a first half alone: its AlterID is the one before the save
func rescanAlone(l recLine) recLine {
	l.PreAID = l.AID
	return l
}

// a first half alone, as liveFlush maps it: a voucher's pre is created or altered
func rescanAloneEv(l recLine) string {
	if l.Ev != "voucher_accept_pre" || strings.TrimSpace(l.GUID) == "" {
		return ""
	}
	l.PreAID = l.AID
	if liveIsNew(l) || liveOtherEntry(l.GUID, l.CGUID, l.MID) {
		return "created"
	}
	return "altered"
}

// --- the resolver (one turn of the uploader): each held line, asked again every RecorderResolveSec (10 minutes) for 7
// days, 20 times at most (a try counts only when Tally answered: review M2): one entry found, a line goes with its real
// GUID and body (line id + ":resolved"), once. Security L3: Tally is asked outside the held list's lock (a snapshot,
// the asks, then the answers merged), 20 s at most a turn
func liveResolveTurn() {
	if !cloudOn() || postingGoing() || importsInFlight.Load() > 0 {
		return
	}
	heldMu.Lock()
	all, items := liveHeldLoad()
	if len(items) == 0 {
		heldMu.Unlock()
		return
	}
	changed := false
	now := nowFn()
	wait := time.Duration(keepNumZero("RecorderResolveSec", 600)) * time.Second
	var ids []string
	for id := range items {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var ask []heldLine
	for _, id := range ids {
		h := items[id]
		rid := id + ":resolved"
		live.mu.Lock()
		liveFresh()
		done := live.sent[rid]
		waiting := live.queued[rid]
		off := liveIsOffLocked("bodies", h.Company+"|"+h.CGUID)
		live.mu.Unlock()
		added, _ := time.Parse(time.RFC3339, h.Added)
		if done || (!added.IsZero() && now.Sub(added) > 7*24*time.Hour) {
			delete(items, id)
			changed = true
			continue
		}
		if waiting || off || h.Final || len(ask) >= 10 {
			continue
		}
		// 2.2.2 (the owner's condition a): asked again 20 times at most, then left held with plain words
		if h.Tries >= liveHeldMaxTries {
			if h.Why != liveHeldGiveUp {
				h.Why = liveHeldGiveUp
				items[id] = h
				changed = true
				writeLog(fmt.Sprintf("Recorder: %s of %s in %s (line %s): %s", or(strings.TrimSpace(h.Type+" "+h.No), "an entry"), liveDay(h.Date), h.Company, id, liveHeldGiveUp))
			}
			continue
		}
		if last, err := time.Parse(time.RFC3339, h.Last); err == nil && now.Sub(last) < wait {
			continue
		}
		h.Last = now.Format(time.RFC3339) // spaced whatever the answer
		items[id] = h
		changed = true
		ask = append(ask, h)
	}
	if changed {
		liveHeldSave(all, items)
	}
	heldMu.Unlock()
	// the asks, outside the lock
	type res struct {
		id, x           string
		answered, final bool
	}
	var got []res
	deadline := time.Now().Add(time.Duration(keepNum("RecorderResolveTurnSec", 20)) * time.Second)
	for _, h := range ask {
		if time.Now().After(deadline) {
			break
		}
		x, answered, final, err := liveResolveOne(h)
		if gaveWay(err) {
			break
		}
		got = append(got, res{h.ID, x, answered, final})
		if x == "" {
			continue
		}
		rid := h.ID + ":resolved"
		c := &change{company: h.Company, companyGuid: h.CGUID, event: or(h.Ev, "created"), vchType: h.Type, vchNo: h.No, vchDate: h.Date, source: "addon", lineId: rid,
			at: h.At, saveMs: -1, readAt: nowFn(), idsMismatch: h.Mismatch, lineGuid: h.LineGuid, lineFid: h.LineFid}
		if !h.Mismatch && h.MID == "" && h.Ev == "altered" {
			c.event = "created" // review H2: found by its number, the save was a new entry's
		}
		live.mu.Lock()
		liveFresh()
		liveTakeBody(c, x)
		if !live.sent[rid] && !live.queued[rid] {
			liveQueueAdd(c)
		}
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder: %s %s of %s in %s resolved: sent as %s with its GUID %s and body", h.Type, h.No, h.Date, h.Company, c.event, c.guid))
	}
	if len(got) == 0 {
		return
	}
	// the answers merged into the list as it is now
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items = liveHeldLoad()
	for _, r := range got {
		h, had := items[r.id]
		if !had {
			continue
		}
		if r.answered {
			h.Tries++
		}
		if r.final {
			h.Final = true
		}
		items[r.id] = h
	}
	liveHeldSave(all, items)
}

const (
	liveHeldMaxTries = 20
	liveHeldGiveUp   = "Tally did not give this entry after 20 tries; upload that day's Day Book to settle it"
)

// one held line's entry asked of Tally: by MasterID when the line had it, else (or when Tally gave nothing with that
// MasterID) by type, number and date; checked as the body fetch checks it (liveVoucherWrong). Security L3: when the
// MasterID gave another real voucher, nothing is asked by number (final). answered: Tally answered a request (a try)
func liveResolveOne(h heldLine) (x string, answered, final bool, err error) {
	sp, spOK := startPointOf(h.Company)
	key := h.Company + "|" + h.CGUID
	tc := recorderTC(func(sec float64) {
		if sec > liveLimitSec() {
			liveTurnOff("bodies", key, h.Company, sec)
		}
	})
	port, err := findCompanyPort(h.Company, 0)
	if err != nil {
		return "", false, false, err
	}
	w := liveWant{company: h.Company, cguid: h.CGUID, typ: h.Type, no: h.No, date: h.Date, mid: h.MID, sp: sp, spOK: spOK, lineAlter: h.LineAlter}
	if h.MID != "" {
		m, err := fetchVouchersByMasterIn(tc, h.Company, port, h.Date, []string{h.MID}, liveBodySec())
		if err != nil {
			return "", false, false, err
		}
		why, kind := liveVoucherWrong(m[h.MID], "voucher with MasterID "+h.MID, w)
		if why == "" {
			return m[h.MID], true, false, nil
		}
		if kind == wrongFinal {
			return "", true, true, nil
		}
		answered = true
	}
	if h.No == "" || !liveNumberText(h.No) || !liveNumberText(h.Type) {
		return "", answered, h.MID == "", nil
	}
	x, _, kind, err := liveOneByNumber(tc, h.Company, port, w, liveBodySec())
	if err != nil {
		return "", answered, false, err
	}
	return x, true, kind == wrongFinal, nil
}

// stub
func applyHeldLines(j M) {}
