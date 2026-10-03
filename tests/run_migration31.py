"""python3 run_migration31.py - migration-31 (finding 4, 02-Oct-2026): the names already kept in the cloud copy cleaned
once, adding only. On a throwaway PostgreSQL (pg_stand), with the cloud tables as on staging and made-up rows: an
entry's ledger with a line break read as two spaces ("Orchid Lane Hospitality Pvt Ltd  (Noida)") beside its master,
an entity in a master's name, two masters with one key, a twin merged before (migration-9), a group named with two
spaces, and day totals of two names on one day (the key (book_id, ledger, day) would clash).
Checks: the SQL rule is names.js's (the same names, cleaned by both); nothing is deleted; the sums stay; the twin is
kept and merged; the checks at its end return nothing; a second run changes nothing; a problem undoes everything."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQL = os.path.join(HERE, "..", "server", "tally-cloud", "migration-31-clean-names.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the cloud tables as on staging (information_schema, 02-Oct-2026), without the parts this does not touch
SCHEMA = """
drop table if exists tally_books, tally_ledgers, tally_groups, tally_vouchers, tally_lines, tally_bills, tally_ledger_day cascade;
create table tally_books (book_id uuid primary key, firm_id uuid not null, client_id text not null, company text not null, from_date date, open_as_on date,
  ledgers_at timestamptz, days_at timestamptz, state jsonb not null default '{}', state_at timestamptz);
create table tally_ledgers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '',
  open numeric not null default 0, chain text[] not null default '{}', primary_group text not null default '', open_sent numeric, merged_into text, gstin text, pan text,
  primary key (book_id, name));
create table tally_groups (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, name text not null, parent text not null default '', primary key (book_id, name));
create table tally_vouchers (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, alter_id bigint not null default 0,
  vtype text not null default '', vno text not null default '', party text not null default '', narration text not null default '', cancelled boolean not null default false,
  optional boolean not null default false, gstin text not null default '', pos text not null default '', ref text not null default '', ref_date date, cmp_gstin text not null default '',
  primary key (book_id, guid));
create table tally_lines (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, ledger text not null,
  amount numeric not null, hsn text not null default '', rate numeric);
create index tally_lines_ledger on tally_lines (book_id, ledger, day);
create table tally_bills (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, guid text not null, day date not null, ledger text not null,
  name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);
create table tally_ledger_day (book_id uuid not null references tally_books on delete cascade, firm_id uuid not null, ledger text not null, day date not null,
  amount numeric not null default 0, dr numeric not null default 0, cr numeric not null default 0, n integer not null default 0, primary key (book_id, ledger, day));
"""
B1, B2, F = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "99999999-9999-9999-9999-999999999999"
OR1, OR2 = "Orchid Lane Hospitality Pvt Ltd (Noida)", "Orchid Lane Hospitality Pvt Ltd  (Noida)"
def q(s): return "'" + s.replace("'", "''") + "'"
def rows_sql():
    out = ["insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%s, %s, 'c1', 'CO ONE', '2025-04-01'), (%s, %s, 'c2', 'CO TWO', '2025-04-01');" % (q(B1), q(F), q(B2), q(F))]
    led = [  # book, name, parent, open, open_sent, merged_into, chain
        (B1, OR1, "Sundry Debtors", 0, 0, None, ["Sundry Debtors"]),
        (B1, "Arktos  Control & Instruments", "Sundry Debtors", 0, 0, None, ["Sundry Debtors"]),
        (B1, "MCS Project Pvt Ltd", "Sundry Debtors", 6000, 0, None, ["Sundry Debtors"]),
        (B1, "MCS Project Pvt Ltd&#13;&#10;", "", 0, 6000, "MCS Project Pvt Ltd", []),            # a twin merged before (migration-9)
        (B1, "R &amp; D Services", "", 50, 50, None, []),                                         # an entity, and its twin clean
        (B1, "R & D Services", "Sundry Creditors", 25, 25, None, ["Sundry Creditors"]),
        (B1, "Harshwardhan Malik", "", 5, 5, None, []),                                           # one key, two spellings
        (B1, "Harshwardhan  Malik", "Clean Club", 10, 10, None, ["Clean Club", "Sundry Debtors"]),
        (B1, "Sales", "Sales Accounts", 0, 0, None, ["Sales Accounts"]),
        (B1, "Bank", "Bank Accounts", 0, 0, None, ["Bank Accounts"]),
        (B1, "Caf&#233; Ltd", "Sundry Debtors", 1, 1, None, ["Sundry Debtors"]),                  # a lone name to clean
        (B2, OR2, "Sundry Debtors", 7, 7, None, ["Sundry Debtors"]),                               # another book: its own
    ]
    for b, n, p, o, s, m, c in led:
        out.append("insert into tally_ledgers (book_id, firm_id, name, parent, open, open_sent, merged_into, chain, primary_group) values (%s, %s, %s, %s, %s, %s, %s, %s, %s);"
                   % (q(b), q(F), q(n), q(p), o, s, "null" if m is None else q(m), "array[%s]::text[]" % ",".join(q(x) for x in c), q(c[-1] if c else "")))
    for b, n, p in [(B1, "Sundry Debtors", ""), (B1, "Sundry Creditors", ""), (B1, "Clean  Club", "Sundry Debtors"), (B1, "Sales Accounts", ""), (B1, "Bank Accounts", ""),
                    (B1, "Clean Club&#13;&#10;", "Sundry Debtors&#13;&#10;")]:
        out.append("insert into tally_groups (book_id, firm_id, name, parent) values (%s, %s, %s, %s);" % (q(b), q(F), q(n), q(p)))
    vch = [  # book, guid, day, party, cancelled, lines
        (B1, "g1", "2025-07-17", OR2, False, [(OR2, -89800), ("Sales", 89800)]),
        (B1, "g2", "2025-07-17", OR1, False, [(OR1, -1000), ("Sales", 1000)]),
        (B1, "g3", "2025-07-18", "R &amp; D Services", False, [("R &amp; D Services", 500), ("Bank", -500)]),
        (B1, "g4", "2025-07-18", "Arktos  Control & Instruments", False, [("Arktos  Control & Instruments", -4720), ("Sales", 4720)]),
        (B1, "g5", "2025-07-19", OR2, True, [(OR2, -10), ("Sales", 10)]),                         # cancelled: no day total
        (B1, "g6", "2025-07-19", "Harshwardhan Malik", False, [("Harshwardhan Malik", -300), ("harshwardhan  malik", -200), ("Sales", 500)]),
        (B2, "h1", "2025-07-17", OR1, False, [(OR1, -5), ("Sales", 5)]),                          # book 2: the master has two spaces
    ]
    for b, g, d, p, c, ls in vch:
        out.append("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, cancelled) values (%s, %s, %s, %s, 'Sales', %s, %s, %s);" % (q(b), q(F), q(g), q(d), q(g), q(p), "true" if c else "false"))
        for l, a in ls:
            out.append("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, %s, %s, %s, %s);" % (q(b), q(F), q(g), q(d), q(l), a))
    out.append("insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount) values (%s, %s, 'g1', '2025-07-17', %s, 'INV-1', 'New Ref', -89800);" % (q(B1), q(F), q(OR2)))
    # the day totals as tally_ingest_day builds them
    out.append("""insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
      select l.book_id, l.firm_id, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
        from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where not v.cancelled and not v.optional group by 1, 2, 3, 4;""")
    return "\n".join(out)

def body():
    s = open(SQL).read()
    return s[s.index("\nbegin;") + 1:]
def run(db):
    # the whole file, as the owner would run it (psql, stop at the first error); the rows the checks return
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                        "-v", "ON_ERROR_STOP=1", "-q", "--csv", "-P", "footer=off"], input=body(), capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stdout + r.stderr)
    # the rows the checks return (the header alone when there are none)
    return "\n".join(l for l in r.stdout.splitlines() if l.strip() and l.strip() != "problem,book,detail")
def dump(db):
    return {t: db.rows("select * from %s order by 1, 2, 3, 4" % t) for t in ["tally_ledgers", "tally_groups", "tally_vouchers", "tally_lines", "tally_bills", "tally_ledger_day"]}

db = pg_stand.start(55441)
try:
    db.sql(SCHEMA); db.sql(rows_sql())

    # 0. the SQL rule is names.js's
    names = [OR2, "Orchid Lane Hospitality Pvt Ltd&#13;&#10;(Noida)", "Kashi IT&#10;Solutions", "MCS Project Pvt Ltd\r\n", "Rakvik Tech\r\nPrivate Limited",
             "RAKVIK TECHNOLOGIES PRIVATE LIMITED&amp;#13;&amp;#10;&amp;#13;&amp;#10;", "R &amp; D Services", "&#4; Primary", "   Leading And Trailing   ",
             "Arktos  Control &amp; Instruments", "Elen  Blossoms &#13;&#10;  and Greens Ltd", "Yellow Media Pvt. Ltd", "Shree &quot;Ganesh&quot; &apos;Traders&apos; &lt;Delhi&gt;",
             "Caf&#233; Rupee &#8377; Ltd", "A&#x41;B &#X2F; &NBSP;x&#9;y", "Tab\tinside", "&amp;amp;", "&#0; zero &#55296; half", "", "Profit & Loss A/c"]
    js = subprocess.run(["node", "--input-type=module", "-e",
        "import {namesClean, namesKey} from %s; const n = JSON.parse(process.argv[1]); console.log(JSON.stringify(n.map(x => [namesClean(x), namesKey(x)])));"
        % json.dumps("file://" + os.path.join(HERE, "..", "server", "_shared", "names.js")), json.dumps(names)], capture_output=True, text=True, check=True)
    want = json.loads(js.stdout)
    s = open(SQL).read()
    fns = s[s.index("create or replace function pg_temp.nm_num"):s.index("-- ---------- the new columns")]
    got = db.rows(fns + "\nselect pg_temp.nm_clean(x) c, pg_temp.nm_key(x) k from unnest(array[%s]::text[]) with ordinality u(x, i) order by i;" % ",".join(q(n) for n in names))
    bad = [(n, w, [g["c"], g["k"]]) for n, w, g in zip(names, want, got) if [g["c"], g["k"]] != w]
    ok(len(got) == len(names) and not bad, "the SQL rule gives names.js's clean names and keys (%d names)%s" % (len(names), "" if not bad else ": " + json.dumps(bad)))

    before = dump(db)
    out = run(db)
    ok(out.strip() == "", "the checks at its end return no rows (%r)" % out.strip()[:500])
    after = dump(db)
    ok(all(len(before[t]) == len(after[t]) for t in before), "nothing deleted, nothing added: " + ", ".join("%s %d" % (t, len(after[t])) for t in after))
    L = {(r["book_id"], r["name"]): r for r in after["tally_ledgers"]}
    def led(b, n): return L.get((b, n)) or {}
    ok(led(B1, "R & D Services").get("open") == "75" and led(B1, "R & D Services").get("merged_into") == "" and led(B1, "R & D Services").get("parent") == "Sundry Creditors",
       "two masters with one key: the clean one stands, with both openings (%s)" % json.dumps(led(B1, "R & D Services")))
    tw = led(B1, "R &amp; D Services")
    ok(tw.get("merged_into") == "R & D Services" and tw.get("open") == "0" and tw.get("open_sent") == "50" and json.loads(tw.get("before_clean") or "{}").get("open") == 50,
       "the twin keeps its row and name, opens at nil, merged into it, what it had noted (%s)" % json.dumps(tw))
    h = led(B1, "Harshwardhan  Malik")
    ok(h.get("open") == "15" and h.get("merged_into") == "" and led(B1, "Harshwardhan Malik").get("merged_into") == "Harshwardhan  Malik",
       "two spellings of one name: the one with a group stands (two spaces kept, Tally's name), the other merged (%s)" % json.dumps(h))
    ok(h.get("parent") == "Clean  Club" and h.get("chain") == "{\"Clean  Club\",\"Sundry Debtors\"}", "its group named as the group is (%s %s)" % (h.get("parent"), h.get("chain")))
    ok(led(B1, "MCS Project Pvt Ltd&#13;&#10;").get("merged_into") == "MCS Project Pvt Ltd" and led(B1, "MCS Project Pvt Ltd").get("open") == "6000", "a twin merged before stays as it was")
    c = led(B1, "Café Ltd")
    ok(c.get("raw_name") == "Caf&#233; Ltd" and c.get("open") == "1", "a lone master takes its clean name, the old one kept (%s)" % json.dumps(c))
    ok(led(B2, OR2).get("raw_name") == "" and led(B2, OR2).get("open") == "7", "another book's master with two spaces is left as Tally has it")
    G = {(r["book_id"], r["name"]): r for r in after["tally_groups"]}
    ok((B1, "Clean Club&#13;&#10;") in G and G[(B1, "Clean Club&#13;&#10;")]["parent"] == "Sundry Debtors" and G[(B1, "Clean  Club")]["raw_name"] == "",
       "groups: the one already clean stands; the other keeps its row, its parent cleaned")
    lines = after["tally_lines"]
    l1 = [r for r in lines if r["guid"] == "g1" and r["amount"] == "-89800"][0]
    ok(l1["ledger"] == OR1 and l1["raw_ledger"] == OR2, "an entry's ledger read with two spaces takes its master's name, the old one kept (%s)" % json.dumps(l1))
    ok([r["ledger"] for r in lines if r["guid"] == "g3" and r["amount"] == "500"] == ["R & D Services"], "an entity in an entry's ledger: the standing ledger's name")
    ok(sorted(r["ledger"] for r in lines if r["guid"] == "g6" and r["ledger"] != "Sales") == ["Harshwardhan  Malik", "Harshwardhan  Malik"], "two spellings in one entry: both the standing ledger's")
    ok([r["ledger"] for r in lines if r["guid"] == "g4" and r["amount"] == "-4720"] == ["Arktos  Control & Instruments"] and
       all(r["raw_ledger"] == "" for r in lines if r["guid"] == "g4"), "a name with two spaces Tally has is left alone")
    ok([r["ledger"] for r in lines if r["guid"] == "h1" and r["amount"] == "-5"] == [OR2], "book 2: its entry takes its own master's two spaces")
    V = {(r["book_id"], r["guid"]): r for r in after["tally_vouchers"]}
    ok(V[(B1, "g1")]["party"] == OR1 and V[(B1, "g1")]["raw_party"] == OR2 and V[(B1, "g5")]["party"] == OR1, "the entries' parties too")
    ok([(r["ledger"], r["raw_ledger"]) for r in after["tally_bills"]] == [(OR1, OR2)], "the bill-wise line too")
    D = {(r["book_id"], r["ledger"], r["day"]): r for r in after["tally_ledger_day"]}
    d1, d2 = D.get((B1, OR1, "2025-07-17")) or {}, D.get((B1, OR2, "2025-07-17")) or {}
    ok(d1.get("amount") == "-90800" and d1.get("dr") == "90800" and d1.get("n") == "2" and d1.get("merged_into") == "",
       "day totals of two names on one day: added into the clean name's row (%s)" % json.dumps(d1))
    ok(d2.get("amount") == "0" and d2.get("n") == "0" and d2.get("merged_into") == OR1 and json.loads(d2.get("before_clean") or "{}").get("amount") == -89800,
       "the other row kept, nil, merged into it, what it had noted (%s)" % json.dumps(d2))
    r1 = D.get((B1, "R & D Services", "2025-07-18")) or {}
    ok(r1.get("amount") == "500" and r1.get("raw_ledger") == "R &amp; D Services", "a day total whose clean name is free that day is renamed (%s)" % json.dumps(r1))
    hm = D.get((B1, "Harshwardhan  Malik", "2025-07-19")) or {}
    ok(hm.get("amount") == "-500" and hm.get("n") == "2", "two spellings on one day: one row of the standing ledger (%s)" % json.dumps(hm))
    sums = db.rows("select book_id, sum(amount) a from tally_ledger_day group by 1 order by 1")
    ok([(r["book_id"], r["a"]) for r in sums] == [(B1, "0"), (B2, "0")], "each book's day totals still add up (%s)" % json.dumps(sums))

    # twice: nothing changes, nothing returned
    out2 = run(db)
    again = dump(db)
    diff = [(t, i) for t in after for i, (x, y) in enumerate(zip(after[t], again[t])) if x != y]
    ok(out2.strip() == "" and not diff, "a second run changes nothing and returns no rows%s" % ("" if not diff else ": " + json.dumps([[after[t][i], again[t][i]] for t, i in diff[:3]])))

    # a problem undoes it all: a day total not its lines, on a day the clean-up touches
    db.sql(SCHEMA); db.sql(rows_sql())
    db.sql("update tally_ledger_day set amount = amount + 1 where ledger = 'Sales' and day = '2025-07-17' and book_id = '%s';" % B1)
    b3 = dump(db)
    try: run(db); raised = None
    except RuntimeError as e: raised = str(e)
    ok(raised and "a day total not its lines" in raised and "migration-31" in raised, "a problem is shown and stops it (%s)" % (raised or "")[-300:].replace("\n", " | "))
    ok(dump(db) == b3, "and nothing is changed")
finally:
    db.stop()
if fails: print("FAILED %d" % len(fails)); raise SystemExit(1)
print("all passed")
