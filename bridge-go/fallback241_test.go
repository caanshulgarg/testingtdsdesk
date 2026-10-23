package main

// 2.4.1 (the owner's approval of 09-Oct-2026, item 5): a created or altered line whose MasterID answer is an older entry
// ("not a change after the starting point"), no entry at all, or another type, date or number is asked ONCE by its type
// and number (FinComVoucherByNumber, its date from the starting day to today, as voucherByNumberExact allows) and takes
// the answer only when exactly one voucher comes back and it passes liveVoucherWrong with the MasterID cleared (its
// AlterID above the starting point, Tally's own GUID, the line's type, date and number). This reverses 2.3.4's L5 for
// this case only. Item 6: the log says why FinComVoucherByNumber was refused before it went (not "ReadDays").
// Tests written before the code (nwsBridge: the starting point 54389 of 05-Oct-2026).

import (
	"strings"
	"testing"
	"time"
)

func fb241Bridge(t *testing.T) (string, *standTally, *standCloud) {
	t.Helper()
	p, f, c := nwsBridge(t, `,"RecorderResolveSec":0`)
	setCfg("RecorderBodySec", float64(20)) // the background read waits its turn behind the company lookup (about 4 s here)
	return p, f, c
}

func fb241Post(tm, mid, typ, no string) string {
	return r222Line("voucher_accept_post", tm, nwsGUID+"-00000000", mid, "0", typ, no, "5-Oct-2026", "s "+no)
}

// the owner's case of 09-Oct-2026: Sales 2026-27/GST/297 came with MasterID 25743, an older voucher in this Tally (below
// the starting point); Tally's own Sales 297 of that day (one, above the starting point) is the line's entry
func TestFallback241OlderEntryByNumber(t *testing.T) {
	p, f, c := fb241Bridge(t)
	r222Vch(f, 25743, "Sales", "2025-26/GST/12", "20261005", 50000)
	own := r222Vch(f, 26400, "Sales", "2026-27/GST/297", "20261005", 54600)
	liveAppend(t, p, fb241Post("11:30", "25743", "Sales", "2026-27/GST/297"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["event"]) != "created" || str(s[0]["object_guid"]) != own.guid || !strings.Contains(str(s[0]["xml"]), "<GUID>"+own.guid+"</GUID>") || str(s[0]["heldWhy"]) != "" {
		t.Fatalf("Sales 297 by its number: %v", s)
	}
	// review M1 of next-241: the narration is the entry's own (Tally's), never the line's
	if str(s[0]["narration"]) != "Sales 2026-27/GST/297" {
		t.Fatalf("the narration sent: %q", str(s[0]["narration"]))
	}
	if f.n(vchByNumberID) != 1 {
		t.Fatalf("asked by number %d times: %v", f.n(vchByNumberID), f.ids())
	}
}

// no voucher with the line's MasterID: found by its number
func TestFallback241NotFoundByNumber(t *testing.T) {
	p, f, c := fb241Bridge(t)
	own := r222Vch(f, 26401, "Sales", "2026-27/GST/298", "20261005", 54601)
	liveAppend(t, p, fb241Post("11:31", "27000", "Sales", "2026-27/GST/298"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["object_guid"]) != own.guid || str(s[0]["xml"]) == "" {
		t.Fatalf("Sales 298 by its number: %v", s)
	}
	if f.n(vchByNumberID) != 1 {
		t.Fatalf("asked by number %d times", f.n(vchByNumberID))
	}
}

// review M1 of next-241: the MasterID gives another type (a Payment): 2.4.0's hold, never asked by its number (the probe:
// Sales 6 with MasterID 26500 was taken as 26501 after a renumbering)
func TestFallback241OtherTypeByNumber(t *testing.T) {
	p, f, c := fb241Bridge(t)
	r222Vch(f, 25683, "Payment", "P-4", "20261005", 54502)
	r222Vch(f, 25800, "Journal", "J-77", "20261005", 54520)
	liveAppend(t, p, fb241Post("08:40", "25683", "Journal", "J-77"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["xml"]) != "" || !strings.Contains(str(s[0]["heldWhy"]), "is a Payment of 05-Oct-2026, not this Journal") {
		t.Fatalf("held: %v", s)
	}
	if f.n(vchObjectID) != 1 || f.n(vchByNumberID) != 0 {
		t.Fatalf("requests: %v", f.ids())
	}
}

// the probe of M1: Sales 6 (MasterID 26500) renumbered in Tally; the voucher with MasterID 26500 is now Sales 7: held,
// never Sales 6 = MasterID 26501 taken by its number
func TestFallback241RenumberedNotTaken(t *testing.T) {
	p, f, c := fb241Bridge(t)
	r222Vch(f, 26500, "Sales", "7", "20261005", 54700)
	r222Vch(f, 26501, "Sales", "6", "20261005", 54701)
	liveAppend(t, p, fb241Post("09:00", "26500", "Sales", "6"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["xml"]) != "" || strings.Contains(jsonText(s[0]), r222GUID(26501)) || f.n(vchByNumberID) != 0 {
		t.Fatalf("Sales 6 was taken as MasterID 26501: %v %v", s, f.ids())
	}
}

// two vouchers of that type and number on that day: held with true words, asked by number once only (the held list asks
// by its MasterID alone afterwards)
func TestFallback241TwoMatchesHeld(t *testing.T) {
	p, f, c := fb241Bridge(t)
	r222Vch(f, 25743, "Sales", "2025-26/GST/12", "20261005", 50000)
	r222Vch(f, 26402, "Sales", "2026-27/GST/299", "20261005", 54602)
	r222Vch(f, 26403, "Sales", "2026-27/GST/299", "20261005", 54603)
	liveAppend(t, p, fb241Post("11:32", "25743", "Sales", "2026-27/GST/299"))
	readAndUploadAll(t)
	for i := 0; i < 10; i++ {
		liveUploadOnce()
	}
	s := c.recSent()
	if len(s) < 1 || str(s[0]["xml"]) != "" || str(s[0]["object_guid"]) != "" {
		t.Fatalf("taken: %v", s)
	}
	w := str(s[0]["heldWhy"])
	if !strings.Contains(w, "older entry") || !strings.Contains(w, "2 entries with that type and number on that date") || strings.Contains(w, "2025-26/GST/12") {
		t.Fatalf("the words: %q", w)
	}
	if f.n(vchByNumberID) != 1 {
		t.Fatalf("asked by number %d times", f.n(vchByNumberID))
	}
}

// another type by its MasterID and no voucher of the line's type and number on its date: held with true words
func TestFallback241WrongTypeNoneHeld(t *testing.T) {
	p, f, c := fb241Bridge(t)
	r222Vch(f, 25683, "Payment", "P-4", "20261005", 54502)
	r222Vch(f, 25801, "Journal", "J-78", "20261004", 54521) // another date
	liveAppend(t, p, fb241Post("08:41", "25683", "Journal", "J-78"))
	readAndUploadAll(t)
	s := c.recSent()
	if len(s) != 1 || str(s[0]["xml"]) != "" {
		t.Fatalf("taken: %v", s)
	}
	w := str(s[0]["heldWhy"])
	if !strings.Contains(w, "is a Payment of 05-Oct-2026, not this Journal") {
		t.Fatalf("the words: %q", w)
	}
	if f.n(vchByNumberID) != 0 { // review M1: another type: never asked by its number
		t.Fatalf("asked by number %d times", f.n(vchByNumberID))
	}
}

// item 6: FinComVoucherByNumber refused before it went: the log says why, never "reading old entries is off (ReadDays)"
func TestFallback241RefusedWords(t *testing.T) {
	_, f, _ := fb241Bridge(t)
	x := voucherByNumberRequest(nwsCo, "20261001", "Receipt", "5")
	if _, err := invokeTallyNow(recorderTC(nil), f.port, x, 2); err == nil {
		t.Fatal("a date before the starting day went")
	}
	if logLines("FinComVoucherByNumber refused before sending: the date is before the company's starting day (05-Oct-2026)") < 1 {
		t.Fatalf("the log:\n%s", r222eLog())
	}
	at := time.Date(2026, 10, 10, 9, 0, 0, 0, liveZone)
	nowFn = func() time.Time { return at }
	x = voucherByNumberRequest(nwsCo, "20261005", "Receipt", "6")
	if _, err := invokeTallyNow(recorderTC(nil), f.port, x, 2); err == nil {
		t.Fatal("an older date not just asked went")
	}
	if logLines("FinComVoucherByNumber refused before sending: older than 3 days and not just asked") < 1 {
		t.Fatalf("the log:\n%s", r222eLog())
	}
	if strings.Contains(r222eLog(), "FinComVoucherByNumber refused before sending: it carries a period and reading old entries is off (ReadDays)") {
		t.Fatal("the ReadDays words for FinComVoucherByNumber")
	}
}
