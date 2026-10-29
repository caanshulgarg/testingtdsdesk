"""python -I gen.py <out dir> [--moves] [--x]

Mode stockm (MEASURE ONLY, TEST DATA ONLY: a throwaway company in a GitHub runner's own Tally; never the owner's
computer). A trading company's stock for FY 2026-27, deterministic (seeded), in two parts:

  S  600 stock items (10 stock groups; every 10th item FIFO, the rest Avg. Cost; 85 % with an opening quantity, rate and
     value at books-beginning, 1-Apr-2026) and 3,000 inventory entries over the year
  L  2,400 more items (3,000 in all) and 17,000 more entries (20,000 in all) that touch only the new items, so the
     items of part S keep exactly the movements they had

Entries: Purchase (inward), Sales (outward), Credit Note (a sales return: inward), Debit Note (a purchase return:
outward), Stock Journal (two items out, one in), on the days Educational-mode Tally accepts (the 1st, 2nd and 31st of a
month) from 1-Apr-2026 to 31-Mar-2027. 1 to 8 item lines an entry. About 3 % of purchase lines carry free goods (actual
quantity above the billed one). Sales never take an item below zero.

Written: masters-S.xml, masters-L.xml (TALLYMESSAGE bodies for Import Data, All Masters), v-<part>-<type>-NN.xml (250
entries a file, TALLYMESSAGE bodies for Import Data, Vouchers) and plan.json (counts). With --moves also moves.json:
every item's opening and every line as [date, seq, voucher number, type, item, actual qty, billed qty, amount, dir]
(dir +1 inward, -1 outward) for the offline valuation check (option c).
"""
import json, os, random, sys
from datetime import date

FY_FROM = date(2026, 4, 1)
DAYS = []
for y, m in [(2026, mm) for mm in range(4, 13)] + [(2027, mm) for mm in range(1, 4)]:
    for d in (1, 2, 31):
        try:
            DAYS.append(date(y, m, d))
        except ValueError:
            pass
GROUPS = ["SM Group %02d" % i for i in range(1, 11)]
SUPP = ["SM Supplier %02d" % i for i in range(1, 11)]
CUST = ["SM Customer %02d" % i for i in range(1, 11)]
PER_FILE = 250


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def f2(x):
    return "%.2f" % x


def d8(d):
    return d.strftime("%Y%m%d")


def make_items(rng, lo, hi):
    items = []
    for i in range(lo, hi + 1):
        name = "SM Item %04d" % i
        base = round(rng.uniform(10, 2000), 2)
        if rng.random() < 0.85:
            oq = rng.randint(10, 500)
        else:
            oq = 0
        items.append({"name": name, "group": GROUPS[i % 10], "method": "FIFO" if i % 10 == 0 else "Avg. Cost",
                      "base": base, "oq": oq, "orate": base if oq else 0.0, "oval": round(oq * base, 2)})
    return items


def masters_xml(items, first):
    out = []
    if first:
        out.append('<UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT>')
        for g in GROUPS:
            out.append('<STOCKGROUP NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT/></STOCKGROUP>' % (g, g))
        for n, p in [("SM Purchase", "Purchase Accounts"), ("SM Sales", "Sales Accounts")] + [(s, "Sundry Creditors") for s in SUPP] + [(c, "Sundry Debtors") for c in CUST]:
            out.append('<LEDGER NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT>%s</PARENT></LEDGER>' % (n, n, p))
    for it in items:
        x = '<STOCKITEM NAME="%s" ACTION="Create"><NAME.LIST><NAME>%s</NAME></NAME.LIST><PARENT>%s</PARENT><BASEUNITS>Nos</BASEUNITS><COSTINGMETHOD>%s</COSTINGMETHOD>' % (
            it["name"], it["name"], it["group"], esc(it["method"]))
        if it["oq"]:
            q, r, v = it["oq"], f2(it["orate"]), f2(it["oval"])
            x += '<OPENINGBALANCE> %d Nos</OPENINGBALANCE><OPENINGVALUE>-%s</OPENINGVALUE><OPENINGRATE>%s/Nos</OPENINGRATE>' % (q, v, r)
            x += '<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE> %d Nos</OPENINGBALANCE><OPENINGVALUE>-%s</OPENINGVALUE><OPENINGRATE>%s/Nos</OPENINGRATE></BATCHALLOCATIONS.LIST>' % (q, v, r)
        x += '</STOCKITEM>'
        out.append(x)
    return out


def inv_line(tag, item, aq, bq, rate, amt, inward, ledger):
    pos = "Yes" if inward else "No"
    a = f2(-amt) if inward else f2(amt)
    x = '<%s><STOCKITEMNAME>%s</STOCKITEMNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><RATE>%s/Nos</RATE><AMOUNT>%s</AMOUNT><ACTUALQTY> %d Nos</ACTUALQTY><BILLEDQTY> %d Nos</BILLEDQTY>' % (
        tag, item, pos, f2(rate), a, aq, bq)
    x += '<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>%s</AMOUNT><ACTUALQTY> %d Nos</ACTUALQTY><BILLEDQTY> %d Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>' % (a, aq, bq)
    if ledger:
        x += '<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%s</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>' % (ledger, pos, a)
    return x + '</%s>' % tag


def make_vouchers(rng, items, n, prefix, seq0, moves):
    """n entries over the year on items; returns {type: [xml]}"""
    stock = {it["name"]: it["oq"] for it in items}
    by = {it["name"]: it for it in items}
    names = [it["name"] for it in items]
    kinds = ["Purchase"] * 35 + ["Sales"] * 50 + ["Credit Note"] * 5 + ["Debit Note"] * 5 + ["Stock Journal"] * 5
    plan = []
    for k in range(n):
        plan.append((DAYS[min(len(DAYS) - 1, k * len(DAYS) // n)], rng.choice(kinds)))
    out = {}
    seq = seq0
    for k, (d, kind) in enumerate(plan):
        no = "%s-%06d" % (prefix, k + 1)
        nl = rng.randint(1, 8)
        lines = []
        chosen = rng.sample(names, nl)
        if kind == "Purchase":
            for it in chosen:
                bq = rng.randint(5, 200)
                aq = bq + (rng.randint(1, 10) if rng.random() < 0.03 else 0)
                r = round(by[it]["base"] * rng.uniform(0.8, 1.2), 2)
                lines.append((it, aq, bq, r, round(bq * r, 2), True))
        elif kind == "Credit Note":
            for it in chosen[:2]:
                bq = rng.randint(1, 10)
                r = round(by[it]["base"] * 1.3, 2)
                lines.append((it, bq, bq, r, round(bq * r, 2), True))
        elif kind in ("Sales", "Debit Note"):
            for it in chosen:
                have = stock[it]
                if have <= 0:
                    continue
                bq = rng.randint(1, max(1, min(have, 120 if kind == "Sales" else 15)))
                r = round(by[it]["base"] * (1.3 if kind == "Sales" else 1.0), 2)
                lines.append((it, bq, bq, r, round(bq * r, 2), False))
        else:  # Stock Journal: two out, one in (the in valued at the outs' opening rates)
            outs = []
            for it in chosen[:2]:
                if stock[it] > 0:
                    q = rng.randint(1, max(1, min(stock[it], 20)))
                    r = by[it]["base"]
                    outs.append((it, q, q, r, round(q * r, 2), False))
            if outs:
                fin = rng.choice([x for x in names if x not in [o[0] for o in outs]])
                q = rng.randint(1, 20)
                tot = round(sum(o[4] for o in outs), 2)
                lines = outs + [(fin, q, q, round(tot / q, 2), tot, True)]
        if not lines:
            continue
        for (it, aq, bq, r, amt, inward) in lines:
            stock[it] += aq if inward else -aq
            if moves is not None:
                seq += 1
                moves.append([d8(d), seq, no, kind, it, aq, bq, amt, 1 if inward else -1])
        dt = d8(d)
        if kind == "Stock Journal":
            x = '<VOUCHER VCHTYPE="Stock Journal" ACTION="Create" OBJVIEW="Consumption Voucher View"><DATE>%s</DATE><EFFECTIVEDATE>%s</EFFECTIVEDATE><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><PERSISTEDVIEW>Consumption Voucher View</PERSISTEDVIEW><NARRATION>%s stock journal</NARRATION>' % (dt, dt, no, no)
            for (it, aq, bq, r, amt, inward) in lines:
                x += inv_line("INVENTORYENTRIESIN.LIST" if inward else "INVENTORYENTRIESOUT.LIST", it, aq, bq, r, amt, inward, None)
            x += '</VOUCHER>'
        else:
            party = rng.choice(SUPP if kind in ("Purchase", "Debit Note") else CUST)
            led = "SM Purchase" if kind in ("Purchase", "Debit Note") else "SM Sales"
            tot = round(sum(l[4] for l in lines), 2)
            # the party's line: credited on a purchase and a sales return, debited on a sale and a purchase return
            pdeb = kind in ("Sales", "Debit Note")
            x = '<VOUCHER VCHTYPE="%s" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>%s</DATE><EFFECTIVEDATE>%s</EFFECTIVEDATE><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>%s</NARRATION>' % (
                kind, dt, dt, kind, no, party, no)
            x += '<LEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>%s</AMOUNT></LEDGERENTRIES.LIST>' % (
                party, "Yes" if pdeb else "No", f2(-tot) if pdeb else f2(tot))
            for (it, aq, bq, r, amt, inward) in lines:
                x += inv_line("ALLINVENTORYENTRIES.LIST", it, aq, bq, r, amt, inward, led)
            x += '</VOUCHER>'
        out.setdefault(kind, []).append(x)
    return out, seq


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
    want_moves = "--moves" in sys.argv
    os.makedirs(dst, exist_ok=True)
    rng = random.Random(20261029)
    moves = [] if want_moves else None
    itS = make_items(rng, 1, 600)
    itL = make_items(rng, 601, 3000)
    vS, seq = make_vouchers(rng, itS, 3000, "SMS", 0, moves)
    vL, seq = make_vouchers(rng, itL, 17000, "SML", seq, moves)
    parts = [("S", itS, vS), ("L", itL, vL)]
    if "--x" in sys.argv:
        # part X (mode stockx): 2,000 more items (5,000 in all) and 60,000 more entries (80,000 in all) on them only
        itX = make_items(rng, 3001, 5000)
        vX, seq = make_vouchers(rng, itX, 60000, "SMX", seq, moves)
        parts.append(("X", itX, vX))
    plan = {"days": [d8(d) for d in DAYS]}
    for part, items, vs in parts:
        ms = masters_xml(items, part == "S")
        with open(os.path.join(dst, "masters-%s.xml" % part), "w", encoding="utf-8") as f:
            f.write("".join('<TALLYMESSAGE xmlns:UDF="TallyUDF">' + x + '</TALLYMESSAGE>' for x in ms))
        plan[part] = {"items": len(items), "files": write_part(dst, part, vs),
                      "entries": {k: len(v) for k, v in vs.items()}, "lines": sum(x.count("<STOCKITEMNAME>") for v in vs.values() for x in v)}
    with open(os.path.join(dst, "items.json"), "w") as f:
        json.dump([[it["name"], it["method"], it["oq"], it["orate"], it["oval"]] for p in parts for it in p[1]], f)
    with open(os.path.join(dst, "plan.json"), "w") as f:
        json.dump(plan, f, indent=1)
    if want_moves:
        with open(os.path.join(dst, "moves.json"), "w") as f:
            json.dump({"items": [it for p in parts for it in p[1]], "moves": moves, "order": {p[0]: list(p[2].keys()) for p in parts}}, f)
    print(json.dumps({p[0]: {k: v for k, v in plan[p[0]].items() if k != "files"} for p in parts}))


if __name__ == "__main__":
    main()
