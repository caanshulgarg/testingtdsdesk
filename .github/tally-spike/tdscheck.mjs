// Mode tds240 (2.4.0's gate): the body FinCom received for the TDS entry, read by the cloud's own parser at the ref
// (server/tally-cloud/parse.js parseDay, as tally-ingest reads a recorder line's xml): the entry's TDS list as FinCom keeps
// it (nature, party, section, assessable amount, tax, rate, rateWorkedOut, exempt).
//   node tdscheck.mjs <parse.js> <in.json: {guid, xml}> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [parsePath, inPath, outPath] = process.argv.slice(2);
const { parseDay } = await import(pathToFileURL(parsePath).href);
const it = JSON.parse(readFileSync(inPath, "utf8").replace(/^﻿/, ""));
let out;
try {
  const r = parseDay(String(it.xml || ""));
  const v = r.vouchers.find((x) => x && x.guid === it.guid) || null;
  out = { ok: !!v, vouchers: r.vouchers.length, guid: it.guid, type: v?.type ?? null, no: v?.no ?? null, tds: v?.tds ?? [], checks: v?.checks ?? [] };
} catch (e) { out = { ok: false, error: String(e && e.stack || e) }; }
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log("tdscheck: " + JSON.stringify(out).slice(0, 600));
