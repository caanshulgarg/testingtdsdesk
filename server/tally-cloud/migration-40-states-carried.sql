-- Migration 40 (03-Oct-2026, round 11): the saved choices' carry mark in its own column, 'states' carried too; a ledger's
-- state from Tally; tally_post_result_confirmed renamed tally_post_result_taken. Runs AFTER 39 in either order of
-- docs/MIGRATION-ORDER.md. Add-only (two columns if missing, functions created or replaced with the same arguments),
-- safe to run twice. Shown to the owner before it runs.
--
--   On staging 39 is applied EXCEPT its tally_ingest_day part (both forms are still 38's). This file does not touch
--   tally_ingest_day and reads nothing of 39's 8-argument form: it runs the same before or after that part is applied.
--
--   1. the carry mark          client_book_items.carried jsonb. tally_ledger_carry_choices(book, from, to) (39, the same
--                              arguments; tally_ledger_rename calls it by name) carries the per-ledger items of the keys map,
--                              ledInfo, gstins, pans AND states to the new name and marks EVERY old item (object- or
--                              string-valued) in `carried` = {to, at}; it no longer writes carriedTo / carriedAt into data,
--                              so data stays exactly what the app reads. The clash rule stays: both names with an item,
--                              the new name's stands and the clash is noted.
--   2. a ledger's state        tally_ledgers.state text (Tally's LEDSTATENAME, the bridge's 10th column); tally-ingest's
--                              ledger_list upserts it when the row carries one and leaves it as it is otherwise; the app
--                              reads it from tally_ledgers with the other columns.
--   3. the name                tally_post_result_taken(r jsonb) is tally_post_result_confirmed's body (verified, in_tally,
--                              sent: Tally took the entry); the old name stays as a wrapper calling it, so the texts of
--                              36b, 38 and 39 keep working; tally_post_job_accepted (36b) and tally_post_ids_sync (39) are
--                              re-created here calling the new name. Behaviour unchanged.
--   Every function here: security definer where it reads tables, search_path = public, pg_temp; grants as before.

begin;

alter table public.client_book_items add column if not exists carried jsonb;   -- {to, at}: this item's ledger was renamed; the item was copied to the new name
alter table public.tally_ledgers add column if not exists state text;            -- Tally's LEDSTATENAME (the bridge's 10th column), when sent

-- ---------------------------------------------------------------- 1. the saved choices keyed by a ledger's name follow the name
create or replace function public.tally_ledger_carry_choices(p_book uuid, p_from text, p_to text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; cid text; k text; v jsonb; ch jsonb; n_items int := 0; n_flow int := 0; n_vals int := 0; clash text[] := '{}';
begin
  select firm_id, client_id into f, cid from tally_books where book_id = p_book;
  if f is null or coalesce(p_from, '') = '' or coalesce(p_to, '') = '' or p_from = p_to then return jsonb_build_object('items', 0, 'flow', 0, 'values', 0, 'clash', '[]'::jsonb); end if;
  -- client_book_items: the per-ledger items ('.' || name) of the keys that hold work by ledger name; the new-name item a
  -- copy of the old (data as it is, whatever its type); the old item kept, marked in carried
  begin
    foreach k in array array['map', 'ledInfo', 'gstins', 'pans', 'states'] loop
      if exists (select 1 from client_book_items i where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted) then
        if exists (select 1 from client_book_items i where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_to and not i.deleted) then
          clash := clash || k;
        else
          insert into client_book_items (firm_id, client_id, key, item, ord, data, deleted, updated_at, updated_by)
          select i.firm_id, i.client_id, i.key, '.' || p_to, i.ord, i.data, false, now(), i.updated_by from client_book_items i
           where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted
          on conflict (firm_id, client_id, key, item) do update set data = excluded.data, deleted = false, updated_at = now();
          n_items := n_items + 1;
        end if;
        update client_book_items i set carried = jsonb_build_object('to', p_to, 'at', now()), updated_at = now()
         where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted;
      end if;
    end loop;
  exception when undefined_table then null;      -- a database without client_book_items (migration 12): nothing to carry
  end;
  -- clients.data->'choices': the key 'flow:<old name>' (the new name added beside it), and values that are the old name
  begin
    select data->'choices' into ch from clients where firm_id = f and id = cid;
    if jsonb_typeof(ch) = 'object' then
      if ch ? ('flow:' || p_from) and not ch ? ('flow:' || p_to) then ch := ch || jsonb_build_object('flow:' || p_to, ch->('flow:' || p_from)); n_flow := 1; end if;
      for k, v in select * from jsonb_each(ch) loop
        if k <> 'postTo' and jsonb_typeof(v) = 'object' and v->>'value' = p_from then
          ch := jsonb_set(ch, array[k], v || jsonb_build_object('value', p_to, 'prev', p_from, 'carriedAt', now())); n_vals := n_vals + 1;
        end if;
      end loop;
      if n_flow + n_vals > 0 then update clients set data = jsonb_set(coalesce(data, '{}'::jsonb), '{choices}', ch) where firm_id = f and id = cid; end if;
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  return jsonb_build_object('items', n_items, 'flow', n_flow, 'values', n_vals, 'clash', to_jsonb(clash));
end $function$;
revoke all on function public.tally_ledger_carry_choices(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. tally_post_result_taken (the old name kept as a wrapper)
-- a result or item says Tally took the entry and it is confirmed (verified, in_tally, or sent and read back): the bridge
-- never re-sends such an entry, so it holds no posting back
create or replace function public.tally_post_result_taken(r jsonb) returns boolean language sql immutable as $function$
  select tally_post_bool(r->>'verified') or coalesce(r->>'state', '') in ('in_tally', 'sent')
$function$;
create or replace function public.tally_post_result_confirmed(r jsonb) returns boolean language sql immutable as $function$
  select public.tally_post_result_taken(r)
$function$;

-- migration 36b's tally_post_job_accepted, calling the new name (the same rule)
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at from tally_post_ids where job_id = p_job),
  res as (select r->>'id' id, tally_post_result_accepted(r) acc, tally_post_result_taken(r) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (tally_post_bool(i->>'accepted') or tally_post_bool(i->>'held') or tally_post_accept_text(i->>'reason')) acc, tally_post_result_taken(i) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
  conf as (select id from res where conf union select id from its where conf),
  sig as (select id from res where acc union select id from its where acc),
  hits as (select coalesce(entry_id, fincom_id) id from ids i where accepted_at is not null and released_at is null
             and not exists (select 1 from conf c where tally_post_id_match(i.fincom_id, i.entry_id, c.id))
           union select s.id from sig s where not exists (select 1 from conf c where c.id = s.id)
             and not exists (select 1 from ids i where i.released_at is not null and tally_post_id_match(i.fincom_id, i.entry_id, s.id)))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;
revoke all on function public.tally_post_job_accepted(uuid, jsonb, jsonb) from public, anon, authenticated;

-- migration 39's tally_post_ids_sync, calling the new name (the same rule)
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare acc text[];
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted is never freed here: stamped (accepted_at, 36b), said by the posting's own results / items as
    -- accepted and not confirmed (tally_post_job_accepted, 38), or confirmed / ok in a result or item (39); a released id
    -- is never revived
    select coalesce(array_agg(distinct id), '{}') into acc from (
      select unnest(string_to_array(coalesce(tally_post_job_accepted(new.id, new.results, new.items), ''), ', ')) id
      union select x->>'id' from jsonb_array_elements(coalesce(new.results, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_result_taken(x) or tally_post_bool(x->>'ok'))
      union select x->>'id' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' is not null and tally_post_result_taken(x)) s where id <> '';
    update tally_post_ids i set live = (i.accepted_at is not null and i.released_at is null)
        or (new.status not in ('failed', 'cancelled') and i.released_at is null)
        or (i.released_at is null and exists (select 1 from unnest(acc) a where tally_post_id_match(i.fincom_id, i.entry_id, a)))
     where i.job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;
revoke all on function public.tally_post_ids_sync() from public, anon, authenticated;

commit;
