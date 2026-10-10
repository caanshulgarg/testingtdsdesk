package main

// Bridge 2.2.0, round 6 of the reviews: the Import check accepts exactly what FinCom posts (the posting rule, cannotSend,
// is the one source of truth); the real shapes the app builds (tests/fixtures/post-shapes, written by
// tests/gen_post_shapes.js from src/js) go through the real posting path; the refusal names the bridge; the duplicate
// check's party has no quote. Written before the fixes.

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var reShapeObj = regexp.MustCompile(`(?s)<(VOUCHER|LEDGER|GROUP|VOUCHERTYPE)\b.*?</(VOUCHER|LEDGER|GROUP|VOUCHERTYPE)>\n?`)

// the builders' source text as gen_post_shapes.js hashes it: src/js in ORDER.json's order, each builder's declaration
func postShapesSourceHash(t *testing.T, names []string) string {
	t.Helper()
	dir := filepath.Join("..", "src", "js")
	var order []string
	for _, x := range arr(readJSONFile(filepath.Join(dir, "ORDER.json"))) {
		order = append(order, str(x))
	}
	var parts []string
	for _, f := range order {
		parts = append(parts, readText(filepath.Join(dir, f)))
	}
	js := strings.Join(parts, "\n")
	re := regexp.MustCompile(`\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)`)
	ms := re.FindAllStringSubmatchIndex(js, -1)
	var texts []string
	for _, n := range names {
		k := -1
		for i, m := range ms {
			if js[m[2]:m[3]] == n {
				k = i
				break
			}
		}
		if k < 0 {
			t.Fatalf("regenerate post-shapes: the builder %s is no longer in src/js", n)
		}
		end := len(js)
		if k+1 < len(ms) {
			end = ms[k+1][0]
		}
		texts = append(texts, js[ms[k][0]:end])
	}
	h := sha256.Sum256([]byte(strings.Join(texts, "\n")))
	return hex.EncodeToString(h[:])
}

func TestPostShapesCurrent(t *testing.T) {
	man := readObjFile(filepath.Join("..", "tests", "fixtures", "post-shapes", "MANIFEST.json"))
	if man == nil {
		t.Fatal("no tests/fixtures/post-shapes/MANIFEST.json: run node tests/gen_post_shapes.js")
	}
	if got := postShapesSourceHash(t, strs(man["builders"])); got != str(man["sha256"]) {
		t.Fatalf("regenerate post-shapes: the app's posting builders changed since the fixtures were written (node tests/gen_post_shapes.js)")
	}
}

// --- R6-1: each real shape goes through the real posting path (the posting rule, the plan of requests, sendImport,
// invokeTally's checks) and reaches the stand Tally
func TestRealPostingShapesPass(t *testing.T) {
	f := newStandTally(t)
	standBridge(t, f, "")
	man := readObjFile(filepath.Join("..", "tests", "fixtures", "post-shapes", "MANIFEST.json"))
	files := strs(man["files"])
	if len(files) < 8 {
		t.Fatalf("shapes: %v", files)
	}
	for _, fn := range files {
		raw := readText(filepath.Join("..", "tests", "fixtures", "post-shapes", fn))
		objs := reShapeObj.FindAllString(raw, -1)
		if len(objs) == 0 {
			t.Fatalf("%s holds no object", fn)
		}
		var masters, vouchers []M
		for i, x := range objs {
			if why := cannotSend(x); why != "" {
				t.Fatalf("%s: the posting rule refuses it: %s", fn, why)
			}
			it := M{"id": fn + string(rune('a'+i)), "xml": x}
			if strings.HasPrefix(x, "<VOUCHER ") {
				vouchers = append(vouchers, it)
			} else {
				masters = append(masters, it)
			}
		}
		for _, r := range planImports(masters, vouchers) {
			n0 := f.n("Import")
			o := sendImport(f.port, zz, "job-shapes", r)
			if o.err != nil {
				t.Fatalf("%s: not sent: %v", fn, o.err)
			}
			if f.n("Import") != n0+1 {
				t.Fatalf("%s: did not reach Tally", fn)
			}
		}
	}
	if n := logLines("refused"); n != 0 {
		t.Fatalf("%d refusal(s) in the log", n)
	}
}

// --- R6-1: the posting rule and the pin agree: what the rule accepts goes, nothing else
func TestPostingRuleAndPinAgree(t *testing.T) {
	d := today()
	cases := map[string]string{
		"voucher":                finVoucher("ag1", fgParty, "AG-1", d, "1.00") + "\n",
		"voucher, spaces":        "\n  " + finVoucher("ag2", fgParty, "AG-2", d, "1.00") + "\r\n\t",
		"ledger":                 `<LEDGER NAME="A" ACTION="Create"><NAME.LIST><NAME>A</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT></LEDGER>` + "\n",
		"ledger alter":           `<LEDGER NAME="A" ACTION="Alter"><NAME>A</NAME><PARTYGSTIN>27AAACF1234F1Z5</PARTYGSTIN></LEDGER>`,
		"group":                  `<GROUP NAME="Site Expenses" ACTION="Create"><NAME>Site Expenses</NAME><PARENT>Indirect Expenses</PARENT></GROUP>` + "\n",
		"voucher type numbering": "<VOUCHERTYPE NAME=\"Journal\" ACTION=\"Alter\">\n<NAME>Journal</NAME>\n<NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD>\n<PREVENTDUPLICATES>No</PREVENTDUPLICATES>\n</VOUCHERTYPE>\n",
		"voucher type, other":    `<VOUCHERTYPE NAME="Journal" ACTION="Alter"><NAME>Journal</NAME><PARENT>Payment</PARENT></VOUCHERTYPE>`,
		"voucher type create":    `<VOUCHERTYPE NAME="X" ACTION="Create"><NAME>X</NAME><NUMBERINGMETHOD>Automatic</NUMBERINGMETHOD></VOUCHERTYPE>`,
		"voucher without a date": strings.Replace(finVoucher("ag3", fgParty, "AG-3", d, "1.00"), "<DATE>"+d+"</DATE>", "", 1),
		"stock item":             `<STOCKITEM NAME="x"><NAME>x</NAME></STOCKITEM>`,
		"cost centre":            `<COSTCENTRE NAME="x"><NAME>x</NAME></COSTCENTRE>`,
		"voucher with a TDL":     strings.Replace(finVoucher("ag4", fgParty, "AG-4", d, "1.00"), "<NARRATION>", "<TDL><TDLMESSAGE><COLLECTION NAME=\"X\"/></TDLMESSAGE></TDL><NARRATION>", 1),
		"voucher with CDATA":     strings.Replace(finVoucher("ag5", fgParty, "AG-5", d, "1.00"), "<NARRATION>", "<NARRATION><![CDATA[x]]>", 1),
		"two TALLYMESSAGEs":      finVoucher("ag6", fgParty, "AG-6", d, "1.00") + `</TALLYMESSAGE><TALLYMESSAGE xmlns:UDF="TallyUDF">` + finVoucher("ag7", fgParty, "AG-7", d, "1.00"),
		"an export head inside":  `<LEDGER NAME="A"><NAME>A</NAME><ENVELOPE><HEADER><TALLYREQUEST>Export</TALLYREQUEST></HEADER></ENVELOPE></LEDGER>`,
	}
	for name, x := range cases {
		rule := cannotSend(x) == "" && !strings.Contains(x, "<TDL") && !strings.Contains(x, "CDATA") && !strings.Contains(x, "</TALLYMESSAGE>") && !strings.Contains(x, "<ENVELOPE")
		report := "Vouchers"
		if !strings.HasPrefix(strings.TrimSpace(x), "<VOUCHER ") {
			report = "All Masters"
		}
		pin := checkAllowed(importEnvelope(report, zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+x+"</TALLYMESSAGE>")) == nil
		if rule != pin {
			t.Errorf("%s: the posting rule says %v, the pin %v", name, rule, pin)
		}
	}
	// the deletions removeTallyVoucher builds (not postings: the pin takes them beside the rule's objects)
	for _, x := range []string{
		`<VOUCHER REMOTEID="g-1" VCHTYPE="Journal" ACTION="Delete"><DATE>20260401</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME></VOUCHER>`,
		`<VOUCHER TAGNAME="MASTERID" TAGVALUE="7" VCHTYPE="Journal" ACTION="Delete"><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME></VOUCHER>`,
		`<VOUCHER DATE="1-Apr-2026" TAGNAME="Voucher Number" TAGVALUE="J-7" VCHTYPE="Journal" ACTION="Delete"><DATE>20260401</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>J-7</VOUCHERNUMBER></VOUCHER>`,
	} {
		if err := checkAllowed(importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF">`+x+"</TALLYMESSAGE>")); err != nil {
			t.Errorf("a deletion: %v", err)
		}
	}
	if checkAllowed(importEnvelope("Vouchers", zz, `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER TAGNAME="MASTERID" TAGVALUE="7" ACTION="Delete"><VOUCHERTYPENAME>J</VOUCHERTYPENAME><NARRATION>x</NARRATION></VOUCHER></TALLYMESSAGE>`)) == nil {
		t.Error("a deletion with another field passes")
	}
	// several objects, whitespace between them
	two := `<TALLYMESSAGE xmlns:UDF="TallyUDF">` + finVoucher("ag8", fgParty, "AG-8", d, "1.00") + "\n\n" + finVoucher("ag9", fgParty, "AG-9", d, "1.00") + "\n</TALLYMESSAGE>"
	if err := checkAllowed(importEnvelope("Vouchers", zz, two)); err != nil {
		t.Fatalf("two vouchers with line breaks: %v", err)
	}
}

// --- R6-2: the refusal names the bridge
func TestPinRefusalWords(t *testing.T) {
	err := checkAllowed(strings.Replace(ledgerChunkRequest(zz, 0, 2000), "<TYPE>Ledger</TYPE>", "<TYPE>Voucher</TYPE>", 1))
	if err == nil || !strings.HasPrefix(err.Error(), "FinCom Bridge refused to send this (it is not a request FinCom builds): ") || !strings.HasSuffix(err.Error(), "; nothing was sent to Tally") {
		t.Fatalf("the words: %v", err)
	}
}

// --- R6-3: the duplicate check's party has no quote (as the other builders)
func TestDupCheckPartyNoQuote(t *testing.T) {
	x := dupCheckRequest(zz, "20260401", `Shah "Bros" & Co`)
	if strings.Contains(group(`<SYSTEM TYPE="Formulae" NAME="TDSDeskDupParty">(.*?)</SYSTEM>`, x, 1), "&#34;") {
		t.Fatalf("a quote in the party: %s", x)
	}
	measuring.Add(1)
	defer measuring.Add(-1)
	if err := checkAllowed(x); err != nil {
		t.Fatal(err)
	}
	_ = os.Getenv
}
