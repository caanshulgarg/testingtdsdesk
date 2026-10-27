// deno test server/_shared/firmgate_test.ts (tests/run_firmgate.py): the console's switches at a function's door
import { companyOffWords, firmGate, pausedWords, viaClient, viaRest } from "./firmgate.ts";

const assert = (c: unknown, w: string) => { if (!c) throw new Error(w); };
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const F = "11111111-1111-4111-8111-111111111111";

// a PostgREST stand: the tables as rows; a missing column answered as PostgREST does (400, 42703)
function rest(tables: Record<string, any[]> | null, seen: string[] = []) {
  return async (path: string, token: string) => {
    seen.push(token + " " + path);
    if (!tables) throw Object.assign(new Error("column firms.status does not exist"), { status: 400, code: "42703" });
    const u = new URL("http://x" + path), t = u.pathname.replace("/rest/v1/", "");
    return (tables[t] || []).filter((r) => [...u.searchParams].every(([k, v]) => k === "select" || k === "limit" || String(r[k]) === v.replace(/^eq\./, "")));
  };
}

Deno.test("an active firm and company: go ahead", async () => {
  const seen: string[] = [];
  const r = viaRest(rest({ firms: [{ id: F, status: "active" }], clients: [{ firm_id: F, id: "c1", status: "active" }] }, seen), "svc");
  eq(await firmGate(r, F, "c1"), null, "active");
  assert(seen.every((s) => s.startsWith("svc ")), "read with the service role");
  assert(seen.some((s) => s.includes("/rest/v1/firms?select=status,status_reason&id=eq." + F)), "the firm's row by id: " + seen);
});

Deno.test("a paused firm: refused with the app's words and the reason", async () => {
  for (const status of ["suspended", "closed"]) {
    const g = await firmGate(viaRest(rest({ firms: [{ id: F, status, status_reason: "unpaid" }] }), "svc"), F);
    eq(g && [g.status, g.reason], [403, "firm_paused"], status);
    eq(g && g.error, "Your firm's FinCom account is paused: unpaid. You can still view your work. Contact FinCom.", "words");
  }
  eq(pausedWords(null), "Your firm's FinCom account is paused. You can still view your work. Contact FinCom.", "no reason given");
});

Deno.test("a switched-off company: refused; the firm itself active", async () => {
  const r = viaRest(rest({ firms: [{ id: F, status: "active" }], clients: [{ firm_id: F, id: "c1", name: "Acme Ltd", status: "deactivated", status_reason: "closed down" }, { firm_id: F, id: "c2", status: "active" }] }), "svc");
  const g = await firmGate(r, F, "c1");
  eq(g && g.reason, "company_off", "c1 off");
  eq(g && g.error, companyOffWords("Acme Ltd", "closed down"), "words");
  eq(await firmGate(r, F, "c2"), null, "c2 on");
  eq(await firmGate(r, F), null, "no company named: the firm only");
});

Deno.test("before migration 118 (no status column) or a failed read: as before", async () => {
  eq(await firmGate(viaRest(rest(null), "svc"), F, "c1"), null, "no column");
  eq(await firmGate(async () => { throw new Error("network down"); }, F), null, "a failed read");
  const half: any = async (t: string) => { if (t === "clients") throw new Error("network down"); return { status: "suspended" }; };
  eq((await firmGate(half, F, "c1"))?.reason, "firm_paused", "the company's read failing does not hide a paused firm");
  eq(await firmGate(viaRest(rest({}), "svc"), "", null), null, "no firm");
});

Deno.test("a supabase-js client", async () => {
  const db = (rows: Record<string, any>, err?: any) => ({ from: (t: string) => { const f: Record<string, string> = {}; const q = { select: () => q, eq: (k: string, v: string) => { f[k] = v; return q; }, maybeSingle: async () => err ? { data: null, error: err } : { data: rows[t] && rows[t].id === (f.id || rows[t].id) ? rows[t] : null, error: null } }; return q; } });
  eq((await firmGate(viaClient(db({ firms: { id: F, status: "suspended", status_reason: "" } })), F))?.reason, "firm_paused", "paused");
  eq(await firmGate(viaClient(db({}, { message: "column firms.status does not exist" })), F), null, "no column");
});
