"""python3 run_migration196.py - migration-196-recorder-no-held (13-Nov-2026, next-fix-no-held; the owner's decision: no entry
made in Tally is ever held in FinCom: every line ends applied, duplicate, stale or replaced, or is 'fetching' - being fetched,
asked again by the cloud and the bridge by themselves). On throwaway PostgreSQL (pg_stand, port 31960 unless PG196_PORT;
never a real database), built 32 -> ... -> 67 -> 92 -> 98 -> 133 -> 135 -> 136 -> 137 -> 150 -> 158 -> 160 as
run_migration182.py builds it, lines held under that, then 196 (twice). Made-up companies and parties only.
  0. the file: one transaction with lock_timeout, no 'delete from' / drop / truncate / table made except the probes table,
     the one table change the state check's new value; no real database named; tally_recorder_line is 67's text with only
     lines marked "196" changed; the readers are their files' text with only lines marked "196" changed; grants explicit;
     a guard refuses it over a tally_recorder_line that is not 67's; run twice, the same text. md5s printed.
  1. renumbering: Tally's entry at the AlterID the copy holds with another number (a created line too), another date, and
     again at the same AlterID: applied, the copy takes Tally's on the SAME row; the earlier applied line 'replaced'.
  2. out-of-order AlterIDs: the newer applied by Tally's entry whatever the line names; the older after it 'stale'.
  3. an unknown GUID: applied as created, one row.
  4. duplicates: the same change again 'duplicate'; the add-on's line of a new entry with the entry before it's MasterID:
     'duplicate' when the copy holds it (that MasterID's entry untouched); not in the copy: 'fetching', nothing written.
  5. the candidate search (FinComVoucherObject by GUID through the refetch): nothing while typing; a match at +1 (applied,
     the line replaced); a match at +3 (+1 and +2 asked first, one at a time); a wrong date rejected ('stale', not
     applied, the line still fetching); no match: 5 asks, then none until a new AlterID, at most 15 in all (no loop).
  6. deletes: no GUID, nothing in the copy can be it: applied; no GUID, could be a live entry: 'fetching', still live;
     WITH a GUID the copy does not hold: applied, nothing removed; WITH a GUID the copy holds: deleted.
  7. a FinCom id naming no posting: a plain Tally entry (with Tally's body applied; without it 'fetching').
  8. a filed (locked) month: applied anyway; one alert "Entry changed in Tally in a filed month: <type> <no> <date>"; a
     posting's own lock check still sees the month locked.
  9. Tally busy / no answer: 'fetching'. Ledger lines: by name / by GUID settled; a delete of a ledger not in the list applied.
 10. tally_recorder_held_rerun: every line held under the old rules ends applied / duplicate / stale / replaced / fetching,
     none 'held'; again: nothing changes; a busy book: nothing done. tally_held_status counts 'fetching'.
RED: RED_WITHOUT=1 builds the same database without 196: the checks after section 0 fail (exit 1)."""
import os, re, sys, json, subprocess, difflib, hashlib, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql", "migration-63-recorder-repeat.sql",
                                           "migration-67-recorder-renumbered.sql", "migration-92-settle-unnamed-deletes.sql", "migration-98-period-pull.sql", "migration-133-fetch-check.sql")]
AFTER = [os.path.join(SQLDIR, f) for f in ("migration-135-check-changes.sql", "migration-136-held-settle.sql", "migration-137-held-status-online.sql", "migration-150-gap-closed-by-days.sql",
                                           "migration-158-held-delete-fast.sql", "migration-160-gap-read-close.sql")]
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
BR = "go-test196"
CG = "0c5fd9b3-7235-4cbb-b4cd-1124be590196"
CO = "MADE UP TRADERS"
G = lambda mid: CG + "-%08x" % mid
START = 50000
NOSAVE = "Tally's voucher with MasterID %d was not saved after this line (its AlterID is still the line's): no save of it happened here; asked by its type and number: Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload)."

text = open(M196).read() if os.path.exists(M196) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M196))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("\ncommit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0 and not re.search(r"\bdrop\s+(table|function|column|index|trigger)\b", low) and not re.search(r"\btruncate\b", low), "0. no row, table, function, column, index or trigger removed")
TABLES = ["tally_recorder_probes", "tally_recorder_tries", "tally_recorder_ledger_lists"]
ok(re.findall(r"create table if not exists public\.(\w+)", text) == TABLES and re.findall(r"alter table (public\.\w+) (\w+)", text) == [("public.tally_recorder_lines", "drop")] + [("public." + t, "enable") for t in TABLES]
   and "drop constraint %I, add constraint %I check (state in (" in text,
   "0. three new tables (RLS on each); the only other table change is the state check's new value (%s)" % re.findall(r"alter table (public\.\w+) (\w+)", text))
ok("'replaced'', ''fetching''))" in text, "0. the state check keeps every value it had and adds 'fetching'")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
for g in ("grant execute on function public.tally_recorder_held_rerun(uuid, integer) to service_role;", "grant execute on function public.tally_recorder_probe_take(uuid, uuid, text, boolean, integer) to service_role;",
          "grant select, insert, update on public.tally_recorder_probes to service_role;", "revoke all on public.tally_recorder_probes from public, anon, authenticated;",
          "grant select, insert, update on public.tally_recorder_tries to service_role;", "grant select, insert, update on public.tally_recorder_ledger_lists to service_role;",
          "grant execute on function public.tally_recorder_ledger_asks(uuid, uuid, text, boolean) to service_role;",
          "grant execute on function public.tally_recorder_fetching_sweep(integer) to service_role;",
          "perform cron.schedule('tally-recorder-fetching-sweep', '37 21 * * *', 'select public.tally_recorder_fetching_sweep(2000)');"):
    ok(g in text, "0. explicit grant: " + g[:90])
def block(t, name):
    i = [m.start() for m in re.finditer(r"create or replace function public\." + name + r"\(", t)][-1]
    m = re.compile(r"\$(\w*)\$").search(t, i); tag = m.group(0); j = t.index(tag, m.end()) + len(tag); return t[i:t.index(";", j) + 1]
def marked(old, new, what):
    d = [x for x in difflib.unified_diff(old.split("\n"), new.split("\n"), lineterm="", n=0) if x[:1] in "+-" and x[:3] not in ("+++", "---")]
    bad = [x for x in d if x.startswith("+") and not re.search(r"--.*\b196\b", x) and not re.match(r"^\+\s*--", x)]
    ok(d and not bad, "0. %s: its text with %d changed lines, each marked '196' (unmarked: %s)" % (what, len(d), bad[:1]))
marked(block(open(M67).read(), "tally_recorder_line"), block(text, "tally_recorder_line"), "tally_recorder_line (67's)")
READERS = {"tally_check_days_held_settle": "136-held-settle", "tally_days_held_settle": "136-held-settle", "tally_days_recorder_release": "50-recorder-held", "tally_days_recorder_settle": "92-settle-unnamed-deletes",
           "tally_held_delete_by_heads": "158-held-delete-fast", "tally_held_front": "158-held-delete-fast", "tally_held_queue_of": "136-held-settle", "tally_held_settle_day": "136-held-settle",
           "tally_read_view": "146-reads-follow-company", "tally_recorder_lines_held_queue": "136-held-settle", "tally_recorder_release_day": "53-recorder-placeholder-settled",
           "tally_recorder_release_held": "54-post-target-bridge", "tally_recorder_settle_unnamed": "92-settle-unnamed-deletes", "tally_recorder_short_held": "45-bulk-posting",
           "tally_recorder_short_retry": "53-recorder-placeholder-settled", "tally_held_status": "137-held-status-online", "tally_month_locked": "44-recorder", "tally_held_line_ours": "136-held-settle"}
for fn, f in READERS.items():
    marked(block(open(os.path.join(SQLDIR, "migration-%s.sql" % f)).read(), fn), block(text, fn), fn + " (" + f.split("-")[0] + "'s)")

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
def V(mid, alter, no, d, typ="Sales", narr=""):
    return {"guid": G(mid), "alter": alter, "type": typ, "no": no, "party": "Party A", "narr": narr, "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def L(lid, ev, mid, alter, d="20261003", no=None, typ="Sales", guid=None, body=None, why=None, **kw):
    """a line; body = (number, day) of Tally's entry sent with it under the line's GUID (None: no entry); guid '': no GUID"""
    g = G(mid) if guid is None else (guid or None)
    x = {"pc": "PC-1", "user": "Tally User", "event": ev, "bridge": BR, "vch_no": no if no is not None else str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter,
         "saved_at": "2026-10-06T05:00:00.000Z", "vch_date": d, "vch_type": typ, "master_id": str(mid) if mid else "", "object_guid": g, "company_guid": CG, "company": CO}
    if why: x["heldWhy"] = why
    if body:
        bn, bd = body; gg = g or G(mid)
        x["vouchers"] = [dict(V(mid, alter, bn, bd, typ), guid=gg)]
        x["lines"] = [[gg, "Party A", -118.0, "", None, []], [gg, "Sales 18%", 100.0, "", None, []], [gg, "CGST 9%", 9.0, "", None, []], [gg, "SGST 9%", 9.0, "", None, []]]
    x.update(kw)
    return x
def vrow(mid): return (db.rows("select (deleted_at is not null)::text as deleted, alter_id::text as alter_id, vno, day::text as day from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(mid)))) or [None])[0]
def nrows(mid): return int(db.one("select count(*) from tally_vouchers where book_id = %s and lower(guid) = lower(%s)" % (q(B), q(G(mid)))))
def ldays(mid): return [r["day"] for r in db.rows("select distinct day::text as day from tally_lines where book_id = %s and guid = %s order by 1" % (q(B), q(G(mid))))]
def line(lid): return (db.rows("select id::text, state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s and line_id = %s order by id desc limit 1" % (q(B), q(lid))) or [{"id": None, "state": None, "why": ""}])[0]
def prosrc(fn="tally_recorder_line(uuid, uuid, jsonb, bigint)"): return db.one("select md5(prosrc) from pg_proc where oid = 'public.%s'::regprocedure" % fn)
def can(fn, role): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q(fn)))
def snapshot(): return db.rows("select id::text, state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s order by id" % q(B))
def sq(x):
    """a setup statement; under RED_WITHOUT=1 one on a table or state 196 adds fails, the check after it then fails (never a crash)"""
    try: db.sql(x)
    except RuntimeError:
        if not RED: raise
def rerun(mx=200): return j("select tally_recorder_held_rerun(%s, %d)::text" % (q(B), mx))
def take(idle=True):
    x = j("select tally_recorder_probe_take(%s, %s, %s, %s, 3)::text" % (q(F), q(D1), q(BR), "true" if idle else "false"))
    return x if isinstance(x, list) else None     # None: no such function (RED), never an empty list
def unpace():
    if not RED: db.sql("update tally_recorder_probes set last_at = now() - interval '3 minutes' where book_id = %s" % q(B))
def probe(lid):
    if RED: return None
    return (db.rows("select p.round::text, p.handed::text from tally_recorder_probes p join tally_recorder_lines l on l.id = p.line_row where l.book_id = %s and l.line_id = %s" % (q(B), q(lid))) or [None])[0]
def answer(cid, mid, no, d, typ="Journal"):
    """the bridge's ":resolved" line for a candidate: Tally's entry for that MasterID (its own type, number and date)"""
    return L(cid + ":resolved", "created", mid, 70000 + mid, d=d.replace("-", ""), no=no, typ=typ, body=(no, d))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Made-up Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', %(CO)s, '2025-04-01', '2025-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, %(CO)s, '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, version, info, period_fetch, last_seen) values (%s, %s, 'PC-1', 'h1', '2.5.0', '{}'::jsonb, true, now());""" % (q(D1), q(F)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    before = prosrc()
    print("  tally_recorder_line prosrc md5 before 196: %s" % before)

    # ---- lines held under the old rules (section 10 runs them again)
    res(apply([L("p-603", "created", 603, 60010, d="20261001", no="283", typ="Journal", body=("283", "2026-10-01")),
               L("p-604", "created", 604, 60012, d="20261002", no="284", typ="Journal", body=("284", "2026-10-02"))]))
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, tally_guid, alter_id) values (%s, %s, 'Party B', 'Sundry Debtors', %s, 900)" % (q(B), q(F), q(CG + "-00000aaa")))
    pre = res(apply([L("p-pre", "altered", 603, None, d="20261002", no="284", typ="Journal", guid="", why=NOSAVE % 603),   # the add-on's line of 284 with 283's MasterID
                     L("p-nb", "altered", 700, 60020, no="71", body=("70", "2026-10-03")),                                 # Tally's entry 70, the line names 71
                     L("p-del", "deleted", 701, None, d="20261005", no="", typ="Sales", guid=""),                          # a delete nothing in the copy can be
                     L("p-busy", "created", 0, None, d="20261005", no="901", guid="", why="waiting: Tally busy; FinCom asks again at 13:10"),
                     dict(L("p-led", "ledger_created", 0, None, guid=""), name="Party B", vch_type="", vch_no="", vch_date="")]))
    ok([x[0] for x in pre] == ["held"] * 5, "setup: 5 lines held under the old rules (%s)" % [x[0] for x in pre])

    if not RED:
        r0 = psql_text(open(os.path.join(SQLDIR, "migration-60-recorder-lows.sql")).read())
        was = prosrc()
        rr = psql_text(text)
        ok(r0.returncode == 0 and rr.returncode != 0 and "nothing changed" in rr.stderr and prosrc() == was, "0. guard: 196 over 60's line: refused, nothing changed (%s)" % (rr.stderr.strip().splitlines() or [""])[-1][:160])
        ok(psql_text(open(M67).read()).returncode == 0 and prosrc() == before, "0. 67's line put back")
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "196 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
            if i == 1: after1 = prosrc()
        after = prosrc()
        print("  tally_recorder_line prosrc md5 under 196: %s" % after)
        print("  migration file md5: %s" % hashlib.md5(open(M196, "rb").read()).hexdigest())
        ok(after != before and after == after1, "0. 196 replaces the line's text, the same both runs")
        ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
        LF, RF, PF = "public.tally_recorder_line(uuid, uuid, jsonb, bigint)", "public.tally_recorder_held_rerun(uuid, integer)", "public.tally_recorder_probe_take(uuid, uuid, text, boolean, integer)"
        ok(all(can(LF, r) in ("f", "false") for r in ("anon", "authenticated", "service_role")), "0. tally_recorder_line granted to nobody")
        ok([can(RF, r) for r in ("anon", "authenticated", "service_role")] == ["f", "f", "t"] and [can(PF, r) for r in ("anon", "authenticated", "service_role")] == ["f", "f", "t"], "0. the re-run and the candidate search: service_role only")
        ok(can("public.tally_held_status(text)", "authenticated") == "t", "0. tally_held_status keeps its grant (authenticated)")
    else:
        print("  RED_WITHOUT=1: 196 NOT applied")

    print("== 1. renumbering")
    r = res(apply([L("r-cre", "created", 910, 60100, no="191", body=("191", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "191", "1. made: 191 (%s)" % r)
    r = res(apply([L("r-ren-c", "created", 910, 60100, no="192", body=("192", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "192" and nrows(910) == 1, "1. a created line, the same AlterID, Tally says 192: applied, one row (%s %s)" % (r, vrow(910)))
    r = res(apply([L("r-ren-d", "altered", 910, 60100, no="192", d="20261004", body=("192", "2026-10-04"))]))
    v = vrow(910)
    ok(r[0][0] == "applied" and v["day"] == "2026-10-04" and nrows(910) == 1 and ldays(910) == ["2026-10-04"], "1. the same AlterID, another date: applied, one row, its lines on the new day only (%s %s %s)" % (r, v, ldays(910)))
    r = res(apply([L("r-ren-e", "altered", 910, 60100, no="193", d="20261004", body=("193", "2026-10-04"))]))
    ok(r[0][0] == "applied" and vrow(910)["vno"] == "193" and nrows(910) == 1 and line("r-ren-d")["state"] == "replaced", "1. renumbered again at the same AlterID: applied, the earlier line 'replaced' (%s %s)" % (r, line("r-ren-d")))

    print("== 2. out-of-order AlterIDs")
    res(apply([L("o-cre", "created", 920, 60200, no="40", body=("40", "2026-10-03"))]))
    r = res(apply([L("o-new", "altered", 920, 60220, no="41", body=("42", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(920)["vno"] == "42" and vrow(920)["alter_id"] == "60220" and nrows(920) == 1, "2. newer, the line naming 41, Tally's entry 42: applied, 42 (%s)" % r)
    r = res(apply([L("o-old", "altered", 920, 60210, no="43", body=("43", "2026-10-03"))]))
    ok(r[0][0] == "stale" and vrow(920)["vno"] == "42" and vrow(920)["alter_id"] == "60220", "2. older, arriving after: 'stale', 42 kept (%s)" % r)

    print("== 3. an unknown GUID")
    r = res(apply([L("u-new", "created", 930, 60300, no="9", body=("8", "2026-10-03"))]))
    ok(r[0][0] == "applied" and vrow(930) and vrow(930)["vno"] == "8" and nrows(930) == 1, "3. applied as created, Tally's 8, one row (%s)" % r)

    print("== 4. duplicates")
    r = res(apply([L("d-again", "altered", 930, 60300, no="8", body=("8", "2026-10-03"))]))
    ok(r[0][0] == "duplicate" and nrows(930) == 1, "4. the same change again: 'duplicate', one row (%s)" % r)
    res(apply([L("n-605", "created", 605, 60030, d="20261006", no="285", typ="Journal", body=("285", "2026-10-06"))]))
    r = res(apply([L("n-pre", "altered", 604, None, d="20261006", no="285", typ="Journal", guid="", why=NOSAVE % 604)]))
    ok(r[0][0] == "duplicate" and vrow(604)["vno"] == "284" and vrow(604)["day"] == "2026-10-02" and nrows(605) == 1, "4. the add-on's line of 285 with 284's MasterID: 'duplicate', 284 untouched (%s)" % r)
    r = res(apply([L("n-miss", "altered", 605, None, d="20261007", no="286", typ="Journal", guid="", why=NOSAVE % 605)]))
    ok(r[0][0] == "fetching" and vrow(605)["vno"] == "285" and int(db.one("select count(*) from tally_vouchers where book_id = %s and vno = '286'" % q(B))) == 0,
       "4. the new entry 286 not in the copy: 'fetching', 285 never renumbered onto, no row made (%s)" % r)

    print("== 5. the candidate search")
    ok(take(idle=False) == [], "5. typing (the gate not quiet): nothing handed")
    # a match at +1: line m1 (Journal 501 of 08-Oct, carrying MasterID 800's ids)
    res(apply([L("m1", "altered", 800, None, d="20261008", no="501", typ="Journal", guid="", why=NOSAVE % 800)]))
    t = take(); c1 = [x for x in t if x["line_id"].startswith("m1.")] if isinstance(t, list) else []
    ok(len(c1) == 1 and c1[0]["line_id"] == "m1.p1c1" and c1[0]["master_id"] == "801" and c1[0]["vch_type"] == "Journal" and c1[0]["vch_no"] == "501" and c1[0]["vch_date"] == "20261008" and c1[0]["event"] == "created",
       "5. +1 handed: MasterID 801 with the line's type, number and date (%s)" % json.dumps(t)[:300])
    t2 = take(); ok(t2 is not None and all(not x["line_id"].startswith("m1.") for x in t2), "5. one at a time: nothing more for the line within 2 minutes")
    r = res(apply([answer("m1.p1c1", 801, "501", "2026-10-08")]))
    ok(r[0][0] == "applied" and vrow(801) and vrow(801)["vno"] == "501" and nrows(801) == 1 and line("m1")["state"] == "replaced", "5. match at +1: Tally's entry applied, the line replaced (%s %s)" % (r, line("m1")))
    unpace(); t2 = take(); ok(t2 is not None and all(not x["line_id"].startswith("m1.") for x in t2), "5. stops at the first match: nothing more asked for it")
    # a match at +3
    res(apply([L("m3", "altered", 810, None, d="20261009", no="601", typ="Journal", guid="", why=NOSAVE % 810)]))
    got = []
    for k in range(3):
        unpace(); got += [x["line_id"] for x in (take() or []) if x["line_id"].startswith("m3.")]
    ok(got == ["m3.p1c1", "m3.p1c2", "m3.p1c3"], "5. +1, +2, +3 handed one at a time (%s)" % got)
    r = res(apply([answer("m3.p1c3", 813, "601", "2026-10-09")]))
    ok(r[0][0] == "applied" and vrow(813)["vno"] == "601" and line("m3")["state"] == "replaced" and vrow(811) is None and vrow(812) is None, "5. match at +3: applied, the line replaced, nothing made for +1 / +2 (%s)" % r)
    # a wrong date rejected
    res(apply([L("mw", "altered", 820, None, d="20261010", no="701", typ="Journal", guid="", why=NOSAVE % 820)]))
    unpace(); take()
    r = res(apply([answer("mw.p1c1", 821, "701", "2026-10-11")]))
    ok(r[0][0] == "stale" and vrow(821) is None and line("mw")["state"] == "fetching", "5. a wrong date: 'stale', not applied, the line still fetching (%s %s)" % (r, line("mw")))
    r = res(apply([answer("mw.p1c2", 822, "702", "2026-10-10")]))
    ok(r[0][0] == "stale" and vrow(822) is None, "5. a wrong number: 'stale', not applied (%s)" % r)
    # no match: 5 asks, then none until a new AlterID; never more than 15
    res(apply([L("mn", "altered", 830, None, d="20261012", no="801", typ="Journal", guid="", why=NOSAVE % 830)]))
    n = 0
    for k in range(14):
        unpace(); n += len([x for x in (take() or []) if x["line_id"].startswith("mn.")])
    ok(n == 5 and probe("mn") == {"round": "1", "handed": "5"}, "5. no match: 5 asks in round 1, then none (%s %s)" % (n, probe("mn")))
    ok("none matched yet: asked again after Tally's next new entry" in line("mn")["why"] and line("mn")["state"] == "fetching", "5. in plain words, not held: %s" % line("mn")["why"][-160:])
    dq = lambda d: db.one("select count(*) from tally_check_days where book_id = %s and day = %s and source = 'held'" % (q(B), q(d)))
    res(apply([L("q-new", "altered", 840, None, d="20261015", no="811", typ="Journal", guid="", why=NOSAVE % 840)]))
    ok(dq("2026-10-15") == "1" and dq("2026-10-12") == "1", "5. every GUID-less entry line's date queued for 136's day check (FinComDayHeads of that day, then the entries FinCom lacks, by GUID), whatever its words (%s %s)" % (dq("2026-10-15"), dq("2026-10-12")))
    r = res(apply([L("nn-nomid", "created", 0, None, d="20261014", no="902", typ="Journal", guid="", why="not found by its type and number: Reading entries from Tally is off on this computer (FinCom reads entries only as they change; history comes from the Day Book upload).")]))
    ok(r[0][0] == "fetching" and dq("2026-10-14") == "1", "5. no MasterID to search from: 'fetching', its date queued for the day check at once (%s)" % r)
    # the day check brings the new entry in (133: the entry FinCom lacked, by its GUID); the re-run settles the line
    res(apply([L("nn-day", "created", 870, 60870, d="20261014", no="902", typ="Journal", body=("902", "2026-10-14"))]))
    for alt in (90001, 90002, 90003, 90004):
        db.sql("update tally_sync_cursor set gap = jsonb_build_object('tally_altvchid', %d, 'missing', 1), gap_at = now() where book_id = %s" % (alt, q(B)))
        for k in range(12):
            unpace(); n += len([x for x in (take() or []) if x["line_id"].startswith("mn.")])
    ok(n == 15 and probe("mn") == {"round": "3", "handed": "15"}, "5. a new AlterID opens the next round: 15 asks in all, never more (%s %s)" % (n, probe("mn")))

    print("== 6. deletes")
    r = res(apply([L("x-none", "deleted", 940, None, d="20261008", no="77", guid="")]))
    ok(r[0][0] == "applied" and "nothing to delete" in r[0][1], "6. no GUID, nothing in the copy can be it: applied (%s)" % r)
    r = res(apply([L("x-live", "deleted", 910, None, d="20261004", no="", guid="")]))
    ok(r[0][0] == "fetching" and vrow(910)["deleted"] == "false", "6. no GUID, could be a live entry: 'fetching', still live (%s)" % r)
    r = res(apply([L("x-guid-unk", "deleted", 950, 60500)]))
    ok(r[0][0] == "applied" and vrow(950) is None, "6. a GUID the copy does not hold: applied, nothing removed (%s)" % r)
    r = res(apply([L("x-guid", "deleted", 930, 60310)]))
    ok(r[0][0] == "applied" and vrow(930)["deleted"] == "true", "6. a GUID the copy holds: deleted (%s)" % r)

    print("== 7. a FinCom id naming no posting")
    r = res(apply([L("f-body", "altered", 960, 60600, no="12", body=("12", "2026-10-03"), fid="nopost1")]))
    ok(r[0][0] == "applied" and vrow(960) and vrow(960)["vno"] == "12", "7. with Tally's body: applied as a plain entry (%s)" % r)
    r = res(apply([L("f-nobody", "altered", 961, 60601, no="13", fid="nopost2", narration="TDSDesk:nopost2")]))
    ok(r[0][0] == "fetching" and "applied as a plain" not in r[0][1] and "matches no posting" not in r[0][1], "7. without the body: 'fetching' (asked by its GUID as a plain entry), never 'held' (%s)" % r)

    print("== 8. a filed (locked) month")
    db.sql("insert into tally_month_locks (firm_id, client_id, book_id, month) values (%s, 'c1', %s, '2026-09-01')" % (q(F), q(B)))
    r = res(apply([L("k-1", "created", 970, 60700, d="20260915", no="55", body=("55", "2026-09-15"))]))
    al = db.rows("select words from tally_alerts where book_id = %s and data->>'what' = 'filed_month'" % q(B))
    ok(r[0][0] == "applied" and vrow(970) and [a["words"] for a in al] == ["Entry changed in Tally in a filed month: Sales 55 15-Sep-2026"], "8. applied anyway, one alert (%s %s)" % (r, al))
    ok(db.one("select tally_month_locked(%s, array['2026-09-15'::date])::text" % q(B)) == "2026-09-01", "8. the lock itself unchanged for everyone else")

    print("== 9. Tally busy, ledger lines")
    r = res(apply([L("b-busy", "created", 0, None, d="20261013", no="991", guid="", why="waiting: Tally took longer than 2 s; FinCom asks again at 13:20")]))
    ok(r[0][0] == "fetching", "9. Tally busy: 'fetching' (%s)" % r)
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, tally_guid, alter_id) values (%s, %s, 'Party C', 'Sundry Debtors', %s, 950)" % (q(B), q(F), q(CG + "-00000bbb")))
    r = res(apply([dict(L("g-name", "ledger_created", 0, None, guid=""), name="Party C", vch_type="", vch_no="", vch_date="")]))
    ok(r[0][0] == "duplicate", "9. ledger without a GUID, in the list: 'duplicate' (%s)" % r)
    r = res(apply([dict(L("g-guid", "ledger_altered", 0, 940, guid=CG + "-00000bbb"), name="Party C", master_id="2987", vch_type="", vch_no="", vch_date="")]))
    ok(r[0][0] == "stale", "9. ledger by GUID, the list above it: 'stale' (%s)" % r)
    r = res(apply([dict(L("g-del", "ledger_deleted", 0, 990, guid=CG + "-00000ccc"), name="Party Gone", master_id="3276", vch_type="", vch_no="", vch_date="")]))
    ok(r[0][0] == "applied", "9. a delete of a ledger not in the list: applied, nothing marked (%s)" % r)

    print("== 10. the re-run")
    a = rerun()
    st = {k: line(k)["state"] for k in ("p-pre", "p-nb", "p-del", "p-busy", "p-led")}
    ok(line("nn-nomid")["state"] in ("duplicate", "replaced"), "10. the line found by the day check's entry: settled (%s)" % (line("nn-nomid"),))
    ok(isinstance(a, dict) and a.get("ok") is True and st == {"p-pre": "duplicate", "p-nb": "applied", "p-del": "applied", "p-busy": "fetching", "p-led": "duplicate"}, "10. the old held lines settled or fetching (%s %s)" % (st, json.dumps(a)[:300]))
    ok(vrow(603)["vno"] == "283" and vrow(604)["vno"] == "284" and vrow(700) and vrow(700)["vno"] == "70" and nrows(700) == 1, "10. 283 / 284 untouched; Tally's 70 applied once")
    ok(db.one("select count(*) from tally_recorder_lines where state = 'held'") == "0", "10. no line 'held' anywhere (%s)" % db.one("select string_agg(line_id, ',') from tally_recorder_lines where state = 'held'"))
    s1 = snapshot(); b2 = rerun(); s2 = snapshot()
    ok(isinstance(b2, dict) and b2.get("settled") == 0 and s1 == s2, "10. run again: nothing changes (%s)" % json.dumps(b2)[:200])
    busy = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-c",
                             "begin; select pg_advisory_xact_lock(hashtext(%s)); select pg_sleep(4); commit;" % q(B)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5); c = rerun(); busy.wait()
    ok(isinstance(c, dict) and c.get("busy") is True and c.get("rerun") == 0, "10. another session holds the book: nothing done (%s)" % json.dumps(c)[:200])
    hs = json.loads((db.rows("select tally_held_status(null)::text as x", OWNER) or [{"x": "{}"}])[0]["x"])
    nf = int(db.one("select count(*) from tally_recorder_lines where book_id = %s and state = 'fetching'" % q(B)))
    ok(nf > 0 and any(0 < (bk.get("fetching") or 0) <= nf for bk in hs.get("books", [])), "10. tally_held_status says how many of the %d are being fetched with a retry scheduled (%s)" % (nf, json.dumps(hs)[:200]))
    def hsn():
        x = json.loads((db.rows("select tally_held_status(null)::text as x", OWNER) or [{"x": "{}"}])[0]["x"])
        return sum((bk.get("fetching") or 0) for bk in x.get("books", []))

    print("== 11. every line being fetched has an end")
    dq = lambda d: db.one("select count(*) from tally_check_days where book_id = %s and day = %s and source = 'held'" % (q(B), q(d)))
    ok(dq("2026-10-13") == "1", "11. a GUID-less line held for 'Tally busy' (no MasterID): its date queued for the day check whatever its words")
    res(apply([L("c-busy", "altered", 850, None, d="20261016", no="851", typ="Journal", guid="", why="waiting: Tally busy; FinCom asks again at 14:10")]))
    got = []
    for k in range(10):
        unpace(); got += [x["line_id"] for x in (take() or []) if x["line_id"].startswith("c-busy.")]
    ok(got[:1] == ["c-busy.p1c1"], "11. a line with a MasterID gets the candidate search whatever its words (%s)" % got[:3])
    res(apply([L("c-res:resolved", "created", 860, None, d="20261017", no="861", typ="Journal", guid="", why="Tally did not give this entry when asked again; upload that day's Day Book to settle it")]))
    got = []
    for k in range(12):
        unpace(); got += [x["line_id"] for x in (take() or []) if x["line_id"].startswith("c-res:resolved.")]
    ok(got[:1] == ["c-res:resolved.p1c1"], "11. a ':resolved' row too (%s)" % got[:2])
    r = res(apply([answer("c-res:resolved.p1c1", 861, "861", "2026-10-17")]))
    ok(r[0][0] == "applied" and line("c-res:resolved")["state"] == "replaced", "11. its match applied, the ':resolved' row replaced (%s %s)" % (r, line("c-res:resolved")["state"]))
    # the day check of 20-Oct runs cleanly after these lines came: the copy is Tally's for that day
    res(apply([L("dc-none", "created", 0, None, d="20261020", no="950", typ="Journal", guid="", why="waiting: Tally busy; FinCom asks again at 14:20"),
               L("dc-nonum", "created", 0, None, d="20261020", no="", typ="Journal", guid="", why="the line has no MasterID and the entry no voucher number, so Tally cannot be asked for it"),
               L("dc-guid", "altered", 980, 60980, d="20261020", no="981", typ="Journal", why="Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it")]))
    ok(dq("2026-10-20") == "1" and all(line(k)["state"] == "fetching" for k in ("dc-none", "dc-nonum", "dc-guid")), "11. three lines of 20-Oct being fetched, the day queued")
    sq("update tally_check_days set via = 'day', lists = 1, tally_n = 0, listed_at = now() + interval '1 second', done_at = now() + interval '1 second', same = true where book_id = %s and day = '2026-10-20'" % q(B))
    rerun(1000)
    sts = {k: line(k) for k in ("dc-none", "dc-nonum", "dc-guid")}
    ok(sts["dc-none"]["state"] == "stale" and sts["dc-none"]["why"].startswith("No such entry in Tally for 20-Oct-2026 (checked "), "11. no such entry after the day check: 'stale', in plain words (%s)" % (sts["dc-none"],))
    ok(sts["dc-guid"]["state"] == "stale" and sts["dc-guid"]["why"].startswith("No such entry in Tally for 20-Oct-2026"), "11. a GUID the day check did not bring: 'stale' (%s)" % (sts["dc-guid"],))
    ok(sts["dc-nonum"]["state"] == "stale" and "named no voucher number" in sts["dc-nonum"]["why"], "11. a line with no number: 'stale' once the day is Tally's (%s)" % (sts["dc-nonum"],))
    # the ceiling: no date (nothing to check), 7 days on
    res(apply([L("ce-old", "created", 0, None, d="", no="", typ="", guid="", why="waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run)")]))
    c0 = hsn()
    ok(line("ce-old")["state"] == "fetching" and c0 == hsn(), "11. a line with nothing to ask by: fetching, and not counted as being brought (%s)" % c0)
    rerun(1000)
    ok(line("ce-old")["state"] == "fetching", "11. an old line's first tries do not close it (the ceiling counts 7 days of tries)")
    sq("update tally_recorder_tries set first_at = now() - interval '8 days' where line_row = (select id from tally_recorder_lines where book_id = %s and line_id = 'ce-old')" % q(B))
    rerun(1000)
    ok(line("ce-old")["state"] == "stale" and "could not bring this from Tally in 7 days" in line("ce-old")["why"], "11. 7 days on: 'stale', in plain words (%s)" % (line("ce-old"),))
    c0 = hsn()
    res(apply([L("hs-new", "altered", 0, None, d="20261021", no="990", typ="Journal", guid="", why="waiting: Tally busy")]))
    ok(hsn() == c0 + 1, "11. a line with its day check queued is counted as being brought (%s -> %s)" % (c0, hsn()))

    print("== 12. ledger lines brought to an end")
    def asks(idle=True): return j("select tally_recorder_ledger_asks(%s, %s, %s, %s)::text" % (q(F), q(D1), q(BR), "true" if idle else "false"))
    r = res(apply([dict(L("lg-new", "ledger_created", 0, None, guid=""), name="Party New", vch_type="", vch_no="", vch_date="")]))
    a1 = asks()
    ok(r[0][0] == "fetching" and isinstance(a1, dict) and {"company": CO, "company_guid": CG, "name": "Party New"} in a1.get("names", []) and a1.get("full") == [], "12. its name asked of Tally (FinComLedgerByName); no full list yet (%s %s)" % (r, json.dumps(a1)[:200]))
    ok(asks(False) == {"names": [], "full": []}, "12. nothing while typing")
    sq("update tally_recorder_lines set received_at = now() - interval '2 hours' where book_id = %s and line_id = 'lg-new'" % q(B))
    a2 = asks(); a3 = asks()
    ok(isinstance(a2, dict) and a2.get("full") == [CO] and isinstance(a3, dict) and a3.get("full") == [], "12. an hour on with no whole list since: the full list asked once, not again within 30 minutes (%s %s)" % (a2.get("full") if isinstance(a2, dict) else a2, a3.get("full") if isinstance(a3, dict) else a3))
    sq("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, company_guid, company, line_id, event, object_guid, master_id, alter_id, state, held_why, body, received_at)
              values (%(F)s, 'c1', %(B)s, %(D)s, %(BR)s, 'PC-1', %(CG)s, %(CO)s, 'lg-del', 'ledger_deleted', %(G)s, '3003', 991, 'fetching', 'kept by the guard: it has entries', '{"name": "Party C"}', now() - interval '2 hours'),
                     (%(F)s, 'c1', %(B)s, %(D)s, %(BR)s, 'PC-1', %(CG)s, %(CO)s, 'lg-ren', 'ledger_renamed', null, '', null, 'fetching', 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it', '{"from": "Party Old", "to": "Party C"}', now() - interval '2 hours')"""
           % {"F": q(F), "B": q(B), "D": q(D1), "BR": q(BR), "CG": q(CG), "CO": q(CO), "G": q(CG + "-00000bbb")})
    sq("update tally_books set ledgers_at = now() where book_id = %s" % q(B))
    rerun(1000)
    ok(line("lg-del")["state"] == "stale" and line("lg-del")["why"].startswith("Tally kept the ledger"), "12. a delete the guard kept: 'stale', Tally kept the ledger (%s)" % (line("lg-del"),))
    ok(line("lg-ren")["state"] == "duplicate" and "Party C" in line("lg-ren")["why"], "12. a rename / merge: settled to the list's name (%s)" % (line("lg-ren"),))
    ok(line("lg-new")["state"] == "stale" and "has no such ledger (Party New)" in line("lg-new")["why"], "12. a ledger that never appeared after the whole list: 'stale' (%s)" % (line("lg-new"),))

    print("== 13. FinCom id lines; the re-run's rotation")
    r = res(apply([L("sb", "created", 990, 60990, no="15", body=("15", "2026-10-03"), fid="nopost3", short="true")]))
    ok(r[0][0] == "fetching" and vrow(990) is None, "13. a body FinCom built from its posting's XML, no such posting: never applied as Tally's; 'fetching' (Tally's asked by GUID) (%s)" % r)
    JOB = "abababab-0000-4000-8000-000000000196"
    sq("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', %s, '{}'::jsonb, 1, 'waiting')" % (q(JOB), q(F), q(CO)))
    sq("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id) values (%s, 'c1', 'early1', %s, 'early1')" % (q(F), q(JOB)))
    r = res(apply([L("sp", "created", 991, 60991, no="16", fid="early1")]))
    ok(r[0][0] == "fetching" and "FinCom id early1 matches no posting of this firm" in r[0][1], "13. a posting not accepted yet: the line waits for it, fetching (%s)" % r)
    sq("update tally_post_ids set accepted_at = now() where fincom_id = 'early1'")
    sh = j("select tally_recorder_short_held(%s, %s)::text" % (q(F), q(JOB)))
    ok(isinstance(sh, dict) and [x.get("line", {}).get("line_id") for x in sh.get("lines", [])] == ["sp"], "13. on its acceptance the early-posting retry finds it by state and FinCom id (%s)" % json.dumps(sh)[:200])
    nf0 = int(db.one("select count(*) from tally_recorder_lines where book_id = %s and state = 'fetching'" % q(B)))
    seen = set()
    for k in range(3):
        rerun(1)
        try: seen.add(db.one("select line_row::text from tally_recorder_tries where book_id = %s order by tried_at desc limit 1" % q(B)))
        except RuntimeError:
            if not RED: raise
    ok(nf0 >= 3 and len(seen) == 3, "13. three re-runs of one line each try three different lines (the least recently tried first) (%s of %s)" % (len(seen), nf0))

    print("== 14. the candidate search takes the book's lock")
    res(apply([L("lk", "altered", 870, None, d="20261022", no="871", typ="Journal", guid="", why=NOSAVE % 870)]))
    unpace()
    busy = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-q", "-c",
                             "begin; select pg_advisory_xact_lock(hashtext(%s)); select pg_sleep(4); commit;" % q(B)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5); tk = take(); busy.wait()
    ok(tk == [], "14. the book held by another session: nothing handed (%s)" % (json.dumps(tk)[:120],))
    unpace(); tk = take()
    ok(isinstance(tk, list) and len(tk) > 0, "14. free again: handed")

    print("== 15. the daily sweep, an error that keeps coming, the count")
    B2 = "f79e4bc3-871d-4482-874d-000000002196"
    sq("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c2', 'MADE UP CLOSED', '2025-04-01', '2025-03-31')" % (q(B2), q(F)))
    def raw(book, lid, ev, days, master="", vdate="null", why="waiting: Tally busy"):
        sq("""insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, company_guid, company, line_id, event, master_id, vch_type, vch_no, vch_date, state, held_why, received_at)
              values (%s, 'c2', %s, %s, %s, 'PC-1', %s, 'MADE UP CLOSED', %s, %s, %s, 'Journal', '', %s, 'fetching', %s, now() - interval '%d days')"""
           % (q(F), q(book), q(D1), q(BR), q(CG), q(lid), q(ev), q(master), vdate, q(why), days))
    def ln(book, lid): return (db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %s and line_id = %s" % (q(book), q(lid))) or [{"state": None, "why": ""}])[0]
    raw(B2, "sw-15", "created", 15); raw(B2, "sw-10", "created", 10)
    sw = j("select tally_recorder_fetching_sweep(2000)::text")
    ok(isinstance(sw, dict) and ln(B2, "sw-15")["state"] == "stale" and "could not bring this from Tally in 7 days" in ln(B2, "sw-15")["why"] and ln(B2, "sw-10")["state"] == "fetching",
       "15. the daily sweep, a book no beat reports: a line 15 days old never tried closed 'stale'; one 10 days old not yet (%s %s %s)" % (json.dumps(sw)[:120], ln(B2, "sw-15"), ln(B2, "sw-10")))
    sq("update tally_recorder_tries set first_at = now() - interval '8 days' where line_row = (select id from tally_recorder_lines where book_id = %s and line_id = 'sw-10')" % q(B2))
    j("select tally_recorder_fetching_sweep(2000)::text")
    ok(ln(B2, "sw-10")["state"] == "stale", "15. the sweep: a line whose first try is over 7 days old closed (%s)" % (ln(B2, "sw-10"),))
    raw(B, "er-1", "bogus", 1)
    e1 = rerun(1000)
    ok(ln(B, "er-1")["state"] == "fetching" and isinstance(e1, dict) and any(x.get("line_id") == "er-1" for x in e1.get("errors", [])), "15. a run that raises: rolled back, still fetching, the error in the answer for Sentry (%s)" % json.dumps((e1 or {}).get("errors") if isinstance(e1, dict) else e1)[:200])
    sq("update tally_recorder_tries set first_at = now() - interval '8 days' where line_row = (select id from tally_recorder_lines where book_id = %s and line_id = 'er-1')" % q(B))
    rerun(1000)
    ok(ln(B, "er-1")["state"] == "stale" and ln(B, "er-1")["why"].startswith("Could not be brought in (error)"), "15. raising for 7 days of tries: 'stale', Could not be brought in (error) (%s)" % (ln(B, "er-1"),))
    c1 = hsn()
    raw(B, "ex-1:resolved", "created", 1, master="777")
    ok(hsn() == c1, "15. an exhausted ':resolved' row (nothing left to ask it by) is not counted as being brought (%s -> %s)" % (c1, hsn()))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
