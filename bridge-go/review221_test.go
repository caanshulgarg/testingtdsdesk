package main

import "testing"

// 2.2.1 review (Medium): a new LEDGER's placeholder GUID is never rebuilt from its MasterID (the rule is proven for
// vouchers only, on NWS144): the GUID stays empty until Tally gives its own; a voucher's is still rebuilt
func TestPlaceholderGUIDRebuiltForVouchersOnly(t *testing.T) {
	liveBridge(t, "")
	live.mu.Lock()
	liveFresh()
	live.mu.Unlock()
	l, ok := parseRecorderLine(lLine("ledger_accept_post", b220CoGUID+"-00000000", "500", "0", "New Ledger", "Sundry Creditors"))
	if !ok {
		t.Fatal("the ledger line did not parse")
	}
	liveEmit(l, "ledger_created", "f-ledger", 1, 0, 0, 100, false)
	v, ok := parseRecorderLine(liveLine("voucher_accept_post", "Voucher", b220CoGUID+"-00000000", "26312", "0", "Receipt", "192", "20261005", "", "", ""))
	if !ok {
		t.Fatal("the voucher line did not parse")
	}
	liveEmit(v, "created", "f-vch", 1, 0, 200, 300, false)
	var led, vch *change
	for _, c := range liveQueue() {
		c := c
		switch c.event {
		case "ledger_created":
			led = &c
		case "created":
			vch = &c
		}
	}
	if led == nil || vch == nil {
		t.Fatalf("queued: ledger %v, voucher %v", led != nil, vch != nil)
	}
	if led.guid != "" {
		t.Errorf("a new ledger's GUID was built from its MasterID: %q (must stay empty until Tally gives it)", led.guid)
	}
	if want := b220CoGUID + "-000066c8"; vch.guid != want {
		t.Errorf("a new voucher's GUID: %q, want %q", vch.guid, want)
	}
}
