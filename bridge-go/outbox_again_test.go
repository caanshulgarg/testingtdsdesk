package main

import "testing"

// --- 7. every line carries "again" (a first send ""); a resolution sent once more on purpose says why ("items": FinCom
// asked again after an older bridge's resolution; "ledger": after a ledger FinCom waited for came in), so FinCom tells a
// deliberate resend from a repeat
func TestOutboxAgainMarker(t *testing.T) {
	c := &change{lineId: "x", event: "created", source: "addon"}
	if v, had := c.wire()["again"]; !had || v != "" {
		t.Fatalf("a first send's again: %v %v", v, had)
	}
	for _, k := range []struct {
		h    heldLine
		want string
	}{{heldLine{}, ""}, {heldLine{Again: true}, "items"}, {heldLine{LedgerAgain: true}, "ledger"}, {heldLine{Again: true, LedgerAgain: true}, "ledger"}} {
		if got := liveAgainOf(k.h); got != k.want {
			t.Errorf("%+v: %q (want %q)", k.h, got, k.want)
		}
		c.again = liveAgainOf(k.h)
		if c.wire()["again"] != k.want {
			t.Errorf("the wire's again: %v", c.wire()["again"])
		}
	}
}
