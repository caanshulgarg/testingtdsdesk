// Posting as a background job (bridge 1.12, jobs.ps1). FinCom hands a batch to POST /jobs and gets a job number at once.
// The job posts it in small batches, one writer per Tally at a time, and writes its progress to jobs\<id>\progress.json
// after every batch. The browser may close, the network may drop, the bridge may restart: the job goes on, or is
// resumed, and nothing is posted twice: anything whose answer was lost is looked for in Tally by its FinCom tag before
// it is sent again. The same job number sent again returns the same job.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const jobChunk = 25

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
	if st == "done" && p["checking"] == true && !jobAlive(id) && age > 5 {
		p["checking"], p["checkFailed"] = false, true
	}
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

// POST /jobs: {jobId, company, port, masters, vouchers, ledger, checkFirst}
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
		// Retry (the same job sent again after it failed or was cancelled): the entries not in Tally go again; whatever
		// reached Tally is found by its tag first and never sent twice
		if st := str(v["status"]); (st == "failed" || st == "cancelled") && !jobAlive(id) {
			var kept []any
			for _, r := range arr(v["results"]) {
				if confirmedResult(obj(r)) {
					kept = append(kept, r)
				}
			}
			if kept == nil {
				kept = []any{}
			}
			_ = os.Remove(filepath.Join(dir, "cancel"))
			v["results"], v["done"], v["resumed"], v["status"], v["message"], v["finishedAt"] = kept, len(kept), true, "queued", "Retrying", ""
			startJob(id, dir, v)
			writeLog(fmt.Sprintf("Posting job %s: retried (%d already in Tally kept)", id, len(kept)))
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
			items = append(items, M{"id": str(o["id"]), "kind": "voucher", "xml": x})
		}
	}
	// the port FinCom chose is kept only as a hint, and never as 0 (0 means "find it", which happens on every try anyway)
	payload := M{"company": str(pl["company"]), "ledger": str(pl["ledger"]), "checkFirst": truthy(pl["checkFirst"]), "items": items}
	if pt := toInt(pl["port"]); pt > 0 {
		payload["port"] = pt
	}
	_ = saveFile(filepath.Join(dir, "payload.json"), jsonText(payload))
	p := M{"ok": true, "id": id, "status": "queued", "company": str(pl["company"]), "total": len(items), "done": 0, "results": []any{}, "message": "Starting", "pid": os.Getpid(), "resumed": false,
		"startedAt": time.Now().Format(time.RFC3339Nano), "updatedAt": "", "finishedAt": "", "checking": false, "checkFailed": false}
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
// Tally's refusal of an entry (a ledger missing, a date outside the books) fails it, at once, with the reason for that
// entry; the others go on. Nothing is posted twice: whatever has a result is never sent again (the results are kept in
// progress.json across restarts), and before sending anything again after a stop or a lost answer, Tally is read for
// the entries' FinCom tags. The port is found again on every try (never only remembered).
func jobWorker(dir string) {
	p := readProgress(dir)
	pl := readObjFile(filepath.Join(dir, "payload.json"))
	if p == nil || pl == nil {
		return
	}
	asked, ledger := str(pl["company"]), str(pl["ledger"])
	hint := toInt(pl["port"])
	if pp := toInt(p["port"]); pp > 0 {
		hint = pp
	}
	p["pid"] = os.Getpid()
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
			if r != nil && r["outcomeUnknown"] == true {
				// sent when Tally stopped answering: looked for by its FinCom id before anything is sent again
				e["outcomeUnknown"], e["reason"] = true, unknownLine
				if r["accepted"] == true {
					// fault 1: Tally accepted it (CREATED with a voucher id): being checked, never sent again
					e["accepted"], e["lastVchId"], e["reason"] = true, str(r["lastVchId"]), "Tally accepted it (voucher id "+or(str(r["lastVchId"]), "not given")+"); being checked, not sent again"
				}
			} else if r != nil && r["ok"] != true {
				e["reason"] = failedLine(str(r["message"]))
				// 2.1.4: not posted by the duplicate check (FinCom marks the bill as in Tally, or offers Try again)
				if r["already"] == true {
					e["already"], e["guid"], e["vchNo"], e["vchDate"] = true, str(r["guid"]), str(r["vchNo"]), str(r["vchDate"])
				}
				if r["checkFailed"] == true {
					e["checkFailed"] = true
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
				writeLog("Posting job " + str(p["id"]) + ": " + msg)
			}
		}
	}
	finish := func(st, msg string) {
		p["status"], p["message"], p["finishedAt"] = st, msg, time.Now().Format(time.RFC3339Nano)
		save()
		writeLog("Posting job " + str(p["id"]) + " " + st + ": " + msg)
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
	if !waitTally(nil) {
		return
	}
	// only one bridge posts or reads a company at a time (the lease in FinCom's cloud)
	defer leaseRelease(asked)
	if !waitLease(asked, setStatus, pause) {
		cancelled()
		return
	}
	// the company's GUID: the one held for it, or nothing is posted (a restored, re-created or other company of the
	// same name); Tally not answering the check is waited for
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
	vouchersOf := func(a []M) []M {
		var o []M
		for _, x := range a {
			if str(x["kind"]) == "voucher" {
				o = append(o, x)
			}
		}
		return o
	}
	todo := itemsToSend(all, results)
	// resuming (or a posting queued in FinCom's cloud, or Retry): whatever reached Tally before is counted, not sent again.
	// Tally not answering this read is waited for, never guessed
	if len(results) > 0 || p["resumed"] == true || truthy(pl["checkFirst"]) {
		var there map[string]M
		for there == nil {
			there = findPostedTags(port, company, vouchersOf(todo), ledger)
			if there == nil {
				setStatus("waiting", waitingLine(asked, &tallyWait{"busy", "Tally did not answer the check for entries sent before"}))
				if !pause(waitPause(round)) || !waitTally(nil) {
					cancelled()
					return
				}
				round++
			}
		}
		var left []M
		for _, it := range todo {
			if h, ok := there[str(it["id"])]; ok {
				results = append(results, M{"id": it["id"], "kind": "voucher", "ok": true, "verified": true, "alreadyThere": true, "vchNumber": str(h["number"]), "vchType": str(h["type"]),
					"masterId": str(h["masterId"]), "guid": str(h["guid"]), "vchDate": str(h["date"]), "message": "Already in Tally (sent before)"})
			} else {
				left = append(left, it)
			}
		}
		todo = left
	}
	p["resumed"] = true
	round = 0
	save()
	queue := append([]M{}, todo...)
	// entries created before a stop but not yet read back are confirmed with the next read
	var toConfirm []string
	for _, r := range results {
		if r["ok"] == true && r["pendingCheck"] == true {
			toConfirm = append(toConfirm, str(r["id"]))
		}
	}
	isFast := func(x string) bool {
		return reTag.MatchString(x) && !re(`<ISOPTIONAL>\s*Yes`).MatchString(x) && re(`^\s*<VOUCHER\b`).MatchString(x) && re(`<DATE>\d{8}</DATE>`).MatchString(x)
	}
	lostRounds := 0
	for len(queue) > 0 {
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
		if lostRounds > 0 {
			// Tally lost answers last time: a pause first, so a busy Tally is not pressed
			setStatus("waiting", waitingLine(asked, &tallyWait{"busy", "Tally did not answer"}))
			if !pause(waitPause(lostRounds - 1)) {
				cancelled()
				return
			}
		}
		n := minI(jobChunk, len(queue))
		chunk := queue[:n]
		queue = append([]M{}, queue[n:]...)
		var masters, vouchers, fast []M
		for _, it := range chunk {
			sending[str(it["id"])] = true
			if str(it["kind"]) == "master" {
				masters = append(masters, it)
			} else {
				vouchers = append(vouchers, it)
			}
		}
		setStatus("running", sendingLine(len(results)+1, toInt(p["total"])))
		save()
		var res []M
		resIDs := map[string]bool{}
		live := func(r M) {
			// each entry as Tally answers it: FinCom sees it at once (a lost answer stays "sending" until checked)
			k := str(r["id"])
			if strings.HasPrefix(str(r["message"]), "Tally did not answer") || resIDs[k] {
				return
			}
			resIDs[k] = true
			delete(sending, k)
			results = append(results, r)
			p["message"] = sendingLine(minI(len(results)+1, toInt(p["total"])), toInt(p["total"]))
			save()
		}
		// the fast way: the batch's vouchers in one request, then each found in Tally by its tag
		for _, v := range vouchers {
			if isFast(str(v["xml"])) {
				fast = append(fast, v)
			}
		}
		if len(fast) >= 2 {
			fastIDs := map[string]bool{}
			for _, v := range fast {
				fastIDs[str(v["id"])] = true
			}
			var rest []M
			for _, v := range vouchers {
				if !fastIDs[str(v["id"])] {
					rest = append(rest, v)
				}
			}
			vouchers = rest
			// 2.1.4: each voucher looked for in Tally immediately before the batch is sent, under one gate per Tally
			// until the batch's import is answered; found, or the check not answered: not sent. The same voucher twice
			// in the batch: the second goes the one-by-one way after it, so it is checked once the first is in Tally
			gate := postGate(port)
			gate.Lock()
			var checked []M
			var keys []vchKey
			reads := map[string]dupRead{}
			for _, v := range fast {
				if d := dupCheckWith(port, company, str(v["id"]), str(v["xml"]), reads); d != nil {
					res = append(res, d)
					continue
				}
				if vs := xmlDoc(str(v["xml"])).All("VOUCHER"); len(vs) > 0 {
					kv := keyOfVoucher(vs[0])
					twin := false
					for _, o := range keys {
						if sameVoucher(kv, o) {
							twin = true
						}
					}
					if twin {
						vouchers = append(vouchers, v)
						continue
					}
					keys = append(keys, kv)
				}
				checked = append(checked, v)
			}
			fast = checked
			var b strings.Builder
			for _, v := range fast {
				b.WriteString(`<TALLYMESSAGE xmlns:UDF="TallyUDF">` + str(v["xml"]) + "</TALLYMESSAGE>")
			}
			var rr M
			why := ""
			if len(fast) > 0 {
				if raw, err := invokeTally(fin, port, importEnvelope("Vouchers", company, b.String()), 0); err == nil {
					rr = readImportResult(raw)
				} else {
					why = tallyTrouble(err.Error())
				}
			}
			gate.Unlock()
			var there map[string]M
			if len(fast) == 0 {
				// nothing left to send in the batch
			} else if rr != nil && toInt(rr["created"]) == len(fast) && toInt(rr["errors"]) == 0 && toInt(rr["exceptions"]) == 0 {
				// Tally made every one: counted now, read back with the next batch check
				for _, v := range fast {
					res = append(res, M{"id": str(v["id"]), "kind": "voucher", "ok": true, "verified": nil, "pendingCheck": true, "created": 1, "company": company, "port": port, "vchNumber": "", "vchType": "", "masterId": "", "guid": "", "vchDate": "", "message": ""})
					toConfirm = append(toConfirm, str(v["id"]))
				}
				fast = nil
			} else if rr != nil {
				there = findPostedTags(port, company, fast, ledger)
			}
			if len(fast) > 0 {
				if there == nil {
					if rr != nil {
						why = "Tally did not answer the check after posting"
					}
					for _, v := range fast {
						res = append(res, M{"id": str(v["id"]), "kind": "voucher", "ok": false, "message": "Tally did not answer: " + why})
					}
				} else {
					for _, v := range fast {
						k := str(v["id"])
						if h, ok := there[k]; ok {
							res = append(res, M{"id": k, "kind": "voucher", "ok": true, "verified": true, "created": 1, "company": company, "port": port, "vchNumber": str(h["number"]), "vchType": str(h["type"]), "masterId": str(h["masterId"]), "guid": str(h["guid"]), "vchDate": str(h["date"]), "message": ""})
						} else if toInt(rr["created"]) >= len(fast) {
							// fault 1: Tally made it (CREATED counts every one): never failed, never sent again; checked later
							r := M{"id": k, "kind": "voucher", "created": 1, "company": company, "port": port, "xml": str(v["xml"])}
							lv := ""
							if len(fast) == 1 {
								lv = str(rr["lastVchId"]) // one entry: Tally's last voucher id is its own
							}
							markAccepted(r, company, lv, nil, "not asked yet")
							delete(r, "xml")
							res = append(res, r)
						} else {
							vouchers = append(vouchers, v)
						}
					}
				}
			}
			for _, r := range res {
				live(r)
			}
		}
		if len(masters)+len(vouchers) > 0 {
			ms, vs := []any{}, []any{}
			for _, m := range masters {
				ms = append(ms, M{"id": m["id"], "xml": m["xml"]})
			}
			for _, v := range vouchers {
				vs = append(vs, M{"id": v["id"], "xml": v["xml"]})
			}
			r, err := invokeImport(M{"company": company, "port": port, "masters": ms, "vouchers": vs, "guidChecked": true, "onItem": func(x M) {
				// "created" is shown at once; its read-back follows for the whole batch
				if x["ok"] != true {
					live(x)
				}
			}})
			if err != nil {
				msg := tallyTrouble(err.Error())
				for _, it := range append(append([]M{}, masters...), vouchers...) {
					if !resIDs[str(it["id"])] {
						res = append(res, M{"id": it["id"], "kind": it["kind"], "ok": false, "message": "Tally did not answer: " + msg})
					}
				}
			} else {
				for _, x := range arr(r["results"]) {
					res = append(res, obj(x))
				}
			}
		}
		// no answer from Tally: it is looked for in Tally (by its tag) before it is sent again; until Tally answers that
		// read, the posting waits. Nothing is sent again on a guess
		var lostItems []M
		lostIDs := map[string]bool{}
		for _, r := range res {
			if r["ok"] != true && strings.HasPrefix(str(r["message"]), "Tally did not answer") {
				lostIDs[str(r["id"])] = true
			}
		}
		for _, it := range chunk {
			if lostIDs[str(it["id"])] {
				lostItems = append(lostItems, it)
			}
		}
		var retry []M
		if len(lostItems) > 0 {
			lostRounds++
			// sent, but Tally did not answer: the outcome is unknown. Shown as "Checking whether it reached Tally" (state
			// unknown, outcomeUnknown) and never sent again until Tally answers and the entry is looked for by its FinCom id
			for _, it := range lostItems {
				k := str(it["id"])
				delete(sending, k)
				results = append(results, M{"id": k, "kind": str(it["kind"]), "ok": false, "outcomeUnknown": true, "state": "unknown", "message": unknownLine})
			}
			save()
			writeLog(fmt.Sprintf("Posting job %s: %d entr%s sent when Tally stopped answering; %s", str(p["id"]), len(lostItems), map[bool]string{true: "y", false: "ies"}[len(lostItems) == 1], strings.ToLower(unknownLine[:1])+unknownLine[1:]))
			var there map[string]M
			for there == nil {
				if !waitTally(nil) {
					return
				}
				there = findPostedTags(port, company, vouchersOf(lostItems), ledger)
				if there == nil {
					setStatus("waiting", unknownLine+": waiting for Tally to answer")
					if !pause(waitPause(round)) {
						cancelled()
						return
					}
					round++
				}
			}
			// resolved: the provisional results go
			var kept []M
			for _, r := range results {
				if !(r["outcomeUnknown"] == true && lostIDs[str(r["id"])]) {
					kept = append(kept, r)
				}
			}
			results = kept
			var keep []M
			for _, r := range res {
				if !lostIDs[str(r["id"])] {
					keep = append(keep, r)
				}
			}
			res = keep
			for _, it := range lostItems {
				k := str(it["id"])
				h, found := there[k]
				again, why := resendLost(it, true, found)
				switch {
				case found:
					res = append(res, M{"id": k, "kind": "voucher", "ok": true, "verified": true, "vchNumber": str(h["number"]), "vchType": str(h["type"]), "masterId": str(h["masterId"]), "guid": str(h["guid"]), "vchDate": str(h["date"]), "message": "Created (Tally answered late)"})
				case again:
					retry = append(retry, it)
				default:
					res = append(res, M{"id": k, "kind": str(it["kind"]), "ok": false, "unsure": true, "message": why})
				}
			}
			queue = append(retry, queue...)
		} else {
			lostRounds, round = 0, 0
		}
		for _, it := range retry {
			delete(sending, str(it["id"]))
		}
		for _, r := range res {
			delete(r, "replySnip")
			k := str(r["id"])
			delete(sending, k)
			if resIDs[k] {
				// shown live already: brought up to date (read back since)
				for i, x := range results {
					if str(x["id"]) == k {
						results[i] = r
					}
				}
				continue
			}
			resIDs[k] = true
			results = append(results, r)
		}
		save()
	}
	okN, failN, first := 0, 0, ""
	count := func() {
		okN, failN, first = 0, 0, ""
		for _, r := range results {
			if r["ok"] == true {
				okN++
			} else if r["accepted"] == true {
				// accepted by Tally, not confirmed yet: neither posted nor failed (unknown, being checked)
			} else {
				failN++
				if first == "" {
					first = str(r["message"])
				}
			}
		}
	}
	count()
	total := toInt(p["total"])
	// sending is finished: FinCom shows it at once; the read-back runs after, in one read
	p["checking"] = len(toConfirm) > 0
	if failN > 0 {
		finish("failed", jobFailedLine(failN, total, first))
	} else {
		finish("done", postedLine(okN, total, len(toConfirm) > 0))
	}
	if len(toConfirm) > 0 {
		confirmPosted(port, company, toConfirm, results, all, ledger)
		for _, r := range results {
			delete(r, "pendingCheck")
		}
		p["checking"] = false
		count()
		if failN > 0 {
			finish("failed", jobFailedLine(failN, total, first))
		} else {
			finish("done", postedLine(okN, total, len(acceptedUnconfirmed(results)) > 0))
		}
	}
	// fault 1 (03-Oct-2026): entries Tally accepted but the read-back could not confirm: the job stays checking and looks
	// for them again (by tag, then by Tally's voucher id) for about 20 minutes; they are never sent again either way
	if acc := acceptedUnconfirmed(results); len(acc) > 0 {
		p["checking"] = true
		count()
		if failN > 0 {
			finish("failed", jobFailedLine(failN, total, first))
		} else {
			finish("done", postedLine(okN, total, true))
		}
		writeLog(fmt.Sprintf("Posting job %s: %d entr%s accepted by Tally but not confirmed yet; checked again (never sent again)", str(p["id"]), len(acc), map[bool]string{true: "y", false: "ies"}[len(acc) == 1]))
		done := recheckAccepted(port, company, all, results, pause, save)
		if !done && (jobCancelled(dir) || stopping()) {
			// C8 (round 5): a cancel (or the bridge stopping) during the later checks only stops the checks: the posting
			// is done already and stays so, every result kept; the entries still unknown are looked for by Check Tally
			writeLog("Posting job " + str(p["id"]) + ": the later checks stopped (cancelled in FinCom, or the bridge is stopping); the posting stays done, nothing is sent again")
		}
		if done {
			p["checking"] = false
		}
		count()
		if failN > 0 {
			finish("failed", jobFailedLine(failN, total, first))
		} else {
			finish("done", postedLine(okN, total, !done))
		}
	}
}

// entries Tally said it created are read back together: found -> confirmed with Tally's voucher number; not found ->
// not sent again, said so; no answer -> left unconfirmed
func confirmPosted(port int, company string, pending []string, results []M, items []M, ledger string) {
	byID := map[string]M{}
	for _, it := range items {
		byID[str(it["id"])] = it
	}
	var want []M
	for _, k := range pending {
		if it := byID[k]; it != nil {
			want = append(want, it)
		}
	}
	var there map[string]M
	waits := []int{2, 5, 10, 20}
	for a := 0; there == nil && a < 4; a++ {
		there = findPostedTags(port, company, want, ledger)
		if there == nil {
			time.Sleep(time.Duration(waits[a]) * time.Second)
		}
	}
	for _, r := range results {
		k := str(r["id"])
		if !contains(pending, k) {
			continue
		}
		if there == nil {
			r["verified"] = nil
			r["message"] = "Tally said it created this, but did not answer the check afterwards. Use 'Check Tally' before posting it again."
		} else if h, ok := there[k]; ok {
			if it := byID[k]; it != nil {
				addPostedForCopy(company, h, str(it["xml"]))
			}
			r["verified"], r["vchNumber"], r["vchType"], r["masterId"], r["guid"], r["vchDate"], r["message"] = true, str(h["number"]), str(h["type"]), str(h["masterId"]), str(h["guid"]), str(h["date"]), ""
		} else {
			// fault 1: Tally made it: never failed, never sent again; looked for again later (by tag and by voucher id)
			if it := byID[k]; it != nil {
				r["xml"] = str(it["xml"])
			}
			markAccepted(r, company, str(r["lastVchId"]), nil, "not asked yet")
			delete(r, "xml")
		}
	}
}

// the pauses between the later checks of an accepted, unconfirmed entry (fault 1): 2 s to 10 min, about 20 minutes in
// all; PostRecheckMs (tests) makes every pause that long, PostRecheckTries that many
func recheckPauses() []time.Duration {
	n := keepNum("PostRecheckTries", 0)
	if ms := keepNum("PostRecheckMs", 0); ms > 0 {
		if n <= 0 {
			n = 4
		}
		o := make([]time.Duration, n)
		for i := range o {
			o[i] = time.Duration(ms) * time.Millisecond
		}
		return o
	}
	o := []time.Duration{2 * time.Second, 5 * time.Second, 10 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute, 10 * time.Minute}
	if n > 0 && n < len(o) {
		o = o[:n]
	}
	return o
}

// the entries Tally accepted that are not confirmed yet, looked for again: by the tag on their date, then by Tally's
// voucher id in their month; each one found is confirmed in place. true when none is left
func recheckAccepted(port int, company string, items []M, results []M, pause func(time.Duration) bool, save func()) bool {
	byID := map[string]M{}
	for _, it := range items {
		byID[str(it["id"])] = it
	}
	left := acceptedUnconfirmed(results)
	if len(left) == 0 {
		return true
	}
	for i, d := range recheckPauses() {
		if !pause(d) {
			return false
		}
		var still []M
		for _, r := range left {
			k := str(r["id"])
			xml := ""
			if it := byID[k]; it != nil {
				xml = str(it["xml"])
			}
			h, how, err := findAccepted(port, company, xml, str(r["lastVchId"]))
			switch {
			case err != nil:
				writeLog(fmt.Sprintf("  voucher %s: check %d: Tally did not answer (%s); checked again later", k, i+1, cut(err.Error(), 100)))
				still = append(still, r)
			case h == nil:
				writeLog(fmt.Sprintf("  voucher %s: check %d: not found yet by its tag on its date nor by Tally's voucher id %s; checked again later, not sent again", k, i+1, or(str(r["lastVchId"]), "none")))
				still = append(still, r)
			default:
				addPostedForCopy(company, h, xml)
				r["ok"], r["verified"], r["optional"] = true, true, strings.EqualFold(str(h["optional"]), "yes")
				r["vchNumber"], r["vchType"], r["guid"], r["masterId"], r["vchDate"] = str(h["number"]), str(h["type"]), str(h["guid"]), str(h["masterId"]), str(h["date"])
				delete(r, "outcomeUnknown")
				delete(r, "state")
				r["message"] = ""
				writeLog(fmt.Sprintf("  voucher %s: confirmed in Tally at check %d by its %s (%s no. %s, voucher id %s)", k, i+1, how, str(h["type"]), str(h["number"]), str(h["masterId"])))
			}
		}
		left = still
		save()
		if len(left) == 0 {
			return true
		}
	}
	for _, r := range left {
		writeLog(fmt.Sprintf("  voucher %s: still not confirmed after the checks; it stays unknown (accepted by Tally, voucher id %s) and is never sent again; Check Tally in FinCom looks again", str(r["id"]), or(str(r["lastVchId"]), "none")))
	}
	return false
}

// a posting sent when Tally stopped answering: what FinCom shows until it is found in Tally or sent again
const unknownLine = "Checking whether it reached Tally"

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
