// The preview of entries Ask FinCom drafted (the owner, 22-Oct-2026): the vouchers as a table the person corrects - the
// voucher type, the date, the narration, each line's ledger (picked from the client's Tally ledgers, the cloud copy) and
// its Dr or Cr - with the totals checked. A ledger the client's Tally does not have is red, with the closest names to
// pick, and stops Post and Download until it is put right; so does a voucher whose Dr is not its Cr, or a date outside
// the books. "Post to Tally" only when the client's posting company is confirmed and its Tally connected (else greyed
// out, with why); "Download XML" always offered. Both use the one builder (lib/asstEntries.js). Nothing is posted until
// the person presses Post here. Every change, download and post is written to the draft's log (who and when).
// Everything happens in this card, in the chat (the owner, 22-Oct-2026: "post to Tally should happen in the chatbot only"):
// the posting's progress and each voucher's result, live - Sent, then Posted with Tally's voucher id, or why not in plain
// words with Retry - and the person is never sent to the Post page (the postings are kept there as a record).
import { useEffect, useRef, useState } from "react";
import { Send, Download, Trash2, Plus, X, AlertTriangle, Check, RotateCw, Loader2 } from "lucide-react";
import Button from "./Button.jsx";
import "./asst-entries.css";
import { VTYPES, Drafts, clientLedgers, ledgersCached, ledgerIndex, ledKey, closest, voucherProblems, totals, postGate, postDraft, downloadXml, newDraftId, newVoucherId, me } from "../lib/asstEntries.js";
/* global S, INR, fmtDate, fmtDateTime, toast */

const money = (v) => (typeof INR === "object" ? INR.format(v) : Number(v).toFixed(2));
const dt = (s) => { try { return fmtDateTime(s); } catch (e) { return String(s || "").slice(0, 16).replace("T", " "); } };

// the draft for an answer's result (kept on the result: r.did), made once and saved with "drafted by Ask FinCom"
function draftFor(r, t) {
  const cid = r.client;
  if (r.did) return Drafts.get(cid, r.did) || r.draft || null;
  const d = { id: newDraftId(), cid, at: new Date().toISOString(), by: me(), q: String((t && t.q) || "").slice(0, 500), period: r.period || null, state: "draft", results: {}, log: [],
    vouchers: (r.vouchers || []).map((v) => ({ id: newVoucherId(), type: v.type, date: v.date, narration: v.narration || "", lines: (v.lines || []).map((l) => ({ ledger: l.ledger, dr: l.dr || "", cr: l.cr || "", choices: l.choices || [] })) })) };
  r.did = d.id; r.draft = d;
  (Drafts.by[cid] = Drafts.by[cid] || {})[d.id] = d;
  Drafts.save(cid, d, "drafted by Ask FinCom" + (d.q ? " from “" + d.q.slice(0, 200) + "”" : "") + ": " + d.vouchers.length + " voucher" + (d.vouchers.length === 1 ? "" : "s"));
  return d;
}

// in the Assistant panel, under the answer
export default function AnswerEntries({ r, t }) {
  const co = (S.companies || {})[r.client];
  const [d, setD] = useState(() => draftFor(r, t));
  useEffect(() => { if (!d && r.did) Drafts.load(r.client, true).then(() => setD(Drafts.get(r.client, r.did) || r.draft || null)); }, []);
  if (!co) return <p className="note">The client of these entries is not open on this computer.</p>;
  if (!d) return <p className="note">Loading the draft…</p>;
  return <EntriesCard co={co} d={d} />;
}

export function EntriesCard({ co, d, compact }) {
  const [, setN] = useState(0), draw = () => setN((x) => x + 1);
  const [list, setList] = useState(() => ledgersCached(co.id));
  const [msg, setMsg] = useState("");
  const pend = useRef([]), timer = useRef(null);
  useEffect(() => { let on = true; clientLedgers(co).then((l) => { if (on) setList(l); }); return () => { on = false; }; }, [co.id]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush(); } }, []);
  const idx = list ? ledgerIndex(list) : null;
  const done = (v) => !!((d.results || {})[v.id] || {}).ok;
  const busy = Drafts.inflight.has(d.id);
  const locked = busy || !!d.removed;
  // a change: kept at once, written to the log within a second (several edits in a row are one log line)
  const flush = () => { timer.current = null; const w = pend.current.splice(0); if (w.length) Drafts.save(co.id, d, "changed: " + w.join("; ")).then(draw); };
  const changed = (what) => { pend.current.push(what); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 900); draw(); };
  const now = () => { if (timer.current) { clearTimeout(timer.current); flush(); } };
  const set = (vi, f, val, li) => {
    const v = d.vouchers[vi];
    if (li == null) { const was = v[f]; v[f] = val; changed("voucher " + (vi + 1) + " " + f + " " + JSON.stringify(was) + " → " + JSON.stringify(val)); return; }
    const l = v.lines[li], was = l[f];
    l[f] = val;
    if (f === "ledger") { const hit = idx && idx.get(ledKey(val)); if (hit) l.ledger = hit.name; }
    if (f === "dr" && String(val).trim()) l.cr = ""; if (f === "cr" && String(val).trim()) l.dr = "";
    changed("voucher " + (vi + 1) + " line " + (li + 1) + " " + f + " " + JSON.stringify(was) + " → " + JSON.stringify(l[f]));
  };
  const probs = d.vouchers.map((v) => (done(v) ? [] : voucherProblems(v, idx, d.period)));
  const blocked = probs.some((p) => p.length) || !d.vouchers.length;
  const left = d.vouchers.filter((v) => !done(v));
  const gate = postGate(co);
  const postWhy = d.removed ? "This draft was removed." : !left.length ? "Every voucher is in Tally." : blocked ? "Correct what is marked in red first." : !gate.ok ? gate.why : "";
  const post = async () => {
    if (postWhy || locked) return;
    now(); setMsg("");
    const res = await postDraft(co, d, list, draw);
    setMsg(res.ok ? "" : res.error || ""); draw();
  };
  // not in Tally after a press: refused, or sent from a page closed before Tally answered (Retry is safe: FinCom's id
  // stops a second copy)
  const failed = d.vouchers.filter((v) => { const s = ((d.results || {})[v.id] || {}).state; return s === "failed" || (s === "sent" && !busy); });
  const xml = async () => { if (blocked) return; now(); await downloadXml(co, d, list); draw(); };
  const remove = async (back) => { now(); d.removed = back ? null : { by: me(), at: new Date().toISOString() }; await Drafts.save(co.id, d, back ? "restored the draft" : "removed the draft (kept; it can be restored)"); draw(); };
  const dl = "asst-led-" + d.id;
  return <section className={"asst-card asst-ent" + (compact ? " compact" : "")} data-asst-entries={d.id} data-ready={blocked ? "no" : "yes"} data-state={d.state} aria-label={"Entries drafted for " + co.name}>
    <header>
      <span className={"asst-src " + (d.state === "posted" ? "ok" : "warn")}>{d.state === "posted" ? "In Tally" : d.state === "partly" ? "Partly in Tally" : "DRAFT – not posted"}</span>
      <b>Entries for {co.name}</b>
      {d.removed && <span className="note" data-ent-removed="">Removed by {d.removed.by || "a member"} {dt(d.removed.at)}</span>}
    </header>
    {list === null && <p className="note bad" data-ent-noledgers="">FinCom has no Tally ledger list for {co.name} in the cloud, so the ledgers cannot be checked. Link its Tally company on the Tally page.</p>}
    {d.vouchers.map((v, vi) => {
      const tt = totals(v), even = Math.abs(tt.dr - tt.cr) < 0.005, ro = locked || done(v);
      return <div key={v.id} className="asst-ent-v" data-ent-v={vi} data-ent-id={v.id}>
        <div className="asst-ent-head">
          <label><span>Type</span><select data-ent-type="" value={v.type} disabled={ro} onChange={(e) => set(vi, "type", e.target.value)}>
            {!VTYPES.includes(v.type) && <option value={v.type}>{v.type || "Choose"}</option>}{VTYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label><span>Date</span><input type="date" data-ent-date="" value={v.date || ""} disabled={ro} onChange={(e) => set(vi, "date", e.target.value)} /></label>
          <label className="wide"><span>Narration</span><input data-ent-narr="" value={v.narration || ""} maxLength={500} disabled={ro} placeholder="Narration" onChange={(e) => set(vi, "narration", e.target.value)} /></label>
        </div>
        <div className="asst-ent-wrap"><table className="asst-ent-table">
          <thead><tr><th>Ledger</th><th className="n">Dr (₹)</th><th className="n">Cr (₹)</th><th aria-label="Remove" /></tr></thead>
          <tbody>{v.lines.map((l, li) => {
            const bad = !!String(l.ledger || "").trim() && !!idx && !idx.has(ledKey(l.ledger));
            const near = bad ? (l.choices && l.choices.length ? l.choices.filter((c) => idx.has(ledKey(c))) : []).concat(closest(list, l.ledger)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 5) : [];
            return <tr key={li} data-ent-line={li} className={bad ? "bad" : ""}>
              <td><input list={dl} data-ent-ledger="" value={l.ledger || ""} title={l.ledger || ""} disabled={ro} aria-invalid={bad || !idx} aria-label={"Ledger of line " + (li + 1)} onChange={(e) => set(vi, "ledger", e.target.value, li)} />
                {bad && <div className="asst-ent-pick" data-ent-unknown="">Not in {co.name}'s Tally.{near.length ? " Pick:" : " Pick one from the list."}
                  {near.map((c) => <button key={c} type="button" className="chip" data-ent-choice={c} disabled={ro} onClick={() => set(vi, "ledger", c, li)}>{c}</button>)}</div>}</td>
              <td className="n"><input inputMode="decimal" data-ent-dr="" value={l.dr === 0 ? "" : l.dr} disabled={ro} aria-label={"Debit of line " + (li + 1)} onChange={(e) => set(vi, "dr", e.target.value, li)} /></td>
              <td className="n"><input inputMode="decimal" data-ent-cr="" value={l.cr === 0 ? "" : l.cr} disabled={ro} aria-label={"Credit of line " + (li + 1)} onChange={(e) => set(vi, "cr", e.target.value, li)} /></td>
              <td>{!ro && v.lines.length > 2 && <button type="button" className="asst-ent-x" aria-label={"Remove line " + (li + 1)} onClick={() => { v.lines.splice(li, 1); changed("voucher " + (vi + 1) + " line " + (li + 1) + " removed"); }}><X size={13} /></button>}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr data-ent-totals={even ? "even" : "uneven"}>
            <td>{even ? <span className="ok"><Check size={13} aria-hidden="true" /> Dr = Cr</span> : <span className="bad"><AlertTriangle size={13} aria-hidden="true" /> Dr ≠ Cr by ₹{money(Math.abs(tt.dr - tt.cr))}</span>}</td>
            <td className="n">{money(tt.dr)}</td><td className="n">{money(tt.cr)}</td><td /></tr></tfoot>
        </table></div>
        {!ro && <button type="button" className="linkbtn asst-ent-add" data-ent-addline="" onClick={() => { v.lines.push({ ledger: "", dr: "", cr: "" }); changed("voucher " + (vi + 1) + " line " + v.lines.length + " added"); }}><Plus size={12} aria-hidden="true" /> Line</button>}
        {probs[vi].length > 0 && <ul className="asst-ent-probs" data-ent-problems="">{probs[vi].map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <Status r={(d.results || {})[v.id]} live={busy} />
      </div>;
    })}
    <datalist id={dl}>{(list || []).map((l) => <option key={l.name} value={l.name} />)}</datalist>
    <div className="asst-ent-acts">
      {failed.length > 0 && !busy ? <Button className="btn small primary" data-ent-retry="" disabled={!!postWhy || locked} aria-disabled={!!postWhy || locked} title={postWhy || "Post the vouchers not in Tally again (the ones in Tally are never sent twice)"} onClick={post}><RotateCw size={13} aria-hidden="true" /> Retry</Button>
        : <Button className="btn small primary" data-ent-post="" disabled={!!postWhy || locked} aria-disabled={!!postWhy || locked} title={postWhy || "Post these vouchers to " + (gate.company || "Tally")} onClick={post}><Send size={13} aria-hidden="true" /> {busy ? "Posting\u2026" : "Post to Tally"}</Button>}
      <Button className="btn small" data-ent-xml="" disabled={blocked || !!d.removed} title={blocked ? "Correct what is marked in red first." : "Download the Tally import file (the same XML as Post sends)"} onClick={xml}><Download size={13} aria-hidden="true" /> Download XML</Button>
      {d.state !== "posted" && <button type="button" className="linkbtn" data-ent-remove={d.removed ? "restore" : "remove"} onClick={() => remove(!!d.removed)}>{d.removed ? "Restore" : <><Trash2 size={12} aria-hidden="true" /> Remove draft</>}</button>}
    </div>
    {postWhy && left.length > 0 && !d.removed && <p className="note" data-ent-why-post="">{postWhy}</p>}
    {busy && <p className="note" data-ent-busy="" role="status" aria-live="polite">{d.progress || "Sending to Tally\u2026"}</p>}
    {(msg || d.error) && <p className="note bad" data-ent-error="">{msg || d.error}</p>}
    {d.unsaved && <p className="note" data-ent-unsaved="">{d.unsaved}</p>}
    <p className="note">Nothing goes to Tally until you press Post to Tally. Each entry carries FinCom's id (TDSDesk:…) in its narration, so it is never posted twice.</p>
    {(d.log || []).length > 0 && <details className="asst-ent-log" data-ent-log=""><summary>History ({d.log.length})</summary>
      <ul>{d.log.slice().reverse().map((x, i) => <li key={i}><time>{dt(x.at)}</time> {x.by ? <b>{x.by}</b> : null} {x.what}</li>)}</ul></details>}
  </section>;
}

// one voucher's posting, live: Sent, then Posted with Tally's voucher id, or why not in plain words
function Status({ r, live }) {
  if (!r || !r.state) return null;
  if (r.state === "sent" && !live) return <p className="note asst-ent-st" data-ent-status="unknown">Sent to Tally earlier; its answer was not seen here. Retry: an entry already in Tally is never posted twice.</p>;
  if (r.state === "sent") return <p className="note asst-ent-st" data-ent-status="sent" role="status"><Loader2 size={13} className="asst-ent-spin" aria-hidden="true" /><span>Sent to Tally, waiting for its answer…</span></p>;
  if (r.state === "posted") return <p className="note ok asst-ent-st" data-ent-status="posted"><Check size={13} aria-hidden="true" /><span>Posted{r.tallyId ? <> · Tally voucher id <b data-ent-tally-id="">{r.tallyId}</b></> : " in Tally"}{r.checking ? " (Tally is checking it)" : ""}</span></p>;
  return <p className="note bad asst-ent-st" data-ent-status="failed"><AlertTriangle size={13} aria-hidden="true" /><span>Not posted: {r.msg}</span></p>;
}
