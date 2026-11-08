// The bank page's spacious layout (01-Nov-2026; the owner approved the draft "Bank statement — spacious layout"): the
// page's header in one line, the status tabs, filters and search in one row with what is filtered as removable chips, the
// table filling the width and height of the window (its header row and Date column frozen, its totals pinned at its
// foot), a line's details in a drawer on the right, and a Comfortable / Compact switch for the rows' height.
// Loaded with the bank page's chunk (Bank.jsx). The layout itself is spacious.css, under html.bk-spacious (set here while
// a statement is open on the Bank page).
import { useEffect, useLayoutEffect, useRef } from "react";
import LedgerBox from "../LedgerBox.jsx";
import { goneOpen, goneLine } from "./goneSent.js";
import { chipsOn, toggleChip, setF, setRange, setSugOnly, CHIPS, vtypeOf, setVtype, VTYPES } from "./smart.js";
import { isAuto } from "../AutoPost.jsx";
import { keep, kept } from "./Rail.jsx";
import { RepMark } from "./Overlap.jsx";
import { BankOverlap } from "../../lib/bankOverlap.js";
import "./spacious.css";

const live = () => Bridge.on() && Bridge.up();
export const MODE_NAME = { ATM: "ATM cash withdrawal", CASH: "Cash deposit", CHARGES: "Bank charges", INTEREST: "Interest credit" };
export const bankParty = (r) => MODE_NAME[r.dec.mode] || r.dec.name || r.dec.upi || "";
export const BST = { attention: ["warn", "No ledger"], suggested: ["warn", "Suggested"], ready: ["ok", "Ready to post"], sent: ["ok", "In Tally"], intally: ["no", "Already in Tally"], ignored: ["no", "Ignored"] };

// a line that is closed (in Tally, already in Tally, ignored): what Tally says of it, in words (was inside RowLedger)
export function rowTally(r) {
  const b = B();
  const noLed = !bankLedgerReady(CO(), accountFor(curStmt() || {}));
  const rg = typeof postRegMark === "function" && !r.goneFromTally ? postRegMark(b.cid, r.id) : undefined, regLine = typeof postRegLine === "function" ? postRegLine(b.cid, r.id) : "";
  const mark = rg !== undefined ? rg : r.state === "sent" && !r.goneFromTally && typeof postMarkOf === "function" ? postMarkOf(r) : null, words = mark ? postMarkWords(mark) : "";
  const matched = r.state === "sent" && typeof postMatched === "function" ? postMatched(r.id, b.cid) : null;
  const status = r.goneFromTally && noLed ? "Not found in Tally · choose this account’s Tally ledger to check and post"
    : r.goneFromTally ? "Not in Tally any more (deleted there?) · " + (r.state === "intally" ? "was found when reconciling" : "posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : ""))
    : words ? words + (r.checking ? " · checking in Tally…" : "")
    : regLine ? regLine
    : r.state === "sent" && r.postByReply === true && !bankMatched(r) ? "Posted to Tally (Tally's reply) · " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "")
    : r.state === "sent" && !bankMatched(r) ? (r.postedVia === "bridge" ? "Sent to Tally " : "In a Tally file ") + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.checking ? " · checking in Tally…" : " · not found in Tally yet")
    : r.state === "sent" ? "In Tally · posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "") + (r.tally && r.tally.number ? " · voucher " + r.tally.number : "")
    : r.state === "intally" ? "Already in Tally" + (r.tallyRef ? ": " + r.tallyRef : "") + (r.tallyHow ? " (" + r.tallyHow + ")" : "") : "Ignored";
  return { status, words, rg, regLine, mark, matched };
}

// ---- the rows' height, per person ----
export const denseOn = () => kept("bankDensity") === "compact";
export function Density() {
  const b = B(), dense = !!b.dense;
  // one button, as the draft: it says the other height, and switches to it
  return <button type="button" className="btn small bsp-dens" data-bank-density={dense ? "compact" : "comfortable"} aria-pressed={dense}
    title={dense ? "Compact rows: switch to comfortable" : "Comfortable rows: switch to compact"}
    onClick={() => { b.dense = !dense; keep("bankDensity", dense ? "comfortable" : "compact"); render(); }}>{dense ? "Comfortable" : "Compact"}</button>;
}

// ---- what is filtered, as chips with ✕ (the search, In / Out, the toggles, the dates and amounts, the quick chips) ----
export function activeChips(b) {
  const f = b.f || {}, out = [];
  if ((b.q || "").trim()) out.push(["q", "Search: “" + b.q.trim() + "”", () => bankAct("bankClearSearch")]);
  if (f.dir) out.push(["dir", f.dir === "out" ? "Out (withdrawals)" : "In (deposits)", () => setF("dir", "")]);
  if (f.led) out.push(["led", f.led === "none" ? "Unassigned only" : "Ledger chosen", () => setF("led", "")]);
  if (b.sugOnly) out.push(["sug", "Suggestions to accept", () => setSugOnly(false)]);
  if (b.from) out.push(["from", "From " + fmtDate(b.from), () => setRange("from", "")]);
  if (b.to) out.push(["to", "To " + fmtDate(b.to), () => setRange("to", "")]);
  if (f.min) out.push(["min", "Amount ≥ " + money(f.min), () => setF("min", "")]);
  if (f.max) out.push(["max", "Amount ≤ " + money(f.max), () => setF("max", "")]);
  chipsOn(b).forEach((k) => { const c = CHIPS.find((x) => x[0] === k); out.push(["chip:" + k, "Type: " + (c ? c[1] : k), () => toggleChip(k)]); });
  return out;
}
export function ActiveChips() {
  const list = activeChips(B());
  if (!list.length) return null;
  return <span className="bsp-achips" data-bank-active-chips="">{list.map(([k, w, x]) => <span key={k} className="bs-chip bs-fchip" data-achip={k}>{w}
    <button type="button" className="bs-fx" aria-label={"Remove the filter " + w} onClick={x}>✕</button></span>)}</span>;
}

// ---- the page while a statement is open: html.bk-spacious, and the table's box as tall as the window leaves ----
export function useSpacious() {
  useLayoutEffect(() => {
    const h = document.documentElement;
    h.classList.add("bk-spacious");
    return () => { h.classList.remove("bk-spacious"); h.style.removeProperty("--bk-fill"); };
  }, []);
  useLayoutEffect(fill);
  // what stands above the table (the header, the notices, the tabs and filters, which can wrap) changing height: measured again
  useEffect(() => {
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(fillSoon);
    document.querySelectorAll("#app .bk-space > :not(.bs-grid), #app > .react-host > .sbar-band").forEach((el) => ro.observe(el));
    // and a row coming or going (the search's "set them all to", a notice): the page's box is observed for its children
    const box = document.querySelector("#app .bk-space"), mo = box && typeof MutationObserver === "function" ? new MutationObserver(() => requestAnimationFrame(fill)) : null;
    if (mo) mo.observe(box, { childList: true });
    return () => { ro.disconnect(); if (mo) mo.disconnect(); };
  });
  useEffect(() => {
    const on = () => fill();
    window.addEventListener("resize", on);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fillSoon) : null;
    const top = document.querySelector("header.top"); if (ro && top) ro.observe(top);
    const app = document.getElementById("app"); if (ro && app) ro.observe(app);
    return () => { window.removeEventListener("resize", on); if (ro) ro.disconnect(); };
  }, []);
}
// a ResizeObserver's callback never sets --bk-fill itself (Sentry FINCOM-APP-STAGING-E, 02/03-Nov-2026, Safari): --bk-fill
// sets the table box's height, which changes #app's, which is watched too, in the same frame: the browser then reports
// "ResizeObserver loop completed with undelivered notifications." to window.onerror. fill() runs in the next frame instead,
// once however many observers ask
let fillFrame = 0;
export function fillSoon() {
  if (fillFrame) return;
  const go = () => { fillFrame = 0; try { fill(); } catch (e) { /* the layout is only measured: never in the way */ } };
  fillFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(go) : setTimeout(go, 16);
}
export function fill() {
  const box = document.querySelector("#app .bk-space .bk-tablewrap");
  if (!box || window.innerWidth <= 600) return;
  const bar = document.querySelector(".bs-bankbar"), ban = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-banner-h")) || 0;
  const se = document.scrollingElement || document.documentElement;
  const top = box.getBoundingClientRect().top + se.scrollTop, under = (bar ? bar.getBoundingClientRect().height : 0) + ban + 6;
  // the "Show more" button under the table, when there is one
  const more = box.parentElement && box.parentElement.querySelector(":scope > .bk-more"), mh = more ? more.getBoundingClientRect().height + 6 : 0;
  const v = Math.max(280, Math.round(window.innerHeight - top - under - mh)) + "px";
  if (document.documentElement.style.getPropertyValue("--bk-fill") !== v) document.documentElement.style.setProperty("--bk-fill", v);
}

// ---- a line's details: the drawer on the right ----
const STEP = { you: "set by you", rule: "by a rule", hist: "learnt from earlier statements" };
function history(b, r) {
  const st = curStmt(), out = [];
  if (st) out.push("In the statement " + (typeof stmtLabel === "function" ? stmtLabel(st) : st.bank) + (st.uploadedAt || st.at ? " · uploaded " + fmtDateTime(st.uploadedAt || st.at) : ""));
  const h = r.fp && b.hist && b.hist.rows ? b.hist.rows[r.fp] : null;
  if (h && h.l) out.push("Remembered: " + h.l + (h.s ? " (" + (STEP[h.s] || h.s) + ")" : ""));
  if (r.ledger) out.push("Ledger " + r.ledger + " · " + (r.source === "you" || r.userSet ? "set by you" : r.state === "suggested" ? "suggested (" + (r.srcLabel || "match") + ")" : r.srcLabel || "confirmed"));
  if (r.auto && r.auto.at) out.push("Posted automatically " + fmtDateTime(r.auto.at));
  if (r.sentAt) out.push((r.state === "sent" ? "Posted " : "Was posted ") + fmtDateTime(r.sentAt) + (r.postedVia ? " (" + (r.postedVia === "bridge" ? "through FinCom Bridge" : r.postedVia) + ")" : ""));
  if (r.goneSent) out.push(goneLine(r));
  return out;
}

export function Drawer({ rows }) {
  const b = B(), box = useRef(null), id = b.drawer, r = id ? b.rows.find((x) => x.id === id) : null;
  const close = () => { b.drawer = null; render(); };
  useEffect(() => {
    if (!id) return undefined;
    const esc = (ev) => { if (ev.key === "Escape" && !(ev.target && ev.target.closest && ev.target.closest(".acbox, [data-ac-open]"))) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [id]);
  useEffect(() => { if (r && box.current) box.current.focus({ preventScroll: true }); }, [id]);
  if (!r) return null;
  const amt = r.debit ? "Withdrawal " + money(r.debit) : "Deposit " + money(r.credit), w = BST[r.state] || ["no", r.state];
  const rule = r.ruleId && (allRules().find((x) => x.id === r.ruleId) || { name: "gone" });
  const isOpen = ["attention", "suggested", "ready"].includes(r.state);
  const t = isOpen ? null : rowTally(r);
  const idx = rows.findIndex((x) => x.id === r.id), step = (d) => { const n = rows[idx + d]; if (n) { b.drawer = n.id; render(); } };
  const act = (a) => () => bankRowAct(a, r.id);
  const why = [].concat(r.why || []).filter(Boolean).join(" ");
  return <aside ref={box} className="bsp-drawer" role="dialog" aria-label={"Line details: " + fmtDate(r.date)} data-bank-drawer={r.id} tabIndex={-1}>
    <div className="bsp-dr-head">
      <h2>{fmtDate(r.date)}</h2><span className={"tag " + w[0]}>{w[1]}</span>
      <span className="bsp-gap" />
      <button type="button" className="icon" aria-label="Previous line" data-drawer-prev="" disabled={idx <= 0} onClick={() => step(-1)}>↑</button>
      <button type="button" className="icon" aria-label="Next line" data-drawer-next="" disabled={idx < 0 || idx >= rows.length - 1} onClick={() => step(1)}>↓</button>
      <button type="button" className="icon" aria-label="Close details" data-drawer-close="" onClick={close}>✕</button>
    </div>
    {goneOpen(r) && <div className="bk-alert bsp-gone" data-drawer-gone="">⚠ {goneLine(r)}. Posting it asks you first.</div>}
    <RepMark r={r} />
    <div className="bsp-party">{bankParty(r) || "—"}</div>
    <div className="bsp-narr" data-drawer-narr="">{r.narr}</div>
    <dl className="bsp-grid">
      <dt>Amount</dt><dd data-drawer-amt="">{amt}</dd>
      <dt>Balance</dt><dd>{r.balance === null || r.balance === undefined || r.balance === "" ? "—" : money(r.balance)}</dd>
      <dt>Mode</dt><dd>{[r.dec.mode !== "OTHER" ? r.dec.mode : "", r.dec.chq ? "Chq " + r.dec.chq : r.dec.utr || ""].filter(Boolean).join(" · ") || "—"}</dd>
      <dt>Ledger</dt><dd>{isOpen ? <LedgerBox className="lgbox" value={r.ledger || ""} fk={"dled:" + r.id} data-drawer-led={r.id} placeholder="Choose ledger" aria-label="Change ledger" onCommit={(v) => bankSetLedger(r.id, v)} />
        : <b>{r.ledger || "—"}</b>}</dd>
      <dt>Voucher type</dt><dd>{isOpen ? <select className="bs-vt" data-drawer-vt="" aria-label="Voucher type" value={vtypeOf(r)} onChange={(ev) => setVtype(r.id, ev.target.value)}>{VTYPES.map((x) => <option key={x}>{x}</option>)}</select> : vtypeOf(r)}</dd>
      <dt>Rule used</dt><dd data-drawer-rule="">{rule ? <span data-legacy=""><button type="button" className="linkbtn" data-redit={r.ruleId}>{ruleLabel(rule)}</button></span> : r.srcLabel || (r.state === "attention" ? "None yet" : "—")}{why && <div className="note">{why}</div>}</dd>
      <dt>Tally voucher</dt><dd data-drawer-tally="">{t ? t.status : r.postError ? "Tally: " + r.postError : r.state === "ready" ? "Ready to post" : "Not posted yet"}
        {r.tally && r.tally.number && !/voucher/.test(t ? t.status : "") ? " · voucher " + r.tally.number : ""}{t && t.matched ? " · Matched with Tally" : ""}</dd>
      {r.tdsAtPay > 0 && <><dt>TDS</dt><dd>{money(r.tdsAtPay)} deducted at payment</dd></>}
      {(r.splits || []).length > 0 && <><dt>Split</dt><dd>{r.splits.map((sp) => sp.ledger + " " + money(sp.amt)).join(", ")}</dd></>}
      {r.ruleNarr && <><dt>Narration for Tally</dt><dd>{r.ruleNarr}</dd></>}
    </dl>
    <div className="bsp-hist" data-drawer-history=""><b>History</b>{history(b, r).map((x, i) => <div key={i}>{x}</div>)}</div>
    {!isAuto(r) && <div className="bsp-acts" data-drawer-acts="">
      {r.state === "suggested" && <button className="btn small primary" data-drawer-act="accept" onClick={act("accept")}>Confirm {r.ledger}</button>}
      {r.state === "ready" && live() && !BankOverlap.isOpen(r) && <button className="btn small" data-drawer-act="post" onClick={act("post")}>Post</button>}
      {r.state === "ready" && <button className="btn small" data-drawer-act="unready" onClick={act("unready")}>Undo</button>}
      {isOpen && <button className="btn small" data-drawer-act="rule" onClick={act("rule")}>Make a rule</button>}
      {isOpen && <button className="btn small" data-drawer-act="split" onClick={() => { b.splitOpen = r.id; b.drawer = null; render(); }}>Split</button>}
      {(r.state === "attention" || r.state === "suggested") && <button className="btn small" data-drawer-act="ignore" onClick={act("ignore")}>Ignore</button>}
      {(r.state === "ignored" || r.state === "intally") && <button className="btn small" data-drawer-act="restore" onClick={act("restore")}>Restore</button>}
      {r.state === "sent" && r.tally && r.tally.guid && live() && <button className="btn small" data-drawer-act="unpost" onClick={act("unpost")}>Take it back</button>}
    </div>}
  </aside>;
}

// a click on a line's date or particulars opens its details (not on a box, a button or a link in it)
export function rowOpen(ev, id) {
  if (ev.target.closest("input, button, select, a, label, textarea, [data-legacy], .lgbox")) return;
  if (window.getSelection && String(window.getSelection())) return;
  const b = B(); b.drawer = b.drawer === id ? null : id; render();
}
