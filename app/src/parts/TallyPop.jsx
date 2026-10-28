// The header's Tally icon's popover (next-tally-icon, 27-Oct-2026; the owner: "that tally icon should have some option to
// take action there only... currently it pops then side panel opens and nothing happens there also"). Anchored to the
// icon (parts/TallyIcon.jsx), never the side panel: the status word, one line, and right here the action that fits,
// done in place, its result said in the popover. Nothing goes elsewhere unless "Open Tally page" is picked.
//   Linked              Update now (the wake), with the last entry
//   Waiting for Tally   "Open <company> in TallyPrime on <PC>", Check again (reads the status now)
//   Needs you           its cause's one button: Allow posting (tally_link_posting) / Use ① · Use ② (the same company in
//                       two places; owners) / Resume reading (owners) / the port's steps and Check again / Update now
//   Not linked          Link to Tally company: the companies seen, the same GSTIN first (the link function, as the Tally
//                       page's Link) / Download FinCom Bridge when no computer of the firm has it
// Owners' actions are hidden from staff, with one line saying who can do them. Plain words (the owner: "I don't need
// NWS144... need only Tally"): the sentence is TallyIcon's (tallyIconState); never a computer's name, a port, a Windows
// user or the bridge here (they are on the Tally page), but for one labelled line "Tally company: <company> on <computer>"
// (next-fix-clientremove: the owner asked which company a client is linked to). Its own file, loaded on the first click (the app's first file is
// at its size budget).
import { useEffect, useRef, useState } from "react";
import "../../../src/js/98-link-record.js";
import "./LinkStatus.jsx";
import { tallyDevs, mayLink, coKey, tallyCoState } from "../lib/tallyState.js";
import { companyRows, linkTo } from "./TallyCompanies.jsx";
import { goTallyRow } from "./TallyChip.jsx";
import { goTallyPage } from "./HomeLink.jsx";
import { staleWords } from "./TallyLine.jsx";
import { tallyIconState, clock } from "./TallyIcon.jsx";

const TONE = { linked: "on", waiting: "warn", needs: "off", none: "idle" };
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
const now = () => clock(Date.now());
// the computer a company is read on (its first word: "NWS144 · anshul" -> NWS144)
const pcName = (company) => { try { return String((tallyCoState(company) || {}).computer || "").split(" · ")[0].trim(); } catch (e) { return ""; } };
const OWNER_ONLY = <p className="note" data-tally-pop-owner="">An owner of the firm can do this.</p>;

// FinCom Bridge's setup (assets/bridge-go/latest.json, as the Tally page reads it)
function Download() {
  const [m, setM] = useState(undefined);
  useEffect(() => { let on = true; fetch("assets/bridge-go/latest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => on && setM(j)).catch(() => on && setM(null)); return () => { on = false; }; }, []);
  const set = m && m.setup, file = set && set.url ? set.url.split("/").pop() : "";
  if (!file) return <p className="note">{m === undefined ? "Reading…" : "The FinCom Bridge setup is not on this site yet."}</p>;
  return <p><a className="btn small primary" data-tally-pop-download="" href={"assets/bridge-go/" + file + "?v=" + String(set.sha256 || "").slice(0, 12)} download={file}>Download FinCom for Tally</a>
    <span className="note" style={{ display: "block", marginTop: 4 }}>Install it on the computer that has Tally.</span></p>;
}

// Link to Tally company: the companies seen that are no client's, the same GSTIN (then the same name) first
function LinkPick({ co, run }) {
  const g = String(co.gstin || "").trim().toUpperCase(), k = coKey(co.tallyName || co.name);
  // next-fix-clientremove: a client restored is offered the companies it held before it was removed (tally_link_history,
  // migration 128) first, then the same GSTIN, then the same name
  const [hist, setHist] = useState(null);
  useEffect(() => { let on = true; if (typeof Cloud === "object" && Cloud.on && Cloud.on() && co.id)
    Promise.resolve(Cloud.api("tally_link_history?select=company_name&client_id=eq." + encodeURIComponent(co.id) + "&order=at.desc&limit=5")).then((r) => on && setHist([].concat(r || []).map((x) => x.company_name)), () => {});
    return () => { on = false; }; }, [co.id]);
  const score = (r) => ((hist || []).includes(r.company) ? 4 : 0) + (String(r.gstin || "").toUpperCase() === g && g ? 2 : coKey(r.company) === k ? 1 : 0);
  const rows = companyRows().filter((r) => r.reported && !r.client).sort((a, b) => score(b) - score(a));
  const [pick, setPick] = useState("");
  const sel = pick || (rows[0] ? rows[0].company : "");
  if (!mayLink()) return <p className="note" data-tally-pop-owner="">An owner or staff member of the firm links it.</p>;
  if (!rows.length) return tallyDevs().length ? <p className="note" data-tally-pop-none="">No Tally company to link yet: open the company in Tally; it shows here within a minute.</p> : <Download />;
  return <div className="tally-pop-link" data-tally-pop-link="">
    <label className="note" htmlFor="tallyPopPick">Link to Tally company</label>
    <select id="tallyPopPick" data-tally-pop-pick="" value={sel} title={sel} onChange={(e) => setPick(e.target.value)}>
      {rows.map((r) => <option key={r.company} value={r.company}>{r.company + (r.gstin && String(r.gstin).toUpperCase() === g ? " (same GSTIN)" : (hist || []).includes(r.company) ? " (linked before)" : "")}</option>)}
    </select>
    <button type="button" className="btn small primary" data-tally-pop-act="link" onClick={() => run(async () => {
      const r = rows.find((x) => x.company === sel); if (!r) return "Choose a company.";
      const ok = await linkTo(r, co);
      return ok ? co.name + " is linked to " + sel + "." : "Not linked: " + ((typeof TCloud === "object" && TCloud.linkErr) || "the cloud did not take it") + ".";
    })}>Link</button>
  </div>;
}

// the same company in two places: Use ① (the place FinCom reads) or Use ② (owners)
function Places({ co, run }) {
  const lp = typeof linkPostOf === "function" ? linkPostOf(co) : null, rec = lp ? lp.pick || lp.recs[0] : null;
  const places = rec && typeof LinkRec === "object" ? (LinkRec.realPlaces ? LinkRec.realPlaces(rec) : LinkRec.placesOf(rec)) : [];
  return <div data-tally-pop-places="">
    <ol className="note tally-pop-places">{places.map((p) => <li key={p.data_loc}>{(p.state === "chosen" ? "The data FinCom reads now" : "The other copy") + (p.last_seen ? ", last seen " + clock(p.last_seen) : "")}</li>)}</ol>
    {isOwner() ? <p className="tally-pop-acts">{places.map((p, i) => <button key={p.data_loc} type="button" className={"btn small" + (i ? "" : " primary")} data-tally-pop-act={"place" + (i + 1)}
      onClick={() => run(async () => ((await LinkRec.choosePlace(rec, p.data_loc)) ? "FinCom reads " + LinkRec.nameOf(rec) + " from the data you chose." : "Not chosen: please try again."))}>{"Use " + "①②③④"[i]}</button>)}</p>
      : OWNER_ONLY}
  </div>;
}

function Actions({ co, s, run, busy }) {
  const btn = (act, label, fn, primary) => <button type="button" className={"btn small" + (primary ? " primary" : "")} data-tally-pop-act={act} disabled={busy} onClick={() => run(fn)}>{label}</button>;
  const row = (...b) => <p className="tally-pop-acts">{b}</p>;
  const check = (primary) => btn("check", "Check again", async () => { await tallyCheckNow(); const x = tallyIconState(co); return "Checked at " + now() + ": " + x.word + "."; }, primary);
  const update = () => btn("update", "Update now", async () => { await tallyUpdateNow(co ? co.id : null); return "Asked Tally for its new entries at " + now() + "."; }, true);
  if (!co) return s.icon === "none" ? <Download /> : s.icon === "linked" ? null : row(check(true));
  if (s.icon === "linked") return row(update());
  if (s.icon === "waiting") return row(check(true));
  if (s.icon === "none") return s.p && (s.p.kind === "unlinked" || s.p.state === "unlinked") ? <LinkPick co={co} run={run} /> : <Download />;
  const w = s.p || {}, b = w.button || {}, l = typeof tallyLine === "function" ? tallyLine(co) : null;
  if (s.cause === "posting") return row(btn("allow", "Allow posting", async () => ((await b.act()) ? "Posting to Tally is allowed again." : "Not changed: please try again."), true));
  if (s.cause === "two") return <Places co={co} run={run} />;
  if (s.cause === "stopped") return isOwner() && l && l.stop && typeof TCloud === "object"
    ? row(btn("resume", "Resume reading", async () => { await TCloud.readResume(l.stop.all ? null : { device: { id: l.stop.deviceId }, computer: l.stop.computer || l.computer }); return "Reading from Tally starts again within a minute."; }, true)) : OWNER_ONLY;
  if (s.cause === "paused") return row(update());
  if (s.cause === "port" || s.cause === "notanswering") return <>{s.cause === "port" && <p className="note" data-tally-pop-how="">The steps are on the Tally page.</p>}{row(check(true))}</>;
  return null;   // entries waiting for a person: on the Tally page (the link below)
}

export default function TallyPop({ co, nOpen, close, back }) {
  const ref = useRef(null), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const s = tallyIconState(co), line = s.line;
  // how fresh the books are (never the reading-stopped words: the line says that, plainly)
  const stale = co && s.cause !== "stopped" ? staleWords(co.id) : "";
  // the first thing to do has the focus (the keyboard); Esc and a click outside close it (TallyIcon, parts/dismiss.js)
  useEffect(() => { const el = ref.current && ref.current.querySelector("button, select, a[href]"); if (el) el.focus(); }, []);
  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: "Did not work: " + ((e && e.message) || e) }); }
    setBusy(false);
  };
  return <div className="tally-pop" role="dialog" aria-label={"Tally: " + s.word} data-tally-pop={s.icon} ref={ref}
    onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); if (back) back(); } }}>
    <p className="tally-pop-head"><span className={"tsign-dot " + TONE[s.icon]} aria-hidden="true" /><b data-tally-pop-word="">{s.word}</b></p>
    {line && <p className="tally-pop-line" data-tally-pop-line="">{line}</p>}
    {/* next-fix-clientremove (the owner: "no visibility of which client it's linked to"): the company linked, and where */}
    {co && s.icon !== "none" && s.company && <p className="tally-pop-co" data-tally-pop-company="">{"Tally company: "}<b>{s.company}</b>{pcName(s.company) ? " on " + pcName(s.company) : ""}</p>}
    <Actions co={co} s={s} run={run} busy={busy} />
    {busy && <p className="note" data-tally-pop-busy="">Working…</p>}
    {msg && <p className={"note tally-pop-msg" + (msg.ok ? "" : " bad")} data-tally-pop-msg="" role="status">{msg.text}</p>}
    {stale && <p className="note books-stale" data-books-stale="">{stale}</p>}
    {/* Task D (the owner, 28-Oct-2026: "No suggestion to add clients"): no count of companies not linked */}
    <p className="tally-pop-foot"><button type="button" className="linkbtn" data-tally-pop-page="" onClick={() => { close(); if (co) goTallyRow(co.id); else goTallyPage(); }}>Open Tally page</button></p>
  </div>;
}
