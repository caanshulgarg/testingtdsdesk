"""python3 run_mis_schedule_ui.py - My MIS sent on a schedule (ROUND 105 B6), the browser's part, on the React build
(app/dist-test) with the made-up books (tests/mymis_stand.py) and FinCom's cloud stood in by the page (mis_schedules,
mis_runs, the mis-run function and the bucket mis-reports, as migration 100 and server/mis-run make them):
  1. a report not saved yet says to save it first; saved, "Send on a schedule" opens under it;
  2. a schedule added: monthly on the 1st at 08:45 IST, covering last month, to a member and the client's director: the row
     sent is exactly that (the firm is the database's to fill), and the list says it in words with the next time in IST;
     a wrong address is refused before anything is sent;
  3. Send now: the mis-run function is asked to run that schedule; the run is listed with its Excel and PDF, which download;
  4. turn off and on (never deleted);
  5. a look-only member sees the schedules and runs, no form and no buttons;
  6. a firm without migration 100 yet: one quiet line, no error;
  7. phone 390: no sideways scroll; screenshots for the owner (TDSDESK_SHOTS, default tests/out/my-mis)."""
import os, re, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from mymis_stand import start, mymis, W, shot, noside, serve, OUT
serve(int(os.environ.get("MISS_PORT") or 8441))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CLOUD = r"""(off) => {
  window.__sched = []; window.__runs = []; window.__fnCalls = []; window.__dl = [];
  const prev = Cloud.api;
  Cloud.api = async (path, o) => {
    if (/^mis_(schedules|runs)/.test(path) && off) throw new Error("PGRST205: Could not find the table 'public.mis_schedules' in the schema cache");
    if (/^mis_schedules\?select/.test(path)) return JSON.parse(JSON.stringify(window.__sched));
    if (/^mis_runs\?select/.test(path)) return JSON.parse(JSON.stringify(window.__runs));
    if (path === "mis_schedules" && o && o.method === "POST") { const row = Object.assign({id: "s-" + (window.__sched.length + 1), enabled: true, next_run: "2026-11-01T03:15:00Z", firm_id: "f-1"}, JSON.parse(JSON.stringify(o.body))); window.__sched.push(row); window.__posted = o.body; return [row]; }
    if (/^mis_schedules\?id=eq\./.test(path) && o && o.method === "PATCH") { const id = decodeURIComponent(path.split("eq.")[1]); window.__sched.forEach((s) => { if (s.id === id) Object.assign(s, o.body, {next_run: o.body.enabled ? "2026-11-01T03:15:00Z" : null}); }); return null; }
    return prev(path, o);
  };
  const real = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    if (/\/functions\/v1\/mis-run$/.test(u)) { const b = JSON.parse(o.body); window.__fnCalls.push(b);
      window.__runs.unshift({id: window.__runs.length + 1, at: "2026-10-22T05:00:00Z", status: "ok", email: "not set up", sent_to: [], report_id: window.__sched[0].report_id, period: {from: "20260901", to: "20260930"},
        files: [{kind: "xlsx", path: "f-1/c/20261022-mis.xlsx", name: "mis.xlsx"}, {kind: "pdf", path: "f-1/c/20261022-mis.pdf", name: "mis.pdf"}]});
      return Promise.resolve(new Response(JSON.stringify({ok: true, run: {id: 1}}), {headers: {"content-type": "application/json"}})); }
    if (/\/storage\/v1\/object\/authenticated\/mis-reports\//.test(u)) { window.__dl.push(u); return Promise.resolve(new Response(new Blob(["%PDF-1.7 made-up"]), {status: 200})); }
    return real(u, o);
  };
}"""
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1366, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    start(pg); pg.evaluate(CLOUD, False); mymis(pg)
    print("\n1. Saved first")
    pg.click('[data-mm-tpl="pl"]'); W(pg, 1200)
    ok(pg.locator(".mm-sched-hint").count() == 1 and pg.locator("[data-mm-sched-box]").count() == 0, "not saved yet: save it to send it on a schedule")
    pg.fill(".mm-name", "Larkspur monthly MIS"); pg.click("[data-mm-save]"); W(pg, 800)
    ok(pg.locator("[data-mm-sched-box]").count() == 1, "saved: Send on a schedule is there")
    pg.click("[data-mm-sched-box] > summary"); W(pg, 1000)
    print("\n2. A schedule")
    pg.select_option('[data-mm-sched-form] select[aria-label="How often"]', "monthly"); pg.select_option('[data-mm-sched-form] select[aria-label="Day of the month"]', "1")
    pg.fill('[data-mm-sched-form] input[aria-label="Time (IST)"]', "08:45"); pg.select_option('[data-mm-sched-form] select[aria-label="Period covered"]', "lastMonth")
    pg.check('[data-mm-sched-form] .mm-ticks input'); pg.fill('[data-mm-sched-form] input[aria-label="Email addresses"]', "director@client, accounts@client.example"); W(pg, 200)
    pg.click("[data-mm-sched-add]"); W(pg, 600)
    ok(pg.evaluate("window.__sched.length") == 0, "a wrong address is refused before anything is sent")
    pg.fill('[data-mm-sched-form] input[aria-label="Email addresses"]', "director@client.example"); pg.click("[data-mm-sched-add]"); W(pg, 900)
    posted = pg.evaluate("window.__posted")
    rid = pg.evaluate("S.myMis.def.id")
    ok(posted == {"client_id": pg.evaluate("S.coId"), "report_id": rid, "report_name": "Larkspur monthly MIS", "rule": {"freq": "monthly", "day": "1", "time": "08:45"}, "period": "lastMonth",
                  "recipients": {"members": ["u-1"], "emails": ["director@client.example"]}}, "the row sent: monthly on the 1st at 08:45, last month, the member and the director (%s)" % json.dumps(posted))
    t = pg.locator("[data-mm-sched-list], .mm-sched-list").first.inner_text() if pg.locator(".mm-sched-list").count() else ""
    ok("Every month on the 1st at 08:45 IST" in t and "last month" in t and "Anshul" in t and "director@client.example" in t and "next 01 Nov 2026" in t, "listed in words, with the next time in IST: " + t.replace("\n", " | "))
    shot(pg, "mymis-schedule")
    print("\n3. Send now")
    pg.click("[data-mm-sched-now]"); W(pg, 1200)
    ok(pg.evaluate("window.__fnCalls") == [{"action": "run", "schedule_id": "s-1"}], "mis-run asked to run that schedule")
    ok(pg.locator('[data-mm-runs] [data-mm-run="ok"]').count() == 1 and "email not set up" in pg.locator("[data-mm-runs]").inner_text(), "the run listed, email not set up")
    pg.evaluate("window.__saved = []"); pg.click('[data-mm-run-file="pdf"]'); W(pg, 800)
    ok(len(pg.evaluate("window.__dl")) == 1 and pg.evaluate("window.__saved.length") == 1 and pg.evaluate("window.__saved[0].name") == "mis.pdf", "its PDF downloads from the firm's folder of mis-reports")
    shot(pg, "mymis-schedule-run")
    print("\n4. Turn off and on")
    pg.click("[data-mm-sched-toggle]"); W(pg, 700)
    ok(pg.evaluate("window.__sched[0].enabled") is False and "turned off" in pg.locator(".mm-sched-list").inner_text(), "turned off")
    pg.click("[data-mm-sched-toggle]"); W(pg, 700)
    ok(pg.evaluate("window.__sched[0].enabled") is True and len(pg.evaluate("window.__sched")) == 1, "on again; never deleted")
    print("\n5. Look-only")
    pg.evaluate("S.account.me.role = 'readonly'; render();"); W(pg, 300)
    pg.click("[data-mm-sched-box] > summary"); W(pg, 200)
    if pg.locator("[data-mm-sched]").count() == 0: pg.click("[data-mm-sched-box] > summary"); W(pg, 800)
    ok(pg.locator("[data-mm-sched-row]").count() == 1 and pg.locator("[data-mm-sched-form]").count() == 0 and pg.locator("[data-mm-sched-now]").count() == 0, "a look-only member sees the schedule and the run, no form, no buttons")
    pg.evaluate("S.account.me.role = 'owner'; render();")
    print("\n6. Not set up yet")
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errors.append(str(e)))
    items = pg.evaluate("window.__items")
    start(pg2, items); pg2.evaluate(CLOUD, True); mymis(pg2)
    pg2.click('[data-mm-open]'); W(pg2, 900); pg2.click("[data-mm-sched-box] > summary"); W(pg2, 900)
    ok(pg2.locator("[data-mm-sched-off]").count() == 1, "a firm without the schedules yet: one quiet line")
    print("\n7. Phone")
    ph = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2); pp = ph.new_page(); pp.on("pageerror", lambda e: errors.append(str(e)))
    start(pp, items); pp.evaluate(CLOUD, False); pp.evaluate("(r) => { window.__sched = r.s; window.__runs = r.r; }", {"s": pg.evaluate("window.__sched"), "r": pg.evaluate("window.__runs")}); mymis(pp)
    pp.click('[data-mm-open]'); W(pp, 900); pp.click("[data-mm-sched-box] > summary"); W(pp, 900)
    ok(noside(pp), "phone 390: no sideways scroll with the schedule open")
    pp.locator("[data-mm-sched-box]").scroll_into_view_if_needed(); shot(pp, "mymis-schedule-phone")
    br.close()
ok(not errors, "no page error" + (": " + errors[0] if errors else ""))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
