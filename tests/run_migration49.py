"""python3 run_migration49.py - migration-49-post-row-flags (the owner's spec of 04-Oct-2026, item J: Hide and Remove of the rows
on the Post to Tally page), on throwaway PostgreSQL (pg_stand, port 30490; never a real database), built in staging's order
32 -> 33 -> 35 -> 34 (as run on staging) -> 36b -> 37 -> 36 -> 38 -> ... -> 43 (as run_enqueue_held_id.py), then 49 (twice).
Checked:
  the file: begin; set local lock_timeout = '10s'; commit; add-only (no drop, no alter of an existing table, no "delete
    from" anywhere); runs twice; md5 of each function's body (pg_proc.prosrc) is the file's text between its $function$
    marks (printed for the report);
  the functions: security definer, search_path public, pg_temp; tally_post_row_hide / _remove / _restore executable by
    authenticated, not by public or anon; the key check (tally_post_row_keys) by none of them;
  RLS: a member reads the firm's 'remove' flags and their own 'hide' flags, not another member's hides nor another firm's
    flags; no member writes the table directly (insert, update, delete refused);
  hide: for the caller only, once (a second hide adds nothing); show again stamps restored_at (the row stays);
  remove: one row by any member; more than one by an owner only; a row of another firm's posting refused; a row whose posting
    is still going on (waiting, taken, running, checking) refused and nothing removed; restore: one by a member, more by
    an owner;
  SAFETY: md5 of tally_post_jobs, tally_post_ids and tally_post_marks unchanged by every call; after its Posted row is
    removed, the same bill posted again is refused by tally_post_enqueue (its FinCom id is taken), nothing queued.
RED (before 49): the file is missing."""
import os, sys, json, re, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql")]
M49 = os.environ.get("M49_FILE") or os.path.join(SQLDIR, "migration-49-post-row-flags.sql")
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
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, STAFF2, OTHER = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
D1 = "d1000000-0000-0000-0000-000000000001"
J = lambda n: "%08d-0000-0000-0000-00000000e0e0" % n
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
def job(jid, vs, status="running", firm=F, client="c1"):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, %s, 'ZZ CO', %s, %d, %s);" % (q(jid), q(firm), q(client), q(json.dumps({"vouchers": vs})), len(vs), q(status))
def reply(i, vid):
    return {"id": i, "ok": True, "byReply": True, "verified": False, "vchId": vid, "batchN": 1, "batchEnd": vid, "lastVchId": vid, "state": "posted", "vchDate": "20261001", "vchType": "Journal", "sentAt": "2026-10-04T05:00:30Z", "created": 1}
text = open(M49).read() if os.path.exists(M49) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M49))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;", text, re.M) and re.search(r"set local lock_timeout = '10s';", text) and text.rstrip().endswith("commit;"), "49: begin; set local lock_timeout = '10s'; ... commit;")
ok("delete from" not in low, "49: no 'delete from' anywhere in the file")
ok(not re.search(r"\bdrop\s+(table|function|policy|index|column|view|trigger)\b", low) and not re.search(r"alter\s+table\s+(?!public\.tally_post_row_flags\b)", low) and not re.search(r"\btruncate\s+(table\s+)?public\.", low),
   "49: add-only (no drop, no alter of another table, no truncate)")
db = pg_stand.start(30490)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def tries(stmt, uid=None):
    try: db.sql(stmt, uid); return True, ""
    except RuntimeError as e: return False, str(e)
HASH = "select md5(coalesce((select string_agg(t::text, '|' order by t::text) from tally_post_jobs t), '') || '#' || coalesce((select string_agg(t::text, '|' order by t::text) from tally_post_ids t), '') || '#' || coalesce((select string_agg(t::text, '|' order by t::text) from tally_post_marks t), ''))"
nflags = lambda: int(db.one("select count(*) from tally_post_row_flags"))
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into firms values (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul garg', 'owner', true), (%(S)s, %(F)s, 'Ankit Garg', 'staff', true), (%(S2)s, %(F)s, 'Lock Test', 'staff', true), (%(X)s, %(F2)s, 'Someone else', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.8');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Testing AAD', '{"postTo": "ZZ CO"}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "S2": q(STAFF2), "X": q(OTHER), "D1": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:])); raise SystemExit("cannot go on")
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      create or replace function public.tally_nm(p text) returns text language sql immutable as 'select lower(btrim(coalesce($1, '''')))';
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen) values (%s, 'ZZ CO', 'c1', %s, now());""" % (q(F), q(D1)))
    # the postings: J1 done by Tally's reply (B1 accepted, its id live); J2 failed (B2 refused, freed); J3 still running
    # (B3, the cloud checking); J4 waiting; J9 another firm's
    db.sql(job(J(1), [vch("B1")]))
    db.sql("update tally_post_jobs set status = 'done', done = 1, message = 'Posted 1 of 1 (Tally''s reply)', results = %s, items = %s, updated_at = now() where id = %s"
           % (q(json.dumps([reply("B1", "26307")])), q(json.dumps([{"id": "B1", "state": "posted"}])), q(J(1))))
    db.sql("select tally_post_id_accept_reply(%s::uuid, 'B1', '26307', '26307', 1)" % q(J(1)))
    db.sql(job(J(2), [vch("B2")]))
    db.sql("update tally_post_jobs set status = 'failed', message = 'Failed', results = %s, items = %s where id = %s" % (q(json.dumps([{"id": "B2", "ok": False, "message": "Ledger 'X' does not exist"}])), q(json.dumps([{"id": "B2", "state": "failed"}])), q(J(2))))
    db.sql(job(J(3), [vch("B3")]))
    db.sql("update tally_post_jobs set checking = true, results = %s where id = %s" % (q(json.dumps([{"id": "B3", "ok": False, "outcomeUnknown": True}])), q(J(3))))
    db.sql(job(J(4), [vch("B4")], "waiting"))
    db.sql("insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (%s, %s, 'B1', 'posted', '26307', 'seen', %s)" % (q(F), q(J(1)), q(OWNER)))
    db.sql("insert into firms values (%s, 'x') on conflict do nothing" % q(F2))
    db.sql(job(J(9), [vch("Z9")], "done", F2, "c9"))
    # ---- 49, twice
    for i in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "49 runs (%s time) %s" % (["", "first", "second"][i], (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    ok(int(db.one("select count(*) from pg_policies where tablename = 'tally_post_row_flags'")) == 1, "49 twice: one policy, as it was")
    h0 = db.one(HASH)
    # ---- the functions
    FN = ["tally_post_row_keys", "tally_post_row_hide", "tally_post_row_remove", "tally_post_row_restore"]
    for fn in FN:
        r = db.rows("select p.prosecdef::text sd, array_to_string(p.proconfig, ',') cfg, md5(p.prosrc) m, p.prosrc src, has_function_privilege('authenticated', p.oid, 'execute')::text au, has_function_privilege('anon', p.oid, 'execute')::text an, "
                    "has_function_privilege('public', p.oid, 'execute')::text pu from pg_proc p where p.proname = %s" % q(fn))
        x = r[0] if r else {}
        body = re.search(r"function public\." + fn + r"\(.*?\$function\$(.*?)\$function\$", text, re.S)
        want_auth = "false" if fn == "tally_post_row_keys" else "true"
        ok(x and x["sd"] == "true" and x["cfg"] == "search_path=public, pg_temp" and x["au"] == want_auth and x["an"] == "false" and x["pu"] == "false",
           "%s: security definer, search_path = public, pg_temp; authenticated %s, anon and public no (%s)" % (fn, want_auth, {k: x.get(k) for k in ("sd", "cfg", "au", "an", "pu")}))
        ok(body and hashlib.md5(body.group(1).encode()).hexdigest() == x.get("m"), "%s: md5(prosrc) = the file's body: %s" % (fn, x.get("m")))
        ok(not re.search(r"\b(insert\s+into|update|delete)\s+(public\.)?tally_post_(jobs|ids|marks)\b", (x.get("src") or "").lower()), "%s never writes tally_post_jobs, tally_post_ids or tally_post_marks" % fn)
    K1, K2, K3, K4, K9, KL = J(1) + ":B1", J(2) + ":B2", J(3) + ":B3", J(4) + ":B4", J(9) + ":Z9", "local:emuqip07ppksjl"
    arr = lambda ks: "array[%s]::text[]" % ",".join(q(k) for k in ks)
    call = lambda uid, s: as_user(uid, "select %s::text" % s)
    # ---- RLS: no direct writes
    for stmt in ("insert into tally_post_row_flags (firm_id, row_key, kind, user_id) values (%s, %s, 'remove', %s)" % (q(F), q(K1), q(STAFF)),
                 "update tally_post_row_flags set why = 'x'", "delete " + "from tally_post_row_flags"):
        good, err = as_user(STAFF, stmt + " returning 1" if stmt.startswith("insert") else stmt)
        ok(not good and ("permission denied" in err or "42501" in err), "RLS: a member cannot %s the table directly (%s)" % (stmt.split()[0], err.strip()[-90:]))
    # ---- hide
    good, out = call(STAFF, "tally_post_row_hide(%s, true)" % arr([K1, K2]))
    ok(good and json.loads(out)["n"] == 2, "hide: a member hides two rows for themself (%s)" % out)
    good, out = call(STAFF, "tally_post_row_hide(%s, true)" % arr([K1]))
    ok(good and json.loads(out)["n"] == 0 and int(db.one("select count(*) from tally_post_row_flags where kind = 'hide' and restored_at is null")) == 2, "hide: the same row again adds nothing (%s)" % out)
    seen = lambda uid: db.rows("set role authenticated; select row_key, kind, user_id::text from tally_post_row_flags where restored_at is null order by row_key, kind", uid)
    ok(len(seen(STAFF)) == 2 and seen(STAFF2) == [] and seen(OWNER) == [], "RLS: hides are the hider's own: the staff member reads 2, another member and the owner 0")
    good, out = call(STAFF, "tally_post_row_hide(%s, false)" % arr([K2]))
    ok(good and int(db.one("select count(*) from tally_post_row_flags where row_key = %s and kind = 'hide' and restored_at is not null and restored_by = %s" % (q(K2), q(STAFF)))) == 1 and nflags() == 2,
       "show again: restored_at stamped, the row stays (nothing removed) (%s)" % out)
    # ---- remove
    good, out = call(STAFF, "tally_post_row_remove(%s, 'seen in Tally')" % arr([K1]))
    ok(good and json.loads(out)["n"] == 1, "remove: one row by a staff member (%s)" % out)
    ok([r["row_key"] for r in seen(STAFF2) if r["kind"] == "remove"] == [K1] and [r["row_key"] for r in seen(OWNER)] == [K1], "RLS: a removed row is read by every member of the firm")
    ok(as_user(OTHER, "select count(*)::text from tally_post_row_flags")[1] == "0", "RLS: another firm reads none of it")
    good, err = call(STAFF, "tally_post_row_remove(%s, '')" % arr([K2, KL]))
    ok(not good and "only an owner" in err, "remove: more than one row by a staff member is refused (%s)" % err.strip()[-90:])
    good, out = call(OWNER, "tally_post_row_remove(%s, '')" % arr([K2, KL, K1]))
    ok(good and json.loads(out)["n"] == 2, "remove: an owner removes several (K1 already removed: not twice) (%s)" % out)
    n0 = nflags()
    for k, what in ((K3, "running, being checked"), (K4, "waiting")):
        good, err = call(OWNER, "tally_post_row_remove(%s, '')" % arr([K2, k]))
        ok(not good and "still going on" in err and nflags() == n0, "SAFETY: a row whose posting is still going on (%s) cannot be removed; nothing removed (%s)" % (what, err.strip()[-110:]))
    good, err = call(OWNER, "tally_post_row_remove(%s, '')" % arr([K9]))
    ok(not good and "not a posting of your firm" in err, "remove: a row of another firm's posting is refused (%s)" % err.strip()[-90:])
    good, err = call(OWNER, "tally_post_row_hide(%s, true)" % arr(["x"]))
    ok(not good and "not a row of this list" in err, "a key that is not a row is refused (%s)" % err.strip()[-90:])
    good, err = as_user(STAFF, "select tally_post_row_keys(%s)::text" % arr([K1]))
    ok(not good and "permission denied" in err, "the key check is not callable on its own")
    # ---- restore
    good, err = call(STAFF, "tally_post_row_restore(%s)" % arr([K2, KL]))
    ok(not good and "only an owner" in err, "restore: more than one by a staff member is refused (%s)" % err.strip()[-90:])
    good, out = call(STAFF, "tally_post_row_restore(%s)" % arr([KL]))
    ok(good and json.loads(out)["n"] == 1, "restore: one row by a staff member (%s)" % out)
    good, out = call(OWNER, "tally_post_row_restore(%s)" % arr([K2]))
    ok(good and json.loads(out)["n"] == 1 and int(db.one("select count(*) from tally_post_row_flags where kind = 'remove' and restored_at is null")) == 1, "restore: by an owner; K1 alone stays removed (%s)" % out)
    good, out = call(OWNER, "tally_post_row_remove(%s, 'again')" % arr([KL]))
    ok(good and json.loads(out)["n"] == 1, "a restored row can be removed again (%s)" % out)
    # ---- SAFETY: nothing of the postings changed, and the removed bill cannot be posted again
    ok(db.one(HASH) == h0, "SAFETY: md5 of tally_post_jobs, tally_post_ids and tally_post_marks unchanged by every call (%s)" % h0)
    x = db.rows("select live::text, accepted_at is not null as acc, released_at from tally_post_ids where job_id = %s and fincom_id = 'B1'" % q(J(1)))[0]
    ok(x["live"] == "true" and x["acc"] == "t" and not x["released_at"], "SAFETY: B1's Posted row removed: its FinCom id is still live and accepted (%s)" % x)
    njobs = int(db.one("select count(*) from tally_post_jobs"))
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(5)), q(json.dumps({"vouchers": [vch("B1")]}))))
    refused = (not good and "its FinCom id is taken" in out) or (good and json.loads(out).get("ok") is False)
    ok(refused and int(db.one("select count(*) from tally_post_jobs")) == njobs, "SAFETY: the bill whose Posted row was removed, posted again: tally_post_enqueue refuses it (its FinCom id is taken), nothing queued (%s)" % out.strip()[-140:])
    print("\n  md5 of each function body of migration 49 (pg_proc.prosrc):")
    for fn in FN: print("    %-24s %s" % (fn, db.one("select md5(prosrc) from pg_proc where proname = %s" % q(fn))))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
