"""python3 run_daybook_kind.py - which Tally file it is, told by its content (tallyFileKind, src/js/23-column-filters.js),
for the Day Books Tally really writes. The owner, 17-Oct-2026: "I tried to upload daybook xml of new company.. it has denied
and said that it is not day book". Nothing reached the server: the browser refused the file. Fixed here:
  - UTF-16LE without the byte-order mark is read as UTF-16LE (Books.decoder sniffs the zero bytes, as FinCom's server
    does), everywhere the Day Book is read (the kind, the reading, the bridge's copy); UTF-16BE is refused in plain words
    (FinCom's server refuses it too);
  - vouchers are looked for in the WHOLE file (1 MB at a time, overlapping, stopping at the first): a Day Book whose
    ledger masters come first (400 KB and more before the first voucher) is a Day Book;
  - a Tally export of a period with no entries says so, with how to export the whole period, never "not a Day Book";
  - anything else is refused in plain words, ending "If it is a Day Book, send the file to FinCom support so we can see why."
Fixtures made here from the made-up books (tests/fixtures/books), offline, the React test build (app/dist-test).
Run: TDSDESK_SITE=../app/dist-test python3 run_daybook_kind.py"""
import io, os, re, sys, zipfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
from books_data import OUT
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def write(name, data):
    os.makedirs(OUT, exist_ok=True); p = os.path.join(OUT, name); open(p, "wb").write(data); return p

# ---------------------------------------------------------------- the fixtures
JUL, JUL_N = U.month_file("202507")                     # UTF-16LE with the BOM, as Tally writes it
raw = open(JUL, "rb").read(); text = raw[2:].decode("utf-16le")
first = text.index("<TALLYMESSAGE"); last = text.rindex("</TALLYMESSAGE>") + len("</TALLYMESSAGE>")
HEAD, BODY, FOOT = text[:first], text[first:last], text[last:]
LE_NOBOM = write("DayBook-le-nobom.xml", text.encode("utf-16le"))
BE_NOBOM = write("DayBook-be-nobom.xml", text.encode("utf-16be"))
def masters(chars):
    out, i = [], 0
    while sum(len(x) for x in out) < chars:
        out.append('<TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n<LEDGER NAME="Supplier %05d" RESERVEDNAME="">\r\n<PARENT>Sundry Creditors</PARENT>\r\n'
                   '<INCOMETAXNUMBER>AAAPA%04dA</INCOMETAXNUMBER>\r\n</LEDGER>\r\n</TALLYMESSAGE>\r\n' % (i, i % 10000)); i += 1
    return "".join(out)
M400 = masters(400 * 1024)
MASTERS_FIRST = write("DayBook-masters-first.xml", b"\xff\xfe" + (HEAD + M400 + BODY + FOOT).encode("utf-16le"))
# UTF-8, the first voucher's "<VOUCHER " across the 1 MB mark (the chunks overlap)
pad = masters(1100 * 1024)
# drop masters until the voucher's tag starts 4 bytes before the 1 MB mark
body8 = (HEAD + pad).encode("utf-8")
want_pre = 1048576 - 4 - len(BODY[:BODY.index("<VOUCHER ")].encode("utf-8"))
pre = body8[:want_pre - len(b"<!---->")]
pre = pre[:pre.rindex(b"</TALLYMESSAGE>\r\n") + len(b"</TALLYMESSAGE>\r\n")]
pre += b"<!--" + b"x" * (want_pre - len(pre) - len(b"<!---->")) + b"-->"
SPLIT_AT_1MB = write("DayBook-split-1mb.xml", pre + (BODY + FOOT).encode("utf-8"))
sp = open(SPLIT_AT_1MB, "rb").read()
ok(sp.index(b"<VOUCHER ") == 1048576 - 4, "fixture: the first <VOUCHER  starts 4 bytes before the 1 MB mark (%d)" % sp.index(b"<VOUCHER "))
# a Day Book of a period with no entries, as TallyPrime exports it
EMPTY_PERIOD = write("DayBook-empty.xml", b"\xff\xfe" + (HEAD + FOOT).encode("utf-16le"))
z = io.BytesIO()
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zz: zz.writestr("DayBook.xml", raw)
ZIP = write("DayBook-zip.xml", z.getvalue())
HTML = write("DayBook-page.xml", b"<!doctype html><html><body><p>Day Book</p></body></html>")
ADDON_ASK = re.compile(r"\b(load|loaded|update|turn on|switch on|enable|install)\b[^.\n]{0,60}\b(add-on|addon|TDLs?|recorder)\b"
                       r"|\b(add-on|addon|TDLs?|recorder)\b[^.\n]{0,40}\b(not loaded|not recording|load|update|turn on)\b|not recording|Manage Local TDLs", re.I)
PLAIN = ("is not a file FinCom can read", "If it is a Day Book, send the file to FinCom support so we can see why.")
EMPTY_WORDS = (" is a Tally export with no entries in it. In TallyPrime open Day Book, press F2 and choose the whole period (for example "
               "1-Apr-2025 to today), then Alt+E (Export) → Format XML, and upload that file.")

with sync_playwright() as p:
    srv, br, pg = U.start(p, 8489, SITE, errors=errors)
    E = pg.evaluate
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def idle(sec=90):
        for _ in range(sec * 4):
            pg.wait_for_timeout(250)
            if E("!S.books.busy && !(S.tallyUp && S.tallyUp.busy)"): break
        pg.wait_for_timeout(300)
    def up(path):
        E("() => { S.tallyUp = null; S.dbFrom = ''; S.dbTo = ''; }"); pg.set_input_files("#tallyIn", path); pg.wait_for_timeout(500); idle()
        return txt("#app [data-up-result]")
    U.open_page(pg, "owner")
    dates = E("() => S.books.vouchers.filter(v => v.date.startsWith('202507')).map(v => v.date).sort()")
    f, l = E("(d) => fmtDate(tallyDate(d))", dates[0]), E("(d) => fmtDate(tallyDate(d))", dates[-1])
    taken = r"^Read %d entr(y|ies) for %s to %s; \d+ days? updated" % (JUL_N, re.escape(f), re.escape(l))

    print("== the Day Books Tally writes: taken")
    for path, what in [(JUL, "UTF-16LE with the BOM (as before)"), (LE_NOBOM, "UTF-16LE without the BOM"),
                       (MASTERS_FIRST, "400 KB of ledger masters before the first voucher"), (SPLIT_AT_1MB, "UTF-8, the first <VOUCHER across the 1 MB mark")]:
        n0 = E("S.books.vouchers.length"); res = up(path)
        ok(re.search(taken, res) is not None and E("S.tallyUp.lines[0].kind") == "daybook" and E("S.tallyUp.lines[0].ok") is True
           and E("S.books.vouchers.length") == n0, "%s: a Day Book, read (%s)" % (what, res))
    # the reading itself agrees: Books.decoder, Books.importDayBook and the bridge's copy read BOM-less UTF-16LE
    enc = E("""async (b64) => { const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const f = new File([b], 'x.xml');
      const d = await Books.decoder(f); const r = await Books.importDayBook(f); const t = await Books.text(f);
      const sent = []; const on = Bridge.on, post = BridgeSeed.post; Bridge.on = () => true; BridgeSeed.post = async (u, body) => { sent.push(body); return {entries: (body.match(/<VOUCHER /g) || []).length}; };
      let s; try { s = await BridgeSeed.send(f, null, {from: '20250701', to: '20250731'}, 'X'); } finally { Bridge.on = on; BridgeSeed.post = post; }
      return [d.encoding, r.vouchers.length, t.slice(0, 9), s && s.entries]; }""", __import__("base64").b64encode(open(LE_NOBOM, "rb").read()).decode())
    ok(enc[0] == "utf-16le" and enc[1] == JUL_N and enc[2] == "<ENVELOPE" and enc[3] == JUL_N,
       "BOM-less UTF-16LE: Books.decoder says utf-16le; importDayBook reads %d of %d entries; Books.text reads it; the bridge's copy is given %s (%s)" % (enc[1], JUL_N, enc[3], enc))
    kind = E("""async (b64) => { const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const f = new File([b], 'm.xml'); const t0 = performance.now(); const k = await tallyFileKind(f); return [k.kind, performance.now() - t0]; }""",
             __import__("base64").b64encode(open(MASTERS_FIRST, "rb").read()).decode())
    ok(kind[0] == "daybook", "tallyFileKind: masters first, then vouchers: daybook (%s, %.0f ms)" % tuple(kind))
    # a big file with no voucher early: read 1 MB at a time to the end, still quick; a voucher early: stops at once
    big = E("""async () => { const part = new TextEncoder().encode('<TALLYMESSAGE><LEDGER NAME="A"><PARENT>B</PARENT></LEDGER></TALLYMESSAGE>\\r\\n'.repeat(13000));
      const parts = [new TextEncoder().encode('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA>')];
      for (let i = 0; i < 200; i++) parts.push(part);
      const tail = new TextEncoder().encode('<TALLYMESSAGE><VOUCHER VCHTYPE="Journal"><DATE>20250701</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>');
      const f1 = new File(parts.concat([tail]), 'big.xml'); let t0 = performance.now(); const k1 = await tallyFileKind(f1); const ms1 = performance.now() - t0;
      const f2 = new File([parts[0], tail].concat(parts.slice(1)).concat([new TextEncoder().encode('</ENVELOPE>')]), 'early.xml'); await tallyFileKind(f2); t0 = performance.now(); const k2 = await tallyFileKind(f2); const ms2 = performance.now() - t0;
      return [f1.size, k1.kind, ms1, k2.kind, ms2]; }""")
    ok(big[1] == "daybook" and big[2] < 15000, "a %.0f MB file, its one voucher at the very end: a Day Book, found in %.0f ms" % (big[0] / 1048576, big[2]))
    ok(big[3] == "daybook" and big[4] < 500, "the same size, a voucher at the start: found at once (%.0f ms)" % big[4])

    print("== refused or said plainly, nothing changed")
    n1 = E("S.books.vouchers.length")
    res = up(EMPTY_PERIOD)
    ok(res == "DayBook-empty.xml" + EMPTY_WORDS and E("S.tallyUp.lines[0].ok") is False and E("S.books.vouchers.length") == n1,
       "a Tally export with no entries: says so, with how to export the whole period (%s)" % res)
    ok("not a Day Book" not in res and "not a Tally" not in res, "never called 'not a Day Book'")
    for path, what in [(ZIP, "a zip renamed .xml"), (HTML, "a web page saved as .xml")]:
        res = up(path)
        ok(all(w in res for w in PLAIN) and res.endswith(PLAIN[1]) and E("S.tallyUp.lines[0].ok") is False and E("S.books.vouchers.length") == n1,
           "%s: refused in plain words, ending with the support line (%s)" % (what, res))
    res = up(BE_NOBOM)
    ok(res.startswith("DayBook-be-nobom.xml is saved as UTF-16 big-endian") and E("S.tallyUp.lines[0].ok") is False and E("S.books.vouchers.length") == n1,
       "UTF-16BE (FinCom's server refuses it): refused in the browser, plainly (%s)" % res)
    ok(E("() => Books.encodingOf(new Uint8Array([0xFE, 0xFF, 0, 60]))") == "utf-16be" and E("() => Books.encodingOf(new TextEncoder().encode('<ENVELOPE>'))") == "utf-8"
       and E("() => Books.encodingOf(new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 0, 8, 0, 0, 0]))") == "utf-8", "the encoding sniff: BE by its BOM, ASCII is UTF-8, a zip's header is not UTF-16")
    # 17-Oct-2026: Books > From Tally asks nothing about the add-on, TDL or recorder
    t = pg.inner_text("#app")
    ok(not ADDON_ASK.search(t), "Books › From Tally: no ask to load, update or turn on the add-on, TDL or recorder (%s)" % [m.group(0) for m in ADDON_ASK.finditer(t)][:3])
    ok(not errors, "no page errors %s" % errors[:2])
    br.close(); srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
