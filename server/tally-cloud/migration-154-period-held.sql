-- migration-154-period-held (09-Nov-2026, FinCom Bridge 2.5.12). Written, NOT run yet: the owner reads it and runs it.
-- Why: an older day can hold one entry Tally keeps in a form the bridge cannot read (before 2.5.12 the whole day went to
-- "upload by hand"). From 2.5.12 the bridge sends the day's other entries and names the held entry (period_entries
-- "held": [{guid, masterId, alterId, type, why}]). The independent review: such a day must stay visibly unfinished,
-- the entry must come in later by itself, and only after 3 automatic tries the person is given the manual step.
-- How (add-only; no table created, dropped or emptied; one column added; 98's functions not changed):
--   - tally_period_days.held: the day's held entries [{guid, mid, alter, type, why, version, tries, at}];
--   - tally_period_hold (tally-ingest, the day's last period_entries of a 2.5.12 bridge): keeps the held list, the day
--     unfinished (done_at null) while it is not empty, and counts each entry's tries on one bridge version (a new
--     version starts again at 1). Under 3 tries the day stays listed (98's tally_period_next_paced hands out a counted day
--     not done and not marked), so every later pull and the night's catch-up ask Tally for it again; at 3 the day is
--     marked upload_why 'held' with the manual step's words (not listed again). An empty list clears the mark and ends
--     the day when FinCom holds all its entries (98's held_n);
--   - tally_period_held_release (tally-ingest, a bridge's beat with another version than before): the firm's days marked
--     'held' by an older version are listed again (tried again after each bridge update);
--   - tally_period_held_retry (the app's "Try again now", owner or staff): the day listed again at once;
--   - tally_period_held_settle (in tally_period_held_list): an entry FinCom now holds at the AlterID held or higher (the
--     day's Day Book uploaded, or read since) leaves the list; an empty list clears the mark and ends the day;
--   - tally_period_held_list (the app's, owner or staff or viewer of the firm): the held days [{day, n, tries, manual, words}].
-- Add-only and safe to run again; one transaction, lock_timeout 10 s. Tested on pg_stand: tests/run_migration154.py.
begin;
set local lock_timeout = '10s';

alter table public.tally_period_days add column if not exists held jsonb not null default '[]'::jsonb;

-- the words of a held day: under 3 tries FinCom tries again; then the manual step (TallyPrime's own keys)
create or replace function public.tally_period_held_words(p_day date, p_n integer, p_manual boolean) returns text
language sql immutable set search_path = public, pg_temp as $function$
  select case when p_manual then
    'In Tally, open Day Book, press F2 and set the date to ' || to_char(p_day, 'DD-Mon-YYYY') || ', then Alt+E (Export) → Current, F8 (File Format): XML, and E to export; drop the file on Books › From Tally.'
  else
    case when coalesce(p_n, 1) = 1 then '1 entry' else p_n || ' entries' end || ' on ' || to_char(p_day, 'DD-Mon') || ' could not be read yet. FinCom tries again by itself.'
  end
$function$;

create or replace function public.tally_period_hold(p_book uuid, p_day date, p_held jsonb, p_version text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d tally_period_days%rowtype; nh jsonb := '[]'::jsonb; e jsonb; o jsonb; t int; mx int := 0; v text := left(coalesce(p_version, ''), 40); n int; al bigint;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into d from tally_period_days where book_id = p_book and day = p_day for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'FinCom did not ask for this day'); end if;
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_held) = 'array' then p_held else '[]'::jsonb end) x limit 100 loop
    if jsonb_typeof(e) <> 'object' or coalesce(e->>'guid', '') !~ '^[A-Za-z0-9._:-]{1,100}$' then continue; end if;
    al := case when coalesce(e->>'alterId', '') ~ '^[0-9]{1,15}$' then (e->>'alterId')::bigint end;
    select x into o from jsonb_array_elements(d.held) x where x->>'guid' = e->>'guid' limit 1;
    -- the tries of this entry at this AlterID on this bridge version; another version (an update) starts again at 1
    t := case when o is not null and coalesce(o->>'version', '') = v and (o->>'alter') is not distinct from al::text then coalesce((o->>'tries')::int, 0) + 1 else 1 end;
    mx := greatest(mx, t);
    nh := nh || jsonb_build_array(jsonb_build_object('guid', e->>'guid', 'mid', left(coalesce(e->>'masterId', ''), 18), 'alter', al,
      'type', left(coalesce(e->>'type', ''), 60), 'why', left(coalesce(e->>'why', ''), 300), 'version', v, 'tries', t, 'at', now()));
  end loop;
  n := jsonb_array_length(nh);
  if n = 0 then
    update tally_period_days set held = '[]'::jsonb,
           upload_at = case when upload_why = 'held' then null else upload_at end, upload_words = case when upload_why = 'held' then null else upload_words end,
           upload_why = case when upload_why = 'held' then null else upload_why end,
           done_at = case when upload_why = 'held' or upload_at is null then case when held_n >= coalesce(tally_n, 0) then coalesce(done_at, now()) end else done_at end
     where book_id = p_book and day = p_day;
    return jsonb_build_object('ok', true, 'held', 0);
  end if;
  update tally_period_days set held = nh, done_at = null,
         upload_at = case when mx >= 3 then coalesce(upload_at, now()) when upload_why = 'held' then null else upload_at end,
         upload_words = case when mx >= 3 and (upload_why is null or upload_why = 'held') then tally_period_held_words(p_day, n, true) when upload_why = 'held' then null else upload_words end,
         upload_why = case when mx >= 3 and (upload_why is null or upload_why = 'held') then 'held' when upload_why = 'held' then null else upload_why end
   where book_id = p_book and day = p_day;
  return jsonb_build_object('ok', true, 'held', n, 'tries', mx, 'manual', mx >= 3, 'words', tally_period_held_words(p_day, n, mx >= 3));
end $function$;

-- after a bridge update: the firm's days marked 'held' by an older version are listed again
create or replace function public.tally_period_held_release(p_firm uuid, p_version text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_period_days x set upload_at = null, upload_why = null, upload_words = null
   where x.firm_id = p_firm and x.upload_why = 'held' and jsonb_array_length(x.held) > 0
     and exists (select 1 from jsonb_array_elements(x.held) h where coalesce(h->>'version', '') <> left(coalesce(p_version, ''), 40));
  get diagnostics n = row_count;
  return n;
end $function$;

-- an entry FinCom now holds at the AlterID held or higher leaves the list; an empty list ends the day (98's count)
create or replace function public.tally_period_held_settle(p_book uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; rest jsonb; h record; n int := 0;
begin
  for r in select * from tally_period_days x where x.book_id = p_book and jsonb_array_length(x.held) > 0 for update loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into rest from jsonb_array_elements(r.held) e
     where not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = e->>'guid' and v.deleted_at is null
                         and coalesce(v.alter_id, 0) >= coalesce((e->>'alter')::bigint, 0));
    if jsonb_array_length(rest) = jsonb_array_length(r.held) then continue; end if;
    n := n + 1;
    if jsonb_array_length(rest) > 0 then
      update tally_period_days set held = rest where book_id = p_book and day = r.day;
      continue;
    end if;
    select * into h from tally_period_held(p_book, coalesce(r.heads, '[]'::jsonb), 0, r.seen);
    update tally_period_days set held = '[]'::jsonb, held_n = h.held,
           upload_at = case when upload_why = 'held' then null else upload_at end, upload_words = case when upload_why = 'held' then null else upload_words end,
           upload_why = case when upload_why = 'held' then null else upload_why end,
           done_at = case when h.held >= coalesce(tally_n, 0) then coalesce(done_at, now()) end
     where book_id = p_book and day = r.day;
  end loop;
  return n;
end $function$;

-- the app's "Try again now" (owner or staff): the day listed again at once (its tries kept)
create or replace function public.tally_period_held_retry(p_book uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_period_member(p_book, true); n int;
begin
  update tally_period_days set asked_at = null,
         upload_at = case when upload_why = 'held' then null else upload_at end, upload_words = case when upload_why = 'held' then null else upload_words end,
         upload_why = case when upload_why = 'held' then null else upload_why end
   where book_id = p_book and day = p_day and jsonb_array_length(held) > 0;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'queued', n > 0);
end $function$;

-- the app's list of a book's held days (Books › From Tally, the Tally page): settled first, each with its words
create or replace function public.tally_period_held_list(p_book uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare hl jsonb;
begin
  if not tally_service_or_owner() then perform tally_period_member(p_book, false); end if;
  perform tally_period_held_settle(p_book);
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(x.day, 'YYYYMMDD'), 'n', jsonb_array_length(x.held),
           'tries', (select max(coalesce((h->>'tries')::int, 0)) from jsonb_array_elements(x.held) h), 'manual', coalesce(x.upload_why = 'held', false),
           'words', tally_period_held_words(x.day, jsonb_array_length(x.held), coalesce(x.upload_why = 'held', false))) order by x.day), '[]'::jsonb)
    into hl from tally_period_days x where x.book_id = p_book and jsonb_array_length(x.held) > 0;
  return jsonb_build_object('ok', true, 'held', hl);
end $function$;

revoke all on function public.tally_period_held_words(date, integer, boolean), public.tally_period_hold(uuid, date, jsonb, text),
  public.tally_period_held_release(uuid, text), public.tally_period_held_settle(uuid) from public, anon, authenticated;
grant execute on function public.tally_period_hold(uuid, date, jsonb, text), public.tally_period_held_release(uuid, text) to service_role;
revoke all on function public.tally_period_held_retry(uuid, date), public.tally_period_held_list(uuid) from public, anon;
grant execute on function public.tally_period_held_retry(uuid, date), public.tally_period_held_list(uuid) to authenticated, service_role;
commit;
