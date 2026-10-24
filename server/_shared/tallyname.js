// The one rule for matching a FinCom client to its company in Tally (23-Oct-2026, next-fix-tally-link; the owner:
// "Tally linking is still a very big problem"). Used by tally-ingest (server/tally-cloud/index.ts, the computers'
// "companies" report), by the app (Add client, the client's Tally card, TCloud.auto and linkByGstin in src/js/49, through
// build.py SHARED_JS: put at the head of legacy.js, so these are globals there and in the screens) and by the unit test (tests/run_tally_name_rules.mjs). Plain JavaScript, no imports.
//
// Tally names carry the books' period and other noise the client's name does not:
//   "SALESIFY MARKETING LLP - (from 1-Apr-25)"   "VMS EVENTS PRIVATE LIMITED (2024-25)"
//   "Master Cad Infra Solutions Private Limited (FY:25-26)"   "GARG SHEKHAR & COMPANY"
// tallyNameKey strips a trailing period in brackets (any bracket holding a year or a date), "&" and "and", the forms of
// Private Limited / Limited / LLP / Company, punctuation, "M/s" and case, so the same company compares equal.
//
// The rule (autoLinkFor): FinCom links a company to a client by itself only when it is certain:
//   - the company's GSTIN is exactly one live client's GSTIN, or
//   - the company's name, normalised, is exactly one live client's NAME, normalised (the client's typed "Tally name" is
//     not enough: on 23-Oct-2026 a Tally name left over from the Add client form linked VMS EVENTS to Salesify);
// and that client is not linked to another company already, and the GSTINs (when both are known) are one PAN's.
// A company a person unlinked is never linked by itself again (tally-ingest checks linked_at). Everything else is a
// suggestion a person confirms (suggestFor).

const TN_PERIOD = /\s*[-–—:,]?\s*[([{][^()[\]{}]*\d{2}[^()[\]{}]*[)\]}]\s*$/;
const TN_TAIL = /\s*[-–—:,]\s*(?:from|fy|f\.y\.?|for|year)\b.*\d{2}\D*$/i;

function tallyNameKey(s) {
  let t = String(s == null ? "" : s).normalize("NFKC").trim();
  // the period, at the end, repeated: "X (2024-25)", "X - (from 1-Apr-25)", "X (FY:25-26)", "X - from 1-Apr-2025"
  for (let i = 0; i < 3; i++) { const u = t.replace(TN_PERIOD, "").replace(TN_TAIL, ""); if (u === t) break; t = u; }
  t = t.toLowerCase()
    .replace(/^\s*m\s*\/\s*s\.?\s+/, "")
    .replace(/&/g, " and ")
    .replace(/\bl\.\s*l\.\s*p\.?/g, " llp ")
    .replace(/\bpvt\.?\b|\bprivate\b|\(\s*p\s*\)/g, " pvt ")
    .replace(/\bltd\.?\b|\blimited\b/g, " ltd ")
    .replace(/\bco\.(?=\s|$)|\bcompany\b/g, " co ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return t;
}
function sameTallyName(a, b) { const x = tallyNameKey(a); return !!x && x === tallyNameKey(b); }
// one business's years (24-Oct-2026, next-tally-one-page; Suvit: "a split copy can replace the original"): the key with a
// bare year at the end taken off too ("Salesify Marketing LLP 2026-27", "X FY 2026-27", "X 2026"), so a new year's company
// is offered for the client of the year before. Used by the app only (its "New year of <client>"); tallyNameKey, and so
// what FinCom links by itself (autoLinkFor), are unchanged.
function tallyYearKey(s) {
  return tallyNameKey(s).replace(/(?:\s+(?:fy|f y|from|for|year))?\s+(?:(?:19|20)\d\d(?:\s+\d{2,4})?|\d\d\s+\d\d)$/, "").trim();
}

const tnGstKey = (g) => String(g || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const TN_GST = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const tnPan = (g) => { const k = tnGstKey(g); return k.length >= 12 ? k.slice(2, 12) : ""; };
const tnLive = (c) => c && !c.deleted;
const tnNameOf = (c) => String((c && c.name) || "");

// clients: [{id, name, gstin, deleted}]; company: {name, gstin}; linkedClients: the ids already linked to ANOTHER company
// {client, why: "gstin" | "name"} or null
function autoLinkFor(company, clients, linkedClients) {
  const taken = linkedClients instanceof Set ? linkedClients : new Set(linkedClients || []);
  const all = (clients || []).filter(tnLive), g = tnGstKey(company && company.gstin);
  let hit = null, why = "";
  if (TN_GST.test(g)) {
    const m = all.filter((c) => tnGstKey(c.gstin) === g);
    if (m.length === 1) { hit = m[0]; why = "gstin"; }
    else if (m.length > 1) return null;   // two clients with one GSTIN: a person chooses
  }
  if (!hit) {
    const k = tallyNameKey(company && company.name);
    if (!k) return null;
    const m = all.filter((c) => tallyNameKey(tnNameOf(c)) === k);
    if (m.length !== 1) return null;
    hit = m[0]; why = "name";
  }
  if (taken.has(String(hit.id))) return null;
  const a = tnPan(hit.gstin), b = tnPan(company && company.gstin);
  if (a && b && a !== b) return null;
  return { client: hit, why };
}

const tnWords = (s) => tallyNameKey(s).split(" ").filter((w) => w.length > 1 && !["pvt", "ltd", "llp", "co", "the"].includes(w));
// how alike two names are, 0..1: the share of the shorter name's words the other has
function nameScore(a, b) {
  const x = tnWords(a), y = tnWords(b);
  if (!x.length || !y.length) return 0;
  if (tallyNameKey(a) === tallyNameKey(b)) return 1;
  const [s, l] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return s.filter((w) => l.has(w)).length / Math.max(x.length, y.length);
}

// the companies offered for a client, best first: {company, gstin, ..., score, why: "gstin" | "name" | "like" | ""}
// companies: [{company, gstin, client}] (client: the client it is linked to, "" when none). Those linked to another
// client are left out; the rest are all kept (a person may pick any), the likely ones on top.
function suggestFor(co, companies) {
  const id = String((co && co.id) || ""), g = tnGstKey(co && co.gstin), pan = tnPan(co && co.gstin);
  return (companies || []).filter((c) => c && c.company && (!c.client || String(c.client) === id)).map((c) => {
    let score = 0, why = "";
    const cg = tnGstKey(c.gstin);
    if (g && cg && cg === g) { score = 3; why = "gstin"; }
    else if (sameTallyName(c.company, co && co.name) || (co && co.tallyName && sameTallyName(c.company, co.tallyName))) { score = 2; why = "name"; }
    else { const s = Math.max(nameScore(c.company, co && co.name), co && co.tallyName ? nameScore(c.company, co.tallyName) : 0); if (s >= 0.5) { score = 1 + s / 2; why = "like"; } }
    if (pan && cg && tnPan(cg) !== pan) score = Math.min(score, 0);   // another PAN's company: never on top
    return Object.assign({}, c, { score, why });
  }).sort((a, b) => b.score - a.score || String(b.at || "").localeCompare(String(a.at || "")) || a.company.localeCompare(b.company));
}

// the clients a new name (or GSTIN) would duplicate: the same name normalised, or the same GSTIN, then names much alike
// [{client, why: "same" | "gstin" | "like"}]
function similarClients(name, gstin, clients) {
  const k = tallyNameKey(name), g = tnGstKey(gstin), out = [];
  (clients || []).filter(tnLive).forEach((c) => {
    if (g && tnGstKey(c.gstin) === g) out.push({ client: c, why: "gstin" });
    else if (k && tallyNameKey(tnNameOf(c)) === k) out.push({ client: c, why: "same" });
    else if (k && k.length >= 4 && nameScore(name, tnNameOf(c)) >= 0.75) out.push({ client: c, why: "like" });
  });
  const rank = { gstin: 0, same: 1, like: 2 };
  return out.sort((a, b) => rank[a.why] - rank[b.why]);
}

// a client's name from a Tally company's: the period taken off ("SALESIFY MARKETING LLP - (from 1-Apr-25)" →
// "SALESIFY MARKETING LLP")
function clientNameFromTally(company) {
  let t = String(company || "").trim();
  for (let i = 0; i < 3; i++) { const u = t.replace(TN_PERIOD, "").replace(TN_TAIL, "").trim(); if (u === t) break; t = u; }
  return t || String(company || "").trim();
}
export { tallyNameKey, sameTallyName, tallyYearKey, autoLinkFor, nameScore, suggestFor, similarClients, clientNameFromTally };
