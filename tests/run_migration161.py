"""python3 run_migration161.py - migration-161-split-tally (11-Nov-2026, next-split-years; NOT run on staging). A SPLIT
Tally (the same business cut into two Tally companies by date, both keeping the same company GUID, as on staging) is ONE
client: its current company linked as before, the earlier-years company beside it. On a throwaway PostgreSQL
(pg_stand; run_migration110.py's stand, port 31616 unless PG161_PORT), with 110 and 128 run first. Made-up rows only:
  0. the file: one transaction, lock_timeout 10 s, add-only, names no real database; functions; grants; md5
  1. RED (110 and 128 alone): linking the earlier company the usual way is refused (taken for a rename of the current
     one), and there is no other way
  2. 161 runs twice; nothing deleted or changed elsewhere
  3. tally_split_link: the earlier company is the client's, posting never allowed, the GUID left to the current company;
     its mirror (tally_companies, tally_books) set, so tally-ingest reads it (tally_book_for); the current company's record
     untouched; the posting guard still names the current company only
  4. tally_split_of: the earlier company, its end day, live; any member of the firm; another firm's member: none
  5. refusals: a viewer; a day today or later; a company no computer reported; a client with no current company;
     another client's company; a GUID another client holds; the PAN of another; a second earlier-years company
  6. the same company again: its end day changed (version moves on)
  7. tally_split_unlink: the record and mirror unlinked, the client back to its current company alone; linked again
  8. the current company unlinked: tally_split_of says not live
  9. RLS and grants: members read their firm's rows only; no direct write; anon nothing; the helper the service role's
RED_WITHOUT_161=1: the same checks without running the file (0 and 1 hold; the rest fail)."""
import os, re, sys, json, hashlib, textwrap
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PG110_PORT", os.environ.get("PG161_PORT") or "31616")
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M161 = os.path.join(SQLDIR, "migration-161-split-tally.sql")
RED = os.environ.get("RED_WITHOUT_161") == "1"
src = open(os.path.join(HERE, "run_migration110.py")).read()
head, rest = src.split("\ntry:\n", 1)
setup = textwrap.dedent(rest.split('    print("== 1. runs twice; the backfill")', 1)[0])
g = {"__name__": "m110stand", "__file__": os.path.join(HERE, "run_migration110.py")}
print("== (migration 110's own file checks, from its stand)")
exec(compile(head, "run_migration110.py(head)", "exec"), g)
q, ok, db, psql_text, F, F2, D1 = g["q"], g["ok"], g["db"], g["psql_text"], g["F"], g["F2"], g["D1"]
fails = g["fails"]
text = open(M161).read() if os.path.exists(M161) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M161), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok("delete from" not in text.lower() and not re.search(r"\b(drop|truncate)\s+(table|view|function|policy|column|index|schema|trigger|constraint)\b", code) and not re.search(r"\btruncate\b|\balter table public\.(?!tally_split_links)", code), "add-only")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
made = sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code)))
ok(made == ["tally_split_link", "tally_split_of", "tally_split_of_firm", "tally_split_unlink"], "four new functions, none replaced: %s" % made)
ok(re.findall(r"create table if not exists public\.(\w+)", code) == ["tally_split_links"], "one new table")
for gr in ("grant select on public.tally_split_links to authenticated;", "grant all on public.tally_split_links to service_role;", "revoke all on public.tally_split_links from public, anon, authenticated;",
           "grant execute on function public.tally_split_link(text, text, date), public.tally_split_unlink(uuid), public.tally_split_of(text) to authenticated, service_role;",
           "grant execute on function public.tally_split_of_firm(uuid, text) to service_role;"):
    ok(gr in text, "explicit: " + gr)

OWN, STAFF, VIEWER, O2 = g["OWNER"], g["STAFF"], g["VIEWER"], g["O2"]
GUID = "c9000000-0000-4000-8000-000000000160"
OLDCO, NEWCO = "ZZ SPLIT PVT LTD - (from 1-Apr-2021)", "ZZ SPLIT PVT LTD - (from 1-Apr-25)"
BOLD, BNEW = "b1600000-0000-0000-0000-000000000001", "b1600000-0000-0000-0000-000000000002"
CL, CL2, CLP = "cs160", "cs160b", "cs160p"
rpc, link = g["rpc"], g["link"]
splitlink = lambda uid, co, cl, ends: rpc(uid, "select tally_split_link(%s, %s, %s)::text" % (q(co), q(cl), "null" if ends is None else q(ends) + "::date"))
splitof = lambda uid, cl: rpc(uid, "select coalesce(tally_split_of(%s), 'null'::jsonb)::text" % q(cl))
unl = lambda uid, b: rpc(uid, "select tally_split_unlink(%s)::text" % q(b))
rec = lambda b: (db.rows("select coalesce(client_id, '') c, coalesce(company_guid, '') g, posting_allowed::text p, state, version::text v from tally_links where book_id = %s" % q(b)) or [{}])[0]
mir = lambda b: db.one("select coalesce(c.client_id, '') || '|' || coalesce((select client_id from tally_books where book_id = c.book_id), '-') from tally_companies c where c.book_id = %s" % q(b))
try:
    exec(compile(setup, "run_migration110.py(setup)", "exec"), g)
    for m in ("migration-110-tally-link-record.sql", "migration-128-client-removed-frees-tally.sql"):
        r = psql_text(open(os.path.join(SQLDIR, m)).read())
        ok(r.returncode == 0, "%s runs %s" % (m, r.stderr[-300:] if r.returncode else ""))
    # tally-ingest's door (migration-2-hardening's tally_book_for, as on staging)
    h = open(os.path.join(SQLDIR, "migration-2-hardening.sql")).read(); i = h.index("create or replace function public.tally_book_for"); db.sql(h[i:h.index("$$;", h.index("$$", h.index("as $$", i) + 5)) + 3])
    # the split as on staging: both companies keep one GUID; the current one linked (its cursor records the GUID); the
    # earlier one reported, holding a book of its own, not linked
    db.sql("""insert into clients (id, firm_id, name, data, gstin) values (%(CL)s, %(F)s, 'ZZ Split Pvt Ltd', '{}', '27ZZSPL1600A1Z5'), (%(CL2)s, %(F)s, 'Other client', '{}', null), (%(CLP)s, %(F)s, 'No company yet', '{}', null);
      insert into tally_companies (firm_id, company, gstin, device_id, last_seen, book_id) values (%(F)s, %(OLD)s, '27ZZSPL1600A1Z5', %(D1)s, now(), %(BOLD)s), (%(F)s, %(NEW)s, '27ZZSPL1600A1Z5', %(D1)s, now(), %(BNEW)s);
      insert into tally_books (book_id, firm_id, client_id, company, from_date) values (%(BOLD)s, %(F)s, '', %(OLD)s, '2021-04-01'), (%(BNEW)s, %(F)s, '', %(NEW)s, '2025-04-01');
      insert into tally_sync_cursor (book_id, firm_id, company_guid) values (%(BNEW)s, %(F)s, %(G)s), (%(BOLD)s, %(F)s, %(G)s);"""
           % {"CL": q(CL), "CL2": q(CL2), "CLP": q(CLP), "F": q(F), "OLD": q(OLDCO), "NEW": q(NEWCO), "D1": q(D1), "BOLD": q(BOLD), "BNEW": q(BNEW), "G": q(GUID)})
    r0 = link(OWN, NEWCO, CL)
    ok("_error" not in r0 and rec(BNEW).get("c") == CL and rec(BNEW).get("g") == GUID and rec(BNEW).get("p") == "true", "the current company linked as before (%s %s)" % (r0.get("_error", ""), rec(BNEW)))
    tables = ["tally_companies", "tally_books", "clients", "tally_links", "tally_devices", "tally_sync_cursor"]
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in tables}

    print("== 1. RED: 110 and 128 alone")
    r1 = link(OWN, OLDCO, CL)
    ok("_error" in r1 and "already holds books" in r1["_error"], "linking the earlier company the usual way: taken for a rename and refused (%s)" % r1.get("_error", "")[-120:])
    ok(rec(BNEW).get("c") == CL and rec(BOLD) == {} and mir(BOLD) == "|", "nothing changed by the refusal (%s %s)" % (rec(BOLD), mir(BOLD)))
    before = counts()

    print("== 2. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_161: not run)" % n); continue
        r = psql_text(text)
        ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        ok(counts() == before, "run %d: nothing deleted or added (%s)" % (n, counts()))

    print("== 3. link the earlier years")
    r3 = splitlink(STAFF, OLDCO, CL, "2025-03-31")
    ok(r3.get("ok") is True, "staff links %s as the earlier years of the client (%s)" % (OLDCO, r3.get("_error", "") or r3.get("error", "")))
    e = rec(BOLD)
    ok(e.get("c") == CL and e.get("state") == "linked" and e.get("p") == "false" and e.get("g") == "", "its record: the client's, posting never allowed, the GUID left to the current company (%s)" % e)
    ok(mir(BOLD) == CL + "|" + CL, "its mirror: tally_companies and tally_books carry the client (%s)" % mir(BOLD))
    ok(rec(BNEW).get("c") == CL and rec(BNEW).get("g") == GUID and rec(BNEW).get("p") == "true" and rec(BNEW).get("v") == "1", "the current company's record untouched (%s)" % rec(BNEW))
    ok(g["svc"]("select to_jsonb(tally_book_for(%s, %s))::text" % (q(F), q(OLDCO))) == BOLD, "tally-ingest reads the earlier company into its own book (tally_book_for)")
    ok(g["svc"]("select to_jsonb(tally_link_post_to(%s, %s, %s))::text" % (q(F), q(CL), q(OLDCO))) == NEWCO, "the posting guard names the current company only, even when asked for the earlier one")
    ok(db.one("select string_agg(client_id || ':' || current_book || ':' || ends_on || ':' || state, ',') from tally_split_links") == "%s:%s:2025-03-31:linked" % (CL, BNEW), "the row: the client, its current company, the end day")

    print("== 4. tally_split_of")
    s = splitof(VIEWER, CL)
    ok(s.get("book") == BOLD and s.get("company") == OLDCO and s.get("ends") == "20250331" and s.get("from") == "20210401" and s.get("currentBook") == BNEW and s.get("curFrom") == "20250401" and s.get("live") is True,
       "a viewer of the firm reads it (%s)" % s)
    ok(splitof(VIEWER, CL2) is None, "a client with none: null")
    ok(splitof(O2, CL) is None, "another firm's member: null")

    print("== 5. refusals")
    ok("not allowed" in splitlink(VIEWER, OLDCO, CL, "2025-03-31").get("_error", ""), "a viewer may not link")
    ok("before today" in splitlink(OWN, OLDCO, CL, "2099-03-31").get("error", ""), "an end day today or later")
    ok("No computer has reported" in splitlink(OWN, "NOT SEEN CO", CL, "2025-03-31").get("error", ""), "a company no computer reported")
    db.sql("insert into tally_companies (firm_id, company, device_id, last_seen, book_id) values (%s, 'ZZ LONE CO', %s, now(), 'b1600000-0000-0000-0000-000000000003'), (%s, 'ZZ OTHERS CO', %s, now(), 'b1600000-0000-0000-0000-000000000004'), (%s, 'ZZ PAN CO', %s, now(), 'b1600000-0000-0000-0000-000000000005');"
           % (q(F), q(D1), q(F), q(D1), q(F), q(D1)))
    db.sql("update tally_companies set gstin = '27QQQQQ9999Q1Z5' where company = 'ZZ PAN CO'")
    ok("current company" in splitlink(OWN, "ZZ LONE CO", CLP, "2025-03-31").get("error", ""), "a client with no current company")
    ok("_error" not in link(OWN, "ZZ OTHERS CO", CL2), "(another client links ZZ OTHERS CO)")
    ok("is linked to Other client" in splitlink(OWN, "ZZ OTHERS CO", CL, "2025-03-31").get("error", ""), "another client's company")
    ok("is not this client" in splitlink(OWN, "ZZ PAN CO", CL, "2025-03-31").get("error", ""), "the PAN of another")
    ok("already" in splitlink(OWN, "ZZ LONE CO", CL, "2024-03-31").get("error", "") and rec("b1600000-0000-0000-0000-000000000003") == {}, "a second earlier-years company: refused, nothing written")
    # a GUID held by another client's company
    db.sql("insert into tally_books (book_id, firm_id, client_id, company) values ('b1600000-0000-0000-0000-000000000003', %s, '', 'ZZ LONE CO'); insert into tally_sync_cursor (book_id, firm_id, company_guid) values ('b1600000-0000-0000-0000-000000000003', %s, 'g-others-160')" % (q(F), q(F)))
    db.sql("set session_replication_role = replica; update tally_links set company_guid = 'g-others-160' where book_id = 'b1600000-0000-0000-0000-000000000004'; set session_replication_role = default;")
    ok(unl(OWN, BOLD).get("ok") is True, "(the earlier years unlinked, to try another)")
    ok("linked to Other client" in splitlink(OWN, "ZZ LONE CO", CL, "2024-03-31").get("error", ""), "a GUID another client's company holds")

    print("== 6. the same company again")
    ok(splitlink(OWN, OLDCO, CL, "2025-03-31").get("ok") is True, "linked again")
    v0 = db.one("select version from tally_split_links where book_id = %s" % q(BOLD))
    r6 = splitlink(OWN, OLDCO, CL, "2024-03-31")
    ok(r6.get("ok") is True and db.one("select ends_on::text || ':' || version from tally_split_links where book_id = %s" % q(BOLD)) == "2024-03-31:%d" % (int(v0) + 1), "its end day changed, the version moved on")
    splitlink(OWN, OLDCO, CL, "2025-03-31")

    print("== 7. unlink the earlier years")
    r7 = unl(STAFF, BOLD)
    ok(r7.get("ok") is True and rec(BOLD).get("state") == "unlinked" and mir(BOLD) == "|" and splitof(OWN, CL) is None, "unlinked: record, mirror, row (%s %s)" % (rec(BOLD), mir(BOLD)))
    ok(rec(BNEW).get("c") == CL and rec(BNEW).get("p") == "true" and mir(BNEW) == CL + "|" + CL, "the client is back to its current company alone (%s)" % rec(BNEW))
    ok(unl(STAFF, BOLD).get("ok") is False, "unlinking again: said, nothing changed")
    ok("not allowed" in unl(VIEWER, BOLD).get("_error", ""), "a viewer may not unlink")
    ok(splitlink(OWN, OLDCO, CL, "2025-03-31").get("ok") is True and splitof(OWN, CL).get("live") is True, "linked again in one call")

    print("== 8. the current company unlinked")
    ok("_error" not in link(OWN, NEWCO, None), "(the current company unlinked)")
    s8 = splitof(OWN, CL)
    ok(s8 is not None and s8.get("live") is False and s8.get("book") == BOLD, "tally_split_of: not live (the books are not joined) (%s)" % s8)

    print("== 9. RLS and grants")
    good, n_ = g["as_role"]("authenticated", STAFF, "select count(*) from tally_split_links")
    ok(good and n_ == "1", "a member reads the firm's rows (%s)" % n_)
    good, n_ = g["as_role"]("authenticated", O2, "select count(*) from tally_split_links")
    ok(good and n_ == "0", "another firm's member none (%s)" % n_)
    good, out = g["as_role"]("authenticated", OWN, "update tally_split_links set ends_on = '2020-03-31'")
    ok(not good and "permission denied" in out, "no direct write")
    good, out = g["as_role"]("anon", None, "select count(*) from tally_split_links")
    ok(not good and "permission denied" in out, "anon reads nothing")
    priv = lambda role, fn: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(fn)))
    for fn in ("public.tally_split_link(text,text,date)", "public.tally_split_unlink(uuid)", "public.tally_split_of(text)"):
        ok(priv("authenticated", fn) == "true" and priv("service_role", fn) == "true" and priv("anon", fn) == "false", fn + ": members and the service role, not anon")
    fn = "public.tally_split_of_firm(uuid,text)"
    ok(priv("authenticated", fn) == "false" and priv("anon", fn) == "false" and priv("service_role", fn) == "true", fn + ": the service role only")
    sd = db.rows("select p.proname, p.prosecdef::text sd, array_to_string(p.proconfig, ';') cfg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tally_split%'")
    ok(len(sd) == 4 and all(x["sd"] == "true" and "search_path=public, pg_temp" in x["cfg"] for x in sd), "every new function security definer, search_path public, pg_temp (%d)" % len(sd))
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
