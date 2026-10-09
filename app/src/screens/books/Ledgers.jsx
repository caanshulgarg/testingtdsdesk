// The "Tally ledgers" tab of a client's books: the GST and TDS ledgers from Tally, as one simple table (FinCom 2.4.1; the
// owner's decisions of 09-Oct-2026: "Yes, build it", "Confirm all" only where FinCom and its check agree, "Keep today's
// figures"). In plain words, for the owner:
//   1. one status line: "Ledgers from Tally: 1,248 · updated 2 min ago", with "Read again now" where it exists (the bridge
//      here: ledRead; FinCom's cloud copy: Ledgers.refresh), else one Upload button for the ledger masters (mastersPick);
//   2. "Please check" (only when there is something): a ledger confirmed one way that FinCom's check reads another way
//      (both answers and an example entry; "Keep mine" or "Use the check's"), a confirmed name-guess no entry uses yet,
//      a confirmed ledger now used differently, and the ledgers entries use that FinCom does not have yet;
//   3. the main table, one row a GST or TDS ledger: the Tally ledger, what FinCom reads it as (b.map, what the returns
//      read), how many entries use it, one example entry, and Confirm / Change, or "✓ Confirmed by …" with its own Undo;
//      "Confirm N ledgers that FinCom and its check agree on" (only those used in entries);
//   4. folded at the bottom: the other ledgers (not tax; Change marks one as tax), and "Other notices" (a GSTIN on two
//      ledgers, a PAN not in its GSTIN, a ledger renamed in Tally, ledgers changed after returns were made).
// Every action is its own step, saved at once (no Save at the foot, no drafts), with Undo. Nothing here is AI's.
// The rows are LedPage (src/js/57); a change goes through lmSet (src/js/23), LedPage.confirm / confirmAgree / keepMine /
// useCheck / undoRow / undoLast, and the doAct cases ledRead and mastersPick. Owner only: a rename's Confirm (as before);
// staff confirm and change ledgers (as before).
//
// State: S.ledQ (the find box), S.ledEdit (the row being changed), S.ledEditPrev (that row before the change, for Undo),
// S.ledUndo (the last step, for the Undo line).
import CommitBox from "../../parts/CommitBox.jsx";
import NeedAction from "../../parts/NeedAction.jsx";
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

// Change, 1: what the ledger is (a GST head, a TDS or TCS ledger, or something else)
function WhatSel({ n, m, pre }) {
  const opts = (f) => LedMaster.WHAT.filter(f).map((w) => <option key={w[0]} value={w[0]}>{w[1]}</option>);
  return <select aria-label={"What " + n + " is"} style={{ width: "auto", minWidth: 160, maxWidth: "100%" }} value={m.what || ""} onChange={(ev) => lmSet(n, "what", ev.target.value, pre)}>
    {!m.what && <option value="">choose…</option>}
    <optgroup label="GST">{opts((w) => LedMaster.isGst(w[0]))}</optgroup>
    <optgroup label="TDS and TCS">{opts((w) => LedMaster.isTds(w[0]) || w[0] === "tds_interest")}</optgroup>
    <optgroup label="Not tax">{opts((w) => ["bank", "roundoff", "none"].includes(w[0]))}</optgroup>
  </select>;
}

// Change, 2: the rest, when needed: head, side, registration and rate for GST; section and rate for TDS and TCS
function Detail({ n, m, regs, pre }) {
  const set = (k, v) => lmSet(n, k, v, pre);
  const Reg = () => <select aria-label={"Registration of " + n} style={{ width: "auto" }} value={m.reg || ""} onChange={(ev) => set("reg", ev.target.value)}>
    <option value="">registration?</option>{regs.map((r) => <option key={r} value={r}>{r}</option>)}</select>;
  if (LedMaster.isGst(m.what) && !/^gst_(setoff|interest|control)$/.test(m.what)) return <span className="led-sels">
    <select aria-label={"Head of " + n} style={{ width: "auto" }} value={m.tax || "IGST"} onChange={(ev) => set("tax", ev.target.value)}>{["IGST", "CGST", "SGST", "CESS"].map((x) => <option key={x}>{x}</option>)}</select>
    <select aria-label={"Side of " + n} style={{ width: "auto" }} value={m.side || "input"} onChange={(ev) => set("side", ev.target.value)}><option value="input">input</option><option value="output">output</option></select>
    {regs.length > 1 && <Reg />}
    <select aria-label={"Rate of " + n} style={{ width: "auto" }} title="Only if this ledger is for one rate" value={LedMaster.RATES.includes(num(m.gstRate)) && m.gstRate != null && m.gstRate !== "" ? String(num(m.gstRate)) : ""} onChange={(ev) => set("gstRate", ev.target.value)}>
      <option value="">any rate</option>{LedMaster.RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}</select>
  </span>;
  if (LedMaster.isGst(m.what) && regs.length > 1) return <Reg />;
  if (m.what === "tds_payable" || m.what === "tcs_payable") return <span className="led-sels">
    <CommitBox aria-label={"Section of " + n} data-fk={"lmsec-" + n} value={m.section || ""} placeholder={m.what === "tcs_payable" ? "206C(1H)" : "194C"} style={{ width: 90 }} onCommit={(v) => set("section", v)} />
    <CommitBox type="number" step="0.01" min="0" aria-label={"TDS rate of " + n} value={m.rate == null ? "" : m.rate} placeholder="rate %" style={{ width: 80 }} onCommit={(v) => set("rate", v)} />
  </span>;
  return null;
}

// Change: a small picker in the row; each choice is saved at once and confirmed by this person. A ledger with no answer
// starts from the check's suggestion, written only when something is chosen (lmSet's pre, in the same step)
function Editor({ b, n }) {
  const regs = (GSTR.gstins(b) || []).map((g) => g.slice(0, 2)), mm = (b.map || {})[n] || { n: 0 }, s = LedPage.checkOf(b, n);
  const fromCheck = !mm.byHand && !mm.what && !!(s && s.what);
  const pre = fromCheck ? (m) => { LedMaster.applyWhat(m, s.what); if (LedMaster.isGst(s.what)) { m.tax = s.tax || m.tax; m.side = s.side || m.side; if (s.rate) m.gstRate = s.rate; } if (LedMaster.isTds(s.what)) m.section = s.section || m.section; return m; } : null;
  const m = fromCheck ? pre(Object.assign({}, mm)) : mm;
  return <div className="led-edit" data-led-editor={n}>
    <WhatSel n={n} m={m} pre={pre} /><Detail n={n} m={m} regs={regs} pre={pre} />
    {m.what && LedMaster.checks(b, n, m).map((w, j) => <div key={j} className="nr bad" style={{ whiteSpace: "normal" }}>{w}</div>)}
    <button className="btn small" data-led-done="" onClick={() => { S.ledEdit = ""; S.ledEditPrev = null; render(); }}>Done</button>
  </div>;
}
function openEditor(b, n) { S.ledEdit = n; S.ledEditPrev = { cid: b.cid, n, m: (b.map || {})[n] ? LedPage.bare(b.map[n]) : null }; render(); }
// the owner of 09-Oct-2026: "if I want to edit the confirm ledger, then I should be able to do that". A confirmed ledger
// keeps its Change; as changing one used in entries moves the returns, it asks once (not when no entry uses it). The
// answer before stays on the ledger (prev), so its Undo puts it back
function changeRow(b, r) {
  const n = r.used || 0;
  if (!r.ok || !n) { openEditor(b, r.n); return; }
  askConfirm({ title: "Change a confirmed ledger?", ok: "Change it", body: esc("This ledger is used in " + plural(n, "entry", "entries") + "; your " + (LedMaster.isTds((r.m || {}).what) ? "TDS" : "GST") + " figures will change. Change it?") })
    .then((yes) => { if (yes) openEditor(b, r.n); });
}

// a row's actions: Confirm and Change; a confirmed row says who and when (as the posting page's ChoiceTag), with a
// separate small Undo (✓ itself is not a button)
function RowAct({ b, r }) {
  if (S.ledEdit === r.n) return null;
  const change = <button className="linkbtn" data-led-change={r.n} onClick={() => changeRow(b, r)}>Change</button>;
  if (r.ok) {
    const m = r.m || {};
    return <span className="led-act led-act-ok">
      <span className="cfm-ok" data-led-okby="" data-choice-state="confirmed">{"✓ Confirmed" + (m.okBy ? " by " + m.okBy : "") + (m.okAt ? ", " + fmtDateTime(m.okAt) : "")}</span>
      <button className="linkbtn" data-led-undo={r.n} title="Put this ledger back as it was before" onClick={() => LedPage.undoRow(b, r.n)}>Undo</button>{change}</span>;
  }
  return <span className="led-act">
    {r.has && r.m.what ? <button className="btn small" data-led-confirm={r.n} onClick={() => LedPage.confirm(b, [r.n], "row")}>Confirm</button> : null}{change}</span>;
}
const Example = ({ x }) => x ? <span data-led-example="">{LedPage.exampleSay(x)}</span> : <span className="note" data-led-example-none="">—</span>;

// the main table: one row a GST or TDS ledger
function MainTable({ b, rows }) {
  return <table className="led-t nocards" data-led-table="main"><thead><tr><th>Ledger in your Tally</th><th>FinCom reads it as</th><th className="n">Used in (entries)</th><th>Example entry</th><th className="ac"></th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.n} data-key={r.n} data-ok={r.ok ? "1" : "0"}>
      <td><b className="led-name">{r.n}</b>{r.group && <div className="nr">{r.group}</div>}</td>
      <td>{S.ledEdit === r.n ? <Editor b={b} n={r.n} /> : <span className={"led-says" + (r.m && r.m.what ? "" : " led-unknown")}>{r.says}</span>}</td>
      <td className="n" data-led-used="">{r.used ? Number(r.used).toLocaleString("en-IN") : <span className="note">not used yet</span>}</td>
      <td className="led-ex"><Example x={r.ex} /></td>
      <td className="ac"><RowAct b={b} r={r} /></td></tr>)}</tbody></table>;
}

// Please check: a confirmed answer the check reads otherwise, and what else a person should look at once
function PleaseCheck({ b, items, lines }) {
  if (!items.length && !lines.length) return null;
  return <section className="led-needs" data-led-check="" role="status">
    <h3>Please check <span className="sbar-n">{items.length + lines.length}</span></h3>
    <table className="led-t nocards"><tbody>
      {items.map((x) => <tr key={x.n} data-led-review={x.n} data-kind={x.kind}>
        <td><b className="led-name">{x.n}</b>
          <div>{"You confirmed: "}<b>{x.mine}</b>{x.m.okBy ? <span className="note">{" (" + x.m.okBy + (x.m.okAt ? ", " + fmtDate(String(x.m.okAt).slice(0, 10)) : "") + ")"}</span> : null}</div>
          {x.kind === "differs" ? <div>{"FinCom’s check reads: "}<b>{x.checkSays}</b></div>
            : <div className="note">{"No entry uses it yet. Once one does, it counts in the returns as " + x.mine + "." + (x.checkSays && x.checkSays !== x.mine ? " FinCom’s check reads: " + x.checkSays + "." : "")}</div>}
          {x.ex && <div className="note">{"For example: "}<Example x={x.ex} /></div>}</td>
        <td className="ac"><span className="led-act">
          <button className="btn small" data-led-keep-mine={x.n} onClick={() => LedPage.keepMine(b, x.n)}>Keep mine</button>
          {x.check && x.checkSays !== x.mine && <button className="btn small" data-led-use-check={x.n} onClick={() => LedPage.useCheck(b, x.n)}>Use the check’s</button>}</span></td></tr>)}
      {lines.map((x) => <tr key={x.key} data-led-line={x.kind} data-key={x.n || x.key}><td>{x.text}</td><td className="ac">{x.act}</td></tr>)}
    </tbody></table>
  </section>;
}

// the status line: "Ledgers from Tally: 1,248 · updated 2 min ago", Read again now
function Status({ b }) {
  const cid = b.cid, co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co);
  const cloud = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid), st = Ledgers.status(cid), cur = Ledgers.cur(cid) || {};
  const books = cloud ? [].concat((TCloud.st[cid] || {}).books || []).filter((x) => x && x.book) : [];
  const fy = (x) => /^\d{4}/.test(String(x.from || "")) ? String(x.from).slice(0, 4) + "-" + String(Number(String(x.from).slice(0, 4)) + 1).slice(2) : "";
  const nInfo = Object.keys(b.ledInfo || {}).length;
  let lines = books.map((x) => ({ k: x.book, label: books.length > 1 ? [x.company, fy(x)].filter(Boolean).join(" ") + ": " : "", n: (cur.book === x.book && st.n) || x.ledgers || st.n, at: x.ledgersAt || cur.srcAt || st.at }));
  if (!lines.length && st.n) lines = [{ k: "list", label: "", n: st.n, at: Ledgers.listAt(cid) || st.at }];
  if (!lines.length && nInfo) lines = [{ k: "file", label: "", n: nInfo, at: b.ledInfoAt, file: true }];
  const again = live ? <button className="btn small" data-led-read="bridge" onClick={() => doAct("ledRead")}>Read again now</button>
    : cloud ? <button className="btn small" data-led-read="cloud" disabled={st.busy} onClick={() => Ledgers.refresh(cid)}>{st.busy ? "Reading…" : "Read again now"}</button> : null;
  return <div className="led-status" data-led-status="">
    {lines.length ? lines.map((x) => <div key={x.k} className="led-status-line" data-led-status-line={x.k}>
      {x.label}{"Ledgers from Tally: "}<b>{Number(x.n || 0).toLocaleString("en-IN")}</b>{x.at ? " · updated " + LedPage.ago(x.at) : ""}{x.file ? " (from the ledger masters file)" : ""}
    </div>) : <div className="led-status-line" data-led-status-line="none">No ledgers from Tally yet</div>}
    {again}
    {!live && !cloud && <div className="led-upload" data-led-upload="">
      <span className="note">No FinCom Bridge is connected for this client, so the ledgers do not come by themselves. In Tally: <b>Display → List of Accounts</b>, export it as XML (<b>Alt+E</b>), then upload the file here.</span>
      <button className="btn small primary" data-led-upload-btn="" onClick={() => doAct("mastersPick")}>Upload the ledger masters (XML)</button></div>}
  </div>;
}

// the last step, with its Undo
function UndoLine({ b }) {
  const u = S.ledUndo;
  if (!u || u.cid !== b.cid) return null;
  return <div className="led-undo" data-led-undo-bar="" role="status"><span>{u.text + " Saved."}</span>
    <button className="linkbtn" data-led-undo-last="" onClick={() => LedPage.undoLast(b)}>Undo</button>
    <button className="linkbtn" aria-label="Close" onClick={() => { S.ledUndo = null; render(); }}>✕</button></div>;
}

// the other ledgers (not tax), folded: Change marks one as tax
function Others({ b, rows }) {
  const shown = rows.slice(0, 300);
  return <details className="led-fold" data-led-other="" open={!!S.ledQ || (!!S.ledEdit && rows.some((r) => r.n === S.ledEdit))}>
    <summary>{"Other ledgers (not tax) · " + rows.length}</summary>
    <p className="note">To count one as a GST or TDS ledger, choose Change.</p>
    <table className="led-t nocards" data-led-table="other"><thead><tr><th>Ledger in your Tally</th><th>FinCom reads it as</th><th className="n">Used in (entries)</th><th className="ac"></th></tr></thead>
      <tbody>{shown.map((r) => <tr key={r.n} data-key={r.n}>
        <td><span className="led-name">{r.n}</span>{r.group && <div className="nr">{r.group}</div>}</td>
        <td>{S.ledEdit === r.n ? <Editor b={b} n={r.n} /> : <span className="led-says">{r.m && r.m.what ? LedMaster.label(r.m.what) : "Not tax"}</span>}</td>
        <td className="n">{r.used ? Number(r.used).toLocaleString("en-IN") : ""}</td>
        <td className="ac">{S.ledEdit === r.n ? null : <button className="linkbtn" data-led-change={r.n} onClick={() => changeRow(b, r)}>Change</button>}</td></tr>)}</tbody></table>
    {rows.length > shown.length && <p className="note">{"The first " + shown.length + " are shown, the most used first; find the rest by name."}</p>}
  </details>;
}

// Other notices: moved here from the top of the page, never lost
function Notices({ b, cid }) {
  const items = [];
  Ledgers.renamed(cid).forEach((l) => items.push({ key: "rn:" + l.name, n: l.name, kind: "renamed", text: <RenameLine cid={cid} name={l.name} /> }));
  const ch = LedMaster.changesSince(b);
  if (ch.length) items.push({ key: "changed", kind: "changed", text: <>{plural(ch.length, "ledger was", "ledgers were") + " changed after returns were made from them (" + (() => { const rs = [...new Set(ch.flatMap((x) => x.returns))]; return rs.slice(0, 3).join("; ") + (rs.length > 3 ? " and " + (rs.length - 3) + " more" : ""); })() + "). Check whether those returns need a revision or an amendment: "}
    {ch.slice(0, 10).map((x) => x.name).join(", ") + (ch.length > 10 ? " and " + (ch.length - 10) + " more" : "") + "."}</>,
    act: <button className="btn small" data-led-open-gst="" onClick={() => booksTabGo("gst")}>Open GST returns</button> });
  LedPage.conflicts(b, cid).forEach((x) => items.push({ key: x.key, kind: x.kind, text: x.text, act: <button className="btn small" data-led-fine={x.key} onClick={() => LedPage.fine(b, x.key)}>Fine as it is</button> }));
  if (!items.length) return null;
  return <details className="led-fold" data-led-notices="">
    <summary>{"Other notices · " + items.length}</summary>
    <table className="led-t nocards"><tbody>{items.map((x) => <tr key={x.key} data-notice={x.kind} data-key={x.n || x.key}><td>{x.text}</td><td className="ac">{x.act || null}</td></tr>)}</tbody></table>
  </details>;
}

// named LedgersTab, not Ledgers: the global Ledgers (src/js/58, the client's ledger list) is used in this module
export default function LedgersTab({ b }) {
  const cid = b.cid, q = String(S.ledQ || "").toLowerCase().trim();
  const hit = (r) => !q || r.n.toLowerCase().includes(q) || String((r.m || {}).section || "").toLowerCase().includes(q) || String(r.group || "").toLowerCase().includes(q);
  const main = LedPage.main(b), rows = main.filter(hit), others = LedPage.others(b).filter(hit);
  const agree = LedPage.agreeing(b), review = LedPage.review(b);
  // Please check, the plain lines: entries naming a ledger FinCom does not have yet, ledger lines without a GUID (the
  // masters), a confirmed ledger now used differently
  const co = CO(), live = typeof bridgeLive === "function" && bridgeLive(co), cloud = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid);
  const readAct = (k) => live ? <button className="btn small" data-led-read-need={k} onClick={() => doAct("ledRead")}>Read the ledgers again</button>
    : cloud ? <button className="btn small" data-led-read-need={k} onClick={() => Ledgers.refresh(cid)}>Read the ledgers again</button>
    : <button className="btn small" data-led-read-need={k} onClick={() => doAct("mastersPick")}>Upload the ledger masters</button>;
  const lines = [];
  LedPage.unknown(cid).forEach((x) => lines.push({ key: x.key, kind: "unknown", text: x.text, act: readAct("unknown") }));
  if (typeof Rec === "object" && Rec.flow) Rec.flow().needs.filter((g) => g.cid === cid && g.kind === "masters").forEach((g) => lines.push({ key: "rec:" + g.key, kind: "masters", text: g.text, act: <NeedAction g={g} canApply={Rec.canWrite()} /> }));
  LedCheck.diff(b).changed.forEach((x) => lines.push({ key: "use:" + x.n, n: x.n, kind: "used", text: x.n + ": used differently since it was confirmed (" + x.say + ").",
    act: <button className="btn small" data-led-keep={x.n} onClick={() => LedPage.keepUse(b, x.n)}>Keep as confirmed</button> }));
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((x, y) => x.name.localeCompare(y.name));
  const okN = main.filter((r) => r.ok).length;
  return <div className="ledpage" data-ledpage="">
    <Status b={b} />
    <UndoLine b={b} />
    <PleaseCheck b={b} items={review} lines={lines} />
    <section className="led-sec" data-led-section="main">
      <div className="led-sec-head"><h3>{"GST and TDS ledgers "}<span className="sbar-n">{main.length}</span>{" "}<span className="note">{okN + " confirmed"}</span></h3>
        {agree.length > 0 && <button className="btn small primary" data-led-confirm-agree="" onClick={() => LedPage.confirmAgree(b)}>{"Confirm " + plural(agree.length, "ledger", "ledgers") + " that FinCom and its check agree on"}</button>}</div>
      <div className="led-tools">
        <input type="search" aria-label="Find a ledger" data-fk="ledq" value={S.ledQ || ""} placeholder="Find a ledger, section or group" onChange={(ev) => setAndShow("ledQ", ev.target.value, true)} />
        {cos.length > 1 && <select aria-label="Client" data-led-client="" style={{ width: "auto", maxWidth: "100%" }} value={cid} onChange={(ev) => { if (ev.target.value !== cid) Rec.openClientTab(ev.target.value, "books:ledgers"); }}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      {rows.length ? <MainTable b={b} rows={rows} /> : <p className="note" data-led-empty="main">{q ? "No GST or TDS ledger matches." : "No GST or TDS ledger yet."}</p>}
    </section>
    <Others b={b} rows={others} />
    <Notices b={b} cid={cid} />
  </div>;
}
