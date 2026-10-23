// node run_seed.js - FinCom cuts a day book file into pieces for the bridge's copy: whole days, never across a month,
// every entry sent once, and the pieces follow one another with no gap
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "BridgeSeed"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const sent = [];
Object.assign(ctx, {CO: () => ({name: "Test"}), Bridge: {ensureProven: async () => true, on: () => true, openFor: () => ({name: "Test Co"}), cfg: () => ({url: "http://127.0.0.1:9100", key: "k"}), pinQ: () => ""},
  fetch: async (url, o) => { const u = new URL(url); sent.push({from: u.searchParams.get("from"), to: u.searchParams.get("to"), body: o.body}); return {ok: true, json: async () => ({ok: true, entries: (o.body.match(/<VOUCHER /g) || []).length})}; }});
// a year: April 2025 to March 2026, a few entries on most days, big enough to need several pieces a month
const days = [], pad = "x".repeat(4000);
for (let t = new Date(2025, 3, 1); t <= new Date(2026, 2, 31); t.setDate(t.getDate() + 1)){
  if (t.getDate() % 7 === 3) continue;                                    // some days have nothing
  const d = t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0");
  for (let k = 0; k < 90; k++) days.push('<VOUCHER VCHTYPE="Sales"><DATE>' + d + "</DATE><GUID>g" + d + k + "</GUID><NARRATION>" + pad + "</NARRATION></VOUCHER>");
}
const text = "<ENVELOPE><BODY><DATA>" + days.map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
x.BridgeSeed.send({text: async () => text}).then(r => {
  ok(r.entries === days.length, "every entry sent once: " + r.entries + " of " + days.length);
  ok(sent.length > 12, "in pieces: " + sent.length);
  ok(sent.every(p => p.from.slice(0, 6) === p.to.slice(0, 6) && p.from <= p.to), "no piece crosses a month");
  ok(sent.every(p => p.body.length < 9e6), "each piece a few megabytes at most: the largest " + Math.round(Math.max(...sent.map(p => p.body.length)) / 1e5) / 10 + " MB");
  const next = d => { const t = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + 1); return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); };
  ok(sent.every((p, i) => i === 0 || sent[i - 1].to === p.from || next(sent[i - 1].to) === p.from), "the pieces follow one another with no gap (empty days are known as empty)");
  ok(sent.every(p => (p.body.match(/<DATE>(\d{8})<\/DATE>/g) || []).every(m => { const d = m.slice(6, 14); return d >= p.from && d <= p.to; })), "every entry is inside its piece's dates");
  // dates chosen: April to June, with nothing in May: May is still sent, empty, so the copy knows it
  const t2 = "<ENVELOPE>" + days.filter(v => /<DATE>2025(04|06)/.test(v)).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</ENVELOPE>";
  const pc = x.BridgeSeed.pieces(t2, {from: "20250401", to: "20250630"});
  ok(pc[0].from === "20250401" && pc[pc.length - 1].to === "20250630" && pc.some(p => p.from === "20250501" && p.to === "20250531" && p.n === 0), "the dates chosen are covered end to end, an empty month sent as empty: " + pc.map(p => p.from + "-" + p.to + ":" + p.n).join(" "));
  const pc2 = x.BridgeSeed.pieces(text, {from: "20250701", to: "20250710"});
  ok(pc2.every(p => p.from >= "20250701" && p.to <= "20250710") && pc2.reduce((s, p) => s + p.n, 0) === days.filter(v => /<DATE>202507(0\d|10)</.test(v)).length, "only the entries inside the dates chosen are sent");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
});
