// AI help (Claude's suggestions, accepted or rejected by the firm's people): the ledgers the rules cannot settle (TDS
// section, blocked credit), the button on Audit, pairing 2B invoices, notices with a drafted reply, and its settings.
// Was AIH.viewLedgers, coverageCard, auditButton, r2bBar, pairCell, viewNotices and viewSettings (src/js/50); the work
// is AIH; buttons and boxes go through aihAct, aihAccept, aihPay, aihPair, aihFix, aihNote, aihNotice, aihReply, aihSet,
// aihCo (src/js/50).
import { useRef } from "react";
import CommitBox from "./CommitBox.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const pc = (k, n) => n ? Math.round(k * 100 / n) + "%" : "—";

// how much the rules settled, how much AI, and how right AI has been
export function CoverageCard() {
  if (!S.books || !(S.books.vouchers || []).length) return null;
  const c = AIH.coverage(), t = c.tds, i = c.itc, it = i.rules + i.ai + i.pend, a = c.ai, done = a.asIs + a.changed + a.rejected;
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>{"Rules first, AI for the rest: " + ((CO() || {}).name || "this client")}</h3>
    <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th></th><th className="n">By FinCom’s rules</th><th className="n">By AI, accepted</th><th className="n">Still open</th></tr></thead><tbody>
      <tr><td>{"TDS section of " + c.n + " expense and purchase ledgers"}</td><td className="n">{t.rules + " (" + pc(t.rules, c.n) + ")"}</td><td className="n">{t.ai + " (" + pc(t.ai, c.n) + ")"}</td><td className="n">{t.pend + " (" + pc(t.pend, c.n) + ")"}</td></tr>
      <tr><td>{"GST credit on " + it + " ledgers with credit taken"}</td><td className="n">{i.rules + " (" + pc(i.rules, it) + ")"}</td><td className="n">{i.ai + " (" + pc(i.ai, it) + ")"}</td><td className="n">{i.pend + " (" + pc(i.pend, it) + ")"}</td></tr></tbody></table></div>
    <p className="note">{"How right AI has been here: " + (done ? a.asIs + " accepted as suggested (" + pc(a.asIs, done) + "), " + a.changed + " corrected, " + a.rejected + " rejected" : "nothing decided yet") + (a.waiting ? "; " + a.waiting + " waiting for someone to look" : "") + ". 2B pairs by the rules are on the 2B screen."}</p></section>;
}

const Pick = ({ l, f, val, opts }) => <select aria-label={(f === "tds" ? "TDS section: " : "GST credit: ") + l} value={val} onChange={(ev) => aihFix(l, f, ev.target.value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>;

// the Tally ledgers' AI view: the ledgers the rules could not settle, each with AI's suggestion to accept or change
export function AiLedgers({ b }) {
  const a = AIH.st(), wantTds = AIH.enabled("tds"), wantItc = AIH.enabled("audit");
  if (!wantTds && !wantItc) return <p className="note">AI help for TDS and audit is off. Settings, AI help.</p>;
  const stats = AIH.ledgerStats(), left = stats.filter((x) => (wantTds && !AIH.ruleTds(x)) || (wantItc && !AIH.ruleItc(x)));
  const rows = left.filter((x) => a.led[x.l]), notYet = left.length - rows.length;
  const isOpen = (y) => (y.tds && !y.tdsOk) || (y.itc && !y.itcOk), pend = rows.filter((x) => isOpen(a.led[x.l]));
  const pay = Object.entries(a.tdsPay).filter(([n]) => (b.map || {})[n] && !(b.map[n].ok && b.map[n].section));
  const tdsOpts = [["unsure", "unsure"], ["none", "no TDS"]].concat(RULE_DEFAULTS.map((r) => [r.id, r.old + " · " + r.label]));
  const list = rows.slice().sort((x, y) => (isOpen(a.led[x.l]) ? 0 : 1) - (isOpen(a.led[y.l]) ? 0 : 1) || y.amt - x.amt).slice(0, 300);
  return <>
    <section className="dash-card"><h3>AI: TDS section and blocked credit, ledger by ledger</h3>
      <p className="note">{"FinCom’s rules settle " + (stats.length - left.length) + " of " + stats.length + " ledgers by themselves. For the " + left.length + " they cannot, AI reads each ledger’s name, group, narrations and parties" + (wantTds ? " and suggests its TDS section" : "") + (wantItc ? (wantTds ? ", and" : " and says") + " whether GST credit on it is blocked under section 17(5)" : "") +
        ". Check and accept each: the audit’s checks for missed TDS and blocked credit then use what you accepted. Nothing here changes Tally or a return."}</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><button className="btn small primary" onClick={() => aihAct("review")}>{notYet ? "Ask AI about " + notYet + " ledger" + (notYet === 1 ? "" : "s") : "Nothing new to ask"}</button>
        {rows.length > 0 && <button className="btn small" onClick={() => aihAct("reviewAgain")}>Review all again</button>}
        <span className="note">{rows.length + " reviewed · " + pend.length + " to accept"}</span></div></section>
    <CoverageCard />
    {wantTds && pay.length > 0 && <section className="dash-card" style={{ marginTop: 12 }}><h3>TDS ledgers without a section</h3><div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>Ledger</th><th>AI suggests</th><th>Why</th><th></th></tr></thead><tbody>
      {pay.map(([n, s]) => { const r = AIH.rule(s.rule); return <tr key={n}><td>{n}</td><td>{r.old + " · " + r.label}</td><td>{s.reason}</td><td className="ac"><button className="btn small primary" onClick={() => aihPay(n, true)}>Accept</button> <button className="btn small" onClick={() => aihPay(n, false)}>Not this</button></td></tr>; })}</tbody></table></div></section>}
    {rows.length > 0 && <div className="bk-tablewrap" style={{ marginTop: 12 }}><table className="bk-table"><thead><tr><th>Ledger</th><th className="n">Booked</th>{wantTds && <th>TDS section</th>}{wantItc && <th>GST credit</th>}<th>AI’s reason</th><th>Status</th></tr></thead><tbody>
      {list.map((x, i) => { const y = a.led[x.l], open = isOpen(y);
        return <tr key={x.l + ":" + i} data-key={x.l}><td>{x.l}<div className="nr">{(x.group || "") + " · " + x.n + " entries" + (x.tds ? " · TDS on " + x.tds : "") + (x.itc ? " · credit on " + x.itc : "")}</div></td><td className="n">{money(x.amt)}</td>
          {wantTds && <td><Pick l={x.l} f="tds" val={y.tds || "unsure"} opts={tdsOpts} /></td>}
          {wantItc && <td><Pick l={x.l} f="itc" val={y.itc || "unsure"} opts={[["unsure", "unsure"], ["allowed", "allowed"], ["blocked", "blocked, 17(5)"]]} />{y.clause && <div className="nr">{y.clause}</div>}</td>}
          <td>{y.reason || ""}</td>
          <td>{open ? <><button className="btn small primary" onClick={() => aihAccept(x.l, true)}>Accept</button> <button className="btn small" onClick={() => aihAccept(x.l, false)}>Reject</button></>
            : <span className="nr">{((y.tdsOk || y.itcOk) === "no" ? "rejected" : "accepted") + " by " + (y.okBy || "") + (y.okAt ? " on " + fmtDate(String(y.okAt).slice(0, 10)) : "")}</span>}</td></tr>; })}
    </tbody></table></div>}
  </>;
}

// on the Audit tab: open the ledgers' AI review
export function AuditButton() {
  if (!(AIH.enabled("tds") || AIH.enabled("audit"))) return null;
  const led = ((S.books || {}).ai || {}).led || {}, open = Object.values(led).filter((y) => (y.tds && !y.tdsOk) || (y.itc && !y.itcOk)).length;
  return <button className="btn small" onClick={() => aihAct("auditReview")}>{"AI review of ledgers" + (open ? " (" + open + " to accept)" : "")}</button>;
}

// on 2B: ask AI to pair the invoices left after the matching
export function R2bBar({ list, free }) {
  if (!AIH.enabled("r2b") || !list.length) return null;
  AIH._r2 = { list, free };
  const pairs = AIH.st().pairs, n = Object.keys(pairs).filter((k) => !pairs[k].no).length;
  return <div className="row" style={{ gap: 8, alignItems: "center", margin: "0 0 8px" }}><button className="btn small" onClick={() => aihAct("pair2b")}>Ask AI to pair these</button>
    <span className="note">{"AI looks for the same invoice under another number or date format (e.g. INV/24-25/0045 and 45). " + (n ? n + " suggestion" + (n === 1 ? "" : "s") + " below, to accept or not." : "Each suggestion waits for you to accept it.")}</span></div>;
}

// under a 2B invoice: AI's pair, to accept or not
export function PairCell({ p }) {
  if (!AIH.enabled("r2b") || !S.books.ai) return null;
  const s = (S.books.ai.pairs || {})[p.key];
  if (!s || s.no || ((GST2B.state().link || {})[p.key])) return null;
  return <div className="nr" style={{ marginTop: 4 }}>{"AI: " + s.label + (s.diff ? " (tax differs by " + INR.format(s.diff) + ")" : "") + " — " + s.reason + " "}
    <button className="linkbtn" onClick={() => aihPair(p.key, true)}>accept</button> · <button className="linkbtn" onClick={() => aihPair(p.key, false)}>not this</button></div>;
}

function Notice({ n }) {
  const f = n.fields || {};
  return <section className="dash-card" style={{ marginTop: 12 }} data-key={n.id}><h3>{(f.form || "Notice") + (f.ref ? " · " + f.ref : "")}</h3>
    <p className="note">{n.name + " · added " + fmtDate(String(n.at).slice(0, 10)) + " by " + (n.by || "") + (f.date ? " · dated " + fmtDate(f.date) : "")}{f.reply_by && <>{" · "}<b>{"reply by " + fmtDate(f.reply_by)}</b></>}
      {" · "}<button className="linkbtn" onClick={() => aihNote("open", n.id)}>open</button> · <button className="linkbtn" onClick={() => aihNote("del", n.id)}>remove</button></p>
    {n.step === "failed" && <p className="bk-warn">{"Could not be read: " + (n.error || "") + " "}<button className="linkbtn" onClick={() => aihNote("retry", n.id)}>try again</button></p>}
    {f.summary && <p>{f.summary}</p>}
    {(f.issues || []).length > 0 && <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>The officer’s point</th><th>Period</th><th className="n">Amount</th></tr></thead><tbody>
      {f.issues.map((x, i) => <tr key={i}><td>{x.point || ""}</td><td>{x.period || ""}</td><td className="n">{num(x.amount) ? INR.format(num(x.amount)) : ""}</td></tr>)}</tbody></table></div>}
    {n.reply ? <><h4 style={{ margin: "12px 0 6px" }}>Draft reply (AI, to be checked)</h4>
      <CommitBox as="textarea" aria-label="Draft reply" value={n.reply} rows={16} style={{ width: "100%", font: "13px/1.5 inherit" }} onCommit={(v) => aihReply(n.id, v)} />
      <div className="row" style={{ gap: 8, marginTop: 6 }}><button className="btn small" onClick={() => aihNote("copy", n.id)}>Copy</button><button className="btn small" onClick={() => aihNote("dl", n.id)}>Download as text</button><button className="btn small" onClick={() => aihNote("redo", n.id)}>Draft again with today’s books</button></div></>
      : n.step === "read" ? <button className="btn small primary" onClick={() => aihNote("redo", n.id)}>Draft the reply</button> : null}
  </section>;
}

// TDS or GST notices: add one, AI reads it and drafts a reply from the client's figures
export function Notices({ b, kind }) {
  const file = useRef(null);
  if (!AIH.enabled("notices")) return <p className="note">AI help for notices is off. Settings, AI help.</p>;
  const list = ((b.ai || {}).notices || []).filter((n) => n.kind === kind);
  return <>
    <section className="dash-card"><h3>{(kind === "tds" ? "TDS" : "GST") + " notices"}</h3>
      <p className="note">Add the notice (PDF or photo). AI reads it, FinCom puts its points against this client’s books and returns, and AI drafts a reply for you to check. The draft uses only those figures; anything to verify is marked [to check]. Nothing is sent from here.</p>
      <label className="btn small primary">Add a notice<input ref={file} type="file" accept=".pdf,image/*" hidden aria-label="Add a notice" onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) aihNotice(f, kind); }} /></label></section>
    {list.map((n) => <Notice key={n.id} n={n} />)}
  </>;
}

// Settings, AI help: on or off, each kind of help, clients kept away from AI, and what AI did
export function AiSettings() {
  const c = AIH.cfg(), cos = Object.values(S.companies || {}).sort((x, y) => String(x.name).localeCompare(String(y.name)));
  const Cb = ({ k, on, dis, children }) => <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0" }}><input type="checkbox" checked={!!on} disabled={dis} onChange={(ev) => aihSet(k, ev.target.checked)} /><span>{children}</span></label>;
  const lg = (S.books && S.books.ai && S.books.ai.log) || [];
  return <>
    <section className="dash-card"><h3>AI help in TDS and GST</h3>
      <p className="note">Claude suggests; FinCom’s rules work out tax and make returns; your people accept or reject each suggestion, and who accepted it is kept. Each use is charged to the firm’s credit like reading a bill. The client’s ledger names, narrations, invoice details and notices are sent to Claude through the firm’s account: tell your clients, and switch it off below for any client who has not agreed.</p>
      <Cb k="on" on={c.on}><b>Use AI help</b></Cb>
      <div style={{ marginLeft: 24 }}>{AIH.FEATURES.map(([k, l]) => <Cb key={k} k={k} on={c[k] !== false} dis={!c.on}>{l}</Cb>)}</div></section>
    <section className="dash-card" style={{ marginTop: 12 }}><h3>Clients</h3><p className="note">Tick a client to keep its data away from AI, whatever is switched on above.</p><div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Client</th><th>AI off for this client</th></tr></thead><tbody>
      {cos.map((co) => <tr key={co.id}><td>{co.name || co.id}</td><td><input type="checkbox" checked={!!co.aiOff} aria-label={"AI off for " + (co.name || "")} onChange={(ev) => aihCo(co.id, ev.target.checked)} /></td></tr>)}</tbody></table></div></section>
    {S.books && S.books.cid === S.coId && <CoverageCard />}
    {lg.length > 0 && <section className="dash-card" style={{ marginTop: 12 }}><h3>{"What AI did for " + ((CO() || {}).name || "this client")}</h3><div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th className="dt">When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
      {lg.slice(0, 40).map((x, i) => <tr key={i}><td className="dt">{String(x.at).replace("T", " ").slice(0, 16)}</td><td>{x.by}</td><td>{x.what}</td><td>{x.detail}</td></tr>)}</tbody></table></div></section>}
  </>;
}
