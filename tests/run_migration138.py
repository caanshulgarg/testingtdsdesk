"""python3 run_migration138.py - migration-138-openings-decide (02-Nov-2026, next-tally-simple; the owner's approved line about
opening balances on the simple Tally page). One function, tally_openings_decide(book, action), for the firm's signed-in
members. On a throwaway PostgreSQL (pg_stand, port 31138; never a real database), built as run_migration130.py builds it,
with 130 run and tally_opening_repairs made as it is on staging. Made-up firms, books and ledgers only. Checks:
  0. the file: one transaction (lock_timeout 10 s), add-only (one function: no table made or altered, no delete, drop or
     truncate), names no real database; runs twice; grants: authenticated and service_role, nothing for anon.
  1. same: FinCom's openings tie and nothing from Tally waits (status of every book of the firm, p_book null).
  2. differ: a held row dated the books' first day: how many ledgers differ and by how much; the list (ledger, FinCom,
     Tally, difference); Use Tally's (owner): each change written to tally_opening_repairs (before and after, who), open
     and open_sent set, the held rows (and the batch rows of the same round) marked applied, the books' ledgers_at moved;
     then same.
  3. Keep FinCom's (staff): the held rows marked dismissed with who and when; nothing else changes; never a row deleted.
  4. do not balance: FinCom's own openings do not net to nil (the difference).
  5. Use Tally's refused, in plain words, when: undated or dated another day; they do not balance; a ledger is not in
     FinCom; an income or expense ledger would change. Nothing changes.
  6. who: a viewer sees, but neither uses nor keeps; another firm's book is not allowed; anon cannot call it.
RED_WITHOUT_138=1: the same checks without the file (they fail)."""
import os, re, sys, json, hashlib, subprocess, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-130-opening-guards.sql")]
M138 = os.environ.get("M138_FILE") or os.path.join(SQLDIR, "migration-138-openings-decide.sql")
RED = os.environ.get("RED_WITHOUT_138") == "1"
# tally_opening_repairs as it is on staging (made there 30-Oct-2026 for the openings put right by hand)
REPAIRS = """create table if not exists public.tally_opening_repairs (id bigserial primary key, at timestamptz not null default now(), book_id uuid, ledger text,
  open_before numeric, open_sent_before numeric, open_after numeric, why text);
revoke all on public.tally_opening_repairs from public, anon, authenticated; grant select, insert, update on public.tally_opening_repairs to service_role;"""
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999138", "88888888-8888-8888-8888-888888888138"
OWNER, STAFF, VIEWER, OTHER = ("a0000000-0000-4000-8000-0000000001%02d" % i for i in (1, 2, 3, 4))
SAME, DIFF, KEEP, UNBAL, BAD, OTHERB = ("819d4a59-4cee-4bf7-8f8c-0000000138%02d" % i for i in range(1, 7))

text = open(M138).read() if os.path.exists(M138) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M138))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M138), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1 and code.count("commit;") == 1, "0. one transaction, lock_timeout 10 s")
ok("delete from" not in code and not re.search(r"\b(drop|truncate)\b", code) and not re.search(r"\b(alter|create)\s+table\b", code), "0. add-only: no table made or altered, no delete, drop or truncate")
ok(not re.search(r"supabase\.co|\.supabase\.|qbocskaiewaxqcvaunzc|https?://", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_openings_decide"], "0. one function (%s)" % FNS)
ok("security definer" in low and "my_firm()" in low and re.search(r"m\.role in \('owner', 'staff'\)", low), "0. security definer, the firm check (my_firm) and the member's role for a change")
ok(re.search(r"revoke all on function public\.tally_openings_decide\(uuid, text\) from public, anon;", text) and re.search(r"grant execute on function public\.tally_openings_decide\(uuid, text\) to authenticated, service_role;", text), "0. explicit grants")

db = pg_stand.start(int(os.environ.get("PG138_PORT") or 31138))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None, role="authenticated"):
    pre = ("set fincom.role = %s;\n" % q(role)) if role else ""
    try: x = db.one(pre + s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def D(book, action, uid=OWNER): return j("select tally_openings_decide(%s, %s)::text" % ("null" if book is None else q(book), q(action)), uid)
def status(book, uid=OWNER):
    r = D(None, "status", uid)
    return next((x for x in (r.get("books") or []) if x.get("book") == book), {}) if isinstance(r, dict) else {}
def led(book): return {r["name"]: (float(r["open"]), None if r["open_sent"] in (None, "") else float(r["open_sent"])) for r in db.rows("select name, open, open_sent from tally_ledgers where book_id = %s and deleted_at is null" % q(book))}
def held(book): return db.rows("select id, stage, why, settled_at::text as settled from tally_openings_held where book_id = %s order by id" % q(book))
def repairs(book): return db.rows("select ledger, open_before::float as b, open_sent_before::float as sb, open_after::float as a, why from tally_opening_repairs where book_id = %s order by id" % q(book))
def seed(book, firm, rows):
    db.sql("".join("insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, chain, primary_group) values (%s, %s, %s, %s, %s, %s, %s, %s);" % (
        q(book), q(firm), q(n), q(p), v, v, q("{" + p + "}"), q(p)) for n, p, v in rows))
def hold(book, firm, rows, at, stage="held", why="they do not add up to nil"):
    return db.one("insert into tally_openings_held (book_id, firm_id, source, round, openings_at, rows, stage, why, diff, settled_at) values (%s, %s, 'the bridge''s ledger read', 'r1', %s, %s, %s, %s, 0, now()) returning id" % (
        q(book), q(firm), "null" if at is None else q(at), js(rows), q(stage), q(why)))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("""insert into firms values (%(F)s, 'Made-up Firm'), (%(F2)s, 'Other made-up firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);""" % {
        "F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEWER), "X": q(OTHER)})
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on, ledgers_at) values " + ", ".join(
        "(%s, %s, %s, %s, '2025-04-01', '2025-03-31', '2026-10-01T00:00:00Z')" % (q(b), q(F2 if b == OTHERB else F), q("c%d" % i), q("MADE UP %d" % i)) for i, b in enumerate((SAME, DIFF, KEEP, UNBAL, BAD, OTHERB), 1)) + ";")
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql(REPAIRS)
    if not RED:
        for i in (1, 2):
            r = psql_text(text)
            ok(r.returncode == 0, "138 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
    sig = db.one("select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_openings_decide'") or ""
    ex = lambda rl: db.one("select has_function_privilege(%s, %s, 'execute')" % (q(rl), q(sig))) in ("t", "true") if sig else None
    ok(ex("authenticated") and ex("service_role") and ex("anon") is False, "0. execute: authenticated and service_role, not anon")
    print("  md5(prosrc) tally_openings_decide: %s" % db.one("select md5(prosrc) from pg_proc where proname = 'tally_openings_decide'"))

    BAL = [("Cash", "Cash-in-Hand", -500), ("Capital", "Capital Account", 500), ("Party", "Sundry Debtors", 0), ("Rent", "Indirect Expenses", 0)]
    print("== 1. same")
    seed(SAME, F, BAL)
    s = status(SAME)
    ok(s.get("ties") is True and s.get("nonzero") == 2 and s.get("held") is None and float(s.get("stored")) == 0, "1. ties, nothing waiting from Tally (%s)" % s)
    all_books = [x.get("book") for x in (D(None, "status").get("books") or [])]
    ok(OTHERB not in all_books and SAME in all_books and "rows" not in json.dumps(D(None, "status")), "1. status: the firm's own books only, without the lists (%s)" % all_books)

    print("== 2. differ, then Use Tally's")
    seed(DIFF, F, BAL)
    h0 = hold(DIFF, F, [["Cash", -900]], "2025-04-01", why="part of the round held in row X")
    h1 = hold(DIFF, F, [["Cash", -900], ["Capital", 900], ["Party", 0]], "2025-04-01")
    s = status(DIFF)
    ok(str(s.get("held")) == str(h1) and s.get("n") == 2 and float(s.get("total")) == 800 and s.get("dated") is True and float(s.get("candidate")) == 0 and s.get("missing") == 0 and s.get("pl") == 0,
       "2. the newest held row: 2 ledgers differ, 800 in all, dated the books' first day, would tie (%s)" % s)
    L = D(DIFF, "list", VIEWER)
    rows = (L.get("book") or {}).get("rows") or []
    ok(L.get("ok") and [(r["ledger"], float(r["fincom"]), float(r["tally"]), float(r["diff"])) for r in rows] == [("Capital", 500, 900, 400), ("Cash", -500, -900, -400)], "2. the list: ledger, FinCom, Tally, difference (a member may read it) (%s)" % rows)
    la0 = db.one("select ledgers_at::text from tally_books where book_id = %s" % q(DIFF))
    u = D(DIFF, "use", OWNER)
    ok(u.get("ok") and u.get("changed") == 2 and led(DIFF)["Cash"] == (-900, -900) and led(DIFF)["Capital"] == (900, 900) and led(DIFF)["Party"] == (0, 0), "2. Use Tally's: open and open_sent set (%s; %s)" % (u, led(DIFF)))
    R = repairs(DIFF)
    ok(sorted((r["ledger"], float(r["b"]), float(r["sb"]), float(r["a"])) for r in R) == [("Capital", 500, 500, 900), ("Cash", -500, -500, -900)] and all(OWNER in r["why"] and "Use Tally" in r["why"] for r in R), "2. each change in tally_opening_repairs, before and after, who (%s)" % R)
    H = held(DIFF)
    ok(len(H) == 2 and all(x["stage"] == "applied" and x["why"].startswith("Used by " + OWNER) and x["settled"] for x in H), "2. the held rows (and the round's batch row) marked applied, who and when (%s)" % [(x["stage"], x["why"][:60]) for x in H])
    ok(db.one("select ledgers_at::text from tally_books where book_id = %s" % q(DIFF)) != la0, "2. the books' ledgers_at moved on (browsers read the ledgers again)")
    s = status(DIFF)
    ok(s.get("held") is None and s.get("ties") is True, "2. then: nothing waiting, ties (same as Tally) (%s)" % s)
    ok(D(DIFF, "use").get("ok") is False and "Nothing from Tally is waiting" in D(DIFF, "use").get("error", ""), "2. Use again: nothing waiting, said plainly")

    print("== 3. Keep FinCom's")
    seed(KEEP, F, BAL)
    hold(KEEP, F, [["Cash", -900], ["Capital", 900]], "2025-04-01")
    before, n0 = led(KEEP), db.one("select count(*) from tally_openings_held")
    k = D(KEEP, "keep", STAFF)
    H = held(KEEP)
    ok(k.get("ok") and k.get("kept") == 1 and H[0]["stage"] == "kept" and H[0]["why"].startswith("Dismissed by " + STAFF) and "IST (Keep FinCom's)" in H[0]["why"] and "they do not add up to nil" in H[0]["why"],
       "3. kept: marked dismissed with who and when, its reason kept (%s)" % H)
    ok(led(KEEP) == before and not repairs(KEEP) and db.one("select count(*) from tally_openings_held") == n0, "3. nothing else changed; no row deleted")
    ok(status(KEEP).get("held") is None, "3. then: nothing waiting")

    print("== 4. do not balance")
    seed(UNBAL, F, [("Cash", "Cash-in-Hand", -500), ("Capital", "Capital Account", 400)])
    s = status(UNBAL)
    ok(s.get("ties") is False and float(s.get("stored")) == -100 and s.get("held") is None, "4. FinCom's own openings differ by 100 (%s)" % s)

    print("== 5. Use Tally's refused")
    seed(BAD, F, BAL)
    def refused(rows, at, words):
        db.sql("update tally_openings_held set stage = 'kept', why = 'Dismissed by test: ' || why where book_id = %s and why not like 'Dismissed by %%'" % q(BAD))
        hold(BAD, F, rows, at); b = led(BAD); r = D(BAD, "use")
        return r.get("ok") is False and words in r.get("error", "") and led(BAD) == b and not repairs(BAD), r
    c, r = refused([["Cash", -900], ["Capital", 900]], None, "not dated"); ok(c, "5. undated: refused (%s)" % r)
    c, r = refused([["Cash", -900], ["Capital", 900]], "2026-04-01", "dated 01-Apr-2026, not 01-Apr-2025"); ok(c, "5. dated another day: refused (%s)" % r)
    c, r = refused([["Cash", -128000]], "2025-04-01", "do not balance: debit and credit differ by 1,27,500.00 Dr"); ok(c, "5. they do not balance: refused, the difference said (%s)" % r)
    c, r = refused([["Cash", -900], ["Made-up New Ledger", 400], ["Capital", 500]], "2025-04-01", "not in FinCom yet"); ok(c, "5. a ledger not in FinCom: refused (%s)" % r)
    c, r = refused([["Cash", -600], ["Rent", 100]], "2025-04-01", "income or expense ledgers"); ok(c, "5. an expense ledger would change: refused (%s)" % r)

    print("== 6. who")
    seed(OTHERB, F2, BAL); hold(OTHERB, F2, [["Cash", -900], ["Capital", 900]], "2025-04-01")
    hold(SAME, F, [["Cash", -700], ["Capital", 700]], "2025-04-01")
    ok("not allowed" in str(D(SAME, "use", VIEWER)) and "not allowed" in str(D(SAME, "keep", VIEWER)) and status(SAME, VIEWER).get("n") == 2, "6. a viewer sees, but neither uses nor keeps")
    ok("not allowed" in str(D(OTHERB, "list")) and "not allowed" in str(D(OTHERB, "keep")) and led(OTHERB)["Cash"] == (-500, -500), "6. another firm's book: not allowed")
    ok("not allowed" in str(D(None, "status", None)), "6. nobody signed in: not allowed")
    ok("action is" in str(D(SAME, "drop")), "6. an unknown action: refused")
finally:
    db.stop(); shutil.rmtree(db.data, ignore_errors=True)
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
