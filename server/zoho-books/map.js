// Zoho Books (India) into FinCom's cloud copy of the books: the SAME rows the Tally bridge writes (tally_vouchers,
// tally_lines, tally_bills, tally_ledgers, tally_groups), so TDS, GST, MIS, the due list and posting read a Zoho client
// exactly as a Tally client. Plain JavaScript with one import: used by the zoho-books edge function (Deno) and by the
// tests (Node: tests/run_zoho_map.mjs). No network, no database: Zoho's JSON in, rows out.
//
// The rows are the shapes tally_ingest_entries (migration 48/56/57) takes:
//   voucher {guid, day, alter, type, no, party, narr, cancel, opt, gstin, pos, ref, refDate, cmp, fid, gst}
//   line    [guid, ledger, amount, hsn, rate, bills]      amount in Tally's sign: a DEBIT IS NEGATIVE
//   bill    [name, "New Ref" | "Agst Ref" | "Advance" | "On Account", amount (the line's sign), credit days]
// One entry per Zoho document: guid "zoho-<entity>-<zoho id>", alter = its last_modified_time in seconds (a later
// version wins in FinCom, as Tally's AlterID). Voucher types are Tally's: Sales, Purchase, Credit Note, Debit Note,
// Receipt, Payment, Contra, Journal.
//
// Ledgers. Every Zoho account is a ledger under the Tally group its account type is (accountGroup); every Zoho contact
// is a party ledger (Sundry Debtors / Sundry Creditors) carrying its GSTIN, PAN and TDS settings; the GST taxes are the
// ledgers Tally clients keep ("Output CGST", "Input IGST", "CGST RCM Payable"...), so FinCom proposes what each one is
// from its name, exactly as for a Tally company; TDS taxes go to "TDS Payable <section>" and TCS to "TCS Payable <section>".
// GST type (gst_treatment, place of supply, reverse charge, goods or services, ineligible credit) is Zoho's own, kept in
// the entry's "gst" object (migration 72's columns), never guessed.
import { namesClean, namesKey } from "../_shared/names.js";

export const r2 = (x) => Math.round((Number(x) || 0) * 100 + (x >= 0 ? 1e-9 : -1e-9)) / 100;
export function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
const str = (v) => namesClean(v == null ? "" : String(v));
const low = (v) => String(v == null ? "" : v).trim().toLowerCase();

// Zoho's two-letter place-of-supply codes (India) as the state names FinCom's GST code keys on (STATE_CODES, src/js/12)
export const ZOHO_STATES = {AN: "ANDAMAN AND NICOBAR ISLANDS", AP: "ANDHRA PRADESH", AD: "ANDHRA PRADESH", AR: "ARUNACHAL PRADESH", AS: "ASSAM", BR: "BIHAR",
  CH: "CHANDIGARH", CG: "CHHATTISGARH", CT: "CHHATTISGARH", DN: "DADRA AND NAGAR HAVELI AND DAMAN AND DIU", DD: "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
  DL: "DELHI", DU: "DELHI", GA: "GOA", GJ: "GUJARAT", HR: "HARYANA", HP: "HIMACHAL PRADESH", JK: "JAMMU AND KASHMIR", JH: "JHARKHAND", KA: "KARNATAKA",
  KL: "KERALA", LA: "LADAKH", LD: "LAKSHADWEEP", MP: "MADHYA PRADESH", MH: "MAHARASHTRA", MN: "MANIPUR", ML: "MEGHALAYA", MZ: "MIZORAM", NL: "NAGALAND",
  OD: "ODISHA", OR: "ODISHA", PY: "PUDUCHERRY", PB: "PUNJAB", RJ: "RAJASTHAN", SK: "SIKKIM", TN: "TAMIL NADU", TS: "TELANGANA", TG: "TELANGANA",
  TR: "TRIPURA", UP: "UTTAR PRADESH", UK: "UTTARAKHAND", UT: "UTTARAKHAND", WB: "WEST BENGAL", OT: "OTHER TERRITORY"};
export const STATE_NO = {"JAMMU AND KASHMIR": "01", "HIMACHAL PRADESH": "02", "PUNJAB": "03", "CHANDIGARH": "04", "UTTARAKHAND": "05", "HARYANA": "06", "DELHI": "07",
  "RAJASTHAN": "08", "UTTAR PRADESH": "09", "BIHAR": "10", "SIKKIM": "11", "ARUNACHAL PRADESH": "12", "NAGALAND": "13", "MANIPUR": "14", "MIZORAM": "15",
  "TRIPURA": "16", "MEGHALAYA": "17", "ASSAM": "18", "WEST BENGAL": "19", "JHARKHAND": "20", "ODISHA": "21", "CHHATTISGARH": "22", "MADHYA PRADESH": "23",
  "GUJARAT": "24", "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "26", "MAHARASHTRA": "27", "KARNATAKA": "29", "GOA": "30", "LAKSHADWEEP": "31",
  "KERALA": "32", "TAMIL NADU": "33", "PUDUCHERRY": "34", "ANDAMAN AND NICOBAR ISLANDS": "35", "TELANGANA": "36", "ANDHRA PRADESH": "37", "LADAKH": "38", "OTHER TERRITORY": "97"};
// the Zoho place-of-supply code of a GSTIN's state ("27AAAC..." -> "MH"); "" when none
export function zohoStateOf(gstin){ const n = String(gstin || "").slice(0, 2); return Object.keys(ZOHO_STATES).find(k => STATE_NO[ZOHO_STATES[k]] === n) || ""; }
export function posName(code){ const c = String(code || "").trim().toUpperCase(); return ZOHO_STATES[c] || (STATE_NO[c] ? c : ""); }

// Zoho's account types as Tally's primary groups (what the GST, TDS and MIS code reads a ledger by)
export function accountGroup(a){
  const t = low(a && a.account_type), n = low(a && a.account_name);
  if (t === "bank" || t === "payment_clearing") return "Bank Accounts";
  if (t === "credit_card" || t === "prepaid_card") return "Bank OD A/c";
  if (t === "cash") return "Cash-in-Hand";
  if (t === "accounts_receivable") return "Sundry Debtors";
  if (t === "accounts_payable") return "Sundry Creditors";
  if (t === "income") return /\bsales?\b|revenue|turnover/.test(n) ? "Sales Accounts" : "Direct Incomes";
  if (t === "other_income") return "Indirect Incomes";
  if (t === "cost_of_goods_sold") return /purchase/.test(n) ? "Purchase Accounts" : "Direct Expenses";
  if (t === "expense" || t === "other_expense") return /purchase/.test(n) ? "Purchase Accounts" : "Indirect Expenses";
  if (t === "fixed_asset") return "Fixed Assets";
  if (t === "stock") return "Stock-in-Hand";
  if (t === "equity") return "Capital Account";
  if (t === "long_term_liability") return "Loans (Liability)";
  if ((t === "other_current_asset" || t === "other_asset") && /receivable|refund|advance/.test(n)) return "Loans & Advances (Asset)";
  if (t === "input_tax" || t === "output_tax" || t === "overseas_tax_payable" || /\b(gst|cgst|sgst|igst|utgst|cess|tds|tcs)\b|tax payable|tax receivable|input tax|output tax/.test(n)) return "Duties & Taxes";
  if (t === "other_current_liability" || t === "other_liability") return "Current Liabilities";
  if (t === "other_current_asset") return /deposit/.test(n) ? "Deposits (Asset)" : /advance|prepaid/.test(n) ? "Loans & Advances (Asset)" : "Current Assets";
  if (t === "other_asset") return "Current Assets";
  return "Suspense A/c";
}
// the primary groups and the parent Tally gives each (Tally's own tree; '' = primary)
export const PRIMARY = {"Bank Accounts": "Current Assets", "Bank OD A/c": "Loans (Liability)", "Cash-in-Hand": "Current Assets", "Sundry Debtors": "Current Assets",
  "Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Deposits (Asset)": "Current Assets", "Loans & Advances (Asset)": "Current Assets",
  "Stock-in-Hand": "Current Assets", "Current Assets": "", "Current Liabilities": "", "Sales Accounts": "", "Purchase Accounts": "", "Direct Incomes": "", "Indirect Incomes": "",
  "Direct Expenses": "", "Indirect Expenses": "", "Fixed Assets": "", "Capital Account": "", "Loans (Liability)": "", "Suspense A/c": ""};

// ---------------------------------------------------------------- the GST and TDS ledgers, by Zoho's tax
const HEAD = {cgst: "CGST", sgst: "SGST", utgst: "SGST", igst: "IGST", cess: "Cess"};
export function taxHead(t){
  const s = low(t && (t.tax_specific_type || t.tax_type_name || t.gst_tax_type));
  if (HEAD[s]) return HEAD[s];
  const n = String((t && t.tax_name) || "").toUpperCase();
  if (/\bCGST/.test(n)) return "CGST"; if (/\b(SGST|UTGST)/.test(n)) return "SGST"; if (/\bIGST/.test(n)) return "IGST"; if (/\bCESS/.test(n)) return "Cess";
  return "";
}
// the ledger a GST head goes to: on sales "Output CGST", on purchases "Input CGST"; reverse charge: the input credit
// "Input CGST" and the liability "CGST RCM Payable" (the names FinCom proposes as GST input / output / reverse charge)
export function gstLedger(head, side){ return side === "rcm" ? head + " RCM Payable" : (side === "output" ? "Output " : "Input ") + head; }
// a section in a TDS tax's name or its own field: "194C", "194J", "194Q", "195", "206C(1H)"
export function sectionOf(t){
  const s = [t && t.tds_section, t && t.section, t && t.tds_section_name, t && t.tax_name, t && t.tax_section].map(x => String(x || "")).join(" ");
  const m = s.match(/(?:section[_\s]*)?(19[2-6][A-Z]{0,3}|206C(?:\s*\(\s*1H?\s*\)|_?1H)?|393\s*\(\s*\d\s*\))/i);
  if (!m) return "";
  let x = m[1].toUpperCase().replace(/\s+/g, "").replace(/_1H$/, "(1H)");
  return x;
}
export function tdsLedger(t){ const s = sectionOf(t); return (/^206C/.test(s) ? "TCS Payable " : "TDS Payable ") + (s || String((t && t.tax_name) || "Other").trim()); }

// ---------------------------------------------------------------- the organisation's masters
// ctx: everything a document needs to be read: {org, accounts: by id, contacts: by id, taxes: by id, tds: by id,
// ledgerOfAccount(id), ledgerOfContact(id), cmp: the organisation's GSTIN}
export function makeCtx(m){
  m = m || {};
  const ctx = {org: m.org || {}, accounts: {}, contacts: {}, taxes: {}, tds: {}, accLed: {}, conLed: {}, notes: []};
  ctx.cmp = String((m.org && (m.org.gst_no || m.org.tax_reg_no || m.org.gstin)) || m.cmpGstin || "").toUpperCase().trim();
  ctx.orgState = (posName((m.org && (m.org.place_of_supply || m.org.state_code)) || "") || (STATE_NO[(m.org && m.org.state) || ""] ? m.org.state : "")) || stateOfGstin(ctx.cmp);
  (m.taxes || []).forEach(t => { if (t && t.tax_id) ctx.taxes[String(t.tax_id)] = t; });
  (m.tdsTaxes || []).forEach(t => { if (t && t.tax_id) ctx.tds[String(t.tax_id)] = t; });
  const used = new Map();     // ledger key -> who has it
  const known = m.known || {};       // the ledger each account ("a<id>") and contact ("c<id>") was given before: kept
  Object.entries(known).forEach(([who, n]) => { if (n) used.set(namesKey(n), who); });
  const take = (name, who) => {
    if (known[who]) return known[who];
    let n = str(name) || who;
    if (used.has(namesKey(n)) && used.get(namesKey(n)) !== who) n = n + " (" + String(who).slice(-4) + ")";
    used.set(namesKey(n), who); return n;
  };
  (m.accounts || []).forEach(a => {
    if (!a || !a.account_id) return;
    ctx.accounts[String(a.account_id)] = a;
  });
  // accounts first (their names are the books' ledgers), then contacts (a contact named as an account is told apart)
  Object.values(ctx.accounts).forEach(a => { ctx.accLed[String(a.account_id)] = take(a.account_name, "a" + a.account_id); });
  (m.contacts || []).forEach(c => {
    if (!c || !c.contact_id) return;
    ctx.contacts[String(c.contact_id)] = c;
    let nm = str(c.contact_name || c.company_name || c.vendor_name || c.customer_name);
    if (!known["c" + c.contact_id] && used.has(namesKey(nm)) && String(used.get(namesKey(nm))).startsWith("a")) nm = nm + " (party)";
    ctx.conLed[String(c.contact_id)] = take(nm, "c" + c.contact_id);
  });
  return ctx;
}
function stateOfGstin(g){ const c = String(g || "").slice(0, 2); return Object.keys(STATE_NO).find(k => STATE_NO[k] === c) || ""; }
export function accLedger(ctx, id, fallbackName){
  if (id != null && ctx.accLed[String(id)]) return ctx.accLed[String(id)];
  return str(fallbackName) || "Suspense A/c";
}
export function conLedger(ctx, id, fallbackName){
  if (id != null && ctx.conLed[String(id)]) return ctx.conLed[String(id)];
  return str(fallbackName) || "";
}
function contactOf(ctx, id){ return (id != null && ctx.contacts[String(id)]) || {}; }
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/, GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
export function contactPan(c){
  const p = String(c.pan_no || c.pan || c.pan_number || "").toUpperCase().trim();
  if (PAN_RE.test(p)) return p;
  const g = String(c.gst_no || c.gstin || "").toUpperCase().trim();
  return GSTIN_RE.test(g) ? g.slice(2, 12) : "";
}
// the ledgers and groups of the organisation, as the cloud copy keeps them:
//   ledgers [{name, parent, open, gstin, pan, tds_nature, zoho_id, kind}]   groups [[name, parent]]
//   objects [{kind: account|contact|tax|tds_tax|gst_ledger, zoho_id, name, ledger, data}] (what posting looks up)
// open: the opening balance on the books' first day in Tally's sign (a debit negative), from Zoho's opening balances
export function orgLedgers(ctx, opening){
  const out = [], objects = [], groups = new Map(), seen = new Set();
  const add = (l) => { const k = namesKey(l.name); if (seen.has(k)) return; seen.add(k); out.push(l); let g = l.parent; for (let i = 0; g && i < 4; i++){ if (!groups.has(g)) groups.set(g, PRIMARY[g] || ""); g = PRIMARY[g] || ""; } };
  const open = {};
  ((opening && opening.accounts) || []).forEach(o => {
    const id = String(o.account_id || ""), a = num(o.bcy_amount != null ? o.bcy_amount : o.amount);
    if (!id) return;
    open[id] = r2((open[id] || 0) + (low(o.debit_or_credit) === "debit" ? -Math.abs(a) : Math.abs(a)));
  });
  Object.values(ctx.accounts).forEach(a => {
    const id = String(a.account_id), name = ctx.accLed[id];
    add({name, parent: accountGroup(a), open: open[id] || 0, gstin: "", pan: "", tds_nature: null, zoho_id: id, kind: "account"});
    objects.push({kind: "account", zoho_id: id, name: str(a.account_name), ledger: name, data: {account_type: a.account_type || "", account_code: a.account_code || "", is_active: a.is_active !== false}});
  });
  Object.values(ctx.contacts).forEach(c => {
    const id = String(c.contact_id), name = ctx.conLed[id], vendor = low(c.contact_type) === "vendor";
    const g = String(c.gst_no || c.gstin || "").toUpperCase().trim(), tdsT = ctx.tds[String(c.tds_tax_id || "")];
    add({name, parent: vendor ? "Sundry Creditors" : "Sundry Debtors", open: 0, gstin: GSTIN_RE.test(g) ? g : "", pan: contactPan(c),
      tds_nature: tdsT ? (sectionOf(tdsT) || str(tdsT.tax_name)) : null, zoho_id: id, kind: "contact"});
    objects.push({kind: "contact", zoho_id: id, name: str(c.contact_name), ledger: name, data: {contact_type: c.contact_type || "", gst_no: g, pan_no: contactPan(c), gst_treatment: c.gst_treatment || "",
      place_of_contact: c.place_of_contact || c.place_of_supply || "", country: c.country || (c.billing_address && c.billing_address.country) || "", tds_tax_id: c.tds_tax_id || "", modified: modSec(c.last_modified_time)}});
  });
  // the GST ledgers every Zoho India organisation books to, and its TDS / TCS taxes
  const heads = new Set(["CGST", "SGST", "IGST"]);
  Object.values(ctx.taxes).forEach(t => { const h = taxHead(t); if (h) heads.add(h); objects.push({kind: "tax", zoho_id: String(t.tax_id), name: str(t.tax_name), ledger: "", data: {head: h, pct: num(t.tax_percentage), tax_type: t.tax_type || "", tax_specific_type: t.tax_specific_type || "", taxes: (t.taxes || t.tax_group_details || []).map(x => ({tax_id: String(x.tax_id || x)}))}}); });
  heads.forEach(h => {
    [["output", "Output " + h], ["input", "Input " + h], ["rcm", h + " RCM Payable"]].forEach(([side, nm]) => {
      if (side === "rcm" && h === "Cess") return;
      add({name: nm, parent: "Duties & Taxes", open: 0, gstin: "", pan: "", tds_nature: null, zoho_id: null, kind: "gst"});
      objects.push({kind: "gst_ledger", zoho_id: h + ":" + side, name: nm, ledger: nm, data: {head: h, side}});
    });
  });
  Object.values(ctx.tds).forEach(t => {
    const nm = tdsLedger(t);
    add({name: nm, parent: "Duties & Taxes", open: 0, gstin: "", pan: "", tds_nature: sectionOf(t) || str(t.tax_name), zoho_id: null, kind: "tds"});
    objects.push({kind: "tds_tax", zoho_id: String(t.tax_id), name: str(t.tax_name), ledger: nm, data: {section: sectionOf(t), pct: num(t.tax_percentage), tds_section: t.tds_section || sectionOf(t)}});
  });
  ["Rounding Off", "TDS Receivable", "Discount Allowed", "Discount Received", "Bank Charges"].forEach(nm => add({name: nm, parent: nm === "TDS Receivable" ? "Loans & Advances (Asset)" : nm === "Discount Received" ? "Indirect Incomes" : "Indirect Expenses", open: 0, gstin: "", pan: "", tds_nature: null, zoho_id: null, kind: "fixed"}));
  return {ledgers: out, groups: Array.from(groups.entries()), objects};
}

// the masters as zoho_objects keeps them, back into makeCtx's input (so a run reads only the contacts that changed)
export function mastersFromObjects(objs){
  const out = {accounts: [], contacts: [], taxes: [], tdsTaxes: [], known: {}};
  (objs || []).forEach(o => {
    const d = o.data || {};
    if (o.kind === "account"){ out.accounts.push(Object.assign({account_id: o.id, account_name: o.name}, d)); if (o.ledger) out.known["a" + o.id] = o.ledger; }
    else if (o.kind === "contact"){ out.contacts.push(Object.assign({contact_id: o.id, contact_name: o.name}, d)); if (o.ledger) out.known["c" + o.id] = o.ledger; }
    else if (o.kind === "tax") out.taxes.push({tax_id: o.id, tax_name: o.name, tax_percentage: d.pct, tax_type: d.tax_type, tax_specific_type: d.tax_specific_type, taxes: d.taxes || []});
    else if (o.kind === "tds_tax") out.tdsTaxes.push({tax_id: o.id, tax_name: o.name, tax_percentage: d.pct, tds_section: d.tds_section || d.section});
  });
  return out;
}

// ---------------------------------------------------------------- one document
// what each Zoho list is, how FinCom names it, and which fields carry its id, number, date and modified time
export const ENTITIES = {
  invoices:         {one: "invoice",         path: "invoices",         list: "invoices",         key: "invoice",         id: "invoice_id",       no: "invoice_number",       date: "date"},
  creditnotes:      {one: "creditnote",      path: "creditnotes",      list: "creditnotes",      key: "creditnote",      id: "creditnote_id",    no: "creditnote_number",    date: "date"},
  bills:            {one: "bill",            path: "bills",            list: "bills",            key: "bill",            id: "bill_id",          no: "bill_number",          date: "date"},
  vendorcredits:    {one: "vendor_credit",   path: "vendorcredits",    list: "vendor_credits",   key: "vendor_credit",   id: "vendor_credit_id", no: "vendor_credit_number", date: "date"},
  customerpayments: {one: "payment",         path: "customerpayments", list: "customerpayments", key: "payment",         id: "payment_id",       no: "payment_number",       date: "date"},
  vendorpayments:   {one: "vendorpayment",   path: "vendorpayments",   list: "vendorpayments",   key: "vendorpayment",   id: "payment_id",       no: "payment_number",       date: "date"},
  expenses:         {one: "expense",         path: "expenses",         list: "expenses",         key: "expense",         id: "expense_id",       no: "reference_number",     date: "date"},
  journals:         {one: "journal",         path: "journals",         list: "journals",         key: "journal",         id: "journal_id",       no: "entry_number",         date: "journal_date"},
  banktransactions: {one: "banktransaction", path: "banktransactions", list: "banktransactions", key: "banktransaction", id: "transaction_id",   no: "reference_number",     date: "date"}
};
// a list or a document out of Zoho's answer: by its documented key, else the one array (or object) the answer carries
export function listOf(ans, key){
  if (!ans || typeof ans !== "object") return [];
  if (Array.isArray(ans[key])) return ans[key];
  const k = Object.keys(ans).find(x => Array.isArray(ans[x]) && x !== "page_context");
  return k ? ans[k] : [];
}
export function oneOf(ans, key){
  if (!ans || typeof ans !== "object") return null;
  if (ans[key] && typeof ans[key] === "object" && !Array.isArray(ans[key])) return ans[key];
  const k = Object.keys(ans).find(x => ans[x] && typeof ans[x] === "object" && !Array.isArray(ans[x]) && x !== "page_context");
  return k ? ans[k] : null;
}
// the bank lines that are entries of their own (the rest come with their own document)
export function ownBankLine(row){ return OWN_BANK.has(low(row && row.transaction_type)); }
export const ENTITY_ORDER = ["invoices", "creditnotes", "bills", "vendorcredits", "customerpayments", "vendorpayments", "expenses", "journals", "banktransactions"];
export function guidOf(entity, id){ return "zoho-" + ENTITIES[entity].one.replace(/_/g, "") + "-" + String(id); }
// Zoho's "2026-05-01T10:20:30+0530" as seconds (the entry's version); 0 when absent
export function modSec(s){
  const t = String(s || "").trim(); if (!t) return 0;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  const iso = m ? m[1] + "T" + (m[2].length === 5 ? m[2] + ":00" : m[2]) + (m[3] ? (m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "+05:30") : t;
  const ms = Date.parse(iso);
  return isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
const d8 = (s) => String(s || "").replace(/-/g, "").slice(0, 8);
const isoDay = (s) => { const x = d8(s); return /^\d{8}$/.test(x) ? x.slice(0, 4) + "-" + x.slice(4, 6) + "-" + x.slice(6, 8) : ""; };
function days(a, b){ const x = Date.parse(isoDay(a)), y = Date.parse(isoDay(b)); return isFinite(x) && isFinite(y) ? Math.round((y - x) / 86400000) : null; }
// FinCom's own mark on what it posted: reference "FC:<id>" or "TDSDesk:<id>" in the notes (as Tally's narration)
export function fincomIdOf(doc){
  const r = String((doc && doc.reference_number) || "").match(/^FC:([A-Za-z0-9._-]{1,80})$/);
  if (r) return r[1];
  const m = String([(doc && doc.notes) || "", (doc && doc.description) || ""].join(" ")).match(/TDSDesk:([A-Za-z0-9._-]{1,80})/);
  return m ? m[1] : null;
}

// the GST type of a document, as migration 72 keeps it ({reg, country, rcm, nature, taxability, supply, ineligible, mixed})
const REG = {business_gst: "Regular", business_registered_regular: "Regular", business_registered_composition: "Composition", business_composition: "Composition",
  business_none: "Unregistered", business_unregistered: "Unregistered", consumer: "Consumer", overseas: "Unregistered", business_sez: "Regular", deemed_export: "Regular",
  tax_deductor: "Regular", sez_developer: "Regular"};
function lineTreatment(li){
  const s = low([li.tax_exemption_code, li.gst_treatment_code, li.tax_treatment_code, li.item_tax_preference, li.exemption_type].filter(Boolean).join(" "));
  if (/non.?gst|out.?of.?scope/.test(s)) return "Non-GST";
  if (/nil/.test(s)) return "Nil Rated";
  if (/exempt/.test(s)) return "Exempt";
  return "";
}
function supplyOf(li){ const p = low(li.product_type || li.item_type); return /service/.test(p) ? "Services" : /goods|inventory|sales/.test(p) ? "Goods" : ""; }
export function gstType(doc, ctx, lines, opts){
  const tr = low(doc.gst_treatment || contactOf(ctx, doc.customer_id || doc.vendor_id).gst_treatment);
  const sup = Array.from(new Set((lines || []).map(supplyOf).filter(Boolean)));
  const tx = Array.from(new Set((lines || []).map(li => lineTreatment(li) || (taxRate(li, ctx) > 0 ? "Taxable" : "")).filter(Boolean)));
  const taxability = tx.length === 1 && tx[0] !== "Taxable" ? tx[0] : (tx.length ? "Taxable" : "");
  const withTax = !!(opts && opts.withTax);
  let nature = "";
  if (tr === "business_sez" || tr === "sez_developer") nature = (opts && opts.inward ? "Purchase from SEZ" : "Sales to SEZ") + (withTax ? " - Taxable" : " - LUT/Bond");
  else if (tr === "overseas") nature = opts && opts.inward ? "Imports" + (sup[0] === "Services" ? " - Services" : " - Taxable") : "Exports" + (withTax ? " - Taxable" : " - LUT/Bond");
  else if (tr === "deemed_export") nature = "Deemed Exports" + (withTax ? " - Taxable" : " - Exempt");
  const country = tr === "overseas" ? (str((doc.billing_address && doc.billing_address.country) || (doc.shipping_address && doc.shipping_address.country) || contactOf(ctx, doc.customer_id || doc.vendor_id).country) || "Outside India") : "India";
  return {reg: REG[tr] || (tr ? "Regular" : ""), country, rcm: !!(opts && opts.rcm), nature, taxability, supply: sup.length === 1 ? sup[0] : "",
    ineligible: (lines || []).some(li => /ineligible|blocked|17\(5\)|17_5/.test(low(li.itc_eligibility))), mixed: tx.length > 1 || sup.length > 1};
}

// a line's tax: its tax (or tax group) as the GST heads with their percentages
export function taxParts(taxId, ctx, pctHint){
  const t = ctx.taxes[String(taxId || "")];
  if (!t){
    if (num(pctHint) > 0) return [{head: "IGST", pct: num(pctHint), guessed: true}];
    return [];
  }
  const kids = (t.taxes || t.tax_group_details || []);
  if (kids.length){
    return kids.map(k => { const kt = ctx.taxes[String(k.tax_id || k)] || k; return {head: taxHead(kt), pct: num(kt.tax_percentage)}; }).filter(p => p.head && p.pct);
  }
  const h = taxHead(t);
  return h && num(t.tax_percentage) ? [{head: h, pct: num(t.tax_percentage)}] : [];
}
// the GST rate of a line as one figure (the IGST rate: 9 + 9 is 18), cess apart
export function taxRate(li, ctx){ return r2(taxParts(li.tax_id, ctx, li.tax_percentage).filter(p => p.head !== "Cess").reduce((a, p) => a + p.pct, 0)); }

// the items and their tax, in the shape every document with line_items shares: [{ledger, amount (positive), hsn, rate,
// supply, tax: {head: amount}}] and the totals per head. A discount before tax is taken off the items (so the sales or
// purchase ledgers hold the taxable value, as Tally's do); the head totals are Zoho's own "taxes" where it gives them,
// the per-line split rounded so the lines add up to them to the paisa
function itemsOf(doc, ctx, accField){
  const lis = (doc.line_items || []).filter(li => li && (li.item_total != null || li.amount != null || li.rate != null));
  const raw = lis.map(li => r2(li.item_total != null ? num(li.item_total) : num(li.rate) * (li.quantity == null ? 1 : num(li.quantity))));
  const before = doc.is_discount_before_tax !== false;
  const disc = r2(num(doc.discount_amount != null ? doc.discount_amount : doc.discount_total));
  const sub = r2(raw.reduce((a, x) => a + x, 0));
  let left = before ? disc : 0;
  const items = lis.map((li, i) => {
    let a = raw[i];
    if (before && disc && sub){ const share = i === lis.length - 1 ? left : r2(disc * raw[i] / sub); a = r2(a - share); left = r2(left - share); }
    return {li, ledger: accLedger(ctx, li[accField] || li.account_id, li.account_name), amount: a, hsn: String(li.hsn_or_sac || "").trim(), rate: taxRate(li, ctx), supply: supplyOf(li), tax: {}};
  });
  // each head's tax: per line at its percentage, then made to add to Zoho's figure for the head
  const heads = {};
  items.forEach(it => {
    taxParts(it.li.tax_id, ctx, it.li.tax_percentage).forEach(p => { const v = it.amount * p.pct / 100; it.tax[p.head] = (it.tax[p.head] || 0) + v; heads[p.head] = (heads[p.head] || 0) + v; });
  });
  const zohoHeads = {};
  (doc.taxes || []).forEach(t => {
    const tt = ctx.taxes[String(t.tax_id || "")] || t, h = taxHead(tt) || taxHead({tax_name: t.tax_name});
    if (h) zohoHeads[h] = r2((zohoHeads[h] || 0) + num(t.tax_amount));
  });
  Object.keys(heads).forEach(h => {
    const want = zohoHeads[h] != null ? zohoHeads[h] : r2(heads[h]);
    let rest = want;
    const withH = items.filter(it => it.tax[h]);
    withH.forEach((it, i) => { const v = i === withH.length - 1 ? rest : r2(it.tax[h]); it.tax[h] = v; rest = r2(rest - v); });
    heads[h] = want;
  });
  Object.keys(zohoHeads).forEach(h => { if (heads[h] == null && zohoHeads[h]) heads[h] = zohoHeads[h]; });     // a head Zoho booked that no line names
  return {items, heads, discountAfter: before ? 0 : disc};
}

// one document as the cloud copy's entry; {skip: why} for a document that is not in the books (a draft); {voucher, lines,
// notes} otherwise. A void document is kept as a cancelled entry with no lines (as Tally keeps a cancelled voucher)
export function mapDoc(entity, doc, ctx){
  const E = ENTITIES[entity];
  if (!E) return {skip: "unknown kind " + entity};
  const id = doc && doc[E.id];
  if (!id) return {skip: "no id"};
  const guid = guidOf(entity, id), status = low(doc.status);
  if (status === "draft" || status === "pending_approval" || status === "approved_not_sent") return {skip: "draft", guid};
  if (entity === "banktransactions" && !OWN_BANK.has(low(doc.transaction_type))) return {skip: "booked by its own document (" + (doc.transaction_type || "uncategorised") + ")", guid};
  if (entity === "banktransactions" && /uncategori[sz]ed|manually_added_uncat/.test(status)) return {skip: "uncategorised statement line", guid};
  const day = isoDay(doc[E.date] || doc.date);
  if (!day) return {skip: "no date", guid};
  const notes = [];
  const v = {guid, day, alter: modSec(doc.last_modified_time || doc.updated_time || doc.created_time), type: "", no: str(doc[E.no] || ""), party: "", narr: "",
    cancel: status === "void", opt: false, gstin: "", pos: "", ref: "", refDate: "", cmp: ctx.cmp || "", fid: fincomIdOf(doc)};
  const lines = [];
  const L = (ledger, amount, hsn, rate, bills) => { if (!ledger || Math.abs(r2(amount)) < 0.005 && !(bills && bills.length)) return; lines.push([guid, ledger, r2(amount), hsn || "", rate == null || rate === "" ? null : rate, bills || []]); };
  const narr = (x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 300);
  const fn = MAP[entity];
  fn(doc, ctx, v, L, notes, narr, lines);
  if (v.cancel){ lines.length = 0; }
  // the entry must balance to the paisa; what Zoho rounded is put on Rounding Off and said (never a wrong total)
  if (!v.cancel){
    const tot = r2(lines.reduce((a, l) => a + l[2], 0));
    if (Math.abs(tot) >= 0.005){
      if (Math.abs(tot) <= 1) { lines.push([guid, "Rounding Off", r2(-tot), "", null, []]); }
      else { lines.push([guid, "Suspense A/c", r2(-tot), "", null, []]); notes.push("did not balance by " + tot.toFixed(2) + ": the difference is in Suspense A/c"); }
    }
  }
  return {voucher: v, lines, notes};
}
const OWN_BANK = new Set(["transfer_fund", "deposit", "owner_contribution", "owner_drawings", "other_income", "interest_income", "expense_refund", "card_payment", "sales_without_invoices", "refund", "owner_drawing"]);

function partyHead(v, doc, ctx, contactId, nameField){
  const c = contactOf(ctx, contactId);
  v.party = conLedger(ctx, contactId, doc[nameField]);
  const g = String(doc.gst_no || doc.gstin || c.gst_no || "").toUpperCase().trim();
  v.gstin = GSTIN_RE.test(g) ? g : "";
  const pos = posName(doc.place_of_supply || doc.destination_of_supply || doc.source_of_supply);
  v.pos = pos ? pos.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and") : "";
}

const MAP = {
  // a sales invoice (or a debit note raised on a customer: Zoho's invoice of type debit_note)
  invoices(doc, ctx, v, L, notes, narr){
    const dn = /debit/.test(low(doc.invoice_type || doc.type || doc.sub_type));
    v.type = dn ? "Debit Note" : "Sales";
    partyHead(v, doc, ctx, doc.customer_id, "customer_name");
    v.ref = str(doc.reference_number || ""); v.narr = narr(doc.notes || doc.customer_notes || "");
    const {items, heads, discountAfter} = itemsOf(doc, ctx, "account_id");
    const tcs = r2(num(doc.tcs_amount));
    const tax = r2(Object.values(heads).reduce((a, x) => a + x, 0));
    items.forEach(it => L(it.ledger, it.amount, it.hsn, it.rate));
    Object.keys(heads).forEach(h => L(gstLedger(h, "output"), heads[h]));
    if (discountAfter) L("Discount Allowed", -discountAfter);
    if (tcs){ const t = ctx.tds[String(doc.tcs_tax_id || "")]; L(t ? tdsLedger(t) : "TCS Payable 206C", tcs); }
    const adj = r2(num(doc.adjustment)); if (adj) L("Rounding Off", adj);
    const total = r2(num(doc.total));
    const due = days(doc.date, doc.due_date);
    L(v.party || "Sundry Debtors", -total, "", null, [[v.no, "New Ref", -total].concat(due != null && due > 0 ? [due] : [])]);
    v.gst = gstType(doc, ctx, doc.line_items, {withTax: tax > 0});
  },
  creditnotes(doc, ctx, v, L, notes, narr){
    v.type = "Credit Note";
    partyHead(v, doc, ctx, doc.customer_id, "customer_name");
    v.ref = str(doc.reference_number || doc.invoice_number || ""); v.narr = narr(doc.notes || doc.reason || "");
    const {items, heads, discountAfter} = itemsOf(doc, ctx, "account_id");
    const tax = r2(Object.values(heads).reduce((a, x) => a + x, 0));
    items.forEach(it => L(it.ledger, -it.amount, it.hsn, it.rate));
    Object.keys(heads).forEach(h => L(gstLedger(h, "output"), -heads[h]));
    if (discountAfter) L("Discount Allowed", discountAfter);
    const adj = r2(num(doc.adjustment)); if (adj) L("Rounding Off", -adj);
    const total = r2(num(doc.total));
    const inv = (doc.invoices || [])[0];
    const bill = inv && inv.invoice_number ? [str(inv.invoice_number), "Agst Ref", total] : doc.invoice_number ? [str(doc.invoice_number), "Agst Ref", total] : [v.no, "New Ref", total];
    L(v.party || "Sundry Debtors", total, "", null, [bill]);
    v.gst = gstType(doc, ctx, doc.line_items, {withTax: tax > 0});
  },
  // a purchase bill: items and input tax debited, TDS credited to its ledger, the party credited with what is payable.
  // Reverse charge: the input credit debited and the same tax credited to "<head> RCM Payable" (3.1(d) and 4(A)(3))
  bills(doc, ctx, v, L, notes, narr, lines){
    v.type = "Purchase";
    partyHead(v, doc, ctx, doc.vendor_id, "vendor_name");
    v.ref = v.no; v.refDate = isoDay(doc.date); v.narr = narr(doc.notes || doc.reference_number || "");
    const rcm = doc.is_reverse_charge_applied === true || low(doc.is_reverse_charge_applied) === "true";
    const {items, heads, discountAfter} = itemsOf(doc, ctx, "account_id");
    const tax = r2(Object.values(heads).reduce((a, x) => a + x, 0));
    const blocked = new Set();
    items.forEach(it => { L(it.ledger, -it.amount, it.hsn, it.rate); if (/ineligible|blocked|17/.test(low(it.li.itc_eligibility))) Object.keys(it.tax).forEach(h => blocked.add(h)); });
    Object.keys(heads).forEach(h => {
      L(gstLedger(h, "input"), -heads[h]);
      if (rcm) L(gstLedger(h, "rcm"), heads[h]);
    });
    if (discountAfter) L("Discount Received", discountAfter);
    const adj = r2(num(doc.adjustment)); if (adj) L("Rounding Off", -adj);
    // TDS: Zoho's own amount and tax (section) on the bill
    const tds = r2(num(doc.tds_amount != null ? doc.tds_amount : doc.tds_total));
    const tdsT = ctx.tds[String(doc.tds_tax_id || "")];
    if (tds) L(tdsT ? tdsLedger(tdsT) : "TDS Payable", tds);
    // the party: what balances the entry. Zoho's total is net of TDS (as the bill shows it); a total given gross is
    // taken the same way, and anything else is said
    const dr = r2(-lines.reduce((a, l) => a + l[2], 0));
    const total = r2(num(doc.total));
    if (Math.abs(dr - total) > 0.01 && Math.abs(dr - r2(total + tds)) > 0.01) notes.push("party amount " + dr.toFixed(2) + " differs from Zoho's total " + total.toFixed(2));
    const due = days(doc.date, doc.due_date);
    L(v.party || "Sundry Creditors", dr, "", null, [[v.no, "New Ref", dr].concat(due != null && due > 0 ? [due] : [])]);
    v.gst = gstType(doc, ctx, doc.line_items, {withTax: tax > 0, inward: true, rcm});
    if (tdsT) v.tdsZoho = {section: sectionOf(tdsT), pct: num(tdsT.tax_percentage), amount: tds};
  },
  // a vendor credit: Tally's Debit Note on the purchase side (goods returned to a supplier, a price cut)
  vendorcredits(doc, ctx, v, L, notes, narr, lines){
    v.type = "Debit Note";
    partyHead(v, doc, ctx, doc.vendor_id, "vendor_name");
    v.ref = str(doc.reference_number || doc.bill_number || ""); v.narr = narr(doc.notes || "");
    const rcm = doc.is_reverse_charge_applied === true;
    const {items, heads, discountAfter} = itemsOf(doc, ctx, "account_id");
    const tax = r2(Object.values(heads).reduce((a, x) => a + x, 0));
    items.forEach(it => L(it.ledger, it.amount, it.hsn, it.rate));
    Object.keys(heads).forEach(h => { L(gstLedger(h, "input"), heads[h]); if (rcm) L(gstLedger(h, "rcm"), -heads[h]); });
    if (discountAfter) L("Discount Received", -discountAfter);
    const adj = r2(num(doc.adjustment)); if (adj) L("Rounding Off", adj);
    const cr = r2(lines.reduce((a, l) => a + l[2], 0));
    const bl = (doc.bills || [])[0];
    L(v.party || "Sundry Creditors", -cr, "", null, [bl && bl.bill_number ? [str(bl.bill_number), "Agst Ref", -cr] : [v.no, "New Ref", -cr]]);
    v.gst = gstType(doc, ctx, doc.line_items, {withTax: tax > 0, inward: true, rcm});
  },
  // money received: the bank debited, TDS the customer withheld debited to TDS Receivable, the customer credited against
  // each invoice it settles (Agst Ref), the rest an advance
  customerpayments(doc, ctx, v, L, notes, narr){
    v.type = "Receipt";
    partyHead(v, doc, ctx, doc.customer_id, "customer_name");
    v.ref = str(doc.reference_number || ""); v.narr = narr(doc.description || doc.notes || "");
    const amount = r2(num(doc.amount)), charges = r2(num(doc.bank_charges)), withheld = r2(num(doc.tax_amount_withheld));
    const bank = accLedger(ctx, doc.account_id, doc.account_name);
    L(bank, -r2(amount - charges));
    if (charges) L("Bank Charges", -charges);
    if (withheld) L("TDS Receivable", -withheld);
    const bills = [];
    let applied = 0;
    (doc.invoices || []).forEach(i => { const a = r2(num(i.amount_applied) + num(i.tax_amount_withheld)); if (!a) return; applied = r2(applied + a); bills.push([str(i.invoice_number), "Agst Ref", a]); });
    const total = r2(amount + withheld);
    if (r2(total - applied) > 0.005) bills.push([v.no || "Advance", "Advance", r2(total - applied)]);
    L(v.party || "Sundry Debtors", total, "", null, bills);
  },
  vendorpayments(doc, ctx, v, L, notes, narr){
    v.type = "Payment";
    partyHead(v, doc, ctx, doc.vendor_id, "vendor_name");
    v.ref = str(doc.reference_number || ""); v.narr = narr(doc.description || doc.notes || "");
    const amount = r2(num(doc.amount)), charges = r2(num(doc.bank_charges));
    const bank = accLedger(ctx, doc.paid_through_account_id || doc.account_id, doc.paid_through_account_name || doc.account_name);
    const bills = [];
    let applied = 0;
    (doc.bills || []).forEach(b => { const a = r2(num(b.amount_applied)); if (!a) return; applied = r2(applied + a); bills.push([str(b.bill_number), "Agst Ref", -a]); });
    if (r2(amount - applied) > 0.005) bills.push([v.no || "Advance", "Advance", -r2(amount - applied)]);
    L(v.party || "Sundry Creditors", -amount, "", null, bills);
    if (charges) L("Bank Charges", -charges);
    L(bank, r2(amount + charges));
  },
  // an expense: paid from a bank or cash account (a Payment) or owed (a Journal); its GST is input tax as on a bill,
  // reverse charge and TDS likewise
  expenses(doc, ctx, v, L, notes, narr, lines){
    const through = ctx.accounts[String(doc.paid_through_account_id || "")];
    const viaBank = !through || /bank|cash|credit_card|prepaid_card|payment_clearing/.test(low(through.account_type));
    v.type = viaBank ? "Payment" : "Journal";
    partyHead(v, doc, ctx, doc.vendor_id, "vendor_name");
    v.no = str(doc.reference_number || doc.expense_number || ""); v.ref = v.no; v.refDate = isoDay(doc.date);
    v.narr = narr(doc.description || doc.notes || "");
    const rcm = doc.is_reverse_charge_applied === true;
    const lis = (doc.line_items && doc.line_items.length) ? doc.line_items : [{account_id: doc.account_id, account_name: doc.account_name, item_total: doc.sub_total != null ? doc.sub_total : num(doc.amount) - (doc.is_inclusive_tax ? num(doc.tax_amount) : 0),
      tax_id: doc.tax_id, tax_percentage: doc.tax_percentage, hsn_or_sac: doc.hsn_or_sac, product_type: doc.product_type, itc_eligibility: doc.itc_eligibility}];
    const one = Object.assign({}, doc, {line_items: lis, taxes: doc.taxes || (doc.tax_amount != null && doc.tax_id ? null : doc.taxes)});
    const {items, heads} = itemsOf(one, ctx, "account_id");
    if (!(doc.taxes && doc.taxes.length) && doc.tax_amount != null && Object.keys(heads).length){
      // a one-line expense gives one tax amount: split over its heads by percentage, to the paisa
      const parts = taxParts(lis[0].tax_id, ctx, lis[0].tax_percentage), sumP = parts.reduce((a, p) => a + p.pct, 0); let rest = r2(num(doc.tax_amount));
      parts.forEach((p, i) => { const x = i === parts.length - 1 ? rest : r2(num(doc.tax_amount) * p.pct / sumP); heads[p.head] = x; rest = r2(rest - x); });
    }
    const tax = r2(Object.values(heads).reduce((a, x) => a + x, 0));
    items.forEach(it => L(it.ledger, -it.amount, it.hsn, it.rate));
    Object.keys(heads).forEach(h => { L(gstLedger(h, "input"), -heads[h]); if (rcm) L(gstLedger(h, "rcm"), heads[h]); });
    const tds = r2(num(doc.tds_amount)), tdsT = ctx.tds[String(doc.tds_tax_id || "")];
    if (tds) L(tdsT ? tdsLedger(tdsT) : "TDS Payable", tds);
    const paid = r2(-lines.reduce((a, l) => a + l[2], 0));
    L(viaBank ? accLedger(ctx, doc.paid_through_account_id, doc.paid_through_account_name || "Cash") : accLedger(ctx, doc.paid_through_account_id, doc.paid_through_account_name), paid);
    v.gst = gstType(doc, ctx, lis, {withTax: tax > 0, inward: true, rcm});
  },
  // a manual journal: each line to its account, a receivable or payable line to the contact it names
  journals(doc, ctx, v, L, notes, narr){
    v.type = "Journal";
    v.ref = str(doc.reference_number || ""); v.narr = narr(doc.notes || doc.description || "");
    let party = "";
    (doc.line_items || []).forEach(li => {
      const a = r2(num(li.amount)), dr = low(li.debit_or_credit) === "debit";
      const acc = ctx.accounts[String(li.account_id || "")] || {};
      const cid = li.customer_id || li.vendor_id || li.contact_id;
      const toContact = cid && /accounts_(receivable|payable)/.test(low(acc.account_type || li.account_type));
      const led = toContact ? conLedger(ctx, cid, li.customer_name || li.vendor_name || li.contact_name) : accLedger(ctx, li.account_id, li.account_name);
      if (toContact && !party) party = led;
      L(led, dr ? -a : a, String(li.hsn_or_sac || ""), null);
      const ta = r2(num(li.tax_amount));
      if (ta && li.tax_id){
        const parts = taxParts(li.tax_id, ctx, li.tax_percentage), sumP = parts.reduce((s, p) => s + p.pct, 0); let rest = ta;
        const side = /income|receivable/.test(low(acc.account_type)) ? "output" : "input";
        parts.forEach((p, i) => { const x = i === parts.length - 1 ? rest : r2(ta * p.pct / sumP); rest = r2(rest - x); L(gstLedger(p.head, side), dr ? -x : x); });
      }
    });
    v.party = party;
  },
  // a bank transaction booked on its own (a transfer between accounts, an owner's money, other income); those booked by
  // their own document (a payment, an expense) come with that document and are skipped
  banktransactions(doc, ctx, v, L, notes, narr){
    const t = low(doc.transaction_type);
    const from = accLedger(ctx, doc.from_account_id, doc.from_account_name), to = accLedger(ctx, doc.to_account_id, doc.to_account_name);
    const amount = r2(num(doc.amount));
    const fa = ctx.accounts[String(doc.from_account_id || "")] || {}, ta = ctx.accounts[String(doc.to_account_id || "")] || {};
    const isBank = a => /bank|cash|credit_card|prepaid_card|payment_clearing/.test(low(a.account_type));
    v.type = t === "transfer_fund" || (isBank(fa) && isBank(ta)) ? "Contra" : isBank(ta) ? "Receipt" : "Payment";
    v.no = str(doc.reference_number || doc.transaction_number || ""); v.ref = v.no; v.narr = narr(doc.description || "");
    L(to, -amount); L(from, amount);
  }
};

// every document of a list in one call: {vouchers, lines, skipped: [{guid, why}], notes: [{guid, note}]}
export function mapDocs(entity, docs, ctx){
  const out = {vouchers: [], lines: [], skipped: [], notes: []};
  (docs || []).forEach(d => {
    const r = mapDoc(entity, d, ctx);
    if (r.skip){ out.skipped.push({guid: r.guid || "", why: r.skip}); return; }
    out.vouchers.push(r.voucher); r.lines.forEach(l => out.lines.push(l));
    r.notes.forEach(n => out.notes.push({guid: r.voucher.guid, note: n}));
  });
  return out;
}
