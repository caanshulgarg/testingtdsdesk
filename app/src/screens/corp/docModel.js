// A document of Resolutions & minutes as blocks: a template (templates/*.js) and its values, with the company's details,
// made into the blocks the A4 preview, the PDF (docPrint.js) and the Word file (docWord.js) all draw, so the three say the
// same thing. A value not given yet is shown in square brackets, marked (and counted).
//   build(doc, profile, co) -> {kind, blocks, missing: [labels], head: {left, right}?, foot: "initials"?, title}
// Blocks: {t: "title", text} · {t: "rule"} · {t: "subject", text} · {t: "p", runs, lead?} · {t: "list", rows} ·
//         {t: "lines", items} · {t: "to", lines} · {t: "grid", rows: [[label, runs]]} · {t: "item", no, title} ·
//         {t: "sig", lines, seal?, chairman?}
// Runs: a string, {b: text}, {miss: label}.
// A director is named by the stable id of its row in the profile (Profile.jsx gives every row one; an older document's DIN
// is still understood), never by its place in the list. A Final document is drawn from the snapshot of the company's
// details taken when it was marked Final (fields.snapshot), never from the profile as it is now.
// A template's words may hold [[public:...]] / [[private:...]] (by the company's class: a private company, an OPC
// included) and [[field=value:...]] / [[field!=value:...]] (by a field's value): kept or left out before the fields are
// filled in.
import { TEMPLATES, MINUTES, byKey } from "./templates/index.js";
import { dayLong, dmy, fyEnd, isDay, lastClosedFy, today, ordinal } from "./dates.js";
import { isDirector } from "./profile.js";

export const VENUES = [["office", "the registered office of the Company"], ["vc", "through video conferencing"], ["other", "another place"]];
const inr = (v) => (v === "" || v == null || isNaN(+String(v).replace(/,/g, "")) ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(+String(v).replace(/,/g, "")));
export const directorsOf = (p) => (p.directors || []).filter((d) => d && d.name && !d.ceased);
// the directors who can sign or be signatories: directors (not a KMP who is not one: CFO, CEO, CS, Manager)
export const realDirectors = (p) => directorsOf(p).filter(isDirector);
export const idOf = (d) => (d && (d.id || d.din)) || "";
// a director by id among all the profile's rows (one who has ceased since is still found: a resignation names them)
export const dirOf = (p, id) => { if (!id) return null; const all = (p.directors || []).filter((d) => d && d.name); return all.find((d) => d.id === id) || all.find((d) => d.din && d.din === id) || null; };
const isPrivate = (p) => p.cls === "private" || p.cls === "opc";
// the template's conditional words, for this company and these values
function cond(text, p, vals) {
  return String(text || "").replace(/\[\[(public|private|(\w+)(!?=)([^:\]]*)):([\s\S]*?)\]\]/g, (m, all, k, op, v, body) => {
    if (all === "public") return isPrivate(p) ? "" : body;
    if (all === "private") return isPrivate(p) ? body : "";
    const is = String((vals || {})[k] == null ? "" : vals[k]) === v;
    return (op === "=" ? is : !is) ? body : "";
  });
}
export { cond };
// the company's details a Final document keeps (and is drawn from)
export function snapshotOf(p, co) {
  return { name: p.name || (co && co.name) || "", cin: p.cin || "", office: p.office || "", cls: p.cls || "", phone: p.phone || "", email: p.email || "", website: p.website || "",
    incorporated: p.incorporated || "", letterhead: Object.assign({}, p.letterhead || {}),
    directors: (p.directors || []).filter((d) => d && d.name).map((d) => ({ id: d.id || "", name: d.name, din: d.din || "", desig: d.desig || "Director", ceased: !!d.ceased })) };
}
// the profile a document is drawn from: a Final one's snapshot, else the profile
export const profileFor = (doc, p) => (doc && doc.status === "final" && doc.fields && doc.fields.snapshot ? Object.assign({}, doc.fields.snapshot, { _snapshot: true }) : p);

// the meeting's own fields, the same on every resolution and the minutes
export const MEETING = [
  { k: "meetingDate", label: "Date of the meeting", type: "date" },
  { k: "meetingTime", label: "Time", type: "text", def: "11:00 A.M." },
  { k: "venue", label: "Venue", type: "venue", def: "office" },
  { k: "place", label: "Place (city)", type: "text", ph: "City" },
  { k: "signer", label: "Certified true copy signed by", type: "director", only: "resolution" },
  { k: "certifiedOn", label: "Certified on", type: "date", def: "today", only: "resolution" },
];

// a field's starting value
export function defaultOf(f, p) {
  const ds = realDirectors(p);
  if (f.type === "directors") return (f.def === "first1" ? ds.slice(0, 1) : f.def === "first2" ? ds.slice(0, 2) : ds).map(idOf).filter(Boolean);
  if (f.type === "director") return ds[0] ? idOf(ds[0]) : "";
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
    const ds = realDirectors(p);
    v.attendance = Object.fromEntries(ds.map((d) => [idOf(d), "In person"]));
    v.chairman = ds[0] ? idOf(ds[0]) : "";
    v.off = [];
    v.items = [];
  }
  return v;
}

// the words a value is written in, or a {miss} run
function words(f, val, p, ctx) {
  const dir = (id) => dirOf(p, id);
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
  const by = Object.fromEntries(fields.map((f) => [f.k, f]));
  text = cond(text, p, vals);
  const one = (key) => {
    const [k, sub] = key.split(".");
    if (k === "company") return ctx.company || null;
    if (k === "meetingDay") { const d = dayLong(vals.meetingDate); return d ? d.weekday : null; }
    // "at the registered office ..." / "through video conferencing" (never "at through ...")
    if (k === "atVenue") { const w = words({ type: "venue" }, vals.venue, p, { venueText: vals.venueText }); return w ? (vals.venue === "vc" ? w : "at " + w) : null; }
    const f = by[k];
    if (!f) return null;
    if (sub === "din") { const d = dirOf(p, vals[k]); return d && d.din ? d.din : null; }
    return words(f, vals[k], p, Object.assign({}, ctx, { venueText: vals.venueText }));
  };
  const label = (key) => { const [k, sub] = key.split("."); const f = by[k]; return k === "company" ? "Company name" : k === "meetingDay" ? "Day" : k === "atVenue" ? "Venue" : f ? f.label + (sub === "din" ? " · DIN" : "") : key; };
  const blocks = [];
  String(text || "").split(/\n\s*\n/).forEach((para) => {
    const t = para.trim();
    if (!t) return;   // a paragraph left out ([[...]])
    const listM = /^\{\{(\w+):(list|lines)\}\}$/.exec(t);
    if (listM) {
      const f = by[listM[1]], v = vals[listM[1]];
      if (listM[2] === "lines") {
        const items = String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
        if (!items.length) { missing.push(f ? f.label : listM[1]); blocks.push({ t: "lines", items: [[{ miss: f ? f.label : listM[1] }]] }); }
        else blocks.push({ t: "lines", items: items.map((x) => [x]) });
      } else {
        const rows = (Array.isArray(v) ? v : []).map((id) => dirOf(p, id)).filter((d) => d && isDirector(d)).map((d, i) => [(i + 1) + ".", d.name, d.desig || "Director", d.din ? "DIN " + d.din : ""]);
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

function signer(p, id) { const d = dirOf(p, id); return d && isDirector(d) && !d.ceased ? d : null; }
// the meeting's time and place in a title: "... AT 11:00 A.M. AT THE REGISTERED OFFICE ..." or "... AT 11:00 A.M. THROUGH
// VIDEO CONFERENCING"
function whereRuns(vals, venue, need) { return vals.venue === "vc" ? [" THROUGH VIDEO CONFERENCING"] : [" AT ", need(venue && venue.toUpperCase(), "Venue")]; }
const days = (a, b) => (isDay(a) && isDay(b) ? Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000) : null);
function companyName(p, co) { return p.name || (co && co.name) || ""; }

export function build(doc, p0, co) {
  const tpl = byKey(doc.template), vals = Object.assign({}, doc.fields || {}), missing = [], warn = [];
  if (!tpl) return { kind: "", blocks: [], missing: [], warn: [], title: doc.title || "" };
  const p = profileFor(doc, p0), company = companyName(p, co), ctx = { company };
  const fields = fieldsOf(tpl);
  const time = vals.meetingTime || "", dl = dayLong(vals.meetingDate);
  const venue = words({ type: "venue" }, vals.venue, p, { venueText: vals.venueText });
  const need = (v, l) => { if (!v) { if (!missing.includes(l)) missing.push(l); return { miss: l }; } return v; };
  if (tpl.kind === "minutes") return minutes(tpl, vals, p, co, company, missing, warn);
  // the dates the law sets (warnings: the document can still be made)
  if (tpl.key === "first-auditor" && isDay(p.incorporated) && isDay(vals.meetingDate) && days(p.incorporated, vals.meetingDate) > 30)
    warn.push("The first auditor is appointed by the Board within 30 days of incorporation (s.139(6)): this meeting is " + days(p.incorporated, vals.meetingDate) + " days after it.");
  const blocks = [];
  if (tpl.kind === "resolution") {
    blocks.push({ t: "title", runs: ["CERTIFIED TRUE COPY OF THE RESOLUTION PASSED BY THE BOARD OF DIRECTORS OF " + company.toUpperCase() + " AT ITS MEETING HELD ON ",
      need(dl && dl.text.toUpperCase(), "Date of the meeting"), " AT ", need(time.toUpperCase(), "Time")].concat(whereRuns(vals, venue, need)) });
    blocks.push({ t: "rule" });
    blocks.push({ t: "subject", runs: fill(tpl.subject, fields, vals, p, ctx, missing)[0].runs });
    quote(fill(tpl.text, fields, vals, p, ctx, missing)).forEach((b) => blocks.push(b));
    const s = signer(p, vals.signer);
    blocks.push({ t: "sig", seal: true, lines: [[{ b: "Certified to be true" }], ["For ", { b: company }], "", [s ? { b: s.name } : { miss: "Certified true copy signed by" }],
      [(s && s.desig) || "Director", s && s.din ? " · DIN " + s.din : ""], ["Place: ", need(vals.place, "Place (city)"), " · Date: ", need(dmy(vals.certifiedOn), "Certified on")]] });
    if (!s && !missing.includes("Certified true copy signed by")) missing.push("Certified true copy signed by");
  } else {
    // a notice: seven days at least (s.173(3)); shorter only for urgent business (the proviso, said in the notice)
    const s = signer(p, vals.signer), gap = days(vals.noticeDate, vals.meetingDate);
    if (gap != null && gap < 7) warn.push("Less than seven days' notice (" + gap + " day" + (gap === 1 ? "" : "s") + "): a shorter notice only for urgent business, with an independent director present where the company has one (s.173(3), proviso). The notice says so.");
    vals.shortNotice = gap != null && gap < 7 ? "yes" : "no";
    blocks.push({ t: "to", lines: [["To,"], ["The Directors of ", { b: company }], [dmy(vals.noticeDate) ? "Date: " + dmy(vals.noticeDate) : { miss: "Date of this notice" }]] });
    blocks.push({ t: "title", runs: fill(tpl.subject, fields, vals, p, ctx, missing)[0].runs.map((r) => (typeof r === "string" ? r.toUpperCase() : r)) });
    blocks.push({ t: "rule" });
    fill(tpl.text, fields, vals, p, ctx, missing).forEach((b) => blocks.push(b));
    blocks.push({ t: "sig", lines: [["By order of the Board"], ["For ", { b: company }], "", [s ? { b: s.name } : { miss: "Signed by" }], [(s && s.desig) || "Director", s && s.din ? " · DIN " + s.din : ""],
      ["Place: ", need(vals.place, "Place (city)")]] });
  }
  return { kind: tpl.kind, blocks, missing, warn, title: doc.title || tpl.title, letterhead: doc.letterhead !== false };
}

// s.174: one third of the total strength (a fraction counted as one) or two directors, whichever is higher
export function quorum(p, attendance) {
  const ds = realDirectors(p), total = ds.length, need = Math.max(2, Math.ceil(total / 3));
  const present = ds.filter((d) => /In person|Video/.test((attendance || {})[idOf(d)] || (attendance || {})[d.din] || "In person")).length;
  return { total, need, present, ok: total >= 2 && present >= need };
}

function minutes(tpl, vals, p, co, company, missing, warn) {
  const ds = realDirectors(p), at = vals.attendance || {}, dl = dayLong(vals.meetingDate);
  const need = (v, l) => { if (!v) { if (!missing.includes(l)) missing.push(l); return { miss: l }; } return v; };
  const venue = words({ type: "venue" }, vals.venue, p, { venueText: vals.venueText });
  const chair = ds.find((d) => idOf(d) === vals.chairman || (d.din && d.din === vals.chairman));
  const serialWords = (s) => { const m = /^(\d+)\s*\/\s*(\S+)$/.exec(String(s || "").trim()); return m ? ordinal(+m[1]).toUpperCase() + " MEETING (" + m[2] + ")" : s ? String(s).toUpperCase() + " MEETING" : null; };
  const blocks = [];
  blocks.push({ t: "title", runs: ["MINUTES OF THE ", need(serialWords(vals.serial), "Serial no."), " OF THE BOARD OF DIRECTORS OF " + company.toUpperCase() + " HELD ON ",
    need(dl && (dl.weekday + ", " + dl.text).toUpperCase(), "Date of the meeting"), " AT ", need(String(vals.meetingTime || "").toUpperCase(), "Time")].concat(whereRuns(vals, venue, need)) });
  const present = [], leave = [];
  ds.forEach((d) => {
    const mode = at[idOf(d)] || at[d.din] || "In person", isChair = chair && d === chair;
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
    // the quorum is minuted as present only when it was (s.174)
    const txt = s.k === "leave" ? leaveText : s.k === "chair" && !q.ok ? s.noQuorum : s.text;
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
  const sg = days(vals.meetingDate, vals.signedOn);
  if (sg != null && sg > 30) warn.push("Minutes are to be entered and signed within 30 days of the meeting (s.118, SS-1 para 7.4): signed " + sg + " days after it.");
  return { kind: "minutes", blocks, missing, warn, quorum: q, finalBlock: q.ok ? "" : "Quorum not present", title: "Minutes of board meeting" + (vals.serial ? " " + vals.serial : ""),
    head: { left: company + " · Minutes Book of Board Meetings", startPage: Math.max(1, parseInt(vals.startPage, 10) || 1) }, foot: "initials", letterhead: false };
}

// a logo is a PNG or JPEG picture kept as a data: URL, nothing else (never a link to somewhere)
export const logoOk = (u) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(u || ""));
// a picture's first bytes: PNG (89 50 4E 47 0D 0A 1A 0A) or JPEG (FF D8 FF)
export function pictureKind(bytes) {
  const b = bytes || [];
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return "";
}

// the documents a new one can be made from, for the gallery
export const GALLERY = TEMPLATES.concat([MINUTES]);
export { TEMPLATES, MINUTES, byKey };
// the title a document is listed by
export function titleOf(doc) { const t = byKey(doc.template); return doc.title || (t ? t.title : "Document"); }
export const isMeetingDay = isDay;
