"""python3 run_migration63.py - migration-63-recorder-repeat (07-Oct-2026, next release, branch next-outbox): FinCom ignores a
repeat of a recorder line. On throwaway PostgreSQL (pg_stand, port 30630 unless PG63_PORT; never a real database), built
32 -> ... -> 58 -> 59 -> 60 in staging's order, then 63 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; one function, tally_recorder_line: 60's text with only lines marked "63" changed; security definer,
     search_path public, pg_temp; granted to nobody; one index (book_id, line_id), not unique; run twice, the same text.
  1. the same line (an entry with its body) sent twice by the same computer: the second answered duplicate, already: true,
     was 'applied'; ONE row; the entry once.
  2. a held line (no GUID) sent twice: one held row (before 63: two).
  3. the same line id from another computer: not a repeat (its own row).
  4. a bridge that does not mark (no "again" key): a repeat answered already; a ":resolved" line whose last row is held is
     stored again (2.3.1's deliberate resend, as before 63); one whose last row is applied is a repeat.
  5. a bridge that marks: "ledger" after "" is stored; "ledger" again is a repeat; "items" is stored; "" again is a repeat.
  6. a row ended 'failed' is no repeat: the line is taken again.
  7. the queued path (tally_recorder_enqueue, then the drain): the same lines queued twice end in one row each.
Prints md5(prosrc) of tally_recorder_line before and after 63, and the file's md5.
RED: before the file exists it stops at the first check; with 60's text sections 1, 2, 4, 5 and 7 fail."""
import os, re, sys, json, hashlib, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")]
M63 = os.environ.get("M63_FILE") or os.path.join(SQLDIR, "migration-63-recorder-repeat.sql")
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
B, D1, D2 = "f79e4bc3-871d-4482-874d-000000000061", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b2"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: CG + "-%08x" % mid
START = 50000

text = open(M63).read() if os.path.exists(M63) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M63))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s" % (os.path.basename(M63), hashlib.md5(text.encode()).hexdigest()))
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\b", low) and "create table" not in low, "0. add-only (no drop, truncate, table change)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_recorder_line"], "0. one function replaced: tally_recorder_line (%s)" % FNS)
IDX = re.findall(r"create (unique )?index if not exists (\w+) on public\.tally_recorder_lines \(([^)]*)\)", low)
ok(IDX == [("", "tally_recorder_lines_line", "book_id, line_id")], "0. one index, not unique, (book_id, line_id) (%s)" % IDX)
m60 = open(os.path.join(SQLDIR, "migration-60-recorder-lows.sql")).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L60 = block(m60, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L63 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
hunks, cur = [], None
for d in difflib.unified_diff(L60.split("\n"), L63.split("\n"), lineterm="", n=0):
    if d.startswith("@@"): cur = []; hunks.append(cur)
    elif cur is not None and d[:1] in "+-" and not d.startswith(("+++", "---")): cur.append(d)
unmarked = [h for h in hunks if not all(re.search(r"--.*\b63\b", x) for x in h if x.startswith("+") and x[1:].strip() and not x[1:].strip().startswith("--"))]
ok(L60 != L63 and not unmarked, "0. tally_recorder_line is 60's text but %d changed places, every added line marked '63' (unmarked: %s)" % (len(hunks), unmarked[:1]))
ok(L63.rstrip().endswith("revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;"), "0. granted to nobody, as in 60")

db = pg_stand.start(int(os.environ.get("PG63_PORT") or 30630))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines, dev=D1): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(dev), js(lines)))
def res(r): return [x for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else [{"state": "error", "why": json.dumps(r)[:400]}]
def st(r): return [x.get("state") for x in res(r)]
def rows(lid): return int(db.one("select count(*) from tally_recorder_lines where book_id = %s and line_id = %s" % (q(B), q(lid))))
def V(mid, alter, no, d, party):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def L(lid, ev, mid, alter, d="20261003", no=None, guid=None, body=False, again=None):
    g = G(mid) if guid is None else guid
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.2", "vch_no": no or str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter, "saved_at": "2026-10-06T05:00:00.000Z",
         "vch_date": d, "vch_type": "Sales", "master_id": str(mid), "object_guid": g, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
    if again is not None: x["again"] = again
    if body:
        x["vouchers"] = [V(mid, alter, no or str(mid), "2026-10-03", "Spike Customer")]
        x["lines"] = [[G(mid), "Spike Customer", -118.0, "", None, []], [G(mid), "Sales GST 18%", 100.0, "", None, []], [G(mid), "CGST Output 9%", 9.0, "", None, []], [G(mid), "SGST Output 9%", 9.0, "", None, []]]
    # what tally-ingest stores as the payload: the line as sent, its "again" among it
    x["payload"] = {k: v for k, v in x.items() if k not in ("vouchers", "lines")}
    return x
def prosrc(): return db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure")
def can(role): return db.one("select has_function_privilege(%s, 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)', 'execute')" % q(role))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.1'), (%(D2)s, %(F)s, 'NWS145', 'h2', '2.3.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1), "D2": q(D2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    before = prosrc()
    print("  tally_recorder_line prosrc md5 under 60: %s" % before)
    if os.environ.get("RED_WITHOUT_63") != "1":
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "63 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
            if i == 1: after1 = prosrc()
        after = prosrc()
        print("  tally_recorder_line prosrc md5 under 63: %s" % after)
        ok(after != before and after == after1, "0. 63 replaces the line's text, the same both runs")
        ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
        ok(all(can(r) in ("f", "false", False) for r in ("anon", "authenticated", "service_role")), "0. granted to nobody (%s)" % [can(r) for r in ("anon", "authenticated", "service_role")])
        ok(db.one("select indisunique::text from pg_index where indexrelid = 'public.tally_recorder_lines_line'::regclass") == "false", "0. the index is there, not unique")
    else:
        print("  (RED_WITHOUT_63: the checks below run on 60's text)")

    print("== 1. the same line twice from the same computer")
    a1 = apply([L("r-1", "created", 901, 60001, body=True, again="")])
    a2 = apply([L("r-1", "created", 901, 60001, body=True, again="")])
    x2 = (res(a2) or [{}])[0]
    ok(st(a1) == ["applied"] and x2.get("state") == "duplicate" and x2.get("already") is True and x2.get("was") == "applied" and "already have this line" in str(x2.get("why")),
       "1. the second answered duplicate, already: true, was applied (%s / %s)" % (st(a1), x2))
    ok(rows("r-1") == 1, "1. one row for the line (%d)" % rows("r-1"))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(901)))) == "1", "1. the entry once")

    print("== 2. a held line twice")
    h1 = apply([L("h-1", "created", 0, None, guid="", again="")])
    h2 = apply([L("h-1", "created", 0, None, guid="", again="")])
    ok(st(h1) == ["held"] and st(h2) == ["duplicate"] and res(h2)[0].get("was") == "held" and rows("h-1") == 1, "2. one held row, the repeat answered already (%s %s rows %d)" % (st(h1), res(h2), rows("h-1")))

    print("== 3. the same line id from another computer")
    o1 = apply([L("r-1", "created", 901, 60001, body=True, again="")], dev=D2)
    ok(rows("r-1") == 2 and not (res(o1)[0].get("already")), "3. its own row, not 'already' (%s rows %d)" % (res(o1), rows("r-1")))

    print("== 4. a bridge that does not mark (no 'again' key)")
    u1 = apply([L("u-1", "deleted", 0, None, guid="")]); u2 = apply([L("u-1", "deleted", 0, None, guid="")])
    ok(rows("u-1") == 1 and res(u2)[0].get("already") is True, "4. a repeat: already, one row (%s rows %d)" % (res(u2), rows("u-1")))
    k1 = apply([L("k-1:resolved", "created", 0, None, guid="")]); k2 = apply([L("k-1:resolved", "created", 0, None, guid="")])
    ok(st(k1) == ["held"] and rows("k-1:resolved") == 2 and not res(k2)[0].get("already"), "4. a ':resolved' line whose last row is held: stored again, as before 63 (%s rows %d)" % (res(k2), rows("k-1:resolved")))
    k3 = apply([L("k-2:resolved", "created", 902, 60002, body=True)]); k4 = apply([L("k-2:resolved", "created", 902, 60002, body=True)])
    ok(st(k3) == ["applied"] and rows("k-2:resolved") == 1 and res(k4)[0].get("already") is True, "4. a ':resolved' line whose row is applied: a repeat (%s rows %d)" % (res(k4), rows("k-2:resolved")))

    print("== 5. a bridge that marks its deliberate resends")
    m1 = apply([L("m-1:resolved", "created", 0, None, guid="", again="")])
    m2 = apply([L("m-1:resolved", "created", 903, 60003, body=True, again="ledger")])
    m3 = apply([L("m-1:resolved", "created", 903, 60003, body=True, again="ledger")])
    m4 = apply([L("m-1:resolved", "created", 903, 60004, body=True, again="items")])
    m5 = apply([L("m-1:resolved", "created", 0, None, guid="", again="")])
    ok(st(m1) == ["held"] and st(m2) == ["applied"] and res(m3)[0].get("already") is True and not res(m4)[0].get("already") and res(m5)[0].get("already") is True and rows("m-1:resolved") == 3,
       "5. '' held; 'ledger' stored and applied; 'ledger' again a repeat; 'items' stored; '' again a repeat; 3 rows (%s %s %s %s %s rows %d)" % (st(m1), st(m2), res(m3)[0].get("already"), st(m4), res(m5)[0].get("already"), rows("m-1:resolved")))

    print("== 6. a row ended failed is no repeat")
    f1 = apply([L("f-1", "bogus", 904, 60005)]); f2 = apply([L("f-1", "bogus", 904, 60005)])
    ok(st(f1) == ["failed"] and st(f2) == ["failed"] and not res(f2)[0].get("already") and rows("f-1") == 2, "6. taken again (%s %s rows %d)" % (st(f1), st(f2), rows("f-1")))

    print("== 7. the queued path")
    qs = [L("q-%d" % i, "created", 950 + i, 60100 + i, body=True, again="") for i in range(3)]
    for _ in (1, 2):
        e = j("select tally_recorder_enqueue(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(qs)))
        ok(e.get("ok") is True, "7. queued (%s)" % e)
    for _ in range(4):
        d = j("select tally_recorder_drain(15000)::text")
    ok(all(rows("q-%d" % i) == 1 for i in range(3)) and db.one("select count(*) from tally_recorder_pending where book_id = %s and state = 'done'" % q(B)) == "2",
       "7. two messages drained, one row per line (%s; last drain %s)" % ([rows("q-%d" % i) for i in range(3)], d))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
