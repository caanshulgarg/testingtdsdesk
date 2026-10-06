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
      items.push({a, z, h: one(own, "GSTHSNNAME"), gr: igstRate(own)});
      reA.lastIndex = z + 1;
    }
  }
  // each line: [guid, ledger, amount, HSN or SAC, GST rate (the whole rate, IGST's) or null, bill-wise details]
  const lines = [];
  ["ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST", "ACCOUNTINGALLOCATIONS.LIST"].forEach((tag) => {
    after(s, tag).forEach(({a: pos, p}) => {
      const e = upTo(p, tag);
      const name = one(e, "LEDGERNAME");
      if (!name) return;
      const it = tag === "ACCOUNTINGALLOCATIONS.LIST" ? items.find(q => pos > q.a && pos < q.z) : null;
      const hsn = (it ? it.h : one(e, "GSTHSNNAME")).slice(0, 20);
      const rate = it ? it.gr : igstRate(e);
      // bill-wise details on the line (review of 01-Oct-2026): [bill name, New Ref / Agst Ref / Advance / On Account,
      // amount, credit days or null], as FinCom reads them in the browser, so ageing works from the cloud copy too
      const bills = [];
      if (e.indexOf("<BILLALLOCATIONS.LIST") >= 0){
        after(e, "BILLALLOCATIONS.LIST").forEach(({p: p2}) => {
          const q = upTo(p2, "BILLALLOCATIONS.LIST"), type = one(q, "BILLTYPE"), a = Math.round(amt(one(q, "AMOUNT")) * 100) / 100;
          if (!type || !a) return;
          const cp = (q.match(/<BILLCREDITPERIOD\b[^>]*>([^<]*)<\/BILLCREDITPERIOD>/) || [])[1] || "", dm = cp.match(/^\s*(\d{1,4})\s*Days?\s*$/i);
          bills.push([one(q, "NAME").slice(0, 200), type.slice(0, 20), a, dm ? Number(dm[1]) : null]);
        });
      }
      lines.push([id, name, Math.round(amt(one(e, "AMOUNT")) * 100) / 100, hsn, rate == null ? null : rate, bills]);
    });
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
  let alterMax = 0, buf = dropCmpInfo(String(text || "")), cut;
  while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
    const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
    const start = piece.lastIndexOf("<VOUCHER ");
    if (start < 0) continue;
    const r = takeVoucher(piece.slice(start));
    if (!r.v.guid) continue;
    // as FinCom: an entry with no ledger lines is kept only when it is a cancelled document with a number
    if (!r.lines.length && !(r.v.cancel && r.v.no)) continue;
    if (r.v.alter > alterMax) alterMax = r.v.alter;
    // the same entry twice (it should not happen): the later change wins, and its lines only
    const had = byId.get(r.v.guid);
    if (!had || r.v.alter >= had.v.alter) byId.set(r.v.guid, r);
  }
  const vouchers = [], lines = [], dates = new Set();
  byId.forEach(r => { vouchers.push(r.v); dates.add(r.v.date); r.lines.forEach(l => lines.push(l)); });
  return {vouchers, lines, n: vouchers.length, alterMax, dates: Array.from(dates)};
}

export { parseDay, amt, one, unesc, igstRate, cleanName, namesKey };
