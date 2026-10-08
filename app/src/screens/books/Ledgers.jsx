// The "Tally ledgers" tab of a client's books: the GST and TDS ledgers from Tally, simpler (FinCom 2.4.0; the owner of
// 08-Oct-2026: "there should be simple page of tds & gst tally ledger import page.. it is currently in very bad shape").
// One flow, in plain words, like the simpler Tally pages:
//   1. one status line a book: "Ledgers from Tally: 1,248 · last updated 2 min ago · 3 need you", with "Read again now"
//      only where it already exists (the bridge here: ledRead; FinCom's cloud copy: Ledgers.refresh) and, only when no
//      bridge or cloud copy serves the client, one Upload button for the ledger masters file (mastersPick);
//   2. Needs you (the only yellow), GST ledgers, TDS ledgers: one simple table each, ONE answer and ONE action a row
//      (Confirm / Change; each Needs-you line its own action);
//   3. everything confirmed folds to a count ("214 ledgers confirmed — show"); a find box; the client picked;
//   4. the rest, moved and not removed, under More: other ledgers (add one FinCom missed), what FinCom posts bills to,
//      AI: TDS and credit, Check again.
// The rows are LedPage (src/js/57); changes go through lmSet, lmConfirmToggle, lmViewGo, lmPost (src/js/23) and the doAct
// cases ledRead, mastersPick, lcRun, lcAi, lcConfirm, lmPostAll. Owner only: a rename's Confirm (as before).
//
// State: S.ledQ (the find box), S.ledShowDone (confirmed shown), S.ledEdit (the row being changed), S.ledMore (More open),
// S.lmView ("other" / "post" / "ai" open that part of More; "done" shows the confirmed).
import { AiLedgers } from "../../parts/Ai.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import Confirm from "../../parts/Confirm.jsx";
import { ListRows } from "../../parts/ListTable.jsx";
import NeedAction from "../../parts/NeedAction.jsx";
import { Evidence } from "./LedCheck.jsx";
const NR = ({ children, bad }) => <div className={"nr" + (bad ? " bad" : "")} style={{ whiteSpace: "normal" }}>{children}</div>;
const plural = (k, one, many) => k + " " + (k === 1 ? one : many);

// migration 39: a ledger renamed in Tally whose saved choices were carried (tally_ledgers.needs_confirm): one line until
// an owner confirms (tally_ledger_rename_confirm); staff see the words only
function RenameLine({ cid, name }) {
  const l = Ledgers.renamedOf(cid, name);
  if (!l) return null;
  const busy = !!(Ledgers.confirming || {})[cid + "|" + l.name];
  return <span data-renamed={l.name}>{Ledgers.renameLine(l.renamed)}
    {Ledgers.canConfirmRename() ? <>{" "}<button className="btn small" data-rename-confirm={l.name} disabled={busy} onClick={() => Ledgers.confirmRename(cid, l.name)}>{busy ? "Confirming…" : "Confirm"}</button></>
      : <span className="note">{" (an owner of the firm confirms this)"}</span>}</span>;
}

// what the ledger is: a GST head, a TDS or TCS ledger, or something else
function WhatSel({ n, m, other }) {
  const opts = (f) => LedMaster.WHAT.filter(f).map((w) => <option key={w[0]} value={w[0]}>{w[1]}</option>);
  const value = other ? (["bank", "roundoff", "none"].includes(m.what) ? "" : m.what || "") : m.what || "none";
  return <select aria-label={"What " + n + " is"} style={{ width: "auto", minWidth: 160, maxWidth: "100%" }} value={value} onChange={(ev) => lmSet(n, "what", ev.target.value)}>
    {other && <option value="">—</option>}
    <optgroup label="GST">{opts((w) => LedMaster.isGst(w[0]))}</optgroup>
    <optgroup label="TDS and TCS">{opts((w) => LedMaster.isTds(w[0]) || w[0] === "tds_interest")}</optgroup>
    <optgroup label="Other">{opts((w) => ["bank", "roundoff", "none"].includes(w[0]))}</optgroup>
  </select>;
}

// the rest of its meaning: head, side, registration and rate for GST; section and rate for TDS and TCS
function Detail({ n, m, regs }) {
  const Reg = () => <select aria-label={"Registration of " + n} style={{ width: "auto" }} value={m.reg || ""} onChange={(ev) => lmSet(n, "reg", ev.target.value)}>
    <option value="">registration?</option>{regs.map((r) => <option key={r} value={r}>{r}</option>)}</select>;
  if (LedMaster.isGst(m.what) && !/^gst_(setoff|interest|control)$/.test(m.what)) return <span className="led-sels">
    <select aria-label={"Head of " + n} style={{ width: "auto" }} value={m.tax || "IGST"} onChange={(ev) => lmSet(n, "tax", ev.target.value)}>{["IGST", "CGST", "SGST", "CESS"].map((x) => <option key={x}>{x}</option>)}</select>
    <select aria-label={"Side of " + n} style={{ width: "auto" }} value={m.side || "input"} onChange={(ev) => lmSet(n, "side", ev.target.value)}><option value="input">input</option><option value="output">output</option></select>
    {regs.length > 1 && <Reg />}
    <select aria-label={"Rate of " + n} style={{ width: "auto" }} title="Only if this ledger is for one rate" value={LedMaster.RATES.includes(num(m.gstRate)) && m.gstRate != null && m.gstRate !== "" ? String(num(m.gstRate)) : ""} onChange={(ev) => lmSet(n, "gstRate", ev.target.value)}>
      <option value="">any rate</option>{LedMaster.RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}</select>
  </span>;
  if (LedMaster.isGst(m.what) && regs.length > 1) return <Reg />;
  if (m.what === "tds_payable" || m.what === "tcs_payable") return <span className="led-sels">
    <CommitBox aria-label={"Section of " + n} data-fk={"lmsec-" + n} value={m.section || ""} placeholder={m.what === "tcs_payable" ? "206C(1H)" : "194C"} style={{ width: 90 }} onCommit={(v) => lmSet(n, "section", v)} />
    <CommitBox type="number" step="0.01" min="0" aria-label={"TDS rate of " + n} value={m.rate == null ? "" : m.rate} placeholder="rate %" style={{ width: 80 }} onCommit={(v) => lmSet(n, "rate", v)} />
  </span>;
  return null;
}

// Change: the row's answer set by hand (a draft until Save at the foot, as before); the check's suggestion is where it starts
function Editor({ b, r, other }) {
  const regs = (GSTR.gstins(b) || []).map((g) => g.slice(0, 2)), mm = (b.map || {})[r.n] || { n: 0 }, p = r.p || {}, fromPick = r.fromCheck && !mm.byHand && !mm.what && !!p.what;
  const pick = (m) => { LedMaster.applyWhat(m, p.what); if (LedMaster.isGst(p.what)) { m.tax = p.tax || m.tax; m.side = p.side || m.side; if (p.rate) m.gstRate = p.rate; } if (LedMaster.isTds(p.what)) m.section = p.section || m.section; return m; };
  // shown as the check suggests; the suggestion goes into the master only when something is changed here (lmSet then
  // keeps the rest of it), never by opening Change alone
  const m = fromPick ? pick(Object.assign({}, mm)) : mm;
  const start = (ev) => { if (fromPick && !mm.byHand && ev && ev.target && /^(SELECT|INPUT)$/.test(ev.target.tagName)) { b.map = b.map || {}; b.map[r.n] = pick(b.map[r.n] || { n: 0 }); } };
  return <div className="led-edit" data-led-editor={r.n} onChangeCapture={start}>
    <WhatSel n={r.n} m={m} other={other} /><Detail n={r.n} m={m} regs={regs} />
    {LedMaster.checks(b, r.n, m).map((w, j) => <NR key={j} bad>{w}</NR>)}
    <button className="btn small" data-led-done="" onClick={() => { S.ledEdit = ""; render(); }}>Done</button>
  </div>;
}

// a row's ONE action: Confirm (and Change beside it); a confirmed one shows ✓ with Undo, and Change
function RowAct({ b, r }) {
  if (S.ledEdit === r.n) return null;
  const change = <button className="linkbtn" data-led-change={r.n} onClick={() => { S.ledEdit = r.n; render(); }}>Change</button>;
  if (r.ok) return <span className="led-act"><button className="linkbtn ok" title="Undo: not confirmed" data-led-undo={r.n} onClick={() => lmConfirmToggle(r.n)}>✓ Confirmed</button>{change}</span>;
  return <span className="led-act"><button className="btn small" data-led-confirm={r.n} onClick={() => LedPage.confirm(b, [r.n])}>Confirm</button>{change}</span>;
}
function Name({ r }) {
  return <><b className="led-name">{r.n}</b>{r.group && <div className="nr">{r.group}</div>}</>;
}
const tag = (r) => r.alt ? <span className="tag warn" title={"FinCom’s ledger check reads it as " + r.alt}>check differs</span> : r.p && r.p.fromAi ? <span className="tag warn" title="AI’s answer: check it">AI</span> : !r.ok && r.p && r.p.conf === "medium" ? <span className="tag" title="FinCom is fairly but not fully sure">likely</span> : null;

// GST ledgers: the Tally ledger -> what FinCom treats it as (head, side, rate) -> Confirm / Change
function GstTable({ b, rows }) {
  return <table className="led-t nocards" data-led-table="gst"><thead><tr><th>Tally ledger</th><th>FinCom treats it as</th><th className="ac"></th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.n} data-key={r.n} data-ok={r.ok ? "1" : "0"}>
      <td><Name r={r} /></td>
      <td>{S.ledEdit === r.n ? <Editor b={b} r={r} /> : <><span className="led-says">{LedPage.says(r.p)}</span> {tag(r)}<Evidence r={r} /></>}</td>
      <td className="ac"><RowAct b={b} r={r} /></td></tr>)}</tbody></table>;
}
// TDS ledgers: the Tally ledger -> section and nature of payment -> Confirm / Change
function TdsTable({ b, rows }) {
  return <table className="led-t nocards" data-led-table="tds"><thead><tr><th>Tally ledger</th><th>Section</th><th>Nature of payment</th><th className="ac"></th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.n} data-key={r.n} data-ok={r.ok ? "1" : "0"}>
      <td><Name r={r} /></td>
      {S.ledEdit === r.n ? <td colSpan={2}><Editor b={b} r={r} /></td> : <>
        <td><span className="led-says">{r.p.section ? LedCheck.secLabel(r.p.section) : "—"}</span>{num(r.p.rate) ? <span className="nr">{" " + num(r.p.rate) + "%"}</span> : null} {tag(r)}
          {r.p.what !== "tds_payable" && <div className="nr">{LedMaster.label(r.p.what)}</div>}</td>
        <td>{LedPage.nature(b, r.n, r.p.section) || <span className="note">—</span>}<Evidence r={r} /></td></>}
      <td className="ac"><RowAct b={b} r={r} /></td></tr>)}</tbody></table>;
}

// the Needs-you lines: one sentence, one action each
function Needs({ b, items }) {
  if (!items.length) return null;
  return <section className="led-needs" data-led-needs="" role="status">
    <h3>Needs you <span className="sbar-n">{items.length}</span></h3>
    <table className="led-t nocards" data-led-table="needs"><tbody>
      {items.map((x) => <tr key={x.key} data-need={x.kind} data-key={x.n || x.key}>
        <td>{x.n && <Name r={x} />}<div className="led-need-text">{x.text}</div>{x.more}</td>
        <td className="ac">{x.act}</td></tr>)}
    </tbody></table>
  </section>;
}

// the status line, one a book: "Ledgers from Tally: 1,248 · last updated 2 min ago · 3 need you"
function Status({ b, needN }) {
  const cid = b.cid, co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co);
  const cloud = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid), st = Ledgers.status(cid), cur = Ledgers.cur(cid) || {};
  const books = cloud ? [].concat((TCloud.st[cid] || {}).books || []).filter((x) => x && x.book) : [];
  const fy = (x) => /^\d{4}/.test(String(x.from || "")) ? String(x.from).slice(0, 4) + "-" + String(Number(String(x.from).slice(0, 4)) + 1).slice(2) : "";
  const nInfo = Object.keys(b.ledInfo || {}).length;
  let lines = books.map((x) => ({ k: x.book, label: books.length > 1 ? [x.company, fy(x)].filter(Boolean).join(" ") + ": " : "", n: (cur.book === x.book && st.n) || x.ledgers || st.n, at: x.ledgersAt || cur.srcAt || st.at }));
  if (!lines.length && st.n) lines = [{ k: "list", label: "", n: st.n, at: Ledgers.listAt(cid) || st.at }];
  if (!lines.length && nInfo) lines = [{ k: "file", label: "", n: nInfo, at: b.ledInfoAt, file: true }];
  const need = needN ? <b className="led-need-n">{" · " + plural(needN, "needs you", "need you")}</b> : <span className="ok">{" · nothing needs you"}</span>;
  const again = live ? <button className="btn small" data-led-read="bridge" onClick={() => doAct("ledRead")}>Read again now</button>
    : cloud ? <button className="btn small" data-led-read="cloud" disabled={st.busy} onClick={() => Ledgers.refresh(cid)}>{st.busy ? "Reading…" : "Read again now"}</button> : null;
  return <div className="led-status" data-led-status="">
    {lines.length ? lines.map((x, i) => <div key={x.k} className="led-status-line" data-led-status-line={x.k}>
      {x.label}{"Ledgers from Tally: "}<b>{Number(x.n || 0).toLocaleString("en-IN")}</b>{x.at ? " · last updated " + LedPage.ago(x.at) : ""}{x.file ? " (from the ledger masters file)" : ""}{i === 0 && need}
    </div>) : <div className="led-status-line" data-led-status-line="none">No ledgers from Tally yet{need}</div>}
    {again}
    {!live && !cloud && <div className="led-upload" data-led-upload="">
      <span className="note">No FinCom Bridge is connected for this client, so the ledgers do not come by themselves. In Tally: <b>Display → List of Accounts</b>, export it as XML (<b>Alt+E</b>), then upload the file here.</span>
      <button className="btn small primary" data-led-upload-btn="" onClick={() => doAct("mastersPick")}>Upload the ledger masters (XML)</button></div>}
  </div>;
}

// a section with its one bulk action: "Confirm all 12" (only the rows shown)
function Section({ b, id, title, note, rows, Table, empty }) {
  const open = rows.filter((r) => !r.ok);
  return <section className="led-sec" data-led-section={id}>
    <div className="led-sec-head"><h3>{title} <span className="sbar-n">{open.length}</span></h3>
      {open.length > 1 && <button className="btn small" data-led-confirm-all={id} onClick={() => { const k = LedPage.confirm(b, open.map((r) => r.n)); toast(plural(k, "ledger", "ledgers") + " confirmed."); }}>{"Confirm all " + open.length}</button>}</div>
    {note && <p className="note">{note}</p>}
    {rows.length ? <Table b={b} rows={rows} /> : <p className="note" data-led-empty={id}>{empty}</p>}
  </section>;
}

// Other ledgers (under More): add one FinCom missed to GST or TDS by choosing what it is
function Other({ b, rows }) {
  const info = b.ledInfo || {};
  return <><ListRows name="lmTable" id="lmTable" unit={["ledger", "ledgers"]} of={rows.length} empty="Nothing here."
    head={[{ label: "Tally ledger", role: "party" }, { label: "What it is" }, { label: "Head, side, registration, rate or section" }, { label: "Used", cls: "n", sum: true, fmt: String }]}>
    {rows.slice(0, 400).map(([n, m], i) => <tr key={n + ":" + i} data-key={n}>
      <td>{n}{(info[n] || {}).group && <div className="nr">{info[n].group}</div>}{Ledgers.renamedOf(b.cid, n) && <div className="nr">Renamed in Tally: see Needs you above</div>}</td>
      <td><WhatSel n={n} m={m} other /></td><td><Detail n={n} m={m} regs={(GSTR.gstins(b) || []).map((g) => g.slice(0, 2))} /></td><td className="n">{m.n || 0}</td></tr>)}
  </ListRows>
    {rows.length > 400 && <p className="note">The first 400 are shown; find the rest by name.</p>}
    <p className="note">Several ledgers for one head are fine — reverse-charge ledgers, or one ledger per rate. To take a ledger out, choose “Not a tax ledger”.</p></>;
}

// the ledgers FinCom posts bills to, from the confirmed ledgers (under More)
function Posting({ b }) {
  const rows = LedMaster.posting(b, CO()), diff = rows.filter((x) => x.from && x.from !== x.now);
  return <section className="dash-card"><h3>What FinCom posts bills to</h3>
    <p className="note">When FinCom posts a bill into Tally, these are the ledgers it uses. They come from the ledgers confirmed here; an empty one is filled in as soon as its ledger is confirmed, and one set by hand in Client setup is kept until you choose the master’s.</p>
    {diff.length > 0 && <div className="row" style={{ margin: "8px 0" }}><button className="btn small primary" onClick={() => doAct("lmPostAll")}>Use the master’s for all {diff.length}</button></div>}
    <div className="bk-tablewrap"><table className="bk-table" data-statement=""><thead><tr><th>Used for</th><th>Now</th><th>From the master</th><th>Why</th><th className="ac"></th></tr></thead>
      <tbody>{rows.map((x, i) => <tr key={x.k + ":" + i} data-key={x.k}>
        <td>{x.label}</td>
        <td>{x.now ? <>{x.now}{!((b.ledInfo || {})[x.now] || (b.map || {})[x.now]) && <> <span className="tag warn">not in Tally</span></>}</> : <span className="note">—</span>}</td>
        <td>{x.from ? (x.from === x.now ? <span style={{ color: "var(--ok)" }}>✓ same</span> : <b>{x.from}</b>) : <span className="note">none confirmed</span>}</td>
        <td><NR>{x.why}</NR></td>
        <td className="ac">{x.from && x.from !== x.now && <button className="btn small" onClick={() => lmPost(x.k)}>Use it</button>}</td>
      </tr>)}</tbody></table></div>
  </section>;
}

// More: the rest of the page, moved here and not removed
function More({ b, other, sureN }) {
  const view = ["other", "post", "ai"].includes(S.lmView) ? S.lmView : "", open = !!S.ledMore || !!view;
  const ai = AIH.enabled("tds") || AIH.enabled("audit");
  const tabs = [["other", "Other ledgers", other.length], ["post", "What FinCom posts to", null]].concat(ai ? [["ai", "AI: TDS and credit", null]] : []);
  return <section className="led-more" data-led-more="">
    <button className="linkbtn" data-more-toggle="ledpage" aria-expanded={open ? "true" : "false"} onClick={() => { S.ledMore = !open; if (open) S.lmView = ""; render(); }}>{open ? "Less" : "More: other ledgers, what FinCom posts bills to" + (ai ? ", AI" : "") + ", check again"}</button>
    {open && <div style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button className="btn small" data-led-check-again="" onClick={() => doAct("lcRun")}>Check again</button>
        {sureN > 0 && <button className="btn small" data-led-confirm-sure="" title="The check's answer replaces the one on the row; from then on only confirmed ledgers count in the returns" onClick={() => doAct("lcConfirm")}>{"Confirm the check’s " + sureN + " sure answers"}</button>}
        <span className="note">{b.ledCheck && b.ledCheck.ranAt ? "Checked " + fmtDateTime(b.ledCheck.ranAt) + ". " : ""}Each ledger is read from Tally’s master (tax type, duty head, rate, nature of payment), how the day book uses it, and AI only for what is still unclear.</span>
      </div>
      <nav className="sbar" aria-label="Ledgers">{tabs.map(([id, l, c]) => <button key={id} aria-selected={view === id} onClick={() => lmViewGo(view === id ? "" : id)}>{l}{c != null && <>{" "}<span className="sbar-n">{c}</span></>}</button>)}</nav>
      {view === "post" ? <Posting b={b} /> : view === "ai" ? <AiLedgers b={b} /> : view === "other" ? <Other b={b} rows={other} /> : <p className="note">Pick one above.</p>}
    </div>}
  </section>;
}

// named LedgersTab, not Ledgers: the global Ledgers (src/js/58, the client's ledger list) is used in this module
export default function LedgersTab({ b }) {
  const cid = b.cid, info = b.ledInfo || {}, q = String(S.ledQ || "").toLowerCase().trim();
  const all = LedPage.rows(b);
  const hit = (r) => !q || r.n.toLowerCase().includes(q) || String(r.p.section || "").toLowerCase().includes(q) || String(r.group || "").toLowerCase().includes(q);
  const shown = all.filter(hit), showDone = !!S.ledShowDone || !!S.lcAll || S.lmView === "done";
  const open = shown.filter((r) => !r.ok), done = all.filter((r) => r.ok), doneShown = shown.filter((r) => r.ok);
  // the row being changed stays where it is shown until Done, also once its change has confirmed it
  const sure = (r) => !r.unclear;
  const gst = open.filter((r) => sure(r) && r.kind === "gst").concat(doneShown.filter((r) => r.kind === "gst" && (showDone || r.n === S.ledEdit)));
  const tds = open.filter((r) => sure(r) && r.kind === "tds").concat(doneShown.filter((r) => r.kind === "tds" && (showDone || r.n === S.ledEdit)));
  const notTax = open.filter((r) => sure(r) && r.kind === "none").concat(doneShown.filter((r) => r.kind === "none" && (showDone || r.n === S.ledEdit)));
  // Needs you: one sentence and one action each
  const items = [];
  open.filter((r) => r.unclear).forEach((r) => items.push(Object.assign({}, r, { key: "led:" + r.n, kind: "unclear",
    text: r.unclear + (r.p.what ? " (FinCom’s guess: " + LedPage.says(r.p) + ")" : "") + ".",
    more: S.ledEdit === r.n ? <Editor b={b} r={r} /> : <Evidence r={r} />,
    act: S.ledEdit === r.n ? null : <button className="btn small" data-led-change={r.n} onClick={() => { S.ledEdit = r.n; render(); }}>Choose what it is</button> })));
  Ledgers.renamed(cid).forEach((l) => items.push({ key: "rn:" + l.name, n: l.name, kind: "renamed", text: <RenameLine cid={cid} name={l.name} />, act: null }));
  const co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co), cloud = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid);
  const readAct = (k) => live ? <button className="btn small" data-led-read-need={k} onClick={() => doAct("ledRead")}>Read the ledgers again</button>
    : cloud ? <button className="btn small" data-led-read-need={k} onClick={() => Ledgers.refresh(cid)}>Read the ledgers again</button>
    : <button className="btn small" data-led-read-need={k} onClick={() => doAct("mastersPick")}>Upload the ledger masters</button>;
  LedPage.unknown(cid).forEach((x) => items.push({ key: x.key, n: x.n, kind: "unknown", text: x.text, act: readAct("unknown") }));
  if (typeof Rec === "object" && Rec.flow) Rec.flow().needs.filter((g) => g.cid === cid && g.kind === "masters").forEach((g) => items.push({ key: "rec:" + g.key, kind: "masters", text: g.text, act: <NeedAction g={g} canApply={Rec.canWrite()} /> }));
  LedCheck.diff(b).changed.forEach((x) => items.push({ key: "use:" + x.n, n: x.n, kind: "used", text: "Used differently since it was confirmed (" + x.was + " → " + x.now + "): " + x.say + ".",
    act: <button className="btn small" data-led-keep={x.n} onClick={() => LedPage.keepUse(b, x.n)}>Keep as confirmed</button> }));
  const ch = LedMaster.changesSince(b);
  if (ch.length) items.push({ key: "changed", kind: "changed", text: plural(ch.length, "ledger was", "ledgers were") + " changed after returns were made from them (" + (() => { const rs = [...new Set(ch.flatMap((x) => x.returns))]; return rs.slice(0, 3).join("; ") + (rs.length > 3 ? " and " + (rs.length - 3) + " more" : ""); })() + "). Check whether those returns need a revision or an amendment.",
    more: <details><summary className="note">Which ledgers</summary><ListRows name="ledChanged" unit={["ledger", "ledgers"]} head={[{ label: "Ledger", role: "party" }, { label: "What changed", role: "status" }, { label: "Returns made before the change" }]}>
      {ch.slice(0, 30).map((x, i) => <tr key={x.name + ":" + i}><td>{x.name}</td><td>{x.change}</td><td>{x.returns.slice(0, 4).join("; ") + (x.returns.length > 4 ? " and " + (x.returns.length - 4) + " more" : "")}</td></tr>)}</ListRows></details>,
    act: <button className="btn small" data-led-open-gst="" onClick={() => booksTabGo("gst")}>Open GST returns</button> });
  LedPage.conflicts(b, cid).forEach((x) => items.push({ key: x.key, kind: x.kind, text: x.text, act: <button className="btn small" data-led-fine={x.key} onClick={() => LedPage.fine(b, x.key)}>Fine as it is</button> }));
  const unclearN = items.filter((x) => x.kind === "unclear" && !(x.it && x.it.ai)).length;
  const aiBtn = unclearN > 0 && AIH.enabled("tds") ? <button className="btn small" data-led-ai="" onClick={() => doAct("lcAi")}>{"Ask AI about the " + unclearN + " unclear"}</button> : null;
  // the other ledgers (under More): those of the master that are not tax-like
  const other = Object.entries(b.map || {}).filter(([n, m]) => !LedMaster.taxLike(n, m, info[n]) && !(all.find((r) => r.n === n)))
    .filter(([n]) => !q || n.toLowerCase().includes(q) || String((info[n] || {}).group || "").toLowerCase().includes(q)).sort((a, c) => (c[1].n || 0) - (a[1].n || 0) || a[0].localeCompare(c[0]));
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((x, y) => x.name.localeCompare(y.name));
  // the check's own answers it is sure of (high confidence, not AI's): "Confirm the ticked" of the check, under More
  const sureN = all.filter((r) => !r.ok && r.it && LedCheck.ticked(r.it)).length;
  return <Confirm id="books:ledgers" label="Tally ledgers" stores={["books:map"]}><div className="ledpage" data-ledpage="">
    <Status b={b} needN={items.length} />
    <div className="led-tools">
      <input type="search" aria-label="Find a ledger" data-fk="ledq" value={S.ledQ || ""} placeholder="Find a ledger, section or group" onChange={(ev) => setAndShow("ledQ", ev.target.value, true)} />
      {cos.length > 1 && <select aria-label="Client" data-led-client="" style={{ width: "auto", maxWidth: "100%" }} value={cid} onChange={(ev) => { if (ev.target.value !== cid) Rec.openClientTab(ev.target.value, "books:ledgers"); }}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    </div>
    <Needs b={b} items={items} />
    {aiBtn && <div className="row" style={{ margin: "-4px 0 10px" }}>{aiBtn}</div>}
    <Section b={b} id="gst" title="GST ledgers" rows={gst} Table={GstTable} empty={q ? "No GST ledger matches." : "No GST ledger to confirm."} />
    <Section b={b} id="tds" title="TDS ledgers" rows={tds} Table={TdsTable} empty={q ? "No TDS ledger matches." : "No TDS ledger to confirm."} />
    {notTax.length > 0 && <details className="led-nottax" data-led-nottax="" open={showDone || !!q}><summary className="note">{plural(notTax.filter((r) => !r.ok).length, "ledger", "ledgers") + " with GST or TDS in the name " + (notTax.filter((r) => !r.ok).length === 1 ? "is" : "are") + " not tax ledgers — show"}</summary>
      <GstTable b={b} rows={notTax} /></details>}
    <p className="led-done" data-led-done-line="">{plural(done.length, "ledger", "ledgers") + " confirmed"}{(done.length > 0 || showDone) && <>{" — "}<button className="linkbtn" data-led-show-done="" onClick={() => { S.ledShowDone = !showDone; S.lcAll = false; if (S.lmView === "done") S.lmView = ""; render(); }}>{showDone ? "hide" : "show"}</button></>}
      <span className="note">{" · Returns count only confirmed ledgers; the TDS and GST files wait until every one is confirmed."}</span></p>
    <More b={b} other={other} sureN={sureN} />
  </div></Confirm>;
}
