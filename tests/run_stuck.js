// node run_stuck.js - build 194: "Tally not responding since HH:MM" on the Tally chip; "Books up to ..." on the Books screens
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["esc", "num", "norm", "tallyDate", "fmtDate", "booksFreshLine"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.Bridge = {on: () => true, up: () => true, openFor: () => ({name: "X", port: 9000}), tallyName: () => "X", st: {state: "ok", tallyUp: true, open: [], jobs: [], stuck: {since: "2026-09-30T17:51:55", port: 9000}}};
// 24-Oct-2026 (next-tally-one-page): the old sidebar chip (bridgeChip) is gone; "Tally busy" is the top bar sign's (run_tally_states.py)
const line = x.booksFreshLine({vouchers: [{}], meta: {to: "20260929", at: "2026-09-30T12:05:00Z"}});
ok(/Books up to/.test(line) && /data-act="keepNow"/.test(line), "Books screens: how up to date, with Update now: " + line.replace(/<[^>]+>/g, "").slice(0, 80));
ok(x.booksFreshLine({vouchers: [], meta: {}}) === "", "no line without books");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
