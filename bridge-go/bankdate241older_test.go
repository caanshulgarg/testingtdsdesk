package main

// The real-Tally gate of 2.4.1 (run 37981697177, upg from the published 2.4.0, u2 failed on all five releases): the first
// start of 2.4.1 over 2.4.0's bankdate.json (written without the add-on line count: no addonN, addon or listed) read
// again and sent again, as 'altered' with source bankdate and the same AlterID, the entry 2.4.0's add-on line had already
// sent (S0, MasterID 3): 2.4.1 counted the whole move since 2.4.0's last processed counter as "no add-on line". Written
// before the code (red first).
//
// The fix: a company whose saved state has no add-on line count (a bridge older than 2.4.1 wrote it) takes Tally's counter
// of now as the route's starting point, as 2.4.0 did at its own first check (bankState), and says so once in the log. A
// bank date set in that stretch (before the upgrade, after 2.4.0's last processed counter) is not listed by the bank route
// (small or nightly: both list above the route's counter); it is found by the nightly self-check (selfcheck.go: Tally's
// entries above the self-check's own mark, compared by the cloud with its copy; one FinCom has at an older change is
// fetched with FinComVoucherObject and sent as 'altered' with Tally's entry), which keeps its own mark and is not moved by
// the bank route.

import (
	"strings"
	"testing"
	"time"
)

// bankdate.json as 2.4.0 wrote it: each company without addonN, addon and listed (the counter and the rest kept)
func bankAsOlder(t *testing.T) {
	t.Helper()
	o := readObjFile(bankFile())
	if o == nil {
		t.Fatal("no bankdate.json")
	}
	for _, v := range obj(o["companies"]) {
		e := obj(v)
		delete(e, "addonN")
		delete(e, "addon")
		delete(e, "listed")
	}
	if err := saveFile(bankFile(), jsonText(o)); err != nil {
		t.Fatal(err)
	}
}

// the one company in bankdate.json
func bankSavedOne(t *testing.T) M {
	t.Helper()
	cs := obj(readObjFile(bankFile())["companies"])
	if len(cs) != 1 {
		t.Fatalf("bankdate.json: %v", cs)
	}
	for _, v := range cs {
		return obj(v)
	}
	return nil
}

// two add-on saves read and sent by the older bridge (the counter 54392 -> 54394, its bankdate.json still at 54392 and
// without the line count); the upgrade (a restart into this bridge): nothing listed, read again or sent again; the log
// says the counter was taken as the starting point; the state is saved in the new shape at Tally's counter; a later bank
// date is still found by the route
func TestBankDate241FromOlderStateNoReread(t *testing.T) {
	p, f, c := bankBridge(t, "")
	for _, x := range [][2]string{{"26311", "191"}, {"26312", "192"}} {
		mid, no := x[0], x[1]
		f.mu.Lock()
		for _, v := range f.vch {
			if v.master == mid {
				f.alter++
				v.alter = f.alter
				v.narr = "changed " + no
			}
		}
		f.mu.Unlock()
		g := r222GUID(toI64(mid))
		liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"),
			r222Line("voucher_accept_post", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"))
	}
	readAndUploadAll(t)
	asked := bankAsked(f)
	sent := len(c.recSent())
	bankAsOlder(t)
	if st := bankSavedOne(t); toI64(st["seen"]) != 54392 || st["addonN"] != nil {
		t.Fatalf("the older bridge's state: %v", readObjFile(bankFile()))
	}
	bankRestart()
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if ls := bankLists(f); len(ls) != 0 {
		t.Fatalf("after the upgrade the list was asked (the older bridge's state has no add-on line count): %v", ls)
	}
	if a := bankAsked(f); a["26311"] != asked["26311"] || a["26312"] != asked["26312"] {
		t.Fatalf("after the upgrade Tally was asked again: %v (before %v)", a, asked)
	}
	if s := bankSent(c); len(s) != 0 || len(c.recSent()) != sent {
		t.Fatalf("after the upgrade lines were sent again: %v (%d -> %d)", s, sent, len(c.recSent()))
	}
	if !logHas("Bank dates: " + nwsCo + ": state from an older bridge, counter taken as the starting point") {
		t.Fatalf("the log does not say the counter was taken as the starting point")
	}
	st := bankSavedOne(t)
	if toI64(st["seen"]) != 54394 || st["addonN"] == nil {
		t.Fatalf("the state after the upgrade (want seen 54394, the new shape): %v", st)
	}
	// said once: the next check neither says it again nor lists
	bankCheck(t, f)
	if n := strings.Count(readText(logFile()), "state from an older bridge"); n != 1 {
		t.Fatalf("said %d times", n)
	}
	// the route goes on from there: a later bank date is found and sent once
	laterBy(t, 11*time.Minute)
	bankSet(f, "26312", "20261013")
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if s := bankSent(c); len(s) != 1 || len(s["26312"]) != 1 || !strings.Contains(str(s["26312"][0]["xml"]), "20261013") {
		t.Fatalf("a bank date after the upgrade: %v", s)
	}
}

// a bank date set while the older bridge ran (after its last processed counter, before the upgrade): the bank route does
// not list it (its counter taken as the starting point), the nightly self-check finds it (FinCom's copy holds the entry
// at an older change) and sends it as 'altered' with Tally's entry carrying the bank date
func TestBankDate241FromOlderStateBankDateFoundBySelfCheck(t *testing.T) {
	_, f, c := bankBridge(t, `,"SelfCheck":true`)
	t.Cleanup(func() { selfCheckHoldFn, selfCheckIdleFn = keepHold, idleSec; slowForget() })
	bankSet(f, "26312", "20261009") // in Bank Reconciliation, under the older bridge: no add-on line
	bankAsOlder(t)
	bankRestart()
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if ls := bankLists(f); len(ls) != 0 {
		t.Fatalf("the bank route listed: %v", ls)
	}
	if s := bankSent(c); len(s) != 0 {
		t.Fatalf("the bank route sent: %v", s)
	}
	// the night: the self-check lists above its own mark; the cloud's copy has 26312 at an older change
	var g string
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26312" {
			g = v.guid
		}
	}
	f.mu.Unlock()
	c.scReply = func(b M) (int, M) {
		if str(b["step"]) == "compare" {
			return 200, M{"ok": true, "received": 1, "missing": []any{M{"guid": g, "why": "older"}}}
		}
		return 200, M{"ok": true, "result": "fetched", "words": "1 fetched"}
	}
	scAt(t, time.Date(2026, 10, 9, 23, 10, 0, 0, time.Local))
	r, err := selfCheckStart(nwsCo, f.port)
	if err != nil || r == nil || len(r.queued) != 1 {
		t.Fatalf("the self-check: %v %v", r, err)
	}
	uploadAll(t)
	got := 0
	for _, l := range c.recSent() {
		if str(l["source"]) == "selfcheck" && str(l["event"]) == "altered" && str(l["master_id"]) == "26312" && strings.Contains(str(l["xml"]), "20261009") {
			got++
		}
	}
	if got != 1 {
		t.Fatalf("the bank-dated entry sent by the self-check: %d of %v", got, c.recSent())
	}
	if logHas("the nightly self-check is off") {
		t.Fatalf("the self-check is on here: the off line must not be said")
	}
}

// re-review M1: the older bridge's mark is kept on disk until the company's own first check has taken the counter: a save
// of bankdate.json in between (another company's check, an add-on line, a taken entry) and a second restart do not lose
// it (bankSave wrote "addonN":0 for every company, and the restart then counted the whole move as "no add-on line" again)
func TestBankDate241OlderMarkSurvivesASave(t *testing.T) {
	p, f, c := bankBridge(t, "")
	for _, x := range [][2]string{{"26311", "191"}, {"26312", "192"}} {
		mid, no := x[0], x[1]
		f.mu.Lock()
		for _, v := range f.vch {
			if v.master == mid {
				f.alter++
				v.alter = f.alter
				v.narr = "changed " + no
			}
		}
		f.mu.Unlock()
		g := r222GUID(toI64(mid))
		liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"),
			r222Line("voucher_accept_post", "07:21", g, mid, "54391", "Receipt", no, "5-Oct-2026", "altered"))
	}
	readAndUploadAll(t)
	asked := bankAsked(f)
	sent := len(c.recSent())
	bankAsOlder(t)
	bankRestart()
	// the upgraded bridge saves bankdate.json before this company's first check (as another company's check does)
	bank.mu.Lock()
	bankFresh()
	bankSave()
	bank.mu.Unlock()
	if st := bankSavedOne(t); st["older"] != true || st["addonN"] != nil || st["addon"] != nil || st["listed"] != nil {
		t.Errorf("the mark was not kept by the save: %v", st)
	}
	bankRestart()
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if ls := bankLists(f); len(ls) != 0 {
		t.Fatalf("after a save and a second restart the list was asked: %v", ls)
	}
	if a := bankAsked(f); a["26311"] != asked["26311"] || a["26312"] != asked["26312"] {
		t.Fatalf("Tally was asked again: %v (before %v)", a, asked)
	}
	if s := bankSent(c); len(s) != 0 || len(c.recSent()) != sent {
		t.Fatalf("lines were sent again: %v (%d -> %d)", s, sent, len(c.recSent()))
	}
	if st := bankSavedOne(t); st["older"] != nil || toI64(st["seen"]) != 54394 || st["addonN"] == nil {
		t.Fatalf("the mark must clear only after the company's own check took the counter: %v", st)
	}
	// re-review L1: the nightly self-check is off here (the package's tests): said once with the Day Book words
	if n := strings.Count(readText(logFile()), "Bank dates: "+nwsCo+": the nightly self-check is off; a bank date set during the upgrade will need that day's Day Book."); n != 1 {
		t.Fatalf("the self-check-off line said %d times", n)
	}
	laterBy(t, 11*time.Minute)
	bankSet(f, "26312", "20261014")
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if s := bankSent(c); len(s) != 1 || len(s["26312"]) != 1 || !strings.Contains(str(s["26312"][0]["xml"]), "20261014") {
		t.Fatalf("a bank date after the upgrade: %v", s)
	}
}

// re-review M1, several companies: one company is not opened on the upgrade day; the others' checks save bankdate.json
// and the bridge restarts: the closed company keeps the older bridge's mark (and its counter) until its own first check
func TestBankDate241OlderMarkKeptForAClosedCompany(t *testing.T) {
	_, f, _ := bankBridge(t, "")
	o := readObjFile(bankFile())
	cs := obj(o["companies"])
	cs["zz closed co|0f0f0f0f-0000-4000-8000-000000000001"] = M{"company": "ZZ CLOSED CO", "cguid": "0f0f0f0f-0000-4000-8000-000000000001", "seen": 777, "route": "small", "why": "", "listMs": 0, "night": "", "readAt": "", "cands": []any{}}
	if err := saveFile(bankFile(), jsonText(o)); err != nil {
		t.Fatal(err)
	}
	bankAsOlder(t)
	bankRestart()
	bankCheck(t, f) // the open company's first check: its mark cleared, the file saved
	bankRestart()
	cs = obj(readObjFile(bankFile())["companies"])
	var open, closed M
	for _, v := range cs {
		e := obj(v)
		if str(e["company"]) == "ZZ CLOSED CO" {
			closed = e
		} else {
			open = e
		}
	}
	if open == nil || open["older"] != nil || open["addonN"] == nil {
		t.Fatalf("the open company after its check: %v", open)
	}
	if closed == nil || closed["older"] != true || closed["addonN"] != nil || toI64(closed["seen"]) != 777 {
		t.Fatalf("the closed company lost the older bridge's mark: %v", closed)
	}
	bank.mu.Lock()
	bankFresh()
	st := bank.cos["zz closed co|0f0f0f0f-0000-4000-8000-000000000001"]
	older := st != nil && st.older
	bank.mu.Unlock()
	if !older {
		t.Fatalf("read back without the mark: %+v", st)
	}
}
