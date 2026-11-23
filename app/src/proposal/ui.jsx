// The proposal's shared parts: the frame (left nav, top bar with search and + New, phone tab bar), the one status pill,
// money and date helpers, the skeleton. Design proposal only: nothing here is used by the live app.
import { Home, Users, CalendarCheck, ListChecks, Settings, CircleHelp, Landmark, ReceiptText, TrendingUp, Percent, BookOpen,
  Search, Plus, Bell, ChevronDown, Plug, Menu, Ellipsis } from "lucide-react";
import { FIRM, CLIENT } from "./data.js";

// ₹12,34,567 (Indian grouping) and ₹12.3 L / ₹1.2 Cr for figures at a glance
export const inr = (n, d = 0) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const short = (n) => n >= 1e7 ? "₹" + (n / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr" : n >= 1e5 ? "₹" + (n / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L" : inr(n);

// ONE set of status words, everywhere (see the plan, "Status words")
export const STATUS = {
  new: { w: "New", tone: "slate" },
  review: { w: "To review", tone: "amber" },
  ready: { w: "Ready", tone: "sky" },
  done: { w: "Done", tone: "emerald" },
  problem: { w: "Problem", tone: "rose" },
};
export function Pill({ st, extra }) {
  const s = STATUS[st];
  return <span className="p-pill" data-tone={s.tone}><i aria-hidden="true" />{s.w}{extra ? <em> · {extra}</em> : null}</span>;
}
export function Due({ tone, children }) { return <span className="p-due" data-t={tone}>{children}</span>; }

export const Sk = ({ w = "100%", h = 12, r = 6 }) => <span className="p-sk" style={{ width: w, height: h, borderRadius: r }} />;

const FIRM_NAV = [["home", "Home", Home], ["clients", "Clients", Users], ["dues", "Due dates", CalendarCheck], ["daily", "Daily Check", ListChecks], ["tally", "Tally", Plug]];
const CLIENT_NAV = [["home", "Home", Home], ["bank", "Bank", Landmark], ["purchase", "Purchase", ReceiptText], ["sales", "Sales", TrendingUp],
  ["returns", "GST · TDS · ITR", Percent], ["books", "Books", BookOpen], ["tally", "Tally", Plug]];
const COUNTS = { firm: { home: 7 }, client: { bank: 12, purchase: 3 } };

function Side({ scope, active, tallyOff, noCounts }) {
  const nav = scope === "firm" ? FIRM_NAV : CLIENT_NAV;
  return <aside className="p-side">
    <div className="p-brand"><span className="p-mark">F</span><b>FinCom</b></div>
    <button className="p-scope">
      <span className="p-av" data-firm={scope === "firm" ? "" : undefined}>{scope === "firm" ? FIRM.initials : CLIENT.initials}</span>
      <span className="p-scope-w"><b>{scope === "firm" ? FIRM.name : CLIENT.short}</b><small>{scope === "firm" ? FIRM.clients + " clients" : "GSTIN " + CLIENT.gstin}</small></span>
      <ChevronDown size={15} />
    </button>
    <nav className="p-nav">
      {nav.map(([k, w, I]) => <a key={k} className="p-navi" aria-current={k === active ? "page" : undefined}><I size={18} strokeWidth={1.8} /><span>{w}</span>
        {!noCounts && COUNTS[scope][k] ? <b className="p-count">{COUNTS[scope][k]}</b> : null}</a>)}
    </nav>
    <div className="p-grow" />
    <div className="p-side-foot">
      <div className="p-tally-line">{tallyOff ? <><i className="p-dot" />Tally not connected</> : <><i className="p-dot" data-t="ok" />Tally connected · 2 min ago</>}</div>
      <div className="p-foot-links"><a><Settings size={16} />Settings</a><a><CircleHelp size={16} />Help</a></div>
    </div>
  </aside>;
}

export function TopBar({ title, sub, crumb, actions, newOpen }) {
  return <header className="p-top">
    <div className="p-top-title">
      {crumb && <div className="p-crumb">{crumb}</div>}
      <h1>{title}</h1>{sub && <p>{sub}</p>}
    </div>
    <button className="p-search"><Search size={16} /><span>Search clients, parties, invoices, ledgers</span><kbd>Ctrl K</kbd></button>
    <div className="p-top-r">
      {actions}
      <button className="p-btn p-primary" aria-expanded={newOpen || undefined}><Plus size={16} strokeWidth={2.4} />New</button>
      <button className="p-icon" aria-label="Notifications"><Bell size={18} /><i className="p-badge">3</i></button>
      <span className="p-av p-me">{FIRM.initials}</span>
    </div>
  </header>;
}

// the phone's frame: a slim top bar and five tabs at the bottom, the middle one is + New
function PhoneTop({ scope }) {
  return <header className="p-ptop">
    <button className="p-icon" aria-label="Menu"><Menu size={20} /></button>
    <button className="p-pscope"><span className="p-av sm">{scope === "firm" ? FIRM.initials : CLIENT.initials}</span><b>{scope === "firm" ? FIRM.name : CLIENT.short}</b><ChevronDown size={14} /></button>
    <button className="p-icon" aria-label="Search"><Search size={20} /></button>
    <button className="p-icon" aria-label="Notifications"><Bell size={20} /><i className="p-badge">3</i></button>
  </header>;
}
function PhoneTabs({ active }) {
  const t = [["home", "Home", Home], ["bank", "Bank", Landmark], ["new", "", Plus], ["returns", "Returns", Percent], ["more", "More", Ellipsis]];
  return <nav className="p-ptabs">{t.map(([k, w, I]) => k === "new"
    ? <button key={k} className="p-pnew" aria-label="New"><I size={24} strokeWidth={2.4} /></button>
    : <a key={k} aria-current={k === active ? "page" : undefined}><I size={20} strokeWidth={1.8} /><span>{w}</span></a>)}</nav>;
}

export function Shell({ scope = "client", active, children, overlay, phone, tallyOff, noCounts }) {
  return <div className="p-app" data-phone={phone ? "" : undefined}>
    <Side scope={scope} active={active} tallyOff={tallyOff} noCounts={noCounts} />
    <div className="p-main">
      <PhoneTop scope={scope} />
      {children}
    </div>
    <PhoneTabs active={active} />
    {overlay}
  </div>;
}
