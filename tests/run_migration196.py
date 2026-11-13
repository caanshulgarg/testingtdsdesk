"""python3 run_migration196.py - migration-196-recorder-no-held (13-Nov-2026, next-fix-no-held: the owner's rule "no entry made
in Tally is held in FinCom"). On throwaway PostgreSQL (pg_stand, port 31960 unless PG196_PORT; never a real database), built
32 -> ... -> 60 -> 67 in staging's order, held lines made under 67, then 196 (twice).
  0. the file: one transaction with lock_timeout, add-only (no delete from / drop / truncate / table change), no real
     database named; two functions: tally_recorder_line (67's text with only lines marked "196" added; security definer,
     search_path public, pg_temp; granted to nobody) and tally_recorder_held_rerun (service_role only); a guard refuses it
     over a tally_recorder_line that is not 67's; run twice, the same text. Prints md5(prosrc) before and after.
  1. renumbering: Tally's entry at the AlterID the copy holds with another number (a created line too) or another date:
     applied, the copy takes Tally's number / date on the SAME row (one row for the GUID, its lines on the new day only).
  2. out-of-order AlterIDs: a newer line whose own words name another number than Tally's entry sent with it is applied
     (Tally's number); the older line arriving after it is 'stale' and changes nothing.
  3. an unknown GUID: Tally's entry the copy does not hold, the line naming another number: applied as created (one row).
  4. duplicates: the same change again (another line id): 'duplicate', still one row. The add-on's line of a new entry
     carrying the previous entry's MasterID (the bridge's "was not saved after this line"): 'duplicate' when the copy holds
     that new entry; the MasterID's own entry keeps its number and date (never renumbered onto); with the new entry not in
     the copy the line stays held and nothing is written.
  5. a delete without a GUID that nothing in the copy can be: applied, nothing deleted; one whose MasterID's entry is live:
     held, the entry still live.
  6. ledger lines the ledger list holds: without a GUID by name 'duplicate'; by GUID at a higher AlterID 'stale'.
  7. tally_recorder_held_rerun: the lines held under 67 (sections 2-6's kinds) settle by the new rules; run again: nothing
     changes (every row's state and words the same), 0 settled; busy book: nothing done.
RED: RED_WITHOUT=1 builds the same database without 196 (67 only): sections 1-7 fail (exit 1)."""
import os, re, sys, json, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql",
                                           "migration-60-recorder-lows.sql", "migration-67-recorder-renumbered.sql")]
M67 = os.path.join(SQLDIR, "migration-67-recorder-renumbered.sql")
M196 = os.path.join(SQLDIR, "migration-196-recorder-no-held.sql")
RED = os.environ.get("RED_WITHOUT") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999196", "55555555-5555-5555-5555-555555555196"
B, D1 = "f79e4bc3-871d-4482-874d-000000000196", "58d73e82-57f3-4f72-9f3d-14cc93a50196"
CG = "0c5fd9b3-7235-4cbb-b4cd-1124be590196"
CO = "TEST TRADERS"
G = lambda mid: CG + "-%08x" % mid
START = 50000
NOSAVE = "Tally's voucher with MasterID %d was not saved after this line (its AlterID is still the line's): no save of it happened here; asked by its type and number: Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload)."

text = open(M196).read() if os.path.exists(M196) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M196))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file: %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\b", low) and "create table" not in low, "0. add-only (no drop, truncate, table change)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_recorder_held_rerun", "tally_recorder_line"], "0. two functions: tally_recorder_line, tally_recorder_held_rerun (%s)" % FNS)
ok("grant execute on function public.tally_recorder_held_rerun(uuid, integer) to service_role;" in text and "revoke all on function public.tally_recorder_held_rerun(uuid, integer) from public, anon, authenticated;" in text, "0. explicit grants: the re-run to service_role only")
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L67 = block(open(M67).read(), "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L196 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
removed = [d for d in difflib.unified_diff(L67.split("\n"), L196.split("\n"), lineterm="", n=0) if d.startswith("-") and not d.startswith("---")]
added = [d for d in difflib.unified_diff(L67.split("\n"), L196.split("\n"), lineterm="", n=0) if d.startswith("+") and not d.startswith("+++")]
unmarked = [x for x in added if not re.search(r"--.*\b196\b", x) and not re.match(r"^\+\s*--", x)]
ok(not removed and added and not unmarked, "0. tally_recorder_line is 67's text with %d lines added, each marked '196' (removed: %s; unmarked: %s)" % (len(added), removed[:1], unmarked[:1]))

db = pg_stand.start(int(os.environ.get("PG196_PORT") or 31960))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def res(r): return [(x.get("state"), x.get("why") or "") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else [("error", json.dumps(r)[:400])]
def V(mid, alter, no, d, typ="Sales", party="Party A"):
    return {"guid": G(mid), "alter": alter, "type": typ, "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def L(lid, ev, mid, alter, d="20261003", no=None, typ="Sales", guid=None, body=None, why=None):
    """a line; body = (number, day) of Tally's entry sent with it (None: no entry); guid '' : no GUID on the line"""
    g = G(mid) if guid is None else (guid or None)
    x = {"pc": "PC-1", "user": "Tally User", "event": ev, "bridge": "go-test", "vch_no": no if no is not None else str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter,
         "saved_at": "2026-10-06T05:00:00.000Z", "vch_date": d, "vch_type": typ, "master_id": str(mid) if mid else "", "object_guid": g, "company_guid": CG, "company": CO}
    if why: x["heldWhy"] = why
    if body:
        bn, bd = body
        x["vouchers"] = [V(mid, alter, bn, bd, typ)]
        x["lines"] = [[G(mid), "Party A", -118.0, "", None, []], [G(mid), "Sales 18%", 100.0, "", None, []], [G(mid), "CGST 9%", 9.0, "", None, []], [G(mid), "SGST 9%", 9.0, "", None, []]]
    return x
def vrow(mid): return (db.rows("select (deleted_at is not null)::text as deleted, alter_id::text as alter_id, vno, day::text as day from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(mid)))) or [None])[0]
def nrows(mid): return int(db.one("select count(*) from tally_vouchers where book_id = %s and lower(guid) = lower(%s)" % (q(B), q(G(mid)))))
def ldays(mid): return [r["day"] for r in db.rows("select distinct day::text as day from tally_lines where book_id = %s and guid = %s order by 1" % (q(B), q(G(mid))))]
def line(lid): return (db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(B), q(lid))) or [{"state": None, "why": ""}])[0]
def prosrc(): return db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure")
def can(fn, role): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q(fn)))
def snapshot(): return db.rows("select id::text, state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s order by id" % q(B))
def rerun(mx=200): return j("select tally_recorder_held_rerun(%s, %d)::text" % (q(B), mx))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Test Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', %(CO)s, '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'PC-1', 'h1', '2.5.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, %(CO)s, '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    before = prosrc()
    print("  tally_recorder_line prosrc md5 under 67: %s" % before)

    # ---- lines held under 67, for section 7 (each kind 196 settles)
    res(apply([L("p-603", "created", 603, 60010, d="20261001", no="283", typ="Journal", body=("283", "2026-10-01")),
               L("p-604", "created", 604, 60012, d="20261002", no="284", typ="Journal", body=("284", "2026-10-02"))]))
    pre = res(apply([L("p-pre", "altered", 603, None, d="20261002", no="284", typ="Journal", guid="", why=NOSAVE % 603),          # the add-on's line of 284 with 283's MasterID
                     L("p-nb", "altered", 700, 60020, no="71", body=("70", "2026-10-03")),                                        # Tally's entry 70, the line names 71
                     L("p-del", "deleted", 701, None, d="20261005", no="", typ="Sales", guid="")]))                               # a delete nothing in the copy can be
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, tally_guid, alter_id) values (%s, %s, 'Party B', 'Sundry Debtors', %s, 900)" % (q(B), q(F), q(CG + "-00000aaa")))
    pre += res(apply([dict(L("p-led", "ledger_created", 0, None, guid=""), name="Party B", vch_type="", vch_no="", vch_date="")]))
    ok([x[0] for x in pre] == ["held"] * 4, "setup: 4 lines held under 67 (%s)" % [x[0] for x in pre])

    if not RED:
        r0 = psql_text(open(os.path.join(SQLDIR, "migration-60-recorder-lows.sql")).read())
        was = prosrc()
        rr = psql_text(text)
        ok(r0.returncode == 0 and rr.returncode != 0 and "run 67 first" in rr.stderr and prosrc() == was, "0. guard: 196 over 60's line: refused, nothing changed (%s)" % (rr.stderr.strip().splitlines() or [""])[-1][:160])
        ok(psql_text(open(M67).read()).returncode == 0 and prosrc() == before, "0. 67's line put back")
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "196 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
            if i == 1: after1 = prosrc()
        after = prosrc()
        print("  tally_recorder_line prosrc md5 under 196: %s" % after)
        print("  migration file md5: %s" % __import__("hashlib").md5(open(M196, "rb").read()).hexdigest())
        ok(after != before and after == after1, "0. 196 replaces the line's text, the same both runs")
        ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
        LF, RF = "public.tally_recorder_line(uuid, uuid, jsonb, bigint)", "public.tally_recorder_held_rerun(uuid, integer)"
        ok(all(can(LF, r) in ("f", "false") for r in ("anon", "authenticated", "service_role")), "0. tally_recorder_line granted to nobody")
        ok([can(RF, r) for r in ("anon", "authenticated", "service_role")] == ["f", "f", "t"], "0. the re-run: service_role only (%s)" % [can(RF, r) for r in ("anon", "authenticated", "service_role")])
    else:
        print("  RED_WITHOUT=1: 196 NOT applied (67 only)")

    print("== 1. renumbering")
    r = res(apply([L("r-cre", "created", 910, 60100, no="191", body=("191", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "191", "1. made: 191 (%s)" % r)
    r = res(apply([L("r-ren-c", "created", 910, 60100, no="192", body=("192", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "192" and nrows(910) == 1, "1. a created line, the same AlterID, Tally says 192: applied, 192, one row (%s %s)" % (r, vrow(910)))
    r = res(apply([L("r-ren-d", "altered", 910, 60100, no="192", d="20261004", body=("192", "2026-10-04"))]))
    v = vrow(910)
    ok(r[0][0] == "applied" and v["day"] == "2026-10-04" and v["vno"] == "192" and nrows(910) == 1 and ldays(910) == ["2026-10-04"], "1. the same AlterID, another date: applied, dated 04-Oct, one row, its lines on 04-Oct only (%s %s %s)" % (r, v, ldays(910)))

    r = res(apply([L("r-ren-e", "altered", 910, 60100, no="193", d="20261004", body=("193", "2026-10-04"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "193" and nrows(910) == 1 and line("r-ren-d")["state"] == "replaced",
       "1. renumbered again at the same AlterID (altered twice): applied, 193, the earlier altered line 'replaced', one row (%s %s %s)" % (r, vrow(910), line("r-ren-d")))

    print("== 2. out-of-order AlterIDs")
    res(apply([L("o-cre", "created", 920, 60200, no="40", body=("40", "2026-10-03"))]))
    r = res(apply([L("o-new", "altered", 920, 60220, no="41", body=("42", "2026-10-03"))]))     # the line's words 41; Tally's entry 42
    ok(r[0][0] == "applied" and vrow(920)["vno"] == "42" and vrow(920)["alter_id"] == "60220" and nrows(920) == 1, "2. newer, the line naming 41, Tally's entry 42: applied, 42 (%s %s)" % (r, vrow(920)))
    r = res(apply([L("o-old", "altered", 920, 60210, no="43", body=("43", "2026-10-03"))]))
    ok(r[0][0] == "stale" and vrow(920)["vno"] == "42" and vrow(920)["alter_id"] == "60220", "2. older, arriving after: 'stale', 42 kept (%s %s)" % (r, vrow(920)))

    print("== 3. an unknown GUID")
    r = res(apply([L("u-new", "created", 930, 60300, no="9", body=("8", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(930) and vrow(930)["vno"] == "8" and nrows(930) == 1, "3. not in the copy, the line naming 9, Tally's entry 8: applied as created, 8, one row (%s %s)" % (r, vrow(930)))

    print("== 4. duplicates")
    r = res(apply([L("d-again", "altered", 930, 60300, no="8", body=("8", "2026-10-03"))]))
    ok(r[0][0] == "duplicate" and nrows(930) == 1, "4. the same change again: 'duplicate', one row (%s)" % r)
    res(apply([L("n-605", "created", 605, 60030, d="20261006", no="285", typ="Journal", body=("285", "2026-10-06"))]))
    r = res(apply([L("n-pre", "altered", 604, None, d="20261006", no="285", typ="Journal", guid="", why=NOSAVE % 604)]))
    ok(r[0][0] == "duplicate" and vrow(604)["vno"] == "284" and vrow(604)["day"] == "2026-10-02" and nrows(605) == 1, "4. the add-on's line of 285 with 284's MasterID: 'duplicate', 284 untouched (%s %s)" % (r, vrow(604)))
    r = res(apply([L("n-miss", "altered", 605, None, d="20261007", no="286", typ="Journal", guid="", why=NOSAVE % 605)]))
    ok(r[0][0] == "held" and vrow(605)["vno"] == "285" and vrow(605)["day"] == "2026-10-06" and int(db.one("select count(*) from tally_vouchers where book_id = %s and vno = '286'" % q(B))) == 0,
       "4. the new entry 286 not in the copy: held, 285 never renumbered onto, no row made (%s %s)" % (r, vrow(605)))

    print("== 5. deletes without a GUID")
    r = res(apply([L("x-none", "deleted", 940, None, d="20261008", no="77", guid="")]))
    ok(r[0][0] == "applied" and "nothing to delete" in r[0][1], "5. nothing in the copy can be it: applied, nothing deleted (%s)" % r)
    r = res(apply([L("x-live", "deleted", 910, None, d="20261004", no="", guid="")]))
    ok(r[0][0] == "held" and vrow(910)["deleted"] == "false", "5. its MasterID's entry live in the copy: held, the entry still live (%s %s)" % (r, vrow(910)))

    print("== 6. ledger lines")
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, tally_guid, alter_id) values (%s, %s, 'Party C', 'Sundry Debtors', %s, 950)" % (q(B), q(F), q(CG + "-00000bbb")))
    r = res(apply([dict(L("g-name", "ledger_created", 0, None, guid=""), name="Party C", vch_type="", vch_no="", vch_date="")]))
    ok(r[0][0] == "duplicate", "6. without a GUID, the list holds the name: 'duplicate' (%s)" % r)
    r = res(apply([dict(L("g-guid", "ledger_altered", 0, 940, guid=CG + "-00000bbb"), name="Party C", master_id="2987", vch_type="", vch_no="", vch_date="")]))
    ok(r[0][0] == "stale", "6. by GUID, the list holds AlterID 950 above the line's 940: 'stale' (%s)" % r)

    print("== 7. the re-run of lines held under 67")
    a = rerun()
    st = {k: line(k)["state"] for k in ("p-pre", "p-nb", "p-del", "p-led")}
    ok(isinstance(a, dict) and a.get("ok") is True and st == {"p-pre": "duplicate", "p-nb": "applied", "p-del": "applied", "p-led": "duplicate"}, "7. settled by the new rules (%s %s)" % (st, json.dumps(a)[:300]))
    ok(vrow(603)["vno"] == "283" and vrow(604)["vno"] == "284" and vrow(700) and vrow(700)["vno"] == "70" and nrows(700) == 1, "7. 283 / 284 untouched; Tally's 70 applied once (%s %s %s)" % (vrow(603), vrow(604), vrow(700)))
    s1 = snapshot(); b = rerun(); s2 = snapshot()
    ok(isinstance(b, dict) and b.get("settled") == 0 and s1 == s2, "7. run again: nothing changes, 0 settled (%s)" % json.dumps(b)[:200])
    busy = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-c",
                             "begin; select pg_advisory_xact_lock(hashtext(%s)); select pg_sleep(4); commit;" % q(B)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    __import__("time").sleep(1.5)
    c = rerun(); busy.wait()
    ok(isinstance(c, dict) and c.get("busy") is True and c.get("rerun") == 0, "7. another session holds the book: nothing done (%s)" % json.dumps(c)[:200])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
