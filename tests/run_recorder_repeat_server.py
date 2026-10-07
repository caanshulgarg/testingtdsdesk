"""python3 run_recorder_repeat_server.py - (07-Oct-2026, next release, branch next-outbox; migration 63) FinCom ignores a
repeat of a recorder line. The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py), whose recorder functions (tally_recorder_send / _apply / _enqueue) are answered by a throwaway PostgreSQL
(pg_stand, port 55461; never a real database) built in staging's order 32 -> ... -> 60 -> 63.
The bridge keeps every line until FinCom answers, so a bridge stopped after FinCom stored a group, before it wrote its marks,
sends that group again after its restart. Checks:
  1. a group (an entry with its XML, a line without a GUID, a delete) from a bridge after 2.3.1 (again ""): applied / held;
     the payload keeps again.
  2. the same group again (the restart): 200, every result state duplicate with already: true and the first state (was); the
     answer counts already 3; no row added; the entry once in tally_vouchers.
  3. a ":resolved" line sent once more ON PURPOSE (again "ledger") is stored; the same again is a repeat.
  4. an older bridge (no again key): a repeat answered already; its ":resolved" line whose row is held is stored again (2.3.1's
     deliberate resend, as before 63).
  5. more than 50 full lines (the queue) sent twice, then the drain: one row per line.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno). RED_WITHOUT_63=1 builds the database to 60 only (and
INDEX_TS can name another copy of index.ts): the repeats are stored twice."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
INDEX = os.environ.get("INDEX_TS") or os.path.join(SQLDIR, "index.ts")
RED = os.environ.get("RED_WITHOUT_63") == "1"
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql",
                                           "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")] + \
        ([] if RED else [os.path.join(SQLDIR, "migration-63-recorder-repeat.sql")])
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, BOOK, OWNER = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111161", "55555555-5555-5555-5555-555555555555"
DA = "d1000000-0000-0000-0000-000000000061"
KA = "fcd_" + "6" * 48
CG = "c0c0c0c0-6161-4161-8161-616161616161"
GO = {"id": "go-aaaaaa616161", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.3.2"}
db = pg_stand.start(55461)
fn = None
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'PC-A', 'ha', '2.3.2');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "A": q(DA)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    print("  database built to %s" % ("60 (RED_WITHOUT_63)" if RED else "63"))
    db.one("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s::jsonb, %s::jsonb)::text" % (q(BOOK), q(json.dumps([["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Capital", "Capital Account", "1000"]])),
                                                                                                   q(json.dumps([["Sales Accounts", ""], ["Capital Account", ""]]))))
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name in ("tally_recorder_apply", "tally_recorder_enqueue", "tally_recorder_send", "tally_start_point", "tally_recorder_gap_check"):
            FS.ARGS.setdefault(name, []).append(a)
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "book_id": BOOK})
    FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.2"})
    # the ledgers the entries name, as the book's list holds them (the ledger wait of 2.3.1 reads them through the API)
    FS.T.setdefault("tally_ledgers", []).extend([{"book_id": BOOK, "firm_id": FIRM, "name": n} for n in ("Cash", "Sales", "Capital")])
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", INDEX], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KA})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def xml(guid, alter, date, amt):
        return ('<VOUCHER REMOTEID="%s" VCHTYPE="Sales" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-%s</VOUCHERNUMBER>'
                '<NARRATION>Sale</NARRATION><ISCANCELLED>No</ISCANCELLED><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
                '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (guid, date, guid, alter, guid[-4:], amt, -amt)
    def line(lid, event, guid, alter, mid="", body=False, again=""):
        x = {"line_id": lid, "event": event, "object_guid": guid, "master_id": mid, "alter_id": alter, "vch_type": "Sales", "vch_no": "S-" + guid[-4:], "vch_date": "20260510",
             "saved_at": "2026-05-10T10:00:00+05:30", "pc": "PC-A", "user": "owner", "company_guid": CG, "ledgers": [], "narration": "Sale", "fid": "", "source": "addon", "full": False,
             "xml": xml(guid, alter, "20260510", 100) if body else ""}
        if again is not None: x["again"] = again
        return x
    def send(lines): return call({"kind": "recorder_lines", "company": "ZZ CO", "company_guid": CG, "bridge": GO, "version": "2.3.2", "lines": lines})
    def rows(lid=None): return int(db.one("select count(*) from tally_recorder_lines where book_id = %s%s" % (q(BOOK), "" if lid is None else " and line_id = " + q(lid))))
    def by(r): return {x.get("line_id"): x for x in (r.get("results") or [])}

    print("== 1. a group from a bridge after 2.3.1")
    g = CG + "-0000a001"
    grp = [line("p-1", "created", g, 501, mid="40961", body=True), line("p-2", "created", "", None), line("p-3", "deleted", CG + "-0000a0ff", 502)]
    c, r = send(grp)
    b = by(r)
    ok(c == 200 and b.get("p-1", {}).get("state") == "applied" and b.get("p-2", {}).get("state") == "held" and rows() == 3, "1. stored: applied / held / %s, 3 rows (%s %s)" % (b.get("p-3", {}).get("state"), c, {k: v.get("state") for k, v in b.items()}))
    pl = json.loads(db.one("select payload::text from tally_recorder_lines where line_id = 'p-1'") or "{}")
    ok(pl.get("again") == "", "1. the payload keeps again (\"\") (%s)" % {k: pl.get(k) for k in ("line_id", "again", "bridge")})

    print("== 2. the same group again (the bridge restarted before it wrote its marks)")
    c, r = send(grp)
    b = by(r)
    ok(c == 200 and all(b.get(k, {}).get("already") is True and b.get(k, {}).get("state") == "duplicate" for k in ("p-1", "p-2", "p-3")) and r.get("already") == 3,
       "2. 200, every line answered duplicate with already: true; already 3 (%s)" % {k: (v.get("state"), v.get("already"), v.get("was")) for k, v in b.items()})
    ok(b.get("p-1", {}).get("was") == "applied" and b.get("p-2", {}).get("was") == "held", "2. the first state given (was)")
    ok(rows() == 3, "2. no row added (%d)" % rows())
    ok(db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(BOOK), q(g))) == "1", "2. the entry once")

    print("== 3. a deliberate resend")
    c, r = send([line("p-2:resolved", "created", "", None)])
    c, r = send([line("p-2:resolved", "created", CG + "-0000a002", 503, mid="40962", body=True, again="ledger")])
    ok(c == 200 and not by(r).get("p-2:resolved", {}).get("already") and rows("p-2:resolved") == 2, "3. 'ledger' after '': stored (%s rows %d)" % (by(r), rows("p-2:resolved")))
    c, r = send([line("p-2:resolved", "created", CG + "-0000a002", 503, mid="40962", body=True, again="ledger")])
    ok(c == 200 and by(r).get("p-2:resolved", {}).get("already") is True and rows("p-2:resolved") == 2, "3. 'ledger' again: a repeat (%s)" % by(r))

    print("== 4. an older bridge (no again key)")
    c, r = send([line("o-1", "created", "", None, again=None)]); c, r = send([line("o-1", "created", "", None, again=None)])
    ok(by(r).get("o-1", {}).get("already") is True and rows("o-1") == 1, "4. a repeat: already, one row (%s rows %d)" % (by(r), rows("o-1")))
    c, r = send([line("o-1:resolved", "created", "", None, again=None)]); c, r = send([line("o-1:resolved", "created", "", None, again=None)])
    ok(not by(r).get("o-1:resolved", {}).get("already") and rows("o-1:resolved") == 2, "4. its ':resolved' line whose row is held: stored again, as before 63 (rows %d)" % rows("o-1:resolved"))

    print("== 5. the queue (more than 50 full lines) twice")
    many = [line("m-%02d" % i, "created", CG + "-0000b%03x" % i, 600 + i, mid=str(0xb000 + i), body=True) for i in range(51)]
    c1, r1 = send(many); c2, r2 = send(many)
    ok(c1 == 200 and c2 == 200 and r1.get("queued") == 51 and r2.get("queued") == 51, "5. both answered queued 51 (%s %s)" % (r1.get("queued"), r2.get("queued")))
    for _ in range(4): db.one("select tally_recorder_drain(15000)::text")
    n = int(db.one("select count(*) from tally_recorder_lines where book_id = %s and line_id like 'm-%%'" % q(BOOK)))
    ok(n == 51, "5. after the drain: one row per line (%d rows for 51 lines)" % n)
finally:
    if fn: fn.terminate()
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
