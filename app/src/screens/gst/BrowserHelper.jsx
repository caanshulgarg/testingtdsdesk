// The "Browser helper" step on GSTR-1, IFF and GSTR-3B (Files tab): the FinCom GST helper (a Chrome extension,
// extension/gst-helper) fills the return on the GST portal in the person's own logged-in tab from these figures and stops
// before File. Here: whether it is installed, "Open the portal for this return", "Log in to GST portal" (a login saved in
// GST settings), the status of each step, the comparison with the portal, and the ARN once filed. The talking to the
// extension is GSTB (src/js/84-gst-browser.js).
import { useEffect, useState } from "react";
// GSTB (src/js/84-gst-browser.js) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../../src/js/84-gst-browser.js";

const HOWTO = "https://github.com/caanshulgarg/testingtdsdesk/blob/next-gst-browser/docs/gst-browser-helper.md";
const BADGE = { done: "ok", stopped: "bad", running: "warn", you: "warn", waiting: "" };
const WORD = { done: "done", stopped: "stopped", running: "running", you: "yours", waiting: "to do" };
const dmy = (s) => (s ? fmtDate(String(s).slice(0, 10)) : "");

export default function BrowserHelper({ form, ym, reg }) {
  const [mode, setMode] = useState("upload");
  useEffect(() => { GSTB.connect(); GSTB.release(); if (typeof Cloud === "object" && Cloud.on()) GSTB.loadLogins(); });
  if (!ym || !reg) return null;
  // the client files through the GST API (the per-client switch of next-gst-file, gstFileRoute: "api" or "helper", the
  // helper by default): the helper's steps are not shown
  const route = typeof gstFileRoute === "function" ? gstFileRoute(S.books) : "helper";
  if (route === "api") return <section className="dash-card" style={{ marginTop: 12 }} data-browser-helper={form} data-helper-off="api"><h3>Browser helper</h3>
    <p className="note">This client files through the GST API (the setting “File through” in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button>), so the browser helper’s steps are not shown.</p></section>;
  const gstin = GSTB.gstinOf(reg), st = GSTB.state(reg, ym, form), rec = GSTF.peek(ym, reg);
  const arn = form === "3B" ? rec.r3bArn : form === "IFF" ? rec.iffArn : rec.r1Arn;
  const login = GSTB.loginOf(gstin), signed = typeof Cloud === "object" && Cloud.on();
  const name = GSTB.FORMS[form];
  const diffs = (st && st.differences) || [], agree = (st && st.agree) || {};
  return (
    <section className="dash-card" style={{ marginTop: 12 }} data-browser-helper={form}>
      <h3>Browser helper · {name} on the GST portal</h3>
      {GSTB.on()
        ? <p className="note" data-helper-installed="">FinCom GST helper {GSTB.ext.version} is installed in this browser (portal map {GSTB.ext.selectors}{GSTB.ext.verified ? "" : ", not yet checked on the live portal"}).</p>
        : <p className="note" data-helper-missing="">The FinCom GST helper is not installed in this browser. <a href={HOWTO} target="_blank" rel="noreferrer">How to install it</a> (Chrome or Edge, a few minutes, once per computer).</p>}
      <p className="note">It fills {name} on the portal from FinCom’s figures in your own logged-in tab, reads the portal’s figures back and compares them (under ₹1.00 is shown as rounding), {form === "3B" ? "and stops before Make payment / Post credit to ledger" : "then opens the portal’s File page and stops there"}. The captcha, the OTP and signing (FILE WITH DSC for companies and LLPs, or EVC) are always yours; the helper never presses them.</p>
      {(form === "R1" || form === "IFF") && <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="note"><input type="radio" name={"gstb-way-" + form} checked={mode === "upload"} onChange={() => setMode("upload")} /> Upload FinCom’s JSON (every table at once; the portal checks it)</label>
        <label className="note"><input type="radio" name={"gstb-way-" + form} checked={mode === "type"} onChange={() => setMode("type")} /> Type each table into the portal</label>
      </div>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <button className="btn small primary" data-helper-open="" disabled={!GSTB.on()} onClick={() => GSTB.open(form, ym, reg, { mode })}>Open the portal for this return</button>
        {signed && login && login.has_password && login.can_use && <button className="btn small" data-helper-login="" disabled={!GSTB.on()} onClick={() => GSTB.login(reg)}>Log in to GST portal</button>}
        <button className="btn small" disabled={!GSTB.on()} onClick={() => GSTB.open("2B", ym, reg)}>Bring in 2B through the helper</button>
        <button className="btn small" disabled={!GSTB.on()} onClick={() => GSTB.open("LEDGER", ym, reg)}>Read the cash and credit ledgers</button>
        <button className="btn small" disabled={!GSTB.on()} onClick={() => GSTB.open("STATUS", ym, reg, { of: form })}>Read the status and ARN</button>
      </div>
      {signed && !(login && login.has_password) && <p className="note">No GST portal login is saved for {gstin}: log in on the portal yourself, or save one in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button>.</p>}
      {signed && login && login.has_password && !login.can_use && <p className="note">A GST portal login is saved for {gstin}, but the firm’s owner has not allowed you to use it: log in on the portal yourself.</p>}
      {GSTB.msg && <p className="note" data-helper-msg="">{GSTB.msg}</p>}
      {arn && <p data-helper-arn=""><span className="tag ok">Filed · ARN {arn}</span>{" "}<span className="note">read from the portal{st && st.filedAt ? " on " + dmy(st.filedAt) : ""}</span></p>}
      {st && st.steps && st.steps.length > 0 && <>
        <h4 style={{ margin: "12px 0 4px" }}>Steps{st.at ? " · " + fmtDateTime(st.at) : ""}{st.mode ? " · " + (st.mode === "type" ? "typed table by table" : "by upload") : ""}</h4>
        <ol style={{ margin: "0 0 0 18px", padding: 0 }} data-helper-steps="">
          {st.steps.map((s) => <li key={s.id} data-helper-step={s.id} data-status={s.status} style={{ marginBottom: 4 }}>
            {s.label} <span className={"tag " + (BADGE[s.status] || "")}>{WORD[s.status] || s.status}</span>
            {s.message && <div className={s.status === "stopped" ? "bad" : "note"}>{s.message}</div>}</li>)}
        </ol>
      </>}
      {st && Object.keys(agree).length > 0 && <div data-helper-compare="">
        <h4 style={{ margin: "12px 0 4px" }}>The portal against FinCom</h4>
        {Object.entries(agree).map(([k, a]) => <p key={k} className={a.agree ? "nr" : "bad"} data-compare-part={k}>{({ r1: "GSTR-1 summary, table by table", r3b4c: "4(C) net ITC", pay: "Payment of tax and set-off", typed_t31: "3.1 as typed, read back", typed_t4: "4 as typed, read back", typed_t5: "5 as typed, read back" })[k] || k}: {a.agree ? "all " + a.n + " figures agree" + (a.rounding ? "; " + a.rounding + " by less than ₹1.00 (rounding)" : " to the paisa") : a.differ + " of " + a.n + " figures differ by ₹1.00 or more" + (a.rounding ? "; " + a.rounding + " by less than ₹1.00 (rounding)" : "")}</p>)}
        {diffs.length > 0 && <div className="bk-tablewrap"><table className="bk-table compact" data-statement="">
          <thead><tr><th>Figure</th><th className="n">FinCom</th><th className="n">Portal</th><th className="n">Difference</th></tr></thead>
          <tbody>{diffs.slice(0, 40).map((d, i) => <tr key={i} className={d.rounding ? "nr" : "bad"} data-diff={d.key} data-rounding={d.rounding ? "1" : undefined}><td>{d.label}</td><td className="n">{d.fincom}</td><td className="n">{d.portal}</td><td className="n">{d.diff}</td></tr>)}</tbody>
        </table></div>}
      </div>}
    </section>
  );
}
