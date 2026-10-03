// Posting as a background job (bridge 1.12, jobs.ps1). FinCom hands a batch to POST /jobs and gets a job number at once.
// The job sends it in batched import requests, one writer per Tally at a time, and writes its progress to
// jobs\<id>\progress.json after every request. The browser may close, the network may drop, the bridge may restart:
// the job goes on, or is resumed, and nothing is posted twice: every voucher sent is recorded on this computer
// (sync\posted-ids.json) and never sent again by this bridge. The same job number sent again returns the same job.
// Round 15 (03-Oct-2026, the owner's decision): Tally's import reply is trusted; nothing is read back; no voucher id is
// inferred; the queue is never held by a check.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

var (
	jobsMu      sync.Mutex
	jobsRunning = map[string]bool{}
	tallyWriter sync.Map // port -> *sync.Mutex: one writer per Tally
)

func jobsDir() string {
	if d := cfgS("JobsDir"); d != "" {
		return d
	}
	return filepath.Join(Home, "jobs")
}
func jobDir(id string) (string, error) {
	if !re(`^[A-Za-z0-9-]{8,64}$`).MatchString(id) {
		return "", errors.New("Not a job number.")
	}
	return filepath.Join(jobsDir(), id), nil
}
func readProgress(dir string) M {
	for i := 0; i < 5; i++ {
		if !exists(filepath.Join(dir, "progress.json")) {
			return nil
		}
		if m := readObjFile(filepath.Join(dir, "progress.json")); m != nil {
			return m
		}
		time.Sleep(60 * time.Millisecond)
	}
	return nil
}

var progMu sync.Mutex

func writeProgress(dir string, p M) {
	progMu.Lock()
	defer progMu.Unlock()
	p["updatedAt"] = time.Now().Format(time.RFC3339Nano)
	p["seq"] = toInt(p["seq"]) + 1 // round 7 (F4): grows with every change of the job, kept across restarts
	_ = saveFile(filepath.Join(dir, "progress.json"), jsonText(p))
}
func jobAlive(id string) bool {
	jobsMu.Lock()
	defer jobsMu.Unlock()
	return jobsRunning[id]
}

// a job as FinCom sees it; a running job whose worker has gone (the bridge restarted) is "interrupted": FinCom resumes it
func jobView(dir string) M {
	p := readProgress(dir)
	if p == nil {
		return nil
	}
	id := str(p["id"])
	st := str(p["status"])
	age := 99.0
	if t, ok := parseTime(str(p["updatedAt"])); ok {
		age = time.Since(t).Seconds()
	}
	if (st == "queued" || st == "waiting" || st == "running") && !jobAlive(id) && age > 5 {
		p["status"] = "interrupted"
		p["message"] = "The posting stopped part-way (the computer or the bridge was restarted). Resume to finish it; nothing already in Tally is sent again."
	}
	p["checking"] = false // round 15: there is no checking cycle any more
	return p
}

func activeJobs() []any {
	out := []any{}
	ents, err := os.ReadDir(jobsDir())
	if err != nil {
		return out
	}
	since := time.Now().Add(-12 * time.Hour)
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		if fi, err := e.Info(); err != nil || fi.ModTime().Before(since) {
			continue
		}
		p := jobView(filepath.Join(jobsDir(), e.Name()))
		if p == nil {
			continue
		}
		switch str(p["status"]) {
		case "queued", "waiting", "running", "interrupted":
			out = append(out, M{"id": p["id"], "status": p["status"], "company": p["company"], "done": p["done"], "total": p["total"], "message": p["message"], "updatedAt": p["updatedAt"]})
		}
	}
	return out
}

// POST /jobs: {jobId, company, port, masters, vouchers: [{id, xml, bank?}], released}
func newPostJob(pl M) (M, error) {
	if err := postingAllowed(); err != nil {
		return nil, err
	}
	id := str(pl["jobId"])
	if id == "" {
		id = newUUID()
	}
	dir, err := jobDir(id)
	if err != nil {
		return nil, err
	}
	if exists(filepath.Join(dir, "progress.json")) {
		v := jobView(dir)
		// Retry (the same job sent again after it failed or was cancelled): the entries not posted go again; whatever
		// was sent to Tally (posted by its reply, accepted by it, or sent without an answer) is kept and never sent twice
		var rs []M
		for _, r := range arr(v["results"]) {
			if o := obj(r); o != nil {
				rs = append(rs, o)
			}
		}
		st := str(v["status"])
		if rel := arr(pl["released"]); len(rel) > 0 && !jobAlive(id) {
			// round 7 (F2): the owner's releases that came with this hand-back, for the worker to see
			if pay := readObjFile(filepath.Join(dir, "payload.json")); pay != nil {
				pay["released"] = rel
				_ = saveFile(filepath.Join(dir, "payload.json"), jsonText(pay))
			}
		}
		if (st == "failed" || st == "cancelled") && !jobAlive(id) {
			byItem := map[string]string{}
			if pay := readObjFile(filepath.Join(dir, "payload.json")); pay != nil {
				for _, x := range arr(pay["items"]) {
					if o := obj(x); o != nil {
						byItem[str(o["id"])] = str(o["xml"])
					}
				}
			}
			var kept []any
			for _, r := range rs {
				if !confirmedResult(r) {
					continue
				}
				// round 8 (R5): a release the cloud handed with this job, not honoured yet, for an entry sent before: the
				// worker sees the entry again (and sends it once)
				if k := str(r["id"]); r["verified"] != true && releaseFor(arr(pl["released"]), acceptedKey(k, byItem[k]), k, or2(acceptedInfo(acceptedKey(k, byItem[k])), M{})) != nil {
					continue
				}
				kept = append(kept, r)
			}
			if kept == nil {
				kept = []any{}
			}
			_ = os.Remove(filepath.Join(dir, "cancel"))
			v["results"], v["done"], v["resumed"], v["status"], v["message"], v["finishedAt"] = kept, len(kept), true, "queued", "Retrying", ""
			startJob(id, dir, v)
			writeLog(fmt.Sprintf("Posting job %s: retried (%d already sent to Tally kept, never sent again)", id, len(kept)))
			return jobView(dir), nil
		}
		return v, nil
	}
	if str(pl["company"]) == "" {
		return nil, errors.New("No company given.")
	}
	_ = os.MkdirAll(dir, 0o755)
	items := []any{}
	for _, m := range arr(pl["masters"]) {
		if o := obj(m); o != nil {
			items = append(items, M{"id": str(o["id"]), "kind": "master", "xml": str(o["xml"])})
		}
	}
	for _, v := range arr(pl["vouchers"]) {
		if o := obj(v); o != nil {
			// every voucher carries its FinCom id ("TDSDesk:<id>" first in its narration): FinCom's, else the entry's id
			x, _ := stampFinComID(str(o["xml"]), str(o["id"]))
			it := M{"id": str(o["id"]), "kind": "voucher", "xml": x}
			if truthy(o["bank"]) {
				it["bank"] = true // round 15: FinCom marks a bank line; else its voucher type tells (isBankItem)
			}
			items = append(items, it)
		}
	}
	// the port FinCom chose is kept only as a hint, and never as 0 (0 means "find it", which happens on every try anyway)
	payload := M{"company": str(pl["company"]), "items": items, "released": arr(pl["released"])}
	if pt := toInt(pl["port"]); pt > 0 {
		payload["port"] = pt
	}
	_ = saveFile(filepath.Join(dir, "payload.json"), jsonText(payload))
	p := M{"ok": true, "id": id, "status": "queued", "company": str(pl["company"]), "total": len(items), "done": 0, "results": []any{}, "message": "Starting", "pid": os.Getpid(), "resumed": false,
		"startedAt": time.Now().Format(time.RFC3339Nano), "updatedAt": "", "finishedAt": "", "checking": false, "checkFailed": false, "reqs": []any{}, "secondsTotal": 0.0}
	startJob(id, dir, p)
	writeLog(fmt.Sprintf("Posting job %s: %d item(s) for %s", id, len(items), p["company"]))
	return p, nil
}

func startJob(id, dir string, p M) {
	jobsMu.Lock()
	jobsRunning[id] = true
	jobsMu.Unlock()
	writeProgress(dir, p)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				writeLog(fmt.Sprint("Posting job stopped: ", r))
			}
			jobsMu.Lock()
			delete(jobsRunning, id)
			jobsMu.Unlock()
		}()
		jobWorker(dir)
	}()
}

func resumePostJob(id string) (M, error) {
	dir, err := jobDir(id)
	if err != nil {
		return nil, err
	}
	p := jobView(dir)
	if p == nil {
		return nil, errors.New("No such job.")
	}
	if str(p["status"]) != "interrupted" {
		return p, nil
	}
	if err := postingAllowed(); err != nil {
		return nil, err
	}
	p["status"], p["message"] = "queued", "Resuming"
	startJob(id, dir, p)
	writeLog("Posting job " + id + " resumed")
	return p, nil
}

// the pause before asking Tally again while a posting waits: 15 s, growing to 60 s; no deadline
func waitPause(round int) time.Duration {
	if ms := keepNum("PostWaitMs", 0); ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	steps := []int{15, 15, 30, 45, 60}
	if round >= len(steps) {
		round = len(steps) - 1
	}
	return time.Duration(steps[round]) * time.Second
}

// a job cancelled in FinCom (or by POST /jobs/cancel): a mark in its folder, seen while it waits and between batches
func jobCancelled(dir string) bool { return exists(filepath.Join(dir, "cancel")) }
func cancelJob(id, why string) (M, error) {
	dir, err := jobDir(id)
	if err != nil {
		return nil, err
	}
	if !exists(filepath.Join(dir, "progress.json")) {
		return nil, errors.New("No such job.")
	}
	_ = saveFile(filepath.Join(dir, "cancel"), why)
	p := jobView(dir)
	if p != nil && !jobAlive(id) && str(p["status"]) != "done" {
		// not running now (stopped part-way, or failed): marked cancelled here
		p["status"], p["message"], p["finishedAt"] = "cancelled", "Cancelled in FinCom; nothing more is sent to Tally", time.Now().Format(time.RFC3339Nano)
		writeProgress(dir, p)
	}
	writeLog("Posting job " + id + " cancelled (" + why + ")")
	return jobView(dir), nil
}

// the posting going on now, in its one line (the tray, /status); "" when none
func postingNow() string {
	for _, j := range activeJobs() {
		o := obj(j)
		if st := str(o["status"]); st == "waiting" || st == "running" || st == "queued" {
			return str(o["message"])
		}
	}
	return ""
}

// a job changed: FinCom's queue hears it at once, not at the next few-second turn
var postsDirty atomic.Bool

// The worker. A posting never fails because Tally is closed, busy or the company is not open: it waits ("Waiting for
// Tally: ..."), asking again every 15 s up to every 60 s, with no deadline, until it can post or is cancelled. Only
// Tally's reply fails an entry (needs review, with Tally's words), at once; the others go on. Nothing is posted twice:
// every voucher sent is recorded on this computer before the next request goes, and whatever has a result is never
// sent again (the results are kept in progress.json across restarts). The port is found again on every try.
// Round 15 (03-Oct-2026): Tally sees one company check per job, the master imports and the voucher imports (bills in
// requests of PostBatchBills, bank lines of PostBatchBank); nothing is read back; the queue is never held.
func jobWorker(dir string) {
	p := readProgress(dir)
	pl := readObjFile(filepath.Join(dir, "payload.json"))
	if p == nil || pl == nil {
		return
	}
	asked := str(pl["company"])
	jobID := str(p["id"])
	hint := toInt(pl["port"])
	if pp := toInt(p["port"]); pp > 0 {
		hint = pp
	}
	p["pid"] = os.Getpid()
	p["checking"] = false
	var results []M
	for _, r := range arr(p["results"]) {
		if o := obj(r); o != nil {
			results = append(results, o)
		}
	}
	var all []M
	for _, x := range arr(pl["items"]) {
		if o := obj(x); o != nil {
			all = append(all, o)
		}
	}
	sending := map[string]bool{}
	// review of 2.1.8, finding 1: a request in flight when the bridge died (its ids in progress.json as inflight, no
	// result): every such entry is unknown (sent, no answer), never sent again
	if ids := strs(p["inflight"]); len(ids) > 0 {
		have := map[string]bool{}
		for _, r := range results {
			have[str(r["id"])] = true
		}
		byID := map[string]M{}
		for _, it := range all {
			byID[str(it["id"])] = it
		}
		for _, k := range ids {
			it := byID[k]
			if have[k] || it == nil {
				continue
			}
			x := str(it["xml"])
			r := M{"id": k, "kind": str(it["kind"]), "company": str(p["tallyCompany"]), "port": toInt(p["port"]), "ok": false, "outcomeUnknown": true, "sent": true, "state": "unknown",
				"message": unknownLine, "detail": "the bridge stopped while this request was at Tally", "batchN": len(ids)}
			if str(it["kind"]) == "voucher" {
				r["vchDate"], r["vchType"] = voucherDateType(x)
				_ = noteSent(acceptedKey(k, x), str(p["tallyCompany"]), jobID, "", len(ids), "", "")
			}
			results = append(results, r)
			writeLog("  entry " + k + ": was at Tally when the bridge stopped; outcome unknown, recorded as sent, not sent again")
		}
		p["inflight"] = []any{}
	}
	setRes := func() {
		a := make([]any, len(results))
		byID := map[string]M{}
		for i, r := range results {
			a[i] = r
			byID[str(r["id"])] = r
		}
		p["results"] = a
		p["done"] = len(results)
		items := make([]any, 0, len(all))
		for _, it := range all {
			k := str(it["id"])
			r := byID[k]
			e := M{"id": k, "kind": str(it["kind"]), "state": itemState(r, sending[k])}
			if r != nil {
				// round 15: what the cloud shows per entry: posted by Tally's reply (byReply, batchN, batchEnd, vchId when the
				// request held one voucher), needs review (Tally's counts and words), sent without an answer, or refused
				for _, f := range []string{"byReply", "vchId", "batchN", "batchEnd", "lastVchId", "needsReview", "accepted", "alreadySent", "sentAt", "secondsReq",
					"created", "altered", "errors", "exceptions", "ignored", "lineError", "vchDate", "vchType", "verified", "outcomeUnknown", "sent", "sentOn"} {
					if v, has := r[f]; has {
						e[f] = v
					}
				}
				if r["outcomeUnknown"] == true {
					e["reason"] = str(r["message"])
					if r["acceptedBefore"] == true || r["held"] == true {
						e["reason"] = str(r["message"]) // older notes: names the earlier job
					}
				} else if r["ok"] != true {
					e["reason"] = failedLine(str(r["message"]))
					if r["already"] == true {
						e["already"], e["guid"], e["vchNo"], e["vchDate"] = true, str(r["guid"]), str(r["vchNo"]), str(r["vchDate"])
					}
					if r["checkFailed"] == true {
						e["checkFailed"] = true
					}
				}
			}
			items = append(items, e)
		}
		p["items"] = items
	}
	save := func() {
		setRes()
		writeProgress(dir, p)
		postsDirty.Store(true)
	}
	setStatus := func(st, msg string) {
		changed := str(p["status"]) != st || str(p["message"]) != msg
		p["status"], p["message"] = st, msg
		if changed {
			save()
			if st == "waiting" {
				writeLog("Posting job " + jobID + ": " + msg)
			}
		}
	}
	finish := func(st, msg string) {
		p["status"], p["message"], p["finishedAt"] = st, msg, time.Now().Format(time.RFC3339Nano)
		save()
		writeLog("Posting job " + jobID + " " + st + ": " + msg)
	}
	cancelled := func() bool {
		if jobCancelled(dir) {
			finish("cancelled", "Cancelled in FinCom; nothing more is sent to Tally")
			return true
		}
		return false
	}
	// sleeps, seeing a cancel or the bridge stopping within a second; false: stop here
	pause := func(d time.Duration) bool {
		for t := time.Duration(0); t < d; t += time.Second {
			if jobCancelled(dir) || stopping() {
				return false
			}
			time.Sleep(time.Second)
		}
		return true
	}
	// Tally with the company open, found now: its port and the company's name in Tally; false when the job is to stop
	// (cancelled, or the bridge stops: it is resumed after the restart). why: a reason to wait already known
	round := 0
	var port int
	var company string
	waitTally := func(why error) bool {
		for {
			if cancelled() || stopping() {
				return false
			}
			if why == nil {
				pt, name, err := findCompanyNow(asked, hint)
				if err == nil {
					port, company, hint = pt, name, pt
					p["port"], p["tallyCompany"] = pt, name
					return true
				}
				why = err
			}
			setStatus("waiting", waitingLine(asked, why))
			if !pause(waitPause(round)) {
				cancelled()
				return false
			}
			round++
			why = nil
		}
	}
	setRes()
	if err := postingAllowed(); err != nil {
		finish("failed", "Failed: "+err.Error())
		return
	}
	// round 11: PostOnly: a posting aimed at a company this computer may not post to is refused here, before one request
	// goes to Tally
	if why := postOnlyRefusal(asked); why != "" {
		for _, it := range itemsToSend(all, results) {
			results = append(results, M{"id": it["id"], "kind": it["kind"], "ok": false, "refused": true, "postOnly": true, "state": "failed", "message": why})
		}
		writeLog("Posting job " + jobID + ": " + why)
		finish("failed", why)
		return
	}
	if !waitTally(nil) {
		return
	}
	// only one bridge posts or reads a company at a time (the lease in FinCom's cloud)
	defer leaseRelease(asked)
	if !waitLease(asked, setStatus, pause) {
		cancelled()
		return
	}
	// the company's GUID: one light request before anything is sent; the one held for it, or the whole job is refused
	// with words and nothing is sent (a restored, re-created or other company of the same name); Tally not answering
	// the check is waited for
	for {
		g, err := companyCheck(fin, company, port)
		if err == nil {
			if gerr := guardCompanyGUID(company, g); gerr != nil {
				for _, it := range itemsToSend(all, results) {
					results = append(results, M{"id": it["id"], "kind": it["kind"], "ok": false, "guidMismatch": true, "message": "Not posted: " + gerr.Error()})
				}
				finish("failed", "Not posted: "+gerr.Error())
				return
			}
			break
		}
		if !waitTally(err) {
			return
		}
	}
	// one writer per Tally: wait for another posting to the same Tally to finish
	lk, _ := tallyWriter.LoadOrStore(port, &sync.Mutex{})
	wl := lk.(*sync.Mutex)
	if !wl.TryLock() {
		setStatus("waiting", "Waiting for Tally: another posting to this Tally is going on — this one follows by itself")
		wl.Lock()
	}
	defer wl.Unlock()
	keepAwake(true)
	defer keepAwake(false)
	todo := itemsToSend(all, results)
	// A5: this computer's record (sync\posted-ids.json): a voucher this computer already sent is refused, with the date
	// and Tally's id when known; nothing is asked of Tally. An owner's release handed with the job (the cloud is the
	// judge) lets an entry go once more
	{
		var left []M
		for _, it := range todo {
			k := str(it["id"])
			if str(it["kind"]) != "voucher" {
				left = append(left, it)
				continue
			}
			key := acceptedKey(k, str(it["xml"]))
			a := acceptedInfo(key)
			if a == nil {
				left = append(left, it)
				continue
			}
			if rel := releaseFor(arr(pl["released"]), key, k, a); rel != nil {
				writeLog("  entry " + k + ": released by " + or(str(rel["by"]), "the owner") + " at " + str(rel["at"]) + " (" + str(rel["why"]) + "); sent once more")
				acceptedHonour(key, rel)
				left = append(left, it)
				continue
			}
			r := sentBeforeRefusal(k, str(it["xml"]))
			r["company"], r["port"] = company, port
			results = append(results, r)
			writeLog("  voucher " + k + ": NOT SENT: " + str(r["message"]))
		}
		todo = left
	}
	// what cannot be sent at all (no valid date, not a voucher or master) is said now
	var masters, vouchers []M
	for _, it := range todo {
		x := str(it["xml"])
		if why := cannotSend(x); why != "" {
			results = append(results, M{"id": it["id"], "kind": it["kind"], "ok": false, "message": why})
			continue
		}
		if str(it["kind"]) == "master" {
			masters = append(masters, M{"id": it["id"], "xml": x})
		} else {
			vouchers = append(vouchers, M{"id": it["id"], "xml": x, "bank": it["bank"]})
		}
	}
	p["resumed"] = true
	save()
	// A3: the requests, planned once: each master on its own, the bills by PostBatchBills, the bank lines by PostBatchBank
	reqs := planImports(masters, vouchers)
	K := len(reqs)
	notes := arr(p["reqs"]) // a resumed job keeps the notes of the requests it sent before
	secondsTotal := num(p["secondsTotal"])
	nVouchers := 0
	total := toInt(p["total"])
	round = 0
	for i := 0; i < K; {
		if cancelled() || stopping() {
			return
		}
		if err := postingAllowed(); err != nil {
			finish("failed", "Failed: "+err.Error())
			return
		}
		// the port found again on every try; Tally gone meanwhile: waited for
		if !waitTally(nil) {
			return
		}
		if !waitLease(asked, setStatus, pause) {
			cancelled()
			return
		}
		r := reqs[i]
		for _, it := range r.items {
			sending[str(it["id"])] = true
		}
		setStatus("running", sendingLine(len(results)+1, total))
		save()
		// the request's ids on disk before it goes (finding 1): a restart mid-request finds them as inflight
		var inflight []any
		for _, it := range r.items {
			inflight = append(inflight, str(it["id"]))
		}
		p["inflight"] = inflight
		save()
		gate := postGate(port) // the browser's /import and this job never interleave a record check and a send
		gate.Lock()
		o := sendImport(port, company, jobID, r)
		gate.Unlock()
		p["inflight"] = []any{}
		what := fmt.Sprintf("%d vouchers", len(r.items))
		if r.kind == "master" {
			what = "1 master"
		}
		var res []M
		var note M
		switch {
		case o.err != nil && !tallyNoAnswer(o.err):
			// nothing reached Tally (refused here, Tally not reachable, or held after a timeout): the same request goes
			// again after a wait; nothing is recorded
			writeLog(fmt.Sprintf("Posting job %s: request %d of %d (%s) not sent: %s; waiting for Tally", jobID, i+1, K, what, tallyTrouble(o.err.Error())))
			for _, it := range r.items { // nothing reached Tally: the notes made before the send go again
				acceptedForget(acceptedKey(str(it["id"]), str(it["xml"])))
			}
			setStatus("waiting", waitingLine(asked, o.err))
			if !pause(waitPause(round)) {
				cancelled()
				return
			}
			round++
			continue
		case o.err != nil:
			// Tally took the request and did not answer: every entry of it is unknown, recorded as sent, never sent again;
			// no checking starts (the owner's Check Tally or the next comparison settles it)
			res = unknownResults(port, company, jobID, r, o.err, o.seconds)
			note = M{"n": len(r.items), "kind": r.kind, "seconds": o.seconds, "noAnswer": true, "created": 0, "altered": 0, "exceptions": 0, "ignored": 0, "errors": 0, "lastVchId": ""}
			writeLog(fmt.Sprintf("Posting job %s: request %d of %d: %s, no answer in %.1f s (%s); outcome unknown, recorded as sent, not sent again", jobID, i+1, K, what, o.seconds, tallyTrouble(o.err.Error())))
		default:
			res, note = o.results, o.note
			writeLog(fmt.Sprintf("Posting job %s: request %d of %d: %s in %.1f s (created %d, altered %d, exceptions %d, ignored %d, last Tally id %s)", jobID, i+1, K, what, o.seconds,
				toInt(note["created"]), toInt(note["altered"]), toInt(note["exceptions"]), toInt(note["ignored"]), or(str(note["lastVchId"]), "none")))
		}
		round = 0
		for _, x := range res {
			delete(sending, str(x["id"]))
			results = append(results, x)
		}
		if r.kind == "voucher" {
			nVouchers += len(r.items)
		}
		notes = append(notes, note)
		secondsTotal += o.seconds
		p["reqs"], p["secondsTotal"] = notes, round3(secondsTotal)
		p["message"] = sendingLine(minI(len(results)+1, total), total)
		save() // the cloud hears every request as it is answered (posts_update with seq)
		i++
	}
	writeLog(fmt.Sprintf("Posting job %s: %d requests, %d vouchers, %.1f s total", jobID, K, nVouchers, secondsTotal))
	// the end: "done" when anything was posted, or Tally created something of a request that needs review (neither
	// posted nor failed: "Posted N of M; K need review"); "failed" only when nothing was posted and nothing accepted (a
	// "failed" from the bridge stands in the cloud)
	okN, unknownN, reviewN, failN, acceptedN, first := 0, 0, 0, 0, 0, ""
	for _, r := range results {
		switch {
		case r["ok"] == true:
			okN++
		case r["outcomeUnknown"] == true:
			unknownN++ // sent, no answer: neither posted nor failed
		case r["needsReview"] == true:
			reviewN++
			if r["accepted"] == true {
				acceptedN++
			}
			if first == "" {
				first = str(r["message"])
			}
		default:
			failN++ // refused on the record, PostOnly, the GUID, or not sendable
			if first == "" {
				first = str(r["message"])
			}
		}
	}
	p["checking"] = false
	// (review finding 2) a no-answer entry makes the job done too: on a failed row the cloud would free its id
	if okN > 0 || acceptedN > 0 || unknownN > 0 {
		finish("done", postedLine(okN, total, reviewN, unknownN))
	} else if failN+reviewN > 0 {
		finish("failed", jobFailedLine(failN+reviewN, total, first))
	} else {
		finish("done", postedLine(okN, total, reviewN, unknownN))
	}
}

// the lease on the company (FinCom's cloud): taken or renewed; while another bridge holds it the posting waits.
// false: the job is to stop (cancelled, or the bridge stops)
func waitLease(company string, setStatus func(string, string), pause func(time.Duration) bool) bool {
	for r := 0; ; r++ {
		ok, who := leaseTake(company)
		if ok {
			return true
		}
		setStatus("waiting", "Waiting: another FinCom Bridge ("+who+") is posting to or reading "+company+" now — this one follows by itself")
		if !pause(waitPause(r)) {
			return false
		}
	}
}
