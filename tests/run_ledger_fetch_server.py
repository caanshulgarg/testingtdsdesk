"""python3 run_ledger_fetch_server.py - (15-Oct-2026, the owner's decision; branch next-ledger-fetch, migration 89) through the
real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py), whose
migration-89 functions (tally_ledger_fetch_plan, tally_ledger_rename_from_tally) are answered by a throwaway PostgreSQL
(pg_stand, built 32 -> ... -> 59 -> 89 as on staging; never a real database). FinCom Bridge 2.4.4 is not changed: the beat's
existing ledgersWanted and ledgers answers carry it all.
Checks:
  A. the beat of a bridge with the company open names, in ledgersWanted, the ledgers the book's live entries use that FinCom's
     ledger list lacks (company, company GUID from the beat, name; no heldAt), as the app matches them (capitals / spaces /
     an alias: not named); a company not open: nothing; the plan asked with room 20 less the held lines' names.
  B. more than 20 missing: no names, the full ledger list asked once (the beat's existing "ledgers" {company: time}), not on
     the next beat (30 minutes); after 3 rounds by name the same.
  C. paused in the tray, reading stopped by the bridge (readStopped) or from FinCom (tally_read_stops): no names, no full
     list, the plan not asked (nothing recorded).
  D. ledger_changes with a Tally GUID FinCom holds under another name: renamed (tally_ledger_rename_from_tally; the lines
     follow, the trial balance unchanged, the old name kept as an alias), the row kept current under the new name, said
     in kept with the owner's decision of 15-Oct-2026; no 2.3.1 alias of the new name.
  E. the rename refused (the trial balance would change): nothing changed in the books, the case held with words, said in
     kept; entries using the new name keep applying under FinCom's ledger (2.3.1's alias, as before).
  F. a cloud without migration 89: the beat as before (no automatic names, nothing fails); a renamed ledger kept as 2.3.1
     did (the alias, the name stays), said in kept.
  G. the old name's alias is not ended when the GUID comes again under the new name.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-89-ledger-fetch.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, B2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
DEV, KEY = "d1000000-0000-0000-0000-000000000001", "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa111111", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.4.4"}
db = pg_stand.start(30891)
fn = None
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F)s, 'c2', 'YY CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(FIRM), "O": q(OWNER), "B": q(B), "B2": q(B2)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # the books in the database (the plan and the rename read them there) and the ledger list as tally-ingest reads it (the stand-in)
    def ledger(book, name, guid, open_=0):
        db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, tally_guid, alter_id) values (%s, %s, %s, 'Sundry Debtors', %s, %s, %s, 10)" % (q(book), q(FIRM), q(name), open_, open_, q(guid)))
        FS.T.setdefault("tally_ledgers", []).append({"book_id": book, "firm_id": FIRM, "name": name, "parent": "Sundry Debtors", "chain": ["Sundry Debtors"], "primary_group": "Sundry Debtors", "open": open_, "open_sent": open_,
                                                     "tally_guid": guid, "alter_id": 10, "gstin": None, "pan": None, "state": None, "deleted_at": None})
    def entry(book, guid, day, lines, party=""):
        db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party) values (%s, %s, %s, %s, 'Journal', %s, %s)" % (q(book), q(FIRM), q(guid), q(day), q(guid), q(party)))
        for led, amt in lines:
            db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, %s, %s, %s, %s)" % (q(book), q(FIRM), q(guid), q(day), q(led), amt))
            db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, %s, %s, %s, 0, 0, 1) on conflict (book_id, ledger, day) do update set amount = tally_ledger_day.amount + excluded.amount, n = tally_ledger_day.n + 1"
                   % (q(book), q(FIRM), q(led), q(day), amt))
    for n, g in (("Cash", "g-cash"), ("Input CGST", "g-icgst"), ("Old Party", "g-old"), ("Broken Party", "g-broken")):
        ledger(B, n, g)
    entry(B, "v1", "2026-05-01", [("Cash", -100), ("INPUT CGST", 18), ("Missing A", 41), ("Missing B", 41)])
    entry(B, "v2", "2026-05-02", [("Cash", -500), ("Old Party", 500)], party="Old Party")
    entry(B, "v3", "2026-05-03", [("Cash", -70), ("Broken Party", 70)], party="Broken Party")
    ledger(B2, "Cash", "g2-cash")
    entry(B2, "w1", "2026-05-01", [("Cash", -25)] + [("New Ledger %02d" % i, 1) for i in range(25)])
    tb = lambda book=B: round(float(db.one("select coalesce(sum(closing), 0) from tally_balances where book_id = %s" % q(book)) or 0), 2)

    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name in ("tally_ledger_fetch_plan", "tally_ledger_rename_from_tally") and name not in FS.NO_FN:
            FS.ARGS.setdefault(name, []).append(a)
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ CO", "client_id": "c1", "book_id": B}, {"firm_id": FIRM, "company": "YY CO", "client_id": "c2", "book_id": B2}]
    FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.4"})
    FS.T.setdefault("tally_ledger_aliases", []); FS.T.setdefault("tally_groups", [{"book_id": B, "firm_id": FIRM, "name": "Sundry Debtors", "parent": ""}])
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def beat(open_=("ZZ CO",), **kw):
        cos = [{"name": "ZZ CO", "open": "ZZ CO" in open_, "guid": "cg-zz"}, {"name": "YY CO", "open": "YY CO" in open_, "guid": "cg-yy"}]
        return call(dict({"kind": "beat", "version": "2.4.4", "bridge": GA, "tally": True, "open": list(open_), "companies": cos}, **kw))
    auto = lambda r, co="ZZ CO": sorted(x["name"] for x in (r.get("ledgersWanted") or []) if x.get("company") == co)
    st = lambda book=B: (db.rows("select rounds, full_n, coalesce(full_at::text, '') as full_at, checked_at::text as c from tally_ledger_fetch where book_id = %s" % q(book)) or [{}])[0]

    # ---------------------------------------------------------------- A. the names
    c, r = beat()
    lw = [x for x in (r.get("ledgersWanted") or []) if x.get("company") == "ZZ CO"]
    ok(c == 200 and auto(r) == ["Missing A", "Missing B"] and all(x.get("company_guid") == "cg-zz" and "heldAt" not in x for x in lw),
       "A. the beat names the ledgers the live entries use that FinCom lacks: company, the company's GUID, name (%s)" % lw)
    ok("INPUT CGST" not in auto(r) and "Cash" not in auto(r), "A. 'INPUT CGST' (FinCom: 'Input CGST'): the same ledger, not named")
    ok("YY CO" not in json.dumps(r.get("ledgersWanted")) and "YY CO" not in (r.get("ledgers") or {}), "A. a company not open in this bridge's Tally: nothing for it")
    pa = (FS.ARGS.get("tally_ledger_fetch_plan") or [{}])[-1]
    ok(pa.get("p_book") == B and pa.get("p_room") == 20 and pa.get("p_paused") is False, "A. the plan asked for the open company's book, room 20 (no held lines) (%s)" % pa)

    # held lines' names first: the plan gets the room they leave of the 20
    FS.T["tally_recorder_lines"] = [{"id": 1, "line_id": "H1", "firm_id": FIRM, "company": "ZZ CO", "company_guid": "cg-zz", "book_id": B, "device_id": DEV, "bridge": GA["id"], "state": "held",
                                     "received_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "held_why": "waiting for the ledger 'Held X' from Tally", "payload": {"waitLedgers": ["Held X"]}, "event": "created"}]
    c, r = beat()
    names = [x["name"] for x in (r.get("ledgersWanted") or [])]
    pa = (FS.ARGS.get("tally_ledger_fetch_plan") or [{}])[-1]
    ok(c == 200 and names == ["Held X", "Missing A", "Missing B"] and pa.get("p_room") == 19, "A. a held line's ledger first, then the others; the plan's room 19 (%s; %s)" % (names, pa.get("p_room")))
    FS.T["tally_recorder_lines"][0]["payload"] = {"waitLedgers": ["Held %02d" % i for i in range(10)]}
    FS.T["tally_recorder_lines"].append(dict(FS.T["tally_recorder_lines"][0], id=2, line_id="H2", payload={"waitLedgers": ["Held %02d" % i for i in range(10, 20)]}))
    c, r = beat()
    names = [x["name"] for x in (r.get("ledgersWanted") or [])]
    pa = (FS.ARGS.get("tally_ledger_fetch_plan") or [{}])[-1]
    ok(c == 200 and len(names) == 20 and not [n for n in names if n.startswith("Missing")] and pa.get("p_room") == 0, "A. 20 held names: no room, never over 20 (%d; room %s)" % (len(names), pa.get("p_room")))
    FS.T["tally_recorder_lines"] = []
    db.sql("update tally_ledger_fetch set rounds = 0, names_key = '', round_at = null where book_id = %s" % q(B))

    # ---------------------------------------------------------------- B. the full list
    c, r = beat(open_=("ZZ CO", "YY CO"))
    led = r.get("ledgers") or {}
    ok(c == 200 and "YY CO" in led and not auto(r, "YY CO") and auto(r) == ["Missing A", "Missing B"], "B. 25 missing in YY CO: the full ledger list asked (ledgers), no names; ZZ CO's names still sent (%s)" % led)
    c, r = beat(open_=("ZZ CO", "YY CO"))
    ok(c == 200 and "YY CO" not in (r.get("ledgers") or {}), "B. the next beat: not asked again (30 minutes)")
    for back in (10, 10, 10):
        db.sql("update tally_ledger_fetch set round_at = round_at - interval '%d minutes' where book_id = %s" % (back, q(B)))
        c, r = beat()
    ok(c == 200 and "ZZ CO" in (r.get("ledgers") or {}) and auto(r) == [] and int(st()["full_n"]) == 1, "B. the same names still missing after 3 rounds by name: the full list asked once, no names (%s; %s)" % (r.get("ledgers"), st()))
    c, r = beat()
    ok(c == 200 and "ZZ CO" not in (r.get("ledgers") or {}) and auto(r) == [], "B. the next beat: not again (30 minutes), nothing by name")

    # ---------------------------------------------------------------- C. paused / stopped: nothing
    db.sql("update tally_ledger_fetch set full_at = full_at - interval '31 minutes', round_at = round_at - interval '31 minutes' where book_id in (%s, %s)" % (q(B), q(B2)))
    s0, n0 = st(), len(FS.ARGS.get("tally_ledger_fetch_plan") or [])
    for what, kw in (("paused in the tray", {"paused": True}), ("stopped by the bridge (readStopped)", {"readStopped": {"by": "self", "reason": "over 2 s", "at": "2026-10-15T10:00:00Z"}})):
        c, r = beat(open_=("ZZ CO", "YY CO"), **kw)
        ok(c == 200 and not auto(r) and not auto(r, "YY CO") and not (r.get("ledgers") or {}) and st() == s0 and len(FS.ARGS.get("tally_ledger_fetch_plan") or []) == n0,
           "C. %s: no names, no full list, the plan not asked (%s)" % (what, r.get("ledgers")))
    FS.T.setdefault("tally_read_stops", []).append({"id": 1, "firm_id": FIRM, "device_id": DEV, "action": "stop", "reason": "the owner stopped it", "stopped_at": "2026-10-15T09:00:00Z", "cleared_at": None})
    c, r = beat(open_=("ZZ CO", "YY CO"))
    ok(c == 200 and not auto(r) and not (r.get("ledgers") or {}) and len(FS.ARGS.get("tally_ledger_fetch_plan") or []) == n0, "C. stopped from FinCom (tally_read_stops): nothing (%s)" % r.get("ledgers"))
    FS.T["tally_read_stops"] = []
    c, r = beat(open_=("ZZ CO", "YY CO"))
    ok(c == 200 and "ZZ CO" in (r.get("ledgers") or {}) and "YY CO" in (r.get("ledgers") or {}), "C. reading again, 31 minutes on: the full list asked for both (%s)" % r.get("ledgers"))

    # ---------------------------------------------------------------- D. a rename from Tally
    lch = lambda rows, why="counter": call({"kind": "ledger_changes", "company": "ZZ CO", "company_guid": "cg-zz", "version": "2.4.4", "bridge": GA, "ledgers": rows, "why": why})
    FS.T["tally_ledger_aliases"].append({"book_id": B, "firm_id": FIRM, "tally_name": "Unrelated", "fincom_name": "Cash", "tally_guid": "g-cash", "confirmed_at": "2026-10-01T00:00:00Z", "ended_at": None})
    tb0 = tb()
    c, r = lch([["g-old", 7, 20, "New Party", "Sundry Debtors", "0", "27AAACN1234B1Z5", "", 0, "Maharashtra"]])
    kept = " | ".join(r.get("kept") or [])
    al = {x["tally_name"]: x for x in db.rows("select tally_name, fincom_name, coalesce(ended_at::text, '') as e from tally_ledger_aliases where book_id = %s" % q(B))}
    ok(c == 200 and r.get("ok") is True and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'New Party' and tally_guid = 'g-old'" % q(B)) == "1"
       and db.one("select count(*) from tally_lines where book_id = %s and ledger = 'Old Party'" % q(B)) == "0" and db.one("select party from tally_vouchers where book_id = %s and guid = 'v2'" % q(B)) == "New Party",
       "D. renamed as in Tally: FinCom's ledger and its entries now 'New Party' (%s)" % r)
    ok(tb() == tb0, "D. the trial balance unchanged (%s -> %s)" % (tb0, tb()))
    ok(al.get("Old Party", {}).get("fincom_name") == "New Party" and not al["Old Party"]["e"], "D. the old name kept as an alias (Old Party -> New Party) (%s)" % al)
    up = [x for x in FS.T["tally_ledgers"] if x.get("book_id") == B and x.get("name") == "New Party"]
    ok(len(up) == 1 and up[0].get("gstin") == "27AAACN1234B1Z5" and up[0].get("alter_id") == 20, "D. the row kept current under its new name (GSTIN, AlterID) (%s)" % up)
    ok("renamed to 'New Party'" in kept and "15-Oct-2026" in kept and "2.3.2" not in kept, "D. said in kept: renamed, the owner's decision of 15-Oct-2026 (%s)" % kept)
    ok(not [x for x in FS.T["tally_ledger_aliases"] if x.get("tally_name") == "New Party"], "D. no 2.3.1 alias of the new name (the ledger has that name now)")

    # ---------------------------------------------------------------- G. the old name's alias stays when the GUID comes again
    FS.T["tally_ledger_aliases"].append({"book_id": B, "firm_id": FIRM, "tally_name": "Old Party", "fincom_name": "New Party", "tally_guid": "g-old", "confirmed_at": "2026-10-15T00:00:00Z", "ended_at": None})
    c, r = lch([["g-old", 7, 21, "New Party", "Sundry Debtors", "0", "27AAACN1234B1Z5", "", 0, "Maharashtra"]])
    a = next(x for x in FS.T["tally_ledger_aliases"] if x.get("tally_name") == "Old Party")
    ok(c == 200 and not a.get("ended_at"), "G. the GUID again under the new name: the old name's alias (pointing at it) not ended (%s)" % a)

    # ---------------------------------------------------------------- E. refused: nothing changed, held with words
    db.sql("""create or replace function test_break_tb() returns trigger language plpgsql as $$ begin new.amount := new.amount + 1; return new; end $$;
              create trigger test_break_tb before insert on tally_ledger_day for each row when (new.ledger = 'Broken New') execute function test_break_tb();""")
    snap = lambda: (db.rows("select name, tally_guid from tally_ledgers where book_id = %s order by name" % q(B)), db.rows("select guid, ledger, amount::text from tally_lines where book_id = %s order by guid, ledger" % q(B)),
                    db.rows("select ledger, day::text, amount::text from tally_ledger_day where book_id = %s order by ledger, day" % q(B)))
    s0, tb1 = snap(), tb()
    c, r = lch([["g-broken", 8, 30, "Broken New", "Sundry Debtors", "0", "", "", 0, ""]])
    kept = " | ".join(r.get("kept") or [])
    hold = db.rows("select words from tally_ledger_rename_holds where book_id = %s and settled_at is null" % q(B))
    ok(c == 200 and r.get("ok") is True and snap() == s0 and tb() == tb1, "E. the rename would change the trial balance: nothing changed in the books")
    ok(len(hold) == 1 and "trial balance" in hold[0]["words"] and "not renamed" in kept and "trial balance" in kept, "E. held with words, said in kept (%s; %s)" % (hold, kept))
    alb = [x for x in FS.T["tally_ledger_aliases"] if x.get("tally_name") == "Broken New"]
    ok(len(alb) == 1 and alb[0].get("fincom_name") == "Broken Party" and [x for x in FS.T["tally_ledgers"] if x.get("name") == "Broken Party" and x.get("alter_id") == 30],
       "E. entries using 'Broken New' keep applying under 'Broken Party' (2.3.1's alias); the row kept current under FinCom's name (%s)" % alb)
    db.sql("drop trigger test_break_tb on tally_ledger_day")      # the throwaway database's own test trigger

    # ---------------------------------------------------------------- F. a cloud without migration 89
    FS.NO_FN.update({"tally_ledger_fetch_plan", "tally_ledger_rename_from_tally"})
    c, r = beat(open_=("ZZ CO", "YY CO"))
    ok(c == 200 and r.get("ok") is True and not r.get("ledgersWanted") and not (r.get("ledgers") or {}), "F. without 89: the beat as before, nothing automatic, nothing fails (%s)" % {k: r.get(k) for k in ("ledgersWanted", "ledgers")})
    ledger(B, "Third Party", "g-third")
    c, r = lch([["g-third", 9, 40, "Third Renamed", "Sundry Debtors", "0", "", "", 0, ""]], "wanted")
    kept = " | ".join(r.get("kept") or [])
    al3 = [x for x in FS.T["tally_ledger_aliases"] if x.get("tally_name") == "Third Renamed"]
    ok(c == 200 and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Third Party'" % q(B)) == "1" and len(al3) == 1 and al3[0].get("fincom_name") == "Third Party" and "migration 89" in kept,
       "F. without 89: the rename not made, 2.3.1's alias kept, said in kept (%s)" % kept)
    FS.NO_FN.clear()
    if fails: print("".join(log[-40:]))
finally:
    if fn: fn.terminate()
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
