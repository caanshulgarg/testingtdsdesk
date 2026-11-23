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
/* global S, CO, render, saveBooks, Books, Bridge, bridgeLive, linkGuid, ensureTallyCompany, GST_STATES, gstinValid, INR, r2, num, fmtDate, tallyDate, FC, LK, auditEvent */
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

// the changes kept with the client's books: held ones, and the history (b.fixq, one of BOOKS_KEYS)
export const FixQ = {
  list() { const b = S.books || {}; return (b.fixq = Array.isArray(b.fixq) ? b.fixq : []); },
  async save() { if (typeof saveBooks === "function") await saveBooks({}); },
  busy: false, last: 0,
  // the change as the bridge takes it
  ask(rec, tname, cguid) { return Object.assign({ company: tname, companyGuid: cguid }, rec.ask); },
  // send one change; its record says how it went
  async send(rec) {
    const co = CO();
    if (!co || typeof bridgeLive !== "function" || !bridgeLive(co)) { rec.state = "waiting"; rec.words = "Waiting for Tally."; return rec; }
    try {
      const tname = await ensureTallyCompany(co);
      const lg = tname ? await linkGuid(co, tname) : {};
      if (!lg || !lg.guid) { rec.state = "waiting"; rec.words = "Waiting for Tally."; return rec; }
      if (typeof auditEvent === "function") auditEvent("tally.fix", tname + " · " + rec.label, S.coId || "");
      const r = (await Bridge.call("/fix", FixQ.ask(rec, tname, lg.guid), 30000)) || {};
      rec.tried = new Date().toISOString();
      if (r.ok) {
        Object.assign(rec, { state: "done", words: "Saved in Tally and FinCom Books.", before: r.before, after: r.after, doneAt: rec.tried });
        await FixQ.back(rec, r);
      } else if (r.held) {
        Object.assign(rec, { state: "waiting", words: "Waiting for Tally." });
      } else if (r.changed) {
        Object.assign(rec, { state: "changed", words: "Changed in Tally since it was opened here. This is how it is now.", now: r.now });
        await FixQ.back(rec, r);
      } else {
        Object.assign(rec, { state: r.kept ? "kept" : "refused", words: r.message || "Tally did not change it." });
        if (r.kept) await FixQ.back(rec, r);
      }
    } catch (e) {
      // an older FinCom Bridge, or none answering now: kept, and sent when it can be
      Object.assign(rec, { state: "waiting", words: "Waiting for Tally." });
    }
    await FixQ.save();
    return rec;
  },
  // what Tally holds now goes into FinCom Books: the entry read back (one voucher), or the ledger's GSTIN or PAN
  async back(rec, r) {
    const b = S.books;
    if (!b) return;
    if (rec.ask.target === "ledger") {
      const a = r.after || r.now || {}, led = rec.ask.ledger;
      if (a.gstin != null) { b.gstins = b.gstins || {}; if (a.gstin) b.gstins[led] = a.gstin; else delete b.gstins[led]; }
      if (a.pan != null && a.pan) { b.pans = b.pans || {}; b.pans[led] = a.pan; }
      return;
    }
    if (!r.xml) return;
    try {
      const env = "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>" + r.xml + "</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
      const got = await Books.importDayBook(new File([env], "entry.xml", { type: "text/xml" }));
      const nv = ((got && got.vouchers) || [])[0];
      if (!nv || !nv.id) return;
      const vs = b.vouchers || (b.vouchers = []), i = vs.findIndex((v) => v.id === nv.id);
      if (i >= 0) vs[i] = nv; else vs.push(nv);
    } catch (e) { /* the cloud copy brings it in its turn */ }
  },
  // the held changes, sent one after another when Tally is open (at most once a minute from a page drawing)
  async pump(force) {
    if (FixQ.busy || (!force && Date.now() - FixQ.last < 60000)) return;
    const co = CO();
    if (!co || typeof bridgeLive !== "function" || !bridgeLive(co)) return;
    const w = FixQ.list().filter((x) => x.state === "waiting");
    if (!w.length) return;
    FixQ.busy = true; FixQ.last = Date.now();
    try { for (const rec of w) { await FixQ.send(rec); if (rec.state === "waiting") break; } } finally { FixQ.busy = false; render(); }
  },
  // a new change: kept first (so a closed page or Tally loses nothing), then sent
  async add(ask, label, extra) {
    const rec = Object.assign({ id: "fx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
      by: (window.Cloud && Cloud.st && Cloud.st.email) || "", ask, label, state: "waiting", words: "Saving in Tally…" }, extra || {});
    FixQ.list().push(rec);
    await FixQ.save();
    return FixQ.send(rec);
  },
};

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
  const save = async () => {
    setBusy(true); setSt({ state: "waiting", words: "Saving in Tally…" });
    const ask = kind === "gstin"
      ? { target: "ledger", ledger: led, was: { gstin: ledG }, fields: { gstin: clean } }
      : { target: "voucher", guid: v.id, alterId: String(v.alt), vchType: v.type, vchDate: v.date, fields: { [kind]: clean } };
    const label = kind === "gstin" ? "GSTIN of " + led + ": " + (ledG || "none") + " → " + clean
      : kind === "number" ? "Number of the " + (v.type || "entry") + " of " + day(v.date) + ": " + (d.no || "none") + " → " + clean
      : "Place of supply of " + (d.no || "the entry") + ": " + ((GST_STATES || {})[posNow] || "none") + " → " + ((GST_STATES || {})[clean] || clean);
    const rec = await FixQ.add(ask, label, { was: kind === "gstin" ? ledG : kind === "number" ? String(d.no || "") : posNow, to: clean, kind, vid: d.id || "" });
    setSt(rec); setBusy(false); render();
    if (rec.state === "done") setTimeout(onClose, 1200);
  };
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
      {st && <p className={"fx-state" + (st.state === "done" ? " good" : "")} data-fix-state={st.state}>{st.words}</p>}
      <div className="fx-pop-act">
        <button type="button" className="linkbtn" data-fix-lookup="" onClick={onLookup}>Open in Look up</button>
        <span className="fx-pop-btns">
          <button type="button" className="btn" data-fix-cancel="" onClick={onClose}>{st && st.state === "done" ? "Close" : "Cancel"}</button>
          {canFix && <button type="button" className="btn primary" data-fix-save="" disabled={!ok || busy || (st && st.state === "done")} onClick={save}>Save in Tally</button>}
        </span>
      </div>
    </div>
  </PanelDialog>;
}

// Changes made here: the held ones and the history, with Undo where the earlier value can be given to Tally again
export function FixHistory() {
  useEffect(() => { FixQ.pump(false); });
  const l = FixQ.list();
  if (!l.length) return null;
  const undo = (x) => {
    const back = x.kind === "number" ? numberOk(x.was) : x.kind === "pos" ? /^\d{2}$/.test(x.was) : x.kind === "gstin" ? gstOk(x.was) : false;
    if (!back) return;
    const ask = JSON.parse(JSON.stringify(x.ask));
    if (ask.target === "ledger") { ask.was = { gstin: x.to }; ask.fields = { gstin: x.was }; }
    else { ask.fields = { [x.kind]: x.was }; ask.alterId = String((x.after || {}).alterId || ""); }
    x.undone = true;
    FixQ.add(ask, "Undo: " + x.label, { was: x.to, to: x.was, kind: x.kind, vid: x.vid, undoOf: x.id }).then(() => render());
  };
  const can = (x) => x.state === "done" && !x.undone && !x.undoOf && (x.kind === "number" ? numberOk(x.was) : x.kind === "pos" ? /^\d{2}$/.test(x.was) : gstOk(x.was));
  return <details className="fx-hist" data-fix-history={l.length}>
    <summary>Changes made here ({l.length})</summary>
    <ul>{l.slice().reverse().slice(0, 50).map((x) => <li key={x.id} data-fix-rec={x.state}>
      <span>{x.label}</span> <span className="note">· {x.state === "done" ? "Saved in Tally" : x.state === "waiting" ? "Waiting for Tally" : x.words}{x.by ? " · " + x.by : ""}</span>
      {can(x) && <>{" · "}<button type="button" className="linkbtn" data-fix-undo={x.id} onClick={() => undo(x)}>Undo</button></>}
    </li>)}</ul>
  </details>;
}
