// "Map ledgers with AI (one time)" and its review (the owner, 29-Oct-2026: "run one time ai here to match uploaded balance
// sheet and fincom generated balance sheet.. so that you will map the ledger heads accordingly.. and for next year it would
// be 1 click job for anyone"). A lazy chunk (fin/aimapSlot.jsx) with its model (fin/aimap.js). Shown:
//   mode "close"  on the matching screen (Checks), when the audited balance sheet as at the year's end is uploaded;
//   mode "open"   on the Trial balance & mapping tab, when last year's balance sheet is uploaded;
//   mode "new"    next year, on the Trial balance & mapping tab: "Use last year's mapping" (N ledgers mapped as last year;
//                 M new ledgers to map), the new ones only through AI.
// The review: per ledger the code now, the AI's code, its reason and whether its head ties (FinCom's check, never the
// model's); the heads, audited against FinCom with these codes; Accept all, Accept tied heads only, or row by row (a hand
// choice the AI would change is marked and left out of Accept all unless ticked); the run's cost. AI off: the button says
// how to switch it on; the rules' and last year's balance sheet's codes stand as they are.
import { useState } from "react";
import Button from "../../../parts/Button.jsx";
import { rs } from "./util.js";
import FinAiMap from "./aimap.js";
import "./aimap.css";

const D2 = (iso) => { try { return fmtDate(String(iso).slice(0, 10)); } catch (e) { return String(iso).slice(0, 10); } };
const lab = (c) => (c && FinSt.CODES[c] ? c + " " + FinSt.CODES[c].label : c ? c : "No code");
const cost = (c) => (c && c.inr ? "₹" + (+c.inr).toFixed(2) : c && c.usd ? "US$" + (+c.usd).toFixed(4) : "₹0.00");
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const labelsOf = (d) => { const o = {}; if (d && d.bs) Object.values(d.bs.sections).forEach((s) => s.lines.forEach((l) => { o[l.id] = l.label; })); return o; };

function useRun() {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const go = (fy, mode, only) => {
    setBusy(true); setErr("");
    FinAiMap.run(fy, mode, only).then((r) => { toast("AI proposed codes for " + plural(r.props.length, "ledger", "ledgers") + ". Nothing is changed until you accept."); })
      .catch((e) => setErr((e && e.message) || String(e))).finally(() => { setBusy(false); render(); });
  };
  return { busy, err, go };
}

function Off() { return FinAiMap.aiOn() ? null : <p className="note fin-aioff" data-fin-aioff="">{FinAiMap.offWhy() + " The rules and last year’s balance sheet still suggest every code."}</p>; }

export function Review({ run, labels }) {
  const [hand, setHand] = useState(false), [only, setOnly] = useState(false);
  const rv = FinAiMap.review(run, labels), act = (f, msg) => { const n = f(); if (msg) toast(typeof msg === "function" ? msg(n) : msg); render(); };
  const open = rv.rows.filter((r) => r.state === "open"), handN = open.filter((r) => r.handChange).length;
  const allN = open.filter((r) => hand || !r.handChange).length, tiedN = open.filter((r) => (hand || !r.handChange) && r.tied === true).length;
  const order = (r) => (r.state === "open" && r.ai !== r.cur ? 0 : r.tied === false ? 1 : r.state === "open" ? 2 : 3);
  const rows = rv.rows.filter((r) => !only || r.ai !== r.cur || r.tied === false).slice().sort((a, z) => order(a) - order(z));
  const tie = (r) => (r.tied === true ? <span className="fin-ok">Ties</span> : r.tied === false ? <span className="fin-bad">{"Gap " + rs(r.gap)}</span> : <span className="note">No audited figure</span>);
  return <div className="fin-aireview" data-fin-aireview="" data-run={run.id}>
    <p className="note" data-fin-aisum="">{"AI proposed a code for " + run.props.length + " of " + run.asked + " ledgers" + (run.mode === "open" ? " (balances as at " + rv.asAt + ")" : "") + " · "
      + (rv.check ? (rv.heads.length - rv.gaps) + " of " + plural(rv.heads.length, "head ties", "heads tie") + (rv.gaps ? ", " + plural(rv.gaps, "head shows a gap", "heads show a gap") : "") : "no audited balance sheet as at " + rv.asAt + " yet to check the heads against")
      + " · Cost of this run: " + cost(run.cost) + " · " + run.by + ", " + D2(run.at)}</p>
    <p className="note">AI chose codes only and set no figure: every amount here is FinCom’s own, from the books. Accepted codes become hand choices (“AI-assisted”) and are used next year too.</p>
    {run.missing && run.missing.length > 0 && <p className="note" data-fin-aimissing="">{"No code from AI for " + run.missing.length + ": " + run.missing.slice(0, 8).join(", ") + (run.missing.length > 8 ? " …" : "") + " (they keep the rules’ codes)."}</p>}
    {rv.check && <div className="fin-box"><table className="fin-t fin-aiheads" data-statement="" data-fin-table="aiheads"><colgroup><col /><col className="fig" /><col className="fig" /><col className="fig" /></colgroup>
      <thead><tr><th>Head</th><th className="n">Audited</th><th className="n">FinCom with these codes</th><th className="n">Gap</th></tr></thead>
      <tbody>{rv.heads.map((h) => <tr key={h.head} data-fin-aihead={h.head} data-v={h.diff}><td>{h.label}</td><td className="n">{rs(h.aud)}</td><td className="n">{rs(h.fin)}</td>
        <td className={"n " + (h.diff ? "fin-bad" : "fin-ok")}>{h.diff ? rs(h.diff) : "Ties"}</td></tr>)}</tbody></table></div>}
    {open.length > 0 && <div className="fin-aibulk">
      <Button className="btn small primary" data-fin-aiaccept-all="" disabled={!allN} onClick={() => act(() => FinAiMap.acceptMany(run, { hand }), (n) => plural(n, "code", "codes") + " accepted, as hand choices (AI-assisted).")}>{"Accept all (" + allN + ")"}</Button>
      {rv.check && <Button className="btn small" data-fin-aiaccept-tied="" disabled={!tiedN} onClick={() => act(() => FinAiMap.acceptMany(run, { hand, tiedOnly: true }), (n) => plural(n, "code", "codes") + " of tied heads accepted.")}>{"Accept tied heads only (" + tiedN + ")"}</Button>}
      {handN > 0 && <label className="note"><input type="checkbox" data-fin-aihand="" checked={hand} onChange={(ev) => setHand(ev.target.checked)} />{" Also change the " + plural(handN, "code", "codes") + " chosen by hand"}</label>}
      <label className="note"><input type="checkbox" data-fin-aionly="" checked={only} onChange={(ev) => setOnly(ev.target.checked)} /> Only changes and gaps</label>
    </div>}
    <div className="fin-box"><table className="fin-t fin-airows" data-statement="" data-fin-table="airows">
      <thead><tr><th>Ledger</th><th>Code now</th><th>AI’s code</th><th>Reason</th><th>Its head</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.l} data-fin-airow={r.l} data-state={r.state} data-hand={r.handChange ? 1 : 0} className={r.ai !== r.cur && r.state === "open" ? "fin-aichg" : ""}>
        <td className="led">{r.l}</td>
        <td data-c="now">{lab(r.cur)}<span className="fin-why">{r.src === "hand" ? "by hand" : r.src === "suggested" ? "suggested" : "no code"}{r.handChange ? " · AI would change this hand choice" : ""}</span></td>
        <td data-c="ai">{r.ai === r.cur ? <span className="note">{lab(r.ai) + " (same)"}</span> : <b>{lab(r.ai)}</b>}</td>
        <td data-c="why" className="fin-aiwhy">{r.why}</td>
        <td data-c="tie">{tie(r)}{r.headLabel && <span className="fin-why">{r.headLabel}</span>}</td>
        <td className="fin-aiact">{r.state === "open" ? <span className="fin-ract">
          <Button className="btn small" data-fin-aiaccept="" onClick={() => act(() => FinAiMap.accept(run, [r.l]), r.l + ": " + r.ai + ", accepted (AI-assisted).")}>Accept</Button>
          <Button className="btn small" data-fin-aireject="" onClick={() => act(() => FinAiMap.reject(run, r.l), r.l + ": rejected; its code stays " + (r.cur || "none") + ".")}>Reject</Button></span>
          : r.state === "same" ? <span className="note">Already so</span>
          : <span className="note">{(r.state === "accepted" ? "Accepted" : "Rejected") + " · " + D2(r.dec.at) + " "}
            <button type="button" className="linkbtn" data-fin-aiundo="" onClick={() => act(() => FinAiMap.undo(run, r.l), r.state === "accepted" ? r.l + ": put back as it was." : r.l + ": taken back.")}>{r.state === "accepted" ? "Undo" : "Take back"}</button></span>}</td>
      </tr>)}</tbody></table></div>
  </div>;
}

export default function AiMap({ d, fy, mode }) {
  const { busy, err, go } = useRun(), on = FinAiMap.aiOn(), labels = labelsOf(d);
  if (mode === "new") {
    const x = FinAiMap.nextYear(fy); if (!x) return null;
    const run = FinAiMap.last(fy, "new"), m = x.fresh.length;
    return <div className="fin-ainext" data-fin-ainext="" data-fin-aimap="">
      <div className="fin-aihead"><div><b>Use last year’s mapping</b>
        <p className="note" data-fin-ainext-say="">{plural(x.n, "ledger", "ledgers") + " mapped as last year; " + (m ? plural(m, "new ledger", "new ledgers") + " to map" : "no new ledger to map") + (x.kept.length ? "; " + x.kept.length + " kept on the rules’ codes" : "") + "."}</p></div>
        {m > 0 && <Button className="btn small primary" data-fin-ainew="" disabled={!on || busy} onClick={() => go(fy, "new", x.fresh)}>{busy ? "Asking AI…" : "Map the " + plural(m, "new ledger", "new ledgers") + " with AI"}</Button>}</div>
      {m > 0 && <><p className="note">{"New: " + x.fresh.slice(0, 10).join(", ") + (m > 10 ? " …" : "") + ". Only these go to AI (name, Tally group, balance), with last year’s balance sheet’s lines and the code list."}</p><Off /></>}
      {err && <p className="bk-alert" data-fin-aierr="">{err}</p>}
      {run && <Review run={run} labels={labels} />}
    </div>;
  }
  const run = FinAiMap.last(fy, mode), at = FinSt.DMY(FinAiMap.asAtOf(fy, mode));
  return <div className="fin-aimap" data-fin-aimap="" data-mode={mode}>
    <div className="fin-aihead"><div><b>{run ? "AI mapping" : "Map the ledgers from the audited balance sheet"}</b>
      <p className="note">{"AI reads each ledger’s name, Tally group and balance as at " + at + ", the audited balance sheet’s lines and FinCom’s code list (nothing else about the client) and proposes a code for every ledger. FinCom then checks each head against the audited figure; you accept what you want."}</p></div>
      {!run ? <Button className="btn small primary" data-fin-airun="" disabled={!on || busy} onClick={() => go(fy, mode)}>{busy ? "Asking AI…" : "Map ledgers with AI (one time)"}</Button>
        : <button type="button" className="linkbtn" data-fin-airerun="" disabled={!on || busy} onClick={() => go(fy, mode)}>{busy ? "Asking AI…" : "Run AI again (costs again)"}</button>}</div>
    <Off />
    {err && <p className="bk-alert" data-fin-aierr="">{err}</p>}
    {run && <Review run={run} labels={labels} />}
  </div>;
}
