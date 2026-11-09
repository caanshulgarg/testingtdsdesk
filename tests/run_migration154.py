"""python3 run_migration154.py - server/tally-cloud/migration-154-period-held.sql (09-Nov-2026, FinCom Bridge 2.5.12).
On a throwaway PostgreSQL (pg_stand, port 31541 unless PG154_PORT; never a real database): migration 98 (its tables and
functions), then 154 (twice). Made-up rows only (a book "ZZ CO", GUIDs g-1 and g-2). Checks:
  0. the file: one transaction, lock_timeout 10 s; one column added, nothing dropped or emptied; names no real database;
     the grants (hold and release: service_role only; retry and the list: authenticated)
  1. a held entry keeps its day open (done_at null, not marked: listed again by 98's rule) with the words "1 entry on
     12-Oct could not be read yet. FinCom tries again by itself."; a second and third failure on the same version: at 3
     the day is marked 'held' (not listed) with the manual step's words
  2. a bridge update (another version) lists it again and starts its tries at 1
  3. a retry that reads it (the day's last call says held []) clears the mark and finishes the day
  4. the day's Day Book uploaded (the entry in FinCom at the AlterID held): the list settles it, the day done
  5. "Try again now" (staff of the firm): the manual day listed again; a person of another firm refused
  6. the second run of 154 changes nothing of the rows"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M154 = os.path.join(SQLDIR, "migration-154-period-held.sql")
M98 = os.path.join(SQLDIR, "migration-98-period-pull.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

text = open(M154).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, lock_timeout 10 s")
ok(re.findall(r"alter table [^;]*;", code) == ["alter table public.tally_period_days add column if not exists held jsonb not null default '[]'::jsonb;"]
   and not re.search(r"\b(create table|drop (table|column|function|index)|truncate|delete from)\b", code), "0. one column added; nothing created, dropped or emptied")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "0. names no real database")
ok("grant execute on function public.tally_period_hold(uuid, date, jsonb, text), public.tally_period_held_release(uuid, text) to service_role;" in text
   and "grant execute on function public.tally_period_held_retry(uuid, date), public.tally_period_held_list(uuid) to authenticated, service_role;" in text, "0. the grants")

F, F2, B = "99999999-9999-9999-9999-999999999151", "99999999-9999-9999-9999-999999999152", "11111111-1111-1111-1111-111111111151"
STAFF, OTHER = "aaaaaaaa-0000-0000-0000-000000000151", "aaaaaaaa-0000-0000-0000-000000000152"
SCHEMA = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create or replace function tally_service_or_owner() returns boolean language sql stable as $$ select coalesce(current_setting('fincom.uid', true), '') = '' $$;
create or replace function tally_month_locked(p_book uuid, p_days date[]) returns date language sql stable as $$ select null::date $$;
alter table tally_vouchers add column if not exists deleted_at timestamptz;
create table if not exists tally_devices (id uuid primary key, firm_id uuid, info jsonb, revoked boolean);
"""
DAY = "2025-10-12"
db = pg_stand.start(int(os.environ.get("PG154_PORT") or 31541))
try:
    db.sql(SCHEMA)
    db.sql(pg_stand.migration_body(M98))
    db.sql("""insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%s, %s, 'c1', 'ZZ CO', '2025-04-01');
      insert into members (user_id, firm_id, name, role) values (%s, %s, 'Made Up Staff', 'staff'), (%s, %s, 'Made Up Other', 'staff');
      insert into tally_period_pulls (book_id, firm_id, fy_start) values (%s, %s, '2025-04-01');
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id) values (%s, %s, 'g-1', %s, 5);
      insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at)
      values (%s, %s, %s, 2, 1, '[["g-1", "1", "5", "Sales"], ["g-2", "2", "7", "Sales"]]', 'day', now());"""
           % (q(B), q(F), q(STAFF), q(F), q(OTHER), q(F2), q(B), q(F), q(B), q(F), q(DAY), q(B), q(F), q(DAY)))
    db.sql(pg_stand.migration_body(M154))
    db.sql(pg_stand.migration_body(M154))     # safe twice
    HELD = json.dumps([{"guid": "g-2", "masterId": "2", "alterId": 7, "type": "Sales", "why": "Sales entry (MasterID 2) of 12-Oct-2025 held: a form not read"}])
    def hold(held=HELD, ver="2.5.12"):
        return json.loads(db.one("select tally_period_hold(%s, %s, %s::jsonb, %s)::text" % (q(B), q(DAY), q(held), q(ver))))
    def day():
        return db.rows("select done_at is null as open, upload_at is null as listed, upload_why, upload_words, jsonb_array_length(held) as n, held::text as held from tally_period_days where book_id = %s and day = %s" % (q(B), q(DAY)))[0]
    def lst(uid=None):
        return json.loads(db.one("select tally_period_held_list(%s)::text" % q(B), uid))
    r = hold(); d = day()
    ok(r.get("tries") == 1 and d["open"] == "t" and d["listed"] == "t" and d["n"] == "1", "1. held: the day open and listed (%s, %s)" % (r, d))
    ok(lst()["held"] == [{"day": "20251012", "n": 1, "tries": 1, "manual": False, "words": "1 entry on 12-Oct could not be read yet. FinCom tries again by itself."}], "1. the plain line (%s)" % lst())
    hold(); r = hold(); d = day()
    ok(r.get("tries") == 3 and r.get("manual") is True and d["listed"] == "f" and d["upload_why"] == "held" and d["open"] == "t", "1. 3 tries: marked, not listed, still open (%s)" % d)
    m = lst()["held"][0]
    ok(m["manual"] is True and m["words"] == "In Tally, open Day Book, press F2 and set the date to 12-Oct-2025, then Alt+E (Export) → Current, F8 (File Format): XML, and E to export; drop the file on Books › From Tally.", "1. the manual step (%s)" % m["words"])
    n = db.one("select tally_period_held_release(%s, '2.5.13')" % q(F))
    d = day(); r = hold(ver="2.5.13")
    ok(n == "1" and d["listed"] == "t" and r.get("tries") == 1 and day()["listed"] == "t", "2. a bridge update: listed again, tries from 1 (%s, %s)" % (n, r))
    ok(db.one("select tally_period_held_release(%s, '2.5.13')" % q(F)) == "0", "2. the same version again: nothing released")
    # 3. the retry read it: 98's tally_period_entries counted it (held_n 2), then the day's last call says held []
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id) values (%s, %s, 'g-2', %s, 7); update tally_period_days set held_n = 2 where book_id = %s and day = %s" % (q(B), q(F), q(DAY), q(B), q(DAY)))
    r = hold("[]"); d = day()
    ok(r.get("held") == 0 and d["open"] == "f" and d["n"] == "0" and d["listed"] == "t" and lst()["held"] == [], "3. a retry read it: the mark cleared, the day done (%s)" % d)
    # 4. the upload: back to 3 tries (manual), then the Day Book uploaded brings g-2 at its AlterID
    db.sql("delete from tally_vouchers where guid = 'g-2'; update tally_period_days set held_n = 1, done_at = null where book_id = %s and day = %s" % (q(B), q(DAY)))
    hold(); hold(); hold()
    ok(day()["upload_why"] == "held", "4. manual again before the upload")
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id) values (%s, %s, 'g-2', %s, 6)" % (q(B), q(F), q(DAY)))
    ok(lst()["held"] != [] and day()["n"] == "1", "4. an older copy (AlterID 6 < 7) does not settle it")
    db.sql("update tally_vouchers set alter_id = 7 where guid = 'g-2'")
    l = lst(); d = day()
    ok(l["held"] == [] and d["n"] == "0" and d["open"] == "f" and d["listed"] == "t" and d["upload_why"] in ("", None), "4. the Day Book uploaded: settled, the day done (%s)" % d)
    # 5. "Try again now"
    db.sql("delete from tally_vouchers where guid = 'g-2'; update tally_period_days set held_n = 1, done_at = null where book_id = %s and day = %s" % (q(B), q(DAY)))
    hold(); hold(); hold()
    r = json.loads(db.one("select tally_period_held_retry(%s, %s)::text" % (q(B), q(DAY)), STAFF)); d = day()
    ok(r.get("queued") is True and d["listed"] == "t" and d["n"] == "1", "5. Try again now: listed again (%s)" % r)
    try:
        db.one("select tally_period_held_retry(%s, %s)::text" % (q(B), q(DAY)), OTHER); ok(False, "5. another firm's person refused")
    except RuntimeError as e:
        ok("not allowed" in str(e), "5. another firm's person refused")
    before = day()
    db.sql(pg_stand.migration_body(M154))
    ok(day() == before, "6. the second run changes no row")
except RuntimeError as e:
    ok(False, "the run: %s" % str(e)[-800:])
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
