// A client's sales invoices: uploaded (read from PDFs or photos), from a marketplace report, or created here; each
// gets a customer ledger and becomes a Sales voucher in Tally. Was viewSales, salesRowHtml, salesDetailHtml,
// salesSettingsHtml, viewSalesCreate and salesBar (src/js/26). The printed invoice (invoiceHtml) stays a page of
// its own.
//
// State: SL() is the open client's sales (S.sales): list (the invoices, each with x = what the invoice says and a
// status review → ready → posted, or intally / ignored), filter (the tab), q (search), sel (ticked), openId (the one
// open in the panel), draft (an invoice being created), cfg (numbering, the firm's details, ledgers), undo.
// The actions are in src/js/26: salesAct("salesPost"), salesRowAct("confirm", id), salesSetCust(id, name), …
import { useState } from "react";
import { ColFunnel } from "../parts/ColHead.jsx";
import ListTable from "../parts/ListTable.jsx";
import Loading from "../parts/Loading.jsx";
import CommitBox from "../parts/CommitBox.jsx";
import LedgerBox from "../parts/LedgerBox.jsx";
import LedgerSelect from "../parts/LedgerSelect.jsx";
import Confirm from "../parts/Confirm.jsx";
import { BusyCard } from "../parts/Reading.jsx";
import { ChipBar, NoMatch } from "../parts/ChipBar.jsx";
import NoticeLine from "../parts/NoticeLine.jsx";

const live = () => Bridge.on() && Bridge.up();
const STATUS = { ready: ["ok", "Post to Tally"], review: ["warn", "To review"], posted: ["ok", "Posted"], intally: ["no", "In Tally"], ignored: ["no", "Ignored"] };
// an empty tab says what to do next (spec K6, round 2)
const EMPTY = { review: "Nothing to review. Use Upload invoices at the top right to add more, or Create invoice to make one.",
  ready: "No invoices are ready yet. Confirm each one's customer ledger under To review; it then waits here to be posted.",
  done: "Nothing posted or ignored yet. Use Post to Tally on the invoices that are ready." };
const States = () => <><option value="">— Choose —</option>{gstStateList().map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</>;
const gstOf = (x) => r2(num(x.cgst) + num(x.sgst) + num(x.igst) + num(x.cess));

// the sales list's columns (spec K6: date, number, party, amount, status, then the rest, in ListTable.jsx's order)
const ST_WORDS = { ready: ["ok", "Ready to post"], review: ["warn", "To review"], posted: ["ok", "Posted"], intally: ["no", "In Tally"], ignored: ["no", "Ignored"] };
const salesPrep = (v) => ({ editable: ["review", "ready"].includes(v.status), issue: (v.problems || [])[0] || (v.ledgerIssues || []).find((p) => !/customer ledger/.test(p)) || "" });
function salesCols(s, list, nSel) {
  const act = (a, v) => () => salesRowAct(a, v.id);
  return [
    { k: "pick", role: "pick", cls: "ck", head: <input type="checkbox" aria-label="Select all" checked={!!nSel && nSel === list.length} onChange={(ev) => salesSelAll(ev.target.checked)} />,
      cell: (v) => <input type="checkbox" aria-label="Select" checked={s.sel.has(v.id)} disabled={v.status === "posted"} onChange={() => {}} onClick={(ev) => salesToggle(v.id, ev.target.checked, ev.shiftKey)} /> },
    { k: "date", role: "date", label: "Date", cls: "dt", filter: <ColFunnel t="sales" k="date" label="Date" />, v: (v) => v.x.date || "", td: (v) => ({ title: fmtDate(v.x.date) }), cell: (v) => v.x.date ? shortDate(v.x.date) : "—" },
    { k: "no", role: "number", label: "Invoice", cls: "pt", filter: <ColFunnel t="sales" k="no" label="Invoice" />, v: (v) => v.x.number || "",
      cell: (v) => <><div className="pn"><button className="linkbtn strong" onClick={() => salesOpen(v.id)}>{v.x.number || "(no number)"}</button></div><div className="nr">{v.source === "created" ? "Created here" : v.fileName || "Uploaded"}</div></> },
    { k: "cust", role: "party", label: "Customer", cls: "pt", filter: <ColFunnel t="sales" k="cust" label="Customer" />, v: (v) => v.x.customerName || "",
      cell: ({ x }) => <><div className="pn">{x.customerName || "—"}</div><div className="nr">{x.customerGstin || "Unregistered"}{x.pos ? " · " + (GST_STATES[x.pos] || x.pos) : ""}</div></> },
    { k: "val", role: "amount", label: "Total", cls: "n", filter: <ColFunnel t="sales" k="val" label="Total" />, v: (v) => num(v.x.total), cell: (v) => <b>{money(num(v.x.total))}</b> },
    { k: "st", role: "status", label: "Status", v: (v) => (ST_WORDS[v.status] || ["", v.status])[1], cell: (v) => { const w = ST_WORDS[v.status] || ["no", v.status]; return <span className={"tag " + w[0]}>{w[1]}</span>; } },
    { k: "tx", label: "Taxable", cls: "n", v: (v) => num(v.x.taxable), sum: true, cell: (v) => money(num(v.x.taxable)) },
    { k: "gst", label: "GST", cls: "n", v: (v) => gstOf(v.x), sum: true, cell: (v) => money(gstOf(v.x)) },
    { k: "led", label: "Customer ledger", cls: "lg", filter: <ColFunnel t="sales" k="led" label="Customer ledger" />, v: (v) => v.customerLedger || "",
      cell: (v, p) => p.editable ? <>
        {v.postError && <span className="src bad" title={v.postError}>Tally: {v.postError}</span>}
        <LedgerBox className={"lgbox" + (v.status === "ready" ? " done" : v.customerLedger ? " sugg" : "")} value={v.customerLedger || ""} fk={"svcust:" + v.id} data-svcust={v.id}
          placeholder="Select customer ledger" aria-label={"Customer ledger for " + (v.x.number || "invoice")} onCommit={(val) => salesSetCust(v.id, val)} />
        {p.issue ? <span className="src bad" title={(v.problems || []).concat(v.ledgerIssues || []).join("; ")}>{p.issue}</span>
          : <span className={"src" + (v.status === "ready" ? " ok" : "")}>{v.status === "ready" ? (v.userLedger ? "Set by you" : v.custSource || "Ready") : v.customerLedger ? "Suggested · " + (v.custSource || "match") : "No match found"}</span>}
      </> : <><span className="lgtext">{v.customerLedger || "—"}</span>
        <span className="src muted">{v.status === "posted" ? "Posted " + (v.postedAt ? shortDate(v.postedAt.slice(0, 10)) : "") : v.status === "intally" ? "Already in Tally" : "Ignored"}{v.receivedAt ? " · paid " + shortDate(v.receivedAt) : ""}</span></> },
    { k: "ac", role: "act", cls: "ac", cell: (v, p) => p.editable ? <>
        {v.status === "review" && v.customerLedger && !p.issue ? <button className="btn small primary" onClick={act("confirm", v)}>Confirm</button> : <button className="btn small" onClick={() => salesOpen(v.id)}>Open</button>}
        <button className="icon" title="Ignore" aria-label="Ignore" onClick={act("ignore", v)}>✕</button>
      </> : <><button className="btn small" onClick={() => salesOpen(v.id)}>Open</button>{v.status !== "posted" && <button className="linkbtn" onClick={act("restore", v)}>Restore</button>}</> },
  ];
}

// a panel over the page (the invoice, or the settings); a click on the dark area around it or Esc closes it
function Panel({ title, wide, close, children }) {
  return (
    <div className="bk-overlay" onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className={"bk-panel" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Invoice"}>
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
function DraftText({ x, label, k, area, ...p }) {
  return <label><span>{label}</span>{area
    ? <textarea rows={2} value={x[k] || ""} onChange={(ev) => draftSet(k, ev.target.value)} {...p} />
    : <input type="text" value={x[k] || ""} onChange={(ev) => draftSet(k, ev.target.value)} {...p} />}</label>;
}

// tax-accuracy: the e-invoice (IRN) and e-way bill of this invoice, made through the firm's GST API
function EinvPanel({ v }) {
  const s = SL(), co = CO(s.cid), x = v.x, gstin = String(co.gstin || "").toUpperCase();
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [t, setT] = useState({ distance: "", vehicleNo: "", transporterId: "", mode: "1" });
  if (!GSTAPI.on() || !GSTIN_RE.test(gstin) || !GSTIN_RE.test(String(x.customerGstin || "").toUpperCase())) return null;
  const a = EINV.need(gstin), probs = EINV.problems(v, co, s.cfg);
  const go = (label, f) => async () => { setBusy(label); setMsg(""); try { setMsg(await f()); } catch (e) { setMsg((e && e.message) || String(e)); } setBusy(""); render(); };
  const active = x.irn && x.irnStatus !== "cancelled", canCancel = active && x.ackDt && Date.now() - Date.parse(x.ackDt) < 24 * 3600000;
  return <section data-einv={v.id}><h3>E-invoice and e-way bill</h3>
    {EINV.host === "sandbox" && <p className="note">The firm's server sends to the IRP's <b>sandbox</b> (test): an IRN made here is not a real one.</p>}
    {active ? <div className="bk-alert"><b>IRN</b> {x.irn}<div className="note">Ack. no. {x.ackNo} · {fmtDateTime(x.ackDt)}{x.ewayNo ? " · E-way bill " + x.ewayNo + (x.ewayValidTill ? ", valid till " + fmtDateTime(x.ewayValidTill) : "") : ""}</div></div>
      : x.irnStatus === "cancelled" ? <p className="note"><b>IRN cancelled</b> {x.irn}.</p> : null}
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
          if (!ok) return ""; await EINV.cancel(v, "2", "Cancelled from FinCom"); return "IRN cancelled.";
        })}>Cancel the IRN</button>}
      </>}
    {msg && <p className="note">{msg}</p>}
  </section>;
}

function Detail({ v }) {
  const s = SL(), x = v.x, co = CO(s.cid), ro = !["review", "ready"].includes(v.status);
  const lines = salesLines(v), tot = (side) => r2(lines.filter((l) => l.side === side).reduce((a, l) => a + l.amt, 0));
  const probs = (v.problems || []).concat(v.ledgerIssues || []), act = (a, force) => () => salesRowAct(a, v.id, force);
  const [cls, word] = STATUS[v.status] || ["no", v.status];
  return (
    <Panel wide title={<>Invoice {x.number || ""} <span className={"tag " + cls}>{word}</span></>} close={() => salesAct("salesClose")}>
      {probs.length > 0 && <div className="bk-alert bad">{probs.map((p, i) => <div key={i}>{p}</div>)}</div>}
      {v.postError && <div className="bk-alert bad">Tally: {v.postError}</div>}
      <section><h3>Invoice details</h3>
        <div className="bk-form">
          <Field x={x} ro={ro} label="Invoice number" k="number" /><Field x={x} ro={ro} label="Date" k="date" type="date" /><Field x={x} ro={ro} label="Customer name" k="customerName" /><Field x={x} ro={ro} label="Customer GSTIN" k="customerGstin" />
          <label><span>Place of supply</span><select value={x.pos || ""} disabled={ro} onChange={(ev) => salesSetField("pos", ev.target.value)}><States /></select></label>
          <Field x={x} ro={ro} label="Taxable value" k="taxable" type="number" /><Field x={x} ro={ro} label="CGST" k="cgst" type="number" /><Field x={x} ro={ro} label="SGST" k="sgst" type="number" /><Field x={x} ro={ro} label="IGST" k="igst" type="number" />
          <Field x={x} ro={ro} label="Cess" k="cess" type="number" /><Field x={x} ro={ro} label="Invoice total" k="total" type="number" />
        </div>
        {(x.items || []).length > 0 && <div className="bk-tablewrap" style={{ marginTop: 10 }}><table className="bk-table" data-statement="">
          <thead><tr><th>Item</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST %</th></tr></thead>
          <tbody>{x.items.map((it, i) => <tr key={i}><td>{it.desc}</td><td>{it.hsn || ""}</td><td className="n">{it.qty} {it.unit || ""}</td><td className="n">{money(num(it.rate))}</td><td className="n">{money(num(it.taxable))}</td><td className="n">{num(it.gstRate)}%</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section><h3>Sales voucher for Tally</h3>
        <div className="bk-form">
          <label><span>Customer ledger</span><LedgerBox value={v.customerLedger || ""} fk={"svcustd:" + v.id} data-svcust={v.id} disabled={ro} onCommit={(val) => salesSetCust(v.id, val)} /></label>
          {salesTotals(x).map((g) => <label key={g.rate}><span>Sales ledger {rateTag(g.rate)}%</span>
            <LedgerSelect selected={lines.find((l) => l.role === "sales" && l.rate === g.rate).ledger} prefer={/sales accounts?/i} disabled={ro} onPick={(val) => salesSetSalesLedger(g.rate, val)} /></label>)}
        </div>
        <div className="bk-tablewrap" style={{ marginTop: 10 }}><table className="bk-table" data-statement="">
          <thead><tr><th>Ledger</th><th className="n">Debit ₹</th><th className="n">Credit ₹</th></tr></thead>
          <tbody>
            {lines.map((l, i) => <tr key={i}><td>{l.ledger || <span className="src bad">not set</span>}{l.ledger && !exactLedger(l.ledger) && <> <span className="src bad">not in Tally</span></>}</td>
              <td className="n">{l.side === "Dr" ? INR.format(l.amt) : ""}</td><td className="n">{l.side === "Cr" ? INR.format(l.amt) : ""}</td></tr>)}
            <tr><td><b>Total</b></td><td className="n"><b>{INR.format(tot("Dr"))}</b></td><td className="n"><b>{INR.format(tot("Cr"))}</b></td></tr>
          </tbody>
        </table></div>
        <p className="note">Voucher type “{s.cfg.voucherType || "Sales"}” · bill-wise New Ref {x.number}{co.createOptional ? " · posted as Optional" : ""}</p>
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
        {!ro && <button className="btn" onClick={act("edit")}>{v.source === "created" ? "Edit invoice" : (x.items || []).length ? "Edit items" : "Enter items"}</button>}
        {!ro && <button className="btn" onClick={act("ignore")}>Ignore</button>}
        {v.status !== "posted" && <button className="btn danger" onClick={act("delete")}>Delete</button>}
      </section>
    </Panel>
  );
}

function SettingsPanel() {
  const s = SL(), c = s.cfg, co = CO(s.cid), home = stateOfGstin(co.gstin);
  const rates = Array.from(new Set(s.list.flatMap((v) => salesTotals(v.x).map((g) => g.rate)).concat([5, 18]))).sort((a, b) => a - b);
  return (
    <Panel title={"Sales settings — " + co.name} close={() => Drafts.guard("sales:settings", () => salesAct("salesSettingsClose"))}>
      {/* review 18: one section, saved with Save at its foot; the default ledgers are confirmed for every computer */}
      <Confirm id="sales:settings" label="Sales settings" stores={["salescfg"]} cid={s.cid}>
      <section><h3>Invoice numbers</h3>
        <div className="bk-form"><CfgField c={c} label="Series ({FY} = financial year)" k="series" ph="INV/{FY}/" /><CfgField c={c} label="Next number" k="next" /><CfgField c={c} label="Digits" k="pad" /></div>
        <p className="note">Next invoice: <b>{nextInvoiceNumber(new Date().toISOString().slice(0, 10)).number}</b></p></section>
      <section><h3>Your details on invoices</h3>
        <div className="bk-form">
          <CfgField c={c} label="Address" k="address" area /><CfgField c={c} label="Phone" k="phone" /><CfgField c={c} label="Email" k="email" />
          <CfgField c={c} label="Bank name" k="bankName" /><CfgField c={c} label="Account number" k="bankAc" /><CfgField c={c} label="IFSC" k="bankIfsc" /><CfgField c={c} label="Branch" k="bankBranch" />
          <CfgField c={c} label="Terms and conditions" k="terms" area /><CfgField c={c} label="Signatory (below the signature)" k="signatory" ph="Authorised Signatory" />
        </div>
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
          <label><span>Invoice date</span><input type="date" value={x.date || ""} onChange={(ev) => draftSet("date", ev.target.value)} /></label>
          <label><span>Credit period (days)</span><input type="number" min="0" value={x.dueDays || ""} onChange={(ev) => draftSet("dueDays", ev.target.value)} /></label>
          <DraftText x={x} label="Order / PO reference" k="poNo" /><DraftText x={x} label="E-way bill no. (optional)" k="ewayNo" /><DraftText x={x} label="IRN (if e-invoiced)" k="irn" />
        </div></section>
        <section className="si-card"><h3>Bill to</h3><div className="bk-form">
          <label><span>Customer ledger (Tally)</span><LedgerBox className={"lgbox" + (d.customerLedger ? " done" : "")} value={d.customerLedger || ""} fk="sdcust" data-sdcust="" placeholder="Type to search customers" onCommit={draftCust} /></label>
          <DraftText x={x} label="Name on invoice" k="customerName" /><DraftText x={x} label="GSTIN (blank if unregistered)" k="customerGstin" maxLength={15} /><DraftText x={x} label="Address" k="address" area />
          <label><span>Place of supply</span><select value={x.pos || ""} onChange={(ev) => draftSet("pos", ev.target.value)}><States /></select></label>
          {stateOfGstin(co.gstin) && x.pos ? <p className="note" style={{ margin: 0 }}>{d.inter ? <>Another state: <b>IGST</b> is charged.</> : <>Same state: <b>CGST + SGST</b> are charged.</>}</p>
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

export default function Sales() {
  const co = CO(), s = SL();
  if (!s || s.cid !== co.id) { loadSales(co.id); return <Loading what="sales invoices" />; }
  if (s.loading) return <Loading what="sales invoices" />;
  if (s.view === "create" && s.draft) return <Create />;
  ensureFileInputs();
  const tc = salesCounts(), all = s.list.filter((v) => v.status !== "ignored"), dates = all.map((v) => v.x.date).filter(Boolean).sort();
  const sum = (k) => r2(all.reduce((a, v) => a + num(v.x[k]), 0));
  // the three steps at the top, as on Purchase and Bank, also before the first invoice (review of 02-Oct-2026)
  const tabs = <div className="bk-tabs" role="tablist" data-sales-tabs="" style={{ marginBottom: 10 }}>{SALES_TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={s.filter === k} onClick={() => salesTabGo(k)}>{t} <span className="cnt">{tc[k]}</span></button>)}</div>;
  const head = <>
    {tabs}
    {s.busy && <BusyCard title="Working on sales…" detail={s.busy} />}
    {/* one row (round 3, 05-Oct-2026), the how-to on hover and behind How */}
    {!hasLedgerList() && (bridgeLive(co) ? <NoticeLine sev="info" text="Loading ledgers from Tally…" />
      : (B() && B().ledgersLoading) || (typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id)) ? <NoticeLine sev="info" text="Loading ledgers from FinCom’s cloud copy of the books…" />
      : <NoticeLine text="Tally ledgers are needed for Sales vouchers." how={Bridge.on() ? "Open " + Bridge.tallyName(co) + " in TallyPrime, or import the ledger list." : "Import the ledger list (Tally: Display More Reports → List of Accounts → Export), or connect FinCom Bridge."}>
        <button className="btn small" onClick={() => salesAct("ledPick")}>Import ledger list</button></NoticeLine>)}
    <div className="bk-head">
      {/* the page is named in the top bar (one heading, spec I); here only what it holds */}
      <div className="bk-id"><div className="bk-sub">{all.length} invoice{all.length === 1 ? "" : "s"}{all.length ? " · " + fmtDate(dates[0]) + " to " + fmtDate(dates[dates.length - 1]) : ""}</div></div>
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
          {bridgeLive(co) && <><button onClick={() => salesAct("salesSync")}>Refresh from Tally</button><button onClick={() => salesAct("salesFile")}>Create Tally file instead</button></>}
          <button onClick={() => salesAct("salesCsv")}>Download sales register (CSV)</button>
        </div></details>
      </div>
    </div>
  </>;
  if (!s.list.length) return <>
    <div className="bk sl">{head}
      <div className="bk-empty" id="salesDrop" tabIndex={0} role="button" onClick={() => salesAct("salesPick")} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); salesAct("salesPick"); } }}>
        <div className="bk-empty-ic">⤒</div><h2>No sales invoices yet</h2>
        <p className="note">Drop the invoices you issued (PDF or photo) here, or use <b>Upload invoices</b> at the top right, to turn them into Sales vouchers. To make a new GST invoice, use <b>Create invoice</b>: it is printed and posted in one go.</p>
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
      <ListTable name="sales" cols={salesCols(s, list, nSel)} rows={list} rowKey={(v) => v.id} prep={salesPrep} unit={["invoice", "invoices"]} of={s.list.length}
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
      {rows.some((v) => v.status === "review") && <button className="btn primary" onClick={() => salesAct("salesBulkConfirm")}>Confirm</button>}
      {rows.some((v) => ["review", "ready"].includes(v.status)) && <button className="btn" onClick={() => salesAct("salesBulkIgnore")}>Ignore</button>}
      <button className="btn" onClick={() => salesAct("salesBulkPrint")}>Print</button>
      {rows.every((v) => v.status !== "posted") && <button className="btn danger" onClick={() => salesAct("salesBulkDelete")}>Delete</button>}
    </>;
  } else {
    const confirmable = s.list.filter((v) => v.status === "review" && v.customerLedger && !(v.problems || []).length && !(v.ledgerIssues || []).length).length;
    left = <><span className="bk-stat"><b>{tc.review}</b> to review</span><span className="bk-stat"><b>{tc.ready}</b> ready to post</span></>;
    right = <>
      {confirmable > 0 && <button className="btn" onClick={() => salesAct("salesConfirmAll")}>Confirm all suggestions ({confirmable})</button>}
      {canPostTally(CO()) && postThroughWords(CO()) && <span className="note" data-post-through="">{postThroughWords(CO())}</span>}
      {canPostTally(CO()) ? <button className="btn primary" disabled={!tc.ready} onClick={() => salesAct("salesPost")}>Post to Tally ({tc.ready})</button>
        : <button className="btn primary" disabled={!tc.ready} onClick={() => salesAct("salesFile")}>Create Tally file ({tc.ready})</button>}
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
