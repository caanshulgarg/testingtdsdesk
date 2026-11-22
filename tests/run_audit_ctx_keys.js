// node tests/run_audit_ctx_keys.js - audit 22-Nov-2026 (speed-db 3): the nightly share_parity and share_sweep compare the
// context kept in Postgres (jsonb: an object's keys in jsonb's own order, shorter keys first) with the one made now
// (ctxOf / contextOf: keys alphabetical). ctxDiff must see the same context as the same, whatever the key order, and still
// see a real change. Made-up books (tests/gst_cloud_world.js, seed 164).
"use strict";
const path = require("path");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {world} = require("./gst_cloud_world");
const ROOT = process.env.AUDIT_ROOT || path.join(__dirname, "..");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// jsonb's key order: by length, then bytewise; at every level
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : v && typeof v === "object" ? Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).reduce((o, k) => { o[k] = jsonb(v[k]); return o; }, {}) : v;
(async () => {
  const eng = await import(path.join(ROOT, "server", "gst-run", "engine.js"));
  const rows = world({seed: 164});
  const kept = jsonb(JSON.parse(JSON.stringify(eng.contextOf(rows))));
  rows.made = null;
  const now = eng.contextOf(rows);
  const n = Object.keys(now.map || {}).length;
  const d = eng.ctxDiff(kept, now);
  ok(n > 10, "the made-up book has " + n + " ledgers in its context");
  ok(!d.all && d.ledgers.length === 0 && d.guids.length === 0, "the same context kept through jsonb: nothing moved (was every ledger: " + d.ledgers.length + " of " + n + ")");
  // a real change still moves its ledger
  const first = Object.keys(now.map)[0], ch = JSON.parse(JSON.stringify(now));
  ch.map[first] = Object.assign({}, ch.map[first], {what: ch.map[first] && ch.map[first].what === "sales" ? "purchase" : "sales"});
  const d2 = eng.ctxDiff(kept, ch);
  ok(d2.ledgers.includes(first) && d2.ledgers.length <= 3, "a ledger whose setting changed is moved (" + d2.ledgers.join(", ") + ")");
  console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
