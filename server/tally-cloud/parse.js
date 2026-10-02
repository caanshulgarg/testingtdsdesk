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
function one(s, tag){ const m = s.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">")); return m ? unesc(m[1]) : ""; }
// "$17000.00 @ ₹ 86.40/$ = ₹ 1468800.00" is 1468800: the rupee value after the last "="
function amt(v){ const t = String(v || ""), i = t.lastIndexOf("="); return num(i >= 0 ? t.slice(i + 1) : t); }
// the IGST rate in a block's rate details, which is the whole GST rate; null when not set (as Books.igstRate)
function igstRate(s){ const m = String(s || "").match(/<GSTRATEDUTYHEAD>IGST<\/GSTRATEDUTYHEAD>\s*<GSTRATEVALUATIONTYPE>[^<]*<\/GSTRATEVALUATIONTYPE>\s*<GSTRATE>\s*([\d.]+)\s*<\/GSTRATE>/); return m ? num(m[1]) : null; }

// a long narration is cut to 300 characters, keeping FinCom's own mark at its end ("TDSDesk:<id>"): the checks before
// posting look for it in the cloud copy
function shortNarr(t){
  if (t.length <= 300) return t;
  const m = t.match(/TDSDesk:[A-Za-z0-9._-]+\s*$/);
  return m ? t.slice(0, 300 - m[0].length - 3) + " | " + m[0] : t.slice(0, 300);
}
function takeVoucher(s){
  const id = String(one(s, "GUID") || (s.match(/REMOTEID="([^"]*)"/) || [])[1] || "").replace(/[^\w\-.:]/g, "");
  const v = {
    guid: id,
    date: one(s, "DATE"),
    alter: Math.round(num(one(s, "ALTERID"))),
    type: (s.match(/VCHTYPE="([^"]*)"/) || [])[1] || one(s, "VOUCHERTYPENAME"),
    no: one(s, "VOUCHERNUMBER"),
    party: one(s, "PARTYNAME") || one(s, "PARTYLEDGERNAME"),
    narr: shortNarr(one(s, "NARRATION")),
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
  if (s.indexOf("<ALLINVENTORYENTRIES.LIST>") >= 0){
    let at = 0;
    for (;;){
      const a = s.indexOf("<ALLINVENTORYENTRIES.LIST>", at); if (a < 0) break;
      const z = s.indexOf("</ALLINVENTORYENTRIES.LIST>", a); if (z < 0) break;
      const own = s.slice(a, z).replace(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g, "");
      items.push({a, z, h: one(own, "GSTHSNNAME"), gr: igstRate(own)});
      at = z + 1;
    }
  }
  // each line: [guid, ledger, amount, HSN or SAC, GST rate (the whole rate, IGST's) or null, bill-wise details]
  const lines = [];
  [["<ALLLEDGERENTRIES.LIST>", "</ALLLEDGERENTRIES.LIST>"], ["<LEDGERENTRIES.LIST>", "</LEDGERENTRIES.LIST>"], ["<ACCOUNTINGALLOCATIONS.LIST>", "</ACCOUNTINGALLOCATIONS.LIST>"]].forEach(([open, close]) => {
    let pos = -1;
    s.split(open).slice(1).forEach(p => {
      pos = s.indexOf(open, pos + 1);
      const e = p.split(close)[0];
      const name = one(e, "LEDGERNAME");
      if (!name) return;
      const it = open === "<ACCOUNTINGALLOCATIONS.LIST>" ? items.find(q => pos > q.a && pos < q.z) : null;
      const hsn = (it ? it.h : one(e, "GSTHSNNAME")).slice(0, 20);
      const rate = it ? it.gr : igstRate(e);
      // bill-wise details on the line (review of 01-Oct-2026): [bill name, New Ref / Agst Ref / Advance / On Account,
      // amount, credit days or null], as FinCom reads them in the browser, so ageing works from the cloud copy too
      const bills = [];
      if (e.indexOf("<BILLALLOCATIONS.LIST>") >= 0){
        e.split("<BILLALLOCATIONS.LIST>").slice(1).forEach(p2 => {
          const q = p2.split("</BILLALLOCATIONS.LIST>")[0], type = one(q, "BILLTYPE"), a = Math.round(amt(one(q, "AMOUNT")) * 100) / 100;
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
  if (s.indexOf("<PAYHEADALLOCATIONS.LIST>") >= 0){
    const by = new Map();
    s.split("<PAYHEADALLOCATIONS.LIST>").slice(1).forEach(p => {
      const q = p.split("</PAYHEADALLOCATIONS.LIST>")[0], n = one(q, "PAYHEADNAME"), a = amt(one(q, "AMOUNT"));
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
  let alterMax = 0, buf = String(text || ""), cut;
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
