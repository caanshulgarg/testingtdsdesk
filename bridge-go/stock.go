// FinCom Bridge 2.5.1 (the owner's decision of 30-Oct-2026, "1"): the stock from Tally, ONLY when a person clicks "Bring
// stock from Tally" (or "Ask Tally again") on the Financial statements' stock panel in FinCom.
//
// The one request, C1 "FinComStockInHand", exactly as measured on 30-Oct-2026 (tally-versions mode stockp, run
// 41009967960): Tally's Group collection, the reserved group Stock-in-Hand only, NAME, OPENINGBALANCE and CLOSINGBALANCE
// for the period the person chose (SVFROMDATE / SVTODATE, yyyymmdd TYPE="Date"). Tally works the stock out itself (its
// stock summary); the bridge reads the one group's two figures.
//
// The rules (each with its test, stock251_test.go):
//   - sent only for a person's click: FinCom's cloud wakes this computer ("stock", {company, from, to, at, again}) or the
//     heartbeat's answer carries the same click; each click (its time, at) is taken once, a click older than 10 minutes
//     is dropped; nothing in the bridge sends it otherwise (no background read, no schedule, no retry loop);
//   - at most one request per company and period: the answer is kept (here, and in FinCom's cloud) and a click for the
//     same period sends the kept answer; "Ask Tally again" (again) asks Tally once more;
//   - a hard 2 s stop from the send (the recorder's stop, tc.limitMs); one request in flight (the one Tally lock), postings
//     first (a posting going: the click waits for it, 30 s at most, then says Tally is busy); the request goes only to this
//     Windows user's own Tally with the company open;
//   - stopped at 2 s, or Tally's window held 2 s or more while it was at Tally: nothing more is asked of that company and
//     FinCom is told in plain words ("Tally took too long; type the stock or try again later") until the next click;
//   - the ReadDays / dated-request guard lets exactly this request through only while a click's request is in flight
//     (stockAsking, tally.go datedRefused); any other period, company or byte is refused before anything is sent.
package main

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const stockID = "FinComStockInHand"

// the plain words FinCom shows when Tally overran the stop (the owner's words)
const stockSlowWords = "Tally took too long; type the stock or try again later"

// C1, exactly (the owner's decision of 30-Oct-2026): the company and the period are the only inputs
func stockRequest(company, from, to string) string {
	return fcCollection(stockID, company, dateVars(formPlainT, from, to), "Group", "NAME, OPENINGBALANCE, CLOSINGBALANCE", `$ReservedName = "Stock-in-Hand"`)
}

// a period the person can choose: two dates, from not after to, at most two years
func stockPeriodOK(from, to string) bool {
	if !isTallyDate(from) || !isTallyDate(to) || from > to {
		return false
	}
	a, e1 := time.Parse("20060102", from)
	z, e2 := time.Parse("20060102", to)
	return e1 == nil && e2 == nil && a.Format("20060102") == from && z.Format("20060102") == to && z.Sub(a) <= 2*366*24*time.Hour
}

// the request exactly as built for its own company and period (pinned.go rebuilds it the same way)
func stockExact(x string) bool {
	if tallyRequestID(x) != stockID {
		return false
	}
	a, z := pinDates(x)
	return stockPeriodOK(a, z) && x == stockRequest(pinCo(x), a, z)
}

var stock = struct {
	mu      sync.Mutex
	ask     string               // the request of the click in flight (the dated guard's exemption), "" otherwise
	busy    map[string]bool      // company key -> a click being handled
	cache   map[string]M         // company key|from|to -> Tally's answer
	seen    map[string]string    // company key|from|to -> the last click (its time) taken
	stopped map[string]string    // company key -> why it stopped (until the next click)
	sent    []M                  // the last answers sent to FinCom (the tests; never more than 20)
	tallyN  map[string]int       // company key|from|to -> requests sent to Tally (the tests)
	cloud   func(body M) error   // sends the answer to FinCom (tests: a stand-in)
	wait    func() time.Duration // how long a click waits for a posting to end (tests: shorter)
}{busy: map[string]bool{}, cache: map[string]M{}, seen: map[string]string{}, stopped: map[string]string{}, tallyN: map[string]int{}}

func stockReset() {
	stock.mu.Lock()
	defer stock.mu.Unlock()
	stock.ask, stock.busy, stock.cache, stock.seen, stock.stopped, stock.sent, stock.tallyN = "", map[string]bool{}, map[string]M{}, map[string]string{}, map[string]string{}, nil, map[string]int{}
}

// tally.go datedRefused: this request goes only while a click's request is in flight, and only that exact request
func stockAsking(x string) bool {
	stock.mu.Lock()
	defer stock.mu.Unlock()
	return stock.ask != "" && x == stock.ask && stockExact(x)
}

// a click as FinCom sends it (the wake-up channel's payload, or one entry of the heartbeat's "stock")
type stockClick struct {
	Company, From, To, At string
	Again                 bool
}

func stockClickOf(company string, v M) stockClick {
	return stockClick{Company: strings.TrimSpace(company), From: str(v["from"]), To: str(v["to"]), At: str(v["at"]), Again: truthy(v["again"])}
}

// the heartbeat's answer: "stock": {company: {from, to, at, again}} (the fallback for the wake-up channel)
func stockFromBeat(m M) {
	for co, v := range m {
		if c := stockClickOf(co, obj(v)); c.At != "" {
			go stockTake(c)
		}
	}
}

// a click taken once (by its time), and only when it is fresh (10 minutes)
func stockTake(c stockClick) M {
	out := M{"ok": false, "company": c.Company, "from": c.From, "to": c.To}
	if c.Company == "" || !stockPeriodOK(c.From, c.To) || c.At == "" {
		out["why"] = "not a click FinCom sends (a company, a period and its time)"
		return out
	}
	if t, err := time.Parse(time.RFC3339Nano, c.At); err != nil || nowFn().Sub(t) > 10*time.Minute {
		out["why"] = "the click is older than 10 minutes"
		return out
	}
	k := companyKey(c.Company) + "|" + c.From + "|" + c.To
	stock.mu.Lock()
	if c.At <= stock.seen[k] {
		stock.mu.Unlock()
		out["why"], out["seen"] = "this click was taken already", true
		return out
	}
	stock.seen[k] = c.At
	if stock.busy[companyKey(c.Company)] {
		stock.mu.Unlock()
		out["why"] = "a click for this company is being answered"
		return out
	}
	stock.busy[companyKey(c.Company)] = true
	delete(stock.stopped, companyKey(c.Company)) // the next click lifts a stop
	stock.mu.Unlock()
	defer func() {
		stock.mu.Lock()
		delete(stock.busy, companyKey(c.Company))
		stock.mu.Unlock()
	}()
	ans := stockAnswer(c, k)
	stockSend(ans)
	return ans
}

// the answer for one click: the kept one, or Tally's (one request), or why not
func stockAnswer(c stockClick, k string) M {
	ans := M{"kind": "stock", "company": c.Company, "company_guid": heldGUID(c.Company), "from": c.From, "to": c.To, "at": c.At, "again": c.Again}
	say := func(status, words string) M {
		ans["status"], ans["words"] = status, words
		writeLog("Stock of " + c.Company + " (" + liveDay(c.From) + " to " + liveDay(c.To) + "), asked in FinCom: " + words)
		return ans
	}
	stock.mu.Lock()
	kept := stock.cache[k]
	stock.mu.Unlock()
	if kept != nil && !c.Again {
		for kk, v := range kept {
			ans[kk] = v
		}
		ans["status"], ans["cached"] = "ok", true
		return ans
	}
	it := pullItem{Company: c.Company, CGUID: heldGUID(c.Company)}
	port, why := pullPort(it)
	if why != "" {
		return say("notopen", "not asked: "+why)
	}
	// postings first: a posting going is waited for (nothing is sent meanwhile), 30 s at most
	wait := 30 * time.Second
	if stock.wait != nil {
		wait = stock.wait()
	}
	for until := time.Now().Add(wait); postingGoing(); {
		if time.Now().After(until) {
			return say("busy", "not asked: Tally is busy with a posting; try again in a moment")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err := earlierRefusal(port); err != nil {
		return say("busy", "not asked: Tally is still on an earlier request; try again in a moment")
	}
	x := stockRequest(c.Company, c.From, c.To)
	stock.mu.Lock()
	stock.ask = x
	stock.tallyN[k]++
	stock.mu.Unlock()
	held := windowHoldFn()
	var took float64
	tc := &TC{copier: true, limitMs: 2000, timed: func(sec float64) { took += sec }, yield: func() bool { return postingGoing() }}
	t0 := time.Now()
	raw, err := invokeTally(tc, port, x, 5)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	stock.mu.Lock()
	stock.ask = ""
	stock.mu.Unlock()
	if took == 0 {
		holdMs = 0 // nothing reached Tally
	}
	ms := int(math.Round(took * 1000))
	if ms == 0 && err == nil {
		ms = int(time.Since(t0).Milliseconds())
	}
	ans["ms"], ans["holdMs"] = ms, holdMs
	switch {
	case errors.Is(err, errRecorderStop) || (err == nil && ms > 2000) || holdMs >= 2000:
		what := fmt.Sprintf("stopped at 2 s (%d ms)", ms)
		if holdMs >= 2000 {
			what = fmt.Sprintf("Tally's window did not answer for %.1f s", float64(holdMs)/1000)
		}
		stock.mu.Lock()
		stock.stopped[companyKey(c.Company)] = what
		stock.mu.Unlock()
		writeLog("Stock of " + c.Company + ": " + what + "; nothing more is asked of this company until the next click in FinCom")
		return say("slow", stockSlowWords)
	case err != nil && (gaveWay(err) || errors.Is(err, errRetryWait) || errors.Is(err, errReadStopped)):
		return say("busy", "not asked: "+cutRunes(err.Error(), 160))
	case err != nil:
		return say("failed", "Tally did not answer ("+cutRunes(err.Error(), 160)+"); try again later")
	}
	op, cl, ok := stockFigures(raw)
	if !ok {
		return say("none", "Tally gave no Stock-in-Hand figure for this period")
	}
	ans["status"], ans["opening"], ans["closing"], ans["readAt"] = "ok", op, cl, nowFn().Format(time.RFC3339)
	stock.mu.Lock()
	stock.cache[k] = M{"opening": op, "closing": cl, "readAt": ans["readAt"], "ms": ms, "holdMs": holdMs}
	stock.mu.Unlock()
	writeLog(fmt.Sprintf("Stock of %s (%s to %s), asked in FinCom: opening %.2f, closing %.2f, from Tally in %d ms", c.Company, liveDay(c.From), liveDay(c.To), op, cl, ms))
	return ans
}

var reStockGroup = regexp.MustCompile(`(?s)<GROUP\b[^>]*\bRESERVEDNAME="Stock-in-Hand"[^>]*>(.*?)</GROUP>`)

// the stock as FinCom shows it: Tally's Stock-in-Hand group's opening and closing balance, a debit (Tally's minus) as a
// positive stock; exactly one such group in the answer
func stockFigures(raw string) (opening, closing float64, ok bool) {
	raw = reCmpInfo.ReplaceAllString(raw, "")
	m := reStockGroup.FindAllStringSubmatch(raw, -1)
	if len(m) != 1 {
		return 0, 0, false
	}
	num := func(tag string) (float64, bool) {
		v := strings.TrimSpace(group(`<`+tag+`[^>]*>([^<]*)</`+tag+`>`, m[0][1], 1))
		if v == "" {
			return 0, true // Tally leaves a nil balance empty
		}
		f, err := strconv.ParseFloat(strings.ReplaceAll(v, ",", ""), 64)
		return f, err == nil
	}
	o, ok1 := num("OPENINGBALANCE")
	c, ok2 := num("CLOSINGBALANCE")
	if !ok1 || !ok2 {
		return 0, 0, false
	}
	r2 := func(f float64) float64 { return math.Round(-f*100) / 100 }
	return r2(o) + 0, r2(c) + 0, true
}

// the answer to FinCom (one call; its failure is said in the log, never sent again by itself)
func stockSend(ans M) {
	stock.mu.Lock()
	stock.sent = append(stock.sent, ans)
	if len(stock.sent) > 20 {
		stock.sent = stock.sent[len(stock.sent)-20:]
	}
	send := stock.cloud
	stock.mu.Unlock()
	if send == nil {
		send = func(body M) error {
			if !cloudOn() {
				return errors.New("FinCom's cloud is not set up on this computer")
			}
			b := M{}
			for k, v := range body {
				b[k] = v
			}
			r := invokeCloud(b, 15)
			if r.code != 200 {
				return errors.New(or(r.err, fmt.Sprint("HTTP ", r.code)))
			}
			return nil
		}
	}
	if err := send(ans); err != nil {
		writeLog("Stock of " + str(ans["company"]) + ": the answer was not taken by FinCom (" + cutRunes(err.Error(), 120) + "); click again in FinCom")
	}
}
