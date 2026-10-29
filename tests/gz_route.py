"""gz_route.py - for the tests whose stand-in Supabase is a Playwright route (ctx.route(STAGE + "/**", route)).

Since b889edb79 (26-Oct-2026) the app sends a save of more than 32 KB (records / clients upserts, rpc/save_book_items)
gzipped to the records-upload function (app/src/lib/gzUpload.js, server/records-upload), which makes the very same
PostgREST request and answers {fincomUpload: 1, status, body, range}. A route that reads request.post_data as text
fails on that gzip body (UnicodeDecodeError, which Playwright then re-raises as "TypeError: function takes exactly 5
arguments" from Route.fulfill). with_records_upload(route) gives the route the function as deployed: the gzip body
unpacked, the stand-in's own answer for the same REST path, wrapped as the function wraps it. Any other call: the route
as it is."""
import gzip, json
from urllib.parse import urlparse, parse_qs

# as server/records-upload/handler.ts (the paths and the Prefer each must carry)
ROUTES = {
    "records?on_conflict=firm_id,kind,id": "resolution=merge-duplicates,return=minimal",
    "clients?on_conflict=firm_id,id": "resolution=merge-duplicates,return=minimal",
    "rpc/save_book_items": "",
}


class _Req:
    def __init__(self, req, url, text, prefer):
        self.url, self.method, self.post_data = url, "POST", text
        self.post_data_buffer = text.encode()
        self.headers = dict(req.headers, **{"content-type": "application/json", "prefer": prefer})
        self.resource_type = req.resource_type

    @property
    def post_data_json(self): return json.loads(self.post_data)


class _Route:
    def __init__(self, req):
        self.request, self.got = req, None

    def fulfill(self, status=200, body="", content_type=None, headers=None, **_):
        self.got = (status, body if isinstance(body, str) else (body or b"").decode(), dict(headers or {}))

    def continue_(self, **_): self.got = (404, "", {})

    def fallback(self, **_): self.got = (404, "", {})


def with_records_upload(route):
    def handler(r):
        req = r.request; u = urlparse(req.url)
        if not u.path.endswith("/functions/v1/records-upload"): return route(r)
        q = parse_qs(u.query); p, pref = q.get("path", [""])[0], q.get("prefer", [""])[0]
        j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
        if ROUTES.get(p) != pref or "gzip" not in (req.headers.get("content-type") or ""): return j({"error": "refused"}, 400)
        text = gzip.decompress(req.post_data_buffer or b"").decode()
        inner = _Route(_Req(req, "%s://%s/rest/v1/%s" % (u.scheme, u.netloc, p), text, pref))
        route(inner)
        st, out, hd = inner.got or (500, "", {})
        rng = next((v for k, v in hd.items() if k.lower() == "content-range"), "")
        return j({"fincomUpload": 1, "status": st, "body": out, "range": rng})
    return handler
