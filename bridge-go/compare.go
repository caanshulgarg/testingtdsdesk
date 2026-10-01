// FinComBridge.exe compare: in test mode, this bridge's copy of each company against bridge 1.15.0's, day by day. Each
// entry is compared by its Tally ID (GUID) and change number (ALTERID), and the ledgers by name and group. The answer
// is printed and kept in compare-report.txt in the bridge's folder.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func dayIndex(dir string) map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, f := range dayFiles(dir, "") {
		d := strings.TrimSuffix(filepath.Base(f), ".xml")
		m := map[string]string{}
		for _, ln := range strings.Split(indexText(readText(f)), "\n") {
			p := strings.Split(ln, "\t")
			if p[0] != "" && len(p) > 1 {
				m[p[0]] = p[1]
			}
		}
		out[d] = m
	}
	return out
}

func compareCopies(args []string) int {
	mine := syncDir()
	old := ""
	if len(args) > 0 {
		old = args[0]
	} else {
		old = filepath.Join(psHome(), "sync")
		pc := newOrdered()
		if pc.UnmarshalText(readText(filepath.Join(psHome(), "tds-bridge.config.json"))) == nil && str(pc.Get("SyncDir")) != "" {
			old = str(pc.Get("SyncDir"))
		}
	}
	var b strings.Builder
	p := func(f string, a ...any) { fmt.Fprintf(&b, f+"\n", a...) }
	p("FinCom Bridge %s: its copy (%s) against bridge 1.15.0's (%s)", BridgeVersion, mine, old)
	if mine == old {
		p("Both are the same folder: nothing to compare (this bridge is not in test mode).")
	}
	worst := 0
	ents, _ := os.ReadDir(old)
	for _, e := range ents {
		if !e.IsDir() || !exists(filepath.Join(old, e.Name(), "keep.json")) {
			continue
		}
		a, g := filepath.Join(old, e.Name()), filepath.Join(mine, e.Name())
		st := readKeepState(a)
		p("")
		p("Company: %s", str(st["company"]))
		if !exists(g) {
			p("  this bridge has no copy of it yet")
			worst = maxI(worst, 1)
			continue
		}
		ga, gb := dayIndex(a), dayIndex(g)
		var days []string
		for d := range ga {
			days = append(days, d)
		}
		for d := range gb {
			if _, ok := ga[d]; !ok {
				days = append(days, d)
			}
		}
		sort.Strings(days)
		same, differ, n := 0, 0, 0
		var bad []string
		for _, d := range days {
			x, y := ga[d], gb[d]
			ok := len(x) == len(y)
			if ok {
				for k, v := range x {
					if y[k] != v {
						ok = false
						break
					}
				}
			}
			n += len(y)
			if ok {
				same++
			} else {
				differ++
				miss, extra, alt := 0, 0, 0
				for k, v := range x {
					if w, has := y[k]; !has {
						miss++
					} else if w != v {
						alt++
					}
				}
				for k := range y {
					if _, has := x[k]; !has {
						extra++
					}
				}
				bad = append(bad, fmt.Sprintf("%s (1.15.0 has %d entries, this bridge %d: %d missing here, %d extra here, %d with another change number)", d, len(x), len(y), miss, extra, alt))
			}
		}
		p("  days: %d the same, %d different; %d entries in this bridge's copy", same, differ, n)
		for i, s := range bad {
			if i >= 30 {
				p("  ... and %d more", len(bad)-30)
				break
			}
			p("  DIFFERENT %s", s)
		}
		la, lb := readObjFile(filepath.Join(a, "ledgers.json")), readObjFile(filepath.Join(g, "ledgers.json"))
		ld := 0
		for k, v := range la {
			w := arr(lb[k])
			x := arr(v)
			if len(w) < 2 || len(x) < 2 || str(w[0]) != str(x[0]) || str(w[1]) != str(x[1]) {
				ld++
			}
		}
		p("  ledgers: %d in 1.15.0's copy, %d here, %d different", len(la), len(lb), ld)
		sa, sb := readKeepState(a), readKeepState(g)
		p("  1.15.0: phase %s, last change number %s, counters %s/%s", str(sa["phase"]), str(sa["last"]), str(sa["cv"]), str(sa["cm"]))
		p("  this:   phase %s, last change number %s, counters %s/%s", str(sb["phase"]), str(sb["last"]), str(sb["cv"]), str(sb["cm"]))
		if differ > 0 || ld > 0 {
			worst = 2
		}
	}
	p("")
	switch worst {
	case 0:
		p("RESULT: the same.")
	case 1:
		p("RESULT: not compared yet (this bridge has not copied every company).")
	default:
		p("RESULT: DIFFERENT. A day can differ for a minute or two while one bridge has read a change and the other not yet; run this again in five minutes. Still different: send compare-report.txt to support.")
	}
	fmt.Print(b.String())
	_ = os.WriteFile(filepath.Join(Home, "compare-report.txt"), []byte(strings.ReplaceAll(b.String(), "\n", "\r\n")), 0o644)
	return worst
}
