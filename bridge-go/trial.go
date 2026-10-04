// Round 19 (2.1.9, the owner's question of 04-Oct-2026: "can the add-on hang or slow Tally"): two more tray items of
// the recorder trial, for a person only (as the other trial items: a web page, FinCom's own included, is refused):
//   - "Recorder trial: lock the holding file for 30 s": ZZ TEST's holding file in the recorder folder (<GUID>.txt, the
//     GUID the bridge holds for ZZ TEST) opened with share mode 0 for exactly 30 s, then let go (a timer; released at
//     once when the bridge stops). Meanwhile the owner saves a voucher in ZZ TEST and sees whether Tally waits, shows a
//     message, or writes to failed.txt. This is the only time the bridge holds a holding file, and only on the owner's
//     click; it never writes to it.
//   - "Recorder trial: time saving (ZZ TEST)": through the import request (importEnvelope) and invokeTally, the two
//     bench ledgers made when missing ("ZZ Bench Dr" under Indirect Expenses, "ZZ Bench Cr" under Sundry Creditors),
//     then 50 small journals (2 lines) and 50 journals of 50 lines (49 debits on ZZ Bench Dr, one credit), one per
//     request, narration "FinCom bench <n>", dated today. Per kind: the median and 90th percentile of the milliseconds
//     per request and the total, in the log and the tray's box. Run with the add-on loaded and again without it. Nothing
//     is noted as a posting (no read-back, nothing for the cloud); no FinCom tag; ZZ TEST only; allowed with ReadDays off
//     (it reads no entries, only the ledger list to see whether the bench ledgers exist).
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const benchCompany = "ZZ TEST"

// --- the lock
var (
	recorderLockFor = 30 * time.Second
	recLockMu       sync.Mutex
	recLockBusy     bool
)

// the lock taken (answers once it is held, or with why not); it lets go by itself after recorderLockFor
func recorderLockHolding(company string) (M, error) {
	if company == "" {
		company = benchCompany
	}
	if company != benchCompany {
		return nil, errors.New("The holding file is locked for " + benchCompany + " only.")
	}
	guid := heldGUID(benchCompany)
	if !plainFileName(guid) {
		return nil, errors.New("The bridge does not hold " + benchCompany + "'s Tally GUID yet: open " + benchCompany + " in Tally, wait a minute, then try again.")
	}
	p := filepath.Join(recorderDirFn(), guid+".txt")
	if fi, err := os.Lstat(p); err != nil || !fi.Mode().IsRegular() || isReparse(p, fi) {
		return nil, errors.New("No holding file for " + benchCompany + " (" + p + "): load the add-on and save one voucher in " + benchCompany + " first.")
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
)

// for the tray's yes/no: the company it would run on, or why not
func benchCheck(company string) error {
	if company != benchCompany {
		return errors.New("Time saving runs on " + benchCompany + " only.")
	}
	if open := trayMeasureCompany(); open != benchCompany {
		return errors.New("Open " + benchCompany + " in Tally first (the company open now: " + or(open, "none") + ").")
	}
	return postingAllowedFor(benchCompany)
}

func startBench(company string) M {
	if err := benchCheck(company); err != nil {
		return M{"ok": false, "error": err.Error()}
	}
	benchMu.Lock()
	defer benchMu.Unlock()
	if benchLast != nil && str(benchLast["state"]) == "running" {
		return M{"ok": false, "error": "Time saving is already running; wait for its message box."}
	}
	benchLast = M{"ok": true, "state": "running", "company": company, "at": nowS()}
	go func() {
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

// a person's request (the tray item): no read-back afterwards (TC.bench), nothing for the cloud
var benchTC = &TC{person: true, bench: true}

const benchDr, benchCr = "ZZ Bench Dr", "ZZ Bench Cr"

func benchLine(ledger string, debit bool, amt string) string {
	if debit {
		return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + esc(ledger) + "</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-" + amt + "</AMOUNT></ALLLEDGERENTRIES.LIST>"
	}
	return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + esc(ledger) + "</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>" + amt + "</AMOUNT></ALLLEDGERENTRIES.LIST>"
}

// one journal: debits lines of 1.00 on ZZ Bench Dr and one credit of the total on ZZ Bench Cr
func benchVoucher(n, debits int, date string) string {
	var b strings.Builder
	b.WriteString(`<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>` + date + `</DATE><EFFECTIVEDATE>` + date + `</EFFECTIVEDATE>`)
	b.WriteString(fmt.Sprintf(`<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>FinCom bench %d</NARRATION><ISOPTIONAL>No</ISOPTIONAL>`, n))
	for i := 0; i < debits; i++ {
		b.WriteString(benchLine(benchDr, true, "1.00"))
	}
	b.WriteString(benchLine(benchCr, false, fmt.Sprintf("%d.00", debits)))
	b.WriteString("</VOUCHER>")
	return importEnvelope("Vouchers", benchCompany, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+b.String()+"</TALLYMESSAGE>")
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
			raw, err := invokeTally(benchTC, port, benchVoucher(k.from+i, k.debits, td), 0)
			ms = append(ms, time.Since(t0).Milliseconds())
			if err != nil {
				return nil, fmt.Errorf("Tally did not answer request %d of the %s: %s (the run stopped there)", i+1, k.what, tallyTrouble(err.Error()))
			}
			if toInt(group(`<CREATED>\s*(\d+)`, raw, 1)) != 1 {
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
