-- FinCom: a copy of each client's Tally books in the cloud, kept in step by the bridge on the computer with Tally.
--
-- What is kept, per Tally company ("book"; a client may have several, e.g. one company per year in Tally):
--   tally_days       one row per day held, and the day's day book (gzip XML) in the private bucket tally-days,
--                    at <firm>/<book>/<yyyymm>/<yyyymmdd>.xml.gz, for the full GST and TDS work in FinCom
--   tally_vouchers   each entry's heads (date, type, number, party, narration, cancelled or optional)
--   tally_lines      each entry's ledger lines (Tally's sign: a debit is negative)
--   tally_ledger_day ready totals: each ledger's movement on each day, so a balance on any date is one quick sum
--   tally_ledgers    each ledger's group and its opening balance on the day before the copy starts
--   tally_books      the copy's period, and when it was last brought up to date
-- Who may send:  a computer with its own key (tally_devices, only a hash is kept), through the tally-ingest function,
--                and only for a company linked to one of its firm's clients (tally_companies).
-- Who may read:  members of the firm, through the functions below (row-level security as everywhere else).

create table if not exists public.tally_devices (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms(id) on delete cascade,
  name        text not null,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  last_seen   timestamptz,
  version     text,
  info        jsonb not null default '{}'::jsonb,
  revoked     boolean not null default false
);
create index if not exists tally_devices_firm on public.tally_devices (firm_id);

create table if not exists public.tally_companies (
  firm_id     uuid not null references public.firms(id) on delete cascade,
  company     text not null,
  client_id   text,
  gstin       text,
  device_id   uuid references public.tally_devices(id) on delete set null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz,
  linked_at   timestamptz,
  linked_by   uuid,
  book_id     uuid not null default gen_random_uuid() unique,
  primary key (firm_id, company)
);

-- one book per Tally company (a client that keeps each year as its own company in Tally has one book a year)
create table if not exists public.tally_books (
  book_id     uuid primary key,
  firm_id     uuid not null references public.firms(id) on delete cascade,
  client_id   text not null,
  company     text not null,
  from_date   date,
  open_as_on  date,
  ledgers_at  timestamptz,
  days_at     timestamptz,
  state       jsonb not null default '{}'::jsonb,
  state_at    timestamptz
);
create index if not exists tally_books_client on public.tally_books (firm_id, client_id);

create table if not exists public.tally_ledgers (
  book_id     uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null,
  name        text not null,
  parent      text not null default '',
  open        numeric(18,2) not null default 0,
  primary key (book_id, name)
);

create table if not exists public.tally_days (
  book_id     uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null,
  day         date not null,
  n           integer not null default 0,
  alter_max   bigint not null default 0,
  bytes       integer not null default 0,
  at          timestamptz not null default now(),
  primary key (book_id, day)
);

create table if not exists public.tally_vouchers (
  book_id     uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null,
  guid        text not null,
  day         date not null,
  alter_id    bigint not null default 0,
  vtype       text not null default '',
  vno         text not null default '',
  party       text not null default '',
  narration   text not null default '',
  cancelled   boolean not null default false,
  optional    boolean not null default false,
  primary key (book_id, guid)
);
create index if not exists tally_vouchers_day on public.tally_vouchers (book_id, day);

create table if not exists public.tally_lines (
  book_id     uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null,
  guid        text not null,
  day         date not null,
  ledger      text not null,
  amount      numeric(18,2) not null
);
create index if not exists tally_lines_ledger on public.tally_lines (book_id, ledger, day);
create index if not exists tally_lines_guid on public.tally_lines (book_id, guid);

create table if not exists public.tally_ledger_day (
  book_id     uuid not null references public.tally_books(book_id) on delete cascade,
  firm_id     uuid not null,
  ledger      text not null,
  day         date not null,
  amount      numeric(18,2) not null default 0,
  dr          numeric(18,2) not null default 0,
  cr          numeric(18,2) not null default 0,
  n           integer not null default 0,
  primary key (book_id, ledger, day)
);
create index if not exists tally_ledger_day_day on public.tally_ledger_day (book_id, day);

-- row-level security: members read their own firm's rows; nobody writes directly (only the functions below)
do $$
declare t text;
begin
  foreach t in array array['tally_devices','tally_companies','tally_books','tally_ledgers','tally_days','tally_vouchers','tally_lines','tally_ledger_day'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (firm_id = public.my_firm())', t || '_read', t);
  end loop;
end $$;
-- the device key hash is never readable, not even by the firm
revoke select on public.tally_devices from authenticated, anon;
grant select (id, firm_id, name, created_at, created_by, last_seen, version, info, revoked) on public.tally_devices to authenticated;

-- ---------------------------------------------------------------- the private bucket for each day's day book
insert into storage.buckets (id, name, public) values ('tally-days', 'tally-days', false) on conflict (id) do nothing;
drop policy if exists tally_days_read on storage.objects;
create policy tally_days_read on storage.objects for select to authenticated
  using (bucket_id = 'tally-days' and (storage.foldername(name))[1] = public.my_firm()::text);

-- ---------------------------------------------------------------- the firm: computers and companies
-- a new computer: its key is shown once; only its hash is kept
create or replace function public.tally_device_create(p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare f uuid := my_firm(); k text; d uuid;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'give the computer a name'; end if;
  if (select count(*) from tally_devices where firm_id = f and not revoked) >= 50 then raise exception 'too many computers; remove one first'; end if;
  k := 'fcd_' || encode(gen_random_bytes(24), 'hex');
  insert into tally_devices (firm_id, name, key_hash, created_by) values (f, left(trim(p_name), 80), encode(digest(k, 'sha256'), 'hex'), auth.uid()) returning id into d;
  return jsonb_build_object('id', d, 'key', k);
end $$;

create or replace function public.tally_device_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm();
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_devices set revoked = true where id = p_id and firm_id = f;
end $$;

-- link a Tally company to one of the firm's clients (or unlink, with p_client null)
create or replace function public.tally_company_link(p_company text, p_client text)
returns void language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); cg text; tg text;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_client is not null then
    select gstin into cg from clients where id = p_client and firm_id = f and not coalesce(deleted, false);
    if not found then raise exception 'no such client'; end if;
    select gstin into tg from tally_companies where firm_id = f and company = p_company;
    -- a company whose GSTIN is not the client's is never linked (someone else's books must not land in this client)
    if coalesce(cg, '') <> '' and coalesce(tg, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(tg, 3, 10)) then
      raise exception 'the GSTIN of % in Tally (%) is not this client''s (%)', p_company, tg, cg;
    end if;
  end if;
  insert into tally_companies (firm_id, company, client_id, linked_at, linked_by) values (f, p_company, p_client, now(), auth.uid())
  on conflict (firm_id, company) do update set client_id = excluded.client_id, linked_at = now(), linked_by = auth.uid();
  -- the book follows the link; unlinked, it belongs to no client until linked again
  update tally_books b set client_id = coalesce(p_client, '') from tally_companies c where c.firm_id = f and c.company = p_company and b.book_id = c.book_id;
end $$;

-- ---------------------------------------------------------------- sending (called only by the tally-ingest function)
-- the book a company's data goes into; only for a company linked to a client of the same firm
create or replace function public.tally_book_for(p_firm uuid, p_company text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c tally_companies%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from tally_companies where firm_id = p_firm and company = p_company;
  if not found or c.client_id is null then return null; end if;
  if not exists (select 1 from clients where id = c.client_id and firm_id = p_firm and not coalesce(deleted, false)) then return null; end if;
  insert into tally_books (book_id, firm_id, client_id, company) values (c.book_id, p_firm, c.client_id, p_company)
  on conflict (book_id) do update set client_id = excluded.client_id;
  return c.book_id;
end $$;

-- one day, replaced whole: its entries and lines, and the ready totals of every day it touched (an entry moved from
-- another date is taken off that date too)
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare touched date[]; f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x)
  ) q;
  delete from tally_lines l where l.book_id = p_book and (l.day = p_day or l.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional)
  select p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         coalesce(x->>'party', ''), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false)
    from jsonb_array_elements(p_vouchers) x
  on conflict (book_id, guid) do update set day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno,
    party = excluded.party, narration = excluded.narration, cancelled = excluded.cancelled, optional = excluded.optional;
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
  select p_book, f, x->>0, p_day, x->>1, (x->>2)::numeric from jsonb_array_elements(p_lines) x;
  -- ready totals of the touched days: cancelled and optional entries do not count
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(touched);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(touched) and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at) values (p_book, f, p_day, p_n, p_alter, p_bytes, now())
  on conflict (book_id, day) do update set n = excluded.n, alter_max = excluded.alter_max, bytes = excluded.bytes, at = now();
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched));
end $$;

-- the ledgers and their opening balances, replaced whole
create or replace function public.tally_ingest_ledgers(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_books set from_date = p_from, open_as_on = p_open_as_on, ledgers_at = now() where book_id = p_book;
  -- a copy that now starts later: entries before it go
  delete from tally_lines where book_id = p_book and day < p_from;
  delete from tally_vouchers where book_id = p_book and day < p_from;
  delete from tally_ledger_day where book_id = p_book and day < p_from;
  delete from tally_days where book_id = p_book and day < p_from;
  delete from tally_ledgers where book_id = p_book;
  insert into tally_ledgers (book_id, firm_id, name, parent, open)
  select p_book, f, x->>0, coalesce(x->>1, ''), coalesce(nullif(x->>2, '')::numeric, 0) from jsonb_array_elements(p_ledgers) x
  on conflict (book_id, name) do update set parent = excluded.parent, open = excluded.open;
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers));
end $$;

create or replace function public.tally_ingest_state(p_book uuid, p_state jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_books set state = coalesce(p_state, '{}'::jsonb), state_at = now() where book_id = p_book;
end $$;

revoke all on function public.tally_book_for(uuid, text) from public, anon, authenticated;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer) from public, anon, authenticated;
revoke all on function public.tally_ingest_ledgers(uuid, date, date, jsonb) from public, anon, authenticated;
revoke all on function public.tally_ingest_state(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- reading (members of the firm)
-- the client's book for a date: the latest one whose copy starts on or before it (a company per year: that year's)
create or replace function public.tally_pick(p_client text, p_on date)
returns uuid language sql stable security definer set search_path = public as $$
  select b.book_id from tally_books b
   where b.client_id = p_client and b.firm_id = my_firm() and b.from_date is not null
     and (p_on is null or b.open_as_on <= p_on)
   order by (b.from_date <= coalesce(p_on, b.from_date)) desc, b.from_date desc limit 1
$$;

-- the trial balance on a date: each ledger's opening plus its movement up to that date. Tally's sign.
create or replace function public.tally_tb(p_client text, p_as_on date)
returns table (ledger text, parent text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select t.name, t.parent, t.open from tally_ledgers t where t.book_id = bk),
    mv as (select d.ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.day between b.from_date and p_as_on group by d.ledger)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name;
end $$;

-- one ledger: its balance before the period and every line in it
create or replace function public.tally_ledger(p_client text, p_ledger text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype; ob numeric; lines jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  select coalesce((select t.open from tally_ledgers t where t.book_id = bk and t.name = p_ledger), 0)
       + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = p_ledger and d.day >= b.from_date and d.day < p_from), 0)
    into ob;
  select coalesce(jsonb_agg(jsonb_build_array(to_char(l.day, 'YYYYMMDD'), v.vtype, v.vno, v.party, v.narration, l.amount, l.guid) order by l.day, v.vno), '[]'::jsonb)
    into lines
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = bk and l.ledger = p_ledger and l.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional;
  return jsonb_build_object('open', ob, 'lines', lines, 'from', b.from_date, 'company', b.company, 'daysAt', b.days_at);
end $$;

-- each ledger's movement month by month
create or replace function public.tally_monthly(p_client text, p_from date, p_to date)
returns table (ledger text, ym text, amount numeric, dr numeric, cr numeric)
language plpgsql stable security definer set search_path = public as $$
declare bk uuid := tally_pick(p_client, p_from);
begin
  if bk is null then return; end if;
  return query select d.ledger, to_char(d.day, 'YYYYMM'), sum(d.amount), sum(d.dr), sum(d.cr) from tally_ledger_day d
    where d.book_id = bk and d.day between p_from and p_to group by d.ledger, to_char(d.day, 'YYYYMM');
end $$;

-- the client's books in the cloud: each one's period, state and days held
create or replace function public.tally_status(p_client text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('book', b.book_id, 'company', b.company, 'from', b.from_date, 'openAsOn', b.open_as_on,
      'ledgersAt', b.ledgers_at, 'daysAt', b.days_at, 'state', b.state, 'stateAt', b.state_at,
      'days', (select count(*) from tally_days d where d.book_id = b.book_id),
      'entries', (select coalesce(sum(n), 0) from tally_days d where d.book_id = b.book_id),
      'to', (select max(day) from tally_days d where d.book_id = b.book_id)) order by b.from_date desc nulls last), '[]'::jsonb)
    from tally_books b where b.client_id = p_client and b.firm_id = my_firm()
$$;

create or replace function public.tally_days_list(p_book uuid, p_from date, p_to date)
returns table (day text, n integer, at timestamptz)
language sql stable security definer set search_path = public as $$
  select to_char(d.day, 'YYYYMMDD'), d.n, d.at from tally_days d
   where d.book_id = p_book and d.firm_id = my_firm() and d.day between p_from and p_to order by d.day
$$;

grant execute on function public.tally_device_create(text), public.tally_device_revoke(uuid), public.tally_company_link(text, text),
  public.tally_tb(text, date), public.tally_ledger(text, text, date, date), public.tally_monthly(text, date, date),
  public.tally_status(text), public.tally_days_list(uuid, date, date) to authenticated;
revoke all on function public.tally_pick(text, date) from public, anon;

-- ---------------------------------------------------------------- later on staging (tally_support_bucket, tally_cloud_grants)
-- what a computer's FinCom Connector sends to FinCom support (the log and details, no keys): only platform admins read it
insert into storage.buckets (id, name, public, file_size_limit) values ('tally-support', 'tally-support', false, 10485760) on conflict (id) do nothing;
drop policy if exists tally_support_admin_read on storage.objects;
create policy tally_support_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'tally-support' and exists (select 1 from public.platform_admins a where a.user_id = auth.uid()));
-- signed-in members only for reading (each function checks the firm inside); the sending ones only for tally-ingest
revoke execute on function public.tally_tb(text, date), public.tally_ledger(text, text, date, date), public.tally_monthly(text, date, date),
  public.tally_status(text), public.tally_days_list(uuid, date, date), public.tally_device_create(text), public.tally_device_revoke(uuid),
  public.tally_company_link(text, text), public.tally_pick(text, date) from public, anon;
grant execute on function public.tally_tb(text, date), public.tally_ledger(text, text, date, date), public.tally_monthly(text, date, date),
  public.tally_status(text), public.tally_days_list(uuid, date, date), public.tally_device_create(text), public.tally_device_revoke(uuid),
  public.tally_company_link(text, text), public.tally_pick(text, date) to authenticated;
revoke execute on function public.tally_book_for(uuid, text), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer),
  public.tally_ingest_ledgers(uuid, date, date, jsonb), public.tally_ingest_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_book_for(uuid, text), public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer),
  public.tally_ingest_ledgers(uuid, date, date, jsonb), public.tally_ingest_state(uuid, jsonb) to service_role;
