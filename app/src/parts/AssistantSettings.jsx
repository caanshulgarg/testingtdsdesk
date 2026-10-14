// FinCom Assistant in Settings › AI help: the firm's switch, today's use against the daily cap, the questions asked and
// the mismatches. Its own file, imported only by the Settings screen (a file fetched when Settings opens), so the app's
// first file stays within its budget (tests/run_stability.py). The panel and the launcher are in Assistant.jsx.
import { useState } from "react";
import Button from "./Button.jsx";

const money = (v) => (v == null || v === "" ? "" : INR.format(r2(num(v))));
const dmy = (v) => ASST.dmy(v);

// Settings › Assistant (the firm's owner): today's use and the daily limit, the last 30 days, the questions asked, and the
// mismatches (AI figures the books gave differently, answers marked wrong) with their status
export function AssistantSettings() {
  const a = ASST.st();
  const [cap, setCap] = useState(""), [rate, setRate] = useState("");
  if (a.usage === undefined) { a.usage = null; setTimeout(() => ASST.loadUsage(), 0); }
  const u = a.usage, m = a.mismatches;
  const ST = { new: "New", cause_found: "Cause found", fix_waiting: "Fix waiting for your OK", fixed: "Fixed" };
  return <section className="asst-settings" data-asst-settings="">
    <h3>FinCom Assistant</h3>
    <AssistantSwitch />
    {!u ? <p className="note">Loading…</p> : u.error ? <p className="note">{u.error}</p> : <>
      <p data-asst-spend="">Today: <b>₹{money(u.spent_inr)}</b> of <b>₹{money(u.cap_inr)}</b> for AI answers{u.warn ? <b className="asst-warn-txt"> · {u.over ? "the limit is reached: new AI answers wait for midnight" : "80% used"}</b> : null}.
        <span className="note"> At ₹{u.rate} to the dollar. Answers from FinCom's own tools, answers given earlier on the same books and the checks before filing cost nothing and keep working at the limit.</span></p>
      {u.owner && <p className="asst-cap"><label>Daily limit ₹ <input type="number" min="0" max="1000000" value={cap} placeholder={String(u.cap_inr)} onChange={(e) => setCap(e.target.value)} /></label>
        <label> ₹ to a dollar <input type="number" min="1" max="1000" step="0.01" value={rate} placeholder={String(u.rate)} onChange={(e) => setRate(e.target.value)} /></label>
        <Button className="btn small" onClick={() => (cap !== "" || rate !== "") && ASST.setCap(cap, rate)}>Set</Button></p>}
      {u.owner && (u.features || []).length > 0 && <table className="asst-table" data-asst-features=""><thead><tr><th>What uses the money (30 days)</th><th className="n">Questions</th><th className="n">AI calls</th><th className="n">₹</th></tr></thead>
        <tbody>{u.features.map((f) => <tr key={f.feature}><td>{{ book: "Book questions", routing: "Routing (Haiku)", general: "Tax questions", file: "Files", notice: "Notices", heavy: "Audit and reports", prefile: "Checks before filing", cache: "Answered from earlier" }[f.feature] || f.feature}</td>
          <td className="n">{f.questions}</td><td className="n">{f.calls}</td><td className="n">{money(f.inr)}</td></tr>)}</tbody></table>}
      {u.owner && (u.months || []).length > 0 && <table className="asst-table" data-asst-months=""><thead><tr><th>Month</th><th className="n">AI calls</th><th className="n">₹</th></tr></thead>
        <tbody>{u.months.map((d) => <tr key={d.month}><td>{d.month}</td><td className="n">{d.calls}</td><td className="n">{money(d.inr)}</td></tr>)}</tbody></table>}
      {u.owner && (u.days || []).length > 0 && <details><summary>By day</summary><table className="asst-table"><thead><tr><th>Day</th><th className="n">AI calls</th><th className="n">Tokens in</th><th className="n">Cache read</th><th className="n">Tokens out</th><th className="n">₹</th></tr></thead>
        <tbody>{u.days.slice(0, 31).map((d) => <tr key={d.day}><td>{dmy(d.day)}</td><td className="n">{d.calls}</td><td className="n">{INR.format(d.in)}</td><td className="n">{INR.format(d.cache_read || 0)}</td><td className="n">{INR.format(d.out)}</td><td className="n">{money(d.inr)}</td></tr>)}</tbody></table></details>}
      {u.owner && <details><summary>Questions asked ({(u.questions || []).length})</summary><table className="asst-table"><thead><tr><th>When</th><th>Who</th><th>Question</th><th>Answered by</th><th>Tools</th><th className="n">₹</th></tr></thead>
        <tbody>{(u.questions || []).slice(0, 100).map((q, i) => <tr key={i}><td>{String(q.at).slice(0, 16).replace("T", " ")}</td><td>{q.by}</td><td>{q.q}</td><td>{{ keyword: "FinCom (no AI)", haiku: "Haiku routing", "sonnet-route": "Sonnet routing", model: "AI", cache: "earlier answer" }[q.route] || q.route}</td><td>{(q.tools || []).join(", ")}</td><td className="n">{money(q.inr)}</td></tr>)}</tbody></table></details>}
      {u.owner && (u.fell_through || []).length > 0 && <details data-asst-fell=""><summary>Questions no fixed question fitted ({u.fell_through.length}): candidates for new ones</summary><ul>{u.fell_through.map((x, i) => <li key={i}>{x.q} <span className="note">×{x.n}</span></li>)}</ul></details>}
      <p className="note">Case search uses free public sources (Indian Kanoon, the Supreme Court, High Courts, ITAT, CESTAT, GSTAT, CBIC and CBDT). Taxmann, SCC Online and Manupatra need subscriptions and are not used.</p>
    </>}
    {u && u.owner && <div className="asst-mismatches" data-asst-mismatches="">
      <h4>Mismatches {m && m.counts ? <span className="note">({m.counts.new} new · {m.counts.cause_found} cause found · {m.counts.fix_waiting} fix waiting for your OK · {m.counts.fixed} fixed)</span> : null}</h4>
      <p className="note">A figure the AI stated that FinCom's books give differently (FinCom's figure was used), or an answer someone marked wrong. FinCom never changes the books to make them agree; the developers find the cause and ask your OK before a fix.</p>
      {m && m.rows && m.rows.length ? <table className="asst-table"><thead><tr><th>When</th><th>Client</th><th>Question</th><th>Figure</th><th className="n">AI</th><th className="n">FinCom</th><th>Status</th></tr></thead>
        <tbody>{m.rows.map((x) => <tr key={x.id} data-mismatch={x.status}><td>{String(x.at).slice(0, 10)}</td><td>{(S.companies[x.client] || {}).name || x.client || "firm"}</td><td>{x.question}{x.note ? <div className="note">“{x.note}”</div> : null}</td>
          <td>{x.kind === "user_report" ? "reported wrong" : x.figure}</td><td className="n">{x.ai == null ? "" : money(x.ai)}</td><td className="n">{x.fincom == null ? "" : money(x.fincom)}</td>
          <td>{ST[x.status] || x.status}{x.last && x.last.note ? <div className="note">{x.last.note}{x.last.release ? " · " + x.last.release : ""}</div> : null}</td></tr>)}</tbody></table> : <p className="note">None.</p>}
    </div>}
  </section>;
}

// the firm's switch (the owner). ON for every firm unless its owner switches it off: the owner's decision of 14-Oct-2026,
// which also replaced the clients'-consent tick with the notice on first use. Until the setting is read it says so (and
// it is read again until it is, src/js/75-assistant.js loadSettings); a member who is not the owner sees it greyed.
function AssistantSwitch() {
  const a = ASST.st();
  if (a.settings === undefined && !a.settingsBusy) setTimeout(() => ASST.loadSettings(), 0);
  if (!a.settings) return <p className="note" data-asst-switch-wait="">Reading the firm's setting…</p>;
  const st = a.settings;
  if (st.error) return <p className="note" data-asst-switch-wait="">The firm's setting could not be read ({st.error}); trying again. <button className="linkbtn" onClick={() => ASST.loadSettings(true)}>Try now</button></p>;
  return <div className="asst-switch" data-asst-switch="">
    <label className="chk"><input type="checkbox" checked={!!st.enabled} disabled={!st.owner} onChange={(e) => ASST.setSettings(e.target.checked)} /> <b>FinCom Assistant on for the firm</b>
      <span className="note"> · the chat panel on every page (Ctrl+J). On unless the owner switches it off (the owner's decision of 14-Oct-2026). "Check before filing" works either way: it is FinCom's own checks, no AI.</span></label>
    <p className="note">Questions may be processed by an AI provider (Anthropic's Claude); identifiers are masked: PANs, GSTINs, TANs, Aadhaar and phone numbers, and the names of parties the question does not name, are replaced by tokens before anything is sent, and FinCom puts the real values back. Only what the question needs is sent. Each person sees this notice the first time they open the assistant.</p>
    {!st.owner && <p className="note">Only the firm's owner can switch it on or off.</p>}
  </div>;
}
