"""python3 run_company_sources_server.py - FinCom 2.4.1 (the owner's approval of 09-Oct-2026, item 3): one company open in
two places with different data. tally-ingest (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py), its recorder and source functions answered by a throwaway PostgreSQL (pg_stand) built 32 -> ... -> 60
-> 71 as staging will be. Two computers' bridges with GARG SHEKHAR & COMPANY (one company GUID) from two data folders:
  1. NWS144's beat names its data id ①: chosen by itself (the first seen), its starting point recorded; PC-2's beat
     names ②: pending, ONE alert, no starting point or gap check from it; each beat answers dataSources (chosen or not).
  2. NWS144's line of ① with its entry: applied, the bridge's own received_at kept in the payload; its 'other_source'
     line (②, heads only): held with the words "saved in another data location ... (②, PC-2) ...; FinCom reads ①";
     PC-2's line of ② WITH an entry: held, never applied (the entry not in the books); a line without data_id: as before.
  3. the S-M1 tie (eed48720): a computer that never named the company in its heartbeat (nor sent lines for it) cannot
     send 'other_source' lines or data ids for it (failed with words, nothing stored), nor name a source in its beat.
  4. validation: a data id not 16 hex, a path over 260 characters: the line failed with words; at most 50 sources a beat.
  5. the owner chooses ② (tally_company_source_choose): PC-2's next beat is told it is chosen and its starting point is
     recorded afresh (afterClear); NWS144's is told it is not; then NWS144's line of ① is held and PC-2's line of ② applied.
RED: on 7c13c777's index.ts (no dataSources, other_source 'failed: unknown event', received_at dropped) sections 1-5 fail.
Needs Deno (DENO, default: on the PATH)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, csv
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand
csv.field_size_limit(1 << 30)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql",
                                           "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql", "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql",
                                           "migration-46-trial-tools.sql", "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql",
                                           "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", "migration-57-entry-details.sql", "migration-58-lows.sql",
                                           "migration-60-recorder-lows.sql", "migration-67-recorder-renumbered.sql", "migration-71-company-sources.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
FIRM, BOOK, OWNER = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111171", "55555555-5555-5555-5555-555555555555"
D1, D2, D3 = "d1000000-0000-0000-0000-000000000071", "d2000000-0000-0000-0000-000000000072", "d3000000-0000-0000-0000-000000000073"
K1, K2, K3 = "fcd_" + "1" * 48, "fcd_" + "2" * 48, "fcd_" + "3" * 48
CO, CG = "GARG SHEKHAR & COMPANY", "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
def did(p): return hashlib.sha256(p.strip().lower().encode()).hexdigest()[:16]
P1, P2 = r"C:\Users\Public\TallyPrime\Data", r"D:\Copy of Tally\DATA"
I1, I2 = did(P1), did(P2)
G1 = {"id": "go-aaaaaa111111", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.4.1"}
G2 = {"id": "go-bbbbbb222222", "computer": "PC-2", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.4.1"}
G3 = {"id": "go-cccccc333333", "computer": "PC-3", "user": "ravi", "mode": "main", "runMode": "user", "version": "2.4.1"}
db = pg_stand.start(55471)
fn = None
try:
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    db.sql("create index if not exists tally_vouchers_day on tally_vouchers (book_id, day)")
    db.sql("""insert into firms values (%(F)s, 'Firm'); insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', %(CO)s, '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(A)s, %(F)s, 'NWS144', 'h1', '2.4.1'), (%(D)s, %(F)s, 'PC-2', 'h2', '2.4.1'), (%(E)s, %(F)s, 'PC-3', 'h3', '2.4.1');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'GARG', '{"choices": {}}');
      do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      grant usage on schema public, auth to authenticated, service_role; grant execute on all functions in schema auth to authenticated, service_role; grant select on members, firms to authenticated;"""
           % {"F": q(FIRM), "O": q(OWNER), "B": q(BOOK), "A": q(D1), "D": q(D2), "E": q(D3), "CO": q(CO)})
    for path in FILES:
        r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                           input=open(path).read(), capture_output=True, text=True)
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.one("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s::jsonb, %s::jsonb)::text" % (q(BOOK), q(json.dumps([["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Capital", "Capital Account", "1000"]])),
                                                                                                   q(json.dumps([["Sales Accounts", ""], ["Capital Account", ""]]))))
    def lit(v):
        if v is None: return "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
        return q(v)
    real = FS.rpc
    PG = ("tally_recorder_apply", "tally_recorder_send", "tally_start_point", "tally_recorder_gap_check", "tally_company_sources_note", "tally_company_source_lines", "tally_recorder_send_sourced")
    def rpc(name, a):
        if name in PG:
            FS.ARGS.setdefault(name, []).append(a)
            try: return json.loads(db.one("select public.%s(%s)::text" % (name, ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items()))))
            except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
        return real(name, a)
    FS.rpc = rpc
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": CO, "client_id": "c1", "book_id": BOOK})
    for d, key, name in ((D1, K1, "NWS144"), (D2, K2, "PC-2"), (D3, K3, "PC-3")):
        FS.T["tally_devices"].append({"id": d, "firm_id": FIRM, "name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.1"})
    FS.T.setdefault("tally_recorder_lines", [])
    FS.T.setdefault("tally_post_jobs", [])
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body, key):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    def beat(key, br, dsrc, start=54389, alt=54400, open_=True):
        b = {"kind": "beat", "version": "2.4.1", "bridge": br, "computer": br["computer"], "windowsUser": br["user"], "tally": True, "tallyState": "open", "every": 30,
             "open": [CO] if open_ else [], "companies": [{"name": CO, "open": open_, "guid": CG, "altvchid": alt, "altmstid": 100}] if open_ else [],
             "startPoint": {CO: {"altvchid": start, "altmstid": 90, "guid": CG}} if open_ else {}, "dataSources": dsrc}
        return call(b, key)
    def src(i, p, w="anshul"): return [{"company": CO, "company_guid": CG, "data_id": i, "path": p, "w": w, "at": "2026-10-09T11:00:00"}]
    def xml(guid, alter, amt, no):
        return ('<VOUCHER REMOTEID="%s" VCHTYPE="Sales" ACTION="Create"><DATE>20261009</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER>'
                '<NARRATION>s</NARRATION><ISCANCELLED>No</ISCANCELLED><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
                '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (guid, guid, alter, no, amt, -amt)
    def line(lid, mid, alter, no, pc, data_id=None, body=True):
        g = CG + "-%08x" % mid
        x = {"line_id": lid, "event": "created", "saved_at": "2026-10-09T11:30:00+05:30", "received_at": "2026-10-09T11:30:07+05:30", "pc": pc, "user": "TALLY", "company_guid": CG,
             "object_guid": g, "master_id": str(mid), "alter_id": alter, "vch_type": "Sales", "vch_no": no, "vch_date": "20261009", "ledgers": [], "full": True, "again": ""}
        if body: x["xml"] = xml(g, alter, 100, no)
        if data_id: x["data_id"] = data_id
        return x
    def other(lid, i, p, pc, no="2026-27/GST/297", w="anshul"):
        return {"line_id": lid, "event": "other_source", "of": "created", "company_guid": CG, "vch_type": "Sales", "vch_no": no, "vch_date": "20261009", "saved_at": "2026-10-09T11:31:00+05:30",
                "received_at": "2026-10-09T11:31:05+05:30", "pc": pc, "user": "TALLY", "w": w, "data_id": i, "data_path": p, "source": "addon", "again": ""}
    rec = lambda lines, key, br: call({"kind": "recorder_lines", "company": CO, "company_guid": CG, "version": "2.4.1", "bridge": br, "lines": lines}, key)
    res = lambda r: {x.get("line_id"): (x.get("state"), x.get("why") or "") for x in (r.get("results") or [])}
    def ds(r): return {x.get("company"): x for x in (r.get("dataSources") or [])}
    vrow = lambda g: (db.rows("select alter_id from tally_vouchers where book_id = %s and guid = %s and deleted_at is null" % (q(BOOK), q(g))) or [None])[0]
    lrow = lambda lid: (db.rows("select state, event, held_why, object_guid, payload::text as payload from tally_recorder_lines where line_id = %s order by id desc limit 1" % q(lid)) or [{}])[0]

    print("== 1. the beats: ① chosen by itself, ② pending with one alert")
    c, r = beat(K1, G1, src(I1, P1))
    d = ds(r).get(CO) or {}
    ok(c == 200 and d.get("chosenId") == I1 and d.get("chosen") is True and d.get("choice") == "chosen" and d.get("chosenIds") == [I1], "1. NWS144 (①): chosen (%s %s)" % (c, r.get("dataSources")))
    ok(db.one("select start_device::text from tally_sync_cursor where book_id = %s" % q(BOOK)) == D1, "1. review M2: chosen by itself as the starting point's computer's location")
    sp = db.rows("select last_voucher_alterid::text as a, start_device::text as dev from tally_sync_cursor where book_id = %s" % q(BOOK))
    ok(sp and sp[0]["a"] == "54389" and sp[0]["dev"] == D1, "1. the starting point recorded from NWS144 (%s)" % sp)
    n_sp = len(FS.ARGS.get("tally_start_point", []))
    c, r = beat(K2, G2, src(I2, P2), start=70000, alt=70010)
    d = ds(r).get(CO) or {}
    ok(c == 200 and d.get("chosenId") == I1 and d.get("chosen") is False and d.get("choice") == "pending", "1. PC-2 (②): not chosen, pending (%s)" % r.get("dataSources"))
    ok((r.get("recorder") or {}).get(CO, {}).get("pendingSource") is True and db.one("select start_device::text || ' ' || last_voucher_alterid from tally_sync_cursor where book_id = %s" % q(BOOK)) == D1 + " 54389",
       "1. no gap check from PC-2, the starting point still NWS144's (%s)" % r.get("recorder"))
    ok(db.one("select choice from tally_company_sources where data_id = %s" % q(I2)) == "pending" and db.one("select count(*) from tally_alerts where kind = 'summary' and data->>'reason' = 'source'") == "1", "1. ② pending, ONE alert")
    beat(K2, G2, src(I2, P2), start=70000, alt=70010)
    ok(db.one("select count(*) from tally_alerts where kind = 'summary' and data->>'reason' = 'source'") == "1", "1. PC-2's next beat: still one alert")

    print("== 2. lines: ① applied, ② held, other_source held with the words")
    c, r = rec([line("n-1", 26311, 54401, "S-191", "NWS144", I1)], K1, G1)
    ok(res(r).get("n-1", ("",))[0] == "applied" and vrow(CG + "-%08x" % 26311), "2. NWS144's line of ①: applied (%s)" % res(r))
    pl = json.loads(lrow("n-1").get("payload") or "{}")
    ok(pl.get("received_at") and pl["received_at"].startswith("2026-10-09T06:00:07"), "2. the bridge's own received_at kept in the payload (%s)" % pl.get("received_at"))
    c, r = rec([other("o-1", I2, P2, "NWS144")], K1, G1)
    want = "saved in another data location of %s (\u2461, NWS144); FinCom reads \u2460. Choose on the Tally page." % CO
    ok(res(r).get("o-1") == ("held", want), "2. NWS144's other_source line (②): held with the words (%s)" % res(r))
    lr = lrow("o-1")
    ok(lr.get("event") == "other_source" and not lr.get("object_guid") and "received_at" in (lr.get("payload") or ""), "2. kept heads only, its received_at in the payload (%s)" % lr)
    c, r = rec([line("p-1", 26400, 70011, "2026-27/GST/297", "PC-2", I2)], K2, G2)
    st = res(r).get("p-1", ("", ""))
    ok(st[0] == "held" and "another data location" in st[1] and not vrow(CG + "-%08x" % 26400), "2. PC-2's line of ② with its entry: held, NOT applied (%s)" % (st,))
    c, r = rec([line("n-0", 26312, 54402, "S-192", "NWS144")], K1, G1)
    ok(res(r).get("n-0", ("",))[0] == "applied", "2. a line without data_id (an older add-on), from the chosen location's computer: as before (%s)" % res(r))
    kp = db.rows("select (body is not null)::text as b, payload->>'pending' as p from tally_recorder_lines where line_id = 'p-1'")
    ok(kp and kp[0] == {"b": "true", "p": "true"}, "2. review H5: PC-2's pending line kept with its entry, marked pending (%s)" % kp)
    c, r = rec([line("p-0", 26402, 70013, "S-402", "PC-2")], K2, G2)
    st = res(r).get("p-0", ("", ""))
    ok(st[0] == "held" and "Restart Tally so the 2.4.1 add-on loads" in st[1] and not vrow(CG + "-%08x" % 26402), "2. review H2: a line without data_id from a computer not chosen: held, plain words (%s)" % (st,))
    c, r = rec([dict(other("o-2", I2, P2, "NWS144"), data_id="", data_path="")], K1, G1)
    ok(res(r).get("o-2", ("",))[0] == "held", "2. review H2: the bridge's other_source line without a data id (stopped, no dp=): held (%s)" % res(r))
    # review H3: a source of another company GUID than the book's is never noted
    c, r = beat(K1, G1, [{"company": CO, "company_guid": "another-company-guid", "data_id": did("Z:\\other"), "path": "Z:\\other", "w": "anshul"}])
    ok(db.one("select count(*) from tally_company_sources where data_id = %s" % q(did("Z:\\other"))) == "0" and (ds(r).get(CO) or {}).get("otherCompany") is True, "2. review H3: another company GUID: not noted (%s)" % r.get("dataSources"))

    print("== 3. the S-M1 tie: only for a company the computer named")
    c, r = beat(K3, G3, src(did("E:\\x"), "E:\\x", "ravi"), open_=False)
    ok(not ds(r) and db.one("select count(*) from tally_company_sources where data_id = %s" % q(did("E:\\x"))) == "0", "3. PC-3's beat naming a source of a company it does not have open: ignored (%s)" % r.get("dataSources"))
    c, r = rec([other("x-1", did("E:\\x"), "E:\\x", "PC-3", w="ravi")], K3, G3)
    st = res(r).get("x-1", ("", ""))
    ok(st[0] == "failed" and "named" in st[1] and db.one("select count(*) from tally_recorder_lines where line_id = 'x-1'") == "0", "3. PC-3's other_source line: failed with words, nothing stored (%s)" % (st,))
    c, r = rec([line("x-2", 26500, 54500, "S-500", "PC-3", I1)], K3, G3)
    ok(res(r).get("x-2", ("",))[0] == "failed" and not vrow(CG + "-%08x" % 26500), "3. PC-3's line with a data id: failed, not applied (%s)" % res(r))

    print("== 4. validation")
    c, r = rec([other("v-1", "NOT-HEX-ID-12345", P2, "NWS144"), other("v-2", I2, "C:\\" + "a" * 300, "NWS144")], K1, G1)
    rr = res(r)
    ok(rr.get("v-1", ("",))[0] == "failed" and rr.get("v-2", ("",))[0] == "failed", "4. a data id not 16 hex, a path over 260: failed (%s)" % rr)
    c, r = beat(K1, G1, [src(did("p%d" % i), "p%d" % i)[0] for i in range(60)])
    ok(int(db.one("select count(*) from tally_company_sources")) <= 2 + 50, "4. at most 50 sources a beat")

    print("== 5. the owner chooses ②")
    out = db.one("set fincom.uid = %s; set fincom.role = 'authenticated'; set role authenticated; select tally_company_source_choose(%s, %s)::text" % (q(OWNER), q(BOOK), q(I2)))
    ok('"ok": true' in (out or ""), "5. chosen by the owner (%s)" % out)
    c, r = beat(K2, G2, src(I2, P2), start=70000, alt=70010)
    d = ds(r).get(CO) or {}
    ok(d.get("chosen") is True and d.get("chosenId") == I2, "5. PC-2 told it is chosen (%s)" % r.get("dataSources"))
    sp = db.rows("select last_voucher_alterid::text as a, start_device::text as dev from tally_sync_cursor where book_id = %s" % q(BOOK))
    ok(sp and sp[0]["a"] == "70000" and sp[0]["dev"] == D2, "5. the starting point recorded afresh from PC-2 (%s)" % sp)
    c, r = beat(K1, G1, src(I1, P1))
    d = ds(r).get(CO) or {}
    ok(d.get("chosen") is False and d.get("chosenId") == I2 and d.get("choice") == "other", "5. NWS144 told it is not ('other') (%s)" % r.get("dataSources"))
    c, r = rec([line("n-2", 26313, 54403, "S-193", "NWS144", I1)], K1, G1)
    st = res(r).get("n-2", ("", ""))
    ok(st[0] == "held" and "(\u2460, NWS144); FinCom reads \u2461" in st[1] and not vrow(CG + "-%08x" % 26313), "5. NWS144's line of ① now held, not applied (%s)" % (st,))
    c, r = rec([line("p-2", 26401, 70012, "2026-27/GST/298", "PC-2", I2)], K2, G2)
    ok(res(r).get("p-2", ("",))[0] == "applied" and vrow(CG + "-%08x" % 26401), "5. PC-2's line of ② applied (%s)" % res(r))
    print("== 6. review H5: the same data (one folder under two paths); the re-review: only while a location is pending")
    beat(K2, G2, src(I2, P2), start=70000, alt=70014)     # PC-2's next beat, after its starting point was recorded afresh
    ok(vrow(CG + "-%08x" % 26400), "6. PC-2's line kept pending before ② was chosen: applied once ②'s starting point was recorded afresh (its AlterID 70011 above 70000)")
    out = db.one("set fincom.uid = %s; set fincom.role = 'authenticated'; set role authenticated; select tally_company_source_same(%s)::text" % (q(OWNER), q(BOOK)))
    ok('"ok": false' in (out or "") and db.one("select choice from tally_company_sources where book_id = %s and data_id = %s" % (q(BOOK), q(I1))) == "other",
       "6. the re-review (Low): same data with nothing pending: refused, ① (other) not chosen (%s)" % out)
    print("== 7. the re-review H1-r(a): only a proven data id says 'own'")
    CO2, CG2, BOOK2 = "GARG COPY TEST CO", "8d6fe9b3-7235-4cbb-b4cd-1124be599100", "11111111-1111-1111-1111-111111111172"
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, '2026-04-01', '2026-03-31')" % (q(BOOK2), q(FIRM), q(CO2)))
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": CO2, "client_id": "c1", "book_id": BOOK2})
    b2 = {"kind": "beat", "version": "2.4.1", "bridge": G1, "computer": "NWS144", "windowsUser": "anshul", "tally": True, "tallyState": "open", "every": 30, "open": [CO2],
          "companies": [{"name": CO2, "open": True, "guid": CG2, "altvchid": 900, "altmstid": 100}], "startPoint": {CO2: {"altvchid": 800, "altmstid": 90, "guid": CG2}}, "dataSources": []}
    c, r = call(b2, K1)
    ok(c == 200 and db.one("select start_device::text from tally_sync_cursor where book_id = %s" % q(BOOK2)) == D1, "7. the second company's starting point from NWS144 (%s)" % c)
    I3, I4 = did(r"E:\Fork A\DATA"), did(r"E:\Fork B\DATA")
    def line2(lid, mid, alter, data_id, proven=None):
        x = dict(line(lid, mid, alter, "F-%d" % mid, "NWS144", data_id), company_guid=CG2, object_guid=CG2 + "-%08x" % mid)
        x["xml"] = xml(CG2 + "-%08x" % mid, alter, 100, "F-%d" % mid)
        if proven is not None: x["data_proven"] = proven
        return x
    rec2 = lambda lines: call({"kind": "recorder_lines", "company": CO2, "company_guid": CG2, "version": "2.4.1", "bridge": G1, "lines": lines}, K1)
    c, r = rec2([line2("f-1", 500, 901, I3)])
    ch2 = {x["data_id"]: x["choice"] for x in db.rows("select data_id, choice from tally_company_sources where book_id = %s" % q(BOOK2))}
    ok(ch2 == {I3: "pending"}, "7. the copy's unproven line first: its folder NOT chosen by itself, pending (%s %s)" % (ch2, res(r)))
    c, r = rec2([line2("f-2", 501, 902, I4)])
    ch2 = {x["data_id"]: x["choice"] for x in db.rows("select data_id, choice from tally_company_sources where book_id = %s" % q(BOOK2))}
    al2 = int(db.one("select count(*) from tally_alerts where book_id = %s and data->>'reason' = 'source'" % q(BOOK2)))
    ok(ch2 == {I3: "pending", I4: "pending"} and al2 >= 1 and not vrow(CG2 + "-%08x" % 500) and not vrow(CG2 + "-%08x" % 501),
       "7. the other folder's unproven line: both pending, with the alert, nothing applied (%s, %d alerts)" % (ch2, al2))
    c, r = rec2([line2("f-3", 502, 903, I4, True)])
    ch2 = {x["data_id"]: x["choice"] for x in db.rows("select data_id, choice from tally_company_sources where book_id = %s" % q(BOOK2))}
    ok(ch2.get(I4) == "chosen" and ch2.get(I3) == "pending", "7. a line the bridge proved (data_proven): its own, chosen as the starting point's computer's (%s)" % ch2)
finally:
    if fn:
        fn.terminate()
        try: fn.wait(timeout=10)
        except Exception: fn.kill()
    db.stop()
print("\nFAILED: %d" % len(fails) if fails else "\nall ok")
if fails: print("".join(log[-40:]) if fn else "")
sys.exit(1 if fails else 0)
