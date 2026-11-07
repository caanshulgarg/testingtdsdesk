// "Compliance health" (Corporate › Company profile): worked out from the profile itself, never typed. Each item says what
// is due, under which section, and by when; tone "bad" past due, "warn" within 30 days or something missing, "ok" done.
// The e-Forms of the year (eforms.js) are added by the page with their own status.
//   health(profile, {on, formsDue}) -> {items: [{key, title, sub, when, tone, due}], due: n (items warn or bad)}
import { addDays, dmy, dueIn, fyEnd, fyOf, isDay, lastClosedFy, today, fyNext } from "./dates.js";
import { isDirector, lastAgm, openCharges, money } from "./profile.js";

const smallOrOpc = (p) => p.cls === "opc" || !!p.small;

// the last day for the AGM of a year (s.96(1)): six months from the end of the financial year (30 September); the first
// AGM within nine months from the end of the first financial year (31 December)
export function agmLastDay(p, fy) {
  const first = isDay(p.incorporated) && fyOf(p.incorporated) === fy;
  return first ? (+String(fy).slice(0, 4) + 1) + "-12-31" : (+String(fy).slice(0, 4) + 1) + "-09-30";
}

// the next board meeting (s.173(1): not more than 120 days between two meetings; a small company, an OPC: one in each half
// of the calendar year, at least 90 days apart, s.173(5))
export function nextBoard(p, on) {
  if (!isDay(p.lastBoard)) return null;
  if (smallOrOpc(p)) {
    const y = +p.lastBoard.slice(0, 4), h1 = p.lastBoard.slice(5, 7) <= "06", by = h1 ? y + "-12-31" : (y + 1) + "-06-30", from = addDays(p.lastBoard, 90);
    return { by, rule: "one meeting in each half of the calendar year, 90 days apart (s.173(5))", from };
  }
  return { by: addDays(p.lastBoard, 120), rule: "not more than 120 days after the last one (s.173(1))" };
}

export function health(p, o) {
  o = o || {};
  const on = o.on || today(), fy = lastClosedFy(on), items = [];
  const add = (x) => items.push(Object.assign({ tone: "", when: "" }, x));
  const when = (due) => { const d = dueIn(due, on); return { due, when: dmy(due), tone: d.tone, days: d.days, words: d.words }; };

  // the details a filing needs
  const need = [["cin", "CIN"], ["incorporated", "date of incorporation"], ["office", "registered office"]].filter(([k]) => !p[k]).map(([, l]) => l);
  if (need.length) add({ key: "details", title: "Company details", sub: "Not entered yet: " + need.join(", "), when: "Fill in", tone: "warn" });

  // the AGM of the last year
  const agm = (p.agms || {})[fy];
  if (agm) add({ key: "agm", title: "AGM · FY " + fy, sub: "held on " + dmy(agm) + " (s.96)", when: "Held", tone: "ok" });
  else if (!(isDay(p.incorporated) && p.incorporated > fyEnd(fy))) {
    const w = when(agmLastDay(p, fy));
    if (p.cls === "opc") add({ key: "agm", title: "AGM · FY " + fy, sub: "an OPC need not hold an AGM (s.96(1))", when: "Not needed", tone: "ok" });
    else add(Object.assign({ key: "agm", title: "AGM · FY " + fy, sub: "within six months of the year's end (s.96(1)); enter its date when held" }, w));
  }

  // the board
  const nb = nextBoard(p, on);
  if (nb) add(Object.assign({ key: "board", title: "Next board meeting", sub: nb.rule }, when(nb.by)));
  else add({ key: "board", title: "Board meetings", sub: "Enter the date of the last board meeting (s.173)", when: "Not entered", tone: "warn" });

  // DIR-3 KYC of each director holding a DIN on 31 March of the year (rule 12A, by 30 September)
  const kycFy = fy, kycDue = (+String(kycFy).slice(0, 4) + 1) + "-09-30";
  (p.directors || []).filter((d) => d && d.name && isDirector(d) && !d.ceased && (!isDay(d.appointed) || d.appointed <= fyEnd(kycFy))).forEach((d, i) => {
    const done = (d.kyc || []).includes(kycFy);
    add(done ? { key: "kyc:" + (d.din || i), title: "DIR-3 KYC · " + d.name, sub: "for FY " + kycFy, when: "Done", tone: "ok" }
      : Object.assign({ key: "kyc:" + (d.din || i), title: "DIR-3 KYC · " + d.name, sub: "every year by 30 September (rule 12A)" }, when(kycDue)));
  });

  // the auditor (s.139)
  if (!p.auditor) add({ key: "auditor", title: "Statutory auditor", sub: isDay(p.incorporated) ? "first auditor within 30 days of incorporation (s.139(6))" : "not entered", when: "Not entered", tone: "warn" });
  else if (p.auditorTill && p.auditorTill <= fyNext(fy, 0)) add({ key: "auditor", title: "Auditor's term · " + p.auditor, sub: "ends at the AGM for FY " + p.auditorTill + ": appoint at that AGM (s.139(1)), ADT-1 in 15 days", when: "This AGM", tone: "warn" });

  // open charges, for the record
  const oc = openCharges(p);
  if (oc.length) add({ key: "charges", title: "Open charges", sub: oc.length + " · " + money(oc.reduce((s, c) => s + (+c.amount || 0), 0)) + " (satisfaction: CHG-4 within 30 days, s.82)", when: String(oc.length), tone: "" });

  (o.formsDue || []).forEach((f) => add(f));
  const rank = { bad: 0, warn: 1, "": 2, ok: 3 };
  items.sort((a, b) => (rank[a.tone] - rank[b.tone]) || String(a.due || "9").localeCompare(String(b.due || "9")));
  return { items, due: items.filter((x) => x.tone === "bad" || x.tone === "warn").length, fy };
}
export { lastAgm };
