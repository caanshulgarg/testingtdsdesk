// Daily Check phase 2 (next-daily-p2; docs/DAILY-CHECK-PHASE2.md): how far FinCom may go by itself for this client, per
// kind of action, in Client setup › Company. Three levels: Ask me first (the default for everything), Do it, then tell me
// (undo within 24 hours), Do it quietly (logged). The owner only sets them (trust_set, migration 208, logged), and a limit
// above which FinCom always asks. In this phase every entry still waits for Approve whatever the level (decision D1):
// the levels, the limit and the promotion suggestions are built, posting by itself is not.
import { useEffect, useState } from "react";
import { cloudOn, isOwner, loadTrust, trustSet } from "./data.js";
import { TRUST_KINDS, TRUST_WORDS, LEVEL_WORDS, AUTO_POSTING } from "../../../../server/_shared/dailytrust.js";
import "./daily.css";
/* global toast */

const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const SHORT = ["Ask first", "Do, then tell", "Quietly"];

export default function TrustLevels({ co }) {
  const cid = co && co.id, [rows, setRows] = useState(null), [lim, setLim] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = () => loadTrust(cid).then((r) => { const m = {}; (r || []).forEach((x) => { m[x.kind] = x; }); setRows(m); setLim(m["*"] && Number(m["*"].limit_amt) ? String(Number(m["*"].limit_amt)) : ""); setErr(""); },
    (e) => setErr(String((e && e.message) || e)));
  useEffect(() => { if (cid && cloudOn()) load(); }, [cid]);
  if (!cloudOn()) return <p className="note" data-trust="">Kept in the firm account. Sign in to set it.</p>;
  if (err) return <p className="note" data-trust="">Could not load. <button type="button" className="linkbtn" onClick={load}>Try again</button></p>;
  if (rows === null) return <p className="note" data-trust="">Loading…</p>;
  const own = isOwner(), lv = (k) => Number((rows[k] || {}).level) || 0;
  const set = (k, level) => { if (level === lv(k)) return; setBusy(true); trustSet(cid, k, level, null).then(() => { setRows({ ...rows, [k]: { ...(rows[k] || {}), kind: k, level } }); say(TRUST_WORDS[k] + ": " + LEVEL_WORDS[level] + "."); }, (e) => say(String((e && e.message) || e))).finally(() => setBusy(false)); };
  const n = Number(String(lim).replace(/[,₹\s]/g, "")), limOk = lim === "" || (isFinite(n) && n >= 0);
  const was = rows["*"] && Number(rows["*"].limit_amt) ? Number(rows["*"].limit_amt) : 0;
  const saveLim = () => { setBusy(true); trustSet(cid, "*", 0, lim === "" ? 0 : n).then(() => { setRows({ ...rows, "*": { kind: "*", level: 0, limit_amt: lim === "" ? 0 : n } }); say("Saved."); }, (e) => say(String((e && e.message) || e))).finally(() => setBusy(false)); };
  return <div className="tl" data-trust="">
    {TRUST_KINDS.map((k) => <div className="tl-row" key={k} data-trust-kind={k}>
      <span className="tl-name">{TRUST_WORDS[k]}</span>
      <span className="tl-seg" role="group" aria-label={TRUST_WORDS[k]}>
        {SHORT.map((w, i) => <button key={i} type="button" aria-pressed={lv(k) === i} title={LEVEL_WORDS[i]} disabled={!own || busy} onClick={() => set(k, i)}>{w}</button>)}
      </span>
    </div>)}
    <label className="tl-lim" data-trust-limit="">Never above <span className="tl-rs">₹</span>
      <input type="text" inputMode="numeric" aria-label="Limit in rupees" placeholder="no limit" value={lim} disabled={!own} aria-invalid={limOk ? undefined : "true"} onChange={(e) => setLim(e.target.value)} /> alone
      {own && limOk && (lim === "" ? 0 : n) !== was && <button type="button" className="btn small" disabled={busy} onClick={saveLim}>Save</button>}
    </label>
    <p className="tl-note">{!AUTO_POSTING ? "For now every entry still waits for your Approve." : ""}{!own ? " Only the firm’s owner changes these." : ""}</p>
  </div>;
}
