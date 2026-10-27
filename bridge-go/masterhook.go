// Next (branch next-masterhook; the owner's item c): the add-on (addon/FinComRecorder.tdl) was to hook the master forms
// beside the Ledger form: Pay Head, Stock Item and Godown. NOT SHIPPED in 2.4.0 (liveMasterHooked below: none; run
// 37840646524). As built on that branch, each with the Ledger form's three lines (a line before
// Tally's own save, Tally's Form Accept, a line after it). Each line is "<kind>_accept_pre" / "<kind>_accept_post"
// (payhead, stockitem, godown) with the master's name, GUID, MasterID, AlterID and parent, as the Ledger form's lines.
// The bridge still pairs unit_* / employee_* lines should an add-on write them, but this add-on does not, and FinCom's
// cloud refuses them (tally-ingest: 'failed', "unknown master type"; review L3 of 2.4.0 part 2).
//
// The bridge pairs them as it pairs a ledger's and sends master_created (Tally's MasterID 0 before the save: a new
// master) or master_altered, HEADS ONLY: master_type, name, parent, object_guid, master_id, alter_id. Nothing is ever asked
// of Tally for a master line (no body, no ledger request, no new request of any kind). A Pay Head is a ledger in Tally, but
// its form's lines go as a master's too (heads only for now; the ledger list keeps its ledger as before).
//
// Deletes: the add-on's System Events (Before / After Delete Object) fire for every object and write no master type: a
// Stock Item or Godown the hooked forms named is sent as master_deleted with its type (below); any other, a Pay Head
// included (a ledger in FinCom: review M1 of 2.4.0 part 2), as ledger_deleted, as in 2.3.2: FinCom applies it to the
// ledger holding the line's GUID.
package main

import "strings"

type liveMasterForm struct{ ev, form string }

// every master form the bridge maps (the event's prefix and the master's type)
var liveMasterForms = []liveMasterForm{{"payhead", "Pay Head"}, {"stockitem", "Stock Item"}, {"unit", "Unit"}, {"godown", "Godown"}, {"employee", "Employee"}}

// the master forms the add-on hooks: those proven on ALL FIVE TallyPrime releases (3.0, 4.1, 5.1, 6.2, 7.1; the owner's
// rule). TestMasterHookAddon holds the add-on to this list. release-240: none. The real-Tally run 37840646524 showed Pay
// Head and Stock Item failing on every release and Godown on 3.0 to 6.2 (7.1 only had proven them: runs 37563133547,
// 37580509870), so the shipped add-on hooks no master form (TestMasterHookNoneShippedIn240). The pairing below stays,
// inert: no shipped add-on writes a master form's line, so the bridge sends no master_created / master_altered, and a
// delete goes as ledger_deleted, as before 2.4.0. Migration 66 stays (add-only, unused)
var liveMasterHooked = []liveMasterForm{}

func init() {
	for _, k := range liveMasterForms {
		livePair[k.ev+"_accept_pre"] = k.ev + "_accept_post"
	}
}

// the master's type a master form's event names ("stockitem_accept_post" -> "Stock Item")
func liveMasterType(ev string) string {
	for _, k := range liveMasterForms {
		if ev == k.ev+"_accept_pre" || ev == k.ev+"_accept_post" {
			return k.form
		}
	}
	return ""
}

func liveMasterPre(ev string) bool {
	return strings.HasSuffix(ev, "_accept_pre") && liveMasterType(ev) != ""
}

func (c *change) isMaster() bool { return strings.HasPrefix(c.event, "master_") }

// the event of a master form's line or pair: a new master (Tally's MasterID 0 before its save) or an altered one
func liveMasterEvent(fresh bool) string {
	if fresh {
		return "master_created"
	}
	return "master_altered"
}

// Open question 1 (the coordinator, 07-Oct-2026): Tally's delete events (Before / After Delete Object) write no master
// type, so a Stock Item's or a Godown's delete went as ledger_deleted (FinCom's cloud applies a ledger delete only to the
// ledger holding the line's GUID, so no ledger was ever marked deleted by one; the line was held as an unknown ledger).
// The bridge remembers the type of every master its add-on's form lines named, by GUID (sync\recorder-master-types.json,
// kept across restarts, at most 20,000), and sends such a master's delete as master_deleted with that type, except a Pay
// Head's (a ledger in FinCom, review M1 of 2.4.0 part 2): ledger_deleted, so FinCom's ledger is marked deleted by its
// GUID. A master never seen on a hooked form (a ledger, or one older than the hook) stays ledger_deleted, as before.
var liveMT struct {
	dir string
	m   map[string]string
}

func liveMasterTypesFile() string { return sp("recorder-master-types.json") }

// under live.mu: the types kept, loaded once per sync folder
func liveMTLoad() map[string]string {
	if d := syncDir(); liveMT.m == nil || liveMT.dir != d {
		liveMT.dir, liveMT.m = d, map[string]string{}
		for k, v := range obj(readObjFile(liveMasterTypesFile())["types"]) {
			if t := str(v); t != "" {
				liveMT.m[k] = t
			}
		}
	}
	return liveMT.m
}

func liveMTKey(guid string) string {
	g := strings.ToLower(strings.TrimSpace(guid))
	if g == "" || livePlaceholder(g) {
		return ""
	}
	return g
}

// under live.mu: a master form's line names its master's type
func liveMTNote(guid, typ string) {
	k := liveMTKey(guid)
	if k == "" || typ == "" {
		return
	}
	m := liveMTLoad()
	if m[k] == typ {
		return
	}
	if len(m) >= 20000 {
		return
	}
	m[k] = typ
	ts := M{}
	for g, t := range m {
		ts[g] = t
	}
	if err := saveFile(liveMasterTypesFile(), jsonText(M{"types": ts})); err != nil {
		writeLog("Recorder: " + liveMasterTypesFile() + " could not be written: " + err.Error())
	}
}

// under live.mu: the type of a master seen on a hooked form ("" when never seen)
func liveMTOf(guid string) string {
	k := liveMTKey(guid)
	if k == "" {
		return ""
	}
	return liveMTLoad()[k]
}
