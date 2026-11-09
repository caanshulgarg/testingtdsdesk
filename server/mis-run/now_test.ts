// deno test --allow-all server/mis-run/now_test.ts - mis-run {action: "now"} (next-cloud-calc1, migration 151): MIS's
// figures for a period worked out in the database for a signed-in member, kept while the books stay the same. A fake
// Supabase (the user check, the RPCs); made-up figures only.
//   - no token, the anon or the service key: refused; a bad period: 400; no books: 404
//   - a kept answer for the same books comes back at once, nothing worked out again
//   - otherwise: the ageing (both sides), the tie-out (the period's month-ends) and the balances on the last day are read
//     with the MEMBER's token (its own firm only); the answer is kept with the service key, with the book's version
//   - next-cloud-calc2 (migration 152): every other part of MIS.runNow through tally_mis_part (the member's token), days
//     of sales and purchases worked out from them; not partial once every part came back; a kept phase-1 answer (v 1)
//     is worked out again; a book without its ledger masters leaves sales to the browser (partial)
import { handler } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const BOOK = "bbbbbbbb-0000-4000-8000-000000000151", JWT = "member-token", SERVICE = "service-key", ANON = "anon-key";

const PART: Record<string, any> = {
  sales: { masters: true, total: 365000, rows: [{ party: "Made-up Customer", t: 365000, m: {}, n: 3 }] },
  purchases: { total: 73000, rows: [], heads: [], months: [], goods: true },
  pl: { months: [], heads: { rev: { t: 300000, m: {}, led: [] } }, pat: { t: 1000, m: {} } },
  prev: { range: ["20251001", "20260331"], cmp: { sales: 1, pl: { pat: { t: 2 } } } }, ly: { range: ["20250401", "20251031"], cmp: null },
  tops: { mtd: 10, ytd: 20 }, cash: { cash: { rec: 5, pay: 4 }, flow: { rows: [], net: 1 } },
  comp: { gst: [{ ym: "202604", pay: 9 }], tds: [], tdsRoll: { open: 0 } }, msme: { days: 45, rows: [{ party: "Made-up Supplier", amt: 7 }] }, control: { control: null },
};
function fake(opts: { kept?: any, none?: boolean, noMasters?: boolean }) {
  const calls: { fn: string, args: any, token: string }[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input), token = String((init.headers || {}).Authorization || "").replace(/^Bearer /, "");
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/auth/v1/user")) return token === JWT ? json({ id: "aaaaaaaa-0000-4000-8000-000000000151" }) : json({ message: "bad" }, 401);
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) return json({ message: "not here" }, 404);
    const args = JSON.parse(init.body || "{}");
    calls.push({ fn: m[1], args, token });
    if (m[1] === "tally_calc_cached") return json(opts.none ? { none: true } : { book: BOOK, version: "v-1", result: opts.kept || null, at: opts.kept ? "2026-11-09T10:00:00Z" : null });
    if (m[1] === "tally_ageing") return json({ asOn: "20261031", side: args.p_side, rows: [], sum: { owe: args.p_side === "r" ? 1000 : 400, advance: args.p_side === "r" ? 50 : 20 } });
    if (m[1] === "tally_tieout") return json({ book: BOOK, months: Object.fromEntries(args.p_months.map((x: string, i: number) => [x, { receivables: 1000 + i, payables: 400, cash_bank: 9, profit: 7, tb_total: 99, why: {} }])) });
    if (m[1] === "tally_balances_at") return json([{ date: "2026-10-31", ledger: "Made-up Bank", bal: "-1234.50" }, { date: "2026-10-31", ledger: "Made-up Capital", bal: "1234.50" }]);
    if (m[1] === "tally_calc_put") return json(null);
    if (m[1] === "tally_mis_part") return json({ book: BOOK, part: args.p_part, result: args.p_part === "sales" && opts.noMasters ? { masters: false } : PART[args.p_part] });
    return json({ message: "unknown rpc" }, 404);
  };
  const h = handler({ env: (k: string) => ({ SUPABASE_URL: "https://made-up.invalid", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON } as any)[k], fetch: fetchFn as any,
    now: () => new Date("2026-11-09T10:30:00Z"), excel: async () => null });
  const ask = async (body: unknown, token = JWT) => { const r = await h(new Request("https://made-up.invalid/mis-run", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Origin: "https://fincom.live" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  return { ask, calls };
}

Deno.test("now: refused without a member's token, a bad period, no books", async () => {
  const f = fake({});
  for (const t of ["", ANON, SERVICE]) eq((await f.ask({ action: "now", client: "c1", from: "20260401", to: "20261031" }, t)).status, 401, "token " + (t || "none"));
  eq((await f.ask({ action: "now", client: "c1", from: "20261031", to: "20260401" })).status, 400, "from after to");
  eq((await f.ask({ action: "now", client: "", from: "20260401", to: "20261031" })).status, 400, "no client");
  eq((await fake({ none: true }).ask({ action: "now", client: "c1", from: "20260401", to: "20261031" })).status, 404, "no books");
});

Deno.test("now: a kept answer for the same books comes back, nothing worked out again", async () => {
  const f = fake({ kept: { v: 2, kind: "mis-now", x: 1 } });
  const r = await f.ask({ action: "now", client: "c1", from: "2026-04-01", to: "2026-10-31" });
  eq(r.status, 200, "status"); eq(r.body.kept, true, "kept"); eq(r.body.result, { v: 2, kind: "mis-now", x: 1 }, "the kept answer");
  eq(f.calls.map((c) => c.fn), ["tally_calc_cached"], "only the look-up");
  eq(f.calls[0].args, { p_client: "c1", p_on: "2026-10-31", p_kind: "mis-now", p_args: "20260401|20261031" }, "asked with the period");
});

Deno.test("now: worked out with the member's token, kept with the service key", async () => {
  const f = fake({});
  const r = await f.ask({ action: "now", client: "c1", from: "20260401", to: "20261031" });
  eq(r.status, 200, "status"); eq(r.body.kept, false, "not kept before");
  const res = r.body.result;
  eq(f.calls.filter((c) => c.fn !== "tally_calc_put").every((c) => c.token === JWT), true, "every read with the member's token");
  const put = f.calls.find((c) => c.fn === "tally_calc_put")!;
  assert(put && put.token === SERVICE, "kept with the service key");
  eq([put.args.p_book, put.args.p_kind, put.args.p_args, put.args.p_version], [BOOK, "mis-now", "20260401|20261031", "v-1"], "kept under the book, kind, period and version");
  eq(f.calls.find((c) => c.fn === "tally_tieout")!.args.p_months, ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"], "the period's months");
  eq(f.calls.filter((c) => c.fn === "tally_ageing").map((c) => [c.args.p_side, c.args.p_as_on]).sort(), [["p", "2026-10-31"], ["r", "2026-10-31"]], "the ageing on the last day, both sides");
  eq(f.calls.find((c) => c.fn === "tally_balances_at")!.args, { p_book: BOOK, p_dates: ["2026-10-31"] }, "the balances on the last day");
  eq(res.owed, { r: 1006, p: 400, custAdv: 50, supAdv: 20 }, "owed from the last month-end, advances from the ageing");
  eq(res.balances.at, { "Made-up Bank": -1234.5, "Made-up Capital": 1234.5 }, "the balances");
  eq([res.partial, res.version, res.book, res.recv.sum.owe, res.pay.sum.owe], [false, "v-1", BOOK, 1000, 400], "the answer");
  eq(res.later, [], "nothing left to the browser");
  const parts = f.calls.filter((c) => c.fn === "tally_mis_part");
  eq(parts.map((c) => c.args.p_part).sort(), ["cash", "comp", "control", "ly", "msme", "pl", "prev", "purchases", "sales", "tops"], "every part asked");
  eq(parts.every((c) => c.token === JWT && c.args.p_from === "2026-04-01" && c.args.p_to === "2026-10-31" && c.args.p_today === "2026-11-09"), true, "with the member's token, the period and today (IST)");
  eq([res.sales.total, res.purchases.total, res.purchases.goods, res.goods, res.pl.pat.t, res.prev.sales, res.ly, res.prevRange, res.mtd, res.ytd, res.cash, res.p2.cash.net, res.comp.gst[0].pay, res.msme[0].amt, res.control],
     [365000, 73000, undefined, true, 1000, 1, null, ["20251001", "20260331"], 10, 20, { rec: 5, pay: 4 }, 1, 9, 7, null], "the parts in MIS.runNow's places");
  // MIS.runNow: owed / (revenue from operations / days); 214 days from 1 April to 31 October
  eq([res.dso, res.dpo], [Math.round(1000 / (300000 / 214)), Math.round(400 / (73000 / 214))], "days of sales and purchases");
});

Deno.test("now: a kept phase-1 answer is worked out again; no ledger masters leaves sales to the browser", async () => {
  const f = fake({ kept: { v: 1, kind: "mis-now", partial: true }, noMasters: true });
  const r = await f.ask({ action: "now", client: "c1", from: "20260401", to: "20261031" });
  eq([r.status, r.body.kept], [200, false], "worked out again");
  eq([r.body.result.partial, r.body.result.later, r.body.result.sales], [true, ["sales"], null], "sales not here");
});
