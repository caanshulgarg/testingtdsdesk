// gst-run: what a client's 3B is worked out from, read from FinCom's cloud with the service role (the handler has checked
// the caller first). The book is picked as tally_pick and mis-run's fetchBook pick it (started by the day, the latest such);
// its entries are read with the columns the app reads (BookSrc.HEADS_GST, src/js/67), every line and bill allocation,
// the ledgers and groups; the client's work (client_book_items), its record (clients), its marketplace sales (records,
// kind 'sales'), and the 2B matching gst-2b-match kept for each of its GSTINs and years (gst_2b_runs, gst_2b_decisions).
export type Rest = (path: string) => Promise<any>;
const enc = encodeURIComponent;

async function all(rest: Rest, path: string, order: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 5_000_000; off += 1000) {
    const rows = await rest(path + "&order=" + order + "&limit=1000&offset=" + off);
    if (!Array.isArray(rows)) throw new Error("the cloud copy could not be read");
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export const HEADS = "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date,gst_reg_type,gst_country,gst_rcm,gst_nature,gst_taxability,gst_supply,gst_ineligible,gst_mixed,gst_alter_id";

export async function pickBook(rest: Rest, firm: string, client: string, day: string) {
  const books = await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&from_date=not.is.null");
  return (books || []).filter((b: any) => !b.open_as_on || b.open_as_on <= day).sort((a: any, b: any) => (Number(b.from_date <= day) - Number(a.from_date <= day)) || String(b.from_date).localeCompare(String(a.from_date)))[0] || null;
}

const fyOf = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6), s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); };

export async function load(rest: Rest, firm: string, client: string, book: any, co: any, fys: string[]) {
  const bk = "book_id=eq." + enc(book.book_id);
  const [heads, lines, bills, ledgers, groups, items, sales] = await Promise.all([
    all(rest, "/rest/v1/tally_vouchers?select=" + HEADS + "&" + bk, "day,guid"),
    all(rest, "/rest/v1/tally_lines?select=guid,ledger,amount,hsn,rate&" + bk, "guid,id"),
    all(rest, "/rest/v1/tally_bills?select=guid,ledger,name,type,amount,credit_days&" + bk, "guid,id"),
    all(rest, "/rest/v1/tally_ledgers?select=name,parent,open,pan,gstin&merged_into=is.null&" + bk, "name"),
    all(rest, "/rest/v1/tally_groups?select=name,parent&" + bk, "name").catch(() => []),
    all(rest, "/rest/v1/client_book_items?select=key,item,ord,data,deleted&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&deleted=eq.false", "key,item"),
    all(rest, "/rest/v1/records?select=id,data&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&kind=eq.sales&deleted=eq.false", "id"),
  ]);
  // the 2B matching kept by gst-2b-match, as its "get" shows it to the app (the run, with the decisions taken on it)
  const runs: Record<string, any> = {};
  const gstins = Array.from(new Set(heads.map((h: any) => String(h.cmp_gstin || "").toUpperCase()).concat([String((co || {}).gstin || "").toUpperCase()]).filter((g) => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  for (const g of gstins) for (const fy of fys) {
    const w = "firm_id=eq." + enc(firm) + "&gstin=eq." + enc(g) + "&fy=eq." + enc(fy);
    const run = ((await rest("/rest/v1/gst_2b_runs?select=id,status,done_at,queued_at,result&" + w + "&status=eq.done&order=id.desc&limit=1").catch(() => [])) || [])[0];
    if (!run) continue;
    const dec = (await rest("/rest/v1/gst_2b_decisions?select=pair_id,decision&" + w).catch(() => [])) || [];
    runs[g + "|" + fy] = { id: run.id, status: run.status, at: run.done_at || run.queued_at, result: run.result, decisions: Object.fromEntries(dec.map((r: any) => [r.pair_id, r.decision])) };
  }
  return { client, co, book, heads, lines, bills, ledgers, groups, items, sales: sales.map((r: any) => r.data).filter(Boolean), runs };
}
export { fyOf };
