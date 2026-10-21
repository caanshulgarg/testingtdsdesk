"""python3 redate.py <generator out dir> <dest dir>

Mode dbm / dbres (bridge 2.4.5, MEASURE ONLY, TEST DATA ONLY). Takes ZZ BIG TEST's vouchers as its own generator wrote
them (tests/fixtures/big/make_big_company.py at the ref, run by the build with --vouchers TOTAL below) and gives each one
a new date, keeping their order (a receipt still comes after the bill it settles). Tally in Educational mode takes
entries only on the 1st, 2nd and 31st of a month, so every test day is one of those:

    31-Jan-2026   300 entries  (the year before the current one: does the date apply outside the current period?)
    01-Jun-2026    50 entries
    02-Jul-2026   300 entries
    31-Aug-2026   800 entries
    01-Dec-2025     0 entries  (an empty day: is the answer empty, or another period?)
    every other 1st / 2nd / 31st from 01-Apr-2025 to 02-Oct-2026: 8 entries (background)

Every 8-digit date inside a voucher (DATE, EFFECTIVEDATE, REFERENCEDATE, the bank allocation's dates) becomes the new
day. Written: dest/dbm-vouchers-NN.xml (200 entries a file, Import Data envelopes) and dest/dbm-plan.json (the days and
how many entries each was given, by voucher type). The harness counts what Tally actually holds per day from Tally's
own undated list; the plan is only what was sent.
"""
import json, os, re, sys
from datetime import date

TARGETS = {"20260131": 300, "20260601": 50, "20260702": 300, "20260831": 800}
EMPTY = {"20251201"}
BACKGROUND = 8
PER_FILE = 200
FROM = "20250401"
# Mode dbbig (DBM_PROFILE=big): a big company, about 30,000 entries, all in FY 2026-27 (Educational-mode Tally refuses
# the earlier year's dates as "Out of Range", run 38790555479): 01-Jun 100, 02-Jul 300, 31-Aug 800, 31-May none, and the
# rest spread over the other 13 allowed days of Apr-Oct 2026 (about 2,215 each: 01-Aug is the "heavy day")
if os.environ.get("DBM_PROFILE") == "big":
    TARGETS = {"20260601": 100, "20260702": 300, "20260831": 800}
    EMPTY = {"20260531"}
    BACKGROUND = 2216
    PER_FILE = 500
    FROM = "20260401"


def allowed_days():
    out = []
    y, m = 2025, 4
    while (y, m) <= (2026, 10):
        for d in (1, 2, 31):
            try:
                day = date(y, m, d)
            except ValueError:
                continue
            if FROM <= day.strftime("%Y%m%d") and day <= date(2026, 10, 2):
                out.append(day.strftime("%Y%m%d"))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def plan_dates():
    seq = []
    for d in allowed_days():
        if d in EMPTY:
            continue
        seq += [d] * TARGETS.get(d, BACKGROUND)
    return seq


def total():
    return len(plan_dates())


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--total":
        print(total())
        return 0
    src, dest = sys.argv[1], sys.argv[2]
    os.makedirs(dest, exist_ok=True)
    text = ""
    for n in sorted(f for f in os.listdir(src) if re.match(r"big-vouchers-\d+\.xml$", f)):
        with open(os.path.join(src, n), encoding="utf-8") as f:
            text += f.read()
    vouchers = re.findall(r"<VOUCHER .*?</VOUCHER>", text, flags=re.S)
    dates = plan_dates()
    if len(vouchers) < len(dates):
        print("only %d vouchers for %d dates" % (len(vouchers), len(dates)), file=sys.stderr)
        return 1
    out, plan = [], {}
    for v, d in zip(vouchers, dates):
        v = re.sub(r"(<(?:DATE|EFFECTIVEDATE|REFERENCEDATE|INSTRUMENTDATE|BANKERSDATE)>)\d{8}(</)", r"\g<1>%s\g<2>" % d, v)
        t = re.search(r'VCHTYPE="([^"]+)"', v).group(1)
        p = plan.setdefault(d, {"total": 0, "types": {}})
        p["total"] += 1
        p["types"][t] = p["types"].get(t, 0) + 1
        out.append(v)
    for i in range(0, len(out), PER_FILE):
        with open(os.path.join(dest, "dbm-vouchers-%02d.xml" % (i // PER_FILE + 1)), "w", encoding="utf-8") as f:
            f.write("".join("<TALLYMESSAGE xmlns:UDF=\"TallyUDF\">%s</TALLYMESSAGE>" % v for v in out[i:i + PER_FILE]))
    with open(os.path.join(dest, "dbm-plan.json"), "w", encoding="utf-8") as f:
        json.dump({"targets": TARGETS, "empty": sorted(EMPTY), "background": BACKGROUND, "days": plan}, f, indent=1, sort_keys=True)
    print("dbm: %d vouchers re-dated over %d days into %d file(s); targets %s" % (len(out), len(plan), (len(out) + PER_FILE - 1) // PER_FILE,
          ", ".join("%s=%d" % (d, plan.get(d, {}).get("total", 0)) for d in sorted(TARGETS))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
