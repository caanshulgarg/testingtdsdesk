-- Posting acceptance, 03-Oct-2026 (round 4; the real-books fault of the day). The bridge reported a posting failed although
-- Tally had replied CREATED with LASTVCHID 26298; tally_post_ids_sync then set the entry's id live = false, so the same bill
-- could have been posted again (a duplicate in Tally). Two guards on the cloud side, independent of the bridge fix:
--
--   tally_post_ids.accepted_at      set by tally-ingest (posts_update) when any result or item for an entry carries an
--                                   acceptance by Tally (ok, a voucher number / master id / GUID, or CREATED / ALTERED with
--                                   a voucher id in the message). tally_post_ids_sync never frees an id with accepted_at set,
--                                   whatever the posting's status becomes; only tally_post_id_release (migration 37) may.
--   tally_post_job_mark_posted(job, id, vch, note)   an owner of the firm marks an entry posted after seeing it in Tally:
--                                   results and items say in_tally, verified, with the voucher number; the id stays live
--                                   (accepted_at set); who / when / note / voucher are recorded on tally_post_ids
--                                   (confirmed_at / confirmed_by / confirmed_note / confirmed_vch); the posting is done when
--                                   every entry is posted. Nothing is deleted or re-sent.
--
-- Add-only: columns added if missing, the trigger function replaced, one function created; safe to run again. Shown to the
-- owner before it runs. Independent of the rename / rounds part of migration 36 (either may run first).

begin;

alter table public.tally_post_ids add column if not exists accepted_at timestamptz;
alter table public.tally_post_ids add column if not exists confirmed_at timestamptz;
alter table public.tally_post_ids add column if not exists confirmed_by uuid;
alter table public.tally_post_ids add column if not exists confirmed_note text;
alter table public.tally_post_ids add column if not exists confirmed_vch text;

-- the sync (migration-32), with the one change: an id Tally accepted stays live
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted (accepted_at) is never freed here: the voucher is in Tally, and posting it again would double it.
    update tally_post_ids set live = (accepted_at is not null) or new.status not in ('failed', 'cancelled') where job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;

-- the owner saw the entry in Tally: mark it posted. p_id is the entry's id (or its FinCom id: letters and digits).
create or replace function public.tally_post_job_mark_posted(p_job uuid, p_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  f uuid := my_firm(); j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; vch text := left(btrim(coalesce(p_vch, '')), 60); note text := left(btrim(coalesce(p_note, '')), 300);
  stamp jsonb; res jsonb; its jsonb; total int; posted int; st text;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can mark an entry posted' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  -- the entry: in the posting's payload, by its id in letters and digits
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) = fid limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  stamp := jsonb_build_object('ok', true, 'verified', true, 'state', 'in_tally', 'outcomeUnknown', false, 'reason', '', 'message', 'Marked posted by the owner on ' || to_char(now(), 'DD-Mon-YYYY') || ': in Tally' || case when vch <> '' then ' as voucher ' || vch else '' end || case when note <> '' then ' (' || note || ')' else '' end)
           || case when vch <> '' then jsonb_build_object('vchNumber', vch) else '{}'::jsonb end;
  -- results: the entry's element updated, or added
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r where regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  -- items (2.1.x bridges): the same
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'in_tally', 'reason', '') else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i where regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'in_tally', 'reason', '')); end if;
  -- done when every entry of the payload is posted (a result ok, or an item in_tally)
  select count(*), count(*) filter (where exists (select 1 from jsonb_array_elements(res) r where regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = tally_fincom_id(v) and (r->>'ok')::boolean)
                                        or exists (select 1 from jsonb_array_elements(its) i where regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = tally_fincom_id(v) and i->>'state' = 'in_tally'))
    into total, posted from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  st := case when posted >= total then 'done' else j.status end;
  -- the id stays live (another posting holding it live is a conflict the owner must clear first: cancel that one)
  begin
    update tally_post_ids set live = true, accepted_at = coalesce(accepted_at, now()), confirmed_at = now(), confirmed_by = auth.uid(), confirmed_note = note, confirmed_vch = nullif(vch, '')
     where job_id = p_job and fincom_id = fid;
  exception when unique_violation then
    raise exception 'the entry % is live in another posting; cancel that posting first, then mark this one', p_id;
  end;
  update tally_post_jobs set results = res, items = its, status = st, checking = case when st = 'done' then false else checking end,
         done = greatest(done, posted), message = case when st = 'done' then 'Marked posted by the owner' || case when note <> '' then ': ' || note else '' end else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'vch', vch, 'posted', posted, 'of', total, 'status', st);
end $function$;
revoke all on function public.tally_post_job_mark_posted(uuid, text, text, text) from public, anon;
grant execute on function public.tally_post_job_mark_posted(uuid, text, text, text) to authenticated;

commit;
