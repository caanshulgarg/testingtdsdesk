// Round 19 (2.1.9, the owner's question of 04-Oct-2026: "can the add-on hang or slow Tally"): two more tray items of
// the recorder trial, for a person only (as the other trial items: a web page, FinCom's own included, is refused).
// Round 21 (2.1.10, the owner's decision of 04-Oct-2026): no company-name check anywhere; they work on the company asked
// for, the one open in Tally (the trial runs on the company the owner tests on, linked to a FinCom client); owner only
// (FinCom's "Trial tools on this computer" switch, below); anything that adds entries asks first, naming the company,
// and marks them TRIAL:
//   - "Recorder trial: lock the holding file for 30 s": the open company's holding file in the recorder folder
//     (<GUID>.txt, the GUID the bridge holds for it) opened with share mode 0 for exactly 30 s, then let go (a timer;
//     released at once when the bridge stops). Meanwhile the owner saves a voucher in that company and sees whether
//     Tally waits, shows a message, or writes to failed.txt. This is the only time the bridge holds a holding file, and
//     only on the owner's click; it never writes to it.
//   - "Recorder trial: time saving": after the yes/no "This will add 100 test entries (and 2 ledgers if missing) to
//     <company>. Continue?", through the import request (importEnvelope) and invokeTally, the two bench ledgers made
//     when missing ("TRIAL Bench Dr" under Indirect Expenses, "TRIAL Bench Cr" under Sundry Creditors), then 50 small
//     journals (2 lines) and 50 journals of 50 lines (49 debits on TRIAL Bench Dr, one credit), one per request,
//     narration "TRIAL FinCom bench <n>", dated today. Per kind: the median and 90th percentile of the milliseconds
//     per request and the total, in the log and the tray's box. Run with the add-on loaded and again without it.
//     Nothing is noted as a posting (no read-back, nothing for the cloud); no FinCom tag; PostOnly (the owner's
//     per-computer setting) still applies; allowed with ReadDays off (it reads no entries, only the ledger list to see
//     whether the bench ledgers exist).
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// --- the lock
var (
	recorderLockFor = 30 * time.Second
	recLockMu       sync.Mutex
	recLockBusy     bool
)

// the lock taken (answers once it is held, or with why not); it lets go by itself after recorderLockFor
func recorderLockHolding(company string) (M, error) {
	if company == "" {
		company = trayMeasureCompany()
	}
	if company == "" {
		return nil, errors.New("No company is open in Tally: open the company you test on, then try again.")
	}
	// round 20 (the re-review's Medium 1): the recorder folder and C:\ProgramData\FinCom checked first
	dir, ok := recorderDirChecked()
	if !ok {
		return nil, errors.New("The recorder folder " + recorderDirFn() + " is not there or is not safe to use (see the log): nothing is locked.")
	}
	guid := heldGUID(company)
	if !plainFileName(guid) {
		return nil, errors.New("The bridge does not hold " + company + "'s Tally GUID yet: open " + company + " in Tally, wait a minute, then try again.")
	}
	p := filepath.Join(dir, guid+".txt")
	if fi, err := os.Lstat(p); err != nil || !fi.Mode().IsRegular() || isReparse(p, fi) {
		return nil, errors.New("No holding file for " + company + " (" + p + "): load the add-on and save one voucher in " + company + " first.")
	}
	recLockMu.Lock()
	if recLockBusy {
		recLockMu.Unlock()
		return nil, errors.New("The holding file is already locked; wait for the 30 seconds to end.")
	}
	recLockBusy = true
	recLockMu.Unlock()
	d := recorderLockFor
	held := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		defer func() {
			recLockMu.Lock()
			recLockBusy = false
			recLockMu.Unlock()
		}()
		err := lockExclusive(p, d, func() {
			writeLog(fmt.Sprintf("Recorder trial: the holding file %s is locked (share mode 0) for %s", p, d))
			close(held)
		})
		if err == nil {
			writeLog("Recorder trial: the holding file " + p + " is released")
		}
		done <- err
	}()
	select {
	case <-held:
		return M{"ok": true, "file": p, "seconds": d.Seconds()}, nil
	case err := <-done:
		if err == nil {
			err = errors.New("the lock ended at once")
		}
		return nil, errors.New("The holding file could not be locked: " + err.Error())
	}
}

// --- the time saving
var (
	benchMu   sync.Mutex
	benchLast M
	// round 22 (the 2.1.10 code review's Low 5): true while the time saving runs; postingGoing counts it, so the light
	// check (and its company-list refresh) does not go between the imports it times
	benchRunning atomic.Bool
)

// for the tray's yes/no: the company it would run on, or why not
func benchCheck(company string) error {
	open := trayMeasureCompany()
	if company == "" {
		company = open
	}
	if company == "" {
		return errors.New("No company is open in Tally: open the company you test on, then try again.")
	}
	if open == "" || !sameCompany(open, company) {
		return errors.New("Open " + company + " in Tally first (the company open now: " + or(open, "none") + ").")
	}
	return postingAllowedFor(company)
}

func startBench(company string) M {
	if company == "" {
		company = trayMeasureCompany()
	}
	if err := benchCheck(company); err != nil {
		return M{"ok": false, "error": err.Error()}
	}
	benchMu.Lock()
	defer benchMu.Unlock()
	if benchLast != nil && str(benchLast["state"]) == "running" {
		return M{"ok": false, "error": "Time saving is already running; wait for its message box."}
	}
	benchLast = M{"ok": true, "state": "running", "company": company, "at": nowS()}
	benchRunning.Store(true) // round 22: a posting going (postingGoing) until it ends
	go func() {
		defer benchRunning.Store(false)
		r, err := runBench(company)
		benchMu.Lock()
		defer benchMu.Unlock()
		if err != nil {
			benchLast = M{"ok": false, "state": "failed", "error": err.Error(), "company": company, "at": nowS()}
			return
		}
		r["state"] = "done"
		benchLast = r
	}()
	return M{"ok": true, "started": true, "company": company}
}

func benchStatus() M {
	benchMu.Lock()
	defer benchMu.Unlock()
	if benchLast == nil {
		return M{"ok": true, "state": "none"}
	}
	return benchLast
}

// the tray item's requests: no read-back afterwards (TC.bench), nothing for the cloud. Round 20 (the re-review's Low 4):
// not a "person" request: the bench sends only imports (no period), so a dated request added here later is still
// refused while ReadDays is off
var benchTC = &TC{bench: true}

const benchDr, benchCr = "TRIAL Bench Dr", "TRIAL Bench Cr"

func benchLine(ledger string, debit bool, amt string) string {
	if debit {
		return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + esc(ledger) + "</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-" + amt + "</AMOUNT></ALLLEDGERENTRIES.LIST>"
	}
	return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + esc(ledger) + "</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>" + amt + "</AMOUNT></ALLLEDGERENTRIES.LIST>"
}

// one journal: debits lines of 1.00 on TRIAL Bench Dr and one credit of the total on TRIAL Bench Cr, narration
// "TRIAL FinCom bench <n>", in the company asked for
func benchVoucher(company string, n, debits int, date string) string {
	var b strings.Builder
	b.WriteString(`<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>` + date + `</DATE><EFFECTIVEDATE>` + date + `</EFFECTIVEDATE>`)
	b.WriteString(fmt.Sprintf(`<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>TRIAL FinCom bench %d</NARRATION><ISOPTIONAL>No</ISOPTIONAL>`, n))
	for i := 0; i < debits; i++ {
		b.WriteString(benchLine(benchDr, true, "1.00"))
	}
	b.WriteString(benchLine(benchCr, false, fmt.Sprintf("%d.00", debits)))
	b.WriteString("</VOUCHER>")
	return importEnvelope("Vouchers", company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+b.String()+"</TALLYMESSAGE>")
}

// the median, 90th percentile and total of the times (ms)
func benchSummary(ms []int64) M {
	s := append([]int64{}, ms...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	var tot int64
	for _, x := range s {
		tot += x
	}
	at := func(q float64) int64 {
		if len(s) == 0 {
			return 0
		}
		i := int(q*float64(len(s))+0.999999) - 1
		if i < 0 {
			i = 0
		}
		if i >= len(s) {
			i = len(s) - 1
		}
		return s[i]
	}
	return M{"requests": len(s), "medianMs": at(0.5), "p90Ms": at(0.9), "totalMs": tot}
}

func runBench(company string) (M, error) {
	if err := benchCheck(company); err != nil {
		return nil, err
	}
	port, err := findCompanyPort(company, 0)
	if err != nil {
		return nil, err
	}
	g, err := companyCheck(fin, company, port)
	if err != nil {
		return nil, errors.New("Tally did not answer the company check: " + tallyTrouble(err.Error()))
	}
	if err := guardCompanyGUID(company, g); err != nil {
		return nil, err
	}
	gate := postGate(port)
	gate.Lock()
	defer gate.Unlock()
	pre := "Recorder trial: time saving (" + company + "): "
	// the two ledgers, when missing
	have := map[string]bool{}
	// the ledger list the bridge reads on every run (FinComLedgers, stored master fields, in chunks)
	if nodes, err := ledgerChunks(fin, company, port, ledgerChunkRequest); err == nil {
		for _, l := range nodes {
			have[nameOf(l)] = true
		}
	} else {
		return nil, errors.New("Tally did not give its ledger list: " + tallyTrouble(err.Error()))
	}
	var led strings.Builder
	for _, l := range []struct{ name, parent string }{{benchDr, "Indirect Expenses"}, {benchCr, "Sundry Creditors"}} {
		if !have[l.name] {
			led.WriteString(`<LEDGER NAME="` + esc(l.name) + `" ACTION="Create"><NAME>` + esc(l.name) + `</NAME><PARENT>` + esc(l.parent) + `</PARENT></LEDGER>`)
		}
	}
	if led.Len() > 0 {
		raw, err := invokeTally(benchTC, port, importEnvelope("All Masters", company, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+led.String()+"</TALLYMESSAGE>"), 0)
		if err != nil {
			return nil, errors.New("The bench ledgers could not be made: " + tallyTrouble(err.Error()))
		}
		writeLog(pre + "the bench ledgers made: " + cut(flat(raw), 200))
	}
	td := today()
	out := M{"ok": true, "company": company}
	var lines []string
	for _, k := range []struct {
		key, what string
		debits    int
		from      int
	}{{"small", "small journals (2 lines)", 1, 1}, {"large", "journals of 50 lines", 49, 51}} {
		var ms []int64
		failed := 0
		for i := 0; i < 50; i++ {
			t0 := time.Now()
			raw, err := invokeTally(benchTC, port, benchVoucher(company, k.from+i, k.debits, td), 0)
			ms = append(ms, time.Since(t0).Milliseconds())
			if err != nil {
				return nil, fmt.Errorf("Tally did not answer request %d of the %s: %s (the run stopped there)", i+1, k.what, tallyTrouble(err.Error()))
			}
			if toInt(tagNum(raw, "CREATED")) != 1 {
				failed++
			}
		}
		s := benchSummary(ms)
		s["notCreated"] = failed
		out[k.key] = s
		line := fmt.Sprintf("%s: %d requests, median %d ms, 90th percentile %d ms, total %d ms; not created %d", k.what, toInt(s["requests"]), s["medianMs"], s["p90Ms"], s["totalMs"], failed)
		writeLog(pre + line)
		lines = append(lines, line)
	}
	out["lines"] = lines
	return out, nil
}

// --- round 21 (2.1.10, the owner's decision of 04-Oct-2026): the trial tools are the owner's, switched on per computer
// on FinCom's Tally page ("Trial tools on this computer", off by default). FinCom's answer to every heartbeat carries
// trialTools (absent: off), applied at once (the heartbeat turns every 30 s) and kept in memory only: after a restart
// they are off until the next answer. While off, the tray shows none of the five trial items and their /tray/ routes
// answer 403 with trialOffWords
var trialToolsOn atomic.Bool

func setTrialTools(on bool) { trialToolsOn.Store(on) }
func trialTools() bool      { return trialToolsOn.Load() }

const trialOffWords = "Trial tools are switched off for this computer in FinCom (Tally page, owner)"

// FinCom's answer to the heartbeat: trialTools true switches them on; false, absent or anything else, off. Round 22
// (the 2.1.10 reviews' Medium 1 / S1): nil (no answer) is off too; see trialToolsOff
func applyTrialTools(j M) {
	if j == nil {
		trialToolsOff("no answer from FinCom")
		return
	}
	on := j["trialTools"] == true
	if trialToolsOn.Swap(on) != on {
		if on {
			writeLog("Trial tools switched on for this computer in FinCom: the tray shows the trial items")
		} else {
			writeLog("Trial tools switched off for this computer in FinCom: the tray hides the trial items")
		}
	}
}

// round 22 (the 2.1.10 reviews' Medium 1 / S1): the tools are on only while FinCom's latest answer says so. Every
// heartbeat that does not bring a 200 answer with JSON (FinCom not reached, an error answer, a revoked key), the cloud
// link turned off or changed, and a bridge not connected at all turn them off at once (said once in the log); the next
// answer with trialTools: true turns them on again
func trialToolsOff(why string) {
	if trialToolsOn.Swap(false) {
		writeLog("Trial tools switched off (" + why + "): the tray hides the trial items until FinCom's answer says on")
	}
}

func trialToolsErr() error {
	if trialTools() {
		return nil
	}
	return &httpErr{403, M{"ok": false, "error": trialOffWords}}
}

// the time saving's yes/no, naming the company (the tray shows the bridge's words)
func benchConfirmText(company string) string {
	return "This will add 100 test entries (and 2 ledgers if missing) to " + company + ". Continue?"
}
