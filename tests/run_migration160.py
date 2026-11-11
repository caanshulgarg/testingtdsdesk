"""python3 run_migration160.py - migration-160-gap-read-close (11-Nov-2026, branch next-gap-autoread). Staging, 11-Nov-2026,
one book: Payment 481 created in Tally (its line came, AlterID 42869), altered (its line never came), deleted (the line
without the entry's GUID, settled by the day check); Tally's ALTVCHID 42872, FinCom's highest known 42869: "3 entries made
in Tally since 18:44 IST are not yet in FinCom. Upload the Day Book for 11-Nov" stayed, though Tally's Day Book of the day
matches FinCom (158 closes a gap only when settled deletes number as many as the missing changes: 1 < 3).
On a throwaway PostgreSQL (pg_stand, port 31160 unless PG160_PORT; never a real database), built as run_migration158.py
builds it, then 158 and 160 (twice). Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate; the one table change is the
     new table's row security; the one function replaced is 158's tally_recorder_gap_asked), names no real database; the
     new table's grants (service_role only); the functions for service_role only (the triggers' for nobody); runs twice.
  1. the staging sequence: the gap opens; the page's gap says checking (no action needed); Tally's Day Book of the day read
     (the check's whole-day list, after Tally's number was seen) matches FinCom -> the next gap check closes the gap (a match
     at Tally's number), recorded "checked against Tally at <time>" with the arithmetic (42870 to 42872: Payment 481's
     alterations and its deletion). No upload asked.
  2. a real missing entry: the same, but the read lists Payment 482 (42872) that FinCom lacks: the gap stays open while the
     check wants it; the read brings it in (tally_check_entries); then closed as a match, 482 in FinCom.
  3. never closed: FinCom's highest number is not the deleted entry's (a live journal of another day above it); a line of
     the book still held; the read before Tally's number was seen; Tally's number moved since.
  4. tally_gap_front (the beat asks the bridge itself): none in the gap's first 2 minutes; then the gap's days (newest
     first) as check days; not again within 15 minutes; after 15 minutes a day already read is read again; none while a
     line of the book is held, while a posting of the book's company waits, for a day given up (to upload), with the check
     stopped.
  5. the gap's words: checking true while FinCom can read the days itself; false once a day is given up (upload by hand).
RED_WITHOUT_160=1: the same checks without the file (they fail)."""
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
AFTER = [os.path.join(SQLDIR, f) for f in ("migration-135-check-changes.sql", "migration-136-held-settle.sql", "migration-137-held-status-online.sql", "migration-150-gap-closed-by-days.sql",
                                           "migration-158-held-delete-fast.sql")]
M = os.environ.get("M160_FILE") or os.path.join(SQLDIR, "migration-160-gap-read-close.sql")
RED = os.environ.get("RED_WITHOUT_160") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999160"
BK = {k: "819d4a59-4cee-4bf7-8f8c-00000000%d160" % k for k in range(1, 8)}
CG = {k: "b20abc61-0000-4000-8000-79149af7%d160" % k for k in range(1, 8)}
DV = "dddddddd-0000-4000-8000-000000000160"
BR = "go-aaaaaa160160"
G = lambda mid, cg: cg + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
NEW_FNS = ["tally_gap_read_explains", "tally_gap_front", "tally_sync_cursor_gap_checking", "tally_sync_cursor_gap_closed"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_gap_closes enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_gap_closes"], "0. one new table")
    ok("grant select, insert on public.tally_gap_closes to service_role;" in text, "0. its own explicit grants (service_role)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(NEW_FNS + ["tally_recorder_gap_asked"]), "0. the functions (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG160_PORT") or 31160))
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
def line(lid, book, ev="deleted", n=0, mid=None, no="481", typ="Payment", cg=None, state="held", alter=None, guid=None, ago_sec=60, why=""):
    db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, vch_date, received_at, state, held_why, company_guid) "
           "values (%s, 'c1', %s, %s, %s, 'MADEUP-PC1', %s, %s, %s, %s, %s, %s, %s, %s, now() - interval '%d seconds', %s, %s, %s)"
           % (q(F), q(book), q(DV), q(BR), q(lid), q(ev), q(guid) if guid else "null", q(mid) if mid else "null", alter if alter is not None else "null", q(typ), q(no), q(D(n)),
              ago_sec, q(state), q(why), q(cg)))
def cday(book, n): return (db.rows("select source, (done_at is not null) as done, (upload_at is not null) as up, lists, asked_at from tally_check_days where book_id = %s and day = %s" % (q(book), q(D(n)))) or [{}])[0]
live = lambda book, guid: db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(book), q(guid))) == "1"
HEADS = lambda book, n, hs: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(n)), js(hs)))
def gap(book, alt):
    r = j("select tally_recorder_gap_check(%s, %s, %d, now())::text" % (q(book), q(DV), alt))
    c = db.rows("select gap is null as closed, match_alter, gap::text as gap from tally_sync_cursor where book_id = %s" % q(book))[0]
    c["g"] = json.loads(c["gap"]) if c.get("gap") else None
    return r, c
FRONT = lambda book, mx=3: (lambda r: r if isinstance(r, list) else [{"_error": r}])(j("select tally_gap_front(%s, %d)::text" % (q(book), mx)))
closes = lambda book: db.rows("select altvchid, words from tally_gap_closes where book_id = %s order by id" % q(book)) if text else []
def age_gap(book, minutes):
    db.sql("update tally_sync_cursor set gap_at = now() - interval '%d minutes' where book_id = %s" % (minutes, q(book)))

# the staging sequence on a made-up book: start point 42868 (a Receipt of yesterday), Payment 481 (MasterID 26524) created
# today (42869, its line applied), altered (no line), deleted (the line without GUID, settled by 136's two lists); the day
# checked and matched BEFORE the gap was seen (as on staging). extra: a live journal of 5 days ago above 481's number
def gapbook(k, extra=False):
    book, cg = BK[k], CG[k]
    db.sql("""insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid, company_guid, recorder_max_alter, recorder_last_at, last_match_at, match_at, match_alter, match_start)
              values (%(B)s, %(F)s, 42868, now() - interval '4 days', %(CG)s, %(CG)s, 42869, now() - interval '12 minutes', now() - interval '13 minutes', now() - interval '13 minutes', 42869, null);
              update tally_sync_cursor set match_start = start_at where book_id = %(B)s""" % {"B": q(book), "F": q(F), "CG": q(cg)})
    day(book, D(1), [V(G(26523, cg), 42868, D(1), "Receipt", "480")])
    day(book, D(0), [V(G(26524, cg), 42869, D(0), "Payment", "481")])
    if extra: day(book, D(5), [V(G(26530, cg), 42870, D(5), "Journal", "J9")])
    line("c-%d" % k, book, ev="created", mid="26524", guid=G(26524, cg), alter=42869, state="applied", cg=cg, ago_sec=11 * 60)
    db.sql("select tally_ingest_delete(%s, %s, null, false, 'upload check: deleted in Tally')" % (q(book), q(G(26524, cg))))
    line("d-%d" % k, book, ev="deleted", mid="26524", state="applied", cg=cg, ago_sec=8 * 60, why="nothing left to do: checked against Tally")
    db.sql("""insert into tally_check_runs (book_id, firm_id) values (%(B)s, %(F)s) on conflict do nothing;
      insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at, removed)
      values (%(B)s, %(F)s, %(d)s, 'held', now() - interval '8 minutes', 2, 0, '[]'::jsonb, 'day', now() - interval '6 minutes', false, now() - interval '6 minutes', 1)"""
           % {"B": q(book), "F": q(F), "d": q(D(0))})
    return book, cg
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c%d', 'MADE UP %d', '2026-04-01', '2026-03-31');"
               "insert into clients (id, firm_id, name, data) values ('c%d', %s, 'MADE UP %d', '{\"choices\": {}}')" % (q(b), q(F), k, k, k, q(F), k))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh160', '{}'::jsonb, true, now()) on conflict do nothing;""" % (q(DV), q(F)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "160 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    if text:
        ok(db.one("select has_table_privilege('authenticated', 'public.tally_gap_closes', 'select') or has_table_privilege('anon', 'public.tally_gap_closes', 'select')") in ("f", "false"), "0. tally_gap_closes: nothing for anon or authenticated")
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_gap_closes'::regclass") in ("t", "true"), "0. tally_gap_closes: row security on")
        sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in NEW_FNS + ["tally_recorder_gap_asked"]))}
        ex = lambda rl, fn: fn in sig and db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true")
        for fn in ("tally_gap_read_explains", "tally_gap_front", "tally_recorder_gap_asked"):
            ok(ex("service_role", fn) and not ex("authenticated", fn) and not ex("anon", fn), "0. %s: service_role only" % fn)
        for fn in ("tally_sync_cursor_gap_checking", "tally_sync_cursor_gap_closed"):
            ok(fn in sig and not ex("service_role", fn) and not ex("authenticated", fn) and not ex("anon", fn), "0. the trigger's function %s: nobody" % fn)

    print("== 1. the staging sequence: the read of the day closes the gap, no upload")
    book, cg = gapbook(1)
    r, c = gap(book, 42872)
    ok(c["closed"] == "f" and r.get("missing") == 3, "1. Tally's number 42872 first seen: the gap opens, 3 missing (%s)" % r.get("missing"))
    ok(c["g"] and c["g"].get("checking") is True, "1. the gap says FinCom is checking with Tally (no action needed) (%s)" % (c["g"] or {}).get("checking"))
    ok(cday(book, 0).get("source") == "gap" and cday(book, 0).get("done") == "f", "1. (158) its day queued again for the read (%s)" % cday(book, 0))
    r, c = gap(book, 42872)
    ok(c["closed"] == "f", "1. the day not read again yet: open")
    h = HEADS(book, 0, [])
    ok(h.get("done") is True, "1. Tally's Day Book of the day read: it matches FinCom (481 gone, nothing else) (%s)" % h)
    r, c = gap(book, 42872)
    ok(c["closed"] == "t" and r.get("matched") is True and c["match_alter"] == "42872", "1. the next gap check: closed, a match at Tally's number (%s / %s)" % (r, c["match_alter"]))
    cl = closes(book)
    ok(len(cl) == 1 and cl[0]["altvchid"] == "42872" and cl[0]["words"].startswith("checked against Tally at ") and "42870" in cl[0]["words"] and "42872" in cl[0]["words"]
       and "Payment 481" in cl[0]["words"], "1. recorded as checked against Tally, the arithmetic said (%s)" % cl)
    ok(db.one("select count(*) from tally_check_days where book_id = %s and upload_at is not null" % q(book)) == "0", "1. no upload asked")
    r, c = gap(book, 42872)
    ok(c["closed"] == "t" and len(closes(book)) == 1, "1. stays closed, recorded once")

    print("== 2. a real missing entry is brought in by the read, not hidden")
    book, cg = gapbook(2)
    r, c = gap(book, 42872)
    ok(c["closed"] == "f", "2. the gap opens")
    h = HEADS(book, 0, [H(G(26525, cg), 26525, 42872)])
    ok(h.get("done") is False and h.get("want") == ["26525"], "2. the read lists Payment 482 that FinCom lacks: wanted (%s)" % h)
    r, c = gap(book, 42872)
    ok(c["closed"] == "f", "2. while wanted: open")
    e = j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(book), q(D(0)), js([V(G(26525, cg), 42872, D(0), "Payment", "482")]), js(LN(G(26525, cg)))))
    ok(e.get("done") is True and live(book, G(26525, cg)), "2. the read brings it in (%s)" % e)
    r, c = gap(book, 42872)
    ok(c["closed"] == "t" and c["match_alter"] == "42872" and live(book, G(26525, cg)), "2. then closed, 482 in FinCom (%s)" % r)

    print("== 3. never closed")
    book, cg = gapbook(3, extra=True)        # FinCom's highest is a live journal of 5 days ago (42870), not the deleted 481
    r, c = gap(book, 42872)
    HEADS(book, 0, [])
    r, c = gap(book, 42872)
    ok(c["closed"] == "f", "3. FinCom's highest number is a live entry of another day, not the deleted one: open")
    book, cg = gapbook(4)
    gap(book, 42872)
    HEADS(book, 0, [])
    line("h-4", book, ev="altered", mid="26523", guid=G(26523, cg), alter=None, state="held", cg=cg, ago_sec=5, why="waiting for the ledger 'X' from Tally")
    r, c = gap(book, 42872)
    ok(c["closed"] == "f", "3. a line of the book still held: open")
    db.sql("update tally_recorder_lines set state = 'duplicate' where line_id = 'h-4'")
    r, c = gap(book, 42873)
    ok(c["closed"] == "f", "3. Tally's number moved since the read: open")
    db.sql("update tally_check_days set via = 'day', done_at = now(), listed_at = now() - interval '1 hour' where book_id = %s and day = %s" % (q(book), q(D(0))))
    r, c = gap(book, 42873)
    ok(c["closed"] == "f", "3. a read from before Tally's number was seen: open")

    print("== 4. tally_gap_front: the beat asks the bridge to read the gap's days itself")
    book, cg = gapbook(5)
    db.sql("update tally_sync_cursor set last_match_at = now() - interval '1 day 13 minutes' where book_id = %s" % q(book))    # the gap from yesterday
    gap(book, 42872)
    db.sql("update tally_check_days set asked_at = now() - interval '20 minutes' where book_id = %s" % q(book))
    ok(FRONT(book) == [], "4. the gap's first 2 minutes: none")
    age_gap(book, 3)
    fr = FRONT(book)
    ok([x.get("day") for x in fr] == [D8(0), D8(1)] and all(x.get("check") is True and x.get("fetch") is True and x.get("chosenAt") for x in fr),
       "4. then the gap's days, newest first, as check days (%s)" % fr)
    ok(FRONT(book) == [], "4. not again within 15 minutes")
    HEADS(book, 0, []); HEADS(book, 1, [H(G(26523, cg), 26523, 42868, "Receipt")])
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    gap(book, 42873)     # (Tally's number moved: not closed; 158 queues again on its own)
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    HEADS(book, 0, []); HEADS(book, 1, [H(G(26523, cg), 26523, 42868, "Receipt")])
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    ok(cday(book, 0).get("done") == "t", "4. (the days read and done)")
    fr = FRONT(book)
    ok([x.get("day") for x in fr] == [D8(0), D8(1)] and cday(book, 0).get("done") == "f" and cday(book, 0).get("source") == "gap", "4. after 15 minutes, the gap still open: read again (%s, %s)" % (fr, cday(book, 0)))
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    line("h-5", book, ev="altered", mid="26523", state="held", cg=cg, ago_sec=5)
    ok(FRONT(book) == [], "4. a line of the book held: none")
    db.sql("update tally_recorder_lines set state = 'duplicate' where line_id = 'h-5'")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000000-0000-4000-8000-000000000160', %s, 'c5', 'MADE UP 5', '{}'::jsonb, 1, 'waiting')" % q(F))
    ok(FRONT(book) == [], "4. a posting of the book's company waits: none (postings first)")
    db.sql("update tally_post_jobs set status = 'done' where id = '00000000-0000-4000-8000-000000000160'")
    ok(len(FRONT(book, 1)) == 1, "4. the posting done: the newest day again")
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() where book_id = %s" % q(book))
    ok(FRONT(book) == [], "4. the check stopped: none")
    db.sql("update tally_check_runs set state = 'going' where book_id = %s" % q(book))
    db.sql("update tally_check_days set upload_at = now(), upload_words = 'upload it' where book_id = %s and day = %s" % (q(book), q(D(0))))
    ok([x.get("day") for x in FRONT(book)] == [D8(1)], "4. a day given up (to upload): left out")

    print("== 5. the gap's words")
    r, c = gap(book, 42873)
    ok(c["closed"] == "f" and c["g"] and c["g"].get("checking") is False, "5. a day of the gap given up: no longer checking, the upload asked (%s)" % (c["g"] or {}).get("checking"))
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
