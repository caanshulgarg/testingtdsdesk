-- migration-137-held-status-online.sql (02-Nov-2026, branch next-held-settle; after 136 ran on staging). Read on staging right
-- after 136: the owner's book has 29 days queued for the check, but the only computer whose "read older entries" switch is
-- on was last seen on 31-Oct; the computer that is connected has the switch off. 136's tally_held_status counted any switch
-- that is on, so Sync activity would have said "FinCom is checking them with Tally now (0%)" while nothing could check them.
-- 137 replaces only 136's own tally_held_status (created the same day; nothing else calls it): the check is 'off' unless a
-- computer of the firm with the switch on was seen in the last 10 minutes, and says why: 'offline' (a computer has the
-- switch on but is not connected) or 'switch' (no computer has it on). Its answer otherwise as 136's (fetchOn now means
-- "a connected computer reads older entries"). No table, no other function, no row changed. One transaction, lock_timeout
-- 10 s, safe twice. Tested by tests/run_migration136.py (137 run after 136). Runs after 136.
begin;
set local lock_timeout = '10s';

create or replace function public.tally_held_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); out jsonb := '[]'::jsonb; b record; h record; c record; run tally_check_runs%rowtype; rn jsonb; ren jsonb; a jsonb; rate numeric; eta int; st text; fo boolean; fany boolean;
  today date := (now() at time zone 'Asia/Kolkata')::date; ad date; ok boolean;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false)) into fany;
  select exists (select 1 from tally_devices d where d.firm_id = f and not coalesce(d.revoked, false) and coalesce(d.period_fetch, false) and d.last_seen > now() - interval '10 minutes') into fo;
  for b in select k.book_id, k.client_id, k.company from tally_books k where k.firm_id = f and (p_client is null or k.client_id = p_client) order by k.company, k.book_id loop
    select count(*)::int as n, count(*) filter (where l.event in ('deleted', 'cancelled'))::int as dels, count(*) filter (where l.event not in ('deleted', 'cancelled'))::int as ents,
           min(l.vch_date) as d0, max(l.vch_date) as d1, coalesce(jsonb_agg(distinct to_char(l.vch_date, 'YYYYMMDD')), '[]'::jsonb) as days
      into h from tally_recorder_lines l
     where l.book_id = b.book_id and l.state = 'held' and tally_held_line_ours(l.event, l.object_guid, l.vch_date, l.held_why);
    select count(*)::int as total, count(*) filter (where d.done_at is not null and d.upload_at is null)::int as done_n,
           count(*) filter (where d.done_at is null and d.upload_at is null)::int as waiting, count(*) filter (where d.upload_at is not null)::int as upload,
           least(30, extract(epoch from now() - min(coalesce(d.first_asked_at, d.asked_at))) / 60) as mins
      into c from tally_check_days d where d.book_id = b.book_id and d.source = 'held' and d.queued_at > now() - interval '2 days';
    rn := tally_held_renumber_of(b.book_id);
    if h.n = 0 and c.total = 0 and jsonb_array_length(rn) = 0 then continue; end if;
    select * into run from tally_check_runs where book_id = b.book_id;
    rate := case when c.mins >= 2 and c.done_n > 0 then c.done_n / c.mins end;
    eta := case when c.waiting > 0 and rate > 0 then greatest(1, round(c.waiting / rate))::int end;
    st := case when run.book_id is not null and run.state = 'stopped' and c.waiting > 0 then 'stopped' when not fo and c.waiting > 0 then 'off'
               when c.total = 0 then 'none' when c.waiting = 0 then 'done' when c.done_n + c.upload > 0 then 'checking' else 'queued' end;
    ren := '[]'::jsonb;
    for a in select jsonb_array_elements(rn) loop
      ad := least(today, ((a->>'at')::timestamptz at time zone 'Asia/Kolkata')::date);
      select not exists (select 1 from generate_series((a->>'from')::date, ad, interval '1 day') d
                          where not exists (select 1 from tally_check_days x where x.book_id = b.book_id and x.day = d::date and x.done_at is not null and x.via = 'day' and x.listed_at > (a->>'at')::timestamptz)
                            and not exists (select 1 from tally_days t where t.book_id = b.book_id and t.day = d::date and t.at > (a->>'at')::timestamptz)) into ok;
      ren := ren || jsonb_build_array(jsonb_build_object('from', to_char((a->>'from')::date, 'YYYYMMDD'), 'at', a->>'at', 'n', a->'n', 'more', a->'more', 'checked', ok));
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('book', b.book_id, 'client', b.client_id, 'company', b.company,
      'held', h.n, 'deletes', h.dels, 'entries', h.ents, 'from', to_char(h.d0, 'YYYYMMDD'), 'to', to_char(h.d1, 'YYYYMMDD'), 'days', h.days,
      'check', jsonb_build_object('total', c.total, 'done', c.done_n, 'waiting', c.waiting, 'upload', c.upload, 'etaMin', eta, 'state', st,
                                  'words', case when st = 'stopped' then run.stop_words end,
                                  'why', case when st = 'off' then case when fany then 'offline' else 'switch' end end),
      'fetchOn', fo, 'renumber', ren));
  end loop;
  return jsonb_build_object('ok', true, 'books', out);
end $function$;

revoke all on function public.tally_held_status(text) from public, anon;
grant execute on function public.tally_held_status(text) to authenticated, service_role;

commit;
