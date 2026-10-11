// One day's day book, as Tally exports it, read into entry heads and ledger lines for the cloud copy.
// The rules are FinCom's own (src/js/04-the-client-s-books-read-from-tally.js, Books.takeVoucher), so the cloud's
// totals are the same figures FinCom works out in the browser: tests/run_cloud_parse.js checks this on real books.
// Plain JavaScript: used by the tally-ingest edge function (Deno) and by the tests (Node). Names are read with the one rule
// FinCom uses in the browser, server/_shared/names.js (deploy it with the function, as ../_shared/names.js).
import { namesClean, namesKey } from "../_shared/names.js";

function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
// every value read from the day book, names first: the one rule FinCom uses in the browser (server/_shared/names.js):
// entities decoded, each run of line breaks (CR LF, &#13; &#10;, also escaped twice) one space, ends trimmed. Before
// 02-Oct-2026 this decoded &#13;&#10; to two spaces, so "Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)" was a second
// ledger beside the master "Orchid Lane Hospitality Pvt Ltd (Noida)" (finding 4)
function unesc(v){ return namesClean(v); }
// 06-Oct-2026 (the owner's NWS144 line 18: Receipt 213 held with an empty body although the bridge sent Tally's XML): a
// real TallyPrime 7.1 writes a collection's fields typed, <DATE TYPE="Date">, <ALTERID TYPE="Number"> 54493</ALTERID>,
// <LEDGERNAME TYPE="String">, <AMOUNT TYPE="Amount">, <BILLTYPE TYPE="String">, so a field is read with or without
// attributes (bridge-go/tallyxml.go tagOpenRe: never a self-closed <TAG/>, never a longer tag), its value trimmed (unesc
// trims). A Day Book export (no attributes) reads exactly as before
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const OPEN = new Map();
// 2.3.1 (2.3.0 review round 3 L1): a tag's attributes stop at the next "<" ([^<>], not [^>]): an opening tag never closed
// no longer makes each try scan to the end of the text (quadratic on crafted input)
function openRe(tag){ let r = OPEN.get(tag); if (!r){ r = "<" + reEsc(tag) + "(?:\\s[^<>]*[^/<>])?\\s*>"; OPEN.set(tag, r); } return r; }
const ONE = new Map();
function one(s, tag){
  let re = ONE.get(tag);
  if (!re){ re = new RegExp(openRe(tag) + "([^<]*)</" + reEsc(tag) + "\\s*>"); ONE.set(tag, re); }
  const m = s.match(re); return m ? unesc(m[1]) : "";
}
// the pieces of s after each opening <TAG> or <TAG ...> (as s.split("<TAG>").slice(1) for an untyped text), each with
// where its tag began
function after(s, tag){
  const re = new RegExp(openRe(tag), "g"), at = [];
  let m; while ((m = re.exec(s))) at.push([m.index, m.index + m[0].length]);
  return at.map(([a, b], i) => ({a, p: s.slice(b, i + 1 < at.length ? at[i + 1][0] : s.length)}));
}
// the text of s up to the first closing </TAG> (as p.split("</TAG>")[0])
function upTo(p, tag){ const m = p.match(new RegExp("</" + reEsc(tag) + "\\s*>")); return m ? p.slice(0, m.index) : p; }
// a collection's answer carries a CMPINFO block of counters ahead of its data (<VOUCHER>4</VOUCHER>, <LEDGER>21</LEDGER>):
// never read as a voucher (bridge-go/tallyxml.go dropCmpInfo)
// 2.3.1 (2.3.0 review round 3 L3): a self-closed CMPINFO with attributes (<CMPINFO TYPE="x"/>) is dropped alone, never
// taken as an opening one running on to the next </CMPINFO> over the vouchers between
function dropCmpInfo(t){ return t.indexOf("CMPINFO") < 0 ? t : t.replace(/<CMPINFO(?:\s[^<>]*[^\/<>])?\s*>[\s\S]*?<\/CMPINFO\s*>|<CMPINFO(?:\s[^<>]*)?\/>/g, ""); }
// "$17000.00 @ ₹ 86.40/$ = ₹ 1468800.00" is 1468800: the rupee value after the last "="
function amt(v){ const t = String(v || ""), i = t.lastIndexOf("="); return num(i >= 0 ? t.slice(i + 1) : t); }
// the IGST rate in a block's rate details, which is the whole GST rate; null when not set (as Books.igstRate)
function igstRate(s){ const m = String(s || "").match(/<GSTRATEDUTYHEAD(?:\s[^<>]*[^\/<>])?\s*>\s*IGST\s*<\/GSTRATEDUTYHEAD>\s*<GSTRATEVALUATIONTYPE(?:\s[^<>]*[^\/<>])?\s*>[^<]*<\/GSTRATEVALUATIONTYPE>\s*<GSTRATE(?:\s[^<>]*[^\/<>])?\s*>\s*([\d.]+)\s*<\/GSTRATE>/); return m ? num(m[1]) : null; }

// a long narration is cut to 300 characters, keeping FinCom's own mark at its end ("TDSDesk:<id>"): the checks before
// posting look for it in the cloud copy
function shortNarr(t){
  if (t.length <= 300) return t;
  const m = t.match(/TDSDesk:[A-Za-z0-9._-]+\s*$/);
  return m ? t.slice(0, 300 - m[0].length - 3) + " | " + m[0] : t.slice(0, 300);
}
// FinCom's own mark on an entry it posted, "TDSDesk:<id>", read from the FULL narration (migration-37 item 14: the
// cloud keeps it in tally_vouchers.fincom_id, so the checks before posting and the bridge's read-back do not depend on
// where in a long narration the tag sits); null when there is none
function fincomId(t){ const m = String(t || "").match(/TDSDesk:([A-Za-z0-9._-]+)/); return m ? m[1] : null; }
// ---- bridge 2.3.1 part A (the owner's decisions of 06-Oct-2026: "item invoices enter complete"). Read the same way from
// a Day Book export and from the entry request's typed XML (one reader for both paths); the fields read before are
// unchanged. Each a plain value, never one Tally works out except where said
const r2 = (x) => Math.round(x * 100) / 100;
// a Tally date as yyyymmdd: "20261002", or "2-Oct-2026" / "2-Oct-26" (a credit period given as a date); "" when none
const MON = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
function d8(t){
  t = String(t || "").trim();
  if (/^\d{8}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2}|\d{4})$/);
  if (!m || !MON[m[2].toLowerCase()]) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return y + String(MON[m[2].toLowerCase()]).padStart(2, "0") + m[1].padStart(2, "0");
}
// the pieces of s inside each <TAG>...</TAG>
function blocks(s, tag){ return s.indexOf("<" + tag) < 0 ? [] : after(s, tag).map(({p}) => upTo(p, tag)); }
// the rates in a block's own rate details (the item's, not its allocations'): {c, s, i, cess, sc} (null when not set);
// a cess "Based on Quantity" is not a rate on value and is left out
// 2.3.1 (the real TallyPrime 7.1 run of 06-Oct-2026): each duty head Tally writes goes to its own slot, matched exactly
// (Tally 7.1 writes CGST, SGST/UTGST, IGST, Cess and State Cess on every item line). Before, "State Cess" (rate 0) was taken
// for SGST by its first word and set SGST to 0, so an item's tax came out at half. A head not named here is left out
const HEADS = {"CGST": "c", "CENTRAL TAX": "c", "SGST/UTGST": "s", "SGST": "s", "UTGST": "s", "STATE TAX": "s", "UT TAX": "s", "UNION TERRITORY TAX": "s",
  "IGST": "i", "INTEGRATED TAX": "i", "CESS": "cess", "STATE CESS": "sc"};
function rateHeads(own){
  const o = {c: null, s: null, i: null, cess: null, sc: null};
  blocks(own, "RATEDETAILS.LIST").forEach((q) => {
    const h = one(q, "GSTRATEDUTYHEAD").toUpperCase(), vt = one(q, "GSTRATEVALUATIONTYPE"), rv = one(q, "GSTRATE");
    if (rv && vt && !/value/i.test(vt) && !/not applicable/i.test(vt) && /CESS/.test(h) && num(rv)) o.cessQty = true;     // review M3: said, not worked out
    if (!rv || (vt && !/value/i.test(vt))) return;
    // 2.3.1 (the real run, check 8: GST typed on the ledgers, the items without a rate): Tally 7.1 writes every head with
    // rate 0 and no valuation type then; that is no rate given, not a rate of 0 % ("Based on Value" when one is set)
    if (!vt && !num(rv)) return;
    const slot = HEADS[h.replace(/\s+/g, " ").trim()];
    if (slot) o[slot] = num(rv);
  });
  return o;
}
// a GST tax ledger line, by its name (the voucher does not say which ledger is a tax ledger): CGST, SGST, UTGST, IGST, cess
const TAXNAME = /\b(?:C|S|I|UT)GST\b|\bcess\b|central tax|state tax|integrated tax|union territory tax/i;
const IGSTNAME = /\bIGST\b|integrated tax/i, CSNAME = /\b(?:C|S|UT)GST\b|central tax|state tax|union territory tax/i;
// "200.00/Nos" -> 200; " 10 Nos" -> [10, "Nos"]
function rateOf(t){ t = String(t || ""); const i = t.indexOf("/"); return amt(i >= 0 ? t.slice(0, i) : t); }
function qtyOf(t){ const m = String(t || "").trim().match(/^(-?[\d.,]+)\s*(.*)$/); return m ? [Math.abs(num(m[1].replace(/,/g, ""))), m[2].trim().split(/\s+/)[0] || ""] : [null, ""]; }
const rupees = (x) => "Rs " + (Math.round(Math.abs(x) * 100) / 100).toFixed(2);
// ---- bridge 2.4.2 (the owner's approval of 11-Oct-2026: "the bridge sends each entry's GST type"; migration 72). The entry's
// GST type as Tally stores it, read the same way from a Day Book export and from the bridge's entry body (the fields its
// FinComVoucherObject answer keeps from 2.4.2 on; measured on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1, tally-versions
// mode gsttype): the party's GST registration type and country (on the entry), reverse charge (the entry's
// ISREVERSECHARGEAPPLICABLE, or a line's override), and from the lines (the ledger lines, the items and the ledger lines
// under them) the nature of the transaction (SEZ with or without payment, exports with payment or under LUT, ...), the
// taxability (Taxable, Nil Rated, Exempt, Non-GST), goods or services, and the ineligible (blocked, 17(5)) input credit
// mark. Stored values only, nothing worked out. null when the text carries none of these fields (a body from a bridge
// before 2.4.2): the cloud then keeps what it has
const GSTTYPE_TAGS = ["GSTREGISTRATIONTYPE", "COUNTRYOFRESIDENCE", "ISREVERSECHARGEAPPLICABLE", "GSTOVRDNISREVCHARGEAPPL", "GSTOVRDNNATURE", "GSTOVRDNTAXABILITY", "GSTOVRDNTYPEOFSUPPLY", "GSTOVRDNINELIGIBLEITC"];
// Tally's "\u0004 Not Applicable" (an override not set) is no value; its "\u0004 Applicable" / "Applicable" / "Yes" is set
const gstNone = (t) => !String(t || "").replace(/[^A-Za-z ]/g, " ").trim() || /^not applicable$/i.test(String(t).replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim());
const gstSet = (t) => { const w = String(t || "").replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase(); return w === "yes" || w === "applicable"; };
// the entry's lines, each once: its ledger lines (ALLLEDGERENTRIES, LEDGERENTRIES), each item without the ledger lines under
// it, and those ledger lines (ACCOUNTINGALLOCATIONS)
function gstUnits(s){
  const u = [];
  ["ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST", "ACCOUNTINGALLOCATIONS.LIST"].forEach((t) => blocks(s, t).forEach((b) => u.push(b)));
  blocks(s, "ALLINVENTORYENTRIES.LIST").forEach((b) => u.push(b.replace(/<ACCOUNTINGALLOCATIONS\.LIST(?:\s[^<>]*[^\/<>])?\s*>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST\s*>/g, "")));
  return u;
}
function gstType(s){
  if (!GSTTYPE_TAGS.some((t) => s.indexOf("<" + t) >= 0)) return null;
  const clean = (t) => String(t || "").replace(/[\u0000-\u001f]/g, "").trim();
  const head = s.replace(/<(ALLLEDGERENTRIES|LEDGERENTRIES|ALLINVENTORYENTRIES)\.LIST(?:\s[^<>]*[^\/<>])?\s*>[\s\S]*?<\/\1\.LIST\s*>/g, "");
  const units = gstUnits(s);
  // a line is a GST line when Tally gives it a taxability or a nature (a ledger without GST details carries Tally's
  // "Applicable" for the ineligible credit with neither: TallyPrime 7.1, a TDS journal's purchase ledger, run 38072484999)
  const gstLine = (u) => !gstNone(one(u, "GSTOVRDNTAXABILITY")) || !gstNone(one(u, "GSTOVRDNNATURE"));
  const first = (tag) => clean(units.map((u) => one(u, tag)).find((x) => !gstNone(x)) || "");
  return {
    reg: (gstNone(one(head, "GSTREGISTRATIONTYPE")) ? "" : clean(one(head, "GSTREGISTRATIONTYPE"))).slice(0, 60),
    country: (gstNone(one(head, "COUNTRYOFRESIDENCE")) ? "" : clean(one(head, "COUNTRYOFRESIDENCE"))).slice(0, 60),
    rcm: gstSet(one(head, "ISREVERSECHARGEAPPLICABLE")) || units.some((u) => gstLine(u) && gstSet(one(u, "GSTOVRDNISREVCHARGEAPPL"))),
    nature: first("GSTOVRDNNATURE").slice(0, 100),
    taxability: first("GSTOVRDNTAXABILITY").slice(0, 40),
    supply: first("GSTOVRDNTYPEOFSUPPLY").slice(0, 20),
    ineligible: units.some((u) => gstLine(u) && gstSet(one(u, "GSTOVRDNINELIGIBLEITC")))
  };
}
function takeVoucher(s){
  const id = String(one(s, "GUID") || (s.match(/REMOTEID="([^"]*)"/) || [])[1] || "").replace(/[^\w\-.:]/g, "");
  const narrFull = one(s, "NARRATION");
  const v = {
    guid: id,
    date: one(s, "DATE"),
    alter: Math.round(num(one(s, "ALTERID"))),
    type: (s.match(/VCHTYPE="([^"]*)"/) || [])[1] || one(s, "VOUCHERTYPENAME"),
    no: one(s, "VOUCHERNUMBER"),
    party: one(s, "PARTYNAME") || one(s, "PARTYLEDGERNAME"),
    narr: shortNarr(narrFull),
    fid: fincomId(narrFull),
    cancel: one(s, "ISCANCELLED") === "Yes",
    opt: one(s, "ISOPTIONAL") === "Yes",
    // review of 01-Oct-2026: the party's GSTIN and the place of supply, kept in the cloud copy too
    gstin: one(s, "PARTYGSTIN").toUpperCase().slice(0, 15),
    pos: one(s, "PLACEOFSUPPLY").slice(0, 60),
    // the reference number and date (on a purchase, the supplier's invoice, which 2B reconciliation pairs on) and the
    // company GSTIN the entry is under (a client with more than one GSTIN files a GSTR-1 for each), as FinCom reads them
    ref: one(s, "REFERENCE").slice(0, 60),
    refDate: (one(s, "REFERENCEDATE").match(/^\d{8}$/) || [""])[0],
    cmp: one(s, "CMPGSTIN").toUpperCase().slice(0, 15)
  };
  // each item's HSN and rate, for the accounting allocation inside it (an item invoice keeps the sales or purchase
  // ledger there), as FinCom reads them in the browser
  const items = [];
  if (s.indexOf("<ALLINVENTORYENTRIES.LIST") >= 0){
    const reA = new RegExp(openRe("ALLINVENTORYENTRIES.LIST"), "g");
    for (;;){
      const ma = reA.exec(s); if (!ma) break;
      const a = ma.index, mz = s.slice(a).match(/<\/ALLINVENTORYENTRIES\.LIST\s*>/); if (!mz) break;
      const z = a + mz.index;
      const own = s.slice(a, z).replace(/<ACCOUNTINGALLOCATIONS\.LIST(?:\s[^<>]*[^\/<>])?\s*>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST\s*>/g, "");
      // 2.3.1 (third review L1): a real 7.1 answer carries an empty ALLINVENTORYENTRIES.LIST on an entry without items: a
      // block with no stock item and no amount is no item line
      if (one(own, "STOCKITEMNAME") || one(own, "AMOUNT")) items.push({a, z, h: one(own, "GSTHSNNAME"), gr: igstRate(own), own, alloc: 0});
      reA.lastIndex = z + 1;
    }
  }
  // each line: [guid, ledger, amount, HSN or SAC, GST rate (the whole rate, IGST's) or null, bill-wise details]
  const lines = [], meta = [], costs = [], banks = [], tds = [], dues = [], checks = [];
  // part A: a ledger line's cost centres, bank details, TDS details and a due date given as a date
  const lineExtras = (e, n, ledger, la) => {
    const ccat = new Map();
    blocks(e, "CATEGORYALLOCATIONS.LIST").forEach((blk) => {
      const cat = (one(blk, "CATEGORY") || "Primary Cost Category").slice(0, 200);
      blocks(blk, "COSTCENTREALLOCATIONS.LIST").forEach((q) => {
        const cn = one(q, "NAME"); if (!cn) return;
        const ca = r2(amt(one(q, "AMOUNT")));
        costs.push({n, ledger, cat, centre: cn.slice(0, 200), amt: ca});
        ccat.set(cat, r2((ccat.get(cat) || 0) + ca));
      });
    });
    ccat.forEach((tot, cat) => { if (Math.abs(tot - la) > 0.01) checks.push("the cost centres of " + ledger + " (" + cat + ") come to " + rupees(tot) + ", not the line's " + rupees(la)); });
    blocks(e, "BANKALLOCATIONS.LIST").forEach((q) => {
      const b = {n, ledger, type: one(q, "TRANSACTIONTYPE").slice(0, 60), no: (one(q, "INSTRUMENTNUMBER") || one(q, "UNIQUEREFERENCENUMBER")).slice(0, 60), date: d8(one(q, "INSTRUMENTDATE")), bdate: d8(one(q, "BANKERSDATE"))};
      if (b.type || b.no || b.date || b.bdate) banks.push(b);
    });
    blocks(e, "TAXOBJECTALLOCATIONS.LIST").forEach((q) => {
      const tt = one(q, "TAXTYPE");
      if (tt && !/TDS/i.test(tt)) return;
      const subs = blocks(q, "SUBCATEGORYALLOCATION.LIST");
      const nature = one(q, "CATEGORY").slice(0, 200), party = one(q, "PARTYLEDGER").slice(0, 300);
      if (!subs.length && !nature) return;
      // the owner's decision of 07-Oct-2026: the rate and assessable amount are the Income Tax sub-category's (Tally also
      // writes Surcharge, Education Cess and Secondary Education Cess sub-blocks, empty when not charged); without
      // sub-category names (a body fetched before the whole TDS list was asked), the first sub-block with an amount. The
      // tax is the sum of the sub-blocks (what was deducted). Where Tally stores the rate as 0 (TallyPrime 7.1 on an entry
      // keyed on its screen), the rate is worked out as tax / assessable amount x 100 and marked rateWorkedOut: true
      let rate = null, base = null, tax = null, worked = false;
      const it = subs.find((x) => /^income\s*tax$/i.test(one(x, "SUBCATEGORY").trim())) || subs.find((x) => one(x, "ASSESSABLEAMOUNT") || one(x, "TAX")) || subs[0];
      if (it){ const tr = one(it, "TAXRATE"), ab = one(it, "ASSESSABLEAMOUNT"); if (tr) rate = num(tr); if (ab) base = r2(amt(ab)); }
      subs.forEach((x) => { const tx = one(x, "TAX"); if (tx) tax = r2((tax || 0) + amt(tx)); });
      const itTax = it && one(it, "TAX") ? amt(one(it, "TAX")) : 0;
      // review L2 (2.4.0 part 2): a line Tally marked exempt (EXEMPTED Yes) keeps the rate as Tally stored it, never worked
      // out, and carries exempt: true (the real S5 capture of run 37492981527 is such a line)
      const exempt = /^yes$/i.test(one(q, "EXEMPTED").trim());
      if (!rate && base && itTax && !exempt){ rate = Math.round(Math.abs(itTax / base) * 100 * 10000) / 10000; worked = true; }
      // the section (the owner, 06-Oct-2026): Tally's own on the line's bill-wise detail (TDSDEDUCTEESECTIONNUMBER), else
      // on another bill-wise detail of the entry (filled in below); else the section written in the nature of payment's
      // name (192 .. 196x, 206C.., the 2025 Act's 393); else blank, never guessed
      const own = blocks(e, "BILLALLOCATIONS.LIST").map((b) => one(b, "TDSDEDUCTEESECTIONNUMBER")).find(Boolean) || "";
      tds.push({n, ledger, nature, party, rate, base, tax: tax == null ? la : tax, section: own.slice(0, 20), sectionFrom: own ? "Tally's entry" : "", ...(worked ? {rateWorkedOut: true} : {}), ...(exempt ? {exempt: true} : {})});
    });
    if (e.indexOf("<BILLALLOCATIONS.LIST") >= 0) blocks(e, "BILLALLOCATIONS.LIST").forEach((q) => {
      const cp = (q.match(/<BILLCREDITPERIOD(?:\s[^<>]*[^/<>])?\s*>([^<]*)<\/BILLCREDITPERIOD>/) || [])[1] || "", due = d8(cp);
      if (due) dues.push({n, ledger, name: one(q, "NAME").slice(0, 200), type: one(q, "BILLTYPE").slice(0, 20), amt: r2(amt(one(q, "AMOUNT"))), due});
    });
  };
  // 2.3.1 (the real TallyPrime 7.1 run of 06-Oct-2026: item invoices read doubled): Tally's answer to the entry request
  // carries an item invoice's ledger lines twice: in ALLLEDGERENTRIES (the entry's whole ledger list, with the fields the
  // request fetches: bill-wise, cost centres, bank, TDS, GST rates) and again in LEDGERENTRIES (the party and tax lines,
  // without those fields) plus each item's ACCOUNTINGALLOCATIONS (the sales or purchase ledger under each item). Each line
  // is taken once. Tally's own Day Book export gives an item invoice as LEDGERENTRIES and the lines under the items, any
  // other entry as ALLLEDGERENTRIES alone: read exactly as before (all of what is there). When ALLLEDGERENTRIES is there it
  // is the entry's list: LEDGERENTRIES is never added to it; a ledger the lines under the items come to exactly is taken as
  // those lines (each keeps its item's HSN and rate) in place of the list's line for it; a ledger only under the items is
  // added. When the lines under the items do not come to the list's line for their ledger, or the lines taken would not
  // add up to zero while the list does, or LEDGERENTRIES does not repeat the list, the entry's list alone is taken and a
  // note says so: a body is never read doubled
  const found = [];
  ["ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST", "ACCOUNTINGALLOCATIONS.LIST"].forEach((tag) => {
    after(s, tag).forEach(({a: pos, p}) => {
      const e = upTo(p, tag);
      const name = one(e, "LEDGERNAME");
      if (!name) return;
      const it = tag === "ACCOUNTINGALLOCATIONS.LIST" ? items.find(q => pos > q.a && pos < q.z) : null;
      found.push({tag, e, name, it, la: Math.round(amt(one(e, "AMOUNT")) * 100) / 100});
    });
  });
  const ofTag = (t) => found.filter((f) => f.tag === t);
  let fromAll = ofTag("ALLLEDGERENTRIES.LIST"), fromLed = ofTag("LEDGERENTRIES.LIST");
  const under = ofTag("ACCOUNTINGALLOCATIONS.LIST");
  // FinCom Bridge 2.3.4 (re-review M2): the bridge's entry request now gives Tally's stored voucher, its party and tax lines
  // (Tally's LEDGERENTRIES) as ALLLEDGERENTRIES and no LEDGERENTRIES. When a ledger under the items is ALSO a line of its
  // own there (freight booked to the sales ledger), that list is not the entry's whole list: it is read as the Voucher
  // collection's answer was (the entry's whole list: those lines with each ledger under the items as one line of its
  // total, after the party's line; those lines again as LEDGERENTRIES), so FinCom stores what it stored from that answer.
  // The total line carries the cost centres of the lines under the items (as TallyPrime 3.0's answer did; 7.1's left them out)
  if (fromAll.length && !fromLed.length && under.length){
    const tu0 = new Map(); under.forEach((u) => tu0.set(u.name, r2((tu0.get(u.name) || 0) + u.la)));
    // the partial list is told by its sum: it balances only with the lines under the items (a whole list balances alone)
    const sa = r2(fromAll.reduce((t, f) => t + f.la, 0)), su = r2(under.reduce((t, f) => t + f.la, 0));
    if (fromAll.some((f) => tu0.has(f.name)) && Math.abs(sa) > 0.005 && Math.abs(r2(sa + su)) < 0.005){
      const agg = [...tu0].map(([name, la]) => ({tag: "ALLLEDGERENTRIES.LIST", name, it: null, la,
        e: "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + String(name).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</LEDGERNAME><AMOUNT>" + la.toFixed(2) + "</AMOUNT>" +
          under.filter((u) => u.name === name).map((u) => blocks(u.e, "CATEGORYALLOCATIONS.LIST").map((b) => "<CATEGORYALLOCATIONS.LIST>" + b + "</CATEGORYALLOCATIONS.LIST>").join("")).join("") +
          "</ALLLEDGERENTRIES.LIST>"}));
      const party = one(s, "PARTYLEDGERNAME");
      fromLed = fromAll.map((f) => ({...f, tag: "LEDGERENTRIES.LIST"}));
      fromAll = party && fromAll[0].name === party ? [fromAll[0], ...agg, ...fromAll.slice(1)] : [...agg, ...fromAll];
    }
  }
  let take = [...fromAll, ...fromLed, ...under];
  if (fromAll.length && (fromLed.length || under.length)){
    const tot = (xs) => { const m = new Map(); xs.forEach((f) => m.set(f.name, r2((m.get(f.name) || 0) + f.la))); return m; };
    const zero = (xs) => Math.abs(xs.reduce((t, f) => t + f.la, 0)) < 0.005;
    const ta = tot(fromAll), tu = tot(under);
    let agree = true;
    const merged = [], placed = new Set();
    fromAll.forEach((f) => {
      if (!tu.has(f.name)) { merged.push(f); return; }
      if (Math.abs(tu.get(f.name) - ta.get(f.name)) >= 0.005) agree = false;
      if (!placed.has(f.name)) { placed.add(f.name); under.filter((u) => u.name === f.name).forEach((u) => merged.push(u)); }
    });
    under.forEach((u) => { if (!ta.has(u.name)) merged.push(u); });
    if (zero(fromAll) && !zero(merged)) agree = false;
    const tl = tot(fromLed);
    if ([...tl].some(([k, v]) => !ta.has(k) || Math.abs(ta.get(k) - v) >= 0.005)) agree = false;
    take = agree ? merged : fromAll;
    if (!agree){
      const say = (m) => [...m].slice(0, 4).map(([k, v]) => k + " " + rupees(v)).join(", ") + (m.size > 4 ? " and " + (m.size - 4) + " more" : "");
      checks.push("the ledger lines Tally gave twice do not agree (the entry's ledger list: " + say(ta) + "; its other lists: " + say(tot(fromLed.concat(under))) + "); the entry's ledger list is taken, once");
      under.forEach((f) => { if (f.it) f.it.alloc = r2(f.it.alloc + f.la); }); // each item's taxable value still checked against them
    }
  }
  take.forEach(({e, name, it}) => {
    {
      const hsn = (it ? it.h : one(e, "GSTHSNNAME")).slice(0, 20);
      const rate = it ? it.gr : igstRate(e);
      // bill-wise details on the line (review of 01-Oct-2026): [bill name, New Ref / Agst Ref / Advance / On Account,
      // amount, credit days or null], as FinCom reads them in the browser, so ageing works from the cloud copy too
      const bills = [];
      if (e.indexOf("<BILLALLOCATIONS.LIST") >= 0){
        after(e, "BILLALLOCATIONS.LIST").forEach(({p: p2}) => {
          const q = upTo(p2, "BILLALLOCATIONS.LIST"), type = one(q, "BILLTYPE"), a = Math.round(amt(one(q, "AMOUNT")) * 100) / 100;
          if (!type || !a) return;
          const cp = (q.match(/<BILLCREDITPERIOD(?:\s[^<>]*[^/<>])?\s*>([^<]*)<\/BILLCREDITPERIOD>/) || [])[1] || "", dm = cp.match(/^\s*(\d{1,4})\s*Days?\s*$/i);
          bills.push([one(q, "NAME").slice(0, 200), type.slice(0, 20), a, dm ? Number(dm[1]) : null]);
        });
      }
      const ln = lines.length, la = Math.round(amt(one(e, "AMOUNT")) * 100) / 100;
      lines.push([id, name, la, hsn, rate == null ? null : rate, bills]);
      // part A: what the line carries besides (each with the line's number in the entry and its ledger)
      if (it) it.alloc = r2(it.alloc + la);
      meta.push({n: ln, name, a: la, it: !!it, bills: !!bills.length, rate: it ? null : rate, billSum: bills.length ? r2(bills.reduce((t, b) => t + b[2], 0)) : null,
        billList: bills.length ? blocks(e, "BILLALLOCATIONS.LIST") : []});
      lineExtras(e, ln, name, la);
    }
  });
  // review of 01-Oct-2026: a payroll voucher (Tally's PaySlip view) has no ledger lines; its pay heads sit in each
  // employee's allocations. A pay head is a ledger in Tally: earnings are debits, deductions (PF, advance) credits, and
  // the party ledger (Salary Payable) takes the net. A pay head already among the ledger lines is not counted again
  if (s.indexOf("<PAYHEADALLOCATIONS.LIST") >= 0){
    const by = new Map();
    after(s, "PAYHEADALLOCATIONS.LIST").forEach(({p}) => {
      const q = upTo(p, "PAYHEADALLOCATIONS.LIST"), n = one(q, "PAYHEADNAME"), a = amt(one(q, "AMOUNT"));
      if (n && a) by.set(n, Math.round(((by.get(n) || 0) + a) * 100) / 100);
    });
    // names met by their key (namesKey), as FinCom does (Books.takeVoucher)
    const have = new Set(lines.map(l => namesKey(l[1]))); let tot = 0;
    by.forEach((a, n) => { if (Math.abs(a) < 0.005) return; tot = Math.round((tot + a) * 100) / 100; if (!have.has(namesKey(n))) lines.push([id, n, a, "", null, []]); });
    const party = one(s, "PARTYLEDGERNAME");
    if (party && !have.has(namesKey(party)) && Math.abs(tot) >= 0.005) lines.push([id, party, Math.round(-tot * 100) / 100, "", null, []]);
  }
  // ---- part A: the e-invoice and e-way bill
  v.irn = one(s, "IRN").slice(0, 100);
  v.ackNo = one(s, "IRNACKNO").slice(0, 40);
  v.ackDate = d8(one(s, "IRNACKDATE"));
  v.eway = (blocks(s, "EWAYBILLDETAILS.LIST").map((q) => one(q, "BILLNUMBER")).find(Boolean) || "").slice(0, 40);
  // the GST split: IGST when the entry's tax ledgers are IGST, CGST + SGST when they are those; else the company's and the
  // party's GSTIN states (the same: within the state); else within the state
  const named = meta.filter((m) => !m.it && !m.bills && TAXNAME.test(m.name));
  const hasI = named.some((m) => IGSTNAME.test(m.name)), hasCS = named.some((m) => CSNAME.test(m.name));
  const inter = hasI && !hasCS ? true : hasCS && !hasI ? false : (v.cmp.length >= 2 && v.gstin.length >= 2 ? v.cmp.slice(0, 2) !== v.gstin.slice(0, 2) : false);
  // the items: name, quantity and unit (billed), rate, taxable value, the HSN or SAC and the GST rate Tally applied to that
  // line (its own rate details, never the master's), and the tax on it. Tally 7.1 writes no tax amount per item line: it is
  // worked out here as Tally does, the line's taxable value times the head's rate, to the paisa (CGST and SGST each half of
  // the IGST rate when Tally gives only that)
  v.items = items.map((it, k) => {
    const [qty, unit] = qtyOf(one(it.own, "BILLEDQTY")), rh = rateHeads(it.own), tx = r2(amt(one(it.own, "AMOUNT")));
    const gr = rh.i != null ? rh.i : (rh.c != null || rh.s != null ? (rh.c || 0) + (rh.s || 0) : null);
    const cg = rh.c != null ? rh.c : (gr != null ? gr / 2 : null), sg = rh.s != null ? rh.s : (gr != null ? gr / 2 : null);
    return {n: k, item: one(it.own, "STOCKITEMNAME").slice(0, 300), qty, unit: unit.slice(0, 20), rate: one(it.own, "RATE") ? r2(rateOf(one(it.own, "RATE"))) : null,
      taxable: tx, alloc: it.alloc, hsn: it.h.slice(0, 20), gst: gr,
      cgst: gr == null || inter ? 0 : r2(tx * cg / 100), sgst: gr == null || inter ? 0 : r2(tx * sg / 100), igst: gr == null || !inter ? 0 : r2(tx * gr / 100),
      cess: rh.cess == null ? 0 : r2(tx * rh.cess / 100)};
  });
  if (tds.length){
    const anySec = blocks(s, "BILLALLOCATIONS.LIST").map((b) => one(b, "TDSDEDUCTEESECTIONNUMBER")).find(Boolean) || "";
    tds.forEach((t) => {
      if (t.section) return;
      const nm = (t.nature.match(/(?:^|[^A-Za-z0-9])(19[2-6][A-Z]{0,3}|206C[A-Z]{0,3}|393(?:\([0-9a-z]+\))*)(?![A-Za-z0-9])/) || [])[1] || "";
      if (anySec) { t.section = anySec.slice(0, 20); t.sectionFrom = "Tally's entry"; }
      else if (nm) { t.section = nm; t.sectionFrom = "the nature of payment's name"; }
    });
  }
  v.costs = costs; v.banks = banks; v.tds = tds; v.dues = dues;
  // bridge 2.4.2: the entry's GST type (null: none of its fields in the text)
  const gt = gstType(s); if (gt) v.gst = gt;
  // ---- part A, the owner's accuracy checks: lines totalling zero; item lines' taxable value plus tax against the ledger
  // lines for that invoice; bill-wise and cost centre allocations against their line. Each failure in plain words. The
  // owner's rule after review (06-Oct-2026): the recorder path holds an entry only when its lines do not total zero (the
  // balance guard in tally-ingest); every other failure is a note for a person (check_notes), the entry applied; a Day
  // Book is never refused
  if (lines.length && !v.cancel){
    const sum = r2(lines.reduce((t, l) => t + l[2], 0));
    if (Math.abs(sum) > 0.01) checks.unshift("its lines do not add up to zero (" + rupees(sum) + " " + (sum < 0 ? "more debit" : "more credit") + ")");
    meta.forEach((m) => { if (m.billSum != null && Math.abs(m.billSum - m.a) > 0.01) checks.push("the bill-wise details of " + m.name + " come to " + rupees(m.billSum) + ", not the line's " + rupees(m.a)); });
    v.items.forEach((it) => { if (Math.abs(it.alloc - it.taxable) > 0.01) checks.push("item " + (it.item || it.n + 1) + ": taxable value " + rupees(it.taxable) + " but the ledger lines under it come to " + rupees(it.alloc)); });
    // the tax: checked when the invoice charges GST (it has GST ledger lines) and Tally applied a GST rate to its items:
    // the items' tax (and that of a taxed ledger line beside them, e.g. freight with its own rate) against those lines,
    // within one rupee (Tally rounds per ledger). Items with no rate of Tally's (GST typed on the ledgers by hand, or a
    // body from a bridge before 2.3.1 part A) cannot be checked this way: not a failure
    // review M3 (06-Oct-2026): a tax that cannot be checked this way is said in plain words, which case ("tax not checked:
    // ..."): GST ledgers not named as GST, an item line without Tally's rate, a cess based on quantity. A note, never a hold
    const unrated = v.items.filter((it) => it.gst == null), cessQty = items.filter((it) => rateHeads(it.own).cessQty);
    const itemTax = r2(v.items.reduce((t, it) => t + it.cgst + it.sgst + it.igst + it.cess, 0));
    const others = meta.filter((m) => !m.it && !m.bills && !TAXNAME.test(m.name) && !m.rate && Math.abs(m.a) > 0.005);
    const nm = (xs) => xs.slice(0, 3).map((x) => x).join(", ") + (xs.length > 3 ? " and " + (xs.length - 3) + " more" : "");
    if (v.items.some((it) => it.gst != null) && !named.length && others.length && itemTax > 0.005){
      checks.push("tax not checked: no ledger line of this entry is named as a GST ledger (CGST, SGST, IGST or cess), so the GST worked out on the items (" + rupees(itemTax) + ") was not compared; its other ledger lines: " + nm(others.map((m) => m.name)));
    } else if (unrated.length && named.length){
      checks.push("tax not checked: Tally gave no GST rate on the line of " + nm(unrated.map((it) => it.item || "item " + (it.n + 1))) + ", so the items' GST was not worked out");
    } else if (cessQty.length && named.length){
      checks.push("tax not checked: a cess based on quantity on " + nm(cessQty.map((it) => one(it.own, "STOCKITEMNAME") || "an item")) + " is not worked out by FinCom");
    } else if (v.items.some((it) => it.gst != null) && named.length){
      const want = r2(itemTax + meta.filter((m) => !m.it && !m.bills && !TAXNAME.test(m.name) && m.rate).reduce((t, m) => t + m.a * m.rate / 100, 0));
      const got = r2(named.reduce((t, m) => t + m.a, 0));
      if (Math.abs(want - got) > 1) checks.push("the GST worked out on the items (" + rupees(want) + ") does not match the GST ledger lines (" + rupees(got) + ")");
    }
  }
  v.checks = checks.map((c) => c.slice(0, 300)).slice(0, 20);
  return {v, lines};
}

// a ledger, group or party name as kept in the cloud copy (migration-23): the shared rule (namesClean); spaces inside a
// name stay as they are (Tally keeps "Arktos  Control & Instruments" with two, and a posting uses Tally's exact name).
// index.ts cleans every name it sends to the database with it, and the database's tally_nm applies its line-break part
// again there
function cleanName(n){ return namesClean(n); }

// the whole text of one day (or several): entries, lines, and the highest change number
function parseDay(text){
  const byId = new Map();
  // 06-Oct-2026: a collection's CMPINFO counters dropped first (a Day Book export has none: read as before)
  // 2.3.1 (migration-50 review L7): skipped, the voucher elements left out by the rule below (no GUID; no ledger lines and not a
  // cancelled document with a number), so tally-ingest takes them off the bridge's count of the day (they are not missing)
  let alterMax = 0, skipped = 0, buf = dropCmpInfo(String(text || "")), cut;
  while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
    const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
    const start = piece.lastIndexOf("<VOUCHER ");
    if (start < 0) continue;
    const r = takeVoucher(piece.slice(start));
    if (!r.v.guid) { skipped++; continue; }
    // as FinCom: an entry with no ledger lines is kept only when it is a cancelled document with a number
    if (!r.lines.length && !(r.v.cancel && r.v.no)) { skipped++; continue; }
    if (r.v.alter > alterMax) alterMax = r.v.alter;
    // the same entry twice (it should not happen): the later change wins, and its lines only
    const had = byId.get(r.v.guid);
    if (!had || r.v.alter >= had.v.alter) byId.set(r.v.guid, r);
  }
  const vouchers = [], lines = [], dates = new Set();
  byId.forEach(r => { vouchers.push(r.v); dates.add(r.v.date); r.lines.forEach(l => lines.push(l)); });
  return {vouchers, lines, n: vouchers.length, skipped, alterMax, dates: Array.from(dates)};
}

export { parseDay, amt, one, unesc, igstRate, cleanName, namesKey, d8, gstType };
