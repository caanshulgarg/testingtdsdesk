"""python3 run_upload_split.py - round 20 part c (docs/cloud-recorder-plan.md 3): a Day Book uploaded to Storage (bucket
tally-uploads, migration 47) is split into days by FinCom's server, reading the stored file in byte ranges, a piece of a few
MB at a time (each within the 2 s CPU limit), and the days go on the existing tally_work queue as the browser's hand-over
put them there. The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py: Storage answers Range requests); never a real database or Storage.
  upload_new {client, name, size, from, to} -> {job, path '<firm>/<job>.xml'}: a tally_jobs row kind 'upload' (total = the
    period's days), the file's path, period, size and name kept on it (tally_jobs.upload); a bad period or size refused;
  upload_done {client, job, path} -> the job sealed, the first piece {job, firm, book, upload: {path, from, ...}} queued;
    a file not in Storage refused; a second upload_done changes nothing;
  the pieces: each reads its byte range (Range: bytes=a-b), UTF-16LE (with or without the BOM) or UTF-8 (with or without),
    a voucher cut at a range end carried into the next piece's message, the vouchers grouped by <DATE> into day files
    exactly as the browser's split() (src/js/49-tally-cloud.js) makes them (every day of the period, the empty ones too;
    entries outside the period left out), queued as the existing days pieces; progress on the job (done of total: done
    when every day is read).
Checks: (A) a 30 MB UTF-16LE Day Book with the BOM (a year, a few thousand entries, Hindi, the rupee sign and characters
outside the BMP in narrations) split by 4 MB ranges equals the browser split's day files byte for byte, each day once; the
time per piece is measured (the split's own work: decoding, cutting, building and packing the day files); (B) with ranges
of 1,000,003 bytes (an odd size: cuts inside UTF-8 characters, between UTF-16 code units and inside surrogate pairs): UTF-8
without the BOM, UTF-16LE without the BOM, UTF-8 with the BOM - each equal to the browser split's; a file out of date order
(entries of earlier days further on): the days met again are read again whole (a second pass over their byte ranges) and
the LAST file queued for every day equals the browser's; (C) the same file uploaded twice through the real day path
(tally_ingest_day on a throwaway PostgreSQL, pg_stand port 30484, staging's order to 46) doubles nothing: the entries, lines,
versions and the ledger-day cache are the same after the second upload.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, re, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
import pg_stand, csv
csv.field_size_limit(1 << 30)
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
SRCJS = os.path.join(HERE, "..", "src", "js", "49-tally-cloud.js")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
def until(fn, secs=60, step=0.2):
    t = time.time()
    while time.time() - t < secs:
        v = fn()
        if v: return v
        time.sleep(step)
    return None
FIRM, BOOK, CID = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "c-1"
TMP = tempfile.mkdtemp(prefix="upsplit-")

# ---------------------------------------------------------------- the Day Books (made from the made-up books' entries)
fx = open(os.path.join(HERE, "fixtures", "books", "DayBook.xml"), "rb").read().decode("utf-16")
TEMPL = re.findall(r"<VOUCHER\b[\s\S]*?</VOUCHER>", fx)
HEAD = fx[:fx.index("<TALLYMESSAGE")]; FOOT = fx[fx.rindex("</TALLYMESSAGE>") + len("</TALLYMESSAGE>"):]
NARR = ["Sale to Ramesh & Sons", "बिक्री - दिल्ली ₹ 1,180", "Rent ₹ 25,000 for October", "Freight 😀 paid (𝄞 note)", "Café – crème brûlée", "Plain ASCII narration",
        "बिक्री दिल्ली ₹ " * 120, "😀𝄞" * 400]
def day_list(a, b):
    import datetime
    d, e = datetime.date(int(a[:4]), int(a[4:6]), int(a[6:])), datetime.date(int(b[:4]), int(b[4:6]), int(b[6:]))
    out = []
    while d <= e: out.append(d.strftime("%Y%m%d")); d += datetime.timedelta(days=1)
    return out
def make_book(target_bytes_utf16, seed=0, shuffle=False, tag="u"):
    """a Day Book of FY 2026-27 sorted by date (unless shuffle), about target_bytes_utf16 in UTF-16; Sundays empty; an entry
    outside the period at both ends (left out by both splits)"""
    import datetime
    days = [d for d in day_list("20260401", "20270331") if datetime.date(int(d[:4]), int(d[4:6]), int(d[6:])).isoweekday() != 7]
    avg = sum(len(t) for t in TEMPL) / len(TEMPL) * 2 + 120
    per_day = max(1, int(target_bytes_utf16 / avg / len(days)) + 1)
    cnt = [0]
    def one(d):
        n = cnt[0]; cnt[0] += 1
        t = TEMPL[(n + seed) % len(TEMPL)]
        t = re.sub(r"<DATE>\d{8}</DATE>", "<DATE>%s</DATE>" % d, t)
        t = re.sub(r"<GUID>[^<]*</GUID>", "<GUID>%s-%06d</GUID>" % (tag, n), t, count=1)
        t = re.sub(r"<NARRATION>[^<]*</NARRATION>", "<NARRATION>%s %d</NARRATION>" % (NARR[n % len(NARR)].replace("&", "&amp;"), n), t, count=1)
        return t
    body = [one(d) for d in days for _ in range(per_day)]
    if shuffle:                                                           # entries of earlier days further on (out of date order)
        L = len(body)
        moved = [body.pop(k) for k in (L * 6 // 10, L * 3 // 10 + 1, L * 3 // 10, L // 20)]
        at = len(body) * 3 // 4
        body[at:at] = moved
    vs = [one("20260331")] + body + [one("20270401")]
    return HEAD + "".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n' + v + "\r\n</TALLYMESSAGE>\r\n" for v in vs) + FOOT
PIECE_B = 1000003
def align(text, enc, bom):
    """the first range end (byte PIECE_B) made to fall inside a character: inside a UTF-8 character, or (UTF-16LE) the code
    unit before it the first half of a surrogate pair - by putting a few more letters ('x', one byte / one code unit each) into
    the first entry's narration, so the nearest such character before the end moves onto it"""
    i = text.index("<NARRATION>") + len("<NARRATION>")
    d = encode(text, enc, bom)
    if enc == "utf-8":
        p = max(k for k in range(i, PIECE_B + 1) if (d[k] & 0xC0) == 0x80)
        t = text[:i] + "x" * (PIECE_B - p) + text[i:]; d2 = encode(t, enc, bom); assert (d2[PIECE_B] & 0xC0) == 0x80
    else:
        o = 2 if bom else 0; tgt = PIECE_B - 3
        p = max(k for k in range(o, tgt + 1, 2) if 0xD800 <= (d[k] | (d[k + 1] << 8)) <= 0xDBFF)
        t = text[:i] + "x" * ((tgt - p) // 2) + text[i:]; d2 = encode(t, enc, bom); assert 0xD800 <= (d2[tgt] | (d2[tgt + 1] << 8)) <= 0xDBFF
    return t
def encode(text, enc, bom):
    if enc == "utf-16le": return (b"\xff\xfe" if bom else b"") + text.encode("utf-16-le")
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")

# ---------------------------------------------------------------- the browser's split (src/js/49-tally-cloud.js), run under Deno
src = open(SRCJS).read()
m = re.search(r"\n  split\(text, range\)\{\n(.*?)\n  \},\n", src, re.S)
SPLIT_BODY = m.group(1) if m else None
def browser_days(path, rng):
    """{day: sha256 of the day file the browser hands over} from TCloudUp.split() and handOver()'s envelope"""
    js = os.path.join(TMP, "split.mjs")
    open(js, "w").write("""
const BridgeSeed = { add(d, n) { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)); return t.toISOString().slice(0, 10).replace(/-/g, ""); } };
const split = function (text, range) {
%s
};
const raw = Deno.readFileSync(Deno.args[0]);
const le16 = (raw[0] === 0xFF && raw[1] === 0xFE) || (raw[1] === 0 && raw[0] !== 0);
const text = new TextDecoder(le16 ? "utf-16le" : "utf-8").decode(raw);
const { all, byDay } = split(text, { from: Deno.args[1], to: Deno.args[2] });
const out = {};
for (const d of all) {
  const xml = "<ENVELOPE><BODY><DATA>" + (byDay.get(d) || []).map(v => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("") + "</DATA></BODY></ENVELOPE>";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(xml)));
  out[d] = Array.from(h).map(b => b.toString(16).padStart(2, "0")).join("");
}
console.log(JSON.stringify(out));
""" % SPLIT_BODY)
    r = subprocess.run([DENO, "run", "--allow-read", js, path, rng[0], rng[1]], capture_output=True, text=True)
    if r.returncode: raise SystemExit("the browser split under Deno failed: " + r.stderr[-800:])
    return json.loads(r.stdout)

# ---------------------------------------------------------------- the cloud function and its stand-ins
FS.USERS["tok-owner"] = {"id": "u-owner", "email": "owner@zz.test"}; FS.USERS["tok-other"] = {"id": "u-other", "email": "x@yy.test"}
FS.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}, {"user_id": "u-other", "firm_id": "f-2", "role": "owner", "active": True}]
FS.T["clients"] += [{"id": CID, "firm_id": FIRM, "name": "ZZ UP", "tally_name": "ZZ UP", "gstin": "", "deleted": False}, {"id": "c-9", "firm_id": "f-2", "name": "THEIRS", "tally_name": "THEIRS", "gstin": "", "deleted": False}]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ UP", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"},
                            {"firm_id": "f-2", "company": "THEIRS", "client_id": "c-9", "book_id": "b-9", "last_seen": "2026-10-01T00:00:00Z"}]
srv = FS.start()
db = None; ROUTE = {"day": False}
real_rpc = FS.rpc
def lit(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, (dict, list)): return q(json.dumps(v)) + "::jsonb"
    return q(v)
def rpc(name, a):
    if ROUTE["day"] and name == "tally_ingest_day":
        FS.ARGS.setdefault(name, []).append({"p_day": a.get("p_day")})
        try: return json.loads(db.one("select public.tally_ingest_day(%s)::text" % ", ".join("%s => %s" % (k, lit(v)) for k, v in a.items())))
        except RuntimeError as e: raise RuntimeError(str(e).split("\n")[0][:300])
    return real_rpc(name, a)
FS.rpc = rpc
fn = None; log = []
def start_fn(piece, **extra):
    global fn, log
    if fn: fn.terminate(); fn.wait()
    log = []
    env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key", TALLY_WORK_VT="3", TALLY_UPLOAD_PIECE=str(piece), **extra)
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lg = log
    threading.Thread(target=lambda: [lg.append(l) for l in fn.stdout], daemon=True).start()
    return until(lambda: any("Listening" in l for l in lg), 120)
def call(body, tok="tok-owner", headers=None):
    h = {"Content-Type": "application/json"}; h.update(headers or {})
    if tok: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    def js_(b):
        try: return json.loads(b or b"{}")
        except ValueError: return {"_raw": b[:300].decode("utf-8", "replace")}
    try: r = urllib.request.urlopen(rq, timeout=120); return r.status, js_(r.read())
    except urllib.error.HTTPError as e: return e.code, js_(e.read())
jrow = lambda job: next((x for x in FS.T["tally_jobs"] if x["id"] == job), {})
def work_until_done(job, secs=240):
    """the database's timer (pg_cron's tally-work) wakes the worker while the job runs"""
    if not job: return False
    t = time.time()
    while time.time() - t < secs:
        if jrow(job).get("status") in ("done", "failed") and all(x["archived"] for x in FS.QUEUE if (x["message"] or {}).get("job") == job): return True
        call({"kind": "work"}, tok=None, headers={"x-fincom-work": FS.WORK_KEY})
        time.sleep(0.3)
    return False
def server_days(job):
    """{day: [sha256 of each day file queued for it, in queue order]}, from the days pieces of this job"""
    out = {}
    for x in sorted(FS.QUEUE, key=lambda x: x["msg_id"]):
        msg = x["message"] or {}
        if msg.get("job") != job or not isinstance(msg.get("days"), list): continue
        for d in msg["days"]:
            out.setdefault(d["day"], []).append(hashlib.sha256(gzip.decompress(base64.b64decode(d["gz"]))).hexdigest())
    return out
def upload(name, data, rng=("20260401", "20270331")):
    c, r = call({"kind": "upload_new", "client": CID, "name": name, "size": len(data), "from": rng[0], "to": rng[1]})
    job, path = r.get("job"), r.get("path")
    FS.FILES["tally-uploads/" + str(path)] = data          # the browser's TUS upload (run_upload_storage.py)
    c2, r2 = call({"kind": "upload_done", "client": CID, "job": job, "path": path})
    return c, r, c2, r2, job, path
pieces_ms = []
def piece_times(job):
    out = []
    for l in log:
        mm = re.search(r"tally-ingest upload piece (\S+) .*? (\d+) bytes .*? ([\d.]+) ms", l)
        if mm and mm.group(1) == job: out.append((int(mm.group(2)), float(mm.group(3))))
    return out
def same_as_browser(tag, path_on_disk, job, rng=("20260401", "20270331"), allow_again=False):
    want = browser_days(path_on_disk, rng)
    got = server_days(job)
    last = {d: v[-1] for d, v in got.items()}
    ok(SPLIT_BODY is not None and len(want) == len(day_list(*rng)) and set(last) == set(want), "%s: every day of the period queued, the empty ones too (%d days; browser %d)" % (tag, len(last), len(want)))
    diff = [d for d in want if last.get(d) != want[d]]
    ok(not diff, "%s: each day file equals the browser split's, byte for byte (%d days, %d differ: %s)" % (tag, len(want), len(diff), diff[:5]))
    twice = [d for d, v in got.items() if len(v) > 1]
    if not allow_again: ok(not twice, "%s: each day queued once (%s)" % (tag, twice[:5]))
    return got
try:
    db = pg_stand.start(30484)      # below the ephemeral range (32768-60999): the thousands of requests here leave client ports in TIME_WAIT
    ok(SPLIT_BODY is not None, "the browser's split() read from src/js/49-tally-cloud.js")
    ok(start_fn(4 * 1024 * 1024) is not None, "the cloud function runs (Deno), pieces of 4 MB")
    # ---------------------------------------------------------------- refusals
    c, r = call({"kind": "upload_new", "client": CID, "name": "x.xml", "size": 10, "from": "20260431", "to": "20270331"})
    c2, r2 = call({"kind": "upload_new", "client": CID, "name": "x.xml", "size": 10, "from": "20270401", "to": "20260401"})
    c3, r3 = call({"kind": "upload_new", "client": CID, "name": "x.xml", "size": 3 * 1024 ** 3, "from": "20260401", "to": "20270331"})
    c4, r4 = call({"kind": "upload_new", "client": CID, "name": "x.xml", "size": 0, "from": "20260401", "to": "20270331"})
    ok(c == 400 and c2 == 400 and c3 in (400, 413) and c4 == 400, "upload_new refuses a bad day, a period backwards, more than 2 GB, an empty file (%s %s %s %s)" % (c, c2, c3, c4))
    c, r = call({"kind": "upload_new", "client": CID, "name": "DayBook.xml", "size": 1234, "from": "20260401", "to": "20270331"})
    jb = jrow(r.get("job"))
    ok(c == 200 and r.get("path") == "%s/%s.xml" % (FIRM, r.get("job")) and jb.get("kind") == "upload" and jb.get("total") == 365 and jb.get("sealed") is False and jb.get("client_id") == CID and jb.get("book_id") == BOOK
       and (jb.get("upload") or {}).get("path") == r.get("path") and (jb.get("upload") or {}).get("from") == "20260401" and (jb.get("upload") or {}).get("size") == 1234,
       "upload_new: a job kind upload, total 365 (the period's days), the path '<firm>/<job>.xml', the period and size kept on the job (%s; %s)" % (r, {k: jb.get(k) for k in ("kind", "total", "upload")}))
    c, r2 = call({"kind": "upload_done", "client": CID, "job": r.get("job"), "path": r.get("path")})
    ok(c == 404 and not jrow(r.get("job")).get("sealed"), "upload_done before the file is in Storage: refused, the job not sealed (%s %s)" % (c, r2))
    c, r2 = call({"kind": "upload_done", "client": CID, "job": r.get("job"), "path": FIRM + "/other.xml"})
    ok(c in (400, 404, 409), "upload_done with another path: refused (%s)" % c)
    c, r2 = call({"kind": "upload_done", "client": "c-9", "job": r.get("job"), "path": r.get("path")}, tok="tok-other")
    ok(c == 404 and not jrow(r.get("job")).get("sealed"), "another firm's upload_done (its own client, my job): no such upload (%s)" % c)
    # ---------------------------------------------------------------- (A) 30 MB UTF-16LE with the BOM, 4 MB ranges
    print("== A. a 30 MB UTF-16LE Day Book (BOM), ranges of 4 MB")
    text = make_book(30 * 1024 * 1024)
    data = encode(text, "utf-16le", True)
    pA = os.path.join(TMP, "a.xml"); open(pA, "wb").write(data)
    nA = len(re.findall(r"<VOUCHER\b", text))
    ok(29 * 1024 * 1024 <= len(data) <= 40 * 1024 * 1024, "the file: %.1f MB, %d entries, UTF-16LE with the BOM" % (len(data) / 1048576, nA))
    n_r = len(FS.RANGES); t0 = time.time()
    c, r, c2, r2, job, path = upload("DayBook-2026-27.xml", data)
    ok(c == 200 and c2 == 200 and r2.get("ok") is True and jrow(job).get("sealed") is True, "upload_new then upload_done: sealed, the first piece queued (%s)" % r2)
    c3, r3 = call({"kind": "upload_done", "client": CID, "job": job, "path": path})
    ok(c3 == 200 and r3.get("already") is True, "a second upload_done: nothing more (%s)" % r3)
    ok(work_until_done(job), "the server read it all: %s, %s of %s days (%.1f s)" % (jrow(job).get("status"), jrow(job).get("done"), jrow(job).get("total"), time.time() - t0))
    ok(jrow(job).get("status") == "done" and jrow(job).get("done") == 365 and jrow(job).get("total") == 365, "the job: done, 365 of 365 days read")
    rg = [x for x in FS.RANGES[n_r:] if x[0] == "tally-uploads/" + path]
    ok(len(rg) >= 8 and all(b - a + 1 <= 4 * 1024 * 1024 for _, a, b in rg if a > 0) and rg[-1][2] >= len(data) - 1, "read by Range: %d ranges of at most 4 MB, to the end (%s)" % (len(rg), [(a, b) for _, a, b in rg[:3]]))
    same_as_browser("A (UTF-16LE, BOM, 4 MB)", pA, job)
    pt = piece_times(job)
    ok(len(pt) >= 8 and max(ms for _, ms in pt) < 2000, "each piece's own work (decode, cut, build and pack the day files) within 2 s: %d pieces, %.0f ms at most, %.0f ms on average, %.1f MB a piece"
       % (len(pt), max([ms for _, ms in pt] or [0]), sum(ms for _, ms in pt) / max(1, len(pt)), max([b for b, _ in pt] or [0]) / 1048576))
    pieces_ms.append(("A 30 MB UTF-16LE, 4 MB pieces", pt))
    ok(set(d for b, d, n in FS.DAYS) >= set(day_list("20260401", "20270331")), "the days went through the existing day path (tally_ingest_day for every day)")
    # ---------------------------------------------------------------- (B) odd ranges, the other encodings, out of date order
    print("== B. ranges of 1,000,003 bytes: UTF-8, UTF-16LE without the BOM, UTF-8 with the BOM, out of date order")
    ok(start_fn(PIECE_B) is not None, "the cloud function again, pieces of 1,000,003 bytes")
    for tag, enc, bom, mb, shuffle in (("UTF-8, no BOM", "utf-8", False, 6, False), ("UTF-16LE, no BOM", "utf-16le", False, 4, False), ("UTF-8, BOM", "utf-8", True, 3, False)):
        text = align(make_book(mb * 1024 * 1024, seed=len(tag), tag="b%d" % len(tag)), enc, bom)
        data = encode(text, enc, bom); p = os.path.join(TMP, "b%d.xml" % len(tag)); open(p, "wb").write(data)
        n_r = len(FS.RANGES)
        c, r, c2, r2, job, path = upload("b.xml", data)
        ok(work_until_done(job) and jrow(job).get("status") == "done" and jrow(job).get("done") == 365, "B %s (%.1f MB): the job done, %s of %s days" % (tag, len(data) / 1048576, jrow(job).get("done"), jrow(job).get("total")))
        same_as_browser("B " + tag, p, job)
        rgs = [(a, b) for k_, a, b in FS.RANGES[n_r:] if k_ == "tally-uploads/" + path and b > 0]
        second = rgs[1][0] if len(rgs) > 1 else None
        want2 = (PIECE_B - next(k for k in range(4) if (data[PIECE_B - k] & 0xC0) != 0x80)) if enc == "utf-8" else PIECE_B - 3
        ok(rgs and rgs[0] == (0, PIECE_B - 1) and second == want2, "B %s: the first range [0, %d] ended inside %s; the next range starts at its start, byte %s (%s)"
           % (tag, PIECE_B - 1, "a UTF-8 character" if enc == "utf-8" else "a surrogate pair (and between a code unit's two bytes)", want2, rgs[:3]))
        pieces_ms.append(("B " + tag + ", 1,000,003-byte pieces", piece_times(job)))
    text = make_book(3 * 1024 * 1024, seed=5, shuffle=True, tag="s")
    dates = re.findall(r"<VOUCHER\b[\s\S]*?<DATE>(\d{8})</DATE>", text)
    ok(any(dates[i] < dates[i - 1] for i in range(1, len(dates))), "the out-of-order file has entries of earlier days further on")
    data = encode(text, "utf-16le", True); p = os.path.join(TMP, "s.xml"); open(p, "wb").write(data)
    c, r, c2, r2, job, path = upload("s.xml", data)
    ok(work_until_done(job) and jrow(job).get("status") == "done", "B out of date order: the job done (%s of %s)" % (jrow(job).get("done"), jrow(job).get("total")))
    got = same_as_browser("B out of date order", p, job, allow_again=True)
    again = sorted(d for d, v in got.items() if len(v) > 1)
    ok(again and jrow(job).get("total") == 365 + len(again) and jrow(job).get("done") == jrow(job).get("total"), "B out of date order: the days met again (%s) read again whole; the job counts them (%s of %s)" % (again, jrow(job).get("done"), jrow(job).get("total")))
    # ---------------------------------------------------------------- (D) round 21: docs/reviews/migration-47-48-review.md M2-M5, L2-L5
    print("== D. review 47/48: the upload worker's failure cases")
    firsts = lambda job: [x for x in FS.QUEUE if (x["message"] or {}).get("job") == job and isinstance((x["message"] or {}).get("upload"), dict) and not (x["message"]["upload"].get("from") or 0)]
    small = encode(make_book(2 * 1024 * 1024, seed=21, tag="d"), "utf-8", False)
    # M2: two upload_done at once (a double click, a retry after a timeout): the split queued once
    c, r = call({"kind": "upload_new", "client": CID, "name": "m2.xml", "size": len(small), "from": "20260401", "to": "20270331"})
    jm2 = r.get("job"); FS.FILES["tally-uploads/" + str(r.get("path"))] = small
    FS.HEAD_DELAY[0] = 0.6; outs = []
    th = [threading.Thread(target=lambda: outs.append(call({"kind": "upload_done", "client": CID, "job": jm2, "path": r.get("path")}))) for _ in range(2)]
    [t.start() for t in th]; [t.join() for t in th]; FS.HEAD_DELAY[0] = 0.0
    ok(sorted(o[0] for o in outs) == [200, 200] and len(firsts(jm2)) == 1 and sum(1 for o in outs if o[1].get("already")) == 1,
       "M2. two upload_done at once: one seals and queues the split, the other is answered 'already' (%d first pieces; %s)" % (len(firsts(jm2)), [o[1] for o in outs]))
    ok(work_until_done(jm2, 120) and jrow(jm2).get("status") == "done" and jrow(jm2).get("done") == jrow(jm2).get("total") == 365, "M2. the job done once: %s of %s days" % (jrow(jm2).get("done"), jrow(jm2).get("total")))
    # M3 (A): a piece killed after queuing its work, before its message was archived: run again, it queues nothing twice
    FS.FAIL_DONE["upload"] = 2
    c, r, c2, r2, jm3, path = upload("m3.xml", small)
    ok(work_until_done(jm3, 120) and jrow(jm3).get("status") == "done" and jrow(jm3).get("done") == jrow(jm3).get("total") == 365 and FS.FAIL_DONE["upload"] == 0,
       "M3. two pieces whose archive failed (seen again after their time): the job done, %s of %s days" % (jrow(jm3).get("done"), jrow(jm3).get("total")))
    pM3 = os.path.join(TMP, "m3.xml"); open(pM3, "wb").write(small)
    same_as_browser("M3 (pieces run twice)", pM3, jm3)
    # M3 (B): the last piece of a file out of date order fails after its total was raised: the late days counted once
    sh = encode(make_book(2 * 1024 * 1024, seed=23, shuffle=True, tag="e"), "utf-16le", True)
    FS.FAIL_DAY["20270331"] = 1
    c, r, c2, r2, jm3b, path = upload("m3b.xml", sh)
    pM3b = os.path.join(TMP, "m3b.xml"); open(pM3b, "wb").write(sh)
    got = server_days(jm3b) if work_until_done(jm3b, 90) else {}
    again = sorted(d for d, v in server_days(jm3b).items() if len(v) > 1)
    ok(jrow(jm3b).get("status") == "done" and again and jrow(jm3b).get("total") == 365 + len(again) and jrow(jm3b).get("done") == jrow(jm3b).get("total"),
       "M3. a late pass whose last piece failed once and ran again: the total raised once (%s of %s; %d days read again)" % (jrow(jm3b).get("done"), jrow(jm3b).get("total"), len(again)))
    # M4: a Storage path that ignores Range never puts the whole file into memory
    big = encode(make_book(60 * 1024 * 1024, seed=24, tag="f"), "utf-8", False)
    FS.IGNORE_RANGE[0] = True; n_s = len(FS.SENT)
    c, r, c2, r2, jm4, path = upload("m4.xml", big)
    head = [n for k_, n in FS.SENT[n_s:] if k_ == "tally-uploads/" + str(path)][:1]
    ok(c2 == 200 and head and head[0] < len(big) // 2, "M4. upload_done against a Storage that ignores Range: answered from the first bytes, the rest not read (%s of %d bytes sent) (%s)" % (head, len(big), c2))
    work_until_done(jm4, 60); FS.IGNORE_RANGE[0] = False
    ok(jrow(jm4).get("status") == "failed" and "byte range" in (jrow(jm4).get("message") or "") and all(n < len(big) // 2 for k_, n in FS.SENT[n_s:]),
       "M4. its pieces: never the whole object, the job stopped at once with words (%s; %s)" % (jrow(jm4).get("message"), [n for _, n in FS.SENT[n_s:]][:6]))
    # M5: one entry longer than the carried tail's cap: the job stops with words, no memory growth
    ok(start_fn(PIECE_B, TALLY_UPLOAD_MAX_TAIL="200000") is not None, "the cloud function again, the carried tail capped at 200,000 characters")
    tb = make_book(2 * 1024 * 1024, seed=25, tag="g"); k_ = tb.index("<NARRATION>", len(tb) // 2) + len("<NARRATION>")
    huge = encode(tb[:k_] + "x" * 1500000 + tb[k_:], "utf-8", False)
    c, r, c2, r2, jm5, path = upload("m5.xml", huge)
    t0 = time.time()
    stopped = until(lambda: (call({"kind": "work"}, tok=None, headers={"x-fincom-work": FS.WORK_KEY}) and False) or "larger than" in (jrow(jm5).get("message") or ""), 30, 0.3)
    ok(stopped and "larger than" in (jrow(jm5).get("message") or "") and time.time() - t0 < 30,
       "M5. an entry of 1.5 M characters over the 200,000 cap: the job stopped at once with words (%s, %.0f s)" % (jrow(jm5).get("message"), time.time() - t0))
    work_until_done(jm5, 20)            # the day files queued before it are read (migration 13's tally_job_step then shows 'running' again: noted in the review)
    ok(start_fn(PIECE_B) is not None, "the cloud function again, pieces of 1,000,003 bytes")
    # L2: a piece naming another file than its job's is not read
    c, r = call({"kind": "upload_new", "client": CID, "name": "l2.xml", "size": len(small), "from": "20260401", "to": "20270331"})
    jl2 = r.get("job"); FS.FILES["tally-uploads/%s/other.xml" % FIRM] = small; n_r = len(FS.RANGES)
    rpc("tally_work_send", {"p_msg": {"job": jl2, "firm": FIRM, "book": BOOK, "upload": {"path": FIRM + "/other.xml", "size": len(small), "from": 0, "range": {"from": "20260401", "to": "20270331"}}}})
    work_until_done(jl2, 30)
    ok(jrow(jl2).get("status") == "failed" and not [x for x in FS.RANGES[n_r:] if x[0].endswith("/other.xml")], "L2. a piece whose path is not '<firm>/<job>.xml': not read, the job stopped with words (%s)" % jrow(jl2).get("message"))
    # L3: the job's book, not the client's company linked now
    c, r = call({"kind": "upload_new", "client": CID, "name": "l3.xml", "size": len(small), "from": "20260401", "to": "20270331"})
    jl3 = r.get("job"); FS.FILES["tally-uploads/" + str(r.get("path"))] = small
    co_ = next(x for x in FS.T["tally_companies"] if x["client_id"] == CID); co_["book_id"] = "b-relinked"
    c2, r2 = call({"kind": "upload_done", "client": CID, "job": jl3, "path": r.get("path")})
    co_["book_id"] = BOOK
    ok(c2 == 200 and [x["message"].get("book") for x in firsts(jl3)] == [BOOK], "L3. the company re-linked between upload_new and upload_done: the split reads into the job's book (%s)" % [x["message"].get("book") for x in firsts(jl3)])
    work_until_done(jl3, 120)
    # L4: only the real 'no kind upload' errors are 'unknown kind'
    FS.FAIL_INSERT["tally_jobs"] = {"message": 'null value in column "created_by" of relation "tally_jobs" violates not-null constraint', "code": "23502"}
    c4, r4 = call({"kind": "upload_new", "client": CID, "name": "l4.xml", "size": 10, "from": "20260401", "to": "20270331"})
    FS.FAIL_INSERT["tally_jobs"] = {"message": 'new row for relation "tally_jobs" violates check constraint "tally_jobs_kind_check"', "code": "23514"}
    c5, r5 = call({"kind": "upload_new", "client": CID, "name": "l4.xml", "size": 10, "from": "20260401", "to": "20270331"})
    FS.FAIL_INSERT.clear()
    ok(c4 == 500 and "unknown kind" not in str(r4.get("error")) and "created_by" not in str(r4.get("error")) and c5 == 400 and "unknown kind" in str(r5.get("error")),
       "L4. a not-null error is a 500 with plain words, not 'unknown kind'; the kind check's own error is (%s %s / %s %s)" % (c4, r4.get("error"), c5, r5.get("error")))
    # L5: Storage's own error text stays in the log
    c, r = call({"kind": "upload_new", "client": CID, "name": "l5.xml", "size": len(small), "from": "20260401", "to": "20270331"})
    FS.FILES["tally-uploads/" + str(r.get("path"))] = small
    FS.STORAGE_FAIL.update({"status": 500, "body": "secret-detail-xyz from the backend", "n": 1})
    c2, r2 = call({"kind": "upload_done", "client": CID, "job": r.get("job"), "path": r.get("path")})
    FS.STORAGE_FAIL.clear()
    ok(c2 == 500 and "secret-detail" not in json.dumps(r2) and r2.get("error"), "L5. Storage answering 500 with its own text: the person reads plain words (%s)" % r2.get("error"))

    # ---------------------------------------------------------------- (C) the same file twice through the real day path
    print("== C. the same file twice, through tally_ingest_day on a throwaway PostgreSQL")
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql("insert into firms values (%s, 'Firm'); insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, 'ZZ UP', '2026-04-01', '2026-03-31');" % (q(FIRM), q(BOOK), q(FIRM), q(CID)))
    for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql", "../../tests/fixtures/migration-34-as-run-on-staging.sql", "migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql",
              "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql",
              "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql"):
        rr = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                            input=open(os.path.normpath(os.path.join(SQLDIR, f))).read(), capture_output=True, text=True)
        if rr.returncode: ok(False, "%s runs: %s" % (f, rr.stderr[-300:])); raise SystemExit("cannot go on")
    ROUTE["day"] = True
    text = make_book(2 * 1024 * 1024, seed=11, tag="c")
    data = encode(text, "utf-8", False)
    snap = lambda: {"vouchers": db.one("select count(*) from tally_vouchers where book_id = %s" % q(BOOK)), "live": db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(BOOK)),
                    "lines": db.one("select count(*) from tally_lines where book_id = %s" % q(BOOK)), "versions": db.one("select count(*) from tally_voucher_versions where book_id = %s" % q(BOOK)),
                    "cache": db.one("select md5(coalesce(string_agg(concat_ws(',', ledger, day, amount, dr, cr, n), '|' order by ledger, day), '')) from tally_ledger_day where book_id = %s" % q(BOOK)),
                    "days": db.one("select count(*) from tally_days where book_id = %s" % q(BOOK))}
    nC = len(re.findall(r"<VOUCHER\b", text)) - 2
    c, r, c2, r2, job1, path = upload("c.xml", data)
    ok(work_until_done(job1) and jrow(job1).get("status") == "done", "C first upload: done (%s of %s)" % (jrow(job1).get("done"), jrow(job1).get("total")))
    s1 = snap()
    ok(int(s1["vouchers"]) == nC and int(s1["live"]) == nC and int(s1["lines"]) > nC, "C first upload: %s entries in the copy (the file's %d inside the period), %s lines, %s versions, %s days" % (s1["vouchers"], nC, s1["lines"], s1["versions"], s1["days"]))
    c, r, c2, r2, job2, path2 = upload("c.xml", data)
    ok(job2 != job1 and work_until_done(job2) and jrow(job2).get("status") == "done", "C the same file again (a new job): done")
    s2 = snap()
    ok(s2 == s1, "C the same file twice doubles nothing: entries, lines, versions, days and the ledger-day cache identical (%s)" % s2)
    print("\n  piece times (the split's own work per piece, ms):")
    for tag, pt in pieces_ms:
        if pt: print("    %-45s %3d pieces  max %6.0f ms  mean %6.0f ms  largest piece %.2f MB" % (tag, len(pt), max(ms for _, ms in pt), sum(ms for _, ms in pt) / len(pt), max(b for b, _ in pt) / 1048576))
finally:
    if fn: fn.terminate()
    if db: db.stop()
    shutil.rmtree(TMP, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
