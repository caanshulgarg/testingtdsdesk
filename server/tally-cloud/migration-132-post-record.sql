-- Migration 132 (30-Oct-2026, next-fix-bank-post): the record of a posting made straight to a FinCom Bridge. NOT run on
-- staging by this branch; the owner runs it. One transaction, add-only (one function created; nothing dropped, deleted or
-- changed), safe to run twice. Needs 26 (tally_post_jobs.entry_ids), 37 (tally_post_ids and its trigger on postings) and,
-- for the register, 111. (130 opening-guards and 131 ledger-drop-guard are other branches.)
--
-- WHAT HAPPENED (staging, owner's report of 30-Oct-2026, a client's bank statement posted to Tally, "some entries were not
-- posted"): the client's Tally book has no from date, so FinCom does not take it as the cloud's copy (tally_status gives
-- "from": null) and the page posts straight to the bridge on that computer, as designed for a client with no cloud. It then
-- records the posting in the cloud with tally_post_record (migration 27, 02-Oct-2026), so the Post page lists it and the
-- posting register (111) holds each line. Migration 27 never ran on staging: there is no tally_post_record, the page took
-- the "function not found" as "an older cloud" and said nothing, and that posting (two requests of bank lines Tally made
-- only 8 of 50 and 16 of 37 of) left no record anywhere in the cloud: tally_post_jobs, tally_post_ids and
-- tally_post_register hold nothing of it. (Those three tables are empty on staging for another reason too: their rows were
-- copied to schema backup_20261028 and the tables emptied on 28-Oct, outside the migrations: inserts 22 / 177 / 176, deletes
-- 0, live 0. Nothing here touches either.)
--
-- THIS FILE: tally_post_record exactly as migration 27 made it (the same arguments, the same checks, the same row), with
-- search_path public, pg_temp and explicit grants:
--   tally_post_record(id, client, company, status, results, entry_ids, message)
--       a posting already made, by a member who may write, for a client of their firm: inserted (or, the same id, brought up
--       to date) as done or failed, with device_id null so no bridge ever takes it; the payload holds only the voucher ids.
--       Its insert fires tally_post_ids_sync (37: one id per entry, live unless failed) and so the register (111: each entry
--       queued, then judged from the results: a batch Tally made only partly -> needs_review with Tally's words; nothing
--       made -> refused; a batch made whole -> in_tally, ids inferred). A recorded posting is a fact, never refused by the
--       register's duplicate guard.
-- The page (src/js/59 PostRecord) no longer records the bridge's own refusals of an entry it sent before ("already sent from
-- this computer"): nothing was sent, so it is no new posting of that entry.

begin;
set local lock_timeout = '10s';

create or replace function public.tally_post_record(p_id uuid, p_client text, p_company text, p_status text, p_results jsonb,
                                                    p_entry_ids jsonb, p_message text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); j record; ids jsonb; st text; n int;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_client is null or btrim(p_client) = '' then return jsonb_build_object('ok', false, 'error', 'No client.'); end if;
  if not exists (select 1 from clients c where c.firm_id = f and c.id = p_client) then raise exception 'no such client in this firm' using errcode = '42501'; end if;
  st := case when p_status in ('done', 'failed') then p_status else 'failed' end;
  ids := coalesce((select jsonb_agg(jsonb_build_object('id', e #>> '{}')) from jsonb_array_elements(
           case when jsonb_typeof(p_entry_ids) = 'array' then p_entry_ids else '[]'::jsonb end) e), '[]'::jsonb);
  n := greatest(jsonb_array_length(ids), case when jsonb_typeof(p_results) = 'array' then jsonb_array_length(p_results) else 0 end);
  select * into j from tally_post_jobs where id = p_id;
  if found then
    -- only a recorded posting of this firm and client (never one a bridge takes) is brought up to date
    if j.firm_id <> f or j.client_id <> p_client or j.device_id is not null then raise exception 'not allowed' using errcode = '42501'; end if;
    update tally_post_jobs set status = st, results = coalesce(p_results, results), message = left(coalesce(p_message, message), 500),
           done = coalesce((select count(*) from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where (r->>'ok')::boolean), done)::int,
           updated_at = now()
     where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'updated', true);
  end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, done, message, results, checking, created_by, taken_at, updated_at)
    values (p_id, f, p_client, coalesce(nullif(btrim(p_company), ''), '?'), null, jsonb_build_object('masters', '[]'::jsonb, 'vouchers', ids, 'ledger', '', 'recorded', true),
            greatest(n, 1), st,
            (select count(*) from jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) r where (r->>'ok')::boolean)::int,
            left(coalesce(p_message, ''), 500), p_results, false, auth.uid(), now(), now());
  return jsonb_build_object('ok', true, 'id', p_id);
end $function$;

revoke all on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) to authenticated, service_role;

commit;
