package main

import (
	"encoding/json"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The share check (tally-versions mode share: each kind of entry typed on Tally's own screens, TallyPrime 3.0 to 7.1, the
// add-on of this branch loaded): what the bridge does with each case's lines, as livePushDone does it, for the judge
// (tests/run_push240_share.mjs reads both sides with FinCom's parse.js):
//   - trusted (pushTrust, and the party told by pushDeriveParty from the ledger and group lists Tally had): the XML the
//     bridge sends, built from the line (<case>.push.xml)
//   - not trusted: the line is not taken; the fast request confirms it: Tally's answer to FinComVoucherObject for the
//     entry, stripped as the bridge strips it (<case>.object.xml), is what goes
//
// Either way <case>.tally.xml is Tally's own record of the entry (the same answer, stripped): the judge compares what goes
// with it. Inputs: testdata/push240/share/<run>/<release>/ (the run's captures: share-summary.json, share-<case>.lines.txt,
// share-<case>.object.xml, share-ledgers.xml, share-groups.xml); outputs beside them in judge/. PUSH240_SHARE=<dir> reads
// another run's capture folder (its <release>/ folders) instead.
func TestPush240ShareCaptures(t *testing.T) {
	roots := []string{}
	if d := os.Getenv("PUSH240_SHARE"); d != "" {
		roots = append(roots, d)
	} else {
		m, _ := filepath.Glob(filepath.Join("testdata", "push240", "share", "*"))
		roots = append(roots, m...)
	}
	if len(roots) == 0 {
		t.Skip("no share captures")
	}
	reTag := regexp.MustCompile(`(?s)<(LEDGER|GROUP) NAME="([^"]*)"[^>]*>(.*?)</(?:LEDGER|GROUP)>`)
	for _, root := range roots {
		rels, _ := filepath.Glob(filepath.Join(root, "[0-9]*.[0-9]*"))
		for _, rd := range rels {
			rel := filepath.Base(rd)
			var summ []map[string]any
			b, err := os.ReadFile(filepath.Join(rd, "share-summary.json"))
			if err != nil {
				t.Fatalf("%s: %v", rd, err)
			}
			if err := json.Unmarshal([]byte(strings.TrimPrefix(decodeRecorderText(b), "\ufeff")), &summ); err != nil {
				var one map[string]any
				if json.Unmarshal([]byte(strings.TrimPrefix(decodeRecorderText(b), "\ufeff")), &one) != nil {
					t.Fatalf("%s summary: %v", rd, err)
				}
				summ = []map[string]any{one}
			}
			leds, grps := map[string]string{}, map[string]string{}
			for _, f := range []string{"share-ledgers.xml", "share-groups.xml"} {
				x, _ := os.ReadFile(filepath.Join(rd, f))
				for _, m := range reTag.FindAllStringSubmatch(decodeRecorderText(x), -1) {
					n := strings.ToLower(strings.TrimSpace(html.UnescapeString(m[2])))
					p := strings.TrimSpace(html.UnescapeString(tagValue(m[3], "PARENT")))
					if regexp.MustCompile(`^\W*Primary$`).MatchString(p) {
						p = ""
					}
					if m[1] == "LEDGER" {
						leds[n] = p
					} else {
						grps[n] = p
					}
				}
			}
			out := filepath.Join(rd, "judge")
			_ = os.MkdirAll(out, 0o755)
			man := map[string]any{}
			for _, c := range summ {
				cas, _ := c["case"].(string)
				if c["made"] != true {
					man[cas] = map[string]any{"made": false}
					continue
				}
				lb, err := os.ReadFile(filepath.Join(rd, "share-"+cas+".lines.txt"))
				if err != nil {
					t.Fatalf("%s %s: %v", rel, cas, err)
				}
				var ps []string
				var head string
				for _, l := range strings.Split(strings.ReplaceAll(strings.TrimPrefix(decodeRecorderText(lb), "\ufeff"), "\r\n", "\n"), "\n") {
					if !strings.HasPrefix(l, "FCR1|ev=voucher_full|") {
						continue
					}
					p, ok := pushPayload(l)
					if !ok {
						continue
					}
					if strings.HasPrefix(p, pushMagic+"|part=1|") {
						ps, head = nil, l
					}
					ps = append(ps, p)
				}
				r := map[string]any{"made": true, "mid": c["mid"]}
				ev := "created"
				if strings.HasPrefix(cas, "alter-") || cas == "einvoice-save" {
					ev = "altered"
				}
				r["event"] = ev
				hf := func(k string) string {
					if m := regexp.MustCompile(`\|` + k + `=([^|]*)\|`).FindStringSubmatch(head); m != nil {
						return m[1]
					}
					return ""
				}
				why := ""
				var e *pushEntry
				if head == "" {
					why = "no full line"
				} else if e, err = pushParse(ps); err != nil {
					why = "not read: " + err.Error()
				} else if g, w := pushGuidCheck(hf("cguid"), e.s("mid"), ev, hf("guid")); w != "" {
					why = w
				} else if w := pushTrust(e, ev, hf("cguid"), e.s("mid"), hf("guid")); w != "" {
					why = w
				} else if party, w := pushDeriveParty(e, leds, grps); w != "" {
					why = w
				} else if w := pushBankCheck(e, ev, leds, grps); w != "" {
					e.scal["party"] = party
					why = w
				} else {
					e.scal["party"] = party
					x, err := pushEntryXML(e, g, 0)
					if err != nil {
						why = "not built: " + err.Error()
					} else {
						_ = os.WriteFile(filepath.Join(out, cas+".push.xml"), []byte(x), 0o644)
					}
				}
				r["trusted"], r["why"] = why == "", why
				if ob, err := os.ReadFile(filepath.Join(rd, "share-"+cas+".object.xml")); err == nil {
					sx := fastStripVoucher(firstVoucher(decodeRecorderText(ob)))
					r["object"] = sx != ""
					_ = os.WriteFile(filepath.Join(out, cas+".tally.xml"), []byte(sx), 0o644)
				}
				man[cas] = r
			}
			keys := make([]string, 0, len(man))
			for k := range man {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			jb, _ := json.MarshalIndent(man, "", " ")
			_ = os.WriteFile(filepath.Join(out, "manifest.json"), jb, 0o644)
			t.Logf("%s %s: %d cases judged into %s", filepath.Base(root), rel, len(keys), out)
		}
	}
}

// the first VOUCHER element of an answer
func firstVoucher(x string) string {
	i := strings.Index(x, "<VOUCHER ")
	if i < 0 {
		i = strings.Index(x, "<VOUCHER>")
	}
	j := strings.LastIndex(x, "</VOUCHER>")
	if i < 0 || j < i {
		return ""
	}
	return x[i : j+len("</VOUCHER>")]
}
