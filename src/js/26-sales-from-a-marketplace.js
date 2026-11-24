/* ================================================================== */
/* Sales from a marketplace: Amazon MTR, Flipkart, Shopify            */
/* ================================================================== */
// The marketplace reports (Amazon MTR, Flipkart, Shopify) and the GST sales register are read by the register engine
// (app/src/lib/registers.js: MarketRead, through the sheet panel), with one duplicate rule and one place of supply rule
// for every sales upload (next-fix-audit-imports: the "Marketplace report" button's own reader is retired). What stays
// here is the date rule the other readers share.
const Market = {
  // a date as yyyy-mm-dd: Excel's own, yyyy-mm-dd (or yyyy/mm/dd, yyyy.mm.dd), dd/mm/yyyy or dd/mm/yy and dd-Mon-yy. Day
  // first always: figures alone are never given to new Date, which reads 05/09/26 as 9 May. "" when the day is not in
  // its month. Any year 1990 to 2099 (review of e7bf15906: toIsoDate's GST years, 2017-2035, dropped a vendor
  // statement's old bill of 2015; a register says so itself, SheetFmt.apply)
  iso(d, m, y){ d = +d; m = +m; y = +y; if (y < 100) y += 2000; const t = new Date(Date.UTC(y, m - 1, d)); return y > 1989 && y < 2100 && m > 0 && m < 13 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : ""; },
  date(v){
    if (v == null || v === "") return "";
    // a date from Excel (or a date written out) is local midnight: read it by its local day, not in UTC (a day early in India)
    const day = d => isNaN(d) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (v instanceof Date) return day(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/);
    if (m) return this.iso(m[3], m[2], m[1]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?!\d)/);
    if (m) return this.iso(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})[A-Za-z]*[-\s,]+(\d{4}|\d{2})(?!\d)/);
    if (m) return this.iso(m[1], MONTHS[m[2].toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()], m[3]);
    // a month in words ("Sep 5, 2026"), never figures alone
    return /[a-z]{3}/i.test(s) && !/^\d+[-\/.]\d/.test(s) ? day(new Date(s)) : "";
  }
};

async function uploadSales(files){
  const s = SL(); if (!s) return;
  // a register (a sheet or JSON: GSTR-1, a marketplace's or an ERP's report) goes to the sheet panel (app/src/lib/registers.js)
  const sheets = files.filter(f => isSheetFile(f));
  if (sheets.length){ sheetStart(sheets, "sales"); files = files.filter(f => !sheets.includes(f)); if (!files.length) return; }
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
// (next-fix-audit-sales-einv) an invoice with a live IRN is what the IRP holds: never changed here (CGST Rules r.48(4); an
// IRN is only cancelled whole, within 24 hours, else a credit or debit note under s.34)
function salesIrnLocked(v){ if (!(v && v.x.irnStatus === "active")) return false; toast("Invoice " + v.x.number + " has an IRN, so it cannot be changed: cancel the IRN (within 24 hours) and make a new invoice, or issue a credit or debit note."); return true; }
function startDraft(fromId){
  const s = SL(), co = CO(s.cid);
  if (fromId){
    const v = inv(fromId);
    if (salesIrnLocked(v)) return;
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
    // (a supply to an SEZ under LUT: no IGST, IGST Act s.16(3)(a))
    const t = noState || x.supply === "SEZWOP" ? 0 : r2(it.taxable * num(it.gstRate) / 100);
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
  // (next-fix-sales-sync) the series' number taken meanwhile on another computer (its invoice synced in): the next free one
  if (!d.editId && d.seriesN && normInvNo(d.x.number) === normInvNo(seriesNumber(s.cfg, d.x.date, d.seriesN)) && s.list.some(v => normInvNo(v.x.number) === normInvNo(d.x.number))){
    const nn = nextInvoiceNumber(d.x.date); toast("Invoice number " + d.x.number + " was used on another computer meanwhile, so this one is " + nn.number + "."); d.x.number = nn.number; d.seriesN = nn.n; }
  recalcDraft();
  const probs = draftProblems();
  if (probs.length){ toast(probs[0]); d.showErrors = true; render(); return null; }
  d.x.items = d.x.items.filter(it => it.desc.trim() || num(it.rate));
  let v;
  if (d.editId){
    v = inv(d.editId);
    if (v.status === "posted"){ toast("This invoice is already in Tally; it cannot be changed here."); return null; }
    if (salesIrnLocked(v)) return null;
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
// the printed invoice (invoiceHtml) is src/js/26-sales-invoice.js, with the Sales screen
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
function salesTabStates(t){ return t === "ready" ? ["ready"] : t === "done" ? ["posted", "intally"] : t === "ignored" ? ["ignored"] : ["review"]; }
function salesCounts(){ const c = {review: 0, ready: 0, done: 0, ignored: 0, old: 0}; SL().list.forEach(v => { if (v.status === "review") c.review++; else if (v.status === "ready") c.ready++; else if (v.status === "ignored") c.ignored++; else if (salesOld(v)) c.old++; else c.done++; }); return c; }
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
  return s.list.filter(v => salesColPass(v) && (states.includes(v.status) || s.sticky.has(v.id)) && !salesOld(v) && (!q || [v.x.number, v.x.customerName, v.x.customerGstin, v.customerLedger, v.x.total].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => String(b.x.date).localeCompare(String(a.x.date)) || String(b.x.number).localeCompare(String(a.x.number)));
}
// the Sales screen and its bar: React (app/src/screens/Sales.jsx)
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
// sales vouchers already in Tally (the same entry: salesSameEntry) are set aside
// (the most entries the cloud copy answers in one read, server/tally-cloud tally_vouchers_in: an answer of that many may
// have stopped short: before a posting that check counts as not made, and the invoices go all the same, salesCheckSafe)
const SALES_CHECK_CAP = 20000;
// (call: how Tally is read, tallyCall when not said; before a posting FinCom's cloud copy only: salesCheckSafe)
async function salesCheckTally(list, call){
  const co = CO(SL().cid);
  if (!(call || tallyVia(co)) || !list.length) return 0;
  const dates = list.map(v => v.x.date).filter(Boolean).sort();
  if (!dates.length) return 0;
  // next-fix-sales-upload (item 2; review of 44e4c1e97): the vouchers of the invoices' own dates only (the first to the last,
  // a day either side), every type (Tally and the cloud copy match a type by its exact name, and the client's own sales
  // type, "Sales UP", is not known before), the Sales-class ones kept here (salesTypeClasses)
  const cfg = SL().cfg, lc = s => String(s || "").toLowerCase().trim(), notes = [cfg.creditNoteType || "Credit Note", cfg.debitNoteType || "Debit Note", "Credit Note", "Debit Note"];
  const got = await salesVouchersIn(co, addDays(dates[0], -1), addDays(dates[dates.length - 1], 1), call);
  // (never a cancelled or an Optional voucher: not in the books, the owner's case of 24-Nov-2026)
  const all = got.filter(v => !/^yes$/i.test(v.cancelled || "") && !/^yes$/i.test(v.optional || ""));
  // the copy's last read (as salesCopyAt): a voucher of a copy not read since FinCom's own earlier posting of that entry
  // is no evidence by itself; the earlier posting then is, and only when Tally confirmed it as a regular voucher
  const bk = typeof dupCopy === "function" && call === dupCopy && typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null, bst = (bk && bk.state) || {};
  const copyAt = bk ? Math.max(0, ...[bst.readAt, bst.seen, bk.daysAt].map(x => Date.parse(x || "") || 0)) : Infinity;
  const own = list.filter(v => !v.x.noteKind).map(v => salesVt(v.x)).concat(cfg.voucherType || [], "Sales");
  const isInv = salesTypeClasses(own), noteTypes = new Set(notes.concat(list.filter(v => v.x.noteKind).map(v => salesVt(v.x))).map(lc));
  const vs = all.filter(x => !x.type || isInv(x.type) || noteTypes.has(lc(x.type)) || own.some(t => lc(t) === lc(x.type)));
  const by = new Map();
  vs.forEach(x => [normInvNo(x.number), normInvNo(x.reference)].filter(Boolean).forEach(k => { if (!by.has(k)) by.set(k, []); if (!by.get(k).includes(x)) by.get(k).push(x); }));
  let n = 0;
  // a voucher a person said is not this invoice's (Not this Tally entry) is never matched to it again
  const info = x => ({key: salesTallyKey(x), date: String(x.date || ""), number: String(x.number || ""), type: String(x.type || ""), party: String(x.party || ""), amount: salesTallyAmount(x)});
  const d8 = x => String(x.date || "").replace(/-/g, "").slice(0, 8), iso = x => /^\d{8}$/.test(d8(x)) ? d8(x).replace(/^(\d{4})(\d\d)(\d\d)$/, "$1-$2-$3") : "";
  list.forEach(v => { const no = normInvNo(v.x.number), not = salesNotOf(v);
    // (one already marked In Tally, by FinCom's own posting first: salesCheckSafe; its match kept)
    if (v.status === "intally") return;
    // (a note is matched to a voucher of its own type only, an invoice to a Sales-class voucher, or one of no type said)
    const kind = x => v.x.noteKind ? lc(x.type) === lc(salesVt(v.x)) : (!x.type || isInv(x.type) || lc(x.type) === lc(salesVt(v.x)));
    const any = no ? (by.get(no) || []).filter(kind) : [], same = !not.includes("num:" + no) ? any.filter(x => !not.includes(salesTallyKey(x))) : [];
    // (a hold of the old rule, 16-Nov-2026, kept on an invoice saved before: it ends here)
    const had = !!v.dupBlock; delete v.dupBlock;
    // (this invoice's duplicate check has run again: an answer not confirmed before no longer holds it, item 3)
    if (v.needsCheck){ delete v.needsCheck; mapInvoice(v); }
    // the same entry (salesSameEntry, as FinCom's own posted invoices are matched, salesDupOf): the number, the voucher
    // type (any Sales-class one when both GSTINs match), the year, the amount (to ₹1), the customer: In Tally, quietly. Anything less is not this
    // invoice: nothing holds it, it is posted. Nor the Tally entry of a FinCom invoice a person said is not this one
    const me = salesEntryOf(v), cust = x => x.gstin || x.partyGstin || (typeof partyMaster === "function" && (partyMaster(x.party) || {}).gstin) || "";
    const gone = salesOfNo(v.x.number).filter(o => o.id !== v.id && ["posted", "intally"].includes(o.status) && not.includes("fincom:" + o.id)).map(salesEntryOf);
    const prior = salesOfNo(v.x.number).filter(o => o.id !== v.id && ["posted", "intally"].includes(o.status) && !not.includes("fincom:" + o.id));
    // (byRef: found by its reference, not its own number: never the walk-in rule of salesSameEntry, review of 69441fde7)
    const hit = same.find(x => { const e = {no, type: x.type, date: iso(x), amount: salesTallyAmount(x), gstin: cust(x), party: x.party, seller: x.cmpGstin || "", byRef: normInvNo(x.number) !== no};
      if (!salesSameEntry(me, e, isInv) || gone.some(g => salesSameEntry(g, e, isInv))) return false;
      const was = prior.filter(o => salesSameEntry(salesEntryOf(o), e, isInv) && Date.parse(o.postedAt || "") >= copyAt);
      return !was.length || was.some(salesInBooks); });
    if (hit){ if (v.status !== "intally") v.matchedAt = new Date().toISOString(); v.status = "intally"; v.postNote = "Already in Tally"; v.tallyMatch = info(hit); v.postError = ""; v.postedOptional = /^yes$/i.test(hit.optional || ""); n++; }
    else if (had) mapInvoice(v);
  });
  return n;
}
// the vouchers of a period (yyyy-mm-dd, both ends), read again in smaller pieces when an answer reaches the cloud copy's
// cap (review of d487be4c1): the period halved until each piece is under it; only a single day at the cap is refused
async function salesVouchersIn(co, from, to, call){
  const ask = async (a, b) => [].concat((await (call || tallyCall)(co, "/vouchers?company=" + encodeURIComponent(tallyCoName(co)) + "&from=" + isoToTally(a) + "&to=" + isoToTally(b) + Bridge.pinQ())).vouchers || []);
  const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  const out = [], seen = new Set();
  const take = list => list.forEach(x => { const k = salesTallyKey(x); if (!seen.has(k)){ seen.add(k); out.push(x); } });
  const run = async (a, b) => {
    const got = await ask(a, b);
    if (got.length < SALES_CHECK_CAP){ take(got); return; }
    if (a === b) throw {code: "check_cap", message: "Too many entries in Tally on " + fmtDate(a) + " to check (" + SALES_CHECK_CAP.toLocaleString("en-IN") + " or more in one day), so nothing was posted. Check that day's invoices in Tally first."};
    const mid = addDays(a, Math.floor(days(a, b) / 2));
    await run(a, mid); await run(addDays(mid, 1), b);
  };
  await run(from, to);
  return out;
}
// whether a voucher type of Tally's answer is of the Sales class, for an invoice: the client's own sales type (Sales
// settings, the invoices' own), Tally's "Sales", or a type with "sales" in its name; never a Journal, Receipt, Payment,
// Contra, a note, a return or an order, whatever its entries; nor a type with any of those words in its name ("Sales CN",
// "Sales Journal", "Sales Advance Receipt", "Sales Rtn", "Sales Note", "SalesReturn"), nor the client's own credit or debit
// note type (salesNotSale)
function salesTypeClasses(own){
  const lc = s => String(s || "").toLowerCase().trim(), names = new Set([].concat(own || [], "Sales").filter(Boolean).map(lc));
  // (the owner, 24-Nov-2026: "Tax Invoice", "Retail Invoice", "Bill of Supply" are sales too; "Proforma Invoice",
  // "Purchase Invoice" never, salesNotSale)
  return t => { const n = lc(t); if (!n || salesNotSale(n)) return false; return names.has(n) || /\bsales\b|cash[\s_-]*memo|\binvoices?\b|bill[\s_-]*of[\s_-]*supply/i.test(n); };
}
function salesAmtNum(a){ return num(String(a == null ? "" : a).replace(/[^0-9.\-]/g, "")); }
// a Tally voucher's amount: its own when the answer carries one, else its party's line (the bridge's and the cloud's
// /vouchers carry the lines, not a total), else its largest line
function salesTallyAmount(x){
  if (num(x.amount)) return r2(Math.abs(num(x.amount)));
  const es = [].concat(x.entries || []).filter(e => e && e.ledger), party = es.filter(e => String(e.ledger) === String(x.party || ""));
  const a = (party.length ? party : es).reduce((m, e) => Math.max(m, Math.abs(salesAmtNum(e.amount))), 0);
  return r2(a);
}
function salesTallyKey(x){ return String(x.guid || x.masterId || [x.date, x.type, x.number].join("|")); }
// asked: someone pressed Update from Tally. By itself (opening the page) Tally is not read, except a first ledger list;
// sales already in Tally are still found when posting (build 190)
// invoices held by a posting in FinCom's cloud (v.postJob): that posting's result marked on them once it has one
async function salesQueuedSync(){
  const s = SL(), co = CO(s.cid); let n = 0;
  // (and one whose IRN was cancelled while it was queued: its result still recorded, review of b4ff11b10)
  for (const v of s.list.filter(x => x.postJob && (x.status === "ready" || x.x.irnCancelInTally))){
    let j = null; try { j = await CloudPost.row(v.postJob); } catch (e){ continue; }
    const r = j && [].concat(j.results || []).find(x => x && x.id === v.id);
    // (a posting or a result still checking: looked at again next time, its link kept, as bills wait in postReconcile)
    if (j && (j.checking || (r && r.pendingCheck))) continue;
    // (next-sales-followups) the same rule as a direct post: Tally's reply or a read back is posted, an answer not
    // confirmed is not; one Tally already had is In Tally; an IRN cancelled keeps its mark while it may be in Tally
    let maybeIn = false;
    if (r && r.ok && postAlready(r)){ n++; delete v.postJob; v.matchedAt = new Date().toISOString(); v.status = "intally"; v.postNote = "Already in Tally"; v.postError = ""; v.tallyMatch = {number: String(r.vchNumber || r.vchNo || v.x.number || ""), date: String(r.vchDate || "")}; v.postedOptional = !!r.optional; maybeIn = true; }
    else if (r && r.ok){ n++; delete v.postJob; if (postTaken(r)){ v.status = "posted"; v.postedAt = new Date().toISOString(); v.postError = ""; v.postedInto = j.company || ""; v.postedOptional = salesOptional(r, co); learnCustomer(v); } else { v.postError = salesUnconfirmed(r); maybeIn = true; } }
    else if (r && salesRefusal(r)){ n++; delete v.postJob; salesMarkRefused(v, r, salesRefusal(r)); }
    // (the bridge's "already" refusal: said on the invoice, as a direct post says it)
    else if (r && r.already){ n++; delete v.postJob; v.postError = plainMsg(r.message) || "Tally did not confirm this invoice."; maybeIn = true; }
    else if (j && ["failed", "cancelled"].includes(j.status)){ n++; v.postError = postCloudSay(plainMsg((r && r.message) || j.message)); delete v.postJob; }
    // (not posted, its IRN cancelled: no sale any more, CGST Rules r.48(4), so set aside, nothing to cancel in Tally)
    if (!v.postJob && !maybeIn && v.status !== "posted" && v.x.irnStatus === "cancelled"){ v.status = "ignored"; delete v.x.irnCancelInTally; }
  }
  if (n){ saveSales(); render(); }
}
async function salesAutoSync(checkOnly, asked){
  const s = SL(), co = CO(s.cid);
  try { await salesQueuedSync(); } catch (e){ /* the next refresh */ }
  if (!bridgeLive(co)) return;
  try {
    if (!checkOnly && (asked || !(B().ledgers.list || []).length)) await syncLedgersFromTally(true);
    s.list.forEach(v => mapInvoice(v));
    if (asked) await salesCheckTally(s.list.filter(v => ["review", "ready"].includes(v.status)));
    saveSales(); render();
  } catch (e){ /* shown when posting */ }
}
// next-fix-sales-sync (16-Nov-2026: "Post to Tally" did nothing on one computer): never silent. Whatever stops a post,
// before its own try below (finding the Tally company, reading the ledgers) or in it, ends in a message
// next-fix-sales-readback (23-Nov-2026): since FinCom Bridge round 15 nothing is read back; Tally's own reply
// (byReply) is the answer, as for bills (postTaken). Optional: the voucher was sent so (Client setup) or Tally said so
function salesOptional(r, co){ return !!(r && r.optional) || !!(co && co.createOptional); }
// an answer Tally took but has not confirmed (an old bridge's real not-found answer is one): never said to be in Tally
function salesUnconfirmed(x){ return "Not confirmed by Tally yet, so it is not marked as posted. Look in Tally (Day Book, and Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers). If it is not there, post it again." + (x && x.verifyNote ? " [" + x.verifyNote + "]" : ""); }
async function postSalesToTally(){ try { return await postSalesRun(); } catch (e){ salesPostFailed(e); } }
function salesPostFailed(e){ const s = SL(); if (s) s.busy = ""; toast("Posting failed: " + plainMsg((e && (e.message || e.code)) || String(e || "unknown error"))); render(); }
async function postSalesRun(){
  const s = SL(), co = CO(s.cid);
  if (!(await ensureTallyCompany(co))) return;
  await syncLedgersFromTally(true);
  let list = salesPostScope(s.list.filter(v => v.status === "ready" && !(typeof salesJobLive === "function" && salesJobLive(v))));
  if (!list.length) return withPart("invoice", "salesWhy", () => toast("No invoice is ready to post" + (salesWhy() ? ": " + salesWhy().text : "") + "."));   // never silent
  s.busy = "Checking FinCom\u2019s copy of Tally for invoices already booked\u2026"; render();
  try {
    const asked = list.slice(), inT = () => asked.filter(v => v.status === "intally").length;
    // (checked on FinCom's cloud copy only, never Tally: one found there is In Tally, quietly; the rest go, also when the
    // copy has nothing or does not answer: src/js/26-sales-invoice.js salesCheckSafe)
    await salesCheckSafe(list);
    list = list.filter(v => v.status === "ready");
    const probs = salesReadyProblems(list);
    s.dupSkipped = [];
    list = list.filter(v => v.status === "ready");
    if (!list.length){ s.busy = ""; saveSales(); toast(probs.length ? "Fix these first: " + probs.slice(0, 2).join("; ") : inT() ? inT() + " already in Tally: marked In Tally, not posted again." : "No invoice is ready to post."); render(); return; }
    const masters = mastersFor(list);
    s.busy = "Posting " + list.length + " invoice" + (list.length > 1 ? "s" : "") + " to Tally\u2026"; render();
    const tn = tallyCoName(co);
    const j = await Bridge.post({company: tn, client: co.id,
      masters: masters.map(l => ({id: "led:" + l.name, xml: (/sundry/i.test(l.group || "sundry") ? customerMasterXml : ledgerMasterXml)(l)})),
      vouchers: list.map(v => ({id: v.id, xml: salesVoucherXml(v, co)}))}, pj => { s.busy = postingLine(pj, tn); refreshBusy(); });
    const by = new Map([].concat(j.results || []).map(r => [r.id, r]));
    const now = new Date().toISOString();
    masters.forEach(l => { const r = by.get("led:" + l.name); if (r && r.ok){ l.sent = true; l.sentAt = now; } });
    let ok = 0, bad = 0, queued = 0, refusedN = 0;
    const early = [];
    let optionalN = 0;
    list.forEach(v => { const r = by.get(v.id), no = salesRefusal(r);
      // (item 4) "created 0 of N" with exceptions and no line error: a definite refusal of the request, said plainly;
      // the invoice is Refused by Tally (not Ready, never sent again as it is) until it is posted one by one or changed
      if (no){ refusedN++; salesMarkRefused(v, r, no); return; }
      if (r && r.earlier){ early.push([v, r]); return; }   /* (24-Nov-2026) an earlier posting holds it: FinCom's copy of Tally decides (src/js/96-not-in-tally.js) */
      if (r && r.ok && !postTaken(r)){ bad++; v.postError = salesUnconfirmed(r); return; } if (r && r.ok){ ok++; v.status = "posted"; v.postedAt = now; v.postError = ""; v.postedInto = r.company || ""; v.postedOptional = salesOptional(r, co); if (v.postedOptional) optionalN++; learnCustomer(v); } else if (r && r.held){ queued++; v.postError = plainMsg(r.message); v.postJob = r.job; }   /* held by a posting still going on in FinCom's cloud: queued, not failed */
      else { bad++; v.postError = plainMsg(r && r.message) || "Tally did not confirm this invoice."; } });
    const ew = early.length && typeof salesEarlier === "function" ? await salesEarlier(early, co) : "";
    saveBank({newLed: true});
    s.busy = ""; saveSales();
    toast(ok + " posted to Tally" + (ew ? "; " + ew : "") + (optionalN ? " (" + optionalN + " as Optional vouchers: Display More Reports \u2192 Exception Reports \u2192 Optional Vouchers)" : "") + (queued ? "; " + queued + " queued, posts by itself" : "") + (bad ? "; " + bad + " not posted (see the red notes)" : "") +
      (refusedN ? "; " + refusedN + " refused by Tally with no reason given: under To review, “Post one by one to find the cause”" : "") + ".");
    if (!bad && !queued && !refusedN) s.filter = "done";
    else if (refusedN && !bad && !queued) s.filter = "review";
    syncLedgersFromTally(true);
  } catch (e){ s.busy = ""; saveSales(); toast("Posting failed: " + e.message); }
  render();
}
// next-fix-sales-upload (item 4): Tally's answer "created 0 of N" with exceptions and no line error (the bridge's words,
// bridge-go/post.go replyLine; its own fallback "Tally reported an exception" is lost when the request held several):
// a definite refusal of the whole request. Returns {n, exceptions} or null
function salesRefusal(r){
  if (!r || r.ok !== false || r.held || r.outcomeUnknown || r.notAllowed || r.pendingCheck) return null;
  const said = String(r.message || ""), m = said.match(/created\s+0\s+of\s+(\d+)/i);
  const has = k => r[k] != null && r[k] !== "";
  const created = has("created") ? num(r.created) : m ? 0 : NaN;
  if (created !== 0 || num(r.altered) > 0 || r.accepted === true) return null;
  if ([].concat(r.lineError || []).filter(x => String(x || "").trim()).length) return null;
  const exc = has("exceptions") ? num(r.exceptions) : num((said.match(/exceptions\s+(\d+)/i) || [])[1]);
  if (!(exc > 0)) return null;
  return {n: num(r.batchN) || (m ? num(m[1]) : 1), exceptions: exc};
}
function salesRefusalHint(no, single){
  return single ? "Tally would not take this voucher and gave no reason (an exception, no line error). Open it in Tally\u2019s import (or check its customer and sales ledgers, the voucher type, the GST details and the date), put it right here, then post it again."
    : "Tally created none of the " + no.n + " vouchers sent together and gave no reason (" + no.exceptions + " exception" + (no.exceptions === 1 ? "" : "s") + ", no line error). One voucher Tally will not take can stop all of them: post them one by one to find which.";
}
function salesMarkRefused(v, r, no, single, hint){
  v.refused = {at: new Date().toISOString(), n: no.n, exceptions: no.exceptions, single: !!single, said: plainMsg(r && r.message) || "", hint: hint || salesRefusalHint(no, single)};
  v.postError = "Refused by Tally: " + v.refused.hint + (v.refused.said ? " [" + v.refused.said + "]" : "");
  delete v.postJob; v.status = "review"; mapInvoice(v);
}
async function exportSalesXml(){
  const s = SL(), co = CO(s.cid);
  let list = salesPostScope(s.list.filter(v => v.status === "ready"));
  const probs = salesReadyProblems(list);
  list = list.filter(v => v.status === "ready");
  if (!list.length){ toast(probs.length ? "Fix these first: " + probs.slice(0, 2).join("; ") : salesNoneShown() || "No invoices are ready."); render(); return; }
  const masters = mastersFor(list);
  const sv = co.tallyName ? "<STATICVARIABLES><SVCURRENTCOMPANY>" + xesc(co.tallyName) + "</SVCURRENTCOMPANY></STATICVARIABLES>" : "";
  const body = masters.map(l => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + (/sundry/i.test(l.group || "sundry") ? customerMasterXml : ledgerMasterXml)(l) + "</TALLYMESSAGE>\n").join("") + list.map(v => '<TALLYMESSAGE xmlns:UDF="TallyUDF">\n' + salesVoucherXml(v, co) + "</TALLYMESSAGE>\n").join("");
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
// an invoice posted or found in Tally is never taken back to an earlier state (Undo, bulk or row buttons), so it cannot be
// posted twice (state-machine review, item 5)
function salesInTally(v){ return !!v && (v.status === "posted" || v.status === "intally"); }
function salesUndo(){
  const s = SL(), u = s.undo; if (!u) return;
  let kept = 0;
  u.before.forEach(old => { const i = s.list.findIndex(v => v.id === old.id); if (i >= 0 && salesInTally(s.list[i]) && s.list[i].status !== old.status){ kept++; return; } if (i >= 0) s.list[i] = old; else s.list.push(old); });
  s.undo = null; saveSales(); if (kept) postPart(P => toast("Undone. " + P.keptWords(kept, "invoice"))); else toast("Undone."); render();
}
// set a customer ledger; other open invoices of the same customer follow
function setCustomerLedger(v, ledger){
  const s = SL(), l = exactLedger(ledger);
  if (!l){ toast("\u201c" + ledger + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return false; }
  const key = salesHistKey(v);
  const targets = s.list.filter(o => o.id === v.id || (key && ["review", "ready"].includes(o.status) && salesHistKey(o) === key && !o.userLedger));
  const before = targets.map(salesSnapshot);
  targets.forEach(o => { if (o.id === v.id && o.customerLedger !== l) delete o.refused; if (o.custSource !== "Set by you") o.custWas = {ledger: o.customerLedger || "", source: o.custSource || "", user: !!o.userLedger, sure: !!o.custSure}; o.customerLedger = l; o.userLedger = true; o.custSource = "Set by you"; salesPartyFill(o); mapInvoice(o); s.sticky.add(o.id); if (o.status === "review" && !(o.problems || []).length && !(o.ledgerIssues || []).length) o.status = "ready"; });
  learnCustomer(v);
  // (the other invoices of this customer waiting with no ledger a person set follow, as before; never one posted or in
  // Tally: only To review and Ready ones are looked at. Said, with Undo: review of d487be4c1)
  const others = targets.length - 1, also = others ? "Also set on " + others + " other invoice" + (others === 1 ? "" : "s") + " of this customer." : "";
  salesSetUndo(esc(v.x.customerName || v.x.number) + " \u2192 <b>" + esc(l) + "</b>" + (also ? " \u00b7 <span data-also-set=\"" + others + "\">" + esc(also) + "</span>" : ""), before);
  if (also) toast(also + " Undo is in the bar below.");
  saveSales();
  return true;
}
// the invoices ticked (one now older than 24 hours, off the page, is unticked: nothing hidden is acted on)
function salesSel(){ const s = SL(); return s.list.filter(v => s.sel.has(v.id) && (!salesOld(v) || !s.sel.delete(v.id))); }
function salesBulk(kind, ledger){
  // (an invoice with a live IRN is never ignored or deleted: the IRN is cancelled first, review of b4ff11b10)
  const s = SL(), sel = salesSel().filter(v => !salesInTally(v)), live = /^(ignore|delete)$/.test(kind) ? sel.filter(v => v.x.irnStatus === "active") : [], rows = sel.filter(v => !live.includes(v));
  if (live.length) toast(live.length + " with an IRN kept: cancel the IRN first.");
  if (!rows.length) return;
  const before = rows.map(salesSnapshot);
  let n = 0;
  rows.forEach(v => {
    s.sticky.add(v.id);
    if (kind === "ledger"){ v.customerLedger = ledger; v.userLedger = true; v.custSource = "Set by you"; salesPartyFill(v); mapInvoice(v); if (v.status === "review" && !(v.problems || []).length && !(v.ledgerIssues || []).length) v.status = "ready"; n++; }
    if (kind === "confirm" && v.status !== "ignored"){ mapInvoice(v); if (v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length){ v.status = "ready"; learnCustomer(v); n++; } }
    if (kind === "ignore" && v.status !== "ignored"){ v.status = "ignored"; n++; }
  });
  if (kind === "delete"){
    rows.forEach(v => { if (typeof Cloud === "object") Cloud.delete("sales", s.cid, s.cid + ":" + v.id, "invoice deleted"); });
    s.list = s.list.filter(v => !rows.includes(v)); n = rows.length;
  }
  salesSetUndo(n + " invoice" + (n === 1 ? " " : "s ") + ({ledger: "set to <b>" + esc(ledger) + "</b>", confirm: "confirmed", ignore: "ignored", delete: "deleted"}[kind]), before);
  if (kind === "confirm" && n < rows.length) toast((rows.length - n) + " could not be confirmed: open them to see what is missing.");
  s.sel.clear(); saveSales(); render();
}
// one invoice's buttons: reread, print, file, edit, confirm, unready, ignore, restore, delete
function salesRowAct(a, id, force){
  const s = SL(); if (!s) return true;
    const v = inv(id); if (!v) return true;
    if (a === "reread"){ withPart("invoice", "rereadSales", () => rereadSales(v, force)); return true; }
    if (a === "print"){ withPart("invoice", "invoiceHtml", () => printInvoiceHtml(invoiceHtml(v.x, CO(s.cid), s.cfg), v.x.number)); return true; }
    if (a === "file"){ const f = S.files["sv:" + v.id]; if (f){ const u = blobUrl(f); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000); } return true; }
    if (a === "edit"){ s.openId = null; startDraft(v.id); return true; }
    if (a === "nottally"){ postPart(P => P.salesNotTally(v.id)); return true; }
    if (salesInTally(v)){ postPart(P => toast(P.keptOne(v, "invoice"))); return true; }
    if ((a === "ignore" || a === "delete") && salesIrnLocked(v)) return true;
    const before = [salesSnapshot(v)];
    if (a === "confirm"){
      mapInvoice(v);
      const miss = (v.problems || []).concat(v.ledgerIssues || []);
      if (!v.customerLedger || miss.length){ toast(miss[0] || "Choose the customer ledger first."); s.openId = v.id; render(); return true; }
      v.status = "ready"; learnCustomer(v); salesSetUndo("Invoice " + esc(v.x.number) + " confirmed", before);
    }
    if (a === "unready"){ v.status = "review"; v.heldBack = true; salesSetUndo("Invoice " + esc(v.x.number) + " moved back to review", before); }
    if (a === "ignore"){ v.status = "ignored"; if (s.openId === v.id) s.openId = null; salesSetUndo("Invoice " + esc(v.x.number) + " ignored", before); }
    if (a === "restore"){ v.status = "review"; mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number) + " restored", before); }
    if (a === "delete"){
      // no question first (spec K9, round 2): Undo in the bar puts it back
      if (typeof Cloud === "object") Cloud.delete("sales", s.cid, s.cid + ":" + v.id, "invoice deleted");
      s.list = s.list.filter(o => o.id !== v.id); s.openId = null; salesSetUndo("Invoice " + esc(v.x.number) + " deleted", before); saveSales(); render();
      return true;
    }
    s.sticky.add(v.id); saveSales(); render(); return true;
}
// the React sales screen (app/src/screens/Sales.jsx)
function salesAct(act){ return salesClick({dataset: {act}}); }
function salesTabGo(k){ const s = SL(); s.filter = k; s.sel.clear(); s.sticky.clear(); render(); }
function salesOpen(id){ SL().openId = id; render(); }
let salesLastClicked = null;
function salesSelAll(on){ const s = SL(); salesVisible().filter(v => !salesInTally(v) && salesShown(v)).forEach(v => on ? s.sel.add(v.id) : s.sel.delete(v.id)); salesLightRefresh(); }
// a field of the invoice that is open (number, date, customer, amounts)
function salesSetField(k, val){
  const v = inv(SL().openId); if (!v || salesIrnLocked(v)) return;
  const before = [salesSnapshot(v)];
  const was = v.x[k];
  v.x[k] = ["taxable", "cgst", "sgst", "igst", "cess", "total"].includes(k) ? r2(num(val)) : k === "customerGstin" ? String(val).trim().toUpperCase().replace(/\s+/g, "") : String(val).trim();
  // (item 6) a GSTIN typed, changed or cleared: the place of supply it gave follows it, and every problem is worked out
  // again below, so no label of the GSTIN before stays; a GSTIN or place of supply a person typed is theirs (a sheet's
  // invoice no longer takes the party's from its Tally ledger)
  if (k === "customerGstin" && gstinValid(v.x.customerGstin) && (!v.x.pos || v.x.pos === stateOfGstin(was))) v.x.pos = stateOfGstin(v.x.customerGstin);
  if ((k === "customerGstin" || k === "pos") && v.sheetHad){ v.sheetHad = Object.assign({}, v.sheetHad, k === "pos" ? {pos: true} : {gstin: true}); delete v.filled; }
  // (item 4) an invoice Tally refused, changed: it is not the voucher refused any more
  if (v.refused && was !== v.x[k]) delete v.refused;
  mapInvoice(v); salesSetUndo("Invoice " + esc(v.x.number) + " changed", before); saveSales(); render();
}
function draftItem(i, k, val){
  const s = SL(), it = s.draft.x.items[i]; if (!it) return;
  it[k] = ["qty", "rate", "disc", "gstRate", "cess"].includes(k) ? num(val) : val;
  // an HSN/SAC used before gives its GST rate (the item memory kept from saved invoices)
  if (k === "hsn"){ const code = String(val).replace(/\D/g, ""); const m = code.length >= 4 && Object.values(s.cfg.items || {}).find(t => String(t.hsn || "").replace(/\D/g, "") === code); if (m && m.gstRate != null) it.gstRate = num(m.gstRate); }
  if (k === "desc"){ const m = s.cfg.items[String(val).trim().toLowerCase()]; if (m){ if (!it.hsn) it.hsn = m.hsn; if (!num(it.rate)) it.rate = m.rate; it.unit = m.unit || it.unit; it.gstRate = m.gstRate; } }
  recalcDraft(); render();
}
// Sales settings
function salesCfg(k, val){ const s = SL(); if (k === "voucherType"){ s.cfg.vtBy = "you"; delete s.cfg.vtFrom; s.vtAsk = null; } s.cfg[k] = ["next", "pad"].includes(k) ? Math.max(1, Math.round(num(val))) : val; saveSales({cfg: true}); render(); }
function salesCfgLedger(k, val){ const s = SL(); s.cfg.ledgers = s.cfg.ledgers || {}; s.cfg.ledgers[k] = val; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); saveSales(); render(); }
function salesClick(t){
  const s = SL(); if (!s){ if (!/Post/.test(t.dataset.act)) return false; toast("Sales list still loading. Try again in a moment."); return true; }
  if (t.dataset.svact){ salesRowAct(t.dataset.svact, t.dataset.id, t.dataset.force || null); return true; }
  switch (t.dataset.act){
    case "salesPick": document.getElementById("salesIn").click(); return true;
    case "ledPick": { const el = document.getElementById("ledIn"); if (el) el.click(); return true; }
    case "salesNew": startDraft(); return true;
    case "salesCancel": s.draft = null; s.view = "list"; render(); return true;
    case "salesSave": saveDraft(); return true;
    case "salesPrintDraft": recalcDraft(); withPart("invoice", "invoiceHtml", () => printInvoiceHtml(invoiceHtml(s.draft.x, CO(s.cid), s.cfg), s.draft.x.number)); return true;
    case "salesAddItem": s.draft.x.items.push(blankItem()); render(); const last = document.querySelector('[data-fk="si:' + (s.draft.x.items.length - 1) + ':desc"]'); if (last) last.focus(); return true;
    case "salesSettings": s.showSettings = true; render(); return true;
    case "salesSettingsClose": s.showSettings = false; s.list.forEach(v => mapInvoice(v)); saveSales(); render(); return true;
    case "salesClose": s.openId = null; render(); return true;
    case "salesCsv": closeMenus(); exportSalesCsv(); return true;
    case "salesFile": closeMenus(); exportSalesXml(); return true;
    case "salesPost": postSalesToTally().catch(salesPostFailed); return true;
    case "salesSync": closeMenus(); salesAutoSync(false, true).then(() => toast("Refreshed from Tally.")); return true;
    case "salesUndo": salesUndo(); return true;
    case "salesUndoOk": s.undo = null; salesLightRefresh(); return true;
    case "salesSelNone": s.sel.clear(); salesLightRefresh(); return true;
    case "salesBulkConfirm": salesBulk("confirm"); return true;
    case "salesBulkIgnore": salesBulk("ignore"); return true;
    case "salesBulkDelete": salesBulk("delete"); return true;   // Undo in the bar (spec K9, round 2)
    case "salesBulkPrint": { const rows = salesSel(); const co = CO(s.cid);
      withPart("invoice", "invoiceHtml", () => {
      const html = rows.map(v => invoiceHtml(v.x, co, s.cfg)).join("").replace(/<\/body><\/html><!doctype html><html lang="en"><head>[\s\S]*?<body>(<p class="noprint"[\s\S]*?<\/p>)?/g, '<div style="page-break-before:always"></div>');
      printInvoiceHtml(html, rows.length + "-invoices"); }); return true; }
    case "salesBulkLedger": { const inp = document.querySelector("[data-svbulk]"); const l = exactLedger(inp && inp.value); if (!l){ toast("Choose a Tally ledger for the selected invoices."); return true; } acClose(); salesBulk("ledger", l); return true; }
    case "salesConfirmAll": {
      const rows = salesPostScope(s.list.filter(v => v.status === "review" && v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length));
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
  if (ev.target.hasAttribute && ev.target.hasAttribute("data-svoverlay")){ const s = SL(); Drafts.guard("sales:settings", () => { s.openId = null; s.showSettings = false; render(); }); }
});
document.addEventListener("keydown", ev => {
  if (!(S.view === "company" && S.tab === "sales" && SL())) return;
  const s = SL();
  if (ev.key === "Escape" && (s.openId || s.showSettings) && !document.querySelector("#confirmBox[style*='flex']") && !AC.fk){ ev.preventDefault(); ev.stopImmediatePropagation(); Drafts.guard("sales:settings", () => { s.openId = null; s.showSettings = false; render(); }); }
  if (ev.key === "Enter" && ev.target.hasAttribute && ev.target.hasAttribute("data-svbulk") && !(AC.fk && AC.idx >= 0)){ ev.preventDefault(); const l = exactLedger(ev.target.value); if (l){ acClose(); salesBulk("ledger", l); } else toast("Choose a Tally ledger."); }
}, true);

/* ---------- posting to Tally: exact ledger names, company check, overlaps, reports ---------- */
function tallyLedgerName(n){ return (S.bank && S.bank.ledgers && hasLedgerList() && exactLedger(n)) || n; }
function fpHash(s){ let h = 5381; const t = String(s || ""); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
const ROLE_GROUPS = {party: /sundry|creditors|debtors|current liab|loans|capital/i, expense: /expense|purchase|direct|indirect|fixed assets/i, gst: /duties|taxes/i, tds: /duties|taxes|current liab|provisions/i, roundoff: /./, "rcm-in": /duties|taxes/i, "rcm-out": /duties|taxes/i, sales: /sales/i, tax: /duties|taxes/i};
const ROLE_WORDS = {gst: /gst/i, tds: /tds/i, roundoff: /round/i, "rcm-in": /gst/i, "rcm-out": /gst/i, tax: /gst|cess/i};
// Tally ledgers closest to a name that Tally does not have (from the client's one list; an expense line is never
// offered an income ledger, a GST or TDS line only tax ledgers)
function suggestLedgers(name, role, n){
  if (!hasLedgerList()) return [];
  const g = ROLE_GROUPS[role] || /./, w = ROLE_WORDS[role], cid = Ledgers.cid();
  return Ledgers.list(cid).filter(l => Ledgers.allowed(role, Ledgers.cls(cid, l.name))).map(l => {
    let sc = nameSim(name, l.name);
    if (g.test(l.group || "") || Ledgers.roleRank(role, Ledgers.cls(cid, l.name)) === 0) sc += 0.15;
    if (w && w.test(l.name)) sc += 0.25;
    return {l, sc};
  }).filter(x => x.sc >= 0.35).sort((a, b) => b.sc - a.sc).slice(0, n || 3).map(x => x.l.name);
}
// Company default ledgers (input GST, reverse charge, TDS by payment type, round off) matched to this client's Tally
// ledgers. Review of 02-Oct-2026: a value Tally has was kept even when it was of another tax (sgst = "INPUT IGST"), and
// TDS for goods (194Q), directors and interest pointed to "TDS 94H". Now a GST value must be of its own head and side,
// a TDS value of its own section; one that is not is replaced by the ledger that fits (the most used), or emptied
function autoMapCompanyLedgers(co){
  if (!co || Ledgers.cid() !== co.id || !hasLedgerList()) return [];
  const cid = co.id, list = Ledgers.list(cid), changes = [];
  const one = arr => arr.length === 1 ? arr[0].name : "";
  // review 20: a choice a person confirmed is never changed here; an empty or guessed one is filled as a guess, shown in
  // Client setup to confirm (choiceGuess, src/js/60), and not used for posting until confirmed
  const confirmed = key => key && choiceState(co, key) === "confirmed";
  const fix = (cur, set, valid, find, role, key) => {
    if (confirmed(key)) return;
    const put = v => { if (key) choiceGuess(co, key, v, "matched in Tally's ledger list"); else set(v); };
    const ok = cur ? valid(cur) : "";
    if (ok){ if (ok !== cur){ changes.push({from: cur, to: ok, role}); put(ok); } return; }
    const f = find() || "";
    if (f !== (cur || "") && (f || (cur && hasLedgerList()))){ changes.push({from: cur || "", to: f, role}); put(f); }
  };
  // (next-fix-client-open-freeze: the day book's use of each ledger, every entry, only when two ledgers are compared)
  let usage; const used = n => ((usage = usage || Ledgers.usage(cid) || {})[n] || {}).n || 0;
  const best = arr => arr.sort((a, b) => used(b) - used(a) || a.length - b.length)[0] || "";
  const names = list.map(l => l.name);
  // next-hang-watch (04-Nov-2026; staging's 2,455-ledger client blocked the page about a second on a fast computer at each
  // opening, several on the shared server): every head and every TDS section went through all the ledgers (about 80,000
  // checks). The same answers, worked out once per call: only a ledger Tally knows, of a tax group (or none) and with GST
  // in it can pass gstLedgerCheck, and only a TDS ledger of its own section can be a section's choice
  const gstNames = names.filter(n => { const ex = exactLedger(n), c = ex ? Ledgers.cls(cid, ex) : ""; return !!ex && (!c || ["tax", "other"].includes(c)) && !!Ledgers.gstInfo(cid, ex).gst; });
  const fitMemo = new Map();
  const gstFits = (n, head, kind) => { const k = n + "\u0001" + head + "\u0001" + kind; if (fitMemo.has(k)) return fitMemo.get(k);
    const c = gstLedgerCheck(cid, n, head, kind), v = c.ok && !!c.info.rcm === (kind !== "gst") ? c.name : ""; fitMemo.set(k, v); return v; };
  let bySec = null;
  const tdsOf = sec => {
    if (!bySec){ bySec = new Map(); names.forEach(n => { const ex = exactLedger(n), sc = ex ? Ledgers.secOf(cid, ex) : ""; if (sc && Ledgers.isTds(cid, ex)){ if (!bySec.has(sc)) bySec.set(sc, []); bySec.get(sc).push(n); } }); }
    return bySec.get(sec) || [];
  };
  const gstValid = (head, kind) => n => { const c = gstLedgerCheck(cid, n, head, kind); return c.ok ? c.name : ""; };
  co.gst = co.gst || {};
  [["cgst", "CGST"], ["sgst", "SGST"], ["igst", "IGST"]].forEach(([k, head]) => {
    const before = co.gst[k];
    fix(co.gst[k], v => { co.gst[k] = v; }, gstValid(head, "gst"), () => best(gstNames.map(n => gstFits(n, head, "gst")).filter(Boolean).filter(n => !Ledgers.gstInfo(cid, n).rate)) || best(gstNames.map(n => gstFits(n, head, "gst")).filter(Boolean)), "gst", "gst:" + k);
    if (co.gst[k] !== before && co.gstPin && !confirmed("gst:" + k)) delete co.gstPin[k];
  });
  fix(co.roundOff, v => { co.roundOff = v; }, n => exactLedger(n) || "", () => one(list.filter(l => /round(ed|ing)?\s*[- ]?off/i.test(l.name))), "roundoff");
  co.tdsLedgers = co.tdsLedgers || {};
  rules().forEach(r => {
    if (r.basis === "never") return;
    const sec = Ledgers.sec(r.old);
    if (!sec) return;
    const tech = r.id === "technical", fit = n => sec !== "194J" || /technical/i.test(n) === tech ? 1 : 0;
    const valid = n => { const c = tdsLedgerCheck(cid, n, sec); return c.ok ? c.name : ""; };
    let found;
    const find = () => { if (found === undefined){ const c = tdsOf(sec).slice(); found = c.sort((a, b) => fit(b) - fit(a) || used(b) - used(a) || a.length - b.length)[0] || ""; } return found; };
    // a default not in Tally and no ledger of the section: left as it is (it shows as not in Tally on the bill)
    const cur = co.tdsLedgers[r.id];
    if (cur && !exactLedger(cur) && !find()) return;
    fix(cur, v => { co.tdsLedgers[r.id] = v; }, valid, find, "tds", "tds:" + r.id);
  });
  co.expenseLedgers = co.expenseLedgers || {};
  // (the expense and asset ledgers only when a default expense ledger needs a match: each ledger's group chain is walked)
  let expL = null;
  const expOf = () => expL || (expL = list.filter(l => ["expense", "asset"].includes(Ledgers.cls(cid, l.name)) || (!Ledgers.cls(cid, l.name) && ROLE_GROUPS.expense.test(l.group || ""))));
  Object.keys(co.expenseLedgers).forEach(k => {
    if (confirmed("exp:" + k)) return;
    const cur = co.expenseLedgers[k], ex = cur && exactLedger(cur), put = v => choiceGuess(co, "exp:" + k, v, "matched in Tally's ledger list");
    if (ex && Ledgers.cls(cid, ex) === "income"){ changes.push({from: cur, to: "", role: "expense"}); put(""); return; }
    if (ex){ if (ex !== cur){ changes.push({from: cur, to: ex, role: "expense"}); put(ex); } return; }
    const c = expOf().map(l => ({l, s: nameSim(cur, l.name)})).filter(x => x.s >= 0.85).sort((a, b) => b.s - a.s);
    const f = c.length && (c.length === 1 || c[0].s > c[1].s + 0.05) ? c[0].l.name : "";
    if (f){ changes.push({from: cur, to: f, role: "expense"}); put(f); }
  });
  ["rcmCgstIn", "rcmSgstIn", "rcmIgstIn", "rcmCgstOut", "rcmSgstOut", "rcmIgstOut"].forEach(k => {
    const head = /Cgst/.test(k) ? "CGST" : /Sgst/.test(k) ? "SGST" : "IGST", kind = /In$/.test(k) ? "rcm-in" : "rcm-out";
    const cur = co.gst[k];
    const cands = gstNames.map(n => gstFits(n, head, kind)).filter(Boolean);
    // the default name, not in Tally, and nothing that fits: left as it is
    if (!cur && !cands.length) return;
    fix(cur || "", v => { co.gst[k] = v; }, gstValid(head, kind), () => best(cands), kind, "gst:" + k);
  });
  if (changes.length){
    Store.saveCompany(co);
    changes.forEach(ch => { if (ch.from && ch.to) replaceLedgerInWaiting(co.id, ch.from, ch.to, ch.role, true); });
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
  if (!Bridge.on()){ toast("Connect FinCom Bridge first." + (typeof TCloud === "object" && TCloud.on() ? " The Tally company of " + co.name + " is not open on any computer." : "")); return null; }
  if (!Bridge.up() || !Bridge.st.tallyUp) await Bridge.refresh();
  if (!Bridge.up() || !Bridge.st.tallyUp){ toast("Tally is not connected."); return null; }
  let o = Bridge.openFor(co);
  if (o) return o.name;
  const open = Bridge.st.open;
  if (!open.length){ toast("No company is open in your Tally. Open " + co.name + " in TallyPrime."); return null; }
  const ans = await askConfirm({title: "Which Tally company is " + co.name + "?", ok: "Use this company",
    body: '<p class="note" style="margin:0 0 10px">FinCom could not match <b>' + esc(co.name) + "</b> to a company open in your Tally by name or GSTIN. Choose it once; it is remembered.</p>" +
      '<div class="bk-form one"><label><span>Company open in Tally</span><select id="tcoPick">' + open.map(x => '<option value="' + esc(x.name) + '">' + esc(x.name) + " (port " + x.port + ")</option>").join("") + "</select></label></div>",
    read: () => ({name: (document.getElementById("tcoPick") || {}).value || ""})});
  if (!ans || !ans.data.name){ toast("No Tally company chosen for " + co.name + ", so nothing was sent to Tally."); return null; }
  co.tallyName = ans.data.name; Store.saveCompany(co);
  Bridge.lastOpenKey = null;
  await Bridge.refresh();
  o = Bridge.openFor(co);
  render();
  if (!o) toast("Tally company " + co.tallyName + " is not open in Tally now. Open it in TallyPrime and try again.");
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

