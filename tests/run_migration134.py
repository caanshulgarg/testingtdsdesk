"""python3 run_migration134.py - migration-134-stock-from-tally (30-Oct-2026, with FinCom Bridge 2.5.1; the owner's decision of
30-Oct-2026, "1": the stock from Tally only when a person clicks). On a throwaway PostgreSQL (pg_stand, port 31340; never a
real database). Written before the file. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no delete from / drop / truncate / alter table other than the
     new table's row security), names no real database; runs twice; explicit grants: the table service_role reads and
     writes, authenticated reads (its firm's rows only, row security), anon nothing; both functions service_role only.
  1. the click: the first asks (ask true, its time); a second click while it is on its way (60 s) asks nothing; another
     period is its own; another firm's book is refused.
  2. the answer: only to the click FinCom sent (its time); ok keeps the figures and the time; a click for the same period
     afterwards is answered from the kept row (cached), again asks once more; a failure (slow) keeps the last figures and
     time, with the owner's words; an ok without figures, an unknown status, a second answer to the same click, refused.
  3. row security: a member reads the firm's rows only; anon reads nothing; a member cannot write.
RED_WITHOUT_134=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M134 = os.environ.get("M134_FILE") or os.path.join(SQLDIR, "migration-134-stock-from-tally.sql")
RED = os.environ.get("RED_WITHOUT_134") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999134", "88888888-8888-8888-8888-888888888134"
B, B2 = "819d4a59-4cee-4bf7-8f8c-000000000134", "819d4a59-4cee-4bf7-8f8c-000000000135"
U, U2 = "11111111-1111-1111-1111-111111111134", "22222222-2222-2222-2222-222222222134"

text = "" if RED else (open(M134).read() if os.path.exists(M134) else "")
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M134))
if text:
    print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M134), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
alters = sorted(re.findall(r"\balter\s+table\b[^;]*;", code))
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and alters == ["alter table public.tally_stock_reads enable row level security;"], "0. add-only: no delete, drop or truncate; the only table change is the new table's row security (%s)" % alters)
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
ok(sorted(re.findall(r"create table if not exists public\.(\w+)", text)) == ["tally_stock_reads"], "0. one new table")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_stock_answer", "tally_stock_ask"], "0. two new functions (%s)" % FNS)
ok(re.search(r"revoke all on public\.tally_stock_reads from public, anon, authenticated;", text) and re.search(r"grant select on public\.tally_stock_reads to authenticated;", text)
   and re.search(r"grant select, insert, update on public\.tally_stock_reads to service_role;", text), "0. the table's grants written out")
for fn in ("tally_stock_ask", "tally_stock_answer"):
    ok(re.search(r"revoke all on function public\.%s\([^)]*\) from public, anon, authenticated;" % fn, text) and re.search(r"grant execute on function public\.%s\([^)]*\) to service_role;" % fn, text), "0. %s: explicit grants, service_role only" % fn)

db = pg_stand.start(int(os.environ.get("PG134_PORT") or 31340))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, role=None):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def ask(book, a, z, again=False, firm=F): return j("select tally_stock_ask(%s, %s, %s, %s, %s, %s)::text" % (q(firm), q(book), q(a), q(z), "true" if again else "false", q(U)))
def answer(book, a, z, at, status, op=None, cl=None, read_at=None, words="", firm=F):
    n = lambda v: "null" if v is None else str(v)
    return j("select tally_stock_answer(%s, %s, %s, %s, %s, %s, %s, %s, %s, 412, 160, %s)::text" % (q(firm), q(book), q(a), q(z), q(at), q(status), n(op), n(cl), "null" if read_at is None else q(read_at), q(words)))
def row(book, a, z):
    try: r = db.rows("select status, words, opening::text, closing::text, read_at::text, click_at from tally_stock_reads where book_id = %s and period_from = %s and period_to = %s" % (q(book), q(a), q(z)))
    except RuntimeError: return {}
    return r[0] if r else {}
try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('fincom.role', true), ''), 'service_role') $$;
      insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members (user_id, firm_id, role, active) values (%(U)s, %(F)s, 'staff', true), (%(U2)s, %(F2)s, 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(B)s, %(F)s, 'c1', 'STOCK CO', '2026-04-01'), (%(B2)s, %(F2)s, 'c9', 'OTHER CO', '2026-04-01');
      grant usage on schema public, auth to authenticated, anon, service_role; grant select on members to authenticated;""" % {"F": q(F), "F2": q(F2), "B": q(B), "B2": q(B2), "U": q(U), "U2": q(U2)})
    if not RED:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "134 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    print("== 0. grants")
    priv = lambda rl, p: db.one("select has_table_privilege(%s, 'public.tally_stock_reads', %s)" % (q(rl), q(p))) in ("t", "true")
    try:
        ok(not any(priv("anon", p) for p in ("select", "insert", "update")), "0. anon: nothing on tally_stock_reads")
        ok(priv("authenticated", "select") and not priv("authenticated", "insert") and not priv("authenticated", "update"), "0. authenticated: select only")
        ok(all(priv("service_role", p) for p in ("select", "insert", "update")) and not priv("service_role", "delete"), "0. service_role: select, insert, update (no delete)")
        ok(db.one("select relrowsecurity from pg_class where oid = 'public.tally_stock_reads'::regclass") in ("t", "true"), "0. row security on")
    except RuntimeError as e: ok(False, "0. the table is there: %s" % str(e)[-200:])
    sig = {r["proname"]: r["sig"] for r in db.rows("select p.proname, p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'tally_stock_%'")}
    ex = lambda rl, fn: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig[fn]))) in ("t", "true") if fn in sig else None
    for fn in ("tally_stock_ask", "tally_stock_answer"): ok(ex("service_role", fn) and ex("authenticated", fn) is False and ex("anon", fn) is False, "0. %s: service_role only" % fn)

    print("== 1. the click")
    a1 = ask(B, "2026-04-01", "2026-10-31")
    at1 = a1.get("at", "")
    ok(a1.get("ok") is True and a1.get("ask") is True and re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$", at1 or "") and (a1.get("row") or {}).get("status") == "asked", "1. the first click asks, with its time (%s)" % a1)
    a2 = ask(B, "2026-04-01", "2026-10-31")
    ok(a2.get("ask") is False and a2.get("pending") is True, "1. a second click while it is on its way asks nothing (%s)" % a2)
    a3 = ask(B, "2026-10-01", "2026-10-31")
    ok(a3.get("ask") is True, "1. another period is its own (%s)" % a3)
    ok(ask(B2, "2026-04-01", "2026-10-31").get("error") == "no such book in this firm", "1. another firm's book: refused")
    ok("two years" in str(ask(B, "2026-10-31", "2026-04-01").get("error")) and "two years" in str(ask(B, "2020-04-01", "2026-03-31").get("error")), "1. a period backwards or over two years: refused")
    ok("not allowed" in str(j("select tally_stock_ask(%s, %s, '2026-04-01', '2026-04-30', false, null)::text" % (q(F), q(B)), "authenticated")), "1. a signed-in person cannot call it")

    print("== 2. the answer")
    ok(answer(B, "2026-04-01", "2026-10-31", "2026-01-01T00:00:00.000000Z", "ok", 908443072.58, 2182130465.82, "2026-10-30T10:12:00Z").get("unknown") is True, "2. an answer to a click FinCom never sent: refused")
    ok("without its figures" in str(answer(B, "2026-04-01", "2026-10-31", at1, "ok", None, 5, "2026-10-30T10:12:00Z").get("error")), "2. ok without its figures: refused")
    ok("not an answer" in str(answer(B, "2026-04-01", "2026-10-31", at1, "great").get("error")), "2. an unknown status: refused")
    r = answer(B, "2026-04-01", "2026-10-31", at1, "ok", 908443072.584, 2182130465.82, "2026-10-30T10:12:00Z")
    R = row(B, "2026-04-01", "2026-10-31")
    ok(answer(B, "2026-04-01", "2026-10-31", at1, "slow", words="late").get("answered") is True and row(B, "2026-04-01", "2026-10-31").get("status") == "ok", "2. a second answer to the same click: refused, the first kept")
    ok(r.get("ok") is True and R.get("status") == "ok" and R["opening"] == "908443072.58" and R["closing"] == "2182130465.82" and R["read_at"].startswith("2026-10-30 10:12:00"), "2. ok: the figures and the time kept (%s)" % R)
    c = ask(B, "2026-04-01", "2026-10-31")
    ok(c.get("ask") is False and c.get("cached") is True and (c.get("row") or {}).get("opening") == 908443072.58, "2. the same period again: the kept answer, Tally not asked (%s)" % c)
    g = ask(B, "2026-04-01", "2026-10-31", again=True)
    ok(g.get("ask") is True and g.get("at") and g.get("at") != at1, "2. Ask Tally again: asks once more (%s)" % g)
    ok(ask(B, "2026-04-01", "2026-10-31", again=True).get("pending") is True, "2. Ask Tally again twice at once: the second asks nothing")
    ok(answer(B, "2026-04-01", "2026-10-31", at1, "ok", 1, 2, "2026-10-30T10:13:00Z").get("unknown") is True, "2. the first click's answer once more (a late copy): refused")
    words = "Tally took too long; type the stock or try again later"
    answer(B, "2026-04-01", "2026-10-31", g["at"], "slow", words=words)
    R = row(B, "2026-04-01", "2026-10-31")
    ok(R.get("status") == "slow" and R["words"] == words and R["opening"] == "908443072.58" and R["read_at"].startswith("2026-10-30 10:12:00"), "2. slow: the owner's words, the last figures and time kept (%s)" % R)
    ok(ask(B, "2026-04-01", "2026-10-31").get("ask") is True, "2. after a failure a plain click asks again")

    print("== 3. row security")
    sel = lambda uid, role: db.rows("set role %s; set fincom.uid = %s; select book_id::text from public.tally_stock_reads order by 1;" % (role, q(uid)))
    try:
        mine = sel(U, "authenticated")
        ok(len(mine) == 2 and all(x["book_id"] == B for x in mine), "3. a member reads the firm's rows (%d)" % len(mine))
        db.sql("reset role; set fincom.role = 'service_role'; select tally_stock_ask(%s, %s, '2026-04-01', '2026-04-30', false, null);" % (q(F2), q(B2)))
        ok(all(x["book_id"] == B2 for x in sel(U2, "authenticated")) and len(sel(U2, "authenticated")) == 1, "3. the other firm's member reads only its own")
    except RuntimeError as e: ok(False, "3. reads: %s" % str(e)[-300:])
    try: db.rows("set role anon; select * from public.tally_stock_reads;"); ok(False, "3. anon reads nothing")
    except RuntimeError: ok(True, "3. anon reads nothing (refused)")
    try: db.sql("set role authenticated; set fincom.uid = %s; update public.tally_stock_reads set opening = 1;" % q(U)); ok(False, "3. a member cannot write")
    except RuntimeError: ok(True, "3. a member cannot write (refused)")
except (RuntimeError, KeyError, TypeError) as e:
    ok(False, "the checks went on without the file: %s" % str(e)[-200:])
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
