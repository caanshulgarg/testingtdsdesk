// The proposal's second round of screens (owner's review of 22-Nov-2026, made-up data): Bank › Statements and its upload
// drawer, and a clean Settings. main.jsx picks one from ?s=.
import { Landmark, Upload, Search, ChevronRight, CircleCheck, TriangleAlert, CalendarX, FileText, X, Check, FileUp, Building2, CalendarRange,
  ListChecks, User, Users, Shield, SlidersHorizontal, Mail, CreditCard, Wrench, Plug, ArrowRight } from "lucide-react";
import { Shell, TopBar, Pill, BankTabs, inr } from "./ui.jsx";
import { CLIENT, BANKS, STATEMENTS, FIRM } from "./data.js";

const Chip = ({ on, n, children }) => <button className="p-chip" aria-pressed={on ? "true" : "false"}>{children}{n != null && <em>{n}</em>}</button>;
const Bal = ({ v, ok, bad }) => <span className="p-bal">{inr(v)}{ok && <CircleCheck size={14} className="p-okic" aria-label="Balance checks" />}{bad && <TriangleAlert size={14} className="p-warnic" aria-label="Does not follow on" />}</span>;
const Prog = ({ done, n }) => <span className="p-prog"><span><b>{done}</b> of {n} done</span><i><b style={{ width: (n ? done / n * 100 : 0) + "%" }} data-full={done === n ? "" : undefined} /></i></span>;

/* ---------------------------------------------------------------- Bank › Statements */
export function BankStatements({ phone, upload }) {
  const all = STATEMENTS.flatMap((a) => a.rows.filter((r) => !r.gap));
  const count = (st) => all.filter((r) => r.st === st).length;
  return <Shell scope="client" active="bank" phone={phone} overlay={upload ? <UploadDrawer /> : null}>
    <TopBar title="Bank" crumb={<>{CLIENT.name}</>} />
    <BankTabs on="stmts" right={<button className="p-btn p-sm p-primary"><Upload size={14} />Upload statement</button>} />
    <div className="p-page">
      <div className="p-acct">
        <button className="p-acct-i" aria-pressed="true"><Landmark size={16} /><span><b>All accounts</b><small>{all.length} statements · FY 2026-27</small></span></button>
        {BANKS.map((b, i) => <button key={b.no} className="p-acct-i"><Landmark size={16} /><span><b>{b.name} ••{b.no}</b><small>{inr(b.bal)} · {b.asOf}</small></span>{i === 0 && <em className="p-count" title="1 month missing">Oct missing</em>}</button>)}
        <button className="p-acct-add">+ Add account</button></div>
      <div className="p-list-bar p-bare">
        <div className="p-chips"><Chip on n={all.length}>All</Chip><Chip n={count("new")}>New</Chip><Chip n={count("review")}>To review</Chip><Chip n={count("ready")}>Ready</Chip><Chip n={count("done")}>Done</Chip><Chip n={count("problem")}>Problem</Chip></div>
        <div className="p-list-tools"><span className="p-mini-search"><Search size={14} />File name, month</span></div>
      </div>
      {STATEMENTS.map((a) => <section key={a.acct} className="p-card p-list p-stgroup">
        <div className="p-grp-h"><Landmark size={18} className="p-ic-brand" /><div><b>{a.bank} ••{a.acct}</b><small>{a.kind} · {a.rows.filter((r) => !r.gap).length} statements · {a.span}</small></div>
          <span className="p-grow" /><span className="p-quiet">Closing <b className="p-num">{inr(a.rows[0].close)}</b> on {a.rows[0].to}</span></div>
        <table className="p-table p-sttable">
          <thead><tr><th>Period</th><th>File</th><th>Uploaded</th><th className="p-r">Lines</th><th className="p-r">Opening</th><th className="p-r">Closing</th><th>Progress</th><th>Status</th><th /></tr></thead>
          <tbody>{a.rows.map((r, i) => r.gap
            ? <tr key={i} className="p-gaprow"><td colSpan={9}><div className="p-gap"><CalendarX size={16} /><span><b>{r.mon} statement missing</b><small>{r.from} – {r.to} · the balance can't be checked across it</small></span><span className="p-grow" /><button className="p-btn p-sm">Ask the client</button><button className="p-btn p-sm p-dashed"><Upload size={13} />Upload</button></div></td></tr>
            : [<tr key={r.id} className={"p-strow" + (r.id === "h11" ? " p-hover" : "")}>
                <td><b className="p-nowrap">{r.from} – {r.to}</b><small>{a.bank.split(" ")[0]} ••{a.acct} · {r.mon}</small></td>
                <td><span className="p-file"><FileText size={14} />{r.file}</span></td>
                <td className="p-nowrap"><span>{r.up}</span><small>{r.by}</small></td>
                <td className="p-r p-num">{r.n}</td>
                <td className="p-r p-num"><Bal v={r.open} ok={r.ok} bad={!r.ok} /></td>
                <td className="p-r p-num"><Bal v={r.close} ok={r.ok} /></td>
                <td><Prog done={r.done} n={r.n} /></td>
                <td><Pill st={r.st} /></td>
                <td className="p-r"><ChevronRight size={16} className="p-quiet" /></td></tr>,
              r.why && <tr key={r.id + "w"} className="p-exp p-exp-bad p-stnote"><td colSpan={9}><div className="p-exp-in"><TriangleAlert size={15} /><span>{r.why}</span><span className="p-grow" /><button className="p-btn p-sm">Upload the full PDF</button></div></td></tr>,
              r.overlap && <tr key={r.id + "o"} className="p-stnote p-warnrow"><td colSpan={9}><div className="p-warnbox"><TriangleAlert size={15} /><span>{r.overlap}</span><span className="p-grow" /><button className="p-btn p-sm">See the 38 lines</button></div></td></tr>])}
          </tbody>
        </table>
      </section>)}
      <p className="p-quiet p-foot-note">Open a statement to see its lines. The balance ✓ means its lines add up from opening to closing, and its opening is the closing before it.</p>
    </div>
  </Shell>;
}

// the upload drawer: drop a file; the account and the period are found; the Read step adds up the lines
function UploadDrawer() {
  const steps = [
    { ic: FileUp, t: "File", v: <><b>Acct_Statement_XX4521_Oct2026.pdf</b><span className="p-quiet">PDF · 412 KB</span></>, s: "Dropped" },
    { ic: Building2, t: "Account", v: <><b>HDFC Bank ••4521</b><span className="p-quiet">found on page 1</span></>, s: "Found", act: "Change" },
    { ic: CalendarRange, t: "Period", v: <><b>1-Oct – 31-Oct-2026</b><span className="p-quiet">fills the missing month</span></>, s: "Found", act: "Change" },
    { ic: ListChecks, t: "Read", v: <><b>251 lines read</b><span className="p-quiet">Opening {inr(1588230)} · Closing {inr(1721064)}</span></>, s: "Balance checks", ok: true },
  ];
  return <div className="p-scrim p-scrim-r"><aside className="p-drawer" role="dialog" aria-label="Upload statement">
    <header className="p-drawer-h"><div><h2>Upload statement</h2><small>{CLIENT.short}</small></div><button className="p-icon" aria-label="Close"><X size={18} /></button></header>
    <div className="p-drawer-b">
      <div className="p-dropzone"><Upload size={20} /><div><b>Drop a PDF, Excel or CSV here</b><small>or <a className="p-link">choose a file</a> · any bank · password-protected PDFs are fine</small></div></div>
      <ol className="p-upsteps">{steps.map((x, i) => <li key={i}>
        <span className="p-step-n p-done"><Check size={14} strokeWidth={3} /></span>
        <div><span className="p-up-t">{x.t}</span><div className="p-up-v">{x.v}</div></div>
        <span className="p-up-s">{x.ok ? <span className="p-okline"><CircleCheck size={14} />{x.s}</span> : <span className="p-quiet">{x.s}</span>}{x.act && <a className="p-link">{x.act}</a>}</span>
      </li>)}</ol>
      <div className="p-chain"><CircleCheck size={16} /><span>Opening matches September's closing, and closing matches November's opening.</span></div>
    </div>
    <footer className="p-drawer-f"><span className="p-quiet">Next: FinCom suggests a ledger for each line. Nothing goes to Tally until you confirm.</span>
      <div className="p-row-btns"><button className="p-btn">Cancel</button><button className="p-btn p-primary">Add statement</button></div></footer>
  </aside></div>;
}

/* ---------------------------------------------------------------- Settings, cleaned up */
// 6 groups, each a plain name; one short line of help per setting. Tally, GST API, Sent to Tally etc. are gone (their pages)
const SET_GROUPS = [
  { k: "firm", w: "Firm", ic: Building2, s: "Iyer & Rao Associates · 4 people" },
  { k: "me", w: "My account", ic: User, s: "anil@iyerrao.in · 2-step on" },
  { k: "defaults", w: "Client defaults", ic: SlidersHorizontal, s: "FY 2026-27 · TDS rates" },
  { k: "mail", w: "Email and messages", ic: Mail, s: "Test mode on", warn: true },
  { k: "billing", w: "Billing", ic: CreditCard, s: "Practice plan · ₹4,250 left" },
  { k: "adv", w: "Advanced", ic: Wrench, s: "Reading, AI, backups" },
];
const Set = ({ t, help, children }) => <div className="p-setrow"><div><b>{t}</b><small>{help}</small></div><div className="p-setval">{children}</div></div>;
export function Settings({ phone }) {
  return <Shell scope="firm" active="settings" phone={phone}>
    <TopBar title="Settings" sub={phone ? null : "For the whole firm. A client's own settings are under that client."} />
    <div className="p-page p-setpage">
      <nav className="p-setnav" aria-label="Settings">{SET_GROUPS.map((g, i) => <a key={g.k} className="p-seti" aria-current={!phone && i === 0 ? "page" : undefined}>
        <g.ic size={18} strokeWidth={1.8} /><span><b>{g.w}</b><small data-warn={g.warn ? "" : undefined}>{g.s}</small></span><ChevronRight size={16} className="p-quiet" /></a>)}
        <div className="p-setmoved"><Plug size={15} /><span>Tally is set up on the <a className="p-link">Tally page</a> only.</span></div>
      </nav>
      {!phone && <section className="p-card p-setbody">
        <div className="p-card-h"><h2>Firm</h2><span className="p-quiet">Saved 2 min ago</span></div>
        <Set t="Firm name" help="On every page, and on letters and MIS packs for clients."><span className="p-input">{FIRM.name}</span></Set>
        <Set t="Address" help="Printed under the name on letters and reports."><span className="p-input">14 Nehru Place, New Delhi 110019</span></Set>
        <Set t="Logo" help="PNG or JPG; shown on reports."><span className="p-logo">IR</span><button className="p-btn p-sm">Change</button></Set>
        <Set t="People and roles" help="Who can sign in, and what each may do.">
          <div className="p-people">{[["Anil Iyer", "Owner"], ["Meera Rao", "Owner"], ["Priya S", "Staff"], ["Rahul K", "Look only"]].map(([n, r]) =>
            <div key={n}><span className="p-av sm">{n.split(" ").map((x) => x[0]).join("")}</span><b>{n}</b><span className="p-role">{r}</span></div>)}
            <button className="p-btn p-sm p-dashed"><Users size={13} />Add a person</button></div></Set>
        <Set t="Keep documents for" help="Bills and statements in the firm account; then they are deleted."><span className="p-input">3 years ▾</span></Set>
      </section>}
    </div>
  </Shell>;
}
