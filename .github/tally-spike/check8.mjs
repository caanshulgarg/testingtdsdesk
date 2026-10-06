// Check 8: an item invoice's recorder line read with the cloud's parse.js (parseDay at the bridge ref, as check 7), against
// Tally's own figures for that voucher, read here from an export the harness asked Tally for itself (never through the
// bridge): every ledger's total (ledger entries and the items' accounting allocations), by the names rule (namesKey).
// node check8.mjs <parse.js> <in.json: [{label, guid, lines: [{ev, at, xml}], tally: <export file>}]> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const [, , parsePath, inPath, outPath] = process.argv;
const { parseDay } = await import(pathToFileURL(parsePath).href);
const { namesClean, namesKey } = await import(pathToFileURL(join(dirname(parsePath), "..", "_shared", "names.js")).href);
const r2 = x => Math.round(x * 100) / 100;
const num = v => { const t = String(v ?? ""), i = t.lastIndexOf("="); const n = parseFloat((i >= 0 ? t.slice(i + 1) : t).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function field(s, tag) { const m = s.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([^<]*)</" + tag + ">")); return m ? m[1] : ""; }
// Tally's side, read independently of parse.js: the voucher element of this GUID, each ledger entry / accounting
// allocation with its own nested lists taken out, LEDGERNAME and AMOUNT
function tallyTotals(text, guid) {
  const m = new RegExp("<GUID(?:\\s[^>]*)?>\\s*" + esc(guid) + "\\s*</GUID>").exec(text) || new RegExp('REMOTEID="' + esc(guid) + '"').exec(text);
  if (!m) return null;
  const a = text.lastIndexOf("<VOUCHER ", m.index), z = text.indexOf("</VOUCHER>", m.index);
  if (a < 0 || z < 0) return null;
  const el = text.slice(a, z), by = new Map(), rows = [];
  const re = /<(ALLLEDGERENTRIES|LEDGERENTRIES|ACCOUNTINGALLOCATIONS)\.LIST(?:\s[^>]*)?>([\s\S]*?)<\/\1\.LIST>/g;
  let b;
  while ((b = re.exec(el))) {
    let own = b[2], prev;
    do { prev = own; own = own.replace(/<([A-Z0-9_]+\.LIST)(?:\s[^>]*)?>(?:(?!<[A-Z0-9_]+\.LIST[\s>])[\s\S])*?<\/\1>/g, ""); } while (own !== prev);
    const name = namesClean(field(own, "LEDGERNAME")); if (!name) continue;
    const amount = r2(num(field(own, "AMOUNT")));
    rows.push({ list: b[1], ledger: name, amount });
    const k = namesKey(name), h = by.get(k) || { ledger: name, amount: 0 }; h.amount = r2(h.amount + amount); by.set(k, h);
  }
  return { type: (el.match(/VCHTYPE="([^"]*)"/) || [])[1] || field(el, "VOUCHERTYPENAME"), no: field(el, "VOUCHERNUMBER"), date: field(el, "DATE"),
    items: (el.match(/<ALLINVENTORYENTRIES\.LIST/g) || []).length, rows, by };
}
const items = JSON.parse(readFileSync(inPath, "utf8").replace(/^\uFEFF/, ""));
const out = (Array.isArray(items) ? items : [items]).map(it => {
  const res = { label: it.label, guid: it.guid };
  let t = null;
  try { t = tallyTotals(readFileSync(it.tally, "utf8"), it.guid); } catch (e) { res.tallyError = String(e); }
  res.tally = t ? { type: t.type, no: t.no, date: t.date, items: t.items, rows: t.rows, totals: [...t.by.values()], sum: r2([...t.by.values()].reduce((s, x) => s + x.amount, 0)) } : null;
  res.lines = (it.lines || []).map(ln => {
    const o = { ev: ln.ev, at: ln.at, xmlChars: String(ln.xml || "").length };
    try {
      const r = parseDay(String(ln.xml || ""));
      const vs = r.vouchers.filter(v => v?.guid === it.guid), ls = r.lines.filter(l => Array.isArray(l) && l[0] === it.guid);
      const by = new Map(); ls.forEach(l => { const k = namesKey(l[1]), h = by.get(k) || { ledger: namesClean(l[1]), amount: 0 }; h.amount = r2(h.amount + (Number(l[2]) || 0)); by.set(k, h); });
      o.match = vs.length; o.type = vs[0]?.type ?? null; o.no = vs[0]?.no ?? null; o.date = vs[0]?.date ?? null; o.party = vs[0]?.party ?? null;
      o.parsed = ls.map(l => ({ ledger: l[1], amount: l[2] })); o.totals = [...by.values()]; o.sum = r2(ls.reduce((s, l) => s + (Number(l[2]) || 0), 0));
      // the cloud's balance guard (guard-230, index.ts cleanRecorderLine): a body is taken only with >= 2 lines adding to 0
      o.guardHeld = vs.length > 0 && (ls.length < 2 || Math.abs(o.sum) > 0.01);
      const diffs = [];
      if (t) {
        const keys = new Set([...t.by.keys(), ...by.keys()]);
        keys.forEach(k => { const a = t.by.get(k)?.amount ?? null, b2 = by.get(k)?.amount ?? null; if (a === null || b2 === null || Math.abs(a - b2) > 0.01) diffs.push({ ledger: (t.by.get(k) || by.get(k)).ledger, tally: a, parsed: b2 }); });
      }
      o.diffs = diffs;
      o.ok = !!t && vs.length === 1 && ls.length >= 2 && Math.abs(o.sum) <= 0.01 && diffs.length === 0;
    } catch (e) { o.error = String(e && e.stack || e); o.ok = false; }
    return o;
  });
  res.ok = !!res.tally && res.lines.length > 0 && res.lines.every(l => l.ok);
  return res;
});
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`check8: ${out.length} voucher(s), ${out.filter(o => o.ok).length} matching Tally`);
