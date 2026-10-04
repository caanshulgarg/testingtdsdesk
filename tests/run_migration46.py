"""python3 run_migration46.py - migration-46-trial-tools (04-Oct-2026, round 19: trial tools for any company; the owner's
switch "Trial tools on this computer"). On a throwaway PostgreSQL (pg_stand), staging's order 32 -> ... -> 44 -> 45, made-up
rows, then 46 twice (and a third time over a used column). Never a real database.
Checks: tally_devices.trial_tools boolean not null default false (+ trial_tools_at, trial_tools_by), every existing computer
off; the columns readable by the firm (as 43's settings); tally_device_trial_tools(device, on) -> jsonb: the owner turns it on
and off (stamped at / by), staff refused, another firm's owner refused ('not a computer of your firm'), a revoked computer
refused, an unknown computer refused, null refused with words; security definer, search_path = public, pg_temp; revoked
from public and anon (also under Supabase's default privileges), granted to authenticated; the text has begin / commit,
set local lock_timeout '10s' and no 'delete from' anywhere; nothing deleted; md5 of each function body (prosrc) equals the
file's text between its $function$ marks (the number to check on staging after it runs).
Review 46 H1 (docs/reviews/migration-46-review.md, Fixed): tally_start_point replaced (44's 7 arguments and grants): another
company's GUID marks the book needs_baseline and never moves the starting point (two PCs alternating, a huge number under a
third GUID); a start recorded without a GUID gets the GUID stamped, the point and its gap kept; a point another GUID moved
before 46 is kept and flagged; after the owner's tally_baseline_clear the next call records afresh (the new GUID becomes the
book's company), once.
RED (before 46): the file is missing, every check fails."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql")]
M46 = os.environ.get("M46_FILE") or os.path.join(SQLDIR, "migration-46-trial-tools.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, GONE = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333", "22222222-2222-2222-2222-222222222222"
D1, D2, D3, DR = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003", "d4000000-0000-0000-0000-000000000004"
SIG = "tally_device_trial_tools(uuid, boolean)"
db = pg_stand.start(55471)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set fincom.role = 'authenticated'; set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def jn(s):
    try: return db.one(s)
    except RuntimeError as e: return "ERROR " + str(e)[-200:]
dev = lambda d: (db.rows("select trial_tools, trial_tools_at is not null as at, trial_tools_by from tally_devices where id = %s" % q(d)) or [{}])[0]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(T)s, %(F2)s, 'Them', 'owner', true), (%(G)s, %(F)s, 'Former owner', 'owner', false);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.9'), (%(D2)s, %(F)s, 'NWS145', 'h2', '2.1.9'), (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.1.9');
      insert into tally_devices (id, firm_id, name, key_hash, revoked) values (%(DR)s, %(F)s, 'OLD-PC', 'h4', true);""" % {
        "F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "T": q(OTHER), "G": q(GONE), "D1": q(D1), "D2": q(D2), "D3": q(D3), "DR": q(DR)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    # Supabase's default privileges: a function created in public is executable by anon and authenticated unless revoked
    db.sql("alter default privileges in schema public grant execute on functions to anon, authenticated;")
    counts = lambda: {t: db.one("select count(*) from %s" % t) for t in ("tally_devices", "members", "firms", "tally_books", "tally_sync_cursor")}
    before = counts()
    for i in (1, 2):
        r = psql_file(M46); ok(r.returncode == 0, "migration-46 runs (%d) %s" % (i, (r.stderr or "").strip()[-400:] if r.returncode else ""))
    ok(counts() == before, "nothing deleted or added by the migration (%s)" % counts())
    body = open(M46).read() if os.path.exists(M46) else ""
    low = body.lower()
    ok(body != "" and "delete from" not in low and not re.search(r"\b(drop|truncate)\s+(table|view|function|trigger|policy|column|constraint|index)\b", low) and "truncate " not in low,
       "the text holds no 'delete from', no drop, no truncate (anywhere, comments too)")
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", body, re.M) is not None and body.rstrip().endswith("commit;"), "begin; set local lock_timeout = '10s'; ... commit;")
    # the column
    col = (db.rows("select data_type, is_nullable, column_default from information_schema.columns where table_name = 'tally_devices' and column_name = 'trial_tools'") or [{}])[0]
    ok(col == {"data_type": "boolean", "is_nullable": "NO", "column_default": "false"}, "tally_devices.trial_tools boolean not null default false (%s)" % col)
    ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_devices' and ((column_name = 'trial_tools_at' and data_type like 'timestamp with time zone') or (column_name = 'trial_tools_by' and data_type = 'uuid'))") == "2",
       "trial_tools_at timestamptz, trial_tools_by uuid")
    ok(jn("select count(*) from tally_devices where trial_tools") == "0", "every existing computer: off")
    good, out = as_user(STAFF, "select count(*) filter (where trial_tools is not null) || '/' || count(*) from tally_devices")
    ok(good and out == "3/3", "the firm reads the switch (its own computers only: RLS) (%s %s)" % (good, out))
    # the owner's function
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, true)::text" % q(D1)); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is True and r.get("trialTools") is True and r.get("device") == D1 and r.get("at") and dev(D1) == {"trial_tools": "t", "at": "t", "trial_tools_by": OWNER}, "the owner turns it on: stamped at and by (%s %s)" % (out, dev(D1)))
    ok(dev(D2).get("trial_tools") == "f", "the other computer of the firm stays off")
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, true)::text" % q(D1))
    ok(good and json.loads(out).get("trialTools") is True, "on again: still on (no error)")
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, false)::text" % q(D1)); r = json.loads(out) if good else {}
    ok(good and r.get("trialTools") is False and dev(D1).get("trial_tools") == "f", "the owner turns it off (%s)" % out)
    good, out = as_user(STAFF, "select tally_device_trial_tools(%s, true)::text" % q(D1))
    ok(not good and "only an owner" in out and dev(D1).get("trial_tools") == "f", "staff refused with words (%s)" % out[-120:])
    good, out = as_user(GONE, "select tally_device_trial_tools(%s, true)::text" % q(D1))
    ok(not good and dev(D1).get("trial_tools") == "f", "an owner no longer active refused (%s)" % out[-120:])
    good, out = as_user(OTHER, "select tally_device_trial_tools(%s, true)::text" % q(D1))
    ok(not good and "not a computer of your firm" in out and dev(D1).get("trial_tools") == "f", "another firm's owner refused: not a computer of your firm (%s)" % out[-120:])
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, true)::text" % q(D3))
    ok(not good and "not a computer of your firm" in out and dev(D3).get("trial_tools") == "f", "the owner on another firm's computer refused (%s)" % out[-120:])
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, true)::text" % q(DR))
    ok(not good and "not a computer of your firm" in out and dev(DR).get("trial_tools") == "f", "a revoked computer refused (%s)" % out[-120:])
    good, out = as_user(OWNER, "select tally_device_trial_tools('d9000000-0000-0000-0000-000000000009', true)::text")
    ok(not good and "not a computer of your firm" in out, "an unknown computer refused")
    good, out = as_user(OWNER, "select tally_device_trial_tools(%s, null)::text" % q(D1))
    ok(not good and "on or off" in out and dev(D1).get("trial_tools") == "f", "null refused with words (%s)" % out[-120:])
    # security definer, search_path, grants (also under Supabase's default privileges)
    row = (db.rows("select prosecdef, array_to_string(proconfig, ',') as conf from pg_proc where oid = 'public.%s'::regprocedure" % SIG) or [{}])[0]
    ok(row.get("prosecdef") == "t" and (row.get("conf") or "").replace(" ", "") == "search_path=public,pg_temp", "security definer, search_path = public, pg_temp (%s)" % row)
    priv = {who: jn("select has_function_privilege('%s', '%s', 'execute')" % (who, SIG)) for who in ("anon", "authenticated")}
    pub = jn("select count(*) from information_schema.routine_privileges where routine_name = 'tally_device_trial_tools' and grantee = 'PUBLIC'")
    ok(priv == {"anon": "f", "authenticated": "t"} and pub == "0", "revoked from public and anon, granted to authenticated (%s, public %s)" % (priv, pub))
    # a third run over a used column keeps the owner's choice
    as_user(OWNER, "select tally_device_trial_tools(%s, true)::text" % q(D2))
    r = psql_file(M46)
    ok(r.returncode == 0 and dev(D2).get("trial_tools") == "t" and dev(D1).get("trial_tools") == "f", "migration-46 a third time: the owner's choices kept (%s)" % (r.stderr or "").strip()[-200:])
    # md5 of each function body: the file's text between $function$ marks equals prosrc
    bodies = re.findall(r"create or replace function public\.(\w+)\(.*?\$function\$(.*?)\$function\$", body, re.S)
    for name, src in bodies:
        db_md5 = jn("select md5(prosrc) from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(name))
        file_md5 = hashlib.md5(src.encode()).hexdigest()
        ok(db_md5 == file_md5, "md5(prosrc) of %s = %s (the file's text between its $function$ marks)" % (name, file_md5))
    ok(sorted(n for n, _ in bodies) == ["tally_device_trial_tools", "tally_start_point"], "the functions in the file: tally_device_trial_tools, tally_start_point (%s)" % [n for n, _ in bodies])
    # ---------------------------------------------------------------- review 46 H1: another company's GUID never moves the starting point
    # (44's rule "a new company GUID resets it" replaced: needs_baseline, the point kept; only the owner's baseline clear
    # (tally_baseline_clear, 37) lets the next tally_start_point record afresh, under the GUID it then brings)
    SPSIG = "tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text)"
    B1, B2, B3 = "b1000000-0000-0000-0000-000000000001", "b2000000-0000-0000-0000-000000000002", "b3000000-0000-0000-0000-000000000003"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ FORGE', '2026-04-01', '2026-03-31'), (%s, %s, 'c1', 'ZZ NOGUID', '2026-04-01', '2026-03-31'), (%s, %s, 'c1', 'ZZ MOVED', '2026-04-01', '2026-03-31')"
           % (q(B1), q(F), q(B2), q(F), q(B3), q(F)))
    jj = lambda s: (lambda x: json.loads(x) if isinstance(x, str) and not x.startswith("ERROR") else {"_error": x})(jn(s))
    sp = lambda b, g, v, dv=D1: jj("select tally_start_point(%s, %s, %s, %s, 1, %s, 'go-1')::text" % (q(F), q(b), "null" if g is None else q(g), v, q(dv)))
    gc = lambda b, v, dv=D1: jj("select tally_recorder_gap_check(%s, %s, %s, now())::text" % (q(b), q(dv), v))
    cur = lambda b: (db.rows("select company_guid, start_guid, last_voucher_alterid as sv, start_at, state, state_why from tally_sync_cursor where book_id = %s" % q(b)) or [{}])[0]
    r = sp(B1, "cg-A", 1000); c1 = cur(B1)
    ok(r.get("set") is True and r.get("otherCompany") is False and c1.get("sv") == "1000" and c1.get("start_guid") == "cg-A" and c1.get("company_guid") == "cg-A",
       "H1. PC-A: the first starting point recorded (1000, cg-A) (%s)" % r)
    r = sp(B1, "cg-B", 40, D2); c = cur(B1)
    ok(r.get("set") is False and r.get("otherCompany") is True and r.get("bookGuid") == "cg-A" and r.get("startVoucher") == 1000 and c.get("sv") == "1000" and c.get("start_guid") == "cg-A"
       and c.get("start_at") == c1.get("start_at") and c.get("state") == "needs_baseline" and "cg-A -> cg-B" in (c.get("state_why") or ""),
       "H1. PC-B, a same-named company (cg-B, 40): needs_baseline, otherCompany, set false; the point kept at 1000 / cg-A / the same start_at (%s; %s)" % (r, c))
    for g_, v_, dv in (("cg-A", 1012, D1), ("cg-B", 52, D2), ("cg-A", 1013, D1), ("cg-B", 53, D2), ("cg-C", 999999999999999, D2)):
        sp(B1, g_, v_, dv)
    c = cur(B1)
    ok(c.get("sv") == "1000" and c.get("start_guid") == "cg-A" and c.get("start_at") == c1.get("start_at") and c.get("company_guid") == "cg-A" and c.get("state") == "needs_baseline",
       "H1. beats alternating between the two PCs (and a third GUID with 999,999,999,999,999): the point never moves (%s)" % c)
    r = gc(B1, 1003)
    ok(r.get("missing") == 3 and "up to 3 changes not received" in str((r.get("gap") or {}).get("words")), "H1. the real company's check (1003) against its own 1000: up to 3, no false gap (%s)" % r.get("missing"))
    # a starting point recorded without a GUID (the gap check's) is stamped by the first GUID, never moved; its gap kept
    r = gc(B2, 1000); r2 = gc(B2, 1050); c2 = cur(B2)
    ok(r.get("startRecorded") is True and r2.get("missing") == 50 and c2.get("start_guid") in (None, ""), "H1. a start recorded by the gap check without a GUID (1000), then up to 50 (%s)" % c2)
    r = sp(B2, "cg-N", 1050); c = cur(B2); r3 = gc(B2, 1050)
    ok(r.get("set") is False and r.get("otherCompany") is False and c.get("sv") == "1000" and c.get("start_guid") == "cg-N" and c.get("start_at") == c2.get("start_at") and c.get("state") == "ok"
       and r3.get("missing") == 50, "H1. then a GUID (cg-N, 1050): the GUID stamped, the point kept at 1000, the gap still up to 50 (%s; %s)" % (r, r3.get("missing")))
    # a point another GUID moved before this fix: never moved back silently; needs_baseline with words (the owner's clear)
    sp(B3, "cg-3", 300); db.sql("update tally_sync_cursor set start_guid = 'cg-Z', last_voucher_alterid = 5 where book_id = %s" % q(B3))
    r = sp(B3, "cg-3", 320); c = cur(B3)
    ok(r.get("set") is False and c.get("sv") == "5" and c.get("start_guid") == "cg-Z" and c.get("state") == "needs_baseline" and "cg-Z" in (c.get("state_why") or ""),
       "H1. a point recorded under another GUID before 46: kept, needs_baseline with words (%s)" % c)
    # the owner's baseline clear: the next tally_start_point records afresh, under the GUID it brings, once
    good, out = as_user(OWNER, "select tally_baseline_clear(%s, 'cg-B is the real company: fresh baseline taken')::text" % q(B1))
    ok(good and cur(B1).get("state") == "ok", "H1. the owner clears ZZ FORGE's baseline (%s)" % out[-120:])
    r = sp(B1, "cg-B", 60, D2); c = cur(B1)
    ok(r.get("set") is True and r.get("otherCompany") is False and c.get("sv") == "60" and c.get("start_guid") == "cg-B" and c.get("company_guid") == "cg-B" and c.get("state") == "ok"
       and c.get("start_at") > c1.get("start_at"), "H1. after the clear the new GUID records anew: 60, cg-B the book's company, state ok (%s; %s)" % (r, c))
    r = sp(B1, "cg-B", 70, D2); r2 = sp(B1, "cg-A", 1020, D1); c = cur(B1)
    ok(r.get("set") is False and r2.get("set") is False and r2.get("otherCompany") is True and c.get("sv") == "60" and c.get("start_guid") == "cg-B" and c.get("state") == "needs_baseline",
       "H1. once: the same GUID again changes nothing; the old company's GUID is now the other one (needs_baseline, the point kept) (%s)" % c)
    good, out = as_user(OWNER, "select tally_baseline_clear(%s, 'restore re-read')::text" % q(B2))
    r = sp(B2, "cg-N", 1100); r2 = sp(B2, "cg-N", 1200); c = cur(B2)
    ok(good and r.get("set") is True and r2.get("set") is False and c.get("sv") == "1100" and c.get("start_guid") == "cg-N", "H1. a clear under the same GUID: the next call records afresh (1100), once (%s)" % c)
    row = (db.rows("select prosecdef, array_to_string(proconfig, ',') as conf from pg_proc where oid = 'public.%s'::regprocedure" % SPSIG) or [{}])[0]
    priv = {who: jn("select has_function_privilege('%s', 'public.%s', 'execute')" % (who, SPSIG)) for who in ("anon", "authenticated", "service_role")}
    ok(row.get("prosecdef") == "t" and (row.get("conf") or "").replace(" ", "") == "search_path=public,pg_temp" and priv == {"anon": "f", "authenticated": "f", "service_role": "t"}
       and db.one("select count(*) from pg_proc where proname = 'tally_start_point'") == "1",
       "H1. tally_start_point: one, 7 arguments as 44's, security definer, search_path = public, pg_temp, the service role's alone (%s %s)" % (row, priv))
    good, out = as_user(OWNER, "select tally_start_point(%s, %s, 'cg-B', 99, 1, %s, 'x')::text" % (q(F), q(B1), q(D1)))
    ok(not good, "H1. tally_start_point refused to a member (%s)" % out[-80:])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
