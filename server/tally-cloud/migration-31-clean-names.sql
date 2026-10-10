-- One-time clean-up of the names already kept in the cloud copy, finding 4 (02-Oct-2026). NOT RUN YET: for the owner to
-- read first.
--
-- Why: until 02-Oct-2026 the cloud reader (server/tally-cloud/parse.js) decoded "&#13;&#10;" in a day book to two
-- spaces, so "Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)" was kept in the entries as "...Pvt Ltd  (Noida)", beside
-- the master "...Pvt Ltd (Noida)": one ledger under two names. The reader and FinCom now share one rule
-- (server/_shared/names.js): namesClean (entities decoded, line breaks one space, ends trimmed, inner spaces kept, since
-- Tally keeps "Arktos  Control & Instruments" with two and a posting uses Tally's name) and namesKey (also white space
-- collapsed, lower case) for matching. New days and ledger lists arrive clean; this corrects what is already kept.
--
-- Adds only. Nothing is deleted and no table or function of the product is changed:
--   new columns, filled only on a row this changes (null: the row was left as it was):
--     tally_ledgers     raw_name text, before_clean jsonb ({open, merged_into, parent, chain, primary_group} before)
--     tally_groups      raw_name text, before_clean jsonb ({parent} before)
--     tally_vouchers    raw_party text
--     tally_lines       raw_ledger text
--     tally_bills       raw_ledger text
--     tally_ledger_day  raw_ledger text, merged_into text, before_clean jsonb ({amount, dr, cr, n} before)
--   helper functions in pg_temp (gone at the end of the session): nm_decode, nm_clean, nm_key (the same rule as
--   names.js, in SQL) and nm_group.
--
-- What it does, book by book (the ingest functions wait on the same per-book lock, so nothing arrives meanwhile):
--   1. groups: each group takes its clean name. Two groups with one key: the one already clean (else with a parent,
--      else the shortest name) is the group; the other keeps its row and name (a group carries only its parent, and
--      every parent, chain and primary group below is pointed at the one group) - as migration-23.
--   2. ledger masters (the twin convention of migration-9 and migration-23): ledgers with one key are one ledger. The one
--      standing (merged_into null; then already clean, then with a group, then the shortest name) is the ledger: it
--      takes the clean name, the openings of all of them, and a group from a twin if it has none. Each other one keeps
--      its row, its name as Tally sent it and open_sent, opens at nil, and is marked merged_into the ledger.
--   3. the entries' names (tally_lines.ledger, tally_vouchers.party, tally_bills.ledger, tally_ledger_day.ledger): a
--      name whose key is a standing ledger's takes that ledger's name exactly (so "...Pvt Ltd  (Noida)" meets the master
--      "...Pvt Ltd (Noida)", and "Arktos  Control & Instruments" stays as Tally has it); any other name takes its clean
--      name.
--   4. ready day totals (tally_ledger_day, key (book_id, ledger, day)): a row whose name changes is renamed when that
--      name is free on that day; where it is not, its amounts are added into the row of the clean name, and the row
--      stays with its own name, amounts nil, merged_into the clean name, and before_clean holding what it had.
--      (tally_ingest_day builds a day's totals again from its lines whenever the day is sent again.)
--   5. checks: they return rows only when something is wrong, and then the whole change is undone (the last block raises).
--
-- Safe to run twice: a second run finds nothing to change (every name already clean, every twin already merged) and
-- returns no rows. Note: the next ledger list from the bridge rebuilds tally_ledgers from Tally's masters (they arrive
-- cleaned by the same rule), so the ledgers' raw_name / before_clean last until then; the entries' raw_* columns stay
-- until their day is sent again.

begin;

-- the ingest functions take the same lock, so a day or a ledger list arriving meanwhile is read after the clean-up
do $$ begin perform pg_advisory_xact_lock(hashtext(book_id::text)) from public.tally_books order by book_id; end $$;

-- ---------- the rule of server/_shared/names.js, in SQL ----------

-- a numeric entity's text ("13", "x2F") as namesDecode turns it: CR LF a line break, tab and no-break space a space,
-- a printable character itself, anything else a space
create or replace function pg_temp.nm_num(m text) returns text language sql immutable as $$
  select case when c is null then ' ' when c in (10, 13) then E'\n' when c in (9, 160) then ' '
              when c >= 32 and c < 1114112 and not (c between 55296 and 57343) then chr(c) else ' ' end
    from (select case when m ~* '^x[0-9a-f]{1,8}$' then ('x' || lpad(substr(m, 2), 8, '0'))::bit(32)::int
                      when m ~ '^[0-9]{1,9}$' then m::int end as c) q
$$;
-- namesDecode: numeric entities first (also escaped twice, "&amp;#13;"), then the named ones; each pass goes once from
-- left to right, as JavaScript's replace(/.../g): the pieces between the matches, each followed by its match turned
create or replace function pg_temp.nm_decode_num(p text) returns text language sql immutable as $$
  select coalesce(string_agg(t.piece || coalesce(pg_temp.nm_num(m.g[2]), ''), '' order by t.i), '')
    from regexp_split_to_table(coalesce(p, ''), '&(amp;)?#(x[0-9a-f]+|[0-9]+);', 'i') with ordinality t(piece, i)
    left join regexp_matches(coalesce(p, ''), '&(amp;)?#(x[0-9a-f]+|[0-9]+);', 'gi') with ordinality m(g, i) on m.i = t.i
$$;
create or replace function pg_temp.nm_decode_named(p text) returns text language sql immutable as $$
  select coalesce(string_agg(t.piece || coalesce(case lower(m.g[2]) when 'amp' then '&' when 'lt' then '<' when 'gt' then '>'
                   when 'quot' then '"' when 'apos' then '''' when 'nbsp' then ' ' end, ''), '' order by t.i), '')
    from regexp_split_to_table(coalesce(p, ''), '&(amp;)?(amp|lt|gt|quot|apos|nbsp);', 'i') with ordinality t(piece, i)
    left join regexp_matches(coalesce(p, ''), '&(amp;)?(amp|lt|gt|quot|apos|nbsp);', 'gi') with ordinality m(g, i) on m.i = t.i
$$;
create or replace function pg_temp.nm_decode(p text) returns text language sql immutable as $$
  select pg_temp.nm_decode_named(pg_temp.nm_decode_num(p))
$$;
-- namesClean: decoded, each run of line breaks with the spaces and tabs around it one space, the ends trimmed
create or replace function pg_temp.nm_clean(p text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(case when coalesce(p, '') ~ '[&\r\n]' then pg_temp.nm_decode(p) else coalesce(p, '') end,
                        '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'), '^\s+|\s+$', '', 'g')
$$;
-- namesKey: clean, every run of white space one space, lower case
create or replace function pg_temp.nm_key(p text) returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(pg_temp.nm_clean(p), '\s+', ' ', 'g'), '^ | $', '', 'g'))
$$;

-- ---------- the new columns ----------
alter table public.tally_ledgers    add column if not exists raw_name text;
alter table public.tally_ledgers    add column if not exists before_clean jsonb;
alter table public.tally_groups     add column if not exists raw_name text;
alter table public.tally_groups     add column if not exists before_clean jsonb;
alter table public.tally_vouchers   add column if not exists raw_party text;
alter table public.tally_lines      add column if not exists raw_ledger text;
alter table public.tally_bills      add column if not exists raw_ledger text;
alter table public.tally_ledger_day add column if not exists raw_ledger text;
alter table public.tally_ledger_day add column if not exists merged_into text;
alter table public.tally_ledger_day add column if not exists before_clean jsonb;

-- what the checks compare with at the end: each book's totals and row counts now
create temp table nm31_before on commit drop as
select b.book_id,
       (select count(*) from public.tally_ledgers x where x.book_id = b.book_id) as ledgers,
       (select coalesce(sum(open), 0) from public.tally_ledgers x where x.book_id = b.book_id) as open,
       (select count(*) from public.tally_groups x where x.book_id = b.book_id) as groups,
       (select count(*) from public.tally_vouchers x where x.book_id = b.book_id) as vouchers,
       (select count(*) from public.tally_lines x where x.book_id = b.book_id) as lines,
       (select coalesce(sum(amount), 0) from public.tally_lines x where x.book_id = b.book_id) as lines_amount,
       (select count(*) from public.tally_bills x where x.book_id = b.book_id) as bills,
       (select coalesce(sum(amount), 0) from public.tally_bills x where x.book_id = b.book_id) as bills_amount,
       (select count(*) from public.tally_ledger_day x where x.book_id = b.book_id) as days,
       (select coalesce(sum(amount), 0) from public.tally_ledger_day x where x.book_id = b.book_id) as day_amount,
       (select coalesce(sum(dr), 0) from public.tally_ledger_day x where x.book_id = b.book_id) as day_dr,
       (select coalesce(sum(cr), 0) from public.tally_ledger_day x where x.book_id = b.book_id) as day_cr,
       (select coalesce(sum(n), 0) from public.tally_ledger_day x where x.book_id = b.book_id) as day_n
  from public.tally_books b;

-- ---------- 1. groups ----------
create temp table nm31_grp on commit drop as
select g.book_id, g.name, pg_temp.nm_clean(g.name) as nm,
       row_number() over (partition by g.book_id, pg_temp.nm_key(g.name)
                          order by (g.name = pg_temp.nm_clean(g.name)) desc, (g.parent <> '') desc, length(g.name), g.name) as rn
  from public.tally_groups g;
-- the group of each key takes its clean name (free: a group already named so would be the one)
update public.tally_groups t set raw_name = coalesce(t.raw_name, t.name), name = x.nm
  from nm31_grp x
 where t.book_id = x.book_id and t.name = x.name and x.rn = 1 and x.nm <> x.name and x.nm <> ''
   and not exists (select 1 from public.tally_groups o where o.book_id = x.book_id and o.name = x.nm);
-- each key's group, by which parents, chains and primary groups are named
create temp table nm31_gmap on commit drop as
select distinct on (book_id, k) book_id, k, name
  from (select book_id, pg_temp.nm_key(name) as k, name, parent from public.tally_groups) s
 order by book_id, k, (name = pg_temp.nm_clean(name)) desc, (parent <> '') desc, length(name), name;
create index on nm31_gmap (book_id, k);
create or replace function pg_temp.nm_group(p_book uuid, p text) returns text language sql stable as $$
  select case when coalesce(p, '') = '' then coalesce(p, '')
              else coalesce((select g.name from nm31_gmap g where g.book_id = p_book and g.k = pg_temp.nm_key(p)), pg_temp.nm_clean(p)) end
$$;
update public.tally_groups t set before_clean = coalesce(t.before_clean, jsonb_build_object('parent', t.parent)), parent = pg_temp.nm_group(t.book_id, t.parent)
 where t.parent <> pg_temp.nm_group(t.book_id, t.parent);

-- ---------- 2. ledger masters ----------
create temp table nm31_led on commit drop as
with r as (
  select l.book_id, l.name, l.parent, l.chain, l.primary_group, l.open, l.merged_into,
         pg_temp.nm_clean(l.name) as nm, pg_temp.nm_key(l.name) as k,
         row_number() over (partition by l.book_id, pg_temp.nm_key(l.name)
                            order by (l.merged_into is null) desc, (l.name = pg_temp.nm_clean(l.name)) desc, (l.parent <> '') desc, length(l.name), l.name) as rn,
         row_number() over (partition by l.book_id, pg_temp.nm_key(l.name)
                            order by (l.parent <> '') desc, (l.merged_into is null) desc, (l.name = pg_temp.nm_clean(l.name)) desc, length(l.name), l.name) as rp,
         count(*) filter (where l.merged_into is null) over (partition by l.book_id, pg_temp.nm_key(l.name)) as standing,
         sum(l.open) over (partition by l.book_id, pg_temp.nm_key(l.name)) as total
    from public.tally_ledgers l
)
select r.*, first_value(r.parent) over w as g_parent, first_value(r.chain) over w as g_chain, first_value(r.primary_group) over w as g_primary
  from r window w as (partition by r.book_id, r.k order by r.rp);
-- the name each key's ledger ends up with: its clean name when that is free
alter table nm31_led add column head text;
update nm31_led x set head = case when h.nm <> h.name and h.nm <> ''
                                       and not exists (select 1 from public.tally_ledgers o where o.book_id = h.book_id and o.name = h.nm) then h.nm else h.name end
  from nm31_led h where h.book_id = x.book_id and h.k = x.k and h.rn = 1;
create index on nm31_led (book_id, name);

-- 2a. twins standing until now: counted in the ledger from here on (row, name and open_sent kept)
update public.tally_ledgers l
   set before_clean = coalesce(l.before_clean, jsonb_build_object('open', l.open, 'merged_into', l.merged_into)), open = 0, merged_into = x.head
  from nm31_led x
 where l.book_id = x.book_id and l.name = x.name and x.rn > 1 and x.standing > 0 and l.merged_into is null;
-- 2b. the ledger of a key with twins: all their openings, and a group from a twin if it has none
update public.tally_ledgers l
   set before_clean = coalesce(l.before_clean, jsonb_build_object('open', l.open, 'merged_into', l.merged_into, 'parent', l.parent, 'chain', l.chain, 'primary_group', l.primary_group)),
       open = x.total,
       parent = case when l.parent = '' then x.g_parent else l.parent end,
       chain = case when l.parent = '' then x.g_chain else l.chain end,
       primary_group = case when l.parent = '' then x.g_primary else l.primary_group end
  from nm31_led x
 where l.book_id = x.book_id and l.name = x.name and x.rn = 1 and x.standing > 1;
-- 2c. twins merged before (migration-9, migration-23) point at the ledger's name as it ends up
update public.tally_ledgers l
   set before_clean = coalesce(l.before_clean, jsonb_build_object('open', l.open, 'merged_into', l.merged_into)), merged_into = x.head
  from nm31_led x
 where l.book_id = x.book_id and l.name = x.name and x.rn > 1 and x.standing > 0 and l.merged_into is distinct from x.head;
-- 2d. the ledger takes its clean name
update public.tally_ledgers l set raw_name = coalesce(l.raw_name, l.name), name = x.head
  from nm31_led x
 where l.book_id = x.book_id and l.name = x.name and x.rn = 1 and x.standing > 0 and x.head <> x.name;
-- 2e. groups in the ledgers named as the groups are
update public.tally_ledgers l
   set before_clean = coalesce(l.before_clean, jsonb_build_object('parent', l.parent, 'chain', l.chain, 'primary_group', l.primary_group)),
       parent = pg_temp.nm_group(l.book_id, l.parent), primary_group = pg_temp.nm_group(l.book_id, l.primary_group),
       chain = array(select pg_temp.nm_group(l.book_id, c) from unnest(l.chain) with ordinality u(c, i) order by i)
 where l.parent <> pg_temp.nm_group(l.book_id, l.parent) or l.primary_group <> pg_temp.nm_group(l.book_id, l.primary_group)
    or exists (select 1 from unnest(l.chain) c where c <> pg_temp.nm_group(l.book_id, c));

-- ---------- 3. the entries' names ----------
-- each standing ledger by its key, and each name the entries use with the name it takes
create temp table nm31_lkey on commit drop as
select book_id, pg_temp.nm_key(name) as k, min(name) as name
  from public.tally_ledgers where merged_into is null group by 1, 2;
create index on nm31_lkey (book_id, k);
create temp table nm31_names on commit drop as
select s.book_id, s.name, coalesce(k.name, pg_temp.nm_clean(s.name)) as canon
  from (select book_id, ledger as name from public.tally_lines
        union select book_id, party from public.tally_vouchers
        union select book_id, ledger from public.tally_bills
        union select book_id, ledger from public.tally_ledger_day where merged_into is null) s
  left join nm31_lkey k on k.book_id = s.book_id and k.k = pg_temp.nm_key(s.name);
delete from nm31_names where canon = name or canon = '';      -- (the temporary list only)
create index on nm31_names (book_id, name);

update public.tally_lines t set raw_ledger = coalesce(t.raw_ledger, t.ledger), ledger = x.canon
  from nm31_names x where t.book_id = x.book_id and t.ledger = x.name;
update public.tally_vouchers t set raw_party = coalesce(t.raw_party, t.party), party = x.canon
  from nm31_names x where t.book_id = x.book_id and t.party = x.name;
update public.tally_bills t set raw_ledger = coalesce(t.raw_ledger, t.ledger), ledger = x.canon
  from nm31_names x where t.book_id = x.book_id and t.ledger = x.name;

-- ---------- 4. ready day totals ----------
create temp table nm31_day on commit drop as
select d.book_id, d.ledger, d.day, x.canon, d.amount, d.dr, d.cr, d.n,
       -- the row that takes the clean name when no row has it that day: the first by name
       row_number() over (partition by d.book_id, x.canon, d.day order by d.ledger) as rn,
       exists (select 1 from public.tally_ledger_day o where o.book_id = d.book_id and o.ledger = x.canon and o.day = d.day) as taken
  from public.tally_ledger_day d join nm31_names x on x.book_id = d.book_id and x.name = d.ledger
 where d.merged_into is null;
-- 4a. renamed where the clean name is free that day
update public.tally_ledger_day t set raw_ledger = coalesce(t.raw_ledger, t.ledger), ledger = x.canon
  from nm31_day x
 where t.book_id = x.book_id and t.ledger = x.ledger and t.day = x.day and not x.taken and x.rn = 1;
-- 4b. the others: added into the clean name's row ...
update public.tally_ledger_day t
   set before_clean = coalesce(t.before_clean, jsonb_build_object('amount', t.amount, 'dr', t.dr, 'cr', t.cr, 'n', t.n)),
       amount = t.amount + s.amount, dr = t.dr + s.dr, cr = t.cr + s.cr, n = t.n + s.n
  from (select book_id, canon, day, sum(amount) as amount, sum(dr) as dr, sum(cr) as cr, sum(n) as n
          from nm31_day where taken or rn > 1 group by 1, 2, 3) s
 where t.book_id = s.book_id and t.ledger = s.canon and t.day = s.day;
-- ... and kept, with nil amounts, merged into it
update public.tally_ledger_day t
   set before_clean = coalesce(t.before_clean, jsonb_build_object('amount', t.amount, 'dr', t.dr, 'cr', t.cr, 'n', t.n)),
       raw_ledger = coalesce(t.raw_ledger, t.ledger), merged_into = x.canon, amount = 0, dr = 0, cr = 0, n = 0
  from nm31_day x
 where t.book_id = x.book_id and t.ledger = x.ledger and t.day = x.day and (x.taken or x.rn > 1);

-- ---------- 5. checks: rows only when something is wrong ----------
create temp table nm31_problems on commit drop as
-- no ledger under two names: per book, no two standing ledgers with one key
select 'a ledger under two names' as problem, book_id::text as book, string_agg(name, ' | ' order by name) as detail
  from public.tally_ledgers where merged_into is null group by book_id, pg_temp.nm_key(name) having count(*) > 1
union all
select 'a standing ledger whose name is not clean', book_id::text, name from public.tally_ledgers where merged_into is null and name <> pg_temp.nm_clean(name)
union all
select 'a twin merged into no standing ledger', l.book_id::text, l.name || ' -> ' || l.merged_into from public.tally_ledgers l
 where l.merged_into is not null and not exists (select 1 from public.tally_ledgers h where h.book_id = l.book_id and h.name = l.merged_into and h.merged_into is null)
union all
select 'a group under two names', book_id::text, string_agg(name, ' | ' order by name) from public.tally_groups
 where name = pg_temp.nm_clean(name) group by book_id, pg_temp.nm_key(name) having count(*) > 1
union all
select 'a name in the entries not as its ledger has it', s.book_id::text, s.t || ': ' || s.name
  from (select 'lines' as t, book_id, ledger as name from public.tally_lines
        union select 'vouchers', book_id, party from public.tally_vouchers
        union select 'bills', book_id, ledger from public.tally_bills
        union select 'ledger_day', book_id, ledger from public.tally_ledger_day where merged_into is null) s
  left join (select book_id, pg_temp.nm_key(name) as k, min(name) as name from public.tally_ledgers where merged_into is null group by 1, 2) k
    on k.book_id = s.book_id and k.k = pg_temp.nm_key(s.name)
 where s.name <> coalesce(k.name, pg_temp.nm_clean(s.name))
union all
select 'a day total merged into no row', d.book_id::text, d.ledger || ' ' || d.day || ' -> ' || d.merged_into from public.tally_ledger_day d
 where d.merged_into is not null and not exists (select 1 from public.tally_ledger_day o where o.book_id = d.book_id and o.ledger = d.merged_into and o.day = d.day and o.merged_into is null)
union all
-- nothing lost: the same rows and the same sums in every book
select 'rows or sums changed', b.book_id::text, row(b.*)::text || ' / ' || row(a.*)::text
  from nm31_before b
  join (select x.book_id,
               (select count(*) from public.tally_ledgers y where y.book_id = x.book_id) as ledgers,
               (select coalesce(sum(open), 0) from public.tally_ledgers y where y.book_id = x.book_id) as open,
               (select count(*) from public.tally_groups y where y.book_id = x.book_id) as groups,
               (select count(*) from public.tally_vouchers y where y.book_id = x.book_id) as vouchers,
               (select count(*) from public.tally_lines y where y.book_id = x.book_id) as lines,
               (select coalesce(sum(amount), 0) from public.tally_lines y where y.book_id = x.book_id) as lines_amount,
               (select count(*) from public.tally_bills y where y.book_id = x.book_id) as bills,
               (select coalesce(sum(amount), 0) from public.tally_bills y where y.book_id = x.book_id) as bills_amount,
               (select count(*) from public.tally_ledger_day y where y.book_id = x.book_id) as days,
               (select coalesce(sum(amount), 0) from public.tally_ledger_day y where y.book_id = x.book_id) as day_amount,
               (select coalesce(sum(dr), 0) from public.tally_ledger_day y where y.book_id = x.book_id) as day_dr,
               (select coalesce(sum(cr), 0) from public.tally_ledger_day y where y.book_id = x.book_id) as day_cr,
               (select coalesce(sum(n), 0) from public.tally_ledger_day y where y.book_id = x.book_id) as day_n
          from public.tally_books x) a on a.book_id = b.book_id
 where row(b.*)::text <> row(a.*)::text
union all
-- the day totals this touched agree with their lines, as tally_ingest_day builds them
select 'a day total not its lines', q.book_id::text, q.ledger || ' ' || q.day || ': ' || q.kept || ' / ' || q.lines
  from (select d.book_id, d.ledger, d.day, d.amount as kept,
               coalesce((select sum(l.amount) from public.tally_lines l join public.tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
                          where l.book_id = d.book_id and l.ledger = d.ledger and l.day = d.day and not v.cancelled and not v.optional), 0) as lines
          from public.tally_ledger_day d
         where d.merged_into is null and (d.book_id, d.day) in (select book_id, day from nm31_day)) q
 where q.kept <> q.lines;

select * from nm31_problems order by problem, book, detail;
do $$ begin
  if exists (select 1 from nm31_problems) then raise exception 'migration-31: % problem(s), nothing changed (see the rows above)', (select count(*) from nm31_problems); end if;
end $$;

commit;
