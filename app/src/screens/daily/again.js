// Daily Check phase 2: the second check when the owner presses Approve on a journal FinCom made (acceptance rule 4).
// The same builder as the night (server/_shared/dailyjournals.js) is run again here, on the client's books as this
// computer has them now (opened from the cloud: S.books), with the app's own GSTR / GSTF for the set-off. Anything not
// the same as last night (a line, an amount, the date, a check) refuses: "Changed since last night". Loaded only when a
// journal is approved (a lazy part of the Daily Check chunk).
/* global S, CO, Books, ledGroupPath, GSTR, GSTF, GSTSet, TCloud, Cloud, BookItems, BookSync */
import { journals, payrollNow, gstMonths, picksOf, excludedOf, draftState, retriedOf, LOOKBACK, payrollSettings } from "../../../../server/_shared/dailyjournals.js";
import { voucherId } from "../../../../server/_shared/dailytrust.js";

export const CHANGED = "Changed since last night. Run again.";
// (review 3) the running month's payroll entry made again in the cloud, at Approve, from the salary kept now
export const UPDATED = "Updated to the salary kept now; check and approve.";
// the salary kept here sent to FinCom's cloud first (the cloud reads the books there), at most 8 s
export async function sendBooksNow(cid) {
  const go = async () => {
    if (typeof BookItems === "object" && BookItems.on()) { await BookItems.flush(); return; }
    const s = typeof BookSync === "object" && BookSync.on() ? (BookSync.st || {})[cid] : null;
    if (s && s.timer) { clearTimeout(s.timer); s.timer = null; await BookSync.push(cid); }
  };
  try { await Promise.race([go(), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { /* the cloud reads what it has */ }
}
// (review 4) the server found no salary for a month this page has salary for: the save has not reached the cloud yet
export const NOT_YET = "The salary kept here is not in FinCom’s cloud yet. Try again in a minute.";
const monthOfRow = (r) => String((r && r.month) || String((r && r.date) || "").slice(0, 7).replace("-", ""));
const hasSalaryHere = (cid, ym) => { try { return S.coId === cid && ((S.books || {}).salary || []).some((r) => monthOfRow(r) === ym); } catch (e) { return false; } };
const noSalary = (r) => !!r && r.kind === "none" && (r.nosalary === true || /^No salary is kept with the books/.test(String(r.words || "")));
// "Make the journal now" (assistant-night payroll_now) for a client's month, the books here sent first. extra: {press: true}
// when a person pressed the button (their new decision on a month set aside); never for the update after a save
export async function payrollNowCall(cid, ym, extra) {
  await sendBooksNow(cid);
  let r;
  try { r = await Cloud.fn("assistant-night", Object.assign({ action: "payroll_now", client_id: cid, ym }, extra || {})); }
  catch (e) { return { kind: "error", words: String((e && e.message) || e) }; }
  return noSalary(r) && hasSalaryHere(cid, ym) ? Object.assign({}, r, { words: NOT_YET }) : r;
}
// a voucher as text, its keys in order (the cloud's jsonb and the page's copy compared as the same figures)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
// (review 4) after the claim: the entry read again. Made again meanwhile (the update after a save, on this page or another
// computer, between the second check and the claim): not what was checked, so not posted: UPDATED (the caller releases
// the claim). Not read (an error, or (review 5) no row, null or an empty body given back): UNREAD, the claim released
// too, nothing posted. "" goes on (the row as checked). read(id): the row ({voucher}), else the cloud's own
export const UNREAD = "FinCom could not read this entry again. Try Approve again in a moment.";
export async function stillAsChecked(e, read) {
  let rows;
  try { rows = read ? [await read(e.id)] : await Cloud.api("night_entries?select=id,voucher&id=eq." + encodeURIComponent(e.id)); }
  catch (x) { return UNREAD; }
  const row = (Array.isArray(rows) ? rows : []).find((x) => x && x.voucher && typeof x.voucher === "object" && (!x.id || x.id === e.id));
  if (!row) return UNREAD;
  return canon(row.voucher) === canon(e.voucher || {}) ? "" : UPDATED;
}
// the salary amounts of a voucher (gross, net and the deductions; a journal: its amounts), whatever the ledgers or the date
const amounts = (v) => !v ? "" : v.kind === "tallyPayroll" ? [P(v.gross), P(v.net)].concat(["tds", "pt", "pf", "esi", "other"].map((k) => P((v.ded || {})[k]))).join("|")
  : (v.lines || []).map((l) => (P(l.dr) ? "D" + P(l.dr) : "C" + P(l.cr))).sort().join(";");
// (review 4) the mismatch said last for each entry: the same one again, not a salary difference, is not said as an update
// again (no loop): the server's own words are
const SAID = new Map();
// the running month's entry no longer what the salary kept makes: made again in the cloud (nothing posted in this press)
async function remade(e, ym, o, now) {
  let r = (await (o.payrollNow || payrollNowCall)(e.client_id, ym)) || {};
  if (noSalary(r) && now) r = Object.assign({}, r, { words: NOT_YET });
  // (review 5) made, updated or already: plain words, never r.words (the server's running-month note)
  const words = () => "FinCom’s cloud has this entry as it is shown; the books here make it differently. Open the client again and approve.";
  if (r.kind === "already" && (r.state === "approved" || r.state === "approving")) return "It is already approved.";
  if (r.kind !== "updated" && r.kind !== "made" && r.kind !== "already") return String(r.words || "") || "FinCom could not make it again just now. Try again in a minute.";
  let v = null;
  try { v = o.entryOf ? await o.entryOf(r.id || e.id) : ((await Cloud.api("night_entries?select=voucher&id=eq." + encodeURIComponent(r.id || e.id))) || [])[0]; } catch (x) { v = null; }
  const cloud = (v && v.voucher) || (r.kind === "already" ? e.voucher : null);
  // the cloud has what the books here make: the entry shown here is the older one (or, the same, the difference is not
  // in the figures at all: the server's words, never an update again)
  if (now && cloud && sameJournal(now.voucher, cloud)) return sameJournal(cloud, e.voucher) ? words() : UPDATED;
  // what differs is not the salary (the same amounts; a ledger, the date): made again, the same again is no update
  const salary = !now || !cloud || amounts(now.voucher) !== amounts(cloud);
  const key = canon(now ? now.voucher : null), again = SAID.get(e.id) === key;
  SAID.set(e.id, key);
  if (!salary && (again || r.kind === "already")) return words();
  if (r.kind !== "already") return UPDATED;
  return cloud && !sameJournal(cloud, e.voucher) ? UPDATED : NOT_YET;
}
const d8 = (v) => { const t = String(v || "").trim(); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + m[2] + m[3] : /^\d{8}$/.test(t) ? t : ""; };
const P = (x) => Math.round((Number(x) || 0) * 100);
const key = (ls) => (ls || []).map((l) => l.ledger + "|" + (P(l.dr) ? "D" + P(l.dr) : "C" + P(l.cr))).sort().join(";");
// India's date, as the night has it
export const todayIn = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
// a Tally Payroll month (next-payroll): its totals, its employees' count, the payable ledger and the voucher type
const tpKey = (v) => [v.kind, v.type, v.party, v.period, v.n, P(v.gross), P(v.net)].concat(["tds", "pt", "pf", "esi", "other"].map((k) => P((v.ded || {})[k]))).join("|");
export function sameJournal(a, b) {
  if (a && b && (a.kind === "tallyPayroll" || b.kind === "tallyPayroll")) return d8(a.date) === d8(b.date) && tpKey(a) === tpKey(b);
  return !!a && !!b && a.type === b.type && d8(a.date) === d8(b.date) && key(a.lines) === key(b.lines);
}
// the night's input, made from what the app holds for the client (S.books opened from the cloud; the ledgers of the cloud
// copy; Daily Check's own approved journals; the ledgers people picked)
export function inputOf(cid, o) {
  const b = (typeof S === "object" && S.books) || {}, co = (typeof CO === "function" && CO(cid)) || {}, today = o.today || todayIn();
  const cur = today.slice(0, 6), months = [];
  for (let i = LOOKBACK; i >= 1; i--) { let y = +cur.slice(0, 4), m = +cur.slice(4, 6) - 1 - i; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; months.push(y + String(m + 1).padStart(2, "0")); }
  const closedTo = d8((co.closed || {}).to);
  return {
    today,
    books: { vouchers: b.vouchers || [], under: b.under || {}, groups: b.groups || {}, map: b.map || {},
      pathOf: typeof ledGroupPath === "function" ? (l) => ledGroupPath(b, l) : undefined, kindOf: (l) => ((b.map || {})[l] || {}).kind || "",
      isSale: (v) => { try { return Books.isSale(v); } catch (e) { return false; } }, isPurchase: (v) => { try { return Books.isPurchase(v); } catch (e) { return false; } } },
    ledgers: o.ledgers || [], booksFrom: d8(o.booksFrom || ""), salary: b.salary || [],
    closed: closedTo ? [{ from: "19000101", to: closedTo }] : [],
    gst: typeof GSTR === "object" && typeof GSTF === "object" ? gstMonths({ GSTR, GSTF, GSTSet: typeof GSTSet === "object" ? GSTSet : null }, months) : [],
    drafts: (o.drafts || []).filter((d) => d && /^dc-/.test(String(d.id || "")) && d.dedupe).map((d) => ({ dedupe: d.dedupe, state: d.state || "", removed: !!d.removed, vid: String(d.id), parts: Number(d.parts) || 0, at: String((((d.results || {})[d.id]) || {}).at || d.savedAt || d.at || ""),
      date: String((((d.vouchers || [])[0]) || {}).date || ""), sentAt: String((d.sent || {}).at || ""), retired: !!d.retiredBy })),
    picks: picksOf(o.prior || []), picksOut: picksOf(o.prior || [], true), excluded: excludedOf(o.prior || []), bookId: o.bookId || "", clientId: String(cid || ""),
    // next-payroll: how the client books salary, and Tally's pay heads (the cloud copy's payroll, S.books.payroll)
    daysAt: o.daysAt || {},   // (sixth review) when each Tally Payroll part's day was last read from Tally (tally_days.at)
    payroll: payrollSettings(co, Object.entries(((b.payroll || {}).heads) || {}).map(([name, h]) => ({ name, type: (h && h.type) || "" }))),
  };
}
// "" when the entry is still exactly what last night made; else why not
export async function recheck(e, o = {}) {
  const cid = e.client_id;
  let ledgers = o.ledgers, drafts = o.drafts;
  // (review low) the books opened here must be the ones the night read (a client's books split by year)
  const bookId = o.bookId != null ? o.bookId : (() => { try { const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(cid) : null; return String((bk && bk.book) || ""); } catch (x) { return ""; } })();
  if ((e.voucher || {}).book && bookId !== e.voucher.book) return "These are not the books last night read. Open " + ((e.voucher || {}).period ? "the year of " + e.voucher.period.slice(4, 6) + "/" + e.voucher.period.slice(0, 4) : "them") + " and try again.";
  if (!ledgers || !drafts) {
    const A = await import("../../lib/asstEntries.js");
    if (!ledgers) ledgers = ((await A.clientLedgers(CO(cid), true)) || []).map((l) => l.name);
    if (!drafts) drafts = (await A.Drafts.load(cid, true)) || [];
  }
  // (review N4) a draft whose posting the cloud's queue stopped is failed, as the night counts it
  const jobs = o.jobs || await (async () => { const ids = Array.from(new Set(drafts.map((d) => d.job || Object.values(d.results || {}).map((x) => x && x.job).find(Boolean)).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x || "")))));
    if (!ids.length) return {}; try { return Object.fromEntries(((await Cloud.api("tally_post_jobs?select=id,status,results&id=in.(" + ids.join(",") + ")")) || []).map((j) => [j.id, j])); } catch (x) { return {}; } })();
  const retried = retriedOf(o.prior || []);
  drafts = drafts.map((d) => { const own = (d.results || {})[d.id] || {}, job = d.job || Object.values(d.results || {}).map((x) => x && x.job).find(Boolean) || "";
    return Object.assign({}, d, { state: draftState({ state: d.state, job, vid: d.id, dedupe: d.dedupe, results: d.results || {}, removed: d.removed, ver: String(own.at || "-"), at: String(own.at || d.savedAt || d.at || "") }, jobs, o.now, retried) }); });
  // this entry's own draft (a post that Tally refused before) is not "already approved"
  drafts = drafts.filter((d) => !(d.dedupe === e.dedupe && d.state === "failed"));
  if (drafts.some((d) => d.dedupe === e.dedupe && !d.removed && d.state === "unconfirmed")) return "Sent to Tally but not confirmed there. Check Tally (Needs you).";
  if (drafts.some((d) => d.dedupe === e.dedupe && !d.removed)) return "Already approved: it is on its way to Tally.";
  // (sixth review) the days of the Tally Payroll parts on record (their voucher date, else the month-end), as last read
  const tpDays = Array.from(new Set(drafts.filter((d) => /^dc-tp-\d{6}-/.test(String(d.id || ""))).map((d) => { const x = String((((d.vouchers || [])[0]) || {}).date || "").slice(0, 10), ym = String(d.id).slice(6, 12);
    return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(4, 6), 0)).getUTCDate()).padStart(2, "0"); })));
  // (seventh review) each from the book that holds the day (of the client's books, the one beginning latest on or before
  // it: a split year's March in last year's book), else the books opened here
  const holder = (day) => { try { const bs = ((TCloud.st[cid] || {}).books || []).filter((x) => x && x.book && String(x.from || "").replace(/-/g, "").slice(0, 8) <= day.replace(/-/g, "")).sort((a, c) => String(c.from).replace(/-/g, "").localeCompare(String(a.from).replace(/-/g, ""))); return String((bs[0] || {}).book || bookId || ""); } catch (x) { return bookId || ""; } };
  const daysAt = o.daysAt || (tpDays.length ? await (async () => { const out = {}; for (const day of tpDays) { const bk = holder(day); if (!bk) continue;
    try { ((await Cloud.api("tally_days?select=day,at&book_id=eq." + encodeURIComponent(bk) + "&day=eq." + day)) || []).forEach((r) => { out[String(r.day).slice(0, 10)] = String(r.at || ""); }); } catch (x) { /* not read: the part holds the journal back */ } } return out; })() : {});
  const inp = inputOf(cid, Object.assign({}, o, { ledgers, drafts, bookId, daysAt }));
  // (re-review) the running month's payroll entry ("Make the journal now"): the night makes only the months that have
  // ended, so it is made again here the way the button made it (payrollNow: the same builder, that month only)
  const run = /^payroll:(\d{6})$/.exec(String(e.dedupe || "")), cur = String(inp.today || "").slice(0, 6);
  const running = !!run && run[1] === cur;
  const now = running ? (payrollNow(cur, inp) || {}).entry : journals(inp).entries.find((x) => x.dedupe === e.dedupe);
  if (!now || !now.ready || !sameJournal(now.voucher, e.voucher) || voucherId(e.dedupe) !== now.work_ref) return running ? remade(e, cur, o, now) : CHANGED;
  SAID.delete(e.id);
  return "";
}
