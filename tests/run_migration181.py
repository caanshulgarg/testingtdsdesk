"""python3 tests/run_migration181.py - server/tally-cloud/migration-181-gst-share-isd-index.sql (12-Nov-2026, branch
next-gst-isd-2b; review of c0d037200): the partial index of the entries Tally types ISD that keeps migration 180's
gst_share_ctx_version fast. On a throwaway PostgreSQL (pg_stand, port 31881 unless PG181_PORT; never a real database),
made-up rows only (a 100,000-entry book), with migration 164's function, then 180 (timed without the index), then 181.
  0. the file: not in a transaction (create index concurrently), lock_timeout set; add-only (only this index); its
     predicate is 180's pattern character for character; names no real database; md5 of 180 and 181
  1. runs, and a second time (if not exists); the index valid and partial
  2. the pattern (as the files have it) on every type of tests/isd_types.json reads as listed, as GSTR.ISD_RE does
     (tests/run_gst_isd_2b.js part E checks the JS side on the same list)
  3. on the 100,000-entry book: the version's ISD part planned by the index (EXPLAIN), the version the same with and
     without it, and a call at most 20 ms (timed in the database, 30 calls), against the time without the index
RED_WITHOUT_181=1: the same checks without running 181 (1 and 3 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); sys.path.insert(0, HERE)
import pg_stand
M164 = os.path.join(ROOT, "server", "tally-cloud", "migration-164-gst-share.sql")
M180 = os.path.join(ROOT, "server", "tally-cloud", "migration-180-gst-share-ctx-isd.sql")
M181 = os.path.join(ROOT, "server", "tally-cloud", "migration-181-gst-share-isd-index.sql")
RED = os.environ.get("RED_WITHOUT_181") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
t180, t181 = open(M180).read(), open(M181).read()
for f, t in ((M180, t180), (M181, t181)): print("  md5 of %s: %s (%d bytes)" % (os.path.basename(f), hashlib.md5(t.encode()).hexdigest(), len(t.encode())))
code = "\n".join(l.split("--")[0] for l in t181.lower().splitlines())
print("== 0. the file")
ok(not re.search(r"^\s*(begin|commit|start transaction)\b", code, re.M) and re.search(r"^set lock_timeout = '10s';", t181, re.M) is not None, "not in a transaction; lock_timeout 10 s")
stmts = [x.strip() for x in code.split(";") if x.strip()]
ok(len(stmts) == 3 and stmts[1].startswith("create index concurrently if not exists tally_vouchers_isd_typed on public.tally_vouchers (book_id)") and not re.search(r"\b(drop|truncate|alter|delete|update|insert)\b", code),
   "add-only: only the index, made concurrently, if not exists")
PAT = lambda t: re.findall(r"gst_reg_type ~\* '([^']*)'", t)
ok(len(PAT(t181)) == 1 and PAT(t181) == PAT(t180), "its predicate is 180's pattern, character for character: " + (PAT(t181) or ["?"])[0])
ok(re.search(r"where deleted_at is null and gst_reg_type ~\*", t181) is not None and "v.deleted_at is null" in t180, "and the same condition on deleted entries")
ok(not re.search(r"supabase\.co|qbocskaiewaxqcvaunzc", t181.lower()), "names no real database")
pat = PAT(t181)[0]
f164 = re.search(r"create or replace function public\.gst_share_ctx_version\(p_book uuid\).*?\$function\$;", open(M164).read(), re.S).group(0)
F, BK = "99999999-9999-4999-8999-999999999181", "bbbbbbbb-0181-4000-8000-000000000001"
db = pg_stand.start(int(os.environ.get("PG181_PORT") or 31881))
q = lambda s: "'" + str(s).replace("'", "''") + "'"
try:
    db.sql("""do $x$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $x$;
      create table if not exists tally_groups (book_id uuid, firm_id uuid, name text, parent text, primary key (book_id, name));
      alter table tally_vouchers add column if not exists deleted_at timestamptz, add column if not exists gst_reg_type text;
      insert into firms values ('%(F)s', 'Made-up Firm');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%(B)s', '%(F)s', 'c181', 'Measure ISD', '2025-04-01', '2025-04-01');
      insert into tally_ledgers (book_id, firm_id, name, parent) select '%(B)s', '%(F)s', 'Made-up Ledger ' || g, 'Sundry Creditors' from generate_series(1, 600) g;
      insert into tally_groups values ('%(B)s', '%(F)s', 'Sundry Creditors', 'Current Liabilities');
      insert into client_book_items (firm_id, client_id, key, item, data, seq) values ('%(F)s', 'c181', 'map', '', '{"x": 1}', 1);
      insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, cancelled, optional, gst_reg_type, deleted_at)
        select '%(B)s', '%(F)s', 'v-' || g, date '2025-04-01' + (g %% 365), g, 'Purchase', 'P/' || g, 'Made-up Ledger ' || (g %% 600), false, false,
               case when g %% 20000 = 7 then 'Input Service Distributor' when g %% 3 = 0 then 'Unregistered' else 'Regular' end, case when g %% 50 = 1 then now() else null end
          from generate_series(1, 100000) g;
      analyze tally_vouchers;""" % dict(F=F, B=BK))
    db.sql(f164)
    print("== 2. the pattern on tests/isd_types.json")
    T = json.load(open(os.path.join(HERE, "isd_types.json")))["cases"]
    got = db.rows("select t.n, (t.s ~* %s)::text as m from (values %s) t(n, s) order by t.n" % (q(pat), ", ".join("(%d, %s)" % (i, q(s)) for i, (s, _) in enumerate(T))))
    bad = [T[int(r["n"])] for r in got if (r["m"] == "true") != T[int(r["n"])][1]]
    ok(len(T) >= 10 and len(got) == len(T) and not bad, "the %d types read as listed (as GSTR.ISD_RE)%s" % (len(T), (": not " + json.dumps(bad)) if bad else ""))
    # the version before either file (164), then 181, then 180; timed without and with the index
    db.sql("""create or replace function public.t181(n int) returns float language plpgsql as $f$ declare t0 timestamptz := clock_timestamp(); x text;
              begin for i in 1..n loop x := public.gst_share_ctx_version(%s); end loop; return extract(epoch from clock_timestamp() - t0) * 1000 / n; end $f$;""" % q(BK))
    db.sql(t180)
    slow = float(db.one("select public.t181(10)")); v_no = db.one("select public.gst_share_ctx_version(%s)" % q(BK))
    print("== 1. order and reruns")
    if not RED:
        e = ""
        try: db.sql(t181); db.sql(t181)
        except RuntimeError as x: e = str(x)
        ok(not e, "runs, and a second time" + (": " + e[-300:] if e else ""))
        db.sql("analyze tally_vouchers;")
    ix = db.rows("select i.indisvalid::text as valid, pg_get_expr(i.indpred, i.indrelid) as pred from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'tally_vouchers_isd_typed'")
    ok(len(ix) == 1 and ix[0]["valid"] == "true" and "deleted_at IS NULL" in (ix[0]["pred"] or ""), "the index there, valid, partial: %s" % ((ix[0]["pred"] or "")[:120] if ix else "none"))
    print("== 3. the 100,000-entry book")
    plan = "\n".join(r["QUERY PLAN"] for r in db.rows("explain select distinct coalesce(v.party, '^') as p, v.gst_reg_type as r from tally_vouchers v where v.book_id = %s and v.deleted_at is null and v.gst_reg_type ~* %s" % (q(BK), q(pat))))
    ok("tally_vouchers_isd_typed" in plan, "the ISD part (180's query) planned by the index: " + " / ".join(l.strip() for l in plan.splitlines()[:3]))
    fast = float(db.one("select public.t181(30)")); v_ix = db.one("select public.gst_share_ctx_version(%s)" % q(BK))
    ok(v_ix == v_no and v_no and len(v_no) == 32, "the version the same with and without the index (%s)" % v_no)
    ok(fast <= 20, "a call %.1f ms with the index (at most 20; %.1f ms without it, 30 calls in the database)" % (fast, slow))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
