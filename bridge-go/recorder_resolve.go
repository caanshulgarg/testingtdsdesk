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
	liveNumberAsk(company, date, typ, no)
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
// The line's GUID and AlterID are not in it: they are never trusted
type liveWant struct {
	company, cguid, typ, no, date string
	sp                            int64 // the company's starting point (0: not known)
}

func liveWantOf(c *change, sp int64) liveWant {
	return liveWant{company: c.company, cguid: c.companyGuid, typ: c.vchType, no: c.vchNo, date: c.vchDate, sp: sp}
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

// Tally's voucher is the line's entry only when its GUID is under the line's company GUID and ends in its own MASTERID in
// hex, its type and date are the line's (its number too, when the line has one), and its ALTERID (Tally's, never the
// line's) is above the starting point. "" : it is; else the plain words of what did not match. who: "voucher with
// MasterID 25683"
func liveVoucherWrong(x, who string, w liveWant) string {
	if strings.TrimSpace(x) == "" {
		return "Tally gave no " + who + " on " + liveDay(w.date)
	}
	field := func(tag string) string {
		return strings.TrimSpace(html.UnescapeString(group(`<`+tag+`>([^<]*)</`+tag+`>`, x, 1)))
	}
	g, typ, no, date := field("GUID"), field("VOUCHERTYPENAME"), field("VOUCHERNUMBER"), normDate(field("DATE"))
	mid, alter := toI64(group(`<MASTERID>\s*(\d+)`, x, 1)), toI64(group(`<ALTERID>\s*(\d+)`, x, 1))
	cg := w.cguid
	if cg == "" {
		cg = heldGUID(w.company)
	}
	lineType := or(w.typ, "entry")
	switch {
	case g == "" || livePlaceholder(g):
		return "Tally's " + who + " came without its GUID"
	case cg == "":
		return "the company's GUID is not known here, so Tally's " + who + " cannot be checked"
	case !strings.HasPrefix(g, cg+"-"):
		return "Tally's " + who + " belongs to another company (its GUID " + g + ")"
	case mid <= 0 || guidMaster(g) != mid:
		return fmt.Sprintf("Tally's %s has the GUID %s, which is not its MasterID %d", who, g, mid)
	case (w.typ != "" && typ != w.typ) || date != w.date:
		return fmt.Sprintf("Tally's %s is %s of %s, not this %s of %s", who, aOr(or(typ, "voucher")), liveDay(date), lineType, liveDay(w.date))
	case w.no != "" && no != w.no:
		return fmt.Sprintf("Tally's %s is %s %s, not this %s %s", who, typ, or(no, "(no number)"), lineType, w.no)
	case w.sp > 0 && alter <= w.sp:
		return fmt.Sprintf("Tally's %s is not above the starting point (its AlterID %d, the starting point %d)", who, alter, w.sp)
	}
	return ""
}

// the one entry with the line's type and number on its date, checked as above: its XML, or why not ("" XML and "" why
// never together)
func liveOneByNumber(tc *TC, company string, port int, w liveWant, sec int) (string, string, error) {
	got, err := fetchVoucherByNumber(tc, company, port, w.date, w.typ, w.no, sec)
	if err != nil {
		return "", "", err
	}
	switch len(got) {
	case 0:
		return "", fmt.Sprintf("Tally gave no %s %s of %s", w.typ, w.no, liveDay(w.date)), nil
	case 1:
	default:
		return "", fmt.Sprintf("%d entries with that type and number on that date", len(got)), nil
	}
	if why := liveVoucherWrong(got[0], fmt.Sprintf("voucher %s %s", w.typ, w.no), w); why != "" {
		return "", why, nil
	}
	return got[0], "", nil
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
func liveNumberHeld(c *change, why string) {
	live.mu.Lock()
	c.bodyTried, c.heldWhy = true, why
	live.mu.Unlock()
	writeLog(fmt.Sprintf("Recorder: %s of %s in %s: %s; sent without its body and GUID (FinCom holds the line until it is resolved)",
		or(strings.TrimSpace(c.vchType+" "+c.vchNo), "an entry"), c.vchDate, c.company, cutRunes(why, 200)))
}

func liveHeldWhy(c *change, why string) { liveNumberHeld(c, why) }

// the new entries of one company (MasterID 0 on their line) by type and number, as a background read like the body
// fetch: it gives way to a posting, the 2 s rule turns it off for the company, 20 s in all
func liveFetchByNumber(cs []*change, sp int64) {
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
		x, why, err := liveOneByNumber(tc, company, port, liveWantOf(c, sp), left)
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
			liveNumberHeld(c, why)
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
			MID: str(e["masterId"]), At: str(e["savedAt"]), Added: str(e["added"]), Last: str(e["last"]), Tries: toInt(e["tries"]), Ev: str(e["event"]), Why: str(e["why"])}
	}
	return all, items
}

func liveHeldSave(all M, items map[string]heldLine) {
	o := M{}
	for id, h := range items {
		o[id] = M{"company": h.Company, "companyGuid": h.CGUID, "type": h.Type, "no": h.No, "date": h.Date, "masterId": h.MID, "savedAt": h.At,
			"added": h.Added, "last": h.Last, "tries": h.Tries, "event": h.Ev, "why": h.Why}
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
		items[c.lineId] = heldLine{ID: c.lineId, Company: c.company, CGUID: c.companyGuid, Type: c.vchType, No: c.vchNo, Date: c.vchDate, MID: c.masterId,
			At: c.at, Added: now, Last: now, Ev: c.event, Why: c.heldWhy}
	}
	liveHeldSave(all, items)
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
	found := liveRescanFiles()
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

func liveRescanFiles() []heldLine {
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
	// 2.2.2: a voucher line an earlier bridge sent without its entry: a placeholder GUID or MasterID 0 (2.2.0), a GUID that
	// is not its MasterID's (a duplicated voucher: 2.2.0 / 2.2.1 refused Tally's body for it), or read while the body fetch
	// was off. A line whose GUID and MasterID agree went with its body (the bridge kept no note of a body that failed
	// for another reason: the Day Book upload settles those)
	consider := func(name string, gen int, m recLine, ev string, lineStart int64) {
		if !strings.EqualFold(m.Obj, "Voucher") || !strings.HasPrefix(m.Ev, "voucher_accept_") || (ev != "created" && ev != "altered") || reLiveFid.MatchString(m.Narr) {
			return
		}
		at := liveTime(m.T1)
		if at.IsZero() {
			at = liveTime(m.T0)
		}
		off, wasOff := offSince[strings.TrimSpace(m.CName)+"|"+liveGUID(strings.TrimSpace(m.CGUID))]
		if !(livePlaceholder(m.GUID) || liveZero(m.MID) || liveIdsMismatch(m.GUID, m.MID) || (wasOff && !at.IsZero() && !at.Before(off))) {
			return
		}
		id := liveLineID(name, fmt.Sprint(gen), fmt.Sprint(lineStart))
		live.mu.Lock()
		was := live.sent[id] && !live.sent[id+":resolved"]
		live.mu.Unlock()
		if !was {
			return
		}
		mid := onlyDigits(m.MID)
		if toI64(mid) <= 0 {
			mid = ""
		}
		out = append(out, heldLine{ID: id, Company: strings.TrimSpace(m.CName), CGUID: liveGUID(strings.TrimSpace(m.CGUID)), Type: strings.TrimSpace(m.VType),
			No: strings.TrimSpace(m.VNo), Date: normDate(m.VDate), MID: mid, At: at.Format(time.RFC3339), Ev: ev})
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
					consider(p.name, p.gen, p.l, rescanAloneEv(p.l), p.start)
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
		consider(p.name, p.gen, p.l, rescanAloneEv(p.l), p.start)
	}
	return out
}

// a first half alone, as liveFlush maps it: a voucher's pre is created or altered
func rescanAloneEv(l recLine) string {
	if l.Ev != "voucher_accept_pre" || strings.TrimSpace(l.GUID) == "" {
		return ""
	}
	if liveIsNew(l) || liveIdsMismatch(l.GUID, l.MID) {
		return "created"
	}
	return "altered"
}

// --- the resolver (one turn of the uploader): each held line, asked again every RecorderResolveSec (10 minutes) for 7
// days: one entry found, a created line goes with its real GUID and body (line id + ":resolved"), once
func liveResolveTurn() {
	if !cloudOn() || postingGoing() || importsInFlight.Load() > 0 {
		return
	}
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	if len(items) == 0 {
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
	asked := 0
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
		if waiting || off || asked >= 10 {
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
		asked++
		h.Last, h.Tries = now.Format(time.RFC3339), h.Tries+1
		items[id] = h
		changed = true
		x, why := liveResolveOne(h)
		if gaveWay(why) {
			break
		}
		if x == "" {
			continue
		}
		c := &change{company: h.Company, companyGuid: h.CGUID, event: or(h.Ev, "created"), vchType: h.Type, vchNo: h.No, vchDate: h.Date, source: "addon", lineId: rid,
			at: h.At, saveMs: -1, readAt: nowFn()}
		live.mu.Lock()
		liveFresh()
		liveTakeBody(c, x)
		if !live.sent[rid] && !live.queued[rid] {
			liveQueueAdd(c)
		}
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder: %s %s of %s in %s resolved: sent as %s with its GUID %s and body", h.Type, h.No, h.Date, h.Company, c.event, c.guid))
	}
	if changed {
		liveHeldSave(all, items)
	}
}

const (
	liveHeldMaxTries = 20
	liveHeldGiveUp   = "Tally did not give this entry after 20 tries; upload that day's Day Book to settle it"
)

// one held line's entry asked of Tally: by MasterID when the line had it, else (or when Tally's voucher with that
// MasterID is not the line's) by type, number and date; checked as the body fetch checks it (liveVoucherWrong). ""
// when not found
func liveResolveOne(h heldLine) (string, error) {
	sp, _ := startPointOf(h.Company)
	key := h.Company + "|" + h.CGUID
	tc := recorderTC(func(sec float64) {
		if sec > liveLimitSec() {
			liveTurnOff("bodies", key, h.Company, sec)
		}
	})
	port, err := findCompanyPort(h.Company, 0)
	if err != nil {
		return "", err
	}
	w := liveWant{company: h.Company, cguid: h.CGUID, typ: h.Type, no: h.No, date: h.Date, sp: sp}
	if h.MID != "" {
		m, err := fetchVouchersByMasterIn(tc, h.Company, port, h.Date, []string{h.MID}, liveBodySec())
		if err != nil {
			return "", err
		}
		if liveVoucherWrong(m[h.MID], "voucher with MasterID "+h.MID, w) == "" {
			return m[h.MID], nil
		}
	}
	if h.No == "" || !liveNumberText(h.No) || !liveNumberText(h.Type) {
		return "", nil
	}
	x, _, err := liveOneByNumber(tc, h.Company, port, w, liveBodySec())
	return x, err
}
