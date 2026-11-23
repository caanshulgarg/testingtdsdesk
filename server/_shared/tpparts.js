// next-payroll (sixth review): a Tally Payroll voucher's narration names its part ("…, part 2 of 3)"), written by the
// builder (app/src/lib/tallyPayroll.js) and read back by the night and Approve when a part's draft is lost: one wording
export const partOfWords = (i, n) => ", part " + i + " of " + n;
export const PART_OF_RE = /, part (\d+) of (\d+)\)/;
// the month's count of parts a narration names (1 when it names none: a month of one part)
export const partsIn = (narr) => Number((String(narr || "").match(PART_OF_RE) || [])[2]) || 1;
// (migration 212's re-review; its approval) a Tally Payroll part's id carries its client: dc-tp-<yyyymm>-<client>-p<n>.
// The ids were per firm in the cloud (tally_post_ids: one live FinCom id per firm; the posting register; 184's dupes) and
// per computer on the bridge (posted-ids.json: by the tag alone), so two clients' "part 1 of October" held each other
// back, or the second was refused as "already sent". The client: its FinCom id when that is small letters and digits
// alone (at most 40), else "h." and a hash of the whole id (never cut: two ids alike in their first 40 letters, or in
// their letters alone, stay apart); none when the id has no letter or digit (refused: never the shared id). The "p" keeps
// "client a1, part 2" apart from "client a, part 12". An older id with no client (dc-tp-<yyyymm>-<n>) is still read
const h53 = (str) => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36); };
export const tpClient = (cid) => { const s = String(cid || ""); if (!/[A-Za-z0-9]/.test(s)) return ""; return /^[a-z0-9]{1,40}$/.test(s) ? s : "h." + h53(s); };
export const tpPrefix = (ym, cid) => { const k = tpClient(cid); if (!k) throw new Error("This client’s FinCom id has no letter or digit, so FinCom cannot mark its payroll in Tally. Ask FinCom support."); return "dc-tp-" + ym + "-" + k + "-p"; };
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const tpIdRe = (ym, cid) => new RegExp("TDSDesk:(dc-tp-" + ym + "-(?:" + (tpClient(cid) ? esc(tpClient(cid)) + "-p" : "(?!)") + "\\d+|\\d+))(?![A-Za-z0-9._-])");
// a part's number from its id (either form)
export const tpPartNo = (id) => Number((String(id || "").match(/-p?(\d+)$/) || [])[1]) || 0;
// an older id with no client (from before the client was put in the mark)
export const tpOld = (id) => /^dc-tp-\d{6}-\d+$/.test(String(id || ""));
