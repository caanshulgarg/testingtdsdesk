// mis-run (ROUND 105 B6): My MIS sent on a schedule. index.ts serves this handler; the tests (handler_test.ts) give it a
// fake Supabase (REST, RPC, Storage, the user check) and a fake Resend.
//   POST from the database's timer (x-cron-key, checked with gst_cron_ok; or the service key): {action: "due"} takes the
//     schedules that are due (mis_take: each moved on to its next time at once, so nothing is sent twice) and runs each.
//   POST from a signed-in owner or staff member: {action: "run", schedule_id} runs one of the firm's schedules now (its
//     next time stays as it is). A look-only member may not.
// A run: the saved report (client_book_items, key misCustom, item "#<report id>") for the schedule's period (last month,
// month / quarter / year to date, in IST) worked out by the app's own engine (app/src/lib/misCustom.js) from the cloud copy
// (data.ts); its Excel (ExcelJS, the app's own workbook: misXlsx.js) and PDF (pdf.ts) kept in the private bucket
// mis-reports under <firm>/<client>/; a bell notice for the firm (tally_alerts, kind summary, "… is ready"); and an email
// with both files to the recipients (the members chosen and the addresses typed) through Resend, only when the platform has
// its key (platform_secrets resend_api_key); without it the run says "email not set up" and the bell is the notice.
// Every run is logged (mis_runs: when, the period, the files, to whom, ok or failed and why). A run that fails is tried once
// more; failing again it is logged as failed and the bell says why.
import { corsFor } from "../_shared/cors.ts";
import { normalizeDef } from "../_shared/misdef.js";
import { run as runEngine, periodOf } from "../../app/src/lib/misCustom.js";
import { workbook } from "../../app/src/lib/misXlsx.js";
import { cloudData, fetchBook } from "./data.ts";
import { misPdf } from "./pdf.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, now?: () => Date, excel: () => Promise<any> };
const PERIOD_WORDS: Record<string, string> = { lastMonth: "last month", mtd: "the month so far", qtd: "the quarter so far", ytd: "the year so far" };
const enc = encodeURIComponent;
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const slug = (s: string) => String(s || "mis").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mis";
export const istIso = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => new Date());
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const rest = async (path: string, token = SERVICE, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>, token = SERVICE) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });
  const insert = (table: string, row: Record<string, unknown>) => rest("/rest/v1/" + table, SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  const upload = async (path: string, bytes: Uint8Array, type: string) => {
    const r = await doFetch(URL_ + "/storage/v1/object/mis-reports/" + path.split("/").map(enc).join("/"), { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": type, "x-upsert": "true" }, body: bytes });
    if (!r.ok) throw new Error("the file could not be kept (" + r.status + ")");
  };
  const secret = async (name: string) => { const r = await rest("/rest/v1/platform_secrets?select=value&name=eq." + enc(name)).catch(() => []); return (r && r[0] && r[0].value) || ""; };

  // one run of one schedule: worked out, the files kept, the bell, the email; the log row returned
  async function once(s: any, by: string, attempt: number) {
    const items = await rest("/rest/v1/client_book_items?select=data&firm_id=eq." + enc(s.firm_id) + "&client_id=eq." + enc(s.client_id) + "&key=eq.misCustom&item=eq." + enc("#" + s.report_id) + "&deleted=eq.false");
    const rec = items && items[0] && items[0].data;
    if (!rec || !rec.def) throw new Error("the report " + (s.report_name || s.report_id) + " is no longer saved for this client");
    const def = normalizeDef(Object.assign({}, rec.def, { period: { kind: s.period } })).def, today = istDay(now());
    const client = ((await rest("/rest/v1/clients?select=name&firm_id=eq." + enc(s.firm_id) + "&id=eq." + enc(s.client_id)).catch(() => [])) || [])[0] || {};
    const pr = periodOf(def, null, today);
    const rows = await fetchBook((p: string) => rest(p), s.firm_id, s.client_id, pr.to);
    if (!rows) throw new Error("FinCom's cloud has no books of this client for " + pr.from + " to " + pr.to);
    const gst = def.blocks.some((b: any) => b.rows.by === "gst") ? await rpc("mis_cloud_gst", { p_schedule: s.id, p_from: pr.from.slice(0, 4) + "-" + pr.from.slice(4, 6) + "-" + pr.from.slice(6), p_to: pr.to.slice(0, 4) + "-" + pr.to.slice(4, 6) + "-" + pr.to.slice(6) }).catch(() => null) : null;
    const data = cloudData(rows, def, today, gst);
    const res: any = runEngine(def, data, { today });
    res.company = client.name || rows.book.company || "";
    const failedBlocks = res.blocks.filter((b: any) => b.error);
    if (failedBlocks.length === res.blocks.length) throw new Error("no block could be worked out: " + failedBlocks[0].error);
    const ExcelJS = await deps.excel();
    const { wb } = await workbook(ExcelJS, res, { images: false });
    const xlsx = new Uint8Array(await wb.xlsx.writeBuffer()), pdf = await misPdf(res, { company: res.company });
    const stamp = now().toISOString().replace(/[-:]/g, "").slice(0, 15), base = s.firm_id + "/" + s.client_id + "/" + stamp + "-" + slug(def.name);
    await upload(base + ".xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await upload(base + ".pdf", pdf, "application/pdf");
    const files = [{ kind: "xlsx", path: base + ".xlsx", name: slug(res.company) + "-" + slug(def.name) + ".xlsx", bytes: xlsx.length }, { kind: "pdf", path: base + ".pdf", name: slug(res.company) + "-" + slug(def.name) + ".pdf", bytes: pdf.length }];
    const title = def.name + " for " + (res.company || "the client") + " is ready (" + res.periodLabel + ")";
    // to whom: the members chosen (their sign-in addresses) and the addresses typed
    const ids = ((s.recipients || {}).members || []).filter((x: string) => /^[0-9a-f-]{36}$/.test(x));
    const mem = ids.length ? await rest("/rest/v1/members?select=user_id,email&firm_id=eq." + enc(s.firm_id) + "&active=is.true&user_id=in.(" + ids.join(",") + ")").catch(() => []) : [];
    const to = Array.from(new Set([...(mem || []).map((m: any) => String(m.email || "").trim()).filter(Boolean), ...((s.recipients || {}).emails || [])])).slice(0, 50);
    let email = "no recipients", sent: string[] = [];
    if (to.length) {
      const key = await secret("resend_api_key");
      if (!key) email = "not set up";
      else {
        const from = (await secret("resend_from")) || "FinCom MIS <mis@fincom.live>";
        const r = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, subject: title, text: title + ".\n\nThe Excel and the PDF are attached. Every figure is worked out by FinCom from the books in FinCom's cloud.\n\n" + (def.name) + " · " + res.periodLabel,
            attachments: [{ filename: files[0].name, content: b64(xlsx) }, { filename: files[1].name, content: b64(pdf) }] }) });
        if (r.ok) { email = "sent"; sent = to; } else { email = "failed"; }
      }
    }
    await insert("tally_alerts", { firm_id: s.firm_id, client_id: s.client_id, kind: "summary", day: istIso(now()), words: title + (email === "sent" ? ", and emailed to " + sent.length + (sent.length === 1 ? " person" : " people") : email === "not set up" ? " (email is not set up yet: open it in My MIS)" : ""),
      data: { what: "mis", schedule: s.id, report: s.report_id, files, period: pr }, at: now().toISOString() });
    return (await insert("mis_runs", { firm_id: s.firm_id, client_id: s.client_id, schedule_id: s.id, report_id: s.report_id, report_name: def.name, period: pr, files, sent_to: sent, email, status: "ok", attempt, by_whom: by }))[0];
  }
  // a run, tried once more when it fails; failing again: logged as failed and the bell says why
  async function runOne(s: any, by: string) {
    let last: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return { ok: true, run: await once(s, by, attempt) }; } catch (e) { last = e; }
    }
    const why = String((last && last.message) || last || "it failed").slice(0, 500);
    await insert("mis_runs", { firm_id: s.firm_id, client_id: s.client_id, schedule_id: s.id, report_id: s.report_id, report_name: s.report_name || "", status: "failed", error: why, attempt: 2, by_whom: by }).catch(() => null);
    await insert("tally_alerts", { firm_id: s.firm_id, client_id: s.client_id, kind: "summary", day: istIso(now()), words: (s.report_name || "The scheduled MIS") + " could not be prepared: " + why, data: { what: "mis", schedule: s.id, failed: true }, at: now().toISOString() }).catch(() => null);
    return { ok: false, error: why };
  }

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const action = String(body?.action || "");
    if (action === "due") {
      const ck = req.headers.get("x-cron-key") || "";
      const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
      if (!inside) return reply(401, { ok: false, error: "Not allowed." });
      const until = Date.now() + 110_000, out: any[] = [];
      while (Date.now() < until) {
        const due = (await rpc("mis_take", { p_n: 3 })) as any[];
        if (!due || !due.length) break;
        for (const s of due) { const r = await runOne(s, "timer"); out.push({ schedule: s.id, ok: r.ok }); }
      }
      return reply(200, { ok: true, runs: out });
    }
    if (action !== "run") return reply(400, { ok: false, error: "Unknown action." });
    if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + enc(user.id)).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    if (!["owner", "staff"].includes(member.role)) return reply(403, { ok: false, kind: "role", error: "Look-only access: ask the firm's owner or staff to run it." });
    const s = ((await rest("/rest/v1/mis_schedules?select=*&id=eq." + enc(String(body.schedule_id || "")) + "&firm_id=eq." + enc(member.firm_id)).catch(() => [])) || [])[0];
    if (!s) return reply(404, { ok: false, error: "No such schedule in your firm." });
    const r = await runOne(s, "person");
    return reply(r.ok ? 200 : 500, r);
  };
}
