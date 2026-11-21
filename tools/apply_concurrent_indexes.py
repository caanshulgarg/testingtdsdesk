#!/usr/bin/env python3
"""Build a migration's indexes one statement per call, and make sure each one is valid.

    python3 tools/apply_concurrent_indexes.py --run "<runner>" server/tally-cloud/migration-204-indexes.sql

The runner is any command that takes the path of a .sql file, runs its text as ONE query, and prints the answer as JSON:
a list of rows, or {"message": "..."} for an error. The Management API helper the coordinator uses (sbq.sh file.sql) is
one; tests/api_standin.py is the same for a throwaway PostgreSQL. This script holds no secret and names no database.

Why it exists: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and a query of several statements is one
(so "set lock_timeout ...; create index concurrently ..." in one call is refused). A build that fails part way (a lock
wait cut off, a statement timeout, a lost connection) leaves an INVALID index behind, and IF NOT EXISTS then skips it with
no error: writes keep paying for it and no read can use it. So, for each "create index concurrently if not exists <name>"
line of the file:
  1. an index of that name that is there and invalid is dropped (drop index concurrently), then
  2. the line is run as its own call (the session's own lock_timeout and statement_timeout apply; they are printed first),
  3. pg_index.indisvalid is read; an index missing or invalid is dropped if invalid and built again, up to --tries times
     in all, --pause seconds apart.
Every other line (an ANALYZE) is run as its own call after every index is valid, and not at all if one is not.
At the end every index of the file is printed with valid true/false; the exit code is 1 if any is not valid (or a
statement failed), else 0. Blank lines and lines starting with -- are skipped; each other line is one statement."""
import argparse, json, os, re, shlex, subprocess, sys, tempfile, time

NAME = re.compile(r"^\s*create\s+(?:unique\s+)?index\s+concurrently\s+if\s+not\s+exists\s+(\w+)\s+on\s+(?:public\.)?(\w+)", re.I)


def call(runner, sql):
    fd, path = tempfile.mkstemp(suffix=".sql")
    try:
        with os.fdopen(fd, "w") as f: f.write(sql)
        r = subprocess.run(shlex.split(runner) + [path], capture_output=True, text=True)
    finally:
        os.unlink(path)
    out = (r.stdout or "").strip()
    try: ans = json.loads(out) if out else None
    except ValueError: ans = {"message": (out or r.stderr or "no answer")[-500:]}
    if r.returncode != 0 and not (isinstance(ans, dict) and ans.get("message")):
        ans = {"message": ("runner exit %d: " % r.returncode) + (r.stderr or out)[-500:]}
    return ans


def failed(ans): return isinstance(ans, dict) and "message" in ans


def state(runner, name):
    """None: no such index; else True/False: valid or not."""
    ans = call(runner, "select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid "
                       "where c.relname = '%s' and c.relnamespace = 'public'::regnamespace" % name)
    if failed(ans): raise SystemExit("could not read the state of %s: %s" % (name, ans["message"]))
    return None if not ans else bool(ans[0]["valid"])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", required=True, help="the runner command (it gets the path of a .sql file)")
    ap.add_argument("--tries", type=int, default=3)
    ap.add_argument("--pause", type=float, default=20.0)
    ap.add_argument("file")
    a = ap.parse_args()
    lines = [l.strip() for l in open(a.file) if l.strip() and not l.strip().startswith("--")]
    idx = [(l, NAME.match(l).group(1)) for l in lines if NAME.match(l)]
    rest = [l for l in lines if not NAME.match(l)]
    bad = [l for l in lines if l.rstrip(";").count(";")]
    if bad: raise SystemExit("one statement per line: %s" % bad[0][:120])
    if any(re.match(r"\s*create\s+(unique\s+)?index\b", l, re.I) for l in rest):
        raise SystemExit("every index line must be: create index concurrently if not exists <name> on ...")
    t = call(a.run, "select current_setting('lock_timeout') as lock_timeout, current_setting('statement_timeout') as statement_timeout")
    print("session: %s" % (t["message"] if failed(t) else "lock_timeout %s, statement_timeout %s" % (t[0]["lock_timeout"], t[0]["statement_timeout"])), flush=True)
    result, errors = {}, 0
    for stmt, name in idx:
        for n in range(1, a.tries + 1):
            s = state(a.run, name)
            if s is True: break
            if s is False:
                d = call(a.run, "drop index concurrently if exists public.%s" % name)
                print("  %s: invalid, dropped%s" % (name, (" (failed: %s)" % d["message"]) if failed(d) else ""), flush=True)
            r = call(a.run, stmt)
            s = state(a.run, name)
            print("  %s: try %d: %s; valid %s" % (name, n, ("error: " + r["message"][:160]) if failed(r) else "built", s), flush=True)
            if s is True: break
            if n < a.tries: time.sleep(a.pause)
        result[name] = state(a.run, name)
    if all(v is True for v in result.values()):
        for stmt in rest:
            r = call(a.run, stmt)
            print("  %s: %s" % (stmt.rstrip(";"), ("error: " + r["message"][:160]) if failed(r) else "done"), flush=True)
            errors += failed(r)
    elif rest:
        print("  not run (an index is not valid): %s" % "; ".join(s.rstrip(";") for s in rest))
    print("indexes:")
    for name, v in result.items(): print("  %-48s valid %s" % (name, "true" if v is True else ("false" if v is False else "false (missing)")))
    sys.exit(1 if errors or any(v is not True for v in result.values()) else 0)


if __name__ == "__main__":
    main()
