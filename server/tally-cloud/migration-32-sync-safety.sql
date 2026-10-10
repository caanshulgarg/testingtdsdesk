-- FinCom Bridge 2.1.4 as rebuilt on 02-Oct-2026 (the owner's re-scope): what keeps the books and the postings safe
-- while the change read is measured. Adds only: new tables, columns, a view and functions; nothing is dropped, deleted
-- or replaced. To be shown to the owner before it runs.
--
-- "company_id" in the owner's list is the existing tally_books.book_id (one book per Tally company, tally_companies.
-- book_id): every new table keys on it, no new id is made.
--
--   tally_post_ids               each voucher's FinCom id (the "TDSDesk:<id>" its narration carries; FinCom's entry id
--                                when it has none) for every posting queued, kept by a trigger on tally_post_jobs. One live
--                                posting per FinCom id in a firm (a unique index over the jobs not failed or cancelled):
--                                the same bill can never be queued twice at once, whatever the browser does
--   tally_company_lease          the one bridge reading or posting a company now: holder (the bridge's id), until (it
--                                expires); tally_lease_take / tally_lease_release (tally-ingest, service role), firm-scoped
--   tally_sync_cursor            per company: its Tally GUID, the last master and voucher AlterIDs held, the voucher count,
--                                when the baseline was done, and its state ('ok', or 'needs_baseline' when the GUID changed
--                                or Tally's numbers went back), with the last read's GUID, highest AlterID and count
--   tally_sync_reads             every read's company GUID, highest AlterID and voucher count (append-only): the rewind guard
--   tally_sync_guard(...)        a read noted, the cursor brought up to date, and the state answered
--   tally_vouchers + deleted_at, origin   (tally_vouchers.guid is Tally's GUID and (book_id, guid) its primary key already:
--                                that is the unique (company, tally_guid)); origin 'fincom' for an entry carrying a FinCom id
--   tally_ledgers + tally_guid, alter_id, deleted_at, origin; unique (book_id, tally_guid) where a GUID is known
--   tally_voucher_versions       every version of an entry seen (book, GUID, AlterID, the row as kept), append-only, kept by
--                                a trigger on tally_vouchers
--   tally_voucher_newer(...)     the upsert rule: an entry is taken only when its AlterID is higher than any version seen
--   tally_balances               a plain view: each ledger's opening, its entries from the book's start, and the closing

begin;

-- ---------------------------------------------------------------- 1. the posting's FinCom id, once per live posting
create table if not exists public.tally_post_ids (
  firm_id    uuid not null references public.firms(id) on delete cascade,
  client_id  text not null,
  fincom_id  text not null,
  job_id     uuid not null references public.tally_post_jobs(id) on delete cascade,
  entry_id   text,
  live       boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (job_id, fincom_id)
);
create unique index if not exists tally_post_ids_live on public.tally_post_ids (firm_id, fincom_id) where live;
alter table public.tally_post_ids enable row level security;
drop policy if exists tally_post_ids_read on public.tally_post_ids;
create policy tally_post_ids_read on public.tally_post_ids for select to authenticated using (firm_id = my_firm());
revoke insert, update, delete on public.tally_post_ids from anon, authenticated;

-- a voucher's FinCom id: the tag in its XML (as the bridge reads it), else the entry's id in letters and digits (as the
-- bridge stamps it)
create or replace function public.tally_fincom_id(p_voucher jsonb)
returns text language sql immutable as $function$
  select coalesce(substring(p_voucher->>'xml' from 'TDSDesk:([A-Za-z0-9._-]+)'), nullif(regexp_replace(coalesce(p_voucher->>'id', ''), '[^A-Za-z0-9]', '', 'g'), ''))
$function$;

create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them
    update tally_post_ids set live = new.status not in ('failed', 'cancelled') where job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;

-- the postings queued before this: their ids, live only for the first posting of each id still going
insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
select firm_id, client_id, fid, id, eid, live and rn = 1 from (
  select j.firm_id, j.client_id, tally_fincom_id(v) as fid, j.id, v->>'id' as eid, j.status not in ('failed', 'cancelled') as live,
         row_number() over (partition by j.firm_id, tally_fincom_id(v), j.status not in ('failed', 'cancelled') order by j.created_at) as rn,
         row_number() over (partition by j.id, tally_fincom_id(v) order by v->>'id') as one
    from tally_post_jobs j, jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v
   where tally_fincom_id(v) is not null) z
 where one = 1
on conflict (job_id, fincom_id) do nothing;

drop trigger if exists tally_post_ids_sync on public.tally_post_jobs;
create trigger tally_post_ids_sync after insert or update of status on public.tally_post_jobs for each row execute function public.tally_post_ids_sync();

-- ---------------------------------------------------------------- 2. the lease on a company
create table if not exists public.tally_company_lease (
  book_id     uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null references public.firms(id) on delete cascade,
  holder      text not null,                -- the bridge's id (go-...)
  device_id   uuid,
  info        jsonb not null default '{}'::jsonb,   -- computer, user, version
  taken_at    timestamptz not null default now(),
  until       timestamptz not null
);
alter table public.tally_company_lease enable row level security;
drop policy if exists tally_company_lease_read on public.tally_company_lease;
create policy tally_company_lease_read on public.tally_company_lease for select to authenticated using (firm_id = my_firm());
revoke insert, update, delete on public.tally_company_lease from anon, authenticated;

-- take or renew: free, expired, or this holder's own -> taken until now + ttl; else who holds it
create or replace function public.tally_lease_take(p_firm uuid, p_book uuid, p_holder text, p_device uuid, p_ttl integer, p_info jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare l tally_company_lease%rowtype; ttl int := greatest(30, least(coalesce(p_ttl, 120), 900));
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('lease' || p_book::text));
  select * into l from tally_company_lease where book_id = p_book;
  if l.book_id is not null and l.holder <> p_holder and l.until > now() then
    return jsonb_build_object('ok', true, 'held', true, 'holder', jsonb_build_object('bridge', l.holder, 'computer', l.info->>'computer', 'user', l.info->>'user',
      'until', to_char(l.until at time zone 'Asia/Kolkata', 'HH24:MI'), 'untilAt', l.until));
  end if;
  insert into tally_company_lease (book_id, firm_id, holder, device_id, info, taken_at, until)
  values (p_book, p_firm, p_holder, p_device, coalesce(p_info, '{}'::jsonb), now(), now() + make_interval(secs => ttl))
  on conflict (book_id) do update set holder = excluded.holder, device_id = excluded.device_id, info = excluded.info,
     taken_at = case when tally_company_lease.holder = excluded.holder and tally_company_lease.until > now() then tally_company_lease.taken_at else now() end,
     until = excluded.until;
  return jsonb_build_object('ok', true, 'held', false, 'lease', jsonb_build_object('until', now() + make_interval(secs => ttl), 'ttl', ttl));
end $function$;

create or replace function public.tally_lease_release(p_firm uuid, p_book uuid, p_holder text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from tally_company_lease where book_id = p_book and firm_id = p_firm and holder = p_holder;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'released', n > 0);
end $function$;

-- ---------------------------------------------------------------- 3. the sync cursor and the rewind guard
create table if not exists public.tally_sync_cursor (
  book_id               uuid primary key references public.tally_books(book_id) on delete cascade,
  firm_id               uuid not null references public.firms(id) on delete cascade,
  company_guid          text,
  last_master_alterid   bigint,
  last_voucher_alterid  bigint,
  voucher_count         bigint,
  baseline_done_at      timestamptz,
  state                 text not null default 'ok' check (state in ('ok', 'needs_baseline')),
  state_why             text,
  state_at              timestamptz,
  read_guid             text,          -- the last read: the company's GUID, its highest AlterID, the entries it read
  read_alterid          bigint,
  read_count            bigint,
  read_at               timestamptz,
  updated_at            timestamptz not null default now()
);
create table if not exists public.tally_sync_reads (
  book_id          uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id          uuid not null,
  at               timestamptz not null default now(),
  company_guid     text,
  highest_alterid  bigint,
  voucher_count    bigint,
  device_id        uuid,
  bridge           text,
  state            text
);
create index if not exists tally_sync_reads_book on public.tally_sync_reads (book_id, at desc);
alter table public.tally_sync_cursor enable row level security;
alter table public.tally_sync_reads enable row level security;
drop policy if exists tally_sync_cursor_read on public.tally_sync_cursor;
create policy tally_sync_cursor_read on public.tally_sync_cursor for select to authenticated using (firm_id = my_firm());
drop policy if exists tally_sync_reads_read on public.tally_sync_reads;
create policy tally_sync_reads_read on public.tally_sync_reads for select to authenticated using (firm_id = my_firm());
revoke insert, update, delete on public.tally_sync_cursor, public.tally_sync_reads from anon, authenticated;

-- a read (or the company list, p_alter null) noted: a GUID other than the one held, or a highest AlterID lower than the
-- last read's, marks the company needs_baseline (it stays so until a person clears it); the answer is the state
create or replace function public.tally_sync_guard(p_firm uuid, p_book uuid, p_guid text, p_alter bigint, p_count bigint, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare c tally_sync_cursor%rowtype; why text; g text := nullif(btrim(coalesce(p_guid, '')), '');
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id, company_guid) values (p_book, p_firm, g) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  if g is not null and c.company_guid is not null and c.company_guid <> g then
    why := 'the company''s Tally GUID changed (' || c.company_guid || ' -> ' || g || '): a restored, re-created or other company';
  elsif p_alter is not null and c.read_alterid is not null and p_alter < c.read_alterid then
    why := 'Tally''s highest AlterID went back (' || c.read_alterid || ' -> ' || p_alter || '): a backup restored or the data rewritten';
  end if;
  update tally_sync_cursor set
     company_guid = coalesce(company_guid, g),
     state = case when why is not null then 'needs_baseline' else state end,
     state_why = coalesce(why, state_why),
     state_at = case when why is not null then now() else state_at end,
     read_guid = coalesce(g, read_guid),
     read_alterid = case when p_alter is not null then p_alter else read_alterid end,
     read_count = case when p_count is not null then p_count else read_count end,
     read_at = case when p_alter is not null or p_count is not null then now() else read_at end,
     updated_at = now()
   where book_id = p_book
  returning * into c;
  if p_alter is not null or p_count is not null then
    insert into tally_sync_reads (book_id, firm_id, company_guid, highest_alterid, voucher_count, device_id, bridge, state)
    values (p_book, p_firm, g, p_alter, p_count, p_device, left(coalesce(p_bridge, ''), 40), c.state);
  end if;
  return jsonb_build_object('ok', true, 'state', c.state, 'why', c.state_why, 'guid', c.company_guid);
end $function$;

-- ---------------------------------------------------------------- 4. entries and ledgers: Tally's identity, deletions, origin
alter table public.tally_vouchers add column if not exists deleted_at timestamptz;
alter table public.tally_vouchers add column if not exists origin text not null default 'tally';
alter table public.tally_ledgers add column if not exists tally_guid text;
alter table public.tally_ledgers add column if not exists alter_id bigint;
alter table public.tally_ledgers add column if not exists deleted_at timestamptz;
alter table public.tally_ledgers add column if not exists origin text not null default 'tally';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tally_vouchers_origin_chk') then
    alter table public.tally_vouchers add constraint tally_vouchers_origin_chk check (origin in ('fincom', 'tally'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tally_ledgers_origin_chk') then
    alter table public.tally_ledgers add constraint tally_ledgers_origin_chk check (origin in ('fincom', 'tally'));
  end if;
end $$;
create unique index if not exists tally_ledgers_tally_guid on public.tally_ledgers (book_id, tally_guid) where tally_guid is not null;

-- an entry carrying a FinCom id was posted from FinCom
create or replace function public.tally_vouchers_origin() returns trigger language plpgsql as $function$
begin
  if new.narration ~ 'TDSDesk:[A-Za-z0-9]' then new.origin := 'fincom'; end if;
  return new;
end $function$;
drop trigger if exists tally_vouchers_origin on public.tally_vouchers;
create trigger tally_vouchers_origin before insert on public.tally_vouchers for each row execute function public.tally_vouchers_origin();
update public.tally_vouchers set origin = 'fincom' where origin = 'tally' and narration ~ 'TDSDesk:[A-Za-z0-9]';

-- ---------------------------------------------------------------- 5. every version of an entry, append-only
create table if not exists public.tally_voucher_versions (
  book_id     uuid not null,
  firm_id     uuid not null,
  tally_guid  text not null,
  alter_id    bigint not null,
  payload     jsonb not null,
  seen_at     timestamptz not null default now(),
  primary key (book_id, tally_guid, alter_id)
);
alter table public.tally_voucher_versions enable row level security;
drop policy if exists tally_voucher_versions_read on public.tally_voucher_versions;
create policy tally_voucher_versions_read on public.tally_voucher_versions for select to authenticated using (firm_id = my_firm());
revoke insert, update, delete on public.tally_voucher_versions from anon, authenticated;

create or replace function public.tally_voucher_versions_keep() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  values (new.book_id, new.firm_id, new.guid, coalesce(new.alter_id, 0), to_jsonb(new))
  on conflict (book_id, tally_guid, alter_id) do nothing;
  return new;
end $function$;
drop trigger if exists tally_voucher_versions_keep on public.tally_vouchers;
create trigger tally_voucher_versions_keep after insert on public.tally_vouchers for each row execute function public.tally_voucher_versions_keep();

create or replace function public.tally_voucher_versions_frozen() returns trigger language plpgsql as $function$
begin
  raise exception 'tally_voucher_versions is append-only' using errcode = '42501';
end $function$;
drop trigger if exists tally_voucher_versions_frozen on public.tally_voucher_versions;
create trigger tally_voucher_versions_frozen before update or delete on public.tally_voucher_versions for each row execute function public.tally_voucher_versions_frozen();

-- the versions held now are the first ones seen
insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v
on conflict (book_id, tally_guid, alter_id) do nothing;

-- the upsert rule: an incoming entry is taken only when its AlterID is higher than every version seen of it
create or replace function public.tally_voucher_newer(p_book uuid, p_guid text, p_alter bigint)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce(p_alter, 0) > coalesce((select max(alter_id) from tally_voucher_versions where book_id = p_book and tally_guid = p_guid), -1)
$function$;

-- ---------------------------------------------------------------- 6. balances: a plain view over openings plus entries
create or replace view public.tally_balances with (security_invoker = true) as
  select l.book_id, l.firm_id, l.name as ledger, l.parent, l.primary_group, coalesce(l.open, 0) as open,
         coalesce(m.movement, 0) as movement, coalesce(l.open, 0) + coalesce(m.movement, 0) as closing, m.last_day
    from public.tally_ledgers l
    left join (select d.book_id, d.ledger, sum(d.amount) as movement, max(d.day) as last_day
                 from public.tally_ledger_day d join public.tally_books b on b.book_id = d.book_id
                where d.day >= b.from_date group by d.book_id, d.ledger) m on m.book_id = l.book_id and m.ledger = l.name
   where l.merged_into is null;
grant select on public.tally_balances to authenticated;

revoke all on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb), public.tally_lease_release(uuid, uuid, text),
  public.tally_sync_guard(uuid, uuid, text, bigint, bigint, uuid, text), public.tally_voucher_newer(uuid, text, bigint),
  public.tally_post_ids_sync(), public.tally_voucher_versions_keep() from public, anon, authenticated;
grant execute on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb), public.tally_lease_release(uuid, uuid, text),
  public.tally_sync_guard(uuid, uuid, text, bigint, bigint, uuid, text), public.tally_voucher_newer(uuid, text, bigint) to service_role;

commit;
