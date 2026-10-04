# Recorder trial add-on: line-by-line review

File reviewed: `bridge-go/addon/FinComRecorderTrial.tdl`. Owner's instructions: `docs/recorder-trial-sheet.txt`.

**Status: not run.** There is no Tally in the build sandbox, so this TDL has never been compiled or loaded. I wrote everything below from what I know of the TallyPrime TDL reference (Tally Solutions' "TDL Reference Manual" / help.tallysolutions.com developer pages: *Events*, *System Events*, *Import Events*, *Form attribute On*, *Function: actions SET / IF / RETURN / CALL*, *File I/O actions*, *$$LastResult*). I had no copy of those pages to check against, and the version numbers they apply to are from memory. The confidence column says how sure I am that Tally accepts each construct as written. "High" means it is common in published Tally samples. "Medium" means I remember it from the reference but have not seen it used much. "Low" means it is a guess and needs the trial to confirm it.

## Where the trial will show TDL errors (for the bridge to collect)

The owner cannot open files, so the bridge should attach these to "Recorder trial: send results":

| What | Usual path | Notes |
|---|---|---|
| TDL compile errors | `<Tally folder>\tdlerror.log`. Usually `C:\Program Files\TallyPrime\tdlerror.log`, sometimes `C:\TallyPrime\tdlerror.log` | Tally writes this file when a TDL fails to load. Find `<Tally folder>` from the running `tally.exe` process path. Fall back to the two paths shown. Also check `C:\Program Files (x86)\TallyPrime\` and any `tally.ini`-adjacent folder. |
| Import log | `<Tally folder>\tally.imp` | Shows how Tally handled the import of the FinCom test bill. |
| Tally's own settings | `<Tally folder>\tally.ini` | The `TDL=` / `User TDL=` lines show whether the add-on is set to load. Read only, never change. |
| The recorder lines | `C:\ProgramData\FinCom\recorder\<GUID>.txt` (or `name-ZZ TEST.txt`), plus `failed.txt` in the same folder | UTF-16LE (see "Character set"). |

Note: the bridge's own files live in `%ProgramData%\FinCom Bridge\` (with a space). This add-on writes to `C:\ProgramData\FinCom\recorder\`, as the brief asked, so the installer must create that folder and let the logged-in user write to it. Tally runs as the desk user, not as the service.

## Line format chosen

`FCR1|ev=…|t0=…|tw=…|cguid=…|cname=…|user=…|obj=…|guid=…|mid=…|aid=…|vtype=…|vno=…|vdate=…|name=…|parent=…|narr=…|t1=…`

- I used key=value joined with `|` because it needs only string `+` in TDL. Tabs would need a tab-character function that I am not sure exists, and JSON would need escaping that TDL cannot do reliably.
- No escaping is done. The keys always come in this fixed order, so a reader splits on the known `|key=` markers in sequence. `narr` (free text) comes second-last: take it as everything between `|narr=` and the **last** `|t1=`.
- Tally narrations can span several lines. Any line that does not start with `FCR1|` is a continuation of the line before it, joined with a newline.
- `name=` and `vno=` could in theory contain `|`. Splitting on the full marker `|parent=` and so on keeps that safe unless a name itself contains text like `|parent=`, which is accepted as a trial risk.

## Construct-by-construct

| # | Construct (lines) | Supposed to do | Confidence | If Tally rejects it / it misbehaves |
|---|---|---|---|---|
| 1 | `;;` comments | Line comments | High | None needed. |
| 2 | `[System: Formula]` `FCRIsTrial : ##SVCurrentCompany = "ZZ TEST"` | Gate: true only in ZZ TEST. TDL `=` on strings ignores case | High (system variable and formula). Medium (case-insensitivity) | Use `$$IsEqual:##SVCurrentCompany:"ZZ TEST"`, or compare `$$UpperCase:##SVCurrentCompany = "ZZ TEST"`. |
| 3 | `FCRFolder : "C:\ProgramData\FinCom\recorder\"` | Folder constant. Backslash is not an escape in TDL strings | High | If the trailing `\"` breaks parsing, end the constant without the slash and add `"\"` in the function. |
| 4 | `[System: Events]` `label : event : condition : action : param` | Register system-level event handlers | High (syntax) | None needed. |
| 5 | Events `Before Delete Object`, `After Delete Object` | Fire on delete of a voucher **or master** | Medium. The names were confirmed by Tally developer help on 03-Oct-2026 (owner item 101). Release support is not checked: they need a recent TallyPrime (I believe 2.0 or later) | An unknown event name shows as a TDL error in tdlerror.log. Comment out that one line and reload, so that the other events are still tested. |
| 6 | Events `Before Cancel Object`, `After Cancel Object` | Fire on voucher cancel (Alt+X) | Medium (same source) | As in #5. |
| 7 | Events `Start Import`, `Import Object`, `After Import Object`, `End Import` | Fire around an XML import, including XML posted to Tally's HTTP port (how FinCom posts) | Medium on the names. **Low** that `##SVCurrentCompany` is ZZ TEST during an HTTP import (the import names its target company; the "current" company may be whatever is selected on screen) | Keep only ZZ TEST open during the trial (the sheet says so). If no import lines appear, change the condition of these four lines to `Yes`. They then log for every company, so use that only on a machine where ZZ TEST is the only company. |
| 8 | `Call : FCRLog : "before_delete"` | Run the function with one string parameter | High | `Call : FCRLog : "before_delete"` is the standard form. If the parameter is not passed, drop it and use one function per event. |
| 9 | Return value of handlers | `Before …` and `Import Object` handlers might be able to stop the operation through their return value. Every path returns `Yes` so nothing is blocked | Medium (I am not sure whether Tally reads the return value at all) | If a delete, cancel or import is refused with the add-on loaded, this is the cause. Remove `Returns : Logical` and every `RETURN : Yes`, then use plain `RETURN`. |
| 10 | `[#Form: Voucher]` | Modify Tally's default voucher entry/alteration form | High that the form is named `Voucher` | If the trial shows no `voucher_accept_*` lines but the delete and cancel lines do appear, look up the default voucher form name in Tally's developer reference (default TDL, `Voucher` report) and change the `[#Form: …]` header; I have no confident second name. POS and other special voucher screens have their own forms and are not covered. |
| 11 | `[#Form: Ledger]` | Modify the ledger create/alter form | Medium (I believe the report and form are both `Ledger`) | Alternatives, in order: `[#Form: Ledger Master]`? *(guess)*, `[#Form: Ledger Alteration]`? *(guess)*. Multi-ledger alteration screens (`Multi Ledger …`) are not covered. Ledger **delete** is still caught by #5. |
| 12 | `On : Form Accept : cond : Call : …` (×2) plus `On : Form Accept : Yes : Form Accept` | Log before save, let Tally save (`Form Accept` action), log after save. Once a form has an `On : Form Accept`, the default save only happens through the `Form Accept` action, which is why it is unconditional | High for the pattern (common in "print/mail after save" samples). Medium that actions after `Form Accept` still run with the voucher or ledger as the current object | (a) **Double save**: if the default form already has its own `On : Form Accept`, the entry could be saved twice. Sheet step 2 checks the Day Book for exactly one voucher. If it appears twice, remove the middle line. (b) If `_post` lines are missing or have empty fields, only the `_pre` lines are usable. A new entry then has no GUID or MasterID yet, but alter, delete and cancel still do. (c) `Accept? Yes/No` confirmation and the `Form Accept` order: if the owner sees two Accept prompts, remove the middle line. |
| 13 | Ledger rename | Log the old name and the new name | **Not done in TDL.** I know of no method that is certain to give the pre-edit name (`$OldName` is a guess). | `_pre` logs the name as typed (the new name). The ledger's MasterID does not change on a rename, so the bridge gets the old name from the earlier line with the same `mid` (from create or alter). |
| 14 | `[Function: FCRLog]` with `Parameter`, `Variable`, `Returns`, numbered action lines `01 :` … `38 :` | Standard user-defined function | High | None needed. |
| 15 | `SET : v : expr`, `IF … END IF`, `NOT`, `RETURN : Yes` | Function actions | High | None needed. |
| 16 | `$$MachineDate`, `$$MachineTime` wrapped in `$$String:` | Wall-clock date and time for t0, tw, t1 | High that they exist. **Low on resolution**: I expect hours, minutes and seconds at best, never milliseconds. I know no TDL function that is certain to give milliseconds. | The in-add-on delay can then only show "0 s" or "1 s". The real millisecond measure must be made by the bridge: (1) the file's NTFS last-write time (100 ns resolution) for each append, and (2) the save-to-line latency when the bridge watches the file. `tw` minus `t0` shows how long building the line took and `t1` minus `tw` how long the write took, both to the second. If `$$MachineTime` prints only HH:MM, say so in the results: seconds would then be missing too. |
| 17 | `$Guid:Company:##SVCurrentCompany` | Company GUID for the file name | Medium. Company does carry a GUID in Tally's XML export, but I have not seen this method form used on Company | If empty, line 03 falls back to `name-<company name>`. That is safe for "ZZ TEST" because the gate means no other name ever reaches it. The name is **not** cleaned of characters Windows forbids in file names (`\ / : * ? " < > |`), because TDL has no simple string-replace I trust. That is acceptable only because the add-on acts on ZZ TEST alone. The real add-on needs a sanitiser. |
| 18 | `$$CmpUserName` | Tally user logged in to the company | High. It is empty when the company has no security/users | None needed. |
| 19 | PC name | Not written by the add-on | Deliberate | The file is local to the PC where Tally runs, and that PC's bridge writes the results, so the bridge adds its own `COMPUTERNAME`. This avoids a guessed `$$SysInfo:…` / `$$MachineName` parameter that could stop the whole TDL loading. |
| 20 | `$Guid`, `$MasterID`, `$AlterID`, `$VoucherTypeName`, `$VoucherNumber`, `$Date`, `$Narration`, `$Name`, `$Parent` on the current object | Heads of the voucher or ledger | High that these methods exist on Voucher / Ledger. Medium that, inside a System Event handler, the function's current object is the object being deleted, cancelled or imported | If all object fields come back empty for system events, the handler has no object context. The trial records that as a finding, and the real add-on then needs `$$Object`-style access (to research). |
| 21 | Object type guess (lines 07–13) | `Voucher` if it has a voucher type name, else `Master` if it has a name, else `None` | Medium. A method that does not apply to an object returns empty (no error) in TDL | Cannot tell ledger from group or stock item on delete. `parent` and `name` show it. The form events say "voucher_" or "ledger_" in `ev`. |
| 22 | `OPEN FILE : file : Text : Write : Unicode` | Open the holding file for writing. The 5th parameter fixes the encoding: `Unicode` (UTF-16LE, the TDL default for Text) or `ASCII` | Medium on the exact parameter list and words. **Medium-low on append**: my understanding is that `WRITE FILE` / `WRITE FILE LINE` always write at the end of the file and only `TRUNCATE FILE` empties it | **If the file keeps only the last line** (Write mode overwrites), the trial shows this as one line per file. Change the design to one file per event (`<GUID>-<seq>.txt`) or try `ReadWrite` as the mode. If `Unicode` is not accepted, drop the 5th parameter (the default is believed to be Unicode). |
| 23 | `$$LastResult` after `OPEN FILE` | True if the last action succeeded | Medium | If Tally does not set it for `OPEN FILE`, the failed.txt fallback never runs. That is harmless, because the save is not affected either way. If `$$LastResult` is unknown to this Tally (TDL error), delete lines 27–33. |
| 24 | Fallback `failed.txt` | One retry to a second file, with the intended line inside | Medium (same as #22–23) | None needed. Never a message box. |
| 25 | `WRITE FILE` then `WRITE FILE LINE` | Main part without a newline, then `\|t1=…` and the newline. t1 is taken after the main write but before the close/flush | Medium | If `WRITE FILE` (no newline) is not available, use `WRITE FILE LINE : ##vLine` and accept that `\|t1=` ends up on its own line (the reader's continuation rule already joins it). |
| 26 | `CLOSE TARGET FILE` | Close the file opened for writing | Medium | The alternative name is `CLOSE FILE`. |
| 27 | No `Message`, `Log`, `Query`, `Msg Box`, menus, keys or buttons | Silent add-on (owner rule 9) | Checked by reading the file | None needed. One risk remains: a TDL **runtime** error (for example a bad method) may make Tally itself show an error box. The trial surfaces this, and the owner is told to write down any new message. |

## Character set

`Unicode` in `OPEN FILE` means Tally's Unicode text, which is UTF-16 little-endian. The first write to a new file may add a BOM `FF FE`. The bridge should read the file as UTF-16LE whether or not a BOM is there, and it can tell from the zero high bytes on ASCII characters. To make the file plain 8-bit, change `Unicode` to `ASCII` in both `OPEN FILE` lines. Hindi or other non-Latin narration is then lost.

## Assumptions (all unverified)

1. All eight system-event names, the `On : Form Accept` event, and the `Form Accept` action exist in the TallyPrime on NWS144, and that version is recent enough for the delete and cancel events.
2. The form names are `Voucher` and `Ledger`.
3. During a system event, the `Call`ed function's current object is the voucher or master concerned.
4. During an HTTP/XML import, `##SVCurrentCompany` is ZZ TEST when ZZ TEST is the only open company.
5. Write-mode file actions append rather than overwrite.
6. `$$MachineTime` gives at least seconds. It does not give milliseconds, so millisecond delay is measured from the bridge side.
7. Tally's process (the desk user) can create and write files in `C:\ProgramData\FinCom\recorder\`, a folder created by installer 2.1.9 with write permission for Users.
8. One TDL loaded through Manage Local TDLs applies to every company on that Tally. The `FCRIsTrial` gate keeps real companies untouched. Multi-company caveat: if ZZ TEST and a real company are both open, an event on the real company's data while ZZ TEST is the *current* company would be logged into ZZ TEST's file. The sheet asks for ZZ TEST to be open alone.
9. Multi-user (item 102): each PC writes to its own local `C:\ProgramData`, so the two PCs' files are separate. The simultaneous-save test shows each PC's view only.
10. Unloading via Manage Local TDLs takes effect without a restart (the sheet says to restart Tally if it does not).

## What the trial answers

- Which of the eight system events and the two form events actually fire (a line with that `ev` appears or not).
- Whether system-event handlers see the object (fields present or empty).
- Whether an HTTP import from FinCom is seen (`start_import`, `import_object`, `after_import_object`, `end_import`).
- Whether the add-on blocks or doubles anything (owner's Day Book check, and any messages).
- The approximate added time, from t0/tw/t1 to the second, and to the millisecond from the bridge's file timestamps.


## Added on review (04-Oct-2026): the form changes are not gated by company
`[#Form: Voucher]` and `[#Form: Ledger]` gain their `On : Form Accept` lines in every company while the add-on is
loaded; only the logging is gated by `@@FCRIsTrial`. Tally's own save then runs through the unconditional
`Form Accept` line in every company. On ZZ TEST the sheet's Day Book check catches a double save. For safety the sheet
now says: keep only ZZ TEST open while it is loaded, and unload it (PART 4) before opening any real company. The real
add-on (section C) must not change any form for a company it does not record, or must be proved harmless first.
