# TallyPrime 7.2 proof (26-Oct-2026)

Test data only, on GitHub's hosted Windows runners (Educational-mode TallyPrime, the harness's own company "FinCom Spike Co"
and ZZ BIG TEST). Nothing ran on the owner's computer or on staging. The bridge was the published 2.4.7, installed from
the setup committed in the repo (`assets-test/bridge-go/FinComBridge-Setup-2.4.7.exe`, SHA-256 69aa6b74…8799, built at
915592c4), unchanged. No new request was added to the bridge. The harness's own measuring requests (marked PROBE) are listed
at the end with their exact XML.

Runs (branch `tally-versions`, mode `proof72`): **40362606548** (7.1 and 7.2, every check), **40370144878** (7.2, the
port screen only), plus 40356645917 (7.1, an earlier attempt that stopped at the rename; its partial-batch reply is the same).
Results: `spike-results/versions/40362606548-summary.txt` and `spike-results/versions/40362606548-<release>-proof72/`
on `tally-versions` (each bridge request and Tally's answer under `versions/captures/bridge-xml/`).

## TallyPrime 7.2 itself

- Tally's own download page lists 7.2 under the folder `Rel7.2` (no dot, no `_gold`), not `Rel.7.2_gold` (that URL
  answers 403). `https://tallymirror.tallysolutions.com/download_centre/Rel7.2/TP/Full/setup.exe`: 72,347,912 bytes,
  Last-Modified 08-Oct-2026, SHA-256 55E2668A…6627, signed by Tally Solutions Pvt Ltd (valid). It installs as
  `tally.exe` 1.1.7.2; Tally's answer header says PRODMAJORREL 7, PRODMINORREL 2.
- The harness now checks 7.2 on Linux first (Rel.7.2_gold, else the folder Tally's page lists) and has 7.2 in its default
  release list.

## a. Does today's connector work on 7.2 unchanged? Yes.

| Check (bridge 2.4.7, unchanged) | 7.1 | 7.2 |
|---|---|---|
| Install, first start, finds Tally (`/status?fresh=1`) | 173 ms, port 9000, company + GUID | 179 ms, same |
| Company list (`/companies`) | listed | listed |
| Ledger list (`/ledgers`) | 6 ledgers, 329 ms | 6 ledgers, 330 ms |
| A save on the screen through the add-on (Receipt by keys) | line after 5.1 s, body 1,451 chars | line after 5.1 s, body 1,451 chars (identical) |
| Payment posted (`/import`) | ok, CREATED 1, LASTVCHID 3, 345 ms | ok, CREATED 1, LASTVCHID 3, 343 ms |
| Posting to a renamed company | ok | ok |

Differences in Tally's answers (every bridge request and answer was kept and compared after removing GUIDs, times and
Tally's CMPINFO header): TDSDeskCompanies, TDSDeskCompanyInfo, FinComCompany, TDSDeskLedgers, TDSDeskGroups,
FinComEmployees and every Import reply are **byte-identical**. The one difference: Tally 7.2's whole-voucher answer
(FinComVoucherObject) carries six new empty tags (`BUYERLEGALREGNUMISSUER`, `UAEEINVBUYERAGENCYID`,
`UAEEINVBUYERAGENCYNAME`, `UAEEINVBUYERAGENCYNUM`, `UAEEINVALLOWANCETAXEXEMPTIONREASON`,
`UAEEINVCHARGETAXEXEMPTIONREASON`, UAE e-invoicing) and PRODMINORREL 2. The bridge keeps only approved fields, so its
recorder body is identical on both releases. Nothing to change for 7.2.

## b. Port settings and tally.ini

The keys TallyPrime uses (the installer's own `tally.ini` on 7.1 and 7.2, and the files read here):

```
Client Server = None          ; "TallyPrime acts as": None / Client / Server / Both
ServerPort = 9000             ; the port
Enable ODBC Server = Yes      ; ODBC
```

- **Not measured: what TallyPrime's own screen writes.** The harness's keys reached F1 > Settings > Connectivity >
  "List of Configurations" (Client/Server configuration, Proxy Server configuration, Connectivity and timeout
  configuration) on 7.1 and 7.2, but did not open the Client/Server form (TallyPrime showed "Oops! Nothing selected"), so
  nothing was changed and tally.ini stayed as written. (In the targeted retry, 40370144878, port 9100 "listening" after
  the save was the bridge's own port, 127.0.0.1:9100, not Tally.) The key names above are TallyPrime's own (its
  installer writes them); whether the settings screen writes these same lines is still to be seen on a real screen.

- **A port written into tally.ini with Tally closed is used at the next start** (7.1 and 7.2): `Client Server = Both`,
  `ServerPort = 9102`, `Enable ODBC Server = Yes` written while Tally was closed; at start Tally answered on 9102 and not on
  9000. Tally did not rewrite the file while it ran or when it closed. So the bridge could set the port itself, while Tally
  is closed.
- With `Client Server = None` and `ServerPort = 9103`, Educational TallyPrime still answered on 9103 (7.1 and 7.2).
- **Two Tallys from one install** (one tally.ini, both want 9000): the second starts (window "TallyPrime:9000", no error)
  but does not listen; only the first answers on 9000. On a shared server with one install every user shares one
  tally.ini, so one port written there applies to every user.
- **A copy of the install** (its own folder and tally.ini, port 9001) beside the first: both start and both answer
  (9000 and 9001).

## c. Company identity (GUID)

- **Rename** (7.1 and 7.2): "FinCom Spike Co" → "FinCom Spike Co R72" by XML; the GUID did not change. Bridge 2.4.7
  listed the new name at once and posted to it (CREATED 1).
- **Copy of the data folder** (copied with Tally closed, opened by a second Tally on 9001 beside the first): **the same
  GUID** in both. The GUID alone cannot tell two copies of one company apart; the data folder (and the computer / port)
  must be part of the key.

## d. The FinCom ID on a voucher, and finding it again

Posted by the bridge's `/import`: V1 with the bridge's own narration tag (`TDSDesk:<id> | …`), V2 also with
`REMOTEID="FinCom-P72V2-<id>"` on the VOUCHER tag (the bridge passes the voucher XML through; it does not add REMOTEID
itself, and uses REMOTEID only to delete by GUID). Then each was altered on the screen (amount 500→777 / 600→888 and
" edited on screen" added to the narration).

| | 7.1 | 7.2 |
|---|---|---|
| V1 narration after the edit | `TDSDesk:P72V1… \| proof72 payment V1 edited on screen` (tag kept) | same |
| V2 GUID | Tally's own (`<company GUID>-00000004`): REMOTEID is **not** used as the GUID | same |
| V2 REMOTEID after the edit | kept, returned as `<REMOTEGUID>FinCom-P72V2-…</REMOTEGUID>` in FinComVoucherObject's answer | same |
| The add-on's lines for the edits | "altered" with the tagged narration | same |

Not measured: the narration retyped entirely (the harness's keys for that step did not save; the tag would go with the
text, REMOTEGUID would not).

Lookups (one request at a time, 2 s hard stop, Tally's window probed every 100 ms), worst of 3:

| Request | small company (9 entries) 7.1 / 7.2 | ZZ BIG TEST (30,017 entries) 7.1 / 7.2 | window held (big) |
|---|---|---|---|
| FinComVoucherObject by MasterID (allowed) | 23 / 41 ms | **7 / 9 ms** | 0 |
| FinComTag, one date (allowed) | 40 / 41 ms | **5.7 / 5.8 s** | 5.6 s |
| FinComByMaster, one date + `$MasterID` (allowed) | 39 / 31 ms | **3.4 / 3.4 s** | 3.2 s |
| PROBE by GUID, one date | 56 / 37 ms | 3.4 / 3.4 s | 3.2 s |
| PROBE by GUID, no date | 42 / 173 ms | 3.4 / 3.4 s | 3.2 s |
| PROBE object export addressed by GUID | not found | not found | 0 |

FinComTag returned all 30,017 entries on the big company: the one-date period is ignored by a collection (as found
before), so every collection with a filter reads the whole company and holds Tally's window 3–6 s. **Only
FinComVoucherObject by MasterID stays under 2 s on ~30,000 entries.** A lookup by FinCom ID or by GUID with today's
allowed forms is not safe on a large company.

## e. Partial batch (3 vouchers, the second names a missing ledger)

Tally's exact reply, identical on 7.1 and 7.2:

```
<RESPONSE><LINEERROR>Ledger &apos;P72 Missing Ledger&apos; does not exist!</LINEERROR><CREATED>2</CREATED><ALTERED>0</ALTERED>
<DELETED>0</DELETED><LASTVCHID>6</LASTVCHID><LASTMID>0</LASTMID><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>0</ERRORS>
<CANCELLED>0</CANCELLED><EXCEPTIONS>1</EXCEPTIONS></RESPONSE>
```

- The refused voucher counts under **EXCEPTIONS, not ERRORS** (ERRORS 0).
- The reply does not say which voucher failed; LASTVCHID is the MasterID of the last one created (the third).
- Bridge 2.4.7 marked all three "needs review" (accepted: true, "Tally's reply: created 2 of 3, exceptions 1: Ledger
  'P72 Missing Ledger' does not exist!").

## f. Freezes

- The bridge's own requests during a–c (29 on 7.1, 30 on 7.2): longest 34 ms, none over 2 s, never two at Tally at once,
  no window hold.
- Window holds of 1 s or more: about 2 s while the harness's keys were on TallyPrime's settings screen (the screen, not a
  request), and every whole-company collection on the 30,017-entry company (table above). No hang, no Tally restart
  needed for a request.

## Tally on port 4125 (the owner's report)

Tally on 4125 (`Client Server = Both`, `ServerPort = 4125`, `Enable ODBC Server = Yes`), bridge 2.4.7 (7.1 and 7.2, same):

| Bridge setting | Port plan | Connects (`/companies`) | Test connection (tray) | Diagnosis (`/diagnose`) |
|---|---|---|---|---|
| TallyPorts auto (the default) | auto | yes, port 4125 | "Tally: OK on port 4125" | **wrong**: "Your TallyPrime is running but is not accepting connections on port 4125 yet" |
| TallyPorts [9000] | config | yes, 4125 (its own Tally found too) | OK on 4125 | same wrong message |
| TallyPorts [4125] | config | yes | OK on 4125 | same wrong message |

- When Windows lets the bridge list programs (the runner did), 2.4.7 finds Tally on any port and connects.
- `diagnosis()` (bridge-go/ports.go) skips listeners outside 9000–9999, so it reports a working Tally on 4125 as not
  accepting connections and tells the person to change "acts as" — a false alarm.
- From the code (not reproducible on the runner): when Windows does not let the bridge list programs, `portPlan()` tries
  only FallbackPorts 9000–9005, so Tally on 4125 is **not** found unless the port is typed into TallyPorts. The tray's
  "not answering" text says "set … the port to 9000".
- Needs a bridge change (later release): diagnosis to accept any port Tally listens on; the fallback to read the port from
  tally.ini (`ServerPort`) before 9000–9005; help texts to name the port from tally.ini.

## What this means for the roadmap (reports/Stable Tally linking for FinCom.md)

| # | Item | Verdict |
|---|---|---|
| 1 | Merge the 26-Oct fixes, pause | Confirmed. 2.4.7 needs no change for 7.2. |
| 2 | Cloud link record keyed by company GUID | **Needs change**: GUID survives a rename (confirmed), but a copied data folder keeps the same GUID, so the key must be GUID + data folder (+ computer/port). |
| 3 | Cloud posting register, per-line status | **Needs change**: Tally's batch reply cannot say which voucher failed (one LINEERROR, EXCEPTIONS count, LASTVCHID of the last created). Per-line status needs either one voucher per request or a read-back of the batch's vouchers by MasterID (FinComVoucherObject) after the reply. Count EXCEPTIONS as refusals, not only ERRORS. |
| 4 | FinCom ID on each voucher + "is it in Tally?" | **Needs change**: the narration tag survives an edit that keeps the narration; REMOTEID is kept too (as REMOTEGUID, not as the GUID). But a lookup by ID/GUID needs a whole-company collection: 3–6 s with the window held on 30,000 entries. The safe check is by MasterID with FinComVoucherObject (≤9 ms), comparing the tag / REMOTEGUID in its answer; the MasterID comes from LASTVCHID (single posts) or the add-on's "created" line. No new request form is needed for that. |
| 5 | Connect page; bridge sets the port | **Confirmed with a limit**: the keys are `Client Server`, `ServerPort`, `Enable ODBC Server`; a port written with Tally closed works. But one install = one tally.ini for every user on a shared server, so a per-user port needs a per-user install copy (or Tally's own per-user setting, not found). Also fix the 4125 diagnosis/fallback first. |
| 6 | One status word | Unaffected. Note: today's "Check my Tally" diagnosis gives a false "not accepting" for ports outside 9000–9999. |
| 7 | Release rhythm, licensed Tally | Unaffected; all of this is still Educational mode. |

## PROBE requests used (harness only, never in the bridge)

Allowed forms were sent exactly as the bridge builds them at 915592c4 (FinComTag, FinComByMaster, FinComVoucherObject,
FinComCompany, the ledger list). The harness's own:

```xml
<!-- by GUID, one date: FinComByMaster's shape, the filter on GUID, the id renamed -->
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>P72ByGuid</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>FinCom Spike Co</SVCURRENTCOMPANY><SVFROMDATE>20260901</SVFROMDATE><SVTODATE>20260901</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="P72ByGuid" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISOPTIONAL, ISCANCELLED</FETCH><FILTERS>P72ByGuidOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="P72ByGuidOnly">$GUID = &#34;<guid>&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>

<!-- by GUID, no date: the same without SVFROMDATE / SVTODATE -->

<!-- object export addressed by GUID: FinComVoucherObject's shape with <ID TYPE="GUID"><guid></ID> (found nothing) -->

<!-- the company rename (test data): -->
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>FinCom Spike Co</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><COMPANY NAME="FinCom Spike Co" ACTION="Alter"><NAME>FinCom Spike Co R72</NAME><BASICCOMPANYFORMALNAME>FinCom Spike Co R72</BASICCOMPANYFORMALNAME></COMPANY></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
```

The full list with every request is in `versions/captures/p72/probes.txt` of each job.

## GitHub Actions minutes

Eight runs (including two that died on the Linux runner's full disk before any Windows job, fixed by sparse checkouts,
and two Linux-only runs while the 7.2 download folder was found): Windows 89 min (178 billed at 2x), Linux 79 min,
**about 257 billed minutes in all**. The full proof was one run of two Windows jobs (about 31 min each).
