"""python3 run_upload_storage.py - round 20 (d.2): Books -> From Tally hands a Day Book file to FinCom's cloud through
Storage. tally-ingest upload_new {client, name, size} -> {job, path}; then a resumable (TUS 1.0.0) upload written in the
app: POST {storage}/storage/v1/upload/resumable (Upload-Length, Upload-Metadata bucketName tally-uploads, objectName the
path, contentType; Tus-Resumable 1.0.0; authorization Bearer the user's token; x-upsert false), PATCH 6 MB chunks with
Upload-Offset, on an error HEAD and go on from the server's offset; the upload's URL is kept in this browser's store so a
reload goes on from there; a progress bar; then upload_done {job, path}, once. The job's line: "Day Book 2026-27: 143 of
365 days read". A cloud without upload_new (400 'unknown kind', or 404): the old hand-over (job_new, stage_days).
A fake TUS server and tally-ingest on port 9342.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_upload_storage.py"""
import json, os, threading, functools, http.server, base64, hashlib, socket, time, re
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
        ST.clear(); ST.update({"mode": mode, "ingest": [], "creates": [], "patches": [], "heads": [], "uploads": {}, "delay": 0.0, "cut_done": False, "n": 0})
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
                return self.out(200, {"ok": True, "job": "job-1", "path": "f-1/%s/job-1.xml" % body.get("client")})
            if k == "upload_done": return self.out(200, {"ok": True, "queued": True})
            if k == "job_new": return self.out(200, {"ok": True, "job": "old-job-1"})
            if k == "stage_days": return self.out(200, {"ok": True, "queued": len(body.get("days") or [])})
            return self.out(400, {"ok": False, "error": "unknown kind"})
        if self.path == "/storage/v1/upload/resumable":
            self.rfile.read(n)
            meta = {}
            for part in (self.headers.get("Upload-Metadata") or "").split(","):
                kv = part.strip().split(" ")
                if kv and kv[0]: meta[kv[0]] = base64.b64decode(kv[1]).decode() if len(kv) > 1 else ""
            hd = {h: self.headers.get(h) for h in ("Tus-Resumable", "Upload-Length", "authorization", "x-upsert", "apikey")}
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
    ok([x["body"]["kind"] for x in s["ingest"]] == ["upload_new"], "no upload_done yet (%s)" % [x["body"]["kind"] for x in s["ingest"]])
    with LOCK: ST["mode"] = ""; ST["heads"] = []
    pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E(SETUP)
    sent = E("async (cid) => { window.__steps = []; return await TCloudUp.retry(cid, m => window.__steps.push(m)); }", cid)
    s = state()
    ok(sent is True, "after the reload, the waiting Day Book goes on its own (retry: %s)" % sent)
    ok(len(s["creates"]) == 1 and [x["body"]["kind"] for x in s["ingest"]] == ["upload_new", "upload_done"],
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
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown(); fake.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
