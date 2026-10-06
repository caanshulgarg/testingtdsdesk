// Check 7: each created / altered / imported recorder line's xml, as the stub received it, read with the cloud's own parser
// (server/tally-cloud/parse.js parseDay at the bridge ref, with server/_shared/names.js) exactly as tally-ingest's
// cleanRecorderLine does: the vouchers whose guid is the line's object_guid, the lines whose first field is that GUID.
// node parsecheck.mjs <parse.js> <in.json: [{label, guid, xml}]> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [, , parsePath, inPath, outPath] = process.argv;
const { parseDay } = await import(pathToFileURL(parsePath).href);
const items = JSON.parse(readFileSync(inPath, "utf8").replace(/^﻿/, ""));
const out = (Array.isArray(items) ? items : [items]).map(it => {
  const xml = String(it.xml || ""), og = String(it.guid || "");
  const base = { label: it.label, guid: og, ev: it.ev, xmlChars: xml.length };
  try {
    const r = parseDay(xml);
    const vs = og ? r.vouchers.filter(v => v?.guid === og) : [];
    const ls = og ? r.lines.filter(l => Array.isArray(l) && l[0] === og) : [];
    const nz = ls.filter(l => Math.abs(Number(l[2]) || 0) >= 0.005);
    const v = vs[0] || {};
    return { ...base, parsedVouchers: r.vouchers.length, parsedGuids: r.vouchers.map(x => x.guid), match: vs.length,
      type: v.type ?? null, no: v.no ?? null, date: v.date ?? null, party: v.party ?? null,
      lines: ls.map(l => ({ ledger: l[1], amount: l[2], bills: Array.isArray(l[5]) ? l[5] : [] })),
      nonZero: nz.length, bills: ls.reduce((n, l) => n + (Array.isArray(l[5]) ? l[5].length : 0), 0),
      ok: vs.length === 1 && nz.length >= 2 };
  } catch (e) { return { ...base, error: String(e && e.stack || e), ok: false }; }
});
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`parsecheck: ${out.length} line(s), ${out.filter(o => o.ok).length} with a body`);
