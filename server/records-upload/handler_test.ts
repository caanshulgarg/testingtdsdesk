// deno test server/records-upload/handler_test.ts   (no network, no Supabase: PostgREST is a fake with row level security)
import { MAX_GZ, MAX_JSON, makeHandler, ROUTES } from "./handler.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }

const ANON = "anon-key", SERVICE = "service-role-key";
// the people, by token: each belongs to one firm (as my_firm() and the records policies decide)
const TOKENS: Record<string, { uid: string; firm: string; role: string }> = {
  "tok-asha": { uid: "u-asha", firm: "firm-a", role: "staff" },
  "tok-viewer": { uid: "u-view", firm: "firm-a", role: "viewer" },
  "tok-other": { uid: "u-other", firm: "firm-b", role: "owner" },
};

// PostgREST with the records policies: a row is written only for the caller's own firm, never by a viewer; an upsert
// with merge-duplicates replaces the row with the same (firm_id, kind, id); save_book_items saves for the caller's firm
function fakeRest() {
  const t = { records: new Map<string, any>(), items: new Map<string, any>(), calls: [] as { url: string; headers: Record<string, string>; body: string }[] };
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input), headers = Object.fromEntries(new Headers(init?.headers).entries()), body = String(init?.body ?? "");
    t.calls.push({ url, headers, body });
    if (headers.apikey !== ANON) return new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 });
    const who = TOKENS[(headers.authorization || "").replace(/^Bearer /, "")];
    if (!who) return new Response(JSON.stringify({ code: "PGRST301", message: "JWT invalid" }), { status: 401 });
    const path = url.replace(/^https:\/\/x\.test\/rest\/v1\//, "");
    if (path === "records?on_conflict=firm_id,kind,id") {
      const rows = JSON.parse(body);
      if (headers.prefer !== "resolution=merge-duplicates,return=minimal") return new Response("{}", { status: 400 });
      if (who.role === "viewer" || rows.some((r: any) => r.firm_id !== who.firm)) {
        return new Response(JSON.stringify({ code: "42501", message: 'new row violates row-level security policy for table "records"' }), { status: 403 });
      }
      rows.forEach((r: any) => t.records.set(r.firm_id + "|" + r.kind + "|" + r.id, { ...r, updated_by: who.uid }));
      return new Response("", { status: 201 });
    }
    if (path === "rpc/save_book_items") {
      const a = JSON.parse(body);
      if (who.role === "viewer") return new Response(JSON.stringify({ code: "42501", message: "not allowed" }), { status: 403 });
      const out = a.p_items.map((x: any, i: number) => { t.items.set(who.firm + "|" + a.p_client + "|" + x.k + "|" + x.i, x.d); return { k: x.k, i: x.i, seq: i + 1 }; });
      return new Response(JSON.stringify({ ok: true, items: out }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
  return { t, f };
}

function setup() {
  const rest = fakeRest();
  const handler = makeHandler({ restUrl: "https://x.test/rest/v1", anonKey: ANON, fetch: rest.f as typeof fetch, cors: () => ({ "Access-Control-Allow-Origin": "https://staging.fincom.live" }) });
  return { rest, handler };
}
type Bytes = Uint8Array<ArrayBuffer>;
async function gzip(s: string | Bytes): Promise<Bytes> {
  const b = typeof s === "string" ? new TextEncoder().encode(s) : s;
  return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>)).arrayBuffer());
}
function call(handler: (r: Request) => Promise<Response>, path: string, body: BodyInit | Bytes, o: { token?: string; ct?: string; ce?: string; prefer?: string; method?: string } = {}) {
  const q = new URLSearchParams({ path, prefer: o.prefer ?? ROUTES[path] ?? "" });
  const headers: Record<string, string> = { "content-type": o.ct ?? "application/gzip" };
  if (o.token !== "") headers.authorization = "Bearer " + (o.token ?? "tok-asha");
  if (o.ce) headers["content-encoding"] = o.ce;
  return handler(new Request("https://fn.test/records-upload?" + q, { method: o.method ?? "POST", headers, body: o.method === "GET" ? undefined : body as BodyInit }));
}

// a client's bank: its rules, keys and learnt history (bank_meta), and its lines in chunks of 300 (bank_rows)
function bankRecords(firm: string) {
  const keys: Record<string, unknown> = {}, hist: unknown[] = [];
  for (let i = 0; i < 2500; i++) keys["k" + i] = { led: "Ledger " + (i % 90), dir: i % 2 ? "Dr" : "Cr", n: i };
  for (let i = 0; i < 1500; i++) hist.push({ key: "UPI/" + (100000 + i) + "/PAYMENT", led: "Party " + (i % 70), at: "2026-10-" + String(1 + (i % 26)).padStart(2, "0"), h: "hand" });
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: "r" + i, d: "2026-09-" + String(1 + (i % 30)).padStart(2, "0"), n: "NEFT-" + i + " ACME TRADERS PVT LTD", amt: (i * 137.5) % 99999, state: "ready" }));
  return [
    { firm_id: firm, kind: "bank_meta", id: "zzc1", client_id: "zzc1", data: { rules: [{ when: "ACME", led: "Acme Traders" }], newLed: [], keys, hist }, deleted: false },
    { firm_id: firm, kind: "bank_rows", id: "zzc1:st1:0", client_id: "zzc1", data: { rows }, deleted: false },
  ];
}

Deno.test("gzip in: the same rows written as the plain call, the same JSON text passed on, as the person", async () => {
  const { rest, handler } = setup();
  const rows = bankRecords("firm-a"), text = JSON.stringify(rows);
  const gz = await gzip(text);
  assert(gz.length * 4 < text.length, "compressed well: " + gz.length + " of " + text.length);
  const r = await call(handler, "records?on_conflict=firm_id,kind,id", gz);
  eq(r.status, 200);
  const j = await r.json();
  eq([j.fincomUpload, j.status, j.body], [1, 201, ""], "PostgREST's own answer");
  eq(rest.t.calls.length, 1);
  const c = rest.t.calls[0];
  eq(c.body, text, "the JSON text, byte for byte");
  eq([c.headers.apikey, c.headers.authorization, c.headers.prefer, c.headers["content-type"]], [ANON, "Bearer tok-asha", "resolution=merge-duplicates,return=minimal", "application/json"]);
  assert(!JSON.stringify(c.headers).includes(SERVICE), "never the service role");
  eq(rest.t.records.get("firm-a|bank_meta|zzc1").data, rows[0].data);
  eq(rest.t.records.get("firm-a|bank_rows|zzc1:st1:0").data, rows[1].data);
});

Deno.test("Content-Encoding: gzip is taken too; save_book_items' answer comes back as it is", async () => {
  const { rest, handler } = setup();
  const items = { p_client: "zzc1", p_items: Array.from({ length: 50 }, (_, i) => ({ k: "tds", i: "#" + i, d: { a: i, note: "x".repeat(500) } })) };
  const r = await call(handler, "rpc/save_book_items", await gzip(JSON.stringify(items)), { ct: "application/octet-stream", ce: "gzip" });
  const j = await r.json();
  eq([r.status, j.fincomUpload, j.status], [200, 1, 200]);
  eq(JSON.parse(j.body).items.length, 50);
  eq(rest.t.items.size, 50);
  assert(!("prefer" in rest.t.calls[0].headers), "no Prefer on the rpc, as the app sends it");
});

Deno.test("row level security: another firm's rows and a viewer's save are refused by PostgREST, and that answer is passed back", async () => {
  const { rest, handler } = setup();
  const other = await call(handler, "records?on_conflict=firm_id,kind,id", await gzip(JSON.stringify(bankRecords("firm-b"))), { token: "tok-asha" });
  const j = await other.json();
  eq([other.status, j.fincomUpload, j.status], [200, 1, 403]);
  assert(/row-level security/.test(JSON.parse(j.body).message));
  const viewer = await (await call(handler, "records?on_conflict=firm_id,kind,id", await gzip(JSON.stringify(bankRecords("firm-a"))), { token: "tok-viewer" })).json();
  eq(viewer.status, 403);
  const stranger = await (await call(handler, "records?on_conflict=firm_id,kind,id", await gzip(JSON.stringify(bankRecords("firm-a"))), { token: "tok-nobody" })).json();
  eq(stranger.status, 401, "a token PostgREST does not know");
  eq(rest.t.records.size, 0, "nothing written");
  // the other firm's owner writes their own
  const own = await (await call(handler, "records?on_conflict=firm_id,kind,id", await gzip(JSON.stringify(bankRecords("firm-b"))), { token: "tok-other" })).json();
  eq(own.status, 201);
  eq(rest.t.records.size, 2);
});

Deno.test("refused before PostgREST: no token, another path or Prefer, not gzip, bad gzip, not JSON, too large", async () => {
  const { rest, handler } = setup();
  const body = await gzip(JSON.stringify([{ firm_id: "firm-a", kind: "entry", id: "e1", client_id: "c", data: {}, deleted: false }]));
  const P = "records?on_conflict=firm_id,kind,id";
  eq((await call(handler, P, body, { token: "" })).status, 401, "no token");
  eq((await call(handler, "members?on_conflict=user_id", body, { prefer: "resolution=merge-duplicates,return=minimal" })).status, 400, "another table");
  eq((await call(handler, "records?on_conflict=firm_id,kind,id&select=*", body)).status, 400, "anything added to the path");
  eq((await call(handler, P, body, { prefer: "resolution=merge-duplicates,return=representation" })).status, 400, "another Prefer");
  eq((await call(handler, P, body, { method: "GET" })).status, 405);
  eq((await call(handler, P, '[{"a":1}]', { ct: "application/json" })).status, 415, "a plain body");
  eq((await call(handler, P, new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4, 5, 6, 7]))).status, 400, "broken gzip");
  eq((await call(handler, P, new TextEncoder().encode("not gzip at all"))).status, 400, "not gzip");
  eq((await call(handler, P, await gzip("{not json"))).status, 400, "not JSON");
  // a gzip bomb: 21 MB of spaces is a few KB compressed; refused once more than 20 MB has come out
  const bomb = await gzip(new Uint8Array(MAX_JSON + 1024 * 1024).fill(32));
  assert(bomb.length < 100_000, "small compressed: " + bomb.length);
  const r = await call(handler, P, bomb);
  eq(r.status, 413, "more than 20 MB decompressed");
  eq((await call(handler, P, new Uint8Array(MAX_GZ + 1))).status, 413, "more than 8 MB compressed");
  eq(rest.t.calls.length, 0, "none of these reached PostgREST");
});

Deno.test("PostgREST unreachable: no fincomUpload in the answer (the app sends it plain)", async () => {
  const handler = makeHandler({ restUrl: "https://x.test/rest/v1", anonKey: ANON, fetch: (() => Promise.reject(new Error("down"))) as typeof fetch, cors: () => ({}) });
  const r = await call(handler, "records?on_conflict=firm_id,kind,id", await gzip("[]"));
  eq(r.status, 502);
  assert(!("fincomUpload" in await r.json()));
});

Deno.test("OPTIONS answers with the CORS headers", async () => {
  const { handler } = setup();
  const r = await handler(new Request("https://fn.test/records-upload", { method: "OPTIONS" }));
  eq([r.status, r.headers.get("access-control-allow-origin")], [200, "https://staging.fincom.live"]);
});
