-- Migration 71 (09-Oct-2026, FinCom Bridge 2.4.1: one company, two data locations; the owner's approval of 09-Oct-2026,
-- item 3). Runs after 47 (tally_alerts) and 37 (tally_sync_cursor's cleared_*); independent of 61-70 (any order after 60).
-- ADD-ONLY: one new table with its index, row security and grants, and new functions. Nothing on an existing table is
-- changed (no column, grant or CHECK rule): the coordinator's rule of 09-Oct-2026, "nothing dropped", not even a CHECK.
-- No statement here removes rows; safe to run twice; one transaction (lock_timeout 10 s). NOT RUN by this change.
--
-- On 09-Oct-2026 the owner opened GARG SHEKHAR & COMPANY (one company GUID) in two Tallys with different data folders, and
-- one copy's saves reached the other's book. From 2.4.1 the add-on writes the company's data folder on every line and the
-- bridge sends its data id (sha256 of the case-folded, trimmed folder, 16 hex characters): its own per company in the
-- heartbeat (dataSources), on every line it reads from its own Tally (data_id), and a line of another data location as
-- kind 'other_source' (heads only, no body).
--
--   tally_company_sources (id, firm_id, book_id, company_guid, data_id, path, device_id, win_user, computer, first_seen,
--     last_seen, last_line_at, choice 'chosen' | 'other' | 'pending', chosen_by, chosen_at; unique (book_id, data_id)): one
--     row per data location of a linked book. The firm reads its own rows (RLS: firm_id = my_firm()); nobody writes them
--     directly: only the functions below.
--   tally_company_sources_note(p_firm, p_book, p_device, p_sources jsonb) returns jsonb (service role only; tally-ingest's
--     beat and recorder_lines): at most 50 sources [{company_guid, data_id (16 hex), path (<= 260), w, computer, own,
--     line_at}]. A new data id: 'chosen' when the bridge says it is its OWN (own = true) and the book has no chosen one yet
--     (so today's setups stay as they are: the first data id seen for a linked book is chosen by itself); else 'pending',
--     with ONE alert (tally_alerts, the existing kind 'summary' with data.reason 'source': kind's CHECK stays as 47 made
--     it; once per problem: only when the pending row is new). A known one: last
--     seen (and its folder, computer, user, last line) brought up to date; its choice never changes here. Answers {ok,
--     chosenId, sources: [{data_id, choice, n (①, ② ...: by first seen)}]}.
--   tally_company_source_lines(p_firm, p_book, p_device, p_lines jsonb) returns jsonb (service role only): lines of a data
--     location FinCom does not read (other_source, or a line whose data_id is not the chosen one) kept in
--     tally_recorder_lines as 'held' with event 'other_source' and plain words ("saved in another data location of <company>
--     (②, <computer>); FinCom reads ①. Choose on the Tally page."): no GUID, no MasterID, no AlterID, no body, so nothing
--     ever applies them (tally_recorder_release_day runs only created / altered / imported / deleted / cancelled; an
--     owner's release of one fails 'unknown event'). The same line again (book, computer, line id): 'duplicate', already.
--     At most 500 lines a call; the bridge's own received_at kept in the payload.
--   tally_company_source_choose(p_book uuid, p_data_id text) returns jsonb (an active OWNER of the firm only): that data id
--     'chosen' (who and when recorded), every other of the book 'other'; and the book's starting point cleared as
--     tally_baseline_clear (37) clears it (state ok, cleared_at / cleared_by / cleared_note), so the next heartbeat of the
--     chosen location records it afresh (tally_start_point, 46). Writes nothing else.
--   tally_company_sources_of(p_book uuid) returns jsonb (members of the firm): the book's sources with ①/② and the names of
--     who chose (the Tally page's card).
-- Every function: security definer, search_path = public, pg_temp; the service role's revoked from public, anon and
-- authenticated; the members' granted to authenticated only (the checks inside).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.tally_company_sources (
  id            bigserial primary key,
  firm_id       uuid not null,
  book_id       uuid not null references public.tally_books(book_id) on delete restrict,
  company_guid  text check (company_guid is null or char_length(company_guid) <= 100),
  data_id       text not null check (data_id ~ '^[0-9a-f]{16}$'),
  path          text not null default '' check (char_length(path) <= 260),
  device_id     uuid,
  win_user      text not null default '' check (char_length(win_user) <= 200),
  computer      text not null default '' check (char_length(computer) <= 60),
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  last_line_at  timestamptz,                                 -- the last save seen from it (a line), for "last entry <time>"
  choice        text not null default 'pending' check (choice in ('chosen', 'other', 'pending')),
  chosen_by     uuid,
  chosen_at     timestamptz,
  unique (book_id, data_id)
);
create index if not exists tally_company_sources_firm on public.tally_company_sources (firm_id, book_id);

alter table public.tally_company_sources enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_company_sources' and policyname = 'tally_company_sources_read') then
    create policy tally_company_sources_read on public.tally_company_sources for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_company_sources from public, anon, authenticated;
grant select on public.tally_company_sources to authenticated;
revoke all on sequence public.tally_company_sources_id_seq from public, anon, authenticated;

-- ① .. ⑳ (by first seen), else "(21)"
create or replace function public.tally_source_mark(p_n bigint) returns text language sql immutable set search_path = public, pg_temp as $function$
  select case when p_n between 1 and 20 then chr(9311 + p_n::int) else '(' || coalesce(p_n::text, '?') || ')' end
$function$;

-- each source of a book with its mark: (data_id, n)
create or replace function public.tally_source_marks(p_book uuid) returns table (data_id text, n bigint, choice text, computer text)
language sql stable security definer set search_path = public, pg_temp as $function$
  select s.data_id, row_number() over (order by s.first_seen, s.id), s.choice, s.computer from tally_company_sources s where s.book_id = p_book
$function$;

create or replace function public.tally_company_sources_note(p_firm uuid, p_book uuid, p_device uuid, p_sources jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; x jsonb; did text; pth text; usr text; pc text; cg text; own boolean; la timestamptz; r tally_company_sources%rowtype;
  had_chosen boolean; ch text; out_s jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = p_firm;
  if b.book_id is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  if jsonb_typeof(p_sources) is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'sources must be a list'); end if;
  if jsonb_array_length(p_sources) > 50 then return jsonb_build_object('ok', false, 'error', 'at most 50 sources a call'); end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  for x in select * from jsonb_array_elements(p_sources) loop
    did := lower(btrim(coalesce(x->>'data_id', '')));
    if did !~ '^[0-9a-f]{16}$' then continue; end if;
    pth := left(btrim(coalesce(x->>'path', '')), 260); usr := left(btrim(coalesce(x->>'w', '')), 200); pc := left(btrim(coalesce(x->>'computer', '')), 60);
    cg := nullif(left(btrim(coalesce(x->>'company_guid', '')), 100), ''); own := coalesce(x->>'own', '') = 'true';
    la := case when coalesce(x->>'line_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'line_at')::timestamptz, now()) end;
    select * into r from tally_company_sources where book_id = p_book and data_id = did;
    if r.id is null then
      had_chosen := exists (select 1 from tally_company_sources where book_id = p_book and choice = 'chosen');
      insert into tally_company_sources (firm_id, book_id, company_guid, data_id, path, device_id, win_user, computer, last_line_at, choice, chosen_at)
      values (p_firm, p_book, cg, did, pth, p_device, usr, pc, la, case when own and not had_chosen then 'chosen' else 'pending' end, case when own and not had_chosen then now() end)
      on conflict (book_id, data_id) do nothing
      returning * into r;
      if r.id is not null and r.choice = 'pending' then
        -- ONE alert, once per problem: written only with the new pending row (never again for the same data id); the existing
        -- kind 'summary' (a book's row, so never the firm's daily summary, which has no book) marked data.reason 'source'
        insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
        values (p_firm, b.client_id, p_book, p_device, 'summary', (now() at time zone 'Asia/Kolkata')::date,
                format('%s is open in two places with different data: choose on the Tally page which one is your books (FinCom reads only that one)', b.company),
                jsonb_build_object('reason', 'source', 'dataId', did, 'path', pth, 'computer', pc, 'user', usr))
        on conflict do nothing;
      end if;
    else
      update tally_company_sources set last_seen = now(), path = case when pth <> '' then pth else path end, computer = case when pc <> '' then pc else computer end,
             win_user = case when usr <> '' then usr else win_user end, device_id = coalesce(p_device, device_id), company_guid = coalesce(company_guid, cg),
             last_line_at = greatest(last_line_at, la)
       where id = r.id;
    end if;
  end loop;
  select s.data_id into ch from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen' order by s.chosen_at desc nulls last limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('data_id', m.data_id, 'choice', m.choice, 'n', tally_source_mark(m.n)) order by m.n), '[]'::jsonb) into out_s from tally_source_marks(p_book) m;
  return jsonb_build_object('ok', true, 'chosenId', ch, 'sources', out_s);
end $function$;

create or replace function public.tally_company_source_lines(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; x jsonb; lid text; did text; pc text; rid bigint; rst text; ch_n text; my_n text; why text; res jsonb := '[]'::jsonb; ra timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = p_firm;
  if b.book_id is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then return jsonb_build_object('ok', false, 'error', 'lines must be a list of at most 500'); end if;
  select tally_source_mark(m.n) into ch_n from tally_source_marks(p_book) m where m.choice = 'chosen' limit 1;
  for x in select * from jsonb_array_elements(p_lines) loop
    lid := nullif(left(btrim(coalesce(x->>'line_id', '')), 80), ''); did := lower(btrim(coalesce(x->>'data_id', '')));
    if lid is null or did !~ '^[0-9a-f]{16}$' then
      res := res || jsonb_build_array(jsonb_build_object('line_id', coalesce(lid, ''), 'state', 'failed', 'why', 'a line of another data location needs its line id and data id'));
      continue;
    end if;
    select r.id, r.state into rid, rst from tally_recorder_lines r where r.book_id = p_book and r.line_id = lid and r.device_id is not distinct from p_device order by r.id desc limit 1;
    if rid is not null then
      res := res || jsonb_build_array(jsonb_build_object('line_id', lid, 'state', 'duplicate', 'already', true, 'was', rst, 'why', 'already have this line'));
      continue;
    end if;
    pc := left(btrim(coalesce(x->>'pc', '')), 60);
    select tally_source_mark(m.n) into my_n from tally_source_marks(p_book) m where m.data_id = did;
    why := format('saved in another data location of %s (%s, %s); FinCom reads %s. Choose on the Tally page.', b.company, coalesce(my_n, did), coalesce(nullif(pc, ''), 'another computer'),
                  coalesce(ch_n, 'none of them yet'));
    ra := case when coalesce(x->>'received_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'received_at')::timestamptz, now()) end;
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, vch_type, vch_no, vch_date, saved_at, state, held_why, payload)
    values (p_firm, b.client_id, p_book, p_device, left(coalesce(x->>'bridge', ''), 80), pc, left(coalesce(x->>'user', ''), 60), nullif(left(coalesce(x->>'company_guid', ''), 100), ''),
            left(coalesce(x->>'company', b.company), 200), lid, 'other_source', nullif(left(coalesce(x->>'vch_type', ''), 60), ''), nullif(left(coalesce(x->>'vch_no', ''), 60), ''),
            case when coalesce(x->>'vch_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'vch_date')::date end,
            case when coalesce(x->>'saved_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'saved_at')::timestamptz, now()) end,
            'held', why,
            jsonb_build_object('otherSource', true, 'of', left(coalesce(x->>'of', ''), 20), 'dataId', did, 'dataPath', left(coalesce(x->>'data_path', ''), 260), 'w', left(coalesce(x->>'w', ''), 200),
                               'pc', pc, 'received_at', ra, 'heldWhy', why))
    returning id into rid;
    res := res || jsonb_build_array(jsonb_build_object('id', rid, 'line_id', lid, 'state', 'held', 'why', why));
  end loop;
  return jsonb_build_object('ok', true, 'results', res);
end $function$;

create or replace function public.tally_company_source_choose(p_book uuid, p_data_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); did text := lower(btrim(coalesce(p_data_id, ''))); b tally_books%rowtype; n text; c tally_sync_cursor%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose which data location FinCom reads' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = f;
  if b.book_id is null then raise exception 'not a company of your firm'; end if;
  if did !~ '^[0-9a-f]{16}$' or not exists (select 1 from tally_company_sources where book_id = p_book and data_id = did) then
    raise exception 'not a data location of this company';
  end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  update tally_company_sources set choice = 'chosen', chosen_by = auth.uid(), chosen_at = now() where book_id = p_book and data_id = did;
  update tally_company_sources set choice = 'other' where book_id = p_book and data_id <> did and choice <> 'other';
  select tally_source_mark(m.n) into n from tally_source_marks(p_book) m where m.data_id = did;
  -- the starting point cleared as tally_baseline_clear (37) clears it: the next heartbeat of the chosen location records it
  -- afresh (tally_start_point, 46)
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  update tally_sync_cursor set state = 'ok', cleared_at = now(), cleared_by = auth.uid(),
         cleared_note = left(format('data location %s chosen on the Tally page: FinCom reads only it; its starting point is recorded afresh', coalesce(n, did)), 500), updated_at = now()
   where book_id = p_book returning * into c;
  return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', c.book_id is not null);
end $function$;

create or replace function public.tally_company_sources_of(p_book uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('data_id', s.data_id, 'n', tally_source_mark(m.n), 'choice', s.choice, 'path', s.path, 'computer', s.computer, 'user', s.win_user,
           'firstSeen', s.first_seen, 'lastSeen', s.last_seen, 'lastLine', s.last_line_at, 'chosenAt', s.chosen_at,
           'chosenBy', (select coalesce(nullif(mm.name, ''), 'an owner') from members mm where mm.user_id = s.chosen_by and mm.firm_id = s.firm_id limit 1)) order by m.n), '[]'::jsonb)
    from tally_company_sources s join tally_source_marks(p_book) m on m.data_id = s.data_id
   where s.book_id = p_book and s.firm_id = my_firm()
$function$;

revoke all on function public.tally_source_mark(bigint) from public, anon, authenticated;
revoke all on function public.tally_source_marks(uuid) from public, anon, authenticated;
revoke all on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_company_source_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_company_source_choose(uuid, text) from public, anon;
revoke all on function public.tally_company_sources_of(uuid) from public, anon;
grant execute on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb), public.tally_company_source_lines(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.tally_company_source_choose(uuid, text), public.tally_company_sources_of(uuid) to authenticated;

commit;
