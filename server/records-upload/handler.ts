// records-upload (owner, 26-Oct-2026): a large save from the browser, sent compressed. PostgREST takes no gzip body, so
// the app (app/src/lib/gzUpload.js) sends a save above 32 KB here gzipped, and this function makes exactly the request
// the app would have made to PostgREST itself: the same path, the same Prefer, the same JSON text (decompressed, never
// re-written), with the person's own token and the public (anon) key. Row level security, the grants and
// save_book_items' own checks apply as they do for the plain call; the service role is never used here.
// Only the app's own saves are passed on (ROUTES); anything else is refused. Plain module with no imports, so the Deno
// tests (handler_test.ts) run it with a fake PostgREST; index.ts wires the real one.
//
// The answer, when PostgREST answered: 200 {fincomUpload: 1, status, body, range} (PostgREST's status, body text and
// Content-Range), so the app treats it as PostgREST's own answer. Any other answer (this function missing, refused, a
// fault here) has no fincomUpload, and the app sends the same save as before, uncompressed.

// path -> the Prefer header the app sends with it (src/js/27-firm-account.js cloudPush, src/js/19 and src/js/54)
export const ROUTES: Record<string, string> = {
  "records?on_conflict=firm_id,kind,id": "resolution=merge-duplicates,return=minimal",
  "clients?on_conflict=firm_id,id": "resolution=merge-duplicates,return=minimal",
  "rpc/save_book_items": "",
};
export const MAX_GZ = 8 * 1024 * 1024;        // compressed bytes taken
export const MAX_JSON = 20 * 1024 * 1024;     // decompressed bytes taken

export type Deps = {
  restUrl: string;                            // https://<project>.supabase.co/rest/v1
  anonKey: string;                            // the public key, as the app sends it
  fetch: typeof fetch;
  cors: (req: Request) => Record<string, string>;
};

const json = (status: number, o: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(o), { status, headers: { ...h, "Content-Type": "application/json" } });

// the bytes of a gzip body, at most `max` once decompressed (null: more than that); throws on a body that is not gzip
export async function gunzipLimited(gz: ArrayBuffer, max: number): Promise<Uint8Array | null> {
  const r = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip") as TransformStream<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > max) { await r.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// the compressed body, at most `max` bytes (null: more than that)
async function readLimited(req: Request, max: number): Promise<ArrayBuffer | null> {
  const len = Number(req.headers.get("content-length") || "0");
  if (len > max) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > max ? null : buf;
}

export function makeHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    const h = d.cors(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: h });
    if (req.method !== "POST") return json(405, { error: "POST only" }, h);
    const auth = req.headers.get("authorization") || "";
    if (!/^Bearer \S+$/.test(auth)) return json(401, { error: "Sign in first." }, h);
    const u = new URL(req.url), path = u.searchParams.get("path") || "", prefer = u.searchParams.get("prefer") || "";
    if (!(path in ROUTES) || ROUTES[path] !== prefer) return json(400, { error: "Not a save this function passes on." }, h);
    const ct = (req.headers.get("content-type") || "").toLowerCase(), ce = (req.headers.get("content-encoding") || "").toLowerCase();
    if (!/^application\/(x-)?gzip\b/.test(ct) && ce !== "gzip") return json(415, { error: "A gzip body is expected." }, h);
    const gz = await readLimited(req, MAX_GZ);
    if (!gz) return json(413, { error: "Too large." }, h);
    let raw: Uint8Array | null;
    try { raw = await gunzipLimited(gz, MAX_JSON); }
    catch (_e) { return json(400, { error: "The body is not gzip." }, h); }
    if (!raw) return json(413, { error: "Too large once decompressed." }, h);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); JSON.parse(text); }
    catch (_e) { return json(400, { error: "The body is not JSON." }, h); }
    const headers: Record<string, string> = { apikey: d.anonKey, Authorization: auth, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    let r: Response;
    try { r = await d.fetch(d.restUrl.replace(/\/+$/, "") + "/" + path, { method: "POST", headers, body: text }); }
    catch (_e) { return json(502, { error: "The database could not be reached." }, h); }
    const body = await r.text();
    return json(200, { fincomUpload: 1, status: r.status, body, range: r.headers.get("content-range") || "" }, h);
  };
}
