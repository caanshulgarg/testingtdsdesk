-- Migration 41 (03-Oct-2026, round 11s, the security review of rounds 9-11: M5, L4, L6). Runs AFTER 40 (fresh database:
-- 39 -> 40 -> 41; docs/MIGRATION-ORDER.md). Add-only (two columns if missing, functions created or replaced with the same
-- arguments), safe to run twice. Shown to the owner before it runs.
--
--   THE 8-ARGUMENT tally_ingest_day HERE SUPERSEDES 39's. On staging 39's day-import part (its tally_ingest_day texts) was
--   never run: running this file is enough - it creates the 8-argument form (39's text plus L4 below) and re-creates the
--   7-argument one as its wrapper. On a fresh database the order is 39, then 40, then 41, and 41's text wins.
--
--   M5. a PostOnly refusal is never an acceptance   tally_post_result_accepted(r) (36b) answers false when the result says
--       postOnly: true, whatever its words (a company may be named "Created 1 Pvt Ltd"); tally_post_job_accepted (40's text)
--       reads items the same way. tally-ingest does the same before its own heuristics.
--   L4. an empty-day marking is recorded   tally_days.empty_at timestamptz, tally_days.note text. tally_ingest_day with
--       p_empty = true records empty_at = now() and note = '<n> entries marked deleted on an empty read' when it marks; and a
--       sanity cap: when the day's tally_days.n before this call is greater than 25, the FIRST empty read marks nothing,
--       records empty_at and the note 'empty day with N entries before: confirm by a second empty read' and answers
--       refused with those words (emptyPending: true); the second consecutive empty read marks. A file with entries
--       clears empty_at and the note.
--   2 (code review). a carried choice value is not reverted by the app's own merge: every rewritten choice and the added
--       'flow:<new name>' key get at = now() (ISO, as the app writes it) and by = 'rename'.
--   5. tally_ledger_rename (39's text, re-created here) no longer requires the trial balance to be 0: it requires only
--       that the sum is the SAME before and after (that alone proves nothing moved); a sum not 0 is said in the answer
--       (tbNote) - a book whose openings do not sum to 0 can rename, so the bridge does not re-send the rename every round
--       (and the name upsert does not make a second, GUID-less row).
--   6. after a carry the old map item is marked deleted (soft) with carried = {to, at}, so tally_led_kinds no longer
--       counts the old name as a GST / TDS ledger; on a clash the old item stays live with carried = {to, at, clash: true}.
--   7. the choice-value rewrite is limited to the keys gst:*, tds:*, bank:*, sales:* and exp (the flow: key rule as is).
--   L6. a soft-deleted new-name item is not revived   tally_ledger_carry_choices (40's text): a '.' || new-name row that
--       exists, live or deleted, is a clash - nothing inserted, that row untouched, the clash noted.
--   Every function here: security definer where it reads tables, search_path = public, pg_temp; grants as before.

begin;

alter table public.tally_days add column if not exists empty_at timestamptz;   -- the last empty read of the day the bridge vouched for
alter table public.tally_days add column if not exists note text;               -- what that read did (marked n, or waiting for a second read)

-- ---------------------------------------------------------------- M5. never an acceptance
create or replace function public.tally_post_result_accepted(r jsonb) returns boolean language sql immutable as $function$
  select not tally_post_bool(r->>'postOnly') and (tally_post_bool(r->>'accepted') or tally_post_bool(r->>'held')
      or (coalesce(r->>'created', '') ~ '^\d+$' and (r->>'created')::int > 0) or (coalesce(r->>'altered', '') ~ '^\d+$' and (r->>'altered')::int > 0)
      or coalesce(r->>'lastVchId', '') <> '' or coalesce(r->>'vchNumber', '') <> '' or coalesce(r->>'masterId', '') <> '' or coalesce(r->>'guid', '') <> ''
      or tally_post_accept_text(r->>'message') or tally_post_accept_text(r->>'reason'))
$function$;

create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at from tally_post_ids where job_id = p_job),
  res as (select r->>'id' id, tally_post_result_accepted(r) acc, tally_post_result_taken(r) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (not tally_post_bool(i->>'postOnly') and (tally_post_bool(i->>'accepted') or tally_post_bool(i->>'held') or tally_post_accept_text(i->>'reason'))) acc, tally_post_result_taken(i) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
  conf as (select id from res where conf union select id from its where conf),
  sig as (select id from res where acc union select id from its where acc),
  hits as (select coalesce(entry_id, fincom_id) id from ids i where accepted_at is not null and released_at is null
             and not exists (select 1 from conf c where tally_post_id_match(i.fincom_id, i.entry_id, c.id))
           union select s.id from sig s where not exists (select 1 from conf c where c.id = s.id)
             and not exists (select 1 from ids i where i.released_at is not null and tally_post_id_match(i.fincom_id, i.entry_id, s.id)))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;
revoke all on function public.tally_post_job_accepted(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- L6. the carry never revives a deleted item
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
        if exists (select 1 from client_book_items i where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_to) then
          -- the new name has an item already, live or soft-deleted (a deleted one is never revived here): a clash, that row
          -- untouched; the old item stays live, marked carried with clash: true
          clash := clash || k;
          update client_book_items i set carried = jsonb_build_object('to', p_to, 'at', now(), 'clash', true), updated_at = now()
           where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted;
        else
          insert into client_book_items (firm_id, client_id, key, item, ord, data, deleted, updated_at, updated_by)
          select i.firm_id, i.client_id, i.key, '.' || p_to, i.ord, i.data, false, now(), i.updated_by from client_book_items i
           where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted
          on conflict (firm_id, client_id, key, item) do nothing;
          n_items := n_items + 1;
          -- the old item: copied, so marked deleted (soft) with carried = {to, at}: the readers (tally_led_kinds) see the new name only
          update client_book_items i set deleted = true, carried = jsonb_build_object('to', p_to, 'at', now()), updated_at = now()
           where i.firm_id = f and i.client_id = cid and i.key = k and i.item = '.' || p_from and not i.deleted;
        end if;
      end if;
    end loop;
  exception when undefined_table then null;      -- a database without client_book_items (migration 12): nothing to carry
  end;
  -- clients.data->'choices': the key 'flow:<old name>' (the new name added beside it), and values that are the old name
  begin
    select data->'choices' into ch from clients where firm_id = f and id = cid;
    if jsonb_typeof(ch) = 'object' then
      -- at = now() as the app writes it and by = 'rename': the app's merge (choicePick) keeps the newer record, so the
      -- carried value is not reverted by a copy the page still holds
      if ch ? ('flow:' || p_from) and not ch ? ('flow:' || p_to) then
        ch := ch || jsonb_build_object('flow:' || p_to, coalesce(ch->('flow:' || p_from), '{}'::jsonb) || jsonb_build_object('at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', 'rename')); n_flow := 1;
      end if;
      for k, v in select * from jsonb_each(ch) loop
        if (k ~ '^(gst|tds|bank|sales):' or k = 'exp') and jsonb_typeof(v) = 'object' and v->>'value' = p_from then
          ch := jsonb_set(ch, array[k], v || jsonb_build_object('value', p_to, 'prev', p_from, 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', 'rename')); n_vals := n_vals + 1;
        end if;
      end loop;
      if n_flow + n_vals > 0 then update clients set data = jsonb_set(coalesce(data, '{}'::jsonb), '{choices}', ch) where firm_id = f and id = cid; end if;
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  return jsonb_build_object('items', n_items, 'flow', n_flow, 'values', n_vals, 'clash', to_jsonb(clash));
end $function$;
revoke all on function public.tally_ledger_carry_choices(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. the rename: the trial balance must not CHANGE (a sum not 0 is said, not refused)
create or replace function public.tally_ledger_rename(p_book uuid, p_guid text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); frm text := left(btrim(coalesce(p_from, '')), 300); dst text := left(btrim(coalesce(p_to, '')), 300);
  row_name text; row_guid text; other_name text; other_guid text; other_gone boolean; hist boolean; kept boolean; why text;
  tb_before numeric; tb_after numeric; moved jsonb; o_open numeric; o_sent numeric; lst jsonb; carried jsonb;
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
  select name, tally_guid, deleted_at is not null into other_name, other_guid, other_gone from tally_ledgers where book_id = p_book and name = dst;
  if other_name is not null and other_guid is not null and g is not null and other_guid <> g then
    return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
      'note', format('rename %s -> %s: that name is another ledger''s (GUID %s); left', row_name, dst, other_guid));
  end if;
  -- the trial balance before: the sum of closing balances over the book (0 when it ties; migration 41: a sum not 0 no
  -- longer stops the rename - only a CHANGE of the sum does, which alone proves nothing moved - it is said in the answer)
  select round(coalesce(sum(closing), 0), 2) into tb_before from tally_balances where book_id = p_book;
  lst := jsonb_build_object('source', 'bridge ledger_list', 'at', now(), 'renamed', jsonb_build_object('from', row_name, 'to', dst, 'guid', g));
  if other_name is not null then
    -- a merge: the entries and the opening go to the row that keeps the name (and takes the GUID); the old row, now
    -- empty, is marked merged. A row with the new name marked deleted earlier is un-marked: Tally uses the name again
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    select open, open_sent into o_open, o_sent from tally_ledgers where book_id = p_book and name = row_name;
    update tally_ledgers set open = coalesce(open, 0) + coalesce(o_open, 0),
           open_sent = case when open_sent is null and o_sent is null then null else coalesce(open_sent, open, 0) + coalesce(o_sent, o_open, 0) end
     where book_id = p_book and name = dst;
    if other_gone then
      perform set_config('fincom.ledger_list', jsonb_build_object('unreason', format('named again in Tally (%s renamed to it)', row_name), 'list', lst)::text, true);
      update tally_ledgers set deleted_at = null where book_id = p_book and name = dst;
    end if;
    update tally_ledgers set open = 0, open_sent = case when open_sent is null then null else 0 end, renamed_at = null where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('renamed in Tally to %s (merged into the row with that name)', dst), 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', '', true);
    select deleted_at is null into kept from tally_ledgers where book_id = p_book and name = row_name;
    if kept then
      select public.tally_ledger_hold_reason(l) into why from tally_ledgers l where l.book_id = p_book and l.name = row_name;
      raise exception 'rename % -> %: the old row is kept live by the guard (%); the merge was rolled back', row_name, dst, coalesce(why, 'unknown reason') using errcode = 'P0001';
    end if;
    update tally_ledgers set tally_guid = null where book_id = p_book and name = row_name;
    if g is not null and other_guid is null then update tally_ledgers set tally_guid = g where book_id = p_book and name = dst; end if;
    -- migration 39: the saved choices keyed by the old name follow (map items, flow choices, choice values); the row that
    -- stays is flagged for the owner to confirm (needs_confirm; the renamed entry carries confirm: true)
    carried := public.tally_ledger_carry_choices(p_book, row_name, dst);
    update tally_ledgers set needs_confirm = true where book_id = p_book and name = dst;
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'to', dst, 'at', now(), 'merged', true, 'guid', g, 'open', o_open, 'moved', moved, 'carried', carried), p_book, row_name;
      -- on the row that stays: what came in (under 'merged', not 'renamed': the merged name is not an old name of this row),
      -- and a 'renamed' entry to confirm (confirm: true; the owner clears it with tally_ledger_rename_confirm)
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''merged'', coalesce(before_clean->''merged'', ''[]''::jsonb) || $1, ''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $4) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'guid', g, 'open', o_open, 'moved', moved, 'carried', carried), p_book, dst,
              jsonb_build_object('mergedFrom', row_name, 'at', now(), 'confirm', true, 'carried', carried);
    end if;
  else
    -- a plain rename: the row keeps everything under the new name; its entries follow
    update tally_ledgers set name = dst, tally_guid = coalesce(tally_guid, g), renamed_at = now(), needs_confirm = true where book_id = p_book and name = row_name;
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    carried := public.tally_ledger_carry_choices(p_book, row_name, dst);      -- migration 39: the saved choices follow the name
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'moved', moved, 'confirm', true, 'carried', carried), p_book, dst;
    end if;
  end if;
  -- the trial balance after: the same sum, and 0; else everything above is rolled back
  select round(coalesce(sum(closing), 0), 2) into tb_after from tally_balances where book_id = p_book;
  if tb_after <> tb_before then
    raise exception 'the trial balance would change with the rename % -> %: before %, after %; nothing was changed', row_name, dst, tb_before, tb_after using errcode = 'P0001';
  end if;
  if other_name is not null then
    return jsonb_build_object('ok', true, 'renamed', false, 'merged', true, 'from', row_name, 'to', dst, 'tb', tb_after,
      'note', format('%s -> %s: the entries and the opening carried to the row with the new name, which takes the GUID; the old row marked merged', row_name, dst)
        || case when jsonb_array_length(coalesce(carried->'clash', '[]'::jsonb)) > 0 then format('; both names had saved choices (%s): the new name''s stand, the old ones are marked carried', carried->>'clash') else '' end) || moved || jsonb_build_object('carried', carried, 'confirm', true)
        || case when tb_after <> 0 then jsonb_build_object('tbNote', format('the trial balance of this book does not tie (the closing balances add up to %s, not 0); it was so before the rename too', tb_after)) else '{}'::jsonb end;
  end if;
  return jsonb_build_object('ok', true, 'renamed', true, 'from', row_name, 'to', dst, 'guid', coalesce(row_guid, g), 'tb', tb_after) || moved || jsonb_build_object('carried', carried, 'confirm', true)
      || case when tb_after <> 0 then jsonb_build_object('tbNote', format('the trial balance of this book does not tie (the closing balances add up to %s, not 0); it was so before the rename too', tb_after)) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ledger_rename(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_ledger_rename(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------- L4. tally_ingest_day: an empty read recorded, and capped on a full day
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false; prev_n int; prev_empty timestamptz; d_empty timestamptz; d_note text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the entries in the file: inserted, or brought up to date in place (deleted_at cleared); a version row for each AlterID
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15),
         case when coalesce(x->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then x->>'fid' end, null
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc
  on conflict (book_id, guid) do update set
     day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno, party = excluded.party, narration = excluded.narration,
     cancelled = excluded.cancelled, optional = excluded.optional, gstin = excluded.gstin, pos = excluded.pos, ref = excluded.ref, ref_date = excluded.ref_date,
     cmp_gstin = excluded.cmp_gstin, deleted_at = null,
     fincom_id = coalesce(excluded.fincom_id, substring(excluded.narration from 'TDSDesk:([A-Za-z0-9._-]+)'), tally_vouchers.fincom_id),
     origin = case when excluded.fincom_id is not null or excluded.narration ~ 'TDSDesk:[A-Za-z0-9]' then 'fincom' else tally_vouchers.origin end;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  on conflict (book_id, tally_guid, alter_id) do nothing;
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it
  select d.n, d.empty_at into prev_n, prev_empty from tally_days d where d.book_id = p_book and d.day = p_day;
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries: the day's live entries are marked
    -- deleted (soft, kept with their lines and bills; a later file with entries un-marks them). Migration 41: a day that
    -- held more than 25 entries is not emptied on one read: the first empty read is recorded (tally_days.empty_at, note)
    -- and refused; the second consecutive empty read marks
    if coalesce(prev_n, 0) > 25 and prev_empty is null then
      short := format('empty day with %s entries before: confirm by a second empty read', prev_n);
      d_empty := now(); d_note := short;
    else
      update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
      get diagnostics marked = row_count; emptied := true;
      d_empty := now(); d_note := format('%s entries marked deleted on an empty read', marked);
    end if;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- a re-sent entry's lines and bills are replaced (its old ones are on its old version row)
  delete from tally_bills b where b.book_id = p_book and b.guid = any(sent);
  delete from tally_lines l where l.book_id = p_book and l.guid = any(sent);
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
  perform tally_voucher_version_lines(p_book, sent);
  -- the day cache, from live entries only
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and v.deleted_at is null and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  -- the day's bookkeeping; an empty read recorded (empty_at, note); a file with entries clears the record
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at, empty_at, note) values (p_book, f, p_day, p_n, p_alter, p_bytes, now(), d_empty, d_note)
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now(),
     empty_at = case when n_in > 0 then null else coalesce(excluded.empty_at, tally_days.empty_at) end,
     note = case when n_in > 0 then null else coalesce(excluded.note, tally_days.note) end;
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end || case when d_empty is not null and not emptied then jsonb_build_object('emptyPending', true) else '{}'::jsonb end;
end $function$;
-- the 7-argument call (tally-ingest before migration 39, the re-read of kept files): no word on emptiness
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ingest_day(p_book, p_day, p_vouchers, p_lines, p_n, p_alter, p_bytes, null::boolean);
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) to service_role;

commit;
