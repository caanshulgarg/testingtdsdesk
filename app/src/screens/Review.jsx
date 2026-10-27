// Purchase bills many at a time: the review table, the drawer with one bill over it, and the bar at the bottom of the
// page (for the table, or for the bill that is open). Were viewReviewTable, reviewBar, drawerHtml (src/js/18) and
// actionBar (src/js/27). The column filters (funnel buttons, the chips and their pop-up) are still old pieces, shared
// with the bank and sales tables.
import { useRef } from "react";
import { useDismiss } from "../parts/dismiss.js";
import { ColFunnel } from "../parts/ColHead.jsx";
import ListTable from "../parts/ListTable.jsx";
import Msg from "../parts/Msg.jsx";
import BillDetail from "./Bill.jsx";
import { ChipBar } from "../parts/ChipBar.jsx";
import { EmptyNext } from "../parts/StateBar.jsx";
import QueueDone from "../parts/QueueDone.jsx";

const needsLook = (r) => notReadYet(r.e) || (r.c.missing || []).length || r.c.flags.some((f) => f.lvl === "hi") || r.e.confirmType;
const NO_TALLY = "Needs Tally open with this client's company and FinCom Bridge running (see the Tally sign at the top)";
const RuleOptions = () => rules().map((r) => <option key={r.id} value={r.id}>{r.label}</option>);


// the review list's columns (spec K6: date, number, party, amount, status, then the rest; ListTable.jsx puts them in
// that order); the row's figures are worked out once (prep)
const revPrep = ({ e, c }) => {
  const m = c.meter, led = e.expenseLedger || "";
  return { t: tallyYtdFor(c.party, fyOf(e.x.invoiceDate), e), m, over: m && m.limit && m.used + m.add > m.limit, miss: needsLook({ e, c }), led, ledOk: led && (!hasLedgerList() || exactLedger(led)) };
};
function revCols(rows, sel, nSel) {
  return [
    { k: "pick", role: "pick", cls: "ck", head: <input type="checkbox" aria-label="Select all shown" disabled={!rows.length} title={rows.length ? "Select all shown" : "No bill shown to select"} checked={!!nSel && nSel === rows.length} onChange={(ev) => revPickAll(ev.target.checked)} />,
      cell: ({ e }) => <input type="checkbox" checked={sel.has(e.id)} aria-label={"Select " + (e.x.vendorName || e.fileName || "bill")} onChange={(ev) => revPick(e.id, ev.target.checked)} /> },
    { k: "date", role: "date", label: "Date", cls: "dt", filter: <ColFunnel hideIdle t="rev" k="date" label="Date" />, v: ({ e }) => e.x.invoiceDate || "", cell: ({ e }) => e.x.invoiceDate ? shortDate(e.x.invoiceDate) : "—" },
    { k: "no", role: "number", label: "Bill no.", filter: <ColFunnel hideIdle t="rev" k="no" label="Bill no." />, v: ({ e }) => e.x.invoiceNo || "", cell: ({ e }) => e.x.invoiceNo || "—" },
    { k: "sup", role: "party", label: "Supplier", cls: "pt", filter: <ColFunnel hideIdle t="rev" k="sup" label="Supplier" />, v: ({ e }) => e.x.vendorName || e.fileName || "",
      cell: ({ e }, p) => <>
        <button className="linkbtn pn" title={e.x.vendorName || e.fileName || undefined} onClick={() => revOpen(e.id)}>{e.x.vendorName || e.fileName || "—"}</button>
        <div className="nr">{e.x.vendorGstin || e.x.vendorPan || "no GSTIN or PAN"}</div>
        <div className={"nr " + (p.ledOk ? "led-ok" : "led-bad")}>{p.led ? "→ " + p.led + (p.ledOk ? " ✓" : " · not in Tally") : "→ no ledger yet"}</div>
        {e.postFailedAt && e.postError && <div className="nr bad">Tally refused: <Msg text={e.postError} /></div>}
        {/* the reading service could not read it (review of 02-Oct-2026): why, and Retry; Type it in is the bill itself */}
        {notReadYet(e) && <div className="nr bad" data-notread="">{S.reading[e.id] ? "Reading again…" : <>Not read yet: {e.notRead.reason} <button className="linkbtn" onClick={() => retryNotRead(e.id)}>Retry</button></>}</div>}
        {e.noteKind && <div className="nr"><span className="tag">{e.noteKind === "credit" ? "Credit note → Debit Note in Tally" : "Debit note"}</span></div>}
      </> },
    { k: "val", role: "amount", label: "Value", cls: "n", filter: <ColFunnel hideIdle t="rev" k="val" label="Value" />, v: ({ e }) => num(e.x.total), cell: ({ e }) => money(num(e.x.total)) },
    // upload-pages: "Check" (as the list of bills one at a time says), not "Needs you", which was also the Tally chip's word
    { k: "st", role: "status", label: "Status", v: (r) => (needsLook(r) ? "Check" : "Ready to approve"),
      cell: (r, p) => <span className={"tag " + (p.miss ? "warn" : "ok")}>{p.miss ? "Check" : "Ready to approve"}</span> },
    { k: "nature", label: "Payment type", filter: <ColFunnel hideIdle t="rev" k="nature" label="Payment type" />, v: ({ c }) => (c.rule && c.rule.label) || "",
      cell: ({ e }) => <select value={e.natureId || ""} aria-label="Payment type" onChange={(ev) => revNature(e.id, ev.target.value)}><RuleOptions /></select> },
    { k: "tdson", label: "Book TDS", cls: "ck", filter: <ColFunnel hideIdle t="rev" k="tds" label="Book TDS" />, cell: ({ e, c }) => <input type="checkbox" aria-label="Book TDS" checked={c.tdsWould > 0 && !c.skip} disabled={!!(c.rule && c.rule.basis === "never")}
        title={c.rule && c.rule.basis === "never" ? "No TDS on this payment type: change the Payment type for TDS" : c.skip ? skipText(c.skip) : c.tdsWould > 0 ? "TDS is deducted on this bill" : "Below the limits: tick to deduct anyway"}
        onChange={(ev) => revTds(e.id, ev.target.checked)} /> },
    { k: "tds", label: "TDS", cls: "n", v: ({ c }) => num(c.tds), sum: ({ c }) => num(c.tds),
      cell: ({ c }) => c.tds ? <b>{money(c.tds)}</b> : c.tdsWould ? <span className="src muted">{money(c.tdsWould)} not booked</span> : "—" },
    { k: "look", label: "This year vs limit", filter: <ColFunnel hideIdle t="rev" k="look" label="This year vs limit" />, cell: (r, p) => !p.m || !p.m.limit ? <span className="src muted">no yearly limit</span> : <>
        <span className={p.over ? "src bad" : "src"}>{money0(p.m.used + p.m.add)} of {money0(p.m.limit)}{p.over ? " · crossed" : " · within"}</span>
        <span className="src muted">{p.t ? "incl. " + money0(p.t.credited) + " from Tally" : "bills here only"}</span></> },
    { k: "ac", role: "act", cls: "ac", cell: ({ e }, p) => <>
        {p.miss ? <button className="btn small" onClick={() => revOpen(e.id)}>Check</button> : <button className="btn small primary" onClick={() => revApproveOne(e.id)}>Approve</button>}
        <button className="icon" title="Open this bill" aria-label="Open this bill" onClick={() => revOpen(e.id)}>↗</button>
        <button className="icon danger" title="Delete this bill" aria-label="Delete this bill" onClick={() => billDelete(e.id)}>✕</button>
      </> },
  ];
}

// clean-up batch 3: the list fits the page at 1440; "This year vs limit" is under Columns (off until chosen; the bill
// itself shows the limit too). S.revCols: {key: true | false}, for this visit
const REV_OPTIONAL = [["look", "This year vs limit", false]];
const revColShown = (k) => { const o = REV_OPTIONAL.find((x) => x[0] === k); const v = S.revCols && S.revCols[k]; return o ? (v == null ? o[2] : !!v) : true; };
function RevColumns() {
  return <details className="colpick" data-rev-cols=""><summary className="btn small">Columns</summary>
    <div className="colpick-box">{REV_OPTIONAL.map(([k, label]) => <label key={k} className="chk"><input type="checkbox" checked={revColShown(k)} onChange={() => { S.revCols = Object.assign({}, S.revCols, { [k]: !revColShown(k) }); render(); }} /> {label}</label>)}</div></details>;
}

// To review, Duplicates and Deleted, with their counts: now in the one row of tabs at the top (TopBar.jsx; review of
// 02-Oct-2026: two rows of tabs, both with "To review"); kept for any page that has no tab row of its own
export function StatusFilters() {
  const all = Object.values(D().entries), cnt = (st) => all.filter((e) => e.status === st).length;
  const go = (st) => { S.filter = st; S.selected = null; render(); };
  return <nav className="sbar" aria-label="Bills" data-bill-filters="" style={{ margin: "0 0 10px" }}>
    {[["draft", "To review"], ["duplicate", "Duplicates"], ["deleted", "Deleted"]].map(([id, label]) =>
      <button key={id} aria-selected={S.filter === id} onClick={() => go(id)}>{label} <span className="sbar-n">{cnt(id)}</span></button>)}
  </nav>;
}

export function ReviewTable() {
  const all = draftRows(), rows = revFiltered();
  const sel = S.revSel = S.revSel || new Set();
  const nSel = rows.filter((r) => sel.has(r.e.id)).length;
  // upload-pages (14-Oct-2026): no heading of its own ("Review 0 uploaded bills" under "To review 0"): the state bar names
  // the list and counts it; the totals are at the table's foot. What to do is one line, and only when there are bills
  return (
    <div className="bk" data-review-list="">
      <QueueDone />
      {!all.length ? <EmptyNext what="No bills to review" note={Object.keys(D().entries).length ? "Every bill uploaded has been reviewed." : "Upload the client’s purchase bills: PDFs or photos, several at once."}
        act={() => doAct("uploadHere")} label="Upload bills" /> : <>
        <p className="note rev-how" data-rev-how="">Tick <b>Book TDS</b> on the bills to deduct TDS on, then approve them together.</p>
        <div className="revfilter">
          <input type="search" value={S.revQuery || ""} placeholder="Filter by supplier, bill no., GSTIN, ledger, payment type or amount" aria-label="Filter the bills"
            onChange={(ev) => { S.revQuery = ev.target.value; render(); }} />
          {S.revQuery && !revColOn() && <span className="note">{rows.length} of {all.length} shown</span>}
          <RevColumns />
          <button className="btn small" onClick={() => doAct("revList")}>One at a time</button>
        </div>
        <ChipBar t="rev" shown={rows.length} total={all.length + " bills"} />
        {/* the one list table (spec K6): column order, sorting, sticky header, the count and totals at the foot */}
        <ListTable name="rev" className="bk-table gf-off revtbl" cols={revCols(rows, sel, nSel).filter((c) => revColShown(c.k))} rows={rows} rowKey={(r) => r.e.id} prep={revPrep} unit={["bill", "bills"]} of={all.length}
          rowProps={(r, p) => ({ className: [sel.has(r.e.id) && "picked", p.miss && "needs", S.drawerOpen && S.selected === r.e.id && "open"].filter(Boolean).join(" ") || undefined })}
          empty={<>No bill matches the filter. <button className="linkbtn" onClick={() => { S.revQuery = ""; colChipAll("rev"); }}>Clear the filters</button> to see all {all.length}.</>} />
      </>}
    </div>
  );
}

// clean-up batch 3: the bar is one row; why nothing can be approved, and why the Tally check waits, sit behind one (i)
// (data-why: the disabled buttons' reasons are said here, so parts/WhyNotes.jsx adds no line of its own)
function Why({ none, tally }) {
  if (!none && !tally) return null;
  return <details className="ab-why" data-why="" data-ab-why="">
    <summary title={[none, tally && NO_TALLY].filter(Boolean).join(". ")}><i className="ab-i" aria-hidden="true">i</i><span className="ab-why-w">{none ? "Why nothing is ready" : "Why the check waits"}</span></summary>
    <div className="ab-why-pop" role="note">{none && <div className="none-ready" data-none-ready="">{none}</div>}{tally && <div className="note">{NO_TALLY}.</div>}</div>
  </details>;
}

function ReviewBar() {
  const rows = draftRows(), sel = S.revSel || new Set(), live = bridgeLive();
  const picked = rows.filter((r) => sel.has(r.e.id)), ready = rows.filter((r) => !needsLook(r));
  // round 14c (C1): when no bill is ready, the bulk Approve says why in plain words, counted from the drafts' missing lists
  const noneReady = (list) => list.length && !list.some((r) => !(r.c.missing || []).length) ? noneReadyWords(list) : "";
  if (picked.length) return (
    <div className="actionbar bk-actionbar">
      <div className="ab-left"><b>{picked.length} selected</b> <span className="muted">· TDS {money(r2(picked.reduce((a, r) => a + num(r.c.tds), 0)))}</span> <button className="linkbtn" onClick={() => doAct("revNone")}>Clear</button>
        <Why none={noneReady(picked)} tally={!live} /></div>
      <div className="ab-right">
        <button className="btn" onClick={() => doAct("revTdsOn")}>Book TDS</button>
        <button className="btn" onClick={() => doAct("revTdsOff")}>Do not book TDS</button>
        {/* the destructive one away from the primary (spec K2) */}
        <button className="btn danger" style={{ marginRight: 18 }} onClick={() => doAct("revDelete")}>Delete {picked.length}</button>
        <button className="btn" disabled={!live} title={!live ? NO_TALLY : undefined} onClick={() => doAct("revCheckTally")}>Check year in Tally</button>
        <button className="btn primary" onClick={() => doAct("revApprove")}>Approve {picked.length}</button>
      </div>
    </div>
  );
  return (
    <div className="actionbar bk-actionbar">
      {/* upload-pages: the count of bills to review is the state bar's; the Approve button counts the ones ready */}
      <div className="ab-left"><Why none={!ready.length && noneReady(rows)} tally={!live} /></div>
      <div className="ab-right">
        <button className="btn" disabled={!live} title={!live ? NO_TALLY : undefined} onClick={() => doAct("revCheckTallyAll")}>Check the year in Tally for all</button>
        <button className="btn primary" disabled={!ready.length} title={!ready.length ? (noneReady(rows) || "No bill is ready to approve yet") : undefined} onClick={() => doAct("revApproveAll")}>Approve all that are ready ({ready.length})</button>
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
    // ui-tidy: what is still to fill in is said once, in the line beside Approve ("Cannot approve: …", each item a click to
    // its box); To do keeps the buttons
    const other = c.missing.filter((m) => !/payment type|duplicate/.test(m));
    if (other.length) todo.push(["fill", <span className="missing" data-fill-n={other.length}>{"Fill in " + other.length + (other.length === 1 ? " box" : " boxes")}</span>]);
    const items = todo.map(([k, el]) => <span key={k} style={{ display: "contents" }}>{el} </span>);
    left = todo.length && !todo.every((t) => t[2]) ? <><b>To do:</b> {items}</>
      : <><span className="tag ok">Ready to approve</span> <span className="note">{c.skip ? "No TDS booked (would be " + money0(c.tdsWould) + ")" : "TDS " + money(c.tds)} · {c.rule.label}</span> {items}</>;
    // round 14c (C1, C2): a disabled Approve says why in plain words beside it (the title too); an item that is a box on
    // the bill is a click to it (focusBillField)
    const cannot = c.missing.length > 0 && <div className="cannot-approve" data-cannot-approve="" title={"Cannot approve: " + c.missing.join(", ")}>{"Cannot approve: "}
      {c.missing.map((m, i) => { const k = missingField(m);
        return <span key={m}>{i ? ", " : ""}{k ? <button type="button" className="linkbtn" data-focus-field={k} onClick={() => focusBillField(k)}>{m}</button> : m}</span>; })}</div>;
    right = <>
      <button className="btn" onClick={() => doAct("reject")}>No entry needed</button>
      {/* ui-tidy: what stops Approve is said once, in one line beside it (it was also the button's tip) */}
      <span className="approve-wrap" style={{ display: "inline-flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
        {cannot}
        <button className="btn primary" disabled={c.missing.length > 0} onClick={() => doAct("approve")}>Approve <kbd>Ctrl+Enter</kbd></button>
      </span>
      {next}
    </>;
  } else if (e.status === "duplicate") {
    left = <><span className="tag warn">Held as duplicate</span> <span className="note">{(e.dupOf && e.dupOf.msg) || ""}</span></>;
    right = <>
      <button className="btn danger" onClick={() => doAct("delete")}>Delete this one</button>
      {e.dupOf && e.dupOf.entryId && D().entries[e.dupOf.entryId] && <button className="btn" onClick={() => doAct("openOriginal")}>Open the original</button>}
      <button className="btn" onClick={() => doAct("notDup")}>Keep both</button>{next}
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
  // nothing to review: the empty state's one step, no bar of greyed buttons
  if (S.reviewTable && S.filter === "draft" && !drawerEntry()) return draftRows().length ? <ReviewBar /> : null;
  const e = S.selected && D().entries[S.selected];
  return e && !S.reading[e.id] ? <BillBar e={e} /> : null;
}

// one bill over the review table; it slides in only when it opens (its host is kept while it stays open)
export function Drawer() {
  const first = useRef(true), enter = first.current ? " enter" : "", box = useRef(null);
  first.current = false;
  const e = drawerEntry();
  // the action bar under it works on the open bill (Approve, "Cannot approve: invoice date" leads into the drawer): inside
  // next-fix-drawers (the owner, 22-Oct-2026: "If I click on the main screen also.. it should close right away"): closing
  // never asks; what is unsaved on the page stays as it is (Drafts keeps it), only the drawer goes
  useDismiss(!!e, box, () => doAct("drawerClose"),
    { also: () => Array.from(document.querySelectorAll("#app .actionbar")) });
  if (!e) return null;
  const rows = draftRows(), i = rows.findIndex((r) => r.e.id === e.id);
  // a click outside, Esc and (a phone) Back close it, at once
  const close = () => doAct("drawerClose");
  return <>
    <button className={"drawer-scrim" + enter} aria-label="Close" onClick={close}></button>
    <aside ref={box} className={"drawer" + enter} role="dialog" aria-modal="true" aria-label="Bill">
      <div className="drawer-head">
        {/* ui-tidy: the bill's name is its card's title, once; here its number and place in the list */}
        <div><span className="note" data-drawer-pos="">{e.x.invoiceNo || e.fileName || "Bill"}{i >= 0 ? " · " + (i + 1) + " of " + rows.length : ""}</span></div>
        <button className="btn small" onClick={close}>Close</button>
      </div>
      <BillDetail id={e.id} />
    </aside>
  </>;
}
