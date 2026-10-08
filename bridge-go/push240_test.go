package main

import (
	"strings"
	"testing"
	"time"
)

// 2.4.0 (next-push with 2.3.4's fast request merged): a full line the trust rule (pushTrust) does not take is confirmed by
// ONE fast request, FinComVoucherObject (the owner, 08-Oct-2026: "never apply a bill type that may be wrong"); its body is
// Tally's own record, stripped as 2.3.4 strips it; every other full line goes with no request at all, nothing held back.
// The two untrusted kinds of tally-versions run 37722273938: an invoice made new (Invoice Voucher View: Tally allocates its
// bill as it stores the entry) and an Alt+2 copy carrying a New Ref bill (Tally stores Agst Ref).
func TestPush240UntrustedConfirmedByFastRequest(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	f.alter = 10 // every entry a change after the starting point
	noteStartPoint(zz, b220CoGUID, 5, 1)
	td := today()
	p := liveFilePath(rec, "")
	n0 := len(f.ids())
	bill := func(name, typ string) string {
		return "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party A</LEDGERNAME><AMOUNT>0.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>" + name +
			"</NAME><BILLTYPE>" + typ + "</BILLTYPE><AMOUNT>0.00</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>"
	}

	// 1. a journal made new (trusted): no request, sent at once with its body from the line
	j := f.add(td, "Party A", "J-1", "journal", "-100.00")
	liveAppend(t, p, pushSave(t, f, j, true, "")...)
	readAndUploadAll(t)
	if k := f.n(vchObjectID) + f.n(vchByNumberID); k != 0 || len(f.ids()) != n0 {
		t.Fatalf("a trusted line asked Tally: %v", f.ids()[n0:])
	}
	if s := c.recSent(); len(s) != 1 || s[0]["push"] != true || str(s[0]["object_guid"]) != j.guid {
		t.Fatalf("the trusted line: %v", s)
	}

	// 2. an invoice made new (Invoice Voucher View): one FinComVoucherObject, the body Tally's (stripped), not the line's
	inv := f.add(td, "Party A", "S-1", "invoice made new", "-1180.00")
	inv.typ = "Sales"
	inv.extra = "<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>" + bill("S-1", "New Ref") + "<UDF:SECRET.LIST>x</UDF:SECRET.LIST>"
	liveAppend(t, p, pushSave(t, f, inv, true, "")...)
	readAndUploadAll(t)
	if f.n(vchObjectID) != 1 || f.n(vchByNumberID) != 0 {
		t.Fatalf("the invoice made new: requests %v", f.ids()[n0:])
	}
	s := c.recSent()
	if len(s) != 2 || s[1]["push"] != nil || str(s[1]["event"]) != "created" || str(s[1]["object_guid"]) != inv.guid || tagValue(str(s[1]["xml"]), "GUID") != inv.guid {
		t.Fatalf("the invoice made new: %v", s[len(s)-1])
	}
	x := str(s[1]["xml"])
	if !strings.Contains(x, "<BILLTYPE>New Ref</BILLTYPE>") || strings.Contains(x, "SECRET") {
		t.Fatalf("the invoice's body is not Tally's stripped record: %s", x)
	}
	if logLines("an invoice made new") < 1 {
		t.Fatal("the reason is not in the log")
	}

	// 3. an Alt+2 copy carrying a New Ref bill: the form keeps the GUID of the entry it was copied from; one request
	src := f.add(td, "Party A", "J-2", "copied from", "-200.00")
	cp := f.add(td, "Party A", "J-3", "the copy", "-200.00")
	cp.extra = bill("JN-1", "New Ref")
	l := pushSave(t, f, cp, true, "")
	for i := range l { // the form's GUID in every line of the save, the full entry's own guid= too (as real Alt+2 lines carry it)
		l[i] = strings.ReplaceAll(l[i], "|guid="+b220CoGUID+"-00000000|", "|guid="+src.guid+"|")
	}
	liveAppend(t, p, l...)
	readAndUploadAll(t)
	if f.n(vchObjectID) != 2 || f.n(vchByNumberID) != 0 {
		t.Fatalf("the copy: requests %v", f.ids()[n0:])
	}
	s = c.recSent()
	if len(s) != 3 || s[2]["push"] != nil || str(s[2]["object_guid"]) != cp.guid {
		t.Fatalf("the copy: %v", s[len(s)-1])
	}
	if logLines("an Alt+2 copy with a New Ref bill") < 1 {
		t.Fatal("the copy's reason is not in the log")
	}

	// 4. the same invoice altered (trusted: Tally's own stored bill is in the form): no request
	nowFn = func() time.Time { return time.Now().Add(time.Minute) }
	t.Cleanup(func() { nowFn = time.Now })
	inv.narr = "invoice made new, altered"
	inv.alter++
	liveAppend(t, p, pushSave(t, f, inv, false, "")...)
	readAndUploadAll(t)
	if f.n(vchObjectID) != 2 {
		t.Fatalf("the alteration asked Tally: %v", f.ids()[n0:])
	}
	s = c.recSent()
	if len(s) != 4 || s[3]["push"] != true || str(s[3]["event"]) != "altered" || !strings.Contains(str(s[3]["xml"]), "altered") {
		t.Fatalf("the alteration: %v", s[len(s)-1])
	}
}
