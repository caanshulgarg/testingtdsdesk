// Stock on the Trial balance & mapping tab (owner, 29-Oct-2026: "what about opening stock"): the opening stock at the start
// of the year, at the start of the period (a part of the year), and the closing stock at its end, each with where it comes
// from (FinSt's d.stock): Tally's Stock-in-hand ledgers when the copy keeps them, else the stock brought from Tally on a click
// (below), else last year's balance sheet as uploaded (its Inventories: this year's opening stock), else typed here
// (FinSt.stockSet: b.fs.stockAt, per client per date, with who typed it and when). A figure not known stays not known: the
// Checks tab asks for it. The P&L's changes in inventories are the opening stock at the start of the period less the closing
// stock; the balance sheet shows the closing.
//
// FinCom Bridge 2.5.1 (the owner's decision of 30-Oct-2026, "1"): "Bring stock from Tally" asks the client's Tally computer,
// through FinCom's cloud (tally-ingest {kind:"wake", what:"stock"}, migration 134), for Tally's own Stock-in-Hand figure for
// the period on the page, ONCE: the answer is kept per book and period (tally_stock_reads, and here in b.fs.stockTally) and
// shown "Opening stock ₹X · Closing stock ₹Y · from Tally at 15:42 IST"; a click for a period with an answer kept brings that
// answer back without asking Tally; "Ask Tally again" asks once more. Nothing asks Tally by itself. Tally over 2 s: "Tally
// took too long; type the stock or try again later" (the typed figure, or last year's balance sheet, is used meanwhile). A
// figure typed after Tally's answer is used over it (FinSt's stockOn: the later of the two).
import { useState } from "react";
import CommitBox from "../../../parts/CommitBox.jsx";
import Button from "../../../parts/Button.jsx";
import { rs, dmy, inr } from "./util.js";

const cloudOn = () => typeof TCloud === "object" && TCloud.on && TCloud.on() && typeof TCloudUp === "object";
const WAIT_MS = 2000, TRIES = 20;   // the answer looked for in FinCom's cloud every 2 s, 40 s at most (Tally itself is asked once)

// the answer as the cloud keeps it -> b.fs.stockTally[from-to] of the client clicked for (only an answer with Tally's figures
// replaces the figures). Another client open by then: not kept here (FinCom's cloud keeps it; the next click gives it back)
function keep(cid, from, to, read) {
  if (!read || !S.books || S.books.cid !== cid) return;
  const f = S.books.fs = S.books.fs || {}, k = from + "-" + to, was = (f.stockTally || {})[k] || {};
  const figs = read.opening != null && read.closing != null && read.readAt ? { opening: +read.opening, closing: +read.closing, readAt: read.readAt } : { opening: was.opening, closing: was.closing, readAt: was.readAt };
  // gotAt: when this page took Tally's figures (this computer's clock, as a typed figure's): the later of the two is used
  // (the same answer given back again keeps its first time: a figure typed after it still wins)
  const gotAt = read.status === "ok" && read.opening != null && read.closing != null && read.readAt && read.readAt !== was.readAt ? new Date().toISOString() : was.gotAt;
  f.stockTally = Object.assign({}, f.stockTally, { [k]: Object.assign({}, figs, { gotAt, status: read.status || "", words: read.words || "" }) });
  if (typeof saveBooks === "function") saveBooks();
}
const readOf = (r) => r && { status: String(r.status || ""), words: String(r.words || ""), opening: r.opening == null ? null : +r.opening, closing: r.closing == null ? null : +r.closing, readAt: r.read_at || null };

export async function bringStock(cid, from, to, again, say) {
  const r = await TCloudUp.post({ kind: "wake", what: "stock", from, to, again: !!again }, { client: cid });   // (it throws on ok: false)
  if (!r.asked && !r.pending) { if (r.read) keep(cid, from, to, r.read); say(r.read ? "" : r.error || "FinCom could not ask Tally just now."); return; }
  // asked now, or by an earlier click still on its way (pending): the answer looked for in the cloud (Tally is not asked here)
  say(r.pending ? "Tally is being asked already; its answer comes here." : "Asking Tally…");
  let notYet = 0;
  for (let i = 0; i < TRIES; i++) {
    await new Promise((ok) => setTimeout(ok, WAIT_MS));
    let rows = [];
    try { rows = await Cloud.api("tally_stock_reads?select=status,words,opening,closing,read_at&book_id=eq." + encodeURIComponent(r.book) + "&period_from=eq." + Audit.iso(from) + "&period_to=eq." + Audit.iso(to)) || []; } catch (e) { continue; }
    const row = rows[0];
    // "not asked" from one bridge of a shared computer may be followed by Tally's figures from another: 6 s more
    if (row && row.status !== "asked" && (row.status === "ok" || !["notopen", "busy"].includes(row.status) || ++notYet >= 3 || i === TRIES - 1)) { keep(cid, from, to, readOf(row)); say(""); return; }
  }
  say("The Tally computer did not answer. Is FinCom Bridge running there, with Tally open? Type the stock or try again later.");
}

function TallyBar({ s }) {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const t = s.tally, cid = S.coId, has = !!(t && t.readAt && t.opening != null);
  const click = async (again) => {
    if (busy) return;
    setBusy(true); setMsg("");
    try { await bringStock(cid, s.from, s.to, again, setMsg); }
    catch (e) { setMsg((e && e.message) || String(e)); }
    finally { setBusy(false); if (typeof render === "function") render(); }
  };
  const when = has ? (typeof fmtTime === "function" && typeof fmtDate === "function" && fmtDate(new Date()) === fmtDate(new Date(t.readAt)) ? "at " + fmtTime(t.readAt) : "on " + fmtDateTime(t.readAt)) : "";
  const failed = t && t.status && t.status !== "ok" && t.status !== "asked" ? t.words : "";
  return <div className="fin-stock-tally" data-fin-stocktally="">
    {has ? <span data-fin-stockread="">Opening stock {inr(t.opening)} · Closing stock {inr(t.closing)} · from Tally {when}</span>
      : <span className="note">Tally works the stock out itself (its stock summary): FinCom asks it once for {dmy(s.from)} to {dmy(s.to)} when you click.</span>}
    {cloudOn() ? <Button className="btn small" disabled={busy} onClick={() => click(has)} data-fin-stockask={has ? "again" : "bring"}>{busy ? "Asking Tally…" : has ? "Ask Tally again" : "Bring stock from Tally"}</Button>
      : <span className="note">Sign in to the firm account to bring the stock from Tally.</span>}
    {(msg || failed) ? <p className="fin-bad" data-fin-stockmsg="">{msg || failed}</p> : null}
  </div>;
}

export default function Stock({ d }) {
  const s = d.stock; if (!s) return null;
  const rows = [["A", "Opening stock at the start of the year"]].concat(s.dates.B !== s.dates.A ? [["B", "Opening stock at the start of the period"]] : [], [["C", "Closing stock"]]);
  const any = rows.some(([k]) => s[k].v != null);
  return <div className="fin-pybs fin-stock" data-fin-stockpanel="">
    <div className="fin-pybs-head"><div><b>Stock</b>
      <p className="note">{s.integrated ? "Tally keeps the stock in its Stock-in-hand ledgers: their balances are used. (The stock items’ own values are not read into FinCom’s copy.)"
        : any ? "Changes in inventories = opening stock at the start of the period less the closing stock; the balance sheet shows the closing stock."
          : "No stock is known for this client. If it holds stock, bring it from Tally, type it here or upload last year’s balance sheet; nothing is assumed."}</p></div></div>
    {!s.integrated && s.from && s.to ? <TallyBar s={s} /> : null}
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="stock"><colgroup><col /><col style={{ width: 170 }} /><col /></colgroup>
      <thead><tr><th>Stock</th><th className="n">Amount (₹)</th><th>Where it comes from</th></tr></thead>
      <tbody>{rows.map(([k, label]) => { const z = s[k], dt = s.dates[k], typeable = !s.integrated && z.src !== "upload";
        return <tr key={k} data-fin-stock={dt} data-src={z.src}><td>{label + " (as on " + dmy(dt) + ")"}</td>
          <td className="n">{typeable ? <CommitBox type="number" step="0.01" aria-label={"Stock as on " + dmy(dt)} value={z.v == null ? "" : z.v} placeholder="not known"
            onCommit={(v) => { FinSt.stockSet(dt, v === "" ? null : +v); toast(v === "" ? "Stock as on " + dmy(dt) + " forgotten." : "Stock as on " + dmy(dt) + ": " + rs(+v) + ", kept."); render(); }} />
            : z.v == null ? "not known" : rs(z.v)}</td>
          <td className={z.v == null && any ? "fin-bad" : "note"} data-fin-stocksrc="">{z.label}</td></tr>; })}</tbody></table></div>
  </div>;
}
