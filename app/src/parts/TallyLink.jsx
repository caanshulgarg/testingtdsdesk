// A client's Tally card (Client setup → Tally; its one status line on the Overview and From Tally). Round 39 made it the
// place to link a client; 15-Oct-2026 (the owner: "multiple pages of Tally connection.. multiple places to connect.. all
// this is making Tally connection unreliable... need a very simple connection guide") ONE place connects and links Tally:
// the Tally page's Connect Tally guide (screens/Tally.jsx, openConnectTally in src/js/52). This card is a pointer to it:
//   One status line, one of four (tallyLinkOf, src/js/49; "Not linked → Link", "Waiting for Tally", "Linked · reading",
//   "Needs you"), and while not linked or waiting for Tally, "Open Connect Tally" (the guide at the right step; for a
//   client not linked, step 4 with this client). Nothing is linked or connected here.
//     Linked and reading  "Linked to X on <PC> · last entry 10:42", with Update now.
//     Needs you           one line and one button: reading stopped, that day's Day Book, the starting point, held
//                         entries; Tally not answering or paused point to the guide.
//   Then one tick, "Post this client's entries into X": the client's confirmed posting company (choiceConfirm postTo,
//   asked first). Nothing is posted without it; a company FinCom found by itself stays off until ticked.
//   More: Change company (the guide's step 4), Unlink, Name differs in Tally, Tally page.
// companiesSeen (below) is the list the guide's step 4 offers, the company with this client's GSTIN on top.
// 23-Oct-2026 (next-fix-tally-link; the owner: "Tally linking is still a very big problem", Salesify "even after adding
// Tally it is not updating"): the card says plainly what is missing and the one thing to do:
//   not linked   "Choose its Tally company": the companies FinCom has seen and not linked to another client, best match
//                on top (suggestFor, server/_shared/tallyname.js: same GSTIN, same name once "(2024-25)", "- (from
//                1-Apr-25)", Pvt Ltd / LLP / & are taken off), each with its computer and when it was last seen, and Link.
//                The guide's step 4 lists only companies open now; a company not open (Salesify's) is linked from here.
//   waiting      "Linked to X. Open X in TallyPrime on <PC> — FinCom reads it within a minute. Last seen 20-Oct."
//   linked       "Not this company" (one click): the same list, without the company linked now; choosing one moves the
//                client (tallyLinkClient unlinks the old one); "Unlink only" when none is right. A link FinCom made by
//                itself (linked_by empty) says so.
//   reading      what came in, in order: the ledgers, then this year's entries, each with its next step (Connect Tally's
//                steps 5 and 6).
// 23-Oct-2026 (next-tally-suvit; the owner: "make sure it should connect like Suvit.. every step"): the card says the
// company's state in the one pill every place uses (lib/tallyState.js: Connected / Disconnected — not open in Tally on
// NWS144 (last seen 20-Oct) / Disconnected — computer offline since 14:02) with Sync now (Update now); not linked, the
// card lists the matching rows of the Tally page's Companies in Tally, each with Link (parts/TallyCompanies.jsx, its
// own file); linked, the first sync's progress and confirmation, or what FinCom holds ("Ledgers 1,240 · Entries
// Apr–Oct 2026"), and Upload older entries (Day Book) while days are missing.
import { useState, lazy, Suspense } from "react";
import { needDays } from "../screens/books/FromTally.jsx";
import { seenWords, clientTallyState } from "../lib/tallyState.js";
const TCO = () => import("./TallyCompanies.jsx");
const ClientPick = lazy(() => TCO().then((m) => ({ default: m.ClientPick })));
const SyncLine = lazy(() => TCO().then((m) => ({ default: m.SyncLine })));
const DaybookLink = lazy(() => TCO().then((m) => ({ default: ({ cid }) => (m.oldDaysMissing(cid) ? <button className="btn small" data-tally-daybook={cid} onClick={() => m.openFromTally(cid)}>Upload older entries (Day Book)</button> : null) })));
import Button from "./Button.jsx";
import CommitBox from "./CommitBox.jsx";

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const sameName = (a, b) => !!a && !!b && ledNm(a).toLowerCase() === ledNm(b).toLowerCase();
export { seenWords };

// the Tally companies FinCom's cloud has seen (tally_companies, as TLight and the Tally page read them), not linked to
// another client: {company, gstin, computer, at, open, same (this client's GSTIN), mine (linked to this client)}
export function companiesSeen(co) {
  const tl = (typeof TLight === "object" && TLight.st) || {}, p = (typeof TCloud === "object" && TCloud.pane) || {};
  const devs = [].concat(tl.devs || [], p.devices || []).filter((d) => d && !d.revoked);
  const by = new Map();
  [].concat(tl.cos || [], p.companies || []).forEach((r) => {
    if (!r || !r.company) return;
    const k = ledNm(r.company).toLowerCase(), x = by.get(k) || { company: r.company, gstin: "", client: "", device: "", at: "" };
    by.set(k, Object.assign(x, { gstin: x.gstin || r.gstin || "", client: x.client || String(r.client_id || ""), device: x.device || r.device_id || "", at: [x.at, r.last_seen || ""].sort().pop() }));
  });
  const out = [];
  by.forEach((x) => {
    if (x.client && x.client !== String(co.id)) return;
    const d = x.device && devs.find((v) => v.id === x.device), info = (d && d.info) || {}, beat = info.beat || {};
    const open = [].concat(beat.open || []).concat(...Object.values(info.bridges || {}).map((b) => [].concat(b.open || []))).some((n) => sameName(n, x.company));
    const m = typeof gstinMatch === "function" ? gstinMatch(x) : null;
    out.push(Object.assign(x, { computer: d ? tallyPcLabel(d) : "", at: x.at || (d && (beat.at || d.last_seen)) || "", open, same: !!(m && m.id === co.id), mine: x.client === String(co.id) }));
  });
  return out.sort((a, b) => (b.same - a.same) || (sameName(b.company, co.tallyName) - sameName(a.company, co.tallyName)) || (b.open - a.open) || a.company.localeCompare(b.company));
}

// the Tally page's Connect Tally guide, from this client: step 4 (link) while not linked, else the first step not done
export function OpenConnect({ co, step, primary = true }) {
  return <Button className={"btn small" + (primary ? " primary" : "")} data-open-connect={String(step || 0)} onClick={() => openConnectTally(step || 0, co ? co.id : "")}>Open Connect Tally</Button>;
}

// the one status line: the pill (the words every place uses), what it means, and at most one button (Sync now)
function StatusLine({ co, k, where, b, plain = false }) {
  const x = k.company, owner = isOwner(), pill = clientTallyState(co);
  const openTally = () => openTallyFor(co.id);
  let text = "", act = null, tag = pill;
  if (k.state === "unlinked") { text = "Not linked to its company in Tally yet." + (plain ? "" : " Choose it below: Link.");
    act = plain ? <Button className="btn small" data-tally-link-choose-go="" onClick={goTallyLinkHome}>Choose its company</Button> : null; }
  else if (plain && k.state === "needs") { const n = needLine(co, k.needs[0], k, where, b, owner, openTally, plain); text = n.text; act = n.act; tag = { level: k.level, word: k.word, state: "needs" }; }
  else {
    const last = lastEntry(co, k), pc = pill.computer || k.computer || "its computer";
    text = pill.state === "connected" ? "Connected · " + x + " on " + pc + " · last entry " + (last ? tallyHm(last) : "not received yet")
      : pill.text.replace(/^Disconnected/, "") + ". " + (pill.state === "offline" ? "Turn " + pc + " on and sign in to Windows: FinCom Bridge starts by itself."
        : pill.state === "unseen" ? "Open " + x + " in TallyPrime on the computer with FinCom Bridge — FinCom reads it within a minute."
        : "Open " + x + " in TallyPrime on " + pc + " — FinCom reads it within a minute.");
    // a person must act (reading stopped, a Day Book, held entries): the word is "Needs you", as the chips say; what, below
    if (k.state === "needs") tag = { level: k.level, word: k.word, state: "needs" };
    const reading = !!(k.line && k.line.reading);
    act = canWrite() ? <Button className="btn small" data-update-now="" data-tally-sync-now={co.id} disabled={reading} onClick={() => tallyUpdateNow(co.id)}>{reading ? "Syncing…" : "Sync now"}</Button> : null;
  }
  return <div className="tlink-line" data-tally-link-status={k.state} data-tally-pill={tag.state}>
    <span className={"tag " + tag.level} data-tally-link-state="">{tag.word}</span>
    <span className="tlink-say" data-tally-link-text="">{text}</span>
    {act && <span className="tlink-act">{act}</span>}
  </div>;
}
// the last entry: Tally's change recorder on the company's computer (its heartbeat), else the bridge's last read
export function lastEntry(co, k) {
  const tl = (typeof TLight === "object" && TLight.st) || {};
  const row = (tl.cos || []).find((c) => String(c.client_id || "") === String(co.id) && c.device_id), dev = row && (tl.devs || []).find((d) => d.id === row.device_id);
  let rec = ""; try { const rc = dev && typeof Rec === "object" && Rec.recOf ? Rec.recOf(dev) : null, y = rc && row.company ? rc[row.company] : null; rec = (y && y.lastAt) || ""; } catch (e) { rec = ""; }
  return [k.line && k.line.read, rec].filter(Boolean).sort().pop() || "";
}
// a need in words, with its one button
function needLine(co, n, k, where, b, owner, openTally, plain = false) {
  const main = plain ? "btn small" : "btn small primary";   // on another page's line the page keeps its own main button
  const l = k.line || {};
  if (n.kind === "stopped") return { text: l.text,
    act: owner && l.stop ? <Button className={main} data-read-resume-line="" onClick={() => TCloud.readResume(l.stop.all ? null : { device: { id: l.stop.deviceId }, computer: l.stop.computer || l.computer })}>Resume</Button>
      : <span className="note">An owner of the firm can resume it.</span> };
  if (n.kind === "daybook") { const books = b || (S.books && S.books.cid === co.id ? S.books : null), days = needDays(books || {}, co.id), nd = days.reduce((a, x) => a + x.days, 0);
    const text = nd ? (nd === 1 ? "1 day needs its Day Book" : nd + " days need their Day Book") + (n.n ? " (" + plural(n.n, "entry", "entries") + " waiting)" : "")
      : n.n ? plural(n.n, "entry needs", "entries need") + " that day’s Day Book" : "Some days were not received from Tally: upload their Day Book";
    return { text, act: <Button className={main} data-tally-need-upload="" onClick={() => where === "books" && days.length ? tallyPickFor(tallyDate(days[0].from), tallyDate(days[0].to)) : goClient("books:import")}>Upload</Button> }; }
  if (n.kind === "baseline") return { text: "The starting point of " + k.company + " is not recorded yet: " + plural(n.n, "entry waits", "entries wait"),
    act: <Button className="btn small" data-tally-need-baseline="" onClick={openTally}>Open the Tally page</Button> };
  if (n.kind === "held") return { text: n.n === 1 ? "1 entry from Tally is held and needs a look" : n.n + " entries from Tally are held and need a look",
    act: <Button className="btn small" data-tally-need-held="" onClick={() => Rec.openActivity(co.id, "held")}>See them</Button> };
  if (n.kind === "paused") return { text: l.text + ".", act: <OpenConnect co={co} step={3} primary={false} /> };
  return { text: (l.text || "Tally is not answering") + ".", act: <OpenConnect co={co} step={2} primary={false} /> };
}

// the client's posting company, as one tick: on only when a person confirmed this company (choiceConfirm postTo)
function PostTick({ co, company }) {
  const pc = choiceGet(co, "postTo"), confirmed = !!(pc && pc.state === "confirmed"), here = sameName(co.postTo, company);
  const on = here && confirmed, may = canWrite();
  const set = (v) => askConfirm({ title: v ? "Post " + co.name + "’s entries into " + v + "?" : "Stop posting for " + co.name + "?", ok: v ? "Allow" : "Stop posting",
    body: v ? "<p>FinCom and the bridge will post this client’s bills, bank lines and sales <b>only</b> into the Tally company <b>" + esc(v) + "</b>. A posting meant for any other company is refused.</p>"
      : "<p>Nothing will be posted for this client until a company is ticked again.</p>" })
    .then((ok) => { if (!ok) return; choiceConfirm(co, "postTo", v); if (S.postStop && S.postStop.cid === co.id) S.postStop = null; toast(v ? "Posting allowed into " + v + "." : "Posting stopped."); render(); });
  const note = on ? (pc.at || co.postToAt ? "Confirmed " + fmtDateTime(pc.at || co.postToAt) + (pc.by || co.postToBy ? " by " + (pc.by || co.postToBy) : "") + "." : "")
    : co.postTo && !here && confirmed ? "Entries are posted into " + co.postTo + " now. Tick to post into " + company + " instead."
    : here ? "Found by FinCom (the one Tally company linked, same GSTIN): nothing is posted until it is ticked."
    : "Nothing is posted until it is ticked.";
  return <div className="tlink-post" data-tally-link-post={on ? "on" : "off"} data-choice="postTo" data-choice-state={pc ? pc.state : ""}>
    <label className="chk"><input type="checkbox" data-tally-link-post-tick="" checked={on} disabled={!may} onChange={() => set(on ? "" : company)} />
      {" Post this client’s entries into "}<b>{company}</b></label>
    <span className="note">{note}{!may && " A member of the firm who may make changes ticks it."}</span>
  </div>;
}

// More: Change company, Unlink, Name differs in Tally, Tally page (the menu Client setup's More uses)
function More({ co, k, onName, onChange }) {
  const linked = k.state !== "unlinked", cloud = typeof TCloud === "object" && TCloud.on(), may = canWrite();
  const unlink = () => askConfirm({ title: "Unlink " + k.company + " from " + co.name + "?", ok: "Unlink", danger: true,
    body: "<p>Its books stop coming to " + esc(co.name) + " until the client is linked again. Nothing in Tally changes.</p>" }).then((ok) => { if (ok) tallyLinkClient(k.company, null); });
  // a choice closes the menu
  const go = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  return <details className="bk-menu" data-tally-link-more="">
    <summary className="btn small" aria-label={"More about the Tally link of " + co.name}>More</summary>
    <div className="bk-menu-list">
      {linked && cloud && may && <button data-tally-link-change="" onClick={go(onChange)}>Change company<small>Link another company in Tally to this client instead.</small></button>}
      {linked && cloud && may && <button className="danger" data-tally-link-unlink="" onClick={go(unlink)}>Unlink<small>{k.company + "’s books stop coming to this client."}</small></button>}
      <button data-tally-link-name="" onClick={go(onName)}>Name differs in Tally<small>The company’s name exactly as Tally shows it.</small></button>
      <button data-tally-link-page="" onClick={go(() => openTallyFor(co.id))}>Tally page<small>The computers, and the details for support.</small></button>
    </div>
  </details>;
}

// the client's Tally name, when it is not the company's name in FinCom (the bridge on this computer matches by it)
function NameBox({ co, onClose }) {
  const open = typeof Bridge === "object" && Bridge.up() && (Bridge.st.open || []).length ? Bridge.st.open : null;
  const save = (v) => { const n = String(v || "").trim(); co.tallyName = n || co.name; Store.saveCompany(co); if (typeof Bridge === "object") Bridge.lastOpenKey = null; render(); };
  return <div className="tlink-name" data-tally-link-namebox="">
    <label className="f"><span>Company name in Tally, exactly as Tally shows it</span><CommitBox aria-label="Company name in Tally" value={co.tallyName || ""} placeholder={co.name} onCommit={save} /></label>
    {open && <label className="f"><span>Or pick the company open in Tally here</span>
      <select value={open.some((o) => o.name === co.tallyName) ? co.tallyName : ""} onChange={(ev) => ev.target.value && save(ev.target.value)}>
        <option value="">—</option>{open.map((o) => <option key={o.name}>{o.name}</option>)}</select></label>}
    <button className="linkbtn" onClick={onClose}>Done</button>
  </div>;
}

// 23-Oct-2026: the companies to choose from, on the card itself: seen by the firm's computers (open now or not), not
// linked to another client, best match first; Link is the person's own choice (tallyLinkClient: tally_company_link,
// linked_by them; a change moves the client). Four shown, the rest behind "Show all"
const WHY = { gstin: "same GSTIN", name: "same name", like: "similar name" };
function Chooser({ co, k, onDone }) {
  const [all, setAll] = useState(false), [busy, setBusy] = useState("");
  const may = canWrite(), linkedTo = k.state !== "unlinked" ? k.company : "";
  const raw = companiesSeen(co).filter((c) => !linkedTo || !sameName(c.company, linkedTo));
  const list = typeof suggestFor === "function" ? suggestFor(co, raw) : raw;
  const shown = all ? list : list.slice(0, 4);
  const pick = async (company) => {
    if (linkedTo) {
      const ok = await askConfirm({ title: "Link " + co.name + " to " + company + "?", ok: "Link this company",
        body: "<p>" + esc(co.name) + " is linked to <b>" + esc(linkedTo) + "</b> now. It will be linked to <b>" + esc(company) + "</b> instead, and " + esc(linkedTo) + " unlinked. Nothing in Tally changes.</p>" });
      if (!ok) return;
    }
    setBusy(company); const done = await tallyLinkClient(company, co.id); setBusy("");
    if (done && onDone) onDone();
  };
  const unlinkOnly = () => askConfirm({ title: "Unlink " + linkedTo + " from " + co.name + "?", ok: "Unlink", danger: true,
    body: "<p>Its books stop coming to " + esc(co.name) + ". FinCom will not link it again by itself. Nothing in Tally changes.</p>" })
    .then(async (ok) => { if (ok && await tallyLinkClient(linkedTo, null) && onDone) onDone(); });
  const pcs = Array.from(new Set(list.map((c) => c.computer).filter(Boolean)));
  return <div className="tlink-choose" data-tally-link-choose={linkedTo ? "change" : "link"}>
    <p className="tlink-choose-h"><b>{linkedTo ? "Choose the right Tally company" : "Choose its Tally company"}</b>
      <span className="note">{list.length ? " The companies FinCom has seen in Tally and not linked to another client" + (list[0].score > 0 ? ", the likeliest first." : ".")
        : " FinCom has not seen another company in Tally. Open " + co.name + "’s company in TallyPrime" + (pcs[0] ? " on " + pcs[0] : " on the Tally computer") + "; it shows here within a minute."}</span></p>
    {shown.length > 0 && <ul className="tlink-list" data-tally-link-suggest={list.length}>
      {shown.map((c, i) => <li key={c.company} data-tally-link-pick-row={c.company} data-why={c.why || ""}>
        <span className="tlink-co"><b>{c.company}</b>
          {c.why && <span className={"tag " + (c.why === "like" ? "warn" : "ok")} data-tally-link-why={c.why}>{WHY[c.why]}</span>}
          <span className="note">{(c.open ? "open in Tally" : "seen") + (c.computer ? " on " + c.computer : "") + (c.at && !c.open ? " · last seen " + seenWords(c.at) : "")}</span></span>
        {may ? <Button className={"btn small" + (i === 0 && c.score > 0 && !linkedTo ? " primary" : "")} data-tally-link-pick={c.company} disabled={!!busy} onClick={() => pick(c.company)}>{busy === c.company ? "Linking…" : "Link"}</Button>
          : i === 0 ? <span className="note">A member of the firm who may make changes links it.</span> : null}
      </li>)}
    </ul>}
    <div className="tlink-choose-more">
      {list.length > shown.length && <button className="linkbtn" data-tally-link-all="" onClick={() => setAll(true)}>{"Show all " + list.length}</button>}
      {linkedTo && may && <button className="linkbtn" data-tally-link-unlink-only="" onClick={unlinkOnly}>None of these: unlink only</button>}
      {linkedTo && <button className="linkbtn" data-tally-link-choose-close="" onClick={onDone}>Keep {linkedTo}</button>}
    </div>
  </div>;
}

// once linked: the first sync's progress and its confirmation, else what FinCom holds (TallyCompanies.jsx's SyncLine,
// the same line as the client's row on the Tally page), and Upload older entries (Day Book) while days are missing
function Progress({ co }) {
  const cloud = typeof TCloud === "object" && TCloud.on();
  if (cloud && TCloud.status && !(TCloud.st[co.id] && TCloud.st[co.id].at)) setTimeout(() => { try { TCloud.status(co.id); } catch (e) { /* the next read */ } }, 0);
  return <div className="tlink-steps" data-tally-link-progress=""><Suspense fallback={null}><SyncLine cid={co.id} /><DaybookLink cid={co.id} /></Suspense></div>;
}

// the client's link state; on From Tally the days that need a Day Book are listed with their own Upload, so they are not
// said again here (a warning is shown once)
function linkHere(co, where) {
  const k = tallyLinkOf(co);
  if (!k || where !== "books" || !k.needs.some((n) => n.kind === "daybook")) return k;
  const needs = k.needs.filter((n) => n.kind !== "daybook"), state = needs.length ? "needs" : k.line && k.line.state === "open" ? "reading" : "waiting";
  return Object.assign({}, k, { needs, state, word: TALLY_LINK_WORDS[state], level: TALLY_LINK_LEVEL[state] });
}

// clean-up batch 2 (one home for each thing): the Link to Tally card lives in Client setup → Tally; From Tally and the
// Overview show its status line (the state's word, what it means, its one button) and a link to the card
export function goTallyLinkHome() { S.step = null; S.tab = "cotally"; render(); window.scrollTo(0, 0); }
// only (round 63, "Tally messages only where needed"): the states it is shown in (the Overview: not linked or Needs you;
// linked and reading, or waiting, is the top bar's dot)
export function TallyLinkLine({ co, where = "overview", b = null, only = null }) {
  const k = co ? linkHere(co, where === "books" ? "books" : "setup") : null;
  if (!co || !k || (only && !only.includes(k.state))) return null;
  return <section className="tlink tlink-one" data-tally-link-line={k.state} data-tally-link={k.state} aria-label={"Link to Tally: " + k.word}>
    <StatusLine co={co} k={k} where={where} b={b} plain />
    {k.state !== "unlinked" && <button className="linkbtn tlink-home" data-tally-link-home="" onClick={goTallyLinkHome}>{"Tally in Client setup \u2192"}</button>}
  </section>;
}

export default function TallyLink({ co, where = "setup", b = null }) {
  const [name, setName] = useState(false), [wrong, setWrong] = useState("");
  const k = co ? linkHere(co, where) : null, unlinked = !!k && k.state === "unlinked";
  if (!co || !k) return null;
  const cloud = typeof TCloud === "object" && TCloud.on(), may = canWrite();
  const choosing = cloud && (unlinked || (wrong && wrong === k.company));
  return <section className="tlink" data-tally-link={k.state} data-tally-line-state={k.line ? k.line.state : ""} aria-label={"Tally: " + k.word}>
    <div className="tlink-head">
      <h3 className="tlink-title">Tally</h3>
      <More co={co} k={k} onName={() => setName(true)} onChange={() => setWrong(k.company)} />
    </div>
    <StatusLine co={co} k={k} where={where} b={b} />
    {!unlinked && cloud && may && !choosing && <p className="tlink-wrong" data-tally-link-auto={k.auto ? "" : undefined}>
      {k.auto && <span className="note">{"FinCom linked " + k.company + " by itself (same name or GSTIN). "}</span>}
      <button className="linkbtn" data-tally-link-wrong="" onClick={() => setWrong(k.company)}>Not this company?</button></p>}
    {cloud && unlinked && <Suspense fallback={null}><ClientPick co={co} /></Suspense>}
    {choosing && !unlinked && <Chooser co={co} k={k} onDone={() => setWrong("")} />}
    {!unlinked && cloud && !choosing && <Progress co={co} />}
    {k.needs.length > 0 && <ul className="tlink-needs" data-tally-link-needs="">{k.needs.map((n) => { const x = needLine(co, n, k, where, b, isOwner(), () => openTallyFor(co.id));
      return <li key={n.kind} data-tally-need={n.kind}><span>{x.text}</span>{x.act}</li>; })}</ul>}
    {!unlinked && <PostTick co={co} company={k.company} />}
    {name && <NameBox co={co} onClose={() => setName(false)} />}
  </section>;
}
