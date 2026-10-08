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
	"regexp"
	"sort"
	"strconv"
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
	if slowMarked(company, "") {
		return nil, errSlowCompany // 2.3.2: no entry request for a company marked "entry fetch stopped: over 2 s"
	}
	// 2.3.4 (L-d, push-design run 37816340452): a request naming a company that is not open crashes Tally (c0000005),
	// this one too: sent only right after Tally's company list on this port names the company
	if err := fastCompanyListed(tc, company, port, sec); err != nil {
		return nil, err
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
		if tagValue(m, "VOUCHERTYPENAME") == typ && tagValue(m, "VOUCHERNUMBER") == no && normDate(tagValue(m, "DATE")) == normDate(date) {
			// 2.3.4 (the independent review, M2): the same approved fields as the entry request, nothing more (Tally's
			// collection answer adds fields of its own)
			if v := fastStripCollection(cleanXML(m)); v != "" {
				out = append(out, v)
			}
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
	g, typ, no, date := tagValue(x, "GUID"), tagValue(x, "VOUCHERTYPENAME"), tagValue(x, "VOUCHERNUMBER"), normDate(tagValue(x, "DATE"))
	mid, alter := toI64(tagNum(x, "MASTERID")), toI64(tagNum(x, "ALTERID"))
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
	c.full = liveFetchFull() // 2.3.1: the entry request's answer, every field 56 keeps asked: its blanks are Tally's
	c.guid = tagValue(x, "GUID")
	c.masterId = onlyDigits(tagNum(x, "MASTERID"))
	c.alterId = onlyDigits(tagNum(x, "ALTERID"))
	if c.narr == "" {
		c.narr = html.UnescapeString(tagRaw(x, "NARRATION"))
	}
	if c.vchType == "" {
		c.vchType = tagValue(x, "VOUCHERTYPENAME")
	}
	if c.vchNo == "" {
		c.vchNo = tagValue(x, "VOUCHERNUMBER")
	}
	c.heldWhy = ""
	liveDecide(c, "taken: Tally's GUID "+c.guid+", AlterID "+c.alterId)
	// 2.3.0 (cancel/delete GUID): Tally's GUID of this MasterID kept for a later delete of the entry
	liveMidNote(c.companyGuid, c.masterId, c.guid, tagValue(x, "VOUCHERTYPENAME"), tagValue(x, "VOUCHERNUMBER"), normDate(tagValue(x, "DATE")))
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
	liveDecide(c, "held: "+why+" (sent without its body and GUID; FinCom holds the line until it is resolved)")
}

// --- 2.3.3 (a High in 2.3.2, NWS144: a new save sat unsent for 35 minutes behind yesterday's held lines). The owner's
// rule: "A save must always show on the Tally page, at least as held with a reason. Silence is not acceptable." A line
// whose body is not there on its first attempt goes up held at once with these words, and the held list asks Tally again
// at the next try, once (the owner's rule of 07-Oct-2026: a held line is asked again at most once)

// how long a line sent held at once waits before its next ask, at least (RecorderFreshRetryMs; else the by-number
// spacing, 10 s): the retry schedule's next try comes later anyway after a stop
func liveFreshSpacing() time.Duration {
	return time.Duration(keepNumZero("RecorderFreshRetryMs", keepNumZero("RecorderNumberRetryMs", 10000))) * time.Millisecond
}

// 2.3.4 (the owner's answer B, 08-Oct-2026): how long a line whose fast request was stopped waits for its one more ask
// (RecorderStopRetrySec, 5 minutes)
func liveStopRetry() time.Duration {
	return time.Duration(keepNum("RecorderStopRetrySec", 300)) * time.Second
}

// 2.3.4 (answer B): the most FinComVoucherObject asks a line gets in all (its first and one more)
const liveObjAsksMax = 2

// "waiting: Tally took longer than 2 s; FinCom asks once more at HH:MM" (5 minutes on, or the retry schedule's next try
// when that is later)
func liveStopOnceWords() string {
	next := nowFn().Add(liveStopRetry())
	if r := retryNext(); r.After(next) {
		next = r
	}
	return "waiting: " + liveStopWhat() + "; FinCom asks once more at " + next.Format("15:04")
}

// 2.3.4 (answer B): the live lines whose first fast request was stopped: sent held now with the once-more words, joining
// the held list with that one ask used (asked once more after liveStopRetry; a second stop ends them). A cancel / delete
// check is not here (held as one this Tally could not be asked about, as before)
func liveHeldStopOnce(cs []*change) {
	words := liveCapWhy(liveStopOnceWords())
	for _, c := range cs {
		if c.isLedger() {
			continue
		}
		live.mu.Lock()
		c.bodyTried, c.heldWhy = true, words
		if c.fetchesIds() && c.source == "addon" && c.vchDate != "" {
			c.fresh, c.dueNow, c.freshSlow, c.stopWait = true, false, true, true
			c.freshTries++
		}
		live.mu.Unlock()
		liveDecide(c, "held at once: "+words+" (sent now without its body; FinCom shows it held, and this bridge asks Tally once more)")
	}
}

// 2.3.4 (option (a)): the words a line ends with when its fast request was stopped at the limit
func liveStopEndWords() string {
	return liveStopWhat() + " for this entry; upload that day's Day Book to settle it"
}

// "Tally took longer than 2 s" (the stop as configured)
func liveStopWhat() string {
	return "Tally took longer than " + strconv.FormatFloat(liveLimitSec(), 'f', -1, 64) + " s"
}

// "waiting: <what>; FinCom asks again at HH:MM": the retry schedule's next try, else the next ask's time
func liveWaitWords(what string) string {
	if what == liveReadStopWhat {
		return "waiting: " + what + "; asked again when it is resumed" // 2.3.5: no time: FinCom's resume decides
	}
	next := retryNext()
	if now := nowFn(); next.IsZero() || next.Before(now) {
		next = now.Add(liveFreshSpacing())
	}
	return "waiting: " + what + "; FinCom asks again at " + next.Format("15:04")
}

// these lines go up held now with the waiting words (what: why), and join the held list due at the next try. stop: a real
// 2 s stop (the only one that counts towards the slow back-off); counted: Tally was asked (one ask of the original
// fetch's 3); dueNow: nothing was asked (the schedule waited): due as soon as the schedule lets it. A cancel asked for its
// GUID is held as one this Tally could not be asked about (asked again by itself); a ledger is left to the 4 s safety net
func liveHeldNow(cs []*change, what string, stop, counted, dueNow bool) {
	words := liveCapWhy(liveWaitWords(what))
	for _, c := range cs {
		if c.isLedger() {
			continue
		}
		live.mu.Lock()
		if c.guidFetch {
			liveGuidUnproven(c, words)
			live.mu.Unlock()
			continue
		}
		c.bodyTried, c.heldWhy = true, words
		if c.fetchesIds() && c.source == "addon" && c.vchDate != "" {
			c.fresh, c.dueNow = true, dueNow
			if counted {
				c.freshTries++
			}
			c.freshSlow = c.freshSlow || stop
		}
		live.mu.Unlock()
		liveDecide(c, "held at once: "+words+" (sent now without its body; FinCom shows it held, and this bridge asks Tally again)")
	}
}

// --- 2.2.2 (the owner's requirement before publishing): ONE log line for every decision to fetch or not to fetch a
// voucher line's entry, with its reason; the same line and reason at most once in 10 minutes
var (
	decideMu sync.Mutex
	decideAt = map[string]time.Time{}
)

// said once in 10 minutes for this key
func liveSayOnce(key, text string) {
	decideMu.Lock()
	if t, ok := decideAt[key]; ok && time.Since(t) < 10*time.Minute {
		decideMu.Unlock()
		return
	}
	if len(decideAt) > 5000 {
		for k, t := range decideAt {
			if time.Since(t) >= 10*time.Minute {
				delete(decideAt, k)
			}
		}
		if len(decideAt) > 5000 {
			decideAt = map[string]time.Time{}
		}
	}
	decideAt[key] = time.Now()
	decideMu.Unlock()
	writeLog(text)
}

// "Recorder: Journal FA/ELEC/024 of 01-Oct-2026 (MasterID 25683, line a14c0d2e…): <what>"
func liveSay(typ, no, date, mid, lineID, what string) {
	liveSayOnce("decide|"+lineID+"|"+what, fmt.Sprintf("Recorder: %s of %s (MasterID %s, line %s…): %s", or(strings.TrimSpace(typ+" "+no), "An entry"), liveDay(date),
		or(mid, "none"), cut(lineID, 8), what))
}

func liveDecide(c *change, what string) {
	liveSay(c.vchType, c.vchNo, c.vchDate, c.masterId, c.lineId, what)
}

// the new entries of one company (MasterID 0 on their line) by type and number, as a background read like the body
// fetch: it gives way to a posting, 20 s in all; a request stopped at 2 s or not answered waits for the shared retry
// schedule (retry.go), never switched off (2.3.1)
func liveFetchByNumber(cs []*change, sp int64, spOK bool) {
	if len(cs) == 0 {
		return
	}
	company := cs[0].company
	// 2.3.2 (issue 232, c): a company marked "entry fetch stopped: over 2 s": nothing asked; held at once with the words
	slowHold := func(c *change) {
		live.mu.Lock()
		c.slowEnded = true
		live.mu.Unlock()
		liveHeldAs(c, slowWords, true)
	}
	if slowMarked(company, cs[0].companyGuid) {
		for _, c := range cs {
			slowHold(c)
		}
		return
	}
	deadline := time.Now().Add(time.Duration(liveBodySec()) * time.Second)
	yield := func() bool { return postingGoing() || importsInFlight.Load() > 0 }
	tc := recorderTC(nil)
	var reached bool // 2.3.5: whether this ask's request reached Tally
	tc.sentOut = &reached
	port, err := findCompanyPortBg(company, 0)
	if err != nil {
		if yield() {
			for _, c := range cs {
				liveDecide(c, "not asked: a posting is going on; asked after it")
			}
			return
		}
		for _, c := range cs {
			liveNumberHeld(c, "not found by its type and number ("+err.Error()+")")
		}
		return
	}
	for _, c := range cs {
		if c.vchNo == "" {
			// 2.2.2: an entry without a voucher number (many Journals) and no MasterID on its line: nothing to ask by
			liveNumberHeld(c, "the line has no MasterID and the entry no voucher number, so Tally cannot be asked for it")
			continue
		}
		if time.Now().After(deadline) {
			liveNumberHeld(c, "not found by its type and number (20 s passed)")
			continue
		}
		if liveOverdue([]*change{c}) {
			liveHeldNow([]*change{c}, liveBehindWhat, false, false, true) // 2.3.3 (review M2): not asked yet
			continue
		}
		left := maxI(2, int(time.Until(deadline).Seconds()+0.999))
		liveDecide(c, "asking Tally by type and number (a new entry: no MasterID on its line)")
		reached = false
		x, why, kind, err := liveOneByNumber(tc, company, port, liveWantOf(c, sp, spOK), left)
		if liveStopRefused(err, reached) {
			liveHeldNow([]*change{c}, liveReadStopWhat, false, false, true) // 2.3.5: FinCom's read stop: nothing sent, not counted
			continue
		}
		if errors.Is(err, errSlowCompany) {
			slowHold(c)
			continue
		}
		if errors.Is(err, errRetryWait) {
			liveHeldNow([]*change{c}, "Tally busy", false, false, true) // 2.3.3: held now, due at the next try
			continue
		}
		if gaveWay(err) {
			liveDecide(c, "not asked: a posting is going on; asked after it")
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
		live.mu.Unlock()
		// 2.3.3: not found yet, stopped at 2 s, or not answered: held now; the held list asks again by its number, once,
		// RecorderNumberRetryMs after this ask at least
		switch {
		case err == nil:
			liveHeldNow([]*change{c}, "Tally has not shown this new entry yet", false, true, false)
		case errors.Is(err, errRecorderStop):
			liveHeldNow([]*change{c}, liveStopWhat(), true, true, false)
		case tallyNoAnswer(err) || errors.Is(err, errBackoff):
			liveHeldNow([]*change{c}, "Tally busy", false, true, false)
		default:
			liveNumberHeld(c, "not found by its type and number: "+err.Error())
		}
	}
}

// --- the held list: lines sent without their entry's GUID and body (sync\recorder-held.json), resolved once
type heldLine struct {
	ID, Company, CGUID, Type, No, Date, MID, At, Added, Last string
	Tries                                                    int
	Ev, Why                                                  string // 2.2.2: the event the line went as ("" : created); why it stays held
	// 2.2.2 review: the line's flag and GUID (kept on its :resolved line), its FinCom id not the entry's, its AlterID before
	// the save (a lower bound for Tally's), and held for a reason no ask can change (never asked again)
	LineGuid, LineFid      string
	Mismatch, Final, Cloud bool // Cloud: from FinCom's beat answer (heldLines)
	// after 2.3.0 (06-Oct-2026): FinCom listed it in the beat's refetch (its body missing or its GUID a placeholder: asked one a
	// turn); the version whose asks the tries count (a try of an older bridge, which could not read a real Tally's typed
	// answer, does not count once FinCom lists the line again)
	Refetch  bool
	TriesVer string
	// 2.3.1 review H1: FinCom listed it again although an older bridge sent its ":resolved" line (2.3.0's request, without the
	// items' ledger lines, held by the cloud's guard): asked and sent once more under this version
	Again bool
	// 2.3.1 (masters): FinCom held this bridge's own ":resolved" line waiting for a ledger it did not have; the ledger is in
	// now, so the line is asked and sent once more (the same id), once (sync\recorder-sent\*.ledger.txt)
	LedgerAgain bool
	LineAlter   int64
	// review H1 (the owner's addition): a delete's own GUID and AlterID, used only once this Tally shows it gone
	KeepGuid, KeepAlter string
	// 2.3.2 (issue 232, b): the asks of this line that were stopped at 2 s or not answered (2.3.3: kept in the file, no
	// longer used: a held line is asked again once)
	Slow int
	// 2.3.3: sent held at once (its body not there on its first attempt): asked at the next try, RecorderFreshRetryMs after
	// its last ask at least, first among the held lines; FreshTries: the asks made before it was sent; FreshSlow: one of
	// them stopped at 2 s
	Fresh      bool
	FreshTries int
	FreshSlow  bool
	// 2.3.3 (the owner's rule, 07-Oct-2026): a held line is asked of Tally again AT MOST ONCE; if that ask stops or fails it
	// ends at once with the Day Book words. Allow: the asks it may have (1; 2 for a new save sent held before Tally was
	// asked at all: its first fetch, then the one ask again; 0 read as 1); Asked: the asks that reached Tally
	Allow, Asked int
	// next-fastfetch (the owner's approval of 07-Oct-2026): a line an earlier bridge ENDED with the Day Book words (its id in
	// *.ended.txt), listed by FinCom again: asked once more with the fast request; its ":resolved" goes again when Tally gives
	// the entry (the cloud's second ":resolved" row replaces both held rows); never asked a third time
	FastAgain bool
	// 2.3.4 (a live finding on NWS144, 08-Oct-2026: lines an older bridge left at 20 tries or final were never asked and
	// never ended): set on every line this version keeps; a line without it came from an older bridge and gets exactly
	// one ask with the fast request on the upgrade, whatever its old tries or final
	V234 bool
	// 2.3.4 (the owner's answer B, 08-Oct-2026): ObjAsks: the FinComVoucherObject asks of this line that reached Tally in
	// this version (its first fetch included; never more than liveObjAsksMax); StopWait: its last one was stopped at the
	// limit: its one more ask waits liveStopRetry after it
	ObjAsks  int
	StopWait bool
}

// 2.3.4: the words a held line ends with when Tally's voucher is not its entry or there is nothing to ask Tally by
const liveHeldFinalEnd = "; upload that day's Day Book to settle it"

// 2.3.3: the asks a held line may have
func (h heldLine) allow() int {
	if h.Allow < 1 {
		return 1
	}
	return minI(h.Allow, 2) // never more, whatever the file says
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
			LineGuid: str(e["lineGuid"]), LineFid: str(e["lineFid"]), Mismatch: truthy(e["idsMismatch"]), Final: truthy(e["final"]), LineAlter: toI64(e["lineAlter"]),
			Cloud: truthy(e["fromFinCom"]), KeepGuid: str(e["keepGuid"]), KeepAlter: str(e["keepAlter"]), Refetch: truthy(e["refetch"]), TriesVer: str(e["triesVersion"]), Again: truthy(e["again"]), LedgerAgain: truthy(e["ledgerAgain"]), Slow: toInt(e["slow"]),
			Fresh: truthy(e["fresh"]), FreshTries: toInt(e["freshTries"]), FreshSlow: truthy(e["freshSlow"]), Allow: toInt(e["allow"]), Asked: toInt(e["asked"]),
			FastAgain: truthy(e["fastAgain"]), V234: truthy(e["v234"]), ObjAsks: toInt(e["objAsks"]), StopWait: truthy(e["stopWait"])}
	}
	return all, items
}

func liveHeldSave(all M, items map[string]heldLine) {
	o := M{}
	for id, h := range items {
		o[id] = M{"company": h.Company, "companyGuid": h.CGUID, "type": h.Type, "no": h.No, "date": h.Date, "masterId": h.MID, "savedAt": h.At,
			"added": h.Added, "last": h.Last, "tries": h.Tries, "event": h.Ev, "why": liveCapWhy(h.Why), "lineGuid": h.LineGuid, "lineFid": h.LineFid,
			"idsMismatch": h.Mismatch, "final": h.Final, "lineAlter": h.LineAlter, "fromFinCom": h.Cloud,
			"keepGuid": h.KeepGuid, "keepAlter": h.KeepAlter, "refetch": h.Refetch, "triesVersion": h.TriesVer, "again": h.Again, "ledgerAgain": h.LedgerAgain, "slow": h.Slow,
			"fresh": h.Fresh, "freshTries": h.FreshTries, "freshSlow": h.FreshSlow, "allow": h.Allow, "asked": h.Asked, "fastAgain": h.FastAgain, "v234": h.V234,
			"objAsks": h.ObjAsks, "stopWait": h.StopWait}
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
		if c.slowEnded {
			continue // 2.3.2: sent with the Day Book words: ended, never asked again
		}
		mid := c.masterId
		if strings.Contains(c.heldWhy, "was not saved after this line") {
			mid = "" // review H2: the voucher with that MasterID is not this line's entry: asked by its number only
		}
		items[c.lineId] = heldLine{V234: true, ID: c.lineId, Company: c.company, CGUID: c.companyGuid, Type: c.vchType, No: c.vchNo, Date: c.vchDate, MID: mid,
			At: c.at, Added: now, Last: now, Ev: c.event, Why: c.heldWhy, LineGuid: c.lineGuid, LineFid: c.lineFid, Mismatch: c.idsMismatch,
			Final: c.heldFinal || (mid == "" && c.vchNo == ""), LineAlter: c.lineAlter, KeepGuid: c.guidKeep, KeepAlter: c.alterKeep}
		if c.slowHeld {
			h := items[c.lineId]
			h.Slow = 1 // 2.3.2 (b): the original fetch's stops: one timed-out try
			items[c.lineId] = h
		}
		if c.fresh {
			// 2.3.3: sent held at once: asked again at the next try (due at once when nothing was asked yet)
			h := items[c.lineId]
			h.Fresh, h.FreshTries, h.FreshSlow = true, c.freshTries, c.freshSlow
			if mid != "" {
				h.ObjAsks = c.freshTries // 2.3.4 (answer B): its first fetch's asks, by its MasterID (the fast request)
			}
			h.StopWait = c.stopWait
			if c.dueNow {
				h.Last = ""
			}
			h.Allow = 1
			if c.freshTries == 0 {
				h.Allow = 2 // not asked yet: its first fetch, then the one ask again
			}
			items[c.lineId] = h
		}
		if c.guidRetry {
			h := items[c.lineId]
			h.Final, h.MID = false, c.masterId // asked again by its MasterID (liveResolveGuid)
			h.KeepGuid, h.KeepAlter = c.guidKeep, c.alterKeep
			if strings.Contains(c.heldWhy, liveReadStopWhat) {
				h.Last = "" // 2.3.5 (review L1): held by FinCom's read stop: due at the first turn after the resume
			}
			items[c.lineId] = h
		}
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
	writeLog(fmt.Sprintf("Recorder: re-scan of the add-on's files for %s: %d line(s) sent earlier without their entry found (a new entry's line with no MasterID, a GUID of another entry, or read while the body fetch was off)%s",
		BridgeVersion, len(found), map[bool]string{true: "; each is asked of Tally again and sent with Tally's GUID and body once Tally gives it", false: ""}[len(found) > 0]))
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
	// 2.2.2: the body fetch switched off (the 2 s rule) for a company since a time: its lines after it went without (2.3.1:
	// nothing is switched off any more; what a 2.3.0 bridge saved is read once for this, never in force)
	offSince := map[string]time.Time{}
	live.mu.Lock()
	liveFresh()
	for k, at := range live.offWas {
		if strings.HasPrefix(k, "bodies|") {
			offSince[strings.TrimPrefix(k, "bodies|")] = at
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
		out = append(out, heldLine{V234: true, ID: id, Company: strings.TrimSpace(m.CName), CGUID: liveGUID(strings.TrimSpace(m.CGUID)), Type: cutRunes(strings.TrimSpace(m.VType), 200),
			No: cutRunes(strings.TrimSpace(m.VNo), 200), Date: normDate(m.VDate), MID: mid, At: at.Format(time.RFC3339), Ev: ev, Mismatch: mismatch,
			LineGuid: cut(cleanGUID(lg), 80), LineAlter: toI64(onlyDigits(m.PreAID))})
	}
	for _, path := range liveFiles() {
		name := filepath.Base(path)
		if strings.EqualFold(name, "failed.txt") {
			continue
		}
		day := liveFileDay(name)
		if day == "" {
			if fi, err := os.Lstat(path); err == nil {
				day = fi.ModTime().Format("20060102")
			}
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
	// 2.3.1 (the owner's last change): while the shared retry schedule waits (retry.go) nothing is asked; the held lines
	// are asked at its next try, and a line not answered then is not spaced by RecorderResolveSec: it goes at the next try
	if retryHeld() {
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
	stopped, kept := readStopped(), 0 // 2.3.5 (review L2)
	wait := time.Duration(keepNumZero("RecorderResolveSec", 600)) * time.Second
	var ids []string
	for id := range items {
		ids = append(ids, id)
	}
	// 2.3.3: the newest first (a line sent held at once from today's saves, then by when it joined the list), so the held
	// backlog never starves a new save
	sort.Slice(ids, func(i, j int) bool {
		a, b := items[ids[i]], items[ids[j]]
		if a.Fresh != b.Fresh {
			return a.Fresh
		}
		if a.Fresh && a.FreshTries+a.Asked != b.FreshTries+b.Asked {
			return a.FreshTries+a.Asked < b.FreshTries+b.Asked // the one asked least first (a new save before one asked already)
		}
		if a.Added != b.Added {
			return a.Added > b.Added
		}
		return ids[i] < ids[j]
	})
	var ask []heldLine
	var ends []heldEnd              // 2.3.2: lines ended now with the Day Book words (sent so after the list is saved)
	prevLast := map[string]string{} // the line's last ask before this turn's: put back when Tally did not answer in time
	refetchAsked := 0
	spKnown := map[string]bool{}
	upgraded := 0
	for _, id := range ids {
		h := items[id]
		rid := id + ":resolved"
		if !h.V234 {
			// 2.3.4: a line an older bridge kept (tries 20, final, refetch, any ask count): one ask with the fast request now
			// (FastAgain: its one ask is this version's, whatever an older bridge sent or ended; Added now: not dropped as 7 days old)
			h.V234, h.FastAgain, h.Tries, h.Final, h.Asked, h.Allow, h.Slow, h.Last, h.Why = true, true, 0, false, 0, 1, 0, "", ""
			h.ObjAsks, h.StopWait = 0, false // 2.3.4 (answer B): its asks in this version: the upgrade ask, and one more after a stop
			h.Added = now.Format(time.RFC3339)
			items[id] = h
			changed = true
			upgraded++
		}
		live.mu.Lock()
		liveFresh()
		done := live.sent[rid] && (!h.Again || live.items231[rid]) && !liveLedgerAgainDue(h) // 2.3.1 review H1: an older bridge's resolution is not this one
		done = done || live.ended[id]                                                        // 2.3.2: ended with the Day Book words
		endNow := false
		if h.FastAgain && h.StopWait {
			// 2.3.4 (answer B): its one fast ask was stopped: its one more ask is still owed (done only once resolved here)
			done = live.queued[rid] || live.mine[rid]
		} else if h.FastAgain {
			// next-fastfetch: an earlier bridge's ending is not this one: done once its one fast ask went (or its ":resolved" waits).
			// 2.3.4 (re-review M1): its ask went but nothing came of it (an answer that could not be read, another error, a
			// posting stopping it, no entry): it ends now with the Day Book words, never dropped without its ":resolved"
			done = live.fastAsked[id] || live.queued[rid]
			// 2.3.4 re-review 2 (N-M1): nor a line this version resolved with no body (a cancel / delete proven by its GUID)
			endNow = live.fastAsked[id] && !live.queued[rid] && !live.bodied[rid] && !live.mine[rid]
		}
		waiting := live.queued[rid]
		ownOpen := !h.Refetch || liveOwnOpenNow(h.CGUID, h.Company)
		live.mu.Unlock()
		if endNow {
			ends = append(ends, heldEnd{h, liveHeldOnceGiveUp})
			delete(items, id)
			changed = true
			continue
		}
		added, _ := time.Parse(time.RFC3339, h.Added)
		if !done && !added.IsZero() && now.Sub(added) > 7*24*time.Hour && stopped {
			// 2.3.5 (review L2): never dropped while FinCom's read stop is on (FinCom shows it waiting, and it is not asked):
			// its 7 days start again from now, so it is asked after the resume and settles or ends with the Day Book words
			h.Added = now.Format(time.RFC3339)
			items[id] = h
			changed = true
			kept++
			added = now
		}
		if done || (!added.IsZero() && now.Sub(added) > 7*24*time.Hour) {
			delete(items, id)
			changed = true
			continue
		}
		// 2.3.2 (issue 232, c): its company is marked "entry fetch stopped: over 2 s": it ends with the plain words, nothing
		// asked of Tally (2.3.3: every held line of it, old or new). 2.3.3: its one ask again is used: it ends with the Day Book words
		// 2.3.4 (answer B): never a third fast ask, whatever came back (an answer that could not be read is not a try)
		if !waiting && !h.Final && (slowMarked(h.Company, h.CGUID) || h.Asked >= h.allow() || h.ObjAsks >= liveObjAsksMax) {
			w := liveHeldOnceGiveUp
			if slowMarked(h.Company, h.CGUID) {
				w = slowWords
			}
			ends = append(ends, heldEnd{h, w})
			delete(items, id)
			changed = true
			continue
		}
		// 2.3.4: never left for ever: a line that used its tries ends now with the Day Book words (an older bridge's line
		// at 20 tries was asked once above first)
		if !waiting && !h.Final && h.Tries >= liveHeldMaxTries {
			ends = append(ends, heldEnd{h, liveHeldGiveUp})
			delete(items, id)
			changed = true
			continue
		}
		if waiting || h.Final || len(ask) >= 10 {
			if len(ask) >= 10 && !waiting && !h.Final {
				liveSay(h.Type, h.No, h.Date, h.MID, id, "not asked this turn: 10 held lines asked already; asked in a later turn")
			}
			continue
		}
		// 2.3.3: nothing can be asked for a company whose starting point is not recorded yet (the request is refused before it
		// is sent): the line waits for it, its one ask not spent and its spacing not started
		sp, had := spKnown[h.Company]
		if !had {
			_, sp = startPointOf(h.Company)
			spKnown[h.Company] = sp
		}
		if !sp {
			continue
		}
		// 2.3.3: no 1 h / 4 h ladder any more (a held line is asked again once); a new save sent held at once: at the next try
		spacing := wait
		if h.Fresh {
			spacing = liveFreshSpacing() // 2.3.3: sent held at once: asked at the next try
		}
		if h.StopWait {
			spacing = liveStopRetry() // 2.3.4 (answer B): its fast request was stopped: its one more ask 5 minutes on
		}
		if last, err := time.Parse(time.RFC3339, h.Last); err == nil && now.Sub(last) < spacing {
			continue
		}
		// after 2.3.0: a line FinCom asked for again (refetch): only while this bridge's own Tally has its company open (the
		// own-Tally rule), and one such line a turn
		if h.Refetch && !ownOpen {
			liveSay(h.Type, h.No, h.Date, h.MID, id, "not asked: its company is not open in this bridge's own Tally; asked when it is")
			continue
		}
		if h.Refetch && refetchAsked >= 1 {
			continue
		}
		if h.Refetch {
			refetchAsked++
		}
		prevLast[id] = h.Last
		h.Last = now.Format(time.RFC3339) // spaced whatever the answer (2.3.1: but a stop or no answer waits for the retry)
		items[id] = h
		changed = true
		ask = append(ask, h)
	}
	if changed {
		liveHeldSave(all, items)
	}
	heldMu.Unlock()
	if kept > 0 {
		writeLog(fmt.Sprintf("Recorder: %d held line(s) 7 days in the list are kept while reading is stopped from FinCom (not asked meanwhile): asked when it is resumed", kept))
	}
	if upgraded > 0 {
		writeLog(fmt.Sprintf("Recorder: %d held line(s) kept by an earlier bridge are asked once with the fast request (whatever their earlier tries): answered, each goes to FinCom with Tally's body; else it ends with the Day Book words", upgraded))
	}
	for _, e := range ends {
		liveHeldEnd(e.h, e.why)
	}
	// the asks, outside the lock
	type res struct {
		id, x, why          string
		answered, final, ok bool // ok: its entry came (or a cancel / delete was proven)
	}
	var got []res
	retryIds := map[string]bool{}
	timedOut := map[string]bool{} // asked, and stopped at 2 s or not answered
	objStop := map[string]bool{}  // 2.3.4 (option (a)): of them, its FinComVoucherObject stopped at the limit
	objAsked := map[string]bool{} // 2.3.4 (answer B): its FinComVoucherObject request reached Tally this turn
	slowEnd := map[string]bool{}  // 2.3.2 (c): its company was marked meanwhile: ended with the plain words
	deadline := time.Now().Add(time.Duration(keepNum("RecorderResolveTurnSec", 20)) * time.Second)
	total, fromFinCom := len(items), 0
	for _, h := range items {
		if h.Cloud {
			fromFinCom++
		}
	}
	resolved := 0
	defer func() {
		if len(ask) > 0 {
			writeLog(fmt.Sprintf("Recorder: held lines: %d from FinCom, %d asked, %d resolved, %d still held (%d in the list)", fromFinCom, len(got), resolved, total-resolved, total))
		}
	}()
	for i, h := range ask {
		if time.Now().After(deadline) {
			for _, r := range ask[len(got):] {
				liveSay(r.Type, r.No, r.Date, r.MID, r.ID, "not asked this turn: 20 s passed; asked in the next one")
			}
			break
		}
		// 2.3.3 (review M1): a live line waits: it goes first; this line and the rest are asked at a later turn (not counted)
		if liveQueueReady() {
			for _, r := range ask[i:] {
				retryIds[r.ID] = true
			}
			break
		}
		reached := false // re-review L1: this ask's own request was sent to Tally
		liveSay(h.Type, h.No, h.Date, h.MID, h.ID, fmt.Sprintf("asking Tally again (a held line, ask %d of %d: one request; if it stops or fails the line ends with the Day Book words)", h.Asked+1, h.allow()))
		var x, why string
		var answered, final bool
		var err error
		var gc *change // review H1 (the owner's addition): a held cancel / delete proven in this Tally now
		if h.Ev == "deleted" || h.Ev == "cancelled" {
			gc, why, answered, final, err = liveResolveGuid(h, &reached)
		} else {
			x, why, answered, final, err = liveResolveOne(h, &reached)
		}
		if h.FastAgain && reached {
			liveFastAskedNote(h.ID) // next-fastfetch: its one fresh ask reached Tally: never asked once more
		}
		if reached && h.MID != "" && h.Ev != "deleted" && h.Ev != "cancelled" {
			objAsked[h.ID] = true
		}
		if gaveWay(err) {
			// review L1: a request a posting stopped after it reached Tally counts as its ask (Tally had it); one that never
			// reached Tally (it waited for the lock, or gave way before it was sent) does not (re-review L1)
			if reached && h.Ev != "deleted" && h.Ev != "cancelled" {
				timedOut[h.ID] = true
				liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "stopped for a posting after it reached Tally: its ask is used")
			} else {
				liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "not asked: a posting is going on; asked after it")
			}
			for _, r := range ask[i+1:] {
				retryIds[r.ID] = true
			}
			break
		}
		if errors.Is(err, errSlowCompany) {
			slowEnd[h.ID] = true
			got = append(got, res{id: h.ID})
			continue
		}
		if errors.Is(err, errRecorderStop) || tallyNoAnswer(err) {
			// Tally had the request and did not answer in time: its ask is used (2.3.3: the line ends when it was its last);
			// those not asked yet go at the retry schedule's next try, as before
			timedOut[h.ID] = true
			if errors.Is(err, errRecorderStop) && h.MID != "" && h.Ev != "deleted" && h.Ev != "cancelled" {
				objStop[h.ID] = true // 2.3.4 (option (a), answer B): the fast request stopped at the limit
			}
			for _, r := range ask[len(got)+1:] {
				retryIds[r.ID] = true
			}
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, fmt.Sprintf("not answered in time: %s (ask %d of %d)", cutRunes(err.Error(), 160), h.Asked+1, h.allow()))
			break
		}
		if liveStopRefused(err, reached) {
			// 2.3.5 (review L1): FinCom's read stop refused it, nothing sent: not a try, and its last ask is put back, so this
			// line and those not asked yet are asked at the first turn after the resume
			for _, r := range ask[len(got):] {
				retryIds[r.ID] = true
			}
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "not asked this time: "+cutRunes(err.Error(), 160)+"; asked when reading is resumed (not counted as a try)")
			break
		}
		if errors.Is(err, errRetryWait) {
			// 2.3.1: nothing was sent (the retry schedule waits): this line and those not asked yet go at its next try
			for _, r := range ask[len(got):] {
				retryIds[r.ID] = true
			}
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "not asked this time: "+cutRunes(err.Error(), 160)+"; asked again by itself (not counted as a try)")
			break
		}
		if err != nil {
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "not asked this time: "+cutRunes(err.Error(), 160)+" (not counted as a try)")
		} else if x == "" && gc == nil && !final {
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "still held: "+or(cutRunes(why, 200), "Tally gave nothing yet"))
		}
		got = append(got, res{h.ID, x, why, answered, final, x != "" || gc != nil})
		if gc != nil {
			live.mu.Lock()
			liveFresh()
			if !live.sent[gc.lineId] && !live.queued[gc.lineId] {
				liveQueueAdd(gc)
			}
			live.mu.Unlock()
			resolved++
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "proven in this Tally now: the "+map[bool]string{true: "cancel", false: "delete"}[h.Ev == "cancelled"]+" goes as "+gc.lineId)
			continue
		}
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
		if (h.FastAgain && !live.queued[rid]) || !liveResolvedDone(rid, h.Again) || (!live.queued[rid] && liveLedgerAgainDue(h)) {
			c.ledAgain = h.LedgerAgain
			liveQueueAdd(c)
		}
		live.mu.Unlock()
		resolved++
		writeLog(fmt.Sprintf("Recorder: %s %s of %s in %s resolved: sent as %s with its GUID %s and body", h.Type, h.No, h.Date, h.Company, c.event, c.guid))
	}
	if len(got) == 0 && len(retryIds) == 0 && len(timedOut) == 0 {
		return
	}
	// the answers merged into the list as it is now
	heldMu.Lock()
	all, items = liveHeldLoad()
	var ends2 []heldEnd
	defer func() {
		heldMu.Unlock()
		for _, e := range ends2 {
			liveHeldEnd(e.h, e.why)
		}
	}()
	for id := range retryIds {
		if h, had := items[id]; had {
			h.Last = prevLast[id]
			items[id] = h
		}
	}
	for id := range objAsked {
		if h, had := items[id]; had {
			h.ObjAsks++ // 2.3.4 (answer B): one more of its fast asks; its one more ask after a stop is now spent
			h.StopWait = false
			items[id] = h
		}
	}
	for id := range timedOut {
		if h, had := items[id]; had {
			h.Asked++ // 2.3.3: its ask is used; the last one ends it with the Day Book words
			if objStop[id] {
				// 2.3.4 (the owner's answer B, 08-Oct-2026; re-review M4): a stop of its fast request: asked once more after
				// 5 minutes when it had one fast ask only; its second ends it with the Day Book words. Never more than two
				if h.ObjAsks >= liveObjAsksMax {
					ends2 = append(ends2, heldEnd{h, liveStopEndWords()})
					delete(items, id)
					continue
				}
				h.StopWait = true
				h.Allow = minI(maxI(h.allow(), h.Asked+1), 2)
				h.Why = liveCapWhy(liveStopOnceWords())
				liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "held: "+h.Why+" (its fast request stopped; asked once more, never again after that)")
				items[id] = h
				continue
			}
			if h.Asked >= h.allow() {
				ends2 = append(ends2, heldEnd{h, liveHeldSlowGiveUp})
				delete(items, id)
				continue
			}
			items[id] = h
		}
	}
	for id := range slowEnd {
		if h, had := items[id]; had {
			ends2 = append(ends2, heldEnd{h, slowWords})
			delete(items, id)
		}
	}
	for _, r := range got {
		h, had := items[r.id]
		if !had || slowEnd[r.id] {
			continue
		}
		if r.answered {
			h.Tries++
			h.TriesVer = BridgeVersion
		}
		if r.answered && !r.ok && !r.final {
			// 2.3.3: Tally answered without the entry: its ask is used; the last one ends it with the Day Book words
			h.Asked++
			if h.Asked >= h.allow() {
				ends2 = append(ends2, heldEnd{h, liveHeldOnceGiveUp})
				delete(items, r.id)
				continue
			}
		}
		if r.final && h.FastAgain {
			// 2.3.4: its one ask again (an older bridge's line, or one 2.3.3 ended) found Tally's voucher is not its entry:
			// it ends now with the Day Book words, never left held unasked
			w := or(liveCapWhy(r.why), "Tally's voucher is not this line's entry")
			ends2 = append(ends2, heldEnd{h, strings.TrimSuffix(w, liveHeldFinalEnd) + liveHeldFinalEnd})
			delete(items, r.id)
			continue
		}
		if r.final {
			h.Final = true
			if r.why != "" {
				h.Why = liveCapWhy(r.why)
			}
			liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "held: "+or(h.Why, "Tally's voucher is not this line's entry")+" (not asked again)")
		}
		items[r.id] = h
	}
	liveHeldSave(all, items)
}

// under live.mu: a line FinCom listed again because its ":resolved" line waited for a ledger, not yet sent again by this
// bridge (2.3.1, masters)
func liveLedgerAgainDue(h heldLine) bool {
	return h.LedgerAgain && !live.ledAgain[h.ID+":resolved"]
}

const (
	liveHeldMaxTries = 20
	liveHeldGiveUp   = "Tally did not give this entry after 20 tries; upload that day's Day Book to settle it"
	liveHeldSlowMax  = 3 // 2.3.2 (issue 232, b); 2.3.3: no longer used (a held line is asked again once)
	// 2.3.3: a held line whose one ask again Tally answered without its entry ends with these words
	liveHeldOnceGiveUp = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"
)

// 2.3.2 (issue 232, b): how long a line whose asks timed out n times waits for its next ask: 1 h after the first, 4 h after
// the second (RecorderSlowRetry1Sec, RecorderSlowRetry2Sec)
func liveSlowSpacing(n int) time.Duration {
	if n <= 1 {
		return time.Duration(keepNum("RecorderSlowRetry1Sec", 3600)) * time.Second
	}
	return time.Duration(keepNum("RecorderSlowRetry2Sec", 4*3600)) * time.Second
}

type heldEnd struct {
	h   heldLine
	why string
}

// 2.3.2 (issue 232): a held line ends with the Day Book words: "<line id>:resolved" goes up held with them (no body, no
// GUID: FinCom keeps it held and says the words), the line is never asked or sent again (sync\recorder-sent\*.ended.txt)
func liveHeldEnd(h heldLine, words string) {
	rid := h.ID + ":resolved"
	ev := or(h.Ev, "created")
	c := &change{company: h.Company, companyGuid: h.CGUID, event: ev, vchType: h.Type, vchNo: h.No, vchDate: h.Date, masterId: h.MID, source: "addon",
		lineId: rid, at: h.At, saveMs: -1, readAt: nowFn(), bodyTried: true, heldWhy: liveCapWhy(words), heldFinal: true, slowEnded: true,
		lineGuid: h.LineGuid, lineFid: h.LineFid, idsMismatch: h.Mismatch, guidHeld: ev == "deleted" || ev == "cancelled"}
	live.mu.Lock()
	liveFresh()
	// 2.3.4 (review L4): a line asked once more (an earlier bridge ended it, or kept it) whose ask fails sends its
	// ":resolved" with the Day Book words again: FinCom then holds two and stops listing it
	if !live.queued[rid] && (h.FastAgain || (!live.sent[rid] && !live.ended[h.ID])) {
		liveQueueAdd(c)
	}
	liveEndedNote(h.ID)
	live.mu.Unlock()
	liveSaveIds([]string{h.ID}, liveEndedSuffix)
	liveSaveIds([]string{h.ID}, liveFastSuffix)
	liveSay(h.Type, h.No, h.Date, h.MID, h.ID, "held: "+words+" (ended: not asked of Tally again)")
}

// one held line's entry asked of Tally: by MasterID when the line had it, else (or when Tally gave nothing with that
// MasterID) by type, number and date; checked as the body fetch checks it (liveVoucherWrong). Security L3: when the
// MasterID gave another real voucher, nothing is asked by number (final). answered: Tally answered a request (a try)
func liveResolveOne(h heldLine, sent *bool) (x, why string, answered, final bool, err error) {
	sp, spOK := startPointOf(h.Company)
	tc := recorderTC(nil)
	tc.sentOut = sent // re-review L1: whether the ask reached Tally
	port, err := findCompanyPortBg(h.Company, 0)
	if err != nil {
		return "", "", false, false, err
	}
	w := liveWant{company: h.Company, cguid: h.CGUID, typ: h.Type, no: h.No, date: h.Date, mid: h.MID, sp: sp, spOK: spOK, lineAlter: h.LineAlter}
	if liveResolveAskHook != nil {
		liveResolveAskHook()
	}
	if h.MID != "" {
		m, err := fetchVouchersByMasterIn(tc, h.Company, port, h.Date, []string{h.MID}, liveBodySec())
		if errors.Is(err, errFastShape) {
			return "", err.Error(), true, true, nil // 2.3.4: held for good (the same answer would come again)
		}
		if err != nil {
			return "", "", false, false, err
		}
		w2, kind := liveVoucherWrong(m[h.MID], "voucher with MasterID "+h.MID, w)
		if w2 == "" {
			return m[h.MID], "", true, false, nil
		}
		// 2.3.3 (the owner's rule): ONE request per ask of a held line: not asked by its number after its MasterID
		return "", w2, true, kind == wrongFinal, nil
	}
	if h.No == "" || !liveNumberText(h.No) || !liveNumberText(h.Type) {
		return "", why, answered, h.MID == "", nil
	}
	x, w3, kind, err := liveOneByNumber(tc, h.Company, port, w, liveBodySec())
	if err != nil {
		return "", why, answered, false, err
	}
	return x, w3, true, kind == wrongFinal, nil
}

// --- 2.2.2: the lines the cloud holds (the beat's answer "heldLines": [{line_id, company, company_guid, event,
// master_id, vch_type, vch_no, vch_date}], at most 200, this computer's, the last 7 days). The re-scan of the add-on's
// files cannot know a line an earlier bridge sent without its body for a passing reason (staging lines 9, 11, 15); the
// cloud does. Each joins the held list once (not one already resolved, or sent with its body) and is asked like any
// other: the MasterID only as the key to ask Tally, every acceptance rule unchanged (liveVoucherWrong); the cloud's GUID
// and AlterID are not even read
var reHeldID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,80}$`)

func applyHeldLines(j M) {
	rows := arr(j["heldLines"])
	if len(rows) == 0 {
		return
	}
	if len(rows) > 200 {
		rows = rows[:200]
	}
	var cs []heldLine
	now := nowFn().Format(time.RFC3339)
	for _, r := range rows {
		e := obj(r)
		id := strings.TrimSpace(str(e["line_id"]))
		ev := strings.TrimSpace(str(e["event"]))
		if !reHeldID.MatchString(id) || strings.HasSuffix(id, ":resolved") || (ev != "created" && ev != "altered" && ev != "imported") {
			continue
		}
		co, cg := cutRunes(strings.TrimSpace(str(e["company"])), 200), cut(cleanGUID(str(e["company_guid"])), 100)
		date := normDate(str(e["vch_date"]))
		if co == "" || cg == "" || len(date) != 8 || !isTallyDate(date) {
			continue
		}
		if held := heldGUID(co); held != "" && !strings.EqualFold(held, cg) {
			continue // not the company this computer holds under that name
		}
		mid := onlyDigits(str(e["master_id"]))
		if len(mid) > 18 || toI64(mid) <= 0 {
			mid = ""
		}
		typ, no := cutRunes(strings.TrimSpace(str(e["vch_type"])), 200), cutRunes(strings.TrimSpace(str(e["vch_no"])), 200)
		if mid == "" && (no == "" || !liveNumberText(no) || !liveNumberText(typ)) {
			continue // nothing to ask Tally by
		}
		cs = append(cs, heldLine{V234: true, ID: id, Company: co, CGUID: cg, Type: typ, No: no, Date: date, MID: mid, At: now, Added: now, Ev: ev, Cloud: true})
	}
	if len(cs) == 0 {
		return
	}
	live.mu.Lock()
	liveFresh()
	var fresh []heldLine
	for _, h := range cs {
		rid := h.ID + ":resolved"
		// next-fastfetch: a line an earlier bridge ended with the Day Book words is asked once more with the fast request
		again := liveFastAgainDue(h.ID)
		if live.queued[rid] || live.bodied[h.ID] || (!again && (live.sent[rid] || live.ended[h.ID])) {
			continue
		}
		h.FastAgain = again
		fresh = append(fresh, h)
	}
	live.mu.Unlock()
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	added := 0
	fastN := 0
	for _, h := range fresh {
		if _, had := items[h.ID]; had {
			continue
		}
		if h.FastAgain {
			h.Allow, fastN = 1, fastN+1
		}
		items[h.ID] = h
		added++
	}
	if fastN > 0 {
		writeLog(fmt.Sprintf("Recorder: %d held line(s) an earlier bridge ended with the Day Book words are asked once more with the fast request (one request each); answered, each goes to FinCom with Tally's GUID and body", fastN))
	}
	// said whatever the outcome (once in 10 minutes while it stays the same)
	liveSayOnce(fmt.Sprintf("heldbeat|%d|%d|%d|%d", len(rows), len(cs), len(fresh), added), fmt.Sprintf(
		"Recorder: FinCom holds %d line(s) of this computer without their entry: %d new in the held list, %d there already, %d resolved or sent with their body already, %d not taken (not this company's, no date, or nothing to ask Tally by)",
		len(rows), added, len(fresh)-added, len(cs)-len(fresh), len(rows)-len(cs)))
	if added == 0 {
		return
	}
	liveHeldCap(items)
	liveHeldSave(all, items)
	writeLog(fmt.Sprintf("Recorder: FinCom holds %d line(s) of this computer without their entry; each is asked of Tally again (by its MasterID, else its number) and sent with Tally's GUID and body once Tally gives it", added))
}

// --- after 2.3.0 (06-Oct-2026, the owner: "the bridge must ask again for held lines of its own user and settle them"): FinCom's
// beat answer "refetch": [{line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date}], at most 20 of
// THIS bridge's own held lines (the same computer key and bridge id) whose body is missing or whose GUID is a placeholder
// (staging's lines 4, 17 and 18). Unlike heldLines, a line the bridge sent WITH its body (line 18: Tally's typed XML the
// cloud could not read before 06-Oct-2026) is taken too: FinCom says it holds no body. A line whose ":resolved" line went
// already is not. Taken only for a company this bridge's own Tally has open (the own-Tally rule) and under the GUID held
// for it. Asked like any held line (liveResolveTurn: by MasterID, else by type and number; postings first; the 2-second
// stop; every acceptance rule unchanged), one such line a turn, each at most every 10 minutes, 20 tries at most over 7
// days; tries an older version counted (it could not read a real Tally's typed answer) start again once. The cloud's
// GUID and AlterID are never read
const refetchMax = 20

func applyRefetch(j M) {
	rows := arr(j["refetch"])
	if len(rows) == 0 {
		return
	}
	if len(rows) > refetchMax {
		rows = rows[:refetchMax]
	}
	now := nowFn().Format(time.RFC3339)
	var cs []heldLine
	notOwn := 0
	for _, r := range rows {
		e := obj(r)
		id := strings.TrimSpace(str(e["line_id"]))
		ev := strings.TrimSpace(str(e["event"]))
		if !reHeldID.MatchString(id) || strings.HasSuffix(id, ":resolved") || (ev != "created" && ev != "altered" && ev != "imported") {
			continue
		}
		co, cg := cutRunes(strings.TrimSpace(str(e["company"])), 200), cut(cleanGUID(str(e["company_guid"])), 100)
		date := normDate(str(e["vch_date"]))
		if co == "" || cg == "" || len(date) != 8 || !isTallyDate(date) {
			continue
		}
		if held := heldGUID(co); held == "" || !strings.EqualFold(held, cg) {
			notOwn++
			continue // not the company this bridge holds under that name
		}
		mid := onlyDigits(str(e["master_id"]))
		if len(mid) > 18 || toI64(mid) <= 0 {
			mid = ""
		}
		typ, no := cutRunes(strings.TrimSpace(str(e["vch_type"])), 200), cutRunes(strings.TrimSpace(str(e["vch_no"])), 200)
		if mid == "" && (no == "" || !liveNumberText(no) || !liveNumberText(typ)) {
			continue // nothing to ask Tally by
		}
		cs = append(cs, heldLine{V234: true, ID: id, Company: co, CGUID: cg, Type: typ, No: no, Date: date, MID: mid, At: now, Added: now, Ev: ev, Cloud: true, Refetch: true,
			LedgerAgain: truthy(e["ledgerAgain"])})
	}
	live.mu.Lock()
	liveFresh()
	var fresh []heldLine
	done := 0
	for i, h := range cs {
		rid := h.ID + ":resolved"
		// 2.3.1 review H1: FinCom lists a line again whose ":resolved" line an older bridge sent (2.3.0's request, without the
		// items' ledger lines: held by the cloud's guard). That earlier mark is not this version's: asked and sent once more,
		// under the same id (the cloud's rules match it). One this version sent, or queued, is done
		// 2.3.1 (masters): FinCom held this version's ":resolved" line waiting for a ledger (in now): asked once more
		if liveFastAgainDue(h.ID) && !live.queued[rid] && !live.bodied[h.ID] {
			// next-fastfetch: ended by an earlier bridge with the Day Book words: asked once more with the fast request
			h.FastAgain, h.Allow = true, 1
			cs[i] = h
		} else if (liveResolvedDone(rid, true) && !liveLedgerAgainDue(h)) || live.ended[h.ID] {
			done++ // 2.3.2: or ended with the Day Book words
			continue
		}
		if live.sent[rid] && !h.FastAgain {
			h.Again = true
			cs[i] = h
		}
		if !liveOwnOpenNow(h.CGUID, h.Company) {
			notOwn++
			continue
		}
		fresh = append(fresh, h)
	}
	live.mu.Unlock()
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	added, again := 0, 0
	for _, h := range fresh {
		old, had := items[h.ID]
		if !had {
			items[h.ID] = h
			added++
			continue
		}
		if h.LedgerAgain && !old.LedgerAgain {
			// 2.3.1 (masters): its ":resolved" line waited for a ledger FinCom has now: asked afresh once
			old.Again, old.LedgerAgain, old.Refetch, old.Cloud = true, true, true, true
			old.Tries, old.Final, old.Why, old.Last = 0, false, "", ""
			items[h.ID] = old
			again++
			continue
		}
		if h.Again && !old.Again {
			// 2.3.1 review H1: still in the list from the older bridge: asked afresh once under this version
			old.Again, old.Refetch, old.Cloud = true, true, true
			if old.TriesVer != BridgeVersion {
				old.Tries, old.Final, old.Why, old.Last = 0, false, "", ""
			}
			items[h.ID] = old
			again++
			continue
		}
		if !old.Refetch {
			old.Refetch, old.Cloud = true, true
			if (old.Tries > 0 || old.Final) && old.TriesVer != BridgeVersion {
				// tries of an older bridge: Tally's typed answer was not read then; asked afresh under this version's rules
				old.Tries, old.Final, old.Why, old.Last = 0, false, "", ""
				again++
			}
			items[h.ID] = old
		}
	}
	liveSayOnce(fmt.Sprintf("refetch|%d|%d|%d|%d|%d|%d", len(rows), len(fresh), added, again, done, notOwn), fmt.Sprintf(
		"Recorder: FinCom asks again for %d held line(s) of this bridge: %d new in the held list, %d asked afresh (tries of an older version), %d there already, %d resolved already, %d not this bridge's own Tally's (company not open here or another GUID)",
		len(rows), added, again, len(fresh)-added-again, done, notOwn))
	if added+again == 0 {
		return
	}
	liveHeldCap(items)
	liveHeldSave(all, items)
}

// next-fastfetch: a held line's one fresh ask with the fast request reached Tally (noted and kept 7 days)
func liveFastAskedNote(id string) {
	live.mu.Lock()
	liveFresh()
	had := live.fastAsked[id]
	live.fastAsked[id] = true
	live.mu.Unlock()
	if !had {
		liveSaveIds([]string{id}, liveFastSuffix)
	}
}
