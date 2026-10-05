"""python3 run_release_held_members.py - the owner's rule of 05-Oct-2026, item C: "Apply now" on a held change line
(tally_recorder_release_held) is for any member who may write (owner or staff), not only an owner. The same checks run
as for any line (tally_recorder_line); who pressed it and when are kept (released_by, released_at) on a line it applied; a
line that fails a check stays held with the reason in plain words (held_why), nothing stamped. A member who may only
read, a stranger and another firm's member are refused. Migration 54 replaces 53's function (its text otherwise the
same). On throwaway PostgreSQL (pg_stand, port 30542; never a real database), built 32 -> ... -> 53 -> 54.
RED: with 098592b's migration 54 (M54_FILE) staff are refused ("only an owner of the firm can release a held line")."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql")]
M54 = os.environ.get("M54_FILE") or os.path.join(SQLDIR, "migration-54-post-target-bridge.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEWER, OTHER = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
B, D1 = "f79e4bc3-871d-4482-874d-71c5fb2a1b33", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: CG + "-%08x" % mid
def sline(lid, ev, og, mid, alt, no, day, **kw):
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.0", "vch_no": no, "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alt, "saved_at": "2026-10-05T02:30:00.000Z",
         "vch_date": day, "vch_type": "Receipt", "master_id": mid, "object_guid": og, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
    x.update(kw); return x
def V(guid, alter, no, day, party=""):
    return {"guid": guid, "alter": alter, "type": "Receipt", "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": day}
def LN(guid, party, amt): return [[guid, "Cash", -amt, "", None, []], [guid, party, amt, "", None, []]]

text = open(M54).read() if os.path.exists(M54) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M54))
db = pg_stand.start(30542)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(("set role authenticated; " if uid else "") + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def row(lid): return (db.rows("select id, state, coalesce(held_why, '') as why, coalesce(released_by::text, '') as by, (released_at is not null)::text as rel from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(B), q(lid))) or [{}])[0]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Priya', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER), "B": q(B), "D": q(D1)})
    for path in FILES + [M54]:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, 50000, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), q(CG)))
    # October 2026 locked: a complete line for it is held, with the words
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by, note) values (%s, 'c1', %s, '2026-10-01', %s, 'filed')" % (q(F), q(B), q(OWNER)))
    L = dict(sline("c1", "created", G(0x7001), str(0x7001), 52001, "701", "2026-10-05"), vouchers=[V(G(0x7001), 52001, "701", "2026-10-05", "Party 701")], lines=LN(G(0x7001), "Party 701", 70))
    apply([L])
    held = row("c1")
    ok(held.get("state") == "held" and held.get("why"), "a line of a locked month: held, with the words (%s)" % (held,))
    # staff: Apply now while the month is still locked: the same checks; it stays held, the reason in plain words, nothing stamped
    r = j("select tally_recorder_release_held(%s)::text" % held["id"], STAFF)
    after = row("c1")
    ok("_error" not in r and r.get("state") == "held" and after.get("state") == "held" and after.get("why") and after.get("rel") == "false",
       "C. staff's Apply now on a line that fails a check: it stays held with the reason in plain words, not stamped (%s | %s)" % (r.get("_error") or r.get("why"), after.get("why")))
    # unlocked: staff's Apply now applies it; who and when are kept
    db.sql("update tally_month_locks set unlocked_at = now(), unlocked_by = %s where book_id = %s" % (q(OWNER), q(B)))
    r = j("select tally_recorder_release_held(%s)::text" % held["id"], STAFF)
    after = row("c1")
    ok(r.get("ok") is True and r.get("state") == "applied" and after.get("state") == "applied" and after.get("by") == STAFF and after.get("rel") == "true",
       "C. staff's Apply now applies it: released_by and released_at kept (%s | %s)" % (r.get("_error") or r.get("state"), after))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(0x7001)))) == "1", "C. the entry is in the books once")
    # the others: refused
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by, note) values (%s, 'c1', %s, '2026-09-01', %s, 'filed')" % (q(F), q(B), q(OWNER)))
    apply([dict(sline("c2", "created", G(0x7002), str(0x7002), 52002, "702", "2026-09-05"), vouchers=[V(G(0x7002), 52002, "702", "2026-09-05", "Party 702")], lines=LN(G(0x7002), "Party 702", 71))])
    h2 = row("c2")
    for who, name in ((VIEWER, "a member who may only read"), ("00000000-0000-0000-0000-00000000dead", "a stranger"), (OTHER, "another firm's owner")):
        r = j("select tally_recorder_release_held(%s)::text" % h2["id"], who)
        ok("_error" in r and row("c2").get("state") == "held", "C. %s is refused (%s)" % (name, r.get("_error", "")[-120:]))
    r = j("select tally_recorder_release_held(%s)::text" % h2["id"], OWNER)
    ok("_error" not in r and r.get("state") == "held", "C. the owner as before (the month still locked: held) (%s)" % r.get("_error", r.get("state")))
    fdef = db.one("select pg_get_functiondef('public.tally_recorder_release_held(bigint)'::regprocedure)")
    ok("can_write()" in fdef and "role = 'owner'" not in fdef, "C. the function checks can_write(), not the owner role")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
