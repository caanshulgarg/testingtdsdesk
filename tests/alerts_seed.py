"""The made-up alerts of the 05-Oct-2026 fault (the same warning three times on every page), shared by
run_alerts_one_place.py and shots_alerts.py: a Tally computer (Office computer, NWS144) recording or not, the cursor's
gap, tally_alerts rows (two days of the same gap, a daily summary), and a line held by FinCom's own fault. SETUP fills
FinCom's cloud in the page (Cloud.api, TCloud.rpc) with them and returns the client's id."""
D1 = "d0000000-0000-4000-8000-000000000001"
def dev(recording=True, name="Office computer", pc="NWS144"):
    at = "ago:0.5"
    rec = {"GARG SHEKHAR & COMPANY": {"seen": recording, "lastAt": "ago:3" if recording else None}}
    b = {"at": at, "version": "2.2.0", "computer": pc, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["GARG SHEKHAR & COMPANY"], "recorder": rec}
    bt = {"at": at, "every": 30, "tally": True, "tallyState": "open", "open": ["GARG SHEKHAR & COMPANY"], "paused": False, "computer": pc}
    return {"id": D1, "name": name, "revoked": False, "last_seen": at, "version": "2.2.0", "main_bridge": "go-1", "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": pc, "user": "tally", "beat": bt, "bridges": {"go-1": b}}}
# the 05-Oct fault: the cursor's gap, two days of tally_alerts gap rows for the same book, a daily summary, the computer
# that is not recording
GAP = {"words": "up to 1 changes not received since 05-Oct-2026 08:00", "missing": 1, "missingMax": 1, "since": "TODAY08", "tally_altvchid": 54396, "recorder_max": 54395}
def al(i, kind, at, words, cid=None, read=None, day="TODAY"):
    return {"id": i, "firm_id": "f-1", "client_id": cid, "book_id": "b1" if cid else None, "device_id": None if cid else D1, "kind": kind, "day": day, "words": words,
            "data": {}, "at": at, "read_at": read, "read_by": None}
ALERTS = [al(1, "gap", "ago:20", "GARG SHEKHAR & COMPANY: up to 1 changes not received since 05-Oct-2026 08:00", cid="G", day="YESTERDAY"),
          al(2, "gap", "ago:5", "GARG SHEKHAR & COMPANY: up to 1 changes not received since 05-Oct-2026 08:00", cid="G"),
          al(3, "summary", "ago:2", "Today: 140 lines, 1 held, 1 gap, 3 postings")]
# a line held by FinCom's own fault (the add-on's placeholder GUID, no body) and one held because the month is locked
HELD_OURS = {"id": 501, "client_id": "G", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "GARG SHEKHAR & COMPANY", "line_id": "L501", "event": "altered",
             "object_guid": "abcd-1234-00000000", "alter_id": 0, "state": "held", "received_at": "ago:9", "vch_type": "Sales", "vch_no": "S-17", "vch_date": "20261005",
             "held_why": "no entry body on the line: waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"}

SETUP = """async ([s, role]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const ist = new Date(now + 330 * 60000), today = ist.toISOString().slice(0, 10), y = new Date(now + 330 * 60000 - 86400000).toISOString().slice(0, 10);
  const at08 = new Date(Date.parse(today + "T08:00:00+05:30")).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? today : v === "YESTERDAY" ? y : v === "TODAY08" ? at08 : v);
  let c = Object.values(S.companies).find(x => x.name === "GARG SHEKHAR & COMPANY");
  if (!c){ c = newCompany({name: "GARG SHEKHAR & COMPANY", gstin: "09AAKFG1234C1Z5"}); c.tallyName = "GARG SHEKHAR & COMPANY"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  const G = (o) => JSON.parse(JSON.stringify(o).split('"G"').join(JSON.stringify(c.id)));
  window.__w = {devs: fix(s.devs), alerts: G(fix(s.alerts)), cursor: s.gap ? [{book_id: "b1", gap: fix(s.gap), gap_at: ago(5), last_match_at: ago(30)}] : [],
    books: [{book_id: "b1", client_id: c.id, company: "GARG SHEKHAR & COMPANY"}], lines: G(fix(s.lines || [])), asked: [], calls: []};
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: role || "owner"})});
  TCloud.on = () => true; TCloud.has = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (p) => { const w = window.__w; w.asked.push(p);
    if (/^tally_devices/.test(p)) return copy(w.devs);
    if (/^tally_alerts/.test(p)) return copy(w.alerts);
    if (/^tally_sync_cursor/.test(p)) return copy(w.cursor);
    if (/^tally_books/.test(p)) return copy(w.books);
    if (/^tally_recorder_lines/.test(p)) return copy(w.lines.filter(l => !/state=in\\./.test(p) || ["held", "received", "queued", "failed"].includes(l.state)));
    return []; };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { const w = window.__w; w.calls.push([fn, copy(a || {})]);
    if (fn === "tally_alert_read"){ const x = w.alerts.find(r => r.id === a.p_id); if (x) x.read_at = new Date().toISOString(); return {ok: true}; }
    if (fn === "tally_recorder_silent") return {ok: true, silent: []};
    return null; };
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__w.devs), cos: [{company: "GARG SHEKHAR & COMPANY", client_id: c.id, device_id: window.__w.devs[0] ? window.__w.devs[0].id : null}]};
  TCloud.pane.devices = copy(window.__w.devs); TCloud.pane.at = Date.now(); TCloud.pane.err = "";
  if (typeof Rec === "object"){ Rec.silent = {}; Rec.gaps = {}; Rec.alerts = {}; }
  if (typeof AlertHub === "object") AlertHub.reset();
  S.storeKind = "db";   // the browser-only storage note is information: kept out of these counts
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  return c.id;
}"""
