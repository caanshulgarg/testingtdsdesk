// A client's sales invoices: uploaded (read from PDFs or photos), from a marketplace report, or created here; each
// gets a customer ledger and becomes a Sales voucher in Tally. Was viewSales, salesRowHtml, salesDetailHtml,
// salesSettingsHtml, viewSalesCreate and salesBar (src/js/26). The printed invoice (invoiceHtml) stays a page of
// its own.
//
// State: SL() is the open client's sales (S.sales): list (the invoices, each with x = what the invoice says and a
// status review → ready → posted, or intally / ignored), filter (the tab), q (search), sel (ticked), openId (the one
// open in the panel), draft (an invoice being created), cfg (numbering, the firm's details, ledgers), undo.
// The actions are in src/js/26: salesAct("salesPost"), salesRowAct("confirm", id), salesSetCust(id, name), …
import "../../../src/js/99-screen-parts.js";
import { useRef, useState } from "react";
import { useDismiss } from "../parts/dismiss.js";
import { ColFunnel } from "../parts/ColHead.jsx";
import ListTable from "../parts/ListTable.jsx";
import Loading from "../parts/Loading.jsx";
import CommitBox from "../parts/CommitBox.jsx";
import LedgerBox from "../parts/LedgerBox.jsx";
import LedgerSelect from "../parts/LedgerSelect.jsx";
import Confirm, { KeptLine } from "../parts/Confirm.jsx";
import { BusyCard } from "../parts/Reading.jsx";
import { ChipBar, NoMatch } from "../parts/ChipBar.jsx";
import NoticeLine from "../parts/NoticeLine.jsx";
import DateBox from "../parts/DateBox.jsx";
// EINV (src/js/55-einvoice.js) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../src/js/55-einvoice.js";
// the printed invoice (invoiceHtml: src/js/26-sales-invoice.js) too
import "../../../src/js/26-sales-invoice.js";
import "../../../src/js/96-bank-sent-heal.js";
import "../../../src/js/98-link-record.js";
import "../../../src/js/97-postto-link.js";

const live = () => Bridge.on() && Bridge.up();
const STATUS = { ready: ["ok", "Post to Tally"], review: ["warn", "To review"], posted: ["ok", "Posted"], intally: ["no", "In Tally"], ignored: ["no", "Ignored"] };
// next-fix-sales-readback: an invoice in Tally as an Optional voucher (sent so, or found so), said on its row and panel
// (next-sales-followups) the panel's "untick ... in Client setup" advice: only on one FinCom posted with the client's Optional
// tick on, never on one found in Tally (entered there by hand as Optional)
const salesOptShown = (v) => !!v.postedOptional && ["posted", "intally"].includes(v.status);
// an empty tab says what to do next (spec K6, round 2)
const EMPTY = { review: "Nothing to review: every invoice has its customer ledger, and waits under Ready to post.",
  ready: "Nothing ready to post. Confirm each invoice's customer ledger under To review; it then waits here.",
  done: "Nothing in Tally yet. Post the invoices under Ready to post.", ignored: "No invoice ignored." };
const States = () => <><option value="">— Choose —</option>{gstStateList().map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</>;
const gstOf = (x) => r2(num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess));

// next-fix-igst-pick: the output GST ledger a person chooses, one click (several fit, none by its state); every
// waiting invoice of the client takes it (salesPickTax, src/js/25-sales.js)
const taxWord = (a) => "Output " + String(a.kind || "").toUpperCase() + (a.reg ? " for " + a.reg + " " + (GST_STATES[a.reg] || "") : "");
function TaxChoice({ a, n, id }) {
  return <span className="row" data-tax-choice={a.ck} style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
    <span className="note">{taxWord(a)}{n ? " (" + n + " invoice" + (n === 1 ? "" : "s") + ")" : ""}:</span>
    {a.cands.map((c) => <button key={c} className="btn small" data-tax-pick={c} title={a.ck ? "Use " + c + " on every waiting invoice of this client" + (a.reg ? " issued from " + a.reg : "") : "Use " + c + " on this invoice (which registration it is from is not known)"} onClick={() => salesPickTax(a.ck, c, id, a.ik)}>{c}</button>)}
  </span>;
}
// the sales list's columns (spec K6: date, number, party, amount, status, then the rest, in ListTable.jsx's order)
const ST_WORDS = { ready: ["ok", "Ready to post"], review: ["warn", "To review"], refused: ["bad", "Refused by Tally"], posted: ["ok", "Posted"], intally: ["no", "In Tally"], ignored: ["no", "Ignored"] };
const salesPrep = (v) => ({ editable: ["review", "ready"].includes(v.status), issue: (v.problems || [])[0] || (v.ledgerIssues || []).find((p) => !/customer ledger/.test(p)) || "" });
function salesCols(s, list, nSel) {
  const act = (a, v) => () => salesRowAct(a, v.id);
  return [
    { k: "pick", role: "pick", cls: "ck", head: <input type="checkbox" aria-label="Select all" disabled={!list.length} title={list.length ? "Select all" : "No invoice shown to select"} checked={!!nSel && nSel === list.length} onChange={(ev) => salesSelAll(ev.target.checked)} />,
      cell: (v) => <input type="checkbox" aria-label="Select" checked={s.sel.has(v.id)} disabled={v.status === "posted" || v.status === "intally"} onChange={() => {}} onClick={(ev) => salesToggle(v.id, ev.target.checked, ev.shiftKey)} /> },
    { k: "date", role: "date", label: "Date", cls: "dt", filter: <ColFunnel hideIdle t="sales" k="date" label="Date" />, v: (v) => v.x.date || "", td: (v) => ({ title: fmtDate(v.x.date) }), cell: (v) => v.x.date ? shortDate(v.x.date) : "—" },
    { k: "no", role: "number", label: "Invoice", cls: "pt", filter: <ColFunnel hideIdle t="sales" k="no" label="Invoice" />, v: (v) => v.x.number || "",
      cell: (v) => <><div className="pn"><button className="linkbtn strong" onClick={() => salesOpen(v.id)}>{v.x.number || "(no number)"}</button></div><div className="nr">{v.source === "created" ? "Created here" : v.fileName || "Uploaded"}</div></> },
    { k: "cust", role: "party", label: "Customer", cls: "pt", filter: <ColFunnel hideIdle t="sales" k="cust" label="Customer" />, v: (v) => v.x.customerName || "",
      cell: (v) => { const x = v.x; return <><div className="pn">{x.customerName || "—"}</div><div className="nr">{x.customerGstin || "Unregistered"}{x.pos ? " · " + (GST_STATES[x.pos] || x.pos) : ""}{gstinFromLedger(v) && <> <span className="src" data-gstin-from={v.id}>GSTIN from Tally ledger</span></>}</div></>; } },
    { k: "val", role: "amount", label: "Total", cls: "n", filter: <ColFunnel hideIdle t="sales" k="val" label="Total" />, v: (v) => num(v.x.total), cell: (v) => <b>{money(num(v.x.total))}</b> },
    { k: "st", role: "status", label: "Status", v: (v) => (ST_WORDS[v.refused && v.status === "review" ? "refused" : v.status] || ["", v.status])[1], cell: (v) => { const w = ST_WORDS[v.refused && v.status === "review" ? "refused" : v.status] || ["no", v.status]; return <><span className={"tag " + w[0]} data-sales-st={v.id}>{w[1]}</span>{salesOptShown(v) && <div className="nr" data-sales-opt={v.id}>Optional voucher</div>}</>; } },
    { k: "tx", label: "Taxable", cls: "n", v: (v) => num(v.x.taxable), sum: true, cell: (v) => money(num(v.x.taxable)) },
    { k: "gst", label: "GST", cls: "n", v: (v) => gstOf(v.x), sum: true, cell: (v) => <>{money(gstOf(v.x))}
      {(v.taxPicks || []).map((t, i) => <div key={i} className="nr" data-tax-led={t.kind} title={t.why ? t.ledger + ": " + t.why : t.ledger}>{t.ledger}</div>)}</> },
    { k: "led", label: "Customer ledger", cls: "lg", filter: <ColFunnel hideIdle t="sales" k="led" label="Customer ledger" />, v: (v) => v.customerLedger || "",
      cell: (v, p) => p.editable ? <>
        {v.postError && v.status !== "intally" && <span className="src bad" title={v.postError}>Tally: {v.postError}</span>}
        <LedgerBox className={"lgbox" + (v.status === "ready" ? " done" : v.customerLedger ? " sugg" : "")} value={v.customerLedger || ""} fk={"svcust:" + v.id} data-svcust={v.id}
          placeholder="Select customer ledger" aria-label={"Customer ledger for " + (v.x.number || "invoice")} onCommit={(val) => salesSetCust(v.id, val)} />
        {v.hold && v.status === "review" && <select aria-label="Edit type" data-edit-type={v.id} value="" onChange={(ev) => salesSetKind(v.id, ev.target.value)}><option value="">Edit type…</option><option value="invoice">Invoice</option><option value="credit">Credit Note</option><option value="debit">Debit Note</option></select>}
        {p.editable && (v.taxAsk || []).slice(0, 1).map((a) => <TaxChoice key={a.ck || a.ik} a={a} id={v.id} />)}
        <SalesAsk v={v} />
        {p.issue ? <span className="src bad" title={(v.problems || []).concat(v.ledgerIssues || []).join("; ")}>{p.issue}</span>
          : <span className={"src" + (v.status === "ready" ? " ok" : "")}>{v.status === "ready" ? (v.userLedger ? "Set by you" : v.custSource || "Ready") : v.customerLedger ? "Suggested · " + (v.custSource || "match") : "No match found"}</span>}
      </> : <><span className="lgtext">{v.customerLedger || "—"}</span>
        <span className="src muted">{v.status === "posted" ? "Posted " + (v.postedAt ? shortDate(v.postedAt.slice(0, 10)) : "") : v.status === "intally" ? "Already in Tally" : "Ignored"}{v.receivedAt ? " · paid " + shortDate(v.receivedAt) : ""}</span>
        {/* (under the ledger, not beside Open: the row's buttons fit the table at any width) */}
        {v.status === "intally" && <div><button className="linkbtn" data-sales-nottally={v.id} onClick={act("nottally", v)}>Not this Tally entry</button></div>}</> },
    { k: "ac", role: "act", cls: "ac", cell: (v, p) => p.editable ? <>
        {v.status === "review" && v.customerLedger && !p.issue ? <button className="btn small primary" onClick={act("confirm", v)}>Confirm</button> : <button className="btn small" onClick={() => salesOpen(v.id)}>Open</button>}
        {v.x.irnStatus !== "active" && <button className="icon" title="Ignore" aria-label="Ignore" onClick={act("ignore", v)}>✕</button>}
      </> : <><button className="btn small" onClick={() => salesOpen(v.id)}>Open</button>{v.status === "ignored" && <button className="linkbtn" onClick={act("restore", v)}>Restore</button>}</> },
  ];
}

// a panel over the page (the invoice, or the settings); a click on the dark area around it or Esc closes it
// (parts/dismiss.js: a click outside, Esc and Back all go through close, at once)
function Panel({ title, wide, close, children }) {
  const ref = useRef(null);
  useDismiss(true, ref, close, { back: "always" });
  return (
    <div className="bk-overlay">
      <div ref={ref} className={"bk-panel" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Invoice"}>
        <div className="bk-panel-head"><h2>{title}</h2><button className="icon" aria-label="Close" onClick={close}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

// one invoice: what it says (editable until posted), the Sales voucher it makes, and its buttons
// components are made once, outside the screens, so their boxes are not made anew (and lose the cursor) at every redraw
function Field({ x, k, label, type = "text", ro }) {
  return <label><span>{label}</span>
    <CommitBox type={type} value={x[k] == null ? "" : x[k]} disabled={ro} {...(type === "number" ? { step: "0.01" } : {})} onCommit={(val) => salesSetField(k, val)} /></label>;
}
function CfgField({ c, label, k, ph, area }) {
  return <label><span>{label}</span><CommitBox as={area ? "textarea" : "input"} rows={area ? 3 : undefined} value={c[k] == null ? "" : c[k]} placeholder={ph || ""} onCommit={(val) => salesCfg(k, val)} /></label>;
}
function CfgLedger({ label, k, selected, prefer }) {
  return <label><span>{label}</span><LedgerSelect selected={selected} prefer={prefer} onPick={(val) => salesCfgLedger(k, val)} /></label>;
}
// (next-fix-audit-sales-einv) the supply's kind: a supply to an SEZ unit or developer is zero-rated (IGST Act s.16(1)(b))
function Supplies() {
  return <><option value="">Regular</option><option value="SEZWP">SEZ, with payment of IGST</option><option value="SEZWOP">SEZ, under LUT (no IGST)</option></>;
}
function DraftText({ x, label, k, area, ...p }) {
  return <label><span>{label}</span>{area
    ? <textarea rows={2} value={x[k] || ""} onChange={(ev) => draftSet(k, ev.target.value)} {...p} />
    : <input type="text" value={x[k] || ""} onChange={(ev) => draftSet(k, ev.target.value)} {...p} />}</label>;
}

// tax-accuracy: the e-invoice (IRN) and e-way bill of this invoice, made through the firm's GST API
function EinvPanel({ v }) {
  // (next-fix-audit-sales-einv) the e-invoice user of the registration the invoice is issued from (EINV.seller), not always the main GSTIN
  const s = SL(), co = CO(s.cid), x = v.x, gstin = String(co.gstin || "").toUpperCase(), seller = EINV.seller(v, co) || gstin;
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [t, setT] = useState({ distance: "", vehicleNo: "", transporterId: "", mode: "1" });
  if (!GSTAPI.on() || !GSTIN_RE.test(gstin) || !GSTIN_RE.test(String(x.customerGstin || "").toUpperCase())) return null;
  const a = EINV.need(seller), probs = EINV.problems(v, co, s.cfg);
  const go = (label, f) => async () => { setBusy(label); setMsg(""); try { setMsg(await f()); } catch (e) { setMsg((e && e.message) || String(e)); } setBusy(""); render(); };
  const active = x.irn && x.irnStatus !== "cancelled", canCancel = active && x.ackDt && Date.now() - Date.parse(x.ackDt) < 24 * 3600000;
  return <section data-einv={v.id}><h3>E-invoice and e-way bill</h3>
    {EINV.host === "sandbox" && <p className="note">The firm's server sends to the IRP's <b>sandbox</b> (test): an IRN made here is not a real one.</p>}
    {active ? <div className="bk-alert"><b>IRN</b> {x.irn}<div className="note">Ack. no. {x.ackNo} · {fmtDateTime(x.ackDt)}{x.ewayNo ? " · E-way bill " + x.ewayNo + (x.ewayValidTill ? ", valid till " + fmtDateTime(x.ewayValidTill) : "") : ""}</div></div>
      : x.irnStatus === "cancelled" ? <p className="note"><b>IRN cancelled</b> {x.irn}.</p> : null}
    {x.irnStatus === "cancelled" && x.irnCancelInTally && <div className="bk-alert bad" data-irn-cancel-tally="">{v.postJob ? "Its posting to Tally is still queued, but its IRN is cancelled: if it reaches Tally, cancel" : "This invoice is still in Tally as a sale, but its IRN is cancelled: cancel"} the voucher {x.number} in Tally, so the books and GSTR-1 do not count it.</div>}
    {!a ? <p className="note">Give the client's e-invoice API user in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button> to make the IRN here.</p>
      : !active ? <>
        {probs.length > 0 && <div className="bk-alert bad">{probs.map((p, i) => <div key={i}>{p}</div>)}</div>}
        <button className="btn small primary" disabled={!!busy || probs.length > 0} onClick={go("irn", async () => { const j = await EINV.irn(v); return "IRN made: " + j.irn; })}>{busy === "irn" ? "Making the IRN…" : "Make the IRN"}</button>
      </> : <>
        {!x.ewayNo && <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <input type="number" min="0" placeholder="Distance (km)" aria-label="Distance in km" value={t.distance} style={{ width: 120 }} onChange={(ev) => setT({ ...t, distance: ev.target.value })} />
          <select aria-label="Mode" value={t.mode} style={{ width: "auto" }} onChange={(ev) => setT({ ...t, mode: ev.target.value })}><option value="1">Road</option><option value="2">Rail</option><option value="3">Air</option><option value="4">Ship</option></select>
          <input type="text" placeholder="Vehicle no." aria-label="Vehicle number" value={t.vehicleNo} style={{ width: 130 }} onChange={(ev) => setT({ ...t, vehicleNo: ev.target.value })} />
          <input type="text" placeholder="Transporter GSTIN / ID" aria-label="Transporter ID" value={t.transporterId} style={{ width: 170 }} onChange={(ev) => setT({ ...t, transporterId: ev.target.value })} />
          <button className="btn small" disabled={!!busy || !num(t.distance) || (!t.vehicleNo && !t.transporterId)} onClick={go("ewb", async () => { const j = await EINV.ewb(v, t); return "E-way bill " + j.ewbNo + " made."; })}>{busy === "ewb" ? "Making…" : "Make the e-way bill"}</button>
        </div>}
        {canCancel && <button className="linkbtn" style={{ marginTop: 6 }} disabled={!!busy} onClick={go("cancel", async () => {
          const ok = await askConfirm({ title: "Cancel this IRN?", ok: "Cancel the IRN", body: '<p class="note">Within 24 hours of the IRN only. The invoice number cannot be used again for another invoice.</p>' });
          if (!ok) return ""; await EINV.cancel(v, "2", "Cancelled from FinCom"); return v.status === "ignored" ? "IRN cancelled: the invoice is set aside (Ignored), no longer a sale." : "IRN cancelled.";
        })}>Cancel the IRN</button>}
      </>}
    {msg && <p className="note">{msg}</p>}
  </section>;
}

function Detail({ v }) {
  const s = SL(), x = v.x, co = CO(s.cid), ro = !["review", "ready"].includes(v.status);
  // (next-fix-audit-sales-einv) an invoice with a live IRN: its figures are the IRP's, never changed here (its ledgers still can be)
  const fro = ro || x.irnStatus === "active", ag = salesAgainstOf(v);
  const lines = salesLines(v), tot = (side) => r2(lines.filter((l) => l.side === side).reduce((a, l) => a + l.amt, 0));
  const probs = (v.problems || []).concat(v.ledgerIssues || []), act = (a, force) => () => salesRowAct(a, v.id, force);
  const [cls, word] = STATUS[v.status] || ["no", v.status];
  return (
    <Panel wide title={<>Invoice {x.number || ""} <span className={"tag " + cls}>{word}</span></>} close={() => salesAct("salesClose")}>
      {probs.length > 0 && <div className="bk-alert bad">{probs.map((p, i) => <div key={i}>{p}</div>)}</div>}
      {v.postError && v.status !== "intally" && <div className="bk-alert bad">Tally: {v.postError}</div>}
      {salesOptShown(v) && <div className="bk-alert" data-sales-opt-note={v.id}>In Tally as an Optional voucher: it is not in the books until you make it regular in Tally (Display More Reports → Exception Reports → Optional Vouchers).{v.status === "posted" && co.createOptional && " To post regular vouchers, untick “Post purchase bills and sales invoices as Optional vouchers” in Client setup."}</div>}
      {/* next-dup-cloud-only: the duplicate check's one small line (an old FinCom cloud copy, or it did not answer), on the panel only: src/js/26-sales-invoice.js salesCheckSafe */}
      {v.copyCheck && <div className="bk-alert info" data-sales-copy-note={v.id}>{v.copyCheck.note}</div>}
      <SalesAsk v={v} wide />
      <section><h3>Invoice details</h3>
        <div className="bk-form">
          <Field x={x} ro={fro} label="Invoice number" k="number" /><Field x={x} ro={fro} label="Date" k="date" type="date" /><Field x={x} ro={fro} label="Customer name" k="customerName" /><Field x={x} ro={fro} label={gstinFromLedger(v) ? "Customer GSTIN (GSTIN from Tally ledger)" : "Customer GSTIN"} k="customerGstin" />
          <label><span>Place of supply</span><select value={x.pos || ""} disabled={fro} onChange={(ev) => salesSetField("pos", ev.target.value)}><States /></select></label>
          <Field x={x} ro={fro} label="Taxable value" k="taxable" type="number" /><Field x={x} ro={fro} label="CGST" k="cgst" type="number" /><Field x={x} ro={fro} label="SGST" k="sgst" type="number" /><Field x={x} ro={fro} label="IGST" k="igst" type="number" />
          <Field x={x} ro={fro} label="Cess" k="cess" type="number" /><Field x={x} ro={fro} label="Invoice total" k="total" type="number" />
          <label><span>Supply</span><select data-sv-supply="" value={x.supply || ""} disabled={fro} onChange={(ev) => salesSetField("supply", ev.target.value)}><Supplies /></select></label>
        </div>
        {(x.items || []).length > 0 && <div className="bk-tablewrap" style={{ marginTop: 10 }}><table className="bk-table" data-statement="">
          <thead><tr><th>Item</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST %</th></tr></thead>
          <tbody>{x.items.map((it, i) => <tr key={i}><td>{it.desc}</td><td>{it.hsn || ""}</td><td className="n">{it.qty} {it.unit || ""}</td><td className="n">{money(num(it.rate))}</td><td className="n">{money(num(it.taxable))}</td><td className="n">{num(it.gstRate)}%</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section><h3>Sales voucher for Tally</h3>
        <div className="bk-form">
          <label><span>Customer ledger</span><LedgerBox value={v.customerLedger || ""} fk={"svcustd:" + v.id} data-svcust={v.id} disabled={ro} onCommit={(val) => salesSetCust(v.id, val)} /></label>
        </div>
        <div className="bk-tablewrap" style={{ marginTop: 10 }}><table className="bk-table" data-statement="">
          <thead><tr><th>Ledger</th><th className="n">Debit ₹</th><th className="n">Credit ₹</th></tr></thead>
          <tbody>
            {/* the owner, 16-Nov-2026: every line's ledger can be changed here (the client's exact Tally ledger names), kept as "set by you" */}
            {lines.map((l, i) => <tr key={i} data-svline={lineRole(l)}><td title={l.why || undefined} data-line-why={l.why || undefined}>
              {ro || l.role === "roundoff" ? (l.ledger || <span className="src bad">not set</span>)
                : <LedgerBox value={l.ledger || ""} fk={"svline:" + v.id + ":" + i + ":" + (l.ledger || "")} data-svline-box={lineRole(l) + (l.role === "sales" ? ":" + l.rate : "")} placeholder={lineLabel(l) + " ledger"} aria-label={lineLabel(l) + " ledger"}
                    onCommit={(val) => salesLinePick(v.id, lineRole(l), l.role === "sales" ? l.rate : lineRate(l), val)} />}
              {!ro && !l.ledger && l.cands && <> <TaxChoice a={l} id={v.id} /></>}{l.ledger && l.why && l.by !== "you" && <span className="src muted"> · {l.why}</span>}{l.ledger && !exactLedger(l.ledger) && <> <span className="src bad">not in Tally</span></>}
              {!ro && l.by === "you" && <> <span className="src ok" data-set-by-you="">set by you</span> <button className="linkbtn" data-svline-undo="" onClick={() => salesLineUnset(v.id, lineRole(l), l.role === "sales" ? l.rate : l.keys)}>undo, let FinCom pick</button></>}</td>
              <td className="n">{l.side === "Dr" ? INR.format(l.amt) : ""}</td><td className="n">{l.side === "Cr" ? INR.format(l.amt) : ""}</td></tr>)}
            <tr><td><b>Total</b></td><td className="n"><b>{INR.format(tot("Dr"))}</b></td><td className="n"><b>{INR.format(tot("Cr"))}</b></td></tr>
          </tbody>
        </table></div>
        <p className="note">Voucher type “{salesVt(x)}” · bill-wise {ag ? "Agst Ref " + ag.x.number + " (the invoice this note is against)" : "New Ref " + x.number + (x.againstInvoice ? " (invoice " + x.againstInvoice + " not matched: no one invoice of that number to this customer ledger, posted or in Tally, dated on or before the note, in its year or, with none there, in an earlier year; set it against the bill in Tally if it is one)" : "")}{co.createOptional ? " · posted as Optional" : ""}</p>
      </section>
      <EinvPanel v={v} />
      {(v.trace || []).length > 0 && <section><h3>How it was read</h3><ol className="note">{v.trace.map((t, i) => <li key={i}>{t.ok ? "✔ " : "✖ "}{t.step}: {t.note || ""}</li>)}</ol></section>}
      <section className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {v.source === "upload" && <><span className="note">Read again:</span>
          <button className="btn small" onClick={act("reread", null)}>Free</button>
          <button className="btn small" disabled={!googleReady()} onClick={act("reread", "google")}>Google OCR</button>
          <button className="btn small" disabled={!claudeReady()} onClick={act("reread", "claude")}>Claude</button></>}
        {v.status === "review" && <button className="btn primary" onClick={act("confirm")}>Confirm</button>}
        {v.status === "ready" && <button className="btn" onClick={act("unready")}>Back to review</button>}
        <button className="btn" onClick={act("print")}>Print invoice</button>
        {S.files["sv:" + v.id] && <button className="btn" onClick={act("file")}>View uploaded file</button>}
        {!fro && <button className="btn" onClick={act("edit")}>{v.source === "created" ? "Edit invoice" : (x.items || []).length ? "Edit items" : "Enter items"}</button>}
        {/* (a live IRN: never ignored or deleted here, the IRN is cancelled first: review of b4ff11b10) */}
        {x.irnStatus === "active" && !ro && <span className="note" data-irn-keep="">It has an IRN: to drop it, cancel the IRN first.</span>}
        {!ro && x.irnStatus !== "active" && <button className="btn" onClick={act("ignore")}>Ignore</button>}
        {v.status !== "posted" && x.irnStatus !== "active" && <button className="btn danger" onClick={act("delete")}>Delete</button>}
      </section>
    </Panel>
  );
}

function SettingsPanel() {
  const s = SL(), c = s.cfg, co = CO(s.cid), home = stateOfGstin(co.gstin);
  const rates = Array.from(new Set(s.list.flatMap((v) => salesTotals(v.x).map((g) => g.rate)).concat([5, 18]))).sort((a, b) => a - b);
  return (
    // closing never asks and never saves (the owner, 22-Oct-2026): what is not saved stays as a draft until Save
    <Panel title={"Sales settings — " + co.name} close={() => { s.showSettings = false; render(); }}>
      {/* review 18: one section, saved with Save at its foot; the default ledgers are confirmed for every computer */}
      <Confirm id="sales:settings" label="Sales settings" stores={["salescfg"]} cid={s.cid}>
      <KeptLine id="sales:settings" />
      <section><h3>Invoice numbers</h3>
        <div className="bk-form"><CfgField c={c} label="Series ({FY} = financial year)" k="series" ph="INV/{FY}/" /><CfgField c={c} label="Next number" k="next" /><CfgField c={c} label="Digits" k="pad" /></div>
        <p className="note">Next invoice: <b>{nextInvoiceNumber(new Date().toISOString().slice(0, 10)).number}</b></p></section>
      <section><h3>Your details on invoices</h3>
        <div className="bk-form">
          <CfgField c={c} label="Address" k="address" area /><CfgField c={c} label="Phone" k="phone" /><CfgField c={c} label="Email" k="email" />
          <CfgField c={c} label="Bank name" k="bankName" /><CfgField c={c} label="Account number" k="bankAc" /><CfgField c={c} label="IFSC" k="bankIfsc" /><CfgField c={c} label="Branch" k="bankBranch" />
          <CfgField c={c} label="Terms and conditions" k="terms" area /><CfgField c={c} label="Signatory (below the signature)" k="signatory" ph="Authorised Signatory" />
        </div>
        {/* (next-fix-audit-sales-einv) each other registration's own address, for its e-invoices (EINV.address) */}
        {salesOwnGstins().filter((g) => g !== String(co.gstin || "").toUpperCase()).map((g) => <div className="bk-form" key={g}><CfgField c={c} label={"Address of " + g + " (" + (GST_STATES[g.slice(0, 2)] || "") + ")"} k={"address_" + g} area /></div>)}
        <p className="note">GSTIN, PAN and state come from Client setup → Company{co.gstin ? " (" + co.gstin + ", " + (GST_STATES[home] || "") + ")" : ": add the GSTIN there"}.</p></section>
      <section><h3>Tally ledgers</h3><p className="note">Found automatically in the ledger list. Choose them here if this client names them differently.</p>
        <div className="bk-form">
          <CfgField c={c} label="Voucher type" k="voucherType" ph="Sales" />
          <CfgLedger label="Sales ledger (all rates)" k="sales" selected={exactLedger((c.ledgers || {}).sales) || ""} prefer={/sales accounts?/i} />
          {rates.map((r) => <span key={r} style={{ display: "contents" }}>
            <CfgLedger label={"Sales " + rateTag(r) + "% — same state"} k={"sales_" + rateTag(r) + "_l"} selected={salesLedgerFor(r, false)} prefer={/sales accounts?/i} />
            <CfgLedger label={"Sales " + rateTag(r) + "% — other state"} k={"sales_" + rateTag(r) + "_i"} selected={salesLedgerFor(r, true)} prefer={/sales accounts?/i} /></span>)}
          {["cgst", "sgst", "igst", "cess"].map((k) => <CfgLedger key={k} label={"Output " + k.toUpperCase()} k={k} selected={taxLedgerFor(k, 18)} prefer={/duties|taxes/i} />)}
          <CfgLedger label="Round off" k="roundOff" selected={roundOffLedger()} prefer={/indirect/i} />
        </div></section>
      <section><h3>Automation</h3>
        <label className="chk"><input type="checkbox" checked={c.auto !== false} onChange={(ev) => salesCfgCheck("auto", ev.target.checked)} /> Mark invoices Ready when everything checks out and the customer is certain (GSTIN on the Tally ledger, or booked the same way before)</label>
        <label className="chk"><input type="checkbox" checked={!!c.noRound} onChange={(ev) => salesCfgCheck("noRound", ev.target.checked)} /> Do not round invoice totals to the rupee</label></section>
      <section><h3>Clean up</h3><div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => salesAct("salesForget")}>Forget customer memory</button>
        <button className="btn small danger" disabled={!s.list.length} onClick={() => salesAct("salesDelAll")}>Delete all sales invoices</button></div></section>
      </Confirm>
    </Panel>
  );
}

// a new GST invoice (or an uploaded one given its items): printed and posted in one go
function Create() {
  const s = SL(), d = s.draft, x = d.x, co = CO(s.cid), probs = d.showErrors ? draftProblems() : [];
  const groups = salesTotals(x);
  return (
    <div className="bk">
      <div className="bk-head">
        <div className="bk-id"><h2 className="bk-title">{d.editId ? "Edit sales invoice" : "New sales invoice"}</h2>
          <div className="bk-sub">{co.name}{co.gstin ? " · GSTIN " + co.gstin : ""} · {GST_STATES[stateOfGstin(co.gstin)] || ""}</div></div>
        <div></div>
        <div className="bk-actions"><button className="btn small" onClick={() => salesAct("salesCancel")}>Cancel</button><button className="btn small" onClick={() => salesAct("salesPrintDraft")}>Preview / Print</button><button className="btn primary small" onClick={() => salesAct("salesSave")}>Save invoice</button></div>
      </div>
      {probs.length > 0 && <div className="bk-alert bad">{probs.map((p, i) => <div key={i}>{p}</div>)}</div>}
      {salesRateWarnings(x).length > 0 && <div className="bk-alert">{salesRateWarnings(x).map((p, i) => <div key={i}>{p}</div>)}</div>}
      <div className="si-grid">
        <section className="si-card"><h3>Invoice</h3><div className="bk-form">
          <DraftText x={x} label="Invoice number" k="number" data-fk="sd:number" />
          <label><span>Invoice date</span><DateBox aria-label="Invoice date" value={x.date || ""} onChange={(ev) => draftSet("date", ev.target.value)} /></label>
          <label><span>Credit period (days)</span><input type="number" min="0" value={x.dueDays || ""} onChange={(ev) => draftSet("dueDays", ev.target.value)} /></label>
          <DraftText x={x} label="Order / PO reference" k="poNo" /><DraftText x={x} label="E-way bill no. (optional)" k="ewayNo" /><DraftText x={x} label="IRN (if e-invoiced)" k="irn" />
        </div></section>
        <section className="si-card"><h3>Bill to</h3><div className="bk-form">
          <label><span>Customer ledger (Tally)</span><LedgerBox className={"lgbox" + (d.customerLedger ? " done" : "")} value={d.customerLedger || ""} fk="sdcust" data-sdcust="" placeholder="Type to search customers" onCommit={draftCust} /></label>
          <DraftText x={x} label="Name on invoice" k="customerName" /><DraftText x={x} label="GSTIN (blank if unregistered)" k="customerGstin" maxLength={15} /><DraftText x={x} label="Address" k="address" area />
          <label><span>Place of supply</span><select value={x.pos || ""} onChange={(ev) => draftSet("pos", ev.target.value)}><States /></select></label>
          <label><span>Supply</span><select data-sd-supply="" value={x.supply || ""} onChange={(ev) => draftSet("supply", ev.target.value)}><Supplies /></select></label>
          {stateOfGstin(co.gstin) && x.pos ? <p className="note" style={{ margin: 0 }}>{x.supply === "SEZWOP" ? <>To an SEZ under LUT: <b>no IGST</b> (IGST Act s.16(3)(a)).</> : /^SEZ/.test(x.supply || "") ? <>To an SEZ: <b>IGST</b>, inter-state by law (IGST Act s.7(5)(b)).</> : d.inter ? <>Another state: <b>IGST</b> is charged.</> : <>Same state: <b>CGST + SGST</b> are charged.</>}</p>
            : !stateOfGstin(co.gstin) ? <p className="note" style={{ margin: 0 }}>The client's state is not known: add its GSTIN in Client setup to charge GST.</p> : null}
        </div></section>
      </div>
      <datalist id="itemMemory">{Object.values(s.cfg.items || {}).map((it) => <option key={it.desc} value={it.desc} />)}</datalist>
      <section className="si-card"><h3>Items</h3>
        <div className="bk-tablewrap"><table className="bk-table si-items" data-statement="">
          <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="n">Qty</th><th>Unit</th><th className="n">Rate</th><th className="n">Disc %</th><th className="n">Taxable</th><th className="n">GST %</th><th className="n">Tax</th><th className="n">Cess ₹</th><th></th></tr></thead>
          <tbody>{x.items.map((it, i) => {
            const set = (k) => (ev) => draftItem(i, k, ev.target.value);
            return <tr key={i}>
              <td className="dt">{i + 1}</td>
              <td><input type="text" list="itemMemory" value={it.desc || ""} placeholder="Goods or service" aria-label={"Item " + (i + 1)} data-fk={"si:" + i + ":desc"} onChange={set("desc")} /></td>
              <td><input type="text" className="w90" value={it.hsn || ""} aria-label="HSN/SAC" onChange={set("hsn")} /></td>
              <td className="n"><input type="number" step="any" min="0" className="w70 n" value={it.qty} aria-label="Quantity" onChange={set("qty")} /></td>
              <td><select value={it.unit} aria-label="Unit" onChange={set("unit")}>{SALES_UNITS.map((u) => <option key={u}>{u}</option>)}</select></td>
              <td className="n"><input type="number" step="any" min="0" className="w100 n" value={it.rate} aria-label="Rate" onChange={set("rate")} /></td>
              <td className="n"><input type="number" step="any" min="0" max="100" className="w60 n" value={it.disc || 0} aria-label="Discount %" onChange={set("disc")} /></td>
              <td className="n">{money(it.taxable)}</td>
              <td className="n"><select value={num(it.gstRate)} aria-label="GST rate" onChange={set("gstRate")}>{SALES_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
              <td className="n">{d.noState ? "—" : money(r2((it.taxable * num(it.gstRate)) / 100))}</td>
              <td className="n"><input type="number" step="any" min="0" className="w90 n" value={it.cess === undefined ? "" : it.cess} placeholder="—" aria-label="Cess" onChange={set("cess")} /></td>
              <td className="ac"><button className="icon" aria-label="Remove item" title="Remove item" onClick={() => draftItemRemove(i)}>✕</button></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => salesAct("salesAddItem")}>+ Add item</button></div>
      </section>
      <div className="si-grid">
        <section className="si-card"><h3>Notes</h3><textarea rows={4} value={x.notes || ""} placeholder="Shown on the invoice" aria-label="Notes" onChange={(ev) => draftSet("notes", ev.target.value)} />
          <p className="note">Bank details, terms and signatory come from Sales settings.</p></section>
        <section className="si-card"><h3>Totals</h3>
          <dl className="si-tot">
            <div><dt>Taxable value</dt><dd>{money(x.taxable)}</dd></div>
            {d.noState && <div><dt>GST</dt><dd className="note">shown once the client’s state is known</dd></div>}
            {!d.noState && groups.filter((g) => g.rate).map((g) => d.inter
              ? <div key={g.rate}><dt>IGST @ {g.rate}%</dt><dd>{money(r2((g.taxable * g.rate) / 100))}</dd></div>
              : <span key={g.rate} style={{ display: "contents" }}>
                <div><dt>CGST @ {g.rate / 2}%</dt><dd>{money(r2((g.taxable * g.rate) / 200))}</dd></div>
                <div><dt>SGST @ {g.rate / 2}%</dt><dd>{money(r2((g.taxable * g.rate) / 100 - r2((g.taxable * g.rate) / 200)))}</dd></div></span>)}
            {num(x.cess) ? <div><dt>Cess</dt><dd>{money(x.cess)}</dd></div> : null}
            {x.roundOff ? <div><dt>Round off</dt><dd>{money(x.roundOff)}</dd></div> : null}
            <div className="big"><dt>Invoice total</dt><dd>{money(x.total)}</dd></div>
          </dl>
          <p className="note">{rupeesInWords(x.total)}</p></section>
      </div>
    </div>
  );
}

// a line of the sales voucher: what a person changes it as (party, sales, igst, cgst, sgst, cess), its words, its GST rate
const lineRole = (l) => l.role === "tax" ? l.kind : l.role;
const lineLabel = (l) => l.role === "party" ? "Customer" : l.role === "sales" ? "Sales " + rateTag(l.rate) + "%" : l.role === "tax" ? String(l.kind || "").toUpperCase() + " output" : "Round-off";
const lineRate = (l) => { const k = (l.keys || [])[0]; return k && (l.keys || []).length === 1 ? num(k.split("_")[1]) : "all"; };
// "Change ledger" on the invoices ticked: the line, its rate (all or one), the ledger
function BulkLine({ s }) {
  const b = s.bulkLine || (s.bulkLine = { role: "sales", rate: "all" }), set = (k, val) => { s.bulkLine = { ...b, [k]: val }; render(); };
  return <span className="row" data-svbulkline="" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
    <select aria-label="Line to change" data-svbulkline-role="" value={b.role} onChange={(ev) => set("role", ev.target.value)}>
      {[["sales", "Sales"], ["party", "Party"], ["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
    {!["party", "cess"].includes(b.role) && <select aria-label="Rate" data-svbulkline-rate="" value={b.rate} onChange={(ev) => set("rate", ev.target.value)}>
      <option value="all">All rates</option>{SALES_RATES.map((r) => <option key={r} value={r}>{rateTag(r)}%</option>)}</select>}
    <LedgerBox value={b.ledger || ""} fk={"svbulkline:" + b.role + ":" + b.rate} data-svbulkline-led="" placeholder="New ledger" aria-label="New ledger for the line"
      onCommit={(val) => { if (!val) return true; if (!exactLedger(val)) { toast("“" + val + "” is not a Tally ledger."); return false; } s.bulkLine = { ...b, ledger: exactLedger(val) }; render(); return true; }} />
    {s.bulkLineMsg && <span className="note" data-svbulkline-msg="">{s.bulkLineMsg}</span>}
    <button className="btn" data-svbulkline-apply="" disabled={!b.ledger} onClick={() => salesBulkLine(b.role, b.rate === "all" ? "all" : num(b.rate), b.ledger)}>Change ledger</button>
  </span>;
}
// a GSTIN FinCom filled from the party's Tally ledger (a sheet that gave none), said where it is shown
const gstinFromLedger = (v) => !!(v && v.filled && v.filled.customerGstin && v.filled.customerGstin === v.x.customerGstin);
// on an invoice: "Try again" (refused by Tally, or not confirmed: the duplicate check runs first); no duplicate is ever
// held for a person (the owner, 23-Nov-2026: the same entry is marked In Tally when posting, anything else posted)
function SalesAsk({ v, wide }) {
  const s = SL(), cls = wide ? "btn small" : "linkbtn";
  if (!["review", "ready"].includes(v.status)) return null;
  return <>
    {s.vtAsk && s.vtAsk.length > 1 && !v.x.noteKind && <span data-sales-vt-row={v.id}>{s.vtAsk.map((t) => <button key={t.type} className={cls} data-vt-pick-row={t.type} onClick={() => salesVtAnswer(t.type)}>{t.type}</button>)}</span>}
    {(v.refused || v.needsCheck) && <button className={cls} data-sales-retry={v.id} disabled={!!s.busy || !canPostTally(CO())} title="Checks Tally for it first, then sends it on its own" onClick={() => salesPostOneByOne([v.id])}>Try again</button>}
  </>;
}
// the client's own sales voucher type from its books (src/js/25 salesLearnVt), and the one question when there are several
function SalesVt({ s }) {
  const c = s.cfg || {};
  if (s.vtAsk && s.vtAsk.length > 1) return <div className="bk-alert" data-sales-vt-ask="">
    <b>Choose the voucher type:</b> your Tally uses more than one for sales, so the invoices wait until you choose. {s.vtAsk.map((t) => <button key={t.type} className="btn small" data-vt-pick={t.type} onClick={() => salesVtAnswer(t.type)}>{t.type} ({t.count})</button>)}</div>;
  if (c.vtNotice && !c.vtNotice.seen) return <div className="bk-alert" data-sales-vt-notice="">Voucher type changed to {c.vtNotice.to} (from your Tally). <button className="linkbtn" data-vt-change="" onClick={() => salesVtNoticeDone(true)}>Change</button>{" "}
    <button className="icon" aria-label="Close" data-vt-notice-close="" onClick={() => salesVtNoticeDone(false)}>✕</button></div>;
  return c.vtFrom === "books" ? <p className="note" data-sales-vt="">Voucher type: {c.voucherType} (from your Tally)</p> : null;
}
function SalesRefused({ s }) {
  const waiting = s.list.filter((v) => v.refused && !v.refused.single && v.status === "review"), done = s.oneByOne;
  if (!waiting.length && !(done && done.rows && done.rows.length)) return null;
  return <div className="bk-alert" data-sales-refused="">
    {waiting.length > 0 && <div><b>Refused by Tally:</b> {waiting.length} invoice{waiting.length === 1 ? "" : "s"}. {waiting[0].refused.hint}{" "}
      <button className="btn small" data-sales-onebyone="" disabled={!!s.busy || !canPostTally(CO())} onClick={() => salesPostOneByOne()}>Post one by one to find the cause</button></div>}
    {done && done.rows && done.rows.length > 0 && <div data-sales-onebyone-result="" style={{ marginTop: waiting.length ? 8 : 0 }}><b>Posted one by one:</b>
      <ul style={{ margin: "4px 0 0 18px" }}>{done.rows.map((r) => <li key={r.id} data-onebyone-row={r.id} className={r.ok ? "" : "bad"}><button className="linkbtn" onClick={() => salesOpen(r.id)}>{r.number || "(no number)"}</button>: {r.word}</li>)}</ul>
      <button className="linkbtn" onClick={() => { s.oneByOne = null; render(); }}>Close</button></div>}
  </div>;
}

export default function Sales() {
  const co = CO(), s = SL();
  if (!s || s.cid !== co.id) { loadSales(co.id); return <Loading what="sales invoices" page="table" />; }
  if (s.loading) return <Loading what="sales invoices" page="table" />;
  if (s.view === "create" && s.draft) return <Create />;
  ensureFileInputs();
  const all = s.list.filter((v) => v.status !== "ignored"), dates = all.map((v) => v.x.date).filter(Boolean).sort();
  const sum = (k) => r2(all.reduce((a, v) => a + num(v.x[k]), 0));
  // upload-pages (14-Oct-2026): the states are the page's one row of states (parts/StateBar.jsx), as on Purchase and Bank
  const head = <>
    {s.busy && <BusyCard title="Working on sales…" detail={s.busy} />}
    {/* next-fix-sales-upload (item 4): invoices Tally refused in a batch with no reason given, and each one's own answer
        once posted one by one (src/js/26 salesPostOneByOne) */}
    <SalesVt s={s} />
    <SalesRefused s={s} />
    {/* one row (round 3, 05-Oct-2026), the how-to on hover and behind How */}
    {!hasLedgerList() && (bridgeLive(co) ? <NoticeLine sev="info" text="Loading ledgers from Tally…" />
      : (B() && B().ledgersLoading) || (typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id)) ? <NoticeLine sev="info" text="Loading ledgers from FinCom’s cloud copy of the books…" />
      : <NoticeLine text="Tally ledgers are needed for Sales vouchers." how={Bridge.on() ? "Open " + Bridge.tallyName(co) + " in TallyPrime, or import the ledger list." : "Import the ledger list (Tally: Display More Reports → List of Accounts → Export), or connect FinCom Bridge."}>
        <button className="btn small" data-go-from-tally="" onClick={() => goClient("books:import")}>Bring in from Tally</button>{" "}
        <button className="linkbtn" data-led-excel="" onClick={() => salesAct("ledPick")}>Import ledger list from Excel</button></NoticeLine>)}
    <div className="bk-head">
      {/* the page is named in the top bar (one heading, spec I); here only what it holds */}
      <div className="bk-id"><div className="bk-sub">{all.length ? fmtDate(dates[0]) + " to " + fmtDate(dates[dates.length - 1]) : ""}</div></div>
      <dl className="bk-figs">
        <div><dt>Taxable</dt><dd>{money(sum("taxable"))}</dd></div>
        <div><dt>GST</dt><dd>{money(r2(sum("cgst") + sum("sgst") + sum("igst") + sum("cess")))}</dd></div>
        <div><dt>Invoice value</dt><dd>{money(sum("total"))}</dd></div>
      </dl>
      <div className="bk-actions">
        <button className="btn small" title="Amazon MTR, Flipkart or Shopify sales report" onClick={() => doAct("marketPick")}>Marketplace report</button>
        <button className="btn small" onClick={() => salesAct("salesNew")}>Create invoice</button>
        <button className="btn small" onClick={() => salesAct("salesSettings")}>Settings</button>
        <details className="bk-menu"><summary className="btn small">More</summary><div className="bk-menu-list">
          {bridgeLive(co) && <><button onClick={() => salesAct("salesSync")}>Update from Tally</button><button onClick={() => salesAct("salesFile")}>Create Tally file instead</button></>}
          <button onClick={() => salesAct("salesCsv")}>Download sales register (CSV)</button>
        </div></details>
      </div>
    </div>
  </>;
  if (!s.list.length) return <>
    <div className="bk sl">{head}
      <div className="bk-empty" id="salesDrop" tabIndex={0} role="button" onClick={() => salesAct("salesPick")} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); salesAct("salesPick"); } }}>
        <div className="bk-empty-ic">⤒</div><h2>No sales invoices yet</h2>
        <p className="note">Drop the invoices the client issued (PDF or photo) here, or click to choose them.</p>
      </div>
    </div>
    {s.showSettings && <SettingsPanel />}
  </>;
  const list = salesVisible(), nSel = list.filter((v) => s.sel.has(v.id)).length, open = s.openId && inv(s.openId);
  return <>
    <div className="bk sl">{head}
      <div className="bk-bar">
        <input type="search" className="bk-search" autoComplete="off" placeholder="Search invoice, customer, GSTIN" aria-label="Search the invoices" value={s.q} onChange={(ev) => salesSearch(ev.target.value)} />
      </div>
      <ChipBar t="sales" shown={list.length} total={s.list.length + " invoices"} />
      {/* the one list table (spec K6) */}
      <ListTable name="sales" className="bk-table gf-off" cols={salesCols(s, list, nSel)} rows={list} rowKey={(v) => v.id} prep={salesPrep} unit={["invoice", "invoices"]} of={s.list.length} selected={s.sel}
        rowProps={(v) => ({ className: s.sel.has(v.id) ? "picked" : undefined })}
        empty={salesColOn() ? <>Nothing matches these filters. <button className="linkbtn" onClick={() => colChipAll("sales")}>Clear all filters</button> to see every invoice.</> : EMPTY[s.filter]} />
    </div>
    {open && <Detail v={open} />}
    {s.showSettings && <SettingsPanel />}
  </>;
}

// the bar at the bottom: for the invoice being created, what is ticked, or the counts and posting; and Undo
export function SalesBar() {
  const s = SL();
  if (!s || s.loading) return null;
  if (s.view === "create") return s.draft ? (
    <div className="actionbar bk-actionbar">
      <div className="ab-left"><span className="bk-stat"><b>{money(s.draft.x.total)}</b> invoice total</span></div>
      <div className="ab-right"><button className="btn" onClick={() => salesAct("salesCancel")}>Cancel</button><button className="btn" onClick={() => salesAct("salesPrintDraft")}>Preview / Print</button><button className="btn primary" onClick={() => salesAct("salesSave")}>Save invoice</button></div>
    </div>) : null;
  if (!s.list.length) return null;
  const tc = salesCounts(), nsel = s.sel.size;
  let left, right;
  if (nsel) {
    const rows = s.list.filter((v) => s.sel.has(v.id));
    left = <><b>{nsel} selected</b> <span className="muted">· {money(r2(rows.reduce((a, v) => a + num(v.x.total), 0)))}</span> <button className="linkbtn" onClick={() => salesAct("salesSelNone")}>Clear</button></>;
    right = <>
      {/* a ledger picked from the list, or Enter, applies it (src/js/23, 26) */}
      <input type="text" className="lgbox" data-svbulk="" data-fk="svbulk" data-ac="1" autoComplete="off" placeholder={"Customer ledger for the " + nsel + " selected"} aria-label="Customer ledger for the selected" />
      <button className="btn" onClick={() => salesAct("salesBulkLedger")}>Apply</button>
      <BulkLine s={s} />
      {rows.some((v) => v.status === "review") && <button className="btn primary" onClick={() => salesAct("salesBulkConfirm")}>Confirm</button>}
      {rows.some((v) => ["review", "ready"].includes(v.status)) && <button className="btn" onClick={() => salesAct("salesBulkIgnore")}>Ignore</button>}
      <button className="btn" onClick={() => salesAct("salesBulkPrint")}>Print</button>
      {rows.every((v) => v.status !== "posted") && <button className="btn danger" onClick={() => salesAct("salesBulkDelete")}>Delete</button>}
    </>;
  } else {
    // re-review of fdeb79bd8: with a column filter on, the bulk buttons keep to the invoices shown now (salesPostScope,
    // src/js/31); none shown: the plain button, as with no filter
    const conf = salesPostScope(s.list.filter((v) => v.status === "review" && v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length)), confirmable = conf.length;
    // upload-pages: the counts of the states are the state bar's; the Post button counts what it posts
    left = null;
    // (the output GST ledgers to choose are offered whatever else is ready: next-fix-igst-pick)
    const why0 = typeof salesWhy === "function" && salesWhy(), why = !tc.ready && why0;
    const post = salesPostScope(s.list.filter((v) => v.status === "ready")), fOn = !!post.shown, nPost = fOn ? post.length : tc.ready;
    right = <>
      {why && <span className="note" data-post-why="">{why.text} <button className="linkbtn" onClick={why.act}>{why.btn}</button></span>}
      {why0 && (why0.choices || []).map((c) => <TaxChoice key={c.ck} a={c} n={c.n} />)}
      {why0 && why0.unknown > 0 && <span className="note" data-tax-unknown={why0.unknown}>{why0.unknown} invoice{why0.unknown === 1 ? "" : "s"}: which GSTIN of the client {why0.unknown === 1 ? "it is" : "they are"} from is not known. Choose the GST ledger on each, or upload the sheet with its “Our GSTIN” column.</span>}
      {(conf.shown ? conf.all : confirmable) > 0 && <button className="btn" data-confirm-shown={conf.shown ? confirmable : undefined} disabled={!confirmable} onClick={() => salesAct("salesConfirmAll")}>{!conf.shown ? "Confirm all suggestions (" + confirmable + ")" : confirmable ? "Confirm " + confirmable + " shown suggestion" + (confirmable === 1 ? "" : "s") : "No suggestion shown: clear filters to confirm all " + conf.all}</button>}
      {canPostTally(CO()) && postThroughWords(CO()) && <span className="note" data-post-through="">{postThroughWords(CO())}</span>}
      {/* review of 955ce3d85: a column filter on: only the Ready invoices it shows are posted, counted on the button */}
      {canPostTally(CO()) ? <button className="btn primary" disabled={!nPost} data-post-shown={fOn ? nPost : undefined} onClick={() => salesAct("salesPost")}>{!fOn ? (nPost || why ? "Post to Tally (" + nPost + ")" : "No Ready invoice to post") : nPost ? "Post " + nPost + " shown to Tally" : "No Ready invoice shown: clear filters to post all " + post.all}</button>
        : <button className="btn primary" disabled={!nPost} data-post-shown={fOn ? nPost : undefined} onClick={() => salesAct("salesFile")}>{!fOn ? (nPost || why ? "Create Tally file (" + nPost + ")" : "No Ready invoice to export") : nPost ? "Create Tally file of " + nPost + " shown" : "No Ready invoice shown: clear filters to export all " + post.all}</button>}
    </>;
  }
  return (
    <div className="actionbar bk-actionbar">
      {/* the undo text is made (and escaped) by salesSetUndo in src/js/26 */}
      {s.undo && !nsel && <div className="bk-snack"><span dangerouslySetInnerHTML={{ __html: s.undo.text }} /><button className="linkbtn" onClick={() => salesAct("salesUndo")}>Undo</button><button className="icon" aria-label="Close" onClick={() => salesAct("salesUndoOk")}>✕</button></div>}
      <div className="ab-left">{left}</div><div className="ab-right">{right}</div>
    </div>
  );
}
