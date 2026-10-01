// One day's day book, as Tally exports it, read into entry heads and ledger lines for the cloud copy.
// The rules are FinCom's own (src/js/04-the-client-s-books-read-from-tally.js, Books.takeVoucher), so the cloud's
// totals are the same figures FinCom works out in the browser: tests/run_cloud_parse.js checks this on real books.
// Plain JavaScript: used by the tally-ingest edge function (Deno) and by the tests (Node).

function num(v){ if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
function unesc(v){
  return String(v || "").replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (m, n) => { const c = num(n); return c >= 32 && c < 127 ? String.fromCharCode(c) : " "; })
    .replace(/&amp;/g, "&").trim();
}
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
    pos: one(s, "PLACEOFSUPPLY").slice(0, 60)
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
  // each line: [guid, ledger, amount, HSN or SAC, GST rate (the whole rate, IGST's) or null]
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
      lines.push([id, name, Math.round(amt(one(e, "AMOUNT")) * 100) / 100, hsn, rate == null ? null : rate]);
    });
  });
  return {v, lines};
}

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

export { parseDay, amt, one, unesc, igstRate };
