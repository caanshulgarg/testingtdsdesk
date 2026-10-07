package main

// Next (branch next-masterhook; the owner's item c): the add-on hooks the Pay Head, Stock Item, Unit, Godown and Employee
// forms as it hooks the Ledger form (On Form Accept: a line before Tally's own save and one after it). The bridge maps
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
