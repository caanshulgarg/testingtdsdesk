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
//    month's): the Negative Liability Statement carries tax, not values, and the portal may refuse a negative value;
//  - 3.1(b) IGST or cess (exports or SEZ supplies with payment of tax): payable on the portal with 3.1(a)'s, but not part
//    of FinCom's 6.1 set-off, cash or set-off journal (a negative one is not carried as negative liability either).
const INR = (v) => "Rs " + Math.round(Math.abs(v)).toLocaleString("en-IN");
export function r3bNeeds(t) {
  const w = [];
  if (!t) return w;
  [["zero", "3.1(b) zero rated supplies"], ["nil", "3.1(c) nil rated and exempt supplies"], ["nongst", "3.1(e) non-GST supplies"]].forEach(([k, l]) => {
    const v = n((t[k] || {}).taxable);
    if (v <= -0.005) w.push(l + ": the taxable value is negative (" + "-" + INR(v) + "), from credit notes on an earlier month's supplies. The portal may not take a negative value here, and the Negative Liability Statement carries tax only: decide with the CA how to report it (for example nil here, and the note against a later month's figure) before filing; FinCom's 3B JSON carries the figure as it is.");
  });
  const z = t.zero || {}, ig = n(z.igst), cs = n(z.cess);
  if (Math.abs(ig) >= 0.005 || Math.abs(cs) >= 0.005)
    w.push("3.1(b) carries " + (Math.abs(ig) >= 0.005 ? "IGST " + (ig < 0 ? "-" : "") + INR(ig) : "") + (Math.abs(ig) >= 0.005 && Math.abs(cs) >= 0.005 ? " and " : "") + (Math.abs(cs) >= 0.005 ? "cess " + (cs < 0 ? "-" : "") + INR(cs) : "") + " (exports or SEZ supplies with payment of tax). It is payable on the portal with 3.1(a), but FinCom's 6.1 set-off, cash and set-off journal leave it out" + (ig < 0 || cs < 0 ? ", and a negative figure is not carried as negative liability" : "") + ": work out 6.1 on the portal before filing.");
  return w;
}
