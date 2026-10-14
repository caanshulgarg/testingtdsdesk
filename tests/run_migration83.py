"""python3 run_migration83.py - migration 83 (the Assistant's CA certificates: the firm's certificate details, saved formats,
confirmed figures, the chat's uploads folder) on a throwaway PostgreSQL (assistant_stand.py, after 77), run twice.
Checks: add-only (no delete, drop or truncate; nothing replaced); twice is the same; the firm's members read their firm's
rows and nobody else (another firm's member, anon); a member cannot write them (the function writes with the service
role); a client-year keeps every confirmed row (added, never changed) and the latest is the one read; the browser may add
a file under <firm>/<client or _firm>/uploads/ of its own firm only, and only an owner or staff member. Made-up data only."""
import os, sys, re, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
MIG = os.path.join(HERE, "..", "server", "assistant", "migration-83-certificates.sql")
text = open(MIG).read()
print("migration-83 md5 " + hashlib.md5(open(MIG, "rb").read()).hexdigest())
body = re.sub(r"\b(revoke|grant)\b[^;]*;", "", re.sub(r"--[^\n]*", "", text).lower())
ok(not re.search(r"\bdelete\s+from\b|\bdrop\s+(table|column|function|index|policy)\b|\btruncate\b|\balter\s+table\s+\S+\s+drop\b|create or replace function", body), "add-only: no delete, drop, truncate, and no function replaced")
ok(body.count("begin;") == 1 and "commit;" in body and "lock_timeout" in body, "one transaction with a lock timeout")

db = A.start(55483)
try:
    A.migrate(db)
    db.sql("insert into firms (id, name) values ('%s', 'Example firm'), ('%s', 'Other firm') on conflict do nothing;" % (A.FIRM, A.OTHER) +
           "insert into members (user_id, firm_id, name, role, active) values ('%s', '%s', 'Owner', 'owner', true), ('%s', '%s', 'Staff', 'staff', true), ('%s', '%s', 'Viewer', 'viewer', true), ('%s', '%s', 'Stranger', 'owner', true);"
           % (A.ME, A.FIRM, A.STAFF, A.FIRM, A.VIEWER, A.FIRM, A.STRANGER, A.OTHER))
    db.sql(open(MIG).read())
    shape1 = db.rows("select table_name, column_name, data_type from information_schema.columns where table_name like 'assistant_cert%' order by 1, 2")
    pol1 = db.rows("select tablename, policyname from pg_policies where policyname like 'assistant_cert%' or policyname like 'assistant files: add upload%' order by 1, 2")
    db.sql(open(MIG).read())
    ok(shape1 == db.rows("select table_name, column_name, data_type from information_schema.columns where table_name like 'assistant_cert%' order by 1, 2") and pol1 == db.rows("select tablename, policyname from pg_policies where policyname like 'assistant_cert%' or policyname like 'assistant files: add upload%' order by 1, 2"),
       "runs twice: the same %d columns and %d policies" % (len(shape1), len(pol1)))
    ok({r["table_name"] for r in shape1} == {"assistant_cert_settings", "assistant_cert_formats", "assistant_cert_figures"}, "three tables")
    ok(all(db.one("select relrowsecurity from pg_class where relname = '%s'" % t) == "t" for t in ("assistant_cert_settings", "assistant_cert_formats", "assistant_cert_figures")), "row-level security on each")
    ok(not any(re.search(r"udin", r["column_name"]) for r in shape1), "no UDIN column: FinCom never keeps or fills one")

    # the function writes with the service role
    svc = lambda s: db._psql([], "set role service_role;\n" + s)
    svc("insert into assistant_cert_settings (firm_id, firm_name, frn, signatory, membership_no, place, confirmed) values ('%s', 'Example & Associates', '000000X', 'A. Example', '123456', 'Faketown', true);" % A.FIRM)
    svc("insert into assistant_cert_settings (firm_id, firm_name) values ('%s', 'Another Firm & Co') on conflict (firm_id) do update set firm_name = excluded.firm_name;" % A.OTHER)
    svc("insert into assistant_cert_formats (firm_id, name, path, kind, fields) values ('%s', 'Tender format A', '%s/_firm/settings/x.docx', 'docx', '[{\"key\": \"tender_no\"}]');" % (A.FIRM, A.FIRM))
    for v in (100, 150):
        svc("insert into assistant_cert_figures (firm_id, client_id, fy, basis, figures) values ('%s', 'larkspur', '2025', 'signed', '{\"turnover\": {\"value\": %d, \"how\": \"read\"}}');" % (A.FIRM, v))
    ok(A.ask(db, "select firm_name || '|' || frn || '|' || default_format from assistant_cert_settings") == "Example & Associates|000000X|icai", "the member reads the firm's details (default format: ICAI)")
    ok(A.ask(db, "select count(*) from assistant_cert_settings", A.STRANGER) == "1" and A.ask(db, "select firm_name from assistant_cert_settings", A.STRANGER) == "Another Firm & Co", "another firm's member sees only its own firm's details")
    ok(A.ask(db, "select count(*) from assistant_cert_formats", A.STRANGER) == "0" and A.ask(db, "select count(*) from assistant_cert_figures", A.STRANGER) == "0", "another firm sees none of the formats or figures")
    ok(A.ask(db, "select (figures->'turnover'->>'value') from assistant_cert_figures where client_id = 'larkspur' and fy = '2025' order by made_at desc, id desc limit 1") == "150" and A.ask(db, "select count(*) from assistant_cert_figures") == "2", "both confirmed rows kept; the latest read")
    for stmt in ("insert into assistant_cert_settings (firm_id, firm_name) values ('%s', 'x') on conflict (firm_id) do update set firm_name = 'x'" % A.FIRM, "update assistant_cert_formats set name = 'y'",
                 "delete from assistant_cert_figures", "insert into assistant_cert_figures (firm_id, client_id, fy, basis, figures) values ('%s', 'larkspur', '2024', 'typed', '{}')" % A.FIRM):
        try: A.ask(db, stmt); ok(False, "a member cannot write: " + stmt[:50])
        except RuntimeError: ok(True, "a member cannot write: " + stmt[:50])
    for stmt in ("select count(*) from assistant_cert_settings", "select count(*) from assistant_cert_figures"):
        try: db._psql([], "set role anon; " + stmt + ";"); ok(False, "anon: " + stmt)
        except RuntimeError: ok(True, "anon reads nothing: " + stmt)
    try: svc("insert into assistant_cert_figures (firm_id, client_id, fy, basis, figures) values ('%s', 'larkspur', '25-26', 'signed', '{}');" % A.FIRM); ok(False, "a year must be YYYY")
    except RuntimeError: ok(True, "a year is kept as YYYY (the year from 1 April)")

    # the chat's uploads: the browser adds a file under its own firm's uploads/ only, as owner or staff
    def put(uid, name):
        try: A.ask(db, "insert into storage.objects (bucket_id, name) values ('assistant-files', '%s')" % name, uid); return True
        except RuntimeError: return False
    db.sql("grant insert, select on storage.objects to authenticated; grant usage on schema storage to authenticated;")
    ok(put(A.ME, A.FIRM + "/_firm/uploads/abc-signed-bs.pdf") and put(A.STAFF, A.FIRM + "/larkspur/uploads/format.docx"), "owner and staff may upload under <firm>/<client or _firm>/uploads/")
    ok(not put(A.VIEWER, A.FIRM + "/_firm/uploads/x.pdf"), "a viewer may not upload")
    ok(not put(A.ME, A.OTHER + "/_firm/uploads/x.pdf"), "not into another firm's folder")
    ok(not put(A.ME, A.FIRM + "/_firm/settings/letterhead.png") and not put(A.ME, A.FIRM + "/_firm/files/x.zip"), "not into settings/ or files/ (the function writes those)")
finally:
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
