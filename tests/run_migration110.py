"""python3 run_migration110.py - migration-110-tally-link-record (26-Oct-2026, branch next-link-record; NOT run on staging):
ONE cloud link record per client <-> Tally company (public.tally_links), keyed by the Tally company's GUID. On a
throwaway PostgreSQL (pg_stand, port 31100 unless PG110_PORT; never a real database), built 32 -> ... -> 53 -> 54 in
staging's order with made-up firms, clients and companies, then 110 twice. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, no "delete from", no truncate); the only functions
     replaced are tally_company_link, tally_post_enqueue_core and tally_post_enqueue_to; names no real database; md5
  1. runs twice; nothing deleted; the backfill: one record per linked company of a client not deleted, posting allowed,
     the GUID from tally_sync_cursor or the beat, a shared GUID kept once; the counts (NOTICE and tally_links_backfill)
  2. RLS and grants: a member reads the firm's records only; another firm's member none; no direct insert or update by a
     member; anon nothing; the backfill log the service role's only; the member functions for authenticated and
     service_role, the helpers for the service role only
  3. link (tally_link_set): the record and its mirror (tally_companies.client_id, tally_books.client_id); posting
     allowed; a viewer refused; the older tally_company_link goes through it
  4. a GUID linked to another client of the firm: "already linked to <client>"; nothing changed
  5. renamed in Tally (the same GUID): linking the new name to the same client moves the link and its books; tally-ingest's
     follow (tally_link_follow) waits while the old name is still reported, then moves it
  6. allow / stop posting (tally_link_posting): the version must be the record's (an out-of-date view refused); the
     posting guard (tally_post_enqueue_to) reads the record, not clients.data postTo
  7. a link written straight into tally_companies (tally-ingest's auto-link) goes into the record; a GUID of another
     client is not linked there; unlink: the record unlinked, posting stopped
  8. the data location (a copied data folder keeps the GUID; docs/tally-72-proof.md): the first place data comes from is
     chosen; data from a second place (another computer and data folder) is not applied and the place waits; only an
     owner chooses; after a choice the other place's data is refused; a rename is followed only from the chosen place; a
     new name with the linked GUID from another place is refused, never merged
RED_WITHOUT_110=1: the same checks without running the file (0 holds; 1 to 7 fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M110 = os.path.join(SQLDIR, "migration-110-tally-link-record.sql")
RED = os.environ.get("RED_WITHOUT_110") == "1"
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]

text = open(M110).read() if os.path.exists(M110) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M110), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in text.lower() and not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", code) and not re.search(r"\btruncate\b", code),
   "add-only: nothing dropped, deleted or truncated (comments included for 'delete from')")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
OLD = {"tally_company_link", "tally_post_enqueue_core", "tally_post_enqueue_to"}
ok(OLD <= set(made) and not (set(made) - OLD - {"tally_link_guid", "tally_link_loc", "tally_link_move_name", "tally_link_write", "tally_link_set", "tally_link_posting", "tally_link_guard", "tally_link_mirror", "tally_link_follow",
                                                  "tally_link_place_check", "tally_link_place_choose", "tally_link_post_to"}),
   "replaced only %s; new: %s" % (sorted(OLD), sorted(set(made) - OLD)))
ok("cl.data->>'postto'" not in code.split("create or replace function public.tally_post_enqueue_core")[1].split("end $function$")[0]
   and "cl.data->>'postto'" not in code.split("create or replace function public.tally_post_enqueue_to")[1].split("end $function$")[0],
   "the posting guard no longer reads clients.data postTo")
m54 = open(os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")).read()
def body(t, name):
    i = t.index("create or replace function public." + name + "("); return t[i:t.index("end $function$;", i)]
norm = lambda s: [l for l in s.splitlines() if "postTo" not in l and "tally_link_post_to" not in l and "allowed text" not in l and "the one Tally company" not in l and "Choose the Tally company" not in l
                  and "Posting into Tally is stopped" not in l and "Link ' ||" not in l and "case when exists (select 1 from tally_links" not in l]
ok(norm(body(m54, "tally_post_enqueue_core")) == norm(body(text, "tally_post_enqueue_core")) and norm(body(m54, "tally_post_enqueue_to")) == norm(body(text, "tally_post_enqueue_to")),
   "the guard is migration 54's text but for the company allowed (every other line the same)")

F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEWER, O2 = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
D1, D9 = "d1000000-0000-0000-0000-000000000001", "d9000000-0000-0000-0000-000000000009"
BK = lambda n: "b%07d-0000-0000-0000-000000000107" % n
G = lambda s: "a1b2c3d4-0000-0000-0000-%012d" % s
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%SZ")
db = pg_stand.start(int(os.environ.get("PG110_PORT") or 31100))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_role(role, uid, stmt):
    try: return True, db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpc(uid, stmt, role="authenticated"):
    good, out = as_role(role, uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
def svc(stmt): return rpc(None, stmt, "service_role")
link = lambda uid, co, cl: rpc(uid, "select tally_link_set(%s, %s)::text" % (q(co), "null" if cl is None else q(cl)))
rec = lambda book: (db.rows("select client_id, coalesce(company_guid, '') g, company_name, posting_allowed::text p, state, version::text v, how from tally_links where book_id = %s" % q(book)) or [{}])[0]
mirror = lambda co: (db.rows("select coalesce(client_id, '') c, book_id::text b from tally_companies where firm_id = %s and company = %s" % (q(F), q(co))) or [{}])[0]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    beat = lambda cos: q(json.dumps({"computer": "NW144", "beat": {"at": iso(NOW), "companies": [{"name": n, "guid": g} for n, g in cos]},
                                     "bridges": {"go-aaaa000001": {"at": iso(NOW), "computer": "NW144", "user": "anshul", "mode": "main", "open": [n for n, _ in cos],
                                                                      "tallyPort": 9005, "dataFolder": "C:\\Users\\anshul\\TallyPrime\\Data"}}}))
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
      grant select on members to authenticated, service_role;
      insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(O2)s, %(F2)s, 'Priya', 'owner', true);
      create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.4.7', %(I1)s, %(O)s),
        (%(D9)s, %(F2)s, 'OTHER', 'h9', '2.4.7', '{}', %(O2)s);
      -- as on staging: clients (the data blob, its GSTIN, deleted) and tally_companies (migration.sql)
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, updated_at timestamptz default now(), primary key (firm_id, id));
      create table if not exists public.tally_companies (firm_id uuid not null references public.firms(id) on delete cascade, company text not null, client_id text, gstin text,
        device_id uuid references public.tally_devices(id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz, linked_by uuid,
        book_id uuid not null default gen_random_uuid() unique, primary key (firm_id, company));
      alter table public.tally_companies enable row level security;
      create policy tally_companies_read on public.tally_companies for select to authenticated using (firm_id = public.my_firm());
      grant select on public.tally_companies to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "O2": q(O2), "D1": q(D1), "D9": q(D9),
        "I1": beat([("AA LTD", G(2).upper()), ("BB 2026", G(32)), ("ITS EASY", G(7)), ("ITSEASY SOLUTIONS", G(7)), ("NEW CO", G(5)), ("LATER CO", G(8)), ("AUTO CO", G(9)), ("TWIN CO", G(9))])})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    old = (NOW - datetime.timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S+00")
    clients = [("c1", "ZZ", {"postTo": "ZZ CO", "choices": {"postTo": {"value": "ZZ CO", "state": "confirmed"}}}, False, "27AAAAA0001A1Z5"),
               ("c2", "AA", {}, False, ""), ("c3", "BB", {"postTo": "", "choices": {"postTo": {"value": "", "state": "confirmed"}}}, False, ""),
               ("c4", "DD gone", {"postTo": "DD CO"}, True, ""), ("c5", "EE", {"postTo": "EE CO"}, False, ""), ("c6", "Same one", {"postTo": "OTHER CO", "choices": {"postTo": {"value": "OTHER CO", "state": "confirmed"}}}, False, ""),
               ("c7", "Same two", {}, False, ""), ("ca", "its easy", {}, False, ""), ("cb", "ITSEasy Solutions Pvt Ltd", {}, False, ""), ("cg", "Wrong PAN", {}, False, "27BBBBB0002B1Z5"), ("ch", "Auto", {}, False, ""), ("cl", "Later", {}, False, ""), ("cu", "Upload", {}, False, "")]
    db.sql("insert into clients (id, firm_id, name, data, deleted, gstin) values " + ",".join("(%s, %s, %s, %s, %s, %s)" % (q(i), q(F), q(n), q(json.dumps(d)), "true" if dl else "false", q(g) if g else "null") for i, n, d, dl, g in clients)
           + ", ('c9', %s, 'YY', '{\"postTo\": \"YY CO\"}', false, null);" % q(F2))
    cos = [(1, "ZZ CO", "c1", "27AAAAA0001A1Z5"), (2, "AA LTD", "c2", None), (31, "BB 2025", "c3", None), (32, "BB 2026", "c3", None), (4, "DD CO", "c4", None),
           (61, "SAME CO", "c6", None), (62, "SAME CO OLD", "c7", None), (5, "NEW CO", None, None), (7, "ITS EASY", None, None), (71, "ITSEASY SOLUTIONS", None, None),
           (8, "LATER CO", None, None), (10, "PAN CO", None, "27CCCCC0003C1Z5"), (9, "AUTO CO", None, None), (91, "TWIN CO", None, None), (11, "LATER CO OLD", None, None), (12, "UPLOAD CO", None, None)]
    db.sql("insert into tally_companies (firm_id, company, client_id, gstin, device_id, last_seen, linked_at, book_id) values " + ",".join(
        "(%s, %s, %s, %s, %s, %s, %s, %s)" % (q(F), q(n), q(c) if c else "null", q(g) if g else "null", q(D1), q(old), q(old) if c else "null", q(BK(b))) for b, n, c, g in cos)
        + ", (%s, 'YY CO', 'c9', null, %s, now(), now(), %s);" % (q(F2), q(D9), q(BK(99))))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company) values " + ",".join("(%s, %s, %s, %s)" % (q(BK(b)), q(F), q(c), q(n)) for b, n, c, _ in cos if c) + ";")
    # the GUIDs a linked book keeps (tally_sync_cursor, migration 32): ZZ CO's; SAME CO and SAME CO OLD share one (two copies, two clients)
    db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid) values (%s, %s, %s), (%s, %s, %s), (%s, %s, %s), (%s, %s, %s);"
           % (q(BK(1)), q(F), q(G(1)), q(BK(61)), q(F), q(G(6)), q(BK(62)), q(F), q(G(6)), q(BK(31)), q(F), q(G(31))))
    tables = ["tally_companies", "tally_books", "clients", "tally_devices", "tally_sync_cursor", "members"]
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in tables}
    before = counts()

    print("== 1. runs twice; the backfill")
    notes = []
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_110: not run)" % n); continue
        r = psql_text(text); notes.append(r.stderr or "")
        ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
        ok(counts() == before, "run %d: nothing deleted or added elsewhere (%s)" % (n, counts()))
    have = lambda: db.one("select to_regclass('public.tally_links') is not null") == "t"
    if not have():
        ok(False, "public.tally_links is there"); raise SystemExit
    ok(db.one("select count(*) from tally_links") == "7", "7 records: ZZ CO, AA LTD, BB 2025, BB 2026, SAME CO, SAME CO OLD, YY CO (the other firm's) and none for DD CO (its client deleted): %s"
       % db.one("select string_agg(company_name, ', ' order by company_name) from tally_links"))
    ok(rec(BK(4)) == {}, "DD CO: its client is deleted, no record")
    r1 = rec(BK(1))
    ok(r1.get("client_id") == "c1" and r1.get("g") == G(1) and r1.get("p") == "true" and r1.get("how") == "backfill" and r1.get("state") == "linked", "ZZ CO: c1, the GUID of its book (tally_sync_cursor), posting allowed, backfill (%s)" % r1)
    ok(rec(BK(2)).get("g") == G(2) and rec(BK(2)).get("p") == "true", "AA LTD: the GUID from the beat (lower case), posting allowed although its postTo was empty (%s)" % rec(BK(2)))
    ok(rec(BK(31)).get("g") == G(31) and rec(BK(32)).get("g") == G(32) and rec(BK(31)).get("p") == rec(BK(32)).get("p") == "true", "BB: a company a year, both linked and allowed (a person's Stop posting gives way: the owner's decision)")
    s6, s7 = rec(BK(61)), rec(BK(62))
    ok(sorted([s6.get("g"), s7.get("g")]) == ["", G(6)], "SAME CO / SAME CO OLD share a GUID: kept on one only (%s / %s)" % (s6.get("g"), s7.get("g")))
    k = json.loads(db.one("select counts::text from tally_links_backfill order by id limit 1"))
    k2 = json.loads(db.one("select counts::text from tally_links_backfill order by id desc limit 1"))
    print("     counts (first run): " + json.dumps(k))
    want = {"linked_in_tally_companies": 8, "linked_to_deleted_or_missing_client": 1, "records_added_now": 7, "records_linked": 7, "records_with_guid": 5, "records_without_guid": 2,
            "records_sharing_a_guid_kept_without": 1, "clients_linked": 6, "clients_posting_allowed": 6, "postto_not_confirmed_now_allowed": 3, "postto_stopped_by_a_person_now_allowed": 1,
            "postto_names_a_company_not_linked": 1, "postto_set_without_any_link": 1}
    ok(all(k.get(x) == v for x, v in want.items()), "the first run's counts: %s" % {x: (k.get(x), v) for x, v in want.items() if k.get(x) != v})
    ok(k2.get("records_added_now") == 0 and k2.get("records_linked") == 7, "the second run adds nothing (%s)" % k2.get("records_added_now"))
    ok(all("tally_links backfill:" in n_ and "NOTICE" in n_ for n_ in notes), "the counts said in a NOTICE each run")

    print("== 2. RLS and grants")
    good, n_ = as_role("authenticated", STAFF, "select count(*) from tally_links")
    ok(good and n_ == "6", "a member reads the firm's 6 records (%s)" % n_)
    good, n_ = as_role("authenticated", O2, "select count(*) from tally_links")
    ok(good and n_ == "1", "another firm's member reads only its own (%s)" % n_)
    good, out = as_role("authenticated", OWNER, "update tally_links set posting_allowed = false")
    ok(not good and "permission denied" in out, "a member cannot update a record directly")
    good, out = as_role("authenticated", OWNER, "insert into tally_links (firm_id, book_id, client_id, company_name) values (%s, gen_random_uuid(), 'c2', 'X')" % q(F))
    ok(not good and "permission denied" in out, "nor insert one")
    good, out = as_role("anon", None, "select count(*) from tally_links")
    ok(not good and "permission denied" in out, "anon reads nothing")
    good, out = as_role("authenticated", OWNER, "select count(*) from tally_links_backfill")
    ok(not good and "permission denied" in out, "the backfill log: not for members")
    ok(all(db.one("select relrowsecurity::text from pg_class where oid = 'public.%s'::regclass" % t) == "true" for t in ("tally_links", "tally_links_backfill", "tally_link_places")), "RLS on the three tables")
    good, out = as_role("authenticated", OWNER, "update tally_link_places set state = 'chosen'")
    ok(not good and "permission denied" in out, "a member cannot change a data location directly")
    priv = lambda role, fn: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(fn)))
    MEMBER = ["public.tally_link_set(text,text)", "public.tally_link_posting(uuid,boolean,bigint)", "public.tally_company_link(text,text)", "public.tally_link_place_choose(uuid,text)"]
    HELP = ["public.tally_link_guid(uuid,text,uuid)", "public.tally_link_loc(uuid,text,text)", "public.tally_link_move_name(uuid,uuid,text)", "public.tally_link_write(uuid,uuid,text,uuid,text)",
            "public.tally_link_follow(uuid,text,text,uuid,text)", "public.tally_link_place_check(uuid,uuid,uuid,text)", "public.tally_link_post_to(uuid,text,text)"]
    ok(all(priv("authenticated", f) == "true" and priv("service_role", f) == "true" and priv("anon", f) == "false" for f in MEMBER), "the member functions: authenticated and service_role, not anon")
    ok(all(priv("authenticated", f) == "false" and priv("anon", f) == "false" and priv("service_role", f) == "true" for f in HELP), "the helpers: the service role only")
    ok(priv("authenticated", "public.tally_post_enqueue_to(uuid,text,jsonb,text,uuid)") == "true" and priv("authenticated", "public.tally_post_enqueue_core(uuid,text,jsonb,uuid,text)") == "false"
       and priv("anon", "public.tally_post_enqueue_to(uuid,text,jsonb,text,uuid)") == "false", "the guard keeps 54's grants (enqueue_to for members, the core for nobody but the service role)")
    sd = db.rows("select p.proname, p.prosecdef::text sd, array_to_string(p.proconfig, ';') cfg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tally_link%'")
    ok(len(sd) == 12 and all(x["sd"] == "true" and "search_path=public, pg_temp" in x["cfg"] for x in sd), "every new function security definer, search_path public, pg_temp (%d)" % len(sd))

    print("== 3. link")
    r = link(STAFF, "NEW CO", "c5")
    ok(r.get("client_id") == "c5" and r.get("company_guid") == G(5) and r.get("posting_allowed") is True and r.get("how") == "person" and r.get("linked_by") == STAFF,
       "staff links NEW CO to EE: the record, keyed by its GUID, posting allowed, by Ravi (%s)" % {x: r.get(x) for x in ("client_id", "company_guid", "posting_allowed", "how", "_error")})
    ok(mirror("NEW CO").get("c") == "c5", "the mirror: tally_companies.client_id")
    r = link(VIEWER, "LATER CO", "c2")
    ok("_error" in r and "not allowed" in r["_error"], "a viewer may not link")
    r = link(O2, "NEW CO", "c9")
    ok("_error" in r and ("no computer has reported" in r["_error"] or "not allowed" in r["_error"]), "another firm's member cannot reach this firm's company")
    r = link(OWNER, "PAN CO", "cg")
    ok("_error" in r and "is not this client" in r["_error"], "a GSTIN of another PAN is refused, as before")
    r = link(OWNER, "NOT SEEN", "c2")
    ok("_error" in r and "no computer has reported NOT SEEN" in r["_error"], "a company no computer reported is refused, as before")
    good, out = as_role("authenticated", OWNER, "select tally_company_link('LATER CO', 'cl')")
    ok(good and rec(BK(8)).get("client_id") == "cl" and rec(BK(8)).get("how") == "person", "the older tally_company_link goes through the record (%s)" % rec(BK(8)))

    print("== 4. a GUID linked to another client")
    r = link(OWNER, "ITS EASY", "ca")
    ok(r.get("client_id") == "ca", "ITS EASY linked to 'its easy'")
    r = link(OWNER, "ITSEASY SOLUTIONS", "cb")
    ok("_error" in r and "already linked to its easy" in r["_error"], "ITSEASY SOLUTIONS (the same GUID) to 'ITSEasy Solutions Pvt Ltd': refused, already linked to its easy (%s)" % r.get("_error", "")[:160])
    ok(rec(BK(71)) == {} and mirror("ITSEASY SOLUTIONS").get("c") == "", "nothing changed: no record, not linked")

    print("== 5. renamed in Tally (the same GUID)")
    v0 = int(rec(BK(1))["v"])
    # ZZ CO renamed ZZ COMPANY in Tally: the beat says the new name with ZZ CO's GUID; the new name's row comes in
    db.sql("update tally_devices set info = jsonb_set(info, '{beat,companies}', (info->'beat'->'companies') || %s::jsonb) where id = %s" % (q(json.dumps([{"name": "ZZ COMPANY", "guid": G(1)}])), q(D1)))
    db.sql("insert into tally_companies (firm_id, company, device_id, last_seen) values (%s, 'ZZ COMPANY', %s, now())" % (q(F), q(D1)))
    r = link(OWNER, "ZZ COMPANY", "c1")
    ok(r.get("client_id") == "c1" and r.get("book_id") == BK(1) and r.get("company_name") == "ZZ COMPANY" and r.get("company_guid") == G(1), "linking the new name to ZZ: the same record, its name now ZZ COMPANY (%s)" % {x: r.get(x) for x in ("book_id", "company_name", "_error")})
    ok(mirror("ZZ COMPANY") == {"c": "c1", "b": BK(1)} and mirror("ZZ CO").get("c") == "" and db.one("select company from tally_books where book_id = %s" % q(BK(1))) == "ZZ COMPANY",
       "the new name has the book (its entries stay) and the link; the old name is unlinked")
    ok(int(rec(BK(1))["v"]) > v0 and rec(BK(1)).get("p") == "true", "posting still allowed")
    # tally-ingest's follow: LATER CO (linked to Later) renamed LATER CO 2 in Tally; while LATER CO is still reported, nothing moves
    db.sql("update tally_companies set last_seen = now() where firm_id = %s and company = 'LATER CO'" % q(F))
    r = svc("select to_jsonb(tally_link_follow(%s, 'LATER CO 2', %s, null, null))::text" % (q(F), q(G(8).upper())))
    ok(r is None or r == {} or r == "null" or r is None, "the old name reported within 15 minutes: nothing moves (%s)" % r)
    ok(mirror("LATER CO 2") == {} and rec(BK(8)).get("company_name") == "LATER CO", "LATER CO keeps its link")
    db.sql("update tally_companies set last_seen = now() - interval '20 minutes' where firm_id = %s and company = 'LATER CO'" % q(F))
    out = db.one("set role service_role; select tally_link_follow(%s, 'LATER CO 2', %s, null, null)" % (q(F), q(G(8).upper())))
    ok(out == "cl" and mirror("LATER CO 2") == {"c": "cl", "b": BK(8)} and rec(BK(8)).get("company_name") == "LATER CO 2", "20 minutes later the new name takes the link and the book (%s, %s)" % (out, mirror("LATER CO 2")))
    good, out = as_role("authenticated", OWNER, "select tally_link_follow(%s, 'X', 'y', null, null)" % q(F))
    ok(not good and "permission denied" in out, "a member cannot call the follow")

    print("== 6. allow / stop posting; the posting guard")
    v = rec(BK(2))["v"]
    r = rpc(STAFF, "select tally_link_posting(%s, false, %s)::text" % (q(BK(2)), v))
    ok(r.get("posting_allowed") is False and int(r.get("version", 0)) == int(v) + 1, "staff stops posting for AA LTD (version %s -> %s)" % (v, r.get("version")))
    r = rpc(OWNER, "select tally_link_posting(%s, true, %s)::text" % (q(BK(2)), v))
    ok("_error" in r and "changed by someone else" in r["_error"] and rec(BK(2)).get("p") == "false", "an allow from a view of the earlier version is refused; posting stays stopped")
    r = rpc(VIEWER, "select tally_link_posting(%s, true, null)::text" % q(BK(2)))
    ok("_error" in r and "not allowed" in r["_error"], "a viewer may not change it")
    r = rpc(OWNER, "select tally_link_posting(%s, true, null)::text" % q(BK(4)))
    ok("_error" in r and "not linked" in r["_error"], "a company not linked: refused")
    enq = lambda uid, n, client: rpc(uid, "select tally_post_enqueue_to(%s::uuid, %s, %s::jsonb, null, null)::text" % (q("%08d-0000-0000-0000-000000000107" % n), q(client), q(json.dumps({"vouchers": [{"id": "V%d" % n, "xml": "<VOUCHER/>"}]}))))
    r = enq(OWNER, 1, "c2")
    ok(r.get("notAllowed") is True and "stopped for AA" in r.get("error", ""), "posting for AA while stopped: refused by the cloud, in words (%s)" % r.get("error", r))
    rpc(OWNER, "select tally_link_posting(%s, true, null)::text" % q(BK(2)))
    db.sql("update clients set data = '{}' where firm_id = %s and id = 'c2'" % q(F))
    r = enq(OWNER, 2, "c2")
    ok(not r.get("notAllowed") and "_error" not in r, "allowed again, clients.data without any postTo: the guard reads the record and lets it through to choosing the bridge (%s)" % (r.get("error") or r))
    db.sql("update clients set data = '{\"postTo\": \"AA LTD\"}' where firm_id = %s and id = 'c2'" % q(F))
    rpc(OWNER, "select tally_link_posting(%s, false, null)::text" % q(BK(2)))
    r = enq(OWNER, 3, "c2")
    ok(r.get("notAllowed") is True, "stopped in the record, a postTo left in clients.data: still refused (the blob decides nothing)")
    r = enq(OWNER, 4, "c5")
    ok(not r.get("notAllowed"), "EE, linked today (posting allowed by the link): not refused for its company (%s)" % (r.get("error") or r))

    print("== 7. links written straight into tally_companies; unlink")
    db.sql("update tally_companies set client_id = 'ch', linked_at = now() where firm_id = %s and company = 'AUTO CO'" % q(F))
    ra = rec(BK(9))
    ok(ra.get("client_id") == "ch" and ra.get("how") == "auto" and ra.get("p") == "true" and ra.get("g") == G(9), "tally-ingest's auto-link of AUTO CO goes into the record (auto, its GUID) (%s)" % ra)
    db.sql("update tally_companies set client_id = 'c7', linked_at = now() where firm_id = %s and company = 'TWIN CO'" % q(F))
    ok(mirror("TWIN CO").get("c") == "" and rec(BK(91)) == {}, "TWIN CO (AUTO CO's GUID) written for another client: not linked, no record")
    # a client's upload links by an upsert (insert ... on conflict do update), as tally-ingest's supabase-js does
    db.sql("insert into tally_companies (firm_id, company, client_id, linked_at, linked_by) values (%s, 'UPLOAD CO', 'cu', now(), %s) on conflict (firm_id, company) do update set client_id = excluded.client_id, linked_at = excluded.linked_at, linked_by = excluded.linked_by" % (q(F), q(OWNER)))
    ok(db.one("select string_agg(book_id::text, ',') from tally_links where client_id = 'cu'") == BK(12) and rec(BK(12)).get("how") == "person",
       "an upsert that became an update: one record, on the company's own book (%s)" % db.one("select string_agg(book_id::text, ',') from tally_links where client_id = 'cu'"))
    r = link(OWNER, "AA LTD", None)
    ok(r.get("state") == "unlinked" and r.get("posting_allowed") is False and r.get("client_id") is None and mirror("AA LTD").get("c") == "" and db.one("select (client_id = '')::text from tally_books where book_id = %s" % q(BK(2))) == "true",
       "unlink: the record unlinked, posting stopped, the mirror and the book emptied (%s, %s, %r)" % ({x: r.get(x) for x in ("state", "posting_allowed", "client_id", "_error")}, mirror("AA LTD"), db.one("select (client_id = '')::text from tally_books where book_id = %s" % q(BK(2)))))
    r = link(OWNER, "AA LTD", "c2")
    ok(r.get("state") == "linked" and r.get("posting_allowed") is True, "linked again: posting allowed (the owner's decision)")
    db.sql("update tally_companies set client_id = null where firm_id = %s and company = 'AUTO CO'" % q(F))
    ok(rec(BK(9)).get("state") == "unlinked" and rec(BK(9)).get("p") == "false", "an unlink written straight there: the record unlinked too")

    print("== 8. the data location: the same company in two places")
    D2 = "d2000000-0000-0000-0000-000000000002"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%s, %s, 'LAPTOP', 'h2', '2.4.7', %s, %s)" % (q(D2), q(F),
           q(json.dumps({"computer": "LAPTOP", "beat": {"at": iso(NOW), "companies": [{"name": "ZZ COMPANY", "guid": G(1)}, {"name": "LATER CO 3", "guid": G(8)}], "dataFolder": "D:\\Copy\\Data", "windowsUser": "ravi", "tallyPort": 9001},
                         "bridges": {"go-bbbb000002": {"at": iso(NOW), "computer": "LAPTOP", "user": "ravi", "mode": "main", "open": ["ZZ COMPANY", "LATER CO 3"], "tallyPort": 9001, "dataFolder": "D:\\Copy\\Data"}}})), q(OWNER)))
    chk = lambda dev, br, book=BK(1): db.one("set role service_role; select tally_link_place_check(%s, %s, %s, %s)::text" % (q(F), q(book), q(dev), q(br)))
    loc = lambda: db.one("select coalesce(data_loc, '') || '|' || coalesce(data_folder, '') from tally_links where book_id = %s" % q(BK(1)))
    places = lambda: {r["computer"]: r["state"] for r in db.rows("select computer, state from tally_link_places where book_id = %s" % q(BK(1)))}
    ok(loc() == "|", "ZZ COMPANY: no data location yet (%s)" % loc())
    ok(chk(D1, "go-aaaa000001") == "true" and loc().startswith("f") and loc().endswith("|C:\\Users\\anshul\\TallyPrime\\Data") and places() == {"NW144": "chosen"},
       "the first data (NW144, C:\\Users\\anshul\\TallyPrime\\Data) is applied and that place chosen (%s, %s)" % (loc(), places()))
    l1 = loc()
    ok(chk(D2, "go-bbbb000002") == "false" and loc() == l1 and places() == {"NW144": "chosen", "LAPTOP": "waiting"},
       "data from LAPTOP (D:\\Copy\\Data, the same GUID): not applied, the place waits (%s)" % places())
    ok(chk(D1, "go-aaaa000001") == "true" and chk(D2, "go-bbbb000002") == "false", "again: NW144 applied, LAPTOP not (nothing from the second place until a person chooses)")
    lap = db.one("select data_loc from tally_link_places where book_id = %s and computer = 'LAPTOP'" % q(BK(1)))
    r = rpc(STAFF, "select tally_link_place_choose(%s, %s)::text" % (q(BK(1)), q(lap)))
    ok("_error" in r and "only an owner" in r["_error"], "staff cannot choose")
    good, out = as_role("anon", None, "select tally_link_place_choose('%s', 'x')" % BK(1))
    ok(not good and "permission denied" in out, "anon cannot")
    r = rpc(OWNER, "select tally_link_place_choose(%s, %s)::text" % (q(BK(1)), q(lap)))
    ok(r.get("data_loc") == lap and r.get("data_folder") == "D:\\Copy\\Data" and r.get("computer") == "LAPTOP" and places() == {"NW144": "not_used", "LAPTOP": "chosen"},
       "the owner chooses LAPTOP's data: the record reads it, NW144 not used (%s)" % places())
    ok(chk(D2, "go-bbbb000002") == "true" and chk(D1, "go-aaaa000001") == "false", "now LAPTOP's data is applied and NW144's is not")
    # a rename reported from another place is never followed
    db.sql("update tally_companies set last_seen = now() - interval '30 minutes' where firm_id = %s and book_id = %s" % (q(F), q(BK(8))))
    chk(D1, "go-aaaa000001", BK(8))
    out = db.one("set role service_role; select coalesce(tally_link_follow(%s, 'LATER CO 3', %s, %s, 'go-bbbb000002'), '-')" % (q(F), q(G(8)), q(D2)))
    ok(out == "-" and rec(BK(8)).get("company_name") == "LATER CO 2", "LATER CO 3 (LATER CO 2's GUID) on LAPTOP: not a rename of the company FinCom reads on NW144 (%s)" % out)
    # a new name with the linked GUID from the place not read: refused, never merged
    db.sql("insert into tally_companies (firm_id, company, device_id, last_seen) values (%s, 'ZZ COPY', %s, now())" % (q(F), q(D1)))
    db.sql("update tally_devices set info = jsonb_set(jsonb_set(info, '{beat,companies}', (info->'beat'->'companies') || %s::jsonb), '{bridges,go-aaaa000001,open}', (info->'bridges'->'go-aaaa000001'->'open') || '[\"ZZ COPY\"]'::jsonb) where id = %s"
           % (q(json.dumps([{"name": "ZZ COPY", "guid": G(1)}])), q(D1)))
    r = link(OWNER, "ZZ COPY", "c1")
    ok("_error" in r and "in another data location" in r["_error"] and mirror("ZZ COPY").get("c") == "" and rec(BK(1)).get("company_name") == "ZZ COMPANY",
       "ZZ COPY (ZZ's GUID, on NW144, not the place FinCom reads): refused, nothing moved (%s)" % r.get("_error", "")[:160])
finally:
    db.stop()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
