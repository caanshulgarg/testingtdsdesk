// FinCom Bridge 2.1.4 (the owner's decision of 02-Oct-2026): the plain ledger and group lists, read from Tally by
// Update now (and the nightly run), after a posting that carries a ledger master, and when FinCom's bill screen opens
// its ledger chooser with a list older than the last posting (POST /ledgers/refresh here, or the cloud's wake-up
// "ledgers"). Only stored master fields are asked for: name, group, the master's stored opening (OPENINGBALANCE, the
// field as kept, never a balance worked out for a date), GSTIN and PAN, and GUID / MasterID / AlterID to see what
// changed. Nothing Tally computes (no closing balance, no on-account value, no period).
//
// The ledger list goes in chunks of MasterIDs (2,000 a request, LedgerChunk), so no request holds Tally for long on a
// company with 50,000 ledgers; a chunk that does not answer is halved (down to LedgerChunkMin, 125) for the rest of
// the round (the next round starts at twice that) and the read resumes from it; each chunk is saved as it comes (ledger-read.jsonl), so a stop resumes from the last chunk saved.
//
// 2.5.5 (the owner's rule: each request to Tally 2 s at most): the full read (Update now, the nightly run, the ledger
// wake after a posting that carries a ledger) has the same 2-second hard stop as the light check: every request of the
// round (the groups, the natures of payment, each ledger chunk) is stopped 2 s after the send (TC.limitMs,
// RecorderLimitMs), where it waited up to 20 s a chunk before (LedgerChunkSec). No request changed. A chunk stopped at
// 2 s is halved as a chunk that did not answer (2,000, 1,000, 500, 250, 125), and the next one waits only for the stop's
// own cool-down (RecorderStopCoolSec, 30 s), not a back-off. The smallest chunk (125) stopped at 2 s ends the turn
// with plain words (the company's trouble, in the beat; the round's end line): Tally is left alone for the back-off
// (1 minute, doubling to 30 minutes) and the round goes on from that chunk at the next try. Stopped the third time in a
// row (ledMinStops), it is halved on, down to one MasterID (each request still stopped at 2 s); each chunk in time
// doubles the size back, up to the full 2,000, until the first stop: then the size that last answered in time is kept
// for the rest of the round, with the three-stop rule at it (reviews M2, N1); a chunk in time resets the back-off. A
// single ledger stopped at 2 s is judged once Tally has finished it (review H1, ledJudge), by how long Tally kept it;
// it is skipped only when its own request is stopped 3 times in a row (reviews M1, N2): as hanging Tally when Tally
// kept one of them over LedgerHangSec (30 s) or did not finish it at the bridge's longest wait, else as "takes Tally
// longer than 2 s". A skipped ledger is asked once more, alone, under the same stop and giving way to a posting, at a
// nightly run (never Update now or the ledger wake): a slow one each later day, one that hangs Tally a week on. In
// time, it is read and no longer skipped; stopped again, judged again. Tally closing the connection marks nothing
// (review L2); a try that never reached Tally does not use the day's (review L1). The group list stopped at 2 s never
// holds the ledgers: it is said, the round reads the ledgers with the groups FinCom already has, and the next full read
// asks for the groups again. The natures of payment stopped at 2 s are said (review L3) and asked again at the next
// nightly run, never turned off for it (second review N5). Nothing is read while a posting
// goes, and a stopped request keeps Tally's one lock until Tally has finished it, so a posting still goes first and
// never meets two requests at once.
// Every request goes through the one gate to Tally (postings first, the check after a timeout, the company's GUID, the
// lease). Groups are few: one request.
//
// A full list read is compared with the list held here (ledger-list.json) by GUID: a new ledger, one changed, one
// renamed (the same GUID, another name: the copy's entries carry the new name, and FinCom's cloud renames its row,
// keeping the old name). What is to go to the cloud waits in ledger-out.json until FinCom's cloud has taken it
// (tally-ingest "ledger_list").
//
// Round 3 (02-Oct-2026, the contract with the cloud): each round has a round id (random hex, kept in the run state);
// every ledger_list call carries that round, complete (true: the round read the whole list; a ledger that hangs Tally,
// isolated and skipped, counts as read), rowsRead (the distinct GUIDs read in that round, the skipped ledgers' GUIDs
// from the list held among them: the whole list, not the rows changed) and seen (those GUIDs themselves, split across
// the batches with none twice, at most LedgerSendBatch (2,000) a batch; a batch may carry seen and no rows, so a round
// in which nothing changed still sends ceil(rowsRead/2000) batches). The bridge names no deletion: FinCom's cloud works
// out from seen which of its ledgers Tally no longer lists, holds many gone at once until the next round misses them
// too, and never marks one with entries or an opening (migration-34). Nothing of a round goes until it is complete.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// a round's id: 16 random bytes as hex
func newLedRound() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

const (
	ledListID = "FinComLedgers"
	grpListID = "FinComGroups"
	// stored fields only: nothing here is worked out by Tally. 2.3.1: TDSDEDUCTEETYPE, the party's deductee type (a ledger
	// master field; the owner asked for it with the TDS details, which Tally keeps on the entry without it)
	// 2.4.3 (the owner's approval of 11-Oct-2026, (b)): a TDS duty ledger's nature of payment (TDSRATENAME); a party's
	// special rate (TDSDEDUCTEEISSPECIALRATE, TDSDEDUCTEESPECIALRATE) and its lower-deduction certificates (LOWERDEDUCTION.LIST:
	// the nature, and per certificate LOWERDEDUCTIONDETAILS.LIST: from, to, section, certificate number, rate, limit). Stored
	// master fields only, named one by one (ledFetch242 is 2.4.2's list, byte for byte)
	ledFetch242 = "GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST, LEDSTATENAME, TDSDEDUCTEETYPE"
	ledFetch243 = ledFetch242 + ", TDSRATENAME, TDSDEDUCTEEISSPECIALRATE, TDSDEDUCTEESPECIALRATE, LOWERDEDUCTION.NATUREOFPAYMENT, " +
		"LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.FROMDATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TODATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.SECTIONNO, " +
		"LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.CERTIFICATENO, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TDSITRATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.LOWERDEDUCTIONLIMIT"
	// 2.4.4 (the owner's decision of 12-Oct-2026, item 2): a pay head's type (earning, deduction, employer's contribution),
	// its statutory type (PF, ESI, professional tax, income tax), its income-tax component (Basic, HRA, ...) and whether
	// the ledger is a pay head. Stored master fields, named one by one (ledFetch243 is 2.4.3's list, byte for byte)
	ledFetch = ledFetch243 + ", PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL"
	grpFetch = "GUID, MASTERID, ALTERID, NAME, PARENT"
)

func ledChunkDefault() int { return keepNum("LedgerChunk", 2000) }
func ledChunkMin() int     { return minI(ledChunkDefault(), keepNum("LedgerChunkMin", 125)) }

// 2.5.5: the wait for one request of the ledger round: one second past its 2-second hard stop (ledgerTC), so the stop
// ends it first (as the company list's cap, tally.go tallyRaw); LedgerChunkSec no longer lengthens it
func ledChunkSec() int { return (recorderLimitMs()+999)/1000 + 1 }

// 2.5.5: the ledger round's requests under the 2-second hard stop (the light check's rule), on a copy of the run's TC
func ledgerTC(tc *TC) *TC {
	if tc == nil {
		tc = &TC{copier: true}
	}
	c := *tc
	c.slotOut, c.sentOut = nil, nil
	c.limitMs = recorderLimitMs()
	return &c
}

// the requests
// 2.5.0 (the owner's decision of 30-Oct-2026; booksfrom.go): with the books' first year as the period, so Tally gives
// OPENINGBALANCE as at the books' beginning; "" when the company's books-from is not known (never sent undated)
func ledgerChunkRequest(company string, after, upto int64) string {
	return ledgerChunkRequestAt(company, booksFromOf(company), after, upto)
}
func ledgerChunkRequestAt(company, booksFrom string, after, upto int64) string {
	sv := ledgerPeriodVars(booksFrom)
	if sv == "" {
		return ""
	}
	return fcCollection(ledListID, company, sv, "Ledger", ledFetch, masterRange(after, upto))
}
func groupListRequest(company string) string {
	return fcCollection(grpListID, company, "", "Group", grpFetch, "")
}

// one ledger as listed: kept as [mid, alter, name, parent, open, gstin, pan] by its GUID
type ledRow struct {
	guid                           string
	mid, alter                     int64
	name, parent, open, gstin, pan string
	state                          string // LEDSTATENAME (round 11): index 7 in the list held and the read file, 8 in the outbox (7 is the opening-changed mark)
	dtype                          string // TDSDEDUCTEETYPE (2.3.1): after the state in each (absent in a 2.3.0 file: "")
	// 2.4.3, after the deductee type in each (absent in a 2.4.2 file: ""): the nature of payment (TDSRATENAME), the special
	// rate ("" when the party has none) and the lower-deduction certificates as JSON text ([[nature, from, to, section,
	// certificate, rate, limit]], "" when none), so a row compares whole
	nature, special, ldc string
	// 2.4.4, after the certificates in each (absent in a 2.4.3 file: ""): PAYTYPE, PAYSTATTYPE ("Not Applicable" as ""),
	// ITCOMPONENT and FORPAYROLL ("Yes" or ""), so a ledger that is not a pay head compares as before
	payType, payStat, itComp, forPay string
}

func (r ledRow) arr() []any {
	return []any{r.mid, r.alter, r.name, r.parent, r.open, r.gstin, r.pan}
}
func ledFromArr(g string, a []any) ledRow {
	return ledRow{g, toI64(at(a, 0)), toI64(at(a, 1)), str(at(a, 2)), str(at(a, 3)), str(at(a, 4)), str(at(a, 5)), str(at(a, 6)), str(at(a, 7)), str(at(a, 8)),
		str(at(a, 9)), str(at(a, 10)), str(at(a, 11)), str(at(a, 12)), str(at(a, 13)), str(at(a, 14)), str(at(a, 15))}
}

// the pay-head fields after the certificates (the held list, the read file, the outbox)
func (r ledRow) payArr() []any { return []any{r.payType, r.payStat, r.itComp, r.forPay} }
func digits(s string) int64    { return toI64(re(`\D`).ReplaceAllString(s, "")) }

// one chunk of the ledger list: the ledgers whose MasterID is in (after, upto] (upto 0: no upper end), and the
// highest MasterID among them
func readLedgerChunk(tc *TC, company string, port int, after, upto int64) ([]ledRow, int64, error) {
	bf, err := booksFromForRead(tc, company)
	if err != nil {
		return nil, 0, err
	}
	return readLedgerChunkAt(tc, company, bf, port, after, upto)
}

// 2.5.0: one chunk with the books-from the caller fixed (a round reads every chunk with the same period)
func readLedgerChunkAt(tc *TC, company, bf string, port int, after, upto int64) ([]ledRow, int64, error) {
	return readLedgerChunkSlot(tc, company, bf, port, after, upto, nil)
}

// 2.5.5 (review H1): the same, keeping the request the bridge stopped waiting for while Tally is still on it (slot), so
// the round learns how long Tally kept it
func readLedgerChunkSlot(tc *TC, company, bf string, port int, after, upto int64, slot **abandonSlot) ([]ledRow, int64, error) {
	x := ledgerChunkRequestAt(company, bf, after, upto)
	if x == "" {
		return nil, 0, errBooksFromUnknown
	}
	t := ledgerTC(tc)
	t.slotOut = slot
	raw, err := invokeTally(t, port, x, ledChunkSec())
	if err != nil {
		return nil, 0, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, 0, errors.New("Tally's answer to the ledger list could not be read: " + cut(flat(raw), 120))
	}
	out, top := ledRowsOf(raw)
	return out, top, nil
}

// the ledgers of an answer to a ledger request (the list, 2.3.1's changes or one by name: the same fields), and the
// highest MasterID among them
func ledRowsOf(raw string) ([]ledRow, int64) {
	var out []ledRow
	var top int64
	for _, l := range xmlDoc(raw).All("LEDGER") {
		n, g := strings.TrimSpace(nameOf(l)), cleanGUID(nt(l, "GUID"))
		if n == "" || g == "" {
			continue
		}
		gstin := strings.ToUpper(strings.TrimSpace(nt(l, "PARTYGSTIN")))
		if gstin == "" {
			gstin = strings.ToUpper(strings.TrimSpace(nt(l, "LEDGSTREGDETAILS.LIST/GSTIN")))
		}
		open := "0.00"
		if o := nt(l, "OPENINGBALANCE"); o != "" {
			open = amtText(o)
			if open == "0" {
				open = "0.00"
			}
		}
		r := ledRow{g, digits(nt(l, "MASTERID")), digits(nt(l, "ALTERID")), n, re(`^\W*Primary$`).ReplaceAllString(nt(l, "PARENT"), ""), open, gstin,
			strings.ToUpper(strings.TrimSpace(nt(l, "INCOMETAXNUMBER"))), strings.TrimSpace(nt(l, "LEDSTATENAME")), strings.TrimSpace(nt(l, "TDSDEDUCTEETYPE")),
			strings.TrimSpace(nt(l, "TDSRATENAME")), ledSpecial(l), ledLDC(l),
			payField(nt(l, "PAYTYPE")), payField(nt(l, "PAYSTATTYPE")), payField(nt(l, "ITCOMPONENT")), payYes(nt(l, "FORPAYROLL"))}
		if r.mid > top {
			top = r.mid
		}
		out = append(out, r)
	}
	return out, top
}

// Tally's groups, name and parent (a primary group's parent is empty): one request
func readGroupList(tc *TC, company string, port int) ([][2]string, error) {
	raw, err := invokeTally(ledgerTC(tc), port, groupListRequest(company), ledChunkSec())
	if err != nil {
		return nil, err
	}
	var out [][2]string
	for _, g := range xmlDoc(raw).All("GROUP") {
		if n := strings.TrimSpace(nameOf(g)); n != "" {
			out = append(out, [2]string{n, re(`^\W*Primary$`).ReplaceAllString(nt(g, "PARENT"), "")})
		}
	}
	return out, nil
}

// --- the list held here (the last full read)
func ledListFile(dir string) string { return filepath.Join(dir, "ledger-list.json") }
func ledReadFile(dir string) string { return filepath.Join(dir, "ledger-read.jsonl") }
func ledOutFile(dir string) string  { return filepath.Join(dir, "ledger-out.json") }

func loadLedList(dir string) map[string]ledRow {
	o := map[string]ledRow{}
	for g, v := range readObjFile(ledListFile(dir)) {
		o[g] = ledFromArr(g, arr(v))
	}
	return o
}
func saveLedList(dir string, m map[string]ledRow) {
	o := M{}
	for g, r := range m {
		o[g] = append(append(r.arr(), r.state, r.dtype, r.nature, r.special, r.ldc), r.payArr()...) // the state too (round 11 review: without it every ledger with a state read as changed); 2.3.1: the deductee type; 2.4.3: the TDS master fields; 2.4.4: the pay-head fields
	}
	_ = saveFile(ledListFile(dir), jsonText(o))
}

// the chunks of the round read so far (a line a ledger; the last one of a GUID counts)
func loadLedRead(dir string) map[string]ledRow {
	o := map[string]ledRow{}
	for _, ln := range strings.Split(readText(ledReadFile(dir)), "\n") {
		a := arr(parseJSONLoose(ln))
		if len(a) >= 2 && str(a[0]) != "" {
			o[str(a[0])] = ledFromArr(str(a[0]), a[1:])
		}
	}
	return o
}
func parseJSONLoose(s string) any {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	v, err := parseJSON(s)
	if err != nil {
		return nil
	}
	return v
}
func appendLedRead(dir string, rows []ledRow) {
	if len(rows) == 0 {
		return
	}
	var b strings.Builder
	for _, r := range rows {
		b.WriteString(jsonText(append(append(append([]any{r.guid}, r.arr()...), r.state, r.dtype, r.nature, r.special, r.ldc), r.payArr()...)) + "\n")
	}
	_ = appendText(ledReadFile(dir), b.String())
}

// --- what changed between the list held and a full read, by GUID
type ledRen struct{ guid, from, to string }
type ledDiff struct {
	rows    []ledRow        // new or changed (a rename included)
	added   int             // of them, new
	openChg map[string]bool // the stored opening changed in Tally since the last read
	renamed []ledRen
	gone    []ledRow // held, no longer listed: for the log alone (the cloud works deletions out from seen)
}

func diffLedgers(held, read map[string]ledRow) ledDiff {
	d := ledDiff{openChg: map[string]bool{}}
	var gs []string
	for g := range read {
		gs = append(gs, g)
	}
	sort.Strings(gs)
	for _, g := range gs {
		r := read[g]
		h, had := held[g]
		switch {
		case !had:
			d.rows = append(d.rows, r)
			d.added++
		case h != r:
			d.rows = append(d.rows, r)
			if h.name != r.name {
				d.renamed = append(d.renamed, ledRen{g, h.name, r.name})
			}
			if h.open != r.open {
				d.openChg[g] = true
			}
		}
	}
	for g, h := range held {
		if _, ok := read[g]; !ok {
			d.gone = append(d.gone, h)
		}
	}
	sort.Slice(d.gone, func(i, j int) bool { return d.gone[i].guid < d.gone[j].guid })
	return d
}

// 2.5.0: every ledger read, as changed (an opening that differs from the one held marked so); new, renamed and gone as
// diffLedgers found them
func diffAll(held, read map[string]ledRow, d ledDiff) ledDiff {
	in := map[string]bool{}
	for _, r := range d.rows {
		in[r.guid] = true
	}
	var gs []string
	for g := range read {
		if !in[g] {
			gs = append(gs, g)
		}
	}
	sort.Strings(gs)
	for _, g := range gs {
		d.rows = append(d.rows, read[g])
		if h, ok := held[g]; ok && h.open != read[g].open {
			d.openChg[g] = true
		}
	}
	return d
}

// 2.5.0 (review): FinCom's cloud held a round's openings (they did not add up to nil): the next round sends every ledger
func ledResendFile(dir string) string { return filepath.Join(dir, "ledger-resend.json") }

// 2.5.0: the date the outbox's openings are as at (the books' beginning, yyyymmdd), sent with every batch as openingsAt
func setLedOutOpeningsAt(dir, bf string, whole bool) {
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	setLedOutOpeningsAtLocked(dir, bf, whole, false)
}

// setLedOutOpeningsAt with ledOutMu held
func setLedOutOpeningsAtLocked(dir, bf string, whole, unknown bool) {
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		return
	}
	o["openingsAt"] = bf
	if unknown {
		o["openingsUnknown"] = true // 2.5.13: a stand-in round (booksfrom.go): no opening goes
	} else {
		delete(o, "openingsUnknown")
	}
	if whole {
		// review of 2.5.0: the outbox holds a whole list (every ledger); held, it is not sent whole again. Kept until the
		// outbox goes, whatever plain rounds merge into it meanwhile
		o["whole"] = true
	}
	_ = saveFile(ledOutFile(dir), jsonText(o))
}

// --- the outbox: {rows: {guid: [mid, alter, name, parent, open, gstin, pan, openChanged]}, renamed: {guid: [from, to]},
// groups: [[name, parent]], round, rowsRead, seen: [guid, ...], complete: true}. Only a complete round merges here (a
// ledger that hangs Tally is named in it mid-round by addPoison, with complete unset: sent once the round completes).
// A round that completes while an earlier one waits replaces its round, seen and count; the rows add up, less any of
// a ledger the new round no longer lists (nothing to tell the cloud of it). Every complete round is saved, changed
// rows or not: the cloud works deletions out from seen
func mergeLedOut(dir string, d ledDiff, groups [][2]string, round string, seen []string, natures []any) {
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	mergeLedOutLocked(dir, d, groups, round, seen, natures)
}

// mergeLedOut with ledOutMu held
func mergeLedOutLocked(dir string, d ledDiff, groups [][2]string, round string, seen []string, natures []any) {
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		o = M{}
	}
	rows, ren := obj(o["rows"]), obj(o["renamed"])
	if rows == nil {
		rows = M{}
	}
	if ren == nil {
		ren = M{}
	}
	listed := map[string]bool{}
	for _, g := range seen {
		listed[g] = true
	}
	for g := range rows {
		if !listed[g] {
			delete(rows, g)
		}
	}
	for _, r := range d.rows {
		oc := d.openChg[r.guid] || truthy(at(arr(rows[r.guid]), 7))
		rows[r.guid] = append(append(r.arr(), oc, r.state, r.dtype, r.nature, r.special, r.ldc), r.payArr()...) // 2.4.4: the pay-head fields at 13-16
	}
	for _, x := range d.renamed {
		from := x.from
		if was := arr(ren[x.guid]); len(was) > 0 {
			from = str(was[0]) // renamed twice before it went: from the name the cloud has
		}
		if from == x.to {
			delete(ren, x.guid)
		} else {
			ren[x.guid] = []any{from, x.to}
		}
	}
	for g := range ren {
		if !listed[g] {
			delete(ren, g)
		}
	}
	o["rows"], o["renamed"] = rows, ren
	o["round"], o["rowsRead"], o["seen"], o["complete"] = round, len(seen), toAny(seen), true
	if groups != nil {
		gl := []any{}
		for _, g := range groups {
			gl = append(gl, []any{g[0], g[1]})
		}
		o["groups"] = gl
	}
	if natures != nil {
		o["natures"] = natures // 2.4.3: the round's natures of payment (none when the round gave them up: the last sent stay)
	}
	_ = saveFile(ledOutFile(dir), jsonText(o))
}

// --- the round itself, inside a run's step (keep.go): true when the full list is read and compared
func (k *keepRun) ledgerList(company string, port int, dir string, st M, inBudget func() bool, save func()) (bool, error) {
	if str(st["ledRun"]) == k.id {
		return true, nil // read in this run already
	}
	// 2.5.0 (the owner's decision of 30-Oct-2026; booksfrom.go): the ledgers are read with the books' first year as the
	// period. Books-from not known: the read is held (one log line, the company list read again), never sent undated
	// 2.5.13: no first day known at all (FinCom's nor Tally's): the masters are read all the same, dated with the stand-in
	// day, their openings not known (booksfrom.go), said once
	bf, herr := booksFromForRead(k.tc, company)
	standIn := herr != nil
	if standIn {
		if k.openUnknown == nil {
			k.openUnknown = map[string]bool{}
		}
		k.openUnknown[company] = true
		bf = ledgerStandInDay()
		if !k.told["standin:"+company] {
			k.told["standin:"+company] = true
			writeLog("Keeping " + company + ": " + booksFromUnknownWords + "; the ledger and group lists are read all the same")
		}
	}
	ls := obj(st["led"])
	// a round begun on another basis (by a bridge before 2.5.0, undated, or with another books-from; 2.5.13: or with the
	// stand-in day while a first day is now known, or the other way) starts again: one round's openings are all as at the
	// same date
	if ls != nil && (str(ls["openingsAt"]) != bf || truthy(ls["standIn"]) != standIn) {
		ls = nil
	}
	if t, ok := parseTime(str(ls["started"])); ls == nil || !ok || time.Since(t) > time.Duration(keepNum("LedgerResumeHours", 6))*time.Hour {
		// a chunk halved after a timeout stays so for the rest of its round; the next round starts at twice that, back
		// towards the full chunk
		size := toInt(st["ledSize"]) * 2
		if size < ledChunkMin() || size > ledChunkDefault() {
			size = ledChunkDefault()
		}
		ls = M{"started": nowS(), "after": 0, "size": size, "empty": 0, "groups": false, "n": 0, "reqs": 0, "round": newLedRound(), "openingsAt": bf}
		if standIn {
			ls["standIn"] = true
		}
		_ = os.Remove(ledReadFile(dir))
		st["led"] = ls
		save()
	}
	// the highest master AlterID (the company check's ALTMSTID) bounds the MasterIDs; past it one last request with no
	// upper end takes whatever is left, so nothing is missed
	if b := companyAlterM(company); b > toI64(ls["bound"]) {
		ls["bound"] = b
	}
	if !truthy(ls["groups"]) {
		k.holdNow() // third review T5: reading on, the group list too waits while the person types
		g, err := readGroupList(k.tc, company, port)
		if errors.Is(err, errRecorderStop) {
			// 2.5.5: the groups (one request) stopped at 2 s: said, and the ledgers are read anyway; this round keeps the
			// groups FinCom already has (group-list.json as last read, unchanged), and the next full read asks again
			writeLog("Keeping " + company + ": Tally took longer than 2 s for the group list; the bridge stopped waiting and reads the ledgers anyway (FinCom keeps the groups it has; they are asked again at the next full read)")
			ls["groups"], ls["groupsStopped"], ls["reqs"] = true, true, toInt(ls["reqs"])+1
			save()
		} else if err != nil {
			return false, err
		} else {
			gl := []any{}
			for _, x := range g {
				gl = append(gl, []any{x[0], x[1]})
			}
			_ = saveFile(filepath.Join(dir, "group-list.json"), jsonText(gl))
			ls["groups"], ls["reqs"] = true, toInt(ls["reqs"])+1
			save()
		}
	}
	// 2.4.3: the natures of payment (few; never holding the ledger list: tdsnatures.go)
	if ok, err := k.natureList(company, port, st, ls, inBudget, save); !ok {
		return false, err
	}
	// 2.4.5: the exact count first (FinComLedgerIds, rows counted, under the 2 s stop; ledcount.go): the step-5 bar's "of N".
	// Only for the ledgers-only read Connect Tally's step 5 asks (Import ledgers, the cloud's "ledgers" wake); Update now and
	// the nightly run read the list as before
	bar := k.kind == "ledgers"
	if bar {
		ledCountFor(company, port, ls, save, func() bool { return inBudget() && k.holdNow() == "" }, nextPoison(st, 0) > 0)
	}
	for !truthy(ls["done"]) {
		if !inBudget() || k.holdNow() != "" {
			return false, nil
		}
		// 2.5.5 (review H1): a single ledger stopped at 2 s is judged by how long Tally then kept it, once Tally has
		// finished it (nothing else is sent meanwhile: the one lock is held until then)
		if again, err := k.ledJudge(company, dir, st, ls, save); err != nil || again {
			if err != nil {
				return false, err
			}
			continue
		}
		after, size, bound := toI64(ls["after"]), toInt(ls["size"]), toI64(ls["bound"])
		tail := (bound > 0 && after >= bound) || (bound <= 0 && toInt(ls["empty"]) >= 3)
		upto := after + int64(size)
		if tail {
			upto = 0
		}
		// a ledger that hangs Tally (found before, by halving): not asked in the round (only its own retry, a night's run
		// a week on); the chunks stop short of it
		if p := nextPoison(st, after); p > 0 && (tail || p <= upto) {
			if p == after+1 {
				// 2.5.5: a ledger skipped as taking Tally longer than 2 s is asked once more, alone and under the same
				// stop, at the first full read of a day (Update now, the nightly run): in time, it is read and no longer
				// skipped; else it stays skipped and is named to FinCom again
				if k.slowRetryDue(st, p) {
					done, err := k.slowRetry(company, bf, port, dir, st, ls, p, save)
					if err != nil {
						return false, err
					}
					if done {
						continue
					}
				}
				ls["after"] = p
				save()
				continue
			}
			upto, tail = p-1, false
		}
		// review of 2.5.0: the company's books-from changed since the round began (Tally's Books beginning from corrected):
		// the round starts again at the next turn, every chunk with the new one
		if now := booksFromOf(company); now == "" && truthy(ls["standIn"]) {
			// 2.5.13: a stand-in round goes on while no first day is known
		} else if now != "" && truthy(ls["standIn"]) {
			delete(st, "led")
			save()
			writeLog("Keeping " + company + ": its books' first day is now known (" + now + "); the ledger list is read again from the first ledger, with the openings")
			return false, nil
		} else if now == "" {
			// the company list answered without BOOKSFROM for a while: this turn stops (said once, the list read again);
			// the round goes on from its last chunk once Tally says it again (review of 2.5.0, rounds 3 and 4)
			_ = holdLedgerRead(k.tc, company)
			if k.booksHeld == nil {
				k.booksHeld = map[string]bool{}
			}
			k.booksHeld[company] = true
			k.caughtUp = true
			return false, nil
		} else if now != bf {
			delete(st, "led")
			save()
			writeLog("Keeping " + company + ": the ledgers are now read as at " + now + " (FinCom's first day of the book, else Tally's books-from), not " + bf + "; the ledger list is read again from the first ledger")
			return false, nil
		}
		t1 := time.Now()
		var slot *abandonSlot
		rows, top, err := readLedgerChunkSlot(k.tc, company, bf, port, after, upto, &slot) // the round's own books-from (review)
		if err != nil {
			// 2.5.5: stopped at 2 s (the hard stop): halved as a chunk that did not answer, down to the smallest chunk
			stopped := errors.Is(err, errRecorderStop)
			if gaveWay(err) || (!tallyNoAnswer(err) && !stopped) {
				// not sent (refused, held, reading stopped), stopped for FinCom, or an answer that could not be read:
				// not Tally hanging on this chunk. The same chunk again later, nothing halved or marked
				return false, err
			}
			span := fmt.Sprintf("%d-%d", after+1, upto)
			if one := !tail && upto-after == 1; one && errors.Is(err, errClosed) {
				// 2.5.5 (review L2): Tally closed the connection (closing, a message box): not the ledger's doing. Nothing
				// is marked; the same ledger is asked again at the next try
				save()
				return false, fmt.Errorf("Tally closed the connection while giving the ledger with MasterID %d; nothing is marked, and it is asked again at the next try", upto)
			} else if one && stopped {
				// 2.5.5 (review H1, M1): judged at the next turn, once Tally has finished it (ledJudge)
				ledPendSet(company, ledPending{mid: upto, kind: "find", slot: slot, limit: time.Duration(recorderLimitMs()) * time.Millisecond})
				save()
				writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d took Tally longer than 2 s (stopped); how long Tally keeps it decides what follows", company, upto))
				return false, fmt.Errorf("%w (the ledger with MasterID %d was stopped at 2 s)", errBackoff, upto)
			}
			// 2.5.5 (second review N1): growing back after the halving, the first stop ends the growth: the size that last
			// answered in time is kept for the rest of the round (ls.keep), with the three-stop rule at it
			if stopped && !tail && truthy(ls["grow"]) {
				keep := maxI(1, size/2)
				delete(ls, "grow")
				ls["size"], ls["keep"] = keep, keep
				st["ledSize"] = keep
				save()
				writeLog(fmt.Sprintf("Keeping %s: the ledger list MasterID %s took Tally longer than 2 s (stopped) as the chunks grew back; %d at a time from now on in this round", company, span, keep))
				return false, fmt.Errorf("%w (the ledger list MasterID %s was stopped at 2 s; %d at a time from now on)", errBackoff, span, keep)
			}
			// 2.5.5: the smallest chunk (or the size kept after the growth) stopped at 2 s: the turn ends (back-off) twice;
			// the third time in a row it is halved on, down to one MasterID, to find the slow ledger(s), each stop at 2 s
			minStop := false
			if stopped && !tail && size <= maxI(ledChunkMin(), toInt(ls["keep"])) && !truthy(ls["iso"]) {
				if n := toInt(ls["minStops"]) + 1; n < ledMinStops {
					ls["minStops"], minStop = n, true
				} else {
					delete(ls, "minStops")
					delete(ls, "keep")
					writeLog(fmt.Sprintf("Keeping %s: the ledger list MasterID %s took Tally longer than 2 s %d times in a row; it is read in smaller parts to find the slow ledger(s)", company, span, n))
				}
			}
			switch {
			case tail:
				// the last request (no upper end) did not answer: the rest is read in chunks again
				ls["bound"] = after + int64(4*size)
				span = fmt.Sprintf("from %d", after+1)
			case minStop:
				// 2.5.5: the smallest chunk stopped at 2 s (the first or second time in a row): Tally may only be busy. Not
				// halved yet and nothing marked: the turn ends with plain words, Tally is left alone for the back-off, and
				// the round goes on from this chunk at the next try
				st["ledSize"] = ls["size"]
				save()
				return false, fmt.Errorf("Tally took longer than 2 s for %d ledgers (MasterID %s), the smallest part the ledger list is read in; the bridge stopped waiting, and the ledger list goes on from MasterID %d at the next try",
					upto-after, span, after+1)
			case size > ledChunkMin():
				ls["size"] = maxI(ledChunkMin(), size/2)
			case upto-after > 1:
				// still not answering at the smallest chunk: halved on, down to one MasterID, to find the ledger that hangs
				ls["size"] = maxI(1, int(upto-after)/2)
				ls["iso"] = true
				delete(ls, "isoOK")
			default:
				// one MasterID that does not answer (no answer in its wait, never only stopped: ledJudge): that ledger
				// hangs Tally. It is skipped from now on and named to FinCom (as in 2.5.4)
				name := ledNameOf(dir, upto)
				addPoison(dir, st, upto, name)
				tries := obj(st["ledSlowTry"]) // asked again at a night's run a week on (second review N2)
				if tries == nil {
					tries = M{}
				}
				tries[fmt.Sprint(upto)] = today()
				st["ledSlowTry"] = tries
				writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d (%s) does not answer and holds Tally; it is skipped and named to FinCom, and asked again at a night's run a week on", company, upto, or(name, "name not known")))
				ls["after"] = upto
			}
			st["ledSize"] = ls["size"]
			save()
			if stopped {
				// 2.5.5: halved after a 2-second stop: the next chunk waits only for the stop's own cool-down (nothing is
				// sent into the Tally still on the request stopped; RecorderStopCoolSec), not a back-off
				writeLog(fmt.Sprintf("Keeping %s: the ledger list MasterID %s took Tally longer than 2 s (stopped); the next try reads %d from MasterID %d", company, span, toInt(ls["size"]), after+1))
				return false, fmt.Errorf("%w (the ledger list MasterID %s was stopped at 2 s; the next try reads %d from MasterID %d)", errBackoff, span, toInt(ls["size"]), after+1)
			}
			return false, fmt.Errorf("Tally did not give the ledger list (MasterID %s: %s); the next try reads %d from MasterID %d", span, err.Error(), toInt(ls["size"]), after+1)
		}
		sec := time.Since(t1).Seconds()
		delete(ls, "minStops") // 2.5.5: a chunk in time ends a run of stops (the 125 chunk's and a single ledger's)
		delete(ls, "oneStops")
		delete(ls, "oneHung") // third review T4: a run of stops ended, so did its "kept over 30 s"
		clearBgBackoff(port)  // 2.5.5 (review M2): Tally answered in time: the next back-off starts small again
		if truthy(ls["iso"]) {
			// third review T3: the search goes on at this size (the next chunk, the stopped one's other half, is halved
			// at once if stopped); it ends, and the growth starts, when a single ledger is read in time or two chunks in a
			// row are (the slow patch passed), or when the single ledger is judged (ledJudge)
			if n := toInt(ls["isoOK"]) + 1; upto-after == 1 || n >= 2 {
				ledGrowFrom(ls, size)
			} else {
				ls["isoOK"] = n
			}
		} else if truthy(ls["grow"]) {
			// back up, doubling each chunk in time (reviews M2, N1: up to the full chunk, until the first stop: then the
			// size that last answered in time is kept for the round)
			ledGrowFrom(ls, size)
		}
		appendLedRead(dir, rows)
		ls["n"], ls["reqs"] = toInt(ls["n"])+len(rows), toInt(ls["reqs"])+1
		if tail {
			ls["done"] = true
		} else {
			ls["after"] = upto
			if len(rows) == 0 {
				ls["empty"] = toInt(ls["empty"]) + 1
			} else {
				ls["empty"] = 0
			}
			if top > bound && bound > 0 {
				ls["bound"] = top
			}
		}
		st["ledSize"] = ls["size"]
		save()
		if bar {
			ledProgressNote(company, str(ls["round"]), toInt(ls["n"]), toInt(ls["of"]), false) // 2.4.5: "312 of 1,240 ledgers"
		}
		writeLog(fmt.Sprintf("Keeping %s: ledger list MasterID %d-%s, %d ledger(s) (%.1fs); saved", company, after+1, map[bool]string{true: "end", false: fmt.Sprint(upto)}[tail], len(rows), sec))
		keepRest(time.Duration(maxI(200, int(sec*500))) * time.Millisecond)
	}
	// the full list: compared with the one held, by GUID
	read := loadLedRead(dir)
	if str(ls["round"]) == "" {
		ls["round"] = newLedRound() // a round begun by 2.1.4
	}
	round := str(ls["round"])
	held := loadLedList(dir)
	// a ledger skipped because it hangs Tally is not gone: it stays as held, and its GUID counts as seen
	for _, p := range poisonMids(st) {
		for g, h := range held {
			if h.mid == p {
				if _, ok := read[g]; !ok {
					read[g] = h
				}
			}
		}
	}
	// seen: every distinct GUID of the round (the skipped ledgers' among them); rowsRead is their count
	seen := make([]string, 0, len(read))
	for g := range read {
		seen = append(seen, g)
	}
	sort.Strings(seen)
	d := diffLedgers(held, read)
	// 2.5.0: the held list read on another basis (undated, by a bridge before 2.5.0, or another books-from): every ledger
	// goes to FinCom's cloud with this round's openings, as at the books' beginning (the cloud prefers a dated round's)
	// (review: a round whose openings FinCom's cloud held, as not adding up to nil, is sent whole again next time)
	resend := exists(ledResendFile(dir))
	// 2.5.13: a stand-in round's openings are not known: the outbox says so (none sent, none taken), no date named
	oa, unknown := bf, truthy(ls["standIn"])
	if unknown {
		oa = ""
	}
	whole := str(st["ledOpeningsAt"]) != oa || resend
	if whole {
		d = diffAll(held, read, d)
	}
	var groups [][2]string
	for _, x := range arr(readJSONFile(filepath.Join(dir, "group-list.json"))) {
		a := arr(x)
		groups = append(groups, [2]string{str(at(a, 0)), str(at(a, 1))})
	}
	sendGroups := groups
	if truthy(ls["groupsStopped"]) {
		sendGroups = nil // 2.5.5: the group list was not read this round: FinCom keeps the groups it has
	}
	// the copy's entries carry a renamed ledger's new name (and its opening in the balances held)
	for _, x := range d.renamed {
		renameKeepLedger(dir, st, x.from, x.to)
		renameHeldOpening(dir, x.from, x.to)
		writeLog("Keeping " + company + ": ledger " + x.from + " is now " + x.to + " in Tally")
	}
	// a ledger no longer listed: FinCom's cloud decides (from seen) whether it is marked deleted; many at once are held
	// there until the next round misses them too, and one with entries or an opening never is
	if len(d.gone) > 25 {
		writeLog(fmt.Sprintf("Keeping %s: %d ledgers are no longer in Tally's list; FinCom's cloud marks them deleted (never removed) only if the next full read misses them too, and never one with entries or an opening", company, len(d.gone)))
	} else {
		for _, h := range d.gone {
			writeLog("Keeping " + company + ": ledger " + h.name + " is no longer in Tally's list; FinCom's cloud marks it deleted (never removed) unless it has entries or an opening")
		}
	}
	// the held list: what Tally listed (and the skipped ledgers)
	saveLedList(dir, read)
	delete(st, "ledGone") // the second-look bookkeeping of 2.1.4: the cloud holds many gone at once now
	// fourth review: one ledOutMu section, so a push never reads the outbox between the merge and its openingsAt
	ledOutMu.Lock()
	mergeLedOutLocked(dir, d, sendGroups, round, seen, natOfRound(ls))
	setLedOutOpeningsAtLocked(dir, oa, whole, unknown) // a whole list held again is not sent whole again (review of 2.5.0, round 3)
	ledOutMu.Unlock()
	st["ledOpeningsAt"] = oa
	if resend {
		_ = os.Remove(ledResendFile(dir))
	}
	_ = os.Remove(ledReadFile(dir))
	notes := ""
	if truthy(ls["groupsStopped"]) {
		notes += "; the group list was stopped at 2 s (FinCom keeps the groups it has)"
	}
	if unknown {
		notes += "; without their openings: " + booksFromUnknownWords
	}
	if truthy(ls["natStopped"]) {
		notes += fmt.Sprintf("; the natures of payment were stopped at 2 s (%d time(s) so far)", toInt(st["natStops"]))
	}
	writeLog(fmt.Sprintf("Keeping %s: the ledger list read (%d ledgers, %d groups, %d request(s)): %d new, %d changed, %d renamed, %d gone%s",
		company, len(read), len(groups), toInt(ls["reqs"]), d.added, len(d.rows)-d.added, len(d.renamed), len(d.gone), notes))
	if truthy(ls["natDone"]) && !truthy(ls["natSkip"]) {
		delete(st, "natStops") // read this round: the count starts again
	}
	if bar {
		ledProgressNote(company, round, len(read), len(read), true) // 2.4.5: the round's end, the final count
	}
	delete(st, "led")
	st["ledRun"], st["ledAt"] = k.id, nowS()
	save()
	noteLedgersRead(company)
	return true, nil
}

// a renamed ledger's opening in the balances held here (balances.json) carries the new name
func renameHeldOpening(dir, old, nw string) {
	bf := filepath.Join(dir, "balances.json")
	bal := readObjFile(bf)
	if bal == nil {
		return
	}
	ch := false
	for _, x := range arr(bal["ledgers"]) {
		if l := obj(x); l != nil && str(l["name"]) == old {
			l["name"], ch = nw, true
		}
	}
	if ch {
		_ = saveFile(bf, jsonText(bal))
	}
}

// --- to FinCom's cloud (from pushCloudCompany): the rows a batch at a time (LedgerSendBatch, 2000) and the GUIDs seen
// the same way (every batch carries up to 2,000 of them, none twice: a batch may carry seen and no rows), the renames
// and the groups with the first; every batch names the round, its rowsRead and complete. A cloud that cannot take it
// now (offline, an older tally-ingest) holds back neither the days nor anything else: it is tried again later. An
// outbox of a round not complete (only a skipped ledger named so far), or one left by a bridge before 2.1.5 (no seen),
// sends nothing: the next complete round replaces it
var ledPushAfter = map[string]time.Time{} // under cloudMu

// third review T1: every read, change and write of the ledger outbox (ledger-out.json) is under this one lock: a push
// (held across its batches) and a round's merge or a skip's note never interleave, so no round's rows are lost
var ledOutMu sync.Mutex

func pushLedgerList(company, dir string) error {
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	if !exists(ledOutFile(dir)) || time.Now().Before(ledPushAfter[company]) {
		return nil
	}
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		_ = os.Remove(ledOutFile(dir))
		return nil
	}
	if !truthy(o["complete"]) || str(o["round"]) == "" || o["seen"] == nil {
		return nil // the round is not complete (or names no seen): nothing of it goes
	}
	rows, ren, seen := obj(o["rows"]), obj(o["renamed"]), strs(o["seen"])
	var gs []string
	for g := range rows {
		gs = append(gs, g)
	}
	sort.Strings(gs)
	bs := keepNum("LedgerSendBatch", 2000)
	first := true
	for {
		n, m := minI(bs, len(gs)), minI(bs, len(seen))
		batch, sb := gs[:n], seen[:m]
		last := n == len(gs) && m == len(seen)
		led := []any{}
		for _, g := range batch {
			a := arr(rows[g])
			oc := 0
			if truthy(at(a, 7)) {
				oc = 1
			}
			// [guid, MasterID, AlterID, name, parent, opening, GSTIN, PAN, openingChanged, state, deductee type, nature of payment,
			// special rate, lower-deduction certificates] (round 11: the state; 2.3.1: the party's deductee type, TDSDEDUCTEETYPE;
			// 2.4.3: TDSRATENAME, the special rate and the certificates, ledTDSCols)
			row := []any{g, toI64(at(a, 0)), toI64(at(a, 1)), str(at(a, 2)), str(at(a, 3)), str(at(a, 4)), str(at(a, 5)), str(at(a, 6)), oc, str(at(a, 8)), str(at(a, 9))}
			if truthy(o["openingsUnknown"]) {
				row[5], row[8] = "", 0 // 2.5.13: the opening is not known (a stand-in round): none sent
			}
			if len(a) >= 13 {
				// read by 2.4.3 (a row a 2.4.2 round left in the outbox has none: sent without them, FinCom leaves its own)
				row = append(row, ledTDSCols(str(at(a, 10)), str(at(a, 11)), str(at(a, 12)))...)
				if len(a) >= 17 {
					// 2.4.4: the pay-head fields, the 15th to 18th columns (a row a 2.4.3 round left in the outbox has none:
					// sent without them, FinCom leaves its own)
					row = append(row, str(at(a, 13)), str(at(a, 14)), str(at(a, 15)), str(at(a, 16)))
				}
			}
			led = append(led, row)
		}
		body := M{"kind": "ledger_list", "company": company, "ledgers": led, "last": last,
			"round": str(o["round"]), "complete": true, "rowsRead": toInt(o["rowsRead"]), "seen": toAny(sb)}
		if oa := str(o["openingsAt"]); isTallyDate(oa) {
			body["openingsAt"] = oa // 2.5.0: the openings are as at the books' beginning (a dated read; booksfrom.go)
		}
		if truthy(o["openingsUnknown"]) {
			body["openingsUnknown"], body["openingsWhy"] = true, booksFromUnknownWords // 2.5.13: none taken (booksfrom.go)
		}
		if first {
			rl := []any{}
			for g, v := range ren {
				a := arr(v)
				rl = append(rl, []any{g, str(at(a, 0)), str(at(a, 1))})
			}
			body["renamed"] = rl
			if o["groups"] != nil {
				body["groups"] = o["groups"]
			}
			if o["natures"] != nil {
				body["natures"] = o["natures"] // 2.4.3: [[guid, MasterID, AlterID, name, [[from, section, rate, other, no-PAN rate, no-PAN other, threshold, single bill]]]]
			}
			if sk := arr(o["skipped"]); len(sk) > 0 {
				body["skipped"] = sk // the ledgers that hang Tally: [MasterID, name, why]
			}
		}
		r := invokeCloud(body, 120)
		if r.code == 409 {
			cloudLinks[company] = false
			return errors.New("not linked")
		}
		if r.code != 200 {
			ledPushAfter[company] = time.Now().Add(time.Duration(keepNum("LedgerPushRetrySec", 300)) * time.Second)
			writeLog("Cloud: " + company + ": the ledger list did not go (" + r.err + "); tried again in a few minutes, the days go meanwhile")
			return nil
		}
		// taken: off the outbox
		for _, g := range batch {
			delete(rows, g)
		}
		gs, seen = gs[n:], seen[m:]
		if first {
			o["renamed"], o["groups"], o["skipped"], o["natures"], ren = M{}, nil, nil, nil, M{}
			first = false
		}
		o["rows"], o["seen"] = rows, toAny(seen)
		if last {
			_ = os.Remove(ledOutFile(dir))
			writeLog(fmt.Sprintf("Cloud: %s: the ledger list sent (%s)%s", company, ledSentNote(r.json), shadowNote(r)))
			if r.json != nil && str(r.json["openings"]) == "held" && !truthy(o["whole"]) {
				// 2.5.0 (migration 130): FinCom held the round's openings (not adding up to nil): every ledger again next round
				_ = saveFile(ledResendFile(dir), jsonText(M{"at": nowS(), "round": str(o["round"])}))
				writeLog("Cloud: " + company + ": FinCom kept its opening balances, as the ones read do not add up to nil; every ledger goes again with the next read")
			} else if r.json != nil && str(r.json["openings"]) == "held" {
				writeLog("Cloud: " + company + ": FinCom kept its opening balances, as the whole list's do not add up to nil in Tally either; changes go as usual (FinCom's Tally page says so)")
			}
			delete(ledPushAfter, company)
			return nil
		}
		_ = saveFile(ledOutFile(dir), jsonText(o))
	}
}
func ledSentNote(j M) string {
	if j == nil {
		return "taken"
	}
	return fmt.Sprintf("%d added, %d renamed, %d deleted", toInt(j["added"]), toInt(j["renamed"]), toInt(j["deleted"]))
}

// --- a ledger that hangs Tally (02-Oct-2026: one of 696-699): found by halving the chunk down to its one MasterID,
// then skipped in every later read (st["ledPoison"]), and named to FinCom's cloud with the next ledger list
func poisonMids(st M) []int64 {
	var o []int64
	for _, x := range arr(st["ledPoison"]) {
		o = append(o, toI64(at(arr(x), 0)))
	}
	return o
}
func nextPoison(st M, after int64) int64 {
	var best int64
	for _, p := range poisonMids(st) {
		if p > after && (best == 0 || p < best) {
			best = p
		}
	}
	return best
}

// 2.5.5: a ledger skipped because it took Tally longer than 2 s (not one that hangs Tally: those stay skipped)
func slowSkipped(st M, mid int64) bool {
	for _, x := range arr(st["ledPoison"]) {
		a := arr(x)
		if toI64(at(a, 0)) == mid {
			return strings.Contains(str(at(a, 2)), "takes Tally longer than 2 s")
		}
	}
	return false
}

// 2.5.5: the retry is due: a full read (Update now or the nightly run, not the ledger wake), and the ledger not tried
// today yet (at most once a day)
// 2.5.5 (review H1): the nightly run only (nobody has used FinCom for 15 minutes), never Update now or the ledger wake,
// and never while a posting goes
// (second review N2: a ledger that hangs Tally too, but a week after it was last asked; a skip of 2.5.4 or before, with
// no day noted, at the first night's run)
func (k *keepRun) slowRetryDue(st M, mid int64) bool {
	if k.kind != "nightly" || postingGoing() {
		return false
	}
	last := str(obj(st["ledSlowTry"])[fmt.Sprint(mid)])
	if slowSkipped(st, mid) {
		return last != today()
	}
	return last == "" || last <= addDays(today(), -7)
}

// 2.5.5: the one retry of a slow ledger: its MasterID alone, under the 2 s stop, giving way to a posting. true when
// the round may go on past it (read and cleared, or stopped: judged by ledJudge once Tally has finished it); an error
// when nothing reached Tally or Tally closed the connection (review L1, L2: the day's try is not used, nothing marked)
func (k *keepRun) slowRetry(company, bf string, port int, dir string, st, ls M, mid int64, save func()) (bool, error) {
	used := func() {
		tries := obj(st["ledSlowTry"])
		if tries == nil {
			tries = M{}
		}
		tries[fmt.Sprint(mid)] = today()
		st["ledSlowTry"] = tries
	}
	t := *k.tc
	t.yield = func() bool { return postingGoing() } // a posting first: given way at the lock, nothing sent
	var slot *abandonSlot
	rows, _, err := readLedgerChunkSlot(&t, company, bf, port, mid-1, mid, &slot)
	switch {
	case err == nil:
		appendLedRead(dir, rows)
		removePoison(dir, st, mid)
		delete(obj(st["ledSlowTry"]), fmt.Sprint(mid))
		ls["after"], ls["n"], ls["reqs"] = mid, toInt(ls["n"])+len(rows), toInt(ls["reqs"])+1
		save()
		writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d answered in time when asked again; it is read and no longer skipped", company, mid))
		return true, nil
	case errors.Is(err, errRecorderStop):
		used()
		ledPendSet(company, ledPending{mid: mid, kind: "retry", slot: slot, limit: time.Duration(recorderLimitMs()) * time.Millisecond})
		ls["after"], ls["reqs"] = mid, toInt(ls["reqs"])+1
		save()
		return true, nil
	case errors.Is(err, errTimeout):
		used() // reached Tally, no answer at all: it hangs Tally (as 2.5.4), asked again a week on
		setPoisonWhy(dir, st, mid, ledPoisonName(st, mid), ledHangWhy("did not answer when asked again"))
		ls["after"], ls["reqs"] = mid, toInt(ls["reqs"])+1
		save()
		writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d did not answer when asked again: it stays skipped as hanging Tally, asked again at a night's run a week on", company, mid))
		return true, nil
	default:
		return false, err
	}
}

// 2.5.5 (review H1): a single ledger stopped at 2 s, waiting to be judged by how long Tally kept it (in memory: a
// bridge started again asks it once more, nothing counted)
type ledPending struct {
	mid   int64
	kind  string // "find": found by halving; "retry": the nightly retry of a slow ledger
	slot  *abandonSlot
	limit time.Duration
}

var (
	ledPendMu sync.Mutex
	ledPend   = map[string]ledPending{}
)

func ledPendSet(company string, p ledPending) {
	ledPendMu.Lock()
	ledPend[companyKey(company)] = p
	ledPendMu.Unlock()
}
func ledPendTake(company string, keep bool) (ledPending, bool) {
	ledPendMu.Lock()
	defer ledPendMu.Unlock()
	p, ok := ledPend[companyKey(company)]
	if ok && !keep {
		delete(ledPend, companyKey(company))
	}
	return p, ok
}

// how long Tally kept a request it was stopped on: from the send to Tally's own end (the stop plus Tally's time after
// it); hung: Tally had not finished it at the long bound, or kept it longer than LedgerHangSec (30 s); known false
// when the bridge did not hold on to it (TallyAbandonMaxSec 0)
func ledKept(p ledPending) (kept time.Duration, hung, known bool) {
	if p.slot == nil || p.slot.done == nil {
		return 0, false, false
	}
	kept = p.limit + p.slot.took
	return kept, p.slot.bound || kept > time.Duration(keepNum("LedgerHangSec", 30))*time.Second, true
}

// third review T3: the search is over: the chunks grow back from size, doubling each in time, until the full chunk or
// the first stop
func ledGrowFrom(ls M, size int) {
	delete(ls, "iso")
	delete(ls, "isoOK")
	ls["size"], ls["grow"] = minI(ledChunkDefault(), size*2), true
	if toInt(ls["size"]) >= ledChunkDefault() {
		delete(ls, "grow")
	}
}

// 2.5.5 (reviews H1, M1, N2): the pending single ledger judged once Tally has finished it. Found by halving, it is
// asked again after the back-off and skipped only when stopped 3 times in a row (a chunk in time between resets the
// count): as hanging Tally when Tally kept one of the three over LedgerHangSec (30 s) or never finished it, else as
// slow. The nightly retry stopped keeps it skipped (hanging Tally or slow, by this stop). again: the round goes on at
// once (nothing waits)
func (k *keepRun) ledJudge(company, dir string, st, ls M, save func()) (bool, error) {
	p, ok := ledPendTake(company, true)
	if !ok {
		return false, nil
	}
	if p.slot != nil && p.slot.done != nil {
		select {
		case <-p.slot.done:
		default:
			return false, fmt.Errorf("%w (Tally is still on the ledger with MasterID %d)", errBackoff, p.mid)
		}
	}
	ledPendTake(company, false)
	kept, hung, known := ledKept(p)
	name := or(ledPoisonName(st, p.mid), ledNameOf(dir, p.mid))
	if p.kind == "retry" {
		if hung || !known {
			setPoisonWhy(dir, st, p.mid, name, ledHangWhy(fmt.Sprintf("Tally kept it %s when asked again", ledSecs(kept, p.slot))))
			writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d (%s) held Tally %s when asked again: it stays skipped as hanging Tally, asked again at a night's run a week on", company, p.mid, or(name, "name not known"), ledSecs(kept, p.slot)))
		} else {
			setPoisonWhy(dir, st, p.mid, name, "this ledger still takes Tally longer than 2 s (asked again "+nowS()+"); the bridge skips it and asks again at a later night's run")
			writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d (%s) still takes Tally longer than 2 s; it stays skipped, is named to FinCom again, and is asked again at a later night's run", company, p.mid, or(name, "name not known")))
		}
		save()
		return true, nil
	}
	if toI64(ls["after"])+1 != p.mid {
		return false, nil // the round moved on (a new round): nothing to judge
	}
	// second review N2: a stop Tally kept over LedgerHangSec (or not known how long) is one of the three in a row, not
	// a skip by itself; after three, hanging Tally when any of them was, else slow
	n := toInt(ls["oneStops"]) + 1
	if hung || !known {
		ls["oneHung"] = true
	}
	how := "Tally kept it " + ledSecs(kept, p.slot)
	if !known {
		how = "how long Tally kept it is not known"
	}
	if n < ledMinStops {
		ls["oneStops"] = n
		save()
		return false, fmt.Errorf("Tally took longer than 2 s for the ledger with MasterID %d (stopped %d of %d times in a row, %s); it is asked again after a pause",
			p.mid, n, ledMinStops, how)
	}
	tries := obj(st["ledSlowTry"]) // the day it was last asked: the next try is a night's run later (a week for a hang)
	if tries == nil {
		tries = M{}
	}
	tries[fmt.Sprint(p.mid)] = today()
	st["ledSlowTry"] = tries
	ls["after"] = p.mid
	if truthy(ls["iso"]) {
		ledGrowFrom(ls, 1) // third review T3: the search is over once the single ledger is judged
	}
	hangs := truthy(ls["oneHung"])
	delete(ls, "oneStops")
	delete(ls, "oneHung")
	if hangs {
		addPoisonWhy(dir, st, p.mid, name, ledHangWhy(fmt.Sprintf("stopped %d times in a row, the last time %s", n, how)))
		save()
		writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d (%s) was stopped %d times in a row and held Tally (%s): it hangs Tally; it is skipped and asked again at a night's run a week on", company, p.mid, or(name, "name not known"), n, how))
		return true, nil
	}
	addPoisonWhy(dir, st, p.mid, name, ledSlowWhy())
	save()
	writeLog(fmt.Sprintf("Keeping %s: the ledger with MasterID %d (%s) takes Tally longer than 2 s (stopped %d times in a row); it is skipped and named to FinCom, and asked again at a later night's run", company, p.mid, or(name, "name not known"), n))
	return true, nil
}

func ledSecs(kept time.Duration, s *abandonSlot) string {
	if s != nil && s.bound {
		return "past the bridge's longest wait (" + abandonMax().Round(time.Second).String() + ")"
	}
	return kept.Round(100 * time.Millisecond).String()
}
func ledHangWhy(how string) string {
	return "this ledger does not answer and holds Tally (" + how + ", found " + nowS() + "); the bridge skips it and asks again at a night's run a week on"
}
func ledNameOf(dir string, mid int64) string {
	for _, h := range loadLedList(dir) {
		if h.mid == mid {
			return h.name
		}
	}
	return ""
}
func ledPoisonName(st M, mid int64) string {
	for _, x := range arr(st["ledPoison"]) {
		if a := arr(x); toI64(at(a, 0)) == mid {
			return str(at(a, 1))
		}
	}
	return ""
}

// 2.5.5: the ledger no longer skipped (here and in the outbox not sent yet: review L5)
func removePoison(dir string, st M, mid int64) {
	st["ledPoison"] = withoutMid(arr(st["ledPoison"]), mid)
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	if o := readObjFile(ledOutFile(dir)); o != nil && o["skipped"] != nil {
		o["skipped"] = withoutMid(arr(o["skipped"]), mid)
		_ = saveFile(ledOutFile(dir), jsonText(o))
	}
}
func withoutMid(l []any, mid int64) []any {
	keep := []any{}
	for _, x := range l {
		if toI64(at(arr(x), 0)) != mid {
			keep = append(keep, x)
		}
	}
	return keep
}

// 2.5.5: a skipped ledger's reason renewed, and named to FinCom again with the next ledger list
func setPoisonWhy(dir string, st M, mid int64, name, why string) {
	for _, x := range arr(st["ledPoison"]) {
		if a := arr(x); toI64(at(a, 0)) == mid && len(a) >= 3 {
			a[2] = why
		}
	}
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		o = M{}
	}
	o["skipped"] = append(withoutMid(arr(o["skipped"]), mid), []any{mid, name, why}) // review L5: once per ledger
	_ = saveFile(ledOutFile(dir), jsonText(o))
}

func addPoison(dir string, st M, mid int64, name string) {
	addPoisonWhy(dir, st, mid, name, "this ledger does not answer and holds Tally (found "+nowS()+"); the bridge skips it")
}

// 2.5.5: a ledger found (by halving, each request stopped at 2 s) to take Tally longer than 2 s on its own
func ledSlowWhy() string {
	return "this ledger takes Tally longer than 2 s (found " + nowS() + "); the bridge skips it and asks again at a later night's run"
}

// 2.5.5: how many times in a row the smallest chunk is stopped at 2 s (each with the back-off) before it is halved
// below it to find the slow ledger(s)
const ledMinStops = 3

func addPoisonWhy(dir string, st M, mid int64, name, why string) {
	for _, p := range poisonMids(st) {
		if p == mid {
			return
		}
	}
	st["ledPoison"] = append(arr(st["ledPoison"]), []any{mid, name, why})
	ledOutMu.Lock()
	defer ledOutMu.Unlock()
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		o = M{}
	}
	o["skipped"] = append(withoutMid(arr(o["skipped"]), mid), []any{mid, name, why}) // review L5: once per ledger
	_ = saveFile(ledOutFile(dir), jsonText(o))
}
