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

// the one entry found is the line's: above the starting point, of the line's company. "" : it is
func liveFoundWrong(x, cguid string, sp int64) string {
	g := strings.TrimSpace(html.UnescapeString(group(`<GUID>([^<]*)</GUID>`, x, 1)))
	switch {
	case g == "" || livePlaceholder(g):
		return "Tally gave the entry without its GUID"
	case cguid != "" && !strings.HasPrefix(g, cguid+"-"):
		return "Tally gave an entry of another company"
	case sp > 0 && toI64(group(`<ALTERID>\s*(\d+)`, x, 1)) <= sp:
		return "Tally's entry is not above the starting point"
	}
	return ""
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
	c.ledgers = voucherLedgerNames(x)
	if c.during {
		for _, n := range c.ledgers {
			liveTouch(c.company, n)
		}
	}
}

func liveNumberHeld(c *change, why string) {
	live.mu.Lock()
	c.bodyTried = true
	live.mu.Unlock()
	writeLog(fmt.Sprintf("Recorder: %s %s of %s in %s: %s; sent without its body and GUID (FinCom holds the line until it is resolved)",
		c.vchType, c.vchNo, c.vchDate, c.company, cutRunes(why, 160)))
}

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
	tc := &TC{copier: true, yield: yield, timed: func(sec float64) {
		if sec > liveLimitSec() && !slow {
			slow = true
			liveTurnOff("bodies", key, company, sec)
		}
	}}
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
		if slow || time.Now().After(deadline) {
			liveNumberHeld(c, "not found by its type and number (the body fetch is off for this company, the 2 s rule, or 20 s passed)")
			continue
		}
		left := maxI(2, int(time.Until(deadline).Seconds()+0.999))
		got, err := fetchVoucherByNumber(tc, company, port, c.vchDate, c.vchType, c.vchNo, left)
		if gaveWay(err) {
			return
		}
		live.mu.Lock()
		switch {
		case err == nil && len(got) == 1:
			if why := liveFoundWrong(got[0], c.companyGuid, sp); why != "" {
				live.mu.Unlock()
				liveNumberHeld(c, why)
				continue
			}
			liveTakeBody(c, got[0])
			live.mu.Unlock()
			continue
		case err == nil && len(got) > 1:
			live.mu.Unlock()
			liveNumberHeld(c, fmt.Sprintf("%d entries with that type and number on that date", len(got)))
			continue
		}
		c.numTries++
		if c.numTries < 3 {
			c.askAfter = time.Now().Add(retry)
			live.mu.Unlock()
			continue
		}
		live.mu.Unlock()
		why := "not found by its type and number (asked 3 times)"
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
			MID: str(e["masterId"]), At: str(e["savedAt"]), Added: str(e["added"]), Last: str(e["last"]), Tries: toInt(e["tries"])}
	}
	return all, items
}

func liveHeldSave(all M, items map[string]heldLine) {
	o := M{}
	for id, h := range items {
		o[id] = M{"company": h.Company, "companyGuid": h.CGUID, "type": h.Type, "no": h.No, "date": h.Date, "masterId": h.MID, "savedAt": h.At,
			"added": h.Added, "last": h.Last, "tries": h.Tries}
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
			At: c.at, Added: now, Last: now}
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
	if str(all["scanned"]) != "" {
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
	all["scanned"] = now
	liveHeldSave(all, items)
	if len(found) > 0 {
		writeLog(fmt.Sprintf("Recorder: %d line(s) sent earlier with a placeholder GUID (a new entry) found in the add-on's files; each is sent again as created with its real GUID and body once Tally gives it", len(found)))
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
	consider := func(name string, gen int, m recLine, lineStart int64) {
		if !strings.EqualFold(m.Obj, "Voucher") || !strings.HasPrefix(m.Ev, "voucher_accept_") || !(livePlaceholder(m.GUID) || liveZero(m.MID)) {
			return
		}
		id := liveLineID(name, fmt.Sprint(gen), fmt.Sprint(lineStart))
		live.mu.Lock()
		was := live.sent[id] && !live.sent[id+":resolved"]
		live.mu.Unlock()
		if !was {
			return
		}
		at := liveTime(m.T1)
		if at.IsZero() {
			at = liveTime(m.T0)
		}
		mid := onlyDigits(m.MID)
		if toI64(mid) <= 0 {
			mid = ""
		}
		out = append(out, heldLine{ID: id, Company: strings.TrimSpace(m.CName), CGUID: liveGUID(strings.TrimSpace(m.CGUID)), Type: strings.TrimSpace(m.VType),
			No: strings.TrimSpace(m.VNo), Date: normDate(m.VDate), MID: mid, At: at.Format(time.RFC3339)})
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
						m, _ := liveMerge(p.l, l)
						consider(name, gen, m, ll.start)
						continue
					}
					consider(p.name, p.gen, p.l, p.start)
				}
				if _, first := livePair[l.Ev]; first {
					pending[l.CGUID] = &pend{l, name, gen, ll.start}
					continue
				}
				consider(name, gen, l, ll.start)
			}
			if upto <= off || upto >= size {
				break
			}
			off = upto
		}
	}
	for k, p := range pending {
		delete(pending, k)
		consider(p.name, p.gen, p.l, p.start)
	}
	return out
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
		c := &change{company: h.Company, companyGuid: h.CGUID, event: "created", vchType: h.Type, vchNo: h.No, vchDate: h.Date, source: "addon", lineId: rid,
			at: h.At, saveMs: -1, readAt: nowFn()}
		live.mu.Lock()
		liveFresh()
		liveTakeBody(c, x)
		if !live.sent[rid] && !live.queued[rid] {
			liveQueueAdd(c)
		}
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder: %s %s of %s in %s resolved: sent as created with its GUID %s and body", h.Type, h.No, h.Date, h.Company, c.guid))
	}
	if changed {
		liveHeldSave(all, items)
	}
}

// one held line's entry asked of Tally: by MasterID when the line had it, else by type and number; "" when not one
// entry of the line's company above the starting point
func liveResolveOne(h heldLine) (string, error) {
	sp, _ := startPointOf(h.Company)
	key := h.Company + "|" + h.CGUID
	tc := &TC{copier: true, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }, timed: func(sec float64) {
		if sec > liveLimitSec() {
			liveTurnOff("bodies", key, h.Company, sec)
		}
	}}
	port, err := findCompanyPort(h.Company, 0)
	if err != nil {
		return "", err
	}
	var got []string
	if h.MID != "" {
		m, err := fetchVouchersByMasterIn(tc, h.Company, port, h.Date, []string{h.MID}, liveBodySec())
		if err != nil {
			return "", err
		}
		if x := m[h.MID]; x != "" {
			got = append(got, x)
		}
	} else {
		got, err = fetchVoucherByNumber(tc, h.Company, port, h.Date, h.Type, h.No, liveBodySec())
		if err != nil {
			return "", err
		}
	}
	if len(got) != 1 {
		return "", nil
	}
	if liveFoundWrong(got[0], h.CGUID, sp) != "" {
		return "", nil
	}
	return got[0], nil
}
