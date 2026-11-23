// deno run --allow-all tests/run_gst_sales_seen.ts - gst-run's view of the marketplace invoices of Sales that the book's
// entries show (server/gst-run/data.ts salesSeen, engine.js seenOf; GSTR.inBooks reads it), on made-up rows only.
// Run by tests/run_gst_cloud.js (section 6). The final review of 157da641f:
//   B. a failed read is an error (the run fails and the app works the month out itself), never "nothing seen", which
//      would count a posted invoice twice; gst_calc_rows' heads carry the FinCom id (migration 210, read when there)
//   1. an invoice found already in Tally on a sale of the client's own type ("Tax Invoice", "Amazon Invoice") is seen
//   2. only invoices posted, queued for posting or in Tally are asked about; 4,000 of them within the run's budget
//      (SHARE_BUDGET, 1,500 ms) with each answer taking 30 ms
//   3. (with run_gst_audit_fix.js 10) the entry's total goes with its number and date
import { salesSeen, unpack, HEADS } from "../server/gst-run/data.ts";
import { seenOf } from "../server/gst-run/engine.js";
import * as E from "../server/_shared/gst3b.js";

let fails = 0;
const ok = (c: boolean, w: string) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const BK = "book_id=eq.bk-1";
const inv = (id: string, no: string, status: string, o: any = {}) => Object.assign({ id, source: "market", status, x: { number: no, date: "2025-10-01", total: 11800, taxable: 10000 } }, o);

// B. a failing fetch
{
  const rest = async (_p: string) => { throw Object.assign(new Error("HTTP 503"), { status: 503 }); };
  let err = "";
  try { await salesSeen(rest, BK, [inv("mk1", "AMZ-21", "posted")]); } catch (e) { err = String((e as Error).message || e); }
  ok(/503/.test(err), "B. a read that fails is an error, never nothing seen (" + (err || "no error") + ")");
  const p = { ledgers: ["Retail Customer", "Sales"], heads: [[...HEADS.split(",").map((c) => c === "guid" ? "g1" : c === "vno" ? "AMZ-21" : c === "day" ? "2025-10-01" : c === "vtype" ? "Sales" : null), [[0, -100, null, null], [1, 100, null, null]], [], "mk1"]] };
  const u = unpack(p), v = E.BookSrc.fromCopy(u.heads, u.lines, u.bills)[0];
  ok(u.heads[0].fincom_id === "mk1" && v && v.fid === "mk1", "B. gst_calc_rows' heads with the FinCom id after the bills (migration 210): the entry's fid (" + (v && v.fid) + ")");
  const u0 = unpack({ ledgers: [], heads: [[...HEADS.split(",").map((c) => c === "guid" ? "g1" : null), [], []]] });
  ok(u0.heads.length === 1 && !u0.heads[0].fincom_id, "B. an answer without it (migration 210 not applied) read as before");
}

// 1. a sale of the client's own voucher type
{
  const s = seenOf({ fids: [], heads: [{ vno: "AMZ-21", day: "2025-10-01", vtype: "Tax Invoice", total: 11800 }, { vno: "FK-31", day: "2025-10-01", vtype: "Amazon Invoice", total: 5900 }] });
  const ks = (s && s.nos || []).map((n: any) => n.k);
  ok(ks.includes(E.GSTR.saleNoKey("AMZ-21", "20251001")) && ks.includes(E.GSTR.saleNoKey("FK-31", "20251001")), "1. sales of the types \"Tax Invoice\" and \"Amazon Invoice\" are seen (" + JSON.stringify(ks) + ")");
}

// 2. which invoices are asked about, how many at a time, and the time
{
  const asked: string[] = []; let calls = 0, open = 0, most = 0;
  const rest = async (p: string) => {
    calls++; open++; most = Math.max(most, open);
    await new Promise((r) => setTimeout(r, 30));
    open--;
    const m = /fincom_id=in\.\(([^)]*)\)/.exec(p);
    if (m) { const ids = decodeURIComponent(m[1]).split(",").map((x) => x.replace(/"/g, "")); asked.push(...ids); return ids.filter((x) => /0$/.test(x)).map((x) => ({ fincom_id: x })); }
    return [];
  };
  const list: any[] = [];
  for (let i = 0; i < 4000; i++) list.push(inv("p" + i, "P-" + i, i % 3 === 0 ? "posted" : i % 3 === 1 ? "review" : "ready", i % 3 === 2 ? { postJob: "job-" + i } : {}));
  list.push(inv("r-never", "R-1", "review"), inv("ig", "I-1", "ignored"));
  const t0 = Date.now(), s = await salesSeen(rest, BK, list), ms = Date.now() - t0;
  const want = list.filter((v) => v.status === "posted" || v.postJob).length;
  ok(asked.length === want && !asked.includes("r-never") && !asked.includes("ig") && !asked.includes("p1"), "2. only the invoices posted or queued for posting are asked about: " + asked.length + " of " + list.length + " (" + want + ")");
  ok(ms <= 1500 && calls <= Math.ceil(want / 200) + 2 && most > 1 && most <= 4, "2. " + want + " invoices in " + calls + " requests, " + most + " at a time, " + ms + " ms (within the run's 1,500 ms)");
  ok(s.fids.length === asked.filter((x) => /0$/.test(x)).length, "2. the FinCom ids found: " + s.fids.length);
}

// 3. an invoice in Tally: its number (Tally's own, tallyMatch) with the entry's total
{
  const rest = async (p: string) => {
    if (/vno=in/.test(p)) return [{ guid: "g9", vno: "AMZ21", day: "2025-10-02", vtype: "Tax Invoice" }];
    if (/tally_lines/.test(p)) return [{ guid: "g9", amount: -5900 }, { guid: "g9", amount: 5000 }, { guid: "g9", amount: 900 }];
    return [];
  };
  const s = await salesSeen(rest, BK, [inv("t1", "AMZ-21", "intally", { tallyMatch: { number: "AMZ21", date: "20251002" } })]);
  ok(s.heads.length === 1 && s.heads[0].total === 5900 && s.heads[0].vno === "AMZ21", "3. an invoice in Tally: the entry of Tally's number AMZ21, its total 5,900 (" + JSON.stringify(s.heads) + ")");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
Deno.exit(fails ? 1 : 0);
