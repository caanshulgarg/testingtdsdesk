// A document of Resolutions & minutes as blocks: a template (templates/*.js) and its values, with the company's details,
// made into the blocks the A4 preview, the PDF (docPrint.js) and the Word file (docWord.js) all draw, so the three say the
// same thing. A value not given yet is shown in square brackets, marked (and counted).
//   build(doc, profile, co) -> {kind, blocks, missing: [labels], head: {left, right}?, foot: "initials"?, title}
// Blocks: {t: "title", text} · {t: "rule"} · {t: "subject", text} · {t: "p", runs, lead?} · {t: "list", rows} ·
//         {t: "lines", items} · {t: "to", lines} · {t: "grid", rows: [[label, runs]]} · {t: "item", no, title} ·
//         {t: "sig", lines, seal?, chairman?}
// Runs: a string, {b: text}, {miss: label}.
import { TEMPLATES, MINUTES, byKey } from "./templates/index.js";
import { dayLong, dmy, fyEnd, isDay, lastClosedFy, today, ordinal } from "./dates.js";
import { isDirector } from "./profile.js";

export const VENUES = [["office", "the registered office of the Company"], ["vc", "through video conferencing"], ["other", "another place"]];
const inr = (v) => (v === "" || v == null || isNaN(+String(v).replace(/,/g, "")) ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(+String(v).replace(/,/g, "")));
export const directorsOf = (p) => (p.directors || []).filter((d) => d && d.name && !d.ceased);
const idOf = (d, i) => d.din || "n" + i;

// the meeting's own fields, the same on every resolution and the minutes
export const MEETING = [
  { k: "meetingDate", label: "Date of the meeting", type: "date" },
  { k: "meetingTime", label: "Time", type: "text", def: "11:00 A.M." },
  { k: "venue", label: "Venue", type: "venue", def: "office" },
  { k: "place", label: "Place (city)", type: "text", ph: "City" },
  { k: "signer", label: "Certified true copy signed by", type: "director", only: "resolution" },
];

// a field's starting value
export function defaultOf(f, p) {
  const ds = directorsOf(p), withDin = ds.filter(isDirector);
  if (f.type === "directors") return (f.def === "first1" ? withDin.slice(0, 1) : f.def === "first2" ? withDin.slice(0, 2) : withDin).map(idOf);
  if (f.type === "director") return withDin[0] ? idOf(withDin[0], ds.indexOf(withDin[0])) : "";
  if (f.def === "today") return today();
  if (f.def === "fyEnd") return fyEnd(lastClosedFy(today()));
  if (typeof f.def === "string" && f.def.startsWith("profile.")) return p[f.def.slice(8)] || "";
  return f.def == null ? "" : f.def;
}
export function fieldsOf(tpl) {
  if (!tpl) return [];
  const meet = MEETING.filter((f) => !f.only || f.only === tpl.kind);
  return tpl.kind === "minutes" ? meet.filter((f) => f.k !== "signer").concat(tpl.fields) : meet.concat(tpl.fields);
}
export function startValues(tpl, p) {
  const v = {};
  fieldsOf(tpl).forEach((f) => { v[f.k] = defaultOf(f, p); });
  if (tpl.kind === "minutes") {
    const ds = directorsOf(p).filter(isDirector);
    v.attendance = Object.fromEntries(ds.map((d, i) => [idOf(d, i), "In person"]));
    v.chairman = ds[0] ? idOf(ds[0], 0) : "";
    v.off = [];
    v.items = [];
  }
  return v;
}

// the words a value is written in, or a {miss} run
function words(f, val, p, ctx) {
  const ds = directorsOf(p);
  const dir = (id) => ds.find((d, i) => idOf(d, i) === id);
  if (f.type === "date") { const d = dayLong(val); return d ? d.text : null; }
  if (f.type === "money") return inr(val) || null;
  if (f.type === "director") { const d = dir(val); return d ? d.name : null; }
  if (f.type === "venue") {
    if (val === "vc") return "through video conferencing";
    if (val === "other") return ctx.venueText || null;
    return "the registered office of the Company" + (p.office ? " at " + p.office : "");
  }
  return val === "" || val == null ? null : String(val);
}

// a template's text with its values: paragraphs of runs
function fill(text, fields, vals, p, ctx, missing) {
  const by = Object.fromEntries(fields.map((f) => [f.k, f])), ds = directorsOf(p);
  const one = (key) => {
    const [k, sub] = key.split(".");
    if (k === "company") return ctx.company || null;
    if (k === "meetingDay") { const d = dayLong(vals.meetingDate); return d ? d.weekday : null; }
    const f = by[k];
    if (!f) return null;
    if (sub === "din") { const d = ds.find((x, i) => idOf(x, i) === vals[k]); return d && d.din ? d.din : null; }
    return words(f, vals[k], p, Object.assign({}, ctx, { venueText: vals.venueText }));
  };
  const label = (key) => { const [k, sub] = key.split("."); const f = by[k]; return k === "company" ? "Company name" : k === "meetingDay" ? "Day" : f ? f.label + (sub === "din" ? " · DIN" : "") : key; };
  const blocks = [];
  String(text || "").split(/\n\s*\n/).forEach((para) => {
    const t = para.trim();
    const listM = /^\{\{(\w+):(list|lines)\}\}$/.exec(t);
    if (listM) {
      const f = by[listM[1]], v = vals[listM[1]];
      if (listM[2] === "lines") {
        const items = String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
        if (!items.length) { missing.push(f ? f.label : listM[1]); blocks.push({ t: "lines", items: [[{ miss: f ? f.label : listM[1] }]] }); }
        else blocks.push({ t: "lines", items: items.map((x) => [x]) });
      } else {
        const rows = (Array.isArray(v) ? v : []).map((id) => ds.find((d, i) => idOf(d, i) === id)).filter(Boolean).map((d, i) => [(i + 1) + ".", d.name, d.desig || "Director", d.din ? "DIN " + d.din : ""]);
        if (!rows.length) { missing.push(f ? f.label : listM[1]); blocks.push({ t: "list", rows: [["1.", { miss: f ? f.label : listM[1] }, "", ""]] }); }
        else blocks.push({ t: "list", rows });
      }
      return;
    }
    const runs = [];
    let last = 0;
    t.replace(/\{\{([\w.]+)\}\}/g, (m, key, at) => {
      if (at > last) runs.push(t.slice(last, at));
      const w = one(key);
      if (w == null || w === "") { const l = label(key); if (!missing.includes(l)) missing.push(l); runs.push({ miss: l }); } else runs.push(w);
      last = at + m.length; return m;
    });
    if (last < t.length) runs.push(t.slice(last));
    const lead = /^(RESOLVED FURTHER THAT|RESOLVED THAT|NOTICE is hereby given that)/.exec(t);
    if (lead && typeof runs[0] === "string") { runs[0] = runs[0].slice(lead[1].length); runs.unshift({ b: lead[1] }); }
    blocks.push({ t: "p", runs, lead: !!lead });
  });
  return blocks;
}
// the resolution's quotation marks: “ before the first RESOLVED, ” after the last paragraph of the resolution
function quote(blocks) {
  const ps = blocks.filter((b) => b.t === "p" && b.lead);
  if (!ps.length) return blocks;
  ps[0].runs = [{ b: "“" }].concat(ps[0].runs);
  const lastP = blocks.filter((b) => b.t === "p").pop();
  lastP.runs = lastP.runs.concat(["”"]);
  return blocks;
}
const runText = (runs) => (runs || []).map((r) => (typeof r === "string" ? r : r.b || (r.miss ? "[" + r.miss + "]" : ""))).join("");
export { runText };

function signer(p, id) { const ds = directorsOf(p); return ds.find((d, i) => idOf(d, i) === id) || null; }
function companyName(p, co) { return p.name || (co && co.name) || ""; }

export function build(doc, p, co) {
  const tpl = byKey(doc.template), vals = Object.assign({}, doc.fields || {}), missing = [];
  if (!tpl) return { kind: "", blocks: [], missing: [], title: doc.title || "" };
  const company = companyName(p, co), ctx = { company };
  const fields = fieldsOf(tpl);
  const time = vals.meetingTime || "", dl = dayLong(vals.meetingDate);
  const venue = words({ type: "venue" }, vals.venue, p, { venueText: vals.venueText });
  const need = (v, l) => { if (!v) { if (!missing.includes(l)) missing.push(l); return { miss: l }; } return v; };
  if (tpl.kind === "minutes") return minutes(tpl, vals, p, co, company, missing);
  const blocks = [];
  if (tpl.kind === "resolution") {
    blocks.push({ t: "title", runs: ["CERTIFIED TRUE COPY OF THE RESOLUTION PASSED BY THE BOARD OF DIRECTORS OF " + company.toUpperCase() + " AT ITS MEETING HELD ON ",
      need(dl && dl.text.toUpperCase(), "Date of the meeting"), " AT ", need(time.toUpperCase(), "Time"), " AT ", need(venue && venue.toUpperCase(), "Venue")] });
    blocks.push({ t: "rule" });
    blocks.push({ t: "subject", runs: fill(tpl.subject, fields, vals, p, ctx, missing)[0].runs });
    quote(fill(tpl.text, fields, vals, p, ctx, missing)).forEach((b) => blocks.push(b));
    const s = signer(p, vals.signer);
    blocks.push({ t: "sig", seal: true, lines: [[{ b: "Certified to be true" }], ["For ", { b: company }], "", [s ? { b: s.name } : { miss: "Certified true copy signed by" }],
      [(s && s.desig) || "Director", s && s.din ? " · DIN " + s.din : ""], ["Place: ", need(vals.place, "Place (city)"), " · Date: ", dmy(vals.signedOn || vals.meetingDate) || { miss: "Date of the meeting" }]] });
    if (!s && !missing.includes("Certified true copy signed by")) missing.push("Certified true copy signed by");
  } else {
    // a notice
    const s = signer(p, vals.signer);
    blocks.push({ t: "to", lines: [["To,"], ["The Directors of ", { b: company }], [dmy(vals.noticeDate) ? "Date: " + dmy(vals.noticeDate) : { miss: "Date of this notice" }]] });
    blocks.push({ t: "title", runs: fill(tpl.subject, fields, vals, p, ctx, missing)[0].runs.map((r) => (typeof r === "string" ? r.toUpperCase() : r)) });
    blocks.push({ t: "rule" });
    fill(tpl.text, fields, vals, p, ctx, missing).forEach((b) => blocks.push(b));
    blocks.push({ t: "sig", lines: [["By order of the Board"], ["For ", { b: company }], "", [s ? { b: s.name } : { miss: "Signed by" }], [(s && s.desig) || "Director", s && s.din ? " · DIN " + s.din : ""],
      ["Place: ", need(vals.place, "Place (city)")]] });
  }
  return { kind: tpl.kind, blocks, missing, title: doc.title || tpl.title, letterhead: doc.letterhead !== false };
}

// s.174: one third of the total strength (a fraction counted as one) or two directors, whichever is higher
export function quorum(p, attendance) {
  const ds = directorsOf(p).filter(isDirector), total = ds.length, need = Math.max(2, Math.ceil(total / 3));
  const present = ds.filter((d, i) => /In person|Video/.test((attendance || {})[idOf(d, i)] || "In person")).length;
  return { total, need, present, ok: total >= 2 && present >= need };
}

function minutes(tpl, vals, p, co, company, missing) {
  const ds = directorsOf(p).filter(isDirector), at = vals.attendance || {}, dl = dayLong(vals.meetingDate);
  const need = (v, l) => { if (!v) { if (!missing.includes(l)) missing.push(l); return { miss: l }; } return v; };
  const venue = words({ type: "venue" }, vals.venue, p, { venueText: vals.venueText });
  const chair = ds.find((d, i) => idOf(d, i) === vals.chairman);
  const serialWords = (s) => { const m = /^(\d+)\s*\/\s*(\S+)$/.exec(String(s || "").trim()); return m ? ordinal(+m[1]).toUpperCase() + " MEETING (" + m[2] + ")" : s ? String(s).toUpperCase() + " MEETING" : null; };
  const blocks = [];
  blocks.push({ t: "title", runs: ["MINUTES OF THE ", need(serialWords(vals.serial), "Serial no."), " OF THE BOARD OF DIRECTORS OF " + company.toUpperCase() + " HELD ON ",
    need(dl && (dl.weekday + ", " + dl.text).toUpperCase(), "Date of the meeting"), " AT ", need(String(vals.meetingTime || "").toUpperCase(), "Time"), " AT ", need(venue && venue.toUpperCase(), "Venue")] });
  const present = [], leave = [];
  ds.forEach((d, i) => {
    const mode = at[idOf(d, i)] || "In person", isChair = chair && d === chair;
    if (/In person|Video/.test(mode)) present.push(d.name + ", " + (d.desig || "Director") + (isChair ? ", in the Chair" : "") + " (" + (mode === "In person" ? "in person" : "through video conferencing") + ")");
    else if (mode === "Leave of absence") leave.push(d.name);
  });
  blocks.push({ t: "grid", rows: [["Present", present.length ? present.map((x, i) => (i + 1) + ". " + x).join("\n") : { miss: "Attendance" }],
    ["In attendance", vals.inAttendance || "None"]].concat(leave.length ? [["Leave of absence", leave.join(", ")]] : []) });
  blocks.push({ t: "rule" });
  const q = quorum(p, at);
  const ctx = { company }, leaveText = leave.length ? "Leave of absence was granted to " + leave.join(" and ") + ", who had requested it." : "All the Directors were present; no leave of absence was sought.";
  const stdFields = [{ k: "chairman", label: "Chairman", type: "director" }, { k: "prevDate", label: "Previous board meeting held on", type: "date" }, { k: "endTime", label: "Meeting ended at", type: "text" }];
  const sv = Object.assign({}, vals, { leaveText });
  let no = 0;
  const off = vals.off || [];
  tpl.standard.forEach((s) => {
    if (!s.fixed && off.includes(s.k)) return;
    no++; blocks.push({ t: "item", no, title: s.title });
    const txt = s.k === "leave" ? leaveText : s.text;
    fill(txt.replace("{{leaveText}}", leaveText), stdFields, sv, p, ctx, missing).forEach((b) => blocks.push(b));
    if (s.k === "chair") blocks.push({ t: "p", runs: ["Quorum: " + q.present + " of the " + q.total + " Directors present; the quorum under section 174 of the Companies Act, 2013 is " + q.need + "."] });
  });
  (vals.items || []).forEach((it) => {
    const t = byKey(it.template);
    if (!t) return;
    const fs = fieldsOf(t), iv = Object.assign({}, vals, it.fields || {});
    no++; blocks.push({ t: "item", no, title: t.title });
    if (t.minute) fill(t.minute, fs, iv, p, ctx, missing).forEach((b) => blocks.push(b));
    quote(fill(t.text, fs, iv, p, ctx, missing)).forEach((b) => blocks.push(b));
  });
  no++; blocks.push({ t: "item", no, title: tpl.close.title });
  fill(tpl.close.text, stdFields, sv, p, ctx, missing).forEach((b) => blocks.push(b));
  blocks.push({ t: "sig", chairman: true, lines: ["", [chair ? { b: chair.name } : { miss: "Chairman" }], ["Chairman"], ["Date of signing: ", dmy(vals.signedOn) || "____________"], ["Place: ", need(vals.place, "Place (city)")]] });
  if (!chair && !missing.includes("Chairman")) missing.push("Chairman");
  return { kind: "minutes", blocks, missing, quorum: q, title: "Minutes of board meeting" + (vals.serial ? " " + vals.serial : ""),
    head: { left: company + " · Minutes Book of Board Meetings", startPage: Math.max(1, parseInt(vals.startPage, 10) || 1) }, foot: "initials", letterhead: false };
}

// the documents a new one can be made from, for the gallery
export const GALLERY = TEMPLATES.concat([MINUTES]);
export { TEMPLATES, MINUTES, byKey };
// the title a document is listed by
export function titleOf(doc) { const t = byKey(doc.template); return doc.title || (t ? t.title : "Document"); }
export const isMeetingDay = isDay;
