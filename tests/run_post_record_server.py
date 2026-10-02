"""python3 run_post_record_server.py - migration-27 (02-Oct-2026) on a throwaway PostgreSQL (pg_stand):
tally_post_record keeps a posting made straight to a bridge in tally_post_jobs as done or failed, with no device (no
bridge ever takes it), the voucher ids only in the payload (entry_ids from them); the same id again brings it up to
date; only a writer of the firm, only for the firm's own client, never over a queued posting; the block that sets
data.postTo for clients linked to exactly one Tally company with the same GSTIN, only when none is chosen."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
F, G = "00000000-0000-0000-0000-0000000000f1", "00000000-0000-0000-0000-0000000000f2"
U, V, R = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2", "00000000-0000-0000-0000-0000000000a3"
SETUP = """
create or replace function tally_nm(t text) returns text language sql immutable as $$ select btrim(regexp_replace(coalesce(t, ''), '[\\r\\n]+', ' ', 'g')) $$;
create table clients (id text, firm_id uuid, name text, gstin text, pan text, tally_name text, data jsonb, updated_at timestamptz, deleted boolean default false, primary key (firm_id, id));
create table tally_devices (id uuid primary key, firm_id uuid);
create table tally_companies (firm_id uuid, company text, client_id text, gstin text, device_id uuid, last_seen timestamptz, linked_at timestamptz, primary key (firm_id, company));
create table tally_post_jobs (id uuid primary key, firm_id uuid not null, client_id text not null, company text not null, device_id uuid references tally_devices(id),
  payload jsonb not null, n integer not null, status text not null default 'waiting' check (status in ('waiting', 'taken', 'running', 'done', 'failed', 'cancelled')),
  done integer not null default 0, message text not null default '', results jsonb, checking boolean not null default false, created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), taken_at timestamptz, updated_at timestamptz not null default now(), items jsonb);
alter table tally_post_jobs add column entry_ids jsonb generated always as (coalesce(jsonb_path_query_array(payload, '$.vouchers[*].id'), '[]'::jsonb)) stored;
insert into firms values ('%(F)s', 'GARG'), ('%(G)s', 'Other');
insert into members values ('%(U)s', '%(F)s', 'Anshul', 'owner', true), ('%(V)s', '%(G)s', 'Other firm', 'owner', true), ('%(R)s', '%(F)s', 'Reader', 'viewer', true);
insert into clients values ('cmufksrrqjub2g', '%(F)s', 'Testing AAD', '09AANFG3202D1ZR', '', '', '{"gstin": "09AANFG3202D1ZR", "postTo": null}', now(), false),
  ('c-two', '%(F)s', 'Two Cos', '09AAAAA0000A1Z5', '', '', '{}', now(), false),
  ('c-diff', '%(F)s', 'Other GSTIN', '09BBBBB0000B1Z5', '', '', '{}', now(), false),
  ('c-set', '%(F)s', 'Already set', '09CCCCC0000C1Z5', '', '', '{"postTo": "KEEP ME"}', now(), false);
insert into tally_devices values ('00000000-0000-0000-0000-0000000000d1', '%(F)s');
insert into tally_companies values ('%(F)s', 'GARG SHEKHAR & COMPANY', 'cmufksrrqjub2g', '09AANFG3202D1ZR', '00000000-0000-0000-0000-0000000000d1', now(), now()),
  ('%(F)s', 'TWO A', 'c-two', '09AAAAA0000A1Z5', null, now(), now()), ('%(F)s', 'TWO B', 'c-two', '09AAAAA0000A1Z5', null, now(), now()),
  ('%(F)s', 'DIFF CO', 'c-diff', '09ZZZZZ0000Z1Z5', null, now(), now()),
  ('%(F)s', 'SET CO', 'c-set', '09CCCCC0000C1Z5', null, now(), now());
insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n) values
  ('00000000-0000-0000-0000-00000000aaaa', '%(F)s', 'cmufksrrqjub2g', 'GARG SHEKHAR & COMPANY', '00000000-0000-0000-0000-0000000000d1', '{"vouchers": [{"id": "q1", "xml": "<VOUCHER/>"}]}', 1);
""" % dict(F=F, G=G, U=U, V=V, R=R)
db = pg_stand.start(int(os.environ.get("PG_PORT", "55437")))
try:
    db.sql(SETUP)
    path = os.path.join(HERE, "..", "server", "tally-cloud", "migration-27-post-record.sql")
    sql = open(path).read()
    ok(sql.count("begin;") == 2 and sql.count("commit;") == 2 and "drop " not in sql.lower() and "delete " not in sql.lower(), "migration-27: begin/commit blocks, nothing dropped or deleted")
    db.sql(sql); db.sql(sql)
    ok(True, "migration-27 runs, and runs again")
    J = "00000000-0000-0000-0000-0000000b9f01"
    call = lambda uid, jid, client, status, res, ids, msg: json.loads(db.one("select tally_post_record('%s', '%s', 'GARG SHEKHAR & COMPANY', '%s', '%s'::jsonb, '%s'::jsonb, '%s')::text" % (jid, client, status, json.dumps(res), json.dumps(ids), msg), uid))
    r = call(U, J, "cmufksrrqjub2g", "done", [{"id": "b1", "ok": True, "verified": True}, {"id": "b2", "ok": False, "message": "Ledger missing"}], ["b1", "b2"], "Posted 1 of 2 from this computer")
    row = db.rows("select status, device_id, n, done, message, payload::text, entry_ids::text, created_by from tally_post_jobs where id = '%s'" % J)[0]
    ok(r.get("ok") and row["status"] == "done" and row["device_id"] == "" and row["n"] == "2" and row["done"] == "1",
       "a direct posting is recorded as done, no device (no bridge takes it), 1 of 2 in (%s)" % {k: row[k] for k in ("status", "n", "done")})
    ok(json.loads(row["entry_ids"]) == ["b1", "b2"] and "xml" not in row["payload"] and row["created_by"] == U, "only the voucher ids are kept (entry_ids from them), by whom")
    taken = db.one("select count(*) from tally_post_jobs where device_id is not null and status = 'waiting'")
    ok(taken == "1", "the queued posting is untouched")
    r = call(U, J, "cmufksrrqjub2g", "failed", [{"id": "b1", "ok": True}, {"id": "b2", "ok": False, "message": "x"}], ["b1", "b2"], "1 of 2: read back later")
    row = db.rows("select status, message from tally_post_jobs where id = '%s'" % J)[0]
    ok(r.get("updated") and row["status"] == "failed" and row["message"] == "1 of 2: read back later", "the same id again brings it up to date")
    r = call(U, J, "cmufksrrqjub2g", "weird", [], [], "")
    ok(db.one("select status from tally_post_jobs where id = '%s'" % J) == "failed", "a status other than done/failed is kept as failed")
    def refused(f):
        try: f(); return False
        except RuntimeError as e: return "not allowed" in str(e) or "no such client" in str(e)
    ok(refused(lambda: call(U, "00000000-0000-0000-0000-00000000aaaa", "cmufksrrqjub2g", "done", [], [], "")), "a queued posting (with a device) cannot be overwritten")
    ok(refused(lambda: call(V, "00000000-0000-0000-0000-0000000b9f02", "cmufksrrqjub2g", "done", [], [], "")), "another firm cannot record for this client")
    ok(refused(lambda: call(R, "00000000-0000-0000-0000-0000000b9f03", "cmufksrrqjub2g", "done", [], [], "")), "a viewer cannot record")
    ok(refused(lambda: call(None, "00000000-0000-0000-0000-0000000b9f04", "cmufksrrqjub2g", "done", [], [], "")), "nobody signed in cannot record")
    ok(refused(lambda: call(U, "00000000-0000-0000-0000-0000000b9f05", "no-such", "done", [], [], "")), "not for a client the firm does not have")
    pt = {x["id"]: (x["pt"], x["by"]) for x in db.rows("select id, data->>'postTo' pt, data->>'postToBy' by from clients")}
    ok(pt["cmufksrrqjub2g"] == ("GARG SHEKHAR & COMPANY", "auto"), "Testing AAD: one Tally company linked, same GSTIN -> postTo GARG SHEKHAR & COMPANY (auto)")
    ok(pt["c-two"][0] is None or pt["c-two"][0] == "", "two Tally companies linked: left alone")
    ok(not pt["c-diff"][0], "a different GSTIN: left alone")
    ok(pt["c-set"][0] == "KEEP ME" and not pt["c-set"][1], "a company already chosen is never changed")
    db.sql("update clients set data = data || '{\"postToAt\": \"x\"}' where id = 'cmufksrrqjub2g'")
    db.sql(sql)
    ok(db.one("select data->>'postToAt' from clients where id = 'cmufksrrqjub2g'") == "x", "running it again changes nothing")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
