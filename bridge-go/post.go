// Posting to Tally: masters first (one request each), then the vouchers in batched requests; Tally's import reply is
// trusted (round 15, 03-Oct-2026: no read-back, no duplicate check against Tally). As bridge 1.15.0 (Invoke-Import,
// Read-ImportResult, Remove-TallyVoucher).
package main

import (
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

var reTag = regexp.MustCompile(`TDSDesk:[A-Za-z0-9._-]+`)

// what Tally answered to an import
func readImportResult(text string) M {
	n := func(tag string) int { return toInt(group(`<`+tag+`>\s*(-?\d+)\s*</`+tag+`>`, text, 1)) }
	var errs []string
	for _, m := range re(`<LINEERROR>([\s\S]*?)</LINEERROR>`).FindAllStringSubmatch(text, -1) {
		errs = append(errs, html.UnescapeString(html.UnescapeString(strings.TrimSpace(m[1]))))
	}
	created, altered, errors_, exceptions, ignored := n("CREATED"), n("ALTERED"), n("ERRORS"), n("EXCEPTIONS"), n("IGNORED")
	ok := created+altered > 0 && errors_ == 0 && exceptions == 0
	msg := strings.Join(errs, " ")
	if !ok && msg == "" {
		switch {
		case ignored > 0:
			msg = "Tally ignored it (it may already exist)."
		case exceptions > 0:
			msg = "Tally reported an exception. Check the ledger names and the voucher type."
		default:
			msg = "Tally did not create it."
		}
	}
	return M{"ok": ok, "created": created, "altered": altered, "errors": errors_, "exceptions": exceptions, "ignored": ignored, "message": msg, "lastVchId": group(`<LASTVCHID>\s*(\d+)\s*</LASTVCHID>`, text, 1),
		"lineErrors": toAny(errs)} // round 15: the LINEERROR texts themselves
}

// the fixed start of every Import Data request (importEnvelope): the allow-list's Import fast path matches only this,
// at the very start of the request, never '<TALLYREQUEST>Import' somewhere inside another request
const importHead = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>"

func importEnvelope(report, company, body string) string {
	return importHead + report + "</REPORTNAME>" +
		"<STATICVARIABLES><SVCURRENTCOMPANY>" + esc(company) + "</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" + body + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
}

func flat(s string) string { return re(`\s+`).ReplaceAllString(s, " ") }

// posting may happen only from the one bridge that posts: never in test mode (beside bridge 1.15.0)
func postingAllowed() error {
	if !cfgB("AllowImport") {
		return errors.New("Posting to Tally is switched off in tds-bridge.config.json (AllowImport).")
	}
	if why := readOnlyWhy(); why != "" {
		return errors.New(why)
	}
	return nil
}

// posting to this company: allowed at all, and the company within PostOnly (security M1, round 11: every import path,
// the local /import route included, refuses here before anything is asked of Tally)
func postingAllowedFor(company string) error {
	if err := postingAllowed(); err != nil {
		return err
	}
	if why := postOnlyRefusal(company); why != "" {
		return errors.New(why)
	}
	return nil
}

// --- round 15 (03-Oct-2026, the owner's decision): posting is fast and never held by a read-back; Tally's import
// reply is trusted; no voucher id is ever inferred. Nothing in the posting path asks Tally anything but the one
// company check and the imports: no duplicate check against Tally (TDSDeskDupCheck), no tag read-back (FinComTag), no
// voucher-id lookup (FinComByMaster), no "checking" cycle. Those requests stay in the code for the read test and the
// owner-started Check Tally only. The duplicate check is this computer's own record (sync\posted-ids.json).

const (
	defaultBatchBills = 10
	defaultBatchBank  = 50
	maxBatch          = 500
)

// a batch size within 1..500
func clampBatch(n int) int {
	if n < 1 {
		return 1
	}
	if n > maxBatch {
		return maxBatch
	}
	return n
}

// bills (vouchers that are not bank lines) per import request: PostBatchBills (the file, or FinCom's beat), default 10
func postBatchBills() int { return clampBatch(keepNum("PostBatchBills", defaultBatchBills)) }

// bank lines per import request: PostBatchBank, default 50
func postBatchBank() int { return clampBatch(keepNum("PostBatchBank", defaultBatchBank)) }

// a bank line: marked so by FinCom (bank: true), else a Payment, Receipt or Contra voucher
func isBankItem(it M) bool {
	if truthy(it["bank"]) {
		return true
	}
	x := str(it["xml"])
	vt := group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, x, 1)
	if strings.TrimSpace(vt) == "" {
		vt = group(`VCHTYPE="([^"]*)"`, x, 1)
	}
	switch strings.ToLower(strings.TrimSpace(html.UnescapeString(vt))) {
	case "payment", "receipt", "contra":
		return true
	}
	return false
}

// why an entry cannot be sent at all ("" when it can): no valid date, or not a VOUCHER, LEDGER or GROUP (a voucher type
// may only have its numbering changed: no other field, and only an Alter)
func cannotSend(x string) string {
	vtOnly := false
	if re(`^\s*<VOUCHERTYPE\b`).MatchString(x) {
		inner := re(`(?s)^\s*<VOUCHERTYPE[^>]*>|</VOUCHERTYPE>\s*$`).ReplaceAllString(x, "")
		tags := re(`<([A-Z.]+)>`).FindAllStringSubmatch(inner, -1)
		other := false
		for _, t := range tags {
			if t[1] != "NAME" && t[1] != "NUMBERINGMETHOD" && t[1] != "PREVENTDUPLICATES" {
				other = true
			}
		}
		vtOnly = strings.Contains(x, `ACTION="Alter"`) && len(tags) > 0 && !other
	}
	// a voucher without a proper date never reaches Tally (Tally answers "Voucher date is missing" but may still make it)
	if re(`^\s*<VOUCHER\b`).MatchString(x) && !re(`<DATE>(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])</DATE>`).MatchString(x) {
		return "The entry has no valid date, so it was not sent to Tally."
	}
	if !re(`^\s*<(VOUCHER|LEDGER|GROUP)\b`).MatchString(x) && !vtOnly {
		return "Only VOUCHER, LEDGER or GROUP objects can be posted, or a voucher type's numbering changed."
	}
	return ""
}

// one import request: its kind, Tally's report, and the entries ({id, xml}) it carries in one TALLYMESSAGE
type importReq struct {
	kind, report string
	bank         bool
	items        []M
}

// the record keys of the request's entries
func (r importReq) keys() []string {
	var o []string
	for _, it := range r.items {
		o = append(o, acceptedKey(str(it["id"]), str(it["xml"])))
	}
	return o
}

// the record (posted-ids.json) could not be written before a send: nothing is sent (never tallyNoAnswer: the job waits)
var errRecordNotWritten = errors.New("the record of what was sent (posted-ids.json) could not be written: record not written; nothing sent")

func (r importReq) envelope(company string) string {
	var b strings.Builder
	b.WriteString(`<TALLYMESSAGE xmlns:UDF="TallyUDF">`)
	for _, it := range r.items {
		b.WriteString(str(it["xml"]))
	}
	b.WriteString("</TALLYMESSAGE>")
	return importEnvelope(r.report, company, b.String())
}

// the requests for these entries: each master on its own (as always), then the bills in requests of PostBatchBills,
// then the bank lines in requests of PostBatchBank
func planImports(masters, vouchers []M) []importReq {
	var o []importReq
	for _, m := range masters {
		o = append(o, importReq{kind: "master", report: "All Masters", items: []M{m}})
	}
	var bills, bank []M
	for _, v := range vouchers {
		if isBankItem(v) {
			bank = append(bank, v)
		} else {
			bills = append(bills, v)
		}
	}
	chunk := func(a []M, n int, isBank bool) {
		for len(a) > 0 {
			k := minI(n, len(a))
			o = append(o, importReq{kind: "voucher", report: "Vouchers", bank: isBank, items: a[:k]})
			a = a[k:]
		}
	}
	chunk(bills, postBatchBills(), false)
	chunk(bank, postBatchBank(), true)
	return o
}

// the caps on Tally's words (review of 2.1.8, finding 6: a request of 500 with 500 line errors must not grow
// progress.json and every posts_update with the square of the batch)
const (
	replyLineErrors = 3   // LINEERROR texts in the message
	replyLineCut    = 200 // characters of each
	lineErrorKeep   = 5   // LINEERROR texts kept per entry (lineError)
)

// Tally's reply in one line: "Tally's reply: created 3 of 5, errors 2: <LINEERROR> | <LINEERROR> | <LINEERROR> and N more"
func replyLine(s int, rr M, lineErr []string) string {
	l := fmt.Sprintf("Tally's reply: created %d of %d", toInt(rr["created"]), s)
	for _, k := range []string{"altered", "errors", "exceptions", "ignored"} {
		if n := toInt(rr[k]); n > 0 {
			l += fmt.Sprintf(", %s %d", k, n)
		}
	}
	if len(lineErr) > 0 {
		var parts []string
		for i, e := range lineErr {
			if i >= replyLineErrors {
				parts = append(parts, fmt.Sprintf("and %d more", len(lineErr)-replyLineErrors))
				break
			}
			if len(e) > replyLineCut {
				e = e[:replyLineCut] + "..."
			}
			parts = append(parts, e)
		}
		l += ": " + strings.Join(parts, " | ")
	}
	return l
}

// the LINEERROR texts kept on an entry: the first few, each cut
func lineErrorKept(lineErr []string) []string {
	var o []string
	for i, e := range lineErr {
		if i >= lineErrorKeep {
			break
		}
		if len(e) > replyLineCut {
			e = e[:replyLineCut] + "..."
		}
		o = append(o, e)
	}
	return o
}

// an import request's own timeout (review of 2.1.8, finding 7): PostTimeoutSec (default 120 s) or 20 s + 0.5 s per
// voucher, whichever is larger, capped at 300 s; not the 20 s read cap (TallyMaxSec), so the owner's batch bounds can be used
func importTimeoutSec(n int) int {
	t := keepNum("PostTimeoutSec", 120)
	if byN := keepNum("PostTimeoutBaseSec", 20) + n/2; byN > t { // the 20 s base is a setting only so the tests can shorten it
		t = byN
	}
	if t > 300 {
		t = 300
	}
	return t
}

func round3(f float64) float64 { return float64(int64(f*1000+0.5)) / 1000 }

// the voucher's date (yyyymmdd) and type, from the XML sent
func voucherDateType(x string) (string, string) {
	vt := strings.TrimSpace(group(`<VOUCHERTYPENAME>([^<]*)</VOUCHERTYPENAME>`, x, 1))
	if vt == "" {
		vt = strings.TrimSpace(group(`VCHTYPE="([^"]*)"`, x, 1))
	}
	return group(`<DATE>(\d{8})</DATE>`, x, 1), html.UnescapeString(vt)
}

// what one import request came to
type importOutcome struct {
	results []M     // one per entry (nil when err is set)
	note    M       // {n, kind, seconds, created, altered, exceptions, ignored, errors, lastVchId} for the job view
	err     error   // Tally not reached, or it did not answer (tallyNoAnswer tells which)
	seconds float64 // how long the request took
}

// one import request to Tally, and the rule on its reply (A2): CREATED + ALTERED == S, ERRORS 0, EXCEPTIONS 0 and no
// LINEERROR -> every entry is posted (ok, byReply, verified false; vchId only when S == 1); anything else -> every entry
// needs review with Tally's counts and words, accepted when Tally made any. Every voucher Tally accepted is recorded
// as sent on this computer, so no later job sends it again
func sendImport(port int, company, job string, r importReq) importOutcome {
	// review of 2.1.8, finding 1: every voucher is on the record as sent (no answer yet) BEFORE the request goes, so a
	// bridge that dies while the request is in flight never sends them again; the reply rewrites the note. The record
	// not written (F1): nothing is sent (a "not reached" error: the job waits and tries later)
	keys := r.keys()
	if r.kind == "voucher" {
		if err := noteSentMany(keys, company, job, "", len(r.items), "", ""); err != nil {
			return importOutcome{err: errRecordNotWritten}
		}
	}
	t0 := time.Now()
	sentAt := t0.Format(time.RFC3339)
	raw, err := invokeTally(fin, port, r.envelope(company), importTimeoutSec(len(r.items)))
	secs := round3(time.Since(t0).Seconds())
	if err != nil {
		if !tallyNoAnswer(err) && r.kind == "voucher" {
			acceptedForgetMany(keys) // nothing reached Tally (F2): the notes made before the send go, on every route
		}
		return importOutcome{err: err, seconds: secs}
	}
	rr := readImportResult(raw)
	shown := re(`^.*?(<IMPORTRESULT>|<RESPONSE>)`).ReplaceAllString(flat(raw), "$1")
	writeLog("    Tally replied: " + cut(shown, 400))
	s := len(r.items)
	created, altered, errs, exc, ign, lv := toInt(rr["created"]), toInt(rr["altered"]), toInt(rr["errors"]), toInt(rr["exceptions"]), toInt(rr["ignored"]), str(rr["lastVchId"])
	lineErr := strs(rr["lineErrors"])
	trusted := created+altered == s && errs == 0 && exc == 0 && len(lineErr) == 0
	note := M{"n": s, "kind": r.kind, "seconds": secs, "created": created, "altered": altered, "exceptions": exc, "ignored": ign, "errors": errs, "lastVchId": lv}
	var out []M
	for _, it := range r.items {
		id, x := it["id"], str(it["xml"])
		b := M{"id": id, "kind": r.kind, "company": company, "port": port, "lastVchId": lv, "created": created, "altered": altered, "errors": errs, "exceptions": exc, "ignored": ign,
			"sentAt": sentAt, "secondsReq": secs, "batchN": s, "batchEnd": lv}
		vchID := ""
		if s == 1 && lv != "" {
			vchID = lv // one entry in the request: Tally's last voucher id is its own; never inferred for more
		}
		if r.kind == "voucher" {
			b["vchDate"], b["vchType"] = voucherDateType(x)
		}
		if trusted {
			b["ok"], b["verified"], b["byReply"], b["message"] = true, false, true, ""
			if vchID != "" {
				b["vchId"] = vchID
			}
			if altered > 0 && created == 0 {
				b["altered1"] = true
				if r.kind != "voucher" {
					b["message"] = "Altered in Tally: it existed already"
				}
			}
		} else {
			b["ok"], b["needsReview"], b["accepted"] = false, true, created+altered > 0
			b["lineError"] = toAny(lineErrorKept(lineErr))
			b["message"] = replyLine(s, rr, lineErr)
		}
		out = append(out, b)
	}
	if r.kind == "voucher" {
		if trusted || created+altered > 0 {
			vchID := ""
			if s == 1 && lv != "" {
				vchID = lv
			}
			_ = noteSentMany(keys, company, job, lv, s, lv, vchID) // one write for the request
		} else {
			acceptedForgetMany(keys) // Tally made nothing of the request: not on the record, may go again
		}
	}
	return importOutcome{results: out, note: note, seconds: secs}
}

// Tally took the request and did not answer: the outcome of every entry is unknown. Each is recorded as sent (never
// sent again by this bridge); no "checking" starts: the owner's Check Tally, or the next comparison of the books,
// settles it
const unknownLine = "Sent to Tally, but no answer came; not sent again by this bridge. Check Tally in FinCom (or the next comparison of the books) settles whether it is there"

func unknownResults(port int, company, job string, r importReq, err error, secs float64) []M {
	sentAt := time.Now().Add(-time.Duration(secs * float64(time.Second))).Format(time.RFC3339)
	var out []M
	for _, it := range r.items {
		id, x := it["id"], str(it["xml"])
		b := M{"id": id, "kind": r.kind, "company": company, "port": port, "ok": false, "outcomeUnknown": true, "sent": true, "state": "unknown", "message": unknownLine,
			"detail": tallyTrouble(err.Error()), "sentAt": sentAt, "secondsReq": secs, "batchN": len(r.items)}
		if r.kind == "voucher" {
			b["vchDate"], b["vchType"] = voucherDateType(x)
			_ = noteSent(acceptedKey(str(id), x), company, job, "", len(r.items), "", "")
		}
		out = append(out, b)
	}
	return out
}

// A5: the FinCom-side duplicate check, before sending: an id this computer already sent (posted-ids.json) is refused
// with the date and Tally's id when known; nil when it may go. Nothing is asked of Tally
func sentBeforeRefusal(id any, xml string) M {
	key := acceptedKey(str(id), xml)
	a := acceptedInfo(key)
	if a == nil {
		return nil
	}
	when := str(a["sentAt"])
	if when == "" {
		when = str(a["acceptedAt"])
	}
	if when == "" {
		when = str(a["at"])
	}
	day := when
	if t, ok := parseTime(when); ok {
		day = t.Format("02-01-2006")
	}
	tid := ""
	switch {
	case str(a["vchId"]) != "":
		tid = "(Tally id " + str(a["vchId"]) + ")"
	case str(a["masterId"]) != "":
		tid = "(Tally id " + str(a["masterId"]) + ")"
	case str(a["batchEnd"]) != "" && toInt(a["batchN"]) > 1:
		tid = fmt.Sprintf("(Tally ids up to %s, sent in a batch of %d)", str(a["batchEnd"]), toInt(a["batchN"]))
	case str(a["lastVchId"]) != "":
		tid = "(Tally id " + str(a["lastVchId"]) + ")"
	default:
		tid = "(Tally id not given)"
	}
	msg := "already sent from this computer on " + day + " " + tid
	if j := str(a["job"]); j != "" {
		msg += ", job " + j
	}
	// (review finding 5) the result says sent, and carries a Tally id only when it is the entry's own: a batch end is never
	// handed on as an entry's id
	r := M{"id": id, "kind": "voucher", "ok": false, "alreadySent": true, "refused": true, "sent": true, "state": "failed", "message": msg,
		"sentOn": when, "vchId": str(a["vchId"]), "sentJob": str(a["job"]), "batchN": toInt(a["batchN"]), "batchEnd": str(a["batchEnd"])}
	if str(a["vchId"]) != "" {
		r["lastVchId"] = str(a["vchId"])
	} else if str(a["masterId"]) != "" {
		r["lastVchId"] = str(a["masterId"])
	}
	return r
}

// POST /import (the browser's one-request way): masters first, one each; then the vouchers in batched requests. The
// company's GUID is checked once (unless the caller did); each voucher is checked against this computer's record; the
// reply decides (sendImport). Tally not answering a request: its entries are unknown (recorded as sent); Tally not
// reached at all: nothing was sent, said so
// round 19 (review finding 8): imports going now (a browser /import is not a job and takes no lease); the light check
// gives way to them
var importsInFlight atomic.Int64

func invokeImport(p M) (M, error) {
	importsInFlight.Add(1)
	defer importsInFlight.Add(-1)
	company, job := str(p["company"]), str(p["job"])
	if err := postingAllowedFor(company); err != nil {
		return nil, err
	}
	if company == "" {
		return nil, errors.New("No company given.")
	}
	port, err := findCompanyPort(company, toInt(p["port"]))
	if err != nil {
		return nil, err
	}
	// the company's GUID (a job checked it already): another company of the same name is never posted to; Tally not
	// answering the check: nothing is posted (each entry says so)
	var stopAll M
	if !truthy(p["guidChecked"]) {
		g, err := companyCheck(fin, company, port)
		switch {
		case err != nil:
			writeLog("  company check of " + company + ": NOT POSTED, could not check Tally: " + tallyTrouble(err.Error()))
			stopAll = M{"ok": false, "checkFailed": true, "message": "Could not check Tally, not posted. Try again.", "detail": tallyTrouble(err.Error())}
		case guardCompanyGUID(company, g) != nil:
			gerr := guardCompanyGUID(company, g)
			writeLog("  NOT POSTED: " + gerr.Error())
			stopAll = M{"ok": false, "guidMismatch": true, "message": "Not posted: " + gerr.Error()}
		}
	}
	results := []M{}
	onItem, _ := p["onItem"].(func(M))
	add := func(r M) {
		results = append(results, r)
		if onItem != nil {
			onItem(r)
		}
	}
	var masters, vouchers []M
	// one posting at a time per Tally from the record check to the end of its imports: two tabs posting the same voucher
	// at once cannot both pass the check before either is recorded
	gate := postGate(port)
	gate.Lock()
	defer gate.Unlock()
	for _, g := range []struct {
		kind  string
		items []any
	}{{"master", arr(p["masters"])}, {"voucher", arr(p["vouchers"])}} {
		for _, itv := range g.items {
			it := obj(itv)
			if it == nil {
				continue
			}
			x, id := str(it["xml"]), it["id"]
			if g.kind == "voucher" {
				x, _ = stampFinComID(x, id) // its FinCom id at the end of its narration, when FinCom did not write one
			}
			if why := cannotSend(x); why != "" {
				add(M{"id": id, "kind": g.kind, "ok": false, "message": why})
				continue
			}
			// this computer's record first: it needs nothing of Tally, so a known duplicate is refused even while Tally
			// is not answering
			if g.kind == "voucher" {
				if r := sentBeforeRefusal(id, x); r != nil {
					r["company"], r["port"] = company, port
					writeLog("  voucher " + str(id) + ": NOT SENT: " + str(r["message"]))
					add(r)
					continue
				}
			}
			if stopAll != nil {
				r := M{"id": id, "kind": g.kind, "company": company, "port": port}
				for k, v := range stopAll {
					r[k] = v
				}
				add(r)
				continue
			}
			if g.kind == "voucher" {
				vouchers = append(vouchers, M{"id": id, "xml": x, "bank": it["bank"]})
			} else {
				masters = append(masters, M{"id": id, "xml": x})
			}
		}
	}
	reqs := planImports(masters, vouchers)
	for i, r := range reqs {
		o := sendImport(port, company, job, r)
		var res []M
		switch {
		case o.err != nil && !tallyNoAnswer(o.err):
			// nothing reached Tally (refused here, or Tally not reachable): not sent, said so; the browser may try again
			msg := "Tally did not answer: " + tallyTrouble(o.err.Error())
			for _, it := range r.items {
				res = append(res, M{"id": it["id"], "kind": r.kind, "ok": false, "notSent": true, "company": company, "port": port, "message": msg})
			}
			writeLog(fmt.Sprintf("  request %d of %d (%d %s): not sent: %s", i+1, len(reqs), len(r.items), r.kind, tallyTrouble(o.err.Error())))
		case o.err != nil:
			res = unknownResults(port, company, job, r, o.err, o.seconds)
			writeLog(fmt.Sprintf("  request %d of %d (%d %s): no answer in %.1f s; outcome unknown, recorded as sent, not sent again", i+1, len(reqs), len(r.items), r.kind, o.seconds))
		default:
			res = o.results
			writeLog(fmt.Sprintf("  request %d of %d: %d %s in %.1f s (created %d, altered %d, exceptions %d, ignored %d, last Tally id %s)", i+1, len(reqs), len(r.items), r.kind, o.seconds,
				toInt(o.note["created"]), toInt(o.note["altered"]), toInt(o.note["exceptions"]), toInt(o.note["ignored"]), or(str(o.note["lastVchId"]), "none")))
		}
		for _, x := range res {
			add(x)
		}
	}
	okN := 0
	for _, r := range results {
		if r["ok"] == true {
			okN++
		}
	}
	writeLog(fmt.Sprintf("Import into '%s': %d of %d posted by Tally's reply", company, okN, len(results)))
	out := make([]any, len(results))
	for i, r := range results {
		out[i] = r
	}
	return M{"ok": true, "company": company, "port": port, "results": out}, nil
}

// delete one voucher from Tally, trying each way Tally identifies a voucher, and saying what Tally answered
func removeTallyVoucher(port int, company, guid, masterID, vtype, vdate, vnum string) (M, error) {
	var d time.Time
	if isTallyDate(vdate) {
		d = fromTallyDate(vdate)
	}
	type try struct{ name, x string }
	var tries []try
	vt := esc(vtype)
	if guid != "" {
		tries = append(tries, try{"GUID", `<VOUCHER REMOTEID="` + esc(guid) + `" VCHTYPE="` + vt + `" ACTION="Delete"><DATE>` + esc(vdate) + "</DATE><VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME></VOUCHER>"})
	}
	if masterID != "" {
		tries = append(tries, try{"MasterID", `<VOUCHER TAGNAME="MASTERID" TAGVALUE="` + esc(masterID) + `" VCHTYPE="` + vt + `" ACTION="Delete"><VOUCHERTYPENAME>` + vt + "</VOUCHERTYPENAME></VOUCHER>"})
	}
	if vnum != "" && !d.IsZero() {
		for _, ds := range []string{d.Format("2-Jan-2006"), vdate} {
			tries = append(tries, try{"number " + ds, `<VOUCHER DATE="` + esc(ds) + `" TAGNAME="Voucher Number" TAGVALUE="` + esc(vnum) + `" VCHTYPE="` + vt + `" ACTION="Delete"><DATE>` + esc(vdate) + "</DATE><VOUCHERTYPENAME>" + vt + "</VOUCHERTYPENAME><VOUCHERNUMBER>" + esc(vnum) + "</VOUCHERNUMBER></VOUCHER>"})
		}
	}
	if len(tries) == 0 {
		return M{"ok": false, "message": "This entry has no Tally identity (GUID, master ID or voucher number), so it cannot be removed automatically."}, nil
	}
	var said []string
	for _, t := range tries {
		raw, err := invokeTally(fin, port, importEnvelope("Vouchers", company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+t.x+"</TALLYMESSAGE>"), 0)
		if err != nil {
			return nil, err
		}
		res := readImportResult(raw)
		writeLog("  delete by " + t.name + ": " + cut(flat(raw), 300))
		if dl := group(`<DELETED>\s*(\d+)\s*</DELETED>`, raw, 1); dl != "" && toInt(dl) > 0 {
			return M{"ok": true, "how": t.name, "message": ""}, nil
		}
		if m := str(res["message"]); m != "" && !strings.Contains(m, "did not create") && !contains(said, m) {
			said = append(said, m)
		}
	}
	why := strings.Join(said, " ")
	if why == "" {
		why = "Tally did not delete it (it may already be gone, or its voucher number or type has changed)."
	}
	return M{"ok": false, "message": why}, nil
}

// the FinCom tags of these items already in Tally, found by FinComTag alone: one request per date the items carry, that
// date's entries (heads and narration) only. nil when Tally did not answer a read, so nothing is sent again on a guess.
// The ledger is no longer used: Tally's per-ledger list ("Vouchers : Ledger") is not asked (2.1.5)
func findPostedTags(port int, company string, items []M, ledger string) map[string]M {
	_ = ledger
	found := map[string]M{}
	var dates []string
	for _, it := range items {
		if d := group(`<DATE>(\d{8})</DATE>`, str(it["xml"]), 1); d != "" {
			dates = append(dates, d)
		}
	}
	heads, err := tagHeadsOn(port, company, uniqSorted(dates))
	if err != nil {
		return nil
	}
	for _, it := range items {
		tag := reTag.FindString(str(it["xml"]))
		if tag == "" {
			continue
		}
		for _, h := range heads {
			if hasTag(str(h["narration"]), tag) {
				found[str(it["id"])] = h
				break
			}
		}
	}
	return found
}

// the entries on these dates, as heads (FinComTag, one request per date)
func tagHeadsOn(port int, company string, dates []string) ([]M, error) {
	var heads []M
	for _, d := range dates {
		ks, err := tagsOnDate(port, company, d)
		if err != nil {
			return nil, err
		}
		for _, k := range ks {
			heads = append(heads, headOfKey(k))
		}
	}
	return heads, nil
}

func headOfKey(k vchKey) M {
	yn := func(b bool) string {
		if b {
			return "Yes"
		}
		return "No"
	}
	return M{"guid": k.guid, "masterId": k.masterID, "alter": k.alter, "date": k.rawDate, "type": k.vtype, "number": k.number, "narration": k.narration, "party": k.party,
		"optional": yn(k.optional), "cancelled": yn(k.cancelled)}
}

// a failure in words
func tallyTrouble(msg string) string {
	if strings.Contains(msg, "record not written") {
		return msg
	}
	if re(`timed out|timeout|operation has timed`).MatchString(msg) {
		return "Tally is busy and did not answer in time (a report, a pop-up or another user may be holding it)."
	}
	if re(`refused|actively refused|Unable to connect|No connection|could not be made`).MatchString(msg) {
		return "Tally is not answering on its port: is TallyPrime open, with the company loaded?"
	}
	return msg
}
