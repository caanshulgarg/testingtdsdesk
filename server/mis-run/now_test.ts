// deno test --allow-all server/mis-run/now_test.ts - mis-run {action: "now"} (next-cloud-calc1, migration 151): MIS's
// figures for a period worked out in the database for a signed-in member, kept while the books stay the same. A fake
// Supabase (the user check, the RPCs); made-up figures only.
//   - no token, the anon or the service key: refused; a bad period: 400; no books: 404
//   - a kept answer for the same books comes back at once, nothing worked out again
//   - otherwise: the ageing (both sides), the tie-out (the period's month-ends) and the balances on the last day are read
//     with the MEMBER's token (its own firm only); the answer is kept with the service key, with the book's version
import { handler } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const BOOK = "bbbbbbbb-0000-4000-8000-000000000151", JWT = "member-token", SERVICE = "service-key", ANON = "anon-key";

function fake(opts: { kept?: any, none?: boolean }) {
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
  const f = fake({ kept: { kind: "mis-now", x: 1 } });
  const r = await f.ask({ action: "now", client: "c1", from: "2026-04-01", to: "2026-10-31" });
  eq(r.status, 200, "status"); eq(r.body.kept, true, "kept"); eq(r.body.result, { kind: "mis-now", x: 1 }, "the kept answer");
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
  eq([res.partial, res.version, res.book, res.recv.sum.owe, res.pay.sum.owe], [true, "v-1", BOOK, 1000, 400], "the answer");
  assert(res.later.includes("pl") && res.parts.includes("recv"), "says what is not worked out here yet");
});
