"""python3 run_migration132.py - migration-132-post-record (30-Oct-2026, next-fix-bank-post; NOT run on staging).
The owner's report of 30-Oct-2026: a client's bank statement posted to Tally, "some entries were not posted". The client's
Tally book has no from date, so the page posted straight to the FinCom Bridge and then asked the cloud to record the posting
(tally_post_record, migration 27). Staging has no tally_post_record (27 never ran there): no record, no register row, nothing
on the Post page, and the page said nothing. On a throwaway PostgreSQL (pg_stand, port 31132; never a real database) built
32 -> ... -> 55 -> 111 in staging's order (as run_migration111.py), WITHOUT 27, as staging is:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), add-only (no drop, delete, truncate, alter),
     names no real database, explicit revoke / grant, search_path public, pg_temp; md5 of the file and the function
  1. RED: tally_post_record is not there (the page's call fails "not found"), so a posting made straight to a bridge leaves
     nothing in tally_post_jobs, tally_post_ids or tally_post_register
  2. 132 runs twice; it adds no posting, id or register row
  3. the owner's case, made up: a posting of 70 bank lines straight to the bridge, two requests (50: Tally made 8; 20: made 16):
     recorded as failed, device none, payload recorded; 70 ids; the register holds all 70 as needs_review with Tally's words,
     none in_tally on a guess
  4. the same id recorded again (the read-back): brought up to date, not a second posting
  5. the 46 posted again after a check, Tally made them whole: recorded done; their register rows in_tally (a recorded
     posting is a fact, the duplicate guard does not refuse it); a one-line posting Tally refused -> refused with its words
  6. who may: a viewer, a member of another firm, a client of another firm, anon: refused; the firm's staff may"""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M132 = os.environ.get("M132_FILE") or os.path.join(SQLDIR, "migration-132-post-record.sql")
M111 = os.path.join(SQLDIR, "migration-111-post-register.sql")
text = open(M132).read() if os.path.exists(M132) else ""
import pg_stand
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql")] + [M111]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEWER, OTHER = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
D1 = "d1000000-0000-0000-0000-000000000001"
BOOK, BOOK2 = "b0000000-0000-0000-0000-000000000132", "b0000000-0000-0000-0000-000000000232"
JOB1, JOB2, JOB3 = "13200000-0000-0000-0000-000000000001", "13200000-0000-0000-0000-000000000002", "13200000-0000-0000-0000-000000000003"
CO = "ZETA ADVISORY SERVICES PRIVATE LIMITED"
IDS = ["s1-%d" % i for i in range(70)]
GOOD1 = {0, 7, 14, 21, 28, 35, 42, 49}; BAD2 = {52, 57, 61, 66}
REFUSE = [i for i in range(50) if i not in GOOD1] + sorted(BAD2)
def res(i, n, made, end, sent):
    bad = n - made
    return {"id": IDS[i], "kind": "voucher", "company": CO, "created": made, "altered": 0, "errors": bad, "exceptions": 0, "ignored": 0, "batchN": n, "batchEnd": end, "lastVchId": end, "sentAt": sent,
            "ok": False, "needsReview": True, "accepted": made > 0, "lineError": ["Voucher Number '901' already exists!"], "vchType": "Receipt", "vchDate": "20260812",
            "message": "Tally's reply: created %d of %d, errors %d: Voucher Number '901' already exists!" % (made, n, bad)}
RESULTS1 = [res(i, 50, 8, "3041", "2026-10-29T10:00:00+05:30") for i in range(50)] + [res(i, 20, 16, "3057", "2026-10-29T10:01:00+05:30") for i in range(50, 70)]

if not text:
    ok(False, "the migration file is there (%s)" % os.path.basename(M132)); print("\n1 FAILED"); raise SystemExit(1)
low = text.lower(); body = re.sub(r"--[^\n]*", "", low)
print("  md5 of the file: %s  (%s)" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M132)))
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(not re.search(r"\b(drop|truncate|alter|delete from)\b", body), "0. add-only: no drop, truncate, alter or delete")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc|project[_ ]ref", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_post_record"], "0. one function: %s" % FNS)
ok("set search_path = public, pg_temp" in text and "revoke all on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) from public, anon;" in text
   and "grant execute on function public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text) to authenticated, service_role;" in text, "0. search_path public, pg_temp; revoked from public, anon; granted to authenticated, service_role")

db = pg_stand.start(int(os.environ.get("PG132_PORT") or 31132))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt, role="authenticated"):
    try: return True, db.one("set role %s; set fincom.role = '%s'; %s" % (role, role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpcj(uid, stmt, role="authenticated"):
    good, out = as_user(uid, stmt, role)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out)
    except (TypeError, ValueError): return {"_error": out}
def record(uid, jid, client, status, results, ids, msg="sent straight to FinCom Bridge 2.4.9 on this computer", role="authenticated"):
    return rpcj(uid, "select tally_post_record(%s::uuid, %s, %s, %s, %s::jsonb, %s::jsonb, %s)::text" % (q(jid), q(client), q(CO), q(status), q(json.dumps(results)), q(json.dumps(ids)), q(msg)), role)
def counts(): return {t: int(db.one("select count(*) from public.%s" % t)) for t in ["tally_post_jobs", "tally_post_ids", "tally_post_register", "tally_post_register_history"]}
def regs(where="true"): return db.rows("select fincom_id, state, coalesce(master_id, '') as master_id, id_inferred::text as inferred, coalesce(tally_words, '') as words, coalesce(job_id::text, '') as job from tally_post_register where firm_id = %s and %s order by fincom_id" % (q(F), where))
fid = lambda s: re.sub(r"[^A-Za-z0-9]", "", s)

try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'PC1', 'h1', '2.4.9', '{}');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BK)s, %(F)s, 'c1', %(CO)s, null, null), (%(BK2)s, %(F2)s, 'c9', %(CO)s, '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Zeta', '{}'), ('c9', %(F2)s, 'Other client', '{}');
      create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, book_id) values (%(F)s, %(CO)s, 'c1', %(D1)s, now(), %(BK)s);""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER),
        "D1": q(D1), "BK": q(BOOK), "BK2": q(BOOK2), "CO": q(CO)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    ok(int(db.one("select count(*) from pg_proc where proname = 'tally_post_register_queued'")) == 1, "setup: built 32 -> 55 -> 111, as staging (no 27)")

    # ---------------------------------------------------------------- 1. RED: staging today
    c0 = counts()
    r = record(OWNER, JOB1, "c1", "failed", RESULTS1, IDS)
    ok("_error" in r and re.search(r"tally_post_record.*does not exist", r["_error"]) is not None, "1. RED: tally_post_record is not there (%s)" % r.get("_error", r)[-120:])
    ok(counts() == c0 and c0["tally_post_jobs"] == 0, "1. RED: the posting leaves nothing in the cloud (%s)" % counts())

    # ---------------------------------------------------------------- 2. 132, twice
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "2. pass %d: migration 132 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        ok(counts() == c0, "2. pass %d: no posting, id or register row added or removed (%s)" % (rnd, counts()))
    for row in db.rows("select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as m from pg_proc p where p.proname = 'tally_post_record'"):
        print("  md5 %s  %s" % (row["m"], row["sig"]))
    ok(db.one("select has_function_privilege('anon', 'public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text)', 'execute')") == "f"
       and db.one("select has_function_privilege('authenticated', 'public.tally_post_record(uuid, text, text, text, jsonb, jsonb, text)', 'execute')") == "t", "2. anon may not call it; authenticated may")

    # ---------------------------------------------------------------- 3. the owner's case, made up
    r = record(OWNER, JOB1, "c1", "failed", RESULTS1, IDS)
    ok(r.get("ok") is True, "3. the posting of 70 lines made straight to the bridge is recorded (%s)" % r)
    jb = db.rows("select status, device_id is null as nodev, payload->>'recorded' as rec, n, done, jsonb_array_length(payload->'vouchers') as nv, created_by::text as by from tally_post_jobs where id = %s" % q(JOB1))[0]
    ok(jb["status"] == "failed" and jb["nodev"] == "t" and jb["rec"] == "true" and jb["n"] == "70" and jb["done"] == "0" and jb["nv"] == "70" and jb["by"] == OWNER,
       "3. one posting: failed, no device (no bridge takes it), recorded, 70 entries, 0 ok, by the member (%s)" % jb)
    ok(int(db.one("select count(*) from tally_post_ids where job_id = %s" % q(JOB1))) == 70, "3. 70 FinCom ids kept for it")
    R = regs()
    ok(len(R) == 70 and all(x["state"] == "needs_review" for x in R), "3. the register: all 70 need review, none in Tally on a guess (%s)" % sorted(set(x["state"] for x in R)))
    ok(all("already exists" in x["words"] for x in R) and all(x["job"] == JOB1 for x in R), "3. with Tally's words and the posting (%s)" % R[0]["words"][:90])

    # ---------------------------------------------------------------- 4. the same id again
    r = record(OWNER, JOB1, "c1", "failed", RESULTS1, IDS, msg="0 of 70 in Tally, read back")
    ok(r.get("updated") is True and int(db.one("select count(*) from tally_post_jobs")) == 1, "4. recorded again with the same id: brought up to date, not a second posting (%s)" % r)

    # ---------------------------------------------------------------- 5. the 46 again (a check found them not in Tally), made whole
    ids2 = [IDS[i] for i in REFUSE]
    res2 = [{"id": x, "kind": "voucher", "company": CO, "created": 46, "altered": 0, "errors": 0, "exceptions": 0, "ignored": 0, "batchN": 46, "batchEnd": "3103", "lastVchId": "3103",
             "sentAt": "2026-10-30T10:00:00+05:30", "ok": True, "byReply": True, "verified": False, "message": ""} for x in ids2]
    r = record(STAFF, JOB2, "c1", "done", res2, ids2)
    ok(r.get("ok") is True, "5. the 46 posted again are recorded, by staff (%s)" % r)
    R2 = {x["fincom_id"]: x for x in regs()}
    ok(all(R2[fid(x)]["state"] == "in_tally" and R2[fid(x)]["job"] == JOB2 for x in ids2), "5. their register rows: in Tally, from the new posting (%s)" % R2[fid(ids2[0])])
    ok(all(R2[fid(IDS[i])]["state"] == "needs_review" for i in sorted(GOOD1)), "5. the 24 others stay for review until settled (%s)" % R2[fid(IDS[0])]["state"])
    r = record(OWNER, JOB3, "c1", "failed", [{"id": "s2-1", "kind": "voucher", "created": 0, "altered": 0, "errors": 1, "exceptions": 0, "batchN": 1, "batchEnd": "", "ok": False, "needsReview": False,
                                              "lineError": ["Ledger 'Zeta Rent' does not exist!"], "message": "Tally's reply: created 0 of 1: Ledger 'Zeta Rent' does not exist!"}], ["s2-1"])
    g = regs("fincom_id = 's21'")
    ok(r.get("ok") is True and g and g[0]["state"] == "refused" and "Zeta Rent" in g[0]["words"], "5. a line Tally refused outright: refused, with its words (%s)" % (g[0] if g else r))

    # ---------------------------------------------------------------- 6. who may
    n0 = counts()
    ok("_error" in record(VIEWER, "13200000-0000-0000-0000-000000000009", "c1", "done", [], ["s9-1"]), "6. a viewer may not record a posting")
    ok("_error" in record(OTHER, "13200000-0000-0000-0000-00000000000a", "c1", "done", [], ["s9-1"]), "6. a member of another firm may not record for this client")
    ok("_error" in record(OWNER, "13200000-0000-0000-0000-00000000000b", "c9", "done", [], ["s9-1"]), "6. nor for another firm's client")
    ok("_error" in record(OWNER, "13200000-0000-0000-0000-00000000000c", "c1", "done", [], ["s9-1"], role="anon"), "6. anon may not")
    ok("_error" in record(OTHER, JOB1, "c9", "done", [], []), "6. another firm cannot bring this firm's posting up to date")
    ok(counts() == n0, "6. nothing was written by those (%s)" % counts())
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
