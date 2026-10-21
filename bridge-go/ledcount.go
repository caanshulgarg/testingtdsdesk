// FinCom Bridge 2.4.5 (ROUND 102; the owner's approval of 21-Oct-2026, F3): the exact ledger count for Connect Tally's
// step-5 bar, "312 of 1,240 ledgers".
//
//  1. The count: FinComLedgerIds, Tally's Ledger collection with MASTERID only ($MasterID > 0), the rows of the answer
//     counted (Tally's own CMPINFO <LEDGER> number is never used: it is not the ledger count). No computed figure. Under
//     the 2 s hard stop. Stopped: the same id in chunks of 2,000 MasterIDs ($MasterID > a AND $MasterID <= a+2000, the
//     ledger read's own shape), each under the 2 s stop; a chunk stopped too: no count this round (the bar runs without
//     "of N", as before) and it is asked again next round. Never shown as an error.
//  2. The read (FinComLedgers, unchanged) sends after each chunk ledger_progress {company, company_guid, round, read, of,
//     at} to FinCom (a small call, at most one every 2 s; never to Tally); the beat carries the last one too. "of" is
//     never below "read" (a ledger created during the read raises it). Resumed reads go on from the MasterID kept with the
//     round id, so the progress never goes back.
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const ledIdsID = "FinComLedgerIds"

// F3: the ledgers' MasterIDs in (after, upto] (upto 0: no upper end; (0, 0]: every ledger)
func ledgerIdsRequest(company string, after, upto int64) string {
	return fcCollection(ledIdsID, company, "", "Ledger", "MASTERID", masterRange(after, upto))
}

// the rows of a FinComLedgerIds answer (each <LEDGER ...> of the collection; CMPINFO left out) and the highest MasterID
func ledIdsCount(raw string) (int, int64) {
	raw = reCmpInfo.ReplaceAllString(raw, "")
	n, top := 0, int64(0)
	for _, b := range reLedIDRow.FindAllString(raw, -1) {
		n++
		if m := toI64(tagNum(b, "MASTERID")); m > top {
			top = m
		}
	}
	return n, top
}

var reLedIDRow = re(`<LEDGER\b[^>]*>[\s\S]*?</LEDGER\s*>`)

// the count for a round (ls: the round's state): asked when not known yet in this round. Nothing returned is an error the
// person sees: a stop or a failure leaves the round without "of N". The same holds as the read's own (review 245 R1):
// someone working in Tally or FinCom's own reading (keepHold), the round's time budget; nothing that reached no Tally
// (the retry schedule, a posting first, reading stopped) gives the count up: it goes on at the read's next turn. A company
// with a ledger known to hang Tally (poisoned) is not counted (the read skips that ledger; the bar runs without "of N").
func ledCountFor(company string, port int, ls M, save func(), inBudget func() bool, poisoned bool) {
	if toInt(ls["of"]) > 0 || truthy(ls["countGaveUp"]) {
		return
	}
	if poisoned {
		ls["countGaveUp"] = true
		save()
		return
	}
	held := func() bool { return keepHold() != "" || (inBudget != nil && !inBudget()) }
	tc := recorderTC(nil)
	if !truthy(ls["countChunked"]) {
		if held() {
			return
		}
		raw, err := invokeTally(tc, port, ledgerIdsRequest(company, 0, 0), 5)
		switch {
		case err == nil && strings.Contains(raw, "<ENVELOPE"):
			n, _ := ledIdsCount(raw)
			ls["of"] = n
			save()
			writeLog(fmt.Sprintf("Keeping %s: Tally lists %d ledger(s) (FinComLedgerIds, one request)", company, n))
			return
		case errors.Is(err, errRecorderStop):
			ls["countChunked"], ls["cAfter"], ls["cN"] = true, 0, 0
			save()
			writeLog("Keeping " + company + ": the ledger count took Tally longer than 2 s; it is counted 2,000 MasterIDs a request")
		case err != nil && ledNothingSent(err):
			// nothing reached Tally (the retry schedule, a posting first, reading stopped): asked at the read's next turn
			liveSayOnce("ledcount|"+companyKey(company), "Keeping "+company+": the ledger count waits ("+cutRunes(err.Error(), 120)+")")
			return
		default:
			ls["countGaveUp"] = true // not asked again this round (nothing shown; the bar runs without "of N")
			save()
			return
		}
	}
	bound := companyAlterM(company)
	for i := 0; i < 200; i++ {
		if held() {
			return
		}
		after := toI64(ls["cAfter"])
		tail := bound <= 0 || after >= bound
		upto := after + 2000
		if tail {
			upto = 0
		}
		raw, err := invokeTally(tc, port, ledgerIdsRequest(company, after, upto), 5)
		if err != nil && ledNothingSent(err) {
			// nothing reached Tally (the retry schedule, a posting first, Tally still on the request stopped): the count
			// goes on from here at the next turn
			liveSayOnce("ledcount|"+companyKey(company), "Keeping "+company+": the ledger count waits ("+cutRunes(err.Error(), 120)+")")
			return
		}
		if err != nil || !strings.Contains(raw, "<ENVELOPE") {
			ls["countGaveUp"] = true
			save()
			return
		}
		n, _ := ledIdsCount(raw)
		ls["cN"] = toInt(ls["cN"]) + n
		if tail {
			ls["of"] = toInt(ls["cN"])
			save()
			writeLog(fmt.Sprintf("Keeping %s: Tally lists %d ledger(s) (FinComLedgerIds, counted in chunks)", company, toInt(ls["of"])))
			return
		}
		ls["cAfter"] = upto
		save()
		keepRest(100 * time.Millisecond)
	}
}

// an error that says nothing reached Tally (review 245 R2: an answer that could not be read is not one of them: the count
// is given up for the round then, never sent again every turn)
func ledNothingSent(err error) bool {
	return gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped)
}

// --- the progress
var ledProg = struct {
	mu   sync.Mutex
	last map[string]M         // company key -> {company, company_guid, round, read, of, at, done}
	sent map[string]time.Time // company key -> the last ledger_progress sent
}{last: map[string]M{}, sent: map[string]time.Time{}}

// after a chunk (done: the round's end, read the final count): kept for the beat and sent to FinCom (at most every 2 s,
// the round's end always)
func ledProgressNote(company, round string, read, of int, done bool) {
	if of > 0 && of < read {
		of = read // a ledger created during the read: never shown "of" below "read"
	}
	if done {
		of = read
	}
	guid := heldGUID(company)
	k := companyKey(company)
	e := M{"company": company, "company_guid": guid, "round": round, "read": read, "of": of, "at": nowFn().Format(time.RFC3339), "done": done}
	ledProg.mu.Lock()
	if p := ledProg.last[k]; p != nil && str(p["round"]) == round && toInt(p["read"]) > read && !done {
		e["read"] = toInt(p["read"]) // never back
	}
	ledProg.last[k] = e
	due := done || time.Since(ledProg.sent[k]) >= 2*time.Second
	if due {
		ledProg.sent[k] = time.Now()
	}
	ledProg.mu.Unlock()
	if !due || !cloudOn() {
		return
	}
	body := M{"kind": "ledger_progress"}
	for kk, v := range e {
		body[kk] = v
	}
	// sent in the background, in order (review 245 R1: a slow cloud never holds the ledger read and its Tally turn)
	ledProgOnce.Do(func() { go ledProgSender() })
	ledProgWG.Add(1)
	if done {
		// the round's end is never dropped (review 245 R2: the beat does not carry it): it waits for room, 10 s at most
		select {
		case ledProgQ <- body:
		case <-time.After(10 * time.Second):
			ledProgWG.Done()
			liveSayOnce("ledprog|end|"+k, "Ledger progress of "+company+": the end of the read could not be queued for FinCom")
		}
		return
	}
	select {
	case ledProgQ <- body:
	default:
		ledProgWG.Done() // the queue is full (the cloud is slow): this one is left to the beat
	}
}

var (
	ledProgQ    = make(chan M, 64)
	ledProgOnce sync.Once
	ledProgWG   sync.WaitGroup
)

func ledProgSender() {
	for body := range ledProgQ {
		r := invokeCloud(body, 5)
		// the round's end tried again (3 times in all, 5 s apart): FinCom learns of it only by this call
		for i := 0; i < 2 && r.code != 200 && truthy(body["done"]) && !stopping(); i++ {
			time.Sleep(5 * time.Second)
			r = invokeCloud(body, 5)
		}
		if r.code != 200 {
			liveSayOnce("ledprog|"+companyKey(str(body["company"])), "Ledger progress of "+str(body["company"])+" not taken by FinCom ("+or(r.err, fmt.Sprint("HTTP ", r.code))+"); the beat carries it")
		}
		ledProgWG.Done()
	}
}

// waits until every progress queued is sent (tests; the bridge never waits on it)
func ledProgFlush() { ledProgWG.Wait() }

func ledProgressBeat() []any {
	ledProg.mu.Lock()
	defer ledProg.mu.Unlock()
	out := []any{}
	for _, v := range ledProg.last {
		if t, err := time.Parse(time.RFC3339, str(v["at"])); err == nil && nowFn().Sub(t) > 2*time.Minute {
			continue // a round cut off or long ended: not carried again (FinCom keeps what it was told)
		}
		out = append(out, v)
	}
	return out
}
