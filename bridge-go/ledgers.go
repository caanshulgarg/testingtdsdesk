// FinCom Bridge 2.1.4 (the owner's decision of 02-Oct-2026): the plain ledger and group lists, read from Tally by
// Update now (and the nightly run), after a posting that carries a ledger master, and when FinCom's bill screen opens
// its ledger chooser with a list older than the last posting (POST /ledgers/refresh here, or the cloud's wake-up
// "ledgers"). Only stored master fields are asked for: name, group, the master's stored opening (OPENINGBALANCE, the
// field as kept, never a balance worked out for a date), GSTIN and PAN, and GUID / MasterID / AlterID to see what
// changed. Nothing Tally computes (no closing balance, no on-account value, no period).
//
// The ledger list goes in chunks of MasterIDs (2,000 a request, LedgerChunk), so no request holds Tally for long on a
// company with 50,000 ledgers; a chunk that does not answer is halved (down to LedgerChunkMin, 125) and the read
// resumes from it; each chunk is saved as it comes (ledger-read.jsonl), so a stop resumes from the last chunk saved.
// Every request goes through the one gate to Tally (postings first, the check after a timeout, the company's GUID, the
// lease). Groups are few: one request.
//
// A full list read is compared with the list held here (ledger-list.json) by GUID: a new ledger, one changed, one
// renamed (the same GUID, another name: the copy's entries carry the new name, and FinCom's cloud renames its row,
// keeping the old name), and one gone (a GUID no longer in Tally: soft deleted in the cloud, never removed). What is to
// go to the cloud waits in ledger-out.json until FinCom's cloud has taken it (tally-ingest "ledger_list").
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	ledListID = "FinComLedgers"
	grpListID = "FinComGroups"
	// stored fields only: nothing here is worked out by Tally
	ledFetch = "GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST"
	grpFetch = "GUID, MASTERID, ALTERID, NAME, PARENT"
)

func ledChunkDefault() int { return keepNum("LedgerChunk", 2000) }
func ledChunkMin() int     { return minI(ledChunkDefault(), keepNum("LedgerChunkMin", 125)) }
func ledChunkSec() int     { return keepNum("LedgerChunkSec", 20) }

// the requests
func ledgerChunkRequest(company string, after, upto int64) string {
	f := fmt.Sprintf("$MasterID > %d", after)
	if upto > 0 {
		f += fmt.Sprintf(" AND $MasterID <= %d", upto)
	}
	return fcCollection(ledListID, company, "", "Ledger", ledFetch, f)
}
func groupListRequest(company string) string {
	return fcCollection(grpListID, company, "", "Group", grpFetch, "")
}

// one ledger as listed: kept as [mid, alter, name, parent, open, gstin, pan] by its GUID
type ledRow struct {
	guid                           string
	mid, alter                     int64
	name, parent, open, gstin, pan string
}

func (r ledRow) arr() []any {
	return []any{r.mid, r.alter, r.name, r.parent, r.open, r.gstin, r.pan}
}
func ledFromArr(g string, a []any) ledRow {
	return ledRow{g, toI64(at(a, 0)), toI64(at(a, 1)), str(at(a, 2)), str(at(a, 3)), str(at(a, 4)), str(at(a, 5)), str(at(a, 6))}
}
func digits(s string) int64 { return toI64(re(`\D`).ReplaceAllString(s, "")) }

// one chunk of the ledger list: the ledgers whose MasterID is in (after, upto] (upto 0: no upper end), and the
// highest MasterID among them
func readLedgerChunk(tc *TC, company string, port int, after, upto int64) ([]ledRow, int64, error) {
	raw, err := invokeTally(tc, port, ledgerChunkRequest(company, after, upto), ledChunkSec())
	if err != nil {
		return nil, 0, err
	}
	if !strings.Contains(raw, "<ENVELOPE") {
		return nil, 0, errors.New("Tally's answer to the ledger list could not be read: " + cut(flat(raw), 120))
	}
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
			strings.ToUpper(strings.TrimSpace(nt(l, "INCOMETAXNUMBER")))}
		if r.mid > top {
			top = r.mid
		}
		out = append(out, r)
	}
	return out, top, nil
}

// Tally's groups, name and parent (a primary group's parent is empty): one request
func readGroupList(tc *TC, company string, port int) ([][2]string, error) {
	raw, err := invokeTally(tc, port, groupListRequest(company), ledChunkSec())
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
func ledLaterFile(dir string) string {
	return filepath.Join(dir, "ledger-deleted-later.json") // deletions a cloud without migration-32 could not take yet
}

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
		o[g] = r.arr()
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
		b.WriteString(jsonText(append([]any{r.guid}, r.arr()...)) + "\n")
	}
	_ = appendText(ledReadFile(dir), b.String())
}

// --- what changed between the list held and a full read, by GUID
type ledRen struct{ guid, from, to string }
type ledDiff struct {
	rows     []ledRow        // new or changed (a rename included)
	added    int             // of them, new
	openChg  map[string]bool // the stored opening changed in Tally since the last read
	renamed  []ledRen
	deleted  []ledRow
	deferred []ledRow // gone, but too many at once: kept until the next full read says so again
}

// LedgerMassGone (25) or 5% of the list, whichever is more: more gone at once than that is taken only when the next
// full read finds them gone too (a Tally answering with part of its list must never delete ledgers in FinCom)
func diffLedgers(held, read map[string]ledRow, pendingGone map[string]bool) ledDiff {
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
	var gone []ledRow
	for g, h := range held {
		if _, ok := read[g]; !ok {
			gone = append(gone, h)
		}
	}
	sort.Slice(gone, func(i, j int) bool { return gone[i].guid < gone[j].guid })
	if limit := maxI(keepNum("LedgerMassGone", 25), len(held)/20); len(gone) > limit {
		for _, h := range gone {
			if pendingGone[h.guid] {
				d.deleted = append(d.deleted, h)
			} else {
				d.deferred = append(d.deferred, h)
			}
		}
		return d
	}
	d.deleted = gone
	return d
}

// --- the outbox: {rows: {guid: [mid, alter, name, parent, open, gstin, pan, openChanged]}, renamed: {guid: [from, to]},
// deleted: {guid: name}, groups: [[name, parent]]}
func mergeLedOut(dir string, d ledDiff, groups [][2]string) {
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		o = M{}
	}
	rows, ren, del := obj(o["rows"]), obj(o["renamed"]), obj(o["deleted"])
	if rows == nil {
		rows = M{}
	}
	if ren == nil {
		ren = M{}
	}
	if del == nil {
		del = M{}
	}
	// deletions a cloud without migration-32 could not take: sent again with the next list
	for g, n := range readObjFile(ledLaterFile(dir)) {
		del[g] = n
	}
	_ = os.Remove(ledLaterFile(dir))
	for _, r := range d.rows {
		oc := d.openChg[r.guid] || truthy(at(arr(rows[r.guid]), 7))
		rows[r.guid] = append(r.arr(), oc)
		delete(del, r.guid) // back in Tally
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
	for _, h := range d.deleted {
		del[h.guid] = h.name
		delete(rows, h.guid)
		delete(ren, h.guid)
	}
	o["rows"], o["renamed"], o["deleted"] = rows, ren, del
	if groups != nil {
		gl := []any{}
		for _, g := range groups {
			gl = append(gl, []any{g[0], g[1]})
		}
		o["groups"] = gl
	}
	if len(rows)+len(ren)+len(del) == 0 && o["groups"] == nil {
		return
	}
	_ = saveFile(ledOutFile(dir), jsonText(o))
}

// --- the round itself, inside a run's step (keep.go): true when the full list is read and compared
func (k *keepRun) ledgerList(company string, port int, dir string, st M, inBudget func() bool, save func()) (bool, error) {
	if str(st["ledRun"]) == k.id {
		return true, nil // read in this run already
	}
	ls := obj(st["led"])
	if t, ok := parseTime(str(ls["started"])); ls == nil || !ok || time.Since(t) > time.Duration(keepNum("LedgerResumeHours", 6))*time.Hour {
		size := toInt(st["ledSize"])
		if size < ledChunkMin() || size > ledChunkDefault() {
			size = ledChunkDefault()
		}
		ls = M{"started": nowS(), "after": 0, "size": size, "empty": 0, "groups": false, "n": 0, "reqs": 0}
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
		g, err := readGroupList(k.tc, company, port)
		if err != nil {
			return false, err
		}
		gl := []any{}
		for _, x := range g {
			gl = append(gl, []any{x[0], x[1]})
		}
		_ = saveFile(filepath.Join(dir, "group-list.json"), jsonText(gl))
		ls["groups"], ls["reqs"] = true, toInt(ls["reqs"])+1
		save()
	}
	for !truthy(ls["done"]) {
		if !inBudget() || keepHold() != "" {
			return false, nil
		}
		after, size, bound := toI64(ls["after"]), toInt(ls["size"]), toI64(ls["bound"])
		tail := (bound > 0 && after >= bound) || (bound <= 0 && toInt(ls["empty"]) >= 3)
		upto := after + int64(size)
		if tail {
			upto = 0
		}
		t1 := time.Now()
		rows, top, err := readLedgerChunk(k.tc, company, port, after, upto)
		if err != nil {
			if gaveWay(err) {
				return false, err // the same chunk again when Tally is free
			}
			span := fmt.Sprintf("%d-%d", after+1, upto)
			if tail {
				// the last request (no upper end) did not answer: the rest is read in chunks again
				ls["bound"] = after + int64(4*size)
				span = fmt.Sprintf("from %d", after+1)
			} else if size > ledChunkMin() {
				ls["size"] = maxI(ledChunkMin(), size/2)
			}
			st["ledSize"] = ls["size"]
			save()
			return false, fmt.Errorf("Tally did not give the ledger list (MasterID %s: %s); the next try reads %d from MasterID %d", span, err.Error(), toInt(ls["size"]), after+1)
		}
		sec := time.Since(t1).Seconds()
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
			// a chunk that answered quickly: back towards the full chunk
			if sec < float64(ledChunkSec())/4 && size < ledChunkDefault() {
				ls["size"] = minI(ledChunkDefault(), size*2)
			}
		}
		st["ledSize"] = ls["size"]
		save()
		writeLog(fmt.Sprintf("Keeping %s: ledger list MasterID %d-%s, %d ledger(s) (%.1fs); saved", company, after+1, map[bool]string{true: "end", false: fmt.Sprint(upto)}[tail], len(rows), sec))
		keepRest(time.Duration(maxI(200, int(sec*500))) * time.Millisecond)
	}
	// the full list: compared with the one held, by GUID
	read := loadLedRead(dir)
	held := loadLedList(dir)
	pend := map[string]bool{}
	for _, g := range strs(st["ledGone"]) {
		pend[g] = true
	}
	d := diffLedgers(held, read, pend)
	var groups [][2]string
	for _, x := range arr(readJSONFile(filepath.Join(dir, "group-list.json"))) {
		a := arr(x)
		groups = append(groups, [2]string{str(at(a, 0)), str(at(a, 1))})
	}
	// the copy's entries carry a renamed ledger's new name (and its opening in the balances held)
	for _, x := range d.renamed {
		renameKeepLedger(dir, st, x.from, x.to)
		renameHeldOpening(dir, x.from, x.to)
		writeLog("Keeping " + company + ": ledger " + x.from + " is now " + x.to + " in Tally")
	}
	for _, h := range d.deleted {
		writeLog("Keeping " + company + ": ledger " + h.name + " is no longer in Tally; it is marked deleted in FinCom (never removed)")
	}
	if len(d.deferred) > 0 {
		writeLog(fmt.Sprintf("Keeping %s: %d ledgers are missing from Tally's list at once; they are taken as deleted only if the next full read misses them too", company, len(d.deferred)))
	}
	// the held list: what Tally listed, and the ledgers waiting for that second look
	next := map[string]ledRow{}
	for g, r := range read {
		next[g] = r
	}
	var gone []any
	for _, h := range d.deferred {
		next[h.guid] = h
		gone = append(gone, h.guid)
	}
	saveLedList(dir, next)
	if gone == nil {
		delete(st, "ledGone")
	} else {
		st["ledGone"] = gone
	}
	mergeLedOut(dir, d, groups)
	_ = os.Remove(ledReadFile(dir))
	writeLog(fmt.Sprintf("Keeping %s: the ledger list read (%d ledgers, %d groups, %d request(s)): %d new, %d changed, %d renamed, %d deleted",
		company, len(read), len(groups), toInt(ls["reqs"]), d.added, len(d.rows)-d.added, len(d.renamed), len(d.deleted)))
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

// --- to FinCom's cloud (from pushCloudCompany): the rows a batch at a time (LedgerSendBatch, 2000), the renames and
// the groups with the first, the deletions with the last. A cloud that cannot take it now (an older tally-ingest,
// offline) holds back neither the days nor anything else: it is tried again later
var ledPushAfter = map[string]time.Time{} // under cloudMu

func pushLedgerList(company, dir string) error {
	if !exists(ledOutFile(dir)) || time.Now().Before(ledPushAfter[company]) {
		return nil
	}
	o := readObjFile(ledOutFile(dir))
	if o == nil {
		_ = os.Remove(ledOutFile(dir))
		return nil
	}
	rows, ren, del := obj(o["rows"]), obj(o["renamed"]), obj(o["deleted"])
	var gs []string
	for g := range rows {
		gs = append(gs, g)
	}
	sort.Strings(gs)
	bs := keepNum("LedgerSendBatch", 2000)
	first := true
	for {
		n := minI(bs, len(gs))
		batch := gs[:n]
		last := n == len(gs)
		led := []any{}
		for _, g := range batch {
			a := arr(rows[g])
			oc := 0
			if truthy(at(a, 7)) {
				oc = 1
			}
			led = append(led, []any{g, toI64(at(a, 0)), toI64(at(a, 1)), str(at(a, 2)), str(at(a, 3)), str(at(a, 4)), str(at(a, 5)), str(at(a, 6)), oc})
		}
		body := M{"kind": "ledger_list", "company": company, "ledgers": led, "last": last}
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
		}
		if last {
			dl := []any{}
			for g, n := range del {
				dl = append(dl, []any{g, str(n)})
			}
			body["deleted"] = dl
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
		gs = gs[n:]
		if first {
			o["renamed"], o["groups"], ren = M{}, nil, M{}
			first = false
		}
		if last {
			if k := toInt(r.json["deletesSkipped"]); k > 0 && len(del) > 0 {
				// a cloud without migration-32 keeps no deletions: they go again with the next list
				_ = saveFile(ledLaterFile(dir), jsonText(del))
				writeLog(fmt.Sprintf("Cloud: %s: %d deleted ledger(s) not marked in FinCom yet (its cloud cannot mark deletions until migration-32 is applied); sent again with the next ledger list", company, len(del)))
			}
			o["deleted"] = M{}
		}
		o["rows"] = rows
		if last {
			_ = os.Remove(ledOutFile(dir))
			writeLog(fmt.Sprintf("Cloud: %s: the ledger list sent (%s)%s", company, ledSentNote(r.json), shadowNote(r)))
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
