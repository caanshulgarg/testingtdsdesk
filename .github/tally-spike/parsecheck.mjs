// Check 7: each created / altered / imported recorder line's xml, as the stub received it, read with the cloud's own parser
// (server/tally-cloud/parse.js parseDay at the bridge ref, with server/_shared/names.js) exactly as tally-ingest's
// cleanRecorderLine does: the vouchers whose guid is the line's object_guid, the lines whose first field is that GUID.
//   node parsecheck.mjs <parse.js> <in.json: [{label, guid, xml}]> <out.json>
// The owner's scenarios for bridge 2.3.1 (S1..S10, scen231.mjs): the body the stub received read with parse.js (FinCom's
// side) against Tally's own export of the entry read by the harness's own reader (tallyxml.mjs, never the bridge or
// parse.js) and against what the harness entered (the ground truth); and the tag names looked for in Tally's answers.
//   node parsecheck.mjs s231 <parse.js> <in.json> <out.json>
//     in.json: {scenarios: [{id, key, kind, label, guid, truth, lines: [{ev, at, xml, state, why}], tally: <file>, entry: <file>,
//               ledger: <file>?}], tags: [{label, file}]}
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const s231 = process.argv[2] === "s231";
const [parsePath, inPath, outPath] = process.argv.slice(s231 ? 3 : 2);
const { parseDay } = await import(pathToFileURL(parsePath).href);
const read = f => (f && existsSync(f) ? readFileSync(f, "utf8").replace(/^﻿/, "") : "");

if (!s231) {
  const items = JSON.parse(read(inPath));
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
} else {
  const here = dirname(fileURLToPath(import.meta.url));
  const T = await import(pathToFileURL(join(here, "tallyxml.mjs")).href);
  const { namesKey } = await import(pathToFileURL(join(dirname(parsePath), "..", "_shared", "names.js")).href);
  const r2 = T.r2, near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0.01;
  const show = x => (x === null || x === undefined || x === "" ? "(none)" : Array.isArray(x) ? x.join("/") : String(x));
  const inp = JSON.parse(read(inPath));
  const out = { scenarios: [], tags: [] };
  for (const sc of inp.scenarios || []) {
    const rows = [], notes = [];
    // one compared value: status ok | fail | harness (Tally itself does not hold what the scenario needs: the setup's, not the bridge's)
    const row = (what, tally, fincom, entered, ok, harness = false) => rows.push({ what, tally: show(tally), fincom: show(fincom), entered: entered === undefined ? undefined : show(entered), status: ok ? "ok" : harness ? "harness" : "fail" });
    const res = { id: sc.id, key: sc.key, label: sc.label, guid: sc.guid, rows, notes };
    // Tally's side: the harness's own export (Day Book of the scenario's day), read by tallyxml.mjs
    const tv = sc.guid ? T.voucherOf(read(sc.tally), sc.guid) : null, tm = tv ? T.model(tv) : null;
    res.tallyFound = !!tm;
    if (!tm) notes.push(`Tally's own export ${sc.tally || "(none)"} has no voucher ${sc.guid || "(no GUID: the entry was not made)"}`);
    // FinCom's side: the newest line with a body that parse.js reads into a voucher of this GUID
    let fv = null, fl = [], from = null;
    for (const ln of [...(sc.lines || [])].reverse()) {
      if (!ln.xml) continue;
      try { const r = parseDay(String(ln.xml)); const vs = r.vouchers.filter(v => v?.guid === sc.guid); if (vs.length) { fv = vs[0]; fl = r.lines.filter(l => Array.isArray(l) && l[0] === sc.guid); from = ln; break; } }
      catch (e) { notes.push(`parse.js failed on the ${ln.ev} line at ${ln.at}: ${String(e).slice(0, 200)}`); }
    }
    res.fincomFound = !!fv; res.line = from ? { ev: from.ev, at: from.at, xmlChars: String(from.xml).length, state: from.state, why: from.why } : null;
    if (!fv) notes.push(`no line the stub received for ${sc.guid || "(no GUID)"} has a body parse.js reads (${(sc.lines || []).length} line(s): ${(sc.lines || []).map(l => `${l.ev} ${l.at} xml ${String(l.xml || "").length} chars ${l.state || ""}`).join("; ") || "none"})`);
    const t = sc.truth || {};
    if (tm && fv) {
      row("voucher type", tm.head.type, fv.type, t.type, tm.head.type === fv.type && fv.type === t.type, tm.head.type !== t.type);
      const fsum = r2(fl.reduce((s, l) => s + (Number(l[2]) || 0), 0));
      row("FinCom's lines add up to 0", r2(tm.sum), fsum, 0, Math.abs(fsum) <= 0.01);
      // ledger by ledger (by the names rule)
      const by = list => { const m = new Map(); list.forEach(([n, a]) => { const k = namesKey(n), h = m.get(k) || { n, a: 0 }; h.a = r2(h.a + a); m.set(k, h); }); return m; };
      const tb = by(tm.lines.map(l => [l.ledger, l.amount])), fb = by(fl.map(l => [l[1], Number(l[2]) || 0])), eb = by(Object.entries(t.ledgers || {}));
      for (const k of new Set([...tb.keys(), ...fb.keys()])) { const a = tb.get(k)?.a ?? null, b = fb.get(k)?.a ?? null, e = eb.get(k)?.a; row(`ledger ${(tb.get(k) || fb.get(k)).n}`, a, b, e, near(a, b)); }
      if (Array.isArray(fv.checks)) row("parse.js's accuracy checks", "", fv.checks.length ? fv.checks.join(" | ") : "none", undefined, fv.checks.length === 0);
      if (sc.kind === "items") {
        const ti = tm.items, fi = Array.isArray(fv.items) ? fv.items : null, ei = t.items || [];
        row("item lines", ti.length, fi ? fi.length : "(parse.js reads no items)", ei.length, !!fi && fi.length === ei.length && ti.length === ei.length, ti.length !== ei.length);
        const big = ei.length > 5; let okLines = 0; const bad = [];
        ei.forEach((e, i) => {
          const a = ti[i] || {}, b = (fi || [])[i] || {};
          const tTax = a.gstRate != null ? r2(Math.abs(a.amount) * a.gstRate / 100) : null;
          const fTax = fi ? Math.abs(r2((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0))) : null;
          const fRate = fi ? b.gst : null;
          const cmp = [
            [`line ${i + 1} ${e.item} HSN`, a.hsn, b.hsn, e.hsn, b.hsn === e.hsn && a.hsn === e.hsn, !a.hsn],
            [`line ${i + 1} ${e.item} quantity`, a.qty, b.qty, e.qty, near(b.qty, e.qty) && near(a.qty, e.qty), false],
            [`line ${i + 1} ${e.item} taxable value`, a.amount != null ? Math.abs(a.amount) : null, b.taxable != null ? Math.abs(b.taxable) : null, e.taxable, near(Math.abs(b.taxable ?? NaN), e.taxable), false],
            [`line ${i + 1} ${e.item} GST rate`, a.gstRate, fRate, e.gst, near(fRate, e.gst) && near(a.gstRate, e.gst), a.gstRate == null],
            [`line ${i + 1} ${e.item} tax`, tTax, fTax, e.tax, near(fTax, e.tax) && near(tTax, e.tax), tTax == null],
          ];
          const lineOk = cmp.every(c => c[4]);
          if (lineOk) okLines++;
          cmp.forEach(c => { if (!big || !c[4] || i < 2) row(c[0], c[1], c[2], c[3], c[4], c[5]); else rows.push({ what: c[0], tally: show(c[1]), fincom: show(c[2]), entered: show(c[3]), status: "ok", quiet: true }); });
          if (!lineOk) bad.push(i + 1);
        });
        if (big) notes.push(`${okLines} of ${ei.length} item lines match on HSN, quantity, taxable value, GST rate and tax${bad.length ? `; not: line(s) ${bad.join(", ")}` : ""} (lines 1-2 and any mismatch printed)`);
        if (t.irn !== undefined) {
          // the e-invoice and e-way bill: imported as stored fields (Educational mode reaches neither portal)
          for (const [w, tk, fk, ek] of [["IRN", "irn", "irn", "irn"], ["IRN ack no", "ackNo", "ackNo", "ackNo"], ["IRN ack date", "ackDate", "ackDate", "ackDate"], ["e-way bill number", "eway", "eway", "eway"]]) {
            const a = tm.head[tk], b = fv[fk];
            row(w, a, b, t[ek], !!a && a === b, !a);
          }
        }
      }
      if (sc.kind === "bills") {
        for (const e of t.bills || []) {
          const tl = tm.lines.find(l => namesKey(l.ledger) === namesKey(e.ledger)), fline = fl.find(l => namesKey(l[1]) === namesKey(e.ledger));
          const tb2 = (tl?.bills || []).find(b => b.name === e.name), fb2 = ((fline && fline[5]) || []).find(b => b[0] === e.name);
          row(`${e.ledger} bill ${e.name} type`, tb2?.type, fb2?.[1], e.type, !!tb2 && tb2.type === e.type && fb2?.[1] === e.type, !tb2);
          row(`${e.ledger} bill ${e.name} amount`, tb2 ? Math.abs(tb2.amount) : null, fb2 ? Math.abs(fb2[2]) : null, e.amount, !!tb2 && near(Math.abs(tb2.amount), e.amount) && near(Math.abs(fb2?.[2] ?? NaN), e.amount), !tb2);
        }
      }
      if (sc.kind === "tds") {
        const e = t.tds || {}, tt = tm.lines.flatMap(l => l.tds)[0] || null, ft = (fv.tds || [])[0] || null;
        row("TDS nature of payment", tt?.CATEGORY, ft?.nature, e.nature, !!tt?.CATEGORY && tt.CATEGORY === ft?.nature, !tt?.CATEGORY);
        row("TDS rate", tt?.TAXRATE != null ? T.num(tt.TAXRATE) : null, ft?.rate, e.rate, tt?.TAXRATE != null && near(T.num(tt.TAXRATE), ft?.rate), tt?.TAXRATE == null);
        row("TDS assessable value", tt?.ASSESSABLEAMOUNT != null ? Math.abs(T.num(tt.ASSESSABLEAMOUNT)) : null, ft?.base != null ? Math.abs(ft.base) : null, e.base, tt?.ASSESSABLEAMOUNT != null && near(Math.abs(T.num(tt.ASSESSABLEAMOUNT)), Math.abs(ft?.base ?? NaN)), tt?.ASSESSABLEAMOUNT == null);
        row("TDS amount", tt?.TAX != null ? Math.abs(T.num(tt.TAX)) : null, ft?.tax != null ? Math.abs(ft.tax) : null, e.tax, tt?.TAX != null && near(Math.abs(T.num(tt.TAX)), Math.abs(ft?.tax ?? NaN)), tt?.TAX == null);
        // the section and the deductee type: compared only when Tally provides them
        const sec = tm.head.sections[0] || "";
        if (sec) row("TDS section (Tally's TDSDEDUCTEESECTIONNUMBER)", sec, ft?.section, e.section, ft?.section === sec);
        else notes.push(`TDS section: Tally gives no TDSDEDUCTEESECTIONNUMBER on this entry; FinCom's section ${show(ft?.section)} (from ${show(ft?.sectionFrom)})`);
        const lm = read(sc.ledger), dt = (lm.match(/<TDSDEDUCTEETYPE(?:\s[^>]*)?>([^<]+)<\/TDSDEDUCTEETYPE>/) || [])[1] || "";
        notes.push(`deductee type: Tally's ledger master ${dt ? `TDSDEDUCTEETYPE "${T.dec(dt)}"` : "gives no TDSDEDUCTEETYPE"}; the entry body carries none (FinCom: (none))`);
      }
      if (sc.kind === "costs") {
        const tc = tm.lines.flatMap(l => l.costs.map(c => ({ ...c, ledger: l.ledger }))), fc = fv.costs || [];
        for (const e of t.costs || []) {
          const a = tc.find(c => c.centre === e.centre), b = fc.find(c => c.centre === e.centre);
          row(`${e.ledger} cost centre ${e.centre} (${e.category})`, a ? `${a.category}: ${a.amount}` : null, b ? `${b.cat}: ${b.amt}` : null, `${e.category}: ${e.amount}`, !!a && !!b && near(a.amount, b.amt) && a.category === b.cat && near(b.amt, e.amount), !a);
        }
      }
      if (sc.kind === "bank") {
        const e = t.bank || {}, tb3 = tm.lines.flatMap(l => l.bank)[0] || null, fb3 = (fv.banks || [])[0] || null;
        row("bank transaction type", tb3?.txnType, fb3?.type, e.txnType, !!tb3?.txnType && tb3.txnType === fb3?.type, !tb3?.txnType);
        row("bank instrument number (UTR)", tb3?.instNo, fb3?.no, e.instNo, !!tb3?.instNo && tb3.instNo === fb3?.no, !tb3?.instNo);
        row("bank instrument date", tb3?.instDate, fb3?.date, e.instDate, !!tb3?.instDate && tb3.instDate === fb3?.date, !tb3?.instDate);
        notes.push(`Tally's bank allocation as exported: ${JSON.stringify(tb3?.all || null).slice(0, 600)}`);
      }
    }
    const st = rows.filter(r => !r.quiet).map(r => r.status);
    res.status = !tm || !fv ? (!tm ? "harness" : "fail") : st.includes("fail") ? "fail" : st.includes("harness") ? "harness" : "pass";
    out.scenarios.push(res);
  }
  // the tag names, looked for in each answer: present (an element of that name) and its first value
  const TAGS = ["IRN", "IRNACKNO", "IRNACKDATE", "EWAYBILLDETAILS.LIST", "BILLNUMBER", "TAXOBJECTALLOCATIONS.LIST", "UNIQUEREFERENCENUMBER", "TDSDEDUCTEESECTIONNUMBER", "TDSDEDUCTEETYPE"];
  for (const tag of TAGS) {
    const seen = [];
    for (const f of inp.tags || []) {
      const x = read(f.file); if (!x) continue;
      // an element counts only with a value (Tally writes many empty ones: <IRN TYPE="String"></IRN>, <X.LIST> </X.LIST>)
      const et = tag.replace(/\./g, "\\."), re = new RegExp("<" + et + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + et + ">", "g"); let m, n = 0, empty = 0, val = "";
      while ((m = re.exec(x))) { const inner = m[1], text = inner.replace(/<[^>]*>/g, "").trim(); if (text) { n++; if (!val) val = T.dec(text.split(/\s*\n\s*/).join(" ")); } else empty++; }
      empty += (x.match(new RegExp("<" + et + "(?:\\s[^>]*)?/>", "g")) || []).length;
      if (n || empty) seen.push({ label: f.label, count: n, empty, value: val.slice(0, 80) });
    }
    out.tags.push({ tag, seen });
  }
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`parsecheck s231: ${out.scenarios.map(s => `${s.id} ${s.status}`).join(", ")}`);
}
