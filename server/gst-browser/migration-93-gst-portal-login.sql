-- Migration 93 (17-Oct-2026, branch next-gst-browser: the GST browser helper; the owner's request of 17-Oct-2026).
-- NOT run on staging. Needs only members, my_firm() and can_write() (migration.sql) and Supabase Vault (vault.create_secret,
-- vault.update_secret, vault.decrypted_secrets, as server/gst-taxpro/migration-16 uses); independent of 80-92, may run before
-- or after any of them.
-- ADD-ONLY: three new tables, their row security and grants, five new functions (none replacing another); nothing dropped,
-- no row of any other table read or changed; safe to run twice; one transaction (lock_timeout 10 s).
-- THE ONE REMOVAL: gst_portal_login_delete removes the deleted login's password from vault.secrets (the owner's rule of
-- 17-Oct-2026: deleting a login must remove the secret itself; the login's row is only marked deleted). It is the only
-- 'delete from' in this file and it removes that one secret only, by its id, when the firm's owner deletes the login.
--
--   gst_portal_logins       a client's GST portal login, per GSTIN: the user id, and the password in Vault (secret_id only
--                           here; the password never in this table, in client_book_items or in any JSON). staff_allowed:
--                           the staff the owner allows to use it (the owner always may). Marked deleted, never removed.
--   gst_portal_login_events every save, change, delete and every read of a password, and every refused read: who, when,
--                           which client and GSTIN, what (never the password). Added by the functions only; never changed.
--   gst_helper_runs         every run of the browser helper: who, when, client, GSTIN, period, return, the steps done, the
--                           differences found against the portal, the ARN read after filing. Added, never changed.
-- Functions (security definer, search_path ''; signed-in users only, never anon):
--   gst_portal_login_save(client, gstin, username, password, staff)  the firm's owner only; a blank password keeps the one saved
--   gst_portal_login_list(client)        the firm's members: each GSTIN's user id, whether a password is saved, who may use it
--   gst_portal_login_read(client, gstin) the password, only to the owner or a staff member the owner allowed; every read and
--                                        every refusal logged; called only when the person presses "Log in to GST portal"
--   gst_portal_login_delete(client, gstin) the firm's owner only: the Vault secret removed, the row marked deleted
--   gst_helper_run_add(...)              a member who can write (owner, staff) logs a run for the firm, as himself
-- Tested by tests/run_migration93.py (twice; Vault stood in; row security; owner / allowed staff / other staff / viewer /
-- another firm) and tests/run_gst_helper_app_ui.py (the app through these functions).

begin;
set local lock_timeout = '10s';

create table if not exists public.gst_portal_logins (
  id bigserial primary key,
  firm_id uuid not null,
  client_id text not null,
  gstin text not null,
  username text not null,
  secret_id uuid,
  staff_allowed uuid[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  deleted_by uuid,
  deleted_at timestamptz,
  constraint gst_portal_logins_gstin check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  constraint gst_portal_logins_lens check (char_length(client_id) <= 200 and char_length(username) between 1 and 100)
);
create unique index if not exists gst_portal_logins_live on public.gst_portal_logins (firm_id, client_id, gstin) where not deleted;

create table if not exists public.gst_portal_login_events (
  id bigserial primary key,
  firm_id uuid,
  client_id text not null default '',
  gstin text not null default '',
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  note text not null default '',
  constraint gst_portal_login_events_action check (action in ('saved', 'changed', 'deleted', 'read', 'refused'))
);

create table if not exists public.gst_helper_runs (
  id bigserial primary key,
  firm_id uuid not null,
  client_id text not null,
  gstin text not null,
  period text not null,
  form text not null,
  user_id uuid not null,
  at timestamptz not null default now(),
  run_id text not null default '',
  outcome text not null,
  steps jsonb not null default '[]',
  differences jsonb not null default '[]',
  arn text not null default '',
  helper_version text not null default '',
  selectors_version text not null default '',
  note text not null default '',
  constraint gst_helper_runs_form check (form in ('R1', 'IFF', '3B', '2B', 'LEDGER', 'STATUS')),
  constraint gst_helper_runs_period check (period ~ '^[0-9]{6}$'),
  constraint gst_helper_runs_outcome check (outcome in ('done', 'stopped', 'yours', 'filed', 'info')),
  constraint gst_helper_runs_arn check (arn = '' or arn ~ '^AA[0-9]{2}[0-9]{4}[0-9A-Z]{7}$'),
  constraint gst_helper_runs_lens check (char_length(client_id) <= 200 and char_length(run_id) <= 100 and char_length(note) <= 500
    and pg_column_size(steps) <= 65536 and pg_column_size(differences) <= 262144)
);
create index if not exists gst_helper_runs_by on public.gst_helper_runs (firm_id, client_id, gstin, period);

alter table public.gst_portal_logins enable row level security;
alter table public.gst_portal_login_events enable row level security;
alter table public.gst_helper_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_portal_logins' and policyname = 'gst_portal_logins_read') then
    create policy gst_portal_logins_read on public.gst_portal_logins for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_portal_login_events' and policyname = 'gst_portal_login_events_read') then
    create policy gst_portal_login_events_read on public.gst_portal_login_events for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_helper_runs' and policyname = 'gst_helper_runs_read') then
    create policy gst_helper_runs_read on public.gst_helper_runs for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
-- the members read the logins' user ids and dates, never secret_id (a column grant); nothing is written except through the functions
revoke all on public.gst_portal_logins, public.gst_portal_login_events, public.gst_helper_runs from public, anon, authenticated;
grant select (id, firm_id, client_id, gstin, username, staff_allowed, created_at, updated_at, deleted, deleted_at) on public.gst_portal_logins to authenticated;
grant select on public.gst_portal_login_events, public.gst_helper_runs to authenticated;
revoke all on sequence public.gst_portal_logins_id_seq, public.gst_portal_login_events_id_seq, public.gst_helper_runs_id_seq from public, anon, authenticated;
grant all on public.gst_portal_logins, public.gst_portal_login_events, public.gst_helper_runs to service_role;
grant all on sequence public.gst_portal_logins_id_seq, public.gst_portal_login_events_id_seq, public.gst_helper_runs_id_seq to service_role;

-- the signed-in person's role in the firm ('' when none)
create or replace function public.gst_portal_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role from public.members m where m.user_id = auth.uid() and m.active and m.firm_id = public.my_firm() limit 1), '')
$$;

create or replace function public.gst_portal_login_save(p_client text, p_gstin text, p_username text, p_password text, p_staff uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); r public.gst_portal_logins; g text := upper(btrim(coalesce(p_gstin, ''))); u text := btrim(coalesce(p_username, ''));
  sid uuid; staff uuid[];
begin
  if f is null or auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in to the firm account first.'); end if;
  if public.gst_portal_role() <> 'owner' then
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note) values (f, coalesce(p_client, ''), g, auth.uid(), 'refused', 'save: not the owner');
    return jsonb_build_object('ok', false, 'error', 'Only the firm''s owner can save or change a GST portal login.');
  end if;
  if coalesce(p_client, '') = '' then return jsonb_build_object('ok', false, 'error', 'No client chosen.'); end if;
  if g !~ '^[0-9]{2}[A-Z0-9]{13}$' then return jsonb_build_object('ok', false, 'error', 'That is not a GSTIN.'); end if;
  if u = '' or char_length(u) > 100 then return jsonb_build_object('ok', false, 'error', 'Type the GST portal user id.'); end if;
  -- only members of this firm may be allowed
  select coalesce(array_agg(distinct m.user_id), '{}') into staff from public.members m where m.firm_id = f and m.active and m.role = 'staff' and m.user_id = any(coalesce(p_staff, '{}'));
  select * into r from public.gst_portal_logins l where l.firm_id = f and l.client_id = p_client and l.gstin = g and not l.deleted for update;
  if r.id is null then
    if coalesce(p_password, '') = '' then return jsonb_build_object('ok', false, 'error', 'Type the GST portal password.'); end if;
    sid := vault.create_secret(p_password, 'gstportal:' || f || ':' || g || ':' || gen_random_uuid(), 'FinCom GST portal login (browser helper)');
    insert into public.gst_portal_logins (firm_id, client_id, gstin, username, secret_id, staff_allowed, created_by, updated_by)
      values (f, p_client, g, u, sid, case when p_staff is null then '{}' else staff end, auth.uid(), auth.uid());
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action) values (f, p_client, g, auth.uid(), 'saved');
  else
    if coalesce(p_password, '') <> '' then
      if r.secret_id is null then sid := vault.create_secret(p_password, 'gstportal:' || f || ':' || g || ':' || gen_random_uuid(), 'FinCom GST portal login (browser helper)');
      else perform vault.update_secret(r.secret_id, p_password); sid := r.secret_id; end if;
    else sid := r.secret_id; end if;
    update public.gst_portal_logins set username = u, secret_id = sid, staff_allowed = case when p_staff is null then staff_allowed else staff end,
      updated_by = auth.uid(), updated_at = now() where id = r.id;
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note)
      values (f, p_client, g, auth.uid(), 'changed', case when coalesce(p_password, '') <> '' then 'user id and password' else 'user id or staff allowed' end);
  end if;
  return jsonb_build_object('ok', true, 'gstin', g, 'username', u, 'has_password', sid is not null);
end $$;

create or replace function public.gst_portal_login_list(p_client text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('gstin', l.gstin, 'username', l.username, 'has_password', l.secret_id is not null, 'staff_allowed', to_jsonb(l.staff_allowed),
    'updated_at', l.updated_at, 'can_use', public.gst_portal_role() = 'owner' or (public.gst_portal_role() = 'staff' and auth.uid() = any(l.staff_allowed))) order by l.gstin), '[]'::jsonb)
  from public.gst_portal_logins l where l.firm_id = public.my_firm() and l.client_id = p_client and not l.deleted
$$;

create or replace function public.gst_portal_login_read(p_client text, p_gstin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); r public.gst_portal_logins; g text := upper(btrim(coalesce(p_gstin, ''))); v_role text := public.gst_portal_role(); pw text;
begin
  if f is null or auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in to the firm account first.'); end if;
  select * into r from public.gst_portal_logins l where l.firm_id = f and l.client_id = p_client and l.gstin = g and not l.deleted;
  if r.id is null or r.secret_id is null then return jsonb_build_object('ok', false, 'error', 'No GST portal login is saved for ' || g || '.'); end if;
  if not (v_role = 'owner' or (v_role = 'staff' and auth.uid() = any(r.staff_allowed))) then
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note) values (f, p_client, g, auth.uid(), 'refused', 'read: not allowed');
    return jsonb_build_object('ok', false, 'error', 'You are not allowed to use this client''s GST portal login. The firm''s owner can allow you in GST settings.');
  end if;
  select d.decrypted_secret into pw from vault.decrypted_secrets d where d.id = r.secret_id;
  if pw is null then return jsonb_build_object('ok', false, 'error', 'The saved password could not be read; save it again in GST settings.'); end if;
  insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action) values (f, p_client, g, auth.uid(), 'read');
  return jsonb_build_object('ok', true, 'gstin', g, 'username', r.username, 'password', pw);
end $$;

create or replace function public.gst_portal_login_delete(p_client text, p_gstin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); r public.gst_portal_logins; g text := upper(btrim(coalesce(p_gstin, '')));
begin
  if f is null or auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in to the firm account first.'); end if;
  if public.gst_portal_role() <> 'owner' then
    insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action, note) values (f, coalesce(p_client, ''), g, auth.uid(), 'refused', 'delete: not the owner');
    return jsonb_build_object('ok', false, 'error', 'Only the firm''s owner can delete a GST portal login.');
  end if;
  select * into r from public.gst_portal_logins l where l.firm_id = f and l.client_id = p_client and l.gstin = g and not l.deleted for update;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'No GST portal login is saved for ' || g || '.'); end if;
  -- the one removal this file makes: the deleted login's password, by its id
  if r.secret_id is not null then delete from vault.secrets s where s.id = r.secret_id; end if;
  update public.gst_portal_logins set secret_id = null, deleted = true, deleted_by = auth.uid(), deleted_at = now() where id = r.id;
  insert into public.gst_portal_login_events (firm_id, client_id, gstin, user_id, action) values (f, p_client, g, auth.uid(), 'deleted');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gst_helper_run_add(p_client text, p_gstin text, p_period text, p_form text, p_outcome text, p_steps jsonb, p_differences jsonb,
  p_arn text, p_run_id text, p_helper text, p_selectors text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f uuid := public.my_firm(); i bigint;
begin
  if f is null or auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Sign in to the firm account first.'); end if;
  if public.gst_portal_role() not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'Only the owner and staff can log a helper run.'); end if;
  insert into public.gst_helper_runs (firm_id, client_id, gstin, period, form, user_id, run_id, outcome, steps, differences, arn, helper_version, selectors_version, note)
    values (f, coalesce(p_client, ''), upper(coalesce(p_gstin, '')), coalesce(p_period, ''), coalesce(p_form, ''), auth.uid(), left(coalesce(p_run_id, ''), 100), coalesce(p_outcome, 'info'),
      coalesce(p_steps, '[]'), coalesce(p_differences, '[]'), coalesce(p_arn, ''), left(coalesce(p_helper, ''), 40), left(coalesce(p_selectors, ''), 40), left(coalesce(p_note, ''), 500))
    returning id into i;
  return jsonb_build_object('ok', true, 'id', i);
end $$;

revoke all on function public.gst_portal_role(), public.gst_portal_login_save(text, text, text, text, uuid[]), public.gst_portal_login_list(text),
  public.gst_portal_login_read(text, text), public.gst_portal_login_delete(text, text),
  public.gst_helper_run_add(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text) from public, anon;
grant execute on function public.gst_portal_role(), public.gst_portal_login_save(text, text, text, text, uuid[]), public.gst_portal_login_list(text),
  public.gst_portal_login_read(text, text), public.gst_portal_login_delete(text, text),
  public.gst_helper_run_add(text, text, text, text, text, jsonb, jsonb, text, text, text, text, text) to authenticated, service_role;

commit;
