"""The S15 lines and messages the stub received in a real-Tally run, for patch.py's replay through tally-ingest.
  python3 extract.py <stub-requests.jsonl> <out.json> [new name]"""
import json, sys
src, outp = sys.argv[1], sys.argv[2]
NEW = sys.argv[3] if len(sys.argv) > 3 else "S231 Renamed Party"
reqs = [json.loads(l) for l in open(src, encoding="utf-8")]
G = next((x.get("object_guid") for o in reqs if o["kind"] == "recorder_lines" for x in o["body"].get("lines", []) if NEW in (x.get("xml") or "")), None)
out = {"src": src, "company": None, "seed": None, "steps": []}
beat = False
for o in reqs:
    k, b = o["kind"], o["body"]
    if k == "_seed_ledgers": out["seed"] = {"names": b["names"], "guids": b.get("guids", {})}; out["company"] = b["company"]
    if k == "recorder_lines":
        for x in b.get("lines", []):
            if G and x.get("object_guid") == G:
                out["steps"].append({"kind": "recorder_lines", "at": o["at"], "line": x, "stub_answer": [r for r in o["answer"]["results"] if r["line_id"] == x["line_id"]]})
    if k == "ledger_changes" and any(isinstance(r, list) and len(r) > 3 and r[3] == NEW for r in b.get("ledgers", [])):
        out["steps"].append({"kind": "ledger_changes", "at": o["at"], "body": {kk: vv for kk, vv in b.items() if kk != "bridge"}, "stub_answer": o["answer"]})
    if k == "beat" and not beat and any(w.get("name") == NEW for w in (o["answer"].get("ledgersWanted") or [])):
        beat = True; out["steps"].append({"kind": "beat", "at": o["at"], "stub_answer": o["answer"]})
json.dump(out, open(outp, "w"), indent=1)
print("S15 guid", G, [(s["kind"], s["at"]) for s in out["steps"]])
