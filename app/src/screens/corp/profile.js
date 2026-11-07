// The company's record (Corporate › Company profile): the fields, what FinCom already holds for the client (prefill),
// and what a CIN says by itself. A value typed here is the profile's own; until then the page shows FinCom's (the client's
// PAN, TAN, GSTIN, name and address, the financial statements' details) marked "from FinCom".
export const CLASSES = [["private", "Private company"], ["public", "Public company"], ["opc", "One Person Company"], ["section8", "Section 8 company"], ["unlimited", "Unlimited company"], ["govt", "Government company"]];
export const STATUSES = ["Active", "Under process of striking off", "Dormant (s.455)", "Under liquidation", "Amalgamated"];
export const DESIGNATIONS = ["Director", "Managing Director", "Whole-time Director", "Additional Director", "Independent Director", "Nominee Director", "Alternate Director",
  "Chief Executive Officer", "Chief Financial Officer", "Company Secretary", "Manager"];
// a director holds a DIN; a KMP who is not a director (CEO, CFO, Company Secretary, Manager) does not (no DIR-3 KYC)
export const isDirector = (d) => !/Chief|Company Secretary|^Manager$/.test(String((d && d.desig) || "Director"));

// the Registrar of Companies by the CIN's state code (Companies Act s.2(75); the ROC of each state as notified by MCA). A
// state with two ROCs (Maharashtra: Mumbai / Pune; Tamil Nadu: Chennai / Coimbatore; Andhra Pradesh: Vijayawada, or
// Hyderabad for a company registered before the state was divided) is a list: the person picks (shown "from CIN, check")
export const ROC_OF_STATE = { DL: "ROC Delhi", HR: "ROC Delhi", MH: ["ROC Mumbai", "ROC Pune"], GA: "ROC Goa", TN: ["ROC Chennai", "ROC Coimbatore"], PY: "ROC Puducherry", WB: "ROC Kolkata", GJ: "ROC Ahmedabad", DN: "ROC Ahmedabad", DD: "ROC Ahmedabad",
  KA: "ROC Bengaluru", TG: "ROC Hyderabad", AP: ["ROC Vijayawada", "ROC Hyderabad"], KL: "ROC Ernakulam", LD: "ROC Ernakulam", UP: "ROC Kanpur", UR: "ROC Uttarakhand", UK: "ROC Uttarakhand", RJ: "ROC Jaipur", LA: "ROC Jammu",
  PB: "ROC Chandigarh", CH: "ROC Chandigarh", HP: "ROC Himachal Pradesh", JK: "ROC Jammu", MP: "ROC Gwalior", CT: "ROC Chhattisgarh", CG: "ROC Chhattisgarh", OR: "ROC Cuttack", BR: "ROC Patna",
  JH: "ROC Jharkhand", AS: "ROC Shillong", ML: "ROC Shillong", MN: "ROC Shillong", MZ: "ROC Shillong", NL: "ROC Shillong", TR: "ROC Shillong", AR: "ROC Shillong", SK: "ROC Shillong", AN: "ROC Kolkata" };
// the CIN's type: PTC private, PLC public, OPC, NPL section 8, ULT / ULL unlimited, FTC / FLC a subsidiary of a foreign company
// (private / public), GOI / SGC government, GAP / GAT limited by guarantee (public / private)
const CLASS_OF_CIN = { PTC: "private", PLC: "public", OPC: "opc", NPL: "section8", ULT: "unlimited", ULL: "unlimited", FTC: "private", FLC: "public", GOI: "govt", SGC: "govt", GAP: "public", GAT: "private" };

// what a CIN (21 characters: L/U, NIC 5 digits, state 2, year 4, type 3, number 6) says: listed, the activity's NIC code,
// the ROC, the year of incorporation, the class
export function cinInfo(cin) {
  const c = String(cin || "").toUpperCase().replace(/\s+/g, "");
  const m = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/.exec(c);
  if (!m) return null;
  const r = ROC_OF_STATE[m[3]] || "", rocs = Array.isArray(r) ? r : r ? [r] : [];
  return { listed: m[1] === "L", nic: m[2], state: m[3], roc: rocs.length === 1 ? rocs[0] : "", rocs, rocCheck: rocs.length > 1, year: m[4], cls: CLASS_OF_CIN[m[5]] || "", type: m[5], foreignSub: /^F[TL]C$/.test(m[5]) };
}
export const cinOk = (cin) => !!cinInfo(cin);

// what FinCom already holds for the client: the client's own details (Client setup) and the financial statements'
// details (Statements › Company & auditor, b.fs.inputs) when its books are open on this page
export function prefill(co) {
  const b = typeof S === "object" && S.books && S.books.cid === co.id ? S.books : null, t = (b && b.fs && b.fs.inputs) || {};
  const pan = co.pan || String(co.gstin || "").slice(2, 12);
  const out = { name: t.name || co.name || "", cin: t.cin || co.cin || "", pan: t.pan || pan || "", tan: co.tan || "", gstin: co.gstin || "", office: t.address || co.address || co.addr || "",
    auditor: (t.auditor && t.auditor.firm) || "", auditorFrn: (t.auditor && t.auditor.frn) || "", face: (t.shares && t.shares.face) || "", authorised: (t.shares && t.shares.authorised) || "" };
  const ci = cinInfo(out.cin);
  if (ci) Object.assign(out, { cls: ci.cls, roc: ci.roc, nic: ci.nic });
  out.directors = (t.directors || []).filter((d) => d && d.name).map((d) => ({ name: d.name, din: d.din || "", desig: d.desig || "Director" }));
  out.shareholders = ((t.shares && t.shares.holders) || []).filter((h) => h && h.name).map((h) => ({ name: h.name, shares: +h.n || 0 }));
  return out;
}

// a profile field as shown: the profile's own value, else FinCom's (with where it came from)
export function val(p, pre, k) {
  const own = p[k];
  if (own !== undefined && own !== null && own !== "") return { v: own, from: "" };
  const x = pre[k];
  return x !== undefined && x !== null && x !== "" ? { v: x, from: "fincom" } : { v: "", from: "" };
}

export const money = (n) => (n === "" || n == null || isNaN(+n) ? "" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(+n));
export const count = (n) => new Intl.NumberFormat("en-IN").format(+n || 0);

// the last AGM held: {fy, date} from profile.agms {fy: date}
export function lastAgm(p) {
  const e = Object.entries(p.agms || {}).filter(([, d]) => d).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  return e ? { fy: e[0], date: e[1] } : null;
}
export const sharesTotal = (p) => (p.shareholders || []).reduce((s, h) => s + (+h.shares || 0), 0);
export const openCharges = (p) => (p.charges || []).filter((c) => c && !c.satisfied);
