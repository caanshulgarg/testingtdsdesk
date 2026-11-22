// assistant-night (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md): one client's night check. Called by the database's
// timer (migration-206-cron.sql: x-cron-key, checked with gst_cron_ok as gst-run does) or the service role, never by a
// browser. verify_jwt off: this handler checks the caller itself.
//   POST {action: "client", firm_id, client_id}
//   POST {action: "remind"}   (phase 2) the reminders the owners turned on ("Remind by itself"): see remind() below
// It reads the client's books from FinCom's cloud with the service role (gst-run's own loader and engine: the same books
// the app opens), adds the bank statements, the Inbox, FinCom's bills and what earlier nights found, runs the checks and
// FinCom's own answers (server/_shared/nightchecks.js), and hands everything to night_apply in one call (idempotent:
// rule 4). Nothing is posted, sent or changed in the books (rule 3). No AI.
import { firmGate, viaRest } from "../_shared/firmgate.ts";
import { load } from "../gst-run/data.ts";
// @ts-ignore plain JavaScript, shared with the Node tests
import { booksOf, twobOnly, nightInput, gstOf, draftsOf, jobOf } from "./nightinput.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { journals } from "../_shared/dailyjournals.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { message } from "../_shared/asks.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { plan, mail } from "../_shared/sendguard.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { run } from "../_shared/nightchecks.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { ENGINE } from "../gst-run/engine.js";

export type Deps = { env: (k: string) => string | undefined; fetch: typeof fetch; now?: () => Date; ready?: number; total?: number };
// the run's own work, not the waits for the database (an edge function's CPU limit counts the same): making the books over
// READY ms keeps the entries made (gst_calc_prep, as gst-run does) and the next tick goes on from them; the whole run over
// TOTAL ms is stopped and said so
const READY = 1100, TOTAL = 1800;
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fyOf = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); };

async function all(rest: (p: string) => Promise<any>, path: string, order: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 2_000_000; off += 1000) {
    const rows = await rest(path + "&order=" + order + "&limit=1000&offset=" + off);
    if (!Array.isArray(rows)) throw new Error("the cloud copy could not be read");
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => new Date());
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || "");
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
  // (re-review N6) the run's own work counted from the request's start: every answer's reading and JSON parse, the
  // request's own body, and the work on the books; never the waits for the database. One counter per request
  const per = () => {
    const ctx = { spent: 0 };
    const rest = async (path: string, _t = SERVICE, init: RequestInit = {}) => {
      const r = await doFetch(URL_ + path, { ...init, headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", ...(init.headers || {}) } });
      const t = await r.text(), p0 = Date.now(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
      ctx.spent += Date.now() - p0;
      if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
      return j;
    };
    const rpc = (fn: string, args: Record<string, unknown>) => rest("/rest/v1/rpc/" + fn, SERVICE, { method: "POST", body: JSON.stringify(args) });
    return { ctx, rest, rpc };
  };
  const top = per(), rpc = top.rpc;

  async function client(firm: string, cid: string, req: { ctx: { spent: number }; rest: any; rpc: any }) {
    const { rest, rpc } = req;
    const night = istDay(now()), ym = night.slice(0, 7).replace("-", "");
    const fail = (status: string, why: string) => rpc("night_fail", { p_firm: firm, p_client: cid, p_night: night, p_status: status, p_why: why }).catch(() => null);
    // the console's switches: when they cannot be read, nothing is checked (closed, not open); the next tick tries again
    // (firmGate itself lets a failed read through, for the pages; here a read that failed for any reason but a column this
    // database does not have stops the night for the client)
    let gate: any, unread = false;
    const read = viaRest(rest, SERVICE);
    const watched = async (t: any, cols: string, eq: Record<string, string>) => { try { return await read(t, cols, eq); } catch (e) { if (!/does not exist|42703|PGRST204|schema cache/i.test(String((e as Error)?.message || e))) unread = true; throw e; } };
    try { gate = await firmGate(watched as any, firm, cid); } catch { unread = true; }
    if (unread) { await fail("failed", "the console's switches could not be read"); return { ok: false, error: "gate" }; }
    if (gate) { await fail("skipped", gate.reason); return { ok: true, skipped: gate.reason }; }
    // the client's settings are its record's data (as gst-run reads them: closed periods, GST settings, bank accounts)
    const cl = ((await rest("/rest/v1/clients?select=id,data,deleted&firm_id=eq." + enc(firm) + "&id=eq." + enc(cid))) || [])[0];
    if (!cl || cl.deleted) { await fail("skipped", "no such client"); return { ok: true, skipped: "client" }; }
    const co = Object.assign({}, cl.data || {}, { id: cl.id, deleted: !!cl.deleted });
    const bookId = await rpc("gst_calc_book", { p_firm: firm, p_client: cid, p_ym: ym }).catch(() => null);
    const book = bookId ? ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&book_id=eq." + enc(String(bookId)))) || [])[0] : null;
    if (!book) { await fail("skipped", "no books in the cloud"); return { ok: true, skipped: "books" }; }
    const gstins: string[] = await rpc("gst_calc_gstins", { p_book: book.book_id, p_client: cid }).catch(() => []) || [];
    const fys = Array.from(new Set([fyOf(night), fyOf(new Date(now().getTime() - 400 * 86400_000).toISOString().slice(0, 10))]));
    // a large book's entries as an earlier run made them (gst_calc_prep, migration 162), when kept on the book's version
    const bver = String(await rpc("tally_calc_version", { p_book: book.book_id }).catch(() => "") || "");
    const prep = bver ? await rpc("gst_calc_prep_get", { p_book: book.book_id, p_version: bver, p_engine: ENGINE }).catch(() => null) : null;
    const rows = await load((p: string) => rest(p), rpc, firm, cid, book, co, fys, gstins, Array.isArray(prep) ? prep : undefined);
    const w = "firm_id=eq." + enc(firm) + "&client_id=eq." + enc(cid);
    const [bankRecs, inboxRecs, entryRecs, prior] = await Promise.all([
      all((p) => rest(p), "/rest/v1/records?select=kind,id,data,deleted&" + w + "&kind=in.(bank_stmt,bank_rows,bank_meta)&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/records?select=id,data,deleted&" + w + "&kind=eq.inbox&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/records?select=id,data,deleted&" + w + "&kind=eq.entry&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/night_findings?select=kind,key,state,evidence,undone_at&" + w, "key"),
    ]);
    const firmRow = ((await rest("/rest/v1/firms?select=*&id=eq." + enc(firm)).catch(() => [])) || [])[0] || {};
    const firmRules = Array.isArray(firmRow.data && firmRow.data.bankRules) ? firmRow.data.bankRules : [];
    const t0 = Date.now(), base = req.ctx.spent, spent = () => base + Date.now() - t0 + (rows.unpackMs || 0);
    const b = booksOf(rows);
    if (spent() > (deps.ready || READY) && !rows.fromPrep) {
      // too much for one run: the entries made are kept, the next tick goes on from them (the run is tried again)
      const put = bver ? await rpc("gst_calc_prep_put", { p_book: book.book_id, p_version: bver, p_engine: ENGINE, p_vouchers: rows.made }).catch(() => false) : false;
      await fail("failed", put === true ? "large books: prepared, goes on next tick" : "large books: could not be prepared");
      return { ok: true, prepared: put === true };
    }
    const twob = twobOnly(b, rows);
    const today = night.replace(/-/g, "");
    // (phase 2) the app's own 3B of each month marked filed, and Daily Check's journals already approved (asstEntries)
    const gst = gstOf(rows, b, today);
    const draftRecs = (rows.items || []).filter((r: any) => r && r.key === "asstEntries");
    // (review N4) the postings of Daily Check's drafts: one the cloud's queue stopped makes its draft failed (offered again);
    // then entries claimed and left (a closed tab) are settled from their drafts (entry_settle)
    const jobIds = Array.from(new Set(draftRecs.map((r: any) => jobOf(r.data)).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x))));
    const jobRows = jobIds.length ? await rest("/rest/v1/tally_post_jobs?select=id,status,results&id=in.(" + jobIds.join(",") + ")").catch(() => []) : [];
    const jobs = Object.fromEntries((Array.isArray(jobRows) ? jobRows : []).map((j: any) => [j.id, j]));
    await rpc("entry_settle", { p_firm: firm, p_client: cid, p_failed: draftsOf(draftRecs, jobs, prior.map((p: any) => ({ kind: p.kind, key: p.key, state: p.state, evidence: p.evidence, undone: !!p.undone_at }))).filter((d: any) => d.state === "failed").map((d: any) => d.dedupe) }).catch(() => null);
    const inp = nightInput(rows, b, { today, bankRecs, inboxRecs, entryRecs, twob, firmRules, gst, draftRecs, jobs, prior: prior.map((p: any) => ({ kind: p.kind, key: p.key, state: p.state, evidence: p.evidence, undone: !!p.undone_at })) });
    const res0 = run(inp), j = journals(inp);
    const res = { findings: res0.findings.concat(j.findings), entries: res0.entries.concat(j.entries) };
    if (spent() > (deps.total || TOTAL) * 3) { await fail("failed", "too large for one run (" + spent() + " ms)"); return { ok: false, error: "too large" }; }
    const version = String(book.book_id) + ":" + (b.vouchers || []).length + ":" + (book.ledgers_at || "");
    const counts = await rpc("night_apply", { p_firm: firm, p_client: cid, p_night: night, p_version: version, p_findings: res.findings, p_entries: res.entries, p_complete: true, p_why: "" });
    return { ok: true, night, counts };
  }

  // (phase 2) "Remind by itself": for each client whose owner turned it on, the document requests asked once and still
  // needed are emailed again, at most once a week, through the same guard as a person's send (sendguard.js: test mode =
  // the firm's own address only; the real address only when the firm's owner turned real sending on AND the secret
  // ASSISTANT_MAIL_LIVE is "yes"). remind_due (migration 208) picks them (owner still active, questions still "ask",
  // a week since the last send and the last reminder; in real sending only questions really asked); the send log is the
  // one a person's send writes (ask_send_begin / ask_send_finish), and remind_logged logs each one.
  async function remind(req: { rpc: any }) {
    const KEY = String(env("RESEND_API_KEY") || ""), FROM = String(env("ASSISTANT_MAIL_FROM") || ""), LIVE = String(env("ASSISTANT_MAIL_LIVE") || "");
    const due: any[] = (await req.rpc("remind_due", { p_live: LIVE === "yes" })) || [];
    const out: any[] = [];
    for (const r of due.slice(0, 50)) {
      const p: any = plan({ contacts: r.contacts || [], realSend: r.real_send === true, live: LIVE, testTo: r.test_to, ownerEmail: r.owner_email });
      const qs = (r.questions || []).map((q: any) => ({ state: "ask", ask: { id: q.id, text: q.text, state: q.state } }));
      if (!qs.length) continue;
      if (p.refused || !KEY || !FROM) { await req.rpc("remind_logged", { p_firm: r.firm_id, p_client: r.client_id, p_send: null, p_ids: qs.map((q: any) => q.ask.id), p_status: "refused", p_why: p.refused || "Email is not set up yet." }).catch(() => null); out.push({ client: r.client_id, ok: false }); continue; }
      let sendId: number | null = null;
      try { sendId = await req.rpc("ask_send_begin", { p_firm: r.firm_id, p_by: r.by, p_client: r.client_id, p_ids: qs.map((q: any) => q.ask.id), p_channel: "email", p_meant: p.meant || [], p_sent_to: p.to, p_test: p.test }); }
      catch (e) { await req.rpc("remind_logged", { p_firm: r.firm_id, p_client: r.client_id, p_send: null, p_ids: qs.map((q: any) => q.ask.id), p_status: "refused", p_why: String((e as Error).message || e).slice(0, 200) }).catch(() => null); out.push({ client: r.client_id, ok: false }); continue; }
      let st = "failed", why = "stopped before Resend answered", provider = "";
      try {
        const m = message({ name: r.client || "your company" }, qs, { firm: r.firm || "", week: "" });
        const payload = mail({ from: FROM, replyTo: r.test_to || r.owner_email || "", plan: p, subject: "Reminder: " + m.subject, text: m.text });
        const res = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const jj: any = await res.json().catch(() => ({}));
        if (res.ok) { st = "sent"; why = ""; provider = String(jj.id || ""); } else why = String(jj.message || res.status).slice(0, 200);
      } catch (e) { why = String((e as Error)?.message || e).slice(0, 200); }
      await req.rpc("ask_send_finish", { p_send: sendId, p_status: st, p_provider: provider || null, p_why: why }).catch(() => null);
      await req.rpc("remind_logged", { p_firm: r.firm_id, p_client: r.client_id, p_send: sendId, p_ids: qs.map((q: any) => q.ask.id), p_status: st, p_why: why }).catch(() => null);
      out.push({ client: r.client_id, ok: st === "sent", test: p.test, to: p.to });
    }
    return { ok: true, reminders: out.length, sent: out.filter((x) => x.ok).length, test: out.every((x) => x.test !== false) };
  }

  return async (req: Request) => {
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), ck = req.headers.get("x-cron-key") || "";
    const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
    if (!inside) return reply(401, { ok: false, error: "Only FinCom's own timer runs the night check." });
    const one = per();
    let body: any = {};
    const b0 = Date.now();
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    one.ctx.spent += Date.now() - b0;
    if (body.action === "remind") { try { return reply(200, await remind(one)); } catch (e) { return reply(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) }); } }
    if (body.action !== "client" || !UUID.test(String(body.firm_id || "")) || !/^[\w.:-]{1,80}$/.test(String(body.client_id || ""))) return reply(400, { ok: false, error: "Say which client." });
    try { return reply(200, await client(String(body.firm_id), String(body.client_id), one)); }
    catch (e) {
      const why = String((e as Error)?.message || e).slice(0, 300);
      await rpc("night_fail", { p_firm: body.firm_id, p_client: body.client_id, p_night: istDay(now()), p_status: "failed", p_why: why }).catch(() => null);
      return reply(500, { ok: false, error: why });
    }
  };
}
