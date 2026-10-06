"""python3 tests/tools/mk57/mk57.py [sql dir] [out file] - builds server/tally-cloud/migration-57-entry-details.sql.
Migration 57 carries three function texts from earlier migrations with only the changes said: 56's 5-argument
tally_ingest_entries, 44's 8-argument tally_ingest_day and 50's tally_ingest_delete. They are copied here byte for byte
from the migration files (each change asserted to apply exactly once), with m57-head.sql (the header comment) and
m57-body.sql (the tables, columns, RLS and tally_ingest_details). Re-run it whenever 44, 50 or 56 change; run_migration57.py
checks the carried texts against the files."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "..", "server", "tally-cloud")
if len(sys.argv) < 3: sys.argv = [sys.argv[0], D, os.path.join(D, "migration-57-entry-details.sql")]
def rd(f): return open(os.path.join(D, f)).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
m44, m50, m56 = rd("migration-44-recorder.sql"), rd("migration-50-recorder-held.sql"), rd("migration-56-keep-fields.sql")
DAY = block(m44, "create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)",
            "grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;")
OLDCALL = "  ent := tally_ingest_entries(p_book, (select coalesce(jsonb_agg(x || jsonb_build_object('day', p_day) order by o), '[]'::jsonb) from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines);"
assert DAY.count(OLDCALL) == 1
DAY = DAY.replace(OLDCALL, "  ent := tally_ingest_entries(p_book, (select coalesce(jsonb_agg(x || jsonb_build_object('day', p_day) order by o), '[]'::jsonb) from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines, true, false);     -- 57: the entry path with the entry's details (the Day Book: authoritative, p_keep false)")
DEL = block(m50, "create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)",
            "grant execute on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) to service_role;")
OLDNF = """  if not found then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'action', act, 'unknown', true,
      'why', 'the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for its date is uploaded');     -- 50: what releases it
  end if;"""
assert DEL.count(OLDNF) == 1
DEL = DEL.replace(OLDNF, """  if not found then
    -- 57 (the owner's decision of 06-Oct-2026): a delete or cancel of an entry never in FinCom's copy settles by itself (the line
    -- kept, with these words): nothing is removed and nothing is waited for. A later Day Book cannot undo it: an entry body
    -- that brings this GUID later is deleted (cancelled) again at once (tally_ingest_entries, 5 arguments; and 50's day release)
    -- 57 (the owner's review of 06-Oct-2026): the settle recorded (tally_nothing_removed: its AlterID when it had one); a
    -- cancel without one is re-applied at most once unless the bridge sent Tally's voucher counter (re-review M-B)
    insert into tally_nothing_removed (book_id, guid, event, bound)
    values (p_book, g, case when p_cancel then 'cancelled' else 'deleted' end, p_alter)
    on conflict (book_id, guid, event) do update set bound = greatest(tally_nothing_removed.bound, excluded.bound), settled_at = now();
    return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'action', act, 'unknown', true, 'settled', true,
      'why', 'nothing to remove: the entry is not in FinCom''s copy and no longer counts in Tally');
  end if;""")
ENT = block(m56, "create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean, p_keep boolean)",
            "revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean) from public, anon, authenticated, service_role;")
OLDENT_DECL = "declare vs jsonb := p_vouchers; ls jsonb := p_lines;"
OLDENT_RET = "  return tally_ingest_entries(p_book, vs, ls, p_rebuild);\nend $function$;"
assert ENT.count(OLDENT_DECL) == 1 and ENT.count(OLDENT_RET) == 1
ENT = ENT.replace(OLDENT_DECL, "declare vs jsonb := p_vouchers; ls jsonb := p_lines; res jsonb; sent text[]; x record; nr int;     -- 57: res, sent, x, nr")
ENT = ENT.replace(OLDENT_RET, """  res := tally_ingest_entries(p_book, vs, ls, p_rebuild);
  -- 57: the entry's details (bridge 2.3.1 part A), written for both paths here; nothing when the entries were not stored (a
  -- locked month)
  if coalesce((res->>'ok')::boolean, false) then
    perform tally_ingest_details(p_book, vs, coalesce(p_keep, false));
    -- 57: a later entry body (a Day Book, or another computer's line) cannot undo a delete or cancel already received: an
    -- applied delete (cancel) of the entry above the body's AlterID is applied again. One settled as "nothing to remove"
    -- without an AlterID (the owner's review and re-review M-B of 06-Oct-2026): a DELETE is applied again to any body of its
    -- GUID (Tally never brings a deleted voucher's GUID back); a CANCEL (the voucher still exists and can be altered) only to
    -- a body at or below Tally's voucher counter (ALTVCHID) at the time of the cancel, which the bridge sends on the line
    -- (payload vchCounter, read with FinComCompany): one above it is a later change in Tally, applied and never touched by
    -- that line again; with no counter, at most once (tally_nothing_removed.reapplied)
    select coalesce(array_agg(distinct y->>'guid'), '{}') into sent from jsonb_array_elements(vs) y where coalesce(y->>'guid', '') <> '';
    for x in select v.guid, l.event, max(l.alter_id) as alt, max(coalesce(v.alter_id, 0)) as valt,
                    bool_or(coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)) as above,
                    max(case when l.alter_id is null and coalesce(l.payload->>'vchCounter', '') ~ '^[0-9]{1,15}$' then (l.payload->>'vchCounter')::bigint end) as vcc from tally_vouchers v
               join tally_recorder_lines l on l.book_id = p_book and l.object_guid = v.guid and l.state = 'applied' and l.event in ('deleted', 'cancelled')
              where v.book_id = p_book and v.guid = any(sent) and v.deleted_at is null and (l.event = 'deleted' or not v.cancelled)
                and (coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0) or (l.alter_id is null and coalesce(l.held_why, '') like 'nothing to remove%'))
              group by v.guid, l.event order by v.guid, l.event
    loop
      if not x.above and x.event = 'cancelled' then
        if x.vcc is not null then
          if x.valt > x.vcc then continue; end if;     -- a later change in Tally than the cancel: left live
        else
          select n.reapplied into nr from tally_nothing_removed n where n.book_id = p_book and n.guid = x.guid and n.event = x.event for update;
          if not found then
            insert into tally_nothing_removed (book_id, guid, event, bound, reapplied) values (p_book, x.guid, x.event, null, 0) on conflict do nothing;
            nr := 0;
          end if;
          if nr > 0 then continue; end if;     -- no counter: at most once
          update tally_nothing_removed set reapplied = reapplied + 1 where book_id = p_book and guid = x.guid and event = x.event;
        end if;
      end if;     -- a delete: always (Tally never brings a deleted voucher's GUID back)
      perform tally_ingest_delete(p_book, x.guid, x.alt, x.event = 'cancelled', 'a delete or cancel already received: a later entry body does not undo it');
    end loop;
  end if;
  return res;
end $function$;""")
OLDHDR = "-- the entry path with the recorder's keep: p_keep false is 48's 4-argument form exactly (the same arguments passed on)"
TABLES = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "m57-body.sql")).read()
HEAD = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "m57-head.sql")).read()
out = HEAD + "\nbegin;\nset local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)\n\n" + TABLES + \
  "\n-- ---------------------------------------------------------------- 2. the entry path: 56's 5-argument form, the details written after the entries\n" + \
  "-- 56's text; the one return replaced by the details and the re-applied delete (cancel)\n" + ENT + "\n" + \
  "-- ---------------------------------------------------------------- 3. the Day Book: 44's tally_ingest_day, its one call through the 5-argument form (p_keep false)\n" + DAY + "\n" + \
  "-- ---------------------------------------------------------------- 4. a delete or cancel of an entry never in the copy: settled ('nothing to remove')\n" + \
  "-- 50's text; the one branch for an entry not in the copy changed\n" + DEL + "\ncommit;\n"
open(sys.argv[2], "w").write(out)
print(len(out))
