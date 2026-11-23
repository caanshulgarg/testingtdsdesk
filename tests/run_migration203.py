"""python3 run_migration203.py - server/tally-cloud/migration-203-post-linked-guid.sql (19-Nov-2026, branch
next-fix-linkedguid; the owner's hard rule: a posting goes only into the Tally company the client is linked to, by the
company's GUID). 203 is what this branch still needs after the applied 202 (migration-202-post-recheck.sql, live on
staging: the hand-out and the beat's count gated on the linked GUID, tally_post_linked_ok). On a throwaway PostgreSQL
(post_queue_stand: pg_stand, port 31207 unless PG203_PORT; never a real database): 184 and 185, then 199, 200, 201, 202
in one session and 201a, as on staging; made-up firms, logins and companies only. Checks:
  0. the file: one transaction, lock_timeout 3 s (the check validated in a second, short one of its own); add-only (three columns if not exists, the new column's check added NOT
     VALID and validated on its own, if not there; two triggers, if not there; no table; nothing dropped, deleted or
     truncated); every function's grants explicit; names no real database; refuses to run without the applied 202 (and
     says so); runs twice; 202's tally_post_take_for with only the GUID lines and the hold check in each stamp changed, 155's tally_link_guid_fill with one
     line added, 174's tally_post_job_blocked with its two 203 cases
  1. handed out while the bridge reports the linked GUID open, carrying it (company_guid, the GUID the gate judged)
  2. two open companies of that name in the bridge's list (one the linked GUID): not counted, not handed out, the posting
     says "two open companies in Tally are named ..." (202 alone hands it out); one closed again: handed out
  3. two linked books of the client's company name with different GUIDs: not handed out (no single linked GUID)
  4. a posting queued for no computer (185's third look) with two open companies of the name: not handed out
  5. a link without a GUID: filled from a beat with exactly one open company of the name; two of the name: nothing
     filled, marked "pick which company" (guid_pick) with both GUIDs and the posting says an owner picks; an owner picks
     (staff refused; a GUID not marked refused); a link made while two of the name are open takes no GUID (tally_link_guid)
  6. stamped as queued; the client linked to another company afterwards: held for a person (failed / stopped)
  7. a posting with no stamp: stamped at its hand-out; one whose link's GUID changed, or whose client was relinked, after
     it was made (tally_links.guid_changed_at, kept by the trigger tally_links_guid_changed, or linked_at, later than the
     posting): held for a person instead, never stamped with the new GUID (each of the three looks of the hand-out). A
     link changed otherwise (an owner's pick of its first GUID, posting allowed again, a rename, a data location
     chosen): handed out by itself, into the GUID the link has then. A link not touched since before 203 (its history
     not known): its updated_at stands for the change, as before
  8. the beat's count agrees with the hand-out for postings queued for no computer
  9. the beat's count timed against 202's text (1,000 own and 1,000 for no computer, waiting)
 10. the hold check and the stamp in one statement: the link's GUID changed after the posting was made, and the check
     before the hand-out not seeing it yet (as when the change commits between them): never stamped, held for a person
 11. the linked company open only in a Tally a posting would not use (the beat's openElsewhere): the posting says where and
     what to do (as the bridge says it), never "not open"; still not handed out
RED_WITHOUT_203=1: the same checks without the file (fails)."""
import os, re, sys, json, hashlib, time
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
tx = re.findall(r"(?ms)^begin;\s*\n(.*?)^commit;", text)
ok(len(tx) == 2 and code.count("\nbegin;") == 2 and text.rstrip().endswith("commit;") and all(t_.startswith("set local lock_timeout = '3s';") for t_ in tx)
   and "alter table" not in "\n".join(l.split("--")[0] for l in tx[1].lower().splitlines()).replace("alter table public.tally_post_jobs validate constraint", ""),
   "one transaction, lock_timeout 3 s; the check validated in a second one of its own (nothing else in it)")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "create table" not in code
   and code.count("create trigger") == 2 and "if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_guid'" in code
   and "if not exists (select 1 from pg_trigger where tgname = 'tally_links_guid_changed'" in code
   and re.findall(r"alter table ([\w.]+) add column if not exists (\w+)(\s+\w+)?\s*(check)?", code) == [("public.tally_post_jobs", "company_guid", " text", ""), ("public.tally_links", "guid_pick", " jsonb", ""), ("public.tally_links", "guid_changed_at", " timestamptz", "")]
   and len(re.findall(r"alter table", code)) == 5, "add-only: three columns (if not exists, no check inline), two triggers (if not there: the stamp as queued, the link's GUID change kept); no table; nothing dropped, deleted or truncated")
ok(re.search(r"alter table public\.tally_post_jobs add constraint tally_post_jobs_company_guid_check check \(company_guid is null or company_guid ~ '\^\[0-9a-z-\]\{1,100\}\$'\) not valid;", code) is not None
   and "alter table public.tally_post_jobs validate constraint tally_post_jobs_company_guid_check;" in code
   and "if not exists (select 1 from pg_constraint where conname = 'tally_post_jobs_company_guid_check'" in code,
   "the column's check added NOT VALID (if not there), then validated on its own")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok("raise exception 'migration 203 runs after 202" in text, "never runs without the applied 202")
ok("FinComVoucher" not in text and "<ENVELOPE>" not in text.upper(), "no new request to Tally")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(bool(made) and "tally_post_take_wait" not in made and "tally_post_guid_wait" not in made, "no second wait: %s" % made)
for fn in made:
    sig = re.search(r"create or replace function public\.%s\(([^)]*)\)" % fn, code).group(1)
    types = ", ".join(a.split()[-1] for a in sig.split(",") if a.strip())
    full = "public.%s(%s)" % (fn, types)
    ok(("revoke all on function %s from public, anon" % full) in code and ("grant execute on function %s to " % full) in code, "%s: grants explicit" % full)
ok(bool(made) and all(("security definer set search_path = public, pg_temp" in seg) for seg in code.split("create or replace function")[1:]), "every function security definer with a fixed search_path")
for fn, base, want in (("tally_post_take_for", "migration-202-post-recheck.sql", (10, 9)), ("tally_link_guid_fill", "migration-155-link-guid-fill.sql", (1, 0)),
                       ("tally_post_count_for", "migration-202-post-recheck.sql", (4, 2)), ("tally_post_job_blocked", "migration-174-post-jobs-safe.sql", (4, 0))):
    if ("create or replace function public." + fn + "(") not in text: ok(False, fn + ": not in the file"); continue
    a, b = PS.fbody(text, fn), PS.fbody(open(os.path.join(PS.SQLDIR, base)).read(), fn)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok((len(added), len(gone)) == want and all(any(w in l for w in ("company_guid", "tally_post_linked_open", "tally_link_guid_pick_mark", "tally_post_linked_ok", "tally_post_unrouted_ok", "uk.", "ug.", "linked to another tally company", "+ (with uk", "j.created_at", "tally_post_job_blocked(id) is null", "if found then return; end if;")) for l in [x.lower() for x in added]),
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
    ok(db.one("select convalidated::text from pg_constraint where conname = 'tally_post_jobs_company_guid_check'") == "true", "the column's check is validated")
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

print("== 6. stamped as queued; the link changed afterwards: held for a person, never handed to the new company")
close_all(); beat_cos([[CO, GUID]]); job(6)
ok(one("select coalesce(company_guid, '') from tally_post_jobs where id = %s" % q(J(6))) == GUID, "company_guid stamped as it is queued: %r" % one("select coalesce(company_guid, '') from tally_post_jobs where id = %s" % q(J(6))))
db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(OTHER), q(BK)))
beat_cos([[CO, OTHER]]); t = take()
WHY = "The client was linked to another Tally company after this posting was made: check the entries and post again"
ok(t is None and status(6) == "failed" and msg(6).startswith(WHY), "never handed to the new company; held for a person: %s %r (%s)" % (status(6), msg(6), t))
job(7); db.sql("update tally_post_jobs set company_guid = %s, taken_by = %s, first_taken_at = now() - interval '5 minutes', attempts = 1 where id = %s" % (q(GUID), q(BA), q(J(7))))
t = take(); sr = one("select coalesce(stop_reason, '') from tally_post_jobs where id = %s" % q(J(7)))
ok(t is None and sr.startswith(WHY), "one taken before (perhaps partly sent): stopped with the reason, never handed out: %r (%s)" % (sr, t))
db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(GUID), q(BK)))

print("== 7. a posting with no stamp: stamped at hand-out; the link's GUID changed or the client relinked since: held")
db.sql("update tally_links set linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % q(BK))
close_all(); beat_cos([[CO, GUID]]); job(8); db.sql("update tally_post_jobs set company_guid = null, created_at = now() where id = %s" % q(J(8)))
t = take(); ok(t is not None and t["id"] == J(8) and t["g"] == GUID, "the link unchanged since: handed out, stamped with the linked GUID: %s" % t)
stamp = lambda n: one("select coalesce(company_guid, '') from tally_post_jobs where id = %s" % q(J(n)))
def nostamp(n, dev=DA):   # a posting made a moment ago while its link had no GUID (so no stamp)
    close_all(); job(n, dev=dev); db.sql("update tally_post_jobs set company_guid = null, created_at = now() where id = %s" % q(J(n)))
def held(n, t):
    return t is None and status(n) == "failed" and msg(n).startswith(WHY) and stamp(n) == ""
# (the link's GUID back, a while ago: the change before every posting below)
db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))
# 7a. an owner's pick of the first GUID: the posting made while the link had none goes by itself, into the picked GUID
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
nostamp(85); beat_cos([[CO, GUID], [CO, OTHER]])
one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
r = st.rpc(OWNER, "select tally_link_guid_pick(%s::uuid, %s)::text" % (q(BK), q(GUID)))
beat_cos([[CO, GUID]]); t = take()
ok(r.get("company_guid") == GUID and t is not None and t["id"] == J(85) and t["g"] == GUID and stamp(85) == GUID,
   "7a. the first GUID picked after the posting was made: handed out by itself, into the picked GUID (%s, %s)" % (t, str(r)[:80]))
# 7b. a first GUID filled by itself (one open of the name): the same
db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
nostamp(86); beat_cos([[CO, GUID]]); one("select tally_link_guid_fill(%s::uuid, %s::uuid, %s)" % (q(F), q(DA), q(BA)))
t = take(); ok(t is not None and t["id"] == J(86) and t["g"] == GUID, "7b. the first GUID filled after the posting was made: handed out by itself (%s)" % t)
# 7c-e. posting allowed again, a rename, a data location chosen (updated_at later than the posting): handed out (posting
# switched off holds every waiting posting of the client by 174's own rule, with its own reason)
for n_, what, sql in ((87, "7c. posting allowed (switched on) again", "update tally_links set posting_allowed = true, updated_by = null, updated_at = now(), version = version + 1 where book_id = %s; select %s"),
                      (88, "7d. a rename", "update tally_links set company_name = company_name || '', updated_at = now(), version = version + 1 where book_id = %s; select %s"),
                      (89, "7e. a data location chosen", "update tally_links set data_loc = coalesce(data_loc, 'made-up-loc'), updated_at = now(), version = version + 1 where book_id = %s; select %s")):
    nostamp(n_); db.sql(sql % (q(BK), q(BK))); t = take()
    ok(t is not None and t["id"] == J(n_) and t["g"] == GUID, "%s after the posting was made: handed out with the link's GUID (%s)" % (what, t))
# 7f-h. the GUID really changed, or the client relinked, after the posting was made: held (each look of the hand-out)
for n_, what, dev_, sql in ((90, "the GUID changed", DA, "update tally_links set company_guid = %s, updated_at = now() where book_id = %s" % (q(OTHER), q(BK))),
                            (91, "the client relinked (linked_at)", DA, "update tally_links set linked_at = now(), updated_at = now() where book_id = %s" % q(BK)),
                            (92, "the GUID changed (no computer)", None, "update tally_links set company_guid = %s, updated_at = now() where book_id = %s" % (q(OTHER), q(BK)))):
    nostamp(n_, dev_); db.sql(sql); beat_cos([[CO, one("select company_guid from tally_links where book_id = %s" % q(BK))]]); t = take()
    ok(held(n_, t), "7f. %s after the posting was made: held for a person, never stamped: %s %r %r (%s)" % (what, status(n_), msg(n_)[:60], stamp(n_), t))
    db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))
beat_cos([[CO, GUID]])
job(84); db.sql("update tally_post_jobs set company_guid = null, created_at = now(), taken_by = %s, first_taken_at = now(), attempts = 1 where id = %s" % (q(BA), q(J(84))))
db.sql("update tally_links set company_guid = %s, updated_at = now() where book_id = %s" % (q(OTHER), q(BK)))
beat_cos([[CO, OTHER]]); t = take(); sr = one("select coalesce(stop_reason, '') from tally_post_jobs where id = %s" % q(J(84)))
ok(t is None and sr.startswith(WHY), "7g. one taken before (no stamp), the link's GUID changed since: stopped with the reason: %r (%s)" % (sr, t))
db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))
beat_cos([[CO, GUID]])
# 7h. a link not touched since before 203 (no record of its changes): its updated_at later than the posting holds it,
# as before; touched after (a pick, a toggle), that time is kept (never forgotten by the touch)
if not RED:
    db.sql("alter table tally_links disable trigger tally_links_guid_changed; update tally_links set guid_changed_at = null, updated_at = now() - interval '1 minute' where book_id = %s; alter table tally_links enable trigger tally_links_guid_changed" % q(BK))
for n_ in (93, 94):
    close_all(); job(n_); db.sql("update tally_post_jobs set company_guid = null, created_at = now() - interval '1 hour' where id = %s" % q(J(n_)))
    if n_ == 94: db.sql("update tally_links set posting_allowed = true, updated_at = now(), version = version + 1 where book_id = %s" % q(BK))
    t = take()
    ok(held(n_, t), "7h. %s: held for a person: %s %r (%s)" % ("a link not touched since before 203, changed after the posting" if n_ == 93 else "and touched since (the earlier change kept)", status(n_), msg(n_)[:60], t))
db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))

print("== 8. the beat's count agrees with the hand-out for postings queued for no computer")
close_all(); beat_cos([[CO, GUID], [CO, OTHER]]); job(9, dev=None)
c = count(); ok(c == "0" and take() is None, "two open companies of the name: not counted (%s), not handed out" % c)
beat_cos([[CO, GUID]]); c = count(); ok(c == "1", "one open: counted (%s)" % c)
close_all()

print("== 9. the beat's count timed (1,000 own and 1,000 for no computer, waiting), against 202's text")
m202 = open(M199_202[3]).read(); a_ = m202.index("create or replace function public.tally_post_count_for("); b_ = m202.index("$function$;", m202.index("$function$", a_) + 10) + len("$function$;")
db.sql(m202[a_:b_].replace("public.tally_post_count_for(", "public.tally_post_count_for_202(", 1))
for dv in (q(DA), "null"):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by, created_at) select extensions.gen_random_uuid(), %s, 'c1', %s, 'waiting', 1, '{}'::jsonb, %s, %s, now() - (g || ' seconds')::interval from generate_series(1, 1000) g"
           % (q(F), q(CO), dv, q(STAFF)))
beat_cos([[CO, GUID]])
def tpair(k=15):
    a_, b_ = [], []
    for _ in range(k):
        for fn, ts in (("tally_post_count_for", a_), ("tally_post_count_for_202", b_)):
            t0 = time.time(); o_ = db.one("set role service_role; select %s(%s::uuid, %s, true)::text" % (fn, q(DA), q(BA))); ts.append((time.time() - t0, o_))
    return a_[0][1], sorted(t for t, _ in a_)[k // 2], b_[0][1], sorted(t for t, _ in b_)[k // 2]
tpair(3)   # (warm)
n_new, t_new, n_old, t_old = tpair()
print("    202 %.0f ms (%s), 203 %.0f ms (%s)" % (t_old * 1000, n_old, t_new * 1000, n_new))
ok(n_new == n_old and n_new not in ("", "0") and t_new <= t_old * 1.25 + 0.03, "the gate open: counted alike, never slower than 202 (%.0f ms against %.0f ms)" % (t_new * 1000, t_old * 1000))
close_all()

print("== 10. the hold check and the stamp in one statement")
# the check before the hand-out answers "nothing holds it" once (the link's change not seen yet); every later look sees it
db.sql("""alter function public.tally_post_job_blocked(uuid) rename to tally_post_job_blocked_t203;
create function public.tally_post_job_blocked(p_job uuid) returns text language plpgsql volatile security definer set search_path = public, pg_temp as $f$
declare n integer := coalesce(nullif(current_setting('t203.n', true), ''), '0')::integer + 1;
begin perform set_config('t203.n', n::text, true); if n = 1 then return null; end if; return tally_post_job_blocked_t203(p_job); end $f$;
grant execute on function public.tally_post_job_blocked(uuid) to service_role;""")
try:
    for n_, dev_, what in ((101, DA, "its computer"), (102, None, "no computer")):
        db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))
        db.sql("update tally_links set company_guid = null where book_id = %s" % q(BK))
        nostamp(n_, dev_)
        db.sql("update tally_links set company_guid = %s where book_id = %s" % (q(GUID), q(BK)))   # (a first GUID: no hold)
        db.sql("update tally_links set company_guid = %s, updated_at = now() where book_id = %s" % (q(OTHER), q(BK)))   # (a real change)
        beat_cos([[CO, OTHER]]); t = take()
        ok(t is None and stamp(n_) == "" and status(n_) == "failed" and msg(n_).startswith(WHY),
           "10. %s: the change seen only by the stamping statement: never stamped, held (%s %r %r, %s)" % (what, status(n_), stamp(n_), msg(n_)[:60], t))
finally:
    db.sql("drop function public.tally_post_job_blocked(uuid); alter function public.tally_post_job_blocked_t203(uuid) rename to tally_post_job_blocked;")
    db.sql("update tally_links set company_guid = %s, linked_at = now() - interval '1 day', updated_at = now() - interval '1 day' where book_id = %s" % (q(GUID), q(BK)))
close_all()

print("== 11. the linked company open only in a Tally a posting would not use")
for n_, why, want in ((111, "owner unknown", "Tally on port 9001 has it open, but Windows cannot tell whose Tally that is"), (112, "other user", "open only in another Windows user's Tally (port 9001)")):
    close_all(); info = st.beat("made-up-a", BA, [CO])   # (the bridge's open list names it: some Tally has it open)
    info["bridges"][BA]["cos"] = []
    info["beat"]["companies"] = [{"name": CO, "guid": "", "open": False, "openElsewhere": {"port": 9001, "why": why}}]
    st.setbeat(DA, info); job(n_); c = count(); t = take()
    ok(c == "0" and t is None and want in msg(n_) and "is not open in Tally" not in msg(n_), "11. %s: not handed out, the posting says where: %r" % (why, msg(n_)))
# the final review (nit a): the words only from the beat of the bridge the posting is for (the computer's latest beat sent by
# another bridge, or a beat that does not say which bridge sent it: the plain words, never another bridge's Tally)
for n_, by in ((113, BB), (114, None)):
    close_all(); info = st.beat("made-up-a", BA, [CO])
    info["bridges"][BA]["cos"] = []
    info["beat"]["companies"] = [{"name": CO, "guid": "", "open": False, "openElsewhere": {"port": 9001, "why": "owner unknown"}}]
    if by: info["beat"]["bridge"] = by
    else: info["beat"].pop("bridge", None)
    st.setbeat(DA, info); job(n_); c = count(); t = take()
    ok(c == "0" and t is None and "port 9001" not in msg(n_) and msg(n_), "11. the beat %s: no words from it: %r" % ("of another bridge" if by else "naming no bridge", msg(n_)))
close_all()

print("== 12. (next-fix-post-resume) a posting paused part-way and put back by tally-ingest: only its own bridge takes it")
# tally-ingest's resumePaused (the owner's "yes to both", 23-Nov-2026) puts a posting FinCom stopped part-way back to waiting
# with taken_by kept, in words that are not "Put back for the same FinCom Bridge" (no 30 s more). The hand-out (203's text,
# as applied) gives a posting once taken only to the bridge that took it, on its own key: bridge B, another computer key with
# the same company open (the linked GUID), never gets it, at once or later; bridge A takes it at once
close_all(); beat_cos([[CO, GUID]])
info_b = st.beat("made-up-b", BB, [CO]); info_b["bridges"][BB]["cos"] = [[CO, GUID]]; st.setbeat(DB, info_b)
job(121)
db.sql("update tally_post_jobs set status = 'waiting', taken_by = %s, target_bridge = %s, taken_at = now() - interval '5 minutes', first_taken_at = now() - interval '5 minutes', attempts = 1, seq = 5, "
       "message = 'Carrying on: FinCom Bridge sends the rest of this posting now; what it already sent to Tally is never sent again.', updated_at = now() where id = %s" % (q(BA), q(BA), q(J(121))))
tb = take(DB, BB)
ok(tb is None and status(121) == "waiting", "12. bridge B on another key, the company open there too: not handed it (%s, %s)" % (tb, status(121)))
ok(count(DB, BB) == "0", "12. not counted for bridge B either (%s)" % count(DB, BB))
ta = take()
ok(ta is not None and ta["id"] == J(121) and one("select taken_by from tally_post_jobs where id = %s" % q(J(121))) == BA, "12. bridge A, which took it first: handed it at once (%s)" % ta)
# (the check's control: bridge B, as it beats here, does take a posting of its own key for that company)
close_all(); job(122, dev=DB)
tb = take(DB, BB)
ok(tb is not None and tb["id"] == J(122), "12. (control) bridge B takes a posting of its own key for the company (%s)" % tb)
st.setbeat(DB, st.beat("made-up-b", BB, [], ago=30))
close_all()

print("\nALL PASSED: %d" % len(fails) if not fails else "\nFAILED: %d\n  %s" % (len(fails), "\n  ".join(fails)))
sys.exit(1 if fails else 0)
