package main

// Bridge 2.3.1 against REAL TallyPrime 7.1 (run 37435532807 of the real-Tally harness on 3eebfb1, 06-Oct-2026; the captures
// in testdata/real-tally-7.1/231, manifest.json). Written before the fix.
//
// Defect 3 (bank details empty): Tally holds the bank allocation of S7 (Same Bank Transfer, instrument number
// SBINR52027020100231, date 20270201), but the entry request's fetch of ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE,
// .INSTRUMENTNUMBER, .INSTRUMENTDATE and .BANKERSDATE came back as an empty BANKALLOCATIONS.LIST. The harness's own
// collection of the same entry with every field (ALLLEDGERENTRIES.BANKALLOCATIONS.*) gave it: DATE and NAME first (the
// allocation's own identity, Tally writes the instrument number in NAME too), the four fields, and UNIQUEREFERENCENUMBER
// (the UTR). The bill-wise allocation (fetched with its NAME) and the cost categories (fetched with CATEGORY) came back
// filled; the bank allocation was fetched without its NAME and DATE. The fix fetches those two and the UTR with the four,
// on the same path, nothing else: the bank details the owner approved ("instrument number or UTR, instrument date, bank
// date, transaction type"). The cloud's reader (parse.js) is tested on the same capture by tests/run_parse_real231.mjs.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func real231(t *testing.T, f string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "real-tally-7.1", "231", f))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// the bank allocation's fields, all on ALLLEDGERENTRIES.BANKALLOCATIONS, in the fetch exactly once
func TestReal231BankFetch(t *testing.T) {
	want := []string{"DATE", "NAME", "TRANSACTIONTYPE", "INSTRUMENTNUMBER", "INSTRUMENTDATE", "BANKERSDATE", "UNIQUEREFERENCENUMBER"}
	fields := strings.Split(liveFetchField, ", ")
	for _, w := range want {
		n := 0
		for _, f := range fields {
			if f == "ALLLEDGERENTRIES.BANKALLOCATIONS."+w {
				n++
			}
		}
		if n != 1 {
			t.Errorf("the entry request fetches ALLLEDGERENTRIES.BANKALLOCATIONS.%s %d times (want once)", w, n)
		}
	}
	// nothing else about the bank: every BANKALLOCATIONS field is one of these
	for _, f := range fields {
		if strings.Contains(f, "BANKALLOCATIONS.") && !strings.HasPrefix(f, "ALLLEDGERENTRIES.BANKALLOCATIONS.") {
			t.Errorf("a bank field on another path: %s", f)
		}
	}
	// every field Tally's own bank allocation of S7 carries a value in, of those the owner named, is fetched
	all := real231(t, "s7-bank-payment-utr.collection-all.xml")
	for _, w := range []string{"TRANSACTIONTYPE", "INSTRUMENTNUMBER", "INSTRUMENTDATE", "UNIQUEREFERENCENUMBER"} {
		if !strings.Contains(all, "<"+w+">") {
			t.Fatalf("the capture has no %s", w)
		}
	}
}

// the body the bridge takes from Tally's answer keeps the bank allocation as Tally gave it (the capture with every field),
// and from the run's answers each scenario's one entry by its MasterID, whole (both of Tally's lists of an item invoice kept:
// the cloud's reader takes each line once)
func TestReal231BodiesTaken(t *testing.T) {
	take := func(raw string) map[string]string {
		out := map[string]string{}
		for _, m := range reVchBlock.FindAllString(raw, -1) {
			if id := tagNum(m, "MASTERID"); id != "" {
				out[id] = cleanXML(m)
			}
		}
		return out
	}
	s7 := take(real231(t, "s7-bank-payment-utr.collection-all.xml"))
	b := s7["16"]
	for _, w := range []string{"<TRANSACTIONTYPE>Same Bank Transfer</TRANSACTIONTYPE>", "<INSTRUMENTNUMBER>SBINR52027020100231</INSTRUMENTNUMBER>",
		"<INSTRUMENTDATE>20270201</INSTRUMENTDATE>", "<UNIQUEREFERENCENUMBER>SBINR52027020100231</UNIQUEREFERENCENUMBER>"} {
		if !strings.Contains(b, w) {
			t.Fatalf("S7's body as taken lacks %s (%d characters)", w, len(b))
		}
	}
	mids := map[string]string{"s1-sales-two-rates": "10", "s2-purchase-items": "11", "s3-credit-note-items": "12", "s4-receipt-against-bill": "13",
		"s5-payment-tds": "14", "s6-journal-cost-centres": "15", "s7-bank-payment-utr": "16", "s10-sales-50-items": "17", "s11-sales-freight-gst": "18",
		"s12-sales-round-off": "19", "s13-sales-discount": "20", "s14-sales-tax-inclusive": "21", "s8-new-party": "22", "s15-renamed-party": "23"}
	for k, mid := range mids {
		got := take(real231(t, k+".entry.xml"))
		x := got[mid]
		if len(got) != 1 || x == "" || tagValue(x, "GUID") != "fd3c65f7-3356-4b09-8177-48e9c18577ed-"+guidHex(mid) {
			t.Fatalf("%s: %d entr(ies), MasterID %s %d characters, GUID %q", k, len(got), mid, len(x), tagValue(x, "GUID"))
		}
		if strings.Contains(x, "<ALLINVENTORYENTRIES.LIST>") && strings.Count(x, "<ACCOUNTINGALLOCATIONS.LIST>") == 0 && strings.Contains(x, "<STOCKITEMNAME") {
			t.Fatalf("%s: the lines under the items are not in the body", k)
		}
	}
}

func guidHex(mid string) string {
	n := toI64(mid)
	const h = "0123456789abcdef"
	out := []byte("00000000")
	for i := 7; i >= 0 && n > 0; i-- {
		out[i] = h[n%16]
		n /= 16
	}
	return string(out)
}
