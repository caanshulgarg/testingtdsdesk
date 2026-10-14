// Registers on Purchase and Sales (any sheet, a PDF table or JSON) and Reconciliations → Vendors / Customers: the engine.
// Loaded when first used (window.loadRegisters, app/src/main.jsx; registersLoad in src/js/82-registers.js), so the
// program every page loads stays within its budget. It runs on the program's globals (S, CO, num, r2, Market, GST2B,
// GSTAmend, LK, …) and puts its own on window, where the program and the screens find them.
// It was src/js/81-sheet-import.js and 82-party-recon.js; the two parts follow as they were.
/* ================================================================== */
/* A register uploaded as a sheet or JSON becomes entries to review   */
/* ================================================================== */
// The owner (14-Oct-2026): "If we upload any purchase sheet or sales sheet (Excel, PDF or CSV), in any portal format, the
// system works out every field with the help of AI and shows that detail, and then we should be able to post the entries
// in Tally. If anything needs an answer in sales or purchase, it should ask in the panel. Use AI the first time for any
// format; after that it should learn that format and use that memory next time." And: GSTR-1 JSON posts as sales, GSTR-2B
// JSON as purchases, by rules (no AI); any other JSON through the same engine (JSON paths for columns).
//
// For Purchase and Sales only (never the GST tab: its uploads and parsers are untouched; GST2B.fromJson and
// GSTAmend.norm are only read here). The rows become the same entries as an uploaded bill or invoice, in To review, with
// the same duplicate guard (finishNewEntry → findDuplicate; Sales: the same invoice number), approved and posted through
// the existing path (Bridge.post, which posts a Zoho client's entries to Zoho Books): no new Tally request.
//
//   SheetFmt.read(file)            → {kind: "grid" | "gstr1" | "gstr2b" | "json", grid, sheet, json}
//   SheetFmt.head(grid)            → the header row's index (the header may sit a few rows down)
//   SheetFmt.fingerprint(h, sheet) → "f…": the normalised header names, the column count, the sheet name's pattern
//   SheetFmt.find(head, …)         → a saved or built-in format: exact (same fingerprint), "drift" (every mapped column
//                                    is still there by name: an extra or moved column), or null (a real change: ask)
//   SheetFmt.propose(head, rows)   → the AI's mapping of a new format, once (header and 10 masked rows, the cheap model);
//                                    a guess the user confirms or changes, then saves (who, when)
//   SheetFmt.apply(fmt, grid, hi)  → documents: FinCom's own rules work out every figure (the AI never decides one)
//   SheetImport.*                  → the panel: the mapping, the questions, the documents made
// Formats are kept on the client (co.sheetFormats, riding the client's sync) or for the firm (S.firm.sheetFormats);
// a deleted one is kept with who, when and why (soft).

const SHEET_FIELDS = [["date", "Invoice date"], ["no", "Invoice no."], ["party", "Party name"], ["gstin", "Party GSTIN"], ["pos", "Place of supply"],
  ["taxable", "Taxable value"], ["rate", "GST rate %"], ["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST / UTGST"], ["cess", "Cess"],
  ["tax", "Total tax (one column)"], ["total", "Invoice total"], ["hsn", "HSN / SAC"], ["qty", "Quantity"], ["ledger", "Ledger (a hint)"],
  ["doctype", "Document type"], ["against", "Against invoice no."]];
const SHEET_AMOUNTS = ["taxable", "igst", "cgst", "sgst", "cess", "tax", "total", "qty"];

const SheetFmt = {
  norm(h){ return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9%]+/g, ""); },
  // a cell that reads as a number (₹, Rs., commas; (1,234.50) and 1,234.50- are negative)
  amount(v, opts){
    if (typeof v === "number") return v;
    let s = String(v == null ? "" : v).trim();
    if (!s) return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)){ neg = true; s = s.slice(0, -1); }
    if (/\bcr\.?$/i.test(s) && opts && opts.crNegative){ neg = true; }
    s = s.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/\s*(dr|cr)\.?$/i, "").replace(/[,\s₹]/g, "");
    if (/^-/.test(s)){ neg = !neg; s = s.slice(1); }
    const n = Number(s);
    return isNaN(n) ? 0 : (neg ? -n : n);
  },
  // a date as yyyy-mm-dd; order "dmy" (Indian, the default), "mdy" or "ymd" for the ambiguous ones
  date(v, order){
    if (v == null || v === "") return "";
    if (typeof v === "number" && v > 20000 && v < 80000){ const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
    if (order !== "mdy" && typeof Market === "object" && !(v instanceof Date && order === "mdy")) { const m = Market.date(v); if (m) return m; }
    const s = String(v).trim(), m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m){ const y = m[3].length === 2 ? "20" + m[3] : m[3], a = m[1].padStart(2, "0"), b = m[2].padStart(2, "0"); return order === "mdy" ? y + "-" + a + "-" + b : y + "-" + b + "-" + a; }
    return "";
  },
  // the header row: the first of the first 15 rows with three or more words in it, most of its cells not figures
  head(grid){
    for (let i = 0; i < Math.min(15, grid.length); i++){
      const r = (grid[i] || []).map(c => String(c == null ? "" : c).trim()), words = r.filter(c => /[a-z]/i.test(c) && !/^[\d,.\-()₹\s]+$/.test(c));
      if (words.length >= 3 && words.length >= r.filter(Boolean).length * 0.6) return i;
    }
    return 0;
  },
  fingerprint(head, sheet){
    const names = (head || []).map(h => this.norm(h));
    const sh = String(sheet || "").toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, "");
    return "f" + fpHash(names.join("|") + "#" + names.length + "#" + sh);
  },
  // the client's and the firm's saved formats (not deleted), newest first
  saved(cid){
    const co = CO(cid) || {}, firm = (S.firm && S.firm.sheetFormats) || [];
    return [].concat(co.sheetFormats || [], firm).filter(f => f && !f.deleted).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  },
  // the official and marketplace formats FinCom knows by its own rules (no AI, no saving)
  builtin(head, side){
    const kind = typeof Market === "object" ? Market.detect(head) : "";
    if (kind && side === "sales") return {id: "builtin:" + kind, name: ({amazon: "Amazon tax report", flipkart: "Flipkart sales report", shopify: "Shopify orders", generic: "GST sales register"})[kind], builtin: kind, side: "sales"};
    const h = head.map(x => this.norm(x)), has = n => h.some(x => x === n || x.includes(n));
    // GSTR-2B / 2A Excel (B2B sheet): GSTIN of supplier, Trade/Legal name, Invoice number, Invoice Date, Invoice Value, Place of supply, Taxable Value, Integrated Tax…
    if (side === "purchase" && has("gstinofsupplier") && has("invoicenumber") && (has("integratedtax") || has("integratedtaxrs"))){
      const map = {gstin: "gstinofsupplier", party: h.find(x => x.includes("tradelegalname") || x.includes("tradename") || x.includes("legalname")) || "", no: "invoicenumber",
        date: h.find(x => x.startsWith("invoicedate")) || "", total: h.find(x => x.startsWith("invoicevalue")) || "", pos: h.find(x => x.startsWith("placeofsupply")) || "",
        taxable: h.find(x => x.startsWith("taxablevalue")) || "", rate: h.find(x => x.startsWith("rate")) || "", igst: h.find(x => x.startsWith("integratedtax")) || "",
        cgst: h.find(x => x.startsWith("centraltax")) || "", sgst: h.find(x => x.startsWith("statetax") || x.startsWith("stateuttax")) || "", cess: h.find(x => x.startsWith("cess")) || ""};
      return {id: "builtin:2b-excel", name: "GSTR-2B / 2A (Excel)", builtin: "2b-excel", side: "purchase", map, transforms: {date: "dmy", groupByNo: true}};
    }
    return null;
  },
  // a known format for this header: {fmt, how: "builtin" | "known" | "drift"} or null
  find(head, sheet, cid, side){
    const b = this.builtin(head, side);
    if (b) return {fmt: b, how: "builtin"};
    const fp = this.fingerprint(head, sheet), list = this.saved(cid).filter(f => !side || !f.side || f.side === side);
    const same = list.find(f => f.fp === fp);
    if (same) return {fmt: same, how: "known"};
    const names = new Set(head.map(h => this.norm(h)));
    // drift: every column the saved mapping reads is still here by name, and at most three columns more or fewer
    const near = list.find(f => { const used = Object.values(f.map || {}).filter(Boolean); return used.length >= 3 && used.every(n => names.has(n)) && Math.abs((f.cols || 0) - head.length) <= 3; });
    return near ? {fmt: near, how: "drift"} : null;
  },
  // what the AI is shown: the header, and up to 10 rows with every identifier, name and long number masked
  masked(head, rows){
    const map = new Map(), tok = (kind, v) => { const k = kind + "|" + v; if (!map.has(k)) map.set(k, kind + "_" + (Array.from(map.keys()).filter(x => x.startsWith(kind + "|")).length + 1)); return map.get(k); };
    const cell = (v) => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      let s = String(v == null ? "" : v).trim();
      if (!s) return "";
      s = s.replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, m => tok("GSTIN", m.toUpperCase())).replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, m => tok("PAN", m.toUpperCase()))
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, m => tok("EMAIL", m)).replace(/(?<![\d.,])\+?\d{10,13}(?![\d.,])/g, m => tok("PHONE", m));
      // words that are not a date, a code or a figure: a name (a party, an item): masked, its shape kept
      if (/[a-z]{3}/i.test(s) && !/^(GSTIN|PAN|EMAIL|PHONE)_\d+$/.test(s) && !this.date(s) && !/^[A-Z]{1,4}[-\/]?\d/.test(s)) return tok("TEXT", s);
      return s;
    };
    return {head: head.map(h => String(h == null ? "" : h)), rows: rows.slice(0, 10).map(r => (r || []).map(cell))};
  },
  // a register's fields, or (vendor / customer) a party statement's (below)
  fieldsFor(side){ return (side === "vendor" || side === "customer") && typeof PARTY_FIELDS !== "undefined" ? PARTY_FIELDS : SHEET_FIELDS; },
  // a new format's mapping: asked of the AI once (SheetAI, the firm's assistant on the cheap model), never a figure
  async propose(head, rows, side){
    const m = this.masked(head, rows);
    if (typeof SheetAI !== "object" || !SheetAI.map) throw new Error("FinCom's AI help is not available here: map the columns yourself.");
    const FL = this.fieldsFor(side);
    const r = await SheetAI.map({head: m.head, rows: m.rows, side, fields: FL.map(f => f[0])});
    const names = head.map(h => this.norm(h)), map = {};
    Object.entries((r && r.map) || {}).forEach(([field, col]) => {
      if (!FL.some(f => f[0] === field)) return;
      const i = typeof col === "number" ? col : names.indexOf(this.norm(col));
      if (i >= 0 && names[i]) map[field] = names[i];
    });
    return {map, transforms: Object.assign({date: "dmy", groupByNo: true}, (r && r.transforms) || {}), skip: (r && r.skip) || [], why: (r && r.why) || {}, cost: (r && r.cost) || null};
  },
  // the documents a mapped sheet holds: one per invoice number (lines of one invoice added up), totals and blank rows
  // skipped; FinCom's rules work out the tax split, the place of supply, the totals and the check to the paisa
  apply(fmt, grid, hi, co, side){
    if (fmt.builtin && fmt.side === "sales" && fmt.builtin !== "2b-excel") return Market.read(grid.slice(hi), fmt.builtin).map(x => this.fromMarket(x));
    const head = (grid[hi] || []).map(h => this.norm(h)), map = fmt.map || {}, t = fmt.transforms || {};
    const col = f => map[f] ? head.indexOf(map[f]) : -1, idx = {};
    SHEET_FIELDS.forEach(([f]) => { idx[f] = col(f); });
    const get = (r, f) => idx[f] >= 0 ? r[idx[f]] : "";
    const home = stateOfGstin(co && co.gstin);
    const docs = new Map(), skipped = [];
    grid.slice(hi + 1).forEach((r, n) => {
      if (!r || !r.some(c => String(c == null ? "" : c).trim())) return;
      const no = String(get(r, "no") || "").trim(), first = String(r.find(c => String(c == null ? "" : c).trim()) || "");
      if (!no || /^(grand\s*)?total|^sub\s*total|^net\s*total/i.test(first)){ skipped.push({row: hi + 2 + n, why: /total/i.test(first) ? "a total row" : "no invoice number"}); return; }
      const typ = String(get(r, "doctype") || "").toLowerCase();
      const credit = /credit|cn\b|return|refund/.test(typ), debit = !credit && /debit|dn\b/.test(typ);
      const key = no + "|" + (credit ? "C" : debit ? "D" : "I") + (t.groupByNo === false ? "|" + n : "");
      const a = f => this.amount(get(r, f));
      const d = docs.get(key) || {no, date: this.date(get(r, "date"), t.date), party: String(get(r, "party") || "").trim(), gstin: String(get(r, "gstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
        pos: this.pos(get(r, "pos")), hsn: String(get(r, "hsn") || "").trim(), ledger: String(get(r, "ledger") || "").trim(), against: String(get(r, "against") || "").trim(),
        note: credit ? "credit" : debit ? "debit" : "", taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0, rates: [], lines: 0, rows: [], lineTotals: []};
      let taxable = a("taxable"), igst = a("igst"), cgst = a("cgst"), sgst = a("sgst"), cess = a("cess"), total = a("total");
      const rate = this.amount(get(r, "rate"));
      // one tax column: split by the place of supply (the same state as the client: CGST + SGST, else IGST)
      if (idx.tax >= 0 && !igst && !cgst && !sgst){
        const tax = a("tax"), pos = d.pos || stateOfGstin(d.gstin);
        const inter = side === "sales" ? (pos && home && pos !== home) : (stateOfGstin(d.gstin) && home && stateOfGstin(d.gstin) !== home);
        if (inter) igst = tax; else { cgst = r2(tax / 2); sgst = r2(tax - cgst); }
      }
      // no taxable column: the rate and the total tell it
      if (!taxable && total && rate) taxable = r2(total / (1 + rate / 100));
      const sign = credit && [taxable, total].every(x => x >= 0) ? -1 : 1;
      d.taxable = r2(d.taxable + sign * taxable); d.igst = r2(d.igst + sign * igst); d.cgst = r2(d.cgst + sign * cgst); d.sgst = r2(d.sgst + sign * sgst); d.cess = r2(d.cess + sign * cess);
      d.lineTotals = (d.lineTotals || []).concat([sign * total]);
      if (rate && !d.rates.includes(rate)) d.rates.push(rate);
      d.lines++; d.rows.push(hi + 2 + n);
      docs.set(key, d);
    });
    const out = Array.from(docs.values()).map(d => this.finish(d));
    out.skipped = skipped;
    return out;
  },
  pos(v){
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const m = s.match(/^(\d{1,2})\b/); if (m) return m[1].padStart(2, "0");
    const k = Object.entries(GST_STATES).find(([, n]) => s.toLowerCase().replace(/[^a-z]/g, "").startsWith(String(n).toLowerCase().replace(/[^a-z]/g, "")));
    return k ? k[0] : "";
  },
  // the figures, checked: taxable + tax = total to the paisa (a round-off of up to ₹1 is said, not an error)
  finish(d){
    const tax = r2(d.igst + d.cgst + d.sgst + d.cess);
    // the lines' totals: added up, unless every line repeats the invoice's value (2B and many registers do): then once
    if (d.lineTotals){
      const lt = d.lineTotals, sum = r2(lt.reduce((a, x) => a + x, 0));
      const same = lt.length > 1 && lt.every(x => Math.abs(x - lt[0]) < 0.005) && Math.abs(lt[0] - r2(d.taxable + tax)) <= 1;
      d.total = same ? lt[0] : sum;
      delete d.lineTotals;
    }
    if (!d.total) d.total = r2(d.taxable + tax);
    d.rate = d.taxable ? Math.round((d.igst + d.cgst + d.sgst) / d.taxable * 10000) / 100 : (d.rates[0] || 0);
    const diff = r2(d.total - d.taxable - tax);
    d.check = Math.abs(diff) < 0.005 ? {ok: true} : Math.abs(diff) <= 1 ? {ok: true, roundOff: diff} : {ok: false, diff, text: "Taxable " + d.taxable.toFixed(2) + " + tax " + tax.toFixed(2) + " is " + r2(d.taxable + tax).toFixed(2) + ", not the total " + d.total.toFixed(2)};
    if (!d.pos) d.pos = stateOfGstin(d.gstin);
    return d;
  },
  fromMarket(x){ return this.finish({no: x.no, date: x.date, party: x.party, gstin: x.gstin, pos: this.pos(x.pos), hsn: x.hsn, ledger: "", against: x.against || "", note: x.note || "",
    taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, cess: x.cess, total: x.total, rates: x.rate ? [x.rate] : [], lines: x.lines, rows: [], market: x.market}); },
  // a file: a sheet (xlsx, xls, csv, a PDF table) or JSON (GSTR-1, GSTR-2B, or another portal's)
  async read(file){
    const name = String(file.name || "").toLowerCase();
    if (/\.json$/.test(name) || /json/.test(file.type || "")){
      let j; try { j = JSON.parse(await file.text()); } catch (e){ throw new Error(file.name + " is not readable JSON."); }
      return this.fromJson(j);
    }
    if (/\.(xlsx|xls)$/.test(name)){
      await ensureXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
      // the sheet with the most rows that has a header (2B's "B2B" before its "Read me")
      const sheets = wb.SheetNames.map(n => ({n, grid: XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: true, defval: ""})}));
      const best = sheets.filter(s => s.grid.length > 1).sort((a, b) => b.grid.length - a.grid.length)[0] || sheets[0];
      return {kind: "grid", grid: best.grid, sheet: best.n};
    }
    if (/\.pdf$/.test(name)) return {kind: "grid", grid: await this.pdfGrid(file), sheet: "pdf"};
    return {kind: "grid", grid: this.csv(await file.text()), sheet: ""};
  },
  csv(text){
    const first = String(text).split(/\r?\n/)[0] || "", sep = (first.match(/\t/g) || []).length > 1 ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    return String(text).split(/\r?\n/).filter(l => l.trim()).map(line => {
      const out = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++){ const ch = line[i];
        if (ch === '"'){ if (q && line[i + 1] === '"'){ cur += '"'; i++; } else q = !q; }
        else if (ch === sep && !q){ out.push(cur); cur = ""; } else cur += ch; }
      out.push(cur); return out;
    });
  },
  // a PDF table: each line of text, its cells where two or more spaces (or a wide gap) part them
  async pdfGrid(file){
    const pdf = await getPdf(file), lines = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 50); p++){
      const tc = await (await pdf.getPage(p)).getTextContent(), rows = [];
      // the pieces of text in rows (as pageTextLines groups them), then cells where a gap wider than a space parts them
      for (const it of tc.items || []){
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
        let row = rows.find(r => Math.abs(r.y - y) <= Math.max(r.h, h) * 0.5);
        if (!row){ row = {y, h, items: []}; rows.push(row); }
        row.items.push({x, s: it.str, w: it.width || 0});
      }
      rows.sort((a, b) => b.y - a.y).forEach(r => {
        r.items.sort((a, b) => a.x - b.x);
        const cells = []; let cur = null;
        r.items.forEach(it => { const gap = cur ? it.x - cur.end : Infinity;
          if (cur && gap <= Math.max(4, r.h * 0.6)){ cur.s += (gap > r.h * 0.15 ? " " : "") + it.s; cur.end = it.x + it.w; }
          else { cur = {s: it.s, end: it.x + it.w}; cells.push(cur); } });
        const row = cells.map(c => c.s.replace(/\s+/g, " ").trim()).filter(x => x !== "");
        if (row.length) lines.push(row);
      });
    }
    return lines;
  },
  // JSON: the GST portal's own (by rules), or another's: its longest list of records, each flattened to paths
  fromJson(j){
    const d = (j && j.data) || j || {};
    if (d.docdata || (d.rtnprd && (d.itcsumm || d.cpsumm))) return {kind: "gstr2b", json: j};
    if (j && j.gstin && j.fp && ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "at", "txpd", "nil", "hsn", "doc_issue"].some(k => k in j)) return {kind: "gstr1", json: j};
    let best = null;
    const walk = (o, path) => {
      if (Array.isArray(o)){ if (o.length && o.every(x => x && typeof x === "object" && !Array.isArray(x)) && (!best || o.length > best.list.length)) best = {list: o, path}; o.forEach((x, i) => i < 3 && walk(x, path + "[]")); }
      else if (o && typeof o === "object") Object.entries(o).forEach(([k, v]) => walk(v, path ? path + "." + k : k));
    };
    walk(j, "");
    if (!best) throw new Error("No list of records was found in that JSON.");
    const flat = (o, pre, out) => { Object.entries(o || {}).forEach(([k, v]) => { const p = pre ? pre + "." + k : k; if (v && typeof v === "object" && !Array.isArray(v)) flat(v, p, out); else if (!Array.isArray(v)) out[p] = v; }); return out; };
    const recs = best.list.map(x => flat(x, "", {})), keys = [];
    recs.forEach(r => Object.keys(r).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    return {kind: "grid", grid: [keys].concat(recs.map(r => keys.map(k => r[k] == null ? "" : r[k]))), sheet: "json:" + best.path};
  },
  // GSTR-2B JSON (GST2B.fromJson, the GST tab's own reader, only read): one purchase document per row; ITC not available
  // (itcavl N, with its reason) is said on the document
  from2b(j){
    const r = GST2B.fromJson(j);
    return r.rows.filter(x => !x.rej).map(x => this.finish({no: x.no, date: x.date ? x.date.slice(0, 4) + "-" + x.date.slice(4, 6) + "-" + x.date.slice(6, 8) : "", party: x.party, gstin: x.gstin, pos: String(x.pos || "").padStart(2, "0").replace(/^00$/, ""),
      hsn: "", ledger: "", against: x.oNo || "", note: x.dir < 0 ? "credit" : x.sec === "cdnr" && x.typ === "D" ? "debit" : "",
      taxable: x.dir * x.taxable, igst: x.dir * x.igst, cgst: x.dir * x.cgst, sgst: x.dir * x.sgst, cess: x.dir * x.cess, total: x.dir * x.val, rates: [], lines: 1, rows: [],
      sec: x.sec, rcm: x.rcm, itc: x.itcavl === "N" ? {available: false, why: GST2B.RSN[x.rsn] || "not available in 2B"} : {available: true}, period: r.period}));
  },
  // GSTR-1 JSON (GSTAmend.norm, the GST tab's reader, only read; cdnur read here): each document; B2CS as summary rows
  // per rate and place of supply (posted as one entry each only when the panel's question is answered yes)
  from1(j){
    const n = GSTAmend.norm(j), out = [];
    n.docs.forEach(x => {
      const credit = x.kind === "CDNR" && x.ntty === "C", debit = x.kind === "CDNR" && x.ntty === "D", sg = credit ? -1 : 1;
      out.push(this.finish({no: x.num, date: x.date ? x.date.slice(0, 4) + "-" + x.date.slice(4, 6) + "-" + x.date.slice(6, 8) : "", party: "", gstin: x.ctin || "", pos: x.pos, hsn: "", ledger: "", against: "",
        note: credit ? "credit" : debit ? "debit" : "", taxable: sg * x.txval, igst: sg * x.iamt, cgst: sg * x.camt, sgst: sg * x.samt, cess: sg * x.csamt, total: sg * x.val, rates: x.rates, lines: 1, rows: [], sec: x.kind}));
    });
    (j.cdnur || []).forEach(x => { const t = (x.itms || []).reduce((a, it) => { const dd = it.itm_det || it; ["txval", "iamt", "camt", "samt", "csamt"].forEach(k => { a[k] = r2((a[k] || 0) + num(dd[k])); }); return a; }, {});
      const sg = x.ntty === "D" ? 1 : -1;
      out.push(this.finish({no: String(x.nt_num || ""), date: GSTAmend.ymd ? (d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8))(GSTAmend.ymd(x.nt_dt)) : "", party: "", gstin: "", pos: String(x.pos || "").padStart(2, "0"), hsn: "", ledger: "", against: "",
        note: sg < 0 ? "credit" : "debit", taxable: sg * (t.txval || 0), igst: sg * (t.iamt || 0), cgst: sg * (t.camt || 0), sgst: sg * (t.samt || 0), cess: sg * (t.csamt || 0), total: sg * num(x.val), rates: [], lines: 1, rows: [], sec: "CDNUR"})); });
    const fp = String(j.fp || ""), last = fp.length === 6 ? new Date(Date.UTC(num(fp.slice(2)), num(fp.slice(0, 2)), 0)).toISOString().slice(0, 10) : "";
    const b2cs = Array.from(n.b2cs.values()).map(x => this.finish({no: "B2CS/" + fp + "/" + x.pos + "/" + x.rt, date: last, party: "Retail sales (B2CS)", gstin: "", pos: x.pos, hsn: "", ledger: "", against: "",
      note: "", taxable: x.txval, igst: x.iamt, cgst: x.camt, sgst: x.samt, cess: x.csamt, total: 0, rates: [x.rt], lines: 1, rows: [], sec: "B2CS", summary: true}));
    return {docs: out, b2cs};
  }
};

// a sheet's documents become entries: Purchase → bills (newEntry, finishNewEntry: the duplicate guard), Sales → invoices
// (newInvoice, mapInvoice; an invoice number already here is not added again). Returns {added, held, again, ids}
const SheetPost = {
  partyLedger(d, side){
    const list = ((typeof B === "function" && B() && B().ledgers && B().ledgers.list) || []);
    if (d.gstin){ const g = list.filter(l => String(l.gstin || "").toUpperCase() === d.gstin); if (g.length === 1) return g[0].name; }
    const remembered = typeof choiceValue === "function" ? choiceValue(CO(), "party:" + (d.gstin || normName(d.party || ""))) : "";
    if (remembered && exactLedger(remembered)) return exactLedger(remembered);
    return d.party ? exactLedger(d.party) || "" : "";
  },
  toBills(docs, cid, fileName){
    const res = {added: 0, held: 0, ids: []};
    docs.forEach(d => {
      const e = newEntry(fileName);
      Object.assign(e.x, {vendorName: d.party, vendorGstin: d.gstin, vendorPan: d.gstin ? d.gstin.slice(2, 12) : "", invoiceNo: d.no, invoiceDate: d.date,
        taxable: Math.abs(d.taxable), cgst: Math.abs(d.cgst), sgst: Math.abs(d.sgst), igst: Math.abs(d.igst), cess: Math.abs(d.cess), total: Math.abs(d.total), hsn: d.hsn});
      if (d.note) e.noteKind = d.note;
      e.readMode = "sheet"; e.sheet = {file: fileName, rows: d.rows, check: d.check, sec: d.sec || "", itc: d.itc || null};
      if (d.itc && d.itc.available === false){ e.itcBlocked = d.itc.why; e.readNote = "ITC not available in GSTR-2B (" + d.itc.why + "): its tax is ineligible input tax."; }
      // a document that does not add up to the paisa is said on the bill, so it is looked at before it is approved
      if (d.check && !d.check.ok){ e.readNote = (e.readNote ? e.readNote + " " : "") + "From the sheet: " + d.check.text + "."; e.uncertain = ["total"]; }
      // the party: as answered in the panel (mapped, or a new ledger made when posting, as for a bill read), else matched
      e.partyLedger = d.ledger || this.partyLedger(d, "purchase") || d.newLedger || "";
      finishNewEntry(e, cid, null);
      res.ids.push(e.id);
      if (e.status === "duplicate") res.held++; else res.added++;
    });
    return res;
  },
  toSales(docs, cid, fileName){
    const s = SL(), res = {added: 0, held: 0, again: 0, ids: []};
    docs.forEach(d => {
      const no = d.no + (d.note === "credit" && !/^cn/i.test(d.no) ? " (CN)" : "");
      if (s.list.some(v => normInv(v.x.number) === normInv(no) && (!v.x.date || !d.date || v.x.date === d.date))){ res.again++; return; }
      const v = newInvoice({number: no, date: d.date, customerName: d.party || (d.gstin ? "" : "Retail customer"), customerGstin: GSTIN_RE.test(d.gstin) ? d.gstin : "", pos: d.pos,
        hsn: d.hsn, taxable: Math.abs(d.taxable), cgst: Math.abs(d.cgst), sgst: Math.abs(d.sgst), igst: Math.abs(d.igst), cess: Math.abs(d.cess), total: Math.abs(d.total),
        rate: d.rate, noteKind: d.note || "", againstInvoice: d.against || ""}, "sheet", {fileName, sheet: {rows: d.rows, check: d.check, sec: d.sec || ""}});
      const led = d.ledger || this.partyLedger(d, "sales");
      if (led){ v.customerLedger = led; v.userLedger = true; }
      // a customer to create: the bank page's list of new ledgers (made in Tally with the first posting, as today)
      else if (d.newLedger && typeof B === "function" && B() && B().newLed && !B().newLed.some(l => l.name === d.newLedger))
        B().newLed.push({name: d.newLedger, group: "Sundry Debtors", gstin: GSTIN_RE.test(d.gstin) ? d.gstin : "", state: stateOfGstin(d.gstin)});
      s.list.push(v); mapInvoice(v); res.added++; res.ids.push(v.id);
    });
    saveSales();
    return res;
  }
};

// the AI's half: the firm's assistant function (server/assistant, action "sheet_map"), on the cheap model, under the
// firm's AI switch, consent and rupee cap; it sees the header and 10 masked rows, and answers a mapping, never a figure
const SheetAI = {
  calls: 0,
  async map(req){
    if (!(typeof Cloud === "object" && Cloud.on())) throw new Error("Sign in to the firm account to have FinCom's AI read a new format; or map the columns yourself.");
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess();
    const r = await fetch(String(c.url || "").replace(/\/+$/, "") + "/functions/v1/fincom-assistant", {method: "POST",
      headers: {apikey: c.key, Authorization: "Bearer " + (s && s.access_token), "Content-Type": "application/json"},
      body: JSON.stringify({action: "sheet_map", client_id: S.coId || null, head: req.head, rows: req.rows, side: req.side, fields: req.fields})});
    const j = await r.json().catch(() => ({}));
    this.calls++;
    if (!r.ok || !j.ok) throw new Error(j.error || ("FinCom's AI could not read the format (" + r.status + "). Map the columns yourself."));
    return j;
  }
};

// The panel (app/src/parts/SheetPanel.jsx) over Purchase or Sales: S.sheetImp =
//   {side, name, read, head, hi, how, fmt, map, transforms, why, docs, b2cs, questions, answers, step, busy, err, result}
// step: "map" (a new or changed format: the mapping, shown once, to confirm or change), "check" (the documents and the
// questions), "done". A file of a known format goes straight to "check", with no AI call.
const SheetImport = {
  isSheet(f){ return isSheetFile(f); },
  st(){ return S.sheetImp || null; },
  close(){ S.sheetImp = null; if (typeof closeDetail === "function" && detailOpen("sheet") != null) closeDetail(); else render(); },
  async start(files, side, opts){
    const f = [].concat(files)[0];
    if (!f) return;
    const rest = [].concat(files).slice(1);
    const st = S.sheetImp = {side, name: f.name, step: "read", busy: "Reading " + f.name + "…", err: "", rest, asTable: !!(opts && opts.asTable), cid: S.coId, file: f};
    if (typeof openDetail === "function") openDetail("sheet", fpHash(f.name + Date.now())); else render();
    try {
      st.read = await SheetFmt.read(f);
      if (st.read.kind !== "grid" && this.recon(side)) throw new Error("A statement of account is a sheet, a CSV or a PDF table.");
      if (st.read.kind === "gstr2b"){
        if (side !== "purchase") throw new Error("This is a GSTR-2B: upload it on Purchase.");
        st.how = "official"; st.fmtName = "GSTR-2B (JSON from the GST portal)";
        st.docs = SheetFmt.from2b(st.read.json); return this.check();
      }
      if (st.read.kind === "gstr1"){
        if (side !== "sales") throw new Error("This is a GSTR-1: upload it on Sales.");
        const r = SheetFmt.from1(st.read.json);
        st.how = "official"; st.fmtName = "GSTR-1 (JSON from the GST portal)";
        st.docs = r.docs; st.b2cs = r.b2cs; return this.check();
      }
      const g = st.read.grid || [];
      st.hi = SheetFmt.head(g); st.head = (g[st.hi] || []).map(h => String(h == null ? "" : h));
      if (st.head.filter(Boolean).length < 2) throw new Error("No header row was found in " + f.name + ".");
      const found = SheetFmt.find(st.head, st.read.sheet, S.coId, side);
      if (found){
        st.how = found.how; st.fmt = found.fmt; st.fmtName = found.fmt.name;
        if (this.recon(side)) return this.reconStep();
        st.docs = SheetFmt.apply(found.fmt, g, st.hi, CO(), side);
        return this.check();
      }
      // a format FinCom has not seen: the AI proposes a mapping, once; the person confirms or changes it
      st.busy = "A new format: FinCom's AI is reading its columns…"; render();
      let p = null;
      try { p = await SheetFmt.propose(st.head, g.slice(st.hi + 1, st.hi + 11), side); }
      catch (e){ st.aiErr = (e && e.message) || String(e); p = {map: {}, transforms: {date: "dmy", groupByNo: true}, why: {}}; }
      st.map = p.map; st.transforms = p.transforms; st.why = p.why || {}; st.aiCost = p.cost || null;
      st.fmtName = this.suggestName(f.name); st.step = "map"; st.busy = ""; render();
    } catch (e){ st.busy = ""; st.err = (e && e.message) || String(e); st.step = "error"; render(); }
  },
  suggestName(n){ return String(n || "Register").replace(/\.[a-z]+$/i, "").replace(/[_\-]+/g, " ").replace(/\s*\d{4,}.*$/, "").trim() || "Register"; },
  setMap(field, col){ const st = this.st(); if (!st) return; st.map = Object.assign({}, st.map); Object.keys(st.map).forEach(k => { if (k !== field && st.map[k] === col && col) delete st.map[k]; });
    if (col) st.map[field] = col; else delete st.map[field]; render(); },
  setTransform(k, v){ const st = this.st(); if (!st) return; st.transforms = Object.assign({}, st.transforms, {[k]: v}); render(); },
  // a format needs at least an invoice number and an amount (the total, or the taxable value)
  mapProblems(){ const st = this.st() || {}, m = st.map || {}; const p = [];
    if (this.recon(st.side)){ if (!m.date) p.push("Date"); if (!(m.debit && m.credit) && !m.amount) p.push("Debit and Credit (or one Amount)"); return p; }
    if (!m.no) p.push("Invoice no."); if (!m.total && !m.taxable) p.push("Invoice total or Taxable value"); if (!m.date) p.push("Invoice date"); return p; },
  recon(side){ return side === "vendor" || side === "customer"; },
  // a party's statement: read by its format, then the party and the period are asked (FinCom's guess shown), then reconciled
  reconStep(){
    const st = this.st(), co = CO(st.cid);
    st.stmt = PartyRecon.statement(st.fmt, st.read.grid, st.hi);
    const dates = st.stmt.rows.map(x => x.date).filter(Boolean).sort();
    st.from = st.from || dates[0] || ""; st.to = st.to || dates[dates.length - 1] || "";
    st.party = PartyRecon.guessParty(st.read.grid, st.hi, co, st.side);
    st.ledger = st.party.ledger || "";
    const last = st.ledger ? PartyRecon.lastFor(st.side, st.ledger) : null;
    st.prev = last ? {to: last.to, at: last.at} : null;
    st.step = "party"; st.busy = ""; render();
  },
  setParty(k, v){ const st = this.st(); if (!st) return; st[k] = v; render(); },
  reconcile(){
    const st = this.st(); if (!st) return;
    const led = exactLedger(st.ledger);
    if (!led){ toast("Choose the party's ledger as it is in the books."); return; }
    if (!st.from || !st.to || st.from > st.to){ toast("Choose the period: from, and up to."); return; }
    const run = PartyRecon.save({side: st.side, ledger: led, from: st.from, to: st.to, stmt: st.stmt, fileName: st.name, fmtId: st.fmt && st.fmt.id, fmtName: st.fmtName, how: st.how, file: st.file});
    if (st.party && !st.party.sure && st.party.key) choiceConfirm(CO(st.cid), "party:" + st.party.key, led);
    S.sheetImp = null; S.reconRun = run.id; openDetail("recon", run.id);
    const rest = st.rest || [];
    if (rest.length) setTimeout(() => this.start(rest, st.side), 300);
  },
  // Save: the format is kept for the client, named, with who and when; then the sheet is read by it
  saveFormat(scope){
    const st = this.st(), co = CO(st.cid); if (!st || !co) return;
    if (this.mapProblems().length) { toast("Choose the column for: " + this.mapProblems().join(", ") + "."); return; }
    const head = st.head, fmt = {id: uid("sf"), name: String(st.fmtName || "Register").slice(0, 60), side: st.side, fp: SheetFmt.fingerprint(head, st.read.sheet), cols: head.length,
      headers: head.map(h => SheetFmt.norm(h)), map: st.map, transforms: st.transforms, by: whoAmI(), at: new Date().toISOString(), ai: !st.aiErr, scope: scope === "firm" ? "firm" : "client"};
    if (fmt.scope === "firm"){ S.firm.sheetFormats = (S.firm.sheetFormats || []).concat([fmt]); Store.saveFirm(); }
    else { co.sheetFormats = (co.sheetFormats || []).concat([fmt]); Store.saveCompany(co); }
    st.fmt = fmt; st.how = "saved";
    if (this.recon(st.side)) return this.reconStep();
    st.docs = SheetFmt.apply(fmt, st.read.grid, st.hi, co, st.side);
    this.check();
  },
  // the documents made: the questions they raise, asked in the panel; nothing is added until "Add to To review"
  check(){
    const st = this.st(); if (!st) return;
    st.step = "check"; st.busy = "";
    st.answers = st.answers || {};
    const qs = [], seen = new Set();
    if (st.b2cs && st.b2cs.length) qs.push({id: "b2cs", kind: "b2cs", text: "GSTR-1 has " + st.b2cs.length + " B2CS summary row" + (st.b2cs.length === 1 ? "" : "s") + " (sales to consumers, by rate and place of supply). Post B2CS as one summary entry per rate / place of supply?", options: [["yes", "Yes, one entry each"], ["no", "No, leave them out"]]});
    const blocked = (st.docs || []).filter(d => d.itc && d.itc.available === false);
    if (blocked.length) qs.push({id: "itc", kind: "itc", text: blocked.length + " document" + (blocked.length === 1 ? "" : "s") + " in 2B give no input tax credit (" + Array.from(new Set(blocked.map(d => d.itc.why))).join("; ") + "). Book their tax as ineligible ITC (part of the cost), or leave them out?",
      options: [["ineligible", "Book as ineligible ITC"], ["skip", "Leave them out"]]});
    (st.docs || []).forEach(d => {
      const key = d.gstin || normName(d.party || "");
      if (!key || seen.has(key) || d.summary) return;
      seen.add(key);
      if (!SheetPost.partyLedger(d, st.side)) qs.push({id: "party:" + key, kind: "party", party: d.party || d.gstin, gstin: d.gstin, text: "Party “" + (d.party || d.gstin) + "”" + (d.gstin ? " (" + d.gstin + ")" : "") + " is not in Tally.", options: [["create", "Create it"], ["map", "Map to a ledger…"]]});
    });
    st.questions = qs; render();
  },
  answer(id, v, ledger){
    const st = this.st(); if (!st) return;
    st.answers = Object.assign({}, st.answers, {[id]: {v, ledger: ledger || ""}});
    const q = (st.questions || []).find(x => x.id === id);
    // a party's answer is remembered for the client (a choice, as every confirmed ledger is)
    if (q && q.kind === "party" && v === "map" && ledger && exactLedger(ledger)) choiceConfirm(CO(st.cid), "party:" + id.slice(6), exactLedger(ledger));
    render();
  },
  open(){ const st = this.st(); return (st && st.questions || []).filter(q => !(st.answers || {})[q.id] || (st.answers[q.id].v === "map" && !st.answers[q.id].ledger)); },
  // the documents that go in, after the answers
  docsToAdd(){
    const st = this.st(); if (!st) return [];
    const a = st.answers || {};
    let docs = (st.docs || []).slice();
    if (a.itc && a.itc.v === "skip") docs = docs.filter(d => !(d.itc && d.itc.available === false));
    if (st.b2cs && a.b2cs && a.b2cs.v === "yes") docs = docs.concat(st.b2cs);
    docs.forEach(d => {
      const k = d.gstin || normName(d.party || ""), ans = a["party:" + k];
      if (ans && ans.v === "create" && !d.ledger) d.newLedger = d.party || d.gstin;
      if (ans && ans.v === "map" && ans.ledger) d.ledger = exactLedger(ans.ledger) || ans.ledger;
    });
    return docs;
  },
  add(){
    const st = this.st(); if (!st) return;
    if (this.open().length){ toast("Answer the questions first."); return; }
    const docs = this.docsToAdd(), cid = st.cid;
    const r = st.side === "sales" ? SheetPost.toSales(docs, cid, st.name) : SheetPost.toBills(docs, cid, st.name);
    st.result = r; st.step = "done"; render();
    const rest = st.rest || [];
    if (rest.length) setTimeout(() => this.start(rest, st.side), 300);
  },
  // the formats list (Client setup → Sheet formats): rename, delete with a reason (kept, soft), map again
  rename(id, name){ const f = this.fmtById(id); if (f){ f.name = String(name || f.name).slice(0, 60); this.saveFmt(f); } },
  async remove(id){
    const f = this.fmtById(id); if (!f) return;
    const r = await askConfirm({title: "Delete the format “" + f.name + "”?", danger: true, ok: "Delete",
      body: '<p>It is kept, marked deleted, with who and why. The next sheet of this format asks for its columns again.</p><label class="f"><span>Why</span><input type="text" id="sfWhy"></label>',
      read: () => (document.getElementById("sfWhy") || {}).value || "", validate: (v) => String(v || "").trim() ? "" : "Say why."});
    const why = r && r.data;
    if (!why) return;
    f.deleted = {at: new Date().toISOString(), by: whoAmI(), why: String(why).slice(0, 200)}; this.saveFmt(f);
  },
  // map again: the next sheet of this format is asked about once more (its mapping is put aside, kept)
  remap(id){ const f = this.fmtById(id); if (!f) return; f.deleted = {at: new Date().toISOString(), by: whoAmI(), why: "mapped again"}; this.saveFmt(f); toast("The next upload of this format asks for its columns again."); },
  fmtById(id){ const co = CO() || {}; return (co.sheetFormats || []).concat((S.firm && S.firm.sheetFormats) || []).find(f => f.id === id) || null; },
  saveFmt(f){ if (f.scope === "firm"){ Store.saveFirm(); } else Store.saveCompany(CO()); render(); }
};

/* ================================================================== */
/* A vendor's or customer's statement against its ledger in the books */
/* ================================================================== */
// The owner (14-Oct-2026): "Vendor reconciliation and customer reconciliation should come under the Reconciliation tab.
// We can upload any format, purchase and sale. AI will read that format once and after that it will use memory. Prepare
// a proper reconciliation. If the opening has a difference, then also show it in the difference."
//
// The party's statement (its ledger of the client, or a balance confirmation) in any format: read by the sheet engine
// (SheetFmt, above: fingerprint, the AI's mapping once, saved, then rules) with the statement's own fields
// (PARTY_FIELDS); against the party's ledger in FinCom's copy of the books (Tally or Zoho: LK.ledgerBooks), seen from
// both sides (their debit is our credit). Every figure is FinCom's: the AI only maps columns.
//   PartyRecon.statement(fmt, grid, hi)   → {open, rows: [{date, no, narr, dr, cr, tds, gst}], close}   (their side)
//   PartyRecon.run({side, ours, theirs})  → {open, matched, oursOnly, theirsOnly, differs, tds, gst, statement}
// In a run every amount is in OUR view and signed so a party's normal balance is positive: for a vendor what we owe
// (credit), for a customer what is owed to us (debit).

const PARTY_FIELDS = [["date", "Date"], ["no", "Document no."], ["narration", "Particulars / narration"], ["debit", "Debit"], ["credit", "Credit"],
  ["amount", "Amount (one signed column)"], ["drcr", "Dr / Cr"], ["balance", "Balance"], ["tds", "TDS"], ["gst", "GST"]];
const RECON_TOL = {days: 7, rupees: 1};

const PartyRecon = {
  // their statement, read by a mapping (their side: their debit, their credit); the opening line and a closing line found
  statement(fmt, grid, hi){
    const head = (grid[hi] || []).map(h => SheetFmt.norm(h)), map = fmt.map || {}, t = fmt.transforms || {};
    const idx = {}; PARTY_FIELDS.forEach(([f]) => { idx[f] = map[f] ? head.indexOf(map[f]) : -1; });
    const get = (r, f) => idx[f] >= 0 ? r[idx[f]] : "", a = (r, f) => SheetFmt.amount(get(r, f));
    let open = null, close = null, lastBal = null;
    const rows = [];
    grid.slice(hi + 1).forEach((r, n) => {
      if (!r || !r.some(c => String(c == null ? "" : c).trim())) return;
      const narr = String(get(r, "narration") || "").trim(), text = r.map(c => String(c == null ? "" : c)).join(" ");
      let dr = a(r, "debit"), cr = a(r, "credit");
      if (idx.amount >= 0 && !dr && !cr){ const v = a(r, "amount"), side = String(get(r, "drcr") || "").trim().toLowerCase();
        if (/^c/.test(side)) cr = Math.abs(v); else if (/^d/.test(side)) dr = Math.abs(v); else if (v < 0) cr = -v; else dr = v; }
      // a negative in the debit column is a credit (a statement that writes reversals so)
      if (dr < 0){ cr = r2(cr - dr); dr = 0; } if (cr < 0){ dr = r2(dr - cr); cr = 0; }
      const balRaw = get(r, "balance"), bal = idx.balance >= 0 && String(balRaw == null ? "" : balRaw).trim() !== "" ? this.signed(balRaw) : null;
      if (/opening|b\/f|brought\s*forward|balance\s*b\/d/i.test(narr || text)){ open = bal != null ? bal : r2(dr - cr); return; }
      if (/closing|c\/f|carried\s*forward|balance\s*c\/d/i.test(narr || text)){ close = bal != null ? bal : r2(dr - cr); return; }
      if (/^(grand\s*)?total/i.test(String(r.find(c => String(c == null ? "" : c).trim()) || ""))) return;
      if (!dr && !cr) return;
      const date = SheetFmt.date(get(r, "date"), t.date);
      rows.push({date, no: String(get(r, "no") || "").trim(), narr, dr: r2(dr), cr: r2(cr), tds: Math.abs(a(r, "tds")), gst: Math.abs(a(r, "gst")), row: hi + 2 + n});
      if (bal != null) lastBal = bal;
    });
    const moved = r2(rows.reduce((s, x) => s + x.dr - x.cr, 0));
    // the opening: as the statement says; else what its first balance implies
    if (open == null){ const first = rows[0]; open = first && idx.balance >= 0 && lastBal != null ? null : 0; if (open == null) open = 0; }
    if (close == null) close = lastBal != null ? lastBal : r2(open + moved);
    return {open: r2(open), rows, close: r2(close), moved};
  },
  // a balance written "12,345.00 Dr" / "Cr" / "-12,345" (their side: debit positive)
  signed(v){ const s = String(v == null ? "" : v); const n = Math.abs(SheetFmt.amount(s)); return /cr\.?\s*$/i.test(s.trim()) || (SheetFmt.amount(s) < 0 && !/dr\.?\s*$/i.test(s.trim())) ? -n : n; },
  // the document numbers a line carries: its own, and those in its narration
  refs(x){ const out = new Set(); [x.no].concat(typeof VR === "object" ? VR.refs(x.narr || "") : []).filter(Boolean).forEach(t => { const n = normInv(t); if (n) out.add(n); }); return out; },
  days(a, b){ return a && b ? Math.abs((Date.parse(a) - Date.parse(b)) / 86400000) : 999; },
  // ours: the ledger's lines (LK.ledgerBooks rows: dr, cr from our books), with the TDS and GST of the voucher
  oursFrom(st, side){
    const tdsL = /tds|tax\s*deducted/i, gstL = /\b(i|c|s|ut)?gst\b|input\s*tax|output\s*tax/i;
    return {open: side === "vendor" ? -num(st.open) : num(st.open), rows: (st.rows || []).map(v => {
      const tds = r2(Math.abs((v.ent || []).filter(e => tdsL.test(e.l)).reduce((s, e) => s + e.a, 0)));
      const gst = r2(Math.abs((v.ent || []).filter(e => gstL.test(e.l) && !tdsL.test(e.l)).reduce((s, e) => s + e.a, 0)));
      return {id: v.id, date: v.date, no: v.no || "", narr: [v.type, v.narr].filter(Boolean).join(": "), dr: v.dr, cr: v.cr, tds, gst};
    }), close: st.close == null ? null : (side === "vendor" ? -num(st.close) : num(st.close))};
  },
  // the reconciliation. ours: {open, rows: [{date, no, narr, dr, cr, tds, gst}], close} in our books (dr/cr ours);
  // theirs: the statement (dr/cr theirs). side "vendor" | "customer"
  run({side, ours, theirs, explained}){
    const v = side !== "customer";
    // in our view, the party's normal balance positive: a vendor's credit, a customer's debit
    const oAmt = x => r2(v ? x.cr - x.dr : x.dr - x.cr), tAmt = x => r2(v ? x.dr - x.cr : x.cr - x.dr);
    const O = ours.rows.map((x, i) => Object.assign({k: "o" + i, amt: oAmt(x), refs: this.refs(x)}, x));
    const T = theirs.rows.map((x, i) => Object.assign({k: "t" + i, amt: tAmt(x), refs: this.refs(x)}, x));
    const oOpen = r2(v ? num(ours.open) : num(ours.open)), tOpen = r2(v ? num(theirs.open) : -num(theirs.open));
    const oClose = ours.close != null ? r2(ours.close) : r2(oOpen + O.reduce((s, x) => s + x.amt, 0));
    const tClose = r2(v ? num(theirs.close) : -num(theirs.close));
    const used = new Set(), matched = [], differs = [], tdsDiff = [], gstDiff = [];
    const pair = (o, t, how) => {
      used.add(o.k); used.add(t.k);
      const diff = r2(t.amt - o.amt), late = this.days(o.date, t.date);
      if (Math.abs(diff) <= RECON_TOL.rupees && late <= RECON_TOL.days){ matched.push({o, t, how, diff}); }
      // TDS we deducted that they do not show: their figure is ours plus our TDS
      else if (o.tds && Math.abs(diff - o.tds) <= RECON_TOL.rupees){ matched.push({o, t, how, diff: 0}); tdsDiff.push({kind: "ours", o, t, amt: r2(diff), text: "TDS deducted by us, not shown by them"}); }
      else differs.push({o, t, how, diff, late: Math.round(late), text: Math.abs(diff) > RECON_TOL.rupees ? (late > RECON_TOL.days ? "a different amount and date" : "a different amount") : "a different date"});
      if (o.gst || t.gst){ const g = r2((t.gst || 0) - (o.gst || 0)); if (t.gst && Math.abs(g) > RECON_TOL.rupees) gstDiff.push({o, t, amt: g, text: "GST " + money(t.gst) + " in theirs, " + money(o.gst) + " in ours"}); }
    };
    // 1. by document number
    T.forEach(t => { if (!t.refs.size) return; const o = O.find(x => !used.has(x.k) && Math.sign(x.amt) === Math.sign(t.amt) && [...t.refs].some(r => x.refs.has(r))); if (o) pair(o, t, "number"); });
    // 2. by amount and date, within ±7 days and ±₹1 (the nearest date first)
    T.filter(t => !used.has(t.k)).forEach(t => {
      const c = O.filter(x => !used.has(x.k) && Math.abs(x.amt - t.amt) <= RECON_TOL.rupees && this.days(x.date, t.date) <= RECON_TOL.days).sort((a, b) => this.days(a.date, t.date) - this.days(b.date, t.date))[0];
      if (c) pair(c, t, "amount and date");
    });
    // 3. what is left: theirs only (TDS lines of theirs said apart), ours only
    const theirsOnly = [], oursOnly = O.filter(x => !used.has(x.k));
    T.filter(t => !used.has(t.k)).forEach(t => { if (/\btds\b|tax\s*deducted/i.test(t.narr + " " + t.no)) tdsDiff.push({kind: "theirs", t, amt: t.amt, text: "TDS shown by them, not in our books"}); else theirsOnly.push(t); });
    const ex = explained || {}, keyOf = (x) => (x.o ? x.o.k : "") + "|" + (x.t ? x.t.k : "") + (x.k || "");
    // the statement: closing as per our books, each difference grouped, = closing as per the party; what is left unexplained
    const sum = (l, f) => r2(l.reduce((s, x) => s + f(x), 0));
    const lines = [
      ["open", "Difference in opening balance", r2(tOpen - oOpen)],
      ["theirsOnly", "In their books, not in ours", sum(theirsOnly, x => x.amt)],
      ["oursOnly", "In our books, not in theirs", -sum(oursOnly, x => x.amt)],
      ["differs", "The same entry with a different amount", sum(differs, x => x.diff)],
      ["tds", "TDS: deducted by one side, not shown by the other", sum(tdsDiff, x => x.amt)],
      ["round", "Matched within ₹" + RECON_TOL.rupees, sum(matched, x => x.diff)],
    ].filter(l => Math.abs(l[2]) >= 0.005);
    const explainedTo = r2(oClose + lines.reduce((s, l) => s + l[2], 0));
    return {side, oOpen, tOpen, oClose, tClose, matched, differs, oursOnly, theirsOnly, tds: tdsDiff, gst: gstDiff, explainedKeys: Object.keys(ex),
      statement: {ours: oClose, lines, theirs: tClose, unexplained: r2(tClose - explainedTo)}, keyOf};
  }
};

// the party, from the lines above the statement's header (its name, GSTIN or PAN; not the client's own), matched to a
// ledger of the books: by GSTIN or PAN (sure), by a remembered answer (sure), by name (a guess to confirm)
PartyRecon.guessParty = function(grid, hi, co, side){
  const top = grid.slice(0, Math.max(hi, 1)).map(r => (r || []).map(c => String(c == null ? "" : c)).join(" ")).join("\n");
  const own = String(co && co.gstin || "").toUpperCase();
  const gstins = (top.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g) || []).filter(g => g !== own);
  const pans = (top.toUpperCase().match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || []).filter(p => !own || own.slice(2, 12) !== p);
  const list = (typeof B === "function" && B() && B().ledgers && B().ledgers.list) || (typeof VR === "object" ? VR.ledgers() : []);
  const g = gstins[0] || "", hitG = g && list.find(l => String(l.gstin || "").toUpperCase() === g);
  if (hitG) return {ledger: hitG.name, sure: true, how: "GSTIN " + g, key: g};
  const p = pans[0] || (g ? g.slice(2, 12) : ""), hitP = p && list.find(l => String(l.gstin || "").toUpperCase().slice(2, 12) === p || String(l.pan || "").toUpperCase() === p);
  if (hitP) return {ledger: hitP.name, sure: true, how: "PAN " + p, key: p};
  const lines = top.split("\n").map(l => l.replace(/gstin.*$/i, "").replace(/statement of account.*$/i, "").trim()).filter(l => l.length >= 3 && !(co && normName(l) === normName(co.name)));
  const key = g || p || normName(lines[0] || "");
  const remembered = key && typeof choiceValue === "function" ? choiceValue(co, "party:" + key) : "";
  if (remembered && exactLedger(remembered)) return {ledger: exactLedger(remembered), sure: true, how: "your answer before", key};
  let best = null;
  lines.forEach(l => list.forEach(x => { const sc = typeof nameSim === "function" ? nameSim(l, x.name) : (normName(l) === normName(x.name) ? 1 : 0); if (sc >= 0.8 && (!best || sc > best.sc)) best = {sc, name: x.name}; }));
  return best ? {ledger: best.name, sure: false, how: "name", key} : {ledger: "", sure: false, how: "", key, name: lines[0] || ""};
};
// our side: the party's ledger in FinCom's copy of the books (Tally or Zoho), for the period
PartyRecon.ours = function(side, ledger, from, to){ return this.oursFrom(LK.ledgerBooks(ledger, from, to), side); };
// a run, kept on the client (co.reconRuns, riding its sync): the party, the period, the file, the statement read, the notes;
// the result is worked out again whenever it is opened, from the books as they are then
PartyRecon.save = function(o){
  const co = CO(), run = {id: uid("rr"), side: o.side, ledger: o.ledger, from: o.from, to: o.to, file: o.fileName, fmtId: o.fmtId || "", fmtName: o.fmtName || "", how: o.how || "",
    stmt: {open: o.stmt.open, close: o.stmt.close, rows: o.stmt.rows}, notes: {}, by: whoAmI(), at: new Date().toISOString()};
  // next month starts from the last one: its notes come along (an entry explained then stays explained)
  const last = this.lastFor(o.side, o.ledger);
  if (last){ run.prev = last.id; run.notes = Object.assign({}, last.notes || {}); }
  co.reconRuns = [run].concat(co.reconRuns || []);
  if (o.file && typeof FileStore === "object") { try { FileStore.put(co.id, "recon:" + run.id, o.file); } catch (e){} }
  Store.saveCompany(co);
  return run;
};
PartyRecon.runs = function(side){ return ((CO() || {}).reconRuns || []).filter(r => !r.deleted && (!side || r.side === side)); };
PartyRecon.byId = function(id){ return ((CO() || {}).reconRuns || []).find(r => r.id === id) || null; };
// the last run of the same party: next month starts from it (its period after, its notes kept for the same entries)
PartyRecon.lastFor = function(side, ledger){ return this.runs(side).find(r => r.ledger === ledger) || null; };
PartyRecon.result = function(run){
  let ours;
  try { ours = this.ours(run.side, run.ledger, run.from, run.to); } catch (e){ return {error: "The books for " + run.ledger + " could not be read here: " + ((e && e.message) || e)}; }
  return this.run({side: run.side, ours, theirs: run.stmt, explained: run.notes});
};
// an item's key, the same whenever the run is worked out again (its document, date and amount)
PartyRecon.itemKey = function(x){ const a = x.o || x, b = x.t || null; return [a && a.date, a && (a.no || ""), a && (a.amt != null ? a.amt : ""), b && b.date, b && (b.no || ""), b && b.amt].join("|"); };
PartyRecon.explain = function(runId, key, note){ const r = this.byId(runId); if (!r) return; r.notes = Object.assign({}, r.notes); if (note) r.notes[key] = {note: String(note).slice(0, 300), by: whoAmI(), at: new Date().toISOString()}; else delete r.notes[key]; Store.saveCompany(CO()); render(); };
// a line in their books and not in ours: a suggestion, made an entry to review on Purchase or Sales (never posted by itself)
PartyRecon.createEntry = function(run, t){
  const cid = S.coId, amt = Math.abs(t.amt), no = t.no || "", date = t.date || run.to;
  if (run.side === "vendor"){
    const e = newEntry("Reconciliation with " + run.ledger);
    Object.assign(e.x, {vendorName: run.ledger, invoiceNo: no, invoiceDate: date, taxable: amt, total: amt, description: t.narr || ""});
    if (t.amt < 0) e.noteKind = "debit";
    e.partyLedger = run.ledger; e.readMode = "recon"; e.readNote = "Suggested by the reconciliation with " + run.ledger + ": in their statement, not in the books. Check it before approving.";
    finishNewEntry(e, cid, null); toast("Added to Purchase → To review: " + (no || run.ledger) + ". Nothing is posted until it is approved.");
  } else {
    if (typeof SL !== "function" || !SL() || SL().cid !== cid){ toast("Open Sales once, then use Create entry again."); return; }
    const v = newInvoice({number: no || "REC-" + date, date, customerName: run.ledger, taxable: amt, total: amt, noteKind: t.amt < 0 ? "credit" : ""}, "recon", {fileName: run.file});
    v.customerLedger = run.ledger; v.userLedger = true; SL().list.push(v); mapInvoice(v); saveSales();
    toast("Added to Sales → To review: " + (no || run.ledger) + ". Nothing is posted until it is approved.");
  }
  const r = this.byId(run.id); if (r){ r.notes = Object.assign({}, r.notes, {[this.itemKey(t)]: {note: "Entry made for review", by: whoAmI(), at: new Date().toISOString(), entry: true}}); Store.saveCompany(CO()); }
  render();
};
// the reconciliation as a workbook: the statement, then each kind of difference (Excel)
PartyRecon.xlsx = async function(run, res){
  await ensureXlsx();
  const st = res.statement, wb = XLSX.utils.book_new(), d = (x) => x ? fmtDate(x) : "";
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Reconciliation: " + run.ledger, ""], ["Period", d(run.from) + " to " + d(run.to)], [],
    ["Closing as per our books", st.ours]].concat(st.lines.map(l => [(l[2] >= 0 ? "Add: " : "Less: ") + l[1], l[2]])).concat([["Closing as per " + run.ledger, st.theirs], ["Unexplained difference", st.unexplained]])), "Statement");
  const rows = (l, f) => l.map(f);
  const add = (name, head, l) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(l)), name.slice(0, 31));
  add("Ours only", ["Date", "No.", "Particulars", "Amount", "Note"], rows(res.oursOnly, x => [d(x.date), x.no, x.narr, x.amt, ((run.notes || {})[this.itemKey(x)] || {}).note || ""]));
  add("Theirs only", ["Date", "No.", "Particulars", "Amount", "Note"], rows(res.theirsOnly, x => [d(x.date), x.no, x.narr, x.amt, ((run.notes || {})[this.itemKey(x)] || {}).note || ""]));
  add("Different amount or date", ["Our date", "Our no.", "Ours", "Their date", "Their no.", "Theirs", "Difference"], rows(res.differs, x => [d(x.o.date), x.o.no, x.o.amt, d(x.t.date), x.t.no, x.t.amt, x.diff]));
  add("TDS", ["Side", "No.", "Amount", "What"], rows(res.tds, x => [x.kind === "ours" ? "ours" : "theirs", (x.t || x.o).no, x.amt, x.text]));
  add("GST", ["No.", "Difference", "What"], rows(res.gst, x => [x.t.no, x.amt, x.text]));
  add("Matched", ["Our date", "Our no.", "Ours", "Their date", "Their no.", "Theirs", "How"], rows(res.matched, x => [d(x.o.date), x.o.no, x.o.amt, d(x.t.date), x.t.no, x.t.amt, x.how]));
  XLSX.writeFile(wb, "Reconciliation " + run.ledger.replace(/[^\w ]+/g, "") + " " + run.from + " to " + run.to + ".xlsx");
};
// a balance confirmation letter to the party, as a Word document (.doc: Word opens it as written)
PartyRecon.letterDoc = function(run, res){
  const co = CO(), bal = res.statement.ours, v = run.side !== "customer";
  const words = Math.abs(bal) < 0.005 ? "nil" : "₹" + INR.format(Math.abs(bal)) + " " + ((bal > 0) === v ? "payable by us to you" : "receivable by us from you");
  const html = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Balance confirmation</title></head><body style="font-family:Calibri,Arial;font-size:11pt">' +
    "<p><b>" + esc(co.name) + "</b>" + (co.gstin ? "<br>GSTIN " + esc(co.gstin) : "") + "</p><p>Date: " + fmtDate(new Date().toISOString().slice(0, 10)) + "</p><p>To<br><b>" + esc(run.ledger) + "</b></p>" +
    "<p><b>Subject: Confirmation of balance as on " + fmtDate(run.to) + "</b></p><p>Dear Sir or Madam,</p>" +
    "<p>As per our books, the balance of your account as on " + fmtDate(run.to) + " is " + esc(words) + ". Please confirm it, or send us your statement of our account for the period " + fmtDate(run.from) + " to " + fmtDate(run.to) + " if it differs.</p>" +
    (res.statement.lines.length ? "<p>Your statement shows " + "₹" + INR.format(Math.abs(res.statement.theirs)) + ". The differences we found:</p><ul>" + res.statement.lines.map(l => "<li>" + esc(l[1]) + ": ₹" + INR.format(Math.abs(l[2])) + "</li>").join("") + "</ul>" : "") +
    "<p>Thank you.</p><p>For " + esc(co.name) + "<br><br><br>Authorised signatory</p>" +
    "<hr><p>We confirm the balance of ₹ ____________ " + (v ? "receivable from" : "payable to") + " " + esc(co.name) + " as on " + fmtDate(run.to) + ".</p><p>Signature and stamp: ____________________</p></body></html>";
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿", html], {type: "application/msword"}));
  a.download = "Balance confirmation " + run.ledger.replace(/[^\w ]+/g, "") + " " + run.to + ".doc"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return html;
};
// pick a statement to read
function reconPickFile(side){
  let el = document.getElementById("reconIn");
  if (!el){ el = document.createElement("input"); el.type = "file"; el.id = "reconIn"; el.hidden = true; el.multiple = true; el.accept = ".xlsx,.xls,.csv,.pdf,.txt"; document.body.appendChild(el); }
  el.onchange = () => { const files = Array.from(el.files || []); el.value = ""; if (files.length) SheetImport.start(files, side === "customer" ? "customer" : "vendor"); };
  el.click();
}

Object.assign(window, {SHEET_FIELDS, SHEET_AMOUNTS, SheetFmt, SheetPost, SheetAI, SheetImport, PARTY_FIELDS, RECON_TOL, PartyRecon, reconPickFile});
