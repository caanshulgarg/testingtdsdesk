"""python3 run_migration149.py - migration-149-bridge-stopped-alert (08-Nov-2026, bridge 2.5.10): one line in the bell
when all of a firm's FinCom Bridges have been silent more than 10 minutes. On a throwaway PostgreSQL (pg_stand, port
31491; never a real database). Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no table created, altered, dropped or emptied), names no
     real database; runs twice; one function, not executable by anon or authenticated;
  1. a firm silent 20 minutes (working hours): one 'summary' line, the stop's time in India's time, no computer's name;
     scanned again: nothing new; a later stop the same day: the same line, its new time, unread again;
  2. none: a firm with another computer beating, a stop under 10 minutes, a heartbeat over 24 hours old, a scan outside
     Monday to Saturday 09:00-19:00 India time, a revoked computer; review of 2.5.10 (5): a stop outside 09:30-18:30 India
     time (the evening's switch-off), a computer not beating at least 30 minutes earlier that day (tally-ingest's
     info.dayFirst: none, another day's, a start just before the stop); another summary line of the computer that day is
     never overwritten."""
import os, re, sys, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M149 = os.path.join(SQLDIR, "migration-149-bridge-stopped-alert.sql")
M47 = os.path.join(SQLDIR, "migration-47-recorder-queue-alerts.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
text = open(M149).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M149), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate|alter\s+table|create\s+table)\b", code), "0. add-only")
ok(not re.search(r"supabase\.co|\.supabase\.|https?://", low), "0. names no real database")
ok(re.findall(r"create or replace function public\.(\w+)", text) == ["tally_alert_scan_stopped"], "0. one function")
m47 = open(M47).read()
working = re.search(r"create or replace function public\.tally_alert_working_now.*?\$function\$;", m47, re.S).group(0)
alerts = re.search(r"create table if not exists public\.tally_alerts \(.*?\);\s*create unique index if not exists tally_alerts_once.*?;", m47, re.S).group(0)
db = pg_stand.start(int(os.environ.get("PG149_PORT") or 31491))
def psql(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
F1, F2, F3, F4 = ["99999999-9999-9999-9999-99999999914%d" % i for i in (1, 2, 3, 4)]
D = ["d1490000-0000-0000-0000-00000000000%d" % i for i in range(1, 8)]
NOW = "2026-11-09 06:00:00+00"   # Monday 11:30 India time
try:
    db.sql("create table if not exists public.tally_devices (id uuid primary key, firm_id uuid, name text, revoked boolean default false, info jsonb default '{}'::jsonb);\n" + alerts + "\n" + working)
    for i in (1, 2):
        r = psql(text)
        ok(r.returncode == 0, "149 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    ex = lambda rl: db.one("select has_function_privilege(%s, 'public.tally_alert_scan_stopped(timestamptz)', 'execute')" % q(rl)) in ("t", "true")
    ok(not ex("anon") and not ex("authenticated"), "0. anon and authenticated cannot run it")
    def beat(ago, now=NOW, first="03:30:00", day=None):
        at = "to_char((timestamptz %s - interval '%s') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')" % (q(now), ago)
        d = day or "to_char((timestamptz %s - interval '%s') at time zone 'Asia/Kolkata', 'YYYY-MM-DD')" % (q(now), ago)
        df = "jsonb_build_object('day', %s, 'at', %s)" % (d if day is None else q(day), "to_char((timestamptz %s - interval '%s') at time zone 'UTC', 'YYYY-MM-DD') || 'T%sZ'" % (q(now), ago, first)) if first else "null"
        return "jsonb_build_object('beat', jsonb_build_object('at', %s), 'dayFirst', %s)" % (at, df)
    db.sql("""insert into tally_devices (id, firm_id, name, revoked, info) values
      (%s, %s, 'MADEUP-SRV', false, %s),
      (%s, %s, 'MADEUP-A', false, %s), (%s, %s, 'MADEUP-B', false, %s),
      (%s, %s, 'MADEUP-OLD', false, %s),
      (%s, %s, 'MADEUP-NEW', false, %s), (%s, %s, 'MADEUP-GONE', true, %s);""" % (
        q(D[0]), q(F1), beat("20 minutes"), q(D[1]), q(F2), beat("30 minutes"), q(D[2]), q(F2), beat("2 minutes"),
        q(D[3]), q(F3), beat("3 days"), q(D[4]), q(F4), beat("4 minutes"), q(D[5]), q(F4), beat("50 minutes")))
    scan = lambda now=NOW: db.one("select public.tally_alert_scan_stopped(%s)::text" % q(now))
    print("== 1. a firm silent 20 minutes")
    r = scan()
    rows = db.rows("select firm_id::text, device_id::text, kind, day::text, words, data::text, read_at from tally_alerts order by firm_id")
    ok('"written": 1' in r and len(rows) == 1 and rows[0]["firm_id"] == F1 and rows[0]["device_id"] == D[0] and rows[0]["kind"] == "summary" and rows[0]["day"] == "2026-11-09", "1. one line, the firm's computer (%s %s)" % (r, rows))
    w = rows[0]["words"] if rows else ""
    ok(w.startswith("FinCom Bridge on the office Tally computer stopped answering at 11:10 IST.") and "MADEUP" not in w and "MADEUP" not in (rows[0]["data"] if rows else ""), "1. the words: the stop in India's time, no computer's name (%s)" % w)
    ok('"written": 0' in scan(), "1. scanned again: nothing new")
    ok(not db.rows("select 1 from tally_alerts where firm_id in (%s, %s, %s)" % (q(F2), q(F3), q(F4))), "2. another computer beating, over 24 h, under 10 minutes (a revoked one not counted)")
    db.sql("update tally_alerts set read_at = now(); update tally_devices set info = %s where id = %s;" % (beat("12 minutes", now="2026-11-09 08:00:00+00"), q(D[0])))
    r = scan("2026-11-09 08:00:00+00")
    rows = db.rows("select words, read_at, data::text from tally_alerts where firm_id = %s" % q(F1))
    ok(len(rows) == 1 and "at 13:18 IST" in rows[0]["words"] and rows[0]["read_at"] == "", "1. a later stop that day: the same line, its new time, unread (%s)" % rows)
    print("== 2. none")
    ok("skipped" in scan("2026-11-08 06:00:00+00") and "skipped" in scan("2026-11-09 14:00:00+00"), "2. a Sunday, after 19:00 India time: skipped")
    db.sql("delete from tally_alerts; update tally_devices set info = %s where id = %s;" % (beat("3 hours", first="02:00:00"), q(D[0])))
    ok('"written": 0' in scan() and not db.rows("select 1 from tally_alerts"), "2. a stop at 08:30 India time (before the office day): none")
    # the evening: a stop at 18:40 India time (13:10Z), scanned at 18:55 (13:25Z)
    db.sql("update tally_devices set info = %s where id = %s;" % (beat("15 minutes", now="2026-11-09 13:25:00+00"), q(D[0])))
    scan("2026-11-09 13:25:00+00")
    ok(not db.rows("select 1 from tally_alerts where firm_id = %s" % q(F1)), "2. a stop at 18:40 India time (the evening's switch-off): none")
    for what, info in (("no first heartbeat of the day", beat("20 minutes", first=None)), ("its first heartbeat another day's", beat("20 minutes", day="2026-11-08")),
                       ("started 10 minutes before the stop", beat("20 minutes", first="05:30:00"))):
        db.sql("update tally_devices set info = %s where id = %s;" % (info, q(D[0])))
        db.sql("delete from tally_alerts;"); scan()
        ok(not db.rows("select 1 from tally_alerts where firm_id = %s" % q(F1)), "2. %s: none" % what)
    db.sql("update tally_devices set info = %s where id = %s; insert into tally_alerts (firm_id, device_id, kind, day, words, data) values (%s, %s, 'summary', '2026-11-09', 'another line', '{\"x\": 1}');" % (beat("20 minutes"), q(D[0]), q(F1), q(D[0])))
    scan()
    ok(db.one("select words from tally_alerts where firm_id = %s" % q(F1)) == "another line", "2. another summary line of the computer that day: never overwritten")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
