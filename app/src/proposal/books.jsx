// Full-books mockups (docs/FULL-BOOKS-PLAN.md): own books, Tally or Zoho per client. Made-up data only; standalone pages,
// not linked from the live app. Every figure on these pages adds up: the screens compute their totals from the rows.
import { BookOpen, Plug, Cloud, Check, CircleCheck, ChevronRight, ChevronDown, Calendar, Download, Search, Lock, ShieldCheck,
  Sparkles, Info, FileText, Printer, Send, History, UserRound, ArrowRight, RefreshCw, KeyRound, Landmark, Filter, Hash, Building2, CircleAlert } from "lucide-react";
import { Shell, TopBar, Pill, inr } from "./ui.jsx";
import { CLIENT } from "./data.js";
import "./books.css";

const r2 = (n) => Math.round(n * 100) / 100;
const amt = (n) => n ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
const sum = (a, f) => r2(a.reduce((s, x) => s + f(x), 0));
const Crumb = ({ children }) => <>{CLIENT.name} <span className="p-gst">GSTIN {CLIENT.gstin}</span> <span className="p-fy">{CLIENT.fy}</span>{children}</>;
const Mode = ({ k = "own" }) => <span className="p-bk-mode" data-k={k}>{k === "own" ? <><BookOpen size={12} />Own books</> : k === "tally" ? <><Plug size={12} />Tally</> : <><Cloud size={12} />Zoho Books</>}</span>;
const Chip = ({ on, n, children }) => <button className="p-chip" aria-pressed={on ? "true" : "false"}>{children}{n != null && <em>{n}</em>}</button>;

/* ================================================================ 1. choosing the books mode */
const MODES = [
  { k: "own", I: BookOpen, t: "Own books", s: "FinCom keeps the books", tag: "New",
    pts: [["Entries", "Made in FinCom: invoices, bills, bank, journals"], ["Audit trail", "Built in, cannot be switched off (Rule 3(1))"], ["Period locks", "Enforced: a filed month cannot be changed"], ["Reports", "Straight from the vouchers, Schedule III ready"]] },
  { k: "tally", I: Plug, t: "Tally", s: "Tally keeps the books; FinCom reads and posts", tag: "Today",
    pts: [["Entries", "Posted to Tally through FinCom Bridge"], ["Audit trail", "Tally's own edit log"], ["Period locks", "FinCom warns; Tally decides"], ["Reports", "From the copy the bridge sends"]] },
  { k: "zoho", I: Cloud, t: "Zoho Books", s: "Zoho keeps the books; FinCom reads and posts",
    pts: [["Entries", "Created in Zoho by FinCom; edits stay in Zoho"], ["Audit trail", "Zoho's own history"], ["Period locks", "Zoho's transaction lock"], ["Reports", "From Zoho, read every 15 minutes"]] },
];
export function BooksMode() {
  const pick = "own";
  return <Shell scope="client" active="books">
    <TopBar title="Where the books are kept" crumb={<Crumb />} />
    <div className="p-page">
      <div className="p-status" data-t="muted"><Plug size={16} /><span><b>Today: Tally.</b> Kaveri Home Decor (2026-27) on OFFICE-PC · last read 2 min ago · 1,286 entries this year</span></div>
      <div className="p-bk-modes" role="radiogroup" aria-label="Books mode">
        {MODES.map((m) => <button key={m.k} className="p-bk-mcard" role="radio" aria-checked={m.k === pick}>
          <div className="p-bk-mhead"><i><m.I size={20} /></i><span><b>{m.t}</b><small>{m.s}</small></span>{m.tag && <em data-k={m.tag}>{m.tag}</em>}<span className="p-bk-radio" /></div>
          <dl>{m.pts.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
        </button>)}
      </div>
      <section className="p-card p-bk-when">
        <div className="p-card-h"><h2>Move Kaveri Home Decor to own books</h2><span className="p-quiet">Nothing changes in Tally</span></div>
        <div className="p-bk-wgrid">
          <label className="p-field"><span>Own books start on</span><div className="p-input">1-Apr-2026 <Calendar size={14} /></div><small>The whole of FY 2026-27 is copied from Tally, so the year stays in one place</small></label>
          <label className="p-field"><span>Run both in parallel</span><div className="p-input">30 days <ChevronDown size={14} /></div><small>FinCom compares the two every night; you switch when they match</small></label>
        </div>
        <ol className="p-bk-mini">
          <li><b>1</b>Copy masters, openings and entries from Tally</li><li><b>2</b>Prove they tie to the paisa</li><li><b>3</b>Switch; Tally stays as read-only history</li>
        </ol>
        <div className="p-row-btns p-bk-end"><button className="p-btn p-ghost">Keep Tally</button><button className="p-btn p-primary">Copy from Tally and check <ArrowRight size={15} /></button></div>
      </section>
    </div>
  </Shell>;
}

/* ================================================================ 2. chart of accounts */
const DEBTORS = [
  { n: "Aanya Living Retail Pvt Ltd", g: "27AAICA6402F1Z8", st: "Maharashtra", b: 920000 },
  { n: "Coastal Stays Pvt Ltd", g: "29AAHCC2290L1Z4", st: "Karnataka", b: 744000 },
  { n: "Sundaram Interiors LLP", g: "07ABCFS1234K1Z9", st: "Delhi", b: 485600 },
  { n: "Meera Boutique Hotels Pvt Ltd", g: "07AAGCM7310P1Z2", st: "Delhi", b: 133200 },
  { n: "18 more parties", g: "", st: "", b: 880000, more: true },
];
const COA = [
  { g: "Capital Account", s3: "Equity · Share capital, Other equity", n: 3, b: -4342600 },
  { g: "Loans (Liability)", s3: "Borrowings", n: 2, b: -1000000 },
  { g: "Current Liabilities", s3: "Trade payables, Other current liabilities, Provisions", n: 46, b: -1955240 },
  { g: "Fixed Assets", s3: "Property, plant and equipment", n: 9, b: 2248000 },
  { g: "Current Assets", s3: "", n: 41, b: 6984750, open: true, kids: [
    { g: "Sundry Debtors", s3: "Trade receivables", n: 22, b: 3162800, open: true },
    { g: "Stock-in-hand", s3: "Inventories", n: 1, b: 1980000 },
    { g: "Bank Accounts", s3: "Cash and cash equivalents", n: 2, b: 1294650 },
    { g: "Cash-in-hand", s3: "Cash and cash equivalents", n: 1, b: 112300 },
    { g: "Loans & Advances (Asset)", s3: "Short-term loans and advances", n: 15, b: 435000 },
  ] },
  { g: "Sales Accounts", s3: "Revenue from operations", n: 4, b: -12463500 },
  { g: "Indirect Incomes", s3: "Other income", n: 3, b: -86400 },
  { g: "Purchase Accounts", s3: "Purchases of stock-in-trade", n: 3, b: 7124600 },
  { g: "Direct Expenses", s3: "Other expenses (direct)", n: 5, b: 680400 },
  { g: "Indirect Expenses", s3: "Employee benefits, Other expenses", n: 28, b: 2809990 },
];
const drcr = (b) => b ? <>{amt(Math.abs(b))} <i className="p-bk-dc">{b > 0 ? "Dr" : "Cr"}</i></> : "–";
export function BooksCoa() {
  return <Shell scope="client" active="books">
    <TopBar title="Chart of accounts" crumb={<Crumb />} actions={<><Mode /><button className="p-btn"><Download size={15} />Excel</button></>} />
    <div className="p-page">
      <section className="p-card p-list">
        <div className="p-list-bar">
          <div className="p-chips"><Chip on n={154}>All</Chip><Chip n={10}>Groups</Chip><Chip n={22}>Parties</Chip><Chip n={2}>Missing GSTIN</Chip><Chip n={3}>Inactive</Chip></div>
          <div className="p-list-tools"><span className="p-mini-search"><Search size={14} />Find a ledger or group</span><button className="p-btn p-sm">+ Group</button><button className="p-btn p-sm p-primary">+ Ledger</button></div>
        </div>
        <table className="p-table p-bk-coa">
          <thead><tr><th>Group / ledger</th><th className="p-bk-hide">Schedule III line</th><th className="p-bk-hide">GSTIN · State</th><th className="p-r">Balance on 22-Nov</th></tr></thead>
          <tbody>
            {COA.map((x) => <CoaRow key={x.g} x={x} lvl={0} />)}
          </tbody>
          <tfoot><tr><td>Net of all balances<span className="p-bk-hide"> · 10 primary groups · 154 ledgers</span></td><td className="p-bk-hide" /><td className="p-bk-hide" /><td className="p-r p-num">{amt(sum(COA, (x) => x.b)) || "0.00"} <span className="p-bk-ok"><Check size={13} />ties</span></td></tr></tfoot>
        </table>
      </section>
      <div className="p-bk-note"><Info size={15} /><span>Groups are Tally's 28, so nothing is new to learn. Each group already knows its <b>Schedule III</b> line, so the balance sheet needs no mapping.</span></div>
    </div>
  </Shell>;
}
function CoaRow({ x, lvl }) {
  return <>
    <tr className="p-row p-bk-grp" data-l={lvl}>
      <td><span className="p-bk-tree" style={{ paddingLeft: lvl * 22 }}>{x.kids || x.open ? <ChevronDown size={15} /> : <ChevronRight size={15} className="p-quiet" />}<b>{x.g}</b><small>{x.n} ledgers</small></span></td>
      <td className="p-bk-hide">{x.s3 ? <span className="p-bk-s3">{x.s3}</span> : <span className="p-quiet">by sub-group</span>}</td>
      <td className="p-bk-hide" />
      <td className="p-r p-num">{drcr(x.b)}</td>
    </tr>
    {x.kids && x.kids.map((k) => <CoaRow key={k.g} x={k} lvl={lvl + 1} />)}
    {x.g === "Sundry Debtors" && DEBTORS.map((d) => <tr key={d.n} className="p-row p-bk-led">
      <td><span className="p-bk-tree" style={{ paddingLeft: 2 * 22 + 22 }}>{d.more ? <a className="p-link">{d.n}</a> : <>{d.n}<small className="p-bk-ph">{d.g}</small></>}</span></td>
      <td className="p-bk-hide" />
      <td className="p-bk-hide">{d.g ? <span className="p-bk-gst"><code>{d.g}</code><small>{d.st} · PAN {d.g.slice(2, 12)}</small></span> : null}</td>
      <td className="p-r p-num">{drcr(d.b)}</td>
    </tr>)}
  </>;
}

/* ================================================================ 3. new sales invoice */
const ITEMS = [
  { d: "Teak console table, 120 cm", hsn: "9403", q: 2, u: "Nos", rate: 18500, gst: 18 },
  { d: "Handloom cotton cushion cover", hsn: "6304", q: 24, u: "Nos", rate: 450, gst: 5 },
];
export function BooksInvoice() {
  const rows = ITEMS.map((x) => ({ ...x, tv: r2(x.q * x.rate), tax: r2(x.q * x.rate * x.gst / 100) }));
  const tv = sum(rows, (x) => x.tv), tax = sum(rows, (x) => x.tax), half = r2(tax / 2), total = r2(tv + tax);
  const v = [["Dr", "Sundaram Interiors LLP", total, 0], ...rows.map((x) => ["Cr", "Sales – " + (x.gst === 18 ? "Furniture 18%" : "Furnishing 5%"), 0, x.tv]), ["Cr", "Output CGST", 0, half], ["Cr", "Output SGST", 0, half]];
  return <Shell scope="client" active="sales">
    <TopBar title="New sales invoice" crumb={<>{CLIENT.name} › Sales</>} actions={<span className="p-saved"><CircleCheck size={14} />Draft saved</span>} />
    <div className="p-page p-bk-inv">
      <section className="p-card p-form">
        <div className="p-fgrid">
          <label className="p-field p-wide"><span>Customer</span><div className="p-input p-sel"><b>Sundaram Interiors LLP</b><small>07ABCFS1234K1Z9 · Delhi</small><ChevronDown size={15} /></div></label>
          <label className="p-field"><span>Invoice no.</span><div className="p-input">KHD/26-27/0412 <span className="p-quiet">next in series</span></div></label>
          <label className="p-field"><span>Date</span><div className="p-input">22-Nov-2026 <Calendar size={14} /></div></label>
          <label className="p-field"><span>Place of supply</span><div className="p-input">07 · Delhi</div></label>
          <label className="p-field"><span>Due</span><div className="p-input">22-Dec-2026 <span className="p-quiet">30 days</span></div></label>
        </div>
        <div className="p-bk-scroll"><table className="p-lines p-bk-items">
          <thead><tr><th>Item</th><th>HSN</th><th className="p-r">Qty</th><th className="p-r">Rate</th><th className="p-r">Taxable</th><th>GST</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.d}>
            <td><div className="p-input p-sel">{x.d} <ChevronDown size={14} /></div></td><td><div className="p-input">{x.hsn}</div></td>
            <td><div className="p-input p-r p-num">{x.q} {x.u}</div></td><td><div className="p-input p-r p-num">{amt(x.rate)}</div></td>
            <td className="p-r p-num">{amt(x.tv)}</td><td><div className="p-input">{x.gst}% <ChevronDown size={14} /></div></td></tr>)}
            <tr className="p-addline"><td colSpan={6}><button className="p-btn p-sm p-ghost">+ Add an item</button></td></tr>
          </tbody>
        </table></div>
        <div className="p-auto">
          <div className="p-auto-box" data-tone="sky"><div className="p-auto-h"><Sparkles size={15} />GST worked out</div>
            <p>Delhi to Delhi is intra-state: <b>CGST {amt(half)} + SGST {amt(half)}</b>, line by line (18% on the table, 5% on the covers). A customer in another state would get IGST.</p></div>
          <div className="p-auto-box" data-tone="emerald"><div className="p-auto-h"><FileText size={15} />E-invoice: on</div>
            <p>Kaveri's GSTIN e-invoices, and this customer is registered. On saving, FinCom gets the <b>IRN and QR</b> from the IRP and prints them on the invoice.</p>
            <label className="p-bk-tog"><span className="p-bk-sw" data-on="" />E-way bill: not needed (₹{amt(total).replace(".00", "")}, goods by hand)</label></div>
        </div>
        <details className="p-card p-details p-bk-vd" open><summary><ChevronDown size={15} />The entry it makes · Sales · F8</summary>
          <table className="p-drcr"><tbody>{v.map(([dc, l, d, c]) => <tr key={l}><td className="p-dc">{dc}</td><td>{l}</td><td className="p-r p-num">{amt(d)}</td><td className="p-r p-num">{amt(c)}</td></tr>)}</tbody>
            <tfoot><tr><td /><td>Total</td><td className="p-r p-num">{amt(sum(v, (x) => x[2]))}</td><td className="p-r p-num">{amt(sum(v, (x) => x[3]))}</td></tr></tfoot></table>
          <div className="p-balanced"><CircleCheck size={16} />Balanced · number KHD/26-27/0412 is free in the series</div>
        </details>
      </section>
      <aside className="p-bk-pdfcol">
        <div className="p-bk-pdfbar"><b>PDF preview</b><span className="p-quiet">A4 · your letterhead</span><span className="p-grow" /><button className="p-icon" aria-label="Print"><Printer size={16} /></button></div>
        <div className="p-bk-pdf" aria-label="Invoice PDF preview">
          <div className="p-bk-pdf-h"><div><b>KAVERI HOME DECOR PVT LTD</b><small>14, Shahpur Jat, New Delhi 110049</small><small>GSTIN 07AAJCK4821M1Z5 · PAN AAJCK4821M</small></div><div className="p-bk-pdf-t">TAX INVOICE<small>Original for recipient</small></div></div>
          <div className="p-bk-pdf-2"><div><small>Bill to</small><b>Sundaram Interiors LLP</b><small>GSTIN 07ABCFS1234K1Z9</small><small>Place of supply: 07 Delhi</small></div>
            <div><small>Invoice no.</small><b>KHD/26-27/0412</b><small>Date 22-Nov-2026</small><small>IRN: on saving</small></div><span className="p-bk-qr" aria-label="QR code placeholder" /></div>
          <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>GST</th></tr></thead>
            <tbody>{rows.map((x, i) => <tr key={x.d}><td>{i + 1}</td><td>{x.d}</td><td>{x.hsn}</td><td>{x.q}</td><td>{amt(x.rate)}</td><td>{amt(x.tv)}</td><td>{x.gst}%</td></tr>)}</tbody></table>
          <div className="p-bk-pdf-tot">
            <div><span>Taxable value</span><b>{amt(tv)}</b></div><div><span>CGST</span><b>{amt(half)}</b></div><div><span>SGST</span><b>{amt(half)}</b></div>
            <div className="p-bk-pdf-g"><span>Total</span><b>₹{amt(total)}</b></div><small>Rupees Fifty-five thousand only</small>
          </div>
          <div className="p-bk-pdf-f"><small>Bank: HDFC Bank ••4521 · IFSC HDFC0000123</small><small>For Kaveri Home Decor Pvt Ltd · Authorised signatory</small></div>
        </div>
        <div className="p-form-btns">
          <button className="p-btn p-primary p-lg">Save, e-invoice and send <kbd>Ctrl ↵</kbd></button>
          <div className="p-row-btns"><button className="p-btn"><Send size={14} />Save and new</button><button className="p-btn p-ghost">Save draft</button></div>
        </div>
      </aside>
    </div>
  </Shell>;
}

/* ================================================================ 4. Day Book */
const DAY = [
  { t: "Sales", no: "KHD/26-27/0410", p: "Aanya Living Retail Pvt Ltd", a: 0, st: "cancelled", note: "Cancelled 21-Nov 10:12 · number kept" },
  { t: "Sales", no: "KHD/26-27/0411", p: "Meera Boutique Hotels Pvt Ltd", a: 118000, st: "posted", note: "IRN 9f3c…a71e" },
  { t: "Purchase", no: "PUR/26-27/0388", p: "Jodhpur Woodcraft", a: 283200, st: "posted", note: "IGST 43,200 · Rajasthan" },
  { t: "Payment", no: "PAY/26-27/0217", p: "Mehta Design Studio LLP", a: 81000, st: "posted", note: "ICICI ••0937 · approved by Priya" },
  { t: "Payment", no: "PAY/26-27/0218", p: "Jodhpur Woodcraft", a: 200000, st: "pending", note: "Over ₹50,000: needs an approver" },
  { t: "Receipt", no: "RCT/26-27/0164", p: "Meera Boutique Hotels Pvt Ltd", a: 150000, st: "posted", note: "HDFC ••4521 · against 0389" },
  { t: "Journal", no: "JV/26-27/0042", p: "Lakshmi Estates (rent, Nov)", a: 60000, st: "posted", note: "TDS 194-I ₹6,000" },
  { t: "Contra", no: "CON/26-27/0031", p: "Cash withdrawal", a: 20000, st: "posted", note: "HDFC → Cash" },
];
const ST = { posted: ["done", "Posted"], pending: ["review", "Pending approval"], cancelled: ["problem", "Cancelled"] };
function StPill({ st }) { const [k, w] = ST[st]; return <span className="p-pill" data-tone={{ done: "emerald", review: "amber", problem: "slate" }[k]}><i aria-hidden="true" />{w}</span>; }
export function BooksDayBook() {
  const posted = DAY.filter((x) => x.st === "posted"), pend = DAY.filter((x) => x.st === "pending");
  const tot = sum(posted, (x) => x.a);
  return <Shell scope="client" active="books">
    <TopBar title="Day Book" crumb={<Crumb />} actions={<><Mode /><button className="p-btn"><Download size={15} />Excel</button></>} />
    <div className="p-page">
      <div className="p-bk-daybar">
        <div className="p-seg"><button>‹</button><button aria-pressed="true"><Calendar size={13} /> Sat, 21-Nov-2026</button><button>›</button></div>
        <div className="p-chips"><Chip on n={DAY.length}>All</Chip><Chip n={2}>Sales</Chip><Chip n={1}>Purchase</Chip><Chip n={2}>Payment</Chip><Chip n={1}>Receipt</Chip><Chip n={1}>Journal</Chip><Chip n={1}>Contra</Chip></div>
      </div>
      <section className="p-card p-list">
        <table className="p-table p-bk-day">
          <thead><tr><th>Type · No.</th><th>Party / particulars</th><th className="p-bk-hide">Note</th><th className="p-r">Debit</th><th className="p-r p-bk-hide">Credit</th><th className="p-bk-hide">Status</th></tr></thead>
          <tbody>{DAY.map((x) => <tr key={x.no} className="p-row" data-st={x.st}>
            <td><span className="p-bk-vt" data-t={x.t}>{x.t}</span><small className="p-num">{x.no}</small></td>
            <td><b className="p-bk-party">{x.p}</b><small className="p-bk-show">{x.note}</small></td>
            <td className="p-bk-hide p-quiet">{x.note}</td>
            <td className="p-r p-num">{x.st === "cancelled" ? "0.00" : amt(x.a)}<span className="p-bk-showb"><StPill st={x.st} /></span></td>
            <td className="p-r p-num p-bk-hide">{x.st === "cancelled" ? "0.00" : amt(x.a)}</td>
            <td className="p-bk-hide"><StPill st={x.st} /></td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={2}><b>Posted: {posted.length} vouchers</b> · each one Dr = Cr</td><td className="p-bk-hide" /><td className="p-r p-num">{amt(tot)}</td><td className="p-r p-num p-bk-hide">{amt(tot)}</td><td className="p-bk-hide"><span className="p-bk-ok"><Check size={13} />ties</span></td></tr>
            <tr><td colSpan={2}>Pending approval: {pend.length} · not in any report yet</td><td className="p-bk-hide" /><td className="p-r p-num">{amt(sum(pend, (x) => x.a))}</td><td className="p-r p-num p-bk-hide">{amt(sum(pend, (x) => x.a))}</td><td className="p-bk-hide" /></tr>
          </tfoot>
        </table>
      </section>
      <div className="p-bk-note"><Lock size={15} /><span>October 2026 is locked: GSTR-1 and GSTR-3B are filed. A change for October is made as a credit or debit note dated today.</span></div>
    </div>
  </Shell>;
}

/* ================================================================ 5. ledger */
const LED = [
  { d: "04-Oct-2026", t: "Receipt", no: "RCT/26-27/0131", p: "HDFC Bank ••4521", ref: "Agst KHD/26-27/0318", cr: 236000 },
  { d: "12-Oct-2026", t: "Sales", no: "KHD/26-27/0356", p: "Sales – Furniture 18%", ref: "New ref · due 11-Nov", dr: 295000 },
  { d: "28-Oct-2026", t: "Sales", no: "KHD/26-27/0389", p: "Sales – Furniture 18%", ref: "New ref · due 27-Nov", dr: 177000 },
  { d: "03-Nov-2026", t: "Credit note", no: "CN/26-27/0019", p: "Sales returns", ref: "Agst KHD/26-27/0389", cr: 11800 },
  { d: "09-Nov-2026", t: "Receipt", no: "RCT/26-27/0149", p: "HDFC Bank ••4521", ref: "Agst KHD/26-27/0356", cr: 295000 },
  { d: "21-Nov-2026", t: "Sales", no: "KHD/26-27/0411", p: "Sales – Furniture 18%", ref: "New ref · due 21-Dec", dr: 118000 },
  { d: "21-Nov-2026", t: "Receipt", no: "RCT/26-27/0164", p: "HDFC Bank ••4521", ref: "Agst KHD/26-27/0389", cr: 150000 },
];
const OPEN = 236000;
export function BooksLedger() {
  let bal = OPEN;
  const rows = LED.map((x) => { bal = r2(bal + (x.dr || 0) - (x.cr || 0)); return { ...x, bal }; });
  const dr = sum(LED, (x) => x.dr || 0), cr = sum(LED, (x) => x.cr || 0), close = r2(OPEN + dr - cr);
  const bills = [["KHD/26-27/0389", "28-Oct", "27-Nov", r2(177000 - 11800 - 150000), "Due in 5 days"], ["KHD/26-27/0411", "21-Nov", "21-Dec", 118000, "Not due"]];
  return <Shell scope="client" active="books">
    <TopBar title="Meera Boutique Hotels Pvt Ltd" crumb={<>{CLIENT.name} › Ledgers</>} actions={<><Mode /><button className="p-btn"><Download size={15} />PDF</button></>} />
    <div className="p-page">
      <div className="p-bk-lhead">
        <div><small>Group</small><b>Sundry Debtors</b><small className="p-bk-s3">Trade receivables</small></div>
        <div><small>GSTIN · State</small><b className="p-num">07AAGCM7310P1Z2</b><small>Delhi · Regular</small></div>
        <div><small>PAN</small><b className="p-num">AAGCM7310P</b><small>Bill-wise · 30 days credit</small></div>
        <div><small>Closing · 22-Nov</small><b className="p-num">₹{amt(close)} Dr</b><small>{bills.length} bills open</small></div>
      </div>
      <section className="p-card p-list">
        <div className="p-list-bar"><div className="p-chips"><Chip on>Entries</Chip><Chip n={bills.length}>Open bills</Chip><Chip>Monthly</Chip></div>
          <div className="p-list-tools"><button className="p-btn p-sm"><Calendar size={14} />1-Oct – 22-Nov-2026</button></div></div>
        <table className="p-table p-bk-ledt">
          <thead><tr><th>Date</th><th>Particulars</th><th className="p-bk-hide">Bill reference</th><th className="p-r">Debit</th><th className="p-r">Credit</th><th className="p-r p-bk-hide">Balance</th></tr></thead>
          <tbody>
            <tr className="p-row p-bk-open"><td>01-Oct-2026</td><td><b>Opening balance</b></td><td className="p-bk-hide" /><td className="p-r p-num">{amt(OPEN)}</td><td /><td className="p-r p-num p-bk-hide">{amt(OPEN)} Dr</td></tr>
            {rows.map((x) => <tr key={x.no} className="p-row">
              <td className="p-nowrap">{x.d}</td>
              <td><b>{x.p}</b><small><span className="p-bk-vt" data-t={x.t}>{x.t}</span> {x.no}<span className="p-bk-show"> · {x.ref}</span></small></td>
              <td className="p-bk-hide p-quiet">{x.ref}</td>
              <td className="p-r p-num">{amt(x.dr)}</td><td className="p-r p-num">{amt(x.cr)}</td>
              <td className="p-r p-num p-bk-hide">{x.bal ? amt(x.bal) + " Dr" : "0.00 · settled"}</td></tr>)}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Totals for the period</td><td className="p-bk-hide" /><td className="p-r p-num">{amt(dr)}</td><td className="p-r p-num">{amt(cr)}</td><td className="p-bk-hide" /></tr>
            <tr><td colSpan={2}><b>Closing balance</b> · opening {amt(OPEN)} + {amt(dr)} − {amt(cr)}</td><td className="p-bk-hide" /><td className="p-r p-num"><b>{amt(close)} Dr</b></td><td /><td className="p-r p-bk-hide"><span className="p-bk-ok"><Check size={13} />= bills</span></td></tr>
          </tfoot>
        </table>
      </section>
      <section className="p-card">
        <div className="p-card-h"><h2>Open bills</h2><span className="p-quiet">add up to the closing balance</span></div>
        <div className="p-bk-bills">{bills.map(([n, d, due, a, w]) => <div key={n}><b className="p-num">{n}</b><small>Billed {d} · due {due}</small><span className="p-num">₹{amt(a)}</span><em data-due={w.startsWith("Due") ? "" : undefined}>{w}</em></div>)}
          <div className="p-bk-billtot"><span>Total</span><b className="p-num">₹{amt(sum(bills, (x) => x[3]))}</b></div></div>
      </section>
    </div>
  </Shell>;
}

/* ================================================================ 6. trial balance */
const TB = [
  { g: "Capital Account", s3: "Equity", b: -4342600 },
  { g: "Loans (Liability)", s3: "Borrowings", b: -1000000 },
  { g: "Current Liabilities", s3: "Payables, taxes, provisions", b: -1955240, kids: [["Sundry Creditors", -1426300], ["Duties & Taxes", -318940], ["Provisions", -210000]] },
  { g: "Fixed Assets", s3: "PPE", b: 2248000 },
  { g: "Current Assets", s3: "Receivables, stock, cash", b: 6984750, kids: [["Sundry Debtors", 3162800], ["Stock-in-hand", 1980000], ["Bank Accounts", 1294650], ["Cash-in-hand", 112300], ["Loans & Advances (Asset)", 435000]] },
  { g: "Sales Accounts", s3: "Revenue from operations", b: -12463500 },
  { g: "Indirect Incomes", s3: "Other income", b: -86400 },
  { g: "Purchase Accounts", s3: "Purchases", b: 7124600 },
  { g: "Direct Expenses", s3: "Other expenses", b: 680400 },
  { g: "Indirect Expenses", s3: "Employee benefits, other", b: 2809990 },
];
export function BooksTb() {
  const dr = sum(TB, (x) => Math.max(x.b, 0)), cr = sum(TB, (x) => Math.max(-x.b, 0));
  TB.forEach((x) => { if (x.kids && r2(x.kids.reduce((s, k) => s + k[1], 0)) !== x.b) throw new Error("TB group does not add up: " + x.g); });
  return <Shell scope="client" active="books">
    <TopBar title="Trial balance" crumb={<Crumb />} actions={<><Mode /><button className="p-btn"><Download size={15} />Excel</button></>} />
    <div className="p-page">
      <div className="p-status"><ShieldCheck size={18} /><span><b>Ties to the paisa.</b> Recomputed from 1,294 posted vouchers just now · openings at 1-Apr-2026 net ₹0.00</span><span className="p-grow" /><button className="p-btn p-sm"><RefreshCw size={14} />Again</button></div>
      <div className="p-bk-daybar">
        <div className="p-seg"><button aria-pressed="true">As on 22-Nov-2026</button><button>31-Oct</button><button>31-Mar</button></div>
        <div className="p-chips"><Chip on>Groups</Chip><Chip>Ledgers</Chip><Chip>Schedule III</Chip><Chip>Branch: all</Chip></div>
      </div>
      <section className="p-card p-list">
        <table className="p-table p-bk-tbt">
          <thead><tr><th>Particulars</th><th className="p-bk-hide">Schedule III</th><th className="p-r">Debit</th><th className="p-r">Credit</th></tr></thead>
          <tbody>{TB.map((x) => <TbRow key={x.g} x={x} />)}</tbody>
          <tfoot><tr className="p-bk-grand"><td><b>Total</b></td><td className="p-bk-hide"><span className="p-bk-ok"><Check size={13} />Debit = Credit</span></td><td className="p-r p-num">{amt(dr)}</td><td className="p-r p-num">{amt(cr)}</td></tr>
            <tr><td>Difference</td><td className="p-bk-hide" /><td className="p-r p-num" colSpan={2}>₹{amt(r2(dr - cr)) || "0.00"}</td></tr></tfoot>
        </table>
      </section>
      <div className="p-bk-note"><Lock size={15} /><span>April to October 2026 are locked (returns filed). Figures for those months cannot move.</span></div>
    </div>
  </Shell>;
}
function TbRow({ x }) {
  return <>
    <tr className="p-row p-bk-grp"><td><span className="p-bk-tree">{x.kids ? <ChevronDown size={15} /> : <ChevronRight size={15} className="p-quiet" />}<b>{x.g}</b></span></td><td className="p-bk-hide"><span className="p-bk-s3">{x.s3}</span></td>
      <td className="p-r p-num">{x.b > 0 ? amt(x.b) : ""}</td><td className="p-r p-num">{x.b < 0 ? amt(-x.b) : ""}</td></tr>
    {x.kids && x.kids.map(([g, b]) => <tr key={g} className="p-row p-bk-sub"><td><span className="p-bk-tree" style={{ paddingLeft: 26 }}>{g}</span></td><td className="p-bk-hide" />
      <td className="p-r p-num p-quiet">{b > 0 ? amt(b) : ""}</td><td className="p-r p-num p-quiet">{b < 0 ? amt(-b) : ""}</td></tr>)}
  </>;
}

/* ================================================================ 7. audit trail of a voucher */
const VERS = [
  { v: 3, at: "22-Nov-2026 09:15:42", who: "Priya Shah", role: "Approver", act: "Approved and posted", tone: "emerald", ch: [], note: "Approved version 2. Maker ≠ checker checked.", seq: "1,48,203" },
  { v: 2, at: "21-Nov-2026 15:47:08", who: "Ravi Kumar", role: "Accountant", act: "Edited", tone: "amber", reason: "Paid from ICICI, per the bank statement",
    ch: [["Bank ledger (Cr)", "HDFC Bank ••4521", "ICICI Bank ••0937"], ["Reference", "–", "Bill MDS/26-27/118"], ["Status", "Pending approval", "Pending approval (approval reset)"]], seq: "1,47,961" },
  { v: 1, at: "21-Nov-2026 11:02:31", who: "Ravi Kumar", role: "Accountant", act: "Created", tone: "sky",
    ch: [["Date", "", "21-Nov-2026"], ["Number", "", "PAY/26-27/0217"], ["Dr Mehta Design Studio LLP", "", "81,000.00"], ["Cr HDFC Bank ••4521", "", "81,000.00"], ["Status", "", "Pending approval (payments over ₹50,000)"]], seq: "1,47,602" },
];
export function BooksAudit() {
  return <Shell scope="client" active="books">
    <TopBar title="Payment PAY/26-27/0217" crumb={<>{CLIENT.name} › Day Book</>} actions={<><StPill st="posted" /><button className="p-btn"><Download size={15} />Export log</button></>} />
    <div className="p-page">
      <div className="p-tabs p-bk-vtabs"><button>Voucher</button><button aria-selected="true"><History size={15} />History <em>3</em></button><button>Attachments <em>1</em></button></div>
      <div className="p-bk-audit">
        <section className="p-card">
          <div className="p-card-h"><h2>Every change, as the database recorded it</h2><span className="p-quiet">newest first · times are FinCom's server clock (IST)</span></div>
          <ol className="p-bk-tl">{VERS.map((x) => <li key={x.v} data-tone={x.tone}>
            <span className="p-bk-tl-dot"><b>v{x.v}</b></span>
            <div className="p-bk-tl-b">
              <div className="p-bk-tl-h"><b>{x.act}</b><span className="p-quiet">{x.at}</span></div>
              <div className="p-bk-who"><UserRound size={13} />{x.who} · {x.role}<span className="p-quiet"> · log no. {x.seq}</span></div>
              {x.reason && <div className="p-bk-reason">Reason: “{x.reason}”</div>}
              {x.note && <div className="p-bk-reason">{x.note}</div>}
              {x.ch.length > 0 && <table className="p-bk-diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                <tbody>{x.ch.map(([f, b, a]) => <tr key={f}><td>{f}</td><td>{b ? <del>{b}</del> : <span className="p-quiet">new</span>}</td><td><ins>{a}</ins></td></tr>)}</tbody></table>}
            </div></li>)}</ol>
        </section>
        <aside className="p-stack">
          <section className="p-card p-bk-chain">
            <div className="p-card-h"><h2><ShieldCheck size={16} className="p-ic-ok" />Edit log verified</h2></div>
            <dl>
              <div><dt>Chain</dt><dd>Intact to log no. 1,48,203</dd></div>
              <div><dt>Last anchor</dt><dd>22-Nov-2026 00:00 · kept outside the database</dd></div>
              <div><dt>Switched off?</dt><dd>Never: there is no setting for it</dd></div>
              <div><dt>Kept until</dt><dd>31-Mar-2035 (8 years after FY 2026-27)</dd></div>
            </dl>
            <small>Rule 3(1), Companies (Accounts) Rules, 2014: every change is logged with its date, and the log cannot be disabled.</small>
          </section>
          <section className="p-card">
            <div className="p-card-h"><h2>As posted now (v3)</h2></div>
            <table className="p-drcr"><tbody><tr><td className="p-dc">Dr</td><td>Mehta Design Studio LLP<small>Agst MDS/26-27/118</small></td><td className="p-r p-num">81,000.00</td></tr>
              <tr><td className="p-dc">Cr</td><td>ICICI Bank ••0937</td><td className="p-r p-num">81,000.00</td></tr></tbody></table>
          </section>
        </aside>
      </div>
    </div>
  </Shell>;
}

/* ================================================================ 8. Zoho connect */
const ORGS = [
  { n: "Kaveri Home Decor Pvt Ltd", g: "07AAJCK4821M1Z5", plan: "Professional", cap: 5000, on: true },
  { n: "Kaveri Exports LLP", g: "07AAQFK1180R1ZT", plan: "Standard", cap: 2000, linked: "Linked to Kaveri Exports" },
  { n: "Demo Organisation", g: "–", plan: "Free", cap: 1000 },
];
export function BooksZoho() {
  const used = 412, cap = 5000;
  return <Shell scope="client" active="books">
    <TopBar title="Connect Zoho Books" crumb={<Crumb />} />
    <div className="p-page">
      <section className="p-card p-steps">
        <div className="p-card-h"><h2>Three steps</h2><span className="p-quiet">Step 2 of 3</span></div>
        <ol>
          <li data-s="done"><span className="p-step-n"><Check size={15} strokeWidth={3} /></span><div><b>Sign in to Zoho (India)</b><small>accounts.zoho.in · signed in as accounts@kaveri.example · FinCom never sees your password</small></div><span className="p-quiet">Done</span></li>
          <li data-s="now"><span className="p-step-n">2</span><div><b>Choose the organisation for Kaveri Home Decor</b>
            <div className="p-bk-orgs">{ORGS.map((o) => <label key={o.n} className="p-bk-org" data-on={o.on ? "" : undefined} data-off={o.linked ? "" : undefined}>
              <span className="p-bk-radio" /><span><b>{o.n}</b><small>GSTIN {o.g} · {o.plan} plan · {o.cap.toLocaleString("en-IN")} calls a day</small></span>{o.linked && <em>{o.linked}</em>}</label>)}</div></div></li>
          <li data-s="later"><span className="p-step-n">3</span><div><b>First read</b><small>About 2,300 calls for this year's 1,140 documents: done today, within the plan's daily limit</small></div></li>
        </ol>
      </section>
      <div className="p-cols p-bk-zcols">
        <section className="p-card">
          <div className="p-card-h"><h2>What FinCom does in Zoho</h2></div>
          <div className="p-bk-rw">
            <div><h3>Reads, every 15 minutes</h3><ul><li>Chart of accounts, contacts (GSTIN, PAN)</li><li>Invoices, credit notes, customer payments</li><li>Bills, vendor credits and payments, expenses</li><li>Journals, bank transactions, taxes</li></ul></div>
            <div><h3>Creates, after you approve</h3><ul><li>Bills, expenses and journals</li><li>Sales invoices <span className="p-bk-new">new</span></li><li>Customer and vendor payments <span className="p-bk-new">new</span></li><li>Contacts it needs</li></ul></div>
            <div><h3>Never</h3><ul><li>Deletes anything</li><li>Changes a document made in Zoho</li><li>Touches Zoho's settings or users</li></ul></div>
          </div>
          <div className="p-bk-scopes"><KeyRound size={14} /><span>Permissions asked: </span>{["settings.READ", "contacts.CREATE", "invoices.CREATE", "bills.CREATE", "expenses.CREATE", "accountants.CREATE", "banking.READ", "…"].map((s) => <code key={s}>{s}</code>)}</div>
        </section>
        <aside className="p-stack">
          <section className="p-card">
            <div className="p-card-h"><h2>Zoho's limits</h2><span className="p-quiet">Professional</span></div>
            <div className="p-bk-meter"><div><span>Today</span><b className="p-num">{used.toLocaleString("en-IN")} of {cap.toLocaleString("en-IN")} calls</b></div><i><s style={{ width: (used / cap * 100) + "%" }} /><u style={{ left: "95%" }} title="FinCom stops at 95%" /></i><small>FinCom stops at 95% and goes on after midnight IST</small></div>
            <div className="p-bk-kv"><span>Per minute</span><b>under 90 of Zoho's 100</b></div>
            <div className="p-bk-kv"><span>At once</span><b>at most 4 calls</b></div>
          </section>
          <section className="p-card">
            <div className="p-card-h"><h2>Instant updates</h2><span className="p-quiet">optional</span></div>
            <p className="p-bk-p">Add FinCom's webhook to a Zoho workflow rule, with a secret. FinCom checks Zoho's signature on every call. Without it, FinCom still reads every 15 minutes.</p>
            <button className="p-btn p-sm">Show webhook address</button>
          </section>
        </aside>
      </div>
      <div className="p-row-btns p-bk-end"><button className="p-btn p-ghost">Cancel</button><button className="p-btn p-primary">Link and start the first read <ArrowRight size={15} /></button></div>
    </div>
  </Shell>;
}

/* ================================================================ 9. move a client from Tally */
const CHECKS = [
  ["Trial balance at 31-Mar-2026 (openings)", "312 ledgers", 16420315.40, 16420315.40],
  ["Trial balance at 21-Nov-2026", "312 ledgers", 19692540, 19692540],
  ["Vouchers 1-Apr to 21-Nov-2026", "by type and month", 1286, 1286, true],
  ["Debit total of those vouchers", "by type and month", 68431209.75, 68431209.75],
  ["Bills receivable, party by party", "22 parties", 3162800, 3162800],
  ["Bills payable, party by party", "31 parties", 1426300, 1426300],
  ["GST worked out, Apr–Oct (filed)", "GSTR-1 and 3B, 7 months", 2196418, 2196418],
  ["TDS by section, Q1–Q2", "194C, 194I, 194J, 194Q", 318640, 318640],
];
export function BooksMove() {
  const bad = CHECKS.filter((c) => r2(c[2] - c[3]) !== 0).length;
  return <Shell scope="client" active="books">
    <TopBar title="Move to own books" crumb={<>{CLIENT.name} › from Tally: Kaveri Home Decor (2026-27)</>} />
    <div className="p-page">
      <div className="p-bk-prog">
        {[["Masters", "10 groups + 14 sub-groups · 312 ledgers · 7 voucher types · 9 cost centres"], ["Openings", "at 31-Mar-2026 · 312 balances · 148 open bills"], ["Vouchers", "1,286 from 1-Apr to 21-Nov-2026"], ["Checks", bad ? bad + " differences" : "8 of 8 tie"]].map(([t, s], i) =>
          <div key={t} className="p-bk-pstep" data-s="done"><span className="p-step-n"><Check size={15} strokeWidth={3} /></span><span><b>{i + 1}. {t}</b><small>{s}</small></span></div>)}
      </div>
      <div className="p-status"><ShieldCheck size={18} /><span><b>Every check ties: difference ₹0.00.</b> Tally's copy and FinCom's own books match to the paisa.</span></div>
      <section className="p-card p-list">
        <div className="p-list-bar"><h2 className="p-bk-h2">Verification</h2><span className="p-quiet">read from Tally at 21-Nov-2026 23:40 · copied 22-Nov 00:12</span></div>
        <table className="p-table p-bk-chk">
          <thead><tr><th>Check</th><th className="p-r p-bk-hide">In Tally</th><th className="p-r p-bk-hide">In own books</th><th className="p-r">Difference</th><th /></tr></thead>
          <tbody>{CHECKS.map(([t, s, a, b, n]) => <tr key={t} className="p-row">
            <td><b>{t}</b><small>{s}<span className="p-bk-show"> · {n ? a.toLocaleString("en-IN") : "₹" + amt(a)}</span></small></td>
            <td className="p-r p-num p-bk-hide">{n ? a.toLocaleString("en-IN") : amt(a)}</td><td className="p-r p-num p-bk-hide">{n ? b.toLocaleString("en-IN") : amt(b)}</td>
            <td className="p-r p-num"><b>{n ? String(b - a) : (amt(r2(b - a)) || "0.00")}</b></td>
            <td className="p-r"><span className="p-bk-ok"><Check size={13} />ties</span></td></tr>)}</tbody>
        </table>
      </section>
      <section className="p-card p-bk-left">
        <div className="p-card-h"><h2><Info size={16} />Left in Tally, not copied</h2><span className="p-quiet">these do not block the switch</span></div>
        <ul><li><b>3 post-dated vouchers</b> after 21-Nov-2026: copied when their date comes, during the parallel run</li><li><b>1 optional voucher</b> (a memorandum quotation): optional vouchers are not part of the books</li></ul>
      </section>
      <div className="p-row-btns p-bk-end">
        <button className="p-btn">Download the check (Excel)</button>
        <button className="p-btn">Run both for 30 days first</button>
        <button className="p-btn p-primary">Switch to own books</button>
      </div>
    </div>
  </Shell>;
}
