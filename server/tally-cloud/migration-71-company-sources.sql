-- Migration 71 (09-Oct-2026, FinCom Bridge 2.4.1: one company, two data locations; the owner's approval of 09-Oct-2026,
-- item 3). Runs after 47 (tally_alerts) and 37 (tally_sync_cursor's cleared_*), and AFTER 63 and 67 (2.4.0: it replaces
-- their combined tally_recorder_line). ADD-ONLY: two new tables with their index, row security and grants, new functions,
-- and four replaced (create or replace, the earlier text kept with lines marked "71": tally_recorder_settle and
-- tally_recorder_gap_check of 47, tally_start_point of 46, tally_recorder_line of 63 / 67). Nothing on an existing table is
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
--   The re-review (0f436f6c..d5582c55): N3 tally_recorder_line (the combined text of 63 / 67 with lines marked "71"; so 71
--       runs AFTER 63 and 67, and 63 / 67 / 47 run again after it need 71 run again) checks the location wherever a line
--       is applied (Apply now, a month unlocked, a ledger arriving, a Day Book day), under the book's lock, which the
--       owner's choice takes too. N1 tally_company_source_devices: the computers of a location (a set); a line without a
--       data id kept WITH its entry, never applied from it: once its computer proves a chosen location (or on "same data") it
--       is listed for that computer's bridge to check against its own Tally (tally_company_source_verify_list; the
--       coordinator's item 2) and applied only as the bridge's "<line id>:verified" line; its words
--       "Update FinCom Bridge on <computer>" (a bridge before 2.4.1) or "Restart Tally" (2.4.1, an older add-on). N2 the
--       owner's Use on a book's only location applies its held lines at once (nothing to mix). Low: "same data" only
--       while a location is pending, and only those (never one set 'other'); Use of the location read already sets the
--       pending others 'other'.
--   The security re-check (557834df): SR2-M1 once a book has a chosen location, only a computer of a chosen location
--       (tally_company_source_devices) records the starting point or has its gap checked (tally_source_may_start, in
--       46's tally_start_point and 47's tally_recorder_gap_check). SR2-M2 the owner's "same data" and Use of a lone location
--       act only on the locations the card showed (p_pending / p_seen): "Something changed since this page loaded; look
--       again" otherwise, nothing done.
--   SR-M2 at most 20 locations a book; the marks computed once a call.  SR-L1 control characters and bidi marks stripped
--       from the path, the Windows user and the computer (tally_source_clean), lengths in characters.
-- Every function: security definer, search_path = public, pg_temp; the service role's revoked from public, anon and
-- authenticated; the members' granted to authenticated only (the checks inside); tally_company_source_release to nobody.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- the re-review's N3: 71 carries the combined tally_recorder_line of 63 and 67 (2.4.0); over another text it stops (nothing
-- changed), so no line of 63 / 67 / 69 is ever dropped silently
do $guard$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_recorder_line'
                  and p.prosrc like '%-- 63%' and p.prosrc like '%-- 67%' and p.prosrc not like '%-- 69%') then
    raise exception 'migration 71 needs 63 and 67 (FinCom 2.4.0) run first: tally_recorder_line here is not their combined text (nothing changed)';
  end if;
end $guard$;

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

-- the re-review of next-241, N1: the computers of a data location (a set: the one device_id column of tally_company_sources,
-- written by every note, took turns between two computers reading one data folder). A computer is one of a location's when
-- its bridge proved the location its own (own = true in tally_company_sources_note). The firm reads its own rows; nobody
-- writes them directly
create table if not exists public.tally_company_source_devices (
  book_id     uuid not null references public.tally_books(book_id) on delete restrict,
  data_id     text not null check (data_id ~ '^[0-9a-f]{16}$'),
  device_id   uuid not null,
  firm_id     uuid not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (book_id, data_id, device_id)
);
alter table public.tally_company_source_devices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_company_source_devices' and policyname = 'tally_company_source_devices_read') then
    create policy tally_company_source_devices_read on public.tally_company_source_devices for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke all on public.tally_company_source_devices from public, anon, authenticated;
grant select on public.tally_company_source_devices to authenticated;

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

-- the re-review of next-241 (N1, N3): whether FinCom reads a line of this data id ('' : the line names none) from this computer:
-- the data id a chosen one; without a data id, no location of the book chosen yet (as in 2.4.0), or the computer one of a
-- chosen location's computers (tally_company_source_devices)
create or replace function public.tally_source_reads(p_book uuid, p_device uuid, p_data_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select (coalesce(p_data_id, '') = '' and not exists (select 1 from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen'))
      or (coalesce(p_data_id, '') <> '' and exists (select 1 from tally_company_sources s where s.book_id = p_book and s.data_id = p_data_id and s.choice = 'chosen'))
      or (coalesce(p_data_id, '') = '' and exists (select 1 from tally_company_source_devices d join tally_company_sources s on s.book_id = d.book_id and s.data_id = d.data_id
                                                    where d.book_id = p_book and d.device_id = p_device and s.choice = 'chosen'))
$function$;

-- the words of a line held as not read (tally_company_source_lines' words, for tally_recorder_line too). Without a data id
-- (the re-review's N1): a bridge before 2.4.1 "Update FinCom Bridge on <computer>"; a 2.4.1 bridge (an add-on before 2.4.1
-- still loaded) "Restart Tally"
create or replace function public.tally_source_words(p_book uuid, p_device uuid, p_data_id text, p_pc text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare co text; pc text; ver text; v int[]; my_n text;
begin
  select company into co from tally_books where book_id = p_book;
  select d.version, tally_source_clean(d.name, 60) into ver, pc from tally_devices d where d.id = p_device;
  pc := coalesce(nullif(tally_source_clean(p_pc, 60), ''), nullif(pc, ''), 'another computer');
  if coalesce(p_data_id, '') = '' then
    v := case when coalesce(ver, '') ~ '^\s*v?[0-9]{1,4}(\.[0-9]{1,4}){0,3}' then string_to_array(substring(ver from '[0-9]{1,4}(?:\.[0-9]{1,4}){0,3}'), '.')::int[] end;
    if v is null or v < array[2, 4, 1] then
      return format('saved in Tally on %s by FinCom Bridge %s, which does not say its data location; FinCom reads %s of %s. Update FinCom Bridge on %s to 2.4.1.',
                    pc, coalesce(nullif(btrim(ver), ''), 'before 2.4.1'), tally_source_chosen_marks(p_book), co, pc);
    end if;
    return format('saved in Tally on %s by an add-on that does not say its data location; FinCom reads %s of %s. Restart Tally so the 2.4.1 add-on loads.', pc, tally_source_chosen_marks(p_book), co);
  end if;
  select tally_source_mark(m.n) into my_n from tally_source_marks(p_book) m where m.data_id = p_data_id;
  return format('saved in another data location of %s (%s, %s); FinCom reads %s. Choose on the Tally page.', co, coalesce(my_n, p_data_id), pc, tally_source_chosen_marks(p_book));
end $function$;

-- review H5 of next-241: the lines of a location kept held while FinCom had not decided (pending), with the line as tally-ingest
-- cleaned it (body), applied now that the location is read: each as a new line (its line id + ':same', so the repeat check of
-- 63 never takes it for the held row), the held row marked 'duplicate' with words saying so. Granted to nobody (the
-- functions below call it)
-- The coordinator's follow-up (09-Oct-2026): p_above, a starting point (AlterID): only the lines above it are applied (the
-- owner chose a pending location: its starting point recorded afresh); the older ones stay held for the Day Book, no longer
-- pending (never applied by this again). null: every pending line of the location (the same data, M2's promotion)
-- The re-review's N1: p_data_id '' are the lines without a data id (of p_device; null: of every computer)
create or replace function public.tally_company_source_release(p_book uuid, p_data_id text, p_above bigint, p_device uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; n integer := 0; alt text; mk text;
begin
  for r in select * from tally_recorder_lines l where l.book_id = p_book and l.event = 'other_source' and l.state = 'held' and l.body is not null
             and l.payload->>'dataId' = p_data_id and l.payload->>'pending' = 'true' and (p_device is null or l.device_id = p_device) order by l.id loop
    -- the coordinator's item 2 (09-Oct-2026): a line without a data id is never applied from its kept entry: its computer's
    -- bridge, once it proves a chosen location, re-reads it from its own Tally (tally_company_source_verify_list) and sends
    -- "<line id>:verified" (tally_recorder_send_sourced); here it is only marked to be verified
    if p_data_id = '' then
      update tally_recorder_lines set payload = payload || jsonb_build_object('verify', true) where id = r.id and coalesce(payload->>'verify', '') <> 'true';
      continue;
    end if;
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
    perform set_config('fincom.source_release', 'on', true);     -- the decision itself: tally_recorder_line does not hold it again
    one := tally_recorder_line(p_book, r.device_id, r.body || jsonb_build_object('line_id', left(r.line_id, 72) || ':same'), null);
    perform set_config('fincom.source_release', '', true);
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
  perform pg_advisory_xact_lock(hashtext(p_book::text));     -- the re-review's N3: where lines are applied the choice is read under it
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
        perform tally_company_source_release(p_book, did, null, null);
      end if;
      -- the coordinator's follow-up: the owner chose this location while it was pending; once its starting point is recorded
      -- afresh (after the choice), its held lines above that starting point are applied, the older ones held for the Day Book
      if r.choice = 'chosen' and own and r.chosen_by is not null and cur.start_at is not null and r.chosen_at is not null and cur.start_at >= r.chosen_at
         and cur.start_device is not distinct from p_device and cur.last_voucher_alterid is not null then
        perform tally_company_source_release(p_book, did, cur.last_voucher_alterid, null);
      end if;
    end if;
    -- the re-review's N1: a computer whose bridge proves the location its own is one of its computers (a set); proving a chosen
    -- one applies its lines held without a data id (an older bridge or add-on on it before)
    if r.id is not null and own and p_device is not null then
      insert into tally_company_source_devices (book_id, data_id, device_id, firm_id) values (p_book, did, p_device, p_firm)
      on conflict (book_id, data_id, device_id) do update set last_seen = now();
      if exists (select 1 from tally_company_sources s where s.id = r.id and s.choice = 'chosen') then
        perform tally_company_source_release(p_book, '', null, p_device);
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
    pend := jsonb_typeof(x->'keep') = 'object' and (did = '' or marks->did->>'choice' = 'pending');     -- the re-review's N1: without a data id too
    keep := case when pend then x->'keep' end;
    why := case when did = '' then tally_source_words(p_book, p_device, '', pc)
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

-- The re-review of next-241, N3: tally_recorder_line, the ONE combined text of 63 and 67 (release-240) with the lines marked
-- "71" added: wherever a line is applied, its data location is checked again (tally_source_reads), and a line FinCom does not
-- read is held as tally_source_sort holds it. Runs AFTER 63 / 67 (2.4.0); 63 or 67 run again after 71 would lose the check:
-- run 71 again after them. Granted to nobody, as before
create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,15}$' then (p_line->>'alter_id')::bigint end;     -- below 10^15 (review L9)
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz; l_alt bigint;
  -- 45: the FinCom id of a short line (fid, else "TDSDesk:<id>" in the narration it carries) and its posting
  lf text := coalesce(case when coalesce(p_line->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then p_line->>'fid' end,
                      substring(coalesce(p_line->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})'));
  is_short boolean; m_job uuid; m_fid text; m_guid text; m_done boolean := false; sh_changed boolean := false;
  vno text := nullif(left(btrim(coalesce(p_line->>'vch_no', '')), 60), ''); mid text := nullif(left(btrim(coalesce(p_line->>'master_id', '')), 40), '');
  -- 48: inside tally_recorder_apply (fincom.day_rebuild_once on) an entry's days are not rebuilt here but returned in 'touched'
  once boolean := coalesce(current_setting('fincom.day_rebuild_once', true), '') = 'on'; tch jsonb;
  -- 50: the add-on's placeholder GUID ("<company GUID>-00000000": written before Tally saved the entry) is no entry's GUID;
  -- the line's entry by its MasterID, or its type, number and date under its company; a held line run again: its row's time
  ph boolean := coalesce(og ~ '-0{8}$', false); lt text := nullif(left(btrim(coalesce(p_line->>'vch_type', '')), 60), ''); lno text := vno;
  lcg text := nullif(left(btrim(coalesce(p_line->>'company_guid', '')), 100), ''); r_at timestamptz := now(); dt text; d_hit text; d_alt bigint; d_day date;
  nfit int; pref text; dg text; del_alt bigint; del_ev text; hd record; res2 jsonb; d_at timestamptz; d_n int; d_live int; twin bigint;
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
  -- 51: FinCom Bridge 2.2.2's idsMismatch / lineGuid / heldWhy (the line's own fields; a held line run again: its stored payload's)
  rp jsonb; r_why text; mm boolean := false; hb boolean := false; hw text; lg text; mdv bigint;
  -- 52: the entry the line names (type, number, date) against the copy's entry at its GUID (cx_*) and the entry sent with it (b_*);
  -- the entry an applied line brought (a_*)
  lw text; cx_found boolean := false; cx_t text; cx_n text; cx_d date; bv jsonb; b_t text; b_n text; b_d date; dif_c boolean := false; dif_b boolean := false;
  a_t text; a_n text; a_d date; cx_a bigint; sh boolean := false;
  -- 53: the book's starting point; the one live entry of the line's type, number and date (s_*); a FinCom id on the line or its row
  sp bigint; s_n int; s_g text; s_a bigint; s_t text; s_no text; s_d date; fc boolean;
  -- 53 (review M1): an altered line: the highest AlterID of the book's lines settled before it came
  s_m bigint;
  -- 60 (migration-50 review R3-L2): a create late after a cancel applied above it: applied, then cancelled again
  then_cancel boolean := false; res3 jsonb;
  -- 63: a repeat of a line this computer sent before (the same line id, and the same "again" marker when the bridge sends one)
  lid text := nullif(left(coalesce(p_line->>'line_id', ''), 80), ''); ag text := case when p_line ? 'again' then left(coalesce(p_line->>'again', ''), 20) end;     -- 63
  rp_id bigint; rp_st text;     -- 63
  -- 67 (next-renumber): Tally renumbered the entry (an insert or delete before it, the voucher type renumbering): its body under
  -- the same AlterID with another number than the copy's
  renum boolean := false;     -- 67
  sd text; s_hold boolean := false; s_why text;     -- 71 (the re-review of next-241, N3): the line's data location, held as not read
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  -- 63 (next-outbox): a line FinCom has already, sent again by the same computer (its answer lost, the bridge restarted): the
  -- same book, computer and line id, and the same "again" marker when the line carries one (a bridge after 2.3.1 marks its
  -- deliberate resends "items" / "ledger"; a line without the key is an older bridge's). Never stored or applied twice:
  -- answered 'duplicate' with already: true and the first arrival's state (was), so the bridge marks it sent. Not a repeat:
  -- a row ended 'failed' (sent again on purpose, e.g. after a failed queued send); and, for a bridge that does not mark (no
  -- "again" key), a ":resolved" line whose last row is 'held' (2.3.1 sends it once more on purpose: FinCom held it waiting
  -- for a ledger, or its body was incomplete). A held row run again (p_row) is never a repeat
  if rid is null and lid is not null then     -- 63
    select r.id, r.state into rp_id, rp_st from tally_recorder_lines r     -- 63
     where r.book_id = p_book and r.line_id = lid and r.device_id is not distinct from p_device and r.state <> 'failed'     -- 63
       and (ag is null or coalesce(left(r.payload->>'again', 20), '') = ag)     -- 63
     order by r.id desc limit 1;     -- 63
    if rp_id is not null and not (ag is null and lid like '%:resolved' and rp_st = 'held') then     -- 63
      return jsonb_build_object('id', rp_id, 'line_id', lid, 'state', 'duplicate', 'already', true, 'was', rp_st,     -- 63
        'why', format('already have this line (row %s, %s): the same line sent again, not stored or applied again', rp_id, rp_st));     -- 63
    end if;     -- 63
  end if;     -- 63
  -- 50: a held line run again (an owner's release, a Day Book day stored): its own type, company, MasterID and arrival time
  if rid is not null then
    select coalesce(lt, r.vch_type), coalesce(lcg, r.company_guid), r.received_at, coalesce(mid, nullif(r.master_id, '')), r.payload, r.held_why
      into lt, lcg, r_at, mid, rp, r_why from tally_recorder_lines r where r.id = rid;     -- 51: its payload and words too
  end if;
  -- 71 (the re-review of next-241, N3): wherever a line is applied (a new one, an owner's Apply now, a month unlocked, a ledger     -- 71
  -- arriving, a Day Book day stored), the location it was saved in is checked again, under the book's lock (the owner's choice     -- 71
  -- takes it too, after the source lock): a line of a location FinCom does not read, or one without data id from a computer of     -- 71
  -- no chosen location, is held as tally_source_sort holds it (tally_source_reads, tally_source_words). Not for the lines     -- 71
  -- tally_company_source_release applies (the owner's decision itself: fincom.source_release)     -- 71
  if ev = any(known) and coalesce(current_setting('fincom.source_release', true), '') <> 'on' then     -- 71
    perform pg_advisory_xact_lock(hashtext(p_book::text));     -- 71
    sd := lower(btrim(coalesce(nullif(p_line->>'data_id', ''), nullif(p_line->'payload'->>'data_id', ''), nullif(rp->>'data_id', ''), '')));     -- 71
    if not tally_source_reads(p_book, p_device, sd) then     -- 71
      s_hold := true; s_why := tally_source_words(p_book, p_device, sd, coalesce(nullif(p_line->>'pc', ''), rp->>'pc'));     -- 71
    end if;     -- 71
  end if;     -- 71
  -- 51: the bridge's plain reason for a line without the entry's body, and the add-on's GUID (words only, never looked up)
  hw := nullif(left(btrim(coalesce(p_line->>'heldWhy', p_line->'payload'->>'heldWhy', rp->>'heldWhy', '')), 300), '');
  lg := nullif(left(btrim(coalesce(p_line->>'lineGuid', p_line->'payload'->>'lineGuid', rp->>'lineGuid', '')), 100), '');
  -- 51: the line carries its entry (Tally's own, under the line's GUID)
  hb := og is not null and not ph and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og);
  -- 51: the ids did not belong together: the bridge says so (idsMismatch), or a line without a body whose GUID is not the GUID its
  -- MasterID makes (its last 8 hex digits are not the MasterID in hex; an older bridge's line, or a row 51 held again). Review M:
  -- inferred only for a GUID under the line's own company GUID: an entry from Tally sync or an XML import keeps another
  -- company's prefix and that company's MasterID, a genuine Tally GUID
  mdv := case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end;
  mm := ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and coalesce(
          'true' in (lower(coalesce(p_line->>'idsMismatch', '')), lower(coalesce(p_line->'payload'->>'idsMismatch', '')), lower(coalesce(rp->>'idsMismatch', '')))
          or (ev in ('created', 'altered', 'imported') and not hb and not ph and og ~ '-[0-9A-Fa-f]{8}$' and mdv between 1 and 4294967295
              and lcg is not null and lower(left(og, length(lcg) + 1)) = lower(lcg) || '-'
              and lower(right(og, 8)) <> lpad(to_hex(mdv), 8, '0')), false);
  -- 52: a line is never 'duplicate' of, applied as an alteration of, deleted / cancelled against, or replaced by an entry whose
  -- type, date or number (each only when both have one) differ from the line's: the add-on's pre line of an entry made by
  -- duplicating another carries the source's GUID, MasterID and AlterID, all consistent with each other
  lw := concat_ws(' ', lt, lno, 'of ' || to_char(vd, 'DD-Mon-YYYY'));
  if og is not null and not ph and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
    select true, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), ''), v.day, coalesce(v.alter_id, 0) into cx_found, cx_t, cx_n, cx_d, cx_a from tally_vouchers v where v.book_id = p_book and v.guid = og;
    cx_found := coalesce(cx_found, false);
    -- the decision on 52: a line WITH a body (Tally's entry under the line's own GUID, naming what the line names) is the
    -- alteration of that GUID, whatever date or number the copy had; only a line without one is checked against the copy.
    -- Review of 52 (M1, M2, M3): only when the copy is not newer than the line (a late old line is 'stale' as in 51; an
    -- intermediate change is replaced by the later one); a delete / cancel only when its AlterID is not above the copy's (one
    -- above carries the entry's newer number / date: applied as in 51). L1: types in any case; L2: numbers cut as stored (60)
    dif_c := cx_found and not hb
             and case when ev in ('deleted', 'cancelled') then alt is null or alt <= cx_a else alt is null or alt >= cx_a end
             and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and cx_d is not null and vd <> cx_d) or (lno is not null and cx_n is not null and lno <> cx_n));
  end if;
  if hb then
    select x into bv from jsonb_array_elements(p_line->'vouchers') x where x->>'guid' = og limit 1;
    b_t := nullif(btrim(coalesce(bv->>'type', '')), ''); b_n := nullif(left(btrim(coalesce(bv->>'no', '')), 60), ''); b_d := tally_d8(replace(coalesce(bv->>'day', ''), '-', ''));
    -- review of 52 (H): a FinCom short line's body is built from the posting, with the POSTED number, while Tally numbers the
    -- entry itself: its number is not compared (type and date are)
    sh := coalesce(lf, nullif(rp->>'fid', '')) is not null and 'true' in (lower(coalesce(p_line->>'short', '')), lower(coalesce(rp->>'short', '')));
    dif_b := (lt is not null and b_t is not null and lower(lt) <> lower(b_t)) or (vd is not null and b_d is not null and vd <> b_d) or (not sh and lno is not null and b_n is not null and lno <> b_n);
  end if;
  -- 67: an altered line WITH Tally's entry at the AlterID the copy holds, numbered otherwise than the copy: Tally renumbered it
  -- (no AlterID moves for that: tally-versions P9r, runs 37734533866 and 37754251128). Never 'duplicate': applied, the copy
  -- taking Tally's number
  renum := ev = 'altered' and hb and not mm and coalesce(cx_found, false) and alt is not null and alt = cx_a and b_n is not null and cx_n is not null and b_n <> cx_n;     -- 67
  -- 50 (review M1): the company's GUID prefix (the placeholder's, else the line's company GUID; never guessed) and, for a line
  -- without its entry's real GUID, the GUID its MasterID makes: "<company GUID>-<MasterID in 8 hex digits>"
  pref := coalesce(substring(og from '^(.+)-0{8}$'), nullif(lcg, ''));
  dg := case when (og is null or ph) and pref is not null and (case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end) between 1 and 4294967295
             then pref || '-' || lpad(to_hex(mid::bigint), 8, '0') end;
  -- a short line: FinCom's own entry, its FinCom id and no body of its own (tally-ingest marks it short when it built the body
  -- from the posting)
  is_short := lf is not null and (coalesce(p_line->>'short', '') = 'true' or jsonb_typeof(p_line->'vouchers') is distinct from 'array' or jsonb_array_length(p_line->'vouchers') = 0);
  if rid is null then
    begin sa := (p_line->>'saved_at')::timestamptz; exception when others then sa := null; end;
    pl := coalesce(p_line->'payload', p_line - 'vouchers' - 'lines'); pltxt := pl::text;
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000), 'again', pl->'again'); end if;     -- 63: the marker kept on a cut payload
    -- the body: the line's own voucher (its GUID) and that voucher's lines alone, never the rest of the add-on's XML (review L1)
    bd := jsonb_strip_nulls(jsonb_build_object(
            'vouchers', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where og is not null and x->>'guid' = og),
            'lines', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'lines') = 'array' then p_line->'lines' else '[]'::jsonb end) x where og is not null and x->>0 = og),
            'name', left(p_line->>'name', 300), 'from', left(p_line->>'from', 300), 'to', left(p_line->>'to', 300)));
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id,
                                      vch_type, vch_no, vch_date, saved_at, state, ledgers, payload, body, save_ms)
    values (b.firm_id, b.client_id, p_book, p_device, left(p_line->>'bridge', 80), left(p_line->>'pc', 60), left(p_line->>'user', 60), left(p_line->>'company_guid', 100), left(p_line->>'company', 200),
            left(p_line->>'line_id', 80), ev, og, left(p_line->>'master_id', 40), alt, left(p_line->>'vch_type', 60), left(p_line->>'vch_no', 60), vd, sa, 'received',
            case when jsonb_typeof(p_line->'ledgers') = 'array' then (select jsonb_agg(e) from (select e from jsonb_array_elements(p_line->'ledgers') e limit 50) s) end,
            pl, bd, case when coalesce(p_line->>'save_ms', '') ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then (p_line->>'save_ms')::numeric end)
    returning id into rid;
  end if;
  begin
    if not (ev = any(known)) then
      stt := 'failed'; wy := 'unknown event: ' || ev;
    elsif s_hold then     -- 71
      stt := 'held'; wy := s_why;     -- 71
    elsif mm and not hb then
      -- 51: the ids did not belong together and the line has no entry of Tally's: never looked up by its GUID, MasterID, or type,
      -- number and date (each could name another entry); held, in the bridge's words when it gave them. A row 51 held again
      -- keeps its own words
      stt := 'held'; wy := coalesce(case when r_why like 'marked duplicate on %' then r_why end, hw,
        format('the add-on''s ids did not belong together (GUID %s is another entry''s); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it', coalesce(lg, og, 'unknown')));
    elsif ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and (dif_c or dif_b) then
      -- 52: the GUID is another entry's (in the copy, or in the body sent): held, never looked up further; the bridge's words after
      stt := 'held';
      wy := format('the add-on named entry %s, but GUID %s is %s %s; held until FinCom Bridge sends this entry as Tally gives it', lw, og,
                   case when dif_c then concat_ws(' ', cx_t, cx_n, 'of ' || to_char(cx_d, 'DD-Mon-YYYY')) else concat_ws(' ', b_t, b_n, 'of ' || to_char(b_d, 'DD-Mon-YYYY')) end,
                   case when dif_c then 'in the copy' else 'in the entry sent with the line' end) || coalesce('; ' || hw, '');
    elsif ph and ev in ('deleted', 'cancelled') then
      -- 60 (migration-50 review R3-L1): a delete / cancel under the add-on's placeholder GUID names no entry: held as a GUID-less
      -- one is (before 60 it went on to tally_ingest_delete as an entry not in the copy - since 57 "nothing to remove", applied -
      -- and a second arrival, never the same change by the placeholder, broke the line's call on applied_once)
      stt := 'held'; wy := format('no entry GUID on the line (only the add-on''s placeholder): FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev,
                                  case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end);
    elsif og is null and ev <> 'ledger_renamed' then
      -- 50: what releases it, in words (a later line with the entry's GUID replaces it; a Day Book holding it makes it a duplicate)
      stt := 'held'; wy := case when ev in ('created', 'altered', 'imported') then coalesce(hw, 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')     -- 51: the bridge's words when given
                                when ev in ('deleted', 'cancelled') then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev, case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end)     -- 60 (R3-L3 i): no date, no Day Book promised
                                else 'no GUID on the line: held, never a new row' end;
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null and not ph and not mm then     -- 50: the placeholder GUID is no entry's: never the same change by it; 51: nor a line whose ids did not belong together
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.id <> rid
         and coalesce(r.payload->>'sourceHeld', '') <> 'true'     -- 71: a line held as another location's is no original
         -- a held arrival is the original only when a release can apply it (review M1): an entry line with its body, a
         -- delete / cancel held for a locked month; a held line without a body never swallows the same change sent with one
         and (r.state = 'applied' or (r.state = 'held' and case when ev in ('created', 'altered', 'imported') then coalesce(r.body ? 'vouchers', false)
                                                                when ev in ('deleted', 'cancelled') then coalesce(r.held_why, '') like 'month locked%'
                                                                else true end))
       order by r.id limit 1;
      if t is not null and not renum then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;     -- 67: not a renumbering
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
        -- 50: an entry not in the copy: what releases it, by the line's date. Review H1 and round 2 (N1): a COMPLETE Day Book of
        -- that day (tally_days.n, the count the bridge or the upload vouched for, equals the entries the copy holds live for the
        -- day: never a short, unconfirmed empty or capped read) stored AFTER this line came, not holding the entry, proves it gone
        -- from Tally: a delete or a cancel has nothing left to do. An older kept file read again later cannot bring the entry back:
        -- tally_recorder_release_day deletes (cancels) again an entry whose applied delete (cancel) is above its version
        if stt = 'held' and coalesce((res->>'unknown')::boolean, false) then
          dt := coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date');
          select d.at, d.n, (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = vd and v.deleted_at is null) into d_at, d_n, d_live
            from tally_days d where d.book_id = p_book and d.day = vd and d.at > r_at;
          if d_at is not null and d_n = d_live then
            stt := 'applied'; wy := format('nothing to %s: the Day Book for %s, complete and stored after this change arrived, does not hold the entry', case when ev = 'deleted' then 'delete' else 'cancel' end, dt);
          elsif d_at is not null then
            wy := format('the Day Book for %s stored after this change was not complete (%s of %s entries); the entry is not in FinCom''s copy, and this line is applied by itself once a complete Day Book for that day is uploaded', dt, d_live, d_n);
          else wy := format('the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for %s is uploaded', dt);
          end if;
        end if;
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        -- review H2: a short line builds the entry from FinCom's posted XML only when it is FinCom's creation: never for an
        -- 'altered' line, never for an entry the copy holds (a person changed it in Tally after the posting: the posted
        -- content is not Tally's now). Such a line is matched, held, and its AlterID is not received (the gap check shows it)
        sh_changed := is_short and (ev = 'altered' or c_found);
        if sh_changed then vs := '[]'::jsonb; end if;
        if ph then vs := '[]'::jsonb; end if;     -- 50: never an entry under the placeholder GUID
        -- 45: a short line lands on FinCom's posting (the live, accepted one of this firm for this book) or is held
        if is_short then
          select r.post_job, r.post_fid, r.post_guid into m_job, m_fid, m_guid from tally_post_live_for(b.firm_id, p_book, lf) r;
          if m_job is null then
            stt := 'held'; wy := format('FinCom id %s matches no posting of this firm', lf);
          elsif m_guid is not null and m_guid <> og then
            stt := 'held'; wy := format('FinCom id %s is matched to another Tally entry (GUID %s) already: held, never a second entry', lf, m_guid);
          else
            update tally_post_ids p set matched_at = coalesce(p.matched_at, now()),
                   matched_vch = coalesce(vno, nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), p.matched_vch),
                   matched_guid = og, matched_mid = coalesce(mid, p.matched_mid),
                   matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
             where p.job_id = m_job and p.fincom_id = m_fid;
            m_done := true;
          end if;
        end if;
        -- 50 (review H1; round 2: a cancel too, "nothing to cancel" leaves the entry out of the copy): the highest AlterID at which
        -- a delete or cancel of this GUID was applied
        select r.alter_id, r.event into del_alt, del_ev from tally_recorder_lines r where r.book_id = p_book and r.object_guid = og and r.event in ('deleted', 'cancelled') and r.state = 'applied'
         order by r.alter_id desc nulls last limit 1;
        then_cancel := alt is not null and del_alt > alt and del_ev = 'cancelled';     -- 60 (R3-L2)
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          -- 50 (review H1): a delete of this entry applied at a higher AlterID (gone from Tally, perhaps never in the copy): an older
          -- line of it, late from another computer, never revives it
          elsif alt is not null and del_alt > alt and not then_cancel then     -- 60 (R3-L2): a delete only; below a cancel, see below
            stt := 'stale'; wy := format('AlterID %s is older than the %s applied at AlterID %s: an older change, not applied', alt, case when del_ev = 'deleted' then 'delete' else 'cancel' end, del_alt);
          elsif c_found and alt is not null and alt = c_alter and c_del is null and not mm and not renum then     -- 51: a line whose ids did not belong together is applied by Tally's entry, never 'duplicate'; 67: nor a renumbered one
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (from a Day Book or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book', m_fid)
                                      else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end;     -- 50: what releases it
            -- 51: the bridge's plain reason when it gave one (the release rules stay 50's); review L4: after 50's words of a matched
            -- short line, never instead of them
            if hw is not null then wy := case when m_done then wy || '; ' || hw else hw end; end if;
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines', not once, true);     -- 56: the recorder keeps what its request does not fetch
            if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
            else
              stt := 'applied';
              if once then tch := res->'touched'; end if;
              if m_done then wy := format('FinCom posting %s matched', m_fid);
              else
                -- a FinCom posting coming back in a full line: matched by its FinCom id (43's columns, 45's GUID, MasterID, AlterID);
                -- review L4: only the firm's LIVE row of that id whose posting's company is this book's (never an old failed
                -- posting's or another company's row of the same id)
                select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
                if c_fid is not null then
                  update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(vno, p.matched_vch),
                         matched_guid = coalesce(p.matched_guid, og), matched_mid = coalesce(mid, p.matched_mid),
                         matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
                   where p.firm_id = b.firm_id and p.fincom_id = c_fid and p.live
                     and exists (select 1 from tally_post_jobs j where j.id = p.job_id and j.firm_id = b.firm_id and j.company = b.company);
                  wy := format('FinCom posting %s matched', c_fid);
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    elsif stt is null and ev = 'ledger_renamed' then
      frm := left(btrim(coalesce(p_line->>'from', '')), 300); dst := left(btrim(coalesce(p_line->>'to', '')), 300);
      if dst = '' then stt := 'failed'; wy := 'a rename without the new name';
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          -- round 21 (review M8): the ledger's AlterID seen, so an older ledger_altered never undoes this rename
          if stt = 'applied' and alt is not null and og is not null then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev = 'ledger_altered' and og is not null and left(btrim(coalesce(p_line->>'name', '')), 300) <> ''
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.name <> left(btrim(p_line->>'name'), 300)) then
      -- 47: a ledger_altered line whose GUID the copy holds (live) under another name is a rename: tally_ledger_rename, as
      -- ledger_renamed. Round 21 (review M8): only with an AlterID above the last one seen for that ledger (an older line
      -- arriving late never undoes a newer rename: 'stale'), and never a merge (a name another ledger holds is left to the
      -- next ledger list); a line without an AlterID is held for the ledger list
      select l.name, l.alter_id into frm, l_alt from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1;
      dst := left(btrim(p_line->>'name'), 300);
      if alt is null then stt := 'held'; wy := 'a ledger change without its AlterID: the next ledger list applies it';
      elsif l_alt is not null and alt <= l_alt then stt := 'stale'; wy := format('ledger AlterID %s is not above the %s seen: an older change, not applied', alt, l_alt);
      elsif exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = dst) then
        stt := 'held'; wy := format('a ledger named %s is in the copy already: a merge is left to the next ledger list', dst);
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          if stt = 'applied' then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') then
      stt := 'held'; wy := 'ledger lines applied by the next ledger list';
    elsif stt is null and ev = 'ledger_deleted' then
      select l.name, l.deleted_at into l_name, l_del from tally_ledgers l where l.book_id = p_book and l.tally_guid = og order by (l.deleted_at is null) desc limit 1;
      if l_name is null then stt := 'held'; wy := 'unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date';
      elsif l_del is not null then stt := 'applied'; wy := 'already marked deleted';
      else
        perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('deleted in Tally (recorder line %s)', rid),
          'list', jsonb_build_object('source', 'recorder', 'at', now(), 'device', p_device, 'bridge', left(p_line->>'bridge', 80), 'line', rid))::text, true);
        update tally_ledgers set deleted_at = now() where book_id = p_book and name = l_name;
        perform set_config('fincom.ledger_list', '', true);
        if exists (select 1 from tally_ledgers where book_id = p_book and name = l_name and deleted_at is null) then
          select 'kept by the guard: ' || coalesce(tally_ledger_hold_reason(l), 'unknown reason') into wy from tally_ledgers l where l.book_id = p_book and l.name = l_name;
          stt := 'held';
        else stt := 'applied'; end if;
      end if;
    end if;
    -- 50 (review M1): a line without its entry's real GUID whose entry the copy holds now: by the GUID its MasterID makes; with
    -- no MasterID, by type, number and date only when exactly ONE live entry of its company fits (the prefix known: never null =
    -- null). An 'altered' line only when the copy shows the change: an AlterID above the line's, a Day Book of that day stored
    -- after the line came, or a later line of that entry applied
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm then     -- 51: never for a line whose ids did not belong together
      if dg is not null then
        select v.guid, coalesce(v.alter_id, 0), v.day, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), '') into d_hit, d_alt, d_day, cx_t, cx_n from tally_vouchers v where v.book_id = p_book and v.guid = dg and v.deleted_at is null;
        -- 52: the entry its MasterID makes is another entry (type, date or number differ): never a duplicate of it
        if d_hit is not null and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and d_day is not null and vd <> d_day) or (lno is not null and cx_n is not null and lno <> cx_n)) then
          wy := format('the add-on named entry %s, but GUID %s is %s in the copy; held until FinCom Bridge sends this entry as Tally gives it', lw, d_hit,
                       concat_ws(' ', cx_t, cx_n, 'of ' || to_char(d_day, 'DD-Mon-YYYY'))) || coalesce('; ' || hw, '');
          d_hit := null;
        end if;
      elsif pref is not null and lt is not null and lno is not null and vd is not null then
        select count(*), min(v.guid) into nfit, d_hit from tally_vouchers v
         where v.book_id = p_book and v.day = vd and v.vtype = lt and v.vno = lno and v.deleted_at is null and v.guid like pref || '-%' and v.guid !~ '-0{8}$';
        if nfit = 1 then select coalesce(v.alter_id, 0), v.day into d_alt, d_day from tally_vouchers v where v.book_id = p_book and v.guid = d_hit;
        else d_hit := null; end if;
      end if;
      if d_hit is not null and (ev <> 'altered' or (coalesce(alt, 0) > 0 and d_alt > alt)
           or exists (select 1 from tally_days d where d.book_id = p_book and d.day = d_day and d.at > r_at and coalesce(d.alter_max, 0) > 0)
           or exists (select 1 from tally_recorder_lines a where a.book_id = p_book and a.object_guid = d_hit and a.state = 'applied' and a.received_at > r_at)) then
        stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s: from a Day Book or a later line)', lt, lno, to_char(d_day, 'DD-Mon-YYYY'), d_hit, d_alt);
      end if;
    end if;
    -- 53: a held entry line WITHOUT a body whose GUID is the placeholder or none, with a type, a number and a date (the owner's
    -- finding of 05-Oct-2026, staging's line 1: an altered line, MasterID 0, AlterID 0, which 50's rule above never takes as the
    -- change): 'duplicate' when the copy holds EXACTLY ONE live entry of the book under its company with the same type (any case,
    -- trimmed), number (trimmed, cut to 60) and date, at an AlterID above the book's starting point (tally_sync_cursor's
    -- last_voucher_alterid, recorded at start_at: the entry was saved after the bridge started recording, so the copy holds that
    -- change). No starting point recorded: never. Never an unnumbered line, a line whose ids did not belong together, a line
    -- carrying a FinCom id (its posting's own rules, 45), or a line whose MasterID makes another GUID than that entry's
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm and not hb     -- 53
       and jsonb_array_length(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) = 0     -- 53: no body
       and pref is not null and lt is not null and lno is not null and vd is not null then     -- 53
      fc := coalesce(lf, case when coalesce(rp->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then rp->>'fid' end, substring(coalesce(rp->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})')) is not null;     -- 53
      select c.last_voucher_alterid into sp from tally_sync_cursor c where c.book_id = p_book and c.start_at is not null;     -- 53
      if not fc and sp is not null then     -- 53
        select count(*), min(v.guid) into s_n, s_g from tally_vouchers v     -- 53
         where v.book_id = p_book and v.day = vd and lower(btrim(v.vtype)) = lower(lt) and left(btrim(v.vno), 60) = lno and v.deleted_at is null     -- 53
           and lower(v.guid) like lower(pref) || '-%' and v.guid !~ '-0{8}$';     -- 53
        if s_n = 1 then     -- 53
          select coalesce(v.alter_id, 0), btrim(v.vtype), left(btrim(v.vno), 60), v.day into s_a, s_t, s_no, s_d from tally_vouchers v where v.book_id = p_book and v.guid = s_g;     -- 53
          -- 53 (review M1): an 'altered' line only when the entry is ABOVE the highest AlterID of any line of the book that settled
          -- (applied / duplicate / stale) and came before this one: else the copy may hold an older version of the entry (an
          -- alteration applied with its body, then altered again with the add-on's placeholder line). None such: as for created
          if ev = 'altered' then     -- 53
            select max(z.alter_id) into s_m from tally_recorder_lines z     -- 53
             where z.book_id = p_book and z.state in ('applied', 'duplicate', 'stale') and z.received_at < r_at and z.id <> rid     -- 53
               and z.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') and z.alter_id < 1000000000000000;     -- 53
          end if;     -- 53
          if s_a > sp and (dg is null or lower(dg) = lower(s_g)) and (ev <> 'altered' or s_m is null or s_a > s_m) then     -- 53
            stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s, from a Day Book or another line)', s_t, s_no, to_char(s_d, 'DD-Mon-YYYY'), s_g, s_a);     -- 53
          end if;     -- 53
        end if;     -- 53
      end if;     -- 53
    end if;     -- 53
    if s_hold then stt := 'held'; wy := s_why; end if;     -- 71: nothing above turns it into another state
    if stt = 'applied' and ev in ('created', 'altered', 'imported') and og is not null and not ph then
      -- 52: the entry this line brought
      a_t := coalesce(nullif(btrim(coalesce(vs->0->>'type', '')), ''), lt); a_n := coalesce(nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), lno);
      a_d := coalesce(tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')), vd);
      -- 50: a line that entered its entry replaces the held lines it stands for: the same GUID at an AlterID not above its own;
      -- the placeholder / no GUID by the GUID its MasterID makes; with no MasterID, the same type, number and date under the same
      -- company GUID (known on both sides) when this entry is the ONE live entry of the company that fits (review M1)
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event in ('created', 'altered', 'imported')
         -- 51: the line that carries the held line's entry (2.2.2: its line_id + ":resolved")
         and (r.line_id || ':resolved' = p_line->>'line_id'
         -- 51: a held line whose ids did not belong together (the bridge said so, or its stored GUID is not its MasterID's) is
         -- replaced by its ":resolved" line only, never by its GUID, MasterID, or type, number and date
         or (lower(coalesce(r.payload->>'idsMismatch', '')) <> 'true'     -- review L3: in any case
             and not coalesce(r.object_guid ~ '-[0-9A-Fa-f]{8}$' and r.object_guid !~ '-0{8}$'
                              and nullif(r.company_guid, '') is not null and lower(left(r.object_guid, length(r.company_guid) + 1)) = lower(r.company_guid) || '-'     -- review M
                              and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                              and lower(right(r.object_guid, 8)) <> lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0'), false)
         -- 52: by GUID or MasterID only a held line naming this same entry (type, date, number where both have one)
         -- review of 52 (M1): except a held intermediate change of this entry (its AlterID above the copy's before this line and
         -- below this line's): the later version replaces it
         and ((not (((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n)) and not (coalesce(r.alter_id, 0) > coalesce(c_alter, 0) and coalesce(r.alter_id, 0) < coalesce(alt, 0)))
               and ((r.object_guid = og and coalesce(r.alter_id, 0) <= coalesce(alt, 0))
           or ((r.object_guid is null or r.object_guid ~ '-0{8}$')
               and case when (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                        then coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) || '-' || lpad(to_hex(r.master_id::bigint), 8, '0') = og
                        else coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) = substring(og from '^(.+)-[0-9A-Fa-f]{8}$')
                             and r.vch_type = coalesce(lt, vs->0->>'type') and r.vch_no = coalesce(lno, vs->0->>'no')
                             and r.vch_date = coalesce(vd, tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')))
                             and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = r.vch_date and v.vtype = r.vch_type and v.vno = r.vch_no
                                    and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1 end)))
           -- 52: a numbered held line whose stored GUID is another entry in the copy (another type, date or number): by its own type,
           -- number and date under the same company, when this entry is the ONE live entry of the company that fits (50's rule)
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and r.object_guid <> og and nullif(btrim(r.vch_no), '') is not null
               and lower(btrim(r.vch_type)) = lower(a_t) and left(btrim(r.vch_no), 60) = a_n and r.vch_date = a_d
               and exists (select 1 from tally_vouchers c where c.book_id = p_book and c.guid = r.object_guid
                            and ((nullif(btrim(c.vtype), '') is not null and lower(btrim(c.vtype)) <> lower(btrim(r.vch_type))) or (c.day is not null and c.day <> r.vch_date)
                                 or (nullif(btrim(c.vno), '') is not null and left(btrim(c.vno), 60) <> left(btrim(r.vch_no), 60))))
               and lower(coalesce(nullif(r.company_guid, ''), substring(r.object_guid from '^(.+)-[0-9A-Fa-f]{8}$'))) = lower(substring(og from '^(.+)-[0-9A-Fa-f]{8}$'))
               and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = a_d and lower(btrim(v.vtype)) = lower(a_t) and left(btrim(v.vno), 60) = a_n
                      and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1)
           -- 52: an unnumbered one (no number to find it by): besides its ":resolved" line, only by the GUID its MasterID makes under its
           -- company, naming this same entry
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and nullif(btrim(r.vch_no), '') is null and nullif(r.company_guid, '') is not null
               and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
               and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)
               and not ((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n))))));
      -- 50 (review H1): the entry is in the copy now: a delete or cancel of it held "not in FinCom's copy yet" at a higher AlterID
      -- (it came first, from another computer) is applied with it, so the entry is never live while Tally has it gone
      for hd in select r.id, r.event, r.alter_id, r.pc from tally_recorder_lines r
                 where r.book_id = p_book and r.state = 'held' and r.object_guid = og and r.event in ('deleted', 'cancelled')
                   and coalesce(r.payload->>'sourceHeld', '') <> 'true'     -- 71
                   and r.alter_id > coalesce(alt, 0) and coalesce(r.held_why, '') not like 'month locked%' order by r.alter_id, r.id loop
        res2 := tally_ingest_delete(p_book, og, hd.alter_id, hd.event = 'cancelled', 'recorder ' || coalesce(hd.pc, ''));
        twin := null;
        select a.id into twin from tally_recorder_lines a where a.book_id = p_book and a.object_guid = og and a.alter_id = hd.alter_id and a.event = hd.event and a.state = 'applied' order by a.id limit 1;
        if res2->>'state' = 'applied' and twin is null then
          update tally_recorder_lines set state = 'applied', held_why = format('applied when line %s brought the entry', rid), applied_at = now() where id = hd.id;
          if tally_recorder_ids_together(hd.id) then     -- 53: only a line whose ids belong together raises the AlterID received
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, b.firm_id) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), hd.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
          end if;     -- 53
        elsif res2->>'state' = 'applied' then     -- round 2 (L8): the same change from another computer, applied already
          update tally_recorder_lines set state = 'duplicate', held_why = format('the same change already came as line %s (applied)', twin), body = null where id = hd.id;
        end if;
      end loop;
    end if;
    -- 60 (migration-50 review R3-L2): a create (alter, import) late from another computer below a cancel applied for its GUID
    -- ("nothing to remove" when the cancel came first, 57): the entry is applied, then cancelled again at the cancel's AlterID, as
    -- Tally holds it (cancelled), instead of 'stale' and left out of the copy until its Day Book. 57's entry path re-applies
    -- the cancel itself when the body is stored; this call makes it sure whatever ran before (then "already cancelled")
    if stt = 'applied' and renum then     -- 67
      wy := concat_ws('; ', wy, format('renumbered in Tally: %s %s is %s %s now (the same AlterID %s)', coalesce(cx_t, lt, 'entry'), cx_n, coalesce(b_t, lt, 'entry'), b_n, alt));     -- 67
    end if;     -- 67
    if stt = 'applied' and then_cancel then
      res3 := tally_ingest_delete(p_book, og, del_alt, true, 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
      wy := concat_ws('; ', wy, format('then cancelled, as the cancel applied at AlterID %s says (%s)', del_alt, coalesce(res3->>'state', 'not done')));
    end if;
    -- 51: the line carrying the held line's entry (its line_id + ":resolved") that ends 'duplicate' (the copy holds Tally's entry
    -- already) or, review L1, 'stale' (the copy holds a newer version): the entry is in, so the held line is replaced as by an
    -- applied one
    if stt in ('duplicate', 'stale') and ev in ('created', 'altered', 'imported') and og is not null and not ph and coalesce(p_line->>'line_id', '') like '%:resolved' then
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event in ('created', 'altered', 'imported') and r.line_id || ':resolved' = p_line->>'line_id';
    end if;
    -- 51 (review L2): a held delete / cancel whose ids did not belong together (no GUID of its own) is never applied by a guess (no
    -- Day Book release: which entry it meant is not known for sure). It is replaced once the same change is applied under Tally's
    -- own GUID: its ":resolved" line, or a delete (cancel) of the GUID its MasterID makes under its company GUID; that line did
    -- the deletion (cancellation) itself
    if stt = 'applied' and ev in ('deleted', 'cancelled') and og is not null and not ph then
      update tally_recorder_lines r set state = 'replaced',
             held_why = format('replaced by line %s (the %s came with the entry''s own GUID)', rid, case when ev = 'deleted' then 'deletion' else 'cancellation' end)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event = ev
         and (r.line_id || ':resolved' = p_line->>'line_id'
              or (lower(coalesce(r.payload->>'idsMismatch', '')) = 'true' and r.object_guid is null and nullif(r.company_guid, '') is not null
                  and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                  and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)));
    end if;
  exception when others then
    stt := 'failed'; wy := left(sqlerrm, 300);
  end;
  update tally_recorder_lines set state = stt, held_why = wy,
         applied_at = case when stt = 'applied' then now() else applied_at end,
         body = case when stt = 'duplicate' then null else body end
   where id = rid and (state is distinct from stt or held_why is distinct from wy);     -- 50 (review M2): a line whose state and words stay is not rewritten
  update tally_recorder_lines set payload = case when s_hold then coalesce(payload, '{}'::jsonb) || '{"sourceHeld": true}'::jsonb else payload - 'sourceHeld' end     -- 71
   where id = rid and (s_hold or coalesce(payload ? 'sourceHeld', false));     -- 71
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy)
      || case when once and stt = 'applied' and jsonb_typeof(tch) = 'array' then jsonb_build_object('touched', tch) else '{}'::jsonb end;
end $function$;

-- review L4 and H2 of next-241: the lines sorted out under the book's source lock (the caller takes it; the owner's choice takes
-- it too): a line of a chosen location kept; a pending location's line held with its body (keep); any other location's, an
-- 'other_source' line, and a line without data_id from a computer that is not a chosen location's (once the book has one)
-- held. Answers {kept, idx (the kept lines' indexes), hold (the lines for tally_company_source_lines), hidx}. Granted to nobody
create or replace function public.tally_source_sort(p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; i integer := 0; did text; ev text; ch text; kept jsonb := '[]'::jsonb; idx jsonb := '[]'::jsonb; hold jsonb := '[]'::jsonb; hidx jsonb := '[]'::jsonb;
  hl jsonb;
begin
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) loop
    ev := coalesce(x->>'event', ''); did := lower(btrim(coalesce(x->>'data_id', '')));
    select s.choice into ch from tally_company_sources s where s.book_id = p_book and s.data_id = did;
    if ev <> 'other_source' and tally_source_reads(p_book, p_device, did) then
      kept := kept || jsonb_build_array(x); idx := idx || to_jsonb(i);
    else
      hl := jsonb_build_object('line_id', x->>'line_id', 'of', case when ev = 'other_source' then x->>'of' else ev end, 'company_guid', x->>'company_guid', 'company', x->>'company',
              'vch_type', x->>'vch_type', 'vch_no', x->>'vch_no', 'vch_date', x->>'vch_date', 'saved_at', x->>'saved_at', 'received_at', coalesce(x->>'received_at', x->'payload'->>'received_at'),
              'pc', x->>'pc', 'user', x->>'user', 'w', x->>'w', 'data_id', did, 'data_path', x->>'data_path', 'bridge', x->>'bridge');
      if ev <> 'other_source' and (did = '' or ch = 'pending') then hl := hl || jsonb_build_object('keep', x); end if;     -- N1: without a data id too
      hold := hold || jsonb_build_array(hl); hidx := hidx || to_jsonb(i);
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object('kept', kept, 'idx', idx, 'hold', hold, 'hidx', hidx);
end $function$;

-- the coordinator's item 2: the lines without a data id to verify, for one computer's bridge (the beat's verifyLines): held
-- with their entry, marked to verify, of a book where this computer proved a chosen location; at most 20, oldest first. The
-- bridge asks its own Tally for each by its MasterID (FinComVoucherObject, paced, the 2-second rule) and answers with
-- "<line id>:verified": Tally's entry when it has the same GUID, an AlterID not below the line's and (when the line has one)
-- the same narration; else verify_failed (held with the Day Book words). Service role only
create or replace function public.tally_company_source_verify_list(p_firm uuid, p_device uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('line_id', l.line_id, 'book_id', l.book_id, 'company', coalesce(l.body->>'company', l.company), 'company_guid', coalesce(l.body->>'company_guid', l.company_guid),
            'event', l.body->>'event', 'master_id', l.body->>'master_id', 'vch_type', l.body->>'vch_type', 'vch_no', l.body->>'vch_no', 'vch_date', l.body->>'vch_date',
            'guid', l.body->>'object_guid', 'alter_id', l.body->>'alter_id', 'narration', left(coalesce(l.body->>'narration', ''), 1000)) order by l.id)
    from (select x.* from tally_recorder_lines x
           where x.firm_id = p_firm and x.device_id = p_device and x.event = 'other_source' and x.state = 'held' and x.body is not null
             and x.payload->>'verify' = 'true' and x.payload->>'pending' = 'true' and coalesce(x.payload->>'dataId', '') = ''
             and exists (select 1 from tally_company_source_devices d join tally_company_sources s on s.book_id = d.book_id and s.data_id = d.data_id
                          where d.book_id = x.book_id and d.device_id = p_device and s.choice = 'chosen')
           order by x.id limit 20) l), '[]'::jsonb);
end $function$;

-- tally-ingest's one call for a request's recorder lines: sorted out under the book's source lock (tally_source_sort), the
-- kept ones to tally_recorder_send, the others held. Answers {ok, sent (tally_recorder_send's answer, or null), sentIdx,
-- held: [{i, result}]}
create or replace function public.tally_recorder_send_sourced(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb, p_queue boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare so jsonb; sent jsonb; hl jsonb; hr jsonb := '[]'::jsonb; k integer;
  x jsonb; i integer := 0; rest jsonb := '[]'::jsonb; ri jsonb := '[]'::jsonb; lid text; o tally_recorder_lines%rowtype; w text; one jsonb; ki integer;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 500 then return jsonb_build_object('ok', false, 'error', 'lines must be a list of at most 500'); end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  -- the coordinator's item 2: a bridge's answer for a line to verify ("<line id>:verified"): no match (verify_failed): the held
  -- line keeps its entry unused, held with the Day Book words; a match goes on as any line of the chosen location (below)
  for x in select * from jsonb_array_elements(p_lines) loop
    lid := coalesce(x->>'line_id', ''); o := null;
    if lid like '%:verified' then
      select * into o from tally_recorder_lines r where r.book_id = p_book and r.device_id is not distinct from p_device and r.line_id = left(lid, length(lid) - 9)
         and r.event = 'other_source' and r.state = 'held' and r.payload->>'verify' = 'true' order by r.id desc limit 1;
    end if;
    if o.id is not null and coalesce(x->>'verify_failed', '') = 'true' then
      w := format('saved on %s before its bridge proved its data location, and that Tally''s entry now is not this line''s (%s): upload that day''s Day Book to bring it in',
                  coalesce(nullif(o.pc, ''), 'this computer'), left(coalesce(nullif(x->>'heldWhy', ''), 'no match'), 200));
      update tally_recorder_lines set payload = payload || jsonb_build_object('verify', false, 'pending', false), held_why = w where id = o.id;
      hr := hr || jsonb_build_array(jsonb_build_object('i', i, 'result', jsonb_build_object('id', o.id, 'line_id', lid, 'state', 'held', 'why', w)));
    elsif lid like '%:verified' and coalesce(x->>'verify_failed', '') = 'true' then
      hr := hr || jsonb_build_array(jsonb_build_object('i', i, 'result', jsonb_build_object('line_id', lid, 'state', 'failed', 'why', 'no line of this computer waits for this check')));
    else
      rest := rest || jsonb_build_array(x); ri := ri || to_jsonb(i);
    end if;
    i := i + 1;
  end loop;
  so := tally_source_sort(p_book, p_device, rest);
  -- the indexes of the call's own lines
  so := so || jsonb_build_object('idx', coalesce((select jsonb_agg(ri->((e.v)::int)) from jsonb_array_elements_text(so->'idx') with ordinality e(v, n)), '[]'::jsonb),
                                 'hidx', coalesce((select jsonb_agg(ri->((e.v)::int)) from jsonb_array_elements_text(so->'hidx') with ordinality e(v, n)), '[]'::jsonb));
  if jsonb_array_length(so->'kept') > 0 then sent := tally_recorder_send(p_firm, p_book, p_device, so->'kept', p_queue); end if;
  -- item 2: a verified line applied (or the copy holds it already): the held line it re-read is replaced
  for ki in 0 .. jsonb_array_length(so->'kept') - 1 loop
    lid := coalesce(so->'kept'->ki->>'line_id', ''); one := sent->'results'->ki;
    if lid like '%:verified' and one is not null then
      update tally_recorder_lines set state = case when one->>'state' in ('applied', 'duplicate') then 'replaced' else state end,
             held_why = case when one->>'state' in ('applied', 'duplicate') then format('replaced by line %s (Tally''s entry re-read from this computer''s own Tally, %s)', coalesce(one->>'id', '?'), one->>'state')
                             else format('re-read from this computer''s Tally as line %s (%s)', coalesce(one->>'id', '?'), coalesce(one->>'state', '?')) end,
             payload = payload || jsonb_build_object('verify', false, 'pending', false)
       where book_id = p_book and device_id is not distinct from p_device and line_id = left(lid, length(lid) - 9) and event = 'other_source' and state = 'held' and payload->>'verify' = 'true';
    end if;
  end loop;
  if jsonb_array_length(so->'hold') > 0 then
    hl := tally_company_source_lines(p_firm, p_book, p_device, so->'hold');
    for k in 0 .. jsonb_array_length(so->'hold') - 1 loop
      hr := hr || jsonb_build_array(jsonb_build_object('i', (so->'hidx'->>k)::integer, 'result', coalesce(hl->'results'->k, jsonb_build_object('state', 'failed', 'why', coalesce(hl->>'error', 'not kept')))));
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'sent', sent, 'sentIdx', so->'idx', 'held', hr);
end $function$;

-- The security re-check of next-241 (557834df), SR2-M1: whether a computer may record a book's starting point or have its
-- gap checked: the book has no chosen data location yet (as before 71), or the computer is one of a chosen location's
-- (tally_company_source_devices: its bridge proved it its own). Granted to nobody
create or replace function public.tally_source_may_start(p_book uuid, p_device uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select not exists (select 1 from tally_company_sources s where s.book_id = p_book and s.choice = 'chosen')
      or exists (select 1 from tally_company_source_devices d join tally_company_sources s on s.book_id = d.book_id and s.data_id = d.data_id
                  where d.book_id = p_book and d.device_id = p_device and s.choice = 'chosen')
$function$;

-- SR2-M1: tally_start_point (46's text) and tally_recorder_gap_check (47's text) with the lines marked "71": after a choice,
-- only a computer of a chosen location. Their grants as in 46 / 47
create or replace function public.tally_start_point(p_firm uuid, p_book uuid, p_guid text, p_altvch bigint, p_altmst bigint, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); c tally_sync_cursor%rowtype; done boolean := false; other boolean; fresh boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  -- ALTVCHID 0 or less is unknown (an unread value), never a starting point; 10^15 or more is past Tally's range (44's review M2, L9)
  if p_altvch is null or p_altvch <= 0 or p_altvch >= 1000000000000000 or (p_altmst is not null and (p_altmst < 0 or p_altmst >= 1000000000000000)) then
    raise exception 'the starting point needs the highest voucher AlterID (more than 0, below 10^15)';
  end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  -- 71 (the security re-check SR2-M1): once the book has a chosen data location, only a computer of a chosen location records     -- 71
  -- the starting point (a 2.4.0 bridge on the other copy, which names no data location, never does)     -- 71
  if not tally_source_may_start(p_book, p_device) then     -- 71
    return jsonb_build_object('ok', true, 'set', false, 'notChosenComputer', true, 'otherCompany', false,     -- 71
      'why', 'this computer reads no data location FinCom reads for this company: the starting point comes from a computer of the chosen one');     -- 71
  end if;     -- 71
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  select * into c from tally_sync_cursor where book_id = p_book;
  -- the owner's baseline clear (tally_baseline_clear, 37) after the starting point: this call records afresh, and the GUID
  -- it brings is the book's company from now on (so tally_sync_guard does not flag it)
  fresh := c.start_at is not null and c.cleared_at is not null and c.cleared_at > c.start_at;
  if fresh and g is not null then
    update tally_sync_cursor set company_guid = g, updated_at = now() where book_id = p_book;
  end if;
  -- the GUID as today: another company GUID marks the book needs_baseline (tally_sync_guard, migration 32)
  perform tally_sync_guard(p_firm, p_book, g, null, null, p_device, p_bridge);
  select * into c from tally_sync_cursor where book_id = p_book;
  -- another company than the book's (a same-named company on another PC, a restored or re-created one): never moves the point
  other := g is not null and c.company_guid is not null and c.company_guid <> g;
  if other then
    null;
  elsif c.start_at is null or fresh then
    update tally_sync_cursor set last_voucher_alterid = p_altvch, last_master_alterid = p_altmst, start_guid = coalesce(g, case when fresh then c.company_guid else c.start_guid end),
           start_at = now(), start_device = p_device, gap = case when fresh then null else gap end, gap_at = case when fresh then null else gap_at end,
           last_match_at = case when fresh then null else last_match_at end, updated_at = now()
     where book_id = p_book;
    done := true;
  elsif g is not null and c.start_guid is null then
    -- a starting point the gap check recorded without a GUID: the GUID stamped, the numbers kept (an open gap is never forgiven)
    update tally_sync_cursor set start_guid = g, updated_at = now() where book_id = p_book;
  elsif g is not null and c.start_guid <> g then
    -- a point another GUID moved before 46: kept; the owner's baseline clear records it afresh
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), updated_at = now(),
           state_why = format('the starting point (%s) was recorded under another company GUID (%s); this book''s is %s: the owner''s baseline clear records it afresh', c.last_voucher_alterid, c.start_guid, g)
     where book_id = p_book;
  end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  return jsonb_build_object('ok', true, 'set', done, 'startVoucher', c.last_voucher_alterid, 'startMaster', c.last_master_alterid, 'guid', c.start_guid, 'at', c.start_at, 'state', c.state, 'why', c.state_why,
    'otherCompany', other, 'bookGuid', c.company_guid, 'afterClear', done and fresh);
end $function$;

create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bk tally_books%rowtype; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
  mbase bigint; since_ timestamptz; w record; lo bigint; hi bigint; above bigint; kk bigint; dup bigint; cr bigint; credit bigint := 0; ww text := ''; wins jsonb := '[]'::jsonb;
  fb bigint := 0; fbm bigint := 0; wm bigint := 0; since_fb timestamptz; cg text; lost bigint := 0; lost_w text := '';
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into bk from tally_books where book_id = p_book;
  f := bk.firm_id;
  if f is null then raise exception 'no such book'; end if;
  if p_altvchid is null or p_altvchid >= 1000000000000000 then raise exception 'the check needs Tally''s highest voucher AlterID'; end if;
  -- 0 or less is unknown (the bridge read no ALTVCHID): never a starting point, never a rewind; the cursor untouched (review M2)
  if p_altvchid <= 0 then return jsonb_build_object('ok', true, 'gap', null, 'unknown', true); end if;
  -- 71 (the security re-check SR2-M1): once the book has a chosen data location, only a computer of a chosen location is     -- 71
  -- checked (its numbers are the copy FinCom reads; another computer's are another copy's): nothing written     -- 71
  if not tally_source_may_start(p_book, p_device) then     -- 71
    return jsonb_build_object('ok', true, 'gap', null, 'notChosenComputer', true);     -- 71
  end if;     -- 71
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- no starting point yet: this number is it (7.), and there is no gap
  if c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvchid, start_at = now(), start_device = p_device, start_guid = coalesce(start_guid, company_guid), gap = null, gap_at = null, updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'startRecorded', true, 'gap', null, 'startVoucher', p_altvchid);
  end if;
  -- below the starting point: a backup restored or the data rewritten - needs_baseline as today, never a gap (45: the last
  -- match's number cleared too)
  if p_altvchid < coalesce(c.last_voucher_alterid, 0) then
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, match_alter = null, match_start = null, updated_at = now(),
           state_why = format('Tally''s highest voucher AlterID (%s) is below the starting point (%s): a backup restored or the data rewritten', p_altvchid, c.last_voucher_alterid)
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the starting point (%s < %s)', p_altvchid, c.last_voucher_alterid));
  end if;
  select max(d.alter_max) into dmax from tally_days d where d.book_id = p_book;
  -- 45: the last check that matched under this starting point accounted everything up to its number
  mbase := case when c.match_start is not distinct from c.start_at then c.match_alter end;
  -- review L10: below that number, read after that match, is a restore as below the start (needs_baseline as 44, never
  -- matched); a reading older than the match (two beats crossing) changes nothing and says nothing
  if mbase is not null and p_altvchid < mbase then
    if c.last_match_at is null or at_ > c.last_match_at then
      update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, updated_at = now(),
             state_why = format('Tally''s highest voucher AlterID (%s) is below the last matched check''s (%s): a backup restored or the data rewritten', p_altvchid, mbase)
       where book_id = p_book;
      return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the last match (%s < %s)', p_altvchid, mbase));
    end if;
    return jsonb_build_object('ok', true, 'gap', null, 'behind', true, 'why', format('a reading older than the last match (%s < %s)', p_altvchid, mbase));
  end if;
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0), coalesce(mbase, 0));
  since_ := coalesce(c.last_match_at, c.start_at);
  missing := p_altvchid - base;
  if missing > 0 then
    -- (a) the posting windows above the baseline and below Tally's number now (review M1), of this book's company GUID
    cg := coalesce(c.start_guid, c.company_guid);
    for w in select pw.job_id, pw.a0, pw.a1, pw.created_vch, pw.created_mst, pw.company_guid, coalesce(j.taken_at, j.created_at, pw.at) as posted_at
               from tally_post_windows pw left join tally_post_jobs j on j.id = pw.job_id
              where pw.book_id = p_book and pw.a1 > base and pw.a0 < p_altvchid and pw.a1 >= pw.a0 order by pw.a0, pw.id loop
      if w.company_guid is null or cg is null or w.company_guid <> cg then
        ww := ww || format('; FinCom''s posting of %s not counted (made in company GUID %s; this book''s is %s)', to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
                           coalesce(w.company_guid, 'not sent'), coalesce(cg, 'not known yet'));
        wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'counted', 0, 'otherCompany', true));
        continue;
      end if;
      lo := greatest(w.a0, base); hi := least(w.a1, p_altvchid); above := greatest(hi - lo, 0);
      -- the changes in the window that are not FinCom's vouchers (a person's, or its masters'): at most kk; of the part above
      -- the baseline at least above - kk is FinCom's (review M1), and only vouchers raise ALTVCHID's count here (review M2)
      kk := greatest(w.a1 - w.a0 - w.created_vch, 0); wm := wm + w.created_mst;
      -- never subtract twice: the window's entries a recorder line matched carry their AlterID into recorder_max_alter, so they
      -- are inside the baseline already; counted here they are taken off (review L7: empty by construction, kept as the guard)
      select count(*) into dup from tally_post_ids p where p.job_id = w.job_id and p.matched_at is not null and p.matched_alter > lo and p.matched_alter <= w.a1
         and p.matched_alter <= coalesce(c.recorder_max_alter, 0);
      cr := greatest(least(above, w.created_vch, above - kk) - dup, 0);
      if kk > 0 then     -- not fully accounted: someone else changed something while it ran (or it made ledgers)
        ww := ww || format('; up to %s changes not received during the posting of %s', kk, to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
      end if;
      credit := credit + cr;
      wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'masters', w.created_mst, 'full', kk = 0, 'counted', cr));
    end loop;
    -- (c) the fallback: the vouchers of FinCom's postings without a window, accepted after the last match (else the starting
    -- point), not matched by a recorder line and not in the copy (a day read or a line brought them: inside the baseline;
    -- review L1: also when the copy marked it deleted since). Review H1: "after" is the SERVER's time of the latest thing that
    -- set the baseline: the last match (match_at, the server's clock), the last recorder line that raised recorder_max_alter
    -- (recorder_last_at), the day read that brought the highest AlterID. A posting accepted before it has its changes under
    -- the baseline already; no posting is subtracted at two checks. Residual: these are the times acceptances REACHED the
    -- cloud, not Tally's; a batch reported seconds after a later person's line still counts (at most one request; closed by
    -- 2.2.0's windows; docs/reviews/migration-45-review.md, Fixed)
    since_fb := greatest(coalesce(case when c.match_start is not distinct from c.start_at then coalesce(c.match_at, c.last_match_at) end, c.start_at),
                         case when coalesce(c.recorder_max_alter, 0) > coalesce(c.last_voucher_alterid, 0) then c.recorder_last_at end,
                         (select max(d.at) from tally_days d where d.book_id = p_book and d.alter_max >= base));
    select count(*) into fb from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
     where p.firm_id = f and j.firm_id = f and j.company = bk.company
       and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
       and p.accepted_at is not null and p.accepted_at > since_fb and p.released_at is null and p.matched_at is null
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id = p.fincom_id);
    if fb > 0 then
      select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) r
                            where r->>'kind' = 'master' and tally_post_result_accepted(r))), 0) into fbm
        from tally_post_jobs j
       where j.firm_id = f and j.company = bk.company and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
         and exists (select 1 from tally_post_ids p where p.job_id = j.id and p.accepted_at > since_fb);
    end if;
    missing := p_altvchid - base - credit - fb;
    fbm := fbm + wm;
  end if;
  -- 47 (review H1): the lines of a queued send that failed for good are NOT received, though later lines raised the
  -- recorder's highest AlterID above them: each one not brought since (a later line of that entry at its AlterID or above,
  -- or the copy holding the entry so: a day read) is counted, so the check is never fooled into a match
  select count(*) into lost from tally_recorder_lines r
   where r.book_id = p_book and r.state = 'failed' and r.held_why like 'queued send failed%'
     and r.event in ('created', 'altered', 'imported', 'deleted', 'cancelled') and r.object_guid is not null and r.alter_id is not null
     and not exists (select 1 from tally_recorder_lines r2 where r2.book_id = p_book and r2.object_guid = r.object_guid and r2.alter_id >= r.alter_id and r2.state in ('applied', 'duplicate', 'stale'))
     and case when r.event = 'deleted' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and coalesce(v.alter_id, 0) < r.alter_id)
              when r.event = 'cancelled' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and not coalesce(v.cancelled, false) and coalesce(v.alter_id, 0) < r.alter_id)
              else not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and coalesce(v.alter_id, 0) >= r.alter_id) end;
  if lost > 0 then
    missing := greatest(coalesce(missing, 0), 0) + lost;
    lost_w := format('; %s of them in a queued send that failed (Sync activity: failed): send them again or read those days again', lost);
  end if;
  if missing > 0 then
    -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', since_, 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'accounted', credit, 'posted', fb, 'windows', wins, 'ledgers', fbm, 'lost', lost,
           'words', format('up to %s changes not received since %s', missing, to_char(since_ at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')) || ww || lost_w
                    || case when fbm > 0 then format('; of which up to %s may be FinCom''s own new ledgers', least(fbm, missing)) else '' end);
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, match_at = now(), match_alter = greatest(coalesce(mbase, 0), p_altvchid), match_start = c.start_at, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_, 'accounted', credit + fb);
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

-- SR2-M2 (the security re-check): p_seen, the data ids of the locations the owner's card showed; when the book's locations
-- differ now the choice is refused ("Something changed since this page loaded; look again"). Required where the choice
-- applies held lines at once (a book's only location, N2)
create or replace function public.tally_company_source_choose(p_book uuid, p_data_id text, p_seen text[] default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); did text := lower(btrim(coalesce(p_data_id, ''))); b tally_books%rowtype; n text; c tally_sync_cursor%rowtype; was text; others integer; now_ids text[];
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose which data location FinCom reads' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = f;
  if b.book_id is null then raise exception 'not a company of your firm'; end if;
  if did !~ '^[0-9a-f]{16}$' or not exists (select 1 from tally_company_sources where book_id = p_book and data_id = did) then
    raise exception 'not a data location of this company';
  end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  perform pg_advisory_xact_lock(hashtext(p_book::text));     -- the re-review's N3
  select coalesce(array_agg(data_id order by data_id), '{}') into now_ids from tally_company_sources where book_id = p_book;
  if (p_seen is not null and now_ids is distinct from (select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}') from unnest(p_seen) x))
     or (p_seen is null and cardinality(now_ids) = 1 and exists (select 1 from tally_company_sources where book_id = p_book and data_id = did and choice = 'pending')) then
    return jsonb_build_object('ok', false, 'error', 'Something changed since this page loaded; look again');
  end if;
  select choice into was from tally_company_sources where book_id = p_book and data_id = did;
  select count(*) into others from tally_company_sources where book_id = p_book and data_id <> did and choice = 'chosen';
  update tally_company_sources set choice = 'chosen', chosen_by = auth.uid(), chosen_at = now() where book_id = p_book and data_id = did;
  select tally_source_mark(m.n) into n from tally_source_marks(p_book) m where m.data_id = did;
  -- every other location of the book 'other' (the re-review: a pending one too when the owner uses the one FinCom reads already)
  update tally_company_sources set choice = 'other' where book_id = p_book and data_id <> did and choice <> 'other';
  -- review M3 of next-241: the location FinCom reads already (and alone): who and when stamped, the starting point kept
  if was = 'chosen' and others = 0 then
    return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', false, 'already', true);
  end if;
  -- the re-review's N2: the book's ONLY location (no other copy to mix with): its held lines applied now, the starting point kept
  if not exists (select 1 from tally_company_sources where book_id = p_book and data_id <> did) then
    return jsonb_build_object('ok', true, 'chosen', did, 'n', n, 'at', now(), 'by', auth.uid(), 'startCleared', false, 'released', tally_company_source_release(p_book, did, null, null));
  end if;
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
-- SR2-M2: p_pending, the data ids the owner's card showed waiting for a choice: only those, and only when the book's pending
-- ones are exactly those now (else "Something changed since this page loaded; look again", nothing done)
create or replace function public.tally_company_source_same(p_book uuid, p_pending text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); b tally_books%rowtype; s record; n integer := 0; now_ids text[];
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose which data location FinCom reads' using errcode = '42501'; end if;
  select * into b from tally_books where book_id = p_book and firm_id = f;
  if b.book_id is null then raise exception 'not a company of your firm'; end if;
  perform pg_advisory_xact_lock(hashtext('sources' || p_book::text));
  perform pg_advisory_xact_lock(hashtext(p_book::text));     -- the re-review's N3
  -- the re-review (Low): only while a location waits for the owner's choice, and only those: never one the owner set 'other'
  if not exists (select 1 from tally_company_sources where book_id = p_book and choice = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'no data location of this company is waiting for a choice');
  end if;
  select coalesce(array_agg(data_id order by data_id), '{}') into now_ids from tally_company_sources where book_id = p_book and choice = 'pending';
  if now_ids is distinct from (select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}') from unnest(coalesce(p_pending, '{}')) x) then
    return jsonb_build_object('ok', false, 'error', 'Something changed since this page loaded; look again');
  end if;
  for s in select data_id from tally_company_sources where book_id = p_book and choice = 'pending' loop
    update tally_company_sources set choice = 'chosen', chosen_by = auth.uid(), chosen_at = now() where book_id = p_book and data_id = s.data_id;
    n := n + tally_company_source_release(p_book, s.data_id, null, null);
  end loop;
  -- N1: the lines held without a data id (an older bridge or add-on on one of these computers) applied with them
  n := n + tally_company_source_release(p_book, '', null, null);
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
revoke all on function public.tally_company_source_release(uuid, text, bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_source_reads(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.tally_source_words(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_company_source_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tally_recorder_send_sourced(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.tally_company_source_verify_list(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tally_source_sort(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.tally_recorder_settle(bigint, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.tally_source_may_start(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) to service_role;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;
revoke all on function public.tally_company_source_choose(uuid, text, text[]) from public, anon;
revoke all on function public.tally_company_source_same(uuid, text[]) from public, anon;
revoke all on function public.tally_company_sources_of(uuid) from public, anon;
grant execute on function public.tally_company_sources_note(uuid, uuid, uuid, jsonb), public.tally_company_source_lines(uuid, uuid, uuid, jsonb),
  public.tally_recorder_send_sourced(uuid, uuid, uuid, jsonb, boolean), public.tally_company_source_verify_list(uuid, uuid) to service_role;
grant execute on function public.tally_company_source_choose(uuid, text, text[]), public.tally_company_source_same(uuid, text[]), public.tally_company_sources_of(uuid) to authenticated;

commit;
