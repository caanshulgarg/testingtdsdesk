"""python3 run_migration219.py - server/tally-cloud/migration-219-post-copy-resend.sql (24-Nov-2026, branch
next-fix-reupload-posted; the owner: decide from FinCom's own copy of Tally, never by reading Tally). On a throwaway
PostgreSQL (pg_stand, port 31219 unless PG219_PORT, its data under /tmp/reup219 unless TMPDIR, removed after; never a real
database), the posting queue as post_queue_stand builds it (174, then 184, 185, 199-202), made-up firm and entries only.
  0. the file: one transaction, lock_timeout 10 s; add-only (one function made; no drop, delete, truncate, alter, table);
     names no real database; grants (authenticated; not public, anon); runs twice
  1. FinCom's copy shows the entry only as an Optional voucher: released (the id no longer live, released_by 'owner', the
     copy's state as the reason) and the posting handed back for that entry alone (waiting, resend_only)
  2. deleted in the copy: the same
  3. a regular live voucher in the copy: 'there', nothing changes
  4. no voucher in the copy: 'none', nothing changes
  5. the id live in another posting: refused, nothing changes; a posting still going: refused
  6. a look-only member (readonly) and anon may not run it
RED_WITHOUT_219=1: the same checks without the file (they fail)."""
import os, re, sys, json
os.environ["TMPDIR"] = os.environ.get("PG219_DIR") or "/tmp/reup219"
os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o777)
os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import shutil
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, STAFF, DA, BA, BK
RED = os.environ.get("RED_WITHOUT_219") == "1"
M219 = os.path.join(PS.SQLDIR, "migration-219-post-copy-resend.sql")
EXTRA = [os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql", "migration-199-post-match-fast.sql",
                                               "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql", "migration-202-post-recheck.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

text = open(M219).read() if os.path.exists(M219) and not RED else ""
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
body = re.sub(r"\$function\$.*?\$function\$", "", code, flags=re.S)
ok(bool(text) and not re.search(r"\b(drop|truncate|alter|delete from|create table|insert into|update)\b", body), "add-only outside the function: nothing dropped, deleted, altered or written")
ok(bool(text) and sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_post_copy_resend"], "makes tally_post_copy_resend only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")
ok("revoke all on function public.tally_post_copy_resend(uuid, text) from public, anon;" in text and "grant execute on function public.tally_post_copy_resend(uuid, text) to authenticated;" in text, "grants: authenticated, not public or anon")
ok("security definer set search_path = public, pg_temp" in text, "security definer, search_path public, pg_temp")

st = PS.Stand(int(os.environ.get("PG219_PORT") or 31219), extra=EXTRA); db = st.db
def bye():
    st.stop(); shutil.rmtree(db.data, ignore_errors=True)
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
try:
    if text:
        r = st.psql_text(text); ok(r.returncode == 0, "runs on the stand" + ("" if not r.returncode else ": " + r.stderr[-300:]))
        r = st.psql_text(text); ok(r.returncode == 0, "runs twice")
        # the name guard: another function of that name (other arguments) stops it, nothing changed
        db.sql("create function public.tally_post_copy_resend(p_x int) returns int language sql as 'select 1'")
        r = st.psql_text(text); ok(r.returncode != 0 and "named tally_post_copy_resend exists" in r.stderr, "another function of that name stops it (%s)" % r.stderr.strip()[-120:])
        db.sql("drop function public.tally_post_copy_resend(int)")
        st.grants()
    db.sql("insert into members values ('77777777-7777-7777-7777-777777777218', %s, 'Look', 'readonly', true) on conflict do nothing" % q(F))
    J = lambda n: "%08d-0000-0000-0000-000000000218" % n
    def job(n, vid, status="done"):
        x = '<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20261114</DATE><VOUCHERNUMBER>ZR/%s</VOUCHERNUMBER><NARRATION>TDSDesk:%s | Made-up sale</NARRATION></VOUCHER>' % (vid, vid)
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge, taken_by, taken_at, first_taken_at, attempts, seq, results) values (%s, %s, 'c1', %s, %s, %s, 1, %s, %s, %s, now(), now(), 1, 1, %s)"
               % (q(J(n)), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": [{"id": vid, "xml": x}], "ledger": ""})), q(status), q(BA), q(BA),
                  q(json.dumps([{"id": vid, "ok": True, "byReply": True, "verified": False, "kind": "voucher", "state": "posted"}]))))
        db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, entry_id, job_id, live) values (%s, 'c1', %s, %s, %s, true) on conflict do nothing" % (q(F), q(vid), q(vid), q(J(n))))
    def copy(vid, guid, optional=False, cancelled=False, deleted=False):
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, narration, cancelled, optional, fincom_id, deleted_at) values (%s, %s, %s, '2026-11-14', 9, 'Sales', %s, %s, %s, %s, %s, %s)"
               % (q(BK), q(F), q(guid), q("ZR/" + vid), q("TDSDesk:" + vid + " | Made-up sale"), str(cancelled).lower(), str(optional).lower(), q(vid), "now()" if deleted else "null"))
    run = lambda uid, n, vid, role="authenticated": st.rpc(uid, "select tally_post_copy_resend(%s, %s)::text" % (q(J(n)), q(vid)), role)
    jrow = lambda n: json.loads(db.one("select row_to_json(t)::text from (select status, resend_only, message from tally_post_jobs where id = %s) t" % q(J(n))))
    idrow = lambda n: json.loads(db.one("select row_to_json(t)::text from (select live, released_by, released_why from tally_post_ids where job_id = %s) t" % q(J(n))))

    print("== 1. only an Optional voucher in the copy: released and handed back for that entry alone")
    job(1, "zr1"); copy("zr1", "g-zr1", optional=True)
    r = run(STAFF, 1, "zr1"); jr, ir = jrow(1), idrow(1)
    ok(r.get("ok") is True and r.get("state") == "optional" and r.get("resent") is True, "the answer: optional, sent again (%s)" % r)
    ok(ir["live"] is False and ir["released_by"] == "owner" and "Optional voucher" in (ir["released_why"] or ""), "the id released, as an owner's release, with the copy's words (%s)" % ir)
    ok(jr["status"] == "waiting" and jr["resend_only"] == ["zr1"], "the posting handed back for that entry alone (%s)" % jr)
    print("== 2. deleted in the copy")
    job(2, "zr2"); copy("zr2", "g-zr2", optional=True, deleted=True)
    r = run(OWNER, 2, "zr2"); jr = jrow(2)
    ok(r.get("state") == "deleted" and r.get("resent") is True and jr["resend_only"] == ["zr2"] and idrow(2)["live"] is False, "deleted: released and handed back (%s)" % r)
    print("== 3. a regular voucher in the copy")
    job(3, "zr3"); copy("zr3", "g-zr3")
    r = run(STAFF, 3, "zr3")
    ok(r.get("ok") is False and r.get("state") == "there" and r.get("vno") == "ZR/zr3" and idrow(3)["live"] is True and jrow(3)["status"] == "done", "there: nothing changes (%s)" % r)
    print("== 4. nothing in the copy")
    job(4, "zr4")
    r = run(STAFF, 4, "zr4")
    ok(r.get("state") == "none" and idrow(4)["live"] is True and jrow(4)["status"] == "done", "none: nothing changes (%s)" % r)
    print("== 5. live in another posting; a posting still going")
    job(5, "zr5"); copy("zr5", "g-zr5", deleted=True)
    db.sql("update tally_post_ids set live = false where job_id = %s" % q(J(5))); job(6, "zr5")
    r = run(STAFF, 5, "zr5")
    ok(r.get("state") == "elsewhere" and idrow(6)["live"] is True and jrow(5)["status"] == "done", "the id live in another posting: refused (%s)" % r)
    job(7, "zr7", status="running"); copy("zr7", "g-zr7", deleted=True)
    r = run(STAFF, 7, "zr7")
    ok(r.get("state") == "busy" and idrow(7)["live"] is True, "a posting still going: refused (%s)" % r)
    print("== 6. who may")
    job(8, "zr8"); copy("zr8", "g-zr8", deleted=True)
    r = run("77777777-7777-7777-7777-777777777218", 8, "zr8")
    ok("_error" in r and idrow(8)["live"] is True, "a look-only member is refused (%s)" % str(r)[:120])
    r = run(STAFF, 8, "zr8", role="anon")
    ok("_error" in r and idrow(8)["live"] is True, "anon may not run it (%s)" % str(r)[:120])
finally:
    bye()
print("\n" + ("all passed" if not fails else "%d FAILED" % len(fails))); raise SystemExit(1 if fails else 0)
