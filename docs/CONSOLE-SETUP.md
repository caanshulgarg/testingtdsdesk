# FinCom Console: setting up console-staging.fincom.live

The console is FinCom's own admin site (the plan: `console-plan.md`). Phase 1 ("Foundation") is built on branch
`next-console-p1`. This page is the owner's list of clicks and the developer's list of steps, in order.

**Order matters: the lock (Cloudflare Access) goes on before the door (the domain) opens.**

| What | Where |
|---|---|
| The console app | `console/` (React 19 + Vite, its own small app; it never touches the user app or `review/`) |
| Its one server function | `server/console/` (slug `console-admin`, verify_jwt **off**: it checks every call itself) |
| Its database part | `server/console/migration-118-console-foundation.sql` (add-only) |
| The Worker | `fincom-console-staging` (`console/wrangler.jsonc`), static files only |
| The branch Cloudflare deploys from | **`console`**: built files only, written by `console/publish.sh` (see step E) |

---

## Step A. The database (developer or owner, Supabase SQL editor, staging only)

1. Run `server/console/migration-118-console-foundation.sql` (md5 `72c550c8aab0338fd2f67497c2b36a7f`). It is one transaction and safe to run twice.
   It adds `console_admins`, `console_audit` (append-only), the console's functions, and the switch-off columns
   (`firms.status`, `clients.status`, `members.console_off_at`). Nothing is dropped or rewritten.
   - It also wraps `can_write()` so a **suspended or closed firm is read-only**. If the SQL editor shows the notice
     "can_write() is not a one-statement SQL function; left as it is", tell the developer (the firm switch then only
     stops posting to Tally).
2. Make yourself the first console Owner. Run **one** of these, then check that one row came back:
   - from today's platform administrators (staging has one):
     ```sql
     insert into public.console_admins (user_id, role) select user_id, 'owner' from public.platform_admins on conflict (user_id) do nothing returning user_id;
     ```
   - or by your console login's email (the plan recommends a separate login, for example `anshul@fincom.live`; make it
     first by signing up or by an invite):
     ```sql
     insert into public.console_admins (user_id, role) select id, 'owner' from auth.users where lower(email) = 'anshul@fincom.live' on conflict (user_id) do nothing returning user_id;
     ```
   Every later admin is added from the console itself (Admins > Add an admin), which records who added whom.

## Step B. The function (developer)

```
python3 -I scratchpad/fn_deploy.py <checkout> console-admin server/console/index.ts
```
- verify_jwt stays **off** (fn_deploy's default). The function itself checks the token, the two-step level (aal2),
  the admin row, the role, the rate limit, and writes the change history.
- Secrets: none new. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Supabase's own. Optional
  `CONSOLE_ORIGINS` (comma-separated) adds a test address; the console's two addresses are built in.
- Needs migration 112 (`auth_rate_hit`) and 118 on the database. Without 112 every call is refused as "too many".

## Step C. Supabase Auth settings (owner, once)

1. Supabase > **Authentication > URL Configuration > Redirect URLs** > add `https://console-staging.fincom.live/**`
   (and `https://console.fincom.live/**` when going live). Save. Without it, the invite and "Forgot password?" emails'
   links land on the user app (the Site URL) instead of the console.
2. Supabase > **Authentication > Multi-factor** (Sign In / Providers > Multi-Factor): **TOTP (App Authenticator)** must
   be **Enabled**. The console refuses everything until the authenticator code is entered.
3. Emails (Admins > Add an admin for an email with no login, and "Forgot password?" on the console's sign-in) go
   through Supabase Auth's own mailer, which sends only a few an hour on a free project, unless **Authentication >
   Emails > SMTP Settings** is set up (for example with Resend). Too many: the console says to wait an hour.

**Adding a new admin by email.** Admins > Add an admin: type the email, pick the role, give a reason. If the email has
no FinCom login yet, Supabase sends an invitation email; its link opens the console's "Set your password" (10
characters or more, with letters and digits), then the authenticator (QR code) and the code. The person is in no firm
(no member row): a console login only. The change history shows "invited and added as <role>". Also add the email to
the Cloudflare Access list (Step D, 4), or Cloudflare stops them before the console.

## Step D. Cloudflare Access: the lock (owner, once)

1. dash.cloudflare.com > **Zero Trust**. The first time: choose a team name (for example `fincom`) and the **Free** plan.
2. **Settings > Authentication > Login methods**: keep **One-time PIN** (it is there by default).
3. **Access > Applications > Add an application > Self-hosted**:
   - Application name: `FinCom Console (staging)`
   - Session duration: **12 hours**
   - **Add public hostname**: subdomain `console-staging`, domain `fincom.live`
   - Identity providers: tick **One-time PIN**
   - Next.
4. **Add a policy**: name `Admins`, action **Allow**, **Include > Emails** > type your email (and each admin's). Save.
   *Optional:* **Require > IP ranges** with your office and home IPs (read them at
   `https://www.cloudflare.com/cdn-cgi/trace`, the `ip=` line).
5. Finish (**Save application**).

## Step E. The Worker: the door (owner, after the developer says `console` is published)

The developer publishes the built console to the **`console` branch** (built files only, like `main` for the app):
```
sh console/publish.sh --push
```
It builds, checks the build names only the staging project and no secret, and commits `site/`, `wrangler.jsonc`,
`build-site.sh` and a README to `console`. It never touches `main`, `staging-next` or `review/`.

Then, in Cloudflare:
1. **Workers & Pages > Create > Workers > Import a repository** > choose GitHub > this repository
   (`caanshulgarg/testingtdsdesk`) > Next.
2. Project name: `fincom-console-staging`.
3. **Production branch: `console`**. Build command: `sh build-site.sh` (it only checks, nothing is built on that
   branch). Deploy command: `npx wrangler deploy`. **Root directory: `/`** (on the `console` branch the files are at its root).
4. **Advanced > Builds for non-production branches: off.** Create and deploy.
5. **Settings > Domains & Routes > Add > Custom domain** > `console-staging.fincom.live` > **Add domain**. Cloudflare
   makes the DNS record and the certificate in a few minutes.
6. Still under **Domains & Routes**: **workers.dev: Disabled** and **Preview URLs: Disabled** (wrangler.jsonc asks for
   both; check they show so). A workers.dev address would skip Access.
7. Test from a private window:
   - `https://console-staging.fincom.live` shows **Cloudflare's** sign-in first (enter the email, then the PIN mailed to you);
   - then the console's own sign-in (email and password);
   - then the authenticator code (the first time: scan the QR code in your authenticator app).
   - An email not on the Access list is refused by Cloudflare. Leave the console idle for 30 minutes: it signs out.

Why a `console` branch: Cloudflare then deploys exactly the files that were checked, with no npm on its side, the same
way `main` carries the app's built files. A source branch (root directory `console`) also works, because
`build-site.sh` builds when it finds `src/`, but then Cloudflare runs `npm install` on every push.

## What the console does in phase 1

| Screen | Who | What |
|---|---|---|
| Dashboard | all | firms, active people (7 and 30 days), sign-ups, bridges online, failed postings today, AI calls today, credit held |
| Firms | all | list (search, filters, export), a firm (people, companies, activity). **Suspend / close / reactivate: Owner** |
| Companies | all | the firms' clients (name, GSTIN, status; never books). **Deactivate / reactivate: Support, Owner** |
| Users | all (Viewer sees emails partly hidden) | list and a person. **Reset two-step, sign out everywhere, switch off / on: Support, Owner** |
| Change history | Owner (all), Billing and Support (own and their role's) | every console action, views included; it can only be added to |
| Admins | Owner | add an admin by email with a role (no login yet: an invitation email to set a password), change a role, remove. There is always one owner |
| Settings | Owner | a stub: platform defaults arrive with the billing module |

Every write needs a reason and goes into the change history with before and after values.

### Switching off and on (nothing is ever deleted)
- **A person**: signed out everywhere, blocked from signing in (Supabase Auth ban), switched off in every firm they
  belong to. Switching on lifts the ban and restores exactly the member rows the console switched off.
- **A firm** (suspended or closed): **read-only**. Its people still read everything; every change through `can_write()`
  is refused, no posting to Tally is queued, and the bridge takes none of the waiting ones (they wait). All data is kept.
- **A company**: nothing is posted to Tally for it; its data is kept.
- **Left for phase 1b (user app, which this branch does not change):** the "Your firm's FinCom account is paused:
  <reason>. Contact FinCom." page (the app reads `my_firm_status()`), the sign-in message for a switched-off person,
  hiding switched-off companies from the firm's client lists with a "Show inactive" filter, refusing new uploads for them,
  and leaving them out of the per-client fee (the billing module's monthly run).

## Phase 5 "Operations" (branch `next-console-ops`)

**Database** (after 118; each one transaction, safe twice, add-only; NOT run by the builder):
1. `server/console/migration-122-console-ops.sql` (md5 `f3670fd0682e70f5bd06b6da56e3a6d8`): `console_secret_meta` (a key's rotations and tests,
   never its value), `console_view_log` (append-only), and the keys, health, support desk, "see as this firm" and export
   functions (service role only). It reads what is there (platform_secrets, Vault's gsp_secret_*, support_*, tally_*,
   wallet_entries, pgmq, pg_cron) and leaves out what is not.
2. `server/console/migration-123-notices-flags.sql` (md5 `55c7b424ebdd1da8853f0be3e48d7bf7`): `announcements`, `announcement_dismissals`,
   `feature_flags`, `feature_flag_rules`; for the user app `announcements_active()`, `announcement_dismiss(id)`,
   `flags_for_me()` (signed-in people); the console's functions (service role only).

**Function**: deploy `console-admin` again (Step B). No new secret is needed. Optional: `SENTRY_API_TOKEN` and
`SENTRY_ORG` (a read-only Sentry token) as function secrets, or set them on the Keys page (`sentry_api_token`,
`sentry_org`); without them the Sentry panel is hidden. `RESEND_API_KEY` and `SUPPORT_MAIL_FROM` (already used by
support-mail) let a console reply be emailed to the firm.

**User app**: one lazy chunk (`app/src/parts/Announce.jsx` + `app/src/lib/flags.js`, about 2.6 KB), loaded after the
page: the live announcements as one dismissible bar, and the flags read once (`window.FinComFlags.on(key)`). Before 123
runs it shows nothing. The "FinCom support viewed your account" notice uses the bell's own table (tally_alerts, kind
summary), so the bell needs no change.

| Screen | Who | What |
|---|---|---|
| Keys | Owner | every platform key: where it is kept, what it powers, set or not and its last 4 (12+ characters), last used (where known), last Test, rotate-by (180 days). **Replace** (write-only; platform_secrets or Vault), **Test** (one free call to the provider), **Record rotation** for Supabase function secrets (the console cannot write those: `supabase secrets set`) |
| Announcements | all see; Owner and Support write | title, text, severity, audience (all, plans, firms), start, end, dismissible; draft, publish, end; a preview of the bar |
| Feature flags | all see; Owner writes | default, a plan's or a firm's own value with an end date; one firm's flags with why |
| Support | all see (Viewer: emails hidden); Owner and Support write | every firm's tickets, SLA, assignee, replies (emailed to the firm), internal notes, status |
| Firm views | Owner and Support | "See as this firm": a read-only summary made on the server (counts only for clients); the reason goes to the firm's bell; every view logged |
| System health | all (Sentry: Owner and Support) | bridges online / idle / offline, waiting / stuck / failed jobs, queues, scheduled jobs, Sentry's top issues |
| Exports | Owner and Billing (ledger); Owner (Export everything) | the all-firms ledger; one .zip of firms, users, ledger and change history (at most 5 a day) |

`admin_set_secret` is not reused: it checks `is_superadmin()` with the caller's own session and writes no audit row.

## Phase 1b and later (not in this branch)
- Cloudflare Access check inside `console-admin` (the plan's 5.1 steps 2-3: a Worker `/api` proxy forwarding the Access
  token, and a Worker secret). Until then Access protects the page, and the function relies on sign-in + aal2 + roles.
- A separate Sentry project for the console; passkeys and hardware keys; step-up for risky actions; the device list.
