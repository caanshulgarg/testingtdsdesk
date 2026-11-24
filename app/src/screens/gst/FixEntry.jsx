// GST › What to fix: an entry corrected where it is shown (the owner, 23-Nov-2026: "any error should be rectified there
// only.. option of open in entry should pop up a new window there only.. and that change should be made to tally and fincom
// books also"; the forms approved the same day, findings/fix-in-place-plan.md section 2.3, decisions 1, 2, 4-7).
//   - "Open the entry" opens this window on the same page: the entry as FinCom Books hold it, and only the box this kind
//     of error needs: the invoice number (too long, characters, used twice), the place of supply (none, or the tax type not
//     matching it), the party's GSTIN (none, or not valid: changed on the party ledger only, decision 5). Every other kind
//     shows the entry and Open in Look up.
//   - Save in Tally sends the one change to FinCom Bridge (POST /fix, bridge-go/fixalter.go), which checks Tally's change
//     number (AlterID) first and never overwrites a later change, makes the change, reads the entry back and gives it to
//     FinCom's cloud. The entry read back replaces FinCom's (Books.importDayBook of that one voucher), so the list is worked
//     out again and the row leaves it.
//   - Tally closed, or no FinCom Bridge on this computer: the change is kept with the client's books (b.fixq) and sent when
//     Tally is open (decision 4), checked against Tally's change number then.
//   - Every change is kept in Changes made here, with Undo where the earlier value is one Tally can be given again.
// Anyone who can post to Tally may fix (decision 6). Plain words only, no warnings.
/* global S, CO, render, saveBooks, Books, Bridge, bridgeLive, linkGuid, ensureTallyCompany, LinkRec, tallyCoName, GST_STATES, gstinValid, INR, r2, num, fmtDate, tallyDate, FC, LK, auditEvent */
import { useState, useEffect } from "react";
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
const amountOf = (d) => (d.total != null ? d.total : num(d.taxable) + num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess));

// what the window and Changes made here say
const WAIT = "Waiting for Tally. It is saved there when Tally is open.";
const CHANGED = "Changed in Tally since you opened it. This is how it is now.";
const OLD = "This needs FinCom Bridge 2.5.21 or later on the Tally computer. Update it there, then press Save again.";
const SAID = { done: "Saved in Tally", waiting: "Waiting for Tally" };

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
  waitingFor(key) { return !!key && FixQ.list().some((x) => x.state === "waiting" && (x.vid === key || (x.ask && x.ask.target === "ledger" && x.ask.ledger === key))); },
  // Tally holds what was asked (a change whose answer was lost, sent again: the change number has moved, to this value)
  mine(rec, now) {
    if (!now) return false;
    const f = rec.ask.fields || {}, k = Object.keys(f)[0], want = String(f[k] || "").toLowerCase();
    const got = String(k === "gstin" ? now.gstin || "" : k === "number" ? now.number || "" : now.pos || "").toLowerCase();
    return !!want && (got === want || (k === "pos" && got === String((GST_STATES || {})[f[k]] || "").toLowerCase()));
  },
  // the bridge asked once: what the answer means. Bridge.call throws on any answer that says no; its body comes with it
  // (src/js/24). Only an answer held by the bridge (Tally closed or in use) and no answer at all wait to be sent again.
  async ask(rec, co) {
    let tname = "", lg = null;
    try { tname = await ensureTallyCompany(co); lg = tname ? await linkGuid(co, tname) : null; } catch (e) { lg = null; }
    if (!tname) return { state: "waiting", words: WAIT };
    if (!lg || !lg.guid) return { state: "refused", words: (lg && lg.why) || "Not sent: this client's Tally company is not linked." };
    if (rec.coGuid && lg.guid !== rec.coGuid) return { state: "refused", words: "Not sent: this client's Tally company is not the one this change was made for." };
    if (typeof auditEvent === "function") auditEvent("tally.fix", tname + " · " + rec.label, rec.cid || "");
    let r;
    try { r = await Bridge.call("/fix", Object.assign({ company: tname, companyGuid: lg.guid }, rec.ask), 30000); }
    catch (e) {
      if (e && e.status === 404) return { state: "old", words: OLD };
      if (e && e.status === 200 && e.body && typeof e.body === "object") r = e.body;
      else if (!e || e.code === "bridge_down") return { state: "waiting", words: WAIT };
      else return { state: "refused", words: (e && e.message) || "FinCom Bridge did not take it." };
    }
    r = r || {};
    const at = new Date().toISOString(), p = { coGuid: lg.guid, tried: at };
    if (r.ok) return Object.assign(p, { state: "done", before: r.before, after: r.after, doneAt: at, r });
    if (r.held) return Object.assign(p, { state: "waiting", words: WAIT });
    if (r.changed) return Object.assign(p, FixQ.mine(rec, r.now) ? { state: "done", after: r.now, doneAt: at } : { state: "changed", words: CHANGED, now: r.now }, { r });
    if (r.kept) return Object.assign(p, { state: "kept", words: r.message || "Tally kept its own value.", after: r.after, r });
    if (r.unknown) return Object.assign(p, { state: "unknown", words: r.message || "Tally did not answer. Ask Tally again to see whether it changed." });
    if (r.gone) return Object.assign(p, { state: "gone", words: r.message || "Tally no longer has this entry." });
    return Object.assign(p, { state: "refused", words: r.message || r.error || "Tally did not change it." });
  },
  // send one change (never two at once); its record says how it went
  async send(rec) {
    if (FixQ.flying.has(rec.id)) return rec;
    FixQ.flying.add(rec.id);
    try {
      const co = CO(rec.cid);
      const p = !co || typeof bridgeLive !== "function" || !bridgeLive(co) ? { state: "waiting", words: WAIT } : await FixQ.ask(rec, co);
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
    if (p.state === "done") p.words = got ? "Saved in Tally and FinCom Books." : "Saved in Tally. FinCom Books take it at the next read from Tally.";
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
      if (a.gstin == null && a.pan == null) return false;
      if (a.gstin != null) { b.gstins = b.gstins || {}; if (a.gstin) b.gstins[led] = a.gstin; else delete b.gstins[led]; }
      if (a.pan) { b.pans = b.pans || {}; b.pans[led] = a.pan; }
      const li = (b.ledInfo || {})[led];
      if (li && /^\d+$/.test(String(a.alterId || ""))) li.alt = +a.alterId;
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
  // the held changes of the client open, sent one after another when Tally is open (at most once a minute from a page
  // drawing); another client opened meanwhile: the one with Tally finishes for its own client, the rest wait
  async pump(force) {
    const b = S.books, cid = b && b.cid;
    if (!cid || b.loading || FixQ.busy || (!force && Date.now() - FixQ.last < 60000)) return;
    const co = CO(cid);
    if (!co || typeof bridgeLive !== "function" || !bridgeLive(co)) return;
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
  // a new change for the client open: kept first (so a closed page or Tally loses nothing), then sent
  async add(ask, label, extra) {
    const b = S.books, cid = b && b.cid;
    if (!cid) return null;
    const co = CO(cid), coGuid = co ? await FixQ.coGuid(co) : "";
    const rec = Object.assign({ id: "fx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
      by: (window.Cloud && Cloud.st && Cloud.st.email) || "", cid, coGuid, ask, label, state: "waiting", words: "Saving in Tally…" }, extra || {});
    FixQ.list(b).push(rec);
    if (typeof saveBooks === "function") await saveBooks({}, b);
    return FixQ.send(rec);
  },
};
if (typeof window === "object") window.FixQ = FixQ;

// the voucher of a row in FinCom Books
const voucherOf = (id) => ((S.books || {}).vouchers || []).find((v) => v.id === id) || null;

// the window
export function FixEntry({ d, c, why, tally, onClose, onLookup }) {
  const kind = fixKind(c.what), v = d && d.id ? voucherOf(d.id) : null;
  const led = String(d.party || ""), ledG = String(((S.books || {}).gstins || {})[led] || "").toUpperCase();
  const posNow = d.posCode || String(d.pos || "").slice(0, 2);
  const startVal = kind === "number" ? String(d.no || "") : kind === "pos" ? (/^\d{2}$/.test(posNow) ? posNow : (d.gstin ? String(d.gstin).slice(0, 2) : "")) : kind === "gstin" ? ledG : "";
  const [val, setVal] = useState(startVal), [st, setSt] = useState(null), [busy, setBusy] = useState(false);
  const clean = kind === "gstin" ? val.trim().toUpperCase() : val.trim();
  const ok = kind === "number" ? numberOk(clean) && clean !== String(d.no || "") : kind === "pos" ? /^\d{2}$/.test(clean) && clean !== posNow : kind === "gstin" ? gstOk(clean) && clean !== ledG : false;
  const canFix = kind && (kind === "gstin" ? !!led : !!(v && v.id && v.alt != null));
  // a change of this entry (or ledger) waiting for Tally, or with Tally now: not asked twice
  const held = busy || (st && st.state === "waiting") || FixQ.waitingFor(kind === "gstin" ? led : d.id);
  const ledAlt = (((S.books || {}).ledInfo || {})[led] || {}).alt;
  const save = async () => {
    setBusy(true); setSt({ state: "waiting", words: "Saving in Tally…" });
    const ask = kind === "gstin"
      ? Object.assign({ target: "ledger", ledger: led, was: { gstin: ledG }, fields: { gstin: clean } }, ledAlt != null && ledAlt !== "" ? { alterId: String(ledAlt) } : {})
      : { target: "voucher", guid: v.id, alterId: String(v.alt), vchType: v.type, vchDate: v.date, fields: { [kind]: clean } };
    const label = kind === "gstin" ? "GSTIN of " + led + ": " + (ledG || "none") + " → " + clean
      : kind === "number" ? "Number of the " + (v.type || "entry") + " of " + day(v.date) + ": " + (d.no || "none") + " → " + clean
      : "Place of supply of " + (d.no || "the entry") + ": " + ((GST_STATES || {})[posNow] || "none") + " → " + ((GST_STATES || {})[clean] || clean);
    const p = FixQ.add(ask, label, { was: kind === "gstin" ? ledG : kind === "number" ? String(d.no || "") : posNow, to: clean, kind, vid: d.id || "" });
    const rec = await p;
    setBusy(false);
    if (!rec) return;
    setSt(rec); render();
    if (rec.state === "done") setTimeout(onClose, 1200);
  };
  // Tally did not say whether it changed: asked again only when the person presses it (the change number decides)
  const again = async () => { if (!st) return; setBusy(true); await FixQ.send(st); setBusy(false); if (st.state === "done") setTimeout(onClose, 1200); };
  const lines = v ? (v.ent || []).filter((e) => e && e.l) : [];
  return <PanelDialog open={true} onClose={onClose} title={(d.no || "Entry") + (d.date ? " · " + day(d.date) : "")} description={undefined} attrs={{ "data-fix-entry": d.id || "", "data-fix-kind": kind || "none" }}>
    <div className="fx-pop">
      <p className="fx-pop-head" data-fix-head="">{[v && v.type, d.party, d.id ? money(amountOf(d)) : ""].filter(Boolean).join(" · ")}</p>
      {why && <p className="note" data-fix-why="">{why}</p>}
      {canFix && <div className="fx-field">
        {kind === "number" && <label>Invoice number <input type="text" data-fix-input="number" value={val} maxLength={40} onChange={(e) => setVal(e.target.value)} autoFocus />
          <span className="note" data-fix-count="">{clean.length} of 16{numberOk(clean) ? " ✓" : ""}</span></label>}
        {kind === "pos" && <label>Place of supply <select data-fix-input="pos" value={val} onChange={(e) => setVal(e.target.value)} autoFocus>
          <option value="">Choose the state</option>{STATES().map(([cd, n]) => <option key={cd} value={cd}>{cd} {n}</option>)}</select></label>}
        {kind === "gstin" && <label>GSTIN of {led} <input type="text" data-fix-input="gstin" value={val} maxLength={15} onChange={(e) => setVal(e.target.value.toUpperCase())} autoFocus />
          <span className="note" data-fix-count="">{gstOk(clean) ? "✓ " + ((GST_STATES || {})[clean.slice(0, 2)] || "") : clean.length + " of 15"}</span>
          <span className="note fx-sub">Changed on the party ledger in Tally.</span></label>}
        {kind === "number" && <p className="note fx-sub">Up to 16 letters, digits, / and -.</p>}
      </div>}
      <table className="bk-table fx-lines" data-fix-lines=""><tbody>
        {lines.map((e, i) => <tr key={i}><td>{e.l}</td><td className="n">{e.a < 0 ? "Dr" : "Cr"} {INR.format(r2(Math.abs(num(e.a))))}</td></tr>)}
        <tr><td>Place of supply</td><td className="n">{(GST_STATES || {})[posNow] || (d.pos || "—")}</td></tr>
        <tr><td>GSTIN</td><td className="n">{d.gstin || ledG || "—"}</td></tr>
      </tbody></table>
      {!kind && tally && <p className="fx-tally" data-fix-tally="">{tally}</p>}
      {st && <p className={"fx-state" + (st.state === "done" ? " good" : "")} data-fix-state={st.state}>{st.words}
        {st.state === "unknown" && <>{" "}<button type="button" className="linkbtn" data-fix-again="" disabled={busy} onClick={again}>Ask Tally again</button></>}</p>}
      <div className="fx-pop-act">
        <button type="button" className="linkbtn" data-fix-lookup="" onClick={onLookup}>Open in Look up</button>
        <span className="fx-pop-btns">
          <button type="button" className="btn" data-fix-cancel="" onClick={onClose}>{st && st.state === "done" ? "Close" : "Cancel"}</button>
          {canFix && <button type="button" className="btn primary" data-fix-save="" disabled={!ok || held || (st && st.state === "done")} onClick={save}>Save in Tally</button>}
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
  const pending = (x) => FixQ.undoing.has(x.id) || l.some((y) => y.undoOf === x.id && y.state === "waiting");
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
    <summary>Changes made here ({l.length})</summary>
    <ul>{l.slice().reverse().slice(0, 50).map((x) => <li key={x.id} data-fix-rec={x.state}>
      <span>{x.label}</span> <span className="note">· {SAID[x.state] || x.words}{x.by ? " · " + x.by : ""}</span>
      {x.state === "unknown" && <>{" · "}<button type="button" className="linkbtn" data-fix-again={x.id} disabled={FixQ.flying.has(x.id)} onClick={() => FixQ.send(x)}>Ask Tally again</button></>}
      {can(x) && <>{" · "}<button type="button" className="linkbtn" data-fix-undo={x.id} disabled={pending(x)} onClick={() => undo(x)}>Undo</button></>}
    </li>)}</ul>
  </details>;
}
