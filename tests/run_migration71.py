"""python3 run_migration71.py - migration-71-company-sources (09-Oct-2026, FinCom Bridge 2.4.1: one company, two data
locations; the owner's approval of 09-Oct-2026, item 3). On throwaway PostgreSQL (pg_stand, port 30710 unless PG71_PORT;
never a real database), built 32 -> ... -> 58 -> 60 in staging's order (as run_migration67.py), then 71 three times.
  0. the file: one transaction, no 'delete from' anywhere, no drop or truncate, names no real database; every function
     security definer with search_path public, pg_temp; runs three times; nothing removed.
  1. the table: RLS on; anon nothing; authenticated SELECT only (no insert, update, delete); the firm reads its own rows
     only; the service functions not callable by authenticated.
  2. tally_company_sources_note: the first data id the bridge says is its own: 'chosen' by itself (today's setups
     unchanged); another: 'pending' with ONE alert (kind 'source'), never a second for it; validation: an id not 16 hex
     ignored, a path cut to 260, more than 50 sources refused.
  3. tally_company_source_lines: a line of the pending location kept 'held', event 'other_source', no GUID, MasterID,
     AlterID or body, the words "saved in another data location of <company> (②, <computer>); FinCom reads ①. Choose on
     the Tally page.", the bridge's received_at in the payload; the same line again: 'duplicate', already.
  4. tally_company_source_choose: staff, another firm's owner and a data id not of the book refused (nothing changed); the
     owner: ② chosen (who and when), ① other; the starting point cleared (cleared_at, cleared_by, state ok) and the next
     tally_start_point records it afresh (afterClear); nothing else written (tally_recorder_lines, tally_alerts and the
     book unchanged).
  5. nothing deleted: every row count the same or higher after each run and each call.
Prints md5 of the file. RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql",
                                           "migration-60-recorder-lows.sql")]
M71 = os.environ.get("M71_FILE") or os.path.join(SQLDIR, "migration-71-company-sources.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "66666666-6666-6666-6666-666666666666"
B, B2, D1, D2 = "f79e4bc3-871d-4482-874d-000000000071", "f79e4bc3-871d-4482-874d-000000000072", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b2"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
def did(p): return hashlib.sha256(p.strip().lower().encode()).hexdigest()[:16]
P1, P2 = r"C:\Users\Public\TallyPrime\Data", r"D:\Copy of Tally\DATA"
I1, I2 = did(P1), did(P2)

text = open(M71).read() if os.path.exists(M71) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M71))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  migration-71 md5: %s" % hashlib.md5(open(M71, "rb").read()).hexdigest())
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
ok(not re.search(r"\bdrop\s+(table|function|column|index|policy|schema|view|trigger)\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop of anything but the one CHECK swapped in place, no truncate)")
ok(low.count("drop constraint") == 1 and "add constraint %i check (kind in (''gap'', ''silent'', ''summary'', ''source''))" in low, "0. the one CHECK on tally_alerts.kind swapped in one statement for a wider one")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_company_source_choose", "tally_company_source_lines", "tally_company_sources_note", "tally_company_sources_of", "tally_source_mark", "tally_source_marks"], "0. the functions (%s)" % FNS)

db = pg_stand.start(int(os.environ.get("PG71_PORT") or 30710))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s):
    try: x = db.one(s)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def as_user(uid, sql):
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
                       input="set fincom.uid = '%s'; set fincom.role = 'authenticated'; set role authenticated;\n%s" % (uid, sql), capture_output=True, text=True)
    if r.returncode: return {"_error": r.stderr.strip()[-400:]}
    out = r.stdout.strip().splitlines()
    try: return json.loads(out[-1]) if out else None
    except ValueError: return out
def counts():
    return {t: int(db.one("select case when to_regclass(%s) is null then 0 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from %s', false, true, '')))[1]::text::int end" % (q("public." + t), t))) for t in ("tally_company_sources", "tally_recorder_lines", "tally_alerts", "tally_books", "tally_sync_cursor", "members")}
def tmd5(t, order): return db.one("select md5(coalesce(string_agg(x::text, '|' order by %s), '')) from %s x" % (order, t))
def note(src, dev=D1, book=B): return j("select tally_company_sources_note(%s, %s, %s, %s)::text" % (q(F), q(book), q(dev), js(src)))
def src_rows(): return {r["data_id"]: r for r in db.rows("select data_id, choice, path, computer, win_user, chosen_by::text as chosen_by, (chosen_at is not null)::text as chosen_at from tally_company_sources where book_id = %s" % q(B))}
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Garg Shekhar & Company'), (%(F2)s, 'Other firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31'),
        (%(B2)s, %(F2)s, 'c9', 'OTHER FIRM CO', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.4.1'), (%(D2)s, %(F)s, 'PC-2', 'h2', '2.4.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
      grant select on members, firms to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "B": q(B), "B2": q(B2), "D1": q(D1), "D2": q(D2)})
    # as Supabase: every new table, sequence and function in public granted to anon, authenticated and service_role by default
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role; alter default privileges in schema public grant all on functions to anon, authenticated, service_role;")
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid) values (%s, %s, %s, 54389, '2026-10-05 07:09+05:30', %s)" % (q(B), q(F), q(CG), q(CG)))
    db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, state) values (%s, 'c1', %s, %s, 'before-71', 'created', 'applied')" % (q(F), q(B), q(D1)))
    db.sql("insert into tally_alerts (firm_id, client_id, book_id, kind, day, words) values (%s, 'c1', %s, 'gap', '2026-10-08', 'an older gap')" % (q(F), q(B)))
    c0 = counts()
    for i in (1, 2, 3):
        r = psql_text(text)
        ok(r.returncode == 0, "71 runs (%d of 3): %s" % (i, r.stderr[-300:]))
        c = counts()
        ok(all(c[k] >= c0[k] for k in c0), "5. nothing removed by run %d (%s -> %s)" % (i, c0, c))
    ok(db.one("select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tally_company_source_choose', 'tally_company_source_lines', 'tally_company_sources_note', 'tally_company_sources_of', 'tally_source_marks')")
       == "tally_company_source_choose:true:search_path=public, pg_temp tally_company_source_lines:true:search_path=public, pg_temp tally_company_sources_note:true:search_path=public, pg_temp tally_company_sources_of:true:search_path=public, pg_temp tally_source_marks:true:search_path=public, pg_temp",
       "0. security definer, search_path public, pg_temp")

    print("== 1. the table: RLS, grants")
    ok(db.one("select relrowsecurity::text from pg_class where oid = 'public.tally_company_sources'::regclass") == "true", "1. RLS on")
    PR = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
    def privs(role): return [p for p in PR if db.one("select has_table_privilege(%s, 'public.tally_company_sources', %s)::text" % (q(role), q(p))) == "true"]
    ok(privs("anon") == [] and privs("authenticated") == ["SELECT"], "1. anon nothing, authenticated SELECT only (%s, %s)" % (privs("anon"), privs("authenticated")))
    def can(role, fn): return db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(fn)))
    ok(all(can(r, "public.tally_company_sources_note(uuid, uuid, uuid, jsonb)") == "false" and can(r, "public.tally_company_source_lines(uuid, uuid, uuid, jsonb)") == "false" for r in ("anon", "authenticated"))
       and can("service_role", "public.tally_company_sources_note(uuid, uuid, uuid, jsonb)") == "true", "1. the service functions: service_role only")
    ok(can("anon", "public.tally_company_source_choose(uuid, text)") == "false" and can("authenticated", "public.tally_company_source_choose(uuid, text)") == "true", "1. choose: authenticated (the owner check inside), not anon")

    print("== 2. note: the first own data id chosen by itself; another pending with ONE alert")
    a = note([{"company_guid": CG, "data_id": I1, "path": P1, "w": "anshul", "computer": "NWS144", "own": True}])
    ok(a.get("ok") is True and a.get("chosenId") == I1 and src_rows().get(I1, {}).get("choice") == "chosen", "2. the first own data id: chosen (%s)" % a)
    a = note([{"company_guid": CG, "data_id": I2, "path": P2, "w": "anshul", "computer": "PC-2", "own": False}], D2)
    ok(a.get("chosenId") == I1 and src_rows().get(I2, {}).get("choice") == "pending", "2. another data id: pending (%s)" % a)
    ok([x.get("n") for x in a.get("sources", [])] == ["\u2460", "\u2461"], "2. marked \u2460 \u2461 by first seen (%s)" % a.get("sources"))
    al = db.rows("select kind, words, data::text as data from tally_alerts where kind = 'source'")
    ok(len(al) == 1 and "GARG SHEKHAR & COMPANY is open in two places with different data" in al[0]["words"] and I2 in al[0]["data"], "2. ONE alert (%s)" % al)
    note([{"company_guid": CG, "data_id": I2, "path": P2, "computer": "PC-2", "own": True}], D2)
    note([{"company_guid": CG, "data_id": I2, "path": P2, "computer": "PC-2", "own": False}], D1)
    ok(int(db.one("select count(*) from tally_alerts where kind = 'source'")) == 1 and src_rows()[I2]["choice"] == "pending", "2. seen again (even as its own): still pending, still one alert")
    a = note([{"company_guid": CG, "data_id": "XYZ", "path": "x"}, {"company_guid": CG, "data_id": did("E:\\long"), "path": "E:\\" + "a" * 400, "own": False}])
    ok(len(src_rows().get(did("E:\\long"), {}).get("path", "")) == 260 and "XYZ" not in json.dumps(src_rows()), "2. an id not 16 hex ignored; a path cut to 260")
    a = note([{"company_guid": CG, "data_id": did("x%d" % i)} for i in range(51)])
    ok(a.get("ok") is False and "50" in a.get("error", ""), "2. more than 50 sources a call refused (%s)" % a)
    ok(isinstance(as_user(OWNER, "select tally_company_sources_note(%s, %s, %s, %s)::text;" % (q(F), q(B), q(D1), js([{"data_id": I1}]))), dict), "2. not callable by a member")

    print("== 3. lines of a location FinCom does not read: held, never applied")
    L = {"line_id": "os-1", "event": "other_source", "of": "created", "company_guid": CG, "company": "GARG SHEKHAR & COMPANY", "vch_type": "Sales", "vch_no": "2026-27/GST/297",
         "vch_date": "2026-10-09", "saved_at": "2026-10-09T11:30:00+05:30", "received_at": "2026-10-09T11:30:07+05:30", "pc": "PC-2", "w": "anshul", "data_id": I2, "data_path": P2}
    r = j("select tally_company_source_lines(%s, %s, %s, %s)::text" % (q(F), q(B), q(D2), js([L])))
    want = "saved in another data location of GARG SHEKHAR & COMPANY (\u2461, PC-2); FinCom reads \u2460. Choose on the Tally page."
    ok(r.get("ok") is True and r["results"][0]["state"] == "held" and r["results"][0]["why"] == want, "3. held with the words (%s)" % r)
    row = db.rows("select event, state, object_guid, master_id, alter_id::text as alter_id, body::text as body, held_why, payload->>'received_at' as ra, payload->>'dataId' as did from tally_recorder_lines where line_id = 'os-1'")[0]
    ok(row["event"] == "other_source" and row["state"] == "held" and not row["object_guid"] and not row["master_id"] and not row["alter_id"] and not row["body"], "3. no GUID, MasterID, AlterID or body (%s)" % row)
    ok(row["ra"] and row["ra"].startswith("2026-10-09T06:00:07") and row["did"] == I2, "3. the bridge's received_at and the data id in the payload (%s)" % row)
    r = j("select tally_company_source_lines(%s, %s, %s, %s)::text" % (q(F), q(B), q(D2), js([L])))
    ok(r["results"][0]["state"] == "duplicate" and r["results"][0].get("already") is True and int(db.one("select count(*) from tally_recorder_lines where line_id = 'os-1'")) == 1, "3. the same line again: duplicate, kept once")
    rel = as_user(OWNER, "select tally_recorder_release_held(%s)::text;" % db.one("select id from tally_recorder_lines where line_id = 'os-1'"))
    ok(db.one("select count(*) from tally_vouchers where book_id = %s" % q(B)) == "0", "3. an owner's release applies nothing (%s)" % str(rel)[:200])

    print("== 4. choose: the owner only; ② chosen, the starting point cleared, nothing else written")
    before = counts(); rl, alx, bk = tmd5("tally_recorder_lines", "id"), tmd5("tally_alerts", "id"), tmd5("tally_books", "book_id")
    for who, name in ((STAFF, "staff"), (OTHER, "another firm's owner")):
        r = as_user(who, "select tally_company_source_choose(%s, %s)::text;" % (q(B), q(I2)))
        ok(isinstance(r, dict) and "_error" in r and src_rows()[I2]["choice"] == "pending", "4. %s refused, nothing changed (%s)" % (name, str(r)[:160]))
    r = as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B), q(did("not-a-source"))))
    ok(isinstance(r, dict) and "not a data location" in r.get("_error", ""), "4. a data id not of the book refused (%s)" % str(r)[:160])
    r = as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B2), q(I2)))
    ok(isinstance(r, dict) and "_error" in r, "4. another firm's book refused")
    r = as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B), q(I2)))
    s = src_rows()
    ok(isinstance(r, dict) and r.get("ok") is True and r.get("n") == "\u2461" and s[I2]["choice"] == "chosen" and s[I2]["chosen_by"] == OWNER and s[I2]["chosen_at"] == "true" and s[I1]["choice"] == "other",
       "4. \u2461 chosen by the owner, \u2460 other (%s %s)" % (r, {k: v["choice"] for k, v in s.items()}))
    cur = db.rows("select state, cleared_by::text as by, (cleared_at > start_at)::text as fresh, cleared_note from tally_sync_cursor where book_id = %s" % q(B))[0]
    ok(cur["state"] == "ok" and cur["by"] == OWNER and cur["fresh"] == "true" and "chosen" in cur["cleared_note"], "4. the starting point cleared as tally_baseline_clear clears it (%s)" % cur)
    ok(tmd5("tally_recorder_lines", "id") == rl and tmd5("tally_alerts", "id") == alx and tmd5("tally_books", "book_id") == bk, "4. nothing else written (lines, alerts, books unchanged)")
    sp = j("select tally_start_point(%s, %s, %s, 61000, 15000, %s, 'go-2')::text" % (q(F), q(B), q(CG), q(D2)))
    ok(sp.get("set") is True and sp.get("afterClear") is True and sp.get("startVoucher") == 61000, "4. the next start point (the chosen location's) recorded afresh (%s)" % sp)
    l2 = dict(L, line_id="os-2", data_id=I1, data_path=P1, pc="NWS144")
    r = j("select tally_company_source_lines(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js([l2])))
    ok(r["results"][0]["why"] == "saved in another data location of GARG SHEKHAR & COMPANY (\u2460, NWS144); FinCom reads \u2461. Choose on the Tally page.", "4. \u2460's lines now held with \u2460's words (%s)" % r["results"][0]["why"])
    of = as_user(OWNER, "select tally_company_sources_of(%s)::text;" % q(B))
    ok(isinstance(of, list) and [x["n"] for x in of][:2] == ["\u2460", "\u2461"] and of[1]["chosenBy"] == "Anshul", "4. sources_of: marks and who chose (%s)" % str(of)[:300])
    ok(as_user(OTHER, "select tally_company_sources_of(%s)::text;" % q(B)) == [], "4. sources_of: another firm sees nothing")
    ro, rs = as_user(OTHER, "select count(*) from tally_company_sources;"), as_user(STAFF, "select count(*) from tally_company_sources;")
    ok(ro in (0, [0], ["0"]) and rs in (len(s), [len(s)], [str(len(s))]), "1. the firm reads its own rows only (RLS): another firm %s, the staff %s of %d" % (ro, rs, len(s)))
    after = counts()
    ok(all(after[k] >= before[k] for k in before), "5. nothing removed by the calls (%s -> %s)" % (before, after))
    r = psql_text(text)
    ok(r.returncode == 0 and src_rows()[I2]["choice"] == "chosen", "0. run again after use: the rows kept as they are")
finally:
    db.stop()
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
