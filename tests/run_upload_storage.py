"""python3 run_upload_storage.py - round 20 (d.2): Books -> From Tally hands a Day Book file to FinCom's cloud through
Storage. tally-ingest upload_new {client, name, size} -> {job, path}; then a resumable (TUS 1.0.0) upload written in the
app: POST {storage}/storage/v1/upload/resumable (Upload-Length, Upload-Metadata bucketName tally-uploads, objectName the
path, contentType; Tus-Resumable 1.0.0; authorization Bearer the user's token; x-upsert false), PATCH 6 MB chunks with
Upload-Offset, on an error HEAD and go on from the server's offset; the upload's URL is kept in this browser's store so a
reload goes on from there; a progress bar; then upload_done {job, path}, once. The job's line: "Day Book 2026-27: 143 of
365 days read". A cloud without upload_new (400 'unknown kind', or 404): the old hand-over (job_new, stage_days).
A fake TUS server and tally-ingest on port 9342.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_upload_storage.py"""
import json, os, threading, functools, http.server, base64, hashlib, socket, time, re, gzip
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8342), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CHUNK = 6 * 1024 * 1024
# ---------------------------------------------------------------- the fake cloud: tally-ingest and Storage's TUS
ST = {}
LOCK = threading.Lock()
def reset(mode=""):
    with LOCK:
        ST.clear(); ST.update({"mode": mode, "ingest": [], "creates": [], "patches": [], "heads": [], "uploads": {}, "delay": 0.0, "cut_done": False, "n": 0, "staged": {}, "jobs": 0, "refused": []})
# 17-Oct-2026: like the project's global limit (50 MB), Storage refuses a larger file at once with 413
LIMIT = 50 * 1000 * 1000
FILES = {}            # files the page fetches (made here, so the test knows every byte)
reset()
class Fake(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"         # one request a connection: a cut connection is never reused
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, HEAD, OPTIONS, DELETE")
        self.send_header("Access-Control-Allow-Headers", self.headers.get("Access-Control-Request-Headers") or "*")
        self.send_header("Access-Control-Expose-Headers", "Location, Upload-Offset, Upload-Length, Tus-Resumable")
    def out(self, code, body=None, headers=None):
        self.send_response(code); self.cors()
        for k, v in (headers or {}).items(): self.send_header(k, v)
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        if body is not None: self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers()
        if data and self.command != "HEAD": self.wfile.write(data)
    def do_OPTIONS(self): self.out(204)
    def do_GET(self):
        if self.path.startswith("/__file/"):
            return self.out(200, FILES[self.path[len("/__file/"):]], {"Content-Type": "application/octet-stream"})
        if self.path.startswith("/__upload/"):
            with LOCK: u = ST["uploads"].get(self.path[len("/__upload/"):])
            return self.out(200, bytes(u["data"]) if u else b"", {"Content-Type": "application/octet-stream"})
        if self.path == "/__state":
            with LOCK:
                s = {k: v for k, v in ST.items() if k != "uploads"}
                s["uploads"] = {k: {"length": u["length"], "offset": len(u["data"]), "sha": hashlib.sha256(bytes(u["data"])).hexdigest(), "meta": u["meta"], "headers": u["headers"]} for k, u in ST["uploads"].items()}
            return self.out(200, s)
        self.out(404, {"error": "not found"})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if self.path.startswith("/functions/v1/tally-ingest"):
            body = json.loads(self.rfile.read(n) or b"{}")
            with LOCK:
                ST["ingest"].append({"body": {k: v for k, v in body.items() if k != "days"}, "days": len(body.get("days") or []), "auth": self.headers.get("Authorization")})
                mode = ST["mode"]
            k = body.get("kind")
            if k == "upload_new":
                if mode == "unknown400": return self.out(400, {"ok": False, "error": "unknown kind"})
                if mode == "unknown404": return self.out(404, {"ok": False, "error": "Not Found"})
                with LOCK: ST["jobs"] += 1; jn = "job-%d" % ST["jobs"]
                return self.out(200, {"ok": True, "job": jn, "path": "f-1/%s/%s.xml" % (body.get("client"), jn)})
            if k == "upload_fail": return self.out(200, {"ok": True, "job": body.get("job"), "failed": True})
            if k == "upload_done": return self.out(200, {"ok": True, "queued": True})
            if k == "job_new": return self.out(200, {"ok": True, "job": "old-job-1"})
            if k == "stage_days":
                # each day as staged: its vouchers, read back from the gzip the page sent
                for d in body.get("days") or []:
                    xml = gzip.decompress(base64.b64decode(d.get("gz") or "")).decode("utf-8")
                    with LOCK: ST["staged"][d.get("day")] = re.findall(r"<VOUCHER\b[\s\S]*?</VOUCHER>", xml)
                return self.out(200, {"ok": True, "queued": len(body.get("days") or [])})
            return self.out(400, {"ok": False, "error": "unknown kind"})
        if self.path == "/storage/v1/upload/resumable":
            self.rfile.read(n)
            meta = {}
            for part in (self.headers.get("Upload-Metadata") or "").split(","):
                kv = part.strip().split(" ")
                if kv and kv[0]: meta[kv[0]] = base64.b64decode(kv[1]).decode() if len(kv) > 1 else ""
            hd = {h: self.headers.get(h) for h in ("Tus-Resumable", "Upload-Length", "authorization", "x-upsert", "apikey")}
            if int(self.headers.get("Upload-Length") or 0) > LIMIT:
                with LOCK: ST["refused"].append({"length": int(self.headers.get("Upload-Length")), "meta": meta})
                return self.out(413, {"statusCode": "413", "error": "Payload too large", "message": "The object exceeded the maximum allowed size"})
            with LOCK:
                ST["n"] += 1; uid = "u%d" % ST["n"]
                ST["uploads"][uid] = {"length": int(self.headers.get("Upload-Length") or -1), "data": bytearray(), "meta": meta, "headers": hd}
                ST["creates"].append({"id": uid, "meta": meta, "headers": hd})
            return self.out(201, None, {"Location": "http://localhost:9342/storage/v1/upload/resumable/" + uid, "Tus-Resumable": "1.0.0"})
        self.out(404, {"error": "not found"})
    def do_HEAD(self):
        m = re.match(r"^/storage/v1/upload/resumable/(\w+)$", self.path)
        with LOCK:
            u = m and ST["uploads"].get(m.group(1))
            ST["heads"].append(m.group(1) if m else self.path)
        if not u: return self.out(404)
        self.out(200, None, {"Upload-Offset": str(len(u["data"])), "Upload-Length": str(u["length"]), "Tus-Resumable": "1.0.0", "Cache-Control": "no-store"})
    def do_PATCH(self):
        m = re.match(r"^/storage/v1/upload/resumable/(\w+)$", self.path)
        n = int(self.headers.get("Content-Length") or 0)
        off = int(self.headers.get("Upload-Offset") or -1)
        with LOCK:
            u = m and ST["uploads"].get(m.group(1)); mode = ST["mode"]; delay = ST["delay"]
            npatch = len(ST["patches"])
        if not u: self.rfile.read(n); return self.out(404)
        if off != len(u["data"]):
            self.rfile.read(n)
            with LOCK: ST["patches"].append({"offset": off, "len": n, "got": 0, "what": "409"})
            return self.out(409, {"error": "offset"})
        if delay: time.sleep(delay)
        # the connection cut in the middle of the second chunk: half of it arrives
        if mode == "cut" and not ST["cut_done"] and npatch == 1:
            half = self.rfile.read(n // 2)
            with LOCK: u["data"].extend(half); ST["cut_done"] = True; ST["patches"].append({"offset": off, "len": n, "got": len(half), "what": "cut"})
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except Exception: pass
            self.close_connection = True
            return
        if mode == "fail" and npatch >= 1:
            self.rfile.read(n)
            with LOCK: ST["patches"].append({"offset": off, "len": n, "got": 0, "what": "503"})
            return self.out(503, {"error": "storage unavailable"})
        data = self.rfile.read(n)
        with LOCK: u["data"].extend(data); ST["patches"].append({"offset": off, "len": n, "got": len(data), "what": "204"})
        self.out(204, None, {"Upload-Offset": str(len(u["data"])), "Tus-Resumable": "1.0.0"})
fake = http.server.ThreadingHTTPServer(("localhost", 9342), Fake); threading.Thread(target=fake.serve_forever, daemon=True).start()
def state():
    import urllib.request
    s = json.loads(urllib.request.urlopen("http://localhost:9342/__state").read())
    s["ingest"] = [x for x in s["ingest"] if x["body"].get("kind") != "wake"]      # the page's own wake-ups (opening a client) are not the upload's
    return s


# ---------------------------------------------------------------- 17-Oct-2026: Day Books larger than Storage takes
import datetime
def book(days, per_day, narr, enc="utf-16le", tag="v", big=None):
    """a Tally Day Book export: the envelope (company in SVCURRENTCOMPANY), per_day entries a day (big: {day: extra
    characters in each of that day's narrations}), the closing tags; UTF-16LE with the BOM, or UTF-8"""
    head = ('<ENVELOPE>\r\n<HEADER>\r\n<TALLYREQUEST>Export Data</TALLYREQUEST>\r\n</HEADER>\r\n<BODY>\r\n<IMPORTDATA>\r\n<REQUESTDESC>\r\n<REPORTNAME>Vouchers</REPORTNAME>\r\n'
            '<STATICVARIABLES>\r\n<SVCURRENTCOMPANY>ZZ UP</SVCURRENTCOMPANY>\r\n</STATICVARIABLES>\r\n</REQUESTDESC>\r\n<REQUESTDATA>\r\n')
    foot = "</REQUESTDATA>\r\n</IMPORTDATA>\r\n</BODY>\r\n</ENVELOPE>\r\n"
    out, n = [head], 0
    for d in days:
        for k in range(per_day):
            extra = "y" * (big or {}).get(d, 0)
            out.append('<TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n<VOUCHER REMOTEID="%s-%06d" VCHTYPE="Sales" ACTION="Create">\r\n<DATE>%s</DATE>\r\n<GUID>%s-%06d</GUID>\r\n<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>\r\n'
                       '<NARRATION>%s %d ₹ 1,180 बिक्री 😀%s</NARRATION>\r\n<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>1180.00</AMOUNT></ALLLEDGERENTRIES.LIST>\r\n</VOUCHER>\r\n</TALLYMESSAGE>\r\n'
                       % (tag, n, d, tag, n, narr, n, extra)); n += 1
    out.append(foot)
    t = "".join(out)
    return (b"\xff\xfe" + t.encode("utf-16-le")) if enc == "utf-16le" else t.encode("utf-8")
def dlist(a, b):
    d, e, out = datetime.date(int(a[:4]), int(a[4:6]), int(a[6:])), datetime.date(int(b[:4]), int(b[4:6]), int(b[6:])), []
    while d <= e: out.append(d.strftime("%Y%m%d")); d += datetime.timedelta(days=1)
    return out
VRE = re.compile(r"<VOUCHER\b[\s\S]*?</VOUCHER>")
def vouchers(raw):
    t = raw.decode("utf-16") if raw[:2] == b"\xff\xfe" else raw.decode("utf-8")
    return [(re.search(r"<DATE>(\d{8})</DATE>", v).group(1), v) for v in VRE.findall(t)]
YEAR = dlist("20260401", "20270331")
FILES["big16"] = book(YEAR, 120, "Sale to Ramesh & Sons " + "x" * 1080, tag="b")
FILES["f413"] = book(YEAR[:120], 300, "Sale " + "z" * 1300, enc="utf-8", tag="c")
FILES["hugeday"] = book(dlist("20260401", "20260420"), 30, "Sale", tag="h", big={"20260415": 30000})

SETUP = """async () => {
  let c = Object.values(S.companies).find(x => x.name === "ZZ Upload Client");
  if (!c){ c = newCompany({name: "ZZ Upload Client", gstin: ""}); c.tallyName = "ZZ UP"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  Cloud.cfg = () => ({url: "http://localhost:9342", key: "anon-key"});
  Cloud.sess = () => ({access_token: "user-token"});
  Cloud.fresh = async () => {};
  TCloud.on = () => true;
  window.__jobs = [];
  Cloud.api = async (p) => { if (/^tally_jobs/.test(p)) return JSON.parse(JSON.stringify(window.__jobs)); return []; };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async () => null;
  TCloudUp.tusWait = [40, 40, 40];
  // the same Day Book every time: ~13.5 MB, three chunks of 6 MB
  const unit = "<VOUCHER><DATE>20260415</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><NARRATION>x</NARRATION></VOUCHER>\\n";
  const text = "<ENVELOPE><BODY><DATA>" + unit.repeat(Math.ceil(13.5 * 1048576 / unit.length)) + "</DATA></BODY></ENVELOPE>";
  window.__file = new File([text], "DayBook.xml", {type: "text/xml"});
  const h = await crypto.subtle.digest("SHA-256", await window.__file.arrayBuffer());
  window.__sha = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  window.__who = {client: c.id, company: "ZZ UP"}; window.__range = {from: "20260401", to: "20270331"};
  window.__steps = [];
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return {cid: c.id, size: window.__file.size, sha: window.__sha};
}"""
START = """() => { window.__res = null; window.__err = null;
  window.__p = TCloudUp.handOver(window.__file, window.__range, m => window.__steps.push(m), window.__who, "DayBook.xml").then(r => { window.__res = r; }, e => { window.__err = String((e && e.message) || e); }); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({})))
    pg.goto("http://localhost:8342/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    info = E(SETUP); cid, size, sha = info["cid"], info["size"], info["sha"]
    ok(size > 2 * CHUNK and size < 3 * CHUNK, "a Day Book of %.1f MB: three chunks" % (size / 1048576))
    # ---- 1. through Storage, the connection cut in the middle of the second chunk
    reset("cut"); ST["delay"] = 0.5
    E("""async (cid) => { await openCompany(cid); S.books = {loading: false, cid, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; goClient("books:import"); }""", cid)
    pg.wait_for_timeout(600)
    E(START); pg.wait_for_timeout(1300)
    bar = pg.locator("#app [data-upload-bar]")
    ok(bar.count() == 1, "a progress bar on the client's books while it goes (%s)" % txt("#app [data-upload-progress]"))
    for _ in range(100):
        if E("window.__res || window.__err"): break
        pg.wait_for_timeout(200)
    s = state()
    ok(E("window.__err") is None and E("window.__res") is not None, "the upload finished (%s / %s)" % (E("window.__err"), E("window.__res")))
    kinds = [x["body"]["kind"] for x in s["ingest"]]
    ok(kinds == ["upload_new", "upload_done"], "tally-ingest: upload_new, then upload_done once; no job_new, no stage_days (%s)" % kinds)
    un = s["ingest"][0]["body"] if s["ingest"] else {}
    ok(un.get("client") == cid and un.get("name") == "DayBook.xml" and un.get("size") == size and s["ingest"][0]["auth"] == "Bearer user-token",
       "upload_new {client, name, size} with the user's token (%s)" % un)
    ok(len(s["creates"]) == 1, "one resumable upload made (%d)" % len(s["creates"]))
    cr = s["creates"][0] if s["creates"] else {"meta": {}, "headers": {}}
    ok(cr["meta"].get("bucketName") == "tally-uploads" and cr["meta"].get("objectName") == "f-1/%s/job-1.xml" % cid and cr["meta"].get("contentType"),
       "Upload-Metadata: bucketName tally-uploads, objectName the path, contentType (%s)" % cr["meta"])
    hd = cr["headers"]
    ok(hd.get("Tus-Resumable") == "1.0.0" and hd.get("Upload-Length") == str(size) and hd.get("authorization") == "Bearer user-token" and hd.get("x-upsert") == "false",
       "Tus-Resumable 1.0.0, Upload-Length, authorization Bearer, x-upsert false (%s)" % hd)
    pt = s["patches"]
    ok(pt and pt[0]["offset"] == 0 and pt[0]["len"] == CHUNK and pt[0]["what"] == "204", "the first PATCH: 6 MB from 0 (%s)" % pt[:1])
    ok(len(pt) > 1 and pt[1]["what"] == "cut" and pt[1]["offset"] == CHUNK, "the second PATCH cut in the middle (%s)" % pt[1:2])
    ok(len(s["heads"]) >= 1, "after the cut: HEAD for the server's offset (%d)" % len(s["heads"]))
    resumed = [x for x in pt[2:] if x["what"] == "204"]
    ok(resumed and resumed[0]["offset"] == CHUNK + CHUNK // 2 and all(x["len"] <= CHUNK for x in pt), "it goes on from the server's offset, never re-sending what arrived (%s)" % [(x["offset"], x["len"], x["what"]) for x in pt])
    up = list(s["uploads"].values())[0] if s["uploads"] else {}
    ok(up.get("offset") == size and up.get("sha") == sha, "the file in Storage is the whole Day Book, byte for byte")
    done = s["ingest"][-1]["body"] if s["ingest"] else {}
    ok(done.get("kind") == "upload_done" and done.get("job") == "job-1" and done.get("path") == "f-1/%s/job-1.xml" % cid, "upload_done {job, path} (%s)" % done)
    ok(E("(async () => (await IDBStore.prefix('tus:')).length)()") == 0, "the upload's record is gone from this browser's store once done")
    res = E("window.__res") or {}
    ok(res.get("job") == "job-1" and res.get("days") == 365, "the answer: the job, and the days of the period (%s)" % res)
    # the job's line, from tally_jobs
    line = E("() => TCloud.jobLine({id: 'job-1', client_id: 'x', kind: 'upload', status: 'running', total: 365, done: 143, sealed: true, message: 'DayBook.xml', updated_at: new Date().toISOString()})")
    ok(line == "Day Book 2026-27: 143 of 365 days read", "the job's line: 'Day Book 2026-27: 143 of 365 days read' (%s)" % line)
    E("() => { window.__jobs = [{id: 'job-1', client_id: '%s', kind: 'upload', status: 'running', total: 365, done: 143, sealed: true, bad: [], message: 'DayBook.xml', created_at: new Date().toISOString(), updated_at: new Date().toISOString()}]; return TCloud.jobsLoad('%s'); }" % (cid, cid))
    pg.wait_for_timeout(600)
    ok("Day Book 2026-27: 143 of 365 days read" in txt("#app [data-jobs]"), "on the client's books: the line from the job row (%s)" % txt("#app [data-jobs]"))
    E("() => { window.__jobs = []; TCloud.jobs = {}; }")
    # ---- 2. a reload goes on from where it stopped
    reset("fail")
    E("async (cid) => { await TCloudUp.hold(cid, window.__file, window.__range, window.__who); }", cid)
    E(START)
    for _ in range(100):
        if E("window.__res || window.__err"): break
        pg.wait_for_timeout(200)
    ok(E("window.__err") is not None, "Storage failing after the first chunk: the upload stops with words (%s)" % E("window.__err"))
    ok(E("(async () => (await IDBStore.prefix('tus:')).length)()") == 1, "the upload's URL is kept in this browser's store")
    s = state()
    ok([x["body"]["kind"] for x in s["ingest"]] == ["upload_new", "upload_fail"] and s["ingest"][1]["body"].get("job") == "job-1" and "stopped at" in str(s["ingest"][1]["body"].get("reason")),
       "no upload_done yet; the job marked failed with the reason, not left queued (upload_fail: %s)" % [x["body"] for x in s["ingest"]][1:])
    with LOCK: ST["mode"] = ""; ST["heads"] = []
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E(SETUP)
    sent = E("async (cid) => { window.__steps = []; return await TCloudUp.retry(cid, m => window.__steps.push(m)); }", cid)
    s = state()
    ok(sent is True, "after the reload, the waiting Day Book goes on its own (retry: %s)" % sent)
    ok(len(s["creates"]) == 1 and [x["body"]["kind"] for x in s["ingest"]] == ["upload_new", "upload_fail", "upload_done"],
       "no second upload_new, no second resumable upload; upload_done once (%s, %d made)" % ([x["body"]["kind"] for x in s["ingest"]], len(s["creates"])))
    ok(len(s["heads"]) >= 1, "the reload asked the server's offset first (HEAD)")
    ok204 = [x for x in s["patches"] if x["what"] == "204"]
    ok(ok204 and ok204[0]["offset"] == 0 and len(ok204) > 1 and ok204[1]["offset"] == CHUNK, "it went on from 6 MB, not from the start (%s)" % [(x["offset"], x["what"]) for x in s["patches"]])
    up = list(s["uploads"].values())[0] if s["uploads"] else {}
    ok(up.get("offset") == size and up.get("sha") == sha, "the file in Storage is whole")
    ok(E("(async () => (await IDBStore.prefix('tus:')).length)()") == 0 and E("(async (cid) => (await TCloudUp.waiting(cid)).length)", cid) == 0, "nothing left waiting in this browser")
    # ---- 3. a cloud without upload_new: the old hand-over
    for mode in ("unknown400", "unknown404"):
        reset(mode)
        E(START)
        for _ in range(150):
            if E("window.__res || window.__err"): break
            pg.wait_for_timeout(200)
        s = state()
        kinds = [x["body"]["kind"] for x in s["ingest"]]
        ok(E("window.__err") is None and (E("window.__res") or {}).get("job") == "old-job-1", "%s: handed over the old way (%s / %s)" % (mode, E("window.__err"), E("window.__res")))
        ok(kinds[:2] == ["upload_new", "job_new"] and "stage_days" in kinds and "upload_done" not in kinds and not s["creates"] and not s["patches"],
           "%s: upload_new, then job_new and stage_days; nothing to Storage (%s)" % (mode, kinds[:4]))
        stage = [x for x in s["ingest"] if x["body"]["kind"] == "stage_days"]
        ok(sum(x["days"] for x in stage) == 365 and stage[-1]["body"].get("last") is True, "%s: every day of the period staged, the last part marked (%d)" % (mode, sum(x["days"] for x in stage)))
    # ---- 4. the old hand-over, a UTF-16LE Day Book (Tally's usual export, with its byte-order mark): the same days and
    # vouchers staged as the same content in UTF-8 (Blob.text() read it as UTF-8 only: no voucher found, every day empty)
    E("""() => {
      const v = (d, n, t) => "<VOUCHER><DATE>" + d + "</DATE><VOUCHERTYPENAME>" + t + "</VOUCHERTYPENAME><NARRATION>" + n + "</NARRATION></VOUCHER>\\r\\n";
      const text = "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><DATA>" +
        v("20260401", "Opening sale – ₹ 1,180 to Śrī Traders", "Sales") + v("20260401", "Rent April", "Payment") +
        v("20260415", "TDS 194C ₹ 2,000", "Journal") + v("20261231", "Year-end café bill", "Purchase") +
        v("20270331", "Close", "Journal") + v("20250331", "outside the period", "Sales") +
        "</DATA></BODY></ENVELOPE>";
      const u16 = new Uint8Array(2 + text.length * 2); u16[0] = 0xFF; u16[1] = 0xFE;
      for (let i = 0; i < text.length; i++){ const c = text.charCodeAt(i); u16[2 + 2 * i] = c & 255; u16[3 + 2 * i] = c >> 8; }
      window.__f8 = new File([text], "DayBook.xml", {type: "text/xml"});
      window.__f16 = new File([u16], "DayBook.xml", {type: "text/xml"});
    }""")
    got = {}
    for enc in ("f8", "f16"):
        reset("unknown400")
        E(START.replace("window.__file", "window.__" + enc))
        for _ in range(150):
            if E("window.__res || window.__err"): break
            pg.wait_for_timeout(200)
        s = state()
        got[enc] = {d: vs for d, vs in s["staged"].items() if vs}
        ok(E("window.__err") is None and (E("window.__res") or {}).get("job") == "old-job-1" and len(s["staged"]) == 365,
           "%s: handed over the old way, 365 days staged (%s / %s, %d)" % (enc, E("window.__err"), E("window.__res"), len(s["staged"])))
    ok(sorted(got["f8"]) == ["20260401", "20260415", "20261231", "20270331"] and sum(len(x) for x in got["f8"].values()) == 5,
       "UTF-8: the vouchers of 4 days staged, 5 vouchers (%s)" % {d: len(x) for d, x in got["f8"].items()})
    ok(got["f16"] == got["f8"], "UTF-16LE with its BOM: the same days and the same vouchers staged as in UTF-8 (UTF-16LE %s, UTF-8 %s)"
       % ({d: len(x) for d, x in got["f16"].items()}, {d: len(x) for d, x in got["f8"].items()}))
    # ---- 5. 17-Oct-2026: a 120 MB UTF-16LE Day Book (a year, every day): cut in this page into 3 Day Books of whole days,
    # each at most 45 MB, each its own upload_new / Storage / upload_done, one after another; "piece 2 of 3" said
    big = FILES["big16"]
    ok(115 * 1048576 < len(big) < 125 * 1048576, "5. a Day Book of %.1f MB, UTF-16LE with the BOM, %d days" % (len(big) / 1048576, len(YEAR)))
    reset("")
    E("""async () => { const r = await fetch("http://localhost:9342/__file/big16"); window.__big = new File([await r.blob()], "DayBook-2026-27.xml", {type: "text/xml"}); window.__steps = []; window.__bars = [];
      window.__barT = setInterval(() => { const p = TCloudUp.prog[window.__who.client]; if (p) window.__bars.push(p.name); }, 50); return window.__big.size; }""")
    t0 = time.time()
    E(START.replace("window.__file", "window.__big"))
    for _ in range(1500):
        if E("window.__res || window.__err"): break
        pg.wait_for_timeout(200)
    E("clearInterval(window.__barT)")
    s = state()
    res = E("window.__res") or {}
    ok(E("window.__err") is None and res.get("pieces") == 3 and res.get("days") == 365 and res.get("storage") is True and len(res.get("jobs") or []) == 3,
       "5. sent in 3 pieces (%s / %s, %.0f s)" % (E("window.__err"), {k: res.get(k) for k in ("pieces", "days", "jobs")}, time.time() - t0))
    kinds = [x["body"]["kind"] for x in s["ingest"]]
    ok(kinds == ["upload_new", "upload_done"] * 3, "5. one after another: upload_new, Storage, upload_done, three times (%s)" % kinds)
    news = [x["body"] for x in s["ingest"] if x["body"]["kind"] == "upload_new"]
    ok(all(x["size"] <= 45 * 1024 * 1024 for x in news) and not s["refused"], "5. each piece at most 45 MB; nothing refused by Storage (%s)" % [x["size"] for x in news])
    ok(news and news[0]["from"] == "20260401" and news[-1]["to"] == "20270331" and all(dlist(news[i]["to"], "20270331")[1] == news[i + 1]["from"] for i in range(len(news) - 1)),
       "5. each piece its own period; they follow one another and make the year (%s)" % [(x["from"], x["to"]) for x in news])
    ok([x["name"] for x in news] == ["DayBook.xml (piece %d of 3)" % i for i in (1, 2, 3)], "5. each job named by its piece (%s)" % [x["name"] for x in news])
    steps = E("window.__steps") or []
    ok(any("piece 2 of 3" in m for m in steps) and any("piece 3 of 3" in m and "%" in m for m in steps), "5. the progress says the piece: %s" % next((m for m in steps if "piece 2 of 3" in m), steps[-1:]))
    ok(any("(piece 2 of 3)" in n for n in (E("window.__bars") or [])), "5. the progress bar names the piece (%s)" % sorted(set(E("window.__bars") or []))[:3])
    s0 = big.index("<VOUCHER".encode("utf-16-le")); e9 = big.rindex("</VOUCHER>".encode("utf-16-le")) + 20
    import urllib.request
    stored = [urllib.request.urlopen("http://localhost:9342/__upload/" + c["id"]).read() for c in s["creates"]]
    ok(len(stored) == 3 and all(len(x) == n["size"] for x, n in zip(stored, news)), "5. three files in Storage, whole (%s)" % [len(x) for x in stored])
    ok(all(x[:s0] == big[:s0] and x[-(len(big) - e9):] == big[e9:] for x in stored), "5. each: the original envelope (BOM, header, SVCURRENTCOMPANY) and the original closing tags, UTF-16LE")
    allv, perday = [], {}
    for i, (x, n) in enumerate(zip(stored, news)):
        vs = vouchers(x); allv += vs
        ok(all(n["from"] <= d <= n["to"] for d, _ in vs), "5. piece %d holds only the days of its period %s-%s" % (i + 1, n["from"], n["to"]))
        for d, _ in vs: perday.setdefault(d, set()).add(i)
    ok(all(len(v) == 1 for v in perday.values()), "5. whole days: no day in two pieces")
    ok(sorted(allv) == sorted(vouchers(big)), "5. the pieces together hold every entry of the file, each once (%d)" % len(allv))
    ok(E("(async () => (await IDBStore.prefix('tcpieces:')).length + (await IDBStore.prefix('tus:')).length)()") == 0, "5. nothing about the pieces left in this browser's store")
    E("() => { window.__big = null; }")
    # ---- 6. a file Storage refuses (413, larger than 50 MB: here a page that does not cut it): the line on Books > From
    # Tally, the job marked failed; Send again (the file still in the page) goes, in pieces
    reset("")
    E("""async (cid) => { await openCompany(cid); S.books = {loading: false, cid, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; goClient("books:import");
      const r = await fetch("http://localhost:9342/__file/f413"); window.__f413 = new File([await r.blob()], "DayBook-Apr-Jul.xml", {type: "text/xml"});
      DayCut.PIECE = 200 * 1048576; window.__brought = await bringDayBookFile(window.__f413, "", "", {toast: false}); return window.__f413.size; }""", cid)
    line = None
    for _ in range(300):
        line = txt("#app [data-cloud-notsent]")
        if line: break
        pg.wait_for_timeout(200)
    s = state()
    print("     line: " + line)
    ok(len(FILES["f413"]) > LIMIT and s["refused"] and s["refused"][0]["length"] == len(FILES["f413"]), "6. Storage answered 413 for the %.1f MB file" % (len(FILES["f413"]) / 1048576))
    ok(line.startswith("DayBook-Apr-Jul.xml: Saved on this computer, but not sent to FinCom’s cloud: FinCom’s cloud refused the file as too large (")
       and "it takes at most 50 MB a file). Other logins will not see it until it is sent." in line and line.endswith("Send again"),
       "6. the line on Books › From Tally says it plainly, with Send again")
    ok(pg.locator("#app [data-cloud-notsent].bad").count() == 1, "6. shown as a problem (bad)")
    fails_ = [x["body"] for x in s["ingest"] if x["body"]["kind"] == "upload_fail"]
    ok([x["body"]["kind"] for x in s["ingest"]] == ["upload_new", "upload_fail"] and fails_[0].get("job") == "job-1" and "too large" in fails_[0].get("reason", ""),
       "6. the job is marked failed with the reason (upload_fail), never left queued (%s)" % fails_)
    ok(E("(async () => (await IDBStore.prefix('tus:')).length)()") == 0, "6. the refused upload is not kept to go on with (a new upload next time)")
    E("() => { DayCut.PIECE = 45 * 1048576; }")
    pg.click("#app [data-send-again]")
    for _ in range(600):
        if not pg.locator("#app [data-cloud-notsent]").count() and "upload_done" in [x["body"]["kind"] for x in state()["ingest"]] and not E("S.books.busy"): break
        pg.wait_for_timeout(200)
    s = state()
    kinds = [x["body"]["kind"] for x in s["ingest"]]
    ok(kinds == ["upload_new", "upload_fail", "upload_new", "upload_done", "upload_new", "upload_done"], "6. Send again: the file the page holds, in 2 pieces (%s)" % kinds)
    ok(not pg.locator("#app [data-cloud-notsent]").count(), "6. the line is gone once it is sent")
    news = [x["body"] for x in s["ingest"] if x["body"]["kind"] == "upload_new"][1:]
    ok(all(x["size"] <= 45 * 1024 * 1024 for x in news) and news[0]["from"] == "20260401" and news[-1]["to"] == "20260729", "6. pieces of at most 45 MB over the file's period (%s)" % [(x["from"], x["to"], x["size"]) for x in news])
    # Send again after a reload: the page no longer holds the file (nor this browser): it asks to choose it again
    E("""async () => { const p = S.books.meta.parts[0]; p.cloud = "not sent: Storage answered 503"; p.again = true; p.wait = "tcup:none"; TCloudUp.files = {}; render(); }""")
    pg.wait_for_timeout(300)
    E("() => { window.__picked = false; const i = document.getElementById('tallyIn'); if (i) i.click = () => { window.__picked = true; }; }")
    pg.click("#app [data-send-again]"); pg.wait_for_timeout(800)
    ok(E("window.__picked") is True and "choose it again" in txt("#app [data-cloud-notsent]") and not pg.locator("#app [data-send-again]").count(),
       "6. after a reload: asks to choose the file again (%s)" % txt("#app [data-cloud-notsent]"))
    # ---- 7. one day larger than a piece: said plainly, nothing sent, no Send again
    reset("")
    E("""async (cid) => { S.books = {loading: false, cid, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}}; goClient("books:import");
      const r = await fetch("http://localhost:9342/__file/hugeday"); const f = new File([await r.blob()], "DayBook-April.xml", {type: "text/xml"});
      DayCut.PIECE = 1048576; await bringDayBookFile(f, "", "", {toast: false}); }""", cid)
    for _ in range(150):
        line = txt("#app [data-cloud-notsent]")
        if line: break
        pg.wait_for_timeout(200)
    E("() => { DayCut.PIECE = 45 * 1048576; }")
    print("     line: " + line)
    ok(re.search(r"^DayBook-April\.xml: Saved on this computer, but not sent to FinCom’s cloud: the entries of 15-Apr-2026 alone come to 1\.\d MB, more than FinCom’s cloud takes in one piece \(1\.0 MB\), and a day is never cut in two: tell FinCom’s support\. Other logins will not see it until it is sent\.$", line),
       "7. a day larger than a piece: said plainly")
    ok(not pg.locator("#app [data-send-again]").count() and not state()["ingest"] and not state()["creates"], "7. nothing sent, no Send again (it cannot help)")
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown(); fake.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
