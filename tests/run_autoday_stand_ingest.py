"""python3 run_autoday_stand_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno) with migrations 221 and 222 on a
throwaway PostgreSQL (tests/tell_stand.py; port 31242 unless PGSTAND_PORT, its data under /tmp/tellingest-stand unless
PGSTAND_DIR, removed after; never a real database). The owner's decision of 24-Nov-2026: "There should be proper way to
tell and auto import of tally days into fincom". The day path's functions are the database's own (the queue, the claim and
its serving rule, the hand-out, the pickup, the heads); the rest of tally-ingest's reads are the stand-in for Supabase
(fake_supabase.py), the computer's record copied to the database before each of its calls. Made-up data only. Checks:
  1. a stuck line's day: queued by the beat itself (held, prio 1) and handed to the 2.5.16 bridge serving the book, as a
     check day
  2. a lone 2.5.10 bridge serving the book: handed the held day as before (p_auto false); one of 222's new days (a
     possible delete) never handed to it nor claimed, so the 2.5.16 bridge's next beat gets it at once (the claims kept
     between the beats); a bridge the database does not know as this computer's (not serving): no check day at all
  3. a pick-up refused 'slow': the day waits (tries 1, an hour) and is not handed; told once, not again each beat;
     'started' clears its why
  4. a day read in bands: a hole deletes nothing however many lists; whole bands delete on the second list a minute later
  5. a line dated before the book's first day, no earlier book: closed with 222's words, never handed; no word asks for an
     upload
Needs Deno (DENO) and PostgreSQL (pg_stand)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
os.environ["TMPDIR"] = os.environ.get("PGSTAND_DIR") or "/tmp/tellingest-stand"
os.makedirs(os.environ["TMPDIR"], exist_ok=True); os.chmod(os.environ["TMPDIR"], 0o777)
os.environ.setdefault("PG_STAND_SOCKDIR", os.environ["TMPDIR"])
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import tell_stand as T
from tell_stand import q, js, F
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
TODAY = datetime.datetime.now(datetime.timezone.utc).astimezone(IST).date()
FY = datetime.date(TODAY.year if TODAY.month >= 4 else TODAY.year - 1, 4, 1)
D = lambda n: TODAY - datetime.timedelta(days=n)
d8 = lambda d: d.strftime("%Y%m%d")
BOOK, CG, CO = "819d4a59-4cee-4bf7-8f8c-000000042222", "b20abc61-0000-4000-8000-79149af42222", "MADE UP STAND CO"
DA, KA = "dddddddd-0000-4000-8000-00000004a222", "fcd_" + "c" * 48
GA = {"id": "go-aaaaaa422222", "computer": "MADEUP-PC1", "user": "madeup-a", "mode": "main", "runMode": "user", "version": "2.5.16"}
GB = {"id": "go-bbbbbb422222", "computer": "MADEUP-PC1", "user": "madeup-b", "mode": "main", "runMode": "user", "version": "2.5.10"}
GC = {"id": "go-cccccc422222", "computer": "MADEUP-PC1", "user": "madeup-c", "mode": "main", "runMode": "user", "version": "2.5.16"}

st = T.build(int(os.environ.get("PGSTAND_PORT") or 31242), with221=True, with222=True, log=lambda *a: None); db = st.db
def bye():
    st.stop()
    try: os.rmdir(os.environ["TMPDIR"])
    except OSError: pass
fn = None
try:
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, info, period_fetch, last_seen, version) values (%s, %s, 'MADEUP-PC1', 'kh', '{}'::jsonb, true, now(), '2.5.16')" % (q(DA), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', %s, %s, %s)" % (q(BOOK), q(F), q(CO), q(FY.isoformat()), q((FY - datetime.timedelta(days=1)).isoformat())))
    db.sql("insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, state, linked_at, device_id) values (%s, %s, 'c1', %s, %s, 'linked', now() - interval '3 days', %s)" % (q(F), q(BOOK), q(CG), q(CO), q(DA)))
    db.sql("insert into tally_companies (firm_id, company, client_id, book_id, last_seen) values (%s, %s, 'c1', %s, now())" % (q(F), q(CO), q(BOOK)))
    for b in (GA, GB): db.sql("insert into tally_bridge_ids (bridge_id, device_id, firm_id) values (%s, %s, %s)" % (q(b["id"]), q(DA), q(F)))
    LN = [0]
    def line(d, ago="1 hour"):
        LN[0] += 1
        db.sql("insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, line_id, event, received_at, state, vch_date, object_guid) values (%s, 'c1', %s, %s, %s, 'altered', now() - interval %s, 'fetching', %s, %s)"
               % (q(F), q(BOOK), q(DA), q("ln-%d" % LN[0]), q(ago), q(d.isoformat()), q("%s-%d" % (CG, LN[0]))))
        return db.one("select max(id) from tally_recorder_lines")
    STUCK = D(20); line(STUCK)
    db.sql("delete from tally_check_days where book_id = %s" % q(BOOK))     # (the line's own trigger may queue it: the beat's queue must)
    cday = lambda d: (db.rows("select source, prio::text as prio, tries::text as tries, coalesce(next_at::text, '') as next_at, coalesce(last_why, '') as why, (done_at is not null)::text as done from tally_check_days where book_id = %s and day = %s" % (q(BOOK), q(d.isoformat()))) or [{}])[0]

    # the day path's functions: the database's; the computer's record copied there first
    PROCS = set(db.one("select string_agg(distinct proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'").split(","))
    ROUTE = {"tally_autoday_queue", "tally_autoday_pickup", "tally_check_heads", "tally_days_claim", "tally_check_next_open", "tally_check_next", "tally_read_serving_many",
             "tally_held_front", "tally_gap_front", "tally_period_next_paced", "tally_period_next", "tally_period_retry_days", "tally_period_unstamp", "tally_period_heads",
             "tally_held_delete_by_heads", "tally_work_claim", "tally_check_entries", "tally_period_gate"}
    CALLS = []
    ARR = {"p_books": "uuid[]", "p_days": "date[]", "p_units": "text[]"}
    def lit(k, v):
        if v is None: return "null::jsonb" if k in ("p_bands", "p_heads") else "null"
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, (int, float)): return repr(v)
        if k in ARR: return "array[%s]::%s" % (",".join(q(x) for x in v), ARR[k]) if v else "'{}'::%s" % ARR[k]
        if isinstance(v, (dict, list)): return js(v)
        return q(v)
    real = FS.rpc
    def rpc(name, a):
        if name in ROUTE and name in PROCS:
            CALLS.append((name, a))
            d = next(x for x in FS.T["tally_devices"] if x["id"] == DA)
            db.sql("update tally_devices set info = %s, last_seen = now() where id = %s" % (js(d.get("info") or {}), q(DA)))
            args = ", ".join("%s => %s" % (k, lit(k, v)) for k, v in a.items())
            try: x = db.one("select to_jsonb(public.%s(%s))::text" % (name, args))
            except RuntimeError as e:
                if "void" in str(e): db.one("select public.%s(%s)::text" % (name, args)); return None
                raise RuntimeError(str(e).split("\n")[0][:300])
            return json.loads(x) if x is not None else None
        return real(name, a)
    FS.rpc = rpc
    def sync():     # the check days as tally-ingest reads them (their sources)
        FS.T["tally_check_days"] = db.rows("select book_id::text as book_id, firm_id::text as firm_id, day::text as day, source from tally_check_days where book_id = %s" % q(BOOK))
    FS.T["tally_companies"].append({"firm_id": F, "company": CO, "client_id": "c1", "book_id": BOOK})
    FS.T["tally_books"].append({"book_id": BOOK, "firm_id": F, "client_id": "c1", "company": CO, "from_date": FY.isoformat(), "open_as_on": (FY - datetime.timedelta(days=1)).isoformat()})
    FS.T["clients"].append({"id": "c1", "firm_id": F, "name": CO, "tally_name": CO, "gstin": "", "deleted": False})
    FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}]
    FS.T["tally_devices"].append({"id": DA, "firm_id": F, "name": "MADEUP-PC1", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.16", "period_fetch": True})
    FS.start()
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.environ.get("INDEX_TS") or os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log = []
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    def call(body):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KA})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    LAST = [0.0]
    def beat(bridge=GA, **more):
        db.sql("update tally_devices set period_listed_at = null where id = %s" % q(DA))     # (the database lists days to a computer at most every 5 s: tally_period_gate)
        sync(); CALLS.clear()
        c, r = call(dict({"version": bridge["version"], "bridge": bridge, "kind": "beat", "tally": True, "open": [CO],
                          "companies": [{"name": CO, "open": True, "guid": CG, "altvchid": 100, "altmstid": 50}], "lastKeySec": 600,
                          "reqs": {"day": TODAY.isoformat(), "n": 3, "last": {"kind": "FinComCompany", "ms": 120, "at": "2026-11-24T10:00:00"}}}, **more))
        LAST[0] = time.time()
        return c, r, [d for d in (r.get("periodDays") or []) if d.get("company") == CO and d.get("kind") in ("check", "fill")]
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=h0, period_night_to=(h0 + 2) % 24, period_night_sunday=True)
    unask = lambda: db.sql("update tally_check_days set asked_at = null where book_id = %s" % q(BOOK))

    print("== 1. a stuck line's day, by itself")
    beat(GB); beat()     # both bridges' records (cos) kept: each serves the book once tally-ingest asks again (every 20 s a book)
    time.sleep(21)
    c, r, cd = beat()
    ok(cday(STUCK).get("source") == "held" and cday(STUCK).get("prio") == "1", "1. queued by the beat itself: held, prio 1 (%s)" % cday(STUCK))
    ok(c == 200 and d8(STUCK) in [d["day"] for d in cd] and all(d["kind"] == "check" for d in cd if d["day"] == d8(STUCK)), "1. handed to the 2.5.16 bridge serving the book, as a check day (%s)" % [d["day"] for d in cd])
    ok(any(n == "tally_days_claim" and a.get("p_kind") == "check" for n, a in CALLS), "1. by claim (%s)" % [n for n, _ in CALLS])

    print("== 2. an older bridge, a bridge not serving")
    db.sql("delete from tally_work_claims where book_id = %s" % q(BOOK)); unask()
    held_by = lambda b, d: db.one("select count(*) from tally_work_claims where book_id = %s and kind = 'check' and unit = %s and bridge_id = %s and until > now()" % (q(BOOK), q(d8(d)), q(b["id"])))
    beat(GB); c, r, cd = beat(GB)
    ok(c == 200 and d8(STUCK) in [d["day"] for d in cd] and held_by(GB, STUCK) == "1", "2. a lone 2.5.10 bridge: handed the stuck line's day (196's held day, as before) (%s)" % [d["day"] for d in cd])
    ok(any(n == "tally_days_claim" and a.get("p_kind") == "check" and a.get("p_auto") is False for n, a in CALLS), "2. its claim says p_auto false (%s)" % [(n, a.get("p_kind"), a.get("p_auto")) for n, a in CALLS if n == "tally_days_claim"])
    # one of 222's new days (a possible delete): never claimed by the older bridge; the claims kept between the beats
    DEL = D(15)
    db.sql("insert into tally_check_days (book_id, firm_id, day, source, prio) values (%s, %s, %s, 'delete', 2) on conflict (book_id, day) do update set source = 'delete', prio = 2" % (q(BOOK), q(F), q(DEL.isoformat())))
    unask(); c, r, cd = beat(GB)
    ok(d8(DEL) not in [d["day"] for d in cd] and held_by(GB, DEL) == "0", "2. a possible delete's day: the 2.5.10 bridge never handed nor claims it (%s)" % [d["day"] for d in cd])
    unask(); c, r, cd = beat()
    ok(c == 200 and d8(DEL) in [d["day"] for d in cd] and held_by(GA, DEL) == "1", "2. the 2.5.16 bridge's next beat: handed it at once, nothing held by the older one (%s)" % [d["day"] for d in cd])
    db.sql("delete from tally_check_days where book_id = %s and day = %s" % (q(BOOK), q(DEL.isoformat())))
    db.sql("delete from tally_work_claims where book_id = %s" % q(BOOK)); unask()
    c, r, cd = beat(GC)
    ok(c == 200 and cd == [] and not any(n in ("tally_check_next_open", "tally_check_next") and a.get("p_book") == BOOK for n, a in CALLS if n != "tally_days_claim"), "2. a bridge the database does not know as this computer's: no check day (%s)" % [d["day"] for d in cd])

    print("== 3. a pick-up refused 'slow'")
    db.sql("delete from tally_work_claims where book_id = %s" % q(BOOK)); unask()
    pk = lambda state, code=None, taken="2026-11-24T05:00:02Z": dict({"company": CO, "guid": CG, "kind": "check", "chosenAt": "2026-11-24T05:00:00Z", "takenAt": taken, "state": state, "day": d8(STUCK), "at": "2026-11-24T05:00:03Z", "login": "madeup-a"},
                                                                    **({"code": code} if code else {"pickedUtc": "2026-11-24T05:00:03Z", "pickedAt": "2026-11-24T05:00:03Z"}))
    c, r, cd = beat(pickups=[pk("refused", "slow")])
    x = cday(STUCK)
    ok(x.get("tries") == "1" and x.get("why") == "slow" and x.get("next_at") != "", "3. the day waits: tries 1, its why kept (%s)" % x)
    ok(d8(STUCK) not in [d["day"] for d in cd], "3. not handed while it waits (%s)" % [d["day"] for d in cd])
    beat(pickups=[pk("refused", "slow")])
    ok(cday(STUCK).get("tries") == "1", "3. the same word in the next beat: one try (%s)" % cday(STUCK))
    beat(pickups=[pk("started", taken="2026-11-24T06:00:02Z")])
    ok(cday(STUCK).get("why") == "", "3. 'started': its why cleared (%s)" % cday(STUCK))

    print("== 4. a day read in bands")
    DD = D(30)
    def V(guid, alter, no): return {"guid": guid, "alter": alter, "type": "Payment", "no": no, "party": "Made-up Traders", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": DD.isoformat()}
    G = lambda m: CG + "-%08x" % m
    vs = [V(G(101), 501, "1"), V(G(102), 502, "2")]
    lns = [x for v in vs for x in [[v["guid"], "Made-up Traders", -118.0, "", None, []], [v["guid"], "Bank", 118.0, "", None, []]]]
    db.one("select tally_ingest_day(%s, %s, %s, %s, %d, 502, 0)::text" % (q(BOOK), q(DD.isoformat()), js(vs), js(lns), len(vs)))
    db.sql("insert into tally_check_days (book_id, firm_id, day, source) values (%s, %s, %s, 'delete') on conflict do nothing" % (q(BOOK), q(F), q(DD.isoformat())))
    live = lambda: [g[-3:] for g in (db.one("select string_agg(guid, ',' order by guid) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(BOOK), q(DD.isoformat()))) or "").split(",") if g]
    age = lambda: db.sql("update tally_check_days set gone1_at = now() - interval '2 minutes' where book_id = %s and day = %s" % (q(BOOK), q(DD.isoformat())))
    H = [[G(101), 101, 501, "Payment"]]
    def heads(bands):
        return call({"version": "2.5.22", "bridge": GA, "kind": "period_heads", "company": CO, "company_guid": CG, "day": d8(DD), "via": "bands", "bands": bands, "heads": H, "fetch": True})
    before = live()
    for i in range(3): c, r = heads([[1, 100], [150, None]]); age()
    ok(c == 200 and before == ["065", "066"] and live() == before and r.get("partial") is True, "4. a hole: nothing deleted, three lists on (%s, %s)" % (live(), r))
    db.sql("update tally_check_days set gone1 = null, gone1_at = null where book_id = %s and day = %s" % (q(BOOK), q(DD.isoformat())))
    c, r = heads([[1, 100], [101, None]]); ok(live() == before, "4. whole bands, the first list: nothing deleted yet (%s)" % r)
    age(); c, r = heads([[1, 100], [101, None]])
    ok(live() == ["065"], "4. whole bands, the second list a minute later: the entry Tally no longer lists deleted (%s, %s)" % (live(), r))

    print("== 5. before the book's first day")
    E = FY - datetime.timedelta(days=40)
    lid = line(E, ago="2 hours"); unask()
    db.one("select tally_autoday_queue(%s)::text" % q(BOOK))     # (the beat asks once a book per 10 minutes; the sweep does the rest)
    c, r, cd = beat()
    row = db.rows("select state, coalesce(held_why, '') as why from tally_recorder_lines where id = %s" % lid)[0]
    fy0 = "%d-%02d" % (E.year if E.month >= 4 else E.year - 1, ((E.year if E.month >= 4 else E.year - 1) + 1) % 100)
    ok(row == {"state": "stale", "why": "Made in Tally in %s, a year FinCom does not keep." % fy0}, "5. no earlier book: closed with 222's words (%s)" % row)
    ok(d8(E) not in [d["day"] for d in (r.get("periodDays") or [])], "5. never handed")
    words = json.dumps(r) + json.dumps(next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {})
    ok("upload the day book" not in words.lower() and "please upload" not in words.lower(), "5. no word asks for an upload")
finally:
    if fn: fn.terminate()
    bye()
if fails:
    print("".join(log[-40:]) if fn else "")
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
