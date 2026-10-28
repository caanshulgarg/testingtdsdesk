"""python3 run_migration128.py - migration-128-client-removed-frees-tally (28-Oct-2026, next-fix-clientremove; NOT run on
staging). Staging that day: "Salesify Marketing LLP 2026-27" removed (clients.deleted) while its Tally company stayed
linked to it; a new client of the same name could not be linked to it. On a throwaway PostgreSQL (pg_stand;
run_migration110.py's stand, port 31128 unless PG128_PORT), with 110 run first:
  0. the file: one transaction, lock_timeout 10 s, add-only, names no real database; functions; md5
  1. RED (110 alone): the staging case: the company stays linked to the removed client; md5
  2. 128 runs twice: the existing case released (record unlinked, mirror and books cleared, history row), once only;
     nothing deleted
  3. the new client of the same name links it with one call (tally_link_set)
  4. removing a linked client (the app's PATCH deleted=true) releases its company at once, with who / when / why in the
     history; restoring the client links nothing by itself; the history names the company to offer
  5. grants: the history readable by members of the firm only; the functions for the service role only"""
import os, re, sys, json, hashlib, textwrap
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PG110_PORT", os.environ.get("PG128_PORT") or "31128")
M128 = os.path.join(HERE, "..", "server", "tally-cloud", "migration-128-client-removed-frees-tally.sql")
src = open(os.path.join(HERE, "run_migration110.py")).read()
head, rest = src.split("\ntry:\n", 1)
setup = textwrap.dedent(rest.split('    print("== 1. runs twice; the backfill")', 1)[0])
g = {"__name__": "m110stand", "__file__": os.path.join(HERE, "run_migration110.py")}
print("== (migration 110's own file checks, from its stand)")
exec(compile(head, "run_migration110.py(head)", "exec"), g)
q, ok, db, psql_text, F, F2, D1 = g["q"], g["ok"], g["db"], g["psql_text"], g["F"], g["F2"], g["D1"]
fails = g["fails"]
text = open(M128).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M128), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in text.lower() and not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", code) and not re.search(r"\btruncate\b", code), "add-only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["clients_release_tally", "tally_link_release_client", "tally_link_release_removed", "tally_link_set"],
   "functions: tally_link_set (replaced); tally_link_release_client, tally_link_release_removed, clients_release_tally (new)")
OLD, NEW, CAR, OWN = "cmvs4ulr5lmpto", "cmvsazte0oqc1w", "cmvrz045t4u37c", g["OWNER"]
BOOK, BOOK2 = "cf45de08-504e-4a05-8588-d654003dc5a9", "b2000000-0000-0000-0000-000000000128"
SAL, CARCO = "Salesify Marketing LLP 2026-27", "Car Laundry Retail Private Limited"
state = lambda b: db.one("select coalesce(l.state, '-') || '|' || coalesce(l.client_id, '') || '|' || coalesce(c.client_id, '') || '|' || coalesce((select client_id from tally_books where book_id = c.book_id), '-')"
                         " from tally_companies c left join tally_links l on l.book_id = c.book_id where c.book_id = %s" % q(b))
hist = lambda: db.rows("select company_name, client_id, client_name, action, why, coalesce(by_user::text, '') by_user from tally_link_history where company_name = %s order by id" % q(SAL))
try:
    exec(compile(setup, "run_migration110.py(setup)", "exec"), g)
    r = psql_text(open(g["M110"]).read())
    ok(r.returncode == 0, "migration 110 runs %s" % (r.stderr[-300:] if r.returncode else ""))
    db.sql("insert into clients (id, firm_id, name, data) values (%s, %s, %s, '{}'), (%s, %s, %s, '{}'), (%s, %s, %s, '{}');" % (q(OLD), q(F), q(SAL), q(CAR), q(F), q(CARCO), q(NEW), q(F), q(SAL)))
    db.sql("insert into tally_companies (firm_id, company, device_id, last_seen, book_id) values (%s, %s, %s, now(), %s), (%s, %s, %s, now(), %s);" % (q(F), q(SAL), q(D1), q(BOOK), q(F), q(CARCO), q(D1), q(BOOK2)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company) values (%s, %s, '', %s);" % (q(BOOK), q(F), q(SAL)))
    good = g["link"](OWN, SAL, OLD)
    ok("_error" not in good, "13:16 linked to the first client (%s)" % good.get("_error", ""))

    print("== 1. RED: 110 alone, the client removed")
    db.sql("update clients set deleted = true where id = %s" % q(OLD))
    ok(state(BOOK) == "linked|%s|%s|%s" % (OLD, OLD, OLD), "still linked to the removed client (%s)" % state(BOOK))
    tables = ["tally_companies", "tally_books", "clients", "tally_links", "tally_devices"]
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in tables}
    before = counts()

    print("== 2. runs twice")
    for n in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        ok("migration 128:" in (r.stderr or "") and (" 2 Tally" in r.stderr if n == 1 else " 0 Tally" in r.stderr), "run %d NOTICE (Salesify and the stand's DD CO, its client removed, on the first run): %s" % (n, (r.stderr or "").strip()[-120:]))
        ok(counts() == before, "run %d: nothing deleted or added (%s)" % (n, counts()))
    ok(state(BOOK) == "unlinked|||", "released: record unlinked, tally_companies and tally_books cleared (%s)" % state(BOOK))
    h = hist()
    ok(len(h) == 1 and h[0]["client_id"] == OLD and h[0]["client_name"] == SAL and h[0]["action"] == "released" and "migration 128" in h[0]["why"], "one history row (%s)" % h)

    print("== 3. the new client links it in one call")
    good = g["link"](OWN, SAL, NEW)
    ok("_error" not in good and state(BOOK) == "linked|%s|%s|%s" % (NEW, NEW, NEW), "linked to the new client (%s %s)" % (good.get("_error", ""), state(BOOK)))

    print("== 4. removing a linked client releases it at once; restoring links nothing")
    db.sql("update clients set deleted = true where id = %s" % q(NEW))
    ok(state(BOOK) == "unlinked|||", "released by the removal itself (%s)" % state(BOOK))
    h = hist()
    ok(len(h) == 2 and h[1]["client_id"] == NEW and h[1]["why"].startswith("client removed"), "history: who/when/why (%s)" % h[-1:])
    good = g["link"](OWN, SAL, CAR)
    ok("_error" not in good and state(BOOK).startswith("linked|" + CAR), "free for any live client: linked to Car Laundry (%s)" % good.get("_error", ""))
    g["link"](OWN, SAL, None)
    db.sql("update clients set deleted = false where id = %s" % q(NEW))
    ok(state(BOOK) == "unlinked|||", "restored: nothing linked by itself (%s)" % state(BOOK))
    ok(db.one("select company_name from tally_link_history where client_id = %s order by at desc limit 1" % q(NEW)) == SAL, "the history names the company to offer again")
    good = g["link"](OWN, SAL, OLD)
    ok("no such client" in good.get("_error", ""), "a removed client is never linked (%s)" % good.get("_error", ""))
    # the same GUID held by a removed client's other book (released before the link: no "already linked to")
    db.sql("set session_replication_role = replica; update tally_links set state = 'linked', client_id = %s where book_id = %s; set session_replication_role = default;" % (q(OLD), q(BOOK)))
    good = g["link"](OWN, SAL, NEW)
    ok("_error" not in good and state(BOOK).startswith("linked|" + NEW), "a record still held by a removed client is freed by the link itself (%s)" % good.get("_error", ""))

    print("== 5. grants")
    good, n_ = g["as_role"]("authenticated", g["STAFF"], "select count(*) from tally_link_history")
    ok(good and int(n_) >= 2, "a member reads the firm's history (%s)" % n_)
    good, n_ = g["as_role"]("authenticated", g["O2"], "select count(*) from tally_link_history")
    ok(good and n_ == "0", "another firm's member none (%s)" % n_)
    good, out = g["as_role"]("authenticated", OWN, "insert into tally_link_history (firm_id, company_name, action) values (%s, 'x', 'released')" % q(F))
    ok(not good and "permission denied" in out, "no direct write")
    priv = lambda role, fn: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(fn)))
    for fn in ("public.tally_link_release_client(uuid,text,uuid,text)", "public.tally_link_release_removed(uuid)"):
        ok(priv("authenticated", fn) == "false" and priv("anon", fn) == "false" and priv("service_role", fn) == "true", fn + ": the service role only")
    ok(priv("authenticated", "public.tally_link_set(text,text)") == "true" and priv("anon", "public.tally_link_set(text,text)") == "false", "tally_link_set keeps its grants")
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
