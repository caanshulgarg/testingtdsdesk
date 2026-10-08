package main

// Next (branch next-masterhook; the owner's item c): the add-on hooks the Pay Head, Stock Item and Godown forms (Unit and
// Employee not hooked: not proven on real Tally; the bridge still pairs their lines, FinCom refuses them) as it hooks the Ledger form (On Form Accept: a line before Tally's own save and one after it). The bridge maps
// each pair to master_created / master_altered and sends it as HEADS ONLY: the master's type, name, GUID, MasterID,
// AlterID and parent; nothing is ever asked of Tally for it. Tests written before the code; both stand modes.

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// the add-on's master forms and the event prefix each writes
var mhKinds = []struct{ ev, form string }{{"payhead", "Pay Head"}, {"stockitem", "Stock Item"}, {"unit", "Unit"}, {"godown", "Godown"}, {"employee", "Employee"}}

func mhLine(ev, guid, mid, aid, name, parent string) string {
	return liveLine(ev, "Master", guid, mid, aid, "", "", "", name, parent, "")
}

// each master form's pair: a new one (Tally's MasterID 0 before its save) and an altered one; heads only to the cloud
func TestMasterHookPairsHeadsOnly(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	var want []string
	for i, k := range mhKinds {
		g := b220CoGUID + "-0000" + []string{"0a01", "0a02", "0a03", "0a04", "0a05"}[i]
		mid := []string{"2561", "2562", "2563", "2564", "2565"}[i]
		liveAppend(t, p,
			mhLine(k.ev+"_accept_pre", "", "0", "0", "New "+k.form, "Primary"),
			mhLine(k.ev+"_accept_post", "", "0", "0", "New "+k.form, "Primary"),
			mhLine(k.ev+"_accept_pre", g, mid, "40", "Old "+k.form, "Group A"),
			mhLine(k.ev+"_accept_post", g, mid, "41", "Old "+k.form+" renamed", "Group B"))
		want = append(want, "master_created", "master_altered")
	}
	readAndUploadAll(t)
	sent := c.recSent()
	var evs []string
	for _, l := range sent {
		evs = append(evs, str(l["event"]))
	}
	if strings.Join(evs, ",") != strings.Join(want, ",") {
		t.Fatalf("events sent: %v, want %v", evs, want)
	}
	for i, k := range mhKinds {
		n, a := sent[2*i], sent[2*i+1]
		if str(n["master_type"]) != k.form || str(n["name"]) != "New "+k.form || str(n["parent"]) != "Primary" || str(n["object_guid"]) != "" || str(n["master_id"]) != "" {
			t.Errorf("%s created: %v", k.form, n)
		}
		g := b220CoGUID + "-0000" + []string{"0a01", "0a02", "0a03", "0a04", "0a05"}[i]
		if str(a["master_type"]) != k.form || str(a["name"]) != "Old "+k.form+" renamed" || str(a["parent"]) != "Group B" || str(a["object_guid"]) != g ||
			str(a["master_id"]) != []string{"2561", "2562", "2563", "2564", "2565"}[i] || toI64(a["alter_id"]) != 41 {
			t.Errorf("%s altered: %v", k.form, a)
		}
		// heads only: no body, no ledgers, no narration, no FinCom id
		for _, l := range []M{n, a} {
			if str(l["xml"]) != "" || len(arr(l["ledgers"])) != 0 || str(l["narration"]) != "" || str(l["fid"]) != "" || l["full"] == true {
				t.Errorf("%s: more than heads: %v", k.form, l)
			}
		}
	}
	// nothing was asked of Tally for them (no entry, no ledger request)
	for _, id := range []string{"FinComVoucherByMaster", "FinComVoucherByNumber", "FinComLedgerByName", "FinComLedgerChanges"} {
		if n := f.n(id); n != 0 {
			t.Errorf("%s asked %d times for master lines", id, n)
		}
	}
}

// a master form's first line alone (Tally wrote no second): with a GUID it is an alteration once it has waited; without
// one (nothing saved) it is dropped, as a ledger's
func TestMasterHookPreAlone(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	liveAppend(t, p, mhLine("stockitem_accept_pre", b220CoGUID+"-00000a10", "2576", "50", "Item X", "Primary"), mhLine("unit_accept_pre", "", "0", "0", "Box", ""))
	liveReadOnce()
	old := nowFn
	nowFn = func() time.Time { return old().Add(time.Minute) }
	defer func() { nowFn = old }()
	readAndUploadAll(t)
	sent := c.recSent()
	if len(sent) != 1 || str(sent[0]["event"]) != "master_altered" || str(sent[0]["master_type"]) != "Stock Item" || str(sent[0]["name"]) != "Item X" {
		t.Fatalf("sent: %v", sent)
	}
}

// the Ledger form and vouchers are unchanged beside them
func TestMasterHookLedgerUnchanged(t *testing.T) {
	rec, _, _ := liveBridge(t, "")
	p := liveFilePath(rec, "")
	liveAppend(t, p,
		lLine("ledger_accept_pre", "l-1", "55", "300", "A Ledger", "Sundry Creditors"),
		lLine("ledger_accept_post", "l-1", "55", "301", "A Ledger", "Sundry Creditors"),
		mhLine("payhead_accept_pre", "p-1", "56", "300", "Basic", "Indirect Expenses"),
		mhLine("payhead_accept_post", "p-1", "56", "302", "Basic", "Indirect Expenses"))
	liveReadOnce()
	q := liveQueue()
	if got := strings.Join(eventsOf(q), ","); got != "ledger_altered,master_altered" {
		t.Fatalf("events: %s", got)
	}
	if q[1].isLedger() || !q[1].isMaster() || q[1].masterType != "Pay Head" || q[1].needsBody() {
		t.Fatalf("the pay head: %+v", q[1])
	}
}

// the add-on: one block per master form, the Ledger form's three-line shape, the Form Accept unconditional
func TestMasterHookAddon(t *testing.T) {
	tdl := readText(filepath.Join("addon", liveAddonName))
	for _, k := range mhForms() {
		block := "[#Form: " + k.form + "]\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"" + k.ev + "_accept_pre\"\n" +
			"    On : Form Accept : Yes          : Form Accept\n" +
			"    On : Form Accept : @@FCRIsLive : Call : FCRLiveLog : \"" + k.ev + "_accept_post\"\n"
		if !strings.Contains(strings.ReplaceAll(tdl, "\r\n", "\n"), block) {
			t.Errorf("the live add-on lacks the %s hook:\n%s", k.form, block)
		}
	}
	// no form the probes did not prove (a form name Tally does not know makes Tally ignore the whole add-on, with a warning
	// screen)
	for _, m := range regexp.MustCompile(`(?m)^\[#Form: ([^\]]+)\]`).FindAllStringSubmatch(tdl, -1) {
		ok := m[1] == "Voucher" || m[1] == "Ledger"
		for _, k := range mhForms() {
			ok = ok || m[1] == k.form
		}
		if !ok {
			t.Errorf("the add-on hooks a form not proven on a real Tally: %s", m[1])
		}
	}
}

// the master forms the add-on hooks (those proven on a real Tally: masterhook.go)
func mhForms() []liveMasterForm { return liveMasterHooked }

// open question 1 (the coordinator, 07-Oct-2026): a delete line (Before / After Delete Object) names no master type, so a
// Stock Item's or Godown's delete went as ledger_deleted. The bridge now remembers the type of every master its add-on's
// form lines named (by GUID, kept on disk) and sends that master's delete as master_deleted with its type; a delete of a
// master it never saw stays ledger_deleted (FinCom's cloud applies a ledger delete by the ledger's GUID only)
func TestMasterHookDeleteKnownType(t *testing.T) {
	rec, f, c := liveBridge(t, "")
	p := liveFilePath(rec, "")
	gi, gg, gl := b220CoGUID+"-00000a20", b220CoGUID+"-00000a21", b220CoGUID+"-00000a22"
	gp := b220CoGUID + "-00000a23" // review M1 of 2.4.0 part 2: a Pay Head (a ledger in FinCom)
	liveAppend(t, p,
		mhLine("stockitem_accept_pre", gi, "2592", "60", "Cement", "Primary"),
		mhLine("stockitem_accept_post", gi, "2592", "61", "Cement", "Primary"),
		mhLine("godown_accept_pre", gg, "2593", "62", "Store", "Primary"),
		mhLine("godown_accept_post", gg, "2593", "63", "Store", "Primary"),
		mhLine("payhead_accept_pre", gp, "2595", "65", "Basic Pay", "Indirect Expenses"),
		mhLine("payhead_accept_post", gp, "2595", "66", "Basic Pay", "Indirect Expenses"))
	readAndUploadAll(t)
	// a restart: the types are kept on disk
	liveResetState()
	liveAppend(t, p,
		mhLine("before_delete", gi, "2592", "61", "Cement", "Primary"),
		mhLine("after_delete", gi, "2592", "61", "Cement", "Primary"),
		mhLine("after_delete", gg, "2593", "63", "Store", "Primary"),
		mhLine("after_delete", gl, "2594", "64", "Cement", "Sundry Creditors"),
		mhLine("after_delete", gp, "2595", "66", "Basic Pay", "Indirect Expenses"))
	readAndUploadAll(t)
	sent := c.recSent()
	var got []string
	for _, l := range sent[3:] {
		got = append(got, str(l["event"])+"/"+str(l["master_type"])+"/"+str(l["name"])+"/"+str(l["object_guid"]))
	}
	// a Pay Head's delete goes on the ledger path (ledger_deleted, applied by FinCom to the ledger holding its GUID, as
	// before the hook), never as master_deleted: FinCom's ledger is marked deleted
	want := "master_deleted/Stock Item/Cement/" + gi + ",master_deleted/Godown/Store/" + gg + ",ledger_deleted//Cement/" + gl + ",ledger_deleted//Basic Pay/" + gp
	if strings.Join(got, ",") != want {
		t.Fatalf("deletes sent:\n%v\nwant\n%s", got, want)
	}
	if n := f.n("FinComLedgerByName") + f.n("FinComLedgerChanges"); n != 0 {
		t.Fatalf("a master's delete asked Tally %d times", n)
	}
}

// --- review L2 of 2.4.0 part 2 (the rule of next-outbox's M1): a master line FinCom answers 'failed' (a cloud without
// migration 66: "FinCom does not keep master lines yet") is not marked sent; it goes again after the wait and is kept
// once 66 is there; the voucher beside it in the same group is marked sent at once
func TestMasterHookFailedNotMarkedSent(t *testing.T) {
	rec, _, c := liveBridge(t, "")
	has66 := false
	sends := map[string]int{}
	c.mu.Lock()
	c.recReply = func(b M) (int, M) {
		res := []any{}
		for _, x := range arr(b["lines"]) {
			l := obj(x)
			id, ev := str(l["line_id"]), str(l["event"])
			sends[ev]++
			if strings.HasPrefix(ev, "master_") && !has66 {
				res = append(res, M{"line_id": id, "state": "failed", "why": "FinCom does not keep master lines yet (migration 66)"})
				continue
			}
			res = append(res, M{"line_id": id, "state": map[bool]string{true: "kept", false: "applied"}[strings.HasPrefix(ev, "master_")], "why": nil})
		}
		return 200, M{"ok": true, "results": res}
	}
	c.mu.Unlock()
	p := liveFilePath(rec, "")
	g := b220CoGUID + "-00000a30"
	liveAppend(t, p, mhLine("godown_accept_pre", g, "2600", "70", "Yard", "Primary"), mhLine("godown_accept_post", g, "2600", "71", "Yard", "Primary"))
	// FinCom's own import coming back (its FinCom id): never asked of Tally, so it goes at once
	gv := b220CoGUID + "-000000d0"
	liveAppend(t, p, vchLine("import_object", gv, "208", "308", "Bill | TDSDesk:fk0"), vchLine("after_import_object", gv, "208", "308", "Bill | TDSDesk:fk0"))
	readAndUploadAll(t)
	if q := liveQueue(); len(q) != 1 || q[0].event != "master_altered" {
		t.Fatalf("waiting after FinCom answered the master line failed: %+v", q)
	}
	if sends["master_altered"] != 1 || sends["imported"] != 1 {
		t.Fatalf("first send: %v", sends)
	}
	has66 = true
	uploadAll(t)
	if sends["master_altered"] != 1 {
		t.Fatal("the failed master line went again before its wait")
	}
	laterBy(t, 2*time.Minute)
	uploadAll(t)
	if len(liveQueue()) != 0 || sends["master_altered"] != 2 || sends["imported"] != 1 {
		t.Fatalf("after the wait: waiting %d, sends %v (want the master line twice, the entry once)", len(liveQueue()), sends)
	}
}
