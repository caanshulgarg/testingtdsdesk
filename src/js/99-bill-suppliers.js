/* @react-lazy: begin 99-bill-suppliers.js (the React app loads this file with the bill, the review table, Deductees, Client setup, Unsorted uploads and the upload block: app/src/screens/Bill.jsx, Review.jsx, Parties.jsx, Settings.jsx, app/src/parts/Unsorted.jsx, UploadBlock.jsx, Reading.jsx, StateBar.jsx; build.py react_parts) */
/* ================================================================== */
/* The bill desk's suppliers (waiting bills' new suppliers, the year   */
/* read from Tally), pasted bills, Unsorted uploads moved to a client  */
/* ================================================================== */
// Kept out of legacy.js (its size budget, tests/run_legacy_room.py) and moved here from src/js/01 as they were: each is
// called only from a screen, or from a person's press on one (Read the year from Tally: doAct "ytdFetch", src/js/27;
// reviewCheckTally, src/js/18), once the screens' program is in.
// Suppliers on bills still waiting for review, not yet in the supplier list (review item 8): shown in Client setup as
// "new, not yet approved" so PAN, payment type and amounts credited earlier can be filled before the first approval
// (which is what makes the yearly limit right on that first bill).
function pendingSuppliers(cid){
  cid = cid || S.coId;
  const out = new Map();
  Object.values(D(cid).entries || {}).forEach(e => {
    if (e.status !== "draft" || !e.x || !String(e.x.vendorName || "").trim() || findParty(e.x, cid)) return;
    const pan = effectivePan(e.x), key = pan ? "pan:" + pan : "name:" + norm(e.x.vendorName);
    const k = out.get(key) || {key, name: e.x.vendorName, pan: pan || "", gstin: e.x.vendorGstin || "", natureId: e.natureId || "", ledgerName: e.partyLedger || "", tally: supplierInTally(e.x), bills: 0, total: 0};
    k.bills++; k.total = r2(k.total + num(e.x.total));
    out.set(key, k);
  });
  return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}
// save a supplier from a waiting bill into the list (the same shape approval makes)
function addPendingSupplier(key, cid){
  cid = cid || S.coId;
  const k = pendingSuppliers(cid).find(p => p.key === key);
  if (!k) return null;
  const id = k.pan ? "p-" + k.pan : "p-" + slug(k.name) + "-" + Date.now().toString(36);
  const party = {id, name: k.name, pan: k.pan, gstin: k.gstin, ledgerName: k.ledgerName, natureDefault: k.natureId && k.natureId !== "none" ? k.natureId : "", expenseLedger: "", ldcRate: "", ldcValidTo: "", ytd: {}};
  // the ledger of a bill still waiting is FinCom's guess until a person confirms it (Suppliers) or approves a bill
  if (k.ledgerName && typeof partyChoiceSet === "function") partyChoiceSet(party, k.ledgerName, "guessed");
  D(cid).parties[id] = party;
  Store.saveParty(cid, party);
  return party;
}
// credits to the supplier's ledger in Tally for the year, without GST
async function fetchPartyYtd(party, fy, ledger, opts){
  const co = CO(), cid = S.coId;
  if (!bridgeLive(co) || !ledger) return null;
  const span = fyStartEnd(fy);
  const today = new Date().toISOString().slice(0, 10);
  const to = span.to < today ? span.to : today;
  const j = await Bridge.call(ledgerLinesUrl(Bridge.openFor(co).name, ledger, span.from, to), null, 300000);
  // tdsBase: the value of the bills that carry their own TDS in Tally (a TDS ledger credited in the same entry), so the
  // catch-up of section 393 (old 194C/194J...: "aggregate ... credited") never charges them again (audit of 22-Nov-2026:
  // four Tally bills with TDS were taxed a second time); tdsSep: TDS in entries of their own (a journal or the payment,
  // the party debited), which no bill can be told from: the catch-up then asks a person (compute). A debit note (a
  // purchase return) to the supplier takes its value off the year's credits
  let credited = 0, gross = 0, n = 0, tdsBase = 0, tdsSep = 0;
  const amtOf = x => parseFloat(String(x.amount).replace(/,/g, "")) || 0, isTds = l => /\btds\b|^tds/i.test(l);
  [].concat(j.vouchers || []).forEach(v => {
    if (/^yes$/i.test(v.cancelled || "") || /^yes$/i.test(v.optional || "")) return;
    const entries = [].concat(v.entries || []);
    const mine = entries.find(x => norm(x.ledger) === norm(ledger));
    if (!mine) return;
    const amt = amtOf(mine), tds = entries.some(x => isTds(x.ledger) && amtOf(x) > 0);
    // the value without GST: the other side (debits for a bill, credits for a debit note), leaving out tax ledgers
    const side = sg => { let base = 0; entries.forEach(x => {
      if (norm(x.ledger) === norm(ledger)) return;
      const a = amtOf(x);
      if (sg * a >= 0) return;
      const info = ledgerInfo(x.ledger);
      if (info && /duties|taxes/i.test(info.group || "")) return;
      if (/\b(c|s|i|ut)gst|cess|tds\b/i.test(x.ledger)) return;
      base = r2(base + Math.abs(a));
    }); return base; };
    if (amt <= 0){
      if (/debit\s*note|purchase\s*return/i.test(v.type || "")){ n++; credited = r2(credited - (side(-1) || -amt)); }
      else if (tds) tdsSep = r2(tdsSep + entries.filter(x => isTds(x.ledger) && amtOf(x) > 0).reduce((s, x) => s + amtOf(x), 0));
      return;
    }
    n++;
    gross = r2(gross + amt);
    const base = side(1) || amt;
    credited = r2(credited + base);
    if (tds) tdsBase = r2(tdsBase + base);
  });
  credited = Math.max(0, credited);
  const info = {fy, ledger, credited, gross, vouchers: n, tdsBase, tdsSep, at: new Date().toISOString()};
  const key = normName(ledger) + "|" + fy;
  co.tallyYtd = Object.assign({}, co.tallyYtd, {[key]: info});
  Store.saveCompany(co);
  if (party){ party.tallyYtd = info; Store.saveParty(cid, party); }
  return info;
}
/* ---------- bills pasted in, and Unsorted uploads moved to a client ---------- */
function addPasted(text){
  let data;
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { data = JSON.parse(raw); }
  catch (err){
    const m = raw.match(/[\[{][\s\S]*[\]}]/);
    try { data = m ? JSON.parse(m[0]) : null; } catch (e2){ data = null; }
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? (Array.isArray(data.bills) ? data.bills : [data]) : [];
  const bills = list.filter(b => b && typeof b === "object" && (b.vendorName || b.invoiceNo || b.totalAmount));
  if (!bills.length){ toast("No bill details found. Paste the JSON exactly as Claude gave it."); return; }
  const cid = S.coId;
  let held = 0, lastId = null;
  // (the client's counts once at the end: statsHeld, src/js/01)
  statsHeld(() => bills.forEach((b, i) => {
    const e = newEntry("Pasted bill " + (b.invoiceNo ? b.invoiceNo : i + 1));
    applyExtraction(e, b, cid);
    e.readMode = "pasted";
    finishNewEntry(e, cid, null);
    if (e.status === "duplicate") held++; else lastId = e.id;
  }));
  S.pasteOpen = false;
  if (lastId){ S.filter = "draft"; S.selected = lastId; }
  const added = bills.length - held;
  toast([added ? added + " bill" + (added > 1 ? "s" : "") + " added" : "", held ? held + " held as duplicate" + (held > 1 ? "s" : "") : ""].filter(Boolean).join(", ") + ".");
  render();
}
async function assignInbox(id, cid){
  const item = S.inbox[id];
  if (!item || !cid) return;
  await Store.loadCompany(cid);
  const e = newEntry(item.fileName);
  if (item.j) applyExtraction(e, item.j, cid);
  else e.readError = item.note;
  e.fileHash = item.hash; e.readMode = item.readMode; if (item.freeWhy) e.freeWhy = item.freeWhy; if (item.readNote) e.readNote = item.readNote;
  movePreview(id, e.id);
  const pg = S.filePages[id] || item.pages;
  if (pg){ S.filePages[e.id] = e.pages = pg; delete S.filePages[id]; }
  delete S.inbox[id]; Store.deleteInbox(id);
  finishNewEntry(e, cid, null);
  toast(item.fileName + " moved to " + CO(cid).name + (e.status === "duplicate" ? ", held as a duplicate." : "."));
  render();
}
/* ---------- the reading queue's buttons, and the bar under an approved bill ---------- */
// a job in the reading queue: read it again (the same way, or with Google OCR or Claude), type it in, or open its bill
function jobAction(kind, jid){
  const j = S.jobs.find(x => x.id === jid);
  if (!j) return;
  if (kind === "retry" || kind === "google" || kind === "claude"){ S.readBlocked = null; j.force = kind === "retry" ? null : kind; j.advanced = false; j.status = "waiting"; j.msg = ""; j.prev = null; j.donePromise = new Promise(res => { j.markDone = res; }); S.batchSize = 2; pump(); render(); }
  else if (kind === "type") typeItIn(j);
  else if (kind === "open") openJobEntry(j);
}
function typeItIn(j){
  const cid = j.target === "auto" ? S.coId : j.target;
  if (!cid){ toast("Open the client first, then use Type it in."); return; }
  const e = newEntry(j.name);
  e.fileHash = j.hash; e.readError = j.msg;
  keepFile(e, j);
  if (isImage(j.file)) S.previews[e.id] = URL.createObjectURL(j.file);
  finishNewEntry(e, cid, null);
  j.status = "typed"; j.cid = cid; j.entryId = e.id;
  if (S.coId !== cid) openCompany(cid);
  S.filter = "draft"; S.selected = e.id; render();
}
function openJobEntry(j){
  const ref = j.entryId ? {cid:j.cid, entryId:j.entryId} : j.dupRef;
  if (!ref || !ref.cid){ toast("The earlier copy is not on this desk any more."); return; }
  openCompany(ref.cid).then(() => {
    const e = D(ref.cid).entries[ref.entryId];
    if (!e){ toast("The earlier copy is not on this desk any more."); return; }
    S.tab = "invoices"; S.filter = e.status; S.selected = e.id; render();
  });
}
// the bar under an approved bill (app/src/screens/Review.jsx)
function billBar(e){ const l = billPostLive(e, S.coId); return {note: e.exportedAt || e.goneFromTally ? tallyStateOf(e)[1] : "Waiting in Send to Tally",
  acts: [!l && ["undo", "Undo approval"], !e.exportedAt && ["goExport", "Send to Tally"], l && !postSending(S.coId).has(String(e.id)) && ["billDeletedInTally", "Deleted in Tally"]].filter(Boolean)}; }
if (typeof globalThis === "object") Object.assign(globalThis, {pendingSuppliers, addPendingSupplier, fetchPartyYtd, addPasted, assignInbox, jobAction, typeItIn, openJobEntry, billBar});
/* @react-lazy: end */
