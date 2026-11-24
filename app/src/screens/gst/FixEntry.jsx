// GST › What to fix: an entry corrected where it is shown (the owner, 23-Nov-2026: "any error should be rectified there
// only.. option of open in entry should pop up a new window there only.. and that change should be made to tally and fincom
// books also"; the forms approved the same day, findings/fix-in-place-plan.md section 2.3, decisions 1, 2, 4-7).
//   - "Open the entry" opens this window on the same page: the entry as FinCom Books hold it, and only the box this kind
//     of error needs: the invoice number (too long, characters, used twice), the place of supply (none, or the tax type not
//     matching it), the party's GSTIN (none, or not valid). Every other kind shows the entry and Open in Look up.
//   - A GSTIN (the owner, 24-Nov-2026, amending decision 5): the party ledger first, then that party's invoices of the
//     month on screen with no GSTIN, one that is not valid, or the ledger's old wrong one (never another valid GSTIN: a
//     branch, another address, a registration of other dates), listed all ticked, each sent on its own (the voucher's
//     PARTYGSTIN, shape A), read back, one after another; a row leaves What to fix only when its own invoice is corrected.
//     The ledger already right: Save goes on to the invoices. The GSTIN box stays in the invoices step: another GSTIN
//     typed there changes the ledger first, then the invoices, in the same Save. A party that is not a ledger (a cash
//     sale with the buyer's details): only the invoices. A ledger FinCom holds no change number for is read from Tally
//     first in the same Save (the bridge's one-ledger read), then the fix goes with that change number.
//   - Save in Tally sends the one change to FinCom Bridge (POST /fix, bridge-go/fixalter.go), which checks Tally's change
//     number (AlterID) first and never overwrites a later change, makes the change, reads the entry back and gives it to
//     FinCom's cloud. The entry read back replaces FinCom's (Books.importDayBook of that one voucher), so the list is worked
//     out again and the row leaves it.
//   - Tally closed, or no FinCom Bridge on this computer: the change is kept with the client's books (b.fixq) and sent when
//     Tally is open (decision 4), checked against Tally's change number then, from any computer whose bridge is up for
//     the client (who saved it and who sent it are both kept: by and dev, sentBy and sentDev).
//   - Every change is kept in Changes made here, with Undo where the earlier value is one Tally can be given again.
// Anyone who can post to Tally may fix (decision 6). Plain words only, no warnings.
/* global ledGroupPath, GST_STATE_ALIAS, S, CO, render, saveBooks, Books, Bridge, bridgeLive, linkGuid, ensureTallyCompany, LinkRec, tallyCoName, GST_STATES, gstinValid, INR, r2, num, fmtDate, tallyDate, FC, LK, auditEvent, GSTR, AlertClear, stateCodeFrom */
import { useState, useEffect, useRef } from "react";
import { PanelDialog } from "../../parts/DetailDrawer.jsx";

const NUM = /^Invoice numbers (longer than|with characters|used twice)/;
const POS = /^(Outward invoices with no place of supply|Tax type that does not match the place of supply)$/;
const GSTIN = /^(Invoices to a registered party with no GSTIN|Buyer GSTINs that are not valid|Purchases with no supplier GSTIN|Supplier GSTINs that are not valid)$/;

// what the window lets a person change for a kind of error ("" : nothing; the entry is shown)
export function fixKind(what) {
  if (NUM.test(what)) return "number";
  if (POS.test(what)) return "pos";
  if (GSTIN.test(what)) return "gstin";
  return "";
}

// the rules of the approved forms (bridge-go/fixalter.go), so Save is offered only for what Tally will be sent
export const numberOk = (n) => /^[A-Za-z0-9/-]{1,16}$/.test(n) && /[A-Za-z1-9]/.test(n);
const gstOk = (g) => typeof gstinValid === "function" ? gstinValid(g) : /^\d{2}[A-Z0-9]{13}$/.test(g);
const STATES = () => Object.keys(GST_STATES || {}).filter((c) => /^\d{2}$/.test(c) && c !== "96" && c !== "99").sort().map((c) => [c, GST_STATES[c]]);
const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(d)) : "");
// a state's code from a code or a name, "&" read as "and" ("Jammu & Kashmir", "Andaman & Nicobar Islands")
const flat = (t) => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z]/g, "");
export function stCode(t) {
  const x = String(t || "").trim(), st = GST_STATES || {};
  if (/^\d{2}$/.test(x)) return st[x] ? x : "";
  const n = flat(x), al = typeof GST_STATE_ALIAS === "object" ? GST_STATE_ALIAS : {};
  const hit = n && Object.keys(st).find((c) => flat(st[c]) === n || (al[c] || []).some((a) => flat(a) === n));
  return hit || (typeof stateCodeFrom === "function" ? stateCodeFrom(x) : "");
}
const amountOf = (d) => (d.total != null ? d.total : num(d.taxable) + num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess));

// what the window and Changes made here say
const WAIT = "Waiting for Tally. It is saved there when Tally is open.";
// no FinCom Bridge on this computer (review of 24-Nov-2026): kept, and sent from any computer where Tally is open
const NOBRIDGE = "Waiting for Tally. It goes to Tally from the computer where Tally is open.";
const CHANGED = "Changed in Tally since you opened it. This is how it is now.";
const OLD = "This needs FinCom Bridge 2.5.21 or later on the Tally computer. Update it there, then press Save again.";
const SAID = { done: "Saved in Tally", waiting: "Waiting for Tally", already: "Already in Tally" };
const ALREADY = "Already in Tally: it holds this value now, though it was not sent from here.";
const KEEP = 200; // changes kept with the books: the newest 200, the oldest dropped
const NOCO = "Open this entry again to save the change.";
const STALE = 120000; // a change left "sending" (its page closed mid-send) is taken as waiting after two minutes
// still to go to Tally: waiting, or being sent from the page it was saved on ("sending": the background sending leaves it)
const toGo = (x) => x.state === "waiting" || x.state === "sending";
const tookIt = (x) => x.state === "done" || x.state === "already";
// the party is a ledger to change only under Sundry Debtors or Sundry Creditors, or a sub-group of them (review of
// 24-Nov-2026): Cash-in-Hand, Bank Accounts, Bank OD A/c or a group not known never
const DRCR = /^sundry (debtors|creditors)$/i;
export function partyGroupOk(b, name) {
  try { return !!name && typeof ledGroupPath === "function" && ledGroupPath(b || {}, name).some((g) => DRCR.test(String(g || "").trim())); } catch (e) { return false; }
}

// the changes kept with the client's books: held ones, and the history (b.fixq, one of BOOKS_KEYS). Each change carries
// the client it was made for (cid) and that client's Tally company (coGuid): it is sent for that client and its answer
// goes into that client's books, whichever client is open by then.
export const FixQ = {
  list(bk) { const b = bk || S.books || {}, l = (b.fixq = Array.isArray(b.fixq) ? b.fixq : []); l.forEach((x) => { if (!x.cid) x.cid = b.cid; }); return l; },
  busy: false, last: 0, flying: new Set(), undoing: new Set(),
  // the books of a client: the ones open, else as kept in this browser
  async books(cid) {
    const b = S.books;
    if (b && b.cid === cid && !b.loading) return b;
    try { const d = await Books.load(cid); return d && d.cid === cid ? d : null; } catch (e) { return null; }
  },
  // the client's linked Tally company, as the link record says (no bridge needed)
  async coGuid(co) { try { return (typeof LinkRec === "object" && (await LinkRec.guidFor(co, tallyCoName(co)))) || ""; } catch (e) { return ""; } },
  // a change waiting, or with Tally now, for this entry (or ledger)
  waitingFor(key) { return !!key && FixQ.list().some((x) => toGo(x) && (x.vid === key || (x.ask && x.ask.target === "ledger" && x.ask.ledger === key))); },
  // Tally holds exactly what was asked (the number as typed, letter case too; a place of supply by its state code, so
  // "Jammu & Kashmir" is "Jammu and Kashmir")
  mine(rec, now) {
    if (!now) return false;
    const f = rec.ask.fields || {}, k = Object.keys(f)[0], want = String(f[k] || "");
    const got = String(k === "gstin" ? now.gstin || "" : k === "number" ? now.number || "" : now.pos || "");
    return !!want && (k === "pos" ? !!stCode(want) && stCode(got) === stCode(want) : got === want);
  },
  // who is signed in here (saved by, sent by)
  who() { return (window.Cloud && Cloud.st && Cloud.st.email) || ""; },
  // this computer (a browser's own id, kept in it): kept with each change, for the computer that saved it and the one that sent it
  dev() {
    if (typeof AlertClear === "object" && AlertClear && typeof AlertClear.device === "function") return AlertClear.device();
    try { let d = localStorage.getItem("fincom:device-id"); if (!d) { d = "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("fincom:device-id", d); } return d; }
    catch (e) { return FixQ.memDev || (FixQ.memDev = "dev-" + Math.random().toString(36).slice(2, 10)); }
  },
  // the changes Tally took (Changes made here (N))
  taken(l) { return (l || FixQ.list()).filter((x) => x.state === "done").length; },
  // the bridge asked once: what the answer means. Bridge.call throws on any answer that says no; its body comes with it
  // (src/js/24). Only an answer held by the bridge (Tally closed or in use) and no answer at all wait to be sent again.
  async ask(rec, co) {
    let tname = "", lg = null;
    try { tname = await ensureTallyCompany(co); lg = tname ? await linkGuid(co, tname) : null; } catch (e) { lg = null; }
    if (!tname) return { state: "waiting", words: WAIT };
    if (!lg || !lg.guid) return { state: "refused", words: (lg && lg.why) || "Not sent: this client's Tally company is not linked." };
    // a waiting change that does not say which Tally company it was made for is never sent (review of 24-Nov-2026);
    // one being saved now from its window takes the linked company
    if (!rec.coGuid) { if (rec.state !== "sending") return { state: "refused", words: NOCO }; rec.coGuid = lg.guid; }
    if (rec.coGuid && lg.guid !== rec.coGuid) return { state: "refused", words: "Not sent: this client's Tally company is not the one this change was made for." };
    if (typeof auditEvent === "function") auditEvent("tally.fix", tname + " · " + rec.label, rec.cid || "");
    // one /fix: its answer, or {fail} for what is said at once (an older bridge, a network fault: no answer at all)
    const call = async (body) => {
      try { return { r: (await Bridge.call("/fix", Object.assign({ company: tname, companyGuid: lg.guid }, body), 30000)) || {} }; }
      catch (e) {
        if (e && e.status === 404) return { fail: { state: "old", words: OLD } };
        if (e && e.status === 200 && e.body && typeof e.body === "object") return { r: e.body };
        if (!e || e.code === "bridge_down") return { fail: { state: "waiting", words: WAIT }, lost: true };
        return { fail: { state: "refused", words: (e && e.message) || "FinCom Bridge did not take it." } };
      }
    };
    const at = new Date().toISOString(), p = { coGuid: lg.guid, tried: at };
    // a ledger FinCom holds no change number for (the owner, 24-Nov-2026): read from Tally by its name first (the bridge's
    // one-ledger read, its 2 s stop and the typing gate; nothing sent), then the fix with that change number, in the
    // same Save. Tally's GSTIN not the one shown: changed since, nothing sent.
    if (rec.ask.target === "ledger" && !rec.ask.alterId) {
      const a = await call(Object.assign({}, rec.ask, { readFirst: true }));
      if (a.fail) return a.fail;
      const r0 = a.r;
      if (r0.held) return Object.assign(p, { state: "waiting", words: WAIT });
      if (!r0.read) return Object.assign(p, r0.gone ? { state: "gone", words: r0.message || "Tally has no such ledger." } : { state: "refused", words: r0.message || r0.error || "Tally did not change it." });
      const now = r0.now || {}, alt = String(r0.alterNow || now.alterId || "");
      const field = rec.ask.fields && rec.ask.fields.pan != null ? "pan" : "gstin";
      if (!/^\d+$/.test(alt) || String(now[field] || "").toUpperCase() !== String(((rec.ask.was || {})[field]) || "").toUpperCase())
        return Object.assign(p, FixQ.mine(rec, now) ? { state: "already", words: ALREADY, after: now, doneAt: at } : { state: "changed", words: CHANGED, now }, { r: { now } });
      rec.ask = p.ask = Object.assign({}, rec.ask, { alterId: alt });
    }
    const sentBefore = !!rec.mayHave;
    const a = await call(rec.ask);
    if (a.fail) return Object.assign(a.fail, a.lost ? { mayHave: true } : {}); // no answer: Tally may have it
    const r = a.r;
    if (r.ok) return Object.assign(p, { state: "done", before: r.before, after: r.after, doneAt: at, r }, Array.isArray(r.alsoChanged) && r.alsoChanged.length ? { also: r.alsoChanged.map(String) } : {});
    if (r.held) return Object.assign(p, { state: "waiting", words: WAIT });
    // changed since, but Tally holds exactly what was asked: this computer's earlier send whose answer was lost (done,
    // with Undo), else someone else's (already in Tally, no Undo)
    if (r.changed) return Object.assign(p, !FixQ.mine(rec, r.now) ? { state: "changed", words: CHANGED, now: r.now } : sentBefore ? { state: "done", after: r.now, doneAt: at } : { state: "already", words: ALREADY, after: r.now, doneAt: at }, { r });
    if (r.kept) return Object.assign(p, { state: "kept", words: r.message || "Tally kept its own value.", after: r.after, r });
    if (r.unknown) return Object.assign(p, { state: "unknown", mayHave: true, words: r.message || "Tally did not answer. Ask Tally again to see whether it changed." });
    if (r.gone) return Object.assign(p, { state: "gone", words: r.message || "Tally no longer has this entry." });
    return Object.assign(p, { state: "refused", words: r.message || r.error || "Tally did not change it." });
  },
  // send one change (never two at once); its record says how it went
  async send(rec) {
    if (FixQ.flying.has(rec.id)) return rec;
    FixQ.flying.add(rec.id);
    try {
      const co = CO(rec.cid), bk = rec.after ? await FixQ.books(rec.cid) : null;
      // queued after another change (an invoice after its party ledger): it waits for that one, and is not sent when
      // that one did not go
      const dep = bk ? FixQ.list(bk).find((y) => y.id === rec.after) : null;
      const p = dep && toGo(dep) ? { state: "waiting", words: rec.words || WAIT }
        : dep && !tookIt(dep) ? { state: "refused", words: "Not sent: the party ledger was not changed in Tally." }
        : !co || typeof bridgeLive !== "function" || !bridgeLive(co) ? { state: "waiting", words: NOBRIDGE } : await FixQ.ask(rec, co);
      // sent from here: who and which computer sent it, kept beside who saved it (rec.by, rec.dev)
      // held just now: the background sending waits its minute before asking Tally again
      if (p.state === "waiting") FixQ.last = Date.now();
      if (p.state !== "waiting" && !(dep && !tookIt(dep))) Object.assign(p, { sentBy: FixQ.who(), sentDev: FixQ.dev(), sentAt: new Date().toISOString() });
      await FixQ.put(rec, p);
    } finally { FixQ.flying.delete(rec.id); }
    if (typeof render === "function") render();
    return rec;
  },
  // the answer into the books of the change's own client: the record, and what Tally holds now
  async put(rec, p) {
    const r = p.r; delete p.r;
    const bk = await FixQ.books(rec.cid);
    const got = !!(r && bk && (await FixQ.back(bk, rec, r)));
    if (p.state === "done") p.words = (got ? "Saved in Tally and FinCom Books." : "Saved in Tally. FinCom Books take it at the next read from Tally.")
      + (p.also ? " Tally also changed the " + p.also.join(", the ") + " of this entry. Check it in Tally." : "");
    if (p.state === "already" && !got) p.words = ALREADY + " FinCom Books take it at the next read from Tally.";
    Object.assign(rec, p);
    if (!bk) return;
    const x = FixQ.list(bk).find((y) => y.id === rec.id);
    if (x && x !== rec) Object.assign(x, p);
    if (typeof saveBooks === "function") await saveBooks({}, bk);
  },
  // a record of a client's books changed (Undo used), whichever client is open
  async mark(rec, p) {
    Object.assign(rec, p);
    const bk = await FixQ.books(rec.cid);
    if (!bk) return;
    const x = FixQ.list(bk).find((y) => y.id === rec.id);
    if (x && x !== rec) Object.assign(x, p);
    if (typeof saveBooks === "function") await saveBooks({}, bk);
  },
  // what Tally holds now goes into these books: the entry read back (one voucher), or the ledger's GSTIN, PAN and change
  // number. True when it came.
  async back(b, rec, r) {
    if (rec.ask.target === "ledger") {
      const a = r.after || r.now || {}, led = rec.ask.ledger;
      // never a GSTIN written for a ledger outside Sundry Debtors and Sundry Creditors
      if ((a.gstin == null && a.pan == null) || !partyGroupOk(b, led)) return false;
      if (a.gstin != null) { b.gstins = b.gstins || {}; if (a.gstin) b.gstins[led] = a.gstin; else delete b.gstins[led]; }
      if (a.pan) { b.pans = b.pans || {}; b.pans[led] = a.pan; }
      // its change number kept, also for a ledger FinCom has no other details of (a changed or read answer)
      if (/^\d+$/.test(String(a.alterId || ""))) {
        const li = (b.ledInfo = b.ledInfo || {})[led] || (b.ledInfo[led] = { gstin: a.gstin || "", pan: a.pan || "" });
        li.alt = +a.alterId;
      }
      return true;
    }
    if (!r.xml) return false;
    try {
      const env = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>" + r.xml + "</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
      const got = await Books.importDayBook(new File([env], "entry.xml", { type: "text/xml" }));
      const nv = ((got && got.vouchers) || [])[0];
      if (!nv || !nv.id) return false;
      const vs = b.vouchers || (b.vouchers = []), i = vs.findIndex((v) => v.id === nv.id);
      if (i >= 0) vs[i] = nv; else vs.push(nv);
      return true;
    } catch (e) { return false; /* the cloud copy brings it in its turn */ }
  },
  // the held changes of the client open, sent one after another when Tally is open here (at most once a minute from a
  // page drawing); another client opened meanwhile: the one with Tally finishes for its own client, the rest wait. Any
  // computer whose bridge is up sends them, whoever saved them and wherever (review of 24-Nov-2026): the bridge checks
  // Tally's change number and the value first, so a second send of the same change does nothing.
  async pump(force) {
    const b = S.books, cid = b && b.cid;
    if (!cid || b.loading || FixQ.busy || (!force && Date.now() - FixQ.last < 60000)) return;
    const co = CO(cid);
    if (!co || typeof bridgeLive !== "function" || !bridgeLive(co)) return;
    // a change left "sending" by a page closed mid-send: waiting (Tally may have it; the change number decides)
    FixQ.list(b).forEach((x) => { if (x.state === "sending" && !FixQ.flying.has(x.id) && !(Date.now() - Date.parse(x.at || 0) < STALE)) Object.assign(x, { state: "waiting", mayHave: true, words: WAIT }); });
    const w = FixQ.list(b).filter((x) => x.state === "waiting" && x.cid === cid && !FixQ.flying.has(x.id));
    if (!w.length) return;
    FixQ.busy = true; FixQ.last = Date.now();
    try {
      for (const rec of w) {
        if (!S.books || S.books.cid !== cid) break;
        await FixQ.send(rec);
        if (rec.state === "waiting") break;
      }
    } finally { FixQ.busy = false; render(); }
  },
  // a new change for the client open: kept first (so a closed page or Tally loses nothing) as "sending", then sent; its
  // own answer makes it waiting when it did not go. queued (words): kept as waiting, not sent now (it goes in its turn)
  async add(ask, label, extra, queued) {
    const b = S.books, cid = b && b.cid;
    if (!cid) return null;
    const co = CO(cid), coGuid = co ? await FixQ.coGuid(co) : "";
    const rec = Object.assign({ id: "fx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
      by: FixQ.who(), dev: FixQ.dev(), cid, coGuid, ask, label,
      state: queued ? "waiting" : "sending", words: queued || "Saving in Tally…" }, extra || {});
    const l = FixQ.list(b);
    l.push(rec);
    // the newest KEEP kept: the oldest dropped first, a change still waiting for Tally last
    for (let i = 0; l.length > KEEP && i < l.length;) { if (!toGo(l[i]) && l[i] !== rec) l.splice(i, 1); else i++; }
    while (l.length > KEEP) l.splice(l[0] === rec ? 1 : 0, 1);
    if (typeof saveBooks === "function") await saveBooks({}, b);
    return queued ? rec : FixQ.send(rec);
  },
};
if (typeof window === "object") window.FixQ = FixQ;

// the voucher of a row in FinCom Books
const voucherOf = (id) => ((S.books || {}).vouchers || []).find((v) => v.id === id) || null;
const SUPPLIER = /^(Purchases with no supplier GSTIN|Supplier GSTINs that are not valid)$/;
// the rows of the month on screen that GST reads (the sales side, or the purchases for a supplier's GSTIN)
const rowsOf = (what, ym, reg) => { try { return (SUPPLIER.test(what) ? GSTR.inward(ym, reg) : GSTR.outward(ym, reg)) || []; } catch (e) { return []; } };
const up = (g) => String(g || "").trim().toUpperCase();
// the party ledger of an entry (review of 24-Nov-2026): Tally's PARTYLEDGERNAME is always one of the entry's ledger
// lines, so the party is its ledger when it is one of them and its group is under Sundry Debtors or Sundry Creditors.
// Anything else (a cash sale with the buyer's details, Cash or a bank as the party, a group not known): no ledger step,
// and only the invoice opened is corrected.
export function partyLedgerOf(v, party) {
  const p = String(party || ""), u = (x) => (Books && Books.unesc ? Books.unesc(x) : String(x || ""));
  if (!p || (v && Array.isArray(v.ent) && v.ent.length && !v.ent.some((e) => e && (e.l === p || u(e.l) === u(p))))) return "";
  return partyGroupOk(S.books, p) ? p : "";
}
// a party's invoices of the month that the GSTIN fix corrects: no GSTIN, one that is not valid (its check digit), or one
// of `wrong` (the ledger's old wrong GSTIN). Never one with another valid GSTIN: another address, a branch, or a
// registration of other dates. Each must carry Tally's change number to be sent. gstin null: none typed yet.
export function partyInvoices(what, ym, reg, party, gstin, wrong) {
  const seen = new Map(), bad = new Set((wrong || []).map(up).filter(Boolean));
  rowsOf(what, ym, reg).forEach((r) => {
    if (!r || !r.id || r.party !== party || r.b2cSum || r.b2cNote || r.fromHold || seen.has(r.id)) return;
    const g = up(r.gstin);
    if ((gstin && g === gstin) || (g && gstOk(g) && !bad.has(g))) return;
    const v = voucherOf(r.id);
    if (v && v.alt != null) seen.set(r.id, { id: r.id, no: r.no || v.no || "", date: v.date, gstin: String(r.gstin || ""), amount: amountOf(r) });
  });
  return [...seen.values()];
}
// the row of an entry as the list works it out now (after Tally's entry came in: its number, place of supply, GSTIN)
const rowNow = (what, ym, reg, id) => (id && rowsOf(what, ym, reg).find((r) => r.id === id)) || null;
const posCodeOf = (v) => (v && v.pos && typeof stateCodeFrom === "function" ? stateCodeFrom(v.pos) : "");
const LED_SAID = { done: "Saved in Tally", has: "Has this GSTIN", change: "Changed first" };

// the window
export function FixEntry({ d: d0, c, why, tally, at, onClose, onLookup }) {
  const [ym, reg] = String(at || "").split("|");
  const kind = fixKind(c.what), v = d0 && d0.id ? voucherOf(d0.id) : null;
  const [val, setVal] = useState(null), [st, setSt] = useState(null), [busy, setBusy] = useState(false);
  // the invoices step of a GSTIN: the invoices listed (fixed for the GSTIN they were sent with), the ones unticked, how
  // each went (with the GSTIN it was sent), the ledger's GSTINs this window replaced, the ledger saved here
  const [inv, setInv] = useState(null), [off, setOff] = useState(() => new Set()), [invSt, setInvSt] = useState({});
  const [olds, setOlds] = useState([]), [ledSaved, setLedSaved] = useState(false);
  const inStep = useRef(false);
  // the entry as it is now: after "changed since" (or kept) the list's own row of Tally's entry, else the one opened
  const fresh = st && (st.state === "changed" || st.state === "kept") && kind !== "gstin" ? rowNow(c.what, ym, reg, d0.id) : null;
  const d = fresh || d0;
  const party = String(d.party || ""), led = kind === "gstin" ? partyLedgerOf(v, party) : party;
  const ledG = led ? up(((S.books || {}).gstins || {})[led]) : "";
  const posNow = (fresh && fresh.posCode) || (st && st.state === "changed" && posCodeOf(v)) || d.posCode || String(d.pos || "").slice(0, 2);
  const noNow = fresh ? String(fresh.no || "") : String(d.no || "");
  const startVal = kind === "number" ? String(d0.no || "") : kind === "pos" ? (/^\d{2}$/.test(posNow) ? posNow : (d0.gstin ? String(d0.gstin).slice(0, 2) : ""))
    : kind === "gstin" ? (led ? ledG : up(d0.gstin)) : "";
  const value = val == null ? startVal : val;
  const clean = kind === "gstin" ? value.trim().toUpperCase() : value.trim();
  const gstGood = kind === "gstin" && gstOk(clean);
  // the ledger to change first (another GSTIN typed than it holds); the GSTINs whose invoices are corrected too
  const ledNeeds = kind === "gstin" && !!led && clean !== ledG;
  const wrong = olds.concat(ledNeeds && ledG ? [ledG] : [], !led ? [up(d0.gstin)] : []);
  // with no ledger of the party, only the invoice opened (never every invoice with that name)
  const invNow = kind !== "gstin" ? [] : partyInvoices(c.what, ym, reg, party, gstGood ? clean : null, wrong).filter((x) => led || x.id === d0.id);
  // the invoices step: no ledger (only invoices), or the ledger right with invoices to correct; it stays once begun
  if (kind === "gstin" && (!led || (gstGood && !ledNeeds && invNow.length))) inStep.current = true;
  const step = kind === "gstin" && inStep.current ? "invoices" : "entry";
  const invList = inv && inv.g === clean ? inv.rows : invNow;
  const finished = (r) => r && (r.state === "done" || r.state === "already");
  const said = (x) => { const r = invSt[x.id]; return r && r.to === clean ? r : null; };
  const invLeft = invList.filter((x) => !off.has(x.id) && !finished(said(x)));
  const ok = kind === "number" ? numberOk(clean) && clean !== noNow : kind === "pos" ? /^\d{2}$/.test(clean) && clean !== posNow
    : kind === "gstin" ? gstGood && (ledNeeds || invLeft.length > 0) : false;
  const canFix = kind && (kind === "gstin" ? !!party : !!(v && v.id && v.alt != null));
  // a change of this entry (or ledger, or one of the invoices) waiting for Tally, or with Tally now: not asked twice
  const held = busy || (st && st.state === "waiting") || FixQ.waitingFor(kind === "gstin" ? led : d0.id) || invList.some((x) => FixQ.waitingFor(x.id));
  // one saved on a computer with no bridge, or on this one before: sent now when the bridge is up here
  useEffect(() => { if (FixQ.waitingFor(kind === "gstin" ? led : d0.id) || invList.some((x) => FixQ.waitingFor(x.id))) FixQ.pump(true); }, []);
  const ledAlt = (((S.books || {}).ledInfo || {})[led] || {}).alt;
  const ledState = ledNeeds ? "change" : ledSaved ? "done" : "has";
  const later = (f) => setTimeout(f, 1200);
  // the ticked invoices, one at a time, each read back (Tally closed: that one waits, the rest are not sent now). Another
  // client opened meanwhile: stopped; the rest stay to be fixed for their own client.
  // one invoice's GSTIN fix (each with its own change number), sent now, or queued as waiting (words) after `after`
  const addInvoice = (x, queued, after) => {
    const iv = voucherOf(x.id);
    if (!iv || iv.alt == null) return Promise.resolve({ state: "refused", words: "Not sent: FinCom has no change number of this invoice. Read the books from Tally again." });
    const ask = { target: "voucher", guid: iv.id, alterId: String(iv.alt), vchType: Books.unesc(iv.type), vchDate: iv.date, fields: { gstin: clean } };
    return FixQ.add(ask, "GSTIN on " + (x.no || "the invoice") + " of " + day(iv.date) + ": " + (iv.gstin || "none") + " → " + clean,
      Object.assign({ was: String(iv.gstin || ""), to: clean, kind: "gstin", vid: iv.id }, after ? { after } : {}), queued);
  };
  // the ticked invoices, one at a time, each read back. Tally closed (or no bridge here): that one waits and the rest
  // are queued after it, to go in order when Tally opens. Another client opened meanwhile: stopped; the rest stay to be
  // fixed for their own client. after/queued: the party ledger's change held, so every one is queued after it.
  const sendInvoices = async (list, cid, after, queued) => {
    setInv({ g: clean, rows: list });
    const now = {}, show = () => setInvSt((o) => Object.assign({}, o, now));
    let hold = queued || "";
    for (const x of list) {
      if (off.has(x.id) || finished(said(x))) continue;
      if (!S.books || S.books.cid !== cid) break;
      if (!hold) { now[x.id] = { state: "waiting", to: clean, words: "Saving in Tally…" }; show(); }
      const rec = await addInvoice(x, hold, after);
      if (!rec) break;
      now[x.id] = { state: rec.state, words: rec.words, to: clean }; show();
      if (rec.state === "waiting") hold = rec.words || WAIT;
    }
    render();
    if (!hold && S.books && S.books.cid === cid && list.every((x) => off.has(x.id) || finished(now[x.id]) || finished(said(x)))) later(onClose);
  };
  const save = async () => {
    const cid = (S.books || {}).cid, fromStep = step === "invoices", seen = invList;
    setBusy(true);
    try {
      if (kind === "gstin" && !ledNeeds) { await sendInvoices(seen, cid); return; }
      // the entry's own fix, or the party ledger first. A ledger with no change number in FinCom Books is read from Tally
      // first, in this same Save (FixQ.ask)
      setSt({ state: "waiting", words: kind === "gstin" && (ledAlt == null || ledAlt === "") ? "Reading the party from Tally, then saving…" : "Saving in Tally…" });
      const ask = kind === "gstin"
        ? Object.assign({ target: "ledger", ledger: led, was: { gstin: ledG }, fields: { gstin: clean } }, ledAlt != null && ledAlt !== "" ? { alterId: String(ledAlt) } : {})
        : { target: "voucher", guid: v.id, alterId: String(v.alt), vchType: Books.unesc(v.type), vchDate: v.date, fields: { [kind]: clean } };
      const label = kind === "gstin" ? "GSTIN of " + led + ": " + (ledG || "none") + " → " + clean
        : kind === "number" ? "Number of the " + (Books.unesc(v.type) || "entry") + " of " + day(v.date) + ": " + (noNow || "none") + " → " + clean
        : "Place of supply of " + (noNow || "the entry") + ": " + ((GST_STATES || {})[posNow] || "none") + " → " + ((GST_STATES || {})[clean] || clean);
      const rec = await FixQ.add(ask, label, { was: kind === "gstin" ? ledG : kind === "number" ? noNow : posNow, to: clean, kind, vid: kind === "gstin" ? "" : d0.id || "" });
      if (!rec) return;
      setSt(rec); render();
      // the party ledger held (Tally closed, or no bridge here): its invoices are queued after it, to go in order
      if (kind === "gstin" && rec.state === "waiting") {
        const l = fromStep ? seen : partyInvoices(c.what, ym, reg, party, clean, olds.concat(ledG ? [ledG] : []));
        if (l.length) { inStep.current = true; await sendInvoices(l, cid, rec.id, rec.words || WAIT); }
        return;
      }
      if (!finished(rec)) return;
      if (kind !== "gstin") { later(onClose); return; }
      // the ledger saved: its GSTIN before is one whose invoices are corrected too. From the invoices step the same Save
      // goes on to the ticked invoices; from the entry they are listed first, all ticked (none: done)
      const ol = olds.concat(ledG ? [ledG] : []), l = fromStep ? seen : partyInvoices(c.what, ym, reg, party, clean, ol);
      setOlds(ol); setLedSaved(true);
      if (!l.length) { later(onClose); return; }
      inStep.current = true;
      if (fromStep) await sendInvoices(l, cid); else setInv({ g: clean, rows: l });
    } finally { setBusy(false); }
  };
  // Tally did not say whether it changed: asked again only when the person presses it (the change number decides)
  const again = async () => { if (!st) return; setBusy(true); await FixQ.send(st); setBusy(false); if (finished(st)) later(onClose); };
  const tick = (id) => { const n = new Set(off); if (n.has(id)) n.delete(id); else n.add(id); setOff(n); };
  const lines = v ? (v.ent || []).filter((e) => e && e.l) : [];
  const gstNow = fresh ? fresh.gstin : (v && st && st.state === "changed" ? v.gstin : d.gstin);
  // the ledger's own answer: shown in the entry step; in the invoices step only when it did not go (done: its line says so)
  const showSt = st && (step === "entry" || !finished(st));
  const gstBox = kind === "gstin" && <label>GSTIN of {party} <input type="text" data-fix-input="gstin" value={value} maxLength={15} disabled={busy} onChange={(e) => setVal(e.target.value.toUpperCase())} autoFocus />
    <span className="note" data-fix-count="">{gstOk(clean) ? "✓ " + ((GST_STATES || {})[clean.slice(0, 2)] || "") : clean.length + " of 15"}</span>
    <span className="note fx-sub">{step === "entry" ? "Changed on the party ledger in Tally, then on this party's invoices of the month." : led ? "Changed on the party ledger in Tally, then on the ticked invoices." : "Changed on the ticked invoices only."}</span></label>;
  return <PanelDialog open={true} onClose={onClose} title={(noNow || "Entry") + (d.date ? " · " + day(d.date) : "")} description={undefined} attrs={{ "data-fix-entry": d0.id || "", "data-fix-kind": kind || "none", "data-fix-step": step }}>
    <div className="fx-pop">
      <p className="fx-pop-head" data-fix-head="">{[v && Books.unesc(v.type), d.party, d.id ? money(amountOf(d)) : ""].filter(Boolean).join(" · ")}</p>
      {why && step === "entry" && <p className="note" data-fix-why="">{why}</p>}
      {canFix && <div className="fx-field">
        {kind === "number" && <label>Invoice number <input type="text" data-fix-input="number" value={value} maxLength={40} onChange={(e) => setVal(e.target.value)} autoFocus />
          <span className="note" data-fix-count="">{clean.length} of 16{numberOk(clean) ? " ✓" : ""}</span></label>}
        {kind === "pos" && <label>Place of supply <select data-fix-input="pos" value={value} onChange={(e) => setVal(e.target.value)} autoFocus>
          <option value="">Choose the state</option>{STATES().map(([cd, n]) => <option key={cd} value={cd}>{cd} {n}</option>)}</select></label>}
        {gstBox}
        {kind === "number" && <p className="note fx-sub">Up to 16 letters, digits, / and -.</p>}
      </div>}
      {step === "invoices" && <div className="fx-inv" data-fix-invoices={invList.length}>
        <p className="note">{!invList.length ? "No invoice of " + party + " in this month needs it." : led
          ? "These invoices of " + party + (ym ? " in " + (GSTR.label ? GSTR.label(ym) : ym) : "") + " have no GSTIN, one that is not valid, or the ledger's old one. Ticked ones get " + (gstGood ? clean : "the GSTIN above") + " in Tally."
          : party + " is not a ledger in Tally: the buyer's details are on the invoice. Ticked ones get " + (gstGood ? clean : "the GSTIN above") + " in Tally."}</p>
        <table className="bk-table fx-lines"><tbody>
          {led && <tr className="fx-led-row" data-fix-led-row={led} data-fix-led-state={ledState}>
            <td>Party ledger: {led}</td>
            <td className="n">{ledState === "change" ? <>{ledG || "no GSTIN"}<br />→ {gstGood ? clean : "…"}</> : ledG}</td>
            <td className="n">{LED_SAID[ledState]}</td></tr>}
          {invList.map((x) => { const r = said(x); return <tr key={x.id} data-fix-inv={x.id} data-fix-inv-state={r ? r.state : ""}>
            <td><label className="fx-tick"><input type="checkbox" data-fix-tick={x.id} checked={!off.has(x.id)} disabled={held || finished(r)} onChange={() => tick(x.id)} /> {x.no || "—"} · {day(x.date)}</label></td>
            <td className="n">{x.gstin || "no GSTIN"}</td>
            <td className="n">{r ? (finished(r) ? SAID[r.state] : r.words) : money(x.amount)}</td></tr>; })}
        </tbody></table>
      </div>}
      {step === "entry" && <table className="bk-table fx-lines" data-fix-lines=""><tbody>
        {lines.map((e, i) => <tr key={i}><td>{e.l}</td><td className="n">{e.a < 0 ? "Dr" : "Cr"} {INR.format(r2(Math.abs(num(e.a))))}</td></tr>)}
        <tr><td>Place of supply</td><td className="n" data-fix-pos="">{(GST_STATES || {})[posNow] || (d.pos || "—")}</td></tr>
        <tr><td>GSTIN</td><td className="n" data-fix-gstin="">{gstNow || ledG || "—"}</td></tr>
      </tbody></table>}
      {!kind && tally && <p className="fx-tally" data-fix-tally="">{tally}</p>}
      {showSt && <p className={"fx-state" + (finished(st) ? " good" : "")} data-fix-state={st.state}>{st.words}
        {st.state === "unknown" && <>{" "}<button type="button" className="linkbtn" data-fix-again="" disabled={busy} onClick={again}>Ask Tally again</button></>}</p>}
      <div className="fx-pop-act">
        <button type="button" className="linkbtn" data-fix-lookup="" onClick={onLookup}>Open in Look up</button>
        <span className="fx-pop-btns">
          <button type="button" className="btn" data-fix-cancel="" onClick={onClose}>{finished(st) && step === "entry" ? "Close" : "Cancel"}</button>
          {canFix && <button type="button" className="btn primary" data-fix-save="" disabled={!ok || held || (step === "entry" && finished(st))} onClick={save}>Save in Tally</button>}
        </span>
      </div>
    </div>
  </PanelDialog>;
}

// Changes made here: the held ones and the history, with Undo where the earlier value can be given to Tally again
// (a place of supply goes back to Tally's own earlier value, the bridge's before; FinCom's may have been its own choice)
const undoTo = (x) => x.kind === "pos" ? String((x.before || {}).pos || "") : x.was;
const undoable = (x) => { const w = undoTo(x); return x.kind === "number" ? numberOk(w) : x.kind === "pos" ? !!w : x.kind === "gstin" ? gstOk(w) : false; };
export function FixHistory() {
  useEffect(() => { FixQ.pump(false); });
  const l = FixQ.list();
  if (!l.length) return null;
  const pending = (x) => FixQ.undoing.has(x.id) || l.some((y) => y.undoOf === x.id && toGo(y));
  const can = (x) => x.state === "done" && !x.undone && !x.undoOf && undoable(x);
  // one Undo for a double click; marked used only once Tally took it
  const undo = async (x) => {
    if (x.undone || pending(x) || !can(x)) return;
    FixQ.undoing.add(x.id); render();
    try {
      const ask = JSON.parse(JSON.stringify(x.ask));
      ask.alterId = String((x.after || {}).alterId || "");
      if (ask.target === "ledger") { ask.was = { gstin: x.to }; ask.fields = { gstin: x.was }; if (!ask.alterId) delete ask.alterId; }
      else ask.fields = { [x.kind]: undoTo(x) };
      const u = await FixQ.add(ask, "Undo: " + x.label, { was: x.to, to: undoTo(x), kind: x.kind, vid: x.vid, undoOf: x.id });
      if (u && u.state === "done") await FixQ.mark(x, { undone: true });
    } finally { FixQ.undoing.delete(x.id); render(); }
  };
  return <details className="fx-hist" data-fix-history={l.length}>
    <summary>Changes made here ({FixQ.taken(l)})</summary>
    <ul>{l.slice().reverse().slice(0, 50).map((x) => <li key={x.id} data-fix-rec={x.state}>
      <span>{x.label}</span> <span className="note">· {SAID[x.state] || x.words}{x.by ? " · saved by " + x.by : ""}{x.sentDev && x.sentDev !== x.dev ? " · sent from another computer" + (x.sentBy && x.sentBy !== x.by ? " by " + x.sentBy : "") : ""}</span>
      {x.state === "unknown" && <>{" · "}<button type="button" className="linkbtn" data-fix-again={x.id} disabled={FixQ.flying.has(x.id)} onClick={() => FixQ.send(x)}>Ask Tally again</button></>}
      {can(x) && <>{" · "}<button type="button" className="linkbtn" data-fix-undo={x.id} disabled={pending(x)} onClick={() => undo(x)}>Undo</button></>}
    </li>)}</ul>
  </details>;
}
