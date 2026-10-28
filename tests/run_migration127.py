"""python3 run_migration127.py - migration-127-tally-place-real-folder (28-Oct-2026, next-tally-linknow; NOT run on staging).
Staging that day: "Salesify Marketing LLP 2026-27 is open in two places with different data: ① NWS144 · NW144\\anshul ·
Data: (FinCom reads this one) ② NWS144 · NW144\\anshul" for ONE computer, bridge and Windows user: place 1 from a beat
naming the folder "Data:" (TallyPrime's word in tally.ini, not a path) and port 9006, place 2 from a beat with Tally
closed (no folder, no port: the location fell back to the computer key). Everything sent after Tally was closed was
refused as "from another place". On a throwaway PostgreSQL (pg_stand; run_migration110.py's stand, port 31127 unless
PG127_PORT), with 110 run first:
  0. the file: one transaction, lock_timeout 10 s, add-only (nothing dropped, deleted or truncated), names no real
     database; the functions: tally_link_loc (replaced) and tally_real_folder (new); md5
  1. RED (110 alone): the staging case made again: "Data:" chosen, then Tally closed -> refused, a second place waits
  2. 127 runs twice; the false place is kept, marked not_used; the record forgets the "Data:" location
  3. after 127: Tally closed, "Data:", a port only -> applied, no place made; a real folder -> applied and chosen; a second
     REAL folder (another computer) -> still not applied, its place waits (migration 110's two places stay)
  4. tally_real_folder: C:\\…, \\\\server\\…, /… yes; "Data:", "", null, "Data", "D:" no; grants: the service role only"""
import os, re, sys, json, hashlib, textwrap
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PG110_PORT", os.environ.get("PG127_PORT") or "31127")
M127 = os.path.join(HERE, "..", "server", "tally-cloud", "migration-127-tally-place-real-folder.sql")
src = open(os.path.join(HERE, "run_migration110.py")).read()
# run_migration110.py's stand: its header (files, firms, helpers) and the set-up inside its try block, up to its checks
head, rest = src.split("\ntry:\n", 1)
setup = textwrap.dedent(rest.split('    print("== 1. runs twice; the backfill")', 1)[0])
head = head.replace('if __name__', 'if False and __name__')
g = {"__name__": "m110stand", "__file__": os.path.join(HERE, "run_migration110.py")}
print("== (migration 110's own file checks, from its stand)")
exec(compile(head, "run_migration110.py(head)", "exec"), g)
q, ok, db, psql_text, F, D1 = g["q"], g["ok"], g["db"], g["psql_text"], g["F"], g["D1"]
fails = g["fails"]
text = open(M127).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M127), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in text.lower() and not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", code) and not re.search(r"\btruncate\b", code), "add-only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_folder_norm", "tally_link_loc", "tally_link_place_check", "tally_link_place_seen", "tally_real_folder"], "functions: tally_link_loc, tally_link_place_check (replaced); tally_folder_norm, tally_real_folder, tally_link_place_seen (new)")
BOOK = "cf45de08-504e-4a05-8588-d654003dc5a9"
BID = "go-6b1ba45fbb1d"
def beat(folder=None, port=None, open_=True):
    b = {"at": "2026-10-28T13:46:18Z", "computer": "NWS144", "user": "NW144\\anshul", "mode": "main", "open": ["Salesify Marketing LLP 2026-27"] if open_ else []}
    if folder is not None: b["dataFolder"] = folder
    if port is not None: b["tallyPort"] = port
    return {"computer": "NWS144", "beat": {"at": b["at"], "windowsUser": "NW144\\anshul", **({"dataFolder": folder} if folder is not None else {}), **({"tallyPort": port} if port is not None else {})}, "bridges": {BID: b}}
setinfo = lambda dev, info: db.sql("update tally_devices set info = %s where id = %s" % (q(json.dumps(info)), q(dev)))
chk = lambda dev=D1, br=BID: db.one("set role service_role; select tally_link_place_check(%s, %s, %s, %s)::text" % (q(F), q(BOOK), q(dev), q(br)))
places = lambda: sorted((r["f"], r["state"]) for r in db.rows("select coalesce(data_folder, '-') f, state from tally_link_places where book_id = %s" % q(BOOK)))
recloc = lambda: db.one("select coalesce(data_loc, '') || '|' || coalesce(data_folder, '') from tally_links where book_id = %s" % q(BOOK))
try:
    exec(compile(setup, "run_migration110.py(setup)", "exec"), g)
    r = psql_text(open(g["M110"]).read())
    ok(r.returncode == 0, "migration 110 runs %s" % (r.stderr[-300:] if r.returncode else ""))
    # the staging company: linked to its client, on NWS144
    db.sql("insert into clients (id, firm_id, name, data) values ('cmvs', %s, 'Salesify Marketing LLP 2026-27', '{}') on conflict do nothing;"
           "insert into tally_companies (firm_id, company, device_id, last_seen, book_id) values (%s, 'Salesify Marketing LLP 2026-27', %s, now(), %s);" % (q(F), q(F), q(D1), q(BOOK)))
    good = g["link"](g["OWNER"], "Salesify Marketing LLP 2026-27", "cmvs")
    ok("_error" not in good, "linked (%s)" % good.get("_error", ""))

    print("== 1. RED: migration 110 alone, the staging case")
    setinfo(D1, beat("Data:", 9006))
    ok(chk() == "true" and recloc().endswith("|Data:"), "13:16, Tally open, folder 'Data:': applied, its place chosen (%s)" % recloc())
    setinfo(D1, beat(None, None, open_=False))
    red = chk()
    ok(red == "false" and len(places()) == 2, "13:46, Tally closed (no folder, no port): REFUSED and a second place waits, as on staging (%s, %s)" % (red, places()))

    print("== 2. migration 127, twice")
    for n in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0 and "migration 127:" in (r.stderr or ""), "run %d %s" % (n, (r.stderr or "").strip()[-300:]))
    st = lambda: sorted((r["f"], r["state"], r["m"]) for r in db.rows("select coalesce(data_folder, '-') f, state, (merged_at is not null)::text m from tally_link_places where book_id = %s" % q(BOOK)))
    ok(st() == [("-", "not_used", "true"), ("Data:", "not_used", "true")], "the two false places kept, marked merged (%s)" % st())
    ok(recloc() == "|", "the record forgets the 'Data:' location (%s)" % recloc())
    ok(db.one("select count(*) from tally_link_places where book_id = %s" % q(BOOK)) == "2", "nothing deleted")

    print("== 3. after 127: near misses never make a second place; two real folders do")
    seen = lambda dev=D1, br=BID, last="2026-10-27": db.one("set role service_role; select tally_link_place_seen(%s, %s, %s, %s, %s)::text" % (q(F), q(BOOK), q(dev), q(br), q(last)))
    waiting = lambda: [x for x in st() if x[1] == "waiting"]
    REAL = "C:\\Users\\anshul\\TallyPrime\\Data"
    setinfo(D1, beat(REAL, 9006))
    ok(chk() == "true" and seen() == "true" and recloc().endswith("|" + REAL), "the real folder: applied, the place FinCom reads, entries seen (%s)" % recloc())
    near = [("Tally closed (no folder, no port)", None, None, False), ("'Data:' with port 9006", "Data:", 9006, True), ("a port only", None, 9006, True), ("blank folder", "", 9006, True),
            ("'Data' (a word)", "Data", 9006, True), ("a drive alone 'D:'", "D:", 9006, True), ("a relative path 'TallyPrime\\Data'", "TallyPrime\\Data", 9006, True),
            ("upper case", REAL.upper(), 9006, True), ("a trailing backslash", REAL + "\\", 9006, True), ("forward slashes", REAL.replace("\\", "/"), 9006, True),
            ("doubled backslashes", REAL.replace("\\", "\\\\"), 9006, True), ("spaces round it", "  " + REAL + "  ", 9006, True), ("another port, the same folder (a restart)", REAL, 9000, True),
            ("the same bridge after a restart, Tally closed", None, None, False)]
    for what, folder, port, open_ in near:
        setinfo(D1, beat(folder, port, open_=open_))
        a, b = chk(), seen()
        ok(a == "true" and not waiting(), "near miss, %s: applied, no second place (%s, %s)" % (what, a, waiting()))
    ok(len([x for x in st() if x[1] == "chosen"]) == 1, "one place FinCom reads (%s)" % st())
    D2 = "d2000000-0000-0000-0000-000000000127"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version, info, created_by) values (%s, %s, 'LAPTOP', 'h127', '2.4.7', %s, %s)"
           % (q(D2), q(F), q(json.dumps({"computer": "LAPTOP", "bridges": {"go-bbbb000127": {"computer": "LAPTOP", "user": "ravi", "dataFolder": "D:\\Copy\\Data", "tallyPort": 9001, "open": ["Salesify Marketing LLP 2026-27"]}}})), q(g["OWNER"])))
    ok(chk(D2, "go-bbbb000127") == "false" and ("D:\\Copy\\Data", "waiting", "false") in st(), "a second REAL folder (LAPTOP, D:\\Copy\\Data): not applied, its place waits (%s)" % st())
    ok(seen(D2, "go-bbbb000127", "2026-10-20") == "true", "entries seen from it")
    lap = db.rows("select last_entry::text e, (entries_at is not null)::text s from tally_link_places where book_id = %s and computer = 'LAPTOP'" % q(BOOK))[0]
    ok(lap == {"e": "2026-10-20", "s": "true"}, "its last entry's date kept (%s)" % lap)
    db.sql("update tally_devices set info = %s where id = %s" % (q(json.dumps({"computer": "LAPTOP", "bridges": {"go-bbbb000127": {"computer": "LAPTOP", "dataFolder": "Data:", "open": []}}})), q(D2)))
    ok(chk(D2, "go-bbbb000127") == "true", "LAPTOP with 'Data:' only: not a place of its own, applied")

    print("== 4. the waiting rows already there: merged unless they meet the bar")
    B2 = "cf45de08-0000-4000-8000-000000000002"
    db.sql("insert into tally_companies (firm_id, company, device_id, last_seen, book_id) values (%s, 'Second Co', %s, now(), %s);" % (q(F), q(D1), q(B2)))
    g["link"](g["OWNER"], "Second Co", "cmvs") if False else None
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_name, state, data_loc, data_folder, computer) values (%s, %s, 'c2', 'Second Co', 'linked', 'fold', %s, 'NWS144') on conflict do nothing;" % (q(F), q(B2), q(REAL + "\\")))
    db.sql("insert into tally_link_places (firm_id, book_id, data_loc, data_folder, computer, state) values (%s, %s, 'fold', %s, 'NWS144', 'chosen'), (%s, %s, 'fsame', %s, 'NWS144', 'waiting'), (%s, %s, 'fother', 'E:\\Other\\Data', 'NWS144', 'waiting');"
           % (q(F), q(B2), q(REAL + "\\"), q(F), q(B2), q(REAL.lower()), q(F), q(B2)))
    r = psql_text(text)
    ok(r.returncode == 0, "127 again %s" % (r.stderr[-200:] if r.returncode else ""))
    w = {x["data_loc"]: (x["state"], x["m"]) for x in db.rows("select data_loc, state, (merged_at is not null)::text m from tally_link_places where book_id = %s" % q(B2))}
    ok(w.get("fsame") == ("not_used", "true") and w.get("fother") == ("not_used", "true") and w.get("fold") == ("chosen", "false"), "the same folder spelled differently, and one with no entries seen: merged; the chosen kept (%s)" % w)
    nl = db.one("select data_loc from tally_links where book_id = %s" % q(B2))
    ok(nl.startswith("f") and nl != "fold" and nl == db.one("select 'f' || left(md5('nws144|' || public.tally_folder_norm(%s)), 20)" % q(REAL)), "the record's location normalised (%s)" % nl)

    print("== 5. tally_folder_norm / tally_real_folder; grants")
    yes = {"C:\\Users\\a\\TallyPrime\\Data": "c:\\users\\a\\tallyprime\\data", "c:/users/a/tallyprime/data/": "c:\\users\\a\\tallyprime\\data",
           "\\\\SERVER\\Share\\Data": "\\\\server\\share\\data", "/home/tally/data": "\\home\\tally\\data", "C:\\\\Users\\a\\Data\\\\": "c:\\users\\a\\data"}
    no = ["Data:", "", "Data", "D:", "D:\\", "  ", "TallyPrime\\Data", "\\\\server", "\\\\server\\"]
    got = {x: db.one("select coalesce(public.tally_folder_norm(%s), '<none>')" % q(x)) for x in list(yes) + no}
    ok(all(got[x] == v for x, v in yes.items()) and all(got[x] == "<none>" for x in no) and db.one("select public.tally_real_folder(null)::text") == "false", "real folders only, normalised (%s)" % got)
    acl = lambda f: db.one("select array_to_string(proacl, ',') from pg_proc where oid = '%s'::regprocedure" % f) or ""
    for fn in ("public.tally_real_folder(text)", "public.tally_folder_norm(text)", "public.tally_link_loc(uuid,text,text)", "public.tally_link_place_check(uuid,uuid,uuid,text)", "public.tally_link_place_seen(uuid,uuid,uuid,text,date)"):
        ok("service_role=X" in acl(fn) and "authenticated" not in acl(fn) and "anon" not in acl(fn) and "=X/" not in acl(fn).replace("postgres=X/", "").replace("service_role=X/", ""), "%s: the service role only (%s)" % (fn, acl(fn)))
finally:
    db.stop()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
