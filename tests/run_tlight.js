// node run_tlight.js - the light per client on the clients list, from the bridge's heartbeat
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["esc", "TLight"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const now = Date.parse("2026-09-30T12:00:00Z"), ago = m => new Date(now - m * 60000).toISOString();
const beat = (o) => ({at: ago(2), tally: true, dailyAt: "20:00", companies: [{name: "A LTD", at: ago(60 * 10), waiting: 0}, {name: "B LTD", at: ago(60 * 50), waiting: 0}, {name: "C LTD", at: ago(30), waiting: 3}], ...o});
const devs = [{id: "d1", name: "OFFICE-PC", last_seen: ago(2), info: {beat: beat({})}}, {id: "d2", name: "OLD-PC", last_seen: ago(90), info: {beat: beat({at: ago(90)})}},
  {id: "d3", name: "HOME-PC", last_seen: ago(1), info: {beat: beat({tally: false})}}, {id: "d4", name: "GONE", revoked: true, last_seen: ago(1), info: {beat: beat({})}}];
const cos = [{company: "A LTD", client_id: "a", device_id: "d1"}, {company: "B LTD", client_id: "b", device_id: "d1"}, {company: "C LTD", client_id: "c", device_id: "d1"},
  {company: "D LTD", client_id: "d", device_id: "d1"}, {company: "E LTD", client_id: "e", device_id: "d2"}, {company: "F LTD", client_id: "f", device_id: "d3"},
  {company: "G LTD", client_id: "g", device_id: null}, {company: "H LTD", client_id: "h", device_id: "d4"}];
const by = x.TLight.work(cos, devs, now);
ok(by.a && by.a.level === "ok" && /updated/.test(by.a.short), "updated today, computer on, Tally open: green (" + (by.a || {}).short + ")");
ok(by.b && by.b.level === "warn" && /updated/.test(by.b.short), "last updated two days ago: amber, with the date (" + (by.b || {}).short + ")");
ok(by.c && by.c.level === "warn" && /3 days to send/.test(by.c.short), "days waiting to be sent: amber (" + (by.c || {}).short + ")");
ok(by.d && by.d.level === "warn" && /not updated yet/.test(by.d.short), "a company the computer has no copy of yet: amber (" + (by.d || {}).short + ")");
ok(by.e && by.e.level === "bad" && /computer off/.test(by.e.short), "no heartbeat for an hour and a half: red, computer off (" + (by.e || {}).short + ")");
ok(by.f && by.f.level === "warn" && /Tally closed/.test(by.f.short), "computer on, Tally not open: amber (" + (by.f || {}).short + ")");
ok(!by.g && !by.h, "a client from files only, or on a removed computer: no light");
ctx.TCloud = {on: () => false}; x.TLight.st.by = by;
ok(/tag ok/.test(x.TLight.cell("a")) && /title=/.test(x.TLight.cell("a")) && /—/.test(x.TLight.cell("zz")), "the cell: a coloured tag with the explanation on hover; a dash without Tally");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
