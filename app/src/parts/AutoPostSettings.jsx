// Settings → Post automatically (next to AI help): for each client, off unless switched on; the switches for bank lines
// and purchase bills, the amounts that may differ, a limit per entry, an optional daily total, the hold before posting
// (0: "Post at once", the owner's choice of 23-Oct-2026; a setting the owner can raise), who may change it, and the log of
// every change. Only the firm's owner switches it on or loosens it; staff may always switch it off or tighten it (the
// server refuses the rest too: migration 101). The rules are src/js/90-autopost.js (AutoPost).
import { useState } from "react";
import { loadAP } from "../lib/autopostBoot.js";
import "./autopost.css";

const HOLDS = [[0, "Post at once (no hold)"], [15, "Hold 15 minutes (Undo just takes it out)"], [30, "Hold 30 minutes"], [60, "Hold 1 hour"], [240, "Hold 4 hours"]];
const amt = (v) => (v == null || v === "" ? "" : String(v));
const rupees = (v) => (v == null || v === "" ? "—" : money0(v).replace(/\.00$/, "").replace("₹", ""));

export default function AutoPostSettings() {
  const ap = window.AutoPost;
  const [, redraw] = useState(0);
  const cos = (typeof sortedCompanies === "function" ? sortedCompanies() : Object.values(S.companies || {}));
  const [cid, setCid] = useState(S.coId && S.companies[S.coId] ? S.coId : (cos[0] || {}).id);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState("");
  if (!ap) { loadAP().then(() => redraw((n) => n + 1)).catch(() => {}); return <p className="note">Loading…</p>; }
  if (!cos.length) return <section className="setcard"><p className="note">Add a client first.</p></section>;
  const co = S.companies[cid] || cos[0], saved = ap.cfg(co), v = draft || saved;
  const owner = ap.may(co, "loosen"), loose = ap.loosens(saved, v), dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const set = (k, val) => { setDraft(Object.assign({}, v, { [k]: val })); setMsg(""); };
  const lockedOn = !owner && !saved.on;
  const tname = typeof tallyCoName === "function" ? tallyCoName(co) : co.tallyName || co.name;
  const postTo = typeof choiceUsable === "function" ? choiceUsable(co, "postTo") : co.postTo;
  const save = async () => {
    if (!saved.on && v.on) {
      const ok = await askConfirm({ title: "Post automatically for " + co.name + "?", ok: "Switch it on", body: "<p class='note'>Posts to <b>" + esc(postTo || tname) + "</b> by itself what copies an entry a person approved before. You can undo any entry.</p>" });
      if (!ok) return;
    }
    const r = ap.save(co, v);
    if (!r.ok) { setMsg(r.why); return; }
    setDraft(null); setMsg(r.same ? "" : "Saved: " + r.words); render();
  };
  const log = (co.autopostLog || []).slice(-12).reverse();
  const last = ap.st.msg[co.id];
  return <>
    <section className="setcard" data-autopost-settings="">
      <h3>Post automatically what I’ve approved before</h3>
      <p className="note">When a bank line or a purchase bill is the same as one a person in the firm approved before, FinCom gives it the same ledgers and posts it to Tally by itself, through the usual posting (FinCom’s id in each entry, so nothing goes twice). Everything else waits for you. It never copies an AI suggestion or an entry it posted by itself. Off unless switched on, client by client.</p>
      <div className="grid" style={{ marginTop: 8 }}>
        <label className="f"><span>Client</span><select aria-label="Client" value={co.id} onChange={(ev) => { setCid(ev.target.value); setDraft(null); setMsg(""); }}>
          {cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <div className="f"><span>Tally</span><div className="note" style={{ paddingTop: 6 }}>{postTo ? "Posting into " + postTo : "The Tally company to post to is not confirmed yet (Client setup → Tally): nothing posts by itself until it is."}</div></div>
      </div>
      <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" data-ap-on="" checked={!!v.on} disabled={lockedOn} title={lockedOn ? "Only the firm’s owner can switch it on" : undefined} onChange={(ev) => set("on", ev.target.checked)} /> <b>Post automatically for {co.name}</b></label>
      {lockedOn && <p className="note" data-ap-owner-only="">Only the firm’s owner can switch it on.</p>}
      <div style={{ paddingLeft: 26, opacity: v.on ? 1 : 0.55 }}>
        <label className="chk"><input type="checkbox" data-ap-bank="" checked={!!v.bank} onChange={(ev) => set("bank", ev.target.checked)} /> <b>Bank lines</b></label>
        <p className="note" style={{ margin: "0 0 6px 26px" }}>Same party or narration, same direction, same ledger every time a person chose it.</p>
        <label className="f" style={{ marginLeft: 26, maxWidth: 360 }}><span>Amounts that may differ</span><select data-ap-amounts="" value={v.bankAmounts} onChange={(ev) => set("bankAmounts", ev.target.value)}>
          <option value="exact">The same amount only (±₹1)</option><option value="within">Any amount within the limit, after two agreeing approvals</option></select></label>
        <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" data-ap-bills="" checked={!!v.bills} onChange={(ev) => set("bills", ev.target.checked)} /> <b>Purchase bills</b></label>
        <p className="note" style={{ margin: "0 0 6px 26px" }}>Same supplier GSTIN, same ledgers, HSN/SAC, GST rate and TDS section as the bills a person approved. TDS is worked out afresh on every bill, never copied.</p>
        <label className="chk" style={{ marginLeft: 26 }}><input type="checkbox" data-ap-nogstin="" checked={!!v.billsNoGstin} onChange={(ev) => set("billsNoGstin", ev.target.checked)} /> Also suppliers without a GSTIN (matched by PAN, two agreeing bills)</label>
        <div className="grid" style={{ marginTop: 8 }}>
          <label className="f"><span>Limit per entry (₹)</span><input type="number" min="1" data-ap-per-entry="" value={amt(v.perEntry)} onChange={(ev) => set("perEntry", ev.target.value === "" ? "" : Number(ev.target.value))} /></label>
          <label className="f"><span>Daily total limit (₹, optional)</span><input type="number" min="0" data-ap-per-day="" placeholder="none" value={amt(v.perDay)} onChange={(ev) => set("perDay", ev.target.value === "" ? null : Number(ev.target.value))} /></label>
          <label className="f"><span>Hold before posting</span><select data-ap-hold="" value={String(v.holdMin)} onChange={(ev) => set("holdMin", Number(ev.target.value))}>
            {HOLDS.concat(HOLDS.some((h) => h[0] === v.holdMin) ? [] : [[v.holdMin, "Hold " + v.holdMin + " minutes"]]).map(([m, t]) => <option key={m} value={m}>{t}</option>)}</select></label>
        </div>
        <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked disabled title="Always on: entries are never posted while Tally cannot be reached" /> Only when Tally can be reached; otherwise the entries are queued and go when Tally is open <span className="note">(always)</span></label>
        <p className="note">FinCom checks a GSTIN’s check digit and whether the supplier is “Not filing” in the client’s 2B; it cannot see whether a registration is active (the GST portal offers no such look-up here).</p>
      </div>
      <h3 style={{ marginTop: 14 }}>Who may change this</h3>
      <div className="grid">
        <label className="f"><span>Switch on, raise a limit</span><select data-ap-who-on="" value={v.whoOn} disabled={!owner} onChange={(ev) => set("whoOn", ev.target.value)}>
          <option value="owner">The firm’s owner only</option><option value="anyone">The owner and staff</option></select></label>
        <label className="f"><span>Undo an automatic entry</span><select data-ap-who-undo="" value={v.whoUndo} disabled={!owner} onChange={(ev) => set("whoUndo", ev.target.value)}>
          <option value="owner+staff">Owner and staff</option><option value="owner">The firm’s owner only</option></select></label>
      </div>
      <p className="note">Staff see these settings and can switch it <b>off</b> for a client at any time; switching on or raising a limit needs the owner. FinCom’s cloud refuses the same from anyone else.</p>
      {!owner && dirty && loose.length > 0 && <p className="ap-why" data-ap-needs-owner="">Only the owner can {loose.join(", ")}.</p>}
      {last && <p className="ap-why" data-ap-last="">{last}</p>}
      {msg && <p className={/^Saved/.test(msg) ? "note" : "ap-why"} data-ap-msg="">{msg}</p>}
      <h3 style={{ marginTop: 14 }}>Changes</h3>
      {log.length ? <table className="data" data-ap-log=""><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>{log.map((l, i) => <tr key={i}><td>{fmtDateTime(l.at)}</td><td>{l.by}{l.role ? " (" + l.role + ")" : ""}</td><td>{l.what}</td></tr>)}</tbody></table>
        : <p className="note" data-ap-log-none="">No change yet: it has never been switched on for {co.name}.</p>}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary" data-ap-save="" disabled={!dirty} onClick={save}>Save</button>
        <button className="btn" data-ap-dont="" disabled={!dirty} onClick={() => { setDraft(null); setMsg(""); }}>Don’t save</button>
      </div>
    </section>
    <section className="setcard" data-ap-all="">
      <h3>All clients</h3>
      <table className="data"><thead><tr><th>Client</th><th>On</th><th>Bank</th><th>Bills</th><th className="n">Limit / entry</th><th className="n">Daily limit</th><th>Changed</th></tr></thead>
        <tbody>{cos.map((c) => { const x = ap.cfg(c), r = ap.rec(c); return <tr key={c.id} data-ap-client={c.id}>
          <td><button className="linkbtn" onClick={() => { setCid(c.id); setDraft(null); }}>{c.name}</button></td><td>{x.on ? "on" : "off"}</td>
          <td>{x.on ? (x.bank ? "✓" : "—") : "off"}</td><td>{x.on ? (x.bills ? "✓" : "—") : "off"}</td>
          <td className="n">{x.on ? rupees(x.perEntry) : ""}</td><td className="n">{x.on ? rupees(x.perDay) : ""}</td>
          <td>{r && r.at ? fmtDate(istDay(r.at)) + ", " + String(r.by || "").split("@")[0] : "never"}</td></tr>; })}</tbody></table>
    </section>
  </>;
}
