package main

// Bridge 2.2.0, round 4 of the reviews (R4-1): with ReadDays off the guard decides by request id, not by spelling.
// Written before the fix.

import (
	"strings"
	"testing"
)

var r4Spellings = []string{
	"<svFromDate>20190401</svFromDate><svToDate>20190430</svToDate>",
	`<SYSTEM TYPE="Formulae" NAME="R4">$date &gt; $$Date:&#34;1-Apr-2019&#34;</SYSTEM>`,
	`<SYSTEM TYPE="Formulae" NAME="R4">$DATE &gt; 1</SYSTEM>`,
	`<SYSTEM TYPE="Formulae" NAME="R4">$$isbetween:$Date:1:2</SYSTEM>`,
	`<SYSTEM TYPE="Formulae" NAME="R4">&#36;Date &gt; 1</SYSTEM>`,
	`<SYSTEM TYPE="Formulae" NAME="R4">&#x24;Date &gt; 1</SYSTEM>`,
}

func TestGuardByRequestID(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	noteStartPoint(zz, "co-guid-1", 5, 3)
	samples := allowListSamples()
	// every id on the allow-list is classified
	for id := range tallyAllowList {
		if requestClass[id] == "" {
			t.Errorf("%s is not classified dated / undated / exception", id)
		}
	}
	for id, x := range samples {
		if id == "Import" {
			continue // a posting, not a read: its vouchers carry their dates
		}
		for _, sp := range r4Spellings {
			var y string
			if strings.Contains(x, "</STATICVARIABLES>") && strings.HasPrefix(sp, "<sv") {
				y = strings.Replace(x, "</STATICVARIABLES>", sp+"</STATICVARIABLES>", 1)
			} else {
				y = strings.Replace(x, "</TDLMESSAGE>", sp+"</TDLMESSAGE>", 1)
			}
			if y == x {
				y = x + sp
			}
			if datedRefused(fin, y) == nil {
				t.Errorf("%s with %q passes the guard with ReadDays off", id, cut(sp, 40))
			}
		}
		// the dated ids are refused as they are
		if requestClass[id] == "dated" && datedRefused(fin, x) == nil {
			t.Errorf("%s (dated) passes the guard with ReadDays off", id)
		}
		// the undated ones go as built
		if requestClass[id] == "undated" && datedRefused(fin, x) != nil {
			t.Errorf("%s (undated) is refused as built", id)
		}
	}
	// TDSDeskKeepList: only the undated list above an AlterID, exactly as built
	if datedRefused(fin, keepListAboveRequest(zz, 7)) != nil {
		t.Fatal("the keep list above an AlterID is refused")
	}
	if datedRefused(fin, keepListRequest(zz, "20190401", "20190430", 0)) == nil {
		t.Fatal("the dated keep list passes")
	}
	if datedRefused(fin, strings.Replace(keepListAboveRequest(zz, 7), "GUID,MASTERID", "GUID,NARRATION,MASTERID", 1)) == nil {
		t.Fatal("a keep list not as built passes")
	}
	// a posting still goes, even with "$Date" in a narration
	if datedRefused(fin, importEnvelope("Vouchers", zz, "<VOUCHER><NARRATION>pay $Date</NARRATION></VOUCHER>")) != nil {
		t.Fatal("a posting refused")
	}
}
