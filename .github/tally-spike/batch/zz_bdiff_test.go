package main

// HARNESS ONLY (tally-versions mode bdiff, bridge 2.4.9's gate): copied into the ref's bridge-go by the Windows job, run
// once, deleted; never committed to bridge-go. Every entry of every FinComVoucherBatch answer bdiffv.ps1 kept goes through
// the ref's OWN batch path (fetchVoucherBatch's per-entry steps: payrollLearn / payrollEntry, batchConvert, fastStripWhy)
// and is compared with FinComVoucherObject's answer through FinComVoucherObject's strip (fastStripWhy), every kept field
// with its place and value (a REMOTEID equal to the entry's GUID aside). An entry the batch path leaves for
// FinComVoucherObject (a payroll entry, one the strip would hold) is counted as such: FinCom then gets
// FinComVoucherObject's answer itself. Writes FC_BATCH_DIFF_OUT: one PASS / FAIL line (d1) and the details.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestFCBDiff(t *testing.T) {
	dir, outF := os.Getenv("FC_BATCH_DIFF_DIR"), os.Getenv("FC_BATCH_DIFF_OUT")
	if dir == "" || outF == "" {
		t.Skip("not set")
	}
	read := func(n string) string {
		b, err := os.ReadFile(filepath.Join(dir, "raw", n))
		if err != nil {
			return ""
		}
		return textFromBytes(b)
	}
	var plan []struct {
		Form string   `json:"form"`
		File string   `json:"file"`
		Mids []string `json:"mids"`
	}
	const name = "d1 every entry of the groups as FinComVoucherObject gives it, through the bridge's own batch path"
	if err := json.Unmarshal([]byte(read("diff-plan.json")), &plan); err != nil || len(plan) == 0 {
		os.WriteFile(outF, []byte(fmt.Sprintf("HARNESS %s: no plan (%v)\n", name, err)), 0o644)
		return
	}
	reRemote := regexp.MustCompile(` REMOTEID="[^"]*"`)
	same, differ, left, missing := 0, 0, 0, 0
	types := map[string]int{}
	var det []string
	for _, w := range plan {
		raw := reCmpInfo.ReplaceAllString(read(w.File), "")
		got := map[string]string{}
		for _, b := range reVchBlock.FindAllString(raw, -1) {
			c := cleanXML(b)
			got[strings.TrimLeft(tagNum(c, "MASTERID"), "0")] = c
		}
		for _, mid := range w.Mids {
			c, ok := got[mid]
			if !ok {
				missing++
				det = append(det, fmt.Sprintf("%s %s: MasterID %s asked, not answered", w.Form, w.File, mid))
				continue
			}
			typ := tagValue(c, "VOUCHERTYPENAME")
			payrollLearn("BDIFF CO", c)
			if payrollEntry("BDIFF CO", typ) {
				left++
				det = append(det, fmt.Sprintf("%s %s: MasterID %s (%s) left for FinComVoucherObject: a payroll entry", w.Form, w.File, mid, typ))
				continue
			}
			v, why := fastStripWhy(batchConvert(c))
			if why != "" || v == "" {
				left++
				det = append(det, fmt.Sprintf("%s %s: MasterID %s (%s) left for FinComVoucherObject: %s", w.Form, w.File, mid, typ, why))
				continue
			}
			var want string
			for _, ov := range reVchBlock.FindAllString(read("obj-"+mid+".xml"), -1) {
				want, _ = fastStripWhy(cleanXML(ov))
			}
			if want == "" {
				missing++
				det = append(det, fmt.Sprintf("MasterID %s: no FinComVoucherObject answer kept", mid))
				continue
			}
			types[typ]++
			if rg := regexp.MustCompile(`REMOTEID="([^"]*)"`).FindStringSubmatch(v); rg != nil && rg[1] != tagValue(v, "GUID") {
				differ++
				det = append(det, fmt.Sprintf("%s MasterID %s: REMOTEID %s is not the GUID", w.Form, mid, rg[1]))
				continue
			}
			if reRemote.ReplaceAllString(v, "") == reRemote.ReplaceAllString(want, "") {
				same++
				continue
			}
			differ++
			fb, fo := fcFlat(reRemote.ReplaceAllString(v, "")), fcFlat(reRemote.ReplaceAllString(want, ""))
			det = append(det, fmt.Sprintf("%s %s: MasterID %s (%s) differs: only one-by-one [%s] only batch [%s]", w.Form, w.File, mid, typ, fcCut(fcMinus(fo, fb), 12), fcCut(fcMinus(fb, fo), 12)))
		}
	}
	var ts []string
	for k, n := range types {
		ts = append(ts, fmt.Sprintf("%s %d", k, n))
	}
	sort.Strings(ts)
	st := "PASS"
	if differ > 0 || missing > 0 || same == 0 {
		st = "FAIL"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s %s: %d entries compared over %d group answers: %d identical (%s), %d differ, %d missing, %d left for FinComVoucherObject (payroll, or held by the strip: FinCom gets FinComVoucherObject's answer)\n",
		st, name, same+differ, len(plan), same, strings.Join(ts, ", "), differ, missing, left)
	for _, d := range det {
		b.WriteString("DETAIL " + d + "\n")
	}
	if err := os.WriteFile(outF, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}
