// Bridge 2.2.0 (plan round 20, b): the live recorder. One internal stream of change events; two sources feed it, and
// everything after the stream (the body fetch, the uploader, the cloud's queue and jobs) is the same for both:
//
//   - Source A, the add-on (the default): the live add-on (addon\FinComRecorder.tdl) appends one heads-only line per
//     Tally event to C:\ProgramData\FinCom\recorder\<company GUID>-<yyyymmdd>.txt. The reader, driven by the 1 s folder
//     watch (recorder.go), reads the newest 7 days of those files from the offset kept in sync\recorder-offsets.json,
//     through readSharedFrom only (never a write, a lock, a rename or a delete), complete lines only (a partial last line
//     and a narration still being written wait), and maps the events: Form Accept pre without a GUID then post = created;
//     pre with a GUID = altered; after_delete = deleted; after_cancel = cancelled; import_object / after_import_object =
//     imported (the pair once); ledger accept without a GUID = ledger_created, with one = ledger_altered (the cloud turns
//     a new name into a rename); after_delete of a master = ledger_deleted. before_* and start/end_import are dropped.
//     A line's id is a hash of its file, the file's generation and the line's byte offset. FinCom's own entries are
//     known by "TDSDesk:<id>" in the narration (fid).
//   - Source B, no add-on (the fallback): when the light check sees ALTVCHID above the highest received, the undated
//     keep list (TDSDeskKeepList, AlterID filter) is asked once; new MasterIDs are created, the rest altered. It sees
//     no deletions (the gap check and the Day Book upload close them).
//   - RecorderSource addon | alterid | both (setting, default addon), overridden by the beat's recorderSource.
//
// The body fetch: a created, altered or imported entry that is not FinCom's own is asked of Tally by MasterID
// (2.3.4: FinComVoucherObject, Tally's object export of that one voucher, stripped to the approved fields: fastvch.go;
// it replaces FinComVoucherByMaster); a ledger created or altered by the ledger list's request with a one-ID range. A background
// read: it gives way to a posting, 20 s at most; without a body the line still goes (the cloud holds it).
//
// The uploader: recorder_lines (server/tally-cloud/index.ts), groups of at most 500 lines or 1 MB of one company; a
// group is marked sent (and the offset moves on) only on a 200 answer with results or queued; else it is tried again
// with the cloud push's backoff. Sent line ids are kept 7 days in sync\recorder-sent\ (no line twice after a restart).
// A posting goes first: while one is going, at most one group per gap between import requests, never while an import
// is at Tally; it catches up afterwards. Tally never waits for any of it: the add-on only appends its line.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	liveAddonName = "FinComRecorder.tdl"    // the live add-on (addon/), written beside the trial's by the install step
	vchByNumberID = "FinComVoucherByNumber" // 2.2.1: a new entry's body by its type and number on its date (allowlist.go)
	liveMaxIDs    = 1                       // 2.3.1 (the owner, 06-Oct-2026): strictly ONE MasterID per body fetch
	liveMaxLines  = 500                     // lines per recorder_lines call (the cloud's MAX_RECORDER_LINES)
	liveMaxBytes  = 1 << 20                 // bytes per recorder_lines call
	liveReadMax   = 1 << 20                 // bytes read from one file per turn
	liveNarrMax   = 4000                    // characters of a narration kept (the cloud reads 1,000; review Low 11)
	// the entry fetch of 2.2.2 .. 2.3.0, byte for byte: the trial forms B, D, E and F keep it (fetchtest.go, review M2)
	liveFetchField222 = "GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, ISCANCELLED, ISOPTIONAL, " +
		"ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, " +
		"ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD"
	liveFetchField = liveFetchField222 +
		// 2.3.1 (the owner's decision of 06-Oct-2026): the ledger lines kept under an invoice's items (item invoice mode:
		// the sales or purchase ledger sits under each item, the party and GST are its ledger entries), so an item
		// invoice's body balances; nothing else added (items231_test.go)
		", ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT, " +
		"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE" +
		// 2.3.1 part A (the owner's decision of 06-Oct-2026, "item invoices enter complete"; parta231_test.go): the entry's
		// reference and date, the party GSTIN, place of supply and company GSTIN (the Day Book path reads them: the live route
		// no longer blanks them), the e-invoice IRN and acknowledgement, the e-way bill number; on the ledger lines the GST
		// fields the Day Book path reads (HSN, rate details), cost centre allocations, bank details (transaction type,
		// instrument number or UTR, instrument date, bank date) and TDS details (nature of payment, rate, assessable value,
		// tax, the deductee); the items (name, billed quantity with its unit, rate, taxable value, the HSN and GST rate Tally
		// applied to that line) and the cost centres of the ledger lines under them. Stored fields only, nothing Tally works
		// out; read only, one entry per request, the 2-second rule
		", REFERENCE, REFERENCEDATE, PARTYGSTIN, PLACEOFSUPPLY, CMPGSTIN, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, " +
		"ALLLEDGERENTRIES.GSTHSNNAME, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, " +
		"ALLLEDGERENTRIES.RATEDETAILS.GSTRATE, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY, " +
		"ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, " +
		"ALLLEDGERENTRIES.BANKALLOCATIONS.DATE, ALLLEDGERENTRIES.BANKALLOCATIONS.NAME, " +
		"ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER, " +
		"ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER, " +
		"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY, " +
		"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE, " +
		"ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX, " +
		"ALLINVENTORYENTRIES.STOCKITEMNAME, ALLINVENTORYENTRIES.BILLEDQTY, ALLINVENTORYENTRIES.RATE, ALLINVENTORYENTRIES.AMOUNT, " +
		"ALLINVENTORYENTRIES.GSTHSNNAME, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, " +
		"ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY, " +
		"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, " +
		"ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, " +
		// (bank: 2.3.1 after the real TallyPrime 7.1 run of 06-Oct-2026, real231_test.go: the four bank fields came back as an
		// empty BANKALLOCATIONS.LIST; the allocation's own DATE and NAME are fetched with them, and the UTR,
		// UNIQUEREFERENCENUMBER, as Tally's own export of the entry carries them)
		// the TDS section as Tally keeps it on the entry: the bill-wise detail's section (a stored field TallyPrime 7.1
		// writes on every bill allocation; the owner asked for the section, 06-Oct-2026)
		"ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER" +
		// the owner's decision of 07-Oct-2026 (option A; tdswild_test.go): every field of the TDS list and its sub-list.
		// The real TallyPrime 7.1 run 37492981527 (S5, TDS entered on Tally's screen) gave the named TDS fields above as
		// empty TAXOBJECTALLOCATIONS.LISTs, while these two items returned the whole block (nature, party, the Income Tax
		// sub-category's rate, assessable amount and tax). One entry per request, read only, nothing else added
		", ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*"
)

// one change, whichever source it came from
type change struct {
	company, companyGuid, event, guid, masterId, alterId, vchType, vchNo, vchDate, name, parent, narr, fid, user, at, source, lineId string

	// the bridge's own
	file      string    // source A: the daily file's name
	start     int64     // source A: the byte offset of the first line it took (the offset kept never passes it unsent)
	saveMs    float64   // the add-on's own time on the line (t0 to t1), -1 when not known
	readAt    time.Time // when the bridge read it
	xml       string    // the body asked of Tally ("" : none)
	ledgers   []string  // the ledgers the body names
	bodyTried bool      // the body was asked (with or without success)
	during    bool      // read while a posting was going (the touched-ledger hook)
	bKey      string    // source B: its company key
	alterN    int64     // source B: its AlterID
	tries     int       // body fetches that did not go for a passing reason (review Low 9: 3 at most)
	// 2.2.1: a new entry Tally wrote before its save (MasterID 0): found by its type and number on its date
	byNumber bool
	askAfter time.Time // not asked before (the bridge's clock: a few seconds after the line, then 10 s apart)
	numTries int       // asks that found nothing (3 at most)
	also     []string  // the line ids of the same entry's other line (pre and post of one save) sent with this one
	// 2.2.2 (the owner's NWS144 findings): the line's own GUID, never sent as the entry's (lineGuid, when it is not its
	// MasterID in hex: idsMismatch); why the line goes without its entry (heldWhy)
	lineGuid    string
	idsMismatch bool
	heldWhy     string
	// 2.2.2 review: the AlterID the line had before the save (Tally's must be above it: else no save of that entry happened
	// here); a FinCom id the line carries that is not the entry's (a voucher copied from one FinCom posted); the line is
	// held for a reason no further ask can change (not asked again)
	lineAlter int64
	lineFid   string
	heldFinal bool
	// FinCom's own import coming back (its FinCom id, a GUID Tally made for its MasterID): not fetched (decided once, when
	// the line is read)
	exempt bool
	// 2.3.0 (cancel/delete GUID, recorder_guids.go): a cancel whose GUID is asked of Tally by its MasterID (guidFetch); a
	// delete / cancel sent without a GUID for FinCom's own record to tell (guidCloud); a delete (or a cancel Tally cannot be
	// asked for) whose GUID is looked up in the bridge's record when it is sent, after the lines before it took Tally's
	// entry (guidLate)
	guidFetch, guidCloud, guidLate bool
	// review H1 (2.3.0): a delete this bridge's own Tally answered is not there (guidProven); a cancel / delete held because
	// this bridge's Tally does not show it happened here (guidHeld: FinCom's cloud never looks in its record for it); the
	// line's own GUID, used only for a delete proven here (guidKeep)
	guidProven, guidHeld bool
	guidKeep, alterKeep  string
	// the owner's addition: held only because this bridge's Tally could not be asked at that moment: asked again by itself
	guidRetry bool
	// 2.3.1 (masters): a ":resolved" line sent once more because FinCom held the one before waiting for a ledger
	ledAgain bool
	// 2.3.1 (the owner's "full", 06-Oct-2026): the body is the answer to this version's entry request, which fetches every
	// field migration 56 keeps (liveFullFields): sent "full": true, so FinCom stores its blanks as Tally has them
	full bool
	// re-review M-B: a cancel sent without an AlterID: Tally's voucher counter (ALTVCHID) read then (liveCancelCounters)
	vchCounter int64
	// 2.3.2 (issue 232, b): held because its asks were stopped at 2 s or not answered (one timed-out try counted: the held
	// list asks again after 1 h, then 4 h, then ends it); c: held with slowWords, its company marked (never asked again)
	slowHeld, slowEnded bool
	// 2.3.3 (the owner's rule: "A save must always show on the Tally page, at least as held with a reason. Silence is not
	// acceptable."): sent held at once because its body was not there on its first attempt (fresh: the held list asks it
	// again at the next try, once; twice when Tally was not asked at all yet); freshTries: the asks so made already;
	// freshSlow: one of them stopped at the 2 s limit; dueNow: nothing was asked (the schedule waited): due at the next try;
	// queuedAt: when it was queued (the bridge's own clock, for the 4 s safety net)
	fresh, freshSlow, dueNow bool
	freshTries               int
	// 2.3.4 (the owner's answer B, 08-Oct-2026): its fast request was stopped at the limit: asked once more after
	// RecorderStopRetrySec (5 minutes), never sooner
	stopWait bool
	queuedAt time.Time
	// next-outbox: every place in the add-on's files this change was read from (a pair's two halves may sit in two daily
	// files; a line taken in with another of the same save adds its own): each file's offset kept waits for all of them
	holds []liveAt
	// next-outbox: a deliberate resend of a ":resolved" line ("items": FinCom asked again after an older bridge's
	// resolution; "ledger": after a ledger FinCom waited for came in); "" on every other send. FinCom answers a repeat of
	// the same line id and marker "already have" (migration 63), never stores it twice
	again string
	// next-masterhook: a master form's line (master_created / master_altered): the master's type ("Stock Item" ...)
	masterType string
	// 2.4.0 part 2 review M1: FinCom answered 200 but 'failed' for this line (a lock timeout, a deadlock) or gave no result
	// for it: not marked sent; sent again from retryAt (RecorderRetrySec doubling, 30 minutes at most), failN times so far
	// (FinCom's repeat check, migration 63, keeps a resend from being stored twice). Never given up (the coordinator, 08-Oct-
	// 2026, the owner's "nothing lost"): from RecorderFailedTries on it is sent every 30 minutes and the beat carries it
	// (stuck, stuckSince, stuckDay) so FinCom shows it under Needs you; failSince: its first failed answer
	failN     int
	retryAt   time.Time
	failWhy   string
	failSince time.Time
}

// a place in the add-on's files: the file and the byte offset a line starts at
type liveAt struct {
	file  string
	start int64
}

// the fields migration 56 keeps for a body that did not ask them (2.3.0's request): the party GSTIN, place of supply,
// reference and its date, the company GSTIN, and the ledger lines' HSN and rate
var liveFullFields = []string{"PARTYGSTIN", "PLACEOFSUPPLY", "REFERENCE", "REFERENCEDATE", "CMPGSTIN", "ALLLEDGERENTRIES.GSTHSNNAME",
	"ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD", "ALLLEDGERENTRIES.RATEDETAILS.GSTRATE"}

// the fetch asks every one of the fields (a FETCH list, ", " between)
func fetchHasAll(fetch string, fields []string) bool {
	have := map[string]bool{}
	for _, f := range strings.Split(fetch, ",") {
		have[strings.TrimSpace(f)] = true
	}
	for _, f := range fields {
		if !have[f] {
			return false
		}
	}
	return true
}

// the entry request of this build fetches every field 56 keeps
func liveFetchFull() bool { return fetchHasAll(liveFetchField, liveFullFields) }

func (c *change) key() string { return c.company + "|" + c.companyGuid }

func (c *change) isLedger() bool { return strings.HasPrefix(c.event, "ledger_") }

// the body is asked of Tally: created, altered or imported entries that are not FinCom's own (their body is FinCom's
// posted XML, in the cloud), and ledgers created or altered; each needs its MasterID
func (c *change) needsBody() bool {
	if c.bodyTried {
		return false
	}
	if c.byNumber {
		return c.vchDate != ""
	}
	if c.guidFetch {
		return c.masterId != "" && c.vchDate != ""
	}
	if c.masterId == "" {
		return false
	}
	switch c.event {
	case "created", "altered", "imported":
		return c.fetchesIds() && c.vchDate != ""
	case "ledger_created", "ledger_altered":
		return true
	}
	return false
}

// --- the state (one per sync folder: a test's own folder starts it afresh, as a restart does)
type liveFileSt struct {
	off int64  // read up to here (this run)
	gen int    // the file's generation (a file shorter than what was read is a new one)
	enc string // "utf16" or "utf8"
	// 2.4.0 part 2 review L2: a file without a day in its name (failed.txt) read past a line not yet confirmed: the day
	// (yyyymmdd) that first happened, kept on disk; the sent ids are kept from that day on (not from "00000000", for ever)
	keep string
}

type livePending struct {
	l          recLine
	file       string // the file its first half is in (a pair may cross midnight: pending is kept per company, review Low 10)
	gen        int
	start, end int64
	seen       time.Time
}

type liveBSt struct {
	company, guid          string
	after, seen, maxMaster int64
	// the owner's rule (04-Oct): 60 s at least between two requests
	lastAsk time.Time
}

type liveCoSt struct {
	read, sent      int
	lastError, last string
	skipped         int // lines of a company not linked to FinCom, skipped (review H1)
	notHere         int // fix 3: lines of a company not open in this bridge's own Tally when written, not sent
}

// a company's link to FinCom as the cloud's answer to recorder_lines said (review H1): linked, or not linked (409) at
type liveLinkSt struct {
	linked bool
	at     time.Time
}

type liveState struct {
	mu      sync.Mutex
	dir     string // the sync folder this state belongs to ("" : not loaded)
	files   map[string]*liveFileSt
	pending map[string]*livePending // file -> the first half of a pair waiting for its second
	queue   []*change
	queued  map[string]bool
	sent    map[string]bool
	b       map[string]*liveBSt
	c       map[string]*liveCSt // source C, per company key
	// 2.3.1: what a 2.3.0 bridge saved as switched off by the 2 s rule (method|company key -> since when), read once and
	// never in force: the first re-scan uses the entry fetch's to find the lines it sent without their body, and the file
	// is written again without it (offDrop: clearOldSwitchOffs says so)
	offWas   map[string]time.Time
	offDrop  bool
	links    map[string]*liveLinkSt // company key -> linked or not (review H1)
	qcount   map[string]int         // company GUID -> changes waiting (the cap per company, review H1)
	high     map[string]int64       // company key -> the highest AlterID received from the add-on (source B's start, M5)
	windows  map[string][][2]int64  // company key -> FinCom's clean posting windows (a0, a1] (M4)
	busyAt   map[string]time.Time   // file -> when "busy" was last logged (review Low 14)
	srcDir   string                 // the sync folder the owner's source (recorder-source.json) was read from
	co       map[string]*liveCoSt
	back     map[string]keepBack
	gapSet   bool
	gap      int64
	touched  map[string]map[string]bool
	lastPost time.Time
	logged   map[string]bool
	created  map[string][2]string // 2.2.1: a created entry's save key -> the line id sent and the GUID it went with (this run)
	scanned  bool                 // 2.2.1: the lines sent with a placeholder looked for (recorder_resolve.go), this run
	bodied   map[string]bool      // 2.2.2 review M1: the line ids sent WITH their entry's body (7 days, sync\recorder-sent\*.body.txt)
	// 2.3.1 review H1: the "<line id>:resolved" ids THIS version sent with Tally's body, its request fetching the items' ledger
	// lines (7 days, sync\recorder-sent\*.items.txt). A ":resolved" id sent and not here went from an older bridge (2.3.0's
	// request, without the items' lines): when FinCom lists its line again (refetch), it is asked and sent once more
	items231 map[string]bool
	// 2.3.1 (masters): the "<line id>:resolved" ids sent once more after FinCom held them waiting for a ledger (7 days,
	// sync\recorder-sent\*.ledger.txt): never a third time
	ledAgain map[string]bool
	// 2.3.2 (issue 232): the held lines ended with the Day Book words (sent so; never asked or sent again: 7 days,
	// sync\recorder-sent\*.ended.txt)
	ended map[string]bool
	// next-fastfetch (the owner's approval of 07-Oct-2026): the held lines given their one fresh ask with the fast request
	// "voucher object by MasterID" (7 days, sync\recorder-sent\*.fast.txt), and those this version ended: a line an earlier
	// bridge ended with the Day Book words is asked once more, never twice
	fastAsked map[string]bool
	// 2.3.4 re-review 2 (N-M1): the ":resolved" ids THIS version sent, with or without a body (a cancel / delete proven by
	// its GUID goes with none): a line resolved here is done, never ended once more with the Day Book words
	mine map[string]bool
	// fix 3 (the owner's spike run 37347773182): what this bridge saw of its OWN Tally's open companies (recorder_owntally.go)
	own       map[string]*liveOwnSt // company GUID (or "name:" + its name key) -> the times it was open in the own Tally
	ownAt     time.Time             // the last complete look at the own Tally's company list (kept on disk)
	ownCur    map[string]bool       // open at that look (review H1: kept on disk, so a restart keeps attributing lines by it)
	ownWaitAt time.Time             // review H1: the last time a line waited for a look
	ownBlind  bool                  // review H1: a look was stopped or backed off since the last complete look (kept on disk)
	ownWant   bool                  // a line waits for a look at the own Tally
	ownAskAt  time.Time             // when the reader last asked the own Tally's company list
	// next-outbox: the day (yyyymmdd) of the oldest daily file read past a line not yet confirmed ("": none): the sent ids
	// are rotated after 7 days, but never from that day on (kept in sync\recorder-offsets.json)
	keepFrom string
}

var (
	live         = &liveState{}
	liveUpMu     sync.Mutex
	liveSrc      atomic.Value // the beat's recorderSource ("" : the setting's)
	liveSendHook func()       // the tests: called right before a group goes
	// the tests: called right before each held line's ask (2.3.3 re-review L1)
	liveResolveAskHook func()
	liveComputerFn     = computerName
	liveZone           = time.Local // the add-on's time text is the PC's local time
)

// a restart, as far as the live recorder is concerned (the tests; the state reloads from disk at its next use)
func liveResetState() {
	live.mu.Lock()
	live.dir, live.srcDir = "", ""
	live.mu.Unlock()
	liveSrc.Store("")
	liveMidReset()
}

func liveResetBackoff() {
	live.mu.Lock()
	live.back = map[string]keepBack{}
	live.mu.Unlock()
}

// under live.mu: the state of this sync folder, loaded once (offsets and the sent ids of the last 7 days)
func liveFresh() {
	d := syncDir()
	if live.dir == d && live.files != nil {
		return
	}
	live.dir = d
	live.files, live.pending, live.queue, live.queued = map[string]*liveFileSt{}, map[string]*livePending{}, nil, map[string]bool{}
	live.sent, live.b, live.co, live.back = map[string]bool{}, map[string]*liveBSt{}, map[string]*liveCoSt{}, map[string]keepBack{}
	live.c, live.offWas, live.offDrop = map[string]*liveCSt{}, map[string]time.Time{}, false
	live.links, live.qcount, live.high, live.windows, live.busyAt = map[string]*liveLinkSt{}, map[string]int{}, map[string]int64{}, map[string][][2]int64{}, map[string]time.Time{}
	live.touched, live.logged, live.gapSet, live.lastPost = map[string]map[string]bool{}, map[string]bool{}, false, time.Time{}
	live.created, live.scanned = map[string][2]string{}, false
	o := readObjFile(liveOffsetsFile())
	live.keepFrom = str(o["keepFrom"])
	for k, v := range obj(o["files"]) {
		e := obj(v)
		live.files[k] = &liveFileSt{off: toI64(e["off"]), gen: toInt(e["gen"]), enc: str(e["enc"]), keep: str(e["keep"])}
	}
	for k, v := range obj(o["alterid"]) {
		e := obj(v)
		st := &liveBSt{company: str(e["company"]), guid: str(e["guid"]), after: toI64(e["after"]), seen: toI64(e["after"]), maxMaster: toI64(e["maxMaster"])}
		if t, err := time.Parse(time.RFC3339Nano, str(e["lastAsk"])); err == nil {
			st.lastAsk = t
		}
		live.b[k] = st
	}
	for k, v := range obj(o["slices"]) {
		e := obj(v)
		st := &liveCSt{company: str(e["company"]), guid: str(e["guid"]), seen: toI64(e["seen"]), maxMaster: toI64(e["maxMaster"])}
		if t, err := time.Parse(time.RFC3339Nano, str(e["lastAsk"])); err == nil {
			st.lastAsk = t
		}
		live.c[k] = st
	}
	if offs, had := o["off"]; had && offs != nil {
		for k, v := range obj(offs) {
			if at, err := time.ParseInLocation("2006-01-02T15:04:05", str(obj(v)["at"]), liveZone); err == nil {
				live.offWas[k] = at
			}
		}
		live.offDrop = true
	}
	for _, id := range liveLoadSent() {
		live.sent[id] = true
	}
	live.bodied = map[string]bool{}
	for _, id := range liveLoadIds(".body.txt") {
		live.bodied[id] = true
	}
	live.items231 = map[string]bool{}
	for _, id := range liveLoadIds(liveItemsSuffix) {
		live.items231[id] = true
	}
	live.ledAgain = map[string]bool{}
	for _, id := range liveLoadIds(liveLedgerSuffix) {
		live.ledAgain[id] = true
	}
	live.ended = map[string]bool{}
	for _, id := range liveLoadIds(liveEndedSuffix) {
		live.ended[id] = true
	}
	live.fastAsked = map[string]bool{}
	for _, id := range liveLoadIds(liveFastSuffix) {
		live.fastAsked[id] = true
	}
	live.mine = map[string]bool{}
	for _, id := range liveLoadIds(liveMineSuffix) {
		live.mine[id] = true
	}
	liveOwnLoad()
}

func liveOffsetsFile() string { return sp("recorder-offsets.json") }
func liveSentDir() string     { return filepath.Join(syncDir(), "recorder-sent") }

// the oldest day whose sent ids are kept: 7 days back, but (next-outbox) never past the day of a file read past a line
// not yet confirmed (live.keepFrom, under live.mu)
func liveSentCut() string {
	cut := nowFn().AddDate(0, 0, -7).Format("20060102")
	if live.keepFrom != "" && live.keepFrom < cut {
		cut = live.keepFrom
	}
	return cut
}

// the sent ids of the last 7 days (sync\recorder-sent\<yyyymmdd>.txt, the bridge's own folder); older files removed, and
// (next-outbox) only once every line before them is confirmed
func liveLoadSent() []string {
	var ids []string
	cut := liveSentCut()
	m, _ := filepath.Glob(filepath.Join(liveSentDir(), "*.txt"))
	for _, f := range m {
		day := strings.TrimSuffix(filepath.Base(f), ".txt")
		if !isTallyDate(day) {
			continue
		}
		if day < cut {
			_ = os.Remove(f)
			continue
		}
		for _, l := range strings.Split(readText(f), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				ids = append(ids, l)
			}
		}
	}
	return ids
}

// 2.2.2 review M1: the ids kept beside the sent ones in files <yyyymmdd><suffix> (7 days). 2.3.4 (the owner's 30-day
// window for lines ended by the slow-company rule, 08-Oct-2026): the ended ids and those given their one fresh ask are kept
// 31 days, as long as FinCom lists such a line (30 days), so it is asked once more and never a third time
func liveLoadIds(suffix string) []string {
	var ids []string
	days := 7
	if suffix == liveEndedSuffix || suffix == liveFastSuffix || suffix == liveMineSuffix {
		days = liveFastKeepDays
	}
	cut := nowFn().AddDate(0, 0, -days).Format("20060102")
	if c := liveSentCut(); c < cut {
		cut = c // next-outbox: never past a file still read past a line not yet confirmed
	}
	m, _ := filepath.Glob(filepath.Join(liveSentDir(), "*"+suffix))
	for _, f := range m {
		day := strings.TrimSuffix(filepath.Base(f), suffix)
		if !isTallyDate(day) {
			continue
		}
		if day < cut {
			_ = os.Remove(f)
			continue
		}
		for _, l := range strings.Split(readText(f), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				ids = append(ids, l)
			}
		}
	}
	return ids
}

func liveSaveIds(ids []string, suffix string) {
	if len(ids) == 0 {
		return
	}
	f := filepath.Join(liveSentDir(), nowFn().Format("20060102")+suffix)
	if err := appendText(f, strings.Join(ids, "\n")+"\n"); err != nil {
		writeLog("Recorder: the line ids could not be written to " + f + ": " + err.Error())
	}
}

// 2.3.1 review H1: the file suffix of the ":resolved" ids this version sent with their body
const liveItemsSuffix = ".items.txt"

// 2.3.1 (masters): the file suffix of the ":resolved" ids sent once more after a ledger FinCom waited for came in
const liveLedgerSuffix = ".ledger.txt"

// 2.3.2 (issue 232): the file suffix of the held line ids ended with the Day Book words
const liveEndedSuffix = ".ended.txt"

// 2.3.2: lines ended (under live.mu: noted; the ids written by the caller with liveSaveIds outside it). next-fastfetch: a
// line this version ends has had its chance with the fast request: noted so too (never asked once more)
func liveEndedNote(ids ...string) {
	if live.fastAsked == nil {
		live.fastAsked = map[string]bool{}
	}
	for _, id := range ids {
		live.ended[id] = true
		live.fastAsked[id] = true
	}
}

// next-fastfetch: the file suffix of the held line ids given their one fresh ask with the fast request (or ended by it)
const liveFastSuffix = ".fast.txt"

// 2.3.4 re-review 2 (N-M1): the file suffix of the ":resolved" ids this version sent (kept as long as the ended ones)
const liveMineSuffix = ".mine.txt"

// 2.3.4: how long the ended and fresh-ask ids are kept (FinCom lists a slow-ended line 30 days)
const liveFastKeepDays = 31

// under live.mu: a line an earlier bridge ended with the Day Book words, not yet asked with the fast request: asked once more
func liveFastAgainDue(id string) bool {
	return live.ended[id] && !live.fastAsked[id]
}

// under live.mu: a held line's resolution went already, as far as this version is concerned: queued, or sent by THIS
// version (with the items' ledger lines). again: FinCom listed the line again (refetch) after an older bridge's resolution;
// without it, any sent resolution counts (the rule before 2.3.1)
func liveResolvedDone(rid string, again bool) bool {
	if live.queued[rid] {
		return true
	}
	return live.sent[rid] && (!again || live.items231[rid])
}

func liveSaveSent(ids []string) {
	if len(ids) == 0 {
		return
	}
	f := filepath.Join(liveSentDir(), nowFn().Format("20060102")+".txt")
	if err := appendText(f, strings.Join(ids, "\n")+"\n"); err != nil {
		writeLog("Recorder: the sent line ids could not be written to " + f + ": " + err.Error())
	}
}

// sync\recorder-offsets.json (written whole, atomically, like start-point.json): per file the offset below which every
// line is sent (never past a line not sent, nor past the first half of a pair still waiting), and per company of source
// B the AlterID below which every change is sent
func liveSaveOffsets() {
	live.mu.Lock()
	if live.files == nil {
		live.mu.Unlock()
		return
	}
	files, keepFrom := M{}, ""
	for name, st := range live.files {
		off := st.off
		for _, p := range live.pending {
			if p.file == name && p.start < off {
				off = p.start
			}
		}
		for _, c := range live.queue {
			for _, h := range c.liveHolds() {
				if h.file == name && h.start < off {
					off = h.start
				}
			}
		}
		e := M{"off": off, "gen": st.gen, "enc": st.enc}
		// next-outbox: a file read past a line not yet confirmed: the sent ids from its day on are kept (a restart reads it
		// again from that line, and every line after it that went must be known as sent). 2.4.0 part 2 review L2: a file
		// without a day in its name (failed.txt): from the day it was first read past such a line (kept with the file's
		// offset), no longer "00000000" (every sent id kept for ever); every line after the held one went that day or later
		if off < st.off {
			d := liveFileDay(name)
			if d == "" {
				if st.keep == "" {
					st.keep = nowFn().Format("20060102")
				}
				d = st.keep
				e["keep"] = d
			}
			if keepFrom == "" || d < keepFrom {
				keepFrom = d
			}
		} else {
			st.keep = ""
		}
		files[name] = e
	}
	bs := M{}
	for k, st := range live.b {
		after := st.seen
		for _, c := range live.queue {
			if c.bKey == k && c.alterN-1 < after {
				after = c.alterN - 1
			}
		}
		if after < st.after {
			after = st.after
		}
		e := M{"company": st.company, "guid": st.guid, "after": after, "maxMaster": st.maxMaster}
		if !st.lastAsk.IsZero() {
			e["lastAsk"] = st.lastAsk.Format(time.RFC3339Nano)
		}
		bs[k] = e
	}
	cs := M{}
	for k, st := range live.c {
		e := M{"company": st.company, "guid": st.guid, "seen": st.seen, "maxMaster": st.maxMaster}
		if !st.lastAsk.IsZero() {
			e["lastAsk"] = st.lastAsk.Format(time.RFC3339Nano)
		}
		cs[k] = e
	}
	path := liveOffsetsFile()
	live.keepFrom = keepFrom
	live.mu.Unlock()
	o := M{"files": files, "alterid": bs, "slices": cs, "at": nowS()}
	if keepFrom != "" {
		o["keepFrom"] = keepFrom
	}
	if err := saveFile(path, jsonText(o)); err != nil {
		writeLog("Recorder: " + path + " could not be written: " + err.Error())
	}
}

// --- the source
// addon (the default), alterid (source B, Tally's change list), both (the add-on and Tally's change list: what the
// cloud means, round 2 R2-5). Month slices (source C) are the setting RecorderSlices alone (default off): the cloud
// cannot send them yet
func validSource(s string) bool {
	return s == "addon" || s == "alterid" || s == "both"
}

func liveSourceFile() string { return sp("recorder-source.json") }

// the owner's choice, kept in sync\recorder-source.json (review M6: it survives a restart; only the owner changes it)
func liveSrcLoad() {
	live.mu.Lock()
	d := syncDir()
	if live.srcDir != d {
		live.srcDir = d
		v := strings.ToLower(strings.TrimSpace(str(readObjFile(liveSourceFile())["source"])))
		if !validSource(v) {
			v = ""
		}
		liveSrc.Store(v)
	}
	live.mu.Unlock()
}

func recorderSource() string {
	liveSrcLoad()
	if s, _ := liveSrc.Load().(string); validSource(s) {
		return s
	}
	if s := strings.ToLower(strings.TrimSpace(cfgS("RecorderSource"))); validSource(s) {
		return s
	}
	return "addon"
}

func sourceHas(s string) bool {
	if s == "slices" {
		return cfgB("RecorderSlices")
	}
	r := recorderSource()
	return r == s || (r == "both" && (s == "addon" || s == "alterid"))
}

// the beat's answer: recorderSource (the owner's per-computer choice in FinCom). Review M6: only a present, valid value
// counts; an answer without it (or with anything else) keeps the owner's last choice (kept on disk), which keeps the
// setting's value until the owner first chooses
func applyRecorderSource(j M) {
	if j == nil {
		return
	}
	s := strings.ToLower(strings.TrimSpace(str(j["recorderSource"])))
	if !validSource(s) {
		return
	}
	liveSrcLoad()
	was, _ := liveSrc.Load().(string)
	if was != s {
		liveSrc.Store(s)
		if err := saveFile(liveSourceFile(), jsonText(M{"source": s, "at": nowS()})); err != nil {
			writeLog("Recorder: " + liveSourceFile() + " could not be written: " + err.Error())
		}
		writeLog("Recorder: FinCom sets where the changes come from on this computer: " + s)
	}
}

// --- source A: the daily files
// 2.2.2: on real TallyPrime 7.1 the add-on's @@FCRDay gives "5-Oct-26": <GUID>-5-Oct-26.txt (d-Mon-yy) is read too;
// next-userfile: <GUID>-<day>-<Windows user>.txt (userfile.go reLiveFileUser)

// the add-on's files to read, oldest first: (review M8) every .txt with a "-" in its name (the date part in any form:
// a line is taken only when its company GUID starts the name, so the trial's <GUID>.txt gives nothing), dated by its
// name (yyyymmdd, yyyy-mm-dd or, 2.2.2, d-Mon-yy as TallyPrime 7.1 writes it) or else by its last write; those of the last 7 days, and (review M7) those of the
// last 31 days with bytes not read yet; and failed.txt, where the add-on puts a line it could not write. None when the
// recorder folder fails its check (recorder.go)
func liveFiles() []string {
	d, ok := recorderDirChecked()
	if !ok {
		return nil
	}
	m, _ := filepath.Glob(filepath.Join(d, "*.txt"))
	now := nowFn()
	from, to, oldest := now.AddDate(0, 0, -6).Format("20060102"), now.AddDate(0, 0, 1).Format("20060102"), now.AddDate(0, 0, -31).Format("20060102")
	type df struct{ day, path string }
	var out []df
	for _, f := range m {
		n := filepath.Base(f)
		fi, err := os.Lstat(f)
		if err != nil || !fi.Mode().IsRegular() {
			continue
		}
		if strings.EqualFold(n, "failed.txt") {
			if liveUnread(n, fi.Size()) {
				out = append(out, df{to, f})
			}
			continue
		}
		if !strings.Contains(strings.TrimSuffix(n, ".txt"), "-") {
			continue
		}
		// next-userfile: another Windows user's own file is never opened by a bridge that runs for one user (userfile.go)
		if !liveFileMine(n) {
			continue
		}
		day := fi.ModTime().Format("20060102")
		if d := liveFileDay(n); d != "" {
			day = d
		}
		// next-outbox: a file read before and not read to its end (a line in it not yet confirmed) is read whatever its age
		if day > to || (day < oldest && !liveHeldBack(n, fi.Size())) || (day < from && !liveUnread(n, fi.Size())) {
			continue
		}
		out = append(out, df{day, f})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].day != out[j].day {
			return out[i].day < out[j].day
		}
		return out[i].path < out[j].path
	})
	var o []string
	for _, x := range out {
		o = append(o, x.path)
	}
	return o
}

// a file has bytes the reader has not taken (as its offsets say; a file never read has all of them)
func liveUnread(name string, size int64) bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	st := live.files[name]
	return st == nil || size > st.off
}

// next-outbox: a file the reader has read before whose offset kept is below its size (a line in it not yet confirmed)
func liveHeldBack(name string, size int64) bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	st := live.files[name]
	return st != nil && size > st.off
}

// the places a change holds in the add-on's files (a change made by the bridge itself holds none)
func (c *change) liveHolds() []liveAt {
	if len(c.holds) > 0 {
		return c.holds
	}
	if c.file != "" {
		return []liveAt{{c.file, c.start}}
	}
	return nil
}

// one turn of the reader (the 1 s watch): the new complete lines of each daily file; the changes found
func liveReadOnce() int {
	if !sourceHas("addon") {
		return 0
	}
	liveRescanOnce() // 2.2.1: once, before anything new is read
	posting := postingGoing()
	files := liveFiles()
	n := 0
	for _, f := range files {
		n += liveReadFile(f, posting)
	}
	// fix 3: a line waits for a look at this bridge's own Tally (written after the last look): asked now (a light,
	// background read, 30 s apart at most), then the files are read again
	if liveOwnAskNow() {
		for _, f := range files {
			n += liveReadFile(f, posting)
		}
	}
	n += liveFlushStale()
	if n > 0 {
		liveSaveOffsets()
	}
	return n
}

// the new lines of one daily file, read through readSharedFrom alone
func liveReadFile(path string, posting bool) int {
	name := filepath.Base(path)
	// review M7: opened only when it grew (the add-on's file is touched as little as possible)
	fi, err := os.Lstat(path)
	if err != nil {
		return 0
	}
	live.mu.Lock()
	liveFresh()
	st := live.files[name]
	if st != nil && st.enc != "" && fi.Size() == st.off {
		live.mu.Unlock()
		return 0
	}
	if st == nil {
		st = &liveFileSt{}
		live.files[name] = st
	}
	off, enc := st.off, st.enc
	live.mu.Unlock()
	if enc == "" {
		head, _, err := readSharedFrom(path, 0, 400)
		if err != nil || len(head) == 0 {
			return 0
		}
		enc, off = liveEncoding(head)
	}
	b, size, err := readSharedFrom(path, off, liveReadMax)
	if err != nil {
		if isSharingViolation(err) {
			// review Low 14: a file held by another program is said once per file every 10 minutes
			live.mu.Lock()
			said := live.busyAt[name]
			if time.Since(said) >= 10*time.Minute {
				live.busyAt[name] = time.Now()
			}
			live.mu.Unlock()
			if time.Since(said) >= 10*time.Minute {
				writeLog("Recorder: " + name + " is held by another program; read later")
			}
		}
		return 0
	}
	live.mu.Lock()
	defer live.mu.Unlock()
	if size < st.off {
		// shorter than what was read: a new file under the same name (never the add-on's way); read from its start
		st.gen++
		st.off, st.enc = 0, ""
		writeLog("Recorder: " + name + " is shorter than what was read: it is read again from its start")
		return 0
	}
	st.enc = enc
	if off > st.off {
		st.off = off // past the byte order mark
	}
	lines, upto := liveLogical(b, off, enc == "utf16", liveStarts(name), strings.EqualFold(name, "failed.txt"))
	if upto > st.off {
		st.off = upto
	}
	if len(b) == liveReadMax && upto == off {
		// a megabyte without a complete line: not a recorder line; passed over
		st.off = off + int64(len(b))
		writeLog("Recorder: " + name + ": a megabyte without a complete line was passed over")
	}
	n := 0
	held := map[string]string{}
	for _, l := range lines {
		k := liveTake(name, st.gen, l, posting, held)
		if k < 0 {
			// review H1: this company has its cap of changes waiting; the file is read on from this line once they go.
			// Fix 3 (-2): the line waits for a look at this bridge's own Tally
			if l.start < st.off {
				st.off = l.start
			}
			break
		}
		n += k
	}
	return n
}

func liveQueueCap() int { return keepNum("RecorderQueueMax", 5000) }

// review M3: whether an "FCR1|" line in a file may start a new line after one still open (its t1 not seen yet: a
// narration over several lines): only a line of the file's own company (its GUID starts the file name; failed.txt:
// the file the add-on meant) whose t0 is not before the open line's. Anything else is the narration's text
func liveStarts(name string) func(open, next string) bool {
	if strings.EqualFold(name, "failed.txt") {
		// round 2 R2-3: in failed.txt only a write_failed line starts a line, and never inside one still open (the add-on
		// writes each whole); a plain "FCR1|" line there is not taken
		return func(open, next string) bool {
			return open == "" && strings.HasPrefix(next, "FCR1|ev=write_failed|")
		}
	}
	return func(open, next string) bool {
		if open == "" {
			return true // nothing open: a line of its own (its company is checked when it is taken)
		}
		g := group(`\|cguid=([^|]*)\|`, next, 1)
		if !liveOwnFile(name, next, g) {
			return false
		}
		a, b := liveTime(group(`^FCR1\|ev=[^|]*\|t0=([^|]*)\|`, open, 1)), liveTime(group(`^FCR1\|ev=[^|]*\|t0=([^|]*)\|`, next, 1))
		return a.IsZero() || b.IsZero() || !b.Before(a)
	}
}

// a line's company GUID is its file's: the file name starts with "<GUID>-"; in failed.txt, the name of the file the add-on
// meant (file=)
func liveOwnFile(name, text, cguid string) bool {
	if cguid == "" {
		return false
	}
	if strings.EqualFold(name, "failed.txt") {
		name = filepath.Base(strings.ReplaceAll(group(`\|file=([^|]*)\|`, text, 1), "\\", "/"))
	}
	return strings.HasPrefix(name, cguid+"-")
}

// the encoding of a daily file from its first bytes, and where its text starts
func liveEncoding(head []byte) (string, int64) {
	if len(head) >= 2 && head[0] == 0xFF && head[1] == 0xFE {
		return "utf16", 2
	}
	if len(head) >= 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF {
		return "utf8", 3
	}
	zeros, n := 0, len(head)
	for i := 1; i < n; i += 2 {
		if head[i] == 0 {
			zeros++
		}
	}
	if n >= 4 && zeros > n/4 {
		return "utf16", 0
	}
	return "utf8", 0
}

type liveLogicalLine struct {
	text       string
	start, end int64
}

var reLiveDone = regexp.MustCompile(`\|t1=[^|\n]*(\|src=[A-Za-z]+)?\s*$`)

// the complete logical lines in bytes read from off: physical lines end with a line feed (a partial last one waits); a
// line not starting "FCR1|" continues the one before (a narration over several lines); the last logical line is
// complete when it ends with its t1 (and src). upto: the offset up to which the lines are taken
// single: (failed.txt, round 2 R2-3) a line over several physical lines (a narration with line breaks) is never taken as
// complete before the file's end: a narration could hold a whole forged line with its t1, followed by another. A genuine
// failed line after such a one is then read as its narration (failed.txt is rare; a lost line there beats a forged one)
func liveLogical(b []byte, off int64, wide bool, starts func(open, next string) bool, single bool) ([]liveLogicalLine, int64) {
	var phys []liveLogicalLine
	start := 0
	step := 1
	if wide {
		step = 2
	}
	for i := 0; i+step <= len(b); i += step {
		if b[i] != 0x0A || (wide && b[i+1] != 0) {
			continue
		}
		end := i + step
		raw := b[start:i]
		var t string
		if wide {
			t = utf16le(raw)
		} else if !utf8Valid(raw) {
			t = fromCP1252(raw)
		} else {
			t = string(raw)
		}
		phys = append(phys, liveLogicalLine{strings.TrimSuffix(t, "\r"), off + int64(start), off + int64(end)})
		start = end
	}
	var out []liveLogicalLine
	upto := off
	var cur *liveLogicalLine
	for _, p := range phys {
		if strings.HasPrefix(p.text, "FCR1|") {
			done := cur == nil || (reLiveDone.MatchString(cur.text) && !(single && strings.Contains(cur.text, "\n")))
			open := "" // "" : nothing open (no line, or the last one complete)
			if !done {
				open = cur.text
			}
			if starts == nil || starts(open, p.text) {
				if cur != nil {
					out = append(out, *cur)
					upto = cur.end
				}
				c := p
				cur = &c
				continue
			}
			if done {
				// not a line of its own and nothing open to continue: passed over (failed.txt: a plain line)
				if cur != nil {
					out = append(out, *cur)
					upto = cur.end
					cur = nil
				}
				upto = p.end
				continue
			}
		}
		if cur != nil {
			if p.text != "" {
				cur.text += "\n" + p.text
			}
			cur.end = p.end
			continue
		}
		upto = p.end // before any recorder line: passed over
	}
	if cur != nil && reLiveDone.MatchString(cur.text) {
		out = append(out, *cur)
		upto = cur.end
	}
	return out, upto
}

func utf8Valid(b []byte) bool { return strings.ToValidUTF8(string(b), "\uFFFD") == string(b) }

// the second half of each pair
var livePair = map[string]string{"voucher_accept_pre": "voucher_accept_post", "ledger_accept_pre": "ledger_accept_post", "import_object": "after_import_object"}

// one logical line: mapped, paired, queued (under live.mu). -1: its company has its cap of changes waiting (the line is
// read again later); -2 (fix 3): it waits for a look at this bridge's own Tally (read again then). held: the company
// GUIDs held, looked up once per read
func liveTake(file string, gen int, ll liveLogicalLine, posting bool, held map[string]string) int {
	text := ll.text
	if strings.HasPrefix(text, "FCR1|ev=write_failed|") {
		// review M7: a line the add-on could not write to its file, kept in failed.txt: the line itself is after "was="
		meant := filepath.Base(strings.ReplaceAll(group(`\|file=([^|]*)\|`, text, 1), "\\", "/"))
		i := strings.Index(text, "|was=")
		if i < 0 || meant == "" {
			return 0
		}
		text = text[i+len("|was="):]
		g := onlyField(text, "cguid")
		// round 2 R2-3: the inner line's GUID must be the GUID held for its company (none held: not taken)
		if !strings.HasPrefix(meant, g+"-") || g == "" || heldGUID(strings.TrimSpace(onlyField(text, "cname"))) != g {
			liveForeign(file, g)
			return 0
		}
	}
	l, ok := parseRecorderLine(text)
	if !ok {
		return 0
	}
	// review M3: a line counts only in its own company's file, and when the company's GUID held here is its GUID
	if !strings.EqualFold(file, "failed.txt") && !liveOwnFile(file, ll.text, l.CGUID) {
		liveForeign(file, l.CGUID)
		return 0
	}
	if _, had := held[l.CName]; !had {
		held[l.CName] = heldGUID(l.CName)
	}
	if h := held[l.CName]; h != "" && !strings.HasPrefix(l.CGUID, "name-") && l.CGUID != "noguid" && h != l.CGUID {
		liveForeign(file, l.CGUID)
		return 0
	}
	// fix 3 (the owner's spike run 37347773182, two Windows users): the recorder folder is shared by every user's Tally;
	// a line is taken only when this bridge's OWN Tally had its company open when it was written (recorder_owntally.go).
	// Else it is passed over, never sent (the Day Book upload stays the fallback for the owner's own entries); written
	// after the last look at the own Tally: it waits for the next look
	// next-userfile: a line that names another Windows user (w=) is never taken by a bridge running for one user
	// (userfile.go; DOMAIN\user compared whole, 2.4.0 review LOW). 2.4.0 review MEDIUM: a line naming this bridge's own
	// user is still taken only when its company is open in the bridge's own Tally (the cached look), as every other line
	if me := liveOwnWinUser(); me != "" && strings.TrimSpace(l.W) != "" && !liveUserSame(l.W, liveWinUserFn()) {
		liveOtherUser(l)
		return 0
	}
	switch liveOwnVerdict(l) {
	case liveOwnWait:
		return -2
	case liveOwnSkip:
		liveNotHere(l)
		return 0
	}
	if live.qcount[liveGUID(l.CGUID)] >= liveQueueCap() {
		liveSayOnce("cap|"+l.CGUID, fmt.Sprintf("Recorder: %s has %d changes waiting to be sent: the rest of its file is read once they go", strings.TrimSpace(l.CName), liveQueueCap()))
		return -1
	}
	if a := toI64(onlyDigits(l.AID)); a > 0 {
		if k := companyKey(strings.TrimSpace(l.CName)) + "|" + strings.TrimSpace(l.CGUID); a > live.high[k] {
			live.high[k] = a
		}
	}
	n := 0
	pk := l.CGUID // review Low 10: the pairs are kept per company (a save across midnight spans two daily files)
	if p := live.pending[pk]; p != nil {
		if livePair[p.l.Ev] == l.Ev {
			delete(live.pending, pk)
			m, ev := liveMerge(p.l, l)
			return liveEmitFrom(m, ev, file, gen, p.file, p.start, ll.start, ll.end, posting)
		}
		delete(live.pending, pk)
		n += liveFlush(p, posting)
	}
	if _, first := livePair[l.Ev]; first {
		live.pending[pk] = &livePending{l: l, file: file, gen: gen, start: ll.start, end: ll.end, seen: nowFn()}
		return n
	}
	m, ev := liveSingle(l)
	return n + liveEmit(m, ev, file, gen, ll.start, ll.start, ll.end, posting)
}

// one field of a line ("" when it is not there)
func onlyField(text, key string) string { return group(`\|`+key+`=([^|]*)\|`, text, 1) }

// a line naming another company than its file's: not taken; said once per file and GUID
func liveForeign(file, cguid string) {
	k := "foreign|" + file + "|" + cguid
	if live.logged[k] {
		return
	}
	live.logged[k] = true
	writeLog("Recorder: " + file + ": a line naming another company (" + cguid + ") is not taken")
}

// a line on its own (no first half before it)
func liveSingle(l recLine) (recLine, string) {
	master := strings.EqualFold(l.Obj, "Master")
	switch l.Ev {
	case "voucher_accept_post":
		if liveIsNew(l) || liveOtherEntry(l.GUID, l.CGUID, l.MID) {
			return l, "created"
		}
		return l, "altered"
	case "ledger_accept_post":
		if liveIsNew(l) {
			return l, "ledger_created"
		}
		return l, "ledger_altered"
	case "after_import_object":
		if master {
			return l, "ledger_altered"
		}
		return l, "imported"
	case "after_delete":
		// open question 1: a master its add-on's form lines named (masterhook.go); review M1 of 2.4.0 part 2: not a Pay Head,
		// a ledger in FinCom: its delete stays ledger_deleted (applied by FinCom to the ledger holding its GUID, as before)
		if t := liveMTOf(l.GUID); master && t != "" && t != "Pay Head" {
			return l, "master_deleted"
		}
		if master {
			return l, "ledger_deleted"
		}
		return l, "deleted"
	case "after_cancel":
		return l, "cancelled"
	}
	// next-masterhook: a master form's second line on its own (masterhook.go)
	if strings.HasSuffix(l.Ev, "_accept_post") && liveMasterType(l.Ev) != "" {
		return l, liveMasterEvent(liveIsNew(l))
	}
	return l, "" // before_*, start/end_import, write_failed, anything else: dropped
}

// 2.2.1 (the owner's NWS144 result, 05-Oct-2026): Tally's own state at the save decides created or altered, not whether a
// GUID is there. Before the save of a NEW entry Tally gives the GUID "<company GUID>-00000000", MasterID 0 and AlterID 0
// (and after it, a MasterID with AlterID 0); an entry altered has its own numbers. TDL gives no create/alter flag the
// add-on can be sure of on a real Tally (addon/FinComRecorder.tdl): these values are that flag
func livePlaceholder(g string) bool { return strings.HasSuffix(strings.TrimSpace(g), "-00000000") }

func liveZero(s string) bool { s = strings.TrimSpace(s); return s != "" && toI64(onlyDigits(s)) == 0 }

func liveIsNew(l recLine) bool {
	return strings.TrimSpace(l.GUID) == "" || livePlaceholder(l.GUID) || liveZero(l.MID) || liveZero(l.AID)
}

// 2.2.2: the MasterID a Tally GUID carries: its part after the last "-" read as hex (a voucher's GUID is its company's
// GUID and its MasterID as 8 hex digits); -1 when it has none
func guidMaster(g string) int64 {
	g = strings.TrimSpace(g)
	i := strings.LastIndex(g, "-")
	if i < 0 || i == len(g)-1 || len(g)-i-1 > 15 {
		return -1
	}
	var n int64
	for _, r := range strings.ToLower(g[i+1:]) {
		switch {
		case r >= '0' && r <= '9':
			n = n*16 + int64(r-'0')
		case r >= 'a' && r <= 'f':
			n = n*16 + int64(r-'a'+10)
		default:
			return -1
		}
	}
	return n
}

// 2.2.2 (the owner's NWS144 findings, 05-Oct-2026): a line whose GUID is not its MasterID in hex (a voucher duplicated
// from an older one carries the source's GUID): its GUID and AlterID are not the entry's
//
// The coordinator's correction (05-Oct-2026): only a GUID with the line company's prefix says so (Tally makes those);
// a GUID with another prefix (an entry that came by Tally synchronisation or an XML import keeps its original GUID) is
// not by itself a mismatch (its GUID and AlterID are still never trusted: the entry is always fetched)
func liveIdsMismatch(guid, cguid, mid string) bool {
	g, cg, m := strings.ToLower(strings.TrimSpace(guid)), strings.ToLower(strings.TrimSpace(cguid)), toI64(onlyDigits(mid))
	if g == "" || livePlaceholder(g) || m <= 0 || cg == "" || !strings.HasPrefix(g, cg+"-") {
		return false
	}
	return !guidHexIs(g[len(cg)+1:], m)
}

// 2.2.2 review (M4): a GUID this Tally made for this company: the company's GUID, "-" and hex digits
func liveTallyGUID(g, cguid string) bool {
	g, cguid = strings.ToLower(strings.TrimSpace(g)), strings.ToLower(strings.TrimSpace(cguid))
	return cguid != "" && strings.HasPrefix(g, cguid+"-") && guidMaster(g) >= 0 && !strings.Contains(g[len(cguid)+1:], "-")
}

// a GUID with the line company's prefix that is not the MasterID's (a voucher duplicated from an older one carries the
// source's): the line is about another entry. A GUID with another prefix says nothing: Tally's AlterID decides then
// (liveVoucherWrong)
func liveOtherEntry(guid, cguid, mid string) bool {
	return liveIdsMismatch(guid, liveGUID(strings.TrimSpace(cguid)), mid)
}

// 2.2.2: the entry's GUID, MasterID and AlterID come from Tally: a voucher created, altered or imported (its body is
// asked of Tally). Review H1: a voucher saved in a form is asked whatever FinCom id its narration carries (a copy of
// one FinCom posted carries it too); only FinCom's own import whose ids agree goes without (its body is the posting's)
func (c *change) fetchesIds() bool {
	if c.isLedger() || (c.event != "created" && c.event != "altered" && c.event != "imported") {
		return false
	}
	return !c.exempt
}

// 2.2.2 second review (L-D): a GUID Tally made for this MasterID: the company's GUID, "-" and the MasterID in hex
func liveOwnGUID(guid, cguid, mid string) bool {
	g, cg, m := strings.ToLower(strings.TrimSpace(guid)), strings.ToLower(strings.TrimSpace(cguid)), toI64(onlyDigits(mid))
	return m > 0 && cg != "" && strings.HasPrefix(g, cg+"-") && guidHexIs(g[len(cg)+1:], m)
}

// a narration without its "TDSDesk:<id>" tags
func liveNoTag(narr string) string { return strings.TrimSpace(reLiveFid.ReplaceAllString(narr, "")) }

// 2.2.2 security review: the words that go with a line, capped
func liveCapWhy(s string) string { return cutRunes(s, 300) }

// a pair: the second half's values, the first half's where the second has none; the event from the first half's state
// (a new entry or not: liveIsNew)
func liveMerge(pre, post recLine) (recLine, string) {
	m := post
	for _, f := range []struct{ a, b *string }{{&m.GUID, &pre.GUID}, {&m.MID, &pre.MID}, {&m.AID, &pre.AID}, {&m.VType, &pre.VType}, {&m.VNo, &pre.VNo},
		{&m.VDate, &pre.VDate}, {&m.Name, &pre.Name}, {&m.Parent, &pre.Parent}, {&m.Narr, &pre.Narr}, {&m.CName, &pre.CName}, {&m.CGUID, &pre.CGUID}, {&m.User, &pre.User}} {
		if strings.TrimSpace(*f.a) == "" {
			*f.a = *f.b
		}
	}
	m.T0 = pre.T0
	fresh := liveIsNew(pre)
	switch pre.Ev {
	case "voucher_accept_pre":
		// 2.2.2: a voucher duplicated from an older one: the pre carries the SOURCE's GUID and AlterID, the saved entry has
		// another MasterID: the GUID is not the MasterID's, so it is a new entry
		if g := strings.TrimSpace(pre.GUID); g != "" && !livePlaceholder(g) && g != strings.TrimSpace(m.GUID) {
			m.PreGUID = g
		}
		m.PreAID = pre.AID
		if fresh || (toI64(onlyDigits(pre.MID)) > 0 && toI64(onlyDigits(m.MID)) > 0 && toI64(onlyDigits(pre.MID)) != toI64(onlyDigits(m.MID))) ||
			liveOtherEntry(pre.GUID, m.CGUID, m.MID) || liveOtherEntry(m.GUID, m.CGUID, m.MID) {
			return m, "created"
		}
		return m, "altered"
	case "ledger_accept_pre":
		if fresh {
			return m, "ledger_created"
		}
		return m, "ledger_altered"
	}
	// next-masterhook: a master form's pair (masterhook.go)
	if liveMasterPre(pre.Ev) {
		return m, liveMasterEvent(fresh)
	}
	if strings.EqualFold(pre.Obj, "Master") {
		if fresh {
			return m, "ledger_created"
		}
		return m, "ledger_altered"
	}
	return m, "imported"
}

// a first half whose second never came: a pre with a GUID is an alteration, an import an import; a pre without a GUID
// (nothing saved) is dropped
func liveFlush(p *livePending, posting bool) int {
	l, file, gen := p.l, p.file, p.gen
	switch {
	case l.Ev == "import_object":
		ev := "imported"
		if strings.EqualFold(l.Obj, "Master") {
			ev = "ledger_altered"
			if strings.TrimSpace(l.GUID) == "" {
				ev = "ledger_created"
			}
		}
		return liveEmit(l, ev, file, gen, p.start, p.start, p.end, posting)
	case strings.TrimSpace(l.GUID) != "":
		// 2.2.1: a new entry's pre alone (Tally wrote no post: Receipt 191 on NWS144) is a created entry, found by its type
		// and number
		ev := map[bool]string{true: "created", false: "altered"}[liveIsNew(l) || (l.Ev == "voucher_accept_pre" && liveOtherEntry(l.GUID, l.CGUID, l.MID))]
		if l.Ev == "voucher_accept_pre" {
			l.PreAID = l.AID // the pre alone: its AlterID is the one before the save
		}
		if l.Ev == "ledger_accept_pre" {
			ev = "ledger_" + ev
		}
		if liveMasterPre(l.Ev) {
			ev = liveMasterEvent(liveIsNew(l)) // next-masterhook
		}
		return liveEmit(l, ev, file, gen, p.start, p.start, p.end, posting)
	}
	if l.Ev == "voucher_accept_pre" || l.Ev == "ledger_accept_pre" || liveMasterPre(l.Ev) {
		liveSayOnce("unsaved|"+l.CGUID+"|"+l.VType+"|"+l.VNo+"|"+l.T0, fmt.Sprintf("Recorder: %s of %s opened in a form and not saved (no GUID, no second line): nothing to send",
			or(strings.TrimSpace(l.VType+" "+l.VNo), or(strings.TrimSpace(l.Name), "an entry")), liveDay(normDate(l.VDate))))
	}
	return 0
}

// pairs waiting longer than RecorderPairSec (10 s) are flushed
func liveFlushStale() int {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	n := 0
	wait := time.Duration(keepNum("RecorderPairSec", 10)) * time.Second
	for k, p := range live.pending {
		if nowFn().Sub(p.seen) >= wait {
			delete(live.pending, k)
			n += liveFlush(p, false)
		}
	}
	return n
}

var reLiveFid = regexp.MustCompile(`TDSDesk:([A-Za-z0-9._-]{1,80})`)

func liveLineID(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:])[:32]
}

// the add-on's time text ("4-Oct-2026 10:15:03"), read as the PC's local time; zero when it is not one
func liveTime(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, f := range []string{"2-Jan-2006 15:04:05", "2-Jan-2006 15:04", "2-Jan-06 15:04:05", "2-Jan-06 15:04", "2006-01-02 15:04:05", "02-01-2006 15:04:05"} {
		if t, err := time.ParseInLocation(f, s, liveZone); err == nil {
			return t
		}
	}
	return time.Time{}
}

// one change queued (under live.mu): its line id; nothing when it was sent before or is queued already
func liveEmit(l recLine, ev, file string, gen int, start, lineStart, end int64, posting bool) int {
	return liveEmitFrom(l, ev, file, gen, file, start, lineStart, end, posting)
}

// liveEmit with the file start lies in (next-outbox: a pair's first half may be in the day before's file; both files'
// offsets wait for the change)
func liveEmitFrom(l recLine, ev, file string, gen int, startFile string, start, lineStart, end int64, posting bool) int {
	if ev == "" {
		return 0
	}
	id := liveLineID(file, fmt.Sprint(gen), fmt.Sprint(lineStart))
	if live.sent[id] || live.queued[id] {
		return 0
	}
	c := &change{company: strings.TrimSpace(l.CName), companyGuid: strings.TrimSpace(l.CGUID), event: ev, guid: strings.TrimSpace(l.GUID), masterId: onlyDigits(l.MID),
		alterId: onlyDigits(l.AID), vchType: cutRunes(strings.TrimSpace(l.VType), 200), vchNo: cutRunes(strings.TrimSpace(l.VNo), 200), vchDate: normDate(l.VDate),
		name: strings.TrimSpace(l.Name), parent: strings.TrimSpace(l.Parent), narr: l.Narr, user: cutRunes(strings.TrimSpace(l.User), 200), source: "addon", lineId: id,
		file: file, start: start, saveMs: -1, readAt: nowFn(), during: posting, lineAlter: toI64(onlyDigits(l.PreAID))}
	c.holds = []liveAt{{startFile, start}}
	if startFile != file {
		c.holds = append(c.holds, liveAt{file, lineStart})
	}
	c.companyGuid = liveGUID(c.companyGuid)
	if c.isMaster() {
		c.masterType = liveMasterType(l.Ev) // next-masterhook: heads only (masterhook.go)
		if c.masterType == "" {
			c.masterType = liveMTOf(l.GUID) // a delete: the type its form lines named
		} else {
			liveMTNote(l.GUID, c.masterType)
		}
	}
	if r := []rune(c.narr); len(r) > liveNarrMax {
		c.narr = string(r[:liveNarrMax]) // review Low 11
	}
	if liveNotLinkedLocked(c.key()) {
		// review H1: a company FinCom says is not linked: its lines are counted and skipped (the offset moves on)
		liveCo(c.company).skipped++
		live.sent[id] = true
		liveSayOnce("notlinked|"+c.key(), "Recorder: "+c.company+" is not linked to a FinCom client: its lines are skipped, nothing of them is asked of Tally (asked again in an hour)")
		return 0
	}
	if !c.isLedger() && !c.isMaster() {
		if m := reLiveFid.FindStringSubmatch(c.narr); m != nil {
			c.fid = m[1]
		}
		bankNoteAddon(c) // next-bankdate: a save the add-on wrote a line for explains one move of ALTVCHID
	}
	// 2.2.1: a placeholder GUID is never sent: rebuilt from the MasterID (a Tally GUID is the company's GUID and the
	// MasterID as 8 hex digits), or left empty and the entry found by its type and number; MasterID / AlterID 0 are not
	// numbers
	if liveZero(c.masterId) {
		c.masterId = ""
	}
	if liveZero(c.alterId) {
		c.alterId = ""
	}
	// 2.2.2 (the owner's rule): the line's GUID and AlterID are not trusted. A voucher whose body is asked of Tally takes
	// Tally's GUID, MasterID and AlterID (none until then); a line whose GUID is not its MasterID in hex keeps its GUID
	// only as lineGuid (idsMismatch), never as the entry's
	if !c.isLedger() && !c.isMaster() {
		c.idsMismatch = liveIdsMismatch(c.guid, c.companyGuid, c.masterId)
		if c.idsMismatch {
			c.lineGuid = c.guid
		} else if liveIdsMismatch(l.PreGUID, c.companyGuid, c.masterId) {
			c.idsMismatch, c.lineGuid = true, strings.TrimSpace(l.PreGUID) // review L4: the pre carried another entry's GUID
		}
		c.lineGuid = cut(cleanGUID(c.lineGuid), 80)
		c.exempt = c.event == "imported" && c.fid != "" && !c.idsMismatch && liveOwnGUID(c.guid, c.companyGuid, c.masterId)
		if c.fetchesIds() || c.idsMismatch {
			c.guid, c.alterId = "", ""
		}
		// review L3: an entry Tally cannot be asked for says so
		if c.fetchesIds() && c.vchDate == "" {
			c.heldWhy = "the line has no date, so Tally cannot be asked for its entry"
		} else if c.fetchesIds() && c.masterId == "" && c.event != "created" {
			c.heldWhy = "the line has no MasterID, so Tally cannot be asked for its entry"
		}
		switch {
		case c.exempt:
			liveDecide(c, "not asked: FinCom's own posting coming back (matched by FinCom id)")
		case c.fetchesIds() && c.heldWhy != "":
			liveDecide(c, "not asked: "+c.heldWhy)
		}
	}
	// 2.3.0 (cancel/delete GUID): a voucher's delete / cancel without Tally's GUID (a real TallyPrime 7.1 gives none on
	// these events): never the GUID its MasterID makes. Review H1: every voucher delete / cancel (with or without the
	// add-on's GUID) is asked of THIS bridge's Tally by its MasterID: a cancel takes Tally's GUID when Tally shows it
	// cancelled; a delete goes on (its own GUID, the bridge's record, else FinCom's) only when Tally answers it is not
	// there; else, or when Tally cannot be asked, it is held (recorder_guids.go)
	if c.guidOwn() {
		if c.guid != "" && !livePlaceholder(c.guid) && c.event == "deleted" {
			c.guidKeep, c.alterKeep = c.guid, c.alterId
		}
		c.guid, c.alterId = "", ""
		if c.masterId != "" && c.vchDate != "" {
			c.guidFetch = true
		} else {
			liveGuidUnprovenAs(c, "the line has no MasterID or no date", false)
		}
	}
	if livePlaceholder(c.guid) {
		c.guid = ""
		// a voucher only: the rule is proven for vouchers (NWS144); a new ledger's GUID stays empty until Tally gives it
		// (its body fetch), never built (2.2.1 review)
		if mid := toI64(c.masterId); mid > 0 && c.companyGuid != "" && !c.isLedger() && !c.isMaster() {
			c.guid = fmt.Sprintf("%s-%08x", c.companyGuid, mid)
		}
	}
	if c.event == "created" && !c.isLedger() && c.masterId == "" {
		c.byNumber = true
		c.askAfter = time.Now().Add(time.Duration(keepNumZero("RecorderNumberWaitMs", 3000)) * time.Millisecond)
	}
	t0, t1 := liveTime(l.T0), liveTime(l.T1)
	at := t1
	if at.IsZero() {
		at = t0
	}
	if at.IsZero() {
		at = c.readAt.In(liveZone)
	}
	c.at = at.Format(time.RFC3339)
	// 2.2.1: the add-on's times are to the minute ($$MachineTime): t1 - t0 is then no time at all (it was 0 on every
	// NWS144 line), and is sent only when both carry seconds
	if !t0.IsZero() && !t1.IsZero() && !t1.Before(t0) && reLiveSecs.MatchString(l.T0) && reLiveSecs.MatchString(l.T1) {
		c.saveMs = float64(t1.Sub(t0).Milliseconds())
	}
	if posting {
		live.lastPost = time.Now()
		if c.isLedger() && c.name != "" {
			liveTouch(c.company, c.name)
		}
	}
	if liveSameSave(c) {
		return 1
	}
	liveQueueAdd(c)
	return 1
}

var reLiveSecs = regexp.MustCompile(`\d:\d\d:\d\d`)

// the key of a created entry's save: company, type, number, date and the minute of the save
func (c *change) saveKey() string {
	return c.key() + "|" + c.vchType + "|" + c.vchNo + "|" + c.vchDate + "|" + cut(c.at, 16)
}

// 2.2.1 (under live.mu): a new entry's pre and post taken apart (another line between them, or the pre alone after its
// wait) are one created line: the one waiting takes the MasterID the other has; one already sent with its GUID takes
// the other in; one sent without its GUID is followed by this one as its resolution (line id + ":resolved"). true: c
// is not queued on its own
func liveSameSave(c *change) bool {
	if c.event != "created" || c.isLedger() || c.vchNo == "" {
		return false
	}
	k := c.saveKey()
	for _, q := range live.queue {
		if q.event != "created" || q.isLedger() || q.lineId == c.lineId || q.saveKey() != k || strings.HasSuffix(q.lineId, ":resolved") {
			continue
		}
		if c.masterId != "" && q.masterId == "" && q.xml == "" {
			q.masterId, q.guid, q.byNumber, q.bodyTried, q.tries = c.masterId, c.guid, false, false, 0
			if c.alterId != "" {
				q.alterId = c.alterId
			}
			if c.idsMismatch && !q.idsMismatch {
				q.idsMismatch, q.lineGuid = true, c.lineGuid
			}
		}
		q.also = append(q.also, c.lineId)
		q.holds = append(q.holds, c.holds...) // next-outbox: c's place waits for q's send too
		live.queued[c.lineId] = true
		liveDecide(c, "goes with line "+cut(q.lineId, 8)+"… (the other line of the same save)")
		return true
	}
	s, had := live.created[k]
	if !had {
		return false
	}
	if s[1] != "" {
		live.sent[c.lineId] = true
		liveSaveSent([]string{c.lineId})
		liveDecide(c, "not sent again: the same save went already with Tally's GUID "+s[1])
		return true
	}
	id := s[0] + ":resolved"
	if live.sent[id] || live.queued[id] {
		live.sent[c.lineId] = true
		liveSaveSent([]string{c.lineId})
		liveDecide(c, "not sent again: the same save was resolved already")
		return true
	}
	c.also = append(c.also, c.lineId)
	live.queued[c.lineId] = true
	c.lineId = id
	return false
}

// the company GUID a line names; "" when the add-on had none ("name-..." from the trial, "noguid" from the live add-on)
func liveGUID(g string) string {
	if strings.HasPrefix(g, "name-") || g == "noguid" {
		return ""
	}
	return g
}

func onlyDigits(s string) string { return re(`\D`).ReplaceAllString(s, "") }

// under live.mu
func liveQueueAdd(c *change) {
	if c.queuedAt.IsZero() {
		c.queuedAt = time.Now()
	}
	live.queue = append(live.queue, c)
	live.queued[c.lineId] = true
	live.qcount[c.companyGuid]++
	liveCo(c.company).read++
}

// under live.mu
func liveCo(company string) *liveCoSt {
	cs := live.co[company]
	if cs == nil {
		cs = &liveCoSt{}
		live.co[company] = cs
	}
	return cs
}

// under live.mu: FinCom said this company is not linked, less than an hour ago
func liveNotLinkedLocked(key string) bool {
	l := live.links[key]
	return l != nil && !l.linked && nowFn().Sub(l.at) < time.Hour
}

// the company's link as the cloud said it (the tests set it too)
func liveLinkedMark(company, guid string, on bool) {
	live.mu.Lock()
	liveFresh()
	live.links[company+"|"+guid] = &liveLinkSt{linked: on, at: nowFn()}
	live.mu.Unlock()
}

// the changes waiting (copies; the tests)
func liveQueue() []change {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	out := make([]change, 0, len(live.queue))
	for _, c := range live.queue {
		out = append(out, *c)
	}
	return out
}

// --- source B: the change numbers
// after the light check (startpoint.go): when the source includes alterid and ALTVCHID is above what was received
func liveAfterLightCheck(company string, port int) {
	if postingGoing() {
		return
	}
	if sourceHas("alterid") {
		if n, err := liveSourceB(company, port); err != nil && !gaveWay(err) {
			writeLog("Recorder (Tally's change list) for " + company + ": " + cutRunes(err.Error(), 200))
		} else if n > 0 {
			writeLog(fmt.Sprintf("Recorder (Tally's change list) for %s: %d change(s) found", company, n))
		}
	}
	if sourceHas("slices") {
		if n, err := liveSourceC(company, port); err != nil && !gaveWay(err) {
			writeLog("Recorder (month slices) for " + company + ": " + cutRunes(err.Error(), 200))
		} else if n > 0 {
			writeLog(fmt.Sprintf("Recorder (month slices) for %s: %d change(s) found", company, n))
		}
	}
}

// the entries above the highest AlterID received, from the undated keep list (TDSDeskKeepList, AlterID filter):
// created when the MasterID is above every one seen, else altered; the number queued
func liveSourceB(company string, port int) (int, error) {
	cur, guid := latestNumbers(company)
	if cur == nil {
		return 0, nil
	}
	if guid == "" {
		guid = heldGUID(company)
	}
	v := toI64(cur["altvchid"])
	key := companyKey(company) + "|" + guid
	live.mu.Lock()
	liveFresh()
	st := live.b[key]
	if st == nil {
		sp, ok := startPointOf(company)
		if !ok {
			live.mu.Unlock()
			return 0, nil
		}
		// review M5: from the starting point, or the highest AlterID received since (the add-on's lines), whichever is higher
		if h := live.high[key]; h > sp {
			sp = h
		}
		st = &liveBSt{company: company, guid: guid, after: sp, seen: sp}
		live.b[key] = st
	}
	liveSkipWindows(key, &st.seen)
	above := st.seen
	if span := v - above; span > int64(keepNum("RecorderBMaxSpan", 500)) {
		// review M5: too many to ask for in one list; left to the gap check and the Day Book
		st.seen, st.after = v, v
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder (Tally's change list) for %s: too many changes for Source B (%d); the gap check and Day Book cover them", company, span))
		liveSaveOffsets()
		return 0, nil
	}
	if v <= above {
		live.mu.Unlock()
		return 0, nil // nothing above what was received
	}
	if !st.lastAsk.IsZero() && nowFn().Sub(st.lastAsk) < time.Duration(keepNum("RecorderBGapSec", 60))*time.Second {
		live.mu.Unlock()
		return 0, nil // 60 s at least between two requests
	}
	if postingGoing() || importsInFlight.Load() > 0 {
		live.mu.Unlock()
		return 0, nil // never during a posting
	}
	st.lastAsk = nowFn()
	live.mu.Unlock()
	liveSaveOffsets() // round 2 R2-9: the spacing holds across a restart after a failure
	// 2.3.1: a list stopped at 2 s, or not answered, is asked again by the shared retry schedule (retry.go); never off
	raw, err := invokeTally(recorderTC(nil), port, keepListAboveRequest(company, above), keepNum("RecorderBTimeoutSec", 5)) // review M5: 5 s
	if err != nil {
		return 0, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return 0, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	type ent struct {
		guid, date string
		mid, aid   int64
	}
	var es []ent
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		g := tagValue(m, "GUID")
		a, mid := toI64(tagNum(m, "ALTERID")), toI64(tagNum(m, "MASTERID"))
		if g == "" || a <= above || liveInWindow(key, a) { // review M4: FinCom's own postings are not foreign changes
			continue
		}
		es = append(es, ent{g, normDate(tagValue(m, "DATE")), mid, a})
	}
	sort.Slice(es, func(i, j int) bool { return es[i].aid < es[j].aid })
	live.mu.Lock()
	liveFresh()
	st = live.b[key]
	if st == nil {
		live.mu.Unlock()
		return 0, nil
	}
	n := 0
	top := st.maxMaster
	for _, e := range es {
		ev := "altered"
		if st.maxMaster > 0 && e.mid > st.maxMaster {
			ev = "created"
		}
		if e.mid > top {
			top = e.mid
		}
		if e.aid > st.seen {
			st.seen = e.aid
		}
		id := liveLineID("alterid", guid, e.guid, fmt.Sprint(e.aid))
		if live.sent[id] || live.queued[id] {
			continue
		}
		c := &change{company: company, companyGuid: guid, event: ev, guid: e.guid, masterId: fmt.Sprint(e.mid), alterId: fmt.Sprint(e.aid), vchDate: e.date,
			source: "alterid", lineId: id, saveMs: -1, readAt: nowFn(), at: nowFn().In(liveZone).Format(time.RFC3339), bKey: key, alterN: e.aid}
		if e.mid <= 0 {
			c.masterId = ""
		}
		liveQueueAdd(c)
		n++
	}
	if v > st.seen {
		st.seen = v // a deletion moves ALTVCHID with no entry to show for it
	}
	st.maxMaster = top
	live.mu.Unlock()
	liveSaveOffsets()
	return n, nil
}

// --- review M4: FinCom's own postings. A posting window in which Tally's ALTVCHID rose by exactly the entries the job
// created (nobody else changed anything meanwhile) is FinCom's own: sources B and C move past it and skip its AlterIDs
func liveAfterWindow(company, guid string, a0, a1 int64, created int) {
	if a1 <= a0 || a1-a0 != int64(created) {
		return
	}
	key := companyKey(company) + "|" + guid
	live.mu.Lock()
	liveFresh()
	w := append(live.windows[key], [2]int64{a0, a1})
	if len(w) > 50 {
		w = w[len(w)-50:]
	}
	live.windows[key] = w
	if st := live.b[key]; st != nil && st.seen >= a0 && st.seen < a1 {
		st.seen = a1
	}
	if st := live.c[key]; st != nil && st.round == nil && st.seen >= a0 && st.seen < a1 {
		st.seen = a1
	}
	if a0 >= live.high[key] {
		live.high[key] = a1 // source B's first start (review M5) begins after it too
	}
	live.mu.Unlock()
	liveSaveOffsets()
}

// under live.mu: seen moved past the clean windows that start at or below it
func liveSkipWindows(key string, seen *int64) {
	for moved := true; moved; {
		moved = false
		for _, w := range live.windows[key] {
			if *seen >= w[0] && *seen < w[1] {
				*seen, moved = w[1], true
			}
		}
	}
}

// under live.mu: an AlterID inside one of FinCom's clean posting windows
func liveInWindow(key string, a int64) bool {
	for _, w := range live.windows[key] {
		if a > w[0] && a <= w[1] {
			return true
		}
	}
	return false
}

// --- the body fetch
// next-fastfetch: the voucher with this one MasterID by the object export "ID:<MasterID>" (fastvch.go), keyed (it does not
// read every voucher of the company as FinComVoucherByMaster did, which it replaces), stripped to the approved fields
// before anything else sees it

// FinComVoucherByNumber (2.2.1, the owner's NWS144 result): a new entry Tally wrote before its save (MasterID 0, GUID
// "<company GUID>-00000000") found after the save by its type and number on its own date: one day, the body fetch's
// fields (GUID, MASTERID and ALTERID among them). "" when the type or number cannot go in a TDL string (a quote, a
// control character, empty or longer than 100)
func voucherByNumberRequest(company, date, typ, no string) string {
	if !liveNumberText(typ) || !liveNumberText(no) || len(normDate(date)) != 8 {
		return ""
	}
	return fcCollection(vchByNumberID, company, periodVars(date, date), "Voucher", liveFetchField,
		`$VoucherNumber = "`+no+`" AND $VoucherTypeName = "`+typ+`"`)
}

func liveNumberText(s string) bool {
	return s == strings.TrimSpace(s) && s != "" && len([]rune(s)) <= 100 && !strings.ContainsAny(s, "\"\x00\r\n\t") && !re(`[\x00-\x1f]`).MatchString(s)
}

func liveBodySec() int { return keepNum("RecorderBodySec", 20) }

// the vouchers Tally gives for these MasterIDs on that date: MasterID -> the voucher's XML (<VOUCHER ...>...</VOUCHER>)
func fetchVouchersByMaster(tc *TC, company string, port int, date string, mids []string) (map[string]string, error) {
	return fetchVouchersByMasterIn(tc, company, port, date, mids, liveBodySec())
}

// Tally's whole answer for a MasterID it does not have (testdata/fast234/notfound, 3.0 .. 7.1)
func fastNotFound(mid string) string {
	return "<ERRORMSG>Could not find Voucher:ID:" + mid + "!</ERRORMSG>"
}

// 2.3.4 (re-review 2 L-d; the owner's answer of 08-Oct-2026: "Delete fix: yes. The leading-zero refusal and the company
// check close real ways a delete could be proven wrongly"): a delete whose MasterID Tally did not find is proven gone only
// when Tally, asked a second time, gives exactly the same "Could not find Voucher" answer, with the company open in this
// Tally (the GUID held for it) right before and right after that ask; else not proven now (asked again later). Entry
// fetches are not asked twice (a delete only)
func fastProveGone(tc *TC, company string, port int, mid string, sec int) error {
	if err := fastCompanyOpen(tc, company, port, sec); err != nil {
		return err
	}
	x := voucherObjectRequest(company, mid)
	if x == "" {
		return errors.New("not asked: MasterID " + mid + " is not one Tally gives")
	}
	raw, err := invokeTally(tc, port, x, sec)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) != fastNotFound(mid) {
		return errors.New("Tally's answer for MasterID " + mid + " was not 'Could not find' when asked again (not proven now)")
	}
	return fastCompanyOpen(tc, company, port, sec)
}

// 2.3.4 (re-review 2 L-d): the company is open in the Tally on this port now, with the GUID this bridge holds for it (a
// company of that name with another GUID, or none held yet: not proven)
func fastCompanyOpen(tc *TC, company string, port, sec int) error {
	raw, err := invokeTally(tc, port, companiesRequest(), minI(maxI(sec, 2), 8))
	if err != nil {
		return err
	}
	want := heldGUID(company)
	for _, c := range xmlDoc(raw).All("COMPANY") {
		if companyKey(nameOf(c)) != companyKey(company) {
			continue
		}
		g := strings.TrimSpace(html.UnescapeString(nt(c, "GUID")))
		if want != "" && strings.EqualFold(g, want) {
			return nil
		}
		return errors.New("the company " + company + " is open in this Tally with another GUID (" + cutRunes(g, 60) + "); not proven now")
	}
	return errors.New("the company " + company + " is not open in this Tally (not proven now)")
}

func fetchVouchersByMasterIn(tc *TC, company string, port int, date string, mids []string, sec int) (map[string]string, error) {
	x := ""
	if len(mids) == 1 {
		x = voucherObjectRequest(company, mids[0]) // next-fastfetch: one voucher by its MasterID; the date is the line's, checked on the answer
	}
	if x == "" {
		return nil, fmt.Errorf("not asked: the entry request names exactly one MasterID (%d given)", len(mids))
	}
	if slowMarked(company, "") {
		return nil, errSlowCompany // 2.3.2: no entry request for a company marked "entry fetch stopped: over 2 s"
	}
	raw, err := invokeTally(tc, port, x, sec)
	if err != nil {
		return nil, err
	}
	// 2.3.4 (the renumbering helper's finding, 08-Oct-2026; testdata/fast234/notfound, 3.0 .. 7.1): for a MasterID it does
	// not have (a deleted voucher, an id never used) Tally answers a bare <ERRORMSG>Could not find Voucher:ID:n!</ERRORMSG>,
	// no envelope. Exactly that, for the MasterID asked and nothing else, is "no such voucher"; any other answer without an
	// envelope stays one that could not be read
	if strings.TrimSpace(raw) == fastNotFound(mids[0]) {
		return map[string]string{}, nil // a delete is proven by it only with fastProveGone (re-review 2 L-d)
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	out := map[string]string{}
	blocks := reVchBlock.FindAllString(raw, -1)
	if len(blocks) == 0 && (strings.Contains(raw, "<MASTERID") || strings.Contains(raw, "<ERRORMSG") || strings.Contains(raw, "<LINEERROR")) {
		// 2.3.4 (re-review L5): Tally answered with a voucher the bridge cannot read: never taken as "no such voucher" (a
		// delete check would take the entry as gone); held, as an answer it cannot read
		return nil, fastShapeError{"an answer FinCom cannot read"}
	}
	for _, m := range blocks {
		// next-fastfetch (the owner, 08-Oct-2026): Tally sends the whole voucher; only the approved fields are kept, here,
		// before anything is logged, stored or sent. 2.3.4 review L2: one whose lines cannot be kept whole is held
		c := cleanXML(m)
		v, why := fastStripWhy(c)
		if why == "" && v == "" {
			why = "an answer FinCom cannot read" // 2.3.4 (re-review L5): never taken as "no such voucher"
		}
		if why != "" && (tagNum(c, "MASTERID") != "" || strings.Contains(c, "<MASTERID")) {
			return nil, fastShapeError{why}
		}
		if id := tagNum(v, "MASTERID"); id != "" && v != "" {
			out[id] = v
		}
	}
	return out, nil
}

// 2.3.3: the entries of the dates after the di-th
func byDateAfter(byDate map[string][]*change, dates []string, di int) []*change {
	var out []*change
	for _, d := range dates[di+1:] {
		out = append(out, byDate[d]...)
	}
	return out
}

// one ledger by its MasterID: the ledger list's request with a one-ID range
func fetchLedgerByMaster(tc *TC, company string, port int, mid int64) (string, error) {
	raw, err := invokeTally(tc, port, ledgerChunkRequest(company, mid-1, mid), liveBodySec())
	if err != nil {
		return "", err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return "", errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	for _, m := range reLedBlock.FindAllString(raw, -1) {
		if toI64(tagNum(m, "MASTERID")) == mid {
			return cleanXML(m), nil
		}
	}
	return "", nil
}

// the ledgers a voucher names (its party and its ledger lines), each once
func voucherLedgerNames(x string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(n string) {
		n = strings.TrimSpace(html.UnescapeString(n))
		if n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	add(tagRaw(x, "PARTYLEDGERNAME"))
	for _, n := range re(tagRe("LEDGERNAME")).FindAllStringSubmatch(x, -1) {
		add(n[1])
	}
	return out
}

// the bodies of these changes (all of one company), asked of Tally as a background read: it gives way to a posting
// (those not asked yet stay so), 20 s in all at most; a failure is logged and the changes go without a body
// sp: the company's starting point (0: not known): review M3, a body is used only when it is the line's entry (its
// GUID) and its ALTERID is above the starting point
func liveFetchBodies(need []*change, sp int64, spOK bool) {
	if len(need) == 0 {
		return
	}
	company := need[0].company
	deadline := time.Now().Add(time.Duration(liveBodySec()) * time.Second)
	left := func() int { return maxI(2, int(time.Until(deadline).Seconds()+0.999)) } // review Low 12: the 20 s in all
	// review Low 9: a reason that passes (reading stopped, Tally left alone after a timeout) is not a failure: asked
	// again, 3 times at most
	passing := func(err error) bool {
		return err != nil && (errors.Is(err, errBackoff) || re(`(?i)reading .*stopped|left alone|the small check|not answer`).MatchString(err.Error()))
	}
	yield := func() bool { return postingGoing() || importsInFlight.Load() > 0 }
	// 2.3.1 (the owner's last change): a request stopped at 2 s, or not answered, never turns the entry fetch off: the shared
	// retry schedule (retry.go) asks again by itself, and the entries not asked yet wait for it (never sent without their
	// body for it); an entry whose own request was stopped 3 times goes without its body (FinCom holds the line, and this
	// bridge asks for it again as a held line, on the same schedule)
	// 2.3.3 (the owner's rule: "Silence is not acceptable"): an entry whose body is not there on its first attempt, for any
	// reason (the schedule waiting, a 2 s stop, a passing reason, the turn's time used), is never kept unsent at the queue
	// head: it goes up held at once with plain words and joins the held list, due at the next try; its body goes later as
	// "<line id>:resolved"
	tc := recorderTC(nil)
	var reached bool // 2.3.5: whether this ask's request reached Tally
	tc.sentOut = &reached
	failed := func(cs []*change, why string) {
		live.mu.Lock()
		for _, c := range cs {
			if c.guidFetch {
				liveGuidUnproven(c, why) // review H1: never sent unproven
				continue
			}
			c.bodyTried = true
			if c.heldWhy == "" {
				c.heldWhy = "the entry was not read from Tally: " + cutRunes(why, 160)
			}
			if !c.isLedger() {
				liveDecide(c, "held: "+c.heldWhy)
			}
		}
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder: the body of %d entr%s of %s was not read from Tally (%s); sent without it (FinCom holds the line until a body comes)",
			len(cs), map[bool]string{true: "y", false: "ies"}[len(cs) == 1], company, cutRunes(why, 160)))
	}
	// 2.3.2 (issue 232, c): a company marked "entry fetch stopped: over 2 s": none of its entries is asked of Tally; each
	// goes up held at once with the plain words (a cancel / delete, held as one this Tally could not be asked about)
	slowHold := func(cs []*change) {
		for _, c := range cs {
			if c.isLedger() {
				continue
			}
			if c.guidFetch {
				live.mu.Lock()
				liveGuidHold(c, slowWords)
				live.mu.Unlock()
				continue
			}
			live.mu.Lock()
			c.slowEnded = true
			live.mu.Unlock()
			liveHeldAs(c, slowWords, true)
		}
	}
	// 2.3.4 (the owner's answer B, 08-Oct-2026: "one more ask"): a line whose fast request was stopped at 2 s goes up held
	// with the once-more words and is asked ONE more time by the held list after 5 minutes; a second stop ends it
	stopOnce := func(cs []*change) {
		liveHeldStopOnce(cs)
	}
	if slowMarked(company, need[0].companyGuid) {
		slowHold(need)
		var ls []*change
		for _, c := range need {
			if c.isLedger() {
				ls = append(ls, c)
			}
		}
		if need = ls; len(need) == 0 {
			return
		}
	}
	port, err := findCompanyPortBg(company, 0)
	if err != nil {
		if yield() {
			for _, c := range need {
				if !c.isLedger() {
					liveDecide(c, "not asked: a posting is going on; asked after it")
				}
			}
			return
		}
		failed(need, err.Error())
		return
	}
	// vouchers by date, one MasterID a request (2.3.1)
	byDate := map[string][]*change{}
	var dates []string
	var ledgers []*change
	for _, c := range need {
		if c.isLedger() {
			ledgers = append(ledgers, c)
			continue
		}
		if !spOK {
			// security L6: no starting point recorded: nothing of the company's entries is asked or taken
			if c.guidFetch {
				live.mu.Lock()
				liveGuidUnproven(c, "no starting point recorded for this company")
				live.mu.Unlock()
				continue
			}
			liveDecide(c, "not asked: no starting point recorded for this company")
			live.mu.Lock()
			c.bodyTried, c.heldWhy = true, "the company's starting point is not recorded yet, so its entries are not taken from Tally"
			live.mu.Unlock()
			continue
		}
		if byDate[c.vchDate] == nil {
			dates = append(dates, c.vchDate)
		}
		byDate[c.vchDate] = append(byDate[c.vchDate], c)
	}
byDay:
	for di, d := range dates {
		cs := byDate[d]
		for len(cs) > 0 {
			part := cs[:minI(len(cs), liveMaxIDs)]
			cs = cs[len(part):]
			if time.Now().After(deadline) {
				// 2.3.1 (one entry per request): the turn's time is used; the entries not asked yet are asked in the next
				// turn, in order (the group waits at the first of them), never sent without their body for want of time
				rest := append(append([]*change{}, part...), cs...)
				for _, d2 := range dates[di+1:] {
					rest = append(rest, byDate[d2]...)
				}
				liveHeldNow(rest, fmt.Sprintf("Tally busy (this turn's %d s are used)", liveBodySec()), false, false, true)
				break byDay
			}
			// 2.3.3 (review M2): before each request, a line of the group that has waited 4 s: those not asked yet go up held
			// now (the ones read go with their bodies), so no line waits behind the others' requests
			if rest := append(append(append([]*change{}, part...), cs...), byDateAfter(byDate, dates, di)...); liveOverdue(rest) {
				liveHeldNow(rest, liveBehindWhat, false, false, true)
				break byDay
			}
			var mids []string
			for _, c := range part {
				mids = append(mids, c.masterId)
			}
			for _, c := range part {
				liveDecide(c, "asking Tally by MasterID")
			}
			reached = false
			got, err := fetchVouchersByMasterIn(tc, company, port, d, mids, left())
			if errors.Is(err, errSlowCompany) {
				rest := append(append([]*change{}, part...), cs...)
				for _, d2 := range dates[di+1:] {
					rest = append(rest, byDate[d2]...)
				}
				slowHold(rest)
				break byDay
			}
			if errors.Is(err, errRetryWait) {
				// nothing was asked: held now, due at the schedule's next try (not counted as an ask)
				rest := append(append([]*change{}, part...), cs...)
				for _, d2 := range dates[di+1:] {
					rest = append(rest, byDate[d2]...)
				}
				liveHeldNow(rest, "Tally busy", false, false, true)
				break byDay
			}
			if liveStopRefused(err, reached) {
				// 2.3.5: FinCom's read stop refused it, nothing sent: held now with the stop's words, not counted as an ask;
				// asked when reading is resumed
				rest := append(append([]*change{}, part...), cs...)
				for _, d2 := range dates[di+1:] {
					rest = append(rest, byDate[d2]...)
				}
				liveHeldNow(rest, liveReadStopWhat, false, false, true)
				break byDay
			}
			if errors.Is(err, errRecorderStop) {
				// 2.3.4 (the owner's decisions of 08-Oct-2026, option (a) and answer B): the fast request for this entry took
				// more than 2 s (the stop itself unchanged): its line goes up held ("FinCom asks once more at HH:MM") and is
				// asked once more 5 minutes later, a second stop ending it with the Day Book words; the company is not marked
				// (slowNote) and its other entries go on being fetched
				// a cancel / delete check (it asks Tally whether the entry is still there, no entry is fetched): as before, held
				// with the words of a Tally it could not ask, and asked again by the held list; the same whether the stop or no
				// answer at all came first (TestCancelGUIDTallySilentFallsBack: one outcome, never the timing's)
				var gf, en []*change
				for _, c := range part {
					if c.guidFetch {
						gf = append(gf, c)
					} else {
						en = append(en, c)
					}
				}
				if len(gf) > 0 {
					liveHeldNow(gf, liveStopWhat(), true, true, false)
				}
				stopOnce(en)
				continue
			}
			if gaveWay(err) {
				for _, c := range part {
					liveDecide(c, "not asked: a posting is going on; asked after it")
				}
				return // a posting goes first: asked again after it
			}
			if passing(err) || tallyNoAnswer(err) {
				liveHeldNow(part, "Tally busy", false, true, false) // asked again once, at the next try
				continue
			}
			if errors.Is(err, errFastShape) {
				// 2.3.4 (the independent review, L2): Tally keeps the entry in a form the strip cannot keep whole: held for
				// good with the place named (a cancel / delete: not proven here), never sent short, never asked by number
				live.mu.Lock()
				for _, c := range part {
					if c.guidFetch {
						liveGuidHold(c, map[bool]string{true: liveCancelHeldWords, false: liveDeleteHeldWords}[c.event == "cancelled"]+" ("+cutRunes(err.Error(), 160)+")")
					}
				}
				live.mu.Unlock()
				for _, c := range part {
					if !c.guidHeld {
						liveHeldAs(c, err.Error(), true)
					}
				}
				continue
			}
			if err != nil {
				failed(part, err.Error())
				continue
			}
			// 2.2.2 (the owner's rule): Tally's voucher is the line's only as liveVoucherWrong says; else the line is held
			// (2.3.4: never asked by its type and number, below)
			type miss struct {
				c         *change
				why, kind string
			}
			var missing []miss
			// 2.3.4 (re-review 2 L-d): a delete Tally did not find: proven only by fastProveGone (asked again, the company
			// checked around it); not proven now: held as one this Tally could not be asked about (asked again by itself)
			unproven := map[*change]string{}
			for _, c := range part {
				if c.guidFetch && c.event == "deleted" && got[c.masterId] == "" {
					if perr := fastProveGone(tc, company, port, c.masterId, left()); perr != nil {
						unproven[c] = perr.Error()
					}
				}
			}
			live.mu.Lock()
			for _, c := range part {
				x := got[c.masterId]
				if why, ok := unproven[c]; ok {
					liveGuidUnproven(c, why)
					continue
				}
				if c.guidFetch && c.event == "deleted" {
					liveDeleteAnswer(c, got) // review H1: still in this Tally: held; not there: proven deleted here
					continue
				}
				if why, kind := liveVoucherWrong(x, "voucher with MasterID "+c.masterId, liveWantOf(c, sp, spOK)); why != "" {
					if c.guidFetch {
						// review H1: a cancel this Tally does not show (never asked by its number, never a record's GUID)
						liveGuidHold(c, liveCancelHeldWords+" ("+cutRunes(why, 160)+")")
						continue
					}
					missing = append(missing, miss{c, why, kind})
					continue
				}
				if c.guidFetch {
					liveTakeGUID(c, x)
					continue
				}
				liveTakeBody(c, x)
			}
			live.mu.Unlock()
			for _, m := range missing {
				c := m.c
				// 2.3.4 (the independent review, L5; docs/fast-request-form.md section 5): a line whose MasterID is its entry's
				// is never asked by its type and number (a scan of the company: 12-17 s at 100,000 vouchers, Tally busy
				// meanwhile): held, as the answer said (Tally may still give it: asked again by its MasterID; another entry:
				// held for good). Only a line whose MasterID is proven NOT its entry's (review H2: Tally's voucher with it was
				// not saved after the line; the line carries the copied source's ids) is asked by its number, as a line
				// with no MasterID is
				if m.kind != wrongNoSave || c.vchNo == "" || !liveNumberText(c.vchNo) || !liveNumberText(c.vchType) || strings.Contains(m.why, "not a change after the starting point") {
					liveHeldAs(c, m.why, m.kind != wrongRetry)
					continue
				}
				if time.Now().After(deadline) {
					liveHeldAs(c, m.why+"; not asked by its type and number (20 s passed)", false)
					continue
				}
				if liveOverdue([]*change{c}) {
					liveHeldNow([]*change{c}, liveBehindWhat, false, true, false) // 2.3.3 (review M2): asked once already
					continue
				}
				w := liveWantOf(c, sp, spOK)
				w.mid = ""
				liveDecide(c, "asking Tally by type and number ("+cutRunes(m.why, 120)+")")
				reached = false
				x, why, kind, err := liveOneByNumber(tc, c.company, port, w, left())
				if errors.Is(err, errSlowCompany) {
					slowHold([]*change{c})
					continue
				}
				if errors.Is(err, errRetryWait) {
					liveHeldNow([]*change{c}, "Tally busy", false, false, true) // 2.3.3: held now, due at the next try
					continue
				}
				if liveStopRefused(err, reached) {
					liveHeldNow([]*change{c}, liveReadStopWhat, false, true, false) // 2.3.5: the stop's words; its MasterID ask reached Tally: counted
					continue
				}
				if errors.Is(err, errRecorderStop) || tallyNoAnswer(err) || passing(err) {
					liveHeldNow([]*change{c}, map[bool]string{true: liveStopWhat(), false: "Tally busy"}[errors.Is(err, errRecorderStop)], errors.Is(err, errRecorderStop), true, false)
					continue
				}
				if gaveWay(err) {
					liveDecide(c, "not asked: a posting is going on; asked after it")
					return // review L5: a posting goes first: asked again after it (the 4 s safety net holds it meanwhile)
				}
				if err != nil {
					why, kind = "asked by its type and number: "+err.Error(), wrongRetry
				}
				if x == "" {
					liveHeldAs(c, m.why+"; "+why, m.kind == wrongFinal && kind == wrongFinal)
					continue
				}
				live.mu.Lock()
				liveTakeBody(c, x)
				if m.kind == wrongNoSave && !c.idsMismatch {
					c.event = "created" // review H2: the save was not of the MasterID's voucher: a new entry, found by its number
				}
				live.mu.Unlock()
			}
		}
	}
	for li, c := range ledgers {
		if time.Now().After(deadline) {
			failed([]*change{c}, "20 s passed")
			continue
		}
		// 2.3.3 (re-review: M2 for ledger lines): before each request, once a line of the group has waited 4 s, the ledgers
		// not read yet go without their body (as the safety net sends them), so they hold back no line
		if rest := ledgers[li:]; liveOverdue(rest) {
			live.mu.Lock()
			for _, r := range rest {
				r.bodyTried = true
				if r.heldWhy == "" {
					r.heldWhy = liveLedgerLateWhy
				}
			}
			live.mu.Unlock()
			break
		}
		x, err := fetchLedgerByMaster(tc, company, port, toI64(c.masterId))
		if gaveWay(err) || errors.Is(err, errRetryWait) {
			return
		}
		if err != nil || x == "" {
			failed([]*change{c}, or(errText(err), "Tally gave no ledger with that MasterID"))
			continue
		}
		live.mu.Lock()
		c.xml, c.bodyTried = x, true
		if n := strings.TrimSpace(html.UnescapeString(group(`<LEDGER(?:\s[^>]*?)?\sNAME="([^"]*)"`, x, 1))); n != "" {
			c.name = n
		}
		if p := tagValue(x, "PARENT"); p != "" {
			c.parent = p
		}
		if g := tagValue(x, "GUID"); g != "" {
			c.guid = g
		}
		live.mu.Unlock()
	}
	if !retryHeld() && !yield() {
		liveCancelCounters(tc, company, port, need)
	}
}

// re-review M-B (06-Oct-2026): the cancels of this group that go with Tally's GUID but without an AlterID carry Tally's
// voucher counter now (ALTVCHID, the existing FinComCompany request, one for the group): FinCom cancels again only a body
// of that GUID at or below it (migration 57); a later change in Tally stays live. A delete carries none (always deleted
// again: Tally never brings a deleted GUID back). Not read: the cancel goes without it (FinCom then cancels again at most once)
func liveCancelCounters(tc *TC, company string, port int, cs []*change) {
	var need []*change
	live.mu.Lock()
	for _, c := range cs {
		if c.event == "cancelled" && toI64(onlyDigits(c.alterId)) <= 0 && c.guid != "" && !c.guidHeld && !c.guidFetch && c.vchCounter == 0 {
			need = append(need, c)
		}
	}
	live.mu.Unlock()
	if len(need) == 0 || port == 0 {
		return
	}
	if _, given, err := companyCheckNumbers(tc, company, port); err != nil || !given {
		return
	}
	n := companyAlter(company)
	if n <= 0 {
		return
	}
	live.mu.Lock()
	for _, c := range need {
		c.vchCounter = n
	}
	live.mu.Unlock()
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// --- the uploader
var importGaps atomic.Int64 // grows after every import request (post.go): a gap between imports is one value of it

// one line as the cloud's recorder_lines takes it (index.ts)
func (c *change) wire() M {
	var alter any
	if a := toI64(onlyDigits(c.alterId)); a > 0 {
		alter = a
	}
	ls := []any{}
	for _, n := range c.ledgers {
		ls = append(ls, M{"name": n, "guid": ""})
	}
	// review H1: a FinCom id goes as the entry's only when Tally's body carries it (or FinCom's own import, its ids
	// agreeing, not fetched); a created entry's, a mismatched line's, or one the body does not carry goes as lineFid
	fid, lineFid := c.fid, c.lineFid
	if fid != "" && (c.idsMismatch || (c.fetchesIds() && (c.event == "created" || c.xml == "" ||
		!strings.Contains(html.UnescapeString(tagRaw(c.xml, "NARRATION")), "TDSDesk:"+fid)))) {
		fid, lineFid = "", fid
	}
	narr := c.narr
	if lineFid != "" {
		narr = liveNoTag(narr) // second review L-C: the cloud would take the id from the narration's tag
	}
	m := M{"line_id": c.lineId, "event": c.event, "object_guid": c.guid, "master_id": c.masterId, "alter_id": alter, "vch_type": c.vchType, "vch_no": c.vchNo,
		"vch_date": c.vchDate, "saved_at": c.at, "pc": liveComputerFn(), "user": c.user, "company_guid": c.companyGuid, "ledgers": ls, "narration": narr,
		"fid": fid, "xml": c.xml, "source": c.source,
		// next-outbox: always there (FinCom knows by it that this bridge marks its deliberate resends): "" on a first send
		"again": c.again}
	if c.event == "cancelled" && alter == nil && c.vchCounter > 0 {
		m["vch_counter"] = c.vchCounter // re-review M-B: FinCom cancels again only a body at or below it
	}
	// 2.3.1: FinCom passes the body's blanks as sent (the owner's "full", 06-Oct-2026); false on every other line (one shape)
	m["full"] = c.full && c.xml != ""
	if lineFid != "" {
		m["lineFid"] = lineFid
	}
	if !c.readAt.IsZero() {
		m["received_at"] = c.readAt.In(liveZone).Format(time.RFC3339) // 2.2.1: the bridge's own clock when it read the line
	}
	if c.saveMs >= 0 {
		m["save_ms"] = c.saveMs
	}
	if c.isLedger() || c.isMaster() {
		m["name"], m["parent"] = c.name, c.parent
	}
	if c.isMaster() {
		m["master_type"] = c.masterType // next-masterhook: heads only
	}
	// 2.2.2: the line's GUID that is not its MasterID's, for information only (never the entry's: the cloud must not mark
	// the line duplicate on it); why the line goes without its entry
	if c.idsMismatch {
		m["idsMismatch"], m["lineGuid"] = true, c.lineGuid
	}
	if c.heldWhy != "" && c.xml == "" {
		m["heldWhy"] = liveCapWhy(c.heldWhy)
	}
	// review H1: a cancel / delete this bridge's Tally does not show happened here: FinCom's cloud keeps it held and never
	// looks in its own record for its GUID
	if c.guidHeld {
		m["guidHeld"] = true
	}
	// security L2: a line too big for one call goes cut and marked, never blocking the feed
	if len(jsonText(m)) > liveMaxBytes-(16<<10) {
		// second review L-C: no entry ids and no FinCom id with it (nothing of it can be matched or built)
		m["xml"], m["ledgers"], m["narration"], m["oversize"], m["object_guid"] = "", []any{}, cutRunes(liveNoTag(c.narr), 1000), true, ""
		m["full"] = false
		if fid != "" {
			m["fid"], m["lineFid"] = "", fid
		}
		m["heldWhy"] = "the entry is larger than FinCom takes in one line; upload that day's Day Book to settle it"
	}
	return m
}

// the call for one group of one company
func liveRecorderLinesBody(company, guid string, group []*change) M {
	lines := make([]any, 0, len(group))
	for _, c := range group {
		lines = append(lines, c.wire())
	}
	return M{"kind": "recorder_lines", "company": company, "company_guid": guid, "lines": lines}
}

// next-outbox: the results FinCom answered "already have" (a repeat of a line it holds: migration 63)
func liveAlreadyCount(res []any) int {
	n := 0
	for _, x := range res {
		if truthy(obj(x)["already"]) {
			n++
		}
	}
	return n
}

// the failed answers after which a line counts as "could not be stored in FinCom" (sent every 30 minutes, in the beat)
func liveFailedTries() int { return keepNum("RecorderFailedTries", 12) }

// one step of the uploader: one group sent (its number of lines), or 0
func liveUploadOnce() int {
	liveUpMu.Lock()
	defer liveUpMu.Unlock()
	defer liveMidSaveSoon() // 2.3.0: the record of Tally's GUIDs, when Tally gave any (2.3.1: at most every 30 s)
	// 2.2.1: lines sent held, resolved once Tally gives their entry. 2.3.3 (fairness; review M1): while live lines wait,
	// they go first and the resolver after them; the resolver stops before each ask when a live line waits (liveQueueReady),
	// so a save waits at most for the one ask already at Tally
	first := !liveQueueReady()
	if first {
		liveResolveTurn()
	}
	n := 0
	for i := 0; i < 8; i++ {
		m, again := liveUploadStep()
		n = m
		if !again {
			break
		}
	}
	if !first {
		liveResolveTurn()
	}
	// next-renumber: the entries Tally renumbered after an insert or a delete (renumber.go), when no save waits
	if !liveQueueReady() {
		n += renumTurn()
	}
	// next-bankdate: the entries Tally changed with no add-on line (a bank date set), when no save waits (bankdate.go)
	if !liveQueueReady() {
		n += bankTurn()
	}
	return n
}

// 2.3.3 (review M1): a line read from Tally's add-on in the queue that can go now (its company not in the cloud's back-off,
// not a new entry's line still waiting for its first ask by number; the resolver's own ":resolved" lines do not count)
func liveQueueReady() bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	now := nowFn()
	for _, c := range live.queue {
		if b, had := live.back[c.key()]; had && now.Before(b.until) {
			continue
		}
		if strings.HasSuffix(c.lineId, ":resolved") || c.source == "renumber" || c.source == "bankdate" {
			continue
		}
		if liveYoung(c) {
			continue
		}
		return true
	}
	return false
}

// 2.3.3 (review M2): one of these lines has waited RecorderHoldAfterMs (4 s) for its body: the ones not asked yet go up
// held now, before the next request to Tally
func liveOverdue(cs []*change) bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, c := range cs {
		if c.needsBody() && !c.queuedAt.IsZero() && time.Since(c.queuedAt) >= liveHoldAfter() {
			return true
		}
	}
	return false
}

// the words of a line held because the entries saved before it are being read (review M2)
const liveBehindWhat = "Tally busy (reading the entries saved before it)"

// 2.3.5: a line held because FinCom's read stop refused its request ("waiting: <this>; asked again when it is resumed")
const liveReadStopWhat = "reading from Tally is stopped from FinCom"

// 2.3.5: the read stop's own refusal, with nothing of this ask sent to Tally (reached: tc.sentOut): not a try. Any other
// failure (a 2 s stop, no answer, a closed connection, an empty answer), or a refusal after a request reached Tally, counts
func liveStopRefused(err error, reached bool) bool {
	return !reached && errors.Is(err, errReadStopped)
}

// a ledger line that goes without its body after the 4 s (the safety net, review M2)
const liveLedgerLateWhy = "the ledger was not read from Tally in time; FinCom takes it from the next ledger list"

// 2.3.3: a line in the queue still waits for its body (not asked yet)
func liveQueueWantsBody() bool {
	live.mu.Lock()
	defer live.mu.Unlock()
	for _, c := range live.queue {
		if c.needsBody() && !c.isLedger() {
			return true
		}
	}
	return false
}

// 2.3.3 (under live.mu): a line that waits for its body without blocking anything yet: a new entry's line before its
// first ask by number (a few seconds after the line: RecorderNumberWaitMs)
func liveYoung(c *change) bool {
	return c.needsBody() && c.byNumber && time.Now().Before(c.askAfter)
}

// 2.3.3: the safety net: no line waits unsent longer than RecorderHoldAfterMs (4 s) for its body, whatever the reason (a
// posting going on, a ledger Tally did not give): it goes up held with plain words, or (a ledger) without its body
func liveHoldAfter() time.Duration {
	return time.Duration(keepNumZero("RecorderHoldAfterMs", 4000)) * time.Millisecond
}

// under live.mu: a company not linked: its waiting lines leave the queue, counted (review H1)
func liveDropCompany(key string) int {
	n := 0
	q := live.queue[:0]
	for _, c := range live.queue {
		if c.key() == key {
			n++
			delete(live.queued, c.lineId)
			live.qcount[c.companyGuid]--
			liveCo(c.company).skipped++
			continue
		}
		q = append(q, c)
	}
	for i := len(q); i < len(live.queue); i++ {
		live.queue[i] = nil
	}
	live.queue = q
	return n
}

// review H1: FinCom said the company is not linked (409 notLinked): its lines are skipped for an hour, then asked again
func liveNotLinked(key, company string) {
	live.mu.Lock()
	live.links[key] = &liveLinkSt{linked: false, at: nowFn()}
	n := liveDropCompany(key)
	delete(live.back, key)
	live.mu.Unlock()
	writeLog(fmt.Sprintf("Recorder: %s is not linked to a FinCom client: its lines are skipped (%d now; nothing of it is asked of Tally or sent; asked again in an hour)", company, n))
	liveSaveOffsets()
}

// one step: a group sent (its lines), or 0; again: try the next step at once (a company found not linked, or linked)
func liveUploadStep() (int, bool) {
	if !cloudOn() || importsInFlight.Load() > 0 {
		return 0, false
	}
	posting := postingGoing()
	gap := importGaps.Load()
	live.mu.Lock()
	liveFresh()
	if posting {
		live.lastPost = time.Now()
		if live.gapSet && live.gap == gap {
			live.mu.Unlock()
			return 0, false // one group per gap between imports
		}
	} else {
		live.gapSet = false
	}
	now := nowFn()
	key, head := "", (*change)(nil)
	young := map[string]bool{} // 2.3.3: a company whose first line waits for its first ask: the next company goes
	for _, c := range live.queue {
		if b, had := live.back[c.key()]; had && now.Before(b.until) {
			continue
		}
		if young[c.key()] {
			continue
		}
		if liveYoung(c) {
			young[c.key()] = true
			continue
		}
		if now.Before(c.retryAt) {
			continue // 2.4.0 part 2 review M1: answered failed, sent again after its wait
		}
		key, head = c.key(), c
		break
	}
	if key == "" {
		live.mu.Unlock()
		return 0, false
	}
	if liveNotLinkedLocked(key) {
		liveDropCompany(key)
		live.mu.Unlock()
		return 0, true
	}
	if l := live.links[key]; l == nil || !l.linked {
		// review H1: is the company linked? An empty recorder_lines call (nothing of the company goes) before any body
		// is asked of Tally or any line sent
		company, guid := head.company, head.companyGuid
		live.mu.Unlock()
		r := invokeCloud(M{"kind": "recorder_lines", "company": company, "company_guid": guid, "lines": []any{}}, 30)
		switch {
		case r.code == 409 && r.json != nil && truthy(r.json["notLinked"]):
			liveNotLinked(key, company)
			return 0, true
		case r.code == 200:
			liveLinkedMark(company, guid, true)
			return 0, true
		}
		live.mu.Lock()
		b := live.back[key]
		b.n++
		b.until = nowFn().Add(time.Duration(math.Min(1800, float64(keepNum("RecorderRetrySec", 30))*math.Pow(2, float64(b.n)))) * time.Second)
		live.back[key] = b
		liveCo(company).lastError = or(r.err, fmt.Sprint("HTTP ", r.code))
		live.mu.Unlock()
		return 0, false
	}
	var group []*change
	size := 600
	for _, c := range live.queue {
		if c.key() != key || now.Before(c.retryAt) {
			continue
		}
		s := len(jsonText(c.wire())) + 1
		if len(group) >= liveMaxLines || (len(group) > 0 && size+s > liveMaxBytes-(16<<10)) {
			break
		}
		group = append(group, c)
		size += s
	}
	var need, byNumber []*change
	for _, c := range group {
		if c.needsBody() {
			if posting && !c.isLedger() {
				liveDecide(c, "not asked: a posting is going on; asked after it")
			}
			if c.byNumber {
				if !time.Now().Before(c.askAfter) {
					byNumber = append(byNumber, c)
				}
				continue
			}
			need = append(need, c)
		}
	}
	live.mu.Unlock()
	if len(byNumber) > 0 && !posting {
		sp, spOK := startPointOf(byNumber[0].company)
		liveFetchByNumber(byNumber, sp, spOK)
	}
	if len(need) > 0 && !posting {
		// review M3: an entry not above the company's starting point is not taken. 2.2.2 (the owner's rule): by Tally's
		// own ALTERID only (liveVoucherWrong), never the line's
		sp, spOK := startPointOf(need[0].company)
		liveFetchBodies(need, sp, spOK)
	}
	// 2.3.3 (the safety net): a line still without its body after RecorderHoldAfterMs goes up now, held with plain words (a
	// voucher) or without its body (a ledger); never kept unsent at the head
	var late, lateLed []*change
	live.mu.Lock()
	for _, c := range group {
		if c.needsBody() && !c.queuedAt.IsZero() && time.Since(c.queuedAt) >= liveHoldAfter() {
			if c.isLedger() {
				lateLed = append(lateLed, c)
			} else {
				late = append(late, c)
			}
		}
	}
	live.mu.Unlock()
	if len(late) > 0 {
		what := "Tally busy"
		if posting || postingGoing() {
			what = "FinCom is posting to Tally"
		}
		liveHeldNow(late, what, false, false, true)
	}
	for _, c := range lateLed {
		live.mu.Lock()
		c.bodyTried = true
		if c.heldWhy == "" {
			c.heldWhy = liveLedgerLateWhy
		}
		live.mu.Unlock()
	}
	// a change whose body is still to be asked holds the group there (the order is kept)
	live.mu.Lock()
	due := false // the one holding it is to be asked again now (by its type and number, no wait set)
	for i, c := range group {
		if c.needsBody() {
			due = c.byNumber && !time.Now().Before(c.askAfter) && !posting && !postingGoing()
			group = group[:i]
			break
		}
	}
	// 2.3.0: a delete's GUID from the bridge's record, now that the lines before it in the group took Tally's entry
	// (review H1: only a delete this bridge's Tally answered is gone; anything else is held there)
	for _, c := range group {
		if c.guidLate {
			c.guidLate = false
			liveGuidFallback(c, "")
		}
	}
	company, guid := "", ""
	if len(group) > 0 {
		company, guid = group[0].company, group[0].companyGuid
	}
	// the bodies may have made it larger: still under 1 MB
	for len(group) > 1 && len(jsonText(liveRecorderLinesBody(company, guid, group))) > liveMaxBytes-(8<<10) {
		group = group[:len(group)/2]
	}
	body := liveRecorderLinesBody(company, guid, group)
	live.mu.Unlock()
	if len(group) == 0 || importsInFlight.Load() > 0 {
		return 0, due && len(group) == 0
	}
	if liveSendHook != nil {
		liveSendHook()
	}
	r := invokeCloud(body, 30)
	if r.code == 409 && r.json != nil && truthy(r.json["notLinked"]) {
		liveNotLinked(key, company)
		return 0, true
	}
	ok := r.code == 200 && r.json != nil && (r.json["results"] != nil || r.json["queued"] != nil)
	live.mu.Lock()
	cs := live.co[company]
	if cs == nil {
		cs = &liveCoSt{}
		live.co[company] = cs
	}
	if !ok {
		b := live.back[key]
		b.n++
		w := math.Min(1800, float64(keepNum("RecorderRetrySec", 30))*math.Pow(2, float64(b.n)))
		b.until = nowFn().Add(time.Duration(w) * time.Second)
		live.back[key] = b
		why := or(r.err, fmt.Sprint("HTTP ", r.code))
		if r.code == 200 {
			why = "the answer had neither results nor queued"
		}
		cs.lastError = why
		first := b.n == 1
		live.mu.Unlock()
		if first {
			writeLog(fmt.Sprintf("Recorder: %d line(s) of %s not taken by FinCom (%s); tried again in %ds, nothing is lost", len(group), company, cutRunes(why, 160), int(w)))
		}
		return 0, false
	}
	// next-outbox: lines FinCom had already (sent before a restart, its answer lost): marked sent like the rest
	if n := liveAlreadyCount(arr(r.json["results"])); n > 0 {
		writeLog(fmt.Sprintf("Recorder: %d line(s) of %s FinCom had already (sent before, its answer not kept here): marked sent, not stored again", n, company))
	}
	// 2.4.0 part 2 review M1: a line FinCom answered 'failed' (a lock timeout, a deadlock), or left without a result, is
	// not marked sent: it stays on the PC and goes again after its wait (every 30 minutes from RecorderFailedTries on, never
	// given up, carried by the beat); the other lines of the group are marked sent
	res := map[string]M{}
	for _, x := range arr(r.json["results"]) {
		if id := str(obj(x)["line_id"]); id != "" {
			res[id] = obj(x)
		}
	}
	maxTries := liveFailedTries()
	var keep, stuck []*change
	// an answer {queued: n} with no results at all (a cloud before round 20 answered so): every line queued, as before
	if r.json["results"] != nil || r.json["queued"] == nil {
		g2 := group[:0:0]
		for _, c := range group {
			x, had := res[c.lineId]
			if st := str(x["state"]); had && st != "" && st != "failed" {
				g2 = append(g2, c)
				continue
			}
			c.failN++
			if c.failN == 1 {
				c.failSince = nowFn()
			}
			c.failWhy = "no result for the line"
			if had {
				c.failWhy = or(str(x["why"]), "failed")
			}
			if c.failN == maxTries {
				stuck = append(stuck, c)
			}
			w := math.Min(1800, float64(keepNum("RecorderRetrySec", 30))*math.Pow(2, float64(c.failN)))
			if c.failN >= maxTries {
				w = 1800 // kept, never given up: every 30 minutes, no more often
			}
			c.retryAt = nowFn().Add(time.Duration(w) * time.Second)
			keep = append(keep, c)
		}
		group = g2
	}
	sentIDs := make([]string, 0, len(group))
	var bodied, items, ledAgain, ended, mine []string
	var signs []*renumJob // next-renumber: an insert's or a delete's line FinCom took (renumber.go)
	gone := map[*change]bool{}
	var held []*change
	for _, c := range group {
		gone[c] = true
		live.sent[c.lineId] = true
		delete(live.queued, c.lineId)
		live.qcount[c.companyGuid]--
		sentIDs = append(sentIDs, c.lineId)
		for _, a := range c.also {
			live.sent[a] = true
			delete(live.queued, a)
			sentIDs = append(sentIDs, a)
		}
		if strings.HasSuffix(c.lineId, ":resolved") {
			if live.mine == nil {
				live.mine = map[string]bool{}
			}
			mine = append(mine, c.lineId) // 2.3.4 re-review 2 (N-M1): resolved by this version, body or not
			live.mine[c.lineId] = true
		}
		if c.xml != "" && !c.isLedger() && strings.HasSuffix(c.lineId, ":resolved") {
			items = append(items, c.lineId) // 2.3.1 review H1: a resolution sent by this version
			live.items231[c.lineId] = true
			if c.ledAgain {
				ledAgain = append(ledAgain, c.lineId) // 2.3.1 (masters): sent once more, never again
				live.ledAgain[c.lineId] = true
			}
		}
		if c.xml != "" && !c.isLedger() {
			bodied = append(bodied, c.lineId)
			bodied = append(bodied, c.also...)
			for _, id := range append([]string{c.lineId}, c.also...) {
				live.bodied[id] = true
			}
		}
		if c.event == "created" && !c.isLedger() && c.vchNo != "" {
			live.created[c.saveKey()] = [2]string{c.lineId, c.guid}
		}
		if j := renumSignOf(c); j != nil {
			signs = append(signs, j)
		}
		// 2.2.1: sent held (no body, no GUID): resolved later (recorder_resolve.go). 2.2.2: every voucher of the add-on
		// sent without its entry, not only a new one with a number
		if c.slowEnded {
			// 2.3.2 (issue 232): sent held with the Day Book words (its company marked, or its asks timed out 3 times): ended,
			// never asked or sent again
			if id := strings.TrimSuffix(c.lineId, ":resolved"); !live.ended[id] {
				ended = append(ended, id)
				liveEndedNote(id)
			}
			continue
		}
		if c.fetchesIds() && c.source == "addon" && c.xml == "" && c.vchDate != "" && !strings.HasSuffix(c.lineId, ":resolved") {
			held = append(held, c)
		}
		// the owner's addition to H1: a cancel / delete held only because this Tally could not be asked then: asked again
		if c.guidRetry && c.masterId != "" && c.vchDate != "" && !strings.HasSuffix(c.lineId, ":resolved") {
			held = append(held, c)
		}
	}
	q := live.queue[:0]
	for _, c := range live.queue {
		if !gone[c] {
			q = append(q, c)
		}
	}
	for i := len(q); i < len(live.queue); i++ {
		live.queue[i] = nil
	}
	live.queue = q
	delete(live.back, key)
	cs.sent += len(group)
	cs.lastError, cs.last = "", nowS()
	if len(keep) > 0 {
		cs.lastError = fmt.Sprintf("%d line(s) answered failed by FinCom (%s); sent again", len(keep), cutRunes(keep[0].failWhy, 120))
	}
	if posting {
		live.gapSet, live.gap = true, gap
	}
	live.mu.Unlock()
	liveSaveSent(sentIDs)
	liveSaveIds(bodied, ".body.txt")
	liveSaveIds(items, liveItemsSuffix)
	liveSaveIds(ledAgain, liveLedgerSuffix)
	liveSaveIds(ended, liveEndedSuffix)
	liveSaveIds(ended, liveFastSuffix)
	liveSaveIds(mine, liveMineSuffix)
	liveSaveOffsets()
	liveHeldAdd(held)
	liveGuidAnswers(group, arr(r.json["results"])) // 2.3.0: what FinCom's record said of a delete / cancel sent without a GUID
	renumNote(signs)
	for _, c := range keep {
		if c.failN < maxTries {
			writeLog(fmt.Sprintf("Recorder: line %s of %s: FinCom answered %s (try %d); kept here and sent again at %s, nothing is lost",
				cutRunes(c.lineId, 40), company, cutRunes(c.failWhy, 160), c.failN, c.retryAt.Format("15:04:05")))
		}
	}
	for _, c := range stuck {
		writeLog(fmt.Sprintf("Recorder: line %s of %s could not be stored in FinCom since %s (%d tries: %s); kept here, sent again every 30 minutes, shown in FinCom under Needs you",
			cutRunes(c.lineId, 40), company, c.failSince.In(liveZone).Format("15:04"), c.failN, cutRunes(c.failWhy, 160)))
	}
	return len(group), false
}

// --- the touched-ledger hook: the ledgers named by lines read during a posting, handed over once after the last job
// ends (RecorderTouchedQuietMs, 5 s, with no posting). The check itself (ledger closings) is not built and stays off
var touchedLedgerHookFn = func(company string, names []string) {
	writeLog("Touched ledgers after the posting in " + company + ": " + strings.Join(names, ", ") + " (the ledger check is not built; it is off)")
}

// under live.mu
func liveTouch(company, name string) {
	if live.touched[company] == nil {
		live.touched[company] = map[string]bool{}
	}
	live.touched[company][name] = true
}

func liveTouchedTick() {
	posting := postingGoing()
	live.mu.Lock()
	liveFresh()
	if posting {
		live.lastPost = time.Now()
		live.mu.Unlock()
		return
	}
	quiet := time.Duration(keepNum("RecorderTouchedQuietMs", 5000)) * time.Millisecond
	if len(live.touched) == 0 || time.Since(live.lastPost) < quiet {
		live.mu.Unlock()
		return
	}
	t := live.touched
	live.touched = map[string]map[string]bool{}
	live.mu.Unlock()
	var cos []string
	for c := range t {
		cos = append(cos, c)
	}
	sort.Strings(cos)
	for _, c := range cos {
		var ns []string
		for n := range t[c] {
			ns = append(ns, n)
		}
		sort.Strings(ns)
		touchedLedgerHookFn(c, ns)
	}
}

// --- the beat: per company, lines read and sent (this run), waiting, the oldest waiting, the source and the cloud's
// last refusal
func liveBeat() M {
	src := recorderSource()    // before live.mu: it takes it to read the owner's choice
	asking := liveHeldAsking() // 2.3.3: before live.mu (the held list's lock comes first)
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	out := M{}
	waiting, oldest := map[string]int{}, map[string]time.Time{}
	stuckN, stuckAt, stuckDay := map[string]int{}, map[string]time.Time{}, map[string]string{}
	maxTries := liveFailedTries()
	for _, c := range live.queue {
		waiting[c.company]++
		if o, had := oldest[c.company]; !had || c.readAt.Before(o) {
			oldest[c.company] = c.readAt
		}
		// the coordinator, 08-Oct-2026: the lines FinCom answered failed RecorderFailedTries times or more (kept, sent every
		// 30 minutes): how many, since when (the oldest's first failed answer), and that one's day (its entry's date)
		if c.failN >= maxTries {
			stuckN[c.company]++
			if o, had := stuckAt[c.company]; !had || c.failSince.Before(o) {
				stuckAt[c.company] = c.failSince
				d := onlyDigits(c.vchDate)
				if len(d) == 8 {
					stuckDay[c.company] = d[:4] + "-" + d[4:6] + "-" + d[6:]
				} else {
					stuckDay[c.company] = c.readAt.In(liveZone).Format("2006-01-02")
				}
			}
		}
	}
	for co, cs := range live.co {
		e := M{"read": cs.read, "sent": cs.sent, "waiting": waiting[co], "oldestWaiting": "", "source": src, "lastSent": cs.last, "lastError": cs.lastError}
		if cs.skipped > 0 {
			e["notLinked"], e["skipped"] = true, cs.skipped
			e["words"] = fmt.Sprintf("not linked: %d lines skipped", cs.skipped)
		}
		if o, had := oldest[co]; had {
			e["oldestWaiting"] = o.Format("2006-01-02T15:04:05")
		}
		e["heldAsking"] = asking[co] // 2.3.3: the held lines of the company being asked of Tally again
		e["stuck"] = stuckN[co]
		if n := stuckN[co]; n > 0 {
			e["stuckSince"], e["stuckDay"] = stuckAt[co].In(liveZone).Format("2006-01-02T15:04:05"), stuckDay[co]
		}
		out[co] = e
	}
	for co, n := range asking {
		if out[co] == nil {
			out[co] = M{"read": 0, "sent": 0, "waiting": 0, "oldestWaiting": "", "source": src, "lastSent": "", "lastError": "", "heldAsking": n}
		}
	}
	return out
}

// 2.3.3: per company, the held lines still being asked of Tally again (not final, not ended)
func liveHeldAsking() map[string]int {
	heldMu.Lock()
	_, items := liveHeldLoad()
	heldMu.Unlock()
	live.mu.Lock()
	liveFresh()
	out := map[string]int{}
	for id, h := range items {
		if h.Final || (live.ended[id] && !h.FastAgain) || h.Tries >= liveHeldMaxTries || h.Asked >= h.allow() {
			continue
		}
		out[h.Company]++
	}
	live.mu.Unlock()
	return out
}

// 2.3.3: the Tally page's one line while lines wait to go to FinCom (the oldest read RecorderWaitWordsSec, 30 s, ago or
// more): "2 changes of X waiting to go to FinCom (oldest since 12:14); 40 held entries being asked of Tally again"; ""
// when none wait
func liveQueueWaitWords() string {
	asking := liveHeldAsking()
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	n, oldest := map[string]int{}, map[string]time.Time{}
	var cos []string
	for _, c := range live.queue {
		if n[c.company] == 0 {
			cos = append(cos, c.company)
		}
		n[c.company]++
		if o, had := oldest[c.company]; !had || c.readAt.Before(o) {
			oldest[c.company] = c.readAt
		}
	}
	after := time.Duration(keepNumZero("RecorderWaitWordsSec", 30)) * time.Second
	var parts []string
	for _, co := range cos {
		if nowFn().Sub(oldest[co]) < after {
			continue
		}
		w := fmt.Sprintf("%d change%s of %s waiting to go to FinCom (oldest since %s)", n[co], map[bool]string{true: "", false: "s"}[n[co] == 1], co, oldest[co].Format("15:04"))
		if a := asking[co]; a > 0 {
			w += fmt.Sprintf("; %d held entr%s being asked of Tally again", a, map[bool]string{true: "y", false: "ies"}[a == 1])
		}
		parts = append(parts, w)
	}
	return strings.Join(parts, "; ")
}

// review M8: the add-on's file names the reader has seen in the last 31 days (at most 50), for the beat
func liveFilesSeen() []any {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	var ns []string
	for n := range live.files {
		ns = append(ns, n)
	}
	sort.Strings(ns)
	if len(ns) > 50 {
		ns = ns[len(ns)-50:]
	}
	return toAny(ns)
}

// --- the loop: the uploader and the hook, every quarter second while the bridge runs (the reader is the 1 s watch)
func recorderLiveLoop() {
	for !stopping() {
		func() {
			defer func() {
				if r := recover(); r != nil {
					writeLog(fmt.Sprint("Recorder: ", r))
				}
			}()
			for i := 0; i < 20 && liveUploadOnce() > 0; i++ {
			}
			liveTouchedTick()
			bankNightTurn() // next-bankdate: the nightly check (nothing outside the night's window)
		}()
		sleepOrStop(250 * time.Millisecond)
	}
}

// the day a daily file's name gives (yyyymmdd; "" when its name carries none): yyyymmdd, yyyy-mm-dd or d-Mon-yy
// (next-userfile: with or without the Windows user after it, userfile.go)
func liveFileDay(name string) string {
	d, _ := liveFileDayUser(name)
	return d
}
