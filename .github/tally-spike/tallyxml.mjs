// The harness's own reader of Tally's XML (independent of the bridge and of parse.js): a nesting-aware tree of one
// voucher, and the voucher read into the fields the owner's scenarios compare (heads, ledger lines with their bills,
// cost centres, bank details and TDS, items with HSN, quantity, unit, rate, value and GST rate).
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function dec(s) {
  return String(s ?? "").replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}
// a tree of the text: {tag, attrs, kids, text}
export function tree(text) {
  const root = { tag: "#root", attrs: {}, kids: [], text: "" }, stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.text += m[5]; continue; }
    if (!m[2]) continue;
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === m[2]) { stack.length = i; break; } continue; }
    const attrs = {}; (m[3] || "").replace(/([\w.:-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k] = dec(v); return ""; });
    const n = { tag: m[2], attrs, kids: [], text: "" };
    top.kids.push(n);
    if (!m[4]) stack.push(n);
  }
  return root;
}
export const kids = (n, tag) => (n?.kids || []).filter(k => k.tag === tag);
export const kid = (n, tag) => kids(n, tag)[0];
export const val = (n, tag) => dec(kid(n, tag)?.text ?? "");
export function find(n, pred, out = []) { for (const k of n?.kids || []) { if (pred(k)) out.push(k); find(k, pred, out); } return out; }
export const num = v => { const t = String(v ?? ""), i = t.lastIndexOf("="); const x = parseFloat((i >= 0 ? t.slice(i + 1) : t).replace(/[^0-9.\-]/g, "")); return isFinite(x) ? x : 0; };
export const r2 = x => Math.round(x * 100) / 100;
// the voucher element of this GUID in an export (several exports may be concatenated)
export function voucherOf(text, guid) {
  for (const v of find(tree(text), k => k.tag === "VOUCHER")) {
    if (val(v, "GUID") === guid || v.attrs.REMOTEID === guid) return v;
  }
  return null;
}
// a quantity " 2 Nos" or "2 Nos" -> {qty: 2, unit: "Nos"}; a rate "250.00/Nos" -> {rate: 250, per: "Nos"}
const qtyOf = s => { const m = String(s || "").trim().match(/^(-?[\d.,]+)\s*(.*)$/); return m ? { qty: num(m[1]), unit: m[2].trim() } : { qty: 0, unit: "" }; };
const rateOf = s => { const m = String(s || "").trim().match(/^(-?[\d.,]+)\s*\/?\s*(.*)$/); return m ? { rate: num(m[1]), per: m[2].trim() } : { rate: 0, per: "" }; };
// the GST rate of a block's rate details: IGST's (the whole rate), else CGST + SGST
function gstRate(n) {
  let igst = null, half = 0, seen = false;
  for (const rd of find(n, k => k.tag === "RATEDETAILS.LIST")) {
    const h = val(rd, "GSTRATEDUTYHEAD"), r = num(val(rd, "GSTRATE"));
    if (/^IGST/i.test(h)) igst = r; else if (/^(CGST|SGST)/i.test(h)) { half += r; seen = true; }
  }
  return igst != null && igst > 0 ? igst : seen ? half : null;
}
function ledgerLine(e) {
  const o = { ledger: val(e, "LEDGERNAME"), amount: r2(num(val(e, "AMOUNT"))) };
  o.bills = kids(e, "BILLALLOCATIONS.LIST").map(b => ({ name: val(b, "NAME"), type: val(b, "BILLTYPE"), amount: r2(num(val(b, "AMOUNT"))) })).filter(b => b.name || b.type);
  o.costs = [];
  for (const c of kids(e, "CATEGORYALLOCATIONS.LIST")) for (const cc of kids(c, "COSTCENTREALLOCATIONS.LIST")) o.costs.push({ category: val(c, "CATEGORY"), centre: val(cc, "NAME"), amount: r2(num(val(cc, "AMOUNT"))) });
  o.bank = kids(e, "BANKALLOCATIONS.LIST").map(b => ({ txnType: val(b, "TRANSACTIONTYPE"), instNo: val(b, "INSTRUMENTNUMBER"), instDate: val(b, "INSTRUMENTDATE"), bankDate: val(b, "BANKERSDATE"),
    utr: val(b, "UNIQUEREFERENCENUMBER") || val(b, "UTRNUMBER") || val(b, "TRANSFERREFERENCENO"), favouring: val(b, "PAYMENTFAVOURING"), mode: val(b, "PAYMENTMODE"), amount: r2(num(val(b, "AMOUNT"))),
    all: Object.fromEntries((b.kids || []).filter(k => !k.kids.length && dec(k.text)).map(k => [k.tag, dec(k.text)])) })).filter(b => b.txnType || b.instNo || b.amount);
  // TDS as Tally keeps it on a line (its tax object allocations), every plain field kept as it is
  o.tds = find(e, k => k.tag === "TAXOBJECTALLOCATIONS.LIST" || k.tag === "TDSEXPENSEALLOCATIONS.LIST").map(t => Object.fromEntries(find(t, k => !k.kids.length && dec(k.text)).map(k => [k.tag, dec(k.text)]))).filter(x => Object.keys(x).length);
  return o;
}
// the voucher as the scenarios compare it; Tally's ALLLEDGERENTRIES when it has any (the whole entry), else LEDGERENTRIES
// with each item's ACCOUNTINGALLOCATIONS
export function model(v) {
  const head = { guid: val(v, "GUID") || v.attrs.REMOTEID || "", type: v.attrs.VCHTYPE || val(v, "VOUCHERTYPENAME"), no: val(v, "VOUCHERNUMBER"), date: val(v, "DATE"), party: val(v, "PARTYLEDGERNAME") || val(v, "PARTYNAME"),
    partyGstin: val(v, "PARTYGSTIN"), narration: val(v, "NARRATION"), reference: val(v, "REFERENCE"), masterId: val(v, "MASTERID"), alterId: val(v, "ALTERID"),
    // the e-invoice and e-way bill as Tally keeps them on the entry (stored fields)
    irn: val(v, "IRN"), ackNo: val(v, "IRNACKNO"), ackDate: val(v, "IRNACKDATE"), eway: kids(v, "EWAYBILLDETAILS.LIST").map(e => val(e, "BILLNUMBER")).find(Boolean) || "",
    // the TDS section wherever Tally writes it on the entry (a bill-wise detail's TDSDEDUCTEESECTIONNUMBER)
    sections: [...new Set(find(v, k => k.tag === "TDSDEDUCTEESECTIONNUMBER").map(k => dec(k.text)).filter(Boolean))] };
  const all = kids(v, "ALLLEDGERENTRIES.LIST").map(ledgerLine).filter(l => l.ledger);
  const items = kids(v, "ALLINVENTORYENTRIES.LIST").concat(kids(v, "INVENTORYENTRIES.LIST")).map(it => {
    const q = qtyOf(val(it, "BILLEDQTY") || val(it, "ACTUALQTY")), r = rateOf(val(it, "RATE"));
    return { item: val(it, "STOCKITEMNAME"), hsn: val(it, "GSTHSNNAME") || val(it, "HSNCODE") || val(it, "GSTHSNSACCODE"), qty: q.qty, unit: q.unit || r.per, rate: r.rate,
      amount: r2(num(val(it, "AMOUNT"))), gstRate: gstRate(it), ledgers: kids(it, "ACCOUNTINGALLOCATIONS.LIST").map(ledgerLine).filter(l => l.ledger) };
  }).filter(i => i.item);
  const other = kids(v, "LEDGERENTRIES.LIST").map(ledgerLine).filter(l => l.ledger).concat(...items.map(i => i.ledgers));
  // ALLLEDGERENTRIES unless it does not add up and the other view does (an item invoice whose items' ledgers sit only under them)
  const tot = l => r2(l.reduce((s, x) => s + x.amount, 0));
  const both = all.concat(...items.map(i => i.ledgers));
  const pick = !all.length ? ["LEDGERENTRIES + ACCOUNTINGALLOCATIONS", other] : Math.abs(tot(all)) <= 0.01 ? ["ALLLEDGERENTRIES", all]
    : Math.abs(tot(other)) <= 0.01 && other.length ? ["LEDGERENTRIES + ACCOUNTINGALLOCATIONS", other] : Math.abs(tot(both)) <= 0.01 ? ["ALLLEDGERENTRIES + ACCOUNTINGALLOCATIONS", both] : ["ALLLEDGERENTRIES", all];
  const lines = pick[1];
  return { head, lines, items, view: pick[0], sum: tot(lines) };
}
