// next-split-years (migration 161): the Tally page's link of a client's EARLIER-YEARS company (a split Tally: the same
// business cut into two Tally companies by date), beside its current company, and its unlink. The joining of the books is
// app/src/lib/splitBooks.js (loaded with the books); this file is the Tally page's (its lazy chunk).
const T = () => (typeof TCloud === "object" ? TCloud : null);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayWords = (d) => { const s = String(d || "").replace(/-/g, ""); return s.length === 8 ? s.slice(6, 8) + "-" + MON[Number(s.slice(4, 6)) - 1] + "-" + s.slice(0, 4) : ""; };
// the client's earlier-years company as the cloud last said it (TCloud.splitLoad), or null
export function splitOf(cid) { const t = T(), s = t && t.st ? t.st[cid] : null; return (s && s.split) || null; }
export const isSplitCo = (cid, company) => { const s = splitOf(cid); return !!(s && company && String(s.company).trim().toLowerCase() === String(company).trim().toLowerCase()); };
// the day an earlier company's years end, as its successor's name says ("… - (from 1-Apr-25)": 31-Mar-2025); else the
// 31 March before this financial year
export function endsGuess(curName) {
  const m = /\(from\s+(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\)/.exec(String(curName || ""));
  if (m) { const mi = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()), y = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
    if (mi >= 0 && y > 1999) { const t = new Date(Date.UTC(y, mi, Number(m[1]) - 1)); return t.toISOString().slice(0, 10); } }
  const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0);
  return y + "-03-31";
}
// the same company in Tally (one GUID) as the client's current one: a split, never a rename
export function sameGuid(company, curCompany) {
  const L = typeof LinkRec === "object" ? LinkRec : null; if (!L || !curCompany) return false;
  try { if (L.learnNow) L.learnNow(); } catch (e) { /* the beats not read yet */ }
  const a = L.guidOf(company), rec = L.ofName(curCompany), b = (rec && rec.company_guid) || L.guidOf(curCompany);
  return !!a && !!b && a === b;
}
async function again(cid) {
  const t = T();
  try { if (typeof LinkRec === "object") await LinkRec.again(); } catch (e) { /* read again later */ }
  try { if (t) { await t.status(cid, true); await t.splitLoad(cid, true); } } catch (e) { /* read again later */ }
  // the open client's books: joined (or undone) at once
  try { if (t && typeof S === "object" && S.books && S.books.cid === cid) await t.load(true); } catch (e) { /* the books say it */ }
}
// {ok, error}: plain words for the row
export async function splitLink(company, cid, ends) {
  const t = T(); if (!t) return { ok: false, error: "Sign in to the firm account first." };
  let r;
  try { r = await t.rpc("tally_split_link", { p_company: company, p_client: cid, p_ends: ends }); }
  catch (e) { const m = String((e && e.message) || e); return { ok: false, error: /tally_split_link|PGRST202|schema cache/i.test(m) ? "Earlier years are not in FinCom’s cloud yet (migration 161)." : m }; }
  if (!r || r.ok === false) return { ok: false, error: String((r && r.error) || "FinCom did not take it") };
  await again(cid);
  return { ok: true };
}
export async function splitUnlink(cid) {
  const t = T(), s = splitOf(cid); if (!t || !s) return { ok: false, error: "No earlier years linked." };
  let r;
  try { r = await t.rpc("tally_split_unlink", { p_book: s.book }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  if (!r || r.ok === false) return { ok: false, error: String((r && r.error) || "FinCom did not take it") };
  await again(cid);
  return { ok: true };
}
// the openings check of the client's books, when they are open here ("Matched" / "Differs by ₹X in N ledgers"), else ""
export function checkLine(cid) {
  const b = typeof S === "object" && S.books && S.books.cid === cid ? S.books : null, sp = b && b.meta && b.meta.split;
  if (!sp || !sp.check) return "";
  const ck = sp.check, R = (x) => "₹" + Math.abs(Math.round(x * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const on = dayWords(sp.curFrom);
  return "Openings of " + on + " against " + (sp.company || "the earlier company") + "’s closing: " + (ck.matched ? "Matched"
    : "Differs by " + R(ck.total) + " in " + ck.n + (ck.n === 1 ? " ledger" : " ledgers") + " (" + ck.list.slice(0, 3).map((x) => x[0] + " " + R(x[3])).join(", ") + (ck.n > 3 ? ", …" : "") + "). FinCom uses " + (sp.curCompany || "the current company") + "’s openings from " + on + ".");
}
