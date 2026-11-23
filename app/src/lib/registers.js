// Registers on Purchase and Sales (any sheet, a PDF table or JSON) and Reconciliations → Vendors / Customers: the engine.
// Loaded when first used (window.loadRegisters, app/src/main.jsx; registersLoad in src/js/82-registers.js), so the
// program every page loads stays within its budget. It runs on the program's globals (S, CO, num, r2, Market, GST2B,
// GSTAmend, LK, …) and puts its own on window, where the program and the screens find them.
// It was src/js/81-sheet-import.js and 82-party-recon.js; the two parts follow as they were.
// (VR.refs, the document numbers in a narration: the vendor reconciliation, loaded with it)
import "./vendorRecon.js";
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
  ["tax", "Total tax (one column)"], ["total", "Invoice total"], ["hsn", "HSN / SAC"], ["qty", "Quantity"], ["ledger", "Party's ledger in Tally"],
  ["sledger", "Sales / purchase ledger"], ["doctype", "Document type (invoice / credit note)"], ["vchtype", "Voucher type (information only)"], ["against", "Against invoice no."],
  ["owngstin", "Our GSTIN (the client's registration)"], ["branch", "Branch / series"], ["regtype", "Party's registration (regular / unregistered)"],
  ["rcm", "Reverse charge (Y / N)"], ["itc", "ITC available (Y / N)"]];
// (rcm, itc: next-fix-audit-imports, Purchase only: a bill under reverse charge books the tax as payable by the client
// and as its input credit; one with no credit (GSTR-2B's ITC Availability "No") books its tax as part of the cost)
// (regtype, next-fix-sales-upload: a row it calls unregistered or a consumer never takes a GSTIN from the party's Tally
// ledger; mapped by a person, the AI is not asked for it)
// (owngstin, branch: next-fix-igst-pick, 16-Nov-2026: the client's own registration an invoice is issued from picks its
// output GST ledgers by state, src/js/25-sales.js taxLedgerPick)
// next-fix-sheet-import (13-Nov-2026, a client's sales sheet that would not post): "ledger" was "Ledger (a hint)" and was
// taken as the PARTY's ledger, so a "Sales Ledger" column put the income ledger in the customer's place on every invoice,
// and "Voucher Type" (the client's own "Sales UP") was only looked at for credit / debit. Now a field each: the party's
// ledger (ledger) and the sales or purchase ledger (sledger).
// The voucher type (the owner's decision, 13-Nov-2026) is the screen's, never the sheet's column: an upload on Sales
// posts as the Sales screen's type ("Sales", or the one in Sales settings), an upload on Purchase as "Purchase". A
// column mapped as the document type tells a credit or debit note by its words (credit note, CN, CRN, return; debit note,
// DN, DBN), nothing more; one mapped as a voucher type (vchtype) is kept as information and tells nothing.
const SIDE_LEDGER = {sales: "Sales ledger", purchase: "Purchase / expense ledger"};
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
  // a date as yyyy-mm-dd; order "dmy" (Indian, the default), "mdy" or "ymd" for the ambiguous ones. A real date cell
  // (a Date, an Excel day number) is its own day whatever the order; a day or a month out of range is no date ("")
  // (next-fix-audit-imports: 05/09/26 was read month first, and "mdy" blanked every real date cell)
  date(v, order){
    if (v == null || v === "") return "";
    if (typeof v === "number" && v > 20000 && v < 80000){ const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
    // (review of e7bf15906: "ymd" was read as "dmy": 26/09/05 year first is 5 September 2026; a four-figure year first,
    // 2026/09/05, Market.date reads in any order)
    if (v instanceof Date || (order !== "mdy" && order !== "ymd")) return Market.date(v);
    const s = String(v).trim(), m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?!\d)/);
    return !m ? Market.date(s) : order === "ymd" ? (m[3].length === 2 ? Market.iso(m[3], m[2], m[1]) : "") : Market.iso(m[2], m[1], m[3]);
  },
  // the header row: the first of the first 15 rows with three or more words in it, most of its cells not figures
  // A header on two rows (GSTR-2B's "Invoice Details" over "Invoice number | Invoice type | …", merged cells): the row
  // below, all words, naming columns the upper row leaves blank, is joined to it (the lower name where it has one) and
  // that joined row is the header (next-fix-audit-imports: the upper row alone was taken, and 2B was not known)
  head(grid){
    const cells = i => (grid[i] || []).map(c => String(c == null ? "" : c).trim()), word = c => /[a-z]/i.test(c) && !/^[\d,.\-()₹\s]+$/.test(c);
    for (let i = 0; i < Math.min(15, grid.length); i++){
      const r = cells(i), words = r.filter(word);
      if (!(words.length >= 3 && words.length >= r.filter(Boolean).length * 0.6)) continue;
      const lo = cells(i + 1), filled = lo.filter(Boolean);
      if (filled.length >= 2 && filled.every(c => word(c) && !/\d{2}[A-Z]{5}\d{4}/i.test(c)) && lo.some((c, k) => c && !r[k]) && (grid[i + 1] || []).every(c => !(c instanceof Date) && typeof c !== "number")){
        grid[i + 1] = Array.from({length: Math.max(r.length, lo.length)}, (x, k) => lo[k] || r[k] || "");
        return i + 1;
      }
      return i;
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
    const kind = MarketRead.detect(head);
    if (kind && side === "sales") return {id: "builtin:" + kind, name: ({amazon: "Amazon tax report", flipkart: "Flipkart sales report", shopify: "Shopify orders", generic: "GST sales register"})[kind], builtin: kind, side: "sales"};
    const h = head.map(x => this.norm(x)), has = n => h.some(x => x === n || x.includes(n));
    // GSTR-2B / 2A Excel (B2B sheet): GSTIN of supplier, Trade/Legal name, Invoice number, Invoice Date, Invoice Value, Place of supply, Taxable Value, Integrated Tax…
    // (next-fix-audit-imports) its B2B-CDNR sheet too (Note number, Note type, Note date, Note Value: credit notes reversed,
    // a supplier's debit note added), with the reverse charge and ITC availability columns read
    const note = has("notenumber") && !has("invoicenumber");
    if (side === "purchase" && has("gstinofsupplier") && (has("invoicenumber") || note) && (has("integratedtax") || has("integratedtaxrs"))){
      const f = p => h.find(x => x.startsWith(p)) || "";
      const map = {gstin: "gstinofsupplier", party: h.find(x => x.includes("tradelegalname") || x.includes("tradename") || x.includes("legalname")) || "", no: note ? "notenumber" : "invoicenumber",
        date: f(note ? "notedate" : "invoicedate"), total: f(note ? "notevalue" : "invoicevalue"), pos: f("placeofsupply"), doctype: note ? f("notetype") : "",
        taxable: f("taxablevalue"), rate: f("rate"), igst: f("integratedtax"), rcm: f("supplyattractreversecharge") || f("reversecharge"), itc: f("itcavailability"), itcwhy: f("reason"),
        cgst: f("centraltax"), sgst: h.find(x => x.startsWith("statetax") || x.startsWith("stateuttax")) || "", cess: f("cess")};
      return {id: "builtin:2b-excel", name: "GSTR-2B / 2A (Excel)", builtin: "2b-excel", side: "purchase", map, transforms: {date: "dmy", groupByNo: true, twoB: true}};
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
  // next-fix-sheetgst (17-Nov-2026): a saved layout made before the sheet had a GSTIN column, read by it as "drift", dropped
  // the column without a word. The columns a field is known by, sure enough to read with no question (the party's GSTIN only)
  // (by side, review of 2b565f7e7: a sales sheet's party is the customer, a purchase register's the supplier; "Buyer
  // GSTIN" on a purchase register is the client's own)
  SURE: {sales: {gstin: ["gstin", "gstinuin", "gstno", "gstnumber", "customergstin", "partygstin", "buyergstin", "recipientgstin"]},
    purchase: {gstin: ["gstin", "gstinuin", "gstno", "suppliergstin", "vendorgstin", "partygstin", "sellergstin"]}},
  // the client's own GSTINs: its GSTIN and its other GSTINs (salesOwnGstins, src/js/25, where the Sales page is loaded)
  own(cid){
    let l = [];
    try { if (typeof salesOwnGstins === "function" && typeof SL === "function" && SL()) l = salesOwnGstins(); } catch (e){}
    const co = CO(cid) || {}, more = [co.gstin].concat(String(co.otherGstins || "").toUpperCase().match(/\b\d{2}[A-Z0-9]{13}\b/g) || [], co.gstins || []);
    return Array.from(new Set(l.concat(more).map(g => String(g || "").toUpperCase().trim()).filter(Boolean)));
  },
  // a saved format met with columns it was not saved with (fmt.headers): those a field is surely known by, read by it
  // (added: {field: column}; a field or a column the format already uses is never taken, nor a GSTIN column whose values
  // are mostly the client's own GSTINs), the others named (other). null when nothing is new. The saved format itself is
  // not changed
  grow(fmt, head, rows, own, side){
    if (!fmt || fmt.builtin || !Array.isArray(fmt.headers)) return null;
    const map = fmt.map || {}, used = new Set(Object.values(map).filter(Boolean)), had = new Set(fmt.headers), added = {}, other = [];
    const sure = this.SURE[(side || fmt.side) === "purchase" ? "purchase" : "sales"], mine = new Set((own || []).map(g => String(g || "").toUpperCase()));
    const ownCol = i => { const v = (rows || []).map(r => String((r || [])[i] == null ? "" : r[i]).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
      return v.length > 0 && v.filter(g => mine.has(g)).length * 2 >= v.length; };
    head.map(x => this.norm(x)).forEach((n, i) => {
      if (!n || used.has(n) || had.has(n) || other.includes(n) || Object.values(added).includes(n)) return;
      const f = Object.keys(sure).find(k => sure[k].includes(n));
      if (f && !map[f] && !added[f] && !(f === "gstin" && ownCol(i))) added[f] = n; else other.push(n);
    });
    return Object.keys(added).length || other.length ? {map: Object.assign({}, map, added), added, other} : null;
  },
  // what the AI is shown: the header, and up to 10 rows with every identifier, name and long number masked
  masked(head, rows){
    const map = new Map(), tok = (kind, v) => { const k = kind + "|" + v; if (!map.has(k)) map.set(k, kind + "_" + (Array.from(map.keys()).filter(x => x.startsWith(kind + "|")).length + 1)); return map.get(k); };
    const cell = (v) => {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      let s = String(v == null ? "" : v).trim();
      if (!s) return "";
      s = s.replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi, m => tok("GSTIN", m.toUpperCase())).replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, m => tok("PAN", m.toUpperCase()))
        .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, m => tok("EMAIL", m)).replace(/(^|[^\d.,])(\+?\d{10,13})(?![\d.,])/g, (m, p, v) => p + tok("PHONE", v));
      // words that are not a date, a code or a figure: a name (a party, an item): masked, its shape kept
      if (/[a-z]{3}/i.test(s) && !/^(GSTIN|PAN|EMAIL|PHONE)_\d+$/.test(s) && !this.date(s) && !/^[A-Z]{1,4}[-\/]?\d/.test(s)) return tok("TEXT", s);
      return s;
    };
    return {head: head.map(h => String(h == null ? "" : h)), rows: rows.slice(0, 10).map(r => (r || []).map(cell))};
  },
  // a register's fields, or (vendor / customer) a party statement's (below)
  fieldsFor(side){ return (side === "vendor" || side === "customer") && typeof PARTY_FIELDS !== "undefined" ? PARTY_FIELDS
    : SHEET_FIELDS.filter(f => side !== "purchase" ? !["rcm", "itc"].includes(f[0]) : f[0] !== "owngstin").map(f => f[0] === "sledger" && SIDE_LEDGER[side] ? ["sledger", SIDE_LEDGER[side]] : f); },
  // what a ledger of the sheet is in Tally, by its whole group chain (Ledgers.cls: a ledger under "Debtors UP" under
  // Sundry Debtors is a party; one under "Sales Local" under Sales Accounts is income); "" when Tally has no such ledger, or its
  // group is not known
  cls(name){ const e = exactLedger(name); return e && typeof Ledgers === "object" ? Ledgers.cls(null, e) : ""; },
  // FinCom's own rules over a mapping (the AI's answer, or a layout saved before 13-Nov-2026): a "ledger" column whose
  // values are not parties in Tally (none under Sundry Debtors / Creditors, and they are Tally ledgers or the header says
  // sales / purchase / income / expense) is the sales or purchase ledger. Returns the corrected mapping, or null when there is nothing to correct
  fix(map, head, rows){
    const names = (head || []).map(h => this.norm(h)), m = Object.assign({}, map);
    let changed = false;
    const li = m.ledger ? names.indexOf(m.ledger) : -1;
    if (li >= 0 && !m.sledger){
      const cl = Array.from(new Set((rows || []).map(r => String((r || [])[li] == null ? "" : r[li]).trim()).filter(Boolean))).map(v => this.cls(v));
      const says = /sale|purchase|income|expense|revenue/.test(m.ledger) && !/party|customer|supplier|vendor|buyer|debtor|creditor/.test(m.ledger);
      if (!cl.includes("party") && (says || cl.some(Boolean))){ m.sledger = m.ledger; delete m.ledger; changed = true; }
    }
    return changed ? m : null;
  },
  // a new format's mapping: asked of the AI once (SheetAI, the firm's assistant on the cheap model), never a figure
  async propose(head, rows, side){
    const m = this.masked(head, rows);
    if (typeof SheetAI !== "object" || !SheetAI.map) throw new Error("FinCom's AI help is not available here: map the columns yourself.");
    const FL = this.fieldsFor(side);
    const r = await SheetAI.map({head: m.head, rows: m.rows, side, fields: FL.map(f => f[0]).filter(f => f !== "vchtype" && f !== "regtype")});
    const names = head.map(h => this.norm(h)), map = {};
    Object.entries((r && r.map) || {}).forEach(([field, col]) => {
      if (!FL.some(f => f[0] === field)) return;
      const i = typeof col === "number" ? col : names.indexOf(this.norm(col));
      if (i >= 0 && names[i]) map[field] = names[i];
    });
    return {map: this.fix(map, head, rows) || map, transforms: Object.assign({date: "dmy", groupByNo: true}, (r && r.transforms) || {}), skip: (r && r.skip) || [], why: (r && r.why) || {}, cost: (r && r.cost) || null};
  },
  // the documents a mapped sheet holds: one per invoice number (lines of one invoice added up), totals and blank rows
  // skipped; FinCom's rules work out the tax split, the place of supply, the totals and the check to the paisa
  apply(fmt, grid, hi, co, side){
    if (fmt.builtin && fmt.side === "sales" && fmt.builtin !== "2b-excel"){
      const m = MarketRead.read(grid.slice(hi), fmt.builtin), out = m.map(x => this.fromMarket(x));
      out.skipped = (m.skipped || []).map(x => ({row: hi + x.row, why: x.why}));
      return out;
    }
    const head = (grid[hi] || []).map(h => this.norm(h)), map = fmt.map || {}, t = fmt.transforms || {};
    const col = f => map[f] ? head.indexOf(map[f]) : -1, idx = {};
    SHEET_FIELDS.forEach(([f]) => { idx[f] = col(f); });
    idx.itcwhy = col("itcwhy");
    const get = (r, f) => idx[f] >= 0 ? r[idx[f]] : "";
    const home0 = stateOfGstin(co && co.gstin);
    const docs = new Map(), skipped = [], byBase = {}, lastKey = {}, lastFy = {};
    grid.slice(hi + 1).forEach((r, n) => {
      if (!r || !r.some(c => String(c == null ? "" : c).trim())) return;
      const no = String(get(r, "no") || "").trim(), first = String(r.find(c => String(c == null ? "" : c).trim()) || "");
      // a total row: "Total" as its invoice number, or as its first cell when that is the row's label (not the party's
      // column, and no date): "Total Solutions Pvt Ltd" as the customer is an invoice (review of e7bf15906)
      const fi = r.findIndex(c => String(c == null ? "" : c).trim()), TOT = /^(grand\s*|sub\s*|net\s*)?total\b/i;
      const tot = TOT.test(no) || (TOT.test(first) && fi !== idx.party && !String(get(r, "date") == null ? "" : get(r, "date")).trim());
      if (!no || tot){ skipped.push({row: hi + 2 + n, why: tot || TOT.test(first) ? "a total row" : "no invoice number"}); return; }
      // the kind the document-type column says (the owner, 13-Nov-2026): never a voucher type's name, and by whole
      // words only ("Non-returnable" is no return, "Credit" alone no credit note). A negative total is looked at on
      // the whole invoice, once its lines are added up (below)
      const kind = t.twoB ? this.kind2b(get(r, "doctype")) : this.kind(get(r, "doctype"), side);
      // one document a number (next-fix-audit-imports: it was the number alone, so two suppliers' bill "1" became one
      // bill of the first supplier with both their figures): and its financial year (a series starts again each year,
      // Rule 46(b) CGST Rules) and, on Purchase, its supplier (the GSTIN, else the name; a row naming no party is a line
      // of the invoice above it of that number), on Sales the registration it is issued from. Rows of one sales
      // invoice that name two parties, or rows of one document with two dates, are held for a person
      const rowDate = this.date(get(r, "date"), t.date), rowG = String(get(r, "gstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), rowP = String(get(r, "party") || "").trim();
      const k0 = no + "|" + kind + "|" + String(get(r, "owngstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const fy = /^\d{4}-\d{2}/.test(rowDate) ? String(+rowDate.slice(0, 4) - (+rowDate.slice(5, 7) < 4 ? 1 : 0)) : lastFy[k0] || "";
      if (fy) lastFy[k0] = fy;
      const base = k0 + "|" + fy + (t.groupByNo === false ? "|" + n : "");
      const pkOf = (g, p) => GSTIN_RE.test(g) ? g : normName(p || "");
      let key = base;
      if (side === "purchase" && t.groupByNo !== false){
        const mine = pkOf(rowG, rowP);
        // the same supplier: the same GSTIN, or the same name where one of the two rows has no GSTIN
        const same = o => pkOf(o.gstin, o.party) === mine || (!!rowP && (!GSTIN_RE.test(rowG) || !GSTIN_RE.test(o.gstin)) && normName(o.party) === normName(rowP));
        key = !mine ? lastKey[base] || base + "|" : (byBase[base] || []).find(k => same(docs.get(k))) || base + "|" + mine;
        lastKey[base] = key;
      }
      const a = f => this.amount(get(r, f));
      const had = docs.get(key);
      if (had){
        // (the same name where one of the two rows has no GSTIN is the same party, as on Purchase: an item-wise register
        // writes the GSTIN on the invoice's first row only; the invoice takes it. Review of e7bf15906)
        const sameName = !!rowP && (!GSTIN_RE.test(rowG) || !GSTIN_RE.test(had.gstin)) && normName(had.party) === normName(rowP);
        if (side !== "purchase" && sameName && GSTIN_RE.test(rowG) && !GSTIN_RE.test(had.gstin)) had.gstin = rowG;
        if (side !== "purchase" && !sameName && (rowG || rowP) && (had.gstin || had.party) && !(GSTIN_RE.test(rowG) && rowG === had.gstin) && pkOf(rowG, rowP) !== pkOf(had.gstin, had.party))
          had.hold = had.hold || "Rows of invoice " + no + " name different parties (" + (had.party || had.gstin) + ", " + (rowP || rowG) + "): an invoice is issued to one party; check the sheet";
        if (rowDate && had.date && rowDate !== had.date) had.hold = had.hold || "Rows of " + no + " carry different dates (" + had.date + ", " + rowDate + "): check the sheet";
      } else (byBase[base] = byBase[base] || []).push(key);
      const d = had || {no, date: rowDate, party: String(get(r, "party") || "").trim(), gstin: String(get(r, "gstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
        pos: this.pos(get(r, "pos")), hsn: String(get(r, "hsn") || "").trim(), ledger: String(get(r, "ledger") || "").trim(), against: String(get(r, "against") || "").trim(),
        sledger: String(get(r, "sledger") || "").trim(), vch: String(get(r, "vchtype") || "").trim(), regType: String(get(r, "regtype") || "").trim(),
        own: /^\d{2}[A-Z0-9]{13}$/.test(String(get(r, "owngstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, "")) ? String(get(r, "owngstin")).toUpperCase().replace(/[^A-Z0-9]/g, "") : "", branch: String(get(r, "branch") || "").trim(),
        note: kind === "C" ? "credit" : kind === "D" ? "debit" : "", hold: kind === "?" ? "“" + String(get(r, "doctype")).trim() + "” on a sales sheet: is this a credit note or a debit note? Set it in the Type column" : "", taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0, rates: [], lines: 0, rows: [], lineTotals: []};
      // a date the sheet gives that is no date in the order chosen (13/09/26 as month first): held, never left blank by itself
      const dv = get(r, "date");
      if (!rowDate && idx.date >= 0 && String(dv == null ? "" : dv).trim()) d.hold = d.hold || "The date “" + String(dv).trim() + "” is not a date" + (t.date === "mdy" ? " as month / day / year" : t.date === "ymd" ? " as year / month / day" : "") + ": check the date order";
      // a date before GST began (1 July 2017, the CGST Act in force): no GST invoice; held, said so (review of e7bf15906)
      // (and one after 2035, as toIsoDate kept them before: a typed year, 2062, is asked about, never booked)
      if (rowDate && rowDate < "2017-07-01") d.hold = d.hold || "The date " + rowDate + " is before GST began (1 July 2017): check the date or the sheet";
      else if (rowDate > "2035-12-31") d.hold = d.hold || "The date " + rowDate + " is years ahead: check the date or the sheet";
      // reverse charge and input credit, as the sheet says them (GSTR-2B's "Supply Attract Reverse Charge", "ITC Availability")
      if (idx.rcm >= 0 && /^(y|yes)$/i.test(String(get(r, "rcm") || "").trim())) d.rcm = true;
      if (idx.itc >= 0 && /^(n|no)$/i.test(String(get(r, "itc") || "").trim())){ const w = String(get(r, "itcwhy") || "").trim(); d.itc = {available: false, why: w || "not available in 2B"}; }
      let taxable = a("taxable"), igst = a("igst"), cgst = a("cgst"), sgst = a("sgst"), cess = a("cess"), total = a("total");
      const rate = this.amount(get(r, "rate"));
      // one tax column: split by the place of supply (the same state as the client: CGST + SGST, else IGST)
      if (idx.tax >= 0 && !igst && !cgst && !sgst){
        const tax = a("tax"), pos = d.pos || stateOfGstin(d.gstin), home = (side === "sales" && stateOfGstin(d.own)) || home0;
        const inter = side === "sales" ? (pos && home && pos !== home) : (stateOfGstin(d.gstin) && home && stateOfGstin(d.gstin) !== home);
        if (inter) igst = tax; else { cgst = r2(tax / 2); sgst = r2(tax - cgst); }
      }
      // no taxable column: the rate and the total tell it
      if (!taxable && total && rate) taxable = r2(total / (1 + rate / 100));
      d.taxable = r2(d.taxable + taxable); d.igst = r2(d.igst + igst); d.cgst = r2(d.cgst + cgst); d.sgst = r2(d.sgst + sgst); d.cess = r2(d.cess + cess);
      d.lineTotals = (d.lineTotals || []).concat([total]);
      if (rate && !d.rates.includes(rate)) d.rates.push(rate);
      // next-fix-sales-upload (item 5): each row's own GST rate (its rate column, else its tax over its taxable value at
      // the nearest standard rate), its figures kept rate-wise: an invoice whose rows carry two rates becomes one item line
      // a rate (taxable, rate, tax), never one line at a rate that is none of them
      const rr = rate || this.rateOf(taxable, igst + cgst + sgst);
      if (taxable || igst || cgst || sgst){
        const pt = (d.parts = d.parts || {})[rr] || (d.parts[rr] = {rate: rr, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
        pt.taxable = r2(pt.taxable + taxable); pt.igst = r2(pt.igst + igst); pt.cgst = r2(pt.cgst + cgst); pt.sgst = r2(pt.sgst + sgst); pt.cess = r2(pt.cess + cess);
      }
      d.lines++; d.rows.push(hi + 2 + n);
      docs.set(key, d);
    });
    const out = Array.from(docs.values()).map(d => this.signed(this.finish(d), idx.doctype >= 0));
    out.skipped = skipped;
    return out;
  },
  // a row's GST rate from its figures: the standard rate it is at (to within 0.05%), else its own to two places
  rateOf(taxable, tax){
    if (!taxable || !tax) return 0;
    const pc = tax / taxable * 100, list = typeof SALES_RATES !== "undefined" ? SALES_RATES : [0, 0.25, 3, 5, 12, 18, 28, 40];
    const std = list.find(x => Math.abs(Math.abs(pc) - x) <= 0.05);
    return std !== undefined ? std : Math.round(Math.abs(pc) * 100) / 100;
  },
  // the kind a document-type cell says: "C" a credit note (credit note, cr note, C.N., CN, CRN, return, sales return,
  // refund), "D" a debit note (debit note, dr note, D.N., DN, DBN), "I" anything else; whole words, any case. On
  // Purchase every note is one kind: a purchase return, our debit note or the supplier's credit note is a Debit Note in
  // Tally, every line reversed (noteKind "credit", src/js/01 voucherXml). "Purchase Return" on a sales sheet is "?":
  // held for a person
  kind(v, side){
    const w = " " + String(v == null ? "" : v).toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
    const pr = / purchase returns? /.test(w), d = pr || / (debit note|dr note|dn|dbn) /.test(w), c = !d && / (credit note|cr note|cn|crn|returns?|refund) /.test(w);
    if (side === "purchase") return c || d ? "C" : "I";
    return pr ? "?" : c ? "C" : d ? "D" : "I";
  },
  // a GSTR-2B note's type: "Credit Note" reverses a bill ("C"), a supplier's "Debit Note" adds to it ("D"), else a bill
  kind2b(v){ const w = String(v == null ? "" : v).toLowerCase(); return /credit/.test(w) ? "C" : /debit/.test(w) ? "D" : "I"; },
  // an invoice's sign, on the whole invoice (its lines added up: a discount line does not make a note of it). A credit
  // note is kept negative here whichever way the sheet writes it, its net taken (the entry made takes it positive). A
  // negative invoice is a credit note only in a sheet with no document-type column; with one (blank, or "Sales") it is
  // held for a person with the reason said, never turned positive by itself
  signed(d, typed){
    if (!d.note && d.total < 0){ if (typed) d.hold = d.hold || "Negative amount: is this a return? Set it in the Type column"; else d.note = "credit"; }
    if (d.note === "credit" && d.total > 0) this.flip(d);
    return d;
  },
  // a document's figures the other way round (its rate-wise item lines with them)
  flip(d){
    ["taxable", "igst", "cgst", "sgst", "cess", "total"].forEach(k => { d[k] = r2(-d[k]); });
    (d.items || []).forEach(it => ["taxable", "igst", "cgst", "sgst", "cess", "tax"].forEach(k => { it[k] = r2(-it[k]); }));
  },
  // a state by its ISO 3166-2:IN code (Shopify's "MH", "KA"), as its GST state code
  ISO: Object.fromEntries("AN35 AP37 AR12 AS18 BR10 CH04 CG22 CT22 DN26 DD26 DH26 DL07 GA30 GJ24 HR06 HP02 JK01 JH20 KA29 KL32 LA38 LD31 MP23 MH27 MN14 ML17 MZ15 NL13 OR21 OD21 PY34 PB03 RJ08 SK11 TN33 TS36 TG36 TR16 UP09 UK05 UT05 WB19".split(" ").map(x => [x.slice(0, 2), x.slice(2)])),
  pos(v){
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const iso = s.toUpperCase().match(/^(?:IN-)?([A-Z]{2})$/); if (iso) return this.ISO[iso[1]] || "";
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
    // rows at more than one rate: one item line a rate, each with its own taxable value and tax (posted as the sales
    // voucher of several rates: a sales ledger and its tax a rate, src/js/25 salesLines)
    const parts = Object.values(d.parts || {}).filter(p => p.taxable || p.igst || p.cgst || p.sgst);
    delete d.parts;
    if (parts.length > 1) d.items = parts.sort((a, b) => a.rate - b.rate).map(p => Object.assign(p, {tax: r2(p.igst + p.cgst + p.sgst)}));
    d.rate = d.taxable ? Math.round((d.igst + d.cgst + d.sgst) / d.taxable * 10000) / 100 : (d.rates[0] || 0);
    const diff = r2(d.total - d.taxable - tax);
    d.check = Math.abs(diff) < 0.005 ? {ok: true} : Math.abs(diff) <= 1 ? {ok: true, roundOff: diff} : {ok: false, diff, text: "Taxable " + d.taxable.toFixed(2) + " + tax " + tax.toFixed(2) + " is " + r2(d.taxable + tax).toFixed(2) + ", not the total " + d.total.toFixed(2)};
    // (posFromGstin: worked out here, not the sheet's own; SheetPost.notOwn takes it away with an own GSTIN)
    if (!d.pos){ d.pos = stateOfGstin(d.gstin); if (d.pos) d.posFromGstin = true; }
    return d;
  },
  fromMarket(x){ return this.finish({no: x.no, date: x.date, party: x.party, gstin: x.gstin, pos: this.pos(x.pos), hsn: x.hsn, ledger: "", against: x.against || "", note: x.note || "",
    taxable: x.taxable, igst: x.igst, cgst: x.cgst, sgst: x.sgst, cess: x.cess, total: x.total, rates: x.rate ? [x.rate] : [], lines: x.lines, rows: [], market: x.market, tcs: x.tcs || 0, hold: x.hold || ""}); },
  // a file: a sheet (xlsx, xls, csv, a PDF table) or JSON (GSTR-1, GSTR-2B, or another portal's)
  async read(file){
    const name = String(file.name || "").toLowerCase();
    if (/\.json$/.test(name) || /json/.test(file.type || "")){
      let j; try { j = JSON.parse(await file.text()); } catch (e){ throw new Error(file.name + " is not readable JSON."); }
      return this.fromJson(j);
    }
    if (/\.(xlsx|xls)$/.test(name)){
      await ensureXlsx();
      // (xlsxBook, src/js/20: an HTML, XML or text file called .xls has its cells as written: 05/09/26 is not read
      // US-style, nor invoice 00123 as 123; xlsxRows: a sheet's rows up to its last cell with a value, not a range a
      // formatted cell stretches to row 1,048,576)
      const wb = xlsxBook(await file.arrayBuffer(), {cellDates: true});
      const sheets = wb.SheetNames.map(n => ({n, grid: xlsxRows(wb.Sheets[n], {}, true)}));
      // a GSTR-2B workbook: its B2B sheet and its B2B-CDNR sheet (credit and debit notes) are both read; its amendment
      // sheets (B2BA, CDNRA) are named, to be looked at by a person, never posted by themselves
      const by = re => sheets.find(x => re.test(String(x.n).trim()) && x.grid.length > 1);
      const b2b = by(/^b2b$/i), cdnr = by(/^b2b[\s-]*cdnr$/i);
      if (b2b || cdnr){
        const main = b2b || cdnr, more = b2b && cdnr ? [{sheet: cdnr.n, grid: cdnr.grid}] : [];
        // (review of e7bf15906: IMPG is the import of goods, no amendment; its amendments IMPGA, IMPGSEZA, ISDA are. The
        // sheets FinCom does not read - imports, ISD credits, the operator's 9(5) supplies - are named apart: notRead)
        const filled = x => x.grid.slice(SheetFmt.head(x.grid) + 1).some(r => (r || []).some(c => String(c == null ? "" : c).trim()));
        const amend = sheets.filter(x => /^(b2ba|b2b[\s-]*cdnra|ecoa|impga|impgseza|isda)$/i.test(String(x.n).trim()) && filled(x)).map(x => x.n);
        const notRead = sheets.filter(x => /^(impg|impgsez|isd|eco)$/i.test(String(x.n).trim()) && filled(x)).map(x => x.n);
        return {kind: "grid", grid: main.grid, sheet: main.n, more, amend, notRead};
      }
      // the sheet with the most rows that has a header
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
    const n = GSTAmend.norm(j), out = [], own = /^\d{2}[A-Z0-9]{13}$/.test(String(j.gstin || "").toUpperCase()) ? String(j.gstin).toUpperCase() : "";
    n.docs.forEach(x => {
      const credit = x.kind === "CDNR" && x.ntty === "C", debit = x.kind === "CDNR" && x.ntty === "D", sg = credit ? -1 : 1;
      out.push(this.finish({no: x.num, date: x.date ? x.date.slice(0, 4) + "-" + x.date.slice(4, 6) + "-" + x.date.slice(6, 8) : "", party: "", gstin: x.ctin || "", pos: x.pos, hsn: "", ledger: "", against: "",
        note: credit ? "credit" : debit ? "debit" : "", taxable: sg * x.txval, igst: sg * x.iamt, cgst: sg * x.camt, sgst: sg * x.samt, cess: sg * x.csamt, total: sg * x.val, rates: x.rates, lines: 1, rows: [], sec: x.kind, own}));
    });
    (j.cdnur || []).forEach(x => { const t = (x.itms || []).reduce((a, it) => { const dd = it.itm_det || it; ["txval", "iamt", "camt", "samt", "csamt"].forEach(k => { a[k] = r2((a[k] || 0) + num(dd[k])); }); return a; }, {});
      const sg = x.ntty === "D" ? 1 : -1;
      out.push(this.finish({no: String(x.nt_num || ""), date: GSTAmend.ymd ? (d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8))(GSTAmend.ymd(x.nt_dt)) : "", party: "", gstin: "", pos: String(x.pos || "").padStart(2, "0"), hsn: "", ledger: "", against: "",
        note: sg < 0 ? "credit" : "debit", taxable: sg * (t.txval || 0), igst: sg * (t.iamt || 0), cgst: sg * (t.camt || 0), sgst: sg * (t.samt || 0), cess: sg * (t.csamt || 0), total: sg * num(x.val), rates: [], lines: 1, rows: [], sec: "CDNUR", own})); });
    const fp = String(j.fp || ""), last = fp.length === 6 ? new Date(Date.UTC(num(fp.slice(2)), num(fp.slice(0, 2)), 0)).toISOString().slice(0, 10) : "";
    const b2cs = Array.from(n.b2cs.values()).map(x => this.finish({no: "B2CS/" + fp + "/" + x.pos + "/" + x.rt, date: last, party: "Retail sales (B2CS)", gstin: "", pos: x.pos, hsn: "", ledger: "", against: "",
      note: "", taxable: x.txval, igst: x.iamt, cgst: x.camt, sgst: x.samt, cess: x.csamt, total: 0, rates: [x.rt], lines: 1, rows: [], sec: "B2CS", summary: true, own}));
    return {docs: out, b2cs};
  }
};

// The marketplace reports (Amazon MTR, Flipkart, Shopify) and the GST sales register by FinCom's own rules (no AI): one
// row per invoice line, the lines of an invoice added up. It was Market.read in src/js/26, read by the "Marketplace
// report" button too; that button now comes here through the sheet panel (next-fix-audit-imports), so every sales
// upload has one duplicate rule (SheetPost.toSales) and one place of supply rule (SheetFmt.pos).
// next-fix-audit-imports: each line keeps its own sign (a discount or adjustment line lowers the invoice; only a return,
// a refund or a cancellation makes a positive line negative); Flipkart's "Return Cancellation" undoes its return (it was a
// second credit note); an amount is never read from a rate's or a percent's column ("CGST Rate"), the invoice's total
// never from "Total Tax"; a total row is no invoice; Shopify's order figures come once an order (its Total less its
// Taxes), each tax by its own name (IGST, CGST, SGST), its financial status a question, never a credit note; Amazon's
// "Ship From State" is the seller's, never the place of supply.
const MarketRead = {
  key(x){ return String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9]/g, ""); },
  // which report is this, from the columns it has
  detect(head){
    const h = head.map(x => this.key(x)), has = n => h.some(x => x.includes(n));
    if (has("orderitemid") || has("fsn") || has("finalinvoiceamount")) return "flipkart";
    if (has("taxexclusivegross") || has("shipfromstate") || has("customerbstn") ||
        (has("transactiontype") && has("invoiceamount")) || (has("sellergstin") && has("orderid"))) return "amazon";
    if (has("lineitemprice") || (has("financialstatus") && has("lineitemname"))) return "shopify";
    if (has("invoicenumber") && has("taxablevalue")) return "generic";
    return "";
  },
  // a column by its name: an exact name first, then the first that holds it. An amount (amt) never from a rate's or a
  // percent's column, nor the invoice's total from "Total Tax" / "Total Taxable"
  pick(head, names, amt){
    const raw = head.map(x => String(x == null ? "" : x)), h = raw.map(x => this.key(x));
    for (const n of names){ const i = h.indexOf(n); if (i >= 0) return i; }
    const bad = i => amt && (/rate|%|percent/i.test(raw[i]) || (amt === "total" && /^totaltax/.test(h[i])));
    for (const n of names){ const i = h.findIndex((x, j) => x.includes(n) && !bad(j)); if (i >= 0) return i; }
    return -1;
  },
  AMOUNTS: ["taxable", "taxableParts", "cgst", "sgst", "igst", "cess", "tcs", "total", "taxes"],
  COLS: {
    amazon: {no: ["invoicenumber", "creditnoteno", "vatinvoicenumber"], date: ["invoicedate", "creditnotedate", "shipmentdate", "orderdate"],
      party: ["buyername", "customername", "shiptoname"],
      gstin: ["customerbilltogstid", "customershiptogstid", "customerbstn", "buyergstin", "customergstin"],
      pos: ["shiptostate", "billtostate", "placeofsupply"],
      taxable: ["taxexclusivegross"], taxableParts: ["principalamount", "shippingamount", "giftwrapamount"],
      cgst: ["cgsttax", "shippingcgsttax", "giftwrapcgsttax"], sgst: ["sgsttax", "utgsttax", "shippingsgsttax", "shippingutgsttax", "giftwrapsgsttax", "giftwraputgsttax"],
      igst: ["igsttax", "shippingigsttax", "giftwrapigsttax"], cess: ["compensatorycesstax", "shippingcesstaxamount", "giftwrapcompensatorycesstax"],
      tcs: ["tcscgstamount", "tcssgstamount", "tcsigstamount", "tcsutgstamount"],
      rate: ["cgstrate", "igstrate", "taxrate"], hsn: ["hsnsac", "hsncode"], total: ["invoiceamount"], type: ["transactiontype"], order: ["orderid"]},
    flipkart: {no: ["invoiceno", "invoicenumber", "buyerinvoiceid"], date: ["invoicedate", "buyerinvoicedate", "orderdate"], party: ["customername", "buyername"], gstin: ["customergstin", "buyergstin"],
      pos: ["customerstate", "customersdeliverystate", "shiptostate", "placeofsupply", "customersbillingstate"], taxable: ["taxablevalue", "productvaluebeforetax", "sellingprice"], cgst: ["cgstamount", "cgst"], sgst: ["sgstamount", "sgst"],
      igst: ["igstamount", "igst"], cess: ["cessamount"], rate: ["taxrate", "gstrate"], hsn: ["hsncode", "hsn"], total: ["invoiceamount", "finalinvoiceamount"], type: ["eventtype", "transactiontype"], order: ["orderid"]},
    shopify: {no: ["name", "orderid", "invoicenumber"], date: ["createdat", "paidat", "date"], party: ["billingname", "customername", "shippingname"],
      gstin: ["gstin", "taxid"], pos: ["shippingprovince", "shippingprovincename", "billingprovince", "billingprovincename"], hsn: ["hsn", "lineitemsku"],
      total: ["total", "totalprice"], taxes: ["taxes", "totaltax"], status: ["financialstatus"], cancelled: ["cancelledat"], order: ["name"]},
    generic: {no: ["invoicenumber", "invoiceno"], date: ["invoicedate", "date"], party: ["customername", "party"], gstin: ["gstin", "customergstin"],
      pos: ["placeofsupply", "state"], taxable: ["taxablevalue", "taxable"], cgst: ["cgstamount", "cgstamt", "cgst"], sgst: ["sgstamount", "sgstamt", "sgstutgstamount", "sgst"],
      igst: ["igstamount", "igstamt", "igst"], cess: ["cessamount", "cess"], rate: ["rate", "taxrate"], hsn: ["hsn", "hsncode"],
      total: ["invoicevalue", "invoiceamount", "invoicetotal", "totalinvoicevalue", "total"], type: ["type"], order: ["orderid"]}
  },
  TOTAL: /^(grand\s*|sub\s*|net\s*)?total\b/i,
  read(grid, kind){
    const head = grid[0] || [], rows = grid.slice(1), C = this.COLS[kind] || {}, H = head.map(x => this.key(x));
    const idx = {}, many = {};
    Object.keys(C).forEach(k => { idx[k] = this.pick(head, C[k], this.AMOUNTS.includes(k) && k); many[k] = C[k].map(n => H.indexOf(n)).filter(i => i >= 0); });
    const get = (r, k) => idx[k] >= 0 ? r[idx[k]] : "", n = v => SheetFmt.amount(v), blank = v => String(v == null ? "" : v).trim() === "";
    // a figure that arrives in pieces, like Amazon's item, shipping and gift wrap
    const sum = (r, k) => (many[k] || []).reduce((a, i) => a + n(r[i]), 0);
    const amount = (r, k) => (many[k] || []).length > 1 ? sum(r, k) : n(get(r, k));
    const shop = kind === "shopify", cnIdx = this.pick(head, ["creditnoteno", "creditnotenumber"]), cnDate = this.pick(head, ["creditnotedate", "returndate", "refunddate"]);
    // Shopify's tax lines: "Tax 1 Name" (IGST 18%) and "Tax 1 Value"
    const taxCols = [1, 2, 3, 4, 5].map(i => [H.indexOf("tax" + i + "name"), H.indexOf("tax" + i + "value")]).filter(([a, b]) => a >= 0 && b >= 0);
    const byInvoice = new Map(), skipped = [];
    rows.forEach((r, ri) => {
      if (!r || !r.some(c => !blank(c))) return;
      const typ = shop ? "" : String(get(r, "type") || "").toLowerCase();
      // Flipkart's event types: Sale, Return, Cancellation, Return Cancellation (a return undone)
      const rc = /return\s*cancel|cancel\w*\s*(of\s*)?(the\s*)?return/.test(typ), back = !rc && /refund|return|credit/.test(typ), cancel = !rc && !back && /cancel/.test(typ);
      const toCn = rc || back, cn = toCn && cnIdx >= 0 ? String(r[cnIdx] || "").trim() : "";
      const no = cn || String(get(r, "no") || get(r, "order") || "").trim(), fi = r.findIndex(c => !blank(c)), first = String(r[fi]).trim();
      // a total row: "Total" as its number, or as its first cell when that is the row's label (not the customer's column,
      // and no date); left out and counted (review of e7bf15906: a customer "Total Solutions Pvt Ltd" was dropped silently)
      const tot = this.TOTAL.test(no) || (this.TOTAL.test(first) && fi !== idx.party && blank(get(r, "date")));
      if (!no || tot){ skipped.push({row: ri + 2, why: tot || this.TOTAL.test(first) ? "a total row" : "no invoice number"}); return; }
      // a line's own sign; a return's, a refund's or a cancellation's made negative; a return cancelled, positive
      const dir = v => rc ? Math.abs(v) : (back || cancel) && v > 0 ? -v : v;
      // a credit note with no number of its own: one a return date (two returns of one invoice in one report, on 10/09 and
      // 20/09, are two notes, as across reports; review of e7bf15906)
      const key = no + "|" + (toCn ? "CN|" + (cn ? "" : cnDate >= 0 ? String(r[cnDate] == null ? "" : r[cnDate] instanceof Date ? Market.date(r[cnDate]) : r[cnDate]).trim() : "") : "INV");
      let inv = byInvoice.get(key);
      if (!inv){
        inv = {no, against: toCn ? (cn ? String(get(r, "no") || "").trim() : no) : "", date: Market.date(toCn && cnDate >= 0 && !blank(r[cnDate]) ? r[cnDate] : get(r, "date")), party: String(get(r, "party") || "").trim(),
          gstin: String(get(r, "gstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), pos: String(get(r, "pos") || "").trim(),
          hsn: String(get(r, "hsn") || "").trim(), taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0,
          note: toCn ? "credit" : "", market: kind, lines: 0, tcs: 0, hold: ""};
        byInvoice.set(key, inv);
      }
      inv.lines++;
      if (!inv.date) inv.date = Market.date(get(r, "date"));
      if (shop) return this.shopRow(inv, r, get, n, taxCols, blank);
      const taxable = n(get(r, "taxable")) || sum(r, "taxableParts"), cg = amount(r, "cgst"), sg = amount(r, "sgst"), ig = amount(r, "igst"), ce = amount(r, "cess");
      inv.taxable = r2(inv.taxable + dir(taxable)); inv.cgst = r2(inv.cgst + dir(cg)); inv.sgst = r2(inv.sgst + dir(sg)); inv.igst = r2(inv.igst + dir(ig)); inv.cess = r2(inv.cess + dir(ce));
      inv.tcs = r2(inv.tcs + dir(sum(r, "tcs")));
      inv.total = r2(inv.total + dir(blank(get(r, "total")) ? taxable + cg + sg + ig + ce : n(get(r, "total"))));
    });
    const out = Array.from(byInvoice.values()).filter(x => x.taxable || x.total);
    out.skipped = skipped;
    out.forEach(x => {
      const tax = r2(x.cgst + x.sgst + x.igst); x.rate = x.taxable ? Math.round(tax / x.taxable * 10000) / 100 : 0;
      // a cancellation with no sale of it in this report, or a return cancelled with no return in it: asked, never booked by itself
      if (!x.note && x.total < 0) x.hold = x.hold || "A cancellation with no sale of " + x.no + " in this report: is it a credit note against an invoice booked before? Set its type";
      if (x.note && x.total > 0) x.hold = x.hold || "A return cancelled with no return of " + x.no + " in this report: set its type";
      // (release review 23-Nov-2026) a date before GST began (1 July 2017) or after 2035: held, as SheetFmt.apply holds a
      // register's row (Market.date itself reads any year 1990-2099, for the other readers)
      if (x.date && x.date < "2017-07-01") x.hold = x.hold || "The date " + x.date + " is before GST began (1 July 2017): check the date or the report";
      else if (x.date > "2035-12-31") x.hold = x.hold || "The date " + x.date + " is years ahead: check the date or the report";
    });
    return out;
  },
  // a Shopify order's row: its figures are on its first row only (Total, Taxes), the tax by its name; its financial
  // status (paid, refunded, voided) is a payment's, never a document type: a refunded or voided order is asked about
  shopRow(inv, r, get, n, taxCols, blank){
    const st = String(get(r, "status") || "").toLowerCase().trim();
    if (st && !inv.status) inv.status = st;
    if (!blank(get(r, "cancelled"))) inv.cancelled = true;
    if (blank(get(r, "total")) || inv.got) return;
    inv.got = true;
    const total = n(get(r, "total")), taxes = n(get(r, "taxes"));
    let heads = 0, odd = [];
    taxCols.forEach(([ni, vi]) => {
      const v = n(r[vi]), nm = String(r[ni] || "").toLowerCase();
      if (!v) return;
      const k = /igst/.test(nm) ? "igst" : /cgst/.test(nm) ? "cgst" : /sgst|utgst/.test(nm) ? "sgst" : /cess/.test(nm) ? "cess" : "";
      if (k){ inv[k] = r2(inv[k] + v); heads = r2(heads + v); } else odd.push(String(r[ni] || "").trim() || "(no name)");
    });
    inv.total = r2(total); inv.taxable = r2(total - taxes);
    const hold = [];
    if (odd.length || Math.abs(heads - taxes) > 0.01) hold.push("Shopify's tax of " + taxes.toFixed(2) + " is not all named IGST, CGST or SGST" + (odd.length ? " (" + odd.join(", ") + ")" : "") + ": check the tax");
    if (/refund/.test(inv.status || "")) hold.push("Shopify marks this order " + inv.status.replace(/_/g, " ") + ": the sale is here; book its refund as a credit note");
    if (/void/.test(inv.status || "") || inv.cancelled) hold.push("Shopify marks this order " + (inv.cancelled ? "cancelled" : "voided") + ": leave it out unless the goods were supplied");
    inv.hold = hold.join(". ");
  }
};

// a sheet's documents become entries: Purchase → bills (newEntry, finishNewEntry: the duplicate guard), Sales → invoices
// (newInvoice, mapInvoice; an invoice number already here is not added again). Returns {added, held, again, ids}
const SheetPost = {
  // the party's ledger: the sheet's own (only when Tally keeps it under Sundry Debtors / Creditors, by the whole group
  // chain: never an income or expense ledger in a party's place), the GSTIN's, the one answered before, the name's
  partyLedger(d, side){
    const list = ((typeof B === "function" && B() && B().ledgers && B().ledgers.list) || []);
    if (d.ledger && SheetFmt.cls(d.ledger) === "party") return exactLedger(d.ledger);
    if (d.gstin){ const g = list.filter(l => String(l.gstin || "").toUpperCase() === d.gstin); if (g.length === 1) return g[0].name; }
    const remembered = typeof choiceValue === "function" ? choiceValue(CO(), "party:" + (d.gstin || normName(d.party || ""))) : "";
    if (remembered && exactLedger(remembered)) return exactLedger(remembered);
    return d.party ? exactLedger(d.party) || "" : "";
  },
  // the voucher type a document is posted as: the screen's and the kind of row's, never the sheet's own type name.
  // Sales: Sales (or the one in Sales settings), Credit Note, Debit Note; Purchase: Purchase, Debit Note
  vchName(d, side){
    const cfg = (side === "sales" && typeof SL === "function" && SL() && SL().cfg) || {}, co = CO() || {};
    if (side === "sales") return d.note === "credit" ? cfg.creditNoteType || "Credit Note" : d.note === "debit" ? cfg.debitNoteType || "Debit Note" : cfg.voucherType || "Sales";
    return d.note === "credit" ? co.debitNoteType || "Debit Note" : billVt(co);
  },
  // a purchase sheet's bills post as Purchase or as Journal (the owner, 13-Nov-2026): the client's own setting for its
  // bills (co.voucherType, Client setup → Tally: Journal there, or nothing set, is Journal; anything else Purchase),
  // chosen on the panel and kept in that same setting, so bills and sheets agree. The voucher is the bills' own form
  // either way (voucherXml, src/js/01): Dr the expense and input GST ledgers, Cr the party with its bill reference, TDS
  // as the bill engine adds it
  // (the choice is kept beside the client's own type, co.postAs = {v, of: the type it was made over}: a client's own
  // name for its purchase vouchers ("Purchase GST") is never written over, and is what "Purchase" posts as: billVt, src/js/03)
  postAs(){ return /^journal$/i.test(String(billVt(CO() || {})).trim()) ? "Journal" : "Purchase"; },
  setPostAs(v){
    const co = CO(), st = S.sheetImp; if (!co || !["Purchase", "Journal"].includes(v) || v === this.postAs()) return;
    const own = co.voucherType || "Journal", natural = /^journal$/i.test(String(own).trim()) ? "Journal" : "Purchase";
    if (v === natural) delete co.postAs; else co.postAs = {v, of: own};
    Store.saveCompany(co); if (st) st.postAsChanged = true; render();
  },
  // "Edit type" on a held row of the panel: the person says what it is (an invoice / bill, a credit note, a debit note);
  // its figures follow (a credit document negative here, the others positive) and it is held no more
  setKind(d, k){
    if (!d || !k) return;
    d.note = k === "invoice" ? "" : k; d.hold = "";
    if ((d.note === "credit") !== (d.total < 0)) SheetFmt.flip(d);
    render();
  },
  // the sales (or purchase) ledger the sheet names: Tally's own spelling, or the ledger answered for that name before
  sledKey(d){ return d.sledger ? "sled:" + SheetFmt.norm(d.sledger) : ""; },
  salesLedger(d){
    if (!d.sledger) return "";
    return exactLedger(d.sledger) || exactLedger(typeof choiceValue === "function" ? choiceValue(CO(), this.sledKey(d)) : "") || "";
  },
  // a ledger the person asked to create ("Create it" in the panel: their own click, never by itself): on the list of new
  // ledgers, made in Tally with the first posting that uses it, as a new customer has always been
  pend(name, group, d){
    const b = typeof B === "function" && B();
    if (!b || !b.newLed || b.cid !== S.coId) return name;
    if (!exactLedger(name)) b.newLed.push({name, group, gstin: d && GSTIN_RE.test(d.gstin) ? d.gstin : "", state: d ? stateOfGstin(d.gstin) : ""});
    if (typeof saveBank === "function") saveBank({newLed: true});
    return name;
  },
  toBills(docs, cid, fileName){
    const res = {added: 0, held: 0, fixed: 0, ids: []};
    const pk = (g, n) => GSTIN_RE.test(g || "") ? g : normName(n || "");
    // (the client's counts once at the end, not after each row: statsHeld, src/js/01)
    (typeof statsHeld === "function" ? statsHeld : (f) => f())(() => docs.forEach(d => {
      // (the client's own receiving registration is never the supplier's: reviews of 2b565f7e7 and a61ffbb12; a bill saved
      // before with it as the supplier's is matched as one with no GSTIN)
      const mine = this.issuer(d, "purchase", cid), pko = (g, n) => pk(String(g || "").toUpperCase() === mine ? "" : g, n);
      d = this.notOwn(d, mine);
      // a bill held for a person (a negative amount its Type column did not explain: never approved, never posted) and
      // the sheet uploaded again with the Type put right: that bill is put right in place. Only the held bill of the
      // same number, date, party AND amount (its sign is what changed), and only when this row is not a bill already
      // here (the already-here check first: review of ca68ea1ae, where another row of that number rewrote the held one)
      const same = o => normInv(o.x.invoiceNo) === normInv(d.no) && (!o.x.invoiceDate || !d.date || o.x.invoiceDate === d.date) && pko(o.x.vendorGstin, o.x.vendorName) === pk(d.gstin, d.party)
        && Math.abs(Math.abs(num(o.x.total)) - Math.abs(d.total)) < 0.005;
      const all = Object.values(D(cid).entries || {});
      const here = all.some(o => !o.hold && same(o) && (o.noteKind || "") === (d.note || ""));
      // (a held row of a number a bill already has waits as a possible duplicate, as any bill of a number used twice does:
      // it is put right there, and the person says it is not a duplicate as for any other)
      const heldE = !d.hold && !here && all.find(o => o.hold && ["draft", "duplicate"].includes(o.status) && same(o));
      if (heldE){
        Object.assign(heldE.x, {taxable: Math.abs(d.taxable), cgst: Math.abs(d.cgst), sgst: Math.abs(d.sgst), igst: Math.abs(d.igst), cess: Math.abs(d.cess), total: Math.abs(d.total)});
        this.billKind(heldE, d.note);
        if (mine && String(heldE.x.vendorGstin || "").toUpperCase() === mine){ heldE.x.vendorGstin = ""; heldE.x.vendorPan = ""; }
        delete heldE.hold; heldE.readNote = ""; heldE.uncertain = []; Store.saveEntry(cid, heldE); res.fixed++; res.ids.push(heldE.id); return;
      }
      const e = newEntry(fileName), ab = x => d.hold ? x : Math.abs(x);   // (a held document keeps the sheet's own figures)
      Object.assign(e.x, {vendorName: d.party, vendorGstin: d.gstin, vendorPan: d.gstin ? d.gstin.slice(2, 12) : "", invoiceNo: d.no, invoiceDate: d.date,
        taxable: ab(d.taxable), cgst: ab(d.cgst), sgst: ab(d.sgst), igst: ab(d.igst), cess: ab(d.cess), total: ab(d.total), hsn: d.hsn});
      // a negative bill in a sheet whose Type column does not call it a return: held, said on the bill, its total to check
      if (d.hold){ e.readNote = d.hold + "."; e.uncertain = ["total"]; e.hold = d.hold; }
      this.billKind(e, d.note);
      e.readMode = "sheet"; e.sheet = {file: fileName, rows: d.rows, check: d.check, sec: d.sec || "", itc: d.itc || null};
      // next-fix-audit-imports: no credit where GSTR-2B says none is available (section 16(2)(aa) CGST Act): the bill's
      // credit is blocked, so its tax is added to the cost (compute, src/js/01: it was only said, and claimed)
      if (d.itc && d.itc.available === false){ e.itcBlocked = d.itc.why; e.itcBlock = {on: true, cat: "ITC not available in GSTR-2B (" + d.itc.why + ")"};
        e.readNote = "ITC not available in GSTR-2B (" + d.itc.why + "): its tax is ineligible input tax, added to the cost."; }
      // reverse charge (GSTR-2B's "Supply Attract Reverse Charge" Y; section 9(3) / 9(4) CGST Act, 5(3) / 5(4) IGST Act):
      // the supplier is paid the taxable value; the tax at its own rate is booked payable under reverse charge, and as
      // input credit unless it is blocked (compute, src/js/01). Its rate is the 2B's tax over its taxable value
      if (d.rcm && !d.hold){
        const tax = Math.abs(d.igst) + Math.abs(d.cgst) + Math.abs(d.sgst), rate = SheetFmt.rateOf(Math.abs(d.taxable), tax);
        e.rcm = {on: true, cat: "other", rate, inter: !!Math.abs(d.igst)};
        const was = e.x.total;
        Object.assign(e.x, {cgst: 0, sgst: 0, igst: 0, cess: 0, total: r2(Math.abs(d.taxable))});
        e.readNote = (e.readNote ? e.readNote + " " : "") + "Reverse charge in GSTR-2B: tax of " + r2(tax).toFixed(2) + " at " + rate + "% is payable by the client" + (Math.abs(was - e.x.total) > 1 && Math.abs(was - r2(e.x.total + tax)) > 1 ? "; the invoice value " + was.toFixed(2) + " is neither the taxable value nor taxable value plus tax: check it" : "") + (Math.abs(d.cess) ? "; its cess of " + Math.abs(d.cess).toFixed(2) + " is also payable by the client and is not booked here: add it" : "") + ".";
        if (!rate || Math.abs(d.cess)) e.uncertain = (e.uncertain || []).concat(["total"]);
      }
      // a document that does not add up to the paisa is said on the bill, so it is looked at before it is approved
      if (d.check && !d.check.ok){ e.readNote = (e.readNote ? e.readNote + " " : "") + "From the sheet: " + d.check.text + "."; e.uncertain = ["total"]; }
      // the party: as answered in the panel (mapped, or a new ledger made when posting, as for a bill read), else matched
      // (the person's own answer stands: it is not worked out again from the books)
      const found = d.mapped || this.partyLedger(d, "purchase");
      e.partyLedger = found || (d.newLedger ? this.pend(d.newLedger, "Sundry Creditors", d) : "");
      if (d.mapped || (!found && d.newLedger)) e.partyUserSet = true;
      // the sheet's own purchase ledger, on the bill
      // (set by a person only when they answered for it in the panel; the sheet's own only when Tally keeps it as an
      // expense, purchase or fixed-asset ledger: review L8)
      const own = d.sledMapped || (d.newSled ? this.pend(d.newSled, "Purchase Accounts") : ""), fromSheet = own ? "" : this.salesLedger(d);
      if (own){ e.expenseLedger = own; e.expenseUserSet = true; }
      else if (["expense", "asset"].includes(SheetFmt.cls(fromSheet))) e.expenseLedger = fromSheet;
      // (the voucher type is the client's own for its bills, vchTypeOf in src/js/03: never the sheet's, nothing stamped here)
      finishNewEntry(e, cid, null);
      res.ids.push(e.id);
      if (e.status === "duplicate") res.held++; else res.added++;
    }));
    return res;
  },
  // a bill's kind: a return (our debit note, the supplier's credit note) carries no TDS, as a credit note read from a
  // file carries none (tdsSkip "note", src/js/01); made a bill again, that mark goes
  billKind(e, note){
    if (note) e.noteKind = note; else delete e.noteKind;
    if (note === "credit") e.tdsSkip = e.tdsSkip || "note"; else if (e.tdsSkip === "note") delete e.tdsSkip;
  },
  // (next-fix-audit-imports, speed: the invoices already here listed by number once, kept up as the sheet's are added,
  // and the duplicate checks of each new invoice (mapInvoice) through the Sales list by number, salesByNo: a monthly
  // marketplace report against a year's invoices went as the square of the two)
  toSales(docs, cid, fileName){
    const run = () => this.toSalesNow(docs, cid, fileName);
    return typeof salesByNo === "function" ? salesByNo(run) : run();
  },
  toSalesNow(docs, cid, fileName){
    const s = SL(), res = {added: 0, held: 0, again: 0, fixed: 0, ids: []};
    const byNo = new Map(), put = v => { const k = normInv(v.x.number); (byNo.get(k) || byNo.set(k, []).get(k)).push(v);
      if (typeof salesNoIdx !== "undefined" && salesNoIdx && typeof normInvNo === "function"){ const j = normInvNo(v.x.number); (salesNoIdx.get(j) || salesNoIdx.set(j, []).get(j)).push(v); } };
    s.list.forEach(v => { const k = normInv(v.x.number); (byNo.get(k) || byNo.set(k, []).get(k)).push(v); });
    const ofNo = n => byNo.get(normInv(n)) || [];
    // (the owner, 23-Nov-2026) a marketplace credit note with no number of its own (a return of the invoice, read under
    // the invoice's number): "<invoice> (CN-1)", "(CN-2)" in order of return date, not "(CN)" for all. Kept on a
    // re-import: a return already here (the same date and total, numbered so, or "(CN)" as before) keeps its number;
    // a new one takes the next after the highest here
    const cnNo = new Map(), cnOf = new Map();
    docs.forEach(d => { if (d.market && d.note === "credit" && d.no && (!d.against || d.against === d.no) && !/^cn/i.test(d.no)) (cnOf.get(d.no) || cnOf.set(d.no, []).get(d.no)).push(d); });
    cnOf.forEach((list, base) => {
      const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\(CN(?:-(\\d+))?\\)$", "i"), used = new Set();
      const have = s.list.filter(v => (v.x.noteKind || "") === "credit" && re.test(v.x.number || ""));
      let k = have.reduce((a, v) => Math.max(a, +((re.exec(v.x.number) || [])[1] || 0)), 0);
      list.slice().sort((a, c) => String(a.date || "").localeCompare(String(c.date || ""))).forEach(d => {
        const hit = have.find(v => !used.has(v) && (v.x.date || "") === (d.date || "") && Math.abs(Math.abs(num(v.x.total)) - Math.abs(num(d.total))) < 0.005);
        if (hit) used.add(hit);
        cnNo.set(d, hit ? hit.x.number : base + " (CN-" + (++k) + ")"); });
    });
    docs.forEach(d => {
      const cnMine = cnNo.get(d);
      // (the registration the invoice is issued from is never the customer's; the client's other registration, a supply
      // between its own branches, is: reviews of 2b565f7e7 and a61ffbb12)
      const own = [this.issuer(d, "sales", cid)].filter(Boolean);
      d = this.notOwn(d, own[0]);
      const no = cnMine || d.no + (d.note === "credit" && !/^cn/i.test(d.no) ? " (CN)" : "");
      const ab = x => d.hold ? x : Math.abs(x);   // (a held document keeps the sheet's own figures)
      // already here: the same number and date AND the same party (its GSTIN, else its name) AND the same total (review
      // H1 of cf58b7cc9: number and date alone let another party's invoice of that number be written over). Anything
      // else of that number is a new invoice (the number said "already exists" on it, as for any upload)
      // (next-fix-sheetgst: the party by its GSTIN only when both carry a good one, by its check character; else by its
      // name, so a sheet put right with a GSTIN column is not added again over the invoices its old layout left; a GSTIN
      // FinCom filled from the party's Tally ledger is not the invoice's own: by the name too)
      const name = d.party || (d.gstin ? "" : "Retail customer"), tallyG = v => !!(v.filled && v.filled.customerGstin && v.filled.customerGstin === v.x.customerGstin);
      const same = v => this.sameParty(tallyG(v) ? "" : v.x.customerGstin, v.x.customerName, d.gstin, name);
      const was = ofNo(no).find(v => (!v.x.date || !d.date || v.x.date === d.date)
        && same(v) && Math.abs(num(v.x.total) - (d.hold ? d.total : Math.abs(d.total))) < 0.005 && (v.x.noteKind || "") === (d.note || "") && !v.hold === !d.hold);
      // never added again. One from a sheet still waiting (To review / Ready) takes this sheet's ledgers where no person
      // set one (M2), so the invoices an old, wrong layout left stuck are put right by uploading the sheet again; a
      // Ready invoice whose ledger changed so goes back to To review, to be looked at before it is posted
      // (next-fix-sheetgst: any invoice still waiting takes the sheet's GSTIN and place of supply where it has none, or only
      // what FinCom filled from the Tally ledger; never one posted, nor one queued for posting, v.postJob)
      if (was){
        res.again++;
        // (next-fix-audit-sales-einv: nor one with a live IRN, whose figures are the IRP's, CGST Rules r.48(4))
        if (["review", "ready"].includes(was.status) && !was.postJob && was.x.irnStatus !== "active"){
          const sig = () => JSON.stringify([was.customerLedger, was.salesLedgers || {}, was.x.customerGstin || "", was.x.pos || ""]), before = sig(), ready = was.status === "ready";
          const gst = this.fillParty(was, d, own);
          if (was.source === "sheet" || was.source === "market"){
            if (d.own && !was.x.sellerGstin) was.x.sellerGstin = d.own;
            if (d.branch && !was.x.branch) was.x.branch = d.branch;
            this.ledgersTo(was, d, true);
          }
          if (gst || was.source === "sheet" || was.source === "market") mapInvoice(was);
          if (ready && sig() !== before) was.status = "review";
        }
        return;
      }
      // an invoice held for a person (never posted) and the sheet uploaded again with its Type put right: that invoice is
      // put right in place. Only after the already-here check (above), and only the held invoice of the same number,
      // date, party AND amount (its sign and its kind are what changed): another row of that number never rewrites it
      const heldV = !d.hold && ofNo(d.no).find(v => v.hold && v.status === "review" && v.x.irnStatus !== "active" && (!v.x.date || !d.date || v.x.date === d.date) && same(v)
        && Math.abs(Math.abs(num(v.x.total)) - Math.abs(d.total)) < 0.005);
      if (heldV){
        Object.assign(heldV.x, {number: no, taxable: Math.abs(d.taxable), cgst: Math.abs(d.cgst), sgst: Math.abs(d.sgst), igst: Math.abs(d.igst), cess: Math.abs(d.cess), total: Math.abs(d.total), rate: d.rate, noteKind: d.note || "", items: this.items(d, Math.abs)});
        delete heldV.hold; if (heldV.x.ecommerce) heldV.source = "market"; this.ledgersTo(heldV, d, true); this.fillParty(heldV, d, own); mapInvoice(heldV); res.fixed++; res.ids.push(heldV.id); return;
      }
      // a marketplace's report (Amazon, Flipkart, Shopify): its invoices are kept as a marketplace's (source "market",
      // as the retired importMarketFile made them), so GSTR.fromSales (server/_shared/gst3b.js) counts them in the month's
      // GSTR-1 / 3B outward supplies and in table 14 by the operator, with the TCS it collected u/s 52 CGST Act (review
      // of e7bf15906: they were made "sheet", in neither until posted). Once posted (or found in Tally) its Tally entry is
      // what counts, and table 14 takes it from here (GSTR.ecoBooked); a Shopify store is the client's own, never in table
      // 14 (GSTR.ECO_NOT). A GST register (generic) stays the client's own.
      // One held for a person (a cancellation with no sale in the report, a refunded or voided order) is "sheet" until it
      // is put right (heldV, above), so it is never counted with the report's own signs
      const mk = ["amazon", "flipkart", "shopify"].includes(d.market) ? d.market : "";
      const v = newInvoice(Object.assign({number: no, date: d.date, customerName: d.party || (d.gstin ? "" : "Retail customer"), customerGstin: GSTIN_RE.test(d.gstin) ? d.gstin : "", pos: d.pos,
        hsn: d.hsn, taxable: ab(d.taxable), cgst: ab(d.cgst), sgst: ab(d.sgst), igst: ab(d.igst), cess: ab(d.cess), total: ab(d.total),
        rate: d.rate, noteKind: d.note || "", againstInvoice: d.against || "", sellerGstin: d.own || "", branch: d.branch || "", items: this.items(d, ab)},
        mk ? {ecommerce: mk, tcs: Math.abs(num(d.tcs)), placeOfSupply: (d.pos && typeof GST_STATES === "object" && GST_STATES[d.pos]) || d.pos || ""} : null), mk && !d.hold ? "market" : "sheet", {fileName, market: mk || undefined, sheet: {rows: d.rows, check: d.check, sec: d.sec || ""},
        // (item 1: what the sheet itself gave; a GSTIN or place of supply it did not give comes from the party's Tally
        // ledger, src/js/25 salesPartyFill)
        // (never a GSTR-1's B2CS / B2CL / unregistered note, a summary or a row the file marks unregistered: review of 44e4c1e97)
        sheetHad: this.mayFill(d) ? {gstin: GSTIN_RE.test(d.gstin), pos: !!d.pos} : undefined});
      if (!v.sheetHad) delete v.sheetHad;
      this.ledgersTo(v, d);
      // (the customer ledger first, found as for any invoice; then the party's GSTIN and state from it)
      s.list.push(v); put(v); mapInvoice(v);
      if (typeof salesPartyFill === "function" && v.sheetHad){ salesPartyFill(v); mapInvoice(v); } res.added++; res.ids.push(v.id);
    });
    saveSales();
    return res;
  },
  // next-fix-sheetgst: the same party on two invoices: by the GSTIN when both carry a good one (its check character,
  // gstinValid) or the very same one; else by the name (an invoice with no GSTIN, or one that fails its check)
  goodGstin(g){ g = String(g || "").toUpperCase(); return GSTIN_RE.test(g) && (typeof gstinValid !== "function" || gstinValid(g)); },
  sameParty(g1, n1, g2, n2){
    const a = String(g1 || "").toUpperCase(), b = String(g2 || "").toUpperCase();
    if (a && a === b && GSTIN_RE.test(a)) return true;
    if (this.goodGstin(a) && this.goodGstin(b)) return false;
    const na = normName(n1 || ""), nb = normName(n2 || "");
    return !!na && na === nb;   // (two blank names are no match)
  },
  // the client's own registration on a document: on Sales the one it is issued from (the sheet's "Our GSTIN", else the
  // client's GSTIN), on Purchase the one receiving it (the client's GSTIN)
  issuer(d, side, cid){ return String((side === "sales" && d && d.own) || (CO(cid) || {}).gstin || "").toUpperCase().trim(); },
  // a document whose party GSTIN is that registration (mine): its copy with no party GSTIN, nor the place of supply worked
  // out from it (d.posFromGstin); a place of supply the sheet gave stands. Any other GSTIN, the client's other
  // registrations among them (a supply between its own branches), is left as it is
  notOwn(d, mine){
    const g = String((d && d.gstin) || "").toUpperCase();
    if (!g || !mine || g !== String(mine).toUpperCase()) return d;
    const c = Object.assign({}, d, {gstin: ""});
    if (d.posFromGstin){ c.pos = ""; delete c.posFromGstin; }
    return c;
  },
  // an invoice already here, still waiting: the sheet's GSTIN and place of supply where it has none, or only what FinCom
  // filled from the party's Tally ledger (v.filled, salesPartyFill in src/js/25); what a person typed stands. True when changed
  // (review of 2b565f7e7: only an uploaded invoice, never one made in FinCom, posted or queued for posting; only a GSTIN
  // that passes its check and is not the client's own; never a field the sheet gave and a person cleared, v.sheetHad)
  fillParty(v, d, own){
    if (!["sheet", "upload", "market"].includes(v.source) || v.postJob || ["posted", "intally", "ignored"].includes(v.status)) return false;
    const x = v.x, f = v.filled || {}, h = v.sheetHad || {}, ours = k => !x[k] || (f[k] && x[k] === f[k]);
    const g = this.goodGstin(d.gstin) && !(own || []).includes(String(d.gstin).toUpperCase()) ? String(d.gstin).toUpperCase() : "", pos = d.pos || stateOfGstin(g);
    let did = false;
    if (g && x.customerGstin !== g && ours("customerGstin") && !(h.gstin && !x.customerGstin)){ x.customerGstin = g; delete f.customerGstin; if (v.sheetHad) v.sheetHad.gstin = true; did = true; }
    if (pos && x.pos !== pos && ours("pos") && !(h.pos && !x.pos)){ x.pos = pos; delete f.pos; if (v.sheetHad) v.sheetHad.pos = true; did = true; }
    if (did && v.filled && !f.customerGstin && !f.pos) delete v.filled;
    return did;
  },
  // whether a document's party GSTIN may be taken from its Tally ledger: never for a sale to a consumer by the file's
  // own word (GSTR-1's B2CS, B2CL, CDNUR, EXP; a summary row; a row whose registration column says unregistered or
  // consumer; the retail customer a sheet with no party names)
  mayFill(d){
    if (!d || d.summary || /^(b2cs|b2cl|cdnur|exp)$/i.test(String(d.sec || "")) || d.unreg) return false;
    if (/unregistered|consumer|\bb2c\b|\burp\b/i.test(String(d.regType || ""))) return false;
    return !!d.party;
  },
  // an invoice's rate-wise item lines (rows of the sheet at more than one rate): taxable, rate and tax a line, as the
  // sheet has them; none for an invoice of one rate
  items(d, ab){
    return (d.items || []).map(p => ({desc: "Rows at " + String(p.rate).replace(/\.0+$/, "") + "%", hsn: d.hsn || "", qty: 0, unit: "", rate: 0, disc: 0,
      taxable: ab(p.taxable), gstRate: p.rate, igst: ab(p.igst), cgst: ab(p.cgst), sgst: ab(p.sgst), tax: ab(p.tax)}));
  },
  // an invoice's ledgers from its row of the sheet: the customer (answered, found, or to create), the sheet's own sales
  // ledger for each of its rates, and Tally's voucher type
  ledgersTo(v, d, again){
    // (on an invoice already here, a ledger a person set stands, whatever its group (Cash, a bank): "Set by you" is the
    // mark the Sales page and the panel's own answers leave; what an old layout or a rule put there is not a person's)
    const keep = again && v.userLedger && v.custSource === "Set by you";
    const led = keep ? "" : d.mapped || this.partyLedger(d, "sales");
    if (led){ v.customerLedger = led; v.userLedger = true; v.custSource = d.mapped ? "Set by you" : "From the sheet"; }
    // a customer to create: the bank page's list of new ledgers (made in Tally with the first posting, as today)
    else if (!keep && d.newLedger){ v.customerLedger = this.pend(d.newLedger, "Sundry Debtors", d); v.userLedger = true; v.custSource = "Set by you"; }
    else if (!keep && again && v.userLedger && !["party", ""].includes(SheetFmt.cls(v.customerLedger))){ v.customerLedger = ""; v.userLedger = false; }
    if (d.hold) v.hold = d.hold;
    const sl = d.sledMapped || this.salesLedger(d) || (d.newSled ? this.pend(d.newSled, "Sales Accounts") : "");
    // (a sales ledger already on the invoice, a Tally ledger, stands too)
    if (sl){ const had = (again && v.salesLedgers) || {}; v.salesLedgers = {}; salesTotals(v.x).forEach(g => { v.salesLedgers[g.rate] = exactLedger(had[g.rate]) || sl; }); }
    delete v.x.vchType;   // (the Sales screen's own type: never the sheet's column)
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
        // a layout saved with the old, wrong columns (its ledger column read as the party's, though its values are not
        // parties in Tally; Voucher Type as the document type): the mapping is shown again, corrected by FinCom's rules
        // (no AI), for the person to check and save; the old one is put aside then, kept
        // (a layout a person has checked since, v 2, is theirs: never asked again)
        const fx = !found.fmt.builtin && !found.fmt.v && SheetFmt.fix(found.fmt.map, st.head, g.slice(st.hi + 1));
        if (fx){
          const col = n => st.head[st.head.map(h => SheetFmt.norm(h)).indexOf(n)] || n, was = found.fmt.map, who = side === "sales" ? "customer" : "supplier";
          st.remap = {id: found.fmt.id, scope: found.fmt.scope, why: [was.ledger && !fx.ledger ? "“" + col(was.ledger) + "” was read as the " + who + "'s ledger, but its values are not " + who + "s in Tally: it is the " + SIDE_LEDGER[side].toLowerCase() + "." : ""].filter(Boolean).join(" ")};
          st.map = fx; st.transforms = Object.assign({}, found.fmt.transforms); st.why = {}; st.step = "map"; st.busy = ""; return render();
        }
        // (next-fix-sheetgst) columns the saved format was not made with: a GSTIN column is read as the party's GSTIN, and
        // the panel says so and names any other new column it does not read (never silent). Only for this upload: the
        // saved format stays as the person saved it
        const gr = found.how === "drift" && SheetFmt.grow(found.fmt, st.head, g.slice(st.hi + 1), SheetFmt.own(S.coId), side);
        let fmt = found.fmt;
        if (gr){
          const label = n => st.head[st.head.map(h => SheetFmt.norm(h)).indexOf(n)] || n, FL = SheetFmt.fieldsFor(side);
          fmt = Object.assign({}, found.fmt, {map: gr.map});
          st.grown = {added: Object.entries(gr.added).map(([field, n]) => ({field, col: label(n), label: (FL.find(x => x[0] === field) || [field, field])[1]})), other: gr.other.map(label)};
        }
        st.docs = SheetFmt.apply(fmt, g, st.hi, CO(), side);
        // GSTR-2B's other sheet (B2B-CDNR), by its own built-in format
        (st.read.more || []).forEach(x => { const h2 = SheetFmt.head(x.grid), b2 = SheetFmt.builtin((x.grid[h2] || []).map(c => String(c == null ? "" : c)), side);
          if (b2){ const more = SheetFmt.apply(b2, x.grid, h2, CO(), side); st.docs = st.docs.concat(more); } });
        return this.check();
      }
      // a format FinCom has not seen: the AI proposes a mapping, once; the person confirms or changes it
      // (next-fix-sales-upload, item 7: the mapping waiting to be saved is kept for this file's layout, the person's
      // changes with it, until it is saved or cancelled: the same layout uploaded again is not sent to the AI again)
      st.pendKey = this.pendKey(S.coId, side, SheetFmt.fingerprint(st.head, st.read.sheet));
      const kept = this.pending(st.pendKey);
      if (kept){
        Object.assign(st, {map: Object.assign({}, kept.map), transforms: Object.assign({}, kept.transforms), why: kept.why || {}, aiCost: null, fmtName: kept.fmtName || this.suggestName(f.name), pendingAgain: true});
        st.step = "map"; st.busy = ""; return render();
      }
      st.busy = "A new format: FinCom's AI is reading its columns…"; render();
      let p = null;
      try { p = await SheetFmt.propose(st.head, g.slice(st.hi + 1, st.hi + 11), side); }
      catch (e){ st.aiErr = (e && e.message) || String(e); p = {map: {}, transforms: {date: "dmy", groupByNo: true}, why: {}}; }
      st.map = p.map; st.transforms = p.transforms; st.why = p.why || {}; st.aiCost = p.cost || null;
      st.fmtName = this.suggestName(f.name); st.step = "map"; st.busy = "";
      if (!st.aiErr) this.keepPending(st);
      render();
    } catch (e){ st.busy = ""; st.err = (e && e.message) || String(e); st.step = "error"; render(); }
  },
  // the mappings waiting to be saved, by client, side and the file's layout (its fingerprint): kept in memory and for
  // this browser tab (sessionStorage, when it can be used), dropped when the format is saved or the mapping cancelled
  _pend: {},
  pendKey(cid, side, fp){ return "fincom:sheetmap:" + [cid || "", side || "", fp || ""].join("|"); },
  pending(key){
    if (!key) return null;
    if (this._pend[key]) return this._pend[key];
    try { const v = JSON.parse(sessionStorage.getItem(key) || "null"); if (v && v.map) return (this._pend[key] = v); } catch (e){}
    return null;
  },
  keepPending(st){
    if (!st || !st.pendKey || st.remap) return;
    const v = {map: st.map || {}, transforms: st.transforms || {}, why: st.why || {}, fmtName: st.fmtName || "", at: new Date().toISOString()};
    this._pend[st.pendKey] = v;
    try { sessionStorage.setItem(st.pendKey, JSON.stringify(v)); } catch (e){}
  },
  dropPending(key){ if (!key) return; delete this._pend[key]; try { sessionStorage.removeItem(key); } catch (e){} },
  // Cancel on the mapping: the mapping waiting is let go (the next upload of this layout asks the AI again)
  cancelMap(){ const st = this.st(); if (st) this.dropPending(st.pendKey); this.close(); },
  suggestName(n){ return String(n || "Register").replace(/\.[a-z]+$/i, "").replace(/[_\-]+/g, " ").replace(/\s*\d{4,}.*$/, "").trim() || "Register"; },
  setMap(field, col){ const st = this.st(); if (!st) return; st.map = Object.assign({}, st.map); Object.keys(st.map).forEach(k => { if (k !== field && st.map[k] === col && col) delete st.map[k]; });
    if (col) st.map[field] = col; else delete st.map[field]; if (this.pending(st.pendKey)) this.keepPending(st); render(); },
  setTransform(k, v){ const st = this.st(); if (!st) return; st.transforms = Object.assign({}, st.transforms, {[k]: v}); if (this.pending(st.pendKey)) this.keepPending(st); render(); },
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
      headers: head.map(h => SheetFmt.norm(h)), map: st.map, transforms: st.transforms, by: whoAmI(), at: new Date().toISOString(), ai: !st.aiErr, scope: scope === "firm" ? "firm" : "client", v: 2};
    if (st.remap){ const old = this.fmtById(st.remap.id); if (old){ old.deleted = {at: fmt.at, by: fmt.by, why: "mapped again"}; if (old.scope === "firm") Store.saveFirm(); else Store.saveCompany(co); } fmt.ai = false; }
    if (fmt.scope === "firm"){ S.firm.sheetFormats = (S.firm.sheetFormats || []).concat([fmt]); Store.saveFirm(); }
    else { co.sheetFormats = (co.sheetFormats || []).concat([fmt]); Store.saveCompany(co); }
    st.fmt = fmt; st.how = "saved"; this.dropPending(st.pendKey);
    if (this.recon(st.side)) return this.reconStep();
    st.docs = SheetFmt.apply(fmt, st.read.grid, st.hi, co, st.side);
    this.check();
  },
  // the documents made: the questions they raise, asked in the panel; nothing is added until "Add to To review"
  check(){
    const st = this.st(); if (!st) return;
    st.step = "check"; st.busy = "";
    st.answers = st.answers || {};
    // (the client's own registration is never shown nor asked about as a party: review of a61ffbb12)
    // (in place: the list keeps what else it carries, its rows left out: docs.skipped)
    if (!this.recon(st.side)) (st.docs || []).forEach((d, i) => { st.docs[i] = SheetPost.notOwn(d, SheetPost.issuer(d, st.side === "sales" ? "sales" : "purchase", st.cid)); });
    const qs = [], seen = new Set();
    if (st.b2cs && st.b2cs.length) qs.push({id: "b2cs", kind: "b2cs", text: "GSTR-1 has " + st.b2cs.length + " B2CS summary row" + (st.b2cs.length === 1 ? "" : "s") + " (sales to consumers, by rate and place of supply). Post B2CS as one summary entry per rate / place of supply?", options: [["yes", "Yes, one entry each"], ["no", "No, leave them out"]]});
    if (st.read && st.read.notRead && st.read.notRead.length) qs.push({id: "notread", kind: "amend", text: "This GSTR-2B also has " + st.read.notRead.join(", ") + " (imports of goods, ISD credits or an operator's supplies u/s 9(5)). FinCom does not read those sheets: book them by hand.", options: [["ok", "Understood"]]});
    if (st.read && st.read.amend && st.read.amend.length) qs.push({id: "amend", kind: "amend", text: "This GSTR-2B also has amendments (" + st.read.amend.join(", ") + "). FinCom does not post them: an amendment changes a bill already booked. Check those bills by hand.", options: [["ok", "Understood"]]});
    const rcm = (st.docs || []).filter(d => d.rcm);
    if (rcm.length) qs.push({id: "rcm", kind: "rcm", text: rcm.length + " document" + (rcm.length === 1 ? " is" : "s are") + " under reverse charge: the supplier charges no GST, and the client pays the tax (section 9(3) / 9(4) CGST Act, 5(3) / 5(4) IGST Act). Book the tax as payable under reverse charge, with its input credit?", options: [["rcm", "Yes, reverse charge"], ["skip", "Leave them out"]]});
    const blocked = (st.docs || []).filter(d => d.itc && d.itc.available === false);
    if (blocked.length) qs.push({id: "itc", kind: "itc", text: blocked.length + " document" + (blocked.length === 1 ? "" : "s") + " in 2B give no input tax credit (" + Array.from(new Set(blocked.map(d => d.itc.why))).join("; ") + "). Book their tax as ineligible ITC (part of the cost), or leave them out?",
      options: [["ineligible", "Book as ineligible ITC"], ["skip", "Leave them out"]]});
    (st.docs || []).forEach(d => {
      const key = d.gstin || normName(d.party || "");
      if (!key || seen.has(key) || d.summary) return;
      seen.add(key);
      if (!SheetPost.partyLedger(d, st.side)) qs.push({id: "party:" + key, group: st.side === "sales" ? "Sundry Debtors" : "Sundry Creditors", kind: "party", party: d.party || d.gstin, gstin: d.gstin, text: "Party “" + (d.party || d.gstin) + "”" + (d.gstin ? " (" + d.gstin + ")" : "") + " is not in Tally.", options: [["create", "Create it"], ["map", "Map to a ledger…"]]});
    });
    // a sales (or purchase) ledger the sheet names that Tally does not have: created (the person's click) or mapped
    (st.docs || []).forEach(d => {
      const key = SheetPost.sledKey(d);
      if (!key || seen.has(key) || SheetPost.salesLedger(d)) return;
      seen.add(key);
      qs.push({id: key, kind: "sledger", party: d.sledger, text: SIDE_LEDGER[st.side] + " “" + d.sledger + "” is not in Tally.", options: [["create", "Create it"], ["map", "Map to a ledger…"]]});
    });
    st.questions = qs; render();
  },
  answer(id, v, ledger){
    const st = this.st(); if (!st) return;
    st.answers = Object.assign({}, st.answers, {[id]: {v, ledger: ledger || ""}});
    const q = (st.questions || []).find(x => x.id === id);
    // a party's answer is remembered for the client (a choice, as every confirmed ledger is)
    if (q && q.kind === "party" && v === "map" && ledger && exactLedger(ledger)) choiceConfirm(CO(st.cid), "party:" + id.slice(6), exactLedger(ledger));
    if (q && q.kind === "sledger" && v === "map" && ledger && exactLedger(ledger)) choiceConfirm(CO(st.cid), id, exactLedger(ledger));
    render();
  },
  open(){ const st = this.st(); return (st && st.questions || []).filter(q => !(st.answers || {})[q.id] || (st.answers[q.id].v === "map" && !st.answers[q.id].ledger)); },
  // the documents that go in, after the answers
  docsToAdd(){
    const st = this.st(); if (!st) return [];
    const a = st.answers || {};
    let docs = (st.docs || []).slice();
    if (a.itc && a.itc.v === "skip") docs = docs.filter(d => !(d.itc && d.itc.available === false));
    if (a.rcm && a.rcm.v === "skip") docs = docs.filter(d => !d.rcm);
    if (st.b2cs && a.b2cs && a.b2cs.v === "yes") docs = docs.concat(st.b2cs);
    docs.forEach(d => {
      const k = d.gstin || normName(d.party || ""), ans = a["party:" + k];
      // "Create it" is the person's own click: the ledger is always made (it was skipped whenever the sheet had a ledger
      // column); "Map to a ledger…" is the ledger they chose
      // (worked out afresh each time: an answer changed from one to the other leaves nothing of the first)
      delete d.newLedger; delete d.mapped; delete d.newSled; delete d.sledMapped;
      if (ans && ans.v === "create") d.newLedger = d.party || d.gstin;
      if (ans && ans.v === "map" && ans.ledger) d.mapped = exactLedger(ans.ledger) || ans.ledger;
      const sa = a[SheetPost.sledKey(d)];
      if (sa && sa.v === "create") d.newSled = d.sledger;
      if (sa && sa.v === "map" && sa.ledger) d.sledMapped = exactLedger(sa.ledger) || sa.ledger;
    });
    return docs;
  },
  async add(){
    const st = this.st(); if (!st) return;
    if (this.open().length){ toast("Answer the questions first."); return; }
    const docs = this.docsToAdd(), cid = st.cid;
    // (a ledger to create goes on the client's list of new ledgers, kept with its bank data: brought in first)
    if (docs.some(d => d.newLedger || d.newSled) && typeof loadBank === "function" && (!S.bank || S.bank.cid !== cid)) await loadBank(cid).catch(() => {});
    // (Sales: the client's own sales voucher type from its books, as the default for these new invoices, src/js/25)
    if (st.side === "sales" && typeof salesLearnVt === "function") salesLearnVt();
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
    let open = null, close = null, lastBal = null, firstBal = null;
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
      // the opening or closing line: a cell that is that label and nothing more ("Opening Balance", "By Balance b/f"), on a
      // row with no document number (next-fix-audit-imports: "Shop opening expenses" was taken as the opening)
      const lab = re => !String(get(r, "no") == null ? "" : get(r, "no")).trim() && (narr ? [narr] : r.map(c => String(c == null ? "" : c))).some(c => re.test(c.trim()));
      if (lab(/^((to|by)\s+)?(opening\s*(balance|bal\.?)|balance\s*(b\/f|b\/d|brought\s*forward)|b\/f|brought\s*forward)\s*[:.]?$/i)){ open = bal != null ? bal : r2(dr - cr); return; }
      if (lab(/^((to|by)\s+)?(closing\s*(balance|bal\.?)|balance\s*(c\/f|c\/d|carried\s*forward)|c\/f|carried\s*forward)\s*[:.]?$/i)){ close = bal != null ? bal : r2(dr - cr); return; }
      if (/^(grand\s*)?total/i.test(String(r.find(c => String(c == null ? "" : c).trim()) || ""))) return;
      if (!dr && !cr) return;
      const date = SheetFmt.date(get(r, "date"), t.date);
      if (!rows.length && bal != null) firstBal = r2(bal - (dr - cr));
      rows.push({date, no: String(get(r, "no") || "").trim(), narr, dr: r2(dr), cr: r2(cr), tds: Math.abs(a(r, "tds")), gst: Math.abs(a(r, "gst")), row: hi + 2 + n});
      if (bal != null) lastBal = bal;
    });
    const moved = r2(rows.reduce((s, x) => s + x.dr - x.cr, 0));
    // the opening: as the statement says; else what its first balance implies (the balance after its first line, less
    // that line); else nil (implied: next-fix-audit-imports, it was always nil)
    if (open == null) open = firstBal != null ? firstBal : 0;
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
