// next-payroll (sixth review): a Tally Payroll voucher's narration names its part ("…, part 2 of 3)"), written by the
// builder (app/src/lib/tallyPayroll.js) and read back by the night and Approve when a part's draft is lost: one wording
export const partOfWords = (i, n) => ", part " + i + " of " + n;
export const PART_OF_RE = /, part (\d+) of (\d+)\)/;
// the month's count of parts a narration names (1 when it names none: a month of one part)
export const partsIn = (narr) => Number((String(narr || "").match(PART_OF_RE) || [])[2]) || 1;
// (migration 212's re-review) a Tally Payroll part's id carries its client: dc-tp-<yyyymm>-<client>-<n>. The ids were
// per firm in the cloud (tally_post_ids: one live FinCom id per firm) and per computer on the bridge (posted-ids.json: by
// the tag alone), so two clients' "part 1 of October" held each other back (or were refused as "already sent"). The
// client's id in letters and digits, small letters; an older id with no client (dc-tp-<yyyymm>-<n>) is still read
export const tpClient = (cid) => String(cid || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
export const tpPrefix = (ym, cid) => "dc-tp-" + ym + "-" + (tpClient(cid) ? tpClient(cid) + "-" : "");
export const tpIdRe = (ym, cid) => new RegExp("TDSDesk:(dc-tp-" + ym + "-(?:" + (tpClient(cid) || "(?!)") + "-)?\\d+)(?![A-Za-z0-9._-])");
