"""python -I value.py <moves.json> <answers dir> [part ...]

Option (c), checked offline: FinCom values the stock itself from each item's opening (option a) and the inventory lines
of the year (the Day Book), and the result is compared, item by item, with Tally's own closing value for the same period
(the D2 answers the harness kept: d2-<part>-<from>-<to>.xml). moves.json is gen.py's (--moves): the same deterministic
test data the harness put in Tally.

Ways of valuing (see value() for the rules Tally was found to follow):
  tally        Tally's rules, as found by this comparison
  tally-billed the same with the billed quantity (what FinCom's copy holds today) in place of the actual one
  naive        the textbook rules: every inward line in the average at its own value; FIFO layers, returns as plain in/out
For a period not starting at the books' beginning the opening of the period is valued the same way at the day before.
"""
import json, os, re, sys
from collections import defaultdict


def load(p):
    with open(p) as f:
        return json.load(f)


def tally_answer(path):
    s = open(path, encoding="utf-8", errors="replace").read()
    out = {}
    for m in re.finditer(r'<STOCKITEM NAME="([^"]*)"[^>]*>(.*?)</STOCKITEM>', s, re.S):
        b = m.group(2)
        def num(tag):
            x = re.search(r"<%s[^>]*>\s*(-?[\d.,]+)" % tag, b)
            return float(x.group(1).replace(",", "")) if x else 0.0
        name = m.group(1).replace("&amp;", "&")
        out[name] = {"cq": num("CLOSINGBALANCE"), "cv": abs(num("CLOSINGVALUE")), "oq": num("OPENINGBALANCE"), "ov": abs(num("OPENINGVALUE"))}
    return out


# the order Tally keeps for entries of one day: the order they were entered (here: gen.py's import order, file by file,
# one voucher type after another, part S before part L), not the order of their numbers
IMPORT_ORDER = {"S": ["Credit Note", "Purchase", "Sales", "Stock Journal", "Debit Note"],
                "L": ["Sales", "Purchase", "Stock Journal", "Debit Note", "Credit Note"]}


def entry_key(m):
    part = m[2][2]
    return (m[0], "SLX".index(part), IMPORT_ORDER[part].index(m[3]), m[1])


def value(items, moves, frm, to, method, billed=False):
    """each item's (closing qty, closing value) at `to`. method "tally": the rules Tally was found to follow (below);
    "naive": the textbook rules (every inward line in the average at its own value; FIFO layers, returns as plain
    in / out). billed: the billed quantity in place of the actual one (FinCom's copy keeps only BILLEDQTY today).
    Tally's closing does not depend on the period's start (the same figure for 1-Apr..31-Oct and 1-Oct..31-Oct), so
    `frm` is not used: every figure runs from the books' beginning.
    The rules found (TallyPrime 3.0 to 7.1, run 40904873448):
      Avg. Cost: rate = (opening value + inward values - purchase-return values) / (opening qty + inward qty -
                 purchase-return qty); a sales return (Credit Note) adds quantity only (it is valued at that rate);
                 closing = closing qty x rate
      FIFO:      the closing quantity is valued by walking the inwards back from the latest: purchases and stock
                 journal inwards at their own values, a purchase return as a negative inward on its date, sales returns
                 not at all; the opening is the oldest inward; a quantity left over when the inwards run out is valued
                 at the average of all the inwards net of the returns. Entries of one day in Tally's own order."""
    by = defaultdict(list)
    for mv in moves:
        if mv[0] <= to:
            by[mv[4]].append(mv)
    res = {}
    for it in items:
        name, meth, oq, orate, oval = it["name"], it["method"], float(it["oq"]), it["orate"], float(it["oval"])
        mvs = sorted(by.get(name, []), key=entry_key)
        qof = lambda m: float(m[6] if billed else m[5])
        if method == "naive":
            if meth == "FIFO":
                layers = [[oq, orate]] if oq else []; q = oq
                for m in mvs:
                    qq = qof(m)
                    if m[8] > 0:
                        layers.append([qq, m[7] / qq]); q += qq
                    else:
                        need = qq; q -= qq
                        while need > 1e-9 and layers:
                            t = min(need, layers[0][0]); layers[0][0] -= t; need -= t
                            if layers[0][0] <= 1e-9:
                                layers.pop(0)
                res[name] = (q, sum(a * r for a, r in layers))
            else:
                pq, pv, q = oq, oval, oq
                for m in mvs:
                    qq = qof(m)
                    if m[8] > 0:
                        pq += qq; pv += m[7]; q += qq
                    else:
                        q -= qq
                res[name] = (q, q * (pv / pq if pq else 0.0))
            continue
        q = oq; pq, pv = oq, oval; ins = [(oq, oval)] if oq else []
        for m in mvs:
            qq = qof(m); kind = m[3]
            q += qq if m[8] > 0 else -qq
            if kind == "Credit Note":
                continue
            if m[8] > 0:
                pq += qq; pv += m[7]; ins.append((qq, m[7]))
            elif kind == "Debit Note":
                pq -= qq; pv -= m[7]; ins.append((-qq, -m[7]))
        avg = pv / pq if pq else 0.0
        if meth != "FIFO":
            res[name] = (q, q * avg)
            continue
        need, val = q, 0.0
        for (iq, iv) in reversed(ins):
            if need <= 1e-9:
                break
            if iq < 0:
                need -= iq; val += iv; continue
            t = min(need, iq); val += iv * t / iq; need -= t
        if need > 1e-9:
            val += need * avg
        res[name] = (q, val)
    return res


def prev_day(d):
    from datetime import date, timedelta
    x = date(int(d[:4]), int(d[4:6]), int(d[6:])) - timedelta(days=1)
    return x.strftime("%Y%m%d")


def compare(mine, tally, names):
    n = ok = 0; dmax = 0.0; dname = ""; tm = tt = 0.0; qbad = 0
    for nm in names:
        if nm not in tally:
            continue
        n += 1
        q, v = mine[nm]; t = tally[nm]
        tm += v; tt += t["cv"]
        if abs(q - t["cq"]) > 1e-6:
            qbad += 1
        d = abs(v - t["cv"])
        if d <= 1.0:
            ok += 1
        if d > dmax:
            dmax, dname = d, nm
    return {"items": n, "within_1_rupee": ok, "qty_differs": qbad, "max_diff": round(dmax, 2), "max_item": dname,
            "fincom_total": round(tm, 2), "tally_total": round(tt, 2), "total_diff": round(tm - tt, 2)}


def main():
    mv = load(sys.argv[1]); ans = sys.argv[2]; parts = sys.argv[3:] or ["S", "L"]
    items = mv["items"]; moves = mv["moves"]; IMPORT_ORDER.update(mv.get("order", {}))
    out = {}
    for part in parts:
        names = [it["name"] for it in items[:{"S": 600, "L": 3000, "X": 5000}[part]]]
        for fn in sorted(os.listdir(ans)):
            m = re.match(r"d2-%s-(\d{8})-(\d{8})\.xml$" % part, fn)
            if not m:
                continue
            frm, to = m.groups(); tally = tally_answer(os.path.join(ans, fn))
            for meth in ("tally", "naive"):
                for billed in (False, True):
                    if billed and meth != "tally":
                        continue
                    k = "%s %s-%s %s%s" % (part, frm, to, meth, "-billed" if billed else "")
                    out[k] = compare(value(items, moves, frm, to, meth, billed), tally, names)
                    print(k, json.dumps(out[k]))
    return out


if __name__ == "__main__":
    main()
