"""python3 run_migration69.py - migration-69-recorder-push (07-Oct-2026, FinCom Bridge next, branch next-push: the add-on's full
entry at save, sent with NO AlterID and its order in push_seq). On throwaway PostgreSQL (pg_stand, port 30690 unless PG69_PORT;
never a real database), built 32 -> ... -> 58 in staging's order, then 60, then 69 (twice).
  0. the file: one transaction, no 'delete from' anywhere, add-only, no real database named; one function, tally_recorder_line:
     60's text with only lines marked "69" changed; granted to nobody; run twice, the same text; it stops (nothing changed)
     where 63's tally_recorder_line has run.
  1. RED on 60: two alterations of one entry, both full entries without an AlterID: the second is 'duplicate' of the first
     (lost until a Day Book). Under 69 both apply, the copy holds the second; one live entry, its lines replaced.
  2. the same full entry again (its push_seq): 'duplicate'; an older one late: 'stale'.
  3. a full entry of a GUID whose delete is applied: 'stale', no entry; whose cancel is applied: applied, cancelled again.
  4. the body keeps the copy's AlterID (a full entry has none).
  5. unchanged: a line WITH an AlterID as 60 (same AlterID: 'duplicate'); a 2.3.2 line without one never the same as a full entry.
Prints md5(prosrc) of tally_recorder_line under 60 and under 69."""
import os, re, sys, json, hashlib, subprocess, difflib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql")]
M60 = os.path.join(SQLDIR, "migration-60-recorder-lows.sql")
M69 = os.environ.get("M69_FILE") or os.path.join(SQLDIR, "migration-69-recorder-push.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "f79e4bc3-871d-4482-874d-000000000069", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: CG + "-%08x" % mid
START = 50000


text = open(M69).read() if os.path.exists(M69) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M69))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\b", low) and "create table" not in low, "0. add-only (no drop, truncate, table change)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == ["tally_recorder_line"], "0. one function replaced: tally_recorder_line (%s)" % FNS)
m60 = open(M60).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L60 = block(m60, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L69 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
hunks, cur = [], None
for d in difflib.unified_diff(L60.split("\n"), L69.split("\n"), lineterm="", n=0):
    if d.startswith("@@"): cur = []; hunks.append(cur)
    elif cur is not None and d[:1] in "+-" and not d.startswith(("+++", "---")): cur.append(d)
unmarked = [h for h in hunks if not any(re.search(r"--.*\b69\b", x) for x in h if x.startswith("+"))]
ok(L60 != L69 and not unmarked, "0. tally_recorder_line is 60's text but %d changed places, each marked '69' (unmarked: %s)" % (len(hunks), unmarked[:1]))
ok(L69.rstrip().endswith("revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;"), "0. granted to nobody, as in 60")

db = pg_stand.start(int(os.environ.get("PG69_PORT") or 30690))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def res(r): return [(x.get("state"), x.get("why") or "") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else [("error", json.dumps(r)[:400])]
def P(lid, ev, mid, seq, party="Spike Customer", amt=118.0, alter=None):
    """a full entry from the add-on (no AlterID unless given; its order push_seq), its body as tally-ingest reads the bridge's XML"""
    x = {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-next", "vch_no": str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter,
         "saved_at": "2026-10-07T05:00:00.000Z", "vch_date": "20261003", "vch_type": "Sales", "master_id": str(mid), "object_guid": G(mid), "company_guid": CG,
         "company": "GARG SHEKHAR & COMPANY", "full": True}
    if seq is not None:
        x["push"], x["push_seq"] = True, seq
    x["vouchers"] = [{"guid": G(mid), "alter": alter or 0, "type": "Sales", "no": str(mid), "party": party, "narr": party, "cancel": False, "opt": False, "gstin": "", "pos": "",
                      "ref": "", "refDate": "", "cmp": "", "fid": None, "day": "2026-10-03", "full": True}]
    x["lines"] = [[G(mid), party, -amt, "", None, []], [G(mid), "Sales GST 18%", round(amt / 1.18, 2), "", None, []], [G(mid), "CGST Output 9%", round(amt - round(amt / 1.18, 2), 2), "", None, []]]
    return x
def L(lid, ev, mid, alter):
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-next", "vch_no": str(mid), "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter,
            "saved_at": "2026-10-07T05:00:00.000Z", "vch_date": "20261003", "vch_type": "Sales", "master_id": str(mid), "object_guid": G(mid), "company_guid": CG, "company": "GARG SHEKHAR & COMPANY"}
def vrow(mid): return (db.rows("select coalesce(cancelled, false)::text as cancelled, (deleted_at is not null)::text as deleted, alter_id::text as alter_id, party, narration from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(mid)))) or [None])[0]
def nlive(mid): return db.one("select count(*) from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(B), q(G(mid))))
def lines(mid): return db.one("select string_agg(ledger || ' ' || amount::text, ', ' order by ledger) from tally_lines where book_id = %s and guid = %s" % (q(B), q(G(mid))))
def prosrc(): return db.one("select md5(prosrc) from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure")
def can(role): return db.one("select has_function_privilege(%s, 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)', 'execute')" % q(role))
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES + [M60]:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    under60 = prosrc()
    print("  tally_recorder_line prosrc md5 under 60: %s" % under60)
    print("== 1. RED on 60: the second alteration without an AlterID")
    r = res(apply([P("r-cre", "created", 800, 100), P("r-alt1", "altered", 800, 101, party="Party One"), P("r-alt2", "altered", 800, 102, party="Party Two")]))
    print("  (60) " + str(r))
    red = [x[0] for x in r] != ["applied", "applied", "applied"]
    ok(red, "1. on 60 the second alteration is NOT applied (%s): the reason for 69" % [x[0] for x in r])
    # 63 has run here (simulated: 60's text with a "-- 63" line): 69 stops, nothing changed
    m63 = m60.replace("  then_cancel boolean := false; res3 jsonb;", "  then_cancel boolean := false; res3 jsonb;     -- 63 (simulated)")
    r63 = psql_text(m63)
    ok(r63.returncode == 0, "63 simulated runs: " + r63.stderr[-200:])
    s63 = prosrc()
    r = psql_text(text)
    ok(r.returncode != 0 and "rebased on 63" in r.stderr and prosrc() == s63, "0. after 63: 69 stops, the function unchanged (%s)" % r.stderr.strip()[-160:])
    r = psql_text(m60)
    ok(r.returncode == 0 and prosrc() == under60, "60 back")
    for i in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "69 runs (%s time): %s" % ("first" if i == 1 else "second", r.stderr[-300:]))
        if i == 1: after1 = prosrc()
    after = prosrc()
    print("  tally_recorder_line prosrc md5 under 69: %s" % after)
    ok(after != under60 and after == after1, "0. 69 replaces the line's text, the same both runs")
    ok(db.one("select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = 'public.tally_recorder_line(uuid, uuid, jsonb, bigint)'::regprocedure") == "true search_path=public, pg_temp", "0. security definer, search_path public, pg_temp")
    ok(all(can(r) in ("f", "false", False) for r in ("anon", "authenticated", "service_role")), "0. granted to nobody")

    print("== 1. under 69: every alteration applies; one live entry")
    r = res(apply([P("a-cre", "created", 801, 200), P("a-alt1", "altered", 801, 201, party="Party One", amt=236.0), P("a-alt2", "altered", 801, 202, party="Party Two", amt=354.0)]))
    v = vrow(801)
    ok([x[0] for x in r] == ["applied", "applied", "applied"], "1. created, altered, altered again: all applied (%s)" % r)
    ok(v and v["party"] == "Party Two" and str(nlive(801)) == "1" and "Party Two -354" in (lines(801) or "") and "Party One" not in (lines(801) or ""),
       "1. the copy holds the last alteration, one live entry, its lines replaced (%s; %s)" % (v, lines(801)))

    print("== 2. the same full entry again; an older one late")
    r = res(apply([P("a-alt2-again", "altered", 801, 202, party="Party Two", amt=354.0)]))
    ok(r[0][0] == "duplicate", "2. the same push_seq again: 'duplicate' (%s)" % r)
    r = res(apply([P("a-alt-late", "altered", 801, 150, party="Party Late", amt=472.0)]))
    ok(r[0][0] == "stale" and vrow(801)["party"] == "Party Two", "2. an older full entry late: 'stale', the copy unchanged (%s)" % r)

    print("== 3. after a delete; after a cancel")
    r = res(apply([P("d-cre", "created", 802, 300), L("d-del", "deleted", 802, None), P("d-alt", "altered", 802, 301, party="Back")]))
    ok([x[0] for x in r] == ["applied", "applied", "stale"] and vrow(802)["deleted"] == "true", "3. a full entry after its delete: 'stale', still deleted (%s %s)" % (r, vrow(802)))
    r = res(apply([P("c-cre", "created", 803, 400), L("c-can", "cancelled", 803, None), P("c-alt", "altered", 803, 401, party="Late")]))
    v = vrow(803)
    ok([x[0] for x in r] == ["applied", "applied", "applied"] and "then cancelled" in r[2][1] and v["cancelled"] == "true", "3. after its cancel: applied, then cancelled again (%s %s)" % (r, v))

    print("== 4. the copy's AlterID kept")
    r = res(apply([P("k-cre", "created", 804, None, alter=50200), P("k-alt", "altered", 804, 500, party="Kept")]))
    v = vrow(804)
    ok([x[0] for x in r] == ["applied", "applied"] and v["alter_id"] == "50200" and v["party"] == "Kept", "4. a full entry over a body with AlterID 50200: applied, AlterID kept (%s %s)" % (r, v))

    print("== 5. unchanged")
    r = res(apply([P("u-a", "altered", 805, None, alter=50300), P("u-b", "altered", 805, None, alter=50300)]))
    ok([x[0] for x in r] == ["applied", "duplicate"], "5. lines with an AlterID: as 60, the same AlterID 'duplicate' (%s)" % r)
    r = res(apply([P("u-c", "altered", 806, 600), P("u-d", "altered", 806, None, party="old route")]))
    ok(r[1][0] != "duplicate", "5. a 2.3.2 line without an AlterID is not the same change as a full entry (%s)" % r)
    ok(prosrc() == after, "0. tally_recorder_line is still 69's at the end")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
