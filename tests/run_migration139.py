"""python3 run_migration139.py - migration-139-bridge-update-gate (04-Nov-2026, next-bridge-signed-list): the gated rollout
of FinCom Bridge updates, tally_bridge_update_gate(firm, device, computer, version, ready, why). On a throwaway PostgreSQL
(pg_stand, port 31139; never a real database). Made-up firms, computers and bridges only. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (no table altered, no delete, drop or truncate), names no
     real database; runs twice; grants: service_role only (nothing for anon or authenticated).
  1. no gate version: {gate: false} (the release as before).
  2. a bridge on the gate's version (or newer): not allowed, "up to date"; another firm's computer: not allowed.
  3. a posting of the computer waiting or taken: not allowed; not ready (busy with Tally / not its time): not allowed
     with its reason, and no slot taken.
  4. ready: let through, a slot of 10 minutes recorded (tally_bridge_update_grants); asked again within it: the same
     slot, no second row.
  5. another bridge of the SAME computer, ready at the same time: not allowed until 10 minutes after the first slot
     began; a bridge of ANOTHER computer of the firm: let through at once.
  6. a slot that ended while another bridge of the computer waits: that one's turn (the first yields); when nobody waits,
     a new slot for the same bridge.
  7. the slots are kept: a delete is refused.
RED_WITHOUT_139=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.environ.get("M139_FILE") or os.path.join(HERE, "..", "server", "tally-cloud", "migration-139-bridge-update-gate.sql")
RED = os.environ.get("RED_WITHOUT_139") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
F1, F2 = "99999999-9999-9999-9999-999999999139", "88888888-8888-8888-8888-888888888139"
A, B, C, X = ("d1390000-0000-4000-8000-0000000000%02d" % i for i in (1, 2, 3, 4))
BASE = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
create table if not exists tally_devices (id uuid primary key, firm_id uuid, name text, info jsonb default '{}'::jsonb, revoked boolean default false);
create table if not exists tally_post_jobs (id bigserial primary key, device_id uuid, status text, target_bridge text);
create or replace function public.tally_control_kept() returns trigger language plpgsql as $function$
begin
  raise exception '% rows are kept, never deleted', tg_table_name using errcode = '42501';
end $function$;
"""
text = open(M).read() if os.path.exists(M) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1,
   "0. one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and not re.search(r"\balter\s+table\s+(?!public\.tally_bridge_update_\w+ enable row level security)", code),
   "0. add-only: no table altered (RLS on its own new tables only), no delete, drop or truncate")
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
ok(re.search(r"revoke all on function public\.tally_bridge_update_gate\(uuid, uuid, text, text, boolean, text\) from public, anon, authenticated;", text)
   and re.search(r"grant execute on function public\.tally_bridge_update_gate\(uuid, uuid, text, text, boolean, text\) to service_role;", text), "0. the function: service_role only")

db = pg_stand.start(int(os.environ.get("PG139_PORT") or 31139))
try:
    db.sql(BASE)
    db.sql("insert into firms values ('%s', 'Made-up Firm One'), ('%s', 'Made-up Firm Two');" % (F1, F2))
    db.sql("insert into tally_devices (id, firm_id, name) values ('%s','%s','PC-1'), ('%s','%s','PC-1'), ('%s','%s','PC-2'), ('%s','%s','PC-X');" % (A, F1, B, F1, C, F1, X, F2))
    body = pg_stand.migration_body(M)
    if not RED:
        db.sql("begin;\n" + body + "commit;")
        db.sql("begin;\n" + body + "commit;")
        ok(True, "0. runs twice")
    def gate(dev, comp, ver, ready=True, why="", firm=F1):
        try:
            return json.loads(db.one("select tally_bridge_update_gate('%s', '%s', '%s', '%s', %s, '%s')::text" % (firm, dev, comp, ver, "true" if ready else "false", why)))
        except Exception as e:
            return {"error": str(e)[:200]}
    def grants(dev=None):
        return int(db.one("select count(*) from tally_bridge_update_grants" + (" where device_id = '%s'" % dev if dev else "")) or 0) if not RED else -1
    def back(minutes, dev=None):   # time passes: every slot and ask of dev (or all) moved back
        w = " where device_id = '%s'" % dev if dev else ""
        db.sql("update tally_bridge_update_grants set granted_at = granted_at - interval '%d minutes', until = until - interval '%d minutes'%s;" % (minutes, minutes, w))
        db.sql("update tally_bridge_update_asks set asked_at = asked_at - interval '%d minutes'%s;" % (minutes, w))
    if not RED:
        anon = db.rows("select has_function_privilege('anon', 'tally_bridge_update_gate(uuid, uuid, text, text, boolean, text)', 'execute') a, has_function_privilege('authenticated', 'tally_bridge_update_gate(uuid, uuid, text, text, boolean, text)', 'execute') u, has_table_privilege('authenticated', 'tally_bridge_update_grants', 'select') t, has_function_privilege('service_role', 'tally_bridge_update_gate(uuid, uuid, text, text, boolean, text)', 'execute') s")[0]
        ok(anon == {"a": "f", "u": "f", "t": "f", "s": "t"}, "0. grants: anon and authenticated nothing, service_role execute (%s)" % anon)
        ok(db.one("select version from tally_bridge_update_target where id = 1") == "2.5.3", "0. the gate's version: 2.5.3")
        # 1. no gate version
        db.sql("delete from tally_bridge_update_target;")
        ok(gate(A, "PC-1", "2.5.1") == {"gate": False}, "1. no gate version: gate false (the release as before)")
        db.sql("insert into tally_bridge_update_target (id, version) values (1, '2.5.3');")
    # 2. up to date; another firm's computer
    r = gate(A, "PC-1", "2.5.3"); ok(r.get("gate") and r.get("allowed") is False and r.get("why") == "up to date", "2. on the gate's version: not allowed, up to date (%s)" % r)
    r = gate(A, "PC-1", "2.6.0"); ok(r.get("allowed") is False and r.get("why") == "up to date", "2. newer: not allowed (%s)" % r)
    r = gate(X, "PC-1", "2.5.1", firm=F1); ok(r.get("allowed") is False and "not a computer of this firm" in str(r.get("why")), "2. another firm's computer: not allowed (%s)" % r)
    # 3. a posting; not ready
    if not RED: db.sql("insert into tally_post_jobs (device_id, status) values ('%s', 'waiting');" % A)
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is False and "posting" in str(r.get("why")), "3. a posting waiting: not allowed (%s)" % r)
    if not RED: db.sql("update tally_post_jobs set status = 'taken';")
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is False and "posting" in str(r.get("why")), "3. a posting taken: not allowed (%s)" % r)
    if not RED: db.sql("update tally_post_jobs set status = 'done';")
    r = gate(A, "PC-1", "2.5.1", ready=False, why="Tally is busy"); ok(r.get("allowed") is False and r.get("why") == "Tally is busy", "3. not ready: not allowed, its reason (%s)" % r)
    ok(grants() == 0, "3. no slot taken while not ready")
    # 4. ready: a slot
    r = gate(A, "PC-1", "2.5.1", why="its time"); ok(r.get("allowed") is True and r.get("new") is True and r.get("until"), "4. ready: let through, a new slot (%s)" % r)
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is True and not r.get("new"), "4. asked again in the slot: the same slot (%s)" % r)
    ok(grants(A) == 1, "4. one slot recorded (%s)" % grants(A))
    if not RED:
        g = db.rows("select from_version, version, computer, extract(epoch from until - granted_at)::int s from tally_bridge_update_grants")[0]
        ok(g == {"from_version": "2.5.1", "version": "2.5.3", "computer": "PC-1", "s": "600"}, "4. the slot: from, to, computer, 10 minutes (%s)" % g)
    # 5. the same computer waits; another computer goes
    r = gate(B, "PC-1", "2.4.7"); ok(r.get("allowed") is False and "another bridge of this computer" in str(r.get("why")), "5. a second bridge of the same computer: not allowed now (%s)" % r)
    r = gate(C, "PC-2", "2.5.2"); ok(r.get("allowed") is True, "5. a bridge of another computer: let through (%s)" % r)
    if not RED: back(9, A)
    r = gate(B, "PC-1", "2.4.7"); ok(r.get("allowed") is False, "5. 9 minutes after: still not (%s)" % r)
    # 6. the first slot ended: the waiting one's turn, the first yields
    if not RED: back(2, A)
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is False and "waits its turn" in str(r.get("why")), "6. the first bridge's slot ended while another waits: it yields (%s)" % r)
    r = gate(B, "PC-1", "2.4.7"); ok(r.get("allowed") is True and r.get("new") is True, "6. the waiting bridge: let through (%s)" % r)
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is False and "another bridge of this computer" in str(r.get("why")), "6. meanwhile the first waits (%s)" % r)
    if not RED:
        back(11)          # every slot and ask 11 minutes older: B's slot over, nobody else waiting
        db.sql("update tally_bridge_update_asks set asked_at = asked_at - interval '5 minutes' where device_id = '%s';" % B)
    r = gate(A, "PC-1", "2.5.1"); ok(r.get("allowed") is True and r.get("new") is True, "6. nobody waiting: a new slot for the first bridge (%s)" % r)
    # 7. kept
    if not RED:
        try: db.sql("delete from tally_bridge_update_grants;"); kept = False
        except RuntimeError as e: kept = "kept, never deleted" in str(e)
        ok(kept, "7. the slots are kept: a delete is refused")
finally:
    db.stop()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
