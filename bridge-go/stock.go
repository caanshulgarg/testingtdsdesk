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
//     heartbeat's answer carries the same click (FinCom stops carrying it once answered); each click (its time, at) is
//     taken once, a click older than an hour by this computer's clock is dropped; a click while another of the same
//     company is being answered is answered "busy" at once; nothing in the bridge sends the request otherwise (no
//     background read, no schedule, no retry loop);
//   - at most one request per company and period: the answer is kept (here, and in FinCom's cloud) and a click for the
//     same period sends the kept answer; "Ask Tally again" (again) asks Tally once more;
//   - a hard 2 s stop from the send (the recorder's stop, tc.limitMs); one request in flight (the one Tally lock), postings
//     first (a posting going: the click waits for it, 20 s at most, then says Tally is busy); the request goes only to this
//     Windows user's own Tally with the company open;
//   - stopped at 2 s, or Tally's window held 2 s or more while it was at Tally: nothing more is asked of that company and
//     FinCom is told in plain words ("Tally took too long; type the stock or try again later") until the next click;
//   - the ReadDays / dated-request guard lets exactly this request through only while a click's request is in flight
//     (stockAsking, tally.go datedRefused), and only under the 2 s stop; any other period, company or byte is refused
//     before anything is sent.
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
	asks    map[string]bool      // the requests of the clicks in flight (the dated guard's exemption)
	busy    map[string]bool      // company key -> a click being handled
	cache   map[string]M         // company key|from|to -> Tally's answer
	seen    map[string]string    // company key|from|to -> the last click (its time) taken
	stopped map[string]string    // company key -> why the last click stopped (cleared by the next click; the log and the beat's state)
	wait    func() time.Duration // how long a click waits for a posting to end (tests: shorter)
}{asks: map[string]bool{}, busy: map[string]bool{}, cache: map[string]M{}, seen: map[string]string{}, stopped: map[string]string{}}

func stockReset() {
	stock.mu.Lock()
	defer stock.mu.Unlock()
	stock.asks, stock.busy, stock.cache, stock.seen, stock.stopped = map[string]bool{}, map[string]bool{}, map[string]M{}, map[string]string{}, map[string]string{}
}

// tally.go datedRefused: this request goes only while a click's request for it is in flight, exactly as built, under the
// 2 s stop (a copier read with its hard stop, never a person's request, which has none)
func stockAsking(tc *TC, x string) bool {
	if tc == nil || !tc.copier || tc.person || tc.limitMs <= 0 || tc.limitMs > 2000 {
		return false
	}
	stock.mu.Lock()
	defer stock.mu.Unlock()
	return stock.asks[x] && stockExact(x)
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

// the clicks taken, kept on disk (stock-clicks.json in the sync folder): a bridge started again never takes a click twice
// (FinCom's beat carries a click for 10 minutes)
func stockSeenLoad() {
	if len(stock.seen) > 0 {
		return
	}
	for k, v := range parseObj(readText(sp("stock-clicks.json"))) {
		stock.seen[k] = str(v)
	}
}

func stockSeenSave() {
	o := M{}
	for k, v := range stock.seen {
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil && nowFn().Sub(t) < 2*time.Hour {
			o[k] = v
		}
	}
	_ = saveFile(sp("stock-clicks.json"), jsonText(o))
}

// the answer's base for a click (every answer to FinCom carries these)
func stockBase(c stockClick) M {
	return M{"kind": "stock", "company": c.Company, "company_guid": heldGUID(c.Company), "from": c.From, "to": c.To, "at": c.At, "again": c.Again}
}

// a click taken once (by its time, kept on disk), and only when it is less than an hour old by this computer's clock
func stockTake(c stockClick) M {
	out := M{"ok": false, "company": c.Company, "from": c.From, "to": c.To}
	if c.Company == "" || !stockPeriodOK(c.From, c.To) || c.At == "" {
		out["why"] = "not a click FinCom sends (a company, a period and its time)"
		return out
	}
	if t, err := time.Parse(time.RFC3339Nano, c.At); err != nil || nowFn().Sub(t) > time.Hour {
		out["why"] = "the click is older than an hour"
		return out
	}
	k := companyKey(c.Company) + "|" + c.From + "|" + c.To
	stock.mu.Lock()
	stockSeenLoad()
	if c.At <= stock.seen[k] {
		stock.mu.Unlock()
		out["why"], out["seen"] = "this click was taken already", true
		return out
	}
	stock.seen[k] = c.At
	stockSeenSave()
	if stock.busy[companyKey(c.Company)] {
		stock.mu.Unlock()
		// answered at once (FinCom shows it; nothing is asked of Tally): the click in hand comes first
		ans := stockBase(c)
		ans["status"], ans["words"] = "busy", "not asked: Tally is being asked for this company's stock already; try again in a moment"
		stockSend(ans)
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
	ans := stockBase(c)
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
	// postings first: a posting going is waited for (nothing is sent meanwhile), 20 s at most (FinCom's cloud holds a click
	// on its way for 60 s)
	wait := 20 * time.Second
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
	stock.asks[x] = true
	stock.mu.Unlock()
	held := windowHoldFn()
	var took float64
	tc := &TC{copier: true, limitMs: 2000, timed: func(sec float64) { took += sec }, yield: func() bool { return postingGoing() }}
	raw, err := invokeTally(tc, port, x, 5)
	holdMs := held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	stock.mu.Lock()
	delete(stock.asks, x)
	stock.mu.Unlock()
	if took == 0 {
		holdMs = 0 // nothing reached Tally
	}
	ms := int(math.Round(took * 1000))
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

var reStockBal = map[string]*regexp.Regexp{
	"OPENINGBALANCE": regexp.MustCompile(`<OPENINGBALANCE\b[^>/]*>([^<]*)</OPENINGBALANCE>`),
	"CLOSINGBALANCE": regexp.MustCompile(`<CLOSINGBALANCE\b[^>/]*>([^<]*)</CLOSINGBALANCE>`),
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
		el := reStockBal[tag].FindStringSubmatch(m[0][1])
		if el == nil {
			return 0, false // not in the answer (or <TAG/>): no figure, never a nil stock
		}
		v := strings.TrimSpace(el[1])
		if v == "" {
			return 0, true // Tally writes a nil balance as an empty element
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
	why := ""
	if !cloudOn() {
		why = "FinCom's cloud is not set up on this computer"
	} else {
		b := M{}
		for k, v := range ans {
			b[k] = v
		}
		if r := invokeCloud(b, 15); r.code != 200 {
			why = or(r.err, fmt.Sprint("HTTP ", r.code))
		}
	}
	if why != "" {
		writeLog("Stock of " + str(ans["company"]) + ": the answer was not taken by FinCom (" + cutRunes(why, 120) + "); click again in FinCom")
	}
}
