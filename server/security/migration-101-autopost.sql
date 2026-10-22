-- Post automatically what a person approved before (23-Oct-2026, branch next-autopost; the owner's approval of the
-- design "Yes, build it", with "Post at once": the hold is 0 unless the owner raises it). NOT run on staging by the app's
-- builders: the owner runs it. Runs after 100 (staging ... -> 99 -> 100 -> 101; a fresh database the same; it needs
-- migration 19's sync_refused and clients.deleted, my_firm() and the members table).
--
--   autopost_claims   one row per entry posted by itself (bank:<fp> / bill:<id>), per client: which run took it, its
--                     amount, the IST day, and where it is (claimed, queued, posted, failed, undone, released). The key
--                     (firm, client, entry) is what makes two browsers never post the same entry; a claim not finished
--                     within its lease (10 minutes) may be taken again; one posted, queued or undone never.
--   autopost_claim    the browser asks before posting: the client's setting is read HERE (on, bank / bills, the limit
--                     per entry, the daily total for the client by India's date across every browser), under a lock
--                     per client; it answers which entries this run may post and why the others may not.
--   autopost_mark     the run says where each entry went (queued, posted, failed, released; undone only as the setting's
--                     "who may undo" allows).
--   autopost_log      every change of a client's setting: who, when, the old and new value, and whether it was refused.
--   sync_guard_autopost (on clients, after clients_keep_keys and sync_guard): only the firm's owner may switch it on or
--                     loosen it (a kind added, a limit raised or removed, a shorter hold, any amount within the limit,
--                     the rights changed); from anyone else the old setting is kept and the attempt is written to the
--                     log and to sync_refused. Switching off and tightening are open to staff.
-- Add-only: two new tables, functions, one new trigger; grants explicit. Nothing dropped but the policies and the
-- trigger it makes again, no "delete from". One transaction, lock_timeout 10 s. Safe to run twice.

begin;
set local lock_timeout = '10s';

create table if not exists public.autopost_claims (
  firm_id     uuid not null,
  client_id   text not null,
  entry_id    text not null,
  run_id      uuid not null,
  kind        text not null check (kind in ('bank', 'bill')),
  amount      numeric not null default 0 check (amount >= 0),
  rule        text,
  day         date not null,
  status      text not null default 'claimed' check (status in ('claimed', 'queued', 'posted', 'failed', 'undone', 'released')),
  job_id      uuid,
  claimed_by  uuid,
  claimed_at  timestamptz not null default now(),
  lease_until timestamptz not null default now() + interval '10 minutes',
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (firm_id, client_id, entry_id)
);
create index if not exists autopost_claims_day on public.autopost_claims (firm_id, client_id, day);
create index if not exists autopost_claims_run on public.autopost_claims (firm_id, run_id);

create table if not exists public.autopost_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  firm_id   uuid,
  client_id text not null,
  by_user   uuid,
  by_role   text,
  old_value jsonb,
  new_value jsonb,
  refused   boolean not null default false,
  what      text
);
create index if not exists autopost_log_firm on public.autopost_log (firm_id, client_id, at desc);

alter table public.autopost_claims enable row level security;
alter table public.autopost_log enable row level security;
drop policy if exists autopost_claims_read on public.autopost_claims;
create policy autopost_claims_read on public.autopost_claims for select to authenticated using ((firm_id = (select public.my_firm())) or (select public.is_superadmin()));
drop policy if exists autopost_log_read on public.autopost_log;
create policy autopost_log_read on public.autopost_log for select to authenticated using ((firm_id = (select public.my_firm())) or (select public.is_superadmin()));

-- the setting with its defaults (app: AutoPost.DEF, src/js/90-autopost.js)
create or replace function public.autopost_cfg(v jsonb) returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('on', false, 'bank', true, 'bills', true, 'billsNoGstin', false, 'bankAmounts', 'exact', 'perEntry', 50000,
    'perDay', null, 'holdMin', 0, 'whoOn', 'owner', 'whoUndo', 'owner+staff') || coalesce(case when jsonb_typeof(v) = 'object' then v end, '{}'::jsonb)
$$;
-- a limit as a number; empty, none, zero or below: no limit (infinity)
create or replace function public.autopost_lim(v jsonb) returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when v is null or jsonb_typeof(v) not in ('number', 'string') or coalesce(nullif(btrim(v #>> '{}'), ''), 'x') !~ '^[0-9]+(\.[0-9]+)?$'
              or (v #>> '{}')::numeric <= 0 then 'infinity'::numeric else (v #>> '{}')::numeric end
$$;
create or replace function public.autopost_bool(v jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(v = 'true'::jsonb or v = '"true"'::jsonb, false)
$$;
-- what a change loosens (the same test as AutoPost.loosens): empty when it does not
create or replace function public.autopost_loosens(a0 jsonb, b0 jsonb) returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare a jsonb := public.autopost_cfg(a0); b jsonb := public.autopost_cfg(b0); out text[] := '{}';
begin
  if not public.autopost_bool(a->'on') and public.autopost_bool(b->'on') then out := out || 'switch it on'::text; end if;
  if public.autopost_bool(b->'on') then
    if not public.autopost_bool(a->'bank') and public.autopost_bool(b->'bank') then out := out || 'add bank lines'::text; end if;
    if not public.autopost_bool(a->'bills') and public.autopost_bool(b->'bills') then out := out || 'add purchase bills'::text; end if;
    if not public.autopost_bool(a->'billsNoGstin') and public.autopost_bool(b->'billsNoGstin') then out := out || 'add suppliers without a GSTIN'::text; end if;
    if coalesce(a->>'bankAmounts', '') <> 'within' and b->>'bankAmounts' = 'within' then out := out || 'allow any amount within the limit'::text; end if;
    if public.autopost_lim(b->'perEntry') > public.autopost_lim(a->'perEntry') then out := out || 'raise the limit per entry'::text; end if;
    if public.autopost_lim(b->'perDay') > public.autopost_lim(a->'perDay') then out := out || 'raise the daily limit'::text; end if;
    if coalesce(nullif(b->>'holdMin', '')::numeric, 0) < coalesce(nullif(a->>'holdMin', '')::numeric, 0) then out := out || 'shorten the hold'::text; end if;
  end if;
  if coalesce(a->>'whoOn', '') is distinct from coalesce(b->>'whoOn', '') or coalesce(a->>'whoUndo', '') is distinct from coalesce(b->>'whoUndo', '') then out := out || 'change who may change it'::text; end if;
  return out;
exception when others then
  return array['an unreadable setting'];
end $$;

-- the guard on clients: only the owner switches on or loosens; every change logged
create or replace function public.sync_guard_autopost() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_rec jsonb := case when tg_op = 'UPDATE' then old.data #> '{choices,autopost}' end;
  new_rec jsonb := new.data #> '{choices,autopost}';
  old_v jsonb := old_rec -> 'value'; new_v jsonb := new_rec -> 'value';
  uid uuid := auth.uid(); r text; loose text[];
begin
  if old_v is not distinct from new_v then return new; end if;
  select m.role into r from members m where m.user_id = uid and m.firm_id = new.firm_id and coalesce(m.active, true) limit 1;
  loose := public.autopost_loosens(old_v, new_v);
  -- a write with no signed-in person is the server's own (the service role; anon cannot write clients)
  if array_length(loose, 1) > 0 and uid is not null and r is distinct from 'owner'
     and not (r = 'staff' and public.autopost_cfg(old_v)->>'whoOn' = 'anyone' and not ('change who may change it' = any(loose))) then
    -- keep the old setting (none: the key goes)
    if old_rec is null then new.data := new.data #- '{choices,autopost}';
    elsif jsonb_typeof(new.data -> 'choices') = 'object' then new.data := jsonb_set(new.data, '{choices,autopost}', old_rec);
    else new.data := jsonb_set(new.data, '{choices}', jsonb_build_object('autopost', old_rec)); end if;
    insert into autopost_log (firm_id, client_id, by_user, by_role, old_value, new_value, refused, what)
    values (new.firm_id, new.id, uid, r, old_v, new_v, true, 'refused: only the owner may ' || array_to_string(loose, ', '));
    insert into sync_refused (firm_id, user_id, tbl, kind, row_id, what)
    values (new.firm_id, uid, 'clients', 'autopost', new.id, 'Post automatically: only the owner may ' || array_to_string(loose, ', ') || '; the setting was kept');
    return new;
  end if;
  insert into autopost_log (firm_id, client_id, by_user, by_role, old_value, new_value, refused, what)
  values (new.firm_id, new.id, uid, r, old_v, new_v, false, case when array_length(loose, 1) > 0 then 'loosened: ' || array_to_string(loose, ', ') else 'changed' end);
  return new;
end $$;
drop trigger if exists sync_guard_autopost on public.clients;
create trigger sync_guard_autopost before insert or update on public.clients for each row execute function public.sync_guard_autopost();

-- claim entries for a run: [{id, kind, amount, rule}] -> {ok, taken: [id], refused: [{id, why}], day_used, per_day}
create or replace function public.autopost_claim(p_client text, p_run uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); f uuid; r text; cfg jsonb; per_entry numeric; per_day numeric; d date := (now() at time zone 'Asia/Kolkata')::date;
  used numeric; it jsonb; eid text; k text; amt numeric; c autopost_claims%rowtype; taken text[] := '{}'; refused jsonb := '[]';
begin
  select m.firm_id, m.role into f, r from members m where m.user_id = uid and coalesce(m.active, true) limit 1;
  if f is null then return jsonb_build_object('ok', false, 'error', 'Not a member of a firm.'); end if;
  if r not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'Only the owner or staff may post.'); end if;
  if p_run is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'error', 'Nothing to claim.'); end if;
  select public.autopost_cfg(cl.data #> '{choices,autopost,value}') into cfg from clients cl where cl.firm_id = f and cl.id = p_client and not coalesce(cl.deleted, false);
  if cfg is null then return jsonb_build_object('ok', false, 'error', 'No such client.'); end if;
  if not public.autopost_bool(cfg->'on') then return jsonb_build_object('ok', false, 'error', 'Post automatically is off for this client.'); end if;
  per_entry := public.autopost_lim(cfg->'perEntry'); if per_entry = 'infinity' then per_entry := 50000; end if;
  per_day := nullif(public.autopost_lim(cfg->'perDay'), 'infinity');
  perform pg_advisory_xact_lock(hashtextextended('autopost:' || f::text || ':' || p_client, 0));
  select coalesce(sum(x.amount), 0) into used from autopost_claims x where x.firm_id = f and x.client_id = p_client and x.day = d and x.status in ('claimed', 'queued', 'posted')
    and not (x.status = 'claimed' and x.lease_until <= now());
  for it in select value from jsonb_array_elements(p_items) loop
    eid := it->>'id'; k := it->>'kind';
    amt := case when coalesce(it->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'amount')::numeric else null end;
    if eid is null or eid = '' or k not in ('bank', 'bill') or amt is null then refused := refused || jsonb_build_object('id', eid, 'why', 'not readable'); continue; end if;
    if (k = 'bank' and not public.autopost_bool(cfg->'bank')) or (k = 'bill' and not public.autopost_bool(cfg->'bills')) then refused := refused || jsonb_build_object('id', eid, 'why', 'switched off for ' || k); continue; end if;
    if amt > per_entry then refused := refused || jsonb_build_object('id', eid, 'why', 'over the limit per entry'); continue; end if;
    select * into c from autopost_claims x where x.firm_id = f and x.client_id = p_client and x.entry_id = eid for update;
    if found and (c.status in ('posted', 'queued', 'undone') or (c.status = 'claimed' and c.lease_until > now() and c.run_id <> p_run)) then
      refused := refused || jsonb_build_object('id', eid, 'why', 'already taken (' || c.status || ')'); continue;
    end if;
    if found and c.status = 'claimed' and c.day = d and c.lease_until > now() then used := used - c.amount; end if;
    if per_day is not null and used + amt > per_day then refused := refused || jsonb_build_object('id', eid, 'why', 'daily limit'); continue; end if;
    insert into autopost_claims (firm_id, client_id, entry_id, run_id, kind, amount, rule, day, status, claimed_by, claimed_at, lease_until, updated_at, updated_by)
    values (f, p_client, eid, p_run, k, amt, left(it->>'rule', 20), d, 'claimed', uid, now(), now() + interval '10 minutes', now(), uid)
    on conflict (firm_id, client_id, entry_id) do update set run_id = excluded.run_id, kind = excluded.kind, amount = excluded.amount, rule = excluded.rule, day = excluded.day,
      status = 'claimed', job_id = null, claimed_by = excluded.claimed_by, claimed_at = now(), lease_until = excluded.lease_until, updated_at = now(), updated_by = excluded.updated_by;
    used := used + amt; taken := taken || eid;
  end loop;
  return jsonb_build_object('ok', true, 'taken', to_jsonb(taken), 'refused', refused, 'day_used', used, 'per_day', per_day, 'day', d);
end $$;

-- where the run's entries went: queued, posted, failed, released (and undone, as "who may undo" allows)
create or replace function public.autopost_mark(p_client text, p_run uuid, p_ids text[], p_status text, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); f uuid; r text; cfg jsonb; n int;
begin
  select m.firm_id, m.role into f, r from members m where m.user_id = uid and coalesce(m.active, true) limit 1;
  if f is null or r not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'Only the owner or staff may.'); end if;
  if p_status not in ('queued', 'posted', 'failed', 'undone', 'released') then return jsonb_build_object('ok', false, 'error', 'Not a state.'); end if;
  if p_status = 'undone' then
    select public.autopost_cfg(cl.data #> '{choices,autopost,value}') into cfg from clients cl where cl.firm_id = f and cl.id = p_client;
    if coalesce(cfg->>'whoUndo', '') = 'owner' and r <> 'owner' then return jsonb_build_object('ok', false, 'error', 'Only the owner may undo an automatic entry.'); end if;
  end if;
  update autopost_claims x set status = p_status, job_id = coalesce(p_job, x.job_id), updated_at = now(), updated_by = uid,
    lease_until = case when p_status in ('posted', 'queued', 'undone') then 'infinity'::timestamptz else x.lease_until end
   where x.firm_id = f and x.client_id = p_client and x.entry_id = any(p_ids)
     and (x.run_id = p_run or p_status = 'undone') and not (x.status = 'undone');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke all on public.autopost_claims, public.autopost_log from public, anon, authenticated;
grant select on public.autopost_claims, public.autopost_log to authenticated;
grant select, insert, update, delete on public.autopost_claims, public.autopost_log to service_role;
revoke all on sequence public.autopost_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.autopost_log_id_seq to service_role;
revoke all on function public.autopost_claim(text, uuid, jsonb), public.autopost_mark(text, uuid, text[], text, uuid) from public, anon;
grant execute on function public.autopost_claim(text, uuid, jsonb), public.autopost_mark(text, uuid, text[], text, uuid) to authenticated, service_role;
revoke all on function public.sync_guard_autopost() from public, anon, authenticated;
revoke all on function public.autopost_cfg(jsonb), public.autopost_lim(jsonb), public.autopost_bool(jsonb), public.autopost_loosens(jsonb, jsonb) from public, anon;
grant execute on function public.autopost_cfg(jsonb), public.autopost_lim(jsonb), public.autopost_bool(jsonb), public.autopost_loosens(jsonb, jsonb) to authenticated, service_role;

commit;
