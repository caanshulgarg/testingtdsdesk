/* ================================================================== */
/* Sales from a marketplace: Amazon MTR, Flipkart, Shopify            */
/* ================================================================== */
const Market = {
  // which report is this, from the columns it has
  detect(head){
    const h = head.map(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    const has = n => h.some(x => x.includes(n));
    if (has("orderitemid") || has("fsn") || has("finalinvoiceamount")) return "flipkart";
    if (has("taxexclusivegross") || has("shipfromstate") || has("customerbstn") ||
        (has("transactiontype") && has("invoiceamount")) || (has("sellergstin") && has("orderid"))) return "amazon";
    if (has("lineitemprice") || (has("financialstatus") && has("lineitemname"))) return "shopify";
    if (has("invoicenumber") && has("taxablevalue")) return "generic";
    return "";
  },
  pick(head, names){
    const h = head.map(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const n of names){ const i = h.findIndex(x => x === n); if (i >= 0) return i; }
    for (const n of names){ const i = h.findIndex(x => x.includes(n)); if (i >= 0) return i; }
    return -1;
  },
  date(v){
    if (v == null || v === "") return "";
    // a date from Excel (or a date written out) is local midnight: read it by its local day, not in UTC (a day early in India)
    const day = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (v instanceof Date) return day(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0");
    m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/);
    if (m){ const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[2].toLowerCase()) + 1;
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      if (mo) return y + "-" + String(mo).padStart(2, "0") + "-" + String(m[1]).padStart(2, "0"); }
    const d = new Date(s);
    return isNaN(d) ? "" : day(d);
  },
  // one row per invoice line, whichever marketplace it came from
  read(grid, kind){
    const head = grid[0] || [], rows = grid.slice(1);
    const at = names => this.pick(head, names);
    const C = {
      amazon: {no: ["invoicenumber", "creditnoteno", "vatinvoicenumber"], date: ["invoicedate", "creditnotedate", "shipmentdate", "orderdate"],
        party: ["buyername", "customername", "shiptoname"],
        gstin: ["customerbilltogstid", "customershiptogstid", "customerbstn", "buyergstin", "customergstin"],
        pos: ["shiptostate", "billtostate", "shipfromstate", "placeofsupply"],
        taxable: ["taxexclusivegross"], taxableParts: ["principalamount", "shippingamount", "giftwrapamount"],
        cgst: ["cgsttax", "shippingcgsttax", "giftwrapcgsttax"], sgst: ["sgsttax", "utgsttax", "shippingsgsttax", "shippingutgsttax", "giftwrapsgsttax", "giftwraputgsttax"],
        igst: ["igsttax", "shippingigsttax", "giftwrapigsttax"], cess: ["compensatorycesstax", "shippingcesstaxamount", "giftwrapcompensatorycesstax"],
        tcs: ["tcscgstamount", "tcssgstamount", "tcsigstamount", "tcsutgstamount"],
        rate: ["cgstrate", "igstrate", "taxrate"], hsn: ["hsnsac", "hsncode"], total: ["invoiceamount"], type: ["transactiontype"], order: ["orderid"]},
      flipkart: {no: ["invoiceno", "invoicenumber"], date: ["invoicedate", "orderdate"], party: ["customername", "buyername"], gstin: ["customergstin", "buyergstin"],
        pos: ["customerstate", "shiptostate", "placeofsupply"], taxable: ["taxablevalue", "productvaluebeforetax", "sellingprice"], cgst: ["cgstamount", "cgst"], sgst: ["sgstamount", "sgst"],
        igst: ["igstamount", "igst"], cess: ["cessamount"], rate: ["taxrate", "gstrate"], hsn: ["hsncode", "hsn"], total: ["invoiceamount", "finalinvoiceamount"], type: ["eventtype", "transactiontype"], order: ["orderid"]},
      shopify: {no: ["name", "orderid", "invoicenumber"], date: ["createdat", "paidat", "date"], party: ["billingname", "customername", "shippingname"],
        gstin: ["gstin", "taxid"], pos: ["shippingprovince", "billingprovince"], taxable: ["lineitemprice", "subtotal", "subtotalprice"],
        cgst: ["tax1value", "cgst"], sgst: ["tax2value", "sgst"], igst: ["tax3value", "igst"], cess: ["cess"], rate: ["tax1rate", "taxrate"],
        hsn: ["hsn", "sku"], total: ["total", "totalprice"], type: ["financialstatus"], order: ["name"]},
      generic: {no: ["invoicenumber", "invoiceno"], date: ["invoicedate", "date"], party: ["customername", "party"], gstin: ["gstin", "customergstin"],
        pos: ["placeofsupply", "state"], taxable: ["taxablevalue", "taxable"], cgst: ["cgst"], sgst: ["sgst"], igst: ["igst"], cess: ["cess"],
        rate: ["rate", "taxrate"], hsn: ["hsn", "hsncode"], total: ["invoicevalue", "total"], type: ["type"], order: ["orderid"]}
    }[kind] || {};
    const idx = {}, many = {};
    Object.keys(C).forEach(k => {
      idx[k] = at(C[k]);
      many[k] = C[k].map(n => head.findIndex(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "") === n)).filter(i => i >= 0);
    });
    const get = (r, k) => idx[k] >= 0 ? r[idx[k]] : "";
    // a figure that arrives in pieces, like Amazon's item, shipping and gift wrap
    const sum = (r, k) => (many[k] || []).reduce((a, i) => a + num(r[i]), 0);
    const amount = (r, k) => {
      if ((many[k] || []).length > 1) return sum(r, k);
      return num(get(r, k));
    };
    const byInvoice = new Map();
    rows.forEach(r => {
      if (!r || !r.length) return;
      const typ = String(get(r, "type") || "").toLowerCase();
      const back = /refund|return|cancel|credit/.test(typ);
      const cnIdx = at(["creditnoteno", "creditnotenumber"]);
      const cn = back && cnIdx >= 0 ? String(r[cnIdx] || "").trim() : "";
      const no = cn || String(get(r, "no") || get(r, "order") || "").trim();
      if (!no) return;
      const against = cn ? String(get(r, "no") || "").trim() : "";
      const sign = back ? -1 : 1;
      const key = no + "|" + (back ? "CN" : "INV");
      const inv = byInvoice.get(key) || {no, against, date: this.date(get(r, "date")), party: String(get(r, "party") || "").trim(),
        gstin: String(get(r, "gstin") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), pos: String(get(r, "pos") || "").trim(),
        hsn: String(get(r, "hsn") || "").trim(), taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0,
        note: back ? "credit" : "", market: kind, lines: 0, tcs: 0};
      const taxable = num(get(r, "taxable")) || sum(r, "taxableParts");
      inv.taxable = r2(inv.taxable + sign * Math.abs(taxable));
      inv.cgst = r2(inv.cgst + sign * Math.abs(amount(r, "cgst")));
      inv.sgst = r2(inv.sgst + sign * Math.abs(amount(r, "sgst")));
      inv.igst = r2(inv.igst + sign * Math.abs(amount(r, "igst")));
      inv.cess = r2(inv.cess + sign * Math.abs(amount(r, "cess")));
      inv.tcs = r2((inv.tcs || 0) + sign * Math.abs(sum(r, "tcs")));
      inv.total = r2(inv.total + sign * Math.abs(num(get(r, "total")) || (taxable + amount(r, "cgst") + amount(r, "sgst") + amount(r, "igst"))));
      inv.lines++;
      if (!inv.date) inv.date = this.date(get(r, "date"));
      byInvoice.set(key, inv);
    });
    const out = Array.from(byInvoice.values()).filter(x => x.taxable || x.total);
    out.forEach(x => { const tax = r2(x.cgst + x.sgst + x.igst); x.rate = x.taxable ? Math.round(tax / x.taxable * 10000) / 100 : 0; });
    return out;
  },
  async fromFile(file){
    const name = String(file.name || "").toLowerCase();
    let grid;
    if (/\.(xlsx|xls)$/.test(name)){
      await ensureXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
      grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ""});
    } else {
      const text = await file.text();
      const sep = (text.split("\n")[0].match(/\t/g) || []).length > 2 ? "\t" : ",";
      grid = text.split(/\r?\n/).filter(Boolean).map(line => {
        const out = []; let cur = "", q = false;
        for (let i = 0; i < line.length; i++){
          const ch = line[i];
          if (ch === '"'){ if (q && line[i + 1] === '"'){ cur += '"'; i++; } else q = !q; }
          else if (ch === sep && !q){ out.push(cur); cur = ""; }
          else cur += ch;
        }
        out.push(cur); return out;
      });
    }
    // the header may sit a few rows down
    let hi = 0;
    for (let i = 0; i < Math.min(8, grid.length); i++){
      const k = this.detect(grid[i] || []);
      if (k){ hi = i; break; }
    }
    const kind = this.detect(grid[hi] || []);
    if (!kind) return {error: "That file was not recognised as an Amazon, Flipkart or Shopify sales report."};
    const invoices = this.read(grid.slice(hi), kind);
    return {kind, invoices, rows: grid.length - hi - 1};
  }
};

// a marketplace report becomes invoices and credit notes in Sales
async function importMarketFile(file){
  const s = SL(), cid = S.coId;
  s.busy = "Reading " + file.name + "\u2026"; render();
  try {
    const r = await Market.fromFile(file);
    if (r.error){ s.busy = ""; toast(r.error); render(); return; }
    let added = 0, again = 0;
    r.invoices.forEach(inv => {
      const no = normInv(inv.no + (inv.note === "credit" ? "-CN" : ""));
      if (s.list.some(v => normInv(v.x.number) === no)){ again++; return; }
      const x = {number: inv.no + (inv.note === "credit" && !/^cn/i.test(inv.no) ? " (CN)" : ""), againstInvoice: inv.against || "", date: inv.date, customerName: inv.party || (inv.gstin ? "" : "Retail customer"),
        customerGstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(inv.gstin) ? inv.gstin : "",
        placeOfSupply: inv.pos, hsn: inv.hsn, taxable: Math.abs(inv.taxable), cgst: Math.abs(inv.cgst), sgst: Math.abs(inv.sgst),
        igst: Math.abs(inv.igst), cess: Math.abs(inv.cess), total: Math.abs(inv.total), rate: inv.rate,
        noteKind: inv.note || "", ecommerce: inv.market, tcs: Math.abs(inv.tcs || 0)};
      const v = newInvoice(x, "market", {fileName: file.name, market: inv.market});
      s.list.push(v); mapInvoice(v); added++;
    });
    saveSales();
    s.busy = ""; render();
    toast(({amazon: "Amazon", flipkart: "Flipkart", shopify: "Shopify", generic: "That"})[r.kind] + " report: " + added + " invoice" + (added === 1 ? "" : "s") +
      " added" + (again ? ", " + again + " were already here" : "") + ", from " + r.rows + " rows.");
  } catch (e){
    s.busy = ""; toast("Could not read that file: " + ((e && e.message) || e)); render();
  }
}
async function uploadSales(files){
  const s = SL(); if (!s) return;
  const cid = s.cid;
  let added = 0;
  // a PDF holding several sales invoices is read one invoice at a time
  const items = [];
  for (const f of files){
    const g = isPdf(f) ? await invoiceGroups(f) : null;
    if (g && g.length > 1){ g.forEach(pg => items.push({file: f, pages: pg})); toast(f.name + " holds " + g.length + " invoices: each is read separately."); }
    else items.push({file: f, pages: g && g.length === 1 ? g[0] : null});
  }
  for (const it of items){
    const file = it.file;
    s.busy = "Reading " + file.name + "\u2026"; render();
    try {
      const hash = (await fileHash(file)) + (it.pages ? "p" + it.pages.join(",") : "");
      const same = s.list.find(v => v.hash === hash);
      if (same){ toast(file.name + " was already uploaded (invoice " + (same.x.number || "?") + ")."); continue; }
      const r = await readSalesFile(file, cid, m => { s.busy = file.name + ": " + m + "\u2026"; render(); }, it.pages);
      // the same invoice arriving inside another file is not added twice
      const no = normInv(r.x && r.x.number);
      const twin = no && s.list.find(v => normInv(v.x.number) === no && (!v.x.date || !r.x.date || v.x.date === r.x.date));
      if (twin){ toast("Invoice " + r.x.number + " is already in Sales; not added again."); continue; }
      const v = newInvoice(r.x, "upload", {hash, fileName: file.name + (it.pages ? " \u00b7 page" + (it.pages.length > 1 ? "s " + it.pages[0] + "\u2013" + it.pages[it.pages.length - 1] : " " + it.pages[0]) : ""), method: r.method, trace: r.trace});
      S.files["sv:" + v.id] = file; FileStore.put(cid, "sv:" + v.id, file); CloudDocs.add(cid, "sv:" + v.id, file, "sale");
      s.list.push(v);
      mapInvoice(v);
      added++;
    } catch (e){
      toast(file.name + ": " + (e && e.code === "sales_unreadable" ? "the invoice could not be read. Create it by hand with Create invoice." : e && e.code === "sales_type" ? "use a PDF or a photo." : errCopy(e && e.code)));
    }
  }
  s.busy = "";
  saveSales();
  if (added) toast(added + " sales invoice" + (added > 1 ? "s" : "") + " read.");
  s.filter = "review";
  render();
  if (added && bridgeLive()) salesAutoSync(true);
}
// A sales invoice uploaded from the client list or under Invoices is filed in that client's Sales
function salesTwin(o, x){ const n = normInv(x && x.number); return !!n && normInv(o.x && o.x.number) === n && (!o.x.date || !x.date || o.x.date === x.date); }
async function salesIngest(cid, file, r, hash){
  if (!(await charge("sales", 1, file && file.name, "Sales invoice read"))) throw {code: "no_credit"};
  const co = CO(cid);
  const x = r.method && /^claude/.test(r.method) && r.j && r.j.vendorGstin === co.gstin
    ? {number: r.j.invoiceNo || "", date: r.j.invoiceDate || "", sellerGstin: co.gstin, customerName: r.j.buyerName || "", customerGstin: fixGstin(r.j.buyerGstin).value || "", pos: stateOfGstin(fixGstin(r.j.buyerGstin).value),
       taxable: num(r.j.taxableValue), cgst: num(r.j.cgst), sgst: num(r.j.sgst), igst: num(r.j.igst), cess: 0, total: num(r.j.totalAmount), items: []}
    : salesFromFree({j: r.j}, co, r.j && r.j.salesText);
  x.noteKind = x.noteKind || (r.j && r.j.noteKind) || noteKindOf(String((r.j && (r.j.salesText || r.j.hint)) || "").split(/\n| {3,}/));
  const v = newInvoice(x, "upload", {hash, fileName: file.name, method: r.method || "", needsMap: true, trace: r.trace || []});
  if (S.sales && S.sales.cid === cid){
    if (S.sales.list.some(o => o.hash === hash || salesTwin(o, x))) return false;
    S.sales.list.push(v); v.needsMap = false; mapInvoice(v); saveSales(); render();
  } else {
    const list = (await BankDB.get("sales:" + cid)) || [];
    if (list.some(o => o.hash === hash || salesTwin(o, x))) return false;
    list.push(v);
    await BankDB.set("sales:" + cid, list);
  }
  S.files["sv:" + v.id] = file;
  return true;
}
/* ---------- creating a sales invoice ---------- */
function seriesNumber(cfg, date, n){ return String(cfg.series || "INV/{FY}/").replace(/\{FY\}/g, fyLabel(date)) + String(n).padStart(num(cfg.pad) || 1, "0"); }
function nextInvoiceNumber(date){
  const s = SL(), cfg = s.cfg;
  let n = Math.max(1, num(cfg.next) || 1);
  const used = new Set(s.list.map(v => normInvNo(v.x.number)));
  while (used.has(normInvNo(seriesNumber(cfg, date, n)))) n++;
  return {number: seriesNumber(cfg, date, n), n};
}
function blankItem(){ return {desc: "", hsn: "", qty: 1, unit: "Nos", rate: 0, disc: 0, taxable: 0, gstRate: 18}; }
function startDraft(fromId){
  const s = SL(), co = CO(s.cid);
  if (fromId){
    const v = inv(fromId);
    s.draft = {editId: v.id, x: JSON.parse(JSON.stringify(v.x)), customerLedger: v.customerLedger, printedTotal: v.source === "created" ? null : num(v.x.total)};
    if (!s.draft.x.items.length) s.draft.x.items = [blankItem()];
  } else {
    const date = new Date().toISOString().slice(0, 10);
    const nn = nextInvoiceNumber(date);
    s.draft = {x: {number: nn.number, date, customerName: "", customerGstin: "", address: "", pos: stateOfGstin(co.gstin), items: [blankItem()], notes: "", dueDays: 0, poNo: "", ewayNo: "",
      taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundOff: 0, total: 0, sellerGstin: co.gstin || ""}, customerLedger: "", seriesN: nn.n};
  }
  recalcDraft();
  s.view = "create";
  render();
  window.scrollTo(0, 0);
}
function recalcDraft(){
  const s = SL(), d = s.draft, co = CO(s.cid), x = d.x;
  const inter = isInterState(x, co);
  // the client's state not known (no GSTIN): no GST is worked out until it is (CGST + SGST or IGST cannot be told)
  const noState = !stateOfGstin(co.gstin);
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  x.items.forEach(it => {
    it.taxable = r2(num(it.qty) * num(it.rate) * (1 - num(it.disc) / 100));
    taxable += it.taxable;
    const t = noState ? 0 : r2(it.taxable * num(it.gstRate) / 100);
    if (inter) igst += t; else { cgst += r2(t / 2); sgst += r2(t - r2(t / 2)); }
  });
  x.taxable = r2(taxable); x.cgst = r2(cgst); x.sgst = r2(sgst); x.igst = r2(igst);
  // cess typed on the item lines (cess goods); an invoice with cess only as one figure keeps it
  if (x.items.some(it => it.cess !== undefined && it.cess !== "")) x.cess = r2(x.items.reduce((a, it) => a + num(it.cess), 0));
  const gross = r2(x.taxable + x.cgst + x.sgst + x.igst + num(x.cess));
  x.total = s.cfg.noRound ? gross : Math.round(gross);
  x.roundOff = r2(x.total - gross);
  d.inter = inter; d.noState = noState;
}
function draftProblems(){
  const s = SL(), x = s.draft.x, p = [];
  if (!x.number) p.push("Enter the invoice number.");
  else if (s.list.some(v => v.id !== s.draft.editId && normInvNo(v.x.number) === normInvNo(x.number) && fyLabel(v.x.date) === fyLabel(x.date))) p.push("Invoice number " + x.number + " is already used.");
  if (!x.date) p.push("Enter the invoice date.");
  if (!x.customerName.trim()) p.push("Choose the customer.");
  if (x.customerGstin && !gstinValid(x.customerGstin)) p.push("The customer GSTIN is not valid.");
  if (!x.pos) p.push("Choose the place of supply.");
  if (!stateOfGstin(CO(s.cid).gstin) && x.items.some(it => num(it.gstRate) > 0 && num(it.rate) > 0)) p.push("This client has no GSTIN in Client setup, so GST cannot be charged: add the GSTIN, or set the items to 0%.");
  const items = x.items.filter(it => it.desc.trim() || num(it.rate));
  if (!items.length) p.push("Add at least one item.");
  items.forEach((it, i) => { if (!it.desc.trim()) p.push("Item " + (i + 1) + ": enter the description."); if (!(num(it.qty) > 0)) p.push("Item " + (i + 1) + ": enter the quantity."); if (!(num(it.rate) > 0)) p.push("Item " + (i + 1) + ": enter the rate."); });
  if (hasLedgerList() && s.draft.customerLedger && !exactLedger(s.draft.customerLedger)) p.push("The customer ledger is not in Tally: create it first.");
  return p;
}
function saveDraft(){
  const s = SL(), d = s.draft, co = CO(s.cid);
  recalcDraft();
  const probs = draftProblems();
  if (probs.length){ toast(probs[0]); d.showErrors = true; render(); return null; }
  d.x.items = d.x.items.filter(it => it.desc.trim() || num(it.rate));
  let v;
  if (d.editId){
    v = inv(d.editId);
    if (v.status === "posted"){ toast("This invoice is already in Tally; it cannot be changed here."); return null; }
    if (d.printedTotal && Math.abs(d.printedTotal - num(d.x.total)) > 1) toast("The items add up to " + money(d.x.total) + ", but the invoice shows " + money(d.printedTotal) + ". Check the items.");
    v.x = JSON.parse(JSON.stringify(d.x)); v.updatedAt = new Date().toISOString();
  } else {
    v = newInvoice(JSON.parse(JSON.stringify(d.x)), "created");
    s.list.push(v);
    // move the series on
    if (normInvNo(d.x.number) === normInvNo(seriesNumber(s.cfg, d.x.date, d.seriesN))) s.cfg.next = d.seriesN + 1;
  }
  v.customerLedger = exactLedger(d.customerLedger) || ""; v.userLedger = !!v.customerLedger;
  // remember items for next time
  d.x.items.forEach(it => { const k = it.desc.trim().toLowerCase(); if (k) s.cfg.items[k] = {desc: it.desc.trim(), hsn: it.hsn, unit: it.unit, rate: num(it.rate), gstRate: num(it.gstRate)}; });
  mapInvoice(v);
  if (v.customerLedger) learnCustomer(v);
  saveSales({cfg: true});
  s.draft = null; s.view = "list"; s.openId = v.id; s.filter = v.status === "ready" ? "ready" : "review";
  toast("Invoice " + v.x.number + " saved" + (v.status === "ready" ? " and ready for Tally." : ". Check it in To review."));
  render();
  return v;
}
function stateOptions(sel){ return '<option value="">\u2014 Choose \u2014</option>' + Object.entries(GST_STATES).map(([c, n]) => '<option value="' + c + '"' + (c === sel ? " selected" : "") + ">" + c + " \u00b7 " + esc(n) + "</option>").join(""); }
/* ---------- the printed invoice ---------- */
function invoiceHtml(x, co, cfg){
  const inter = isInterState(x, co);
  const home = stateOfGstin(co.gstin);
  const items = (x.items || []).filter(it => it.desc || num(it.taxable));
  const hsn = new Map();
  items.forEach(it => { const k = (it.hsn || "\u2014") + "|" + num(it.gstRate); const e = hsn.get(k) || {hsn: it.hsn || "\u2014", rate: num(it.gstRate), taxable: 0}; e.taxable = r2(e.taxable + num(it.taxable)); hsn.set(k, e); });
  const f = n => INR.format(r2(n));
  const e = esc;
  const lines = items.length ? items : [{desc: "As per details", hsn: "", qty: "", unit: "", rate: "", taxable: x.taxable, gstRate: num(x.taxable) ? r2((num(x.cgst) + num(x.sgst) + num(x.igst)) / num(x.taxable) * 100) : 0}];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tax Invoice ' + e(x.number) + "</title><style>" +
    "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}" +
    ".inv{max-width:780px;margin:0 auto;border:1px solid #333}.row{display:flex}.cell{padding:6px 8px}.b{border-bottom:1px solid #333}.r{border-right:1px solid #333}" +
    "h1{font-size:18px;margin:0}h2{font-size:14px;margin:0;letter-spacing:.08em}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:4px 5px;vertical-align:top}" +
    "th{background:#f0f0f0;font-size:10px}.n{text-align:right;white-space:nowrap}.muted{color:#555}.w50{width:50%}.tot td{font-weight:bold}.sign{height:70px}" +
    "@media print{.noprint{display:none}}</style></head><body>" +
    '<p class="noprint" style="text-align:center"><button onclick="window.print()">Print / Save as PDF</button></p>' +
    '<div class="inv"><div class="cell b" style="text-align:center"><h2>TAX INVOICE</h2>' + (x.irn ? '<div class="muted">IRN: ' + e(x.irn) + "</div>" : "") +
      (x.ackNo ? '<div class="muted">Ack. No.: ' + e(x.ackNo) + (x.ackDt ? " · Ack. Date: " + e(fmtDateTime(x.ackDt)) : "") + "</div>" : "") +
      (x.irnStatus === "cancelled" ? '<div><b>IRN CANCELLED</b></div>' : "") +
      // the signed QR code of the e-invoice (rule 48(4)), drawn in the printed page from the IRP's signed text
      (x.signedQr && x.irnStatus !== "cancelled" ? '<div id="einvqr" style="display:inline-block;margin-top:6px"></div><scr' + 'ipt src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></scr' + 'ipt>' +
        "<scr" + "ipt>try{new QRCode(document.getElementById('einvqr'),{text:" + JSON.stringify(String(x.signedQr)).replace(/</g, "\\u003c") + ",width:150,height:150,correctLevel:QRCode.CorrectLevel.L})}catch(e){}</scr" + "ipt>" : "") + "</div>" +
    '<div class="row b"><div class="cell r w50"><h1>' + e(co.name) + "</h1>" + (cfg.address ? "<div>" + e(cfg.address).replace(/\n/g, "<br>") + "</div>" : "") +
      (co.gstin ? "<div><b>GSTIN:</b> " + e(co.gstin) + "</div>" : "") + (co.pan || co.gstin ? "<div><b>PAN:</b> " + e(co.pan || String(co.gstin).slice(2, 12)) + "</div>" : "") +
      (home ? "<div><b>State:</b> " + e(GST_STATES[home] || "") + " (" + home + ")</div>" : "") + (cfg.phone ? "<div>Phone: " + e(cfg.phone) + "</div>" : "") + (cfg.email ? "<div>Email: " + e(cfg.email) + "</div>" : "") + "</div>" +
      '<div class="cell w50"><table style="border:0"><tbody>' +
      [["Invoice No.", x.number], ["Invoice Date", fmtDate(x.date)], ["Place of Supply", x.pos ? (GST_STATES[x.pos] || "") + " (" + e(x.pos) + ")" : ""], ["Reverse Charge", "No"], ["Order / PO Ref.", x.poNo], ["E-way Bill No.", x.ewayNo], ["Credit period", x.dueDays ? x.dueDays + " days" : ""]]
        .filter(r => r[1]).map(r => '<tr><td style="border:0;padding:2px 0" class="muted">' + r[0] + '</td><td style="border:0;padding:2px 0"><b>' + e(r[1]) + "</b></td></tr>").join("") + "</tbody></table></div></div>" +
    '<div class="cell b"><div class="muted">Bill to</div><div style="font-size:13px"><b>' + e(x.customerName) + "</b></div>" + (x.address ? "<div>" + e(x.address).replace(/\n/g, "<br>") + "</div>" : "") +
      "<div><b>GSTIN:</b> " + (x.customerGstin ? e(x.customerGstin) : "Unregistered") + (x.pos ? " &nbsp; <b>State:</b> " + e(GST_STATES[x.pos] || "") + " (" + e(x.pos) + ")" : "") + "</div></div>" +
    "<table><thead><tr><th>#</th><th>Description of goods / services</th><th>HSN/SAC</th><th class=\"n\">Qty</th><th>Unit</th><th class=\"n\">Rate</th><th class=\"n\">Disc %</th><th class=\"n\">Taxable value</th><th class=\"n\">GST %</th>" +
      (inter ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>') + '<th class="n">Amount</th></tr></thead><tbody>' +
      lines.map((it, i) => { const t = r2(num(it.taxable) * num(it.gstRate) / 100), c = r2(t / 2);
        return "<tr><td>" + (i + 1) + "</td><td>" + e(it.desc) + "</td><td>" + e(it.hsn || "") + '</td><td class="n">' + e(it.qty) + "</td><td>" + e(it.unit || "") + '</td><td class="n">' + (it.rate !== "" ? f(it.rate) : "") + '</td><td class="n">' + (num(it.disc) ? num(it.disc) : "") + '</td><td class="n">' + f(it.taxable) + '</td><td class="n">' + num(it.gstRate) + "%</td>" +
          (inter ? '<td class="n">' + f(t) + "</td>" : '<td class="n">' + f(c) + '</td><td class="n">' + f(t - c) + "</td>") + '<td class="n">' + f(num(it.taxable) + t) + "</td></tr>"; }).join("") +
      '<tr class="tot"><td colspan="7" class="n">Total</td><td class="n">' + f(x.taxable) + "</td><td></td>" + (inter ? '<td class="n">' + f(x.igst) + "</td>" : '<td class="n">' + f(x.cgst) + '</td><td class="n">' + f(x.sgst) + "</td>") + '<td class="n">' + f(num(x.taxable) + num(x.cgst) + num(x.sgst) + num(x.igst)) + "</td></tr></tbody></table>" +
    '<div class="row b"><div class="cell r w50"><div class="muted">Amount in words</div><div><b>' + e(rupeesInWords(x.total)) + "</b></div>" +
      (x.notes ? '<div style="margin-top:6px" class="muted">Notes</div><div>' + e(x.notes).replace(/\n/g, "<br>") + "</div>" : "") + "</div>" +
      '<div class="cell w50"><table><tbody><tr><td>Taxable value</td><td class="n">' + f(x.taxable) + "</td></tr>" +
      (inter ? '<tr><td>IGST</td><td class="n">' + f(x.igst) + "</td></tr>" : '<tr><td>CGST</td><td class="n">' + f(x.cgst) + '</td></tr><tr><td>SGST</td><td class="n">' + f(x.sgst) + "</td></tr>") +
      (num(x.cess) ? '<tr><td>Cess</td><td class="n">' + f(x.cess) + "</td></tr>" : "") + (num(x.roundOff) ? '<tr><td>Round off</td><td class="n">' + f(x.roundOff) + "</td></tr>" : "") +
      '<tr class="tot"><td>Invoice total</td><td class="n">\u20b9 ' + f(x.total) + "</td></tr></tbody></table></div></div>" +
    (hsn.size ? '<table><thead><tr><th>HSN/SAC</th><th class="n">Taxable value</th><th class="n">Rate</th>' + (inter ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>') + '<th class="n">Total tax</th></tr></thead><tbody>' +
      Array.from(hsn.values()).map(hh => { const t = r2(hh.taxable * hh.rate / 100), c = r2(t / 2); return "<tr><td>" + e(hh.hsn) + '</td><td class="n">' + f(hh.taxable) + '</td><td class="n">' + hh.rate + "%</td>" + (inter ? '<td class="n">' + f(t) + "</td>" : '<td class="n">' + f(c) + '</td><td class="n">' + f(t - c) + "</td>") + '<td class="n">' + f(t) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
    '<div class="row"><div class="cell r w50">' + (cfg.bankAc ? '<div class="muted">Bank details</div><div>' + e(cfg.bankName) + (cfg.bankBranch ? ", " + e(cfg.bankBranch) : "") + "<br>A/c No.: <b>" + e(cfg.bankAc) + "</b><br>IFSC: <b>" + e(cfg.bankIfsc) + "</b></div>" : "") +
      (cfg.terms ? '<div class="muted" style="margin-top:6px">Terms and conditions</div><div>' + e(cfg.terms).replace(/\n/g, "<br>") + "</div>" : "") + "</div>" +
      '<div class="cell w50" style="text-align:right"><div>For <b>' + e(co.name) + '</b></div><div class="sign"></div><div>' + e(cfg.signatory || "Authorised Signatory") + "</div></div></div>" +
    '<div class="cell" style="border-top:1px solid #333;text-align:center" class="muted">This is a computer-generated invoice.</div></div></body></html>';
}
function printInvoiceHtml(html, number){
  let w = null;
  try { w = window.open("", "_blank"); } catch (e){ w = null; }
  if (w && w.document){
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e){} }, 400);
    return;
  }
  saveFile("Invoice-" + String(number || "draft").replace(/[^A-Za-z0-9-]+/g, "-") + ".html", new Blob([html], {type: "text/html"}));
  toast("The invoice was downloaded. Open it and choose Print \u2192 Save as PDF.");
}
/* ---------- the Sales screen ---------- */
const SALES_TABS = [["review", "To review"], ["ready", "Post to Tally"], ["done", "In Tally"]];
function salesTabStates(t){ return t === "ready" ? ["ready"] : t === "done" ? ["posted", "intally", "ignored"] : ["review"]; }
function salesCounts(){ const c = {review: 0, ready: 0, done: 0}; SL().list.forEach(v => { if (v.status === "review") c.review++; else if (v.status === "ready") c.ready++; else c.done++; }); return c; }
function salesColPass(v){
  const f = (SL() || {}).f || {}, x = v.x || {};
  if (f.from && (x.date || "") < f.from) return false;
  if (f.to && (x.date || "") > f.to) return false;
  if (f.no && !String(x.number || "").toLowerCase().includes(f.no.toLowerCase())) return false;
  if (f.cust && !String((x.customerName || "") + " " + (x.customerGstin || "") + " " + (v.customerLedger || "")).toLowerCase().includes(f.cust.toLowerCase())) return false;
  if (f.custs && f.custs.length && !f.custs.includes(x.customerName)) return false;
  if (f.min && num(x.total) < num(f.min)) return false;
  if (f.max && num(x.total) > num(f.max)) return false;
  if (f.leds && f.leds.length && !f.leds.includes(v.customerLedger)) return false;
  return true;
}
function salesColOn(){ const f = (SL() || {}).f || {}; return Object.keys(f).some(k => Array.isArray(f[k]) ? f[k].length : f[k]); }
function salesVisible(){
  const s = SL(), states = salesTabStates(s.filter), q = s.q.trim().toLowerCase();
  return s.list.filter(v => salesColPass(v) && (states.includes(v.status) || s.sticky.has(v.id)) && (!q || [v.x.number, v.x.customerName, v.x.customerGstin, v.customerLedger, v.x.total].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => String(b.x.date).localeCompare(String(a.x.date)) || String(b.x.number).localeCompare(String(a.x.number)));
}
// the Sales screen and its bar: React (app/src/screens/Sales.jsx)
function viewSales(){ return '<div data-react="Sales"></div>'; }
// the bar at the foot of sales: while making an invoice, or when there is a list (app/src/Main.jsx)
function salesBarOn(){ const s = SL(); return !!(s && !s.loading && ((s.view === "create" && s.draft) || (s.view !== "create" && s.list.length))); }
function salesLightRefresh(){ FinComReact.redraw(); }
/* ---------- to Tally ---------- */
function salesReadyProblems(list){
  const out = [];
  list.forEach(v => { mapInvoice(v); if (v.status !== "ready") out.push(v.x.number + ": " + ((v.problems || []).concat(v.ledgerIssues || [])[0] || "not ready")); });
  return out;
}
function mastersFor(list){
  const used = new Set();
  list.forEach(v => salesLines(v).forEach(l => used.add(String(l.ledger).toLowerCase())));
  return B().newLed.filter(l => !l.sent && used.has(l.name.toLowerCase()));
}
// sales vouchers already in Tally (same number) are set aside
async function salesCheckTally(list){
  const co = CO(SL().cid);
  if (!tallyVia(co) || !list.length) return 0;
  const dates = list.map(v => v.x.date).filter(Boolean).sort();
  const j = await tallyCall(co, "/vouchers?company=" + encodeURIComponent(tallyCoName(co)) + "&from=" + isoToTally(addDays(dates[0], -3)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 3)) + "&types=" + encodeURIComponent([SL().cfg.voucherType || "Sales", "Sales"].join(",")) + Bridge.pinQ());
  const nums = new Set([].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "")).flatMap(v => [normInvNo(v.number), normInvNo(v.reference)]).filter(Boolean));
  let n = 0;
  list.forEach(v => { if (nums.has(normInvNo(v.x.number))){ v.status = "intally"; v.postNote = "Already in Tally"; n++; } });
  return n;
}
// asked: someone pressed Refresh from Tally. By itself (opening the page) Tally is not read, except a first ledger list;
// sales already in Tally are still found when posting (build 190)
async function salesAutoSync(checkOnly, asked){
  const s = SL(), co = CO(s.cid);
  if (!bridgeLive(co)) return;
  try {
    if (!checkOnly && (asked || !(B().ledgers.list || []).length)) await syncLedgersFromTally(true);
    s.list.forEach(v => mapInvoice(v));
    if (asked) await salesCheckTally(s.list.filter(v => ["review", "ready"].includes(v.status)));
    saveSales(); render();
  } catch (e){ /* shown when posting */ }
}
async function postSalesToTally(){
  const s = SL(), co = CO(s.cid);
  if (!(await ensureTallyCompany(co))) return;
  await syncLedgersFromTally(true);
  let list = s.list.filter(v => v.status === "ready");
  if (!list.length) return;
  s.busy = "Checking Tally for invoices already booked\u2026"; render();
  try {
    await salesCheckTally(list);
    list = list.filter(v => v.status === "ready");
    const probs = salesReadyProblems(list);
    list = list.filter(v => v.status === "ready");
    if (!list.length){ s.busy = ""; saveSales(); toast(probs.length ? "Fix these first: " + probs.slice(0, 2).join("; ") : "These invoices are already in Tally."); render(); return; }
    const masters = mastersFor(list);
    s.busy = "Posting " + list.length + " invoice" + (list.length > 1 ? "s" : "") + " to Tally\u2026"; render();
    const tn = tallyCoName(co);
    const j = await Bridge.post({company: tn, client: co.id,
      masters: masters.map(l => ({id: "led:" + l.name, xml: customerMasterXml(l)})),
      vouchers: list.map(v => ({id: v.id, xml: salesVoucherXml(v, co)}))}, pj => { s.busy = postingLine(pj, tn); refreshBusy(); });
    const by = new Map([].concat(j.results || []).map(r => [r.id, r]));
    const now = new Date().toISOString();
    masters.forEach(l => { const r = by.get("led:" + l.name); if (r && r.ok){ l.sent = true; l.sentAt = now; } });
    let ok = 0, bad = 0;
    let optionalN = 0;
    list.forEach(v => { const r = by.get(v.id); if (r && r.ok && r.verified !== true){ bad++; const x = r; v.postError = "Tally replied 'created', but FinCom could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : ""); return; } if (r && r.ok){ ok++; v.status = "posted"; v.postedAt = now; v.postError = ""; v.postedInto = r.company || ""; v.postedOptional = !!r.optional; if (r.optional) optionalN++; learnCustomer(v); } else { bad++; v.postError = plainMsg(r && r.message) || "Tally did not confirm this invoice."; } });
    saveBank({newLed: true});
    s.busy = ""; saveSales();
    toast(ok + " posted to Tally" + (optionalN ? " (" + optionalN + " as Optional vouchers: Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers)" : "") + (bad ? "; " + bad + " not posted (see the red notes)" : "") + ".");
    if (!bad) s.filter = "done";
    syncLedgersFromTally(true);
  } catch (e){ s.busy = ""; toast("Posting failed: " + e.message); }
  render();
}
async function exportSalesXml(){
  const s = SL(), co = CO(s.cid);
  let list = s.list.filter(v => v.status === "ready");
  const probs = salesReadyProblems(list);
  list = list.filter(v => v.status === "ready");
  if (!list.length){ toast(probs.length ? "Fix these first: " + probs.slice(0, 2).join("; ") : "No invoices are ready."); render(); return; }
  const masters = mastersFor(list);
  const sv = co.tallyName ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xesc(co.tallyName) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "";
  const body = masters.map(l => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + customerMasterXml(l) + "</TALLYMESSAGE>\n").join("") + list.map(v => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + salesVoucherXml(v, co) + "</TALLYMESSAGE>\n").join("");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n<BODY>\n<IMPORTDATA>\n<REQUESTDESC><REPORTNAME>' + (masters.length ? "All Masters" : "Vouchers") + "</REPORTNAME>" + sv + "</REQUESTDESC>\n<REQUESTDATA>\n" + body + "</REQUESTDATA>\n</IMPORTDATA>\n</BODY>\n</ENVELOPE>\n";
  const fname = "sales-" + slug(co.name) + "-" + new Date().toISOString().slice(0, 10) + ".xml";
  if (!(await saveFile(fname, new Blob([xml], {type: "application/xml"})))) return;
  const now = new Date().toISOString();
  list.forEach(v => { v.status = "posted"; v.postedAt = now; v.postedVia = "file"; learnCustomer(v); });
  masters.forEach(l => { l.sent = true; l.sentAt = now; });
  saveBank({newLed: true}); saveSales();
  toast(list.length + " invoices saved to " + fname + ". Import it in Tally: Gateway \u2192 Import \u2192 Transactions.");
  render();
}
function exportSalesCsv(){
  const s = SL(), co = CO(s.cid);
  const head = ["Invoice no", "Date", "Customer", "Customer GSTIN", "Place of supply", "Taxable value", "CGST", "SGST", "IGST", "Cess", "Invoice total", "Customer ledger", "Status", "Source"];
  const rows = s.list.slice().sort((a, b) => String(a.x.date).localeCompare(String(b.x.date))).map(v => [v.x.number, v.x.date, v.x.customerName, v.x.customerGstin, v.x.pos ? GST_STATES[v.x.pos] || v.x.pos : "", v.x.taxable, v.x.cgst, v.x.sgst, v.x.igst, v.x.cess, v.x.total, v.customerLedger,
    {review: "To review", ready: "Ready", posted: "Posted", intally: "Already in Tally", ignored: "Ignored"}[v.status], v.source === "created" ? "Created" : v.fileName || "Uploaded"]);
  saveFile("sales-register-" + slug(co.name) + ".csv", "\uFEFF" + [head].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n"));
}
/* ---------- Sales: clicks, fields, selection ---------- */
function salesSnapshot(v){ return JSON.parse(JSON.stringify(v)); }
function salesSetUndo(text, before){ SL().undo = {text, before}; }
function salesUndo(){
  const s = SL(), u = s.undo; if (!u) return;
  u.before.forEach(old => { const i = s.list.findIndex(v => v.id === old.id); if (i >= 0) s.list[i] = old; else s.list.push(old); });
  s.undo = null; saveSales(); toast("Undone."); render();
}
// set a customer ledger; other open invoices of the same customer follow
function setCustomerLedger(v, ledger){
  const s = SL(), l = exactLedger(ledger);
  if (!l){ toast("\u201c" + ledger + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return false; }
  const key = salesHistKey(v);
  const targets = s.list.filter(o => o.id === v.id || (key && ["review", "ready"].includes(o.status) && salesHistKey(o) === key && !o.userLedger));
  const before = targets.map(salesSnapshot);
  targets.forEach(o => { o.customerLedger = l; o.userLedger = true; o.custSource = "Set by you"; mapInvoice(o); s.sticky.add(o.id); if (o.status === "review" && !(o.problems || []).length && !(o.ledgerIssues || []).length) o.status = "ready"; });
  learnCustomer(v);
  salesSetUndo(esc(v.x.customerName || v.x.number) + " \u2192 <b>" + esc(l) + "</b>" + (targets.length > 1 ? " \u00b7 also " + (targets.length - 1) + " more invoice" + (targets.length > 2 ? "s" : "") + " of this customer" : ""), before);
  saveSales();
  return true;
}
function salesBulk(kind, ledger){
  const s = SL(), rows = s.list.filter(v => s.sel.has(v.id) && v.status !== "posted");
  if (!rows.length) return;
  const before = rows.map(salesSnapshot);
  let n = 0;
  rows.forEach(v => {
    s.sticky.add(v.id);
    if (kind === "ledger"){ v.customerLedger = ledger; v.userLedger = true; v.custSource = "Set by you"; mapInvoice(v); if (v.status === "review" && !(v.problems || []).length && !(v.ledgerIssues || []).length) v.status = "ready"; n++; }
    if (kind === "confirm"){ mapInvoice(v); if (v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length){ v.status = "ready"; learnCustomer(v); n++; } }
    if (kind === "ignore" && v.status !== "ignored"){ v.status = "ignored"; n++; }
  });
  if (kind === "delete"){
    s.list.filter(v => s.sel.has(v.id) && v.status !== "posted").forEach(v => { if (typeof Cloud === "object") Cloud.delete("sales", s.cid, s.cid + ":" + v.id, "invoice deleted"); });
    s.list = s.list.filter(v => !(s.sel.has(v.id) && v.status !== "posted")); n = rows.length;
  }
  salesSetUndo(n + " invoice" + (n === 1 ? " " : "s ") + ({ledger: "set to <b>" + esc(ledger) + "</b>", confirm: "confirmed", ignore: "ignored", delete: "deleted"}[kind]), before);
  if (kind === "confirm" && n < rows.length) toast((rows.length - n) + " could not be confirmed: open them to see what is missing.");
  s.sel.clear(); saveSales(); render();
}
// one invoice's buttons: reread, print, file, edit, confirm, unready, ignore, restore, delete
function salesRowAct(a, id, force){
  const s = SL(); if (!s) return true;
    const v = inv(id); if (!v) return true;
    if (a === "reread"){ rereadSales(v, force); return true; }
    if (a === "print"){ printInvoiceHtml(invoiceHtml(v.x, CO(s.cid), s.cfg), v.x.number); return true; }
    if (a === "file"){ const f = S.files["sv:" + v.id]; if (f){ const u = URL.createObjectURL(f); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000); } return true; }
    if (a === "edit"){ s.openId = null; startDraft(v.id); return true; }
    const before = [salesSnapshot(v)];
    if (a === "confirm"){
      mapInvoice(v);
      const miss = (v.problems || []).concat(v.ledgerIssues || []);
      if (!v.customerLedger || miss.length){ toast(miss[0] || "Choose the customer ledger first."); s.openId = v.id; render(); return true; }
      v.status = "ready"; learnCustomer(v); salesSetUndo("Invoice " + esc(v.x.number) + " confirmed", before);
    }
    if (a === "unready"){ v.status = "review"; salesSetUndo("Invoice " + esc(v.x.number) + " moved back to review", before); }
    if (a === "ignore"){ v.status = "ignored"; if (s.openId === v.id) s.openId = null; salesSetUndo("Invoice " + esc(v.x.number) + " ignored", before); }
    if (a === "restore"){ v.status = "review"; mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number) + " restored", before); }
    if (a === "delete"){
      askConfirm({title: "Delete invoice " + (v.x.number || "") + "?", danger: true, ok: "Delete", body: "It is removed from FinCom. Tally is not changed."}).then(ans => {
        if (!ans) return;
        if (typeof Cloud === "object") Cloud.delete("sales", s.cid, s.cid + ":" + v.id, "invoice deleted");
        s.list = s.list.filter(o => o.id !== v.id); s.openId = null; salesSetUndo("Invoice " + esc(v.x.number) + " deleted", before); saveSales(); render();
      });
      return true;
    }
    s.sticky.add(v.id); saveSales(); render(); return true;
}
// the React sales screen (app/src/screens/Sales.jsx)
function salesAct(act){ return salesClick({dataset: {act}}); }
function salesTabGo(k){ const s = SL(); s.filter = k; s.sel.clear(); s.sticky.clear(); render(); }
function salesOpen(id){ SL().openId = id; render(); }
function salesSearch(q){ const s = SL(); s.q = q; s.sticky.clear(); FinComReact.redraw(); later("sq", render, 250); }
let salesLastClicked = null;
function salesToggle(id, on, shift){
  const s = SL();
  if (shift && salesLastClicked){ const vis = salesVisible().map(v => v.id); const i = vis.indexOf(salesLastClicked), j = vis.indexOf(id); if (i >= 0 && j >= 0) vis.slice(Math.min(i, j), Math.max(i, j) + 1).forEach(x => on ? s.sel.add(x) : s.sel.delete(x)); }
  else if (on) s.sel.add(id); else s.sel.delete(id);
  salesLastClicked = id; salesLightRefresh();
}
function salesSelAll(on){ const s = SL(); salesVisible().filter(v => v.status !== "posted").forEach(v => on ? s.sel.add(v.id) : s.sel.delete(v.id)); salesLightRefresh(); }
// an invoice's customer ledger; false when it is not a Tally ledger (the box goes back)
function salesSetCust(id, val){
  const s = SL(), v = inv(id); if (!v) return true;
  val = String(val || "").trim();
  if (!val){ v.customerLedger = ""; v.userLedger = false; mapInvoice(v); saveSales(); render(); return true; }
  if (!exactLedger(val)){ toast("“" + val + "” is not a Tally ledger. Choose one from the list, or create it."); return false; }
  if (s.sel.has(v.id) && s.sel.size > 1){ salesBulk("ledger", exactLedger(val)); return true; }
  if (setCustomerLedger(v, val)) render();
  return true;
}
// a field of the invoice that is open (number, date, customer, amounts)
function salesSetField(k, val){
  const v = inv(SL().openId); if (!v) return;
  const before = [salesSnapshot(v)];
  v.x[k] = ["taxable", "cgst", "sgst", "igst", "cess", "total"].includes(k) ? r2(num(val)) : k === "customerGstin" ? String(val).trim().toUpperCase() : String(val).trim();
  if (k === "customerGstin" && gstinValid(v.x.customerGstin) && !v.x.pos) v.x.pos = stateOfGstin(v.x.customerGstin);
  mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number) + " changed", before); saveSales(); render();
}
function salesSetSalesLedger(rate, val){ const v = inv(SL().openId); if (v){ v.salesLedgers = v.salesLedgers || {}; v.salesLedgers[num(rate)] = val; mapInvoice(v); saveSales(); render(); } }
// the invoice being created
function draftSet(k, val){
  const s = SL(), x = s.draft.x;
  x[k] = k === "dueDays" ? num(val) : k === "customerGstin" ? String(val).trim().toUpperCase() : val;
  if (k === "customerGstin" && gstinValid(x.customerGstin)) x.pos = stateOfGstin(x.customerGstin);
  if (k === "date" && !s.draft.editId){ const nn = nextInvoiceNumber(x.date); if (normInvNo(x.number) !== normInvNo(nn.number) && /\{FY\}/.test(s.cfg.series)){ x.number = nn.number; s.draft.seriesN = nn.n; } }
  recalcDraft(); render();
}
function draftItem(i, k, val){
  const s = SL(), it = s.draft.x.items[i]; if (!it) return;
  it[k] = ["qty", "rate", "disc", "gstRate", "cess"].includes(k) ? num(val) : val;
  // an HSN/SAC used before gives its GST rate (the item memory kept from saved invoices)
  if (k === "hsn"){ const code = String(val).replace(/\D/g, ""); const m = code.length >= 4 && Object.values(s.cfg.items || {}).find(t => String(t.hsn || "").replace(/\D/g, "") === code); if (m && m.gstRate != null) it.gstRate = num(m.gstRate); }
  if (k === "desc"){ const m = s.cfg.items[String(val).trim().toLowerCase()]; if (m){ if (!it.hsn) it.hsn = m.hsn; if (!num(it.rate)) it.rate = m.rate; it.unit = m.unit || it.unit; it.gstRate = m.gstRate; } }
  recalcDraft(); render();
}
function draftItemRemove(i){ const s = SL(); s.draft.x.items.splice(i, 1); if (!s.draft.x.items.length) s.draft.x.items.push(blankItem()); recalcDraft(); render(); }
// the customer of the invoice being created; false when it is not a Tally ledger
function draftCust(val){
  const s = SL(); val = String(val || "").trim();
  if (!val){ s.draft.customerLedger = ""; render(); return true; }
  const l = exactLedger(val);
  if (!l){ toast("“" + val + "” is not a Tally ledger. Choose one, or create it from the list."); return false; }
  applyDraftCustomer(l); return true;
}
// Sales settings
function salesCfg(k, val){ const s = SL(); s.cfg[k] = ["next", "pad"].includes(k) ? Math.max(1, Math.round(num(val))) : val; saveSales({cfg: true}); render(); }
function salesCfgCheck(k, on){ const s = SL(); s.cfg[k] = on; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); render(); }
function salesCfgLedger(k, val){ const s = SL(); s.cfg.ledgers = s.cfg.ledgers || {}; s.cfg.ledgers[k] = val; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); saveSales(); render(); }
function salesClick(t){
  const s = SL(); if (!s) return false;
  if (t.dataset.svact){ salesRowAct(t.dataset.svact, t.dataset.id, t.dataset.force || null); return true; }
  switch (t.dataset.act){
    case "salesPick": document.getElementById("salesIn").click(); return true;
    case "ledPick": { const el = document.getElementById("ledIn"); if (el) el.click(); return true; }
    case "salesNew": startDraft(); return true;
    case "salesCancel": s.draft = null; s.view = "list"; render(); return true;
    case "salesSave": saveDraft(); return true;
    case "salesPrintDraft": recalcDraft(); printInvoiceHtml(invoiceHtml(s.draft.x, CO(s.cid), s.cfg), s.draft.x.number); return true;
    case "salesAddItem": s.draft.x.items.push(blankItem()); render(); const last = document.querySelector('[data-fk="si:' + (s.draft.x.items.length - 1) + ':desc"]'); if (last) last.focus(); return true;
    case "salesSettings": s.showSettings = true; render(); return true;
    case "salesSettingsClose": s.showSettings = false; s.list.forEach(v => mapInvoice(v)); saveSales(); render(); return true;
    case "salesClose": s.openId = null; render(); return true;
    case "salesCsv": closeMenus(); exportSalesCsv(); return true;
    case "salesFile": closeMenus(); exportSalesXml(); return true;
    case "salesPost": postSalesToTally(); return true;
    case "salesSync": closeMenus(); salesAutoSync(false, true).then(() => toast("Refreshed from Tally.")); return true;
    case "salesUndo": salesUndo(); return true;
    case "salesUndoOk": s.undo = null; salesLightRefresh(); return true;
    case "salesSelNone": s.sel.clear(); salesLightRefresh(); return true;
    case "salesBulkConfirm": salesBulk("confirm"); return true;
    case "salesBulkIgnore": salesBulk("ignore"); return true;
    case "salesBulkDelete": askConfirm({title: "Delete " + s.sel.size + " invoices?", danger: true, ok: "Delete", body: "They are removed from FinCom. Tally is not changed."}).then(a => { if (a) salesBulk("delete"); }); return true;
    case "salesBulkPrint": { const rows = s.list.filter(v => s.sel.has(v.id)); const co = CO(s.cid);
      const html = rows.map(v => invoiceHtml(v.x, co, s.cfg)).join("").replace(/<\/body><\/html><!doctype html><html lang="en"><head>[\s\S]*?<body>(<p class="noprint"[\s\S]*?<\/p>)?/g, '<div style="page-break-before:always"></div>');
      printInvoiceHtml(html, rows.length + "-invoices"); return true; }
    case "salesBulkLedger": { const inp = document.querySelector("[data-svbulk]"); const l = exactLedger(inp && inp.value); if (!l){ toast("Choose a Tally ledger for the selected invoices."); return true; } acClose(); salesBulk("ledger", l); return true; }
    case "salesConfirmAll": {
      const rows = s.list.filter(v => v.status === "review" && v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length);
      const before = rows.map(salesSnapshot);
      rows.forEach(v => { v.status = "ready"; s.sticky.add(v.id); learnCustomer(v); });
      salesSetUndo(rows.length + " invoices confirmed", before); saveSales(); render(); return true;
    }
    case "salesForget": askConfirm({title: "Forget customer memory?", ok: "Forget", body: "FinCom forgets which ledger was used for each customer. Invoices keep their ledgers."}).then(a => { if (a){ s.hist = {}; saveSales({hist: true}); toast("Forgotten."); } }); return true;
    case "salesDelAll": askConfirm({title: "Delete all " + s.list.length + " sales invoices?", danger: true, ok: "Delete all", body: "They are removed from FinCom. Tally is not changed."}).then(a => { if (a){ s.list = []; s.openId = null; s.showSettings = false; saveSales(); render(); } }); return true;
  }
  return false;
}
function salesChange(t){
  const s = SL(); if (!s) return false;
  if (t.id === "salesIn"){ const files = Array.from(t.files || []); t.value = ""; uploadSales(files); return true; }
  if (t.id === "ledIn"){ const f = t.files && t.files[0]; t.value = ""; if (f) importLedgerList(f).then(() => { s.list.forEach(v => mapInvoice(v)); saveSales(); render(); }); return true; }
  return false;
}
function applyDraftCustomer(ledgerName){
  const s = SL(), d = s.draft, info = ledgerInfo(ledgerName) || {};
  d.customerLedger = ledgerName;
  if (!d.x.customerName || d.x.customerName === d.lastAutoName) d.x.customerName = ledgerName;
  d.lastAutoName = ledgerName;
  if (info.gstin && gstinValid(String(info.gstin).toUpperCase())){ d.x.customerGstin = String(info.gstin).toUpperCase(); d.x.pos = stateOfGstin(d.x.customerGstin); }
  if (info.address && !d.x.address) d.x.address = info.address;
  recalcDraft(); render();
}
function salesInput(t){ return false; }
document.addEventListener("click", ev => {
  if (!(S.view === "company" && S.tab === "sales" && SL())) return;
  if (ev.target.hasAttribute && ev.target.hasAttribute("data-svoverlay")){ const s = SL(); s.openId = null; s.showSettings = false; render(); }
});
document.addEventListener("keydown", ev => {
  if (!(S.view === "company" && S.tab === "sales" && SL())) return;
  const s = SL();
  if (ev.key === "Escape" && (s.openId || s.showSettings) && !document.querySelector("#confirmBox[style*='flex']") && !AC.fk){ ev.preventDefault(); ev.stopImmediatePropagation(); s.openId = null; s.showSettings = false; render(); }
  if (ev.key === "Enter" && ev.target.hasAttribute && ev.target.hasAttribute("data-svbulk") && !(AC.fk && AC.idx >= 0)){ ev.preventDefault(); const l = exactLedger(ev.target.value); if (l){ acClose(); salesBulk("ledger", l); } else toast("Choose a Tally ledger."); }
}, true);

/* ---------- posting to Tally: exact ledger names, company check, overlaps, reports ---------- */
function tallyLedgerName(n){ return (S.bank && S.bank.ledgers && hasLedgerList() && exactLedger(n)) || n; }
function fpHash(s){ let h = 5381; const t = String(s || ""); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
const ROLE_GROUPS = {party: /sundry|creditors|debtors|current liab|loans|capital/i, expense: /expense|purchase|direct|indirect|fixed assets/i, gst: /duties|taxes/i, tds: /duties|taxes|current liab|provisions/i, roundoff: /./, "rcm-in": /duties|taxes/i, "rcm-out": /duties|taxes/i, sales: /sales/i, tax: /duties|taxes/i};
const ROLE_WORDS = {gst: /gst/i, tds: /tds/i, roundoff: /round/i, "rcm-in": /gst/i, "rcm-out": /gst/i, tax: /gst|cess/i};
// Tally ledgers closest to a name that Tally does not have
function suggestLedgers(name, role, n){
  if (!hasLedgerList()) return [];
  const g = ROLE_GROUPS[role] || /./, w = ROLE_WORDS[role];
  return (B().ledgers.list || []).map(l => {
    let sc = nameSim(name, l.name);
    if (g.test(l.group || "")) sc += 0.15;
    if (w && w.test(l.name)) sc += 0.25;
    return {l, sc};
  }).filter(x => x.sc >= 0.35).sort((a, b) => b.sc - a.sc).slice(0, n || 3).map(x => x.l.name);
}
// Company default ledgers (input GST, TDS by payment type, round off) matched to this client's Tally ledgers
function autoMapCompanyLedgers(co){
  if (!co || !S.bank || S.bank.cid !== co.id || !hasLedgerList()) return [];
  const list = S.bank.ledgers.list, changes = [];
  const taxes = list.filter(l => /duties|taxes|current liab|provisions/i.test(l.group || ""));
  const one = arr => arr.length === 1 ? arr[0].name : "";
  const fix = (cur, set, find, role) => {
    if (cur && exactLedger(cur)){ if (exactLedger(cur) !== cur){ changes.push({from: cur, to: exactLedger(cur), role}); set(exactLedger(cur)); } return; }
    const f = find();
    if (f && f !== cur){ changes.push({from: cur, to: f, role}); set(f); }
  };
  const input = re => one(taxes.filter(l => re.test(l.name) && !/output|payable|liab|rcm|reverse|cash\s*ledger|electronic/i.test(l.name)));
  co.gst = co.gst || {};
  fix(co.gst.cgst, v => { co.gst.cgst = v; }, () => input(/(^|[^a-z])c\.?\s*gst|central\s*(gst|tax)/i), "gst");
  fix(co.gst.sgst, v => { co.gst.sgst = v; }, () => one(taxes.filter(l => /(^|[^a-z])s\.?\s*gst|state\s*(gst|tax)|utgst/i.test(l.name) && !/cgst|igst|output|payable|rcm|reverse/i.test(l.name))), "gst");
  fix(co.gst.igst, v => { co.gst.igst = v; }, () => input(/(^|[^a-z])i\.?\s*gst|integrated/i), "gst");
  fix(co.roundOff, v => { co.roundOff = v; }, () => one(list.filter(l => /round(ed|ing)?\s*[- ]?off/i.test(l.name))), "roundoff");
  const tdsL = list.filter(l => (/^tds$/i.test(l.taxType || "") || (/\btds\b|tax\s*deducted/i.test(l.name) && /duties|taxes|current liab|provisions/i.test(l.group || ""))) && !/receivable|recoverable|asset/i.test(l.name + " " + (l.group || "")));
  const kw = {contractor: /194\s*-?\s*c\b|contract/i, professional: /194\s*-?\s*j|profession|fees?\s+for\s+prof/i, technical: /194\s*-?\s*j|technical/i, director: /director/i, commission: /194\s*h|commission|brokerage/i,
    rent_building: /194\s*-?i\b|rent/i, rent_machinery: /194\s*-?i\b|rent|machin/i, interest: /194\s*a|interest/i, goods: /194\s*q|purchase|goods/i};
  co.tdsLedgers = co.tdsLedgers || {};
  const tdsPick = k => {
    const scored = tdsL.map(l => ({l, sc: (l.tdsNature && kw[k].test(l.tdsNature) ? 3 : 0) + (kw[k].test(l.name) ? 2 : 0) + (/^tds$/i.test(l.taxType || "") ? 0.5 : 0)})).filter(x => x.sc >= 2).sort((a, b) => b.sc - a.sc);
    if (scored.length && (scored.length === 1 || scored[0].sc > scored[1].sc)) return scored[0].l.name;
    const generic = tdsL.filter(l => !l.tdsNature && !Object.values(kw).some(re => re.test(l.name)));
    return tdsL.length === 1 ? tdsL[0].name : generic.length === 1 ? generic[0].name : "";
  };
  Object.keys(kw).forEach(k => fix(co.tdsLedgers[k], v => { co.tdsLedgers[k] = v; }, () => tdsPick(k), "tds"));
  const exp = list.filter(l => ROLE_GROUPS.expense.test(l.group || ""));
  co.expenseLedgers = co.expenseLedgers || {};
  Object.keys(co.expenseLedgers).forEach(k => fix(co.expenseLedgers[k], v => { co.expenseLedgers[k] = v; }, () => { const c = exp.map(l => ({l, s: nameSim(co.expenseLedgers[k], l.name)})).filter(x => x.s >= 0.85).sort((a, b) => b.s - a.s); return c.length && (c.length === 1 || c[0].s > c[1].s + 0.05) ? c[0].l.name : ""; }, "expense"));
  ["rcmCgstIn", "rcmSgstIn", "rcmIgstIn", "rcmCgstOut", "rcmSgstOut", "rcmIgstOut"].forEach(k => {
    const kind = /Cgst/.test(k) ? /cgst|central/i : /Sgst/.test(k) ? /sgst|state|utgst/i : /igst|integrated/i;
    const side = /In$/.test(k) ? /input|itc|credit/i : /output|payable|liab/i;
    fix(co.gst[k], v => { co.gst[k] = v; }, () => one(taxes.filter(l => /rcm|reverse/i.test(l.name) && kind.test(l.name) && side.test(l.name) && !(k.includes("Sgst") && /cgst|igst/i.test(l.name)))), /In$/.test(k) ? "rcm-in" : "rcm-out");
  });
  if (changes.length){
    Store.saveCompany(co);
    changes.forEach(ch => { if (ch.from) replaceLedgerInWaiting(co.id, ch.from, ch.to, ch.role, true); });
  }
  return changes;
}
// Replace a ledger name in bills that are not yet in Tally (and in the client's settings when it came from there)
function replaceLedgerInWaiting(cid, from, to, role, quiet){
  const co = CO(cid);
  let n = 0;
  Object.values(D(cid).entries || {}).forEach(e => {
    if (e.exportedAt || e.status === "rejected") return;
    let touched = false;
    const lines = e.snapshot ? e.snapshot.lines : null;
    (lines || []).forEach(l => { if (l.ledger === from && (!role || l.role === role || (role === "gst" && /rcm/.test(l.role || "")))){ l.ledger = to; touched = true; } });
    if (e.partyLedger === from && (!role || role === "party")){ e.partyLedger = to; touched = true; }
    if (e.expenseLedger === from && (!role || role === "expense")){ e.expenseLedger = to; touched = true; }
    if (touched){ e.postError = ""; n++; Store.saveEntry(cid, e); }
  });
  if (!quiet){
    let setting = false;
    if (role === "gst" || role === "rcm-in" || role === "rcm-out"){ Object.keys(co.gst || {}).forEach(k => { if (co.gst[k] === from){ co.gst[k] = to; setting = true; } }); }
    if (role === "tds"){ Object.keys(co.tdsLedgers || {}).forEach(k => { if (co.tdsLedgers[k] === from){ co.tdsLedgers[k] = to; setting = true; } }); }
    if (role === "roundoff" && co.roundOff === from){ co.roundOff = to; setting = true; }
    if (role === "expense"){ Object.keys(co.expenseLedgers || {}).forEach(k => { if (co.expenseLedgers[k] === from){ co.expenseLedgers[k] = to; setting = true; } }); }
    if (role === "party"){ Object.values(D(cid).parties || {}).forEach(p => { if (p.ledgerName === from){ p.ledgerName = to; Store.saveParty(cid, p); } }); }
    if (setting) Store.saveCompany(co);
  }
  return n;
}
function billLedgerIssues(list){
  const m = new Map();
  list.forEach(e => (e.snapshot ? e.snapshot.lines : []).forEach(l => {
    if (!l.ledger || exactLedger(l.ledger)) return;
    const k = l.role + "|" + l.ledger;
    const x = m.get(k) || {name: l.ledger, role: l.role, bills: 0};
    x.bills++; m.set(k, x);
  }));
  return Array.from(m.values());
}
function canonicalizeBills(list){
  list.forEach(e => {
    let t = false;
    (e.snapshot ? e.snapshot.lines : []).forEach(l => { const x = exactLedger(l.ledger); if (x && x !== l.ledger){ l.ledger = x; t = true; } });
    ["partyLedger", "expenseLedger"].forEach(k => { const x = exactLedger(e[k]); if (x && x !== e[k]){ e[k] = x; t = true; } });
    if (t) Store.saveEntry(S.coId, e);
  });
}
// Which Tally company is this client? Asked once when names do not match.
async function ensureTallyCompany(co){
  // build 199: Tally on another computer, the client's books in the cloud: posted through the queue there
  if (!bridgeLive(co) && typeof TCloud === "object" && TCloud.on()){ await TCloud.status(co.id); if (tallyVia(co) === "cloud") return tallyCoName(co); }
  if (!Bridge.on()){ toast("Connect FinCom Bridge first: Settings \u2192 FinCom Bridge."); return null; }
  if (!Bridge.up() || !Bridge.st.tallyUp) await Bridge.refresh();
  if (!Bridge.up() || !Bridge.st.tallyUp){ toast("Tally is not connected. See Settings \u2192 FinCom Bridge \u2192 Check my Tally."); return null; }
  let o = Bridge.openFor(co);
  if (o) return o.name;
  const open = Bridge.st.open;
  if (!open.length){ toast("No company is open in your Tally. Open " + co.name + " in TallyPrime."); return null; }
  const ans = await askConfirm({title: "Which Tally company is " + co.name + "?", ok: "Use this company",
    body: '<p class="note" style="margin:0 0 10px">FinCom could not match <b>' + esc(co.name) + "</b> to a company open in your Tally by name or GSTIN. Choose it once; it is remembered.</p>" +
      '<div class="bk-form one"><label><span>Company open in Tally</span><select id="tcoPick">' + open.map(x => '<option value="' + esc(x.name) + '">' + esc(x.name) + " (port " + x.port + ")</option>").join("") + "</select></label></div>",
    read: () => ({name: (document.getElementById("tcoPick") || {}).value || ""})});
  if (!ans || !ans.data.name) return null;
  co.tallyName = ans.data.name; Store.saveCompany(co);
  Bridge.lastOpenKey = null;
  await Bridge.refresh();
  o = Bridge.openFor(co);
  render();
  return o ? o.name : null;
}
// Live Tally ledgers for the screen being shown (at most every 20 seconds, refreshed when older than 10 minutes)
let liveSyncAt = 0;
function maybeLiveSync(){
  const co = CO(), b = S.bank;
  if (!co || !b || b.cid !== co.id || b.loading || bankSyncing || !bridgeLive(co)) return;
  // only when this client's ledger list has never been read live; never on a timer
  if (b.ledgers.live || (b.ledgers.list || []).length) return;
  if (Date.now() - liveSyncAt < 60000) return;
  liveSyncAt = Date.now();
  setTimeout(() => {
    const before = (b.ledgers.list || []).length;
    syncLedgersFromTally(true).then(() => {
      autoMapCompanyLedgers(co);
      if ((b.ledgers.list || []).length !== before) render();      // redraw only if something changed
    });
  }, 0);
}
function plainMsg(m){ const t = document.createElement("textarea"); t.innerHTML = String(m || ""); t.innerHTML = t.value; return t.value; }

