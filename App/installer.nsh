; ============================================================================
; Florde – Custom NSIS include for electron-builder ("nsis": { "include": "installer.nsh" })
;
; Adds:
;   - A mode menu as the first page of the installer and the uninstaller
;     (Install / Repair / Reinstall / Uninstall / Delete data / Delete app+data)
;   - An options page during install (desktop + Start menu shortcut, file types)
;   - customInstall / customUnInstall implementations
;
; This file is compiled twice by electron-builder: once for the installer and
; once for the generated uninstaller (BUILD_UNINSTALLER defined).
; All ${...} defines (APP_ID, APP_PACKAGE_NAME, SHORTCUT_NAME,
; INSTALL_REGISTRY_KEY, UNINSTALL_FILENAME, ...) are provided by electron-builder.
;
; NOTE: this include is processed BEFORE MUI2.nsh / LogicLib.nsh / nsDialogs.nsh
; are loaded, so top-level code may only use core NSIS instructions and
; preprocessor directives. Everything that needs macros is inside the
; custom* macro bodies below, which are expanded later by the template.
; ============================================================================

!include "FileAssociation.nsh"

; ----------------------------------------------------------------------------
; Language strings (1033 = English, 1031 = German)
; ----------------------------------------------------------------------------
LangString FLORDE_MODE_TITLE     1033 "What would you like to do?"
LangString FLORDE_MODE_TITLE     1031 "Was möchten Sie tun?"
LangString FLORDE_MODE_SUBTITLE  1033 "Choose an option. Installs and repairs keep your data."
LangString FLORDE_MODE_SUBTITLE  1031 "Wählen Sie eine Option. Installieren und Reparieren behalten Ihre Daten."
LangString FLORDE_MODE_INSTALL   1033 "Install"
LangString FLORDE_MODE_INSTALL   1031 "Installieren"
LangString FLORDE_MODE_REPAIR    1033 "Repair"
LangString FLORDE_MODE_REPAIR    1031 "Reparieren"
LangString FLORDE_MODE_REINSTALL 1033 "Reinstall"
LangString FLORDE_MODE_REINSTALL 1031 "Neu installieren"
LangString FLORDE_MODE_UNINSTALL 1033 "Uninstall (keep my data)"
LangString FLORDE_MODE_UNINSTALL 1031 "Deinstallieren (Daten bleiben erhalten)"
LangString FLORDE_MODE_DELETEDATA 1033 "Delete my data only (keep the app installed)"
LangString FLORDE_MODE_DELETEDATA 1031 "Nur Daten löschen (App bleibt installiert)"
LangString FLORDE_MODE_DELETEALL 1033 "Delete the app and all its data"
LangString FLORDE_MODE_DELETEALL 1031 "App und Daten löschen"
LangString FLORDE_CONFIRM_UNINSTALL 1033 "Do you really want to uninstall Florde? Your data will be kept."
LangString FLORDE_CONFIRM_UNINSTALL 1031 "Möchten Sie Florde wirklich deinstallieren? Ihre Daten bleiben erhalten."
LangString FLORDE_CONFIRM_DELETEDATA 1033 "Do you really want to delete all Florde data (projects, settings, sandbox)? The app stays installed. This cannot be undone."
LangString FLORDE_CONFIRM_DELETEDATA 1031 "Möchten Sie wirklich alle Florde-Daten (Projekte, Einstellungen, Sandbox) löschen? Die App bleibt installiert. Dies kann nicht rückgängig gemacht werden."
LangString FLORDE_CONFIRM_DELETEALL 1033 "Do you really want to delete Florde and all its data? This cannot be undone."
LangString FLORDE_CONFIRM_DELETEALL 1031 "Möchten Sie Florde und alle zugehörigen Daten wirklich löschen? Dies kann nicht rückgängig gemacht werden."
LangString FLORDE_DATA_DELETED 1033 "Florde data has been deleted."
LangString FLORDE_DATA_DELETED 1031 "Florde-Daten wurden gelöscht."
LangString FLORDE_SETUP_NOT_FOUND 1033 "The installer (Setup.exe) could not be found. Please download it again."
LangString FLORDE_SETUP_NOT_FOUND 1031 "Das Installationsprogramm (Setup.exe) wurde nicht gefunden. Bitte laden Sie es erneut herunter."
LangString FLORDE_OPT_TITLE 1033 "Options"
LangString FLORDE_OPT_TITLE 1031 "Optionen"
LangString FLORDE_OPT_SUBTITLE 1033 "Select your preferences."
LangString FLORDE_OPT_SUBTITLE 1031 "Wählen Sie die gewünschten Optionen."
LangString FLORDE_OPT_GROUP_SHORTCUTS 1033 "Shortcuts"
LangString FLORDE_OPT_GROUP_SHORTCUTS 1031 "Verknüpfungen"
LangString FLORDE_OPT_DESKTOP 1033 "Create a desktop shortcut"
LangString FLORDE_OPT_DESKTOP 1031 "Desktop-Verknüpfung erstellen"
LangString FLORDE_OPT_MENU 1033 "Create a Start menu shortcut"
LangString FLORDE_OPT_MENU 1031 "Startmenü-Verknüpfung erstellen"
LangString FLORDE_OPT_GROUP_FILES 1033 "File types"
LangString FLORDE_OPT_GROUP_FILES 1031 "Dateitypen"
LangString FLORDE_OPT_ASSOC 1033 "Open file types with Florde (.py, .js, .ts, .md, .html, .css, .json)"
LangString FLORDE_OPT_ASSOC 1031 "Dateitypen mit Florde öffnen (.py, .js, .ts, .md, .html, .css, .json)"

; ----------------------------------------------------------------------------
; Shared helper (used by installer AND uninstaller builds).
; Only core NSIS instructions, so it can live at top level.
; Electron always uses per-user app data, so switch the shell context to
; "current" while removing the data folders.
; ----------------------------------------------------------------------------
Function flordeDeleteAppData
  SetShellVarContext current
  RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
  RMDir /r "$APPDATA\${APP_FILENAME}"
  SetShellVarContext all
FunctionEnd

; ============================================================================
; INSTALLER
; ============================================================================
!ifndef BUILD_UNINSTALLER

  Var flordeMode
  Var flordeInstalled
  Var flordeOptDesktop
  Var flordeOptMenu
  Var flordeOptAssoc
  Var flordeDlg
  Var flordeRadioInstall
  Var flordeRadioRepair
  Var flordeRadioReinstall
  Var flordeRadioUninstall
  Var flordeRadioDeleteData
  Var flordeRadioDeleteAppData
  Var flordeChkDesktop
  Var flordeChkMenu
  Var flordeChkAssoc

  ; -- customInit: defaults for mode and options, command line overrides ------
  !macro customInit
    StrCpy $flordeInstalled "0"
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 != ""
      StrCpy $flordeInstalled "1"
    ${EndIf}

    StrCpy $flordeOptDesktop "1"
    StrCpy $flordeOptMenu "1"
    StrCpy $flordeOptAssoc "1"

    ${If} $flordeInstalled == "1"
      StrCpy $flordeMode "repair"
    ${Else}
      StrCpy $flordeMode "install"
    ${EndIf}

    ${GetParameters} $0
    ${GetOptions} $0 "--repair" $1
    ${IfNot} ${Errors}
      StrCpy $flordeMode "repair"
    ${EndIf}
    ${GetOptions} $0 "--reinstall" $1
    ${IfNot} ${Errors}
      StrCpy $flordeMode "reinstall"
    ${EndIf}
  !macroend

  ; -- mode menu (first page) ------------------------------------------------
  !macro customWelcomePage
    Function flordeModeMenuCreate
      !insertmacro MUI_HEADER_TEXT "$(FLORDE_MODE_TITLE)" "$(FLORDE_MODE_SUBTITLE)"
      nsDialogs::Create 1018
      Pop $flordeDlg
      ${If} $flordeDlg == error
        Abort
      ${EndIf}

      ${NSD_CreateRadioButton} 0 0u 100% 14u "$(FLORDE_MODE_INSTALL)"
      Pop $flordeRadioInstall
      ${NSD_AddStyle} $flordeRadioInstall ${WS_GROUP}

      ${NSD_CreateRadioButton} 0 16u 100% 14u "$(FLORDE_MODE_REPAIR)"
      Pop $flordeRadioRepair

      ${NSD_CreateRadioButton} 0 32u 100% 14u "$(FLORDE_MODE_REINSTALL)"
      Pop $flordeRadioReinstall

      ${NSD_CreateRadioButton} 0 48u 100% 14u "$(FLORDE_MODE_UNINSTALL)"
      Pop $flordeRadioUninstall

      ${NSD_CreateRadioButton} 0 64u 100% 14u "$(FLORDE_MODE_DELETEDATA)"
      Pop $flordeRadioDeleteData

      ${NSD_CreateRadioButton} 0 80u 100% 14u "$(FLORDE_MODE_DELETEALL)"
      Pop $flordeRadioDeleteAppData

      ${If} $flordeInstalled == "0"
        EnableWindow $flordeRadioRepair 0
        EnableWindow $flordeRadioReinstall 0
        EnableWindow $flordeRadioUninstall 0
        EnableWindow $flordeRadioDeleteData 0
        EnableWindow $flordeRadioDeleteAppData 0
      ${EndIf}

      ${If} $flordeMode == "reinstall"
        ${NSD_SetState} $flordeRadioReinstall ${BST_CHECKED}
      ${ElseIf} $flordeMode == "repair"
        ${NSD_SetState} $flordeRadioRepair ${BST_CHECKED}
      ${Else}
        ${NSD_SetState} $flordeRadioInstall ${BST_CHECKED}
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function flordeModeMenuLeave
      ; NOTE: no CHECK_APP_RUNNING here — electron-builder already expands it
      ; in both installer and uninstaller flows; a second expansion re-declares
      ; Var CmdPath and aborts makensis ("already declared").
      ${NSD_GetState} $flordeRadioInstall $0
      ${If} $0 <> 0
        StrCpy $flordeMode "install"
      ${EndIf}
      ${NSD_GetState} $flordeRadioRepair $0
      ${If} $0 <> 0
        StrCpy $flordeMode "repair"
      ${EndIf}
      ${NSD_GetState} $flordeRadioReinstall $0
      ${If} $0 <> 0
        StrCpy $flordeMode "reinstall"
      ${EndIf}
      ${NSD_GetState} $flordeRadioUninstall $0
      ${If} $0 <> 0
        StrCpy $flordeMode "uninstall"
      ${EndIf}
      ${NSD_GetState} $flordeRadioDeleteData $0
      ${If} $0 <> 0
        StrCpy $flordeMode "deleteData"
      ${EndIf}
      ${NSD_GetState} $flordeRadioDeleteAppData $0
      ${If} $0 <> 0
        StrCpy $flordeMode "deleteAppData"
      ${EndIf}

      ${If} $flordeMode == "uninstall"
        MessageBox MB_YESNO|MB_ICONQUESTION "$(FLORDE_CONFIRM_UNINSTALL)" /SD IDNO IDYES flordeActionUninstall
        Abort
      flordeActionUninstall:
        Call flordeRunUninstallerSilent
        Quit
      ${EndIf}

      ${If} $flordeMode == "deleteData"
        MessageBox MB_YESNO|MB_ICONQUESTION "$(FLORDE_CONFIRM_DELETEDATA)" /SD IDNO IDYES flordeActionDeleteData
        Abort
      flordeActionDeleteData:
        Call flordeDeleteAppData
        MessageBox MB_OK|MB_ICONINFORMATION "$(FLORDE_DATA_DELETED)"
        Quit
      ${EndIf}

      ${If} $flordeMode == "deleteAppData"
        MessageBox MB_YESNO|MB_ICONQUESTION "$(FLORDE_CONFIRM_DELETEALL)" /SD IDNO IDYES flordeActionDeleteAppData
        Abort
      flordeActionDeleteAppData:
        Call flordeRunUninstallerDeleteData
        Quit
      ${EndIf}
    FunctionEnd

    Function flordeRunUninstallerSilent
      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 != ""
        ExecWait '"$0\${UNINSTALL_FILENAME}" /S' $1
      ${EndIf}
    FunctionEnd

    Function flordeRunUninstallerDeleteData
      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $0 != ""
        ExecWait '"$0\${UNINSTALL_FILENAME}" /S --delete-app-data' $1
      ${EndIf}
    FunctionEnd

    Page custom flordeModeMenuCreate flordeModeMenuLeave
  !macroend

  ; -- options page (after installation directory selection) ------------------
  !macro customPageAfterChangeDir
    Function flordeOptionsCreate
      !insertmacro MUI_HEADER_TEXT "$(FLORDE_OPT_TITLE)" "$(FLORDE_OPT_SUBTITLE)"
      nsDialogs::Create 1018
      Pop $flordeDlg
      ${If} $flordeDlg == error
        Abort
      ${EndIf}

      ; In repair mode pre-fill the checkboxes from the current state.
      ${If} $flordeMode == "repair"
        ${If} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
          StrCpy $flordeOptDesktop "1"
        ${Else}
          StrCpy $flordeOptDesktop "0"
        ${EndIf}
        ${If} ${FileExists} "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
          StrCpy $flordeOptMenu "1"
        ${Else}
          StrCpy $flordeOptMenu "0"
        ${EndIf}
        ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.js" ""
        ${If} $0 == "JavaScript"
          StrCpy $flordeOptAssoc "1"
        ${Else}
          StrCpy $flordeOptAssoc "0"
        ${EndIf}
      ${EndIf}

      ${NSD_CreateGroupBox} 0 0u 100% 52u "$(FLORDE_OPT_GROUP_SHORTCUTS)"
      Pop $0

      ${NSD_CreateCheckBox} 10u 14u 90% 12u "$(FLORDE_OPT_DESKTOP)"
      Pop $flordeChkDesktop
      ${NSD_CreateCheckBox} 10u 30u 90% 12u "$(FLORDE_OPT_MENU)"
      Pop $flordeChkMenu

      ${NSD_CreateGroupBox} 0 56u 100% 46u "$(FLORDE_OPT_GROUP_FILES)"
      Pop $0

      ${NSD_CreateCheckBox} 10u 70u 90% 12u "$(FLORDE_OPT_ASSOC)"
      Pop $flordeChkAssoc

      ${If} $flordeOptDesktop == "1"
        ${NSD_SetState} $flordeChkDesktop ${BST_CHECKED}
      ${Else}
        ${NSD_SetState} $flordeChkDesktop ${BST_UNCHECKED}
      ${EndIf}
      ${If} $flordeOptMenu == "1"
        ${NSD_SetState} $flordeChkMenu ${BST_CHECKED}
      ${Else}
        ${NSD_SetState} $flordeChkMenu ${BST_UNCHECKED}
      ${EndIf}
      ${If} $flordeOptAssoc == "1"
        ${NSD_SetState} $flordeChkAssoc ${BST_CHECKED}
      ${Else}
        ${NSD_SetState} $flordeChkAssoc ${BST_UNCHECKED}
      ${EndIf}

      nsDialogs::Show
    FunctionEnd

    Function flordeOptionsLeave
      ${NSD_GetState} $flordeChkDesktop $flordeOptDesktop
      ${NSD_GetState} $flordeChkMenu $flordeOptMenu
      ${NSD_GetState} $flordeChkAssoc $flordeOptAssoc
    FunctionEnd

    Page custom flordeOptionsCreate flordeOptionsLeave
  !macroend

  ; -- customInstall: shortcuts + file associations per options ---------------
  !macro customInstall
    ; remember the setup.exe location so the uninstaller can offer repair/reinstall
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" SetupExePath "$EXEPATH"

    ; ---- desktop shortcut ----
    ${If} $flordeOptDesktop == "1"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${Else}
      ${If} ${FileExists} "$oldDesktopLink"
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${EndIf}
    ${EndIf}

    ; ---- start menu shortcut ----
    ${If} $flordeOptMenu == "1"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${Else}
      ${If} ${FileExists} "$oldStartMenuLink"
        WinShell::UninstShortcut "$oldStartMenuLink"
        Delete "$oldStartMenuLink"
      ${EndIf}
      ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MenuDirectory
      ${If} $0 != ""
        RMDir "$SMPROGRAMS\$0"
      ${EndIf}
    ${EndIf}

    ; ---- file associations ----
    ${If} $flordeOptAssoc == "1"
      !insertmacro APP_ASSOCIATE "py" "Python" "Python Source File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "js" "JavaScript" "JavaScript File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "ts" "TypeScript" "TypeScript File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "md" "Markdown" "Markdown File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "html" "HTML" "HTML File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "css" "CSS" "CSS File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
      !insertmacro APP_ASSOCIATE "json" "JSON" "JSON File" "$appExe,0" "Open with Florde" "$appExe $\"%1$\""
    ${Else}
      !insertmacro APP_UNASSOCIATE "py" "Python"
      !insertmacro APP_UNASSOCIATE "js" "JavaScript"
      !insertmacro APP_UNASSOCIATE "ts" "TypeScript"
      !insertmacro APP_UNASSOCIATE "md" "Markdown"
      !insertmacro APP_UNASSOCIATE "html" "HTML"
      !insertmacro APP_UNASSOCIATE "css" "CSS"
      !insertmacro APP_UNASSOCIATE "json" "JSON"
    ${EndIf}

    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  !macroend

!endif ; INSTALLER

; ============================================================================
; UNINSTALLER
; ============================================================================
!ifdef BUILD_UNINSTALLER

  Var flordeUnMode
  Var flordeUnDeleteData
  Var flordeUnSetupExe
  Var flordeUnDlg
  Var flordeUnRadioRepair
  Var flordeUnRadioReinstall
  Var flordeUnRadioUninstall
  Var flordeUnRadioDeleteData
  Var flordeUnRadioDeleteAppData

  ; uninstaller copy of flordeDeleteAppData (NSIS requires "un." prefix)
  Function un.flordeDeleteAppData
    SetShellVarContext current
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$APPDATA\${APP_FILENAME}"
    SetShellVarContext all
  FunctionEnd

  ; -- mode menu (first page of the uninstaller) ------------------------------
  !macro customUnWelcomePage
    Function un.flordeModeMenuCreate
      !insertmacro MUI_HEADER_TEXT "$(FLORDE_MODE_TITLE)" "$(FLORDE_MODE_SUBTITLE)"
      nsDialogs::Create 1018
      Pop $flordeUnDlg
      ${If} $flordeUnDlg == error
        Abort
      ${EndIf}

      StrCpy $flordeUnSetupExe ""
      ReadRegStr $flordeUnSetupExe SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" SetupExePath
      ${IfNot} ${FileExists} "$flordeUnSetupExe"
        StrCpy $flordeUnSetupExe ""
      ${EndIf}

      ${NSD_CreateRadioButton} 0 0u 100% 14u "$(FLORDE_MODE_REPAIR)"
      Pop $flordeUnRadioRepair
      ${NSD_AddStyle} $flordeUnRadioRepair ${WS_GROUP}

      ${NSD_CreateRadioButton} 0 16u 100% 14u "$(FLORDE_MODE_REINSTALL)"
      Pop $flordeUnRadioReinstall

      ${NSD_CreateRadioButton} 0 32u 100% 14u "$(FLORDE_MODE_UNINSTALL)"
      Pop $flordeUnRadioUninstall

      ${NSD_CreateRadioButton} 0 48u 100% 14u "$(FLORDE_MODE_DELETEDATA)"
      Pop $flordeUnRadioDeleteData

      ${NSD_CreateRadioButton} 0 64u 100% 14u "$(FLORDE_MODE_DELETEALL)"
      Pop $flordeUnRadioDeleteAppData

      ${If} $flordeUnSetupExe == ""
        EnableWindow $flordeUnRadioRepair 0
        EnableWindow $flordeUnRadioReinstall 0
      ${EndIf}

      ${NSD_SetState} $flordeUnRadioUninstall ${BST_CHECKED}

      nsDialogs::Show
    FunctionEnd

    Function un.flordeModeMenuLeave
      ; NOTE: see flordeModeMenuLeave — builder already checks, do not expand twice.
      ${NSD_GetState} $flordeUnRadioRepair $0
      ${If} $0 <> 0
        StrCpy $flordeUnMode "repair"
      ${EndIf}
      ${NSD_GetState} $flordeUnRadioReinstall $0
      ${If} $0 <> 0
        StrCpy $flordeUnMode "reinstall"
      ${EndIf}
      ${NSD_GetState} $flordeUnRadioUninstall $0
      ${If} $0 <> 0
        StrCpy $flordeUnMode "uninstall"
      ${EndIf}
      ${NSD_GetState} $flordeUnRadioDeleteData $0
      ${If} $0 <> 0
        StrCpy $flordeUnMode "deleteData"
      ${EndIf}
      ${NSD_GetState} $flordeUnRadioDeleteAppData $0
      ${If} $0 <> 0
        StrCpy $flordeUnMode "deleteAppData"
      ${EndIf}

      ${If} $flordeUnMode == "repair"
      ${OrIf} $flordeUnMode == "reinstall"
        ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" SetupExePath
        ${If} $0 == ""
        ${OrIfNot} ${FileExists} "$0"
          MessageBox MB_OK|MB_ICONEXCLAMATION "$(FLORDE_SETUP_NOT_FOUND)"
          Abort
        ${EndIf}
        ${If} $flordeUnMode == "reinstall"
          Exec '"$0" --reinstall'
        ${Else}
          Exec '"$0" --repair'
        ${EndIf}
        Quit
      ${EndIf}

      ${If} $flordeUnMode == "deleteData"
        MessageBox MB_YESNO|MB_ICONQUESTION "$(FLORDE_CONFIRM_DELETEDATA)" /SD IDNO IDYES flordeUnActionDeleteData
        Abort
      flordeUnActionDeleteData:
        Call un.flordeDeleteAppData
        MessageBox MB_OK|MB_ICONINFORMATION "$(FLORDE_DATA_DELETED)"
        Quit
      ${EndIf}

      ${If} $flordeUnMode == "deleteAppData"
        MessageBox MB_YESNO|MB_ICONQUESTION "$(FLORDE_CONFIRM_DELETEALL)" /SD IDNO IDYES flordeUnActionDeleteAppData
        Abort
      flordeUnActionDeleteAppData:
        StrCpy $flordeUnDeleteData "1"
      ${EndIf}
    FunctionEnd

    !insertmacro MUI_UNPAGE_INIT
    PageEx un.custom
      PageCallbacks un.flordeModeMenuCreate un.flordeModeMenuLeave
    PageExEnd
  !macroend

  ; -- customUnInstall: remove shortcuts + file associations, maybe data ------
  !macro customUnInstall
    ${If} ${FileExists} "$oldDesktopLink"
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${EndIf}
    ${If} ${FileExists} "$oldStartMenuLink"
      WinShell::UninstShortcut "$oldStartMenuLink"
      Delete "$oldStartMenuLink"
    ${EndIf}
    ${If} $oldMenuDirectory != ""
      RMDir "$SMPROGRAMS\$oldMenuDirectory"
    ${EndIf}

    !insertmacro APP_UNASSOCIATE "py" "Python"
    !insertmacro APP_UNASSOCIATE "js" "JavaScript"
    !insertmacro APP_UNASSOCIATE "ts" "TypeScript"
    !insertmacro APP_UNASSOCIATE "md" "Markdown"
    !insertmacro APP_UNASSOCIATE "html" "HTML"
    !insertmacro APP_UNASSOCIATE "css" "CSS"
    !insertmacro APP_UNASSOCIATE "json" "JSON"

    ${If} $flordeUnDeleteData == "1"
      Call un.flordeDeleteAppData
    ${EndIf}

    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
  !macroend

!endif ; UNINSTALLER
