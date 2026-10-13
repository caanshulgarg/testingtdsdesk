// bank-scrub: ONE-TIME staging service (owner's decisions of 12-Oct and 13-Oct-2026). Takes salary payments' bank details out of
// what FinCom kept before bridge 2.4.4, with 2.4.4's own rule: dropBankDetails from ../tally-cloud/parse.js (this branch is cut
// from 325ef1086, the 2.4.4 build commit; parse.js and _shared/names.js unchanged). Places: the tally-days bucket, the
// tally-uploads bucket (text Day Books only), pgmq.a_tally_work archived messages (day files and upload pieces). The
// tally-support zip is only inspected. An object is saved back to the SAME path / row only when every check passes:
// same entries (voucher count, every amount, ledger and date), same per-day trial balance (parse.js), and the new text is the
// old text with only whole 2.4.4 tags cut out. Nothing is deleted. Replies carry counts, paths and ids only: never a value.
// Access: verify_jwt, plus a one-time token whose SHA-256 is given to start() by the deploy wrapper (the function secret
// BANKSCRUB_TOKEN_SHA256 when set wins); everything else is refused. The token itself is never in the repo or the deploy.
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.4";
import { unzipSync } from "npm:fflate@0.8.2";
import { parseDay, dropBankDetails } from "../tally-cloud/parse.js";

const ALWAYS = ["ACCOUNTNUMBER", "IFSCODE", "PAYMENTFAVOURING"];
const EMP_ONLY = ["BANKNAME", "BANKBRANCHNAME", "BENEFICIARYCODE", "SWIFTCODE", "BANKPARTYNAME"];
const BIG = 3_000_000; // characters: above this the entry checks run on the changed entries (the rest is proven byte-identical)

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

// ---------- encoding: gzip or not, UTF-16LE or UTF-8, BOM or not, all kept
type Meta = { gz: boolean; enc: "utf-8" | "utf-16le"; bom: boolean };
async function gunzip(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
async function gzip(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
function isText(raw: Uint8Array) {
  if (raw[0] === 0x50 && raw[1] === 0x4b) return false;                       // a zip (xlsx)
  if (raw[0] === 0xd0 && raw[1] === 0xcf) return false;                       // an OLE file (xls)
  return true;
}
async function decode(buf: Uint8Array): Promise<{ meta: Meta; text: string } | null> {
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  const raw = gz ? await gunzip(buf) : buf;
  if (!isText(raw)) return null;
  let enc: Meta["enc"], bom = false;
  if (raw[0] === 0xff && raw[1] === 0xfe) { enc = "utf-16le"; bom = true; }
  else if (raw[0] === 0xfe && raw[1] === 0xff) return null;
  else if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) { enc = "utf-8"; bom = true; }
  else enc = raw.length > 1 && raw[1] === 0 && raw[0] !== 0 ? "utf-16le" : "utf-8";
  try { return { meta: { gz, enc, bom }, text: new TextDecoder(enc, { ignoreBOM: false, fatal: true }).decode(raw) }; } catch { return null; }
}
async function encode(meta: Meta, text: string) {
  let body: Uint8Array;
  if (meta.enc === "utf-16le") { body = new Uint8Array(text.length * 2); for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); body[2 * i] = c & 255; body[2 * i + 1] = c >> 8; } }
  else body = new TextEncoder().encode(text);
  if (meta.bom) { const p = meta.enc === "utf-16le" ? [0xff, 0xfe] : [0xef, 0xbb, 0xbf]; const b = new Uint8Array(p.length + body.length); b.set(p); b.set(body, p.length); body = b; }
  return meta.gz ? await gzip(body) : body;
}

// ---------- the checks
function facts(text: string) {
  const r = parseDay(text);
  const vs = r.vouchers.map((v: unknown) => JSON.stringify(v)).sort();
  const ls = r.lines.map((l: unknown) => JSON.stringify(l)).sort();
  const dateOf = new Map(r.vouchers.map((v: any) => [v.guid, v.date]));
  const tb = new Map<string, number>();
  for (const l of r.lines as any[]) { const k = dateOf.get(l[0]) + "|" + l[1]; tb.set(k, Math.round(((tb.get(k) || 0) + Number(l[2])) * 100) / 100); }
  return { n: r.n as number, skipped: r.skipped as number, vs, ls, tbs: [...tb].map(([k, a]) => k + "=" + a.toFixed(2)).sort() };
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const rawCount = (t: string) => (t.match(/<VOUCHER\b/g) || []).length;
function elem(t: string) { return new RegExp("<" + t + "(?:\\s[^>]*)?/>|<" + t + "(?:\\s[^>]*)?>[\\s\\S]*?</" + t + "\\s*>", "y"); }
// the new text is the old text with only whole allowed elements cut out
function onlyTagsRemoved(a: string, b: string): Record<string, number> | null {
  const removed: Record<string, number> = {}; let i = 0, j = 0;
  while (i < a.length) {
    if (j < b.length && a.charCodeAt(i) === b.charCodeAt(j)) { i++; j++; continue; }
    const k = a.lastIndexOf("<", i); if (k < 0) return null;
    j -= i - k; i = k;
    let hit: [string, number] | null = null;
    for (const t of [...ALWAYS, ...EMP_ONLY]) { const re = elem(t); re.lastIndex = i; const m = re.exec(a); if (m) { hit = [t, m[0].length]; break; } }
    if (!hit) return null;
    removed[hit[0]] = (removed[hit[0]] || 0) + 1; i += hit[1];
  }
  return j === b.length ? removed : null;
}
// what 2.4.4 would still take out (0 everywhere when clean)
function leftover(text: string) {
  const out: Record<string, number> = {};
  for (const t of ALWAYS) { const n = (text.match(new RegExp("<" + t + "[\\s/>]", "g")) || []).length; if (n) out[t] = n; }
  if (/BANKEMPLOYEENAME/.test(text)) for (const b of text.match(/<BANKALLOCATIONS\.LIST(?:\s[^>]*)?>[\s\S]*?<\/BANKALLOCATIONS\.LIST\s*>/g) || []) {
    if (!/<BANKEMPLOYEENAME(?:\s[^>]*)?>\s*[^<\s]/.test(b)) continue;
    for (const t of EMP_ONLY) if (new RegExp("<" + t + "[\\s/>]").test(b)) out[t] = (out[t] || 0) + 1;
  }
  return out;
}
const vre = () => /<VOUCHER\b[\s\S]*?<\/VOUCHER>/g;
// scrub one text and prove it; checks false => the caller saves nothing
function scrubText(text: string) {
  const clean = dropBankDetails(text) as string;
  if (clean === text) return { changed: false as const, clean };
  const removed = onlyTagsRemoved(text, clean);
  let entries = false, tb = false, mode = "whole", vouchers = 0;
  if (rawCount(text) === rawCount(clean)) {
    let a = text, b = clean;
    if (text.length > BIG) { // only the entries that changed are read; every other byte is proven identical above
      mode = "changed-entries";
      const va = text.match(vre()) || [], vb = clean.match(vre()) || [];
      if (va.length === vb.length) { const ia: string[] = [], ib: string[] = []; va.forEach((x, k) => { if (x !== vb[k]) { ia.push(x); ib.push(vb[k]); } }); a = ia.join(""); b = ib.join(""); }
      else { a = "x"; b = "y"; }
    }
    const f0 = facts(a), f1 = facts(b);
    vouchers = f0.n;
    entries = f0.n === f1.n && f0.skipped === f1.skipped && same(f0.vs, f1.vs) && same(f0.ls, f1.ls);
    tb = same(f0.tbs, f1.tbs);
  }
  const left = leftover(clean);
  const checks = { voucherCount: rawCount(text) === rawCount(clean), entries, trialBalance: tb, onlyTagsRemoved: !!removed, noneLeft: Object.keys(left).length === 0 };
  return { changed: true as const, clean, ok: Object.values(checks).every(Boolean), checks, removed: removed || {}, left, mode, vouchers, rawVouchers: rawCount(text) };
}
function addTo(t: Record<string, number>, r: Record<string, number>) { for (const k in r) t[k] = (t[k] || 0) + r[k]; }

// ---------- a stored object
async function doObject(bucket: string, name: string, apply: boolean, tot: any) {
  const [o] = await sql`select (metadata->>'mimetype') mime, updated_at from storage.objects where bucket_id = ${bucket} and name = ${name}`;
  if (!o) { tot.missing.push(name); return; }
  const { data, error } = await db.storage.from(bucket).download(name);
  if (error || !data) { tot.unread.push(name); return; }
  const buf = new Uint8Array(await data.arrayBuffer());
  const d = await decode(buf);
  if (!d) { tot.notText.push(name); return; }
  tot.read++;
  const r = scrubText(d.text);
  if (!r.changed) { tot.clean++; return; }
  tot.withTags++; addTo(tot.removed, r.removed); tot.vouchersInChanged += r.vouchers;
  if (!r.ok) { tot.failed.push({ name, checks: r.checks, left: r.left }); return; }
  const out = await encode(d.meta, r.clean);
  const back = await decode(out);                                                // written bytes read back the same way
  if (!back || back.text !== r.clean || JSON.stringify(back.meta) !== JSON.stringify(d.meta)) { tot.failed.push({ name, checks: { encoding: false } }); return; }
  tot.passed++;
  if (!apply) return;
  const [o2] = await sql`select updated_at from storage.objects where bucket_id = ${bucket} and name = ${name}`;
  if (!o2 || +o2.updated_at !== +o.updated_at) { tot.changedMeanwhile.push(name); return; }   // a newer write (2.4.4, clean) wins
  const up = await db.storage.from(bucket).upload(name, out, { upsert: true, contentType: o.mime || "application/octet-stream" });
  if (up.error) { tot.failed.push({ name, checks: { upload: false } }); return; }
  tot.written.push(name);
}
const newTot = () => ({ read: 0, clean: 0, withTags: 0, passed: 0, vouchersInChanged: 0, removed: {} as Record<string, number>, written: [] as string[],
  failed: [] as any[], notText: [] as string[], unread: [] as string[], missing: [] as string[], changedMeanwhile: [] as string[] });

// ---------- an archived queue message: day files (days[].gz / .b64) and upload pieces (upload.tail, upload.pend[day][])
async function scrubMessage(m: any) {
  const res = { changed: false, ok: true, checks: [] as any[], removed: {} as Record<string, number>, parts: 0 };
  const take = (r: ReturnType<typeof scrubText>) => { res.parts++; if (!r.changed) return; res.changed = true; addTo(res.removed, r.removed); if (!r.ok) { res.ok = false; res.checks.push(r.checks); } };
  const msg = structuredClone(m);
  if (Array.isArray(msg.days)) for (const d of msg.days) {
    if (typeof d?.gz === "string") {
      const raw = Uint8Array.from(atob(d.gz), (c) => c.charCodeAt(0));
      const t = await decode(raw); if (!t) { res.ok = false; res.checks.push({ day: "not text" }); continue; }
      const r = scrubText(t.text); take(r);
      if (r.changed && r.ok) { const out = await encode(t.meta, r.clean); const back = await decode(out); if (!back || back.text !== r.clean) { res.ok = false; continue; }
        let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000)); d.gz = btoa(s); }
    } else if (typeof d?.b64 === "string") {
      const raw = Uint8Array.from(atob(d.b64), (c) => c.charCodeAt(0)); const t = new TextDecoder("utf-8").decode(raw);
      const r = scrubText(t); take(r);
      if (r.changed && r.ok) { const out = new TextEncoder().encode(r.clean); let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000)); d.b64 = btoa(s); }
    }
  }
  const u = msg.upload;
  if (u && typeof u === "object") {
    if (typeof u.tail === "string") { const r = scrubText(u.tail); take(r); if (r.changed && r.ok) u.tail = r.clean; }
    if (u.pend && typeof u.pend === "object") for (const day of Object.keys(u.pend)) {
      if (!Array.isArray(u.pend[day])) continue;
      u.pend[day] = u.pend[day].map((v: unknown) => { if (typeof v !== "string") return v; const r = scrubText(v); take(r); return r.changed && r.ok ? r.clean : v; });
    }
  }
  // the whole message: nothing but those strings changed, and nothing of 2.4.4's list is left
  const left = leftover(JSON.stringify(msg));
  if (res.changed && Object.keys(left).length) { res.ok = false; res.checks.push({ left }); }
  return { ...res, msg };
}
async function doMessages(ids: number[] | null, apply: boolean) {
  const rows = ids ? await sql`select msg_id, message, md5(message::text) h from pgmq.a_tally_work where msg_id = any(${ids}) order by msg_id`
                   : await sql`select msg_id, message, md5(message::text) h from pgmq.a_tally_work where message ? 'days' or message ? 'upload' order by msg_id`;
  const tot = { read: 0, clean: 0, withTags: 0, passed: 0, removed: {} as Record<string, number>, written: [] as number[], failed: [] as any[], copyTest: [] as any[], changedMeanwhile: [] as number[] };
  for (const row of rows) {
    tot.read++;
    const r = await scrubMessage(row.message);
    if (!r.changed) { tot.clean++; continue; }
    tot.withTags++; addTo(tot.removed, r.removed);
    if (!r.ok) { tot.failed.push({ msg_id: row.msg_id, checks: r.checks }); continue; }
    tot.passed++;
    // first on a copy: the same UPDATE on a temporary copy of the row, read back and checked, rolled back
    const copyOk = await sql.begin(async (t: any) => {
      await t`create temp table bs_copy on commit drop as select msg_id, message from pgmq.a_tally_work where msg_id = ${row.msg_id}`;
      const n = await t`update bs_copy set message = ${t.json(r.msg)} where msg_id = ${row.msg_id} returning message`;
      const back = n[0]?.message; const l = back ? leftover(JSON.stringify(back)) : { missing: 1 };
      const keysSame = back && JSON.stringify(Object.keys(back).sort()) === JSON.stringify(Object.keys(row.message).sort());
      await t`drop table bs_copy`;
      return n.length === 1 && Object.keys(l).length === 0 && keysSame;
    });
    tot.copyTest.push({ msg_id: row.msg_id, ok: copyOk });
    if (!copyOk || !apply) continue;
    const done = await sql.begin(async (t: any) => {
      const n = await t`update pgmq.a_tally_work set message = ${t.json(r.msg)} where msg_id = ${row.msg_id} and md5(message::text) = ${row.h} returning message`;
      if (n.length !== 1) return false;
      if (Object.keys(leftover(JSON.stringify(n[0].message))).length) throw new Error("check failed after update: rolled back");
      return true;
    });
    if (done) tot.written.push(row.msg_id); else tot.changedMeanwhile.push(row.msg_id);
  }
  return tot;
}

// ---------- the support zip: inspected only (entry kinds and whether any holds day-book text or the tags)
async function inspectZip(name: string) {
  const { data, error } = await db.storage.from("tally-support").download(name);
  if (error || !data) return { name, unread: true };
  const files = unzipSync(new Uint8Array(await data.arrayBuffer()));
  const kinds: Record<string, number> = {}; let dayFiles = 0, withTags = 0;
  for (const [n, b] of Object.entries(files)) {
    const ext = (n.match(/\.[A-Za-z0-9]+$/)?.[0] || "(none)").toLowerCase(); kinds[ext] = (kinds[ext] || 0) + 1;
    const d = await decode(b as Uint8Array).catch(() => null); if (!d) continue;
    if (/<VOUCHER\b/.test(d.text)) dayFiles++;
    if (Object.keys(leftover(d.text)).length) withTags++;
  }
  return { name, entries: Object.keys(files).length, kinds, dayFiles, withTags };
}

async function sha256hex(s: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function eq(a: string, b: string) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
const reply = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

export function start(wantHash: string) { Deno.serve(async (req) => {
  const want = Deno.env.get("BANKSCRUB_TOKEN_SHA256") || wantHash || "";
  const tok = req.headers.get("x-bankscrub-token") || "";
  if (req.method !== "POST" || !/^[0-9a-f]{64}$/.test(want) || tok.length < 32 || !eq(await sha256hex(tok), want)) return reply(403, { error: "refused" });
  let b: any; try { b = await req.json(); } catch { return reply(400, { error: "json" }); }
  const apply = b.apply === true;
  try {
    if (b.op === "days") {           // tally-days, by name order, offset/limit
      const lim = Math.max(1, Math.min(200, Number(b.limit) || 50)), off = Math.max(0, Number(b.offset) || 0);
      const names = await sql`select name from storage.objects where bucket_id = 'tally-days' order by name offset ${off} limit ${lim}`;
      const tot = newTot();
      for (const r of names) await doObject("tally-days", r.name, apply, tot);
      return reply(200, { op: "days", apply, offset: off, got: names.length, ...tot });
    }
    if (b.op === "upload") {         // one tally-uploads object
      const tot = newTot(); await doObject("tally-uploads", String(b.path || ""), apply, tot);
      return reply(200, { op: "upload", apply, path: b.path, ...tot });
    }
    if (b.op === "msgs") return reply(200, { op: "msgs", apply, ...(await doMessages(Array.isArray(b.ids) ? b.ids.map(Number) : null, apply)) });
    if (b.op === "support") {
      const names = await sql`select name from storage.objects where bucket_id = 'tally-support' order by name`;
      const out = []; for (const r of names) out.push(await inspectZip(r.name));
      return reply(200, { op: "support", zips: out });
    }
    return reply(400, { error: "op" });
  } catch (e) {
    return reply(500, { error: String((e as Error)?.message || e).replace(/<[^>]*>[^<]*/g, "").slice(0, 200) });
  }
}); }
