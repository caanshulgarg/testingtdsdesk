// FinCom Bridge 2.4.5, ROUND 104 (g4 of the real-Tally gate 39647340380): the undated list of the entries above an
// AlterID (TDSDeskKeepList exactly as keepListAboveRequest builds it) makes Tally look at EVERY voucher of the company,
// whatever the AlterID asked: on a company of about 30,000 vouchers it kept Tally busy 1.9-5.1 s and Tally's window did
// not answer for up to 4.8 s, on all five releases (3.0, 4.1, 5.1, 6.2, 7.1). The bridge stops waiting at 2 s, but
// Tally carries on working. So, in the bridge's own automatic work (the recorder's source B, the nightly self-check and
// the bank-date route, by day and by night), the list is sent only for a company small enough for Tally to answer it
// well inside 2 s, and never again for a company once Tally's window did not answer for 2 s while it listed:
//
//   - small enough: Tally's voucher change counter (ALTVCHID, the light check's FinComCompany answer, nothing asked
//     here) at most KeepListAutoMaxVch (5,000). ALTVCHID is never below the number of the company's vouchers (each
//     voucher keeps its own AlterID, at most the counter), so the guard errs on the safe side. Measured: about 0.17 ms a
//     voucher at worst (5,144 ms for 30,009 vouchers, TallyPrime 4.1); 5,000 vouchers is about 0.9 s, under half the
//     2-second rule. A setting may lower it, never raise it;
//   - a window hold of 2 s or more while the list was at Tally (the window probe of ROUND 103, daypull.go): the list is
//     never sent again for that company by the bridge's own work (kept in sync\keeplist-auto.json, across restarts);
//   - each time it is not sent: one quiet log line for the company (once a run); each route keeps its own fallback (the
//     add-on's lines and the gap check, the nightly check recorded "not checked" with its words, the bank-date alert
//     "upload the Day Book from ..."), all of which end in the Day Book upload.
//
// The person's own tools keep the list (the tray's read test, the measuring tool: started by the person, one request,
// the 2 s stop). No request is added or changed here: the allow-list and its hash are as they were.
package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// the most vouchers (by Tally's voucher change counter) for which the bridge's own work sends the undated list; the tests
// of the stand, whose change counters are NWS144's numbers and not its size, raise it (keepAutoMaxSet)
var keepAutoMaxVch int64 = 5000

func keepAutoMax() int64 {
	m := int64(keepNum("KeepListAutoMaxVch", int(keepAutoMaxVch)))
	if m > keepAutoMaxVch {
		m = keepAutoMaxVch // a setting may lower it, never raise it
	}
	return m
}

var keepAuto struct {
	mu   sync.Mutex
	dir  string
	off  M               // company key|guid -> {why, at}
	said map[string]bool // the quiet line, once a run per company and reason
}

func keepAutoFile() string { return sp("keeplist-auto.json") }

func keepAutoKey(company, guid string) string {
	return companyKey(company) + "|" + strings.ToLower(strings.TrimSpace(guid))
}

// under keepAuto.mu
func keepAutoFresh() {
	if d := syncDir(); keepAuto.dir != d || keepAuto.off == nil {
		keepAuto.dir, keepAuto.off, keepAuto.said = d, M{}, map[string]bool{}
		for k, v := range readObjFile(keepAutoFile()) {
			if o := obj(v); o != nil {
				keepAuto.off[k] = o
			}
		}
	}
}

// why the bridge's own work does not send the undated list for this company ("" : it may). Nothing is asked of Tally
func keepAutoBlocked(company, guid string) string {
	keepAuto.mu.Lock()
	keepAutoFresh()
	o := obj(keepAuto.off[keepAutoKey(company, guid)])
	keepAuto.mu.Unlock()
	if o != nil {
		return "Tally's window did not answer for 2 s or more while it listed this company's changed entries (" + str(o["at"]) + "); the list is not asked again"
	}
	cur, _ := latestNumbers(company)
	if cur == nil {
		return "" // the callers ask nothing without the counters
	}
	v, max := toI64(cur["altvchid"]), keepAutoMax()
	if v <= 0 {
		return "Tally gave no voucher counter for the company, so its size is not known"
	}
	if v > max {
		return fmt.Sprintf("the company has up to %d vouchers (Tally's voucher counter), more than %d: Tally would take longer than 2 s to list its changed entries", v, max)
	}
	return ""
}

// the one quiet line when the list is not sent (once a run per company, route and kind of reason: the counter moving on
// does not say it again)
func keepAutoSay(route, company, guid, why string) {
	k := route + "|" + keepAutoKey(company, guid) + "|" + fmt.Sprint(strings.HasPrefix(why, "Tally's window"))
	keepAuto.mu.Lock()
	keepAutoFresh()
	said := keepAuto.said[k]
	keepAuto.said[k] = true
	keepAuto.mu.Unlock()
	if !said {
		writeLog(route + " for " + company + ": Tally's list of changed entries is not asked (" + why + "); nothing was sent to Tally")
	}
}

// after the list went to Tally: a window hold of 2 s or more turns the list off for this company for good
func keepAutoAfter(route, company, guid string, holdMs int) {
	if holdMs < 2000 {
		return
	}
	k := keepAutoKey(company, guid)
	keepAuto.mu.Lock()
	keepAutoFresh()
	keepAuto.off[k] = M{"company": company, "why": fmt.Sprintf("window %d ms (%s)", holdMs, route), "at": nowS()}
	text := jsonText(keepAuto.off)
	keepAuto.mu.Unlock()
	if err := saveFile(keepAutoFile(), text); err != nil {
		writeLog("Tally's list of changed entries: " + keepAutoFile() + " could not be written: " + err.Error())
	}
	writeLog(fmt.Sprintf("%s for %s: Tally's window did not answer for %.1f s while it listed the changed entries; the bridge does not ask that list for this company again (the add-on's lines and the Day Book upload cover it)", route, company, float64(holdMs)/1000))
}

// the window watched while the list is at Tally (from its send): the hold in ms (0 when nothing reached Tally)
func keepAutoWatch() func(took float64) int {
	held := windowHoldFn()
	t0 := time.Now()
	return func(took float64) int {
		if took <= 0 {
			_ = held(t0)
			return 0 // nothing reached Tally
		}
		return held(time.Now().Add(-time.Duration(took * float64(time.Second))))
	}
}
