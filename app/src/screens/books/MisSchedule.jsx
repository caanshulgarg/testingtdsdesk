// "My MIS" on a schedule (ROUND 105 B6): under a saved report, when it is sent and to whom, and what each run did. The
// schedules are mis_schedules (migration 100: the firm's own, added and changed by owners and staff, read by look-only
// members); the cloud's mis-run function works the report out on time from FinCom's cloud copy, keeps its Excel and PDF
// (bucket mis-reports), rings the bell and emails it when the email service is set up. Each run is in mis_runs.
/* global S, Cloud, toast, saveFile */
import { useEffect, useState } from "react";
import Button from "../../parts/Button.jsx";

const FREQ = [["monthly", "Every month"], ["weekly", "Every week"], ["daily", "Every day"]];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIOD = [["lastMonth", "Last month"], ["mtd", "This month so far"], ["qtd", "This quarter so far"], ["ytd", "This year so far"]];
const ist = (t) => { try { return new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " IST"; } catch (e) { return String(t || ""); } };
const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
export const ruleWords = (r) => (r.freq === "daily" ? "Every day" : r.freq === "weekly" ? "Every " + DAYS[+r.weekday] : "Every month on the " + (+r.day >= 31 ? "last day" : ord(+r.day))) + " at " + r.time + " IST";
const missing = (e) => /PGRST205|PGRST202|does not exist|schema cache|404/i.test(String((e && e.message) || e));
const enc = encodeURIComponent;

export default function MisSchedule({ cid, report, ro }) {
  const [st, setSt] = useState({ loading: true, list: [], runs: [], err: "", off: false });
  const [f, setF] = useState({ freq: "monthly", weekday: "1", day: "1", time: "08:45", period: "lastMonth", members: [], emails: "" });
  const [busy, setBusy] = useState("");
  const load = async () => {
    try {
      const list = await Cloud.api("mis_schedules?select=*&client_id=eq." + enc(cid) + "&report_id=eq." + enc(report.id) + "&order=created_at.asc") || [];
      const runs = await Cloud.api("mis_runs?select=*&client_id=eq." + enc(cid) + "&report_id=eq." + enc(report.id) + "&order=at.desc&limit=12") || [];
      setSt({ loading: false, list: [].concat(list), runs: [].concat(runs), err: "", off: false });
    } catch (e) { setSt({ loading: false, list: [], runs: [], err: missing(e) ? "" : (e && e.message) || String(e), off: missing(e) }); }
  };
  useEffect(() => { if (Cloud.on()) load(); else setSt({ loading: false, list: [], runs: [], err: "", off: true }); }, [cid, report.id]);
  const members = ((Cloud.st || {}).members || []).filter((m) => m.active !== false && m.user_id);
  const add = async () => {
    const emails = String(f.emails || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const bad = emails.filter((x) => !/^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$/i.test(x));
    if (bad.length) { toast("Not an email address: " + bad.join(", ")); return; }
    const rule = f.freq === "daily" ? { freq: "daily", time: f.time } : f.freq === "weekly" ? { freq: "weekly", weekday: f.weekday, time: f.time } : { freq: "monthly", day: f.day, time: f.time };
    setBusy("add");
    try {
      await Cloud.api("mis_schedules", { method: "POST", headers: { Prefer: "return=representation" }, body: { client_id: cid, report_id: report.id, report_name: report.name, rule, period: f.period, recipients: { members: f.members, emails } } });
      await load();
    } catch (e) { toast("The schedule could not be saved: " + ((e && e.message) || e)); }
    setBusy("");
  };
  const toggle = async (s) => { setBusy(s.id); try { await Cloud.api("mis_schedules?id=eq." + enc(s.id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { enabled: !s.enabled } }); await load(); } catch (e) { toast("Not changed: " + ((e && e.message) || e)); } setBusy(""); };
  const now = async (s) => {
    setBusy("run:" + s.id);
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), ss = Cloud.sess();
      const r = await fetch(String(c.url).replace(/\/+$/, "") + "/functions/v1/mis-run", { method: "POST", headers: { apikey: c.key, Authorization: "Bearer " + ss.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ action: "run", schedule_id: s.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) toast("It could not be prepared: " + (j.error || r.status)); else toast("Prepared: it is in the list below and in the bell.");
      await load();
    } catch (e) { toast("It could not be prepared: " + ((e && e.message) || e)); }
    setBusy("");
  };
  const download = async (file) => {
    try {
      const c = Cloud.cfg(), ss = Cloud.sess();
      const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/authenticated/mis-reports/" + file.path.split("/").map(enc).join("/"), { headers: { apikey: c.key, Authorization: "Bearer " + ss.access_token } });
      if (!r.ok) throw new Error("not found (" + r.status + ")");
      await saveFile(file.name || file.path.split("/").pop(), await r.blob());
    } catch (e) { toast("Could not download: " + ((e && e.message) || e)); }
  };
  if (st.loading) return <p className="note">Reading the schedules…</p>;
  if (st.off) return <p className="note" data-mm-sched-off="">Sending this report on a schedule is not set up for this firm yet.</p>;
  return <div className="mm-sched" data-mm-sched="">
    {st.err && <p className="bad">{st.err}</p>}
    {st.list.length > 0 && <ul className="mm-sched-list">{st.list.map((s) => <li key={s.id} data-mm-sched-row={s.id} className={s.enabled ? "" : "off"}>
      <div><b>{ruleWords(s.rule)}</b> · {(PERIOD.find((p) => p[0] === s.period) || [, s.period])[1].toLowerCase()}
        <div className="note">{(s.recipients.members || []).length + (s.recipients.emails || []).length ? "To " + [...(s.recipients.members || []).map((u) => (members.find((m) => m.user_id === u) || {}).name || "a member"), ...(s.recipients.emails || [])].join(", ") : "No one by email: the bell and this page only"}
          {" · "}{s.enabled ? "next " + ist(s.next_run) : "turned off"}</div></div>
      {!ro && <span className="mm-sched-acts"><Button className="btn small" data-mm-sched-now={s.id} disabled={!!busy} onClick={() => now(s)}>{busy === "run:" + s.id ? "Preparing…" : "Send now"}</Button>
        <Button className="btn small" data-mm-sched-toggle={s.id} disabled={!!busy} onClick={() => toggle(s)}>{s.enabled ? "Turn off" : "Turn on"}</Button></span>}
    </li>)}</ul>}
    {!ro && <div className="mm-sched-form" data-mm-sched-form="">
      <label className="mm-f"><span className="mm-l">How often</span><select aria-label="How often" value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value })}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {f.freq === "weekly" && <label className="mm-f"><span className="mm-l">On</span><select aria-label="Weekday" value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}</select></label>}
      {f.freq === "monthly" && <label className="mm-f"><span className="mm-l">On the</span><select aria-label="Day of the month" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{Array.from({ length: 28 }, (_, i) => String(i + 1)).concat(["31"]).map((d) => <option key={d} value={d}>{d === "31" ? "last day" : ord(+d)}</option>)}</select></label>}
      <label className="mm-f"><span className="mm-l">At (IST)</span><input type="time" aria-label="Time (IST)" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
      <label className="mm-f"><span className="mm-l">Covering</span><select aria-label="Period covered" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{PERIOD.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {members.length > 0 && <div className="mm-f"><span className="mm-l">Send to members</span><div className="mm-ticks">{members.map((m) => <label key={m.user_id}><input type="checkbox" checked={f.members.includes(m.user_id)} onChange={(e) => setF({ ...f, members: e.target.checked ? f.members.concat([m.user_id]) : f.members.filter((x) => x !== m.user_id) })} /> {m.name || m.email}</label>)}</div></div>}
      <label className="mm-f"><span className="mm-l">and to these addresses (e.g. the client's director)</span><input aria-label="Email addresses" placeholder="director@client.com, accounts@client.com" value={f.emails} onChange={(e) => setF({ ...f, emails: e.target.value })} /></label>
      <Button className="btn small primary" data-mm-sched-add="" disabled={!!busy} onClick={add}>{busy === "add" ? "Saving…" : "Add the schedule"}</Button>
      <p className="note">FinCom prepares it in the cloud from the books there, on time, even with this page closed: the Excel and the PDF are kept here and the bell says when it is ready. Email goes out once the email service is set up.</p>
    </div>}
    {st.runs.length > 0 && <><h4>Runs</h4><ul className="mm-runs" data-mm-runs="">{st.runs.map((r) => <li key={r.id} data-mm-run={r.status}>
      <span>{ist(r.at)} · {r.period && r.period.from ? r.period.from.slice(6) + "/" + r.period.from.slice(4, 6) + "–" + r.period.to.slice(6) + "/" + r.period.to.slice(4, 6) + "/" + r.period.to.slice(0, 4) : ""}</span>
      {r.status === "ok" ? <span>{(r.files || []).map((fl) => <button key={fl.path} type="button" className="linkbtn" data-mm-run-file={fl.kind} onClick={() => download(fl)}>{fl.kind === "pdf" ? "PDF" : "Excel"}</button>)}
        <span className="note">{r.email === "sent" ? " emailed to " + (r.sent_to || []).length : r.email === "not set up" ? " email not set up" : r.email === "failed" ? " email failed" : ""}</span></span>
        : <span className="bad">{"Could not be prepared: " + r.error}</span>}
    </li>)}</ul></>}
  </div>;
}
