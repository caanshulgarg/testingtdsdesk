// Bank in the new look (the owner, 22-Nov-2026: "all the learnings of the old bank page must go with the new design,
// proper filters, columns like the old one"; "a bank statements tab"; "page is eating lot of spaces therefore little
// bank entries is being seen"). Four tabs: Statements · Lines to review · Rules · Reconciliation.
//   - Lines to review IS today's bank page (screens/Bank.jsx BankPage): every column, its filter in the column's heading
//     (ColFunnel / HeadFilter, the old design's), the suggestions and their source, splits, the bulk bar, the drawer, the
//     checks, More's tools, Post. Only its spacing changes (newlook.css: one slim head line, one-line rows), and the bank
//     rail gives way to the new menu (folded to icons under 1400 px);
//   - Statements: every statement of the client, by account, in the one list table (ListTable: a filter in every
//     heading, sort, totals of what is shown): period, file, uploaded, lines, opening and closing (✓ when the opening is
//     the closing before it), how many are done, one status word; a month missing between two statements is a dashed
//     row with Upload. A click opens that statement's lines;
//   - Rules: today's rules (b.filter "rules"); Reconciliation: the reconciliation with Tally (BankChecks Recon).
import { BankPage } from "../screens/Bank.jsx";
import { Recon } from "../parts/BankChecks.jsx";
import ListTable from "../parts/ListTable.jsx";
import { NLSkel, Pill } from "./parts.jsx";
import "./newlook.css";

const TABS = [["stmts", "Statements"], ["lines", "Lines to review"], ["rules", "Rules"], ["recon", "Reconciliation"]];
const d10 = (s) => String(s || "").slice(0, 10);
const addDay = (d, n) => { const t = Date.parse(d10(d) + "T00:00:00Z"); return isNaN(t) ? "" : new Date(t + n * 864e5).toISOString().slice(0, 10); };
const last4Of = (co, st) => { const a = ((co && co.bankAccounts) || []).find((x) => x.id === st.acctId) || {}; return a.last4 || String(st.acct || "").slice(-4); };
const acctName = (co, st) => { const a = ((co && co.bankAccounts) || []).find((x) => x.id === st.acctId) || {}, l4 = last4Of(co, st); return (st.bank || a.bank || "Bank") + (l4 ? " ··" + l4 : ""); };

// a statement's counts: its lines as they are now when it is the one open, else as last kept with it
function countsOf(b, st) {
  if (b.cur === st.id && b.rows && b.rows.length) { const c = {}; b.rows.forEach((r) => { if (!(typeof bankAside === "function" && bankAside(r))) c[r.state] = (c[r.state] || 0) + 1; }); return c; }
  return st.counts || null;
}
// every statement, by account and date, with a dashed row for a month missing between two of them
export function stmtRows(b, co) {
  const by = new Map();
  (b.stmts || []).forEach((st) => { const k = st.acctId || st.bank || ""; (by.get(k) || by.set(k, []).get(k)).push(st); });
  const out = [];
  by.forEach((list) => {
    list.sort((x, y) => String(x.from || "").localeCompare(String(y.from || "")));
    list.forEach((st, i) => {
      const prev = list[i - 1], c = countsOf(b, st), n = st.n || (c ? Object.values(c).reduce((a, x) => a + x, 0) : 0);
      const done = c ? (c.sent || 0) + (c.intally || 0) + (c.ignored || 0) : null, review = c ? (c.attention || 0) + (c.suggested || 0) : null, ready = c ? c.ready || 0 : null;
      if (prev && prev.to && st.from && addDay(prev.to, 4) < d10(st.from)) out.push({ id: "gap:" + st.id, gap: true, acct: acctName(co, st), from: addDay(prev.to, 1), to: addDay(st.from, -1) });
      // the chain: this statement opens where the one before it closed
      const chain = prev && prev.closing !== undefined && st.opening !== undefined ? Math.abs(Number(prev.closing) - Number(st.opening)) < 0.01 : null;
      const why = st.badRows ? st.badRows + " lines do not agree with the running balance" : chain === false ? "Opens at " + money(st.opening) + "; the statement before closed at " + money(prev.closing) : st.cut ? "Some pages were not read" : "";
      const word = why ? "Problem" : !c ? "New" : review ? "To review" : ready ? "Ready" : done >= n && n ? "Done" : "To review";
      out.push({ id: st.id, st, acct: acctName(co, st), from: d10(st.from), to: d10(st.to), file: st.fileName || "", up: d10(st.uploadedAt), n, done, word, why, chain, open: b.cur === st.id });
    });
  });
  return out;
}

function Statements({ b, co }) {
  const rows = stmtRows(b, co), open = (r) => () => { if (r.gap) return doAct("uploadHere"); S.nlBankTab = "lines"; Promise.resolve(b.cur === r.id ? null : openStatement(r.id)).then(() => { if (bankTab() === "rules") bankTabGo("review"); render(); }); };
  const cols = [
    { k: "acct", role: "party", label: "Account", v: (r) => r.acct, cell: (r) => <b>{r.acct}</b> },
    { k: "from", role: "date", label: "From", v: (r) => r.from, cell: (r) => (r.from ? fmtDate(r.from) : "") },
    { k: "to", role: "date", label: "To", v: (r) => r.to, cell: (r) => (r.to ? fmtDate(r.to) : "") },
    { k: "file", label: "File", v: (r) => (r.gap ? "" : r.file), cell: (r) => (r.gap ? <span className="nl-gap-w" data-nl-gap="">{"Statement missing for " + fmtDate(r.from) + " – " + fmtDate(r.to)}</span> : <span className="nl-cut" title={r.file}>{r.file || "—"}</span>) },
    { k: "up", role: "date", label: "Uploaded", v: (r) => r.up || "", cell: (r) => (r.up ? fmtDate(r.up) : "") },
    { k: "n", label: "Lines", cls: "n", v: (r) => (r.gap ? null : r.n), sum: (r) => (r.gap ? 0 : r.n), fmt: (t) => String(t), cell: (r) => (r.gap ? "" : r.n) },
    { k: "open", role: "amount", label: "Opening", sum: false, v: (r) => (r.gap || r.st.opening === undefined ? null : Number(r.st.opening)),
      cell: (r) => (r.gap || r.st.opening === undefined ? "" : <>{money(r.st.opening)}{r.chain === true && <span className="nl-ok" title="The statement before closed at this balance"> ✓</span>}</>) },
    { k: "close", role: "amount", label: "Closing", sum: false, v: (r) => (r.gap || r.st.closing === undefined ? null : Number(r.st.closing)), cell: (r) => (r.gap || r.st.closing === undefined ? "" : money(r.st.closing)) },
    { k: "done", label: "Done", v: (r) => (r.gap || r.done === null ? null : r.n ? Math.round((100 * r.done) / r.n) : 0),
      cell: (r) => (r.gap || r.done === null ? "" : <span className="nl-prog" title={r.done + " of " + r.n + " lines done"}><i style={{ "--w": (r.n ? Math.min(100, (100 * r.done) / r.n) : 0) + "%" }} /><small>{r.done + " of " + r.n}</small></span>) },
    { k: "st", role: "status", label: "Status", v: (r) => (r.gap ? "Problem" : r.word), cell: (r) => <><Pill w={r.gap ? "Problem · missing" : r.word} />{r.why && <div className="nl-why">{r.why}</div>}</> },
    { k: "ac", role: "act", cls: "n", cell: (r) => <button type="button" className={"btn small" + (r.gap ? "" : r.open ? " primary" : "")} data-nl-stmt-open={r.id} onClick={open(r)}>{r.gap ? "Upload" : "Open"}</button> },
  ];
  return <div className="nl-stmts" data-nl-stmts="">
    <ListTable name="nlStmts" className="bk-table nl-table" cols={cols} rows={rows} rowKey={(r) => r.id} unit={["statement", "statements"]}
      rowProps={(r) => ({ className: (r.gap ? "nl-gap" : "") + (r.open ? " nl-open" : ""), "data-nl-stmt": r.id, onDoubleClick: open(r) })}
      empty={<>No bank statement yet. <button type="button" className="linkbtn" onClick={() => doAct("uploadHere")}>Upload one</button>: Excel or CSV from net banking works best; PDFs are read too.</>} />
  </div>;
}

function ReconTab({ b }) {
  const live = typeof Bridge === "object" && Bridge.on() && Bridge.up(), R = S.recon, st = curStmt();
  if (R && st && R.sid === st.id) return <Recon />;
  return <div className="nl-card" data-nl-recon="">
    <p><b>{st ? "Reconcile " + stmtLabel(st) + " with Tally" : "Open a statement first"}</b></p>
    <p className="note">Every line of the statement against the bank ledger in Tally: what to post, what to delete.</p>
    {st && (live ? <button type="button" className="btn small primary" data-nl-recon-run="" onClick={() => bankAct("reconRun")}>Reconcile with Tally</button>
      : <><p className="note">This needs FinCom Bridge with Tally open on this computer. Or match with a Tally bank book file.</p>
        <button type="button" className="btn small" onClick={() => bankAct("bookPick")}>Match with Tally bank book</button></>)}
    {b.busy && <p className="note">{b.busy}</p>}
  </div>;
}

export default function NLBank() {
  const b = B(), co = CO();
  if (!b || b.cid !== co.id) { loadBank(co.id); return <NLSkel rows={14} cols={7} what="bank statements" />; }
  if (b.loading) return <NLSkel rows={14} cols={7} what="bank statements" />;
  // Lines to review first when there is a statement open, Statements otherwise (decision D10)
  const rulesOn = typeof bankTab === "function" && curStmt() && bankTab() === "rules";
  let tab = S.nlBankTab || (curStmt() ? "lines" : "stmts");
  if (tab === "lines" && rulesOn) tab = "rules";
  if (tab === "rules" && !curStmt()) tab = "stmts";
  const pick = (k) => () => {
    S.nlBankTab = k;
    if (k === "rules" && curStmt()) return bankTabGo("rules");
    if (k === "lines" && rulesOn) return bankTabGo("review");
    render();
  };
  const tc = curStmt() && typeof tabCounts === "function" ? tabCounts(b.rows) : null;
  const n = { stmts: (b.stmts || []).length, lines: tc ? tc.review : null, rules: (b.rules || []).length + (b.wrules || []).length };
  // (no box of its own: the bank page's layout, parts/bank/spacious.css, lays out the page's own boxes in #app's row)
  return <>
    <nav className="nl-tabs nl-banktabs" aria-label="Bank" data-nl-bank={tab}>
      {TABS.map(([k, w]) => <button key={k} type="button" className="nl-tab" data-nl-banktab={k} aria-current={k === tab ? "page" : undefined} disabled={(k === "rules" || k === "lines") && !curStmt() && (b.stmts || []).length === 0} onClick={pick(k)}>
        {w}{n[k] != null && n[k] > 0 && <span className="nl-tab-n">{n[k]}</span>}</button>)}
    </nav>
    {tab === "stmts" ? <Statements b={b} co={co} /> : tab === "recon" ? <ReconTab b={b} /> : <BankPage />}
  </>;
}
