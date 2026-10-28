# FinCom Bridge 2.4.8 (branch next-bridge-248, from staging-next d1d7c038b)

The owner approved 2.4.8 on 28-Oct-2026 ("let's do"). Nothing new is asked of Tally: no request was added and no request
shape changed. FinCom's page changes with it, on the app branch next-tally-anyport. That page keeps the old behaviour
(the page's own pin) for bridges older than 2.4.8.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.8.exe |
| Fingerprint | SHA-256 `030f430355494e4618cf08591ecc9aab564fd6ef2df422873065afe39d28d83f` (FinComBridge-Setup-2.4.8.exe, built 28-Oct-2026 23:35 IST at the commit after ce438bf9d, bridge sources 673783feb, POSTONLY=any) |
| Program | FinComBridge-2.4.8.exe, SHA-256 `910c270f6b8e9cc6d0941d0b7f6c758d4cc7de8fc527af5921ecf9c3f26a3608` |
| Replaces | 2.4.7 (kept on the computer, so the tray can roll back to it) |
| Published | not published |

## What is in 2.4.8

1. **Ledgers within seconds after a link** (cd91bcaac, kept as cut). FinCom sends Update now for a company right after
   a link (POST /keep {now, company}). If that company is not held as linked, the bridge's next cloud push asks the
   cloud's links again, once. Before, it waited for CloudLinksSec, up to 5 minutes.
2. **Tally on any port, found by itself** (bridge-go/anyport.go, ports.go):
   - Every port a TallyPrime program of this Windows user listens on is tried, whatever its number. The ports come from
     Windows' TCP listener table with each listener's process; the process must run in the owner's Windows session, as
     before. tally.ini's port is only a hint.
   - A port is kept only while it answers the light company list (TDSDeskCompanies, unchanged) as Tally, with Tally's
     XML `<ENVELOPE>`. A listener of a Tally program that answers otherwise is left out of the plan while the same
     program holds it, for 30 minutes at most.
   - Several Tallys of this user are all used. Another user's Tally is skipped as before (OnlyMySession).
   - When Windows does not let the bridge list programs, the ports the tally.ini files name are tried before
     FallbackPorts.
   - The diagnosis counts a Tally port outside 9000-9999. This ends the TallyPrime 7.2 proof's false alarm "not
     accepting connections on port 4125".
   - The help texts no longer say "port 9000".
3. **A typed port** (POST /ports/use {"port": n}; FinCom's Use this port):
   - The bridge tries 127.0.0.1:n once, with the same company list.
   - The try is under the 2-second stop, through the one-request-in-flight path, and gives way to a posting.
   - The port is kept (TallyPorts [n]) only when it answers as Tally and Windows says its listener is this user's: by
     session (the plan's own check), and by the listening process's user SID (as the bridge's own-user check).
   - Otherwise a plain reason: nothing listening, not TallyPrime, another Windows user's TallyPrime (or program),
     Windows could not tell whose, no answer within 2 seconds, a posting going on, or a bad port.
   - {"port": 0} makes the bridge automatic again. Only this Windows user's programs may call the endpoint (403
     otherwise, as for every address but /ping).
4. **The app** (next-tally-anyport): app/src/lib/tallyConnect.js typePort and app/src/parts/TallyOneClick.jsx. A 2.4.8
   bridge is asked to take the port and its plain reason is shown. An older bridge gets the page's pin as before.
5. **TestPostShapesCurrent**, which also failed on staging-next: since af08a16d9 the app's bankVoucherXml calls ledNm and
   OWN_BANK, so tests/gen_post_shapes.js stopped and the manifest kept an old hash. The generator now takes both names
   and loads server/_shared/names.js, as build.py does. Regenerated: the eight XML shapes are byte for byte the same;
   only the manifest's builder list and hash changed.

## Rules kept

- No new or changed Tally request. The allow-list table hash is unchanged (b4df290484f5…, TestAllowListUnchanged).
  The doc changed in words only: its decision line names 2.4.8, by the owner's standing decision of 2026-10-06.
- Every request to Tally takes 2 s at most, one request is in flight per Tally, and postings go first. The typed try is
  a background read with the 2-second hard stop (TestTypedPortTimeoutTwoSeconds, TestTypedPortOneInFlight).
- One bridge per Windows user: another user's Tally is never asked, whether automatic or typed
  (TestAnyPortAutoFindsOwnTallyAnyPort, TestTypedPortRefused).
- No AI in the bridge.

## Gates

Real-Tally gate: 3.0 + 7.1 by the owner's decision of 2026-10-28 (no request change). (Results below once run.)
