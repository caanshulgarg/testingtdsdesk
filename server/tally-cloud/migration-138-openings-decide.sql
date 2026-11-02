-- Migration 138 (02-Nov-2026, branch next-tally-simple; first numbered 137, renumbered when held lines' 137 landed (the two
-- touch different functions; on staging this one was applied as migration_137_openings_decide, then recorded again as
-- migration_138_openings_decide with the same text); the owner's approved addition to the simple Tally page): one line
-- about opening balances under "Ledgers received?", and the owner's two choices when Tally's openings were held.
--
-- Why: migration 130 keeps a ledger round's (or a trial balance's) openings in tally_openings_held when they would not add
-- up to nil (stage 'held'), or when an undated read would change openings that tie (stage 'kept'). Nobody could see or
-- settle them: tally_openings_held is service_role only. This file adds ONE function, for signed-in members of the firm:
--
--   tally_openings_decide(p_book uuid, p_action text) -> jsonb
--     'status' (any member; p_book null: every book of the firm): FinCom's openings (tally_ledgers.open of the live, not
--              merged ledgers: their sum, how many are not nil, whether they tie within Rs 1) and Tally's openings waiting
--              (the newest held or kept row not yet decided: when, dated as, how many ledgers differ and by how much in
--              all, the sum FinCom's openings would have with Tally's in place, and whether "Use Tally's" may apply them)
--     'list'   (any member): the same for one book with its differences, ledger by ledger (at most 500, largest first):
--              ledger, FinCom amount, Tally amount, difference (Tally's sign: a debit is negative)
--     'use'    (owner or staff): Tally's openings applied, ONLY when they are dated the day FinCom's books begin
--              (tally_books.from_date), every ledger they name is in FinCom, none is an income or expense ledger (those
--              are carried to Profit & Loss A/c by tally_year_openings, which only tally-ingest may run), and FinCom's
--              openings with them in place still tie (total debit = total credit, within Rs 1, as migration 130). Each
--              ledger changed is written to tally_opening_repairs (open before, open_sent before, open after, who and
--              when), open and open_sent set, the held rows marked applied (who and when kept in their why), and
--              tally_books.ledgers_at moved on so every browser reads the ledgers again
--     'keep'   (owner or staff): FinCom's openings kept: the waiting rows marked decided (stage 'kept', "Dismissed by
--              <user> at <time> IST (Keep FinCom's)" before their why; settled_at now). Nothing else changes
--   A refusal is {ok: false, error: <plain words>}; another firm's book is "not allowed".
--
-- ADD-ONLY: one new function; no table created or altered, nothing dropped, no row deleted (held rows are marked, never
-- removed); safe to run twice; one transaction, lock_timeout 10 s. SECURITY DEFINER with the firm check of migration 135
-- (my_firm(), then the member's role for a change); the write takes migration 130's lock on the book (pg_advisory_xact_lock
-- of the book), so it never races tally_openings_settle. Grants explicit: authenticated and service_role; nothing for anon
-- or public. Needs 130 (tally_openings_held, tally_inr) and the table tally_opening_repairs (on staging since 30-Oct-2026).
-- Tested on pg_stand: tests/run_migration138.py (RED_WITHOUT_138=1 fails); the page: tests/run_tally_simple.py.

begin;
set local lock_timeout = '10s';

create or replace function public.tally_openings_decide(p_book uuid, p_action text default 'status')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  f uuid := my_firm(); act text := lower(coalesce(nullif(btrim(p_action), ''), 'status'));
  pl constant text[] := array['sales accounts', 'purchase accounts', 'direct incomes', 'direct expenses', 'indirect incomes', 'indirect expenses'];
  st jsonb; s jsonb; n int; stamp text;
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if act not in ('status', 'list', 'use', 'keep') then raise exception 'the action is status, list, use or keep'; end if;
  if p_book is null and act <> 'status' then return jsonb_build_object('ok', false, 'error', 'Choose the client''s books.'); end if;
  if p_book is not null and not exists (select 1 from tally_books where book_id = p_book and firm_id = f) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if act in ('use', 'keep') then
    if not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.active and m.role in ('owner', 'staff')) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtext(p_book::text));
  end if;

  -- each book's state: FinCom's openings, and Tally's openings waiting (the newest undecided held or kept row; the rows
  -- "part of the round held in row N" are that row's batches)
  with bks as (
    select b.book_id, b.from_date from tally_books b where b.firm_id = f and (p_book is null or b.book_id = p_book)
  ), led as (
    select l.book_id, l.name, coalesce(l.open, 0) as op, lower(coalesce(l.primary_group, '')) = any(pl) as isp
      from tally_ledgers l join bks using (book_id) where l.deleted_at is null and l.merged_into is null
  ), sums as (
    select book_id, coalesce(sum(op), 0) as stored, count(*) filter (where op <> 0) as nonzero from led group by book_id
  ), und as (
    select h.* from tally_openings_held h join bks using (book_id)
     where h.firm_id = f and h.stage in ('held', 'kept') and h.why not like 'Dismissed by %' and h.why not like 'Used by %'
  ), top as (
    select distinct on (book_id) * from und where why not like 'part of the round %' order by book_id, id desc
  ), inc as (
    select distinct on (t.book_id, x->>0) t.book_id, x->>0 as name, round(coalesce(nullif(x->>1, '')::numeric, 0), 2) as op
      from top t, jsonb_array_elements(t.rows) with ordinality as e(x, k) where coalesce(x->>0, '') <> '' order by t.book_id, x->>0, k desc
  ), dif as (
    select i.book_id, i.name, l.op as fincom, i.op as tally, i.op - coalesce(l.op, 0) as d, l.name is null as missing, coalesce(l.isp, false) as isp
      from inc i left join led l on l.book_id = i.book_id and l.name = i.name
     where i.op is distinct from coalesce(l.op, 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'book', b.book_id, 'from', b.from_date,
      'stored', coalesce(su.stored, 0), 'nonzero', coalesce(su.nonzero, 0), 'ties', abs(coalesce(su.stored, 0)) <= 1,
      'held', t.id, 'heldAt', t.at, 'stage', t.stage, 'source', t.source, 'openingsAt', t.openings_at,
      'dated', t.openings_at is not null and t.openings_at = b.from_date,
      'n', (select count(*) from dif x where x.book_id = b.book_id),
      'total', (select coalesce(sum(abs(x.d)), 0) from dif x where x.book_id = b.book_id),
      'candidate', coalesce(su.stored, 0) + (select coalesce(sum(x.d), 0) from dif x where x.book_id = b.book_id and not x.missing),
      'missing', (select count(*) from dif x where x.book_id = b.book_id and x.missing),
      'pl', (select count(*) from dif x where x.book_id = b.book_id and x.isp),
      'rows', case when p_book is null then null else (select coalesce(jsonb_agg(jsonb_build_object('ledger', x.name, 'fincom', x.fincom, 'tally', x.tally, 'diff', x.d)
                 order by abs(x.d) desc, x.name), '[]'::jsonb) from dif x where x.book_id = b.book_id) end
    ) order by b.book_id), '[]'::jsonb)
    into st
    from bks b left join sums su using (book_id) left join top t using (book_id);

  if act = 'status' then
    return jsonb_build_object('ok', true, 'books', (select coalesce(jsonb_agg(x - 'rows'), '[]'::jsonb) from jsonb_array_elements(st) x));
  end if;
  s := st->0;
  if act = 'list' then
    return jsonb_build_object('ok', true, 'book', (s - 'rows') || jsonb_build_object('rows',
      (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(s->'rows') with ordinality as e(x, k) order by k limit 500) y)));
  end if;
  if s->>'held' is null then return jsonb_build_object('ok', false, 'error', 'Nothing from Tally is waiting for this client''s opening balances.'); end if;
  stamp := coalesce(auth.uid()::text, 'FinCom') || ' at ' || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST';

  if act = 'keep' then
    update tally_openings_held set stage = 'kept', why = 'Dismissed by ' || stamp || ' (Keep FinCom''s): ' || why, settled_at = now()
     where book_id = p_book and firm_id = f and stage in ('held', 'kept') and why not like 'Dismissed by %' and why not like 'Used by %';
    get diagnostics n = row_count;
    return jsonb_build_object('ok', true, 'kept', n);
  end if;

  -- 'use': only when dated the books' first day, every ledger in FinCom, no income or expense ledger, and they still tie
  if not (s->>'dated')::boolean then
    return jsonb_build_object('ok', false, 'error', 'Tally''s opening balances are ' || coalesce('dated ' || to_char((s->>'openingsAt')::date, 'DD-Mon-YYYY'), 'not dated')
      || ', not ' || coalesce(to_char((s->>'from')::date, 'DD-Mon-YYYY'), 'the day FinCom''s books begin') || ', so FinCom keeps its own.');
  end if;
  if (s->>'missing')::int > 0 then
    return jsonb_build_object('ok', false, 'error', (s->>'missing') || ' of the ledgers in Tally''s opening balances are not in FinCom yet: bring the ledgers from Tally first.');
  end if;
  if (s->>'pl')::int > 0 then
    return jsonb_build_object('ok', false, 'error', 'Tally''s opening balances change income or expense ledgers: FinCom support applies these.');
  end if;
  if abs((s->>'candidate')::numeric) > 1 then
    return jsonb_build_object('ok', false, 'error', 'Tally''s opening balances do not balance: debit and credit differ by ' || tally_inr((s->>'candidate')::numeric) || ', so FinCom keeps its own.');
  end if;
  if (s->>'n')::int = 0 then
    update tally_openings_held set stage = 'applied', why = 'Used by ' || stamp || ' (Use Tally''s; nothing differed): ' || why, settled_at = now()
     where book_id = p_book and firm_id = f and stage in ('held', 'kept') and why not like 'Dismissed by %' and why not like 'Used by %';
    return jsonb_build_object('ok', true, 'changed', 0);
  end if;
  insert into tally_opening_repairs (book_id, ledger, open_before, open_sent_before, open_after, why)
  select p_book, l.name, l.open, l.open_sent, (x->>'tally')::numeric,
         'Use Tally''s opening balances (held row ' || (s->>'held') || ', dated ' || (s->>'openingsAt') || ') by ' || stamp
    from jsonb_array_elements(s->'rows') x join tally_ledgers l on l.book_id = p_book and l.name = x->>'ledger' and l.deleted_at is null and l.merged_into is null;
  update tally_ledgers l set open = (x->>'tally')::numeric, open_sent = (x->>'tally')::numeric
    from jsonb_array_elements(s->'rows') x where l.book_id = p_book and l.name = x->>'ledger' and l.deleted_at is null and l.merged_into is null;
  get diagnostics n = row_count;
  update tally_openings_held set stage = 'applied', why = 'Used by ' || stamp || ' (Use Tally''s, ' || n || ' opening(s) changed): ' || why, settled_at = now()
   where book_id = p_book and firm_id = f and stage in ('held', 'kept') and why not like 'Dismissed by %' and why not like 'Used by %';
  update tally_books set ledgers_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'changed', n);
end $function$;
revoke all on function public.tally_openings_decide(uuid, text) from public, anon;
grant execute on function public.tally_openings_decide(uuid, text) to authenticated, service_role;

commit;
