; FinCom Bridge installer (NSIS 3). Built by bridge-go/build.sh:
;   makensis -DVERSION=2.0.0 -DFINCOM=https://staging.fincom.live/review/ -DOUTFILE=... FinComBridge.nsi
; Installs the bridge as a Windows service, with desktop and Start menu shortcuts and an uninstaller in Settings > Apps.
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

Name "FinCom Bridge ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\FinCom Bridge"
RequestExecutionLevel admin
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
!define MUI_WELCOMEPAGE_TEXT "This connects TallyPrime on this computer with FinCom.$\r$\n$\r$\nIt runs as a Windows service: it starts with Windows and starts again by itself if it ever stops. An icon near the clock shows whether it is working.$\r$\n$\r$\nIt works for the Windows user signed in now and uses only the Tally running in that user's login.$\r$\n$\r$\nThis is a test build for FinCom's staging site, not signed yet: Windows may warn about it."
!define MUI_FINISHPAGE_TITLE "FinCom Bridge is running"
!define MUI_FINISHPAGE_TEXT "The icon near the clock is green when the bridge reaches your Tally and FinCom.$\r$\n$\r$\nRight-click it for Open FinCom, Pause, Restart, Show log and Check for updates."
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the notes"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

Var Mode
Var OldFound
Var RadioTest
Var RadioSole

!insertmacro MUI_PAGE_WELCOME
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
  ${GetParameters} $R0
  ${GetOptions} $R0 "/MODE=" $R1
  StrCpy $Mode $R1
  ${If} $Mode == ""
    ReadRegStr $Mode HKLM "SOFTWARE\FinCom\Bridge" "Mode"
  ${EndIf}
  ${If} $Mode == ""
    ${If} $OldFound == "1"
      StrCpy $Mode "test"
    ${Else}
      StrCpy $Mode "sole"
    ${EndIf}
  ${EndIf}
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

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  ExecWait '"$INSTDIR\FinComBridge.exe" uninstall'
  nsExec::Exec 'taskkill.exe /F /IM FinComBridge.exe'
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
  DeleteRegKey HKLM "${UNKEY}"
SectionEnd
