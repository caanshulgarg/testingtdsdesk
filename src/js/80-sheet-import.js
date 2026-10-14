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
  // a register's fields, or (vendor / customer) a party statement's (src/js/81)
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
      const c = await (await pdf.getPage(p)).getTextContent(), rows = new Map();
      c.items.forEach(it => { const y = Math.round(it.transform[5]); const r = rows.get(y) || []; r.push({x: it.transform[4], w: it.width || 0, s: it.str}); rows.set(y, r); });
      Array.from(rows.keys()).sort((a, b) => b - a).forEach(y => {
        const r = rows.get(y).sort((a, b) => a.x - b.x), cells = []; let cur = null;
        r.forEach(it => { if (cur && it.x - (cur.x + cur.w) < 6){ cur.s += (it.x - (cur.x + cur.w) > 1.5 ? " " : "") + it.s; cur.w = it.x + it.w - cur.x; } else { cur = {x: it.x, w: it.w, s: it.s}; cells.push(cur); } });
        const row = cells.map(c2 => c2.s.trim()).filter(x => x !== "");
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
const SHEET_EXT = /\.(xlsx|xls|csv|json|txt)$/i;
const SheetImport = {
  isSheet(f){ return SHEET_EXT.test(String(f && f.name || "")) || /json|csv|spreadsheet|excel/.test(String(f && f.type || "")); },
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
