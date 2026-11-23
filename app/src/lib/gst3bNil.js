// next-fix-audit-gst: a GSTR-3B is a nil return for the late fee when no tax is payable in it (Notification 19/2021-CT:
// Rs 20 a day, at most Rs 500, where "the total amount of central tax payable in the said return is nil"): no outward tax
// (3.1(a), net; 3.1(b), zero: IGST and cess on exports or SEZ supplies with payment, re-review) and no reverse charge
// (3.1(d)) in any head. Credit taken (table 4) does not make a return not nil.
const HEADS = ["igst", "cgst", "sgst", "cess"];
const n = (v) => Number(v) || 0;
export function nil3b(t) {
  return !HEADS.some((h) => ["net", "zero", "rcmOut"].some((k) => n(((t && t[k]) || {})[h]) >= 0.005));
}
// re-review (next-fix-audit-gst): what the CA decides on the GSTR-3B before filing, each a line for "Needs you":
//  - a negative value in 3.1(b), 3.1(c) or 3.1(e) (credit notes on an earlier month's supplies of that class, above this
//    month's): the Negative Liability Statement carries tax, not values, and the portal may refuse a negative value.
// (3.1(b)'s IGST and cess are in FinCom's 6.1 set-off, cash and set-off journal since the owner's decision of 23-Nov-2026,
// a negative one carried as negative liability: GSTR.setOff, server/_shared/gst3b.js; nothing to say of them here)
const INR = (v) => "Rs " + Math.round(Math.abs(v)).toLocaleString("en-IN");
export function r3bNeeds(t) {
  const w = [];
  if (!t) return w;
  [["zero", "3.1(b) zero rated supplies"], ["nil", "3.1(c) nil rated and exempt supplies"], ["nongst", "3.1(e) non-GST supplies"]].forEach(([k, l]) => {
    const v = n((t[k] || {}).taxable);
    if (v <= -0.005) w.push(l + ": the taxable value is negative (" + "-" + INR(v) + "), from credit notes on an earlier month's supplies. The portal may not take a negative value here, and the Negative Liability Statement carries tax only: decide with the CA how to report it (for example nil here, and the note against a later month's figure) before filing; FinCom's 3B JSON carries the figure as it is.");
  });
  return w;
}
