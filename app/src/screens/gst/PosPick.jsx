// GST: the place of supply FinCom keeps for a sale when it cannot be known from the books (next-gst-pos, the owner,
// 11-Nov-2026): IGST to a buyer with no GSTIN and no state in Tally. The chosen state is FinCom's own correction,
// S.books.gstPosFix = {voucher id: {pos: "27", by, at}}, one of BOOKS_KEYS (src/js/18), so it is saved with the client's
// books and synced to the other computers; nothing is written to Tally. GSTR.posOfSale (src/js/12) uses it after the
// entry's own place of supply from Tally (which wins when it arrives) and before what the tax or the GSTIN says.
import { useState } from "react";

const STATES = () => Object.keys(GST_STATES).filter((c) => /^\d{2}$/.test(c) && c !== "96" && c !== "99").sort().map((c) => [c, GST_STATES[c]]);
// the states that match what is typed: a 2-digit code, or the start of a word of the name ("Mah", "pradesh", "27")
export function posMatches(q) {
  const t = String(q || "").trim().toLowerCase();
  const all = STATES();
  if (!t) return all;
  const start = all.filter(([c, n]) => c === t || c.startsWith(t) || n.toLowerCase().startsWith(t));
  const word = all.filter(([c, n]) => !start.some((x) => x[0] === c) && n.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(t)));
  return start.concat(word);
}
export function posSave(ids, code) {
  const b = S.books; if (!b || !/^\d{2}$/.test(String(code || ""))) return;
  const fx = (b.gstPosFix = Object.assign({}, b.gstPosFix || {})), by = (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || "", at = new Date().toISOString();
  // an entry's B2C summary mark (b2cs, GSTR.b2cSumEntry) is kept with it
  ids.forEach((id) => { if (id) fx[id] = Object.assign(fx[id] && fx[id].b2cs ? { b2cs: fx[id].b2cs } : {}, { pos: String(code), by, at }); });
  saveBooks(); render();
}
export function posClear(ids) {
  const b = S.books; if (!b || !b.gstPosFix) return;
  const fx = (b.gstPosFix = Object.assign({}, b.gstPosFix));
  ids.forEach((id) => { if (fx[id] && fx[id].b2cs) fx[id] = { b2cs: fx[id].b2cs }; else delete fx[id]; });
  saveBooks(); render();
}
export const POS_FROM = { tally: "from Tally", fincom: "set in FinCom", tax: "from the CGST and SGST charged", gstin: "from the party's GSTIN" };

// a state picker that filters as you type; Enter (or Apply) takes the top match, or the one chosen with the arrows
export function PosSet({ ids, label, onDone }) {
  const [q, setQ] = useState(""), [i, setI] = useState(0), [pick, setPick] = useState("");
  const m = posMatches(q), cur = pick ? [pick, GST_STATES[pick]] : m[Math.min(i, m.length - 1)];
  const apply = () => { if (!cur || !ids.length) return; posSave(ids, cur[0]); setQ(""); setPick(""); if (onDone) onDone(); };
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setPick(""); setI(Math.min(i + 1, m.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPick(""); setI(Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape" && onDone) onDone();
  };
  return <div className="pos-set" data-pos-set="" role="group" aria-label={label || "Set place of supply"}>
    <label className="pos-l">{label || "Set place of supply"}{ids.length > 1 ? " for " + ids.length + " invoices" : ""}
      <input type="text" className="pos-q" data-pos-q="" value={q} placeholder="Type a state or its code, e.g. Mah or 27" autoComplete="off"
        role="combobox" aria-expanded="true" aria-controls="pos-opts" aria-autocomplete="list"
        onChange={(e) => { setQ(e.target.value); setI(0); setPick(""); }} onKeyDown={key} /></label>
    <ul className="pos-opts" id="pos-opts" role="listbox" data-pos-opts="">
      {m.slice(0, 8).map(([c, n], k) => <li key={c} role="option" aria-selected={cur && cur[0] === c}>
        <button type="button" className={"pos-o" + (cur && cur[0] === c ? " on" : "")} data-pos-opt={c} onClick={() => { setPick(c); setI(k); }}>{n} <small>{c}</small></button></li>)}
      {!m.length && <li className="note">No state matches “{q}”.</li>}
    </ul>
    <div className="pos-act">
      <button type="button" className="btn primary" data-pos-apply="" disabled={!cur || !ids.length} onClick={apply}>{cur ? "Apply: " + cur[1] : "Apply"}</button>
      {onDone && <button type="button" className="btn" data-pos-cancel="" onClick={onDone}>Cancel</button>}
    </div>
  </div>;
}

// one sale's place of supply in a list: the state and where it came from; a sale without one gets a picker of its own,
// one set in FinCom a Clear
export function PosCell({ r }) {
  const [open, setOpen] = useState(false);
  if (r.posFrom === "fincom") return <span data-pos-cell="fincom">{r.pos} <small className="nr">{POS_FROM.fincom}</small>{" "}
    <button type="button" className="linkbtn pos-btn" data-pos-clear={r.id} onClick={() => posClear([r.id])}>Clear</button></span>;
  if (r.posCode || r.posCode == null) return <span data-pos-cell={r.posFrom || ""}>{r.pos || ""}{r.posFrom && r.posFrom !== "tally" ? <small className="nr"> {POS_FROM[r.posFrom]}</small> : null}</span>;
  if (!r.id) return <span className="nr">missing</span>;
  return open ? <PosSet ids={[r.id]} label="Place of supply" onDone={() => setOpen(false)} />
    : <button type="button" className="linkbtn pos-btn" data-pos-one={r.id} onClick={() => setOpen(true)}>Set place of supply</button>;
}

// FinCom's corrections of a month: each with its Clear (the invoice goes back to "Place of supply missing")
export function PosFixed({ rows }) {
  if (!rows.length) return null;
  return <div className="pos-fixed" data-pos-fixed={rows.length}>
    <h4>Places of supply set in FinCom ({rows.length})</h4>
    <p className="note">Not in Tally: kept in FinCom with the client's books and used in the return. If the place of supply is later entered in Tally, Tally's is used.</p>
    <ul>{rows.map((r) => <li key={r.id} data-pos-fixed-row={r.id}>{r.no || "—"} · {r.party || "—"} · <b>{r.pos}</b>{" "}
      <button type="button" className="linkbtn pos-btn" data-pos-clear={r.id} onClick={() => posClear([r.id])}>Clear</button></li>)}</ul>
  </div>;
}
