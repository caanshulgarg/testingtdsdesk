"""python3 run_migration115.py - migration-115-bridge-follows-login (the owner, 27-Oct-2026: a bridge sends to the firm of the
FinCom login using it). On throwaway PostgreSQL (pg_stand, port 31150; never a real database), built 32 -> ... -> 55 as
run_migration111.py, then 115 (twice). Firm A (ABC) holds bridge go-372b35a9cdf6 on key DA (as on staging, NW144\\Durgesh);
firm B (Garg Shekhar & Company) signs in on that computer.
Checks:
  0. the file: one transaction, lock_timeout, add-only (no drop of a table, no delete from, no truncate), explicit grants,
     every function search_path public, pg_temp.
  1. tally_bridge_whose for B's owner: elsewhere, not mine, may; for A's owner: mine; nothing of A named to B.
  2. a posting waiting on the bridge in A: whose says busy; tally_bridge_follow_ask refused (a 'refused' row), and the
     move refused for lack of an ask.
  3. B's viewer (may not write): whose says may=false; ask refused.
  4. the posting done: ask (with B's new key) -> move (service role, as tally-ingest's own_key): A's binding released,
     A's key DA revoked (its data kept: the device row and its companies stay), movedAway on it; 'asked' and 'done' rows.
  5. a second move with the same ask: refused (once only); whose for B: mine now; for A: elsewhere false (DA revoked).
  6. a shared old key (another Windows user's bridge reports on it): moved, the key NOT revoked.
  7. the audit rows: no update, no delete (even for the service role); A's members read none of them, B's read theirs.
Prints md5 of the file."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M115 = os.path.join(SQLDIR, "migration-115-bridge-follows-login.sql")
text = open(M115).read()
import pg_stand
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
A, B = "efe13a47-f0fa-43be-a18c-bf32caa448ca", "6cdc90d3-60d4-4acc-b15f-1532d928a797"
AO, BO, BV = "aef3b147-a157-4f43-bd92-66540d566d93", "4fe387fa-7889-4aa4-8543-a41584e6aae9", "77777777-7777-7777-7777-777777777777"
DA, DS = "f8c9a571-be43-4b42-a12e-1b47ab644394", "d5000000-0000-0000-0000-000000000005"
BID, BID2, BID3 = "go-372b35a9cdf6", "go-aaaa00000002", "go-bbbb00000003"
USER = "NW144\\Durgesh"

db = None
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def rpcj(uid, stmt, role="authenticated"):
    try: out = db.one("set role %s; %s" % (role, stmt), uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(out)
    except (TypeError, ValueError): return {"_error": out}
def svc(stmt):
    try: return json.loads(db.one(stmt))
    except RuntimeError as e: return {"_error": str(e)[-400:]}
def now(): return __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def binfo(*bs): return json.dumps({"bridges": {b: {"at": now(), "computer": "NWS144", "user": u} for b, u in bs}})
def new_key(uid, name="NWS144 · NW144\\Durgesh"):
    r = rpcj(uid, "select tally_device_create(%s)::text" % q(name)); return r.get("id")
def switches(): return db.rows("select bridge_id, state, coalesce(from_firm::text, '') as from_firm, coalesce(from_device::text, '') as from_device, to_firm::text as to_firm, coalesce(to_device::text, '') as to_device, coalesce(by_user::text, '') as by_user, revoked_old::text as revoked_old from tally_bridge_switches order by id")

def build(port=31150):
    """the database before 115 (A holds the bridge on DA; B signs in), then 115 run twice; -> db"""
    global db
    db = pg_stand.start(port)
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""create extension if not exists pgcrypto; create schema if not exists extensions;
      insert into firms values (%(A)s, 'ABC'), (%(B)s, 'Garg Shekhar & Company') on conflict do nothing;
      insert into members values (%(AO)s, %(A)s, 'test', 'owner', true), (%(BO)s, %(B)s, 'support', 'owner', true), (%(BV)s, %(B)s, 'viewer', 'viewer', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%(DA)s, %(A)s, 'NWS144 · NW144\\Durgesh', 'hA', '2.4.7', %(IA)s, %(AO)s),
        (%(DS)s, %(A)s, 'NWS144 shared', 'hS', '2.4.7', %(IS)s, %(AO)s);
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, device_id, last_seen) values (%(A)s, 'IX DESIGNS PRIVATE LIMITED - (from 1-Apr-25)', %(DA)s, now());"""
           % {"A": q(A), "B": q(B), "AO": q(AO), "BO": q(BO), "BV": q(BV), "DA": q(DA), "DS": q(DS), "IA": q(binfo((BID, USER))), "IS": q(binfo((BID2, "NW144\\Ravi"), (BID3, "NW144\\Mohit")))})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # tally_device_create as on staging (migration.sql), with gen_random_bytes from pgcrypto
    db.sql(re.search(r"create or replace function public\.tally_device_create.*?end \$\$;", open(os.path.join(SQLDIR, "migration.sql")).read(), re.S).group(0)
           .replace("set search_path = public, extensions", "set search_path = public"))
    db.sql("grant execute on function public.tally_device_create(text) to authenticated; grant select on all tables in schema public to authenticated;")
    for d, b in ((DA, BID), (DS, BID2), (DS, BID3)): db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(d), q(b)))
    for i in (1, 2):
        r = psql_text(text); ok(r.returncode == 0, "115 runs (time %d) %s" % (i, r.stderr[-300:]))
    return db

if __name__ == "__main__":
    low = text.lower()
    print("  md5 of the file: %s  (%s)" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M115)))
    ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. one transaction with lock_timeout 10 s")
    ok("delete from" not in low and "truncate" not in low and not re.search(r"\bdrop\b", low), "0. add-only (no delete from, no truncate, no drop)")
    ok("revoke all on public.tally_bridge_switches from public, anon, authenticated" in text and "grant select on public.tally_bridge_switches to authenticated" in text, "0. explicit grants on the table")
    FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
    ok(all(re.search(r"function public\.%s\([^)]*\)[^$]*set search_path = public, pg_temp" % f, text, re.S) for f in FNS), "0. every function: search_path public, pg_temp (%d)" % len(FNS))
    ok(all(("on function public.%s(" % f) in text for f in FNS), "0. every function revoked / granted explicitly")
    ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", low), "0. names no real database")
    build()
    try:

        print("1. whose")
        w = rpcj(BO, "select tally_bridge_whose(%s)::text" % q(BID))
        ok(w == {"may": True, "mine": False, "elsewhere": True, "busy": False}, "B's owner: the bridge reports to another firm, may switch: %s" % w)
        ok(not re.search(r"ABC|efe13a47|f8c9a571", json.dumps(w)), "nothing of A named to B")
        w = rpcj(AO, "select tally_bridge_whose(%s)::text" % q(BID)); ok(w.get("mine") is True and w.get("elsewhere") is False, "A's owner: mine %s" % w)

        print("2. a posting waiting on the bridge in A")
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge) values ('00000000-0000-0000-0000-000000000115', %s, 'c1', 'IX', %s, '{}', 1, 'waiting', %s)" % (q(A), q(DA), q(BID)))
        ok(rpcj(BO, "select tally_bridge_whose(%s)::text" % q(BID)).get("busy") is True, "whose: busy")
        k1 = new_key(BO); a = rpcj(BO, "select tally_bridge_follow_ask(%s, %s::uuid)::text" % (q(BID), q(k1)))
        ok(a.get("ok") is False and a.get("busy") is True, "ask refused while a posting waits: %s" % a)
        m = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(DA), q(k1), q(USER)))
        ok(m.get("moved") is False, "the move refused without an ask: %s" % m.get("error"))
        ok(db.one("select revoked::text from tally_devices where id = %s" % q(DA)) == "false", "A's key not revoked")

        print("3. B's viewer")
        ok(rpcj(BV, "select tally_bridge_whose(%s)::text" % q(BID)).get("may") is False, "whose: may=false for a viewer")
        a = rpcj(BV, "select tally_bridge_follow_ask(%s, %s::uuid)::text" % (q(BID), q(k1))); ok("_error" in a and "may write" in a["_error"], "a viewer's ask refused")
        ok("_error" in rpcj(BV, "select tally_device_create('x')::text"), "a viewer cannot make a key either")

        print("4. the switch")
        db.sql("update tally_post_jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000115'")
        k2 = new_key(BO); a = rpcj(BO, "select tally_bridge_follow_ask(%s, %s::uuid)::text" % (q(BID), q(k2))); ok(a.get("ok") is True, "ask: %s" % a)
        bad = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(DA), q(k2), q("NW144\\Someone")))
        ok(bad.get("moved") is False and "Windows user" in bad.get("error", ""), "another Windows user: refused")
        m = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(DA), q(k2), q(USER)))
        ok(m.get("moved") is True and m.get("revokedOld") is True, "moved, A's key revoked: %s" % m)
        ok(db.one("select revoked::text from tally_devices where id = %s" % q(DA)) == "true", "A's device revoked")
        ok(db.one("select (info->'movedAway'->>'bridge') from tally_devices where id = %s" % q(DA)) == BID, "A's device says moved away (no firm named)")
        ok(db.one("select count(*) from tally_companies where firm_id = %s" % q(A)) == "1", "A's IX DESIGNS row stays (nothing deleted)")
        ok(db.one("select count(*) from tally_bridge_ids where firm_id = %s and bridge_id = %s and reset_at is null" % (q(A), q(BID))) == "0", "A's binding released")
        ok(db.one("select count(*) from tally_bridge_ids where firm_id = %s and bridge_id = %s" % (q(A), q(BID))) == "1", "A's binding kept (reset, not deleted)")
        sw = switches(); ok([s["state"] for s in sw] == ["refused", "asked", "done"], "audit: refused, asked, done %s" % [s["state"] for s in sw])
        d = sw[-1]; ok(d["from_firm"] == A and d["from_device"] == DA and d["to_firm"] == B and d["to_device"] == k2 and d["by_user"] == BO and d["revoked_old"] == "true", "done row: who, from, to")

        print("5. once only; whose after")
        m = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(DA), q(k2), q(USER))); ok(m.get("moved") is False, "a second move refused: %s" % m.get("error"))
        db.sql("update tally_devices set info = %s where id = %s" % (q(binfo((BID, USER))), q(k2))); db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(k2), q(BID)))
        w = rpcj(BO, "select tally_bridge_whose(%s)::text" % q(BID)); ok(w.get("mine") is True and w.get("elsewhere") is False, "B: mine now %s" % w)
        w = rpcj(AO, "select tally_bridge_whose(%s)::text" % q(BID)); ok(w.get("mine") is False and w.get("elsewhere") is True, "A: no longer mine (A's page would move it back only by its own login on that computer) %s" % w)

        print("6. a shared old key")
        k3 = new_key(BO, "NWS144 · NW144\\Ravi"); ok(rpcj(BO, "select tally_bridge_follow_ask(%s, %s::uuid)::text" % (q(BID2), q(k3))).get("ok") is True, "ask for the shared key's bridge")
        m = svc("select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID2), q(DS), q(k3), q("NW144\\Ravi")))
        ok(m.get("moved") is True and m.get("revokedOld") is False, "moved; the shared key left: %s" % m)
        ok(db.one("select revoked::text from tally_devices where id = %s" % q(DS)) == "false", "the shared key not revoked (the other bridge keeps sending)")

        print("7. the audit is add-only and per firm")
        ok("_error" in svc("update tally_bridge_switches set why = 'x' returning 1"), "no update (service role)")
        ok("_error" in svc("delete from tally_bridge_switches returning 1"), "no delete (service role)")
        ok(db.one("set role authenticated; select count(*) from tally_bridge_switches", AO) == "0", "A's members read none of the rows")
        ok(int(db.one("set role authenticated; select count(*) from tally_bridge_switches", BO)) == len(switches()), "B's members read theirs")
        ok("_error" in rpcj(BO, "select tally_bridge_follow_move(%s, %s::uuid, %s::uuid, %s)::text" % (q(BID), q(DA), q(k2), q(USER))), "a member cannot call the move")
    finally:
        db.stop()
    print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
    raise SystemExit(1 if fails else 0)
