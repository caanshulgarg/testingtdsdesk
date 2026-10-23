"""python3 run_migration43.py - migration-43-posting-reply (03-Oct-2026, round 15: the cap gap, per-computer posting settings,
Tally's reply ids, the reply states). Staging's order on a throwaway PostgreSQL (pg_stand): 32 -> 33 -> 35 -> 34 (first) ->
36b -> 37 -> 36 -> 38 -> 39 -> 40 -> 41 -> 42, made-up rows, then 43 twice. Checks:
(1) the cap gap in the 8-argument tally_ingest_day (42's text byte for byte but the count): pend counts every PENDING day of
the book however old (a first empty read never confirmed) plus the days an empty read MARKED in the last 24 hours; a read
fault that lists no entries for book B2 (12 days, one entry each) every 25 hours for five nights marks nothing on any night
(the clock: the test moves the recorded empty_at / at back 25 hours between rounds, since the function reads now()), the live
count stays 12; a genuine 3-day emptying (book B3) still marks on the second read; a file with entries clears a pending record;
(2) tally_devices.post_only / post_batch_bills / post_batch_bank / post_settings_at / post_settings_by and the owner's
tally_device_post_settings(device, post_only, bills, bank): owner only, the firm's own un-revoked computer, null leaves a value,
'[]' means any company, 'null' clears the restriction, 1..500 else refused with words, stamped, the four values answered;
(3) tally_post_ids.reply_vch / batch_end / batch_n / matched_at / matched_vch (not `vch`: a column of that name makes 36b's
tally_post_id_accept and tally_post_job_mark_posted ambiguous - asserted: no new column is a local of any migration's function,
and both still work after 43) and tally_post_id_accept_reply(job, id, vch, batch_end, batch_n): accepted_at if null,
accepted_vch / reply_vch when batch_n = 1, batch_end / batch_n always, live stays true, service role only; tally_post_id_accept's
text unchanged; (4) tally_post_result_taken true for byReply + ok and for needsReview + accepted;
tally_post_job_settle: a byReply ok result is posted, needsReview results need review ('Posted N of M; K need review', done
without checking), all failed stays failed; tally_post_job_accepted: needsReview + accepted is accepted-not-confirmed (the
resend guard holds); the sync keeps a needsReview + accepted id and a byReply ok id live when the posting ends done or failed;
(5) tally_post_jobs.timing; security definer; the file runs twice and a third time over used tables.
RED (before 43): run with SKIP43=1: the second night marks the 10 pending days (42's cap looks back 24 hours only) and the
settings, reply and state checks fail."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql")]
M43 = os.environ.get("M43_FILE") or os.path.join(SQLDIR, "migration-43-posting-reply.sql")
SKIP43 = os.environ.get("SKIP43") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA_X = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333"
B2, B3 = "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
D1, D3, DREV = "d1000000-0000-0000-0000-000000000001", "d3000000-0000-0000-0000-000000000003", "d4000000-0000-0000-0000-000000000004"
J = lambda n: "%08d-0000-0000-0000-000000000000" % n
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]]
def V(guid, alter): return {"guid": guid, "alter": alter, "type": "Sales", "no": guid.upper(), "party": "", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": ""}
L = lambda guid, ledger, amount: [guid, ledger, amount, "", None, []]
empty8 = lambda d, b: "select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(b), q(d))
# the made-up books: one entry a day (as run_migration42's cap check)
def oneday(b, d, i, alter=5): return "select tally_ingest_day(%s, %s, %s, %s, 1, %d, 100)::text" % (q(b), q(d), js([dict(V("c%02d" % i, 1), no="C%02d" % i)]), js([L("c%02d" % i, "Sales", 10), L("c%02d" % i, "Cash", -10)]), alter)
DAYS12 = ["2026-06-%02d" % d for d in range(1, 13)]
DAYS3 = ["2026-07-%02d" % d for d in range(1, 4)]
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
def job(jid, vs, status="running", firm=F):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(firm), q(json.dumps({"vouchers": vs})), len(vs), q(status))
db = pg_stand.start(55450)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    """runs stmt as a signed-in person (role authenticated, auth.uid() = uid); returns (ok, output or error)"""
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
j = lambda s: json.loads(db.one(s))
tday = lambda d, b: (db.rows("select n, empty_at, note from tally_days where book_id = %s and day = %s" % (q(b), q(d))) or [{}])[0]
liveb = lambda b: int(db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(b)))
pending = lambda b: int(db.one("select count(*) from tally_days where book_id = %s and empty_at is not null and note like 'empty day with%%'" % q(b)))
night = lambda b: db.sql("update tally_days set empty_at = empty_at - interval '25 hours', at = at - interval '25 hours' where book_id = %s" % q(b))   # the clock: 25 hours pass
idrow = lambda jid, fid: (db.rows("select live, accepted_at, accepted_vch, reply_vch, batch_end, batch_n, matched_at, matched_vch, released_at from tally_post_ids where job_id = %s and fincom_id = %s" % (q(jid), q(fid))) or [{}])[0]
dev = lambda d: (db.rows("select post_only::text as post_only, post_batch_bills, post_batch_bank, post_settings_at, post_settings_by from tally_devices where id = %s" % q(d)) or [{}])[0]
settings = lambda uid, d, po, bills, bank: as_user(uid, "select tally_device_post_settings(%s::uuid, %s, %s, %s)::text" % (q(d), "null" if po is None else q(po) + "::jsonb", "null" if bills is None else bills, "null" if bank is None else bank))
fdef = lambda sig: db.one("select pg_get_functiondef(%s::regprocedure)" % q("public." + sig)) or ""
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(T)s, %(F2)s, 'Them', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B2)s, %(F)s, 'c2', 'ZZ CAP', '2026-04-01', '2026-03-31'), (%(B3)s, %(F)s, 'c3', 'ZZ THREE', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.8'), (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.1.8');
      insert into tally_devices (id, firm_id, name, key_hash, revoked) values (%(DREV)s, %(F)s, 'OLD-PC', 'h4', true);
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c2', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "T": q(OTHER), "B2": q(B2), "B3": q(B3), "D1": q(D1), "D3": q(D3), "DREV": q(DREV)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    accept_before = fdef("tally_post_id_accept(uuid, text, text, timestamptz)")
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_days", "tally_post_ids", "tally_post_jobs", "tally_ledgers", "tally_devices"]}
    for b in (B2, B3): j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(b), js(LEDGERS), js(GROUPS)))
    for i, d in enumerate(DAYS12): j(oneday(B2, d, i))
    for i, d in enumerate(DAYS3): j(oneday(B3, d, i))
    db.sql(job(J(1), [vch("A1"), vch("A2")]))
    before = counts()
    if SKIP43: print("  (SKIP43: migration-43 not applied; 42's rules are tested, the checks below are expected to FAIL)")
    else:
        for i in (1, 2):
            r = psql_file(M43); ok(r.returncode == 0, "migration-43 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on without the migration")
        ok(counts() == before, "nothing deleted by the migration")
        body = open(M43).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
        code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(touched\);", "", code)
        ok(code2.count("delete from") == 0 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"),
           "the file drops and deletes nothing (37's cache / re-send deletes inside tally_ingest_day aside); one transaction")
        ok(all(m.group(0).startswith("alter table") and "add column if not exists" in m.group(0) for m in re.finditer(r"alter table[^;]*;", code)), "every alter table adds a column if missing, nothing else")
        ok("supersedes 42" in body and "however old" in body and "24 hours" in body and "post_only" in body and "accept_reply" in body and "needsreview" in body and "byreply" in body,
           "the header says it supersedes 42's 8-argument tally_ingest_day, the pending days count however old, and names the settings, the reply stamp and the reply states")
    # ---- (1) the cap gap: a read fault every 25 hours for five nights marks nothing
    ok(liveb(B2) == 12 and pending(B2) == 0, "(book B2: 12 days with one entry each, none pending)")
    rounds = []
    for n in range(1, 6):
        rs = [j(empty8(d, B2)) for d in DAYS12]
        rounds.append((sum(1 for x in rs if x.get("emptyPending")), sum(1 for x in rs if x.get("emptyCapped")), sum(x.get("marked", 0) for x in rs), liveb(B2)))
        night(B2)
    ok(rounds[0] == (10, 2, 0, 12), "1. night 1: 10 recorded pending, 2 refused by the cap, nothing marked, 12 live (%s)" % (rounds[0],))
    ok(all(r == (0, 12, 0, 12) for r in rounds[1:]), "1. nights 2-5 (25 hours apart): every day refused by the cap (the 10 pending days count however old), nothing marked, 12 live (%s)" % rounds[1:])
    ok(liveb(B2) == 12 and pending(B2) == 10, "1. after five nights the live count is unchanged, 10 days still pending (%d live, %d pending)" % (liveb(B2), pending(B2)))
    r = j(empty8(DAYS12[0], B2))
    ok(r.get("emptyCapped") is True and "read empty within 24 hours" in r.get("refused", "") and "10 days" in r.get("refused", ""), "1. the words of a capped read name the 10 days (%s)" % r.get("refused", "")[:70])
    # ---- a genuine 3-day emptying still marks on the second read
    ok(liveb(B3) == 3, "(book B3: 3 days with one entry each)")
    r1 = [j(empty8(d, B3)) for d in DAYS3]
    ok(all(x.get("emptyPending") for x in r1) and liveb(B3) == 3, "2. the first empty round over 3 days: all pending, nothing marked")
    night(B3)
    r2 = [j(empty8(d, B3)) for d in DAYS3]
    ok(all(x.get("empty") is True and x.get("marked") == 1 for x in r2) and liveb(B3) == 0, "2. the second round a day later marks the 3 (a genuine emptying is under the cap) (%s)" % [x.get("marked") for x in r2])
    ok(tday(DAYS3[0], B3)["note"].startswith("1 entries marked deleted on the second empty read"), "2. recorded as marked (%s)" % tday(DAYS3[0], B3)["note"][:50])
    # ---- a file with entries clears a pending record
    r = j(oneday(B2, DAYS12[0], 0, alter=6)); t = tday(DAYS12[0], B2)
    ok("refused" not in r and t["empty_at"] == "" and t["note"] == "" and pending(B2) == 9 and liveb(B2) == 12, "3. a file with entries for a pending day: the record cleared, 9 pending now (%s)" % t)
    r = j(empty8(DAYS12[0], B2))
    ok(r.get("emptyPending") is True and pending(B2) == 10 and liveb(B2) == 12, "3. its next empty read is a first one again (under the cap: 9 pending), recorded, nothing marked")
    # ---- (2) per-computer posting settings
    cols = {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name = 'tally_devices'")}
    ok({"post_only", "post_batch_bills", "post_batch_bank", "post_settings_at", "post_settings_by"} <= cols, "S. tally_devices: post_only, post_batch_bills, post_batch_bank, post_settings_at, post_settings_by (%s)" % sorted(c for c in cols if c.startswith("post_")))
    good, out = settings(OWNER, D1, '["ZZ CO", " Other Co ", ""]', 50, 20); r = json.loads(out) if good else {}
    ok(good and r.get("ok") is True and r.get("postOnly") == ["ZZ CO", "Other Co"] and r.get("postBatchBills") == 50 and r.get("postBatchBank") == 20 and r.get("at"), "S1. the owner sets post_only, bills 50, bank 20: the four values answered, names trimmed, blanks dropped (%s)" % (r or out[-120:]))
    d = dev(D1)
    ok(json.loads(d["post_only"] or "null") == ["ZZ CO", "Other Co"] and d["post_batch_bills"] == "50" and d["post_batch_bank"] == "20" and d["post_settings_at"] and d["post_settings_by"] == OWNER, "S1. stored and stamped by the owner (%s)" % d)
    at1 = d["post_settings_at"]
    good, out = settings(OWNER, D1, None, None, 30); r = json.loads(out) if good else {}
    ok(good and r.get("postOnly") == ["ZZ CO", "Other Co"] and r.get("postBatchBills") == 50 and r.get("postBatchBank") == 30 and dev(D1)["post_settings_at"] >= at1, "S2. null leaves a value as it is: only bank changed to 30 (%s)" % (r or out[-100:]))
    good, out = settings(OWNER, D1, '[]', None, None); r = json.loads(out) if good else {}
    ok(good and r.get("postOnly") == [] and dev(D1)["post_only"] == "[]", "S3. '[]' means any company, stored as [] (%s)" % (r.get("postOnly") if good else out[-80:]))
    good, out = settings(OWNER, D1, 'null', None, None); r = json.loads(out) if good else {}
    ok(good and r.get("postOnly") is None and dev(D1)["post_only"] == "", "S4. 'null' clears to no restriction (%s)" % (r if good else out[-80:]))
    for bad in (0, 501, -1):
        good, out = settings(OWNER, D1, None, bad, None); ok(not good and "between 1 and 500" in out, "S5. bills %d refused with words (%s)" % (bad, out[-80:]))
    good, out = settings(OWNER, D1, None, None, 1000); ok(not good and "between 1 and 500" in out, "S5. bank 1000 refused (%s)" % out[-80:])
    good, out = settings(OWNER, D1, None, 1, 500); ok(good and json.loads(out).get("postBatchBills") == 1 and json.loads(out).get("postBatchBank") == 500, "S5. 1 and 500 are allowed")
    good, out = settings(OWNER, D1, '"ZZ CO"', None, None); ok(not good and "list" in out.lower(), "S6. post_only that is not a list is refused with words (%s)" % out[-80:])
    good, out = settings(OWNER, D1, '[1, 2]', None, None); ok(not good and "list" in out.lower(), "S6. a list of numbers is refused (%s)" % out[-80:])
    good, out = settings(STAFF, D1, '[]', None, None); ok(not good and ("42501" in out or "only an owner" in out), "S7. a staff member is refused (%s)" % out[-80:])
    good, out = settings(OTHER, D1, '[]', None, None); ok(not good and "not a computer of your firm" in out, "S7. another firm's owner is refused (%s)" % out[-80:])
    good, out = settings(OWNER, DREV, '[]', None, None); ok(not good and "not a computer of your firm" in out, "S7. a revoked computer is refused (%s)" % out[-80:])
    ok(db.one("select has_function_privilege('authenticated', 'tally_device_post_settings(uuid, jsonb, integer, integer)', 'execute')") == "t", "S8. granted to signed-in people (the owner check is inside)")
    ok(db.one("select has_column_privilege('authenticated', 'tally_devices', 'post_only', 'select')") == "t" and db.one("select has_column_privilege('authenticated', 'tally_devices', 'post_settings_at', 'select')") == "t", "S8. the firm reads the four columns (as migration 22's main_*)")
    # ---- (3) the reply stamp
    cols = {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name = 'tally_post_ids'")}
    ok({"reply_vch", "batch_end", "batch_n", "matched_at", "matched_vch"} <= cols and "vch" not in cols, "R. tally_post_ids: reply_vch, batch_end, batch_n, matched_at, matched_vch (and no column `vch`)")
    # no new column may be a local of an existing PL/pgSQL function that updates the table (a column `vch` broke 36b's tally_post_id_accept here)
    new_cols = {"reply_vch", "batch_end", "batch_n", "matched_at", "matched_vch", "timing", "post_only", "post_batch_bills", "post_batch_bank", "post_settings_at", "post_settings_by"}
    locals_ = set()
    for f in os.listdir(SQLDIR):
        if f.endswith(".sql"):
            for m in re.finditer(r"(?is)\bdeclare\b(.*?)\bbegin\b", open(os.path.join(SQLDIR, f)).read()): locals_ |= set(re.findall(r"(?m)(?:^|;|declare)\s*(\w+)\s+(?:text|int|integer|bigint|jsonb|timestamptz|boolean|uuid|numeric|date)\b", m.group(1)))
    ok(not (new_cols & locals_), "R. no new column is named like a local of any migration's function (%s)" % sorted(new_cols & locals_))
    ok("timing" in {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name = 'tally_post_jobs'")}, "R. tally_post_jobs.timing (jsonb)")
    acc = j("select tally_post_id_accept_reply(%s::uuid, 'A1', '26298', '26298', 1)::text" % q(J(1))); x = idrow(J(1), "A1")
    ok(acc.get("ok") is True and acc.get("stamped") == 1 and x["accepted_at"] and x["accepted_vch"] == "26298" and x["reply_vch"] == "26298" and x["batch_end"] == "26298" and x["batch_n"] == "1" and x["live"] == "t",
       "R1. a one-voucher request: accepted_at, accepted_vch and reply_vch 26298, batch_end 26298, batch_n 1, live (%s)" % x)
    at_a1 = x["accepted_at"]
    acc = j("select tally_post_id_accept_reply(%s::uuid, 'A2', null, '26305', 3)::text" % q(J(1))); x = idrow(J(1), "A2")
    ok(acc.get("stamped") == 1 and x["accepted_at"] and x["accepted_vch"] == "" and x["reply_vch"] == "" and x["batch_end"] == "26305" and x["batch_n"] == "3" and x["live"] == "t",
       "R2. a batch of 3: accepted_at, no voucher of its own, batch_end 26305, batch_n 3, live (%s)" % x)
    acc = j("select tally_post_id_accept_reply(%s::uuid, 'A1', '26299', '26299', 1)::text" % q(J(1))); x = idrow(J(1), "A1")
    ok(acc.get("stamped") == 1 and x["accepted_at"] == at_a1 and x["batch_end"] == "26299", "R3. a second report: accepted_at kept (the first), batch_end follows the report (%s)" % x["accepted_at"])
    ok(x["matched_at"] == "" and x["matched_vch"] == "", "R4. matched_at / matched_vch are for the later comparison: nothing writes them yet")
    good, out = as_user(STAFF, "select tally_post_id_accept_reply(%s::uuid, 'A1', '1', '1', 1)::text" % q(J(1)))
    ok(not good and ("42501" in out or "service role" in out or "permission denied" in out), "R5. tally_post_id_accept_reply is the service role's (%s)" % out[-80:])
    ok(db.one("select has_function_privilege('authenticated', 'tally_post_id_accept_reply(uuid, text, text, text, integer)', 'execute')") == "f", "R5. not granted to signed-in people")
    ok(j("select tally_post_id_accept_reply(%s::uuid, 'ZZ9', '1', '1', 1)::text" % q(J(1))).get("stamped") == 0, "R6. an id not of the posting: stamped 0 (tally-ingest logs it)")
    ok(fdef("tally_post_id_accept(uuid, text, text, timestamptz)") == accept_before, "R7. the old tally_post_id_accept is unchanged")
    db.sql(job(J(2), [vch("C1"), vch("C2")]))
    ok(j("select tally_post_id_accept(%s::uuid, 'C1', '26330')::text" % q(J(2))).get("stamped") == 1 and idrow(J(2), "C1")["accepted_vch"] == "26330", "R8. 36b's tally_post_id_accept still works after 43 (no ambiguous column)")
    good, out = as_user(OWNER, "select tally_post_job_mark_posted(%s::uuid, 'C2', '26331', 'seen')::text" % q(J(2)))
    ok(good and json.loads(out).get("ok") is True and idrow(J(2), "C2")["accepted_vch"] == "26331", "R8. 36b's tally_post_job_mark_posted still works after 43 (%s)" % (out[-80:] if not good else "ok"))
    # ---- (4) the reply states
    taken = lambda o: db.one("select tally_post_result_taken(%s)" % js(o))
    ok(taken({"byReply": True, "ok": True}) == "t" and taken({"needsReview": True, "accepted": True}) == "t", "T1. taken: byReply + ok, needsReview + accepted")
    ok(taken({"byReply": True, "ok": False}) == "f" and taken({"needsReview": True}) == "f" and taken({"needsReview": True, "accepted": False, "created": 0}) == "f" and taken({"ok": True}) == "f" and taken({"verified": True}) == "t",
       "T1. not taken: byReply refused, needsReview without accepted, a plain ok; verified as before")
    ok(db.one("select tally_post_result_confirmed(%s)" % js({"byReply": True, "ok": True})) == "t", "T1. the old name (the wrapper) answers the same")
    settle = lambda st, chk, vs, res, its: j("select tally_post_job_settle(%s, %s, %s, %s, %s)::text" % (q(st), "true" if chk else "false", js({"vouchers": [vch(v) for v in vs]}), js(res), js(its)))
    o = settle("running", False, ["R1", "R2", "R3"], [{"id": "R1", "ok": True, "byReply": True, "vchId": "26400"}, {"id": "R2", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "26401"}, {"id": "R3", "ok": False, "needsReview": True, "created": 0}],
               [{"id": "R1", "state": "sent"}, {"id": "R2", "state": "unknown"}, {"id": "R3", "state": "failed"}])
    ok(o.get("status") == "done" and o.get("checking") is False and o.get("posted") == 1 and o.get("review") == 2 and o.get("message") == "Posted 1 of 3; 2 need review", "T2. settle: one byReply ok, two needing review: done without checking, 'Posted 1 of 3; 2 need review' (%s)" % o)
    o = settle("running", False, ["R1", "R2"], [{"id": "R1", "ok": True, "byReply": True}, {"id": "R2", "ok": True, "byReply": True}], [])
    ok(o.get("status") == "done" and o.get("posted") == 2 and o.get("review") == 0 and o.get("message") == "Posted 2 of 2", "T2. all byReply ok: done, 'Posted 2 of 2' (%s)" % o)
    o = settle("running", False, ["R1", "R2"], [{"id": "R1", "ok": False, "message": "refused"}, {"id": "R2", "ok": False, "message": "refused"}], [{"id": "R1", "state": "failed"}, {"id": "R2", "state": "failed"}])
    ok(o.get("status") == "failed" and o.get("checking") is False and o.get("message") == "Posted 0 of 2", "T2. everything failed: failed as today (%s)" % o)
    o = settle("running", False, ["R1", "R2"], [{"id": "R1", "ok": False, "needsReview": True}], [{"id": "R1", "state": "failed"}, {"id": "R2", "state": "sending"}])
    ok(o.get("status") == "running" and o.get("review") == 1, "T2. one needing review, one still on its way: left to the bridge (%s)" % o)
    o = settle("running", False, ["R1", "R2"], [{"id": "R1", "ok": False, "needsReview": True}, {"id": "R2", "ok": False, "message": "refused"}], [{"id": "R1", "state": "failed"}, {"id": "R2", "state": "failed"}])
    ok(o.get("status") == "done" and o.get("checking") is False and o.get("message") == "Posted 0 of 2; 1 need review", "T2. one needing review, one refused: needs review (done, no checking), not failed (%s)" % o)
    o = settle("failed", False, ["R1"], [{"id": "R1", "ok": False, "needsReview": True}], [])
    ok(o.get("status") == "failed", "T2. a finished posting keeps its status (%s)" % o.get("status"))
    # job_accepted and the sync
    db.sql(job(J(5), [vch("N1"), vch("N2"), vch("N3")]))
    res5 = [{"id": "N1", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "26410", "state": "unknown"}, {"id": "N2", "ok": True, "byReply": True, "vchId": "26411", "batchN": 1}, {"id": "N3", "ok": False, "needsReview": True, "created": 0}]
    its5 = [{"id": "N1", "state": "unknown"}, {"id": "N2", "state": "sent"}, {"id": "N3", "state": "failed", "reason": "needs review: nothing created"}]
    ok(db.one("select tally_post_job_accepted(%s::uuid, %s, %s)" % (q(J(5)), js(res5), js(its5))) == "N1", "T3. tally_post_job_accepted: needsReview + accepted is accepted-not-confirmed; byReply ok is confirmed; needsReview without accepted is nothing (%s)" % db.one("select tally_post_job_accepted(%s::uuid, %s, %s)" % (q(J(5)), js(res5), js(its5))))
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s; update tally_post_jobs set status = 'done' where id = %s" % (js(res5), js(its5), q(J(5)), q(J(5))))
    liv = {x["fincom_id"]: x["live"] for x in db.rows("select fincom_id, live from tally_post_ids where job_id = %s" % q(J(5)))}
    ok(liv == {"N1": "t", "N2": "t", "N3": "t"}, "T4. the sync on 'done': every id live (%s)" % liv)
    db.sql(job(J(6), [vch("M1"), vch("M2"), vch("M3")]))
    res6 = [{"id": "M1", "ok": True, "byReply": True, "vchId": "26420", "batchN": 1}, {"id": "M2", "ok": False, "needsReview": True, "accepted": True, "lastVchId": "26421"}, {"id": "M3", "ok": False, "needsReview": True, "created": 0}]
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s; update tally_post_jobs set status = 'failed' where id = %s" % (js(res6), js([{"id": "M3", "state": "failed"}]), q(J(6)), q(J(6))))
    liv = {x["fincom_id"]: x["live"] for x in db.rows("select fincom_id, live from tally_post_ids where job_id = %s" % q(J(6)))}
    ok(liv == {"M1": "t", "M2": "t", "M3": "f"}, "T4. the sync on 'failed' (no stamp): the byReply ok id and the needsReview + accepted id stay live, the needsReview-without-accepted id is freed (%s)" % liv)
    try: db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(5))); out = ""
    except RuntimeError as e: out = str(e)
    ok("N1" in out and "not sent to Tally again" in out and db.one("select status from tally_post_jobs where id = %s" % q(J(5))) == "done", "T5. the resend guard holds a posting with a needsReview + accepted entry (%s)" % out[-80:])
    # ---- security definer, the texts
    for fn, args in [("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean"), ("tally_device_post_settings", "uuid, jsonb, integer, integer"), ("tally_post_id_accept_reply", "uuid, text, text, text, integer"), ("tally_post_job_accepted", "uuid, jsonb, jsonb")]:
        d = fdef("%s(%s)" % (fn, args))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s(%s): security definer, search_path public, pg_temp" % (fn, args[-30:]))
    d8 = fdef("tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)")
    ok("live entries: confirm by a second empty read" in d8 and "not emptied then tally_days.n" in d8 and "read empty within 24 hours" in d8 and "empty day with%" in d8, "the 8-argument tally_ingest_day is 42's text with the new count")
    ok("null::boolean" in fdef("tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer)"), "the 7-argument wrapper (41's) is untouched")
    if not SKIP43:
        k = counts(); r = psql_file(M43); ok(r.returncode == 0 and counts() == k, "migration-43 runs a third time over used tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
