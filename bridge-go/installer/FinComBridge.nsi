; FinCom Bridge installer (NSIS 3). Built by bridge-go/build.sh:
;   makensis -DVERSION=2.0.0 -DFINCOM=https://staging.fincom.live/review/ -DOUTFILE=... FinComBridge.nsi
; Installs the bridge, with desktop and Start menu shortcuts and an uninstaller in Settings > Apps, in one of two ways
; (the page "Who is it for?", or /ALLUSERS or /CURRENTUSER on the command line):
;   for all users - a Windows service in Program Files; needs an administrator (Windows asks for one, see below);
;   just for me   - for a shared Tally server where the user is not an administrator: in %LOCALAPPDATA%\FinCom Bridge,
;                   recorded under HKCU, started at sign-in by HKCU\...\Run ("FinComBridge.exe user", which keeps the
;                   bridge and its tray icon running), no service.
; The setup itself asks for no administrator (RequestExecutionLevel user), so "Just for me" works for anyone. When
; "For all users" is chosen without one, the setup starts itself again "as administrator" (Windows asks) with /ALLUSERS.
; Default: as installed before (HKCU, then HKLM); else for all users when the setup runs as administrator, else just for me.
; Two ways (the page "How should it run?", or /MODE=test|sole on the command line):
;   test - beside bridge 1.15.0: reads Tally, sends to FinCom as a shadow, never posts;
;   sole - replaces bridge 1.15.0: 1.15.0 is stopped and taken off; its pairing, settings and copy are kept and used.
Unicode true
Target amd64-unicode
!ifndef VERSION
  !define VERSION "2.0.0"
!endif
!ifndef FINCOM
  !define FINCOM "https://staging.fincom.live/review/"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\dist\FinComBridge-Setup.exe"
!endif
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FinComBridge"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

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

!define MUI_ICON "fincom.ico"
!define MUI_UNICON "fincom.ico"
!define MUI_WELCOMEPAGE_TITLE "FinCom Bridge ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This connects TallyPrime on this computer with FinCom.$\r$\n$\r$\nIt runs as a Windows service for all users (needs an administrator), or just for you without an administrator (on a shared Tally server): it then starts when you sign in. Either way it starts again by itself if it ever stops, and an icon near the clock shows whether it is working.$\r$\n$\r$\nIt works for the Windows user signed in now and uses only the Tally running in that user's login.$\r$\n$\r$\nThis is a test build for FinCom's staging site, not signed yet: Windows may warn about it."
!define MUI_FINISHPAGE_TITLE "FinCom Bridge is running"
!define MUI_FINISHPAGE_TEXT "The icon near the clock is green when the bridge reaches your Tally and FinCom.$\r$\n$\r$\nRight-click it for Open FinCom, Pause, Restart, Show log and Check for updates."
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the notes"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

Var Mode
Var OldFound
Var RadioTest
Var RadioSole
Var Scope     ; "all" (the Windows service) or "user" (just for me)
Var IsAdmin   ; 1 when this setup runs as administrator
Var ModeAsked ; the /MODE= given on the command line
Var RadioAll
Var RadioMe

!insertmacro MUI_PAGE_WELCOME
Page custom ScopePage ScopeLeave
Page custom ModePage ModeLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "FinCom Bridge needs 64-bit Windows (Windows 10 or 11, or Windows Server 2016 or later)."
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $OldFound "0"
  IfFileExists "$LOCALAPPDATA\TDS Desk Bridge\TDSBridge.ps1" 0 +2
    StrCpy $OldFound "1"
  ; running as administrator (elevated): only then can the service be set up
  StrCpy $IsAdmin "0"
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    StrCpy $IsAdmin "1"
  ${EndIf}
  ${GetParameters} $R0
  ${GetOptions} $R0 "/MODE=" $R1
  StrCpy $ModeAsked $R1
  ; who it is for: asked on the command line, else as installed before, else by whether this runs as administrator
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
    ${ElseIf} $IsAdmin == "1"
      StrCpy $Scope "all"
    ${Else}
      StrCpy $Scope "user"
    ${EndIf}
  ${EndIf}
  Call ApplyScope
  ; without pages (/S) the choice is final here
  ${If} ${Silent}
    Call ScopeConflict
    ${If} $0 != ""
      Abort
    ${EndIf}
    ${If} $Scope == "all"
    ${AndIf} $IsAdmin != "1"
      Call RunAsAdmin
      Abort
    ${EndIf}
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
    ReadRegStr $Mode HKLM "SOFTWARE\FinCom\Bridge" "Mode"
  ${ElseIf} $Mode == ""
    ReadRegStr $Mode HKCU "SOFTWARE\FinCom\Bridge" "Mode"
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
    MessageBox MB_ICONEXCLAMATION "$0" /SD IDOK
  ${EndIf}
FunctionEnd

; for all users without an administrator: this setup is started again as administrator (Windows asks); this one ends
Function RunAsAdmin
  ${GetParameters} $R0
  ClearErrors
  ExecShell "runas" "$EXEPATH" "$R0 /ALLUSERS"
  ${If} ${Errors}
    MessageBox MB_ICONEXCLAMATION "Windows did not start the setup as an administrator, so FinCom Bridge cannot be installed for all users.$\r$\n$\r$\nChoose $\"Just for me$\" to install it without an administrator." /SD IDOK
  ${Else}
    Quit
  ${EndIf}
FunctionEnd

Function ScopePage
  !insertmacro MUI_HEADER_TEXT "Who is it for?" "As a Windows service for everyone, or just for you without an administrator."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 0 100% 12u "For &all users (Windows service)"
  Pop $RadioAll
  ${If} $IsAdmin == "1"
    ${NSD_CreateLabel} 12u 13u 95% 30u "Installed in Program Files. Starts with Windows, also before anyone signs in, and Windows starts it again if it stops."
  ${Else}
    ${NSD_CreateLabel} 12u 13u 95% 30u "Installed in Program Files. Starts with Windows, also before anyone signs in, and Windows starts it again if it stops. Needs an administrator: Windows asks for one."
  ${EndIf}
  Pop $0
  ${NSD_CreateRadioButton} 0 48u 100% 12u "&Just for me (no administrator needed)"
  Pop $RadioMe
  ${NSD_CreateLabel} 12u 61u 95% 40u "Installed in your own folder ($LOCALAPPDATA\FinCom Bridge). Starts when you sign in to Windows and runs while you are signed in; it starts the bridge again by itself if it stops. For a shared Tally server where you are not an administrator."
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
    Abort
  ${EndIf}
  ${If} $Scope == "all"
  ${AndIf} $IsAdmin != "1"
    Call RunAsAdmin
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
  ${NSD_CreateLabel} 12u 41u 95% 30u "Reads Tally and sends to FinCom's staging site only to be compared with bridge 1.15.0. It never posts: postings keep going through bridge 1.15.0. Bridge 1.15.0 is not changed."
  Pop $0
  ${NSD_CreateRadioButton} 0 76u 100% 12u "&Replace bridge 1.15.0 (FinCom Bridge becomes the only bridge)"
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

Section "FinCom Bridge"
  ${If} $Scope == "user"
    Call InstallJustForMe
    Return
  ${EndIf}
  ; for all users: the Windows service, as before
  SetRegView 64
  SetShellVarContext all
  ; the service stops (and the tray icons close) before the program is replaced
  IfFileExists "$INSTDIR\FinComBridge.exe" 0 +3
    ExecWait '"$INSTDIR\FinComBridge.exe" stop'
    nsExec::Exec 'taskkill.exe /F /IM FinComBridge.exe'
  SetOutPath "$INSTDIR"
  File "..\dist\FinComBridge.exe"
  File "fincom.ico"
  File "README.txt"
  WriteUninstaller "$INSTDIR\Uninstall FinCom Bridge.exe"

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

  ; the service, the user it works for, the settings (and, in the final install, bridge 1.15.0 taken off)
  DetailPrint "Setting up the FinCom Bridge service ($Mode)..."
  ExecWait '"$INSTDIR\FinComBridge.exe" install --mode $Mode --fincom "${FINCOM}"' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "The FinCom Bridge service could not be set up (code $0).$\r$\n$\r$\nThe details are in C:\ProgramData\FinCom Bridge\install.log. Send that file to FinCom support."
  ${EndIf}
SectionEnd

; just for me: no service, nothing outside this user's folders and HKCU; the program sets the start at sign-in and starts
Function InstallJustForMe
  SetShellVarContext current
  ; this user's bridge stops (and its icon closes) before the program is replaced; only this user's processes are touched
  ${If} ${FileExists} "$INSTDIR\FinComBridge.exe"
    ExecWait '"$INSTDIR\FinComBridge.exe" stop --per-user'
    nsExec::Exec 'cmd.exe /c taskkill.exe /F /IM FinComBridge.exe /FI "USERNAME eq %USERNAME%"'
  ${EndIf}
  SetOutPath "$INSTDIR"
  File "..\dist\FinComBridge.exe"
  File "fincom.ico"
  File "README.txt"
  WriteUninstaller "$INSTDIR\Uninstall FinCom Bridge.exe"

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

  ; the settings, the start at sign-in (HKCU Run) and the start now (and, in the final install, bridge 1.15.0 taken off)
  DetailPrint "Setting up FinCom Bridge just for you ($Mode)..."
  ExecWait '"$INSTDIR\FinComBridge.exe" install --per-user --mode $Mode --fincom "${FINCOM}"' $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "FinCom Bridge could not be set up (code $0).$\r$\n$\r$\nThe details are in $LOCALAPPDATA\FinCom Bridge\install.log. Send that file to FinCom support." /SD IDOK
  ${EndIf}
FunctionEnd

; which install this uninstaller belongs to: just for me when this user's record names its folder; the service's needs an
; administrator, so it starts itself again as one (Windows asks)
Function un.onInit
  SetRegView 64
  StrCpy $Scope "all"
  ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} $0 == $INSTDIR
    StrCpy $Scope "user"
    Return
  ${EndIf}
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 != "Admin"
    StrCpy $1 ""
    ${If} ${Silent}
      StrCpy $1 "/S"
    ${EndIf}
    ClearErrors
    ExecShell "runas" "$INSTDIR\Uninstall FinCom Bridge.exe" "$1"
    ${If} ${Errors}
      MessageBox MB_ICONEXCLAMATION "FinCom Bridge is installed for all users (as a Windows service); removing it needs an administrator." /SD IDOK
    ${EndIf}
    Quit
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetRegView 64
  ${If} $Scope == "user"
    SetShellVarContext current
    ExecWait '"$INSTDIR\FinComBridge.exe" uninstall --per-user'
    nsExec::Exec 'cmd.exe /c taskkill.exe /F /IM FinComBridge.exe /FI "USERNAME eq %USERNAME%"'
    DeleteRegValue HKCU "${RUNKEY}" "FinCom Bridge"
  ${Else}
    SetShellVarContext all
    ExecWait '"$INSTDIR\FinComBridge.exe" uninstall'
    nsExec::Exec 'taskkill.exe /F /IM FinComBridge.exe'
  ${EndIf}
  Sleep 1000
  Delete "$DESKTOP\FinCom Bridge.lnk"
  Delete "$SMPROGRAMS\FinCom Bridge\*.lnk"
  RMDir "$SMPROGRAMS\FinCom Bridge"
  Delete "$INSTDIR\FinComBridge.exe"
  Delete "$INSTDIR\FinComBridge.old.exe"
  Delete "$INSTDIR\FinComBridge.new.exe"
  Delete "$INSTDIR\FinComBridge.failed.exe"
  Delete "$INSTDIR\update-pending.json"
  Delete "$INSTDIR\update-undone.json"
  Delete "$INSTDIR\fincom.ico"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall FinCom Bridge.exe"
  RMDir "$INSTDIR"
  ${If} $Scope == "user"
    DeleteRegKey HKCU "${UNKEY}"
  ${Else}
    DeleteRegKey HKLM "${UNKEY}"
  ${EndIf}
SectionEnd
