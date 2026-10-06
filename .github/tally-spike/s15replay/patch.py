"""S15 on tally-ingest itself: builds tests/run_s15_replay.py from the bridge ref's tests/run_recorder_server.py (its stand:
pg_stand with the migrations, fake_supabase, server/tally-cloud/index.ts under Deno), with migrations 52 -> 60 added after
51 in the order of tests/run_migration_order.py, and the S15 replay put in right after the cloud function answers (none of
that file's own checks run). The replay feeds the lines and messages the stub cloud received from the real bridge in the
real-Tally run (s15-in.json: the held line, the beat, the ledger_changes, the ":resolved" line) to tally-ingest and prints
what it answers and where the entry lands (tally_lines, tally_ledger_aliases).
  python3 patch.py <repo root at the bridge ref> <s15-in.json>"""
import os, sys
root, inp = sys.argv[1], os.path.abspath(sys.argv[2])
src = open(os.path.join(root, "tests", "run_recorder_server.py")).read()
# migrations 52..60 after 51
old = '"migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql")]'
assert old in src, "FILES anchor"
src = src.replace(old, '"migration-50-recorder-held.sql", "migration-51-recorder-ids-mismatch.sql", "migration-52-recorder-duplicate-needs-same-entry.sql", '
                  '"migration-53-recorder-placeholder-settled.sql", "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql", '
                  '"migration-57-entry-details.sql", "migration-58-lows.sql", "migration-59-ledger-aliases.sql", "migration-60-recorder-lows.sql")]')
# the bills table run_migration_order.py makes before the migrations (57 and later read it)
old = '    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))'
assert old in src, "SCHEMA47 anchor"
src = src.replace(old, old + '\n    try: db.sql(part(os.path.join(HERE, "run_migration_order.py"), "BILLS"))\n    except Exception as e: print("BILLS part:", str(e)[:200])')
anchor = '    def xml(guid, alter, date, amt, narr="Sale", ledger="Sales", cancel=False):'
assert anchor in src, "replay anchor"
replay = r'''
    # ======== S15 replay (the real-Tally run's captures, s15-in.json)
    S = json.load(open(%r))
    BS, CO = "15000000-0000-0000-0000-000000000015", S["company"]
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%%s, %%s, 'c1', %%s, '2026-04-01', '2026-03-31')" %% (q(BS), q(FIRM), q(CO)))
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": CO, "client_id": "c1", "book_id": BS})
    # FinCom's ledger list for the book: Tally's ledgers before the rename (the names and GUIDs the harness seeded the stub with)
    g_of = {v: k for k, v in S["seed"]["guids"].items()}
    FS.T["tally_groups"] = [{"book_id": BS, "firm_id": FIRM, "name": n, "parent": p} for n, p in (("Sundry Debtors", "Current Assets"), ("Current Assets", ""), ("Cash-in-Hand", "Current Assets"))]
    FS.T["tally_ledgers"] = [{"book_id": BS, "firm_id": FIRM, "name": n, "parent": "Sundry Debtors" if n.startswith("S231") else "", "chain": [], "primary_group": "", "open": 0, "open_sent": 0,
                              "tally_guid": g_of.get(n), "alter_id": 1, "gstin": None, "pan": None, "state": None, "deleted_at": None} for n in S["seed"]["names"]]
    FS.T.setdefault("tally_ledger_aliases", [])
    db.one("select tally_ingest_ledgers_g(%%s, '2026-04-01', '2026-03-31', %%s::jsonb, %%s::jsonb)::text" %% (q(BS), q(json.dumps([[n, "Sundry Debtors", "0"] for n in S["seed"]["names"]])), q(json.dumps([["Sundry Debtors", ""]]))))
    def mem():
        FS.T["tally_recorder_lines"] = [dict(r, device_id=r["device_id"] or None, body=json.loads(r["body"]) if r["body"] else None, payload=json.loads(r["payload"]) if r["payload"] else None, object_guid=r["object_guid"] or None) for r in db.rows(
            "select id, line_id, company, company_guid, event, master_id, vch_type, vch_no, vch_date::text as vch_date, book_id::text as book_id, firm_id::text as firm_id, "
            "device_id::text as device_id, bridge, state, held_why, object_guid, body::text as body, payload::text as payload, to_char(received_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as received_at from tally_recorder_lines order by id")]
    BR = dict(GA, version="2.3.1")
    out = []
    def say(w):
        print("S15 " + w); out.append(w)
    G = None
    for st_ in S["steps"]:
        if st_["kind"] == "recorder_lines":
            ln = dict(st_["line"]); G = ln.get("object_guid")
            c, r = call({"kind": "recorder_lines", "company": CO, "version": "2.3.1", "bridge": BR, "lines": [ln]})
            res = [x for x in (r.get("results") or []) if x.get("line_id") == ln["line_id"]]
            say("recorder_lines %%s (captured %%s; the stub said %%s): tally-ingest %%s %%s" %% (ln["line_id"][-20:], st_["at"], st_["stub_answer"], c, res))
        elif st_["kind"] == "beat":
            mem(); c, r = call({"kind": "beat", "version": "2.3.1", "bridge": BR, "tally": True, "open": []})
            say("beat (captured %%s; the stub said ledgersWanted %%s): tally-ingest %%s ledgersWanted %%s refetch %%s" %% (st_["at"], st_["stub_answer"].get("ledgersWanted"), c, r.get("ledgersWanted"), [(x.get("line_id", "")[-20:], x.get("ledgerAgain")) for x in (r.get("refetch") or [])]))
        elif st_["kind"] == "ledger_changes":
            b = dict(st_["body"], bridge=BR, version="2.3.1")
            c, r = call(b)
            say("ledger_changes why=%%s rows %%s (captured %%s; the stub said %%s): tally-ingest %%s %%s" %% (b.get("why"), [x[:4] for x in b.get("ledgers", [])], st_["at"], st_["stub_answer"], c, r))
            say("tally_ledger_aliases now: %%s" %% [{k: a.get(k) for k in ("tally_name", "fincom_name", "tally_guid", "confirmed_at", "ended_at")} for a in FS.T["tally_ledger_aliases"] if a.get("book_id") == BS])
            mem(); c, r = call({"kind": "beat", "version": "2.3.1", "bridge": BR, "tally": True, "open": []})
            say("the next beat: ledgersWanted %%s refetch %%s" %% (r.get("ledgersWanted"), [(x.get("line_id", "")[-20:], x.get("ledgerAgain")) for x in (r.get("refetch") or [])]))
    rows = db.rows("select line_id, state, coalesce(held_why, '') as why from tally_recorder_lines where book_id = %%s order by id" %% q(BS))
    say("tally_recorder_lines: %%s" %% [(x["line_id"][-20:], x["state"], x["why"][:160]) for x in rows])
    say("tally_lines of the entry %%s: %%s" %% (G, db.rows("select ledger, amount::text as amount from tally_lines where book_id = %%s and guid = %%s order by ledger" %% (q(BS), q(G)))))
    say("tally_vouchers: %%s" %% db.rows("select guid, day::text as day, alter_id::text as alter_id from tally_vouchers where book_id = %%s and guid = %%s" %% (q(BS), q(G))))
    say("ledgers in the book named like the party: %%s" %% [(x.get("name"), x.get("tally_guid")) for x in FS.T["tally_ledgers"] if x.get("book_id") == BS and "Name Party" in str(x.get("name"))])
    for l in log[-60:]:
        if "alias" in l or "ledger" in l.lower(): print("  deno: " + l.rstrip()[:300])
    open(os.environ.get("S15_OUT", "s15-out.txt"), "w").write("\n".join(out))
    raise SystemExit(0)
''' % inp
src = src.replace(anchor, replay + anchor, 1)
open(os.path.join(root, "tests", "run_s15_replay.py"), "w").write(src)
print("tests/run_s15_replay.py written")
