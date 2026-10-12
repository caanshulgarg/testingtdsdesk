"""python3 make_expected.py - the known answers of the payroll test company (setup.json), worked out here on their own, from
the Income-tax rules as they stand for the tax year 2026-27, NOT by FinCom's code (src/js/73-payroll.js): expected.json.
Everything in paise (Decimal, half up). The rules, in words, are in the comments here."""
import json
from decimal import Decimal as D, ROUND_HALF_UP
S = json.load(open("setup.json"))
P = lambda x: D(str(x)).quantize(D("0.01"), ROUND_HALF_UP)
R10 = lambda x: (D(str(x)) / 10).quantize(D("1"), ROUND_HALF_UP) * 10
HEAD = {h[0]: h for h in S["payHeads"]}
EARN = [h[0] for h in S["payHeads"] if h[5] == "earn"]
def slab_tax(inc, slabs):
    t, lo = D(0), D(0)
    for hi, rate in slabs:
        if inc > lo:
            top = inc if hi is None else min(inc, D(hi))
            t += (top - lo) * D(rate) / 100
        if hi is None: break
        lo = D(hi)
    return t
NEW = [(400000, 0), (800000, 5), (1200000, 10), (1600000, 15), (2000000, 20), (2400000, 25), (None, 30)]
def OLD(senior): return [(300000 if senior else 250000, 0), (500000, 5), (1000000, 20), (None, 30)]
def tax_of(inc, regime, senior):
    slabs = OLD(senior) if regime == "old" else NEW
    t = slab_tax(inc, slabs)
    if regime == "old":
        reb = min(t, D(12500)) if inc <= 500000 else D(0)
    elif inc <= 1200000:
        reb = min(t, D(60000))
    else:
        reb = max(D(0), t - (inc - 1200000))      # marginal relief: the tax never more than the income above 12 lakh
    after = t - reb
    rate = 37 if inc > 50000000 and regime == "old" else 25 if inc > 20000000 else 15 if inc > 10000000 else 10 if inc > 5000000 else 0
    sur = D(0)
    if rate:
        th = {10: 5000000, 15: 10000000, 25: 20000000, 37: 50000000}[rate]
        prev = {10: 0, 15: 10, 25: 15, 37: 25}[rate]
        at_th = slab_tax(D(th), slabs) * (1 + D(prev) / 100)
        sur = after * D(rate) / 100
        if after + sur > at_th + (inc - th): sur = max(D(0), at_th + (inc - th) - after)
    return t, reb, after, sur
out = {"registers": {}, "annex1": {}, "annex2": {}}
# the month's register: per employee, each head as a positive amount, gross, deductions, net, TDS
for p in S["payrolls"]:
    ym = p["date"][:6]
    rows = []
    for r in p["rows"]:
        h = r["heads"]
        gross = sum(D(h[k]) for k in EARN)
        ded = sum(D(h[k]) for k in h if HEAD[k][5] == "ded")
        rows.append({"employee": r["employee"], "gross": str(P(gross)), "ded": str(P(ded)), "net": str(P(gross - ded)), "tds": str(P(h["PE Income Tax"]))
                     })
    out["registers"][ym] = sorted(rows, key=lambda x: x["employee"])
# Annexure I: per employee per month, by the date the payroll entry credits the salary and deducts the TDS (review 244 M2:
# the same date Annexure II and Form 16 count the year's TDS by), the month's challan (by the period it pays)
q_of = lambda d: "Q1" if "04" <= d[4:6] <= "06" else "Q2" if "07" <= d[4:6] <= "09" else "Q3" if "10" <= d[4:6] <= "12" else "Q4"
chal = {c["from"][:6]: c for c in S["tdsPayments"]}
sal = {s["date"][:6]: {e: a for e, a in s["rows"]} for s in S["salaryPayments"]}
for p in S["payrolls"]:
    ym = p["date"][:6]
    for r in p["rows"]:
        h = r["heads"]; paid = sum(D(h[k]) for k in EARN); tds = D(h["PE Income Tax"])
        c = chal[ym] if tds > 0 else None
        out["annex1"].setdefault(q_of(p["date"]), []).append({"employee": r["employee"], "date": p["date"], "paid": str(P(paid)), "tds": str(P(tds)),
            "challan": [c["bsr"], c["challan"].zfill(5), c["challanDate"]] if c else None})   # the challan serial as the return carries it: five digits
for q in out["annex1"]: out["annex1"][q].sort(key=lambda x: (x["date"], x["employee"]))
# Annexure II / Form 16 Part B
for e in S["employees"]:
    name, pan = e[0], e[1]
    d = S["details"].get(name, {})
    regime = "old" if d.get("regime") == "old" else "new"
    senior = d.get("senior") == "yes"
    parts = {"basic": D(0), "hra": D(0), "other": D(0)}; pt = D(0); tds = D(0)
    for p in S["payrolls"]:
        for r in p["rows"]:
            if r["employee"] != name: continue
            h = r["heads"]
            parts["basic"] += D(h["PE Basic"]); parts["hra"] += D(h["PE HRA"]); parts["other"] += D(h["PE Special Allowance"])
            pt += D(h["PE Professional Tax"]); tds += D(h["PE Income Tax"])
    # the employer's NPS contribution (declared: d80CCD2) is salary under 17(1) and deducted under 80CCD(2), up to 14% (new) or
    # 10% (old) of basic and DA (review 244 H3)
    nps = D(str(d.get("d80CCD2", 0)))
    salary = parts["basic"] + parts["hra"] + parts["other"] + nps
    prev = D(str(d.get("prevSalary", 0))); gross = salary + prev
    hra_ex = D(0)
    if regime == "old" and parts["hra"] > 0 and D(str(d.get("rent", 0))) > 0:
        b = parts["basic"]; rent = D(str(d["rent"]))
        hra_ex = max(D(0), min(parts["hra"], rent - b * D("0.10"), b * (D("0.5") if d.get("hraMetro") == "yes" else D("0.4"))))
    hra_ex = P(hra_ex)
    std = min(D(50000 if regime == "old" else 75000), max(D(0), gross - hra_ex))
    ptd = min(pt, D(5000)) if regime == "old" else D(0)
    inc_sal = max(D(0), gross - hra_ex - std - ptd)
    hp = -min(D(str(d.get("hlInterest", 0))), D(200000)) if regime == "old" else D(0)
    gti = max(D(0), inc_sal + hp)
    g = lambda k: D(str(d.get(k, 0)))
    if regime == "old":
        via = min(g("d80C"), D(150000)) + min(g("d80CCD1B"), D(50000)) + min(g("d80D"), D(50000 if senior else 25000)) + min(g("d80DParents"), D(50000 if d.get("parentsSenior") == "yes" else 25000)) + \
              g("d80E") + g("d80G") + min(g("d80TTA"), D(50000 if senior else 10000)) + min(nps, parts["basic"] * D("0.10")) + g("dOther")
    else:
        via = min(nps, parts["basic"] * D("0.14"))
    via = min(P(via), gti)
    total = R10(max(D(0), gti - via))
    t, reb, after, sur = tax_of(total, regime, senior)
    cess = P((P(after) + P(sur)) * D("0.04"))
    payable = R10(P(after) + P(sur) + cess)
    # no PAN (section 206AA): the tax stays the tax; the TDS to deduct is at least 20% of the income, only when there is tax
    # (review 244 H2)
    due = max(payable, R10(total * D("0.20"))) if not pan and payable > 0 else payable
    prev_tds = g("prevTds")
    out["annex2"][name] = {"regime": regime, "gross": str(P(gross)), "salary": str(P(salary)), "hraExempt": str(hra_ex), "standard": str(P(std)), "profTax": str(P(ptd)),
        "incomeSalary": str(P(inc_sal)), "houseProperty": str(P(hp)), "grossTotal": str(P(gti)), "chapter6": str(P(via)), "totalIncome": str(P(total)),
        "slabTax": str(P(t)), "rebate": str(P(reb)), "surcharge": str(P(sur)), "cess": str(cess), "taxPayable": str(P(payable)),
        "tdsHere": str(P(tds)), "prevTds": str(P(prev_tds)), "balance": str(P(payable - tds - prev_tds)),
        "tdsDue": str(P(due)), "shortfall": str(P(due - tds - prev_tds)), "nps": str(P(nps)), "category": "S" if senior and regime == "old" else "G"}
json.dump(out, open("expected.json", "w"), indent=1, sort_keys=True)
for n, x in out["annex2"].items(): print(n, x["regime"], "total", x["totalIncome"], "tax", x["taxPayable"], "tds", x["tdsHere"], "balance", x["balance"])
