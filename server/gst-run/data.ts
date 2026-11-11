// gst-run: what a client's 3B is worked out from, read from FinCom's cloud with the service role (the handler has checked
// the caller first). The book is picked as tally_pick and mis-run's fetchBook pick it (started by the day, the latest such);
// its entries are read with the columns the app reads (BookSrc.HEADS_GST, src/js/67), every line and bill allocation
// (gst_calc_rows, migration 153: one compact answer),
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

// the month's book: gst_calc_book (migration 153), the same function gst_calc_cached picks it with
export async function pickBook(rest: Rest, rpc: (fn: string, a: Record<string, unknown>) => Promise<any>, firm: string, client: string, ym: string) {
  const id = await rpc("gst_calc_book", { p_firm: firm, p_client: client, p_ym: ym });
  if (!id) return null;
  return ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&book_id=eq." + enc(String(id)))) || [])[0] || null;
}

const fyOf = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6), s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); };

// gst_calc_rows' compact answer as the rows BookSrc.fromCopy reads (each name one string, shared by its lines)
const COLS = HEADS.split(",");
export function unpack(p: any) {
  if (!p) return { heads: [], lines: [], bills: [] };
  const L: string[] = (p && p.ledgers) || [], heads: any[] = [], lines: any[] = [], bills: any[] = [];
  ((p && p.heads) || []).forEach((x: any[]) => {
    const h: any = {}; COLS.forEach((c, i) => { h[c] = x[i]; }); heads.push(h);
    (x[COLS.length] || []).forEach((l: any[]) => lines.push({ guid: h.guid, ledger: L[l[0]], amount: l[1], hsn: l[2], rate: l[3] }));
    (x[COLS.length + 1] || []).forEach((b: any[]) => bills.push({ guid: h.guid, ledger: L[b[0]], name: b[1], type: b[2], amount: b[3], credit_days: b[4] }));
  });
  return { heads, lines, bills };
}
// gstins: the client's GSTINs as gst_calc_gstins gives them (the version counts the 2B runs and decisions of the same)
// made: the book's entries as gst-run made them before (gst_calc_prep, migration 162: BookSrc.fromCopy's list, kept on
// the book's version and the engine); the book's own rows are then not read (heads, lines and bills empty)
export async function load(rest: Rest, rpc: (fn: string, a: Record<string, unknown>) => Promise<any>, firm: string, client: string, book: any, co: any, fys: string[], gstins: string[], made?: any[]) {
  const bk = "book_id=eq." + enc(book.book_id);
  const [packed, ledgers, groups, items, sales] = await Promise.all([
    made ? null : rpc("gst_calc_rows", { p_book: book.book_id }),
    all(rest, "/rest/v1/tally_ledgers?select=name,parent,open,pan,gstin&merged_into=is.null&deleted_at=is.null&" + bk, "name"),
    all(rest, "/rest/v1/tally_groups?select=name,parent&" + bk, "name").catch(() => []),
    all(rest, "/rest/v1/client_book_items?select=key,item,ord,data,deleted&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&deleted=eq.false", "key,item"),
    all(rest, "/rest/v1/records?select=id,data&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&kind=eq.sales&deleted=not.is.true", "id"),
  ]);
  const u0 = Date.now(), { heads, lines, bills } = unpack(packed), unpackMs = Date.now() - u0;
  // the 2B matching kept by gst-2b-match, as its "get" shows it to the app (the run, with the decisions taken on it)
  const runs: Record<string, any> = {};
  for (const g of gstins) for (const fy of fys) {
    const w = "firm_id=eq." + enc(firm) + "&gstin=eq." + enc(g) + "&fy=eq." + enc(fy);
    const run = ((await rest("/rest/v1/gst_2b_runs?select=id,status,done_at,queued_at,result&" + w + "&status=eq.done&order=id.desc&limit=1").catch(() => [])) || [])[0];
    if (!run) continue;
    const dec = (await rest("/rest/v1/gst_2b_decisions?select=pair_id,decision&" + w).catch(() => [])) || [];
    runs[g + "|" + fy] = { id: run.id, status: run.status, at: run.done_at || run.queued_at, result: run.result, decisions: Object.fromEntries(dec.map((r: any) => [r.pair_id, r.decision])) };
  }
  return { client, co, book, heads, lines, bills, made: made || null, fromPrep: !!made, ledgers, groups, items, sales: sales.map((r: any) => r.data).filter(Boolean), runs, unpackMs };
}
export { fyOf };
