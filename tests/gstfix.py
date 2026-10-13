"""Shared set-up for the GST tests of 02-Oct-2026: Testing AAD's books (tests/data/books-cache.json) with its confirmed
ledger map, 2B copies, GST settings and ITC decisions as on staging (tests/data/gst-cache.json). Both files hold client
data and stay out of git."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
def load():
    books = json.load(open(os.path.join(HERE, "data", "books-cache.json")))
    gst = json.load(open(os.path.join(HERE, "data", "gst-cache.json")))
    return books, gst
SETUP = """([bk, g]) => { const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id});
  S.books.map = Books.mapLedgers(bk.vouchers, {}); Object.entries(g.map).forEach(([l, m]) => { S.books.map[l] = Object.assign({n: l}, m); });
  S.books.twoBs = g.twoBs; S.books.gstSet = {"09": g.gstSet}; S.books.itcTrack = {"09": g.itcTrack};
  LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "gst"; S.gstReg = "09"; render(); return c.id; }"""
