# FinCom Bridge 2.5.1 (branch bridge-stock-2411, from bridge-dated-ledgers 25e694c0a, bridge 2.5.0)

The owner's decision of 30-Oct-2026 ("1"): the stock from Tally ONLY when a person clicks, with the request measured on
30-Oct-2026 (tally-versions mode stockp, tally-versions 51fe89998, results 960d5b047, run 41009967960), C1
"FinComStockInHand", exactly:

`<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComStockInHand</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">{from}</SVFROMDATE><SVTODATE TYPE="Date">{to}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComStockInHand" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>NAME, OPENINGBALANCE, CLOSINGBALANCE</FETCH><FILTERS>FinComStockInHandOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComStockInHandOnly">$ReservedName = &#34;Stock-in-Hand&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`

Version: 2.5.1. (The plan said 2.4.11 after 2.4.10; the base branch bridge-dated-ledgers had become 2.5.0 by the time this
work started, so the next number is 2.5.1; the branch keeps its planned name.)

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.5.1.exe |
| Fingerprint | filled in at the build (compare with the .sha256 file next to the setup) |
| Replaces | 2.5.0 (not published) / 2.4.9 (published) |
| Published | not published |

## What is in 2.5.1

1. One request added, FinComStockInHand (bridge-go/stock.go), built exactly as above; on the allow-list "allowed for 2.5.1
   by the owner's decision of 2026-10-30 (person's click only)"; pinned to its builder (one byte more is refused).
2. Sent ONLY for a person's click of "Bring stock from Tally" / "Ask Tally again" on the Financial statements' stock panel:
   FinCom's cloud wakes ONE computer, the company's own ("stock" {company, from, to, at, again} on its channel; its
   heartbeat's answer carries the same click for 10 minutes, until answered); each click taken once by its time; a click
   while another of the same company is being answered gets "busy" at once. Nothing else in the bridge sends it: no background
   read, no schedule, no retry loop.
3. At most one request per company and period: the answer is kept (in the bridge, and per book and period in FinCom's cloud,
   tally_stock_reads); a click for a kept period gets the kept answer; "Ask Tally again" asks once more.
4. A hard 2 s stop from the send; one request in flight (the one Tally lock); postings first (a posting going: the click
   waits for it, 20 s at most, nothing sent meanwhile); only this Windows user's own Tally with the company open.
5. Over 2 s, or Tally's window held 2 s or more while the request was at Tally: nothing more is asked of that company until
   the next click, and FinCom shows "Tally took too long; type the stock or try again later".
6. The no-computed-figure test's narrow exception and the ReadDays / dated-request exemption are for exactly this id, as
   built, and the exemption only while a click's request is in flight; any other period, company or byte is refused before
   anything is sent, whoever asks and whatever ReadDays says.
7. Cloud (migration 134, tally-ingest): {kind:"wake", what:"stock", client, from, to, again} from a signed-in member;
   {kind:"stock"} from the bridge, taken only against the click FinCom sent (its time; once), the company's GUID the
   book's; a click on its way (60 s) is not doubled.
8. App: the stock panel's bar "Opening stock ₹X · Closing stock ₹Y · from Tally at 15:42 IST"; the figures used by the
   statements before last year's balance sheet and a typed figure (those stay the fallback; a figure typed after Tally's
   answer is used over it); kept for the client (b.fs.stockTally).

## Measured (the allow-list row)

stockp, run 41009967960, TallyPrime 3.0 and 7.1, 4,000 items with godowns and batches, 32,000 entries over two years: a
period's first ask 1.37 s worst, window held 0.97 s; the first request after Tally started 2.37 s, window held 2.05 s (the
bridge stops it at 2 s and says so); asked again 2 ms; the opening and closing equal Tally's per-item total for every
period, whatever the Gateway's period.

## Known limits

- The first click after Tally starts on a large company can take Tally over 2 s (cold); the panel then says so and the
  next click ("Ask Tally again") is answered from Tally's own cache in milliseconds.
- The click goes through FinCom's cloud only (as "Read the ledgers again" from another computer); the browser's local
  bridge is not asked directly.

## Deploy order (the owner)

migration-134-stock-from-tally.sql; deploy tally-ingest; the app; publish the setup.
