-- tests/check_recorder_blanked.sql - READ-ONLY: the entries of one book whose fields a recorder line (FinCom Bridge 2.3.0, before
-- migration 56) blanked and an earlier version row still has: gstin, pos, ref, ref_date, cmp_gstin; a line's hsn / rate.
-- The same rules as migration 56's tally_recorder_blanked / tally_recorder_restore_fields (this text is that function's query
-- with p_book replaced): a live entry the recorder applied (tally_recorder_lines: state 'applied', event created / altered /
-- imported); the field blank now; the latest version row at or below its AlterID that has it; every later version row one the
-- recorder applied; no Day Book read of the entry's day after the recorder's last apply. Only SELECTs; runs before 56 too.
--   psql -v book=<book uuid> -f tests/check_recorder_blanked.sql
with rec as (
    -- the entries the recorder applied: the AlterIDs it applied and when it last did
    select r.object_guid as g, array_agg(distinct r.alter_id) filter (where r.alter_id is not null) as alters, max(r.alter_id) as max_alter, max(r.applied_at) as last_at
      from tally_recorder_lines r
     where r.book_id = (:'book')::uuid and r.state = 'applied' and r.event in ('created', 'altered', 'imported') and r.object_guid is not null
     group by r.object_guid
  ), ent as (
    select v.*, rec.alters, rec.max_alter
      from tally_vouchers v join rec on rec.g = v.guid
     where v.book_id = (:'book')::uuid and v.deleted_at is null
       -- a Day Book read of the entry's day after the recorder's last apply is authoritative: nothing restored
       and not exists (select 1 from tally_days d where d.book_id = v.book_id and d.day = v.day and d.at > rec.last_at)
  ), fld as (
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, k.f, coalesce(to_jsonb(e)->>k.f, '') as now_v, e.alters, e.max_alter
      from ent e cross join (values ('gstin'), ('pos'), ('ref'), ('ref_date'), ('cmp_gstin')) as k(f)
     where btrim(coalesce(to_jsonb(e)->>k.f, '')) = ''
  ), fsrc as (
    select f.*, s.payload->>f.f as src_v, s.alter_id as src_alter
      from fld f
      join lateral (select ver.payload, ver.alter_id from tally_voucher_versions ver
                     where ver.book_id = (:'book')::uuid and ver.tally_guid = f.guid and ver.alter_id <= coalesce(f.alter_id, 0)
                       and btrim(coalesce(ver.payload->>f.f, '')) <> ''
                     order by ver.alter_id desc limit 1) s on true
  ), lns as (
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, l.ledger, l.amount, l.hsn, l.rate, l.ctid as at_,
           row_number() over (partition by l.guid, l.ledger order by l.amount, l.ctid) as rk, e.alters, e.max_alter
      from ent e join tally_lines l on l.book_id = (:'book')::uuid and l.guid = e.guid
  ), lfld as (
    select n.*, k.f from lns n cross join (values ('hsn'), ('rate')) as k(f)
     where (k.f = 'hsn' and btrim(coalesce(n.hsn, '')) = '') or (k.f = 'rate' and n.rate is null)
  ), lsrc as (
    select n.*, s.v as src_v, s.alter_id as src_alter
      from lfld n
      join lateral (
        select case when n.f = 'hsn' then z.el->>2 else z.el->>3 end as v, ver.alter_id
          from tally_voucher_versions ver
          cross join lateral (select el, row_number() over (order by case when el->>1 ~ '^-?[0-9]+(\.[0-9]+)?$' then (el->>1)::numeric end, ord) as rk
                                from jsonb_array_elements(case when jsonb_typeof(ver.lines) = 'array' then ver.lines else '[]'::jsonb end) with ordinality as w(el, ord)
                               where jsonb_typeof(el) = 'array' and el->>0 = n.ledger) z
         where ver.book_id = (:'book')::uuid and ver.tally_guid = n.guid and ver.alter_id <= coalesce(n.alter_id, 0)
           and btrim(coalesce(case when n.f = 'hsn' then z.el->>2 else z.el->>3 end, '')) <> ''
         order by ver.alter_id desc, (z.el->>1 = n.amount::text or (case when z.el->>1 ~ '^-?[0-9]+(\.[0-9]+)?$' then (z.el->>1)::numeric end) = n.amount) desc, abs(z.rk - n.rk), z.rk
         limit 1) s on true
  ), allf as (
    select x.guid, x.vtype, x.vno, x.day, x.alter_id, x.f, null::text as ledger, null::numeric as amount, x.now_v, x.src_v, x.src_alter, null::tid as at_, x.alters, x.max_alter from fsrc x
    union all
    select y.guid, y.vtype, y.vno, y.day, y.alter_id, y.f, y.ledger, y.amount, coalesce(case when y.f = 'hsn' then y.hsn else y.rate::text end, ''), y.src_v, y.src_alter, y.at_, y.alters, y.max_alter from lsrc y
  )
  select a.guid, a.vtype, a.vno, a.day, a.alter_id, a.f as field, a.ledger, a.amount, a.now_v as now_value, a.src_v as earlier_value, a.src_alter as from_alter
    from allf a
   -- the recorder applied at or after the version that had it, and every later version row is one the recorder applied
   where a.max_alter >= a.src_alter
     and not exists (select 1 from tally_voucher_versions w where w.book_id = (:'book')::uuid and w.tally_guid = a.guid
                        and w.alter_id > a.src_alter and w.alter_id <= coalesce(a.alter_id, 0) and not (w.alter_id = any(coalesce(a.alters, '{}'))))
   order by a.day, a.vno, a.guid, a.f, a.ledger;
