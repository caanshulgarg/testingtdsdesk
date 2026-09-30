// GST settings, in Client setup: the client's GSTINs, and what stays the same month after month for each GSTIN (filing
// type, portal username, credit basis, opening credit, rule 37, e-invoicing, the cash ledger) and for the client
// (API mode, estimates, turnover, rule 42, contacts for letters). Were viewGstSettings and viewGstRegs (src/js/36).
// Changes go through gsetFilingAdd, gsetShared, gsetSet, gregAdd, gregRemove, gcontSet (36).
//
// State: S.gsetReg (the GSTIN whose settings are shown), S.gsetFrom / S.gsetType (a filing type being chosen),
// S.gcontQ (the contacts search).
import { useRef } from "react";
import CommitBox from "../../parts/CommitBox.jsx";

const money = (v) => INR.format(r2(v || 0));
const H4 = ({ children, top = 12 }) => <h4 style={{ margin: top + "px 0 4px" }}>{children}</h4>;
const Row = ({ children, gap = 8 }) => <div style={{ display: "flex", gap, flexWrap: "wrap", alignItems: "center" }}>{children}</div>;
const latestYm = () => { const ms = GSTR.months(); return ms[ms.length - 1] || GSTF.today().slice(0, 7).replace("-", ""); };

function Registrations({ b, regs }) {
  const box = useRef(null), co = CO() || {};
  const add = () => { if (gregAdd(box.current.value)) box.current.value = ""; };
  return (
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>GST registrations</h3>
      <p className="note" style={{ margin: "0 0 8px" }}>The GSTINs of {co.name || "this client"} (PAN {clientPan() || "not set"}). The GST tab works for these even before any Tally day book is brought in: 2B from the portal or its JSON, and the returns filed.</p>
      {regs.length ? <div className="bk-tablewrap"><table className="bk-table compact">
        <thead><tr><th>GSTIN</th><th>State</th><th>Filing type now</th><th>Portal username</th><th>Taken from</th><th></th></tr></thead>
        <tbody>{regs.map((g) => { const reg = g.slice(0, 2), src = GSTRegs.source(g, b), only = src.length === 1 && src[0] === "added here", user = GSTSet.peek(reg).portalUser;
          return <tr key={g} data-key={g}><td><b>{g}</b></td><td>{GSTRegs.state(g)}</td><td>{GSTSet.typeLabel(GSTSet.typeOf(latestYm(), reg))}</td>
            <td>{user ? <>{user} <button className="linkbtn" onClick={() => gsetUserFocus(reg)}>change</button></> : <button className="linkbtn" onClick={() => gsetUserFocus(reg)}>type it</button>}</td>
            <td>{src.join(", ")}</td>
            <td>{S.gsetReg === reg ? <span className="note">settings below</span> : <button className="linkbtn" onClick={() => setAndShow("gsetReg", reg)}>settings</button>}
              {only && <> · <button className="linkbtn" onClick={() => gregRemove(g)}>remove</button></>}</td></tr>; })}</tbody>
      </table></div> : <p className="note" style={{ color: "#B9541B" }}>No GSTIN yet. Add the client’s GSTIN below to use the GST tab.</p>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <input ref={box} type="text" aria-label="New GSTIN" data-fk="gregnew" maxLength={15} placeholder="15-character GSTIN" style={{ width: 240, textTransform: "uppercase" }} autoComplete="off"
          onKeyDown={(ev) => { if (ev.key === "Enter") add(); }} />
        <button className="btn small primary" onClick={add}>Add GSTIN</button><span className="note">Its PAN must be the client’s PAN.</span>
      </div>
      {regs.length > 1 && <div style={{ marginTop: 10 }}><label className="note">Settings shown for <select aria-label="Settings shown for" style={{ width: "auto" }} value={S.gsetReg} onChange={(ev) => setAndShow("gsetReg", ev.target.value)}>
        {regs.map((g) => <option key={g} value={g.slice(0, 2)}>{g + " · " + GSTRegs.state(g)}</option>)}</select></label></div>}
    </section>
  );
}

// the settings of one GSTIN
function OneGstin({ b, g, regs }) {
  const reg = g.slice(0, 2), st = GSTSet.peek(reg), hist = GSTSet.history(reg), open = (b.gstOpen || {})[reg] || {}, basis = ((b.itcBasis || {})[reg]) || "2b";
  const months = GSTR.months(), first = months[0] || "", cur = GSTSet.typeOf(months[months.length - 1] || first, reg);
  const quarters = Array.from(new Set(months.map((m) => GSTSet.qStart(m))));
  const next = GSTSet.qStart(GSTR.nextYm(GSTSet.qEnd(GSTF.today().slice(0, 7).replace("-", "")))), win = GSTSet.window(next);
  // shared settings ask "for which GSTINs?" first: the control keeps what was picked until then, and is drawn afresh
  // (key) when the saved value changes or the question is cancelled
  const shared = (key) => (ev) => gsetShared(reg, key, ev.target.type === "checkbox" ? ev.target.checked : ev.target.value);
  const k = (name, v) => name + ":" + v + ":" + (S.gsetNonce || 0);
  return (
    <section className="dash-card" data-greg={reg} style={{ marginBottom: 12 }}><h3>{"Settings of " + g + " · " + GSTRegs.state(g)}</h3>
      {regs.length > 1 && <p className="note" style={{ margin: "0 0 6px" }}>Each GSTIN keeps its own settings. When one is changed here, FinCom asks whether it is for this GSTIN only or for the others too.</p>}
      <H4 top={8}>Filing type</H4>
      <Row>
        <select aria-label="Filing type" style={{ width: "auto" }} defaultValue={(S.gsetType || {})[reg] || cur} key={"t" + cur} onChange={(ev) => gsetPick(reg, "type", ev.target.value)}>{GSTSet.TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <span className="note">from</span>
        <select aria-label="Filing type from" style={{ width: "auto" }} defaultValue={(S.gsetFrom || {})[reg] || quarters[0]} onChange={(ev) => gsetPick(reg, "from", ev.target.value)}>{quarters.map((q) => <option key={q} value={q}>{GSTSet.qLabel(q)}</option>)}</select>
        <button className="btn small" onClick={() => gsetFilingAdd(reg, cur)}>Set</button>
      </Row>
      {hist.length ? <p className="note">{hist.map((x, i) => <span key={x.from}>{i > 0 && "; "}{GSTSet.typeLabel(x.type) + " from " + GSTSet.qLabel(x.from) + " "}<button className="linkbtn" onClick={() => gsetFilingDel(reg, x.from)}>remove</button></span>)}. Before the first of these: monthly.</p>
        : <p className="note">Monthly for every month in the books.</p>}
      <p className="note">Changing between QRMP and monthly on the portal: <b>through the GST API: not built yet</b>{" (the portal’s own preference call); until then change it on the portal and set it here. For " + GSTSet.qLabel(next) + " the portal accepts the change from " + GSTAmend.dmy(win.from.replace(/-/g, "")) + " to " + GSTAmend.dmy(win.to.replace(/-/g, "")) + ". QRMP needs turnover of ₹5 crore or less in the year before. Composition is chosen on the portal (CMP-02, CMP-04) and cannot be changed through the API."}</p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
        <label className="note">If QRMP, PMT-06 by <select aria-label="PMT-06 method" style={{ width: "auto" }} key={k("pmt", st.pmt)} defaultValue={st.pmt || "fixed"} onChange={shared("pmt")}><option value="fixed">fixed sum (35% method)</option><option value="self">self-assessment</option></select></label>
        <label className="note">If composition, rate <select aria-label="Composition rate" style={{ width: "auto" }} key={k("comp", st.comp)} defaultValue={st.comp || "trader"} onChange={shared("comp")}>{Object.entries(GSTQ.RATES).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}</select></label>
      </div>
      <H4>GST portal username</H4>
      <CommitBox aria-label="GST portal username" data-fk={"gset-puser-" + reg} value={st.portalUser || ""} placeholder="as used to sign in on gst.gov.in" style={{ width: 260 }} autoComplete="off" onCommit={(v) => gsetSet("puser", v, reg)} />
      {" "}<span className="note">for the GST API (OTP sign-in). The password is never asked for or kept.</span>
      <H4>Credit in 3B table 4</H4>
      <select aria-label="Credit in 3B table 4" style={{ width: "auto" }} key={k("basis", basis)} defaultValue={basis} onChange={shared("basis")}><option value="2b">As far as 2B shows it (section 16(2)(aa)) — the law</option><option value="books">As booked in Tally — for comparison only</option></select>
      <H4>Electronic credit ledger at the start{first ? " (" + GSTR.label(first) + ")" : ""}</H4>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{[["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "Cess"]].map(([k, l]) => <label key={k} className="note">{l}{" "}
        <CommitBox type="number" step="0.01" aria-label={"Opening " + l} data-fk={"gset-open-" + reg + k} value={open[k] === undefined || open[k] === "" ? "" : String(open[k])} style={{ width: 130 }} onCommit={(v) => gsetSet("open", v, reg, k)} /></label>)}</div>
      <p className="note">The balance on the portal’s credit ledger before the first month here; later months carry it forward.</p>
      <H4>Rule 37</H4><label className="note"><input type="checkbox" aria-label="Rule 37" key={k("r37", !!((b.rule37On || {})[reg]))} defaultChecked={!!((b.rule37On || {})[reg])} onChange={shared("r37")} /> Reverse credit on bills unpaid 180 days after their date, and reclaim it when paid (off unless switched on)</label>
      <H4>E-invoicing</H4>
      <select aria-label="E-invoicing" style={{ width: "auto" }} key={k("einv", GSTSet.einvMode(reg))} defaultValue={GSTSet.einvMode(reg)} onChange={shared("einv")}>{[["auto", "Found from Tally: checked when the books carry IRNs"], ["outside", "Applies, e-invoices made outside Tally"], ["no", "Does not apply"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <H4>Tally ledger for GST paid in cash</H4>
      <CommitBox aria-label="Tally ledger for GST paid in cash" data-fk={"gset-cash-" + reg} value={((b.gstCashLedger || {})[reg]) || (reg + " GST ELECTRONIC CASH LEDGER")} style={{ width: 320 }} onCommit={(v) => gsetSet("cash", v, reg)} />
      {" "}<span className="note">used in the set-off journal</span>
    </section>
  );
}

function ForClient({ b }) {
  const months = GSTR.months(), fys = Array.from(new Set(months.map((m) => GSTF.fyOf(m))));
  const prevFys = Array.from(new Set(fys.map((f) => (+f.slice(0, 4) - 1) + "-" + f.slice(2, 4)).concat(fys))).sort();
  const api = GSTQ.apiMode();
  return (
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>For the client (all GSTINs)</h3>
      <H4 top={8}>Returns sent through the GST API</H4>
      <label className="note" style={{ display: "block" }}><input type="radio" name="gstapi" value="save" checked={api === "save"} onChange={() => gsetSet("api", "save")} /> <b>Save only</b> — the return is saved on the portal; you check it there and file it yourself (recommended)</label>
      <label className="note" style={{ display: "block" }}><input type="radio" name="gstapi" value="file" checked={api === "file"} onChange={() => gsetSet("api", "file")} /> <b>Save and file</b> — after the figures agree with the portal and the return is approved, it is filed with the signatory’s EVC OTP or DSC</label>
      <p className="note">Applies once the GST API is connected; until then returns are downloaded as JSON.</p>
      <H4>Interest and late fee</H4><label className="note"><input type="checkbox" aria-label="Show FinCom’s estimate" checked={!!b.gstEst} onChange={(ev) => gsetSet("est", ev.target.checked)} /> Also show FinCom’s own estimate beside the portal’s figures (off: only the portal’s figures are shown)</label>
      <H4 top={8}>Aggregate turnover of the year</H4>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{prevFys.map((f) => { const y = +f.slice(0, 4), key = (y + 1) + "-" + String(y + 2).slice(2), a = GSTF.aato(GSTF.fyOf((y + 1) + "04"));
        return <label key={f} className="note">{f}{" "}<CommitBox type="number" aria-label={"Aggregate turnover " + f} value={((b.gstAato || {})[key]) || ""} placeholder={a.v ? money(a.v) + " from the books" : "type it"} style={{ width: 170 }} onCommit={(v) => gsetSet("aato", v, "", key)} /></label>; })}</div>
      <p className="note">Used for the late fee caps, QRMP (₹5 crore or less), e-invoicing and the 30-day IRN limit (₹10 crore and above).</p>
      <H4>Rule 42</H4><label className="note"><input type="checkbox" aria-label="Rule 42 D2" checked={!!GSTRev.settings().d2} onChange={(ev) => gsetSet("d2", ev.target.checked)} /> Some of the common credit is used for non-business purposes, so D2 (5%) applies</label>
      <p className="note">Ledgers carrying common credit are marked “GST, common credit” on the Tally ledgers tab.</p>
      <H4>Blocked credit, section 17(5)</H4><p className="note">Reported in 3B table 4(B)(1), with rules 38, 42 and 43. Which kinds of purchase are blocked for this client is set further down this page.</p>
    </section>
  );
}

function Contacts({ b }) {
  const q = String(S.gcontQ || "").toLowerCase(), all = GSTSet.parties(), shown = all.filter((p) => !q || (p.party + " " + p.gstin).toLowerCase().includes(q)), c = b.gstContacts || {};
  return (
    <section className="dash-card"><h3>Contacts for GST letters</h3>
      <p className="note">Email and phone for the letters to suppliers (ITC follow-up) and customers (IMS rejections). Taken from Tally where it has them; type or correct them here.</p>
      <input type="search" aria-label="Party or GSTIN" data-fk="gcontq" value={S.gcontQ || ""} placeholder="Party or GSTIN" style={{ width: 260 }} onChange={(ev) => setAndShow("gcontQ", ev.target.value, true)} />
      {" "}<span className="note">{shown.length} of {all.length} parties with a GSTIN</span>
      <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Party</th><th>GSTIN</th><th>In the books as</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>{shown.slice(0, q ? 200 : 40).map((p, i) => { const k = GSTSet.contact(p.gstin, p.party); return <tr key={p.gstin + ":" + i} data-key={p.gstin}>
          <td>{p.party}</td><td>{p.gstin}</td><td>{p.sides}</td>
          <td><CommitBox type="email" aria-label={"Email of " + p.party} value={(c[p.gstin] || {}).email || k.email} style={{ width: "100%" }} onCommit={(v) => gcontSet(p.gstin, "email", v)} /></td>
          <td><CommitBox type="tel" aria-label={"Phone of " + p.party} value={(c[p.gstin] || {}).phone || k.phone} style={{ width: "100%" }} onCommit={(v) => gcontSet(p.gstin, "phone", v)} /></td></tr>; })}</tbody>
      </table></div>
      {!q && shown.length > 40 && <p className="note">The 40 parties with the most documents are shown; search for others.</p>}
    </section>
  );
}

export default function GstSettings() {
  const co = CO();
  if (!S.books || S.books.cid !== co.id || S.books.loading) { if (!S.books || S.books.cid !== co.id) openBooks(co.id); return <p className="note">Opening the books…</p>; }
  const b = S.books, regs = GSTR.gstins(b) || [];
  if (!regs.some((g) => g.slice(0, 2) === S.gsetReg)) { const own = String(co.gstin || "").toUpperCase().slice(0, 2); S.gsetReg = ((regs.find((g) => g.slice(0, 2) === own) || regs[0] || "")).slice(0, 2); }
  return (
    <div className="stack"><div className="pane" style={{ marginTop: 0 }}><h2>GST settings</h2>
      <p className="note" style={{ margin: "0 0 12px" }}>Settings that stay the same month after month, for each GSTIN and for the client. What changes each month — filing dates, portal figures, IMS and follow-up decisions — stays on the GST tab.</p>
      <Registrations b={b} regs={regs} />
      {regs.filter((g) => g.slice(0, 2) === S.gsetReg).map((g) => <OneGstin key={g} b={b} g={g} regs={regs} />)}
      <ForClient b={b} />
      <Contacts b={b} />
    </div></div>
  );
}
