// + New › Journal, Payment, Receipt or Contra (the new look; the owner: "+ New to make a normal journal entry like
// QuickBooks"). One form, the entry on the left and "As it goes to Tally" (Dr / Cr, totals, Balanced) beside it.
// Nothing new is sent to Tally: the voucher is the same {type, date, narration, lines} the Daily Check journals and Ask
// FinCom's entries are, built by the ONE voucher builder (lib/asstEntries.js draftVoucherXml), checked by the same checks
// (voucherProblems: a voucher type, a real date, two lines or more, each with a ledger of the client's Tally and one
// amount, Dr equal to Cr), and posted by the same route (postGate, then postDraft: Bridge.post, the bridge here or the
// cloud's queue, Tally checked for FinCom's id first). Tally not connected: "Download Tally file" (the same text, in
// Tally's import envelope). The draft is kept with the client's books, with its log, as those are.
//   Payment   Paid from (bank or cash) · Paid to · Amount        → Dr Paid to, Cr Paid from
//   Receipt   Received in (bank or cash) · Received from · Amount → Dr Received in, Cr Received from
//   Contra    From (bank or cash) · To (bank or cash) · Amount   → Dr To, Cr From
//   Journal   lines of ledger, Dr, Cr (Enter on the last line adds one)
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as A from "../lib/asstEntries.js";

const TYPES = [["Journal", "F7"], ["Payment", "F5"], ["Receipt", "F6"], ["Contra", "F4"]];
const SIMPLE = {
  Payment: { a: "Paid from", ah: "Bank or cash", b: "Paid to", bh: "Party or expense", dr: "b" },
  Receipt: { a: "Received in", ah: "Bank or cash", b: "Received from", bh: "Party or income", dr: "a" },
  Contra: { a: "From", ah: "Bank or cash", b: "To", bh: "Bank or cash", dr: "b" },
};
const BANKISH = /bank|cash/i;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const n2 = (v) => Math.round((Number(String(v == null ? "" : v).replace(/[₹,\s]/g, "")) || 0) * 100) / 100;
const fmt = (n) => (typeof INR === "object" ? INR.format(n) : n.toFixed(2));
const close = () => { S.nlEntry = null; render(); };

// the client's Tally ledgers: FinCom's cloud copy (as the drafts check them), else the list the client's pages hold
// (the bridge's, a file's, the masters on Books)
function useLedgers(co) {
  const [st, setSt] = useState({ cid: "", list: null, busy: false });
  useEffect(() => {
    if (!co) return;
    let gone = false;
    setSt({ cid: co.id, list: null, busy: true });
    A.clientLedgers(co).catch(() => null).then((l) => {
      if (gone) return;
      let list = l && l.length ? l : null;
      if (!list) { try { const x = typeof Ledgers === "object" ? Ledgers.list(co.id) : []; list = x && x.length ? x.map((y) => ({ name: String(y.name || ""), group: String(y.group || "") })).filter((y) => y.name) : null; } catch (e) { list = null; } }
      setSt({ cid: co.id, list, busy: false });
    });
    return () => { gone = true; };
  }, [co && co.id]);
  return st.cid === (co && co.id) ? st : { list: null, busy: !!co };
}

// the lines of the voucher, from what is typed
export function linesOf(type, f) {
  if (type === "Journal") return f.rows.filter((r) => String(r.ledger || "").trim() || n2(r.dr) || n2(r.cr)).map((r) => ({ ledger: String(r.ledger || "").trim(), dr: n2(r.dr) ? n2(r.dr).toFixed(2) : "", cr: n2(r.cr) ? n2(r.cr).toFixed(2) : "" }));
  const m = SIMPLE[type], amt = n2(f.amt), a = String(f.a || "").trim(), b = String(f.b || "").trim();
  if (!a && !b && !amt) return [];
  const dr = m.dr === "a" ? a : b, cr = m.dr === "a" ? b : a, x = amt ? amt.toFixed(2) : "";
  return [{ ledger: dr, dr: x, cr: "" }, { ledger: cr, dr: "", cr: x }];
}

function LedgerIn({ value, onChange, list, label, hint, bank, id }) {
  return <label className="nle-f"><span>{label}</span>
    <input type="text" list={bank ? "nle-bank" : "nle-all"} data-nle-in={id} value={value} placeholder={hint} autoComplete="off" aria-label={label}
      onChange={(e) => onChange(e.target.value)} />
    {value && list && !list.some((l) => A.ledKey(l.name) === A.ledKey(value)) && <small className="nle-warn" data-nle-unknown="">Not a ledger in this client’s Tally</small>}</label>;
}

export default function Entry() {
  const ne = S.nlEntry || {}, [type, setType] = useState(ne.type || "Journal"), [cid, setCid] = useState(ne.cid || S.coId || "");
  const co = cid ? S.companies[cid] : null, L = useLedgers(co);
  const [f, setF] = useState({ date: today(), narr: "", a: "", b: "", amt: "", rows: [{ ledger: "", dr: "", cr: "" }, { ledger: "", dr: "", cr: "" }] });
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(""), [, tick] = useState(0), box = useRef(null);
  const set = (p) => setF((x) => Object.assign({}, x, p));
  const typed = !!(f.narr || f.a || f.b || f.amt || f.rows.some((r) => r.ledger || r.dr || r.cr));
  const leave = () => { if (!typed || draft) return close(); (typeof askConfirm === "function" ? askConfirm({ title: "Discard this entry?", ok: "Discard", body: "<p class='note'>What you typed is not kept.</p>" }) : Promise.resolve(true)).then((y) => { if (y) close(); }); };
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape" && !document.querySelector(".confirm, [data-confirm]")) { e.preventDefault(); e.stopImmediatePropagation(); leave(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); const b = box.current && box.current.querySelector("[data-nle-post]"); if (b && !b.disabled) b.click(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });
  useEffect(() => { const first = box.current && box.current.querySelector("[data-nle-in]"); if (first) first.focus(); }, [type]);
  const lines = linesOf(type, f);
  const v = { id: (draft && draft.vouchers[0].id) || "", type, date: f.date, narration: f.narr.trim(), lines };
  const idx = useMemo(() => (L.list ? A.ledgerIndex(L.list) : null), [L.list]);
  const probs = co ? A.voucherProblems(v, idx, null) : ["Choose the client."];
  const t = A.totals(v), balanced = lines.length >= 2 && Math.abs(t.dr - t.cr) < 0.005 && t.dr > 0;
  const gate = co ? A.postGate(co) : { ok: false, why: "" };
  const res = draft && (draft.results || {})[draft.vouchers[0].id];
  const make = () => { const id = A.newVoucherId(), d = { id: A.newDraftId(), from: "manual", title: type + " made by hand", vouchers: [Object.assign({}, v, { id })], created: new Date().toISOString(), by: A.me() }; return d; };
  const post = async () => {
    if (probs.length || !gate.ok) return;
    const d = draft && !(res && res.ok) ? Object.assign(draft, { vouchers: [Object.assign({}, v, { id: draft.vouchers[0].id })] }) : make();
    setDraft(d); setBusy("post");
    try { await A.Drafts.save(co.id, d, "made by hand on + New: " + type + " of ₹" + fmt(t.dr)); await A.postDraft(co, d, L.list, () => tick((n) => n + 1)); }
    catch (e) { d.error = String((e && e.message) || e); }
    finally { setBusy(""); tick((n) => n + 1); }
  };
  const download = async () => {
    if (probs.length) return;
    const d = draft || make(); setDraft(d); setBusy("xml");
    try { await A.downloadXml(co, d, L.list); } finally { setBusy(""); }
  };
  const row = (i, p) => set({ rows: f.rows.map((r, j) => (j === i ? Object.assign({}, r, p) : r)) });
  const clients = Object.values(S.companies || {}).filter((c) => c && !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const m = SIMPLE[type];
  const done = res && res.ok, sent = res && !res.ok && res.state === "sent", failed = (res && res.state === "failed") || (draft && draft.error && !res);
  return createPortal(<div className="nl-veil nle-veil" data-nl-entry-veil="" onPointerDown={(e) => { if (e.target === e.currentTarget) leave(); }}>
    <section ref={box} className="nle" role="dialog" aria-modal="true" aria-label={"New " + type.toLowerCase()} data-nl-entry={type}>
      <header className="nle-head"><b>New entry</b>
        <div className="nle-types" role="tablist" aria-label="Voucher type">{TYPES.map(([x, k]) => <button key={x} type="button" role="tab" aria-selected={x === type} data-nle-type={x} disabled={!!draft} onClick={() => setType(x)}>{x} <kbd>{k}</kbd></button>)}</div>
        <button type="button" className="icon" aria-label="Close" onClick={leave}>✕</button></header>
      <div className="nle-body">
        <div className="nle-form">
          <div className="nle-row">
            <label className="nle-f nle-client"><span>Client</span>
              <select data-nle-client="" value={cid} disabled={!!draft} onChange={(e) => setCid(e.target.value)}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="nle-f nle-date"><span>Date</span><input type="date" data-nle-date="" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
          </div>
          {m ? <div className="nle-row nle-simple">
              <LedgerIn id="a" label={m.a} hint={m.ah} bank value={f.a} list={L.list} onChange={(x) => set({ a: x })} />
              <LedgerIn id="b" label={m.b} hint={m.bh} bank={type === "Contra"} value={f.b} list={L.list} onChange={(x) => set({ b: x })} />
              <label className="nle-f nle-amt"><span>Amount (₹)</span><input type="text" inputMode="decimal" data-nle-amt="" value={f.amt} placeholder="0.00" onChange={(e) => set({ amt: e.target.value })} /></label>
            </div>
            : <table className="nle-lines" data-nle-lines=""><thead><tr><th>Ledger</th><th className="n">Dr (₹)</th><th className="n">Cr (₹)</th><th aria-label="Remove" /></tr></thead><tbody>
              {f.rows.map((r, i) => <tr key={i} data-nle-line={i}>
                <td><input type="text" list="nle-all" data-nle-in={"l" + i} value={r.ledger} placeholder="Ledger" aria-label={"Ledger of line " + (i + 1)} autoComplete="off" onChange={(e) => row(i, { ledger: e.target.value })} />
                  {r.ledger && L.list && !L.list.some((l) => A.ledKey(l.name) === A.ledKey(r.ledger)) && <small className="nle-warn" data-nle-unknown="">Not in Tally</small>}</td>
                {["dr", "cr"].map((k) => <td key={k} className="n"><input type="text" inputMode="decimal" data-nle-amt={k + i} value={r[k]} aria-label={(k === "dr" ? "Dr" : "Cr") + " of line " + (i + 1)}
                  onChange={(e) => row(i, { [k]: e.target.value, [k === "dr" ? "cr" : "dr"]: e.target.value ? "" : r[k === "dr" ? "cr" : "dr"] })}
                  onKeyDown={(e) => { if (e.key === "Enter" && i === f.rows.length - 1) { e.preventDefault(); const left = r2x(t.dr - t.cr); set({ rows: f.rows.concat([{ ledger: "", dr: left < 0 ? String(-left) : "", cr: left > 0 ? String(left) : "" }]) }); } }} /></td>)}
                <td>{f.rows.length > 2 && <button type="button" className="icon" aria-label={"Remove line " + (i + 1)} onClick={() => set({ rows: f.rows.filter((_, j) => j !== i) })}>✕</button>}</td></tr>)}
              </tbody></table>}
          {!m && <button type="button" className="linkbtn" data-nle-addline="" onClick={() => { const left = r2x(t.dr - t.cr); set({ rows: f.rows.concat([{ ledger: "", dr: left < 0 ? String(-left) : "", cr: left > 0 ? String(left) : "" }]) }); }}>+ Add a line</button>}
          <label className="nle-f nle-narr"><span>Narration</span><input type="text" data-nle-narr="" value={f.narr} placeholder="What this entry is for" onChange={(e) => set({ narr: e.target.value })} /></label>
          {co && L.busy && <p className="nle-note" data-nle-ledgers="loading"><span className="skel skel-dot" aria-hidden="true" /> Reading {co.name}’s Tally ledgers…</p>}
          {co && !L.busy && !L.list && <p className="nle-note bad" data-nle-ledgers="none">FinCom has no Tally ledger list for {co.name} yet. Connect Tally (the Tally page) or bring in the ledger masters on Books › From Tally.</p>}
        </div>
        <aside className="nle-tally" aria-label="As it goes to Tally" data-nle-preview="">
          <div className="nle-tally-h"><b>As it goes to Tally</b><span className="note">{type}{co ? " · " + A.postCompany(co) : ""}</span></div>
          <table className="nle-dc"><thead><tr><th>Ledger</th><th className="n">Dr</th><th className="n">Cr</th></tr></thead><tbody>
            {lines.length ? lines.map((l, i) => <tr key={i}><td>{l.ledger || <span className="note">—</span>}</td><td className="n">{l.dr ? fmt(n2(l.dr)) : ""}</td><td className="n">{l.cr ? fmt(n2(l.cr)) : ""}</td></tr>)
              : <tr><td colSpan={3} className="note">The lines show here as you type.</td></tr>}</tbody>
            <tfoot><tr><td>Total</td><td className="n">{fmt(t.dr)}</td><td className="n">{fmt(t.cr)}</td></tr></tfoot></table>
          <p className={"nle-bal " + (balanced ? "ok" : "bad")} data-nle-balanced={balanced ? "yes" : "no"}>{balanced ? "✓ Balanced" : lines.length ? "Dr and Cr are not equal yet" : ""}</p>
          {typed && probs.length > 0 && <ul className="nle-probs" data-nle-problems="">{probs.slice(0, 4).map((p, i) => <li key={i}>{p}</li>)}</ul>}
          {co && !gate.ok && gate.why && <p className="nle-note" data-nle-gate="">{gate.why}</p>}
          {done && <p className="nle-res ok" data-nle-result="posted" role="status">{"Done · in Tally" + (res.tallyId ? " (voucher id " + res.tallyId + ")" : "")}</p>}
          {sent && <p className="nle-res" data-nle-result="sent" role="status">{"Ready · sent to Tally" + (res.msg ? ": " + res.msg : "") + ". It is in Tally’s posting record (Tally › Sent to Tally)."}</p>}
          {failed && <p className="nle-res bad" data-nle-result="failed" role="status">{"Problem · " + ((res && res.msg) || draft.error || "not posted")}</p>}
        </aside>
      </div>
      <footer className="nle-foot">
        {done ? <><button type="button" className="btn small primary" data-nle-another="" onClick={() => { setDraft(null); setF({ date: f.date, narr: "", a: "", b: "", amt: "", rows: [{ ledger: "", dr: "", cr: "" }, { ledger: "", dr: "", cr: "" }] }); }}>New entry</button>
            <button type="button" className="btn small" onClick={close}>Close</button></>
          : <><button type="button" className="btn small" data-nle-xml="" disabled={!co || probs.length > 0 || !!busy} onClick={download}>{busy === "xml" ? "Making the file…" : "Download Tally file"}</button>
            <button type="button" className="btn small primary" data-nle-post="" disabled={!co || probs.length > 0 || !gate.ok || !!busy || (draft && draft.state === "posting")} title={gate.ok ? "Ctrl+Enter" : gate.why}
              onClick={post}>{busy === "post" || (draft && draft.state === "posting") ? (draft && draft.progress) || "Posting…" : failed ? "Post again" : "Post to Tally"}</button></>}
      </footer>
      <datalist id="nle-all">{(L.list || []).slice(0, 3000).map((l) => <option key={l.name} value={l.name}>{l.group}</option>)}</datalist>
      <datalist id="nle-bank">{(L.list || []).filter((l) => BANKISH.test(l.group || "") || /^cash$/i.test(l.name)).map((l) => <option key={l.name} value={l.name}>{l.group}</option>)}</datalist>
    </section></div>, document.body);
}
const r2x = (n) => Math.round(n * 100) / 100;
