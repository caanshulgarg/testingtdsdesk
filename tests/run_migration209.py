"""python3 tests/run_migration209.py - server/tally-cloud/migration-209-sync-speed.sql (DRAFT, not applied anywhere), on a
throwaway PostgreSQL (pg_stand, port 31209 unless PG209_PORT; its data dir under TMPDIR; never a real database), with
staging's tables as tests/run_migration204.py has them, staging's foreign keys (firm -> book -> vouchers, calc_seen),
Supabase's default grants, staging's OWN text of the four functions 209 touches (tests/fixtures/staging-209-funcs.sql,
not migration.sql's) and made-up books.
  0. the name guard: a same-named table, function or trigger that is not 209's stops it, nothing changed; a missing
     prerequisite stops it
  1. the file runs through the API stand-in as one query, twice; the backfill only the first time
  2. each function 209 replaces is staging's text with only 209's change (tally_monthly is not replaced at all)
  3. tally_tb and tally_monthly come in a steady order (TCloud.rpcAll reads them a thousand rows at a time)
  4. grants: no API role (anon, authenticated, service_role) may run gst_run_post or the trigger function; the table is
     read-only for service_role and closed to anon / authenticated
  5. deleting a book, and a firm, with marks and calc_seen rows works (review B1); a deleted entry mark of a live book
     still marks it
  6. a book's "unseen" mark is stamped with the time of the write (clock_timestamp), not the start of its transaction
  7. settle never removes a mark a voucher write still holds; two settles at once; a mark arriving during a settle
  8. settle: a book with nothing unseen is unmarked; a book with an unseen voucher keeps its mark; the sweep finds it"""
import os, re, sys, subprocess, shutil, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.dirname(HERE)
M209 = os.environ.get("M209_FILE") or os.path.join(ROOT, "server", "tally-cloud", "migration-209-sync-speed.sql")
FIX = os.path.join(HERE, "fixtures", "staging-209-funcs.sql")
PORT = int(os.environ.get("PG209_PORT", "31209"))
BIN = pg_stand.BIN
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
t204 = open(os.path.join(HERE, "run_migration204.py")).read()
DDL = re.search(r'\nDDL = r"""(.*?)\n"""', t204, re.S).group(1)
STUBS = re.search(r'\nSTUBS = r"""(.*?)\n"""', t204, re.S).group(1)
FIRM, OWNER = "f0000000-0000-0000-0000-000000000204", "11111111-0000-0000-0000-000000000204"
FIRM2 = "f0000000-0000-0000-0000-0000000002f9"
BA, BB = "a0000000-0000-0000-0000-0000000002a9", "b0000000-0000-0000-0000-0000000002b9"
BC, BD = "c0000000-0000-0000-0000-0000000002c9", "d0000000-0000-0000-0000-0000000002d9"
S1, S2, S3 = ("e%d000000-0000-0000-0000-0000000002e9" % i for i in (1, 2, 3))
# staging's foreign keys (migration.sql, 164), and the grants Supabase gives every new table and function in public
KEYS = """
insert into firms (id, name) values ('%(f)s', 'Made-up Firm'), ('%(f2)s', 'Made-up Second Firm');
alter table tally_books add foreign key (firm_id) references firms (id) on delete cascade;
alter table tally_vouchers add foreign key (book_id) references tally_books (book_id) on delete cascade;
alter table calc_seen add foreign key (book_id) references tally_books (book_id) on delete cascade;
alter table tally_calc_dirty add foreign key (book_id) references tally_books (book_id) on delete cascade;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- 164's gst_share_books_all, as a stand-in (209 only names it in its job)
create or replace function public.gst_share_books_all(p_n integer default 200) returns table(book_id uuid) language sql stable
  as $$ select b.book_id from tally_books b order by 1 limit p_n $$;
""" % {"f": FIRM, "f2": FIRM2}
SEED = """
alter table tally_ledger_day add column if not exists merged_into text;
insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values
 ('%(a)s', '%(f)s', 'c-209a', 'Made-up Ninth Co', '2025-04-01', '2025-04-01'),
 ('%(b)s', '%(f)s', 'c-209b', 'Made-up Tenth Co', '2025-04-01', '2025-04-01');
-- ledgers written in no order, over several months
insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
select '%(a)s', '%(f)s', 'Ledger ' || lpad(((i * 7919) %% 400)::text, 3, '0'), date '2025-04-01' + ((i * 31) %% 300), i, i, 0, 1
  from generate_series(1, 4000) i on conflict do nothing;
insert into tally_ledgers (book_id, firm_id, name, parent, open)
select '%(a)s', '%(f)s', 'Ledger ' || lpad(((i * 7919) %% 1500)::text, 4, '0'), 'Group', i from generate_series(1, 1500) i on conflict do nothing;
-- book A: every voucher seen; book B: one voucher not seen
insert into tally_vouchers (book_id, firm_id, guid, day) select '%(a)s', '%(f)s', 'ga-' || i, date '2025-05-01' from generate_series(1, 50) i;
insert into tally_vouchers (book_id, firm_id, guid, day) select '%(b)s', '%(f)s', 'gb-' || i, date '2025-05-01' from generate_series(1, 50) i;
insert into calc_seen (book_id, firm_id, calc, kind, key) select book_id, firm_id, 'gst-share', 'entry', guid from tally_vouchers where guid <> 'gb-50';
insert into calc_seen (book_id, firm_id, calc, kind, key, data) select book_id, '%(f)s', 'gst-share', 'book', 'ctx', '{"engine": "e1"}' from tally_books where book_id in ('%(a)s', '%(b)s');
insert into gst_share_engine (one, engine) values (true, 'e1');
""" % {"a": BA, "b": BB, "f": FIRM}
def psql_proc(db):
    return subprocess.Popen(["runuser", "-u", "postgres", "--", BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
def defs_of(sql_text):
    """{name: text} of each CREATE OR REPLACE FUNCTION in a file of pg_get_functiondef texts"""
    out = {}
    for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\.(\w+)\(", sql_text):
        a = sql_text.index("$function$", m.start()); z = sql_text.index("$function$", a + 10) + 10
        out[m.group(1)] = sql_text[m.start():z]
    return out
text = open(M209).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
staging = open(FIX).read()
SDEF = defs_of(staging)
api = ["python3", os.path.join(HERE, "api_standin.py")]
env = dict(os.environ, STANDIN_PGOPTIONS="-c check_function_bodies=off")   # (tally_post_own_words names bridge tables the stand has not)
def run_file(db, path=M209):
    r = subprocess.run(api + [str(db.port), path], capture_output=True, text=True, env=env)
    out = r.stdout.strip()
    return r.returncode == 0 and not out.startswith("{"), out
def fdef(db, sig):
    return (db.one("select pg_get_functiondef('%s'::regprocedure)" % sig) or "").rstrip("\n")
db = pg_stand.start(PORT)
try:
    db.sql(STUBS); db.sql(DDL); db.sql(KEYS); db.sql(SEED)
    db.sql("set check_function_bodies = off;\n" + staging)        # staging's text of the four, before 209
    ok(sorted(SDEF) == ["gst_share_books_due", "tally_monthly", "tally_post_own_words", "tally_tb"], "the fixture has staging's four functions (%s)" % sorted(SDEF))
    ok(not re.search(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b|@[a-z]", staging), "the fixture has no GSTIN or e-mail in it (code only)")
    before = {s: fdef(db, s) for s in ("tally_tb(text,date)", "tally_monthly(text,date,date)")}

    print("== 0. the name guard and the prerequisites")
    for what, make, undo in [
        ("table gst_share_unseen", "create table public.gst_share_unseen (x int)", "drop table public.gst_share_unseen"),
        ("function gst_run_post", "create function public.gst_run_post(p text) returns int language sql as $$ select 1 $$", "drop function public.gst_run_post(text)"),
        ("trigger gst_share_unseen_ins", "create function public.z209() returns trigger language plpgsql as $$begin return null; end$$;"
                                         " create trigger gst_share_unseen_ins after insert on public.tally_vouchers for each statement execute function public.z209()",
         "drop trigger gst_share_unseen_ins on public.tally_vouchers; drop function public.z209()")]:
        db.sql(make)
        good, out = run_file(db)
        ok(not good and "already used by something else" in out and what in out, "a %s that is not 209's stops it (%s)" % (what, out[-160:]))
        ok(fdef(db, "tally_tb(text,date)") == before["tally_tb(text,date)"] and db.one("select to_regprocedure('public.gst_share_unseen_settle()')") in (None, ""),
           "  ... and nothing was changed")
        db.sql(undo)
    db.sql("alter table public.gst_share_engine rename to gst_share_engine_x")
    good, out = run_file(db)
    ok(not good and "run migrations" in out, "without gst_share_engine (170) it stops (%s)" % out[-120:])
    db.sql("alter table public.gst_share_engine_x rename to gst_share_engine")

    print("== 1. the file through the API, twice; the backfill once")
    good, out = run_file(db)
    ok(good, "time 1" + ("" if good else ": " + out[-400:]))
    marks1 = sorted(r["book_id"] for r in db.rows("select book_id from gst_share_unseen"))
    ok(marks1 == [BB], "the first install marks the book with an unseen voucher only (%s)" % marks1)
    db.sql("delete from gst_share_unseen")
    good, out = run_file(db)
    ok(good, "time 2" + ("" if good else ": " + out[-400:]))
    ok(db.one("select count(*) from gst_share_unseen") == "0", "time 2: no backfill again (re-run is cheap)")
    db.sql("insert into gst_share_unseen (book_id) values ('%s')" % BB)
    ok(db.one("select count(*) from pg_trigger where tgname like 'gst_share_unseen_%' and not tgisinternal") == "2", "two triggers, once each")
    ok(not re.search(r"\bdrop\s+(trigger|table|function)\b", code), "the file drops nothing (create or replace trigger)")

    print("== 2. staging's text, with only 209's change")
    ok(fdef(db, "tally_monthly(text,date,date)") == before["tally_monthly(text,date,date)"] == SDEF["tally_monthly"], "tally_monthly: not replaced (staging's text)")
    ok("tally_monthly" not in code, "  ... the file does not name it")
    want = SDEF["tally_tb"].replace("from lg full join mv on mv.ledger = lg.name;",
                                    "from lg full join mv on mv.ledger = lg.name\n     order by 1;                                                          -- 209: a steady order for its pages")
    ok(fdef(db, "tally_tb(text,date)") == want, "tally_tb: staging's text plus 'order by 1'")
    s = SDEF["gst_share_books_due"]
    i, j = s.index("  -- 204:"), s.index("  select b.book_id from tally_books b")
    now_d = fdef(db, "gst_share_books_due(integer)")
    k, l = now_d.index("  -- 209:"), now_d.index("  select b.book_id from tally_books b")
    ok(now_d[:k] == s[:i] and now_d[l:] == s[j:] and "gst_share_unseen u" in now_d[k:l], "gst_share_books_due: staging's text, the 'unseen' part only changed")
    w = SDEF["tally_post_own_words"]
    for a, b in [("select tally_bridge_words(d.id, k.key) as w, tally_bridge_may_post", "select tally_bridge_may_post"),
                 ("'your FinCom Bridge (' || (select string_agg(distinct w, ', ') from own where has) || ') has it open", "'your FinCom Bridge has it open"),
                 ("'your FinCom Bridge (' || coalesce((select string_agg(distinct w, ', ') from own where may), (select string_agg(distinct w, ', ') from own)) || ') does not have '",
                  "'your FinCom Bridge does not have '"),
                 ("in Tally. Open ' || p_company || ' in Tally there, then", "in Tally. Open ' || p_company || ' in Tally on the Tally computer, then")]:
        ok(a in w, "  (staging's own words has: %s...)" % a[:50]); w = w.replace(a, b)
    ok(fdef(db, "tally_post_own_words(uuid,text,uuid)") == w, "tally_post_own_words: staging's text without the bridge's computer / login words")
    defi = db.rows("select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
                   " where n.nspname = 'public' and p.proname in ('gst_share_unseen_mark', 'gst_share_unseen_settle', 'gst_share_books_due', 'gst_run_post', 'tally_tb', 'tally_post_own_words')")
    ok(len(defi) == 6 and all(r["prosecdef"] == "t" and r["cfg"] == "search_path=public, pg_temp" for r in defi), "every definer function 209 makes: search_path = public, pg_temp (%s)" % [(r["proname"], r["cfg"]) for r in defi if r["cfg"] != "search_path=public, pg_temp"])

    print("== 3. steady orders")
    db.sql("insert into members values ('%s', '%s', 'Owner', 'owner', true) on conflict do nothing" % (OWNER, FIRM))
    off = "set enable_sort = off; set enable_indexscan = off; set enable_bitmapscan = off; set enable_indexonlyscan = off;\n"
    rows = db.rows(off + "select ledger, ym from tally_monthly('c-209a', '2025-04-01', '2026-03-31')", uid=OWNER)
    keys = [(r["ledger"], r["ym"]) for r in rows]
    ok(len(keys) > 1000 and keys == sorted(keys), "tally_monthly (staging's): ordered by ledger, month (%d rows)" % len(keys))
    rows = db.rows(off + "select ledger from tally_tb('c-209a', '2026-03-31')", uid=OWNER)
    keys = [r["ledger"] for r in rows]
    ok(len(keys) > 1000 and keys == sorted(keys, key=lambda x: x.encode()), "tally_tb: ordered by ledger (%d rows)" % len(keys))

    print("== 4. grants")
    for role in ("anon", "authenticated", "service_role"):
        ok(db.one("select has_function_privilege('%s', 'public.gst_run_post(jsonb[])', 'execute')" % role) == "f", "%s may not run gst_run_post" % role)
        ok(db.one("select has_function_privilege('%s', 'public.gst_share_unseen_mark()', 'execute')" % role) == "f", "%s may not run gst_share_unseen_mark" % role)
    for role in ("anon", "authenticated"):
        ok(db.one("select has_function_privilege('%s', 'public.gst_share_unseen_settle()', 'execute') or has_function_privilege('%s', 'public.gst_share_books_due(integer)', 'execute')"
                  " or has_table_privilege('%s', 'public.gst_share_unseen', 'select, insert, update, delete, truncate, references, trigger')" % (role, role, role)) == "f",
           "%s: no settle, no books_due, nothing on gst_share_unseen" % role)
    ok(db.one("select has_table_privilege('service_role', 'public.gst_share_unseen', 'select') and not has_table_privilege('service_role', 'public.gst_share_unseen', 'insert, update, delete, truncate')"
              " and has_function_privilege('service_role', 'public.gst_share_unseen_settle()', 'execute')") == "t", "service_role: reads gst_share_unseen, may settle, writes nothing")
    ok(db.one("select has_function_privilege('postgres', 'public.gst_run_post(jsonb[])', 'execute')") == "t", "postgres (pg_cron) still runs gst_run_post")

    print("== 5. deleting a book and a firm (staging's cascades)")
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values ('%(c)s', '%(f)s', 'c-209c', 'Made-up Eleventh Co', '2025-04-01'),"
           " ('%(d)s', '%(f2)s', 'c-209d', 'Made-up Twelfth Co', '2025-04-01');"
           " insert into tally_vouchers (book_id, firm_id, guid, day) select b, f, 'g' || i, '2025-05-01' from (values ('%(c)s'::uuid, '%(f)s'::uuid), ('%(d)s', '%(f2)s')) x(b, f), generate_series(1, 5) i;"
           " insert into calc_seen (book_id, firm_id, calc, kind, key) select book_id, firm_id, 'gst-share', 'entry', guid from tally_vouchers where book_id in ('%(c)s', '%(d)s');"
           % {"c": BC, "d": BD, "f": FIRM, "f2": FIRM2})
    ok(db.one("select count(*) from gst_share_unseen where book_id in ('%s', '%s')" % (BC, BD)) == "2", "one statement of ten vouchers in two books: both marked, once each")
    try:
        db.sql("delete from tally_books where book_id = '%s'" % BC); good, why = True, ""
    except Exception as e: good, why = False, str(e)[-300:]
    ok(good and db.one("select count(*) from gst_share_unseen where book_id = '%s'" % BC) == "0", "a book with marks and calc_seen rows is deleted, its mark with it %s" % why)
    try:
        db.sql("delete from firms where id = '%s'" % FIRM2); good, why = True, ""     # (server/signup deleteFirm)
    except Exception as e: good, why = False, str(e)[-300:]
    ok(good and db.one("select count(*) from tally_books where book_id = '%s'" % BD) == "0" and db.one("select count(*) from gst_share_unseen where book_id = '%s'" % BD) == "0",
       "a firm with such a book is deleted %s" % why)
    db.sql("delete from gst_share_unseen where book_id = '%s'; delete from calc_seen where book_id = '%s' and key = 'ga-1'" % (BA, BA))
    ok(db.one("select count(*) from gst_share_unseen where book_id = '%s'" % BA) == "1", "an entry mark of a live book removed: the book is marked")
    db.sql("insert into calc_seen (book_id, firm_id, calc, kind, key) values ('%s', '%s', 'gst-share', 'entry', 'ga-1')" % (BA, FIRM))

    print("== 6. the mark's time is the write's own")
    db.sql("delete from gst_share_unseen;")
    got = db.one("begin; create temp table z on commit drop as select 1 x from pg_sleep(1.5); insert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'ga-late', '2025-05-02');"
                 " select (select at from gst_share_unseen where book_id = '%s') > now() + interval '1 second'; rollback;" % (BA, FIRM, BA))
    ok(got == "t", "a write 1.5 s into its transaction: the mark has the write's time (%s)" % got)

    print("== 7a. a long voucher write holding the mark")
    db.sql("delete from gst_share_unseen; insert into gst_share_unseen (book_id, at) values ('%s', now() - interval '20 minutes');" % BA)
    a = psql_proc(db)
    # (a write whose transaction began long ago: its upsert left the mark old, as now() does in a 10-minute transaction)
    a.stdin.write("begin;\ninsert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'ga-long', '2025-05-03');\n"
                  "update gst_share_unseen set at = now() - interval '10 minutes' where book_id = '%s';\nselect pg_sleep(0.01);\n" % (BA, FIRM, BA))
    a.stdin.flush(); time.sleep(1.0)
    b = psql_proc(db)
    b.stdin.write("select gst_share_unseen_settle();\n"); b.stdin.close()
    time.sleep(1.5)
    a.stdin.write("commit;\n"); a.stdin.close(); a.wait(30)
    b.wait(30); bo, be = b.stdout.read(), b.stderr.read()
    left = db.one("select count(*) from gst_share_unseen where book_id = '%s'" % BA)
    ok(left == "1", "the mark stays while the write holds it (settle said %s%s)" % (bo.strip(), (" " + be.strip()) if be.strip() else ""))
    due = [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(BA in due, "the sweep then finds the book with the new voucher (%s)" % due)
    db.sql("insert into calc_seen (book_id, firm_id, calc, kind, key) values ('%s', '%s', 'gst-share', 'entry', 'ga-long') on conflict do nothing;" % (BA, FIRM))

    print("== 7b. two settles at once")
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) select x::uuid, '%s', 'c-' || x, 'Made-up Co ' || x, '2025-04-01' from unnest(array['%s', '%s', '%s']) x;"
           " delete from gst_share_unseen; insert into gst_share_unseen (book_id, at) select x::uuid, now() - interval '20 minutes' from unnest(array['%s', '%s', '%s', '%s']) x;"
           % (FIRM, S1, S2, S3, S1, S2, S3, BA))
    a = psql_proc(db); b = psql_proc(db)
    a.stdin.write("begin;\nselect 'A=' || gst_share_unseen_settle();\nselect pg_sleep(2);\ncommit;\n"); a.stdin.close()
    time.sleep(0.7)
    t0 = time.time()
    b.stdin.write("select 'B=' || gst_share_unseen_settle();\n"); b.stdin.close()
    b.wait(30); tb = time.time() - t0
    a.wait(30)
    ao, ae, bo, be = a.stdout.read(), a.stderr.read(), b.stdout.read(), b.stderr.read()
    na = int(re.search(r"A=(\d+)", ao).group(1)) if "A=" in ao else -1
    nb = int(re.search(r"B=(\d+)", bo).group(1)) if "B=" in bo else -1
    ok(not ae.strip() and not be.strip() and na == 4 and nb == 0 and tb < 1.5, "the second settle skips the first's books at once, no error (A %d, B %d in %.1f s %s%s)" % (na, nb, tb, ae.strip(), be.strip()))
    ok(db.one("select count(*) from gst_share_unseen") == "0", "  ... all four unmarked, once")

    print("== 7c. a voucher written while a settle holds its book's mark")
    db.sql("insert into gst_share_unseen (book_id, at) values ('%s', now() - interval '20 minutes')" % BA)
    a = psql_proc(db); b = psql_proc(db)
    a.stdin.write("begin;\nselect 'A=' || gst_share_unseen_settle();\nselect pg_sleep(2);\ncommit;\n"); a.stdin.close()
    time.sleep(0.7)
    b.stdin.write("insert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'ga-during', '2025-05-04');\n" % (BA, FIRM)); b.stdin.close()
    a.wait(30); b.wait(30)
    ao, ae, bo, be = a.stdout.read(), a.stderr.read(), b.stdout.read(), b.stderr.read()
    mark = db.one("select (at > now() - interval '1 minute')::text from gst_share_unseen where book_id = '%s'" % BA)
    ok("A=1" in ao and not ae.strip() and not be.strip() and mark == "true", "the settle removed the old mark, the write's new one stays (%s %s %s mark %s)" % (ao.strip(), ae.strip(), be.strip(), mark))
    due = [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(BA in due, "  ... and the sweep finds the book (%s)" % due)
    db.sql("insert into calc_seen (book_id, firm_id, calc, kind, key) values ('%s', '%s', 'gst-share', 'entry', 'ga-during') on conflict do nothing;" % (BA, FIRM))

    print("== 8. settle")
    db.sql("delete from gst_share_unseen; insert into gst_share_unseen (book_id, at) values ('%s', now() - interval '20 minutes'), ('%s', now() - interval '20 minutes');" % (BA, BB))
    n = db.one("select gst_share_unseen_settle()")
    left = sorted(r["book_id"] for r in db.rows("select book_id from gst_share_unseen"))
    ok(n == "1" and left == [BB], "the book with nothing unseen unmarked, the other kept (%s, %s)" % (n, left))
    due = [r["book_id"] for r in db.rows("select book_id from gst_share_books_due(5)")]
    ok(BB in due and BA not in due, "the sweep finds the book with an unseen voucher only (%s)" % due)
    ok("for update of u skip locked" in code and "clock_timestamp()" in code, "the file: settle skips a mark being written; marks stamped with clock_timestamp()")
    ok(code.count("order by 1\n      on conflict (book_id) do update") == 2, "the file: both mark upserts in book order (no deadlock between two writers)")
    ok("lock_timeout = '3s'" in code and code.strip().startswith("begin;") and code.strip().endswith("commit;"), "the file: one transaction, lock_timeout 3 s")
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall ok"); sys.exit(1 if fails else 0)
