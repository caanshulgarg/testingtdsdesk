"""python3 run_migration182.py - migration-182-gap-after-post (13-Nov-2026, branch next-fix-gap-after-post). Staging,
13-Nov-2026, Client CL: FinCom posted 42 bank entries dated in October (Tally's AlterIDs 42873 to 42915); the posting
window's credit closed the gap as a match though none was matched or read back; Tally's number then went to 43025 (110
changes on older dates); the page asked for the Day Book of 12-Nov to 13-Nov (empty in Tally); October was counted 0 on
07-Nov and never counted again; the gap read was held by an old over2s stop and given up after 6 hours; the "checking"
flag went stale. The owner, 13-Nov-2026: nobody opens Tally at night; reads may go while people work as long as nobody
feels them: the extra ("light") reads go only when the computer is idle (p_idle), one at a time, paced.
On a throwaway PostgreSQL (pg_stand, port 31182 unless PG182_PORT; never a real database), built as run_migration160.py
builds it, then 160 and 182 (twice). Made-up books only (a few entries each). Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (the table changes are the new tables' row security), names
     no real database; the new tables' grants (service_role only); the functions' grants; runs twice.
  1. (A) a posting done queues its entries' days as light days (no check started for a book without one); the window
     credits only entries matched or read back above its floor; light days only when idle, one every 25 s, 120 an hour,
     600 a day; the read back closes the gap as a match.
  2. (D) posted days keep the gap "checking" for 24 hours only, and only with a computer reading older entries.
  3. (B) a 2 s stop (over2s, window) an hour old: one idle day read again under its own choice time, at most every 3
     hours; its stop stops the retry only, a retry day given in time resumes the check, on the idle pace until the
     person's Resume; a gap open 7 hours: read when idle, not given up.
  4. (C) a day of the gap read whole (or type by type) after Tally's number was seen is not asked again; the gap says
     "Changes were made in Tally on older dates. Upload the Day Book from <the book's own year's first day> to today".
  5. (B) 98's count: once the gap's own days match, the days counted before Tally's number was seen are counted again,
     one idle day at a time, once a number; a day whose new count FinCom lacks is then brought in.
  6. (D) checking worked out at each write with checkUntil (an hour on).
  7. (B, C) From Tally's days: each to the client's book whose year has it; a gap's older days as light days; a day
     read since Tally's number was seen never queued again.
RED_WITHOUT_182=1: the same checks without the file (they fail; those marked (guard) hold what stays as it was and (step)
the steps between, and pass)."""
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
                                           "migration-158-held-delete-fast.sql", "migration-160-gap-read-close.sql")]
M = os.environ.get("M182_FILE") or os.path.join(SQLDIR, "migration-182-gap-after-post.sql")
RED = os.environ.get("RED_WITHOUT_182") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999182"
BK = {k: "819d4a59-4cee-4bf7-8f8c-0000000%02d182" % k for k in range(1, 12)}
CG = {k: "b20abc61-0000-4000-8000-79149af%02d182" % k for k in range(1, 12)}
DV = "dddddddd-0000-4000-8000-000000000182"
BR = "go-aaaaaa182182"
G = lambda mid, cg: cg + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d")
DMY = lambda d: d.strftime("%d-%b-%Y")
PFY = datetime.date(FY.year - 1, 4, 1)
OWNER = "55555555-5555-5555-5555-555555555182"

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
NEW_FNS = ["tally_gap_own_read", "tally_gap_state", "tally_post_job_read_back", "tally_light_may", "tally_light_took", "tally_day_read_for", "tally_check_paced"]
REPLACED = ["tally_recorder_gap_check", "tally_period_next_paced", "tally_check_stop", "tally_gap_front", "tally_sync_cursor_gap_checking", "tally_fill_request", "tally_check_next_open", "tally_check_status_of"]
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
    ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_gap_retries enable row level security;", "alter table public.tally_light_days enable row level security;", "alter table public.tally_light_pace enable row level security;"], "0. add-only (%s)" % alters)
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_gap_retries", "tally_light_days", "tally_light_pace"], "0. three new tables")
    ok(all(("grant select, insert, update, delete on public.%s to service_role;" % t) in text for t in ("tally_gap_retries", "tally_light_days", "tally_light_pace")), "0. their own explicit grants (service_role)")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(FNS == sorted(NEW_FNS + REPLACED), "0. the functions (%s)" % FNS)
    for fn, sig in (("tally_recorder_gap_check", "(uuid, uuid, bigint, timestamptz)"), ("tally_period_next_paced", "(uuid, integer, boolean)"), ("tally_check_stop", "(uuid, date, text, text, timestamptz)"),
                    ("tally_gap_front", "(uuid, integer, boolean), public.tally_gap_front(uuid, integer)"), ("tally_fill_request", "(text, date[])"), ("tally_check_next_open", "(uuid, integer)")):
        ok(("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text or ("grant execute on function public.%s%s to authenticated, service_role;" % (fn, sig)) in text, "0. %s: its grant restated" % fn)

db = pg_stand.start(int(os.environ.get("PG182_PORT") or 31182))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def V(guid, alter, d, typ="Payment", no="1", fid=None):
    return {"guid": guid, "alter": alter, "type": typ, "no": no, "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid, "day": d}
def LN(guid, amt=118.0): return [[guid, "Made-up Traders", -amt, "", None, []], [guid, "Bank", amt, "", None, []]]
def LNS(vs): return [x for v in vs for x in LN(v["guid"])]
def day(book, d, vouchers):
    return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(book), q(d), js(vouchers), js(LNS(vouchers)), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def H(guid, mid, alter, typ="Payment"): return [guid, mid, alter, typ]
def cday(book, n): return (db.rows("select source, (done_at is not null) as done, (upload_at is not null) as up, lists from tally_check_days where book_id = %s and day = %s" % (q(book), q(D(n)))) or [{}])[0]
HEADS = lambda book, n, hs: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(n)), js(hs)))
ENTRIES = lambda book, n, vs: j("select tally_check_entries(%s, %s, %s, %s, '{}'::jsonb)::text" % (q(book), q(D(n)), js(vs), js(LNS(vs))))
def gap(book, alt):
    r = j("select tally_recorder_gap_check(%s, %s, %d, now())::text" % (q(book), q(DV), alt))
    c = db.rows("select gap is null as closed, match_alter, gap::text as gap from tally_sync_cursor where book_id = %s" % q(book))[0]
    c["g"] = json.loads(c["gap"]) if c.get("gap") else {}
    return r, c
def FRONT(book, mx=3, idle=None):
    r = j("select tally_gap_front(%s, %d)::text" % (q(book), mx)) if idle is None else j("select tally_gap_front(%s, %d, %s)::text" % (q(book), mx, "true" if idle else "false"))
    return r if isinstance(r, list) else [{"_error": r}]
days_of = lambda fr: [x.get("day") for x in fr]
def age_gap(book, minutes): db.sql("update tally_sync_cursor set gap_at = now() - interval '%d minutes' where book_id = %s" % (minutes, q(book)))
def unask(book): db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))

# a made-up book: the starting point 42868, matched at 42872 13 minutes ago (a Receipt of yesterday in the copy at 42872);
# the check going unless run=False; Tally's number then moves (gap(book, n))
def gapbook(k, from_date=None, run=True):
    book, cg = BK[k], CG[k]
    if from_date: db.sql("update tally_books set from_date = %s where book_id = %s" % (q(from_date), q(book)))
    db.sql("""insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid, company_guid, recorder_max_alter, recorder_last_at, last_match_at, match_at, match_alter, match_start)
              values (%(B)s, %(F)s, 42868, now() - interval '4 days', %(CG)s, %(CG)s, 42872, now() - interval '14 minutes', now() - interval '13 minutes', now() - interval '13 minutes', 42872, null);
              update tally_sync_cursor set match_start = start_at where book_id = %(B)s""" % {"B": q(book), "F": q(F), "CG": q(cg)})
    if run: db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s) on conflict do nothing" % (q(book), q(F)))
    day(book, D(1), [V(G(26523, cg), 42872, D(1), "Receipt", "480")])
    return book, cg
JOBN = [0]
def posting(k, vouchers, a0, a1, accepted=True):
    """a posting of FinCom's (made-up ids FC-k-i), its window a0..a1, the ids accepted; done afterwards (the trigger)"""
    book, cg = BK[k], CG[k]; JOBN[0] += 1
    jid = "00000000-0000-4000-8000-%012d" % (182000 + JOBN[0])
    pl = {"vouchers": [{"id": fid, "xml": "<VOUCHER><DATE>%s</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER></VOUCHER>" % (d8, fid)} for fid, d8 in vouchers]}
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c%d', 'MADE UP %d', %s, %d, 'running')" % (q(jid), q(F), k, k, js(pl), len(vouchers)))
    for fid, d8 in vouchers:
        db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, accepted_at) values (%s, 'c%d', %s, %s, %s, %s)" % (q(F), k, q(fid), q(jid), q(fid), "now()" if accepted else "null"))
    db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, company_guid) values (%s, %s, %s, %s, %d, %d, %d, %s)" % (q(F), q(book), q(jid), q(DV), a0, a1, len(vouchers), q(cg)))
    return jid
def done(jid): db.sql("update tally_post_jobs set status = 'done' where id = %s" % q(jid))
light = lambda book: {r["day"]: r for r in (db.rows("select day::text as day, why, (handed_at is not null) as handed from tally_light_days where book_id = %s" % q(book)) if text else [])}
def repace(book):      # the 25 s between light days passed
    if text: db.sql("update tally_light_pace set last_at = now() - interval '30 seconds' where book_id = %s" % q(book))
heads_of = lambda vs: [H(v["guid"], int(v["guid"][-8:], 16), v["alter"]) for v in vs]
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for k, b in BK.items():
        fd = FY if k != 10 else PFY     # book 10: client c9's earlier year (the same company as book 9)
        cl, co = ("c9", "MADE UP 9") if k == 10 else ("c%d" % k, "MADE UP %d" % k)
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, %s, %s, %s);"
               % (q(b), q(F), q(cl), q(co), q(fd.isoformat()), q((fd - datetime.timedelta(days=1)).isoformat())))
        if k != 10: db.sql("insert into clients (id, firm_id, name, data) values ('c%d', %s, 'MADE UP %d', '{\"choices\": {}}')" % (k, q(F), k))
    db.sql("insert into members values (%s, %s, 'Owner', 'owner', true)" % (q(OWNER), q(F)))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh182', '{}'::jsonb, true, now()) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) select %s, 'MADE UP ' || k, 'c' || k, %s, now() from generate_series(1, 9) k on conflict do nothing;""" % (q(DV), q(F), q(F), q(DV)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "182 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    if text:
        for t in ("tally_gap_retries", "tally_light_days", "tally_light_pace"):
            ok(db.one("select has_table_privilege('authenticated', 'public.%s', 'select') or has_table_privilege('anon', 'public.%s', 'select')" % (t, t)) in ("f", "false"), "0. %s: nothing for anon or authenticated" % t)
            ok(db.one("select relrowsecurity from pg_class where oid = 'public.%s'::regclass" % t) in ("t", "true"), "0. %s: row security on" % t)
        sig = {}
        for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any (array[%s])" % ", ".join(q(x) for x in NEW_FNS + REPLACED)):
            sig.setdefault(r["proname"], []).append(r["sig"])
        ex = lambda rl, s: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(s))) in ("t", "true")
        for fn in ("tally_gap_own_read", "tally_gap_state", "tally_gap_front", "tally_recorder_gap_check", "tally_period_next_paced", "tally_check_stop", "tally_light_may", "tally_light_took", "tally_day_read_for", "tally_check_next_open", "tally_check_paced"):
            ok(fn in sig and all(ex("service_role", s) and not ex("authenticated", s) and not ex("anon", s) for s in sig[fn]), "0. %s: service_role only (%s)" % (fn, sig.get(fn)))
        ok(len(sig.get("tally_gap_front", [])) == 2, "0. tally_gap_front: 160's arguments and the idle one")
        fr = sig.get("tally_fill_request", [])
        ok(fr and all(ex("authenticated", x) and ex("service_role", x) and not ex("anon", x) for x in fr), "0. tally_fill_request: as 135 (members, service_role; not anon)")
        for fn in ("tally_sync_cursor_gap_checking", "tally_post_job_read_back", "tally_check_status_of"):
            ok(fn in sig and not any(ex(rl, s) for rl in ("service_role", "authenticated", "anon") for s in sig[fn]), "0. %s: nobody may call it" % fn)

    print("== 1. (A) a posting done: its days read back lightly; counted only once matched or read back above the floor")
    book, cg = gapbook(1, run=False)
    db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
              values (%(B)s, %(F)s, %(d41)s, 'upload', now() - interval '3 days', 1, 0, '[]'::jsonb, 'day', now() - interval '3 days', true, now() - interval '3 days')""" % {"B": q(book), "F": q(F), "d41": q(D(41))})
    jid = posting(1, [("FC-1-1", D8(40)), ("FC-1-2", D8(41)), ("FC-1-3", D8(41)), ("FC-1-4", D8(42))], 42872, 42876)
    ok(not light(book), "1. (guard) nothing queued while the posting runs")
    done(jid)
    lt = light(book)
    ok(sorted(lt) == sorted([D(40), D(41), D(42)]) and all(x["why"] == "post" and x["handed"] == "f" for x in lt.values()), "1. the posting done: its entries' days queued as light days, why 'post' (%s)" % lt)
    ok(cday(book, 40) == {} and cday(book, 41).get("done") == "t", "1. (guard) not put in the check at once (%s, %s)" % (cday(book, 40), cday(book, 41)))
    ok(db.one("select count(*) from tally_check_runs where book_id = %s" % q(book)) == "0", "1. (guard) no check started for a book without one")
    r, c = gap(book, 42876)
    ok(c["closed"] == "f" and r.get("missing") == 4, "1. Tally's number 42876: none of the 4 matched or read back: the gap stays open, 4 missing (%s)" % (r.get("missing"), ))
    ok("4 of FinCom's posted entries not read back from Tally yet" in (c["g"].get("words") or ""), "1. said plainly (%s)" % c["g"].get("words"))
    db.sql("update tally_post_ids set matched_at = now(), matched_alter = 42870 where fincom_id = 'FC-1-4'")
    r, c = gap(book, 42876)
    ok(c["closed"] == "f" and r.get("missing") == 4, "1. one matched at an AlterID below the window's floor (42870 <= 42872): not counted (%s)" % r.get("missing"))
    ok(c["g"].get("checking") is True and bool(c["g"].get("checkUntil")), "1. checking (posted days to read back, a computer reading older entries), with checkUntil (%s)" % ({k: c["g"].get(k) for k in ("checking", "checkUntil")}, ))
    age_gap(book, 3); unask(book)
    ok(days_of(FRONT(book, 3, False)) == [D8(0)], "1. someone typing (not idle): the gap's own day only, no light day")
    unask(book)
    ok(days_of(FRONT(book, 3, True)) == [D8(40), D8(0)], "1. idle: one light day (the newest posted), then the gap's own day")
    fr = FRONT(book, 3, True)
    ok(fr == [], "1. idle again at once: none (one light day every 25 s) (%s)" % fr)
    repace(book)
    ok(days_of(FRONT(book, 3, True)) == [D8(41)] and cday(book, 41).get("source") == "post" and cday(book, 41).get("done") == "f", "1. 25 s on: the next, put in the check (a day read before: read again) (%s)" % cday(book, 41))
    if text: db.sql("update tally_light_pace set hour_n = 120, hour_at = now() - interval '10 minutes' where book_id = %s" % q(book))
    repace(book)
    ok(FRONT(book, 3, True) == [], "1. 120 light days this hour: none (the hour's cap)")
    if text: db.sql("update tally_light_pace set hour_n = 0, day_n = 600, day_on = (now() at time zone 'Asia/Kolkata')::date where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "1. 600 today: none (the day's cap)")
    if text: db.sql("update tally_light_pace set day_n = 0 where book_id = %s" % q(book))
    v1 = [V(G(27001, cg), 42873, D(40), "Payment", "P1", "FC-1-1")]
    v2 = [V(G(27002, cg), 42874, D(41), "Payment", "P2", "FC-1-2"), V(G(27003, cg), 42875, D(41), "Payment", "P3", "FC-1-3")]
    h = HEADS(book, 41, heads_of(v2))
    ok(sorted(h.get("want") or []) == ["27002", "27003"], "1. the read back of the 41st day: both wanted (%s)" % h)
    e = ENTRIES(book, 41, v2)
    ok(e.get("done") is True, "1. (step) brought in (%s)" % e)
    r, c = gap(book, 42876)
    ok(c["closed"] == "f" and r.get("missing") == 2 and "2 of FinCom's posted entries not read back" in (c["g"].get("words") or ""), "1. two read back above the floor: 2 missing still (%s)" % r.get("missing"))
    HEADS(book, 40, heads_of(v1)); ENTRIES(book, 40, v1)
    db.sql("update tally_post_ids set matched_alter = 42876 where fincom_id = 'FC-1-4'")
    r, c = gap(book, 42876)
    ok(c["closed"] == "t" and r.get("matched") is True and c["match_alter"] == "42876" and r.get("accounted") == 4, "1. three read back and one matched above the floor: closed as a match, the 4 accounted (%s)" % r)

    print("== 2. (D, A) posted days: checking only for 24 hours, and only with a computer reading older entries")
    book, cg = gapbook(2)
    jid = posting(2, [("FC-2-1", D8(40))], 42872, 42873); done(jid)
    r, c = gap(book, 42873); age_gap(book, 3); unask(book)
    ok(days_of(FRONT(book, 3, True)) == [D8(40), D8(0)], "2. idle: the posted day, then the gap's own day")
    HEADS(book, 0, [])
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True and "older" not in c["g"], "2. the gap's own day matches, the posted day not read back yet: checking (%s)" % c["g"].get("checking"))
    if text: db.sql("update tally_light_days set queued_at = now() - interval '25 hours' where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False and bool(c["g"].get("older")), "2. posted 25 hours ago, still not read back: not checking, the upload asked (%s)" % c["g"].get("checking"))
    if text: db.sql("update tally_light_days set queued_at = now() where book_id = %s" % q(book))
    db.sql("update tally_devices set period_fetch = false where id = %s" % q(DV))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False, "2. no computer reads older entries for the company: not checking (%s)" % c["g"].get("checking"))
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DV))

    print("== 3. (B) a 2 s stop an hour old: one idle day read again, at most every 3 hours")
    book, cg = gapbook(3)
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(FY.isoformat())))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() - interval '2 hours', stop_why = 'over2s', chosen_at = now() - interval '3 days' where book_id = %s" % q(book))
    r, c = gap(book, 42873); age_gap(book, 3); unask(book)
    rc, pc = db.one("select chosen_at::text from tally_check_runs where book_id = %s" % q(book)), db.one("select chosen_at::text from tally_period_pulls where book_id = %s" % q(book))
    ok(FRONT(book, 3, False) == [], "3. someone typing: none")
    fr = FRONT(book, 3, True)
    ca = (fr[0].get("chosenAt") if fr and isinstance(fr[0], dict) else None)
    ok(days_of(fr) == [D8(0)] and fr[0].get("retry") is True and ca and ca != rc and ca != pc, "3. idle, by day: one day, a retry under its own choice time (%s)" % fr)
    st = j("select tally_check_stop(%s, %s, 'over2s', 'Tally took too long', %s)::text" % (q(book), q(D(0)), q(ca or "2000-01-01")))
    ok(st.get("retry") is True and db.one("select state || ' ' || (stopped_at < now() - interval '1 hour')::text from tally_check_runs where book_id = %s" % q(book)) == "stopped true"
       and db.one("select state from tally_period_pulls where book_id = %s" % q(book)) == "going", "3. over 2 s again: the retry stops, not the check, not the period (%s)" % st)
    unask(book); repace(book)
    ok(FRONT(book, 3, True) == [], "3. not again within 3 hours")
    if text: db.sql("update tally_gap_retries set started_at = now() - interval '4 hours' where book_id = %s" % q(book))
    fr = FRONT(book, 3, True)
    ok(days_of(fr) == [D8(0)] and fr[0].get("chosenAt") not in (ca, rc, pc), "3. 3 hours on: one day again, a new choice time (%s)" % fr)
    def again(why, ago):
        db.sql("update tally_check_runs set stop_why = %s, stopped_at = now() - interval '%s' where book_id = %s" % (q(why), ago, q(book)))
        if text: db.sql("update tally_gap_retries set started_at = now() - interval '4 hours' where book_id = %s" % q(book))
        unask(book); repace(book)
        return FRONT(book, 3, True)
    ok(days_of(again("window", "2 hours")) == [D8(0)], "3. Tally's window held 2 s (window): the same")
    ok(again("person", "2 hours") == [], "3. (guard) stopped by a person: none")
    ok(again("over2s", "10 minutes") == [], "3. (guard) an over2s stop 10 minutes old: none")
    # days of the check queued before the retry (an upload checked), to be read once the retry resumes the check
    db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at) select %s, %s, g::date, 'upload', now() - interval '1 minute' from generate_series(%s::date, %s::date, interval '1 day') g
              on conflict do nothing""" % (q(book), q(F), q(D(9)), q(D(5))))
    fr = again("over2s", "2 hours")
    ca2 = fr[0].get("chosenAt") if fr and isinstance(fr[0], dict) else None
    ok(days_of(fr) == [D8(0)] and db.one("select state from tally_check_runs where book_id = %s" % q(book)) == "stopped", "3. (step) the retry's day handed out; the check still stopped")
    HEADS(book, 0, []); FRONT(book, 3, False)
    ok(db.one("select state || ' ' || (chosen_at = %s::timestamptz)::text || ' ' || (stop_why is null)::text from tally_check_runs where book_id = %s" % (q(ca2 or "2000-01-01"), q(book))) == "going true true",
       "3. the retry's day given in time (read whole, not stopped): the check resumes by itself, under the retry's choice time")
    CN = lambda: (lambda r: r if isinstance(r, list) else [{"_error": r}])(j("select tally_check_next_open(%s, 3)::text" % q(book)))
    ST = lambda: (j("select tally_check_status_of(%s)::text" % q(book)).get("run") or {})
    ok(ST().get("paced") is True, "3. the page is told the check reads on the idle pace (run.paced: Read now)")
    if text: db.sql("update tally_light_pace set idle_at = null where book_id = %s" % q(book))
    ok(CN() == [], "3. (guard) the resumed check, someone typing: none of its earlier days")
    if text: db.sql("update tally_light_pace set idle_at = now(), last_at = now() - interval '30 seconds' where book_id = %s" % q(book))
    ok(days_of(CN()) == [D8(5)], "3. idle: one of its earlier days (the idle pace)")
    ok(CN() == [], "3. (guard) at once again: none (25 s)")
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, queued_at) values (%s, %s, %s, 'held', now())" % (q(book), q(F), q(D(20))))
    if text: db.sql("update tally_light_pace set idle_at = null where book_id = %s" % q(book))
    ok(days_of(CN()) == [D8(20)], "3. a day queued since (a held entry's day): at the check's own pace, idle or not")
    if text: db.sql("update tally_light_pace set idle_at = now(), last_at = now() - interval '30 seconds' where book_id = %s" % q(book))
    ok(days_of(CN()) == [D8(20), D8(6)], "3. idle: the day queued since, then one earlier day")
    st = j("select tally_check_stop(%s, %s, 'over2s', 'Tally took too long', %s)::text" % (q(book), q(D(6)), q(ca2 or "2000-01-01")))
    ok(db.one("select state || ' ' || coalesce(stop_why, '-') from tally_check_runs where book_id = %s" % q(book)) == "stopped over2s"
       and bool(text) and db.one("select (stopped_at is not null)::text from tally_gap_retries where book_id = %s" % q(book)) == "true", "3. the resumed check over 2 s again: the check stops (Resume shown), its retry with it (%s)" % st)
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False and ST().get("state") == "stopped" and not ST().get("paced"), "3. (guard) then not checking: the upload or Resume asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_check_runs set state = 'going', chosen_at = now(), stopped_at = null, stop_why = null where book_id = %s" % q(book))      # the person's Resume (133's tally_check_resume)
    ok(len(CN()) == 3 and not ST().get("paced"), "3. (guard) the person resumes it: the check's own pace again")
    print("== 3b. the computer's idle kept at every beat, gap or not; never while a posting waits")
    nb = BK[11]
    FRONT(nb, 3, True)
    ok(text and db.one("select (idle_at > now() - interval '5 seconds')::text from tally_light_pace where book_id = %s" % q(nb)) == "true", "3b. a book with no gap: idle kept")
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values ('00000000-0000-4000-8000-000000182999', %s, 'c11', 'MADE UP 11', '{}'::jsonb, 1, 'waiting')" % q(F))
    FRONT(nb, 3, True)
    ok(text and db.one("select (idle_at is null)::text from tally_light_pace where book_id = %s" % q(nb)) == "true", "3b. a posting of its company waiting: not idle")
    db.sql("update tally_post_jobs set updated_at = now() - interval '2 hours' where id = '00000000-0000-4000-8000-000000182999'")
    FRONT(nb, 3, True)
    ok(text and db.one("select (idle_at > now() - interval '5 seconds')::text from tally_light_pace where book_id = %s" % q(nb)) == "true", "3b. a posting stuck waiting 2 hours (not touched in 30 minutes): no longer holds the light reads")
    book, cg = gapbook(4)
    r, c = gap(book, 42873); age_gap(book, 7 * 60); unask(book)
    ok(FRONT(book, 3, False) == [] and days_of(FRONT(book, 3, True)) == [D8(0)], "3. a gap open 7 hours: read when idle (one light day), not given up")
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() - interval '2 hours', stop_why = 'over2s' where book_id = %s" % q(book))
    if text: db.sql("insert into tally_gap_retries (book_id, firm_id, chosen_at, started_at, day, stopped_at, stop_why) values (%s, %s, now() - interval '1 hour', now() - interval '1 hour', %s, now() - interval '10 minutes', 'over2s')" % (q(book), q(F), q(D(0))))
    db.sql("update tally_check_days set via = 'day', listed_at = now() where book_id = %s and day = %s" % (q(book), q(D(0))))
    FRONT(book, 3, False)
    ok(db.one("select state from tally_check_runs where book_id = %s" % q(book)) == "stopped", "3. (guard) a retry stopped over 2 s, though its day was listed: the check not resumed")

    print("== 4. (C) the gap's own days match: not asked again; the page's words, the book's own year")
    book, cg = gapbook(5)
    r, c = gap(book, 42873); age_gap(book, 3); unask(book)
    ok(days_of(FRONT(book)) == [D8(0)], "4. (step) the gap's own day read")
    h = HEADS(book, 0, [])
    ok(h.get("done") is True, "4. (step) Tally's Day Book of it matches FinCom")
    unask(book)
    ok(FRONT(book) == [], "4. 15 minutes on, Tally's number not moved: not asked again (%s)" % FRONT(book))
    r, c = gap(book, 42873)
    o = c["g"].get("older") or {}
    ok(c["closed"] == "f" and c["g"].get("checking") is False and o.get("from") == FY.isoformat() and o.get("say") == "Changes were made in Tally on older dates."
       and o.get("fix") == "Upload the Day Book from %s to today." % DMY(FY), "4. the gap says: changes on older dates, the Day Book from the first day of the book's year (%s)" % o)
    book, cg = gapbook(6)
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(PFY.isoformat())))
    r, c = gap(book, 42873); age_gap(book, 3); unask(book); FRONT(book)
    h = j("select tally_check_heads(%s, %s, '[]'::jsonb, 'split')::text" % (q(book), q(D(0))))
    unask(book)
    ok(h.get("done") is True and FRONT(book) == [], "4. a day read type by type (split): read for the gap too, not asked again (%s)" % h)
    r, c = gap(book, 42873)
    ok((c["g"].get("older") or {}).get("from") == PFY.isoformat(), "4. a book whose period is an earlier year: from that year's first day (%s)" % c["g"].get("older"))
    book, cg = BK[10], CG[10]
    gapbook(10)
    r, c = gap(book, 42873); age_gap(book, 3); unask(book); FRONT(book); HEADS(book, 0, []); r, c = gap(book, 42873)
    ok((c["g"].get("older") or {}).get("from") == PFY.isoformat(), "4. a book that begins in an earlier year (no period): from its year's first day (%s)" % c["g"].get("older"))

    print("== 5. (B) 98's count: the days counted before Tally's number was seen counted again, lightly, once")
    book, cg = gapbook(7)
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(FY.isoformat())))
    db.sql("""insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at)
              select %s, %s, g::date, 0, 0, '[]'::jsonb, 'day', now() - interval '6 days', now() - interval '6 days' from generate_series(%s::date, %s::date, interval '1 day') g""" % (q(book), q(F), q(FY.isoformat()), q(D(0))))
    PN = lambda: (lambda r: r if isinstance(r, list) else [{"_error": r}])(j("select tally_period_next_paced(%s, 3, false)::text" % q(book)))
    ok(PN() == [], "5. (guard) the year counted, no gap: nothing")
    r, c = gap(book, 42873); age_gap(book, 3)
    ok(PN() == [], "5. (guard) a gap whose own days are not read yet: nothing counted again")
    unask(book); FRONT(book, 3, False); HEADS(book, 0, [])
    ok(PN() == [], "5. (guard) its own days match, someone typing (not idle): nothing counted again")
    FRONT(book, 3, True)
    pn = PN()
    ok(days_of(pn) == [D8(0)] and all(x.get("fetch") is False for x in pn), "5. idle: one day counted again (the newest), a count only (%s)" % days_of(pn))
    ok(PN() == [], "5. (guard) at once again: none (25 s)")
    repace(book)
    ok(days_of(PN()) == [D8(1)], "5. 25 s on: the next")
    db.sql("update tally_period_days set counted_at = now() where book_id = %s and day <> %s" % (q(book), q(D(40))))
    repace(book)
    ok(days_of(PN()) == [D8(40)], "5. each day once a number: the one left")
    nv = V(G(27100, cg), 42873, D(40), "Journal", "J1")
    ph = j("select tally_period_heads(%s, %s, %s, 'day')::text" % (q(book), q(D(40)), js([H(nv["guid"], 27100, 42873, "Journal")])))
    ok(ph.get("done") is False, "5. (step) its new count: an entry FinCom lacks (%s)" % ph)
    repace(book)
    pn = PN()
    ok(days_of(pn) == [D8(40)] and pn[0].get("fetch") is True, "5. (guard) then brought in (fetch), nothing counted again (%s)" % pn)

    print("== 6. (D) checking worked out at each write, with checkUntil")
    book, cg = gapbook(8)
    r, c = gap(book, 42873); age_gap(book, 7 * 60)
    r, c = gap(book, 42873)
    cu = c["g"].get("checkUntil")
    fut = cu and db.one("select (%s::timestamptz > now() + interval '50 minutes')::text" % q(cu)) == "true"
    ok(c["g"].get("checking") is True and fut, "6. a gap open 7 hours, still read when idle: checking, until an hour on (%s, %s)" % (c["g"].get("checking"), cu))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now() - interval '2 hours', stop_why = 'over2s' where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True, "6. a check stopped over2s: still checking (tried again when idle)")
    if text: db.sql("insert into tally_gap_retries (book_id, firm_id, chosen_at, started_at, stopped_at, stop_why) values (%s, %s, now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes', 'over2s')" % (q(book), q(F)))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False and "checkUntil" not in c["g"], "6. (guard) its retry stopped too: not checking, the upload asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_check_runs set stop_why = 'person' where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is False, "6. (guard) a check stopped by a person: not checking")

    print("== 7. (B, C) From Tally's days: to the right book, older days lightly, never again once read")
    book, cg = gapbook(9)
    r, c = gap(book, 42873); age_gap(book, 3); unask(book); FRONT(book); HEADS(book, 0, []); r, c = gap(book, 42873)
    ok(bool(c["g"].get("older")), "7. (step) the gap's own day matches: older dates")
    pday = (PFY + datetime.timedelta(days=10)).isoformat()
    FILL = lambda days: j("select tally_fill_request('c9', array[%s]::date[])::text" % ", ".join(q(d) for d in days), OWNER, "authenticated")
    fl = FILL([D(0), D(40), D(41), pday])
    lt = light(book)
    ok(sorted(lt) == [D(41), D(40)] and all(x["why"] == "fill" for x in lt.values()) and cday(book, 40) == {}, "7. the older days of this year: light days of its book, not the check at once (%s)" % lt)
    ok(pday in light(BK[10]) and pday not in lt, "7. a day of the earlier year: to that year's book (%s)" % fl)
    ok(cday(book, 0).get("source") == "gap" and cday(book, 0).get("done") == "t", "7. (guard) the gap's own day, read for Tally's number: not queued again (%s)" % cday(book, 0))
    fl2 = FILL([D(0), D(40), D(41), pday])
    ok(fl2.get("queued") == 0 and fl2.get("light") == 0, "7. From Tally opened again: nothing queued again (%s)" % fl2)
    repace(book); unask(book)
    ok(days_of(FRONT(book, 3, True)) == [D8(40)], "7. idle: the newest older day handed out")
    HEADS(book, 40, [])
    fl3 = FILL([D(40)])
    ok(fl3.get("queued") == 0 and fl3.get("light") == 0 and light(book).get(D(40), {}).get("handed") == "t", "7. a day read since Tally's number was seen: never queued again (%s)" % fl3)
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
