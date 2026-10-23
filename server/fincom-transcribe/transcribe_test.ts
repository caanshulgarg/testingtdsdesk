// deno test server/fincom-transcribe/transcribe_test.ts (run by tests/run_transcribe_server.py). The fincom-transcribe
// function with Supabase and Groq both STUBBED (one fake fetch): who may call it, the size and length limits, the words
// prompt (the firm's words and the client's own ledger and party names, read for the caller's firm only), that the audio
// and the words are never kept (only one usage row: seconds, language, ok or why not), Groq's 429 as "limit", no key as
// "nokey", and the minutes-used-today answer. Then the clearer words (22-Oct-2026): the full model for a short clip and
// turbo for a long one or at the full model's limit, the Hinglish sample-sentence prompt in English letters, Devanagari
// written in English letters, the names corrected with their changes, the AI step under the cap and checked, and the
// usage row with counts only.
import { buildPrompt, handler } from "./index.ts";
import { HAIKU } from "../assistant/models.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const SUPA = "https://stand.test", FIRM = "11111111-1111-4111-8111-111111111111", OTHER_FIRM = "22222222-2222-4222-8222-222222222222";
const ME = "aaaaaaaa-0000-4000-8000-000000000001", STRANGER = "aaaaaaaa-0000-4000-8000-000000000004";
const BOOK = "00000000-0000-4000-8000-0000000000b1";
type Call = { url: string, method: string, auth: string, body: Uint8Array | string | null, form?: Record<string, string>, file?: { name: string, type: string, size: number } };

// the stand: users by token, the firm's members, its client and book, the ledgers, the key, the log
function stand(o: { key?: string | null, groq?: (form: Record<string, string>) => Response, superadmin?: boolean, aal2?: boolean, assistantOff?: boolean,
  claudeKey?: string, claude?: (body: any) => Response, capOk?: boolean } = {}) {
  const calls: Call[] = [], logRows: any[] = [], rpcs: [string, any][] = [];
  const ledgers = [
    { name: "Richa Khandelwal", primary_group: "Sundry Debtors", open: 250000, firm_id: FIRM },
    { name: "AIR ESS EXIM PRIVATE LIMITED", primary_group: "Sundry Creditors", open: -900000, firm_id: FIRM },
    { name: "Cash", primary_group: "Cash-in-Hand", open: 1200, firm_id: FIRM },
    { name: "HDFC Bank A/c", primary_group: "Bank Accounts", open: 150000, firm_id: FIRM },
    { name: "Mohan Lal", primary_group: "Sundry Creditors", open: 900, firm_id: FIRM },
    { name: "Mohan Lall", primary_group: "Sundry Creditors", open: 800, firm_id: FIRM },
    { name: "Larkspur Sales @ 18%", primary_group: "Sales Accounts", open: 0, firm_id: FIRM },
  ];
  // many small ledgers, so the prompt must be cut to its budget
  for (let i = 0; i < 400; i++) ledgers.push({ name: "Party Number " + i + " Traders", primary_group: "Sundry Debtors", open: i, firm_id: FIRM });
  const fake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), method = String(init.method || "GET"), h = new Headers(init.headers || {});
    const auth = (h.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let body: Call["body"] = null, form: Record<string, string> | undefined, file: Call["file"];
    if (init.body instanceof FormData) {
      form = {};
      for (const [k, v] of init.body.entries()) {
        if (typeof v === "string") form[k] = v; else { file = { name: (v as File).name, type: v.type, size: v.size }; body = new Uint8Array(await v.arrayBuffer()); }
      }
    } else if (typeof init.body === "string") body = init.body;
    calls.push({ url, method, auth, body, form, file });
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://api.anthropic.com/")) {
      assert(h.get("x-api-key") === o.claudeKey, "the AI step with the platform's Claude key");
      const b = JSON.parse(String(body));
      return o.claude ? o.claude(b) : json({ content: [{ type: "text", text: "unchanged" }], usage: { input_tokens: 300, output_tokens: 40 } });
    }
    if (url.startsWith("https://api.groq.com/")) {
      assert(auth === o.key, "Groq is called with the platform's key");
      return o.groq ? o.groq(form || {}) : json({ text: " Richa Khandelwal ko 2 lakh rupees ka voucher. " });
    }
    const u = new URL(url), p = u.pathname, q = u.searchParams;
    const uid = auth === "tok-me" ? ME : auth === "tok-stranger" ? STRANGER : null;
    if (p === "/auth/v1/user") return uid ? json({ id: uid }) : json({ msg: "bad jwt" }, 401);
    if (p === "/rest/v1/rpc/mfa_ok") return json(o.aal2 !== false);
    if (p === "/rest/v1/rpc/is_superadmin") return json(!!o.superadmin);
    if (p === "/rest/v1/rpc/asst_cap_take") { assert(auth === "service-key", "the cap taken with the service role"); rpcs.push(["asst_cap_take", JSON.parse(String(body))]); return json({ ok: o.capOk !== false, why: o.capOk === false ? "inr" : "" }); }
    if (p === "/rest/v1/rpc/asst_cost_add") { rpcs.push(["asst_cost_add", JSON.parse(String(body))]); return json({ inr: 0.03 }); }
    if (p === "/rest/v1/members") return json(q.get("user_id") === "eq." + ME ? [{ firm_id: FIRM, role: "owner", active: true }] : []);
    if (p === "/rest/v1/assistant_settings") return json(o.assistantOff ? [{ enabled: false }] : []);
    if (p === "/rest/v1/clients") {
      // read as the user (row-level security): only the firm's own client is seen
      assert(auth === "tok-me", "the client is read with the user's own token");
      if (!q.get("id")) { assert(q.get("deleted") === "not.is.true", "the firm's clients, none deleted"); return json([{ name: "Larkspur Traders" }, { name: "Leads Insurance Private Limited" }]); }
      return json(q.get("id") === "eq.larkspur" ? [{ id: "larkspur", name: "Larkspur Traders", deleted: false }] : []);
    }
    if (p === "/rest/v1/tally_books") {
      assert(auth === "service-key", "books read with the service role");
      assert(q.get("firm_id") === "eq." + FIRM, "the client's books of the caller's firm only (" + q.get("firm_id") + ")");
      return json(q.get("client_id") === "eq.larkspur" ? [{ book_id: BOOK }] : []);
    }
    if (p === "/rest/v1/tally_ledgers") {
      assert(q.get("firm_id") === "eq." + FIRM && q.get("book_id") === "in.(" + BOOK + ")", "ledgers of the client's book in the caller's firm only");
      assert(q.get("deleted_at") === "is.null" && q.get("merged_into") === "is.null", "no deleted or merged ledger");
      return json(ledgers.filter((l) => l.firm_id === FIRM));
    }
    if (p === "/rest/v1/platform_secrets") {
      assert(auth === "service-key", "the keys are read with the service role");
      if (q.get("name") === "eq.claude_api_key") return json(o.claudeKey ? [{ value: o.claudeKey }] : []);
      assert(q.get("name") === "eq.groq_api_key", "the key is the platform's groq_api_key");
      return json(o.key ? [{ value: o.key }] : []);
    }
    if (p === "/rest/v1/assistant_log" && method === "POST") { logRows.push(JSON.parse(String(body))); return new Response(null, { status: 201 }); }
    if (p === "/rest/v1/assistant_log" && method === "GET") {
      assert(q.get("feature") === "eq.voice", "usage: the voice rows only");
      const rows = [{ firm_id: FIRM, ms: 90_000 }, { firm_id: FIRM, ms: 30_000 }, { firm_id: OTHER_FIRM, ms: 60_000 }];
      return json(q.get("firm_id") ? rows.filter((r) => "eq." + r.firm_id === q.get("firm_id")) : rows);
    }
    return json({ message: "not in the stand: " + method + " " + p }, 404);
  }) as typeof fetch;
  const h = handler({ env: (k) => ({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: fake });
  return { h, calls, logRows, rpcs };
}

const AUDIO = new Uint8Array(48_000).map((_, i) => (i * 31 + 7) & 255);     // a made-up clip; its bytes are looked for later
function send(h: (r: Request) => Promise<Response>, o: { tok?: string | null, bytes?: Uint8Array, type?: string, lang?: string, client?: string, secs?: number, len?: string, latin?: boolean, verbose?: boolean } = {}) {
  const qs = new URLSearchParams({ lang: o.lang ?? "hi", secs: String(o.secs ?? 12), ...(o.client === undefined ? { client: "larkspur" } : o.client ? { client: o.client } : {}), ...(o.latin ? { latin: "1" } : {}), ...(o.verbose ? { verbose: "1" } : {}) });
  const headers: Record<string, string> = { "Content-Type": o.type ?? "audio/webm;codecs=opus", Origin: "https://staging.fincom.live" };
  if (o.tok !== null) headers.Authorization = "Bearer " + (o.tok ?? "tok-me");
  if (o.len) headers["Content-Length"] = o.len;
  return h(new Request("http://x/?" + qs, { method: "POST", headers, body: (o.bytes ?? AUDIO).slice().buffer as ArrayBuffer }));   // a copy as an ArrayBuffer: a BodyInit on every Deno
}
const has = (hay: Uint8Array | string | null, needle: Uint8Array) => {
  if (!hay || typeof hay === "string") return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) { for (let j = 0; j < 64; j++) if (hay[i + j] !== needle[j]) continue outer; return true; }
  return false;
};

Deno.test("who may call: no token, the anon key, a bad token, a non-member and a client of another firm are refused; Groq never called", async () => {
  const s = stand({ key: "gsk_test" });
  eq((await send(s.h, { tok: null })).status, 401, "no token");
  eq((await send(s.h, { tok: "anon-key" })).status, 401, "the anon key alone");
  eq((await send(s.h, { tok: "tok-bad" })).status, 401, "a bad token");
  const r = await send(s.h, { tok: "tok-stranger" });
  eq([r.status, (await r.json()).kind], [403, "firm"], "a signed-in person of no firm");
  const c = await send(s.h, { client: "zz-other-client" });
  eq([c.status, (await c.json()).kind], [403, "client"], "a client that is not the firm's");
  const off = stand({ key: "gsk_test", assistantOff: true });
  eq((await send(off.h)).status, 403, "the firm's owner switched AI help off");
  const nomfa = stand({ key: "gsk_test", aal2: false });
  eq([(await send(nomfa.h)).status], [403], "the two-step sign-in not finished");
  assert(![...s.calls, ...off.calls, ...nomfa.calls].some((x) => x.url.startsWith("https://api.groq.com/")), "Groq was never called");
  eq(s.logRows.length, 0, "nothing logged for a refused caller");
});

Deno.test("too large or too long, or not audio, is refused before Groq", async () => {
  const s = stand({ key: "gsk_test" });
  const big = await send(s.h, { bytes: new Uint8Array(5 * 1024 * 1024 + 1) });
  eq([big.status, (await big.json()).kind], [413, "size"], "over 5 MB");
  const said = await send(s.h, { bytes: new Uint8Array(10), len: String(6 * 1024 * 1024) });
  eq(said.status, 413, "a Content-Length over 5 MB is refused without reading");
  const long = await send(s.h, { secs: 61 });
  eq([long.status, (await long.json()).kind], [413, "length"], "over 60 s");
  eq((await send(s.h, { type: "application/pdf" })).status, 415, "not audio");
  eq((await send(s.h, { lang: "fr" })).status, 400, "a language other than hi, en or auto");
  eq((await send(s.h, { bytes: new Uint8Array(0) })).status, 400, "no audio");
  assert(!s.calls.some((x) => x.url.startsWith("https://api.groq.com/")), "Groq was never called");
});

Deno.test("the words prompt: the firm's words and the client's own top ledger and party names, within about 200 tokens", async () => {
  const s = stand({ key: "gsk_test" });
  const r = await send(s.h, { lang: "hi" });
  const j = await r.json();
  eq([r.status, j.ok, j.text], [200, true, "Richa Khandelwal ko 2 lakh rupees ka voucher."], "the text, trimmed");
  assert(typeof j.ms === "number" && j.ms >= 0, "the time taken, in ms");
  const g = s.calls.find((x) => x.url === "https://api.groq.com/openai/v1/audio/transcriptions")!;
  assert(g, "Groq's transcriptions endpoint was called");
  eq([g.method, g.form!.model, g.form!.temperature, g.form!.response_format, g.form!.language], ["POST", "whisper-large-v3", "0", "json", "hi"], "the full model for a 12 s clip, temperature 0, json, Hindi");
  const pr = g.form!.prompt;
  for (const w of ["Tally", "GST", "GSTR-1", "GSTR-3B", "TDS", "ledger", "voucher", "lakh", "crore", "rupees"]) assert(pr.toLowerCase().includes(w.toLowerCase()), "the firm's word " + w + " in " + pr);
  for (const n of ["Richa Khandelwal", "AIR ESS EXIM", "Larkspur Traders"]) assert(pr.includes(n), "the client's name " + n + " in the prompt: " + pr);
  assert(pr.length <= 700, "the prompt within its budget (" + pr.length + " characters)");
  assert(!pr.includes("Party Number 0 "), "the smallest ledgers are left out when the budget is full");
  eq([g.file!.name, g.file!.type, g.file!.size], ["clip.webm", "audio/webm", AUDIO.length], "the clip as a webm file");
  const en = stand({ key: "gsk_test" });
  await send(en.h, { lang: "auto", client: "", type: "audio/mp4", secs: 40 });
  const g2 = en.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!;
  eq([g2.form!.language, g2.file!.name, g2.form!.model], [undefined, "clip.m4a", "whisper-large-v3-turbo"], "auto: no language sent; Safari's mp4 as m4a; a 40 s clip on turbo");
  assert(g2.form!.prompt.includes("GSTR-3B") && !en.calls.some((x) => x.url.includes("tally_ledgers")), "no client: the firm's words only");
  eq(buildPrompt(["Ä".repeat(900)]).length <= 700, true, "a very long name is cut to the budget");
});

Deno.test("nothing kept: the audio and the words go only to Groq; one usage row with seconds, language and ok", async () => {
  const s = stand({ key: "gsk_test" });
  await send(s.h, { secs: 12.4, lang: "en" });
  const notGroq = s.calls.filter((x) => !x.url.startsWith("https://api.groq.com/"));
  assert(!notGroq.some((x) => has(x.body, AUDIO)), "the audio went nowhere but Groq");
  assert(!notGroq.some((x) => /storage\/v1/.test(x.url)), "no file stored");
  assert(!notGroq.some((x) => typeof x.body === "string" && /Richa|voucher/i.test(x.body)), "the words went nowhere");
  eq(s.logRows.length, 1, "one usage row");
  const row = s.logRows[0];
  eq([row.firm_id, row.user_id, row.client_id, row.feature, row.route, row.ms, row.tools, row.question, row.models], [FIRM, ME, "larkspur", "voice", "en", 12400, ["ok", "names:0"], "", ["whisper-large-v3"]],
    "the row: firm, user, client, voice, the language, the audio's length (ms), ok, no words");
});

Deno.test("Groq's 429 is 'limit', no key is 'nokey', another failure is 'error'; each logged as not ok", async () => {
  const lim = stand({ key: "gsk_test", groq: () => new Response(JSON.stringify({ error: { message: "Rate limit reached for model whisper-large-v3-turbo" } }), { status: 429 }) });
  const r = await send(lim.h);
  eq([r.status, (await r.json()).kind], [429, "limit"], "429: limit");
  eq(lim.logRows[0].tools, ["limit"], "logged as limit");
  const none = stand({ key: null });
  const n = await send(none.h);
  const nj = await n.json();
  eq([nj.ok, nj.kind], [false, "nokey"], "no groq_api_key: nokey");
  assert(!none.calls.some((x) => x.url.startsWith("https://api.groq.com/")), "Groq not called without a key");
  eq(none.logRows[0].tools, ["nokey"], "logged as nokey");
  const bad = stand({ key: "gsk_test", groq: () => new Response("oops", { status: 500 }) });
  const b = await send(bad.h);
  eq([b.status, (await b.json()).kind], [502, "error"], "another failure: error");
  const thrown = stand({ key: "gsk_test", groq: () => { throw new TypeError("network"); } });
  eq((await (await send(thrown.h)).json()).kind, "error", "Groq unreachable: error");
});

Deno.test("minutes used today: the firm's own; all firms' for the platform administrator", async () => {
  const s = stand({ key: "gsk_test" });
  const r = await s.h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-me", "Content-Type": "application/json" }, body: JSON.stringify({ action: "usage" }) }));
  const j = await r.json();
  eq([r.status, j.ok, j.firm_secs, j.all_secs, j.key], [200, true, 120, undefined, true], "the firm's 2 minutes; no platform total for a firm's owner");
  const a = stand({ key: null, superadmin: true });
  const ja = await (await a.h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-me", "Content-Type": "application/json" }, body: JSON.stringify({ action: "usage" }) }))).json();
  eq([ja.firm_secs, ja.all_secs, ja.key], [120, 180, false], "the platform administrator: all firms' 3 minutes, and the key not set");
  eq((await s.h(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status, 401, "usage needs a signed-in member too");
});

Deno.test("the model: large-v3 under 30 s, turbo for 30 s or more, and turbo when large-v3 answers 429", async () => {
  const models = async (o: Parameters<typeof send>[1], groq?: (f: Record<string, string>) => Response) => {
    const s = stand({ key: "gsk_test", groq });
    const r = await send(s.h, o);
    return { status: r.status, j: await r.json(), sent: s.calls.filter((x) => x.url.startsWith("https://api.groq.com/")).map((x) => x.form!.model), log: s.logRows };
  };
  eq((await models({ secs: 29.5 })).sent, ["whisper-large-v3"], "29.5 s: the full model");
  eq((await models({ secs: 30 })).sent, ["whisper-large-v3-turbo"], "30 s: turbo");
  const lim = (f: Record<string, string>) => f.model === "whisper-large-v3" ? new Response(JSON.stringify({ error: { message: "Rate limit" } }), { status: 429 }) : new Response(JSON.stringify({ text: "Tally kholo" }));
  const fb = await models({ secs: 8 }, lim);
  eq([fb.status, fb.j.text, fb.j.model, fb.sent], [200, "Tally kholo", "whisper-large-v3-turbo", ["whisper-large-v3", "whisper-large-v3-turbo"]], "large-v3 at its limit: the same clip on turbo");
  eq(fb.log[0].models, ["whisper-large-v3-turbo"], "the model used is logged");
  const both = await models({ secs: 8 }, () => new Response("{}", { status: 429 }));
  eq([both.status, both.j.kind, both.sent.length], [429, "limit", 2], "both at their limit: limit");
});

Deno.test("Hinglish: a sample sentence in English letters from the client's names; Devanagari answers written in English letters", async () => {
  const s = stand({ key: "gsk_test", groq: () => new Response(JSON.stringify({ text: "रिचा खंडेलवाल को एक लाख का पेमेंट, टैली में एंट्री" })) });
  const r = await send(s.h, { lang: "auto", latin: true });
  const j = await r.json();
  const g = s.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!;
  const pr = g.form!.prompt;
  assert(pr.startsWith("Larkspur Traders ke liye HDFC Bank A/c se AIR ESS EXIM PRIVATE LIMITED ko 1 lakh"), "the sample sentence with the client, its bank and a party: " + pr);
  for (const w of ["TDS 194J", "GSTR-1", "GSTR-3B", "Tally", "voucher", "Ledger", "crore", "rupees", "Richa Khandelwal"]) assert(pr.includes(w), w + " in the prompt: " + pr);
  assert(!/[ऀ-ॿ]/.test(pr), "Latin script only");
  assert(pr.length <= 700, "within the budget (" + pr.length + ")");
  eq(g.form!.language, undefined, "the language left to Whisper");
  eq(j.text, "Richa Khandelwal ko ek lakh ka pement, Tally men entri", "Devanagari written in English letters, then the names corrected");
  eq(j.changes, [{ from: "richa khandelval", to: "Richa Khandelwal" }, { from: "taili", to: "Tally" }], "the changes");
  eq(s.logRows[0].tools, ["ok", "latin", "names:2"], "logged: written in English letters, 2 names corrected (no words)");
  assert(!JSON.stringify(s.logRows).includes("Richa"), "no words in the log");
  // English and Hindi: their own sample sentences
  const en = stand({ key: "gsk_test" }); await send(en.h, { lang: "en" });
  assert(en.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!.form!.prompt.startsWith("For Larkspur Traders, a payment of 1 lakh"), "English: an English sentence");
  const hi = stand({ key: "gsk_test" }); await send(hi.h, { lang: "hi" });
  assert(hi.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!.form!.prompt.includes(" के लिए "), "Hindi: a Hindi sentence");
  eq(buildPrompt([], "hinglish").startsWith("Client ke liye bank se party ko"), true, "no client: the sentence still");
  eq(buildPrompt(["रिचा", "Richa"], "hinglish").includes("रिचा"), false, "Hinglish: a Devanagari name is left out");
});

Deno.test("names corrected on the server: the client's ledgers and the firm's clients; the changes go back", async () => {
  const s = stand({ key: "gsk_test", groq: () => new Response(JSON.stringify({ text: "leeds insurance ke liye hdfc bank se richa khandelwaal ko 1,25,000 ka payment, teddy mein entry." })) });
  const j = await (await send(s.h, { lang: "auto", latin: true })).json();
  eq(j.text, "Leads Insurance ke liye HDFC Bank A/c se Richa Khandelwal ko 1,25,000 ka payment, Tally mein entry.", "corrected");
  eq(j.changes.map((c: any) => c.to), ["Leads Insurance", "HDFC Bank A/c", "Richa Khandelwal", "Tally"], "the changes");
  eq(s.logRows[0].tools, ["ok", "names:4"], "the count only");
  assert(!s.calls.some((x) => x.url.startsWith("https://api.anthropic.com/")), "nothing unsure: no AI call");
});

Deno.test("the AI step: only for names near but unsure, under the cap; a changed number is refused", async () => {
  const said = "mohan laal ko 5000 ka payment";
  const groq = () => new Response(JSON.stringify({ text: said }));
  const answer = (t: string) => () => new Response(JSON.stringify({ content: [{ type: "text", text: t }], usage: { input_tokens: 200, output_tokens: 20 } }));
  // a good answer: taken
  const a = stand({ key: "gsk_test", claudeKey: "sk-test", groq, claude: answer("Mohan Lal ko 5000 ka payment") });
  const ja = await (await send(a.h, { lang: "auto", latin: true })).json();
  eq([ja.text, ja.changes], ["Mohan Lal ko 5000 ka payment", [{ from: "mohan laal", to: "Mohan Lal" }]], "the AI's fix taken");
  const call = a.calls.find((x) => x.url.startsWith("https://api.anthropic.com/"))!;
  const body = JSON.parse(String(call.body));
  eq(body.model, HAIKU, "the routing model of FinCom Assistant");
  assert(body.messages[0].content.includes("Mohan Lal") && !body.messages[0].content.includes("Richa Khandelwal"), "only the near names go, never the whole list");
  eq(a.rpcs.map((x) => x[0]), ["asst_cap_take", "asst_cost_add"], "the cap taken, the cost added");
  eq(a.logRows[0].tools, ["ok", "names:0", "ai:1"], "logged: one fix by AI (count only)");
  eq(a.logRows[0].models, ["whisper-large-v3", HAIKU], "both models logged");
  // an amount changed: refused, the words as Whisper said them
  const b = stand({ key: "gsk_test", claudeKey: "sk-test", groq, claude: answer("Mohan Lal ko 50000 ka payment") });
  const jb = await (await send(b.h, { lang: "auto", latin: true })).json();
  eq([jb.text, jb.changes], [said, []], "a number changed: refused");
  eq(b.logRows[0].tools, ["ok", "names:0", "ai:refused"], "logged as refused");
  // over the cap, or no Claude key: no AI call
  const c = stand({ key: "gsk_test", claudeKey: "sk-test", groq, capOk: false });
  eq((await (await send(c.h, { lang: "auto", latin: true })).json()).text, said, "over the cap: the words as they are");
  assert(!c.calls.some((x) => x.url.startsWith("https://api.anthropic.com/")), "over the cap: no AI call");
  const d = stand({ key: "gsk_test", groq });
  await send(d.h, { lang: "auto", latin: true });
  assert(!d.calls.some((x) => x.url.startsWith("https://api.anthropic.com/")), "no Claude key: no AI call");
  // an identifier in the words: never sent
  const e = stand({ key: "gsk_test", claudeKey: "sk-test", groq: () => new Response(JSON.stringify({ text: "mohan laal PAN ABCPK1234L ka" })) });
  await send(e.h, { lang: "auto", latin: true });
  assert(!e.calls.some((x) => x.url.startsWith("https://api.anthropic.com/")), "a PAN in the words: no AI call");
  // the AI fails: the words stand
  const f = stand({ key: "gsk_test", claudeKey: "sk-test", groq, claude: () => new Response("oops", { status: 500 }) });
  const rf = await send(f.h, { lang: "auto", latin: true });
  eq([rf.status, (await rf.json()).text], [200, said], "the AI step failed: Whisper's words stand");
});

Deno.test("verbose=1 (live subtitles in calls): Whisper's verbose answer and the language it found; without it, as before", async () => {
  const s = stand({ key: "gsk_test", groq: () => new Response(JSON.stringify({ text: " வணக்கம் Sharma Traders ", language: "tamil", segments: [] })) });
  const r = await send(s.h, { lang: "auto", verbose: true, latin: true });
  const j = await r.json();
  eq([r.status, j.text, j.language], [200, "வணக்கம் Sharma Traders", "ta"], "the words in their own script and the language");
  eq(s.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!.form!.response_format, "verbose_json", "asked for the verbose answer");
  const plain = stand({ key: "gsk_test" });
  const j2 = await (await send(plain.h, { lang: "hi" })).json();
  eq([j2.language, plain.calls.find((x) => x.url.startsWith("https://api.groq.com/"))!.form!.response_format], [undefined, "json"], "without verbose: unchanged (no language, json)");
});
