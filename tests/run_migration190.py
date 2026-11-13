"""python3 run_migration190.py - migration-190-upload-limits (13-Nov-2026, branch next-sec-server).
The call's chat files are kept only under the listed types (anything else as plain bytes: app/src/calls/rules.js
STORE_TYPES, the same list), and the bucket of the day books gets a size limit where it had none.
On a throwaway PostgreSQL (pg_stand, port 31190 unless PG190_PORT; never a real database), with a stand-in for
storage.buckets as Supabase has it.
Checks:
  0. the file: one transaction (lock_timeout 10 s), nothing dropped or deleted, names no real database, runs twice.
  1. call-files: its types are the app's list plus plain bytes, audio and video (the microphone pieces); its size
     limit stays; a list someone set by hand is not replaced.
  2. tally-days: a limit of 64 MB where it had none; a limit already set is left as it is.
  3. no other bucket is touched (assistant-files keeps "any type"); a database without Storage: the file still runs.
RED_WITHOUT_190=1: the same checks without the file (they fail; (guard) checks hold what stays as it was)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.environ.get("M190_FILE") or os.path.join(HERE, "..", "server", "security", "migration-190-upload-limits.sql")
RED = os.environ.get("RED_WITHOUT_190") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) and not RED else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if text: print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
if text:
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
    ok(not re.search(r"\b(drop|truncate|delete from|alter table|create table)\b", code), "0. nothing dropped, deleted or altered")
    ok(not re.search(r"supabase\.co|\.supabase\.|https?://", low), "0. names no real database")
rules = open(os.path.join(HERE, "..", "app", "src", "calls", "rules.js")).read()
APP = json.loads(re.search(r"export const STORE_TYPES = (\[.*?\]);", rules, re.S).group(1))
WANT = sorted(APP + ["application/octet-stream", "audio/*", "video/*"])
db = pg_stand.start(int(os.environ.get("PG190_PORT") or 31190))
def run(s):
    try: db.sql(s); return ""
    except RuntimeError as e: return str(e)[-300:]
def bucket(i): return (db.rows("select id, file_size_limit, array_to_json(allowed_mime_types)::text as types from storage.buckets where id = '%s'" % i) or [{}])[0]
try:
    if text:
        ok(run(text) == "", "3. a database without Storage: the file runs and changes nothing")
    db.sql("""create schema if not exists storage;
      create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
      insert into storage.buckets (id, name, file_size_limit, allowed_mime_types) values
        ('call-files', 'call-files', 20971520, null), ('tally-days', 'tally-days', null, null), ('assistant-files', 'assistant-files', 26214400, null),
        ('call-recordings', 'call-recordings', 52428800, null), ('tally-uploads', 'tally-uploads', 2147483648, null);""")
    if text:
        ok(run(text) == "", "0. the file runs")
        ok(run(text) == "", "0. and runs a second time")
    cf = bucket("call-files")
    ok(sorted(json.loads(cf.get("types") or "[]")) == WANT, "1. call-files: the app's list (STORE_TYPES), plain bytes, audio and video (%d types)" % len(json.loads(cf.get("types") or "[]")))
    ok(not any(re.search(r"html|svg|script", t) for t in json.loads(cf.get("types") or "[]")) and cf.get("types"), "1. no type a browser runs")
    ok(cf.get("file_size_limit") == "20971520", "1. (guard) its 20 MB limit stays")
    ok(bucket("tally-days").get("file_size_limit") == "67108864", "2. tally-days: 64 MB where it had none (%s)" % bucket("tally-days").get("file_size_limit"))
    for b, lim in (("assistant-files", "26214400"), ("call-recordings", "52428800"), ("tally-uploads", "2147483648")):
        x = bucket(b); ok(x.get("file_size_limit") == lim and not x.get("types"), "3. (guard) %s is as it was (any type)" % b)
    # what someone set by hand is kept
    db.sql("update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'call-files'; update storage.buckets set file_size_limit = 1048576 where id = 'tally-days';")
    if text: run(text)
    ok(json.loads(bucket("call-files").get("types") or "[]") == ["application/pdf"] and bucket("tally-days").get("file_size_limit") == "1048576", "1, 2. (guard) a list or a limit already set is not replaced")
except RuntimeError as e:
    ok(False, "stopped: " + str(e).strip().splitlines()[0][:160])
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
