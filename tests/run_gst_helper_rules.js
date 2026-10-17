// node run_gst_helper_rules.js - the GST browser helper's plain rules (extension/gst-helper/lib/rules.js): FinCom's GSTR-1
// tables to the paisa, the 3B boxes, the compare, the ARN read, the buttons it never presses, and the selectors file's
// self-check (every step names its fields; no field is left to a guess).
const path = require("path"), assert = require("assert");
const R = require(path.join(__dirname, "..", "extension", "gst-helper", "lib", "rules.js"));
const SEL = require(path.join(__dirname, "..", "extension", "gst-helper", "selectors.js"));
const fx = require(path.join(__dirname, "fixtures", "gst-portal-fake", "fincom-data.json"));
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };

// paise: the portal's way of writing money read exactly
ok(R.paise("₹ 1,23,456.78") === 12345678 && R.paise("(-) 500.00") === -50000 && R.paise("-0.10") === -10 && R.paise(0.1 + 0.2) === 30 && Number.isNaN(R.paise("abc")),
  "money read to the paisa: ₹ 1,23,456.78, (-) 500.00, -0.10, 0.1+0.2, and text that is not money");
ok(R.money(12345678) === "₹1,23,456.78" && R.money(-50) === "-₹0.50", "money written the Indian way");

// GSTR-1 tables from FinCom's JSON (the fixture's figures worked out by hand in fincom-data.json "hand")
const t = R.tables1(fx.r1json), hand = fx.hand.r1;
Object.keys(hand).forEach((k) => {
  const got = t[k] || {}, want = hand[k], cols = Object.keys(want);
  ok(cols.every((c) => got[c] === want[c]), "table " + k + ": " + cols.map((c) => c + " " + got[c]).join(", ") + (cols.every((c) => got[c] === want[c]) ? "" : " (hand: " + JSON.stringify(want) + ")"));
});
ok(Object.keys(t).sort().join() === Object.keys(hand).sort().join(), "every table in the JSON is counted, and no other (" + Object.keys(t).join(", ") + ")");
ok(R.records1(fx.r1json, "b2b").length === hand.b2b.n && R.records1(fx.r1json, "b2b")[0].ctin === fx.r1json.b2b[0].ctin, "B2B records flattened with the customer's GSTIN on each");
ok(R.records1(fx.r1json, "cdnr")[0].ntty === "C" && R.records1(fx.r1json, "hsn").every((r) => r.tab === "b2b" || r.tab === "b2c"), "notes keep C/D; HSN rows keep their B2B / B2C tab");

// 3B boxes
const f3 = R.fields3b(fx.r3bjson), by = Object.fromEntries(f3.map((x) => [x.key, x.value]));
Object.entries(fx.hand.r3b).forEach(([k, v]) => ok(by[k] === v, "3B " + k + " = " + by[k] + (by[k] === v ? "" : " (hand " + v + ")")));
ok(f3.length === (5 + 3 + 1 + 5 + 1) + (2 + 2 + 4 + 4 + 4) + 8 + 8 + 4, "3B: every box of 3.1 (a)-(e), 4 A(1)-(5), B(1)-(2), D(1)-(2) and 5 (" + f3.length + ")");
ok(R.rows32(fx.r3bjson).length === fx.r3bjson.inter_sup.unreg_details.length, "3.2: a row per place of supply");

// compare: equal to the paisa agrees; a paisa off differs; a box not shown is a difference, never taken as zero
const c1 = R.compare([{ key: "a", label: "A", value: 100.1 }, { key: "b", label: "B", value: 5 }, { key: "c", label: "C", value: 0 }], { a: "₹ 100.10", b: "5.01" });
ok(c1.rows[0].ok && !c1.rows[1].ok && c1.rows[1].diff === "0.01" && !c1.rows[2].ok && c1.rows[2].portal === "not shown" && !c1.agree, "compare: to the paisa; one paisa is a difference; a box the portal did not show is a difference");
const port = {}; Object.values(t).forEach((x) => { port[x.key] = Object.fromEntries(Object.entries(x).filter(([k]) => !["key", "label"].includes(k)).map(([k, v]) => [k, ["n", "totnum", "cancel", "net"].includes(k) ? v : (v / 100).toFixed(2)])); });
ok(R.compare1(t, port).agree, "GSTR-1 compare: FinCom's own figures read back agree, table by table");
port.b2b.txval = (t.b2b.txval / 100 + 1).toFixed(2); port.cdnura = { n: 1, txval: "10.00" };
const c2 = R.compare1(t, port);
ok(!c2.agree && c2.differences.some((d) => d.key === "b2b.txval" && d.diff === "1.00") && c2.differences.some((d) => d.key === "cdnura.n"), "GSTR-1 compare: a rupee more in B2B and a table FinCom has none of are both differences");

// ARN read only from the page's words
ok(R.arnIn("Return filed successfully. ARN is AA0710250123456 dated 11-11-2025") === "AA0710250123456" && R.arnIn("no arn here") === "", "ARN read from the portal's message; none made up");

// buttons never pressed
["File GSTR-1", "FILE RETURN", "File with EVC", "File with DSC", "SUBMIT", "Make Payment / Post Credit to Ledger", "Proceed to File", "File", "Create Challan"].forEach((x) => ok(R.forbidden(x), "never pressed: " + x));
["GENERATE SUMMARY", "SAVE GSTR3B", "PROCEED TO PAYMENT", "Add record", "SAVE", "Upload", "GENERATE JSON FILE TO DOWNLOAD", "SEARCH", "Back", "CONFIRM"].forEach((x) => ok(!R.forbidden(x), "may be pressed: " + x));

// the selectors file: one version, every step's fields named, and nothing marked as a guess left without a selector
ok(/^\d{4}\.\d{2}\.\d{2}-\d+$/.test(SEL.version), "selectors file has a version (" + SEL.version + ")");
const missing = [];
Object.entries(SEL.pages).forEach(([pk, pg]) => { if (!pg.url) missing.push(pk + ".url"); Object.entries(pg.fields || {}).forEach(([fk, s]) => { if (!s || !(s.css || s.text)) missing.push(pk + "." + fk); }); });
ok(!missing.length, "every field of every page has a selector" + (missing.length ? ": missing " + missing.join(", ") : ""));
ok(f3.every((x) => SEL.pages.gstr3b.fields["box:" + x.key]), "every 3B box FinCom fills has its field in the selectors file");
ok(R.R1.every(([k]) => SEL.pages.gstr1.tables[k]), "every GSTR-1 table has its tile and summary row in the selectors file");
ok(!Object.values(SEL.pages).some((p) => Object.values(p.fields || {}).some((s) => s.click && R.forbidden(s.text || ""))), "no button the helper clicks is a filing, payment or signing button");

console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
process.exit(fails ? 1 : 0);
