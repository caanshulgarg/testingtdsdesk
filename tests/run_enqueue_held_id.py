"""python3 run_enqueue_held_id.py - the FinCom id lock holds for a posting Tally took by its reply (owner, 04-Oct-2026: FinCom
Bridge 2.1.8 posts by Tally's reply and never reads back; the app now marks such a bill posted, and the cloud must refuse a
second posting of it whatever the app does). Staging's order on a throwaway PostgreSQL (pg_stand), as run_migration43.py:
32 -> 33 -> 35 -> 34 (first) -> 36b -> 37 -> 36 -> 38 -> 39 -> 40 -> 41 -> 42 -> 43. Checks:
(1) a posting done by Tally's reply (results byReply + ok, items 'posted'), its id accepted (tally_post_id_accept_reply): the
    id stays live; a second tally_post_jobs insert for the same FinCom id raises "its FinCom id is taken", and
    tally_post_enqueue (a signed-in owner, a new posting) is refused the same way; nothing is queued;
(2) a posting that ended failed with a byReply ok result in it: the id is still held, a new posting of it refused;
(3) control: an id Tally refused (failed, ok false, not accepted) is freed, and a new posting of it goes in."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA_X = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")
F = "99999999-9999-9999-9999-999999999999"
OWNER = "55555555-5555-5555-5555-555555555555"
D1 = "d1000000-0000-0000-0000-000000000001"
J = lambda n: "%08d-0000-0000-0000-00000000e0e0" % n
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
def job(jid, vs, status="running"):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(F), q(json.dumps({"vouchers": vs})), len(vs), q(status))
def reply(i, vid):
    return {"id": i, "ok": True, "byReply": True, "verified": False, "vchId": vid, "batchN": 1, "batchEnd": vid, "lastVchId": vid, "state": "posted", "vchDate": "20261001", "vchType": "Journal",
            "sentAt": "2026-10-04T05:00:30Z", "created": 1}
db = pg_stand.start(55461)
def psql_file(path):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def tries(stmt):
    try: db.sql(stmt); return True, ""
    except RuntimeError as e: return False, str(e)
idrow = lambda jid, fid: (db.rows("select live, accepted_at, reply_vch, released_at from tally_post_ids where job_id = %s and fincom_id = %s" % (q(jid), q(fid))) or [{}])[0]
njobs = lambda: int(db.one("select count(*) from tally_post_jobs"))
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.8');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"postTo": "ZZ CO"}');""" % {"F": q(F), "O": q(OWNER), "D1": q(D1)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      create or replace function public.tally_nm(p text) returns text language sql immutable as 'select lower(btrim(coalesce($1, '''')))';
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) values (%s, 'ZZ CO', 'c1', %s, now());""" % (q(F), q(D1)))
    # ---- (1) done by Tally's reply, the id accepted
    db.sql(job(J(1), [vch("B1")]))
    db.sql("update tally_post_jobs set status = 'done', done = 1, message = 'Posted 1 of 1 (Tally''s reply)', results = %s, items = %s, updated_at = now() where id = %s"
           % (q(json.dumps([reply("B1", "26303")])), q(json.dumps([{"id": "B1", "state": "posted"}])), q(J(1))))
    acc = json.loads(db.one("select tally_post_id_accept_reply(%s::uuid, 'B1', '26303', '26303', 1)::text" % q(J(1))))
    x = idrow(J(1), "B1")
    ok(acc.get("stamped") == 1 and x.get("live") == "t" and x.get("accepted_at") and x.get("reply_vch") == "26303" and not x.get("released_at"),
       "1. the posting done by Tally's reply: B1 accepted (voucher id 26303), its id live (%s | %s)" % (acc, x))
    n0 = njobs()
    good, err = tries(job(J(2), [vch("B1")]))
    ok(not good and "its FinCom id is taken" in err and njobs() == n0, "1. a second tally_post_jobs insert for B1: refused, 'its FinCom id is taken' (%s)" % err.strip()[-160:])
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(3)), q(json.dumps({"vouchers": [vch("B1")]}))))
    refused = (not good and "its FinCom id is taken" in out) or (good and json.loads(out).get("ok") is False and "taken" in json.loads(out).get("error", ""))
    ok(refused and njobs() == n0, "1. tally_post_enqueue of a new posting with B1 (an owner): refused, the id is taken; nothing queued (%s)" % out.strip()[-200:])
    ok(idrow(J(1), "B1").get("live") == "t", "1. and B1 stays held by the posting that put it in")
    # ---- (2) failed as a whole, with a byReply ok result in it: still held
    db.sql(job(J(4), [vch("B2"), vch("B3")]))
    db.sql("update tally_post_jobs set status = 'failed', message = 'Posted 1 of 2 (Tally''s reply)', results = %s, items = %s, updated_at = now() where id = %s"
           % (q(json.dumps([reply("B2", "26304"), {"id": "B3", "ok": False, "message": "Ledger 'X' does not exist"}])), q(json.dumps([{"id": "B2", "state": "posted"}, {"id": "B3", "state": "failed"}])), q(J(4))))
    ok(idrow(J(4), "B2").get("live") == "t", "2. failed posting, B2 taken by Tally's reply: its id still live (%s)" % idrow(J(4), "B2"))
    good, err = tries(job(J(5), [vch("B2")]))
    ok(not good and "its FinCom id is taken" in err, "2. a new posting of B2: refused, 'its FinCom id is taken' (%s)" % err.strip()[-120:])
    # ---- (3) control: B3 refused by Tally is freed and may be posted again
    ok(idrow(J(4), "B3").get("live") == "f", "3. B3 (refused by Tally) freed (%s)" % idrow(J(4), "B3"))
    good, err = tries(job(J(6), [vch("B3")]))
    ok(good and idrow(J(6), "B3").get("live") == "t", "3. a new posting of B3 goes in (%s)" % err.strip()[-120:])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
