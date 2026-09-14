; ============================================================
; ManufacturingERP — Windows NSIS installer
; Compiled natively on Linux with Debian's makensis (NSIS 3.08)
;   cwd: desktop-dist/
;   NSISDIR=/tmp/nsis-root/usr/share/nsis makensis -V2 ..\electron\installer.nsi
; Packs the full contents of desktop-dist/win-unpacked and produces
; download/ManufacturingERP-Setup.exe
; ============================================================

Unicode true
!include "MUI2.nsh"

; Compile-time CWD starts at this script's dir (electron/) — switch to
; desktop-dist/ so File and OutFile relative paths resolve correctly.
!cd "../desktop-dist"

!define APPNAME "ManufacturingERP"
!define COMPANY "Afghan Manufacturing ERP"
!define VERSION "1.0.11.0"

Name "${APPNAME}"
OutFile "..\download\ManufacturingERP-Setup.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
RequestExecutionLevel admin
; non-solid LZMA: per-file compression — much faster to build than /SOLID,
; slightly larger installer, still decompresses identically for the end user.
SetCompressor lzma
ShowInstDetails show
ShowUnInstDetails show

VIProductVersion "${VERSION}"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${COMPANY}"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\ManufacturingERP.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Run ${APPNAME} now"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_TEXT_FINISH_TITLE "Installation Complete"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ------------------------------------------------ install
Section "Install"
  ; اگر برنامه در حال اجراست ببند — تا فایل‌ها قابل تعویض باشند (آپدیت روی نسخه نصب‌شده)
  DetailPrint "Closing ${APPNAME} if running..."
  ExecWait "taskkill /IM ${APPNAME}.exe /F"
  Sleep 600

  SetOutPath "$INSTDIR"

  ; پاک‌سازی نسخه قبلی سرور تعبیه‌شده — تا فایل‌های قدیمی build باقی نمانند
  RMDir /r "$INSTDIR\resources\server"

  ; Full Electron app (exe, dlls, resources\app, resources\server, resources\demo-db)
  ; POSIX makensis: forward slashes; recursion pulls in entire sub-trees
  ; (including dot-dirs like resources\server\.next-electron).
  File /r "win-unpacked/*"

  ; Start menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\ManufacturingERP.exe"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\ManufacturingERP.exe"

  ; Add/Remove Programs registry entries
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME} (${COMPANY})"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\ManufacturingERP.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  DetailPrint "${APPNAME} installed. Data is stored in %APPDATA%\${APPNAME}\data"
SectionEnd

; ------------------------------------------------ uninstall
Section "Uninstall"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

  DetailPrint "User data in %APPDATA%\${APPNAME} was kept. Delete it manually to remove all data."
SectionEnd
