// node run_stuck.js - build 194: "Tally not responding since HH:MM" on the Tally chip; "Books up to ..." on the Books screens
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["esc", "num", "norm", "tallyDate", "fmtDate", "bridgeChip", "booksFreshLine"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.Bridge = {on: () => true, up: () => true, openFor: () => ({name: "X", port: 9000}), tallyName: () => "X", st: {state: "ok", tallyUp: true, open: [], jobs: [], stuck: {since: "2026-09-30T17:51:55", port: 9000}}};
const chip = x.bridgeChip({name: "X"});
ok(/not responding since 17:51/.test(chip) && /pop-up in Tally/.test(chip), "the chip: Tally not responding since 17:51, check for a pop-up in Tally");
ctx.Bridge.st.stuck = null;
ok(/Open in Tally/.test(x.bridgeChip({name: "X"})), "once Tally answers again, the chip is back to normal");
const line = x.booksFreshLine({vouchers: [{}], meta: {to: "20260929", at: "2026-09-30T12:05:00Z"}});
ok(/Books up to/.test(line) && /data-act="keepNow"/.test(line), "Books screens: how up to date, with Update now: " + line.replace(/<[^>]+>/g, "").slice(0, 80));
ok(x.booksFreshLine({vouchers: [], meta: {}}) === "", "no line without books");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
