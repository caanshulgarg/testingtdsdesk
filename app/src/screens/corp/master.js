// "Paste master data": the company's master data as the MCA portal shows it (View Company / LLP Master Data), copied from
// the browser and pasted here. There is no MCA API, so FinCom never fetches it: the person copies the page, FinCom reads
// the labels it knows and shows what it found before anything is kept.
//   readMaster(text) -> {fields: {cin, name, roc, cls, sub, authorised, paidUp, incorporated, office, email, status, lastAgm, lastBs, listed},
//                        directors: [{din, name, desig, appointed}], found: n}
const LABELS = [
  ["cin", /^(?:CIN|Corporate Identification Number)$/i],
  ["name", /^Company Name$/i],
  ["roc", /^ROC(?: Code)?$/i],
  ["category", /^Company Category$/i],
  ["sub", /^Company Sub[- ]?Category$/i],
  ["clsText", /^Class of Company$/i],
  ["authorised", /^Authori[sz]ed Capital\s*\(?(?:Rs|₹|INR)?\.?\)?$/i],
  ["paidUp", /^Paid[- ]up Capital\s*\(?(?:Rs|₹|INR)?\.?\)?$/i],
  ["incorporated", /^Date of Incorporation$/i],
  ["office", /^Registered (?:Office )?Address$/i],
  ["email", /^Email(?: Id| Address)?$/i],
  ["listed", /^Whether Listed or not$/i],
  ["lastAgm", /^Date of (?:last )?AGM$/i],
  ["lastBs", /^Date of Balance Sheet$/i],
  ["status", /^Company Status(?:\s*\(for e-?filing\))?$/i],
];
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "25/09/2025", "25-09-2025", "25-Sep-2025", "2025-09-25" -> "2025-09-25"
export function dayOf(s) {
  const t = String(s || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t); if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  m = /^(\d{1,2})[\s/.-]([A-Za-z]{3})[A-Za-z]*[\s/.,-]*(\d{4})/.exec(t); if (m && MON[m[2].toLowerCase()]) return m[3] + "-" + String(MON[m[2].toLowerCase()]).padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return "";
}
const num = (s) => { const n = Number(String(s || "").replace(/[₹,\s]|Rs\.?/gi, "")); return isFinite(n) ? n : ""; };

export function readMaster(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean), raw = {};
  // a label and its value on one line (tab, colon or two spaces between), or the value on the next line
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/\t+|\s*:\s+|\s{2,}/).map((x) => x.trim()).filter(Boolean);
    for (const [k, re] of LABELS) {
      if (raw[k] != null) continue;
      if (parts.length >= 2 && re.test(parts[0])) { raw[k] = parts.slice(1).join(" "); break; }
      if (parts.length === 1 && re.test(parts[0]) && lines[i + 1] && !LABELS.some(([, r]) => r.test(lines[i + 1]))) { raw[k] = lines[i + 1]; break; }
    }
  }
  // the directors' table: a DIN (8 digits) and a name, with a begin date and designation where shown
  const directors = [];
  lines.forEach((l) => {
    const m = /^(\d{8})\s+(.+?)(?:\s{2,}|\t|$)(.*)$/.exec(l.replace(/\t/g, "  "));
    if (!m || /capital|incorporat/i.test(l)) return;
    const rest = (m[3] || "").split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    const date = rest.map(dayOf).find(Boolean) || "", desig = rest.find((x) => /director|secretary|officer|manager/i.test(x)) || "Director";
    if (!directors.some((d) => d.din === m[1])) directors.push({ din: m[1], name: m[2].replace(/\s+/g, " ").trim(), desig: desig.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of"), appointed: date });
  });
  const f = {};
  if (raw.cin) f.cin = raw.cin.toUpperCase().replace(/\s+/g, "");
  if (raw.name) f.name = raw.name;
  if (raw.roc) f.roc = /^ROC/i.test(raw.roc) ? raw.roc.replace(/^roc[-\s]*/i, "ROC ") : "ROC " + raw.roc;
  const cl = (raw.clsText || "") + " " + (raw.sub || "") + " " + (raw.category || "");
  if (/one person/i.test(cl)) f.cls = "opc"; else if (/section 8|not for profit|licensed/i.test(cl)) f.cls = "section8"; else if (/unlimited/i.test(cl)) f.cls = "unlimited"; else if (/public/i.test(cl)) f.cls = "public"; else if (/private/i.test(cl)) f.cls = "private";
  if (/government/i.test(raw.sub || "")) f.cls = "govt";
  if (raw.authorised !== undefined && num(raw.authorised) !== "") f.authorised = num(raw.authorised);
  if (raw.paidUp !== undefined && num(raw.paidUp) !== "") f.paidUp = num(raw.paidUp);
  if (dayOf(raw.incorporated)) f.incorporated = dayOf(raw.incorporated);
  if (raw.office) f.office = raw.office;
  if (raw.email && /@/.test(raw.email)) f.email = raw.email.trim();
  if (raw.status) f.status = /active/i.test(raw.status) ? "Active" : raw.status;
  if (dayOf(raw.lastAgm)) f.lastAgm = dayOf(raw.lastAgm);
  if (dayOf(raw.lastBs)) f.lastBs = dayOf(raw.lastBs);
  if (raw.listed) f.listed = /^listed/i.test(raw.listed.trim());
  return { fields: f, directors, found: Object.keys(f).length + directors.length };
}
