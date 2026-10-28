package main

// HARNESS ONLY (tally-versions mode batch, bridge 2.4.9 phase 1, MEASURE ONLY): copied into the ref's bridge-go by the
// collect job, run once, deleted; never committed to bridge-go. For every entry the batch requests answered in a diff
// window (batchv.ps1 writes raw\diff-plan.json: the batch answer's file and the MasterIDs asked), the entry as the batch
// answered it and as FinComVoucherObject answered it alone are both put through the bridge's OWN strip (cleanXML, then
// fastStripWhy for FinComVoucherObject's answer, exactly what fetchVouchersByMasterIn does before anything is logged,
// stored or sent; fastStripCollection for the batch answer, the strip the bridge already uses for a Voucher collection's
// answer, FinComVoucherByNumber's), and the kept fields
// compared: every kept leaf with its place (the n-th ledger line, the n-th bill, ...) and its value, and the VOUCHER's
// REMOTEID / VCHTYPE. Field order inside one element is not compared (FinCom's reader does not use it).
//   FC_BATCH_DIFF_DIR  a job's captures\batch folder (raw\ unzipped in it)
//   FC_BATCH_DIFF_OUT  the text written: one line per form and phase, then the first differences in full

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type fcDiffWin struct {
	Phase string   `json:"phase"`
	Form  string   `json:"form"`
	File  string   `json:"file"`
	Mids  []string `json:"mids"`
}

// every kept leaf as "path=value", the n-th element of a list in the path ("ALLLEDGERENTRIES.LIST#2.AMOUNT=-100.00")
func fcFlat(stripped string) []string {
	root := fastTree(stripped)
	if root == nil {
		return nil
	}
	var o []string
	for _, a := range reFastAttr.FindAllStringSubmatch(root.attrs, -1) {
		o = append(o, "@"+a[1]+"="+a[2])
	}
	var walk func(e *fastEl, prefix string)
	walk = func(e *fastEl, prefix string) {
		n := map[string]int{}
		for _, k := range e.kids {
			n[k.name]++
			seg := k.name
			if strings.HasSuffix(k.name, ".LIST") {
				seg = fmt.Sprintf("%s#%d", k.name, n[k.name])
			}
			p := seg
			if prefix != "" {
				p = prefix + "." + seg
			}
			if !k.hasKids {
				if v := strings.TrimSpace(k.text); v != "" { // a field Tally leaves empty counts as absent
					o = append(o, p+"="+v)
				}
				continue
			}
			walk(k, p)
		}
	}
	walk(root, "")
	sort.Strings(o)
	return o
}

// the stripped entries of an answer by MasterID, and the ones held (the strip's reason). hold: FinComVoucherObject's strip
// (fastStripWhy); else the strip the bridge already uses for a Voucher collection's answer (fastStripCollection, which
// keeps ALLLEDGERENTRIES and drops the LEDGERENTRIES a collection adds beside them)
func fcStripAll(raw string, hold bool) (map[string]string, map[string]string) {
	out, held := map[string]string{}, map[string]string{}
	for _, m := range reVchBlock.FindAllString(raw, -1) {
		c := cleanXML(m)
		v, why := fastStrip(c, hold)
		id := tagNum(c, "MASTERID")
		if why != "" || v == "" {
			if why == "" {
				why = "not readable"
			}
			held[id] = why
			continue
		}
		out[tagNum(v, "MASTERID")] = v
	}
	return out, held
}

// the same entry with the order of lines and of fields set aside: each element as its name and its sorted children
func fcCanon(stripped string) string {
	root := fastTree(stripped)
	if root == nil {
		return ""
	}
	var c func(e *fastEl) string
	c = func(e *fastEl) string {
		if !e.hasKids {
			if v := strings.TrimSpace(e.text); v != "" {
				return e.name + "=" + v
			}
			return ""
		}
		var k []string
		for _, q := range e.kids {
			if s := c(q); s != "" {
				k = append(k, s)
			}
		}
		if len(k) == 0 {
			return ""
		}
		sort.Strings(k)
		return e.name + "{" + strings.Join(k, "|") + "}"
	}
	var at []string
	for _, a := range reFastAttr.FindAllStringSubmatch(root.attrs, -1) {
		at = append(at, a[1]+"="+a[2])
	}
	sort.Strings(at)
	return strings.Join(at, " ") + c(root)
}

func fcMinus(a, b []string) []string {
	m := map[string]int{}
	for _, x := range b {
		m[x]++
	}
	var o []string
	for _, x := range a {
		if m[x] > 0 {
			m[x]--
			continue
		}
		o = append(o, x)
	}
	return o
}

func TestFCBatchDiff(t *testing.T) {
	dir, outF := os.Getenv("FC_BATCH_DIFF_DIR"), os.Getenv("FC_BATCH_DIFF_OUT")
	if dir == "" || outF == "" {
		t.Skip("FC_BATCH_DIFF_DIR / FC_BATCH_DIFF_OUT not set")
	}
	read := func(n string) string {
		b, err := os.ReadFile(filepath.Join(dir, "raw", n))
		if err != nil {
			return ""
		}
		return textFromBytes(b)
	}
	var plan []fcDiffWin
	if err := json.Unmarshal([]byte(read("diff-plan.json")), &plan); err != nil {
		os.WriteFile(outF, []byte("HARNESS no diff plan: "+err.Error()+"\n"), 0o644)
		return
	}
	type agg struct{ asked, same, sameUnordered, differ, missing, extra, heldB, heldO, noRef int }
	sum := map[string]*agg{}
	var keys []string
	var detail []string
	pathsDiffer := map[string]map[string]int{}
	objCache := map[string]string{}
	for _, w := range plan {
		k := w.Phase + " " + w.Form
		if sum[k] == nil {
			sum[k] = &agg{}
			keys = append(keys, k)
			pathsDiffer[k] = map[string]int{}
		}
		a := sum[k]
		got, held := fcStripAll(read(w.File), false)
		asked := map[string]bool{}
		for _, mid := range w.Mids {
			asked[mid] = true
			a.asked++
			if why, ok := held[mid]; ok {
				a.heldB++
				detail = append(detail, fmt.Sprintf("%s %s: MasterID %s held by the strip in the batch answer: %s", k, w.File, mid, why))
				continue
			}
			v, ok := got[mid]
			if !ok {
				a.missing++
				detail = append(detail, fmt.Sprintf("%s %s: MasterID %s asked, not in the batch answer", k, w.File, mid))
				continue
			}
			ref, okc := objCache[mid]
			if !okc {
				o, oh := fcStripAll(read("obj-"+mid+".xml"), true)
				ref = o[mid]
				if why, bad := oh[mid]; bad {
					ref = "HELD:" + why
				}
				objCache[mid] = ref
			}
			if ref == "" {
				a.noRef++
				continue
			}
			if strings.HasPrefix(ref, "HELD:") {
				a.heldO++
				detail = append(detail, fmt.Sprintf("%s: MasterID %s held by the strip in FinComVoucherObject's answer (%s)", k, mid, ref))
				continue
			}
			fb, fo := fcFlat(v), fcFlat(ref)
			onlyB, onlyO := fcMinus(fb, fo), fcMinus(fo, fb)
			if len(onlyB) == 0 && len(onlyO) == 0 {
				a.same++
				continue
			}
			if fcCanon(v) == fcCanon(ref) {
				a.sameUnordered++
				continue
			}
			a.differ++
			for _, x := range onlyO {
				p := x[:strings.Index(x, "=")]
				pathsDiffer[k]["only one-by-one: "+fcNoIdx(p)]++
			}
			for _, x := range onlyB {
				p := x[:strings.Index(x, "=")]
				pathsDiffer[k]["only batch: "+fcNoIdx(p)]++
			}
			if len(detail) < 400 {
				detail = append(detail, fmt.Sprintf("%s %s: MasterID %s differs: only one-by-one [%s] only batch [%s]", k, w.File, mid, fcCut(onlyO, 12), fcCut(onlyB, 12)))
			}
		}
		for id := range got {
			if !asked[id] {
				a.extra++
			}
		}
	}
	var b strings.Builder
	for _, k := range keys {
		a := sum[k]
		var pd []string
		for p, n := range pathsDiffer[k] {
			pd = append(pd, fmt.Sprintf("%s x%d", p, n))
		}
		sort.Strings(pd)
		fmt.Fprintf(&b, "DIFF %s: asked %d, kept fields identical %d, identical but lines in another order %d, differ %d, missing %d, extra %d, held by the strip (batch %d, one-by-one %d), no one-by-one answer %d; fields that differ: %s\n",
			k, a.asked, a.same, a.sameUnordered, a.differ, a.missing, a.extra, a.heldB, a.heldO, a.noRef, fcCut(pd, 40))
	}
	for _, d := range detail {
		b.WriteString("DETAIL " + d + "\n")
	}
	if err := os.WriteFile(outF, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fcNoIdx(p string) string {
	var o []string
	for _, s := range strings.Split(p, ".") {
		if i := strings.Index(s, "#"); i > 0 {
			s = s[:i]
		}
		o = append(o, s)
	}
	return strings.Join(o, ".")
}

func fcCut(l []string, n int) string {
	if len(l) > n {
		return strings.Join(l[:n], "; ") + fmt.Sprintf("; ... (%d more)", len(l)-n)
	}
	return strings.Join(l, "; ")
}
