// TDS Desk admin service: create logins, reset passwords, switch people off, create firms.
// A firm owner may act on their own firm; a superadmin on any firm.
// Hardened Sep 2026 (VAPT review):
//  - an owner can no longer take over someone else's login by typing their email in "add person"
//    (it used to reset that person's password and move them into the owner's firm)
//  - roles are checked; nobody can remove or demote the last owner, or touch a platform administrator
//  - two-step sign-in is required for every admin action; made-up passwords are long and random
//  - every action goes into the firm's audit trail
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "./cors.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ROLES = ["owner", "staff", "readonly"];
// email (review item 21): an invite or a reset link goes through Resend when it is set up (the same secrets as the
// support mail), otherwise through Supabase Auth's own mailer
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
// invites and reset links come from no-reply@fincom.live (the domain must be verified in Resend); INVITE_MAIL_FROM overrides
const FROM = Deno.env.get("INVITE_MAIL_FROM") || "FinCom <no-reply@fincom.live>";
const APP = Deno.env.get("APP_URL") || "https://staging.fincom.live/";
// a link may only send people back to FinCom's own pages
const safeRedirect = (u: unknown) => {
  const s = String(u || "");
  const ok = ["https://staging.fincom.live/", "https://app.fincom.live/", "https://caanshulgarg.github.io/", APP].some((p) => s.startsWith(p));
  return ok ? s : APP;
};
async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  return r.ok;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function madeUpPassword(): string {
  // 16 characters from a 56-letter alphabet (no look-alikes), from the system's secure random source: about 93 bits
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += abc[x % abc.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (code: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in first." });

  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(URL, SERVICE);
  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return reply(403, { ok: false, reason: "mfa", error: "Finish the two-step sign-in first." });

  const { data: me } = await admin.from("members").select("firm_id, role, active").eq("user_id", user.id).maybeSingle();
  const { data: isAdminRow } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  const superadmin = !!isAdminRow;
  const owner = !!me && me.active && me.role === "owner";
  if (!superadmin && !owner) return reply(403, { ok: false, error: "Only a firm owner or the administrator may do this." });

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const action = String(body.action || "");
  const firmId = superadmin && body.firm_id ? String(body.firm_id) : me?.firm_id;
  const email = String(body.email || "").trim().toLowerCase();
  const audit = (what: string, detail: string, firm = firmId) =>
    firm ? admin.from("activity").insert({ firm_id: firm, user_id: user.id, client_id: "", what, detail: detail.slice(0, 500) }).then(() => {}, () => {}) : Promise.resolve();

  const findUser = async (mail: string) => {
    for (let page = 1; page <= 50; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const users = data?.users || [];
      const u = users.find((x: any) => (x.email || "").toLowerCase() === mail);
      if (u) return u;
      if (users.length < 200) return null;
    }
    return null;
  };
  const isPlatformAdmin = async (id: string) => !!(await admin.from("platform_admins").select("user_id").eq("user_id", id).maybeSingle()).data;
  const ownersLeft = async (firm: string, without: string) => {
    const { data } = await admin.from("members").select("user_id").eq("firm_id", firm).eq("role", "owner").eq("active", true);
    return (data || []).filter((m: any) => m.user_id !== without).length;
  };
  // the person must be in the caller's firm (or the caller is the administrator), and never a platform administrator
  const targetInScope = async (mail: string) => {
    const target = await findUser(mail);
    if (!target) return { err: reply(404, { ok: false, error: "No such person." }) };
    const { data: theirs } = await admin.from("members").select("firm_id, role, active").eq("user_id", target.id).maybeSingle();
    if (!superadmin && theirs?.firm_id !== me?.firm_id) return { err: reply(403, { ok: false, error: "That person is not in your firm." }) };
    if (!superadmin && await isPlatformAdmin(target.id)) return { err: reply(403, { ok: false, error: "That person cannot be changed from here." }) };
    return { target, theirs };
  };

  try {
    if (action === "add_person") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { ok: false, error: "A proper email address is needed." });
      const role = ROLES.includes(String(body.role)) ? String(body.role) : "staff";
      let target = await findUser(email);
      let password: string | null = null;
      if (!target) {
        password = String(body.password || "") || madeUpPassword();
        if (password.length < 10) return reply(400, { ok: false, error: "The password must be 10 characters or more." });
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: body.name || "" } });
        if (error) return reply(400, { ok: false, error: error.message });
        target = data.user;
      } else {
        // an existing login is never taken over: it can only be added if it belongs to no firm, and keeps its own password
        const { data: theirs } = await admin.from("members").select("firm_id").eq("user_id", target.id).maybeSingle();
        if (theirs && theirs.firm_id !== firmId) return reply(409, { ok: false, error: "This email already belongs to another firm's login. Ask them to use a different email." });
        if (!superadmin && await isPlatformAdmin(target.id)) return reply(403, { ok: false, error: "That login cannot be added here." });
      }
      const { error: mErr } = await admin.from("members").upsert({
        user_id: target!.id, firm_id: firmId, name: String(body.name || "").slice(0, 120), email, role, active: true,
      });
      if (mErr) return reply(400, { ok: false, error: mErr.message });
      await audit("admin.add_person", email + " as " + role);
      return reply(200, password
        ? { ok: true, email, password, role, note: "Give this password to the person; they can change it in the app." }
        : { ok: true, email, role, note: "This person already had a login: they sign in with their own password." });
    }

    // a new person gets an email with a link to set their own password (no password is made or shown)
    if (action === "invite_person") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { ok: false, error: "A proper email address is needed." });
      const role = ROLES.includes(String(body.role)) ? String(body.role) : "staff";
      const redirectTo = safeRedirect(body.redirect);
      let target = await findUser(email);
      if (target) {
        const { data: theirs } = await admin.from("members").select("firm_id").eq("user_id", target.id).maybeSingle();
        if (theirs && theirs.firm_id !== firmId) return reply(409, { ok: false, error: "This email already belongs to another firm's login. Ask them to use a different email." });
        if (!superadmin && await isPlatformAdmin(target.id)) return reply(403, { ok: false, error: "That login cannot be added here." });
      }
      let sent = "";
      if (!target) {
        if (RESEND) {
          const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo, data: { name: body.name || "" } } });
          if (error) return reply(400, { ok: false, error: error.message });
          target = data.user;
          const link = data.properties?.action_link || "";
          const ok = await sendMail(email, "You are invited to FinCom",
            "<p>" + esc(String(body.name || "Hello")) + ",</p><p>You have been added to your firm's FinCom account. Choose your password here (the link works once, for 24 hours):</p><p><a href=\"" + link + "\">Set my password</a></p>");
          if (!ok) return reply(502, { ok: false, error: "The invitation could not be emailed. Try again, or use “Make a password instead”." });
          sent = "resend";
        } else {
          const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name: body.name || "" } });
          if (error) return reply(400, { ok: false, error: error.message + " (Supabase's own mailer: set up RESEND_API_KEY to send to anyone)" });
          target = data.user;
          sent = "supabase";
        }
      }
      const { error: mErr } = await admin.from("members").upsert({
        user_id: target!.id, firm_id: firmId, name: String(body.name || "").slice(0, 120), email, role, active: true,
      });
      if (mErr) return reply(400, { ok: false, error: mErr.message });
      await audit("admin.invite_person", email + " as " + role + (sent ? " (invited by email)" : " (already had a login)"));
      return reply(200, { ok: true, email, role, invited: !!sent,
        note: sent ? "An email has gone to " + email + " with a link to set their password." : "This person already had a login: they sign in with their own password." });
    }

    // a reset link by email: the person chooses the new password themselves
    if (action === "send_reset") {
      const r = await targetInScope(email); if (r.err) return r.err;
      const redirectTo = safeRedirect(body.redirect);
      if (RESEND) {
        const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
        if (error) return reply(400, { ok: false, error: error.message });
        const ok = await sendMail(email, "Set a new FinCom password",
          "<p>A new password was asked for your FinCom login. Choose it here (the link works once, for an hour):</p><p><a href=\"" + (data.properties?.action_link || "") + "\">Set a new password</a></p><p>If you did not expect this, tell your firm's owner.</p>");
        if (!ok) return reply(502, { ok: false, error: "The reset link could not be emailed." });
      } else {
        const anon = createClient(URL, ANON);
        const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return reply(400, { ok: false, error: error.message });
      }
      await audit("admin.send_reset", email, r.theirs?.firm_id || firmId);
      return reply(200, { ok: true, email, note: "A link to set a new password has gone to " + email + "." });
    }

    // lift a lockout after too many wrong passwords (the lock also ends by itself after 15 minutes)
    if (action === "unlock") {
      const r = await targetInScope(email); if (r.err) return r.err;
      await admin.rpc("auth_lockout_clear", { p_email: email, p_by: user.id });
      await audit("admin.unlock", email, r.theirs?.firm_id || firmId);
      return reply(200, { ok: true, email, note: email + " can sign in again." });
    }

    if (action === "reset_password") {
      const r = await targetInScope(email); if (r.err) return r.err;
      const password = String(body.password || "") || madeUpPassword();
      if (password.length < 10) return reply(400, { ok: false, error: "The password must be 10 characters or more." });
      const { error } = await admin.auth.admin.updateUserById(r.target.id, { password });
      if (error) return reply(400, { ok: false, error: error.message });
      await audit("admin.reset_password", email, r.theirs?.firm_id || firmId);
      return reply(200, { ok: true, email, password });
    }

    if (action === "reset_two_step") {   // a lost phone: removes the person's authenticator entries
      const r = await targetInScope(email); if (r.err) return r.err;
      const { data: f } = await admin.auth.admin.mfa.listFactors({ userId: r.target.id });
      for (const x of f?.factors || []) await admin.auth.admin.mfa.deleteFactor({ userId: r.target.id, id: x.id });
      await audit("admin.reset_two_step", email, r.theirs?.firm_id || firmId);
      return reply(200, { ok: true });
    }

    if (action === "set_person") {   // role, on/off, name
      const r = await targetInScope(email); if (r.err) return r.err;
      const patch: any = {};
      if (body.role !== undefined) { if (!ROLES.includes(String(body.role))) return reply(400, { ok: false, error: "Unknown role." }); patch.role = String(body.role); }
      if (body.active !== undefined) patch.active = !!body.active;
      if (body.name !== undefined) patch.name = String(body.name).slice(0, 120);
      const losesOwner = r.theirs?.role === "owner" && ((patch.role && patch.role !== "owner") || patch.active === false);
      if (losesOwner && await ownersLeft(r.theirs.firm_id, r.target.id) === 0) return reply(400, { ok: false, error: "A firm must keep at least one owner." });
      const { error } = await admin.from("members").update(patch).eq("user_id", r.target.id);
      if (error) return reply(400, { ok: false, error: error.message });
      await audit("admin.set_person", email + " " + JSON.stringify(patch), r.theirs?.firm_id || firmId);
      return reply(200, { ok: true });
    }

    if (action === "remove_person") {
      const r = await targetInScope(email); if (r.err) return r.err;
      if (r.target.id === user.id) return reply(400, { ok: false, error: "You cannot remove yourself." });
      if (r.theirs?.role === "owner" && await ownersLeft(r.theirs.firm_id, r.target.id) === 0) return reply(400, { ok: false, error: "A firm must keep at least one owner." });
      // the login is switched off and taken out of the firm; it is not deleted, so the audit trail keeps its name
      await admin.from("members").update({ active: false }).eq("user_id", r.target.id);
      await admin.auth.admin.updateUserById(r.target.id, { ban_duration: "876000h" });
      await audit("admin.remove_person", email, r.theirs?.firm_id || firmId);
      return reply(200, { ok: true });
    }

    if (action === "create_firm") {
      if (!superadmin) return reply(403, { ok: false, error: "Only the administrator may create a firm." });
      const name = String(body.name || "").trim().slice(0, 160);
      if (!name || !email) return reply(400, { ok: false, error: "A firm name and the owner's email are needed." });
      let target = await findUser(email);
      if (target) {
        const { data: theirs } = await admin.from("members").select("firm_id").eq("user_id", target.id).maybeSingle();
        if (theirs) return reply(409, { ok: false, error: "This email already belongs to a firm's login." });
      }
      const { data: firm, error: fErr } = await admin.from("firms")
        .insert({ name, plan_id: body.plan_id || null, balance: Number(body.credit || 0), note: String(body.note || "").slice(0, 500) })
        .select("id").single();
      if (fErr) return reply(400, { ok: false, error: fErr.message });
      let password: string | null = null;
      if (!target) {
        password = String(body.password || "") || madeUpPassword();
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: body.owner_name || "" } });
        if (error) return reply(400, { ok: false, error: error.message });
        target = data.user;
      }
      await admin.from("members").upsert({ user_id: target!.id, firm_id: firm.id, name: String(body.owner_name || ""), email, role: "owner", active: true });
      if (Number(body.credit || 0) > 0) {
        await admin.from("wallet_entries").insert({ firm_id: firm.id, kind: "credit", code: "wallet", qty: 1, amount: Number(body.credit), balance_after: Number(body.credit), note: "Opening credit", by_user: user.id });
      }
      await audit("admin.create_firm", name + " owner " + email, firm.id);
      return reply(200, password ? { ok: true, firm_id: firm.id, email, password } : { ok: true, firm_id: firm.id, email, note: "The owner already had a login and keeps their password." });
    }

    return reply(400, { ok: false, error: "Unknown action" });
  } catch (_e) {
    return reply(500, { ok: false, error: "The request could not be completed." });
  }
});
