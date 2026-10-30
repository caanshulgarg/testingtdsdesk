package main

// Bridge 2.5.1 (book 3d36a836, found live on 30-Oct-2026 18:05 IST): 2.5.0 dated its three ledger requests from the Tally
// company's OWN books-from (TDSDeskCompanies' BOOKSFROM). A Tally whose books begin on 1-Apr-2024 while FinCom's copy of
// the book begins on 1-Apr-2025 sent openings as at 1-Apr-2024 (openingsAt 20240401), a year before FinCom's books. The
// period of FinComLedgers, FinComLedgerChanges and FinComLedgerByName is now FinCom's first day of the book, which the
// cloud names in the beat's answer per company (booksFrom {company: yyyymmdd}, tally_books.from_date); only when FinCom
// has none ("" or no answer yet) Tally's BOOKSFROM as 2.5.0 did. The request XML is unchanged (the owner's decision of
// 30-Oct-2026); only the date's source changes, and openingsAt is the date used. Written before the code:
//   1. Tally from 2024-04-01, FinCom from 2025-04-01: the three requests carry 20250401..20260331, the ledger list's and
//      the ledger changes' openingsAt is 20250401, the allow-list takes them (with ReadDays off) and refuses the Tally-dated;
//   2. FinCom has no first day ("" in the answer, or never named): Tally's BOOKSFROM, openingsAt the same;
//   3. FinCom's day is kept on disk (a restart reads it before the first beat), forgotten when the cloud says "";
//      a cloud that names no booksFrom at all (before 2.5.1) changes nothing;
//   4. FinCom's day named while a round is half read: the round starts again, every chunk with FinCom's day;
//   5. the beat itself: booksFrom in the heartbeat's answer is taken (beatOnce), one log line naming both days.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const r251Period = `<SVFROMDATE TYPE="Date">20250401</SVFROMDATE><SVTODATE TYPE="Date">20260331</SVTODATE>`
const r251TallyPeriod = `<SVFROMDATE TYPE="Date">20240401</SVFROMDATE><SVTODATE TYPE="Date">20250331</SVTODATE>`

// the bridge with a stand Tally whose company's books begin on 1-Apr-2024 (Tally's own BOOKSFROM)
func r251Bridge(t *testing.T) (*standTally, *standCloud) {
	t.Helper()
	f, c := r250Bridge(t, "20240401")
	openCompaniesWith(fin, true)
	if tallyBooksFromOf(zz) != "20240401" || booksFromOf(zz) != "20240401" {
		t.Fatalf("Tally's books-from not held: %q %q", tallyBooksFromOf(zz), booksFromOf(zz))
	}
	return f, c
}

// --- 1. FinCom's first day, not Tally's: the three requests, openingsAt, the allow-list
func TestR251FinComFirstDayDatesTheLedgerRequests(t *testing.T) {
	f, c := r251Bridge(t)
	applyBooksFrom(M{"booksFrom": M{zz: "20250401", "Another Co": "20230401"}})
	if booksFromOf(zz) != "20250401" || tallyBooksFromOf(zz) != "20240401" {
		t.Fatalf("FinCom's day not used: %q (Tally %q)", booksFromOf(zz), tallyBooksFromOf(zz))
	}
	for id, x := range map[string]string{ledListID: ledgerChunkRequest(zz, 0, 2000), ledChangesID: ledgerChangesRequest(zz, 5, 205), ledByNameID: ledgerByNameRequest(zz, "Cash")} {
		if !strings.Contains(x, "<SVCURRENTCOMPANY>"+zz+"</SVCURRENTCOMPANY>"+r251Period+"</STATICVARIABLES>") || strings.Contains(x, "20240401") {
			t.Fatalf("%s: not dated from FinCom's first day: %s", id, x)
		}
		if err := checkAllowed(x); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		if err := datedRefused(fin, x); err != nil {
			t.Fatalf("%s refused with ReadDays off: %v", id, err)
		}
		// the same request dated from Tally's own books-from is not this company's period any more: refused
		if y := strings.Replace(x, r251Period, r251TallyPeriod, 1); datedRefused(fin, y) == nil {
			t.Fatalf("%s dated from Tally's books-from let through with ReadDays off", id)
		}
	}
	// the ledger list read: every chunk dated 2025, openingsAt 20250401
	dir := syncFolder(zz)
	if err := newRun("ledgers", "r251-1").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	if err := pushLedgerList(zz, dir); err != nil {
		t.Fatal(err)
	}
	if f.n(ledListID) == 0 || logLines("refused: The request") != 0 {
		t.Fatalf("the read: %v; refused %d", f.ids(), logLines("refused: The request"))
	}
	for _, b := range f.bodiesOf(ledListID) {
		if !strings.Contains(b, r251Period) {
			t.Fatalf("a ledger request not dated from FinCom's first day went: %s", b)
		}
	}
	if len(c.ledList) == 0 {
		t.Fatal("no ledger list sent")
	}
	for _, b := range c.ledList {
		if str(b["openingsAt"]) != "20250401" {
			t.Fatalf("openingsAt is not the date used: %v", b["openingsAt"])
		}
	}
	// a ledger asked by name (the beat's ledgersWanted) goes as ledger_changes with openingsAt 20250401
	noteCompanyGUID(zz, b220CoGUID)
	ledWantedRun(M{"ledgersWanted": []any{M{"company": zz, "company_guid": b220CoGUID, "name": "Customer A"}}})
	if f.n(ledByNameID) != 1 || !strings.Contains(f.bodiesOf(ledByNameID)[0], r251Period) {
		t.Fatalf("the ledger by name: %v", f.ids())
	}
	if len(c.ledChanges) != 1 || str(c.ledChanges[0]["openingsAt"]) != "20250401" {
		t.Fatalf("the ledger changes' openingsAt: %v", c.ledChanges)
	}
}

// --- 2. FinCom has no first day: Tally's BOOKSFROM, as 2.5.0
func TestR251NoFinComDayUsesTallyBooksFrom(t *testing.T) {
	f, c := r251Bridge(t)
	applyBooksFrom(M{"booksFrom": M{zz: ""}})
	if booksFromOf(zz) != "20240401" {
		t.Fatalf("books-from: %q", booksFromOf(zz))
	}
	if x := ledgerChunkRequest(zz, 0, 2000); !strings.Contains(x, r251TallyPeriod) || datedRefused(fin, x) != nil {
		t.Fatalf("not dated from Tally's books-from: %s", x)
	}
	if err := newRun("ledgers", "r251-2").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	_ = pushLedgerList(zz, syncFolder(zz))
	if len(c.ledList) == 0 || str(c.ledList[0]["openingsAt"]) != "20240401" {
		t.Fatalf("openingsAt: %v", c.ledList)
	}
	// a malformed day from the cloud is never used
	for _, bad := range []any{"2025-04-01", "20251301", "2025040", 20250401, "20250401<", nil} {
		applyBooksFrom(M{"booksFrom": M{zz: bad}})
		if booksFromOf(zz) != "20240401" {
			t.Fatalf("%v taken: %q", bad, booksFromOf(zz))
		}
	}
	applyBooksFrom(M{"booksFrom": "20250401"})
	if booksFromOf(zz) != "20240401" {
		t.Fatal("a booksFrom that is not an object taken")
	}
}

// --- 3. kept on disk; forgotten on ""; an answer naming no booksFrom changes nothing
func TestR251FinComDayKeptAndForgotten(t *testing.T) {
	r251Bridge(t)
	applyBooksFrom(M{"booksFrom": M{zz: "20250401"}})
	if _, err := os.Stat(filepath.Join(syncDir(), "fincom-books-from.json")); err != nil {
		t.Fatalf("not kept on disk: %v", err)
	}
	// a restart: nothing held in memory; the day is read from the disk before any beat
	booksFromMu.Lock()
	finComFromHeld, finComFromDir = map[string]string{}, ""
	booksFromMu.Unlock()
	if booksFromOf(zz) != "20250401" {
		t.Fatalf("after a restart: %q", booksFromOf(zz))
	}
	// a cloud before 2.5.1 (no booksFrom) and an answer for other companies only: kept
	applyBooksFrom(M{"ok": true})
	applyBooksFrom(M{"booksFrom": M{"Another Co": "20230401"}})
	if booksFromOf(zz) != "20250401" {
		t.Fatalf("an answer without this company forgot it: %q", booksFromOf(zz))
	}
	// the company named in other spacing and case: the same company
	applyBooksFrom(M{"booksFrom": M{"  " + strings.ToUpper(zz) + " ": ""}})
	if booksFromOf(zz) != "20240401" {
		t.Fatalf("\"\" did not forget FinCom's day: %q", booksFromOf(zz))
	}
	booksFromMu.Lock()
	finComFromHeld, finComFromDir = map[string]string{}, ""
	booksFromMu.Unlock()
	if booksFromOf(zz) != "20240401" {
		t.Fatalf("forgotten, but back after a restart: %q", booksFromOf(zz))
	}
}

// --- 4. FinCom's day named while a round is half read: the round starts again with it
func TestR251RoundStartsAgainWithFinComDay(t *testing.T) {
	f, c := r251Bridge(t)
	dir := syncFolder(zz)
	if err := newRun("ledgers", "r251-4a").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	_ = pushLedgerList(zz, dir)
	if str(readKeepState(dir)["ledOpeningsAt"]) != "20240401" {
		t.Fatalf("the first round: %v", readKeepState(dir)["ledOpeningsAt"])
	}
	// a round 2.5.0 began as at Tally's day, half read
	st := readKeepState(dir)
	st["led"] = M{"started": nowS(), "after": 2, "size": 2000, "empty": 0, "groups": true, "n": 2, "reqs": 1, "round": "half-2024", "openingsAt": "20240401"}
	saveKeepState(dir, st)
	applyBooksFrom(M{"booksFrom": M{zz: "20250401"}})
	n1, l1 := len(c.ledList), f.n(ledListID)
	if err := newRun("ledgers", "r251-4b").step(zz, f.port, ""); err != nil {
		t.Fatal(err)
	}
	_ = pushLedgerList(zz, dir)
	if len(c.ledList) == n1 {
		t.Fatal("no batch for the round as at FinCom's day")
	}
	b := c.ledList[n1]
	if str(b["round"]) == "half-2024" || str(b["openingsAt"]) != "20250401" || len(arr(b["ledgers"])) != 3 {
		t.Fatalf("the round as at FinCom's day: %v", b)
	}
	if !strings.Contains(f.bodiesOf(ledListID)[l1], "$MasterID &gt; 0") {
		t.Fatalf("the round resumed 2.5.0's half: %s", f.bodiesOf(ledListID)[l1])
	}
	for _, x := range f.bodiesOf(ledListID)[l1:] {
		if !strings.Contains(x, r251Period) {
			t.Fatalf("a chunk not dated from FinCom's day: %s", x)
		}
	}
	if str(readKeepState(dir)["ledOpeningsAt"]) != "20250401" {
		t.Fatal("the openings' date is not kept")
	}
}

// --- 5. the heartbeat's answer carries booksFrom: taken, said once in the log with both days
func TestR251BeatAnswerBooksFrom(t *testing.T) {
	_, c := r251Bridge(t)
	c.mu.Lock()
	c.beatReply = M{"booksFrom": M{zz: "20250401"}}
	c.mu.Unlock()
	beatOnce()
	if booksFromOf(zz) != "20250401" {
		t.Fatalf("the beat's booksFrom not taken: %q", booksFromOf(zz))
	}
	beatOnce()
	const said = "Ledgers of " + zz + " are read as at 1-Apr-2025, FinCom's first day of its books of this company (Tally's books begin on 1-Apr-2024)"
	if n := logLines(said); n != 1 {
		t.Fatalf("said %d times", n)
	}
	c.mu.Lock()
	c.beatReply = M{"booksFrom": M{zz: ""}}
	c.mu.Unlock()
	beatOnce()
	if booksFromOf(zz) != "20240401" {
		t.Fatalf("\"\" in the beat not taken: %q", booksFromOf(zz))
	}
}

// --- 6. the version; no row changed and no request added (the table hash is 2.5.0's); the decision line names 2.5.1 by
// the owner's decision of 2026-10-30 (the same dated form, only the date's source changed), 2.5.0's kept as history; the
// dated line; the test sheet
func TestR251VersionAllowList(t *testing.T) {
	if BridgeVersion != "2.5.1" {
		t.Fatalf("BridgeVersion %s", BridgeVersion)
	}
	if h := allowListHash(allowListRows()); !strings.HasPrefix(h, "0ed4d3e21f6f") {
		t.Fatalf("a row of the table changed (%s): 2.5.1 changes no request", h)
	}
	al := readText(filepath.Join("..", "docs", "tally-allowlist.md"))
	line := group(`(?m)^(First table: .*)$`, al, 1)
	for _, w := range []string{"allowed for 2.5.1 by the owner's decision of 2026-10-30", "as for 2.5.0: the owner's decision of 2026-10-30",
		"FinCom's first day of its book of the company (tally_books.from_date", "BOOKSFROM from TDSDeskCompanies only when FinCom has none",
		"FinComLedgers " + shapeOf(allowListSamples()[ledListID]), "FinComLedgerChanges " + shapeOf(allowListSamples()[ledChangesID]),
		"FinComLedgerByName " + shapeOf(allowListSamples()[ledByNameID]), "TDSDeskCompanies " + shapeOf(allowListSamples()["TDSDeskCompanies"])} {
		if !strings.Contains(line, w) {
			t.Errorf("the decision line does not say %q", w)
		}
	}
	if strings.Contains(al, "allowed for 2.5.0 by") {
		t.Error("2.5.0's decision still worded as the current one")
	}
	if !strings.Contains(al, "(re-measured on 2026-10-30 for 2.5.1: ") || !strings.Contains(al, "allowed for 2.5.1 by the owner's decision of 2026-10-30: no request on the list and no request shape changed)") {
		t.Error("no dated line for 2.5.1")
	}
	sheet := readText(filepath.Join("..", "docs", "bridge-2.5.1-test-sheet.txt"))
	for _, w := range []string{"2.5.1", "FinCom's first day", "2.5.1 over 2.5.0", "a year before"} {
		if !strings.Contains(sheet, w) {
			t.Errorf("the test sheet does not say %q", w)
		}
	}
}
