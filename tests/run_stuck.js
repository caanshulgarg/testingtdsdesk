// node run_stuck.js - build 194: "Books up to ..." on the Books screens, worked out from the books themselves.
// booksFreshLine (the legacy Books screens' line with Update now) went with those screens: the React Books page
// (app/src/screens/Books.jsx FreshLine) says one quiet "Books up to <date>" from booksFresh(b).last (src/js/49), and Update
// now is in the top bar's Tally panel (round 3 A, the owner 14-Oct-2026; parts/TallyLine.jsx PanelBooks). "Tally busy" when
// Tally is stuck is the top bar sign's (run_tally_states.py). This checks booksFresh, the one sentence every page uses.
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["esc", "num", "norm", "tallyDate", "fmtDate", "istParts", "p2ist", "fmtDateTime", "booksFresh"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.S.coId = "t";
// the books' last entry (a cancelled one never counts), how far they were checked with Tally, and when
const f = x.booksFresh({vouchers: [{date: "20260925"}, {date: "20260928"}, {date: "20260929", cancel: true}], meta: {to: "20260930", at: "2026-09-30T12:05:00Z"}}, "t");
ok(f.last === "20260928" && f.checked === "20260930" && f.at === "2026-09-30T12:05:00Z", "the last entry (not a cancelled one), checked to, read at (" + JSON.stringify([f.last, f.checked, f.at]) + ")");
ok(("Books up to " + x.fmtDate(x.tallyDate(f.last))) === "Books up to 28-Sep-2026", "Books screens: \"Books up to 28-Sep-2026\" (Books.jsx FreshLine)");
ok(/last entry 28-Sep-2026/.test(f.text) && /checked with Tally to 30-Sep-2026/.test(f.text), "the one sentence: " + f.text);
const none = x.booksFresh({vouchers: [], meta: {}}, "t");
ok(none.last === "" && /no entries yet/.test(none.text), "no books: no date, \"no entries yet\" (" + none.text + ")");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
