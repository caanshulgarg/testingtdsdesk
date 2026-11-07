// "Compliance health" (Corporate › Company profile): worked out from the profile itself, never typed. Each item says what
// is due, under which section, and by when; tone "bad" past due, "warn" within 30 days or something missing, "ok" done.
// The e-Forms of the year (eforms.js) are added by the page with their own status.
//   health(profile, {on, formsDue, boards}) -> {items: [{key, title, sub, when, tone, due}], due: n (items warn or bad)}
// The rules, each with its section, for a Company Secretary to check (the review of 30f70eea6):
//   first financial year (s.2(41)): ends on the 31 March after incorporation; a company incorporated in January to March
//     may end it on 31 March of the FOLLOWING year (the proviso; FinCom takes that unless profile.firstFyEnd says otherwise)
//   AGM (s.96(1)): the first within nine months of the end of the first financial year; later ones within six months of the
//     year's end (30 September) and not more than fifteen months after the last AGM, whichever is earlier. An OPC need not.
//   board meetings (s.173): not more than 120 days between two, and four a calendar year at least (s.173(1)); a small
//     company (private only), an OPC, a dormant company (s.455) and a private start-up (G.S.R. 583(E), 13-Jun-2017): one in
//     each half of the calendar year, at least 90 days apart (s.173(5)); a section 8 company: one in every six calendar
//     months (G.S.R. 466(E), 05-Jun-2015); an OPC with only one director need hold none (s.173(5), proviso). s.173 sets a
//     largest gap only, so "four this year can no longer be reached" is a warning, never red; a company incorporated
//     during the year counts only the months from its incorporation
import { addDays, addMonths, daysBetween, dmy, dueIn, fyEnd, fyOf, isDay, lastClosedFy, today, fyNext } from "./dates.js";
import { isDirector, lastAgm, openCharges, money } from "./profile.js";
import { kycFor } from "./rules.js";

// a small company is a private company (s.2(85)): the tick means nothing for a public or a section 8 company
export const isSmall = (p) => !!p.small && (!p.cls || p.cls === "private");
const dormant = (p) => /^Dormant/i.test(String(p.status || ""));
export const relaxed = (p) => p.cls === "opc" || isSmall(p) || dormant(p) || (!!p.startup && (!p.cls || p.cls === "private"));

// the end of the first financial year
export function firstFyEnd(p) {
  if (isDay(p.firstFyEnd)) return p.firstFyEnd;
  if (!isDay(p.incorporated)) return "";
  return (+p.incorporated.slice(0, 4) + 1) + "-03-31";
}
// the last day for the AGM of a year; null: no AGM for that year (it ends before the first financial year does)
export function agmLastDay(p, fy) {
  const end = fyEnd(fy), ffe = firstFyEnd(p);
  if (ffe && end < ffe) return null;
  if (ffe && end === ffe) return addMonths(ffe, 9);
  const sixMonths = (+String(fy).slice(0, 4) + 1) + "-09-30", prev = (p.agms || {})[fyNext(fy, -1)];
  const fifteen = isDay(prev) ? addMonths(prev, 15) : "";
  return fifteen && fifteen < sixMonths ? fifteen : sixMonths;
}
export function agmRule(p, fy) {
  const ffe = firstFyEnd(p), end = fyEnd(fy);
  if (ffe && end === ffe) return "the first AGM: within nine months of the first financial year's end, " + dmy(ffe) + " (s.96(1))";
  const d = agmLastDay(p, fy), prev = (p.agms || {})[fyNext(fy, -1)];
  return d && isDay(prev) && d < (+String(fy).slice(0, 4) + 1) + "-09-30" ? "within fifteen months of the last AGM (" + dmy(prev) + ", s.96(1))" : "within six months of the year's end (s.96(1))";
}

// the next board meeting: {by, from?, rule}; dates: the meetings known (the last one, the minutes made in FinCom)
export const oneDirectorOpc = (p) => p.cls === "opc" && (p.directors || []).filter((d) => d && d.name && isDirector(d) && !d.ceased).length === 1;
export function nextBoard(p, on, dates) {
  if (oneDirectorOpc(p)) return { none: true, rule: "an OPC with one director need hold no board meeting (s.173(5), proviso)" };
  const all = Array.from(new Set([p.lastBoard].concat(dates || []).filter(isDay))).sort();
  const last = all[all.length - 1];
  if (!last) return null;
  if (p.cls === "section8") return { by: addMonths(last, 6), rule: "a section 8 company: one in every six calendar months (G.S.R. 466(E))", last, all };
  if (relaxed(p)) {
    const y = +last.slice(0, 4), h1 = last.slice(5, 7) <= "06", by = h1 ? y + "-12-31" : (y + 1) + "-06-30", from = addDays(last, 90);
    const who = p.cls === "opc" ? "an OPC" : isSmall(p) ? "a small company" : dormant(p) ? "a dormant company" : "a start-up";
    return { by, from, rule: who + ": one in each half of the calendar year, at least 90 days apart: not before " + dmy(from) + " (s.173(5))", last, all };
  }
  return { by: addDays(last, 120), rule: "not more than 120 days after the last one (s.173(1))", last, all, four: true };
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
  const agm = (p.agms || {})[fy], last = agmLastDay(p, fy);
  if (agm) add({ key: "agm", title: "AGM · FY " + fy, sub: "held on " + dmy(agm) + " (s.96)", when: "Held", tone: "ok" });
  else if (last) {
    if (p.cls === "opc") add({ key: "agm", title: "AGM · FY " + fy, sub: "an OPC need not hold an AGM (s.96(1))", when: "Not needed", tone: "ok" });
    else add(Object.assign({ key: "agm", title: "AGM · FY " + fy, sub: agmRule(p, fy) + "; enter its date when held" }, when(last)));
  }

  // the board
  const nb = nextBoard(p, on, o.boards);
  if (nb && nb.none) add({ key: "board", title: "Board meetings", sub: nb.rule, when: "Not needed", tone: "ok" });
  else if (!nb) add({ key: "board", title: "Board meetings", sub: "Enter the date of the last board meeting (s.173)", when: "Not entered", tone: "warn" });
  else {
    add(Object.assign({ key: "board", title: "Next board meeting", sub: nb.rule }, when(nb.by)));
    if (nb.four) {
      // four a calendar year (s.173(1)): the meetings known this year, against what is left of it
      // four a calendar year; the year of incorporation counts from the month of incorporation
      const y = on.slice(0, 4), n = nb.all.filter((d) => d.slice(0, 4) === y && d <= on).length, left = daysBetween(on, y + "-12-31");
      const fromMonth = isDay(p.incorporated) && p.incorporated.slice(0, 4) === y ? +p.incorporated.slice(5, 7) : 1, need = Math.ceil(4 * (13 - fromMonth) / 12);
      const can = Math.floor(left / 120) + 1;
      add({ key: "board4", title: "Board meetings in " + y, sub: n + " of the " + need + " this calendar year needs (s.173(1)" + (fromMonth > 1 ? ", from incorporation" : "") + ")", when: n + " of " + need,
        tone: n >= need ? "ok" : need - n >= can ? "warn" : "" });
    }
  }

  // DIR-3 KYC of each director holding a DIN on 31 March of the year (rule 12A; how often: rules.js DIR3_KYC)
  (p.directors || []).filter((d) => d && d.name && isDirector(d) && !d.ceased && (!isDay(d.appointed) || d.appointed <= fyEnd(fy))).forEach((d, i) => {
    const k = kycFor(d, fy), key = "kyc:" + (d.din || d.id || i);
    add(k.done ? { key, title: "DIR-3 KYC · " + d.name, sub: "for FY " + fy, when: "Done", tone: "ok" }
      : Object.assign({ key, title: "DIR-3 KYC · " + d.name, sub: k.words }, when(k.due)));
  });

  // the auditor (s.139)
  if (!p.auditor) add({ key: "auditor", title: "Statutory auditor", sub: isDay(p.incorporated) ? "first auditor within 30 days of incorporation (s.139(6))" : "not entered", when: "Not entered", tone: "warn" });
  else if (p.auditorTill && p.auditorTill < fy) add({ key: "auditor", title: "Auditor's term · " + p.auditor, sub: "ended at the AGM of FY " + p.auditorTill + ": appoint or re-appoint (s.139(1)), ADT-1 in 15 days", when: "Overdue", tone: "bad" });
  else if (p.auditorTill && p.auditorTill === fy) add({ key: "auditor", title: "Auditor's term · " + p.auditor, sub: "ends at the AGM of FY " + p.auditorTill + ": appoint at that AGM (s.139(1)), ADT-1 in 15 days", when: "This AGM", tone: "warn" });

  // open charges, for the record
  const oc = openCharges(p);
  if (oc.length) add({ key: "charges", title: "Open charges", sub: oc.length + " · " + money(oc.reduce((s, c) => s + (+c.amount || 0), 0)) + " (satisfaction: CHG-4 within 30 days, s.82)", when: String(oc.length), tone: "" });

  (o.formsDue || []).forEach((f) => add(f));
  const rank = { bad: 0, warn: 1, "": 2, ok: 3 };
  items.sort((a, b) => (rank[a.tone] - rank[b.tone]) || String(a.due || "9").localeCompare(String(b.due || "9")));
  return { items, due: items.filter((x) => x.tone === "bad" || x.tone === "warn").length, fy };
}
export { lastAgm, fyOf };
