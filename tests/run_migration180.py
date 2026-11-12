"""python3 tests/run_migration180.py - server/tally-cloud/migration-180-gst-share-ctx-isd.sql (12-Nov-2026, branch
next-gst-isd-2b; review of ee1fe32c5): gst_share_ctx_version (migration 164) also follows the entries Tally types
"Input Service Distributor", so gst-run makes its context again (ctxOf's isdTyped) when the first such entry comes in
and when the last one is deleted or retyped. On a throwaway PostgreSQL (pg_stand, port 31880 unless PG180_PORT; never a
real database), made-up rows only, with migration 164's own definition of the function.
  0. the file: one transaction, lock_timeout 10 s; add-only (only this function replaced, no table, nothing dropped);
     its grants restated (service role only); names no real database; md5
  1. before 164 it stops and says so; after it it runs, twice
  2. a book with no ISD-typed entry: exactly 164's version (nothing made again for it); a Regular or Unregistered type,
     and words merely containing "isd", move nothing
  3. the first ISD-typed entry moves the version; a second entry of the same party and type does not; another party, or
     the type written with hyphens, does; the entry deleted (deleted_at) or retyped: back to the version before it
  4. anon and authenticated may not call it; the service role may
RED_WITHOUT_180=1: the same checks without running the file (the ISD-typed entries of 3 move nothing: 3 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M164 = os.path.join(ROOT, "server", "tally-cloud", "migration-164-gst-share.sql")
M180 = os.path.join(ROOT, "server", "tally-cloud", "migration-180-gst-share-ctx-isd.sql")
RED = os.environ.get("RED_WITHOUT_180") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M180).read(); code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M180), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
stmts = re.sub(r"\b(grant|revoke)\b[^;]*;", "", code)
ok(not re.search(r"\b(drop|truncate|alter|delete|update|insert)\b", stmts) and "create table" not in code and re.findall(r"create or replace function public\.(\w+)", code) == ["gst_share_ctx_version"],
   "add-only: only gst_share_ctx_version replaced; no table, nothing dropped or written")
ok("revoke all on function public.gst_share_ctx_version(uuid) from public, anon, authenticated;" in text and "grant execute on function public.gst_share_ctx_version(uuid) to service_role;" in text, "its grants restated: the service role only")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", text.lower()), "names no real database")
# migration 164's own definition of the function (and its grants), as staging has it before 180
t164 = open(M164).read()
f164 = re.search(r"create or replace function public\.gst_share_ctx_version\(p_book uuid\).*?\$function\$;", t164, re.S).group(0)
F, BK, BK2 = "99999999-9999-4999-8999-999999999180", "bbbbbbbb-0180-4000-8000-000000000001", "bbbbbbbb-0180-4000-8000-000000000002"
db = pg_stand.start(int(os.environ.get("PG180_PORT") or 31880))
def fails_sql(s):
    try: db.sql(s); return ""
    except RuntimeError as e: return str(e)
try:
    db.sql("""do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
      create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
      insert into firms values ('%(F)s', 'Made-up Firm');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(BK)s', '%(F)s', 'c180', 'Synthetic Traders', '2025-04-01', '2025-04-01'),
        ('%(BK2)s', '%(F)s', 'c181', 'Other Made-up', '2025-04-01', '2025-04-01');
      insert into tally_ledgers (book_id, firm_id, name, parent) values ('%(BK)s', '%(F)s', 'Made-up Head Office ISD', 'Sundry Creditors'), ('%(BK)s', '%(F)s', 'Made-up Supplier', 'Sundry Creditors');
      insert into tally_groups values ('%(BK)s', '%(F)s', 'Sundry Creditors', 'Current Liabilities');
      insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%(F)s', 'c180', 'map', '', '{"x": 1}', 1);""" % dict(F=F, BK=BK, BK2=BK2))
    print("== 1. order and reruns")
    e = fails_sql(text)
    ok("needs migration 164" in e, "before 164: stops and says so")
    e = fails_sql("alter table tally_vouchers add column if not exists deleted_at timestamptz;\n" + f164 + "\nrevoke all on function public.gst_share_ctx_version(uuid) from public, anon, authenticated; grant execute on function public.gst_share_ctx_version(uuid) to service_role;")
    ok(not e, "164's function made" + (": " + e[-300:] if e else ""))
    e = fails_sql(text)
    ok("needs migration 72" in e, "without 72's gst_reg_type: stops and says so")
    db.sql("alter table tally_vouchers add column if not exists gst_reg_type text;")
    ins = lambda guid, party, typ, day="2025-09-30": db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional, gst_reg_type) values ('%s', '%s', '%s', '%s', 1, 'Journal', 'J/1', '%s', false, false, %s)" % (BK, F, guid, day, party, ("'%s'" % typ) if typ is not None else "null"))
    ins("p-1", "Made-up Supplier", "Regular"); ins("p-2", "Made-up Supplier", None); ins("p-3", "Made-up Supplier", "Unregistered")
    ver = lambda b=BK: db.one("select public.gst_share_ctx_version('%s')" % b)
    v164, v164b = ver(), ver(BK2)
    if not RED:
        e = fails_sql(text) or fails_sql(text)
        ok(not e, "after 164: runs, and a second time" + (": " + e[-300:] if e else ""))
    print("== 2. no ISD-typed entry: 164's version")
    ok(ver() == v164 and ver(BK2) == v164b and len(v164 or "") == 32, "a book with Regular, Unregistered and no type: exactly 164's version (%s)" % v164)
    ins("p-4", "Made-up Supplier", "Disdain Traders Regular")
    ok(ver() == v164, "a type merely containing \"isd\" in a word: no move")
    db.sql("delete from tally_vouchers where guid = 'p-4' and book_id = '%s'" % BK)
    print("== 3. the ISD-typed entries")
    ins("i-1", "Made-up Head Office ISD", "Input Service Distributor"); v1 = ver()
    ok(v1 and v1 != v164 and ver(BK2) == v164b, "the first ISD-typed entry moves the version (another book's does not move)")
    ins("i-2", "Made-up Head Office ISD", "Input Service Distributor", "2025-11-28")
    ok(ver() == v1, "a second entry of the same party and type: the same version")
    ins("i-3", "Made-up Supplier", "Input-Service-Distributor"); v3 = ver()
    ok(v3 != v1, "another party, the type written with hyphens: moves")
    db.sql("update tally_vouchers set deleted_at = now() where book_id = '%s' and guid = 'i-3'" % BK)
    ok(ver() == v1, "that entry deleted: back to the version before it")
    db.sql("update tally_vouchers set deleted_at = now() where book_id = '%s' and guid in ('i-1', 'i-2')" % BK)
    ok(ver() == v164, "every ISD-typed entry deleted: back to 164's version")
    db.sql("update tally_vouchers set deleted_at = null, gst_reg_type = 'Regular' where book_id = '%s' and guid = 'i-1'" % BK)
    ok(ver() == v164, "an entry retyped Regular: no ISD, 164's version")
    db.sql("update tally_vouchers set gst_reg_type = 'ISD' where book_id = '%s' and guid = 'i-1'" % BK)
    ok(ver() not in (v164, v1, v3), "retyped \"ISD\": moves")
    print("== 4. who may call it")
    an = fails_sql("set role anon; select public.gst_share_ctx_version('%s');" % BK); au = fails_sql("set role authenticated; select public.gst_share_ctx_version('%s');" % BK)
    ok("permission denied" in an and "permission denied" in au, "anon and authenticated may not")
    ok(db.one("select has_function_privilege('service_role', 'public.gst_share_ctx_version(uuid)', 'execute')") == "t", "the service role may")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
