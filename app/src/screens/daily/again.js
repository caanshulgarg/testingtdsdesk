// Daily Check phase 2: the second check when the owner presses Approve on a journal FinCom made (acceptance rule 4).
// The same builder as the night (server/_shared/dailyjournals.js) is run again here, on the client's books as this
// computer has them now (opened from the cloud: S.books), with the app's own GSTR / GSTF for the set-off. Anything not
// the same as last night (a line, an amount, the date, a check) refuses: "Changed since last night". Loaded only when a
// journal is approved (a lazy part of the Daily Check chunk).
/* global S, CO, Books, ledGroupPath, GSTR, GSTF, GSTSet, TCloud, Cloud */
import { journals, gstMonths, picksOf, excludedOf, draftState, retriedOf, LOOKBACK } from "../../../../server/_shared/dailyjournals.js";
import { voucherId } from "../../../../server/_shared/dailytrust.js";

export const CHANGED = "Changed since last night. Run again.";
const d8 = (v) => { const t = String(v || "").trim(); const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + m[2] + m[3] : /^\d{8}$/.test(t) ? t : ""; };
const P = (x) => Math.round((Number(x) || 0) * 100);
const key = (ls) => (ls || []).map((l) => l.ledger + "|" + (P(l.dr) ? "D" + P(l.dr) : "C" + P(l.cr))).sort().join(";");
// India's date, as the night has it
export const todayIn = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
export function sameJournal(a, b) {
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
    drafts: (o.drafts || []).filter((d) => d && /^dc-/.test(String(d.id || "")) && d.dedupe).map((d) => ({ dedupe: d.dedupe, state: d.state || "", removed: !!d.removed })),
    picks: picksOf(o.prior || []), picksOut: picksOf(o.prior || [], true), excluded: excludedOf(o.prior || []), bookId: o.bookId || "",
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
  const inp = inputOf(cid, Object.assign({}, o, { ledgers, drafts, bookId }));
  const now = journals(inp).entries.find((x) => x.dedupe === e.dedupe);
  if (!now || !now.ready || !sameJournal(now.voucher, e.voucher) || voucherId(e.dedupe) !== now.work_ref) return CHANGED;
  return "";
}
