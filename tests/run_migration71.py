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
                                           "migration-60-recorder-lows.sql", "migration-67-recorder-renumbered.sql")]
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
# the coordinator, 09-Oct-2026: "nothing dropped", not even a CHECK constraint: grep -ciE 'drop |delete from|truncate' gives 0
bad = [l for l in text.splitlines() if re.search(r"drop |delete from|truncate", l, re.I)]
ok(not bad, "0. add-only: no line with 'drop ', 'delete from' or 'truncate' (%d: %s)" % (len(bad), bad[:2]))
ok("constraint" not in low, "0. no constraint added, changed or dropped on an existing table (tally_alerts.kind as migration 47 made it)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_company_source_choose", "tally_company_source_lines", "tally_company_source_release", "tally_company_source_same", "tally_company_sources_note", "tally_company_sources_of",
           "tally_recorder_line", "tally_recorder_send_sourced", "tally_recorder_settle", "tally_source_chosen_marks", "tally_source_clean", "tally_source_mark", "tally_source_marks", "tally_source_reads", "tally_source_sort", "tally_source_words"], "0. the functions (%s)" % FNS)
# the coordinator's follow-up: 71's tally_recorder_settle is 47's with the one sorting step; 47's other lines kept word for word
_m47 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "tally-cloud", "migration-47-recorder-queue-alerts.sql")).read()
_s47 = re.search(r"create or replace function public\.tally_recorder_settle.*?end \$function\$;", _m47, re.S).group(0)
_s71 = re.search(r"create or replace function public\.tally_recorder_settle.*?end \$function\$;", text, re.S).group(0)
_keep = [l for l in _s47.splitlines() if l.strip().startswith(("perform pgmq", "update tally_recorder_pending", "return r", "returns jsonb"))]
ok(len(_keep) == 5 and all(l in _s71.splitlines() for l in _keep) and "revoke all on function public.tally_recorder_settle(bigint, jsonb) from public, anon, authenticated, service_role" in text,
   "0. 71's tally_recorder_settle keeps 47's archive, pending row, next message and grants")

# the re-review's N3: 71's tally_recorder_line is the combined text of 63 / 67 with the lines marked "71" added: every line of
# 67's text there, in order, and nothing else changed
_m67 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "tally-cloud", "migration-67-recorder-renumbered.sql")).read()
_l67 = re.search(r"create or replace function public\.tally_recorder_line\(.*?end \$function\$;", _m67, re.S)
_l71 = re.search(r"create or replace function public\.tally_recorder_line\(.*?end \$function\$;", text, re.S)
_rest = [l for l in (_l71.group(0).splitlines() if _l71 else []) if "-- 71" not in l]
_c67 = _l67.group(0).splitlines() if _l67 else []
_x = [l for l in _rest if l not in _c67]
ok(bool(_l71) and _x == [] and all(l in _rest for l in _c67), "0. N3: 71's tally_recorder_line is 67's text with the lines marked 71 only (changed or extra unmarked lines: %s)" % _x[:3])
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
    db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid, start_device) values (%s, %s, %s, 54389, '2026-10-05 07:09+05:30', %s, %s)" % (q(B), q(F), q(CG), q(CG), q(D1)))
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
    al = db.rows("select kind, words, data::text as data from tally_alerts where data->>'reason' = 'source'")
    ok(len(al) == 1 and al[0]["kind"] == "summary" and "GARG SHEKHAR & COMPANY is open in two places with different data" in al[0]["words"] and I2 in al[0]["data"],
       "2. ONE alert, an existing kind ('summary') with data.reason 'source' (%s)" % al)
    note([{"company_guid": CG, "data_id": I2, "path": P2, "computer": "PC-2", "own": True}], D2)
    note([{"company_guid": CG, "data_id": I2, "path": P2, "computer": "PC-2", "own": False}], D1)
    ok(int(db.one("select count(*) from tally_alerts where data->>'reason' = 'source'")) == 1 and src_rows()[I2]["choice"] == "pending", "2. seen again (even as its own): still pending, still one alert")
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

    print("== 6. the reviews of next-241: H3, M2, M3, SR-M2, SR-L1, H5, H2, L4")
    B3, B4, B5 = "f79e4bc3-871d-4482-874d-000000000073", "f79e4bc3-871d-4482-874d-000000000074", "f79e4bc3-871d-4482-874d-000000000075"
    for bk in (B3, B4, B5):
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31')" % (q(bk), q(F)))
    db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid, start_device) values (%s, %s, %s, 100, now(), %s, %s), (%s, %s, %s, 100, now(), %s, %s)"
           % (q(B4), q(F), q(CG), q(CG), q(D1), q(B5), q(F), q(CG), q(CG), q(D1)))
    def note_b(bk, src_, dev=D1): return j("select tally_company_sources_note(%s, %s, %s, %s)::text" % (q(F), q(bk), q(dev), js(src_)))
    def ch_of(bk): return {r["data_id"]: r["choice"] for r in db.rows("select data_id, choice from tally_company_sources where book_id = %s" % q(bk))}
    def alerts_of(bk): return int(db.one("select count(*) from tally_alerts where book_id = %s and data->>'reason' = 'source'" % q(bk)))
    # H3: another company GUID than the book's is never noted (nor chosen)
    a = note_b(B4, [{"company_guid": "another-guid", "data_id": I1, "path": P1, "own": True}])
    ok(ch_of(B4) == {} and a.get("ignored") and a["ignored"][0].get("otherCompany") is True, "6. H3: another company GUID: not noted, answered as another company (%s)" % a)
    # M2: chosen by itself only as the starting point's computer's location
    a = note_b(B4, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    ok(ch_of(B4) == {I2: "pending"} and alerts_of(B4) == 1, "6. M2: another computer's own location first: pending, with the alert (%s, %d)" % (ch_of(B4), alerts_of(B4)))
    a = note_b(B4, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D1)
    ok(ch_of(B4) == {I2: "pending", I1: "chosen"} and a.get("chosenIds") == [I1] and alerts_of(B4) == 1, "6. M2: the starting point's computer: chosen by itself (%s)" % a)
    # a book with no starting point yet: a lone location pending without an alert, chosen once its starting point is recorded
    a = note_b(B3, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D1)
    ok(ch_of(B3) == {I1: "pending"} and alerts_of(B3) == 0, "6. M2: no starting point yet: pending, no alert (%s)" % ch_of(B3))
    j("select tally_start_point(%s, %s, %s, 500, 50, %s, 'go-1')::text" % (q(F), q(B3), q(CG), q(D1)))
    note_b(B3, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D1)
    ok(ch_of(B3) == {I1: "chosen"}, "6. M2: its starting point recorded from that computer: chosen by itself (%s)" % ch_of(B3))
    # SR-M2: at most 20 locations a book
    for i_ in range(25): note_b(B5, [{"company_guid": CG, "data_id": did("x%d" % i_), "path": "x%d" % i_}], D2)
    ok(int(db.one("select count(*) from tally_company_sources where book_id = %s" % q(B5))) == 20, "6. SR-M2: at most 20 locations a book")
    # SR-L1: control characters and bidi overrides stripped
    note_b(B4, [{"company_guid": CG, "data_id": did("ctl"), "path": "D:\\x\u202e\u0007y", "w": "an\u200fshul", "computer": "PC\u00852"}], D2)
    r6 = db.rows("select path, win_user, computer from tally_company_sources where data_id = %s" % q(did("ctl")))[0]
    ok(r6 == {"path": "D:\\xy", "win_user": "anshul", "computer": "PC2"}, "6. SR-L1: control characters and bidi marks stripped (%s)" % r6)
    # H5 / H2 / L4: tally_recorder_send_sourced sorts the lines out under the lock
    def L5(lid, mid, alter, data_id=None, no=None):
        g = CG + "-%08x" % mid
        x = {"pc": "PC-2", "user": "T", "event": "created", "bridge": "go-2", "vch_no": no or str(mid), "ledgers": [], "line_id": lid, "alter_id": alter, "saved_at": "2026-10-06T05:00:00.000Z",
             "vch_date": "2026-10-03", "vch_type": "Sales", "master_id": str(mid), "object_guid": g, "company_guid": CG, "company": "GARG SHEKHAR & COMPANY",
             "vouchers": [{"guid": g, "alter": alter, "type": "Sales", "no": no or str(mid), "party": "Spike Customer", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": "2026-10-03"}],
             "lines": [[g, "Spike Customer", -118.0, "", None, []], [g, "Sales GST 18%", 118.0, "", None, []]]}
        if data_id is not None: x["data_id"] = data_id
        return x
    def sent(bk, lines, dev=D2): return j("select tally_recorder_send_sourced(%s, %s, %s, %s, false)::text" % (q(F), q(bk), q(dev), js(lines)))
    def vrow(bk, mid): return db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s" % (q(bk), q(CG + "-%08x" % mid)))
    r = sent(B4, [L5("p1", 900, 60001, I2), L5("c1", 901, 60002, I1, ), L5("n1", 902, 60003)], D2)
    held = {h["i"]: h["result"] for h in r.get("held", [])}
    ok(r.get("sentIdx") == [1] and held.get(0, {}).get("state") == "held" and held.get(2, {}).get("state") == "held", "6. H5/H2: the pending location's line and a line without data_id from a computer not chosen held, the chosen one's sent (%s)" % r)
    ok(vrow(B4, 900) == "0" and vrow(B4, 901) == "1" and vrow(B4, 902) == "0", "6. ... nothing of the held ones in the books")
    ok("Restart Tally so the 2.4.1 add-on loads" in held.get(2, {}).get("why", ""), "6. H2: the plain words (%s)" % held.get(2, {}).get("why"))
    kept = db.rows("select (body is not null)::text as b, payload->>'pending' as p from tally_recorder_lines where line_id = 'p1'")[0]
    ok(kept == {"b": "true", "p": "true"}, "6. H5: the pending location's line kept with its entry, marked pending (%s)" % kept)
    r = sent(B4, [L5("n2", 903, 60004)], D1)
    ok(r.get("sentIdx") == [0] and vrow(B4, 903) == "1", "6. H2: a line without data_id from the chosen location's computer: sent (%s)" % r)
    # "These are the same data": the pending lines applied
    db.sql("insert into members values ('%s', %s, 'Owner2', 'owner', true) on conflict do nothing" % ("33333333-3333-3333-3333-333333333333", q(F))) if False else None
    sm = as_user(OWNER, "select tally_company_source_same(%s)::text;" % q(B4))
    ok(isinstance(sm, dict) and sm.get("released") == 2 and vrow(B4, 900) == "1" and vrow(B4, 902) == "1" and ch_of(B4).get(I2) == "chosen", "6. H5: same data: both chosen, the held line applied (and, N1, PC-2's line without data id) (%s %s %s)" % (sm, ch_of(B4),
       db.rows("select line_id, state, held_why from tally_recorder_lines where line_id like 'p1%'")))
    ok(db.one("select state from tally_recorder_lines where line_id = 'p1'") == "duplicate", "6. H5: the held row marked, kept")
    ok(isinstance(as_user(STAFF, "select tally_company_source_same(%s)::text;" % q(B4)), dict) and "_error" in as_user(STAFF, "select tally_company_source_same(%s)::text;" % q(B4)), "6. same data: the owner only")
    # "Use ①" with a pending line held: it stays held for good
    r = sent(B5, [L5("q1", 950, 70001, did("x1"))], D2)
    as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B5), q(did("x0"))))
    ok(vrow(B5, 950) == "0" and db.one("select state from tally_recorder_lines where line_id = 'q1'") == "held", "6. H5: Use ①: the other location's held line stays held")
    # L4: chosen elsewhere between the note and the apply: the line is held at the apply
    r = sent(B5, [L5("q2", 951, 70002, did("x1"))], D2)
    ok(r.get("sentIdx") == [] and vrow(B5, 951) == "0", "6. L4: a line of a location not chosen at the apply: held (%s)" % r)
    # M3: choosing the location FinCom reads already (alone): stamped, the starting point not cleared
    db.sql("update tally_sync_cursor set cleared_at = null where book_id = %s" % q(B5))
    r = as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B5), q(did("x0"))))
    ok(isinstance(r, dict) and r.get("already") is True and r.get("startCleared") is False and db.one("select cleared_at is null from tally_sync_cursor where book_id = %s" % q(B5)) == "t",
       "6. M3: the already chosen location: who and when only, the starting point kept (%s)" % r)

    print("== 7. the coordinator's follow-ups: the drain re-checks the choice; choosing a pending location applies its lines after its new starting point")
    B6, B7 = "f79e4bc3-871d-4482-874d-000000000076", "f79e4bc3-871d-4482-874d-000000000077"
    for bk in (B6, B7):
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31')" % (q(bk), q(F)))
        db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid, start_device) values (%s, %s, %s, 100, now() - interval '1 day', %s, %s)" % (q(bk), q(F), q(CG), q(CG), q(D1)))
        note_b(bk, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D1)
        note_b(bk, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    # 1. L4 residual race: a burst queued from ① (chosen then), the owner chooses ② before the drain runs: nothing of ① applied
    burst = [L5("d%d" % i_, 1000 + i_, 61000 + i_, I1) for i_ in range(3)] + [L5("dn", 1099, 61099)]
    r = j("select tally_recorder_send_sourced(%s, %s, %s, %s, true)::text" % (q(F), q(B6), q(D1), js(burst)))
    ok((r.get("sent") or {}).get("queued") == 4 and r.get("sentIdx") == [0, 1, 2, 3], "7. a burst from \u2460 (chosen) queued (%s)" % r)
    as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B6), q(I2)))
    dr = j("select public.tally_recorder_drain(15000)::text")
    applied = [m for m in [1000, 1001, 1002, 1099] if vrow(B6, m) != "0"]
    st = {r_["line_id"]: (r_["event"], r_["state"]) for r_ in db.rows("select line_id, event, state from tally_recorder_lines where book_id = %s" % q(B6))}
    ok(not applied and st.get("d0") == ("other_source", "held") and st.get("dn") == ("other_source", "held"),
       "7. L4: the drain re-checks under the lock: nothing of \u2460 (now other) applied, its lines and the one without data id held (%s %s %s)" % (dr, applied, st))
    held_why = db.one("select held_why from tally_recorder_lines where book_id = %s and line_id = 'dn'" % q(B6))
    ok("Restart Tally so the 2.4.1 add-on loads" in (held_why or ""), "7. ... held exactly as tally_recorder_send_sourced holds it (%s)" % held_why)
    # 2. choosing \u2461 while it was pending: its held lines with entries applied once its new starting point is recorded,
    # only those above that starting point (AlterID); older ones stay held for the Day Book
    r = j("select tally_recorder_send_sourced(%s, %s, %s, %s, false)::text" % (q(F), q(B7), q(D2), js([L5("e1", 1200, 60500, I2), L5("e0", 1201, 40, I2)])))
    ok(len(r.get("held") or []) == 2, "7. \u2461's two lines held pending (%s)" % r)
    as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B7), q(I2)))
    note_b(B7, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    ok(vrow(B7, 1200) == "0", "7. not applied before \u2461's starting point is recorded afresh")
    sp7 = j("select tally_start_point(%s, %s, %s, 50, 10, %s, 'go-2')::text" % (q(F), q(B7), q(CG), q(D2)))
    note_b(B7, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    e = {r_["line_id"]: (r_["state"], r_["held_why"]) for r_ in db.rows("select line_id, state, held_why from tally_recorder_lines where book_id = %s and line_id in ('e1', 'e0')" % q(B7))}
    ok(sp7.get("afterClear") is True and vrow(B7, 1200) == "1" and vrow(B7, 1201) == "0" and e.get("e0", ("",))[0] == "held" and "Day Book" in (e.get("e0", ("", ""))[1] or ""),
       "7. after \u2461's new starting point (50): the line above it applied, the older one held for the Day Book (%s %s)" % (sp7, e))
    note_b(B7, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    ok(vrow(B7, 1201) == "0" and int(db.one("select count(*) from tally_recorder_lines where book_id = %s and line_id like 'e1%%'" % q(B7))) == 2, "7. once only (the next beat applies nothing again)")
    print("== 8. the re-review of next-241: N3 (the check where held lines are applied), N1 (lines without data id), the same data (Low)")
    B8, B9 = "f79e4bc3-871d-4482-874d-000000000078", "f79e4bc3-871d-4482-874d-000000000079"
    D3, D4 = "58d73e82-57f3-4f72-9f3d-14cc93a5b2b3", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b4"
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'PC-3', 'h3', '2.4.0'), (%s, %s, 'PC-4', 'h4', '2.4.1')" % (q(D3), q(F), q(D4), q(F)))
    for bk in (B8, B9):
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31')" % (q(bk), q(F)))
        db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid, start_device) values (%s, %s, %s, 100, now() - interval '1 day', %s, %s)" % (q(bk), q(F), q(CG), q(CG), q(D1)))
        note_b(bk, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D1)
    # N3: a line of ① held for a locked month; the owner switches to ②; the month unlocked; Apply now and the Day Book release: still held
    note_b(B8, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    as_user(OWNER, "select tally_month_lock('c1', '2026-09-03', 'tied')::text;")
    m1 = dict(L5("m1", 1300, 62000, I1), vch_date="2026-09-03"); m1["vouchers"][0]["day"] = "2026-09-03"
    r = sent(B8, [m1], D1)
    hw0 = db.one("select held_why from tally_recorder_lines where book_id = %s and line_id = 'm1'" % q(B8))
    ok(r.get("sentIdx") == [0] and vrow(B8, 1300) == "0" and (hw0 or "").startswith("month locked"), "8. N3: ①'s line held for its locked month (%s)" % hw0)
    as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B8), q(I2)))
    as_user(OWNER, "select tally_month_unlock('c1', '2026-09-01', 'a late bill')::text;")
    mid_ = db.one("select id from tally_recorder_lines where book_id = %s and line_id = 'm1'" % q(B8))
    rel = as_user(OWNER, "select tally_recorder_release_held(%s)::text;" % mid_)
    j("select tally_recorder_release_day(%s, '2026-09-03')::text" % q(B8))
    m1r = db.rows("select state, held_why from tally_recorder_lines where book_id = %s and line_id = 'm1'" % q(B8))[0]
    ok(vrow(B8, 1300) == "0" and m1r["state"] == "held" and "FinCom reads ②" in (m1r["held_why"] or ""),
       "8. N3: after the owner chose ② and unlocked the month, Apply now and the Day Book release keep ①'s line held (%s %s)" % (str(rel)[:200], m1r))
    # N1: lines without data id from a computer of no chosen location: kept WITH their entry; the words by the bridge's version
    r = sent(B9, [dict(L5("n3", 1310, 62100), pc="PC-3")], D3)
    r2 = sent(B9, [L5("n4", 1311, 62101)], D2)
    w3 = (r.get("held") or [{}])[0].get("result", {}).get("why", ""); w4 = (r2.get("held") or [{}])[0].get("result", {}).get("why", "")
    ok("Update FinCom Bridge on PC-3" in w3 and "Restart Tally" not in w3 and "Restart Tally so the 2.4.1 add-on loads" in w4,
       "8. N1: the words: a bridge before 2.4.1 'Update FinCom Bridge on PC-3', a 2.4.1 bridge 'Restart Tally' (%s | %s)" % (w3, w4))
    kb = db.rows("select line_id, (body is not null)::text as b, payload->>'pending' as p from tally_recorder_lines where book_id = %s and line_id in ('n3', 'n4') order by line_id" % q(B9))
    ok([(x["b"], x["p"]) for x in kb] == [("true", "true"), ("true", "true")], "8. N1: kept with their entry (%s)" % kb)
    note_b(B9, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D3)
    ok(vrow(B9, 1310) == "1" and vrow(B9, 1311) == "0", "8. N1: PC-3 proves the chosen location: its line applied, PC-2's still held")
    # N1: two computers of one data id are both its computers (the device column alone took turns)
    note_b(B9, [{"company_guid": CG, "data_id": I1, "path": P1, "own": True}], D4)
    r = sent(B9, [L5("n5", 1312, 62102)], D1)
    r2 = sent(B9, [L5("n6", 1313, 62103)], D4)
    ok(r.get("sentIdx") == [0] and r2.get("sentIdx") == [0] and vrow(B9, 1312) == "1" and vrow(B9, 1313) == "1", "8. N1: NWS144 and PC-4 both read ①: lines without data id from either sent (%s %s)" % (r, r2))
    # the same data (Low): never chooses a location the owner set to 'other'; only while one is pending; PC-2's lines without data id applied with it
    note_b(B9, [{"company_guid": CG, "data_id": did("x-other"), "path": "E:\\other", "own": True}], D4)
    as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B9), q(I1)))
    sm0 = as_user(OWNER, "select tally_company_source_same(%s)::text;" % q(B9))
    ok(isinstance(sm0, dict) and (sm0.get("ok") is False or "_error" in sm0) and ch_of(B9)[did("x-other")] == "other", "8. same data: nothing pending: refused, nothing chosen (%s)" % sm0)
    note_b(B9, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    sm = as_user(OWNER, "select tally_company_source_same(%s)::text;" % q(B9))
    ch9 = ch_of(B9)
    ok(isinstance(sm, dict) and sm.get("ok") is True and ch9[I2] == "chosen" and ch9[I1] == "chosen" and ch9[did("x-other")] == "other" and vrow(B9, 1311) == "1",
       "8. same data: the pending one chosen, the 'other' one stays other, PC-2's line without data id applied (%s %s)" % (sm, ch9))
    # N2: a lone pending location (the starting point came from another computer): the owner's Use ① applies its held lines
    B10 = "f79e4bc3-871d-4482-874d-000000000080"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31')" % (q(B10), q(F)))
    db.sql("insert into tally_sync_cursor (book_id, firm_id, company_guid, last_voucher_alterid, start_at, start_guid, start_device) values (%s, %s, %s, 100, now() - interval '1 day', %s, %s)" % (q(B10), q(F), q(CG), q(CG), q(D1)))
    note_b(B10, [{"company_guid": CG, "data_id": I2, "path": P2, "own": True}], D2)
    r = sent(B10, [L5("lp1", 1500, 50, I2), L5("lp2", 1501, 63000, I2)], D2)
    ok(ch_of(B10) == {I2: "pending"} and alerts_of(B10) == 1 and vrow(B10, 1500) == "0", "8. N2: a lone location pending (the starting point another computer's), with the alert, its lines held (%s)" % ch_of(B10))
    r = as_user(OWNER, "select tally_company_source_choose(%s, %s)::text;" % (q(B10), q(I2)))
    ok(isinstance(r, dict) and r.get("ok") is True and ch_of(B10) == {I2: "chosen"} and vrow(B10, 1500) == "1" and vrow(B10, 1501) == "1" and r.get("startCleared") is False,
       "8. N2: Use ① on the lone location: chosen, its held lines applied at once, the starting point kept (no other copy to mix) (%s)" % r)
    # the coordinator's item from the real-Tally dry run 37938029402: the bank route's re-send of an entry the add-on's line
    # brought (event altered, source bankdate, another line id, the SAME AlterID and entry) changes nothing in the cloud
    al = dict(L5("bk1", 1400, 62600, I1), event="altered")
    r = sent(B9, [al], D1)
    ok(r.get("sent", {}).get("applied") == 1 and vrow(B9, 1400) == "1", "8. the add-on's altered line applied (%s)" % r.get("sent"))
    snap = (tmd5("tally_vouchers", "book_id, guid"), tmd5("tally_lines", "book_id, guid, ledger, amount"))
    bk = dict(al, line_id="bankdate|%s|1400|62600" % CG.lower(), source="bankdate")
    r = sent(B9, [bk], D1)
    r2 = sent(B9, [bk], D1)
    st_ = [x.get("state") for x in (r.get("sent") or {}).get("results", [])] + [x.get("state") for x in (r2.get("sent") or {}).get("results", [])]
    ok(st_ == ["duplicate", "duplicate"] and (r2.get("sent") or {}).get("results", [{}])[0].get("already") is True
       and (tmd5("tally_vouchers", "book_id, guid"), tmd5("tally_lines", "book_id, guid, ledger, amount")) == snap,
       "8. the bank route's re-send at the same AlterID: duplicate (the same change already came), again: duplicate, already (63); the books unchanged (%s)" % st_)
    ro, rs, nf = as_user(OTHER, "select count(*) from tally_company_sources;"), as_user(STAFF, "select count(*) from tally_company_sources;"), int(db.one("select count(*) from tally_company_sources where firm_id = %s" % q(F)))
    ok(ro in (0, [0], ["0"]) and rs in (nf, [nf], [str(nf)]), "1. the firm reads its own rows only (RLS): another firm %s, the staff %s of %d" % (ro, rs, nf))
    after = counts()
    ok(all(after[k] >= before[k] for k in before), "5. nothing removed by the calls (%s -> %s)" % (before, after))
    r = psql_text(text)
    ok(r.returncode == 0 and src_rows()[I2]["choice"] == "chosen", "0. run again after use: the rows kept as they are")
finally:
    db.stop()
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
sys.exit(1 if fails else 0)
