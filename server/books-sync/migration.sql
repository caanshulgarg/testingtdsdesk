-- TDS Desk: each client's TDS and GST work kept in the firm's database, not in one browser.
--
-- One row per client and part ("work" for now). Every save carries the revision it was built on;
-- a save built on an old revision is refused, so two staff can never silently overwrite each other.
-- Every earlier version is kept in client_books_history (nothing is deleted without a trace).
--
-- Apply to STAGING first (qbocskaiewaxqcvaunzc), check with the ZZ TEST company, then live.

create table if not exists public.client_books (
  firm_id    uuid        not null references public.firms(id),
  client_id  text        not null,
  part       text        not null default 'work',
  rev        integer     not null default 1,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (firm_id, client_id, part)
);

create table if not exists public.client_books_history (
  id         bigserial   primary key,
  firm_id    uuid        not null references public.firms(id),
  client_id  text        not null,
  part       text        not null,
  rev        integer     not null,
  data       jsonb       not null,
  saved_at   timestamptz not null,
  saved_by   uuid,
  note       text        not null default ''   -- '' = replaced by a newer save; 'conflict' = a copy that lost a merge
);
create index if not exists client_books_history_client on public.client_books_history (firm_id, client_id, part, id desc);

alter table public.client_books enable row level security;
alter table public.client_books_history enable row level security;

drop policy if exists client_books_read on public.client_books;
create policy client_books_read on public.client_books for select
  using (firm_id = my_firm() or is_superadmin());
drop policy if exists client_books_history_read on public.client_books_history;
create policy client_books_history_read on public.client_books_history for select
  using (firm_id = my_firm() or is_superadmin());
-- no insert/update/delete policies: writes go only through save_client_books() below

-- Save a client's part if nobody has saved since `p_base`.
--   p_base = 0  → create it (refused if it already exists)
--   p_base = n  → replace revision n with n+1 (refused if the row is no longer at n)
-- Returns {ok: true, rev} or {ok: false, rev, data, updated_at, updated_by} with what is there now.
create or replace function public.save_client_books(p_client text, p_part text, p_base integer, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  f   uuid := my_firm();
  cur public.client_books%rowtype;
begin
  if f is null or not can_write() then
    raise exception 'not allowed to save for this firm' using errcode = '42501';
  end if;
  if coalesce(p_client, '') = '' or coalesce(p_part, '') = '' then
    raise exception 'client and part are needed';
  end if;

  select * into cur from public.client_books where firm_id = f and client_id = p_client and part = p_part for update;

  if not found then
    if p_base <> 0 then
      return jsonb_build_object('ok', false, 'rev', 0, 'data', '{}'::jsonb);
    end if;
    insert into public.client_books (firm_id, client_id, part, rev, data, updated_by)
    values (f, p_client, p_part, 1, p_data, auth.uid());
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;

  if cur.rev <> p_base then
    return jsonb_build_object('ok', false, 'rev', cur.rev, 'data', cur.data, 'updated_at', cur.updated_at, 'updated_by', cur.updated_by);
  end if;

  insert into public.client_books_history (firm_id, client_id, part, rev, data, saved_at, saved_by)
  values (f, p_client, p_part, cur.rev, cur.data, cur.updated_at, cur.updated_by);

  update public.client_books
     set rev = cur.rev + 1, data = p_data, updated_at = now(), updated_by = auth.uid()
   where firm_id = f and client_id = p_client and part = p_part;

  return jsonb_build_object('ok', true, 'rev', cur.rev + 1);
end;
$$;

-- Keep a copy that lost a merge, so a person can look at it later.
create or replace function public.keep_books_conflict(p_client text, p_part text, p_rev integer, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare f uuid := my_firm();
begin
  if f is null or not can_write() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.client_books_history (firm_id, client_id, part, rev, data, saved_at, saved_by, note)
  values (f, p_client, p_part, coalesce(p_rev, 0), p_data, now(), auth.uid(), 'conflict');
end;
$$;

revoke all on function public.save_client_books(text, text, integer, jsonb) from public, anon;
revoke all on function public.keep_books_conflict(text, text, integer, jsonb) from public, anon;
grant execute on function public.save_client_books(text, text, integer, jsonb) to authenticated;
grant execute on function public.keep_books_conflict(text, text, integer, jsonb) to authenticated;

-- The nightly backup also takes each client's TDS and GST work (same function as before, one more item).
create or replace function public.take_backup(p_firm uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_data jsonb; v_n int := 0;
begin
  for r in select id, name from public.firms where p_firm is null or id = p_firm loop
    select jsonb_build_object(
      'firm', to_jsonb(f) - 'balance',
      'clients', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.clients c where c.firm_id = r.id and not c.deleted),
      'records', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.records x where x.firm_id = r.id and not x.deleted),
      'client_books', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) from public.client_books k where k.firm_id = r.id),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'email', m.email, 'role', m.role, 'active', m.active)), '[]'::jsonb) from public.members m where m.firm_id = r.id)
    ) into v_data from public.firms f where f.id = r.id;

    insert into public.backups (firm_id, clients, records, bytes, data)
    values (r.id,
            coalesce(jsonb_array_length(v_data -> 'clients'), 0),
            coalesce(jsonb_array_length(v_data -> 'records'), 0),
            octet_length(v_data::text), v_data);
    v_n := v_n + 1;
    -- keep the last 14 for each firm
    delete from public.backups b
    where b.firm_id = r.id and b.id not in (
      select id from public.backups where firm_id = r.id order by taken_at desc limit 14);
  end loop;
  return jsonb_build_object('ok', true, 'firms', v_n);
end $function$;
