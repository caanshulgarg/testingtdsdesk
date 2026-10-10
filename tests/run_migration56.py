"""python3 run_migration56.py - migration-56-keep-fields (06-Oct-2026, live in FinCom Bridge 2.3.0: a recorder line applied to an
entry loaded from a Day Book blanked the GSTIN, place of supply, reference no. / date, company GSTIN and the lines' HSN / rate,
which the live request does not fetch). On throwaway PostgreSQL (pg_stand, port 30560; never a real database), built 32 -> ...
-> 54 -> 55 in staging's order; entries blanked under 55 (as on 2.3.0); then 56 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; every function security definer, search_path public, pg_temp; tally_recorder_line is 53's text with the
     one call changed; 48's tally_ingest_entries (3 and 4 arguments) and tally_ingest_day untouched; the grants.
  1. KEEP: a Day Book load with GSTIN / pos / ref / ref date / company GSTIN and lines with HSN / rate, then a recorder alter
     with blanks: all kept (lines, by ledger: one HSN and rate on all the stored lines -> carried; the same amounts -> each
     its own; else blank).
  2. a recorder line with a NEW non-blank value (GSTIN, pos, an HSN, a rate) updates it.
  3. REPAIR: tally_recorder_blanked (and tests/check_recorder_blanked.sql, the same) lists exactly the entry blanked under 55;
     tally_recorder_restore_fields restores it and touches nothing else (a field made non-blank since is not overwritten; an
     entry whose day a Day Book re-read after the recorder is not touched; an entry only a Day Book changed is not touched);
     logged; run twice (the second run changes nothing). Refused to authenticated.
  4. a Day Book reload with blanks still replaces as today (the Day Book is authoritative).
  5. tally_unknown_ledger_entries: the live entries naming a ledger not in tally_ledgers (or only there deleted), with the
     names; firm-scoped (a member never reads another firm's book); read-only.
Prints md5(pg_get_functiondef) of every function of the file.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql")]
M56 = os.environ.get("M56_FILE") or os.path.join(SQLDIR, "migration-56-keep-fields.sql")
CHECK = os.path.join(HERE, "check_recorder_blanked.sql")
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
B, D1 = "f79e4bc3-871d-4482-874d-000000000056", "58d73e82-57f3-4f72-9f3d-14cc93a5b2b1"
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
G = lambda mid: CG + "-%08x" % mid
START = 50000
GST1, GST2, CMP = "07AAACG1234A1Z5", "27AABCS9999B1Z1", "07AAGFG0000A1Z9"

text = open(M56).read() if os.path.exists(M56) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M56))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1, "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included): %d" % low.count("delete from"))
low_nr = "\n".join(x for x in low.split("\n") if not re.match(r"\s*revoke\b", x))     # review M2: "revoke ... truncate" is the only truncate allowed
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low_nr) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low), "0. add-only (no drop, no truncate, no rename)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == sorted(["tally_recorder_keep_vouchers", "tally_recorder_keep_lines", "tally_ingest_entries", "tally_recorder_line", "tally_recorder_blanked", "tally_recorder_restore_fields", "tally_unknown_ledger_entries", "tally_recorder_pair_lines"]), "0. the functions of the file (%s)" % FNS)
m53 = open(os.path.join(SQLDIR, "migration-53-recorder-placeholder-settled.sql")).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L53 = block(m53, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L56 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
ok(L56 == L53.replace("res := tally_ingest_entries(p_book, vs, p_line->'lines', not once);", "res := tally_ingest_entries(p_book, vs, p_line->'lines', not once, true);     -- 56: the recorder keeps what its request does not fetch"),
   "0. tally_recorder_line is 53's text, byte for byte, but the one call (now with the recorder's keep, true)")

db = pg_stand.start(int(os.environ.get("M56_PORT") or 30560))
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def j(s, uid=None):
    try: x = db.one(s, uid)
    except RuntimeError as e: return {"_error": str(e)[-400:]}
    try: return json.loads(x)
    except (TypeError, ValueError): return {"_error": x}
def apply(lines): return j("select tally_recorder_apply(%s, %s, %s, %s)::text" % (q(F), q(B), q(D1), js(lines)))
def states(r): return [x.get("state") for x in r.get("results", [])] if isinstance(r, dict) and "results" in r else r
def day(d, vouchers, lines): return j("select tally_ingest_day(%s, %s, %s, %s, %d, %d, 0)::text" % (q(B), q(d), js(vouchers), js(lines), len(vouchers), max([v["alter"] for v in vouchers] + [0])))
def V(mid, alter, no, d, party, gstin="", pos="", ref="", refDate="", cmp=""):
    return {"guid": G(mid), "alter": alter, "type": "Sales", "no": no, "party": party, "narr": "", "cancel": False, "opt": False, "gstin": gstin, "pos": pos, "ref": ref, "refDate": refDate, "cmp": cmp, "fid": None, "day": d}
def rline(lid, mid, alter, no, d, v, lines, ev="altered"):
    return {"pc": "NWS144", "user": "TALLY User", "event": ev, "bridge": "go-2.3.0", "vch_no": no, "ledgers": [], "line_id": lid, "save_ms": 0, "alter_id": alter, "saved_at": "2026-10-06T05:00:00.000Z",
            "vch_date": d, "vch_type": "Sales", "master_id": str(mid), "object_guid": G(mid), "company_guid": CG, "company": "GARG SHEKHAR & COMPANY", "vouchers": [v], "lines": lines}
def vrow(mid): return (db.rows("select gstin, pos, ref, coalesce(ref_date::text, '') as ref_date, cmp_gstin, alter_id::text as alter_id from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(G(mid)))) or [{}])[0]
def lrows(mid): return [(r["ledger"], r["amount"], r["hsn"], r["rate"]) for r in db.rows("select ledger, amount::text as amount, coalesce(hsn, '') as hsn, coalesce(rate::text, '') as rate from tally_lines where book_id = %s and guid = %s order by ledger, amount" % (q(B), q(G(mid))))]
# M56_THEN_57=1 (06-Oct-2026, bridge 2.3.1 part A): migration 57 is run twice right after 56, and every check below runs on
# top of it; the rows are compared without 57's added columns (at their defaults), and 57's tally_ingest_day (44's text
# with its one call through the 5-argument form, checked by run_migration57.py) is the one function text allowed to differ
ON57 = os.environ.get("M56_THEN_57") == "1"
NEW57 = {"tally_vouchers": ("irn", "irn_ack_no", "irn_ack_date", "eway_no", "check_notes"), "tally_bills": ("due",)}
def snap():
    """every row of the entry tables (the cells the repair may write and the rest)"""
    if ON57 and db.one("select count(*) from information_schema.columns where table_name = 'tally_vouchers' and column_name = 'irn'") == "1":
        cut = lambda t: "".join(" - %s" % q(c) for c in NEW57.get(t, ()))
        return {"v": {r["guid"]: r for r in [{k: v for k, v in r.items() if k not in NEW57["tally_vouchers"]} for r in db.rows("select * from tally_vouchers where book_id = %s" % q(B))]},
                "l": sorted(tuple(sorted(r.items())) for r in db.rows("select guid, ledger, amount::text, hsn, rate::text, day::text from tally_lines where book_id = %s" % q(B))),
                "other": {t: db.one("select md5(coalesce(string_agg(y, '|' order by y), '')) from (select (to_jsonb(x)%s)::text as y from %s x) z" % (cut(t), t)) if t in NEW57 else
                          db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in ("tally_bills", "tally_voucher_versions", "tally_ledger_day", "tally_days", "tally_recorder_lines", "tally_books", "tally_ledgers")}}
    if ON57:
        return {"v": {r["guid"]: r for r in db.rows("select * from tally_vouchers where book_id = %s" % q(B))},
                "l": sorted(tuple(sorted(r.items())) for r in db.rows("select guid, ledger, amount::text, hsn, rate::text, day::text from tally_lines where book_id = %s" % q(B))),
                "other": {t: db.one("select md5(coalesce(string_agg(y, '|' order by y), '')) from (select to_jsonb(x)::text as y from %s x) z" % t) if t in NEW57 else
                          db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in ("tally_bills", "tally_voucher_versions", "tally_ledger_day", "tally_days", "tally_recorder_lines", "tally_books", "tally_ledgers")}}
    return {"v": {r["guid"]: r for r in db.rows("select * from tally_vouchers where book_id = %s" % q(B))},
            "l": sorted(tuple(sorted(r.items())) for r in db.rows("select guid, ledger, amount::text, hsn, rate::text, day::text from tally_lines where book_id = %s" % q(B))),
            "other": {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in ("tally_bills", "tally_voucher_versions", "tally_ledger_day", "tally_days", "tally_recorder_lines", "tally_books", "tally_ledgers")}}
def fdef(sig): return db.one("select pg_get_functiondef(%s::regprocedure)" % q("public." + sig)) or ""
def prosrc(sig): return db.one("select prosrc from pg_proc where oid = %s::regprocedure" % q("public." + sig)) or ""
def can(role, sig): return db.one("select has_function_privilege(%s, %s, 'execute')" % (q(role), q("public." + sig)))
ROLES = ("anon", "authenticated", "service_role")
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Garg Shekhar & Company') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'GARG SHEKHAR & COMPANY', '2025-04-01', '2025-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D)s, %(F)s, 'NWS144', 'h1', '2.3.0');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG SHEKHAR & COMPANY', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D": q(D1)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("insert into tally_sync_cursor (book_id, firm_id, last_voucher_alterid, start_at, start_guid) values (%s, %s, %d, '2026-10-04 10:00+05:30', %s)" % (q(B), q(F), START, q(CG)))
    md5s = {}
    for fn in FNS:
        for oid in [r["o"] for r in db.rows("select oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace order by 1" % q(fn))]:
            md5s[oid.replace("public.", "")] = hashlib.md5(fdef(oid.replace("public.", "")).encode()).hexdigest()

    print("== under 55 (2.3.0 as live): a Day Book, then recorder lines that blank")
    # Sales of 03-Oct-2026 from a Day Book: E1 (kept later, under 56), E3 (blanked under 55: repaired), E4 (blanked, then its day
    # re-read from a Day Book with blanks: not repaired), E5 (only Day Books: not repaired), E6 (blanked; its ref typed again since:
    # that one field kept as is), E7 (never touched)
    D3 = "2026-10-03"
    def full(mid, alter, no, party): return V(mid, alter, no, D3, party, GST1, "Delhi", "INV-%s" % no, "20261001", CMP)
    def fl(mid, party, amt):
        return [[G(mid), party, -amt * 1.18, "", None, []], [G(mid), "Sales GST 18%", amt / 2, "998314", 18, []], [G(mid), "Sales GST 18%", amt / 2, "998315", 18, []],
                [G(mid), "Output IGST", amt * 0.18, "", 18, []]]
    E = {1: (0x7001, "S-1", "Party One", 1000), 3: (0x7003, "S-3", "Party Three", 2000), 4: (0x7004, "S-4", "Party Four", 3000), 5: (0x7005, "S-5", "Party Five", 4000),
         6: (0x7006, "S-6", "Party Six", 5000), 7: (0x7007, "S-7", "Party Seven", 6000), 9: (0x7009, "S-9", "Party Nine", 7000)}
    for k in E: E[k] = E[k] + (54000 + k,)
    DB1 = [full(m, a, no, p) for (m, no, p, amt, a) in E.values()]
    DL1 = sum([fl(m, p, amt) for (m, no, p, amt, a) in E.values()], [])
    ok(day(D3, DB1, DL1).get("ok") is True, "the Day Book of 03-Oct-2026 stored (7 entries with GSTIN, pos, ref, ref date, company GSTIN, HSN, rate)")
    def blank_line(k, lid, alter, party=None):
        m, no, p, amt, _ = E[k]
        p = party or p
        return rline(lid, m, alter, no, D3, V(m, alter, no, D3, p), [[G(m), p, -amt * 1.18, "", None, []], [G(m), "Sales GST 18%", amt / 2, "", None, []], [G(m), "Sales GST 18%", amt / 2, "", None, []],
                                                                   [G(m), "Output IGST", amt * 0.18, "", None, []]])
    got = states(apply([blank_line(3, "b-3", 54103), blank_line(4, "b-4", 54104), blank_line(6, "b-6", 54106), blank_line(9, "b-9", 54109, party="Party Ninety")]))
    ok(got == ["applied"] * 4, "55: four recorder alters with blanks applied (E9's to another party) (%s)" % got)
    ok(vrow(0x7003)["gstin"] == "" and vrow(0x7003)["pos"] == "" and all(h == "" for _, _, h, _ in lrows(0x7003)), "55 (the fault, reproduced): E3's GSTIN, pos and HSN blank after the recorder line (%s %s)" % (vrow(0x7003), lrows(0x7003)))
    db.sql("select pg_sleep(0.05)")
    # E4: moved to 04-Oct-2026 by the recorder, then that day read from a Day Book (E4 blank in Tally: authoritative)
    D4 = "2026-10-04"
    m4, no4, p4, amt4, a4 = E[4]
    got = states(apply([rline("mv-4", m4, 54204, no4, D4, V(m4, 54204, no4, D4, p4), [[G(m4), p4, -1, "", None, []], [G(m4), "Sales GST 18%", 1, "", None, []]])]))
    ok(got == ["applied"], "55: E4 moved to 04-Oct-2026 by the recorder (%s)" % got)
    db.sql("select pg_sleep(0.05)")
    ok(day(D4, [V(m4, 54204, no4, D4, p4)], [[G(m4), p4, -1, "", None, []], [G(m4), "Sales GST 18%", 1, "", None, []]]).get("ok") is True, "a Day Book of 04-Oct-2026 read after the recorder (E4 blank in Tally: authoritative)")
    m5, no5, p5, amt5, a5 = E[5]
    ok(day("2026-10-05", [V(m5, a5 + 1, no5, "2026-10-05", p5)], [[G(m5), p5, -1, "", None, []], [G(m5), "Sales GST 18%", 1, "", None, []]]).get("ok") is True, "E5 moved to 05-Oct-2026 by a Day Book with blanks (no recorder line)")
    db.sql("update tally_vouchers set ref = 'TYPED-AGAIN' where book_id = %s and guid = %s" % (q(B), q(G(E[6][0]))))     # a field non-blank since: never overwritten
    chk55 = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "book=" + B, "--csv", "-P", "footer=off", "-f", "-"], input=open(CHECK).read(), capture_output=True, text=True)
    ok(chk55.returncode == 0 and chk55.stdout.count("\n") > 1, "tests/check_recorder_blanked.sql runs read-only BEFORE 56 (%d rows) %s" % (chk55.stdout.count("\n") - 1, chk55.stderr[-300:]))

    print("== migration 56")
    keep_src = {s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in ("tally_ingest_entries(uuid, jsonb, jsonb, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb)", "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean)", "tally_recorder_apply(uuid, uuid, uuid, jsonb)", "tally_voucher_version_lines(uuid, text[])")}
    before = snap()
    rr = psql_text(text); ok(rr.returncode == 0, "migration-56 runs (1) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if rr.returncode: raise SystemExit("cannot go on without the migration")
    s1 = snap()
    rr = psql_text(text); ok(rr.returncode == 0, "migration-56 runs (2) %s" % (rr.stderr.strip()[-600:] if rr.returncode else ""))
    if ON57:
        for i in (1, 2):
            r57 = psql_text(open(os.path.join(SQLDIR, "migration-57-entry-details.sql")).read())
            ok(r57.returncode == 0, "M56_THEN_57: migration-57 runs on top of 56 (%d) %s" % (i, r57.stderr.strip()[-300:] if r57.returncode else ""))
            if r57.returncode: raise SystemExit("cannot go on without 57")
    ok(snap() == s1 == before, "running it (twice) changes no row (vouchers, lines, bills, versions, the day cache, the days, the recorder lines)")
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in keep_src if not (ON57 and s.startswith("tally_ingest_day("))} == {s: h for s, h in keep_src.items() if not (ON57 and s.startswith("tally_ingest_day("))}, "48's tally_ingest_entries (4 and 3 arguments), tally_ingest_day, the apply and the version lines untouched")
    ok(prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)").count("not once, true)") == 1 and prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)").count("tally_ingest_entries(") == 1, "the line calls the 5-argument form with the keep (and nothing else of the entry path)")
    for fn in FNS:
        for r in db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c, oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            ok(r["d"] == "true" and r["c"].replace(" ", "") == "search_path=public,pg_temp", "%s: security definer, search_path public, pg_temp" % r["o"])
    for sig in ("tally_recorder_keep_vouchers(uuid, jsonb)", "tally_recorder_keep_lines(uuid, jsonb, jsonb)", "tally_recorder_pair_lines(jsonb, jsonb)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)", "tally_recorder_line(uuid, uuid, jsonb, bigint)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "f"), "%s: granted to nobody" % sig)
    for sig in ("tally_recorder_blanked(uuid)", "tally_recorder_restore_fields(uuid)", "tally_recorder_restore_fields(uuid, boolean)", "tally_ingest_entries(uuid, jsonb, jsonb)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "t"), "%s: the service role's only" % sig)
    ok(tuple(can(r, "tally_unknown_ledger_entries(uuid)") for r in ROLES) == ("f", "t", "t"), "tally_unknown_ledger_entries(uuid): members (authenticated) and the service role, not anon")
    ok(db.one("select relrowsecurity::text from pg_class where relname = 'tally_recorder_restore_log'") == "true", "tally_recorder_restore_log: row level security on")
    ok(db.one("select count(*) from pg_trigger where tgname = 'tally_recorder_restore_log_kept'") == "1" and db.one("select count(*) from pg_policies where tablename = 'tally_recorder_restore_log'") == "1", "the log: rows kept (the kept trigger), the firm reads")

    print("== 1. keep: the recorder alters E1 with blanks")
    m1, no1, p1, amt1, a1 = E[1]
    v_before, l_before = vrow(m1), lrows(m1)
    got = states(apply([blank_line(1, "k-1", 54201)]))
    ok(got == ["applied"], "the recorder alter of E1 (blanks) applied (%s)" % got)
    v1 = vrow(m1)
    ok({k: v1[k] for k in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")} == {"gstin": GST1, "pos": "Delhi", "ref": "INV-S-1", "ref_date": "2026-10-01", "cmp_gstin": CMP} and v1["alter_id"] == "54201",
       "GSTIN, place of supply, ref no., ref date and company GSTIN kept; the AlterID moved to 54201 (%s)" % v1)
    ok(lrows(m1) == l_before and sorted(h for _, _, h, _ in lrows(m1)) == ["", "", "998314", "998315"], "the lines' HSN and rate kept, each of the two 'Sales GST 18%%' lines its own HSN (%s)" % lrows(m1))
    ver = j("select payload::text from tally_voucher_versions where book_id = %s and tally_guid = %s and alter_id = 54201" % (q(B), q(G(m1))))
    ok(ver.get("gstin") == GST1 and ver.get("pos") == "Delhi", "the new version row (54201) carries the kept values")
    # the amounts changed on the alter (re-review M-B, rule c): the GST lines (HSN mixed, amounts not the stored ones) stay
    # blank; Output IGST (one line, so one HSN and one rate: rule a) keeps its rate
    got = states(apply([rline("k-1b", m1, 54202, no1, D3, V(m1, 54202, no1, D3, p1), [[G(m1), p1, -1416, "", None, []], [G(m1), "Sales GST 18%", 700, "", None, []], [G(m1), "Sales GST 18%", 500, "", None, []], [G(m1), "Output IGST", 216, "", None, []]])]))
    ok(got == ["applied"] and lrows(m1) == [("Output IGST", "216", "", "18"), ("Party One", "-1416", "", ""), ("Sales GST 18%", "500", "", ""), ("Sales GST 18%", "700", "", "")],
       "rule c: amounts changed, HSN mixed: the GST lines blank (no wrong but plausible rate); rule a: the one IGST line keeps its rate (%s)" % lrows(m1))

    # the owner (06-Oct-2026): several lines of the same ledger and the same amount keep each its own HSN, in their order
    D2 = "2026-10-02"
    m8 = 0x7008
    sent8 = [[G(m8), "Party Eight", -1500, "", None, []], [G(m8), "Sales GST 18%", 500, "111111", 5, []], [G(m8), "Sales GST 18%", 500, "222222", 12, []], [G(m8), "Sales GST 18%", 500, "333333", 18, []]]
    ok(day(D2, [V(m8, 54008, "S-8", D2, "Party Eight", GST1)], sent8).get("ok") is True, "a Day Book of 02-Oct-2026: S-8 with three 'Sales GST 18%' lines of 500 (HSN 111111 / 5, 222222 / 12, 333333 / 18)")
    got = states(apply([rline("k-8", m8, 54208, "S-8", D2, V(m8, 54208, "S-8", D2, "Party Eight"), [[G(m8), "Party Eight", -1500, "", None, []]] + [[G(m8), "Sales GST 18%", 500, "", None, []]] * 3)]))
    pairs = sorted((h, r) for l, _, h, r in lrows(m8) if l == "Sales GST 18%")
    ok(got == ["applied"] and pairs == [("111111", "5"), ("222222", "12"), ("333333", "18")], "rule b: the same amounts: the three lines of 500 keep the HSN and rates of the three stored ones, each used once (%s)" % pairs)
    print("== 2. a NEW non-blank value updates")
    got = states(apply([rline("n-1", m1, 54203, no1, D3, V(m1, 54203, no1, D3, p1, gstin=GST2, pos="Maharashtra"), [[G(m1), p1, -1416, "", None, []], [G(m1), "Sales GST 18%", 700, "999999", 12, []], [G(m1), "Sales GST 18%", 500, "", None, []], [G(m1), "Output IGST", 216, "", None, []]])]))
    v1 = vrow(m1)
    ok(got == ["applied"] and v1["gstin"] == GST2 and v1["pos"] == "Maharashtra" and v1["ref"] == "INV-S-1" and v1["cmp_gstin"] == CMP, "the new GSTIN and place of supply taken; the blank ref / company GSTIN kept (%s)" % v1)
    ok(lrows(m1) == [("Output IGST", "216", "", "18"), ("Party One", "-1416", "", ""), ("Sales GST 18%", "500", "", ""), ("Sales GST 18%", "700", "999999", "12")], "the line sent with HSN 999999 / rate 12 takes them; the other stays blank (stored blank) (%s)" % lrows(m1))
    # a created line for an entry never stored: as sent
    got = states(apply([rline("n-new", 0x7100, 54300, "S-100", D3, V(0x7100, 54300, "S-100", D3, "Party New"), [[G(0x7100), "Party New", -5, "", None, []], [G(0x7100), "Sales GST 18%", 5, "", None, []]], ev="created")]))
    ok(got == ["applied"] and vrow(0x7100)["gstin"] == "" and lrows(0x7100) == [("Party New", "-5", "", ""), ("Sales GST 18%", "5", "", "")], "a new entry from the recorder: stored as sent (%s)" % lrows(0x7100))

    print("== 3. the repair")
    m3, m4_, m5_, m6 = E[3][0], E[4][0], E[5][0], E[6][0]
    bl = db.rows("select guid, field, coalesce(ledger, '') as ledger, coalesce(amount::text, '') as amount, old_value, new_value, from_alter::text as from_alter from tally_recorder_blanked(%s) order by guid, field, ledger, amount" % q(B))
    want = sorted([(G(m3), f) for f in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")] + [(G(m3), "hsn"), (G(m3), "hsn")] + [(G(m3), "rate")] * 3 + [(G(m6), f) for f in ("gstin", "pos", "ref_date", "cmp_gstin")] + [(G(m6), "hsn"), (G(m6), "hsn")] + [(G(m6), "rate")] * 3
                  + [(G(E[9][0]), "cmp_gstin"), (G(E[9][0]), "hsn"), (G(E[9][0]), "hsn")] + [(G(E[9][0]), "rate")] * 3)
    ok(sorted((r["guid"], r["field"]) for r in bl) == want, "tally_recorder_blanked lists E3 (5 fields, 2 HSN, 3 rates), E6 (4 fields: its ref typed again, 2 HSN, 3 rates) and E9 (H1: its party changed: the company GSTIN only, and its lines); not E1, E4, E5, E7 (%s)" % sorted(set((r["guid"][-4:], r["field"]) for r in bl)))
    chk = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "book=" + B, "--csv", "-P", "footer=off", "-f", "-"], input=open(CHECK).read(), capture_output=True, text=True)
    import csv, io
    crow = list(csv.DictReader(io.StringIO(chk.stdout)))
    ok(chk.returncode == 0 and sorted((r["guid"], r["field"], r["earlier_value"]) for r in crow) == sorted((r["guid"], r["field"], r["new_value"]) for r in bl), "tests/check_recorder_blanked.sql (read-only) lists the same %d fields" % len(crow))
    good, err = True, ""
    try: db.one("set role authenticated; select tally_recorder_restore_fields(%s)::text" % q(B), OWNER)
    except RuntimeError as e: good, err = False, str(e)
    ok(not good, "the repair refused to an authenticated member (%s)" % err.strip()[-80:])
    pre = snap()
    dr = j("select tally_recorder_restore_fields(%s, true)::text" % q(B))
    ents = {e["guid"]: e for e in dr.get("entries", [])}
    ok(dr.get("dryRun") is True and dr.get("count") == 3 and set(ents) == {G(m3), G(m6), G(E[9][0])} and snap() == pre and db.one("select count(*) from tally_recorder_restore_log") == "0",
       "c. the dry run: the count (3) and the list, nothing written, nothing logged (%s)" % {k: dr.get(k) for k in ("count", "liveEntries", "total")})
    e3 = ents.get(G(m3), {})
    ok(e3.get("type") == "Sales" and e3.get("number") == "S-3" and e3.get("date") == "2026-10-03" and sorted(x["field"] for x in e3.get("fields", [])) == sorted(["cmp_gstin", "gstin", "pos", "ref", "ref_date", "hsn", "hsn", "rate", "rate", "rate"])
       and all(x.get("fromAlter") == E[3][4] for x in e3.get("fields", [])), "c. each entry with its type, number, date and the fields blanked, from which version (%s)" % [(x["field"], x.get("ledger")) for x in e3.get("fields", [])][:4])
    with open(os.path.join(os.environ.get("TMPDIR", "/tmp"), "m56-dryrun.json"), "w") as fh: json.dump(dr, fh, indent=1)
    r1 = j("select tally_recorder_restore_fields(%s)::text" % q(B))
    ok(r1.get("dryRun") is False and r1.get("unchanged") is True and r1["before"] == r1["after"] and r1["after"]["total"] == "0.00", "e. after the repair: the same live entry count and the books total 0.00 (%s -> %s)" % (r1.get("before"), r1.get("after")))
    ok(r1.get("entryFields") == 10 and r1.get("lineFields") == 15, "the repair (1): 10 entry fields and 15 line fields written (%s)" % r1)
    v3, v6 = vrow(m3), vrow(m6)
    ok({k: v3[k] for k in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")} == {"gstin": GST1, "pos": "Delhi", "ref": "INV-S-3", "ref_date": "2026-10-01", "cmp_gstin": CMP}, "E3 restored (%s)" % v3)
    ok(sorted(lrows(m3)) == sorted([("Output IGST", "360.00", "", "18"), ("Party Three", "-2360.00", "", ""), ("Sales GST 18%", "1000", "998314", "18"), ("Sales GST 18%", "1000", "998315", "18")]) or
       sorted((l, h, r) for l, _, h, r in lrows(m3)) == sorted([("Output IGST", "", "18"), ("Party Three", "", ""), ("Sales GST 18%", "998314", "18"), ("Sales GST 18%", "998315", "18")]), "E3's lines: HSN and rate back, each GST line its own HSN (%s)" % lrows(m3))
    v9 = vrow(E[9][0])
    ok(all(v9[k] == "" for k in ("gstin", "pos", "ref", "ref_date")) and v9["cmp_gstin"] == CMP and sorted(h for _, _, h, _ in lrows(E[9][0])) == ["", "", "998314", "998315"],
       "H1 in the repair: E9 (another party now) gets none of the old party's GSTIN / pos / ref / ref date; the company GSTIN and its lines' HSN back (%s)" % v9)
    ok(v6["ref"] == "TYPED-AGAIN" and v6["gstin"] == GST1, "E6: the ref typed again kept (never overwritten); the rest restored (%s)" % v6)
    post = snap()
    changed_v = {g for g in pre["v"] if pre["v"][g] != post["v"][g]}
    ok(changed_v == {G(m3), G(m6), G(E[9][0])}, "only E3, E6 and E9 changed among the entries (%s)" % sorted(g[-4:] for g in changed_v))
    diff_cols = {(g, c) for g in changed_v for c in pre["v"][g] if pre["v"][g][c] != post["v"][g][c]}
    ok({c for _, c in diff_cols} <= {"gstin", "pos", "ref", "ref_date", "cmp_gstin"} and (G(m6), "ref") not in diff_cols, "and only their blank fields (%s)" % sorted({c for _, c in diff_cols}))
    lpre = [x for x in pre["l"] if dict(x)["guid"] not in (G(m3), G(m6), G(E[9][0]))]; lpost = [x for x in post["l"] if dict(x)["guid"] not in (G(m3), G(m6), G(E[9][0]))]
    ok(lpre == lpost and pre["other"] == post["other"], "every other line, the bills, versions, the day cache, the days and the recorder lines untouched")
    ok({(dict(a)["ledger"], dict(a)["amount"]) for a in pre["l"] if dict(a)["guid"] in (G(m3), G(m6), G(E[9][0]))} == {(dict(a)["ledger"], dict(a)["amount"]) for a in post["l"] if dict(a)["guid"] in (G(m3), G(m6), G(E[9][0]))}, "E3's and E6's lines: the same ledgers and amounts (only HSN / rate written)")
    log = db.rows("select run_id::text as run, guid, field, coalesce(ledger, '') as ledger, old_value, new_value, from_alter::text as fa, by_role, at from tally_recorder_restore_log where book_id = %s order by id" % q(B))
    ok(len({r["run"] for r in log}) == 1 and log[0]["run"] == r1.get("run") and all(r["at"] for r in log), "d. one record a restored field: the run, the entry, the field, the value, the old blank, the version, the time")
    ok(len(log) == 25 and {r["guid"] for r in log} == {G(m3), G(m6), G(E[9][0])} and all(r["old_value"] == "" and r["new_value"] for r in log) and {r["fa"] for r in log} == {str(E[3][4]), str(E[6][4]), str(E[9][4])},
       "logged: 25 fields, old blank, the value and the Day Book version's AlterID (%s)" % sorted({(r["guid"][-4:], r["fa"]) for r in log}))
    r2 = j("select tally_recorder_restore_fields(%s)::text" % q(B))
    ok(r2.get("entryFields") == 0 and r2.get("lineFields") == 0 and snap() == post and int(db.one("select count(*) from tally_recorder_restore_log")) == 25, "the repair (2): nothing to do, no row changed, nothing logged (%s)" % r2)
    ok(db.one("select count(*) from tally_recorder_blanked(%s)" % q(B)) == "0", "tally_recorder_blanked now lists nothing")
    ok(vrow(m4_)["gstin"] == "" and vrow(m5_)["gstin"] == "", "E4 (its day re-read from a Day Book after the recorder) and E5 (Day Books only) stay blank")

    print("== 1b. the review's cases (H1, M1, L4a, 2.3.1's full)")
    D1b = "2026-10-01"
    def dbk(mid, alter, no, party, lines, **kw): return day(D1b, [V(mid, alter, no, D1b, party, **kw)], [[G(mid)] + l for l in lines]).get("ok") is True
    def rec(lid, mid, alter, no, party, lines, **kw): return states(apply([rline(lid, mid, alter, no, D1b, dict(V(mid, alter, no, D1b, party), **kw), [[G(mid)] + l for l in lines])]))
    # all on one day, one Day Book holding every entry (a Day Book of a day lists the day's entries)
    DBD = {0x7101: ("H-1", "Old Customer", [["Old Customer", -118, "", None, []], ["Sales GST 18%", 100, "998314", 18, []], ["Output IGST", 18, "", 18, []]]),
           0x7102: ("M-1", "Party M", [["Party M", -3000, "", None, []], ["Sales GST 18%", 1000, "1111", 18, []], ["Sales GST 18%", 2000, "2222", 18, []]]),
           0x7103: ("M-3", "Party M3", [["Party M3", -3000, "", None, []], ["Sales GST 18%", 1000, "1111", 5, []], ["Sales GST 18%", 2000, "2222", 18, []]]),
           0x7104: ("M-4", "Party M4", [["Party M4", -3000, "", None, []], ["Sales GST 18%", 1000, "998314", 18, []], ["Sales GST 18%", 2000, "998314", 18, []]]),
           0x7105: ("F-1", "Party F", [["Party F", -118, "", None, []], ["Sales GST 18%", 100, "998314", 18, []], ["Output IGST", 18, "", 18, []]]),
           0x7106: ("L-1", "Party L", [["Party L", -118, "", None, []], ["Sales GST 18%", 118, "998314", 18, []]]),
           0x7107: ("P-1", "Party P1", [["Party P1", -3000, "", None, []], ["Sales GST 18%", 2000, "2222", 18, []], ["Sales GST 18%", 1000, "1111", 5, []]]),
           0x7108: ("P-2", "Party P2", [["Party P2", -3000, "", None, []], ["Sales GST 18%", 1000, "1111", 5, []], ["Sales GST 18%", 2000, "2222", 18, []]]),
           0x7109: ("M-5", "Party M5", [["Party M5", -3000, "", None, []], ["Sales GST 18%", 1000, "1111", 5, []], ["Sales GST 18%", 2000, "2222", 18, []]])}
    ok(day(D1b, [V(m, 54500, no, D1b, p, GST1, "Delhi", "INV-" + no, "20260930", CMP) for m, (no, p, _) in DBD.items()], sum([[[G(m)] + l for l in ls] for m, (_, _, ls) in DBD.items()], [])).get("ok") is True,
       "a Day Book of 01-Oct-2026: nine entries with GSTIN, pos, ref, ref date, company GSTIN, HSN, rate")
    # H1: the invoice moved to another customer: the old customer's GSTIN / pos / ref / ref date are not carried
    got = rec("h1-new", 0x7101, 54600, "H-1", "New Customer", [["New Customer", -118, "", None, []], ["Sales GST 18%", 100, "", None, []], ["Output IGST", 18, "", None, []]])
    vh = vrow(0x7101)
    ok(got == ["applied"] and all(vh[k] == "" for k in ("gstin", "pos", "ref", "ref_date")) and vh["cmp_gstin"] == CMP, "H1: party changed: GSTIN, pos, ref, ref date stay blank; the company's own GSTIN kept (%s)" % vh)
    got = rec("h1-same", 0x7101, 54601, "H-1", "New Customer", [["New Customer", -118, "", None, []], ["Sales GST 18%", 100, "", None, []], ["Output IGST", 18, "", None, []]], gstin=GST2, pos="Punjab")
    got = rec("h1-same2", 0x7101, 54602, "H-1", "New Customer", [["New Customer", -118, "", None, []], ["Sales GST 18%", 100, "", None, []], ["Output IGST", 18, "", None, []]])
    vh = vrow(0x7101)
    ok(got == ["applied"] and vh["gstin"] == GST2 and vh["pos"] == "Punjab", "H1: the same party again: its own GSTIN and pos carried (%s)" % vh)
    # M1: the reviewer's case: 1000/1111 changed to 3000; 2000/2222 unchanged: rule c (the amounts are not the stored ones): blank
    got = rec("m1", 0x7102, 54600, "M-1", "Party M", [["Party M", -5000, "", None, []], ["Sales GST 18%", 3000, "", None, []], ["Sales GST 18%", 2000, "", None, []]])
    ok(got == ["applied"] and [(a, h, r) for l, a, h, r in lrows(0x7102) if l == "Sales GST 18%"] == [("2000", "", ""), ("3000", "", "")], "M1 / rule c: 1000 -> 3000 with HSN mixed: both lines blank (%s)" % lrows(0x7102))
    # re-review P1: stored 2000 (2222 / 18) and 1000 (1111 / 5); sent 2100 and 1100: blank, never swapped
    got = rec("p1", 0x7107, 54600, "P-1", "Party P1", [["Party P1", -3200, "", None, []], ["Sales GST 18%", 2100, "", None, []], ["Sales GST 18%", 1100, "", None, []]])
    ok(got == ["applied"] and [(a, h, r) for l, a, h, r in lrows(0x7107) if l == "Sales GST 18%"] == [("1100", "", ""), ("2100", "", "")], "P1: 2000 / 1000 sent as 2100 / 1100: blank, no rate swapped (%s)" % lrows(0x7107))
    # re-review P2: stored 1000 (1111 / 5) and 2000 (2222 / 18), raised to 2000 and 3000: blank (the new 2000 never takes the old 2000's)
    got = rec("p2", 0x7108, 54600, "P-2", "Party P2", [["Party P2", -5000, "", None, []], ["Sales GST 18%", 2000, "", None, []], ["Sales GST 18%", 3000, "", None, []]])
    ok(got == ["applied"] and [(a, h, r) for l, a, h, r in lrows(0x7108) if l == "Sales GST 18%"] == [("2000", "", ""), ("3000", "", "")], "P2: 1000 / 2000 raised to 2000 / 3000: blank, the new 2000 does not take the old 2000's values (%s)" % lrows(0x7108))
    # unchanged amounts, HSN mixed, sent in another order: each keeps its own (rule b)
    got = rec("m5", 0x7109, 54600, "M-5", "Party M5", [["Party M5", -3000, "", None, []], ["Sales GST 18%", 2000, "", None, []], ["Sales GST 18%", 1000, "", None, []]])
    ok(got == ["applied"] and [(a, h, r) for l, a, h, r in lrows(0x7109) if l == "Sales GST 18%"] == [("1000", "1111", "5"), ("2000", "2222", "18")], "rule b: amounts unchanged, HSN mixed: each line keeps its own HSN and rate (%s)" % lrows(0x7109))
    # M1: the number of lines changed, the stored HSN mixed: blank
    got = rec("m3", 0x7103, 54600, "M-3", "Party M3", [["Party M3", -3000, "", None, []], ["Sales GST 18%", 3000, "", None, []]])
    ok(got == ["applied"] and [(h, r) for l, _, h, r in lrows(0x7103) if l == "Sales GST 18%"] == [("", "")], "M1: two lines became one, HSN and rate mixed (1111 / 5, 2222 / 18): left blank (%s)" % lrows(0x7103))
    # M1: the number changed, the stored HSN and rate uniform: carried
    got = rec("m4", 0x7104, 54600, "M-4", "Party M4", [["Party M4", -3000, "", None, []], ["Sales GST 18%", 1500, "", None, []], ["Sales GST 18%", 1000, "", None, []], ["Sales GST 18%", 500, "", None, []]])
    ok(got == ["applied"] and [(h, r) for l, _, h, r in lrows(0x7104) if l == "Sales GST 18%"] == [("998314", "18")] * 3, "M1: two lines became three, all stored 998314 / 18: each carries it (%s)" % lrows(0x7104))
    # 2.3.1 part A: an entry marked "full": a blank is a real removal, passed as sent
    got = rec("full", 0x7105, 54600, "F-1", "Party F", [["Party F", -118, "", None, []], ["Sales GST 18%", 100, "", None, []], ["Output IGST", 18, "", None, []]], full=True)
    vf = vrow(0x7105)
    ok(got == ["applied"] and vf["gstin"] == "" and vf["cmp_gstin"] == "" and all(h == "" and r == "" for _, _, h, r in lrows(0x7105)), "an entry marked full (2.3.1 part A): nothing carried, the blanks stored as sent (%s %s)" % (vf, lrows(0x7105)))
    # L4a: a malformed ref date sent is not replaced (only an absent / blank one is)
    got = rec("l4a", 0x7106, 54600, "L-1", "Party L", [["Party L", -118, "", None, []], ["Sales GST 18%", 118, "", None, []]], refDate="31/12/2026")
    vl = vrow(0x7106)
    ok(got == ["applied"] and vl["ref_date"] == "" and vl["gstin"] == GST1, "L4a: a malformed ref date sent is passed on (stored empty), not replaced by the stored one; the GSTIN still kept (%s)" % vl)
    # re-review M-A: after the repair, the next blank recorder line keeps the restored values (the keep reads the current lines)
    m3_, no3, p3, amt3, _ = E[3]
    got = states(apply([blank_line(3, "ma-3", 54303)]))
    v3b = vrow(m3_)
    ok(got == ["applied"] and v3b["gstin"] == GST1 and v3b["pos"] == "Delhi" and sorted((h, r) for l, _, h, r in lrows(m3_) if l != p3) == [("", "18"), ("998314", "18"), ("998315", "18")],
       "M-A: after the repair a blank recorder line on E3 keeps the restored GSTIN, pos, HSN and rates (%s)" % lrows(m3_))
    ok(not any(r["guid"] == G(m3_) for r in db.rows("select guid from tally_recorder_blanked(%s)" % q(B))), "M-A: and a repair now finds nothing to do on E3")
    lst = [(r["guid"], r["field"]) for r in db.rows("select guid, field from tally_recorder_blanked(%s)" % q(B))]
    ok(not any(g == G(0x7105) for g, _ in lst), "the repair's list leaves the entry marked full alone (its blanks are real) (%s)" % sorted(set((g[-4:], f) for g, f in lst)))
    print("== 4. a Day Book reload replaces as today (after the repair)")
    m7, no7, p7, amt7, a7 = E[7]
    ok(day(D3, [V(m1, 54210, no1, D3, p1), full(m7, a7, no7, p7)], [[G(m1), p1, -1416, "", None, []], [G(m1), "Sales GST 18%", 1200, "", None, []], [G(m1), "Output IGST", 216, "", None, []]] + fl(m7, p7, amt7)).get("ok") is True, "a Day Book of 03-Oct-2026 with E1 blank")
    v1 = vrow(m1)
    ok(all(v1[k] == "" for k in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")) and lrows(m1) == [("Output IGST", "216", "", ""), ("Party One", "-1416", "", ""), ("Sales GST 18%", "1200", "", "")],
       "the Day Book is authoritative: E1's fields and lines exactly as the file (%s %s)" % (v1, lrows(m1)))
    ok(vrow(m7)["gstin"] == GST1 and sorted(h for _, _, h, _ in lrows(m7)) == ["", "", "998314", "998315"], "E7 from the same file: as the file")
    # the days path through tally_ingest_entries' 4-argument form equals the 5-argument form with keep false (same text path)
    ok("tally_ingest_entries(p_book, vs, ls, p_rebuild)" in prosrc("tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)") and "coalesce(p_keep, false)" in prosrc("tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)"),
       "the 5-argument form with keep false passes its arguments unchanged to 48's 4-argument form")

    print("== 5. entries naming a ledger FinCom does not have (tally_unknown_ledger_entries)")
    B2, F2, B9, U9 = "f79e4bc3-871d-4482-874d-0000000056b2", "88888888-8888-8888-8888-888888888888", "f79e4bc3-871d-4482-874d-0000000056b9", "44444444-4444-4444-4444-444444444444"
    db.sql("""insert into firms values (%(F2)s, 'Other Firm') on conflict do nothing; insert into members values (%(U9)s, %(F2)s, 'Other', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B2)s, %(F)s, 'c2', 'ZZ TWO', '2025-04-01', '2025-03-31'), (%(B9)s, %(F2)s, 'c9', 'OTHER CO', '2025-04-01', '2025-03-31');
      insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%(B2)s, %(F)s, 'Cash', 'Cash-in-Hand', 0), (%(B2)s, %(F)s, 'Sales', 'Sales Accounts', 0), (%(B2)s, %(F)s, 'Old Ledger', 'Sundry Debtors', 0);
      update tally_ledgers set deleted_at = now() where book_id = %(B2)s and name = 'Old Ledger';""" % {"F": q(F), "F2": q(F2), "U9": q(U9), "B2": q(B2), "B9": q(B9)})
    def U(guid, alter, no, d, legs, book):
        r = j("select tally_ingest_day(%s, %s, %s, %s, 1, %d, 0)::text" % (q(book), q(d), js([{"guid": guid, "alter": alter, "type": "Journal", "no": no, "party": "", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": d}]),
                                                                             js([[guid, l, a, "", None, []] for l, a in legs]), alter))
        return r.get("ok") is True
    ok(U("u-1", 1, "J-1", "2026-09-01", [("Cash", -10), ("Sales", 10)], B2) and U("u-2", 2, "J-2", "2026-09-02", [("Cash", -20), ("New Party Pvt Ltd", 20)], B2)
       and U("u-3", 3, "J-3", "2026-09-03", [("Old Ledger", -30), ("Sales", 30)], B2) and U("u-4", 4, "J-4", "2026-09-04", [("Cash", -40), ("Gone Party", 40)], B2)
       and U("u-9", 9, "J-9", "2026-09-09", [("Cash", -90), ("Their Party", 90)], B9), "entries stored: known ledgers, a ledger not in the list, a ledger marked deleted, another firm's")
    db.sql("update tally_vouchers set deleted_at = now() where book_id = %s and guid = 'u-4'" % q(B2))
    def unk(uid, book):
        try: return [(r["guid"], r["vtype"], r["vno"], r["day"], r["ledgers"]) for r in db.rows("set role authenticated; select guid, vtype, vno, day::text as day, ledgers::text as ledgers from tally_unknown_ledger_entries(%s) where client_id is not null" % ("null" if book is None else q(book) + "::uuid"), uid)]
        except RuntimeError as e: return "ERROR " + str(e)[-200:]
    got = unk(OWNER, B2)
    ok(got == [("u-3", "Journal", "J-3", "2026-09-03", "{\"Old Ledger\"}"), ("u-2", "Journal", "J-2", "2026-09-02", "{\"New Party Pvt Ltd\"}")],
       "a member reads the book's entries naming an unknown or deleted ledger, newest first, with the names; not the known one, not a deleted entry (%s)" % (got,))
    allf = unk(OWNER, None)
    ok(all(g[0] != "u-9" for g in allf) and ("u-2" in [g[0] for g in allf]), "p_book null: the member's firm's books only (never another firm's) (%d rows)" % len(allf))
    ok(unk(OWNER, B9) == [], "another firm's book named: nothing (%s)" % (unk(OWNER, B9),))
    ok([g[0] for g in unk(U9, B9)] == ["u-9"], "that firm's own member sees it")
    before_unk = snap()
    ok(snap() == before_unk, "read-only")
    print("== md5(pg_get_functiondef) after 32 .. 55, 56 (pg_stand)")
    for fn in FNS:
        for oid in [r["o"] for r in db.rows("select oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace order by 1" % q(fn))]:
            s = oid.replace("public.", "")
            print("  %-60s functiondef 55: %s  56: %s  prosrc 56: %s" % (s, md5s.get(s, "-" * 32), hashlib.md5(fdef(s).encode()).hexdigest(), hashlib.md5(prosrc(s).encode()).hexdigest()))
    print("  file md5: %s; 'delete from': %d" % (hashlib.md5(open(M56, "rb").read()).hexdigest(), low.count("delete from")))
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
