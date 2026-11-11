// deno test --allow-all server/mis-run/now_test.ts - mis-run {action: "now"} (next-cloud-calc1, migration 151): MIS's
// figures for a period worked out in the database for a signed-in member, kept while the books stay the same. A fake
// Supabase (the user check, the member, the firm's switches, the RPCs); made-up figures only.
//   - no token, the anon or the service key: refused; a bad period, more than 120 months: 400, nothing read; no books: 404
//   - the member's firm and its switches first (firmGate, as "run"): a paused firm or a switched-off company: 403, no RPC
//   - ONE call, tally_now, with the MEMBER's token (its own firm only): a kept answer comes back as it is, nothing kept
//     again; else its one JSON value carries every balance (1,500 ledgers here; a REST call of rows stops at 1,000, which
//     the fake does too) and is kept with the service key under the kind's revision and the version tally_now gave
//   - next-cloud-calc2 (migration 152): every other part of MIS.runNow through tally_mis_part (the member's token), days of
//     sales and purchases from them; a whole answer (v 3, not partial) is kept and served as kept; a kept answer of phase 1
//     alone (v 2, partial) gives its figures and only 152's parts are worked out; a partial answer (152 not run, a part
//     failing, a book without its ledger masters) is given back and NEVER kept
import { handler } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const BOOK = "bbbbbbbb-0000-4000-8000-000000000151", JWT = "member-token", SERVICE = "service-key", ANON = "anon-key", FIRM = "11111111-1111-4111-8111-111111111151";

const PART: Record<string, any> = {
  sales: { masters: true, total: 365000, rows: [{ party: "Made-up Customer", t: 365000, m: {}, n: 3 }] },
  purchases: { total: 73000, rows: [], heads: [], months: [], goods: true },
  pl: { months: [], heads: { rev: { t: 300000, m: {}, led: [] } }, pat: { t: 1000, m: {} } },
  prev: { range: ["20251001", "20260331"], cmp: { sales: 1, pl: { pat: { t: 2 } } } }, ly: { range: ["20250401", "20251031"], cmp: null },
  tops: { mtd: 10, ytd: 20 }, cash: { cash: { rec: 5, pay: 4 }, flow: { rows: [], net: 1 } },
  comp: { gst: [{ ym: "202604", pay: 9 }], tds: [], tdsRoll: { open: 0 } }, msme: { days: 45, rows: [{ party: "Made-up Supplier", amt: 7 }] }, control: { control: null },
};
function fake(opts: { kept?: any, none?: boolean, firm?: string, company?: string, no152?: boolean, noMasters?: boolean, failing?: string }) {
  const calls: { fn: string, args: any, token: string }[] = [], reads: string[] = [];
  const busy = { now: 0, most: 0 };
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input), token = String((init.headers || {}).Authorization || "").replace(/^Bearer /, "");
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/auth/v1/user")) return token === JWT ? json({ id: "aaaaaaaa-0000-4000-8000-000000000151" }) : json({ message: "bad" }, 401);
    const t = url.match(/\/rest\/v1\/(members|firms|clients|subscriptions)\?/);
    if (t) {
      reads.push(t[1]);
      if (t[1] === "members") return json([{ firm_id: FIRM, role: "staff", active: true }]);
      if (t[1] === "firms") return json([{ status: opts.firm || "active", status_reason: "" }]);
      if (t[1] === "clients") return json([{ name: "Made-up Heron Traders", status: opts.company || "active", status_reason: "" }]);
      return json([]);
    }
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) return json({ message: "not here" }, 404);
    const args = JSON.parse(init.body || "{}");
    calls.push({ fn: m[1], args, token });
    if (m[1] === "tally_now") {
      if (opts.none) return json({ none: true });
      if (opts.kept) return json({ kept: true, at: "2026-11-09T10:00:00Z", book: BOOK, version: "v-1", result: opts.kept });
      return json({ kept: false, book: BOOK, version: "v-1", from: args.p_from.replace(/-/g, ""), to: args.p_to.replace(/-/g, ""),
        recv: { sum: { owe: 1000 } }, pay: { sum: { owe: 400 } }, owed: { r: 1000, p: 400, custAdv: 50, supAdv: 20 },
        balances: { asOn: "20261031", cash: [["Made-up Cash", 9]], bank: [], at: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => ["Made-up Ledger " + i, -i])) } });
    }
    // PostgREST's row limit: a function returning rows gives at most 1,000
    if (m[1] === "tally_balances_at") return json(Array.from({ length: 1000 }, (_, i) => ({ ledger: "Made-up Ledger " + i, bal: -i })));
    if (m[1] === "tally_calc_put") return json(null);
    if (m[1] === "tally_mis_part") {
      busy.now++; busy.most = Math.max(busy.most, busy.now);
      await new Promise((r) => setTimeout(r, 2));
      busy.now--;
      if (opts.no152) return json({ code: "PGRST202", message: "Could not find the function public.tally_mis_part" }, 404);
      if (opts.failing === args.p_part) return json({ code: "57014", message: "canceling statement due to statement timeout" }, 500);
      return json({ book: BOOK, part: args.p_part, result: args.p_part === "sales" && opts.noMasters ? { masters: false, why: "the ledger masters are not in the cloud copy" } : PART[args.p_part] });
    }
    return json({ message: "unknown rpc" }, 404);
  };
  const h = handler({ env: (k: string) => ({ SUPABASE_URL: "https://made-up.invalid", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON } as any)[k], fetch: fetchFn as any,
    now: () => new Date("2026-11-09T10:30:00Z"), excel: async () => null });
  const ask = async (body: unknown, token = JWT) => { const r = await h(new Request("https://made-up.invalid/mis-run", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", Origin: "https://fincom.live" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  return { ask, calls, reads, busy };
}
const P = { action: "now", client: "c1", from: "20260401", to: "20261031" };

Deno.test("now: refused without a member's token, a bad period, no books", async () => {
  const f = fake({});
  for (const t of ["", ANON, SERVICE]) eq((await f.ask(P, t)).status, 401, "token " + (t || "none"));
  eq((await f.ask({ ...P, from: "20261031", to: "20260401" })).status, 400, "from after to");
  eq((await f.ask({ ...P, client: "" })).status, 400, "no client");
  eq(f.calls.length, 0, "nothing worked out");
  eq((await fake({ none: true }).ask(P)).status, 404, "no books");
});

Deno.test("now: a period of more than 120 months is refused before anything is read", async () => {
  const f = fake({});
  eq((await f.ask({ ...P, from: "20150401", to: "20260331" })).status, 400, "11 years");
  eq(f.calls.length, 0, "nothing read");
  eq((await f.ask({ ...P, from: "20160401", to: "20260331" })).status, 200, "120 months");
});

Deno.test("now: the firm's switches first, as run: a paused firm or a switched-off company gets nothing", async () => {
  for (const o of [{ firm: "suspended" }, { company: "deactivated" }]) {
    const f = fake(o);
    const r = await f.ask(P);
    eq([r.status, r.body.kind], [403, "paused"], JSON.stringify(o));
    eq(f.calls.length, 0, "no RPC for " + JSON.stringify(o));
    assert(f.reads.includes("firms") && f.reads.includes("clients"), "the firm and the company read");
  }
});

Deno.test("now: a whole kept answer for the same books comes back, nothing worked out or kept again", async () => {
  const f = fake({ kept: { v: 3, partial: false, kind: "mis-now.2", x: 1 } });
  const r = await f.ask({ ...P, from: "2026-04-01", to: "2026-10-31" });
  eq(r.status, 200, "status"); eq(r.body.kept, true, "kept"); eq(r.body.result, { v: 3, partial: false, kind: "mis-now.2", x: 1 }, "the kept answer");
  eq(f.calls.map((c) => c.fn), ["tally_now"], "one call, no keeping");
  eq(f.calls[0].args, { p_client: "c1", p_from: "2026-04-01", p_to: "2026-10-31" }, "asked with the period");
});

Deno.test("now: one call with the member's token, every balance (over 1,000 ledgers), kept with the service key", async () => {
  const f = fake({});
  const r = await f.ask(P);
  eq(r.status, 200, "status"); eq(r.body.kept, false, "not kept before");
  const res = r.body.result;
  eq(f.calls.map((c) => c.fn).filter((x) => x !== "tally_mis_part"), ["tally_now", "tally_calc_put"], "one working, the keeping");
  eq(f.calls[0].token, JWT, "the working with the member's token");
  const put = f.calls.find((c) => c.fn === "tally_calc_put")!;
  assert(put.token === SERVICE, "kept with the service key");
  eq([put.args.p_book, put.args.p_kind, put.args.p_args, put.args.p_version], [BOOK, "mis-now.2", "20260401|20261031", "v-1"], "kept under the book, the kind's revision, the period and tally_now's version");
  eq(Object.keys(res.balances.at).length, 1500, "all 1,500 balances, not the 1,000 a row call would give");
  eq(res.owed, { r: 1000, p: 400, custAdv: 50, supAdv: 20 }, "owed as tally_now worked it out on the day");
  eq([res.v, res.partial, res.version, res.book, res.recv.sum.owe, res.pay.sum.owe, res.kind, "kept" in res], [3, false, "v-1", BOOK, 1000, 400, "mis-now.2", false], "the answer");
  eq(res.later, [], "nothing left to the browser");
  assert(res.parts.includes("recv") && res.parts.includes("pl") && res.outside.includes("comp.gst.due"), "says what is here and what is another's");
  eq(put.args.p_result.partial, false, "a whole answer kept");
  const parts = f.calls.filter((c) => c.fn === "tally_mis_part");
  eq(parts.map((c) => c.args.p_part).sort(), ["cash", "comp", "control", "ly", "msme", "pl", "prev", "purchases", "sales", "tops"], "every part asked");
  eq(f.busy.most, 3, "at most three parts asked at a time");
  eq(parts.every((c) => c.token === JWT && c.args.p_client === "c1" && c.args.p_from === "2026-04-01" && c.args.p_to === "2026-10-31" && c.args.p_today === "2026-11-09"), true, "with the member's token, the period and today (IST)");
  eq([res.sales.total, res.purchases.total, res.purchases.goods, res.goods, res.pl.pat.t, res.prev.sales, res.ly, res.prevRange, res.mtd, res.ytd, res.cash, res.p2.cash.net, res.comp.gst[0].pay, res.msme[0].amt, res.msmeDays, res.control],
     [365000, 73000, undefined, true, 1000, 1, null, ["20251001", "20260331"], 10, 20, { rec: 5, pay: 4 }, 1, 9, 7, 45, null], "the parts in MIS.runNow's places");
  // MIS.runNow: owed / (revenue from operations / days); 214 days from 1 April to 31 October
  eq([res.dso, res.dpo], [Math.round(1000 / (300000 / 214)), Math.round(400 / (73000 / 214))], "days of sales and purchases");
});

Deno.test("now: a kept answer of phase 1 alone gives its figures; only 152's parts are worked out, then kept whole", async () => {
  const f = fake({ kept: { v: 2, partial: true, kind: "mis-now.2", from: "20260401", to: "20261031", recv: { sum: { owe: 1000 } }, pay: { sum: { owe: 400 } },
    owed: { r: 1000, p: 400, custAdv: 50, supAdv: 20 }, balances: { asOn: "20261031", cash: [], bank: [], at: { "Made-up Bank": -5 } } } });
  const r = await f.ask(P);
  eq([r.status, r.body.kept, r.body.result.v, r.body.result.partial, r.body.result.owed.r, r.body.result.balances.at, r.body.result.book, r.body.result.version, r.body.result.sales.total],
     [200, false, 3, false, 1000, { "Made-up Bank": -5 }, BOOK, "v-1", 365000], "phase 1's figures, 152's parts");
  eq(f.calls.filter((c) => c.fn === "tally_now").length, 1, "tally_now once");
  eq(f.calls.filter((c) => c.fn === "tally_calc_put").length, 1, "kept, whole");
});

Deno.test("now: a partial answer is given back and never kept (152 not run, a part failing, no ledger masters)", async () => {
  for (const [o, later] of [[{ no152: true }, ["sales", "purchases", "pl", "prev", "ly", "tops", "cash", "comp", "msme", "control"]], [{ failing: "cash" }, ["cash"]], [{ noMasters: true }, ["sales", "prev", "ly", "tops"]]] as [any, string[]][]) {
    const f = fake(o);
    const r = await f.ask(P);
    const res = r.body.result;
    eq([r.status, r.body.kept, res.partial, res.later, res.owed.r], [200, false, true, later, 1000], "given back " + JSON.stringify(o));
    eq(f.calls.filter((c) => c.fn === "tally_calc_put").length, 0, "never kept " + JSON.stringify(o));
    assert(later.every((p) => typeof res.errors[p] === "string" && res.errors[p]), "says why " + JSON.stringify(o));
    if (o.noMasters) eq([res.sales, res.dso, res.prev, res.ly, res.mtd, res.ytd, res.pl.pat.t], [null, null, null, null, null, null, 1000], "sales, their comparisons and DSO left to the browser, the rest here");
    if (o.no152) eq([res.sales, res.pl, res.dso, res.dpo], [null, null, null, null], "nothing of 152's");
  }
  // asked again with the books unchanged: still worked out, never served as kept (nothing was kept)
  const f = fake({ kept: { v: 3, partial: true, kind: "mis-now.2", x: 1 }, failing: "cash" });
  const r = await f.ask(P);
  eq([r.body.kept, r.body.result.partial], [false, true], "a partial answer kept by mistake is not served as kept");
});
