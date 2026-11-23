"""python3 run_migration214.py - migration-214-light-days-no-gap (23-Nov-2026, branch next-fix-light-days). Staging,
23-Nov-2026: after a posting, 182's trigger queues its days as light days (tally_light_days, why 'post'), but only
tally_gap_front hands them out, and it stopped at once when no gap was open: a book with no gap had 155 of 212 light days
never handed out, so entries posted to Tally never came back into FinCom's copy.
On a throwaway PostgreSQL (pg_stand, port 31214 unless PG214_PORT; never a real database), built as run_migration182.py
builds it, then 182 and 214 (twice). Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only, names no real database, only tally_gap_front(uuid, integer,
     boolean) replaced (182's text plus the marked 214 lines), security definer with search_path public, pg_temp; grants
     (service_role only, as on staging); runs twice; stops, changing nothing, over a tally_gap_front not 182's or 214's.
  1. no gap open, idle: the posted days handed out one at a time (newest first), whatever p_max, put in the check
     (source 'post'), paced as 182 (25 s, the last one picked up or 10 minutes, 120 an hour, 600 a day); none when not
     idle, none by 160's arguments, none while a posting of the company runs; a day already read back is skipped.
  2. no gap: From Tally's older days (why 'fill') too; all handed out, then none.
  3. no cursor row and no check run yet: handed out (the book's firm).
  4. no gap and a check stopped (a 2 s stop an hour old, or by a person), older entries paused: none, and no retry.
  5. a gap open: as 182 (one light day, then the gap's own day). The rest of 182's gap checks: run_migration182.py with
     M182_THEN=<this file>.
RED_WITHOUT_214=1: the same checks without the file (1-3 fail; those marked (guard) pass)."""
import os, re, sys, json, hashlib, subprocess, datetime, difflib
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
                                           "migration-158-held-delete-fast.sql", "migration-160-gap-read-close.sql", "migration-182-gap-after-post.sql")]
M = os.environ.get("M214_FILE") or os.path.join(SQLDIR, "migration-214-light-days-no-gap.sql")
RED = os.environ.get("RED_WITHOUT_214") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F = "99999999-9999-9999-9999-999999999214"
BK = {k: "819d4a59-4cee-4bf7-8f8c-0000000%02d214" % k for k in range(1, 8)}
CG = {k: "b20abc61-0000-4000-8000-79149af%02d214" % k for k in range(1, 8)}
DV = "dddddddd-0000-4000-8000-000000000214"
G = lambda mid, cg: cg + "-%08x" % mid
IST = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
TODAY = IST.date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
D = lambda n: (TODAY - datetime.timedelta(days=n)).isoformat()
D8 = lambda n: (TODAY - datetime.timedelta(days=n)).strftime("%Y%m%d")

text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
FN_RE = r"create or replace function public\.tally_gap_front\(p_book uuid, p_max integer, p_idle boolean\).*?^end \$function\$;"
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    ok("delete from" not in code and not re.search(r"\b(drop|truncate|alter\s+table|create\s+table|insert\s+into\s+public|update\s+public)\b", code), "0. add-only (no table or row changed by the file itself)")
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(re.findall(r"create or replace function public\.(\w+)\s*\(", text) == ["tally_gap_front"], "0. only tally_gap_front replaced")
    ok("language plpgsql security definer set search_path = public, pg_temp as $function$" in text, "0. security definer, search_path public, pg_temp")
    ok("revoke all on function public.tally_gap_front(uuid, integer, boolean) from public, anon, authenticated;" in text
       and "grant execute on function public.tally_gap_front(uuid, integer, boolean) to service_role;" in text, "0. grants restated (service_role only)")
    ok("raise exception 'migration 214:" in text and "1d2b4502e5473d6aa051ac86755a77be" in text, "0. a name guard (182's text, or 214's)")
    old = re.search(FN_RE, open(os.path.join(SQLDIR, "migration-182-gap-after-post.sql")).read(), re.S | re.M).group(0).splitlines()
    new = re.search(FN_RE, text, re.S | re.M).group(0).splitlines()
    dl = [l for l in difflib.unified_diff(old, new, lineterm="", n=0) if l[:1] in "+-" and not l.startswith(("+++", "---"))]
    removed = [l[1:].strip() for l in dl if l.startswith("-")]
    added = [l[1:].strip() for l in dl if l.startswith("+") and not l[1:].strip().startswith("--")]
    ok(removed == ["days date[] := '{}'; gaps date[] := '{}'; lights date[] := '{}';",
                   "if not found or c.gap is null or c.gap_at is null then return out; end if;",
                   "old := c.gap_at < now() - interval '6 hours';"]
       and added == ["days date[] := '{}'; gaps date[] := '{}'; lights date[] := '{}'; nogap boolean;",
                     "nogap := not found or c.gap is null or c.gap_at is null;", "if nogap and not idle then return out; end if;",
                     "c.firm_id := coalesce(c.firm_id, bk.firm_id);", "if not nogap then", "end if;", "if nogap then return out; end if;",
                     "old := nogap or c.gap_at < now() - interval '6 hours';"], "0. 182's text but the 214 lines (%s / %s)" % (removed, added))

db = pg_stand.start(int(os.environ.get("PG214_PORT") or 31214))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def FRONT(book, mx=3, idle=None):
    r = j("select tally_gap_front(%s, %d)::text" % (q(book), mx)) if idle is None else j("select tally_gap_front(%s, %d, %s)::text" % (q(book), mx, "true" if idle else "false"))
    return r if isinstance(r, list) else [{"_error": r}]
days_of = lambda fr: [x.get("day") for x in fr]
light = lambda book: {r["day"]: r for r in db.rows("select day::text as day, why, (handed_at is not null) as handed from tally_light_days where book_id = %s" % q(book))}
def cday(book, n): return (db.rows("select source, firm_id::text as firm, (done_at is not null) as done from tally_check_days where book_id = %s and day = %s" % (q(book), q(D(n)))) or [{}])[0]
def repace(book): db.sql("update tally_light_pace set last_at = now() - interval '11 minutes' where book_id = %s" % q(book))
def cursor(k):     # a book matched with Tally 13 minutes ago: no gap open
    db.sql("""insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid, company_guid, recorder_max_alter, recorder_last_at, last_match_at, match_at, match_alter, match_start)
              values (%(B)s, %(F)s, 42868, now() - interval '4 days', %(CG)s, %(CG)s, 42872, now() - interval '14 minutes', now() - interval '13 minutes', now() - interval '13 minutes', 42872, now() - interval '4 days')"""
           % {"B": q(BK[k]), "F": q(F), "CG": q(CG[k])})
def run(k): db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s) on conflict do nothing" % (q(BK[k]), q(F)))
JOBN = [0]
def posting(k, days, status="done"):
    """a posting of FinCom's (made-up ids FC-k-i) of entries dated on those days; done (182's trigger queues its days)"""
    JOBN[0] += 1; jid = "00000000-0000-4000-8000-%012d" % (214000 + JOBN[0])
    vs = [("FC-%d-%d-%d" % (k, JOBN[0], i), d8) for i, d8 in enumerate(days)]
    pl = {"vouchers": [{"id": fid, "xml": "<VOUCHER><DATE>%s</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER></VOUCHER>" % (d8, fid)} for fid, d8 in vs]}
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c%d', 'MADE UP %d', %s, %d, 'running')" % (q(jid), q(F), k, k, js(pl), len(vs)))
    for fid, d8 in vs:
        db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, accepted_at) values (%s, 'c%d', %s, %s, %s, now())" % (q(F), k, q(fid), q(jid), q(fid)))
    if status != "running": db.sql("update tally_post_jobs set status = %s where id = %s" % (q(status), q(jid)))
    return jid
def queued(k, n, why):
    db.sql("insert into tally_light_days (book_id, firm_id, day, why) values (%s, %s, %s, %s) on conflict do nothing" % (q(BK[k]), q(F), q(D(n)), q(why)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing;" % q(F))
    db.sql("create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));")
    for k, b in BK.items():
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c%d', 'MADE UP %d', %s, %s);"
               % (q(b), q(F), k, k, q(FY.isoformat()), q((FY - datetime.timedelta(days=1)).isoformat())))
        db.sql("insert into clients (id, firm_id, name, data) values ('c%d', %s, 'MADE UP %d', '{\"choices\": {}}')" % (k, q(F), k))
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("""alter table tally_devices add column if not exists info jsonb not null default '{}'::jsonb; alter table tally_devices add column if not exists revoked boolean not null default false;
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, book_id uuid, primary key (firm_id, company));
      insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh214', '{}'::jsonb, true, now()) on conflict do nothing;
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) select %s, 'MADE UP ' || k, 'c' || k, %s, now() from generate_series(1, 7) k on conflict do nothing;""" % (q(DV), q(F), q(F), q(DV)))
    for path in AFTER:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    if text:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "214 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))

    print("== 0. grants")
    ex = lambda rl, s: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(s))) in ("t", "true")
    for s in ("public.tally_gap_front(uuid, integer, boolean)", "public.tally_gap_front(uuid, integer)"):
        ok(ex("service_role", s) and not ex("authenticated", s) and not ex("anon", s) and not ex("public", s), "0. (guard) %s: service_role only" % s)
    pr = db.rows("select prosecdef::text sd, array_to_string(proconfig, ',') cf from pg_proc where oid = 'public.tally_gap_front(uuid, integer, boolean)'::regprocedure")[0]
    ok(pr["sd"] == "true" and pr["cf"] == "search_path=public, pg_temp", "0. (guard) security definer, search_path public, pg_temp (%s)" % pr)
    ok(db.one("select count(*) from pg_proc where proname = 'tally_gap_front'") == "2", "0. (guard) still the two tally_gap_front")

    print("== 1. no gap open: the posted days handed out, idle and paced")
    book = BK[1]; cursor(1); run(1)
    posting(1, [D8(40), D8(41), D8(41), D8(42)])
    lt = light(book)
    ok(sorted(lt) == sorted([D(40), D(41), D(42)]) and all(x["why"] == "post" and x["handed"] == "f" for x in lt.values()), "1. (guard) the posting done: its days queued, why 'post' (%s)" % lt)
    ok(db.one("select gap is null from tally_sync_cursor where book_id = %s" % q(book)) in ("t", "true"), "1. (guard) no gap open")
    ok(FRONT(book, 3, False) == [], "1. (guard) not idle: none")
    ok(FRONT(book, 3) == [], "1. (guard) 160's arguments (not idle): none")
    fr = FRONT(book, 3, True)
    chosen = db.one("select chosen_at from tally_check_runs where book_id = %s" % q(book))
    ok(days_of(fr) == [D8(40)], "1. idle, max 3: one light day, the newest posted (%s)" % fr)
    ok(bool(fr) and fr[0].get("fetch") is True and fr[0].get("check") is True and "retry" not in fr[0] and fr[0].get("chosenAt") is not None
       and db.one("select %s::timestamptz = %s::timestamptz" % (q(fr[0].get("chosenAt") or "epoch"), q(chosen))) in ("t", "true"), "1. a check day under the check's own choice time (%s)" % (fr[:1], ))
    ok(light(book)[D(40)]["handed"] == "t" and cday(book, 40).get("source") == "post" and cday(book, 40).get("done") == "f", "1. handed out and put in the check, source 'post' (%s)" % cday(book, 40))
    pace = db.rows("select hour_n, day_n, last_day::text ld, last_kind from tally_light_pace where book_id = %s" % q(book))
    ok(pace == [{"hour_n": "1", "day_n": "1", "ld": D(40), "last_kind": "check"}], "1. counted on the light pace (%s)" % pace)
    ok(FRONT(book, 3, True) == [], "1. idle again at once: none (one every 25 s)")
    db.sql("update tally_light_pace set last_at = now() - interval '30 seconds' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "1. 30 s on, the last day not picked up by the bridge: none (one at a time)")
    db.sql("update tally_check_days set listed_at = now() where book_id = %s and day = %s" % (q(book), q(D(40))))
    ok(days_of(FRONT(book, 7, True)) == [D8(41)], "1. the last one listed by Tally, 25 s on: the next, one only though max 7")
    repace(book)
    jid = posting(1, [D8(50)], status="running")
    ok(FRONT(book, 3, True) == [], "1. a posting of the company running: none (postings first)")
    db.sql("update tally_post_jobs set status = 'done' where id = %s" % q(jid))
    db.sql("update tally_light_pace set hour_n = 120, hour_at = now() - interval '10 minutes' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "1. 120 light days this hour: none")
    db.sql("update tally_light_pace set hour_n = 0, day_n = 600, day_on = (now() at time zone 'Asia/Kolkata')::date where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "1. 600 today: none")
    db.sql("update tally_light_pace set day_n = 0 where book_id = %s" % q(book))
    # the 42nd day already read whole and done after it was queued: skipped
    db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
              values (%s, %s, %s, 'upload', now(), 1, 0, '[]'::jsonb, 'day', now(), true, now())""" % (q(book), q(F), q(D(42))))
    ok(days_of(FRONT(book, 3, True)) == [D8(50)], "1. a day read back already is skipped: the next posted day")

    print("== 2. no gap: From Tally's older days too, then none")
    book = BK[2]; cursor(2); run(2)
    queued(2, 60, "fill"); queued(2, 61, "fill"); queued(2, 30, "post")
    got = []
    for i in range(5):
        got += days_of(FRONT(book, 3, True)); repace(book)
    ok(got == [D8(30), D8(60), D8(61)], "2. all handed out, newest first, one a call (%s)" % got)
    ok(all(x["handed"] == "t" for x in light(book).values()) and cday(book, 61).get("source") == "fill", "2. none left unhanded; source 'fill' kept (%s)" % cday(book, 61))
    ok(FRONT(book, 3, True) == [], "2. then none")

    print("== 3. no cursor row and no check run yet")
    book = BK[3]; queued(3, 20, "post")
    fr = FRONT(book, 3, True)
    ok(days_of(fr) == [D8(20)] and cday(book, 20).get("firm") == F, "3. handed out, the book's firm (%s, %s)" % (fr, cday(book, 20)))

    print("== 4. no gap and a stop: none, no retry")
    book = BK[4]; cursor(4); run(4); queued(4, 10, "post")
    db.sql("update tally_check_runs set state = 'stopped', stop_why = 'over2s', stopped_at = now() - interval '2 hours' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [] and db.one("select count(*) from tally_gap_retries where book_id = %s" % q(book)) == "0", "4. (guard) a 2 s stop 2 hours old: none, no retry")
    db.sql("update tally_check_runs set stop_why = 'person' where book_id = %s" % q(book))
    ok(FRONT(book, 3, True) == [], "4. (guard) stopped by a person: none")
    db.sql("update tally_check_runs set state = 'going', stop_why = null, stopped_at = null where book_id = %s" % q(book))
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, state, chosen_at, paused_at) values (%s, %s, %s, 'paused', now(), now())" % (q(book), q(F), q(FY.isoformat())))
    ok(FRONT(book, 3, True) == [], "4. (guard) older entries paused: none")
    db.sql("update tally_period_pulls set state = 'going', paused_at = null where book_id = %s" % q(book))
    ok(days_of(FRONT(book, 3, True)) == [D8(10)], "4. going again: handed out")

    print("== 5. a gap open: as 182")
    book = BK[5]; cursor(5); run(5); queued(5, 40, "post")
    db.sql("""update tally_sync_cursor set gap = jsonb_build_object('since', (now() - interval '5 minutes')::text, 'tally_altvchid', 42873), gap_at = now() - interval '3 minutes' where book_id = %s""" % q(book))
    ok(days_of(FRONT(book, 3, False)) == [D8(0)] and light(book)[D(40)]["handed"] == "f", "5. (guard) not idle: the gap's own day only, no light day")
    db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(book))
    ok(days_of(FRONT(book, 3, True)) == [D8(40), D8(0)], "5. (guard) idle: one light day, then the gap's own day")
    db.sql("update tally_sync_cursor set gap_at = now() - interval '1 minute' where book_id = %s" % q(book)); repace(book)
    ok(FRONT(book, 3, True) == [], "5. (guard) a gap open under 2 minutes: none, as 182")

    if text:
        print("== 0. the guard")
        db.sql("""comment on function public.tally_gap_front(uuid, integer, boolean) is null;
                  create or replace function public.tally_gap_front(p_book uuid, p_max integer, p_idle boolean) returns jsonb
                  language sql security definer set search_path = public, pg_temp as $f$ select '["other"]'::jsonb $f$;""")
        r = psql_text(text)
        ok(r.returncode != 0 and "migration 214: function tally_gap_front(uuid, integer, boolean) is not 182's text. Nothing was changed." in r.stderr, "0. over another tally_gap_front: stops (%s)" % r.stderr.strip()[-160:])
        ok(FRONT(BK[6], 3, True) == ["other"], "0. nothing changed")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
