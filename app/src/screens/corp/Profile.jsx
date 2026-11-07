// Corporate › Company profile (the design "1 · Client › Corporate: know the company"): the company's header with its
// capital and AGM, the directors and KMP, the shareholding, the charges, the company record, and its compliance health
// worked out from them. Every part is edited in place (Edit on its card) and kept with store.js (corp_profiles).
// "Refresh from MCA master data" of the design is "Paste master data" in phase 1: FinCom cannot read the MCA portal.
import { useState } from "react";
import Button from "../../parts/Button.jsx";
import { Card, Pick, Text, Tick } from "./parts.jsx";
import { canEdit, corpOf, saveProfile, uid } from "./store.js";
import { CLASSES, DESIGNATIONS, STATUSES, cinInfo, cinOk, count, isDirector, lastAgm, money, openCharges, prefill, sharesTotal, val } from "./profile.js";
import { agmLastDay, health, isSmall, nextBoard } from "./health.js";
import { kycFor } from "./rules.js";
import { dayOf } from "./master.js";
import { readMaster } from "./master.js";
import { dmy, fyNext, isDay, lastClosedFy, today } from "./dates.js";

const CLASS_WORDS = Object.fromEntries(CLASSES);
const fyOptions = (on) => { const f = lastClosedFy(on); return [fyNext(f, 1), f, fyNext(f, -1), fyNext(f, -2), fyNext(f, -3)]; };

// the profile as shown: its own values over FinCom's
export function shown(co) {
  const c = corpOf(co.id), p = c.profile || {}, pre = prefill(co), get = (k) => val(p, pre, k);
  const out = {};
  ["name", "cin", "pan", "tan", "gstin", "office", "auditor", "auditorFrn", "face", "authorised", "cls", "roc", "nic"].forEach((k) => { out[k] = get(k).v; });
  return Object.assign({}, p, out, { _pre: pre, _get: get, _own: p });
}

function Hero({ co, P, filings, onEdit, onPaste }) {
  const ci = cinInfo(P.cin), la = lastAgm(P), oc = openCharges(P);
  const filed = filings.filter((f) => f.form === "AOC-4" && f.status === "filed").map((f) => f.period).sort().pop() || P.lastFiledFy || "";
  return <section className="corp-card corp-hero" data-corp-hero="">
    <div className="corp-hero-top">
      <div>
        <div className="corp-chips">
          <span className="corp-chip" data-tone={!P.status || P.status === "Active" ? "ok" : "warn"}>{"● " + (P.status || "Active")}</span>
          {P.cls && <span className="corp-chip">{CLASS_WORDS[P.cls] || P.cls}</span>}
          {isSmall(P) && <span className="corp-chip">Small company</span>}{P.startup && P.cls === "private" && <span className="corp-chip">Start-up</span>}
          {ci && ci.listed && <span className="corp-chip">Listed</span>}
          {P.roc && <span className="corp-chip">{P.roc}</span>}
        </div>
        <h1 data-corp-name="">{P.name || co.name}</h1>
        <div className="corp-sub">{[P.cin ? "CIN " + P.cin : "CIN not entered", P.incorporated ? "Incorporated " + dmy(P.incorporated) : "", P.office].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="corp-row">
        {canEdit() && <Button className="btn" onClick={onPaste} data-corp-paste="">Paste MCA master data</Button>}
        {canEdit() && <Button className="btn" onClick={onEdit} data-corp-edit="details">Edit details</Button>}
        <Button className="btn primary" onClick={() => goClient("books:corp-forms")}>New e-Form</Button>
      </div>
    </div>
    <dl className="corp-kpis">
      <div><dt>Authorised capital</dt><dd data-kpi="authorised">{money(P.authorised) || "—"}</dd></div>
      <div><dt>Paid-up capital</dt><dd data-kpi="paidup">{money(P.paidUp) || "—"}</dd></div>
      <div><dt>Last AGM</dt><dd data-kpi="agm">{la ? dmy(la.date) : "—"}</dd></div>
      <div><dt>Last balance sheet filed</dt><dd data-kpi="filed">{filed ? "FY " + filed : "—"}</dd></div>
      <div><dt>Open charges</dt><dd data-kpi="charges">{oc.length ? oc.length + " · " + money(oc.reduce((s, c) => s + (+c.amount || 0), 0)) : "None"}</dd></div>
    </dl>
  </section>;
}

function Details({ co, P, done }) {
  const s = (k) => (v) => saveProfile(co.id, { [k]: v }), g = P._get;
  const ci = cinInfo(P.cin), on = today(), fy = lastClosedFy(on);
  const [agmFy, setAgmFy] = useState(fy);
  return <Card title="Company details" attr={["data-corp-details", ""]} aside={<Button className="btn small primary" onClick={done}>Done</Button>}>
    <div className="corp-grid">
      <Text label="Name (as with the ROC)" value={P.name} from={g("name").from} onSave={s("name")} wide />
      <Text label="CIN" value={P.cin} from={g("cin").from} upper onSave={(v) => { const x = cinInfo(v), patch = { cin: v };
        // what the CIN says fills what is still empty: the class, the ROC, the activity's NIC code
        if (x) { if (!P._own.cls && x.cls) patch.cls = x.cls; if (!P._own.roc && x.roc) patch.roc = x.roc; if (!P._own.nic) patch.nic = x.nic; }
        saveProfile(co.id, patch); }} attr={["data-f", "cin"]} hint={P.cin && !ci ? "A CIN has 21 characters: L/U, 5 digits, state, year, type, 6 digits" : ci ? "Incorporated in " + ci.year + (ci.listed ? " · listed" : "") : ""} />
      <Pick label="Class" value={P.cls} onSave={s("cls")} options={[["", "Choose"]].concat(CLASSES)} attr={["data-f", "cls"]} />
      <Pick label="Status" value={P.status || "Active"} onSave={s("status")} options={STATUSES} />
      <Text label="ROC" value={P.roc} from={g("roc").from} onSave={s("roc")} placeholder="ROC Delhi" attr={["data-f", "roc"]} list={ci && ci.rocCheck ? "corp-rocs" : undefined}
        hint={ci && ci.rocCheck ? "From CIN, check: " + ci.rocs.join(" or ") + " (two ROCs in this state)" : ci && ci.roc && P.roc === ci.roc ? "From the CIN" : ""} />
      {ci && ci.rocCheck && <datalist id="corp-rocs">{ci.rocs.map((r) => <option key={r} value={r} />)}</datalist>}
      <Text label="Date of incorporation" type="date" value={P.incorporated} onSave={s("incorporated")} attr={["data-f", "incorporated"]} />
      {isDay(P.incorporated) && +P.incorporated.slice(5, 7) <= 3 && <Pick label="First financial year ended on (s.2(41))" value={P.firstFyEnd || ""} onSave={s("firstFyEnd")} attr={["data-f", "firstFyEnd"]}
        options={[["", "31-Mar-" + (+P.incorporated.slice(0, 4) + 1) + " (the proviso: incorporated in January to March)"], [P.incorporated.slice(0, 4) + "-03-31", "31-Mar-" + P.incorporated.slice(0, 4)]]} />}
      <Text label="Registered office" value={P.office} from={g("office").from} onSave={s("office")} area wide attr={["data-f", "office"]} />
      <Text label="Authorised capital (₹)" value={P.authorised} from={g("authorised").from} inputMode="decimal" onSave={(v) => saveProfile(co.id, { authorised: v === "" ? "" : +v.replace(/,/g, "") || 0 })} attr={["data-f", "authorised"]} />
      <Text label="Paid-up capital (₹)" value={P.paidUp} inputMode="decimal" onSave={(v) => saveProfile(co.id, { paidUp: v === "" ? "" : +v.replace(/,/g, "") || 0 })} attr={["data-f", "paidup"]} />
      <Text label="PAN" value={P.pan} from={g("pan").from} upper onSave={s("pan")} />
      <Text label="TAN" value={P.tan} from={g("tan").from} upper onSave={s("tan")} />
      <Text label="GSTIN" value={P.gstin} from={g("gstin").from} upper onSave={s("gstin")} />
      <Text label="Statutory auditor (firm)" value={P.auditor} from={g("auditor").from} onSave={s("auditor")} attr={["data-f", "auditor"]} />
      <Text label="Auditor's FRN" value={P.auditorFrn} from={g("auditorFrn").from} upper onSave={s("auditorFrn")} />
      <Text label="Auditor appointed on" type="date" value={P.auditorFrom} onSave={s("auditorFrom")} attr={["data-f", "auditorFrom"]} />
      <Pick label="Auditor holds office till the AGM of FY" value={P.auditorTill} onSave={s("auditorTill")} attr={["data-f", "auditorTill"]}
        options={[["", "Choose"]].concat(Array.from({ length: 8 }, (_, i) => fyNext(fy, i - 1)).map((f) => [f, "FY " + f]))} />
      <Text label="Main activity (NIC code · activity)" value={P.nic} from={g("nic").from} onSave={s("nic")} />
      <Text label="Email on MCA" type="email" value={P.email} onSave={s("email")} attr={["data-f", "email"]} />
      <Text label="Phone (letterhead)" type="tel" value={P.phone} onSave={s("phone")} />
      <Text label="Website (letterhead)" value={P.website} onSave={s("website")} />
      <Text label="Date of the last board meeting" type="date" value={P.lastBoard} onSave={s("lastBoard")} attr={["data-f", "lastBoard"]} />
      <Text label="Other board meetings this year (dates, comma between)" value={(P.boardDates || []).map(dmy).join(", ")} attr={["data-f", "boardDates"]} placeholder="12-05-2026, 20-08-2026"
        onSave={(v) => saveProfile(co.id, { boardDates: v.split(/[,;]+/).map((x) => dayOf(x.trim())).filter(Boolean).sort() })} />
      <label className="corp-f"><span>AGM held on, for FY</span>
        <span className="corp-row" style={{ flexWrap: "nowrap" }}>
          <select aria-label="AGM for financial year" value={agmFy} onChange={(e) => setAgmFy(e.target.value)} style={{ flex: "0 0 auto" }}>{fyOptions(on).map((f) => <option key={f} value={f}>{"FY " + f}</option>)}</select>
          <input type="date" aria-label={"AGM date for FY " + agmFy} data-f="agm" value={(P.agms || {})[agmFy] || ""} style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => saveProfile(co.id, { agms: Object.assign({}, P.agms, { [agmFy]: e.target.value }) })} />
        </span></label>
      <Text label="Face value of a share (₹)" value={P.face} from={g("face").from} inputMode="decimal" onSave={(v) => saveProfile(co.id, { face: v === "" ? "" : +v || 0 })} />
      <div className="corp-f" style={{ justifyContent: "flex-end" }}><Tick label="Small company (s.2(85))" on={P.small} onSave={s("small")} attr={["data-f", "small"]} />
        {P.small && P.cls && P.cls !== "private" && <span className="corp-help" data-small-ignored="">A {CLASS_WORDS[P.cls] ? CLASS_WORDS[P.cls].toLowerCase() : "company of this class"} is never a small company: the tick is not used.</span>}</div>
      <div className="corp-f" style={{ justifyContent: "flex-end" }}><Tick label="Start-up (DPIIT recognised, private)" on={P.startup} onSave={s("startup")} attr={["data-f", "startup"]} /></div>
    </div>
  </Card>;
}

// a list of the profile (directors, shareholders, charges) edited row by row
// each row has an id of its own (the review: React's key, never the row's place), given on the first change to a list
// that has rows without one
export const withIds = (rows) => (rows || []).map((r) => (r && r.id ? r : Object.assign({ id: uid() }, r)));
const keyOf = (r, i) => (r && r.id) || "i" + i;
function useRows(co, P, k) {
  const rows = P[k] || [];
  const put = (i, patch) => saveProfile(co.id, { [k]: withIds(rows).map((r, j) => (j === i ? Object.assign({}, r, patch) : r)) });
  const add = (r) => saveProfile(co.id, { [k]: withIds(rows).concat([Object.assign({ id: uid() }, r)]) });
  const del = (i) => saveProfile(co.id, { [k]: withIds(rows).filter((_, j) => j !== i) });
  return { rows, put, add, del };
}

function Directors({ co, P }) {
  const [edit, setEdit] = useState(false);
  const { rows, put, add, del } = useRows(co, P, "directors"), fy = lastClosedFy(today()), pre = P._pre.directors || [];
  const kyc = (d) => { if (!isDirector(d)) return <span className="corp-chip">Not needed (no DIN)</span>;
    const k = kycFor(d, fy); if (k.done) return <span className="corp-chip" data-tone="ok" data-kyc-chip="done">{"Done · next by " + dmy(k.due)}</span>;
    return today() > k.due ? <span className="corp-chip" data-tone="bad" data-kyc-chip="overdue">Overdue</span> : <span className="corp-chip" data-tone="warn" data-kyc-chip="due">{"Due by " + dmy(k.due).slice(0, 6)}</span>; };
  return <Card title="Directors & KMP" pad={false} attr={["data-corp-directors", ""]}
    aside={canEdit() && <Button className="btn small" data-corp-edit="directors" onClick={() => setEdit(!edit)}>{edit ? "Done" : rows.length ? "Appoint / change" : "Add"}</Button>}>
    {!rows.length && !edit && <div className="corp-empty">{pre.length ? <>The financial statements name {pre.length === 1 ? "one director" : pre.length + " directors"}. {canEdit() && <button className="linkbtn" data-corp-bring="directors" onClick={() => saveProfile(co.id, { directors: withIds(pre) })}>Bring them in</button>}</> : "No directors entered yet."}</div>}
    {(rows.length > 0 || edit) && <div className="corp-scroll"><table className="corp-table" style={{ minWidth: 640 }}>
      <thead><tr><th>Name</th><th>DIN</th><th>Designation</th><th>Appointed</th><th>DIR-3 KYC</th>{edit && <th aria-label="Remove" />}</tr></thead>
      <tbody>{rows.map((d, i) => edit ? <tr key={keyOf(d, i)} data-director-row={i} data-row-id={d.id || ""}>
        <td><input aria-label="Director's name" defaultValue={d.name} onBlur={(e) => put(i, { name: e.target.value.trim() })} /></td>
        <td><input aria-label="DIN" defaultValue={d.din} inputMode="numeric" maxLength={8} onBlur={(e) => put(i, { din: e.target.value.trim() })} /></td>
        <td><select aria-label="Designation" value={d.desig || "Director"} onChange={(e) => put(i, { desig: e.target.value })}>{DESIGNATIONS.map((x) => <option key={x}>{x}</option>)}</select></td>
        <td><input type="date" aria-label="Appointed on" value={d.appointed || ""} onChange={(e) => put(i, { appointed: e.target.value })} /></td>
        <td>{isDirector(d) ? <Tick label="Done" on={kycFor(d, fy).done} attr={["data-kyc", i]} onSave={(v) => put(i, { kyc: v ? (d.kyc || []).concat([fy]) : (d.kyc || []).filter((x) => x !== fy) })} /> : "—"}</td>
        <td><button className="linkbtn" aria-label={"Remove " + (d.name || "this row")} onClick={() => del(i)}>Remove</button></td>
      </tr> : <tr key={keyOf(d, i)} data-director-row={i} data-row-id={d.id || ""}>
        <td style={{ fontWeight: 500 }}>{d.name}</td><td className="corp-num">{d.din || "—"}</td><td>{d.desig || "Director"}</td><td>{dmy(d.appointed) || "—"}</td><td>{kyc(d)}</td></tr>)}
      </tbody></table></div>}
    {edit && <div className="corp-card-body" style={{ paddingTop: 12 }}><div className="corp-row">
      <Button className="btn small" data-corp-add="director" onClick={() => add({ name: "", din: "", desig: "Director", appointed: "" })}>Add a director or KMP</Button>
      {pre.length > 0 && !rows.length && <Button className="btn small" onClick={() => saveProfile(co.id, { directors: withIds(pre) })}>Bring in from the financial statements</Button>}</div></div>}
  </Card>;
}

function Shareholding({ co, P }) {
  const [edit, setEdit] = useState(false);
  const { rows, put, add, del } = useRows(co, P, "shareholders"), tot = sharesTotal(P), pre = P._pre.shareholders || [];
  const pct = (n) => (tot ? Math.round((+n || 0) / tot * 10000) / 100 : 0);
  return <Card title="Shareholding" attr={["data-corp-shares", ""]}
    aside={<span className="corp-row"><span className="corp-note">{tot ? count(tot) + " equity shares" + (P.face ? " of ₹" + P.face + " each" : "") : ""}</span>
      {canEdit() && <Button className="btn small" data-corp-edit="shares" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</Button>}</span>}>
    {tot > 0 && <div className="corp-bar" aria-hidden="true">{rows.map((h, i) => <span key={keyOf(h, i)} style={{ flex: +h.shares || 0 }} />)}</div>}
    {!edit && <div className="corp-row" style={{ gap: 24, fontSize: 13 }}>{rows.length ? rows.map((h, i) => <span key={keyOf(h, i)} data-holder={i}>{h.name + " · " + count(h.shares) + " shares · " + pct(h.shares) + "%"}</span>)
      : pre.length ? <span>The financial statements list {pre.length} shareholder{pre.length > 1 ? "s" : ""}. {canEdit() && <button className="linkbtn" onClick={() => saveProfile(co.id, { shareholders: withIds(pre) })}>Bring them in</button>}</span> : <span className="corp-note">No shareholders entered yet.</span>}</div>}
    {edit && <div className="corp-scroll"><table className="corp-table"><thead><tr><th>Shareholder</th><th className="n">Shares</th><th className="n">%</th><th aria-label="Remove" /></tr></thead>
      <tbody>{rows.map((h, i) => <tr key={keyOf(h, i)}><td><input aria-label="Shareholder's name" defaultValue={h.name} onBlur={(e) => put(i, { name: e.target.value.trim() })} /></td>
        <td className="n"><input aria-label="Shares" inputMode="numeric" defaultValue={h.shares} onBlur={(e) => put(i, { shares: +e.target.value.replace(/,/g, "") || 0 })} /></td>
        <td className="n">{pct(h.shares) + "%"}</td><td><button className="linkbtn" onClick={() => del(i)}>Remove</button></td></tr>)}</tbody></table>
      <div className="corp-row" style={{ marginTop: 10 }}><Button className="btn small" data-corp-add="holder" onClick={() => add({ name: "", shares: 0 })}>Add a shareholder</Button></div></div>}
    {tot > 0 && P.face && P.paidUp && Math.abs(tot * P.face - P.paidUp) > 0.5 && <p className="corp-note" data-corp-warn="paidup">{"The shares (" + count(tot) + " × ₹" + P.face + " = " + money(tot * P.face) + ") do not add up to the paid-up capital (" + money(P.paidUp) + ")."}</p>}
  </Card>;
}

function Charges({ co, P }) {
  const [edit, setEdit] = useState(false);
  const { rows, put, add, del } = useRows(co, P, "charges");
  return <Card title="Charges" pad={false} attr={["data-corp-charges", ""]} aside={canEdit() && <Button className="btn small" data-corp-edit="charges" onClick={() => setEdit(!edit)}>{edit ? "Done" : rows.length ? "Edit" : "Add"}</Button>}>
    {!rows.length && !edit ? <div className="corp-empty">No charges entered.</div> : <div className="corp-scroll"><table className="corp-table" style={{ minWidth: 560 }}>
      <thead><tr><th>Charge holder</th><th className="n">Amount</th><th>Created</th><th>Satisfied</th>{edit && <th aria-label="Remove" />}</tr></thead>
      <tbody>{rows.map((c, i) => edit ? <tr key={keyOf(c, i)}>
        <td><input aria-label="Charge holder" defaultValue={c.holder} onBlur={(e) => put(i, { holder: e.target.value.trim() })} /></td>
        <td className="n"><input aria-label="Amount" inputMode="decimal" defaultValue={c.amount} onBlur={(e) => put(i, { amount: +e.target.value.replace(/,/g, "") || 0 })} /></td>
        <td><input type="date" aria-label="Created on" value={c.created || ""} onChange={(e) => put(i, { created: e.target.value })} /></td>
        <td><Tick label="Satisfied" on={c.satisfied} onSave={(v) => put(i, { satisfied: v })} /></td>
        <td><button className="linkbtn" onClick={() => del(i)}>Remove</button></td></tr>
        : <tr key={keyOf(c, i)}><td>{c.holder}</td><td className="n">{money(c.amount)}</td><td>{dmy(c.created) || "—"}</td><td>{c.satisfied ? <span className="corp-chip" data-tone="ok">Satisfied</span> : <span className="corp-chip">Open</span>}</td></tr>)}</tbody></table>
      {edit && <div className="corp-card-body" style={{ paddingTop: 12 }}><Button className="btn small" data-corp-add="charge" onClick={() => add({ holder: "", amount: 0, created: "", satisfied: false })}>Add a charge</Button></div>}</div>}
  </Card>;
}

// the year's revenue from the Financial statements' model, when it is loaded (Statements or AOC-4 opened) and the books
// are open; worked out once for each state of the books
let turnMemo = { key: "", v: "" };
function turnoverOf(b, fy) {
  if (!b || !window.FinSt || b.loading) return "";
  let k = ""; try { k = [b.cid, fy, (b.vouchers || []).length, JSON.stringify(b.fs || {}).length].join("|"); } catch (e) { return ""; }
  if (turnMemo.key !== k) {
    let v = "";
    try { const d = window.FinSt.build(fy.slice(0, 4), { unit: 1, dec: 0 }); if (d && !d.error && d.pl && d.pl.rev) v = money(d.pl.rev.cy) + " · from Books"; } catch (e) { v = ""; }
    turnMemo = { key: k, v };
  }
  return turnMemo.v;
}

function Record({ co, P }) {
  const fy = lastClosedFy(today()), b = typeof S === "object" && S.books && S.books.cid === co.id ? S.books : null;
  const turnover = turnoverOf(b, fy);
  const row = (k, l, v) => <div key={k}><dt>{l}</dt><dd data-rec={k}>{v || "—"}</dd></div>;
  return <Card title="Company record" attr={["data-corp-record", ""]}>
    <dl className="corp-dl">
      {row("pan", "PAN · TAN", [P.pan, P.tan].filter(Boolean).join(" · "))}
      {row("gstin", "GSTIN", P.gstin)}
      {row("auditor", "Statutory auditor", P.auditor ? P.auditor + (P.auditorTill ? " · till AGM of FY " + P.auditorTill : "") : "")}
      {row("nic", "Main activity", P.nic)}
      {row("email", "Email on MCA", P.email)}
      {row("turnover", "Turnover FY " + fy, turnover || (b ? "" : "Open the books to see"))}
    </dl>
  </Card>;
}

// the board meetings FinCom knows: the profile's, and the minutes made here
export const boardsOf = (c, P) => (P.boardDates || []).concat((c.docs || []).filter((d) => d.template === "minutes" && d.fields && d.fields.meetingDate).map((d) => d.fields.meetingDate));
export function Health({ co, P, formsDue }) {
  const h = health(P, { formsDue, boards: boardsOf(corpOf(co.id), P) });
  return <section className="corp-card" style={{ padding: "18px 20px" }} data-corp-health="">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ fontSize: 17 }}>Compliance health</h2>
      <span className="when" data-health-due={h.due} style={{ fontSize: 13, fontWeight: 600, color: h.due ? "var(--corp-warn)" : "var(--corp-ok)" }}>{h.due ? h.due + " due" : "All in order"}</span></div>
    <div className="corp-list">{h.items.map((x) => <div key={x.key} data-health={x.key} data-tone={x.tone}>
      <span><b>{x.title}</b><br /><span className="corp-note">{x.sub}</span></span>
      <span className="when">{x.when}{x.words && x.tone !== "ok" ? <><br /><small style={{ fontWeight: 500 }}>{x.words}</small></> : null}</span></div>)}</div>
    <button className="linkbtn" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => goClient("books:corp-forms")}>Open e-Forms ›</button>
  </section>;
}

function Activity({ c }) {
  const ev = [];
  if (c.profile && c.profile.at) ev.push({ at: c.profile.at, text: "Profile changed", tone: "#8A9099" });
  (c.filings || []).forEach((f) => { if (f.status === "filed") ev.push({ at: f.filedOn || f.at, text: f.form + " filed" + (f.srn ? " · SRN " + f.srn : ""), tone: "var(--corp-ok)" }); else if (f.at) ev.push({ at: f.at, text: f.form + " · " + (f.status || "").replace("_", " "), tone: "#2348B5" }); });
  (c.docs || []).forEach((d) => ev.push({ at: d.at, text: d.title + (d.status === "final" ? " made final" : " drafted"), tone: "#2348B5" }));
  const list = ev.filter((x) => x.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  return <section className="corp-card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }} data-corp-activity="">
    <h2 style={{ fontSize: 17 }}>Recent activity</h2>
    {list.length ? list.map((x, i) => <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: x.tone, marginTop: 5, flex: "0 0 auto" }} />
      <span>{x.text}<br /><span className="corp-note">{dmy(String(x.at).slice(0, 10))}</span></span></div>) : <p className="corp-note">Nothing yet.</p>}
  </section>;
}

function Paste({ co, P, close }) {
  const [text, setText] = useState(""), r = text.trim() ? readMaster(text) : null;
  const LBL = { cin: "CIN", name: "Name", roc: "ROC", cls: "Class", authorised: "Authorised capital", paidUp: "Paid-up capital", incorporated: "Incorporated", office: "Registered office", email: "Email", status: "Status", lastAgm: "Last AGM", lastBs: "Last balance sheet", listed: "Listed" };
  const take = () => {
    const f = Object.assign({}, r.fields), patch = {};
    ["name", "roc", "cls", "authorised", "paidUp", "incorporated", "office", "email", "status"].forEach((k) => { if (f[k] !== undefined && f[k] !== "") patch[k] = f[k]; });
    // a CIN only when it is one (21 characters in its shape): a wrong one never replaces the CIN kept
    if (f.cin && cinOk(f.cin)) patch.cin = f.cin;
    if (f.lastAgm) { const y = +f.lastAgm.slice(0, 4), m = +f.lastAgm.slice(5, 7), fy = (m <= 12 && m >= 4 ? y - 1 : y - 2); patch.agms = Object.assign({}, P.agms, { [fy + "-" + String(fy + 1).slice(2)]: f.lastAgm }); }
    if (r.directors.length) {
      const had = P.directors || [], by = Object.fromEntries(had.filter((d) => d.din).map((d) => [d.din, d]));
      // a director already here (the same DIN): the master data's appointment date is taken; a new one is added
      const got = Object.fromEntries(r.directors.map((d) => [d.din, d]));
      patch.directors = withIds(had.map((d) => (d.din && got[d.din] ? Object.assign({}, d, got[d.din].appointed ? { appointed: got[d.din].appointed } : {}, { name: d.name || got[d.din].name }) : d))
        .concat(r.directors.filter((d) => !by[d.din])));
    }
    saveProfile(co.id, patch); close();
  };
  return <Card title="Paste MCA master data" attr={["data-corp-paste-box", ""]} aside={<button className="linkbtn" onClick={close}>Close</button>}>
    <p className="corp-note">On the MCA portal open <b>View Company Master Data</b> for this CIN, select the page (Ctrl+A), copy it (Ctrl+C) and paste it here. FinCom does not connect to MCA: it reads only what you paste, and shows what it found before keeping it.</p>
    <textarea aria-label="MCA master data" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="CIN&#9;U17299DL2019PTC000000&#10;Company Name&#9;…" />
    {r && <div className="corp-checks" data-paste-found={r.found}>
      {r.found ? Object.entries(r.fields).map(([k, v]) => <div key={k}><span data-mark="ok">✓</span><span><b>{LBL[k] || k}</b>: {k === "cls" ? CLASS_WORDS[v] : k === "authorised" || k === "paidUp" ? money(v) : /Agm|Bs|incorporated/.test(k) ? dmy(v) : String(v)}</span></div>) : <div><span data-mark="warn">!</span><span>Nothing FinCom knows was found in the text.</span></div>}
      {r.directors.map((d) => <div key={d.din}><span data-mark="ok">✓</span><span><b>Director</b>: {d.name + " · DIN " + d.din + (d.appointed ? " · from " + dmy(d.appointed) : "")}</span></div>)}
    </div>}
    <div className="corp-row"><Button className="btn primary small" disabled={!r || !r.found} onClick={take} data-corp-paste-keep="">Keep what was found</Button></div>
  </Card>;
}

// (drawn with key={co.id} by Corporate.jsx: another client starts with Edit and Paste closed)
export default function Profile({ co, formsDue }) {
  const c = corpOf(co.id), P = shown(co), may = canEdit();
  const [edit, setEdit] = useState(false), [paste, setPaste] = useState(false);
  return <div data-corp-page="profile" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <Hero co={co} P={P} filings={c.filings || []} onEdit={() => setEdit(!edit)} onPaste={() => setPaste(!paste)} />
    {!may && <p className="corp-note" data-corp-readonly="">You can look at this profile; the firm's owner and staff change it.</p>}
    {may && paste && <Paste co={co} P={P} close={() => setPaste(false)} />}
    {may && edit && <Details co={co} P={P} done={() => setEdit(false)} />}
    <div className="corp-cols">
      <div className="corp-main">
        <Directors co={co} P={P} />
        <Shareholding co={co} P={P} />
        <Charges co={co} P={P} />
        <Record co={co} P={P} />
      </div>
      <aside className="corp-side">
        <Health co={co} P={P} formsDue={formsDue} />
        <Activity c={c} />
      </aside>
    </div>
  </div>;
}

// for the tests (tests/run_corp_rules.py): the rules worked out here, called in the page
if (typeof window === "object") window.FCCorpRules = { agmLastDay, nextBoard, health, cinInfo, readMaster, kycFor };
