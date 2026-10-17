"""python3 run_migration94.py - migration-94-gst-filing (17-Oct-2026, branch next-gst-file): the two tables of filing through
the GST API (gst_filings, gst_filing_log), on a throwaway PostgreSQL (pg_stand, port 30940; never a real database).
  0. the file: one transaction, add-only (no delete / drop / truncate / alter table), names no real database, no OTP column.
  1. runs, and runs a second time with nothing changed.
  2. a member reads only the firm's own rows; a member cannot write either table (only the function's service role does).
  3. the checks: a form other than R1 / IFF / 3B, a period not MMYYYY, a PAN not a PAN, an unknown action are refused.
RED_WITHOUT_94=1: the same checks without running the file (1 to 3 fail)."""
import os, re, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M94 = os.path.join(HERE, "..", "server", "gst-taxpro", "migration-94-gst-filing.sql")
RED = os.environ.get("RED_WITHOUT_94") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M94).read()
print("  md5 of %s: %s" % (os.path.basename(M94), hashlib.md5(text.encode()).hexdigest()))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and not re.search(r"\balter\s+table\b(?!\s+public\.gst_fil\w+\s+enable row level security)", code), "0. add-only")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", low), "0. names no real database")
ok(not re.search(r"^\s*otp\b", code, re.M) and "evc_otp" in code and not re.search(r"\botp\s+text", code), "0. no column keeps an OTP")
F1, F2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
U1, U2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
db = pg_stand.start(int(os.environ.get("PG94_PORT") or 30940))
def fails_sql(s, uid=None):
    try: db.sql(s, uid); return ""
    except RuntimeError as e: return str(e)
try:
    db.sql("insert into firms values ('%s', 'A'), ('%s', 'B'); insert into members (user_id, firm_id, role) values ('%s', '%s', 'staff'), ('%s', '%s', 'owner');" % (F1, F2, U1, F1, U2, F2) +
           # as on Supabase, where my_firm() reads members as its owner: the stand-in's plain function needs these
           " grant usage on schema auth to authenticated; grant select on members to authenticated;" +
           # and Supabase's default grants on new tables, which the file must take back
           " alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;")
    if not RED:
        db.sql(text); db.sql(text)
    have = db.one("select count(*) from information_schema.tables where table_name in ('gst_filings', 'gst_filing_log')")
    ok(have == "2", "1. both tables there after running the file twice")
    ins = lambda f, g: "insert into gst_filings (firm_id, gstin, form, period, status, arn) values ('%s', '%s', 'R1', '082026', 'filed', 'AA0908260000001');" % (f, g) + \
        "insert into gst_filing_log (firm_id, gstin, form, period, action, by_user, ok, result, arn) values ('%s', '%s', 'R1', '082026', 'file', null, true, 'filed', 'AA0908260000001');" % (f, g)
    e = fails_sql(ins(F1, "09AANFG3202D1ZR") + ins(F2, "07AAACT1234A1Z5"))
    ok(not e, "1. the function (as the database owner) writes both" + (": " + e[:120] if e else ""))
    try: seen = db.rows("set role authenticated; select gstin from gst_filings", U1); seen_log = db.rows("set role authenticated; select gstin from gst_filing_log", U1)
    except RuntimeError as x: print(x); seen, seen_log = [{"err": str(x)}], []
    ok([r.get("gstin") for r in seen] == ["09AANFG3202D1ZR"] and [r.get("gstin") for r in seen_log] == ["09AANFG3202D1ZR"], "2. a member reads only the firm's own filings and log")
    w1 = fails_sql("set role authenticated; insert into gst_filings (firm_id, gstin, form, period) values ('%s', '09AANFG3202D1ZR', '3B', '082026')" % F1, U1)
    w2 = fails_sql("set role authenticated; update gst_filing_log set result = 'x'", U1)
    w3 = fails_sql("set role authenticated; delete from gst_filing_log", U1)
    ok(all("permission denied" in w for w in (w1, w2, w3)), "2. a member cannot insert, change or remove (filings and log)")
    bad = [fails_sql("insert into gst_filings (firm_id, gstin, form, period) values ('%s', '09AANFG3202D1ZR', 'R9', '082026')" % F1),
           fails_sql("insert into gst_filings (firm_id, gstin, form, period) values ('%s', '09AANFG3202D1ZR', 'R1', '2026-08')" % F1),
           fails_sql("insert into gst_filings (firm_id, gstin, form, period, signatory_pan) values ('%s', '09AANFG3202D1ZR', '3B', '092026', '1234')" % F1),
           fails_sql("insert into gst_filing_log (firm_id, gstin, form, period, action, ok) values ('%s', '09AANFG3202D1ZR', 'R1', '082026', 'submit', true)" % F1)]
    ok(all("check" in b for b in bad), "3. a wrong form, period, PAN or action is refused")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
