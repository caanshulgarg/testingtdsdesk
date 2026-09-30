// Purchase bills many at a time: the review table, the drawer with one bill over it, and the bar at the bottom of the
// page (for the table, or for the bill that is open). Were viewReviewTable, reviewBar, drawerHtml (src/js/18) and
// actionBar (src/js/27). The column filters (funnel buttons, the chips and their pop-up) are still old pieces, shared
// with the bank and sales tables.
import { useRef } from "react";
import ColHead from "../parts/ColHead.jsx";
import BillDetail from "./Bill.jsx";
import { ChipBar } from "../parts/ChipBar.jsx";

const needsLook = (r) => (r.c.missing || []).length || r.c.flags.some((f) => f.lvl === "hi") || r.e.confirmType;
const RuleOptions = () => rules().map((r) => <option key={r.id} value={r.id}>{r.label}</option>);


function Row({ e, c, sel }) {
  const t = tallyYtdFor(c.party, fyOf(e.x.invoiceDate), e), m = c.meter;
  const over = m && m.limit && m.used + m.add > m.limit;
  const miss = needsLook({ e, c });
  const led = e.expenseLedger || "", ledOk = led && (!hasLedgerList() || exactLedger(led));
  return (
    <tr className={[sel && "picked", miss && "needs", S.drawerOpen && S.selected === e.id && "open"].filter(Boolean).join(" ")}>
      <td className="ck"><input type="checkbox" checked={sel} aria-label={"Select " + (e.x.vendorName || e.fileName || "bill")} onChange={(ev) => revPick(e.id, ev.target.checked)} /></td>
      <td className="dt">{e.x.invoiceDate ? shortDate(e.x.invoiceDate) : "—"}</td>
      <td className="pt">
        <button className="linkbtn pn" onClick={() => revOpen(e.id)}>{e.x.vendorName || e.fileName || "—"}</button>
        <div className="nr">{e.x.vendorGstin || e.x.vendorPan || "no GSTIN or PAN"}</div>
        <div className={"nr " + (ledOk ? "led-ok" : "led-bad")}>{led ? "→ " + led + (ledOk ? " ✓" : " · not in Tally") : "→ no ledger yet"}</div>
        {e.postFailedAt && e.postError && <div className="nr bad">Tally refused: {e.postError}</div>}
        {e.noteKind && <div className="nr"><span className="tag">{e.noteKind === "credit" ? "Credit note → Debit Note in Tally" : "Debit note"}</span></div>}
      </td>
      <td>{e.x.invoiceNo || "—"}</td>
      <td className="n">{INR.format(num(e.x.total))}</td>
      <td><select value={e.natureId || ""} aria-label="Payment type" onChange={(ev) => revNature(e.id, ev.target.value)}><RuleOptions /></select></td>
      <td className="ck"><input type="checkbox" aria-label="Book TDS" checked={c.tdsWould > 0 && !c.skip} disabled={!!(c.rule && c.rule.basis === "never")}
        title={c.skip ? skipText(c.skip) : c.tdsWould > 0 ? "TDS is deducted on this bill" : "Below the limits: tick to deduct anyway"}
        onChange={(ev) => revTds(e.id, ev.target.checked)} /></td>
      <td className="n">{c.tds ? <b>{INR.format(c.tds)}</b> : c.tdsWould ? <span className="src muted">{INR.format(c.tdsWould)} not booked</span> : "—"}</td>
      <td>{!m || !m.limit ? <span className="src muted">no yearly limit</span> : <>
        <span className={over ? "src bad" : "src"}>{money0(m.used + m.add)} of {money0(m.limit)}{over ? " · crossed" : " · within"}</span>
        <span className="src muted">{t ? "incl. " + money0(t.credited) + " from Tally" : "bills here only"}</span></>}</td>
      <td className="ac">
        {miss ? <button className="btn small" onClick={() => revOpen(e.id)}>Check</button> : <button className="btn small primary" onClick={() => revApproveOne(e.id)}>Approve</button>}
        <button className="icon" title="Open this bill" aria-label="Open this bill" onClick={() => revOpen(e.id)}>↗</button>
        <button className="icon danger" title="Delete this bill" aria-label="Delete this bill" onClick={() => billDelete(e.id)}>✕</button>
      </td>
    </tr>
  );
}

export function ReviewTable() {
  const co = CO(), all = draftRows(), rows = revFiltered();
  const sel = S.revSel = S.revSel || new Set();
  const nSel = rows.filter((r) => sel.has(r.e.id)).length;
  const sum = (f) => INR.format(r2(rows.reduce((a, r) => a + num(f(r)), 0)));
  return (
    <div className="bk">
      <div className="bk-head">
        <div className="bk-id"><h2 className="bk-title">Review {rows.length} uploaded bill{rows.length === 1 ? "" : "s"}</h2><div className="bk-sub">{co.name} · tick the ones to book TDS on, then approve together</div></div>
        <dl className="bk-figs"><div><dt>Bills</dt><dd>{rows.length}</dd></div><div><dt>Value</dt><dd>{sum((r) => r.e.x.total)}</dd></div><div><dt>TDS</dt><dd>{sum((r) => r.c.tds)}</dd></div></dl>
        <div className="bk-actions"><button className="btn small" onClick={() => doAct("revList")}>One at a time</button></div>
      </div>
      {!rows.length && !all.length ? <div className="bk-none" style={{ background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: 10 }}>Nothing waiting. Upload bills above.</div> : <>
        <div className="revfilter">
          <input type="search" value={S.revQuery || ""} placeholder="Filter by supplier, bill no., GSTIN, ledger, payment type or amount" aria-label="Filter the bills"
            onChange={(ev) => { S.revQuery = ev.target.value; render(); }} />
          {S.revQuery && !revColOn() && <span className="note">{rows.length} of {all.length} shown</span>}
        </div>
        <ChipBar t="rev" shown={rows.length} total={all.length + " bills"} />
        <div className="bk-tablewrap"><table className="bk-table revtbl">
          <thead><tr>
            <th className="ck"><input type="checkbox" aria-label="Select all shown" checked={!!nSel && nSel === rows.length} onChange={(ev) => revPickAll(ev.target.checked)} /></th>
            <ColHead t="rev" k="date" label="Date" cls="dt" /><ColHead t="rev" k="sup" label="Supplier" /><ColHead t="rev" k="no" label="Bill no." /><ColHead t="rev" k="val" label="Value" cls="n" />
            <ColHead t="rev" k="nature" label="Payment type" /><ColHead t="rev" k="tds" label="TDS" cls="ck" /><th className="n">TDS</th><ColHead t="rev" k="look" label="This year vs limit" /><th className="ac"></th>
          </tr></thead>
          <tbody>{rows.map((r) => <Row key={r.e.id} e={r.e} c={r.c} sel={sel.has(r.e.id)} />)}</tbody>
        </table></div>
        {!rows.length && <p className="empty">No bill matches the filter.</p>}
      </>}
    </div>
  );
}

function ReviewBar() {
  const rows = draftRows(), sel = S.revSel || new Set(), live = bridgeLive();
  const picked = rows.filter((r) => sel.has(r.e.id)), ready = rows.filter((r) => !needsLook(r));
  if (picked.length) return (
    <div className="actionbar bk-actionbar">
      <div className="ab-left"><b>{picked.length} selected</b> <span className="muted">· TDS {INR.format(r2(picked.reduce((a, r) => a + num(r.c.tds), 0)))}</span> <button className="linkbtn" onClick={() => doAct("revNone")}>Clear</button></div>
      <div className="ab-right">
        <button className="btn" onClick={() => doAct("revTdsOn")}>Book TDS</button>
        <button className="btn" onClick={() => doAct("revTdsOff")}>Do not book TDS</button>
        <button className="btn" disabled={!live} onClick={() => doAct("revCheckTally")}>Check year in Tally</button>
        <button className="btn danger" onClick={() => doAct("revDelete")}>Delete {picked.length}</button>
        <button className="btn primary" onClick={() => doAct("revApprove")}>Approve {picked.length}</button>
      </div>
    </div>
  );
  return (
    <div className="actionbar bk-actionbar">
      <div className="ab-left"><span className="bk-stat"><b>{rows.length}</b> to review</span><span className="bk-stat"><b>{ready.length}</b> ready to approve</span></div>
      <div className="ab-right">
        <button className="btn" disabled={!live} onClick={() => doAct("revCheckTallyAll")}>Check the year in Tally for all</button>
        <button className="btn primary" disabled={!ready.length} onClick={() => doAct("revApproveAll")}>Approve all that are ready ({ready.length})</button>
      </div>
    </div>
  );
}

const B = ({ act, children, ...p }) => <button className="btn small" onClick={() => doAct(act)} {...p}>{children}</button>;

// what is left to do on the open bill, and its buttons
function BillBar({ e }) {
  const drafts = Object.values(D().entries).filter((o) => o.status === "draft" && o.id !== e.id);
  const next = drafts.length > 0 && <button className="btn" onClick={() => doAct("nextBill")}>Next bill →</button>;
  let left, right;
  if (e.status === "draft") {
    const c = compute(e), todo = [];   // [key, element, only about TDS/GST (does not stop "Ready to approve")]
    if (e.uncertain && e.uncertain.length) todo.push(["unsure", <><B act="fieldsOk">Fields look right</B><span className="note">{e.uncertain.length} amber field{e.uncertain.length > 1 ? "s" : ""}</span></>]);
    if (e.confirmType && !(c.party && c.party.natureDefault) && !c.skip) todo.push(["type", <B act="confirmType">Confirm payment type: {c.rule.label}</B>]);
    if (c.dup && c.dup.strong) todo.push(["dup", <B act="notDup">It is a different bill</B>]);
    if (c.gd.rcmSuggest) todo.push(["rcm", <><span className="tag warn" title={catLabel(RCM_CATS, c.gd.rcmSuggest.cat)}>RCM?</span><B act="rcmApply">Apply</B><B act="rcmDismiss">No</B></>, true]);
    if (c.gd.blockSuggest) todo.push(["block", <><span className="tag warn" title={catLabel(BLOCK_CATS, c.gd.blockSuggest.cat) + ": " + c.gd.blockSuggest.why}>Blocked credit?</span><B act="blockAccept">Block</B><B act="blockReject">Allow</B></>, true]);
    if (c.tdsWould > 0 && !c.skip) todo.push(["skip", <B act="skipTds" title="Approve this bill without a TDS line">Don’t book TDS</B>, true]);
    if (c.skip) todo.push(["book", <><span className="tag warn" title={skipText(c.skip)}>TDS not booked</span><B act="bookTds">Book TDS {money0(c.tdsWould)}</B></>, true]);
    const other = c.missing.filter((m) => !/payment type|duplicate/.test(m));
    if (other.length) todo.push(["fill", <span className="missing">Fill in: {other.join(", ")}</span>]);
    const items = todo.map(([k, el]) => <span key={k} style={{ display: "contents" }}>{el} </span>);
    left = todo.length && !todo.every((t) => t[2]) ? <><b>To do:</b> {items}</>
      : <><span className="tag ok">Ready to approve</span> <span className="note">{c.skip ? "No TDS booked (would be " + money0(c.tdsWould) + ")" : "TDS " + money(c.tds)} · {c.rule.label}</span> {items}</>;
    right = <>
      <button className="btn" onClick={() => doAct("reject")}>No entry needed</button>
      <button className="btn primary" disabled={c.missing.length > 0} title={c.missing.length ? "Still needed: " + c.missing.join(", ") : undefined} onClick={() => doAct("approve")}>Approve <kbd>Ctrl+A</kbd></button>
      {next}
    </>;
  } else if (e.status === "duplicate") {
    left = <><span className="tag warn">Held as duplicate</span> <span className="note">{(e.dupOf && e.dupOf.msg) || ""}</span></>;
    right = <>
      <button className="btn danger" onClick={() => doAct("delete")}>Delete this copy</button>
      {e.dupOf && e.dupOf.entryId && D().entries[e.dupOf.entryId] && <button className="btn" onClick={() => doAct("openOriginal")}>Open the earlier bill</button>}
      <button className="btn" onClick={() => doAct("notDup")}>It is a different bill</button>{next}
    </>;
  } else if (e.status === "approved") {
    left = <><span className="tag ok">Approved</span> <span className="note">{e.exportedAt ? "Sent to Tally" : "Waiting in Send to Tally"}</span></>;
    right = <>{!e.exportedAt && <><button className="btn" onClick={() => doAct("undo")}>Undo approval</button><button className="btn" onClick={() => doAct("goExport")}>Send to Tally</button></>}{next}</>;
  } else {
    left = <span className="tag no">No entry</span>;
    right = <><button className="btn" onClick={() => doAct("restore")}>Move back to review</button>{next}</>;
  }
  return <div className="actionbar"><div className="ab-left">{left}</div><div className="ab-right">{right}</div></div>;
}

// the bar at the bottom of the purchase bills: for the review table, or for the bill that is open
export function ActionBar() {
  if (S.reviewTable && S.filter === "draft" && !drawerEntry()) return <ReviewBar />;
  const e = S.selected && D().entries[S.selected];
  return e && !S.reading[e.id] ? <BillBar e={e} /> : null;
}

// one bill over the review table; it slides in only when it opens (its host is kept while it stays open)
export function Drawer() {
  const first = useRef(true), enter = first.current ? " enter" : "";
  first.current = false;
  const e = drawerEntry();
  if (!e) return null;
  const rows = draftRows(), i = rows.findIndex((r) => r.e.id === e.id);
  const close = () => doAct("drawerClose");
  return <>
    <button className={"drawer-scrim" + enter} aria-label="Close" onClick={close}></button>
    <aside className={"drawer" + enter} role="dialog" aria-modal="true" aria-label="Bill">
      <div className="drawer-head">
        <div><b>{e.x.vendorName || e.fileName || "Bill"}</b><span className="note">{e.x.invoiceNo || ""}{i >= 0 ? " · " + (i + 1) + " of " + rows.length : ""}</span></div>
        <button className="btn small" onClick={close}>Close</button>
      </div>
      <BillDetail id={e.id} />
    </aside>
  </>;
}
