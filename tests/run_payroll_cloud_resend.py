"""python3 tests/run_payroll_cloud_resend.py - next-payroll (seventh review): a Tally Payroll part sent through FinCom's
cloud queue whose posting computer recorded it (posted-ids.json) while Tally never got it is sent again only as that
posting's own Retry, so the release reaches the bridge. The queue's SQL (migrations 32 -> 203, as run_migration203.py builds
it) on a throwaway PostgreSQL (pg_stand, port 31377 unless PGPAY_PORT, its data under /tmp/payroll7 unless TMPDIR; never a
real database), and the real tally-ingest (server/tally-cloud/index.ts, under Deno) handing the posting out (posts_take:
the posting and its released ids), its database calls for the queue answered by that PostgreSQL (fake_supabase.py for the
rest). Made-up firm, client, company and entries only.
  1. the part queued (tally_post_enqueue) and handed out by tally-ingest with no release; the bridge's report: not in
     Tally (failed, recorded as sent on that computer)
  2. a NEW posting of the same part is refused, or carries no release (why a new posting can never get it into Tally:
     the computer answers "already sent")
  3. the earlier posting released by a member (tally_post_owner_release: its id not live, released by 'owner') and sent
     again as its own Retry (tally_post_enqueue with its id): waiting again on the same computer, the same XML
  4. tally-ingest hands that posting out WITH the release ([{id, at, by, why}] of that part), which the bridge's
     releaseFor honours once (bridge-go/accepted.go)
  5. a posting still waiting cannot be released (the page then says it is on its way)
Needs Deno (DENO, or deno on the PATH)."""
import os, sys, json, time, shutil, hashlib, subprocess, threading, urllib.request, tempfile
os.environ.setdefault("TMPDIR", "/tmp/payroll7")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
DENO = os.environ.get("DENO") or shutil.which("deno")
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
import post_queue_stand as PS
from post_queue_stand import q, F as FIRM, CO, OWNER, DA, BA
import fake_supabase as FS
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
SQL = PS.SQLDIR
M = [os.path.join(SQL, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql")]
LATER = [os.path.join(SQL, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql")]
st = PS.Stand(int(os.environ.get("PGPAY_PORT") or 31377), extra=M); db = st.db
import atexit; atexit.register(lambda: st.stop())
m182 = open(os.path.join(SQL, "migration-182-gap-after-post.sql")).read()
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
for p in LATER + [os.path.join(SQL, "migration-201a-post-grants.sql"), os.path.join(SQL, "migration-203-post-linked-guid.sql")]:
    r = st.psql_text(open(p).read())
    if r.returncode: raise SystemExit("%s does not run on the stand: %s" % (os.path.basename(p), r.stderr[-400:]))
st.grants()
info = st.beat("made-up-a", BA, [CO]); st.setbeat(DA, info)
J1, J2 = "00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"
PART = "dc-tp-202610-1"
XML = ("<VOUCHER VCHTYPE=\"Payroll\" ACTION=\"Create\" OBJVIEW=\"PaySlip Voucher View\"><DATE>20261031</DATE><VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>"
       "<NARRATION>Salary for Oct 2026 as per the salary sheet (2 employees, part 1 of 2) | TDSDesk:" + PART + "</NARRATION></VOUCHER>")
PAY = json.dumps({"masters": [], "vouchers": [{"id": PART, "xml": XML}], "ledger": ""})
def member(stmt): return st.rpc(OWNER, stmt)
def job(i): return json.loads(db.one("select to_jsonb(j)::text from (select id, status, payload, results, device_id from tally_post_jobs where id = %s) j" % q(i)) or "null")

# ---------------------------------------------------------------- tally-ingest under Deno, its queue calls on PostgreSQL
KEY = "fcd_" + "7" * 48
FS.PORT = int(os.environ.get("FAKE_SUPA_PORT") or 9377)
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "SRV9 · made-up-a", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": info, "wake_token": "w" * 64, "version": "2.5.18"})
FS.T["tally_companies"].append({"firm_id": FIRM, "company": CO, "client_id": "c1", "device_id": DA, "book_id": PS.BK})
orig_rpc = FS.rpc
def pg_rpc(fn, a):
    if fn == "tally_post_take_for":
        return json.loads(db.one("set role service_role; select coalesce(json_agg(t), '[]')::text from tally_post_take_for(%s::uuid, %s, %s) t" % (q(a["p_device"]), q(a["p_bridge"]), "true" if a.get("p_main") else "false")) or "[]")
    if fn == "tally_post_checks_for": return []
    return orig_rpc(fn, a)
FS.rpc = pg_rpc
def ids_from_pg():   # tally_post_ids as PostgREST would read them (tally-ingest selects the posting's released ids)
    FS.T["tally_post_ids"] = json.loads(db.one("select coalesce(json_agg(t), '[]')::text from (select job_id::text, fincom_id, entry_id, live, released_at, released_by, released_why from tally_post_ids) t") or "[]")
FS.start()
wrap = tempfile.mkdtemp(prefix="payroll7-ingest-")
PORT = int(os.environ.get("INGEST_PORT") or 8377)
open(os.path.join(wrap, "serve.ts"), "w").write("const s = Deno.serve; (Deno as any).serve = (h: any) => s({ port: %d, onListen() {} }, h);\nawait import(%s);\n"
                                                  % (PORT, json.dumps("file://" + os.path.abspath(os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")))))
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(wrap, "serve.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
atexit.register(lambda: (fn.kill(), shutil.rmtree(wrap, ignore_errors=True)))
ME = {"id": BA, "computer": "SRV9", "user": "SRV9\\made-up-a", "mode": "main", "runMode": "user", "version": "2.5.18", "port": 9101}
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:%d/" % PORT, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def take():
    ids_from_pg(); c, r = call({"kind": "posts_take", "version": "2.5.18", "bridge": ME}); return (r or {}).get("job") if c == 200 else {"error": (c, r)}
def report(i, res):   # the bridge's report as tally-ingest stores it: the results, the status by the queue's own rule
    db.sql("set role service_role; update tally_post_jobs set status = (tally_post_job_settle('running', false, payload, %s::jsonb, %s::jsonb) ->> 'status'), results = %s::jsonb, items = %s::jsonb, done = 1 where id = %s"
           % (q(json.dumps(res)), q(json.dumps([{"id": PART, "kind": "voucher", "state": "failed"}])), q(json.dumps(res)), q(json.dumps([{"id": PART, "kind": "voucher", "state": "failed"}])), q(i)))
for i in range(240):
    try: urllib.request.urlopen("http://127.0.0.1:%d/" % PORT, timeout=1); break
    except urllib.error.HTTPError: break
    except Exception:
        if fn.poll() is not None: break
        time.sleep(0.5)
if fn.poll() is not None: time.sleep(0.5); print("".join(log)[-2000:]); raise SystemExit("tally-ingest did not start")

print("== 1. queued, handed out with no release; not in Tally, recorded as sent")
r = member("select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J1), q(PAY)))
ok(r.get("ok") is True and r.get("id") == J1, "the part queued (%s)" % r)
t = take()
ok(t and t.get("id") == J1 and t.get("released") == [] and (t.get("payload") or {}).get("vouchers", [{}])[0].get("xml") == XML, "tally-ingest hands it out, no release (%s)" % json.dumps(t)[:200])
report(J1, [{"id": PART, "kind": "voucher", "ok": False, "sent": True, "state": "failed", "message": "Tally did not answer"}])
ok(job(J1)["status"] == "failed", "the bridge's report: failed (%s)" % job(J1)["status"])

print("== 2. a new posting of that part carries no release")
r = member("select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J2), q(PAY)))
t2 = take() if r.get("ok") else None
err = (r.get("_error") or r.get("error") or "").strip().splitlines()
why = next((l for l in err if "ERROR" in l or "duplicate" in l or "already" in l), err[0] if err else "")[:160] if not r.get("ok") else ""
ok((not r.get("ok") and not t2) or (t2 and t2.get("id") == J2 and t2.get("released") == []),
   "a new posting of it never carries the release: %s" % ("refused (%s)" % why if not r.get("ok") else "handed out with released %s (the computer answers \"already sent\")" % t2.get("released")))
if t2: report(J2, [{"id": PART, "kind": "voucher", "ok": False, "alreadySent": True, "refused": True, "sent": True, "state": "failed", "sentJob": J1, "message": "already sent from this computer"}])
db.sql("update tally_post_jobs set status = 'cancelled' where id = %s and status <> 'failed'" % q(J2))

print("== 3. the earlier posting released by a member and sent again as its own Retry")
k = member("select tally_post_owner_release(%s::uuid, %s, %s)::text" % (q(J1), q(PART), q("not in Tally's copy of 2026-10-31 read after the send")))
rel = json.loads(db.one("select to_jsonb(t)::text from (select live, released_by, released_at is not null as at from tally_post_ids where job_id = %s and fincom_id = %s) t" % (q(J1), q(PART))) or "{}")
ok(k.get("ok") is True and k.get("released") is True and rel == {"live": False, "released_by": "owner", "at": True}, "released: %s; its id %s" % (k, rel))
r = member("select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J1))
j = job(J1)
ok(r.get("ok") is True and r.get("retry") is True and j["status"] == "waiting" and str(j["device_id"]) == DA and j["payload"]["vouchers"][0]["xml"] == XML, "Retry: waiting again on the same computer, the same XML (%s)" % r)

print("== 4. handed out WITH the release")
t = take()
rl = (t or {}).get("released") or []
ok(t and t.get("id") == J1 and len(rl) == 1 and rl[0].get("id") == PART and rl[0].get("at") and rl[0].get("by") == "owner" and "not in Tally" in str(rl[0].get("why")), "tally-ingest hands posting J1 out with its release: %s" % json.dumps(rl))

print("== 5. a posting still waiting is not released")
J3 = "00000000-0000-4000-8000-0000000000a3"
db.sql("update tally_post_jobs set status = 'done' where id = %s" % q(J1))
PAY3 = PAY.replace(PART, "dc-tp-202611-1").replace("20261031", "20261130")
r = member("select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J3), q(PAY3)))
k = member("select tally_post_owner_release(%s::uuid, %s, %s)::text" % (q(J3), q("dc-tp-202611-1"), q("why")))
ok(r.get("ok") is True and k.get("ok") is False and "still being sent" in str(k.get("error")), "refused while waiting: %s" % k)

print("\n" + ("all passed" if not fails else "%d FAILED" % len(fails)))
sys.exit(1 if fails else 0)
