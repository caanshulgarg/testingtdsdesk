// Filing GSTR-1, IFF and GSTR-3B through the GST API (17-Oct-2026; docs/gst-filing-api.md): on the return's card, the
// client's choice "File through: GST API / Browser helper" (the helper by default), and for the API the steps
// Save to portal → the portal's summary beside FinCom's (differences highlighted) → Proceed to file → Send OTP → File
// (a person's click) → the ARN. The talking to the server is GSTFILE (src/js/83-gst-file-api.js); the OTP is typed
// here, sent once, and kept nowhere.
import { useEffect, useState } from "react";
// GSTFILE and gstFileRoute (src/js/83-gst-file-api.js) come with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../../src/js/83-gst-file-api.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const dmy = (s) => (s ? GSTAmend.dmy(String(s).slice(0, 10).replace(/-/g, "")) : "");
const H = [["txval", "Taxable"], ["iamt", "IGST"], ["camt", "CGST"], ["samt", "SGST"], ["csamt", "Cess"]];
const ORDER = ["saved", "summary", "confirmed", "proceeded", "filed"];
const at = (st, s) => ORDER.indexOf(st || "") >= ORDER.indexOf(s);

function Step({ n, title, done, on, children }) {
  return <div className={"gq-step" + (done ? " done" : "")} data-gfile-step={n} style={on === false ? { opacity: 0.55 } : undefined}>
    <div className="gq-n">{done ? "✓" : n}</div><div className="gq-b"><div className="gq-t">{title}</div>{children}</div></div>;
}

// a filing date: the ARN and date when filed through the API (nothing to type), else the box as before
export function FiledOrDate({ form, ym, reg, children }) {
  const f = typeof GSTFILE === "object" && ym ? GSTFILE.filedApi(form, ym, reg) : null;
  return f ? <span className="tag ok" data-filed-arn={f.arn}>{"Filed " + dmy(f.on) + " · ARN " + f.arn}</span> : children;
}

// FinCom's figures beside the portal's, table by table; a figure that differs is marked
function Compare({ cmp, form }) {
  const differs = new Set(cmp.differs || []), rounding = new Set(cmp.rounding || []);
  const cls = (k) => differs.has(k) ? " gfile-diff" : rounding.has(k) ? " gfile-round" : "";
  const cell = (r, h, side) => <td key={side + h} className={"n" + cls(r.key + "." + h)} title={rounding.has(r.key + "." + h) ? "rounding (under ₹1)" : undefined}>{money(r[side][h])}</td>;
  return <div className="bk-tablewrap" style={{ marginTop: 8 }}><table className="bk-table compact" data-gfile-compare="" data-statement="">
    <thead><tr><th rowSpan={2}>{form === "3B" ? "Table" : "Table of GSTR-1"}</th><th rowSpan={2}></th>{form !== "3B" && <th className="n" colSpan={2}>Documents</th>}
      <th className="n" colSpan={H.length}>FinCom</th><th className="n" colSpan={H.length}>On the portal</th></tr>
      <tr>{form !== "3B" && <><th className="n">FinCom</th><th className="n">Portal</th></>}{H.map(([, l]) => <th key={"f" + l} className="n">{l}</th>)}{H.map(([, l]) => <th key={"p" + l} className="n">{l}</th>)}</tr></thead>
    <tbody>{cmp.rows.map((r) => <tr key={r.key} data-gfile-row={r.key} data-differs={r.differs.length ? "1" : "0"} className={r.differs.length ? "gfile-bad" : undefined}>
      <td>{r.label}</td>
      <td>{r.differs.length ? <span className="tag bad">differs</span> : (r.rounding || []).length ? <span className="gfile-roundtag" data-gfile-rounding={r.key}>rounding (under ₹1)</span> : <span className="tag ok">same</span>}</td>
      {form !== "3B" && <><td className={"n" + (differs.has(r.key + ".n") ? " gfile-diff" : "")}>{r.fincom.n}</td><td className={"n" + (differs.has(r.key + ".n") ? " gfile-diff" : "")}>{r.portal.n}</td></>}
      {H.map(([h]) => cell(r, h, "fincom"))}{H.map(([h]) => cell(r, h, "portal"))}
</tr>)}</tbody>
  </table>
    {(cmp.rounding || []).length > 0 && <p className="note gfile-roundnote" data-gfile-rounding-note="">{"Rounding (under ₹1), no reason needed: " + cmp.rounding.map((k) => words(k, cmp.rows)).join("; ") + "."}</p>}</div>;
}

// 3B: the set-off worked out from the portal's liability and its ledgers (sections 49, 49A; rule 88A)
function Plan({ plan }) {
  const u = plan.pditc || {}, need = plan.cashNeeded || {}, short = plan.short || {};
  const credit = { igst: u.i_pdi + u.c_pdi + u.s_pdi, cgst: u.i_pdc + u.c_pdc, sgst: u.i_pds + u.s_pds, cess: u.cs_pdcs };
  const cashOf = (h) => { const c = (plan.cash || {})[h]; return typeof c === "number" ? c : c ? (c.tot != null ? c.tot : (+c.tx || 0) + (+c.intr || 0) + (+c.fee || 0)) : 0; };
  return <div className="bk-tablewrap" style={{ marginTop: 8 }}><table className="bk-table compact" data-gfile-plan="" data-statement="">
    <thead><tr><th>Set-off</th><th className="n">Paid from credit</th><th className="n">Cash needed</th><th className="n">In the cash ledger</th><th className="n">Short</th></tr></thead>
    <tbody>{["igst", "cgst", "sgst", "cess"].map((h) => <tr key={h}><td>{h.toUpperCase()}</td><td className="n">{money(credit[h])}</td><td className="n">{money(need[h])}</td><td className="n">{money(cashOf(h))}</td>
      <td className="n">{short[h] ? <b className="bad">{money(short[h])}</b> : "—"}</td></tr>)}</tbody>
  </table>
    <p className="note">{"Credit used in the order the law sets: IGST credit first against IGST, the rest against CGST and SGST; then CGST and SGST credit against their own tax and then IGST; never CGST against SGST. Reverse charge, interest and late fee in cash."}</p></div>;
}

// with no props (data-react="GstFileApi"): the return and period open (S.gstFileForm, S.gstYm, S.gstReg)
// a difference as words: "B2B.iamt" -> "B2B invoices (4A): IGST"
const FIG = { n: "number of documents", txval: "taxable value", iamt: "IGST", camt: "CGST", samt: "SGST", csamt: "cess" };
function words(k, rows) {
  const [t, h] = String(k).split("."), r = (rows || []).find((x) => x.key === t);
  return (r ? r.label : t) + ": " + (FIG[h] || h);
}

// a greyed-out choice says why (next-fix-toggles): only the firm's people, signed in, file
const NOT_MAY = "Sign in to the firm account to change this: the firm's owner and staff file returns";
export default function FileApi({ form = S.gstFileForm || "R1", ym = S.gstYm || "", reg = S.gstReg || "", label }) {
  const [note, setNote] = useState(""), [pan, setPan] = useState(""), [otp, setOtp] = useState(""), [ack, setAck] = useState(false);
  const route = gstFileRoute(), gstin = GSTFILE.gstin(reg), ready = GSTFILE.apiReady(reg), s = GSTFILE.state(form, ym, reg), may = GSTFILE.mayFile();
  const name = label || GSTFILE.FORMS[form], fl = s.filing || null, st = fl ? fl.status : "", done = GSTFILE.filedApi(form, ym, reg);
  useEffect(() => { if (ready && ym) GSTFILE.load(form, ym, reg); }, [ready, form, ym, reg]);
  useEffect(() => { if (!pan) { const p = (fl && fl.signatory_pan) || (typeof clientPan === "function" ? clientPan() : ""); if (p) setPan(p); } }, [fl && fl.signatory_pan]);
  if (!ym || !gstin) return null;
  const busy = !!s.busy, cmp = s.cmp, differs = (cmp && cmp.differs) || (fl && fl.diffs) || [];
  const pick = <label className="note" data-gfile-route="">{"File through: "}
    <select aria-label="File through" value={route} disabled={!may} title={may ? undefined : NOT_MAY} style={{ width: "auto" }} onChange={(ev) => GSTFILE.setRoute(ev.target.value)}>
      <option value="helper">Browser helper</option><option value="api">GST API (OTP every 30 days)</option></select></label>;
  const sign = GSTFILE.sign(), dsc = sign === "dsc";
  const signPick = route === "api" && <label className="note" data-gfile-sign="">{"Signs with: "}
    <select aria-label="Signs with" value={sign} disabled={!may} title={may ? undefined : NOT_MAY} style={{ width: "auto" }} onChange={(ev) => GSTFILE.setSign(ev.target.value)}>
      <option value="evc">EVC (OTP to the signatory)</option><option value="dsc">DSC (companies and LLPs)</option></select></label>;
  const head = <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
    <b>{"File " + name + " for " + GSTR.label(ym)}</b><span className="row" style={{ gap: 12, flexWrap: "wrap" }}>{signPick}{pick}</span></div>;
  const msg = s.msg ? <p className={s.bad ? "bad" : "note"} data-gfile-msg="" style={{ margin: "6px 0 0" }}>{s.msg}</p> : null;
  if (done || st === "filed") {
    const arn = (done && done.arn) || fl.arn, on = done ? dmy(done.on) : dmy(fl.filed_at);
    return <section className="dash-card gq gfile" data-gst-file={form} data-route={route} data-filed={arn} style={{ marginTop: 12 }}>{head}
      <p style={{ margin: "6px 0 0" }}><span className="tag ok">Filed</span>{" " + name + " for " + GSTR.label(ym) + (dsc ? " · ARN " : " through the GST API · ARN ")}<b data-gfile-arn="">{arn}</b>{on ? " · " + on : ""}</p>{msg}</section>;
  }
  if (route !== "api") return <section className="dash-card gq gfile" data-gst-file={form} data-route="helper" style={{ marginTop: 12 }}>{head}
    <p className="note" style={{ margin: "6px 0 0" }}>{"Through FinCom’s browser helper: open the GST portal in your own browser and sign in yourself; the helper works only in that tab and never presses Submit or File, or types a captcha or OTP — you do. Or download the JSON and upload it on the portal as before."}</p></section>;
  if (!ready) return <section className="dash-card gq gfile" data-gst-file={form} data-route="api" data-ready="0" style={{ marginTop: 12 }}>{head}
    <p className="note" style={{ margin: "6px 0 0" }}>{"This client files through the GST API, but " + gstin + " is not connected now. Connect it with the taxpayer’s OTP under 2B & ITC → GST API (the taxpayer allows API access on the portal; it lasts up to 30 days). Until then, use the browser helper or the JSON."}</p></section>;
  const btn = (k, text, fn, primary, off) => <button className={"btn small" + (primary ? " primary" : "")} data-gfile={k} disabled={busy || !may || off} onClick={fn}>{s.busy === k ? text + "…" : text}</button>;
  return <section className="dash-card gq gfile" data-gst-file={form} data-route="api" data-status={st || "new"} style={{ marginTop: 12 }}>{head}
    {s.host && s.host !== "production" && <p className="note" style={{ margin: "4px 0 0" }} data-gfile-host={s.host}>{"Filing on the GST sandbox (test), not the live portal."}</p>}
    {!may && <p className="note">Only the firm’s owner or staff can file; you can see where the return stands.</p>}
    <Step n={1} title="Save to the portal" done={at(st, "saved") && fl.save_state === "P"}>
      <p className="note" style={{ margin: 0 }}>{"Sends the return FinCom made (the same as the JSON download) to the portal. Nothing is filed."}</p>
      {fl && fl.save_state && fl.save_state !== "P" && <p className="bad">{fl.save_state === "IP" ? "The portal is still processing the save." : "The portal found errors; correct them and save again."}</p>}
      {btn("save", at(st, "saved") ? "Save again" : "Save to portal", () => GSTFILE.save(form, ym, reg), !st)}
    </Step>
    <Step n={2} title="Compare the portal’s summary with FinCom" done={at(st, "confirmed")} on={at(st, "saved")}>
      {btn("summary", cmp ? "Read the summary again" : "Read the portal’s summary", () => GSTFILE.summary(form, ym, reg), st === "saved", !at(st, "saved"))}
      {cmp && <Compare cmp={cmp} form={form} />}
      {cmp && cmp.plan && <Plan plan={cmp.plan} />}
      {st === "summary" && cmp && (differs.length ? <div className="gfile-accept" style={{ marginTop: 8 }}>
        <p className="bad" data-gfile-differs="">{differs.length + " difference" + (differs.length === 1 ? "" : "s") + ": " + differs.map((k) => words(k, cmp.rows)).join("; ") + ". Correct them in the books and save again, or accept them with a reason."}</p>
        <label className="chk"><input type="checkbox" aria-label="Accept the differences" checked={ack} onChange={(ev) => setAck(ev.target.checked)} /> I have checked these differences and accept them</label>
        <input aria-label="Why the differences are accepted" placeholder="Why (kept with your name)" value={note} onChange={(ev) => setNote(ev.target.value)} style={{ width: "100%", marginTop: 6 }} />
        <div style={{ marginTop: 6 }}>{btn("confirm", "Accept and confirm", () => GSTFILE.confirm(form, ym, reg, note), true, !ack || !note.trim())}</div></div>
        : <div style={{ marginTop: 8 }}>{btn("confirm", "The summary matches FinCom: confirm", () => GSTFILE.confirm(form, ym, reg, ""), true)}</div>)}
      {at(st, "confirmed") && <p className="note" data-gfile-confirmed="">{"Confirmed " + (fl.accepted && fl.accepted.length ? "with " + fl.accepted.length + " difference" + (fl.accepted.length === 1 ? "" : "s") + " accepted (" + (fl.accept_note || "") + ")" : "as matching") + "."}</p>}
    </Step>
    <Step n={3} title={form === "3B" ? "Proceed to file: set off the liability" : "Proceed to file"} done={at(st, "proceeded")} on={st === "confirmed"}>
      <p className="note" style={{ margin: 0 }}>{form === "3B" ? "Pays the tax from the credit and cash ledgers as shown above. After this the 3B cannot be changed." : "The portal makes the return ready to file. The portal’s summary is read again first; if it changed, nothing is sent."}</p>
      {btn("proceed", "Proceed to file", () => GSTFILE.proceed(form, ym, reg), st === "confirmed", st !== "confirmed")}
    </Step>
    {dsc ? <>
    <Step n={4} title="File with DSC on the portal" on={st === "proceeded"}>
      <p className="note" style={{ margin: 0 }} data-gfile-dsc="">{"This client signs with DSC. The return is saved and ready to file on the portal: sign in there as " + gstin + " yourself, open the Returns Dashboard for " + GSTR.label(ym) + ", choose " + (form === "3B" ? "GSTR-3B" : "GSTR-1/IFF") + " and press File with DSC (the portal’s signer, emSigner, and your DSC token)."}</p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <button className={"btn small" + (st === "proceeded" ? " primary" : "")} data-gfile="portal" disabled={st !== "proceeded"} onClick={() => GSTFILE.openPortal()}>File with DSC on the portal</button>
        {btn("track-dsc", "I have filed it: read the ARN", () => GSTFILE.track(form, ym, reg), false, st !== "proceeded")}
      </div>
      <p className="note">{"FinCom reads the ARN back from the portal by itself, and the month is marked filed."}</p>
    </Step>
    </> : <>
    <Step n={4} title="The authorised signatory’s OTP" done={!!(fl && fl.otp_sent_at)} on={st === "proceeded"}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="note">{"Signatory’s PAN "}<input aria-label="Signatory PAN" value={pan} maxLength={10} onChange={(ev) => setPan(ev.target.value.toUpperCase())} style={{ width: 130 }} /></label>
        {btn("evc_otp", fl && fl.otp_sent_at ? "Send the OTP again" : "Send OTP", () => GSTFILE.otp(form, ym, reg, pan), st === "proceeded" && !(fl && fl.otp_sent_at), st !== "proceeded" || !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan))}
      </div>
      <p className="note">{"The portal sends the OTP to the signatory’s registered mobile and e-mail. Companies and LLPs sign with DSC: choose “Signs with: DSC” above."}</p>
    </Step>
    <Step n={5} title="File" on={st === "proceeded" && !!(fl && fl.otp_sent_at)}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="EVC OTP" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" maxLength={6} value={otp} onChange={(ev) => setOtp(ev.target.value.replace(/\D/g, ""))} style={{ width: 120 }} />
        {btn("file", "File " + name, async () => { const okd = await GSTFILE.file(form, ym, reg, pan, otp); setOtp(""); if (okd) setAck(false); }, true, !(st === "proceeded" && fl && fl.otp_sent_at) || otp.length !== 6)}
      </div>
      <p className="note">{"Filing is final. The ARN comes back here and the month is marked filed."}</p>
    </Step>
    </>}
    {msg}
    <p className="note" style={{ margin: "8px 0 0" }}><button className="linkbtn" data-gfile="track" disabled={busy || !may} onClick={() => GSTFILE.track(form, ym, reg)}>Check the status on the portal</button></p>
  </section>;
}
