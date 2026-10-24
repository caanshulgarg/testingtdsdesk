// A client's bank statement: every line gets a Tally ledger (suggested by rules and past choices, or set by hand),
// then goes to Tally. Was viewBank (src/js/22), bankTable, bankRowHtml, viewBankGroups and bankBar (src/js/23).
//
// State: B() is the open client's bank data (S.bank): rows, statements (stmts, cur), what is ticked (sel), the
// search (q), the tab (filter), how many lines are drawn (limit), the last change that can be undone (undo).
// A line's state is attention (no ledger) → suggested → ready → sent (in Tally), or intally / ignored.
// The actions are in src/js/22-23: bankAct("bankPost"), bankRowAct("accept", id), bankSetLedger(id, name), …
//
// The checks over a statement are parts/BankChecks.jsx; the rules tab and the settings panel parts/BankSettings.jsx.
// The filter bar (search, quick chips UPI / IMPS / NEFT ... with counts, In / Out, unassigned, more filters, select all
// shown, a rule from the filter), the bulk voucher type and narration and the keys are parts/bank/ (24-Oct-2026).
import More from "../parts/More.jsx";
import Msg from "../parts/Msg.jsx";
import { useRef, useEffect, useState } from "react";
import SmartBar from "../parts/bank/SmartBar.jsx";
import { smartRows, selectAll, setVtype, vtypeOf, VTYPES, bulkVtype, bulkNarr, kbKey, kbChange, splitSave, splitClear } from "../parts/bank/smart.js";
import "../parts/bank/bankSmart.css";
import { BankSettings, RulesPanel } from "../parts/BankSettings.jsx";
import { PostReport, FixBanner, BankBalance, Recon, Gone, DupFind, BankFocus } from "../parts/BankChecks.jsx";
import { ColFunnel } from "../parts/ColHead.jsx";
import ListTable from "../parts/ListTable.jsx";
import Loading from "../parts/Loading.jsx";
import LedgerBox from "../parts/LedgerBox.jsx";
import { BankLedger } from "../parts/Confirm.jsx";
import { BusyCard } from "../parts/Reading.jsx";
import NoticeLine from "../parts/NoticeLine.jsx";
import { AutoChip, AutoWhy, AutoUndo, AutoFilter, apRows, apView, isAuto } from "../parts/AutoPost.jsx";
import { loadAP } from "../lib/autopostBoot.js";

const MODE_NAME = { ATM: "ATM cash withdrawal", CASH: "Cash deposit", CHARGES: "Bank charges", INTEREST: "Interest credit" };
// an empty tab says what to do next (spec K6, round 2)
const EMPTY = { review: "Nothing to review: every line has its ledger, and waits under Ready to post.", ready: "Nothing ready to post. Give each line under To review its ledger; it then waits here.",
  done: "Nothing in Tally yet. Post the lines under Ready to post.", ignored: "No line ignored." };
const live = () => Bridge.on() && Bridge.up();


function RowLedger({ r }) {
  const b = B(), tip = r.why || undefined;
  if (!["attention", "suggested", "ready"].includes(r.state)) {
    const canUndo = r.state === "sent" && r.tally && r.tally.guid && live();
    // with no Tally ledger chosen for the account, a line is not said to be gone from Tally (review of 02-Oct-2026)
    const noLed = !bankLedgerReady(CO(), accountFor(curStmt() || {}));
    // round 15 (B1): bridge 2.1.8 said Tally's voucher id (or the batch's last id) when the line went: that, with the
    // company, the time in IST and who pressed Post; an older line as before
    const mark = r.state === "sent" && !r.goneFromTally && typeof postMarkOf === "function" ? postMarkOf(r) : null, words = mark ? postMarkWords(mark) : "";
    const matched = r.state === "sent" && typeof postMatched === "function" ? postMatched(r.id, b.cid) : null;
    const status = r.goneFromTally && noLed ? "Not found in Tally · choose this account’s Tally ledger to check and post"
      : r.goneFromTally ? "Not in Tally any more (deleted there?) · " + (r.state === "intally" ? "was found when reconciling" : "posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : ""))
      : words ? words + (r.checking ? " · checking in Tally…" : "")
      // round 17a: posted by Tally's reply (bridge 2.1.8 does not read back) and no id came with it: posted, not "not found"
      : r.state === "sent" && r.postByReply === true && !bankMatched(r) ? "Posted to Tally (Tally's reply) · " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "")
      : r.state === "sent" && !bankMatched(r) ? (r.postedVia === "bridge" ? "Sent to Tally " : "In a Tally file ") + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.checking ? " · checking in Tally…" : " · not found in Tally yet")
      : r.state === "sent" ? "In Tally · posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.tally && r.tally.number ? " · voucher " + r.tally.number : "")
      : r.state === "intally" ? "Already in Tally" + (r.tallyRef ? ": " + r.tallyRef : "") + (r.tallyHow ? " (" + r.tallyHow + ")" : "") : "Ignored";
    return <><span className="lgtext">{r.ledger || "—"}</span><span className="src muted" data-posted-line={words ? "" : undefined} data-batch-n={mark && mark.batchN || undefined}>{status}
      {matched && <> <span className="tag ok" data-matched="">Matched with Tally</span></>}
      {canUndo && !isAuto(r) && <> <button className="linkbtn" onClick={() => bankRowAct("unpost", r.id)}>Take it back</button></>}</span>
      {isAuto(r) && <div><AutoChip x={r} /></div>}</>;
  }
  const held = b.postedTags && String(b.postedTags[fpHash(r.fp || r.id)] || "").startsWith("unconfirmed");
  const rule = r.ruleId && (allRules().find((x) => x.id === r.ruleId) || { name: "gone" });
  const said = r.state === "suggested" ? "Suggested · " + (r.srcLabel || "Match") : r.state === "ready" ? (r.source === "you" || r.userSet ? "Set by you" : r.srcLabel || "Confirmed")
    : hasLedgerList() ? "No match found" : "Import the ledger list";
  return <>
    {r.state === "ready" && r.postError && <span className="src bad" title={r.postError}>Tally: {r.postError}
      {held && <> <button className="linkbtn" onClick={() => bankRowAct("notintally", r.id)}>I checked — it is not in Tally</button></>}</span>}
    <div className="bs-led">
      <LedgerBox className={"lgbox" + (r.state === "suggested" ? " sugg" : r.state === "ready" ? " done" : "")} value={r.ledger || ""}
        fk={"bled:" + r.id} data-bled={r.id} placeholder="Select ledger" aria-label={"Ledger for " + (r.dec.name || r.narr.slice(0, 30))}
        title={said + (tip ? " · " + [].concat(tip).join(" ") : "")} onCommit={(v) => bankSetLedger(r.id, v)} />
      {/* a suggestion is accepted in one click, beside it (the old Confirm, moved from the buttons) */}
      {r.state === "suggested" && <button className="btn small primary bs-ok" data-accept={r.id} title={"Accept: " + said} onClick={() => bankRowAct("accept", r.id)}>Confirm</button>}
    </div>
    <span className={"src" + (r.state === "ready" ? " ok" : r.state === "attention" ? " muted" : "")} title={tip}>{said}{r.state === "ready" && r.billRef ? " · Bill " + r.billRef : ""}</span>
    {/* the rule's name opens it in the old rule editor */}
    {rule && <span className="src" data-legacy=""><button className="linkbtn" data-redit={r.ruleId}>rule: {ruleLabel(rule)}</button></span>}
    {r.tdsAtPay > 0 && <span className="src">TDS {money(r.tdsAtPay)} deducted at payment</span>}
    {isAuto(r) ? <AutoChip x={r} /> : <AutoWhy x={r} />}
    {(r.splits || []).length > 0 && <span className="src">split: {r.splits.map((sp) => sp.ledger + " " + money(sp.amt)).join(", ")}</span>}
  </>;
}

function RowActions({ r }) {
  const act = (a) => () => bankRowAct(a, r.id);
  if (isAuto(r)) return <AutoUndo x={r} />;
  // 24-Oct-2026: one line to several ledgers (opens under the line)
  const split = <button className="linkbtn" data-split={r.id} title="Split this line into several ledgers" onClick={() => { const b = B(); b.splitOpen = b.splitOpen === r.id ? null : r.id; render(); }}>Split</button>;
  const rule = <>{split}<button className="linkbtn" title="Make a rule from this line" onClick={act("rule")}>Rule</button></>;
  const ignore = <button className="icon" title="Ignore this entry" aria-label="Ignore" onClick={act("ignore")}>✕</button>;
  if (r.state === "suggested") return <>{rule}{ignore}</>;
  if (r.state === "ready") return <>{live() && <><button className="btn small" onClick={act("post")}>Post</button> </>}{rule} <button className="linkbtn" onClick={act("unready")}>Undo</button></>;
  if (r.state === "attention") return <>{rule}{ignore}</>;
  return r.state === "sent" ? null : <button className="linkbtn" onClick={act("restore")}>Restore</button>;
}

// the statement's lines (spec K6: date, number, party, amount, status, then the rest, in ListTable.jsx's order)
const BST = { attention: ["warn", "No ledger"], suggested: ["warn", "Suggested"], ready: ["ok", "Ready to post"], sent: ["ok", "In Tally"], intally: ["no", "Already in Tally"], ignored: ["no", "Ignored"] };
const bankParty = (r) => MODE_NAME[r.dec.mode] || r.dec.name || r.dec.upi || "";
function bankCols(b, rows, nSel) {
  const pickable = rows.filter((r) => r.state !== "sent"), total = pickable.length;
  const flag = (r) => r.balOk === false ? <> <span className="flag bad" title="This entry does not agree with the running balance">!</span></>
    : r.repaired ? <> <span className="flag warn" title="Amount read from the balance change: check it">≈</span></> : null;
  return [
    // the head's tick: every line the filters show (not only the ones drawn)
    { k: "pick", role: "pick", cls: "ck", head: <input type="checkbox" aria-label="Select all" checked={!!nSel && nSel === total} onChange={(ev) => selectAll(pickable, ev.target.checked)} />,
      cell: (r) => <input type="checkbox" aria-label="Select" checked={b.sel.has(r.id)} disabled={r.state === "sent"} onChange={() => {}} onClick={(ev) => bankToggleRow(r.id, ev.target.checked, ev.shiftKey)} /> },
    { k: "date", role: "date", label: "Date", cls: "dt", filter: <ColFunnel hideIdle t="bank" k="date" label="Date" />, v: (r) => r.date || "", td: (r) => ({ title: fmtDate(r.date) }), cell: (r) => shortDate(r.date) },
    // the whole narration, two lines at most (all of it on hover), the party read from it first and the mode and reference
    // in small letters (24-Oct-2026: one line of 60 letters and a second of the narration cut short, 69 px a row)
    { k: "narr", role: "party", label: "Particulars", cls: "pt", filter: <ColFunnel hideIdle t="bank" k="narr" label="Particulars" />, v: (r) => bankParty(r) || r.narr || "", cell: (r) => {
      const party = bankParty(r), sub = [r.dec.mode !== "OTHER" ? r.dec.mode : "", r.dec.chq ? "Chq " + r.dec.chq : r.dec.utr || ""].filter(Boolean).join(" · ");
      return <div className="bs-narr" title={r.narr}>{party && <b className="pn">{party}</b>}{sub && <span className="md">{sub}</span>}<span className="nr">{r.narr}</span></div>; } },
    { k: "wd", role: "amount", label: "Withdrawal", cls: "n", filter: <ColFunnel hideIdle t="bank" k="wd" label="Withdrawal" />, v: (r) => num(r.debit) || null, sum: (r) => num(r.debit), cell: (r) => <>{bkAmt(r.debit)}{r.debit ? flag(r) : null}</> },
    { k: "dep", role: "amount", label: "Deposit", cls: "n", filter: <ColFunnel hideIdle t="bank" k="dep" label="Deposit" />, v: (r) => num(r.credit) || null, sum: (r) => num(r.credit), cell: (r) => <>{bkAmt(r.credit)}{r.credit ? flag(r) : null}</> },
    { k: "bal", role: "amount", label: "Balance", cls: "n bal", sum: false, v: (r) => (r.balance === null || r.balance === undefined || r.balance === "" ? null : num(r.balance)),
      cell: (r) => (r.balance === null || r.balance === undefined || r.balance === "" ? "" : INR.format(r2(num(r.balance)))) },
    { k: "st", role: "status", label: "Status", v: (r) => (BST[r.state] || ["", r.state])[1], cell: (r) => { const w = BST[r.state] || ["no", r.state]; return <span className={"tag " + w[0]}>{w[1]}</span>; } },
    { k: "led", label: "Ledger", cls: "lg", filter: <ColFunnel hideIdle t="bank" k="led" label="Ledger" />, v: (r) => r.ledger || "", cell: (r) => <RowLedger r={r} /> },
    // the voucher type the line goes to Tally as (set by the ledger: Contra for a bank or cash ledger); changeable while open
    { k: "vt", label: "Type", cls: "vt", v: (r) => vtypeOf(r), cell: (r) => ["attention", "suggested", "ready"].includes(r.state)
      ? <select className="bs-vt" data-vt={r.id} aria-label="Voucher type" value={vtypeOf(r)} onChange={(ev) => setVtype(r.id, ev.target.value)}>{VTYPES.map((t) => <option key={t}>{t}</option>)}</select>
      : <span className="muted">{vtypeOf(r)}</span> },
    { k: "ac", role: "act", cls: "ac", cell: (r) => <RowActions r={r} /> },
  ];
}

// a line split into several ledgers: each part's ledger and amount; the rest stays with the line's own ledger
function SplitEditor({ r }) {
  const amt = r2(num(r.debit || r.credit)), own = r.ledger || "";
  const start = (r.splits || []).filter((p, i, a) => !(i === a.length - 1 && p.ledger === own)).map((p) => ({ ledger: p.ledger, amt: String(p.amt) }));
  const [parts, setParts] = useState(start.length ? start : [{ ledger: "", amt: "" }]);
  const box = useRef(null);
  const read = () => parts.map((p, i) => { const el = box.current && box.current.querySelector('[data-fk="split:' + r.id + ':' + i + '"]'); return { ledger: el ? el.value.trim() : p.ledger, amt: p.amt }; });
  const used = r2(parts.reduce((a, p) => a + num(p.amt), 0)), left = r2(amt - used);
  return <div className="bs-split" ref={box} data-split-editor={r.id}>
    <b>Split {money(amt)}</b>
    {parts.map((p, i) => <span key={i} className="bs-split-part">
      <LedgerBox className="lgbox bs-in" fk={"split:" + r.id + ":" + i} value={p.ledger} placeholder="Tally ledger" aria-label={"Ledger of part " + (i + 1)} />
      <input type="number" min="0" step="0.01" className="bs-in bs-amt" aria-label={"Amount of part " + (i + 1)} value={p.amt} onChange={(ev) => setParts(read().map((x, j) => (j === i ? { ledger: x.ledger, amt: ev.target.value } : x)))} />
    </span>)}
    <button className="linkbtn" onClick={() => setParts(read().concat([{ ledger: "", amt: "" }]))}>+ Another ledger</button>
    <span className={"bs-note" + (left < 0 ? " bad" : "")}>{own ? (left > 0.009 ? "The rest, " + money(left) + ", stays with " + own + "." : left < 0 ? "The parts come to more than the line." : "") : "Choose the line's own ledger first: the rest goes to it."}{num(r.tdsAtPay) > 0 ? " This line has TDS at payment: split it in Tally." : ""}</span>
    <button className="btn small primary" data-split-save="" onClick={() => splitSave(r.id, read())}>Save split</button>
    {(r.splits || []).length > 0 && <button className="btn small" data-split-clear="" onClick={() => splitClear(r.id)}>Remove the split</button>}
    <button className="linkbtn" onClick={() => { B().splitOpen = null; render(); }}>Cancel</button>
  </div>;
}

// the latest automatic run of this statement, with Undo of the whole run (Post to Tally lists every run)
function RunLine() {
  const b = B(), auto = b.rows.filter((r) => r.auto && r.auto.run);
  if (!auto.length) return null;
  const run = auto.reduce((a, r) => (String(r.auto.at) > String(a.auto.at) ? r : a)).auto.run, n = auto.filter((r) => r.auto.run === run).length;
  const day = istDay(Date.now()), today = auto.filter((r) => istDay(r.auto.at) === day).length;
  return <p className="ap-runline" data-ap-runline="">{today} posted automatically today · <button className="linkbtn" data-ap-undo-run={run} onClick={() => askConfirm({ title: "Undo this automatic run?", ok: "Undo the run",
    body: "<p class='note'>" + n + " entries: queued ones are taken off the queue; ones in Tally are deleted from Tally through the bridge on this computer. They come back as “Waiting for me”, and each party's rule is paused until you approve one again.</p>" })
    .then((a) => a && loadAP().then((ap) => ap.undoRun(b.cid, run)).then((r) => { toast(r.words || r.why); render(); }))}>Undo this run ({n})</button></p>;
}

function Table({ tab, all }) {
  const b = B(), total = all.length, grid = useRef(null);
  const nSel = all.filter((r) => b.sel.has(r.id) && r.state !== "sent").length;
  // the keys (parts/bank/smart.js): up, down, Enter, Space, A; a ledger set from the keys moves on to the next line
  useEffect(() => { const g = grid.current; if (!g) return; const ch = (ev) => kbChange(ev, g); g.addEventListener("change", ch); return () => g.removeEventListener("change", ch); }, []);
  // a long statement: more lines load as the end comes into view (the scroll listener in src/js/23 finds this button)
  const more = <div className="bk-more"><button className="btn small" data-act="bankMore" onClick={() => bankAct("bankMore")}>Show {Math.min(100, total - Math.min(total, b.limit))} more ({total - Math.min(total, b.limit)} left)</button></div>;
  return <div className="bs-grid" ref={grid} tabIndex={0} data-bank-grid="" aria-label="Bank statement lines: arrow keys move, Enter sets the ledger" onKeyDown={(ev) => kbKey(ev, grid.current)}>
    <ListTable name="bank" className="bk-table gf-off" cols={bankCols(b, all, nSel)} rows={all} rowKey={(r) => r.id} unit={["entry", "entries"]} of={b.rows.length} limit={b.limit} more={more}
      after={(r) => (b.splitOpen === r.id && ["attention", "suggested", "ready"].includes(r.state) ? <SplitEditor r={r} /> : null)}
      rowProps={(r) => ({ className: "st-" + r.state + (b.sel.has(r.id) ? " picked" : "") + (b.kbRow === r.id ? " kb-on" : ""), "data-rid": r.id })}
      empty={bankRangeOn() || (b.chips || []).length || b.sugOnly ? <>Nothing matches these filters. <button className="linkbtn" onClick={() => { b.chips = []; b.sugOnly = false; colChipAll("bank"); }}>Clear all filters</button> to see every entry.</> : EMPTY[tab] || "Nothing here. Use Upload statement at the top right to add one."} />
  </div>;
}

// one line per party among the entries to review, to give all its entries one ledger
function groupCols() {
  return [
    { k: "name", role: "party", label: "Party", cls: "pt", v: (g) => g.name, cell: (g) => <><div className="pn">{g.name}</div><div className="nr" title={g.sample}>{g.sample}</div></> },
    { k: "out", role: "amount", label: "Withdrawals", cls: "n", v: (g) => num(g.out) || null, sum: (g) => num(g.out), cell: (g) => bkAmt(g.out) },
    { k: "inn", role: "amount", label: "Deposits", cls: "n", v: (g) => num(g.inn) || null, sum: (g) => num(g.inn), cell: (g) => bkAmt(g.inn) },
    { k: "n", label: "Entries", cls: "n", v: (g) => g.n, sum: (g) => g.n, fmt: (t) => String(t), cell: (g) => g.n },
    { k: "led", label: "Ledger for all its entries", cls: "lg", cell: (g) => { const sug = Object.entries(g.ledgers).sort((a, b) => b[1] - a[1])[0];
      return <><LedgerBox className={"lgbox" + (sug ? " sugg" : "")} value={sug ? sug[0] : ""} fk={"gkey:" + g.key} data-gkey={g.key} placeholder="Select ledger"
          aria-label={"Ledger for " + g.name} id={"g-" + g.key} />
        {sug && <span className="src">Suggested for {sug[1]} of {g.n}</span>}</>; } },
    { k: "ac", role: "act", cls: "ac", cell: (g) => <button className="btn small primary" onClick={() => { const inp = document.getElementById("g-" + g.key); applyGroup(g.key, inp ? inp.value : ""); acClose(); }}>Apply</button> },
  ];
}

function Groups() {
  const b = B(), q = b.q.trim().toLowerCase();
  const all = bankGroups().filter((g) => !q || (g.name + " " + g.sample).toLowerCase().includes(q));
  const more = <div className="bk-more"><button className="btn small" data-act="bankMore" onClick={() => bankAct("bankMore")}>Show more parties ({all.length - Math.min(all.length, b.limit)} left)</button></div>;
  return <ListTable name="bankParties" className="bk-table gf-off" cols={groupCols()} rows={all} rowKey={(g) => g.key} unit={["party", "parties"]} limit={b.limit} more={more}
    empty="Nothing to review: every entry has a ledger. Use the Post to Tally tab to send them." />;
}

// after a search: give every line found the same ledger
// 24-Oct-2026: the lines found are the ones the table shows, with the quick chips too; with a chip on, "Set all" ticks
// exactly those and gives them the ledger (bulkAction, src/js/22), so it never reaches a line the table does not show
function Found({ shown }) {
  const b = B(), box = useRef(null), chips = (b.chips || []).length > 0 || !!b.sugOnly;
  const hits = shown.filter((r) => r.state !== "sent" && r.state !== "intally");
  const setAll = (v) => {
    if (!chips) return applyToVisible(v);
    const l = exactLedger(v);
    if (!l) { toast("“" + v + "” is not a ledger in Tally. Choose one from the list, or create it."); return; }
    b.sel.clear(); hits.forEach((r) => b.sel.add(r.id)); bulkAction("ledger", l);
  };
  return (
    <div className="bk-found"><b>{hits.length}</b> entr{hits.length === 1 ? "y" : "ies"} match “{b.q.trim()}”
      {hits.length > 0 && <> · <span className="muted">set them all to</span>{" "}
        <input ref={box} type="text" className="bk-allled" data-ac="1" data-fk="allled" autoComplete="off" placeholder="a ledger from Tally" defaultValue={b.allLed || ""} aria-label="Ledger for all found" />
        <button className="btn small primary" onClick={() => setAll(box.current.value.trim())}>Set all {hits.length}</button></>}
      {" "}<button className="linkbtn" onClick={() => bankAct("bankClearSearch")}>Clear</button>
    </div>
  );
}

function LastFail({ f }) {
  return (
    <div className="bk-alert bad"><b>{f.file} was not read.</b> <Msg text={f.msg} />
      <div className="row" style={{ gap: 8, marginTop: 8 }}><span className="note">Read it again:</span>
        <button className="btn small" onClick={() => bankAct("bankRetryFree")}>Try again</button>
        <button className="btn small" disabled={!googleReady()} title={googleReady() ? undefined : "Google OCR is not set up"} onClick={() => bankAct("bankRetryGoogle")}>With Google OCR</button>
        <button className="btn small primary" disabled={!claudeReady()} title={claudeReady() ? undefined : "Claude is not available here"} onClick={() => bankAct("bankRetryClaude")}>With Claude</button>
        <button className="linkbtn" onClick={() => bankAct("bankCopyReport")}>Copy details for support</button>
        <button className="linkbtn" onClick={() => bankAct("bankDismissFail")}>Dismiss</button>
      </div>
      {/* read by "Copy details for support" */}
      <textarea id="bankReport" readOnly hidden value={f.report || ""} />
    </div>
  );
}

// before the ledgers are known, suggestions cannot be made: how to get them
function LedgerSetup({ co }) {
  // one row each (round 3, 05-Oct-2026), the how-to on hover and behind How
  if (hasLedgerList()) return null;
  if (B().ledgersLoading || (typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id))) return <NoticeLine sev="info" text={"Loading ledgers from FinCom’s cloud copy of the books of " + ((TCloud.book(co.id) || {}).company || co.name) + "…"} />;
  if (bridgeLive(co)) return <NoticeLine sev="info" text={"Loading ledgers from Tally (" + Bridge.openFor(co).name + " is open)…"} />;
  if (live()) return <NoticeLine text={"Open " + Bridge.tallyName(co) + " in TallyPrime: its ledgers load by themselves."} how="Or import the ledger list from a file."><button className="btn small" onClick={() => bankAct("ledPick")}>Import from file</button></NoticeLine>;
  return <NoticeLine text={"Bring in the Tally ledger list for " + co.name + ": suggestions use only ledgers Tally has."} how="In Tally: Display More Reports → List of Accounts → Export (Excel or XML). With FinCom Bridge this happens by itself."><button className="btn small" onClick={() => bankAct("ledPick")}>Bring in from Tally</button></NoticeLine>;
}

// the deleted statements (soft deletes, kept on the server and in this browser), read once for the Restore item
function trashOf(b) {
  if (b && (b.stmtsTrash === undefined || b.stmtsTrash === null)) {
    b.stmtsTrash = [];
    Promise.all([Trash.list(b.cid, "statement"), BankDB.get("stmtsTrash:" + b.cid)]).then(([l, old]) => {
      b.stmtsTrash = l.concat((old || []).map((x) => ({ label: x.st.bank + " " + fmtDate(x.st.from) + " to " + fmtDate(x.st.to), at: x.at, by: x.by, reason: "" })));
      if (b.stmtsTrash.length) render();
    }, () => {});
  }
  return b.stmtsTrash || [];
}

// with no statement open, a deleted one can still be put back
function RestoreMenu() {
  const t = trashOf(B());
  if (!t.length) return null;
  return <details className="bk-menu" data-more="bank-restore"><summary className="btn small">More</summary><div className="bk-menu-list">
    <button onClick={() => bankAct("bankRestoreStmt")}>Restore a deleted statement<small>{Trash.say(t[0])}</small></button>
  </div></details>;
}

function MoreMenu({ tc }) {
  const b = B();
  trashOf(b);
  const M = ({ act, title, children, danger }) => <button className={danger ? "danger" : undefined} onClick={() => bankAct(act)}>{title}{children && <small>{children}</small>}</button>;
  return (
    <details className="bk-menu"><summary className="btn small">More</summary><div className="bk-menu-list">
      {live() ? <>
        <M act="reconRun" title="Reconcile with Tally">Every statement line against the bank ledger in Tally: what to post, what to delete</M>
        <M act="bankBalCheck" title="Check the balance with Tally">Tally’s bank balance against the statement’s closing</M>
        <M act="bankCheckTally" title="Mark lines already in Tally">Reads the bank ledger; lines found there are not posted again</M>
        <M act="dupFind" title="Find double or wrong-date entries">Entries from this statement that are in Tally twice or under another date</M>
        <M act="bankSync" title="Reload ledgers from Tally">After you create or rename a ledger in Tally</M>
        <M act="bankFile" title="Create a Tally file instead">Download an XML to import in Tally yourself</M>
      </> : <M act="bookPick" title="Match with Tally bank book" />}
      <M act="bankCsv" title="Download as Excel (CSV)" />
      {S.engine && tc.attention > 0 && <M act="bankClaude" title="Ask Claude for the remaining entries" />}
      <M act="bankClearStmt" title="Clear all decisions" />
      <M act="bankDelStmt" title="Delete this statement" danger>Asks for the client’s name; it can be restored</M>
      {(b.stmtsTrash || []).length > 0 && <M act="bankRestoreStmt" title="Restore a deleted statement">{Trash.say(b.stmtsTrash[0])}</M>}
    </div></details>
  );
}

export default function Bank() {
  const b = B(), co = CO();
  if (!b || b.cid !== co.id) { loadBank(co.id); return <Loading what="bank statements" page="table" />; }
  if (b.loading) return <Loading what="bank statements" page="table" />;
  setTimeout(() => TallyProof.checkBank(co.id).catch(() => {}), 0);
  ensureFileInputs();
  const st = curStmt();
  const top = <>
    {(BankDB.mode === "memory only" || BankDB.lost) && <div className="bk-alert bad">This browser is not keeping bank statements{BankDB.lost ? " (storage is full)" : ""}. Create the Tally file before closing, or use Chrome.</div>}
    {/* what FinCom is doing floats in view wherever you are on the page */}
    {b.busy && <div className="busy-float"><BusyCard title={/Tally/.test(b.busy) ? "Working with Tally…" : "Working on the statement…"} detail={b.busy} /></div>}
    {b.moved && <div className="bk-alert"><b>{b.moved.file}</b> is a statement of {b.moved.name} (account ··{b.moved.last4}), so it was filed there.{" "}
      <button className="linkbtn" onClick={() => bankAct("bankOpenMoved")}>Open {b.moved.name}</button> <button className="linkbtn" onClick={() => bankAct("bankDismissMoved")}>Dismiss</button></div>}
    <PostReport rep={b.postReport} />
    <FixBanner />
    {b.lastFail && <LastFail f={b.lastFail} />}
    <LedgerSetup co={co} />
  </>;
  if (!st) return <>
    <div className="bk">
      {top}
      <div className="bk-empty" id="bankDrop" tabIndex={0} role="button" onClick={() => bankAct("bankPick")} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); bankAct("bankPick"); } }}>
        <div className="bk-empty-ic">⤒</div><h2>No bank statement yet</h2>
        <p className="note">Drop a statement here, or click to choose one: Excel or CSV from net banking works best, and PDFs and photos are read too.</p>
      </div>
      {/* clean-up batch 3: one next step (the drop zone); the bank's settings and a restore are under More */}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10, gap: 8 }}><More label="More" data-bank-empty-more="" items={[["Bank settings", () => bankAct("bankSettings")],
        trashOf(B()).length ? ["Restore a deleted statement", () => bankAct("bankRestoreStmt")] : null]} /></div>
    </div>
    {b.showSettings && <BankSettings />}
  </>;

  // the account's Tally ledger as chosen (review 19): shown from what was confirmed, whether or not the ledger list has
  // loaded yet; asked for only for a new account, a guess to confirm, or a ledger gone from a complete list
  const acc = accountFor(st), accChoice = bankLedgerChoice(CO(), acc), accLedger = accChoice.value, tc = tabCounts(bankRangeRows()), tab = bankTab();
  // the account's Tally ledger, once confirmed, is a few words in the header line (24-Oct-2026: a line of its own)
  const accFull = acc.id ? acc : Object.assign({ id: st.acctId, bank: st.bank }, acc), accSure = !!accLedger && !accChoice.gone && accChoice.state === "confirmed";
  const repaired = b.rows.filter((r) => r.repaired).length, book = b.books[st.acctId];
  const sum = (k) => money(st[k === "debit" ? "totDr" : "totCr"] || b.rows.reduce((a, r) => a + num(r[k]), 0));
  // the lines the table lists: the tab, search, column filters and dates (bankVisibleRows, src/js/22), then the quick
  // chips and "suggestions only" (parts/bank/smart.js); the filter bar counts and adds them up (it replaces the ChipBar)
  const view = apView("bank") === "auto" ? b.rows.filter(isAuto) : apRows("bank", bankVisibleRows()), shown = smartRows(b, view);
  return <>
    <div className="bk bk-smart">
      {/* upload-pages (14-Oct-2026): the states are the page's one row of states (parts/StateBar.jsx); the rules are not a
          state, so they open from their own button. 24-Oct-2026: the search and Group by party are in the filter bar */}
      {tab === "rules" && <div className="bk-bar"><button className="btn small" data-bank-rules-back="" onClick={() => bankTabGo("review")}>← Back to the statement</button></div>}
      {/* one line (24-Oct-2026: a card of about 100 px and a line of checks under it): the account and its period, the check
          of the running balance, the four figures, the buttons */}
      <div className="bk-head bs-head">
        <div className="bk-id">
          {b.stmts.length > 1
            ? <select className="bk-stmtsel" aria-label="Statement" value={b.cur} onChange={(ev) => openStatement(ev.target.value)}>
                {b.stmts.slice().reverse().map((s) => <option key={s.id} value={s.id}>{stmtLabel(s)}</option>)}</select>
            : <h2 className="bk-title">{accLedger || st.bank}</h2>}
          {accSure && <BankLedger co={CO()} acc={accFull} compact />}
          <div className="bk-sub">{st.bank}{st.acct ? " · A/c " + st.acct : ""} · {fmtDate(st.from)} to {fmtDate(st.to)} · {b.rows.length} entries</div>
        </div>
        <div className="bk-check" title={st.badRows ? undefined : "Every line agrees with its running balance" + (st.summaryOk ? ", and opening + deposits − withdrawals = closing" : "")}>
          {st.badRows ? <span className="bad">✖ {st.badRows} entries do not agree with the running balance — check them before posting</span>
            : <span className="ok">✔ The statement adds up<span className="bs-more-words">: every line agrees with its running balance{st.summaryOk ? ", and opening + deposits − withdrawals = closing" : ""}</span></span>}
          {repaired > 0 && <> <span className="warn">· {repaired} amounts were read from the balance change (marked ≈)</span></>}
          {st.dupRows > 0 && <> <span className="muted">· {st.dupRows} entries skipped (already uploaded)</span></>}
          {book && <> <span className="muted">· {book.live ? "Checked against Tally " + fmtDateTime(book.importedAt) : "Matched with the Tally bank book"}</span></>}
        </div>
        <dl className="bk-figs">
          <div><dt>Opening</dt><dd>{st.opening !== undefined ? money(st.opening) : "—"}</dd></div>
          <div><dt>Withdrawals</dt><dd>{sum("debit")}</dd></div><div><dt>Deposits</dt><dd>{sum("credit")}</dd></div>
          <div><dt>Closing</dt><dd>{st.closing !== undefined ? money(st.closing) : "—"}</dd></div>
        </dl>
        <div className="bk-actions"><button className="btn small" data-bank-rules="" aria-pressed={tab === "rules"} onClick={() => bankTabGo("rules")}>Rules</button><button className="btn small" onClick={() => bankAct("bankSettings")}>Settings</button><MoreMenu tc={tc} /></div>
      </div>
      {accLedger && (Bridge.on() || st.tallyBal) && <BankBalance st={st} />}
      <Recon />
      {!accSure && <BankLedger co={CO()} acc={accFull} />}
      {top}
      <Gone /><DupFind /><BankFocus />
      {tab === "done" && !b.focus && live() && tc.done > 0 && <div className="bk-found"><span className="muted">Deleted some of these in Tally?</span> <button className="btn small" onClick={() => bankAct("goneCheck")}>Check they are still in Tally</button></div>}
      {b.offerRule && <div className="bk-found" style={{ borderColor: "var(--ledger)" }}><b>Keep this as a rule?</b> Every future line containing “{b.offerRule.text}” would go to <b>{b.offerRule.ledger}</b> by itself.{" "}
        <button className="btn small primary" onClick={() => bankAct("ruleFromBulk")}>Yes, make the rule</button><button className="linkbtn" onClick={() => bankAct("ruleNoThanks")}>No thanks</button></div>}
      {b.q.trim() && tab !== "rules" && <Found key={b.q} shown={shown} />}
      {tab !== "rules" && <AutoFilter kind="bank" all={b.rows} />}
      {tab !== "rules" && <SmartBar rows={shown} base={view} grouped={b.grouped} />}
      {tab === "rules" ? <RulesPanel /> : tab === "review" && b.grouped && apView("bank") !== "auto" ? <Groups /> : <Table tab={tab} all={shown} />}
      {tab !== "rules" && apView("bank") === "auto" && <RunLine />}
    </div>
    {b.showSettings && <BankSettings />}
  </>;
}

// the bar at the bottom: what is ticked and what can be done with it, or the counts and posting; and the last
// change, with Undo
export function BankBar() {
  const b = B();
  if (!b || b.loading || !curStmt()) return null;
  const tc = tabCounts(bankRangeRows()), nsel = b.sel.size;
  // review of 02-Oct-2026: with no Tally ledger chosen for this bank account nothing can be posted, and nothing can be
  // said about which lines are in Tally ("184 no longer in Tally · post them again" was shown for lines of an account
  // with no ledger): posting waits, said in one line with the way to choose it
  // posting waits until the account's ledger is confirmed (review 19, src/js/60 bankLedgerWhy): one line saying why
  const accNow = accountFor(curStmt()), noLed = !bankLedgerReady(CO(), accNow), whyLed = noLed ? bankLedgerWhy(CO(), accNow) : "";
  const chooseLed = () => { const el = document.querySelector('select[aria-label="Tally ledger for this bank account"]') || document.querySelector("[data-bank-ledger-confirm]"); if (el) { el.scrollIntoView({ block: "center" }); el.focus(); } else bankAct("bankSettings"); };
  let left, right;
  if (nsel) {
    const rows = bankSelected(), ready = rows.filter((r) => r.state === "ready").length;
    left = <><b>{nsel} selected</b> <span className="muted">· {money(r2(rows.reduce((a, r) => a + (r.debit || r.credit), 0)))}</span> <button className="linkbtn" onClick={() => bankAct("bankSelNone")}>Clear</button></>;
    right = <>
      {/* Enter in this box, or a ledger picked from its list, applies it (src/js/23) */}
      <input type="text" className="lgbox" data-bulkled="" data-fk="bulkled" data-ac="1" autoComplete="off" placeholder={"Ledger for the " + nsel + " selected"} aria-label="Ledger for the selected" />
      <button className="btn" onClick={() => bankAct("bankBulkLedger")}>Apply ledger</button>
      {/* 24-Oct-2026: the voucher type and a narration for all of them at once (parts/bank/smart.js), with Undo */}
      <select className="bs-in" data-bulk-vt="" aria-label="Voucher type for the selected" value="" onChange={(ev) => bulkVtype(ev.target.value)}>
        <option value="">Voucher type…</option>{VTYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      <input type="text" className="bs-in bs-narrin" data-bulk-narr="" autoComplete="off" placeholder="Narration ({month}, {party})" aria-label="Narration for the selected"
        onKeyDown={(ev) => { if (ev.key === "Enter") bulkNarr(ev.target.value); }} />
      <button className="btn" data-bulk-narr-apply="" title="Set this narration on the selected lines" onClick={(ev) => bulkNarr(ev.currentTarget.previousSibling.value)}>Set</button>
      {rows.some((r) => r.state === "suggested") && <button className="btn primary" onClick={() => bankAct("bankBulkAccept")}>Confirm</button>}
      {rows.some((r) => ["attention", "suggested", "ready"].includes(r.state)) && <button className="btn" onClick={() => bankAct("bankBulkIgnore")}>Ignore</button>}
      {rows.some((r) => r.state === "ignored" || r.state === "intally") && <button className="btn" onClick={() => bankAct("bankBulkRestore")}>Restore</button>}
      {live() && ready > 0 && <button className="btn primary" disabled={noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankBulkPost")}>Post {ready} to Tally</button>}
    </>;
  } else {
    // upload-pages: the counts of the states are the state bar's; here only what is not a state
    left = <>{tc.filed > 0 && <span className="bk-stat"><b>{tc.filed}</b> in a Tally file, not found in Tally</span>}
      {tc.gone > 0 && !noLed && <span className="bk-stat" data-bank-gone=""><b>{tc.gone}</b> no longer in Tally <button className="linkbtn" onClick={() => bankRepostGone()}>post them again</button></span>}
      {noLed && <span className="bk-stat bad" data-bank-noledger="">{whyLed + " "}<button className="linkbtn" onClick={chooseLed}>{/guessed/.test(whyLed) ? "Confirm the ledger" : "Choose the ledger"}</button></span>}</>;
    right = <>
      {tc.suggested > 0 && <button className="btn" onClick={() => bankAct("bankAcceptAll")}>Confirm all suggestions ({tc.suggested})</button>}
      {canPostTally(CO()) && postThroughWords(CO()) && <span className="note" data-post-through="">{postThroughWords(CO())}</span>}
      {canPostTally(CO()) ? <button className="btn primary" disabled={!tc.post || noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankPost")}>Post to Tally ({tc.post})</button>
        : <button className="btn primary" disabled={!tc.post || noLed} title={noLed ? whyLed : undefined} onClick={() => bankAct("bankXml")}>Create Tally file ({tc.post})</button>}
    </>;
  }
  const u = !nsel && b.undo;
  const said = u && (u.what === "set" || u.what === "bulk"
    ? <>{u.label} → <b>{u.ledger}</b>{u.others ? " · also " + entries(u.others) + " of this party" : ""}{u.ruleKeys && u.ruleKeys.length ? " · remembered" : ""}</>
    : u.what === "clear" && u.n > 1 ? "All decisions cleared" : entries(u.n) + " " + ({ accept: "confirmed", ignore: "ignored", restore: "restored", clear: "cleared", unready: "moved back to review", vtype: "given a voucher type", narr: "given a narration", split: "split changed" }[u.what] || "changed"));
  return (
    <div className="actionbar bk-actionbar bs-bankbar">
      {u && <div className="bk-snack"><span>{said}</span><button className="linkbtn" onClick={() => bankAct("bankUndo")}>Undo</button>
        {u.ruleKeys && u.ruleKeys.length > 0 && <button className="linkbtn" onClick={() => bankAct("bankForget")}>Don’t remember</button>}
        <button className="icon" aria-label="Close" onClick={() => bankAct("bankUndoOk")}>✕</button></div>}
      <div className="ab-left">{left}</div><div className="ab-right">{right}</div>
    </div>
  );
}
