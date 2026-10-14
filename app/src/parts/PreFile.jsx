// "Check before filing" (src/js/76-prefiling.js): the button on a TDS return (26Q, 27Q, 24Q) and on a GST month, and the
// checklist it opens: each check ok or "fix this", its entries (a date opens the entry), and an Excel export. FinCom's own
// checks only: no AI; on whatever the Assistant switch says.
import { useState } from "react";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import { ListChecks, FileSpreadsheet } from "lucide-react";
import Button from "./Button.jsx";
import "./assistant.css";
import { useDismiss } from "./dismiss.js";

export function PreFileButton({ kind, form, fy, q, reg, ym }) {
  return <Button className="btn small" data-prefile-btn={kind} title="Every check that applies before this return is filed"
    onClick={() => (kind === "tds" ? PreFile.open("tds", form, fy, q) : PreFile.open("gst", reg, ym))}><ListChecks size={14} /> Check before filing</Button>;
}

const STATUS = { ok: ["ok", "ok"], fix: ["warn", "fix this"], na: ["neutral", "does not apply"], error: ["bad", "could not check"] };

function Line({ l }) {
  const [open, setOpen] = useState(l.status === "fix" && l.count <= 12);
  const rows = (l.findings || []).flatMap((f) => f.rows || []);
  const [tone, word] = STATUS[l.status] || STATUS.error;
  return <li className={"pf-line " + l.status} data-prefile-line={l.id} data-status={l.status}>
    <div className="pf-head" onClick={() => rows.length && setOpen(!open)}>
      <span className={"asst-src " + (tone === "warn" ? "warn" : tone === "ok" ? "ok" : tone === "bad" ? "warn" : "neutral")}>{word}</span>
      <b>{l.title}</b>
      {l.count ? <span className="note">{l.count} item{l.count === 1 ? "" : "s"}{l.amount ? " · ₹" + INR.format(r2(l.amount)) : ""}</span> : null}
    </div>
    <p className="note">{l.status === "na" || l.status === "error" ? l.note : l.what}</p>
    {l.status === "fix" && (l.findings || []).map((f, i) => f.suggestion ? <p key={i} className="pf-fix">{f.suggestion}</p> : null)}
    {open && rows.length > 0 && <table className="asst-table"><thead><tr><th>Date</th><th>Voucher</th><th>Party or ledger</th><th>Section</th><th className="n">Amount</th><th>Note</th></tr></thead>
      <tbody>{rows.slice(0, 200).map((x, i) => <tr key={i}>
        <td>{x.date ? <button className="linkbtn" title="Open the entry" onClick={() => PreFile.openEntry(x)}>{fmtDate(tallyDate(x.date))}</button> : ""}</td>
        <td>{x.no || ""}</td><td>{x.party || ""}</td><td>{x.type || ""}</td><td className="n">{x.amount == null ? "" : INR.format(r2(num(x.amount)))}</td><td>{x.note || ""}</td></tr>)}</tbody></table>}
  </li>;
}

export function PreFileList({ res, compact }) {
  const fix = res.lines.filter((l) => l.status === "fix").length, ok = res.lines.filter((l) => l.status === "ok").length;
  return <div className="pf" data-prefile={res.kind}>
    <p className="pf-sum"><b>{fix ? fix + " to fix" : "Nothing to fix"}</b><span className="note"> · {ok} ok · {res.lines.length - fix - ok} not applicable · FinCom's own checks, no AI</span>
      <button className="iconbtn" onClick={() => PreFile.excel(res)} title="The checklist and its entries in Excel"><FileSpreadsheet size={14} /> Excel</button></p>
    <ul className="pf-lines">{res.lines.filter((l) => !compact || l.status !== "na").map((l) => <Line key={l.id} l={l} />)}</ul>
  </div>;
}

const PF_REF = { get current() { return document.querySelector('[data-overlay="prefile"]'); } };
export default function PreFilePanel() {
  const p = S.prefile;
  // a click outside or Esc closes it (app/src/parts/dismiss.js); the button that opens it counts as inside
  useDismiss(!!(p && p.open), PF_REF, () => PreFile.close(), { also: () => Array.from(document.querySelectorAll("[data-prefile-btn]")) });
  return <Drawer open={!!(p && p.open)} onOpenChange={(o) => { if (!o) PreFile.close(); }} modal={false}>
    <DrawerContent className="asst-panel" data-overlay="prefile" title={p && p.res ? "Check before filing: " + PreFile.title(p.res) : "Check before filing"} closeLabel="Close" aria-describedby={undefined} onInteractOutside={(ev) => ev.preventDefault()} onEscapeKeyDown={(ev) => ev.preventDefault()}>
      {p && <div className="asst-body" data-prefile-panel="">
        {p.busy ? <p className="note">Running the checks…</p> : p.err ? <p className="asst-error">{p.err}</p> : p.res ? <PreFileList res={p.res} /> : null}
      </div>}
    </DrawerContent>
  </Drawer>;
}
