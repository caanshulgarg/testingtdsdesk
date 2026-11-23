/* @react-lazy: begin 99-pending-suppliers.js (the React app loads this file with Deductees and Client setup only: app/src/screens/Parties.jsx, Settings.jsx; build.py react_parts) */
/* ================================================================== */
/* The bill desk's waiting bills' new suppliers                        */
/* ================================================================== */
// Moved here whole from src/js/99-bill-suppliers.js (next-fix-audit-all: the app's first file, which that file is in, at
// its size budget, tests/run_legacy_room.py). Only Deductees (screens/Parties.jsx) and Client setup (screens/Settings.jsx)
// call these, and both screens' files import this one, so they are here whenever they are called.
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
if (typeof globalThis === "object") Object.assign(globalThis, {pendingSuppliers, addPendingSupplier});
/* @react-lazy: end */
