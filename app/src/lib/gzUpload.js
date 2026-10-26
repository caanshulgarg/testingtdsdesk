// Large saves sent compressed (owner, 26-Oct-2026: "saves faster on slow office connections"). A client's bank_meta (row
// keys, rules, learnt history) is ~560 KB and a bank_rows chunk of 300 lines ~60 KB, sent whole on each change as plain
// JSON. PostgREST takes no gzip body, so a save of more than 32 KB goes gzipped to the records-upload function
// (server/records-upload), which makes the very same request to PostgREST as the person (same path, Prefer and JSON
// text; their token, so row level security and the grants apply as before) and gives back PostgREST's own answer.
// Nothing about what is saved, or when, changes: Cloud.api (src/js/27-firm-account.js) asks this file for the answer and
// goes on exactly as with its own fetch (marks, 401 and a fresh token, the errors). Only these saves are compressed:
//   records upsert (cloudPush, src/js/19), clients upsert (a new client), rpc/save_book_items (BookItems, src/js/54).
// Any other call, a browser without CompressionStream (Safari before 16.4), the function missing or refusing, or any
// fault here: null, and Cloud.api sends the save as before, uncompressed. A function that is not there is not asked
// again for 10 minutes in this tab. Loaded the first time a save is that large (window.loadGzUpload, lib/gstr1Fix.js).
export const MIN = 32768;
const ROUTES = {
  "records?on_conflict=firm_id,kind,id": "resolution=merge-duplicates,return=minimal",
  "clients?on_conflict=firm_id,id": "resolution=merge-duplicates,return=minimal",
  "rpc/save_book_items": "",
};
let offUntil = 0;
// what was sent, for the tests and the console: {gz, plain, raw, sent} (saves, and their bytes before and after)
export const stats = { gz: 0, plain: 0, raw: 0, sent: 0 };

export async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(s).arrayBuffer();
}

// path, opts: Cloud.api's own; body: its JSON text; headers: the request's (apikey, Authorization); url: the project's.
// Returns a Response standing for PostgREST's answer, or null (send it plain)
export async function send(path, opts, body, headers, url) {
  const prefer = String((opts.headers && opts.headers.Prefer) || "");
  if ((opts.method || "GET") !== "POST" || !Object.prototype.hasOwnProperty.call(ROUTES, path) || ROUTES[path] !== prefer) return null;
  if (typeof body !== "string" || body.length <= MIN || typeof CompressionStream !== "function" || Date.now() < offUntil) { stats.plain++; return null; }
  let r, j = null;
  try {
    const gz = await gzip(body);
    const q = "path=" + encodeURIComponent(path) + "&prefer=" + encodeURIComponent(prefer);
    r = await fetch(url.replace(/\/+$/, "") + "/functions/v1/records-upload?" + q, {
      method: "POST", headers: { apikey: headers.apikey, Authorization: headers.Authorization, "Content-Type": "application/gzip" }, body: gz });
    if (r.ok) j = await r.json().catch(() => null);
    if (!j || j.fincomUpload !== 1 || typeof j.status !== "number") {
      // not the function's answer (not deployed, refused, down): plain from now on in this tab for a while; an expired
      // token is left to the plain call, which takes a fresh one
      if (r.status !== 401) offUntil = Date.now() + 600000;
      stats.plain++;
      return null;
    }
    stats.gz++; stats.raw += body.length; stats.sent += gz.byteLength;
  } catch (e) {
    // no answer at all (a function not deployed may answer without CORS headers): not asked again for a while, unless
    // the computer is simply offline (the plain call then fails as before)
    if (!(typeof navigator === "object" && navigator.onLine === false)) offUntil = Date.now() + 600000;
    stats.plain++;
    return null;
  }
  const empty = j.body === "" || j.body == null || j.status === 204 || j.status === 205 || j.status === 304;
  return new Response(empty ? null : String(j.body), { status: j.status, headers: j.range ? { "content-range": j.range } : {} });
}
// the tests start again with the function asked
export function reset() { offUntil = 0; stats.gz = stats.plain = stats.raw = stats.sent = 0; }
