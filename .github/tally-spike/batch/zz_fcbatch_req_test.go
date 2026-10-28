package main

// HARNESS ONLY (tally-versions mode batch, bridge 2.4.9 phase 1, MEASURE ONLY): copied into bridge-go by the build job
// of tally-versions.yml, run once, deleted; never committed to bridge-go. It writes the candidate batch requests from the
// ref's OWN pieces (formCollection / fcCollection, the FETCH names and kept lists of FinComVoucherObject), so the forms
// measured are exactly what a 2.4.9 bridge built from that ref would send:
//   dayheads.xml   FinComDayHeads (dayHeadsRequest: one day's GUID, MASTERID, ALTERID, DATE; on the allow-list)
//   object.xml     FinComVoucherObject (voucherObjectRequest: one entry by MasterID; on the allow-list)
//   b1-range.xml   candidate B1: a Voucher collection of ONE day (the FinComDayHeads date form, yyyymmdd TYPE="Date"),
//                  FETCH = the fields FinComVoucherObject keeps today (named), filter $MasterID >= a AND $MasterID <= b
//   b2-range.xml   candidate B2: the same, FETCH = the same top-level fields and every kept list whole ("LIST.*")
//   b1-list.xml    candidate B3: B1 with the filter $MasterID = m1 OR $MasterID = m2 ... (@@MIDS@@ filled by the harness)
//   c0-range.xml   control C0: B1 with NO date (the whole company's vouchers looked at): expected over 2 s on a big company
// FC_BATCH_OUT names the folder. Placeholders: @@CO@@ (company), 20991231 (the day), 111111 / 222222 (a / b), @@MIDS@@.

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const fcBatchID = "FinComVoucherBatch"

// the payroll lists FinComVoucherObject's strip reads (pay heads under each employee: fastStrip writes them as ledger lines)
var fcBatchPayroll = []string{"CATEGORYENTRY.CATEGORY", "CATEGORYENTRY.EMPLOYEEENTRIES.EMPLOYEENAME", "CATEGORYENTRY.EMPLOYEEENTRIES.AMOUNT",
	"CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.PAYHEADNAME", "CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.ISDEEMEDPOSITIVE",
	"CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.AMOUNT"}

func fcBatchExact() []string {
	var all []string
	all = append(all, liveFetchFields()...)
	all = append(all, liveFetchWild()...)
	all = append(all, liveKeepGST242...)
	all = append(all, liveKeepTDS243...)
	all = append(all, liveKeepPay244...)
	all = append(all, fcBatchPayroll...)
	seen := map[string]bool{}
	var o []string
	for _, f := range all {
		if f = strings.TrimSpace(f); f != "" && !seen[f] {
			seen[f] = true
			o = append(o, f)
		}
	}
	return o
}

// the top-level names, then every list a kept field sits in, whole ("LIST.*": every field directly in that list)
func fcBatchWide() []string {
	seen := map[string]bool{}
	var top, lists []string
	for _, f := range fcBatchExact() {
		whole := strings.HasSuffix(f, ".*")
		parts := strings.Split(strings.TrimSuffix(f, ".*"), ".")
		if len(parts) == 1 && !whole {
			if !seen[f] {
				seen[f] = true
				top = append(top, f)
			}
			continue
		}
		n := len(parts) - 1 // the lists above a named field
		if whole {
			n = len(parts) // a list named whole is one too
		}
		for i := 1; i <= n; i++ {
			if w := strings.Join(parts[:i], ".") + ".*"; !seen[w] {
				seen[w] = true
				lists = append(lists, w)
			}
		}
	}
	sort.Strings(lists)
	return append(top, lists...)
}

func TestFCBatchReq(t *testing.T) {
	out := os.Getenv("FC_BATCH_OUT")
	if out == "" {
		t.Skip("FC_BATCH_OUT not set")
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		t.Fatal(err)
	}
	exact := strings.Join(fcBatchExact(), ", ")
	wide := strings.Join(fcBatchWide(), ", ")
	rng := "$MasterID >= 111111 AND $MasterID <= 222222"
	w := map[string]string{
		"dayheads.xml": dayHeadsRequest("@@CO@@", "20991231"),
		"object.xml":   voucherObjectRequest("@@CO@@", "99999"),
		"b1-range.xml": formCollection(fcBatchID, "@@CO@@", formPlainT, "20991231", "20991231", exact, rng),
		"b2-range.xml": formCollection(fcBatchID, "@@CO@@", formPlainT, "20991231", "20991231", wide, rng),
		"b1-list.xml":  formCollection(fcBatchID, "@@CO@@", formPlainT, "20991231", "20991231", exact, "@@MIDS@@"),
		"c0-range.xml": fcCollection(fcBatchID, "@@CO@@", "", "Voucher", exact, rng),
		"fetch-exact.txt": strings.Join(fcBatchExact(), "\n") + "\n",
		"fetch-wide.txt":  strings.Join(fcBatchWide(), "\n") + "\n",
	}
	for n, x := range w {
		if x == "" {
			t.Fatalf("%s: empty", n)
		}
		if err := os.WriteFile(filepath.Join(out, n), []byte(x), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
