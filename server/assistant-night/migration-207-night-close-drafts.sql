-- Migration 207 (23-Nov-2026, branch next-assistant): Daily Check's night_apply closes a Draft question whenever its
-- finding stops being a question. Written and tested here (tests/run_migration206.py applies 206 then 207 on pg_stand);
-- not run anywhere. Needs 206 (applied on staging 22-Nov-2026).
-- Staging's second night: two wrong-side findings moved from "ask" to "you" and kept their Draft questions. Now:
--   - a finding that goes to "you" (or a person dismissed it): its Draft question is closed, closed_by 'fincom' ("the firm
--     looks at it first"); a question already Asked or Answered stays as it is (the page lists it under Needs you);
--   - cleared (no longer found): a Draft closes with 'fincom', an Asked one with 'entry', as before;
--   - resolved: closed by the document or the entry, as before;
--   - back to "ask" from anything else: a question FinCom closed (document, entry or fincom) is reopened as a Draft on this
--     week's list; one a person closed stays closed.
-- ADD-ONLY: client_asks.closed_by may also be 'fincom' (its check constraint widened: dropped and made again with one more
-- value, by name, only if it is 206's); night_apply replaced with the same arguments, its grants and comment restated.
-- Nothing else changes; no row is changed. Safe to run twice. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

do $c$
declare n text;
begin
  if to_regprocedure('public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)') is null
     or coalesce(obj_description(to_regprocedure('public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text)'), 'pg_proc'), '') <> 'daily check (migration 206)' then
    raise exception 'migration 207: run migration 206 first (night_apply is not Daily Check''s)';
  end if;
  select c.conname into n from pg_constraint c where c.conrelid = 'public.client_asks'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%closed_by%';
  if n is null then raise exception 'migration 207: client_asks has no closed_by check'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.client_asks'::regclass and conname = n)) not like '%fincom%' then
    execute format('alter table public.client_asks drop constraint %I', n);
    alter table public.client_asks add constraint client_asks_closed_by_check check (closed_by in ('document', 'entry', 'person', 'fincom'));
  end if;
end $c$;

-- one client's night: findings, questions, entries, the run, all at once and safe to repeat (rule 4)
create or replace function public.night_apply(p_firm uuid, p_client text, p_night date, p_version text, p_findings jsonb, p_entries jsonb, p_complete boolean, p_why text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  f jsonb; e jsonb; cur public.night_findings; fid uuid; st text; ev jsonb; seen text[] := '{}'; eseen text[] := '{}';
  q public.client_asks; wk date := public.asst_week(p_night); c_new int := 0; c_asks int := 0; c_closed int := 0; c_res int := 0; c_you int := 0; c_ent int := 0; c_clear int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('night|' || p_firm::text || '|' || p_client));
  insert into public.night_runs as r (firm_id, client_id, night, books_version, status) values (p_firm, p_client, p_night, coalesce(p_version, ''), 'running')
    on conflict (firm_id, client_id, night) do update set books_version = excluded.books_version;
  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    seen := seen || ((f->>'kind') || '|' || (f->>'key'));
    st := f->>'state'; ev := case when st = 'resolved' then coalesce(f->'evidence', '[]'::jsonb) else '[]'::jsonb end;
    cur := null;
    select * into cur from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and x.kind = f->>'kind' and x.key = f->>'key';
    if cur.id is not null then
      if cur.decided_by is not null or cur.state = 'dismissed' then st := cur.state; ev := cur.evidence;      -- a person's choice stays
      elsif cur.undone_at is not null and st = 'resolved' then                                               -- undone or rejected: never resolved again
        st := case when cur.state = 'you' then 'you' else 'ask' end; ev := '[]'::jsonb; end if;
      update public.night_findings set facts = coalesce(f->'facts', '{}'::jsonb), state = st, evidence = ev,
        candidates = case when st = 'you' and cur.decided_by is null then coalesce(f->'candidates', '[]'::jsonb) else candidates end, last_seen = greatest(last_seen, p_night)
       where id = cur.id;
      fid := cur.id;
    else
      insert into public.night_findings (firm_id, client_id, kind, key, facts, state, evidence, candidates, first_seen, last_seen)
        values (p_firm, p_client, f->>'kind', f->>'key', coalesce(f->'facts', '{}'::jsonb), st, ev, case when st = 'you' then coalesce(f->'candidates', '[]'::jsonb) else '[]'::jsonb end, p_night, p_night)
        returning id into fid;
      c_new := c_new + 1;
    end if;
    if st = 'resolved' then c_res := c_res + 1; elsif st = 'you' then c_you := c_you + 1; end if;
    select * into q from public.client_asks a where a.finding_id = fid;
    if st = 'ask' and q.id is null and coalesce(f->'facts'->>'ask_text', '') <> '' then
      -- a new question; one a finding, ever: a closed or answered one is never made again (unique finding_id)
      insert into public.client_asks (firm_id, client_id, finding_id, week, text, history)
        values (p_firm, p_client, fid, wk, f->'facts'->>'ask_text', public.asst_hist(null, 'Found by the night check')) on conflict (finding_id) do nothing;
      c_asks := c_asks + 1;
    elsif st = 'ask' and q.id is not null and q.state = 'closed' and q.closed_by in ('document', 'entry', 'fincom') and cur.id is not null and cur.state <> 'ask' then
      -- back to a question (FinCom's answer is gone, the firm's look is no longer needed, or it is found again): a new Draft
      -- on this week's list (a question a PERSON closed stays closed)
      update public.client_asks set state = 'draft', closed_by = null, close_ref = null, week = wk, history = public.asst_hist(history, 'Asked again: found again by the night check') where id = q.id;
      c_asks := c_asks + 1;
    elsif st = 'resolved' and q.id is not null and q.state <> 'closed' then
      -- closes by itself: the document came, or the entry is in the books
      update public.client_asks set state = 'closed',
        closed_by = case when exists (select 1 from jsonb_array_elements(ev) x where x->>'t' in ('doc', 'twob', 'challan', 'salary')) then 'document' else 'entry' end,
        close_ref = ev->0->>'ref', history = public.asst_hist(history, 'Closed: ' || coalesce(ev->0->>'label', 'answered'))
       where id = q.id;
      c_closed := c_closed + 1;
    elsif st in ('you', 'dismissed') and q.id is not null and q.state = 'draft' then
      -- (207) not a question any more: the firm looks first. Its Draft is closed (never sent); an Asked or Answered one stays
      -- as it is (the page shows it under Needs you, never From clients)
      update public.client_asks set state = 'closed', closed_by = 'fincom', history = public.asst_hist(history, 'Closed: the firm looks at it first') where id = q.id;
      c_closed := c_closed + 1;
    end if;
  end loop;
  if p_complete then
    -- what is no longer found (the books were put right): cleared, its open question closed
    for cur in select * from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and x.state in ('ask', 'you') and x.decided_by is null
                and not ((x.kind || '|' || x.key) = any (seen)) loop
      update public.night_findings set state = 'cleared' where id = cur.id;
      update public.client_asks set state = 'closed', closed_by = case when state = 'draft' then 'fincom' else 'entry' end, history = public.asst_hist(history, 'Closed: no longer found in the books')
       where finding_id = cur.id and state in ('draft', 'asked');
      c_clear := c_clear + 1;
    end loop;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    eseen := eseen || (e->>'dedupe');
    select x.id into fid from public.night_findings x where x.firm_id = p_firm and x.client_id = p_client and (x.kind || '|' || x.key) = e->>'finding_key';
    -- only for a finding still resolved by FinCom (an undone one makes none)
    if fid is null or not exists (select 1 from public.night_findings x where x.id = fid and x.state = 'resolved' and x.undone_at is null) then continue; end if;
    insert into public.night_entries as n (firm_id, client_id, finding_id, source, dedupe, work_ref, voucher, reason, why, evidence, checks, state)
      values (p_firm, p_client, fid, e->>'source', e->>'dedupe', coalesce(e->>'work_ref', ''), coalesce(e->'voucher', '{}'::jsonb), coalesce(e->>'reason', ''), coalesce(e->>'why', ''),
              coalesce(e->'evidence', '[]'::jsonb), coalesce(e->'checks', '[]'::jsonb), case when (e->>'ready')::boolean then 'ready' else 'held' end)
      on conflict (firm_id, client_id, dedupe) do update set voucher = excluded.voucher, reason = excluded.reason, why = excluded.why, evidence = excluded.evidence, checks = excluded.checks,
        state = excluded.state, finding_id = excluded.finding_id, work_ref = excluded.work_ref, updated_at = now()
       where n.state in ('ready', 'held', 'withdrawn') and n.decided_by is null;
    c_ent := c_ent + 1;
  end loop;
  if p_complete then
    update public.night_entries set state = 'withdrawn', updated_at = now()
     where firm_id = p_firm and client_id = p_client and state in ('ready', 'held') and not (dedupe = any (eseen));
    -- an approval the books and FinCom do not show (the night made the same entry again: its bill is still not approved, its
    -- bank line still has no ledger) more than 30 minutes after it was recorded: put back as ready, logged
    for e in select jsonb_build_object('id', n.id, 'dedupe', n.dedupe) from public.night_entries n
              where n.firm_id = p_firm and n.client_id = p_client and n.state = 'approved' and n.dedupe = any (eseen) and n.decided_at < now() - interval '30 minutes' loop
      update public.night_entries set state = 'ready', decided_by = null, decided_at = null, updated_at = now() where id = (e->>'id')::uuid;
      insert into public.daily_log (firm_id, client_id, what, ref, evidence) values (p_firm, p_client, 'approval_not_found', e->>'id', e);
    end loop;
  end if;
  update public.night_runs set finished_at = now(), status = case when p_complete then 'ok' else 'partial' end, why = left(coalesce(p_why, ''), 500),
    counts = jsonb_build_object('findings', jsonb_array_length(coalesce(p_findings, '[]'::jsonb)), 'new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear)
   where firm_id = p_firm and client_id = p_client and night = p_night;
  insert into public.daily_log (firm_id, client_id, what, ref, evidence) values (p_firm, p_client, 'night', p_night::text,
    jsonb_build_object('new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear, 'version', p_version));
  return jsonb_build_object('new', c_new, 'asks', c_asks, 'closed', c_closed, 'resolved', c_res, 'you', c_you, 'entries', c_ent, 'cleared', c_clear);
end $$;

revoke all on function public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text) to service_role;
comment on function public.night_apply(uuid, text, date, text, jsonb, jsonb, boolean, text) is 'daily check (migration 206)';

commit;
