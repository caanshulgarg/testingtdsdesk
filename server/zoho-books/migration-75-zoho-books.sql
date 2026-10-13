-- Migration 75 (13-Oct-2026, branch zoho-books; the owner's decisions of 13-Oct-2026: "Zoho first, then Busy"; FinCom both
-- reads and posts). A Zoho Books (India) organisation connected to a FinCom client: its books kept in the SAME cloud copy the
-- Tally bridge fills (tally_books, tally_vouchers, tally_lines, tally_bills, tally_ledgers, tally_groups), marked source =
-- 'zoho', so TDS, GST, MIS, the due list and posting read a Zoho client exactly as a Tally client.
--
-- Runs AFTER 74 (staging: ... -> 72 -> 73 -> 74). ADD-ONLY: no table, column, row or function removed; no statement in this
-- file removes rows; nothing dropped; safe to run twice; one transaction (lock_timeout 10 s). Nothing that exists is
-- replaced: every function here is new (zoho_*). Running it changes no row there is (three columns added with the default
-- 'tally', which is what every existing row is).
--
--   tally_books.source, tally_vouchers.source, tally_ledgers.source   'tally' (default) or 'zoho'
--   zoho_grants        one Zoho sign-in (an OAuth grant) per firm: who connected it, the organisations it reaches, when the
--                      access token runs out. THE TOKENS ARE NEVER HERE: the refresh token and the access token are in
--                      Supabase Vault (vault.secrets 'zoho:<firm>:<grant>:refresh' / ':access'), read and written only by
--                      zoho_secret_get / zoho_secret_put (service role), as gsp_secret_get / gsp_secret_put (migration 16)
--   zoho_connections   one Zoho organisation linked to one FinCom client (its book in the cloud copy), its sync schedule,
--                      today's API calls, the last error; the webhook token's SHA-256 only
--   zoho_oauth_states  the one-time state of a sign-in in progress (its SHA-256; ten minutes)
--   zoho_sync_state    per organisation and kind of document: how far the changes were read (last_modified_time)
--   zoho_seen          every Zoho document held: its id, modified time and entry (the periodic id comparison finds deletions)
--   zoho_objects       the organisation's accounts, contacts and taxes by Zoho id (what posting looks up)
--   zoho_api_usage     calls per organisation per day (IST) and per minute: Zoho's 100 a minute and the plan's daily cap
--   zoho_posts         every FinCom entry posted to Zoho: its FinCom id (unique per organisation), state, Zoho's id and
--                      number, Zoho's own words on an error
--   zoho_post_jobs     one posting run; only one at a time per organisation (zoho_connections.post_lease_until)
--   zoho_log           what each run did (sync, deletions found, webhook, posting, errors), for the Integrations page
-- Who reads: members of the firm, through row-level security (my_firm()) and zoho_status(); nobody writes directly: the
-- functions below are executed by the service role only (the zoho-books edge function), each checking the member and, to
-- connect, link, disconnect or post, the member's role.
-- Tested on pg_stand only: tests/run_migration75.py (twice; add-only; RLS: a firm sees only its own) and
-- tests/run_zoho_server.py (the edge function under Deno against a stand-in Zoho).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- where an entry came from
alter table public.tally_books add column if not exists source text not null default 'tally';
alter table public.tally_vouchers add column if not exists source text not null default 'tally';
alter table public.tally_ledgers add column if not exists source text not null default 'tally';

-- ---------------------------------------------------------------- the tables
create table if not exists public.zoho_grants (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  dc text not null default 'in',                      -- Zoho's data centre: India only (accounts.zoho.in, www.zohoapis.in)
  scopes text not null default '',
  orgs jsonb not null default '[]'::jsonb,            -- [{id, name, gstin, plan}] the organisations this sign-in reaches
  token_expires_at timestamptz,                       -- the access token's end (never the token)
  refreshed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  last_error text
);
create index if not exists zoho_grants_firm on public.zoho_grants (firm_id);

create table if not exists public.zoho_connections (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  grant_id uuid references public.zoho_grants (id),
  org_id text not null,
  org_name text not null default '',
  org_gstin text not null default '',
  client_id text,
  book_id uuid unique,
  status text not null default 'connected',           -- connected | disconnected | needs_sign_in
  linked_by uuid,
  linked_at timestamptz not null default now(),
  disconnected_by uuid,
  disconnected_at timestamptz,
  daily_cap integer not null default 1000,            -- the plan's daily API cap (Free 1,000 .. 10,000); FinCom stops short of it
  sync_from date,                                     -- the first day read
  sync_every_min integer not null default 15,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  full_check_at timestamptz,                          -- the last id comparison (deletions)
  sync_lease_until timestamptz,
  post_lease_until timestamptz,
  post_lease_by uuid,
  hook_hash text,                                     -- SHA-256 of the webhook token (the token is shown once)
  hook_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  unique (firm_id, org_id)
);
create index if not exists zoho_connections_client on public.zoho_connections (firm_id, client_id);

create table if not exists public.zoho_oauth_states (
  state_hash text primary key,
  firm_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  back text not null default ''
);

create table if not exists public.zoho_sync_state (
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  entity text not null,
  cursor_sec bigint not null default 0,
  last_run_at timestamptz,
  listed integer not null default 0,
  fetched integer not null default 0,
  primary key (connection_id, entity)
);

create table if not exists public.zoho_seen (
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  entity text not null,
  zoho_id text not null,
  guid text not null,
  modified_sec bigint not null default 0,
  seen_at timestamptz not null default now(),
  gone_at timestamptz,
  skipped text,                                       -- a draft or a line booked by its own document: held, not in the books
  primary key (connection_id, entity, zoho_id)
);

create table if not exists public.zoho_objects (
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  kind text not null,                                 -- account | contact | tax | tds_tax | gst_ledger
  zoho_id text not null,
  name text not null default '',
  ledger text not null default '',
  data jsonb not null default '{}'::jsonb,
  seen_at timestamptz not null default now(),
  primary key (connection_id, kind, zoho_id)
);

create table if not exists public.zoho_api_usage (
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  minute timestamptz,
  minute_calls integer not null default 0,
  primary key (connection_id, day)
);

create table if not exists public.zoho_post_jobs (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null,
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  client_id text,
  requested_by uuid,
  status text not null default 'running',             -- running | done | failed
  n integer not null default 0,
  done integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zoho_posts (
  connection_id uuid not null references public.zoho_connections (id) on delete cascade,
  fincom_id text not null,
  firm_id uuid not null,
  client_id text,
  job_id uuid,
  kind text not null default '',                      -- bill | expense | journal | contact
  state text not null default 'posting',              -- posting | posted | error
  zoho_id text,
  zoho_number text,
  message text not null default '',
  attempts integer not null default 0,
  request jsonb,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  posted_at timestamptz,
  primary key (connection_id, fincom_id)
);

create table if not exists public.zoho_log (
  id bigserial primary key,
  firm_id uuid not null,
  connection_id uuid,
  at timestamptz not null default now(),
  kind text not null,                                 -- sync | full | gone | hook | post | error | link | disconnect
  message text not null default '',
  counts jsonb not null default '{}'::jsonb
);
create index if not exists zoho_log_conn on public.zoho_log (connection_id, at desc);

-- ---------------------------------------------------------------- who reads: the firm's members, its own rows only
do $$
declare t text;
begin
  foreach t in array array['zoho_grants', 'zoho_connections', 'zoho_sync_state', 'zoho_seen', 'zoho_objects', 'zoho_api_usage', 'zoho_post_jobs', 'zoho_posts', 'zoho_log', 'zoho_oauth_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zoho_grants' and policyname = 'zoho_grants_read') then
    create policy zoho_grants_read on public.zoho_grants for select to authenticated using (firm_id = public.my_firm()); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zoho_connections' and policyname = 'zoho_connections_read') then
    create policy zoho_connections_read on public.zoho_connections for select to authenticated using (firm_id = public.my_firm()); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zoho_post_jobs' and policyname = 'zoho_post_jobs_read') then
    create policy zoho_post_jobs_read on public.zoho_post_jobs for select to authenticated using (firm_id = public.my_firm()); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zoho_posts' and policyname = 'zoho_posts_read') then
    create policy zoho_posts_read on public.zoho_posts for select to authenticated using (firm_id = public.my_firm()); end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zoho_log' and policyname = 'zoho_log_read') then
    create policy zoho_log_read on public.zoho_log for select to authenticated using (firm_id = public.my_firm()); end if;
end $$;
-- the columns a member may read (no hash, no lease holder); the rest of these tables are read through zoho_status() alone
grant select (id, firm_id, created_by, created_at, dc, scopes, orgs, token_expires_at, refreshed_at, revoked_at, last_error) on public.zoho_grants to authenticated;
grant select (id, firm_id, grant_id, org_id, org_name, org_gstin, client_id, book_id, status, linked_by, linked_at, disconnected_by, disconnected_at, daily_cap, sync_from,
  sync_every_min, last_sync_at, next_sync_at, full_check_at, hook_at, last_error, last_error_at) on public.zoho_connections to authenticated;
grant select on public.zoho_post_jobs, public.zoho_posts, public.zoho_log to authenticated;
revoke all on sequence public.zoho_log_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------- the tokens: Vault only (migration 16's pattern)
create or replace function public.zoho_secret_put(p_name text, p_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if p_name !~ '^zoho:[0-9a-f-]{36}:[0-9a-f-]{36}:(refresh|access)$' then raise exception 'not a Zoho secret name'; end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then sid := vault.create_secret(coalesce(p_value, ''), p_name, 'FinCom Zoho Books (zoho-books)');
  else perform vault.update_secret(sid, coalesce(p_value, '')); end if;
  return sid;
end $$;
create or replace function public.zoho_secret_get(p_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name and p_name ~ '^zoho:'
$$;
revoke all on function public.zoho_secret_put(text, text) from public, anon, authenticated;
revoke all on function public.zoho_secret_get(text) from public, anon, authenticated;
grant execute on function public.zoho_secret_put(text, text) to service_role;
grant execute on function public.zoho_secret_get(text) to service_role;

-- the key the scheduled sync shows the function; made here, never leaves the database (as gst_cron_key)
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'zoho_cron_key', 'zoho-books scheduled sync')
 where not exists (select 1 from vault.secrets where name = 'zoho_cron_key');
create or replace function public.zoho_cron_ok(k text) returns boolean
language sql security definer set search_path = '' as $$
  select coalesce(k, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'zoho_cron_key' and decrypted_secret = k)
$$;
revoke all on function public.zoho_cron_ok(text) from public, anon, authenticated;
grant execute on function public.zoho_cron_ok(text) to service_role;

-- ---------------------------------------------------------------- the member behind a call (the function passes the user it verified)
create or replace function public.zoho_member(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('firm', m.firm_id, 'role', m.role, 'name', m.name)
    from members m where m.user_id = p_user and coalesce(m.active, true) order by (m.role = 'owner') desc limit 1
$$;
create or replace function public.zoho_need(p_user uuid, p_owner boolean) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m jsonb := zoho_member(p_user);
begin
  if m is null then raise exception 'not a member of a firm' using errcode = '42501'; end if;
  if p_owner and m->>'role' <> 'owner' then raise exception 'only the firm''s owner may do this' using errcode = '42501'; end if;
  if not p_owner and m->>'role' not in ('owner', 'staff') then raise exception 'look-only members cannot do this' using errcode = '42501'; end if;
  return (m->>'firm')::uuid;
end $$;

-- ---------------------------------------------------------------- signing in to Zoho
create or replace function public.zoho_state_new(p_user uuid, p_state_hash text, p_back text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := zoho_need(p_user, true);
begin
  if coalesce(p_state_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad state'; end if;
  insert into zoho_oauth_states (state_hash, firm_id, user_id, back) values (p_state_hash, f, p_user, left(coalesce(p_back, ''), 300));
  return jsonb_build_object('ok', true, 'firm', f);
end $$;
-- once only, within ten minutes
create or replace function public.zoho_state_take(p_state_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s zoho_oauth_states%rowtype;
begin
  update zoho_oauth_states set used_at = now() where state_hash = p_state_hash and used_at is null and created_at > now() - interval '10 minutes' returning * into s;
  if not found then return null; end if;
  return jsonb_build_object('firm', s.firm_id, 'user', s.user_id, 'back', s.back);
end $$;
create or replace function public.zoho_grant_save(p_firm uuid, p_user uuid, p_scopes text, p_orgs jsonb, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare g uuid;
begin
  if zoho_need(p_user, true) is distinct from p_firm then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into zoho_grants (firm_id, created_by, scopes, orgs, token_expires_at, refreshed_at)
  values (p_firm, p_user, left(coalesce(p_scopes, ''), 2000), coalesce(p_orgs, '[]'::jsonb), p_expires, now()) returning id into g;
  insert into zoho_log (firm_id, kind, message, counts) values (p_firm, 'link', 'signed in to Zoho Books', jsonb_build_object('orgs', jsonb_array_length(coalesce(p_orgs, '[]'::jsonb))));
  return g;
end $$;
create or replace function public.zoho_grant_token(p_grant uuid, p_expires timestamptz, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update zoho_grants set token_expires_at = coalesce(p_expires, token_expires_at), refreshed_at = case when p_expires is not null then now() else refreshed_at end,
         last_error = case when p_expires is not null then null else left(p_error, 500) end
   where id = p_grant;
  update zoho_connections set status = case when p_error is not null and p_error ~* 'invalid_code|invalid.*token|revoked|access denied' then 'needs_sign_in' else status end
   where grant_id = p_grant and status <> 'disconnected' and p_error is not null;
$$;

-- an organisation linked to a client: its book in the cloud copy (source 'zoho'). The owner only. A client whose GSTIN is
-- not the organisation's (another PAN) is never linked: someone else's books must not land in this client
create or replace function public.zoho_link(p_user uuid, p_grant uuid, p_org text, p_client text, p_from date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := zoho_need(p_user, true); g zoho_grants%rowtype; o jsonb; cg text; c zoho_connections%rowtype; bk uuid; other text; fr date;
begin
  select * into g from zoho_grants where id = p_grant and firm_id = f and revoked_at is null;
  if not found then raise exception 'sign in to Zoho Books again'; end if;
  select x into o from jsonb_array_elements(g.orgs) x where x->>'id' = p_org;
  if o is null then raise exception 'this Zoho sign-in does not reach organisation %', p_org; end if;
  select gstin into cg from clients where id = p_client and firm_id = f and not coalesce(deleted, false);
  if not found then raise exception 'no such client'; end if;
  if coalesce(cg, '') <> '' and coalesce(o->>'gstin', '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(o->>'gstin', 3, 10)) then
    raise exception 'the GSTIN of % in Zoho (%) is not this client''s (%)', o->>'name', o->>'gstin', cg;
  end if;
  select client_id into other from zoho_connections where firm_id = f and org_id = p_org and status = 'connected' and client_id is distinct from p_client;
  if other is not null then raise exception 'organisation % is already linked to another client; disconnect it there first', o->>'name'; end if;
  fr := coalesce(p_from, make_date(extract(year from (now() at time zone 'Asia/Kolkata') - interval '3 months')::int - 1, 4, 1));
  select * into c from zoho_connections where firm_id = f and org_id = p_org;
  bk := coalesce(c.book_id, gen_random_uuid());
  insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, source)
  values (bk, f, p_client, left('Zoho Books · ' || coalesce(o->>'name', p_org), 200), fr, fr - 1, 'zoho')
  on conflict (book_id) do update set client_id = excluded.client_id, source = 'zoho';
  -- how often it is read follows the plan's daily cap (a run costs about a dozen calls when little changed): Free (1,000)
  -- every 35 minutes, Standard (2,000) every 20, Professional and above every 15; a Zoho webhook brings a read forward
  insert into zoho_connections (firm_id, grant_id, org_id, org_name, org_gstin, client_id, book_id, status, linked_by, linked_at, sync_from, next_sync_at, daily_cap, sync_every_min)
  -- the organisation's GSTIN (each entry's registration); when Zoho's list does not give it, the client's own
  values (f, p_grant, p_org, coalesce(o->>'name', ''), upper(coalesce(nullif(o->>'gstin', ''), cg, '')), p_client, bk, 'connected', p_user, now(), fr, now(),
          case when coalesce(o->>'cap', '') ~ '^[0-9]{3,6}$' then (o->>'cap')::int else 1000 end,
          case when coalesce(o->>'cap', '') ~ '^[0-9]{3,6}$' and (o->>'cap')::int >= 5000 then 15 when coalesce(o->>'cap', '') ~ '^[0-9]{3,6}$' and (o->>'cap')::int >= 2000 then 20 else 35 end)
  on conflict (firm_id, org_id) do update set grant_id = excluded.grant_id, org_name = excluded.org_name, org_gstin = excluded.org_gstin, client_id = excluded.client_id,
     status = 'connected', linked_by = p_user, linked_at = now(), disconnected_at = null, disconnected_by = null, next_sync_at = now(), last_error = null
  returning * into c;
  insert into zoho_log (firm_id, connection_id, kind, message) values (f, c.id, 'link', 'linked to client ' || p_client);
  return jsonb_build_object('ok', true, 'connection', c.id, 'book', c.book_id, 'from', c.sync_from);
end $$;
-- Disconnect: FinCom's access is given up (the function revokes the token at Zoho when no other organisation uses the
-- sign-in); nothing is deleted, here or in Zoho: the book stays as it was, marked so
create or replace function public.zoho_disconnect(p_user uuid, p_conn uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := zoho_need(p_user, true); c zoho_connections%rowtype; still int;
begin
  update zoho_connections set status = 'disconnected', disconnected_by = p_user, disconnected_at = now(), next_sync_at = null
   where id = p_conn and firm_id = f returning * into c;
  if not found then raise exception 'no such connection'; end if;
  select count(*) into still from zoho_connections where grant_id = c.grant_id and status <> 'disconnected';
  if still = 0 then update zoho_grants set revoked_at = now(), revoked_by = p_user where id = c.grant_id and revoked_at is null; end if;
  insert into zoho_log (firm_id, connection_id, kind, message) values (f, c.id, 'disconnect', 'disconnected; nothing deleted');
  return jsonb_build_object('ok', true, 'grant', c.grant_id, 'revoke', still = 0, 'firm', f);
end $$;
-- the webhook token (shown once to the owner; only its hash kept)
create or replace function public.zoho_hook_set(p_user uuid, p_conn uuid, p_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := zoho_need(p_user, true);
begin
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad hash'; end if;
  update zoho_connections set hook_hash = p_hash where id = p_conn and firm_id = f;
end $$;
-- a webhook call: the organisation is read soon (never trusted for content: what changed is read from Zoho)
create or replace function public.zoho_hook(p_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c zoho_connections%rowtype;
begin
  update zoho_connections set hook_at = now(), next_sync_at = least(coalesce(next_sync_at, now()), now() + interval '1 minute')
   where hook_hash = p_hash and status = 'connected' and coalesce(p_hash, '') ~ '^[0-9a-f]{64}$' returning * into c;
  if not found then return false; end if;
  insert into zoho_log (firm_id, connection_id, kind, message) values (c.firm_id, c.id, 'hook', 'Zoho said something changed');
  return true;
end $$;

-- ---------------------------------------------------------------- the sync (the scheduled run)
create or replace function public.zoho_due(p_limit integer) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select c.id, c.firm_id, c.grant_id, c.org_id, c.org_gstin, c.client_id, c.book_id, c.sync_from, c.daily_cap, c.full_check_at, c.sync_every_min
      from zoho_connections c join zoho_grants g on g.id = c.grant_id and g.revoked_at is null
     where c.status = 'connected' and c.book_id is not null and coalesce(c.next_sync_at, now()) <= now() and coalesce(c.sync_lease_until, now() - interval '1 second') < now()
     order by c.next_sync_at nulls first limit greatest(1, least(coalesce(p_limit, 5), 50))) x
$$;
create or replace function public.zoho_connection(p_conn uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select to_jsonb(x) from (select c.id, c.firm_id, c.grant_id, c.org_id, c.org_gstin, c.client_id, c.book_id, c.sync_from, c.daily_cap, c.full_check_at, c.status, c.sync_every_min,
     g.token_expires_at, g.revoked_at from zoho_connections c left join zoho_grants g on g.id = c.grant_id where c.id = p_conn) x
$$;
-- one run at a time per organisation (a lease; a run that dies frees it when the lease ends)
create or replace function public.zoho_sync_lease(p_conn uuid, p_secs integer) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update zoho_connections set sync_lease_until = now() + make_interval(secs => greatest(10, least(coalesce(p_secs, 170), 600)))
   where id = p_conn and status = 'connected' and coalesce(sync_lease_until, now() - interval '1 second') < now();
  return found;
end $$;
create or replace function public.zoho_sync_end(p_conn uuid, p_next_min integer, p_error text, p_full boolean, p_counts jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c zoho_connections%rowtype;
begin
  update zoho_connections set sync_lease_until = null, last_sync_at = case when p_error is null then now() else last_sync_at end,
         next_sync_at = case when status = 'connected' then now() + make_interval(mins => greatest(1, least(coalesce(p_next_min, sync_every_min), 24 * 60))) end,
         full_check_at = case when p_full then now() else full_check_at end,
         last_error = case when p_error is null then null else left(p_error, 500) end,
         last_error_at = case when p_error is null then last_error_at else now() end
   where id = p_conn returning * into c;
  if found then
    insert into zoho_log (firm_id, connection_id, kind, message, counts)
    values (c.firm_id, c.id, case when p_error is not null then 'error' when p_full then 'full' else 'sync' end, coalesce(left(p_error, 500), ''), coalesce(p_counts, '{}'::jsonb));
  end if;
end $$;
-- Zoho's limits, counted in the database (one count for the sync and posting): at most p_minute calls a minute and
-- p_day_cap a day (IST); {ok, wait (seconds), used, cap}
create or replace function public.zoho_api_take(p_conn uuid, p_n integer, p_minute integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; m timestamptz := date_trunc('minute', now()); u zoho_api_usage%rowtype; cap int; n int := greatest(1, coalesce(p_n, 1));
begin
  select daily_cap into cap from zoho_connections where id = p_conn;
  if cap is null then raise exception 'no such connection'; end if;
  insert into zoho_api_usage (connection_id, day, calls, minute, minute_calls) values (p_conn, d, 0, m, 0) on conflict do nothing;
  select * into u from zoho_api_usage where connection_id = p_conn and day = d for update;
  if u.minute is distinct from m then u.minute := m; u.minute_calls := 0; end if;
  if u.calls + n > floor(cap * 0.95) then
    update zoho_api_usage set minute = u.minute, minute_calls = u.minute_calls where connection_id = p_conn and day = d;
    return jsonb_build_object('ok', false, 'daily', true, 'used', u.calls, 'cap', cap,
      'wait', ceil(extract(epoch from (((d + 1)::timestamp at time zone 'Asia/Kolkata') - now()))));
  end if;
  if u.minute_calls + n > greatest(1, coalesce(p_minute, 90)) then
    update zoho_api_usage set minute = u.minute, minute_calls = u.minute_calls where connection_id = p_conn and day = d;
    return jsonb_build_object('ok', false, 'daily', false, 'used', u.calls, 'cap', cap, 'wait', ceil(extract(epoch from (m + interval '1 minute' - now()))));
  end if;
  update zoho_api_usage set calls = u.calls + n, minute = u.minute, minute_calls = u.minute_calls + n where connection_id = p_conn and day = d;
  return jsonb_build_object('ok', true, 'used', u.calls + n, 'cap', cap);
end $$;
-- Zoho itself said 429: no more calls this minute (or today), whatever the count here says
create or replace function public.zoho_api_block(p_conn uuid, p_daily boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; cap int;
begin
  select daily_cap into cap from zoho_connections where id = p_conn;
  insert into zoho_api_usage (connection_id, day, calls, minute, minute_calls) values (p_conn, d, 0, date_trunc('minute', now()), 0) on conflict do nothing;
  update zoho_api_usage set minute = date_trunc('minute', now()), minute_calls = 100000, calls = case when p_daily then greatest(calls, cap) else calls end
   where connection_id = p_conn and day = d;
end $$;
create or replace function public.zoho_cursor(p_conn uuid) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(entity, cursor_sec), '{}'::jsonb) from zoho_sync_state where connection_id = p_conn
$$;
create or replace function public.zoho_cursor_set(p_conn uuid, p_entity text, p_cursor bigint, p_listed integer, p_fetched integer) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into zoho_sync_state (connection_id, entity, cursor_sec, last_run_at, listed, fetched) values (p_conn, p_entity, coalesce(p_cursor, 0), now(), coalesce(p_listed, 0), coalesce(p_fetched, 0))
  on conflict (connection_id, entity) do update set cursor_sec = greatest(zoho_sync_state.cursor_sec, excluded.cursor_sec), last_run_at = now(), listed = excluded.listed, fetched = excluded.fetched;
$$;
-- which of these documents are new or changed since held: [[id, modified_sec]] in, the ids to fetch out
create or replace function public.zoho_changed(p_conn uuid, p_entity text, p_docs jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x->>0), '[]'::jsonb) from jsonb_array_elements(coalesce(p_docs, '[]'::jsonb)) x
    left join zoho_seen s on s.connection_id = p_conn and s.entity = p_entity and s.zoho_id = x->>0
   where s.zoho_id is null or s.gone_at is not null or coalesce((x->>1)::bigint, 0) = 0 or s.modified_sec <> coalesce((x->>1)::bigint, 0)
$$;
-- the organisation's masters: ledgers (added or brought up to date, never removed), groups, and the Zoho objects posting
-- looks up. ledgers: [{name, parent, open, gstin, pan, tds_nature, zoho_id, kind}]; groups [[name, parent]]
create or replace function public.zoho_masters(p_conn uuid, p_ledgers jsonb, p_groups jsonb, p_objects jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c zoho_connections%rowtype; nl int := 0; ng int := 0; no int := 0;
begin
  select * into c from zoho_connections where id = p_conn;
  if c.book_id is null then raise exception 'no such connection'; end if;
  perform pg_advisory_xact_lock(hashtext(c.book_id::text));
  -- a ledger's opening is kept as it is when the list carries none (open null: a run that did not read the openings)
  with x as (select distinct on (tally_nm(y->>'name')) tally_nm(y->>'name') as name, left(coalesce(y->>'parent', ''), 200) as parent, nullif(y->>'open', '')::numeric as open,
                    nullif(upper(btrim(coalesce(y->>'gstin', ''))), '') as gstin, nullif(upper(btrim(coalesce(y->>'pan', ''))), '') as pan, nullif(y->>'tds_nature', '') as tds_nature, nullif(y->>'zoho_id', '') as zid
               from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) y where tally_nm(y->>'name') <> '' order by tally_nm(y->>'name')),
       upd as (update tally_ledgers t set parent = x.parent, open = coalesce(x.open, t.open), gstin = x.gstin, pan = x.pan, tds_nature = x.tds_nature, tally_guid = x.zid, deleted_at = null, source = 'zoho'
                 from x where t.book_id = c.book_id and t.name = x.name
                  and (t.parent, t.open, t.gstin, t.pan, t.tds_nature, t.tally_guid, t.deleted_at, t.source) is distinct from (x.parent, coalesce(x.open, t.open), x.gstin, x.pan, x.tds_nature, x.zid, null::timestamptz, 'zoho')
               returning 1),
       ins as (insert into tally_ledgers (book_id, firm_id, name, parent, open, gstin, pan, tds_nature, tally_guid, source)
               select c.book_id, c.firm_id, x.name, x.parent, coalesce(x.open, 0), x.gstin, x.pan, x.tds_nature, x.zid, 'zoho' from x
                where not exists (select 1 from tally_ledgers t where t.book_id = c.book_id and t.name = x.name)
               returning 1)
  select (select count(*) from upd) + (select count(*) from ins) into nl;
  with u as (insert into tally_groups as t (book_id, firm_id, name, parent)
             select distinct on (y->>0) c.book_id, c.firm_id, y->>0, coalesce(y->>1, '') from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) y where coalesce(y->>0, '') <> ''
             on conflict (book_id, name) do update set parent = excluded.parent where t.parent is distinct from excluded.parent returning 1)
  select count(*) into ng from u;
  with u as (insert into zoho_objects as t (connection_id, kind, zoho_id, name, ledger, data, seen_at)
             select distinct on (y->>'kind', y->>'zoho_id') p_conn, y->>'kind', y->>'zoho_id', left(coalesce(y->>'name', ''), 300), left(coalesce(y->>'ledger', ''), 300), coalesce(y->'data', '{}'::jsonb), now()
               from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) y where coalesce(y->>'kind', '') <> '' and coalesce(y->>'zoho_id', '') <> ''
             on conflict (connection_id, kind, zoho_id) do update set name = excluded.name, ledger = excluded.ledger, data = excluded.data, seen_at = now() returning 1)
  select count(*) into no from u;
  if nl > 0 or ng > 0 then update tally_books set ledgers_at = now() where book_id = c.book_id; end if;
  return jsonb_build_object('ok', true, 'ledgers', nl, 'groups', ng, 'objects', no);
end $$;
-- documents into the cloud copy through the one entry path (tally_ingest_entries: entries, lines, bills, the ready totals,
-- the GST type), marked source 'zoho'; zoho_seen kept. p_seen: [[entity, zoho_id, guid, modified_sec, skipped why|null]]
create or replace function public.zoho_ingest(p_conn uuid, p_vouchers jsonb, p_lines jsonb, p_seen jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c zoho_connections%rowtype; res jsonb := '{"ok": true, "sent": 0}'::jsonb; sent text[]; back text[];
begin
  select * into c from zoho_connections where id = p_conn;
  if c.book_id is null or c.status <> 'connected' then raise exception 'not connected'; end if;
  if jsonb_typeof(p_vouchers) = 'array' and jsonb_array_length(p_vouchers) > 0 then
    select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x;
    if exists (select 1 from unnest(sent) g where g !~ '^zoho-[a-z]+-[0-9A-Za-z_-]{1,40}$') then raise exception 'not a Zoho entry id'; end if;
    -- an entry from the Tally bridge is never touched here (another book), and a Zoho id is never another book's
    res := tally_ingest_entries(c.book_id, p_vouchers, coalesce(p_lines, '[]'::jsonb), true, false);
    -- (origin stays as the entry path sets it: 'fincom' for an entry FinCom posted, by its FinCom id; source says Zoho)
    update tally_vouchers set source = 'zoho' where book_id = c.book_id and guid = any(sent) and source is distinct from 'zoho';
    update tally_books set days_at = now() where book_id = c.book_id;     -- the app reads the entries again when this moves
  end if;
  -- an entry deleted earlier and back in Zoho (restored) is live again (tally_ingest_entries clears deleted_at)
  insert into zoho_seen as s (connection_id, entity, zoho_id, guid, modified_sec, seen_at, gone_at, skipped)
  select distinct on (y->>0, y->>1) p_conn, y->>0, y->>1, y->>2, coalesce(nullif(y->>3, '')::bigint, 0), now(), null, nullif(y->>4, '')
    from jsonb_array_elements(coalesce(p_seen, '[]'::jsonb)) y where coalesce(y->>1, '') <> ''
  on conflict (connection_id, entity, zoho_id) do update set guid = excluded.guid, modified_sec = excluded.modified_sec, seen_at = now(), gone_at = null, skipped = excluded.skipped;
  -- a document now a draft (skipped) that was in the books leaves them, marked (never removed)
  select coalesce(array_agg(y->>2), '{}') into back from jsonb_array_elements(coalesce(p_seen, '[]'::jsonb)) y where nullif(y->>4, '') is not null;
  if cardinality(back) > 0 then perform zoho_mark_gone(c.book_id, back); end if;
  return res;
end $$;
-- entries marked deleted (never removed) and the ready totals of their days made again
create or replace function public.zoho_mark_gone(p_book uuid, p_guids text[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare ds date[]; n int;
begin
  select coalesce(array_agg(distinct day), '{}') into ds from tally_vouchers where book_id = p_book and guid = any(p_guids) and source = 'zoho' and deleted_at is null;
  update tally_vouchers set deleted_at = now() where book_id = p_book and guid = any(p_guids) and source = 'zoho' and deleted_at is null;
  get diagnostics n = row_count;
  if n > 0 then perform tally_ledger_day_rebuild(p_book, ds); update tally_books set days_at = now() where book_id = p_book; end if;
  return n;
end $$;
-- the periodic id comparison: every id of one kind Zoho lists now (a COMPLETE list) against those held; the ones Zoho no
-- longer has are marked gone and their entries deleted (marked). A list that would take away more than a fifth of what
-- is held (three or more), or a list that is empty while entries are held, is not applied: held, said in the log, applied
-- only with p_confirm (a read fault must never empty a client's books)
create or replace function public.zoho_gone(p_conn uuid, p_entity text, p_alive jsonb, p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c zoho_connections%rowtype; held int; dead text[]; guids text[]; n int := 0;
begin
  select * into c from zoho_connections where id = p_conn;
  if c.book_id is null then raise exception 'no such connection'; end if;
  perform pg_advisory_xact_lock(hashtext(c.book_id::text));
  select count(*) into held from zoho_seen where connection_id = p_conn and entity = p_entity and gone_at is null;
  select coalesce(array_agg(s.zoho_id), '{}'), coalesce(array_agg(s.guid), '{}') into dead, guids from zoho_seen s
   where s.connection_id = p_conn and s.entity = p_entity and s.gone_at is null
     and not exists (select 1 from jsonb_array_elements_text(coalesce(p_alive, '[]'::jsonb)) a where a = s.zoho_id);
  if cardinality(dead) = 0 then return jsonb_build_object('ok', true, 'gone', 0, 'held', held); end if;
  if not coalesce(p_confirm, false) and ((cardinality(dead) >= 3 and cardinality(dead) * 5 > held) or jsonb_array_length(coalesce(p_alive, '[]'::jsonb)) = 0) then
    insert into zoho_log (firm_id, connection_id, kind, message, counts) values (c.firm_id, c.id, 'error',
      format('%s of %s %s are no longer listed by Zoho: not applied (too many at once); check in Zoho', cardinality(dead), held, p_entity), jsonb_build_object('entity', p_entity, 'missing', cardinality(dead)));
    return jsonb_build_object('ok', false, 'held', held, 'missing', cardinality(dead), 'refused', 'too many at once');
  end if;
  update zoho_seen set gone_at = now() where connection_id = p_conn and entity = p_entity and zoho_id = any(dead);
  n := zoho_mark_gone(c.book_id, guids);
  insert into zoho_log (firm_id, connection_id, kind, message, counts) values (c.firm_id, c.id, 'gone', format('%s %s deleted in Zoho: marked deleted in FinCom', cardinality(dead), p_entity),
    jsonb_build_object('entity', p_entity, 'gone', cardinality(dead), 'entries', n));
  return jsonb_build_object('ok', true, 'gone', cardinality(dead), 'entries', n, 'held', held);
end $$;

-- ---------------------------------------------------------------- posting (the same safeguards as posting to Tally)
-- a posting run: the member may post (owner or staff), one run at a time per organisation (the lease), each FinCom id
-- answered from what is already known: posted before -> already; a run that stopped after sending (state posting) is
-- looked up in Zoho by the function before anything is sent again. p_ids: the FinCom ids of the run
create or replace function public.zoho_post_begin(p_user uuid, p_client text, p_ids jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f uuid := zoho_need(p_user, false); c zoho_connections%rowtype; j uuid; known jsonb;
begin
  select * into c from zoho_connections where firm_id = f and client_id = p_client and status = 'connected' order by linked_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'This client is not connected to Zoho Books (Integrations → Zoho Books).'); end if;
  update zoho_connections set post_lease_until = now() + interval '10 minutes', post_lease_by = p_user
   where id = c.id and coalesce(post_lease_until, now() - interval '1 second') < now();
  if not found then return jsonb_build_object('ok', false, 'busy', true, 'error', 'Another posting to this Zoho organisation is running. Try again in a minute.'); end if;
  insert into zoho_post_jobs (firm_id, connection_id, client_id, requested_by, n) values (f, c.id, p_client, p_user, coalesce(jsonb_array_length(p_ids), 0)) returning id into j;
  select coalesce(jsonb_object_agg(fincom_id, jsonb_build_object('state', state, 'zoho_id', zoho_id, 'number', zoho_number, 'kind', kind)), '{}'::jsonb) into known
    from zoho_posts where connection_id = c.id and fincom_id in (select jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)));
  return jsonb_build_object('ok', true, 'job', j, 'connection', c.id, 'grant', c.grant_id, 'org', c.org_id, 'book', c.book_id, 'firm', f, 'known', known);
end $$;
-- one entry's state: posting (before the request), posted (Zoho's id and number), error (Zoho's words)
create or replace function public.zoho_post_mark(p_job uuid, p_fincom_id text, p_kind text, p_state text, p_zoho_id text, p_number text, p_message text, p_request jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare jb zoho_post_jobs%rowtype;
begin
  if p_state not in ('posting', 'posted', 'error') then raise exception 'bad state'; end if;
  if coalesce(p_fincom_id, '') !~ '^[A-Za-z0-9._:-]{1,80}$' then raise exception 'bad FinCom id'; end if;
  select * into jb from zoho_post_jobs where id = p_job;
  if not found then raise exception 'no such posting'; end if;
  insert into zoho_posts as p (connection_id, fincom_id, firm_id, client_id, job_id, kind, state, zoho_id, zoho_number, message, attempts, request, requested_by, posted_at)
  values (jb.connection_id, p_fincom_id, jb.firm_id, jb.client_id, p_job, coalesce(p_kind, ''), p_state, p_zoho_id, p_number, left(coalesce(p_message, ''), 1000),
          case when p_state = 'posting' then 1 else 0 end, p_request, jb.requested_by, case when p_state = 'posted' then now() end)
  on conflict (connection_id, fincom_id) do update set job_id = p_job, kind = coalesce(nullif(excluded.kind, ''), p.kind), state = excluded.state,
     zoho_id = coalesce(excluded.zoho_id, p.zoho_id), zoho_number = coalesce(excluded.zoho_number, p.zoho_number), message = excluded.message,
     attempts = p.attempts + case when p_state = 'posting' then 1 else 0 end, request = coalesce(excluded.request, p.request), updated_at = now(),
     posted_at = case when p_state = 'posted' then coalesce(p.posted_at, now()) else p.posted_at end
   where p.state <> 'posted';     -- a posted entry is never marked otherwise
end $$;
create or replace function public.zoho_post_end(p_job uuid, p_status text, p_results jsonb, p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare jb zoho_post_jobs%rowtype;
begin
  update zoho_post_jobs set status = case when p_status in ('done', 'failed') then p_status else 'done' end, results = coalesce(p_results, '[]'::jsonb), message = left(coalesce(p_message, ''), 1000),
         done = coalesce(jsonb_array_length(p_results), 0), updated_at = now() where id = p_job returning * into jb;
  if found then
    update zoho_connections set post_lease_until = null, post_lease_by = null where id = jb.connection_id;
    insert into zoho_log (firm_id, connection_id, kind, message, counts) values (jb.firm_id, jb.connection_id, 'post', left(coalesce(p_message, ''), 500),
      jsonb_build_object('n', jb.n, 'posted', (select count(*) from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where (r->>'ok')::boolean),
                         'errors', (select count(*) from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where not coalesce((r->>'ok')::boolean, false))));
  end if;
end $$;
-- the ledgers posting needs, as Zoho objects (accounts, contacts, taxes) of the client's organisation
create or replace function public.zoho_objects_for(p_conn uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'id', zoho_id, 'name', name, 'ledger', ledger, 'data', data)), '[]'::jsonb) from zoho_objects where connection_id = p_conn
$$;

-- ---------------------------------------------------------------- what a member sees (never a token, a key or a hash)
create or replace function public.zoho_status() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'orgs', g.orgs, 'at', g.created_at, 'tokenUntil', g.token_expires_at, 'revoked', g.revoked_at is not null, 'error', g.last_error) order by g.created_at desc)
                          from zoho_grants g where g.firm_id = my_firm()), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'org', c.org_id, 'orgName', c.org_name, 'gstin', c.org_gstin, 'client', c.client_id, 'book', c.book_id,
        'status', c.status, 'linkedAt', c.linked_at, 'lastSync', c.last_sync_at, 'nextSync', c.next_sync_at, 'fullCheck', c.full_check_at, 'error', c.last_error, 'errorAt', c.last_error_at,
        'cap', c.daily_cap, 'from', c.sync_from, 'hook', c.hook_hash is not null, 'hookAt', c.hook_at, 'tokenUntil', g.token_expires_at,
        'callsToday', coalesce((select u.calls from zoho_api_usage u where u.connection_id = c.id and u.day = (now() at time zone 'Asia/Kolkata')::date), 0),
        'entries', (select count(*) from tally_vouchers v where v.book_id = c.book_id and v.deleted_at is null),
        'posts', jsonb_build_object('posted', (select count(*) from zoho_posts p where p.connection_id = c.id and p.state = 'posted'),
                                    'errors', (select count(*) from zoho_posts p where p.connection_id = c.id and p.state = 'error')),
        'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'message', l.message, 'counts', l.counts) order by l.at desc)
                           from (select * from zoho_log l where l.connection_id = c.id order by l.at desc limit 8) l), '[]'::jsonb)) order by c.linked_at)
      from zoho_connections c left join zoho_grants g on g.id = c.grant_id where c.firm_id = my_firm()), '[]'::jsonb))
$$;

-- every function here: the service role only, except zoho_status (a member, for the firm's own)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'zoho\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = 'zoho_status' then execute format('grant execute on function %s to authenticated, service_role', r.sig);
    else execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end $$;

commit;
