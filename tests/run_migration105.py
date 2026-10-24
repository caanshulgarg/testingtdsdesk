"""python3 run_migration105.py - migration-105-gst-held-input (24-Oct-2026, branch next-fix-gst-not2b; NOT run on staging)
on a throwaway PostgreSQL (pg_stand, port 31050 unless PG105_PORT; never a real database). The server's GST summary
(tally_gst_summary) takes input tax as the app's GSTR-3B does (commit c326262): credit kept in an input ledger "NOT SHOWN
IN 2B" is taken when the books move it to the input ledger, never when the bill is booked; a set-off (even with a rounding
line under Indirect Expenses), a write-off of the held credit and a rounding of the held ledger are no purchases.
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, no "delete from", no truncate, no table altered);
     only tally_gst_summary(text, date, date) replaced; names no real database; md5 printed
  1. before it, the summary as on staging (migration 37's text) is wrong on the made-up books (fixtures/gst_not2b_books.json):
     Apr-2025 IGST -900 (the write-off) and CGST 0 (the set-off with a rounding line took the month's 900 away), the held
     bills as Mar-2026's credit, in Apr-2026 the held bill booked then and nothing for the move
  2. it runs, and runs a second time (the same function text after each run)
  3. "in" month by month equals the app's 3B 4(A)(5) for the same books (node run_gst_not2b.js, the app's own code), every
     head; never negative; output tax, reverse charge and taxable sales exactly as before
  4. the function: security definer, stable, search_path = public, pg_temp, the same arguments and return type; execute for
     authenticated and service_role only (as on staging), not anon or public; another firm's member gets nothing
RED_WITHOUT_105=1: the same checks without running the file (1 holds, 2 to 4 fail)."""
import os, re, sys, json, hashlib, subprocess, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M105, M37 = os.path.join(SQLDIR, "migration-105-gst-held-input.sql"), os.path.join(SQLDIR, "migration-37-follow-ups.sql")
RED = os.environ.get("RED_WITHOUT_105") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
q = lambda s: "'" + str(s).replace("'", "''") + "'"
text = open(M105).read() if os.path.exists(M105) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M105), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s", code) and "delete from" not in code and "truncate" not in code and not re.search(r"\balter\s+table\b", code), "add-only: nothing dropped, deleted, truncated or altered")
ok(re.findall(r"create or replace function (public\.\w+)\(([^)]*)\)", code) == [("public.tally_gst_summary", "p_client text, p_from date, p_to date")], "only tally_gst_summary(p_client text, p_from date, p_to date) replaced")
ok(not re.search(r"supabase\.co|https?://|qbocskai", text.lower()), "names no real database")
# the function as on staging today: migration 37's text (read 24-Oct-2026 from staging: the same)
m37 = open(M37).read(); i = m37.index("create or replace function public.tally_gst_summary("); OLD = m37[i:m37.index("end $function$;", i) + len("end $function$;")]
F = json.load(open(os.path.join(HERE, "fixtures", "gst_not2b_books.json")))
# the app's figures for the same books (the app's own GSTR.threeBm and GST9.build)
out = os.path.join(tempfile.mkdtemp(), "app.json")
r = subprocess.run(["node", os.path.join(HERE, "run_gst_not2b.js"), out], capture_output=True, text=True, cwd=HERE)
ok(r.returncode == 0, "the app's own figures for the books (node run_gst_not2b.js): " + (r.stdout.strip().splitlines() or ["?"])[-1])
APP = json.load(open(out))["months"] if os.path.exists(out) else {}
FIRM, OTHER, ME, STRANGER, BOOK, CLIENT = ("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                                           "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc", "zzclient105")
STAND = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
alter table tally_vouchers add column if not exists deleted_at timestamptz;
alter table tally_ledger_day add column if not exists merged_into text;
create or replace function public.tally_nm(p text) returns text language sql immutable as $function$
  select btrim(regexp_replace(coalesce(p, ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
$function$;
create or replace function public.tally_led_kinds(p_client text) returns table(ledger text, kind text, side text, tax text, what text)
language sql stable security definer set search_path to 'public' as $function$
  select tally_nm(substr(i.item, 2)), coalesce(i.data->>'kind', ''), coalesce(i.data->>'side', ''), coalesce(i.data->>'tax', ''),
         coalesce(nullif(i.data->>'what', ''), case when i.data->>'kind' = 'gst' and coalesce(i.data->>'rcm', '') = 'true' then 'gst_rcm' else coalesce(i.data->>'kind', '') end)
    from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted;
$function$;
grant execute on function public.tally_led_kinds(text) to authenticated, service_role;
"""
def iso(d): return d[:4] + "-" + d[4:6] + "-" + d[6:]
def books_sql():
    under, groups = F["under"], F["groups"]
    def chain(p):
        c = []
        while p and p not in c and len(c) < 30: c.append(p); p = groups.get(p, "")
        return c
    names = sorted(set(l for v in F["vouchers"] for l, _ in v[6]))
    s = ["insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, 'ZZ BROKERS', %s, %s);" % (q(BOOK), q(FIRM), q(CLIENT), q(iso(F["from"])), q(iso(F["from"])))]
    s.append("insert into tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group) values " + ",".join(
        "(%s, %s, %s, %s, 0, %s, %s)" % (q(BOOK), q(FIRM), q(n), q(under.get(n, "")), ("array[%s]::text[]" % ",".join(q(g) for g in chain(under.get(n, "")))) if chain(under.get(n, "")) else "'{}'::text[]", q((chain(under.get(n, "")) or [""])[-1])) for n in names) + ";")
    day = {}
    for gid, d, typ, no, refd, narr, ent in F["vouchers"]:
        s.append("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, ref_date) values (%s, %s, %s, %s, 1, %s, %s, '', %s, false, false, %s);"
                 % (q(BOOK), q(FIRM), q(gid), q(iso(d)), q(typ), q(no), q(narr), q(iso(refd)) if refd else "null"))
        s.append("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values " + ",".join("(%s, %s, %s, %s, %s, %s)" % (q(BOOK), q(FIRM), q(gid), q(iso(d)), q(l), a) for l, a in ent) + ";")
        for l, a in ent: day[(l, d)] = day.get((l, d), 0) + a
    s.append("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values " + ",".join("(%s, %s, %s, %s, %s, 0, 0, 1)" % (q(BOOK), q(FIRM), q(l), q(iso(d)), round(a, 2)) for (l, d), a in day.items()) + ";")
    s.append("insert into client_book_items (firm_id, client_id, key, item, data) values " + ",".join("(%s, %s, 'map', %s, %s::jsonb)" % (q(FIRM), q(CLIENT), q("." + n), q(json.dumps(m))) for n, m in F["map"].items()) + ";")
    return "\n".join(s)
SUM = "select public.tally_gst_summary(%s, '2025-04-01', '2026-12-31')::text" % q(CLIENT)
def months(uid=ME):
    j = json.loads(db.one(SUM, uid)); return j, {m["ym"]: m for m in j.get("months", [])}
H = ["IGST", "CGST", "SGST", "CESS"]
db = pg_stand.start(int(os.environ.get("PG105_PORT") or 31050))
try:
    db.sql(STAND + "insert into firms values (%s, 'A'), (%s, 'B'); insert into members (user_id, firm_id, name, role) values (%s, %s, 'Me', 'owner'), (%s, %s, 'Stranger', 'owner');" % (q(FIRM), q(OTHER), q(ME), q(FIRM), q(STRANGER), q(OTHER))
           + " grant usage on schema auth to authenticated, service_role; grant select on members to authenticated, service_role;")
    db.sql(OLD + "\nrevoke all on function public.tally_gst_summary(text, date, date) from public, anon;\ngrant execute on function public.tally_gst_summary(text, date, date) to authenticated, service_role;")
    db.sql(books_sql())
    print("== 1. the summary as on staging, on the same books")
    j0, m0 = months()
    a4 = m0["202504"]["in"]
    ok(a4["IGST"] == -900 and a4["CGST"] == 0, "Apr-2025 as before: IGST %s (the write-off of journal 658), CGST %s (the set-off's rounding line made it a document)" % (a4["IGST"], a4["CGST"]))
    ok(m0["202603"]["in"]["IGST"] == 413388 and m0["202604"]["in"]["IGST"] == 900, "the held bills were Mar-2026's credit (IGST %s); in Apr-2026 the held bill booked then, not the 2,02,500 moved (IGST %s)" % (m0["202603"]["in"]["IGST"], m0["202604"]["in"]["IGST"]))
    print("== 2. runs twice")
    fn = "select md5(pg_get_functiondef('public.tally_gst_summary(text,date,date)'::regprocedure))"
    texts = []
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_105: not run)" % n); continue
        try: db.sql(text); texts.append(db.one(fn)); ok(True, "run %d" % n)
        except RuntimeError as e: ok(False, "run %d: %s" % (n, str(e)[:400]))
    ok(len(texts) == 2 and texts[0] == texts[1], "the same function after each run")
    print("== 3. the server's figures against the app's")
    j1, m1 = months()
    for ym in sorted(set(APP) | set(m1)):
        sv, ap = m1.get(ym, {}).get("in", {}), APP.get(ym, {})
        same = all(abs(float(sv.get(h, 0)) - float(ap.get(h.lower(), 0))) < 0.01 for h in H)
        ok(same, "%s in %s (app's 4(A)(5) %s)" % (ym, "/".join(str(sv.get(h, 0)) for h in H[:3]), "/".join(str(ap.get(h.lower(), 0)) for h in H[:3])))
    ok(all(float(m["in"][h]) > -0.005 for m in m1.values() for h in H), "never negative credit")
    ok(all(m1[k]["out"] == m0[k]["out"] and m1[k]["rcmOut"] == m0[k]["rcmOut"] and m1[k]["taxableSales"] == m0[k]["taxableSales"] for k in m0) and j1.get("mapped") == j0.get("mapped") and set(j1) == set(j0),
       "output tax, reverse charge, taxable sales and the answer's shape as before (Apr-2025 out %s)" % json.dumps(m1["202504"]["out"]))
    print("== 4. the function and who may call it")
    p = db.rows("select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ';') cfg, pg_get_function_result(p.oid) res, p.proacl::text acl from pg_proc p where p.oid = 'public.tally_gst_summary(text,date,date)'::regprocedure")[0]
    ok(p["prosecdef"] == "t" and p["provolatile"] == "s" and p["cfg"] == "search_path=public, pg_temp" and p["res"] == "jsonb", "security definer, stable, search_path = public, pg_temp, returns jsonb (%s)" % p["cfg"])
    acl = sorted(re.findall(r"(\w*)=X/", p["acl"]))
    ok(acl == ["authenticated", "postgres", "service_role"], "execute: authenticated, service_role (and the owner) only, as on staging: %s" % p["acl"])
    ok(db.one("select has_function_privilege('anon', 'public.tally_gst_summary(text,date,date)', 'execute')") == "f", "anon may not call it")
    ok(json.loads(db.one(SUM, STRANGER)).get("none") is True, "another firm's member gets nothing")
finally:
    db.stop()
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
