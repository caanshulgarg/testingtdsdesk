"""python3 run_migration203.py - server/tally-cloud/migration-203-post-linked-guid.sql (19-Nov-2026, branch
next-fix-linkedguid; the owner's hard rule: a posting goes only into the Tally company the client is linked to, by the
company's GUID). 203 is what this branch still needs after the applied 202 (migration-202-post-recheck.sql, live on
staging: the hand-out and the beat's count gated on the linked GUID, tally_post_linked_ok). On a throwaway PostgreSQL
(post_queue_stand: pg_stand, port 31207 unless PG203_PORT; never a real database): 184 and 185, then 199, 200, 201, 202
in one session and 201a, as on staging; made-up firms, logins and companies only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (two columns if not exists; no table, no trigger; nothing
     dropped, deleted or truncated); every function's grants explicit; names no real database; refuses to run without the
     applied 202 (and says so); runs twice; 202's tally_post_take_for with only the GUID lines changed, 155's
     tally_link_guid_fill with one line added
  1. handed out while the bridge reports the linked GUID open, carrying it (company_guid, the GUID the gate judged)
  2. two open companies of that name in the bridge's list (one the linked GUID): not counted, not handed out, the posting
     says "two open companies in Tally are named ..." (202 alone hands it out); one closed again: handed out
  3. two linked books of the client's company name with different GUIDs: not handed out (no single linked GUID)
  4. a posting queued for no computer (185's third look) with two open companies of the name: not handed out
  5. a link without a GUID: filled from a beat with exactly one open company of the name; two of the name: nothing
     filled, marked "pick which company" (guid_pick) with both GUIDs and the posting says an owner picks; an owner picks
     (staff refused; a GUID not marked refused); a link made while two of the name are open takes no GUID (tally_link_guid)
RED_WITHOUT_203=1: the same checks without the file (fails)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, OWNER, STAFF, DA, DB, BA, BB, BK, CO, GUID
M184, M185 = (os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
M199_202 = [os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql")]
M201A = os.path.join(PS.SQLDIR, "migration-201a-post-grants.sql")
M203 = os.path.join(PS.SQLDIR, "migration-203-post-linked-guid.sql")
RED = os.environ.get("RED_WITHOUT_203") == "1"
OTHER = "f0f0f0f0-0000-0000-0000-000000000203"   # a made-up second company of the same name
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text = open(M203).read() if os.path.exists(M203) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M203), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "create table" not in code and "create trigger" not in code
   and re.findall(r"alter table ([\w.]+) add column if not exists (\w+)", code) == [("public.tally_post_jobs", "company_guid"), ("public.tally_links", "guid_pick")]
   and len(re.findall(r"alter table", code)) == 2, "add-only: two columns (if not exists); no table, no trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok("raise exception 'migration 203 runs after 202" in text, "never runs without the applied 202")
ok("FinComVoucher" not in text and "<ENVELOPE>" not in text.upper(), "no new request to Tally")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(bool(made) and "tally_post_count_for" not in made and "tally_post_take_wait" not in made and "tally_post_guid_wait" not in made, "202's count left as it is (it asks the gate 203 replaces); no second wait: %s" % made)
for fn in made:
    sig = re.search(r"create or replace function public\.%s\(([^)]*)\)" % fn, code).group(1)
    types = ", ".join(a.split()[-1] for a in sig.split(",") if a.strip())
    full = "public.%s(%s)" % (fn, types)
    ok(("revoke all on function %s from public, anon" % full) in code and ("grant execute on function %s to " % full) in code, "%s: grants explicit" % full)
ok(bool(made) and all(("security definer set search_path = public, pg_temp" in seg) for seg in code.split("create or replace function")[1:]), "every function security definer with a fixed search_path")
for fn, base, want in (("tally_post_take_for", "migration-202-post-recheck.sql", (4, 3)), ("tally_link_guid_fill", "migration-155-link-guid-fill.sql", (1, 0))):
    if not text: ok(False, fn + ": no file"); continue
    a, b = PS.fbody(text, fn), PS.fbody(open(os.path.join(PS.SQLDIR, base)).read(), fn)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok((len(added), len(gone)) == want and all("company_guid" in l or "tally_post_linked_open" in l or "tally_link_guid_pick_mark" in l for l in added),
       "%s: the latest text (%s) with %d added / %d changed lines (want %s): %s" % (fn, base.split("-")[1], len(added), len(gone), want, [l[:90] for l in added]))

st = PS.Stand(int(os.environ.get("PG203_PORT") or 31207), extra=(M184, M185)); db = st.db
import atexit; atexit.register(lambda: st.stop())   # the stand stopped however the run ends
m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
if text:
    r = st.psql_text(text)
    ok(r.returncode != 0 and "runs after 202" in (r.stderr or ""), "without the applied 202 first: refused (%s)" % (r.stderr or "").strip()[-120:])
else: ok(False, "without the applied 202 first: no file")
r = st.psql_text("\n".join(open(p).read() for p in M199_202)); ok(r.returncode == 0, "199, 200, 201, 202 applied together in one session %s" % (r.stderr or "").strip()[-300:])
r = st.psql_text(open(M201A).read()); ok(r.returncode == 0, "201a %s" % (r.stderr or "").strip()[-200:])
if not RED and text:
    r = st.psql_text(text); ok(r.returncode == 0, "203 runs %s" % (r.stderr or "").strip()[-300:])
    r = st.psql_text(text); ok(r.returncode == 0, "203 runs twice %s" % (r.stderr or "").strip()[-200:])
st.grants()

J = lambda n: "%08d-0000-0000-0000-000000000203" % n
def job(n, dev=DA, company=CO):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, 'waiting', 1, %s, %s, %s)"
           % (q(J(n)), q(F), q(company), q(json.dumps({"vouchers": [{"id": "e%d" % n, "xml": "<VOUCHER/>"}]})), "null" if dev is None else q(dev), q(STAFF)))
def take(dev=DA, bridge=BA):
    try: r = db.rows("set role service_role; select id::text, coalesce(to_jsonb(t) ->> 'company_guid', '') g from tally_post_take_for(%s::uuid, %s, true) t" % (q(dev), q(bridge)))
    except RuntimeError as e: return {"id": "ERROR " + str(e)[-120:], "g": ""}
    return r[0] if r else None
count = lambda dev=DA, bridge=BA: db.one("set role service_role; select tally_post_count_for(%s::uuid, %s, true)::text" % (q(dev), q(bridge)))
msg = lambda n: db.one("select coalesce(message, '') from tally_post_jobs where id = %s" % q(J(n))) or ""
status = lambda n: db.one("select status from tally_post_jobs where id = %s" % q(J(n))) or ""
def beat_cos(cos, dev=DA, user="made-up-a", bridge=BA):
    info = st.beat(user, bridge, [CO])
    info["bridges"][bridge]["cos"] = cos
    info["beat"]["companies"] = [{"name": n, "guid": g, "open": True} for n, g in cos]
    st.setbeat(dev, info)
def close_all(): db.sql("update tally_post_jobs set status = 'done' where status in ('waiting', 'taken', 'running')")
one = lambda sql: db.one(sql) or ""
st.setbeat(DB, st.beat("made-up-b", BB, [], ago=30))   # bridge B: nothing open (never takes it)

print("== 1. handed out while the linked GUID is open, carrying it")
close_all(); beat_cos([[CO, GUID]]); job(1)
t = take(); ok(t is not None and t["id"] == J(1) and t["g"] == GUID, "handed out with the linked GUID: %s" % t)
ok(one("select coalesce(company_guid, '') from tally_post_jobs where id = %s" % q(J(1))) == GUID if not RED else False, "the posting keeps the GUID it was handed out for")

print("== 2. two open companies of that name (one the linked GUID)")
close_all(); beat_cos([[CO, GUID], [CO, OTHER]]); job(2)
c = count(); t = take()
ok(c == "0" and t is None and status(2) == "waiting", "not counted (%s), not handed out (%s), still waiting" % (c, t))
ok("two open companies in Tally are named " + CO in msg(2), "the posting says why: %r" % msg(2))
beat_cos([[CO, GUID]]); c = count(); t = take()
ok(c == "1" and t is not None and t["id"] == J(2) and t["g"] == GUID, "the other one closed: counted, handed out with the GUID (%s, %s)" % (c, t))

print("== 3. two linked books of the client's company name with different GUIDs")
close_all()
BK2 = "b0000002-0000-0000-0000-000000000203"; CO2 = CO + " "   # the same name to tally_nm, another book
try:
    db.sql("insert into tally_companies (firm_id, company, client_id, device_id, last_seen, linked_at, book_id) values (%s, %s, 'c1', %s, now(), now(), %s)" % (q(F), q(CO2), q(DA), q(BK2)))
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user) "
           "select firm_id, %s, client_id, %s, %s, device_id, computer, posting_allowed, state, data_loc, data_folder, windows_user from tally_links where book_id = %s "
           "on conflict (firm_id, book_id) do update set company_guid = excluded.company_guid, state = 'linked', client_id = 'c1'" % (q(BK2), q(OTHER), q(CO2), q(BK)))
    beat_cos([[CO, GUID]]); job(3); t = take()
    ok(t is None and status(3) == "waiting", "no single linked GUID: not handed out (%s)" % t)
finally:
    db.sql("delete from tally_links where book_id = %s; delete from tally_companies where book_id = %s" % (q(BK2), q(BK2)))

print("== 4. queued for no computer, two open companies of the name")
close_all(); beat_cos([[CO, GUID], [CO, OTHER]]); job(4, dev=None)
t = take(); ok(t is None and status(4) == "waiting", "185's third look: not handed out (%s)" % t)
beat_cos([[CO, GUID]]); t = take(); ok(t is not None and t["id"] == J(4) and t["g"] == GUID, "one open: handed out with the GUID (%s)" % t)

print("== 5. a link without a GUID: filled from one, marked from two, an owner picks")
close_all()
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
db.sql("delete from tally_sync_cursor where book_id = %s" % q(BK)) if one("select to_regclass('public.tally_sync_cursor') is not null") == "t" else None
beat_cos([[CO, GUID], [CO, OTHER]])
try: n = one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
except RuntimeError as e: n = "ERROR " + str(e)[-80:]
g = one("select coalesce(company_guid, '') from tally_links where book_id = %s" % q(BK))
pk = one("select coalesce(guid_pick::text, '') from tally_links where book_id = %s" % q(BK)) if one("select (to_regclass('public.tally_links') is not null and exists (select 1 from information_schema.columns where table_name = 'tally_links' and column_name = 'guid_pick'))::text") == "true" else ""
ok(n == "0" and g == "" and GUID in pk and OTHER in pk, "two of the name: nothing filled (%s, %r), marked %s" % (n, g, pk[:120]))
job(5); count()
ok("an owner picks which one is the client's" in msg(5), "the posting says an owner picks: %r" % msg(5))
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
try: n = one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
except RuntimeError as e: n = "ERROR " + str(e)[-80:]
g = one("select coalesce(company_guid, '') from tally_links where book_id = %s" % q(BK))
pk = one("select coalesce(guid_pick::text, '') from tally_links where book_id = %s" % q(BK)) if not RED else ""
ok(n == "1" and g == GUID and pk == "", "exactly one of the name: filled by itself (%s, %r), no mark" % (n, g))
lg = one("select coalesce(tally_link_guid(%s::uuid, %s, %s::uuid), '')" % (q(F), q(CO), q(BK)))
ok(lg == GUID, "tally_link_guid with one company of the name: %r" % lg)

print("\nALL PASSED: %d" % len(fails) if not fails else "\nFAILED: %d\n  %s" % (len(fails), "\n  ".join(fails)))
sys.exit(1 if fails else 0)
