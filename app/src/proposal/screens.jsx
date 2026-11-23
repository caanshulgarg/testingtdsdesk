// The proposal's screens (made-up data). Each is one function; main.jsx picks one from ?s=.
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Landmark, Percent, FileText, Sparkles, Mail, Plug, ChevronRight, ChevronDown, Check, Upload,
  ReceiptText, TrendingUp, HandCoins, Wallet, BookOpen, ArrowLeftRight, FileSpreadsheet, Camera, UserPlus, Search, X, Calendar,
  Filter, Download, CircleCheck, Paperclip, Info, RefreshCw, Copy, Inbox, CornerDownLeft, ArrowUp, ArrowDown, Building2, Users, Hash } from "lucide-react";
import { Shell, TopBar, Pill, Due, Sk, inr, short, STATUS } from "./ui.jsx";
import { FIRM, CLIENT, FLOW, BANKS, TODOS, OVERNIGHT_FIRM, DUES, OVERNIGHT_CLIENT, NEXT, LINES, SEARCH, TALLY_COS } from "./data.js";

const Av = ({ t }) => <span className="p-av sm">{t}</span>;

/* ---------------------------------------------------------------- Home (firm) */
export function FirmHome({ overlay }) {
  return <Shell scope="firm" active="home" overlay={overlay}>
    <TopBar title={"Good morning, " + FIRM.user} sub="Sunday, 22-Nov-2026 · 24 clients · 7 things need you" />
    <div className="p-page">
      <div className="p-tiles">
        <Tile k="Needs you" v="7" s="2 overdue" tone="rose" />
        <Tile k="To review" v="46" s="bills and bank lines" tone="amber" />
        <Tile k="Ready for Tally" v="128" s="across 6 clients" tone="sky" />
        <Tile k="Due this fortnight" v="4" s="next: TDS on 7-Dec" tone="indigo" />
      </div>
      <div className="p-cols">
        <section className="p-card p-grow2">
          <div className="p-card-h"><h2>To-dos</h2>
            <div className="p-chips"><Chip on n={7}>All</Chip><Chip n={2}>Overdue</Chip><Chip n={2}>Today</Chip><Chip n={1}>Waiting on client</Chip><Chip>Mine</Chip></div></div>
          <div className="p-todo">
            {TODOS.map((t, i) => <div className="p-todo-r" key={i}>
              <Av t={t.ci} /><div className="p-todo-w"><b>{t.task}</b><small>{t.c}</small></div>
              <Due tone={t.tone}>{t.due}</Due><Pill st={t.st} /><button className="p-btn p-sm">{t.act}</button>
            </div>)}
          </div>
          <a className="p-more-link">See all 31 to-dos <ChevronRight size={14} /></a>
        </section>
        <aside className="p-stack">
          <section className="p-card">
            <div className="p-card-h"><h2><Sparkles size={16} className="p-ic-brand" />Overnight, FinCom…</h2></div>
            <ul className="p-night">{OVERNIGHT_FIRM.map((x, i) => <li key={i}><b>{x.n}</b><span>{x.t}</span></li>)}</ul>
            <a className="p-more-link">What changed, client by client <ChevronRight size={14} /></a>
          </section>
          <section className="p-card">
            <div className="p-card-h"><h2>Coming up</h2></div>
            <ul className="p-dues">{DUES.map((d, i) => <li key={i}><span className="p-date"><b>{d.d.split("-")[0]}</b><small>{d.d.split("-")[1]}</small></span><span><b>{d.w}</b><small>{d.n}</small></span></li>)}</ul>
          </section>
        </aside>
      </div>
    </div>
  </Shell>;
}
function Tile({ k, v, s, tone }) { return <button className="p-tile" data-tone={tone}><span>{k}</span><b>{v}</b><small>{s}</small></button>; }
function Chip({ on, n, children }) { return <button className="p-chip" aria-pressed={on ? "true" : "false"}>{children}{n != null && <em>{n}</em>}</button>; }

/* ---------------------------------------------------------------- Client Home */
function FlowChart() {
  const max = 1600000, H = 130, W = 720;
  return <figure className="p-chart" aria-label="Money in and out, last six months">
    <div className="p-legend"><span><i data-s="in" />Money in</span><span><i data-s="out" />Money out</span></div>
    <svg viewBox={"0 -10 " + W + " " + (H + 34)} role="img">
      {[[0, "0"], [.5, "₹8 L"], [1, "₹16 L"]].map(([g, l]) => <g key={g}><line x1="44" x2={W} y1={H - g * H + .5} y2={H - g * H + .5} className="p-grid" />
        <text x="36" y={H - g * H + 4} textAnchor="end" className="p-axis">{l}</text></g>)}
      {FLOW.map((f, i) => {
        const x = 78 + i * 108, hi = f.in / max * H, ho = f.out / max * H;
        return <g key={f.m}><title>{f.m}: in {inr(f.in)}, out {inr(f.out)}</title>
          <path d={bar(x, H, 22, hi)} className="p-bar-in" /><path d={bar(x + 24, H, 22, ho)} className="p-bar-out" />
          <text x={x + 23} y={H + 18} textAnchor="middle" className="p-axis">{f.m}</text></g>;
      })}
    </svg>
  </figure>;
}
// a bar with 4px rounded top, square on the baseline
const bar = (x, base, w, h) => { const r = Math.min(4, h); return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`; };

const NIGHT_IC = { read: Mail, bank: Landmark, tally: Plug, gst: FileText };
export function ClientHome({ overlay, phone }) {
  const now = FLOW[FLOW.length - 1];
  return <Shell scope="client" active="home" overlay={overlay} phone={phone}>
    <TopBar title="Home" crumb={<>{CLIENT.name} <span className="p-gst">GSTIN {CLIENT.gstin}</span> <span className="p-fy">{CLIENT.fy}</span></>} newOpen={!!overlay} />
    <div className="p-page">
      <div className="p-tiles p-tiles5">
        <Money k="Money in · Nov" v={now.in} s="+8% vs Nov 2025" Icon={ArrowDownLeft} tone="sky" />
        <Money k="Money out · Nov" v={now.out} s="Bills ₹5.7 L · salaries ₹4.1 L" Icon={ArrowUpRight} tone="indigo" />
        <Money k="Bank balance" v={BANKS[0].bal + BANKS[1].bal} s="2 accounts · 21-Nov" Icon={Landmark} tone="teal" />
        <Money k="GST to pay · Nov" v={182340} s="GSTR-3B due 20-Dec" Icon={FileText} tone="violet" />
        <Money k="TDS to pay · Nov" v={24500} s="Due 7-Dec · 194C, 194J" Icon={Percent} tone="amber" warn />
      </div>
      <section className="p-card p-next">
        <div className="p-card-h"><h2>Do next</h2><span className="p-quiet">3 things, most urgent first</span></div>
        <div className="p-next-g">{NEXT.map((n, i) => <div className="p-next-i" key={i} data-tone={n.tone === "warn" ? "amber" : "indigo"}>
          <span className="p-next-n">{i + 1}</span><div><b>{n.t}</b><small>{n.s}</small></div>
          <button className={"p-btn " + (i === 0 ? "p-primary" : "")}>{n.b}</button></div>)}</div>
      </section>
      <div className="p-cols">
        <section className="p-card p-grow2">
          <div className="p-card-h"><h2>Money in and out</h2><div className="p-seg"><button>3 M</button><button aria-pressed="true">6 M</button><button>FY</button></div></div>
          <FlowChart />
          <div className="p-banks">{BANKS.map((b) => <div key={b.no} className="p-bank"><Landmark size={16} /><span><b>{b.name} ••{b.no}</b><small>as of {b.asOf}</small></span><b className="p-num">{inr(b.bal)}</b></div>)}</div>
        </section>
        <section className="p-card">
          <div className="p-card-h"><h2><Sparkles size={16} className="p-ic-brand" />Overnight, FinCom…</h2></div>
          <ul className="p-night2">{OVERNIGHT_CLIENT.map((x, i) => { const I = NIGHT_IC[x.icon]; return <li key={i}><i><I size={15} /></i><span><b>{x.t}</b><small>{x.s}</small></span></li>; })}</ul>
          <a className="p-more-link">Activity log <ChevronRight size={14} /></a>
        </section>
      </div>
    </div>
  </Shell>;
}
function Money({ k, v, s, Icon, tone, warn }) {
  return <button className="p-tile p-money" data-tone={tone}><span>{k}<i><Icon size={15} /></i></span><b>{short(v)}</b><small>{warn ? <Due tone="warn">{s}</Due> : s}</small></button>;
}

/* ---------------------------------------------------------------- + New menu */
const NEW_REC = [["Bill", "Purchase", ReceiptText, "F9"], ["Sale invoice", "Sales", TrendingUp, "F8"], ["Receipt", "Money in", HandCoins, "F6"],
  ["Payment", "Money out", Wallet, "F5"], ["Journal", "Adjustment", BookOpen, "F7"], ["Contra", "Bank to cash, bank to bank", ArrowLeftRight, "F4"]];
const NEW_IN = [["Upload a bank statement", "PDF, Excel or CSV from any bank", Landmark], ["Upload bills", "PDF or phone photo; FinCom reads them", Camera],
  ["Import from Excel", "Sales or purchase register", FileSpreadsheet], ["New client", "With GSTIN, PAN and Tally company", UserPlus]];
export function NewMenu() {
  return <div className="p-pop p-newpop" role="menu">
    <div className="p-newcols">
      <div><h3>Record</h3>{NEW_REC.map(([t, s, I, k]) => <a key={t} className="p-newi"><i><I size={17} /></i><span><b>{t}</b><small>{s}</small></span><kbd title="Same key as Tally">{k}</kbd></a>)}</div>
      <div><h3>Bring in</h3>{NEW_IN.map(([t, s, I]) => <a key={t} className="p-newi"><i><I size={17} /></i><span><b>{t}</b><small>{s}</small></span></a>)}
        <div className="p-drop"><Upload size={18} /><span>Or drop any file here: FinCom works out what it is</span></div></div>
    </div>
    <div className="p-pop-foot"><Info size={14} />Keys match Tally's: <kbd>F9</kbd> bill, <kbd>F8</kbd> sale, <kbd>F5</kbd> payment. For <b>{CLIENT.short}</b></div>
  </div>;
}

/* ---------------------------------------------------------------- Search (Ctrl+K) */
const G_IC = { Clients: Building2, Parties: Users, Invoices: ReceiptText, Ledgers: BookOpen, Do: Sparkles };
export function SearchPalette() {
  let n = 0;
  return <div className="p-scrim"><div className="p-palette" role="dialog" aria-label="Search">
    <div className="p-pal-in"><Search size={18} /><input defaultValue="sharma" aria-label="Search" /><span className="p-pal-scope">All clients ▾</span><kbd>Esc</kbd></div>
    <div className="p-chips p-pal-chips"><Chip on>All</Chip><Chip n={1}>Clients</Chip><Chip n={2}>Parties</Chip><Chip n={2}>Invoices</Chip><Chip n={1}>Ledgers</Chip></div>
    <div className="p-pal-res">{SEARCH.map((g) => { const I = G_IC[g.g]; return <div key={g.g}><h3>{g.g === "Do" ? "Actions" : g.g}</h3>
      {g.items.map((x) => { const on = n++ === 0; return <a key={x.t + x.s} className="p-pal-i" aria-selected={on || undefined}><i><I size={16} /></i>
        <span><b dangerouslySetInnerHTML={{ __html: x.t.replace(/sharma/i, (m) => "<mark>" + m + "</mark>") }} /><small>{x.s}</small></span>{on && <CornerDownLeft size={15} className="p-enter" />}</a>; })}</div>; })}</div>
    <div className="p-pop-foot"><span><kbd><ArrowUp size={11} /></kbd><kbd><ArrowDown size={11} /></kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Tab</kbd> narrow</span><span className="p-grow" />Also finds GSTINs, PANs, amounts (“47200”) and pages (“GSTR-1”)</div>
  </div></div>;
}

/* ---------------------------------------------------------------- Bank list */
export function Bank({ state = "full", phone }) {
  const [open] = useState(1);
  const sel = new Set([2, 3, 8]);
  const rows = LINES;
  const c = (n) => state === "full" ? n : state === "loading" ? "…" : 0;
  const tot = rows.reduce((a, r) => ({ out: a.out + r.out, in: a.in + r.in }), { out: 0, in: 0 });
  return <Shell scope="client" active="bank" phone={phone} noCounts={state === "empty"}>
    <TopBar title="Bank" crumb={<>{CLIENT.name}</>} actions={<button className="p-btn"><Upload size={15} />Upload statement</button>} />
    <div className="p-page">
      <div className="p-acct">{BANKS.map((b, i) => <button key={b.no} className="p-acct-i" aria-pressed={i === 0}><Landmark size={16} /><span><b>{b.name} ••{b.no}</b><small>{state === "empty" && i === 0 ? "No statement yet" : inr(b.bal) + " · " + b.asOf}</small></span>{i === 0 && state === "full" && <em className="p-count">12</em>}</button>)}
        <button className="p-acct-add">+ Add account</button></div>
      <section className="p-card p-list">
        <div className="p-list-bar">
          <div className="p-chips"><Chip on n={c(248)}>All</Chip><Chip n={c(12)}>To review</Chip><Chip n={c(30)}>Ready</Chip><Chip n={c(204)}>Done</Chip>{state === "full" && <Chip n={2}>Problem</Chip>}
            <button className="p-chip p-chip-add"><Filter size={13} />Party, amount…</button></div>
          <div className="p-list-tools"><span className="p-mini-search"><Search size={14} />Search lines</span><button className="p-btn p-sm"><Calendar size={14} />1-Nov – 21-Nov-2026</button><button className="p-icon" aria-label="Download"><Download size={16} /></button></div>
        </div>
        {state === "full" && <div className="p-bulk"><b>3 selected</b><span className="p-quiet">₹2,08,530</span><button className="p-btn p-sm">Set ledger ▾</button><button className="p-btn p-sm p-primary">Post 3 to Tally</button><button className="p-btn p-sm p-ghost">Not business</button><span className="p-grow" /><button className="p-icon" aria-label="Clear"><X size={16} /></button></div>}
        {state === "empty" ? <Empty /> : <table className="p-table">
          <thead><tr><th className="p-ck"><input type="checkbox" readOnly /></th><th>Date</th><th>Narration</th><th>Ledger</th><th className="p-r">Money out</th><th className="p-r">Money in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {state === "loading" ? [...Array(8)].map((_, i) => <tr key={i} className="p-skrow"><td className="p-ck"><Sk w={14} h={14} r={4} /></td><td><Sk w={44} /></td><td><Sk w={i % 2 ? "70%" : "85%"} /></td><td><Sk w="60%" /></td><td className="p-r"><Sk w={64} /></td><td className="p-r"><Sk w={56} /></td><td><Sk w={72} h={20} r={10} /></td><td /></tr>)
              : rows.map((r) => <Row key={r.id} r={r} sel={sel.has(r.id)} open={open === r.id} />)}
          </tbody>
          {state === "full" && <tfoot><tr><td /><td colSpan={3}>10 of 248 lines shown · <b>Closing balance {inr(BANKS[0].bal)}</b></td><td className="p-r p-num">{inr(tot.out)}</td><td className="p-r p-num">{inr(tot.in)}</td><td colSpan={2} /></tr></tfoot>}
        </table>}
      </section>
    </div>
  </Shell>;
}
function Row({ r, sel, open }) {
  return <>
    <tr className={"p-row" + (sel ? " p-sel" : "") + (open ? " p-open" : "")}>
      <td className="p-ck"><input type="checkbox" checked={sel} readOnly /></td>
      <td className="p-nowrap">{r.d}</td>
      <td><span className="p-narr">{r.desc}</span></td>
      <td>{r.led ? <span className="p-led">{r.sug && r.st === "review" && <Sparkles size={13} className="p-ic-brand" title="FinCom suggests" />}{r.led}</span> : <button className="p-btn p-sm p-dashed">Choose ledger</button>}</td>
      <td className="p-r p-num">{r.out ? inr(r.out) : ""}</td>
      <td className="p-r p-num p-in">{r.in ? inr(r.in) : ""}</td>
      <td><Pill st={r.st} extra={r.st === "done" ? "in Tally" : null} /></td>
      <td className="p-r">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} className="p-quiet" />}</td>
    </tr>
    {open && r.match && <tr className="p-exp"><td /><td colSpan={7}>
      <div className="p-exp-in"><Sparkles size={16} className="p-ic-brand" /><div><b>Matches {r.match.what}</b><small>{inr(r.match.amt)} · billed {r.match.date} · {r.match.why}</small></div>
        <span className="p-grow" /><button className="p-btn p-sm p-primary"><Check size={14} />Confirm match</button><button className="p-btn p-sm">Pick another</button><button className="p-btn p-sm p-ghost">Split</button></div>
    </td></tr>}
    {r.why && <tr className="p-exp p-exp-bad"><td /><td colSpan={7}><div className="p-exp-in"><span>{r.why}</span><span className="p-grow" /><button className="p-btn p-sm">Use ‘Rent – Office’</button></div></td></tr>}
  </>;
}
function Empty() {
  return <div className="p-empty">
    <div className="p-empty-ic"><Landmark size={26} /></div>
    <h3>No statement for HDFC ••4521 yet</h3>
    <p>Drop the bank's PDF or Excel here. FinCom reads it, suggests a ledger for each line, and you confirm.</p>
    <div className="p-row-btns"><button className="p-btn p-primary"><Upload size={15} />Upload statement</button><button className="p-btn">Ask the client for it</button></div>
    <small className="p-quiet">Works with statements from HDFC, ICICI, SBI, Axis, Kotak and 40+ other banks</small>
  </div>;
}

/* ---------------------------------------------------------------- Entry form (a bill) */
export function Entry() {
  return <Shell scope="client" active="purchase">
    <TopBar title="New bill" crumb={<>{CLIENT.name} › Purchase</>} actions={<span className="p-saved"><CircleCheck size={14} />Draft saved</span>} />
    <div className="p-page p-form-page">
      <section className="p-card p-form">
        <div className="p-fgrid">
          <Field label="Supplier" wide><div className="p-input p-sel"><b>Mehta Design Studio LLP</b><small>27AAKFM5512Q1Z3 · Maharashtra</small><ChevronDown size={15} /></div></Field>
          <Field label="Bill no."><div className="p-input">MDS/26-27/118</div></Field>
          <Field label="Bill date"><div className="p-input">17-Nov-2026 <Calendar size={14} /></div></Field>
          <Field label="Due date"><div className="p-input">17-Dec-2026 <span className="p-quiet">30 days</span></div></Field>
          <Field label="Place of supply"><div className="p-input">07 · Delhi</div></Field>
        </div>
        <table className="p-lines">
          <thead><tr><th>Ledger</th><th>HSN / SAC</th><th className="p-r">Amount</th><th>GST</th><th className="p-r">Tax</th></tr></thead>
          <tbody>
            <tr><td><div className="p-input p-sel">Professional Fees <ChevronDown size={14} /></div></td><td><div className="p-input">998391</div></td><td><div className="p-input p-r p-num">75,000.00</div></td><td><div className="p-input">18% <ChevronDown size={14} /></div></td><td className="p-r p-num">13,500.00</td></tr>
            <tr className="p-addline"><td colSpan={5}><button className="p-btn p-sm p-ghost">+ Add a line</button><span className="p-quiet">or press Enter on the last line</span></td></tr>
          </tbody>
        </table>
        <div className="p-auto">
          <div className="p-auto-box" data-tone="sky"><div className="p-auto-h"><Sparkles size={15} />GST worked out</div>
            <p>Maharashtra → Delhi is inter-state, so <b>IGST 18%: ₹13,500</b>. A Delhi supplier would split into CGST 9% + SGST 9%.</p>
            <a className="p-link">Change</a></div>
          <div className="p-auto-box" data-tone="amber"><div className="p-auto-h"><Percent size={15} />TDS suggested: 194J, 10%</div>
            <p>Professional fees to this LLP cross ₹50,000 this year (₹1,35,000 with this bill). Deduct <b>₹7,500</b>; pay ₹81,000.</p>
            <div className="p-row-btns"><button className="p-btn p-sm p-primary"><Check size={14} />Deduct ₹7,500</button><button className="p-btn p-sm p-ghost">Not now</button></div></div>
        </div>
        <div className="p-attach"><Paperclip size={15} /><b>MDS-118.pdf</b><span className="p-quiet">read by FinCom · supplier, number, date and amount filled in</span></div>
      </section>
      <aside className="p-card p-voucher">
        <div className="p-card-h"><h2>As it goes to Tally</h2><span className="p-quiet">Purchase · F9</span></div>
        <table className="p-drcr">
          <thead><tr><th /><th>Ledger</th><th className="p-r">Debit</th><th className="p-r">Credit</th></tr></thead>
          <tbody>
            <tr><td className="p-dc">Dr</td><td>Professional Fees</td><td className="p-r p-num">75,000.00</td><td /></tr>
            <tr><td className="p-dc">Dr</td><td>Input IGST 18%</td><td className="p-r p-num">13,500.00</td><td /></tr>
            <tr><td className="p-dc">Cr</td><td>Mehta Design Studio LLP</td><td /><td className="p-r p-num">81,000.00</td></tr>
            <tr><td className="p-dc">Cr</td><td>TDS Payable – 194J</td><td /><td className="p-r p-num">7,500.00</td></tr>
          </tbody>
          <tfoot><tr><td /><td>Total</td><td className="p-r p-num">88,500.00</td><td className="p-r p-num">88,500.00</td></tr></tfoot>
        </table>
        <div className="p-balanced"><CircleCheck size={16} />Balanced · all 4 ledgers exist in Tally</div>
        <div className="p-form-btns">
          <button className="p-btn p-primary p-lg">Save and post to Tally <kbd>Ctrl ↵</kbd></button>
          <div className="p-row-btns"><button className="p-btn">Save and new</button><button className="p-btn p-ghost">Save draft</button></div>
        </div>
      </aside>
    </div>
  </Shell>;
}
function Field({ label, wide, children }) { return <label className={"p-field" + (wide ? " p-wide" : "")}><span>{label}</span>{children}</label>; }

/* ---------------------------------------------------------------- Tally, one page */
export function Tally({ state = "linking" }) {
  const fresh = state === "new";
  const steps = [
    { t: "Install FinCom Bridge on the Tally computer", s: "One download, about 2 minutes. Runs quietly next to Tally.", done: !fresh, b: "Download for Windows" },
    { t: "Turn on Tally's connection", s: "In TallyPrime: F1 Help › Settings › Connectivity › set ‘TallyPrime acts as’ to Both, port 9000.", done: !fresh, b: "Check again" },
    { t: "Link each Tally company to its client", s: fresh ? "FinCom lists the companies open in Tally and suggests the client for each." : "14 of 16 linked. 2 companies are open in Tally without a client.", done: false, b: "Link 2 companies" },
  ];
  const now = fresh ? 0 : 2;
  return <Shell scope="firm" active="tally" tallyOff={fresh}>
    <TopBar title="Tally" sub={fresh ? "Connect once; FinCom then reads and posts by itself" : null} />
    <div className="p-page">
      <div className="p-status" data-t={fresh ? "muted" : "ok"}>
        <i className="p-dot" data-t={fresh ? "muted" : "ok"} />
        {fresh ? <span><b>Not connected yet.</b> Three steps, about 5 minutes.</span>
          : <span><b>Connected.</b> TallyPrime 5.1 on OFFICE-PC · last sync 2 min ago · 14 of 16 clients linked</span>}
        <span className="p-grow" />
        {!fresh && <button className="p-btn p-sm"><RefreshCw size={14} />Sync now</button>}
      </div>
      <section className="p-card p-steps">
        <div className="p-card-h"><h2>{fresh ? "Connect Tally" : "Set-up"}</h2><span className="p-quiet">{fresh ? "Step 1 of 3" : "2 of 3 done"}</span></div>
        <ol>{steps.map((x, i) => <li key={i} data-s={x.done ? "done" : i === now ? "now" : "later"}>
          <span className="p-step-n">{x.done ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
          <div><b>{x.t}</b>{(i === now || fresh) && <small>{x.s}</small>}
            {i === 1 && i === now && <div className="p-copy">Port <code>9000</code><Copy size={13} /></div>}</div>
          {i === now ? <button className="p-btn p-primary">{x.b}</button> : x.done ? <span className="p-quiet">Done</span> : null}
        </li>)}</ol>
      </section>
      {!fresh && <section className="p-card p-list">
        <div className="p-tabs"><button aria-selected="true">Companies <em>16</em></button><button>Sent to Tally <em>54 today</em></button><button>Settings</button></div>
        <table className="p-table">
          <thead><tr><th>Company in Tally</th><th>FinCom client</th><th>Status</th><th>Last sync</th><th /></tr></thead>
          <tbody>{TALLY_COS.map((c) => <tr key={c.co} className="p-row">
            <td><b>{c.co}</b></td>
            <td>{c.cl || <span className="p-sugg"><Sparkles size={13} className="p-ic-brand" />{c.co.startsWith("Patil") ? "Patil Auto Spares?" : "Arora Pharma Distributors?"}</span>}</td>
            <td><Pill st={c.st} extra={c.st === "done" ? "linked" : "not linked"} /></td>
            <td className="p-quiet">{c.last}</td>
            <td className="p-r">{c.cl ? <ChevronRight size={16} className="p-quiet" /> : <button className="p-btn p-sm p-primary">Link</button>}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>Showing 6 of 16 · <a className="p-link">Show all</a></td></tr></tfoot>
        </table>
      </section>}
      <details className="p-card p-details"><summary><ChevronRight size={15} />Details and help <span className="p-quiet">bridge version, computers, log, what FinCom reads and writes</span></summary></details>
    </div>
  </Shell>;
}

/* ---------------------------------------------------------------- the system sheet */
export function System() {
  return <div className="p-sys">
    <h1>FinCom design system · proposal</h1>
    <p className="p-quiet">One sheet: the five status words, buttons, money and dates, loading, empty, saved.</p>
    <div className="p-sys-g">
      <section className="p-card"><h2>Status: five words, everywhere</h2>
        {Object.keys(STATUS).map((k) => <div className="p-sys-r" key={k}><Pill st={k} /><span className="p-quiet">{({ new: "Came in, nobody has looked yet", review: "FinCom has a suggestion; a person confirms", ready: "Confirmed; will post or file", done: "Posted to Tally, filed or paid", problem: "Stopped; the row says why and what to do" })[k]}</span></div>)}
        <div className="p-sys-r"><Pill st="done" extra="in Tally" /><Pill st="done" extra="filed 18-Nov" /><span className="p-quiet">a short ‘where’ may follow</span></div>
        <div className="p-sys-r"><Due tone="bad">Overdue 2 days</Due><Due tone="warn">Due today</Due><Due tone="muted">Due 7-Dec</Due><span className="p-quiet">due dates are separate from status</span></div>
      </section>
      <section className="p-card"><h2>Buttons: one main action per page</h2>
        <div className="p-sys-r"><button className="p-btn p-primary">Post 3 to Tally</button><button className="p-btn">Upload statement</button><button className="p-btn p-ghost">Not now</button><button className="p-btn p-danger">Delete bill</button></div>
        <div className="p-sys-r"><span className="p-quiet">Verb first, says what happens: “Post to Tally”, “File GSTR-1”, “Make challan”. Never “Submit”, “Proceed”, “Update now”.</span></div>
        <h2>Money and dates</h2>
        <div className="p-sys-r"><b className="p-num">₹12,34,567.00</b><span className="p-quiet">in tables and forms</span></div>
        <div className="p-sys-r"><b className="p-num">₹12.35 L · ₹1.24 Cr</b><span className="p-quiet">on tiles and summaries</span></div>
        <div className="p-sys-r"><b>21-Nov-2026 · Nov 2026 · FY 2026-27 · Q3</b><span className="p-quiet">never 11/21/2026</span></div>
      </section>
      <section className="p-card"><h2>Loading: a skeleton in the page's shape</h2>
        <div className="p-sk-card"><Sk w="40%" h={14} /><Sk w="70%" h={28} /><Sk w="55%" /></div>
        <div className="p-sk-card">{[0, 1, 2].map((i) => <div className="p-sk-line" key={i}><Sk w={28} h={28} r={14} /><Sk w={i ? "60%" : "75%"} /><Sk w={64} h={20} r={10} /></div>)}</div>
        <p className="p-quiet">No spinner under 1 second. Rows keep their height, so nothing jumps when data arrives.</p>
      </section>
      <section className="p-card"><h2>Optimistic: done at once, undo for 8 seconds</h2>
        <div className="p-toast"><CircleCheck size={16} /><span><b>3 lines posted to Tally</b></span><button className="p-link">Undo</button></div>
        <div className="p-toast" data-t="bad"><Info size={16} /><span><b>Tally refused 1 line:</b> ledger ‘Rent’ is closed</span><button className="p-link">Fix</button></div>
        <p className="p-quiet">The row turns Done the moment you click. If Tally refuses, the row turns Problem and says why, with the fix as a button.</p>
      </section>
    </div>
  </div>;
}
