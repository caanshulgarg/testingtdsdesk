"""python3 run_migration202.py - server/tally-cloud/migration-202-post-linked-guid.sql (19-Nov-2026, branch
next-fix-linkedguid; the owner's hard rule: a posting goes only into the Tally company the client is linked to, by the
company's GUID). On a throwaway PostgreSQL (post_queue_stand: pg_stand, port 31202 unless PG202_PORT; never a real
database; 184 and 185 run first), made-up firms, logins and companies only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (two columns if not exists, one trigger if not there; nothing
     dropped, deleted or truncated); every function's grants explicit; names no real database; runs twice
  1. a posting queued carries the link's GUID (company_guid), and is handed out with it while the bridge's beat has it open
  2. the bridge's beat has a company of that name with ANOTHER GUID: not handed out, stays waiting, the words
     "Open <company> in Tally to post" (tally_post_take_wait and the posting's message); back: handed out
  3. two open companies of that name (one the linked GUID): not handed out, "two open companies"
  4. the link has no GUID: not handed out, the plain words; the bridge not heard for 3 minutes: not handed out
  5. the link changed to another GUID after it was queued: never handed out
  6. a link without a GUID: filled from a beat with exactly one open company of the name; two of the name: nothing
     filled, marked "pick which company" (guid_pick) with both GUIDs; an owner picks (staff refused; a GUID not marked
     refused); a link made while two of the name are open takes no GUID (tally_link_guid)
RED_WITHOUT_202=1: the same checks without the file (1-6 fail)."""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, OWNER, STAFF, DA, DB, BA, BB, BK, CO, GUID
M184 = os.path.join(PS.SQLDIR, "migration-184-post-dupes.sql")
M185 = os.path.join(PS.SQLDIR, "migration-185-post-unrouted.sql")
M202 = os.path.join(PS.SQLDIR, "migration-202-post-linked-guid.sql")
RED = os.environ.get("RED_WITHOUT_202") == "1"
OTHER = "f0f0f0f0-0000-0000-0000-000000000202"   # a made-up second company of the same name
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M202).read() if os.path.exists(M202) else ""
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "create table" not in code
   and re.findall(r"alter table ([\w.]+) add column if not exists (\w+)", code) == [("public.tally_post_jobs", "company_guid"), ("public.tally_links", "guid_pick")]
   and len(re.findall(r"alter table", code)) == 2 and "if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_guid'" in code,
   "add-only: two columns (if not exists), one trigger (if not there); nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
for fn in made:
    sig = re.search(r"create or replace function public\.%s\(([^)]*)\)" % fn, code).group(1)
    types = ", ".join(a.split()[-1] for a in sig.split(",") if a.strip())
    full = "public.%s(%s)" % (fn, types)
    ok(("revoke all on function %s from public, anon" % full) in code and ("grant execute on function %s to " % full) in code, "%s: grants explicit" % full)
ok(all(("security definer set search_path = public, pg_temp" in seg) for seg in code.split("create or replace function")[1:]), "every function security definer with a fixed search_path")
for fn, base in (("tally_post_take_for", "migration-185-post-unrouted.sql"), ("tally_link_guid_fill", "migration-155-link-guid-fill.sql")):
    if not text: ok(False, fn + ": no file"); continue
    a, b = PS.fbody(text, fn), PS.fbody(open(os.path.join(PS.SQLDIR, base)).read(), fn)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    want = (6, 6) if fn == "tally_post_take_for" else (1, 0)
    ok((len(added), len(gone)) == want, "%s: the latest text (%s) with %d added / %d changed lines (want %s)" % (fn, base.split("-")[1], len(added), len(gone), want))

st = PS.Stand(int(os.environ.get("PG202_PORT") or 31202), extra=[M184, M185] + ([] if RED else [M202])); db = st.db
import atexit; atexit.register(lambda: st.stop())   # the stand stopped however the run ends (RED stops part-way)
if not RED:
    r = st.psql_text(text)
    ok(r.returncode == 0, "runs a second time: " + r.stderr[-200:])
st.grants()
J = lambda n: "%08d-0000-0000-0000-000000000202" % n
V = lambda *ids: [{"id": i, "xml": "<VOUCHER/>"} for i in ids]
def enq(n, ids):
    return st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(n)), q(json.dumps({"vouchers": V(*ids)}))))
def take(dev=DA, bridge=BA):
    r = db.rows("select id::text, coalesce(company_guid, '') g from tally_post_take_for(%s::uuid, %s, true)" % (q(dev), q(bridge)))
    return r[0] if r else None
def wait(dev=DA, bridge=BA):
    try: return db.one("select coalesce(tally_post_take_wait(%s::uuid, %s), '')" % (q(dev), q(bridge))) or ""
    except RuntimeError as e: return "ERROR " + str(e)[-80:]
def col(n, c):
    try: return db.one("select coalesce(%s::text, '') from tally_post_jobs where id = %s" % (c, q(J(n)))) or ""
    except RuntimeError: return None
def beat_cos(cos, ago=0, dev=DA, user="made-up-a", bridge=BA):
    info = st.beat(user, bridge, [CO], ago=ago)
    info["bridges"][bridge]["cos"] = cos
    info["beat"]["companies"] = [{"name": n, "guid": g, "open": True} for n, g in cos]
    st.setbeat(dev, info)
def reset(n):
    db.sql("update tally_post_jobs set status = 'done' where status in ('waiting', 'taken', 'running') and id <> %s" % q(J(n)))
one = lambda sql: db.one(sql) or ""
quiet_b = lambda: st.setbeat(DB, st.beat("made-up-b", BB, [], ago=30))   # bridge B: nothing open (never takes it)

print("== 1. queued with the link's GUID, handed out with it")
quiet_b(); beat_cos([[CO, GUID]])
r = enq(1, ["e1"]); ok(r.get("ok") is True, "queued: %s" % r)
ok(col(1, "company_guid") == GUID, "company_guid stamped as queued: %r" % col(1, "company_guid"))
t = take(); ok(t is not None and t["id"] == J(1) and t["g"] == GUID, "handed out with the GUID: %s" % t)

print("== 2. a company of that name with another GUID: waits")
reset(0); beat_cos([[CO, OTHER]])
enq(2, ["e2"]); t = take(); w = wait()
ok(t is None and col(2, "status") == "waiting", "not handed out, still waiting (%s, %s)" % (t, col(2, "status")))
ok(w == "Open %s in Tally to post" % CO, "the words: %r" % w)
ok(col(2, "device_id") != "" and col(2, "message") == w or col(2, "device_id") == "" and col(2, "message").startswith("Queued: posts by itself when"), "its message: %r (computer %r)" % (col(2, "message"), col(2, "device_id")))
beat_cos([[CO, GUID]]); t = take(); ok(t is not None and t["id"] == J(2), "the linked company open again: handed out (%s)" % t)

print("== 3. two open companies of that name")
reset(0); beat_cos([[CO, GUID], [CO, OTHER]])
enq(3, ["e3"]); t = take(); w = wait()
ok(t is None and "two open companies in Tally are named" in w and col(3, "status") == "waiting", "not handed out: %r" % w)

print("== 4. the link has no GUID; the bridge not heard")
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
beat_cos([[CO, GUID]]); t = take(); w = wait()
ok(t is None and "does not know yet which Tally company" in w and w.endswith("Open %s in Tally to post" % CO), "no GUID on the link: waits: %r" % w)
db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(GUID), q(BK)))
beat_cos([[CO, GUID]], ago=4); t = take(); w = wait()
ok(t is None and "not been heard for 3 minutes" in w, "bridge not heard for 4 minutes: waits: %r" % w)

print("== 5. the link changed after it was queued")
reset(3); beat_cos([[CO, GUID]])
db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(OTHER), q(BK)))
beat_cos([[CO, OTHER]]); t = take(); w = wait()
ok(t is None and "changed to another Tally company after this posting was queued" in w, "never handed out: %r" % w)
db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(GUID), q(BK)))
reset(0)

print("== 6. a link without a GUID: filled from one, marked from two, an owner picks")
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
db.sql("delete from tally_sync_cursor where book_id = %s" % q(BK)) if one("select to_regclass('public.tally_sync_cursor') is not null") == "t" else None
beat_cos([[CO, GUID], [CO, OTHER]])
n = one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
g = one("select coalesce(company_guid, '') from tally_links where book_id = %s" % q(BK))
pk = one("select coalesce(guid_pick::text, '') from tally_links where book_id = %s" % q(BK)) if not RED else ""
ok(n == "0" and g == "" and GUID in pk and OTHER in pk, "two of the name: nothing filled (%s, %r), marked %s" % (n, g, pk[:120]))
lg = one("select coalesce(tally_link_guid(%s::uuid, %s, %s::uuid), '')" % (q(F), q(CO), q(BK)))
ok(lg == "", "a link made now takes no GUID: %r" % lg)
r = st.rpc(STAFF, "select tally_link_guid_pick(%s::uuid, %s)::text" % (q(BK), q(GUID)))
ok("_error" in r and "only an owner" in r["_error"], "staff may not pick: %s" % str(r)[:120])
r = st.rpc(OWNER, "select tally_link_guid_pick(%s::uuid, %s)::text" % (q(BK), q("abcd-not-marked")))
ok("_error" in r and "not one of the companies" in r["_error"], "a GUID not marked: refused: %s" % str(r)[:120])
r = st.rpc(OWNER, "select tally_link_guid_pick(%s::uuid, %s)::text" % (q(BK), q(GUID)))
ok(r.get("company_guid") == GUID and r.get("guid_pick") is None, "the owner picks: %s" % str(r)[:160])
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
beat_cos([[CO, GUID]])
n = one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
g = one("select coalesce(company_guid, '') from tally_links where book_id = %s" % q(BK))
pk = one("select coalesce(guid_pick::text, '') from tally_links where book_id = %s" % q(BK)) if not RED else ""
ok(n == "1" and g == GUID and pk == "", "exactly one of the name: filled by itself (%s, %r), no mark" % (n, g))
lg = one("select coalesce(tally_link_guid(%s::uuid, %s, %s::uuid), '')" % (q(F), q(CO), q(BK)))
ok(lg == GUID, "tally_link_guid with one company of the name: %r" % lg)

print("\nALL PASSED: %d" % len(fails) if not fails else "\nFAILED: %d\n  %s" % (len(fails), "\n  ".join(fails)))
sys.exit(1 if fails else 0)
