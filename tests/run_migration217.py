"""python3 run_migration217.py - migration-217-gap-older-reading (23-Nov-2026, branch next-fix-false-errors). Staging,
23-Nov-2026, a client's TDS page: "Changes were made in Tally on older dates. Upload the Day Book from 01-Apr-2026 to today."
while FinCom was reading those older days from Tally by itself (182's recount of the year's days counted before Tally's
number now was seen, and From Tally's older days as light days), its computer's switch for older entries on.
On a throwaway PostgreSQL (pg_stand, port 31217 unless PG217_PORT; data under TMPDIR; never a real database), built as
run_migration182.py builds it, then 182, 214 (its tally_gap_front as live on staging) and 216 (on 146's claims), then 217
(twice). Made-up books only. Written before the file.
Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only, names no real database; one function, 182's arguments; its
     grant (service_role only); runs twice; refuses (changing nothing) a tally_gap_state that is not 182's or 217's.
  1. the gap's own days match, the period going, days of its year counted before Tally's number was seen, a computer
     reading older entries: checking (checkUntil an hour on), older kept with reading: true.
  2. (guard) every day of the year counted since that number (the recount done): older, the upload asked, as 182.
  3. (guard) no computer reads older entries, or the period paused, or the check stopped by a person: as 182.
  4. From Tally's older days (fill) not read since that number: checking; once read whole: as 182. A day marked to
     upload (a locked month) is not read by itself.
  5. (guard) no period, no fill days: 182's words exactly.
  6. (review, 23-Nov-2026) From Tally's older days read whole, then Tally's number moves: tally_gap_front does not hand
     them out again, so the gap does not say it reads them (as 182); a day asked after it and not handed yet: reading.
  7. the reader away (not seen for 10 minutes) while a second computer, its switch off, keeps beating: as 182; the reader
     online but nothing read (checked or counted) for an hour, beats only: as 182; checkUntil an hour after the last read.
  8. the hard cap: 6 hours after Tally's number was first seen, as 182 whatever is still read; before it, checkUntil at
     most the 6 hours.
RED_WITHOUT_217=1: the same checks without the file (1 and 4 fail; the guards pass)."""
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
M = os.path.join(SQLDIR, "migration-182-gap-after-post.sql")
# as live on staging (24-Nov-2026): 214's tally_gap_front (next-fix-light-days; its text the same as staging's, md5 below) and
# 216's beat (tally_held_light, tally_work_claim; on migration 146's claims), after 182
M214 = os.path.join(HERE, "fixtures", "migration-214-as-run-on-staging.sql")
M216 = os.path.join(SQLDIR, "migration-216-beat-light.sql")
M217 = os.environ.get("M217_FILE") or os.path.join(SQLDIR, "migration-217-gap-older-reading.sql")
RED = os.environ.get("RED_WITHOUT_217") == "1"
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

text = open(M).read()
m217 = open(M217).read() if os.path.exists(M217) and not RED else ""
ok(bool(m217) or RED, "the migration file is there (%s)" % os.path.basename(M217))
low = m217.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
if m217:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M217), hashlib.md5(m217.encode()).hexdigest(), len(m217.encode())))
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", m217, re.M) is not None and m217.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    ok("delete from" not in code and not re.search(r"\b(drop|truncate|alter\s+table|insert\s+into|update\s+public)\b", code) and "create table" not in code, "0. add-only: no table, row or other change")
    ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
    ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", m217))) == ["tally_gap_state"], "0. one function: tally_gap_state")
    ok("revoke all on function public.tally_gap_state(uuid, jsonb, timestamptz) from public, anon, authenticated;" in m217 and "grant execute on function public.tally_gap_state(uuid, jsonb, timestamptz) to service_role;" in m217, "0. its grant restated (service_role)")
    ok("security definer set search_path = public, pg_temp" in low, "0. security definer, search_path public, pg_temp")
db = pg_stand.start(int(os.environ.get("PG217_PORT") or 31217))
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
def gap(book, alt, dev=None):
    r = j("select tally_recorder_gap_check(%s, %s, %d, now())::text" % (q(book), q(dev or DV), alt))
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
def repace(book):      # the 25 s between light days passed, and the 10 minutes a light day not picked up holds the next
    if text: db.sql("update tally_light_pace set last_at = now() - interval '11 minutes' where book_id = %s" % q(book))
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
    r = psql_text(text)
    if r.returncode: ok(False, "182 runs: %s" % r.stderr[-300:]); raise SystemExit("cannot go on")
    r = psql_text(open(M214).read())
    ok(r.returncode == 0, "214 runs after 182: %s" % r.stderr[-300:])
    ok(db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_gap_front(uuid, integer, boolean)'::regprocedure") == "1f0653e721d3f0683d6c09dbe28056c1", "(step) tally_gap_front is 214's, as live on staging")
    s146 = open(os.path.join(SQLDIR, "migration-146-reads-follow-company.sql")).read()
    i = s146.index("create table if not exists public.tally_work_claims"); k = s146.index(";", s146.index("create index if not exists tally_work_claims_live")) + 1
    i2 = s146.index("create or replace function public.tally_work_claim("); k2 = s146.index("end $function$;", i2) + len("end $function$;")
    db.sql("""create table if not exists tally_links (firm_id uuid, book_id uuid, state text);
      create table if not exists tally_bridge_ids (firm_id uuid, bridge_id text, device_id uuid);
      do $$ begin if to_regprocedure('public.tally_bridge_device(uuid, text)') is null then
        create function tally_bridge_device(p_firm uuid, p_bridge text) returns uuid language sql stable as $b$ select device_id from tally_bridge_ids where firm_id = p_firm and bridge_id = p_bridge $b$;
      end if; end $$;""")
    db.sql(s146[i:k]); db.sql(s146[i2:k2])
    r = psql_text(open(M216).read())
    ok(r.returncode == 0, "216 runs after 182 and 214: %s" % r.stderr[-300:])
    if m217:
        # the guard's md5 is 182's text as built here, and as on staging (read 23-Nov-2026, after 214 and 216: unchanged)
        h182 = db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_gap_state(uuid, jsonb, timestamptz)'::regprocedure")
        ok(h182 == "30ccba4666af31bcb0a958b304e9f249" and ("<> '%s'" % h182) in m217, "0. the guard's md5 is 182's text (%s)" % h182)
        for i in (1, 2):
            r = psql_text(m217)
            ok(r.returncode == 0, "217 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))

    def own_matched(k, period=None, counted_ago=None):
        """a made-up book whose gap's own day was read and matches Tally (182's C); optionally its period going (period:
        its first day) with every day of that year counted counted_ago ('6 days': before Tally's number was seen)"""
        book, cg = gapbook(k)
        if period:
            db.sql("insert into tally_period_pulls (book_id, firm_id, fy_start, part, state, chosen_at) values (%s, %s, %s, 'year', 'going', now() - interval '6 days')" % (q(book), q(F), q(period.isoformat())))
            if counted_ago:
                db.sql("""insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at)
                          select %s, %s, g::date, 0, 0, '[]'::jsonb, 'day', now() - interval %s, now() - interval %s
                            from generate_series(%s::date, %s::date, interval '1 day') g""" % (q(book), q(F), q(counted_ago), q(counted_ago), q(period.isoformat()), q(D(0))))
        r, c = gap(book, 42873); age_gap(book, 3); unask(book); FRONT(book, 3, False)
        h = HEADS(book, 0, [])
        ok(h.get("done") is True, "(step) book %d: the gap's own day read, it matches Tally (%s)" % (k, h))
        r, c = gap(book, 42873)
        return book, c["g"]
    o182 = lambda g, fy: g.get("checking") is False and "checkUntil" not in g and g.get("older") == {"from": fy.isoformat(), "say": "Changes were made in Tally on older dates.", "fix": "Upload the Day Book from %s to today." % DMY(fy)}
    soon = lambda g: bool(g.get("checkUntil")) and db.one("select (%s::timestamptz between now() + interval '50 minutes' and now() + interval '61 minutes')::text" % q(g["checkUntil"])) == "true"

    print("== 1. the year's days to be counted again: FinCom reads them by itself")
    book, g = own_matched(1, FY, "6 days")
    o = g.get("older") or {}
    ok(g.get("checking") is True and soon(g), "1. checking, until an hour on (%s, %s)" % (g.get("checking"), g.get("checkUntil")))
    ok(o.get("from") == FY.isoformat() and o.get("reading") is True and o.get("say") == "Changes were made in Tally on older dates.", "1. older kept, with reading: true (%s)" % o)
    db.sql("update tally_period_days set counted_at = now() where book_id = %s and day <> %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True, "1. one day left to count again: still checking (%s)" % c["g"].get("checking"))
    db.sql("delete from tally_period_days where book_id = %s and day = %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True, "1. a day of the year never counted: checking (it is counted first)")

    print("== 2. (guard) the recount done: the upload asked, as 182")
    db.sql("""insert into tally_period_days (book_id, firm_id, day, tally_n, held_n, heads, via, counted_at, done_at) values (%s, %s, %s, 0, 0, '[]'::jsonb, 'day', now(), now())""" % (q(book), q(F), q(D(40))))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "2. every day counted since Tally's number was seen, nothing found: 182's words (%s)" % c["g"])
    db.sql("update tally_period_days set counted_at = now() - interval '6 days' where book_id = %s and day = %s" % (q(book), q(D(40))))
    db.sql("update tally_period_days set upload_at = now(), upload_why = 'locked' where book_id = %s and day = %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "2. the day left is marked to upload (a locked month): not read by itself, the upload asked (%s)" % c["g"].get("checking"))

    print("== 3. (guard) nothing reads by itself: as 182")
    book, g = own_matched(2, FY, "6 days")
    ok(g.get("checking") is True, "3. (step) the recount to come: checking")
    db.sql("update tally_devices set period_fetch = false where id = %s" % q(DV))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "3. no computer reads older entries for the company: the upload asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_devices set period_fetch = true where id = %s" % q(DV))
    db.sql("update tally_period_pulls set state = 'paused', paused_at = now() where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "3. older entries paused: the upload asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_period_pulls set state = 'stopped', stopped_at = now() where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "3. older entries stopped: the upload asked (%s)" % c["g"].get("checking"))
    db.sql("update tally_period_pulls set state = 'going', stopped_at = null, paused_at = null where book_id = %s" % q(book))
    db.sql("update tally_check_runs set state = 'stopped', stopped_at = now(), stop_why = 'person' where book_id = %s" % q(book))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "3. the check stopped by a person: the upload asked (%s)" % c["g"].get("checking"))

    print("== 4. From Tally's older days (fill): read by itself")
    book, g = own_matched(3)
    ok(o182(g, FY), "4. (step) no period, no days asked: 182's words")
    FILL = lambda days: j("select tally_fill_request('c3', array[%s]::date[])::text" % ", ".join(q(d) for d in days), OWNER, "authenticated")
    fl = FILL([D(40), D(41)])
    ok(sorted(light(book)) == [D(41), D(40)], "4. (step) From Tally's older days: light days of the book (%s)" % fl)
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True and soon(c["g"]) and (c["g"].get("older") or {}).get("reading") is True, "4. checking, older kept, reading (%s)" % c["g"])
    for n_ in (40, 41):
        db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
                  values (%(B)s, %(F)s, %(d)s, 'fill', now(), 1, 0, '[]'::jsonb, 'day', now(), true, now())
                  on conflict (book_id, day) do update set via = 'day', listed_at = now(), done_at = now(), upload_at = null""" % {"B": q(book), "F": q(F), "d": q(D(n_))})
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "4. both read whole since Tally's number was seen, nothing found: 182's words (%s)" % c["g"].get("checking"))
    db.sql("update tally_check_days set listed_at = now() - interval '10 days', done_at = now() - interval '10 days' where book_id = %s and day = %s" % (q(book), q(D(41))))
    db.sql("update tally_check_days set upload_at = now() where book_id = %s and day = %s" % (q(book), q(D(41))))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "4. (guard) the day left marked to upload: not read by itself (%s)" % c["g"].get("checking"))

    print("== 5. (guard) no period, no older days asked: 182's words exactly; 182's own checking untouched")
    book, g = own_matched(4)
    ok(o182(g, FY), "5. older, the upload asked (%s)" % g)
    book, cg = gapbook(5)
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True and "older" not in c["g"], "5. the gap's own day not read yet: checking, no older (182) (%s)" % c["g"].get("checking"))

    # the review of 23-Nov-2026: the state could stay on for ever (the fill days read before Tally's number moved counted as
    # unread; every beat wrote checkUntil an hour on; a reader away). 217 now says reading only for what tally_gap_front
    # (214) still hands out, until an hour after the last real read, a reader online, at most 6 hours from Tally's number
    first_at = lambda book: db.one("select first_at::text from tally_gap_numbers where book_id = %s" % q(book))
    def back(book, minutes):
        """Tally's number seen `minutes` ago (the gap opened a minute before it), and every read since then that long ago
        and a minute (so 182's own days stay read after it)"""
        db.sql("""update tally_sync_cursor set gap_at = now() - interval '%(m)d minutes' - interval '1 minute' where book_id = %(B)s;
                  update tally_gap_numbers set first_at = now() - interval '%(m)d minutes' where book_id = %(B)s;
                  update tally_check_days set listed_at = now() - interval '%(m)d minutes' + interval '1 minute' where book_id = %(B)s and listed_at is not null;
                  update tally_period_days set counted_at = now() - interval '%(m)d minutes' + interval '1 minute' where book_id = %(B)s and counted_at > now() - interval '1 day'""" % {"m": minutes, "B": q(book)})

    print("== 6. From Tally's older days read, then Tally's number moves (someone types): not read again, the upload asked")
    book, g = own_matched(6)
    FILL6 = lambda days: j("select tally_fill_request('c6', array[%s]::date[])::text" % ", ".join(q(d) for d in days), OWNER, "authenticated")
    FILL6([D(40), D(41)])
    def read_whole(book, ns):
        for n_ in ns:
            db.sql("""insert into tally_check_days (book_id, firm_id, day, source, queued_at, lists, tally_n, heads, via, listed_at, same, done_at)
                      values (%(B)s, %(F)s, %(d)s, 'fill', now(), 1, 0, '[]'::jsonb, 'day', now(), true, now())
                      on conflict (book_id, day) do update set via = 'day', listed_at = now(), done_at = now(), upload_at = null""" % {"B": q(book), "F": q(F), "d": q(D(n_))})
        db.sql("update tally_light_days set handed_at = now() - interval '1 hour' where book_id = %s and day = any (array[%s]::date[])" % (q(book), ", ".join(q(D(n_)) for n_ in ns)))
    read_whole(book, (40, 41))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "6. (step) both read whole: 182's words (%s)" % c["g"].get("checking"))
    f0 = first_at(book)
    r, c = gap(book, 42874); age_gap(book, 3); unask(book); FRONT(book, 3, False)
    h = HEADS(book, 0, [])
    r, c = gap(book, 42874)
    ok(first_at(book) != f0 and h.get("done") is True, "6. (step) Tally's number moved (first seen anew), the gap's own day read again (%s)" % h)
    handed = []
    for i in range(3):
        repace(book); db.sql("update tally_light_pace set idle_at = now() where book_id = %s" % q(book))
        handed += days_of(FRONT(book, 3, True))
    ok(not set(handed) & {D8(40), D8(41)}, "6. (step) tally_gap_front (214) does not hand the days read out again (%s)" % handed)
    r, c = gap(book, 42874)
    ok(o182(c["g"], FY), "6. so the gap does not say it reads them: the upload asked, as 182 (%s, %s)" % (c["g"].get("checking"), c["g"].get("older")))
    FILL6([D(42)])
    r, c = gap(book, 42874)
    ok(c["g"].get("checking") is True and (c["g"].get("older") or {}).get("reading") is True, "6. (guard) an older day asked after it, not handed yet: reading (%s)" % c["g"].get("checking"))
    read_whole(book, (42,))
    r, c = gap(book, 42874)
    ok(o182(c["g"], FY), "6. (guard) and read whole: the upload asked (%s)" % c["g"].get("checking"))

    print("== 7. the reader away while a second computer (its switch off) keeps beating; nothing read for an hour")
    DV2 = "dddddddd-0000-4000-8000-000000000217"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen) values (%s, %s, 'MADEUP-PC2', 'kh217', '{}'::jsonb, false, now()) on conflict do nothing" % (q(DV2), q(F)))
    book, g = own_matched(7, FY, "6 days")
    ok(g.get("checking") is True and (g.get("older") or {}).get("reading") is True, "7. (step) the recount to come, the reader online: reading (%s)" % g.get("checking"))
    db.sql("update tally_devices set last_seen = now() - interval '30 minutes' where id = %s" % q(DV))
    for i in range(3):
        db.sql("update tally_devices set last_seen = now() where id = %s" % q(DV2))
        r, c = gap(book, 42873, DV2)
    ok(o182(c["g"], FY), "7. the reader not seen for 30 minutes, the other computer beating: the upload asked (%s, %s)" % (c["g"].get("checking"), c["g"].get("checkUntil")))
    db.sql("update tally_devices set last_seen = now() where id = %s" % q(DV))
    r, c = gap(book, 42873)
    ok(c["g"].get("checking") is True and soon(c["g"]), "7. (guard) the reader back: reading again (%s)" % c["g"].get("checking"))
    back(book, 120)
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "7. the reader online but nothing read for over an hour (beats only): the upload asked (%s, %s)" % (c["g"].get("checking"), c["g"].get("checkUntil")))
    db.sql("update tally_period_days set counted_at = now() - interval '10 minutes' where book_id = %s and day = %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    cu = c["g"].get("checkUntil")
    ok(c["g"].get("checking") is True and cu and db.one("select (%s::timestamptz between now() + interval '49 minutes' and now() + interval '51 minutes')::text" % q(cu)) == "true",
       "7. (guard) a day counted 10 minutes ago: reading, until an hour after that read (%s)" % cu)

    print("== 8. the hard cap: at most 6 hours after Tally's number was first seen")
    book, g = own_matched(8, FY, "6 days")
    ok(g.get("checking") is True, "8. (step) reading (%s)" % g.get("checking"))
    back(book, 5 * 60 + 30)
    db.sql("update tally_period_days set counted_at = now() where book_id = %s and day = %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    cu = c["g"].get("checkUntil")
    ok(c["g"].get("checking") is True and cu and db.one("select (%s::timestamptz between now() + interval '29 minutes' and now() + interval '31 minutes')::text" % q(cu)) == "true",
       "8. (guard) 5 h 30 min on: reading, until the 6 hours (%s)" % cu)
    back(book, 7 * 60)
    db.sql("update tally_period_days set counted_at = now() where book_id = %s and day = %s" % (q(book), q(D(40))))
    r, c = gap(book, 42873)
    ok(o182(c["g"], FY), "8. 7 hours on, still reading a day a minute: the normal state, the upload asked (%s, %s)" % (c["g"].get("checking"), c["g"].get("older")))

    print("== 0. grants and the name guard")
    sig = "public.tally_gap_state(uuid, jsonb, timestamptz)"
    ex = lambda rl: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig))) in ("t", "true")
    ok(ex("service_role") and not ex("authenticated") and not ex("anon"), "0. tally_gap_state: service_role only")
    if m217:
        ok(db.one("select obj_description(%s::regprocedure, 'pg_proc')" % q(sig)) == "tally gap state (migration 217)", "0. marked as 217's")
        db.sql("create or replace function public.tally_gap_state(p_book uuid, p_gap jsonb, p_gap_at timestamptz) returns jsonb language sql as $f$ select '{}'::jsonb $f$; comment on function public.tally_gap_state(uuid, jsonb, timestamptz) is null")
        r = psql_text(m217)
        ok(r.returncode != 0 and "is not 182's text" in r.stderr and "Nothing was changed" in r.stderr, "0. a tally_gap_state that is not 182's or 217's: refused (%s)" % r.stderr.strip()[-160:])
        ok(db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q(sig)).strip() == "select '{}'::jsonb", "0. (guard) and left as it was")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
