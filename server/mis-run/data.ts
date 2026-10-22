// mis-run (ROUND 105 B6): a client's books from FinCom's cloud copy made into the My MIS engine's input (the same engine
// as the app, app/src/lib/misCustom.js, `data`). The cloud copy's tables: tally_books (the book, its first day),
// tally_ledgers (name, chain: the group path, open: the balance on the book's first day, Tally's sign), tally_vouchers,
// tally_lines (each entry's ledger lines, a credit positive) and tally_bills (the bill allocations). Each ledger's place by
// its groups (server/_shared/misledger.js), each entry's sales and customer and purchases and supplier by MIS's rules,
// the ageing by MIS's own (server/_shared/misageing.js); GST by month from the server's GST working (tally_gst_summary,
// passed in). Pure apart from fetchBook, which reads the rows through a REST function given to it.
import { ledgerRec } from "../_shared/misledger.js";
import { ageing, forEngine } from "../_shared/misageing.js";
import { periodOf } from "../../app/src/lib/misCustom.js";

export type Rest = (path: string) => Promise<any>;
const enc = encodeURIComponent;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ymd = (d: string) => String(d || "").replace(/-/g, "").slice(0, 8);

// every row of a table for the book (1000 at a time), in a fixed order
async function all(rest: Rest, path: string, order: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 2_000_000; off += 1000) {
    const rows = await rest(path + "&order=" + order + "&limit=1000&offset=" + off);
    if (!Array.isArray(rows)) throw new Error("the cloud copy could not be read");
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
// the book that covers a day (as tally_pick: started by then, the latest such), and its rows up to that day
export async function fetchBook(rest: Rest, firm: string, client: string, to: string) {
  const books = await rest("/rest/v1/tally_books?select=book_id,client_id,company,from_date,open_as_on&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&from_date=not.is.null");
  const day = to.slice(0, 4) + "-" + to.slice(4, 6) + "-" + to.slice(6);
  const pick = (books || []).filter((b: any) => !b.open_as_on || b.open_as_on <= day).sort((a: any, b: any) => (Number(b.from_date <= day) - Number(a.from_date <= day)) || String(b.from_date).localeCompare(String(a.from_date)))[0];
  if (!pick) return null;
  const bk = "book_id=eq." + enc(pick.book_id);
  const ledgers = await all(rest, "/rest/v1/tally_ledgers?select=name,parent,chain,primary_group,open&" + bk + "&merged_into=is.null&deleted_at=is.null", "name");
  const vouchers = await all(rest, "/rest/v1/tally_vouchers?select=guid,day,vtype,vno,party,narration&" + bk + "&deleted_at=is.null&cancelled=is.false&optional=is.false&day=lte." + day, "day,guid");
  const lines = await all(rest, "/rest/v1/tally_lines?select=guid,ledger,amount&" + bk + "&day=lte." + day, "guid,id");
  const bills = await all(rest, "/rest/v1/tally_bills?select=guid,ledger,name,type,amount,credit_days&" + bk + "&day=lte." + day, "guid,id");
  return { book: pick, ledgers, vouchers, lines, bills };
}

// the engine's input from those rows (gst: tally_gst_summary's answer, or null)
export function cloudData(rows: any, def: any, today: string, gst: any = null) {
  const L: Record<string, any> = {};
  for (const l of rows.ledgers) { const chain = (Array.isArray(l.chain) && l.chain.length ? l.chain : [l.parent].filter(Boolean)).map(String);
    if (l.primary_group && chain[chain.length - 1] !== l.primary_group) chain.push(String(l.primary_group));     // up to its primary group
    L[l.name] = ledgerRec(l.name, chain);
  }
  const led = (n: string) => (L[n] = L[n] || ledgerRec(n, []));
  const byGuid = new Map<string, any[]>();
  for (const x of rows.lines) { if (!byGuid.has(x.guid)) byGuid.set(x.guid, []); byGuid.get(x.guid)!.push({ l: x.ledger, a: r2(Number(x.amount) || 0) }); }
  const billsOf = new Map<string, any[]>();
  for (const b of rows.bills) { const k = b.guid + "|" + b.ledger; if (!billsOf.has(k)) billsOf.set(k, []); billsOf.get(k)!.push([b.name || "", b.type || "", Number(b.amount) || 0, Number(b.credit_days) || 0]); }
  const vouchers = rows.vouchers.map((v: any) => {
    const ent = (byGuid.get(v.guid) || []).map((e: any) => { led(e.l); const b = billsOf.get(v.guid + "|" + e.l); return b ? { ...e, b } : e; });
    const out: any = { id: v.guid, date: ymd(v.day), no: v.vno || "", type: v.vtype || "", party: v.party || "", narr: v.narration || "", ent };
    // MIS.sales (with the masters): the entry's Sales Accounts lines, under its party, else its customer's line
    const s = ent.filter((e: any) => L[e.l].sales);
    if (s.length) { const sa = r2(s.reduce((t: number, e: any) => t + e.a, 0)); if (sa) { out.sa = sa; out.who = v.party || (ent.find((e: any) => L[e.l].kind === "r") || ent.find((e: any) => (e.a < 0) !== (sa < 0) && !L[e.l].sales) || {}).l || "—"; } }
    // MIS.purchases: not a sale; the supplier credited; its expense, purchase and fixed-asset debits
    const sale = !!out.sa || /^(sales|credit note)/i.test(out.type);
    if (!sale) { const p = ent.find((e: any) => e.a > 0 && L[e.l].kind === "p"); if (p) { const val = r2(ent.filter((e: any) => e.a < 0 && (L[e.l].exp || L[e.l].pur || L[e.l].fixed)).reduce((t: number, e: any) => t - e.a, 0)); if (val) { out.pa = val; out.pw = p.l; } } }
    return out;
  });
  const from = ymd(rows.book.from_date), open = { from, bal: Object.fromEntries(rows.ledgers.map((l: any) => [l.name, r2(Number(l.open) || 0)])) };
  let last = ""; for (const v of vouchers) if (v.date > last) last = v.date;
  const data: any = { v: 1, company: rows.book.company || "", booksFrom: from, booksTo: last || from, vouchers, ledgers: L, open, codes: null, gst: null, ageing: null, budget: {} };
  const pr = periodOf(def, data, today), by = (def.blocks || []).map((b: any) => b.rows.by);
  if (by.includes("ageing")) {
    const bal: Record<string, number> = { ...open.bal };
    for (const v of vouchers) if (v.date >= from && v.date <= pr.to) for (const e of v.ent) bal[e.l] = r2((bal[e.l] || 0) + e.a);
    const kindOf = (l: string) => (L[l] || {}).kind || "";
    data.ageing = { asOn: pr.to, r: forEngine(ageing(vouchers, kindOf, pr.to, "r", bal)), p: forEngine(ageing(vouchers, kindOf, pr.to, "p", bal)) };
  }
  if (by.includes("gst") && gst && Array.isArray(gst.months)) {
    // the server's working: output tax and credit on documents, reverse charge; to pay = output less credit (not below
    // nought) plus reverse charge, month by month (no credit carried between months); paid from the bank is not known here
    const sum = (o: any) => r2(["IGST", "CGST", "SGST", "CESS"].reduce((t, k) => t + (Number((o || {})[k]) || 0), 0));
    data.gst = {};
    for (const m of gst.months) { const out = sum(m.out), itc = sum(m.in), rcm = r2(Number(m.rcmOut) || 0); data.gst[m.ym] = { out, itc, rcm, carry: null, due: r2(Math.max(0, out - itc) + rcm), pay: null }; }
  }
  return data;
}
