"""python3 run_migration56.py - migration-56-keep-fields (06-Oct-2026, live in FinCom Bridge 2.3.0: a recorder line applied to an
entry loaded from a Day Book blanked the GSTIN, place of supply, reference no. / date, company GSTIN and the lines' HSN / rate,
which the live request does not fetch). On throwaway PostgreSQL (pg_stand, port 30560; never a real database), built 32 -> ...
-> 54 -> 55 in staging's order; entries blanked under 55 (as on 2.3.0); then 56 (twice).
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from' anywhere, add-only, no real
     database named; every function security definer, search_path public, pg_temp; tally_recorder_line is 53's text with the
     one call changed; 48's tally_ingest_entries (3 and 4 arguments) and tally_ingest_day untouched; the grants.
  1. KEEP: a Day Book load with GSTIN / pos / ref / ref date / company GSTIN and lines with HSN / rate, then a recorder alter
     with blanks: all kept (lines: by ledger; the same amount among several of a ledger; the place when amounts changed).
  2. a recorder line with a NEW non-blank value (GSTIN, pos, an HSN, a rate) updates it.
  3. REPAIR: tally_recorder_blanked (and tests/check_recorder_blanked.sql, the same) lists exactly the entry blanked under 55;
     tally_recorder_restore_fields restores it and touches nothing else (a field made non-blank since is not overwritten; an
     entry whose day a Day Book re-read after the recorder is not touched; an entry only a Day Book changed is not touched);
     logged; run twice (the second run changes nothing). Refused to authenticated.
  4. a Day Book reload with blanks still replaces as today (the Day Book is authoritative).
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
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low) and not re.search(r"\balter\s+table\s+\S+\s+(drop|rename)", low), "0. add-only (no drop, no truncate, no rename)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
FNS = sorted(set(re.findall(r"create or replace function public\.(\w+)\s*\(", text)))
ok(FNS == sorted(["tally_recorder_keep_vouchers", "tally_recorder_keep_lines", "tally_ingest_entries", "tally_recorder_line", "tally_recorder_blanked", "tally_recorder_restore_fields"]), "0. the functions of the file (%s)" % FNS)
m53 = open(os.path.join(SQLDIR, "migration-53-recorder-placeholder-settled.sql")).read()
def block(t, start, end):
    i = t.index(start); j = t.index("\n", t.index(end, i)) + 1; return t[i:j]
L53 = block(m53, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
L56 = block(text, "create or replace function public.tally_recorder_line(", "revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint)")
ok(L56 == L53.replace("res := tally_ingest_entries(p_book, vs, p_line->'lines', not once);", "res := tally_ingest_entries(p_book, vs, p_line->'lines', not once, true);     -- 56: the recorder keeps what its request does not fetch"),
   "0. tally_recorder_line is 53's text, byte for byte, but the one call (now with the recorder's keep, true)")

db = pg_stand.start(30560)
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
def snap():
    """every row of the entry tables (the cells the repair may write and the rest)"""
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
         6: (0x7006, "S-6", "Party Six", 5000), 7: (0x7007, "S-7", "Party Seven", 6000)}
    for k in E: E[k] = E[k] + (54000 + k,)
    DB1 = [full(m, a, no, p) for (m, no, p, amt, a) in E.values()]
    DL1 = sum([fl(m, p, amt) for (m, no, p, amt, a) in E.values()], [])
    ok(day(D3, DB1, DL1).get("ok") is True, "the Day Book of 03-Oct-2026 stored (6 entries with GSTIN, pos, ref, ref date, company GSTIN, HSN, rate)")
    def blank_line(k, lid, alter):
        m, no, p, amt, _ = E[k]
        return rline(lid, m, alter, no, D3, V(m, alter, no, D3, p), [[G(m), p, -amt * 1.18, "", None, []], [G(m), "Sales GST 18%", amt / 2, "", None, []], [G(m), "Sales GST 18%", amt / 2, "", None, []],
                                                                   [G(m), "Output IGST", amt * 0.18, "", None, []]])
    got = states(apply([blank_line(3, "b-3", 54103), blank_line(4, "b-4", 54104), blank_line(6, "b-6", 54106)]))
    ok(got == ["applied"] * 3, "55: three recorder alters with blanks applied (%s)" % got)
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
    ok(snap() == s1 == before, "running it (twice) changes no row (vouchers, lines, bills, versions, the day cache, the days, the recorder lines)")
    ok({s: hashlib.md5(prosrc(s).encode()).hexdigest() for s in keep_src} == keep_src, "48's tally_ingest_entries (4 and 3 arguments), tally_ingest_day, the apply and the version lines untouched")
    ok(prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)").count("not once, true)") == 1 and prosrc("tally_recorder_line(uuid, uuid, jsonb, bigint)").count("tally_ingest_entries(") == 1, "the line calls the 5-argument form with the keep (and nothing else of the entry path)")
    for fn in FNS:
        for r in db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c, oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            ok(r["d"] == "true" and r["c"].replace(" ", "") == "search_path=public,pg_temp", "%s: security definer, search_path public, pg_temp" % r["o"])
    for sig in ("tally_recorder_keep_vouchers(uuid, jsonb)", "tally_recorder_keep_lines(uuid, jsonb)", "tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean)", "tally_recorder_line(uuid, uuid, jsonb, bigint)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "f"), "%s: granted to nobody" % sig)
    for sig in ("tally_recorder_blanked(uuid)", "tally_recorder_restore_fields(uuid)", "tally_ingest_entries(uuid, jsonb, jsonb)"):
        ok(tuple(can(r, sig) for r in ROLES) == ("f", "f", "t"), "%s: the service role's only" % sig)
    ok(db.one("select relrowsecurity::text from pg_class where relname = 'tally_recorder_restore_log'") == "true", "tally_recorder_restore_log: row level security on")

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
    # the amounts changed on the alter: the single-ledger line keeps its HSN-less rate; the two GST lines by place (amounts both new)
    got = states(apply([rline("k-1b", m1, 54202, no1, D3, V(m1, 54202, no1, D3, p1), [[G(m1), p1, -1416, "", None, []], [G(m1), "Sales GST 18%", 700, "", None, []], [G(m1), "Sales GST 18%", 500, "", None, []], [G(m1), "Output IGST", 216, "", None, []]])]))
    ok(got == ["applied"] and lrows(m1) == [("Output IGST", "216", "", "18"), ("Party One", "-1416", "", ""), ("Sales GST 18%", "500", "998314", "18"), ("Sales GST 18%", "700", "998315", "18")],
       "amounts changed: each line keeps the HSN / rate of the line at its place among the ledger's lines (%s)" % lrows(m1))

    print("== 2. a NEW non-blank value updates")
    got = states(apply([rline("n-1", m1, 54203, no1, D3, V(m1, 54203, no1, D3, p1, gstin=GST2, pos="Maharashtra"), [[G(m1), p1, -1416, "", None, []], [G(m1), "Sales GST 18%", 700, "999999", 12, []], [G(m1), "Sales GST 18%", 500, "", None, []], [G(m1), "Output IGST", 216, "", None, []]])]))
    v1 = vrow(m1)
    ok(got == ["applied"] and v1["gstin"] == GST2 and v1["pos"] == "Maharashtra" and v1["ref"] == "INV-S-1" and v1["cmp_gstin"] == CMP, "the new GSTIN and place of supply taken; the blank ref / company GSTIN kept (%s)" % v1)
    ok(lrows(m1) == [("Output IGST", "216", "", "18"), ("Party One", "-1416", "", ""), ("Sales GST 18%", "500", "998314", "18"), ("Sales GST 18%", "700", "999999", "12")], "the line sent with HSN 999999 / rate 12 takes them; the other keeps its own (%s)" % lrows(m1))
    # a created line for an entry never stored: as sent
    got = states(apply([rline("n-new", 0x7100, 54300, "S-100", D3, V(0x7100, 54300, "S-100", D3, "Party New"), [[G(0x7100), "Party New", -5, "", None, []], [G(0x7100), "Sales GST 18%", 5, "", None, []]], ev="created")]))
    ok(got == ["applied"] and vrow(0x7100)["gstin"] == "" and lrows(0x7100) == [("Party New", "-5", "", ""), ("Sales GST 18%", "5", "", "")], "a new entry from the recorder: stored as sent (%s)" % lrows(0x7100))

    print("== 3. the repair")
    m3, m4_, m5_, m6 = E[3][0], E[4][0], E[5][0], E[6][0]
    bl = db.rows("select guid, field, coalesce(ledger, '') as ledger, coalesce(amount::text, '') as amount, old_value, new_value, from_alter::text as from_alter from tally_recorder_blanked(%s) order by guid, field, ledger, amount" % q(B))
    want = sorted([(G(m3), f) for f in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")] + [(G(m3), "hsn"), (G(m3), "hsn")] + [(G(m3), "rate")] * 3 + [(G(m6), f) for f in ("gstin", "pos", "ref_date", "cmp_gstin")] + [(G(m6), "hsn"), (G(m6), "hsn")] + [(G(m6), "rate")] * 3)
    ok(sorted((r["guid"], r["field"]) for r in bl) == want, "tally_recorder_blanked lists E3 (5 fields, 2 HSN, 3 rates) and E6 (4 fields: its ref typed again, 2 HSN, 3 rates); not E1, E4, E5, E7 (%s)" % sorted(set((r["guid"][-4:], r["field"]) for r in bl)))
    chk = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "book=" + B, "--csv", "-P", "footer=off", "-f", "-"], input=open(CHECK).read(), capture_output=True, text=True)
    import csv, io
    crow = list(csv.DictReader(io.StringIO(chk.stdout)))
    ok(chk.returncode == 0 and sorted((r["guid"], r["field"], r["earlier_value"]) for r in crow) == sorted((r["guid"], r["field"], r["new_value"]) for r in bl), "tests/check_recorder_blanked.sql (read-only) lists the same %d fields" % len(crow))
    good, err = True, ""
    try: db.one("set role authenticated; select tally_recorder_restore_fields(%s)::text" % q(B), OWNER)
    except RuntimeError as e: good, err = False, str(e)
    ok(not good, "the repair refused to an authenticated member (%s)" % err.strip()[-80:])
    pre = snap()
    r1 = j("select tally_recorder_restore_fields(%s)::text" % q(B))
    ok(r1.get("entryFields") == 9 and r1.get("lineFields") == 10, "the repair (1): 9 entry fields and 10 line fields written (%s)" % r1)
    v3, v6 = vrow(m3), vrow(m6)
    ok({k: v3[k] for k in ("gstin", "pos", "ref", "ref_date", "cmp_gstin")} == {"gstin": GST1, "pos": "Delhi", "ref": "INV-S-3", "ref_date": "2026-10-01", "cmp_gstin": CMP}, "E3 restored (%s)" % v3)
    ok(sorted(lrows(m3)) == sorted([("Output IGST", "360.00", "", "18"), ("Party Three", "-2360.00", "", ""), ("Sales GST 18%", "1000", "998314", "18"), ("Sales GST 18%", "1000", "998315", "18")]) or
       sorted((l, h, r) for l, _, h, r in lrows(m3)) == sorted([("Output IGST", "", "18"), ("Party Three", "", ""), ("Sales GST 18%", "998314", "18"), ("Sales GST 18%", "998315", "18")]), "E3's lines: HSN and rate back, each GST line its own HSN (%s)" % lrows(m3))
    ok(v6["ref"] == "TYPED-AGAIN" and v6["gstin"] == GST1, "E6: the ref typed again kept (never overwritten); the rest restored (%s)" % v6)
    post = snap()
    changed_v = {g for g in pre["v"] if pre["v"][g] != post["v"][g]}
    ok(changed_v == {G(m3), G(m6)}, "only E3 and E6 changed among the entries (%s)" % sorted(g[-4:] for g in changed_v))
    diff_cols = {(g, c) for g in changed_v for c in pre["v"][g] if pre["v"][g][c] != post["v"][g][c]}
    ok({c for _, c in diff_cols} <= {"gstin", "pos", "ref", "ref_date", "cmp_gstin"} and (G(m6), "ref") not in diff_cols, "and only their blank fields (%s)" % sorted({c for _, c in diff_cols}))
    lpre = [x for x in pre["l"] if dict(x)["guid"] not in (G(m3), G(m6))]; lpost = [x for x in post["l"] if dict(x)["guid"] not in (G(m3), G(m6))]
    ok(lpre == lpost and pre["other"] == post["other"], "every other line, the bills, versions, the day cache, the days and the recorder lines untouched")
    ok({(dict(a)["ledger"], dict(a)["amount"]) for a in pre["l"] if dict(a)["guid"] in (G(m3), G(m6))} == {(dict(a)["ledger"], dict(a)["amount"]) for a in post["l"] if dict(a)["guid"] in (G(m3), G(m6))}, "E3's and E6's lines: the same ledgers and amounts (only HSN / rate written)")
    log = db.rows("select guid, field, coalesce(ledger, '') as ledger, old_value, new_value, from_alter::text as fa, by_role from tally_recorder_restore_log where book_id = %s order by id" % q(B))
    ok(len(log) == 19 and {r["guid"] for r in log} == {G(m3), G(m6)} and all(r["old_value"] == "" and r["new_value"] for r in log) and {r["fa"] for r in log} == {str(E[3][4]), str(E[6][4])},
       "logged: 19 fields, old blank, the value and the Day Book version's AlterID (%s)" % sorted({(r["guid"][-4:], r["fa"]) for r in log}))
    r2 = j("select tally_recorder_restore_fields(%s)::text" % q(B))
    ok(r2.get("entryFields") == 0 and r2.get("lineFields") == 0 and snap() == post and int(db.one("select count(*) from tally_recorder_restore_log")) == 19, "the repair (2): nothing to do, no row changed, nothing logged (%s)" % r2)
    ok(db.one("select count(*) from tally_recorder_blanked(%s)" % q(B)) == "0", "tally_recorder_blanked now lists nothing")
    ok(vrow(m4_)["gstin"] == "" and vrow(m5_)["gstin"] == "", "E4 (its day re-read from a Day Book after the recorder) and E5 (Day Books only) stay blank")

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

    print("== md5(pg_get_functiondef) after 32 .. 55, 56 (pg_stand)")
    for fn in FNS:
        for oid in [r["o"] for r in db.rows("select oid::regprocedure::text as o from pg_proc where proname = %s and pronamespace = 'public'::regnamespace order by 1" % q(fn))]:
            s = oid.replace("public.", "")
            print("  %-70s 55: %s  56: %s" % (s, md5s.get(s, "-" * 32), hashlib.md5(fdef(s).encode()).hexdigest()))
    print("  file md5: %s; 'delete from': %d" % (hashlib.md5(open(M56, "rb").read()).hexdigest(), low.count("delete from")))
finally:
    db.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL OK", len(fails)))
if fails: raise SystemExit(1)
