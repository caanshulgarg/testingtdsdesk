package main

// Bridge 2.3.1, part B (the owner's scope, 06-Oct-2026): "Masters, one change: When Tally's master counter moves, ask only
// for ledgers created or altered since the last number. Keep name, group, GSTIN, PAN, state and opening balance current.
// If an entry uses a ledger FinCom does not have, fetch the ledger first, then apply the entry." Approval: "read only,
// inside the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only".
// Not in 2.3.1 (2.3.2): renames, group moves, new and altered groups, deleted ledgers and groups, PAN from GSTIN.
//
// Tests written before the code: the two requests as built (exact XML, read only, the full list's fields and nothing
// else); the counter moving asks only the ledgers changed since the last number (one request a 200-AlterID span); a
// GSTIN altered in Tally goes up; the number moves on only when FinCom's cloud took the ledgers; the 2-second stop;
// postings first; the own Tally only; a new party used at once: the ledger first (by its name), then the entry.

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// a bridge whose stand Tally holds five ledgers, its starting point recorded at their highest AlterID (5)
func led231Bridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	rec, f, c := liveBridge(t, "")
	for _, l := range [][3]string{{"Cash", "Cash-in-Hand", "-1000.00"}, {"Customer A", "Sundry Debtors", "0.00"}, {"Supplier B", "Sundry Creditors", "0.00"},
		{"Sales GST 18%", "Sales Accounts", "0.00"}, {"CGST Output 9%", "Duties & Taxes", "0.00"}} {
		f.addLed(l[0], l[1], l[2])
	}
	noteCompanyGUID(zz, b220CoGUID)
	led231Numbers(t, f)
	if sp, ok := startPointOf(zz); !ok || sp != 5 {
		t.Fatalf("no starting point: %d %v", sp, ok)
	}
	if m, ok := ledChangesAfter(zz, b220CoGUID); ok || m != 0 {
		t.Fatalf("a processed number before the first check: %d %v", m, ok)
	}
	return rec, f, c
}

// the company check, as the light check sends it: the latest change numbers
func led231Numbers(t *testing.T, f *standTally) {
	t.Helper()
	if _, err := companyCheck(&TC{copier: true, light: true}, zz, f.port); err != nil {
		t.Fatal(err)
	}
}

// a ledger altered in Tally: the master counter moves, the ledger takes the new AlterID
func led231Alter(f *standTally, name string, change func(l *tLed)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, l := range f.led {
		if l.name == name {
			change(l)
			f.alter++
			l.alter = f.alter
		}
	}
}

func led231Rows(b M) map[string][]any {
	o := map[string][]any{}
	for _, x := range arr(b["ledgers"]) {
		a := arr(x)
		o[str(at(a, 3))] = a
	}
	return o
}

// --- 1. the two requests as built: exact XML, read only, the full list's fields, one AlterID span or one name
func TestLed231Requests(t *testing.T) {
	ch := ledgerChangesRequest("SAMPLE CO", 5, 205)
	want := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerChanges</ID></HEADER>` +
		`<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>` +
		`<COLLECTION NAME="FinComLedgerChanges" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST, LEDSTATENAME, TDSDEDUCTEETYPE</FETCH>` +
		`<FILTERS>FinComLedgerChangesOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerChangesOnly">$AlterID &gt; 5 AND $AlterID &lt;= 205</SYSTEM>` +
		`</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
	if ch != want {
		t.Fatalf("FinComLedgerChanges:\n%s\nwant\n%s", ch, want)
	}
	bn := ledgerByNameRequest("SAMPLE CO", "New Party & Co")
	wantN := `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerByName</ID></HEADER>` +
		`<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE>` +
		`<COLLECTION NAME="FinComLedgerByName" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST, LEDSTATENAME, TDSDEDUCTEETYPE</FETCH>` +
		`<FILTERS>FinComLedgerByNameOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerByNameOnly">$Name = &#34;New Party &amp; Co&#34;</SYSTEM>` +
		`</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
	if bn != wantN {
		t.Fatalf("FinComLedgerByName:\n%s\nwant\n%s", bn, wantN)
	}
	// the same fields as the full ledger list, nothing else; read only; one collection
	for _, x := range []string{ch, bn} {
		if group(`<FETCH>([^<]*)</FETCH>`, x, 1) != ledFetch || group(`<FETCH>([^<]*)</FETCH>`, ledgerChunkRequest("SAMPLE CO", 0, 2000), 1) != ledFetch {
			t.Fatalf("not the full list's fields: %s", x)
		}
		if !strings.Contains(x, "<TALLYREQUEST>Export</TALLYREQUEST>") || strings.Count(x, "<COLLECTION ") != 1 || !strings.Contains(x, `ISMODIFY="No"`) || isImportRequest(x) || requestDated(x) {
			t.Fatalf("not a read of one collection: %s", x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("refused: %v", err)
		}
		if requestClass[tallyRequestID(x)] != "undated" {
			t.Fatalf("%s is not an undated request", tallyRequestID(x))
		}
	}
	// a name that cannot go in a TDL string is never asked; a request changed by one character is refused (the pin)
	for _, n := range []string{"", `Say "Hi"`, "a\nb", strings.Repeat("x", 201)} {
		if ledgerByNameRequest("SAMPLE CO", n) != "" {
			t.Fatalf("built for %q", n)
		}
	}
	for _, bad := range []string{strings.Replace(ch, "LEDSTATENAME", "LEDSTATENAME, CLOSINGBALANCE", 1), strings.Replace(ch, " AND $AlterID &lt;= 205", "", 1),
		strings.Replace(bn, "$Name = ", "$Parent = ", 1), strings.Replace(ch, "<TYPE>Ledger</TYPE>", "<TYPE>Voucher</TYPE>", 1)} {
		if err := checkAllowed(bad); err == nil {
			t.Fatalf("a changed request passes: %s", bad)
		}
	}
	// the span: 200 AlterIDs a request at most
	if ledChangesSpan() != 200 {
		t.Fatalf("the span is %d", ledChangesSpan())
	}
}

// --- 2. the master counter moves: only the ledgers created or altered since the last number are asked (one request),
// sent as a ledger update (the ledger list's row shape; nothing marked gone, no rename, no round), and the number moves on
// once the cloud took them. GSTIN altered: the new GSTIN goes. A counter that moved for another master: asked, nothing sent
func TestLed231CounterMovesOnlyChangedAsked(t *testing.T) {
	_, f, c := led231Bridge(t)
	// nothing moved since the starting point: nothing asked
	if n, err := ledChangesCheck(zz); n != 0 || err != nil || f.n(ledChangesID) != 0 {
		t.Fatalf("asked with the counter unmoved: %d %v %d", n, err, f.n(ledChangesID))
	}
	if m, ok := ledChangesAfter(zz, b220CoGUID); !ok || m != 5 {
		t.Fatalf("the first number is not the starting point's ALTMSTID: %d %v", m, ok)
	}
	led231Alter(f, "Customer A", func(l *tLed) { l.gstin, l.pan, l.state = "27AAACA1234B1Z5", "AAACA1234B", "Maharashtra" })
	np := f.addLed("New Party", "Sundry Debtors", "500.00")
	led231Numbers(t, f)
	n0 := len(f.reqs)
	n, err := ledChangesCheck(zz)
	if err != nil || n != 2 {
		t.Fatalf("sent %d: %v", n, err)
	}
	if f.n(ledChangesID) != 1 || f.n(ledListID) != 0 || f.n(ledByNameID) != 0 {
		t.Fatalf("requests: %v", f.ids()[n0:])
	}
	b := f.bodiesOf(ledChangesID)[0]
	if !strings.Contains(b, "$AlterID &gt; 5 AND $AlterID &lt;= 7") || b != ledgerChangesRequest(zz, 5, 7) {
		t.Fatalf("the request: %s", b)
	}
	if len(c.ledChanges) != 1 {
		t.Fatalf("ledger updates sent: %d", len(c.ledChanges))
	}
	u := c.ledChanges[0]
	rows := led231Rows(u)
	if str(u["kind"]) != "ledger_changes" || str(u["company"]) != zz || len(rows) != 2 || rows["Customer A"] == nil || rows["New Party"] == nil {
		t.Fatalf("the update: %v", u)
	}
	ca := rows["Customer A"]
	// [guid, MasterID, AlterID, name, parent, opening, GSTIN, PAN, openingChanged, state, deductee type]: the ledger list's row
	if len(ca) != 11 || str(ca[0]) != "led-2" || toI64(ca[2]) != 6 || str(ca[4]) != "Sundry Debtors" || str(ca[6]) != "27AAACA1234B1Z5" || str(ca[7]) != "AAACA1234B" || str(ca[9]) != "Maharashtra" {
		t.Fatalf("Customer A's row: %v", ca)
	}
	if r := rows["New Party"]; str(r[0]) != np.guid || toI64(r[1]) != np.mid || str(r[5]) != "500.00" {
		t.Fatalf("New Party's row: %v", r)
	}
	for _, k := range []string{"seen", "round", "complete", "rowsRead", "renamed", "deleted", "groups", "last"} {
		if _, has := u[k]; has {
			t.Fatalf("the update carries %q (nothing is marked gone, renamed or moved in 2.3.1): %v", k, u)
		}
	}
	if str(u["why"]) != "counter" || toI64(u["after"]) != 5 || toI64(u["upto"]) != 7 {
		t.Fatalf("the update's why / span: %v", u)
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 7 {
		t.Fatalf("the number did not move on to 7: %d", m)
	}
	// again with nothing new: nothing asked
	if n, _ := ledChangesCheck(zz); n != 0 || f.n(ledChangesID) != 1 {
		t.Fatalf("asked again: %d", f.n(ledChangesID))
	}
	// the counter moves for another master (a group, a voucher type): asked once, no ledger, nothing sent, the number moves
	f.mu.Lock()
	f.alter++
	f.mu.Unlock()
	led231Numbers(t, f)
	if n, err := ledChangesCheck(zz); n != 0 || err != nil || f.n(ledChangesID) != 2 || len(c.ledChanges) != 1 {
		t.Fatalf("another master: %d %v %d %d", n, err, f.n(ledChangesID), len(c.ledChanges))
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 8 {
		t.Fatalf("the number: %d", m)
	}
	// a restart keeps the number (sync\ledger-changes.json)
	liveResetState()
	if m, ok := ledChangesAfter(zz, b220CoGUID); !ok || m != 8 {
		t.Fatalf("after a restart: %d %v", m, ok)
	}
	f.noBalance(t)
}

// --- 3. many changes: 200 AlterIDs a request, continuing from the span's end; past the per-check cap the next check goes on
func TestLed231SpansAndCap(t *testing.T) {
	_, f, c := led231Bridge(t)
	f.mu.Lock()
	for i := 0; i < 450; i++ {
		f.addLedLocked(fmt.Sprintf("Party %03d", i), "Sundry Debtors", "0.00")
	}
	f.mu.Unlock()
	led231Numbers(t, f)
	if _, err := ledChangesCheck(zz); err != nil {
		t.Fatal(err)
	}
	bs := f.bodiesOf(ledChangesID)
	if len(bs) != 3 || !strings.Contains(bs[0], "$AlterID &gt; 5 AND $AlterID &lt;= 205") || !strings.Contains(bs[1], "$AlterID &gt; 205 AND $AlterID &lt;= 405") ||
		!strings.Contains(bs[2], "$AlterID &gt; 405 AND $AlterID &lt;= 455") {
		t.Fatalf("the spans: %d %v", len(bs), bs)
	}
	got := 0
	for _, u := range c.ledChanges {
		got += len(arr(u["ledgers"]))
	}
	if got != 450 {
		t.Fatalf("sent %d ledgers", got)
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 455 {
		t.Fatalf("the number: %d", m)
	}
	// a span over the cap (a big import of masters): left to the full ledger list, said in the log, nothing asked
	f.mu.Lock()
	f.alter += 6000
	f.mu.Unlock()
	led231Numbers(t, f)
	if _, err := ledChangesCheck(zz); err != nil || len(f.bodiesOf(ledChangesID)) != 3 || logLines("the full ledger list (Update now or the nightly run) brings them") != 1 {
		t.Fatalf("a span over the cap: %v %d", err, len(f.bodiesOf(ledChangesID)))
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 6455 {
		t.Fatalf("the number after the cap: %d", m)
	}
}

// --- 4. the number moves on only after the cloud confirms: a cloud that cannot take them now keeps it; the next check
// asks again and sends them; a cloud without the kind (an older tally-ingest) the same
func TestLed231AdvanceOnlyAfterCloudConfirms(t *testing.T) {
	_, f, c := led231Bridge(t)
	led231Alter(f, "Supplier B", func(l *tLed) { l.gstin = "29AABCS1111C1Z1" })
	led231Numbers(t, f)
	for _, code := range []int{500, 400} {
		c.mu.Lock()
		c.ledChReply = func(b M) (int, M) {
			if code == 400 {
				return 400, M{"ok": false, "error": "unknown kind"}
			}
			return 500, M{"ok": false, "error": "busy"}
		}
		c.mu.Unlock()
		if n, err := ledChangesCheck(zz); n != 0 || err == nil {
			t.Fatalf("%d: %d %v", code, n, err)
		}
		if m, _ := ledChangesAfter(zz, b220CoGUID); m != 5 {
			t.Fatalf("%d: the number moved without the cloud: %d", code, m)
		}
	}
	c.mu.Lock()
	c.ledChReply = nil
	c.mu.Unlock()
	if n, err := ledChangesCheck(zz); n != 1 || err != nil {
		t.Fatalf("after the cloud is back: %d %v", n, err)
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 6 || f.n(ledChangesID) != 3 || len(c.ledChanges) != 3 {
		t.Fatalf("the number %d, asked %d, sent %d", m, f.n(ledChangesID), len(c.ledChanges))
	}
	if r := led231Rows(c.ledChanges[2])["Supplier B"]; str(r[6]) != "29AABCS1111C1Z1" {
		t.Fatalf("the GSTIN: %v", r)
	}
}

// --- 5. the 2-second rule: a Tally slow to answer is left at 2 s, the number stays; 2.3.1 (the owner's last change): never
// switched off, asked again by itself on the shared retry schedule (retry.go)
func TestLed231TwoSecondStop(t *testing.T) {
	_, f, c := led231Bridge(t)
	led231Alter(f, "Cash", func(l *tLed) { l.open = "-2000.00" })
	led231Numbers(t, f)
	f.mu.Lock()
	f.slow = func(id, body string) time.Duration {
		if id == ledChangesID || id == ledByNameID {
			return 5 * time.Second
		}
		return 0
	}
	f.mu.Unlock()
	// the stand's company lookup is not Tally holding the request, nor the 4 s a background read gives way after a request
	// of FinCom's (tallyWanted): the clock starts at the ledger request
	_, _ = findCompanyPort(zz, 0)
	wantMu.Lock()
	wantAt = time.Time{}
	wantMu.Unlock()
	t0 := time.Now()
	n, err := ledChangesCheck(zz)
	if el := time.Since(t0); err == nil || n != 0 || el > 3500*time.Millisecond || logLines("FinComLedgerChanges took 2.0s and failed") != 1 {
		t.Fatalf("not stopped at 2 s: %d %v after %s %v", n, err, el, f.ids())
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 5 || len(c.ledChanges) != 0 {
		t.Fatalf("the number moved: %d", m)
	}
	// 2.3.1 (the owner's last change): never switched off; nothing more is asked until the shared retry schedule's next try
	if logLines("off: Tally took") != 0 || logLines("(FinComLedgerChanges, try 1); trying again by itself at") != 1 {
		t.Fatalf("switched off, or the retry not said:\n%s", readText(logFile()))
	}
	k := len(f.reqs)
	_, _ = ledChangesCheck(zz)
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "Cash"}}})
	if f.n(ledChangesID) != 1 || f.n(ledByNameID) != 0 {
		t.Fatalf("asked before the retry: %v", f.ids()[k:])
	}
	// at the retry, Tally answering in time: the changes go by themselves, and the wanted ledger
	f.mu.Lock()
	f.slow = nil
	f.mu.Unlock()
	retryDue()
	if n, err := ledChangesCheck(zz); err != nil || f.n(ledChangesID) != 2 || retryHeld() {
		t.Fatalf("not asked again at the retry: %d %v %v", n, err, f.ids()[k:])
	}
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "Cash"}}})
	if f.n(ledByNameID) != 1 {
		t.Fatalf("the wanted ledger not asked: %v", f.ids()[k:])
	}
}

// --- 6. postings first: while a posting goes nothing is asked; the number stays; after it the check goes
func TestLed231PostingsFirst(t *testing.T) {
	_, f, c := led231Bridge(t)
	led231Alter(f, "Customer A", func(l *tLed) { l.pan = "AAACA9999Z" })
	led231Numbers(t, f)
	importsInFlight.Add(1)
	n, _ := ledChangesCheck(zz)
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "Customer A"}}})
	importsInFlight.Add(-1)
	if n != 0 || f.n(ledChangesID) != 0 || f.n(ledByNameID) != 0 || len(c.ledChanges) != 0 {
		t.Fatalf("asked during a posting: %v", f.ids())
	}
	if m, _ := ledChangesAfter(zz, b220CoGUID); m != 5 {
		t.Fatalf("the number moved: %d", m)
	}
	if n, err := ledChangesCheck(zz); n != 1 || err != nil {
		t.Fatalf("after the posting: %d %v", n, err)
	}
}

// --- 7. the own Tally only: a company not open in this bridge's own Windows user's Tally is never asked (the counter of
// another user's Tally on the same computer, or a wanted ledger for its company)
func TestLed231OwnTallyOnly(t *testing.T) {
	_, f, c := led231Bridge(t)
	led231Alter(f, "Customer A", func(l *tLed) { l.gstin = "27AAACA1234B1Z5" })
	led231Numbers(t, f)
	_ = os.Remove(liveOwnTallyFile())
	liveResetState() // a restart, the company never seen open in the own Tally
	n, _ := ledChangesCheck(zz)
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "Customer A"}}})
	if n != 0 || f.n(ledChangesID) != 0 || f.n(ledByNameID) != 0 || len(c.ledChanges) != 0 {
		t.Fatalf("asked a Tally that is not the own one: %v", f.ids())
	}
	// a wanted ledger under another company GUID than the one held for the name: not this bridge's company
	liveSeedOwnOpen(b220CoGUID, zz)
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": "another-guid", "name": "Customer A"}}})
	if f.n(ledByNameID) != 0 {
		t.Fatalf("asked for another company's GUID")
	}
	if n, _ := ledChangesCheck(zz); n != 1 {
		t.Fatalf("open in the own Tally again: %d", n)
	}
}

// --- 8. a new party used at once: the entry's line goes with its body; FinCom holds it ("waiting for the ledger 'New
// Party' from Tally") and names the ledger in the beat's answer; the bridge asks its own Tally for that ledger by name (one
// request), sends it, and only then (the beat's refetch, once the ledger is in) the entry goes again as "<line id>:resolved"
func TestLed231NewPartyLedgerFirstThenEntry(t *testing.T) {
	rec, f, c := led231Bridge(t)
	setCfg("RecorderResolveSec", float64(0))
	np := f.addLed("New Party", "Sundry Debtors", "0.00") // made in the voucher's own screen (Alt+C), so no ledger list has it
	v := &tVch{guid: b220CoGUID + "-00001005", master: "4101", date: "20261004", typ: "Sales", no: "S-17", narr: "first sale", party: "New Party", alter: 9001,
		lines: [][2]string{{"New Party", "-1180.00"}, {"Sales GST 18%", "1000.00"}, {"CGST Output 9%", "90.00"}, {"SGST Output 9%", "90.00"}}}
	f.mu.Lock()
	f.vch = append(f.vch, v)
	f.mu.Unlock()
	noteStartPoint(zz, b220CoGUID, 9000, 5)
	const words = "waiting for the ledger 'New Party' from Tally"
	haveLedger := false
	c.mu.Lock()
	c.recReply = func(b M) (int, M) {
		res := []any{}
		for _, x := range arr(b["lines"]) {
			id, state, why := str(obj(x)["line_id"]), "applied", ""
			if !haveLedger && strings.Contains(str(obj(x)["xml"]), "New Party") {
				state, why = "held", words
			}
			res = append(res, M{"line_id": id, "state": state, "why": why})
		}
		if len(res) > 0 {
			c.recBodies = append(c.recBodies, b)
		}
		return 200, M{"ok": true, "results": res}
	}
	c.ledChReply = func(b M) (int, M) {
		if led231Rows(b)["New Party"] != nil {
			haveLedger = true
		}
		return 200, M{"ok": true, "added": len(arr(b["ledgers"]))}
	}
	c.mu.Unlock()
	old := nowFn
	nowFn = func() time.Time { return time.Date(2026, 10, 4, 10, 20, 0, 0, liveZone) }
	defer func() { nowFn = old }()
	liveAppend(t, liveFilePath(rec, "20261004"), liveLine("voucher_accept_post", "Voucher", v.guid, v.master, "9001", "Sales", "S-17", "4-Oct-2026", "", "", "first sale"))
	readAndUploadAll(t)
	if s := r222cSentID(c, "L"); len(c.recSent()) != 1 || s != nil {
		t.Fatalf("the line: %v", c.recSent())
	}
	lineID := str(c.recSent()[0]["line_id"])
	// the beat: FinCom names the ledger it waits for; the bridge asks its own Tally for it by name, once, and sends it
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "New Party"}}})
	if f.n(ledByNameID) != 1 || !strings.Contains(f.bodiesOf(ledByNameID)[0], "$Name = &#34;New Party&#34;") || f.bodiesOf(ledByNameID)[0] != ledgerByNameRequest(zz, "New Party") {
		t.Fatalf("the ledger was not asked by its name: %v", f.ids())
	}
	if len(c.ledChanges) != 1 || str(c.ledChanges[0]["why"]) != "wanted" || str(led231Rows(c.ledChanges[0])["New Party"][0]) != np.guid {
		t.Fatalf("the ledger did not go: %v", c.ledChanges)
	}
	// asked once in 10 minutes, whatever the beats say
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "New Party"}}})
	if f.n(ledByNameID) != 1 {
		t.Fatalf("asked again at once: %d", f.n(ledByNameID))
	}
	// the next beat: FinCom (the ledger in) lists the held line for refetch; the entry goes again, after the ledger
	applyRefetch(M{"refetch": []any{M{"line_id": lineID, "company": zz, "company_guid": b220CoGUID, "event": "created", "master_id": v.master, "vch_type": "Sales", "vch_no": "S-17", "vch_date": "20261004"}}})
	b230Turns(4)
	r := r222cSentID(c, lineID+":resolved")
	if len(r) != 1 || str(r[0]["object_guid"]) != v.guid || !strings.Contains(str(r[0]["xml"]), "New Party") {
		t.Fatalf("the entry did not go again: %v", c.recSent())
	}
	// the order: the ledger first, then the entry
	iLed, iEnt := -1, -1
	c.mu.Lock()
	for i, k := range c.kinds {
		if k == "ledger_changes" && iLed < 0 {
			iLed = i
		}
		if k == "recorder_lines" && strings.Contains(c.raw[i], lineID+":resolved") {
			iEnt = i
		}
	}
	c.mu.Unlock()
	if iLed < 0 || iEnt < 0 || iLed > iEnt {
		t.Fatalf("the ledger did not go before the entry: %d %d", iLed, iEnt)
	}
	if logLines("fetched from Tally before its entry") != 1 {
		t.Fatal("not said in the log")
	}
}

// --- 9. an entry FinCom held for a ledger whose resolution itself was held so (its "<id>:resolved" waited for the ledger):
// FinCom lists the line again with ledgerAgain once the ledger is in; the bridge asks once more and sends "<id>:resolved"
// again (the same id: FinCom's rules replace both held rows); listed again after that, nothing more is asked
func TestLed231ResolvedWaitingForLedgerAskedOnceMore(t *testing.T) {
	_, f, c := led231Bridge(t)
	setCfg("RecorderResolveSec", float64(0))
	f.addLed("New Party", "Sundry Debtors", "0.00")
	v := &tVch{guid: b220CoGUID + "-00001006", master: "4102", date: "20261004", typ: "Sales", no: "S-18", narr: "sale", party: "New Party", alter: 9002,
		lines: [][2]string{{"New Party", "-100.00"}, {"Sales GST 18%", "100.00"}}}
	f.mu.Lock()
	f.vch = append(f.vch, v)
	f.mu.Unlock()
	noteStartPoint(zz, b220CoGUID, 9000, 5)
	old := nowFn
	nowFn = func() time.Time { return time.Date(2026, 10, 4, 10, 20, 0, 0, liveZone) }
	defer func() { nowFn = old }()
	// "N2:resolved" went from this version already and FinCom held it waiting for the ledger
	live.mu.Lock()
	liveFresh()
	live.sent["N2:resolved"], live.items231["N2:resolved"] = true, true
	live.mu.Unlock()
	liveSaveSent([]string{"N2:resolved"})
	liveSaveIds([]string{"N2:resolved"}, liveItemsSuffix)
	row := M{"line_id": "N2", "company": zz, "company_guid": b220CoGUID, "event": "created", "master_id": v.master, "vch_type": "Sales", "vch_no": "S-18", "vch_date": "20261004"}
	// without ledgerAgain: done (the rule before)
	applyRefetch(M{"refetch": []any{row}})
	b230Turns(3)
	if len(r222cSentID(c, "N2:resolved")) != 0 {
		t.Fatal("sent again without FinCom saying it waited for a ledger")
	}
	row["ledgerAgain"] = true
	applyRefetch(M{"refetch": []any{row}})
	b230Turns(3)
	if s := r222cSentID(c, "N2:resolved"); len(s) != 1 || str(s[0]["object_guid"]) != v.guid {
		t.Fatalf("not sent once more: %v", c.recSent())
	}
	k := f.n(vchObjectID)
	for _, restart := range []bool{false, true} {
		if restart {
			live.mu.Lock()
			live.dir = ""
			live.mu.Unlock()
		}
		applyRefetch(M{"refetch": []any{row}})
		b230Turns(3)
		if len(r222cSentID(c, "N2:resolved")) != 1 || f.n(vchObjectID) != k {
			t.Fatalf("restart %v: asked or sent again", restart)
		}
	}
}

// --- 10. the allow-list's decision line for 2.3.1 names the masters clause beside the entry request's (check 4 of
// release-check.sh reads it), and the two rows are on the table
func TestLed231DecisionLine(t *testing.T) {
	al := readText("../docs/tally-allowlist.md")
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, s := range []string{"as for 2.3.1: the owner's decision of 2026-10-06",
		"; and ledgers created or altered since Tally's master counter last moved (AlterID above the last number), and a ledger an entry uses that FinCom does not have, fetched before the entry is applied; read only, within the 2-second rule",
		"FinComLedgerChanges", "FinComLedgerByName", "renames, group moves, groups and deletions are not in 2.3.1"} {
		if !strings.Contains(line, s) {
			t.Fatalf("the decision line does not say %q", s)
		}
	}
	for _, id := range []string{ledChangesID, ledByNameID} {
		if !strings.Contains(al, "| "+id+" | ") || tallyAllowList[id].purpose == "" {
			t.Fatalf("%s is not on the allow-list", id)
		}
	}
}

// --- 11. the two requests timed on the stand Tally (not real Tally): 2,000 ledgers held, 200 of them changed since the last
// number (one full span) and one asked by its name; each answered well inside the 2-second rule
func TestLed231StandTimes(t *testing.T) {
	_, f, _ := led231Bridge(t)
	f.mu.Lock()
	for i := 0; i < 1995; i++ {
		f.addLedLocked(fmt.Sprintf("Party %04d", i), "Sundry Debtors", "0.00")
	}
	f.mu.Unlock()
	for _, x := range []struct{ id, req string }{{ledChangesID, ledgerChangesRequest(zz, 1800, 2000)}, {ledByNameID, ledgerByNameRequest(zz, "Party 1234")}} {
		took := -1.0
		raw, err := invokeTally(recorderTC(func(sec float64) { took = sec }), f.port, x.req, ledChangesSec())
		rows, _ := ledRowsOf(raw)
		if err != nil || took < 0 || took > liveLimitSec() || len(rows) == 0 {
			t.Fatalf("%s: %v, %d ledgers, %.3f s", x.id, err, len(rows), took)
		}
		t.Logf("%s on the stand: %d ledger(s) in %.0f ms (%d bytes asked)", x.id, len(rows), took*1000, len(x.req))
	}
}
