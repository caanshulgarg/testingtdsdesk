-- Migration 50, part 2 of 4 (50b-delete-and-apply): the same text as server/tally-cloud/migration-50-recorder-held.sql, split so each part
-- fits a paste; run the parts in order, each once. Safe to run twice.
begin;
set local lock_timeout = '10s';

create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); act text := case when p_cancel then 'cancelled' else 'deleted' end;
  src text := left(coalesce(p_source, ''), 80); v_day date; v_alter bigint; v_del timestamptz; v_can boolean; lk date;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if g is null then return jsonb_build_object('ok', true, 'state', 'held', 'why', 'no entry GUID: nothing can be ' || act || ' by it; the Day Book for its date, once uploaded, brings that day up to date', 'action', act); end if;
  select v.day, coalesce(v.alter_id, 0), v.deleted_at, v.cancelled into v_day, v_alter, v_del, v_can from tally_vouchers v where v.book_id = p_book and v.guid = g;
  if not found then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'action', act, 'unknown', true,
      'why', 'the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for its date is uploaded');     -- 50: what releases it
  end if;
  lk := tally_month_locked(p_book, array[v_day]);
  if lk is not null then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'day', v_day, 'action', act, 'locked', true, 'why', format('month locked: %s', to_char(lk, 'YYYY-MM')));
  end if;
  if p_alter is not null and p_alter < v_alter then
    return jsonb_build_object('ok', true, 'state', 'stale', 'guid', g, 'day', v_day, 'action', act, 'why', format('AlterID %s is older than the %s held: not %s', p_alter, v_alter, act));
  end if;
  if (p_cancel and v_can) or (not coalesce(p_cancel, false) and v_del is not null) then
    return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'already', true, 'why', 'already ' || act);
  end if;
  -- the versions first: the lines it holds now go on its current version row
  perform tally_voucher_version_lines(p_book, array[g]);
  update tally_vouchers set cancelled = case when p_cancel then true else cancelled end,
         deleted_at = case when p_cancel then deleted_at else now() end,
         alter_id = greatest(coalesce(alter_id, 0), coalesce(p_alter, 0))
   where book_id = p_book and guid = g;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = g
  on conflict (book_id, tally_guid, alter_id) do nothing;
  perform tally_voucher_version_lines(p_book, array[g]);
  perform tally_ledger_day_rebuild(p_book, array[v_day]);
  return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'source', src);
end $function$;
revoke all on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) to service_role;

-- ---------------------------------------------------------------- 48's apply: a placeholder never raises the AlterID received (review L4)
create or replace function public.tally_recorder_apply(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; res jsonb := '[]'::jsonb; one jsonb; mx bigint; pend date[] := '{}';
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then raise exception 'not a computer of this firm'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'the lines must be a list'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a call (% given)', jsonb_array_length(p_lines); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- 48: the entry lines' days are rebuilt once, after the loop (tally_recorder_line returns them in 'touched')
  perform set_config('fincom.day_rebuild_once', 'on', true);
  for x in select e from jsonb_array_elements(p_lines) with ordinality as t(e, o) order by o loop
    if jsonb_typeof(x) is distinct from 'object' then
      res := res || jsonb_build_array(jsonb_build_object('line_id', null, 'state', 'failed', 'why', 'not a line'));
      continue;
    end if;
    -- a ledger line reads the balances (a rename's trial-balance check, the guard): the days collected so far are rebuilt first
    if left(btrim(coalesce(x->>'event', '')), 7) = 'ledger_' and cardinality(pend) > 0 then     -- review L9: trimmed, as the line trims it
      perform tally_ledger_day_rebuild(p_book, array(select distinct d from unnest(pend) d));
      pend := '{}';
    end if;
    one := tally_recorder_line(p_book, p_device, x, null);
    if jsonb_typeof(one->'touched') = 'array' then
      pend := pend || array(select e::date from jsonb_array_elements_text(one->'touched') e);
    end if;
    res := res || jsonb_build_array(one - 'id' - 'touched');
    -- 9. the highest change number received from every PC's lines (entry events with an AlterID, below 10^15), never
    -- lowered; only from a line that ended applied, duplicate or stale: a held or failed line never raises it (review L2)
    if one->>'state' in ('applied', 'duplicate', 'stale') and x->>'event' in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and coalesce(x->>'object_guid', '') <> '' and coalesce(x->>'alter_id', '') ~ '^[0-9]{1,15}$'
       and left(btrim(x->>'object_guid'), 100) !~ '-0{8}$' then     -- 50 (review L4): the add-on's placeholder GUID is no entry's: its AlterID is never received
      mx := greatest(mx, (x->>'alter_id')::bigint);
    end if;
  end loop;
  perform set_config('fincom.day_rebuild_once', '', true);
  if cardinality(pend) > 0 then
    perform tally_ledger_day_rebuild(p_book, array(select distinct d from unnest(pend) d));
  end if;
  if mx is not null then
    insert into tally_sync_cursor (book_id, firm_id) values (p_book, p_firm) on conflict (book_id) do nothing;
    update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), mx), recorder_last_at = now(), updated_at = now() where book_id = p_book;
  end if;
  return jsonb_build_object('ok', true, 'results', res,
    'applied', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'applied'),
    'held', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'held'),
    'duplicate', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'duplicate'),
    'stale', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'stale'),
    'failed', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'failed'));
end $function$;
revoke all on function public.tally_recorder_apply(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_apply(uuid, uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- a Day Book day stored: the held lines that day can release run again
-- review M2: the held lines are found through these two partial indexes (and 44's (book_id, object_guid)); a held line is few

commit;
