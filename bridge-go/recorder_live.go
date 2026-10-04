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
// (FinComVoucherByMaster: up to 50 MasterIDs, the line's own date as the period; the one dated request allowed with
// ReadDays off, tally.go); a ledger created or altered by the ledger list's request with a one-ID range. A background
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
	liveAddonName  = "FinComRecorder.tdl"    // the live add-on (addon/), written beside the trial's by the install step
	vchByMasterID  = "FinComVoucherByMaster" // the body fetch's request id (allowlist.go)
	liveMaxIDs     = 50                      // MasterIDs per body fetch
	liveMaxLines   = 500                     // lines per recorder_lines call (the cloud's MAX_RECORDER_LINES)
	liveMaxBytes   = 1 << 20                 // bytes per recorder_lines call
	liveReadMax    = 1 << 20                 // bytes read from one file per turn
	liveQueueMax   = 20000                   // changes waiting in memory; the files are read on once they go
	liveFetchField = "GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, ISCANCELLED, ISOPTIONAL, " +
		"ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, " +
		"ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD"
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
}

func (c *change) key() string { return c.company + "|" + c.companyGuid }

func (c *change) isLedger() bool { return strings.HasPrefix(c.event, "ledger_") }

// the body is asked of Tally: created, altered or imported entries that are not FinCom's own (their body is FinCom's
// posted XML, in the cloud), and ledgers created or altered; each needs its MasterID
func (c *change) needsBody() bool {
	if c.masterId == "" || c.bodyTried {
		return false
	}
	switch c.event {
	case "created", "altered", "imported":
		return c.fid == "" && c.vchDate != ""
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
}

type livePending struct {
	l          recLine
	start, end int64
	seen       time.Time
}

type liveBSt struct {
	company, guid          string
	after, seen, maxMaster int64
	// the owner's rule (04-Oct): off by itself after a list that took more than 2 s (persisted; back on only when the
	// owner switches the source to another value than offBeat, the beat's value in force when it stopped); lastAsk:
	// 60 s at least between two requests
	off                    bool
	offSecs                float64
	offAt, offWhy, offBeat string
	lastAsk                time.Time
}

type liveCoSt struct {
	read, sent      int
	lastError, last string
}

type liveState struct {
	mu       sync.Mutex
	dir      string // the sync folder this state belongs to ("" : not loaded)
	files    map[string]*liveFileSt
	pending  map[string]*livePending // file -> the first half of a pair waiting for its second
	queue    []*change
	queued   map[string]bool
	sent     map[string]bool
	b        map[string]*liveBSt
	co       map[string]*liveCoSt
	back     map[string]keepBack
	gapSet   bool
	gap      int64
	touched  map[string]map[string]bool
	lastPost time.Time
	logged   map[string]bool
}

var (
	live           = &liveState{}
	liveUpMu       sync.Mutex
	liveSrc        atomic.Value // the beat's recorderSource ("" : the setting's)
	liveSendHook   func()       // the tests: called right before a group goes
	liveComputerFn = computerName
	liveZone       = time.Local // the add-on's time text is the PC's local time
)

// a restart, as far as the live recorder is concerned (the tests; the state reloads from disk at its next use)
func liveResetState() {
	live.mu.Lock()
	live.dir = ""
	live.mu.Unlock()
	liveSrc.Store("")
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
	live.touched, live.logged, live.gapSet, live.lastPost = map[string]map[string]bool{}, map[string]bool{}, false, time.Time{}
	o := readObjFile(liveOffsetsFile())
	for k, v := range obj(o["files"]) {
		e := obj(v)
		live.files[k] = &liveFileSt{off: toI64(e["off"]), gen: toInt(e["gen"]), enc: str(e["enc"])}
	}
	for k, v := range obj(o["alterid"]) {
		e := obj(v)
		st := &liveBSt{company: str(e["company"]), guid: str(e["guid"]), after: toI64(e["after"]), seen: toI64(e["after"]), maxMaster: toI64(e["maxMaster"]),
			off: e["off"] == true, offSecs: num(e["offSeconds"]), offAt: str(e["offAt"]), offWhy: str(e["offWhy"]), offBeat: str(e["offBeat"])}
		if t, err := time.Parse(time.RFC3339Nano, str(e["lastAsk"])); err == nil {
			st.lastAsk = t
		}
		live.b[k] = st
	}
	for _, id := range liveLoadSent() {
		live.sent[id] = true
	}
}

func liveOffsetsFile() string { return sp("recorder-offsets.json") }
func liveSentDir() string     { return filepath.Join(syncDir(), "recorder-sent") }

// the sent ids of the last 7 days (sync\recorder-sent\<yyyymmdd>.txt, the bridge's own folder); older files removed
func liveLoadSent() []string {
	var ids []string
	cut := nowFn().AddDate(0, 0, -7).Format("20060102")
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
	files := M{}
	for name, st := range live.files {
		off := st.off
		if p := live.pending[name]; p != nil && p.start < off {
			off = p.start
		}
		for _, c := range live.queue {
			if c.file == name && c.start < off {
				off = c.start
			}
		}
		files[name] = M{"off": off, "gen": st.gen, "enc": st.enc}
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
		e := M{"company": st.company, "guid": st.guid, "after": after, "maxMaster": st.maxMaster, "off": st.off, "offSeconds": st.offSecs, "offAt": st.offAt,
			"offWhy": st.offWhy, "offBeat": st.offBeat}
		if !st.lastAsk.IsZero() {
			e["lastAsk"] = st.lastAsk.Format(time.RFC3339Nano)
		}
		bs[k] = e
	}
	path := liveOffsetsFile()
	live.mu.Unlock()
	if err := saveFile(path, jsonText(M{"files": files, "alterid": bs, "at": nowS()})); err != nil {
		writeLog("Recorder: " + path + " could not be written: " + err.Error())
	}
}

// --- the source
func validSource(s string) bool { return s == "addon" || s == "alterid" || s == "both" }

func recorderSource() string {
	if s, _ := liveSrc.Load().(string); validSource(s) {
		return s
	}
	if s := strings.ToLower(strings.TrimSpace(cfgS("RecorderSource"))); validSource(s) {
		return s
	}
	return "addon"
}

func sourceHas(s string) bool {
	r := recorderSource()
	return r == s || r == "both"
}

// the beat's answer: recorderSource (the owner's per-computer choice in FinCom); absent or not one of the three: the
// setting's value
func applyRecorderSource(j M) {
	if j == nil {
		return
	}
	s := strings.ToLower(strings.TrimSpace(str(j["recorderSource"])))
	if !validSource(s) {
		s = ""
	}
	liveBOnAgain(s)
	was, _ := liveSrc.Load().(string)
	if was != s {
		liveSrc.Store(s)
		if s != "" {
			writeLog("Recorder: FinCom sets where the changes come from on this computer: " + s)
		} else if was != "" {
			writeLog("Recorder: the changes come from " + recorderSource() + " (the setting) again")
		}
	}
}

// --- source A: the daily files
var reLiveFile = regexp.MustCompile(`^(.+)-(\d{8}|\d{4}-\d{2}-\d{2})\.txt$`)

// the live add-on's daily files of the newest 7 days, oldest first (the trial's files, without a date, are not read);
// none when the recorder folder fails its check (recorder.go)
func liveFiles() []string {
	d, ok := recorderDirChecked()
	if !ok {
		return nil
	}
	m, _ := filepath.Glob(filepath.Join(d, "*.txt"))
	from, to := nowFn().AddDate(0, 0, -6).Format("20060102"), nowFn().AddDate(0, 0, 1).Format("20060102")
	type df struct{ day, path string }
	var out []df
	for _, f := range m {
		g := reLiveFile.FindStringSubmatch(filepath.Base(f))
		if g == nil {
			continue
		}
		day := strings.ReplaceAll(g[2], "-", "")
		if day < from || day > to {
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

// one turn of the reader (the 1 s watch): the new complete lines of each daily file; the changes found
func liveReadOnce() int {
	if !sourceHas("addon") {
		return 0
	}
	posting := postingGoing()
	files := liveFiles()
	n := 0
	for _, f := range files {
		n += liveReadFile(f, posting)
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
	live.mu.Lock()
	liveFresh()
	if len(live.queue) >= liveQueueMax {
		live.mu.Unlock()
		return 0
	}
	st := live.files[name]
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
	lines, upto := liveLogical(b, off, enc == "utf16")
	if upto > st.off {
		st.off = upto
	}
	if len(b) == liveReadMax && upto == off {
		// a megabyte without a complete line: not a recorder line; passed over
		st.off = off + int64(len(b))
		writeLog("Recorder: " + name + ": a megabyte without a complete line was passed over")
	}
	n := 0
	for _, l := range lines {
		n += liveTake(name, st.gen, l, posting)
	}
	return n
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
func liveLogical(b []byte, off int64, wide bool) ([]liveLogicalLine, int64) {
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
			if cur != nil {
				out = append(out, *cur)
				upto = cur.end
			}
			c := p
			cur = &c
			continue
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

// one logical line: mapped, paired, queued (under live.mu)
func liveTake(file string, gen int, ll liveLogicalLine, posting bool) int {
	l, ok := parseRecorderLine(ll.text)
	if !ok {
		return 0
	}
	n := 0
	if p := live.pending[file]; p != nil {
		if livePair[p.l.Ev] == l.Ev {
			delete(live.pending, file)
			m, ev := liveMerge(p.l, l)
			return liveEmit(m, ev, file, gen, p.start, ll.start, ll.end, posting)
		}
		delete(live.pending, file)
		n += liveFlush(p, file, gen, posting)
	}
	if _, first := livePair[l.Ev]; first {
		live.pending[file] = &livePending{l: l, start: ll.start, end: ll.end, seen: nowFn()}
		return n
	}
	m, ev := liveSingle(l)
	return n + liveEmit(m, ev, file, gen, ll.start, ll.start, ll.end, posting)
}

// a line on its own (no first half before it)
func liveSingle(l recLine) (recLine, string) {
	master := strings.EqualFold(l.Obj, "Master")
	switch l.Ev {
	case "voucher_accept_post":
		return l, "altered"
	case "ledger_accept_post":
		return l, "ledger_altered"
	case "after_import_object":
		if master {
			return l, "ledger_altered"
		}
		return l, "imported"
	case "after_delete":
		if master {
			return l, "ledger_deleted"
		}
		return l, "deleted"
	case "after_cancel":
		return l, "cancelled"
	}
	return l, "" // before_*, start/end_import, write_failed, anything else: dropped
}

// a pair: the second half's values, the first half's where the second has none; the event from the first half's GUID
func liveMerge(pre, post recLine) (recLine, string) {
	m := post
	for _, f := range []struct{ a, b *string }{{&m.GUID, &pre.GUID}, {&m.MID, &pre.MID}, {&m.AID, &pre.AID}, {&m.VType, &pre.VType}, {&m.VNo, &pre.VNo},
		{&m.VDate, &pre.VDate}, {&m.Name, &pre.Name}, {&m.Parent, &pre.Parent}, {&m.Narr, &pre.Narr}, {&m.CName, &pre.CName}, {&m.CGUID, &pre.CGUID}, {&m.User, &pre.User}} {
		if strings.TrimSpace(*f.a) == "" {
			*f.a = *f.b
		}
	}
	m.T0 = pre.T0
	fresh := strings.TrimSpace(pre.GUID) == ""
	switch pre.Ev {
	case "voucher_accept_pre":
		if fresh {
			return m, "created"
		}
		return m, "altered"
	case "ledger_accept_pre":
		if fresh {
			return m, "ledger_created"
		}
		return m, "ledger_altered"
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
func liveFlush(p *livePending, file string, gen int, posting bool) int {
	l := p.l
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
		ev := "altered"
		if l.Ev == "ledger_accept_pre" {
			ev = "ledger_altered"
		}
		return liveEmit(l, ev, file, gen, p.start, p.start, p.end, posting)
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
	for file, p := range live.pending {
		if nowFn().Sub(p.seen) >= wait {
			delete(live.pending, file)
			gen := 0
			if st := live.files[file]; st != nil {
				gen = st.gen
			}
			n += liveFlush(p, file, gen, false)
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
	if ev == "" {
		return 0
	}
	id := liveLineID(file, fmt.Sprint(gen), fmt.Sprint(lineStart))
	if live.sent[id] || live.queued[id] {
		return 0
	}
	c := &change{company: strings.TrimSpace(l.CName), companyGuid: strings.TrimSpace(l.CGUID), event: ev, guid: strings.TrimSpace(l.GUID), masterId: onlyDigits(l.MID),
		alterId: onlyDigits(l.AID), vchType: strings.TrimSpace(l.VType), vchNo: strings.TrimSpace(l.VNo), vchDate: normDate(l.VDate), name: strings.TrimSpace(l.Name),
		parent: strings.TrimSpace(l.Parent), narr: l.Narr, user: strings.TrimSpace(l.User), source: "addon", lineId: id, file: file, start: start, saveMs: -1,
		readAt: nowFn(), during: posting}
	if strings.HasPrefix(c.companyGuid, "name-") {
		c.companyGuid = "" // the add-on had no GUID for the company: its name only
	}
	if !c.isLedger() {
		if m := reLiveFid.FindStringSubmatch(c.narr); m != nil {
			c.fid = m[1]
		}
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
	if !t0.IsZero() && !t1.IsZero() && !t1.Before(t0) {
		c.saveMs = float64(t1.Sub(t0).Milliseconds())
	}
	if posting {
		live.lastPost = time.Now()
		if c.isLedger() && c.name != "" {
			liveTouch(c.company, c.name)
		}
	}
	liveQueueAdd(c)
	return 1
}

func onlyDigits(s string) string { return re(`\D`).ReplaceAllString(s, "") }

// under live.mu
func liveQueueAdd(c *change) {
	live.queue = append(live.queue, c)
	live.queued[c.lineId] = true
	cs := live.co[c.company]
	if cs == nil {
		cs = &liveCoSt{}
		live.co[c.company] = cs
	}
	cs.read++
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
	if !sourceHas("alterid") || postingGoing() {
		return
	}
	if n, err := liveSourceB(company, port); err != nil && !gaveWay(err) {
		writeLog("Recorder (Tally's change list) for " + company + ": " + cutRunes(err.Error(), 200))
	} else if n > 0 {
		writeLog(fmt.Sprintf("Recorder (Tally's change list) for %s: %d change(s) found", company, n))
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
		st = &liveBSt{company: company, guid: guid, after: sp, seen: sp}
		live.b[key] = st
	}
	above := st.seen
	if st.off || v <= above {
		live.mu.Unlock()
		return 0, nil // off by the 2 s rule (the owner switches it back on), or nothing above what was received
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
	took := -1.0
	tc := &TC{copier: true, yield: func() bool { return postingGoing() || importsInFlight.Load() > 0 }, timed: func(sec float64) { took = sec }}
	raw, err := invokeTally(tc, port, keepListAboveRequest(company, above), 60)
	if took > float64(keepNum("RecorderBLimitMs", 2000))/1000 {
		liveBTurnOff(key, company, took)
	}
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
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(raw, -1) {
		g := strings.TrimSpace(html.UnescapeString(group(`<GUID>([^<]*)</GUID>`, m, 1)))
		a, mid := toI64(group(`<ALTERID>\s*(\d+)`, m, 1)), toI64(group(`<MASTERID>\s*(\d+)`, m, 1))
		if g == "" || a <= above {
			continue
		}
		es = append(es, ent{g, normDate(group(`<DATE>([^<]*)</DATE>`, m, 1)), mid, a})
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

// --- the body fetch
// FinComVoucherByMaster: the vouchers with these MasterIDs (at most 50), the date's period (one day), the fields the
// cloud's day parse reads (parse.js parseDay), nothing Tally works out
func voucherByMasterRequest(company, date string, mids []string) string {
	var f []string
	for _, m := range mids {
		if d := onlyDigits(m); d != "" {
			f = append(f, "$MasterID = "+d)
		}
	}
	if len(f) == 0 {
		f = []string{"$MasterID = 0"}
	}
	return fcCollection(vchByMasterID, company, periodVars(date, date), "Voucher", liveFetchField, strings.Join(f, " OR "))
}

// the one narrow exception to "no dated request while ReadDays is off" (tally.go): exactly the body fetch as built
// above, for one day and 1 to 50 MasterIDs
func voucherByMasterExact(x string) bool {
	if tallyRequestID(x) != vchByMasterID {
		return false
	}
	a, z := requestFrom(x)
	if a == "" || a != z {
		return false
	}
	var ids []string
	for _, m := range re(`\$MasterID = (\d+)`).FindAllStringSubmatch(x, -1) {
		ids = append(ids, m[1])
	}
	if len(ids) == 0 || len(ids) > liveMaxIDs {
		return false
	}
	co := html.UnescapeString(group(`<SVCURRENTCOMPANY>([^<]*)</SVCURRENTCOMPANY>`, x, 1))
	return x == voucherByMasterRequest(co, a, ids)
}

func liveBodySec() int { return keepNum("RecorderBodySec", 20) }

// the vouchers Tally gives for these MasterIDs on that date: MasterID -> the voucher's XML (<VOUCHER ...>...</VOUCHER>)
func fetchVouchersByMaster(tc *TC, company string, port int, date string, mids []string) (map[string]string, error) {
	raw, err := invokeTally(tc, port, voucherByMasterRequest(company, date, mids), liveBodySec())
	if err != nil {
		return nil, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, errors.New("Tally's answer could not be read: " + cut(flat(raw), 120))
	}
	out := map[string]string{}
	for _, m := range re(`<VOUCHER\b[\s\S]*?</VOUCHER>`).FindAllString(raw, -1) {
		if id := group(`<MASTERID>\s*(\d+)`, m, 1); id != "" {
			out[id] = cleanXML(m)
		}
	}
	return out, nil
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
	for _, m := range re(`<LEDGER\b[\s\S]*?</LEDGER>`).FindAllString(raw, -1) {
		if toI64(group(`<MASTERID>\s*(\d+)`, m, 1)) == mid {
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
	add(group(`<PARTYLEDGERNAME>([^<]*)</PARTYLEDGERNAME>`, x, 1))
	for _, m := range re(`<LEDGERNAME>([^<]*)</LEDGERNAME>`).FindAllStringSubmatch(x, -1) {
		add(m[1])
	}
	return out
}

// the bodies of these changes (all of one company), asked of Tally as a background read: it gives way to a posting
// (those not asked yet stay so), 20 s in all at most; a failure is logged and the changes go without a body
func liveFetchBodies(need []*change) {
	if len(need) == 0 {
		return
	}
	company := need[0].company
	deadline := time.Now().Add(time.Duration(liveBodySec()) * time.Second)
	yield := func() bool { return postingGoing() || importsInFlight.Load() > 0 }
	tc := &TC{copier: true, yield: yield}
	failed := func(cs []*change, why string) {
		live.mu.Lock()
		for _, c := range cs {
			c.bodyTried = true
		}
		live.mu.Unlock()
		writeLog(fmt.Sprintf("Recorder: the body of %d entr%s of %s was not read from Tally (%s); sent without it (FinCom holds the line until a body comes)",
			len(cs), map[bool]string{true: "y", false: "ies"}[len(cs) == 1], company, cutRunes(why, 160)))
	}
	port, err := findCompanyPort(company, 0)
	if err != nil {
		if yield() {
			return
		}
		failed(need, err.Error())
		return
	}
	// vouchers by date, 50 MasterIDs a request
	byDate := map[string][]*change{}
	var dates []string
	var ledgers []*change
	for _, c := range need {
		if c.isLedger() {
			ledgers = append(ledgers, c)
			continue
		}
		if byDate[c.vchDate] == nil {
			dates = append(dates, c.vchDate)
		}
		byDate[c.vchDate] = append(byDate[c.vchDate], c)
	}
	for _, d := range dates {
		cs := byDate[d]
		for len(cs) > 0 {
			part := cs[:minI(len(cs), liveMaxIDs)]
			cs = cs[len(part):]
			if time.Now().After(deadline) {
				failed(part, "20 s passed")
				continue
			}
			var mids []string
			for _, c := range part {
				mids = append(mids, c.masterId)
			}
			got, err := fetchVouchersByMaster(tc, company, port, d, mids)
			if gaveWay(err) {
				return // a posting goes first: asked again after it
			}
			if err != nil {
				failed(part, err.Error())
				continue
			}
			var missing []*change
			live.mu.Lock()
			for _, c := range part {
				x := got[c.masterId]
				if x == "" {
					missing = append(missing, c)
					continue
				}
				c.xml, c.bodyTried = x, true
				if c.guid == "" {
					c.guid = strings.TrimSpace(html.UnescapeString(group(`<GUID>([^<]*)</GUID>`, x, 1)))
				}
				if c.vchType == "" {
					c.vchType = html.UnescapeString(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, x, 1))
				}
				if c.vchNo == "" {
					c.vchNo = html.UnescapeString(group(`<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>`, x, 1))
				}
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
			live.mu.Unlock()
			if len(missing) > 0 {
				failed(missing, "Tally gave no entry with that MasterID on that date")
			}
		}
	}
	for _, c := range ledgers {
		if time.Now().After(deadline) {
			failed([]*change{c}, "20 s passed")
			continue
		}
		x, err := fetchLedgerByMaster(tc, company, port, toI64(c.masterId))
		if gaveWay(err) {
			return
		}
		if err != nil || x == "" {
			failed([]*change{c}, or(errText(err), "Tally gave no ledger with that MasterID"))
			continue
		}
		live.mu.Lock()
		c.xml, c.bodyTried = x, true
		if n := strings.TrimSpace(html.UnescapeString(group(`<LEDGER NAME="([^"]*)"`, x, 1))); n != "" {
			c.name = n
		}
		if p := strings.TrimSpace(html.UnescapeString(group(`<PARENT>([^<]*)</PARENT>`, x, 1))); p != "" {
			c.parent = p
		}
		if g := strings.TrimSpace(html.UnescapeString(group(`<GUID>([^<]*)</GUID>`, x, 1))); g != "" {
			c.guid = g
		}
		live.mu.Unlock()
	}
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
	if a := onlyDigits(c.alterId); a != "" {
		alter = toI64(a)
	}
	ls := []any{}
	for _, n := range c.ledgers {
		ls = append(ls, M{"name": n, "guid": ""})
	}
	m := M{"line_id": c.lineId, "event": c.event, "object_guid": c.guid, "master_id": c.masterId, "alter_id": alter, "vch_type": c.vchType, "vch_no": c.vchNo,
		"vch_date": c.vchDate, "saved_at": c.at, "pc": liveComputerFn(), "user": c.user, "company_guid": c.companyGuid, "ledgers": ls, "narration": c.narr,
		"fid": c.fid, "xml": c.xml, "source": c.source}
	if c.saveMs >= 0 {
		m["save_ms"] = c.saveMs
	}
	if c.isLedger() {
		m["name"], m["parent"] = c.name, c.parent
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

// one step of the uploader: one group sent (its number of lines), or 0
func liveUploadOnce() int {
	liveUpMu.Lock()
	defer liveUpMu.Unlock()
	if !cloudOn() || importsInFlight.Load() > 0 {
		return 0
	}
	posting := postingGoing()
	gap := importGaps.Load()
	live.mu.Lock()
	liveFresh()
	if posting {
		live.lastPost = time.Now()
		if live.gapSet && live.gap == gap {
			live.mu.Unlock()
			return 0 // one group per gap between imports
		}
	} else {
		live.gapSet = false
	}
	now := nowFn()
	key := ""
	for _, c := range live.queue {
		if b, had := live.back[c.key()]; had && now.Before(b.until) {
			continue
		}
		key = c.key()
		break
	}
	if key == "" {
		live.mu.Unlock()
		return 0
	}
	var group []*change
	size := 600
	for _, c := range live.queue {
		if c.key() != key {
			continue
		}
		s := len(jsonText(c.wire())) + 1
		if len(group) >= liveMaxLines || (len(group) > 0 && size+s > liveMaxBytes-(16<<10)) {
			break
		}
		group = append(group, c)
		size += s
	}
	var need []*change
	for _, c := range group {
		if c.needsBody() {
			need = append(need, c)
		}
	}
	live.mu.Unlock()
	if len(need) > 0 && !posting {
		liveFetchBodies(need)
	}
	// a change whose body is still to be asked holds the group there (the order is kept)
	live.mu.Lock()
	for i, c := range group {
		if c.needsBody() {
			group = group[:i]
			break
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
		return 0
	}
	if liveSendHook != nil {
		liveSendHook()
	}
	r := invokeCloud(body, 30)
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
		return 0
	}
	sentIDs := make([]string, 0, len(group))
	gone := map[*change]bool{}
	for _, c := range group {
		gone[c] = true
		live.sent[c.lineId] = true
		delete(live.queued, c.lineId)
		sentIDs = append(sentIDs, c.lineId)
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
	if posting {
		live.gapSet, live.gap = true, gap
	}
	live.mu.Unlock()
	liveSaveSent(sentIDs)
	liveSaveOffsets()
	return len(group)
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
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	out := M{}
	src := recorderSource()
	waiting, oldest := map[string]int{}, map[string]time.Time{}
	for _, c := range live.queue {
		waiting[c.company]++
		if o, had := oldest[c.company]; !had || c.readAt.Before(o) {
			oldest[c.company] = c.readAt
		}
	}
	for co, cs := range live.co {
		e := M{"read": cs.read, "sent": cs.sent, "waiting": waiting[co], "oldestWaiting": "", "source": src, "lastSent": cs.last, "lastError": cs.lastError}
		if o, had := oldest[co]; had {
			e["oldestWaiting"] = o.Format("2006-01-02T15:04:05")
		}
		out[co] = e
	}
	return out
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
		}()
		sleepOrStop(250 * time.Millisecond)
	}
}

// the owner's rule: a list that took more than 2 s turns source B off on this computer for that company, until the
// owner switches the source (liveBOnAgain)
func liveBTurnOff(key, company string, took float64) {
	why := fmt.Sprintf("Tally took %.1f s for the changed-entries list (limit %g s)", took, float64(keepNum("RecorderBLimitMs", 2000))/1000)
	live.mu.Lock()
	if st := live.b[key]; st != nil {
		st.off, st.offSecs, st.offAt, st.offWhy = true, math.Round(took*10)/10, nowFn().Format("2006-01-02T15:04:05"), why
		st.offBeat, _ = liveSrc.Load().(string)
	}
	live.mu.Unlock()
	writeLog("Source B off: " + why + " (" + company + "; on again when the owner switches where the changes come from)")
	liveSaveOffsets()
}

// the beat's source value: a value other than the one in force when source B stopped turns it on again
func liveBOnAgain(s string) {
	live.mu.Lock()
	liveFresh()
	var back []string
	for _, st := range live.b {
		if st.off && st.offBeat != s {
			st.off, st.offSecs, st.offAt, st.offWhy, st.offBeat = false, 0, "", "", ""
			st.lastAsk = time.Time{}
			back = append(back, st.company)
		}
	}
	live.mu.Unlock()
	for _, c := range back {
		writeLog("Source B on again for " + c + ": the owner switched where the changes come from (" + or(s, "the setting") + ")")
	}
	if len(back) > 0 {
		liveSaveOffsets()
	}
}

// the beat: per company, whether source B is off by the 2 s rule {off, seconds, at, why}
func liveBeatB() M {
	live.mu.Lock()
	defer live.mu.Unlock()
	liveFresh()
	out := M{}
	for _, st := range live.b {
		out[st.company] = M{"off": st.off, "seconds": st.offSecs, "at": st.offAt, "why": st.offWhy}
	}
	return out
}
