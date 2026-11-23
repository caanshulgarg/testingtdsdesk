// next-payroll (sixth review): a Tally Payroll voucher's narration names its part ("…, part 2 of 3)"), written by the
// builder (app/src/lib/tallyPayroll.js) and read back by the night and Approve when a part's draft is lost: one wording
export const partOfWords = (i, n) => ", part " + i + " of " + n;
export const PART_OF_RE = /, part (\d+) of (\d+)\)/;
// the month's count of parts a narration names (1 when it names none: a month of one part)
export const partsIn = (narr) => Number((String(narr || "").match(PART_OF_RE) || [])[2]) || 1;
