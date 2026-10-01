"""The client's books as FinCom's cloud keeps them (one Tally day book XML per day, the ledgers, the groups), made from
tests/data/books-cache.json. Used by run_fresh_browser.py and run_open_timing.py."""
esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
def line(e):
    bills = "".join("<BILLALLOCATIONS.LIST><NAME>%s</NAME><BILLTYPE>%s</BILLTYPE><AMOUNT>%.2f</AMOUNT></BILLALLOCATIONS.LIST>" % (esc(n), t, a) for n, t, a in e.get("b") or [])
    rate = ("<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE> %g</GSTRATE></RATEDETAILS.LIST>" % e["gr"]) if e.get("gr") is not None else ""
    return ("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>%s%s<AMOUNT>%.2f</AMOUNT>%s</ALLLEDGERENTRIES.LIST>"
            % (esc(e["l"]), "Yes" if e["a"] < 0 else "No", ("<GSTHSNNAME>%s</GSTHSNNAME>" % esc(e["h"])) if e.get("h") else "", rate, e["a"], bills))
def voucher(v):
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME><VOUCHERNUMBER>%s</VOUCHERNUMBER>%s'
            "<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>%s%s%s<NARRATION>%s</NARRATION><ISCANCELLED>%s</ISCANCELLED><ISOPTIONAL>%s</ISOPTIONAL>%s</VOUCHER></TALLYMESSAGE>"
            % (esc(v["type"]), v["date"], esc(v["id"]), esc(v["type"]), esc(v["no"]),
               (("<REFERENCEDATE>%s</REFERENCEDATE>" % v["refDate"]) if v.get("refDate") else "") + (("<REFERENCE>%s</REFERENCE>" % esc(v["ref"])) if v.get("ref") else ""),
               esc(v["party"]), ("<PARTYGSTIN>%s</PARTYGSTIN>" % v["gstin"]) if v.get("gstin") else "", ("<PLACEOFSUPPLY>%s</PLACEOFSUPPLY>" % esc(v["pos"])) if v.get("pos") else "",
               ("<CMPGSTIN>%s</CMPGSTIN>" % v["cmp"]) if v.get("cmp") else "", esc(v.get("narr") or ""), "Yes" if v.get("cancel") else "No", "Yes" if v.get("opt") else "No",
               "".join(line(e) for e in v["ent"])))
def build(books):
    by_day = {}
    for v in books["vouchers"]: by_day.setdefault(v["date"], []).append(voucher(v))
    led = [{"name": n, "parent": x.get("parent") or "", "open": x.get("open") or 0} for n, x in books["tb"]["led"].items()]
    grp = [{"name": g, "parent": p or ""} for g, p in (books.get("groups") or {}).items()]
    return by_day, led, grp
