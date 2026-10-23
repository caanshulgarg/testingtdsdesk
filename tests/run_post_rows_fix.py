"""python3 run_post_rows_fix.py - the owner's rows on the Post to Tally page (the owner's spec of 04-Oct-2026, item F), with
fixture rows shaped exactly like staging's (project qbocskaiewaxqcvaunzc, client Testing AAD / GARG SHEKHAR & COMPANY, read
on 04-Oct-2026 with SELECT only): tally_post_jobs (results, items, payload, created_by, dismissed), tally_post_ids
(live, accepted_vch, reply_vch, batch_end), tally_post_marks, and the bills as the records table holds them (ids, numbers,
parties, dates, amounts, exportedAt, tally, goneFromTally). Nothing is anonymised: it is the owner's test firm.
For each row the owner listed, what the page says now (and printed, so a run on the older program shows what it said):
  Bill 61 (emusllmujww0yu)        Tally id 26302;
  Jitin & Co. 4861 (emuslylailsdrr) Tally id 26301, not 4861; "Correct the Tally id" (owner) records it as a mark
                                    (tally_post_job_mark_posted: a new tally_post_marks row) and then shows 26301 alone;
  6009, FA/2026-27/081, FA/ELEC/013, KIS/335   "Posted before 04-Oct; Tally's reply was not kept." with the Tally id held;
  emupeho9q2sijk                  its bill (FA/ELEC/013, Fingate, 25,535.00, 01-Jul-2026), read from the posting: FinCom
                                    has no record of that bill any more (status 10);
  the cancelled posting of 30-Sep  under Errors, status 9 (it had been dismissed: it was nowhere);
  Bill 62 (emusi5455der9b, 26300)  Needs review: Tally accepted it as 26300 and FinCom could not find it; what went to
                                    Tally differs from the bill now (2024-25/62, 18-Jan-2026, 21,600.00);
  the 04-Feb-2026 bill (26298, 26299)  Needs review: Tally may have it twice;
  Jitin & Co. 3829 (emutzp8x6z64zl) Tally id 26307, voucher date in Tally 02-Oct-2023, and "This entry is in FY 2023-24 in
                                    Tally; change the period in Tally to see it."
Every row in exactly one tab; amounts in the Indian format with two decimals, dates dd-Mon-yyyy, times IST.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_rows_fix.py"""
import os, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("PORT", "8291"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(port=None):
    srv = http.server.ThreadingHTTPServer(("localhost", port or PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OWNER = "aef3b147-a157-4f43-bd92-66540d566d93"
G = "GARG SHEKHAR & COMPANY"
def vx(id_, date, no, party, lines):
    """a voucher of a posting's payload, as voucherXml wrote it (the parts the page reads)"""
    ent = "".join("<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>%s</LEDGERNAME>\n<ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE>\n<AMOUNT>%s</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n" % (l, "Yes" if a < 0 else "No", "%.2f" % a) for l, a in lines)
    return {"id": id_, "xml": '<VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">\n<DATE>%s</DATE>\n<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>\n%s<REFERENCE>%s</REFERENCE>\n<PARTYLEDGERNAME>%s</PARTYLEDGERNAME>\n<NARRATION>Being invoice | TDSDesk:%s</NARRATION>\n%s</VOUCHER>\n'
            % (date, ("<VOUCHERNUMBER>%s</VOUCHERNUMBER>\n" % no) if no else "", no, party.replace("&", "&amp;"), id_, ent.replace("&", "&amp;"))}
J = {
 "cancel": "11111111-2222-4333-8444-000000000001", "feb": "3b03cc5e-aef3-4c6e-afaa-b238e3dc3f02", "fa013": "b3785b05-69b5-4167-88a5-58a55f8e8451", "fa081a": "aebb6c15-ab15-40c1-8b43-823f13e01e34",
 "fa081": "e9bd8ae0-9491-423a-8010-5bf961a0eb74", "s6009": "ccf87092-1b3f-4bea-b757-52536e05ea1e", "b62": "38857f25-0150-4f34-941b-0ee6e787db89", "j4861": "6b904d32-87ab-464d-9832-7e094c1a9f6f",
 "b61": "a8258606-1310-49c8-a22a-9da75b5bea74", "j5000": "e8e55c84-1b0e-4c8f-a46b-4bde881a4fd1", "pc0691": "32a1ef95-9450-421b-9e07-b755907a0c07", "j3916": "b760573d-2e90-455e-bcc6-618deebb7fbc",
 "j3829": "1f132833-79fd-43fb-ad94-c92ac8d15db3", "j3594": "1d35acbd-fba9-45a1-9d8c-ef93a3a40c09"}
def job(k, status, n, message, created, updated, ids, results, items, extra=None):
    o = {"id": J[k], "client_id": "cmufksrrqjub2g", "company": G, "status": status, "n": n, "done": n if status == "done" else 0, "message": message, "created_at": created, "updated_at": updated,
         "entry_ids": ids, "results": results, "items": items, "created_by": OWNER, "dismissed_at": None, "dismiss_auto": False}
    o.update(extra or {}); return o
def reply(id_, vid, vdate):
    return {"id": id_, "ok": True, "guid": "", "held": False, "kind": "voucher", "state": "posted", "vchId": vid, "vchNo": "", "batchN": 1, "errors": 0, "reason": "", "sameId": False, "sentAt": None, "already": False, "altered": 0,
            "byReply": True, "company": "", "created": 1, "ignored": 0, "message": "", "refused": False, "vchDate": vdate, "vchType": "Journal", "accepted": False, "batchEnd": vid, "masterId": "", "optional": False,
            "postOnly": False, "verified": False, "lastVchId": vid, "lineError": [], "vchNumber": "", "acceptedAt": "", "exceptions": 0, "alreadySent": False, "checkFailed": False, "needsReview": False, "alreadyThere": False}
FEB_REPLY = "Tally replied 'created', but the entry cannot be found in 'GARG SHEKHAR & COMPANY' or in any other company open in this Tally. It was not marked as posted. Tally's reply: <RESPONSE> <CREATED>1</CREATED> <ALTERED>0</ALTERED> <DELETED>0</DELETED> <LASTVCHID>26299</LASTVCHID> <LASTMID>0</LASTMID> <COMBINED>0</COMBINED> <IGNORED>0</IGNORED> <ERRORS>0</ERRORS> <CANCELLED>0</CANCELLED> <EXCEPTIONS>0</EXCEPTIONS> </RESPONSE>"
B62_MSG = "Tally replied 'created' (voucher id 26300) in job 38857f25-0150-4f34-941b-0ee6e787db89 but the entry was not found yet in 'GARG SHEKHAR & COMPANY' on 18-01-2026; it is being checked and is not sent again"
JOBS = [
 job("cancel", "cancelled", 1, "Cancelled before the Tally computer took it", "2026-09-30T16:52:46.509863+00:00", "2026-09-30T16:52:46.509863+00:00", ["zz-test-1"], None, None,
     {"dismissed_at": "2026-10-02T05:24:09.716977+00:00", "dismissed_by": OWNER, "dismiss_note": "Dismissed", "payload": {"ledger": "", "masters": [], "vouchers": [{"id": "zz-test-1", "xml": "<VOUCHER/>"}]}}),
 job("fa013", "done", 1, "1 of 1 sent to Tally", "2026-10-01T10:41:19.576905+00:00", "2026-10-01T10:41:34.302+00:00", ["emupeho9q2sijk"],
     [{"id": "emupeho9q2sijk", "ok": True, "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066b6", "kind": "voucher", "message": "", "vchDate": "20260701", "vchType": "Journal", "masterId": "26294", "optional": False, "verified": True, "vchNumber": "FA/ELEC/013", "alreadyThere": False}], None,
     {"payload": {"ledger": "", "masters": [], "vouchers": [vx("emupeho9q2sijk", "20260701", "FA/ELEC/013", "Fingate Advisory Services Limited", [("Office Expenses", -21640), ("INPUT CGST", -1947.6), ("INPUT SGST", -1947.6), ("Round Off", 0.2), ("Fingate Advisory Services Limited", 25535)])]}}),
 job("fa081a", "failed", 1, "Tally did not show GARG SHEKHAR & COMPANY for two minutes. Open it in TallyPrime and post again.", "2026-10-02T01:50:39.182687+00:00", "2026-10-02T01:53:21.057+00:00", ["emuqapmyusbj3e"], None, None,
     {"dismissed_at": "2026-10-02T05:13:30.136612+00:00", "dismiss_auto": True, "dismiss_note": "Posted later at 07:51"}),
 job("fa081", "done", 1, "1 of 1 sent to Tally", "2026-10-02T02:21:12.314316+00:00", "2026-10-02T02:21:24.089+00:00", ["emuqapmyusbj3e"],
     [{"id": "emuqapmyusbj3e", "ok": True, "kind": "voucher", "message": "", "vchNumber": "FA/2026-27/081", "masterId": "26295", "vchDate": "20260701", "vchType": "Journal", "verified": True}], None),
 job("s6009", "done", 1, "1 of 1 sent to Tally", "2026-10-02T03:54:09.775952+00:00", "2026-10-02T03:54:20.723+00:00", ["emuqf3q7bz0qhm"],
     [{"id": "emuqf3q7bz0qhm", "ok": True, "kind": "voucher", "message": "", "vchNumber": "6009", "masterId": "26296", "vchDate": "20260801", "vchType": "Purchase", "verified": True}], None),
 job("feb", "done", 1, "Held as posted on 03-Oct-2026: Tally replied CREATED for emuqtw0683g090 (voucher 26298, then 26299 on a second send at 09:53). Do not post again. Owner is checking the Day Book of 04-Feb-2026 for a duplicate.",
     "2026-10-03T03:52:05.813045+00:00", "2026-10-03T05:00:04.035114+00:00", ["emuqtw0683g090"],
     [{"id": "emuqtw0683g090", "ok": False, "guid": "", "kind": "voucher", "state": "failed", "vchNo": "", "reason": "Failed: " + FEB_REPLY, "sameId": False, "already": False, "message": FEB_REPLY + " ", "vchDate": "", "vchType": "", "masterId": "", "optional": False, "verified": False, "vchNumber": "", "checkFailed": False, "alreadyThere": False, "guidMismatch": False, "outcomeUnknown": False}],
     [{"id": "emuqtw0683g090", "kind": "voucher", "state": "failed", "reason": "Failed: " + FEB_REPLY}],
     {"payload": {"ledger": "", "masters": [], "vouchers": [vx("emuqtw0683g090", "20260204", "", "Vivek Gupta & Associates", [("Professional Fee Non Gst", -50000), ("Vivek Gupta & Associates", 50000)])]}}),
 job("b62", "done", 1, "Posted 0 of 1 (being checked in Tally)", "2026-10-03T14:49:58.919309+00:00", "2026-10-03T16:40:15.029+00:00", ["emusi5455der9b"],
     [{"id": "emusi5455der9b", "ok": False, "guid": "", "held": False, "kind": "voucher", "state": "unknown", "vchNo": "", "reason": "Failed: Tally refused it (" + B62_MSG + ") — correct it, then press Retry in FinCom", "sameId": False, "already": False, "altered": 0, "created": 0,
       "message": B62_MSG, "refused": False, "vchDate": "", "vchType": "", "accepted": True, "masterId": "", "optional": False, "postOnly": False, "verified": None, "lastVchId": "26300", "vchNumber": "", "acceptedAt": "2026-10-03T21:51:08+05:30", "checkFailed": False, "alreadyThere": False, "guidMismatch": False, "wrongCompany": "", "outcomeUnknown": True}],
     [{"id": "emusi5455der9b", "kind": "voucher", "state": "unknown", "reason": "Tally accepted it (voucher id 26300); being checked, not sent again", "outcomeUnknown": True}],
     {"payload": {"ledger": "", "masters": [], "vouchers": [vx("emusi5455der9b", "20260118", "2024-25/62", "Vivek Gupta & Associates", [("Professional Fee Non Gst", -21600), ("Vivek Gupta & Associates", 17280), ("TDS on Professional Fee 94J", 4320)])]}}),
 job("j4861", "done", 1, "Marked posted by the owner", "2026-10-03T16:32:15.239783+00:00", "2026-10-03T16:41:53.886461+00:00", ["emuslylailsdrr"],
     [{"id": "emuslylailsdrr", "ok": True, "guid": "", "held": False, "kind": "voucher", "state": "in_tally", "vchNo": "", "reason": "", "sameId": False, "already": False, "altered": 0, "byOwner": True, "created": 0, "message": "Marked posted by the owner on 03-Oct-2026: in Tally as voucher 4861",
       "refused": False, "vchDate": "", "vchType": "", "accepted": True, "masterId": "", "optional": False, "postOnly": False, "verified": True, "byOwnerAt": "2026-10-03T16:41:53.886Z", "lastVchId": "26301", "vchNumber": "4861", "acceptedAt": "2026-10-03T22:10:16+05:30", "checkFailed": False, "alreadyThere": False, "guidMismatch": False, "wrongCompany": "", "outcomeUnknown": False}],
     [{"id": "emuslylailsdrr", "kind": "voucher", "state": "in_tally", "reason": "", "byOwner": True, "byOwnerAt": "2026-10-03T16:41:53.886Z", "outcomeUnknown": True}]),
 job("b61", "done", 1, "Posted 1 of 1 (verified in Tally)", "2026-10-03T16:40:47.4976+00:00", "2026-10-03T16:59:26.736+00:00", ["emusllmujww0yu"],
     [{"id": "emusllmujww0yu", "ok": True, "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066be", "held": False, "kind": "voucher", "state": "in_tally", "vchNo": "", "reason": "", "sameId": False, "already": False, "altered": 0, "created": 0, "message": "", "refused": False,
       "vchDate": "20261001", "vchType": "Journal", "accepted": False, "masterId": "26302", "optional": False, "postOnly": False, "verified": True, "lastVchId": "26302", "vchNumber": "61", "acceptedAt": "", "checkFailed": False, "alreadyThere": False, "guidMismatch": False, "wrongCompany": "", "outcomeUnknown": False}],
     [{"id": "emusllmujww0yu", "kind": "voucher", "state": "in_tally", "reason": ""}]),
 job("j5000", "done", 1, "Posted 1 of 1 (Tally's reply)", "2026-10-04T04:23:50.262175+00:00", "2026-10-04T04:23:56.804+00:00", ["emutbefbslee3n"], [reply("emutbefbslee3n", "26303", "20261001")], [{"id": "emutbefbslee3n", "kind": "voucher", "state": "posted", "reason": ""}]),
 job("pc0691", "done", 1, "Posted 1 of 1 (Tally's reply)", "2026-10-04T10:00:04.028724+00:00", "2026-10-04T10:00:09.881+00:00", ["emutnfd6mjatj0"], [reply("emutnfd6mjatj0", "26304", "20260925")], [{"id": "emutnfd6mjatj0", "kind": "voucher", "state": "posted", "reason": ""}]),
 job("j3916", "done", 1, "Posted 1 of 1 (Tally's reply)", "2026-10-04T15:38:37.165376+00:00", "2026-10-04T15:38:43.545+00:00", ["emutziaksk0kad"], [reply("emutziaksk0kad", "26306", "20261003")], [{"id": "emutziaksk0kad", "kind": "voucher", "state": "posted", "reason": ""}]),
 job("j3829", "done", 1, "Posted 1 of 1 (Tally's reply)", "2026-10-04T15:43:54.41053+00:00", "2026-10-04T15:44:00.842+00:00", ["emutzp8x6z64zl"], [dict(reply("emutzp8x6z64zl", "26307", "20231002"), sentAt="2026-10-04T21:13:55+05:30", secondsReq=3.727)], [{"id": "emutzp8x6z64zl", "kind": "voucher", "state": "posted", "reason": ""}]),
 job("j3594", "done", 1, "Posted 1 of 1 (Tally's reply)", "2026-10-04T16:13:32.240271+00:00", "2026-10-04T16:13:38.35+00:00", ["emuu0rmot15xnj"], [reply("emuu0rmot15xnj", "26308", "20260930")], [{"id": "emuu0rmot15xnj", "kind": "voucher", "state": "posted", "reason": ""}]),
]
def idr(k, fid, live, created, acc=None, vch=None, rv=None):
    return {"job_id": J[k], "fincom_id": fid, "entry_id": fid, "live": live, "created_at": created, "accepted_at": acc, "accepted_vch": vch, "released_at": None, "released_by": None, "released_why": None,
            "reply_vch": rv, "batch_end": rv, "batch_n": 1 if rv else None, "matched_at": None, "matched_vch": None}
IDS = [idr("fa081a", "emuqapmyusbj3e", False, "2026-10-02 15:09:03"), dict(idr("cancel", "zztest1", False, "2026-10-02 15:09:03"), entry_id="zz-test-1"),
       idr("j3916", "emutziaksk0kad", True, "2026-10-04 15:38:37", "2026-10-04 15:38:43", "26306", "26306"), idr("fa013", "emupeho9q2sijk", True, "2026-10-02 15:09:03", "2026-10-03 07:14:34", "FA/ELEC/013"),
       idr("fa081", "emuqapmyusbj3e", True, "2026-10-02 15:09:03", "2026-10-03 07:14:34", "FA/2026-27/081"), idr("s6009", "emuqf3q7bz0qhm", True, "2026-10-02 15:09:03", "2026-10-03 07:14:34", "6009"),
       idr("feb", "emuqtw0683g090", True, "2026-10-03 03:52:05", "2026-10-03 07:14:34", "26299"), idr("b62", "emusi5455der9b", True, "2026-10-03 14:49:58", "2026-10-03 16:21:10", "26300"),
       idr("j3829", "emutzp8x6z64zl", True, "2026-10-04 15:43:54", "2026-10-04 15:44:01", "26307", "26307"), idr("j4861", "emuslylailsdrr", True, "2026-10-03 16:32:15", "2026-10-03 16:40:18", "4861"),
       idr("j3594", "emuu0rmot15xnj", True, "2026-10-04 16:13:32", "2026-10-04 16:13:38", "26308", "26308"), idr("b61", "emusllmujww0yu", True, "2026-10-03 16:40:47", "2026-10-03 16:59:26", "26302"),
       idr("j5000", "emutbefbslee3n", True, "2026-10-04 04:23:50", "2026-10-04 04:23:56", "26303", "26303"), idr("pc0691", "emutnfd6mjatj0", True, "2026-10-04 10:00:04", "2026-10-04 10:00:09", "26304", "26304")]
MARKS = [{"job_id": J["j4861"], "entry_id": "emuslylailsdrr", "action": "posted", "vch": "4861", "note": None, "by_user": OWNER, "at": "2026-10-03T16:41:53.886461+00:00"}]
def bill(id_, no, party, date, total, exp=None, tally=None, gone=None, doc=None, fn=None, extra=None):
    o = {"id": id_, "no": no, "party": party, "date": date, "total": total, "exportedAt": exp, "tally": tally, "goneFromTally": gone, "docPath": doc, "fileName": fn}
    o.update(extra or {}); return o
P = "efe13a47-f0fa-43be-a18c-bf32caa448ca/cmufksrrqjub2g/"
BILLS = [
 bill("emutziaksk0kad", "3916", "JITIN & CO.", "2026-10-03", 15000, "2026-10-04T21:08:38+05:30", {"at": "2026-10-04T21:08:38+05:30", "by": "Anshul garg", "vch": "26306", "guid": "", "company": G, "vchDate": "20261003", "vchType": "Journal", "masterId": ""}, None, P + "emutziaksk0kad-GARG_SHEKHAR_CO.pdf", "GARG SHEKHAR & CO.pdf · page 1", {"postByReply": True}),
 bill("emutnfd6mjatj0", "PC/26-27/0691", "PRINCE COMPUTER", "2026-09-25", 1298, "2026-10-04T15:30:04+05:30", {"at": "2026-10-04T15:30:04+05:30", "by": "Anshul garg", "vch": "26304", "guid": "", "company": G, "vchDate": "20260925", "vchType": "Journal", "masterId": ""}, None, P + "emutnfd6mjatj0-GARG_4_.pdf", "GARG (4).pdf · page 1", {"postByReply": True}),
 bill("emusi5455der9b", "2024-25/165", "VIVEK GUPTA & ASSOCIATES", "2026-09-18", 55000, None, None, None, P + "emusi5455der9b-Bill_62_BUY_BACK_OF_SHARES__VODICIPHER_GARG_SHEKHAR_COMPANY.pdf", "Bill_62_BUY BACK OF SHARES _VODICIPHER_GARG SHEKHAR & COMPANY.pdf · page 1"),
 bill("emusllmujww0yu", "61", "VIVEK GUPTA & ASSOCIATES", "2026-10-01", 45000, "2026-10-03T16:59:26.736+00:00", {"at": "2026-10-03T16:59:26.736+00:00", "by": "Anshul garg", "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066be", "company": G, "vchDate": "20261001", "vchType": "Journal", "masterId": "26302"}, "2026-10-04T06:24:38.253Z", P + "emusllmujww0yu-Bill_61_ANNUAL_FILLING_2024_GARG_SHEKHAR_COMPANY.pdf", "Bill_61_ANNUAL FILLING 2024_GARG SHEKHAR & COMPANY.pdf · page 2", {"postVerified": True, "tallyVchNo": "61"}),
 bill("emutzp8x6z64zl", "3829", "JITIN & CO.", "2023-10-02", 15000, "2026-10-04T21:13:55+05:30", {"at": "2026-10-04T21:13:55+05:30", "by": "Anshul garg", "vch": "26307", "guid": "", "company": G, "vchDate": "20231002", "vchType": "Journal", "masterId": ""}, None, P + "emutzp8x6z64zl-GSC.pdf", "GSC.pdf · page 1", {"postByReply": True}),
 bill("emuu0rmot15xnj", "3594", "JITIN & CO.", "2026-09-30", 15000, "2026-10-04T16:13:31.024Z", {"at": "2026-10-04T21:43:32+05:30", "by": "Anshul garg", "vch": "26308", "guid": "", "company": G, "vchDate": "20260930", "vchType": "Journal", "masterId": ""}, None, P + "emuu0rmot15xnj-INVOICE-2.pdf", "INVOICE-2.pdf · page 1", {"postByReply": True}),
 bill("emuqapmyusbj3e", "FA/2026-27/081", "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "2026-07-01", 123900, "2026-10-02T02:21:11.293Z", {"at": "2026-10-02T02:21:11.293Z", "by": "test@test.com", "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066b7", "company": G, "vchDate": "20260701", "vchType": "Journal", "masterId": "26295"}, "2026-10-03T03:56:18.009Z", P + "emuqapmyusbj3e-Sales_FA_2026-27_081.pdf", "Sales_FA_2026-27_081.pdf · page 1", {"postVerified": True}),
 bill("emuqip07ppksjl", "KIS/335", "KASHI I.T SOLUTIONS", "2026-07-28", 1239, "2026-10-02T05:26:24.255Z", {"at": "2026-10-02T05:26:24.255Z", "by": "test@test.com", "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066b9", "company": G, "vchDate": "20260728", "vchType": "Journal", "masterId": "26297"}, "2026-10-03T03:56:18.013Z", P + "emuqip07ppksjl-KIS335_1_.pdf", "KIS335 (1).pdf · page 1", {"postVerified": True}),
 bill("emutbefbslee3n", "5000", "JITIN & CO.", "2026-10-01", 30000, "2026-10-04T09:53:52+05:30", {"at": "2026-10-04T09:53:52+05:30", "by": "Anshul garg", "vch": "26303", "guid": "", "company": G, "vchDate": "20261001", "vchType": "Journal", "masterId": ""}, None, P + "emutbefbslee3n-INVOICE.pdf", "INVOICE.pdf · page 1", {"postByReply": True}),
 bill("emuslylailsdrr", "4861", "JITIN & CO.", "2026-01-30", 30000, "2026-10-03T16:41:53.886461+00:00", {"at": "2026-10-03T16:41:53.886461+00:00", "by": "Anshul garg", "guid": "", "company": G, "vchDate": "", "vchType": "", "masterId": ""}, None, P + "emuslylailsdrr-INVOICE.pdf", "INVOICE.pdf · page 1", {"postVerified": True}),
 bill("emuqf3q7bz0qhm", "6009", "JITIN & CO.", "2026-08-01", 15000, "2026-10-02T03:54:08.662Z", {"at": "2026-10-02T03:54:08.662Z", "by": "test@test.com", "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066b8", "company": G, "vchDate": "20260801", "vchType": "Purchase", "masterId": "26296"}, "2026-10-03T03:56:18.012Z", P + "emuqf3q7bz0qhm-GSC_1_.pdf", "GSC (1).pdf · page 1", {"postVerified": True}),
 bill("emum250ulhfbl8", "FA/ELEC/013", "FINGATE ADVISORY SERVICES PRIVATE LIMITED", "2026-07-01", 25535, "2026-09-29T03:58:55.685Z", {"at": "2026-09-29T03:58:55.685Z", "by": "test@test.com", "guid": "7c5fd9b3-7235-4cbb-b4cd-1124be599189-000066b4", "company": G, "vchDate": "20260701", "vchType": "Journal", "masterId": "26292"}, "2026-10-02T03:56:15.542Z", P + "emum250ulhfbl8-Sales_FA_ELEC_013.pdf", None, {"postVerified": True}),
]
FIXTURE = r"""async (fx) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.id = "cmufksrrqjub2g"; c.tallyName = fx.G;
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "postTo", fx.G);
  Cloud.on = () => true; Cloud.st.firm = "efe13a47-f0fa-43be-a18c-bf32caa448ca"; Cloud.st.members = [{user_id: fx.OWNER, name: "Anshul garg", email: "test@test.com", role: "owner"}];
  S.account = {me: {role: "owner", user_id: fx.OWNER, name: "Anshul garg"}, firm: {name: "Garg Shekhar & Co."}};
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "f79e4bc3-871d-4482-874d-71c5fb2a1b33", company: fx.G, daysAt: new Date().toISOString(), state: {doneTo: "20261004", skipped: []}}]};
  window.__fx = fx; window.__rpc = []; window.__asked = [];
  window.__flags = fx.flags === false ? null : [];
  TCloud.restAll = async (u) => { window.__asked.push(u);
    if (/^tally_post_jobs\?select=id,payload/.test(u)) { const ids = (u.match(/id=in\.\(([^)]*)\)/) || [])[1].split(","); return fx.jobs.filter(j => ids.includes(j.id) && j.payload).map(j => ({id: j.id, payload: j.payload})); }
    if (/^tally_post_jobs/.test(u)) return JSON.parse(JSON.stringify(fx.jobs.map(j => { const o = Object.assign({}, j); delete o.payload; return o; })));
    if (/^tally_post_ids/.test(u)) return JSON.parse(JSON.stringify(fx.ids));
    if (/^tally_post_marks/.test(u)) return JSON.parse(JSON.stringify(fx.marks));
    if (/^tally_post_row_flags/.test(u)) { if (!window.__flags) throw new Error("relation \"public.tally_post_row_flags\" does not exist (42P01)"); return JSON.parse(JSON.stringify(window.__flags.filter(f => !f.restored_at))); }
    return []; };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    if (window.__rpcHook) { const r = await window.__rpcHook(fn, a); if (r !== undefined) return r; }
    return /^tally_(want_update|post_)/.test(fn) ? {ok: true} : null; };
  Cloud.api = async () => [];
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {}; CloudJobs.dismiss = async () => {};
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    paused: false, notAnsweringSince: "", updating: false, lastRead: new Date().toISOString(), open: [fx.G], companies: [{name: fx.G, open: true, at: new Date().toISOString(), lastRead: new Date().toISOString()}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: fx.G, client_id: c.id, device_id: "d-1"}]};
  PostCheck.due = () => false; TallyProof.at[c.id] = Date.now(); TallyProof.check = async () => 0;
  await openCompany(c.id);
  fx.bills.forEach(b => { const e = newEntry("Manual entry"); e.id = b.id; Object.assign(e.x, {vendorName: b.party, vendorGstin: "", invoiceNo: b.no, invoiceDate: b.date, taxable: b.total, total: b.total});
    e.natureId = "professional"; e.partyLedger = b.party; e.expenseLedger = "Professional Fee Non Gst"; e.notDuplicate = true; S.data[c.id].entries[e.id] = e; e.status = "approved"; e.approvedAt = "2026-09-28T10:00:00Z";
    ["exportedAt", "tally", "goneFromTally", "docPath", "fileName", "postVerified", "postByReply", "tallyVchNo"].forEach(k => { if (b[k] != null) e[k] = b[k]; });
    if (b.exportedAt) e.postedVia = "bridge"; });
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 400));
  if (S.bank) S.bank.loading = false;
  window.autoPostTo = async () => {}; window.postReconcile = () => 0;
  await CloudJobs.load(true);
  render();
  return c.id;
}"""
FX = {"G": G, "OWNER": OWNER, "jobs": JOBS, "ids": IDS, "marks": MARKS, "bills": BILLS}
if __name__ == "__main__":
    serve()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        E(FIXTURE, FX); pg.wait_for_timeout(2500)
        E("() => { render(); }"); pg.wait_for_timeout(800)
        def tab(name): pg.click('#app [data-post-tabs] [data-post-tab="%s"]' % name); pg.wait_for_timeout(400)
        def row(id_):
            """the row of an entry and its tab, wherever it is: [(tab, text)]"""
            out = []
            for t in ("topost", "posted", "errors"):
                tab(t)
                for sel in ('[data-entry-row][data-row-key$=":%s"]' % id_, '[data-bill-row="%s"]' % id_, '[data-posted-entry="%s"]' % id_):
                    loc = pg.locator('#app [data-post-panel="%s"] %s' % (t, sel))
                    if loc.count():
                        out.append((t, " ".join(loc.first.inner_text().split()))); break
            return out
        def one(id_):
            r = row(id_); return (r[0] if len(r) == 1 else (None, " | ".join("%s: %s" % x for x in r))), len(r)
        NAMES = [("Bill 61", "emusllmujww0yu"), ("Jitin & Co. 4861", "emuslylailsdrr"), ("6009", "emuqf3q7bz0qhm"), ("FA/2026-27/081", "emuqapmyusbj3e"), ("FA/ELEC/013 (01-Oct posting)", "emupeho9q2sijk"),
                 ("FA/ELEC/013 (29-Sep, posted straight)", "emum250ulhfbl8"), ("KIS/335", "emuqip07ppksjl"), ("cancelled posting of 30-Sep", "zz-test-1"), ("Bill 62", "emusi5455der9b"),
                 ("04-Feb-2026 bill", "emuqtw0683g090"), ("Jitin & Co. 3829", "emutzp8x6z64zl")]
        print("---- what the page shows for each row (tab: text)")
        seen = {}
        for name, id_ in NAMES:
            (t, x), n = one(id_); seen[id_] = (t, x, n)
            print("  %-38s %s" % (name, ("%s: %s" % (t, x)) if t else ("in %d places: %s" % (n, x)) if n else "NOT SHOWN"))
        print("----")
        tx = lambda id_: seen[id_][1] or ""
        T = lambda id_: seen[id_][0]
        ok(all(seen[i][2] == 1 for _, i in NAMES), "every row the owner listed is shown, in exactly one tab (%s)" % [(n, seen[i][2]) for n, i in NAMES if seen[i][2] != 1])
        # Bill 61
        x = tx("emusllmujww0yu")
        ok("Tally id 26302" in x and "61" in x and "VIVEK GUPTA & ASSOCIATES" in x and "₹45,000.00" in x and "01-Oct-2026" in x, "F. Bill 61: Tally id 26302, with its bill no., party, amount and date (%s)" % x[:260])
        # Jitin & Co. 4861
        x = tx("emuslylailsdrr")
        ok(T("emuslylailsdrr") == "posted" and "Tally id 26301" in x and "Tally id 4861" not in x and x.startswith("Posted, marked by you") and "Tally id typed: 4861" in x,
           "F. Jitin & Co. 4861: Posted, marked by you; Tally id 26301 (what was typed, 4861, is the bill number) (%s)" % x[:300])
        tab("posted"); R4861 = '#app [data-post-panel="posted"] [data-row-key="%s:emuslylailsdrr"]' % J["j4861"]
        ok(pg.locator(R4861 + " .acts [data-correct-id]").count() == 1, "F. Jitin & Co. 4861: the owner's one action 'Correct the Tally id' is on the row")
        pg.click(R4861 + " .acts [data-correct-id]"); pg.wait_for_timeout(400)
        ok(pg.locator("#confirmBox input#markVch").input_value() == "26301", "F. 'Correct the Tally id' offers Tally's id 26301 (%s)" % pg.locator("#confirmBox input#markVch").input_value())
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(800)
        calls = [c for c in E("window.__rpc") if c[0] == "tally_post_job_mark_posted"]
        ok(calls == [["tally_post_job_mark_posted", {"p_job": J["j4861"], "p_id": "emuslylailsdrr", "p_vch": "26301", "p_note": "Correction: the Tally id is 26301, not 4861"}]],
           "F. the correction is recorded the existing way: tally_post_job_mark_posted(job, id, '26301', 'Correction: the Tally id is 26301, not 4861') (a tally_post_marks row) (%s)" % calls)
        # what the cloud then holds: the mark row, the result's voucher, the id's accepted_vch
        E("""(j) => { const fx = window.__fx; fx.marks.push({job_id: j, entry_id: "emuslylailsdrr", action: "posted", vch: "26301", note: "Correction: the Tally id is 26301, not 4861", by_user: fx.OWNER, at: new Date().toISOString()});
          const r = fx.jobs.find(x => x.id === j).results[0]; r.vchNumber = "26301"; r.message = "Marked posted by the owner on 04-Oct-2026: in Tally as voucher 26301 (Correction: the Tally id is 26301, not 4861)";
          fx.ids.find(x => x.job_id === j).accepted_vch = "26301"; PostMarks.load(S.coId, true); PostIds.load(S.coId, true); CloudJobs.load(true); }""", J["j4861"]); pg.wait_for_timeout(1500)
        tab("posted"); x = " ".join(pg.inner_text(R4861).split())
        ok("Tally id 26301" in x and "Tally id typed: 26301" in x and pg.locator(R4861 + " .acts [data-correct-id]").count() == 0, "F. corrected: 26301, nothing more to correct (%s)" % x[:240])
        # 6009, FA/2026-27/081, FA/ELEC/013, KIS/335: Posted before 04-Oct; Tally's reply was not kept, with the Tally id held
        for id_, no, tid in (("emuqf3q7bz0qhm", "6009", "26296"), ("emuqapmyusbj3e", "FA/2026-27/081", "26295"), ("emupeho9q2sijk", "FA/ELEC/013", "26294"), ("emum250ulhfbl8", "FA/ELEC/013", "26292"), ("emuqip07ppksjl", "KIS/335", "26297")):
            x = tx(id_)
            ok("Posted before 04-Oct; Tally's reply was not kept." in x and ("Tally id " + tid) in x and no in x, "F. %s (%s): 'Posted before 04-Oct; Tally's reply was not kept.' with Tally id %s (%s: %s)" % (no, id_, tid, T(id_), x[:240]))
        for id_ in ("emuqf3q7bz0qhm", "emuqapmyusbj3e", "emum250ulhfbl8", "emuqip07ppksjl"):
            ok(T(id_) == "errors" and tx(id_).startswith("Needs review") and "FinCom's copy of Tally did not show it on" in tx(id_), "F. %s: not seen by FinCom's copy of Tally since: Needs review, the owner looks in Tally (%s)" % (id_, tx(id_)[:120]))
        # emupeho9q2sijk: its bill, from the posting
        x = tx("emupeho9q2sijk")
        ok(T("emupeho9q2sijk") == "posted" and x.startswith("Bill deleted in FinCom but entry is in Tally") and "FA/ELEC/013" in x and "Fingate Advisory Services Limited" in x and "₹25,535.00" in x and "01-Jul-2026" in x and "Journal" in x and "emupeho9q2sijk" not in x,
           "F. emupeho9q2sijk: its bill (FA/ELEC/013, Fingate, 25,535.00, 01-Jul-2026, Journal) read from the posting, never the internal id in its place (%s)" % x[:260])
        ok("no longer in FinCom" in x, "F. emupeho9q2sijk: says the bill is no longer in FinCom (nothing to restore) (%s)" % x[-200:])
        # the cancelled posting of 30-Sep: Errors, status 9
        x = tx("zz-test-1")
        ok(T("zz-test-1") == "errors" and x.startswith("Cancelled") and "bill details not found" in x and "zz-test-1" in x and "Cancelled on 30-Sep-2026 22:22 IST" in x and "Cancelled before the Tally computer took it" in x,
           "F. the cancelled posting of 30-Sep: under Errors, 'Cancelled', when and why, 'bill details not found' with the id in small (%s)" % x[:260])
        # Bill 62
        x = tx("emusi5455der9b")
        ok(T("emusi5455der9b") == "errors" and x.startswith("Needs review") and "Tally id 26300" in x and "could not find it in Tally" in x and "bill no. 2024-25/62 (the bill says 2024-25/165)" in x and "date 18-Jan-2026 (the bill says 18-Sep-2026)" in x and "amount ₹21,600.00 (the bill says ₹55,000.00)" in x,
           "F. Bill 62: Needs review, Tally accepted it as 26300 and FinCom could not find it; what went to Tally differs from the bill now (%s)" % x[:420])
        tab("errors"); RB62 = '#app [data-post-panel="errors"] [data-bill-row="emusi5455der9b"]'
        ok(pg.locator(RB62 + " [data-mark-posted]").count() == 1 and pg.locator(RB62 + " [data-release-owner]").count() == 1 and pg.locator(RB62 + " [data-post-again]").count() == 0,
           "F. Bill 62: 'It is in Tally: mark posted (Tally id)' and 'It is not in Tally: release and post again', no Post again")
        # the 04-Feb-2026 bill
        x = tx("emuqtw0683g090")
        ok(T("emuqtw0683g090") == "errors" and x.startswith("Needs review") and "Tally may have this entry twice (Tally ids 26298 and 26299)" in x and "Vivek Gupta & Associates" in x and "₹50,000.00" in x and "04-Feb-2026" in x and "no longer in FinCom" in x,
           "F. the 04-Feb-2026 bill: Needs review, Tally may have it twice (26298 and 26299), the bill no longer in FinCom (%s)" % x[:360])
        # Jitin & Co. 3829
        x = tx("emutzp8x6z64zl")
        ok(T("emutzp8x6z64zl") == "posted" and x.startswith("Posted to Tally") and "Tally id 26307" in x and "voucher date in Tally 02-Oct-2023" in x and "This entry is in FY 2023-24 in Tally; change the period in Tally to see it." in x and "Tally accepted it." in x,
           "F. Jitin & Co. 3829: Tally id 26307, voucher date in Tally 02-Oct-2023, the FY 2023-24 sentence, Tally accepted it (%s)" % x[:360])
        fy_now = E("postFyNow()")
        ok(("FY " + fy_now) not in tx("emusllmujww0yu") and "change the period" not in tx("emusllmujww0yu"), "A. a voucher in this year (%s): no FY sentence" % fy_now)
        # A: the numbers as the owner reads them
        tab("posted")
        amts = E("Array.from(document.querySelectorAll('#app [data-post-panel=\"posted\"] [data-pe-amount]')).map(x => [x.textContent, getComputedStyle(x).textAlign])")
        ok(amts and all(re.match(r"^₹\d{1,2}(,\d\d)*,?\d{0,3}\.\d\d$|^₹\d{1,3}\.\d\d$", a) and al == "right" for a, al in amts), "A. amounts in the Indian format with two decimals, right-aligned (%s)" % amts[:5])
        ok(not errors, "no page errors %s" % errors[:2])
        br.close()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
