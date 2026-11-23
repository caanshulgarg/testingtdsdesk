// The files the owner downloads from the portals and brings in for a client's return (owner, 22-Nov-2026: "the data
// comes in by file import first"). Pure: read(name, content) -> what the file is and what it holds. No network, no
// page, no logging of the content (these files hold a person's tax data; nothing of them goes to the console).
//
// Kinds: ais (Annual Information Statement, JSON or PDF), tis (Taxpayer Information Summary, JSON or PDF), as26 (Form
// 26AS, TRACES text export or PDF), prefill (the e-filing portal's pre-filled data, JSON), ecr (EPFO ECR, the upload text
// or the CSV statement), pfchallan (EPFO challan / payment receipt, text or PDF), esic (ESIC challan, text or PDF).
// For each: {kind, label, pan, ay, fy, wageMonth?, estCode?, name?, key, read: {sections: [{name, count, total}]}, data}
// or {error: {code, text}}.
//
// LAYOUTS: only the ITR schemas are official files FinCom has read (incometax.gov.in, AY 2026-27). The AIS / TIS
// compliance portal, TRACES, EPFO and ESIC could not be reached from where FinCom is built; their layouts here are
// written from the portals' published descriptions and help pages and are read by field names, not column positions.
// Each reader says "layout assumed" (assumed: true) until the owner's first real file has been checked against it.
// The tests use made-up files only (tests/fixtures/itr/).

const PAN_RE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const TAN_RE = /\b([A-Z]{4}[0-9]{5}[A-Z])\b/;
const GSTIN_RE = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/;
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
export const LABEL = { ais: "AIS", tis: "TIS", as26: "Form 26AS", prefill: "Pre-filled data", ecr: "PF ECR", pfchallan: "PF challan", esic: "ESI challan", form16: "Form 16" };

const num = (s) => {
  if (typeof s === "number") return isFinite(s) ? s : null;
  const t = String(s == null ? "" : s).replace(/[₹,\s]|Rs\.?/gi, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? +t : null;
};
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
export function dateOf(s) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})/);
  if (m && MON[m[2].toUpperCase()]) return m[3] + String(MON[m[2].toUpperCase()]).padStart(2, "0") + m[1].padStart(2, "0");
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + m[2] + m[3];
  return "";
}
// "2025-26" / "FY 2025-26" / "2026-27" -> {fy, ay} as the start years "2025", "2026"
function yearsFrom(s, isAy) {
  const m = String(s || "").match(/(20\d{2})\s*[-–\/]\s*(\d{2,4})/); if (!m) return null;
  const y = +m[1];
  return isAy ? { ay: String(y), fy: String(y - 1) } : { fy: String(y), ay: String(y + 1) };
}
const ayLabel = (ay) => ay ? ay + "-" + String(+ay + 1).slice(2) : "";
// a wage month (yyyymm) -> the assessment year whose previous year holds it
function ayOfMonth(ym) { const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6); return String(m >= 4 ? y + 1 : y); }
function monthOf(s) {
  const t = String(s || "");
  let m = t.match(/\b([A-Za-z]{3})[A-Za-z]*[-\s\/,]*(20\d{2})\b/); if (m && MON[m[1].toUpperCase()]) return m[2] + String(MON[m[1].toUpperCase()]).padStart(2, "0");
  m = t.match(/\b(0[1-9]|1[0-2])[-\/]?(20\d{2})\b/); if (m) return m[2] + m[1];
  m = t.match(/\b(20\d{2})[-\/]?(0[1-9]|1[0-2])\b/); if (m) return m[1] + m[2];
  return "";
}
function section(code) {
  const t = String(code || "").toUpperCase().replace(/\s+/g, "");
  const m = t.match(/(206C[A-Z0-9()]*|19[0-9][A-Z0-9()]*)/);
  return m ? m[1].replace(/[()]/g, "") : "";
}
// what an AIS / TIS line is about, for the checks (verify.js)
export function category(code, desc) {
  const c = String(code || "").toUpperCase(), d = String(desc || "").toLowerCase();
  if (/GST|GSTR/.test(c) || /gst turnover|gstr-?3b|gstr-?1/.test(d)) return "gst";
  // salary (TDS 192) and the capital-gain lines: sale of securities and mutual fund units (SFT-17), sale of immovable
  // property (SFT-12, TDS 194IA): checked against Schedules S and CG (verify.js)
  if (/^TDS-?192\b|^TDS-?192$/.test(c) || /^salary/.test(d)) return "salary";
  if (/194-?IA/.test(c) || (/SFT-?0?12/.test(c) && /sal|sale/i.test(c + " " + d)) || /sale of (immovable|land|building|property)/.test(d)) return "cgprop";
  if ((/SFT-?0?17/.test(c) && /sal|sale|redemption/i.test(c + " " + d)) || /sale of (securities|units|shares)|redemption of units/.test(d)) return "cgsale";
  if (/^TDS-?194A?$|^TDS-?194A\b|SFT-?00[5]|SFT-?016/.test(c) || /interest/.test(d)) return "interest";
  if (/^TDS-?194$|SFT-?015/.test(c) || /dividend/.test(d)) return "dividend";
  if (/194I|194-?IB/.test(c) || /\brent\b/.test(d)) return "rent";
  if (/TCS|206C/.test(c) && /1H|sale/.test(c + d)) return "sale";
  if (/194Q/.test(c) || /purchase/.test(d)) return "purchase";
  if (/SFT/.test(c) || /sale|property|securities|mutual fund/.test(d)) return "hv";
  if (/^TDS|^TCS/.test(c)) return "credit";
  if (/advance tax|self.?assessment|tax paid|challan/.test(d)) return "taxpaid";
  return "other";
}
const summarize = (sections) => sections.filter((s) => s.count).map((s) => ({ name: s.name, count: s.count, total: r2(s.total) }));
const bucket = (rows, name, f) => { const xs = rows.filter(f); return { name, count: xs.length, total: xs.reduce((s, x) => s + (+x.amount || 0), 0) }; };

// ---------------- detection ----------------
export function detect(name, content) {
  const nm = String(name || "").toLowerCase();
  if (content && typeof content === "object" && !Array.isArray(content) && !content.lines) {
    const keys = JSON.stringify(Object.keys(content)).toLowerCase();
    const flat = JSON.stringify(content).slice(0, 4000).toLowerCase();
    if (/"itr"/.test(keys) && content.ITR) return "itrjson";
    if (/prefill|personalinfo|insights/.test(keys) && !/annualinformation/.test(keys)) return "prefill";
    if (/taxpayerinformationsummary|"tis"/.test(keys) || /taxpayer information summary/.test(flat)) return "tis";
    if (/annualinformation|"ais"|tdstcsinformation|sftinformation/.test(keys) || /annual information statement/.test(flat)) return "ais";
    return "";
  }
  const text = typeof content === "string" ? content : (content && content.lines ? content.lines.join("\n") : "");
  const head = text.slice(0, 6000);
  if (/#~#/.test(head)) return "ecr";
  if (/Electronic Challan cum Return|ECR Statement|\bUAN\b.*EPF Wages/i.test(head) && /\bUAN\b/i.test(head)) return "ecr";
  if (/Employees'? State Insurance|\bESIC\b/i.test(head) && /Challan/i.test(head)) return "esic";
  if (/TRRN/i.test(head) && /(Provident Fund|EPFO|A\/C\s*No|Account No)/i.test(head)) return "pfchallan";
  if (/FORM\s*NO\.?\s*16\b/i.test(head) && /section\s*203|section\s*192|Gross Salary/i.test(text)) return "form16";
  if (/Form\s*26AS|Annual Tax Statement/i.test(head) || (/Permanent Account Number/i.test(head) && /Tax Deducted at Source/i.test(text))) return "as26";
  if (/Taxpayer Information Summary/i.test(head)) return "tis";
  if (/Annual Information Statement/i.test(head)) return "ais";
  if (/26as/.test(nm)) return "as26";
  return "";
}

// ---------------- the readers ----------------
export function read(name, content) {
  let json = null;
  if (typeof content === "string" && /^\s*[{\[]/.test(content)) { try { json = JSON.parse(content); } catch (e) { return { error: { code: "bad_json", text: "The file looks like JSON but could not be read. Download it again from the portal." } }; } }
  const c = json || content;
  if (json && typeof json === "object" && (json.encrypted || json.EncryptedData || json.encData)) return { error: { code: "encrypted", text: "This JSON is locked by the portal. Open it in the portal's offline utility, or download the unlocked JSON or the PDF." } };
  const kind = detect(name, c);
  if (!kind) return { error: { code: "unknown", text: "FinCom could not tell what this file is. Bring in an AIS, TIS, 26AS, pre-filled JSON, Form 16, PF ECR or challan, or ESI challan." } };
  if (kind === "itrjson") return { error: { code: "itr", text: "This is an income tax return JSON. Last year's ITR is brought in on Statements › Fixed assets." } };
  const fn = { ais: json ? aisJson : aisText, tis: json ? tisJson : tisText, as26: as26Text, prefill: prefillJson, ecr: ecrText, pfchallan: pfChallanText, esic: esicText, form16: form16Text }[kind];
  const text = typeof c === "string" ? c : c && c.lines ? c.lines.join("\n") : "";
  const out = fn(json || text, name);
  if (out.error) return out;
  return Object.assign({ kind, label: LABEL[kind], assumed: true }, out, { ayLabel: ayLabel(out.ay) });
}

// ---- Form 16 (TRACES; Part A and Part B, PDF as text lines or the text): the employer, TAN, the employee's PAN, the
// AY, the salary under 17(1) / 17(2) / 17(3), the section 10 exemptions, the section 16 deductions and the TDS. Read by
// the lines' labels (the layout of rule 31(1)(a), Form No. 16 as amended), not by position. One per employer (TAN).
function form16Text(t) {
  const lines = textLines(t), all = lines.join("\n");
  const amt = (re) => { for (const ln of lines) { if (re.test(ln)) { const m = ln.match(/(-?[\d,]+\.\d{2}|-?[\d,]{2,})\s*$/); if (m) return num(m[1]) || 0; } } return null; };
  const pick = (re) => { for (const ln of lines) { const m = ln.match(re); if (m) return m[1].trim(); } return ""; };
  const emp = pick(/PAN of the Employee[^A-Z]*([A-Z]{5}[0-9]{4}[A-Z])/i) || pick(/Employee.*?\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
  const tan = pick(/TAN of the Deductor[^A-Z]*([A-Z]{4}[0-9]{5}[A-Z])/i) || (all.match(TAN_RE) || [])[1] || "";
  const am = all.match(/Assessment Year\s*[:\^]?\s*(20\d{2}\s*-\s*\d{2,4})/i), y = am ? yearsFrom(am[1], true) : null;
  const employer = pick(/Name and address of the Employer[^A-Za-z]*(?:\/Specified Bank)?\s+([^,]+)/i);
  const s171 = amt(/salary as per provisions contained in section 17\(1\)/i), s172 = amt(/perquisites under section 17\(2\)/i), s173 = amt(/in lieu of salary under section 17\(3\)/i);
  const exHra = amt(/house rent allowance under section 10\(13A\)/i), exLta = amt(/travel concession or assistance under section 10\(5\)/i), exGrat = amt(/gratuity under section 10\(10\)/i), exLeave = amt(/leave salary encashment under section 10\(10AA\)/i);
  const std = amt(/standard deduction under section 16\(ia\)/i), ent = amt(/entertainment allowance under section 16\(ii\)/i), ptax = amt(/tax on employment under section 16\(iii\)/i);
  const chargeable = amt(/income chargeable under the head .?salaries/i);
  // TDS: Part A's total line ("Total (Rs.) <amount paid> <tax deducted> <tax deposited>") or the net tax payable
  let tds = null; const tl = lines.find((ln) => /^Total\s*\(Rs/i.test(ln));
  if (tl) { const ns = tl.match(/-?[\d,]+\.\d{2}/g) || []; if (ns.length >= 2) tds = num(ns[1]); }
  if (tds == null) tds = amt(/net tax payable/i);
  const optOut = /opting out of taxation u\/s 115BAC/i.test(all) ? (/115BAC\(1A\)\?\s*(Yes|No)/i.exec(all) || [])[1] || "" : "";
  if (!emp) return { error: { code: "no_pan", text: "No employee's PAN was found in this Form 16." } };
  const ex = [["10(13A)", exHra], ["10(5)", exLta], ["10(10)", exGrat], ["10(10AA)", exLeave]].filter(([, v]) => v).map(([sec, a]) => ({ sec, amt: a }));
  const data = { employer, tan, s171: s171 || 0, s172: s172 || 0, s173: s173 || 0, exempt: ex, std: std || 0, ent: ent || 0, ptax: ptax || 0, chargeable, tds: tds || 0, oldRegime: /^yes$/i.test(optOut), optOut };
  return { pan: emp, ay: y ? y.ay : "", fy: y ? y.fy : "", name: "", key: "form16|" + (tan || "x"), data,
    read: { sections: summarize([{ name: "Salary (17(1) + 17(2) + 17(3))", count: 1, total: N0(s171) + N0(s172) + N0(s173) }, { name: "Exempt under section 10", count: ex.length, total: ex.reduce((a, x) => a + x.amt, 0) }, { name: "TDS (Part A)", count: 1, total: tds || 0 }]) } };
}
const N0 = (v) => +v || 0;

// ---- AIS JSON: any nesting; an information line is an object with an amount and an information code or description
function walkLines(j, push) {
  const ctx = {};
  const walk = (o, c, depth) => {
    if (!o || typeof o !== "object" || depth > 12) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, c, depth + 1)); return; }
    const cc = Object.assign({}, c), keys = Object.keys(o);
    keys.forEach((k) => {
      const v = o[k], lk = k.toLowerCase();
      if (v == null || typeof v === "object") return;
      const s = String(v).trim();
      if (/^(informationcode|infocode|code|sectioncode|section)$/.test(lk)) cc.code = s;
      else if (/^(informationdescription|description|infodesc|natureoftransaction|category)$/.test(lk)) cc.desc = s;
      else if (/^(informationsource|sourcename|deductorname|collectorname|name|reportingentity)$/.test(lk) && !/^\d/.test(s)) cc.src = s;
      else if (/tan|sourceid|reporterid|gstin|pan/.test(lk) && (TAN_RE.test(s) || GSTIN_RE.test(s) || PAN_RE.test(s))) cc.srcId = s;
      else if (/^(quarter|qtr)$/.test(lk)) cc.q = s;
      else if (/date/.test(lk) && dateOf(s)) cc.date = dateOf(s);
    });
    const amt = pick(o, /^(amount|amountpaid|amountpaidcredited|reportedvalue|value|grossamount|turnover|taxableturnover)$/i);
    const tax = pick(o, /^(taxdeducted|taxcollected|tdsamount|tcsamount|tax)$/i);
    if (amt != null && (cc.code || cc.desc)) push({ code: cc.code || "", desc: cc.desc || "", src: cc.src || "", srcId: cc.srcId || "", q: cc.q || "", date: cc.date || "", amount: amt, tax: tax == null ? 0 : tax, cat: category(cc.code, cc.desc), sec: section(cc.code) });
    keys.forEach((k) => { const v = o[k]; if (v && typeof v === "object") walk(v, cc, depth + 1); });
  };
  walk(j, ctx, 0);
}
function pick(o, re) { for (const k of Object.keys(o)) if (re.test(k) && num(o[k]) != null) return num(o[k]); return null; }
function panAy(j) {
  let pan = "", ay = "", fy = "", nm = "";
  const walk = (o, d) => {
    if (!o || typeof o !== "object" || d > 6) return;
    for (const k of Object.keys(o)) {
      const v = o[k], lk = k.toLowerCase();
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v);
        if (!pan && /^pan$|permanentaccountnumber|assesseepan/.test(lk) && PAN_RE.test(s)) pan = s.match(PAN_RE)[1];
        if (!ay && /assessmentyear|^ay$/.test(lk)) { const y = yearsFrom(s, true) || (/^20\d{2}$/.test(s) ? { ay: s, fy: String(+s - 1) } : null); if (y) { ay = y.ay; fy = y.fy; } }
        if (!fy && /financialyear|^fy$/.test(lk)) { const y = yearsFrom(s, false); if (y) { fy = y.fy; ay = ay || y.ay; } }
        if (!nm && /^(name|assesseename|taxpayername|fullname)$/.test(lk)) nm = s;
      } else walk(v, d + 1);
    }
  };
  walk(j, 0);
  return { pan, ay, fy, name: nm };
}
// the AIS's own taxpayer header (Part A / taxpayer information): the PAN is taken from there only, never from a line
// (a deductor's or buyer's PAN in a line would otherwise pass for the taxpayer's)
function headerOf(j) {
  const HDR = /^(parta|part_a|taxpayerinfo|taxpayerinformation|taxpayerdetails|header|assesseedetails|personalinfo|generalinformation)$/i;
  const hits = [];
  const walk = (o, d) => { if (!o || typeof o !== "object" || Array.isArray(o) || d > 3) return; Object.keys(o).forEach((k) => { if (HDR.test(k) && o[k] && typeof o[k] === "object") hits.push(o[k]); else walk(o[k], d + 1); }); };
  walk(j, 0);
  return hits[0] || null;
}
function aisJson(j) {
  const h = headerOf(j), id = h ? panAy(h) : { pan: "", ay: "", fy: "", name: "" }, rows = [];
  if (h && (!id.ay || !id.fy)) { const all = panAy(j); id.ay = id.ay || all.ay; id.fy = id.fy || all.fy; }
  walkLines(j, (r) => rows.push(r));
  if (!id.pan) return { error: { code: "no_pan", text: "No PAN was found in this AIS's taxpayer header (Part A)." } };
  return Object.assign(id, { key: "ais", data: { rows }, read: { sections: summarize(aisSections(rows)) } });
}
function aisSections(rows) {
  return [bucket(rows, "TDS / TCS", (r) => /^TDS|^TCS/i.test(r.code) || r.cat === "credit"), bucket(rows, "Interest", (r) => r.cat === "interest"), bucket(rows, "Dividend", (r) => r.cat === "dividend"),
    bucket(rows, "Rent", (r) => r.cat === "rent"), bucket(rows, "Purchases and sales (high value)", (r) => ["hv", "purchase", "sale"].includes(r.cat)), bucket(rows, "GST turnover", (r) => r.cat === "gst"), bucket(rows, "Taxes paid", (r) => r.cat === "taxpaid")];
}
// ---- AIS / TIS PDF (as text lines): "<CODE> <description> ... <amount>" lines
function textLines(t) { return String(t || "").replace(/\r/g, "").split("\n").map((x) => x.trim()).filter(Boolean); }
function idFromText(t) {
  const pm = t.match(/(?:Permanent Account Number|PAN)\s*(?:\(PAN\))?\s*[:\^]?\s*([A-Z]{5}[0-9]{4}[A-Z])/i) || t.match(PAN_RE);
  const am = t.match(/Assessment Year\s*[:\^]?\s*(20\d{2}\s*-\s*\d{2,4})/i), fm = t.match(/Financial Year\s*[:\^]?\s*(20\d{2}\s*-\s*\d{2,4})/i);
  const y = am ? yearsFrom(am[1], true) : fm ? yearsFrom(fm[1], false) : null;
  const nmm = t.match(/Name(?: of (?:the )?Assessee| of Taxpayer)?\s*[:\^]\s*([^\n\^]+)/i);
  return { pan: pm ? pm[1] : "", ay: y ? y.ay : "", fy: y ? y.fy : "", name: nmm ? nmm[1].trim() : "" };
}
function aisText(t) {
  const id = idFromText(t), rows = [];
  textLines(t).forEach((ln) => {
    const m = ln.match(/^((?:TDS|TCS|SFT|GST|EXC|TIS)-?[0-9A-Z()]*)\s+(.+?)\s+(-?[\d,]+(?:\.\d{1,2})?)(?:\s+(-?[\d,]+(?:\.\d{1,2})?))?\s*$/i);
    if (!m) return;
    const tanm = m[2].match(TAN_RE) || m[2].match(GSTIN_RE);
    rows.push({ code: m[1].toUpperCase(), desc: m[2].replace(/\(?[A-Z]{4}\d{5}[A-Z]\)?/, "").trim(), src: "", srcId: tanm ? tanm[1] : "", amount: num(m[3]), tax: num(m[4]) || 0, cat: category(m[1], m[2]), sec: section(m[1]) });
  });
  if (!id.pan) return { error: { code: "no_pan", text: "No PAN was found in this AIS." } };
  return Object.assign(id, { key: "ais", data: { rows }, read: { sections: summarize(aisSections(rows)) } });
}
// ---- TIS: category-wise, the processed value and the value derived after feedback
function tisJson(j) {
  const id = panAy(j), rows = [];
  const walk = (o, d) => {
    if (!o || typeof o !== "object" || d > 10) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1)); return; }
    const cat = o.category || o.informationCategory || o.Category, proc = pick(o, /^(processedvalue|processed)$/i), der = pick(o, /^(derivedvalue|acceptedvalue|derived|accepted)$/i);
    if (cat && (proc != null || der != null)) rows.push({ desc: String(cat), processed: proc || 0, amount: der != null ? der : proc, cat: category("", cat) });
    Object.values(o).forEach((v) => { if (v && typeof v === "object") walk(v, d + 1); });
  };
  walk(j, 0);
  if (!id.pan) return { error: { code: "no_pan", text: "No PAN was found in this TIS." } };
  return Object.assign(id, { key: "tis", data: { rows }, read: { sections: summarize(rows.map((r) => ({ name: r.desc, count: 1, total: r.amount }))) } });
}
function tisText(t) {
  const id = idFromText(t), rows = [];
  textLines(t).forEach((ln) => {
    const m = ln.match(/^([A-Za-z][A-Za-z ,()\/-]{3,60}?)\s+(-?[\d,]+(?:\.\d{1,2})?)\s+(-?[\d,]+(?:\.\d{1,2})?)\s*$/);
    if (m && !/Assessment|Financial|Total/i.test(m[1])) rows.push({ desc: m[1].trim(), processed: num(m[2]), amount: num(m[3]), cat: category("", m[1]) });
  });
  if (!id.pan) return { error: { code: "no_pan", text: "No PAN was found in this TIS." } };
  return Object.assign(id, { key: "tis", data: { rows }, read: { sections: summarize(rows.map((r) => ({ name: r.desc, count: 1, total: r.amount }))) } });
}
// ---- Form 26AS: the TRACES text export ("^" between fields) or the PDF's text (two or more spaces between fields)
function as26Text(t) {
  const lines = String(t || "").replace(/\r/g, "").split("\n");
  const out = { pan: "", ay: "", fy: "", name: "" };
  for (let i = 0; i < Math.min(lines.length - 1, 40); i++) {
    if (/Permanent Account Number/i.test(lines[i]) && /\^/.test(lines[i])) {
      const k = lines[i].split("^").map((x) => x.trim()), v = lines[i + 1].split("^").map((x) => x.trim());
      k.forEach((nm, j) => {
        if (/Permanent Account Number/i.test(nm) && PAN_RE.test(v[j] || "")) out.pan = v[j].match(PAN_RE)[1];
        else if (/Name of Assessee/i.test(nm)) out.name = v[j] || "";
        else if (/Assessment Year/i.test(nm)) { const y = yearsFrom(v[j], true); if (y) { out.ay = y.ay; out.fy = y.fy; } }
        else if (/Financial Year/i.test(nm) && !out.fy) { const y = yearsFrom(v[j], false); if (y) { out.fy = y.fy; out.ay = y.ay; } }
      });
      break;
    }
  }
  if (!out.pan || !out.ay) { const id = idFromText(t); out.pan = out.pan || id.pan; out.ay = out.ay || id.ay; out.fy = out.fy || id.fy; out.name = out.name || id.name; }
  const tds = [], tcs = [], paid = [], totals = [];
  let part = "", ded = null;
  lines.forEach((raw) => {
    const line = raw.trim(); if (!line) return;
    const head = line.replace(/\^/g, " ").replace(/\s+/g, " ");
    if (/^PART[-\s]*[IVXA-H0-9]+\b/i.test(head) || /^Details of Tax/i.test(head)) {
      part = /Collected at Source/i.test(head) ? "TCS" : /Tax Paid \(other than TDS or TCS\)|other than TDS/i.test(head) ? "PAID" : /Deducted at Source/i.test(head) && !/15G|15H|194IA|194IB|194IM|194S|Default/i.test(head) ? "TDS" : "";
      ded = null; return;
    }
    if (!part) return;
    const f = /\^/.test(raw) ? raw.split("^").map((x) => x.trim()) : line.split(/\s{2,}/).map((x) => x.trim());
    if (/Name of (Deductor|Collector)|Section\s*\^?\s*Transaction|Sr\.?\s*No|Major Head|BSR Code/i.test(line) && !/\d{2}-[A-Za-z]{3}-\d{4}/.test(line)) return;
    const amts = f.filter((x) => /^-?[\d,]+\.\d{2}$/.test(x)).map(num);
    if (part === "PAID") {
      const bsr = f.find((x) => /^\d{7}$/.test(x)), dt = f.map(dateOf).find(Boolean), minor = f.find((x) => /^(100|300|400)$/.test(x)), serial = f.find((x) => /^\d{5}$/.test(x));
      if (bsr && dt && amts.length) paid.push({ bsr, date: dt, serial: serial || "", minor: minor || "", kind: minor === "100" ? "advance" : minor === "300" ? "self" : "other", amount: amts[amts.length - 1] });
      return;
    }
    const tan = f.find((x) => /^[A-Z]{4}\d{5}[A-Z]$/.test(x));
    if (tan && amts.length >= 2) { ded = { tan, name: f[f.indexOf(tan) - 1] || "", part }; totals.push({ tan, part, amount: amts[amts.length - 3] || 0, tax: amts[amts.length - 2] || 0, deposited: amts[amts.length - 1] || 0 }); return; }
    const sec = f.map(section).find(Boolean), dt = f.map(dateOf).find(Boolean);
    if (ded && sec && dt && amts.length >= 2) {
      const row = { tan: ded.tan, name: ded.name, sec, date: dt, status: f.find((x) => /^[FUPOM]$/.test(x)) || "", amount: amts.length >= 3 ? amts[amts.length - 3] : amts[0], tax: amts[amts.length - 2], deposited: amts[amts.length - 1] };
      (ded.part === "TCS" ? tcs : tds).push(row);
    }
  });
  if (!out.pan) return { error: { code: "no_pan", text: "No PAN was found in this 26AS." } };
  // the file's own totals by deductor: the lines read must add up to them
  const selfCheck = totals.map((x) => { const rows = (x.part === "TCS" ? tcs : tds).filter((r) => r.tan === x.tan); const got = r2(rows.reduce((s, r) => s + r.tax, 0)); return { tan: x.tan, file: x.tax, read: got, ok: Math.abs(got - x.tax) < 0.01 }; });
  const sections = [{ name: "TDS", count: tds.length, total: tds.reduce((s, r) => s + r.tax, 0) }, { name: "TCS", count: tcs.length, total: tcs.reduce((s, r) => s + r.tax, 0) },
    { name: "Advance tax", count: paid.filter((p) => p.kind === "advance").length, total: paid.filter((p) => p.kind === "advance").reduce((s, p) => s + p.amount, 0) },
    { name: "Self-assessment tax", count: paid.filter((p) => p.kind === "self").length, total: paid.filter((p) => p.kind === "self").reduce((s, p) => s + p.amount, 0) }];
  return Object.assign(out, { key: "as26", data: { tds, tcs, paid, selfCheck }, read: { sections: summarize(sections), selfCheckOk: selfCheck.every((x) => x.ok) } });
}
// ---- the e-filing portal's pre-filled data (JSON)
function prefillJson(j) {
  const id = panAy(j), tds = [], tax = [], bank = [];
  // kept: only what the return's JSON needs (date of birth, address, contact, refund bank, TDS and challans); no Aadhaar
  let dob = "", addr = null, email = "", mobile = "";
  const walk = (o, d, path) => {
    if (!o || typeof o !== "object" || d > 10) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, d + 1, path)); return; }
    const ks = Object.keys(o), low = ks.map((k) => k.toLowerCase());
    const get = (re) => { const i = low.findIndex((k) => re.test(k)); return i < 0 ? undefined : o[ks[i]]; };
    if (!dob) { const v = get(/^(dob|dateofbirth|dateofincorporation)$/); if (v && dateOf(v)) dob = dateOf(v); }
    if (!email) { const v = get(/^(email|emailaddress)$/); if (v) email = String(v); }
    if (!mobile) { const v = get(/^(mobile|mobileno)$/); if (v) mobile = String(v); }
    if (!addr && get(/^(pincode|pin)$/) != null) addr = { line: [get(/residenceno|flatdoor|doorno/), get(/roadorstreet|street/), get(/localityorarea|area/)].filter(Boolean).join(", "), city: get(/cityortownordistrict|city/) || "", state: String(get(/statecode|state/) || ""), pin: String(get(/^(pincode|pin)$/) || ""), country: String(get(/countrycode/) || "91") };
    const tan = get(/^tan|tanofdeductor|deductortan$/), ifsc = get(/^ifsc|ifsccode$/), bsr = get(/^bsr|bsrcode$/);
    if (tan && TAN_RE.test(String(tan))) tds.push({ tan: String(tan), name: String(get(/deductorname|name/) || ""), sec: section(get(/section/) || ""), amount: num(get(/^(amount|amountpaid|grossamount|totalamount)$/)) || 0, tax: num(get(/^(taxdeducted|tds|tdsamount|totaltds|claimed)$/)) || 0 });
    else if (bsr) tax.push({ bsr: String(bsr), date: dateOf(get(/date/) || ""), serial: String(get(/serial|challanno/) || ""), amount: num(get(/^(amount|amt|taxpaid)$/)) || 0, kind: /self/i.test(path) ? "self" : /adv/i.test(path) ? "advance" : "" });
    else if (ifsc) bank.push({ ifsc: String(ifsc), account: String(get(/accountno|bankaccountno|account/) || ""), bank: String(get(/bankname/) || "") });
    ks.forEach((k) => { const v = o[k]; if (v && typeof v === "object") walk(v, d + 1, path + "/" + k); });
  };
  walk(j, 0, "");
  if (!id.pan) return { error: { code: "no_pan", text: "No PAN was found in the pre-filled data." } };
  const sections = [{ name: "TDS", count: tds.length, total: tds.reduce((s, r) => s + r.tax, 0) }, { name: "Taxes paid", count: tax.length, total: tax.reduce((s, r) => s + r.amount, 0) }, { name: "Bank accounts", count: bank.length, total: 0 }];
  return Object.assign(id, { key: "prefill", data: { dob, addr, email, mobile, tds, tax, bank }, read: { sections: sections.filter((s) => s.count).map((s) => ({ name: s.name, count: s.count, total: r2(s.total) })) } });
}
// ---- EPFO ECR: the upload text (UAN#~#Name#~#Gross#~#EPF wages#~#EPS wages#~#EDLI wages#~#EPF#~#EPS#~#Diff#~#NCP#~#Refund)
// or the statement CSV / PDF text (a header with the establishment, the wage month and the TRRN; member rows)
function ecrText(t, name) {
  const lines = textLines(t), rows = [];
  let est = "", ym = "", trrn = "", estName = "";
  lines.forEach((ln) => {
    if (/#~#/.test(ln)) {
      const f = ln.split("#~#").map((x) => x.trim());
      if (/^\d{12}$/.test(f[0])) rows.push({ uan: f[0], gross: num(f[2]) || 0, epfWages: num(f[3]) || 0, epsWages: num(f[4]) || 0, edliWages: num(f[5]) || 0, ee: num(f[6]) || 0, eps: num(f[7]) || 0, er: num(f[8]) || 0, ncp: num(f[9]) || 0 });
      return;
    }
    const m1 = ln.match(/Establishment (?:ID|Code)\s*[:,]?\s*([A-Z]{5}\d{7}\d{3}|[A-Z]{5}\d{10})/i); if (m1) est = m1[1].toUpperCase();
    const m2 = ln.match(/Wage Month\s*[:,]?\s*(.+)$/i); if (m2) ym = monthOf(m2[1]);
    const m3 = ln.match(/TRRN\s*(?:No\.?)?\s*[:,]?\s*(\d{13})/i); if (m3) trrn = m3[1];
    const m4 = ln.match(/Establishment Name\s*[:,]?\s*(.+)$/i); if (m4) estName = m4[1].replace(/,+$/, "").trim();
    const c = ln.split(",").map((x) => x.trim());
    if (c.length >= 9 && /^\d{12}$/.test(c[0])) rows.push({ uan: c[0], gross: num(c[2]) || 0, epfWages: num(c[3]) || 0, epsWages: num(c[4]) || 0, edliWages: num(c[5]) || 0, ee: num(c[6]) || 0, eps: num(c[7]) || 0, er: num(c[8]) || 0, ncp: num(c[9]) || 0 });
  });
  if (!ym) ym = monthOf(String(name || "").replace(/[_.]/g, " "));
  if (!rows.length) return { error: { code: "no_rows", text: "No member lines were found in this ECR." } };
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  const sections = [{ name: "Members", count: rows.length, total: tot("gross") }, { name: "Employee share (EPF)", count: rows.length, total: tot("ee") }, { name: "Employer share (EPS + EPF difference)", count: rows.length, total: tot("eps") + tot("er") }];
  return { pan: "", ay: ym ? ayOfMonth(ym) : "", fy: ym ? String(+ayOfMonth(ym) - 1) : "", wageMonth: ym, estCode: est, name: estName, trrn, key: "ecr|" + (ym || "month?"), needMonth: !ym,
    data: { rows: rows.length, gross: r2(tot("gross")), epfWages: r2(tot("epfWages")), ee: r2(tot("ee")), eps: r2(tot("eps")), er: r2(tot("er")) }, read: { sections: summarize(sections) } };
}
// ---- EPFO challan / payment receipt (text or the PDF's text)
function kv(t, re) { const m = t.match(re); return m ? m[1].trim() : ""; }
function pfChallanText(t) {
  const est = kv(t, /Establishment (?:Code|ID)[^:\n]*[:\s]\s*([A-Z]{5}\d{10})/i).toUpperCase();
  const ym = monthOf(kv(t, /Wage Month\s*[:\s]\s*([^\n]+)/i));
  const trrn = kv(t, /TRRN\s*(?:No\.?)?\s*[:\s]\s*(\d{13})/i);
  const paidOn = dateOf(kv(t, /(?:Date of Credit|Payment Date|Date of Payment|Paid on|Realisation Date)\s*[:\s]\s*([0-9A-Za-z\/\- ]{8,12})/i));
  const totalAmt = num(kv(t, /(?:Grand Total|Total Amount|Total Paid)[^:\n]*[:\s]\s*(?:Rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i));
  const acc = {};
  [["01", /A\/?C\s*(?:No\.?)?\s*0?1\b[^\n\d]*([\d,]+(?:\.\d{1,2})?)/i], ["02", /A\/?C\s*(?:No\.?)?\s*0?2\b[^\n\d]*([\d,]+(?:\.\d{1,2})?)/i], ["10", /A\/?C\s*(?:No\.?)?\s*10\b[^\n\d]*([\d,]+(?:\.\d{1,2})?)/i],
    ["21", /A\/?C\s*(?:No\.?)?\s*21\b[^\n\d]*([\d,]+(?:\.\d{1,2})?)/i], ["22", /A\/?C\s*(?:No\.?)?\s*22\b[^\n\d]*([\d,]+(?:\.\d{1,2})?)/i]].forEach(([k, re]) => { const v = num(kv(t, re)); if (v != null) acc[k] = v; });
  const eeShare = num(kv(t, /(?:Employee'?s? Share|EE Share)[^:\n]*[:\s]\s*([\d,]+(?:\.\d{1,2})?)/i));
  if (!trrn || !ym) return { error: { code: "no_trrn", text: "The TRRN or the wage month could not be read from this PF challan." } };
  if (!paidOn) return { error: { code: "no_date", text: "The payment date could not be read from this PF challan. Bring in the payment receipt (it shows the date of credit)." } };
  return { pan: "", ay: ayOfMonth(ym), fy: String(+ayOfMonth(ym) - 1), wageMonth: ym, estCode: est, trrn, key: "pfchallan|" + ym + "|" + trrn, paidOn,
    data: { total: totalAmt || 0, acc, ee: eeShare == null ? null : eeShare, paidOn }, read: { sections: [{ name: "Paid on " + paidOn.slice(6, 8) + "-" + paidOn.slice(4, 6) + "-" + paidOn.slice(0, 4), count: 1, total: r2(totalAmt || 0) }] } };
}
// ---- ESIC challan (text or the PDF's text)
function esicText(t) {
  const code = kv(t, /Employer'?s? Code(?: No\.?)?\s*[:\s]\s*(\d{17})/i);
  const ym = monthOf(kv(t, /(?:Challan Period|Contribution Period|Month)\s*[:\s]\s*([^\n]+)/i));
  const no = kv(t, /Challan (?:Number|No\.?)\s*[:\s]\s*([0-9A-Z]{8,})/i);
  const paidOn = dateOf(kv(t, /(?:Challan Submitted Date|Paid Date|Date of Payment|Transaction Date)\s*[:\s]\s*([0-9A-Za-z\/\- ]{8,12})/i));
  const amt = num(kv(t, /(?:Amount Paid|Total Amount|Amount)\s*[:\s]\s*(?:Rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i));
  const ee = num(kv(t, /Employee'?s? (?:Share|Contribution)\s*[:\s]\s*([\d,]+(?:\.\d{1,2})?)/i)), er = num(kv(t, /Employer'?s? (?:Share|Contribution)\s*[:\s]\s*([\d,]+(?:\.\d{1,2})?)/i));
  const name = kv(t, /Employer'?s? Name\s*[:\s]\s*([^\n]+)/i);
  if (!no || !ym) return { error: { code: "no_challan", text: "The challan number or the contribution month could not be read from this ESI challan." } };
  if (!paidOn) return { error: { code: "no_date", text: "The payment date could not be read from this ESI challan." } };
  return { pan: "", ay: ayOfMonth(ym), fy: String(+ayOfMonth(ym) - 1), wageMonth: ym, estCode: code, name, key: "esic|" + ym + "|" + no, paidOn, challan: no,
    data: { total: amt || 0, ee: ee == null ? null : ee, er: er == null ? null : er, paidOn }, read: { sections: [{ name: "Paid on " + paidOn.slice(6, 8) + "-" + paidOn.slice(4, 6) + "-" + paidOn.slice(0, 4), count: 1, total: r2(amt || 0) }] } };
}

// ---------------- whose file: the client and the year ----------------
// clients: [{id, name, pan, pfCode, esiCode}]; open: the client the page is on; ay: "2026"
// -> {ok: true} or {ok: false, code, text} (the refusal says which)
// confirmed: the person said the file is this client's (only asked for a file that names no PAN and no code)
export function belongs(f, open, clients, ay, confirmed) {
  const want = String(ay || "2026");
  if (!f.pan && !f.estCode && !confirmed) return { ok: false, code: "confirm", confirm: true, text: "This " + f.label + " names no PAN and no establishment code. Is it " + (open.name || "this client") + "'s?" };
  if (f.pan) {
    const p = String(open.pan || "").toUpperCase();
    if (!p) return { ok: false, code: "client_no_pan", text: "This client has no PAN in Client setup. Add it, then bring the file in again." };
    if (f.pan !== p) {
      const other = (clients || []).find((c) => String(c.pan || "").toUpperCase() === f.pan);
      return { ok: false, code: "pan", text: "This " + f.label + " is for PAN " + f.pan + (other ? " (" + other.name + ")" : "") + ", not " + (open.name || "this client") + " (" + p + ")." , other: other ? other.id : "" };
    }
  } else if (f.estCode) {
    const k = f.kind === "esic" ? "esiCode" : "pfCode", mine = String(open[k] || "");
    if (mine && mine !== f.estCode) {
      const other = (clients || []).find((c) => String(c[k] || "") === f.estCode);
      return { ok: false, code: "est", text: "This " + f.label + " is for code " + f.estCode + (other ? " (" + other.name + ")" : "") + ", not this client's " + mine + "." };
    }
    if (!mine) return { ok: true, ask: { key: k, value: f.estCode, text: "Is " + f.estCode + " this client's " + (k === "esiCode" ? "ESI employer code" : "PF establishment code") + "?" } };
  }
  if (!f.ay) return { ok: false, code: "no_ay", text: f.needMonth ? "Which month is this ECR for? FinCom could not read the wage month (name the file with the month, e.g. ECR-04-2025)." : "The assessment year could not be read from this " + f.label + "." };
  if (f.ay !== want) return { ok: false, code: "ay", text: "This " + f.label + " is for AY " + ayLabel(f.ay) + (f.wageMonth ? " (wage month " + f.wageMonth.slice(4, 6) + "-" + f.wageMonth.slice(0, 4) + ")" : "") + ", not AY " + ayLabel(want) + "." };
  return { ok: true };
}
