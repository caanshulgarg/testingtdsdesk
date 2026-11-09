// deno test --allow-all server/mis-run/now_test.ts - mis-run {action: "now"} (next-cloud-calc1, migration 151): MIS's
// figures for a period worked out in the database for a signed-in member, kept while the books stay the same. A fake
// Supabase (the user check, the RPCs); made-up figures only.
//   - no token, the anon or the service key: refused; a bad period: 400; no books: 404
//   - a kept answer for the same books comes back at once, nothing worked out again
//   - otherwise: ONE call, tally_now, with the MEMBER's token (its own firm only), whose one JSON value carries every
//     balance (1,500 ledgers here; a REST call of rows stops at 1,000, which the fake does too); the answer is kept with the
//     service key under the kind's own revision and the version read before the figures (tally_calc_cached)
//   - a period of more than 120 months: 400, nothing read
//   - next-cloud-calc2 (migration 152): every other part of MIS.runNow through tally_mis_part (the member's token, beside
//     tally_now), days of sales and purchases worked out from them; not partial once every part came back; without 152
//     (or a part failing, or a book without its ledger masters for sales) the part is left to the browser: partial
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
function fake(opts: { kept?: any, none?: boolean, no152?: boolean, noMasters?: boolean }) {
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
    if (m[1] === "tally_now") return json({ book: BOOK, from: args.p_from.replace(/-/g, ""), to: args.p_to.replace(/-/g, ""),
      recv: { sum: { owe: 1000 } }, pay: { sum: { owe: 400 } }, owed: { r: 1000, p: 400, custAdv: 50, supAdv: 20 },
      balances: { asOn: "20261031", cash: [["Made-up Cash", 9]], bank: [], at: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => ["Made-up Ledger " + i, -i])) },
    });
    // PostgREST's row limit: a function returning rows gives at most 1,000
    if (m[1] === "tally_balances_at") return json(Array.from({ length: 1000 }, (_, i) => ({ ledger: "Made-up Ledger " + i, bal: -i })));
    if (m[1] === "tally_calc_put") return json(null);
    if (m[1] === "tally_mis_part") return opts.no152 ? json({ code: "PGRST202", message: "Could not find the function public.tally_mis_part" }, 404)
      : json({ book: BOOK, part: args.p_part, result: args.p_part === "sales" && opts.noMasters ? { masters: false, why: "the ledger masters are not in the cloud copy" } : PART[args.p_part] });
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

Deno.test("now: a period of more than 120 months is refused before anything is read", async () => {
  const f = fake({});
  eq((await f.ask({ action: "now", client: "c1", from: "20150401", to: "20260331" })).status, 400, "11 years");
  eq(f.calls.length, 0, "nothing read");
  eq((await f.ask({ action: "now", client: "c1", from: "20160401", to: "20260331" })).status, 200, "120 months");
});

Deno.test("now: a kept answer for the same books comes back, nothing worked out again", async () => {
  const f = fake({ kept: { kind: "mis-now", x: 1 } });
  const r = await f.ask({ action: "now", client: "c1", from: "2026-04-01", to: "2026-10-31" });
  eq(r.status, 200, "status"); eq(r.body.kept, true, "kept"); eq(r.body.result, { kind: "mis-now", x: 1 }, "the kept answer");
  eq(f.calls.map((c) => c.fn), ["tally_calc_cached"], "only the look-up");
  eq(f.calls[0].args, { p_client: "c1", p_on: "2026-10-31", p_kind: "mis-now.3", p_args: "20260401|20261031" }, "asked with the period, under the kind's new revision");
});

Deno.test("now: one call with the member's token, every balance (over 1,000 ledgers), kept with the service key", async () => {
  const f = fake({});
  const r = await f.ask({ action: "now", client: "c1", from: "20260401", to: "20261031" });
  eq(r.status, 200, "status"); eq(r.body.kept, false, "not kept before");
  const res = r.body.result;
  eq(f.calls.map((c) => c.fn).filter((x) => x !== "tally_mis_part"), ["tally_calc_cached", "tally_now", "tally_calc_put"], "the look-up, one working, the keeping");
  eq(f.calls.filter((c) => c.fn !== "tally_calc_put").every((c) => c.token === JWT), true, "every read with the member's token");
  eq(f.calls.find((c) => c.fn === "tally_now")!.args, { p_client: "c1", p_from: "2026-04-01", p_to: "2026-10-31" }, "the period");
  const put = f.calls.find((c) => c.fn === "tally_calc_put")!;
  assert(put.token === SERVICE, "kept with the service key");
  eq([put.args.p_book, put.args.p_kind, put.args.p_args, put.args.p_version], [BOOK, "mis-now.3", "20260401|20261031", "v-1"], "kept under the book, the kind's revision, the period and the version read before the figures");
  eq(Object.keys(res.balances.at).length, 1500, "all 1,500 balances, not the 1,000 a row call would give");
  eq(res.owed, { r: 1000, p: 400, custAdv: 50, supAdv: 20 }, "owed as tally_now worked it out on the day");
  eq([res.partial, res.version, res.book, res.recv.sum.owe, res.pay.sum.owe, res.kind], [false, "v-1", BOOK, 1000, 400, "mis-now.3"], "the answer");
  eq(res.later, [], "nothing left to the browser");
  assert(res.parts.includes("recv") && res.parts.includes("pl") && res.outside.includes("comp.gst.due"), "says what is here and what is another's");
  const parts = f.calls.filter((c) => c.fn === "tally_mis_part");
  eq(parts.map((c) => c.args.p_part).sort(), ["cash", "comp", "control", "ly", "msme", "pl", "prev", "purchases", "sales", "tops"], "every part asked");
  eq(parts.every((c) => c.token === JWT && c.args.p_client === "c1" && c.args.p_from === "2026-04-01" && c.args.p_to === "2026-10-31" && c.args.p_today === "2026-11-09"), true, "with the member's token, the period and today (IST)");
  eq([res.sales.total, res.purchases.total, res.purchases.goods, res.goods, res.pl.pat.t, res.prev.sales, res.ly, res.prevRange, res.mtd, res.ytd, res.cash, res.p2.cash.net, res.comp.gst[0].pay, res.msme[0].amt, res.msmeDays, res.control],
     [365000, 73000, undefined, true, 1000, 1, null, ["20251001", "20260331"], 10, 20, { rec: 5, pay: 4 }, 1, 9, 7, 45, null], "the parts in MIS.runNow's places");
  // MIS.runNow: owed / (revenue from operations / days); 214 days from 1 April to 31 October
  eq([res.dso, res.dpo], [Math.round(1000 / (300000 / 214)), Math.round(400 / (73000 / 214))], "days of sales and purchases");
});

Deno.test("now: without migration 152 the parts are left to the browser; no ledger masters leaves sales to it", async () => {
  const a = await fake({ no152: true }).ask({ action: "now", client: "c1", from: "20260401", to: "20261031" });
  eq([a.status, a.body.result.partial, a.body.result.later.length, a.body.result.owed.r, a.body.result.sales, a.body.result.dso], [200, true, 10, 1000, null, null], "151's parts still answered");
  assert(/tally_mis_part/.test(a.body.result.errors.pl), "says why");
  const b = await fake({ noMasters: true }).ask({ action: "now", client: "c1", from: "20260401", to: "20261031" });
  eq([b.body.result.partial, b.body.result.later, b.body.result.sales, b.body.result.dso, b.body.result.pl.pat.t], [true, ["sales"], null, null, 1000], "sales not here, the rest is");
});
