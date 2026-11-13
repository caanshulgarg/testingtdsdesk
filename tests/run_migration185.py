"""python3 run_migration185.py - server/tally-cloud/migration-185-post-unrouted.sql (13-Nov-2026, branch
next-post-queue-anyway; item D of the posting reliability plan, approved by the owner). On a throwaway PostgreSQL
(post_queue_stand: pg_stand, port 31185 unless PG185_PORT; never a real database; built as run_migration174.py with 174
and 184 run), made-up firms, logins and companies only. One shared server (SRV9), two Windows logins, each its own key and
bridge: A (the link's key) and B, both reading the link's data folder. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table, column, index; no drop, delete or truncate); the
     three new helpers service_role only; the six replaced functions start from their latest text (174, 142, 184) and
     change only the lines counted, their grants restated; names no real database; md5; runs twice
  1. a bridge has the company open: queued for it as before (not unrouted), and it takes it
  2. no computer has it open: queued all the same for no computer (device_id null, no bridge named), the plain words;
     nobody is told of it nor handed it while the company is closed
  3. who may take it: not a bridge with a company of that name under another GUID, nor one reading another data folder,
     nor one on another computer, nor one not heard for 3 minutes, nor a Changes-only one, nor one with no "go-" id (never
     told, never handed, by tally_post_take either); the first bridge with that very company open is told (count) and
     takes it: it is then that bridge's (device_id, target_bridge, taken_by); nobody else gets it
  4. two bridges at the same moment: exactly one is handed it (one holding its transaction open; 4 rounds together)
  5. once taken it is 174's: put back by the cron for the same bridge only; the other never takes it
  6. unlinked, or posting stopped, while it waits: failed with the reason (174), never handed out
  7. a bridge named that cannot post it (another computer named, Changes only, another member's): queued for no computer
     instead of refused; the company's computer key removed: queued too
  8. a link with no data location (or no GUID): refused in the words as before, nothing queued
  9. a waiting posting never taken whose bridge can no longer post: queued for no computer (the rescue counts it), not
     failed; a Retry of a failed one likewise; one once taken: held as 174, never moved; a posting only recorded (132):
     never handed to a bridge
  10. item C still holds: an entry in a posting queued for no computer is not queued twice
RED_WITHOUT_185=1: the same checks without the file (2-4, 7, 9 and 10 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, OWNER, STAFF, DA, DB, BA, BB, BK, CO, GUID, FOLDER
M184 = os.path.join(PS.SQLDIR, "migration-184-post-dupes.sql")
M185 = os.path.join(PS.SQLDIR, "migration-185-post-unrouted.sql")
RED = os.environ.get("RED_WITHOUT_185") == "1"
# lines added / changed against each function's latest text
DIFF = {"tally_post_take_for": ("migration-174-post-jobs-safe.sql", 9, 0), "tally_post_count_for": ("migration-142-post-any-bridge.sql", 3, 0),
        "tally_post_reroute": ("migration-174-post-jobs-safe.sql", 19, 1), "tally_post_rescue": ("migration-174-post-jobs-safe.sql", 3, 3),
        "tally_post_enqueue_core": ("migration-184-post-dupes.sql", 13, 4), "tally_post_enqueue_to": ("migration-142-post-any-bridge.sql", 23, 11)}
NEW = {"tally_post_unrouted_words": "(uuid, text, text)", "tally_post_unrouted_can": "(uuid, text, text)", "tally_post_unrouted_ok": "(uuid, uuid, text)"}
isw = lambda m: str(m).startswith("Queued: posts by itself when %s is opened in Tally on SRV9" % CO) and str(m).endswith(" with FinCom Bridge")   # the link's computer (and folder, when the record has it)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M185).read() if os.path.exists(M185) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M185), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "alter table" not in code and "create table" not in code and re.findall(r"create (?:unique )?index (?:if not exists )?(\w+)", code) == ["tally_post_jobs_unrouted"] and "create index if not exists tally_post_jobs_unrouted" in code and "create trigger" not in code,
   "add-only: one partial index (if not exists); no table, column or trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == sorted(list(NEW) + list(DIFF)), "makes or replaces only %s" % made)
for fn, sig in NEW.items():
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only, granted explicitly" % fn)
for fn, sig in (("tally_post_take_for", "(uuid, text, boolean)"), ("tally_post_count_for", "(uuid, text, boolean)"), ("tally_post_enqueue_core", "(uuid, text, jsonb, uuid, text)")):
    ok(("revoke all on function public.%s%s from public, anon, authenticated;" % (fn, sig)) in text and ("grant execute on function public.%s%s to service_role;" % (fn, sig)) in text, "%s: service_role only, restated" % fn)
ok("revoke all on function public.tally_post_reroute(uuid, boolean) from public, anon, authenticated;" in text and "grant execute on function public.tally_post_reroute(uuid, boolean) to service_role;" in text
   and "revoke all on function public.tally_post_rescue(uuid) from public, anon, authenticated;" in text and "grant execute on function public.tally_post_rescue(uuid) to service_role;" in text, "tally_post_reroute, tally_post_rescue: service_role only, granted explicitly")
ok("revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;" in text and "grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;" in text,
   "tally_post_enqueue_to: authenticated and service_role, as 142")
for name, (base, n_add, n_gone) in DIFF.items():
    if not text: ok(False, name + ": no file"); continue
    a, b = PS.fbody(text, name), PS.fbody(open(os.path.join(PS.SQLDIR, base)).read(), name)
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok(len(added) == n_add and len(gone) == n_gone, "%s: the latest text (%s) with %d line(s) added, %d changed (%d / %d): %s" % (name, base.split("-")[1], n_add, n_gone, len(added), len(gone), gone))
ok("tally_post_pickable_ok" not in made and "tally_post_requeue" not in made and "tally_post_cancel" not in made, "142's pick-up rule, the requeue and Cancel are not replaced")

st = PS.Stand(int(os.environ.get("PG185_PORT") or 31185), extra=[M184]); db = st.db
J = lambda n: "%08d-0000-0000-0000-000000000185" % n
V = lambda *ids: [{"id": i, "xml": "<VOUCHER/>"} for i in ids]
def enq(n, ids, uid=STAFF, target=None, device=None, client="c1"):
    return st.rpc(uid, "select tally_post_enqueue_to(%s::uuid, %s, %s::jsonb, %s, %s)::text" % (q(J(n)), q(client), q(json.dumps({"vouchers": V(*ids)})), q(target) if target else "null", (q(device) + "::uuid") if device else "null"))
def take(dev, bridge, main=True):
    r = db.rows("select id::text, coalesce(device_id::text, '') dev, coalesce(target_bridge, '') target_bridge, coalesce(taken_by, '') taken_by, status from tally_post_take_for(%s::uuid, %s, %s)" % (q(dev), q(bridge), "true" if main else "false"))
    return r[0] if r else None
take_sql = lambda dev, bridge: "select coalesce((select id::text from tally_post_take_for(%s::uuid, %s, true)), 'none');" % (q(dev), q(bridge))
count = lambda dev, bridge, main=True: int(db.one("select tally_post_count_for(%s::uuid, %s, %s)" % (q(dev), q(bridge), "true" if main else "false")) or 0)
import collections
row = lambda n: collections.defaultdict(str, (db.rows("select coalesce(device_id::text, '') dev, coalesce(target_bridge, '') target_bridge, coalesce(taken_by, '') taken_by, coalesce(taken_at::text, '') taken_at, coalesce(first_taken_at::text, '') first_taken, status, attempts::text attempts, coalesce(message, '') message from tally_post_jobs where id = %s" % q(J(n))) or [{}])[0])   # a posting not there: empty
unrouted = lambda n: (lambda x: bool(x) and x["status"] == "waiting" and x["dev"] == "" and x["target_bridge"] == "" and x["taken_by"] == "" and x["taken_at"] == "")(row(n))
def clear(): db.sql("update tally_post_jobs set status = 'cancelled' where status in ('waiting', 'taken', 'running')")
A = lambda open_=(CO,), **k: st.setbeat(DA, st.beat("made-up-a", BA, list(open_), **k))
B = lambda open_=(CO,), **k: st.setbeat(DB, st.beat("made-up-b", BB, list(open_), **k))
def relink(loc=True, guid=True):
    db.sql("update tally_links set state = 'linked', client_id = 'c1', posting_allowed = true, data_loc = %s, company_guid = %s where firm_id = %s and book_id = %s" % (q(st.loc) if loc else "null", q(GUID) if guid else "null", q(F), q(BK)))
    db.sql("update tally_companies set client_id = 'c1', device_id = %s where firm_id = %s and book_id = %s" % (q(DA), q(F), q(BK)))
try:
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_185: not run)" % n); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    if not RED:
        priv = lambda role, sig: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(sig)))
        ok(all(priv("authenticated", "public.%s%s" % (f, s)) == "false" and priv("anon", "public.%s%s" % (f, s)) == "false" and priv("service_role", "public.%s%s" % (f, s)) == "true" for f, s in NEW.items()),
           "the new helpers: not for anon or authenticated; service_role may")
        ok(priv("authenticated", "public.tally_post_take_for(uuid, text, boolean)") == "false" and priv("authenticated", "public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text)") == "false"
           and priv("authenticated", "public.tally_post_reroute(uuid, boolean)") == "false" and priv("authenticated", "public.tally_post_rescue(uuid)") == "false"
           and priv("authenticated", "public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid)") == "true" and priv("anon", "public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid)") == "false", "the replaced ones: as before")
        for rr in db.rows("select p.proname n, md5(p.prosrc) m, p.prosecdef::text d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[%s]) order by 1" % ",".join(q(f) for f in list(NEW) + list(DIFF))):
            print("  read-back %(n)s md5(prosrc)=%(m)s definer=%(d)s" % rr)
    st.grants()

    print("== 1. a bridge has the company open: as before")
    A(); B([])
    r = enq(1, ["V1"])
    x = row(1); ok(r.get("ok") is True and "unrouted" not in r and bool(x) and x["dev"] == DA and x["target_bridge"] == BA, "queued for the bridge that has it open, not unrouted (%s / %s)" % (r, x))
    t = take(DA, BA); ok(t is not None and t["id"] == J(1) and t["taken_by"] == BA, "and it takes it (%s)" % t)
    clear()

    print("== 2. no computer has the company open")
    A([]); B([])
    r = enq(2, ["V2"])
    ok(r.get("ok") is True and r.get("unrouted") is True and r.get("id") == J(2), "queued all the same (%s)" % (r.get("error") or r.get("_error") or r))
    ok(isw(r.get("note")) and row(2)["message"] == r.get("note"), "the plain words, in the answer and on the posting (%s)" % (row(2) or {}).get("message"))
    ok(unrouted(2), "for no computer: device_id null, no bridge named, waiting, never taken (%s)" % row(2))
    ok(db.one("select string_agg(live::text, ',') from tally_post_ids where job_id = %s" % q(J(2))) == "true", "its entry's id is live (never queued twice)")
    ok(count(DA, BA) == 0 and count(DB, BB) == 0 and take(DA, BA) is None and take(DB, BB) is None and unrouted(2), "company closed everywhere: nobody told, nobody handed it")

    print("== 3. who may take it")
    B([CO], guid="ffffffff-0000-0000-0000-00000000dead")
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "a company of that name under another GUID: not told, not handed")
    B([CO], folder="D:\\Restored\\Copy")
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "the same GUID read from another data folder (a copy): not handed")
    B([CO], computer="LAPTOP7")
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "the same GUID and folder path on another computer: not handed")
    st.setbeat(DB, {k: v for k, v in st.beat("made-up-b", BB, [CO]).items() if k != "beat"} | {"beat": {"at": "", "open": [CO], "companies": [{"name": CO, "open": True}]}})
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "a beat that names no GUID for it: not handed (the GUID must be proved)")
    B([CO], ago=5)
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "not heard from for 5 minutes: not handed")
    B([CO]); db.sql("insert into tally_bridge_prefs (device_id, bridge_id, firm_id, changes_only) values (%s, %s, %s, true) on conflict (device_id, bridge_id) do update set changes_only = true" % (q(DB), q(BB), q(F)))
    ok(count(DB, BB) == 0 and take(DB, BB) is None and unrouted(2), "a Changes-only bridge: not handed")
    db.sql("update tally_bridge_prefs set changes_only = false where device_id = %s" % q(DB))
    i = st.beat("made-up-b", BB, [CO]); i["bridges"]["v1"] = dict(i["bridges"][BB]); st.setbeat(DB, i)
    ok(count(DB, "v1") == 0 and take(DB, "v1") is None and not db.rows("select id from tally_post_take(%s::uuid)" % q(DB)) and unrouted(2), "a bridge with no go- id (1.15.0): never told, never handed (tally_post_take neither)")
    B([CO])
    ok(count(DB, BB) == 1, "B opens that very company (the link's GUID, its data folder): told of it at its beat (count %d)" % count(DB, BB))
    t = take(DB, BB)
    ok(t is not None and t["id"] == J(2) and t["status"] == "taken" and t["dev"] == DB and t["target_bridge"] == BB and t["taken_by"] == BB, "and takes it: now B's own (device_id, target_bridge, taken_by) (%s)" % t)
    x = row(2); ok(x["first_taken"] != "" and x["taken_at"] != "" and "queued for whichever computer opens it" in x["message"], "the take's history kept; the words say how (%s)" % x["message"])
    A(); ok(take(DA, BA) is None and take(DB, BB) is None and count(DA, BA) == 0, "nobody else is handed it, nor B twice")

    print("== 4. two bridges at the same moment")
    clear(); A([]); B([])
    r = enq(40, ["V40"]); ok(r.get("unrouted") is True, "queued for no computer")
    A(); B()
    ok(count(DA, BA) == 1 and count(DB, BB) == 1, "both have that very company open now: both told")
    a, b = st.pair(take_sql(DA, BA), take_sql(DB, BB), hold=1.5, gap=0.5)
    ok(a == J(40) and b == "none", "A's take still open: B is handed nothing (%s / %s)" % (a, b))
    x = row(40); ok(x["status"] == "taken" and x["taken_by"] == BA and x["dev"] == DA, "it is A's (%s)" % x)
    good = True; seen = ""
    for k in range(4):
        clear(); A([]); B([])
        r = enq(41 + k, ["V%d" % (41 + k)]); A(); B()
        a, b = st.pair(take_sql(DA, BA), take_sql(DB, BB), hold=0)
        x = row(41 + k)
        if not r.get("unrouted") or sorted([a, b]) != sorted([J(41 + k), "none"]) or x["status"] != "taken" or x["taken_by"] != (BA if a == J(41 + k) else BB): good = False; seen = "%s / %s / %s" % (a, b, x)
    ok(good, "4 rounds started together: exactly one bridge is handed it each time %s" % seen)

    print("== 5. once taken it is 174's")
    x = row(44); who = x["taken_by"]; other = (DB, BB) if who == BA else (DA, BA); mine = (DA, BA) if who == BA else (DB, BB)
    db.sql("update tally_post_jobs set taken_at = now() - interval '11 minutes', updated_at = now() - interval '11 minutes' where id = %s" % q(J(44)))
    st.setbeat(mine[0], st.beat("made-up-a" if who == BA else "made-up-b", who, [CO], ago=11))
    db.one("select tally_post_requeue()")
    x = row(44); ok(x["status"] == "waiting" and x["taken_by"] == who and x["dev"] == mine[0], "its bridge went quiet: put back for the same bridge, not for no computer (%s)" % x)
    ok(count(*other) == 0 and take(*other) is None and row(44)["status"] == "waiting", "the other bridge (company open) is never told of it nor handed it")
    st.setbeat(mine[0], st.beat("made-up-a" if who == BA else "made-up-b", who, [CO]))
    t = take(*mine); ok(t is not None and t["id"] == J(44), "its own bridge takes it back (%s)" % t)

    print("== 6. unlinked or posting stopped while it waits")
    clear(); A([]); B([])
    r = enq(60, ["V60"]); ok(unrouted(60), "queued for no computer")
    r = st.rpc(STAFF, "select tally_link_set(%s, null)::text" % q(CO))
    x = row(60); ok("_error" not in r and x["status"] == "failed" and "was unlinked" in x["message"], "the client unlinked: failed at once with the reason (%s / %s)" % (x["status"], x["message"][:80]))
    relink()
    r = enq(61, ["V61"]); ok(unrouted(61), "linked again: queued for no computer")
    db.sql("update tally_links set posting_allowed = false where firm_id = %s and book_id = %s" % (q(F), q(BK)))
    x = row(61); ok(x["status"] == "failed" and "posting into Tally was stopped" in x["message"], "posting stopped: failed with the reason (%s)" % x["message"][:80])
    relink(); r = enq(62, ["V62"])
    db.sql("alter table tally_links disable trigger tally_post_links_hold; update tally_links set posting_allowed = false where firm_id = %s and book_id = %s; alter table tally_links enable trigger tally_post_links_hold" % (q(F), q(BK)))
    B(); ok(take(DB, BB) is None and row(62)["status"] == "failed", "stopped with no trigger seeing it: not handed out, failed at the take (%s)" % row(62)["status"])
    relink(); clear()

    print("== 7. a bridge named that cannot post it; the company's key removed")
    A([]); B([])
    r = enq(70, ["V70"], uid=OWNER, target=BB, device=DA)
    ok(r.get("ok") is True and r.get("unrouted") is True and unrouted(70), "named with another computer than its own: queued for no computer, not refused (%s)" % (r.get("error") or r.get("_error") or "ok"))
    ok("Not sent through the bridge chosen: That bridge is not on the computer named." in str(r.get("targetWhy")) and "othing was queued" not in str(r.get("note")) and str(r.get("note")).startswith("Queued: posts by itself")
       and row(70)["message"] == r.get("note"), "L-5: the answer and the posting say why the bridge chosen was not used (%s)" % r.get("note"))
    db.sql("insert into tally_bridge_prefs (device_id, bridge_id, firm_id, changes_only) values (%s, %s, %s, true) on conflict (device_id, bridge_id) do update set changes_only = true" % (q(DB), q(BB), q(F)))
    r = enq(71, ["V71"], uid=OWNER, target=BB, device=DB)
    ok(r.get("ok") is True and r.get("unrouted") is True and unrouted(71), "a Changes-only bridge named: queued for no computer (%s)" % (r.get("error") or r.get("_error") or "ok"))
    db.sql("update tally_bridge_prefs set changes_only = false where device_id = %s" % q(DB))
    r = enq(72, ["V72"], uid=STAFF, target=BB, device=DB)
    ok(r.get("ok") is True and r.get("unrouted") is True and unrouted(72), "another member's bridge named by staff: not sent through it; queued for no computer (%s)" % (r.get("error") or r.get("_error") or "ok"))
    r = enq(73, ["V73"], uid=OWNER, target=BB, device=DB)
    x = row(73); ok(r.get("ok") is True and "unrouted" not in r and x["dev"] == DB and x["target_bridge"] == BB, "a bridge named that may post (company closed there): queued for it, as before (%s)" % x)
    clear()
    db.sql("update tally_companies set device_id = null where firm_id = %s and book_id = %s" % (q(F), q(BK)))
    r = enq(74, ["V74"])
    ok(r.get("ok") is True and r.get("unrouted") is True and unrouted(74) and isw(row(74)["message"]), "the company's computer key removed: queued for no computer, by the link record's company (%s)" % (r.get("error") or r.get("_error") or "ok"))
    B(); t = take(DB, BB); ok(t is not None and t["id"] == J(74) and t["taken_by"] == BB, "and the bridge that opens that very company takes it (%s)" % t)
    relink(); clear()

    print("== 8. a link that cannot prove the company")
    A([]); B([]); n0 = db.one("select count(*) from tally_post_jobs")
    relink(loc=False)
    r = enq(80, ["V80"])
    ok(r.get("ok") is False and "Nothing was queued" in str(r.get("error")) and not row(80), "no data location on the link: refused in the words as before (%s)" % (r.get("error") or r))
    relink(guid=False)
    r = enq(81, ["V81"])
    ok(r.get("ok") is False and "Nothing was queued" in str(r.get("error")) and not row(81) and db.one("select count(*) from tally_post_jobs") == n0, "no GUID on the link: refused too; nothing queued (%s)" % (r.get("error") or r))
    relink()

    # M1: a data location no FinCom Bridge 2.x was ever seen reading: nobody could ever take it: refused as before
    db.sql("update tally_links set data_loc = 'f00000000000000000000' where firm_id = %s and book_id = %s" % (q(F), q(BK)))
    r = enq(82, ["V82"])
    ok(r.get("ok") is False and "Nothing was queued" in str(r.get("error")) and not row(82), "the link's data location never read by a FinCom Bridge 2.x: refused in the words as before (%s)" % (r.get("error") or r))
    db.sql("insert into tally_link_places (firm_id, book_id, data_loc, data_folder, computer, device_id, bridge_id, state) values (%s, %s, 'f00000000000000000000', 'E:\\Old', 'SRV9', %s, %s, 'chosen') on conflict do nothing" % (q(F), q(BK), q(DA), q(BA)))
    r = enq(83, ["V83"])
    ok(r.get("ok") is True and r.get("unrouted") is True, "a bridge 2.x was seen reading it before (tally_link_places): queued for no computer (%s)" % (r.get("error") or r.get("_error") or "ok"))
    relink(); clear()
    # the bridge's own list of open companies (info.bridges[id].cos) is the GUID's proof when it sends one
    r = enq(84, ["V84"]); i = st.beat("made-up-b", BB, [CO]); i["bridges"][BB]["cos"] = [[CO, "ffffffff-0000-0000-0000-00000000dead"]]; st.setbeat(DB, i)
    ok(unrouted(84) and count(DB, BB) == 0 and take(DB, BB) is None, "its key's beat names the GUID but the bridge's own list has another GUID for it: not handed")
    i["bridges"][BB]["cos"] = [[CO, GUID.upper()]]; st.setbeat(DB, i)
    t = take(DB, BB); ok(t is not None and t["id"] == J(84), "the bridge's own list names the link's GUID: handed (%s)" % t)
    clear(); A([]); B([])

    print("== 9. a waiting posting whose bridge can no longer post")
    A(); B([])
    r = enq(90, ["V90"]); x = row(90); ok(x["dev"] == DA and x["target_bridge"] == BA, "queued for A (company open there)")
    r = enq(91, ["V91"]); t = take(DA, BA); ok(t is not None and t["id"] == J(90), "A takes the first")
    db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(90)))          # put back: once taken
    db.sql("insert into tally_bridge_prefs (device_id, bridge_id, firm_id, changes_only) values (%s, %s, %s, true) on conflict (device_id, bridge_id) do update set changes_only = true" % (q(DA), q(BA), q(F)))
    rr = json.loads(db.one("select tally_post_rescue(%s::uuid)::text" % q(DA)) or "{}")
    ok(rr.get("unrouted") == 1 and rr.get("failed") == 0 and rr.get("held") == 1, "A set to Changes only: the rescue queues the one never taken for no computer, holds the one once taken (%s)" % rr)
    ok(unrouted(91) and isw(row(91)["message"]), "never taken: waiting for no computer, the plain words; not failed (%s)" % row(91))
    x = row(90); ok(x["status"] == "waiting" and x["dev"] == DA and x["taken_by"] == BA and x["message"].startswith("Started on "), "once taken: never moved, held in 174's words (%s)" % x["message"][:60])
    B(); t = take(DB, BB); ok(t is not None and t["id"] == J(91) and t["taken_by"] == BB, "B, with that very company open, takes the one never taken (%s)" % t)
    ok(take(DB, BB) is None and row(90)["status"] == "waiting" and row(90)["dev"] == DA, "never the one A once took")
    clear(); B([])
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values (%s, %s, 'c1', %s, %s, %s, 1, 'failed', %s)" % (q(J(92)), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": V("V92"), "ledger": ""})), q(BA)))
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(92)))
    ok(r.get("ok") is True and r.get("retry") is True and unrouted(92) and isw(row(92)["message"]), "Retry of a failed posting never taken whose bridge may no longer post: queued for no computer, not refused (%s / %s)" % (r.get("error") or r.get("_error") or "ok", row(92)))
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(92)))
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(92)))
    ok(r.get("ok") is True and unrouted(92), "and Retried once more (attempts %s): still for no computer, never \"Started on\"" % row(92)["attempts"])
    # L-4: the link can no longer prove the company: a Retry is refused in words; one still waiting is failed with them
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(92)))
    db.sql("update tally_links set data_loc = null where firm_id = %s and book_id = %s" % (q(F), q(BK)))
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(92)))
    ok(r.get("ok") is False and "no longer says where" in str(r.get("error")) and row(92)["status"] == "failed", "L-4: Retry of one queued for no computer whose link lost its data location: refused in words, not queued (%s)" % (r.get("error") or r))
    db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(92)))
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(92)))
    ok(r.get("ok") is False and row(92)["status"] == "failed" and "no longer says where" in row(92)["message"], "L-4: still waiting and asked again: failed with the words, never left waiting for nobody (%s)" % row(92)["message"][:90])
    relink()
    db.sql("update tally_bridge_prefs set changes_only = false where device_id = %s" % q(DA))
    # a posting only recorded (132: device_id null, taken when made): never a bridge's
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, taken_at) values (%s, %s, 'c1', %s, null, %s, 1, 'waiting', now())" % (q(J(93)), q(F), q(CO), q(json.dumps({"masters": [], "vouchers": [{"id": "V93"}], "ledger": "", "recorded": True}))))
    clear_others = db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(92)))
    B(); ok(count(DB, BB) == 0 and take(DB, BB) is None and row(93)["status"] == "waiting", "a posting only recorded (no computer, taken when made): never told, never handed")
    clear()

    print("== 10. item C still holds")
    A([]); B([])
    r = enq(100, ["V100", "V101"]); ok(unrouted(100), "two entries queued for no computer")
    r = enq(101, ["V101", "V102"])
    ok(r.get("ok") is True and r.get("unrouted") is True and r.get("dupes") == [{"id": "V101", "job": J(100), "status": "waiting"}] and unrouted(101), "an overlapping posting: only the new entry queued (for no computer), the held one named (%s)" % r)
    r = enq(102, ["V100", "V102"])
    ok(r.get("ok") is False and r.get("none") is True and not row(102), "wholly held: nothing queued (%s)" % r.get("error"))
    B(); got = [take(DB, BB) for _ in range(3)]
    ok([g["id"] for g in got if g] == [J(100), J(101)], "B opens the company: handed them oldest first, one at a time (%s)" % [g and g["id"] for g in got])
    ok(db.one("select coalesce(max(c), 0)::text from (select count(*) c from tally_post_ids where firm_id = %s and live group by fincom_id) s" % q(F)) == "1", "no FinCom id live in two postings")
    db.sql("update tally_post_jobs set status = 'waiting', device_id = null, target_bridge = null, taken_by = null, taken_at = null, first_taken_at = null, updated_at = now() - interval '7 hours', created_at = now() - interval '7 hours' where id = %s" % q(J(101)))
    B([]); db.one("select tally_post_requeue()")
    ok("no FinCom Bridge with " + CO + " open in Tally has taken it" in row(101)["message"] and unrouted(101), "after 6 hours the requeue's words say why (174's, unchanged): %s" % row(101)["message"][:110])
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
