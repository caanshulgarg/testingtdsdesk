"""python3 run_migration219.py - server/tally-cloud/migration-219-post-copy-resend.sql (24-Nov-2026, branch
next-fix-reupload-posted; the owner: decide from FinCom's own copy of Tally, never by reading Tally). On a throwaway
PostgreSQL (pg_stand, port 31219 unless PG219_PORT, its data under /tmp/reup219 unless TMPDIR, removed after; never a real
database), the posting queue as post_queue_stand builds it (174, then 184, 185, 199-202), made-up firm and entries only.
  0. the file: one transaction, lock_timeout 10 s; add-only (one function made; no drop, delete, truncate, alter, table);
     names no real database; grants (authenticated; not public, anon); runs twice
  1. a fresh copy (a recorder line of the book after the send) showing the entry only as an Optional voucher, never
     accepted by Tally: released (released_by 'owner', the copy's words) and the posting handed back for it alone
  2. deleted in the fresh copy after Tally's acceptance: the same; the same on a stale copy (nothing received after the
     send): 'unsure', nothing changes
  3. a regular live voucher: 'there'; 4. nothing in the linked book: 'none'
  5. the reviews of 24-Nov-2026 (probes A, B, C): a second press after the resend went through and Tally took it again
     (accepted after the copy's deletion): 'unsure', not handed back again; an Optional-only copy of an accepted entry:
     'unsure'; an earlier release newer than the copy's last report: 'unsure'; a failed posting: refused with its words,
     its other entries' ids untouched; a cancelled posting: its own words; a posting that does not hold the id (not live):
     'notheld'; the id reserved for another posting's hand-back: 'elsewhere'; a posting still going:
     'busy'
  6. the name guard: another function of that name, or one marked 219's with other arguments, stops the file
  7. a look-only member (readonly) and anon may not run it
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
        for decoy, cmt in [("p_x int", None), ("p_job uuid, p_id text, p_more int", "tally post copy resend (migration 219)")]:
            db.sql("create function public.tally_post_copy_resend(%s) returns int language sql as 'select 1'" % decoy)
            if cmt: db.sql("comment on function public.tally_post_copy_resend(%s) is %s" % (decoy, q(cmt)))
            r = st.psql_text(text); ok(r.returncode != 0 and "named tally_post_copy_resend exists" in r.stderr, "the name guard stops on tally_post_copy_resend(%s)%s (%s)" % (decoy, " marked 219's" if cmt else "", r.stderr.strip()[-90:]))
            db.sql("drop function public.tally_post_copy_resend(%s)" % ", ".join(a.split()[-1] for a in decoy.split(", ")))
        st.grants()
    LOOK = "77777777-7777-7777-7777-777777777219"
    db.sql("insert into members values (%s, %s, 'Look', 'readonly', true) on conflict do nothing" % (q(LOOK), q(F)))
    J = lambda n: "%08d-0000-0000-0000-000000000219" % n
    def job(n, vids, status="done", live=True, accepted=False):
        vids = [vids] if isinstance(vids, str) else vids
        vs = [{"id": v, "xml": '<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20261114</DATE><VOUCHERNUMBER>ZR/%s</VOUCHERNUMBER><NARRATION>TDSDesk:%s | Made-up sale</NARRATION></VOUCHER>' % (v, v)} for v in vids]
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, target_bridge, taken_by, taken_at, first_taken_at, attempts, seq, results) values (%s, %s, 'c1', %s, %s, %s, %d, %s, %s, %s, now() - interval '3 hours', now() - interval '3 hours', 1, 1, %s)"
               % (q(J(n)), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": vs, "ledger": ""})), len(vs), q(status), q(BA), q(BA),
                  q(json.dumps([{"id": v, "ok": True, "byReply": True, "verified": False, "kind": "voucher", "state": "posted"} for v in vids]))))
        for v in vids:
            db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, entry_id, job_id, live, accepted_at) values (%s, 'c1', %s, %s, %s, %s, %s) on conflict (job_id, fincom_id) do update set live = excluded.live, accepted_at = excluded.accepted_at"
                   % (q(F), q(v), q(v), q(J(n)), str(live).lower(), "now() - interval '3 hours'" if accepted else "null"))
    def copy(vid, guid, optional=False, cancelled=False, deleted=False):
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, narration, cancelled, optional, fincom_id, deleted_at) values (%s, %s, %s, '2026-11-14', 9, 'Sales', %s, %s, %s, %s, %s, %s)"
               % (q(BK), q(F), q(guid), q("ZR/" + vid), q("TDSDesk:" + vid + " | Made-up sale"), str(cancelled).lower(), str(optional).lower(), q(vid), "now() - interval '1 hour'" if deleted else "null"))
    def fresh():   # a recorder line of the book received now (after every posting's send above)
        db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, received_at, state) values (%s, 'c1', %s, %s, %s, 'altered', now(), 'applied')"
               % (q(F), q(BK), q(DA), q("line-%d" % len(db.one("select count(*)::text from tally_recorder_lines") or "0"))))
    run = lambda uid, n, vid, role="authenticated": st.rpc(uid, "select tally_post_copy_resend(%s, %s)::text" % (q(J(n)), q(vid)), role)
    jrow = lambda n: json.loads(db.one("select row_to_json(t)::text from (select status, resend_only, message from tally_post_jobs where id = %s) t" % q(J(n))))
    idrow = lambda n, vid=None: json.loads(db.one("select row_to_json(t)::text from (select live, released_by, released_why from tally_post_ids where job_id = %s%s) t" % (q(J(n)), "" if vid is None else " and fincom_id = " + q(vid))))
    untouched = lambda n: jrow(n)["status"] == "done" and jrow(n)["resend_only"] is None

    print("== 2b. a stale copy (nothing received since the send): unsure, nothing changes")
    job(20, "zs", accepted=True); copy("zs", "g-zs", deleted=True)
    db.sql("update tally_vouchers set deleted_at = now() where fincom_id = 'zs'")
    r = run(STAFF, 20, "zs")
    ok(r.get("state") == "unsure" and "not up to date" in (r.get("error") or "") and idrow(20)["live"] is True and untouched(20), "stale copy: unsure, nothing released (%s)" % r)
    fresh()
    print("== 1. only an Optional voucher in a fresh copy, never accepted: released and handed back for that entry alone")
    job(1, "zr1"); copy("zr1", "g-zr1", optional=True); fresh()
    r = run(STAFF, 1, "zr1"); jr, ir = jrow(1), idrow(1)
    ok(r.get("ok") is True and r.get("state") == "optional" and r.get("resent") is True, "the answer: optional, sent again (%s)" % r)
    ok(ir["live"] is False and ir["released_by"] == "owner" and "Optional voucher" in (ir["released_why"] or ""), "the id released, as an owner's release, with the copy's words (%s)" % ir)
    ok(jr["status"] == "waiting" and jr["resend_only"] == ["zr1"], "the posting handed back for that entry alone (%s)" % jr)
    print("== 2. deleted in the fresh copy after Tally's acceptance")
    job(2, "zr2", accepted=True); copy("zr2", "g-zr2", optional=True, deleted=True); fresh()
    r = run(OWNER, 2, "zr2")
    ok(r.get("state") == "deleted" and r.get("resent") is True and jrow(2)["resend_only"] == ["zr2"] and idrow(2)["live"] is False, "deleted: released and handed back (%s)" % r)
    print("== 3. a regular voucher in the copy; 4. nothing in the copy")
    job(3, "zr3"); copy("zr3", "g-zr3")
    r = run(STAFF, 3, "zr3")
    ok(r.get("state") == "there" and r.get("vno") == "ZR/zr3" and idrow(3)["live"] is True and untouched(3), "there: nothing changes (%s)" % r)
    job(4, "zr4")
    r = run(STAFF, 4, "zr4")
    ok(r.get("state") == "none" and idrow(4)["live"] is True and untouched(4), "none: nothing changes (%s)" % r)
    print("== 5. the reviews' cases")
    # probe A: the resend went through, Tally took it again (accepted now), the copy still shows the old deletion
    job(5, "pa", accepted=True); copy("pa", "g-pa", deleted=True); fresh()
    r1 = run(STAFF, 5, "pa")
    db.sql("update tally_post_jobs set status = 'taken' where id = %s" % q(J(5))); db.sql("update tally_post_jobs set status = 'running' where id = %s" % q(J(5)))
    db.sql("update tally_post_ids set live = true, accepted_at = now(), released_at = null, released_by = null where job_id = %s" % q(J(5)))
    db.sql("""update tally_post_jobs set status = 'done', resend_only = null, results = '[{"id":"pa","ok":true,"verified":true,"state":"in_tally","kind":"voucher"}]' where id = %s""" % q(J(5)))
    fresh()
    r2 = run(STAFF, 5, "pa")
    ok(r1.get("resent") is True and r2.get("state") == "unsure" and idrow(5)["live"] is True and untouched(5), "A: a second press after Tally took it again: unsure, not handed back again (%s)" % r2)
    # an Optional-only copy of an entry Tally accepted: no time to compare: unsure
    job(6, "po", accepted=True); copy("po", "g-po", optional=True); fresh()
    r = run(STAFF, 6, "po")
    ok(r.get("state") == "unsure" and idrow(6)["live"] is True and untouched(6), "an accepted entry, the copy Optional only: unsure (%s)" % r)
    # an earlier release of it in this posting newer than the copy's last report
    job(7, "pm"); copy("pm", "g-pm", deleted=True); fresh()
    # (released after the copy's last report of it: its row and version were written before this statement)
    db.sql("insert into tally_post_marks (firm_id, job_id, entry_id, action, note, at) values (%s, %s, 'pm', 'released', 'an earlier release', clock_timestamp())" % (q(F), q(J(7))))
    r = run(STAFF, 7, "pm")
    ok(r.get("state") == "unsure" and idrow(7)["live"] is True and untouched(7), "an earlier release newer than the copy's report: unsure (%s)" % r)
    # probe B: a failed posting of three, one handed back would re-arm the others
    job(8, ["pb1", "pb2", "pb3"], status="failed", live=False)
    db.sql("update tally_post_ids set live = true, accepted_at = now() - interval '3 hours' where job_id = %s and fincom_id = 'pb1'" % q(J(8)))
    copy("pb1", "g-pb1", deleted=True); fresh()
    before = db.one("select string_agg(fincom_id || ':' || live::text, ',' order by fincom_id) from tally_post_ids where job_id = %s" % q(J(8)))
    r = run(STAFF, 8, "pb1")
    after = db.one("select string_agg(fincom_id || ':' || live::text, ',' order by fincom_id) from tally_post_ids where job_id = %s" % q(J(8)))
    ok(r.get("state") == "failed" and "Retry" in (r.get("error") or "") and before == after and jrow(8)["status"] == "failed", "B: a failed posting: refused with its words, its ids untouched (%s; %s)" % (r, after))
    job(9, "pk", status="cancelled"); copy("pk", "g-pk", deleted=True)
    r = run(STAFF, 9, "pk")
    ok(r.get("state") == "cancelled" and "cancelled" in (r.get("error") or ""), "a cancelled posting: its own words (%s)" % r)
    # probe C: a posting that does not hold the id (not live), the id free
    job(10, "pc", live=False); copy("pc", "g-pc", deleted=True); fresh()
    r = run(STAFF, 10, "pc")
    ok(r.get("state") == "notheld" and jrow(10)["status"] == "done" and jrow(10)["resend_only"] is None, "C: a posting that does not hold the id: refused (%s)" % r)
    # (live in another posting cannot happen while this one holds it live: the id's unique index) reserved for another
    # posting's hand-back
    job(13, "zq"); copy("zq", "g-zq", deleted=True); fresh()
    # (another posting handed back with zq to send: set up straight, its queue triggers off for these two rows)
    db.sql("set session_replication_role = replica; insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, attempts, seq, results, resend_only) values (%s, %s, 'c1', %s, %s, %s, 1, 'waiting', 1, 1, '[]', '[\"zq\"]')"
           % (q(J(14)), q(F), q(CO), q(DA), q(json.dumps({"masters": [], "vouchers": [{"id": "zq2", "xml": "<VOUCHER/>"}], "ledger": ""}))))
    db.sql("set session_replication_role = replica; insert into tally_post_ids (firm_id, client_id, fincom_id, entry_id, job_id, live, released_at, released_by) values (%s, 'c1', 'zq', 'zq', %s, false, now(), 'owner')" % (q(F), q(J(14))))
    r = run(STAFF, 13, "zq")
    ok(r.get("state") == "elsewhere" and untouched(13), "reserved for another posting's hand-back: refused (%s)" % r)
    job(15, "zr7", status="running"); copy("zr7", "g-zr7", deleted=True)
    r = run(STAFF, 15, "zr7")
    ok(r.get("state") == "busy" and idrow(15)["live"] is True, "a posting still going: refused (%s)" % r)
    print("== 7. who may")
    job(16, "zr8"); copy("zr8", "g-zr8", deleted=True); fresh()
    r = run(LOOK, 16, "zr8")
    ok("_error" in r and idrow(16)["live"] is True, "a look-only member is refused (%s)" % str(r)[:120])
    r = run(STAFF, 16, "zr8", role="anon")
    ok("_error" in r and idrow(16)["live"] is True, "anon may not run it (%s)" % str(r)[:120])
finally:
    bye()
print("\n" + ("all passed" if not fails else "%d FAILED" % len(fails))); raise SystemExit(1 if fails else 0)
