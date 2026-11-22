// Bank › Lines to review with everything today's Bank page does (the owner's review of 22-Nov-2026: "nothing may be
// lost"), dense ("Bank eats a lot of space": one slim head row, one row of tabs and status shortcuts, the table filling
// the rest with a sticky head and a sticky foot of totals, 34 px rows), and every column filtered from its heading
// ("Tables everywhere": tablef.jsx). Also Bank › Rules and a Purchase list on the same frame. Made-up data.
import { Landmark, Upload, ChevronRight, ChevronDown, CircleCheck, TriangleAlert, FileText, X, Check, Sparkles, Columns3, Bookmark,
  Ellipsis, Split, Wand2, History, Users, Plus, ArrowUp, ArrowDown, Copy, Pause, Pencil, Trash2, Keyboard, Link2, Undo2, Ban, ReceiptText } from "lucide-react";
import { Shell, SlimTop, SlimRow, Pill, BankTabs, inr } from "./ui.jsx";
import { CLIENT, BLINES, RULE_SUGG, RULES, FIRM_RULES, BILLS } from "./data.js";
import { Th, ListFilter, AmountFilter, DateFilter, StatusFilter, PhoneFilterChips, Sheet } from "./tablef.jsx";

// a status shortcut: sets the Status column's filter (the heading's funnel fills), nothing more
const Q = ({ on, n, children }) => <button className="p-qs" aria-pressed={on ? "true" : "false"}>{children}<em>{n}</em></button>;
// the running balance after each line (newest first; the statement closes at ₹18,42,300)
const BAL = (() => { let b = 1842300; return BLINES.map((r) => { const x = b; b = b - r.in + r.out; return x; }); })();
const SRC = { "Bill match": ["Bill", "link", Link2], "Sales invoice": ["Invoice", "link", Link2], "Booked before": ["Booked before", "hist", History], "Similar past entry": ["Similar", "hist", History],
  "Your rule": ["Rule", "rule", Wand2], "Your rule · firm-wide": ["Firm rule", "rule", Wand2], "UPI match": ["UPI match", "guess", Sparkles], "Name match": ["Name match", "guess", Sparkles] };
function Src({ s }) {
  if (!s) return <span className="p-src" data-none="" title="No match found">no match</span>;
  const [w, k, I] = SRC[s] || [s, "guess", Sparkles];
  return <span className="p-src" data-k={k} title={"Suggested by: " + s}><I size={11} />{w}</span>;
}
// today's columns; each can be hidden from the picker (Ref and Posted are off by default)
export const COLS = [["date", "Date", true], ["part", "Particulars", true], ["ref", "UPI / UTR / Chq ref", false], ["led", "Ledger and source", true], ["link", "Bill or invoice", true],
  ["tds", "TDS at payment", true], ["vt", "Type", true], ["out", "Withdrawal", true], ["in", "Deposit", true], ["bal", "Balance", true], ["st", "Status", true], ["posted", "Posted", false]];

const LEDGERS = [["(No ledger yet)", 6, false, true], ["Gupta Packaging Pvt Ltd", 4, true], ["Amazon Seller Services (Debtor)", 2], ["Salaries Payable", 1], ["Rent (TDS 194-I)", 1], ["Office Expenses", 1],
  ["Bajaj Finance Loan A/c", 1], ["Sharma Stationery", 1, true], ["Flipkart Internet (Debtor)", 1], ["GST Payable (Electronic Cash)", 1], ["Staff Welfare", 1], ["Telephone Expenses", 1]];
const STATUSES = [["To review", 12, true], ["Ready", 30], ["Done", 204], ["Problem", 2]];

function Picker({ stmt }) {
  return stmt
    ? <span className="p-dpick p-dpick-on"><button className="p-link p-back">← All statements</button><FileText size={14} /><b title="HDFC_4521_Nov2026.pdf · 248 lines">HDFC ••4521 · 1–21 Nov 2026</b><X size={13} /></span>
    : <><button className="p-dpick"><Landmark size={14} /><b>HDFC Bank ••4521</b><span className="p-quiet">{inr(1842300)}</span><em className="p-count">12</em><ChevronDown size={14} /></button>
       <button className="p-dpick"><FileText size={14} /><b>Nov 2026</b><span className="p-quiet">1–21 Nov · 248 lines</span><ChevronDown size={14} /></button></>;
}
const Note = () => <span className="p-dnote" title="Every line agrees with its running balance; 1 amount read from the balance change (≈); checked against Tally 2 h ago"><CircleCheck size={14} />Adds up</span>;

export function BankLines({ view = "full", stmt, phone, collapsed }) {
  const sel = view === "bulk" ? new Set([1, 11, 4, 104]) : new Set();
  const open = view === "open" ? 1 : null, statusOn = view === "ledger";
  const rows = statusOn ? BLINES.filter((r) => r.st === "review") : BLINES;
  const pop = { ledger: <ListFilter title="Ledger" items={LEDGERS} n="Apply to 6 lines" ph="Search 38 ledgers" />, amount: <AmountFilter title="Withdrawal" n="Apply · 31 lines" />, date: <DateFilter title="Date" n="Apply · 248 lines" /> }[view];
  const tot = rows.reduce((a, r) => ({ out: a.out + r.out, in: a.in + r.in }), { out: 0, in: 0 });
  return <Shell scope="client" active="bank" phone={phone} collapsed={collapsed} overlay={view === "sheet" ? <Sheet><ListFilter title="Ledger" items={LEDGERS.slice(0, 8)} n="6 lines" ph="Search 38 ledgers" /></Sheet> : null}>
    <SlimTop title="Bank" picker={<Picker stmt={stmt} />} note={<Note />} actions={<><button className="p-btn p-sm"><Upload size={14} />Upload</button><button className="p-btn p-sm p-primary">Post 30 to Tally</button></>} />
    <SlimRow><BankTabs on="lines" inline /><span className="p-vsep" />
      <Q on={!statusOn} n={248}>All</Q><Q on={statusOn} n={12}>To review</Q><Q n={30}>Ready</Q><Q n={204}>Done</Q><Q n={2}>Problem</Q><Q n={4}>Set aside</Q>
      <span className="p-grow" />
      <button className="p-btn p-sm p-ghost" title="Saved views keep the column filters"><Bookmark size={14} />{statusOn ? "My review" : "All lines"}<ChevronDown size={13} /></button>
      <button className="p-icon p-sm-ic2" aria-label="Columns" aria-expanded={view === "cols" || undefined}><Columns3 size={16} /></button>
      <button className="p-icon p-sm-ic2" aria-label="Keys"><Keyboard size={16} /></button>
      <button className="p-icon p-sm-ic2" aria-label="More: reconcile with Tally, check the balance, mark lines already in Tally, find double entries, reload ledgers, Tally file, Excel, ask Claude, clear decisions, delete or restore a statement"><Ellipsis size={16} /></button>
    </SlimRow>
    {phone && <PhoneFilterChips cols={[["Date"], ["Particulars"], ["Ledger", view === "sheet"], ["Bill"], ["TDS"], ["Amount"], ["Status"]]} />}
    {view === "cols" && <ColPicker />}
    <div className="p-tscroll">
      {sel.size > 0 && <div className="p-bulk p-bulk-over"><input type="checkbox" readOnly checked className="p-bulk-ck" /><b>{sel.size} selected</b><span className="p-quiet">{inr(76660)}</span><button className="p-btn p-sm">Set ledger ▾</button><button className="p-btn p-sm">Type ▾</button><button className="p-btn p-sm">Narration</button>
        <button className="p-btn p-sm"><Plus size={13} />Create ledgers for 2</button><button className="p-btn p-sm"><Wand2 size={13} />Make a rule</button><button className="p-btn p-sm p-ghost">Set aside</button><span className="p-grow" /><button className="p-btn p-sm p-primary">Post 4 to Tally</button><button className="p-icon p-sm-ic" aria-label="Clear"><X size={15} /></button></div>}
      <table className="p-table p-dtable p-ltable">
        <colgroup><col className="w-ck" /><col className="w-date" /><col /><col className="w-led" /><col className="w-link" /><col className="w-tds" /><col className="w-vt" /><col className="w-amt" /><col className="w-amt" /><col className="w-bal" /><col className="w-st" /><col className="w-x" /></colgroup>
        <thead><tr><th className="p-ck"><input type="checkbox" readOnly /></th>
          <Th sort="desc" pop={view === "date" ? pop : null}>Date</Th><Th>Particulars</Th><Th on={view === "ledger"} pop={view === "ledger" ? pop : null}>Ledger · source</Th><Th>Bill / inv.</Th><Th>TDS</Th><Th>Type</Th>
          <Th r pop={view === "amount" ? pop : null} popRight>Withdrawal</Th><Th r>Deposit</Th><Th r>Balance</Th><Th on={statusOn} pop={null}>Status</Th><th /></tr></thead>
        <tbody>{rows.map((r) => <LineRow key={r.id} r={r} bal={BAL[BLINES.indexOf(r)]} sel={sel.has(r.id)} open={open === r.id} />)}</tbody>
        <tfoot><tr><td /><td colSpan={6}>{statusOn
            ? <><b>{rows.length}</b> of 248 shown · filtered by Status, Ledger <a className="p-link">Clear all filters</a></>
            : <><b>{rows.length}</b> of 248 shown{stmt ? " · this statement" : ""} · Opening <b>{inr(1721064)}</b> · Closing <b>{inr(1842300)}</b> · <a className="p-link">Select all 44</a></>}</td>
          <td className="p-r p-num">{inr(tot.out)}</td><td className="p-r p-num">{inr(tot.in)}</td><td colSpan={3} /></tr></tfoot>
      </table>
    </div>
  </Shell>;
}
function ColPicker() {
  return <div className="p-colpick" role="dialog" aria-label="Columns"><b>Columns</b>{COLS.map(([k, w, on]) => <label key={k}><input type="checkbox" readOnly checked={on} />{w}</label>)}
    <div className="p-ffoot"><button className="p-btn p-sm p-ghost">Reset</button><span className="p-grow" /><span className="p-quiet"><b>Compact</b> · <a className="p-link">Comfortable</a></span></div></div>;
}

// one line, 34 px: the party, then mode, reference and narration in grey, cut short (all of it on hover or ▸)
function LineRow({ r, bal, sel, open }) {
  const openable = ["review", "ready", "problem"].includes(r.st);
  return <>
    <tr className={"p-row" + (sel ? " p-sel" : "") + (open ? " p-open" : "")} title={r.narr}>
      <td className="p-ck"><input type="checkbox" checked={sel} readOnly disabled={r.st === "done"} /></td>
      <td className="p-nowrap">{r.d}</td>
      <td className="p-part"><b>{r.party || r.narr}</b><small>{r.mode && <span className="p-mode">{r.mode}</span>}{r.ref}{r.party && <> · <span className="p-narr2">{r.narr}</span></>}</small></td>
      <td className="p-ledc">{r.why ? <span className="p-ledbad" title={r.why}><TriangleAlert size={12} />{r.led} · Tally refused<a className="p-link">Fix</a></span>
        : r.led ? <span className="p-led1"><span className="p-ledt">{r.led}</span>{r.st === "review" && r.src && <button className="p-okbtn" aria-label={"Confirm " + r.led}><Check size={11} strokeWidth={3} /></button>}<Src s={r.src} />{r.split && <span className="p-src" data-k="split" title="Office Expenses ₹2,932 + Input GST ₹528"><Split size={11} /></span>}{r.sim && r.st === "review" && <span className="p-src" data-k="sim">{r.sim} similar</span>}</span>
        : r.newLed ? <span className="p-led1"><button className="p-btn p-xs p-dashed">Choose</button><span className="p-newled1" title={"New ledger: " + r.newLed}><Plus size={11} />New: {r.newLed.split(" · ")[0]}</span></span>
        : <button className="p-btn p-xs p-dashed">Choose ledger</button>}</td>
      <td className="p-nowrap">{r.link ? <span className="p-linkc"><Link2 size={11} />{r.link.replace(/^(Bill|Inv) /, "")}</span> : <span className="p-dim">—</span>}</td>
      <td className="p-nowrap">{r.tds ? <span className="p-tdsc">{r.tds}</span> : <span className="p-dim">—</span>}</td>
      <td><span className="p-vt" data-fixed={r.st === "done" ? "" : undefined}>{r.vt}</span></td>
      <td className="p-r p-num">{r.out ? inr(r.out, r.out % 1 ? 2 : 0) : ""}</td>
      <td className="p-r p-num p-in">{r.in ? <>{inr(r.in)}{r.repaired && <span className="p-flag" title="Read from the balance change: check it">≈</span>}</> : ""}</td>
      <td className="p-r p-num p-balc">{inr(bal, bal % 1 ? 2 : 0)}</td>
      <td title={r.posted ? "In Tally: " + r.posted : undefined}><Pill st={r.st} /></td>
      <td className="p-r p-nowrap">{openable ? (open ? <ChevronDown size={15} /> : <ChevronRight size={15} className="p-quiet" />) : r.st === "done" ? <button className="p-icon p-sm-ic" aria-label="Take it back"><Undo2 size={13} /></button> : null}</td>
    </tr>
    {open && <tr className="p-exp p-learn"><td /><td colSpan={11}><LineOpen r={r} /></td></tr>}
  </>;
}

// a line opened: why this ledger (and its history), what FinCom learnt, and every action on the line
function LineOpen({ r }) {
  return <div className="p-lo">
    <div className="p-lo-c">
      <h4><Sparkles size={14} className="p-ic-brand" />Why {r.led}</h4>
      <p><b>Bill PB/1123 from Gupta Packaging</b> · {inr(47200)} · billed 18-Nov-2026 · same amount, party in the narration</p>
      <p className="p-quiet"><History size={13} /> Booked before: 6 payments to this party since Apr, all to this ledger. Last on 18-Oct, {inr(35400)}.</p>
      <div className="p-row-btns"><button className="p-btn p-sm p-primary"><Check size={13} />Confirm</button><button className="p-btn p-sm">Pick another bill</button><button className="p-btn p-sm">Change ledger</button></div>
    </div>
    <div className="p-lo-c p-lo-learn">
      <h4><Wand2 size={14} className="p-ic-brand" />Learn from it</h4>
      <div className="p-lo-i"><span><b>3 similar lines</b> in this statement (GUPTA PACKAGING, going out)</span><button className="p-btn p-sm">Apply to all 3</button></div>
      <div className="p-lo-i"><span><b>Make a rule from this:</b> lines that say “GUPTA PACKAGING”, going out → Gupta Packaging Pvt Ltd</span><span className="p-row-btns"><button className="p-btn p-sm">This client</button><button className="p-btn p-sm p-ghost">Whole firm</button></span></div>
      <div className="p-lo-i"><span><Users size={13} /> Also a supplier of <b>Mehra Textiles</b> and <b>Patil Auto Spares</b></span><button className="p-btn p-sm p-ghost"><Copy size={13} />Copy the rule to them</button></div>
    </div>
    <div className="p-lo-c p-lo-do">
      <h4>This line</h4>
      <div className="p-lo-kv"><span>Narration</span><code>{r.narr}</code></div>
      <div className="p-lo-kv"><span>Read as</span><b>{r.party} · {r.mode} · {r.ref}</b></div>
      <div className="p-lo-kv"><span>Type</span><b>{r.vt} ▾</b><span>TDS at payment</span><b>none ▾</b></div>
      <div className="p-lo-kv"><span>Narration for Tally</span><b className="p-quiet">Paid against PB/1123 ✎</b></div>
      <div className="p-row-btns"><button className="p-btn p-sm"><Split size={13} />Split</button><button className="p-btn p-sm"><Ban size={13} />Set aside</button><button className="p-btn p-sm p-ghost">‹ Previous</button><button className="p-btn p-sm p-ghost">Next ›</button></div>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- Bank › Rules (same frame; tables with heading filters) */
const RuleHead = ({ firm }) => <thead><tr><th className="p-ord" /><Th>Rule</Th><Th>Does</Th><Th>Made</Th><Th r>Fits now</Th><Th r sort={firm ? "desc" : null}>Used</Th><th /></tr></thead>;
const RuleRows = ({ list, firm }) => list.map((r) => <tr key={r.name} className="p-row">
  <td className="p-ord">{!firm && <><button className="p-icon p-sm-ic" aria-label="Up"><ArrowUp size={13} /></button><button className="p-icon p-sm-ic" aria-label="Down"><ArrowDown size={13} /></button></>}</td>
  <td><b>{r.name}</b> <span className="p-quiet">{r.when}</span></td>
  <td>{r.aside ? <span className="p-src" data-k="none"><Ban size={11} />Set aside</span> : <span className="p-led">{r.does}</span>}{r.extra && <span className="p-quiet"> · {r.extra}</span>}</td>
  <td><span className="p-src" data-k={r.kind === "Learned" ? "hist" : "rule"}>{r.kind === "Learned" ? <History size={11} /> : <Pencil size={11} />}{r.kind}</span></td>
  <td className="p-r p-num">{r.now}</td><td className="p-r p-num">{r.used}{r.over && <span className="p-warnt"> · {r.over} changed by hand</span>}</td>
  <td className="p-r p-nowrap"><button className="p-btn p-xs">Change</button><button className="p-icon p-sm-ic" aria-label="Pause"><Pause size={13} /></button>{!firm && <button className="p-icon p-sm-ic" aria-label="Copy to other clients"><Copy size={13} /></button>}<button className="p-icon p-sm-ic" aria-label="Delete"><Trash2 size={13} /></button></td></tr>);
export function BankRules() {
  return <Shell scope="client" active="bank">
    <SlimTop title="Bank" picker={<Picker />} actions={<button className="p-btn p-sm"><Upload size={14} />Upload</button>} />
    <SlimRow><BankTabs on="rules" inline /><span className="p-grow" /><button className="p-btn p-sm">Apply to this statement</button><button className="p-btn p-sm"><Copy size={14} />Copy to other clients</button><button className="p-btn p-sm p-primary"><Plus size={14} />New rule</button></SlimRow>
    <div className="p-dpage">
      <section className="p-dsec p-sugg2">
        <div className="p-dsec-h"><h2><Sparkles size={15} className="p-ic-brand" />3 rules FinCom can make from your work</h2><span className="p-quiet">booked the same way 3 times or more</span><span className="p-grow" /><button className="p-btn p-sm p-primary">Make the 2 ticked rules</button><button className="p-btn p-sm p-ghost">Not now</button></div>
        {RULE_SUGG.map((s) => <div key={s.when} className="p-sugrow"><input type="checkbox" readOnly checked={s.agree === 100} /><span><b>“{s.when}”</b>, {s.dir === "out" ? "going out" : "coming in"} → <b>{s.led}</b></span><span className="p-quiet">{s.n} times{s.agree < 100 ? " · " + s.agree + "% the same" : ""}</span></div>)}
      </section>
      <section className="p-dsec">
        <div className="p-dsec-h"><h2>Rules for {CLIENT.short}</h2><span className="p-quiet">Read from the top; the first that fits wins. Your own choices are never overwritten.</span></div>
        <table className="p-table p-dtable"><RuleHead /><tbody><RuleRows list={RULES} /></tbody></table>
      </section>
      <section className="p-dsec">
        <div className="p-dsec-h"><h2>Firm-wide rules</h2><span className="p-quiet">For every client, after the client's own</span></div>
        <table className="p-table p-dtable"><RuleHead firm /><tbody><RuleRows list={FIRM_RULES} firm /></tbody></table>
      </section>
      <details className="p-dsec p-details"><summary><ChevronRight size={15} />Remembered choices <span className="p-quiet">142 parties booked before · used for “Booked before” and “Similar past entry” · clean up or forget one</span></summary></details>
    </div>
  </Shell>;
}

/* ---------------------------------------------------------------- Purchase: the same dense table, every heading filtered */
export function Purchase({ view }) {
  const rows = BILLS;
  const pop = view === "status" ? <StatusFilter items={[["New", 1], ["To review", 4, true], ["Ready", 2], ["Done", 6], ["Problem", 1, true]]} n="Apply · 5 bills" /> : null;
  const t = rows.reduce((a, b) => ({ tax: a.tax + b.tax, gst: a.gst + b.gst, tds: a.tds + b.tds }), { tax: 0, gst: 0, tds: 0 });
  return <Shell scope="client" active="purchase">
    <SlimTop title="Purchase" picker={<button className="p-dpick"><ReceiptText size={14} /><b>Nov 2026</b><span className="p-quiet">FY 2026-27 · 14 bills</span><ChevronDown size={14} /></button>}
      actions={<><button className="p-btn p-sm"><Upload size={14} />Upload bills</button><button className="p-btn p-sm p-primary">Post 2 to Tally</button></>} />
    <SlimRow><div className="p-tabs p-pagetabs p-dtabs" role="tablist"><button role="tab" aria-selected="true">Bills<em>14</em></button><button role="tab">Suppliers<em>38</em></button><button role="tab">GSTR-2B match<em>3</em></button></div><span className="p-vsep" />
      <Q on n={14}>All</Q><Q n={1}>New</Q><Q n={4}>To review</Q><Q n={2}>Ready</Q><Q n={6}>Done</Q><Q n={1}>Problem</Q>
      <span className="p-grow" /><button className="p-btn p-sm p-ghost"><Bookmark size={14} />Needs me<ChevronDown size={13} /></button><button className="p-icon p-sm-ic2" aria-label="Columns"><Columns3 size={16} /></button><button className="p-icon p-sm-ic2" aria-label="More"><Ellipsis size={16} /></button></SlimRow>
    <div className="p-tscroll">
      <table className="p-table p-dtable">
        <thead><tr><th className="p-ck"><input type="checkbox" readOnly /></th><Th sort="desc">Bill date</Th><Th>Supplier</Th><Th>Bill no.</Th><Th>GSTIN</Th><Th r>Taxable</Th><Th r>GST</Th><Th r>Total</Th><Th r>TDS</Th><Th>Ledger</Th><Th pop={pop} popRight>Status</Th><th /></tr></thead>
        <tbody>{rows.map((b) => <tr key={b.no} className="p-row"><td className="p-ck"><input type="checkbox" readOnly disabled={b.st === "done"} /></td><td className="p-nowrap">{b.d}</td><td><b>{b.sup}</b></td><td className="p-nowrap p-quiet">{b.no}</td>
          <td className="p-nowrap p-mono">{b.gstin || <span className="p-dim">unregistered</span>}</td><td className="p-r p-num">{inr(b.tax)}</td><td className="p-r p-num">{b.gst ? inr(b.gst) : <span className="p-dim">—</span>}</td><td className="p-r p-num"><b>{inr(b.tax + b.gst)}</b></td>
          <td className="p-r p-num">{b.tds ? inr(b.tds) : <span className="p-dim">—</span>}</td><td><span className="p-ledt">{b.led}</span></td><td><Pill st={b.st} /></td><td className="p-r"><ChevronRight size={15} className="p-quiet" /></td></tr>)}</tbody>
        <tfoot><tr><td /><td colSpan={4}><b>14</b> bills · Nov 2026 · <a className="p-link">Select all 8</a></td><td className="p-r p-num">{inr(t.tax)}</td><td className="p-r p-num">{inr(t.gst)}</td><td className="p-r p-num">{inr(t.tax + t.gst)}</td><td className="p-r p-num">{inr(t.tds)}</td><td colSpan={3} /></tr></tfoot>
      </table>
    </div>
  </Shell>;
}
