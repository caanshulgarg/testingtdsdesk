-- Migration 34 (02-Oct-2026, round 2 item 3a; written after migration-35, which the owner has run): a ledger list can
-- never mark a ledger wrongly. Adds only: columns, one table, one trigger and functions (new, or replaced with the same
-- arguments). Nothing is dropped, deleted or revoked from what is there; safe to run again; works on top of migration-35
-- as the owner ran it (its functions searching 'public') and on top of the revised 35 (public, pg_temp). To be shown to
-- the owner before it runs.
--
--   A. the guard         a ledger with any entry (tally_ledger_day, under its name or an old name of its), a non-zero
--                        opening, or renamed in the last 30 days (its days may still be under the old name) is never
--                        marked deleted, whoever tries (a full list, the bridge's ledger list, a hand update): the mark
--                        is undone on the row and logged 'held' in tally_ledger_marks with the reason ('has entries' /
--                        'has entries under an old name' / 'non-zero opening' / 'renamed recently'). Trigger
--                        tally_ledgers_a_guard, which runs before tally_ledgers_mark_log; the reason worked out by
--                        tally_ledger_hold_reason, which the rename below asks too
--   B. rounds            FinCom Bridge 2.1.5 reads the ledger list in batches of 2,000 and sends each batch with the id
--                        of its read (round), whether the read is complete, how many GUIDs it read in the whole round
--                        (rowsRead, poison ledgers included) and the GUIDs read (seen, split over the batches). The
--                        cloud sends nothing back to re-send: tally_ledger_round_batch records the batch and stamps the
--                        rows seen (seen_round, seen_at); tally_ledgers_mark_gone(book, round), called once on the last
--                        batch, marks the live ledgers with a GUID the round did not see, by GUID only, never by name,
--                        and only when the round is complete, the bridge read ledgers (rowsRead > 0) and every batch
--                        arrived (the GUIDs seen add up to rowsRead); else all held with the note. More than
--                        greatest(25, 5% of the live ledgers) missing at once: only those the book's previous complete
--                        round missed too are marked (missing twice), the rest held; the next complete round decides
--                        by itself. The guard still keeps each row with entries, an opening or a recent rename. A twin
--                        (merged_into) or a row with no GUID is never counted. A rogue key cannot bloat the tables: at
--                        most 50 new rounds a day per book (54000), no per-ledger marks for an unknown round, and one
--                        'held' mark per round and ledger while a round is incomplete; the outcome noted on the round
--   C. renames by GUID   tally_ledger_rename: the row found by GUID (else by the old name, which then takes the GUID);
--                        the new name held by another GUID: refused with a note; held by a row with no GUID (or the
--                        same): the old row marked merged (deleted_at, its GUID moved to the other row) - but when the
--                        guard would keep the old row (entries, an opening, renamed recently) the merge is refused with
--                        a note and nothing changes (no GUID moved or nulled); a plain rename stamps renamed_at; the old
--                        name kept in before_clean.renamed once that column exists (migration-31)
--   D. full lists        tally_ingest_ledgers_list / tally_ingest_ledgers_g gain p_complete and p_count: a full list
--                        (the bridge's trial-balance list, a person's upload) marks nothing unless its sender declares
--                        it complete with a count equal to the names listed. The older signatures keep working and
--                        mark nothing (held, 'list not declared complete'). A trial-balance file never says complete
--   E. approve           tally_release_approve also refuses while the pilot computer's bridge reports its request
--                        allow-list unmeasured, or has not said (pilot_allowlist_measured / pilot_allowlist_hash on
--                        tally_bridge_releases, written by the beat; a new pilot starts them again)
--   F. grants            the service role only for the new functions (tally-ingest); members of the firm read the
--                        rounds; the rounds cannot be deleted. Every function here: security definer, public, pg_temp

begin;

-- ---------------------------------------------------------------- A. the guard
alter table public.tally_ledgers add column if not exists renamed_at timestamptz;   -- the last rename (tally_ledger_rename)
alter table public.tally_ledgers add column if not exists seen_round text;          -- the last ledger-list round that read the row's GUID
alter table public.tally_ledgers add column if not exists seen_at timestamptz;

-- why a row may not be marked deleted (null: it may): entries under its name, entries under an old name of its
-- (before_clean.renamed, once migration-31 adds the column: read from the row's json, so it works without it), a
-- non-zero opening, or a rename in the last 30 days
create or replace function public.tally_ledger_hold_reason(l public.tally_ledgers) returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare olds text[];
begin
  if exists (select 1 from tally_ledger_day d where d.book_id = l.book_id and d.ledger = l.name) then return 'has entries'; end if;
  begin
    select coalesce(array_agg(x->>'from'), '{}') into olds from jsonb_array_elements(coalesce(to_jsonb(l)->'before_clean'->'renamed', '[]'::jsonb)) x where x->>'from' is not null;
  exception when others then olds := '{}'; end;
  if coalesce(array_length(olds, 1), 0) > 0 and exists (select 1 from tally_ledger_day d where d.book_id = l.book_id and d.ledger = any(olds)) then return 'has entries under an old name'; end if;
  if coalesce(l.open_sent, l.open, 0) <> 0 then return 'non-zero opening'; end if;
  if l.renamed_at is not null and l.renamed_at > now() - interval '30 days' then return 'renamed recently'; end if;
  return null;
end $function$;

create or replace function public.tally_ledgers_a_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare why text; ctx jsonb; lst jsonb; uid uuid; dev uuid;
begin
  if old.deleted_at is not null or new.deleted_at is null then return new; end if;
  why := public.tally_ledger_hold_reason(new);
  if why is null then return new; end if;
  -- the mark undone; the row stays as it was
  new.deleted_at := null; new.deleted_reason := old.deleted_reason; new.deleted_by_list := old.deleted_by_list;
  begin ctx := nullif(current_setting('fincom.ledger_list', true), '')::jsonb; exception when others then ctx := null; end;
  lst := coalesce(ctx->'list', jsonb_build_object('source', 'bridge ledger_list', 'at', now()));
  uid := case when lst->>'by' ~* '^[0-9a-f-]{36}$' then (lst->>'by')::uuid end;
  dev := case when lst->>'device' ~* '^[0-9a-f-]{36}$' then (lst->>'device')::uuid end;
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
  values (new.book_id, new.firm_id, new.name, 'held', why || ': not marked' || coalesce(' (' || (ctx->>'reason') || ')', ''),
          case when lst->>'list_id' ~* '^[0-9a-f-]{36}$' then (lst->>'list_id')::uuid end, lst->>'source', uid, dev, lst->>'bridge', lst, new.parent, coalesce(new.open_sent, new.open));
  return new;
end $function$;
-- named to run before tally_ledgers_mark_log (triggers fire in name order): the log then sees no mark
create or replace trigger tally_ledgers_a_guard before update of deleted_at on public.tally_ledgers
  for each row when (old.deleted_at is null and new.deleted_at is not null) execute function public.tally_ledgers_a_guard();

-- ---------------------------------------------------------------- B. rounds
create table if not exists public.tally_ledger_rounds (
  book_id        uuid not null,
  round_id       text not null,                       -- the bridge's id for one complete read of the ledger list
  firm_id        uuid not null,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  batches        integer not null default 0,          -- ledger_list calls received for it
  rows_received  integer not null default 0,          -- rows in them (new or changed ledgers)
  rows_read      integer,                             -- the bridge's count of ledgers with a GUID in the whole list
  complete       boolean,                             -- the bridge says the read finished
  device_id      uuid,
  bridge         text,
  note           text,                                -- what tally_ledgers_mark_gone did
  primary key (book_id, round_id)
);
create index if not exists tally_ledger_rounds_book on public.tally_ledger_rounds (book_id, started_at desc);
alter table public.tally_ledger_rounds enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_rounds' and policyname = 'tally_ledger_rounds_read') then
    create policy tally_ledger_rounds_read on public.tally_ledger_rounds for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_ledger_rounds to authenticated;
revoke insert, update, delete, truncate on public.tally_ledger_rounds from anon, authenticated;
-- the rounds are kept, never deleted (the same rule as tally_read_stops / tally_bridge_releases, migration-35)
create or replace function public.tally_control_kept() returns trigger language plpgsql as $function$
begin
  raise exception '% rows are kept, never deleted', tg_table_name using errcode = '42501';
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_ledger_rounds_kept' and tgrelid = 'public.tally_ledger_rounds'::regclass) then
    create trigger tally_ledger_rounds_kept before delete on public.tally_ledger_rounds for each row execute function public.tally_control_kept();
  end if;
end $$;

alter table public.tally_ledger_rounds add column if not exists seen_n integer not null default 0;   -- GUIDs seen, summed over the batches

-- a batch of a round: the row made or brought up to date (batches, rows, seen, and the bridge's complete / rowsRead when
-- sent); the rows whose GUID the batch saw stamped with the round. A new round is refused (54000) when the book has
-- had more than 50 in the last 24 hours (a rogue key cannot bloat the rounds, which are never deleted)
create or replace function public.tally_ledger_round_batch(p_book uuid, p_round text, p_rows integer, p_rows_read integer, p_complete boolean, p_device uuid, p_bridge text, p_seen jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; seen text[] := '{}'; n_seen int := 0; n_day int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if rid = '' then raise exception 'a round id is needed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  if not exists (select 1 from tally_ledger_rounds where book_id = p_book and round_id = rid) then
    select count(*) into n_day from tally_ledger_rounds where book_id = p_book and started_at > now() - interval '24 hours';
    if n_day > 50 then raise exception 'this book has had % ledger-list rounds in the last 24 hours; no new round until tomorrow', n_day using errcode = '54000'; end if;
  end if;
  if jsonb_typeof(p_seen) = 'array' then
    n_seen := jsonb_array_length(p_seen);
    select coalesce(array_agg(distinct g), '{}') into seen from (select nullif(btrim(x #>> '{}'), '') as g from jsonb_array_elements(p_seen) x) s where g is not null;
  end if;
  insert into tally_ledger_rounds (book_id, round_id, firm_id, batches, rows_received, rows_read, complete, device_id, bridge, seen_n)
  values (p_book, rid, f, 1, greatest(0, coalesce(p_rows, 0)), p_rows_read, p_complete, p_device, left(nullif(p_bridge, ''), 40), n_seen)
  on conflict (book_id, round_id) do update set last_seen_at = now(), batches = tally_ledger_rounds.batches + 1,
     rows_received = tally_ledger_rounds.rows_received + greatest(0, coalesce(p_rows, 0)), seen_n = tally_ledger_rounds.seen_n + excluded.seen_n,
     rows_read = coalesce(excluded.rows_read, tally_ledger_rounds.rows_read), complete = coalesce(excluded.complete, tally_ledger_rounds.complete),
     device_id = coalesce(excluded.device_id, tally_ledger_rounds.device_id), bridge = coalesce(excluded.bridge, tally_ledger_rounds.bridge)
  returning * into r;
  if array_length(seen, 1) > 0 then
    update tally_ledgers set seen_round = rid, seen_at = now() where book_id = p_book and tally_guid = any(seen) and seen_round is distinct from rid;
  end if;
  return jsonb_build_object('ok', true, 'round', r.round_id, 'batches', r.batches, 'rows', r.rows_received, 'rowsRead', r.rows_read, 'complete', r.complete, 'seen', r.seen_n);
end $function$;
-- the 7-argument call (no seen): kept for safety; such a round sees nothing and so marks nothing
create or replace function public.tally_ledger_round_batch(p_book uuid, p_round text, p_rows integer, p_rows_read integer, p_complete boolean, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ledger_round_batch(p_book, p_round, p_rows, p_rows_read, p_complete, p_device, p_bridge, null::jsonb);
end $function$;

-- the ledgers a round did not see: the live rows with a GUID (deleted_at null, merged_into null) whose seen_round is
-- not this round, marked by GUID only when the round is complete, the bridge read ledgers and every batch arrived
-- (seen_n = rows_read); else all held with the note (one 'held' mark per round and ledger; none at all for a round
-- never recorded). Over the bulk limit greatest(25, 5% of the live ledgers): only the rows the book's previous
-- complete round did not see either are marked (missing twice), the rest held. The guard keeps each row with
-- entries, an opening or a recent rename. The bridge re-sends nothing: the next complete round decides again
create or replace function public.tally_ledgers_mark_gone(p_book uuid, p_round text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; names text[]; n_gone int; live int; lim int; outcome text;
  to_mark text[] := '{}'; to_hold text[] := '{}'; prev text; n_marked int := 0; n_held int := 0; lst jsonb; done boolean := false; n_logged int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select * into r from tally_ledger_rounds where book_id = p_book and round_id = rid;
  select coalesce(array_agg(name order by name), '{}') into names from tally_ledgers
   where book_id = p_book and deleted_at is null and merged_into is null and tally_guid is not null and seen_round is distinct from rid;
  n_gone := coalesce(array_length(names, 1), 0);
  select count(*) into live from tally_ledgers where book_id = p_book and deleted_at is null and merged_into is null;
  lst := jsonb_strip_nulls(jsonb_build_object('source', 'bridge ledger_list', 'round', rid, 'at', now(), 'device', r.device_id, 'bridge', r.bridge));
  if r.book_id is null then
    outcome := 'no such round: nothing marked';
    return jsonb_build_object('ok', true, 'marked', 0, 'held', 0, 'gone', n_gone, 'note', outcome);
  end if;
  done := r.complete is true and coalesce(r.rows_read, 0) > 0 and r.seen_n = r.rows_read;
  if n_gone = 0 then
    outcome := 'nothing to mark: the round saw every live ledger with a GUID';
  elsif r.complete is distinct from true then
    outcome := format('round not complete: nothing marked (%s not seen, held)', n_gone); to_hold := names;
  elsif coalesce(r.rows_read, 0) <= 0 then
    outcome := format('the bridge read no ledgers (rowsRead 0): nothing marked (%s not seen, held)', n_gone); to_hold := names;
  elsif not done then
    outcome := format('%s of %s GUIDs seen (a batch missing): nothing marked (%s not seen, held)', r.seen_n, r.rows_read, n_gone); to_hold := names;
  else
    lim := greatest(25, live / 20);
    if n_gone > lim then
      -- too many at once: marked only those the previous complete round did not see either; the rest held
      select round_id into prev from tally_ledger_rounds where book_id = p_book and round_id <> rid and started_at < r.started_at
        and complete is true and coalesce(rows_read, 0) > 0 and seen_n = rows_read order by started_at desc limit 1;
      if prev is not null then
        select coalesce(array_agg(l.name order by l.name), '{}') into to_mark from tally_ledgers l where l.book_id = p_book and l.name = any(names) and l.seen_round is distinct from prev;
      end if;
      select coalesce(array_agg(g), '{}') into to_hold from unnest(names) g where not (g = any(to_mark));
      outcome := format('%s not seen, more than %s at once: held for a second read (the next complete round)', n_gone, lim)
              || case when array_length(to_mark, 1) > 0 then format('; %s not seen by the round before (%s) either, marked', array_length(to_mark, 1), prev) else '' end;
    else
      to_mark := names;
    end if;
  end if;
  if array_length(to_mark, 1) > 0 then
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', 'not seen in Tally''s ledger list (FinCom Bridge, round ' || rid || ')', 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = any(to_mark) and deleted_at is null;
    perform set_config('fincom.ledger_list', '', true);
    -- the guard may have kept some (logged 'held' by it)
    select count(*) into n_marked from tally_ledgers where book_id = p_book and name = any(to_mark) and deleted_at is not null;
    n_held := array_length(to_mark, 1) - n_marked;
    if n_held > 0 then outcome := coalesce(outcome || '; ', '') || format('%s kept by the guard (entries, an opening or a recent rename)', n_held); end if;
  end if;
  -- the held ones logged once per round and ledger (a round asked again writes nothing more)
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, source, device_id, bridge, list, parent, open_sent)
  select p_book, f, l.name, 'held', coalesce(outcome, 'held'), 'bridge ledger_list', r.device_id, r.bridge, lst, l.parent, coalesce(l.open_sent, l.open)
    from tally_ledgers l where l.book_id = p_book and l.name = any(to_hold)
     and not exists (select 1 from tally_ledger_marks m where m.book_id = p_book and m.ledger = l.name and m.action = 'held' and m.list->>'round' = rid);
  get diagnostics n_logged = row_count;
  n_held := n_held + coalesce(array_length(to_hold, 1), 0);
  update tally_ledger_rounds set note = left(outcome, 300), last_seen_at = now() where book_id = p_book and round_id = rid;
  return jsonb_build_object('ok', true, 'marked', n_marked, 'held', n_held, 'gone', n_gone, 'logged', n_logged, 'note', outcome);
end $function$;
-- the 3-argument call of the first draft (a 'deleted' list from the bridge): the list is ignored, the round's seen GUIDs decide
create or replace function public.tally_ledgers_mark_gone(p_book uuid, p_round text, p_gone jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ledgers_mark_gone(p_book, p_round) || jsonb_build_object('ignored', jsonb_array_length(coalesce(p_gone, '[]'::jsonb)));
end $function$;

-- ---------------------------------------------------------------- C. renames by GUID
create or replace function public.tally_ledger_rename(p_book uuid, p_guid text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); frm text := left(btrim(coalesce(p_from, '')), 300); dst text := left(btrim(coalesce(p_to, '')), 300);
  row_name text; row_guid text; other_name text; other_guid text; hist boolean; kept boolean; why text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if dst = '' then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no new name'); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- the row: by its GUID (a live row first), else by the old name where no GUID is held yet
  if g is not null then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and tally_guid = g order by (deleted_at is null) desc limit 1;
  end if;
  if row_name is null and frm <> '' then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and name = frm and tally_guid is null;
  end if;
  if row_name is null then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no such ledger: ' || frm); end if;
  if row_name = dst then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'already named so'); end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_ledgers' and column_name = 'before_clean') into hist;
  select name, tally_guid into other_name, other_guid from tally_ledgers where book_id = p_book and name = dst;
  if other_name is not null then
    if other_guid is not null and g is not null and other_guid <> g then
      return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
        'note', format('rename %s -> %s: that name is another ledger''s (GUID %s); left', row_name, dst, other_guid));
    end if;
    -- the old row merged into the one with the new name: marked, its GUID moved over. When the guard would keep the
    -- old row (entries, an opening, renamed recently) the merge is refused and nothing changes
    select public.tally_ledger_hold_reason(l) into why from tally_ledgers l where l.book_id = p_book and l.name = row_name;
    if why is not null then
      return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
        'note', format('rename %s -> %s: that name is a row of its own and %s %s; the merge refused, nothing changed', row_name, dst, row_name, why));
    end if;
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('renamed in Tally to %s (merged into the row with that name)', dst),
      'list', jsonb_build_object('source', 'bridge ledger_list', 'at', now(), 'renamed', jsonb_build_object('from', row_name, 'to', dst, 'guid', g)))::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', '', true);
    select deleted_at is null into kept from tally_ledgers where book_id = p_book and name = row_name;
    if kept then
      -- the guard kept it after all: the GUID stays where it is
      return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
        'note', format('rename %s -> %s: the old row kept live by the guard; the merge refused, nothing changed', row_name, dst));
    end if;
    update tally_ledgers set tally_guid = null where book_id = p_book and name = row_name;
    if g is not null and other_guid is null then update tally_ledgers set tally_guid = g where book_id = p_book and name = dst; end if;
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'to', dst, 'at', now(), 'merged', true, 'guid', g), p_book, row_name;
    end if;
    return jsonb_build_object('ok', true, 'renamed', false, 'merged', true, 'from', row_name, 'to', dst,
      'note', format('%s -> %s: the old row marked merged, the row with the new name takes the GUID', row_name, dst));
  end if;
  update tally_ledgers set name = dst, tally_guid = coalesce(tally_guid, g), renamed_at = now() where book_id = p_book and name = row_name;
  if hist then
    execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
      using jsonb_build_object('from', row_name, 'at', now()), p_book, dst;
  end if;
  return jsonb_build_object('ok', true, 'renamed', true, 'from', row_name, 'to', dst, 'guid', coalesce(row_guid, g));
end $function$;

-- ---------------------------------------------------------------- D. full lists: nothing marked unless declared complete
-- migration-33's function with two more arguments; the lists' names are compared as before. No defaults on the new
-- arguments (a default would make the 5-argument calls ambiguous); the older signatures below delegate here
create or replace function public.tally_ingest_ledgers_list(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_list jsonb, p_complete boolean, p_count integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; fd date; lid uuid := gen_random_uuid(); lst jsonb; src text; usr uuid; dev uuid; brg text;
  names text[]; listed int; live_before int; gone text[]; pend text[]; to_mark text[]; to_hold text[]; lim int;
  n_marked int := 0; n_unmarked int := 0; prev uuid; note text; declared boolean;
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
           'computer', left(p_list->>'computer', 60), 'user', left(p_list->>'user', 60), 'file', left(p_list->>'file', 200),
           'complete', coalesce(p_complete, false), 'count', p_count));
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
  -- migration-34: a list marks nothing unless its sender declares it complete with a count equal to the names listed
  declared := coalesce(p_complete, false) and p_count is not null and p_count = listed;
  if listed = 0 then
    to_mark := '{}'; to_hold := gone; note := 'an empty list: nothing marked';
  elsif not declared then
    to_mark := '{}'; to_hold := gone;
    note := case when not coalesce(p_complete, false) then 'list not declared complete: nothing marked'
                 else format('list declared complete with %s ledgers but %s names listed (count mismatch): nothing marked', p_count, listed) end;
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
    -- the guard (migration-34) keeps a row with entries or an opening, logged 'held' by it
    select count(*) into n_marked from tally_ledgers where book_id = p_book and name = any(to_mark) and deleted_at is not null;
    if n_marked < array_length(to_mark, 1) then note := coalesce(note || '; ', '') || format('%s kept by the guard (entries or an opening)', array_length(to_mark, 1) - n_marked); end if;
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

-- the full list with Tally's groups (migration-33), with the declaration passed through
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb, p_list jsonb, p_complete boolean, p_count integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; n_groups int := 0; yo jsonb; r jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  r := public.tally_ingest_ledgers_list(p_book, p_from, p_open_as_on, p_ledgers, p_list, p_complete, p_count);
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

-- the signatures of migration-33 (tally-ingest as deployed, the bridge's trial-balance list): not declared complete,
-- so they add, bring up to date and un-mark, and mark nothing
create or replace function public.tally_ingest_ledgers_list(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_list jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_ledgers_list(p_book, p_from, p_open_as_on, p_ledgers, p_list, false, null::integer);
end $function$;
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb, p_list jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_ledgers_g(p_book, p_from, p_open_as_on, p_ledgers, p_groups, p_list, false, null::integer);
end $function$;
create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_ledgers_g(p_book, p_from, p_open_as_on, p_ledgers, p_groups, '{"source": "full list (source not given)"}'::jsonb, false, null::integer);
end $function$;
create or replace function public.tally_ingest_ledgers(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_ledgers_list(p_book, p_from, p_open_as_on, p_ledgers, '{"source": "full list (source not given)"}'::jsonb, false, null::integer);
end $function$;

-- ---------------------------------------------------------------- E. approve waits for a measured allow-list
alter table public.tally_bridge_releases add column if not exists pilot_allowlist_measured boolean;   -- the pilot's latest beat: every request timed
alter table public.tally_bridge_releases add column if not exists pilot_allowlist_hash text;         --   and the allow-list it runs with

-- migration-35's function, the same arguments: a new pilot also starts the allow-list evidence again
create or replace function public.tally_release_pilot(p_version text, p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can start a pilot' using errcode = '42501'; end if;
  if v !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' then raise exception 'not a bridge version (like 2.1.5)'; end if;
  if p_device is null or not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = f and not coalesce(d.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if found and r.approved_at is not null then raise exception 'version % is approved for all computers already', v; end if;
  if found and r.pilot_device = p_device and r.pilot_started_at is not null then
    return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', r.pilot_started_at, 'already', true);
  end if;
  -- a new pilot (or another pilot computer): the working day starts again, with no evidence yet
  insert into tally_bridge_releases (firm_id, version, pilot_device, pilot_started_at, pilot_by) values (f, v, p_device, now(), auth.uid())
  on conflict (firm_id, version) do update set pilot_device = excluded.pilot_device, pilot_started_at = excluded.pilot_started_at, pilot_by = excluded.pilot_by,
    pilot_seen_at = null, pilot_last_seen_at = null, pilot_beats = 0, pilot_self_stop = null, pilot_allowlist_measured = null, pilot_allowlist_hash = null;
  return jsonb_build_object('ok', true, 'version', v, 'pilot', p_device, 'started', now());
end $function$;

-- migration-35's function, the same arguments, one more refusal: the pilot's bridge must report its allow-list measured
create or replace function public.tally_release_approve(p_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); v text := btrim(coalesce(p_version, '')); r tally_bridge_releases%rowtype; pc text;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can approve a bridge version' using errcode = '42501'; end if;
  select * into r from tally_bridge_releases where firm_id = f and version = v for update;
  if not found or r.pilot_started_at is null or r.pilot_device is null then raise exception 'version % has not been on a pilot computer; start a pilot first', v; end if;
  if r.approved_at is not null then return jsonb_build_object('ok', true, 'version', v, 'approved', r.approved_at, 'already', true); end if;
  select name into pc from tally_devices where id = r.pilot_device;
  pc := coalesce(pc, 'the pilot computer');
  -- a working day on the pilot: 20 hours since it started, seen on the version, used on it for 6 hours, never self-stopped
  if r.pilot_started_at > now() - interval '20 hours' then
    raise exception 'the pilot of % on % has not run a working day yet: it started %; approve after %', v, pc,
      to_char(r.pilot_started_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char((r.pilot_started_at + interval '20 hours') at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_seen_at is null or r.pilot_seen_at < r.pilot_started_at then
    raise exception '% has not been seen running % since the pilot started; it must run it first', pc, v;
  end if;
  if coalesce(r.pilot_last_seen_at, r.pilot_seen_at) < r.pilot_seen_at + interval '6 hours' then
    raise exception '% has run % for less than 6 hours (seen % to %); let it run a working day', pc, v,
      to_char(r.pilot_seen_at at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'), to_char(coalesce(r.pilot_last_seen_at, r.pilot_seen_at) at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI');
  end if;
  if r.pilot_self_stop is not null then
    raise exception '% stopped reading by itself while on % (%); not approved', pc, v, coalesce(r.pilot_self_stop ->> 'reason', '');
  end if;
  -- migration-34: every Tally request on its allow-list must have been timed on the pilot (the bridge says so in its beat)
  if r.pilot_allowlist_measured is distinct from true then
    raise exception '% reports its request allow-list on % as %; every request must be measured before the version goes to other computers', pc, v,
      case when r.pilot_allowlist_measured is null then 'not yet reported' else 'not measured' end;
  end if;
  update tally_bridge_releases set approved_at = now(), approved_by = auth.uid() where firm_id = f and version = v;
  return jsonb_build_object('ok', true, 'version', v, 'approved', now());
end $function$;

-- ---------------------------------------------------------------- F. who may call
-- the service role only (tally-ingest) for the ingest functions, as migration-33; owners' functions for signed-in people, as migration-35
revoke all on function public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text), public.tally_ledgers_mark_gone(uuid, text, jsonb),
  public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb), public.tally_ledgers_mark_gone(uuid, text), public.tally_ledger_hold_reason(public.tally_ledgers),
  public.tally_ledger_rename(uuid, text, text, text), public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb, boolean, integer),
  public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb, boolean, integer), public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb),
  public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb), public.tally_ledgers_a_guard() from public, anon, authenticated;
grant execute on function public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text), public.tally_ledgers_mark_gone(uuid, text, jsonb),
  public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb), public.tally_ledgers_mark_gone(uuid, text),
  public.tally_ledger_rename(uuid, text, text, text), public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb, boolean, integer),
  public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb, boolean, integer), public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb),
  public.tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.tally_release_pilot(text, uuid), public.tally_release_approve(text) from public, anon;
grant execute on function public.tally_release_pilot(text, uuid), public.tally_release_approve(text) to authenticated;

commit;
