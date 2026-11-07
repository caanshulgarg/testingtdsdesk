"""python3 run_tally_daybook_drop.py - "Or drop a Day Book file here" in a client's Entries card on the Tally page
(next-tally-daybook; TallyProgress.jsx DayBookDrop, app/src/lib/dayBookDrop.js). The review of 0b3c34839 blocked the first
version, which swapped the open client (S.coId / S.books) around Books › From Tally's reading. Here the file is read into
the books of the client dropped on, taken explicitly end to end, and each case proves that its entries land only in that
client's books (this browser's copy, books:<cid>) and its cloud upload (TCloudUp.handOver's who.client), and that the
client open on this page (S.coId, S.books) is untouched, byte for byte:
  1. a drop while another client is open: the open client's S.coId and S.books the same object and the same bytes;
  2. two drops back to back on different clients: one at a time on the page (every other box "Another file is being
     read…", a drop there takes nothing), the second after the first; the first's cloud upload still going while the
     second is read keeps to the first client (A1);
  3. a client opened from the switcher while a file is read (the read held, as a long import or a question): the file
     still goes to the client dropped on, never the one opened (A2);
  4. a viewer: no box to drop on, only why; a drop there reads nothing (A4);
  5. an error thrown in the middle of a read: said under the box, the page free again (A5), nothing saved;
  6. a trial balance, an Excel file: refused, "drop a trial balance on Books › From Tally" (A6), nothing saved;
  7. a ledger masters file: its groups and PANs into the client dropped on only;
  8. a drop on the client open here: its open books (S.books, the same object) take the entries, saved as its own.
Made-up firm, clients and companies only (the stand-in cloud of run_tally_page_clean.py / run_tally_simple.py).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_daybook_drop.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_DAYBOOK_DROP_PORT", "9583"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.5.exe", "sha256": "cd" * 32}}
PC = "SRV01"; UA = PC + "\\made-up-a"
HERON, QUILL, LARK = "Heron Mills", "Quill Papers", "Lark Studio"          # made-up clients (Lark: the one open)
GUID = {HERON: "a1a1a1a1-0000-4000-8000-00000000a1a1", QUILL: "b2b2b2b2-0000-4000-8000-00000000b2b2", LARK: "c3c3c3c3-0000-4000-8000-00000000c3c3"}

def daybook(company, tag, days=3, month="202607"):
    """a Day Book of made-up entries (Tally's XML), each narration marked with tag"""
    v = []
    for i in range(days):
        d = month + "%02d" % (i + 1)
        v.append('<TALLYMESSAGE><VOUCHER VCHTYPE="Payment" ACTION="Create"><DATE>%s</DATE><GUID>%s-%08x</GUID><VOUCHERNUMBER>%d</VOUCHERNUMBER>'
                 '<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><NARRATION>%s-%d</NARRATION>'
                 '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-1000.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
                 '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><AMOUNT>1000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>'
                 % (d, GUID[company], sum(map(ord, tag)) * 100 + i, i + 1, tag, i))
    return ("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>"
            "<STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>%s</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
            % (company.upper(), "".join(v))).encode("utf-8")
def masters(company):
    return ("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>"
            "<STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>"
            "<TALLYMESSAGE><GROUP NAME=\"Made-up Creditors\"><PARENT>Current Liabilities</PARENT></GROUP></TALLYMESSAGE>"
            "<TALLYMESSAGE><LEDGER NAME=\"Rent\"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>"
            "<TALLYMESSAGE><LEDGER NAME=\"Made-up Landlord\"><PARENT>Made-up Creditors</PARENT><INCOMETAXNUMBER>AAAPZ0001Z</INCOMETAXNUMBER></LEDGER></TALLYMESSAGE>"
            "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>" % company.upper()).encode("utf-8")
TB = (b"<ENVELOPE><DSPACCNAME><DSPDISPNAME>Cash</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-5000.00</DSPCLDRAMTA></DSPCLDRAMT></DSPACCINFO>"
      b"<DSPACCNAME><DSPDISPNAME>Capital</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLCRAMT><DSPCLCRAMTA>5000.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO></ENVELOPE>")
XML = lambda name, data: {"name": name, "mimeType": "text/xml", "buffer": data}

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        R = lambda name: '#app [data-tsm-table] tr[data-tsm-row="%s"]' % name

        up = {"port": 9039, "ok": True, "skipped": False, "n": 3, "error": "", "reason": "open"}
        dA = T.dev(7, PC, "made-up-a", tally="open", opened=(HERON.upper(), QUILL.upper(), LARK.upper()), version="2.5.5", rec=(HERON.upper(), QUILL.upper(), LARK.upper()), beat={"bridgePort": 9101, "windowsUser": UA}, ports=[up])
        cos = [{"company": c.upper(), "client_id": "NAME:" + c, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"} for c in (HERON, QUILL, LARK)]
        ids = E(T.SETUP, [[dA], cos, [], "owner", [HERON, QUILL, LARK], True, {HERON: T.book(HERON), QUILL: T.book(QUILL)}])
        E("() => { window.__linksApi = false; }")
        E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, {"9101": TS.ping(9101, True, UA, version="2.5.5", bridgeId="go-7")}); E(TS.FORGET); E(TS.MINE, ["", "", ""])
        H, Q, L = ids[HERON], ids[QUILL], ids[LARK]
        # FinCom's cloud: each upload recorded with its client (who), held while window.__upHold; the reading of a file held
        # while its name is in window.__holdRead (a long import, a question asked); the bridge's copy not connected here
        E("""() => { window.__ups = []; window.__upWait = []; window.__holdRead = {}; window.__readGo = {}; window.__dbReads = [];
          TCloudUp.on = () => true;
          TCloudUp.handOver = async (f, range, step, who, name) => { window.__ups.push({client: who && who.client, company: who && who.company, name, from: range.from, to: range.to, at: 'start'});
            if (window.__upHold) await new Promise((r) => window.__upWait.push(r));
            window.__ups.push({client: who && who.client, name, at: 'done'}); return {days: 3, job: 'job-' + name}; };
          BridgeSeed.send = async () => ({skipped: 'not in this test'});
          const imp = Books.importDayBook;
          Books.importDayBook = async function (f, p) { window.__dbReads.push(f.name); if (window.__holdRead[f.name]) await new Promise((r) => { window.__readGo[f.name] = r; }); return imp.call(this, f, p); };
          const mi = Books.importMasters;
          Books.importMasters = async function (f, p) { window.__dbReads.push(f.name); return mi.call(this, f, p); }; }""")
        # the client open on this page: Lark Studio, its books open (S.books) with entries of its own
        E("""async (c) => { await Books.save(c, {cid: c, vouchers: [{id: 'lark-1', date: '20260601', type: 'Payment', narr: 'LARK-own', ent: [{l: 'Rent', a: -500}, {l: 'Cash', a: 500}]}],
            map: {}, meta: {from: '20260601', to: '20260601', parts: [{from: '20260601', to: '20260601', n: 1, file: 'lark.xml'}]}, challans: [], alloc: {}, pans: {}});
          Books.forget(c); S.coId = c; S.books = null; await openBooks(c); }""", L)
        pg.wait_for_timeout(2500)
        E("() => { navHome('tally'); }"); pg.wait_for_timeout(2500)
        # the open client's books as they are now: the same object and the same bytes are looked for after every case
        E("() => { window.__open = S.books; window.__openBytes = JSON.stringify(S.books); window.__openCo = S.coId; }")
        def open_same(case):
            r = E("() => [S.coId === window.__openCo, S.books === window.__open, JSON.stringify(S.books) === window.__openBytes, S.coId, S.books && S.books.cid]")
            ok(r[0] and r[1] and r[2], "%s: the client open here untouched (S.coId %s, S.books the same object %s, the same bytes %s)" % (case, r[3], r[1], r[2]))
        def books(c):
            return E("""async (c) => { const d = await IDBStore.get('books:' + c); return d ? {n: (d.vouchers || []).map((v) => v.narr), parts: ((d.meta || {}).parts || []).map((p) => [p.file, p.cloud || '']),
              pans: d.pans || {}, groups: Object.keys(d.groups || {}), co: d.tallyCo || null} : null; }""", c)
        def marks(c, tag):
            b = books(c); return [x for x in ((b or {}).get("n") or []) if str(x).startswith(tag + "-")]
        ups = lambda: E("() => window.__ups")
        lark0 = books(L)
        ok(lark0 and lark0["n"] == ["LARK-own"] and E("() => S.coId") == L and E("() => S.books && S.books.cid") == L, "setup: Lark Studio open here, its books (S.books) open, one entry of its own")
        def details(name):
            if n('#app [data-tpg-drow="%s"]' % ids[name]) == 0: pg.click(R(name) + " [data-tpt-open]"); pg.wait_for_timeout(1200)
            return '#app [data-tpg-drow="%s"]' % ids[name]
        def wait_free(ms=8000):
            try: pg.wait_for_function("() => { const b = document.querySelector('#app [data-tpg-drop]'); return b && !b.classList.contains('off') && /Or drop a Day Book/.test(b.innerText); }", timeout=ms)
            except Exception: pass

        print("== 1. a drop while another client is open")
        DH = details(HERON)
        box = DH + ' [data-tpg-d="entries"] [data-tpg-drop]'
        ok(n(box) == 1 and txt(box) == "Or drop a Day Book file here" and n(DH + " input[type=file][data-tpg-drop-file]") == 1, "1. Heron's Entries card: Or drop a Day Book file here (%s)" % txt(box))
        pg.set_input_files(DH + " input[data-tpg-drop-file]", XML("heron-jul.xml", daybook(HERON, "HERON1")))
        wait_free(); pg.wait_for_timeout(1500)
        lines = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-drop-line]')].map((e) => [e.getAttribute('data-tpg-drop-line'), e.innerText])", DH)
        ok(lines and lines[-1][0] == "ok" and lines[-1][1].startswith("Read 3 entries for ") and "3 days updated" in lines[-1][1], "1. the result under the box (%s)" % lines)
        ok(marks(H, "HERON1") == ["HERON1-0", "HERON1-1", "HERON1-2"], "1. the entries in Heron's books (%s)" % books(H))
        ok(not marks(L, "HERON1") and not marks(Q, "HERON1") and books(L) == lark0, "1. none in Lark's (open) or Quill's books; Lark's copy here unchanged")
        u = [x for x in ups() if x["at"] == "start"]
        ok(len(u) == 1 and u[0]["client"] == H and u[0]["company"] == HERON and u[0]["name"] == "heron-jul.xml", "1. its cloud upload for Heron and Heron's Tally company (%s)" % u)
        ok(E("(c) => IDBStore.prefix('tcup:' + c + ':').then((x) => x.length)", L) == 0, "1. no Day Book kept to send for Lark")
        open_same("1")

        print("== 2. two drops back to back on different clients")
        E("() => { window.__ups = []; window.__dbReads = []; window.__holdRead['heron-aug.xml'] = true; }")
        DH = details(HERON)
        pg.set_input_files(DH + " input[data-tpg-drop-file]", XML("heron-aug.xml", daybook(HERON, "HERON2", month="202608")))
        pg.wait_for_function("() => (window.__dbReads || []).includes('heron-aug.xml')")
        ok(txt(DH + " [data-tpg-drop]") == "Reading the file…" and n(DH + " [data-tpg-drop-step]") == 1, "2. Heron's box: Reading the file…, its progress line (%s)" % txt(DH + " [data-tpg-drop-say]"))
        DQ = details(QUILL)
        ok(txt(DQ + " [data-tpg-drop]") == "Another file is being read…" and E("(s) => document.querySelector(s + ' input[data-tpg-drop-file]').disabled", DQ),
           "2. Quill's box while Heron's file is read: Another file is being read…, its file box off (%s)" % txt(DQ + " [data-tpg-drop]"))
        # a file dropped there all the same: nothing taken
        E("""(s) => { const dt = new DataTransfer(); dt.items.add(new File(['<ENVELOPE></ENVELOPE>'], 'quill-early.xml', {type: 'text/xml'}));
          document.querySelector(s + ' [data-tpg-drop]').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true})); }""", DQ)
        pg.wait_for_timeout(600)
        ok(E("() => window.__dbReads") == ["heron-aug.xml"] and n(DQ + " [data-tpg-drop-line]") == 0, "2. the drop on Quill meanwhile took nothing (reads %s)" % E("() => window.__dbReads"))
        # Heron's file read; its upload to the cloud held, still going while Quill's file is read (A1)
        E("() => { window.__upHold = true; window.__readGo['heron-aug.xml'](); }")
        pg.wait_for_function("() => window.__ups.some((u) => u.name === 'heron-aug.xml')"); wait_free()
        pg.set_input_files(DQ + " input[data-tpg-drop-file]", XML("quill-jul.xml", daybook(QUILL, "QUILL1")))
        pg.wait_for_function("() => window.__ups.some((u) => u.name === 'quill-jul.xml')"); wait_free()
        E("() => { window.__upHold = false; window.__upWait.splice(0).forEach((r) => r()); }"); pg.wait_for_timeout(1500)
        u = [(x["client"], x["name"]) for x in ups() if x["at"] == "start"]
        ok(u == [(H, "heron-aug.xml"), (Q, "quill-jul.xml")], "2. each upload for its own client, Heron's still going while Quill's was read (%s)" % u)
        ok(marks(H, "HERON2") == ["HERON2-0", "HERON2-1", "HERON2-2"] and marks(H, "HERON1") == ["HERON1-0", "HERON1-1", "HERON1-2"] and not marks(H, "QUILL1"),
           "2. Heron's books: its July and August, nothing of Quill's (%s)" % books(H)["n"])
        ok(marks(Q, "QUILL1") == ["QUILL1-0", "QUILL1-1", "QUILL1-2"] and not marks(Q, "HERON2") and not marks(Q, "HERON1"), "2. Quill's books: its own only (%s)" % (books(Q) or {}).get("n"))
        hp = books(H)["parts"]
        ok([x[0] for x in hp] == ["heron-jul.xml", "heron-aug.xml"] and all("FinCom" in x[1] or "cloud" in x[1] for x in hp), "2. Heron's parts, each with its cloud line, saved with Heron's books (%s)" % hp)
        ok(not marks(L, "HERON2") and not marks(L, "QUILL1") and books(L) == lark0, "2. Lark's copy here unchanged")
        open_same("2")

        print("== 3. a client opened from the switcher while a file is read")
        E("() => { window.__ups = []; window.__dbReads = []; window.__holdRead['heron-sep.xml'] = true; }")
        DH = details(HERON)
        pg.set_input_files(DH + " input[data-tpg-drop-file]", XML("heron-sep.xml", daybook(HERON, "HERON3", month="202609")))
        pg.wait_for_function("() => (window.__dbReads || []).includes('heron-sep.xml')")
        E("() => openSwitcher()"); pg.wait_for_timeout(600)
        pg.click('[role=option]:has-text("%s")' % QUILL); pg.wait_for_timeout(1500)
        E("(c) => openBooks(c)", Q); pg.wait_for_timeout(1500)
        ok(E("() => [S.view, S.coId, S.books && S.books.cid]") == ["company", Q, Q], "3. Quill opened from the switcher, its books open (%s)" % E("() => [S.view, S.coId, S.books && S.books.cid]"))
        E("() => { window.__quillOpen = S.books; window.__quillBytes = JSON.stringify(S.books); window.__readGo['heron-sep.xml'](); }")
        pg.wait_for_function("() => window.__ups.some((u) => u.name === 'heron-sep.xml')"); pg.wait_for_timeout(1500)
        u = [(x["client"], x["name"]) for x in ups() if x["at"] == "start"]
        ok(u == [(H, "heron-sep.xml")], "3. the upload for Heron, the client dropped on (%s)" % u)
        ok(marks(H, "HERON3") == ["HERON3-0", "HERON3-1", "HERON3-2"] and not marks(Q, "HERON3"), "3. the entries in Heron's books, none in Quill's (%s)" % (books(Q) or {}).get("n"))
        r = E("() => [S.coId, S.books === window.__quillOpen, JSON.stringify(S.books) === window.__quillBytes, (S.books.vouchers || []).some((v) => /^HERON/.test(v.narr))]")
        ok(r[0] == Q and r[1] and r[2] and not r[3], "3. Quill (open now) untouched: S.coId, its open books the same object and bytes, no Heron entry (%s)" % r)
        E("(c) => { S.coId = c; S.books = window.__open; navHome('tally'); }", L); pg.wait_for_timeout(1500)
        DH = details(HERON)
        lines = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-drop-line]')].map((e) => e.innerText)", DH)
        ok(lines and lines[-1].startswith("Read 3 entries for ") and txt(DH + " [data-tpg-drop]") == "Or drop a Day Book file here", "3. back on the Tally page: the result under Heron's box, the box free (%s)" % lines)
        open_same("3")

        print("== 4. a viewer")
        E("() => { S.account.me.role = 'viewer'; render(); }"); pg.wait_for_timeout(500)
        DH = details(HERON)
        ok(txt(DH + " [data-tpg-drop]") == "A member of the firm who may make changes uploads a Day Book." and n(DH + " input[data-tpg-drop-file]") == 0, "4. a viewer: why, no file box (%s)" % txt(DH + " [data-tpg-drop]"))
        E("() => { window.__dbReads = []; window.__ups = []; }")
        E("""(s) => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'viewer.xml', {type: 'text/xml'}));
          document.querySelector(s + ' [data-tpg-drop]').dispatchEvent(new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true})); }""", DH)
        pg.wait_for_timeout(800)
        ok(E("() => window.__dbReads") == [] and ups() == [] and not marks(H, "viewer"), "4. a viewer's drop reads and sends nothing")
        E("() => { S.account.me.role = 'owner'; render(); }"); pg.wait_for_timeout(500)
        open_same("4")

        print("== 5. an error thrown in the middle of a read")
        before = books(Q)
        E("() => { window.__dbReads = []; window.__ups = []; const m = Books.mapLedgers; Books.mapLedgers = function () { Books.mapLedgers = m; throw new Error('made-up failure in the middle'); }; }")
        DQ = details(QUILL)
        pg.set_input_files(DQ + " input[data-tpg-drop-file]", XML("quill-aug.xml", daybook(QUILL, "QUILL2", month="202608")))
        wait_free(); pg.wait_for_timeout(800)
        lines = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-drop-line]')].map((e) => [e.getAttribute('data-tpg-drop-line'), e.innerText])", DQ)
        ok(lines and lines[-1] == ["bad", "Not read: made-up failure in the middle."], "5. said under the box (%s)" % lines)
        ok(txt(DQ + " [data-tpg-drop]") == "Or drop a Day Book file here" and not E("(s) => document.querySelector(s + ' input[data-tpg-drop-file]').disabled", DQ), "5. the box free again (busy cleared)")
        ok(books(Q) == before and ups() == [], "5. nothing saved, nothing sent for Quill")
        pg.set_input_files(DQ + " input[data-tpg-drop-file]", XML("quill-aug.xml", daybook(QUILL, "QUILL2", month="202608")))
        wait_free(); pg.wait_for_timeout(1200)
        ok(marks(Q, "QUILL2") == ["QUILL2-0", "QUILL2-1", "QUILL2-2"] and [x["client"] for x in ups() if x["at"] == "start"] == [Q], "5. the next drop is read, for Quill (%s)" % ups())
        open_same("5")

        print("== 6. a trial balance, an Excel file")
        before = books(H); E("() => { window.__dbReads = []; window.__ups = []; }")
        DH = details(HERON)
        pg.set_input_files(DH + " input[data-tpg-drop-file]", [XML("heron-tb.xml", TB), {"name": "heron-tb.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": b"PK\x03\x04made-up"}])
        wait_free(); pg.wait_for_timeout(800)
        lines = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-drop-line]')].map((e) => [e.getAttribute('data-tpg-drop-line'), e.innerText])", DH)
        ok(len(lines) == 2 and all(x[0] == "bad" and "drop a trial balance on Books › From Tally" in x[1] for x in lines) and any(x[1].startswith("heron-tb.xml is a trial balance") for x in lines),
           "6. both refused: drop a trial balance on Books › From Tally (%s)" % lines)
        ok(books(H) == before and ups() == [] and E("() => window.__dbReads") == [], "6. nothing read, saved or sent")
        open_same("6")

        print("== 7. a ledger masters file")
        DH = details(HERON)
        pg.set_input_files(DH + " input[data-tpg-drop-file]", XML("heron-masters.xml", masters(HERON)))
        wait_free(); pg.wait_for_timeout(1000)
        lines = E("(s) => [...document.querySelectorAll(s + ' [data-tpg-drop-line]')].map((e) => e.innerText)", DH)
        hb, qb = books(H), books(Q)
        ok(lines and lines[-1].startswith("Read the ledger masters: 2 ledgers (1 with PAN"), "7. said under the box (%s)" % lines)
        ok(hb["pans"].get("Made-up Landlord") == "AAAPZ0001Z" and "Made-up Creditors" in hb["groups"] and marks(H, "HERON1"), "7. into Heron's books, its entries kept (%s)" % hb["groups"])
        ok("Made-up Landlord" not in (qb or {}).get("pans", {}) and "Made-up Landlord" not in (books(L) or {}).get("pans", {}), "7. not into Quill's or Lark's")
        open_same("7")

        print("== 8. a drop on the client open here")
        E("() => { window.__dbReads = []; window.__ups = []; }")
        DL = details(LARK)
        pg.set_input_files(DL + " input[data-tpg-drop-file]", XML("lark-jul.xml", daybook(LARK, "LARK1")))
        wait_free(); pg.wait_for_timeout(1500)
        r = E("(c) => [S.coId === c, S.books === window.__open, (S.books.vouchers || []).map((v) => v.narr)]", L)
        ok(r[0] and r[1] and r[2] == ["LARK-own", "LARK1-0", "LARK1-1", "LARK1-2"], "8. Lark's open books (the same object) took the entries (%s)" % r)
        ok(marks(L, "LARK1") == ["LARK1-0", "LARK1-1", "LARK1-2"] and "LARK-own" in books(L)["n"] and not marks(H, "LARK1") and not marks(Q, "LARK1"), "8. saved as Lark's, none in Heron's or Quill's (%s)" % books(L)["n"])
        ok([x["client"] for x in ups() if x["at"] == "start"] == [L], "8. the upload for Lark (%s)" % ups())
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
