-- Migration 88 (14-Oct-2026, branch next-fix-asst-turn; after 87). Staging only until the owner says otherwise.
--
-- Why: the owner asked "balance of air Ess exim" and was told no ledger matched; the ledger is "AIR ESS EXIM PRIVATE
-- LIMITED". asst_match_ledger wanted every typed word inside the name as typed ("air", "ess", "exim" were there, but
-- "Air-Ess Exim Pvt Ltd" was not), and when nothing matched the tool only said so.
--
-- What it adds and changes:
--   1. asst_name_key(text): a name for matching, as the app's supplier key does (src/js/01, supplierKey/norm): lower
--      case, "&" as "and", "M/s" and "Messrs" dropped, punctuation as spaces, the company's suffix dropped (private
--      limited, pvt ltd, pvt., limited, ltd, llp, the), spaces closed up. IMMUTABLE.
--   2. asst_name_sim(a, b): how alike two keys are, 0 to 1 (pairs of letters in common; pg_trgm is not on staging).
--   3. asst_ledger_pick_book(book, text) and asst_ledger_pick(client, text): the ledger for a typed name, in order: the
--      same key; a name the key starts; a name with every typed word in it. One at the first level that has any: that
--      ledger ({ledger, how}); several: {ask: true, choices: up to 5}; none: {choices: the 5 closest names}.
--   4. asst_match_ledger (the book tools' own match) replaced: the same rule, a ledger only when it is the one.
-- All SECURITY INVOKER and STABLE (the name functions IMMUTABLE); asst_ledger_pick finds the book with asst_span (the
-- caller's firm only), and the reads of tally_ledgers are under its row-level security. The new functions are granted to
-- signed-in users and the service role, not to anon. No table, column or row changed; safe to run twice; one transaction (lock_timeout 10 s). Tested: tests/run_assistant_sql.py.
begin;
set local lock_timeout = '10s';

create or replace function public.asst_name_key(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(replace(lower(coalesce(p, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g'),
               '^\s*(m s|messrs)\s+', ' '),
             '\m(private|pvt|limited|ltd|llp|the)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

create or replace function public.asst_name_sim(a text, b text)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  with x as (select array(select substr(a, i, 2) from generate_series(1, greatest(length(a) - 1, 0)) i) ga,
                    array(select substr(b, i, 2) from generate_series(1, greatest(length(b) - 1, 0)) i) gb)
  select case when cardinality(ga) + cardinality(gb) = 0 then 0
              else round(2.0 * (select count(*) from (select unnest(ga) intersect all select unnest(gb)) z) / (cardinality(ga) + cardinality(gb)), 3) end
    from x
$$;

create or replace function public.asst_ledger_pick_book(p_book uuid, p_text text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare k text := asst_name_key(p_text); kc text; ws text[]; lvl int; n int; names jsonb;
begin
  kc := replace(k, ' ', '');
  if p_book is null or kc = '' then return jsonb_build_object('ledger', null, 'ask', false, 'choices', '[]'::jsonb); end if;
  ws := array_remove(regexp_split_to_array(k, ' '), '');
  -- 1 the same key, 2 a name the key starts, 3 a name with the key or every typed word in it
  with l as (select t.name, asst_name_key(t.name) lk from tally_ledgers t where t.book_id = p_book and t.merged_into is null and t.deleted_at is null),
  m as (select l.name, case when replace(l.lk, ' ', '') = kc then 1
                            when replace(l.lk, ' ', '') like kc || '%' then 2
                            when replace(l.lk, ' ', '') like '%' || kc || '%' or not exists (select 1 from unnest(ws) w where position(w in l.lk) = 0) then 3 end lvl
          from l),
  best as (select min(m.lvl) b from m)
  select best.b, (select count(*) from m where m.lvl = best.b),
         (select coalesce(jsonb_agg(z.name order by length(z.name), z.name), '[]'::jsonb) from (select m.name from m where m.lvl = best.b order by length(m.name), m.name limit 5) z)
    into lvl, n, names from best;
  if lvl is not null and n = 1 then
    return jsonb_build_object('ledger', names->>0, 'how', case lvl when 1 then 'same' when 2 then 'starts' else 'contains' end, 'ask', false, 'choices', '[]'::jsonb);
  end if;
  if lvl is not null then return jsonb_build_object('ledger', null, 'ask', true, 'choices', names); end if;
  -- nothing like it by words: the 5 closest names by letters, if any is close
  select coalesce(jsonb_agg(z.name order by z.sim desc, z.name), '[]'::jsonb) into names
    from (select t.name, asst_name_sim(replace(asst_name_key(t.name), ' ', ''), kc) sim from tally_ledgers t
           where t.book_id = p_book and t.merged_into is null and t.deleted_at is null order by 2 desc, 1 limit 5) z where z.sim >= 0.4;
  return jsonb_build_object('ledger', null, 'ask', false, 'choices', names);
end $$;

-- the client's book (asst_span: the caller's firm only), then the pick
create or replace function public.asst_ledger_pick(p_client text, p_text text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare s record;
begin
  select * into s from asst_span(p_client, null, null);
  if s.bk is null then return jsonb_build_object('ledger', null, 'ask', false, 'choices', '[]'::jsonb, 'none', true); end if;
  return asst_ledger_pick_book(s.bk, p_text);
end $$;

-- the book tools' own match: the same rule, a ledger only when it is the one
create or replace function public.asst_match_ledger(p_book uuid, p_text text)
returns text language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select t.name from tally_ledgers t where t.book_id = p_book and t.name = btrim(coalesce(p_text, '')) and t.merged_into is null and t.deleted_at is null),
                  asst_ledger_pick_book(p_book, p_text)->>'ledger')
$$;

grant execute on function public.asst_name_key(text), public.asst_name_sim(text, text), public.asst_ledger_pick_book(uuid, text), public.asst_ledger_pick(text, text) to authenticated, service_role;
revoke execute on function public.asst_name_key(text), public.asst_name_sim(text, text), public.asst_ledger_pick_book(uuid, text), public.asst_ledger_pick(text, text) from public, anon;

commit;
