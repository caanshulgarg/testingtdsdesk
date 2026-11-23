"""python3 tests/run_migration212.py - server/tally-cloud/migration-212-post-withdraw.sql (a DRAFT, next-payroll, ninth
review): an entry of a posting withdrawn (a Tally Payroll part retired by Daily Check: not in Tally, posted again under
another id) is never retried, requeued, handed out or queued again. On a throwaway PostgreSQL (post_queue_stand: pg_stand,
port 31212 unless PG212_PORT, its data under /tmp/payroll9 unless TMPDIR; never a real database) with the queue of
32 -> 203 run first; made-up firm, client, company and entries only.
  0. the file: one transaction, lock_timeout 10 s, add-only, grants explicit, names no real database, runs twice, refuses
     without the queue first and when a name is someone else's
  1. tally_post_withdraw: a member who may post, a reason, a posting of the firm, not while it is being sent
  2. withdrawn: its Retry refused (in words), no status back to waiting / taken / running (the requeue, a reroute), never
     handed out, its FinCom id never queued in another posting; another entry and another posting as before
RED_WITHOUT_212=1: the same checks without the file (fails)."""
import os, re, sys, json
os.environ.setdefault("TMPDIR", "/tmp/payroll9")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
SQL = PS.SQLDIR
M212 = os.path.join(SQL, "migration-212-post-withdraw.sql")
RED = os.environ.get("RED_WITHOUT_212") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text = open(M212).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\b(drop|truncate|delete from)\b", code) and code.count("alter table") == 3 and all("add column if not exists" in l for l in code.splitlines() if "alter table" in l)
   and "create or replace function public.tally_post_enqueue" not in code and "create or replace function public.tally_post_take" not in code, "add-only: three columns, no queue function replaced, nothing dropped or deleted")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
FNS = ["tally_post_withdraw(uuid, text, text)", "tally_post_withdrawn_guard()", "tally_post_ids_withdrawn_guard()"]
ok(all(("revoke all on function public.%s from public, anon, authenticated;" % f) in text for f in FNS) and "grant execute on function public.tally_post_withdraw(uuid, text, text) to authenticated, service_role;" in text
   and all(seg.count("security definer set search_path = public, pg_temp") == 1 for seg in code.split("create or replace function")[1:]), "grants explicit; each function security definer with a fixed search_path")

st = PS.Stand(int(os.environ.get("PG212_PORT") or 31212), extra=[os.path.join(SQL, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql")]); db = st.db
import atexit; atexit.register(lambda: st.stop())
m182 = open(os.path.join(SQL, "migration-182-gap-after-post.sql")).read()
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
for p in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql", "migration-201a-post-grants.sql", "migration-203-post-linked-guid.sql"):
    r = st.psql_text(open(os.path.join(SQL, p)).read())
    if r.returncode: raise SystemExit("%s does not run on the stand: %s" % (p, r.stderr[-300:]))
st.grants(); st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
# someone else's function of the same name: refused, nothing changed
db.sql("create function public.tally_post_withdraw(p_job uuid, p_id text, p_why text) returns jsonb language sql as $$ select '{}'::jsonb $$")
r = st.psql_text(text)
ok(r.returncode != 0 and "already used by something else" in r.stderr and db.one("select count(*)::text from information_schema.columns where table_name = 'tally_post_ids' and column_name = 'withdrawn_at'") == "0",
   "a function of the same name not its own: refused, nothing changed (%s)" % r.stderr.strip()[-90:])
db.sql("drop function public.tally_post_withdraw(uuid, text, text)")
if not RED:
    for n in (1, 2):
        r = st.psql_text(text); ok(r.returncode == 0, "runs (%d) %s" % (n, r.stderr.strip()[-300:]))
st.grants()

J = lambda n: "%08d-0000-4000-8000-000000000212" % n
X = lambda i: "<VOUCHER><DATE>20261031</DATE><NARRATION>Salary | TDSDesk:" + i + "</NARRATION></VOUCHER>"
def enqueue(n, ids): return st.rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(n)), q(json.dumps({"masters": [], "vouchers": [{"id": i, "xml": X(i)} for i in ids], "ledger": ""}))))
def take():
    r = db.rows("set role service_role; select id::text from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
    return r[0]["id"] if r else None
def finish(n, status="failed"):
    db.sql("set role service_role; update tally_post_jobs set status = %s, done = 1 where id = %s" % (q(status), q(J(n))))
status = lambda n: db.one("select status from tally_post_jobs where id = %s" % q(J(n)))
def rpc(uid, stmt):   # as st.rpc, the database's whole error kept (its first line: the words)
    try: out = db.one("set role authenticated; %s" % stmt, uid)
    except RuntimeError as e: return {"_error": " ".join(l for l in str(e).splitlines() if "ERROR" in l)[:400] or str(e)[:400]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
st.rpc = lambda uid, stmt, role="authenticated": rpc(uid, stmt)
err = lambda r: str(r.get("_error") or r.get("error") or "")

print("== 1. tally_post_withdraw")
r = enqueue(1, ["dc-tp-202610-1"]); t = take()
ok(r.get("ok") is True and t == J(1), "a part queued and handed out")
w = st.rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'retired')::text" % q(J(1)))
ok(w.get("ok") is False and w.get("busy") is True, "not while it is being sent (%s)" % w)
finish(1)
w = st.rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', '  ')::text" % q(J(1)))
ok("say why" in err(w), "a reason required (%s)" % err(w)[-60:])
w = st.rpc("77777777-7777-7777-7777-777777777212", "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'x')::text" % q(J(1)))
ok("only a member" in err(w), "not by someone outside the firm (%s)" % err(w)[-60:])
w = st.rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202699-9', 'x')::text" % q(J(1)))
ok(w.get("ok") is False and "not in this posting" in err(w), "an entry not in the posting (%s)" % w)
w = st.rpc(STAFF, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'retired by Daily Check: not in Tally')::text" % q(J(1)))
row = json.loads(db.one("select to_jsonb(t)::text from (select withdrawn_at is not null w, withdrawn_by::text b, withdrawn_why y from tally_post_ids where job_id = %s) t" % q(J(1))) or "{}")
ok(w.get("ok") is True and w.get("withdrawn") == 1 and row == {"w": True, "b": STAFF, "y": "retired by Daily Check: not in Tally"}, "withdrawn by staff, the name and why kept (%s)" % row)

print("== 2. withdrawn: never again")
r = st.rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(1)))
ok(r.get("ok") is not True and "was withdrawn" in err(r) and status(1) == "failed", "its Retry refused in words, still failed (%s)" % err(r)[-110:])
try: db.sql("set role service_role; update tally_post_jobs set status = 'waiting' where id = %s" % q(J(1))); back = status(1)
except RuntimeError as e: back = "refused: " + " ".join(l for l in str(e).splitlines() if "ERROR" in l)[:200]
ok(back.startswith("refused") and "was withdrawn" in back and status(1) == "failed", "no way back to waiting (the requeue, a reroute): %s" % back)
ok(take() is None, "never handed out")
r = enqueue(2, ["dc-tp-202610-1"])
ok(r.get("ok") is not True and "was withdrawn" in err(r) and db.one("select count(*)::text from tally_post_jobs where id = %s" % q(J(2))) == "0", "its FinCom id in another posting: refused in words, nothing queued (%s)" % err(r)[-90:])
r = enqueue(3, ["dc-tp-202610-3"]); t = take()
ok(r.get("ok") is True and t == J(3), "the part under its fresh id: queued and handed out")
finish(3, "done")
r = enqueue(4, ["dc-tp-202611-1", "dc-tp-202611-2"]); take(); finish(4)
st.rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202611-1', 'retired')::text" % q(J(4)))
r = st.rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(4)))
ok(r.get("ok") is not True and "dc-tp-202611-1" in err(r), "a posting with one entry withdrawn: not retried whole (%s)" % err(r)[-80:])
r = enqueue(5, ["dc-tp-202611-2"])
ok("withdrawn" not in err(r), "its other entry: the queue's own answer as before 212, never \"withdrawn\" (%s)" % (r if r.get("ok") else err(r)[-90:]))
r = enqueue(6, ["e-bill-1"]); t = take(); finish(6)
r2 = st.rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(6)))
ok(r.get("ok") is True and t == J(6) and "withdrawn" not in err(r2), "another posting: queued, handed out; its Retry answered by the queue's own rules as before (%s)" % (r2 if r2.get("ok") else err(r2)[-90:]))

print("\n" + ("all passed" if not fails else "%d FAILED" % len(fails)))
sys.exit(1 if fails else 0)
