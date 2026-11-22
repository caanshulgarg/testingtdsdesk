// next-fix-audit-gst: a GSTR-3B is a nil return for the late fee when no tax is payable in it (Notification 19/2021-CT:
// Rs 20 a day, at most Rs 500, where "the total amount of central tax payable in the said return is nil"): no outward tax
// (3.1(a), net) and no reverse charge (3.1(d)) in any head. Credit taken (table 4) does not make a return not nil.
const HEADS = ["igst", "cgst", "sgst", "cess"];
const n = (v) => Number(v) || 0;
export function nil3b(t) {
  return !HEADS.some((h) => n(((t && t.net) || {})[h]) >= 0.005 || n(((t && t.rcmOut) || {})[h]) >= 0.005);
}
