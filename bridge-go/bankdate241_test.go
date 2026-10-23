package main

// The coordinator's item from the real-Tally dry run 37938029402 (u2 failed on all five releases): after a restart (the
// 2.4.0 -> 2.4.1 upgrade, a reboot) the bank route read again and sent again, as 'altered' with source bankdate and the
// same AlterIDs, entries whose add-on lines it had read before the restart ("Tally's voucher counter moved with no add-on
// line for 2 entries ... each is read again from Tally"): its count of the add-on's lines (addonN, addon) was kept in
// memory only, while the counter it saved in bankdate.json lagged behind. Written before the code (red first).

import (
	"testing"
)

// a start of the bridge: the bank route's and the recorder's state read again from disk
func bankRestart() {
	liveResetState()
	bank.mu.Lock()
	bank.dir, bank.cos = "", nil
	bank.mu.Unlock()
}

// two saves the add-on wrote lines for, read and sent; the bridge restarts before its next light check: the counter's move is
// explained by those lines (kept in bankdate.json with the counter), nothing is listed, read again or sent again
func TestBankDate241RestartNoReread(t *testing.T) {
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
	bankRestart()
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if ls := bankLists(f); len(ls) != 0 {
		t.Fatalf("after the restart the list was asked although the add-on's lines explain the move: %v", ls)
	}
	if a := bankAsked(f); a["26311"] != asked["26311"] || a["26312"] != asked["26312"] {
		t.Fatalf("after the restart Tally was asked again: %v (before %v)", a, asked)
	}
	if s := bankSent(c); len(s) != 0 || len(c.recSent()) != sent {
		t.Fatalf("after the restart lines were sent again: %v (%d -> %d)", s, sent, len(c.recSent()))
	}
	// the move explained, Seen moved on: a later bank date is still found (the route goes on)
	bankSet(f, "26312", "20261011")
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	if s := bankSent(c); len(s["26312"]) != 1 {
		t.Fatalf("a bank date after the restart: %v", s)
	}
}

// the add-on's lines read, the restart BEFORE the light check moved anything, then a bank date in the same stretch: only
// the bank-dated entry is read by the route (the add-on's own entries are explained by their lines, kept on disk)
func TestBankDate241RestartThenBankDate(t *testing.T) {
	p, f, c := bankBridge(t, "")
	f.mu.Lock()
	for _, v := range f.vch {
		if v.master == "26311" {
			f.alter++
			v.alter = f.alter
		}
	}
	f.mu.Unlock()
	g := r222GUID(26311)
	liveAppend(t, p, r222Line("voucher_accept_pre", "07:21", g, "26311", "54391", "Receipt", "191", "5-Oct-2026", "altered"),
		r222Line("voucher_accept_post", "07:21", g, "26311", "54391", "Receipt", "191", "5-Oct-2026", "altered"))
	readAndUploadAll(t)
	bankRestart()
	bankSet(f, "26312", "20261012")
	bankCheck(t, f)
	for i := 0; i < 4; i++ {
		readAndUploadAll(t)
	}
	s := bankSent(c)
	if len(s) != 1 || len(s["26312"]) != 1 {
		t.Fatalf("after the restart: bank lines %v (want 26312 only)", s)
	}
}
