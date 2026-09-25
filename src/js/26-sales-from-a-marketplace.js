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
    if (v instanceof Date) return v.toISOString().slice(0, 10);
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
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
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
  let taxable = 0, cgst = 0, sgst = 0, igst = 0;
  x.items.forEach(it => {
    it.taxable = r2(num(it.qty) * num(it.rate) * (1 - num(it.disc) / 100));
    taxable += it.taxable;
    const t = r2(it.taxable * num(it.gstRate) / 100);
    if (inter) igst += t; else { cgst += r2(t / 2); sgst += r2(t - r2(t / 2)); }
  });
  x.taxable = r2(taxable); x.cgst = r2(cgst); x.sgst = r2(sgst); x.igst = r2(igst);
  const gross = r2(x.taxable + x.cgst + x.sgst + x.igst + num(x.cess));
  x.total = s.cfg.noRound ? gross : Math.round(gross);
  x.roundOff = r2(x.total - gross);
  d.inter = inter;
}
function draftProblems(){
  const s = SL(), x = s.draft.x, p = [];
  if (!x.number) p.push("Enter the invoice number.");
  else if (s.list.some(v => v.id !== s.draft.editId && normInvNo(v.x.number) === normInvNo(x.number) && fyLabel(v.x.date) === fyLabel(x.date))) p.push("Invoice number " + x.number + " is already used.");
  if (!x.date) p.push("Enter the invoice date.");
  if (!x.customerName.trim()) p.push("Choose the customer.");
  if (x.customerGstin && !gstinValid(x.customerGstin)) p.push("The customer GSTIN is not valid.");
  if (!x.pos) p.push("Choose the place of supply.");
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
function viewSalesCreate(){
  const s = SL(), d = s.draft, x = d.x, co = CO(s.cid), cfg = s.cfg;
  const probs = d.showErrors ? draftProblems() : [];
  const itemMemory = Object.values(cfg.items || {});
  let h = '<div class="bk"><div class="bk-head"><div class="bk-id"><h2 class="bk-title">' + (d.editId ? "Edit sales invoice" : "New sales invoice") + '</h2><div class="bk-sub">' + esc(co.name) + (co.gstin ? " \u00b7 GSTIN " + esc(co.gstin) : "") + " \u00b7 " + esc(GST_STATES[stateOfGstin(co.gstin)] || "") + "</div></div>" +
    '<div></div><div class="bk-actions"><button class="btn small" data-act="salesCancel">Cancel</button><button class="btn small" data-act="salesPrintDraft">Preview / Print</button><button class="btn primary small" data-act="salesSave">Save invoice</button></div></div>';
  if (probs.length) h += '<div class="bk-alert bad">' + probs.map(esc).join("<br>") + "</div>";
  h += '<div class="si-grid"><section class="si-card"><h3>Invoice</h3><div class="bk-form">' +
    '<label><span>Invoice number</span><input type="text" data-sd="number" data-fk="sd:number" data-keeptyped value="' + esc(x.number) + '"></label>' +
    '<label><span>Invoice date</span><input type="date" data-sd="date" value="' + esc(x.date) + '"></label>' +
    '<label><span>Credit period (days)</span><input type="number" min="0" data-sd="dueDays" value="' + esc(x.dueDays || "") + '"></label>' +
    '<label><span>Order / PO reference</span><input type="text" data-sd="poNo" data-fk="sd:poNo" data-keeptyped value="' + esc(x.poNo || "") + '"></label>' +
    '<label><span>E-way bill no. (optional)</span><input type="text" data-sd="ewayNo" data-fk="sd:ewayNo" data-keeptyped value="' + esc(x.ewayNo || "") + '"></label>' +
    '<label><span>IRN (if e-invoiced)</span><input type="text" data-sd="irn" data-fk="sd:irn" data-keeptyped value="' + esc(x.irn || "") + '"></label></div></section>' +
    '<section class="si-card"><h3>Bill to</h3><div class="bk-form">' +
    '<label><span>Customer ledger (Tally)</span><input type="text" class="lgbox' + (d.customerLedger ? " done" : "") + '" data-sdcust data-fk="sdcust" data-keeptyped data-ac="1" autocomplete="off" value="' + esc(d.customerLedger || "") + '" placeholder="Type to search customers"></label>' +
    '<label><span>Name on invoice</span><input type="text" data-sd="customerName" data-fk="sd:customerName" data-keeptyped value="' + esc(x.customerName) + '"></label>' +
    '<label><span>GSTIN (blank if unregistered)</span><input type="text" data-sd="customerGstin" data-fk="sd:customerGstin" data-keeptyped maxlength="15" value="' + esc(x.customerGstin) + '"></label>' +
    '<label><span>Address</span><textarea rows="2" data-sd="address" data-fk="sd:address" data-keeptyped>' + esc(x.address || "") + "</textarea></label>" +
    '<label><span>Place of supply</span><select data-sd="pos">' + stateOptions(x.pos) + "</select></label>" +
    '<p class="note" style="margin:0">' + (d.inter ? "Another state: <b>IGST</b> is charged." : "Same state: <b>CGST + SGST</b> are charged.") + "</p></div></section></div>";
  // items
  h += '<datalist id="itemMemory">' + itemMemory.map(it => '<option value="' + esc(it.desc) + '">').join("") + "</datalist>";
  h += '<section class="si-card"><h3>Items</h3><div class="bk-tablewrap"><table class="bk-table si-items"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Disc %</th><th class="n">Taxable</th><th class="n">GST %</th><th class="n">Tax</th><th></th></tr></thead><tbody>' +
    x.items.map((it, i) => '<tr><td class="dt">' + (i + 1) + "</td>" +
      '<td><input type="text" list="itemMemory" data-si="' + i + '" data-sk="desc" data-fk="si:' + i + ':desc" data-keeptyped value="' + esc(it.desc) + '" placeholder="Goods or service"></td>' +
      '<td><input type="text" class="w90" data-si="' + i + '" data-sk="hsn" data-fk="si:' + i + ':hsn" data-keeptyped value="' + esc(it.hsn) + '"></td>' +
      '<td class="n"><input type="number" step="any" min="0" class="w70 n" data-si="' + i + '" data-sk="qty" value="' + esc(it.qty) + '"></td>' +
      '<td><select data-si="' + i + '" data-sk="unit">' + SALES_UNITS.map(u => "<option" + (u === it.unit ? " selected" : "") + ">" + u + "</option>").join("") + "</select></td>" +
      '<td class="n"><input type="number" step="any" min="0" class="w100 n" data-si="' + i + '" data-sk="rate" value="' + esc(it.rate) + '"></td>' +
      '<td class="n"><input type="number" step="any" min="0" max="100" class="w60 n" data-si="' + i + '" data-sk="disc" value="' + esc(it.disc || 0) + '"></td>' +
      '<td class="n">' + INR.format(it.taxable) + "</td>" +
      '<td class="n"><select data-si="' + i + '" data-sk="gstRate">' + SALES_RATES.map(r => '<option value="' + r + '"' + (num(it.gstRate) === r ? " selected" : "") + ">" + r + "%</option>").join("") + "</select></td>" +
      '<td class="n">' + INR.format(r2(it.taxable * num(it.gstRate) / 100)) + "</td>" +
      '<td class="ac"><button class="icon" data-sirm="' + i + '" aria-label="Remove item" title="Remove item">\u2715</button></td></tr>').join("") +
    '</tbody></table></div><div class="row" style="margin-top:8px"><button class="btn small" data-act="salesAddItem">+ Add item</button></div></section>';
  // totals
  const groups = salesTotals(x);
  h += '<div class="si-grid"><section class="si-card"><h3>Notes</h3><textarea rows="4" data-sd="notes" data-fk="sd:notes" data-keeptyped placeholder="Shown on the invoice">' + esc(x.notes || "") + '</textarea><p class="note">Bank details, terms and signatory come from Sales settings.</p></section>' +
    '<section class="si-card"><h3>Totals</h3><dl class="si-tot"><div><dt>Taxable value</dt><dd>' + INR.format(x.taxable) + "</dd></div>" +
    groups.filter(g => g.rate).map(g => d.inter ? "<div><dt>IGST @ " + g.rate + "%</dt><dd>" + INR.format(r2(g.taxable * g.rate / 100)) + "</dd></div>"
      : "<div><dt>CGST @ " + g.rate / 2 + "%</dt><dd>" + INR.format(r2(g.taxable * g.rate / 200)) + "</dd></div><div><dt>SGST @ " + g.rate / 2 + "%</dt><dd>" + INR.format(r2(g.taxable * g.rate / 100 - r2(g.taxable * g.rate / 200))) + "</dd></div>").join("") +
    (x.roundOff ? "<div><dt>Round off</dt><dd>" + INR.format(x.roundOff) + "</dd></div>" : "") +
    '<div class="big"><dt>Invoice total</dt><dd>' + money(x.total) + '</dd></div></dl><p class="note">' + esc(rupeesInWords(x.total)) + "</p></section></div>";
  h += "</div>";
  return h;
}
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
    '<div class="inv"><div class="cell b" style="text-align:center"><h2>TAX INVOICE</h2>' + (x.irn ? '<div class="muted">IRN: ' + e(x.irn) + "</div>" : "") + "</div>" +
    '<div class="row b"><div class="cell r w50"><h1>' + e(co.name) + "</h1>" + (cfg.address ? "<div>" + e(cfg.address).replace(/\n/g, "<br>") + "</div>" : "") +
      (co.gstin ? "<div><b>GSTIN:</b> " + e(co.gstin) + "</div>" : "") + (co.pan || co.gstin ? "<div><b>PAN:</b> " + e(co.pan || String(co.gstin).slice(2, 12)) + "</div>" : "") +
      (home ? "<div><b>State:</b> " + e(GST_STATES[home] || "") + " (" + home + ")</div>" : "") + (cfg.phone ? "<div>Phone: " + e(cfg.phone) + "</div>" : "") + (cfg.email ? "<div>Email: " + e(cfg.email) + "</div>" : "") + "</div>" +
      '<div class="cell w50"><table style="border:0"><tbody>' +
      [["Invoice No.", x.number], ["Invoice Date", fmtDate(x.date)], ["Place of Supply", x.pos ? (GST_STATES[x.pos] || "") + " (" + x.pos + ")" : ""], ["Reverse Charge", "No"], ["Order / PO Ref.", x.poNo], ["E-way Bill No.", x.ewayNo], ["Credit period", x.dueDays ? x.dueDays + " days" : ""]]
        .filter(r => r[1]).map(r => '<tr><td style="border:0;padding:2px 0" class="muted">' + r[0] + '</td><td style="border:0;padding:2px 0"><b>' + e(r[1]) + "</b></td></tr>").join("") + "</tbody></table></div></div>" +
    '<div class="cell b"><div class="muted">Bill to</div><div style="font-size:13px"><b>' + e(x.customerName) + "</b></div>" + (x.address ? "<div>" + e(x.address).replace(/\n/g, "<br>") + "</div>" : "") +
      "<div><b>GSTIN:</b> " + (x.customerGstin ? e(x.customerGstin) : "Unregistered") + (x.pos ? " &nbsp; <b>State:</b> " + e(GST_STATES[x.pos] || "") + " (" + x.pos + ")" : "") + "</div></div>" +
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
const SALES_TABS = [["review", "To review"], ["ready", "Ready"], ["done", "Done"]];
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
function viewSales(){
  const co = CO(), s = SL();
  if (!s || s.cid !== co.id){ loadSales(co.id); return '<p class="note">Opening sales\u2026</p>'; }
  if (s.loading) return '<p class="note">Opening sales\u2026</p>';
  if (s.view === "create" && s.draft) return viewSalesCreate();
  const tc = salesCounts();
  const live = s.list.filter(v => v.status !== "ignored");
  const sum = k => r2(live.reduce((a, v) => a + num(v.x[k]), 0));
  ensureFileInputs();
  let h = '<div class="bk sl">';
  if (s.busy) h += busyCard("Working on sales\u2026", s.busy, 0, 0);
  if (!hasLedgerList()){
    if (bridgeLive(co)) h += '<div class="bk-setup"><div><b>Loading ledgers from Tally\u2026</b></div></div>';
    else h += '<div class="bk-setup"><div><b>Tally ledgers are needed for Sales vouchers</b><div class="note">' + (Bridge.on() ? "Open " + esc(Bridge.tallyName(co)) + " in TallyPrime, or import the ledger list." : "Import the ledger list (Tally: Display More Reports \u2192 List of Accounts \u2192 Export), or connect the Tally Bridge.") + '</div></div><button class="btn small" data-act="ledPick">Import ledger list</button></div>';
  }
  h += '<div class="bk-head"><div class="bk-id"><h2 class="bk-title">Sales</h2><div class="bk-sub">' + live.length + " invoice" + (live.length === 1 ? "" : "s") + (live.length ? " \u00b7 " + fmtDate(live.map(v => v.x.date).filter(Boolean).sort()[0]) + " to " + fmtDate(live.map(v => v.x.date).filter(Boolean).sort().pop()) : "") + "</div></div>" +
    '<dl class="bk-figs"><div><dt>Taxable</dt><dd>' + INR.format(sum("taxable")) + '</dd></div><div><dt>GST</dt><dd>' + INR.format(r2(sum("cgst") + sum("sgst") + sum("igst") + sum("cess"))) + '</dd></div><div><dt>Invoice value</dt><dd>' + INR.format(sum("total")) + "</dd></div></dl>" +
    '<div class="bk-actions"><button class="btn small" data-act="salesPick">Upload invoices</button><button class="btn small" data-act="marketPick" title="Amazon MTR, Flipkart or Shopify sales report">Marketplace report</button><button class="btn small primary" data-act="salesNew">Create invoice</button><button class="btn small" data-act="salesSettings">Settings</button>' +
    '<details class="bk-menu"><summary class="btn small">More</summary><div class="bk-menu-list">' +
      (bridgeLive(co) ? '<button data-act="salesSync">Refresh from Tally</button><button data-act="salesFile">Create Tally file instead</button>' : "") +
      '<button data-act="salesCsv">Download sales register (CSV)</button></div></details></div></div>';
  if (!s.list.length){
    h += '<div class="bk-empty" id="salesDrop" data-act="salesPick" tabindex="0" role="button"><div class="bk-empty-ic">\u2912</div><h2>Add sales invoices</h2><p class="note">Upload the invoices you issued (PDF or photo) to turn them into Sales vouchers, or create a new GST invoice here: it is printed and posted in one go.</p>' +
      '<span class="btn primary">Choose files</span></div></div>';
    return h + (s.showSettings ? salesSettingsHtml() : "");
  }
  h += '<div class="bk-bar"><div class="bk-tabs" role="tablist">' + SALES_TABS.map(([k, t]) => '<button role="tab" aria-selected="' + (s.filter === k) + '" data-stab="' + k + '">' + t + ' <span class="cnt">' + tc[k] + "</span></button>").join("") + "</div>" +
    '<input type="search" class="bk-search" data-salesq data-fk="salesq" data-keeptyped autocomplete="off" placeholder="Search invoice, customer, GSTIN" value="' + esc(s.q) + '"></div>';
  const list = salesVisible();
  const nSel = list.filter(v => s.sel.has(v.id)).length;
  h += colChipBar("sales", list.length, s.list.length + " invoices");
  h += '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="ck"><input type="checkbox" data-sselall aria-label="Select all"' + (nSel && nSel === list.length ? " checked" : "") + "></th>" +
    colHead("sales", "date", "Date", "dt") + colHead("sales", "no", "Invoice") + colHead("sales", "cust", "Customer") + '<th class="n">Taxable</th><th class="n">GST</th>' + colHead("sales", "val", "Total", "n") + colHead("sales", "led", "Customer ledger", "lg") + '<th class="ac"></th></tr></thead><tbody>' +
    list.map(salesRowHtml).join("") + "</tbody></table>" + (list.length ? "" : salesColOn() ? noMatchNote("sales") : '<div class="bk-none">' + ({review: "Nothing to review.", ready: "No invoices are ready yet.", done: "Nothing posted or ignored yet."}[s.filter]) + "</div>") + "</div>";
  h += "</div>";
  if (s.openId && inv(s.openId)) h += salesDetailHtml(inv(s.openId));
  if (s.showSettings) h += salesSettingsHtml();
  return h;
}
function salesRowHtml(v){
  const s = SL(), x = v.x, sel = s.sel.has(v.id);
  const gst = r2(num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess));
  const editable = ["review", "ready"].includes(v.status);
  const issue = (v.problems || [])[0] || (v.ledgerIssues || []).find(p => !/customer ledger/.test(p)) || "";
  let cell, act;
  if (editable){
    const cls = v.status === "ready" ? " done" : v.customerLedger ? " sugg" : "";
    cell = '<input type="text" class="lgbox' + cls + '" data-svcust="' + v.id + '" data-fk="svcust:' + v.id + '" data-keeptyped data-ac="1" autocomplete="off" value="' + esc(v.customerLedger) + '" placeholder="Select customer ledger">' +
      (issue ? '<span class="src bad" title="' + esc((v.problems || []).concat(v.ledgerIssues || []).join("; ")) + '">' + esc(issue) + "</span>"
        : '<span class="src' + (v.status === "ready" ? " ok" : "") + '">' + esc(v.status === "ready" ? (v.userLedger ? "Set by you" : v.custSource || "Ready") : v.customerLedger ? "Suggested \u00b7 " + (v.custSource || "match") : "No match found") + "</span>");
    if (v.postError) cell = '<span class="src bad" title="' + esc(v.postError) + '">Tally: ' + esc(v.postError) + "</span>" + cell;
    act = (v.status === "review" && v.customerLedger && !issue ? '<button class="btn small primary" data-svact="confirm" data-id="' + v.id + '">Confirm</button>' : '<button class="btn small" data-svopen="' + v.id + '">Open</button>') +
      '<button class="icon" data-svact="ignore" data-id="' + v.id + '" title="Ignore" aria-label="Ignore">\u2715</button>';
  } else {
    cell = '<span class="lgtext">' + esc(v.customerLedger || "\u2014") + '</span><span class="src muted">' + esc(v.status === "posted" ? "Posted " + (v.postedAt ? shortDate(v.postedAt.slice(0, 10)) : "") : v.status === "intally" ? "Already in Tally" : "Ignored") + (v.receivedAt ? " \u00b7 paid " + shortDate(v.receivedAt) : "") + "</span>";
    act = '<button class="btn small" data-svopen="' + v.id + '">Open</button>' + (v.status === "posted" ? "" : '<button class="linkbtn" data-svact="restore" data-id="' + v.id + '">Restore</button>');
  }
  return '<tr class="' + (sel ? "picked" : "") + '"><td class="ck"><input type="checkbox" data-ssel="' + v.id + '"' + (sel ? " checked" : "") + (v.status === "posted" ? " disabled" : "") + ' aria-label="Select"></td>' +
    '<td class="dt" title="' + esc(fmtDate(x.date)) + '">' + (x.date ? shortDate(x.date) : "\u2014") + "</td>" +
    '<td class="pt"><div class="pn"><button class="linkbtn strong" data-svopen="' + v.id + '">' + esc(x.number || "(no number)") + '</button></div><div class="nr">' + (v.source === "created" ? "Created here" : esc(v.fileName || "Uploaded")) + "</div></td>" +
    '<td class="pt"><div class="pn">' + esc(x.customerName || "\u2014") + '</div><div class="nr">' + esc(x.customerGstin || "Unregistered") + (x.pos ? " \u00b7 " + esc(GST_STATES[x.pos] || x.pos) : "") + "</div></td>" +
    '<td class="n">' + INR.format(num(x.taxable)) + '</td><td class="n">' + INR.format(gst) + '</td><td class="n"><b>' + INR.format(num(x.total)) + "</b></td>" +
    '<td class="lg">' + cell + '</td><td class="ac">' + act + "</td></tr>";
}
function salesDetailHtml(v){
  const s = SL(), x = v.x, co = CO(s.cid);
  const ro = !["review", "ready"].includes(v.status);
  const lines = salesLines(v);
  const dr = r2(lines.filter(l => l.side === "Dr").reduce((a, l) => a + l.amt, 0)), cr = r2(lines.filter(l => l.side === "Cr").reduce((a, l) => a + l.amt, 0));
  const fld = (label, k, type) => '<label><span>' + label + '</span><input type="' + (type || "text") + '"' + (type === "number" ? ' step="0.01"' : "") + ' data-sv="' + k + '" data-fk="sv:' + v.id + ":" + k + '"' + (type === "date" ? "" : " data-keeptyped") + ' value="' + esc(x[k] == null ? "" : x[k]) + '"' + (ro ? " disabled" : "") + "></label>";
  const probs = (v.problems || []).concat(v.ledgerIssues || []);
  let h = '<div class="bk-overlay" data-svoverlay><div class="bk-panel wide" role="dialog" aria-modal="true" aria-labelledby="svT"><div class="bk-panel-head"><h2 id="svT">Invoice ' + esc(x.number || "") + ' <span class="tag ' + ({ready: "ok", review: "warn", posted: "ok", intally: "no", ignored: "no"}[v.status]) + '">' + ({ready: "Ready", review: "To review", posted: "Posted", intally: "In Tally", ignored: "Ignored"}[v.status]) + '</span></h2><button class="icon" data-act="salesClose" aria-label="Close">\u2715</button></div>';
  if (probs.length) h += '<div class="bk-alert bad">' + probs.map(esc).join("<br>") + "</div>";
  if (v.postError) h += '<div class="bk-alert bad">Tally: ' + esc(v.postError) + "</div>";
  h += '<section><h3>Invoice details</h3><div class="bk-form">' + fld("Invoice number", "number") + fld("Date", "date", "date") + fld("Customer name", "customerName") + fld("Customer GSTIN", "customerGstin") +
    '<label><span>Place of supply</span><select data-sv="pos"' + (ro ? " disabled" : "") + ">" + stateOptions(x.pos) + "</select></label>" +
    fld("Taxable value", "taxable", "number") + fld("CGST", "cgst", "number") + fld("SGST", "sgst", "number") + fld("IGST", "igst", "number") + fld("Cess", "cess", "number") + fld("Invoice total", "total", "number") + "</div>";
  if ((x.items || []).length) h += '<div class="bk-tablewrap" style="margin-top:10px"><table class="bk-table"><thead><tr><th>Item</th><th>HSN</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th><th class="n">GST %</th></tr></thead><tbody>' +
    x.items.map(it => "<tr><td>" + esc(it.desc) + "</td><td>" + esc(it.hsn || "") + '</td><td class="n">' + esc(it.qty) + " " + esc(it.unit || "") + '</td><td class="n">' + INR.format(num(it.rate)) + '</td><td class="n">' + INR.format(num(it.taxable)) + '</td><td class="n">' + num(it.gstRate) + "%</td></tr>").join("") + "</tbody></table></div>";
  h += "</section>";
  h += '<section><h3>Sales voucher for Tally</h3><div class="bk-form"><label><span>Customer ledger</span><input type="text" class="lgbox" data-svcust="' + v.id + '" data-fk="svcustd:' + v.id + '" data-keeptyped data-ac="1" autocomplete="off" value="' + esc(v.customerLedger) + '"' + (ro ? " disabled" : "") + "></label>" +
    salesTotals(x).map(g => '<label><span>Sales ledger ' + rateTag(g.rate) + "%</span><select data-svsales=\"" + g.rate + '"' + (ro ? " disabled" : "") + ">" + ledgerOptions(lines.find(l => l.role === "sales" && l.rate === g.rate).ledger, /sales accounts?/i) + "</select></label>").join("") + "</div>" +
    '<div class="bk-tablewrap" style="margin-top:10px"><table class="bk-table"><thead><tr><th>Ledger</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>' +
    lines.map(l => "<tr><td>" + (l.ledger ? esc(l.ledger) : '<span class="src bad">not set</span>') + (l.ledger && !exactLedger(l.ledger) ? ' <span class="src bad">not in Tally</span>' : "") + '</td><td class="n">' + (l.side === "Dr" ? INR.format(l.amt) : "") + '</td><td class="n">' + (l.side === "Cr" ? INR.format(l.amt) : "") + "</td></tr>").join("") +
    '<tr><td><b>Total</b></td><td class="n"><b>' + INR.format(dr) + '</b></td><td class="n"><b>' + INR.format(cr) + "</b></td></tr></tbody></table></div>" +
    '<p class="note">Voucher type \u201c' + esc(s.cfg.voucherType || "Sales") + "\u201d \u00b7 bill-wise New Ref " + esc(x.number) + (co.createOptional ? " \u00b7 posted as Optional" : "") + "</p></section>";
  if ((v.trace || []).length) h += '<section><h3>How it was read</h3><ol class="note">' + v.trace.map(t => "<li>" + (t.ok ? "\u2714 " : "\u2716 ") + esc(t.step) + ": " + esc(t.note || "") + "</li>").join("") + "</ol></section>";
  h += '<section class="row" style="gap:6px;flex-wrap:wrap">' +
    (v.source === "upload" ? '<span class="note">Read again:</span><button class="btn small" data-svact="reread" data-force="" data-id="' + v.id + '">Free</button>' +
      '<button class="btn small" data-svact="reread" data-force="google" data-id="' + v.id + '"' + (googleReady() ? "" : " disabled") + '>Google OCR</button>' +
      '<button class="btn small" data-svact="reread" data-force="claude" data-id="' + v.id + '"' + (claudeReady() ? "" : " disabled") + ">Claude</button>" : "") +
    (v.status === "review" ? '<button class="btn primary" data-svact="confirm" data-id="' + v.id + '">Confirm</button>' : "") +
    (v.status === "ready" ? '<button class="btn" data-svact="unready" data-id="' + v.id + '">Back to review</button>' : "") +
    '<button class="btn" data-svact="print" data-id="' + v.id + '">Print invoice</button>' +
    (S.files["sv:" + v.id] ? '<button class="btn" data-svact="file" data-id="' + v.id + '">View uploaded file</button>' : "") +
    (!ro ? '<button class="btn" data-svact="edit" data-id="' + v.id + '">' + (v.source === "created" ? "Edit invoice" : (x.items || []).length ? "Edit items" : "Enter items") + "</button>" : "") +
    (!ro ? '<button class="btn" data-svact="ignore" data-id="' + v.id + '">Ignore</button>' : "") +
    (v.status !== "posted" ? '<button class="btn danger" data-svact="delete" data-id="' + v.id + '">Delete</button>' : "") + "</section>";
  return h + "</div></div>";
}
function salesSettingsHtml(){
  const s = SL(), c = s.cfg, co = CO(s.cid);
  const f = (label, k, ph) => '<label><span>' + label + '</span><input type="text" data-scfg="' + k + '" value="' + esc(c[k] == null ? "" : c[k]) + '" placeholder="' + esc(ph || "") + '"></label>';
  const rates = Array.from(new Set(s.list.flatMap(v => salesTotals(v.x).map(g => g.rate)).concat([5, 18]))).sort((a, b) => a - b);
  const home = stateOfGstin(co.gstin);
  let h = '<div class="bk-overlay" data-svoverlay><div class="bk-panel" role="dialog" aria-modal="true" aria-labelledby="ssT"><div class="bk-panel-head"><h2 id="ssT">Sales settings \u2014 ' + esc(co.name) + '</h2><button class="icon" data-act="salesSettingsClose" aria-label="Close">\u2715</button></div>';
  h += '<section><h3>Invoice numbers</h3><div class="bk-form">' + f("Series ({FY} = financial year)", "series", "INV/{FY}/") + f("Next number", "next") + f("Digits", "pad") + '</div><p class="note">Next invoice: <b>' + esc(nextInvoiceNumber(new Date().toISOString().slice(0, 10)).number) + "</b></p></section>";
  h += '<section><h3>Your details on invoices</h3><div class="bk-form">' +
    '<label><span>Address</span><textarea rows="3" data-scfg="address">' + esc(c.address) + "</textarea></label>" + f("Phone", "phone") + f("Email", "email") +
    f("Bank name", "bankName") + f("Account number", "bankAc") + f("IFSC", "bankIfsc") + f("Branch", "bankBranch") +
    '<label><span>Terms and conditions</span><textarea rows="3" data-scfg="terms">' + esc(c.terms) + "</textarea></label>" + f("Signatory (below the signature)", "signatory", "Authorised Signatory") +
    '</div><p class="note">GSTIN, PAN and state come from Company settings' + (co.gstin ? " (" + esc(co.gstin) + ", " + esc(GST_STATES[home] || "") + ")" : ": add the GSTIN there") + ".</p></section>";
  h += '<section><h3>Tally ledgers</h3><p class="note">Found automatically in the ledger list. Choose them here if this client names them differently.</p><div class="bk-form">' +
    f("Voucher type", "voucherType", "Sales") +
    '<label><span>Sales ledger (all rates)</span><select data-sled="sales">' + ledgerOptions(exactLedger((c.ledgers || {}).sales) || "", /sales accounts?/i) + "</select></label>" +
    rates.map(r => '<label><span>Sales ' + rateTag(r) + "% \u2014 same state</span><select data-sled=\"sales_" + rateTag(r) + '_l">' + ledgerOptions(salesLedgerFor(r, false), /sales accounts?/i) + "</select></label>" +
      '<label><span>Sales ' + rateTag(r) + "% \u2014 other state</span><select data-sled=\"sales_" + rateTag(r) + '_i">' + ledgerOptions(salesLedgerFor(r, true), /sales accounts?/i) + "</select></label>").join("") +
    ["cgst", "sgst", "igst", "cess"].map(k => '<label><span>Output ' + k.toUpperCase() + '</span><select data-sled="' + k + '">' + ledgerOptions(taxLedgerFor(k, 18), /duties|taxes/i) + "</select></label>").join("") +
    '<label><span>Round off</span><select data-sled="roundOff">' + ledgerOptions(roundOffLedger(), /indirect/i) + "</select></label></div></section>";
  h += '<section><h3>Automation</h3><label class="chk"><input type="checkbox" data-scfgc="auto"' + (c.auto !== false ? " checked" : "") + "> Mark invoices Ready when everything checks out and the customer is certain (GSTIN on the Tally ledger, or booked the same way before)</label>" +
    '<label class="chk"><input type="checkbox" data-scfgc="noRound"' + (c.noRound ? " checked" : "") + "> Do not round invoice totals to the rupee</label></section>";
  h += '<section><h3>Clean up</h3><div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn small" data-act="salesForget">Forget customer memory</button><button class="btn small danger" data-act="salesDelAll"' + (s.list.length ? "" : " disabled") + ">Delete all sales invoices</button></div></section>";
  return h + "</div></div>";
}
function salesBar(){
  const s = SL();
  if (!s || s.loading || s.view === "create" || !s.list.length) return s && s.view === "create" && s.draft ? '<div class="actionbar bk-actionbar"><div class="ab-left"><span class="bk-stat"><b>' + money(s.draft.x.total) + '</b> invoice total</span></div><div class="ab-right"><button class="btn" data-act="salesCancel">Cancel</button><button class="btn" data-act="salesPrintDraft">Preview / Print</button><button class="btn primary" data-act="salesSave">Save invoice</button></div></div>' : "";
  const tc = salesCounts();
  const nsel = s.sel.size;
  let left, right;
  if (nsel){
    const rows = s.list.filter(v => s.sel.has(v.id));
    left = "<b>" + nsel + " selected</b> <span class=\"muted\">\u00b7 " + INR.format(r2(rows.reduce((a, v) => a + num(v.x.total), 0))) + '</span> <button class="linkbtn" data-act="salesSelNone">Clear</button>';
    right = '<input type="text" class="lgbox" data-svbulk data-fk="svbulk" data-keeptyped data-ac="1" autocomplete="off" placeholder="Customer ledger for the ' + nsel + ' selected">' +
      '<button class="btn" data-act="salesBulkLedger">Apply</button>' +
      (rows.some(v => v.status === "review") ? '<button class="btn primary" data-act="salesBulkConfirm">Confirm</button>' : "") +
      (rows.some(v => ["review", "ready"].includes(v.status)) ? '<button class="btn" data-act="salesBulkIgnore">Ignore</button>' : "") +
      '<button class="btn" data-act="salesBulkPrint">Print</button>' +
      (rows.every(v => v.status !== "posted") ? '<button class="btn danger" data-act="salesBulkDelete">Delete</button>' : "");
  } else {
    const confirmable = s.list.filter(v => v.status === "review" && v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length).length;
    left = '<span class="bk-stat"><b>' + tc.review + '</b> to review</span><span class="bk-stat"><b>' + tc.ready + "</b> ready to post</span>";
    right = (confirmable ? '<button class="btn" data-act="salesConfirmAll">Confirm all suggestions (' + confirmable + ")</button>" : "") +
      (Bridge.on() && Bridge.up() ? '<button class="btn primary" data-act="salesPost"' + (tc.ready ? "" : " disabled") + ">Post to Tally (" + tc.ready + ")</button>"
        : '<button class="btn primary" data-act="salesFile"' + (tc.ready ? "" : " disabled") + ">Create Tally file (" + tc.ready + ")</button>");
  }
  let snack = "";
  if (s.undo && !nsel) snack = '<div class="bk-snack"><span>' + s.undo.text + '</span><button class="linkbtn" data-act="salesUndo">Undo</button><button class="icon" data-act="salesUndoOk" aria-label="Close">\u2715</button></div>';
  return '<div class="actionbar bk-actionbar">' + snack + '<div class="ab-left">' + left + '</div><div class="ab-right">' + right + "</div></div>";
}
function salesLightRefresh(){
  const s = SL();
  document.querySelectorAll("[data-ssel]").forEach(el => { const on = s.sel.has(el.dataset.ssel); if (el.checked !== on) el.checked = on; const tr = el.closest("tr"); if (tr) tr.classList.toggle("picked", on); });
  const bar = document.querySelector(".actionbar"), html = salesBar();
  if (bar && html){ const t = document.createElement("div"); t.innerHTML = html; bar.replaceWith(t.firstElementChild); }
}
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
  if (!bridgeLive(co) || !list.length) return 0;
  const dates = list.map(v => v.x.date).filter(Boolean).sort();
  const j = await Bridge.call("/vouchers?company=" + encodeURIComponent(Bridge.openFor(co).name) + "&from=" + isoToTally(addDays(dates[0], -3)) + "&to=" + isoToTally(addDays(dates[dates.length - 1], 3)) + "&types=" + encodeURIComponent([SL().cfg.voucherType || "Sales", "Sales"].join(",")) + Bridge.pinQ());
  const nums = new Set([].concat(j.vouchers || []).filter(v => !/^yes$/i.test(v.cancelled || "")).flatMap(v => [normInvNo(v.number), normInvNo(v.reference)]).filter(Boolean));
  let n = 0;
  list.forEach(v => { if (nums.has(normInvNo(v.x.number))){ v.status = "intally"; v.postNote = "Already in Tally"; n++; } });
  return n;
}
async function salesAutoSync(checkOnly){
  const s = SL(), co = CO(s.cid);
  if (!bridgeLive(co)) return;
  try {
    if (!checkOnly && (!B().ledgers.live || Date.now() - new Date(B().ledgers.importedAt || 0) > 10 * 60000)) await syncLedgersFromTally(true);
    s.list.forEach(v => mapInvoice(v));
    await salesCheckTally(s.list.filter(v => ["review", "ready"].includes(v.status)));
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
    const j = await Bridge.call("/import", {company: Bridge.openFor(co).name,
      masters: masters.map(l => ({id: "led:" + l.name, xml: customerMasterXml(l)})),
      vouchers: list.map(v => ({id: v.id, xml: salesVoucherXml(v, co)}))}, 600000);
    const by = new Map([].concat(j.results || []).map(r => [r.id, r]));
    const now = new Date().toISOString();
    masters.forEach(l => { const r = by.get("led:" + l.name); if (r && r.ok){ l.sent = true; l.sentAt = now; } });
    let ok = 0, bad = 0;
    let optionalN = 0;
    list.forEach(v => { const r = by.get(v.id); if (r && r.ok && r.verified !== true){ bad++; const x = r; v.postError = "Tally replied 'created', but TDS Desk could not find the entry in Tally afterwards, so it is NOT marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x.verifyNote ? " [" + x.verifyNote + "]" : ""); return; } if (r && r.ok){ ok++; v.status = "posted"; v.postedAt = now; v.postError = ""; v.postedInto = r.company || ""; v.postedOptional = !!r.optional; if (r.optional) optionalN++; learnCustomer(v); } else { bad++; v.postError = plainMsg(r && r.message) || "Tally did not confirm this invoice."; } });
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
    s.list = s.list.filter(v => !(s.sel.has(v.id) && v.status !== "posted")); n = rows.length;
  }
  salesSetUndo(n + " invoice" + (n === 1 ? " " : "s ") + ({ledger: "set to <b>" + esc(ledger) + "</b>", confirm: "confirmed", ignore: "ignored", delete: "deleted"}[kind]), before);
  if (kind === "confirm" && n < rows.length) toast((rows.length - n) + " could not be confirmed: open them to see what is missing.");
  s.sel.clear(); saveSales(); render();
}
function salesClick(t){
  const s = SL(); if (!s) return false;
  if (t.dataset.stab){ s.filter = t.dataset.stab; s.sel.clear(); s.sticky.clear(); render(); return true; }
  if (t.dataset.svopen){ s.openId = t.dataset.svopen; render(); return true; }
  if (t.dataset.sirm !== undefined && s.draft){ s.draft.x.items.splice(+t.dataset.sirm, 1); if (!s.draft.x.items.length) s.draft.x.items.push(blankItem()); recalcDraft(); render(); return true; }
  if (t.hasAttribute && (t.hasAttribute("data-ssel") || t.hasAttribute("data-sselall"))) return true;
  if (t.dataset.svact){
    const v = inv(t.dataset.id); if (!v) return true;
    const a = t.dataset.svact;
    if (a === "reread"){ rereadSales(v, t.dataset.force || null); return true; }
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
      askConfirm({title: "Delete invoice " + (v.x.number || "") + "?", danger: true, ok: "Delete", body: "It is removed from TDS Desk. Tally is not changed."}).then(ans => {
        if (!ans) return;
        s.list = s.list.filter(o => o.id !== v.id); s.openId = null; salesSetUndo("Invoice " + esc(v.x.number) + " deleted", before); saveSales(); render();
      });
      return true;
    }
    s.sticky.add(v.id); saveSales(); render(); return true;
  }
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
    case "salesSync": closeMenus(); salesAutoSync(false).then(() => toast("Refreshed from Tally.")); return true;
    case "salesUndo": salesUndo(); return true;
    case "salesUndoOk": s.undo = null; salesLightRefresh(); return true;
    case "salesSelNone": s.sel.clear(); salesLightRefresh(); return true;
    case "salesBulkConfirm": salesBulk("confirm"); return true;
    case "salesBulkIgnore": salesBulk("ignore"); return true;
    case "salesBulkDelete": askConfirm({title: "Delete " + s.sel.size + " invoices?", danger: true, ok: "Delete", body: "They are removed from TDS Desk. Tally is not changed."}).then(a => { if (a) salesBulk("delete"); }); return true;
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
    case "salesForget": askConfirm({title: "Forget customer memory?", ok: "Forget", body: "TDS Desk forgets which ledger was used for each customer. Invoices keep their ledgers."}).then(a => { if (a){ s.hist = {}; saveSales({hist: true}); toast("Forgotten."); } }); return true;
    case "salesDelAll": askConfirm({title: "Delete all " + s.list.length + " sales invoices?", danger: true, ok: "Delete all", body: "They are removed from TDS Desk. Tally is not changed."}).then(a => { if (a){ s.list = []; s.openId = null; s.showSettings = false; saveSales(); render(); } }); return true;
  }
  return false;
}
function salesChange(t){
  const s = SL(); if (!s) return false;
  if (t.id === "salesIn"){ const files = Array.from(t.files || []); t.value = ""; uploadSales(files); return true; }
  if (t.id === "ledIn"){ const f = t.files && t.files[0]; t.value = ""; if (f) importLedgerList(f).then(() => { s.list.forEach(v => mapInvoice(v)); saveSales(); render(); }); return true; }
  if (t.dataset.svcust){
    const v = inv(t.dataset.svcust); if (!v) return true;
    const val = t.value.trim();
    if (!val){ v.customerLedger = ""; v.userLedger = false; mapInvoice(v); saveSales(); render(); return true; }
    if (!exactLedger(val)){ t.value = v.customerLedger || ""; toast("\u201c" + val + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return true; }
    if (s.sel.has(v.id) && s.sel.size > 1){ salesBulk("ledger", exactLedger(val)); return true; }
    if (setCustomerLedger(v, val)) render();
    return true;
  }
  if (t.dataset.sv){
    const v = inv(s.openId); if (!v) return true;
    const k = t.dataset.sv;
    const before = [salesSnapshot(v)];
    v.x[k] = ["taxable", "cgst", "sgst", "igst", "cess", "total"].includes(k) ? r2(num(t.value)) : k === "customerGstin" ? t.value.trim().toUpperCase() : t.value.trim();
    if (k === "customerGstin" && gstinValid(v.x.customerGstin) && !v.x.pos) v.x.pos = stateOfGstin(v.x.customerGstin);
    mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number) + " changed", before); saveSales(); render(); return true;
  }
  if (t.dataset.svsales !== undefined){ const v = inv(s.openId); if (v){ v.salesLedgers = v.salesLedgers || {}; v.salesLedgers[num(t.dataset.svsales)] = t.value; mapInvoice(v); saveSales(); render(); } return true; }
  if (t.dataset.sd && s.draft){
    const k = t.dataset.sd, x = s.draft.x;
    x[k] = k === "dueDays" ? num(t.value) : k === "customerGstin" ? t.value.trim().toUpperCase() : t.value;
    if (k === "customerGstin" && gstinValid(x.customerGstin)) x.pos = stateOfGstin(x.customerGstin);
    if (k === "date" && !s.draft.editId){ const nn = nextInvoiceNumber(x.date); if (normInvNo(x.number) !== normInvNo(nn.number) && /\{FY\}/.test(s.cfg.series)) { x.number = nn.number; s.draft.seriesN = nn.n; } }
    recalcDraft(); render(); return true;
  }
  if (t.dataset.si !== undefined && s.draft){
    const it = s.draft.x.items[+t.dataset.si], k = t.dataset.sk;
    if (!it) return true;
    it[k] = ["qty", "rate", "disc", "gstRate"].includes(k) ? num(t.value) : t.value;
    if (k === "desc"){ const m = s.cfg.items[t.value.trim().toLowerCase()]; if (m){ if (!it.hsn) it.hsn = m.hsn; if (!num(it.rate)) it.rate = m.rate; it.unit = m.unit || it.unit; it.gstRate = m.gstRate; } }
    recalcDraft(); render(); return true;
  }
  if (t.hasAttribute("data-sdcust") && s.draft){
    const val = t.value.trim();
    if (!val){ s.draft.customerLedger = ""; render(); return true; }
    const l = exactLedger(val);
    if (!l){ t.value = s.draft.customerLedger || ""; toast("\u201c" + val + "\u201d is not a Tally ledger. Choose one, or create it from the list."); return true; }
    applyDraftCustomer(l); return true;
  }
  if (t.dataset.scfg){ const k = t.dataset.scfg; s.cfg[k] = ["next", "pad"].includes(k) ? Math.max(k === "pad" ? 1 : 1, Math.round(num(t.value))) : t.value; saveSales({cfg: true}); render(); return true; }
  if (t.dataset.scfgc){ s.cfg[t.dataset.scfgc] = t.checked; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); render(); return true; }
  if (t.dataset.sled){ s.cfg.ledgers = s.cfg.ledgers || {}; s.cfg.ledgers[t.dataset.sled] = t.value; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); saveSales(); render(); return true; }
  if (t.hasAttribute("data-ssel") || t.hasAttribute("data-sselall") || t.hasAttribute("data-svbulk") || t.dataset.salesq !== undefined) return true;
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
function salesInput(t){
  const s = SL(); if (!s) return false;
  if (t.hasAttribute("data-salesq")){ s.q = t.value; s.sticky.clear(); later("sq", render, 250); return true; }
  return false;
}
let salesLastClicked = null;
document.addEventListener("click", ev => {
  if (!(S.view === "company" && S.tab === "sales" && SL())) return;
  const s = SL();
  const cb = ev.target.closest && ev.target.closest("[data-ssel]");
  if (cb){
    const id = cb.dataset.ssel;
    if (ev.shiftKey && salesLastClicked){ const vis = salesVisible().map(v => v.id); const i = vis.indexOf(salesLastClicked), j = vis.indexOf(id); if (i >= 0 && j >= 0) vis.slice(Math.min(i, j), Math.max(i, j) + 1).forEach(x => cb.checked ? s.sel.add(x) : s.sel.delete(x)); }
    else if (cb.checked) s.sel.add(id); else s.sel.delete(id);
    salesLastClicked = id; salesLightRefresh(); return;
  }
  const all = ev.target.closest && ev.target.closest("[data-sselall]");
  if (all){ salesVisible().filter(v => v.status !== "posted").forEach(v => all.checked ? s.sel.add(v.id) : s.sel.delete(v.id)); salesLightRefresh(); return; }
  if (ev.target.hasAttribute && ev.target.hasAttribute("data-svoverlay")){ s.openId = null; s.showSettings = false; render(); }
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
  if (!Bridge.on()){ toast("Connect the Tally Bridge first: Settings \u2192 Tally Bridge."); return null; }
  if (!Bridge.up() || !Bridge.st.tallyUp) await Bridge.refresh();
  if (!Bridge.up() || !Bridge.st.tallyUp){ toast("Tally is not connected. See Settings \u2192 Tally Bridge \u2192 Check my Tally."); return null; }
  let o = Bridge.openFor(co);
  if (o) return o.name;
  const open = Bridge.st.open;
  if (!open.length){ toast("No company is open in your Tally. Open " + co.name + " in TallyPrime."); return null; }
  const ans = await askConfirm({title: "Which Tally company is " + co.name + "?", ok: "Use this company",
    body: '<p class="note" style="margin:0 0 10px">TDS Desk could not match <b>' + esc(co.name) + "</b> to a company open in your Tally by name or GSTIN. Choose it once; it is remembered.</p>" +
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
function postReportHtml(rep){
  if (!rep) return "";
  const bits = [(rep.posted || 0) + " posted" + (rep.company ? " into " + rep.company + " and confirmed there" : "")];

  if (rep.optional) bits.push(rep.optional + " as Optional vouchers (Tally: Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers)");
  if (rep.skipped) bits.push(rep.skipped + " already in Tally (not posted again)");
  if (rep.failed && rep.failed.length) bits.push(rep.failed.length + " not posted");
  if (rep.movedBack) bits.push(rep.movedBack + " moved back to review (ledger not in Tally)");
  return '<div class="bk-alert' + (rep.failed && rep.failed.length ? " bad" : "") + '"><b>Tally, ' + new Date(rep.at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) + ":</b> " + bits.join(" \u00b7 ") +
    (rep.failed && rep.failed.length ? '<ul style="margin:6px 0 0">' + rep.failed.slice(0, 20).map(f => "<li>" + esc(f.what) + " \u2014 " + esc(f.msg) + "</li>").join("") + "</ul>" : "") +
    ' <button class="linkbtn" data-act="' + rep.dismiss + '">Dismiss</button></div>';
}

