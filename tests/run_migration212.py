"""python3 tests/run_migration212.py - server/tally-cloud/migration-212-post-withdraw.sql and migration-212-indexes.sql (a
DRAFT, next-payroll, ninth review and its SQL review): a Tally Payroll entry of a posting withdrawn (a part retired by Daily
Check: not in Tally, posted again under another id) is never retried, requeued, handed out or queued again. On a throwaway
PostgreSQL (post_queue_stand: pg_stand, port 31212 unless PG212_PORT, its data under /tmp/payroll10 unless TMPDIR, removed
after; never a real database) with the queue of 32 -> 203 run first; made-up firm, client, company and entries only.
  0. the files: one transaction, lock_timeout 3 s, add-only, grants explicit (the trigger functions to nobody), names no
     real database; refused without the queue and when a name is someone else's; runs twice with no ACCESS EXCLUSIVE lock
     on a second run; the second step through tools/apply_concurrent_indexes.py (CONCURRENTLY, valid), then the triggers
  1. tally_post_withdraw: refused before the second step; a member who may post, a Tally Payroll id only, a reason; busy
     while waiting / taken, held for checking (done + checking), or owing an entry to send again (200/201's reservation)
  2. withdrawn: its Retry refused; no way back to waiting (the requeue); never handed out; a hand-back of ANOTHER entry of
     the posting goes on (its resend_only list), one naming the withdrawn entry is refused; in a new posting the withdrawn
     id is left out (its result says so) and the rest queued; a posting of it alone refused in words
  3. the owner's undo (staff refused; who and why kept); then the Retry is the queue's own again
  4. cost: a 20,000-entry posting queued with and without the guards (the firm holding a withdrawn id), timed
RED_WITHOUT_212=1: the same checks without the files (fails)."""
import os, re, sys, json, time, shutil, subprocess
# the stand's data and socket outside the scratchpad (the postgres user must reach them), removed after
os.environ["TMPDIR"] = os.environ.get("PAYROLL_PGDIR") or "/tmp/payroll10"
os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o777)
os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS, pg_stand
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA
SQL = PS.SQLDIR
M212, I212 = os.path.join(SQL, "migration-212-post-withdraw.sql"), os.path.join(SQL, "migration-212-indexes.sql")
RED = os.environ.get("RED_WITHOUT_212") == "1"
BIG = os.environ.get("BIG", "1") != "0"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text, itext = open(M212).read(), open(I212).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the files")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '3s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 3 s")
ok(not re.search(r"\b(drop|truncate|delete from)\b", code) and code.count("alter table public.tally_post_ids add column") == 1 and "'alter table public.tally_post_ids add column '" in code
   and "create index" not in code and code.count("create trigger") == 3 and code.index("create trigger") > code.index("function public.tally_post_withdraw_arm") and not re.search(r"create or replace function public\.tally_post_(enqueue|take|ids_sync|reroute)", code),
   "add-only: the columns only when absent (no ALTER on a second run), no index or trigger here, no queue function replaced, nothing dropped")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", (text + itext).lower()), "names no real database")
FNS = ["tally_post_withdraw(uuid, text, text)", "tally_post_withdraw_undo(uuid, text, text)", "tally_post_withdraw_busy(uuid)", "tally_post_withdrawn_guard()", "tally_post_jobs_withdrawn_filter()",
       "tally_post_checks_withdrawn_guard()", "tally_post_withdrawn_words(uuid, text)"]
ok(all(("revoke all on function public.%s from public, anon, authenticated, service_role;" % f) in text for f in FNS + ["tally_post_withdraw_arm()"])
   and sorted(re.findall(r"grant execute on function public\.([\w(), ]+?) to (\w+);", text)) == [("tally_post_withdraw(uuid, text, text)", "authenticated"), ("tally_post_withdraw_undo(uuid, text, text)", "authenticated")]
   and all(seg.count("security definer set search_path = public, pg_temp") == 1 for seg in code.split("create or replace function")[1:])
   and "the trigger functions and tally_post_withdraw_arm to nobody" in text, "grants explicit and as the header says (the trigger functions to nobody); each function security definer, fixed search_path")
ilines = [l for l in itext.splitlines() if l.strip() and not l.startswith("--")]
ok(len(ilines) == 4 and sum(bool(re.match(r"create index concurrently if not exists \w+ on public\.tally_post_ids \(", l)) for l in ilines) == 2
   and ilines[2] == "select public.tally_post_withdraw_arm();" and ilines[-1] == "analyze public.tally_post_ids;",
   "the second step: two indexes CONCURRENTLY, the two triggers (lock_timeout 3 s, only when absent), ANALYZE")

st = PS.Stand(int(os.environ.get("PG212_PORT") or 31212), extra=[os.path.join(SQL, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql")]); db = st.db
def bye():
    st.stop(); shutil.rmtree(db.data, ignore_errors=True)
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
import atexit; atexit.register(bye)
m182 = open(os.path.join(SQL, "migration-182-gap-after-post.sql")).read()
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
# (132's tally_post_record: a posting already made straight to a bridge, recorded; its function only, as staging has it)
m132 = open(os.path.join(SQL, "migration-132-post-record.sql")).read()
f0_ = m132.index("create or replace function public.tally_post_record("); f1_ = m132.index("$function$;", f0_) + len("$function$;")
db.sql(m132[f0_:f1_] + "\ngrant execute on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) to authenticated;")
for p in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql", "migration-201a-post-grants.sql", "migration-203-post-linked-guid.sql"):
    r = st.psql_text(open(os.path.join(SQL, p)).read())
    if r.returncode: raise SystemExit("%s does not run on the stand: %s" % (p, r.stderr[-300:]))
st.grants(); st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
def rpc(uid, stmt):   # the database's whole error kept (its ERROR line: the words)
    try: out = db.one("set role authenticated; %s" % stmt, uid)
    except RuntimeError as e: return {"_error": " ".join(l for l in str(e).splitlines() if "ERROR" in l)[:400] or str(e)[:400]}
    try: return json.loads(out) if out else {}
    except (TypeError, ValueError): return {"_out": out}
err = lambda r: str(r.get("_error") or r.get("error") or "")
J = lambda n: "%08d-0000-4000-8000-000000000212" % n
X = lambda i: "<VOUCHER><DATE>20261031</DATE><NARRATION>Salary | TDSDesk:" + i + "</NARRATION></VOUCHER>"
def enqueue(n, ids): return rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(n)), q(json.dumps({"masters": [], "vouchers": [{"id": i, "xml": X(i)} for i in ids], "ledger": ""}))))
def take():
    r = db.rows("set role service_role; select id::text from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
    return r[0]["id"] if r else None
def sql_try(stmt):
    try: db.sql(stmt); return ""
    except RuntimeError as e: return " ".join(l for l in str(e).splitlines() if "ERROR" in l)[:300] or str(e)[:300]
def finish(n, status="failed"): db.sql("set role service_role; update tally_post_jobs set status = %s, done = 1 where id = %s" % (q(status), q(J(n))))
status = lambda n: db.one("select status from tally_post_jobs where id = %s" % q(J(n)))
def big(n, k):
    t = time.time(); r = enqueue(n, ["e-big-%d-%05d" % (n, i) for i in range(k)]); return r, time.time() - t

# someone else's function of the same name: refused, nothing changed
db.sql("create function public.tally_post_withdraw(p_job uuid, p_id text, p_why text) returns jsonb language sql as $$ select '{}'::jsonb $$")
r = st.psql_text(text)
ok(r.returncode != 0 and "already used by something else" in r.stderr and db.one("select count(*)::text from information_schema.columns where table_name = 'tally_post_ids' and column_name = 'withdrawn_at'") == "0",
   "a function of the same name not its own: refused, nothing changed")
db.sql("drop function public.tally_post_withdraw(uuid, text, text)")
db.sql("alter table tally_post_ids add column undone_by text")
r = st.psql_text(text)
ok(r.returncode != 0 and "column tally_post_ids.undone_by" in r.stderr, "a column of the same name and another type: refused (%s)" % r.stderr.strip()[-80:])
db.sql("alter table tally_post_ids drop column undone_by")
if not RED:
    r = st.psql_text(text); ok(r.returncode == 0, "step 1 runs %s" % r.stderr.strip()[-300:])
    locks = db.rows("begin; " + pg_stand.migration_body(M212) + "; select coalesce(string_agg(distinct mode, ','), '') m from pg_locks where relation = 'public.tally_post_ids'::regclass")
    db.sql("select 1")
    ok("AccessExclusiveLock" not in (locks[0]["m"] if locks else ""), "a second run takes no ACCESS EXCLUSIVE lock on tally_post_ids (%s)" % (locks[0]["m"] if locks else ""))
    r = st.psql_text(text); ok(r.returncode == 0, "step 1 runs twice %s" % r.stderr.strip()[-200:])
st.grants()
db.sql("revoke all on function public.tally_post_withdrawn_guard(), public.tally_post_jobs_withdrawn_filter(), public.tally_post_withdraw_busy(uuid), public.tally_post_withdraw_arm(), public.tally_post_checks_withdrawn_guard(), public.tally_post_withdrawn_words(uuid, text) from service_role") if not RED else None

print("== 1. tally_post_withdraw")
r = enqueue(1, ["dc-tp-202610-1"]); t = take(); finish(1)
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'retired')::text" % q(J(1)))
ok(w.get("ok") is False and "second step is not run" in err(w), "before the second step: refused (%s)" % err(w)[-70:])
if not RED:
    runner = "python3 %s %d" % (os.path.join(HERE, "api_standin.py"), db.port)
    a = subprocess.run([sys.executable, os.path.join(HERE, "..", "tools", "apply_concurrent_indexes.py"), "--run", runner, "--pause", "1", I212], capture_output=True, text=True)
    ok(a.returncode == 0 and db.one("select count(*)::text from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname in ('tally_post_ids_withdrawn', 'tally_post_ids_withdrawn_job') and i.indisvalid") == "2"
       and db.one("select count(*)::text from pg_trigger where tgname in ('tally_post_jobs_withdrawn', 'tally_post_jobs_withdrawn_filter', 'tally_post_checks_withdrawn')") == "3", "step 2: the indexes built CONCURRENTLY and valid, then the three triggers (%s)" % (a.stdout + a.stderr).strip()[-160:])
    a = subprocess.run([sys.executable, os.path.join(HERE, "..", "tools", "apply_concurrent_indexes.py"), "--run", runner, "--pause", "1", I212], capture_output=True, text=True)
    ok(a.returncode == 0, "step 2 runs twice")
r = enqueue(2, ["dc-tp-202610-2"]); take()
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-2', 'retired')::text" % q(J(2)))
ok(w.get("ok") is False and w.get("busy") is True, "busy while taken (%s)" % err(w)[-50:])
db.sql("update tally_post_jobs set status = 'done', checking = true where id = %s" % q(J(2)))
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-2', 'retired')::text" % q(J(2)))
ok(w.get("ok") is False and w.get("busy") is True and "held while FinCom checks" in err(w), "busy while held for checking: done + checking (%s)" % err(w)[-60:])
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'e-bill-1', 'x')::text" % q(J(1)))
ok("only a Tally Payroll part" in err(w), "a Tally Payroll id only (%s)" % err(w)[-60:])
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', '  ')::text" % q(J(1)))
ok("say why" in err(w), "a reason required")
w = rpc("77777777-7777-7777-7777-777777777212", "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'x')::text" % q(J(1)))
ok("only a member" in err(w), "not by someone outside the firm")
# a posting that owes an entry to send again (200's owed: a member's confirm, released, not live): busy
r = enqueue(3, ["dc-tp-202612-1", "dc-tp-202612-2"]); take(); finish(3)
db.sql("update tally_post_ids set live = false, released_at = now(), released_by = 'owner', released_why = 'not in Tally' where job_id = %s and entry_id = 'dc-tp-202612-2';"
       " insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, confirmed_by, confirmed_at) values (%s, %s, 'dc-tp-202612-2', %s, %s, 'not in Tally', 'confirmed', '00000000-0000-0000-0000-000000000200', now())"
       % (q(J(3)), q(F), q(J(3)), q(CO), q(OWNER)))
owed = db.one("select count(*)::text from tally_post_resend_reserved(%s::uuid) where job_id = %s" % (q(F), q(J(3))))
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202612-1', 'retired')::text" % q(J(3)))
ok(owed == "1" and w.get("busy") is True and "still has an entry to send again" in err(w), "busy while the posting owes another entry (reserved %s): %s" % (owed, err(w)[-60:]))
db.sql("alter table tally_post_jobs disable trigger tally_post_jobs_withdrawn_filter")
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'retired')::text" % q(J(1)))
db.sql("alter table tally_post_jobs enable trigger tally_post_jobs_withdrawn_filter")
ok(w.get("ok") is False and "second step is not run" in err(w), "a guard trigger disabled: refused (%s)" % err(w)[-50:])
r = enqueue(10, ["dc-tp-202610-c1-p3"]); take(); finish(10)
db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why) values (%s, %s, 'dc-tp-202610-c1-p3', %s, %s, 'look')" % (q(F), q(J(10)), q(CO), q(OWNER)))
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-c1-p3', 'retired')::text" % q(J(10)))
ok(w.get("busy") is True and "is not settled yet" in err(w), "busy while a check of Tally waits for an entry of it (%s)" % err(w)[-60:])
db.sql("update tally_post_checks set state = 'notseen' where job_id = %s" % q(J(10)))
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-c1-p3', 'retired')::text" % q(J(10)))
ok(w.get("busy") is True and "not seen in Tally and not confirmed" in err(w), "  and while it is not seen in Tally and not confirmed (%s)" % err(w)[-60:])
db.sql("update tally_post_checks set state = 'withdrawn' where job_id = %s" % q(J(10)))
for bad in ("dc-tp-202610-c1-3", "dc-tp-202610-C1-p3", "dc-tp-202610-c1-p"):
    w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, %s, 'retired')::text" % (q(J(10)), q(bad)))
    ok("only a Tally Payroll part" in err(w), "  not a part id: %s refused" % bad)
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-c1-p3', 'retired')::text" % q(J(10)))
ok(w.get("ok") is True, "a part id carrying its client (dc-tp-202610-c1-p3): withdrawn")
w = rpc(STAFF, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-1', 'retired by Daily Check: not in Tally')::text" % q(J(1)))
row = json.loads(db.one("select to_jsonb(t)::text from (select withdrawn_at is not null w, withdrawn_by::text b, withdrawn_why y from tally_post_ids where job_id = %s) t" % q(J(1))) or "{}")
ok(w.get("ok") is True and w.get("withdrawn") == 1 and row == {"w": True, "b": STAFF, "y": "retired by Daily Check: not in Tally"}, "withdrawn by staff, who and why kept")

print("== 2. withdrawn: never again")
r = rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(1)))
ok(r.get("ok") is not True and "was withdrawn (retired by Daily Check: not in Tally)" in err(r) and "replaced by" not in err(r) and status(1) == "failed", "its Retry refused in words, its own reason (%s)" % err(r)[-90:])
e = sql_try("set role service_role; update tally_post_jobs set status = 'waiting' where id = %s" % q(J(1)))
ok("was withdrawn" in e and status(1) == "failed", "no way back to waiting (the requeue): %s" % e[-70:])
ok(take() is None, "never handed out")
# a two-entry posting, A withdrawn, B to hand back: B goes, A never
r4 = enqueue(4, ["dc-tp-202611-1", "dc-tp-202611-2"]); print("    (queued: %s)" % (r4 if r4.get("ok") else err(r4)[-160:])); take(); finish(4)
w = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202611-1', 'retired')::text" % q(J(4)))
e1 = sql_try("set role service_role; update tally_post_jobs set status = 'waiting', resend_only = '[\"dc-tp-202611-2\"]'::jsonb where id = %s" % q(J(4)))
s1 = status(4)
db.sql("update tally_post_jobs set status = 'failed', resend_only = null where id = %s" % q(J(4)))
e2 = sql_try("set role service_role; update tally_post_jobs set status = 'waiting', resend_only = '[\"dc-tp-202611-1\", \"dc-tp-202611-2\"]'::jsonb where id = %s" % q(J(4)))
ok(w.get("ok") is True and e1 == "" and s1 == "waiting" and "was withdrawn" in e2 and status(4) == "failed", "a hand-back of the other entry goes on (%s); one naming the withdrawn entry is refused" % s1)
r = enqueue(5, ["dc-tp-202610-1", "dc-tp-202610-7"]); print("    (queued: %s)" % (r if r.get("ok") else err(r)[-160:]))
res = json.loads(db.one("select coalesce(results, '[]')::text from tally_post_jobs where id = %s" % q(J(5))) or "[]")
pl = json.loads(db.one("select payload::text from tally_post_jobs where id = %s" % q(J(5))) or "{}")
ok(r.get("ok") is True and [v["id"] for v in pl.get("vouchers", [])] == ["dc-tp-202610-7"] and any(x.get("id") == "dc-tp-202610-1" and x.get("withdrawn") for x in res)
   and db.one("select count(*)::text from tally_post_ids where job_id = %s" % q(J(5))) == "1", "a new posting: the withdrawn id left out (its result says so), the rest queued")
db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(5)))
r = enqueue(6, ["dc-tp_202610_1"])
ok(r.get("ok") is not True and "Not queued: dc-tp_202610_1 was withdrawn" in err(r) and db.one("select count(*)::text from tally_post_jobs where id = %s" % q(J(6))) == "0",
   "a posting of it alone (another spelling, matched as tally_post_id_match does): not queued, in words, never {ok: true} (%s)" % err(r)[-80:])
r = enqueue(7, ["dc-tp-202610-1", "dc-tp-202611-1"])
ok(r.get("ok") is not True and "dc-tp-202610-1, dc-tp-202611-1 were withdrawn" in err(r), "two of them: \"were\" (%s)" % err(r)[-60:])
# an empty posting (a cancelled one with nothing left to send) never waits again
db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, created_by) values (%s, %s, 'c1', %s, %s, '{\"masters\": [], \"vouchers\": [], \"ledger\": \"\"}', 0, 'cancelled', %s)" % (q(J(13)), q(F), q(CO), q(DA), q(OWNER)))
r = rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(13)))
ok(r.get("ok") is not True and "nothing to send" in err(r) and status(13) == "cancelled", "a posting with nothing to send: its Retry refused (%s)" % err(r)[-60:])
# (re-review B1) ids are per client: the queue's own rules are per firm (one live FinCom id, the posting register), so a
# client-less id of another client is held back by them (why a part's id now carries its client); another client's own
# part beside a withdrawn one: queued as it is
r = enqueue(8, ["dc-tp-202610-c1-p8"]); finish(8)
w8 = rpc(OWNER, "select tally_post_withdraw(%s::uuid, 'dc-tp-202610-c1-p8', 'retired')::text" % q(J(8)))
db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, created_by) values (%s, %s, 'c2', 'Made-up Egret', null, %s, 1, %s)"
       % (q(J(11)), q(F), q(json.dumps({"masters": [], "vouchers": [{"id": "dc-tp-202610-c2-p8", "xml": X("dc-tp-202610-c2-p8")}], "ledger": ""})), q(OWNER)))
pl = json.loads(db.one("select payload::text from tally_post_jobs where id = %s" % q(J(11))) or "{}")
ok(w8.get("ok") is True and [v["id"] for v in pl.get("vouchers", [])] == ["dc-tp-202610-c2-p8"] and status(11) == "waiting", "another client's own part 8 beside client c1's withdrawn part 8: queued as it is")
db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(11)))
e = sql_try("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, created_by) values (%s, %s, 'c2', 'Made-up Egret', null, %s, 1, %s)"
            % (q(J(12)), q(F), q(json.dumps({"masters": [], "vouchers": [{"id": "dc-tp-202610-1", "xml": X("dc-tp-202610-1")}], "ledger": ""})), q(OWNER)))
ok(e != "" and "withdrawn" not in e, "  (an older client-less id of another client is held back by the queue's own per-firm rules, not by 212: %s)" % e[-90:])
# a record of a posting already made straight to a bridge (tally_post_record, 132): kept whole, never stripped or refused
r = rpc(OWNER, "select tally_post_record(%s::uuid, 'c1', %s, 'done', %s::jsonb, %s::jsonb, 'posted straight to the bridge')::text" % (q(J(9)), q(CO), q(json.dumps([{"id": "dc-tp-202610-1", "ok": True}])), q(json.dumps(["dc-tp-202610-1"]))))
j9 = json.loads(db.one("select to_jsonb(t)::text from (select status, payload, results from tally_post_jobs where id = %s) t" % q(J(9))) or "{}")
ok(r.get("ok") is True and j9.get("status") == "done" and "dc-tp-202610-1" in json.dumps(j9.get("payload")) and not any((x or {}).get("withdrawn") for x in j9.get("results") or []), "a record of a posting already made (tally_post_record): kept whole (%s)" % (r if not r.get("ok") else j9.get("status")))
# a check of Tally for a withdrawn entry: never asked or confirmed
e = sql_try("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why) values (%s, %s, 'dc-tp-202610-1', %s, %s, 'look')" % (q(F), q(J(1)), q(CO), q(OWNER)))
ok("was withdrawn" in e, "a check asked for a withdrawn entry: refused (%s)" % e[-70:])
db.sql("alter table tally_post_checks disable trigger tally_post_checks_withdrawn; insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why) values (%s, %s, 'dc-tp-202610-1', %s, %s, 'look'); alter table tally_post_checks enable trigger tally_post_checks_withdrawn" % (q(F), q(J(1)), q(CO), q(OWNER)))
e = sql_try("update tally_post_checks set state = 'confirmed' where job_id = %s" % q(J(1)))
ok("was withdrawn" in e, "  nor confirmed (so the posting never owes it): %s" % e[-60:])
db.sql("update tally_post_checks set state = 'withdrawn' where job_id = %s" % q(J(1)))

print("== 3. the owner's undo")
w = rpc(STAFF, "select tally_post_withdraw_undo(%s::uuid, 'dc-tp-202610-1', 'mistake')::text" % q(J(1)))
ok("only the firm's owner" in err(w), "staff cannot take it back")
w = rpc(OWNER, "select tally_post_withdraw_undo(%s::uuid, 'dc-tp-202610-1', 'checked: not paid')::text" % q(J(1)))
row = json.loads(db.one("select to_jsonb(t)::text from (select withdrawn_at is null w, undone_by::text b, undone_why y, withdrawn_why ww from tally_post_ids where job_id = %s) t" % q(J(1))) or "{}")
r = rpc(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(1)))
ok(w.get("ok") is True and row == {"w": True, "b": OWNER, "y": "checked: not paid", "ww": "retired by Daily Check: not in Tally"} and "withdrawn" not in err(r), "the owner takes it back (who and why kept); the Retry is the queue's own again (%s)" % (r if r.get("ok") else err(r)[-70:]))

print("== 4. cost")
if BIG and not RED:
    # the filter's own cost: the same 20,000-entry posting queued with it and without it (disabled), alternately, the
    # fastest of three each (a busy machine slows a run, never speeds one)
    k, tw, tn = 0, [], []
    for rep_ in range(3):
        for on in (True, False):
            k += 1
            if not on: db.sql("alter table tally_post_jobs disable trigger tally_post_jobs_withdrawn_filter")
            r, t_ = big(100 + k, 20000)
            if not on: db.sql("alter table tally_post_jobs enable trigger tally_post_jobs_withdrawn_filter")
            db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(100 + k)))
            (tw if on else tn).append(t_ if r.get("ok") else 999)
    ok(min(tw) <= min(tn) * 1.25 + 0.25, "a 20,000-entry posting with the filter (the firm holding withdrawn ids): fastest %.2f s, without it %.2f s" % (min(tw), min(tn)))
print("\n" + ("all passed" if not fails else "%d FAILED" % len(fails)))
sys.exit(1 if fails else 0)
