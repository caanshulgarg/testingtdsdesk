"""python3 run_migration155.py - server/tally-cloud/migration-155-link-guid-fill.sql (10-Nov-2026, the owner: a link belongs
to the company and the firm, never to a person or a bridge). On a throwaway PostgreSQL (pg_stand, port 31555 unless
PG155_PORT; never a real database): the tables 155 reads stood in as migration 110 makes them, then 155 (twice). Made-up
rows only. Checks:
  0. the file: one transaction, lock_timeout 10 s; one function created, nothing dropped, altered or emptied; names no
     real database; the grant: service_role only
  1. a linked company with no GUID, listed open by a bridge's own record (the same name, another case): its GUID filled,
     lower case; device_id, computer and client untouched
  2. never over a GUID already there; never a GUID another linked book of the firm holds; never an unlinked row; never
     another firm's link; never from another bridge's record of the same key or a revoked key
  3. a name the record lists with two GUIDs: not filled
  4. the second run of 155 changes nothing; a second call fills nothing more
  5. (review B1) a book whose own recorded GUID (tally_sync_cursor) names another: not filled; the same: filled;
     (review B2) two linked books of the firm with the cleaned name: neither filled"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M155 = os.path.join(HERE, "..", "server", "tally-cloud", "migration-155-link-guid-fill.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

text = open(M155).read()
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, lock_timeout 10 s")
ok(re.findall(r"create (?:or replace )?function (\S+)\(", code) == ["public.tally_link_guid_fill"]
   and not re.search(r"\b(create table|alter table|drop (table|column|function|index)|truncate|delete from)\b", code), "0. one function; nothing created, dropped, altered or emptied")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "0. names no real database")
ok("grant execute on function public.tally_link_guid_fill(uuid, uuid, text) to service_role;" in text
   and "revoke all on function public.tally_link_guid_fill(uuid, uuid, text) from public, anon, authenticated;" in text, "0. the grant: service_role only")

F, F2 = "99999999-9999-9999-9999-999999999155", "99999999-9999-9999-9999-999999999156"
D, D2, DR = "dddddddd-0000-0000-0000-000000000155", "dddddddd-0000-0000-0000-000000000156", "dddddddd-0000-0000-0000-000000000157"
B = ["11111111-1111-1111-1111-11111111015%d" % i for i in range(8)] + ["11111111-1111-1111-1111-1111111101%d" % i for i in (60, 61, 62, 63)]
SCHEMA = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;
create or replace function public.tally_nm(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(p, ''), '[ \\t]*(&#13;|&#10;|\\r|\\n)+[ \\t]*', ' ', 'g')) $$;
create table if not exists tally_devices (id uuid primary key, firm_id uuid, name text, info jsonb, revoked boolean);
create table if not exists tally_links (firm_id uuid not null, book_id uuid not null, client_id text, company_guid text, company_name text,
  device_id uuid, computer text, state text not null default 'linked', primary key (firm_id, book_id));
create table if not exists tally_sync_cursor (book_id uuid primary key, company_guid text);
create unique index if not exists tally_links_guid_once on public.tally_links (firm_id, company_guid) where state = 'linked' and company_guid is not null;
"""
REC = {"go-aaaaaa155155": {"cos": [["ZZ ONE CO", "7A817F69-0000-4000-8000-000000000001"], ["ZZ HAS CO", "g-new-has"], ["ZZ TAKEN CO", "g-taken"],
                                    ["ZZ UNLINKED CO", "g-unl"], ["ZZ OTHER FIRM CO", "g-of"], ["ZZ TWICE CO", "g-t1"], ["zz twice co", "g-t2"],
                                    ["ZZ CURSOR OTHER CO", "g-cur-beat"], ["ZZ CURSOR SAME CO", "g-cur-same"], ["ZZ TWO BOOKS CO", "g-two"]]},
       "go-bbbbbb155155": {"cos": [["ZZ OTHER BRIDGE CO", "g-ob"]]}}
db = pg_stand.start(int(os.environ.get("PG155_PORT") or 31555))
try:
    db.sql(SCHEMA)
    db.sql("insert into tally_devices (id, firm_id, name, info, revoked) values (%s, %s, 'ZZ PC', %s::jsonb, false), (%s, %s, 'ZZ PC 2', %s::jsonb, true)"
           % (q(D), q(F), q(json.dumps({"bridges": REC})), q(DR), q(F), q(json.dumps({"bridges": {"go-aaaaaa155155": {"cos": [["ZZ REVOKED CO", "g-rv"]]}}}))))
    rows = [(F, B[0], "zz one co", None, "linked"), (F, B[1], "ZZ HAS CO", "g-old-has", "linked"), (F, B[2], "ZZ TAKEN CO", None, "linked"),
            (F, B[3], "ZZ HOLDER CO", "g-taken", "linked"), (F, B[4], "ZZ UNLINKED CO", None, "unlinked"), (F2, B[5], "ZZ OTHER FIRM CO", None, "linked"),
            (F, B[6], "ZZ TWICE CO", None, "linked"), (F, B[7], "ZZ OTHER BRIDGE CO", None, "linked"),
            (F, B[8], "ZZ CURSOR OTHER CO", None, "linked"), (F, B[9], "ZZ CURSOR SAME CO", None, "linked"),
            (F, B[10], "ZZ TWO BOOKS CO", None, "linked"), (F, B[11], "zz two books co", None, "linked")]
    db.sql("; ".join("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, device_id, computer, state) values (%s, %s, 'cl-%d', %s, %s, %s, 'NWS144', %s)"
                     % (q(f), q(b), i, "null" if g is None else q(g), q(n), q(D2), q(st)) for i, (f, b, n, g, st) in enumerate(rows)))
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_name, device_id, computer, state) values (%s, '22222222-2222-2222-2222-222222222155', 'cl-r', 'ZZ REVOKED CO', %s, 'NWS144', 'linked')" % (q(F), q(D2)))
    db.sql("insert into tally_sync_cursor (book_id, company_guid) values (%s, 'G-CUR-BOOK'), (%s, 'G-CUR-SAME')" % (q(B[8]), q(B[9])))
    db.sql(pg_stand.migration_body(M155))
    db.sql(pg_stand.migration_body(M155))     # safe twice
    def link(b): return db.rows("select coalesce(company_guid, '') as g, device_id::text as d, computer, client_id, state from tally_links where book_id = %s" % q(b))[0]
    n = db.one("select tally_link_guid_fill(%s, %s, 'go-aaaaaa155155')" % (q(F), q(D)))
    l0 = link(B[0])
    ok(link(B[8])["g"] == "", "5. (review B1) the book's own recorded GUID (tally_sync_cursor) names another: not filled (%s)" % link(B[8]))
    ok(link(B[9])["g"] == "g-cur-same", "5. (review B1) the book's recorded GUID the same: filled (%s)" % link(B[9]))
    ok(link(B[10])["g"] == "" and link(B[11])["g"] == "", "5. (review B2) two linked books of the firm with that name: neither filled")
    ok(n == "2" and l0["g"] == "7a817f69-0000-4000-8000-000000000001" and l0["d"] == D2 and l0["computer"] == "NWS144" and l0["client_id"] == "cl-0" and l0["state"] == "linked",
       "1. the GUID filled from the bridge's record, lower case; device, computer, client untouched (%s, %s)" % (n, l0))
    ok(link(B[1])["g"] == "g-old-has", "2. never over a GUID already there (%s)" % link(B[1]))
    ok(link(B[2])["g"] == "" and link(B[3])["g"] == "g-taken", "2. never a GUID another linked book of the firm holds")
    ok(link(B[4])["g"] == "", "2. never an unlinked row")
    ok(link(B[5])["g"] == "", "2. never another firm's link")
    ok(link(B[7])["g"] == "", "2. never from another bridge's record of the same key")
    rv = (db.one("select tally_link_guid_fill(%s, %s, 'go-aaaaaa155155')" % (q(F), q(DR))), db.one("select coalesce(company_guid, '-') from tally_links where book_id = '22222222-2222-2222-2222-222222222155'"))
    ok(rv[0] == "0" and rv[1] == "-", "2. never from a revoked key (%s)" % (rv,))
    ok(link(B[6])["g"] == "", "3. a name listed with two GUIDs: not filled")
    ok(db.one("select tally_link_guid_fill(%s, %s, 'go-aaaaaa155155')" % (q(F), q(D))) == "0", "4. a second call fills nothing more")
    db.sql(pg_stand.migration_body(M155))
    ok(link(B[0])["g"] == "7a817f69-0000-4000-8000-000000000001", "4. a third run of 155 changes no row")
    ok(db.one("select tally_link_guid_fill(null, %s, 'go-aaaaaa155155')" % q(D)) == "0" and db.one("select tally_link_guid_fill(%s, %s, '')" % (q(F), q(D))) == "0", "4. no firm or no bridge: nothing")
finally:
    db.stop()
print("ALL PASSED" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
