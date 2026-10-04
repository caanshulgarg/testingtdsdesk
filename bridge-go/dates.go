// Round 18 (2.1.9, 04-Oct-2026): the dates of a request to Tally. On the owner's TallyPrime (NWS144) a request whose
// SVFROMDATE/SVTODATE are plain yyyymmdd was answered for Tally's current period or current date, not for the range.
// Every request that carries a period renders it here, with dateVars; in normal running the form is always the one
// used so far (formPlain), so no request changes. The four forms are tried only by the person-started "Test reading
// from Tally" (readtest.go), which logs which form answered an anchor day with exactly that day's entries and changes
// nothing (the owner's rule of 04-Oct-2026: reading is prospective only; the form is not switched by the bridge).
package main

import (
	"strings"
)

const (
	formPlain  = "yyyymmdd"
	formDMY    = "d-MMM-yyyy"
	formPlainT = "yyyymmdd TYPE=Date"
	formDMYT   = "d-MMM-yyyy TYPE=Date"
)

// the forms the read test tries, in order
var dateForms = []string{formPlain, formDMY, formPlainT, formDMYT}

// SVFROMDATE and SVTODATE for a period (yyyymmdd in) in one form
func dateVars(form, from, to string) string {
	attr := ""
	if strings.HasSuffix(form, "TYPE=Date") {
		attr = ` TYPE="Date"`
	}
	if strings.HasPrefix(form, formDMY) {
		from, to = tallyDMY(from), tallyDMY(to)
	}
	return "<SVFROMDATE" + attr + ">" + from + "</SVFROMDATE><SVTODATE" + attr + ">" + to + "</SVTODATE>"
}

// the period of every request the bridge sends in normal running: as before, yyyymmdd
func periodVars(from, to string) string { return dateVars(formPlain, from, to) }

// the first date a request carries, as yyyymmdd when it is one (for the log)
func requestFrom(x string) (string, string) {
	return group(`<SVFROMDATE[^>]*>(\d{8})</SVFROMDATE>`, x, 1), group(`<SVTODATE[^>]*>(\d{8})</SVTODATE>`, x, 1)
}
