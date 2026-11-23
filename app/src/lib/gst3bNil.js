// next-fix-audit-gst: a GSTR-3B is a nil return for the late fee when no tax is payable in it (Notification 19/2021-CT:
// Rs 20 a day, at most Rs 500, where "the total amount of central tax payable in the said return is nil"): no outward tax
// (3.1(a), net; 3.1(b), zero: IGST and cess on exports or SEZ supplies with payment, re-review) and no reverse charge
// (3.1(d)) in any head. Credit taken (table 4) does not make a return not nil.
const HEADS = ["igst", "cgst", "sgst", "cess"];
const n = (v) => Number(v) || 0;
export function nil3b(t) {
  return !HEADS.some((h) => ["net", "zero", "rcmOut"].some((k) => n(((t && t[k]) || {})[h]) >= 0.005));
}
// re-review (next-fix-audit-gst): what the CA decides on the GSTR-3B before filing, each a line for "Needs you". Since the
// owner's decision of 23-Nov-2026 FinCom itself reports a negative 3.1(b), 3.1(c) or 3.1(e) as nil and carries the excess
// to the next return (GSTR.carry31, server/_shared/gst3b.js; r3bCarry below says so): a negative value is left only in a
// 3B worked out before that (kept as filed, or the cloud's older one), and the line says to work the month out again.
// (3.1(b)'s IGST and cess are in FinCom's 6.1 set-off, cash and set-off journal: GSTR.setOff)
const INR = (v) => "Rs " + Math.round(Math.abs(v)).toLocaleString("en-IN");
const BOX = [["zero", "3.1(b) zero rated supplies"], ["nil", "3.1(c) nil rated and exempt supplies"], ["nongst", "3.1(e) non-GST supplies"]];
export function r3bNeeds(t, filed) {
  const w = [];
  if (!t) return w;
  BOX.forEach(([k, l]) => {
    const v = n((t[k] || {}).taxable);
    // (review of ad4be74c3) a 3B filed so: nothing to change in it; the next return takes nothing off for it
    if (v <= -0.005) w.push(l + ": the taxable value is negative (-" + INR(v) + "). " + (filed ? "This 3B was filed so, before FinCom showed such a box as nil: nothing to change in it now, and the next 3B takes nothing off for it."
      : "FinCom now shows such a box as nil and carries the excess to the next return; this figure was worked out before that, so work the month out again before filing."));
  });
  // (re-review of bac94a801, N1) negative liability carried in waits for the CA's word on the portal's statement
  const nw = (t.opening || {}).negWait;
  if (nw && ["igst", "cgst", "sgst", "cess"].some((h) => n(nw[h]) >= 0.005))
    w.push("negative liability of " + [["igst", "IGST"], ["cgst", "CGST"], ["sgst", "SGST"], ["cess", "cess"]].filter(([h]) => n(nw[h]) >= 0.005).map(([h, l]) => l + " " + RS(nw[h])).join(", ") + " is carried in from credit notes of an earlier return. Check that the portal's Negative Liability Statement shows it, then confirm: it is set against this return's tax. Until then it is not.");
  return w;
}
// (the owner, 23-Nov-2026) the plain notes for the 3B page on what was carried: brought in from the return before and
// taken off this box, and what is carried on (credit notes more than supplies). ym: the month (a quarter: its last month)
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymLabel = (ym) => MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4);
const addM = (ym, k) => { const d = +String(ym).slice(0, 4) * 12 + (+String(ym).slice(4, 6) - 1) + k; return String(Math.floor(d / 12)) + String(d % 12 + 1).padStart(2, "0"); };
const RS = (v) => "\u20b9" + Math.round(Math.abs(v)).toLocaleString("en-IN");
export function r3bCarry(t, ym) {
  const c = t && t.c31, w = [];
  if (!c) return w;
  // (review of ad4be74c3) "this quarter" for a quarterly return; said when what was brought in took the box below nil;
  // 3.1(b)'s tax below nil is set off against its head (negative liability), never carried in the box
  const q = !!t.quarter, per = q ? "this quarter" : "this month", next = q ? "the next quarter (" + ymLabel(addM(ym, 1)) + " to " + ymLabel(addM(ym, 3)) + ")" : ymLabel(addM(ym, 1)), prev = q ? "the quarter before" : ymLabel(addM(ym, -1));
  BOX.forEach(([k, l]) => {
    const i = c.cin && c.cin[k], o = c.out && c.out[k], r = (c.raw || {})[k] || {}, s = [];
    if (i) s.push(RS(i.taxable) + " of credit notes brought from " + prev + " taken off here.");
    if (o) s.push((i && n(r.taxable) >= 0 ? "With them the box is below nil" : "Credit notes more than supplies " + per) + ": shown as nil, " + RS(o.taxable) + " carried to " + next + ".");
    const ig = Math.min(0, n(r.igst)), cs = Math.min(0, n(r.cess));
    if (ig || cs) s.push("Its " + [ig ? "IGST " + RS(ig) : "", cs ? "cess " + RS(cs) : ""].filter(Boolean).join(" and ") + " below nil " + (ig && cs ? "are" : "is") + " taken off 3.1(a)'s " + (ig && cs ? "IGST and cess" : ig ? "IGST" : "cess") + ", in the return as here; what is still below nil is carried as negative liability.");
    if (s.length) w.push(l + ": " + s.join(" "));
  });
  return w;
}
// (the owner, 23-Nov-2026) the year's carried amounts, for the GSTR-9 page: each return (a month, or a quarter at its last
// month) whose 3.1(b), (c) or (e) brought an amount in or carried one on; months: the year's, in order
export function r3bCarryYear(months, reg) {
  const rows = [];
  months.forEach((ym) => {
    if (typeof GSTSet === "object" && reg && GSTSet.typeOf(ym, reg) === "qrmp" && !GSTSet.isQEnd(ym)) return;
    const t = GSTR.threeB(ym, reg), c = t && t.c31;
    if (c) BOX.forEach(([k, l]) => { const i = c.cin && c.cin[k], o = c.out && c.out[k];
      if (i || o) rows.push({ ym, quarter: !!t.quarter, box: l, cin: i ? n(i.taxable) : 0, out: o ? n(o.taxable) : 0 }); });
  });
  return rows;
}
