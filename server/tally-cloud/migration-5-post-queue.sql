-- build 199, step 4: the posting queue. Entries approved in FinCom on any computer wait here; the bridge on the Tally
-- computer takes them when Tally is free, posts them with its usual job (FinCom's ID stamped in each entry, Tally checked
-- for those IDs first, so nothing is posted twice) and writes back each entry's result, with Tally's own words on failure.
create table if not exists public.tally_post_jobs (
  id uuid primary key,                         -- FinCom's job number; the bridge's job has the same one
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id text not null,
  company text not null,                       -- the Tally company, as linked to the client
  device_id uuid references public.tally_devices(id) on delete set null,
  payload jsonb not null,                      -- {masters:[{id,xml}], vouchers:[{id,xml}], ledger}
  n integer not null,
  status text not null default 'waiting' check (status in ('waiting', 'taken', 'running', 'done', 'failed', 'cancelled')),
  done integer not null default 0,
  message text not null default '',
  results jsonb,
  checking boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists tally_post_jobs_device on public.tally_post_jobs (device_id, status, created_at);
create index if not exists tally_post_jobs_client on public.tally_post_jobs (firm_id, client_id, created_at desc);
alter table public.tally_post_jobs enable row level security;
drop policy if exists tally_post_jobs_read on public.tally_post_jobs;
create policy tally_post_jobs_read on public.tally_post_jobs for select to authenticated using (firm_id = my_firm());
revoke insert, update, delete on public.tally_post_jobs from anon, authenticated;

-- a person queues entries for a client: to the Tally computer that keeps that client's company
create or replace function public.tally_post_enqueue(p_id uuid, p_client text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); c record; n int; dup text;
begin
  if f is null then raise exception 'not allowed'; end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  if exists (select 1 from tally_post_jobs where id = p_id) then return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company, 'again', true); end if;
  -- an entry already waiting or being posted in another job is not queued twice
  select v->>'id' into dup from tally_post_jobs j, jsonb_array_elements(j.payload->'vouchers') v
   where j.firm_id = f and j.client_id = p_client and j.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n)
    values (p_id, f, p_client, c.company, c.device_id, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $$;
-- a posting still waiting can be taken back
create or replace function public.tally_post_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update tally_post_jobs set status = 'cancelled', message = 'Cancelled before the Tally computer took it', updated_at = now()
   where id = p_id and firm_id = my_firm() and status = 'waiting';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;
-- the bridge (through tally-ingest, service role): the next waiting posting for this computer
create or replace function public.tally_post_take(p_device uuid)
returns setof public.tally_post_jobs language sql security definer set search_path = public as $$
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), message = 'Taken by the Tally computer'
   where id = (select id from tally_post_jobs where device_id = p_device and status = 'waiting' order by created_at limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.tally_post_enqueue(uuid, text, jsonb) from public, anon;
revoke all on function public.tally_post_cancel(uuid) from public, anon;
revoke all on function public.tally_post_take(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue(uuid, text, jsonb) to authenticated;
grant execute on function public.tally_post_cancel(uuid) to authenticated;

-- the entries of a period (of one ledger, or of some voucher types) with their ledger lines, shaped as the bridge
-- answers /ledgerlines and /vouchers: FinCom's checks before posting read the cloud copy when Tally is on another computer
create or replace function public.tally_vouchers_in(p_client text, p_from date, p_to date, p_ledger text default null, p_types text[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with bk as (select tally_pick(p_client, p_to) b),
  v as (select v.* from tally_vouchers v, bk where v.book_id = bk.b and v.day between p_from and p_to
          and (p_types is null or v.vtype = any(p_types))
          and (p_ledger is null or exists (select 1 from tally_lines l where l.book_id = v.book_id and l.guid = v.guid and l.ledger = p_ledger))
        order by v.day, v.vno limit 20000)
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(v.day, 'YYYYMMDD'), 'type', v.vtype, 'number', v.vno, 'party', v.party, 'narration', v.narration, 'guid', v.guid,
      'optional', case when v.optional then 'Yes' else 'No' end, 'cancelled', case when v.cancelled then 'Yes' else 'No' end,
      'entries', (select coalesce(jsonb_agg(jsonb_build_object('ledger', l.ledger, 'amount', l.amount::text)), '[]'::jsonb) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid))
    order by v.day, v.vno), '[]'::jsonb) from v;
$$;
revoke all on function public.tally_vouchers_in(text, date, date, text, text[]) from public, anon;
grant execute on function public.tally_vouchers_in(text, date, date, text, text[]) to authenticated;
