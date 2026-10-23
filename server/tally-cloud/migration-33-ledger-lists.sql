-- Migration 33 (02-Oct-2026, after migration-32-sync-safety): the owner's three decisions on the ledgers.
-- Adds only: columns, two tables, an index, a trigger and functions (new, or replaced with the same arguments). Nothing is
-- dropped, deleted or revoked from what is there; safe to run again. To be shown to the owner before it runs.
--
--   1. tally_balances            leaves out deleted ledgers (deleted_at set) as well as merged twins; same columns
--   2. group names               compared without regard to capital letters (Tally names the group "Cash-in-hand"):
--                                tally_year_openings (the year's P&L groups) and the chain of groups worked out on a
--                                full list (a ledger's group meets Tally's group whatever its capitals). tally_mis,
--                                tally_mis_head and tally_gst_summary already compare lower(); they are not touched
--   3. full ledger lists          (the bridge's "ledgers" and a person's "upload_ledgers", both through tally-ingest into
--                                tally_ingest_ledgers_g / tally_ingest_ledgers) are add-only: nothing is deleted any more.
--                                A ledger in the list is added or brought up to date (and un-marked if it was marked); one
--                                missing from the list is marked deleted (deleted_at), never removed, with the reason and
--                                the list it was missing from (deleted_reason, deleted_by_list). Every list is kept
--                                (tally_ledger_lists) and every mark, un-mark and hold (tally_ledger_marks, append-only).
--                                Bulk safeguard, the bridge's own (LedgerMassGone): when more ledgers are missing than
--                                25 or 5% of the live ledgers, whichever is more, none is marked on that list: they are
--                                logged 'held', and marked only if the next full list misses them too (a second read).
--                                An empty list never marks anything. A deleted ledger's opening no longer counts in the
--                                year's openings (as before, when it was removed); un-marked, it counts again.
--                                The book's entries are never removed by a list: one starting after entries already kept
--                                is refused (tally-ingest already keeps such a book as it is and does not call this).
--
-- What was marked and why (the owner's query):
--   select m.at, b.company, m.ledger, m.action, m.reason, m.source, m.by_user, m.device_id, m.bridge, m.list_id
--     from tally_ledger_marks m join tally_books b on b.book_id = m.book_id order by m.at desc, m.ledger;

begin;

-- ---------------------------------------------------------------- the ledger's mark, and the lists and marks kept
alter table public.tally_ledgers add column if not exists deleted_at timestamptz;          -- (migration-32; here too)
alter table public.tally_ledgers add column if not exists deleted_reason text;
alter table public.tally_ledgers add column if not exists deleted_by_list jsonb;           -- {list_id, source, at, by, device, bridge, computer, file}

create table if not exists public.tally_ledger_lists (
  list_id        uuid primary key,
  book_id        uuid not null,
  firm_id        uuid not null,
  at             timestamptz not null default now(),
  source         text not null,             -- 'bridge ledgers' (a computer's full list) | 'upload_ledgers' (a person's file) | ...
  by_user        uuid,                      -- the person who uploaded it
  device_id      uuid,                      -- the computer (tally_devices) that sent it
  bridge         text,                      -- the bridge's id (go-..., v1)
  info           jsonb not null default '{}'::jsonb,
  listed         integer not null default 0,
  live_before    integer not null default 0,
  missing        integer not null default 0,
  bulk_limit     integer not null default 0,
  marked         integer not null default 0,
  unmarked       integer not null default 0,
  held           integer not null default 0,
  note           text
);
create index if not exists tally_ledger_lists_book on public.tally_ledger_lists (book_id, at desc);

create table if not exists public.tally_ledger_marks (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  book_id     uuid not null,
  firm_id     uuid not null,
  ledger      text not null,
  action      text not null check (action in ('marked', 'unmarked', 'held')),
  reason      text,
  was_reason  text,                         -- un-marked: why it had been marked
  list_id     uuid,
  source      text,
  by_user     uuid,
  device_id   uuid,
  bridge      text,
  list        jsonb,
  parent      text,
  open_sent   numeric
);
create index if not exists tally_ledger_marks_book on public.tally_ledger_marks (book_id, at desc);
create index if not exists tally_ledger_marks_list on public.tally_ledger_marks (list_id);

alter table public.tally_ledger_lists enable row level security;
alter table public.tally_ledger_marks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_lists' and policyname = 'tally_ledger_lists_read') then
    create policy tally_ledger_lists_read on public.tally_ledger_lists for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_marks' and policyname = 'tally_ledger_marks_read') then
    create policy tally_ledger_marks_read on public.tally_ledger_marks for select to authenticated using (firm_id = my_firm());
  end if;
end $$;

create or replace function public.tally_ledger_marks_frozen() returns trigger language plpgsql as $function$
begin
  raise exception 'tally_ledger_marks is append-only' using errcode = '42501';
end $function$;
create or replace trigger tally_ledger_marks_frozen before update or delete on public.tally_ledger_marks
  for each row execute function public.tally_ledger_marks_frozen();

-- every mark and un-mark of a ledger, whoever makes it (a full list here, or the bridge's ledger list of migration-32):
-- the reason and the list kept on the row and in the log. A full list says why through the setting fincom.ledger_list
-- ({reason, list}); without it the change came from FinCom Bridge's ledger list (deleted or renamed in Tally)
create or replace function public.tally_ledgers_mark_log() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare ctx jsonb; lst jsonb; uid uuid; dev uuid;
begin
  begin ctx := nullif(current_setting('fincom.ledger_list', true), '')::jsonb; exception when others then ctx := null; end;
  lst := coalesce(ctx->'list', jsonb_build_object('source', 'bridge ledger_list', 'at', now()));
  uid := case when lst->>'by' ~* '^[0-9a-f-]{36}$' then (lst->>'by')::uuid end;
  dev := case when lst->>'device' ~* '^[0-9a-f-]{36}$' then (lst->>'device')::uuid end;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_reason := coalesce(ctx->>'reason', 'deleted or renamed in Tally (FinCom Bridge ledger list)');
    new.deleted_by_list := lst;
    insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
    values (new.book_id, new.firm_id, new.name, 'marked', new.deleted_reason, case when lst->>'list_id' ~* '^[0-9a-f-]{36}$' then (lst->>'list_id')::uuid end,
            lst->>'source', uid, dev, lst->>'bridge', lst, new.parent, coalesce(new.open_sent, new.open));
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, was_reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
    values (new.book_id, new.firm_id, new.name, 'unmarked', coalesce(ctx->>'unreason', 'listed again by FinCom Bridge'), old.deleted_reason,
            case when lst->>'list_id' ~* '^[0-9a-f-]{36}$' then (lst->>'list_id')::uuid end, lst->>'source', uid, dev, lst->>'bridge', lst, new.parent, coalesce(new.open_sent, new.open));
    new.deleted_reason := null;
    new.deleted_by_list := null;
  end if;
  return new;
end $function$;
create or replace trigger tally_ledgers_mark_log before update of deleted_at on public.tally_ledgers
  for each row when (old.deleted_at is distinct from new.deleted_at) execute function public.tally_ledgers_mark_log();

-- ---------------------------------------------------------------- 1. balances without deleted ledgers
create or replace view public.tally_balances with (security_invoker = true) as
  select l.book_id, l.firm_id, l.name as ledger, l.parent, l.primary_group, coalesce(l.open, 0) as open,
         coalesce(m.movement, 0) as movement, coalesce(l.open, 0) + coalesce(m.movement, 0) as closing, m.last_day
    from public.tally_ledgers l
    left join (select d.book_id, d.ledger, sum(d.amount) as movement, max(d.day) as last_day
                 from public.tally_ledger_day d join public.tally_books b on b.book_id = d.book_id
                where d.day >= b.from_date group by d.book_id, d.ledger) m on m.book_id = l.book_id and m.ledger = l.name
   where l.merged_into is null and l.deleted_at is null;
grant select on public.tally_balances to authenticated;

-- ---------------------------------------------------------------- 2. the year's openings: P&L groups in any capitals,
-- a deleted ledger's opening not counted, twins among the live ledgers only
create index if not exists tally_groups_lower on public.tally_groups (book_id, lower(name));

create or replace function public.tally_year_openings(p_book uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; moved numeric := 0; n int := 0; twins int := 0;
  pl constant text[] := array['sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses'];
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_ledgers set open_sent = open where book_id = p_book and open_sent is null;
  -- twins (one ledger once its name is cleaned): among the live ledgers; a live ledger whose twin is gone is its own again
  with k as (
    select name, tally_ledger_key(name) as key,
           row_number() over (partition by tally_ledger_key(name) order by (parent <> '') desc, (name = tally_ledger_key(name)) desc, name) as rn,
           count(*) over (partition by tally_ledger_key(name)) as c
      from tally_ledgers where book_id = p_book and deleted_at is null
  ), want as (
    select k.name, case when k.c > 1 and k.rn > 1 then h.name end as m from k left join k h on h.key = k.key and h.rn = 1
  )
  update tally_ledgers l set merged_into = w.m
    from want w where l.book_id = p_book and l.name = w.name and l.merged_into is distinct from w.m;
  get diagnostics twins = row_count;
  update tally_ledgers l set open = case when l.merged_into is null and l.deleted_at is null then l.open_sent else 0 end where l.book_id = p_book;
  update tally_ledgers l set open = l.open + s.x
    from (select merged_into, sum(open_sent) x from tally_ledgers where book_id = p_book and merged_into is not null and deleted_at is null group by merged_into) s
   where l.book_id = p_book and l.name = s.merged_into;
  if fd is null or to_char(fd, 'MM-DD') <> '04-01' then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  select coalesce(sum(open), 0), count(*) into moved, n
    from tally_ledgers where book_id = p_book and merged_into is null and deleted_at is null and lower(primary_group) = any(pl) and open <> 0;
  if n = 0 then return jsonb_build_object('ok', true, 'moved', 0, 'ledgers', 0, 'twins', twins); end if;
  update tally_ledgers set open = 0 where book_id = p_book and merged_into is null and deleted_at is null and lower(primary_group) = any(pl) and open <> 0;
  insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent) values (p_book, f, 'Profit & Loss A/c', '', moved, 0)
  on conflict (book_id, name) do update set open = tally_ledgers.open + excluded.open;
  return jsonb_build_object('ok', true, 'moved', moved, 'ledgers', n, 'twins', twins);
end $function$;

-- ---------------------------------------------------------------- 3. a full ledger list, add-only
-- p_list: {source, by (user id), device (device id), bridge, computer, user, file}
create or replace function public.tally_ingest_ledgers_list(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_list jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; fd date; lid uuid := gen_random_uuid(); lst jsonb; src text; usr uuid; dev uuid; brg text;
  names text[]; listed int; live_before int; gone text[]; pend text[]; to_mark text[]; to_hold text[]; lim int;
  n_marked int := 0; n_unmarked int := 0; prev uuid; note text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- a list never removes entries: one starting after entries already kept is refused, nothing changed
  if fd is not null and p_from > fd and exists (select 1 from tally_vouchers where book_id = p_book and day < p_from) then
    raise exception 'This ledger list starts on % but the copy has entries before it; nothing was changed.', p_from using errcode = '22023';
  end if;
  src := left(coalesce(nullif(btrim(p_list->>'source'), ''), 'unknown'), 60);
  usr := case when p_list->>'by' ~* '^[0-9a-f-]{36}$' then (p_list->>'by')::uuid end;
  dev := case when p_list->>'device' ~* '^[0-9a-f-]{36}$' then (p_list->>'device')::uuid end;
  brg := left(nullif(p_list->>'bridge', ''), 40);
  lst := jsonb_strip_nulls(jsonb_build_object('list_id', lid, 'source', src, 'at', now(), 'by', usr, 'device', dev, 'bridge', brg,
           'computer', left(p_list->>'computer', 60), 'user', left(p_list->>'user', 60), 'file', left(p_list->>'file', 200)));
  select count(*) into live_before from tally_ledgers where book_id = p_book and deleted_at is null;
  update tally_books set from_date = p_from, open_as_on = p_open_as_on, ledgers_at = now() where book_id = p_book;

  -- the ledgers listed: added, or brought up to date as a fresh row would be (the year's openings work out the rest);
  -- one marked before is un-marked (the trigger logs it)
  perform set_config('fincom.ledger_list', jsonb_build_object('unreason', 'listed again in a full list', 'list', lst)::text, true);
  insert into tally_ledgers as t (book_id, firm_id, name, parent, open, chain, primary_group, open_sent, merged_into, deleted_at)
  select p_book, f, nm,
         coalesce((array_agg(par order by (raw = nm) desc, raw) filter (where par <> ''))[1], ''),
         sum(op), '{}'::text[], '', null, null, null
    from (select distinct on (x->>0) x->>0 as raw, tally_nm(x->>0) as nm, tally_nm(x->>1) as par, coalesce(nullif(x->>2, '')::numeric, 0) as op
            from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) x order by x->>0) s
   where nm <> ''
   group by nm
  on conflict (book_id, name) do update set parent = excluded.parent, open = excluded.open, chain = '{}'::text[], primary_group = '',
     open_sent = null, merged_into = null, deleted_at = null;
  select coalesce(array_agg(distinct tally_nm(x->>0)) filter (where tally_nm(x->>0) <> ''), '{}') into names from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) x;
  listed := coalesce(array_length(names, 1), 0);
  select count(*) into n_unmarked from tally_ledger_marks where list_id = lid and action = 'unmarked';

  -- the live ledgers missing from the list (not FinCom's own Profit & Loss A/c, made by the year's openings)
  select coalesce(array_agg(name order by name), '{}') into gone from tally_ledgers
   where book_id = p_book and deleted_at is null and name <> all(names) and name <> 'Profit & Loss A/c';
  lim := greatest(25, live_before / 20);
  if listed = 0 then
    to_mark := '{}'; to_hold := gone; note := 'an empty list: nothing marked';
  elsif coalesce(array_length(gone, 1), 0) > lim then
    -- too many at once: marked only those the last full list of this book held too (the second read); the rest held
    select list_id into prev from tally_ledger_lists where book_id = p_book order by at desc limit 1;
    select coalesce(array_agg(distinct ledger), '{}') into pend from tally_ledger_marks where list_id = prev and action = 'held';
    select coalesce(array_agg(g), '{}') into to_mark from unnest(gone) g where g = any(pend);
    select coalesce(array_agg(g), '{}') into to_hold from unnest(gone) g where not (g = any(pend));
    note := format('%s missing, more than %s at once: held for a second read', array_length(gone, 1), lim)
            || case when array_length(to_mark, 1) > 0 then format('; %s missing in the last list too, marked', array_length(to_mark, 1)) else '' end;
  else
    to_mark := gone; to_hold := '{}';
  end if;

  if array_length(to_mark, 1) > 0 then
    perform set_config('fincom.ledger_list', jsonb_build_object('reason',
      case when note is null then 'missing from full list' else 'missing from full list (and from the list before, which held it)' end, 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = any(to_mark) and deleted_at is null;
    get diagnostics n_marked = row_count;
  end if;
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
  select p_book, f, l.name, 'held', coalesce(note, 'held'), lid, src, usr, dev, brg, lst, l.parent, coalesce(l.open_sent, l.open)
    from tally_ledgers l where l.book_id = p_book and l.name = any(to_hold);
  perform set_config('fincom.ledger_list', '', true);

  insert into tally_ledger_lists (list_id, book_id, firm_id, source, by_user, device_id, bridge, info, listed, live_before, missing, bulk_limit, marked, unmarked, held, note)
  values (lid, p_book, f, src, usr, dev, brg, lst, listed, live_before, coalesce(array_length(gone, 1), 0), lim, n_marked, n_unmarked, coalesce(array_length(to_hold, 1), 0), note);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(coalesce(p_ledgers, '[]'::jsonb)), 'list', lid, 'marked', n_marked, 'unmarked', n_unmarked,
                            'held', coalesce(array_length(to_hold, 1), 0), 'missing', coalesce(array_length(gone, 1), 0), 'note', note);
end $function$;

-- the full list with Tally's groups: groups added or changed (none removed), each ledger's chain worked out with group
-- names met whatever their capitals, then the year's openings
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb, p_list jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid; n_groups int := 0; yo jsonb; r jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  r := public.tally_ingest_ledgers_list(p_book, p_from, p_open_as_on, p_ledgers, p_list);
  if jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) > 0 then
    insert into tally_groups (book_id, firm_id, name, parent)
    select distinct on (tally_nm(x->>0)) p_book, f, tally_nm(x->>0), tally_nm(x->>1) from jsonb_array_elements(p_groups) x where tally_nm(x->>0) <> ''
     order by tally_nm(x->>0), (tally_nm(x->>1) <> '') desc, (x->>0 = tally_nm(x->>0)) desc
    on conflict (book_id, name) do update set parent = excluded.parent;
    get diagnostics n_groups = row_count;
  end if;
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain
      from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, g.parent, u.depth + 1, u.chain || g.parent
      from up u join tally_groups g on g.book_id = p_book and lower(g.name) = lower(u.grp)
     where g.parent <> '' and u.depth < 30 and not (lower(g.parent) = any(select lower(c) from unnest(u.chain) c))
  ), best as (
    select distinct on (ledger) ledger, chain from up order by ledger, depth desc, chain
  )
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)]
    from best b where l.book_id = p_book and l.name = b.ledger;
  yo := public.tally_year_openings(p_book);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(coalesce(p_ledgers, '[]'::jsonb)), 'groups', n_groups, 'yearOpenings', yo)
         || jsonb_build_object('list', r->'list', 'marked', r->'marked', 'unmarked', r->'unmarked', 'held', r->'held', 'missing', r->'missing', 'note', r->'note');
end $function$;

-- the earlier calls (tally-ingest before it is deployed again), add-only from now on, their list's source unknown
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public.tally_ingest_ledgers_g(p_book, p_from, p_open_as_on, p_ledgers, p_groups, '{"source": "full list (source not given)"}'::jsonb);
end $function$;

create or replace function public.tally_ingest_ledgers(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public.tally_ingest_ledgers_list(p_book, p_from, p_open_as_on, p_ledgers, '{"source": "full list (source not given)"}'::jsonb);
end $function$;

-- the new functions: the service role only (tally-ingest), as the ones they stand beside
revoke all on function public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb), public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb), public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb) to service_role;

commit;
