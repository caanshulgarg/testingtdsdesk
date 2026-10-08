// Next (branch next-push): the reader's side of the full-entry line (pushline.go has its format and its XML).
//
// In the user's file the add-on writes, for one save in the voucher form: the heads line before the save
// (voucher_accept_pre), the heads line after it (voucher_accept_post), then the full entry (voucher_full, one or more
// parts). The reader:
//   - holds a voucher save's heads (a pair, or a post alone) until its full entry, which the add-on writes in the same Form
//     Accept: to the end of the read that took them; in a file that has given a full entry before (the new add-on), for
//     RecorderFullWaitMs (2 s) at most. A file that never gave one (an older add-on) keeps today's timing exactly;
//   - joins the full entry's parts; with the last one it builds the entry (its GUID by the rule, cross-checked against the
//     heads' GUIDs), and queues ONE change with Tally's XML as its body, "full": true: the heads' line ids go with it (sent
//     with it, never on their own). Nothing is asked of Tally for it;
//   - takes a save whose full entry does not come (an older add-on), is cut short (a part missing), cannot be read, or whose
//     GUIDs do not agree, by the 2.3.2 route: the heads as before (Tally is asked for the entry);
//   - deletes and cancels: unchanged (heads with the MasterID). An alteration is a full entry again, sent as "altered": it
//     replaces the entry before it in FinCom.
//
// Ordering: the line has no AlterID. The bridge sends push_seq (the order it took the lines: pushline.go livePushSeq),
// FinCom keeps it apart from Tally's AlterID (migration 69). The light check's counter (ALTVCHID, read every 10 minutes
// anyway) names a full entry's AlterID only when it is unambiguous: the counter moved by exactly 1 between two checks and
// exactly one save of the company was read here in between (none near the first check, no posting): then the entry, if it
// is still waiting to go, goes with that AlterID. No counter is read for a save.
package main

import (
	"fmt"
	"strings"
	"time"
)

// a voucher save's heads waiting for its full entry
type liveAwait struct {
	l                     recLine // the heads merged (pre and post), or the post alone
	ev                    string  // created / altered, as the heads say
	file                  string
	startFile             string // release-240 (next-outbox): the file the save's first line is in (a pair across midnight)
	gen                   int
	start, lineStart, end int64
	seen                  time.Time
	posting               bool
	preID                 string // a pre alone absorbed later (its own line id)
}

// a full entry's parts read so far
type livePushBuf struct {
	head             recLine
	file             string
	gen              int
	start, lineStart int64
	payloads         []string
	seen             time.Time
}

// a save read, for the light check's counter (pushCounter)
type liveSaveMark struct {
	at time.Time
	c  *change // a full entry (nil: any other voucher line)
}

type livePushCnt struct {
	v  int64
	at time.Time
}

func pushWait() time.Duration {
	return time.Duration(keepNumZero("RecorderFullWaitMs", 2000)) * time.Millisecond
}

// under live.mu: the push maps of this state
func livePushFresh() {
	if live.pushFiles == nil {
		live.pushFiles = map[string]bool{}
	}
	if live.await == nil {
		live.await = map[string]*liveAwait{}
	}
	if live.pushBuf == nil {
		live.pushBuf = map[string]*livePushBuf{}
	}
	if live.pushCnt == nil {
		live.pushCnt = map[string]livePushCnt{}
	}
	if live.saves == nil {
		live.saves = map[string][]liveSaveMark{}
	}
}

// under live.mu: a voucher save's heads held for its full entry (a pair merged, or a post alone). 0: nothing queued yet
func liveAwaitHold(pk string, m recLine, ev, file string, gen int, startFile string, start, lineStart, end int64, posting bool) int {
	livePushFresh()
	n := liveAwaitFlush(pk)
	if startFile == "" {
		startFile = file
	}
	live.await[pk] = &liveAwait{l: m, ev: ev, file: file, startFile: startFile, gen: gen, start: start, lineStart: lineStart, end: end, seen: nowFn(), posting: posting}
	return n
}

// under live.mu: the heads held for pk taken by the 2.3.2 route (no full entry came for them)
func liveAwaitFlush(pk string) int {
	livePushFresh()
	a := live.await[pk]
	if a == nil {
		return 0
	}
	delete(live.await, pk)
	n := liveEmitFrom(a.l, a.ev, a.file, a.gen, a.startFile, a.start, a.lineStart, a.end, a.posting) // release-240: both files held (next-outbox)
	return n
}

// under live.mu: a full-entry line (one part). The heads held for its company, or a pre waiting for its post, belong to it
func liveFullTake(file string, gen int, ll liveLogicalLine, l recLine, posting bool) int {
	livePushFresh()
	live.pushFiles[file] = true // this file is the new add-on's: its saves wait for their full entry
	pk := l.CGUID
	raw := ll.raw
	if raw == "" {
		raw = ll.text
	}
	p, ok := pushPayload(raw)
	part := 0
	if ok {
		fmt.Sscanf(p[len(pushMagic+"|part="):], "%d", &part)
	}
	b := live.pushBuf[pk]
	if !ok || part < 1 || (part == 1) != (b == nil) || (b != nil && (part != len(b.payloads)+1 || b.file != file || strings.TrimSpace(b.head.MID) != strings.TrimSpace(l.MID))) {
		// a part out of order, or of another entry: that entry is not taken from its full lines (its heads go by the 2.3.2 route)
		why := "a part of its full entry is missing or out of order"
		if !ok {
			why = "its full-entry line cannot be read"
		}
		n := livePushDrop(pk, why)
		if !ok || part != 1 {
			return n
		}
		b = nil
	}
	if b == nil {
		b = &livePushBuf{head: l, file: file, gen: gen, start: ll.start, lineStart: ll.start, seen: nowFn()}
		live.pushBuf[pk] = b
	}
	b.payloads = append(b.payloads, p)
	if !strings.HasSuffix(p, "|end=1") {
		return 0 // more parts follow
	}
	delete(live.pushBuf, pk)
	return livePushDone(pk, b, posting)
}

// under live.mu: the parts of pk not taken (said once); the heads held go by the 2.3.2 route
func livePushDrop(pk, why string) int {
	b := live.pushBuf[pk]
	delete(live.pushBuf, pk)
	if b != nil {
		liveSayOnce("pushdrop|"+pk+"|"+b.head.MID+"|"+b.head.T0, fmt.Sprintf("Recorder: %s %s: %s; Tally is asked for the entry as before", strings.TrimSpace(b.head.VType), strings.TrimSpace(b.head.VNo), why))
	}
	return liveAwaitFlush(pk)
}

// under live.mu: a full entry complete: queued as one change with its body; else its heads go by the 2.3.2 route
func livePushDone(pk string, b *livePushBuf, posting bool) int {
	a := live.await[pk]
	var pre *livePending
	if p := live.pending[pk]; p != nil && p.l.Ev == "voucher_accept_pre" {
		pre = p // a pre whose post never came: this full entry is that save's
	}
	// the event: as the heads say (Tally's own state before the save); without them, as the full line's head (the form after
	// the save) says, read as a post
	post := b.head
	post.Ev = "voucher_accept_post"
	var m recLine
	ev := ""
	switch {
	case a != nil && strings.TrimSpace(a.l.MID) == strings.TrimSpace(post.MID):
		m, ev = a.l, a.ev
	case pre != nil:
		m, ev = liveMerge(pre.l, post)
	default:
		m, ev = liveSingle(post)
	}
	fail := func(why string) int {
		liveSayOnce("pushfail|"+pk+"|"+b.head.MID+"|"+b.head.T0, fmt.Sprintf("Recorder: %s %s of %s: the full entry is not taken (%s); Tally is asked for the entry as before",
			strings.TrimSpace(b.head.VType), strings.TrimSpace(b.head.VNo), liveDay(normDate(b.head.VDate)), cutRunes(why, 200)))
		if a != nil {
			return liveAwaitFlush(pk)
		}
		if pre != nil {
			return 0 // the pre waits for its post as before
		}
		return liveEmit(post, ev, b.file, b.gen, b.start, b.lineStart, b.start, posting)
	}
	if ev != "created" && ev != "altered" {
		return fail("not a voucher saved in its form")
	}
	// security L6 (2.2.2): nothing of a company is taken before its starting point is recorded (the 2.3.2 route holds it)
	if _, ok := startPointOf(strings.TrimSpace(or(m.CName, b.head.CName))); !ok {
		return fail("the company's starting point is not recorded yet")
	}
	e, err := pushParse(b.payloads)
	if err != nil {
		return fail(err.Error())
	}
	mid := strings.TrimSpace(e.s("mid"))
	if mid != onlyDigits(post.MID) {
		return fail("the full entry's MasterID " + mid + " is not its line's " + strings.TrimSpace(post.MID))
	}
	guid, why := pushGuidCheck(post.CGUID, mid, ev, post.GUID, m.GUID, m.PreGUID)
	if why != "" {
		return fail(why)
	}
	if why := pushTrust(e, ev, post.CGUID, mid, post.GUID); why != "" {
		return fail(why)
	}
	// the party Tally stores when the form names none (pushparty.go): from the lists held here, else the fast request
	leds, grps := pushPartyListsOf(strings.TrimSpace(or(m.CName, b.head.CName)))
	party, why := pushDeriveParty(e, leds, grps)
	if why != "" {
		return fail(why)
	}
	e.scal["party"] = party
	if why := pushBankCheck(e, ev, leds, grps); why != "" {
		return fail(why)
	}
	x, err := pushEntryXML(e, guid, 0)
	if err != nil {
		return fail(err.Error())
	}
	// the heads of the same save go with it, never on their own
	var also []string
	start := b.start
	var holds []liveAt // release-240 (next-outbox): every place this save was read from waits for it
	if a != nil && strings.TrimSpace(a.l.MID) == mid {
		delete(live.await, pk)
		also = append(also, liveLineID(a.file, fmt.Sprint(a.gen), fmt.Sprint(a.lineStart)))
		if a.startFile == b.file && a.start < start {
			start = a.start
		}
		holds = append(holds, liveAt{a.startFile, a.start}, liveAt{a.file, a.lineStart})
	} else if a != nil {
		liveAwaitFlush(pk) // another save's heads (never the add-on's order): by the 2.3.2 route
	}
	if pre != nil && a == nil {
		delete(live.pending, pk)
		also = append(also, liveLineID(pre.file, fmt.Sprint(pre.gen), fmt.Sprint(pre.start)))
		if pre.file == b.file && pre.start < start {
			start = pre.start
		}
		holds = append(holds, liveAt{pre.file, pre.start})
	}
	id := liveLineID(b.file, fmt.Sprint(b.gen), fmt.Sprint(b.lineStart))
	if live.sent[id] || live.queued[id] {
		return 0
	}
	c := &change{company: strings.TrimSpace(m.CName), companyGuid: liveGUID(strings.TrimSpace(b.head.CGUID)), event: ev, guid: guid, masterId: mid,
		vchType: cutRunes(strings.TrimSpace(e.s("vtype")), 200), vchNo: cutRunes(strings.TrimSpace(e.s("vno")), 200), vchDate: normDate(e.s("date")),
		narr: e.s("narr"), user: cutRunes(strings.TrimSpace(b.head.User), 200), source: "addon", lineId: id, file: b.file, start: start, saveMs: -1,
		readAt: nowFn(), during: posting, xml: x, full: true, bodyTried: true, push: true, also: also}
	c.holds = append([]liveAt{{b.file, start}}, holds...)
	if c.company == "" {
		c.company = strings.TrimSpace(b.head.CName)
	}
	if r := []rune(c.narr); len(r) > liveNarrMax {
		c.narr = string(r[:liveNarrMax])
	}
	if liveNotLinkedLocked(c.key()) {
		liveCo(c.company).skipped++
		live.sent[id] = true
		for _, x := range also {
			live.sent[x] = true
		}
		return 0
	}
	if mm := reLiveFid.FindStringSubmatch(c.narr); mm != nil {
		c.fid = mm[1]
	}
	at := liveTime(b.head.T1)
	if at.IsZero() {
		at = liveTime(b.head.T0)
	}
	if at.IsZero() {
		at = c.readAt.In(liveZone)
	}
	c.at = at.Format(time.RFC3339)
	c.ledgers = voucherLedgerNames(x)
	c.pushSeq = livePushSeq(c.readAt.UnixMilli())
	liveMidNote(c.companyGuid, c.masterId, c.guid, c.vchType, c.vchNo, c.vchDate)
	if posting {
		live.lastPost = time.Now()
		for _, n := range c.ledgers {
			liveTouch(c.company, n)
		}
	}
	liveDecide(c, "taken from the add-on's full entry (GUID "+guid+" by the rule): nothing is asked of Tally")
	livePushSave(c)
	// the same save's heads queued already (they waited longer than RecorderFullWaitMs): this body goes in their place
	for _, q := range live.queue {
		if q.isLedger() || q.source != "addon" || q.xml != "" || q.companyGuid != c.companyGuid || q.masterId != mid || (q.event != "created" && q.event != "altered") {
			continue
		}
		q.xml, q.full, q.bodyTried, q.byNumber, q.guid, q.alterId, q.heldWhy, q.push, q.pushSeq = c.xml, true, true, false, c.guid, "", "", true, c.pushSeq
		q.idsMismatch, q.lineGuid, q.ledgers = false, "", c.ledgers
		q.holds = append(q.liveHolds(), c.holds...) // release-240 (next-outbox): this body's own places wait for it too
		q.also = append(q.also, c.lineId)
		q.also = append(q.also, also...)
		live.queued[c.lineId] = true
		for _, x := range also {
			live.queued[x] = true
		}
		return 1
	}
	liveQueueAdd(c)
	for _, x := range also {
		live.queued[x] = true
	}
	return 1
}

// under live.mu: a save read, for the light check's counter; the last hour kept
func livePushSave(c *change) {
	livePushFresh()
	k := companyKey(c.company)
	cut := nowFn().Add(-time.Hour)
	s := live.saves[k][:0]
	for _, x := range live.saves[k] {
		if x.at.After(cut) {
			s = append(s, x)
		}
	}
	var pc *change
	if c.push {
		pc = c
	}
	live.saves[k] = append(s, liveSaveMark{at: c.readAt, c: pc})
}

// under live.mu: the stale heads (no full entry within RecorderFullWaitMs) and full entries cut short (RecorderPairSec)
func livePushStale() int {
	livePushFresh()
	n := 0
	for k, a := range live.await {
		if nowFn().Sub(a.seen) >= pushWait() {
			n += liveAwaitFlush(k)
		}
	}
	wait := time.Duration(keepNum("RecorderPairSec", 10)) * time.Second
	for k, b := range live.pushBuf {
		if nowFn().Sub(b.seen) >= wait {
			n += livePushDrop(k, "its full entry was cut short (a part did not come)")
		}
	}
	return n
}

// under live.mu: the offset a file's reading must not pass: the first byte of a save held or a full entry being joined
func livePushOffset(name string, off int64) int64 {
	for _, a := range live.await {
		// release-240 (next-outbox): a save across two daily files holds both: its first line's file and its own
		if a.startFile == name && a.start < off {
			off = a.start
		}
		if a.file == name && a.lineStart < off {
			off = a.lineStart
		}
	}
	for _, b := range live.pushBuf {
		if b.file == name && b.start < off {
			off = b.start
		}
	}
	return off
}

// --- the light check's counter (startpoint.go lightCheckOpen, every 10 minutes per company; no request of its own): when
// ALTVCHID moved by exactly 1 since the last check and exactly one save of the company was read here in between (none
// within 5 s of the last check, no posting since it), that save is the change: a full entry still waiting to go takes the
// counter as its AlterID
func livePushCounter(company string, cur int64) {
	if cur <= 0 {
		return
	}
	k := companyKey(company)
	now := nowFn()
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	livePushFresh()
	prev := live.pushCnt[k]
	live.pushCnt[k] = livePushCnt{v: cur, at: now}
	if prev.v <= 0 || cur != prev.v+1 || (!live.lastPost.IsZero() && live.lastPost.After(prev.at)) {
		return
	}
	guard := time.Duration(keepNum("RecorderPushGuardSec", 5)) * time.Second
	var in []liveSaveMark
	for _, s := range live.saves[k] {
		switch {
		case s.at.After(prev.at.Add(-guard)) && !s.at.After(prev.at.Add(guard)):
			return // a save read near the last check: it may be before or after it
		case s.at.After(prev.at) && !s.at.After(now):
			in = append(in, s)
		}
	}
	if len(in) != 1 || in[0].c == nil {
		return
	}
	c := in[0].c
	if !live.queued[c.lineId] || live.sent[c.lineId] || c.alterId != "" {
		return
	}
	c.alterId = fmt.Sprint(cur)
	c.xml = pushSetAlter(c.xml, cur)
	writeLog(fmt.Sprintf("Recorder: %s %s of %s: Tally's AlterID %d (the only save between two light checks, the counter moved by 1)", c.vchType, c.vchNo, company, cur))
}

// next-push: the held lines (sent without their entry, sync\recorder-held.json) of entries whose full entry has gone since:
// never asked of Tally again (FinCom has the entry now, under its GUID)
func liveHeldDropPushed(keys []string) {
	if len(keys) == 0 {
		return
	}
	want := map[string]bool{}
	for _, k := range keys {
		want[k] = true
	}
	heldMu.Lock()
	defer heldMu.Unlock()
	all, items := liveHeldLoad()
	n := 0
	for id, h := range items {
		if h.MID != "" && (h.Ev == "created" || h.Ev == "altered" || h.Ev == "") && want[h.CGUID+"|"+h.MID] {
			delete(items, id)
			n++
		}
	}
	if n > 0 {
		liveHeldSave(all, items)
		writeLog(fmt.Sprintf("Recorder: %d held line(s) left the held list: their entry went in full from the add-on", n))
	}
}

// under live.mu: the end of a read of a file: the saves it held go by the 2.3.2 route at once unless the file is the new
// add-on's (it has given a full entry: they wait RecorderFullWaitMs for theirs)
func livePushReadEnd(name string) int {
	livePushFresh()
	if live.pushFiles[name] {
		return 0
	}
	n := 0
	for k, a := range live.await {
		if a.file == name {
			n += liveAwaitFlush(k)
		}
	}
	return n
}
