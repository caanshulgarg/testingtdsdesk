; FinCom Bridge installer (NSIS 3). Built by bridge-go/build.sh:
;   makensis -DVERSION=2.1.0 -DFINCOM=https://staging.fincom.live/review/ -DOUTFILE=... FinComBridge.nsi
; Installs the bridge, with desktop and Start menu shortcuts and an uninstaller in Settings > Apps, in one of two ways
; (the page "Who is it for?", or /ALLUSERS or /CURRENTUSER on the command line):
;   for all users - a Windows service in Program Files; needs an administrator (see below);
;   just for me   - for a shared Tally server where the user is not an administrator: in %LOCALAPPDATA%\FinCom Bridge,
;                   recorded under HKCU, started at sign-in by HKCU\...\Run ("FinComBridge.exe user", which keeps the
;                   bridge and its tray icon running), no service.
; The setup itself asks for no administrator (RequestExecutionLevel user), so "Just for me" works for anyone, and it is
; the default unless FinCom Bridge is installed for all users already (or /ALLUSERS is given). "For all users" chosen
; without an administrator first says why one is needed, and only on Yes starts the setup again "as administrator"
; (Windows asks for the password); never a bare prompt. Silent (/S) /ALLUSERS without an administrator ends with 740.
; Two ways (the page "How should it run?", or /MODE=test|sole on the command line):
;   test - beside bridge 1.15.0: reads Tally, sends to FinCom as a shadow, never posts;
;   sole - replaces bridge 1.15.0: 1.15.0 is stopped and taken off; its pairing, settings and copy are kept and used.
; Every step, and every failure with its reason, goes to %LOCALAPPDATA%\FinCom Bridge\install.log of the user running
; the setup (FinComBridge.exe install writes there too, and install-result.txt: "ok", or what went wrong and what to do).
; The last page says the outcome; on a failure it offers to send install.log to FinCom ("FinComBridge.exe sendlog").
; Uninstall: /S silent, /KEEPPAIRING keeps this computer's pairing with FinCom.
Unicode true
Target amd64-unicode
!ifndef VERSION
  !define VERSION "2.1.0"
!endif
!ifndef FINCOM
  !define FINCOM "https://staging.fincom.live/review/"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\dist\FinComBridge-Setup.exe"
!endif
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComBridge"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define BRIDGEKEY "SOFTWARE\FinCom\Bridge"

Name "FinCom Bridge ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\FinCom Bridge"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "FinCom"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "FinCom Bridge"
VIAddVersionKey "CompanyName" "FinCom"
VIAddVersionKey "FileDescription" "FinCom Bridge setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "FinCom"

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
!include "WinMessages.nsh"

Var Mode
Var OldFound
Var RadioTest
Var RadioSole
Var Scope       ; "all" (the Windows service) or "user" (just for me)
Var IsAdmin     ; 1 when this setup runs as administrator
Var ModeAsked   ; the /MODE= given on the command line
Var RadioAll
Var RadioMe
Var LogDir      ; %LOCALAPPDATA%\FinCom Bridge of the user running the setup: install.log, install-result.txt
Var UserName    ; the Windows user running the setup
Var Failed      ; 0: installed and answering; 1: not installed; 2: installed but not running
Var FinTitle    ; the last page
Var FinText
Var RunText
Var Why         ; what went wrong (line 1 of install-result.txt) and what to do (line 2)
Var WhatToDo
Var KeepPairing ; uninstall: 1 keeps this computer's pairing with FinCom
Var KeepBox

!define MUI_ICON "fincom.ico"
!define MUI_UNICON "fincom.ico"
!define MUI_WELCOMEPAGE_TITLE "FinCom Bridge ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This connects TallyPrime on this computer with FinCom.$\r$\n$\r$\nIt runs just for you without an administrator (it starts when you sign in), or as a Windows service for all users (needs an administrator). Either way it starts again by itself if it ever stops, and an icon near the clock shows whether it is working.$\r$\n$\r$\nIt works for the Windows user signed in now and uses only the Tally running in that user's login.$\r$\n$\r$\nThis is a test build for FinCom's staging site, not signed yet: Windows may warn about it."
; the last page says what happened (FinishShow): installed and running, or not, with the reason
!define MUI_FINISHPAGE_TITLE "$FinTitle"
!define MUI_FINISHPAGE_TITLE_3LINES
!define MUI_FINISHPAGE_TEXT "$FinText"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "$RunText"
!define MUI_FINISHPAGE_RUN_FUNCTION FinishRun
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the install log"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenInstallLog
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
Page custom ScopePage ScopeLeave
Page custom ModePage ModeLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH
UninstPage custom un.KeepPage un.KeepLeave
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; --- the install log: one line with its time, in $LogDir\install.log (the setup's and the uninstaller's own steps)
!macro LogLineFunction un
Function ${un}LogLine
  Exch $R9
  Push $R8
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  ${If} $LogDir != ""
    CreateDirectory "$LogDir"
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
    ClearErrors
    FileOpen $R8 "$LogDir\install.log" a
    ${IfNot} ${Errors}
      FileSeek $R8 0 END
      FileWrite $R8 "$2-$1-$0 $4:$5:$6  Setup: $R9$\r$\n"
      FileClose $R8
    ${EndIf}
  ${EndIf}
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R8
  Pop $R9
FunctionEnd
!macroend
!insertmacro LogLineFunction ""
!insertmacro LogLineFunction "un."
!macro LogCall text
  Push `${text}`
  !ifdef __UNINSTALL__
    Call un.LogLine
  !else
    Call LogLine
  !endif
!macroend
!define Log `!insertmacro LogCall`

; who runs the setup, as what, on which Windows: the first lines of the log
!macro WhoLine un
Function ${un}LogWho
  ; with the current user's context, $LOCALAPPDATA is this user's own folder (from Windows, not the environment)
  SetShellVarContext current
  StrCpy $LogDir "$LOCALAPPDATA\FinCom Bridge"
  StrCpy $IsAdmin "0"
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    StrCpy $IsAdmin "1"
  ${EndIf}
  UserInfo::GetName
  Pop $UserName
  ${If} $UserName == ""
    ReadEnvStr $UserName USERNAME
  ${EndIf}
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  ReadRegStr $2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuild"
  ReadRegStr $3 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "DisplayVersion"
  StrCpy $4 ""
  ${If} $2 >= 22000
    StrCpy $4 " (Windows 11)"
  ${EndIf}
  StrCpy $0 "no"
  ${If} $IsAdmin == "1"
    StrCpy $0 "yes"
  ${EndIf}
  ${GetParameters} $5
  ${Log} "FinCom Bridge ${VERSION} $6 started: $1 $3 build $2$4; user $UserName; administrator: $0; command line: $5"
FunctionEnd
!macroend

!insertmacro WhoLine ""
!insertmacro WhoLine "un."

Function .onInit
  StrCpy $6 "setup"
  Call LogWho
  ${IfNot} ${RunningX64}
    ${Log} "FAILED: this Windows is not 64-bit"
    MessageBox MB_ICONSTOP "FinCom Bridge needs 64-bit Windows (Windows 10 or 11, or Windows Server 2016 or later)." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $OldFound "0"
  IfFileExists "$LOCALAPPDATA\TDS Desk Bridge\TDSBridge.ps1" 0 +2
    StrCpy $OldFound "1"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/MODE=" $R1
  StrCpy $ModeAsked $R1
  ; who it is for: asked on the command line, else as installed before, else just for me
  StrCpy $Scope ""
  ClearErrors
  ${GetOptions} $R0 "/ALLUSERS" $R1
  ${IfNot} ${Errors}
    StrCpy $Scope "all"
  ${Else}
    ClearErrors
    ${GetOptions} $R0 "/CURRENTUSER" $R1
    ${IfNot} ${Errors}
      StrCpy $Scope "user"
    ${EndIf}
  ${EndIf}
  ${If} $Scope == ""
    ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
    ReadRegStr $1 HKLM "${UNKEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $Scope "user"
    ${ElseIf} $1 != ""
      StrCpy $Scope "all"
    ${Else}
      StrCpy $Scope "user"
    ${EndIf}
  ${EndIf}
  Call ApplyScope
  ; without pages (/S) the choice is final here
  ${If} ${Silent}
    ${If} $Scope == "all"
    ${AndIf} $IsAdmin != "1"
      ${Log} "FAILED (exit 740): installing for all users (/ALLUSERS) needs an administrator, and this setup runs as $UserName, who is not one (or not elevated). Nothing was installed. Run it without /ALLUSERS (just for this user), or as an administrator."
      SetErrorLevel 740
      Quit
    ${EndIf}
    Call ScopeConflict
    ${If} $0 != ""
      ${Log} "FAILED: $0"
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${Log} "Silent install: $Scope, $Mode mode, into $INSTDIR"
  ${EndIf}
FunctionEnd

; the folder, the shortcuts' place, and the bridge's way of working (test or sole) as installed before for this scope
Function ApplyScope
  ${If} $Scope == "all"
    SetShellVarContext all
    StrCpy $INSTDIR "$PROGRAMFILES64\FinCom Bridge"
  ${Else}
    SetShellVarContext current
    StrCpy $INSTDIR "$LOCALAPPDATA\FinCom Bridge"
  ${EndIf}
  StrCpy $Mode $ModeAsked
  ${If} $Mode == ""
  ${AndIf} $Scope == "all"
    ReadRegStr $Mode HKLM "${BRIDGEKEY}" "Mode"
  ${ElseIf} $Mode == ""
    ReadRegStr $Mode HKCU "${BRIDGEKEY}" "Mode"
  ${EndIf}
  ${If} $Mode == ""
    ${If} $OldFound == "1"
      StrCpy $Mode "test"
    ${Else}
      StrCpy $Mode "sole"
    ${EndIf}
  ${EndIf}
FunctionEnd

; one install per computer and user: the service and an install just for me would both answer on the same port.
; $0: why this choice cannot be installed now ("" when it can)
Function ScopeConflict
  StrCpy $0 ""
  ${If} $Scope == "user"
    ReadRegStr $1 HKLM "${UNKEY}" "InstallLocation"
    ${If} $1 != ""
      StrCpy $0 "FinCom Bridge is already installed for all users of this computer (as a Windows service).$\r$\n$\r$\nTo install it just for you, an administrator first removes that one in Settings > Apps."
    ${EndIf}
  ${Else}
    ReadRegStr $1 HKCU "${UNKEY}" "InstallLocation"
    ${If} $1 != ""
      StrCpy $0 "FinCom Bridge is already installed just for you on this computer.$\r$\n$\r$\nTo install it for all users, first remove that one in Settings > Apps."
    ${EndIf}
  ${EndIf}
  ${If} $0 != ""
  ${AndIfNot} ${Silent}
    MessageBox MB_ICONEXCLAMATION "$0"
  ${EndIf}
FunctionEnd

; for all users without an administrator: why, and the choice. Yes: this setup is started again as administrator
; (Windows asks for the password) and this one ends. No: back to the page with "Just for me" chosen. $0: "1" on No
Function AskForAdmin
  StrCpy $0 ""
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Installing for all users needs an administrator, and this setup is running as $UserName, who is not one.$\r$\n$\r$\nChoose No to install just for you (recommended, no administrator needed).$\r$\n$\r$\nChoose Yes only if you can type an administrator's password: Windows will then ask for it." IDYES yes
    ${Log} "For all users without an administrator: the person chose No (just for me)"
    StrCpy $0 "1"
    Return
  yes:
  ${Log} "For all users without an administrator: the person chose Yes; the setup starts again as administrator"
  ${GetParameters} $R0
  ClearErrors
  ExecShell "runas" "$EXEPATH" "$R0 /ALLUSERS"
  ${If} ${Errors}
    ${Log} "Windows did not start the setup as an administrator (cancelled, or no administrator's password)"
    MessageBox MB_ICONEXCLAMATION "Windows did not start the setup as an administrator, so FinCom Bridge cannot be installed for all users.$\r$\n$\r$\nChoose $\"Just for me$\" to install it without an administrator."
    StrCpy $0 "1"
  ${Else}
    Quit
  ${EndIf}
FunctionEnd

Function ScopePage
  !insertmacro MUI_HEADER_TEXT "Who is it for?" "Just for you without an administrator, or as a Windows service for everyone."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "&Just for me (no administrator needed, recommended)"
  Pop $RadioMe
  ${NSD_CreateLabel} 12u 13u 95% 30u "Installed in your own folder ($LOCALAPPDATA\FinCom Bridge). Starts when you sign in to Windows and runs while you are signed in; it starts the bridge again by itself if it stops. Also for a shared Tally server where you are not an administrator."
  Pop $0
  ${NSD_CreateRadioButton} 0 52u 100% 12u "For &all users (Windows service)"
  Pop $RadioAll
  ${If} $IsAdmin == "1"
    ${NSD_CreateLabel} 12u 65u 95% 30u "Installed in Program Files. Starts with Windows, also before anyone signs in, and Windows starts it again if it stops."
  ${Else}
    ${NSD_CreateLabel} 12u 65u 95% 30u "Installed in Program Files. Starts with Windows, also before anyone signs in, and Windows starts it again if it stops. Needs an administrator's password ($UserName is not an administrator)."
  ${EndIf}
  Pop $0
  ${If} $Scope == "all"
    ${NSD_Check} $RadioAll
  ${Else}
    ${NSD_Check} $RadioMe
  ${EndIf}
  nsDialogs::Show
FunctionEnd
Function ScopeLeave
  ${NSD_GetState} $RadioAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Scope "all"
  ${Else}
    StrCpy $Scope "user"
  ${EndIf}
  Call ScopeConflict
  ${If} $0 != ""
    ${Log} "Not possible: $0"
    Abort
  ${EndIf}
  ${If} $Scope == "all"
  ${AndIf} $IsAdmin != "1"
    Call AskForAdmin
    ${If} $0 == "1"
      StrCpy $Scope "user"
      ${NSD_Uncheck} $RadioAll
      ${NSD_Check} $RadioMe
    ${EndIf}
    Abort
  ${EndIf}
  Call ApplyScope
FunctionEnd

Function ModePage
  !insertmacro MUI_HEADER_TEXT "How should it run?" "Only one bridge may ever post to Tally."
  nsDialogs::Create 1018
  Pop $0
  ${If} $OldFound == "1"
    ${NSD_CreateLabel} 0 0 100% 24u "Bridge 1.15.0 (PowerShell) is installed on this computer for you."
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 24u "Bridge 1.15.0 (PowerShell) was not found for you on this computer."
  ${EndIf}
  Pop $0
  ${NSD_CreateRadioButton} 0 28u 100% 12u "&Test beside bridge 1.15.0"
  Pop $RadioTest
  ${NSD_CreateLabel} 12u 41u 95% 30u "Reads Tally and sends to FinCom's staging site only to be compared with bridge 1.15.0. It never posts: postings keep going through bridge 1.15.0. Bridge 1.15.0 is not changed. Later, its icon's menu can make it the main bridge."
  Pop $0
  ${NSD_CreateRadioButton} 0 76u 100% 12u "&Replace bridge 1.15.0 (FinCom Bridge becomes the main bridge)"
  Pop $RadioSole
  ${NSD_CreateLabel} 12u 89u 95% 30u "Bridge 1.15.0 is stopped and no longer starts. Its pairing with FinCom, its settings and its copy of the books are kept and used by FinCom Bridge, which then also posts."
  Pop $0
  ${If} $Mode == "sole"
    ${NSD_Check} $RadioSole
  ${Else}
    ${NSD_Check} $RadioTest
  ${EndIf}
  nsDialogs::Show
FunctionEnd
Function ModeLeave
  ${NSD_GetState} $RadioSole $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Mode "sole"
  ${Else}
    StrCpy $Mode "test"
  ${EndIf}
FunctionEnd

; --- the program's files into $INSTDIR. $Why: what went wrong ("" when they are there)
Function PutFiles
  StrCpy $Why ""
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\setup-write-test.tmp" w
  ${If} ${Errors}
    StrCpy $Why "The folder $INSTDIR cannot be written by $UserName."
    StrCpy $WhatToDo "Choose $\"Just for me$\" (your own folder), or ask an administrator to install FinCom Bridge for all users."
    Return
  ${EndIf}
  FileClose $0
  Delete "$INSTDIR\setup-write-test.tmp"
  ; the program, if a bridge did not stop: moved aside (Windows allows that for a running program) so the new one fits
  Delete "$INSTDIR\FinComBridge.setup-old.exe"
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ClearErrors
    Rename "$INSTDIR\FinComBridge.exe" "$INSTDIR\FinComBridge.setup-old.exe"
    ${If} ${Errors}
      StrCpy $Why "FinComBridge.exe in $INSTDIR is in use and could not be replaced."
      StrCpy $WhatToDo "Right-click the FinCom icon near the clock and choose Quit (or restart the computer), then run the setup again."
      Return
    ${EndIf}
    Delete "$INSTDIR\FinComBridge.setup-old.exe"
  ${EndIf}
  SetOutPath "$INSTDIR"
  SetOverwrite try
  File "..\dist\FinComBridge.exe"
  File "fincom.ico"
  File "README.txt"
  SetOverwrite on
  ${IfNot} ${FileExists} "$INSTDIR\FinComBridge.exe"
    StrCpy $Why "FinComBridge.exe could not be written in $INSTDIR (in use, or blocked by an antivirus)."
    StrCpy $WhatToDo "Restart the computer and run the setup again; if an antivirus blocked it, allow FinCom Bridge there."
    Return
  ${EndIf}
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall FinCom Bridge.exe"
  ${If} ${Errors}
    ${Log} "The uninstaller could not be written in $INSTDIR (the install goes on)"
  ${EndIf}
  ${Log} "Files written in $INSTDIR"
FunctionEnd

; FinComBridge.exe install, and its result: $Failed, $Why and $WhatToDo (install-result.txt: line 1 and line 2)
Function RunInstall
  Exch $R0 ; the command line
  Delete "$LogDir\install-result.txt"
  ${Log} "Running: $R0"
  ClearErrors
  ExecWait '$R0' $0
  ${If} ${Errors}
    StrCpy $Failed "1"
    StrCpy $Why "FinComBridge.exe could not be started (an antivirus may have blocked it)."
    StrCpy $WhatToDo "Allow FinCom Bridge in the antivirus, then run the setup again."
    ${Log} "FAILED: $Why"
    Pop $R0
    Return
  ${EndIf}
  StrCpy $Why ""
  StrCpy $WhatToDo ""
  ClearErrors
  FileOpen $1 "$LogDir\install-result.txt" r
  ${IfNot} ${Errors}
    FileRead $1 $Why
    FileRead $1 $WhatToDo
    FileClose $1
  ${EndIf}
  ; the line ends taken off
  ${TrimNewLines} $Why $Why
  ${TrimNewLines} $WhatToDo $WhatToDo
  ${If} $0 == 0
    StrCpy $Failed "0"
    ${Log} "FinComBridge.exe install: done, the bridge answers"
  ${Else}
    ${If} $0 == 4
      StrCpy $Failed "2"
    ${Else}
      StrCpy $Failed "1"
    ${EndIf}
    ${If} $Why == ""
    ${OrIf} $Why == "ok"
      StrCpy $Why "FinComBridge.exe install ended with code $0."
      StrCpy $WhatToDo "Run the setup again; if it fails again, send the install log to FinCom."
    ${EndIf}
    ${Log} "FAILED (code $0): $Why $WhatToDo"
  ${EndIf}
  Pop $R0
FunctionEnd

Section "FinCom Bridge"
  StrCpy $Failed "1"
  ${Log} "Installing: $Scope, $Mode mode, into $INSTDIR, as $UserName"
  ${If} $Scope == "user"
    Call InstallJustForMe
  ${Else}
    Call InstallForAll
  ${EndIf}
  Call SetFinish
  ; silent: the exit code says it (0 installed and running, 4 installed but not answering, else not installed)
  ${If} $Failed == "2"
    SetErrorLevel 4
  ${ElseIf} $Failed != "0"
    SetErrorLevel 1
  ${EndIf}
SectionEnd

; for all users: the Windows service, as before
Function InstallForAll
  SetRegView 64
  SetShellVarContext all
  ; the service stops (and the tray icons close) before the program is replaced
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ExecWait '"$INSTDIR\FinComBridge.exe" stop'
    nsExec::Exec 'taskkill.exe /F /IM FinComBridge.exe'
    Pop $0
  ${EndIf}
  Call PutFiles
  ${If} $Why != ""
    StrCpy $Failed "1"
    ${Log} "FAILED: $Why"
    Return
  ${EndIf}

  CreateShortcut "$DESKTOP\FinCom Bridge.lnk" "$INSTDIR\FinComBridge.exe" "tray" "$INSTDIR\fincom.ico" 0 SW_SHOWNORMAL "" "FinCom Bridge: status and menu"
  CreateDirectory "$SMPROGRAMS\FinCom Bridge"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\FinCom Bridge.lnk" "$INSTDIR\FinComBridge.exe" "tray" "$INSTDIR\fincom.ico" 0 SW_SHOWNORMAL "" "FinCom Bridge: status and menu"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\FinCom Bridge log.lnk" "$INSTDIR\FinComBridge.exe" "log" "$INSTDIR\fincom.ico"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\Uninstall FinCom Bridge.lnk" "$INSTDIR\Uninstall FinCom Bridge.exe"
  ${If} $Mode == "test"
    CreateShortcut "$SMPROGRAMS\FinCom Bridge\Compare with bridge 1.15.0.lnk" "$INSTDIR\FinComBridge.exe" "compare --show" "$INSTDIR\fincom.ico"
  ${Else}
    Delete "$SMPROGRAMS\FinCom Bridge\Compare with bridge 1.15.0.lnk"
  ${EndIf}

  ; Windows Settings > Apps
  WriteRegStr HKLM "${UNKEY}" "DisplayName" "FinCom Bridge"
  WriteRegStr HKLM "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNKEY}" "Publisher" "FinCom"
  WriteRegStr HKLM "${UNKEY}" "DisplayIcon" "$INSTDIR\fincom.ico"
  WriteRegStr HKLM "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall FinCom Bridge.exe"'
  WriteRegStr HKLM "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall FinCom Bridge.exe" /S'
  WriteRegStr HKLM "${UNKEY}" "URLInfoAbout" "${FINCOM}"
  WriteRegDWORD HKLM "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNKEY}" "EstimatedSize" "$0"
  ${Log} "Shortcuts and the Apps entry (all users) written"

  ; the service, the user it works for, the settings (and, in the final install, bridge 1.15.0 taken off)
  DetailPrint "Setting up the FinCom Bridge service ($Mode)..."
  Push '"$INSTDIR\FinComBridge.exe" install --mode $Mode --fincom "${FINCOM}"'
  Call RunInstall
FunctionEnd

; just for me: no service, nothing outside this user's folders and HKCU; the program sets the start at sign-in and starts
Function InstallJustForMe
  SetShellVarContext current
  ; this user's bridge stops (and its icon closes) before the program is replaced; only this user's processes are touched
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ExecWait '"$INSTDIR\FinComBridge.exe" stop --per-user'
    nsExec::Exec 'cmd.exe /c taskkill.exe /F /IM FinComBridge.exe /FI "USERNAME eq %USERNAME%"'
    Pop $0
  ${EndIf}
  Call PutFiles
  ${If} $Why != ""
    StrCpy $Failed "1"
    ${Log} "FAILED: $Why"
    Return
  ${EndIf}

  ; "user" starts the bridge if it is not running (as at sign-in), and shows the icon or its status
  CreateShortcut "$DESKTOP\FinCom Bridge.lnk" "$INSTDIR\FinComBridge.exe" "user" "$INSTDIR\fincom.ico" 0 SW_SHOWNORMAL "" "FinCom Bridge: status and menu"
  CreateDirectory "$SMPROGRAMS\FinCom Bridge"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\FinCom Bridge.lnk" "$INSTDIR\FinComBridge.exe" "user" "$INSTDIR\fincom.ico" 0 SW_SHOWNORMAL "" "FinCom Bridge: status and menu"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\FinCom Bridge log.lnk" "$INSTDIR\FinComBridge.exe" "log" "$INSTDIR\fincom.ico"
  CreateShortcut "$SMPROGRAMS\FinCom Bridge\Uninstall FinCom Bridge.lnk" "$INSTDIR\Uninstall FinCom Bridge.exe"
  ${If} $Mode == "test"
    CreateShortcut "$SMPROGRAMS\FinCom Bridge\Compare with bridge 1.15.0.lnk" "$INSTDIR\FinComBridge.exe" "compare --show" "$INSTDIR\fincom.ico"
  ${Else}
    Delete "$SMPROGRAMS\FinCom Bridge\Compare with bridge 1.15.0.lnk"
  ${EndIf}

  ; Windows Settings > Apps, for this user only
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "FinCom Bridge (just for me)"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "FinCom"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\fincom.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall FinCom Bridge.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall FinCom Bridge.exe" /S'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "${FINCOM}"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" "$0"
  ${Log} "Shortcuts and the Apps entry (this user) written"

  ; the settings, the start at sign-in (HKCU Run) and the start now (and, in the final install, bridge 1.15.0 taken off)
  DetailPrint "Setting up FinCom Bridge just for you ($Mode)..."
  Push '"$INSTDIR\FinComBridge.exe" install --per-user --mode $Mode --fincom "${FINCOM}"'
  Call RunInstall
FunctionEnd

; --- the last page: what happened, and the next step
Function SetFinish
  ${If} $Failed == "0"
    StrCpy $FinTitle "FinCom Bridge ${VERSION} is installed and running"
    StrCpy $0 "Main bridge: reading and posting"
    StrCpy $1 ""
    ${If} $Mode == "test"
      StrCpy $0 "Test mode: reading only, not posting"
      StrCpy $1 ", Switch to main bridge"
    ${EndIf}
    StrCpy $FinText "Look for the FinCom icon near the clock. Right-click it for Open FinCom, Test connection, Show log$1.$\r$\n$\r$\n$0.$\r$\n$\r$\nNot there? Click the ^ arrow near the clock: drag the FinCom icon from there onto the taskbar."
    StrCpy $RunText "Open FinCom"
    ${Log} "Finished: installed and running ($Mode mode)"
  ${Else}
    ${If} $Failed == "2"
      StrCpy $FinTitle "FinCom Bridge was installed but is not running"
    ${Else}
      StrCpy $FinTitle "FinCom Bridge was not installed"
    ${EndIf}
    StrCpy $FinText "$Why $WhatToDo$\r$\n$\r$\nThe details are in $LogDir\install.log."
    StrCpy $RunText "Send install log to FinCom"
    ${Log} "Finished: $FinTitle"
  ${EndIf}
FunctionEnd

Function FinishShow
  ; on success there is no log to open
  ${If} $Failed == "0"
    ShowWindow $mui.FinishPage.ShowReadme ${SW_HIDE}
  ${EndIf}
FunctionEnd

Function FinishRun
  ${If} $Failed == "0"
    ExecShell "open" "${FINCOM}"
    Return
  ${EndIf}
  ${Log} "Send install log to FinCom: chosen on the last page"
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ; sendlog says itself whether it was sent (or opens FinCom's Tally page when this computer was never connected)
    Exec '"$INSTDIR\FinComBridge.exe" sendlog --fincom "${FINCOM}"'
  ${Else}
    ExecShell "open" "${FINCOM}#/tally"
    ExecShell "open" "explorer.exe" '/select,"$LogDir\install.log"'
    MessageBox MB_ICONINFORMATION "The Tally page in FinCom has opened: drop install.log (shown in the folder) on 'Send an install log'."
  ${EndIf}
FunctionEnd

Function OpenInstallLog
  ExecShell "open" "$LogDir\install.log"
FunctionEnd

; --- uninstall
; which install this uninstaller belongs to: just for me when this user's record names its folder; the service's needs an
; administrator: the reason and the choice first (silent: exit 740 and the reason in the log), never a bare prompt
Function un.onInit
  StrCpy $6 "uninstaller"
  Call un.LogWho
  SetRegView 64
  StrCpy $KeepPairing "0"
  ${un.GetParameters} $R0
  ClearErrors
  ${un.GetOptions} $R0 "/KEEPPAIRING" $R1
  ${IfNot} ${Errors}
    StrCpy $KeepPairing "1"
  ${EndIf}
  StrCpy $Scope "all"
  ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} $0 == $INSTDIR
    StrCpy $Scope "user"
    Return
  ${EndIf}
  ${If} $IsAdmin != "1"
    ${If} ${Silent}
      ${Log} "FAILED (exit 740): FinCom Bridge in $INSTDIR is installed for all users (a Windows service); removing it needs an administrator, and this runs as $UserName, who is not one. Nothing was removed."
      SetErrorLevel 740
      Quit
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "FinCom Bridge is installed for all users of this computer (as a Windows service). Removing it needs an administrator, and this is running as $UserName, who is not one.$\r$\n$\r$\nChoose No to stop here: nothing is removed.$\r$\n$\r$\nChoose Yes only if you can type an administrator's password: Windows will then ask for it." IDYES yes
      ${Log} "Uninstall for all users without an administrator: the person chose No; nothing was removed"
      Quit
    yes:
    StrCpy $1 ""
    ${If} $KeepPairing == "1"
      StrCpy $1 "/KEEPPAIRING"
    ${EndIf}
    ClearErrors
    ExecShell "runas" "$INSTDIR\Uninstall FinCom Bridge.exe" "$1"
    ${If} ${Errors}
      ${Log} "Windows did not start the uninstaller as an administrator; nothing was removed"
      MessageBox MB_ICONEXCLAMATION "Windows did not start the uninstaller as an administrator, so FinCom Bridge was not removed."
    ${EndIf}
    Quit
  ${EndIf}
FunctionEnd

Function un.KeepPage
  !insertmacro MUI_HEADER_TEXT "Remove FinCom Bridge" "The program, its start, its shortcuts and its own files are removed."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 36u "FinCom Bridge, its service or start at sign-in, its shortcuts and its own files (its copy of the books, its log and settings) are removed. Bridge 1.15.0's files are not touched; if FinCom Bridge replaced it, bridge 1.15.0's program is put back."
  Pop $0
  ${NSD_CreateCheckbox} 0 44u 100% 24u "&Keep this computer's pairing with FinCom (so a later install connects without a new code)"
  Pop $KeepBox
  ${If} $KeepPairing == "1"
    ${NSD_Check} $KeepBox
  ${EndIf}
  nsDialogs::Show
FunctionEnd
Function un.KeepLeave
  ${NSD_GetState} $KeepBox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $KeepPairing "1"
  ${Else}
    StrCpy $KeepPairing "0"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetRegView 64
  StrCpy $1 ""
  ${If} $KeepPairing == "1"
    StrCpy $1 " --keep-pairing"
  ${EndIf}
  ${Log} "Removing FinCom Bridge ($Scope) from $INSTDIR; keep the pairing: $KeepPairing"
  ${If} $Scope == "user"
    SetShellVarContext current
    ExecWait '"$INSTDIR\FinComBridge.exe" uninstall --per-user$1' $0
    nsExec::Exec 'cmd.exe /c taskkill.exe /F /IM FinComBridge.exe /FI "USERNAME eq %USERNAME%"'
    Pop $2
    DeleteRegValue HKCU "${RUNKEY}" "FinCom Bridge"
    DeleteRegKey HKCU "${BRIDGEKEY}"
  ${Else}
    SetShellVarContext all
    ExecWait '"$INSTDIR\FinComBridge.exe" uninstall$1' $0
    nsExec::Exec 'taskkill.exe /F /IM FinComBridge.exe'
    Pop $2
    DeleteRegKey HKLM "${BRIDGEKEY}"
  ${EndIf}
  ${Log} "FinComBridge.exe uninstall ended with code $0; this user's FinCom Bridge processes ended"
  Sleep 1000
  Delete "$DESKTOP\FinCom Bridge.lnk"
  Delete "$SMPROGRAMS\FinCom Bridge\*.lnk"
  RMDir "$SMPROGRAMS\FinCom Bridge"
  ${Log} "Removed the shortcuts (desktop, Start menu)"
  Delete "$INSTDIR\FinComBridge.exe"
  Delete "$INSTDIR\FinComBridge.old.exe"
  Delete "$INSTDIR\FinComBridge.new.exe"
  Delete "$INSTDIR\FinComBridge.failed.exe"
  Delete "$INSTDIR\FinComBridge.setup-old.exe"
  Delete "$INSTDIR\update-pending.json"
  Delete "$INSTDIR\update-undone.json"
  Delete "$INSTDIR\fincom.ico"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall FinCom Bridge.exe"
  ; just for me, $INSTDIR is also where install.log lives: the folder goes only when empty
  RMDir "$INSTDIR"
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ${Log} "FinComBridge.exe could not be removed from $INSTDIR (still running?); it goes at the next restart"
    Delete /REBOOTOK "$INSTDIR\FinComBridge.exe"
  ${Else}
    ${Log} "Removed the program files from $INSTDIR"
  ${EndIf}
  ${If} $Scope == "user"
    DeleteRegKey HKCU "${UNKEY}"
  ${Else}
    DeleteRegKey HKLM "${UNKEY}"
  ${EndIf}
  ${Log} "Removed the Apps entry; FinCom Bridge is removed"
SectionEnd
