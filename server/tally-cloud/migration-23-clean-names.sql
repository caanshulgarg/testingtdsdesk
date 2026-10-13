-- Ledger names cleaned once, when they are read in, 02-Oct-2026. Tally keeps some ledger masters with line breaks in the
-- name ("MCS Project Pvt Ltd\r\n", "RAKVIK TECHNOLOGIES PRIVATE LIMITED&#13;&#10;&#13;&#10;"), while the day book names them
-- without. Migration 20 matched the two in tally_tb and tally_ledger only (tally_nm on the
-- fly); tally_mis, tally_period, tally_monthly, tally_gst_summary and tally_tds_summary still compared the names as kept,
-- so a master's opening and its entries were two ledgers there (Reports' "Owed to you" at 31-Mar-2026 short: the openings
-- of MCS Project Pvt Ltd, 6,000 Cr, and RAKVIK TECHNOLOGIES PRIVATE LIMITED, 17,550 Dr, met none of their entries).
--
-- Now every name is kept clean (tally_nm: each run of &#13; &#10; CR LF, with the spaces around it, becomes one space, and
-- the ends are trimmed; other spaces stay as they are: Tally keeps "Arktos  Control & Instruments" with two spaces, and a
-- posting must use Tally's exact name). tally_nm is defined again here with the body of migration-20:
--   1. on the way in: tally_ingest_day (entry lines, the entry's party, bill-wise lines), tally_ingest_ledgers (masters
--      and their groups) and tally_ingest_ledgers_g (Tally's groups and their parents) store tally_nm(name). The cloud
--      function (index.ts) cleans the same way before it sends (and for the groups call, which writes the tables itself).
--      Two masters that come in under one clean name are one ledger: their openings are added (as tally_year_openings
--      did for twins: the head's opening is the sum of what Tally sent for each).
--   2. the rows already kept are corrected below. Nothing is deleted except the ready day totals of the days touched
--      (tally_ledger_day is a cache of tally_lines that tally_ingest_day itself throws away and builds again for every day
--      it reads; it is built again here the same way, from the corrected lines).
--   3. the report functions are unchanged: they meet on the name columns only, which are now clean. Two functions that
--      take a ledger name from FinCom (tally_vouchers_in's p_ledger, and the ledger map read by tally_led_kinds for the
--      TDS and GST summaries) clean that name too, so a name FinCom kept with a line break still meets the clean copy.
-- Grants stay as they are (create or replace keeps them).

begin;

-- the ingest functions wait for this, so a day book or ledger list arriving meanwhile is read after the correction
select pg_advisory_xact_lock(hashtext(book_id::text)) from public.tally_books order by book_id;

-- ---------- 1. clean on the way in ----------

-- the same body as migration-20 (line breaks only; other spaces kept)
create or replace function public.tally_nm(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(p, ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
$$;


create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare touched date[]; f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x)
  ) q;
  delete from tally_bills b where b.book_id = p_book and (b.day = p_day or b.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_lines l where l.book_id = p_book and (l.day = p_day or l.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  delete from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid in (select x->>'guid' from jsonb_array_elements(p_vouchers) x));
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin)
  select distinct on (x->>'guid') p_book, f, x->>'guid', p_day, coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15)
    from jsonb_array_elements(p_vouchers) x
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc;
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric from jsonb_array_elements(p_lines) x;
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, p_day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then p_day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then p_day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x, jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where coalesce(b->>2, '') <> '';
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
end $function$;

-- the masters: [name, parent, opening]. The same name sent twice is taken once (as before); two names that are one once
-- cleaned are one ledger, their openings added, under the group of the one that has a group (the one already clean first)
create or replace function public.tally_ingest_ledgers(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare f uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  update tally_books set from_date = p_from, open_as_on = p_open_as_on, ledgers_at = now() where book_id = p_book;
  delete from tally_lines where book_id = p_book and day < p_from;
  delete from tally_vouchers where book_id = p_book and day < p_from;
  delete from tally_ledger_day where book_id = p_book and day < p_from;
  delete from tally_days where book_id = p_book and day < p_from;
  delete from tally_ledgers where book_id = p_book;
  insert into tally_ledgers (book_id, firm_id, name, parent, open)
  select p_book, f, nm,
         coalesce((array_agg(par order by (raw = nm) desc, raw) filter (where par <> ''))[1], ''),
         sum(op)
    from (select distinct on (x->>0) x->>0 as raw, tally_nm(x->>0) as nm, tally_nm(x->>1) as par, coalesce(nullif(x->>2, '')::numeric, 0) as op
            from jsonb_array_elements(p_ledgers) x order by x->>0) s
   where nm <> ''
   group by nm;
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers));
end $function$;

create or replace function public.tally_ingest_ledgers_g(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_groups jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare f uuid; n_groups int := 0; yo jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform public.tally_ingest_ledgers(p_book, p_from, p_open_as_on, p_ledgers);
  if jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) > 0 then
    delete from tally_groups where book_id = p_book;
    insert into tally_groups (book_id, firm_id, name, parent)
    select distinct on (tally_nm(x->>0)) p_book, f, tally_nm(x->>0), tally_nm(x->>1) from jsonb_array_elements(p_groups) x where tally_nm(x->>0) <> ''
     order by tally_nm(x->>0), (tally_nm(x->>1) <> '') desc, (x->>0 = tally_nm(x->>0)) desc
    on conflict (book_id, name) do update set parent = excluded.parent;
    get diagnostics n_groups = row_count;
  end if;
  with recursive up as (
    select l.name as ledger, l.parent as grp, 1 as depth, array[l.parent] as chain
      from tally_ledgers l where l.book_id = p_book and l.parent <> ''
    union all
    select u.ledger, g.parent, u.depth + 1, u.chain || g.parent
      from up u join tally_groups g on g.book_id = p_book and g.name = u.grp
     where g.parent <> '' and u.depth < 30 and not (g.parent = any(u.chain))
  ), best as (
    select distinct on (ledger) ledger, chain from up order by ledger, depth desc
  )
  update tally_ledgers l set chain = b.chain, primary_group = b.chain[array_length(b.chain, 1)]
    from best b where l.book_id = p_book and l.name = b.ledger;
  yo := public.tally_year_openings(p_book);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(p_ledgers), 'groups', n_groups, 'yearOpenings', yo);
end $function$;

-- names that come from FinCom (its ledger map, a ledger asked for) cleaned the same way, so they meet the clean copy
create or replace function public.tally_led_kinds(p_client text)
 returns table(ledger text, kind text, side text, tax text, what text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- a ledger not confirmed yet carries FinCom's guess without "what": its kind says it (reverse charge when marked so)
  select tally_nm(substr(i.item, 2)), coalesce(i.data->>'kind', ''), coalesce(i.data->>'side', ''), coalesce(i.data->>'tax', ''),
         coalesce(nullif(i.data->>'what', ''), case when i.data->>'kind' = 'gst' and coalesce(i.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(i.data->>'kind', '') end)
    from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted;
$function$;

create or replace function public.tally_vouchers_in(p_client text, p_from date, p_to date, p_ledger text default null::text, p_types text[] default null::text[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with bk as (select tally_pick(p_client, p_to) b),
  v as (select v.* from tally_vouchers v, bk where v.book_id = bk.b and v.day between p_from and p_to
          and (p_types is null or v.vtype = any(p_types))
          and (p_ledger is null or exists (select 1 from tally_lines l where l.book_id = v.book_id and l.guid = v.guid and l.ledger = tally_nm(p_ledger)))
        order by v.day, v.vno limit 20000)
  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(v.day, 'YYYYMMDD'), 'type', v.vtype, 'number', v.vno, 'party', v.party, 'narration', v.narration, 'guid', v.guid,
      'optional', case when v.optional then 'Yes' else 'No' end, 'cancelled', case when v.cancelled then 'Yes' else 'No' end,
      'reference', v.ref, 'referenceDate', coalesce(to_char(v.ref_date, 'YYYYMMDD'), ''), 'cmpGstin', v.cmp_gstin, 'gstin', v.gstin,
      'entries', (select coalesce(jsonb_agg(jsonb_build_object('ledger', l.ledger, 'amount', l.amount::text)), '[]'::jsonb) from tally_lines l where l.book_id = v.book_id and l.guid = v.guid))
    order by v.day, v.vno), '[]'::jsonb) from v;
$function$;

-- ---------- 2. the rows already kept ----------

-- 2a. groups: renamed to the clean name, parents cleaned. Where two groups would take one clean name (none on staging,
-- 02-Oct-2026) the one already clean (else the first) takes it and the other keeps its name: a group carries only its
-- parent, and every ledger and group now points at the clean one
with g as (
  select book_id, name, tally_nm(name) as nm,
         row_number() over (partition by book_id, tally_nm(name) order by (name = tally_nm(name)) desc, (parent <> '') desc, name) as rn
    from public.tally_groups
)
update public.tally_groups t set name = case when g.rn = 1 then g.nm else t.name end, parent = tally_nm(t.parent)
  from g where t.book_id = g.book_id and t.name = g.name
   and (t.parent <> tally_nm(t.parent) or (g.rn = 1 and t.name <> g.nm));

-- 2b. ledger masters. Each clean name keeps one master standing (merged_into null), as tally_year_openings keeps one
-- head for twins: the master already named clean if there is one, else the one standing now. It takes the clean name,
-- the opening of all the masters of that name (the sum of their openings as kept: the head already holds its twins' after
-- tally_year_openings, else each holds its own), and a group from the others if it has none. The others stay as rows,
-- under the names Tally sent, with no opening and merged_into the clean name (the twin convention of migration 9): no
-- master is deleted, and open_sent (what Tally sent for each) is untouched, so tally_year_openings, run again on the next
-- ledger list, works the same figures out.
create temp table nm_led on commit drop as
with r as (
  select l.book_id, l.name, tally_nm(l.name) as nm, l.parent, l.chain, l.primary_group, l.open,
         row_number() over (partition by l.book_id, tally_nm(l.name) order by (l.name = tally_nm(l.name)) desc, (l.merged_into is null) desc, (l.parent <> '') desc, l.name) as rn,
         row_number() over (partition by l.book_id, tally_nm(l.name) order by (l.parent <> '') desc, (l.merged_into is null) desc, (l.name = tally_nm(l.name)) desc, l.name) as rp
    from public.tally_ledgers l
   where (l.book_id, tally_nm(l.name)) in (select book_id, tally_nm(name) from public.tally_ledgers where name <> tally_nm(name))
)
select r.*, sum(r.open) over (partition by r.book_id, r.nm) as total,
       first_value(r.parent) over w as g_parent, first_value(r.chain) over w as g_chain, first_value(r.primary_group) over w as g_primary
  from r window w as (partition by r.book_id, r.nm order by r.rp);

update public.tally_ledgers l
   set open = case when x.rn = 1 then x.total else 0 end,
       merged_into = case when x.rn = 1 then null else x.nm end,
       parent = case when x.rn = 1 and l.parent = '' then x.g_parent else l.parent end,
       chain = case when x.rn = 1 and l.parent = '' then x.g_chain else l.chain end,
       primary_group = case when x.rn = 1 and l.parent = '' then x.g_primary else l.primary_group end
  from nm_led x where l.book_id = x.book_id and l.name = x.name;
-- the standing master takes the clean name (free: a master already named so would be the standing one)
update public.tally_ledgers l set name = x.nm from nm_led x where l.book_id = x.book_id and l.name = x.name and x.rn = 1 and x.name <> x.nm;
-- every twin points at the clean name; groups in the ledgers cleaned as the groups were
update public.tally_ledgers set merged_into = tally_nm(merged_into) where merged_into is not null and merged_into <> tally_nm(merged_into);
update public.tally_ledgers set parent = tally_nm(parent), primary_group = tally_nm(primary_group),
       chain = array(select tally_nm(c) from unnest(chain) with ordinality u(c, i) order by i)
 where parent <> tally_nm(parent) or primary_group <> tally_nm(primary_group) or exists (select 1 from unnest(chain) c where c <> tally_nm(c));

-- 2c. entries. The days whose ready totals hold a name to clean are noted first; then the lines, the entries' parties and
-- the bill-wise lines are cleaned (no key on these names); then those days' totals are built again from the lines,
-- exactly as tally_ingest_day builds them (two names that are now one become one row, their amounts added)
create temp table nm_days on commit drop as
  select distinct book_id, day from public.tally_ledger_day where ledger <> tally_nm(ledger)
  union select distinct book_id, day from public.tally_lines where ledger <> tally_nm(ledger);

update public.tally_lines set ledger = tally_nm(ledger) where ledger <> tally_nm(ledger);
update public.tally_vouchers set party = tally_nm(party) where party <> tally_nm(party);
update public.tally_bills set ledger = tally_nm(ledger) where ledger <> tally_nm(ledger);

delete from public.tally_ledger_day t using nm_days d where t.book_id = d.book_id and t.day = d.day;
insert into public.tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
select l.book_id, b.firm_id, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
  from public.tally_lines l join nm_days d on d.book_id = l.book_id and d.day = l.day
  join public.tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
  join public.tally_books b on b.book_id = l.book_id
 where not v.cancelled and not v.optional
 group by l.book_id, b.firm_id, l.ledger, l.day;

-- what is left to clean: all nought
select 'ledgers' as t, count(*) filter (where name <> tally_nm(name) and merged_into is null) as unclean from public.tally_ledgers
union all select 'ledger_day', count(*) filter (where ledger <> tally_nm(ledger)) from public.tally_ledger_day
union all select 'lines', count(*) filter (where ledger <> tally_nm(ledger)) from public.tally_lines
union all select 'vouchers', count(*) filter (where party <> tally_nm(party)) from public.tally_vouchers
union all select 'bills', count(*) filter (where ledger <> tally_nm(ledger)) from public.tally_bills;

commit;
