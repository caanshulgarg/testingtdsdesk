// The "Tally ledgers" tab of a client's books: each GST and TDS ledger's meaning (guessed from Tally and the day book),
// confirmed once for the client, and the ledgers FinCom posts bills to. Was viewBooksLedgers, viewLedPosting and
// ledChangedBanner (src/js/18). The guesses are LedMaster (src/js/05); changes go through lmSet, lmConfirmToggle,
// lmViewGo, lmPost (src/js/23) and the doAct cases ledRead, lmConfirmShown, lmPostAll.
//
// State: S.lmView (which list), S.ledQ (the find box).
import { AiLedgers } from "../../parts/Ai.jsx";
import CommitBox from "../../parts/CommitBox.jsx";

const NR = ({ children, bad }) => <div className={"nr" + (bad ? " bad" : "")} style={{ whiteSpace: "normal" }}>{children}</div>;

// ledgers changed after returns were made from them: those returns may need a revision
function Changed({ b }) {
  const ch = LedMaster.changesSince(b);
  if (!ch.length) return null;
  return <section className="bk-alert" style={{ marginBottom: 12 }}><b>{ch.length + " ledger" + (ch.length === 1 ? " was" : "s were") + " changed after returns were made from them."}</b> Check whether those returns need a revision or an amendment.
    <div className="bk-tablewrap" style={{ marginTop: 6 }}><table className="bk-table"><thead><tr><th>Ledger</th><th>What changed</th><th>Returns made before the change</th></tr></thead>
      <tbody>{ch.slice(0, 30).map((x, i) => <tr key={x.name + ":" + i}><td>{x.name}</td><td>{x.change}</td><td>{x.returns.slice(0, 4).join("; ") + (x.returns.length > 4 ? " and " + (x.returns.length - 4) + " more" : "")}</td></tr>)}</tbody></table></div>
  </section>;
}

// what the ledger is: a GST head, a TDS or TCS ledger, or something else
function WhatSel({ n, m, other }) {
  const opts = (f) => LedMaster.WHAT.filter(f).map((w) => <option key={w[0]} value={w[0]}>{w[1]}</option>);
  const value = other ? (["bank", "roundoff", "none"].includes(m.what) ? "" : m.what || "") : m.what || "none";
  return <select aria-label={"What " + n + " is"} style={{ width: "auto", minWidth: 180 }} value={value} onChange={(ev) => lmSet(n, "what", ev.target.value)}>
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
  if (LedMaster.isGst(m.what) && !/^gst_(setoff|interest|control)$/.test(m.what)) return <span style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
    <select aria-label={"Head of " + n} style={{ width: "auto" }} value={m.tax || "IGST"} onChange={(ev) => lmSet(n, "tax", ev.target.value)}>{["IGST", "CGST", "SGST", "CESS"].map((x) => <option key={x}>{x}</option>)}</select>
    <select aria-label={"Side of " + n} style={{ width: "auto" }} value={m.side || "input"} onChange={(ev) => lmSet(n, "side", ev.target.value)}><option value="input">input</option><option value="output">output</option></select>
    {regs.length > 1 && <Reg />}
    <select aria-label={"Rate of " + n} style={{ width: "auto" }} title="Only if this ledger is for one rate" value={LedMaster.RATES.includes(num(m.gstRate)) && m.gstRate != null && m.gstRate !== "" ? String(num(m.gstRate)) : ""} onChange={(ev) => lmSet(n, "gstRate", ev.target.value)}>
      <option value="">any rate</option>{LedMaster.RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}</select>
  </span>;
  if (LedMaster.isGst(m.what) && regs.length > 1) return <Reg />;
  if (m.what === "tds_payable" || m.what === "tcs_payable") return <span style={{ display: "flex", gap: 4 }}>
    <CommitBox aria-label={"Section of " + n} data-fk={"lmsec-" + n} value={m.section || ""} placeholder={m.what === "tcs_payable" ? "206C(1H)" : "194C"} style={{ width: 90 }} onCommit={(v) => lmSet(n, "section", v)} />
    <CommitBox type="number" step="0.01" min="0" aria-label={"TDS rate of " + n} value={m.rate == null ? "" : m.rate} placeholder="rate %" style={{ width: 80 }} onCommit={(v) => lmSet(n, "rate", v)} />
  </span>;
  return null;
}

function List({ b, view, shown }) {
  const regs = (GSTR.gstins(b) || []).map((g) => g.slice(0, 2)), info = b.ledInfo || {};
  return <div className="bk-tablewrap"><table className="bk-table" id="lmTable">
    <thead><tr><th>Tally ledger</th><th>What it is</th><th>Head, side, registration, rate or section</th><th className="n">Used</th><th>Why, and checks</th><th className="ac">Confirmed</th></tr></thead>
    <tbody>{shown.slice(0, 400).map(([n, m], i) => {
      const warn = LedMaster.checks(b, n, m), inf = info[n] || {};
      const tallyType = inf.taxType && !/^(others|not applicable)$/i.test(String(inf.taxType).replace(/[^A-Za-z ]/g, "").trim());
      return <tr key={n + ":" + i} data-key={n}>
        <td>{n}{inf.group && <div className="nr">{inf.group + (tallyType ? " · Tally: " + inf.taxType + (inf.dutyHead ? " " + inf.dutyHead : "") : "")}</div>}</td>
        <td><WhatSel n={n} m={m} other={view === "other"} /></td><td><Detail n={n} m={m} regs={regs} /></td><td className="n">{m.n || 0}</td>
        <td style={{ minWidth: 200 }}>{m.why && <NR>{m.why}</NR>}{warn.map((w, j) => <NR key={j} bad>{w}</NR>)}</td>
        <td className="ac">{view === "other" ? null : m.ok ? <button className="linkbtn" title="Undo" onClick={() => lmConfirmToggle(n)}>✓ confirmed</button> : <button className="btn small" onClick={() => lmConfirmToggle(n)}>Confirm</button>}</td>
      </tr>; })}</tbody>
  </table>
    {shown.length > 400 && <p className="note">The first 400 are shown; find the rest by name.</p>}
    {!shown.length && <div className="bk-none">{view === "pending" ? "Every GST and TDS ledger is confirmed." : "Nothing here."}</div>}
  </div>;
}

// the ledgers FinCom posts bills to, from the confirmed ledgers
function Posting({ b }) {
  const rows = LedMaster.posting(b, CO()), diff = rows.filter((x) => x.from && x.from !== x.now);
  return <section className="dash-card"><h3>What FinCom posts bills to</h3>
    <p className="note">When FinCom posts a bill into Tally, these are the ledgers it uses. They come from the ledgers confirmed here; an empty one is filled in as soon as its ledger is confirmed, and one set by hand in Client setup is kept until you choose the master’s.</p>
    {diff.length > 0 && <div className="row" style={{ margin: "8px 0" }}><button className="btn small primary" onClick={() => doAct("lmPostAll")}>Use the master’s for all {diff.length}</button></div>}
    <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>Used for</th><th>Now</th><th>From the master</th><th>Why</th><th className="ac"></th></tr></thead>
      <tbody>{rows.map((x, i) => <tr key={x.k + ":" + i} data-key={x.k}>
        <td>{x.label}</td>
        <td>{x.now ? <>{x.now}{!((b.ledInfo || {})[x.now] || (b.map || {})[x.now]) && <> <span className="tag warn">not in Tally</span></>}</> : <span className="note">—</span>}</td>
        <td>{x.from ? (x.from === x.now ? <span style={{ color: "#1F7A4D" }}>✓ same</span> : <b>{x.from}</b>) : <span className="note">none confirmed</span>}</td>
        <td><NR>{x.why}</NR></td>
        <td className="ac">{x.from && x.from !== x.now && <button className="btn small" onClick={() => lmPost(x.k)}>Use it</button>}</td>
      </tr>)}</tbody></table></div>
  </section>;
}

export default function Ledgers({ b }) {
  const info = b.ledInfo || {}, all = Object.entries(b.map || {});
  const isTax = ([n, m]) => LedMaster.taxLike(n, m, info[n]);
  const gst = all.filter(([n, m]) => LedMaster.isGst(m.what) && isTax([n, m])), tds = all.filter(([n, m]) => LedMaster.isTds(m.what) && isTax([n, m]));
  const pend = LedMaster.pending(b), other = all.filter((x) => !isTax(x));
  const view = S.lmView || (pend.length ? "pending" : "gst"), q = String(S.ledQ || "").toLowerCase();
  const pool = { pending: pend, gst, tds, done: all.filter(([n, m]) => m.ok && isTax([n, m])), other }[view] || pend;
  const shown = pool.filter(([n, m]) => !q || n.toLowerCase().includes(q) || String(m.section || "").toLowerCase().includes(q) || String((info[n] || {}).group || "").toLowerCase().includes(q))
    .sort((a, c) => (LedMaster.isGst(a[1].what) ? 0 : 1) - (LedMaster.isGst(c[1].what) ? 0 : 1) || (c[1].n || 0) - (a[1].n || 0) || a[0].localeCompare(c[0]));
  const fromTally = Object.keys(info).length, live = typeof bridgeLive === "function" && bridgeLive(CO());
  const Tile = ({ id, label, n, small, warn }) => <button className={"dtile" + (warn ? " warn" : "")} style={{ textAlign: "left" }} onClick={() => lmViewGo(id)}><span>{label}</span><b>{n}</b><small>{small}</small></button>;
  const tabs = [["pending", "To confirm", pend.length], ["gst", "GST", gst.length], ["tds", "TDS and TCS", tds.length], ["done", "Confirmed", null], ["other", "Other ledgers", other.length], ["post", "What FinCom posts to", null]]
    .concat(AIH.enabled("tds") || AIH.enabled("audit") ? [["ai", "AI: TDS and credit", null]] : []);
  const unconfirmed = shown.filter(([, m]) => !m.ok).length;
  return <>
    <Changed b={b} />
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>GST and TDS ledgers: confirm once for this client</h3>
      <p className="note">Each ledger is guessed from Tally — its tax type, duty head and group — and from how the day book uses it. Check the guess and confirm it. Returns count only confirmed ledgers; anything still to confirm is shown on the TDS and GST screens, and their files wait until it is done.</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className={"btn small" + (live ? " primary" : "")} title={live ? undefined : "Needs the Tally Bridge and this company open in Tally"} onClick={() => doAct("ledRead")}>Read ledgers from Tally</button>
        <span className="note">{fromTally ? fromTally + " ledgers read from Tally" + (b.ledInfoAt ? " on " + fmtDate(String(b.ledInfoAt).slice(0, 10)) : "") : live ? "not read yet" : "Tally is not connected; the ledger masters XML under “From Tally” does the same"}</span>
      </div>
      <div className="dash-tiles" style={{ marginTop: 10 }}>
        <Tile id="pending" label="To confirm" n={pend.length} small={pend.length ? "returns wait for these" : "all done"} warn={pend.length > 0} />
        <Tile id="gst" label="GST ledgers" n={gst.length} small={gst.filter((x) => x[1].ok).length + " confirmed"} />
        <Tile id="tds" label="TDS and TCS ledgers" n={tds.length} small={tds.filter((x) => x[1].ok).length + " confirmed"} />
        <Tile id="other" label="Other ledgers" n={other.length} small="add one to GST or TDS" />
      </div>
    </section>
    <nav className="sbar" aria-label="Ledgers">{tabs.map(([id, l, c]) => <button key={id} aria-selected={view === id} onClick={() => lmViewGo(id)}>{l}{c != null && <>{" "}<span className="sbar-n">{c}</span></>}</button>)}</nav>
    {view === "post" ? <Posting b={b} /> : view === "ai" ? <AiLedgers b={b} /> : <>
      <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }}>
        <input type="search" aria-label="Find a ledger" data-fk="ledq" value={S.ledQ || ""} placeholder="Find a ledger, section or group" style={{ width: 260, flex: "0 0 auto" }} onChange={(ev) => setAndShow("ledQ", ev.target.value, true)} />
        <span className="note">{shown.length + " ledger" + (shown.length === 1 ? "" : "s")}</span>
        {view !== "other" && unconfirmed > 0 && <button className="btn small primary" onClick={() => doAct("lmConfirmShown")}>Confirm the {unconfirmed} shown</button>}
      </div>
      <List b={b} view={view} shown={shown} />
      <p className="note">Add a ledger that was missed from “Other ledgers” by choosing what it is. Several ledgers for one head are fine — reverse-charge ledgers, or one ledger per rate. To take a ledger out, choose “Not a tax ledger”.</p>
    </>}
  </>;
}
