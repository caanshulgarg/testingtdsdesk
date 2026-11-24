"""python3 run_migration222.py - server/tally-cloud/migration-222-tally-autoday.sql (24-Nov-2026, branch next-tally-tell-sql;
the owner, 24-Nov-2026: "There should be proper way to tell and auto import of tally days into fincom"; the plan's part B).
On a throwaway PostgreSQL (tests/tell_stand.py: port 31222 unless PG222_PORT, its data under /tmp/tell222 unless PG222_DIR,
removed after; never a real database), with 221 applied first, made-up firm, books and entries only. Written before the file.
  0. the file: one transaction, lock_timeout 10 s; add-only (six columns added; nothing dropped, deleted or truncated; no
     table made); names no real database; security definer with search_path public, pg_temp on every function; each
     replaced function is its predecessor's text with every changed line marked "222", and the guard knows the md5 the
     stand (and staging) runs; grants (the queue, the pickup and the 5-argument heads: service_role only; the sweep and
     helpers nobody's); runs twice; the guard stops it over a tally_check_next_open that is not staging's; md5 printed
  1. each source queued with its prio (held 1, delete 2, gap 3, future 4, fill 5); the hand-out goes by prio
  2. parked when the link goes (not handed, not counted), un-parked when linked again
  3. a 2 s stop: the check stays going, the day waits 1 h, 3 h, then 24 h and every 24 h; handed again after; a run a bridge
     stopped before 222 (3325's) going again by itself; a person's Stop stays stopped; the period a bridge stopped started
     again after 1 h; a linked book with no period gets one, going, chosen at its link time; pickups ('slow' waits, a closed
     Tally does not)
  4. a future-dated line: queued on its own date and not before
  5. before the book's first day: with the client's earlier book, its day queued into that book (and the line closed once
     that day was read after it); without one, 'stale' with "Made in Tally in 2025-26, a year FinCom does not keep." and
     never queued or retried
  6. the daily fetching sweep never makes a line stale whose day was never listed after it came; once listed: stale
  7. delete guards: a list in bands with a hole deletes nothing; whole bands delete on the
     second list a minute later; a FinCom posting settled under 10 minutes ago is not deleted, and is once settled 10
     minutes; a plain entry: deleted on the second list; an unfinished day (6 lists) waits, never "upload the Day Book"
  8. the words: tally_check_status_of and tally_held_status never ask for an upload; the sweep answers, each book in turn
  9. 197's tally_period_day_stop: a slow day waits 1 h, 3 h, then 24 h; its 3rd try no longer marks it to upload (plain
     words instead), its check day waits too; two stops while it waits are one try
 10. the review of 24-Nov-2026: the days given up to an upload opened again once, 'slow3' retried, tally_period_upload's
     words; a hand-out never a try, a reopened day afresh; an earlier book only when linked, the book's own pre-start
     days closed; no delete of an entry with a line being brought, an empty list deletes only on a third 10 minutes on;
     'bands' without bands as today; 31 dates re-checked; auto_tries reset; the jobs in UTC; types and job names guarded
RED_WITHOUT_222=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, datetime, difflib
os.environ["TMPDIR"] = os.environ.get("PG222_DIR") or "/tmp/tell222"
os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o777)
os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tell_stand as T
from tell_stand import q, js, F, OWNER
RED = os.environ.get("RED_WITHOUT_222") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

text = open(T.M222).read() if os.path.exists(T.M222) and not RED else ""
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
print("== 0. the file")
ok(bool(text), "the migration file is there")
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(T.M222), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "one transaction, lock_timeout 10 s")
body = re.sub(r"\$function\$.*?\$function\$", "", code, flags=re.S)
alters = re.findall(r"\balter\s+table\s+(public\.\w+)\s+add column if not exists (\w+)", body)
ok(bool(text) and "delete from" not in body and not re.search(r"\b(truncate|drop)\b", body) and "create table" not in body and len(re.findall(r"\balter\s+table\b", body)) == 7
   and sorted(alters) == [("public.tally_check_days", c) for c in ("empty_lists", "last_why", "next_at", "parked_at", "prio", "tries")] + [("public.tally_period_pulls", "auto_tries")],
   "add-only: seven columns added, nothing else changed in a table (%s)" % alters)
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://|project[_ ]ref", low), "names no real database")
nfn = len(re.findall(r"create or replace function public\.", text))
ok(bool(text) and low.count("security definer set search_path = public, pg_temp") == nfn, "every function: security definer, search_path public, pg_temp (%d of %d)" % (low.count("security definer set search_path = public, pg_temp"), nfn))
for g in ("grant execute on function public.tally_autoday_queue(uuid) to service_role;", "revoke all on function public.tally_autoday_queue(uuid) from public, anon, authenticated;",
          "grant execute on function public.tally_autoday_pickup(uuid, date, text) to service_role;", "grant execute on function public.tally_check_heads(uuid, date, jsonb, text, jsonb) to service_role;",
          "public.tally_autoday_queue_of(uuid), public.tally_autoday_sweep() from public, anon, authenticated, service_role;",
          "perform cron.schedule('tally-autoday', '3-59/15 * * * *', 'select public.tally_autoday_sweep()');", "perform cron.schedule('tally-autoday-night', '37 18 * * *', 'select public.tally_autoday_sweep()');"):
    ok(g in text, "explicit: " + g[:100])
ok(not re.search(r"grant execute on function public\.tally_autoday_sweep", text), "the sweep: granted to nobody (cron only)")
def block(t, name, args=None):
    ms = [m.start() for m in re.finditer(r"create or replace function public\." + name + r"\(" + (re.escape(args) if args else ""), t)]
    if not ms: return ""
    i = ms[-1]; m = re.compile(r"\$(\w*)\$").search(t, i); tag = m.group(0); k = t.index(tag, m.end()) + len(tag); return t[i:t.index(";", k) + 1]
def marked(old, new, what):
    d = [x for x in difflib.unified_diff(old.split("\n"), new.split("\n"), lineterm="", n=0) if x[:1] in "+-" and x[:3] not in ("+++", "---")]
    bad = [x for x in d if x.startswith("+") and not re.search(r"--.*\b222\b", x) and not re.match(r"^\+\s*--", x)]
    ok(bool(new) and d and not bad, "%s: its text with %d changed lines, each marked '222' (unmarked: %s)" % (what, len(d), bad[:1]))
S = lambda f: open(os.path.join(T.SQLDIR, f)).read()
marked(block(S("migration-182-gap-after-post.sql"), "tally_check_next_open"), block(text, "tally_check_next_open"), "tally_check_next_open (182's)")
marked(block(S("migration-182-gap-after-post.sql"), "tally_check_stop"), block(text, "tally_check_stop"), "tally_check_stop (182's)")
marked(block(S("migration-133-fetch-check.sql"), "tally_check_heads"), block(text, "tally_check_heads", "p_book uuid, p_day date, p_heads jsonb, p_via text)"), "tally_check_heads (133's)")
marked(block(S("migration-196-recorder-no-held.sql"), "tally_recorder_fetching_sweep"), block(text, "tally_recorder_fetching_sweep"), "tally_recorder_fetching_sweep (196's)")
marked(block(S("migration-196-recorder-no-held.sql"), "tally_held_status"), block(text, "tally_held_status"), "tally_held_status (196's)")
marked(block(S("migration-182-gap-after-post.sql"), "tally_check_status_of"), block(text, "tally_check_status_of"), "tally_check_status_of (182's)")
marked(block(S("migration-197-day-retry.sql"), "tally_period_day_stop"), block(text, "tally_period_day_stop"), "tally_period_day_stop (197's)")
ok("grant execute on function public.tally_period_day_stop(uuid, date, text) to service_role;" in text and "revoke all on function public.tally_period_day_stop(uuid, date, text) from public, anon, authenticated;" in text, "tally_period_day_stop: 197's grants restated (service_role)")

st = T.build(int(os.environ.get("PG222_PORT") or 31222), with221=True); db = st.db; j = st.j
if RED:   # the columns alone (so the checks read them), none of 222's functions: every behaviour below must fail
    db.sql("""alter table tally_check_days add column prio smallint not null default 5, add column tries int not null default 0, add column next_at timestamptz, add column last_why text, add column parked_at timestamptz;
              alter table tally_period_pulls add column auto_tries int not null default 0""")
def bye():
    st.stop()
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = NOW.astimezone(IST).date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
PFY = datetime.date(FY.year - 1, 4, 1)
D = lambda n: TODAY - datetime.timedelta(days=n)
BK = {k: "819d4a59-4cee-4bf7-8f8c-0000000%02d222" % k for k in range(1, 10)}
CG = {k: "b20abc61-0000-4000-8000-79149af%02d222" % k for k in range(1, 10)}
DA, BA = "dddddddd-0000-4000-8000-00000000a222", "go-aaaaaa222222"
CO = lambda k: "MADE UP TRADERS %d" % k
G = lambda k, mid: CG[k] + "-%08x" % mid
try:
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC1', 'kh222', '{}'::jsonb, true, now())" % (q(DA), q(F)))
    for k, b in BK.items():
        fd = PFY if k == 9 else FY            # book 9: client c8's earlier year (the same client as book 8)
        cl = "c8" if k == 9 else "c%d" % k
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, %s, %s, %s)" % (q(b), q(F), q(cl), q(CO(k)), q(fd.isoformat()), q((fd - datetime.timedelta(days=1)).isoformat())))
        db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, state, linked_at, device_id) values (%s, %s, %s, %s, %s, 'linked', now() - interval '3 days', %s)" % (q(F), q(b), q(cl), q(CG[k]), q(CO(k)), q(DA)))
    # (review 1) days given up to an upload before 222, a locked month's, and a period day 'slow3' (197's third slow day)
    UPD, LKD, S3 = D(40), D(41), D(42)
    db.sql("""insert into tally_check_days (book_id, firm_id, day, source, lists, upload_at, upload_words, gone1, gone1_at) values
              (%(B)s, %(F)s, %(U)s, 'held', 6, now() - interval '2 days', 'FinCom could not finish checking this day against Tally. Please upload that day''s Day Book again.', '["x"]'::jsonb, now() - interval '2 days'),
              (%(B)s, %(F)s, %(L)s, 'held', 1, now() - interval '2 days', 'FinCom could not correct it: its month is locked in FinCom. Unlock the month, then upload that day''s Day Book again.', null, null);
              insert into tally_period_pulls (book_id, firm_id, fy_start, state) values (%(B6)s, %(F)s, %(FY)s, 'going');
              insert into tally_period_days (book_id, firm_id, day, upload_at, upload_why, upload_words) values (%(B6)s, %(F)s, %(S3)s, now() - interval '1 day', 'slow3', 'Tally could not send it in time on 3 days. Upload that day''s Day Book to finish it.');
              insert into tally_period_day_retry (book_id, firm_id, day, fails, first_at, last_at, retry_at, why) values (%(B6)s, %(F)s, %(S3)s, 3, now() - interval '3 days', now() - interval '1 day', now() + interval '20 hours', 'over2s')"""
           % {"B": q(BK[6]), "B6": q(BK[6]), "F": q(F), "U": q(UPD.isoformat()), "L": q(LKD.isoformat()), "S3": q(S3.isoformat()), "FY": q(FY.isoformat())})
    if text:
        db.sql("alter table tally_check_days add column prio text")
        r = st.psql_text(text); ok(r.returncode != 0 and "column tally_check_days.prio (not smallint)" in r.stderr, "the guard stops it over an existing column of another type (%s)" % r.stderr.strip()[-100:])
        db.sql("alter table tally_check_days drop column prio")
    if text:
        h = {fn: db.one("select md5(prosrc) from pg_proc where oid = 'public.%s'::regprocedure" % fn) for fn in ("tally_check_next_open(uuid,integer)", "tally_check_heads(uuid,date,jsonb,text)", "tally_recorder_fetching_sweep(integer)")}
        ok(all(v in text for v in h.values()), "the guard knows the md5s the stand runs (staging's, read 24-Nov-2026) (%s)" % h)
        for i in (1, 2):
            r = st.psql_text(text); ok(r.returncode == 0, "runs (%s time)%s" % ("first" if i == 1 else "second", "" if not r.returncode else ": " + r.stderr[-300:]))
        db.sql("comment on function public.tally_check_next_open(uuid, integer) is null")
        r = st.psql_text(text); ok(r.returncode != 0 and "tally_check_next_open(uuid,integer) (not the text staging runs)" in r.stderr, "the guard stops it over a tally_check_next_open that is not staging's (%s)" % r.stderr.strip()[-120:])
        db.sql("comment on function public.tally_check_next_open(uuid, integer) is 'tally autoday (migration 222)'")
        db.sql("create function public.tally_autoday_fy(p_x int) returns int language sql as 'select 1'")
        r = st.psql_text(text); ok(r.returncode != 0 and "function tally_autoday_fy" in r.stderr, "the name guard stops it over another tally_autoday_fy")
        db.sql("drop function public.tally_autoday_fy(int)")
        ok(db.one("select string_agg(jobname || ' ' || schedule, ', ' order by jobname) from cron.job where jobname like 'tally-autoday%'") == "tally-autoday 3-59/15 * * * *, tally-autoday-night 37 18 * * *", "the jobs (pg_cron runs in UTC: 18:37 is 00:07 India time)")
        db.sql("update cron.job set command = 'select something_else()' where jobname = 'tally-autoday-night'")
        r = st.psql_text(text); ok(r.returncode != 0 and "cron job tally-autoday" in r.stderr, "the guard stops it over a job of its name that runs something else")
        db.sql("update cron.job set command = 'select public.tally_autoday_sweep()' where jobname = 'tally-autoday-night'")
    def can(fn, role):
        try: return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q(fn)))
        except RuntimeError: return None
    ok(can("public.tally_autoday_queue(uuid)", "service_role") == "t" and can("public.tally_autoday_queue(uuid)", "authenticated") == "f" and can("public.tally_autoday_queue(uuid)", "anon") == "f", "the queue: service_role only")
    ok(can("public.tally_autoday_sweep()", "service_role") == "f" and can("public.tally_autoday_sweep()", "authenticated") == "f", "the sweep: nobody's")
    ok(can("public.tally_check_heads(uuid,date,jsonb,text,jsonb)", "service_role") == "t" and can("public.tally_check_heads(uuid,date,jsonb,text,jsonb)", "anon") == "f", "the 5-argument heads: service_role only")
    ok(can("public.tally_autoday_pickup(uuid,date,text)", "service_role") == "t" and can("public.tally_autoday_pickup(uuid,date,text)", "authenticated") == "f", "the pickup: service_role only")

    def sq(x):
        try: db.sql(x); return True
        except RuntimeError as e:
            if not RED: raise
            return False
    queue = lambda k: j("select tally_autoday_queue(%s)::text" % q(BK[k]))
    cday = lambda k, d: (db.rows("select source, coalesce(to_jsonb(x) ->> 'prio', '') as prio, (done_at is not null)::text as done, (upload_at is not null)::text as up, coalesce(to_jsonb(x) ->> 'tries', '') as tries, "
                                 "coalesce(to_jsonb(x) ->> 'next_at', '') as next_at, coalesce(to_jsonb(x) ->> 'last_why', '') as why, coalesce(to_jsonb(x) ->> 'parked_at', '') as parked, coalesce(upload_words, '') as words "
                                 "from tally_check_days x where book_id = %s and day = %s" % (q(BK[k]), q(d.isoformat()))) or [{}])[0]
    def nxt(k, mx=10):
        r = j("select tally_check_next_open(%s, %d)::text" % (q(BK[k]), mx))
        return [x.get("day") for x in r] if isinstance(r, list) else ["error: %s" % r]
    d8 = lambda d: d.strftime("%Y%m%d")
    LN = 0
    def line(k, d, ev="altered", guid="g", ago="1 hour", state="fetching"):
        global LN; LN += 1
        db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, received_at, state, vch_date, object_guid) values (%s, 'c%d', %s, %s, %s, %s, now() - interval %s, %s, %s, %s) "
               % (q(F), k, q(BK[k]), q(DA), q("ln-%d" % LN), q(ev), q(ago), q(state), q(d.isoformat()), q(None if guid is None else "%s-%d" % (CG[k], LN))))
        return db.one("select max(id) from tally_recorder_lines")
    def unask(k): db.sql("update tally_check_days set asked_at = now() - interval '16 minutes' where book_id = %s" % q(BK[k]))

    print("== 1. each source with its prio, the hand-out by prio")
    db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s) on conflict do nothing" % (q(BK[1]), q(F)))
    line(1, D(3))                                           # a stuck line: held
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'fill'), (%s, %s, %s, 'gap')" % (q(BK[1]), q(F), q(D(1).isoformat()), q(BK[1]), q(F), q(D(2).isoformat())))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, gone1, gone1_at) values (%s, %s, %s, 'check', '[\"x\"]'::jsonb, now())" % (q(BK[1]), q(F), q(D(4).isoformat())))
    line(1, D(5), ago="3 days")
    # it came 7 days ago dated D(5) (then in the future; the line's own trigger queues no future day): now due
    db.sql("set session_replication_role = replica; update tally_recorder_lines set received_at = now() - interval '7 days' where book_id = %s and vch_date = %s; delete from tally_check_days where book_id = %s and day = %s"
           % (q(BK[1]), q(D(5).isoformat()), q(BK[1]), q(D(5).isoformat())))
    r = queue(1)
    got = {n: (cday(1, D(n)).get("source"), cday(1, D(n)).get("prio")) for n in (1, 2, 3, 4, 5)}
    ok(got == {1: ("fill", "5"), 2: ("gap", "3"), 3: ("held", "1"), 4: ("check", "2"), 5: ("future", "4")}, "held 1, a first list's lack (delete) 2, gap 3, future 4, fill 5 (%s; %s)" % (got, r))
    ok(nxt(1) == [d8(D(n)) for n in (3, 4, 2, 5, 1)], "handed by prio, then the newest day (%s)" % nxt(1))
    sq("update tally_check_days set source = 'check', prio = 5, gone1 = null where book_id = %s and day = %s" % (q(BK[1]), q(D(4).isoformat())))
    db.sql("update tally_devices set recorder_source = 'alterid' where id = %s" % q(DA))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, done_at, listed_at, lists, via) values (%s, %s, %s, 'check', now() - interval '2 days', now() - interval '2 days', 2, 'day')" % (q(BK[1]), q(F), q(D(6).isoformat())))
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno) values (%s, %s, 'gv-6', %s, 9, 'Sales', '6')" % (q(BK[1]), q(F), q(D(6).isoformat())))
    # (its version row: written by tally_vouchers' own trigger, seen now)
    queue(1); c = cday(1, D(6))
    ok(c.get("source") == "delete" and c.get("prio") == "2" and c.get("done") == "false", "an AlterID-only book: a day with an entry altered in 7 days opened again for deletes, prio 2 (%s)" % c)
    db.sql("update tally_check_days set done_at = now(), listed_at = now() where book_id = %s and day = %s" % (q(BK[1]), q(D(6).isoformat())))
    queue(1); ok(cday(1, D(6)).get("done") == "true", "once a day: listed in the last 20 hours, not opened again")
    db.sql("update tally_devices set recorder_source = 'addon' where id = %s" % q(DA))

    print("== 2. parked when unlinked, back when linked")
    db.sql("update tally_links set state = 'unlinked' where book_id = %s" % q(BK[1]))
    queue(1)
    ok(cday(1, D(1)).get("parked") != "" and nxt(1) == [], "unlinked: its days parked, none handed (%s)" % nxt(1))
    t = j("select tally_tell_of(%s)::text" % q(BK[1]))
    ok((t.get("cause") or {}).get("code") == "not_linked" and (t.get("days") or {}).get("n") == 0, "the book says Link, its parked days not counted (%s)" % t.get("days"))
    db.sql("update tally_links set state = 'linked' where book_id = %s" % q(BK[1]))
    queue(1); unask(1)
    ok(cday(1, D(1)).get("parked") == "" and len(nxt(1)) == 5, "linked again: un-parked and handed (%s)" % nxt(1))

    print("== 3. a 2 s stop: retried by itself; a person's Stop stays")
    k = 2; db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s)" % (q(BK[k]), q(F)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held'), (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat()), q(BK[k]), q(F), q(D(2).isoformat())))
    ch = db.one("select chosen_at::text from tally_check_runs where book_id = %s" % q(BK[k]))
    waits = []
    for i in range(4):
        r = j("select tally_check_stop(%s, %s, 'over2s', 'FinCom stopped reading. Please upload the Day Book.', %s)::text" % (q(BK[k]), q(D(1).isoformat()), q(ch)))
        waits.append(db.one("select round(extract(epoch from (next_at - now())) / 3600)::text from tally_check_days where book_id = %s and day = %s" % (q(BK[k]), q(D(1).isoformat()))))
    run = db.rows("select state, coalesce(stop_why, '') as why from tally_check_runs where book_id = %s" % q(BK[k]))[0]
    ok(waits == ["1", "3", "24", "24"] and run["state"] == "going", "each stop: the day waits 1 h, 3 h, 24 h, 24 h; the check stays going (%s, %s)" % (waits, run))
    c = cday(k, D(1)); ok(c.get("tries") == "4" and c.get("why") == "over2s", "its tries and why kept (%s)" % c)
    ok(nxt(k) == [d8(D(2))], "while it waits it is not handed; the other days go on (%s)" % nxt(k))
    sq("update tally_check_days set next_at = now() - interval '1 minute' where book_id = %s and day = %s" % (q(BK[k]), q(D(1).isoformat()))); unask(k)
    ok(nxt(k) == [d8(D(1)), d8(D(2))], "its time come: handed again by itself (%s)" % nxt(k))
    # 3325's: a run a bridge stopped before 222 (over2s, 2 hours ago): going again by itself
    k = 3; db.sql("insert into tally_check_runs (book_id, firm_id, state, stopped_at, stop_day, stop_why, stop_words) values (%s, %s, 'stopped', now() - interval '2 hours', %s, 'over2s', 'FinCom stopped reading from Tally. Please upload the Day Book.')" % (q(BK[k]), q(F), q(D(2).isoformat())))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held'), (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat()), q(BK[k]), q(F), q(D(2).isoformat())))
    s0 = j("select tally_check_status_of(%s)::text" % q(BK[k]))
    ok("upload" not in str((s0.get("run") or {}).get("words")).lower() and (s0.get("run") or {}).get("words") == "Tally was slow for %s. FinCom tries it again by itself." % D(2).strftime("%d-%b-%Y"), "the status of a run a bridge stopped never asks for an upload (%s)" % (s0.get("run") or {}).get("words"))
    queue(k)
    run = db.rows("select state from tally_check_runs where book_id = %s" % q(BK[k]))[0]; c = cday(k, D(2))
    ok(run["state"] == "going" and c.get("tries") == "1" and nxt(k) == [d8(D(1)), d8(D(2))], "stopped 2 hours ago by the bridge: going again, its day's hour over: both handed (%s, %s, %s)" % (run, c.get("tries"), nxt(k)))
    # a person's Stop
    k = 4; db.sql("insert into tally_check_runs (book_id, firm_id, state, stopped_at, stop_why) values (%s, %s, 'stopped', now() - interval '3 days', 'person')" % (q(BK[k]), q(F)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat())))
    queue(k)
    ok(db.one("select state from tally_check_runs where book_id = %s" % q(BK[k])) == "stopped" and nxt(k) == [], "a person's Stop of the check: stays stopped, nothing handed (%s)" % nxt(k))
    k = 5; db.sql("insert into tally_check_runs (book_id, firm_id, chosen_at) values (%s, %s, now() - interval '3 days')" % (q(BK[k]), q(F)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat())))
    db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, state, chosen_at, stopped_at, stop_why) values (%s, %s, %s, 'stopped', now() - interval '2 days', now() - interval '1 day', 'person')" % (q(BK[k]), q(F), q(FY.isoformat())))
    queue(k)
    ok(nxt(k) == [] and db.one("select state from tally_period_pulls where book_id = %s" % q(BK[k])) == "stopped", "a person's Stop of the period: stays stopped, nothing handed (%s)" % nxt(k))
    db.sql("update tally_period_pulls set stop_why = 'over2s', stopped_at = now() - interval '30 minutes' where book_id = %s" % q(BK[k]))
    queue(k)
    ok(db.one("select state from tally_period_pulls where book_id = %s" % q(BK[k])) == "stopped" and nxt(k) == [d8(D(1))], "a period a bridge stopped 30 minutes ago: still waiting, the check's days handed (%s)" % nxt(k))
    db.sql("update tally_period_pulls set stopped_at = now() - interval '61 minutes' where book_id = %s" % q(BK[k]))
    queue(k)
    p = db.rows("select state, coalesce(to_jsonb(x) ->> 'auto_tries', '') as n from tally_period_pulls x where book_id = %s" % q(BK[k]))[0]
    ok(p == {"state": "going", "n": "1"}, "after its hour: started again by itself (%s)" % p)
    queue(2); p = db.rows("select state, part, fy_start::text as fy, (chosen_at < now() - interval '2 days')::text as at_link from tally_period_pulls where book_id = %s" % q(BK[2]))
    ok(p == [{"state": "going", "part": "year", "fy": FY.isoformat(), "at_link": "true"}], "a linked book with no period: one started by itself, at its link time (%s)" % p)
    # pickups
    k = 6; db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s)" % (q(BK[k]), q(F)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat())))
    r = j("select tally_autoday_pickup(%s, %s, 'tallyClosed')::text" % (q(BK[k]), q(D(1).isoformat()))); c = cday(k, D(1))
    ok(c.get("why") == "tallyClosed" and c.get("next_at") == "" and c.get("tries") == "0", "a pickup refused 'tallyClosed': kept, no wait (%s)" % c)
    r = j("select tally_autoday_pickup(%s, %s, 'dayRetry')::text" % (q(BK[k]), q(D(1).isoformat()))); c = cday(k, D(1))
    ok(c.get("why") == "dayRetry" and c.get("next_at") != "" and c.get("tries") == "1" and r.get("retryAt"), "a pickup refused 'dayRetry': waits an hour (%s)" % r)
    r = j("select tally_autoday_pickup(%s, %s, 'started')::text" % (q(BK[k]), q(D(1).isoformat())))
    ok(cday(k, D(1)).get("why") == "", "'started': the why cleared")
    r = j("set fincom.role = 'anon'; select tally_autoday_pickup(%s, %s, 'slow')::text" % (q(BK[k]), q(D(1).isoformat())))
    ok("_error" in r and "not allowed" in r["_error"], "the pickup refuses anyone but the service role")

    print("== 4. a future-dated line: on its own date, not before")
    k = 7; db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s)" % (q(BK[k]), q(F)))
    line(k, TODAY + datetime.timedelta(days=2), ago="1 hour")
    queue(k)
    ok(db.one("select count(*) from tally_check_days where book_id = %s" % q(BK[k])) == "0" and nxt(k) == [], "dated in 2 days: nothing queued yet")
    db.sql("set session_replication_role = replica; update tally_recorder_lines set vch_date = %s, received_at = now() - interval '3 days' where book_id = %s" % (q(TODAY.isoformat()), q(BK[k])))   # its date come (no trigger runs then)
    queue(k); c = cday(k, TODAY)
    ok(c.get("source") == "future" and c.get("prio") == "4" and nxt(k) == [d8(TODAY)], "its date come: queued 'future', prio 4, handed (%s)" % c)

    print("== 5. days before the book's first day (B.8)")
    k = 8; db.sql("insert into tally_check_runs (book_id, firm_id) values (%s, %s)" % (q(BK[k]), q(F)))
    E = PFY + datetime.timedelta(days=30); fy0 = "%d-%02d" % (PFY.year, (PFY.year + 1) % 100)
    lid = line(k, E, ago="2 hours")
    queue(k); c9 = (db.rows("select source, coalesce(to_jsonb(x) ->> 'prio', '') as prio from tally_check_days x where book_id = %s and day = %s" % (q(BK[9]), q(E.isoformat()))) or [{}])[0]
    ok(c9 == {"source": "held", "prio": "1"} and db.one("select state from tally_recorder_lines where id = %s" % lid) == "fetching" and d8(E) not in nxt(k),
       "the client's earlier book: the day queued there (held, prio 1), never into this book (%s, %s)" % (c9, nxt(k)))
    db.sql("update tally_check_days set done_at = now(), listed_at = now(), via = 'day', lists = 2 where book_id = %s and day = %s" % (q(BK[9]), q(E.isoformat())))
    queue(k); r = db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where id = %s" % lid)[0]
    ok(r == {"state": "stale", "why": "Read into the %s book from Tally." % fy0}, "that day read there after the line: the line closed (%s)" % r)
    db.sql("delete from tally_check_days where book_id = %s; delete from tally_books where book_id = %s" % (q(BK[9]), q(BK[9])))
    lid = line(k, E + datetime.timedelta(days=1), ago="2 hours")
    queue(k); r = db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where id = %s" % lid)[0]
    ok(r == {"state": "stale", "why": "Made in Tally in %s, a year FinCom does not keep." % fy0}, "no book for that year: 'stale', with its words (%s)" % r)
    queue(k); t = j("select tally_tell_of(%s)::text" % q(BK[k]))
    ok(not [d for d in nxt(k) if d < d8(FY)] and (t.get("days") or {}).get("n") == 0 and db.one("select state from tally_recorder_lines where id = %s" % lid) == "stale", "never handed or counted in this book, never retried (%s, %s)" % (nxt(k), t.get("days")))
    t = j("select tally_tell_of(%s)::text" % q(BK[k]))
    ok((t.get("earlier") or {}).get("fy") == fy0, "the book's line says it once (221's earlier: %s)" % t.get("earlier"))

    print("== 6. the daily fetching sweep")
    k = 6
    old = line(k, D(9), ago="9 days")
    db.sql("insert into tally_recorder_tries (line_row, book_id, first_at) values (%s, %s, now() - interval '8 days')" % (old, q(BK[k])))
    j("select tally_recorder_fetching_sweep(100)::text")
    ok(db.one("select state from tally_recorder_lines where id = %s" % old) == "fetching", "7 days of tries, its day never listed: stays 'fetching'")
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, listed_at, lists, via) values (%s, %s, %s, 'held', now() - interval '1 day', 1, 'day') on conflict (book_id, day) do update set listed_at = excluded.listed_at, via = 'day'" % (q(BK[k]), q(F), q(D(9).isoformat())))
    j("select tally_recorder_fetching_sweep(100)::text")
    ok(db.one("select state from tally_recorder_lines where id = %s" % old) == "stale", "its day listed after it came: closed as 196 does")

    print("== 7. the delete guards")
    k = 3
    def V(guid, alter, d, no="1", fid=None):
        return {"guid": guid, "alter": alter, "type": "Payment", "no": no, "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": fid, "day": d.isoformat()}
    def LNS(vs): return [x for v in vs for x in [[v["guid"], "Made-up Traders", -118.0, "", None, []], [v["guid"], "Bank", 118.0, "", None, []]]]
    DD = D(20)
    vs = [V(G(k, 101), 501, DD, "1"), V(G(k, 102), 502, DD, "2"), V(G(k, 103), 503, DD, "3", fid="FC-3"), V(G(k, 104), 504, DD, "4")]
    r = j("select tally_ingest_day(%s, %s, %s, %s, %d, 504, 0)::text" % (q(BK[k]), q(DD.isoformat()), js(vs), js(LNS(vs)), len(vs)))
    db.sql("update tally_vouchers set fincom_id = 'FC-3' where book_id = %s and guid = %s" % (q(BK[k]), q(G(k, 103))))
    JID = "00000000-0000-4000-8000-000000222003"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status, updated_at) values (%s, %s, 'c3', %s, '{}'::jsonb, 1, 'done', now() - interval '2 minutes')" % (q(JID), q(F), q(CO(k))))
    db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, accepted_at) values (%s, 'c3', 'FC-3', %s, 'FC-3', now() - interval '3 minutes')" % (q(F), q(JID)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'delete') on conflict do nothing" % (q(BK[k]), q(F), q(DD.isoformat())))
    live = lambda: [r_["guid"][-3:] for r_ in db.rows("select guid from tally_vouchers where book_id = %s and day = %s and deleted_at is null order by guid" % (q(BK[k]), q(DD.isoformat())))]
    H = lambda mids: [[G(k, m), m, 400 + m, "Payment"] for m in mids]
    age = lambda: db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(BK[k]), q(DD.isoformat())))
    heads5 = lambda mids, bands: j("select tally_check_heads(%s, %s, %s, 'bands', %s)::text" % (q(BK[k]), q(DD.isoformat()), js(H(mids)), js(bands)))
    ok(live() == ["065", "066", "067", "068"], "(step) four entries in the copy (%s; %s)" % (live(), r))
    # a list in bands with a hole (101-149 never came back): nothing deleted, however many lists
    hole = [[1, 100], [150, None]]
    for i in range(3): heads5([101], hole); age()
    ok(live() == ["065", "066", "067", "068"], "a list in bands with a hole: nothing deleted, three lists on (%s)" % live())
    ok(cday(k, DD).get("up") == "false", "and never given up to an upload")
    # whole bands: the first list marks, the second a minute later deletes, but not FinCom's posting settled 2 minutes ago
    whole = [[1, 100], [101, 300], [301, None]]
    db.sql("update tally_check_days set gone1 = null, gone1_at = null where book_id = %s and day = %s" % (q(BK[k]), q(DD.isoformat())))
    r1 = heads5([101], whole)
    ok(live() == ["065", "066", "067", "068"] and r1.get("bandsWhole") is True, "whole bands, the first list: nothing deleted yet (%s)" % r1)
    r2 = heads5([101], whole)
    ok(live() == ["065", "066", "067", "068"], "the second list under a minute later: nothing deleted (%s)" % live())
    age(); r3 = heads5([101], whole)
    ok(live() == ["065", "067"], "a minute later: the plain entries deleted, FinCom's posting settled 2 minutes ago kept (%s; %s)" % (live(), r3))
    db.sql("update tally_post_jobs set updated_at = now() - interval '11 minutes' where id = %s; update tally_post_ids set accepted_at = now() - interval '12 minutes' where job_id = %s" % (q(JID), q(JID)))
    age(); heads5([101], whole)
    ok(live() == ["065"], "settled 10 minutes ago: deleted on the next list (%s)" % live())
    db.sql("update tally_post_jobs set status = 'running', updated_at = now() - interval '1 hour' where id = %s" % q(JID))
    vs2 = [V(G(k, 105), 505, DD, "5", fid="FC-3")]
    j("select tally_ingest_day(%s, %s, %s, %s, 5, 505, 0)::text" % (q(BK[k]), q(DD.isoformat()), js(vs + vs2), js(LNS(vs + vs2))))
    db.sql("update tally_vouchers set deleted_at = case when guid in (%s, %s) then null else deleted_at end, fincom_id = case when guid = %s then 'FC-3' else fincom_id end where book_id = %s" % (q(G(k, 101)), q(G(k, 105)), q(G(k, 105)), q(BK[k])))
    db.sql("update tally_check_days set done_at = null, gone1 = null, gone1_at = null where book_id = %s and day = %s" % (q(BK[k]), q(DD.isoformat())))
    heads5([101], whole); age(); heads5([101], whole)
    ok("069" in live(), "a posting still going: its entry not deleted (%s)" % live())
    # an unfinished day: six lists that never close it: it waits, never asks for an upload
    k2 = 1; UD = D(25)
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, lists) values (%s, %s, %s, 'check', 5)" % (q(BK[k2]), q(F), q(UD.isoformat())))
    j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(BK[k2]), q(UD.isoformat()), js([["g-unknown", 9, 9, "Payment"]])))
    c = cday(k2, UD)
    ok(c.get("up") == "false" and c.get("why") == "unfinished" and c.get("next_at") != "" and "upload" not in c.get("words", "").lower(), "an unfinished day after 6 lists: waits, never 'upload the Day Book' (%s)" % c)

    print("== 9. a slow day of the period (197's tally_period_day_stop): waits, never 'upload'")
    k = 7; SD = D(30)
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'check') on conflict do nothing" % (q(BK[k]), q(F), q(SD.isoformat())))
    pstop = lambda: j("select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(BK[k]), q(SD.isoformat())))
    wait_h = lambda: db.one("select round(extract(epoch from (retry_at - now())) / 3600)::text from tally_period_day_retry where book_id = %s and day = %s" % (q(BK[k]), q(SD.isoformat())))
    over = lambda: db.sql("update tally_period_day_retry set retry_at = now() - interval '1 minute' where book_id = %s and day = %s" % (q(BK[k]), q(SD.isoformat())))
    seen9 = []
    for i in range(4):
        a9 = pstop(); seen9.append((a9.get("fails"), wait_h(), a9.get("upload"), a9.get("words"))); over()
    words9 = "Tally was slow for %s. FinCom tries it again by itself." % SD.strftime("%d-%b-%Y")
    ok([x[:2] for x in seen9] == [(1, "1"), (2, "3"), (3, "24"), (4, "24")], "each try after its wait: 1 h, 3 h, 24 h, 24 h (%s)" % seen9)
    ok(all(x[2] is False and x[3] == words9 for x in seen9), "never upload; said plainly: %r (%s)" % (words9, seen9[-1]))
    pdy = db.rows("select coalesce(upload_why, '') as why, (upload_at is not null)::text as up from tally_period_days where book_id = %s and day = %s" % (q(BK[k]), q(SD.isoformat())))
    c = cday(k, SD)
    ok(not [r_ for r_ in pdy if r_["up"] == "true"] and c.get("up") == "false" and c.get("next_at") != "" and c.get("why") == "over2s",
       "its 3rd and 4th try: the period's day not marked to upload, its check day waits (%s, %s)" % (pdy, c))
    a9 = pstop(); a10 = pstop()
    ok(a9.get("fails") == a10.get("fails") == 5, "two stops while it still waits: one try (%s, %s)" % (a9.get("fails"), a10.get("fails")))
    r9 = j("set fincom.role = 'anon'; select tally_period_day_stop(%s, %s, 'over2s')::text" % (q(BK[k]), q(SD.isoformat())))
    ok("_error" in r9, "anyone but the service role or an owner: refused, as 197")

    print("== 10. the review of 24-Nov-2026")
    c = cday(6, UPD); cl = cday(6, LKD)
    ok(c.get("up") == "false" and c.get("tries") == "1" and c.get("why") == "reopened" and c.get("words") == "" and db.one("select (lists = 0 and gone1 is null and next_at <= now())::text from tally_check_days where book_id = %s and day = %s" % (q(BK[6]), q(UPD.isoformat()))) == "true",
       "1. a day given up to an upload before 222: opened again once, tries 1, due now (%s)" % c)
    ok(cl.get("up") == "true", "1. a locked month's day: left for the unlock (%s)" % cl.get("words"))
    pd3 = db.rows("select (upload_at is null)::text as open, coalesce(upload_why, '') as why from tally_period_days where book_id = %s and day = %s" % (q(BK[6]), q(S3.isoformat())))
    ok(pd3 == [{"open": "true", "why": ""}] and db.one("select (retry_at <= now())::text from tally_period_day_retry where book_id = %s and day = %s" % (q(BK[6]), q(S3.isoformat()))) == "true", "1. the period's 'slow3' day: unmarked, retried now (%s)" % pd3)
    j("select tally_period_upload(%s, %s, 'shape', 'Payroll', 'Please upload the Day Book of that day.')::text" % (q(BK[6]), q(D(43).isoformat())))
    w = db.one("select upload_words from tally_period_days where book_id = %s and day = %s" % (q(BK[6]), q(D(43).isoformat())))
    ok(w == "FinCom could not read %s from Tally by itself." % D(43).strftime("%d-%b-%Y"), "1. tally_period_upload's words never ask for an upload (%r)" % w)
    print("  -- 2. a hand-out is never a try; a day held_queue_of opens again starts afresh")
    k = 4; db.sql("update tally_check_runs set state = 'going', stop_why = null where book_id = %s" % q(BK[k]))
    db.sql("delete from tally_check_days where book_id = %s" % q(BK[k]))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'held')" % (q(BK[k]), q(F), q(D(1).isoformat())))
    for i in range(3): nxt(k); db.sql("update tally_check_days set asked_at = now() - interval '11 minutes' where book_id = %s" % q(BK[k]))
    ok(cday(k, D(1)).get("tries") == "0", "handed three times, never answered: tries 0 (%s)" % cday(k, D(1)).get("tries"))
    ch4 = db.one("select chosen_at::text from tally_check_runs where book_id = %s" % q(BK[k]))
    j("select tally_check_stop(%s, %s, 'over2s', '', %s)::text" % (q(BK[k]), q(D(1).isoformat()), q(ch4)))
    ok(db.one("select round(extract(epoch from (next_at - now())) / 3600)::text from tally_check_days where book_id = %s" % q(BK[k])) == "1", "its first real stop waits 1 hour, not 24")
    db.sql("update tally_check_days set done_at = now(), listed_at = now() - interval '2 hours', via = 'day', lists = 1, tries = 3, next_at = now() + interval '20 hours', last_why = 'over2s' where book_id = %s" % q(BK[k]))
    line(k, D(1), ago="1 minute")
    queue(k); c = cday(k, D(1))
    ok(c.get("done") == "false" and c.get("tries") == "0" and c.get("next_at") == "" and c.get("why") == "", "a new line opens the day again: no tries, no wait carried over (%s)" % c)
    print("  -- 4. days before the book: only into a LINKED earlier book; the book's own closed")
    k = 8
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values ('819d4a59-4cee-4bf7-8f8c-000000099222', %s, 'c8', %s, %s)" % (q(F), q(CO(8)), q(PFY.isoformat())))
    E2 = PFY + datetime.timedelta(days=50)
    lid = line(k, E2, ago="2 hours")
    queue(k); r = db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where id = %s" % lid)[0]
    ok(r == {"state": "stale", "why": "Made in Tally in %s, a year FinCom does not keep." % fy0} and db.one("select count(*) from tally_check_days where book_id = '819d4a59-4cee-4bf7-8f8c-000000099222'") == "0",
       "an earlier book that is not linked: never queued there; the line closed with the words (%s)" % r)
    c = cday(k, E2)
    ok(c.get("done") in ("true", None) and (c == {} or c.get("why") == "before_book"), "the book's own day before its first day: closed 'before_book' (%s)" % c)
    print("  -- 6. delete hardening")
    k = 5; DE = D(50)
    vs6 = [V(G(k, 201), 601, DE, "21"), V(G(k, 202), 602, DE, "22"), V(G(k, 203), 603, DE, "23")]
    j("select tally_ingest_day(%s, %s, %s, %s, 3, 603, 0)::text" % (q(BK[k]), q(DE.isoformat()), js(vs6), js(LNS(vs6))))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'delete') on conflict do nothing" % (q(BK[k]), q(F), q(DE.isoformat())))
    live6 = lambda: [r_["guid"][-3:] for r_ in db.rows("select guid from tally_vouchers where book_id = %s and day = %s and deleted_at is null order by guid" % (q(BK[k]), q(DE.isoformat())))]
    age6 = lambda m: db.sql("update tally_check_days set gone1_at = now() - interval '%d minutes' where book_id = %s and day = %s" % (m, q(BK[k]), q(DE.isoformat())))
    empty = lambda: j("select tally_check_heads(%s, %s, '[]'::jsonb, 'day')::text" % (q(BK[k]), q(DE.isoformat())))
    empty(); age6(2); empty()
    ok(len(live6()) == 3, "the reviewer's case: two empty lists a minute apart delete nothing (%s)" % live6())
    age6(11); empty()
    ok(live6() == [], "a third empty list 10 minutes after: deleted (%s)" % live6())
    vs7 = [V(G(k, 204), 604, D(51), "24"), V(G(k, 205), 605, D(51), "25")]
    j("select tally_ingest_day(%s, %s, %s, %s, 2, 605, 0)::text" % (q(BK[k]), q(D(51).isoformat()), js(vs7), js(LNS(vs7))))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'delete') on conflict do nothing" % (q(BK[k]), q(F), q(D(51).isoformat())))
    db.sql("set session_replication_role = replica; insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, received_at, state, vch_date, object_guid) values (%s, 'c5', %s, %s, 'ln-held-205', 'altered', now(), 'fetching', %s, %s)"
           % (q(F), q(BK[k]), q(DA), q(D(51).isoformat()), q(G(k, 205))))
    hh = lambda: j("select tally_check_heads(%s, %s, %s, 'day')::text" % (q(BK[k]), q(D(51).isoformat()), js([[G(k, 999), 999, 9, "Payment"]])))
    hh(); db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(BK[k]), q(D(51).isoformat()))); hh()
    l7 = [r_["guid"][-3:] for r_ in db.rows("select guid from tally_vouchers where book_id = %s and day = %s and deleted_at is null order by guid" % (q(BK[k]), q(D(51).isoformat())))]
    ok(l7 == ["0cd"], "an entry with a recorder line still being brought: never deleted; the other is (%s)" % l7)
    print("  -- 5. 'bands' without its bands: as today (a whole list)")
    DB5 = D(52); vs8 = [V(G(k, 206), 606, DB5, "26"), V(G(k, 207), 607, DB5, "27")]
    j("select tally_ingest_day(%s, %s, %s, %s, 2, 607, 0)::text" % (q(BK[k]), q(DB5.isoformat()), js(vs8), js(LNS(vs8))))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'delete') on conflict do nothing" % (q(BK[k]), q(F), q(DB5.isoformat())))
    hb = lambda: j("select tally_check_heads(%s, %s, %s, 'bands', null)::text" % (q(BK[k]), q(DB5.isoformat()), js([[G(k, 206), 206, 606, "Payment"]])))
    hb(); db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(BK[k]), q(DB5.isoformat()))); hb()
    l8 = [r_["guid"][-3:] for r_ in db.rows("select guid from tally_vouchers where book_id = %s and day = %s and deleted_at is null order by guid" % (q(BK[k]), q(DB5.isoformat())))]
    ok(l8 == ["0ce"], "no bands sent (an older bridge): today's whole-list rule, the missing entry deleted on the second list (%s)" % l8)
    print("  -- 8. the daily re-check: up to 31 dates, the latest edits first")
    k = 9; db.sql("delete from tally_books where book_id = '819d4a59-4cee-4bf7-8f8c-000000099222'")
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%s, %s, 'c9', %s, %s) on conflict (book_id) do update set from_date = excluded.from_date, client_id = 'c9'" % (q(BK[k]), q(F), q(CO(k)), q(FY.isoformat())))
    db.sql("update tally_devices set recorder_source = 'alterid' where id = %s" % q(DA))
    for n in range(35):
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno) values (%s, %s, %s, %s, %d, 'Sales', %s)" % (q(BK[k]), q(F), q("rc-%d" % n), q(D(60 + n).isoformat()), 700 + n, q(str(n))))
    queue(k)
    ok(db.one("select count(*) from tally_check_days where book_id = %s and source = 'delete'" % q(BK[k])) == "31", "35 dates edited this week: 31 re-checked (%s)" % db.one("select count(*) from tally_check_days where book_id = %s and source = 'delete'" % q(BK[k])))
    db.sql("update tally_devices set recorder_source = 'addon' where id = %s" % q(DA))
    print("  -- 9. the period's auto_tries reset once it reads again")
    k = 5; db.sql("update tally_period_pulls set auto_tries = 2, state = 'going', chosen_at = now() - interval '1 hour' where book_id = %s" % q(BK[k]))
    db.sql("insert into tally_period_days (book_id, firm_id, day, tally_n, counted_at) values (%s, %s, %s, 1, now()) on conflict (book_id, day) do update set counted_at = now()" % (q(BK[k]), q(F), q(D(70).isoformat())))
    queue(k); ok(db.one("select auto_tries::text from tally_period_pulls where book_id = %s" % q(BK[k])) == "0", "a day counted after it started again: auto_tries 0")

    print("== 8. the words, the sweep")
    hs = j("select tally_held_status(null)::text", uid=OWNER, role="authenticated")
    hw = [b_.get("check", {}).get("words") for b_ in hs.get("books", [])]
    ok(hs.get("ok") is True and not [w for w in hw if w and "upload" in w.lower()], "tally_held_status never asks for an upload (%s)" % json.dumps(hs)[:300])
    ok(not [w for w in re.findall(r"'([^']*)'", block(text, "tally_check_stop")) if "upload" in w.lower()], "the stop's words lose 'Please upload the Day Book'")
    r = j("select tally_autoday_sweep()::text")
    ok(r.get("ok") is True and r.get("books", 0) >= 8 and not r.get("booksFailed"), "the sweep: every book in its own block (%s)" % r)
finally:
    bye()
print("\n%s: %d failed" % ("FAILED" if fails else "PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
