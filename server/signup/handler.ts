// signup (26-Oct-2026, audit H3): sign-up is by invitation only. Plain module with no imports, so the Deno tests
// (handler_test.ts) run it with fake services; index.ts wires the real ones.
//
// Who can get an account through this function:
//  (a) an invited email: the firm's owner already made the login and member row (admin function, invite_person); if
//      that login has never been used, a fresh link to set the password is emailed. Nothing is made here.
//  (b) the platform administrator (a platform_admins login, two-step sign-in done) may create a firm and its owner.
// Everyone else gets NEUTRAL. Every public answer is the same (status, body, and a floor on the time taken), whether
// the email is new, already has a login, or is invited, so the function cannot be used to find out who has an account.
// The earlier version (v10, kept as v10-deployed.ts.txt) made a firm with trial credit for anyone, and answered 409
// "already has an account".

export const NEUTRAL = "Sign-up is by invitation. Ask your firm's owner to invite you.";
export const TOO_MANY = "Too many tries. Wait a few minutes and try again.";
export const MIN_MS = 700;      // every public answer takes at least this long ...
export const JITTER_MS = 150;   // ... plus up to this much at random

export const normEmail = (s: unknown) => String(s ?? "").trim().toLowerCase();
export const validEmail = (s: string) => s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

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

export type AdminCaller = { userId: string };
export type CreateFirm = { email: string; password: string; firm: string; name: string; credit: number; plan: string };
export interface Deps {
  // the caller's token belongs to a platform administrator who finished two-step sign-in; null otherwise
  platformAdmin(jwt: string): Promise<AdminCaller | null>;
  // the email has an active member row whose login was never used (an invite not yet taken up)
  invitePending(email: string): Promise<boolean>;
  // emails a link to set the password (the same link as "forgot password")
  sendSetPasswordLink(email: string): Promise<void>;
  // the administrator's path: firm, owner login and member row; detailed answer (the caller is the administrator)
  createFirm(by: AdminCaller, f: CreateFirm): Promise<{ status: number; body: Record<string, unknown> }>;
  // work that may finish after the answer is sent (EdgeRuntime.waitUntil)
  background(p: Promise<unknown>): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
  limits: { ip: RateLimiter; email: RateLimiter; link: RateLimiter };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim() || "unknown";

export function makeHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
    const started = d.now();
    // the same answer for everyone who is not the administrator, never before the time floor
    const neutral = async (status = 403, error = NEUTRAL, reason = "invite_only") => {
      const wait = started + MIN_MS + Math.floor(d.random() * JITTER_MS) - d.now();
      if (wait > 0) await d.sleep(wait);
      return json(status, { ok: false, reason, error });
    };

    let body: any = {};
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body !== "object") return json(400, { ok: false, error: "Bad request" });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const email = normEmail(body.email);

    // (b) the platform administrator
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

    // rate limits: by address and by email; the answer when over the limit does not depend on the email either
    if (!d.limits.ip.hit(clientIp(req))) return neutral(429, TOO_MANY, "rate_limited");
    if (validEmail(email) && !d.limits.email.hit(email)) return neutral(429, TOO_MANY, "rate_limited");

    // (a) an invited email: a fresh set-password link by email (at most one per email per window), sent after the answer
    if (validEmail(email)) {
      let pending = false;
      try { pending = await d.invitePending(email); } catch { pending = false; }
      if (pending && d.limits.link.hit(email)) d.background(d.sendSetPasswordLink(email).catch(() => {}));
    }
    return neutral();
  };
}
