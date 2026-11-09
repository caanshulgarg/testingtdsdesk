// deno test -A server/mis-run/now_pg_test.ts - mis-run {action: "now"} end to end: the real handler against the real
// migration-151 functions on a throwaway PostgreSQL that tests/run_migration151.py fills with a made-up book of 40,000
// entries and 10,000 ledgers (NOW_PG = "port|uid|client|from|to|out.json"; without it the test is skipped). Each RPC the
// handler makes is run through psql as the member (fincom.uid) or as the service; the user check is faked. The answers
// go to out.json for the Python side to compare with the browser's engine.
import { handler } from "./handler.ts";

const cfg = Deno.env.get("NOW_PG");
Deno.test({ name: "now against the database: every balance, worked out once, then kept", ignore: !cfg, fn: async () => {
  const [port, uid, client, from, to, out] = String(cfg).split("|");
  const lit = (v: unknown) => v === null || v === undefined ? "null" : typeof v === "number" ? String(v)
    : typeof v === "object" ? "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb" : "'" + String(v).replace(/'/g, "''") + "'";
  const calls: string[] = [];
  const sql = async (q: string, member: boolean) => {
    const c = new Deno.Command("runuser", { args: ["-u", "postgres", "--", "/usr/lib/postgresql/16/bin/psql", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-q"],
      stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
    const w = c.stdin.getWriter(); await w.write(new TextEncoder().encode((member ? "set fincom.uid = '" + uid + "';\n" : "") + q + "\n")); await w.close();
    const r = await c.output();
    if (!r.success) throw new Error(new TextDecoder().decode(r.stderr));
    return new TextDecoder().decode(r.stdout).trim();
  };
  const fetchFn = async (input: any, init: any = {}) => {
    const url = String(input), token = String((init.headers || {}).Authorization || "").replace(/^Bearer /, "");
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/auth/v1/user")) return token === "member-token" ? json({ id: uid }) : json({ message: "bad" }, 401);
    // the member's firm from the stand's members table; the firm's switches are not in the stand (firmGate: go ahead)
    if (url.includes("/rest/v1/members?")) return new Response(await sql("select coalesce(json_agg(json_build_object('firm_id', firm_id, 'role', role, 'active', active)), '[]') from members where user_id = '" + uid + "'", false), { status: 200 });
    if (/\/rest\/v1\/(firms|clients|subscriptions)\?/.test(url)) return json([]);
    const m = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (!m) return json({ message: "not here" }, 404);
    const args = JSON.parse(init.body || "{}");
    calls.push(m[1]);
    const call = m[1] + "(" + Object.entries(args).map(([k, v]) => k + " => " + lit(v)).join(", ") + ")";
    if (m[1] === "tally_calc_put") { await sql("select " + call, false); return new Response("null", { status: 200 }); }   // returns nothing
    const t = await sql("select coalesce(to_jsonb(" + m[1] + "(" + Object.entries(args).map(([k, v]) => k + " => " + lit(v)).join(", ") + "))::text, 'null')", token === "member-token");
    return new Response(t, { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const h = handler({ env: (k: string) => ({ SUPABASE_URL: "http://made-up.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as any)[k], fetch: fetchFn as any, excel: async () => null });
  const ask = async () => { const t0 = Date.now(); const r = await h(new Request("http://made-up.invalid/mis-run", { method: "POST", headers: { Authorization: "Bearer member-token", "Content-Type": "application/json" }, body: JSON.stringify({ action: "now", client, from, to }) }));
    return { status: r.status, body: await r.json(), ms: Date.now() - t0 }; };
  const a = await ask(), b = await ask();
  if (a.status !== 200 || a.body.kept !== false) throw new Error("first: " + JSON.stringify(a.body).slice(0, 300));
  // next-cloud-calc2: a partial answer (this stand has no migration 152: its parts are left to the browser) is given back
  // and never kept, so asked again it is worked out again; a whole answer is kept and comes back as it was
  const partial = !!(a.body.result && a.body.result.partial);
  if (partial) {
    if (b.status !== 200 || b.body.kept !== false) throw new Error("second: a partial answer was kept " + JSON.stringify(b.body).slice(0, 300));
    if (calls.includes("tally_calc_put")) throw new Error("a partial answer was put in tally_calc_results");
  } else {
    if (b.status !== 200 || b.body.kept !== true) throw new Error("second: not kept " + JSON.stringify(b.body).slice(0, 300));
    // the kept answer comes back from jsonb: the same values, its keys in jsonb's order
    const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    if (JSON.stringify(canon(a.body.result)) !== JSON.stringify(canon(b.body.result))) throw new Error("the kept answer differs");
  }
  await Deno.writeTextFile(out, JSON.stringify({ first: a.body, firstMs: a.ms, secondMs: b.ms, calls }));
} });
