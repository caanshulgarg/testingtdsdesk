// mis-run (ROUND 105 B6): My MIS sent on a schedule. index.ts serves this handler; the tests (handler_test.ts) give it a
// fake Supabase (REST, RPC, Storage, the user check) and a fake Resend.
//   POST from the database's timer (x-cron-key, checked with gst_cron_ok; or the service key): {action: "due"} takes the
//     schedules that are due (mis_take: each moved on to its next time at once, so nothing is sent twice) and runs each.
//   POST from a signed-in owner or staff member: {action: "run", schedule_id} runs one of the firm's schedules now (its
//     next time stays as it is). A look-only member may not.
//   POST from a signed-in member (next-cloud-calc1, migration 151): {action: "now", client, from, to} MIS's figures for
//     the period worked out in the database, kept while the books stay the same (misNow below)
// A run: the saved report (client_book_items, key misCustom, item "#<report id>") for the schedule's period (last month,
// month / quarter / year to date, in IST) worked out by the app's own engine (app/src/lib/misCustom.js) from the cloud copy
// (data.ts); its Excel (ExcelJS, the app's own workbook: misXlsx.js) and PDF (pdf.ts) kept in the private bucket
// mis-reports under <firm>/<client>/; a bell notice for the firm (tally_alerts, kind summary, "… is ready"); and an email
// with both files to the recipients (the members chosen and the addresses typed) through Resend, only when the platform has
// its key (platform_secrets resend_api_key); without it the run says "email not set up" and the bell is the notice.
// Every run is logged (mis_runs: when, the period, the files, to whom, ok or failed and why). A run that fails is tried once
// more; failing again it is logged as failed and the bell says why.
import { corsFor } from "../_shared/cors.ts";
import { firmGate, viaRest } from "../_shared/firmgate.ts";   // the console's switches (migration 118)
import { EMAIL_STRICT, emailIn, lowEmail, MAIL_DAY_MAX, mailTake, plainWords, savedEmails, sha256hex } from "../_shared/mailrules.ts";
export { MAIL_DAY_MAX, plainWords };
import { normalizeDef } from "../_shared/misdef.js";
import { run as runEngine, periodOf } from "../../app/src/lib/misCustom.js";
import { workbook } from "../../app/src/lib/misXlsx.js";
import { cloudData, fetchBook } from "./data.ts";
import { misPdf } from "./pdf.ts";

// The emails FinCom sends for a firm.
//  - to whom: the firm's active members, the addresses saved in the client's own details, and addresses their owners
//    confirmed with a code when joining one of the firm's calls; any other typed address is left out (the bell says so);
//  - how many: MAIL_DAY_MAX people a day for a firm, counted in the shared table (migration 112, bucket mail-firm, with
//    the call invites; taken in one call, migration 191; ../_shared/mailrules.ts). Past it the report is made and
//    nothing is emailed; the same when the count cannot be read, and the bell says which of the two it was;
//  - in whose words: the subject is FinCom's own (mailSubject); the report's and the client's names go into the email
//    as plain words only (plainWords: letters, digits and a few marks; no address can be written with them);
//  - Run now: a schedule is run by a person at most RUN_NOW.max times in RUN_NOW.windowS seconds.
export const RUN_NOW = { max: 3, windowS: 600 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// the period in words from its two days (yyyymmdd): "September 2026" for a whole month, else "1 April 2026 to 30 September 2026"
export function mailSubject(pr: { from: string; to: string }) {
  const d = (x: string) => ({ y: +x.slice(0, 4), m: +x.slice(4, 6), d: +x.slice(6, 8) }), a = d(String(pr.from)), b = d(String(pr.to));
  const say = (x: { y: number; m: number; d: number }) => x.d + " " + MONTHS[x.m - 1] + " " + x.y;
  const whole = a.y === b.y && a.m === b.m && a.d === 1 && b.d === new Date(Date.UTC(b.y, b.m, 0)).getUTCDate();
  return "Your MIS report from FinCom is ready (" + (whole ? MONTHS[a.m - 1] + " " + a.y : say(a) + " to " + say(b)) + ")";
}

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
    const r = await doFetch(URL_ + "/storage/v1/object/mis-reports/" + path.split("/").map(enc).join("/"), { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": type, "x-upsert": "true" }, body: bytes as BodyInit });
    if (!r.ok) throw new Error("the file could not be kept (" + r.status + ")");
  };
  const secret = async (name: string) => { const r = await rest("/rest/v1/platform_secrets?select=value&name=eq." + enc(name)).catch(() => []); return (r && r[0] && r[0].value) || ""; };

  // one run of one schedule: worked out, the files kept, the bell, the email; the log row returned
  async function once(s: any, by: string, attempt: number) {
    const items = await rest("/rest/v1/client_book_items?select=data&firm_id=eq." + enc(s.firm_id) + "&client_id=eq." + enc(s.client_id) + "&key=eq.misCustom&item=eq." + enc("#" + s.report_id) + "&deleted=eq.false");
    const rec = items && items[0] && items[0].data;
    if (!rec || !rec.def) throw new Error("the report " + (s.report_name || s.report_id) + " is no longer saved for this client");
    const def = normalizeDef(Object.assign({}, rec.def, { period: { kind: s.period } })).def, today = istDay(now());
    const client = ((await rest("/rest/v1/clients?select=name,data&firm_id=eq." + enc(s.firm_id) + "&id=eq." + enc(s.client_id)).catch(() => [])) || [])[0] || {};
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
    // to whom: the members chosen (their sign-in addresses), and of the addresses typed only those the firm is known
    // to write to: a member's, one saved in the client's details, or one its owner confirmed with a code on a call
    const ids = ((s.recipients || {}).members || []).filter((x: string) => /^[0-9a-f-]{36}$/.test(x));
    const mem = ((await rest("/rest/v1/members?select=user_id,email&firm_id=eq." + enc(s.firm_id) + "&active=is.true").catch(() => [])) || []) as any[];
    const low = lowEmail;
    const chosen = mem.filter((m) => ids.includes(m.user_id)).map((m) => low(m.email)).filter(Boolean);
    const typed = Array.from(new Set((((s.recipients || {}).emails || []) as unknown[]).map(low).filter((e) => e.length <= 200 && EMAIL_STRICT.test(e)))).slice(0, 50);
    const known = savedEmails(client.data); mem.forEach((m) => { if (m.email) known.add(low(m.email)); });
    const ask = typed.filter((e) => !known.has(e));
    if (ask.length) {
      const conf = ((await rest("/rest/v1/call_participants?select=email&firm_id=eq." + enc(s.firm_id) + "&verified=is.true&email=" + emailIn(ask)).catch(() => [])) || []) as any[];
      conf.forEach((c) => known.add(low(c.email)));
    }
    const to = Array.from(new Set([...chosen, ...typed.filter((e) => known.has(e))])).slice(0, 50);
    const leftOut = typed.filter((e) => !known.has(e)).length;
    let email = "no recipients", sent: string[] = [], why = "";
    if (to.length) {
      const key = await secret("resend_api_key");
      if (!key) email = "not set up";
      else {
        // how many: the firm's places for today are taken, with these, before the email goes out
        const fits = await mailTake((fn, args) => rpc(fn, args), String(s.firm_id), to.length);
        if (fits !== "ok") { email = "failed"; why = fits === "unknown" ? " (not emailed: the email count could not be read)" : " (not emailed: the firm's daily email limit of " + MAIL_DAY_MAX + " is reached)"; }
        else {
          const from = (await secret("resend_from")) || "FinCom MIS <mis@fincom.live>";
          const r = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to, subject: mailSubject(pr), text: plainWords(def.name) + " for " + (plainWords(res.company) || "the client") + " is ready (" + plainWords(res.periodLabel) + ").\n\nThe Excel and the PDF are attached. Every figure is worked out by FinCom from the books in FinCom's cloud.\n\nSent by FinCom for the firm that keeps these books. If you did not expect it, tell that firm.",
              attachments: [{ filename: files[0].name, content: b64(xlsx) }, { filename: files[1].name, content: b64(pdf) }] }) });
          if (r.ok) { email = "sent"; sent = to; } else { email = "failed"; }
        }
      }
    }
    const left = leftOut ? "; " + leftOut + " address" + (leftOut === 1 ? "" : "es") + " left out (FinCom emails the firm's members, the client's saved addresses and people who joined a call of the firm with a code)" : "";
    await insert("tally_alerts", { firm_id: s.firm_id, client_id: s.client_id, kind: "summary", day: istIso(now()), words: title + (email === "sent" ? ", and emailed to " + sent.length + (sent.length === 1 ? " person" : " people") : email === "not set up" ? " (email is not set up yet: open it in My MIS)" : why) + left,
      data: { what: "mis", schedule: s.id, report: s.report_id, files, period: pr }, at: now().toISOString() });
    return (await insert("mis_runs", { firm_id: s.firm_id, client_id: s.client_id, schedule_id: s.id, report_id: s.report_id, report_name: def.name, period: pr, files, sent_to: sent, email, status: "ok", attempt, by_whom: by }))[0];
  }
  // a run, tried once more when it fails; failing again: logged as failed and the bell says why
  async function runOne(s: any, by: string) {
    // console phase 1b: a paused firm's schedules (the timer's and a person's Run now) wait; nothing is run, sent or kept
    const gate = await firmGate(viaRest(rest, SERVICE), String(s.firm_id || ""), s.client_id ? String(s.client_id) : null);
    if (gate) return { ok: false, reason: gate.reason, error: gate.error };
    let last: any = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { return { ok: true, run: await once(s, by, attempt) }; } catch (e) { last = e; }
    }
    const why = String((last && last.message) || last || "it failed").slice(0, 500);
    await insert("mis_runs", { firm_id: s.firm_id, client_id: s.client_id, schedule_id: s.id, report_id: s.report_id, report_name: s.report_name || "", status: "failed", error: why, attempt: 2, by_whom: by }).catch(() => null);
    await insert("tally_alerts", { firm_id: s.firm_id, client_id: s.client_id, kind: "summary", day: istIso(now()), words: (s.report_name || "The scheduled MIS") + " could not be prepared: " + why, data: { what: "mis", schedule: s.id, failed: true }, at: now().toISOString() }).catch(() => null);
    return { ok: false, error: why };
  }

  // next-cloud-calc1 (the owner, 09-Nov-2026: "it should not freeze at all, whatever the book size; calculation should
  // happen in cloud"): {action: "now", client, from, to} from a signed-in member (any role: it only reads) answers MIS's
  // figures for the period worked out in the database in ONE call, tally_now (migration 151; each figure checked against
  // the browser's own engine by tests/run_migration151.py). It works out the book's data version (which carries FinCom's
  // working, CALC_V) and gives back the answer kept for it (kind mis-now.2: answers of the first revision are never
  // served), else the figures: the receivables and payables ageing (MIS.ageing), owed to you and by you
  // (Parties.position(to)), cash and bank (r.balances) and every ledger's balance on the last day, all from one working of
  // that day's balances (the month-end tie-out, not part of MIS.runNow, is rpc tally_tieout). One JSON value: no REST
  // row limit. Those are kept with the version read before them, so a change meanwhile makes the next ask work them out
  // again. As "run": the member's firm, and the firm's and the company's switches (firmGate), first. The member's own
  // token reads (my_firm(): its own firm's books only); only keeping the answer uses the service key. partial: the parts
  // of MIS.runNow not worked out here yet (the browser works those out itself).
  // next-cloud-calc2 (migration 152): the rest of MIS.runNow, each part one call of tally_mis_part with the member's token,
  // asked once tally_now has answered: sales, purchases, the profit and loss, the period before and last year, month and
  // year to date, received and paid with the cash flow (r.p2.cash), compliance without GST 3B (GST paid from the bank,
  // TDS, challans, the TDS roll), MSME, the control; days of sales and purchases from those, as MIS.runNow works them out.
  // A part not worked out (152 not run yet, a failure, a book without its ledger masters for sales) is left to the
  // browser: named in later, the reason in errors, and the answer is partial. A partial answer is given back but NEVER
  // kept: only a whole answer (v 3, not partial) is kept and served as kept. A kept answer of phase 1 alone (v 2, partial)
  // is still the books' current version, so its figures are used and only 152's parts are worked out. GST 3B's figures
  // in comp.gst (output, credit, worked out to pay) are the GST 3B helper's, and the parts of MIS.runNow that are not
  // MIS's sections (the dues, the forecast, ratios, registrations and cost centres of r.p2, the audit's count) are not
  // worked out here either (outside).
  const NOW_KIND = "mis-now.2";                // as tally_now; .2: answers kept by the first revision are never given back
  const NOW_V = 3;                             // a whole answer with 152's parts; anything less is never served as kept
  // next-cloud-mis: the browser's MIS working (MIS.V, src/js/07-mis.js) these figures are the same as; the MIS page uses
  // an answer only of its own working, and a kept answer of another is worked out again (handler_test checks it is MIS.V)
  const MIS_V = 8;
  const NOW_PARTS = ["recv", "pay", "owed", "balances", "sales", "purchases", "goods", "pl", "prev", "ly", "mtd", "ytd", "cash", "p2.cash", "comp", "msme", "control", "dso", "dpo"];
  const SQL_PARTS = ["sales", "purchases", "pl", "prev", "ly", "tops", "cash", "comp", "msme", "control"];
  const PART_AT_ONCE = 3;                      // the parts asked at a time (the review: not ten connections per MIS open)
  const OUTSIDE = ["comp.gst.out", "comp.gst.itc", "comp.gst.rcm", "comp.gst.carry", "comp.gst.due", "comp.audit", "dues", "p2.fc", "p2.ratios", "p2.regs", "p2.cc"];
  const FIGURES = ["book", "version", "from", "to", "recv", "pay", "owed", "balances"];   // what tally_now works out
  const NOW_MONTHS = 120;                      // as tally_now
  async function misNow(body: any, jwt: string): Promise<[number, unknown]> {
    if (!jwt || jwt === ANON || jwt === SERVICE) return [401, { ok: false, kind: "auth", error: "Sign in to the firm account first." }];
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return [401, { ok: false, kind: "auth", error: "Sign in again." }]; }
    if (!user?.id) return [401, { ok: false, kind: "auth", error: "Sign in again." }];
    // two-step sign-in finished (security review of 13-Nov-2026, L1), as every other member function asks
    if ((await rpc("mfa_ok", {}, jwt).catch(() => false)) !== true) return [403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }];
    const client = String(body?.client || ""), from = String(body?.from || "").replace(/-/g, ""), to = String(body?.to || "").replace(/-/g, "");
    if (!client || !/^\d{8}$/.test(from) || !/^\d{8}$/.test(to) || from > to) return [400, { ok: false, error: "Give the client and the period (from, to)." }];
    const nMonths = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(4, 6) - +from.slice(4, 6)) + 1;
    if (nMonths > NOW_MONTHS) return [400, { ok: false, error: "A period of at most " + NOW_MONTHS + " months." }];
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + enc(user.id)).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return [403, { ok: false, kind: "firm", error: "This account is not part of a firm." }];
    const gate = await firmGate(viaRest(rest, SERVICE), String(member.firm_id || ""), client);
    if (gate) return [gate.status, { ok: false, kind: "paused", reason: gate.reason, error: gate.error }];
    const iso = (d: string) => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6);
    const args = from + "|" + to, t0 = Date.now();
    let n: any;
    try { n = await rpc("tally_now", { p_client: client, p_from: iso(from), p_to: iso(to) }, jwt); }
    catch (e) { return [500, { ok: false, error: "the figures could not be worked out: " + String((e as Error).message || e).slice(0, 200) }]; }
    if (!n || n.none) return [404, { ok: false, kind: "none", error: "FinCom's cloud has no books of this client for that period." }];
    const whole = (r: any) => r && Number(r.v) >= NOW_V && r.partial === false && r.misV === MIS_V;
    if (n.kept && whole(n.result)) return [200, { ok: true, kept: true, at: n.at, result: n.result }];
    // tally_now's figures: worked out now, or those of a kept answer that is not whole (the same version of the books)
    const figures: any = {};
    for (const k of FIGURES) figures[k] = n.kept ? (k === "book" || k === "version" ? n[k] : (n.result || {})[k]) : n[k];
    // the day Tally's balances are taken to (b.tb.to: the day the books are brought in), for the control
    const today = istIso(now());
    const errors: Record<string, string> = {};
    // at most PART_AT_ONCE parts asked at a time (each is a database connection and up to a second of its time)
    const got: any[] = new Array(SQL_PARTS.length).fill(null);
    let nextPart = 0;
    const worker = async () => {
      while (nextPart < SQL_PARTS.length) {
        const i = nextPart++, p = SQL_PARTS[i];
        got[i] = await rpc("tally_mis_part", { p_client: client, p_part: p, p_from: iso(from), p_to: iso(to), p_today: today }, jwt)
          .catch((e) => { errors[p] = String((e as Error).message || e).slice(0, 200); return null; });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_AT_ONCE, SQL_PARTS.length) }, worker));
    // each part as worked out on the same book as tally_now's (the book for the period's last day)
    const part: Record<string, any> = {};
    SQL_PARTS.forEach((p, i) => {
      const g = got[i];
      part[p] = g && !g.none && g.book === figures.book && g.result ? g.result : null;
      if (!part[p] && !errors[p]) errors[p] = g && g.book && g.book !== figures.book ? "worked out on another book" : "not worked out";
    });
    // a book without its ledger masters: sales are the browser's (the taxable value of the sale entries), and so are the
    // sales of the period before, last year, the month and the year to date (their totals are none here)
    if (part.sales && part.sales.masters === false) {
      const why = part.sales.why || "no ledger masters";
      for (const p of ["sales", "prev", "ly", "tops"]) { errors[p] = why; part[p] = null; }
    }
    const sales = part.sales, pl = part.pl, cash = part.cash, comp = part.comp, tops = part.tops;
    const purchases = part.purchases ? (({ goods: _g, ...rest }: any) => rest)(part.purchases) : null;
    const goods = part.purchases ? !!part.purchases.goods : null;
    // MIS.runNow: the days in the period; revenue from operations (the profit and loss's, else the sales); days of sales
    // and of purchases owed, never below nought, purchases only for a client that buys goods
    const days = Math.round((Date.parse(iso(to)) - Date.parse(iso(from))) / 86400000) + 1;
    const revOps = (pl && pl.heads && pl.heads.rev && pl.heads.rev.t) || (sales ? sales.total : 0);
    const oweR = (figures.recv && figures.recv.sum && figures.recv.sum.owe) || 0, oweP = (figures.pay && figures.pay.sum && figures.pay.sum.owe) || 0;
    const later = SQL_PARTS.filter((p) => !part[p]);
    const result = { v: NOW_V, misV: MIS_V, kind: NOW_KIND, partial: later.length > 0, parts: NOW_PARTS, later, outside: OUTSIDE, ...(later.length ? { errors } : {}), at: now().toISOString(), ...figures,
      sales, purchases, goods, pl,
      prev: part.prev ? part.prev.cmp : null, ly: part.ly ? part.ly.cmp : null,
      prevRange: part.prev ? part.prev.range : null, lyRange: part.ly ? part.ly.range : null,
      mtd: tops ? tops.mtd : null, ytd: tops ? tops.ytd : null,
      cash: cash ? cash.cash : null, p2: { cash: cash ? cash.flow : null },
      // GST: paid from the bank here; out, itc, rcm, carry and due come from the GST 3B helper
      comp: comp ? { gst: comp.gst, tds: comp.tds, tdsRoll: comp.tdsRoll, audit: null } : null,
      msme: part.msme ? part.msme.rows : null, msmeDays: part.msme ? part.msme.days : null,
      control: part.control ? part.control.control : null,
      dso: sales && pl && oweR > 0 && revOps > 0 ? Math.round(oweR / (revOps / days)) : null,
      dpo: goods && oweP > 0 && purchases && purchases.total > 0 ? Math.round(oweP / (purchases.total / days)) : null,
    };
    const ms = Date.now() - t0;
    // only a whole answer is kept (a part left to the browser: given back, never kept)
    if (!result.partial) await rpc("tally_calc_put", { p_book: figures.book, p_kind: NOW_KIND, p_args: args, p_version: figures.version, p_result: result, p_ms: ms }).catch(() => null);
    return [200, { ok: true, kept: false, ms, result }];
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
    if (action === "now") return reply(...(await misNow(body, jwt)));
    if (action !== "run") return reply(400, { ok: false, error: "Unknown action." });
    if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    if ((await rpc("mfa_ok", {}, jwt).catch(() => false)) !== true) return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." });
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + enc(user.id)).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    if (!["owner", "staff"].includes(member.role)) return reply(403, { ok: false, kind: "role", error: "Look-only access: ask the firm's owner or staff to run it." });
    const s = ((await rest("/rest/v1/mis_schedules?select=*&id=eq." + enc(String(body.schedule_id || "")) + "&firm_id=eq." + enc(member.firm_id)).catch(() => [])) || [])[0];
    if (!s) return reply(404, { ok: false, error: "No such schedule in your firm." });
    // M5: Run now, a few times in ten minutes at most for one schedule (the count cannot be reached: the run goes on; the
    // day's email count is the limit on what is sent)
    const fits = await rpc("auth_rate_hit", { p_bucket: "mis-run-now", p_key: await sha256hex("mis-run-now:" + s.id), p_max: RUN_NOW.max, p_window_s: RUN_NOW.windowS }).catch(() => true);
    if (fits === false) return reply(429, { ok: false, kind: "rate", error: "This report was run a few times just now. Try again in ten minutes." });
    const r = await runOne(s, "person");
    return reply(r.ok ? 200 : 500, r);
  };
}
