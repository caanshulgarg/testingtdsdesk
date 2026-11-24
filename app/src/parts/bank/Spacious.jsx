// The bank page's spacious layout (01-Nov-2026; the owner approved the draft "Bank statement — spacious layout"): the
// page's header in one line, the status tabs, filters and search in one row with what is filtered as removable chips, the
// table filling the width and height of the window (its header row and Date column frozen, its totals pinned at its
// foot), a line's details in a drawer on the right, and a Comfortable / Compact switch for the rows' height.
// Loaded with the bank page's chunk (Bank.jsx). The layout itself is spacious.css, under html.bk-spacious (set here while
// a statement is open on the Bank page).
import "../../../../src/js/99-screen-parts.js";
import { useEffect, useLayoutEffect, useRef } from "react";
import LedgerBox from "../LedgerBox.jsx";
import { goneOpen, goneLine } from "./goneSent.js";
import { chipsOn, toggleChip, setF, setRange, setSugOnly, CHIPS, vtypeOf, setVtype, VTYPES } from "./smart.js";
import { isAuto } from "../AutoPost.jsx";
import { keep, kept } from "./Rail.jsx";
import { RepMark } from "./Overlap.jsx";
import { BankOverlap } from "../../lib/bankOverlap.js";
import { kbMark } from "./smart.js";
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
    return () => { h.classList.remove("bk-spacious"); h.style.removeProperty("--bk-fill"); h.style.removeProperty("--bk-top"); h.style.removeProperty("--bk-dr-h"); };
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
    // the page scrolled: where the table's box starts in the window moved (the panel over it, 601-1099 px, follows)
    window.addEventListener("scroll", fillSoon, { passive: true });
    // a press that only shuts an open flyout, list or picker (rowOpen does not then open a line)
    window.addEventListener("pointerdown", downAt, true);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fillSoon) : null;
    const top = document.querySelector("header.top"); if (ro && top) ro.observe(top);
    const app = document.getElementById("app"); if (ro && app) ro.observe(app);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", fillSoon); window.removeEventListener("pointerdown", downAt, true); if (ro) ro.disconnect(); };
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
  if (window.innerWidth <= 600) return;
  const box = document.querySelector("#app .bk-space .bk-tablewrap"), hs = document.documentElement.style;
  const bar = document.querySelector(".bs-bankbar"), ban = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-banner-h")) || 0;
  const se = document.scrollingElement || document.documentElement, under = (bar ? bar.getBoundingClientRect().height : 0) + ban + 6;
  const set = (k, v) => { if (hs.getPropertyValue(k) !== v) hs.setProperty(k, v); };
  // the panel over the table (601-1099 px, and any width with no lines beside it) never above the header nor the filters,
  // and its foot inside the window
  const hd = document.querySelector("header.top"), hp = hd ? getComputedStyle(hd).position : "";
  const hb = hd && (hp === "fixed" || hp === "sticky") ? Math.max(0, hd.getBoundingClientRect().bottom) : 0;
  const place = (t, b) => { t = Math.round(Math.max(t, hb + 6)); set("--bk-top", t + "px"); set("--bk-dr-h", Math.max(200, Math.round(Math.min(b, window.innerHeight - under) - t)) + "px"); };
  if (!box) {
    // no table on the page (one line per party with none to show): the panel starts under the filters, or the header
    const f = document.querySelector("#app [data-bank-filters]");
    hs.removeProperty("--bk-fill");
    place(f ? f.getBoundingClientRect().bottom + 6 : 0, window.innerHeight);
    return;
  }
  const top = box.getBoundingClientRect().top + se.scrollTop;
  // the "Show more" button under the table, when there is one
  const more = box.parentElement && box.parentElement.querySelector(":scope > .bk-more"), mh = more ? more.getBoundingClientRect().height + 6 : 0;
  set("--bk-fill", Math.max(280, Math.round(window.innerHeight - top - under - mh)) + "px");
  // where the table's box is in the window, measured again as the page scrolls: the line's details (between 601 and
  // 1099 px, over the table) start and end there too
  const r = box.getBoundingClientRect();
  place(r.top, r.bottom);
}

// a press while a flyout, a column's filter, a calendar, a list or the full menu is open, outside it: it only shuts that
// (18-Nov-2026 review: it opened the line under it too)
const OPEN_POP = "[data-rail-flyout], [role=menu], [role=listbox], .colpop, .datebox-pop, details[data-f-more][open], [data-ac-open]";
let down = { t: 0, shut: false };
function downAt(ev) {
  const t = ev.target, inside = (el) => el.contains(t);
  const pops = [...document.querySelectorAll(OPEN_POP)].filter((el) => el.getClientRects().length && !inside(el));
  down = { t: Date.now(), shut: pops.length > 0 || (document.documentElement.classList.contains("bk-rail-menu") && !(t.closest && t.closest("#side, .bkr"))) };
}
// the click that follows such a press (not one from the keyboard: no press, ev.detail 0)
export const dismissing = (ev) => !!(ev && ev.detail > 0 && down.shut && Date.now() - down.t < 2000);

// ---- a line's details: the panel on the right ----
// 18-Nov-2026 (the owner: "need a proper side panel with the same space"): on a wide screen (1100 px and more) the panel
// sits beside the table, at the table's height, and the table narrows to share the space (spacious.css, .bk-dr-open);
// between 601 and 1099 px it lies over the table, the table's full height; on a phone, a sheet from the bottom
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

// the open line no longer shown (another tab, filter, search or statement; posted off this tab): the panel shuts, and the
// keys stay on the list, on its first line, when focus was in the panel or lost with it
export function drawerGone(b) {
  const a = document.activeElement, was = !!(a && a.closest && a.closest("[data-bank-drawer]"));
  b.drawer = null;
  requestAnimationFrame(() => {
    const now = document.activeElement, g = document.querySelector("#app [data-bank-grid]");
    if (!g || !(was || !now || now === document.body || !now.isConnected)) return;
    g.focus({ preventScroll: true });
    const ids = [...g.querySelectorAll("tbody tr[data-rid]")].map((tr) => tr.dataset.rid);
    if (ids.length && !ids.includes(B().kbRow)) kbMark(g, ids[0]);
  });
}

export function Drawer({ rows }) {
  const b = B(), box = useRef(null), id = b.drawer, r = id ? b.rows.find((x) => x.id === id) : null;
  // closed from inside it (✕, Esc): focus goes back to the line's date, so the keyboard carries on from the line
  const close = () => {
    const back = !!(box.current && box.current.contains(document.activeElement)), was = b.drawer;
    b.drawer = null; render();
    if (back && was) requestAnimationFrame(() => { const el = document.querySelector('#app [data-row-open="' + CSS.escape(was) + '"]'); if (el) el.focus({ preventScroll: true }); });
  };
  useEffect(() => {
    if (!id) return undefined;
    // the rail's full menu open over the page (Rail.jsx): Esc closes that first
    // nor while focus is in a box, a list or another dialog (the search, a filter's words): Esc is theirs
    const theirs = (t) => !!(t && t.closest && (t.isContentEditable || t.closest(".acbox, [data-ac-open], input, textarea, select, [aria-expanded=true]")
      || [...document.querySelectorAll("dialog[open], [role=dialog], [role=listbox], [role=menu]")].some((d) => d !== box.current && d.contains(t))));
    const esc = (ev) => { if (ev.key === "Escape" && !theirs(ev.target) && !document.querySelector('.bkr [data-rail-menu][aria-expanded="true"]')) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
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
      {r.state === "ignored" && <button className="btn small" data-drawer-act="restore" onClick={act("restore")}>Restore</button>}
      {r.state === "intally" && !bankOwnPost(r) && <button className="btn small" data-drawer-act="nottally" onClick={act("nottally")}>Not this Tally entry</button>}
      {r.state === "sent" && r.tally && r.tally.guid && live() && <button className="btn small" data-drawer-act="unpost" onClick={act("unpost")}>Take it back</button>}
      {(r.state === "sent" || (r.state === "intally" && bankOwnPost(r))) && typeof TCloud === "object" && TCloud.has(b.cid) && !(CO(b.cid) || {}).bankOptional && typeof bankNotInTally === "function" && <button className="btn small" data-drawer-act="notintally" disabled={NotInTally.on(r.id)} onClick={() => bankNotInTally(r.id)}>{NotInTally.LABEL}</button>}
    </div>}
  </aside>;
}

// a click anywhere on a line opens its details, a second click on the open line closes them (18-Nov-2026: was the date
// and the particulars only); not on what does something of its own: its tick box, ledger box, lists, buttons and links
export const DOES = "input, button, select, a, label, textarea, summary, [role=button], [role=checkbox], [contenteditable], [data-legacy], .lgbox, .bs-led, .acbox, td.ck";
export function rowOpen(ev, id) {
  if (!ev.target.closest || ev.target.closest(DOES) || dismissing(ev)) return;
  if (window.getSelection && String(window.getSelection())) return;
  const b = B(); b.drawer = b.drawer === id ? null : id; render();
}
