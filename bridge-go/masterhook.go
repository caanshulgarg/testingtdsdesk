// Next (branch next-masterhook; the owner's item c): the add-on (addon/FinComRecorder.tdl) hooks the master forms beside
// the Ledger form: Pay Head, Stock Item, Unit, Godown and Employee, each with the Ledger form's three lines (a line before
// Tally's own save, Tally's Form Accept, a line after it). Each line is "<kind>_accept_pre" / "<kind>_accept_post"
// (payhead, stockitem, unit, godown, employee) with the master's name, GUID, MasterID, AlterID and parent, as the Ledger
// form's lines.
//
// The bridge pairs them as it pairs a ledger's and sends master_created (Tally's MasterID 0 before the save: a new
// master) or master_altered, HEADS ONLY: master_type, name, parent, object_guid, master_id, alter_id. Nothing is ever asked
// of Tally for a master line (no body, no ledger request, no new request of any kind). A Pay Head is a ledger in Tally, but
// its form's lines go as a master's too (heads only for now; the ledger list keeps its ledger as before).
//
// Deletes: the add-on's System Events (Before / After Delete Object) fire for every object and write no master type, so a
// master's delete stays what it was in 2.3.2 (recorder_live.go liveSingle).
package main

import "strings"

type liveMasterForm struct{ ev, form string }

// every master form the bridge maps (the event's prefix and the master's type)
var liveMasterForms = []liveMasterForm{{"payhead", "Pay Head"}, {"stockitem", "Stock Item"}, {"unit", "Unit"}, {"godown", "Godown"}, {"employee", "Employee"}}

// the master forms the add-on hooks: those proven on a real TallyPrime (a form name Tally does not know makes it ignore
// the whole add-on, with a warning screen). TestMasterHookAddon holds the add-on to this list
var liveMasterHooked = liveMasterForms[:4] // Pay Head, Stock Item, Unit, Godown; not Employee (no form name found)

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
