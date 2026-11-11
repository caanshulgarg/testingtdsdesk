-- migration-156-reliability (11-Nov-2026, the reliability audit, cloud item C3). Written, NOT run yet: the owner reads it
-- and runs it. (155 is another branch's number.)
-- Why: tally_fetch_summary, the Tally page's one call for the firm's books, asked tally_today_rows for EVERY book: one
-- JSON row per entry fetched today, each with its own sum over tally_lines and a join to tally_vouchers, and then only
-- counted them. On staging: about 9,360 rows built to return six numbers, 605 ms a call on average (49,000 buffer hits),
-- and slower with every entry fetched that day, towards the 8 s limit of a signed-in person's statement.
-- How (add-only; no table created, changed, dropped or emptied; no row written):
--   - tally_fetch_summary (same arguments, same result, the same JSON byte for byte for the same rows): today's six values
--     are counted straight from tally_recorder_lines and tally_fetch_log with count(*) filter (...): no amounts, no join,
--     no row built. The rules are tally_today_rows' own, unchanged: the recorder's applied lines of the four entry events
--     since India's midnight (applied_at, else received_at) count as via 'tally' (created = added, altered = changed,
--     deleted or cancelled = deleted); the fetch log's rows since then count by their own via and what. "last" stays
--     what it was: the largest TEXT of the times as JSON writes them (to_jsonb(at) is that same text). Everything else
--     of the function (pull, check, devices, who may call) is 133's text, letter for letter.
--   - one index, tally_recorder_lines_applied_at: a book's applied lines by that time (tally_fetch_log has its own
--     since 133: tally_fetch_log_book_at). The table is small (hundreds of rows on staging); the index is made inside
--     this transaction, under the 10 s lock_timeout.
--   - tally_today_rows and tally_today_from_tally (the list a person opens) are not changed.
-- Grants: written out again as 133 set them (authenticated and service_role; not public, not anon).
-- Safe to run twice. Tested: tests/run_migration156.py (133's function kept under another name in the stand and both
-- asked in one statement: the same text for every case).

begin;
set local lock_timeout = '10s';

create index if not exists tally_recorder_lines_applied_at on public.tally_recorder_lines (book_id, (coalesce(applied_at, received_at)) desc) where state = 'applied';

-- the firm's books for the Tally page and Books › From Tally (one call): each book's period (as tally_period_status), today's
-- counts, the check's counts, and the computers that hold its company (their id and switch only; never a name)
create or replace function public.tally_fetch_summary(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb; t0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('book', b.book_id, 'client', b.client_id, 'company', b.company, 'from', b.from_date,
      'pull', case when exists (select 1 from tally_period_pulls p where p.book_id = b.book_id) then tally_period_status_of(b.book_id)->'pull' end,
      'today', (select jsonb_build_object('added', count(*) filter (where z.via = 'tally' and z.what = 'added'), 'changed', count(*) filter (where z.via = 'tally' and z.what = 'changed'),
                  'deleted', count(*) filter (where z.via = 'tally' and z.what = 'deleted'), 'older', count(*) filter (where z.via = 'older'),
                  'corrected', count(*) filter (where z.via = 'check'), 'last', max(to_jsonb(z.at) #>> '{}'))
                  from (select coalesce(l.applied_at, l.received_at) as at, case l.event when 'created' then 'added' when 'altered' then 'changed' else 'deleted' end as what, 'tally'::text as via
                          from tally_recorder_lines l
                         where l.book_id = b.book_id and l.state = 'applied' and l.event in ('created', 'altered', 'deleted', 'cancelled') and coalesce(l.applied_at, l.received_at) >= t0
                        union all
                        select g.at, g.what, g.via from tally_fetch_log g where g.book_id = b.book_id and g.at >= t0) z),
      'check', case when exists (select 1 from tally_check_days x where x.book_id = b.book_id) then (select jsonb_build_object('total', s->'total', 'same', s->'same', 'fixed', s->'fixed',
                  'waiting', s->'waiting', 'upload', s->'upload', 'run', s->'run') from (select tally_check_status_of(b.book_id) s) z) end,
      'devices', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'fetchOn', coalesce(d.period_fetch, false)) order by d.id), '[]'::jsonb) from tally_devices d
                   where d.firm_id = f and not coalesce(d.revoked, false)
                     and (d.id in (select c.device_id from tally_companies c where c.book_id = b.book_id and c.device_id is not null)
                          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(d.info->'beat'->'open') = 'array' then d.info->'beat'->'open' else '[]'::jsonb end) o
                                      where lower(btrim(coalesce(o->>'name', o #>> '{}'))) = lower(btrim(b.company)))
                          or exists (select 1 from jsonb_each(case when jsonb_typeof(d.info->'bridges') = 'object' then d.info->'bridges' else '{}'::jsonb end) e,
                                      jsonb_array_elements(case when jsonb_typeof(e.value->'open') = 'array' then e.value->'open' else '[]'::jsonb end) o
                                      where lower(btrim(coalesce(o->>'name', o #>> '{}'))) = lower(btrim(b.company)))))
      ) order by b.company), '[]'::jsonb) into out
    from tally_books b where b.firm_id = f and (p_book is null or b.book_id = p_book);
  return jsonb_build_object('ok', true, 'books', out);
end $function$;

-- who may call (as 133 set it)
revoke all on function public.tally_fetch_summary(uuid) from public, anon;
grant execute on function public.tally_fetch_summary(uuid) to authenticated, service_role;

commit;
