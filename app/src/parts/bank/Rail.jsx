// The slim rail of the bank page (spacious layout, 01-Nov-2026; the owner approved the draft "Bank statement — spacious
// layout"): on the Bank page only, the sidebar folds to a 72 px rail, one icon and a short word a section, so the
// statement's table has the width. Every other page keeps the sidebar (Side.jsx) as it is.
//   - hover an item, or focus or click it (keyboard and touch), and its flyout opens with the section's pages;
//   - Menu opens the full sidebar over the page (the sidebar itself, #side, shown as a panel); Pin there keeps the full
//     sidebar on the Bank page too (remembered for this person in this browser), and "Slim rail" undoes it;
//   - a phone (600 px and less) keeps its bar along the bottom: no rail.
// Loaded with the bank page's chunk (Bank.jsx), not the app's first file: the sidebar is hidden and the page's margin
// changed by a class on <html> (bk-rail, bk-rail-menu) that only this chunk's stylesheet (rail.css) reads.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ChartColumn, CircleHelp, FileText, House, Landmark, Menu, Percent, Pin, PinOff, ReceiptText, Settings, TrendingUp, Users, X } from "./icons.jsx";
// FinComNav (app/src/nav.js) is read from window: no import from the first file, so it exports nothing more for this chunk
const FinComNav = { go: (fn) => (window.FinComNav ? window.FinComNav.go(fn) : fn()) };
import "./rail.css";

// this person (the firm account's member, or this browser when not signed in): the choices are kept per person
export function who() {
  try { const m = S.account && S.account.me; return String((m && (m.id || m.email)) || (typeof Cloud === "object" && Cloud.st && Cloud.st.user && Cloud.st.user.id) || "here"); } catch (e) { return "here"; }
}
export function keep(k, v) { try { localStorage.setItem("fincom:" + k + ":" + who(), v); } catch (e) { /* kept for this visit only */ } }
export function kept(k) { try { return localStorage.getItem("fincom:" + k + ":" + who()); } catch (e) { return null; } }

// a client's page: open the client's part, then (on the same turn) its tab
const client = (to, then) => () => { goClient(to); if (then) { then(); render(); } };
const gst = (part) => client("books:gst", () => { S.gstView = "return"; S.gstPart = part; S.gstSub = ""; });
const tds = (view) => client("books:tds", () => { S.tdsView = view; });
const txn = (tab) => client("txn", () => { S.txnTab = tab; });
const onBank = (fn) => () => { if (S.tab !== "bank") goClient("bank"); setTimeout(() => { const b = B(); if (!b || b.loading || !curStmt()) { toast("Open a bank statement first."); return; } fn(); }, 0); };
const meetOn = () => { try { return typeof Cloud === "object" && Cloud.on() && ["owner", "staff"].includes(String((Cloud.st && Cloud.st.role) || "")); } catch (e) { return false; } };

// the rail's sections in the owner's order, each with its flyout. An entry: [words, what it opens]. The draft's words are
// kept; where FinCom has no page of exactly that name the entry opens the nearest one (the release notes list them)
export function railItems() {
  return [
    { k: "home", label: "Home", Icon: House, subs: [["Today", () => navHome("today")], ["Compliance due list", () => navHome("compliance")],
      ["Notifications", () => { S.alertsOpen = true; if (typeof AlertHub === "object") AlertHub.refresh(); render(); }],
      ...(meetOn() ? [["Meetings", () => navHome("meetings")]] : [])] },
    { k: "clients", label: "Clients", Icon: Users, subs: [["All clients", () => navHome("clients")], ["Add client", () => doAct("addCo")],
      ["Client setup", () => { S.step = null; S.tab = "settings"; render(); }], ["Client overview", client("dash")], ["Change client", () => openSwitcher()]] },
    { k: "bank", label: "Bank", Icon: Landmark, subs: [["Bank statements", () => { goClient("bank"); if (B() && B().filter === "rules") bankTabGo("review"); }],
      ["Upload statement", () => doAct("uploadHere")], ["Bank rules", onBank(() => bankTabGo("rules"))],
      ["Check with Tally", onBank(() => bankAct(Bridge.on() && Bridge.up() ? "bankCheckTally" : "bookPick"))]] },
    { k: "purchase", label: "Purchase", Icon: ReceiptText, subs: [["Bills to review", client("bills")], ["Upload bills", () => goStep("collect", "bills")],
      ["Suppliers", () => goTab("deductees")], ["Post to Tally", client("post")]] },
    { k: "sales", label: "Sales", Icon: TrendingUp, subs: [["Invoices", client("sales")], ["E-invoice / e-way bill", client("sales")], ["Customers", client("sales")]] },
    { k: "txn", label: "Transactions", short: "Trans­actions", Icon: ArrowLeftRight, subs: [["Purchase register", txn("bills")], ["Sales register", txn("sales")], ["Bank register", txn("bank")]] },
    { k: "gst", label: "GST", Icon: FileText, subs: [["GSTR-1", gst("r1")], ["GSTR-3B", gst("r3b")], ["GSTR-2B & ITC", gst("r2b")], ["Annual return (GSTR-9)", gst("g9")], ["Supplier health", gst("r2b")]] },
    { k: "tds", label: "TDS", Icon: Percent, subs: [["Returns (24Q / 26Q / 27Q)", tds("year")], ["Challans", tds("register")], ["Deductees", () => goTab("deductees")],
      ["26AS & AIS", client("books:recon")], ["TRACES files", tds("traces")]] },
    { k: "reports", label: "Reports", Icon: ChartColumn, subs: [["Financial statements", () => { S.fsTab = ""; goClient("books:fs"); }], ["MIS", client("books:mis")], ["My MIS", client("books:mymis")],
      ["Audit", client("books:audit")], ["Look up", client("books:lookup")], ["Reports", client("books:reports")], ["From Tally", client("books:import")], ["Letters", client("books:letters")]] },
    { k: "settings", label: "Settings", Icon: Settings, subs: [["Firm settings", () => goSettings(null)], ["People", () => goSettings("account")], ["Plan and credit", () => goSettings("plan")],
      ["Tally", () => { S.tallyFocus = ""; navHome("tally"); }], ["Integrations", () => goIntegrations("")]] },
    { k: "help", label: "Help", Icon: CircleHelp, subs: [["Help", () => navHome("help")]] },
  ];
}

function Flyout({ it, close, at }) {
  const box = useRef(null);
  // the arrows move within the flyout; Esc and ArrowLeft go back to the rail's item
  const key = (ev) => {
    const items = [...box.current.querySelectorAll("[role=menuitem]")], i = items.indexOf(document.activeElement);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); const n = items.length; items[(i + (ev.key === "ArrowDown" ? 1 : n - 1)) % n].focus(); }
    else if (ev.key === "Home") { ev.preventDefault(); items[0].focus(); }
    else if (ev.key === "End") { ev.preventDefault(); items[items.length - 1].focus(); }
    else if (ev.key === "Escape" || ev.key === "ArrowLeft") { ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if (ev.key === "Tab") close(false);
  };
  return <div ref={box} className="bkr-fly" role="menu" aria-label={it.label} data-rail-flyout={it.k} style={{ top: at }} onKeyDown={key}>
    <div className="bkr-fly-head" aria-hidden="true">{it.label}</div>
    {it.subs.map(([w, go]) => <button key={w} type="button" role="menuitem" className="bkr-fly-item" data-rail-sub={it.k + ":" + w}
      onClick={() => { close(false); FinComNav.go(go); }}>{w}</button>)}
  </div>;
}

function Item({ it, open, setOpen }) {
  const btn = useRef(null), timer = useRef(0), quiet = useRef(false), [at, setAt] = useState(0);
  const show = () => { clearTimeout(timer.current); const r = btn.current.getBoundingClientRect(); setAt(Math.max(8, Math.min(r.top, innerHeight - 60 - it.subs.length * 34))); setOpen(it.k); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen((o) => (o === it.k ? null : o)), 160); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // back on the item from the flyout (Esc, ←): the focus returns without opening the flyout again
  const close = (back) => { setOpen(null); if (back && btn.current) { quiet.current = true; btn.current.focus({ preventScroll: true }); quiet.current = false; } };
  const first = () => setTimeout(() => { const f = document.querySelector('[data-rail-flyout="' + it.k + '"] [role=menuitem]'); if (f) f.focus(); }, 0);
  const on = it.k === "bank";
  return <div className="bkr-item" onMouseEnter={show} onMouseLeave={hide}>
    <button ref={btn} type="button" className="bkr-btn" data-rail={it.k} aria-label={it.label} aria-haspopup="menu" aria-expanded={open === it.k}
      aria-current={on ? "page" : undefined} onFocus={() => { if (!quiet.current) show(); }} onBlur={(ev) => { if (!(ev.relatedTarget && ev.currentTarget.parentElement.contains(ev.relatedTarget))) hide(); }}
      onClick={show}
      onKeyDown={(ev) => { if (["ArrowRight", "Enter", " ", "ArrowDown"].includes(ev.key)) { ev.preventDefault(); show(); first(); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setOpen(null); } }}>
      <it.Icon width={18} height={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="bkr-word" aria-hidden="true">{it.short || it.label}</span>
    </button>
    {open === it.k && <Flyout it={it} close={close} at={at} />}
  </div>;
}

// the full sidebar opened over the page: its head (Pin, Close) is put into #side itself
function MenuHead({ pin, close }) {
  const side = document.getElementById("side");
  if (!side) return null;
  return createPortal(<div className="bkr-menuhead" data-rail-menuhead="">
    <button type="button" className="btn small" data-rail-pin="" title="Keep the full menu on the Bank page" onClick={pin}><Pin width={14} height={14} aria-hidden="true" /> Pin</button>
    <button type="button" className="icon" data-rail-menu-close="" aria-label="Close the menu" onClick={close}><X width={16} height={16} aria-hidden="true" /></button>
  </div>, side);
}
// pinned: the full sidebar, and one button in it back to the rail
function Unpin({ unpin }) {
  const side = document.getElementById("side");
  if (!side) return null;
  return createPortal(<button type="button" className="bkr-unpin linkbtn" data-rail-unpin="" title="Fold the menu to the slim rail on the Bank page" onClick={unpin}>
    <PinOff width={14} height={14} aria-hidden="true" /> Slim rail</button>, side);
}

export default function Rail() {
  const [pinned, setPinned] = useState(() => kept("bankRailPin") === "1");
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(null);
  const nav = useRef(null);
  useLayoutEffect(() => {
    const h = document.documentElement;
    h.classList.toggle("bk-rail", !pinned);
    h.classList.toggle("bk-rail-menu", !pinned && menu);
    return () => { h.classList.remove("bk-rail", "bk-rail-menu"); };
  }, [pinned, menu]);
  // the full menu closes on Esc, a click outside it, and when a page is opened from it
  useEffect(() => {
    if (!menu) return undefined;
    const out = (ev) => {
      if (ev.type === "keydown") { if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); setMenu(false); } return; }
      const side = document.getElementById("side");
      if (side && side.contains(ev.target)) { if (ev.target.closest(".side-link, .side-co")) setTimeout(() => setMenu(false), 0); return; }
      if (nav.current && nav.current.contains(ev.target)) return;
      setMenu(false);
    };
    window.addEventListener("keydown", out, true); document.addEventListener("click", out, true);
    return () => { window.removeEventListener("keydown", out, true); document.removeEventListener("click", out, true); };
  }, [menu]);
  // a tap elsewhere closes a flyout (touch has no "mouse left")
  useEffect(() => {
    if (!open) return undefined;
    const out = (ev) => { if (!(nav.current && nav.current.contains(ev.target))) setOpen(null); };
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, [open]);
  const pin = () => { keep("bankRailPin", "1"); setMenu(false); setPinned(true); };
  const unpin = () => { keep("bankRailPin", "0"); setPinned(false); };
  if (pinned) return <Unpin unpin={unpin} />;
  return <>
    {createPortal(<nav ref={nav} className="bkr" aria-label="FinCom menu" data-bank-rail="">
      <button type="button" className="bkr-btn bkr-menu" data-rail-menu="" aria-expanded={menu} aria-label="Open the full menu" onClick={() => { setOpen(null); setMenu(!menu); }}>
        <Menu width={18} height={18} strokeWidth={1.8} aria-hidden="true" /><span className="bkr-word" aria-hidden="true">Menu</span></button>
      <div className="bkr-sep" />
      {railItems().map((it) => <Item key={it.k} it={it} open={open} setOpen={setOpen} />)}
    </nav>, document.body)}
    {menu && <MenuHead pin={pin} close={() => setMenu(false)} />}
  </>;
}
