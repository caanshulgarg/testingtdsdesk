-- All postings in one list, 02-Oct-2026. Jobs 0f9f0156, c14b40fc and 62e900e6 went from the browser straight to FinCom
-- Bridge 2.1.1 on NWS144 (the bridge's /jobs) and were never in tally_post_jobs, so "Postings in FinCom's cloud" did not
-- show them. FinCom now sends every posting through the queue when the client is linked to the cloud; a posting made
-- straight to a bridge (no cloud for that client) is recorded here afterwards, finished, so the list is complete.
--   tally_post_record(id, client, company, status, results, entry_ids, message)
--       a posting already made: inserted (or brought up to date, same id) as done or failed, with device_id null, so no
--       bridge ever takes it; the payload holds only the voucher ids (entry_ids is generated from it, migration-26)
-- Adds and replaces only; nothing is dropped or deleted. Safe to run again.

begin;

create or replace function public.tally_post_record(p_id uuid, p_client text, p_company text, p_status text, p_results jsonb,
                                                    p_entry_ids jsonb, p_message text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
grant execute on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------------------------------------------------
-- Paste-ready on its own as well (staging; the owner runs it): the Tally company each existing client may post to, set where it
-- is clear: exactly one Tally company linked to the client, and its GSTIN equals the client's. Only clients with no
-- company chosen yet (data.postTo empty); postToBy 'auto'. Running it again changes nothing.
-- On staging today this sets Testing AAD (cmufksrrqjub2g) to GARG SHEKHAR & COMPANY (both 09AANFG3202D1ZR).
--
begin;
update public.clients cl
   set data = coalesce(cl.data, '{}'::jsonb) || jsonb_build_object('postTo', t.company, 'postToAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'postToBy', 'auto'),
       updated_at = now()
  from (select firm_id, client_id, min(company) as company, min(upper(btrim(coalesce(gstin, '')))) as gstin
          from public.tally_companies where client_id is not null
         group by firm_id, client_id having count(*) = 1) t
 where cl.firm_id = t.firm_id and cl.id = t.client_id and not coalesce(cl.deleted, false)
   and coalesce(btrim(cl.data->>'postTo'), '') = ''
   and t.gstin <> '' and t.gstin = upper(btrim(coalesce(nullif(cl.gstin, ''), cl.data->>'gstin', '')))
returning cl.id, cl.name, cl.data->>'postTo' as post_to;
commit;
