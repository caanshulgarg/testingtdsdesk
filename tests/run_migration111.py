"""python3 run_migration111.py - migration-111-post-register (the cloud posting register, build stabilisation step 3, approved by
the owner on 26-Oct-2026). On throwaway PostgreSQL (pg_stand, port 31110; never a real database), built 32 -> ... -> 54 -> 55 in
staging's order (as run_migration55.py), postings of every kind made BEFORE 111, then 111 (twice).
Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', add-only (no drop, no truncate),
     no real database named, explicit grants; every function security definer or plain sql with search_path public, pg_temp.
  1. the backfill: every posting already here gets ONE record per FinCom id in the state it means today (Tally's reply, the
     owner's mark, the recorder's match, a cancel, the queue); a history row 'backfill'.
  2. a partial batch (Tally created 2 of 3, EXCEPTIONS 1, LINEERROR) -> needs_review for all three, never in_tally; a clean batch
     -> in_tally with ids inferred from LASTVCHID (marked inferred); one voucher, CREATED 1, LASTVCHID -> in_tally exact;
     nothing created and a LINEERROR -> refused with Tally's words.
  3. a recorder line with the TDSDesk tag (payload fid) settles a needs_review line (its MasterID); 4. a Day Book entry
     (tally_vouchers.fincom_id) settles another; 5. the bridge's hook tally_post_register_confirm settles an inferred one.
  6. the duplicate guard: a FinCom id queued / in_tally / needs_review cannot be queued in another posting (tally_post_enqueue
     refused, nothing inserted); a refused one is queued again (the same record, its history); a person's Retry of a
     posting with an entry needing review is refused; the cron's requeue is not.
  7. the owner actions: Mark posted (tally_post_register_mark_posted -> 55's mark: in_tally, by that member); Not in Tally
     (tally_post_register_release -> the bridge looks first; after its "not seen" and a member's confirm: released, then
     queued again for that entry alone); a viewer is refused.
  8. running the file twice changes nothing; no row of the register or its history can be removed; the history cannot change.
  9. RLS: a member of another firm reads none of these rows; nobody signed in writes them.
Prints md5 of the file and of every function it creates.
  --staging-sql   prints the read-only SELECT that mirrors the backfill (the judge's very text), for the counts on staging."""
import os, re, sys, json, subprocess, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M111 = os.environ.get("M111_FILE") or os.path.join(SQLDIR, "migration-111-post-register.sql")
text = open(M111).read() if os.path.exists(M111) else ""

def staging_sql():
    body = text[text.index("$judge$") + len("$judge$"):]
    body = body[:body.index("$judge$")].strip()
    return ("-- read-only: the backfill of migration 111 as counts per state (the judge's text of the file, inlined)\n"
            "with picked as (\n  select distinct on (j.firm_id, x.fid) x.st as state\n    from tally_post_jobs j\n    cross join lateral (\n" + body + "\n    ) x\n"
            "   order by j.firm_id, x.fid, (exists (select 1 from tally_post_ids p where p.job_id = j.id and p.fincom_id = x.fid and p.live)) desc, j.created_at desc, j.id desc)\n"
            "select state, count(*) as n from picked group by state order by state;")
if "--staging-sql" in sys.argv:
    print(staging_sql()); raise SystemExit(0)

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
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEWER, OTHER = "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777", "44444444-4444-4444-4444-444444444444"
D1, D9 = "d1000000-0000-0000-0000-000000000001", "d9000000-0000-0000-0000-000000000009"
B1 = "go-aaaa000001"
BOOK, BOOK2 = "b0000000-0000-0000-0000-000000000111", "b0000000-0000-0000-0000-000000000222"
J = lambda n: "%08d-0000-0000-0000-000000000111" % n
def vch(i, typ="Purchase", amt="1180.00", date="20260705", no=None):
    return {"id": i, "xml": "<VOUCHER VCHTYPE=\"%s\"><DATE>%s</DATE><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><NARRATION>TDSDesk:%s | Bill</NARRATION>"
                       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Party</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Exp</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>"
                       % (typ, date, typ, no or ("N-" + i), i, amt, amt)}
def reply(i, n, created, end, sent="2026-10-26T10:00:00+05:30", exc=0, errs=0, line=None, altered=0, vid=None):
    clean = created == n and not exc and not errs and not line and not altered
    r = {"id": i, "kind": "voucher", "company": "ZZ CO", "created": created, "altered": altered, "errors": errs, "exceptions": exc, "ignored": 0, "batchN": n, "batchEnd": end, "lastVchId": end, "sentAt": sent,
         "byReply": clean, "needsReview": not clean, "ok": clean, "verified": False if clean else None, "message": "" if clean else "Tally's reply: created %d of %d, exceptions %d%s" % (created, n, exc, (": " + line) if line else "")}
    if clean and n == 1: r["vchId"] = end
    if not clean: r["accepted"] = created + altered > 0; r["lineError"] = [line] if line else []
    return r

if not text:
    ok(False, "the migration file is there (%s)" % os.path.basename(M111)); print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
print("  md5 of the file: %s  (%s)" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M111)))
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file: %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|project[_ ]ref", low), "0. names no real database")
ok(all(("grant select on public.%s to authenticated" % t) in text and ("revoke all on public.%s from public, anon, authenticated" % t) in text for t in ("tally_post_register", "tally_post_register_history")), "0. explicit grants on both tables")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(all(re.search(r"function public\.%s\([^)]*\)[^$]*set search_path = public, pg_temp" % f, text, re.S) for f in FNS), "0. every function: search_path public, pg_temp (%d functions)" % len(FNS))
ok(all(("on function public.%s(" % f) in text for f in FNS), "0. every function revoked / granted explicitly")
ok(staging_sql().count("tally_post_register") == 0, "0. the staging mirror reads only tables that are there today (no 111 object)")

db = pg_stand.start(31110)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def as_user(uid, stmt, role="authenticated"):
    try: return True, db.one("set role %s; set fincom.role = '%s'; %s" % (role, role, stmt), uid)
    except RuntimeError as e: return False, str(e)
def rpcj(uid, stmt):
    good, out = as_user(uid, stmt)
    if not good: return {"_error": out[-400:]}
    try: return json.loads(out)
    except (TypeError, ValueError): return {"_error": out}
def svc(stmt):
    try: return json.loads(db.one(stmt))
    except RuntimeError as e: return {"_error": str(e)[-400:]}
def reg(fid, firm=F):
    r = db.rows("select state, source, coalesce(master_id, '') as master_id, id_inferred::text as inferred, coalesce(tally_words, '') as words, coalesce(job_id::text, '') as job, coalesce(changed_by::text, '') as by,"
                " coalesce(vch_type, '') as vch_type, coalesce(vch_no, '') as vch_no, coalesce(vch_date::text, '') as vch_date, coalesce(amount::text, '') as amount, coalesce(kind, '') as kind,"
                " coalesce(book_id::text, '') as book from tally_post_register where firm_id = %s and fincom_id = %s" % (q(firm), q(fid)))
    return r[0] if r else {}
def hist(fid): return db.rows("select h.from_state, h.to_state, h.source, coalesce(h.note, '') as note, coalesce(h.by_user::text, '') as by from tally_post_register_history h where h.fincom_id = %s order by h.id" % q(fid))
def counts(): return {t: int(db.one("select case when to_regclass('public.%s') is null then 0 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.%s', false, true, '')))[1]::text::int end" % (t, t))) for t in ["tally_post_jobs", "tally_post_ids", "tally_post_marks", "tally_post_register", "tally_post_register_history"]}
def job(n, ids, status="waiting", results=None, items=None, taken=True, device=D1, firm=F, client="c1", vouchers=None):
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, status, results, items, taken_at, created_by) values (%s, %s, %s, 'ZZ CO', %s, %s, %d, %s, %s, %s, %s, %s)"
           % (q(J(n)), q(firm), q(client), "null" if device is None else q(device), q(json.dumps({"vouchers": vouchers or [vch(i) for i in ids]})), len(ids), q(status),
              "null" if results is None else q(json.dumps(results)), "null" if items is None else q(json.dumps(items)), "now()" if taken and status != "waiting" else "null", q(OWNER)))
def update(n, status=None, results=None):
    sets = ["updated_at = now()"]
    if status: sets.append("status = %s" % q(status))
    if results is not None: sets.append("results = %s" % q(json.dumps(results)))
    db.sql("update tally_post_jobs set %s where id = %s" % (", ".join(sets), q(J(n))))
def apply(n): return svc("select tally_post_register_apply(%s::uuid)::text" % q(J(n)))

try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Ravi', 'staff', true), (%(V)s, %(F)s, 'Vina', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'NW144 · anshul', 'h1', '2.4.7', %(I1)s), (%(D9)s, %(F2)s, 'OTHER', 'h9', '2.4.7', '{}');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BK)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(BK2)s, %(F2)s, 'c9', 'ZZ CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"postTo": "ZZ CO"}'), ('c9', %(F2)s, 'ZZ9', '{"postTo": "ZZ CO"}');""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER),
        "D1": q(D1), "D9": q(D9), "I1": q(json.dumps({"bridges": {B1: {"at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "computer": "NW144", "user": "anshul", "mode": "main", "open": ["ZZ CO"]}}})), "BK": q(BOOK), "BK2": q(BOOK2)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("update tally_devices set main_bridge = %s, last_seen = now(), created_by = %s where id = %s" % (q(B1), q(OWNER), q(D1)))
    db.one("select tally_bridge_bind(%s::uuid, %s)::text" % (q(D1), q(B1)))
    ok(rpcj(OWNER, "select tally_member_bridge_link(%s::uuid, %s::uuid, %s)::text" % (q(OWNER), q(D1), q(B1))).get("ok") is True, "setup: the owner posts through bridge %s" % B1)
    db.sql("""create table if not exists tally_companies (firm_id uuid, company text, client_id text, device_id uuid, last_seen timestamptz, book_id uuid, gstin text, linked_at timestamptz);
      insert into tally_companies (firm_id, company, client_id, device_id, last_seen, book_id) values (%s, 'ZZ CO', 'c1', %s, now(), %s), (%s, 'ZZ CO', 'c9', %s, now(), %s);"""
           % (q(F), q(D1), q(BOOK), q(F2), q(D9), q(BOOK2)))

    # ---------------------------------------------------------------- what is there BEFORE 111 (the current meanings)
    job(1, ["A1"], "done", [reply("A1", 1, 1, "501")])                                                       # one voucher, CREATED 1, LASTVCHID 501
    job(2, ["B1", "B2", "B3"], "done", [reply(i, 3, 3, "610") for i in ("B1", "B2", "B3")])                  # a batch taken whole
    job(3, ["C1", "C2", "C3"], "done", [reply(i, 3, 2, "706", exc=1, line="Ledger 'P72 Missing Ledger' does not exist!") for i in ("C1", "C2", "C3")])   # partial batch
    job(4, ["D1x"], "failed", [reply("D1x", 1, 0, "", exc=1, line="Ledger 'Rent' does not exist!")])         # Tally refused it
    job(5, ["E1"], "cancelled", taken=False)                                                                # cancelled before taken
    job(6, ["F1"], "waiting", taken=False)                                                                  # waiting
    job(7, ["G1"], "running")                                                                               # with the bridge
    job(8, ["H1"], "done", [{"id": "H1", "ok": False, "outcomeUnknown": True, "sent": True, "state": "unknown", "message": "Sent to Tally, but no answer came"}])   # no answer
    job(9, ["K1"], "done", [{"id": "K1", "ok": False, "accepted": True, "outcomeUnknown": True, "lastVchId": "26298", "message": "Tally replied 'created' (voucher id 26298)"}])
    db.one("select tally_post_id_accept(%s::uuid, 'K1', '26298')::text" % q(J(9)))
    r = rpcj(STAFF, "select tally_post_job_mark_posted(%s::uuid, 'K1', '26298', 'seen in the Day Book')::text" % q(J(9)))
    ok(r.get("ok") is True, "setup: K1 marked posted by staff before 111 (%s)" % r)
    job(10, ["L1"], "done", [reply("L1", 2, 1, "800", exc=1, line="x")] )
    db.sql("update tally_post_ids set matched_at = now(), matched_mid = '799', matched_vch = 'N-L1' where job_id = %s" % q(J(10)))           # the recorder matched it (45)
    EXPECT = {"A1": ("in_tally", "501", "false"), "B1": ("in_tally", "608", "true"), "B2": ("in_tally", "609", "true"), "B3": ("in_tally", "610", "true"),
              "C1": ("needs_review", "", "false"), "C2": ("needs_review", "", "false"), "C3": ("needs_review", "", "false"), "D1x": ("refused", "", "false"),
              "E1": ("released", "", "false"), "F1": ("queued", "", "false"), "G1": ("sent", "", "false"), "H1": ("needs_review", "", "false"), "K1": ("in_tally", "26298", "false"), "L1": ("in_tally", "799", "false")}
    before = counts()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "8. pass %d: migration 111 runs %s" % (rnd, (r.stderr or "").strip()[-600:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        c = counts()
        if rnd == 1: after1 = c
        ok(all(c[t] == before[t] for t in ("tally_post_jobs", "tally_post_ids", "tally_post_marks")), "8. pass %d: no posting, id or mark added or removed (%s)" % (rnd, c))
        if rnd == 2: ok(c == after1, "8. pass 2 adds nothing to the register or its history (%s / %s)" % (after1, c))
    md5s = {}
    for f in FNS:
        for row in db.rows("select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as m from pg_proc p where p.proname = %s and p.pronamespace = 'public'::regnamespace order by 1" % q(f)):
            md5s[row["sig"]] = row["m"]
    for k in sorted(md5s): print("  md5 %s  %s" % (md5s[k], k))

    # ---------------------------------------------------------------- 1. the backfill
    ok(after1["tally_post_register"] == len(EXPECT), "1. one record per FinCom id: %d (%d expected)" % (after1["tally_post_register"], len(EXPECT)))
    for fid, (st, mid, inf) in EXPECT.items():
        g = reg(fid)
        ok(g.get("state") == st and g.get("master_id") == mid and g.get("inferred") == inf, "1. backfill %s: %s, MasterID %s, inferred %s (%s)" % (fid, st, mid or "-", inf, {k: g.get(k) for k in ("state", "source", "master_id", "inferred", "words")}))
    ok(reg("K1").get("source") == "owner" and reg("K1").get("by") == STAFF, "1. K1's record names the member who marked it (%s)" % reg("K1"))
    ok(reg("L1").get("source") == "recorder", "1. L1: settled by the recorder's match (%s)" % reg("L1").get("source"))
    ok("Missing Ledger" in reg("C2").get("words", "") and "Rent" in reg("D1x").get("words", ""), "1. Tally's words kept (C2: %s | D1x: %s)" % (reg("C2").get("words"), reg("D1x").get("words")))
    a1 = reg("A1")
    ok(a1.get("vch_type") == "Purchase" and a1.get("vch_no") == "N-A1" and a1.get("vch_date") == "2026-07-05" and a1.get("amount") in ("1180", "1180.00") and a1.get("kind") == "bill" and a1.get("book") == BOOK,
       "1. the voucher's type, number, date, amount, kind and book (%s)" % a1)
    ok(all(any(h["note"].startswith("backfill") for h in hist(fid)) for fid in EXPECT), "1. a history row 'backfill' for each")
    # the staging mirror gives the same counts here
    mirror = {r["state"]: int(r["n"]) for r in db.rows(staging_sql())}
    here = {r["state"]: int(r["n"]) for r in db.rows("select state, count(*) as n from tally_post_register group by state")}
    ok(mirror == here, "1. the read-only staging SELECT mirrors the backfill (%s / %s)" % (mirror, here))

    # ---------------------------------------------------------------- 2. the rule on Tally's reply, live
    job(20, ["P1", "P2", "P3"])
    ok(all(reg(i).get("state") == "queued" and reg(i).get("source") == "queue" for i in ("P1", "P2", "P3")), "2. queued as the posting is queued (%s)" % reg("P1"))
    update(20, "taken")
    ok(all(reg(i).get("state") == "sent" for i in ("P1", "P2", "P3")), "2. sent once the Tally computer takes it (%s)" % reg("P2").get("state"))
    update(20, "running", [reply(i, 3, 2, "906", exc=1, line="Ledger 'P72 Missing Ledger' does not exist!") for i in ("P1", "P2", "P3")])
    a = apply(20)
    ok(a.get("ok") is True and a.get("states") == {"needs_review": 3}, "2. a partial batch (created 2 of 3, EXCEPTIONS 1): needs_review for all three, never in_tally (%s)" % a)
    ok("does not exist" in reg("P2").get("words", "") and reg("P2").get("source") == "reply", "2. with Tally's words (%s)" % reg("P2").get("words"))
    update(20, "done")
    ok(all(reg(i).get("state") == "needs_review" for i in ("P1", "P2", "P3")), "2. still needs_review when the posting ends")
    job(21, ["Q1", "Q2"], "running", [reply(i, 2, 2, "1001") for i in ("Q1", "Q2")]); apply(21)
    ok(reg("Q1").get("state") == "in_tally" and reg("Q1").get("master_id") == "1000" and reg("Q2").get("master_id") == "1001" and reg("Q1").get("inferred") == "true",
       "2. a clean batch: in_tally, ids 1000 and 1001 inferred from LASTVCHID (%s)" % reg("Q1"))
    job(22, ["R1"], "running", [reply("R1", 1, 1, "1100")]); apply(22)
    ok(reg("R1").get("state") == "in_tally" and reg("R1").get("master_id") == "1100" and reg("R1").get("inferred") == "false", "2. one voucher, CREATED 1, LASTVCHID: in_tally, exact (%s)" % reg("R1"))
    job(23, ["S1"], "running", [reply("S1", 1, 0, "", exc=1, line="Ledger 'Rent' does not exist!")]); apply(23)
    ok(reg("S1").get("state") == "refused" and "Rent" in reg("S1").get("words", ""), "2. nothing created, a LINEERROR: refused with Tally's words (%s)" % reg("S1"))
    job(24, ["T1", "T2"], "running", [reply(i, 2, 2, "1201", altered=0, line="something odd") for i in ("T1", "T2")]); apply(24)
    ok(reg("T1").get("state") == "needs_review", "2. created all but a LINEERROR: needs_review (%s)" % reg("T1").get("state"))
    r = rpcj(OWNER, "select tally_post_register_apply(%s::uuid)::text" % q(J(22)))
    ok("_error" in r, "2. tally_post_register_apply is the service role's alone (%s)" % r.get("_error", r)[-100:])

    # a large posting: 400 bank lines queued, then Tally's reply for them, in a few seconds at most
    import time
    big = ["BK%03d" % i for i in range(400)]
    t0 = time.time(); job(30, big, vouchers=[vch(i, "Payment", "100.00") for i in big]); t1 = time.time() - t0
    db.sql("update tally_post_jobs set status = 'running', taken_at = now(), results = %s where id = %s" % (q(json.dumps([reply(i, 50, 50, str(5000 + 50 * (k // 50) + 49), sent="2026-10-26T11:%02d:00+05:30" % (k // 50)) for k, i in enumerate(big)])), q(J(30))))
    t0 = time.time(); a = apply(30); t2 = time.time() - t0
    ok(a.get("states") == {"in_tally": 400} and reg("BK000").get("master_id") == "5000" and reg("BK399").get("master_id") == "5399" and reg("BK000").get("kind") == "bank" and t1 < 5 and t2 < 5,
       "2. 400 bank lines in 8 batches of 50: queued in %.2f s, the reply applied in %.2f s, ids inferred per batch (%s, %s)" % (t1, t2, a.get("states"), reg("BK399").get("master_id")))

    # ---------------------------------------------------------------- 3/4/5. evidence settles
    db.sql("""insert into tally_recorder_lines (firm_id, client_id, book_id, line_id, event, object_guid, master_id, alter_id, vch_type, vch_no, state, payload)
              values (%s, 'c1', %s, 'L-1', 'created', 'g-p1', '905', 77, 'Purchase', 'N-P1', 'applied', %s)""" % (q(F), q(BOOK), q(json.dumps({"fid": "P1", "event": "created"}))))
    s = svc("select tally_post_register_settle_book(%s::uuid)::text" % q(BOOK))
    ok(reg("P1").get("state") == "in_tally" and reg("P1").get("source") == "recorder" and reg("P1").get("master_id") == "905", "3. the recorder's line with TDSDesk:P1 settles P1: in_tally, MasterID 905 (%s | %s)" % (reg("P1"), s))
    ok(any(h["to_state"] == "in_tally" and h["source"] == "recorder" for h in hist("P1")), "3. the change is in P1's history")
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration, fincom_id) values (%s, %s, 'g-p2', '2026-07-05', 'Purchase', 'N-P2', 'Party', 'TDSDesk:P2 | Bill', 'P2')" % (q(BOOK), q(F)))
    s = svc("select tally_post_register_settle_book(%s::uuid)::text" % q(BOOK))
    ok(reg("P2").get("state") == "in_tally" and reg("P2").get("source") == "daybook", "4. a Day Book entry with fincom_id P2 settles P2 (%s | %s)" % (reg("P2"), s))
    ok(reg("P3").get("state") == "needs_review", "4. P3 (no evidence) still needs review")
    ok(svc("select tally_post_register_settle_all()::text").get("ok") is True, "4. settle_all runs (the cron's)")
    apply(20); update(20, "done")
    ok(reg("P1").get("state") == "in_tally" and reg("P2").get("source") == "daybook", "4. a later reply never undoes the evidence (%s, %s)" % (reg("P1").get("state"), reg("P2").get("source")))
    c = svc("select tally_post_register_confirm('Q1', '1000', 'bridge FinComVoucherObject')::text")
    ok(c.get("ok") is True and reg("Q1").get("source") == "bridge" and reg("Q1").get("inferred") == "false", "5. the bridge's hook confirms Q1 by MasterID: no longer inferred (%s | %s)" % (c, reg("Q1")))
    c = svc("select tally_post_register_confirm('F1', '1', 'bridge')::text")
    ok(c.get("ok") is False, "5. a queued record is not settled by a check (%s)" % c)
    r = rpcj(OWNER, "select tally_post_register_confirm('Q2', '1001', 'x')::text")
    ok("_error" in r, "5. the hook is the service role's alone")

    # ---------------------------------------------------------------- 6. the duplicate guard
    for fid, st in (("A1", "in_tally"), ("P3", "needs_review"), ("F1", "queued")):
        n0 = counts()
        good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(60 + len(fid) + ord(fid[0]))), q(json.dumps({"vouchers": [vch(fid)]}))))
        ok((not good or '"ok": false' in out or '"ok":false' in out) and counts() == n0 and reg(fid).get("state") == st, "6. %s (%s) cannot be queued again: refused, nothing added (%s)" % (fid, st, out.splitlines()[0][-200:]))
    update(23, "failed")
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', %s::jsonb)::text" % (q(J(70)), q(json.dumps({"vouchers": [vch("S1")]}))))
    ok(good and reg("S1").get("state") == "queued" and reg("S1").get("job") == J(70) and [h["to_state"] for h in hist("S1")][-1] == "queued", "6. S1 (refused) is queued again: the same record moved to the new posting (%s | %s)" % (out[-120:], reg("S1")))
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(8)))
    good, out = as_user(OWNER, "select tally_post_enqueue(%s::uuid, 'c1', '{}'::jsonb)::text" % q(J(8)))
    ok((not good) and "needs review" in out and db.one("select status from tally_post_jobs where id = %s" % q(J(8))) == "failed" and reg("H1").get("state") == "needs_review",
       "6. a person's Retry of a posting whose H1 needs review (no answer came) is refused (%s)" % out.splitlines()[0][-220:])
    job(25, ["U1"], "taken"); db.sql("update tally_post_jobs set results = %s where id = %s" % (q(json.dumps([reply("U1", 2, 1, "1300", exc=1, line="x")])), q(J(25)))); apply(25)
    db.sql("update tally_post_jobs set updated_at = now() - interval '1 hour', taken_at = now() - interval '1 hour', status = 'running' where id = %s" % q(J(25)))
    n = db.one("select tally_post_requeue()")
    ok(n is not None, "6. the cron's requeue is never stopped by the register (requeued %s)" % n)

    # ---------------------------------------------------------------- 7. the owner actions
    r = rpcj(VIEWER, "select tally_post_register_mark_posted('P3', '907', 'seen')::text")
    ok("_error" in r, "7. a viewer cannot mark posted (%s)" % r.get("_error", r)[-120:])
    r = rpcj(STAFF, "select tally_post_register_mark_posted('T1', '1200', 'seen in the Day Book')::text")
    ok(r.get("state") == "in_tally" and reg("T1").get("source") == "owner" and reg("T1").get("by") == STAFF and reg("T1").get("master_id") == "1200",
       "7. Mark posted by staff (55's RPC): in_tally, MasterID 1200, by Ravi (%s | %s)" % (r, reg("T1")))
    r = rpcj(OWNER, "select tally_post_register_release('T2', 'not in the Day Book')::text")
    ok(r.get("asked") is True and reg("T2").get("state") == "needs_review", "7. Not in Tally first asks the bridge to look (55): nothing released yet (%s | %s)" % (r, reg("T2").get("state")))
    ck = db.one("select id from tally_post_checks where job_id = %s and entry_id = 'T2' and state = 'waiting'" % q(J(24)))
    db.sql("update tally_post_jobs set taken_by = %s, target_bridge = %s where id = %s" % (q(B1), q(B1), q(J(24))))
    rep = svc("select tally_post_check_report(%s, %s, %s, true, 'ZZ CO', 'notseen', '', '', '')::text" % (ck, q(D1), q(B1)))
    r = rpcj(OWNER, "select tally_post_check_confirm(%s::uuid, 'T2', 'looked in the Day Book: not there')::text" % q(J(24)))
    ok(r.get("ok") is True and reg("T2").get("state") in ("queued", "released"), "7. after the bridge's 'not seen' and a confirm: released and queued again, that entry alone (%s | %s | %s)" % (rep, r, reg("T2")))
    ok(any(h["to_state"] == "released" and h["source"] == "owner" and h["by"] == OWNER for h in hist("T2")) and reg("T1").get("state") == "in_tally",
       "7. the release is in T2's history with who did it; T1 stays in_tally (%s)" % hist("T2"))

    # recorded posting (straight to a bridge, tally_post_record's shape: device none, finished): a fact, never refused
    job(27, ["W2"], "failed", [{"id": "W2", "ok": False, "outcomeUnknown": True, "message": "no answer"}])
    ok(reg("W2").get("state") == "needs_review", "6. W2: a failed posting with no answer from Tally needs review (%s)" % reg("W2").get("state"))
    n0 = counts()
    try: db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n) values (%s, %s, 'c1', 'ZZ CO', %s, %s, 1)" % (q(J(85)), q(F), q(D1), q(json.dumps({"vouchers": [vch("W2")]})))); out = "inserted"
    except RuntimeError as e: out = str(e)
    ok("Not queued" in out and counts() == n0 and reg("W2").get("state") == "needs_review", "6. W2 (needs review, its id no longer held by tally_post_ids) in a new posting, by any route: refused by the register (%s)" % out.splitlines()[0][-200:])
    job(26, ["W2"], "done", [{"id": "W2", "ok": True, "verified": True, "masterId": "1400", "message": "posted"}], device=None, vouchers=[{"id": "W2"}])
    ok(reg("W2").get("state") == "in_tally" and reg("W2").get("job") == J(26) and reg("W2").get("master_id") == "1400", "6. a posting recorded after it went straight to a bridge is a fact, never refused; the record follows it (%s)" % reg("W2"))

    # ---------------------------------------------------------------- 8. never removed, history add-only
    out = ""
    try: db.sql("delete from tally_post_register where fincom_id = 'A1'"); removed = True
    except RuntimeError as e: removed = False; out = str(e)
    ok(not removed and reg("A1"), "8. a register row cannot be removed, even by the database's owner (%s)" % out[-120:])
    try: db.sql("update tally_post_register_history set note = 'x'"); changed = True
    except RuntimeError as e: changed = False
    ok(not changed, "8. the history cannot be changed")

    # ---------------------------------------------------------------- 9. RLS across firms
    job(90, ["Z9"], "waiting", firm=F2, client="c9", device=D9)
    ok(reg("Z9", F2).get("state") == "queued", "9. the other firm's posting has its record")
    mine = rpcj(OWNER, "select json_build_object('n', count(*), 'other', count(*) filter (where firm_id <> %s))::text from tally_post_register" % q(F))
    theirs = rpcj(OTHER, "select json_build_object('n', count(*), 'mine', count(*) filter (where firm_id = %s))::text from tally_post_register" % q(F))
    hh = rpcj(OTHER, "select json_build_object('n', count(*), 'mine', count(*) filter (where firm_id = %s))::text from tally_post_register_history" % q(F))
    ok(mine.get("n", 0) > 10 and mine.get("other") == 0 and theirs.get("n") == 1 and theirs.get("mine") == 0 and hh.get("mine") == 0, "9. each firm reads its own rows only (%s | %s | %s)" % (mine, theirs, hh))
    for stmt in ("insert into tally_post_register (firm_id, client_id, fincom_id, state) values ('%s', 'c1', 'X1', 'in_tally')" % F,
                 "update tally_post_register set state = 'in_tally' where fincom_id = 'P3'", "delete from tally_post_register_history"):
        good, out = as_user(OWNER, stmt)
        ok(not good and "permission denied" in out, "9. nobody signed in writes: %s (%s)" % (stmt.split(" ")[0], out[-80:]))
    ok(reg("P3").get("state") == "needs_review", "9. P3 unchanged")
    r = rpcj(OTHER, "select tally_post_register_mark_posted('P3', '1', 'x')::text")
    ok("_error" in r and reg("P3").get("state") == "needs_review", "9. another firm's owner cannot mark this firm's entry (%s)" % r.get("_error", r)[-100:])
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
