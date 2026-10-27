// signup v13 (26-Oct-2026): v12 + the app's PKCE challenge passed to Supabase's sign-up (security review M1); the bot-check
// token (Turnstile) passed to Auth's sign-up / recover; limits shared by every running copy (migration 112); throwaway
// email domains get the neutral answer and nothing is sent.
// signup v12 (26-Oct-2026): self-service sign-up again, with the email confirmed before anything is made. Plain module
// with no imports, so the Deno tests (handler_test.ts) run it with fake services; index.ts wires the real ones.
//
// Three ways in:
//  (a) the public form (email, password, name, firm name). The answer is always the same "check your email" (status,
//      body and a floor on the time taken), whether the email is new, already has a login, or is invited, so the
//      function cannot be used to find out who has an account (no 409). Then, after the answer:
//        - an invited email whose login was never used gets a fresh set-password link (as v11); nothing else is asked;
//        - any other email is passed to Supabase Auth's sign-up ("Confirm email" is on): a new email gets Supabase's
//          confirmation link and an unconfirmed login; an email that already has a confirmed login gets nothing.
//      No firm, no credit, no member row is made here.
//  (b) provision ({action: "provision"} with the person's own token): on the first sign-in the app asks for the
//      person's firm. Only a login whose email is confirmed (by Supabase's link, or verified by Google/Microsoft) and
//      that belongs to no firm gets one: its own firm, the person its owner, with the starting credit on the firm's
//      balance and one "credit" line in its wallet (the same path as v10's trial credit). The starting credit is the
//      console's Settings > Billing "start credit" (console_billing_settings().start_credit, paise; migration 119), and
//      SIGNUP_CREDIT (₹10,000, what sign-up gave before) when that cannot be read. The firm's id is derived from
//      the login's id, so however often it is retried, or sent from two tabs at once, there is one firm and one credit.
//  (c) the platform administrator (a platform_admins login, two-step sign-in done) may create a firm and its owner (v11).
// Earlier: v10 (kept as v10-deployed.ts.txt) made a firm with trial credit for anyone, unconfirmed, and answered 409
// "already has an account"; v11 was by invitation only.

export const CHECK_EMAIL = "Check your email and click the link to confirm, then sign in.";
export const NEUTRAL = CHECK_EMAIL;
export const TOO_MANY = "Too many tries. Wait a few minutes and try again.";
export const MIN_MS = 700;      // every public answer takes at least this long ...
export const JITTER_MS = 150;   // ... plus up to this much at random
export const SIGNUP_CREDIT = 10000;   // rupees: the starting credit when the console's setting cannot be read
export const MAX_START_CREDIT = 1000000;   // rupees: a setting above this is not believed (the console allows ₹10,00,000)
const RECOVER_AFTER_MS = 120_000;     // a firm older than this with no credit line: its maker was cut off; the line is written

export const normEmail = (s: unknown) => String(s ?? "").trim().toLowerCase();
export const validEmail = (s: string) => s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
export const validPassword = (s: string) => s.length >= 10 && s.length <= 72 && /[A-Za-z]/.test(s) && /\d/.test(s);

// counts per key in a sliding window (per running copy of the function: a first line of defence, not a global quota)
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  hit(key: string): boolean {   // true: allowed (and counted)
    const t = this.now(), from = t - this.windowMs;
    const list = (this.hits.get(key) || []).filter((x) => x > from);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(t); this.hits.set(key, list);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
    return true;
  }
}

// the firm a login's sign-up makes has this id: sha-256 of the login's id, shaped as a uuid (version 8). Inserting it
// twice fails on firms' primary key, which is what keeps it to one firm per login.
export async function ownFirmId(userId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fincom-signup-firm:" + userId)));
  h[6] = (h[6] & 0x0f) | 0x80; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export type AdminCaller = { userId: string };
export type CreateFirm = { email: string; password: string; firm: string; name: string; credit: number; plan: string };
// challenge: the app's PKCE code_challenge (S256, 43 characters of base64url; "" when absent or malformed), passed to
// Supabase's sign-up so the email's link signs in only the browser that registered (security review of 26-Oct-2026, M1)
// captcha: the page's bot-check token (Cloudflare Turnstile; "" without one), checked by Supabase Auth once its bot protection is on
export type SignUpForm = { email: string; password: string; name: string; firm: string; redirect: string; challenge: string; captcha: string };
export const validChallenge = (s: unknown) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
// the signed-in person, as Supabase Auth has them now. firm: the firm name typed on the form (user_metadata; empty for
// Google/Microsoft); signupFirm: the firm a provision already made for this login (app_metadata, only the server writes it)
export type AuthUser = { id: string; email: string; confirmed: boolean; name: string; firm: string; provider: string; signupFirm: string | null };
export interface Db {
  memberOf(userId: string): Promise<string | null>;                 // the firm of the login's member row (active or not)
  memberEmailElsewhere(email: string, userId: string): Promise<boolean>;   // a member row with this email under another login
  isPlatformAdmin(userId: string): Promise<boolean>;
  firm(id: string): Promise<{ createdAt: number; balance?: number } | null>;
  // the console's starting credit in rupees (Settings > Billing; migration 119); may throw or be missing: SIGNUP_CREDIT then
  startCredit?(): Promise<number>;
  insertFirm(row: { id: string; name: string; balance: number; note: string }): Promise<boolean>;   // false: the id exists
  deleteFirm(id: string): Promise<void>;
  insertMember(row: { user_id: string; firm_id: string; name: string; email: string; role: string; active: boolean }): Promise<boolean>;   // false: the login has a row
  hasOpeningCredit(firmId: string): Promise<boolean>;
  insertOpeningCredit(firmId: string, amount: number, byUser: string): Promise<void>;
  afterCreate(firmId: string, userId: string, detail: string): Promise<void>;   // the plan's per-client price, the activity line
  markUser(u: AuthUser, firmId: string): Promise<void>;
}
export interface Deps {
  // the caller's token belongs to a platform administrator who finished two-step sign-in; null otherwise
  platformAdmin(jwt: string): Promise<AdminCaller | null>;
  // the email has an active member row whose login was never used (an invite not yet taken up)
  invitePending(email: string): Promise<boolean>;
  // emails a link to set the password (the same link as "forgot password"); captcha: the page's bot-check token
  sendSetPasswordLink(email: string, captcha?: string): Promise<void>;
  // the administrator's path: firm, owner login and member row; detailed answer (the caller is the administrator)
  createFirm(by: AdminCaller, f: CreateFirm): Promise<{ status: number; body: Record<string, unknown> }>;
  // Supabase Auth's own sign-up ("Confirm email" on): an unconfirmed login and the confirmation email, or nothing
  authSignUp(f: SignUpForm): Promise<void>;
  // the person a token belongs to; null when it is not a valid sign-in
  authUser(jwt: string): Promise<AuthUser | null>;
  db: Db;
  // work that may finish after the answer is sent (EdgeRuntime.waitUntil)
  background(p: Promise<unknown>): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
  limits: { ip: RateLimiter; email: RateLimiter; link: RateLimiter; provision: RateLimiter };
  // 26-Oct-2026: CAPTCHA_REQUIRED=1 (Supabase Auth's bot protection on): a form without a bot-check token is refused here
  captchaRequired?: boolean;
  // the counts shared by every running copy (public.auth_rate_hits, migration 112): true = allowed (and counted). The key
  // is a SHA-256. May throw (the migration not run yet): the form then goes on with the in-memory limits alone
  rateHit?(bucket: string, key: string, max: number, windowS: number): Promise<boolean>;
  // more throwaway email domains (the DISPOSABLE_DOMAINS secret, comma-separated), on top of DISPOSABLE
  extraDisposable?: string[];
}

// throwaway email domains (a short fixed list of the commonest; the secret DISPOSABLE_DOMAINS adds more): the same
// "check your email" answer, and nothing is sent. A subdomain of one counts as it
export const DISPOSABLE = ["mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "grr.la", "10minutemail.com",
  "temp-mail.org", "tempmail.com", "tempmail.dev", "tempmailo.com", "throwawaymail.com", "yopmail.com", "yopmail.net", "trashmail.com",
  "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mailnesia.com", "mintemail.com", "fakeinbox.com", "emailondeck.com",
  "mohmal.com", "moakt.com", "mail.tm", "mail.gw", "spamgourmet.com", "burnermail.io", "inboxkitten.com", "tmpmail.org", "tmail.ws"];
export function disposable(email: string, extra: string[] = []): boolean {
  const dom = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return [...DISPOSABLE, ...extra.map((x) => x.trim().toLowerCase()).filter(Boolean)].some((d) => dom === d || dom.endsWith("." + d));
}
export const BOT_MISSING = "Complete the check that you are not a robot, then try again.";
export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// the shared limits (migration 112): signup-ip 10 per 10 minutes, signup-email 5 per hour, as the in-memory ones
export const SHARED = { ip: { max: 10, windowS: 600 }, email: { max: 5, windowS: 3600 } };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim() || "unknown";

// "<name>'s firm" for a Google/Microsoft sign-up (no firm-name box there); the owner can rename it in Settings
export function firmNameFor(u: AuthUser): string {
  const typed = String(u.firm || "").trim();
  if (typed.length >= 2) return typed.slice(0, 160);
  const who = String(u.name || "").trim() || u.email.split("@")[0];
  return (who + "'s firm").slice(0, 160);
}

// the starting credit (rupees): the console's setting, else SIGNUP_CREDIT
export async function startCredit(db: Db): Promise<number> {
  try {
    const v = db.startCredit ? await db.startCredit() : NaN;
    if (typeof v === "number" && isFinite(v) && v >= 0 && v <= MAX_START_CREDIT) return Math.round(v * 100) / 100;
  } catch { /* migration 119 not run yet, or the database did not answer: the old amount */ }
  return SIGNUP_CREDIT;
}

export async function provisionFirm(db: Db, u: AuthUser, now: number): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!u.confirmed || !u.email) return { status: 403, body: { ok: false, reason: "not_confirmed", error: "Confirm your email first: open the link we sent you, then sign in." } };
  const mine = await db.memberOf(u.id);
  if (mine) return { status: 200, body: { ok: true, created: false, firm_id: mine } };
  // the email is a member of a firm under another login (an invite): that login is the way in; nothing is made
  if (await db.memberEmailElsewhere(u.email, u.id)) return { status: 403, body: { ok: false, reason: "member_elsewhere", error: "This email already belongs to a firm’s login. Sign in with the email and password of the invitation, or ask your firm’s owner." } };
  if (await db.isPlatformAdmin(u.id)) return { status: 403, body: { ok: false, reason: "no_firm", error: "This account is not linked to a firm." } };
  const id = await ownFirmId(u.id);
  let existing = await db.firm(id);
  // a sign-up firm that was made once and later closed is not made again
  if (u.signupFirm && (u.signupFirm !== id || !existing)) return { status: 403, body: { ok: false, reason: "closed", error: "This account's firm was closed. Ask the administrator." } };
  let created = false;
  const credit = existing ? null : await startCredit(db);
  if (!existing) {
    created = await db.insertFirm({ id, name: firmNameFor(u), balance: credit!, note: "Signed up (" + (u.provider || "email") + ", email confirmed)" });
    if (!created) existing = await db.firm(id);        // made by a call running at the same time
  }
  await db.markUser(u, id);
  // the credit line, before the member row (the app asks again while the person has no member row, so a call cut off
  // anywhere before that is finished by the next one): written by the call that made the firm; by a later call only
  // when it is missing well after the firm was made (its maker was cut off); a young firm without it: "try again"
  let writeCredit = created;
  if (!created && !(await db.hasOpeningCredit(id))) {
    if (!existing || now - existing.createdAt <= RECOVER_AFTER_MS) return { status: 503, body: { ok: false, reason: "retry", error: "Your firm is being set up. Try again in a minute." } };
    writeCredit = true;
  }
  if (writeCredit) {
    // the line matches the balance the firm was made with (a later call that finishes it reads that balance)
    const amount = created ? credit! : (typeof existing?.balance === "number" ? existing.balance : await startCredit(db));
    await db.insertOpeningCredit(id, amount, u.id);
    await db.afterCreate(id, u.id, (firmNameFor(u) + " owner " + u.email + " (signup, " + (u.provider || "email") + ")").slice(0, 500));
  }
  const joined = await db.insertMember({ user_id: u.id, firm_id: id, name: String(u.name || "").slice(0, 120), email: u.email, role: "owner", active: true });
  if (!joined) {
    const other = await db.memberOf(u.id);
    if (other && other !== id) {          // joined another firm meanwhile (an invite taken up): this one is not needed
      if (created) await db.deleteFirm(id);
      return { status: 200, body: { ok: true, created: false, firm_id: other } };
    }
  }
  return { status: 200, body: created ? { ok: true, created, firm_id: id, credit } : { ok: true, created, firm_id: id } };
}

export function makeHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
    const started = d.now();
    // public answers never come before the time floor
    const floor = async (status: number, body: Record<string, unknown>) => {
      const wait = started + MIN_MS + Math.floor(d.random() * JITTER_MS) - d.now();
      if (wait > 0) await d.sleep(wait);
      return json(status, body);
    };
    const neutral = () => floor(200, { ok: true, reason: "check_email", message: CHECK_EMAIL });
    const tooMany = () => floor(429, { ok: false, reason: "rate_limited", error: TOO_MANY });
    const bad = (error: string) => floor(400, { ok: false, reason: "invalid", error });

    let body: any = {};
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body !== "object") return json(400, { ok: false, error: "Bad request" });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const email = normEmail(body.email);

    // (b) provision: the signed-in person's own firm
    if (body.action === "provision") {
      if (!d.limits.provision.hit(clientIp(req))) return json(429, { ok: false, reason: "rate_limited", error: TOO_MANY });
      let u: AuthUser | null = null;
      try { u = jwt ? await d.authUser(jwt) : null; } catch { u = null; }
      if (!u) return json(401, { ok: false, reason: "signed_out", error: "Sign in first." });
      try {
        const r = await provisionFirm(d.db, u, d.now());
        return json(r.status, r.body);
      } catch {
        return json(500, { ok: false, reason: "retry", error: "Your firm could not be set up just now. Sign in again in a minute." });
      }
    }

    // (c) the platform administrator
    if (jwt) {
      let by: AdminCaller | null = null;
      try { by = await d.platformAdmin(jwt); } catch { by = null; }
      if (by) {
        const f: CreateFirm = {
          email, password: String(body.password || ""), firm: String(body.firm || "").trim().slice(0, 160),
          name: String(body.name || "").trim().slice(0, 120),
          credit: Math.max(0, Number(body.credit) || 0), plan: String(body.plan || ""),
        };
        if (!validEmail(email)) return json(400, { ok: false, error: "That email address does not look right." });
        if (f.firm.length < 2) return json(400, { ok: false, error: "Enter the name of the firm." });
        if (f.password && f.password.length < 10) return json(400, { ok: false, error: "Use a password of 10 characters or more, or leave it empty to have one made." });
        const r = await d.createFirm(by, f);
        return json(r.status, r.body);
      }
      // a token that is not the administrator's: treated as anyone else
    }

    // (a) the public form. Rate limits by address and by email; the answers depend only on what was typed
    if (!d.limits.ip.hit(clientIp(req))) return tooMany();
    const form: SignUpForm = {
      email, password: String(body.password || ""), name: String(body.name || "").trim().slice(0, 120),
      firm: String(body.firm || "").trim().slice(0, 160),
      redirect: /^https?:\/\/[^\s"'<>]{1,300}$/.test(String(body.redirect || "")) ? String(body.redirect) : "",
      challenge: validChallenge(body.challenge) ? String(body.challenge) : "",
      captcha: typeof body.captcha_token === "string" ? body.captcha_token.trim().slice(0, 4096) : "",
    };
    if (!validEmail(email)) return bad("That email address does not look right.");
    if (!validPassword(form.password)) return bad("Use a password of 10 characters or more, with letters and digits.");
    if (form.firm.length < 2) return bad("Enter the name of your firm.");
    if (!d.limits.email.hit(email)) return tooMany();
    if (d.captchaRequired && !form.captcha) return floor(400, { ok: false, reason: "captcha", error: BOT_MISSING });
    // across every running copy (a bot spread over them, or waiting for a fresh one, is counted all the same)
    if (d.rateHit) {
      try {
        if (!(await d.rateHit("signup-ip", await sha256hex("signup-ip:" + clientIp(req)), SHARED.ip.max, SHARED.ip.windowS))) return tooMany();
        if (!(await d.rateHit("signup-email", await sha256hex("signup-email:" + email), SHARED.email.max, SHARED.email.windowS))) return tooMany();
      } catch { /* migration 112 not run yet: the in-memory limits above still hold */ }
    }
    // a throwaway address: the same answer, nothing sent
    if (disposable(email, d.extraDisposable || [])) return neutral();

    // after the answer: an invite gets a fresh set-password link (at most one per email per window), anyone else goes
    // to Supabase Auth's sign-up (its confirmation email; nothing for a confirmed email)
    let pending = false;
    try { pending = await d.invitePending(email); } catch { pending = false; }
    if (pending) { if (d.limits.link.hit(email)) d.background(d.sendSetPasswordLink(email, form.captcha).catch(() => {})); }
    else d.background(d.authSignUp(form).catch(() => {}));
    return neutral();
  };
}
