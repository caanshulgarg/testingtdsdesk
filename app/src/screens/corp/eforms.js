// The e-Forms of a company worked out from rules.js and its profile, with what has been done on each (store.js filings).
//   annual(p, fy, filings)    the year's annual forms: [{ref, form, what, law, steps, due, dueFrom, status, done, srn, filedOn,
//                             reason, auto, director?, half?, builder?}]
//   events(filings)           the event-based forms started, with their due dates
//   startEvent(rule, date, note) -> a filing to keep
//   words(row)                "Not started" / "In progress (2 of 4)" / "Ready" / "Filed · SRN … · date" / "Not needed: …"
//   dueItems(p, filings, on)  what the Compliance health lists: the last year's forms not filed and the events open
import { ANNUAL, EVENT, GENERIC_STEPS } from "./rules.js";
import { addDays, dmy, dueIn, fyEnd, isDay, lastClosedFy, today } from "./dates.js";
import { agmLastDay, firstFyEnd } from "./health.js";
import { kycFor } from "./rules.js";
import { isDirector } from "./profile.js";
import { uid } from "./store.js";

const endYear = (fy) => +String(fy).slice(0, 4) + 1;
const ymd = (y, m, d) => y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");

// when the AGM of the year was held, or (not entered) the last day it could be: s.96(1)
// null: no AGM for the year (it ends before the company's first financial year does, s.2(41))
export function agmOf(p, fy) {
  const d = (p.agms || {})[fy];
  if (isDay(d)) return { date: d, held: true };
  const last = agmLastDay(p, fy);
  return last ? { date: last, held: false } : null;
}

function dueOf(rule, p, fy) {
  const r = p.cls === "opc" && rule.opc ? Object.assign({}, rule, rule.opc) : rule, y = endYear(fy);
  if (r.from === "kyc") return { due: "", from: "" };
  if (r.from === "agm") { const a = agmOf(p, fy); if (!a) return { due: "", from: "", none: "no AGM for this year: the first financial year ends on " + dmy(firstFyEnd(p)) + " (s.2(41))" }; return { due: addDays(a.date, r.days), from: a.held ? r.days + " days from the AGM (" + dmy(a.date) + ")" : r.days + " days from " + dmy(a.date) + ", the last day for the AGM (s.96): enter the AGM's date when held" }; }
  if (r.from === "agmLast") { const l = agmLastDay(p, fy); return l ? { due: addDays(l, r.days), from: r.days + " days from " + dmy(l) } : { due: "", from: "", none: "no AGM for this year (s.2(41))" }; }
  if (r.from === "fyEnd") return { due: addDays(fyEnd(fy), r.days), from: r.days + " days from the end of the year" };
  if (r.from === "fixed") return { due: ymd(y + (r.yearAfter || 0), r.month, r.day), from: "every year by " + dmy(ymd(y + (r.yearAfter || 0), r.month, r.day)).slice(0, 6) };
  return { due: "", from: "" };
}

export function annual(p, fy, filings) {
  const by = Object.fromEntries((filings || []).map((f) => [f.ref, f])), rows = [];
  const row = (rule, ref, extra) => {
    const f = by[ref], d = extra.due ? extra : dueOf(rule, p, fy), ap = d.none || rule.applies(p, fy);
    const base = { ref, form: rule.form, what: rule.what, law: rule.law, steps: rule.steps || GENERIC_STEPS, builder: rule.builder || "", due: d.due, dueFrom: d.from, kind: "annual", period: fy };
    if (f) rows.push(Object.assign(base, extra, { status: f.status, done: f.steps || 0, srn: f.srn || "", filedOn: f.filedOn || "", reason: f.reason || "", auto: false, data: f.data || {} }));
    else rows.push(Object.assign(base, extra, ap === true ? { status: "not_started", done: 0, reason: "", auto: false } : { status: "not_needed", done: 0, reason: ap, auto: true }));
  };
  ANNUAL.forEach((rule) => {
    if (rule.perDirector) {
      (p.directors || []).filter((d) => d && d.name && isDirector(d) && !d.ceased && (!isDay(d.appointed) || d.appointed <= fyEnd(fy))).forEach((d, i) => {
        const ref = "annual:" + rule.form + ":" + fy + ":" + (d.din || "d" + i);
        const k = kycFor(d, fy);
        row(rule, ref, { director: d.name, din: d.din || "", what: rule.what + " · " + d.name, due: k.due, from: k.words });
        const r = rows[rows.length - 1];
        // ticked in the profile (Directors & KMP) for this year: done; done in an earlier year and not due again yet
        // (three-yearly): not needed this year, with the date it is next due
        if (r.status === "not_started" && k.thisYear) Object.assign(r, { status: "filed", srn: "", filedOn: "", reason: "", fromProfile: true });
        else if (r.status === "not_started" && k.done) Object.assign(r, { status: "not_needed", reason: "next due " + dmy(k.due), auto: true });
      });
      return;
    }
    if (rule.from === "half") {
      rule.halves.forEach((h) => { const due = ymd(endYear(fy) + h.yearAfter, h.month, h.day); row(rule, "annual:" + rule.form + ":" + fy + ":" + h.key, { half: h.key, what: rule.what + " · " + h.label, due, from: "half-year " + h.label }); });
      return;
    }
    row(rule, "annual:" + rule.form + ":" + fy, {});
  });
  // the half-years carry their own "from"
  rows.forEach((r) => { if (r.from && !r.dueFrom) r.dueFrom = r.from; });
  return rows;
}

export function events(filings) {
  return (filings || []).filter((f) => f.kind === "event").map((f) => {
    const rule = EVENT.find((e) => e.form === f.form && (!f.data || !f.data.event || e.event === f.data.event)) || EVENT.find((e) => e.form === f.form) || {};
    return Object.assign({}, f, { what: (f.data && f.data.event) || rule.event || f.form, law: rule.law || "", steps: GENERIC_STEPS, done: f.steps || 0, resolution: rule.resolution || "" });
  }).sort((a, b) => String(a.due).localeCompare(String(b.due)));
}

export function startEvent(rule, date, note) {
  return { ref: "event:" + rule.form + ":" + uid(), kind: "event", form: rule.form, period: date.slice(0, 7), event: date, due: addDays(date, rule.days), status: "not_started", steps: 0,
    data: { event: rule.event, note: note || "" } };
}

export function words(r) {
  if (r.status === "filed") return r.fromProfile ? "Done (ticked in the profile)" : "Filed" + (r.srn ? " · SRN " + r.srn : "") + (r.filedOn ? " · " + dmy(r.filedOn) : "");
  if (r.status === "not_needed") return "Not needed" + (r.reason ? (/^next due /.test(r.reason) ? ", " : ": ") + r.reason : "");
  if (r.status === "ready" || r.done >= 4) return "Ready to file";
  if (r.done > 0 || r.status === "in_progress") return "In progress (" + (r.done || 0) + " of 4)";
  return "Not started";
}
export const open = (r) => r.status !== "filed" && r.status !== "not_needed";

export function dueItems(p, filings, on) {
  on = on || today();
  const fy = lastClosedFy(on), out = [];
  annual(p, fy, filings).filter(open).forEach((r) => {
    if (r.form === "DIR-3 KYC") return;   // the health lists each director's KYC from the profile already
    const d = dueIn(r.due, on);
    out.push({ key: "form:" + r.ref, title: r.form + " · FY " + fy + (r.half ? " " + r.half : ""), sub: r.dueFrom, due: r.due, when: dmy(r.due), tone: d.tone, words: d.words });
  });
  events(filings).filter(open).forEach((r) => { const d = dueIn(r.due, on); out.push({ key: "form:" + r.ref, title: r.form + " · " + r.what, sub: "event of " + dmy(r.event), due: r.due, when: dmy(r.due), tone: d.tone, words: d.words }); });
  return out;
}
// the count on the e-Forms tab: forms not done that are late or due within 30 days
export const dueCount = (p, filings, on) => dueItems(p, filings, on).filter((x) => x.tone === "bad" || x.tone === "warn").length;
