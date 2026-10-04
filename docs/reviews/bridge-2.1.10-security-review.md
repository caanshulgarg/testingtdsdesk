# Security review: FinCom Bridge 2.1.10

Reviewed: 04-Oct-2026. I read the diff 9e390bf..f780856 hunk by hunk (bridge-go/, docs/recorder-trial-sheet.txt,
docs/bridge-2.1.10-test-sheet.txt, docs/tally-allowlist.md, tests/fixtures/beat-2.1.10.json), alongside the code review
of the same range (bridge-2.1.10-code-review.md). Its findings 1 to 4 have a security or privacy edge and are listed
first here.

Checks:
- go vet (Linux, Windows): clean.
- go test ./...: green.
- The round 21 and light-check tests: green under -race.
- release_check_test.sh: green.

Confirmations were throwaway tests in a scratchpad copy of bridge-go/; nothing was added to the repo.

Threat focus:
- Since 2.1.10 the trial tools act on any company, real books included. The owner's guards are:
  - (a) owner only, through FinCom's per-computer switch arriving as `trialTools` in the beat answer;
  - (b) a yes/no that names the company, and TRIAL marks on anything that adds entries.
- Can anything other than a true from FinCom's cloud turn the tools on: local config, /tray routes, a web page, or a
  forged cloud answer?
- Can a company name, which now comes from Tally's open list, make the bridge lock, read or name a file outside the
  recorder folder?
- What the any-company add-on records, who can read it, and where it is sent.
- The beat's new fields.
- Whether a read is reachable while Paused that the owner's rules forbid.
- Whether the bridge can be crashed.

## Findings

- S1 (MEDIUM, owner's guard (a); code review finding 1). The switch does not turn off when the "off" cannot arrive.
  - trialTools changes only on a 200 answer with JSON (cloud.go:682-683). These leave the tools on until the bridge
    restarts:
    - a failed beat;
    - a revoked key (401);
    - the cloud link turned off (POST /cloudlink {off:true}, which a FinCom page holding the bridge key may send);
    - the link moved elsewhere.
  - Anyone at that computer can stop the owner's "off" from arriving, for example by blocking the bridge's outbound
    HTTPS or unlinking it.
  - Confirmed with a throwaway test: after the cloud was closed and after unlinking, trialTools stayed true.
  - Fix before build: off on every beat that does not give a 200 with JSON, and on a link change or unlink.

- S2 (MEDIUM, privacy; code review finding 2). Installing 2.1.10 silently widens an add-on that is still loaded.
  - Every install, and every service's first start after an update, rewrites
    C:\ProgramData\FinCom\addon\FinComRecorderTrial.tdl (folders.go:123-133). This happens on every computer that takes
    2.1.10, not only the trial computer.
  - A Tally that still has the 2.1.9 file in its Local TDL list now records every company's saves. Nobody chose this,
    and the new sheet has not been read.
  - Fix before build:
    - a new file name for the any-company add-on, so the old ZZ TEST-only file is left as it is;
    - a test-sheet step to unload any 2.1.9 add-on before installing.

- S3 (MEDIUM, privacy; code review finding 3). The recorder folder now holds real books, and "send results" ships them
  without naming them.
  - What a line holds: narration, voucher number and date, party and ledger names, master names and parents, and the
    Tally user name.
  - Since 2.1.10 that is true for whichever company is current while the add-on is loaded: real clients, or a company
    not linked to FinCom at all.
  - Who can read it: the 2.1.9 install ACL gives Users (OI)(IO)M on the files in recorder\. On a computer shared by
    several Windows users, each can read every company's lines, including companies whose Tally security would hide
    them. This was harmless with ZZ TEST.
  - Where it goes: "Recorder trial: send results" zips every *.txt there (up to 50 files, 32 MB) with no yes/no and
    sends it to FinCom support. That includes files any user planted, which was already true in 2.1.9 and is bounded
    and regular-files-only since the 2.1.9 fixes.
  - Fix before build:
    - the send previews the company named in each file and asks;
    - both sheets say what is recorded and that every Windows user of the computer can read the folder.
  - Later (may): the add-on records only the company whose GUID the owner chose for the trial. The bridge could write
    that GUID into a one-line file in addon\ (administrators only), and the TDL could compare against it. This puts a
    technical limit back without a name check. It needs the TDL to read a file at load time, which has not been tried
    on a real Tally.

- S4 (MEDIUM, availability; code review finding 4). The company-info map is shared without a lock.
  - getCoInfo (ports.go:305-331) reads and writes the map from every caller of openCompaniesWith. 2.1.10 adds the
    light check's goroutine, which now runs while Paused too.
  - A concurrent map read and write is a fatal Go runtime error that no recover catches, so the bridge process exits.
    It is triggered by FinCom's page (/status) and the beat at the same moment a company is first seen.
  - Confirmed under -race.
  - This is not an attacker-steerable bug, but a crash in the middle of a posting.
  - Fix before build: a mutex, not held during the Tally request.

- S5 (LOW, owner's guard (a): how much the cloud's word is trusted). This is a note, not a code fault.
  - The bridge believes `trialTools` from whatever CloudUrl names. invokeCloud sends to that URL with Go's default TLS
    verification against the system roots, through HTTP(S)_PROXY from the environment.
  - /cloudlink accepts only FinCom's two Supabase functions (live, and the test site). A 127.0.0.1 address is accepted
    only when TDSBRIDGE_FAKE names an existing file, which is a process environment variable set by whoever starts the
    bridge.
  - So a web page, or a forged answer from the network, cannot turn the tools on without breaking TLS.
  - Not a boundary against the computer's own Windows user:
    - The settings file lives in the bridge's Home, the installing user's %LOCALAPPDATA%\TDS Desk Bridge. That user can
      point CloudUrl at a server of their own. CloudUrl read from the file is not checked against the /cloudlink
      pattern.
    - On a per-user install, the bridge runs as that user. The user can add a root to their own certificate store,
      set HTTPS_PROXY, and answer `trialTools: true` while relaying everything else.
    - That user already holds the bridge key and Tally itself. They can post through /import or work in Tally
      directly, so the trial tools give them nothing new.
    - The switch therefore expresses the owner's intent. It is not an access control against the desk user.
  - The test-site link: /cloudlink also accepts the test site's function. A FinCom page holding the bridge key, plus a
    test-site key that the test site accepts, can relink the bridge there. That firm's owner on the test site could
    then switch the tools on.
    - Linking to the test site already sends the books there; that exposure is older and larger than this one.
    - The link change is logged, and the live cloud sees the bridge go silent.
  - Defence in depth (may):
    - at start, apply the /cloudlink pattern to CloudUrl read from the file (unless TDSBRIDGE_FAKE), and log and refuse
      anything else;
    - S1's fix turns the tools off on any link change.

- S6 (LOW; code review finding 8). The yes/no that names the company is the tray's alone.
  - POST /tray/recorder-bench without `preview` starts 100 entries at once.
  - Only a program with the bridge key can send it; a web page is refused twice: the /tray/ gate, then the route's own
    Origin and Sec-Fetch check.
  - Such a program can already post through /import.
  - Fix (may): a one-time preview token bound to the company.

- S7 (LOW; code review finding 6). The log grows faster than the comments say.
  - The skip de-duplication is defeated by changing error text, and its map is never trimmed.
  - "Unchanged" lines run every 10 minutes per open company.
  - Not a security fault. The 500-line support tail fills with light-check lines on a computer with many companies.

## Found safe

- The only writer of trialTools is applyTrialTools on the beat answer, and only the JSON boolean true turns it on.
  - No settings key, route, file or command line sets it. It is kept in memory only, so it is off at every start.
  - The tray's menu and the five routes read the same value.
  - The beat reports it back to FinCom, so the owner sees the state.
- The five trial routes keep the web-page refusal and add the switch:
  - /tray/readtest (POST, GET);
  - /tray/recorder-lock;
  - /tray/recorder-bench (POST, preview, GET);
  - /tray/recorder-send;
  - /tray/recorder-note.
  The global /tray/ gate refuses any Origin or Sec-Fetch header before the key is checked. Off: 403 with the words, and
  nothing is sent to Tally (TestTrialToolsSwitch).
- Company names from Tally's list never reach a path the bridge opens.
  - The 30 s lock opens recorder\<held GUID>.txt only. Before that come recorderDirChecked (no link or junction at
    FinCom\ or recorder\, admin-owned on a service install, final path equal to the expected one), plainFileName on the
    GUID, Lstat regular and not a reparse point, and lockExclusive's handle checks (regular, SameFile, one name).
  - recorderHolding (recorderSeen in the beat, for every open company now) uses "name-"+company only when there is no
    "/", "\", ":" or "..", inside the checked folder, with Lstat only. It reads only the modification time.
  - The bench puts the name only in esc()'d XML (SVCURRENTCOMPANY), guards the GUID (guardCompanyGUID), and obeys
    PostOnly.
  - The add-on's own "name-" fallback writes as the Tally user. A company name with ".." there lets a desk user write
    where they already can, with no bridge privilege involved.
- While Paused, only undated light requests go: TDSDeskCompanies, TDSDeskCompanyInfo on first sight, and
  FinComCompany.
  - The central datedRefused still refuses any period with ReadDays off.
  - A FinCom stop and the self-stop still stop the light check, and readStopRefuses stops it again in invokeTally.
  - A posting still goes first (postingGoing, the yield after the lock, preemption).
- The beat's new fields:
  - companies[] adds guid, altvchid, altmstid and recorderSeen for open companies that are not kept;
  - trialTools.
  Company names were already sent in open[]. GSTIN and PAN are not sent, and neither are figures or narrations. Tally
  company GUIDs and change counts are not secrets. The fixture holds only the firm's own company name and test GUIDs.
- The allow-list is unchanged: hash green, TestNoComputedFigure green. Only the decision line names 2.1.10. No request
  shape changed.
- No new secret, no new outbound host, and no new file written outside the bridge's own folders. trialTools is not
  persisted.

## Fix before build (must)

S1, S2, S3, S4. The code review's "Fix before build" has the minimal fixes and the tests.

## Later (may)

- S5: check CloudUrl against FinCom's addresses at start.
- S6: a preview token for the bench.
- S7: log volume.
- S3's technical limit: the add-on records only the chosen company's GUID, once tried on a real Tally.

## Fixed (04-Oct-2026, test first; not committed)

The code review's "Fixed" section has the detail; tests in bridge-go/round22_test.go.
- S1: the trial tools turn off at once on any heartbeat that is not a 200 answer with JSON, while the computer is not
  connected, on unlink and before any new link (trialToolsOff). TestTrialToolsOffWithoutAnswer.
- S2: the any-company add-on is addon\FinComRecorderAnyCompany.tdl; FinComRecorderTrial.tdl is never given the
  any-company gate (a 2.1.9 copy left byte for byte, anything else put back to the 2.1.9 ZZ TEST-only text, none made
  where none was); both sheets have the unload step before installing. TestAddonUpgradeLeavesOldFileAlone.
- S3: "send results" previews the companies named in the recorder lines and what a line holds, and sends only with the
  tray's confirm after its yes/no; both sheets say what is recorded and that the recorder folder is readable by every
  Windows user on this PC. TestRecorderSendPreviewNamesCompanies.
- S4: coInfoMu around every access to the company-info map, not held during the Tally request. TestCoInfoConcurrent
  (-race).
- S6: the bench starts only with the tray's confirm flag (not a one-time token). TestTrialBenchNeedsConfirm.
- S7, in part: skip lines keyed on the reason's class, old keys dropped, "unchanged" at most once an hour per company.
  TestLightSkipOncePerClass.
- Also: the bench counts as a posting going (TestLightCheckYieldsToBench); the company list is marked fresh only when
  given afresh (TestLightCompanyListRetriedAfterGivingWay).
- Not changed: S5 (CloudUrl checked at start), S3's GUID-limited add-on.

## Review of the fixes (f780856..d42c3dc)

Reviewed 04-Oct-2026, alongside the code review's section of the same name, which has the detail and the
confirmations. Checks at d42c3dc: go vet (Linux, Windows) clean; go test -count=1 ./... green; the
Light|CoInfo|Round21|Round22|Trial tests green under -race; release_check_test.sh green.

Each fix against its finding:
- S1: closed, with the narrow window in S9.
  - Off on every beat that is not a 200 answer with JSON, and on every beat turn while the computer is not connected.
  - Off first on unlink and on any link attempt, refused ones included.
  - Only `trialTools == true` turns the tools on.
  - /tray/status and the beat read the live value. Each of the five routes re-checks it, so a stale tray menu gives a
    403, not an action.
- S2: closed. No path in the binary writes the any-company gate under FinComRecorderTrial.tdl.
  - The embedded 2.1.9 text equals the 2.1.9 build's file byte for byte (sha256 at 9e390bf and 2aa42bd). An identical
    file is not opened for writing. Anything else is removed by name and recreated with O_EXCL in the admin-only
    addon\, so a link is never followed. None is made where none was.
  - A failed write (for example the file held open) is logged, and the install goes on.
  - The new file goes through the same writeFresh in the folder that safeFolder and setACL have just checked.
- S3: closed, with the residue in S10.
  - The send is refused without `confirm: true`. The preview reads through the same recorderReadAll path the send uses
    (recorderDirChecked, then readShared, with the same bounds).
  - Both sheets say what a line holds and that every Windows user of the PC can read the recorder folder.
- S4: closed. coInfoMu covers every access, is never held across the Tally request, and nests no other lock.
- S6 and S7 (in part): as stated. No regression found.

Findings:

- S8. MEDIUM (regression, CI; code review R1). .github/workflows/bridge-windows.yml:349 still requires
  ProgramData\FinCom\addon\FinComRecorderTrial.tdl after a fresh all-users install. The fix correctly makes none there,
  so the real-Windows install test fails at that line and never reaches the ACL and fctest checks that guard the
  recorder folder.
  - Fix before build: check FinComRecorderAnyCompany.tdl, and check that the old name is absent.

- S9. LOW (owner's guard (a); code review R2). A beat already sent to the old cloud when /cloudlink turns the link off
  or changes it can switch the tools back on by that cloud's answer.
  - The tools then stay on until the next beat turn: at most 30 s after an unlink, or until the first beat to the new
    cloud.
  - Confirmed with a throwaway test.
  - Not exploitable beyond S5's note: whoever can unlink already holds the bridge key.
  - Fix (may): a link generation that is checked before applying a beat answer, and off in beatLoop's recover.

- S10. LOW (privacy; code review R3). The "send results" yes/no can understate what is sent.
  - Non-FCR1 text in the recorder files, such as planted or damaged lines, goes in the zip unnamed.
  - The files are read again at the confirm, so a company whose lines appear while the yes/no is open is sent
    unnamed.
  - Fix (may): count the other lines in the preview, and have the send refuse when the set of names it reads differs
    from the one shown.

- S11. LOW (privacy; code review R4). On a computer that ran a pre-release 2.1.10, a failed restore of the old file
  name after an auto-update is not retried, because the version marker is written anyway. The any-company text then
  stays under the old name.
  - Fix (may): do not write the marker when the restore failed.

Verdict:
- No High.
- S8 must be fixed before building (a two-line workflow change; no Go change).
- S9 to S11 may wait.
- The code review's R5 (GSTIN or PAN cached empty for 6 h) is not a security issue.

Range: 9e390bf..d42c3dc
