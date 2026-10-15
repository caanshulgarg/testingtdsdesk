"""python3 run_migration89.py - migration-89-ledger-fetch (15-Oct-2026, the owner's decision; branch next-ledger-fetch). On a
throwaway PostgreSQL (pg_stand, port 30890; never a real database), built 32 -> ... -> 58 -> 59 in staging's order, then 89
(twice). Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from', no drop or truncate, no real
     database named; runs twice; nothing removed (row counts kept); no existing function replaced.
  1. tally_ledger_fetch_plan(book, company, paused, room, now): the names the book's LIVE entries use that FinCom's ledger
     list does not hold; a deleted entry's names never; held = the same name, or the same name without capitals and spaces
     when exactly one live ledger has it (two such ledgers: not held), or a name of tally_ledger_aliases (not ended) whose
     FinCom ledger is held so; a ledger marked deleted is not held; a name the bridge cannot ask by name (a quote mark) is
     never named; at most `room` names, never over 20.
  2. more than 20 missing: the full list (full: true) instead, no names; asked again only after 30 minutes.
  3. the same names after 3 rounds by name (a round each 10 minutes; more often counts once): the full list once, not
     again inside 30 minutes, again after it; the names changing starts the rounds again; nothing missing clears the state.
  4. paused or stopped (p_paused): nothing answered and nothing recorded.
  5. tally_ledger_rename_from_tally: FinCom's ledger renamed by its Tally GUID (lines, the entries' party, day cache follow),
     the trial balance unchanged, the old name kept as an alias (old -> new, the GUID, confirmed), aliases pointing at the old
     name follow, the 2.3.1 alias (new -> old) ended; a name another ledger has: refused, nothing changed.
  6. the trial balance would change: refused, NOTHING changed (ledger, lines, day cache, aliases), the case kept with words
     in tally_ledger_rename_holds (one open row, tries counted); a later rename of that GUID settles it.
  7. privileges: the functions executable by the service role only (anon, authenticated: no); the tables read by the
     firm's members only; a caller who is not the service role is refused.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql",
                                           "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql")]
M89 = os.environ.get("M89_FILE") or os.path.join(SQLDIR, "migration-89-ledger-fetch.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2, OWNER, OTHER = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666"
B, B2, B3 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
T0 = "2026-10-15T10:00:00Z"

text = open(M89).read() if os.path.exists(M89) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M89))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", code) and not re.search(r"\btruncate\b", code), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")
made = re.findall(r"create or replace function public\.(\w+)", low)
ok(sorted(made) == ["tally_ledger_fetch_plan", "tally_ledger_loose", "tally_ledger_rename_from_tally"], "0. three new functions, no existing one replaced (%s)" % made)
# the migrations before 89 (90 replaces tally_ledger_fetch_plan on purpose: run_migration90.py)
others = [open(os.path.join(SQLDIR, x)).read().lower() for x in os.listdir(SQLDIR) if x.endswith(".sql") and x != os.path.basename(M89)
          and not (re.match(r"migration-(\d+)", x) and int(re.match(r"migration-(\d+)", x).group(1)) >= 89)]
ok(not [m for m in made if any(re.search(r"function (public\.)?%s\s*\(" % m, o) for o in others)], "0. none of the three is defined by another migration (no name taken over)")
ok(all(re.search(r"create table if not exists public\.%s\b" % t, low) for t in ("tally_ledger_fetch", "tally_ledger_rename_holds")), "0. two new tables, if not exists")

db = pg_stand.start(int(os.environ.get("M89_PORT") or 30890))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def counts(): return {r["t"]: int(db.one("select count(*) from public.%s" % r["t"])) for r in db.rows("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'tally_%' order by 1")}
def plan(book=B, at=T0, paused=False, room=20, company="ZZ CO"):
    return json.loads(db.one("select public.tally_ledger_fetch_plan(%s, %s, %s, %d, %s::timestamptz)::text" % (q(book), q(company), "true" if paused else "false", room, q(at))))
def at(mins): return db.one("select to_char((%s::timestamptz + interval '%d minutes') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')" % (q(T0), mins))
def state(book=B):
    r = (db.rows("select missing_n, rounds, full_n, coalesce(full_at::text, '') as full_at, names::text as names from tally_ledger_fetch where book_id = %s" % q(book)) or [None])[0]
    return r and dict(r, missing_n=int(r["missing_n"]), rounds=int(r["rounds"]), full_n=int(r["full_n"]))
def entry(book, guid, day, lines, party="", deleted=False):
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, deleted_at) values (%s, %s, %s, %s, 'Journal', %s, %s, %s)"
           % (q(book), q(F), q(guid), q(day), q(guid), q(party), "now()" if deleted else "null"))
    for led, amt in lines:
        db.sql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, %s, %s, %s, %s)" % (q(book), q(F), q(guid), q(day), q(led), amt))
        if not deleted:
            db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, %s, %s, %s, 0, 0, 1) on conflict (book_id, ledger, day) do update set amount = tally_ledger_day.amount + excluded.amount, n = tally_ledger_day.n + 1"
                   % (q(book), q(F), q(led), q(day), amt))
def ledger(book, name, guid=None, open_=0, deleted=False, merged=None):
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, tally_guid, deleted_at, merged_into) values (%s, %s, %s, 'Sundry Debtors', %s, %s, %s, %s, %s)"
           % (q(book), q(F), q(name), open_, open_, "null" if guid is None else q(guid), "now()" if deleted else "null", "null" if merged is None else q(merged)))
tb = lambda book=B: round(float(db.one("select coalesce(sum(closing), 0) from tally_balances where book_id = %s" % q(book)) or 0), 2)
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'),
        (%(B2)s, %(F)s, 'c2', 'YY CO', '2026-04-01', '2026-03-31'), (%(B3)s, %(F)s, 'c3', 'XX CO', '2026-04-01', '2026-03-31');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "X": q(OTHER), "B": q(B), "B2": q(B2), "B3": q(B3)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;")
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    # the book: ledgers as Tally's list has them; entries naming them as the Day Book does (staging's GB TEXCOAT shapes)
    for n, g, o in (("Cash", "g-cash", -1000), ("Capital", "g-cap", 1000), ("Input CGST", "g-icgst", 0), ("Purchase@18%", "g-p18", 0), ("UFLEX  LIMITED", "g-uflex", 0), ("Old Party", "g-old", 0),
                    ("Twin A B", "g-ta", 0), ("TwinAB", "g-tb", 0)):
        ledger(B, n, g, o)
    ledger(B, "Gone Ledger", "g-gone", 0, deleted=True)
    ledger(B, "Merged Twin", None, 0, merged="Cash")
    db.sql("insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid, confirmed_at) values (%s, %s, 'Party Renamed In Tally', 'Old Party', 'g-old', now()), (%s, %s, 'Ended Alias', 'Old Party', 'g-old', null)"
           % (q(B), q(F), q(B), q(F)))
    db.sql("update tally_ledger_aliases set ended_at = now() where tally_name = 'Ended Alias'")
    entry(B, "v1", "2026-05-01", [("Cash", -100), ("INPUT CGST", 18), ("PURCHASE @18%", 82)])
    entry(B, "v2", "2026-05-02", [("Cash", -50), ("UFLEX Limited", 50)], party="UFLEX Limited")
    entry(B, "v3", "2026-05-03", [("Cash", -30), ("Missing A", 10), ("Party Renamed In Tally", 10), ("Gone Ledger", 10)])
    entry(B, "v4", "2026-05-04", [("Cash", -20), ("Ended Alias", 10), ("Merged Twin", 5), ("twin ab", 5)])
    entry(B, "v5", "2026-05-05", [("Cash", -5), ('Bad "Q" Name', 5)])
    entry(B, "v6", "2026-05-06", [("Cash", -9), ("Only In Deleted", 9)], deleted=True)

    n0, nf = counts(), int(db.one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace"))
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 89 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    # run_migration90.py runs these checks again with migration 90's tally_ledger_fetch_plan in force (M89_THEN)
    for extra in [x for x in (os.environ.get("M89_THEN") or "").split(os.pathsep) if x]:
        r = psql_text(open(extra).read())
        ok(r.returncode == 0, "0. then %s runs %s" % (os.path.basename(extra), (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    c = counts()
    ok(all(c.get(k) == v for k, v in n0.items()) and c.get("tally_ledger_fetch") == 0 and c.get("tally_ledger_rename_holds") == 0, "0. nothing removed or changed by running it twice (%s)" % {k: v for k, v in c.items() if n0.get(k) != v})
    nf2 = int(db.one("select count(*) from pg_proc where pronamespace = 'public'::regnamespace"))
    ok(nf2 == nf + 3, "0. three functions added (%d -> %d)" % (nf, nf2))

    # ---------------------------------------------------------------- 1. the names
    p = plan(room=20)
    want = sorted(["Ended Alias", "Gone Ledger", "Merged Twin", "Missing A", "twin ab"])
    ok(p.get("ok") is True and p.get("names") == want and p.get("full") is False and p.get("missing") == 6,
       "1. the live entries' unknown names, sorted; the quoted name counted (6) but never named (%s)" % p)
    ok("Cash" not in p["names"] and "INPUT CGST" not in p["names"] and "PURCHASE @18%" not in p["names"] and "UFLEX Limited" not in p["names"],
       "1. the same ledger in other capitals or spaces (INPUT CGST / Input CGST, PURCHASE @18% / Purchase@18%, UFLEX Limited / UFLEX  LIMITED): held, not wanted")
    ok("Party Renamed In Tally" not in p["names"] and "Ended Alias" in p["names"], "1. a name of tally_ledger_aliases (Tally renamed it): held; an ended alias: not held")
    ok("Gone Ledger" in p["names"] and "Merged Twin" in p["names"], "1. a ledger marked deleted, or a merged twin: not held (wanted)")
    ok("twin ab" in p["names"], "1. two live ledgers with the same loose name (Twin A B, TwinAB): neither taken for 'twin ab' (as the app)")
    ok("Only In Deleted" not in json.dumps(p), "1. a deleted entry's ledger: never wanted")
    ok('Bad "Q" Name' not in p["names"], "1. a name with a quote mark (the bridge cannot ask it by name): never named")
    p2 = plan(room=2, at=at(1))
    ok(p2.get("names") == want[:2], "1. at most the room left (2): %s" % p2.get("names"))
    p0 = plan(room=0, at=at(2))
    ok(p0.get("names") == [] and p0.get("full") is False, "1. no room (held lines took the 20): no names (%s)" % p0)

    # ---------------------------------------------------------------- 3. rounds by name, then the full list
    db.sql("update tally_ledger_fetch set rounds = 0, round_at = null, names_key = '' where book_id = %s" % q(B))
    r1 = plan(at=at(0)); s1 = state()
    ok(r1["names"] == want and r1["rounds"] == 1 and not r1["full"], "3. round 1 (%s)" % r1)
    r1b = plan(at=at(5))
    ok(r1b["rounds"] == 1 and r1b["names"] == want, "3. a beat 5 minutes later: still round 1 (beats every 30 s count once a 10 minutes)")
    r2 = plan(at=at(10)); r3 = plan(at=at(20))
    ok(r2["rounds"] == 2 and r3["rounds"] == 3 and not r3["full"] and r3["names"] == want, "3. rounds 2 and 3, still by name (%s, %s)" % (r2["rounds"], r3["rounds"]))
    r4 = plan(at=at(30))
    ok(r4["full"] is True and r4["names"] == [] and "3 rounds" in r4.get("why", "") and state()["full_n"] == 1, "3. still missing after 3 rounds: the full list asked once, no names (%s)" % r4)
    r5 = plan(at=at(45))
    ok(r5["full"] is False and r5["names"] == [] and state()["full_n"] == 1, "3. 15 minutes later: not asked again (30-minute limit), and nothing by name (%s)" % r5)
    r6 = plan(at=at(61))
    ok(r6["full"] is True and state()["full_n"] == 2, "3. 31 minutes after: asked again (%s)" % r6)
    db.sql("update tally_ledgers set deleted_at = null where book_id = %s and name = 'Gone Ledger'" % q(B))
    r7 = plan(at=at(62))
    ok(r7["full"] is False and r7["rounds"] == 1 and "Gone Ledger" not in r7["names"] and len(r7["names"]) == 4, "3. a ledger came in: the names changed, the rounds start again (%s)" % r7)

    # ---------------------------------------------------------------- 4. paused / stopped
    before = state()
    pz = plan(at=at(200), paused=True)
    ok(pz.get("paused") is True and pz.get("names") == [] and pz.get("full") is False and state() == before, "4. paused or stopped: nothing answered, nothing recorded (%s)" % pz)

    # ---------------------------------------------------------------- 2. more than 20 missing
    ledger(B2, "Cash", "g2-cash")
    entry(B2, "w1", "2026-05-01", [("Cash", -25)] + [("New Ledger %02d" % i, 1) for i in range(25)])
    m1 = plan(book=B2, at=at(0))
    ok(m1["full"] is True and m1["names"] == [] and m1["missing"] == 21 and "more than 20" in m1.get("why", ""), "2. 25 missing (over 20): the full list instead of names (%s)" % m1)
    m2 = plan(book=B2, at=at(10))
    ok(m2["full"] is False and m2["names"] == [], "2. 10 minutes later: not again (30-minute limit), no names (%s)" % m2)
    m3 = plan(book=B2, at=at(31))
    ok(m3["full"] is True, "2. after 30 minutes: asked again (%s)" % m3)
    entry(B3, "x1", "2026-05-01", [("Anything", 1), ("Else", -1)])
    m4 = plan(book=B3, at=at(0))
    ok(m4["full"] is False and m4["names"] == ["Anything", "Else"], "2. a book with no ledger list: its names wanted (2 here) (%s)" % m4)

    # nothing missing: the state cleared
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'Anything', '', 0), (%s, %s, 'Else', '', 0)" % (q(B3), q(F), q(B3), q(F)))
    m5 = plan(book=B3, at=at(5))
    ok(m5["names"] == [] and m5["missing"] == 0 and state(B3)["rounds"] == 0 and state(B3)["names"] == "[]", "1. nothing missing: no names, the state cleared (%s; %s)" % (m5, state(B3)))

    # ---------------------------------------------------------------- 5. the rename
    rn = lambda guid, frm, to: json.loads(db.one("select public.tally_ledger_rename_from_tally(%s, %s, %s, %s)::text" % (q(B), q(guid), q(frm), q(to))))
    entry(B, "v7", "2026-06-01", [("Old Party", 500), ("Cash", -500)], party="Old Party")
    db.sql("insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid, confirmed_at) values (%s, %s, 'New Party', 'Old Party', 'g-old', now())" % (q(B), q(F)))
    tb0, k0 = tb(), counts()
    r = rn("g-old", "Old Party", "New Party")
    al = {x["tally_name"]: x for x in db.rows("select tally_name, fincom_name, tally_guid, coalesce(confirmed_at::text, '') as c, coalesce(ended_at::text, '') as e from tally_ledger_aliases where book_id = %s" % q(B))}
    ok(r.get("renamed") is True and r.get("aliasKept") == "Old Party", "5. renamed by its Tally GUID (%s)" % r)
    ok(db.one("select count(*) from tally_ledgers where book_id = %s and name = 'New Party' and tally_guid = 'g-old'" % q(B)) == "1" and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Old Party'" % q(B)) == "0",
       "5. FinCom's ledger has Tally's new name, the same GUID; no row left under the old name")
    ok(db.one("select count(*) from tally_lines where book_id = %s and ledger = 'Old Party'" % q(B)) == "0" and db.one("select count(*) from tally_lines where book_id = %s and ledger = 'New Party'" % q(B)) == "1"
       and db.one("select party from tally_vouchers where book_id = %s and guid = 'v7'" % q(B)) == "New Party", "5. the lines and the entry's party follow the name")
    ok(tb() == tb0, "5. the trial balance unchanged (%s -> %s)" % (tb0, tb()))
    ok(al.get("Old Party", {}).get("fincom_name") == "New Party" and al["Old Party"]["tally_guid"] == "g-old" and al["Old Party"]["c"] and not al["Old Party"]["e"],
       "5. the old name kept as an alias (Old Party -> New Party, the GUID, confirmed, not ended) (%s)" % al.get("Old Party"))
    ok(al.get("Party Renamed In Tally", {}).get("fincom_name") == "New Party" and al.get("New Party", {}).get("e"),
       "5. an alias pointing at the old name follows it; the 2.3.1 alias New Party -> Old Party ended (%s; %s)" % (al.get("Party Renamed In Tally"), al.get("New Party")))
    p8 = plan(at=at(300))
    ok("Old Party" not in p8["names"] and "Party Renamed In Tally" not in p8["names"], "5. neither name wanted afterwards (%s)" % p8["names"])
    k1 = counts()
    r = rn("g-cash", "Cash", "Capital")
    ok(r.get("renamed") is False and r.get("refused") is True and counts() == k1 and db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Cash'" % q(B)) == "1",
       "5. onto a name another ledger has: refused in words, nothing changed (%s)" % r.get("note"))
    r = rn("g-nope", "Old Party", "X")
    ok(r.get("renamed") is False and counts() == k1, "5. a GUID FinCom does not hold under that name: nothing (%s)" % r.get("note"))

    # ---------------------------------------------------------------- 6. the trial balance would change: nothing changed, held with words
    ledger(B, "Broken Party", "g-broken")
    entry(B, "v8", "2026-06-02", [("Broken Party", 70), ("Cash", -70)], party="Broken Party")
    db.sql("""create or replace function test_break_tb() returns trigger language plpgsql as $$ begin new.amount := new.amount + 1; return new; end $$;
              create trigger test_break_tb before insert on tally_ledger_day for each row when (new.ledger = 'Broken New') execute function test_break_tb();""")
    tb1, k2 = tb(), counts()
    snap = lambda: (db.rows("select name, tally_guid from tally_ledgers where book_id = %s order by name" % q(B)), db.rows("select guid, ledger, amount::text from tally_lines where book_id = %s order by guid, ledger" % q(B)),
                    db.rows("select ledger, day::text, amount::text, coalesce(merged_into, '') as m from tally_ledger_day where book_id = %s order by ledger, day" % q(B)),
                    db.rows("select tally_name, fincom_name, coalesce(ended_at::text, '') as e from tally_ledger_aliases where book_id = %s order by tally_name" % q(B)))
    s0 = snap()
    r = rn("g-broken", "Broken Party", "Broken New")
    h = db.rows("select from_name, to_name, words, tries::int as tries, coalesce(settled_at::text, '') as s from tally_ledger_rename_holds where book_id = %s" % q(B))
    ok(r.get("ok") is False and r.get("renamed") is False and r.get("held") is True and "trial balance" in r.get("words", ""), "6. refused: the trial balance would change, said in words (%s)" % r.get("words"))
    ok(snap() == s0 and tb() == tb1 and {k: v for k, v in counts().items() if k != "tally_ledger_rename_holds"} == {k: v for k, v in k2.items() if k != "tally_ledger_rename_holds"},
       "6. NOTHING changed: ledgers, lines, day cache, aliases as they were (never half-applied)")
    ok(len(h) == 1 and h[0]["to_name"] == "Broken New" and int(h[0]["tries"]) == 1 and "Broken Party" in h[0]["words"] and not h[0]["s"], "6. the case kept with words (tally_ledger_rename_holds) (%s)" % h)
    rn("g-broken", "Broken Party", "Broken New")
    h = db.rows("select tries::int as tries from tally_ledger_rename_holds where book_id = %s" % q(B))
    ok(len(h) == 1 and int(h[0]["tries"]) == 2, "6. again: the same open row, tries 2 (%s)" % h)
    db.sql("drop trigger test_break_tb on tally_ledger_day")      # the throwaway database's own test trigger
    r = rn("g-broken", "Broken Party", "Broken New")
    h = db.rows("select coalesce(settled_at::text, '') as s from tally_ledger_rename_holds where book_id = %s" % q(B))
    ok(r.get("renamed") is True and h[0]["s"] and tb() == tb1, "6. once the rename goes through, the held case is settled (%s)" % h)

    # ---------------------------------------------------------------- 7. privileges
    fx = lambda role, sig: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(sig)))
    for sig in ("public.tally_ledger_fetch_plan(uuid, text, boolean, integer, timestamptz)", "public.tally_ledger_rename_from_tally(uuid, text, text, text)"):
        ok(fx("service_role", sig) == "true" and fx("anon", sig) == "false" and fx("authenticated", sig) == "false", "7. %s: the service role only" % sig.split("(")[0])
        prop = db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = %s::regprocedure" % q(sig))
        ok(prop == "true search_path=public, pg_temp", "7. %s: security definer, search_path public, pg_temp (%s)" % (sig.split("(")[0], prop))
    for t in ("tally_ledger_fetch", "tally_ledger_rename_holds"):
        ok(privs("authenticated", t) == ["SELECT"] and privs("anon", t) == [] and db.one("select relrowsecurity::text from pg_class where oid = %s::regclass" % q("public." + t)) == "true",
           "7. %s: row security on, members read only, anon nothing (%s)" % (t, privs("authenticated", t)))
    ok(db.one("set role authenticated; select count(*) from tally_ledger_fetch", OWNER) != "0" and db.one("set role authenticated; select count(*) from tally_ledger_fetch", OTHER) == "0", "7. a member reads only the firm's own rows")
    try:
        db.one("select set_config('fincom.role', 'authenticated', false); select public.tally_ledger_fetch_plan(%s, 'ZZ CO')::text" % q(B)); ok(False, "7. not the service role: refused")
    except RuntimeError as e:
        ok("not allowed" in str(e), "7. not the service role: refused (%s)" % str(e).strip().split("\n")[0][-80:])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
