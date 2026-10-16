"""python3 run_migration91.py - migration 91 (round 64, 16-Oct-2026): the books filled only by Day Book uploads get a start
(tally_books.from_date: the earliest sealed upload's first day, else the first day held) and an openings date (the day
before, when none), on a throwaway PostgreSQL (pg_stand) with the tables as on staging (run_migration33's schema, migration 47
for tally_jobs.upload) and made-up rows; never on staging. Checks: the read-only listing in the file's header names exactly
the books the update touches, with the same dates; a book with a start is not moved; a book with an openings date keeps it;
a book with no days is left; run twice: nothing more changes; nothing deleted; the file creates, drops or alters nothing."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
F91 = os.path.join(SQLDIR, "migration-91-book-start.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def nz(v): return "" if v is None or str(v) in ("None", "") else str(v)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
text = open(F91).read()
body = "\n".join(l for l in text.split("\n") if not l.strip().startswith("--"))
ok(not re.search(r"\b(create|drop|alter|delete|truncate|grant|revoke)\b", body, re.I), "the file creates, drops, alters, deletes or grants nothing (add-only)")
listing = "\n".join(l.strip()[3:] if l.strip().startswith("-- ") else "" for l in text.split("\n")[text.split("\n").index("-- Read-only, BEFORE running it (the books it would touch, with the dates it would set):") + 1:]).strip()
listing = listing[:listing.index(";") + 1]
F = "99999999-9999-9999-9999-999999999999"
B = {k: "11111111-1111-1111-1111-1111111111%02d" % i for i, k in enumerate(["gb", "abc", "old", "half", "none", "daysonly"])}
db = pg_stand.start(30991)
def run(sql):
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
    return r.returncode, r.stderr
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    # tally_jobs as migration 47 leaves it (kind 'upload', the upload column)
    db.sql("alter table tally_jobs add column if not exists upload jsonb; alter table tally_jobs drop constraint if exists tally_jobs_kind_check;")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("""insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values
      (%(gb)s, %(F)s, 'c1', 'GB TEXCOAT', null, null), (%(abc)s, %(F)s, 'c2', 'ABC', null, null), (%(old)s, %(F)s, 'c3', 'OLD', '2024-04-01', '2024-03-31'),
      (%(half)s, %(F)s, 'c4', 'HALF', null, '2025-12-31'), (%(none)s, %(F)s, 'c5', 'NONE', null, null), (%(daysonly)s, %(F)s, 'c6', 'DAYS ONLY', null, null);""" % dict({k: q(v) for k, v in B.items()}, F=q(F)))
    days = [("gb", "2025-04-01", 0), ("gb", "2025-04-02", 3), ("gb", "2026-10-13", 0), ("abc", "2026-04-05", 2), ("old", "2026-04-01", 1), ("half", "2026-01-01", 1), ("daysonly", "2026-05-10", 4)]
    db.sql(";".join("insert into tally_days (book_id, firm_id, day, n) values (%s, %s, %s, %d)" % (q(B[b]), q(F), q(d), n) for b, d, n in days) + ";")
    db.sql("""insert into tally_jobs (firm_id, client_id, book_id, kind, sealed, upload) values
      (%(F)s, 'c1', %(gb)s, 'upload', true, '{"from": "20250401", "to": "20251231"}'), (%(F)s, 'c1', %(gb)s, 'upload', true, '{"from": "20260401", "to": "20261013"}'),
      (%(F)s, 'c2', %(abc)s, 'upload', true, '{"from": "20260401", "to": "20261015"}'), (%(F)s, 'c2', %(abc)s, 'upload', false, '{"from": "20250401", "to": "20250430"}');""" % dict({k: q(v) for k, v in B.items()}, F=q(F)))
    listed = {r["book_id"]: (nz(r["from_date_to_set"]), nz(r["open_as_on_to_set"])) for r in db.rows(listing)}
    before = db.one("select count(*) from tally_books")
    rc, err = run(text)
    ok(rc == 0, "migration 91 runs %s" % err[-300:])
    got = {r["book_id"]: (nz(r["from_date"]), nz(r["open_as_on"])) for r in db.rows("select book_id, from_date, open_as_on from tally_books")}
    ok(got[B["gb"]] == ("2025-04-01", "2025-03-31"), "a book of uploads only: the earliest sealed upload's first day, openings the day before (%s)" % (got[B["gb"]],))
    ok(got[B["abc"]] == ("2026-04-01", "2026-03-31"), "an upload not sealed is not counted: 1-Apr-2026, not 1-Apr-2025 (%s)" % (got[B["abc"]],))
    ok(got[B["old"]] == ("2024-04-01", "2024-03-31"), "a book with a start: not moved")
    ok(got[B["half"]] == ("2026-01-01", "2025-12-31"), "a book with an openings date keeps it; its start the first day held (%s)" % (got[B["half"]],))
    ok(got[B["none"]] == ("", ""), "a book with no days: left (%s)" % (got[B["none"]],))
    ok(got[B["daysonly"]] == ("2026-05-10", "2026-05-09"), "days but no upload: the first day held (%s)" % (got[B["daysonly"]],))
    touched = {b for b in B.values() if b != B["old"] and got[b] != ("", "")}
    ok(set(listed) == touched and all(listed[b] == got[b] for b in listed), "the read-only listing names exactly the books touched, with the same dates (%s)" % listed)
    rc, err = run(text)
    again = {r["book_id"]: (nz(r["from_date"]), nz(r["open_as_on"])) for r in db.rows("select book_id, from_date, open_as_on from tally_books")}
    ok(rc == 0 and again == got and db.one("select count(*) from tally_books") == before, "run twice: nothing more changes, nothing deleted")
    ok(not db.rows(listing), "after it: the listing is empty")
finally:
    db.stop()
    subprocess.run(["rm", "-rf", db.data])
if fails: print("FAILED %d" % len(fails)); raise SystemExit(1)
print("ALL PASSED")
