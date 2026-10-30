"""python -I gen.py <out dir>

Mode stockp (MEASURE ONLY, TEST DATA ONLY: a throwaway company in a GitHub runner's own Tally; never a customer's
computer). A trading company's stock, deterministic (seeded), books from 1-Apr-2026:

  4,000 stock items: 10 stock groups and 40 items directly under Primary (no group); every 10th item FIFO, the rest
  Avg. Cost; every 4th item batch-wise (two batches); 85 % with an opening at books-beginning split over up to two of
  three godowns (Main Location, SP Godown B, SP Godown C).
  Year 1 (FY 2026-27): 30,000 inventory entries; year 2 (FY 2027-28, Apr-Jun): 2,000 more, so a period in year 2 has
  an opening that is year 1's closing.

Entries: Purchase (in), Sales (out), Credit Note (in), Debit Note (out), Stock Journal (two out, one in), on the days
Educational-mode Tally accepts (the 1st, 2nd and 31st). Each line names its godown and batch; an outward line takes
from a godown / batch that holds the quantity, so nothing goes below zero.

Written: masters.xml, v-<year>-<type>-NN.xml (250 entries a file; TALLYMESSAGE bodies), plan.json, items.json
([name, method, opening qty, opening value]) and expect.json (the books-beginning opening value, in all and by group).
"""
import json, os, random, sys
from datetime import date


def days(y0, months):
    out = []
    for y, m in months:
        for d in (1, 2, 31):
            try:
                out.append(date(y, m, d))
            except ValueError:
                pass
    return out


DAYS1 = days(2026, [(2026, m) for m in range(4, 13)] + [(2027, m) for m in range(1, 4)])
DAYS2 = days(2027, [(2027, m) for m in range(4, 7)])
GROUPS = ["SP Group %02d" % i for i in range(1, 11)]
GODOWNS = ["Main Location", "SP Godown B", "SP Godown C"]
SUPP = ["SP Supplier %02d" % i for i in range(1, 11)]
CUST = ["SP Customer %02d" % i for i in range(1, 11)]
PER_FILE = 250
N_ITEMS, N_PRIMARY, N_Y1, N_Y2 = 4000, 40, 30000, 2000
# mode g251 (2.5.1's gate): a smaller company of the same shape, STOCKP_SCALE="<items>,<year 1 entries>,<year 2 entries>"
if os.environ.get("STOCKP_SCALE"):
    N_ITEMS, N_Y1, N_Y2 = (int(x) for x in os.environ["STOCKP_SCALE"].split(","))


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def f2(x):
    return "%.2f" % x


def d8(d):
    return d.strftime("%Y%m%d")


def make_items(rng):
    items = []
    for i in range(1, N_ITEMS + 1):
        base = round(rng.uniform(10, 2000), 2)
        batched = (i % 4 == 0)
        bats = ["B%04d-1" % i, "B%04d-2" % i] if batched else ["Primary Batch"]
        allocs = []  # [godown, batch, qty]
        if rng.random() < 0.85:
            q = rng.randint(10, 500)
            gs = rng.sample(GODOWNS, 2 if rng.random() < 0.5 else 1)
            if len(gs) == 2 and q >= 2:
                q1 = rng.randint(1, q - 1)
                allocs = [[gs[0], rng.choice(bats), q1], [gs[1], rng.choice(bats), q - q1]]
            else:
                allocs = [[gs[0], rng.choice(bats), q]]
        oq = sum(a[2] for a in allocs)
        items.append({"name": "SP Item %04d" % i, "group": "" if i <= N_PRIMARY else GROUPS[i % 10],
                      "method": "FIFO" if i % 10 == 0 else "Avg. Cost", "base": base, "batched": batched, "bats": bats,
                      "allocs": allocs, "oq": oq, "oval": round(oq * base, 2)})
    return items


def masters_xml(items):
    out = ['<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>']
    for g in GODOWNS[1:]:
        out.append('<GODOWN NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT/></GODOWN>' % (g, g))
    for g in GROUPS:
        out.append('<STOCKGROUP NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT/></STOCKGROUP>' % (g, g))
    for n, p in [("SP Purchase", "Purchase Accounts"), ("SP Sales", "Sales Accounts")] + [(s, "Sundry Creditors") for s in SUPP] + [(c, "Sundry Debtors") for c in CUST]:
        out.append('<LEDGER NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT>%s</PARENT></LEDGER>' % (n, n, p))
    for it in items:
        x = '<STOCKITEM NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST>' % (it["name"], it["name"])
        x += '<PARENT>%s</PARENT>' % it["group"] if it["group"] else '<PARENT/>'
        x += '<BASEUNITS>Nos</BASEUNITS><COSTINGMETHOD>%s</COSTINGMETHOD><ISBATCHWISEON>%s</ISBATCHWISEON>' % (esc(it["method"]), "Yes" if it["batched"] else "No")
        if it["oq"]:
            r = f2(it["base"])
            x += '<OPENINGBALANCE> %d Nos</OPENINGBALANCE><OPENINGVALUE>-%s</OPENINGVALUE><OPENINGRATE>%s/Nos</OPENINGRATE>' % (it["oq"], f2(it["oval"]), r)
            for g, b, q in it["allocs"]:
                x += ('<BATCHALLOCATIONS.LIST><GODOWNNAME>%s</GODOWNNAME><BATCHNAME>%s</BATCHNAME><OPENINGBALANCE> %d Nos</OPENINGBALANCE>'
                      '<OPENINGVALUE>-%s</OPENINGVALUE><OPENINGRATE>%s/Nos</OPENINGRATE></BATCHALLOCATIONS.LIST>') % (g, b, q, f2(q * it["base"]), r)
        out.append(x + '</STOCKITEM>')
    return out


def inv_line(tag, item, gd, bt, q, rate, amt, inward, ledger):
    pos = "Yes" if inward else "No"
    a = f2(-amt) if inward else f2(amt)
    x = '<%s><STOCKITEMNAME>%s</STOCKITEMNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><RATE>%s/Nos</RATE><AMOUNT>%s</AMOUNT><ACTUALQTY> %d Nos</ACTUALQTY><BILLEDQTY> %d Nos</BILLEDQTY>' % (
        tag, item, pos, f2(rate), a, q, q)
    x += '<BATCHALLOCATIONS.LIST><GODOWNNAME>%s</GODOWNNAME><BATCHNAME>%s</BATCHNAME><AMOUNT>%s</AMOUNT><ACTUALQTY> %d Nos</ACTUALQTY><BILLEDQTY> %d Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>' % (gd, bt, a, q, q)
    if ledger:
        x += '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%s</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>' % (ledger, pos, a)
    return x + '</%s>' % tag


def make_vouchers(rng, items, stock, n, dlist, prefix):
    by = {it["name"]: it for it in items}
    names = [it["name"] for it in items]
    kinds = ["Purchase"] * 35 + ["Sales"] * 50 + ["Credit Note"] * 5 + ["Debit Note"] * 5 + ["Stock Journal"] * 5
    out = {}

    def take(it, cap):  # an outward line: a godown / batch that holds stock
        held = [(k, v) for k, v in stock[it].items() if v > 0]
        if not held:
            return None
        (gd, bt), have = rng.choice(held)
        q = rng.randint(1, max(1, min(have, cap)))
        stock[it][(gd, bt)] = have - q
        return gd, bt, q

    def put(it, q):
        gd = rng.choice(GODOWNS); bt = rng.choice(by[it]["bats"])
        stock[it][(gd, bt)] = stock[it].get((gd, bt), 0) + q
        return gd, bt

    for k in range(n):
        d = dlist[min(len(dlist) - 1, k * len(dlist) // n)]
        kind = rng.choice(kinds)
        no = "%s-%06d" % (prefix, k + 1)
        chosen = rng.sample(names, rng.randint(1, 8))
        lines = []
        if kind in ("Purchase", "Credit Note"):
            for it in (chosen if kind == "Purchase" else chosen[:2]):
                q = rng.randint(5, 200) if kind == "Purchase" else rng.randint(1, 10)
                r = round(by[it]["base"] * (rng.uniform(0.8, 1.2) if kind == "Purchase" else 1.3), 2)
                gd, bt = put(it, q)
                lines.append((it, gd, bt, q, r, round(q * r, 2), True))
        elif kind in ("Sales", "Debit Note"):
            for it in chosen:
                t = take(it, 120 if kind == "Sales" else 15)
                if not t:
                    continue
                r = round(by[it]["base"] * (1.3 if kind == "Sales" else 1.0), 2)
                lines.append((it, t[0], t[1], t[2], r, round(t[2] * r, 2), False))
        else:
            outs = []
            for it in chosen[:2]:
                t = take(it, 20)
                if t:
                    r = by[it]["base"]
                    outs.append((it, t[0], t[1], t[2], r, round(t[2] * r, 2), False))
            if outs:
                fin = rng.choice([x for x in names if x not in [o[0] for o in outs]])
                q = rng.randint(1, 20)
                tot = round(sum(o[5] for o in outs), 2)
                gd, bt = put(fin, q)
                lines = outs + [(fin, gd, bt, q, round(tot / q, 2), tot, True)]
        if not lines:
            continue
        dt = d8(d)
        if kind == "Stock Journal":
            x = '<VOUCHER VCHTYPE="Stock Journal" ACTION="Create" OBJVIEW="Consumption Voucher View"><DATE>%s</DATE><EFFECTIVEDATE>%s</EFFECTIVEDATE><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW>' % (dt, dt, no)
            for (it, gd, bt, q, r, amt, inward) in lines:
                x += inv_line("INVENTORYENTRIESIN.LIST" if inward else "INVENTORYENTRIESOUT.LIST", it, gd, bt, q, r, amt, inward, None)
        else:
            party = rng.choice(SUPP if kind in ("Purchase", "Debit Note") else CUST)
            led = "SP Purchase" if kind in ("Purchase", "Debit Note") else "SP Sales"
            tot = round(sum(l[5] for l in lines), 2)
            pdeb = kind in ("Sales", "Debit Note")
            x = '<VOUCHER VCHTYPE="%s" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>%s</DATE><EFFECTIVEDATE>%s</EFFECTIVEDATE><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE>' % (kind, dt, dt, kind, no, party)
            x += '<LEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>%s</AMOUNT></LEDGERENTRIES.LIST>' % (
                party, "Yes" if pdeb else "No", f2(-tot) if pdeb else f2(tot))
            for (it, gd, bt, q, r, amt, inward) in lines:
                x += inv_line("ALLINVENTORYENTRIES.LIST", it, gd, bt, q, r, amt, inward, led)
        out.setdefault(kind, []).append(x + '</VOUCHER>')
    return out


def write_part(dst, part, vs):
    files = []
    for kind, xs in vs.items():
        tag = kind.lower().replace(" ", "")
        for i in range(0, len(xs), PER_FILE):
            fn = "v-%s-%s-%02d.xml" % (part, tag, i // PER_FILE + 1)
            with open(os.path.join(dst, fn), "w", encoding="utf-8") as f:
                f.write("".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + x + '</TALLYMESSAGE>' for x in xs[i:i + PER_FILE]))
            files.append([fn, kind, len(xs[i:i + PER_FILE])])
    return files


def main():
    dst = sys.argv[1]
    os.makedirs(dst, exist_ok=True)
    rng = random.Random(20261030)
    items = make_items(rng)
    stock = {it["name"]: {(g, b): q for g, b, q in it["allocs"]} for it in items}
    v1 = make_vouchers(rng, items, stock, N_Y1, DAYS1, "SPA")
    v2 = make_vouchers(rng, items, stock, N_Y2, DAYS2, "SPB")
    with open(os.path.join(dst, "masters.xml"), "w", encoding="utf-8") as f:
        f.write("".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + x + '</TALLYMESSAGE>' for x in masters_xml(items)))
    plan = {"items": len(items), "y1": {"files": write_part(dst, "y1", v1), "entries": {k: len(v) for k, v in v1.items()}},
            "y2": {"files": write_part(dst, "y2", v2), "entries": {k: len(v) for k, v in v2.items()}}}
    with open(os.path.join(dst, "plan.json"), "w") as f:
        json.dump(plan, f)
    with open(os.path.join(dst, "items.json"), "w") as f:
        json.dump([[it["name"], it["method"], it["oq"], it["oval"]] for it in items], f)
    byg = {}
    for it in items:
        byg[it["group"] or "(Primary)"] = round(byg.get(it["group"] or "(Primary)", 0) + it["oval"], 2)
    exp = {"opening_total": round(sum(it["oval"] for it in items), 2), "by_group": byg,
           "batched_items": sum(1 for it in items if it["batched"]), "items_with_opening": sum(1 for it in items if it["oq"]),
           "opening_allocs": sum(len(it["allocs"]) for it in items)}
    with open(os.path.join(dst, "expect.json"), "w") as f:
        json.dump(exp, f)
    print(json.dumps({"items": len(items), "y1": plan["y1"]["entries"], "y2": plan["y2"]["entries"], "expect": {k: v for k, v in exp.items() if k != "by_group"}}))


if __name__ == "__main__":
    main()
