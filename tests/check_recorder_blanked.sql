-- tests/check_recorder_blanked.sql - READ-ONLY: the entries of one book whose fields a recorder line (FinCom Bridge 2.3.0, before
-- migration 56) blanked and an earlier version row still has: gstin, pos, ref, ref_date, cmp_gstin; a line's hsn / rate.
-- The same rules as migration 56's tally_recorder_blanked / tally_recorder_restore_fields (this text is that function's query
-- with p_book replaced): a live entry the recorder applied (tally_recorder_lines: state 'applied', event created / altered /
-- imported); the field blank now; the latest version row at or below its AlterID that has it; every later version row one the
-- recorder applied; no Day Book read of the entry's day after the recorder's last apply; gstin / pos / ref / ref_date only
-- from a version of the same party; lines paired by tally_recorder_pair_lines's rule (its query inlined here, so this runs before 56 too). Only SELECTs.
--   psql -v book=<book uuid> -f tests/check_recorder_blanked.sql
with rec as (
    -- the entries the recorder applied: the AlterIDs it applied and when it last did
    select r.object_guid as g, array_agg(distinct r.alter_id) filter (where r.alter_id is not null) as alters, max(r.alter_id) as max_alter, max(r.applied_at) as last_at,
           -- an entry a recorder line brought marked complete ("full", 2.3.1 part A): its blanks are real, never restored
           bool_or(exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.body->'vouchers') = 'array' then r.body->'vouchers' else '[]'::jsonb end) x
                            where jsonb_typeof(x) = 'object' and x->>'guid' = r.object_guid and lower(coalesce(x->>'full', '')) = 'true')) as full_any
      from tally_recorder_lines r
     where r.book_id = (:'book')::uuid and r.state = 'applied' and r.event in ('created', 'altered', 'imported') and r.object_guid is not null
     group by r.object_guid
  ), ent as (
    select v.*, rec.alters, rec.max_alter
      from tally_vouchers v join rec on rec.g = v.guid
     where v.book_id = (:'book')::uuid and v.deleted_at is null and not rec.full_any
       -- a Day Book read of the entry's day after the recorder's last apply is authoritative: nothing restored
       and not exists (select 1 from tally_days d where d.book_id = v.book_id and d.day = v.day and d.at > rec.last_at)
  ), fld as (
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, e.party, k.f, coalesce(to_jsonb(e)->>k.f, '') as now_v, e.alters, e.max_alter
      from ent e cross join (values ('gstin'), ('pos'), ('ref'), ('ref_date'), ('cmp_gstin')) as k(f)
     where btrim(coalesce(to_jsonb(e)->>k.f, '')) = ''
  ), fsrc as (
    select f.*, s.payload->>f.f as src_v, s.alter_id as src_alter
      from fld f
      join lateral (select ver.payload, ver.alter_id from tally_voucher_versions ver
                     where ver.book_id = (:'book')::uuid and ver.tally_guid = f.guid and ver.alter_id <= coalesce(f.alter_id, 0)
                       and btrim(coalesce(ver.payload->>f.f, '')) <> ''
                       and (f.f = 'cmp_gstin' or (ver.payload->>'party') is not distinct from f.party)
                     order by ver.alter_id desc limit 1) s on true
  ), lns as (
    -- the entries' current lines (no order column exists: by amount, the row handle among equal ones)
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, l.ledger, l.amount, l.hsn, l.rate, l.ctid as at_, e.alters, e.max_alter,
           row_number() over (partition by l.guid, l.ledger order by l.amount, l.ctid) as o     -- by amount, as the stored side
      from ent e join tally_lines l on l.book_id = (:'book')::uuid and l.guid = e.guid
  ), grp as (
    select n.guid, n.ledger, max(n.alter_id) as alter_id,
           jsonb_agg(jsonb_build_object('k', n.at_::text, 'g', n.guid, 'l', n.ledger, 'amt', n.amount::text, 'o', n.o)) as sent
      from lns n group by n.guid, n.ledger
    having bool_or(btrim(coalesce(n.hsn, '')) = '' or n.rate is null)
  ), gsrc as (
    -- the latest version at or below the entry's AlterID holding an HSN or a rate for this ledger, its lines of the ledger
    select g.guid, g.ledger, g.sent, s.alter_id as src_alter, s.stored
      from grp g
      join lateral (
        select ver.alter_id,
               (select jsonb_agg(jsonb_build_object('g', g.guid, 'l', g.ledger, 'amt', z.el->>1, 'o', z.ord, 'hsn', z.el->>2, 'rate', z.el->>3) order by z.ord)
                  from jsonb_array_elements(ver.lines) with ordinality as z(el, ord) where jsonb_typeof(z.el) = 'array' and z.el->>0 = g.ledger) as stored
          from tally_voucher_versions ver
         where ver.book_id = (:'book')::uuid and ver.tally_guid = g.guid and ver.alter_id <= coalesce(g.alter_id, 0) and jsonb_typeof(ver.lines) = 'array'
           and exists (select 1 from jsonb_array_elements(ver.lines) el where jsonb_typeof(el) = 'array' and el->>0 = g.ledger
                         and (btrim(coalesce(el->>2, '')) <> '' or coalesce(el->>3, '') ~ '^-?[0-9]+(\.[0-9]+)?$'))
         order by ver.alter_id desc limit 1) s on true
  ), lpair as (
    select gs.guid, gs.ledger, gs.src_alter, pl.k, pl.hsn as p_hsn, pl.rate as p_rate
      from gsrc gs cross join lateral (
  with a as (
    select e->>'k' as k, e->>'g' as g, e->>'l' as l, case when coalesce(e->>'amt', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e->>'amt')::numeric end as amt, coalesce((e->>'o')::numeric, n) as o
      from jsonb_array_elements(case when jsonb_typeof(gs.sent) = 'array' then gs.sent else '[]'::jsonb end) with ordinality as z(e, n)
  ), b as (
    select n as bid, e->>'g' as g, e->>'l' as l, case when coalesce(e->>'amt', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e->>'amt')::numeric end as amt, coalesce((e->>'o')::numeric, n) as o,
           nullif(btrim(coalesce(e->>'hsn', '')), '') as hsn, case when coalesce(e->>'rate', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e->>'rate')::numeric end as rate
      from jsonb_array_elements(case when jsonb_typeof(gs.stored) = 'array' then gs.stored else '[]'::jsonb end) with ordinality as z(e, n)
  ), nb as (
    select b.g, b.l, min(b.bid) as b0, array_agg(b.amt order by b.amt nulls last) as amts,
           (count(distinct coalesce(b.hsn, '')) = 1 and count(distinct b.rate) + (case when bool_or(b.rate is null) then 1 else 0 end) = 1) as uniform
      from b group by b.g, b.l
  ), na as (
    select a.g, a.l, array_agg(a.amt order by a.amt nulls last) as amts from a group by a.g, a.l
  ), uni as (            -- a) one HSN and one rate on every stored line of the ledger
    select a.k, b.hsn, b.rate from a join nb on nb.g = a.g and nb.l = a.l and nb.uniform join b on b.bid = nb.b0
  ), same as (           -- b) the same amounts, as many times each
    select na.g, na.l from na join nb on nb.g = na.g and nb.l = na.l where not nb.uniform and na.amts is not distinct from nb.amts
  ), ea as (select a.*, row_number() over (partition by a.g, a.l, a.amt order by a.o, a.k) as r from a join same s on s.g = a.g and s.l = a.l
  ), eb as (select b.*, row_number() over (partition by b.g, b.l, b.amt order by b.o, b.bid) as r from b join same s on s.g = b.g and s.l = b.l
  ), m as (select ea.k, eb.hsn, eb.rate from ea join eb on eb.g = ea.g and eb.l = ea.l and eb.amt = ea.amt and eb.r = ea.r)
  select uni.k, uni.hsn, uni.rate from uni union all select m.k, m.hsn, m.rate from m       -- c) nothing else
      ) pl
  ), lsrc as (
    select n.guid, n.vtype, n.vno, n.day, n.alter_id, k.f, n.ledger, n.amount,
           coalesce(case when k.f = 'hsn' then n.hsn else n.rate::text end, '') as now_v,
           case when k.f = 'hsn' then p.p_hsn else p.p_rate::text end as src_v, p.src_alter, n.at_, n.alters, n.max_alter
      from lns n join lpair p on p.guid = n.guid and p.ledger = n.ledger and p.k = n.at_::text
      cross join (values ('hsn'), ('rate')) as k(f)
     where (k.f = 'hsn' and btrim(coalesce(n.hsn, '')) = '' and btrim(coalesce(p.p_hsn, '')) <> '')
        or (k.f = 'rate' and n.rate is null and p.p_rate is not null)
  ), allf as (
    select x.guid, x.vtype, x.vno, x.day, x.alter_id, x.f, null::text as ledger, null::numeric as amount, x.now_v, x.src_v, x.src_alter, null::tid as at_, x.alters, x.max_alter from fsrc x
    union all
    select y.guid, y.vtype, y.vno, y.day, y.alter_id, y.f, y.ledger, y.amount, y.now_v, y.src_v, y.src_alter, y.at_, y.alters, y.max_alter from lsrc y
  )
  select a.guid, a.vtype, a.vno, a.day, a.alter_id, a.f as field, a.ledger, a.amount, a.now_v as now_value, a.src_v as earlier_value, a.src_alter as from_alter
    from allf a
   -- the recorder applied at or after the version that had it, and every later version row is one the recorder applied
   where a.max_alter >= a.src_alter
     and not exists (select 1 from tally_voucher_versions w where w.book_id = (:'book')::uuid and w.tally_guid = a.guid
                        and w.alter_id > a.src_alter and w.alter_id <= coalesce(a.alter_id, 0) and not (w.alter_id = any(coalesce(a.alters, '{}'))))
   order by a.day, a.vno, a.guid, a.f, a.ledger, a.amount;
