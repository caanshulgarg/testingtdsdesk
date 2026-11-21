"""python3 run_apply_indexes.py - tools/apply_concurrent_indexes.py (21-Nov-2026, branch next-fix-dbspeed): a migration's
indexes built one statement per call, through a stand-in for the Management API (tests/api_standin.py: the whole text one
query) on a throwaway PostgreSQL (pg_stand, port 31277 unless PGIDX_PORT; never a real database). A lock wait is cut off by
the server's own lock_timeout (1 s here), forced by a transaction holding the table. Checks:
  A. "set lock_timeout ...; create index concurrently ..." as one call is refused (why each build is its own call)
  B. a build cut off leaves an INVALID index, and IF NOT EXISTS alone then skips it with no error (the review's finding)
  C. the script: the cut-off build found invalid, dropped and built again after the pause; valid; the ANALYZE after it run;
     exit 0; the planner can use it
  D. an invalid index left from before: dropped and built again
  E. the table held longer than every try: exit 1, the index reported valid false, the ANALYZE not run
  F. run again with every index valid: nothing built, exit 0
  G. a file with two statements on a line, or an index line without CONCURRENTLY IF NOT EXISTS: refused"""
import os, sys, subprocess, shutil, time, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
ROOT = os.path.dirname(HERE)
TOOL = os.path.join(ROOT, "tools", "apply_concurrent_indexes.py")
PORT = int(os.environ.get("PGIDX_PORT", "31277"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
db = pg_stand.start(PORT)
TMP = os.path.join(os.environ.get("TMPDIR", "/tmp"), "apply-idx-test-%d" % os.getpid()); os.makedirs(TMP, exist_ok=True)
RUN = "python3 %s %d" % (os.path.join(HERE, "api_standin.py"), db.port)
ENV = dict(os.environ, STANDIN_PGOPTIONS="-c lock_timeout=1s")
def standin(sql):
    p = os.path.join(TMP, "q.sql"); open(p, "w").write(sql)
    return json.loads(subprocess.run(RUN.split() + [p], capture_output=True, text=True, env=ENV).stdout)
def hold(seconds):
    h = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-X", "-q",
                          "-c", "begin; select count(*) from t; select pg_sleep(%s); commit;" % seconds], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.8); return h
def tool(path, tries=3, pause=2.5):
    return subprocess.run(["python3", TOOL, "--run", RUN, "--tries", str(tries), "--pause", str(pause), path], capture_output=True, text=True, env=ENV)
def valid(name): return db.one("select coalesce((select indisvalid::text from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = '%s'), 'missing')" % name)
def analyzed(): return db.one("select coalesce(last_analyze::text, '') from pg_stat_user_tables where relname = 't'")
FILE = os.path.join(TMP, "idx.sql")
open(FILE, "w").write("-- made-up\ncreate index concurrently if not exists t_b on public.t (b);\nanalyze public.t;\n")
try:
    db.sql("create table t (a int, b text); insert into t select i, i::text from generate_series(1, 20000) i;")
    print("== A. one call")
    r = standin("set lock_timeout = '3s'; create index concurrently if not exists t_x on public.t (a);")
    ok(isinstance(r, dict) and "transaction block" in r.get("message", ""), "set lock_timeout and the build in one call: refused (%s)" % r)
    print("== B. the finding")
    h = hold(3); r = standin("create index concurrently if not exists t_b on public.t (b);"); h.wait()
    ok(isinstance(r, dict) and "lock timeout" in r.get("message", ""), "the build cut off by the lock wait (%s)" % str(r)[:90])
    ok(valid("t_b") == "false", "it leaves t_b invalid")
    r = standin("create index concurrently if not exists t_b on public.t (b);")
    ok(r == [] and valid("t_b") == "false", "IF NOT EXISTS alone then skips it with no error, still invalid")
    db.sql("drop index t_b;")
    print("== C. the script recovers a cut-off build")
    h = hold(3.5); r = tool(FILE); h.wait(); print(r.stdout)
    ok(r.returncode == 0 and "try 1: error" in r.stdout and "invalid, dropped" in r.stdout and "valid true" in r.stdout, "try 1 cut off, the invalid index dropped, try 2 valid; exit 0")
    ok(valid("t_b") == "true" and analyzed() != "", "t_b valid; the ANALYZE run after it")
    plan = "\n".join(x["QUERY PLAN"] for x in db.rows("set enable_seqscan = off; explain select * from t where b = '5'"))
    ok("t_b" in plan, "the planner can use it")
    ok("lock_timeout 1s" in r.stdout, "the session's lock_timeout and statement_timeout printed")
    print("== D. an invalid index from before")
    db.sql("drop index t_b;"); h = hold(3); standin("create index concurrently if not exists t_b on public.t (b);"); h.wait()
    ok(valid("t_b") == "false", "t_b left invalid")
    r = tool(FILE); print(r.stdout)
    ok(r.returncode == 0 and "invalid, dropped" in r.stdout and valid("t_b") == "true", "dropped and built again; valid; exit 0")
    print("== E. held longer than every try")
    db.sql("drop index t_b; select pg_stat_reset();")
    h = hold(30); r = tool(FILE, tries=2, pause=1); print(r.stdout)
    db.sql("select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(30)%' and pid <> pg_backend_pid();"); h.wait()
    ok(r.returncode == 1 and "valid false" in r.stdout and "not run" in r.stdout, "exit 1, valid false, the ANALYZE not run")
    print("== F. again, every index valid")
    r = tool(FILE); print(r.stdout)
    r2 = tool(FILE); print(r2.stdout)
    ok(r.returncode == 0 and r2.returncode == 0 and "try" not in r2.stdout and valid("t_b") == "true", "the second run builds nothing; exit 0")
    print("== G. a bad file")
    for name, text in (("two on a line", "create index concurrently if not exists t_c on public.t (a); analyze public.t;\n"),
                       ("no concurrently", "create index if not exists t_c on public.t (a);\n")):
        p = os.path.join(TMP, "bad.sql"); open(p, "w").write(text); r = tool(p)
        ok(r.returncode != 0 and valid("t_c") == "missing", "%s: refused, nothing built (%s)" % (name, (r.stderr or r.stdout).strip()[-90:]))
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True); shutil.rmtree(TMP, ignore_errors=True)
print("\n%d failed" % len(fails) if fails else "\nall ok"); sys.exit(1 if fails else 0)
