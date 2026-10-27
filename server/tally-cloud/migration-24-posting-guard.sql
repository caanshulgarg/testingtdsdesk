-- Posting only into the client's own Tally company, 02-Oct-2026. FA/ELEC/013 of Testing AAD went into GARG SHEKHAR &
-- COMPANY because the cloud linked that company to Testing AAD (same GSTIN and Tally name). Now each client names the one
-- Tally company it may post to (Client setup → Tally: clients.data.postTo); a posting is queued only into that company,
-- and with none chosen it is refused with what to do. FinCom Bridge 2.1 also posts only into the company a job names.
--   tally_post_jobs + items (each entry's state: waiting / sending / sent / in_tally / failed, with its reason)
--   tally_post_enqueue: the allowed company; Retry of a failed or cancelled posting under the same id (entries already in
--                       Tally are found by FinCom's tag and not posted again)
-- Adds and replaces only; nothing is dropped or deleted.

begin;

alter table public.tally_post_jobs add column if not exists items jsonb;
grant select (items) on public.tally_post_jobs to authenticated;

create or replace function public.tally_post_enqueue(p_id uuid, p_client text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record;
begin
  if f is null then raise exception 'not allowed'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to
  select nullif(btrim(cl.data->>'postTo'), ''), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', 'Choose the Tally company ' || coalesce(cname, 'this client') || ' may post to (Client setup → Tally). Its books in FinCom''s cloud come from ' || c.company || '.'); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = p_id;
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select v->>'id' into dup from tally_post_jobs j2, jsonb_array_elements(j2.payload->'vouchers') v
   where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n)
    values (p_id, f, p_client, c.company, c.device_id, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;

commit;
