// Bank › Lines to review with everything today's Bank page does (the owner's review of 22-Nov-2026: "nothing may be
// lost"): today's columns with a column picker, status and quick chips, a filter row per column, the full filter panel,
// saved views, the suggestion source on every line, the learnings (Booked before, 3 similar lines, make a rule, copy to
// other clients), new-ledger suggestions, split, bills and invoices, TDS at payment, voucher type, posted info, the
// statement's checks and the More menu. Bank › Rules: suggested, learned and written rules. Made-up data.
import { Landmark, Upload, Search, ChevronRight, ChevronDown, CircleCheck, TriangleAlert, FileText, X, Check, Sparkles, Filter, Columns3, Bookmark,
  Calendar, Download, Ellipsis, Split, Wand2, History, Users, Plus, ArrowUp, ArrowDown, Copy, Pause, Pencil, Trash2, Keyboard, Link2, Undo2, BookOpen, Ban } from "lucide-react";
import { Shell, TopBar, Pill, BankTabs, inr } from "./ui.jsx";
import { CLIENT, BANKS, BLINES, RULE_SUGG, RULES, FIRM_RULES } from "./data.js";

const Chip = ({ on, n, children }) => <button className="p-chip" aria-pressed={on ? "true" : "false"}>{children}{n != null && <em>{n}</em>}</button>;
// the running balance after each line (newest first; the statement closes at ₹18,42,300)
const BAL = (() => { let b = 1842300; return BLINES.map((r) => { const x = b; b = b - r.in + r.out; return x; }); })();
const SRC_IC = { "Bill match": Link2, "Sales invoice": Link2, "Booked before": History, "Similar past entry": History, "Your rule": Wand2, "Your rule · firm-wide": Wand2, "UPI match": Sparkles, "Name match": Sparkles };
function Src({ s, st }) {
  if (!s) return <span className="p-src" data-none="">No match found</span>;
  const I = SRC_IC[s] || Sparkles, done = st === "done" || st === "ready";
  return <span className="p-src" data-k={/rule/.test(s) ? "rule" : /Bill|invoice/.test(s) ? "link" : /before|Similar/.test(s) ? "hist" : "guess"}><I size={12} />{done && st === "ready" && s !== "Set by you" ? s : s}</span>;
}
// today's columns, in today's order of meaning; each can be hidden from the picker (Ref and Posted are off by default)
export const COLS = [["date", "Date", true], ["part", "Particulars", true], ["ref", "UPI / UTR / Chq ref", false], ["led", "Ledger and source", true], ["link", "Bill or invoice", true],
  ["tds", "TDS at payment", true], ["vt", "Type", true], ["out", "Withdrawal", true], ["in", "Deposit", true], ["bal", "Balance", true], ["st", "Status", true], ["posted", "Posted", false]];

function Head({ stmt, phone }) {
  return stmt
    ? <div className="p-stmt-on"><button className="p-link p-back">← All statements</button>
        <span className="p-stmt-chip"><FileText size={14} /><b>HDFC ••4521 · 1-Nov – 21-Nov-2026</b><span className="p-quiet">HDFC_4521_Nov2026.pdf · 248 lines</span><button className="p-icon p-sm-ic" aria-label="Show all lines"><X size={14} /></button></span>
        <span className="p-grow" /></div>
    : <div className="p-acct">{BANKS.map((b, i) => <button key={b.no} className="p-acct-i" aria-pressed={i === 0}><Landmark size={16} /><span><b>{b.name} ••{b.no}</b><small>{inr(b.bal) + " · " + b.asOf}</small></span>{i === 0 && <em className="p-count">12</em>}</button>)}
        {!phone && <button className="p-acct-i p-acct-st"><FileText size={16} /><span><b>Nov 2026 statement ▾</b><small>1-Nov – 21-Nov · 248 lines</small></span></button>}</div>;
}
// the statement's checks, in one quiet line (today: "✔ The statement adds up", ≈ repaired, Checked against Tally, the 4 figures)
function Checks() {
  return <div className="p-checks"><span className="p-okline"><CircleCheck size={15} />The statement adds up</span>
    <span className="p-quiet">· 1 amount read from the balance change (≈) · checked against Tally 2 h ago</span><span className="p-grow" />
    <dl className="p-figs"><div><dt>Opening</dt><dd>{inr(1721064)}</dd></div><div><dt>Withdrawals</dt><dd>{inr(1612458)}</dd></div><div><dt>Deposits</dt><dd>{inr(1733694)}</dd></div><div><dt>Closing</dt><dd>{inr(1842300)}</dd></div></dl></div>;
}
function FilterPanel() {
  const F = ({ t, children }) => <label className="p-ff"><span>{t}</span>{children}</label>;
  const Sel = ({ v }) => <span className="p-input p-sm-in">{v}<ChevronDown size={14} /></span>;
  return <div className="p-fpanel" role="dialog" aria-label="Filters">
    <div className="p-fgrid2">
      <F t="Date"><span className="p-input p-sm-in"><Calendar size={14} />1-Nov – 21-Nov-2026</span></F>
      <F t="Amount"><span className="p-range"><span className="p-input p-sm-in">₹ 10,000</span>to<span className="p-input p-sm-in">₹ 5,00,000</span></span></F>
      <F t="Money"><span className="p-seg"><button>Both</button><button aria-pressed="true">Out</button><button>In</button></span></F>
      <F t="Ledger"><Sel v="Any ledger" /></F>
      <F t="Party"><Sel v="Any party" /></F>
      <F t="Suggestion from"><span className="p-ftags">{["Booked before", "Similar past entry", "Your rule", "Bill match", "Sales invoice", "Bank account", "Name or UPI match", "Other clients", "Claude", "Set by you"].map((x, i) => <button key={x} className="p-ftag" aria-pressed={i < 2 ? "true" : "false"}>{x}</button>)}</span></F>
      <F t="Bill or invoice"><span className="p-seg"><button aria-pressed="true">Any</button><button>Has one</button><button>None</button></span></F>
      <F t="TDS at payment"><span className="p-seg"><button aria-pressed="true">Any</button><button>With TDS</button><button>Without</button></span></F>
      <F t="Posted"><span className="p-seg"><button>Any</button><button aria-pressed="true">Not posted</button><button>Posted</button><button>Already in Tally</button></span></F>
      <F t="Voucher type"><Sel v="Any type" /></F>
      <F t="Balance check"><span className="p-seg"><button aria-pressed="true">Any</button><button>Doesn't agree (!)</button><button>Read from balance (≈)</button></span></F>
      <F t="Also"><span className="p-ftags"><button className="p-ftag">Split lines</button><button className="p-ftag">Set aside</button><button className="p-ftag">Posted automatically</button><button className="p-ftag">New ledger suggested</button></span></F>
    </div>
    <div className="p-ffoot"><span className="p-quiet"><b>38</b> lines match · out ₹6,84,120</span><span className="p-grow" /><button className="p-btn p-sm p-ghost">Clear all</button><button className="p-btn p-sm"><Wand2 size={13} />Rule from filter</button><button className="p-btn p-sm"><Bookmark size={13} />Save as view</button><button className="p-btn p-sm p-primary">Show 38 lines</button></div>
  </div>;
}
function ColPicker() {
  return <div className="p-colpick" role="dialog" aria-label="Columns"><b>Columns</b>{COLS.map(([k, w, on]) => <label key={k}><input type="checkbox" readOnly checked={on} />{w}</label>)}
    <div className="p-ffoot"><button className="p-btn p-sm p-ghost">Reset</button><span className="p-grow" /><span className="p-quiet">Comfortable · <a className="p-link">Compact</a></span></div></div>;
}

export function BankLines({ view = "full", stmt, phone }) {
  const sel = view === "full" ? new Set([1, 11, 4]) : new Set();
  const open = view === "open" ? 1 : null, filters = view === "filters";
  const rows = filters ? BLINES.filter((r) => r.out >= 10000 && r.st !== "done") : BLINES;
  return <Shell scope="client" active="bank" phone={phone}>
    <TopBar title="Bank" crumb={<>{CLIENT.name}</>} />
    <BankTabs on="lines" right={<span className="p-row-btns"><button className="p-btn p-sm"><Upload size={14} />Upload statement</button>{!phone && <button className="p-btn p-sm p-primary">Post 30 to Tally</button>}</span>} />
    <div className="p-page">
      <Head stmt={stmt} phone={phone} />
      {!phone && <Checks />}
      <section className="p-card p-list p-lines2">
        <div className="p-list-bar">
          <div className="p-chips"><Chip on={!filters} n={248}>All</Chip><Chip on={filters} n={12}>To review</Chip><Chip n={30}>Ready</Chip><Chip n={204}>Done</Chip><Chip n={2}>Problem</Chip><Chip n={4}>Set aside</Chip></div>
          <div className="p-list-tools">
            <span className="p-mini-search"><Search size={14} />Particulars, amount, ledger</span>
            {!phone && <><button className="p-btn p-sm"><Bookmark size={14} />View: {filters ? "Big payments to review" : "All lines"}<ChevronDown size={13} /></button>
            <button className="p-btn p-sm" aria-expanded={filters || undefined}><Filter size={14} />Filters{filters && <em className="p-fn">5</em>}</button>
            <button className="p-btn p-sm" aria-expanded={view === "cols" || undefined}><Columns3 size={14} />Columns</button>
            <button className="p-icon" aria-label="Keys"><Keyboard size={16} /></button>
            <MoreMenuBtn /></>}
            {phone && <button className="p-btn p-sm"><Filter size={14} />Filters</button>}
          </div>
        </div>
        <div className="p-qchips"><span className="p-quiet">Quick:</span>{[["UPI", 61], ["IMPS", 18], ["NEFT", 74], ["RTGS", 6], ["Cheque", 11], ["ATM", 9], ["Card", 27], ["NACH", 8]].map(([w, n]) => <button key={w} className="p-qchip" aria-pressed={filters && w === "NEFT" ? "true" : "false"}>{w} <em>{n}</em></button>)}
          {filters && <><span className="p-sep" /><span className="p-fchip">Out · ₹10,000 – ₹5,00,000<X size={12} /></span><span className="p-fchip">Not posted<X size={12} /></span><span className="p-fchip">From: Booked before, Similar past entry<X size={12} /></span></>}
          <span className="p-grow" /><label className="p-tog"><input type="checkbox" readOnly />Group by party</label></div>
        {filters && <FilterPanel />}
        {view === "cols" && <ColPicker />}
        {sel.size > 0 && <div className="p-bulk"><b>{sel.size} selected</b><span className="p-quiet">{inr(61960)}</span><button className="p-btn p-sm">Set ledger ▾</button><button className="p-btn p-sm">Type ▾</button><button className="p-btn p-sm">Narration</button>
          <button className="p-btn p-sm"><Plus size={13} />Create ledgers for 1</button><button className="p-btn p-sm"><Wand2 size={13} />Make a rule</button><button className="p-btn p-sm p-ghost">Set aside</button><span className="p-grow" /><button className="p-btn p-sm p-primary">Post 3 to Tally</button><button className="p-icon" aria-label="Clear"><X size={16} /></button></div>}
        {!sel.size && !filters && <div className="p-bulk p-bulk-soft"><Sparkles size={14} /><span>12 suggestions to confirm</span><button className="p-btn p-sm">Confirm all 12</button><span className="p-grow" /><span className="p-quiet">Posts through the bridge on OFFICE-PC</span></div>}
        <table className="p-table p-ltable">
          <thead><tr><th className="p-ck"><input type="checkbox" readOnly /></th><th>Date</th><th>Particulars</th><th>Ledger · source</th><th>Bill / inv.</th><th>TDS</th><th>Type</th><th className="p-r">Withdrawal</th><th className="p-r">Deposit</th><th className="p-r">Balance</th><th>Status</th><th /></tr>
            {filters && <tr className="p-colf"><th /><th><span className="p-cf">1–21 Nov</span></th><th><span className="p-cf">contains…</span></th><th><span className="p-cf" data-on="">from: 2 sources</span></th><th><span className="p-cf">any</span></th><th><span className="p-cf">any</span></th><th><span className="p-cf">any</span></th><th className="p-r"><span className="p-cf" data-on="">≥ 10,000</span></th><th className="p-r"><span className="p-cf">—</span></th><th className="p-r"><span className="p-cf">any</span></th><th><span className="p-cf" data-on="">not Done</span></th><th /></tr>}
          </thead>
          <tbody>{rows.map((r) => <LineRow key={r.id} r={r} bal={BAL[BLINES.indexOf(r)]} sel={sel.has(r.id)} open={open === r.id} />)}</tbody>
          <tfoot><tr><td /><td colSpan={6}><b>{filters ? rows.length + " of 248 lines" : "12 of 248 lines shown"}</b>{stmt ? " · this statement" : " · Nov 2026 statement"} · Opening <b>{inr(1721064)}</b> · Closing <b>{inr(1842300)}</b> · <a className="p-link">Select all {filters ? rows.length : 44}</a></td>
            <td className="p-r p-num">{inr(rows.reduce((a, r) => a + r.out, 0))}</td><td className="p-r p-num">{inr(rows.reduce((a, r) => a + r.in, 0))}</td><td colSpan={3} /></tr></tfoot>
        </table>
      </section>
    </div>
  </Shell>;
}
function MoreMenuBtn() { return <button className="p-icon" aria-label="More: reconcile with Tally, check the balance, mark lines already in Tally, find double entries, reload ledgers, Tally file, Excel, ask Claude, clear decisions, delete or restore a statement"><Ellipsis size={16} /></button>; }

function LineRow({ r, bal, sel, open }) {
  const openable = ["review", "ready", "problem"].includes(r.st);
  return <>
    <tr className={"p-row" + (sel ? " p-sel" : "") + (open ? " p-open" : "")}>
      <td className="p-ck"><input type="checkbox" checked={sel} readOnly disabled={r.st === "done"} /></td>
      <td className="p-nowrap">{r.d}</td>
      <td className="p-part"><b>{r.party || r.narr}</b><small><span className="p-mode">{r.mode}</span>{r.ref}{r.party && <> · <span className="p-narr2">{r.narr}</span></>}</small></td>
      <td className="p-ledc">{r.led ? <span className="p-led">{r.led}{r.st === "review" && r.src && <button className="p-okbtn" aria-label={"Confirm " + r.led}><Check size={13} strokeWidth={3} /></button>}</span>
          : <button className="p-btn p-sm p-dashed">Choose ledger</button>}
        <span className="p-srcline"><Src s={r.src} st={r.st} />{r.split && <span className="p-src" data-k="split"><Split size={12} />split</span>}{r.sim && r.st === "review" && <span className="p-src" data-k="sim">{r.sim} similar</span>}</span>
        {r.newLed && <span className="p-newled"><Plus size={12} />New ledger: <b>{r.newLed}</b><a className="p-link">Create</a></span>}</td>
      <td>{r.link ? <span className="p-linkc"><Link2 size={12} />{r.link}</span> : <span className="p-dim">—</span>}</td>
      <td>{r.tds ? <span className="p-tdsc">{r.tds}</span> : <span className="p-dim">—</span>}</td>
      <td><span className="p-vt" data-fixed={r.st === "done" ? "" : undefined}>{r.vt}{r.st !== "done" && <ChevronDown size={12} />}</span></td>
      <td className="p-r p-num">{r.out ? inr(r.out) : ""}</td>
      <td className="p-r p-num p-in">{r.in ? <>{inr(r.in)}{r.repaired && <span className="p-flag" title="Read from the balance change: check it">≈</span>}</> : ""}</td>
      <td className="p-r p-num p-balc">{inr(bal)}</td>
      <td><Pill st={r.st} extra={r.st === "done" ? "in Tally" : null} />{r.posted && <small className="p-posted">{r.posted}</small>}</td>
      <td className="p-r p-nowrap">{openable ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} className="p-quiet" />) : r.st === "done" ? <button className="p-icon p-sm-ic" aria-label="Take it back"><Undo2 size={14} /></button> : null}</td>
    </tr>
    {open && <tr className="p-exp p-learn"><td /><td colSpan={11}><LineOpen r={r} /></td></tr>}
    {r.why && <tr className="p-exp p-exp-bad"><td /><td colSpan={11}><div className="p-exp-in"><TriangleAlert size={15} /><span>{r.why}</span><span className="p-grow" /><button className="p-btn p-sm">Use ‘Rent – Office’</button><button className="p-btn p-sm p-ghost">Open in Tally</button></div></td></tr>}
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

/* ---------------------------------------------------------------- Bank › Rules */
const RuleRows = ({ list, firm }) => list.map((r, i) => <tr key={r.name} className="p-row">
  <td className="p-ord">{!firm && <><button className="p-icon p-sm-ic" aria-label="Up"><ArrowUp size={13} /></button><button className="p-icon p-sm-ic" aria-label="Down"><ArrowDown size={13} /></button></>}</td>
  <td><b>{r.name}</b><small>{r.when}</small></td>
  <td>{r.aside ? <span className="p-src" data-k="none"><Ban size={12} />Set aside</span> : <span className="p-led">{r.does}</span>}{r.extra && <small>{r.extra}</small>}</td>
  <td><span className="p-src" data-k={r.kind === "Learned" ? "hist" : "rule"}>{r.kind === "Learned" ? <History size={12} /> : <Pencil size={12} />}{r.kind}</span></td>
  <td className="p-r p-num">{r.now}</td><td className="p-r p-num">{r.used}{r.over && <small className="p-warnt">{r.over} changed by hand</small>}</td>
  <td className="p-r p-nowrap"><button className="p-btn p-sm">Change</button><button className="p-icon p-sm-ic" aria-label="Pause"><Pause size={14} /></button>{!firm && <button className="p-icon p-sm-ic" aria-label="Copy to other clients"><Copy size={14} /></button>}<button className="p-icon p-sm-ic" aria-label="Delete"><Trash2 size={14} /></button></td></tr>);
export function BankRules() {
  return <Shell scope="client" active="bank">
    <TopBar title="Bank" crumb={<>{CLIENT.name}</>} />
    <BankTabs on="rules" right={<span className="p-row-btns"><button className="p-btn p-sm">Apply to this statement</button><button className="p-btn p-sm"><Copy size={14} />Copy to other clients</button><button className="p-btn p-sm p-primary"><Plus size={14} />New rule</button></span>} />
    <div className="p-page">
      <section className="p-card p-sugg2">
        <div className="p-card-h"><h2><Sparkles size={17} className="p-ic-brand" />3 rules FinCom can make from your work</h2><span className="p-quiet">booked the same way 3 times or more</span></div>
        {RULE_SUGG.map((s) => <div key={s.when} className="p-sugrow"><input type="checkbox" readOnly checked={s.agree === 100} /><span><b>“{s.when}”</b>, {s.dir === "out" ? "going out" : "coming in"} → <b>{s.led}</b></span><span className="p-quiet">{s.n} times{s.agree < 100 ? " · " + s.agree + "% the same" : ""}</span><span className="p-grow" /></div>)}
        <div className="p-row-btns p-mt"><button className="p-btn p-sm p-primary">Make the 2 ticked rules</button><button className="p-btn p-sm p-ghost">Not now</button></div>
      </section>
      <section className="p-card p-list">
        <div className="p-card-h p-pad"><h2>Rules for {CLIENT.short}</h2><span className="p-quiet">Read from the top; the first that fits wins. Your own choices are never overwritten.</span></div>
        <table className="p-table"><thead><tr><th /><th>Rule</th><th>Does</th><th>Made</th><th className="p-r">Fits now</th><th className="p-r">Used</th><th /></tr></thead><tbody><RuleRows list={RULES} /></tbody></table>
      </section>
      <section className="p-card p-list">
        <div className="p-card-h p-pad"><h2>Firm-wide rules</h2><span className="p-quiet">For every client, after the client's own</span></div>
        <table className="p-table"><thead><tr><th /><th>Rule</th><th>Does</th><th>Made</th><th className="p-r">Fits now</th><th className="p-r">Used</th><th /></tr></thead><tbody><RuleRows list={FIRM_RULES} firm /></tbody></table>
      </section>
      <details className="p-card p-details"><summary><ChevronRight size={15} />Remembered choices <span className="p-quiet">142 parties booked before · used for “Booked before” and “Similar past entry” · clean up or forget one</span></summary></details>
    </div>
  </Shell>;
}
