"""python3 run_migration200.py - server/tally-cloud/migration-200-post-settle-itself.sql (18-Nov-2026, branch
next-fix-posttimeout). The owner's rule: a posting never stays "Held"; every posting settles by itself by the evidence; never
a double post; a person only for contradictory evidence, named. On a throwaway PostgreSQL (post_queue_stand: pg_stand, port
31200 unless PG200_PORT; never a real database) with 199 run first, made-up firms, companies and entries only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (one table, one column, one index, if not there; nothing dropped,
     deleted or truncated); every function service_role only, granted explicitly; names no real database; runs twice
  A. c66d0e82 replayed (made-up ids): 661 entries, the reports of 451 stored, the last ones lost to the timeout, every
     acceptance stamped; the cron holds it ("Held: Tally accepted ... nobody has confirmed it"); FinCom's read-back of Tally
     matched all 661 (as the recorder does). The cron's next run (tally_post_settle_itself_all) settles it: done, 661 of 661,
     nothing asked of anyone, nothing sent again, every id kept live, the register in Tally
  B. not read back: checks asked by itself, handed to the posting's own bridge (55's path); "not seen" alone releases
     nothing; once FinCom has read every change in Tally since the posting (the book's match at or above the window's a1),
     those entries alone are released and handed back to the same bridge (resend_only, released); the re-post settles it
  C. contradictory evidence: named for a person (which entries and why), nothing marked or released; the rest settles
  D. a check asked by itself answered "found": marked posted by "FinCom (by itself)"; E. a check given up is asked again
  F. 20,000 entries held (BIG=0 skips): settled in one pass (read back, released, checked), each statement timed under 6 s
RED_WITHOUT_200=1: the same checks without the file (the postings stay held: fails)."""
import os, re, sys, json, time, hashlib, csv
csv.field_size_limit(1 << 30)   # a big posting's results read back whole
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO, OWNER, DA, BA, BK
M199 = os.path.join(PS.SQLDIR, "migration-199-post-match-fast.sql")
M200 = os.path.join(PS.SQLDIR, "migration-200-post-settle-itself.sql")
RED = os.environ.get("RED_WITHOUT_200") == "1"
BIG = os.environ.get("BIG", "1") != "0" and not RED
ME = "00000000-0000-0000-0000-000000000200"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M200).read() if os.path.exists(M200) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M200), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "create table if not exists public.tally_post_self_settle" in code and code.count("create table") == 1
   and code.count("alter table") == 2 and "add column if not exists auto boolean not null default false" in code and code.count("create index if not exists") == 3 and "create trigger" not in code,
   "add-only: one table, one column, three indexes, if not there; no trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
FNS = ["public.tally_member_name(uuid, uuid)", "public.tally_post_self_stamp(text, text, text, text, text, text, text, text)", "public.tally_post_settle_itself(uuid)",
       "public.tally_post_settle_resend(uuid)", "public.tally_post_settle_resend_due(integer)", "public.tally_post_settle_itself_all(integer)"]
ok(sorted(set(re.findall(r"create or replace function (public\.\w+)\(", code))) == sorted(f.split("(")[0] for f in FNS), "only these functions: %s" % ", ".join(FNS))
ok(all(("revoke all on function %s from public, anon, authenticated;" % s) in text and ("grant execute on function %s to service_role;" % s) in text for s in FNS), "service_role only, granted explicitly")
ok("perform cron.schedule('tally-post-settle-itself', '* * * * *', 'select public.tally_post_settle_itself_all()')" in text and "to_regprocedure('cron.schedule(text,text,text)') is not null and to_regprocedure('public.tally_post_work_run(integer)') is null" in text,
   "the cron job every minute, only where pg_cron is and 201 has not given it its own command (scheduled by name: safe twice)")
m55 = open(os.path.join(PS.SQLDIR, "migration-55-settle-and-lease.sql")).read()
a = PS.fbody(text, "tally_member_name") if text else []; b = PS.fbody(m55, "tally_member_name")
ok([l for l in b if l not in a] == ["select coalesce((select nullif(btrim(m.name), '') from members m where m.firm_id = p_firm and m.user_id = p_user limit 1), 'a member of the firm')"] and len([l for l in a if l not in b]) == 2,
   "tally_member_name: 55's text with one case added")

st = PS.Stand(int(os.environ.get("PG200_PORT") or 31200), extra=(M199,)); db = st.db
J = lambda n: "%08d-0000-0000-0000-000000000200" % n
def timed(stmt, uid=None):
    t0 = time.time()
    try: out = db.one(stmt, uid); e = ""
    except RuntimeError as x: out, e = None, str(x)[-300:]
    return out, e, time.time() - t0
def job(n, N, pre="e"):   # a posting of N made-up entries taken by bridge A, running
    V = [{"id": "%s%d-%05d" % (pre, n, k), "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261117</DATE><VOUCHERNUMBER>%d</VOUCHERNUMBER><NARRATION>TDSDesk:%s%d-%05d</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>" % (k + 1, pre, n, k, 100 + k)} for k in range(N)]
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, taken_by, taken_at, created_by) values (%s, %s, 'c1', %s, 'running', %d, %s, %s, %s, now() - interval '50 minutes', %s)"
           % (q(J(n)), q(F), q(CO), N, q(json.dumps({"vouchers": V})), q(DA), q(BA), q(OWNER)))
    return [v["id"] for v in V]
def ok_res(i, k): return {"id": i, "kind": "voucher", "ok": True, "byReply": True, "batchN": 50, "batchEnd": str(90000 + k), "created": 50, "state": "posted", "message": "Posted by Tally's reply"}
def report(n, res, its):   # the bridge's last stored report
    db.sql("update tally_post_jobs set results = %s, items = %s, done = %d where id = %s" % (q(json.dumps(res)), q(json.dumps(its)), sum(1 for r in res if r.get("ok")), q(J(n))))
def stamp(n, ids):   # every acceptance stamped (tally-ingest's accept_many, 199), in parts
    for i in range(0, len(ids), 2000):
        db.one("set role service_role; select tally_post_id_accept_many(%s::uuid, %s::jsonb)::text" % (q(J(n)), q(json.dumps([{"id": x, "reply": True, "batchEnd": "90049", "batchN": 50} for x in ids[i:i + 2000]]))))
def hold(n):   # its bridge silent: the cron's requeue holds it, as on 17-Nov
    db.sql("update tally_post_jobs set updated_at = now() - interval '40 minutes' where id = %s" % q(J(n)))
    db.sql("update tally_devices set last_seen = now() - interval '1 hour', info = '{}'")
    db.one("select tally_post_requeue()::text")
    st.setbeat(DA, st.beat("made-up-a", BA, [CO]))
def held(n):   # held for checking as the requeue leaves a posting it holds (its own words)
    db.sql("update tally_post_jobs set status = 'done', checking = true, message = 'Held: Tally accepted entries of it (made-up)', updated_at = now() - interval '40 minutes' where id = %s" % q(J(n)))
def readback(n, ids):   # FinCom's read-back of Tally matched these entries by their FinCom id (as the recorder writes it)
    db.sql("update tally_post_ids set matched_at = now(), matched_vch = 'V-' || right(fincom_id, 5), matched_guid = 'made-up-guid-' || fincom_id, matched_mid = '7' || right(fincom_id, 5) where job_id = %s and fincom_id = any(%s::text[])"
           % (q(J(n)), q("{" + ",".join(ids) + "}")))
def row(n): return json.loads(db.one("select (to_jsonb(j) - 'payload')::text from tally_post_jobs j where id = %s" % q(J(n))))
def cnt(sql_): return int(db.one(sql_))
SETTLE_ALL = "select tally_post_settle_itself_all()::text"
def resend(n): return json.loads(db.one("set role service_role; set statement_timeout = '8s'; select tally_post_settle_resend(%s::uuid)::text" % q(J(n))) or "{}")
def settle(n): return db.one("set role service_role; set statement_timeout = '8s'; select tally_post_settle_itself(%s::uuid)::text" % q(J(n)))
def window(n, a1, matched):   # the posting window (Tally's change number after the posting) and how far FinCom has read
    db.sql("insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, at) values (%s, %s, %s, %s, 100, %d, 0, now() - interval '20 minutes') on conflict (job_id) do update set a1 = excluded.a1"
           % (q(F), q(BK), q(J(n)), q(DA), a1))
    db.sql("insert into tally_sync_cursor (book_id, firm_id, start_at, match_start, match_alter, match_at) values (%(b)s, %(f)s, '2026-11-01', '2026-11-01', %(m)d, now()) "
           "on conflict (book_id) do update set start_at = '2026-11-01', match_start = '2026-11-01', match_alter = %(m)d, match_at = now()" % {"b": q(BK), "f": q(F), "m": matched})
try:
    print("== 0. runs twice")
    for k in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_200: not run)" % k); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (k, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    st.grants()
    if not RED:
        priv = lambda role, s: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(s)))
        ok(all(priv("authenticated", s) == "false" and priv("anon", s) == "false" and priv("service_role", s) == "true" for s in FNS), "not for anon or authenticated; service_role may")
        ok(db.one("select has_table_privilege('authenticated', 'public.tally_post_self_settle', 'insert')::text") == "false" and db.one("select relrowsecurity::text from pg_class where relname = 'tally_post_self_settle'") == "true",
           "the record: row security on; members read only")

    print("== A. c66d0e82 replayed: 661 entries, the last reports lost, all read back from Tally")
    N = 661
    ids = job(1, N, "stm")
    res = [ok_res(ids[k], k) for k in range(451)]
    its = [{"id": ids[k], "kind": "voucher", "state": "posted" if k < 451 else ("sending" if k < 501 else "waiting")} for k in range(N)] + [{"id": "led:made-up ledger", "kind": "master", "state": "posted"}]
    report(1, res, its); stamp(1, ids); hold(1)
    r = row(1)
    ok(r["status"] == "done" and r["checking"] is True and r["message"].startswith("Held: Tally accepted"), "held by the cron as on staging: %s/%s %s" % (r["status"], r["checking"], r["message"][:70]))
    readback(1, ids)
    out, e, t = timed("set statement_timeout = '8s'; " + SETTLE_ALL)
    r = row(1)
    ok(not e and r["status"] == "done" and r["checking"] is False, "the cron's next run settles it by itself: %s/%s in %.2f s %s %s" % (r["status"], r["checking"], t, out, e))
    ok((r["message"] or "").startswith("Settled by itself") and "posted 661 of 661" in r["message"] and "210 confirmed from FinCom's read-back of Tally" in r["message"], "its words: %s" % r["message"])
    ok(sum(1 for x in r["results"] if x.get("ok")) == N and sum(1 for x in r["results"] if x.get("byItself")) == 210, "every entry's result in Tally (210 stamped by itself)")
    ok(json.loads(db.one("select tally_post_job_settle(status, checking, payload, results, items)::text from tally_post_jobs where id = %s" % q(J(1))))["posted"] == N, "tally_post_job_settle: 661 of 661 posted")
    ok(db.one("select coalesce(tally_post_job_accepted(id, results, items), '<none>') from tally_post_jobs where id = %s" % q(J(1))) == "<none>", "nothing accepted and unconfirmed is left")
    ok(cnt("select count(*) from tally_post_ids where job_id = %s and live and accepted_at is not null and released_at is null" % q(J(1))) == N, "every id kept live (never freed: no double post)")
    ok(cnt("select count(*) from tally_post_register where job_id = %s and state = 'in_tally'" % q(J(1))) == N, "the register: 661 in Tally")
    ok(cnt("select count(*) from tally_post_checks where job_id = %s" % q(J(1))) == 0 and r["resend_only"] in (None, []) and r["attempts"] in (0, None), "nobody asked, nothing sent again")
    ok(db.one("select coalesce(json_agg(id)::text, '[]') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA))) == "[]", "the bridge is handed nothing of it")
    out2 = settle(1)
    ok(json.loads(out2 or "{}").get("held") is False, "run again: nothing to do (%s)" % out2)

    print("== B. not read back: checked by itself; released only when proven, then re-posted once")
    ids = job(2, 20)
    report(2, [ok_res(ids[k], k) for k in range(10)], [{"id": x, "state": "waiting"} for x in ids]); stamp(2, ids[:15]); hold(2)   # (the 5 never accepted: nothing of Tally's says it took them)
    readback(2, ids[10:15]); window(2, 120, 110)   # FinCom's read of Tally is not up to the posting's end yet
    o = json.loads(settle(2) or "{}"); r = row(2)
    ok(o.get("found") == 5 and o.get("waiting") == 5 and o.get("asked") == 5 and r["status"] == "done" and r["checking"] is True and r["message"].startswith("Being checked in Tally by itself: 5 entries"),
       "5 read back posted; 5 checked by itself, never 'nobody has confirmed it': %s" % r["message"][:120])
    ok(cnt("select count(*) from tally_post_checks where job_id = %s and state = 'waiting' and auto and asked_by = %s" % (q(J(2)), q(ME))) == 5, "5 checks asked by itself")
    hand = json.loads(db.one("set role service_role; select tally_post_checks_for(%s::uuid, %s, true)::text" % (q(DA), q(BA))) or "[]")
    ok(sorted(c["entry"] for c in hand if c["job"] == J(2)) == ids[15:], "handed to the posting's own bridge (55's path)")
    ok(json.loads(db.one("set role service_role; select tally_post_checks_for(%s::uuid, %s, true)::text" % (q(PS.DB), q(PS.BB))) or "[]") == [], "never to another bridge")
    for c in hand:
        if c["job"] == J(2): db.one("set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'notseen', '', '', '')::text" % (c["check"], q(DA), q(BA), q(CO)))
    o = json.loads(settle(2) or "{}")
    ok(o.get("released") == 0 and o.get("waiting") == 5 and cnt("select count(*) from tally_post_ids where job_id = %s and live" % q(J(2))) == 20, "'not seen' alone releases nothing (FinCom's read of Tally not complete)")
    o = json.loads(settle(2) or "{}")
    ok(o.get("asked") == 0, "a 'not seen' check is not asked again at once")
    window(2, 120, 125)   # now FinCom has read every change in Tally since the posting: the 5 are not among them
    out, e, t = timed("set role service_role; set statement_timeout = '8s'; select tally_post_settle_itself(%s::uuid)::text" % q(J(2)))
    o = json.loads(out or "{}"); r = row(2)
    ok(not e and o.get("released") == 5 and o.get("resend") is True and r["status"] == "done" and r["checking"] is True and "being sent again by itself" in r["message"],
       "proven not in Tally: 5 released; still held until handed back (%s, %.2f s) %s" % (r["message"][:120], t, e))
    o2 = resend(2); r = row(2)
    ok(o2.get("resent") is True and r["status"] == "waiting" and sorted(r["resend_only"]) == ids[15:] and r["target_bridge"] == BA and r["checking"] is False,
       "handed back in its own call: those 5 alone, to the same bridge (%s)" % r["message"][:160])
    ok(resend(2).get("resent") is False, "called again: nothing handed back twice")
    ok(cnt("select count(*) from tally_post_ids where job_id = %s and not live and released_by = 'owner' and released_at is not null" % q(J(2))) == 5, "their ids released (handed to the bridge as released: sent once)")
    ok(cnt("select count(*) from tally_post_register where job_id = %s and state = 'in_tally'" % q(J(2))) == 15, "the register: 15 in Tally")
    tk = db.one("set role service_role; select coalesce(json_agg(json_build_object('id', id, 'ro', resend_only))::text, '[]') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
    ok(J(2) in tk, "the bridge takes it again (%s)" % tk[:160])
    stamp(2, ids[15:])
    db.sql("set role service_role; update tally_post_jobs set status = 'done', results = results || %s::jsonb, updated_at = now() where id = %s" % (q(json.dumps([ok_res(x, 0) for x in ids[15:]])), q(J(2))))
    r = row(2)
    ok(r["status"] == "done" and not r["checking"] and cnt("select count(*) from tally_post_ids where job_id = %s and live and released_at is null" % q(J(2))) == 20, "re-posted once: done, all 20 live")

    print("== C. contradictory evidence: named, nothing marked or released")
    ids = job(3, 4)
    report(3, [], [{"id": x, "state": "waiting"} for x in ids]); stamp(3, ids); hold(3)
    readback(3, ids[:2]); window(3, 120, 125)
    db.sql("update tally_post_ids set reply_vch = '4401', batch_n = 1 where job_id = %s and fincom_id = %s" % (q(J(3)), q(ids[3])))
    for x, at in ((ids[0], "now() + interval '1 minute'"), (ids[3], "now()")):
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', %s, %s, %s)"
               % (q(F), q(J(3)), q(x), q(CO), q(OWNER), at, q(BA), q(DA)))
    o = json.loads(settle(3) or "{}"); r = row(3)
    names = sorted(c["entry"] for c in o.get("conflicts") or [])
    ok(names == sorted([ids[0], ids[3]]) and o.get("found") == 1 and o.get("waiting") == 1 and r["checking"] is True, "two named for a person, one posted, one checked: %s" % names)
    ok(ids[0] in r["message"] and "deleted or redated" in r["message"] and ids[3] in r["message"] and "4401" in r["message"], "the words say which and why: %s" % r["message"][:300])
    ok(cnt("select count(*) from tally_post_ids where job_id = %s and live" % q(J(3))) == 4 and (r["resend_only"] in (None, [])), "nothing released, nothing sent again")
    ok(cnt("select jsonb_array_length(conflicts) from tally_post_self_settle where job_id = %s" % q(J(3))) == 2, "tally_post_self_settle keeps them for the page")

    print("== D. a check asked by itself answered found / E. given up: asked again")
    ids = job(4, 3)
    report(4, [ok_res(ids[0], 0)], []); stamp(4, ids); hold(4)
    settle(4)
    chk = [c for c in json.loads(db.one("set role service_role; select tally_post_checks_for(%s::uuid, %s, true)::text" % (q(DA), q(BA))) or "[]") if c["job"] == J(4)]
    ok(len(chk) == 2, "two checks handed out")
    a1 = json.loads(db.one("set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'found', '17', '7017', '')::text" % (chk[0]["check"], q(DA), q(BA), q(CO))))
    ok(a1.get("state") == "found", "found: %s" % a1)
    for k in range(10): db.one("set role service_role; select tally_post_check_report(%d, %s::uuid, %s, true, %s, 'unable', '', '', 'Tally busy (made-up)')::text" % (chk[1]["check"], q(DA), q(BA), q(CO)))
    ok(db.one("select state from tally_post_checks where id = %d" % chk[1]["check"]) == "given_up", "ten unable tries: given up (55)")
    r = row(4)
    by = [x.get("by") for x in r["results"] if x.get("id") == chk[0]["entry"] and x.get("byOwner")]
    ok(by == ["FinCom (by itself)"], "marked posted by 'FinCom (by itself)', not a person (%s)" % by)
    o = json.loads(settle(4) or "{}")
    ok(o.get("asked") == 0 and o.get("waiting") == 1, "given up just now: not asked again at once")
    db.sql("update tally_post_checks set given_up_at = now() - interval '20 minutes', checked_at = now() - interval '20 minutes' where id = %d" % chk[1]["check"])
    o = json.loads(settle(4) or "{}"); r = row(4)
    ok(o.get("asked") == 1 and r["checking"] is True and "Being checked in Tally by itself: 1 entry" in r["message"], "asked again by itself, never left held: %s" % r["message"][:100])


    print("== G. proven absent, yet Tally said it took it: never released by itself, named for that entry; the posting settles")
    ids = job(6, 6)
    # 0: stamped accepted (accepted_at); 1: its own reply says Tally created one; 2: its batch's reply (another entry's) says
    # Tally created one; 3: Tally created it in another company; 4: posted (the batch's other entry); 5: nothing of Tally's
    res = [{"id": ids[1], "kind": "voucher", "ok": False, "state": "unknown", "outcomeUnknown": True, "created": 1, "message": "made-up: the reply was cut short"},
           {"id": ids[2], "kind": "voucher", "ok": False, "state": "failed", "sentAt": "2026-11-18T10:07:00Z", "batchN": 2, "batchEnd": "9101", "message": "made-up line error"},
           {"id": ids[4], "kind": "voucher", "ok": True, "byReply": True, "sentAt": "2026-11-18T10:07:00Z", "batchN": 2, "batchEnd": "9101", "created": 1, "state": "posted"},
           {"id": ids[3], "kind": "voucher", "ok": False, "state": "unknown", "outcomeUnknown": True, "wrongCompany": "Made-up Other Traders"}]
    report(6, res, [{"id": x, "kind": "voucher", "state": "posted" if x == ids[4] else "sent"} for x in ids]); stamp(6, [ids[4]]); db.one("set role service_role; select tally_post_id_accept(%s::uuid, %s, null)::text" % (q(J(6)), q(ids[0]))); held(6)
    window(6, 120, 125)
    for x in (ids[0], ids[1], ids[2], ids[3], ids[5]):
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now(), %s, %s, true)"
               % (q(F), q(J(6)), q(x), q(CO), q(ME), q(BA), q(DA)))
    o = json.loads(settle(6) or "{}"); r = row(6)
    names = sorted(c["entry"] for c in o.get("conflicts") or [])
    ok(o.get("released") == 1 and names == sorted(ids[:4]), "only the entry with nothing of Tally's is released; the four named for a person (%s released, %s)" % (o.get("released"), names))
    ok(cnt("select count(*) from tally_post_ids where job_id = %s and live and released_at is null and fincom_id = any(%s::text[])" % (q(J(6)), q("{" + ",".join(ids[:4]) + "}"))) == 4,
       "accepted / its reply created / its batch created / another company: kept live, never released")
    why = {c["entry"]: c["why"] for c in o.get("conflicts") or []}
    ok("accepted" in why.get(ids[0], "") and "created" in why.get(ids[1], "") and "request" in why.get(ids[2], "") and "Made-up Other Traders" in why.get(ids[3], ""),
       "each named with why: %s" % json.dumps(why)[:400])
    flag = {x["id"]: x for x in r["results"] if x.get("conflict")}
    ok(sorted(flag) == sorted(ids[:4]) and all(x.get("needsReview") is True and x.get("ok") is False for x in flag.values())
       and sorted(i["id"] for i in r["items"] if i.get("conflict") and i.get("state") == "needs_review") == sorted(ids[:4]),
       "each of the four flagged on the entry itself (needs review, for a person)")
    ok(o.get("resend") is not True and r["status"] == "done" and r["checking"] is False and "4 need review" in (r["message"] or "") and "once the entries that need review are settled" in (r["message"] or ""),
       "the posting settles at once, not held: the four need review; the proven one waits for them (%s/%s %s)" % (r["status"], r["checking"], (r["message"] or "")[:300]))
    o2 = resend(6)
    ok(o2.get("resent") is False and row(6)["status"] == "done", "not handed back while Tally's acceptances wait for a person (36b's guard asked first: %s)" % o2)
    ok(json.loads(db.one("set role service_role; select tally_post_settle_resend_due()::text")).get("resent") == 0, "the cron does not hand it back yet")
    db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(6)))   # (the caller lets the register follow: its answer's register)
    ok(cnt("select count(*) from tally_post_register where job_id = %s and fincom_id = any(%s::text[]) and state in ('needs_review', 'in_tally')" % (q(J(6)), q("{" + ",".join(ids[:4]) + "}"))) == 4,
       "the register holds the four (needs review): another posting cannot queue them (%s)" % db.one("select string_agg(fincom_id || '=' || state, ', ' order by fincom_id) from tally_post_register where job_id = %s" % q(J(6))))
    for x in ids[:4]:   # a person looks in Tally: there (Mark posted)
        db.one("set role service_role; select tally_post_mark_core(%s::uuid, %s::uuid, %s::uuid, %s, %s, 'made-up: found in Tally')::text" % (q(F), q(OWNER), q(J(6)), q(x), q("V" + x[-2:])))
    out = db.one("set role service_role; " + SETTLE_ALL); r = row(6)
    ok(json.loads(out).get("resent_due") == 1 and r["status"] == "waiting" and r["resend_only"] == [ids[5]], "settled by a person: the cron hands the proven one back alone (%s %s)" % (out, r["resend_only"]))
    ok(J(6) in db.one("set role service_role; select coalesce(string_agg(id::text, ','), '') from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA))), "the bridge takes it again")
    stamp(6, [ids[5]])
    db.sql("set role service_role; update tally_post_jobs set status = 'done', results = results || %s::jsonb, updated_at = now() where id = %s" % (q(json.dumps([ok_res(ids[5], 0)])), q(J(6))))
    r = row(6)
    ok(r["status"] == "done" and r["checking"] is False and cnt("select count(*) from tally_post_ids where job_id = %s and live and released_at is null" % q(J(6))) == 6,
       "re-posted once: done, all six live (%s/%s %s)" % (r["status"], r["checking"], r["message"]))
    ids = job(7, 2)
    report(7, [ok_res(ids[1], 1)], [{"id": ids[0], "state": "sent"}, {"id": ids[1], "state": "posted"}]); stamp(7, ids); held(7); window(7, 120, 125)
    db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now(), %s, %s, true)"
           % (q(F), q(J(7)), q(ids[0]), q(CO), q(ME), q(BA), q(DA)))
    o = json.loads(settle(7) or "{}"); r = row(7)
    ok(o.get("released") == 0 and len(o.get("conflicts") or []) == 1 and r["status"] == "done" and r["checking"] is False and "need" in (r["message"] or ""),
       "only a contradiction left: the posting settles at once (not held), that entry for a person (%s/%s %s)" % (r["status"], r["checking"], (r["message"] or "")[:200]))
    ok(cnt("select count(*) from tally_post_ids where job_id = %s and live" % q(J(7))) == 2 and r["resend_only"] in (None, []), "nothing released, nothing sent again")

    print("== H. never twice: an entry released by itself, then posted in another posting before the hand-back, is not handed back")
    def again(n, x, k, status="waiting"):   # the user posts entry x (the k-th of its posting) again in another posting n
        V = [{"id": x, "xml": "<VOUCHER VCHTYPE=\"Payment\"><DATE>20261117</DATE><VOUCHERNUMBER>%d</VOUCHERNUMBER><NARRATION>TDSDesk:%s</NARRATION><AMOUNT>-%d.00</AMOUNT></VOUCHER>" % (k + 1, x, 100 + k)}]
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, device_id, created_by) values (%s, %s, 'c1', %s, %s, 1, %s, %s, %s)"
               % (q(J(n)), q(F), q(CO), q(status), q(json.dumps({"vouchers": V})), q(DA), q(OWNER)))
    def notseen(n, xs):
        for x in xs:
            db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) values (%s, %s, %s, %s, %s, 'made-up', 'notseen', now(), %s, %s, true)"
                   % (q(F), q(J(n)), q(x), q(CO), q(ME), q(BA), q(DA)))
    # (a) held back by an entry a person must settle (possibly for days): 0 Tally accepted it; 1 posted again in a waiting
    # posting; 3 posted again in a posting that failed since (created after the release); 2 nothing else
    ids = job(8, 4)
    report(8, [], [{"id": x, "kind": "voucher", "state": "sent"} for x in ids])
    db.one("set role service_role; select tally_post_id_accept(%s::uuid, %s, null)::text" % (q(J(8)), q(ids[0]))); held(8); window(8, 120, 125); notseen(8, ids)
    o = json.loads(settle(8) or "{}"); r = row(8)
    ok(o.get("released") == 3 and len(o.get("conflicts") or []) == 1 and r["status"] == "done" and r["checking"] is False, "three proven not in Tally and released, one for a person: settled, the hand-back waits (%s)" % (r["message"] or "")[:160])
    db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(8)))
    again(20, ids[1], 1); again(21, ids[3], 3); db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(21)))
    for x in ids[:1]: db.one("set role service_role; select tally_post_mark_core(%s::uuid, %s::uuid, %s::uuid, %s, %s, 'made-up: found in Tally')::text" % (q(F), q(OWNER), q(J(8)), q(x), q("V" + x[-2:])))
    out = db.one("set role service_role; " + SETTLE_ALL); r = row(8)
    ok(r["status"] == "waiting" and r["resend_only"] == [ids[2]], "settled by a person: handed back with the one nobody posted since, never those posted again elsewhere (%s %s)" % (r["resend_only"], out))
    ok(db.one("select string_agg(entry_id || '=' || state, ',' order by entry_id) from tally_post_checks where job_id = %s and entry_id = any(%s::text[])" % (q(J(8)), q("{%s,%s}" % (ids[1], ids[3]))))
       == "%s=superseded,%s=superseded" % (ids[1], ids[3]) and J(20)[:8] in (r["message"] or ""), "theirs closed, with the posting that took each named (%s)" % (r["message"] or "")[-200:])
    ok(json.loads(db.one("set role service_role; select tally_post_settle_resend_due()::text")).get("looked") == 0, "nothing left for the cron to hand back")
    db.sql("update tally_post_jobs set status = 'failed' where id = any(array[%s, %s]::uuid[])" % (q(J(8)), q(J(20))))
    # (b) no conflict: the brief window between the settling and its hand-back (or the hand-back finding the posting locked)
    ids = job(10, 1)
    report(10, [], [{"id": ids[0], "kind": "voucher", "state": "sent"}]); held(10); window(10, 120, 125); notseen(10, ids)
    o = json.loads(settle(10) or "{}")
    ok(o.get("released") == 1 and o.get("resend") is True and row(10)["checking"] is True, "proven not in Tally: released, held until handed back")
    db.one("set role service_role; select tally_post_register_apply(%s::uuid)::text" % q(J(10)))
    again(22, ids[0], 0)
    o2 = resend(10); r = row(10)
    ok(o2.get("resent") is False and r["status"] in ("done", "failed") and r["checking"] is False and r["resend_only"] in (None, []) and J(22)[:8] in (r["message"] or ""),
       "posted again elsewhere meanwhile: not handed back; the posting settles as its entries say (none posted by it), saying where it went (%s/%s %s %s)" % (r["status"], r["checking"], o2, (r["message"] or "")[-160:]))
    ok(db.one("select state from tally_post_checks where job_id = %s and entry_id = %s" % (q(J(10)), q(ids[0]))) == "superseded" and resend(10).get("resent") is False, "its check closed; called again: nothing")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(22)))

    print("== I. one bad posting never stops the cron's hand-backs")
    ids = job(11, 1); report(11, [], [{"id": ids[0], "kind": "voucher", "state": "sent"}]); held(11); window(11, 120, 125); notseen(11, ids)
    ids2 = job(12, 1); report(12, [], [{"id": ids2[0], "kind": "voucher", "state": "sent"}]); held(12); window(12, 120, 125); notseen(12, ids2)
    for n in (11, 12): settle(n)
    db.sql("update tally_post_jobs set checking = false where id = any(array[%s, %s]::uuid[])" % (q(J(11)), q(J(12))))   # (as a settled posting waiting for its hand-back)
    db.sql("""create or replace function t200_poison() returns trigger language plpgsql as $t$ begin if new.id = %s::uuid and new.status = 'waiting' then raise exception 'made-up poison'; end if; return new; end $t$;
              create trigger t200_poison before update on tally_post_jobs for each row execute function t200_poison();""" % q(J(11)))
    out, e, t = timed("set role service_role; select tally_post_settle_resend_due()::text")
    ok(not e and row(12)["status"] == "waiting" and row(11)["status"] == "done", "the other posting is handed back all the same (%s %s)" % (out, e))
    ok("made-up poison" in (db.one("select words from tally_post_self_settle where job_id = %s" % q(J(11))) or ""), "the bad one's error kept with its record, not silent")
    db.sql("drop trigger t200_poison on tally_post_jobs; update tally_post_jobs set status = 'failed' where id = any(array[%s, %s]::uuid[])" % (q(J(11)), q(J(12))))

    if BIG:
        print("== F. 20,000 entries held: settled in one pass")
        N, LIMIT, timings = 20000, 6.0, {}   # three quarters of the 8 s statement timeout
        ids = job(5, N, "b")
        res = [ok_res(ids[k], k) for k in range(15000)]
        report(5, res, [{"id": x, "state": "posted" if k < 15000 else "waiting"} for k, x in enumerate(ids)])
        t0 = time.time(); stamp(5, ids[:19500]); timings["stamped (one call of 2,000 acceptances, 199)"] = (time.time() - t0) / 10
        t0 = time.time(); hold(5); timings["held by the cron's requeue"] = time.time() - t0
        ok(row(5)["checking"] is True, "held")
        readback(5, ids[15000:19500]); window(5, 30000, 25000)
        out, e, t = timed("set role service_role; set statement_timeout = '8s'; select tally_post_settle_itself(%s::uuid)::text" % q(J(5))); timings["settle: 4,500 read back, 500 checks asked"] = t
        o = json.loads(out or "{}")
        ok(not e and o.get("found") == 4500 and o.get("asked") == 100 and o.get("waiting") == 500 and o.get("register") is True, "4,500 posted by itself, 500 checked (100 asked this run) %s" % e)
        out, e, t = timed("set role service_role; set statement_timeout = '8s'; select tally_post_register_apply(%s::uuid)::text" % q(J(5))); timings["the register follows (its own statement, 199)"] = t
        ok(not e and cnt("select count(*) from tally_post_register where job_id = %s and state = 'in_tally'" % q(J(5))) == 19500, "the register: 19,500 in Tally at once %s" % e)
        db.sql("update tally_post_checks set state = 'notseen', checked_at = now(), checked_bridge = %s, checked_device = %s where job_id = %s and state = 'waiting'" % (q(BA), q(DA), q(J(5))))
        db.sql("insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, state, checked_at, checked_bridge, checked_device, auto) select %s, %s, x, %s, %s, 'made-up', 'notseen', now(), %s, %s, true from unnest(%s::text[]) x"
               " where not exists (select 1 from tally_post_checks k where k.job_id = %s and k.entry_id = x)" % (q(F), q(J(5)), q(CO), q(ME), q(BA), q(DA), q("{" + ",".join(ids[19500:]) + "}"), q(J(5))))
        window(5, 30000, 30001)
        out, e, t = timed("set role service_role; set statement_timeout = '8s'; select tally_post_settle_itself(%s::uuid)::text" % q(J(5))); timings["settle: 500 proven not in Tally, released"] = t
        o = json.loads(out or "{}")
        ok(not e and o.get("released") == 500 and o.get("resend") is True, "500 proven not in Tally, released %s" % e)
        out, e, t = timed("set role service_role; set statement_timeout = '8s'; select tally_post_settle_resend(%s::uuid)::text" % q(J(5))); timings["handed back (tally_post_settle_resend: the change of status)"] = t
        r = row(5)
        ok(not e and r["status"] == "waiting" and len(r["resend_only"]) == 500, "500 handed back alone %s" % e)
        ok(cnt("select count(*) from tally_post_ids where job_id = %s and live" % q(J(5))) == 19500 and cnt("select count(*) from tally_post_register where job_id = %s and state = 'in_tally'" % q(J(5))) == 19500,
           "19,500 kept live and in the register in Tally; 500 free")
        out, e, t = timed("set statement_timeout = '8s'; " + SETTLE_ALL); timings["the cron's run (every held posting)"] = t
        ok(not e, "the cron's run %s %s" % (out, e))
        for k, v in sorted(timings.items(), key=lambda kv: -kv[1]): print("  %6.2f s  %s" % (v, k))
        ok(all(v < LIMIT for v in timings.values()), "every step under %.0f s (the statement timeout is 8 s)" % LIMIT)
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
