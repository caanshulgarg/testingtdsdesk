package main

// Bridge 2.3.0: cancel/delete GUID (the planned 2.2.5 fix, taken into 2.3.0 by the owner's decision).
//
// On a real TallyPrime 7.1 (spike round 3, tally-real-spike) the add-on's before/after cancel and before/after delete lines
// carry an EMPTY GUID and no AlterID (the MasterID, type, number and date are there): $Guid is empty in the object context
// of Before/After Delete Object and Before/After Cancel Object, and no other method of that context is confirmed on a real
// Tally (a method Tally does not know stops the whole add-on from loading), so the add-on is not changed. The bridge finds
// Tally's GUID itself:
//   - a cancel: the voucher is still in Tally: asked by its MasterID (the allow-listed FinComVoucherByMaster, a background
//     read with the 2 s stop, the body fetch's path); Tally's GUID is taken (its AlterID too when Tally gives it cancelled);
//     when Tally cannot be asked, the bridge's own record, as for a delete;
//   - a delete: the voucher is gone: the bridge's own record of MasterID -> GUID per company (sync\recorder-guids.json,
//     written from Tally's own answers only: a body fetched, a cancel's GUID), used only for the same entry (its type and
//     date, and its number when both have one); else the line goes without a GUID and FinCom's cloud looks in its own
//     record (tally-ingest: the book's recorder lines that came with Tally's entry under that MasterID); else it is held
//     there with plain words.
// The GUID a MasterID makes (<company GUID>-<MasterID in 8 hex digits>) is never used on its own (an entry that came by
// import or sync keeps another GUID): it only says, in the log, whether the GUID found agrees with it.
// One log line per decision: "Recorder: <company>: delete of mid N: GUID from <source>".
//
// Review H1 (2.3.0, the owner's rule: no line from another user's session may enter any client's books; keep them held):
// every Windows user's Tally writes into the one shared recorder folder and a line carries no session, so every per-user
// bridge reads every user's lines; a cancel / delete in a copy of a client company (the same company GUID) in another
// user's Tally must never make this bridge send a cancel / delete of the real entry. So a voucher's cancel / delete line
// (with or without the add-on's GUID) takes a GUID only with proof from THIS bridge's own Tally:
//   - a cancel: Tally's answer by MasterID shows that voucher ISCANCELLED Yes (typed or not): Tally's GUID; anything
//     else (not cancelled there, not there, another voucher, Tally not asked): held, never a record's GUID;
//   - a delete: this bridge's Tally is asked by MasterID first (FinComVoucherByMaster, the line's date, a background read
//     with the 2 s stop that gives way to a posting): Tally still holds a voucher with that MasterID (or the GUID a record
//     names): held; Tally answers it is not there: the line's own GUID, else the bridge's record, else FinCom's, as before;
//     Tally cannot be asked (off, timeout, no starting point, no MasterID or date): held, never sent unproven;
//   - a held line goes with guidHeld: FinCom's cloud then never looks in its own record for it.

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// MasterIDs kept per company (the highest: Tally's MasterIDs grow, so the oldest entries go first)
const midRecordCap = 20000

// review H1 (2.3.0): the words a cancel / delete is held with when this bridge's own Tally does not show it happened here
const (
	liveCancelHeldWords      = "cancelled in a Tally this computer's FinCom Bridge does not read, or not yet cancelled here: held"
	liveDeleteHeldWords      = "not deleted in this Tally: held"
	liveCancelUnprovenWords  = "this computer's Tally could not be asked whether it was cancelled here"
	liveDeleteUnprovenWords  = "this computer's Tally could not be asked whether it was deleted here"
	liveUnprovenWordsEndTail = "; not sent as a %s: held"
)

// the words a delete / cancel goes with when its entry cannot be told
func liveGuidWords(ev string) string {
	return ev + " in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"
}

// one entry of the record: Tally's GUID, and the entry's type, number and date as Tally gave them
type midEntry struct {
	G string `json:"g"`
	T string `json:"t,omitempty"`
	N string `json:"n,omitempty"`
	D string `json:"d,omitempty"`
}

var mids = struct {
	mu    sync.Mutex
	dir   string
	m     map[string]map[string]midEntry // company GUID (lower case) -> MasterID -> entry
	dirty bool
}{}

func liveGuidsFile() string { return sp("recorder-guids.json") }

// under mids.mu: the record of this sync folder, loaded once (a restart, or a test's own folder, loads it again)
func midFresh() {
	d := syncDir()
	if mids.dir == d && mids.m != nil {
		return
	}
	mids.dir, mids.m, mids.dirty = d, map[string]map[string]midEntry{}, false
	for cg, v := range obj(obj(readJSONFile(liveGuidsFile()))["companies"]) {
		e := map[string]midEntry{}
		for mid, x := range obj(v) {
			o := obj(x)
			if g := str(o["g"]); g != "" && toI64(mid) > 0 {
				e[mid] = midEntry{G: g, T: str(o["t"]), N: str(o["n"]), D: str(o["d"])}
			}
		}
		if len(e) > 0 {
			mids.m[strings.ToLower(cg)] = e
		}
	}
}

// a restart, as far as the record is concerned (read again from the file at its next use)
func liveMidReset() {
	mids.mu.Lock()
	mids.dir, mids.m = "", nil
	mids.mu.Unlock()
}

// Tally's GUID of a voucher of this company (from Tally's own answer), with its type, number and date
func liveMidNote(cguid, mid, guid, typ, no, date string) {
	cguid, mid, guid = strings.ToLower(strings.TrimSpace(cguid)), onlyDigits(mid), strings.TrimSpace(guid)
	if cguid == "" || toI64(mid) <= 0 || guid == "" || livePlaceholder(guid) || len(guid) > 100 {
		return
	}
	e := midEntry{G: guid, T: cutRunes(strings.TrimSpace(typ), 100), N: cutRunes(strings.TrimSpace(no), 100), D: normDate(date)}
	mids.mu.Lock()
	defer mids.mu.Unlock()
	midFresh()
	co := mids.m[cguid]
	if co == nil {
		co = map[string]midEntry{}
		mids.m[cguid] = co
	}
	if co[mid] == e {
		return
	}
	co[mid] = e
	mids.dirty = true
	if len(co) > midRecordCap {
		ks := make([]int64, 0, len(co))
		for k := range co {
			ks = append(ks, toI64(k))
		}
		sort.Slice(ks, func(i, j int) bool { return ks[i] < ks[j] })
		for _, k := range ks[:len(co)-midRecordCap] {
			delete(co, fmt.Sprint(k))
		}
	}
}

func liveMidLookup(cguid, mid string) (midEntry, bool) {
	mids.mu.Lock()
	defer mids.mu.Unlock()
	midFresh()
	e, ok := mids.m[strings.ToLower(strings.TrimSpace(cguid))][onlyDigits(mid)]
	return e, ok
}

// sync\recorder-guids.json, written whole and atomically (as start-point.json), only when something changed
func liveMidSave() {
	mids.mu.Lock()
	defer mids.mu.Unlock()
	if !mids.dirty || mids.m == nil || mids.dir != syncDir() {
		return
	}
	cos := M{}
	for cg, co := range mids.m {
		e := M{}
		for mid, x := range co {
			e[mid] = x
		}
		cos[cg] = e
	}
	if err := saveFile(liveGuidsFile(), jsonText(M{"v": 1, "companies": cos})); err != nil {
		writeLog("Recorder: the record of Tally's GUIDs could not be written to " + liveGuidsFile() + ": " + err.Error())
		return
	}
	mids.dirty = false
}

// a voucher delete / cancel line the bridge finds the GUID for (the add-on gave none)
func (c *change) guidOwn() bool {
	return !c.isLedger() && (c.event == "deleted" || c.event == "cancelled")
}

// "delete" / "cancel"
func (c *change) guidVerb() string {
	if c.event == "cancelled" {
		return "cancel"
	}
	return "delete"
}

// one log line per decision on a delete / cancel line's GUID
func liveGuidSay(c *change, what string) {
	liveSayOnce("guid|"+c.lineId+"|"+what, fmt.Sprintf("Recorder: %s: %s of mid %s: %s", c.company, c.guidVerb(), or(c.masterId, "none"), what))
}

// whether the GUID found is the one its MasterID makes: said only, never deciding
func liveGuidDerivedNote(c *change, g string) string {
	if c.companyGuid == "" || toI64(c.masterId) <= 0 {
		return ""
	}
	if strings.EqualFold(g, fmt.Sprintf("%s-%08x", c.companyGuid, toI64(c.masterId))) {
		return "; the GUID its MasterID makes agrees"
	}
	return "; not the GUID its MasterID makes (an entry that came by import or sync)"
}

// under live.mu: a cancel's GUID as Tally gives it (the voucher by its MasterID, checked as the body fetch checks it)
func liveTakeGUID(c *change, x string) {
	c.bodyTried, c.guidFetch = true, false
	// review H1: only a cancel this bridge's own Tally shows (ISCANCELLED Yes, typed or not)
	if !strings.EqualFold(tagValue(x, "ISCANCELLED"), "Yes") {
		liveGuidHold(c, liveCancelHeldWords)
		return
	}
	c.guid = tagValue(x, "GUID")
	c.alterId = onlyDigits(tagNum(x, "ALTERID")) // the cancel's own AlterID
	c.heldWhy = ""
	liveMidNote(c.companyGuid, onlyDigits(tagNum(x, "MASTERID")), c.guid, tagValue(x, "VOUCHERTYPENAME"), tagValue(x, "VOUCHERNUMBER"), normDate(tagValue(x, "DATE")))
	liveGuidSay(c, "GUID from Tally (asked by MasterID): "+c.guid+liveGuidDerivedNote(c, c.guid))
}

// review H1 (under live.mu): a cancel / delete this bridge's own Tally does not show happened here: held with plain
// words, no GUID at all, and guidHeld (FinCom's cloud never looks in its own record for it); never asked again
func liveGuidHold(c *change, words string) {
	c.bodyTried, c.guidFetch, c.guidLate, c.guidCloud, c.guidProven = true, false, false, false, false
	c.guid, c.alterId, c.guidKeep, c.alterKeep = "", "", "", ""
	c.heldWhy, c.guidHeld, c.heldFinal = liveCapWhy(words), true, true
	liveGuidSay(c, "held: "+c.heldWhy)
}

// review H1 (under live.mu): this bridge's Tally could not be asked (why): held, never sent unproven
func liveGuidUnproven(c *change, why string) {
	w := liveDeleteUnprovenWords
	if c.event == "cancelled" {
		w = liveCancelUnprovenWords
	}
	liveGuidHold(c, w+" ("+cutRunes(why, 160)+")"+fmt.Sprintf(liveUnprovenWordsEndTail, c.guidVerb()))
}

// review H1 (under live.mu): a delete's answer from this bridge's Tally by MasterID (got: MasterID -> voucher): a voucher
// with that MasterID, or with the GUID the line or the bridge's record names, still there: held; else proven gone here
// (its GUID decided when it is sent, after the lines before it took Tally's entries: guidLate)
func liveDeleteAnswer(c *change, got map[string]string) {
	held := got[c.masterId] != ""
	if !held {
		var names []string
		if c.guidKeep != "" {
			names = append(names, c.guidKeep)
		}
		if e, ok := liveMidLookup(c.companyGuid, c.masterId); ok {
			names = append(names, e.G)
		}
		for _, x := range got {
			for _, g := range names {
				if strings.EqualFold(tagValue(x, "GUID"), g) {
					held = true
				}
			}
		}
	}
	if held {
		liveGuidHold(c, liveDeleteHeldWords)
		return
	}
	c.bodyTried, c.guidFetch, c.guidLate, c.guidProven = true, false, true, true
	liveGuidSay(c, "not in this Tally (asked by MasterID): proven deleted here")
}

// under live.mu: a delete proven gone from this bridge's own Tally (review H1): the line's own GUID, else the bridge's
// record, else the line goes for FinCom's record, with the words it is held with when FinCom cannot tell either
func liveGuidFallback(c *change, why string) {
	c.bodyTried, c.guidFetch = true, false
	if !c.guidProven || c.event != "deleted" {
		liveGuidUnproven(c, or(why, "not proven in this Tally"))
		return
	}
	if why != "" {
		why = " (" + cutRunes(why, 160) + ")"
	}
	if c.guidKeep != "" {
		c.guid, c.alterId, c.heldWhy, c.guidCloud = c.guidKeep, c.alterKeep, "", false
		liveGuidSay(c, "GUID from the line (gone from this Tally): "+c.guid)
		return
	}
	if e, ok := liveMidLookup(c.companyGuid, c.masterId); ok {
		other := ""
		switch {
		case c.vchType != "" && e.T != "" && !strings.EqualFold(c.vchType, e.T):
			other = "its type"
		case c.vchDate != "" && e.D != "" && c.vchDate != e.D:
			other = "its date"
		case c.vchNo != "" && e.N != "" && c.vchNo != e.N:
			other = "its number"
		}
		if other == "" {
			c.guid, c.heldWhy, c.guidCloud = e.G, "", false
			liveGuidSay(c, "GUID from the bridge's record: "+e.G+liveGuidDerivedNote(c, e.G)+why)
			return
		}
		why += fmt.Sprintf(" (the bridge's record of that MasterID is %s %s of %s: %s differs)", e.T, e.N, liveDay(e.D), other)
	}
	c.guid, c.guidCloud = "", true
	c.heldWhy = liveGuidWords(c.event)
	liveGuidSay(c, "GUID not known to the bridge"+why+"; FinCom's record is asked")
}

// what FinCom answered for the lines sent without a GUID (results: the recorder_lines answer's)
func liveGuidAnswers(group []*change, results []any) {
	by := map[string]M{}
	for _, x := range results {
		r := obj(x)
		by[str(r["line_id"])] = r
	}
	for _, c := range group {
		r := by[c.lineId]
		if !c.guidCloud || r == nil {
			continue
		}
		switch g, st := strings.TrimSpace(str(r["guid"])), str(r["state"]); {
		case g != "":
			liveMidNote(c.companyGuid, c.masterId, g, c.vchType, c.vchNo, c.vchDate)
			liveGuidSay(c, "GUID from FinCom's record ("+g+")"+liveGuidDerivedNote(c, g))
		case st == "held":
			liveGuidSay(c, "held: "+c.heldWhy)
		case st == "queued":
			liveGuidSay(c, "in FinCom's queue: FinCom's record decides, else it is held: "+c.heldWhy)
		default:
			liveGuidSay(c, "FinCom answered "+or(st, "nothing")+" without a GUID")
		}
	}
}
