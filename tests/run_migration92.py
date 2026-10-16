"""python3 run_migration92.py - migration-92-settle-unnamed-deletes (16-Oct-2026, branch next-tally-one). The owner's GB TEXCOAT
showed "29 days need a Day Book" on Books › From Tally after three complete Day Book uploads: 62 held 'deleted' lines with no
entry GUID, each received before a complete Day Book of its day was stored. 92 settles such a line once a complete Day Book of
its day is stored after it arrived. On a throwaway PostgreSQL (pg_stand, port 30920; never a real database), built in
staging's order 32 -> ... -> 60 -> 63. Checks:
  0. the file: one transaction, no 'delete from' / drop / truncate / table change, names no real database; two new functions
     only, granted to nobody; runs twice.
  1. a GUID-less delete held, then a complete Day Book of its day stored: the line becomes applied with the Day Book words;
     the books unchanged by it (the day's entries as the file has them).
  2. a GUID-less delete held, then an INCOMPLETE Day Book of its day (n above the entries): stays held.
  3. a GUID-less delete held AFTER its day was stored (the day not stored again): stays held.
  4. a GUID-less delete with no date: stays held.
  5. a delete that names its entry and a held created line: untouched by 92 (their own rules).
  6. the once-only pass: a line held before 92 ran, its day already stored complete after it: settled when 92 runs.
RED_WITHOUT_92=1: the same checks without the file (1 and 6 fail: the lines stay held)."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql")]
M92 = os.environ.get("M92_FILE") or os.path.join(SQLDIR, "migration-92-settle-unnamed-deletes.sql")
RED = os.environ.get("RED_WITHOUT_92") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "819d4a59-4cee-4bf7-8f8c-000000000092", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599192"
G = lambda mid: CG + "-%08x" % mid

text = open(M92).read() if os.path.exists(M92) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M92))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s" % (os.path.basename(M92), hashlib.md5(text.encode()).hexdigest()))
low = text.lower()
code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction (begin; lock_timeout 10s; ... commit;)")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b", code) and not re.search(r"\btruncate\b", code) and not re.search(r"\balter\s+table\b", code) and "create table" not in code, "0. add-only")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_days_recorder_settle", "tally_recorder_settle_unnamed"], "0. two new functions only (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG92_PORT") or 30920))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def day(d, vouchers, lines, n=None): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers) if n is None else n, max([v["alter"] for v in vouchers] + [0])))
def row(lid): return (db.rows("select id, state, coalesce(held_why, '') as why from tally_recorder_lines where line_id = %s order by id desc limit 1" % q(lid)) or [{}])[0]
def tb(): return db.one("select to_char(coalesce(sum(amount), 0), 'FM999999990.00') || '/' || count(*) from tally_ledger_day where book_id = %s" % q(B))
def V(mid, alter, no, d):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no, "party": "Spike Customer", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(mid): return [[G(mid), "Spike Customer", -118.0, "", None, []], [G(mid), "Sales GST 18%", 100.0, "", None, []], [G(mid), "CGST Output 9%", 9.0, "", None, []], [G(mid), "SGST Output 9%", 9.0, "", None, []]]
def L(lid, ev, mid, alter, d="20260410", guid="", no=None):
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.4.4", "vch_no": no or str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter,
         "saved_at": "2026-10-16T05:00:00.000Z", "vch_date": d, "vch_type": "Sales", "master_id": str(mid), "object_guid": guid, "company_guid": CG, "company": "GB TEXCOAT"}
    x["payload"] = dict(x); return x
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GB TEXCOAT', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.4.4');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GB TEXCOAT', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, 50000, '2026-04-01 10:00+05:30', %s)" % (q(B), q(F), q(CG)))

    print("== 6. (setup) a line held before 92, its day then stored complete")
    a6 = apply([L("u-6", "deleted", 960, 60960, d="20260415")])
    ok(row("u-6").get("state") == "held", "6. held first (%s)" % row("u-6"))
    day("2026-04-15", [V(961, 60961, "S-961", "2026-04-15")], LN(961))
    if not RED:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "92 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
        for fn in ("tally_recorder_settle_unnamed(uuid, date)", "tally_days_recorder_settle()"):
            ok(all(db.one("select has_function_privilege(%s, 'public.%s', 'execute')" % (q(rl), fn)) in ("f", "false") for rl in ("anon", "authenticated", "service_role")), "0. %s granted to nobody" % fn)
        trg = db.one("select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.tally_days'::regclass and not tgisinternal and tgname like 'tally_days_recorder_%'")
        ok(trg == "tally_days_recorder_release_ins,tally_days_recorder_release_upd,tally_days_recorder_settle_ins,tally_days_recorder_settle_upd", "0. the two triggers, after 50's (%s)" % trg)
    r6 = row("u-6")
    ok(r6.get("state") == "applied" and "Day Book for 15-Apr-2026, complete and stored after this change arrived" in r6.get("why", ""), "6. settled by the once-only pass (%s)" % r6)

    print("== 1. held, then a complete Day Book of its day")
    apply([L("u-1", "deleted", 910, 60910, d="20260410")])
    ok(row("u-1").get("state") == "held", "1. held first")
    day("2026-04-10", [V(911, 60911, "S-911", "2026-04-10"), V(912, 60912, "S-912", "2026-04-10")], LN(911) + LN(912))
    before = tb()
    r1 = row("u-1")
    ok(r1.get("state") == "applied" and "nothing left to do: the Day Book for 10-Apr-2026" in r1.get("why", ""), "1. applied with the Day Book words (%s)" % r1)
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and day = '2026-04-10' and deleted_at is null" % q(B)) == "2", "1. the day's two entries kept")
    ok(tb() == before, "1. the books unchanged by settling (%s)" % tb())

    print("== 2. held, then an incomplete Day Book")
    apply([L("u-2", "deleted", 920, 60920, d="20260411")])
    day("2026-04-11", [V(921, 60921, "S-921", "2026-04-11")], LN(921), n=3)
    ok(row("u-2").get("state") == "held", "2. stays held (%s)" % row("u-2"))

    print("== 3. held after its day was stored")
    day("2026-04-12", [V(931, 60931, "S-931", "2026-04-12")], LN(931))
    db.sql("update tally_days set at = now() - interval '1 hour' where book_id = %s and day = '2026-04-12'" % q(B))
    apply([L("u-3", "deleted", 930, 60930, d="20260412")])
    ok(row("u-3").get("state") == "held", "3. stays held (%s)" % row("u-3"))
    if not RED: ok(db.one("select public.tally_recorder_settle_unnamed(%s, '2026-04-12')" % q(B)) == "0", "3. the rule settles nothing for it")

    print("== 4. no date")
    apply([L("u-4", "deleted", 940, 60940, d="")])
    ok(row("u-4").get("state") == "held", "4. stays held (%s)" % row("u-4"))

    print("== 5. other lines untouched")
    apply([L("u-5c", "created", 950, 60950, d="20260413")])
    s5 = row("u-5c")
    day("2026-04-13", [V(951, 60951, "S-951", "2026-04-13")], LN(951))
    ok(row("u-5c").get("state") == s5.get("state") == "held", "5. a created line without its entry stays held (%s)" % row("u-5c"))
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
