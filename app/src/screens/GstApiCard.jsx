// Fetch 2B from the GST portal: the taxpayer's OTP once, then 2B for any month. Was viewGstApiCard() and its click
// handler in src/js/39-gst-api.js; the talking to the firm's server (GSTAPI) stays there.
import { useEffect, useState } from "react";

const reg = () => S.gstReg || ((GSTR.gstins(S.books) || [])[0] || "").slice(0, 2);

// one step against the server: the card is busy and says what is going on, then says how it went
async function run(msg, f) {
  if (S.gstApiBusy) return;
  S.gstApiBusy = true; S.gstApiMsg = msg; render();
  try { S.gstApiMsg = await f(); } catch (err) { S.gstApiMsg = "Not done: " + ((err && err.message) || err); }
  S.gstApiBusy = false; render();
}
async function fetchMonths(months) {
  const got = [], failed = [];
  for (const m of months) {
    S.gstApiMsg = "Fetching 2B for " + GSTR.label(m) + "…"; render();
    try { const x = await GSTAPI.twoB(reg(), m); got.push(GSTR.label(m) + " (" + x.rows.length + ")"); }
    catch (err) { failed.push(GSTR.label(m) + ": " + ((err && err.message) || err)); }
  }
  if (got.length) saveBooks();
  return (got.length ? "2B fetched: " + got.join(", ") + "." : "") + (failed.length ? " Not fetched — " + failed.join("; ") : "");
}

const ACCESS = "the taxpayer must have allowed API access on the portal (My Profile → Manage API Access)";

// tax-accuracy: what the server has fetched (Fetch now, or the daily run), and fetching one return now
async function fetchNow(gstin, form, ym) {
  const x = await GSTAPI.fetch(gstin, form, ym);
  if (x.none) return GSTAPI.formOf[form] + " for " + GSTR.label(ym) + " is not there yet: " + (x.error || "not filed or not made") + ".";
  saveBooks(); GSTAPI._sync = null;
  return GSTAPI.formOf[form] + " for " + GSTR.label(ym) + " fetched and kept on the firm's server.";
}
const DAYS = [1, 2, 7, 15, 30];

export default function GstApiCard() {
  const [otp, setOtp] = useState(""), [days, setDays] = useState(30);
  const b = S.books, r = reg(), gstin = GSTAPI.gstinOf(r), signedIn = GSTAPI.on();
  // the server keeps the portal session: ask it which GSTINs are connected (at most every 10 minutes), and bring in what
  // the daily run has fetched since
  useEffect(() => {
    if (gstin && signedIn && GSTAPI.stale(gstin)) GSTAPI.status(gstin).then(() => render(), () => {});
    if (gstin && signedIn) GSTAPI.syncKept().then((n) => { if (n) render(); }, () => {});
  });
  if (!b || !gstin) return null;

  const msg = S.gstApiMsg ? <p className="note">{S.gstApiMsg}</p> : null, busy = !!S.gstApiBusy;
  const card = (body) => <section className="dash-card" style={{ marginBottom: 12 }}><h3>Fetch 2B from the portal</h3>{body}</section>;
  if (!signedIn) return card(<p className="note">Sign in to the firm account (top right) to fetch 2B straight from the GST portal through the firm’s GST API connection. Until then, bring in the JSON files downloaded from the portal.</p>);

  const user = GSTAPI.user(r), live = GSTAPI.live(gstin), cur = GSTAPI.sess[gstin], pend = !!(cur && cur.sentAt && !live);
  if (!user) return card(<p className="note">Type {gstin}’s GST portal username in <button className="linkbtn" onClick={() => goGstSettings()}>GST settings</button> to connect. The taxpayer must also allow API access on the portal (My Profile → Manage API Access).</p>);

  if (!live) return card(<>
    {cur && cur.connectedAt && <p className="note"><b>The portal session has ended{cur.error ? ": " + cur.error : ""}.</b> The taxpayer’s API access period is over; one OTP connects it again.</p>}
    <p className="note">{gstin} · portal user <b>{user}</b>. The OTP goes to the taxpayer’s registered mobile and email; {ACCESS}.</p>
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className={"btn small" + (pend ? "" : " primary")} disabled={busy}
        onClick={() => run("Asking the portal to send the OTP…", async () => { await GSTAPI.otp(r); setOtp(""); return "OTP sent to the taxpayer’s registered mobile and email. Type it and press Connect."; })}>
        {pend ? "Send the OTP again" : "Send OTP"}
      </button>
      {pend && <>
        <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" style={{ width: 130 }} value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="OTP" />
        <label className="nr">API access allowed for <select value={days} aria-label="API access period" onChange={(e) => setDays(+e.target.value)} style={{ width: "auto" }}>
          {DAYS.map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}</select> (as chosen on the portal)</label>
        <button className="btn small primary" disabled={busy}
          onClick={() => run("Connecting…", async () => { await GSTAPI.auth(r, otp.trim(), days); return "Connected until " + fmtDate(GSTAPI.sess[gstin].accessUntil) + "."; })}>Connect</button>
      </>}
    </div>
    {msg}
  </>);

  const have = new Set(GST2B.all2b(r).map((t) => t.ym).concat(Object.values(b.twoBs || {}).filter((t) => t.gstin === gstin).map((t) => t.ym)));
  // a month's 2B is made on the 14th of the next month
  const fy = S.gstYm ? GSTRev.fyMonths(S.gstYm) : [], missing = fy.filter(GSTAPI.ready).filter((m) => !have.has(m));
  const pick = S.gstApiYm || S.gstYm, since = fmtDate(live.connectedAt), left = GSTAPI.accessLeft(gstin);
  const kept = (f) => GSTAPI.keptFor(gstin, f, pick);
  const keptText = (f) => { const k = kept(f); return !k ? "not fetched" : k.status === "ok" ? "fetched " + fmtDateTime(k.fetched_at) + (k.fetched_by ? "" : " (daily run)") : k.status === "none" ? "not there yet (" + fmtDateTime(k.fetched_at) + ")" : "failed: " + (k.error || ""); };
  return card(<>
    {left && left.soon && <div className="bk-alert" data-reminder={gstin}><b>API access for {gstin} ends {left.over ? "today" : "in " + left.days + " day" + (left.days === 1 ? "" : "s")} ({fmtDate(left.until)}).</b> Ask the taxpayer to allow API access again on the portal (My Profile → Manage API Access), then send a new OTP.</div>}
    <p className="note" data-access={gstin}>Connected to the portal for {gstin} since {since}{left ? <>; API access ends <b>{fmtDate(left.until)}</b> ({left.days} day{left.days === 1 ? "" : "s"} left)</> : ""}. FinCom keeps it connected for the whole firm with no new OTP until then, fetches 2B after the 14th and the filed GSTR-1 and 3B each morning, and reminds you 3 days before the access ends.</p>
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select style={{ width: "auto" }} value={pick} onChange={(e) => { S.gstApiYm = e.target.value; render(); }} aria-label="Month">
        {fy.map((m) => <option key={m} value={m}>{GSTR.label(m) + (have.has(m) ? " ✓" : "")}</option>)}
      </select>
      <button className="btn small primary" disabled={busy} onClick={() => run("Fetching 2B…", () => fetchMonths([pick]))}>Fetch 2B</button>
      {pick && <><button className="btn small" disabled={busy} onClick={() => run("Fetching the filed GSTR-1…", () => fetchNow(gstin, "R1", pick))}>Fetch filed GSTR-1</button>
      <button className="btn small" disabled={busy} onClick={() => run("Fetching the filed GSTR-3B…", () => fetchNow(gstin, "3B", pick))}>Fetch filed 3B</button></>}
      {missing.length > 0 && <button className="btn small" disabled={busy} onClick={() => run("Fetching 2B…", () => fetchMonths(missing))}>
        Fetch the {missing.length} month{missing.length === 1 ? "" : "s"} not here yet</button>}
    </div>
    {pick && <p className="note" data-kept={pick}>{GSTR.label(pick)} on the firm's server: 2B {keptText("2B")} · GSTR-1 {keptText("R1")} · 3B {keptText("3B")}.</p>}
    {msg}
  </>);
}
