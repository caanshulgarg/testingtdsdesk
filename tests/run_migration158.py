"""python3 run_migration158.py - migration-158-held-delete-fast (11-Nov-2026, branch next-fast-delete). Staging, 11-Nov-2026:
Payment 481 created in Tally, altered, then deleted; the delete line came without the entry's GUID (held), the day check
removed the entry only on a second whole-day list 3.5 minutes later, and the recorder's gap (Tally's ALTVCHID 42868 ->
42872, the copy's highest AlterID 42869, the deleted entry's) stayed open though Tally's list of the day matched FinCom.
On a throwaway PostgreSQL (pg_stand, port 31158 unless PG158_PORT; never a real database), built as run_migration136.py
builds it, then 135, 136, 137, 150 and 158 (twice). Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the one table change is the
     new table's row security; the one function replaced is 150's tally_recorder_gap_asked), names no real database; the new
     table's own grants (service_role only); the functions for service_role only (the trigger's for nobody); runs twice.
  1. tally_held_front: the day of a held GUID-less delete from THIS computer's bridge, being checked, comes first; not again
     within 3 minutes; never for another bridge; 135's own list still hands it out.
  2. tally_held_delete_by_heads: the delete applied on the FIRST whole-day list when the line's MasterID, number and type
     name exactly one live entry whose GUID Tally makes from that MasterID and the list has neither: the entry deleted
     (133's log 'check' / 'deleted'), the line 'applied' with plain words; 133's check then done at once, the day not asked
     again. Never: while the list still has the entry (by GUID or by MasterID), on an empty list, with two live entries of
     that number and type, for an entry whose GUID is not the MasterID's (imported), for another company's line, a day not
     being checked.
  3. the gap (the staging sequence): create (applied), alter, delete without GUID (settled), the day checked and matched
     BEFORE the gap was first seen -> the gap opens, its day is queued again by itself (source 'gap'); Tally lists it, it
     matches -> the next gap check closes the gap (a match at Tally's number). Stays open: Tally's number moved since the
     list; a line of the book still held; no delete since the gap began.
RED_WITHOUT_158=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, datetime
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
AFTER = [os.path.join(SQLDIR, f) for f in ("migration-135-check-changes.sql", "migration-136-held-settle.sql", "migration-137-held-status-online.sql", "migration-150-gap-closed-by-days.sql")]
M = os.environ.get("M158_FILE") or os.path.join(SQLDIR, "migration-158-held-delete-fast.sql")
RED = os.environ.get("RED_WITHOUT_158") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999158"
B, B3 = "819d4a59-4cee-4bf7-8f8c-000000000158", "819d4a59-4cee-4bf7-8f8c-000000003158"
DV = "dddddddd-0000-4000-8000-000000000158"
BR, BR2 = "go-aaaaaa158158", "go-bbbbbb158158"
CG, CG3 = "7c5fd9b3-7235-4cbb-b4cd-1124be599158", "b20abc61-0000-4000-8000-79149af7c158"
G = lambda mid, cg=CG: cg + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()      # n days ago (India's)
D8 = lambda n: (TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
NEW_FNS = ["tally_held_delete_by_heads", "tally_held_front", "tally_sync_cursor_gap_seen"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_gap_numbers enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_gap_numbers"], "0. one new table")
    ok("grant select, insert, update, delete on public.tally_gap_numbers to service_role;" in text, "0. its own explicit grants (service_role)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(NEW_FNS + ["tally_recorder_gap_asked"]), "0. the functions (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG158_PORT") or 31158))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def V(guid, alter, d, typ="Payment", no="1"):
    return {"guid": guid, "alter": alter, "type": typ, "no": no, "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}
def LN(guid, amt=118.0): return [[guid, "Made-up Traders", -amt, "", None, []], [guid, "Cash", amt, "", None, []]]
def day(book, d, vouchers):
    lines = [x for v in vouchers for x in LN(v["guid"])]
    return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def H(guid, mid, alter, typ="Payment"): return [guid, mid, alter, typ]
NOG = lambda d: "no entry GUID on the line: FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date" % d
def line(lid, book=B, ev="deleted", n=0, mid=None, no="481", typ="Payment", cg=CG, bridge=BR, state="held", alter=None, guid=None, ago_sec=60, why=None):
    db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, vch_date, received_at, state, held_why, company_guid) "
           "values (%s, 'c1', %s, %s, %s, 'MADEUP-PC1', %s, %s, %s, %s, %s, %s, %s, %s, now() - interval '%d seconds', %s, %s, %s)"
           % (q(F), q(book), q(DV), q(bridge), q(lid), q(ev), q(guid) if guid else "null", q(mid) if mid else "null", alter if alter is not None else "null", q(typ), q(no), q(D(n)),
              ago_sec, q(state), q(why if why is not None else (NOG(D(n)) if state == "held" else "")), q(cg)))
def L(lid): return (db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where line_id = %s order by id desc limit 1" % q(lid)) or [{}])[0]
def cday(book, n): return (db.rows("select source, (done_at is not null) as done, (upload_at is not null) as up, lists, asked_at from tally_check_days where book_id = %s and day = %s" % (q(book), q(D(n)))) or [{}])[0]
is_open = lambda book, n: cday(book, n).get("done") == "f" and cday(book, n).get("up") == "f"
live = lambda book, guid: db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(book), q(guid))) == "1"
BYH = lambda n, hs, book=B: j("select tally_held_delete_by_heads(%s, %s, %s)::text" % (q(book), q(D(n)), js(hs)))
FRONT = lambda bridge=BR, mx=3, book=B: (lambda r: r if isinstance(r, list) else [{"_error": r}])(j("select tally_held_front(%s, %s, %s, %d)::text" % (q(book), q(DV), q(bridge), mx)))
HEADS = lambda n, hs, book=B: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(n)), js(hs)))
def gap(alt, book=B3):
    r = j("select tally_recorder_gap_check(%s, %s, %d, now())::text" % (q(book), q(DV), alt))
    c = db.rows("select gap is null as closed, match_alter, gap::text as gap from tally_sync_cursor where book_id = %s" % q(book))[0]
    return r, c
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'MADE UP CO', '2026-04-01', '2026-03-31'), (%(B3)s, %(F)s, 'c3', 'THIRD MADE UP', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'MADE UP CO', '{"choices": {}}'), ('c3', %(F)s, 'THIRD MADE UP', '{"choices": {}}');"""
           % {"F": q(F), "B": q(B), "B3": q(B3)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh158', '{}'::jsonb, true, now()) on conflict do nothing;""" % (q(DV), q(F)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "158 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    if text:
        ok(db.one("select has_table_privilege('authenticated', 'public.tally_gap_numbers', 'select') or has_table_privilege('anon', 'public.tally_gap_numbers', 'select')") in ("f", "false"), "0. tally_gap_numbers: nothing for anon or authenticated")
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_gap_numbers'::regclass") in ("t", "true"), "0. tally_gap_numbers: row security on")
        sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in NEW_FNS + ["tally_recorder_gap_asked"]))}
        ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true")
        for fn in ("tally_held_delete_by_heads", "tally_held_front", "tally_recorder_gap_asked"):
            ok(ex("service_role", fn) and not ex("authenticated", fn) and not ex("anon", fn), "0. %s: service_role only" % fn)
        ok(not ex("service_role", "tally_sync_cursor_gap_seen") and not ex("authenticated", "tally_sync_cursor_gap_seen") and not ex("anon", "tally_sync_cursor_gap_seen"), "0. the trigger's function: nobody")

    # the made-up book B: its company GUID recorded; day 0 (today) holds Payment 481 (MasterID 26524), Receipt 7 and,
    # day 1, Payment 481 twice (two of that number: never matched); day 2, an imported Payment 900 (another GUID)
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, 40000, now() - interval '5 days', %s)" % (q(B), q(F), q(CG)))
    day(B, D(0), [V(G(26524), 42869, D(0), "Payment", "481"), V(G(26500), 42800, D(0), "Receipt", "7")])
    day(B, D(1), [V(G(26400), 42700, D(1), "Payment", "481"), V(G(26401), 42701, D(1), "Payment", "481")])
    day(B, D(2), [V("0aaa0000-0000-4000-8000-imported0001-00000011", 42600, D(2), "Payment", "900")])
    db.sql("update tally_days set at = now() - interval '1 hour' where book_id = %s" % q(B))

    print("== 1. tally_held_front: the held delete's day first")
    line("del-481", mid="26524", no="481")
    ok(is_open(B, 0) and cday(B, 0).get("source") == "held", "1. (136) the held line queued its day (%s)" % cday(B, 0))
    other = FRONT(BR2)
    ok(other == [], "1. another bridge: none (%s)" % other)
    fr = FRONT()
    ok(isinstance(fr, list) and [x.get("day") for x in fr] == [D8(0)] and fr[0].get("check") is True and fr[0].get("fetch") is True and fr[0].get("chosenAt"), "1. this bridge: the day, a check day with its choice time (%s)" % fr)
    ok(FRONT() == [], "1. not again within 3 minutes")
    db.sql("update tally_check_days set asked_at = now() - interval '4 minutes' where book_id = %s and day = %s" % (q(B), q(D(0))))
    ok([x.get("day") for x in (FRONT() or [])] == [D8(0)], "1. after 3 minutes: again")
    nx = j("select tally_check_next_open(%s, 10)::text" % q(B))
    ok(isinstance(nx, list) and D8(0) in [x.get("day") for x in nx], "1. 135's own list still hands it out (%s)" % nx)

    print("== 2. the delete applied on the first whole-day list")
    r = BYH(0, [H(G(26524), 26524, 42869), H(G(26500), 26500, 42800, "Receipt")])
    ok(r.get("removed") == 0 and live(B, G(26524)) and L("del-481").get("state") == "held", "2. the list still has the entry: nothing (%s)" % r)
    r = BYH(0, [H(G(77777), 26524, 42872), H(G(26500), 26500, 42800, "Receipt")])
    ok(r.get("removed") == 0 and live(B, G(26524)), "2. the list has its MasterID under another GUID: nothing (%s)" % r)
    r = BYH(0, [])
    ok(r.get("removed") == 0 and live(B, G(26524)), "2. an empty list: nothing (%s)" % r)
    line("del-x", mid="26524", no="481", cg="ffffffff-0000-4000-8000-000000000000")
    r = BYH(5, [H(G(26500), 26500, 42800, "Receipt")])
    ok(r.get("mine") is False and r.get("removed") == 0, "2. a day not being checked: nothing (%s)" % r)
    LIST0 = [H(G(26500), 26500, 42800, "Receipt")]
    r = BYH(0, LIST0)
    ok(r.get("removed") == 1 and not live(B, G(26524)) and live(B, G(26500)), "2. the list lacks it: the entry deleted on this first list (%s)" % r)
    l = L("del-481")
    ok(l.get("state") == "applied" and "deleted in Tally" in l.get("why", "") and "MasterID 26524" in l.get("why", ""), "2. the line applied, in plain words (%s)" % l)
    ok(L("del-x").get("state") == "held", "2. another company's line (the same MasterID): never (%s)" % L("del-x"))
    ok(db.one("select count(*) from tally_fetch_log where book_id = %s and via = 'check' and what = 'deleted' and guid = %s" % (q(B), q(G(26524)))) == "1", "2. logged as the check's delete")
    db.sql("update tally_recorder_lines set state = 'stale' where line_id = 'del-x'")
    h = HEADS(0, LIST0)
    ok(h.get("done") is True and not is_open(B, 0), "2. 133's check of the day then done at once, not asked again (%s, %s)" % (h, cday(B, 0)))
    # two live entries of that number and type: never
    line("del-2x", n=1, mid="26400", no="481")
    ok(is_open(B, 1), "2. (two of that number) the day queued")
    r = BYH(1, [H(G(26401), 26401, 42701)])
    ok(r.get("removed") == 0 and live(B, G(26400)) and L("del-2x").get("state") == "held", "2. two live entries of that number and type: nothing (%s)" % r)
    r = BYH(1, [H(G(1), 1, 1, "Journal")])
    ok(r.get("removed") == 0 and live(B, G(26400)) and live(B, G(26401)), "2. ... even when the list has neither (%s)" % r)
    # an imported entry (its GUID is not the one Tally makes from the MasterID): never
    line("del-imp", n=2, mid="17", no="900")
    r = BYH(2, [H(G(1), 1, 1, "Journal")])
    ok(r.get("removed") == 0 and live(B, "0aaa0000-0000-4000-8000-imported0001-00000011"), "2. an entry whose GUID is not the MasterID's: nothing (%s)" % r)

    print("== 3. the gap: create, alter, delete without GUID, the day checked -> closed")
    # the staging sequence on book B3: start point 42868, Payment 481 created (42869, applied), altered and deleted in Tally
    # (Tally's ALTVCHID 42872); the delete line without GUID settled by the check, the check done before the gap was seen
    db.sql("""insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid, recorder_max_alter, recorder_last_at, last_match_at, match_at, match_alter, match_start)
              values (%(B)s, %(F)s, 42868, now() - interval '4 days', %(CG)s, 42869, now() - interval '12 minutes', now() - interval '10 minutes', now() - interval '10 minutes', 42869, null);
              update tally_sync_cursor set match_start = start_at where book_id = %(B)s""" % {"B": q(B3), "F": q(F), "CG": q(CG3)})
    day(B3, D(0), [V(G(26523, CG3), 42868, D(0), "Receipt", "480"), V(G(26524, CG3), 42869, D(0), "Payment", "481")])
    line("g-create", book=B3, ev="created", mid="26524", guid=G(26524, CG3), alter=42869, state="applied", cg=CG3, ago_sec=11 * 60)
    db.sql("select tally_ingest_delete(%s, %s, null, false, 'upload check: deleted in Tally')" % (q(B3), q(G(26524, CG3))))
    line("g-delete", book=B3, ev="deleted", mid="26524", state="applied", cg=CG3, ago_sec=8 * 60, why="nothing left to do: checked against Tally")
    db.sql("""insert into tally_check_runs (book_id, firm_id) values (%(B)s, %(F)s) on conflict do nothing;
      insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
      values (%(B)s, %(F)s, %(d)s, 'held', now() - interval '8 minutes', 3, 1, %(h)s, 'day', now() - interval '6 minutes', false, now() - interval '6 minutes')"""
           % {"B": q(B3), "F": q(F), "d": q(D(0)), "h": js([H(G(26523, CG3), 26523, 42868, "Receipt")])})
    r, c = gap(42872)
    ok(c["closed"] == "f" and r.get("missing") == 3, "3. Tally's number 42872 first seen: the gap opens, 3 missing (%s)" % r.get("missing"))
    ok(is_open(B3, 0) and cday(B3, 0).get("source") == "gap", "3. its day (checked before the number was seen) queued again by itself (%s)" % cday(B3, 0))
    r, c = gap(42872)
    ok(c["closed"] == "f", "3. the day not listed again yet: open")
    h = HEADS(0, [H(G(26523, CG3), 26523, 42868, "Receipt")], book=B3)
    ok(h.get("done") is True, "3. Tally lists the day, it matches FinCom (%s)" % h)
    line("g-held", book=B3, ev="altered", mid="26523", guid=G(26523, CG3), alter=42870, state="held", cg=CG3, ago_sec=5, why="waiting for the ledger 'X' from Tally")
    r, c = gap(42872)
    ok(c["closed"] == "f", "3. a line of the book still held since the gap began: open")
    db.sql("update tally_recorder_lines set state = 'duplicate' where line_id = 'g-held'")
    db.sql("update tally_recorder_lines set received_at = now() - interval '2 hours' where line_id = 'g-delete'")
    r, c = gap(42872)
    ok(c["closed"] == "f", "3. no delete since the gap began (the copy's highest below Tally's, nothing explains it): open")
    db.sql("update tally_recorder_lines set received_at = now() - interval '8 minutes' where line_id = 'g-delete'")
    r, c = gap(42872)
    ok(c["closed"] == "t" and r.get("matched") is True and c["match_alter"] == "42872", "3. the next gap check: closed as a match at Tally's number (%s / %s)" % (r, c))
    r, c = gap(42872)
    ok(c["closed"] == "t", "3. and stays closed")
    # Tally's number moved on after the list: open again, the day asked again; never closed by the earlier list
    r, c = gap(42874)
    ok(c["closed"] == "f" and r.get("missing") == 2, "3. Tally's number moved on (42874): open (%s)" % r.get("missing"))
    r, c = gap(42874)
    ok(c["closed"] == "f" and is_open(B3, 0) and cday(B3, 0).get("source") == "gap", "3. ... stays open, the day asked again (%s)" % cday(B3, 0))
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
