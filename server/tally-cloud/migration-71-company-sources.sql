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
--
-- The reviews of next-241 (0f436f6c), in this same file (71 has not run anywhere):
--   H3  a source is noted only for the book's own company (tally_sync_cursor.company_guid); another GUID is answered
--       otherCompany, never noted, never chosen by itself.
--   M2  chosen by itself only as the location of the computer the book's starting point came from (start_device), the
--       bridge saying it is its own, none chosen yet; a book with no starting point: its first location pending (no alert)
--       until its starting point is recorded from that computer, then chosen and its held lines applied. Every other
--       location pending, with ONE alert (when it is a problem: another location, or a starting point from elsewhere).
--   H5  a set of chosen locations a book (one data folder may be read under two paths: D:\TallyData on the server,
--       \\SERVER\TallyData or Z:\ on a client). A pending location's lines are kept held WITH their entry (body, pending);
--       tally_company_source_same(book) (an owner: "These are the same data") chooses every location and applies them
--       (tally_company_source_release); "Use ①" leaves them held for good.
--   M3  choosing the location FinCom reads already (alone) stamps who and when only (the starting point kept).
--   L4/H2  tally_recorder_send_sourced(firm, book, device, lines, queue) (service role): tally-ingest's one call for recorder
--       lines; under the book's source lock (the owner's choice takes it too) a chosen location's line goes to
--       tally_recorder_send, any other is kept held; a line without data_id from a computer that is not a chosen location's
--       (once the book has one) is held: "Restart Tally so the 2.4.1 add-on loads".
--       The coordinator's follow-ups: the drain sorts a queued burst out again under the same lock (tally_recorder_settle,
--       47's text with the step added, create or replace here); choosing a pending location applies its held lines above
--       its starting point once that is recorded afresh, the older ones held for the Day Book.
--   SR-M2 at most 20 locations a book; the marks computed once a call.  SR-L1 control characters and bidi marks stripped
--       from the path, the Windows user and the computer (tally_source_clean), lengths in characters.
-- Every function: security definer, search_path = public, pg_temp; the service role's revoked from public, anon and
-- authenticated; the members' granted to authenticated only (the checks inside); tally_company_source_release to nobody.

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

-- review SR-L1 of next-241: control characters (C0, C1) and the bidi marks and overrides stripped, then trimmed and cut to
-- n characters (the bridge's dataClean and cutRunes count the same way)
create or replace function public.tally_source_clean(p text, n integer) returns text language sql immutable set search_path = public, pg_temp as $function$
  select left(btrim(regexp_replace(coalesce(p, ''), '[\x01-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g')), greatest(n, 0))
$function$;

-- ① .. ⑳ (by first seen), else "(21)"
create or replace function public.tally_source_mark(p_n bigint) returns text language sql immutable set search_path = public, pg_temp as $function$
  select case when p_n between 1 and 20 then chr(9311 + p_n::int) else '(' || coalesce(p_n::text, '?') || ')' end
$function$;

-- each source of a book with its mark: (data_id, n)
create or replace function public.tally_source_marks(p_book uuid) returns table (data_id text, n bigint, choice text, computer text)
language sql stable security definer set search_path = public, pg_temp as $function$
  select s.data_id, row_number() over (order by s.first_seen, s.id), s.choice, s.computer from tally_company_sources s where s.book_id = p_book
$function$;

-- the marks of a book's chosen locations, "①" or "① and ②" (none: "none of them yet")
create or replace function public.tally_source_chosen_marks(p_book uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(nullif(regexp_replace(string_agg(tally_source_mark(m.n), ', ' order by m.n), ', ([^,]*)$', ' and \1'), ''), 'none of them yet')
    from tally_source_marks(p_book) m where m.choice = 'chosen'
$function$;

-- review H5 of next-241: the lines of a location kept held while FinCom had not decided (pending), with the line as tally-ingest
-- cleaned it (body), applied now that the location is read: each as a new line (its line id + ':same', so the repeat check of
-- 63 never takes it for the held row), the held row marked 'duplicate' with words saying so. Granted to nobody (the
-- functions below call it)
-- The coordinator's follow-up (09-Oct-2026): p_above, a starting point (AlterID): only the lines above it are applied (the
-- owner chose a pending location: its starting point recorded afresh); the older ones stay held for the Day Book, no longer
-- pending (never applied by this again). null: every pending line of the location (the same data, M2's promotion)
create or replace function public.tally_company_source_release(p_book uuid, p_data_id text, p_above bigint)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; n integer := 0; alt text; mk text;
begin
  for r in select * from tally_recorder_lines l where l.book_id = p_book and l.event = 'other_source' and l.state = 'held' and l.body is not null
             and l.payload->>'dataId' = p_data_id and l.payload->>'pending' = 'true' order by l.id loop
    alt := coalesce(r.body->>'alter_id', '');
    if p_above is not null and not (alt ~ '^[0-9]{1,15}$' and alt::bigint > p_above) then
      select tally_source_mark(m.n) into mk from tally_source_marks(p_book) m where m.data_id = p_data_id;
      update tally_recorder_lines set payload = payload || jsonb_build_object('pending', false),
             held_why = format('saved in %s before its starting point (AlterID %s) was recorded: upload %s''s Day Book for the year to bring it in', coalesce(mk, p_data_id), p_above, coalesce(mk, p_data_id))
       where id = r.id;
      continue;
    end if;
    -- as an owner's release runs a held line (tally_recorder_release_held): the row named, so the ingest's own checks let it in
    perform set_config('fincom.recorder_release', r.id::text, true);
    one := tally_recorder_line(p_book, r.device_id, r.body || jsonb_build_object('line_id', left(r.line_id, 72) || ':same'), null);
    perform set_config('fincom.recorder_release', '', true);
    update tally_recorder_lines set state = 'duplicate',
           held_why = format(case when p_above is null then 'applied as the same data (row %s, %s)' else 'applied once this location was chosen (row %s, %s)' end, coalesce(one->>'id', '?'), coalesce(one->>'state', '?'))
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $function$;

create or replace function public.tally_company_sources_note(p_firm uuid, p_book uuid, p_device uuid, p_sources jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; x jsonb; did text; pth text; usr text; pc text; cg text; own boolean; la timestamptz; r tally_company_sources%rowtype;
  had_chosen boolean; cnt integer; cur tally_sync_cursor%rowtype; out_s jsonb := '[]'::jsonb; ign jsonb := '[]'::jsonb; refused jsonb := '[]'::jsonb; ch jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = p_firm;
  if b.book_id is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  if jsonb_typeof(p_sources) is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'sources must be a list'); end if;
  if jsonb_array_length(p_sources) > 50 then return jsonb_build_object('ok', false, 'error', 'at most 50 sources a call'); end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  select * into cur from tally_sync_cursor where book_id = p_book;
  for x in select * from jsonb_array_elements(p_sources) loop
    did := lower(btrim(coalesce(x->>'data_id', '')));
    if did !~ '^[0-9a-f]{16}$' then continue; end if;
    pth := tally_source_clean(x->>'path', 260); usr := tally_source_clean(x->>'w', 200); pc := tally_source_clean(x->>'computer', 60);
    cg := nullif(left(btrim(coalesce(x->>'company_guid', '')), 100), ''); own := coalesce(x->>'own', '') = 'true';
    -- review H3 of next-241: only the book's own company (the GUID its sync record holds); another GUID is another company,
    -- never noted (and never chosen by itself)
    if cur.company_guid is not null and (cg is null or lower(cg) <> lower(cur.company_guid)) then
      ign := ign || jsonb_build_array(jsonb_build_object('data_id', did, 'company_guid', cg, 'otherCompany', true));
      continue;
    end if;
    la := case when coalesce(x->>'line_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'line_at')::timestamptz, now()) end;
    select * into r from tally_company_sources where book_id = p_book and data_id = did;
    had_chosen := exists (select 1 from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen');
    if r.id is null then
      select count(*) into cnt from tally_company_sources s where s.book_id = p_book;
      -- review SR-M2: at most 20 locations a book
      if cnt >= 20 then refused := refused || jsonb_build_array(did); continue; end if;
      -- review M2 of next-241: chosen by itself only as the location of the computer the book's starting point came from
      -- (tally_sync_cursor.start_device), the bridge saying it is its own, and none chosen yet; else pending
      insert into tally_company_sources (firm_id, book_id, company_guid, data_id, path, device_id, win_user, computer, last_line_at, choice, chosen_at)
      values (p_firm, p_book, cg, did, pth, p_device, usr, pc, la,
              case when own and not had_chosen and cur.start_device is not null and cur.start_device = p_device then 'chosen' else 'pending' end,
              case when own and not had_chosen and cur.start_device is not null and cur.start_device = p_device then now() end)
      on conflict (book_id, data_id) do nothing
      returning * into r;
      -- ONE alert, once per problem: only with a new pending row, and only when it is a problem (another location besides
      -- it, or a starting point from another computer); the existing kind 'summary' marked data.reason 'source'
      if r.id is not null and r.choice = 'pending' and (cnt >= 1 or cur.start_device is not null) then
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
       where id = r.id
      returning * into r;
      -- M2: a pending location of the starting point's computer, none chosen: chosen by itself now (its starting point was
      -- recorded after it was first seen), and the lines held meanwhile applied
      if r.choice = 'pending' and own and not had_chosen and cur.start_device is not null and cur.start_device = p_device then
        update tally_company_sources set choice = 'chosen', chosen_at = now() where id = r.id;
        perform tally_company_source_release(p_book, did, null);
      end if;
      -- the coordinator's follow-up: the owner chose this location while it was pending; once its starting point is recorded
      -- afresh (after the choice), its held lines above that starting point are applied, the older ones held for the Day Book
      if r.choice = 'chosen' and own and r.chosen_by is not null and cur.start_at is not null and r.chosen_at is not null and cur.start_at >= r.chosen_at
         and cur.start_device is not distinct from p_device and cur.last_voucher_alterid is not null then
        perform tally_company_source_release(p_book, did, cur.last_voucher_alterid);
      end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(m.data_id order by m.n), '[]'::jsonb) into ch from tally_source_marks(p_book) m where m.choice = 'chosen';
  select coalesce(jsonb_agg(jsonb_build_object('data_id', m.data_id, 'choice', m.choice, 'n', tally_source_mark(m.n)) order by m.n), '[]'::jsonb) into out_s from tally_source_marks(p_book) m;
  return jsonb_build_object('ok', true, 'chosenIds', ch, 'chosenId', ch->>0, 'sources', out_s, 'ignored', ign, 'refused', refused);
end $function$;

-- lines of a location FinCom does not read (or has not decided on) kept held as 'other_source'. A pending location's line
-- carries the line as tally-ingest cleaned it (keep): kept as the row's body (never applied from here; released when the
-- location is found to be the same data). A line with no data_id (an add-on before 2.4.1 on a computer FinCom does not
-- read the company from) says so. The marks computed once a call (review SR-M2)
create or replace function public.tally_company_source_lines(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; x jsonb; lid text; did text; pc text; rid bigint; rst text; ch_n text; my_n text; why text; res jsonb := '[]'::jsonb; ra timestamptz;
  marks jsonb; pend boolean; keep jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = p_firm;
  if b.book_id is null then return jsonb_build_object('ok', false, 'error', 'no such book'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then return jsonb_build_object('ok', false, 'error', 'lines must be a list of at most 500'); end if;
  ch_n := tally_source_chosen_marks(p_book);
  select coalesce(jsonb_object_agg(m.data_id, jsonb_build_object('n', tally_source_mark(m.n), 'choice', m.choice)), '{}'::jsonb) into marks from tally_source_marks(p_book) m;
  for x in select * from jsonb_array_elements(p_lines) loop
    lid := nullif(left(btrim(coalesce(x->>'line_id', '')), 80), ''); did := lower(btrim(coalesce(x->>'data_id', '')));
    if lid is null or (did <> '' and did !~ '^[0-9a-f]{16}$') then
      res := res || jsonb_build_array(jsonb_build_object('line_id', coalesce(lid, ''), 'state', 'failed', 'why', 'a line of another data location needs its line id and a data id of 16 hex characters'));
      continue;
    end if;
    select r.id, r.state into rid, rst from tally_recorder_lines r where r.book_id = p_book and r.line_id = lid and r.device_id is not distinct from p_device order by r.id desc limit 1;
    if rid is not null then
      res := res || jsonb_build_array(jsonb_build_object('line_id', lid, 'state', 'duplicate', 'already', true, 'was', rst, 'why', 'already have this line'));
      continue;
    end if;
    pc := tally_source_clean(x->>'pc', 60);
    my_n := marks->did->>'n';
    pend := did <> '' and marks->did->>'choice' = 'pending' and jsonb_typeof(x->'keep') = 'object';
    keep := case when pend then x->'keep' end;
    why := case when did = '' then format('saved in Tally on %s by an add-on that does not say its data location; FinCom reads %s of %s. Restart Tally so the 2.4.1 add-on loads.',
                                         coalesce(nullif(pc, ''), 'another computer'), ch_n, b.company)
                else format('saved in another data location of %s (%s, %s); FinCom reads %s. Choose on the Tally page.', b.company, coalesce(my_n, did), coalesce(nullif(pc, ''), 'another computer'), ch_n) end;
    ra := case when coalesce(x->>'received_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'received_at')::timestamptz, now()) end;
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, vch_type, vch_no, vch_date, saved_at, state, held_why, payload, body)
    values (p_firm, b.client_id, p_book, p_device, left(coalesce(x->>'bridge', ''), 80), pc, left(coalesce(x->>'user', ''), 60), nullif(left(coalesce(x->>'company_guid', ''), 100), ''),
            left(coalesce(x->>'company', b.company), 200), lid, 'other_source', nullif(left(coalesce(x->>'vch_type', ''), 60), ''), nullif(left(coalesce(x->>'vch_no', ''), 60), ''),
            case when coalesce(x->>'vch_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'vch_date')::date end,
            case when coalesce(x->>'saved_at', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((x->>'saved_at')::timestamptz, now()) end,
            'held', why,
            jsonb_build_object('otherSource', true, 'of', left(coalesce(x->>'of', ''), 20), 'dataId', did, 'dataPath', tally_source_clean(x->>'data_path', 260), 'w', tally_source_clean(x->>'w', 200),
                               'pc', pc, 'received_at', ra, 'heldWhy', why, 'pending', pend),
            keep)
    returning id into rid;
    res := res || jsonb_build_array(jsonb_build_object('id', rid, 'line_id', lid, 'state', 'held', 'why', why));
  end loop;
  return jsonb_build_object('ok', true, 'results', res);
end $function$;

-- review L4 and H2 of next-241: the lines sorted out under the book's source lock (the caller takes it; the owner's choice takes
-- it too): a line of a chosen location kept; a pending location's line held with its body (keep); any other location's, an
-- 'other_source' line, and a line without data_id from a computer that is not a chosen location's (once the book has one)
-- held. Answers {kept, idx (the kept lines' indexes), hold (the lines for tally_company_source_lines), hidx}. Granted to nobody
create or replace function public.tally_source_sort(p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; i integer := 0; did text; ev text; ch text; kept jsonb := '[]'::jsonb; idx jsonb := '[]'::jsonb; hold jsonb := '[]'::jsonb; hidx jsonb := '[]'::jsonb;
  any_chosen boolean; dev_chosen boolean; hl jsonb;
begin
  any_chosen := exists (select 1 from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen');
  dev_chosen := exists (select 1 from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen' and s.device_id = p_device);
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) loop
    ev := coalesce(x->>'event', ''); did := lower(btrim(coalesce(x->>'data_id', '')));
    select s.choice into ch from tally_company_sources s where s.book_id = p_book and s.data_id = did;
    if ev <> 'other_source' and ((did <> '' and ch = 'chosen') or (did = '' and (not any_chosen or dev_chosen))) then
      kept := kept || jsonb_build_array(x); idx := idx || to_jsonb(i);
    else
      hl := jsonb_build_object('line_id', x->>'line_id', 'of', case when ev = 'other_source' then x->>'of' else ev end, 'company_guid', x->>'company_guid', 'company', x->>'company',
              'vch_type', x->>'vch_type', 'vch_no', x->>'vch_no', 'vch_date', x->>'vch_date', 'saved_at', x->>'saved_at', 'received_at', coalesce(x->>'received_at', x->'payload'->>'received_at'),
              'pc', x->>'pc', 'user', x->>'user', 'w', x->>'w', 'data_id', did, 'data_path', x->>'data_path', 'bridge', x->>'bridge');
      if ev <> 'other_source' and did <> '' and ch = 'pending' then hl := hl || jsonb_build_object('keep', x); end if;
      hold := hold || jsonb_build_array(hl); hidx := hidx || to_jsonb(i);
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object('kept', kept, 'idx', idx, 'hold', hold, 'hidx', hidx);
end $function$;

-- tally-ingest's one call for a request's recorder lines: sorted out under the book's source lock (tally_source_sort), the
-- kept ones to tally_recorder_send, the others held. Answers {ok, sent (tally_recorder_send's answer, or null), sentIdx,
-- held: [{i, result}]}
create or replace function public.tally_recorder_send_sourced(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb, p_queue boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare so jsonb; sent jsonb; hl jsonb; hr jsonb := '[]'::jsonb; k integer;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then return jsonb_build_object('ok', false, 'error', 'lines must be a list of at most 500'); end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  so := tally_source_sort(p_book, p_device, p_lines);
  if jsonb_array_length(so->'kept') > 0 then sent := tally_recorder_send(p_firm, p_book, p_device, so->'kept', p_queue); end if;
  if jsonb_array_length(so->'hold') > 0 then
    hl := tally_company_source_lines(p_firm, p_book, p_device, so->'hold');
    for k in 0 .. jsonb_array_length(so->'hold') - 1 loop
      hr := hr || jsonb_build_array(jsonb_build_object('i', (so->'hidx'->>k)::integer, 'result', coalesce(hl->'results'->k, jsonb_build_object('state', 'failed', 'why', coalesce(hl->>'error', 'not kept')))));
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'sent', sent, 'sentIdx', so->'idx', 'held', hr);
end $function$;

-- The coordinator's follow-up (09-Oct-2026), the rest of review L4: a burst queued for the drain (more than 50 full lines) is
-- sorted out again where the drain applies it, under the same source lock: a line of a location no longer chosen, or one
-- without data_id from a computer that is not a chosen location's, is held exactly as tally_recorder_send_sourced holds it.
-- Migration 47's tally_recorder_settle with that one step added (the archive, the pending row and the book's next message
-- as 47 does them); granted to nobody, as in 47
create or replace function public.tally_recorder_settle(p_msg bigint, p_message jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r jsonb; b uuid := tally_try_uuid(p_message->>'book'); f uuid := tally_try_uuid(p_message->>'firm'); dev uuid := tally_try_uuid(p_message->>'device'); so jsonb;     -- 71
begin
  perform pg_advisory_xact_lock(hashtext('sources' || b::text));     -- 71
  so := tally_source_sort(b, dev, p_message->'lines');     -- 71
  r := case when jsonb_array_length(so->'kept') > 0 then tally_recorder_apply(f, b, dev, so->'kept') else jsonb_build_object('ok', true, 'results', '[]'::jsonb) end;     -- 71
  if jsonb_array_length(so->'hold') > 0 then perform tally_company_source_lines(f, b, dev, so->'hold'); end if;     -- 71
  perform pgmq.archive('tally_recorder', p_msg);
  update tally_recorder_pending set state = 'done', done_at = now(), why = null where msg_id = p_msg;
  perform pgmq.set_vt('tally_recorder', o.msg_id, 0) from (select x.msg_id from tally_recorder_pending x where x.book_id = b and x.state = 'pending' order by x.msg_id limit 1) o;
  return r;
end $function$;

create or replace function public.tally_company_source_choose(p_book uuid, p_data_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); did text := lower(btrim(coalesce(p_data_id, ''))); b tally_books%rowtype; n text; c tally_sync_cursor%rowtype; was text; others integer;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose which data location FinCom reads' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = f;
  if b.book_id is null then raise exception 'not a company of your firm'; end if;
  if did !~ '^[0-9a-f]{16}$' or not exists (select 1 from tally_company_sources where book_id = p_book and data_id = did) then
    raise exception 'not a data location of this company';
  end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  select choice into was from tally_company_sources where book_id = p_book and data_id = did;
  select count(*) into others from tally_company_sources where book_id = p_book and data_id <> did and choice = 'chosen';
  update tally_company_sources set choice = 'chosen', chosen_by = auth.uid(), chosen_at = now() where book_id = p_book and data_id = did;
  select tally_source_mark(m.n) into n from tally_source_marks(p_book) m where m.data_id = did;
  -- review M3 of next-241: the location FinCom reads already (and alone): who and when stamped, nothing else
  if was = 'chosen' and others = 0 then
    return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', false, 'already', true);
  end if;
  update tally_company_sources set choice = 'other' where book_id = p_book and data_id <> did and choice <> 'other';
  if was = 'chosen' then     -- it was read already, with another one as the same data: the starting point stays
    return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', false);
  end if;
  -- the starting point cleared as tally_baseline_clear (37) clears it: the next heartbeat of the chosen location records it
  -- afresh (tally_start_point, 46)
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  update tally_sync_cursor set state = 'ok', cleared_at = now(), cleared_by = auth.uid(),
         cleared_note = left(format('data location %s chosen on the Tally page: FinCom reads only it; its starting point is recorded afresh', coalesce(n, did)), 500), updated_at = now()
   where book_id = p_book returning * into c;
  return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', c.book_id is not null);
end $function$;

-- review H5 of next-241: "These are the same data (both computers read it)": one data folder under two paths (D:\TallyData on
-- the server, \\SERVER\TallyData or Z:\ on a client). Every location of the book chosen (who and when), the lines held from a
-- pending one applied; the starting point stays (an owner only)
create or replace function public.tally_company_source_same(p_book uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b tally_books%rowtype; s record; n integer := 0;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose which data location FinCom reads' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = f;
  if b.book_id is null then raise exception 'not a company of your firm'; end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  update tally_company_sources set choice = 'chosen', chosen_by = auth.uid(), chosen_at = now() where book_id = p_book;
  for s in select data_id from tally_company_sources where book_id = p_book loop
    n := n + tally_company_source_release(p_book, s.data_id, null);
  end loop;
  return jsonb_build_object('ok', true, 'same', true, 'released', n, 'at', now(), 'by', auth.uid());
end $function$;

create or replace function public.tally_company_sources_of(p_book uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(jsonb_agg(jsonb_build_object('data_id', s.data_id, 'n', tally_source_mark(m.n), 'choice', s.choice, 'path', s.path, 'computer', s.computer, 'user', s.win_user,
           'firstSeen', s.first_seen, 'lastSeen', s.last_seen, 'lastLine', s.last_line_at, 'chosenAt', s.chosen_at,
           'chosenBy', (select coalesce(nullif(mm.name, ''), 'an owner') from members mm where mm.user_id = s.chosen_by and mm.firm_id = s.firm_id limit 1)) order by m.n), '[]'::jsonb)
    from tally_company_sources s join tally_source_marks(p_book) m on m.data_id = s.data_id
   where s.book_id = p_book and s.firm_id = my_firm()
$function$;

revoke all on function public.tally_source_clean(text, integer) from public, anon, authenticated;
revoke all on function public.tally_source_mark(bigint) from public, anon, authenticated;
revoke all on function public.tally_source_marks(uuid) from public, anon, authenticated;
revoke all on function public.tally_source_chosen_marks(uuid) from public, anon, authenticated;
revoke all on function public.tally_company_source_release(uuid, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_company_source_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_recorder_send_sourced(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.tally_source_sort(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_settle(bigint, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.tally_company_source_choose(uuid, text) from public, anon;
revoke all on function public.tally_company_source_same(uuid) from public, anon;
revoke all on function public.tally_company_sources_of(uuid) from public, anon;
grant execute on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb), public.tally_company_source_lines(uuid, uuid, uuid, jsonb),
  public.tally_recorder_send_sourced(uuid, uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.tally_company_source_choose(uuid, text), public.tally_company_source_same(uuid), public.tally_company_sources_of(uuid) to authenticated;

commit;
