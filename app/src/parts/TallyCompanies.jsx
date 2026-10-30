// Companies in Tally: THE one place where a Tally company becomes a client, is linked, moved, unlinked and synced
// (24-Oct-2026, next-tally-one-page; the owner: "I was trying to delink Salesify.. after delinking and relinking it is not
// showing.. make it completely like Suvit.. I need a clear page only"; "if there is a company open in Tally, it should
// show in the dropdown always"). Suvit's "My Companies" (help.suvit.io), on the Tally page only:
//   - every company the firm's computers have seen (tally_companies) or have open now (the heartbeats, read every 20 s on
//     the page): ALWAYS listed, open now first, then the latest seen; linked, not linked, linked to another client, just
//     unlinked or never seen before. A company is never left out for its name, a Tally name left on a client, the
//     duplicate guard or a copy kept here; hidden ("Remove company", soft) only while not linked and not open.
//   - one source of truth: the cloud's link record (next-link-record, migration 110: tally_links, laid over the companies'
//     rows by src/js/98-link-record.js; before 110, tally_companies.client_id); every pill comes from lib/tallyState.js.
//     A company renamed in Tally (the same GUID) is one row: the linked row, showing the new name (nowName).
//   - each row: the company, its computer, the pill (linked: Connected / Disconnected with the reason and the fix, or
//     Earlier year when a newer year of the same client is in use; not linked: Not a client), the last entry, ONE action
//     and ⋯:
//       not linked      Add as client / Link to <client of the same name or GSTIN> / New year of <client> · Link (a newer
//                       year's company beside the one before, the client already chosen) / Link to <client> (from a
//                       client's "Choose on Tally page"); ⋯ Link to a client…, Remove company (not open)
//       linked          the client, Sync now (masters and vouchers); ⋯ Sync master, Sync vouchers, Post entries here,
//                       Link to another client (moves it: asked once), Unlink, Upload older entries (Day Book: only while
//                       days of this year are missing), Open client
//       another client  (from a client's "Choose on Tally page") Linked to X · Move here (asked once)
//   - a company open in Tally that its computer has not sent to FinCom's cloud yet (a new company: tally_company_link
//     says "no computer has reported it yet"): the click is kept and done by itself as soon as the computer sends it
//     (on 24-Oct-2026 the owner's two clicks on "Salesify Marketing LLP 2026-27" were refused that way and lost).
//     next-tally-linknow (28-Oct-2026): a company OPEN in Tally is registered and linked at the click (tally-ingest
//     "link_now"); only a company no computer has open now waits for its computer this way.
// Nothing new is asked of the bridge, the cloud or Tally: the same RPCs, wake and reads as before.
import React, { useState, useEffect, Suspense } from "react";
import { seenWords, tallyCoState, tallyDevs, openOn, pcOf, pcLive, coKey, coRows, spacesOdd, lastEntry } from "../lib/tallyState.js";
import "./tallyCompanies.css";
import "../../../src/js/96-bank-sent-heal.js";
import "../../../src/js/98-link-record.js";
import "../../../src/js/97-postto-link.js";
import LinkStatus from "./LinkStatus.jsx";
import { LedgerDrop } from "./Bell.jsx";
import { linkWord } from "../lib/linkStatus.js";
import { cloudKnows, linkNow } from "../lib/tallyConnect.js";
// next-tally-linknow: the companies being sent to FinCom and linked now (coKey: true), for the rows' words
export const SENDING = {};

const SEARCH_AT = 10, POLL_MS = 10000, STUCK_MS = 3 * 60000, PEND_MS = 10 * 60000;
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
const live = () => Object.values(S.companies || {}).filter((c) => c && !c.deleted);
const nOf = (n, one, many) => Number(n).toLocaleString("en-IN") + " " + (n === 1 ? one : many);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
const yearKey = (n) => (typeof tallyYearKey === "function" ? tallyYearKey(n) : coKey(n));

// ---------- what FinCom holds of a client's books (the cloud's book, tally_status; its ledgers' count, tally_ledgers)
export const d8Of = (x) => String(x || "").replace(/-/g, "").slice(0, 8);
export function fyStart() { const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0); return y + "0401"; }
export const cloudBook = (cid) => (typeof TCloud === "object" && TCloud.on() && TCloud.book ? TCloud.book(cid) : null);
// next-tally-firstlink: the client's book for its LEDGERS, also before any entry came in. TCloud.book is the book with a
// first day (tally_books.from_date), which a company whose ledgers came but no Day Book yet does not have (staging,
// 24-Oct-2026: ITSEasy Solutions and VMS EVENTS, ledgers in, from_date null); the bar then never saw the ledgers, their
// count or the bridge's progress, and after 10 minutes said "Ledgers not received". tally_status lists every book.
export const ledBook = (cid) => { const b = cloudBook(cid); if (b) return b;
  const s = typeof TCloud === "object" && TCloud.on() && TCloud.st ? TCloud.st[cid] : null;
  return (s && Array.isArray(s.books) && (s.books.find((x) => x && x.book && x.ledgersAt) || s.books.find((x) => x && x.book))) || null; };
// round 64: the cloud's own count of a client's ledgers, kept with its books (TCloud.st[cid].ledN) for a minute
export const LED_N = { get: (cid) => ((TCloud.st || {})[cid] || {}).ledN, set: (cid, v) => { (TCloud.st[cid] = TCloud.st[cid] || {}).ledN = v; } };
export async function cloudLedgerCount(cid, force, maxAge) {
  const bk = ledBook(cid);
  if (!bk || !bk.book) return null;
  const k = LED_N.get(cid);
  if (!force && k && k.book === bk.book && Date.now() - k.at < (maxAge || 60000)) return k.n;
  const path = "tally_ledgers?select=name&merged_into=is.null&limit=1&book_id=eq." + encodeURIComponent(bk.book);
  const ask = (pp) => Cloud.api(pp, { headers: { Prefer: "count=exact" }, count: true });
  let n;
  try { n = await ask(path + (TCloud.hasDel === false ? "" : "&deleted_at=is.null")); }
  catch (e) { if (!/deleted_at|42703/i.test(String((e && e.message) || e))) throw e; n = await ask(path); }
  n = Array.isArray(n) ? n.length : Math.max(0, Math.floor(Number(n) || 0));
  LED_N.set(cid, { n, at: Date.now(), book: bk.book });
  return n;
}
export const ledgersOf = (cid) => Math.max(typeof Ledgers === "object" ? Ledgers.status(cid).n || 0 : 0, (LED_N.get(cid) || {}).n || 0);
export const ledgersHeld = (cid) => ledgersOf(cid) > 0 || !!(ledBook(cid) || {}).ledgersAt;
export function daybookHeld(cid) {
  const bk = cloudBook(cid), fy = fyStart();
  if (bk && Number(bk.days) > 0 && d8Of(bk.to) >= fy) return true;
  const b = S.books && S.books.cid === cid ? S.books : null;
  return !!(b && (b.vouchers || []).some((v) => v && String(v.date) >= fy));
}
// "Apr–Oct 2026" / "Dec 2025–Jan 2026": the months of entries FinCom holds
export function entriesWords(bk) {
  const f = d8Of(bk && bk.from), t = d8Of(bk && bk.to);
  if (!/^\d{8}$/.test(t)) return "";
  const m = (x) => MON[Number(x.slice(4, 6)) - 1], from = /^\d{8}$/.test(f) && f <= t ? f : t;
  return from.slice(0, 4) === t.slice(0, 4) ? (m(from) === m(t) ? m(t) + " " + t.slice(0, 4) : m(from) + "–" + m(t) + " " + t.slice(0, 4)) : m(from) + " " + from.slice(0, 4) + "–" + m(t) + " " + t.slice(0, 4);
}
// days of this year not in FinCom: none at all, or days Tally did not give (Rec.gapFor)
export function oldDaysMissing(cid) {
  const s = (TCloud.st || {})[cid];
  if (!s || !s.at) return false;
  const gaps = typeof Rec === "object" && Rec.gapFor ? (Rec.gapFor(cid) || []).length : 0;
  return gaps > 0 || !daybookHeld(cid);
}
// Books › From Tally's Upload, for a client (JobsNote there says how far the server has read a Day Book)
export function openFromTally(cid) {
  const h = "#/c/" + encodeURIComponent(cid) + "/from-tally";
  if (typeof history !== "undefined") { try { history.pushState(null, "", location.pathname + location.search + h); } catch (e) { /* */ } }
  if (typeof Route === "object" && Route.apply) Route.apply(h); else openCompany(cid).then(() => { S.tab = "books"; S.booksTab = "import"; render(); });
}
// the linked clients' books, read a few at a time (each kept 5 minutes; TCloud.status keeps each 30 seconds)
let booksBusy = false;
export function booksLoad(cids) {
  if (booksBusy || typeof TCloud !== "object" || !TCloud.on()) return;
  const want = cids.filter((cid) => { const s = TCloud.st[cid]; return !s || !s.at || Date.now() - s.at > 300000; }).slice(0, 25);
  if (!want.length) return;
  booksBusy = true;
  // (a read that leaves no time behind is kept as read now, so the list does not ask again at every drawing)
  const stamp = (cid) => { const s = TCloud.st[cid] = TCloud.st[cid] || {}; if (!s.at) s.at = Date.now(); };
  Promise.all(want.map((cid) => Promise.resolve(TCloud.status(cid)).then(() => (ledgersOf(cid) > 0 ? null : cloudLedgerCount(cid))).catch(() => null).finally(() => stamp(cid))))
    .finally(() => { booksBusy = false; render(); });
}


// ---------- the companies
// [{company (the exact name, as the cloud keeps it), gstin, client (id or ""), device, seen, open (open in Tally now),
// reported (the cloud has its row: it can be linked), st (tallyCoState)}], once each (spaces collapsed), open first
const hidden = () => new Set([].concat((S.firm && S.firm.tallyHidden) || []));
// next-bridge-follows-login (27-Oct-2026; the owner saw IX DESIGNS, another login's company, in firm ABC as "Not a client"):
// a computer revoked, or one whose bridge moved away to another login (tally_devices.info.movedAway, migration 115); a
// device the firm's computers no longer list (TLight drops revoked ones) counts too, once they were read
export function deviceGone(id) {
  if (!id) return false;
  const all = [].concat((typeof TLight === "object" && TLight.st.devs) || [], (TCloud.pane || {}).devices || []).filter((d) => d && d.id === id);
  // movedAway.revoked false (tally_bridge_follow_move): the key was left, another bridge still sends with it, so its
  // companies are not from a removed computer
  if (all.some((d) => d.revoked || (d.info && d.info.movedAway && d.info.movedAway.revoked !== false))) return true;
  return !all.length && typeof TLight === "object" && !!TLight.st.loaded && (TLight.st.devs || []).length > 0;
}
// opts.hidden: the companies removed from the list too; opts.gone: a company no client has whose computer was removed or
// moved away (behind "From a removed computer (n)"); a linked one stays, marked "computer moved" (moved)
export function companyRows(opts) {
  const by = new Map(), put = (name, x) => { const k = coKey(name); if (!k) return; const r = by.get(k) || { company: String(name), gstin: "", client: "", device: "", seen: "", open: false, reported: false, nowName: "" };
    if (x.reported && !r.reported) r.company = String(name);   // the link names the company exactly as the cloud has it
    by.set(k, Object.assign(r, { gstin: r.gstin || x.gstin || "", client: r.client || x.client || "", device: r.device || x.device || "", seen: [r.seen, x.seen || ""].sort().pop(), open: r.open || !!x.open, reported: r.reported || !!x.reported, nowName: r.nowName || x.nowName || "" })); };
  // next-link-record: a name a computer has open that is a linked company's new name in Tally goes on that company's row
  const LR = typeof LinkRec === "object" && LinkRec.ready() ? LinkRec : null, rowOf = (n) => { const x = LR && LR.renamedOf(n); return x ? x.company_name : n; };
  [].concat((typeof TLight === "object" && TLight.st.cos) || [], (TCloud.pane || {}).companies || [])
    .forEach((r) => { if (!r || !r.company || (LR && !r.rec && LR.renamedOf(r.company))) return;
      const now = LR && r.rec ? LR.nameOf(r.rec) : "";
      put(r.company, { gstin: r.gstin, client: String(r.client_id || ""), device: r.device_id || "", seen: r.last_seen || "", reported: true, nowName: now && coKey(now) !== coKey(r.company) ? now : "" }); });
  tallyDevs().forEach((d) => { if (pcLive(d)) openOn(d).forEach((n) => put(rowOf(n), { device: d.id, seen: ((d.info || {}).beat || {}).at || "", open: true })); });
  try { if (typeof Bridge === "object" && Bridge.up()) [].concat(Bridge.st.open || []).forEach((o) => { if (o && o.name) put(rowOf(o.name), { open: true }); }); } catch (e) { /* no bridge here */ }
  const hid = hidden();
  // a client removed (here, on another computer, or as the cloud says: clientRemoved): its company is Not linked, free to
  // link (next-fix-clientremove: it read "Linked to a client not on this computer", with no Link to client…)
  const gone = (id) => (typeof clientRemoved === "function" ? clientRemoved(id) : !!(S.companies && S.companies[id] && S.companies[id].deleted));
  let rows = [...by.values()].map((r) => Object.assign(r, { client: r.client && gone(r.client) ? "" : r.client, st: tallyCoState(r.company) }))
    .map((r) => Object.assign(r, { open: r.open || r.st.state === "connected", hidden: !r.client && !r.open && hid.has(coKey(r.company)) }))
    .map((r) => { const g = !r.open && deviceGone(r.device); return Object.assign(r, { gone: g && !r.client, moved: g && !!r.client }); });
  if (!(opts && opts.hidden)) rows = rows.filter((r) => !r.hidden);
  if (!(opts && opts.gone)) rows = rows.filter((r) => !r.gone);
  return rows.sort((a, b) => (b.open - a.open) || String(b.seen).localeCompare(String(a.seen)) || a.company.localeCompare(b.company));
}
// a client of the same name (the period off) or the same GSTIN, already in FinCom: the row links to it, never a second one
export function twinOf(r) {
  if (typeof similarClients !== "function") return null;
  const name = typeof clientNameFromTally === "function" ? clientNameFromTally(r.company) : r.company;
  const t = similarClients(name, r.gstin || "", live()).find((d) => d.why === "same" || d.why === "gstin");
  return t ? t.client : null;
}
// a newer (or older) year of a company already linked: the same business once the period is off (Suvit: a split or a
// year's copy of a company), its client already chosen
export function yearOf(r, rows) {
  if (r.client) return null;
  const k = yearKey(r.company);
  if (!k) return null;
  const x = (rows || companyRows()).find((o) => o.client && o.company !== r.company && yearKey(o.company) === k && S.companies[o.client] && !S.companies[o.client].deleted);
  return x ? S.companies[x.client] : null;
}
// the clients ranked for a company: the same GSTIN, the same name, then alike, then the rest by name
function rankClients(r, skip) {
  const g = String(r.gstin || "").toUpperCase(), nm = (c) => (typeof sameTallyName === "function" && sameTallyName(c.name, r.company) ? 2 : typeof nameScore === "function" ? nameScore(c.name, r.company) : 0);
  return live().filter((c) => c.id !== skip).map((c) => ({ c, s: (g && String(c.gstin || "").toUpperCase() === g ? 3 : 0) + nm(c) }))
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name)).map((x) => x.c);
}

// ---------- the actions
// the link (tallyLinkClient: tally_company_link, then the client's Tally name hint). opts: keep (a year beside the one
// before), move (the company leaves another client: the person said so)
export async function linkClient(company, cid, opts) {
  const D = typeof Drafts === "object" && Drafts.secs ? Drafts : null;
  if (D) D.attributeAll();
  // next-tally-linknow: a company FinCom's cloud has no row for yet (open in Tally, its computer's 5-minute report not in
  // yet) is registered and linked by tally-ingest in one call; then the usual link below (the same link: nothing changes)
  if (cid && !cloudKnows(company)) {
    const k0 = coKey(company), E0 = (S.tcoErr = S.tcoErr || {});
    SENDING[k0] = true; render();
    // a client just made here reaches the cloud first (the link checks it there), as tallyLinkClient does
    try { if (typeof cloudPushNow === "function") await cloudPushNow(); } catch (e) { /* the link says why */ }
    try { await linkNow(company, cid); delete E0[k0]; }
    catch (e) { TCloud.linkErr = String((e && e.message) || e); E0[k0] = TCloud.linkErr; toast("Could not link it: " + TCloud.linkErr); return false; }
    finally { delete SENDING[k0]; render(); }
  }
  const ok = await tallyLinkClient(company, cid, opts);
  if (ok && D && cid) {
    Object.values(D.secs).forEach((s) => { if (s.paths) s.paths.forEach((c, k) => { if (c && c.path && c.path[0] === "tallyName") s.paths.delete(k); }); if (s.armed && s.stores) s.pre = s.stores.map((st) => st.snap()); });
    const co = S.companies[cid]; if (co) D.direct(() => Store.saveCompany(co), { bypass: true });
  }
  const k = coKey(company), E = (S.tcoErr = S.tcoErr || {});
  if (ok) delete E[k]; else if (TCloud.linkErr) E[k] = TCloud.linkErr;
  return ok;
}
// Add as client: made with the company's name and GSTIN, linked, the first sync started; the page stays (Suvit's list).
// Returns the client's id, or "" when nothing was added.
export async function addAsClient(r) {
  const tw = twinOf(r);
  if (tw) return (await linkTo(r, tw)) ? tw.id : "";
  const name = typeof clientNameFromTally === "function" ? clientNameFromTally(shown(r.company)) : shown(r.company);
  const g = String(r.gstin || "").trim().toUpperCase(), gstin = g && typeof gstinValid === "function" && gstinValid(g) ? g : "";
  const co = newCompany({ name, gstin, tallyName: r.company, turnover10cr: false });
  S.companies[co.id] = co; S.data[co.id] = { parties: {}, entries: {}, loaded: true };
  co.stats = { drafts: 0, check: 0, waiting: 0, tdsFy: 0, invoicesFy: 0, records: 1, fy: fyOf(null) };
  Store.saveCompany(co);
  render();
  const ok = await linkClient(r.company, co.id);
  if (!ok) { toast(name + " was added; link it to " + shown(r.company) + " from its row."); return co.id; }
  firstSync(co.id, r.company);
  return co.id;
}
// Link (to a client already in FinCom). The client linked to another company: a newer year of it is linked beside it
// (opts.keep); any other company is asked first (it moves). A company linked to another client moves only with opts.move.
export async function linkTo(r, co, opts) {
  opts = Object.assign({}, opts);
  const was = typeof tallyLinkOf === "function" ? (tallyLinkOf(co) || {}).company || "" : "";
  if (was && coKey(was) !== coKey(r.company)) {
    if (yearKey(was) === yearKey(r.company)) opts.keep = true;
    else if (!opts.asked) {
      const ok = await askConfirm({ title: "Link " + co.name + " to " + shown(r.company) + "?", ok: "Link this company",
        body: "<p>" + esc(co.name) + " is linked to <b>" + esc(was) + "</b> now. It will be linked to <b>" + esc(shown(r.company)) + "</b> instead, and " + esc(was) + " unlinked. Nothing in Tally changes.</p>" });
      if (!ok) return false;
    }
  }
  const ok = await linkClient(r.company, co.id, opts);
  if (ok) firstSync(co.id, r.company);
  return ok;
}
// a company linked to another client, moved to this one: asked once
export async function moveTo(r, co) {
  const from = S.companies[r.client];
  // asked once: what the client it goes to had linked is said in the same question (a year of it stays beside it)
  const was = typeof tallyLinkOf === "function" ? (tallyLinkOf(co) || {}).company || "" : "", also = was && coKey(was) !== coKey(r.company) && yearKey(was) !== yearKey(r.company);
  const ok = await askConfirm({ title: "Move " + shown(r.company) + " to " + co.name + "?", ok: "Move it",
    body: "<p><b>" + esc(shown(r.company)) + "</b> is linked to <b>" + esc((from && from.name) || "another client") + "</b> now. Its books will go to <b>" + esc(co.name) + "</b> instead" + (also ? ", and " + esc(was) + " is unlinked from " + esc(co.name) : "") + ". Nothing in Tally changes.</p>" });
  if (!ok) return false;
  return linkTo(r, co, { move: true, asked: true });
}
export const unlink = (r) => {
  const co = S.companies[r.client];
  return askConfirm({ title: "Unlink " + shown(r.company) + " from " + ((co && co.name) || "its client") + "?", ok: "Unlink", danger: true,
    // next-fix-tally-links2 (the owner: "I have unlinked the tally but clients also erased"): said plainly
    body: "<p><b>The client stays in FinCom; only the link to Tally is removed.</b> Its books stop coming to " + esc((co && co.name) || "the client") + " from " + esc(shown(r.company)) + " until it is linked again. Nothing in Tally changes.</p>" })
    .then((ok) => (ok ? linkClient(r.company, null) : false));
};
// Change Tally company… (next-fix-tally-links, 29-Oct-2026; the owner: "I am not able to see and change the tally
// company"): the client linked to another company FinCom has seen for the firm, by the same link as every other
// (linkClient: link_now for a company the cloud has no row for yet, then tallyLinkClient, which lets the client's old
// company go); asked once only when the company is another client's; then Update now (syncNow), as after any link
export async function changeTo(co, r) {
  const other = r.client && r.client !== co.id, was = typeof tallyLinkOf === "function" ? (tallyLinkOf(co) || {}).company || "" : "";
  if (other) {
    const o = S.companies[r.client];
    const ok = await askConfirm({ title: "Link " + co.name + " to " + shown(r.company) + "?", ok: "Link this company",
      body: "<p><b>" + esc(shown(r.company)) + "</b> is linked to <b>" + esc((o && o.name) || "another client") + "</b> now. It will be linked to <b>" + esc(co.name) + "</b> instead"
        + (was && coKey(was) !== coKey(r.company) ? ", and " + esc(shown(was)) + " unlinked from " + esc(co.name) : "") + ". Nothing in Tally changes.</p>" });
    if (!ok) return false;
  }
  const ok = await linkClient(r.company, co.id, other ? { move: true } : {});
  if (ok) syncNow(co.id, r.company);
  return ok;
}
// the picker: every company FinCom has seen for the firm, open in Tally now first, then the others with when they were
// last seen; a company of another client says whose it is (no computer's name)
export function ChangePick({ co, cur = "", onClose }) {
  const [pick, setPick] = useState(""), [busy, setBusy] = useState(false);
  const rows = companyRows({ hidden: true }).filter((r) => coKey(r.company) !== coKey(cur));
  const label = (r) => { const o = r.client && r.client !== co.id ? S.companies[r.client] : null;
    return shown(r.nowName || r.company) + (o ? " — linked to " + o.name : r.client && r.client !== co.id ? " — linked to another client" : "") + (!r.open && r.seen ? " · last seen " + seenWords(r.seen) : ""); };
  const opt = (r) => <option key={r.company} value={r.company}>{label(r)}</option>, open = rows.filter((r) => r.open), rest = rows.filter((r) => !r.open);
  const go = async () => { const r = rows.find((x) => x.company === pick); if (!r) return; setBusy(true); let ok = false;
    try { ok = await changeTo(co, r); } finally { setBusy(false); } if (ok && onClose) onClose(); };
  return <div className="tco-relink tlk-pick" data-tlk-pick-box={co.id}>
    <span className="note">{"Tally company for " + co.name + ":"}</span>
    <select data-tlk-pick="" aria-label={"The Tally company for " + co.name} value={pick} onChange={(ev) => setPick(ev.target.value)}>
      <option value="">Choose a Tally company…</option>
      {open.length > 0 && <optgroup label="Open in Tally now">{open.map(opt)}</optgroup>}
      {rest.length > 0 && <optgroup label="Seen earlier">{rest.map(opt)}</optgroup>}</select>
    <button className="btn small primary" data-tlk-go="" disabled={!pick || busy} onClick={go}>{busy ? (SENDING[coKey(pick)] ? "Sending to FinCom…" : "Linking…") : "Link"}</button>
    <button className="linkbtn" data-tlk-cancel="" onClick={onClose}>Cancel</button>
    {!rows.length && <span className="note" data-tlk-pick-none="">No other company seen yet: open it in TallyPrime and it shows here within a minute.</span>}</div>;
}
// Remove company (Suvit: an unused company taken off the list): hidden, never deleted; Show hidden puts it back
export function hideCo(r, on) {
  const k = coKey(r.company), h = hidden();
  if (on) h.add(k); else h.delete(k);
  S.firm.tallyHidden = [...h]; try { Store.saveFirm(); } catch (e) { /* kept here */ }
  render();
}
// Post entries here: the client's one posting company (choiceConfirm postTo, asked first; nothing is posted without it)
export function postHere(co, company, on) {
  const v = on ? company : "";
  // next-link-record: the company's link record (tally_link_posting), asked first as before
  const rec = typeof LinkRec === "object" && LinkRec.ready() ? LinkRec.forClient(co.id).find((x) => LinkRec.isName(x, company)) : null;
  if (rec) return askConfirm({ title: on ? "Post " + co.name + "’s entries into " + shown(LinkRec.nameOf(rec)) + "?" : "Stop posting for " + co.name + "?", ok: on ? "Allow" : "Stop posting",
    body: on ? "<p>FinCom and the bridge will post this client’s bills, bank lines and sales into the Tally company <b>" + esc(shown(LinkRec.nameOf(rec))) + "</b>. A posting meant for any other company is refused.</p>"
      : "<p>Nothing will be posted for this client into " + esc(shown(LinkRec.nameOf(rec))) + " until posting is allowed again.</p>" })
    .then((ok) => (ok ? linkPostingSet(co, rec, on) : false));
  return askConfirm({ title: v ? "Post " + co.name + "’s entries into " + shown(v) + "?" : "Stop posting for " + co.name + "?", ok: v ? "Allow" : "Stop posting",
    body: v ? "<p>FinCom and the bridge will post this client’s bills, bank lines and sales <b>only</b> into the Tally company <b>" + esc(shown(v)) + "</b>. A posting meant for any other company is refused.</p>"
      : "<p>Nothing will be posted for this client until a company is chosen again.</p>" })
    .then((ok) => { if (!ok) return; choiceConfirm(co, "postTo", v); if (S.postStop && S.postStop.cid === co.id) S.postStop = null; toast(v ? "Posting allowed into " + shown(v) + "." : "Posting stopped."); render(); });
}
export const postsHere = (co, company) => { if (typeof LinkRec === "object" && LinkRec.ready()) return LinkRec.forClient(co.id).some((x) => x.posting_allowed && LinkRec.isName(x, company));
  const pc = typeof choiceGet === "function" ? choiceGet(co, "postTo") : null; return !!(pc && pc.state === "confirmed" && co.postTo && coKey(co.postTo) === coKey(company)); };
// Sync master (Suvit): the existing "Send ledgers and groups now" (TCloud.sendLedgers: the bridge here, and the Tally
// computer asked through the cloud) with the ledgers' wake and its progress (firstSync)
export function syncMaster(cid, company) { if (TCloud.sendLedgers) TCloud.sendLedgers(cid); firstSync(cid, company); }
// what the support tools said for this client, on its row (was Settings › Books in the cloud): what is in the cloud, and
// the kept day books read again
function CloudSays({ cid }) {
  const p = TCloud.pane || {}, g = (p.gs || {})[cid], r = (p.rp || {})[cid];
  const jb = r && r.job && TCloud.jobs ? (TCloud.jobs[cid] || []).find((x) => x.id === r.job) : null;
  return <>
    {g && <p className={"note" + (g.err ? " bad" : "")} data-tco-cloud-says={cid} style={{ margin: "2px 0 0" }}>{g.err ? g.err : g.none ? "No books in the cloud yet."
      : "In the cloud: " + g.groups + " groups · " + g.grouped + " of " + g.ledgers + " ledgers with a group" + (g.pl ? " (and Profit & Loss A/c, which has no group in Tally)" : "")}</p>}
    {r && <p className={"note" + (r.err || (jb && jb.status === "failed") ? " bad" : "")} data-rp={cid} style={{ margin: "2px 0 0" }}>{r.job ? (jb ? TCloud.jobLine(jb) : "handed to FinCom’s server (" + r.months + " months)…")
      : r.err ? "Could not read again: " + r.err + (r.n ? " (" + r.n + " days done)" : "") : r.busy ? "reading again… " + r.n + " days so far"
      : "read again: " + Number(r.n || 0).toLocaleString("en-IN") + " day" + (Number(r.n) === 1 ? "" : "s") + " of " + Number(r.months || 0) + " month" + (Number(r.months) === 1 ? "" : "s") + ", " + fmtTime(r.at) + (r.bad ? ", " + r.bad + " could not be read" : "") + (r.host ? " (cloud " + r.host + ")" : "")}</p>}
  </>;
}
// Sync now: Suvit's two syncs at once (the masters: the ledgers' wake; the vouchers: Update now)
export function syncNow(cid, company) { firstSync(cid, company); tallyUpdateNow(cid); }   // (tallyUpdateNow asks tally_want_update, as Send ledgers does)

// a click on a company its computer has not sent to FinCom's cloud yet: kept, and done by itself when it is sent
// S.tcoPend[key] = {company, kind: add | link | move, cid, keep, at, late}
const PEND = () => (S.tcoPend = S.tcoPend || {});
function keep(r, job) { PEND()[coKey(r.company)] = Object.assign({ company: r.company, at: Date.now(), late: false }, job); if (typeof TLight === "object") TLight.st.at = 0; render(); }
function doJob(r, job) {
  const co = job.cid ? S.companies[job.cid] : null;
  return job.kind === "add" ? addAsClient(r) : job.kind === "move" && co ? moveTo(r, co) : co ? linkTo(r, co, { keep: job.keep }) : Promise.resolve(false);
}
let pendBusy = false;
function pendTick(rows) {
  const P = PEND();
  Object.entries(P).forEach(([k, job]) => {
    const r = rows.find((x) => coKey(x.company) === k);
    if (r && r.reported && !pendBusy) { delete P[k]; pendBusy = true; Promise.resolve(doJob(r, job)).finally(() => { pendBusy = false; render(); }); }
    else if (!job.late && Date.now() - job.at > PEND_MS) { job.late = true; render(); }
  });
}

// the first sync of a client just added or linked (Suvit: "the first sync starts by itself"): the ledgers wake (one call,
// Ledgers.askTally: the bridge here when it has the company open, else FinCom's cloud, tally-ingest's wake "ledgers"),
// then FinCom's cloud is read every 10 seconds until the ledgers and this year's entries are in (10 minutes at most).
// S.tcoSync[cid] = {cid, company, at, via, err, end, late, led, prog}
const SYNC = () => (S.tcoSync = S.tcoSync || {});
// next-tally-firstlink (the owner, 24-Oct-2026: "Automatic master ledger import is also not working.. a smart bar like 34
// out of 342 completed.. currently it runs and after some time it fails"). The ledgers came in about a second (staging:
// tally_ledger_rounds complete, tally_ledger_progress done) but the bar waited for this year's ENTRIES as well (a Day Book,
// days_at), which a company of an earlier year, or one not read yet, never has: after 10 minutes it said it failed. Now:
//   - the bar is the ledgers' only: "34 of 342 ledgers" from the bridge's progress (2.4.5 ledger_progress, kept by
//     tally-ingest in tally_ledger_progress, read with tally_period_status's ledger), the bar's width that share;
//   - done when THIS read is done: its progress says done, or the book's ledger time (tally_books.ledgers_at) moved; a
//     read that sent only the changed ledgers (rows_received < rows_read) is done the same way (both are set by it). What
//     was there before the click (snapshot ledger0 / la0) never counts, whatever the clocks say;
//   - then "342 ledgers imported ✓ at 16:20"; this year's entries are said beside it, and never make it fail;
//   - no progress yet: after 30 seconds the plain reason from the computer's beat (offline, Tally not open, the company
//     not open, reading paused or stopped), and after 10 minutes that reason, not a guess.
async function ledgerNow(cid) {
  const bk = ledBook(cid); if (!bk || !bk.book) return null;
  const p = await TCloud.rpc("tally_period_status", { p_book: bk.book });
  return (p && p.ledger) || null;
}
const sameLp = (a, b) => !!a && !!b && a.round === b.round && String(a.at) === String(b.at) && Number(a.read) === Number(b.read) && !!a.done === !!b.done;
export async function firstSync(cid, company) {
  const x = SYNC()[cid] = { cid, company: company || "", at: Date.now(), via: "", err: "", end: 0, late: false, led: null, prog: null, ledAt: 0, why: "", snap: false, ledger0: null, la0: "", moveAt: 0, samples: [] };
  render();
  // what is there before this read (so an earlier read never counts as this one's)
  try { await TCloud.status(cid, true); } catch (e) { /* the time check below then */ }
  // (no book yet: nothing to compare with, so the time since the click decides)
  try { const b0 = ledBook(cid); x.la0 = String((b0 || {}).ledgersAt || ""); x.ledger0 = b0 ? await ledgerNow(cid) : null; x.snap = !!b0; } catch (e) { x.snap = false; }
  let r;
  try { r = await Ledgers.askTally(cid); } catch (e) { r = { err: (e && e.message) || String(e) }; }
  const a = (r && r.ans) || {};
  x.via = (r && r.via) || "";
  if (r.err) x.err = "Could not ask Tally: " + r.err;
  else if (!r.via) x.err = "FinCom’s cloud does not reach the Tally computer: sign in to the firm account.";
  else if (r.via === "bridge" && a.started === false && !a.debounced) x.err = "FinCom Bridge did not read " + (x.company || "the company") + "’s ledgers: " + (a.why || "it did not start") + ".";
  else if (r.via === "cloud" && a.notLinked) x.err = "The client is not linked to its company in Tally yet.";
  // nobody asked (and not because one was asked a moment ago): no computer holds the company now
  else if (r.via === "cloud" && a.woken !== undefined && !Number(a.woken) && (a.asked === undefined ? !Number(a.debounced) : !Number(a.asked)))
    x.err = "No computer with Tally was asked: FinCom has no computer that holds " + (x.company || "the company") + " now. Open it in TallyPrime on the Tally computer, with FinCom Bridge running; then Try again.";
  render();
  setTimeout(() => syncPoll(cid), 1500);
}
const polling = {};
export async function syncPoll(cid) {
  const x = SYNC()[cid];
  if (!x || x.end || x.err || x.late || polling[cid]) return;
  polling[cid] = true;
  try {
    try { await TCloud.status(cid, true); } catch (e) { /* the next read */ }
    let n = null; try { n = await cloudLedgerCount(cid, true); } catch (e) { /* */ }
    let lp = null; try { lp = await ledgerNow(cid); } catch (e) { /* */ }
    const since = x.at - 60000, la = String((ledBook(cid) || {}).ledgersAt || "");
    // this read's progress: not the one there before the click (or, with no snapshot, one from since the click)
    const fresh = lp && (x.snap ? !sameLp(lp, x.ledger0) : Date.parse(lp.at) >= since);
    if (fresh) {
      // 26-Oct-2026: each new count the bridge reports is a sample (the time left comes from the rate between them)
      const rd = Number(lp.read) || 0, last = x.samples[x.samples.length - 1];
      if (!last || rd !== last.read) { x.samples.push({ t: Date.now(), read: rd }); x.moveAt = Date.now(); }
      x.prog = lp;
    }
    const laNew = !!la && (x.snap ? la !== x.la0 : Date.parse(la) >= since);
    if (!x.ledAt && ((x.prog && x.prog.done) || laNew)) {
      x.ledAt = (x.prog && x.prog.done && Date.parse(x.prog.at)) || Date.parse(la) || Date.now();
      x.led = (x.prog && x.prog.done && Number(x.prog.read) > 0 ? Number(x.prog.read) : 0) || (n > 0 ? n : 0) || ledgersOf(cid) || -1;
    }
    if (n != null && n > 0 && x.ledAt && !(x.led > 0)) x.led = n;
    if (x.ledAt) x.end = Date.now();
    else {
      // the beat's plain reason after 30 seconds without a count (the read goes on by itself once it is fixed); no progress
      // for 3 minutes: stuck, with Try again (never a bar that runs for ever)
      x.why = Date.now() - x.at > 30000 && Date.now() - (x.moveAt || x.at) > 30000 ? stallWhy(cid, x.company) : "";
      if (Date.now() - (x.moveAt || x.at) > STUCK_MS) x.late = true;
    }
  } finally { polling[cid] = false; render(); }
}
// why nothing comes, from the computer's beat (plain words; "" when its beat says all is well)
export function stallWhy(cid, company) {
  const co = S.companies && S.companies[cid], name = company || (co && (co.tallyName || co.name)) || "the company";
  const rows = coRows(name), devs = tallyDevs();
  const d = devs.find((v) => rows.some((r) => r.device_id === v.id)) || (devs.length === 1 ? devs[0] : null);
  if (!d) return "No computer with FinCom Bridge holds " + name + " yet: open it in TallyPrime on the Tally computer.";
  const pc = pcOf(d), b = ((d.info || {}).beat) || {};
  if (!pcLive(d)) return "FinCom Bridge on " + pc + " is offline: turn that computer on and sign in to Windows; the ledgers come as soon as it is back.";
  if (b.readStopped) return "Reading is stopped on " + pc + (b.readStopped.reason ? " (" + b.readStopped.reason + ")" : "") + ": an owner can resume it on the Tally page.";
  if (b.paused) return "Reading is paused on " + pc + ": right-click the FinCom icon near the clock → Resume background reading.";
  if (!(b.tally === true || b.tallyState === "open" || b.tallyState === "busy")) return "Tally is not open on " + pc + ": open TallyPrime there with " + name + ".";
  if (b.tallyState === "busy") return "Tally is busy on " + pc + ": FinCom carries on when it is free.";
  if (!openOn(d).some((o) => coKey(o) === coKey(name))) return name + " is not open in Tally on " + pc + ": open it in TallyPrime; the ledgers come within a minute.";
  return "";
}

// ---------- the ledgers' ONE bar (26-Oct-2026; the owner: "ledgers stay automatic through the bridge, but the progress
// must be a clear, smart bar"), on the company's row (Companies in Tally), Books › From Tally and the Ledgers page:
//   reading   "Reading ledgers from Tally: 312 of 1,240 (25%) · about 1 min left" (a filled bar; the time left from the rate
//             between the bridge's counts, once two are seen); the total not known yet: "Reading ledgers from Tally… 312
//             so far", the bar moving;
//   done      "1,240 ledgers from Tally ✓ · 10:42", green, one line;
//   stuck     no count for 3 minutes, or the computer's beat says why (Tally closed, the company not open, the computer
//             offline, Tally busy, reading paused or stopped): that reason in one line with Try again (the ledgers-only
//             wake, firstSync); no bar;
//   later     "3 new or changed ledgers and 1 rename from Tally today" (tally_ledger_rounds of today that sent only the
//             changed ledgers, tally_ledgers.renamed_at), only when there are some.
// The masters XML stays as a fallback line under a bar that is reading or stuck.
function Masters({ cid }) {
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  const up = async (ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; if (!f) return;
    setBusy(true); const r = await Ledgers.fromMasters(cid, f); setBusy(false); setRes(r);
    if (r.ok) { LED_N.set(cid, { n: r.n, at: Date.now(), book: (ledBook(cid) || {}).book || "" }); const x = SYNC()[cid]; if (x) { x.led = r.n; if (x.late) x.at = Date.now(); x.late = false; x.err = ""; x.why = ""; x.ledAt = x.end = Date.now(); } render(); } };
  return <span className="note tco-masters" data-tco-masters-line=""><label className="linkbtn" data-tco-masters="" title="TallyPrime: Gateway → Display More Reports → List of Accounts → Alt+E → XML (Masters)">{busy ? "Reading the file…" : "Or upload the masters XML (List of Accounts → Alt+E → XML)"}
    <input type="file" accept=".xml" hidden onChange={up} /></label>
    {res && !res.ok && <span className="bk-warn" data-tco-masters-err="">{" " + res.err}</span>}</span>;
}
// "about 2 min left" from the counts seen so far (at least two), "" until then
function timeLeft(x, of) {
  const sm = (x && x.samples) || [];
  if (sm.length < 2 || !(of > 0)) return "";
  const a = sm[0], z = sm[sm.length - 1], rate = (z.read - a.read) / Math.max(1, z.t - a.t);
  if (!(rate > 0)) return "";
  const ms = (of - z.read) / rate;
  return ms < 60000 ? "less than a minute left" : "about " + Math.ceil(ms / 60000) + " min left";
}
// today's later changes of a client's ledgers (read at most every 5 minutes): {changed, renamed}
const IST_DAY = () => { const t = new Date(Date.now() + 5.5 * 3600e3); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - 5.5 * 3600e3).toISOString(); };
const CHG = {};
function ledgerChanges(cid) {
  const bk = ledBook(cid), k = cid + "|" + ((bk && bk.book) || ""), c = CHG[k];
  if (!bk || !bk.book || typeof Cloud !== "object" || !Cloud.api) return null;
  if (!c || (!c.busy && Date.now() - c.at > 5 * 60000)) {
    const day = encodeURIComponent(IST_DAY()), b = encodeURIComponent(bk.book), was = c ? c.v : null;
    CHG[k] = { at: Date.now(), busy: true, v: was };
    Promise.all([
      Cloud.api("tally_ledger_rounds?select=rows_received,rows_read,complete&book_id=eq." + b + "&started_at=gte." + day + "&complete=is.true").catch(() => []),
      Cloud.api("tally_ledgers?select=name&book_id=eq." + b + "&renamed_at=gte." + day + "&limit=1000").catch(() => []),
    ]).then(([rounds, ren]) => {
      const renamed = [].concat(ren || []).length;
      // a round that sent only some of the ledgers (the changed ones); a full first read is not a change
      const sent = [].concat(rounds || []).filter((r) => r && r.rows_read != null && Number(r.rows_received) < Number(r.rows_read)).reduce((t, r) => t + (Number(r.rows_received) || 0), 0);
      CHG[k] = { at: Date.now(), busy: false, v: { changed: Math.max(0, sent - renamed), renamed } }; render();
    });
  }
  return (CHG[k] || {}).v || null;
}
function LaterLine({ cid }) {
  const v = ledgerChanges(cid);
  if (!v || !(v.changed > 0 || v.renamed > 0)) return null;
  const bits = [v.changed > 0 ? nOf(v.changed, "new or changed ledger", "new or changed ledgers") : "", v.renamed > 0 ? nOf(v.renamed, "rename", "renames") : ""].filter(Boolean);
  return <p className="note tco-later" data-tco-later="">{bits.join(" and ") + " from Tally today"}</p>;
}
// the bar itself. where: "row" (Companies in Tally), "books" (Books › From Tally), "ledgers" (the Ledgers page). With no
// read going on: on Books, what FinCom holds ("1,240 ledgers from Tally ✓ · 10:42") and today's changes; on the row, null
// (its own line says what FinCom holds); on the Ledgers page, only today's changes
export function LedgerBar({ cid, where = "row", company = "" }) {
  const [, tick] = useState(0);
  const x = (S.tcoSync || {})[cid], running = !!(x && !x.end && !x.err && !x.late);
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);
  useEffect(() => { if (!running) return; const t = setInterval(() => syncPoll(cid), POLL_MS); return () => clearInterval(t); }, [running, x && x.at]);
  const co = S.companies && S.companies[cid], n = Math.max(ledgersOf(cid), (x && x.led) || 0), led = ledgersHeld(cid);
  const name = (x && x.company) || company || (typeof TCloud === "object" && TCloud.companyOf ? TCloud.companyOf(cid) : "") || (co && (co.tallyName || co.name)) || "";
  const done = (ln, at) => <p className="tco-sync ok" data-tco-sync="done" data-tco-where={where} role="status">{(ln > 0 ? nOf(ln, "ledger", "ledgers") : "Ledgers") + " from Tally ✓" + (at ? " · " + hm(at) : "")}</p>;
  if (x && x.end) return <>{done(x.led > 0 ? x.led : n, x.ledAt)}{where !== "row" && <LaterLine cid={cid} />}</>;
  const stuck = x && (x.err || x.late || (running && x.why));
  if (stuck) return <div className="tco-sync bad" data-tco-sync="stuck" data-tco-stuck={x.err ? "error" : x.late && !x.why ? "late" : "why"} data-tco-where={where} role="status">
    <span data-tco-sync-why="">{x.err || x.why || stallWhy(cid, name) || "No progress from Tally in 3 minutes: keep " + (name || "the company") + " open in TallyPrime on its computer."}</span>
    <span className="tco-sync-acts"><button className="btn small" data-tco-sync-again={cid} onClick={() => firstSync(cid, name)}>Try again</button></span>
    {!led && <Masters cid={cid} />}</div>;
  if (running) { const of = x.prog ? Number(x.prog.of) || 0 : 0, rd = x.prog ? Math.min(Number(x.prog.read) || 0, of || Infinity) : 0, pct = of > 0 ? Math.round(100 * rd / of) : 0;
    const left = timeLeft(x, of);
    return <div className="tco-sync" data-tco-sync="running" data-tco-where={where} role="status">
      <div className="tco-bar" role="progressbar" aria-label={"Reading " + ((co && co.name) || "the company") + "’s ledgers from Tally"} aria-busy="true"
        {...(of > 0 ? { "aria-valuemin": 0, "aria-valuemax": of, "aria-valuenow": rd, "data-tco-pct": pct } : {})}><i className={of > 0 ? "det" : ""} style={of > 0 ? { width: Math.max(2, pct) + "%" } : undefined} /></div>
      <span data-tco-sync-words="">{of > 0 ? "Reading ledgers from Tally: " + rd.toLocaleString("en-IN") + " of " + of.toLocaleString("en-IN") + " (" + pct + "%)" + (left ? " · " + left : "")
        : "Reading ledgers from Tally…" + (rd > 0 ? " " + rd.toLocaleString("en-IN") + " so far" : "")}
        {x.via === "cloud" && !of && !rd ? <span className="note">{" · the Tally computer picks it up within a minute"}</span> : null}</span>
      {!led && <Masters cid={cid} />}</div>; }
  if (where === "books" && led) { const bk = ledBook(cid) || {}; return <>{done(n, bk.ledgersAt ? Date.parse(bk.ledgersAt) : 0)}<LaterLine cid={cid} /></>; }
  if (where === "ledgers") return <LaterLine cid={cid} />;
  return null;
}
const hm = (ms) => { const t = typeof tallyHm === "function" ? tallyHm(ms) : ""; return String(t || "").replace(/\s*IST$/, ""); };
// words: only the held words, inline on the row's second line (nothing while a read runs: the bar is under the row);
// bar: only the bar of a read going on (next-tally-smart: the two halves of the row)
export function SyncLine({ cid, compact = false, words = false, bar = false }) {
  const x = (S.tcoSync || {})[cid], bk = cloudBook(cid), n = ledgersOf(cid), days = daybookHeld(cid);
  if (x) return words ? null : <LedgerBar cid={cid} where="row" />;
  if (bar) return null;
  const led = ledgersHeld(cid), ent = days ? "Entries " + (entriesWords(bk) || "this year") : "";
  // no first sync here now: what FinCom holds, when known
  if (compact || !(TCloud.st && TCloud.st[cid] && TCloud.st[cid].at)) return null;
  const say = [led ? (n > 0 ? "Ledgers " + Number(n).toLocaleString("en-IN") : "Ledgers in FinCom") : "Ledgers not in FinCom yet", ent || "this year’s entries not in FinCom yet"].join(" · ");
  return words ? <span className="note tco-sync tco-sync-words" data-tco-sync="held">{say}</span> : <p className="note tco-sync" data-tco-sync="held">{say}</p>;
}


// ---------- one row
// the pill: a linked company's state (lib/tallyState.js, the words every place uses), Earlier year when a newer year of
// the same client is in use, Not a client when not linked
function Pill({ r, st, co, earlier, noLine = false }) {
  // Task D (the owner, 28-Oct-2026: "No suggestion to add clients"): a company not linked says so neutrally
  if (!r.client) return <span className="tco-pill" data-tco-pill="notclient" data-tco-pill-text="Not linked">
    <span className="tag">Not linked</span><span className="tco-why">{r.open ? " · open in Tally" : " · not open in Tally now"}</span></span>;
  if (earlier) return <span className="tco-pill" data-tco-pill="earlier" data-tco-pill-text={"Earlier year of " + earlier}>
    <span className="tag">Earlier year</span><span className="tco-why">{" · " + earlier + " is the newer year"}</span></span>;
  // next-link-record: a linked company says the client's one word (Linked / Waiting for Tally / Needs you) and its one line
  const w = co ? linkWord(co, r.company) : null;
  if (w) return <span className="tco-pill" data-tco-pill={st.state} data-tco-pill-text={w.text} data-tco-word={w.kind}>
    <span className={"tag " + w.level}>{w.word}</span>{w.line && !noLine && <span className="tco-why">{w.line}</span>}</span>;
  return <span className="tco-pill" data-tco-pill={st.state} data-tco-pill-text={st.text}>
    <span className={"tag " + st.level}>{st.word}</span>{st.state !== "connected" && !noLine && <span className="tco-why">{st.text.replace(/^Disconnected/, "")}</span>}</span>;
}
// Disconnected, in words: what to do (Suvit: open the company in Tally on its computer)
function fixOf(r, st) {
  const pc = (st.computer || "").split(" · ")[0];
  return st.state === "offline" ? "Turn " + (pc || "the Tally computer") + " on and sign in to Windows: FinCom Bridge starts by itself."
    : st.state === "notopen" ? "Open " + shown(r.company) + " in TallyPrime on " + (pc || "its computer") + "."
    : st.state === "unseen" ? "Open " + shown(r.company) + " in TallyPrime on the computer with FinCom Bridge." : "";
}
// the same company in two places (next-link-record; a copied data folder keeps the company's GUID: round 35's card):
// ① the place FinCom reads, ② the other(s), whose data waits unapplied; an owner chooses, or Decide later (until then
// FinCom keeps reading ① and nothing from ② is applied)
function TwoPlaces({ co, company }) {
  const [, tick] = useState(0), [busy, setBusy] = useState("");
  const rec = typeof LinkRec === "object" && LinkRec.ready() ? LinkRec.forClient(co.id).find((x) => LinkRec.isName(x, company)) : null;
  const later = (S.tcoLater = S.tcoLater || {});
  if (!rec || !LinkRec.twoPlaces(rec) || later[rec.book_id]) return null;
  // migration 127: only places with a real data folder that sent entries; each with its full folder, computer, Windows
  // login and last entry (the owner: "no false alarms at all")
  const ps = LinkRec.realPlaces ? LinkRec.realPlaces(rec) : LinkRec.placesOf(rec), owner = isOwner(), N = ["①", "②", "③", "④"];
  const day = (d) => { const t = Date.parse(String(d || "") + "T00:00:00Z"); return t ? new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-") : ""; };
  const where = (x) => [x.data_folder, x.last_entry ? "last entry " + day(x.last_entry) : ""].filter(Boolean).join(" · ");
  const use = async (x) => { setBusy(x.data_loc); await LinkRec.choosePlace(rec, x.data_loc); setBusy(""); };
  return <div className="tco-under tco-two bk-warn" data-tco-two-places={rec.book_id} role="group" aria-label={shown(company) + " is open in two places"}>
    <p style={{ margin: "0 0 4px" }}><b>{shown(company) + " is open in two places with different data:"}</b></p>
    <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>{ps.map((x, i) => <li key={x.data_loc} data-tco-place={x.state} data-tco-place-folder={x.data_folder}>{(N[i] || "·") + " " + where(x) + (x.state === "chosen" ? " (FinCom reads this one)" : "")}
      {x.last_seen ? <span className="note">{" · last seen " + seenWords(x.last_seen)}</span> : null}</li>)}</ul>
    <p className="note" style={{ margin: "0 0 6px" }}>Which one is your books? FinCom reads only that one; nothing from the other is applied.</p>
    {owner ? <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {ps.map((x, i) => <button key={x.data_loc} className={"btn small" + (x.state === "chosen" ? "" : " primary")} data-tco-place-use={i + 1} disabled={!!busy} onClick={() => use(x)}>{busy === x.data_loc ? "Choosing…" : "Use " + (N[i] || i + 1)}</button>)}
      <button className="linkbtn" data-tco-place-later="" onClick={() => { later[rec.book_id] = Date.now(); tick((n) => n + 1); render(); }}>Decide later</button></div>
      : <p className="note" style={{ margin: 0 }}>An owner of the firm chooses.</p>}
  </div>;
}
// choose a client: "Link to a client…" (not linked) and "Link to another client" (linked: it moves, asked once)
// Task D (the owner, 28-Oct-2026: "No suggestion to add clients"): the ONE way to link a company not linked: the clients
// already in FinCom (the likeliest first and chosen, when one is: the same GSTIN or name, the client before this year);
// a new client only from the small "+ New client with this name" inside it, never a button of its own
// inline (next-tally-smart, the owner's layout rule: the client on the LEFT of the row, the Tally company on the right):
// the picker IS the row's client side, open from the start ("Choose client"), no button to open it; its select carries
// data-tco-act="pick" (the row's one action) and data-tco-pre (the client chosen first)
export function Pick({ r, co, onClose, pre = "", inline = false }) {
  const [pick, setPick] = useState(pre || ""), [busy, setBusy] = useState(false);
  // a client of the same name made after the row was drawn: chosen by itself (nothing chosen yet)
  const gone = (id) => !id || !S.companies || !S.companies[id] || S.companies[id].deleted;
  useEffect(() => { if (pre && gone(pick)) setPick(pre); }, [pre]);
  const cs = rankClients(r, co ? co.id : "");
  const go = async () => { const t = S.companies[pick]; if (!t) return; setBusy(true);
    const ok = await (co ? moveTo(Object.assign({}, r, { client: co.id }), t) : r.reported || r.open ? linkTo(r, t) : (keep(r, { kind: "link", cid: t.id }), true)); setBusy(false); if (ok && onClose) onClose(); };
  return <div className={"tco-relink" + (inline ? " tco-relink-inline" : "")} data-tco-relink-box={r.company}>
    {!inline && <span className="note">{co ? shown(r.company) + " is not " + co.name + "’s? Link it to" : "Link " + shown(r.company) + " to"}</span>}
    <select data-tco-relink-pick="" {...(inline ? { "data-tco-act": "pick", "data-tco-pre": pre || "" } : {})} aria-label={"The client " + shown(r.company) + " belongs to"} value={pick} onChange={(ev) => setPick(ev.target.value)}>
      <option value="">{inline ? "Choose client" : "Choose a client…"}</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <button className={"btn small" + (inline ? "" : " primary")} data-tco-relink="" disabled={!pick || busy} onClick={go}>{busy ? (SENDING[coKey(r.company)] ? "Sending to FinCom…" : "Linking…") : co ? "Move" : "Link"}</button>
    {!inline && <button className="linkbtn" data-tco-relink-cancel="" onClick={onClose}>Cancel</button>}
    {!co && <button className="linkbtn tco-new" data-tco-add-new={r.company} disabled={busy} onClick={async () => { setBusy(true); let id = ""; try { id = await addAsClient(r); } finally { setBusy(false); } if (id && onClose) onClose(); }}>+ New client with this name</button>}</div>;
}
// the ⋯ of a linked company (the same items wherever the company is listed: the companies open now; Clients linked to Tally has its own two: Change Tally company…, Unlink):
// Sync master, Sync vouchers, Post entries here, Link to another client, Unlink, the Day Book while days are missing, what
// is in the cloud, read again (owner), Open client; many: the computer that keeps it (the owner: no computer's name on a row)
export function LinkedMenu({ r, co, may, onPick, onChange = null, computer = "" }) {
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  return <details className="bk-menu tco-more" data-tco-more={r.company}>
    <summary className="btn small" aria-label={"More for " + shown(r.company)}>⋯</summary>
    <div className="bk-menu-list">
      {computer && <div className="note tco-menu-pc" data-tco-menu-pc="">{"Kept on " + computer}</div>}
      {may && <button data-tco-sync-master={co.id} onClick={close(() => syncMaster(co.id, r.company))}>Sync master<small>Send ledgers and groups now: ledgers, groups, parties, stock items and banks from Tally.</small></button>}
      {may && <button data-tco-sync-vouchers={co.id} onClick={close(() => tallyUpdateNow(co.id))}>Sync vouchers<small>The entries made in Tally since the last read.</small></button>}
      {may && (postsHere(co, r.company) ? <button data-tco-post-stop={co.id} onClick={close(() => postHere(co, r.company, false))}>Stop posting here<small>{co.name + "’s entries are posted into this company now."}</small></button>
        : <button data-tco-post-here={co.id} onClick={close(() => postHere(co, r.company, true))}>Post entries here<small>{"Post " + co.name + "’s entries into this company (asked first)."}</small></button>)}
      {may && onChange && <button data-tco-change={co.id} onClick={close(onChange)}>Change Tally company…<small>{"Link " + co.name + " to another Tally company."}</small></button>}
      {may && <button data-tco-not-this={r.company} onClick={close(() => onPick(true))}>Link to another client<small>It moves to the client you choose (asked once).</small></button>}
      {may && <button className="danger" data-tco-unlink={r.company} onClick={close(() => unlink(r))}>Unlink<small>The company is free to link again.</small></button>}
      {oldDaysMissing(co.id) && <button data-tco-daybook={co.id} onClick={close(() => openFromTally(co.id))}>Upload older entries (Day Book)<small>Days of this year not in FinCom yet: upload Tally’s Day Book once.</small></button>}
      {TCloud.groupStatus && <button data-tco-cloud-check={co.id} onClick={close(() => TCloud.groupStatus(co.id))}>What is in the cloud?<small>The groups, and the ledgers with a group, FinCom’s cloud holds.</small></button>}
      {isOwner() && TCloud.reparse && <button data-tco-reparse={co.id} onClick={close(() => TCloud.reparse(co.id))}>Read the kept day books again<small>For support: FinCom’s cloud reads what it keeps again.</small></button>}
      <button data-tco-open={co.id} onClick={close(() => openCompany(co.id))}>Open client<small>{co.name}</small></button>
    </div></details>;
}
// the row (next-tally-smart, 28-Oct-2026; the owner's layout rule): the CLIENT on the left, the TALLY COMPANY on the right,
// under the list's two headings (Client · Tally company); a company not linked has the picker itself on the left
// ("Choose client", the likeliest chosen), never a button to open it and never an "Add as client" suggestion. The quiet
// second line: its word (Linked / Waiting for Tally / Needs you), the ledgers and the last entry FinCom holds, Sync now
// and ⋯. No computer's name on a row (the top card says which computer this is; many computers: under ⋯).
// pcs: the firm has more than one computer (the computer then said under ⋯). quiet: a linked company not open now (the
// list's "Your linked clients" group): its word without a line to fix, "not open in Tally now · last entry <date>"
export function CompanyRow({ r, rows = null, forCo = null, focus = false, onDone = null, pcs = false, quiet = false }) {
  const [busy, setBusy] = useState(""), [pick, setPick] = useState(false), [chg, setChg] = useState(false);
  const co = r.client && S.companies ? S.companies[r.client] : null, may = canWrite(), st = r.st || tallyCoState(r.company), wordOf = co ? linkWord(co, r.company) : null;
  const k = co && typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
  // its other years (the same business once the period is off; another company of the same client is not a year)
  const sib = co ? (rows || []).filter((o) => o.client === co.id && o.company !== r.company && yearKey(o.company) === yearKey(r.company)) : [];
  const newer = co && !r.open ? sib.find((o) => o.open || String(o.seen) > String(r.seen)) : null, earlier = newer ? shown(newer.company) : "";
  const last = co && k && (!k.company || k.company === r.company) ? lastEntry(co, k) : "";
  const when = last ? "last entry " + seenWords(last) : r.open ? "" : r.seen ? "last seen " + seenWords(r.seen) : "";
  const meta = quiet ? [r.open ? "open in Tally on another computer" : "not open in Tally now", when].filter(Boolean).join(" · ") : wordOf && wordOf.line ? "" : when;
  const yr = !co && !r.client ? yearOf(r, rows) : null, tw = !co && !forCo && !yr ? twinOf(r) : null;
  const pend = PEND()[coKey(r.company)], err = (S.tcoErr || {})[coKey(r.company)];
  const run = (kind, job, fn) => async () => {
    if (!r.reported && !r.open) { keep(r, job); return; }   // next-tally-linknow: open in Tally: linked now (linkClient)
    setBusy(kind); let id = ""; try { id = await fn(); } finally { setBusy(""); }
    if (id && onDone) onDone(id === true ? (job.cid || "") : id);
  };
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  const syncing = co && k && k.line && k.line.reading;
  // migration 131: many of this client's ledgers missing from one read of Tally: asked here too (Confirm / Keep)
  const drop = co && typeof Rec === "object" && Rec.clientAlerts ? Rec.clientAlerts(co.id).find((x) => x.kind === "summary" && x.data && x.data.what === "ledger_drop" && x.data.state === "pending") : null;
  const pc = "";   // next-fix-tally-links2: no computer's name, not even under ⋯
  let client, acts = null;
  if (pend) client = <span className="tco-wait" data-tco-pending={pend.kind}>
    <button className="btn small" disabled>{pend.late ? "Not sent yet" : "Waiting…"}</button>
    <button className="linkbtn" data-tco-pending-cancel="" onClick={() => { delete PEND()[coKey(r.company)]; render(); }}>Cancel</button></span>;
  else if (r.client && !co) client = <span className="note" data-tco-elsewhere="">Linked to a client not on this computer</span>;
  else if (co && forCo && co.id !== forCo.id) client = <>
    <span className="note tco-linked-to" data-tco-linked-to={co.id}>Linked to client: <b>{co.name}</b></span>
    {may && <button className="btn small" data-tco-act="move" data-tco-move={forCo.id} disabled={!!busy} onClick={run("move", { kind: "move", cid: forCo.id }, () => moveTo(r, forCo).then((ok) => ok && forCo.id))}>{busy ? "Moving…" : "Move here"}</button>}</>;
  else if (co) {
    // next-fix-clientremove (the owner: "no visibility of which client it's linked to"): a labelled line, the name opens the client
    client = <span className="tco-linked-to" data-tco-linked-label={co.id}><span className="note">Linked to client:</span> <button className="linkbtn tco-client" data-tco-client={co.id} title={"Open " + co.name} onClick={() => openCompany(co.id)}>{co.name}</button></span>;
    acts = <>
      {may && <button className="btn small" data-tco-sync-now={co.id} disabled={!!syncing} onClick={() => syncNow(co.id, r.company)}>{syncing ? "Syncing…" : "Sync now"}</button>}
      <LinkedMenu r={r} co={co} may={may} onPick={setPick} onChange={() => setChg(true)} computer={pc} /></>;
  }
  else if (!may) client = <span className="note">A member of the firm who may make changes adds it.</span>;
  else {
    // Task D: from a client's "Choose on Tally page" the person named the client: Link to <client>. Otherwise the picker
    // itself (the clients already in FinCom, the likeliest chosen); no "Add as client" suggestion
    client = forCo ? <button className="btn small primary" data-tco-act="link" data-tco-link={forCo.id} disabled={!!busy}
        onClick={run("link", { kind: "link", cid: forCo.id }, () => linkTo(r, forCo).then((ok) => ok && forCo.id))}>{busy ? "Linking…" : "Link to " + forCo.name}</button>
      : <Pick r={r} co={null} inline pre={(yr || tw || {}).id || ""} />;
    acts = (r.hidden || !r.open) ? <details className="bk-menu tco-more" data-tco-more={r.company}>
        <summary className="btn small" aria-label={"More for " + shown(r.company)}>⋯</summary>
        <div className="bk-menu-list">
          {pc && <div className="note tco-menu-pc" data-tco-menu-pc="">{"Seen on " + pc}</div>}
          {r.hidden ? <button data-tco-unhide={r.company} onClick={close(() => hideCo(r, false))}>Show again<small>Back in the list.</small></button>
            : <button data-tco-hide={r.company} onClick={close(() => hideCo(r, true))}>Remove company<small>Off this list (not deleted; Show hidden puts it back).</small></button>}
        </div></details> : null;
  }
  // the quiet word: a linked company's (Linked / Waiting for Tally / Needs you); not linked and not open: when it was seen
  const quietWord = !co ? <span className="note" data-tco-pill="notclient" data-tco-pill-text="Not linked">{r.open ? "Not linked · open in Tally" : "Not linked · not open in Tally now"}</span> : null;
  return <li className={"tco-row" + (focus ? " tco-focus" : "") + (quiet ? " tco-quiet" : "")} data-tco-row={r.company} data-tco-state={st.state} data-tco-linked={co ? co.id : ""} data-tco-open={r.open ? "" : undefined}
    data-tco-reported={r.reported ? "yes" : "no"} data-focus={focus ? "" : undefined} data-why={r.why || undefined} data-linked-row={quiet ? r.company : undefined}>
    <div className="tco-client" data-tco-side="client">{client}</div>
    <span className="tco-arrow" aria-hidden="true">⟷</span>
    <div className="tco-main" data-tco-side="tally"><b className="tco-name" title={r.nowName ? "In FinCom’s cloud: " + r.company : undefined}>{shown(r.nowName || r.company)}</b>
      {r.nowName && <span className="tag" data-tco-renamed={r.company}>renamed in Tally</span>}
      {r.moved && <span className="tag warn" data-tco-moved={r.company} title="The computer this company came from was removed, or its FinCom Bridge now sends to another login">computer moved</span>}
      {r.gone && <span className="tag" data-tco-gone={r.company}>from a removed computer</span>}
      {r.why && <span className={"tag " + (r.why === "like" ? "warn" : "ok")} data-tco-why={r.why}>{r.why === "gstin" ? "same GSTIN" : r.why === "name" ? "same name" : "similar name"}</span>}
      {spacesOdd(r.company) && <span className="tag warn" data-tco-spaces="" title={"In Tally: “" + r.company + "”"}>name has extra spaces in Tally</span>}</div>
    {(co || quietWord || meta || acts) && <div className="tco-line2">
      {co ? <Pill r={r} st={st} co={co} earlier={earlier} noLine={quiet} /> : quietWord}
      {co && <SyncLine cid={co.id} words />}
      {meta && <span className="note tco-meta" data-linked-meta={quiet ? "" : undefined}>{meta}</span>}
      {acts && <span className="tco-act">{acts}</span>}
    </div>}
    {co && !earlier && !quiet && (wordOf ? wordOf.button && <div className="tco-under note" data-tco-fix=""><LinkStatus co={co} where="row" company={r.company} /></div>
      : st.state !== "connected" && fixOf(r, st) && <div className="tco-under note" data-tco-fix="">{fixOf(r, st)}</div>)}
    {!r.reported && !pend && r.open && !co && <div className="tco-under note" data-tco-unreported="">{SENDING[coKey(r.company)] ? "Sending " + shown(r.company) + " to FinCom and linking it…" : "Not in FinCom’s cloud yet: Link to client… sends it and links it at once."}</div>}
    {pend && <div className={"tco-under note" + (pend.late ? " bad" : "")} data-tco-pending-say="">{pend.late ? "Not sent to FinCom in 10 minutes: keep " + shown(r.company) + " open in TallyPrime, with FinCom Bridge running. Your click is still kept."
      : "Waiting for the Tally computer to send " + shown(r.company) + " to FinCom; " + (pend.kind === "add" ? "it is added" : "it is linked") + " by itself then (usually within two minutes)."}</div>}
    {err && !co && <div className="tco-under note bad" data-tco-err="">{"Could not link it: " + err}</div>}
    {drop && <div className="tco-under" data-tco-ledger-drop={co.id}><Suspense fallback={null}><LedgerDrop x={drop} where="row" /></Suspense></div>}
    {co && !earlier && <TwoPlaces co={co} company={r.company} />}
    {co && <div className="tco-under"><SyncLine cid={co.id} bar /><CloudSays cid={co.id} /></div>}
    {pick && <div className="tco-under"><Pick r={r} co={co} pre={co ? "" : ((yr || tw || {}).id || "")} onClose={() => setPick(false)} /></div>}
    {chg && co && <div className="tco-under"><ChangePick co={co} cur={r.company} onClose={() => setChg(false)} /></div>}
  </li>;
}
// ---------- Clients linked to Tally (next-fix-tally-links, 29-Oct-2026; the owner: "in tally page, I am not able to see
// and change the tally company"): under the companies open now, always, quiet: one row a linked client, whether its company
// is open in Tally or not: the client on the left, its Tally company on the right, "open now" or "not open in Tally now ·
// last entry <date>", ⋯ Change Tally company… and Unlink. No computer's name. inList: the companies the list above shows
// (a row of a company not shown there carries the list's row hooks, as "Your linked clients" did); here: this computer's
// open companies (This computer's view), else null
export function LinkedClients({ inList = null, here = null }) {
  const [chg, setChg] = useState(() => (S.tallyChange && S.companies && S.companies[S.tallyChange] ? S.tallyChange : ""));
  // Client setup › Tally › Change: the Tally page opened with that client's picker open
  useEffect(() => { if (!S.tallyChange) return; const id = S.tallyChange; S.tallyChange = "";
    const t = setTimeout(() => { const e = document.querySelector('#app [data-tlk-row="' + id + '"]'); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 120); return () => clearTimeout(t); }, []);
  const by = new Map();
  useEffect(() => { booksLoad([...by.keys()]); });
  companyRows({ hidden: true }).forEach((r) => { const co = r.client && S.companies ? S.companies[r.client] : null; if (!co || co.deleted) return; if (!by.has(co.id)) by.set(co.id, []); by.get(co.id).push(r); });
  // a client with two companies linked (a new year beside the one before): its company first, then the other, each its row
  // next-fix-tally-links2 (the owner: "I have 4 clients.. but system is showing only 3"): EVERY client of the firm, a client
  // not linked with "Not linked to Tally" and Link to Tally company… (the same picker); the count is the firm's clients
  const all = live().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const list = [].concat(...all.map((c) => [c.id, by.get(c.id) || []]).map(([id, rs]) => {
    if (!rs.length) return [{ co: S.companies[id], r: null, k: null, more: false, key: id, earlier: "" }];
    const co = S.companies[id], k = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
    const r = rs.find((x) => k && k.company && x.company === k.company) || rs.find((x) => x.open) || rs[0];
    return [r].concat(rs.filter((x) => x !== r)).map((x, i) => ({ co, r: x, k, more: i > 0, key: id + "|" + x.company,
      // an earlier year of the client's company (the same business once the period is off): "Earlier year", never a problem
      earlier: (() => { const y = !x.open && rs.find((o) => o !== x && yearKey(o.company) === yearKey(x.company) && (o.open || String(o.seen) > String(x.seen))); return y ? shown(y.company) : ""; })() })); }));
  const kOf = (x) => x.co.id + (x.more ? "|" + x.r.company : "");
  return <div className="tlk" data-tlk="" data-tlk-n={all.length}>
    <div className="tlk-head" data-tlk-head=""><b>{"Your clients and their Tally company (" + all.length + ")"}</b></div>
    {all.length === 0 ? <p className="note" data-tlk-empty="">No client in FinCom yet: choose the client beside its company above, while it is open in Tally.</p>
      : <ul className="tco-rows">{list.map((x) => x.r ? <LinkedClientRow key={x.key} {...x} here={here} open={chg === kOf(x)} onOpen={(on) => setChg(on ? kOf(x) : "")}
        hooks={!!inList && !inList.has(coKey(x.r.company))} /> : <FreeClientRow key={x.key} co={x.co} open={chg === x.co.id} onOpen={(on) => setChg(on ? x.co.id : "")} />)}</ul>}
  </div>;
}
// a client not linked to a Tally company: it stays listed (an unlinked client is never "erased"), with the picker
function FreeClientRow({ co, open, onOpen }) {
  const may = canWrite();
  return <li className="tco-row tco-quiet tlk-row" data-tlk-row={co.id} data-tlk-client-name={co.name} data-tlk-free="">
    <div className="tco-client" data-tlk-side="client"><button className="linkbtn tco-client" data-tlk-client={co.id} title={"Open " + co.name} onClick={() => openCompany(co.id)}>{co.name}</button></div>
    <span className="tco-arrow" aria-hidden="true">⟷</span>
    <div className="tco-main" data-tlk-side="tally"><span className="note" data-tlk-state="">Not linked to Tally</span></div>
    {may && !open && <div className="tco-line2"><span className="tco-act"><button className="btn small" data-tlk-link={co.id} onClick={() => onOpen(true)}>Link to Tally company…</button></span></div>}
    {open && <div className="tco-under"><ChangePick co={co} cur="" onClose={() => onOpen(false)} /></div>}
  </li>;
}
function LinkedClientRow({ co, r, k, more, earlier, here, open, onOpen, hooks }) {
  const may = canWrite(), st = r.st || tallyCoState(r.company);
  const now = r.open && (!here || here.has(coKey(r.company)));
  const last = k && (!k.company || k.company === r.company) ? lastEntry(co, k) : "";
  const when = last ? "last entry " + seenWords(last) : r.seen ? "last seen " + seenWords(r.seen) : "";
  const state = [more ? "also linked" : "", now ? "open now" : [r.open ? "open in Tally on another computer" : "not open in Tally now", when].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  return <li className="tco-row tco-quiet tlk-row" data-tlk-row={co.id} data-tlk-client-name={more ? undefined : co.name} data-tlk-company={r.company} data-tlk-open={now ? "" : undefined}
    {...(hooks ? { "data-tco-row": r.company, "data-linked-row": r.company, "data-tco-state": st.state, "data-tco-linked": co.id, "data-tco-reported": r.reported ? "yes" : "no" } : {})}>
    <div className="tco-client" data-tlk-side="client"><button className="linkbtn tco-client" data-tlk-client={co.id} title={"Open " + co.name} onClick={() => openCompany(co.id)}>{co.name}</button></div>
    <span className="tco-arrow" aria-hidden="true">⟷</span>
    <div className="tco-main" data-tlk-side="tally"><b className="tco-name" title={r.nowName ? "In FinCom’s cloud: " + r.company : undefined}>{shown(r.nowName || r.company)}</b>
</div>
    <div className="tco-line2">
      <Pill r={r} st={st} co={co} earlier={earlier} noLine />
      <span className="note tco-meta" data-tlk-state="" data-linked-meta="">{state}</span>
      <SyncLine cid={co.id} words />
      {may && <span className="tco-act"><details className="bk-menu tco-more" data-tlk-more={co.id} data-tco-more={r.company}>
        <summary className="btn small" aria-label={"More for " + co.name}>⋯</summary>
        <div className="bk-menu-list">
          <button data-tlk-change={co.id} onClick={close(() => onOpen(true))}>Change Tally company…<small>{"Link " + co.name + " to another company FinCom has seen in Tally."}</small></button>
          <button className="danger" data-tlk-unlink={co.id} data-tco-unlink={r.company} onClick={close(() => unlink(r))}>Unlink<small>The company is free to link again.</small></button>
          {/* (kept from the quiet rows before: Sync now, and the Day Book while days of this year are missing) */}
          <button data-tco-sync-now={co.id} onClick={close(() => syncNow(co.id, r.company))}>Sync now<small>Masters and vouchers, when the company is open in Tally.</small></button>
          {oldDaysMissing(co.id) && <button data-tco-daybook={co.id} onClick={close(() => openFromTally(co.id))}>Upload older entries (Day Book)<small>Days of this year not in FinCom yet: upload Tally’s Day Book once.</small></button>}
        </div></details></span>}
    </div>
    <div className="tco-under"><SyncLine cid={co.id} bar /></div>
    {open && <div className="tco-under"><ChangePick co={co} cur={r.company} onClose={() => onOpen(false)} /></div>}
  </li>;
}
// ---------- the list. rows: the rows to show (default: every company); forCo: the client the list links to (from its
// "Choose on Tally page"); focus: the client whose rows are marked (from its "Open in Tally page")
// only: which of every company this list holds (Help & support › Every company seen: those not on the page already), with
// the hidden and the removed computer's behind their toggles as before
export default function CompaniesInTally({ rows = null, forCo = null, focus = "", title = "Companies in Tally", note = null, empty = null, onDone = null, hook = "firm", count = null, pcs = false, only = null, after = null }) {
  const [q, setQ] = useState(""), [showHid, setShowHid] = useState(false), [showGone, setShowGone] = useState(false), [, tick] = useState(0);
  const all = companyRows({ hidden: true, gone: true }).filter((r) => !only || only(r)), list = rows || all.filter((r) => (showHid || !r.hidden) && (showGone || !r.gone));
  const nHid = all.filter((r) => r.hidden && !r.gone).length, nGone = all.filter((r) => r.gone).length;
  useEffect(() => { booksLoad(list.filter((r) => r.client).map((r) => r.client)); pendTick(all); });
  // a click kept for a company not sent yet: the computers and companies are read again every 10 seconds
  const waiting = Object.keys(PEND()).length > 0;
  useEffect(() => { if (!waiting) return; const t = setInterval(() => {
    if (typeof TLight === "object") TLight.st.at = 0;
    Promise.resolve(TCloud.refreshPane()).then(() => (typeof TLight === "object" ? TLight.refresh() : null)).then(() => tick((n) => n + 1), () => tick((n) => n + 1));
  }, POLL_MS); return () => clearInterval(t); }, [waiting]);
  useEffect(() => { if (!focus) return; const t = setTimeout(() => { const e = document.querySelector("#app [data-tco-row][data-focus]"); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 120); return () => clearTimeout(t); }, [focus]);
  const k = list.length > SEARCH_AT ? coKey(q) : "", hits = k ? list.filter((r) => coKey(r.company).includes(k) || (r.client && S.companies[r.client] && coKey(S.companies[r.client].name).includes(k))) : list;
  const nOpen = list.filter((r) => r.open).length;
  const countWords = count ? count(list) : nOf(list.length, "company", "companies") + " · " + nOpen + " open in Tally now";
  return <section className="tco" data-tco-list={hook} data-tco-n={list.length}>
    <div className="tco-head">{title && <h3>{title}</h3>}
      {title && list.length > 0 && countWords && <span className="note" data-tco-count="">{countWords}</span>}
      {list.length > SEARCH_AT && <input type="search" className="tco-q" data-tco-q="" aria-label="Find a company" placeholder="Find a company or client" value={q} onChange={(ev) => setQ(ev.target.value)} />}</div>
    {note}
    {list.length === 0 ? (empty || <p className="note" data-tco-empty="">No company seen in Tally yet. Open your company in TallyPrime on the computer with FinCom Bridge: it shows here within a minute.</p>)
      : <>{/* the owner's two headings: the client on the left, the Tally company on the right */}
        <div className="tco-cols" data-tco-cols="" aria-hidden="true"><span>Client</span><span /><span>Tally company</span></div>
        <ul className="tco-rows">{hits.map((r) => <CompanyRow key={r.company} r={r} rows={all} forCo={forCo} focus={!!focus && r.client === focus} onDone={onDone} pcs={pcs} />)}</ul></>}
    {k && !hits.length && <p className="note" data-tco-none="">No company matches “{q}”.</p>}
    {!rows && nGone > 0 && <button className="linkbtn" data-tco-show-gone={nGone} aria-expanded={showGone} onClick={() => setShowGone(!showGone)}>{(showGone ? "Hide: from a removed computer (" : "From a removed computer (") + nGone + ")"}</button>}
    {!rows && nHid > 0 && <button className="linkbtn" data-tco-show-hidden={nHid} onClick={() => setShowHid(!showHid)}>{showHid ? "Hide removed companies" : "Show hidden (" + nHid + ")"}</button>}
    {after}
  </section>;
}
