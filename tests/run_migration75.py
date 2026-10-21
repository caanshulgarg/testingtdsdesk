"""python3 run_migration75.py - migration-75-zoho-books (13-Oct-2026, branch zoho-books). On throwaway PostgreSQL (pg_stand, port
30775 unless PG75M_PORT; never a real database), built with staging's migrations in staging's order up to 74 (zoho_stand.py),
some cloud-copy rows put in, then 75 run TWICE.
  0. the file: one transaction, lock_timeout, no 'delete from', nothing dropped, truncated or renamed, no existing function
     replaced (every function it makes is new, zoho_*), every function security definer with a fixed search_path; md5 printed
  1. running it (twice) changes no row there was; the three source columns read 'tally' on every existing row
  2. row-level security: a member reads only the firm's own rows of every zoho_ table; a member writes nothing; anon reads
     nothing; the hash and lease columns are never readable; vault and the service functions are not executable by members
  3. the functions' own rules: Vault names only zoho:<firm>:<grant>:refresh|access; the cron key; a client of another PAN is
     never linked; only the owner links and disconnects; disconnect deletes nothing; zoho_gone holds a list that would take a
     fifth (or all) at once; zoho_api_take: 90 a minute, 95% of the day's cap; a posted entry is never marked otherwise
RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import zoho_stand
M75 = zoho_stand.M75
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2, OWN, STF, OWN2 = "99999999-9999-9999-9999-999999999990", "88888888-8888-8888-8888-888888888880", "55555555-5555-5555-5555-555555555550", "66666666-6666-6666-6666-666666666660", "77777777-7777-7777-7777-777777777770"
B0 = "f79e4bc3-871d-4482-874d-000000000075"
print("== 0. the file")
ok(os.path.exists(M75), "the migration file is there")
text = open(M75).read()
print("   md5 %s, %d bytes" % (hashlib.md5(text.encode()).hexdigest(), len(text)))
body = re.sub(r"--[^\n]*", "", text)
ok(body.count("\nbegin;") == 1 and body.rstrip().endswith("commit;") and "lock_timeout" in body, "one transaction, with lock_timeout")
ok(not re.search(r"\bdelete\s+from\b", text, re.I), "no 'delete from' anywhere in the file, comments included")
ok(not re.search(r"\b(drop\s+(table|column|function|schema|view|index|policy|trigger)|truncate|alter\s+table\s+\S+\s+rename|drop\s+not\s+null)\b", body, re.I), "nothing dropped, truncated or renamed")
fns = re.findall(r"create or replace function public\.([a-z_0-9]+)\(", body)
ok(fns and all(f.startswith("zoho_") for f in fns), "every function is new, named zoho_* (%d): no existing function replaced" % len(fns))
defs = re.findall(r"create or replace function public\.[a-z_0-9]+\([^)]*\)[^$]*?\$\$", body, re.S)
ok(all("security definer" in d and "search_path" in d for d in defs), "every function is security definer with a fixed search_path")

db = zoho_stand.build(int(os.environ.get("PG75M_PORT", "30775")), run75=False)
try:
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members (user_id, firm_id, name, role, active) values (%(O)s, %(F)s, 'O', 'owner', true), (%(S)s, %(F)s, 'S', 'staff', true), (%(O2)s, %(F2)s, 'O2', 'owner', true);
      insert into clients (id, firm_id, name, gstin) values ('c1', %(F)s, 'Client', '27AAACZ1234Z1ZG'), ('c2', %(F)s, 'Other PAN', '27AAACX9999X1ZA'), ('c9', %(F2)s, 'Theirs', '');
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(B)s, %(F)s, 'c1', 'TALLY CO', '2026-04-01');
      insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno) values (%(B)s, %(F)s, 'g1', '2026-05-01', 'Sales', '1');
      insert into tally_ledgers (book_id, firm_id, name, parent) values (%(B)s, %(F)s, 'Sales', 'Sales Accounts');""" % {"F": q(F), "F2": q(F2), "O": q(OWN), "S": q(STF), "O2": q(OWN2), "B": q(B0)})
    def counts():
        return {r["t"]: r["n"] for r in db.rows("select 'v' as t, count(*)::text as n from tally_vouchers union all select 'l', count(*)::text from tally_ledgers union all select 'b', count(*)::text from tally_books union all select 'c', count(*)::text from clients")}
    before = counts()
    print("== 1. running it twice")
    for i in (1, 2):
        rc, err = zoho_stand.psql_file(db, M75)
        ok(rc == 0, "run %d: no error %s" % (i, err[-300:] if rc else ""))
    ok(counts() == before, "no row added or taken away by running it (%s)" % counts())
    src = db.rows("select (select string_agg(distinct source, ',') from tally_books) as b, (select string_agg(distinct source, ',') from tally_vouchers) as v, (select string_agg(distinct source, ',') from tally_ledgers) as l")[0]
    ok(src == {"b": "tally", "v": "tally", "l": "tally"}, "every existing row reads source 'tally' (%s)" % src)
    ok(db.one("select count(*) from cron.job where jobname like 'zoho%'") == "0", "the schedule is not in this file (75b, staging only)")
    M75B = os.path.join(os.path.dirname(M75), "migration-75b-zoho-cron-staging.sql")
    tb = open(M75B).read()
    print("   75b md5 %s" % hashlib.md5(tb.encode()).hexdigest())
    urls = set(re.findall(r"https://([a-z0-9]+)\.supabase\.co", tb))
    ok(urls == {"qbocskaiewaxqcvaunzc"} and not re.search(r"\bdelete\s+from\b|unschedule|\bdrop\b", tb, re.I), "75b: staging's URL only (%s); nothing removed or unscheduled" % sorted(urls))
    for i in (1, 2):
        rc, err = zoho_stand.psql_file(db, M75B)
        ok(rc == 0, "75b run %d: no error %s" % (i, err[-200:] if rc else ""))
    job = db.rows("select schedule, command from cron.job where jobname = 'zoho-books-sync'")
    ok(len(job) == 1 and job[0]["schedule"] == "*/5 * * * *" and "x-fincom-zoho-cron" in job[0]["command"] and "zoho_cron_key" in job[0]["command"] and "next_sync_at, now()) <= now()" in job[0]["command"],
       "75b: one job, every 5 minutes, the key from Vault, only when an organisation is due")
    print("== 2. row-level security")
    G = db.one("select public.zoho_grant_save(%s, %s, 'x', '[{\"id\": \"o1\", \"name\": \"Org\", \"gstin\": \"27AAACZ1234Z1ZG\"}, {\"id\": \"o2\", \"name\": \"Other\", \"gstin\": \"27AAACX1111X1ZA\"}]'::jsonb, now() + interval '1 hour')" % (q(F), q(OWN)))
    L = json.loads(db.one("select public.zoho_link(%s, %s, 'o1', 'c1', '2026-04-01')::text" % (q(OWN), q(G))))
    C = L["connection"]
    G2 = db.one("select public.zoho_grant_save(%s, %s, 'x', '[{\"id\": \"o9\", \"name\": \"Theirs\", \"gstin\": \"\"}]'::jsonb, now())" % (q(F2), q(OWN2)))
    db.one("select public.zoho_link(%s, %s, 'o9', 'c9', null)::text" % (q(OWN2), q(G2)))
    J0 = json.loads(db.one("select public.zoho_post_begin(%s, 'c1', '[\"e1\"]'::jsonb)::text" % q(OWN)))["job"]
    db.sql("select public.zoho_post_mark(%s, 'e1', 'bill', 'posted', 'z1', 'B-1', 'ok', null); select public.zoho_post_end(%s, 'done', '[]'::jsonb, 'ok');" % (q(J0), q(J0)))
    def as_user(uid, sql, role="authenticated"):
        try: return db.rows("set role %s; set fincom.uid = %s; %s" % (role, q(uid), sql))
        finally: db.sql("reset role")
    for t in ("zoho_grants", "zoho_connections", "zoho_posts", "zoho_post_jobs", "zoho_log"):
        sel = "id, firm_id" if t in ("zoho_grants", "zoho_connections") else "firm_id"
        mine = as_user(STF, "select %s from %s" % (sel, t)); theirs = as_user(OWN2, "select %s from %s" % (sel, t))
        ok(mine and all(r["firm_id"] == F for r in mine) and all(r["firm_id"] == F2 for r in theirs), "%s: each firm reads only its own rows (%d / %d)" % (t, len(mine), len(theirs)))
    for sql in ("select hook_hash from zoho_connections", "select post_lease_by from zoho_connections", "select * from zoho_seen", "select * from zoho_objects", "select * from zoho_api_usage",
                "select * from zoho_oauth_states", "select * from zoho_sync_state", "select * from vault.secrets", "select public.zoho_secret_get('zoho:x')",
                "insert into zoho_log (firm_id, kind) values ('%s', 'x')" % F, "update zoho_connections set status = 'x'", "select public.zoho_link('%s', '%s', 'o2', 'c1', null)" % (OWN, G),
                "select public.zoho_ingest('%s', '[]', '[]', '[]')" % C, "select public.zoho_cron_ok('x')"):
        try: as_user(OWN, sql); ok(False, "a member cannot: " + sql)
        except RuntimeError as e: ok("permission denied" in str(e), "a member cannot: %s" % sql[:90])
    for sql in ("select * from zoho_connections", "select public.zoho_status()"):
        try: as_user(OWN, sql, role="anon"); ok(False, "anon cannot: " + sql)
        except RuntimeError as e: ok("permission denied" in str(e), "anon cannot: %s" % sql)
    st = json.loads(as_user(STF, "select public.zoho_status()::text as s")[0]["s"])
    ok(len(st["connections"]) == 1 and st["connections"][0]["client"] == "c1" and st["connections"][0]["posts"]["posted"] == 1 and "hook_hash" not in json.dumps(st), "zoho_status: the firm's own organisation, its postings; no hash")
    print("== 3. the functions' own rules")
    for name, good in (("zoho:%s:%s:refresh" % (F, G), True), ("zoho:%s:%s:other" % (F, G), False), ("gsp:taxpro:aspid", False), ("zoho_cron_key", False)):
        try: db.sql("select public.zoho_secret_put(%s, 'v')" % q(name)); ok(good, "zoho_secret_put %s: %s" % (name[:40], "kept" if good else "should be refused"))
        except RuntimeError: ok(not good, "zoho_secret_put refuses %s" % name[:40])
    ok(db.one("select public.zoho_secret_get('gsp:taxpro:aspid') is null") == "t", "zoho_secret_get reads only zoho: names")
    key = db.one("select decrypted_secret from vault.decrypted_secrets where name = 'zoho_cron_key'")
    ok(key and len(key) == 64 and db.one("select public.zoho_cron_ok(%s)" % q(key)) == "t" and db.one("select public.zoho_cron_ok('')") == "f", "the cron key made once in Vault; only it passes")
    try: db.one("select public.zoho_link(%s, %s, 'o1', 'c2', null)" % (q(OWN), q(G))); ok(False, "a client of another PAN is refused")
    except RuntimeError as e: ok("is not this client" in str(e), "a client of another PAN is never linked")
    try: db.one("select public.zoho_link(%s, %s, 'o2', 'c1', null)" % (q(STF), q(G))); ok(False, "staff cannot link")
    except RuntimeError as e: ok("only the firm" in str(e), "staff cannot link (the owner only)")
    try: db.one("select public.zoho_disconnect(%s, %s)" % (q(STF), q(C))); ok(False, "staff cannot disconnect")
    except RuntimeError as e: ok("only the firm" in str(e), "staff cannot disconnect")
    bk = db.rows("select source, company, client_id, from_date::text as f from tally_books where book_id = %s" % q(L["book"]))[0]
    ok(bk == {"source": "zoho", "company": "Zoho Books · Org", "client_id": "c1", "f": "2026-04-01"}, "the linked organisation's book: source zoho (%s)" % bk)
    # documents in, through the one entry path; then deletions
    V = [{"guid": "zoho-invoice-%d" % i, "day": "2026-05-0%d" % (1 + i % 8), "alter": 100 + i, "type": "Sales", "no": "INV-%d" % i, "party": "Alpha", "gst": {"reg": "Regular", "country": "India", "rcm": False, "nature": "", "taxability": "Taxable", "supply": "Goods", "ineligible": False, "mixed": False}} for i in range(12)]
    Ls = [l for i in range(12) for l in (["zoho-invoice-%d" % i, "Sales", 100, "8471", 18, []], ["zoho-invoice-%d" % i, "Alpha", -100, "", None, [["INV-%d" % i, "New Ref", -100]]])]
    seen = [["invoices", str(i), "zoho-invoice-%d" % i, 100 + i, None] for i in range(12)]
    r = json.loads(db.one("select public.zoho_ingest(%s, %s::jsonb, %s::jsonb, %s::jsonb)::text" % (q(C), q(json.dumps(V)), q(json.dumps(Ls)), q(json.dumps(seen)))))
    nv = db.rows("select count(*)::int as n, string_agg(distinct source, ',') as s, string_agg(distinct gst_nature is not null::text, ',') as g from tally_vouchers where book_id = %s" % q(L["book"]))[0]
    ok(r.get("ok") and int(nv["n"]) == 12 and nv["s"] == "zoho", "12 entries in through tally_ingest_entries, source zoho (%s)" % nv)
    ok(float(db.one("select sum(amount) from tally_ledger_day where book_id = %s and ledger = 'Sales'" % q(L["book"]))) == 1200, "the ready totals made for their days")
    try: db.sql("select public.zoho_ingest(%s, '[{\"guid\": \"tally-guid-1\", \"day\": \"2026-05-01\"}]'::jsonb, '[]'::jsonb, '[]'::jsonb)" % q(C)); ok(False, "a non-Zoho entry id is refused")
    except RuntimeError as e: ok("not a Zoho entry id" in str(e), "an entry id that is not zoho-<kind>-<id> is refused (never touches a Tally entry)")
    # a month the owner locked takes nothing: the others go in, the locked one is held (asked again daily), never forced
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month) values (%s, 'c1', %s, '2026-06-01')" % (q(F), q(L["book"])))
    V2 = [dict(V[0], guid="zoho-invoice-90", no="INV-90", day="2026-06-03", alter=900), dict(V[0], guid="zoho-invoice-91", no="INV-91", day="2026-05-20", alter=901)]
    L2 = [["zoho-invoice-90", "Sales", 50, "", None, []], ["zoho-invoice-90", "Alpha", -50, "", None, []], ["zoho-invoice-91", "Sales", 70, "", None, []], ["zoho-invoice-91", "Alpha", -70, "", None, []]]
    r = json.loads(db.one("select public.zoho_ingest(%s, %s::jsonb, %s::jsonb, %s::jsonb)::text" % (q(C), q(json.dumps(V2)), q(json.dumps(L2)), q(json.dumps([["invoices", "90", "zoho-invoice-90", 900, None], ["invoices", "91", "zoho-invoice-91", 901, None]])))))
    have = {x["guid"] for x in db.rows("select guid from tally_vouchers where guid in ('zoho-invoice-90', 'zoho-invoice-91')")}
    held = db.one("select skipped from zoho_seen where zoho_id = '90'")
    ok(have == {"zoho-invoice-91"} and (held or "").startswith("month locked") and r.get("sent") == 1, "a locked month (June): May's invoice goes in, June's is held as '%s', nothing forced" % held)
    ch = json.loads(db.one("select public.zoho_changed(%s, 'invoices', '[[\"90\", 900], [\"91\", 901]]'::jsonb)::text" % q(C)))
    db.sql("update zoho_seen set seen_at = now() - interval '25 hours' where zoho_id = '90'")
    ch2 = json.loads(db.one("select public.zoho_changed(%s, 'invoices', '[[\"90\", 900], [\"91\", 901]]'::jsonb)::text" % q(C)))
    ok(ch == [] and ch2 == ["90"], "the held one is asked of Zoho again a day later, the stored one not (%s, %s)" % (ch, ch2))
    g = json.loads(db.one("select public.zoho_gone(%s, 'invoices', %s::jsonb, false)::text" % (q(C), q(json.dumps([str(i) for i in range(11)] + ["90", "91"])))))
    ok(g.get("gone") == 1 and db.one("select deleted_at is not null from tally_vouchers where guid = 'zoho-invoice-11'") == "t", "one invoice no longer listed: its entry marked deleted (kept)")
    g = json.loads(db.one("select public.zoho_gone(%s, 'invoices', %s::jsonb, false)::text" % (q(C), q(json.dumps([str(i) for i in range(6)])))))
    ok(g.get("refused") and db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(L["book"])) == "12", "seven of thirteen at once: held, nothing marked (%s)" % g)
    g = json.loads(db.one("select public.zoho_gone(%s, 'invoices', '[]'::jsonb, false)::text" % q(C)))
    ok(g.get("refused"), "an empty list while entries are held: held")
    ok(db.one("select count(*) from zoho_log where kind = 'error' and message like '%%no longer listed%%'") == "2", "and said in the log, twice")
    db.sql("delete from zoho_api_usage")   # (the test's own reset of a throwaway database; the migration never removes rows)
    # the 91 calls in ONE statement, so one now(): 75 counts by the wall-clock minute, and 91 separate statements that
    # crossed :00 were all let through (CI run 39637004551; 99 makes it any 60 seconds, tests/run_migration99.py)
    takes = db.one("select string_agg((public.zoho_api_take(%s, 1, 90))->>'ok', ',' order by i) from generate_series(1, 91) i" % q(C)).split(",")
    ok(takes.count("true") == 90 and takes[-1] == "false", "zoho_api_take: 90 calls a minute")
    db.sql("update zoho_api_usage set calls = 950, minute_calls = 0")
    t = json.loads(db.one("select public.zoho_api_take(%s, 1, 90)::text" % q(C)))
    ok(t["ok"] is False and t["daily"] is True and t["wait"] > 0, "and stops at 95%% of the day's cap, until midnight IST (%s)" % t)
    j = json.loads(db.one("select public.zoho_post_begin(%s, 'c1', '[\"e1\"]'::jsonb)::text" % q(OWN)))
    ok(j["ok"] and j["known"]["e1"]["state"] == "posted", "a new posting run knows e1 was posted")
    j2 = json.loads(db.one("select public.zoho_post_begin(%s, 'c1', '[\"e2\"]'::jsonb)::text" % q(STF)))
    ok(not j2["ok"] and j2.get("busy"), "a second posting run for the same organisation waits (one at a time)")
    db.sql("select public.zoho_post_mark(%s, 'e1', 'bill', 'error', null, null, 'x', null)" % q(j["job"]))
    ok(db.one("select state from zoho_posts where fincom_id = 'e1'") == "posted", "a posted entry is never marked otherwise")
    db.sql("select public.zoho_post_end(%s, 'done', '[]'::jsonb, 'x')" % q(j["job"]))
    ok(json.loads(db.one("select public.zoho_post_begin(%s, 'c1', '[]'::jsonb)::text" % q(STF)))["ok"], "the lease is given back at the end of a run")
    nb = db.one("select count(*) from tally_vouchers")
    d = json.loads(db.one("select public.zoho_disconnect(%s, %s)::text" % (q(OWN), q(C))))
    ok(d["ok"] and d["revoke"] and db.one("select count(*) from tally_vouchers") == nb and db.one("select status from zoho_connections where id = %s" % q(C)) == "disconnected", "disconnect: the sign-in to be revoked, nothing deleted")
finally:
    db.stop()
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
