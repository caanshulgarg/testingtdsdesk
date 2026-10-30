package main

// FinCom Bridge 2.5.1 (the owner's decision of 30-Oct-2026, "1"): the stock from Tally ONLY when a person clicks "Bring
// stock from Tally" on the Financial statements' stock panel (stock.go). Written before the code:
//   1. the request is exactly C1 "FinComStockInHand" as measured (tally-versions stockp, run 41009967960);
//   2. click only: no background path sends it; the dated guard lets it through only while a click's request is in flight;
//   3. a hard 2 s stop; over it, or Tally's window held 2 s, the company stops with the owner's words until the next click;
//   4. at most one request per company and period (the answer kept); "Ask Tally again" asks once more;
//   5. one request in flight, postings first;
//   6. the click from the wake-up channel and from the heartbeat, each taken once; FinCom gets the answer;
//   7. the no-computed-figure exception is exactly this id as built; the allow-list line names the owner's decision.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// the owner's request text of 30-Oct-2026, word for word, with {company}, {from} and {to}
const stockOwnerText = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComStockInHand</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">{from}</SVFROMDATE><SVTODATE TYPE="Date">{to}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComStockInHand" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME, OPENINGBALANCE, CLOSINGBALANCE</FETCH><FILTERS>FinComStockInHandOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComStockInHandOnly">$ReservedName = &#34;Stock-in-Hand&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`

// a bridge with its own Tally, the company open and its GUID held, a stand-in cloud taking the answers
func stockBridge(t *testing.T) (*standTally, *standCloud, *[]M) {
	t.Helper()
	_, f, c := liveBridge(t, `,"KeepRestMs":1`)
	f.mu.Lock()
	f.guid = b220CoGUID
	f.stockGrp = [2]string{"-908443072.58", "-2182130465.82"} // Tally's own answer, run 41009967960 (3.0), 1-Apr to 31-Oct
	f.mu.Unlock()
	noteCompanyGUID(zz, b220CoGUID)
	stockReset()
	t.Cleanup(stockReset)
	if _, err := findCompanyPort(zz, 0); err != nil {
		t.Fatal(err)
	}
	wantMu.Lock()
	wantAt = time.Time{} // FinCom's own request just above: the reads' 4 s of giving way are not this test's
	wantMu.Unlock()
	var got []M
	var mu sync.Mutex
	c.mu.Lock()
	c.other = func(k string, b M) (int, M) {
		if k == "stock" {
			mu.Lock()
			got = append(got, b)
			mu.Unlock()
		}
		return 200, M{"ok": true}
	}
	c.mu.Unlock()
	return f, c, &got
}

func clickAt(d time.Duration) string { return time.Now().Add(d).UTC().Format(time.RFC3339Nano) }

func stockClicks(f *standTally) int { return f.n(stockID) }

// --- 1. exactly the owner's request
func TestStock251RequestExact(t *testing.T) {
	want := strings.NewReplacer("{company}", "SAMPLE CO", "{from}", "20260401", "{to}", "20261031").Replace(stockOwnerText)
	if got := stockRequest("SAMPLE CO", "20260401", "20261031"); got != want {
		t.Fatalf("the request is not the owner's:\n got %s\nwant %s", got, want)
	}
	// the request measured on real Tally (tally-versions 51fe89998, stockp/req/c1-stockinhand.xml), its company and dates
	measured := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComStockInHand</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20991201</SVFROMDATE><SVTODATE TYPE="Date">20991231</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComStockInHand" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME, OPENINGBALANCE, CLOSINGBALANCE</FETCH><FILTERS>FinComStockInHandOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComStockInHandOnly">$ReservedName = &#34;Stock-in-Hand&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
	if got := stockRequest("FinCom Spike Co", "20991201", "20991231"); got != strings.Replace(measured, "@@CO@@", "FinCom Spike Co", 1) {
		t.Fatalf("not the measured request: %s", got)
	}
	// the company's name escaped as every request escapes it
	if x := stockRequest(`A & B "Traders"`, "20260401", "20260430"); !strings.Contains(x, "<SVCURRENTCOMPANY>A &amp; B &#34;Traders&#34;</SVCURRENTCOMPANY>") || !stockExact(x) {
		t.Fatalf("the name: %s", x)
	}
	if tallyRequestID(want) != stockID || checkAllowed(want) != nil {
		t.Fatalf("on the allow-list as built: %v", checkAllowed(want))
	}
	// one byte, one field, the type or the filter changed: refused at the gate
	for why, y := range map[string]string{
		"a field more":     strings.Replace(want, "CLOSINGBALANCE</FETCH>", "CLOSINGBALANCE, PARENT</FETCH>", 1),
		"stock items":      strings.Replace(want, "<TYPE>Group</TYPE>", "<TYPE>StockItem</TYPE>", 1),
		"another group":    strings.Replace(want, "Stock-in-Hand&#34;", "Sundry Debtors&#34;", 1),
		"no filter":        strings.Replace(want, "<FILTERS>FinComStockInHandOnly</FILTERS>", "", 1),
		"no TYPE=Date":     strings.Replace(want, `<SVFROMDATE TYPE="Date">`, "<SVFROMDATE>", 1),
		"one space more":   strings.Replace(want, "<BODY>", "<BODY> ", 1),
		"the period twice": strings.Replace(want, "</STATICVARIABLES>", `<SVFROMDATE TYPE="Date">20260401</SVFROMDATE></STATICVARIABLES>`, 1),
	} {
		if checkAllowed(y) == nil && stockExact(y) {
			t.Errorf("%s: passes", why)
		}
		if checkAllowed(y) == nil {
			t.Errorf("%s: on the allow-list", why)
		}
	}
	// a period FinCom never sends
	for _, p := range [][2]string{{"20261031", "20260401"}, {"20260431", "20260501"}, {"2026041", "20260430"}, {"20200401", "20260331"}} {
		if stockExact(stockRequest(zz, p[0], p[1])) {
			t.Errorf("the period %v is taken", p)
		}
	}
}

// --- 2. click only: nothing else sends it; the guard opens only for the click's own request while it is in flight
func TestStock251ClickOnly(t *testing.T) {
	f, _, _ := stockBridge(t)
	liveFrom(today())
	// every background path the bridge has: Update now, the ledger read, the light check, a heartbeat without a click
	runNow(t, "now")
	wakeLedgers(zz, "test", true)
	waitIdle(t)
	beatOnce() // a heartbeat whose answer carries no click
	time.Sleep(200 * time.Millisecond)
	if n := stockClicks(f); n != 0 {
		t.Fatalf("the stock was asked of Tally without a click: %d", n)
	}
	x := stockRequest(zz, "20260401", "20261031")
	// with ReadDays off and on, for a person too: refused while no click's request is in flight
	for _, on := range []bool{false, true} {
		setCfg("ReadDays", on)
		for _, tc := range []*TC{fin, {person: true}, recorderTC(nil)} {
			if err := datedRefused(tc, x); err != errStockRefused {
				t.Fatalf("ReadDays %v: not refused outside a click: %v", on, err)
			}
		}
		if _, err := invokeTally(fin, f.port, x, 5); err == nil || stockClicks(f) != 0 {
			t.Fatalf("ReadDays %v: sent outside a click: %v", on, err)
		}
	}
	setCfg("ReadDays", false)
	// in flight: exactly that request passes, and only under the 2 s stop; another period or company does not
	stock.mu.Lock()
	stock.asks[x] = true
	stock.mu.Unlock()
	click := &TC{copier: true, limitMs: 2000}
	if datedRefused(click, x) != nil {
		t.Fatal("the click's own request refused while in flight")
	}
	for why, tc := range map[string]*TC{"FinCom's own (no stop)": fin, "a person's (no stop)": {person: true, copier: true, limitMs: 2000}, "no stop": {copier: true}, "a longer stop": {copier: true, limitMs: 3000}} {
		if datedRefused(tc, x) == nil {
			t.Fatalf("the click's request passes for %s", why)
		}
	}
	for _, y := range []string{stockRequest(zz, "20260401", "20260430"), stockRequest("OTHER CO", "20260401", "20261031")} {
		if datedRefused(click, y) == nil {
			t.Fatalf("another request passes while a click's is in flight: %s", y)
		}
	}
	stock.mu.Lock()
	delete(stock.asks, x)
	stock.mu.Unlock()
	if logLines("FinComStockInHand refused before sending: the stock is asked only for a person's click") == 0 {
		t.Fatal("the refusal is not in the log")
	}
}

// --- 3. the 2 s stop; the owner's words; the company stopped until the next click
func TestStock251TwoSecondStop(t *testing.T) {
	f, _, got := stockBridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == stockID {
			return 2600 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	t0 := time.Now()
	a := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(0)})
	if el := time.Since(t0); el > 2900*time.Millisecond {
		t.Fatalf("the click waited %s: not stopped at 2 s", el)
	}
	if str(a["status"]) != "slow" || str(a["words"]) != stockSlowWords || toInt(a["ms"]) < 2000 || a["opening"] != nil {
		t.Fatalf("the answer: %v", a)
	}
	if stockClicks(f) != 1 {
		t.Fatalf("asked %d times in one click", stockClicks(f))
	}
	stock.mu.Lock()
	why := stock.stopped[companyKey(zz)]
	stock.mu.Unlock()
	if !strings.Contains(why, "stopped at 2 s") || logLines("nothing more is asked of this company until the next click") != 1 {
		t.Fatalf("not stopped: %q", why)
	}
	if len(*got) != 1 || str((*got)[0]["words"]) != stockSlowWords || str((*got)[0]["status"]) != "slow" {
		t.Fatalf("FinCom was told: %v", *got)
	}
	// nothing more goes by itself
	time.Sleep(3 * time.Second)
	if stockClicks(f) != 1 {
		t.Fatalf("asked again by itself: %d", stockClicks(f))
	}
	// the next click (Ask Tally again) asks once more, and Tally answers in time now
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	waitTallyFree(t, f)
	a = stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(time.Second), Again: true})
	if str(a["status"]) != "ok" || stockClicks(f) != 2 || a["opening"] != 908443072.58 || a["closing"] != 2182130465.82 {
		t.Fatalf("the next click: %v (%d asked)", a, stockClicks(f))
	}
	stock.mu.Lock()
	why = stock.stopped[companyKey(zz)]
	stock.mu.Unlock()
	if why != "" {
		t.Fatalf("still stopped after the next click: %q", why)
	}
}

// the request given up at 2 s holds the Tally lock until the stand answers it (next-inflight): wait for that
func waitTallyFree(t *testing.T, f *standTally) {
	t.Helper()
	for i := 0; i < 100 && earlierRefusal(f.port) != nil; i++ {
		time.Sleep(50 * time.Millisecond)
	}
	bgMu.Lock()
	stopHold = map[int]time.Time{}
	bgMu.Unlock()
}

// --- 3b. Tally's window held 2 s while the request was at Tally: stopped, the same words
func TestStock251WindowHeld(t *testing.T) {
	f, _, got := stockBridge(t)
	windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return 2100 } }
	t.Cleanup(func() { windowHoldFn = platWindowHold })
	a := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(0)})
	if str(a["status"]) != "slow" || str(a["words"]) != stockSlowWords || toInt(a["holdMs"]) != 2100 || a["opening"] != nil {
		t.Fatalf("the answer: %v", a)
	}
	stock.mu.Lock()
	why, kept := stock.stopped[companyKey(zz)], len(stock.cache)
	stock.mu.Unlock()
	if !strings.Contains(why, "window did not answer for 2.1 s") || kept != 0 || stockClicks(f) != 1 || len(*got) != 1 {
		t.Fatalf("stopped %q, kept %d, asked %d, told %d", why, kept, stockClicks(f), len(*got))
	}
	// a hold under 2 s: the answer is taken
	windowHoldFn = func() func(time.Time) int { return func(time.Time) int { return 1900 } }
	a = stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(time.Second), Again: true})
	if str(a["status"]) != "ok" || toInt(a["holdMs"]) != 1900 {
		t.Fatalf("a hold under 2 s: %v", a)
	}
}

// --- 4. once per company and period; Ask Tally again asks once more; each click taken once
func TestStock251OncePerPeriod(t *testing.T) {
	f, _, got := stockBridge(t)
	at := clickAt(0)
	a := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: at})
	if str(a["status"]) != "ok" || a["opening"] != 908443072.58 || a["closing"] != 2182130465.82 || truthy(a["cached"]) || str(a["readAt"]) == "" || str(a["company_guid"]) != b220CoGUID {
		t.Fatalf("the first click: %v", a)
	}
	// the same click again (the heartbeat carries what the wake-up channel brought): not taken twice
	if b := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: at}); !truthy(b["seen"]) || stockClicks(f) != 1 || len(*got) != 1 {
		t.Fatalf("the same click again: %v (%d asked)", b, stockClicks(f))
	}
	// the bridge started again (the memory gone, the clicks on disk): the heartbeat's copy of the same click not taken
	stock.mu.Lock()
	stock.seen = map[string]string{}
	stock.mu.Unlock()
	if b := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: at}); !truthy(b["seen"]) || stockClicks(f) != 1 {
		t.Fatalf("the same click after a restart: %v (%d asked)", b, stockClicks(f))
	}
	// another click for the same period: the kept answer, nothing asked of Tally
	b := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(time.Second)})
	if str(b["status"]) != "ok" || !truthy(b["cached"]) || b["opening"] != a["opening"] || b["readAt"] != a["readAt"] || stockClicks(f) != 1 {
		t.Fatalf("a second click: %v (%d asked)", b, stockClicks(f))
	}
	// Ask Tally again: once more
	f.mu.Lock()
	f.stockGrp = [2]string{"-908443072.58", "-2182130000.00"}
	f.mu.Unlock()
	c := stockTake(stockClick{Company: zz, From: "20260401", To: "20261031", At: clickAt(2 * time.Second), Again: true})
	if str(c["status"]) != "ok" || truthy(c["cached"]) || c["closing"] != 2182130000.00 || stockClicks(f) != 2 {
		t.Fatalf("Ask Tally again: %v (%d asked)", c, stockClicks(f))
	}
	// another period is its own
	d := stockTake(stockClick{Company: zz, From: "20261001", To: "20261031", At: clickAt(3 * time.Second)})
	if str(d["status"]) != "ok" || truthy(d["cached"]) || stockClicks(f) != 3 {
		t.Fatalf("another period: %v", d)
	}
	f.mu.Lock()
	last := f.bodies[len(f.bodies)-1]
	f.mu.Unlock()
	if last != stockRequest(zz, "20261001", "20261031") {
		t.Fatalf("not the request as built: %s", last)
	}
	if len(*got) != 4 { // the first, the kept, Ask Tally again, another period (the same click twice: once)
		t.Fatalf("FinCom got %d answers", len(*got))
	}
	// a click older than an hour, or not a click FinCom sends: dropped
	for _, k := range []stockClick{{Company: zz, From: "20260401", To: "20260430", At: clickAt(-61 * time.Minute)}, {Company: zz, From: "20260431", To: "20260501", At: clickAt(0)}, {From: "20260401", To: "20260430", At: clickAt(0)}} {
		if r := stockTake(k); truthy(r["ok"]) || stockClicks(f) != 3 {
			t.Fatalf("taken: %v", r)
		}
	}
}

// --- 5. one request in flight; postings first
func TestStock251OneInFlightPostingsFirst(t *testing.T) {
	f, _, told := stockBridge(t)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == stockID {
			return 600 * time.Millisecond
		}
		return 0
	}
	f.mu.Unlock()
	var wg sync.WaitGroup
	res := make([]M, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			time.Sleep(time.Duration(i) * 100 * time.Millisecond)
			res[i] = stockTake(stockClick{Company: zz, From: "20260401", To: "20260430", At: clickAt(time.Duration(i) * time.Second), Again: true})
		}(i)
	}
	wg.Wait()
	if stockClicks(f) != 1 || str(res[0]["status"]) != "ok" || !strings.Contains(str(res[1]["why"]), "being answered") {
		t.Fatalf("two clicks at once: %v / %v (%d asked)", res[0], res[1], stockClicks(f))
	}
	// the second click is answered at once ("busy"), never left without an answer
	waitFor(t, func() bool { return len(*told) == 2 })
	if b := (*told)[0]; str(b["status"]) != "busy" || !strings.Contains(str(b["words"]), "already") || str(b["at"]) == "" {
		t.Fatalf("the second click's answer: %v", b)
	}
	f.mu.Lock()
	mx := f.maxFlight
	f.slow = nil
	f.mu.Unlock()
	if mx != 1 {
		t.Fatalf("%d requests at Tally at once", mx)
	}
	// a posting going: the click waits (nothing sent), then says Tally is busy
	stock.mu.Lock()
	stock.wait = func() time.Duration { return 300 * time.Millisecond }
	stock.mu.Unlock()
	importsInFlight.Add(1)
	a := stockTake(stockClick{Company: zz, From: "20260401", To: "20260531", At: clickAt(3 * time.Second)})
	importsInFlight.Add(-1)
	if str(a["status"]) != "busy" || !strings.Contains(str(a["words"]), "posting") || stockClicks(f) != 1 {
		t.Fatalf("during a posting: %v (%d asked)", a, stockClicks(f))
	}
	// the posting ends while the click waits: then it goes
	stock.mu.Lock()
	stock.wait = func() time.Duration { return 5 * time.Second }
	stock.mu.Unlock()
	importsInFlight.Add(1)
	go func() { time.Sleep(400 * time.Millisecond); importsInFlight.Add(-1) }()
	a = stockTake(stockClick{Company: zz, From: "20260401", To: "20260531", At: clickAt(4 * time.Second)})
	if str(a["status"]) != "ok" || stockClicks(f) != 2 {
		t.Fatalf("after the posting: %v", a)
	}
	// a company not open in this bridge's own Tally: not asked
	a = stockTake(stockClick{Company: "OTHER CO", From: "20260401", To: "20260630", At: clickAt(5 * time.Second)})
	if str(a["status"]) != "notopen" || stockClicks(f) != 2 {
		t.Fatalf("the company not open in the own Tally: %v", a)
	}
}

// --- 6. the click from the wake-up channel and from the heartbeat; FinCom gets the answer
func TestStock251WakeAndBeat(t *testing.T) {
	f, c, got := stockBridge(t)
	at := clickAt(0)
	wakeEvent("stock", M{"company": zz, "from": "20260401", "to": "20261031", "at": at})
	waitFor(t, func() bool { return len(*got) == 1 })
	// the heartbeat's copy of the same click: not taken again
	c.mu.Lock()
	c.beatReply = M{"stock": M{zz: M{"from": "20260401", "to": "20261031", "at": at}}}
	c.mu.Unlock()
	beatOnce()
	time.Sleep(300 * time.Millisecond)
	if stockClicks(f) != 1 || len(*got) != 1 {
		t.Fatalf("the heartbeat's copy taken again: %d asked, %d sent", stockClicks(f), len(*got))
	}
	b := (*got)[0]
	if str(b["kind"]) != "stock" || str(b["company"]) != zz || str(b["from"]) != "20260401" || str(b["to"]) != "20261031" || str(b["at"]) != at ||
		toF(b["opening"]) != 908443072.58 || toF(b["closing"]) != 2182130465.82 || str(b["status"]) != "ok" || str(b["company_guid"]) != b220CoGUID {
		t.Fatalf("FinCom got: %v", b)
	}
	// a click the wake-up channel missed, carried by the heartbeat: taken
	c.mu.Lock()
	c.beatReply = M{"stock": M{zz: M{"from": "20261001", "to": "20261031", "at": clickAt(time.Second), "again": true}}}
	c.mu.Unlock()
	beatOnce()
	waitFor(t, func() bool { return len(*got) == 2 })
	if stockClicks(f) != 2 || str((*got)[1]["from"]) != "20261001" {
		t.Fatalf("the heartbeat's click: %v", (*got)[1])
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("not in 5 s")
}

func toF(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	}
	return -1
}

// --- 7. the figures as Tally gives them; the computed-figure exception exactly this id; the decision line
func TestStock251FiguresAndExceptions(t *testing.T) {
	// Tally's real answer (run 41009967960, TallyPrime 3.0): a debit (minus) is the stock
	raw, err := os.ReadFile(filepath.Join("testdata", "stock251", "c1-3.0-20260401-20261031.xml"))
	if err != nil {
		t.Fatal(err)
	}
	o, c, ok := stockFigures(string(raw))
	if !ok || o != 908443072.58 || c != 2182130465.82 {
		t.Fatalf("Tally's answer read as %v %v %v", o, c, ok)
	}
	for why, x := range map[string]string{
		"no group":          "<ENVELOPE><BODY><DATA><COLLECTION></COLLECTION></DATA></BODY></ENVELOPE>",
		"two groups":        strings.Replace(string(raw), "</COLLECTION>", `<GROUP NAME="X" RESERVEDNAME="Stock-in-Hand"><OPENINGBALANCE>1</OPENINGBALANCE></GROUP></COLLECTION>`, 1),
		"not a number":      strings.Replace(string(raw), "-908443072.58", "abc", 1),
		"no closing":        regexp.MustCompile(`<CLOSINGBALANCE[^>]*>[^<]*</CLOSINGBALANCE>`).ReplaceAllString(string(raw), ""),
		"<CLOSINGBALANCE/>": regexp.MustCompile(`<CLOSINGBALANCE[^>]*>[^<]*</CLOSINGBALANCE>`).ReplaceAllString(string(raw), "<CLOSINGBALANCE/>"),
	} {
		if _, _, ok := stockFigures(x); ok {
			t.Errorf("%s: read", why)
		}
	}
	if o, c, ok := stockFigures(`<GROUP NAME="Stock-in-Hand" RESERVEDNAME="Stock-in-Hand"><CLOSINGBALANCE TYPE="Amount"></CLOSINGBALANCE><OPENINGBALANCE TYPE="Amount">-10.50</OPENINGBALANCE></GROUP>`); !ok || o != 10.5 || c != 0 {
		t.Fatalf("a nil closing: %v %v %v", o, c, ok)
	}
	// the exception: exactly this id as built; anything else with a balance and a period is still caught
	x := stockRequest(zz, "20260401", "20261031")
	if m := computedFigure(x); m != "" {
		t.Fatalf("the click's request caught: %q", m)
	}
	for why, y := range map[string]string{
		"another id":     strings.ReplaceAll(x, "FinComStockInHand", "FinComOtherStock"),
		"stock items":    strings.Replace(x, "<TYPE>Group</TYPE>", "<TYPE>StockItem</TYPE>", 1),
		"ledgers":        strings.Replace(x, "<TYPE>Group</TYPE>", "<TYPE>Ledger</TYPE>", 1),
		"another group":  strings.Replace(x, "Stock-in-Hand&#34;", "Capital Account&#34;", 1),
		"undated":        strings.Replace(x, `<SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20261031</SVTODATE>`, "", 1),
		"a $$ function":  strings.Replace(x, "$ReservedName = &#34;Stock-in-Hand&#34;", "$$IsEqual:$ReservedName:&#34;Stock-in-Hand&#34;", 1),
		"a second coll.": strings.Replace(x, "</TDLMESSAGE>", `<COLLECTION NAME="FinComStockInHand" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>CLOSINGBALANCE</FETCH></COLLECTION></TDLMESSAGE>`, 1),
	} {
		if computedFigure(y) == "" {
			t.Errorf("%s: not caught", why)
		}
	}
	// the decision line, and the class
	a := tallyAllowList[stockID]
	if !strings.Contains(a.purpose, "allowed for "+BridgeVersion+" by the owner's decision of 2026-10-30 (person's click only)") || a.measureOnly || a.maxSec <= 0 ||
		!strings.Contains(a.measuredOn, "41009967960") || requestClass[stockID] != "exception" || BridgeVersion != "2.5.1" {
		t.Fatalf("the allow-list row: %+v, class %q, version %s", a, requestClass[stockID], BridgeVersion)
	}
}

// the allow-list's rows without 2.5.1's FinComStockInHand: 2.5.0's table
func allowRowsBefore251() string {
	var o []string
	for _, l := range strings.SplitAfter(allowListRows(), "\n") {
		if !strings.HasPrefix(l, "| "+stockID+" |") {
			o = append(o, l)
		}
	}
	return strings.Join(o, "")
}

// --- 8. 2.5.1: the version; one request added (the table otherwise 2.5.0's); the decision line names 2.5.1 by the owner's
// decision of 2026-10-30 (person's click only), 2.5.0's kept as history; the dated line; the test sheet
func TestStock251VersionAllowList(t *testing.T) {
	if BridgeVersion != "2.5.1" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	if h := allowListHash(allowRowsBefore251()); h != "0ed4d3e21f6fa4d61374a8bcbdef95d2044078d786d49d5d779c4b6d926332ad" {
		t.Fatalf("a row other than FinComStockInHand changed (%s)", h)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.1 by the owner's decision of 2026-10-30 (person's click only)", "FinComStockInHand " + shapeOf(allowListSamples()[stockID]),
		"run 41009967960", "as for 2.5.0: the owner's decision of 2026-10-30", "as for 2.4.9: the owner's decision of 2026-10-29"} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if !strings.Contains(al, "(re-measured on 2026-10-30 for 2.5.1: FinComStockInHand") {
		t.Error("no dated line for 2.5.1")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.5.1-test-sheet.txt"))
	for _, w := range []string{"2.5.1", "Bring stock from Tally", "Ask Tally again", stockSlowWords, "stock summary"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}
