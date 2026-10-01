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
		return jobView(dir), nil
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
			items = append(items, M{"id": str(o["id"]), "kind": "voucher", "xml": str(o["xml"])})
		}
	}
	_ = saveFile(filepath.Join(dir, "payload.json"), jsonText(M{"company": str(pl["company"]), "port": toInt(pl["port"]), "ledger": str(pl["ledger"]), "checkFirst": truthy(pl["checkFirst"]), "items": items}))
	p := M{"ok": true, "id": id, "status": "queued", "company": str(pl["company"]), "port": 0, "total": len(items), "done": 0, "results": []any{}, "message": "Starting", "pid": os.Getpid(), "resumed": false,
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

// keep the computer awake while posting
func jobWorker(dir string) {
	p := readProgress(dir)
	pl := readObjFile(filepath.Join(dir, "payload.json"))
	if p == nil || pl == nil {
		return
	}
	company, ledger := str(pl["company"]), str(pl["ledger"])
	p["pid"], p["status"], p["message"] = os.Getpid(), "waiting", "Finding the company in Tally"
	var results []M
	for _, r := range arr(p["results"]) {
		if o := obj(r); o != nil {
			results = append(results, o)
		}
	}
	doneIDs := map[string]bool{}
	for _, r := range results {
		doneIDs[str(r["id"])] = true
	}
	setRes := func() {
		a := make([]any, len(results))
		for i, r := range results {
			a[i] = r
		}
		p["results"] = a
		p["done"] = len(results)
	}
	setRes()
	writeProgress(dir, p)
	port := 0
	for t := 0; t < 20; t++ {
		pt, err := findCompanyPort(company, toInt(pl["port"]))
		if err == nil {
			port = pt
			break
		}
		p["message"] = "Waiting for Tally: " + tallyTrouble(err.Error())
		writeProgress(dir, p)
		time.Sleep(6 * time.Second)
	}
	if port == 0 {
		p["status"], p["message"], p["finishedAt"] = "failed", "Tally did not show "+company+" for two minutes. Open it in TallyPrime and post again.", time.Now().Format(time.RFC3339Nano)
		writeProgress(dir, p)
		return
	}
	p["port"] = port
	// one writer per Tally: wait for another posting to the same Tally to finish
	lk, _ := tallyWriter.LoadOrStore(port, &sync.Mutex{})
	wl := lk.(*sync.Mutex)
	if !wl.TryLock() {
		p["message"] = "Waiting for another posting to this Tally to finish"
		writeProgress(dir, p)
		wl.Lock()
	}
	defer wl.Unlock()
	keepAwake(true)
	defer keepAwake(false)
	fail := func(err error) {
		p["status"], p["message"], p["finishedAt"] = "failed", tallyTrouble(err.Error()), time.Now().Format(time.RFC3339Nano)
		setRes()
		writeProgress(dir, p)
		writeLog("Posting job " + str(p["id"]) + " failed: " + str(p["message"]))
	}
	if err := postingAllowed(); err != nil {
		fail(err)
		return
	}
	p["status"] = "running"
	var all, todo []M
	for _, x := range arr(pl["items"]) {
		if o := obj(x); o != nil {
			all = append(all, o)
			if !doneIDs[str(o["id"])] {
				todo = append(todo, o)
			}
		}
	}
	vouchersOf := func(a []M) []M {
		var o []M
		for _, x := range a {
			if str(x["kind"]) == "voucher" {
				o = append(o, x)
			}
		}
		return o
	}
	// resuming (or a posting queued in FinCom's cloud): whatever reached Tally before is counted, not sent again
	if len(results) > 0 || p["resumed"] == true || truthy(pl["checkFirst"]) {
		var there map[string]M
		for a := 0; there == nil && a < 6; a++ {
			there = findPostedTags(port, company, vouchersOf(todo), ledger)
			if there == nil {
				p["message"] = "Checking Tally for entries sent before the stop"
				writeProgress(dir, p)
				time.Sleep(time.Duration(5*(a+1)) * time.Second)
			}
		}
		if there == nil {
			fail(errors.New("Tally did not answer, so it cannot be told which entries arrived before the stop. Open Tally and resume again."))
			return
		}
		var left []M
		for _, it := range todo {
			if h, ok := there[str(it["id"])]; ok {
				results = append(results, M{"id": it["id"], "kind": "voucher", "ok": true, "verified": true, "alreadyThere": true, "vchNumber": str(h["number"]), "vchType": str(h["type"]),
					"masterId": str(h["masterId"]), "guid": str(h["guid"]), "vchDate": str(h["date"]), "message": "Already in Tally (sent before the stop)"})
			} else {
				left = append(left, it)
			}
		}
		todo = left
	}
	p["resumed"] = true
	setRes()
	p["message"] = "Posting"
	writeProgress(dir, p)
	queue := append([]M{}, todo...)
	tries := map[string]int{}
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
	for len(queue) > 0 {
		n := minI(jobChunk, len(queue))
		chunk := queue[:n]
		queue = append([]M{}, queue[n:]...)
		var masters, vouchers, fast []M
		for _, it := range chunk {
			if str(it["kind"]) == "master" {
				masters = append(masters, it)
			} else {
				vouchers = append(vouchers, it)
			}
		}
		done := toInt(p["done"])
		p["message"] = fmt.Sprintf("Posting %d to %d of %d", done+1, done+len(chunk), toInt(p["total"]))
		writeProgress(dir, p)
		var res []M
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
			var b strings.Builder
			for _, v := range fast {
				b.WriteString(`<TALLYMESSAGE xmlns:UDF="TallyUDF">` + str(v["xml"]) + "</TALLYMESSAGE>")
			}
			var rr M
			why := ""
			if raw, err := invokeTally(fin, port, importEnvelope("Vouchers", company, b.String()), 0); err == nil {
				rr = readImportResult(raw)
			} else {
				why = tallyTrouble(err.Error())
			}
			var there map[string]M
			if rr != nil && toInt(rr["created"]) == len(fast) && toInt(rr["errors"]) == 0 && toInt(rr["exceptions"]) == 0 {
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
							res = append(res, M{"id": k, "kind": "voucher", "ok": false, "verified": false, "message": "Tally replied 'created', but the entry cannot be found in '" + company + "'. It was not sent again: look for it in Tally (another company open in Tally, or an Optional voucher)."})
						} else {
							vouchers = append(vouchers, v)
						}
					}
				}
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
			r, err := invokeImport(M{"company": company, "port": port, "masters": ms, "vouchers": vs})
			if err != nil {
				msg := tallyTrouble(err.Error())
				res = nil
				for _, it := range chunk {
					res = append(res, M{"id": it["id"], "kind": it["kind"], "ok": false, "message": "Tally did not answer: " + msg})
				}
			} else {
				for _, x := range arr(r["results"]) {
					res = append(res, obj(x))
				}
			}
		}
		// no answer from Tally: look for it in Tally before sending it again, then try again (three times, waiting longer)
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
		if len(lostItems) > 0 {
			var there map[string]M
			waits := []int{3, 10, 20, 30, 45}
			for a := 0; there == nil && a < 5; a++ {
				there = findPostedTags(port, company, vouchersOf(lostItems), ledger)
				if there == nil {
					p["message"] = "Tally is busy: waiting to check what arrived"
					writeProgress(dir, p)
					time.Sleep(time.Duration(waits[a]) * time.Second)
				}
			}
			unsure := there == nil
			if unsure {
				there = map[string]M{}
			}
			var retry []M
			without := func(k string) {
				var o []M
				for _, r := range res {
					if str(r["id"]) != k {
						o = append(o, r)
					}
				}
				res = o
			}
			for _, it := range lostItems {
				k := str(it["id"])
				if h, ok := there[k]; ok {
					without(k)
					res = append(res, M{"id": k, "kind": "voucher", "ok": true, "verified": true, "vchNumber": str(h["number"]), "vchType": str(h["type"]), "masterId": str(h["masterId"]), "guid": str(h["guid"]), "vchDate": str(h["date"]), "message": "Created (Tally answered late)"})
				} else if unsure && str(it["kind"]) == "voucher" {
					for _, r := range res {
						if str(r["id"]) == k {
							r["message"] = "Tally did not answer, and did not answer a check either, so it is not known whether this entry arrived. It was not sent again: look in Tally before posting it again."
							r["unsure"] = true
						}
					}
				} else if tries[k] < 3 {
					tries[k]++
					without(k)
					retry = append(retry, it)
				} else {
					for _, r := range res {
						if str(r["id"]) == k {
							r["message"] = str(r["message"]) + " (tried 4 times)"
						}
					}
				}
			}
			if len(retry) > 0 {
				w := []int{3, 10, 30}[minI(2, tries[str(retry[0]["id"])]-1)]
				p["message"] = fmt.Sprintf("Tally is busy: trying %d again in %d seconds", len(retry), w)
				writeProgress(dir, p)
				time.Sleep(time.Duration(w) * time.Second)
				queue = append(retry, queue...)
			}
		}
		for _, r := range res {
			delete(r, "replySnip")
			results = append(results, r)
		}
		setRes()
		writeProgress(dir, p)
	}
	// sending is finished: FinCom shows it at once; the read-back runs after, in one read
	okN := func() int {
		n := 0
		for _, r := range results {
			if r["ok"] == true {
				n++
			}
		}
		return n
	}
	p["status"], p["checking"] = "done", len(toConfirm) > 0
	p["message"] = fmt.Sprintf("%d of %d sent to Tally", okN(), toInt(p["total"]))
	p["finishedAt"] = time.Now().Format(time.RFC3339Nano)
	setRes()
	writeProgress(dir, p)
	if len(toConfirm) > 0 {
		confirmPosted(port, company, toConfirm, results, all, ledger)
		for _, r := range results {
			delete(r, "pendingCheck")
		}
		p["checking"] = false
		p["message"] = fmt.Sprintf("%d of %d in Tally", okN(), toInt(p["total"]))
		setRes()
		writeProgress(dir, p)
	}
	writeLog("Posting job " + str(p["id"]) + " finished: " + str(p["message"]))
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
			r["ok"], r["verified"] = false, false
			r["message"] = "Tally replied 'created', but the entry cannot be found in '" + company + "'. It was not sent again: look for it in Tally (another company open in Tally, or an Optional voucher)."
		}
	}
}
