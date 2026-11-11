"""python3 run_daybook_slices.py - a Day Book read without freezing the page (speed, 11-Nov-2026: a linked client's first
opening read each month of entries in one task of up to 0.5 s, 4.5 s at worst with the rest; 25.9 s until every entry).
In a page with nothing signed in (made-up entries, nothing sent anywhere):
  1. Books.importDayBook of a month's Day Book (3,000 made-up entries with bills, cost centres, items and GST, 3 MB):
     no task of the page over LONG_MS (100 ms; the browser has its turn every 30 ms of reading);
  2. what it gives is exactly what the reading in one go gives (every entry, every field, in the same order; the company's
     GSTINs and the first and last dates), worked out here with Books.takeVoucher on the same text;
  3. a UTF-16 file and a file with nothing in it: the same as in one go.
RED on the build before this change: 1 (one task of the whole month).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_daybook_slices.py"""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SLICES_PORT", "8217"))
LONG_MS = int(os.environ.get("LONG_MS", "100"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# a month of made-up entries, as Tally's Day Book export writes them
MAKE = r"""(n) => {
  const esc = s => s.replace(/&/g, "&amp;");
  const one = (i) => {
    const d = "202607" + String(1 + i % 28).padStart(2, "0"), amt = (1000 + i * 7.25).toFixed(2), gst = (Number(amt) * 0.18).toFixed(2), tot = (Number(amt) + Number(gst)).toFixed(2);
    const party = "ZZ Party " + (i % 97) + " & Sons";
    const bill = '<BILLALLOCATIONS.LIST><NAME>B/' + i + '</NAME><BILLTYPE>New Ref</BILLTYPE><BILLCREDITPERIOD JD="1" P="30 Days">30 Days</BILLCREDITPERIOD><AMOUNT>' + tot + '</AMOUNT></BILLALLOCATIONS.LIST>';
    const cc = i % 3 ? "" : '<CATEGORYALLOCATIONS.LIST><CATEGORY>Primary Cost Category</CATEGORY><COSTCENTREALLOCATIONS.LIST><NAME>Branch ' + (i % 5) + '</NAME><AMOUNT>-' + amt + '</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>';
    const item = i % 4 ? "" : '<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><GSTHSNNAME>8471</GSTHSNNAME><BILLEDQTY> ' + (i % 9 + 1) + ' Nos</BILLEDQTY><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Purchase Goods</LEDGERNAME><AMOUNT>-' + amt + '</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>';
    return '<TALLYMESSAGE><VOUCHER REMOTEID="r-' + i + '" VCHTYPE="Purchase" ACTION="Create"><DATE>' + d + '</DATE><GUID>zz-guid-' + i + '</GUID><ALTERID>' + (100 + i) + '</ALTERID>'
      + '<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><VOUCHERNUMBER>' + i + '</VOUCHERNUMBER><REFERENCE>INV/' + i + '</REFERENCE><PARTYLEDGERNAME>' + esc(party) + '</PARTYLEDGERNAME>'
      + '<PARTYGSTIN>09ZZZZZ' + String(i % 97).padStart(4, "0") + 'Z1Z5</PARTYGSTIN><CMPGSTIN>09AAGCL4827M1ZZ</CMPGSTIN><NARRATION>Being goods bought &amp;#13;&amp;#10; on bill ' + i + '</NARRATION>'
      + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + esc(party) + '</LEDGERNAME><AMOUNT>' + tot + '</AMOUNT>' + bill + '</ALLLEDGERENTRIES.LIST>'
      + (item || '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Purchase Goods</LEDGERNAME><GSTHSNNAME>9983</GSTHSNNAME><AMOUNT>-' + amt + '</AMOUNT>' + cc + '</ALLLEDGERENTRIES.LIST>')
      + '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Input IGST</LEDGERNAME><AMOUNT>-' + gst + '</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>';
  };
  const parts = []; for (let i = 0; i < n; i++) parts.push(one(i));
  window.__xml = "<ENVELOPE><BODY><DATA>" + parts.join("\n") + "</DATA></BODY></ENVELOPE>";
  return window.__xml.length;
}"""
# the reading in one go (the text cut at each </VOUCHER>, each entry taken, then copied), for comparing
ONEGO = r"""(utf16) => {
  const out = [], meta = {company: "", from: "", to: "", gstins: new Set(), bills: 1, cc: 1};
  window.__xml.split("</VOUCHER>").slice(0, -1).forEach(p => { const s = p.lastIndexOf("<VOUCHER "); if (s >= 0) Books.takeVoucher(p.slice(s) + "</VOUCHER>", out, meta); });
  meta.gstins = Array.from(meta.gstins); const dates = out.map(v => v.date).filter(Boolean).sort(); meta.from = dates[0] || ""; meta.to = dates[dates.length - 1] || "";
  return JSON.stringify({vouchers: structuredClone(out), meta});
}"""
READ = r"""async (utf16) => {
  const lt = []; const ob = new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(Math.round(e.duration)))); ob.observe({entryTypes: ["longtask"]});
  await new Promise(r => setTimeout(r, 300)); lt.length = 0;
  let blob;
  if (utf16){ const s = window.__xml, u = new Uint8Array(2 + s.length * 2); u[0] = 0xFF; u[1] = 0xFE; for (let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); u[2 + i * 2] = c & 255; u[3 + i * 2] = c >> 8; } blob = new Blob([u]); }
  else blob = new Blob([window.__xml], {type: "text/xml"});
  const t0 = performance.now(), r = await Books.importDayBook(blob), ms = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 300)); ob.disconnect();
  return {ms, n: r.vouchers.length, longest: lt.length ? Math.max(...lt) : 0, longN: lt.length, json: JSON.stringify(r)};
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_function("() => typeof Books === 'object' && typeof Books.importDayBook === 'function'", timeout=60000)
        E = lambda js, *a: pg.evaluate(js, *a)
        size = E(MAKE, 3000)
        r = E(READ, False); ref = E(ONEGO, False)
        ok(r["n"] == 3000 and r["longest"] < LONG_MS, "1. 3,000 entries (%.1f MB) read in %d ms, the longest task %d ms (%d over 50 ms; at most %d)" % (size / 1048576, r["ms"], r["longest"], r["longN"], LONG_MS))
        ok(r["json"] == ref, "2. exactly what the reading in one go gives (%d characters of entries)" % len(ref))
        r16 = E(READ, True)
        ok(r16["json"] == ref, "3. the same file in UTF-16: the same entries")
        E(MAKE, 0); r0 = E(READ, False); ref0 = E(ONEGO, False)
        ok(r0["json"] == ref0 and r0["n"] == 0, "3. a Day Book with no entries: the same (%d)" % r0["n"])
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
