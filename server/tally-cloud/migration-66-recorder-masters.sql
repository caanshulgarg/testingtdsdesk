-- Migration 66 (07-Oct-2026, FinCom Bridge next: the add-on's master forms, branch next-masterhook). ADD-ONLY: one new
-- table and one new function; no existing table, column, row, function or grant is changed or removed; safe to run twice;
-- one transaction (lock_timeout 10 s). Independent of 61-65 (any order after 44). NOT RUN by this change: written only.
--
-- The add-on now hooks the Pay Head, Stock Item, Unit, Godown and Employee forms as it hooks the Ledger form. The bridge
-- sends each save as a recorder line master_created / master_altered with HEADS ONLY: master_type, name, parent,
-- object_guid, master_id, alter_id (never a body: nothing is asked of Tally for it). tally-ingest's recorder_lines
-- (index.ts) keeps those lines here instead of in tally_recorder_lines (whose tally_recorder_line knows only vouchers and
-- ledgers and would mark them failed): nothing is applied to the books from them yet.
--
--   tally_recorder_masters: one row per line (the same line from two bridges of one computer, or sent again, kept once:
--     unique (book_id, line_id)); the firm reads its own rows (RLS: firm_id = my_firm()); nobody writes them directly.
--   tally_recorder_masters_save(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb) returns jsonb (service role only):
--     the book must be the firm's (else {ok: false, error}); each line {line_id, event, master_type, name, parent,
--     object_guid, master_id, alter_id, saved_at, pc, user, company_guid, company, bridge} (strings cut as tally-ingest cuts
--     them) -> {ok: true, results: [{line_id, state: 'kept' | 'duplicate' | 'failed', why}]}; a line without a line_id, or
--     with an event other than master_created / master_altered, is 'failed' with words and not kept.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.tally_recorder_masters (
  id            bigserial primary key,
  firm_id       uuid not null,
  client_id     text,
  book_id       uuid not null references public.tally_books(book_id) on delete cascade,
  device_id     uuid,
  bridge        text,
  pc            text,
  tally_user    text,
  company_guid  text,
  company       text,
  line_id       text not null,
  event         text not null check (event in ('master_created', 'master_altered')),
  master_type   text,                                  -- Pay Head | Stock Item | Unit | Godown | Employee
  name          text,
  parent        text,
  object_guid   text,
  master_id     text,
  alter_id      bigint,
  saved_at      timestamptz,                           -- Tally's side
  received_at   timestamptz not null default now()
);
create unique index if not exists tally_recorder_masters_line on public.tally_recorder_masters (book_id, line_id);
create index if not exists tally_recorder_masters_firm on public.tally_recorder_masters (firm_id, received_at desc);
create index if not exists tally_recorder_masters_guid on public.tally_recorder_masters (book_id, object_guid);

alter table public.tally_recorder_masters enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_recorder_masters' and policyname = 'tally_recorder_masters_read') then
    create policy tally_recorder_masters_read on public.tally_recorder_masters for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_recorder_masters to authenticated;
revoke insert, update, delete, truncate on public.tally_recorder_masters from anon, authenticated;

create or replace function public.tally_recorder_masters_save(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; x jsonb; lid text; ev text; n int; res jsonb := '[]'::jsonb;
  alt bigint; at timestamptz;
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null or b.firm_id is distinct from p_firm then
    return jsonb_build_object('ok', false, 'error', 'no such book for this firm');
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'lines must be a list');
  end if;
  for x in select value from jsonb_array_elements(p_lines) loop
    lid := left(btrim(coalesce(x->>'line_id', '')), 80);
    ev := left(btrim(coalesce(x->>'event', '')), 40);
    if lid = '' then
      res := res || jsonb_build_array(jsonb_build_object('line_id', '', 'state', 'failed', 'why', 'a master line without its line id is not kept'));
      continue;
    end if;
    if ev not in ('master_created', 'master_altered') then
      res := res || jsonb_build_array(jsonb_build_object('line_id', lid, 'state', 'failed', 'why', 'not a master line: ' || ev));
      continue;
    end if;
    alt := case when coalesce(x->>'alter_id', '') ~ '^[0-9]{1,15}$' then (x->>'alter_id')::bigint end;
    at := null;
    begin at := (x->>'saved_at')::timestamptz; exception when others then at := null; end;
    insert into tally_recorder_masters (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event,
                                        master_type, name, parent, object_guid, master_id, alter_id, saved_at)
    values (b.firm_id, b.client_id, p_book, p_device, left(x->>'bridge', 80), left(x->>'pc', 60), left(x->>'user', 60), left(x->>'company_guid', 100),
            left(x->>'company', 200), lid, ev, left(x->>'master_type', 40), left(x->>'name', 300), left(x->>'parent', 300),
            nullif(left(btrim(coalesce(x->>'object_guid', '')), 100), ''), left(x->>'master_id', 40), alt, at)
    on conflict (book_id, line_id) do nothing;
    get diagnostics n = row_count;
    res := res || jsonb_build_array(jsonb_build_object('line_id', lid, 'state', case when n = 1 then 'kept' else 'duplicate' end, 'why', null));
  end loop;
  return jsonb_build_object('ok', true, 'results', res);
end
$function$;
revoke all on function public.tally_recorder_masters_save(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_masters_save(uuid, uuid, uuid, jsonb) to service_role;

commit;
