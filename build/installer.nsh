; Hyperclay Local: one-click per-user installer that takes over a per-machine install.
; customInit runs in .onInit after initMultiUser (installer.nsi:77-81), so $INSTDIR is
; already the per-user target and SetRegView 64 is already in effect (installer.nsi:67).

!macro customInit
  Var /GLOBAL hclMachineDir
  Var /GLOBAL hclMachineFull
  Var /GLOBAL hclUninstaller
  Var /GLOBAL hclMadeInstDir

  ; Fresh per-user installs land beside existing ones (...\Programs\HyperclayLocal),
  ; not in the package-name folder one-click picks by default (targetUtil.js:40-41).
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 == ""
    !insertmacro GetDParameter $1
    ${if} $1 == ""
      StrCpy $INSTDIR "$LocalAppData\Programs\${PRODUCT_FILENAME}"
    ${endif}
  ${endif}

  ; An HKLM entry whose folder is gone is no install; canInstallInPlace in
  ; src/main/updater.js ignores it the same way.
  ReadRegStr $hclMachineDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $hclMachineDir != ""
    ${ifNot} ${FileExists} "$hclMachineDir\*.*"
      StrCpy $hclMachineDir ""
    ${endif}
  ${endif}

  ${if} $hclMachineDir != ""
    ; A silent run (electron-updater, CI) never prompts. The app keeps such installs on
    ; the download link, so a silent run only meets HKLM when someone scripts it.
    ${if} ${Silent}
      SetErrorLevel 3
      Quit
    ${endif}

    ; The old uninstaller runs elevated, so take over only a copy in a folder that needs
    ; an administrator to change: under Program Files. Anywhere else the user removes it.
    GetFullPathName $hclMachineFull $hclMachineDir
    StrCpy $0 $hclMachineFull 1 -1
    ${if} $0 == "\"
      StrCpy $hclMachineFull $hclMachineFull -1
    ${endif}
    StrCpy $2 0
    StrLen $0 "$PROGRAMFILES64\"
    StrCpy $1 "$hclMachineFull\" $0
    ${if} $1 == "$PROGRAMFILES64\"
      StrCpy $2 1
    ${endif}
    StrLen $0 "$PROGRAMFILES\"
    StrCpy $1 "$hclMachineFull\" $0
    ${if} $1 == "$PROGRAMFILES\"
      StrCpy $2 1
    ${endif}
    ${if} $hclMachineFull == ""
      StrCpy $2 0
    ${endif}
    ${if} $2 != 1
      MessageBox MB_OK|MB_ICONSTOP "Hyperclay Local is installed for all users in$\r$\n$hclMachineDir$\r$\n$\r$\nRemove that copy from Settings > Apps, then run this installer again. Your folders and settings are kept. Nothing was installed."
      Quit
    ${endif}

    ; The installer runs as this user, so check it can write the per-user folder before
    ; the working all-users copy is removed. A folder made only for the check is removed.
    StrCpy $hclMadeInstDir 0
    ${ifNot} ${FileExists} "$INSTDIR\*.*"
      StrCpy $hclMadeInstDir 1
    ${endif}
    ClearErrors
    CreateDirectory "$INSTDIR"
    FileOpen $0 "$INSTDIR\hyperclay-write-check.tmp" w
    ${if} ${Errors}
      ${if} $hclMadeInstDir == 1
        RMDir "$INSTDIR"
      ${endif}
      MessageBox MB_OK|MB_ICONSTOP "This installer cannot write to$\r$\n$INSTDIR$\r$\n$\r$\nso the all-users copy was left as it is and nothing was installed. Run the installer again without choosing a folder."
      Quit
    ${endif}
    FileClose $0
    Delete "$INSTDIR\hyperclay-write-check.tmp"
    ${if} $hclMadeInstDir == 1
      RMDir "$INSTDIR"
    ${endif}

    ; Exit 10 means no copy runs from the all-users folder. A process with the app's name
    ; whose path this user cannot read (another user's) counts as running, and so does any
    ; failure to ask, because the elevated uninstaller would kill it without a sync drain.
    retryRunning:
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "try { $$d = '$hclMachineFull\'; $$n = @(Get-CimInstance Win32_Process -ErrorAction Stop | ? { $$_.Name -eq '${APP_EXECUTABLE_FILENAME}' -and (-not $$_.ExecutablePath -or $$_.ExecutablePath.StartsWith($$d, 'OrdinalIgnoreCase')) }).Count; if ($$n -eq 0) { exit 10 } else { exit 0 } } catch { exit 0 }"`
    Pop $0
    ${if} $0 != 10
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Hyperclay Local is running. Quit it from its tray icon, then click Retry. If someone else signed in to this computer has it open, they need to quit it too." IDRETRY retryRunning
      Quit
    ${endif}

    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Hyperclay Local is installed for all users in$\r$\n$hclMachineDir$\r$\n$\r$\nThis version installs just for you and keeps itself up to date. Windows will ask once for permission to remove the old copy. Your folders and settings are kept." IDOK +2
    Quit

    StrCpy $hclUninstaller "$hclMachineDir\${UNINSTALL_FILENAME}"
    ${ifNot} ${FileExists} "$hclUninstaller"
      MessageBox MB_OK|MB_ICONSTOP "The all-users copy in $hclMachineDir has no uninstaller. Remove it from Settings > Apps, then run this installer again."
      Quit
    ${endif}

    ; Same arguments electron-builder passes an old uninstaller (installUtil.nsh:184-224),
    ; minus --keep-shortcuts so the all-users Start menu and desktop links go too.
    ; Started elevated so the uninstaller runs as one process: when it elevated itself
    ; instead, the empty old folder was left behind. The copy keeps its own name, which is
    ; what the UAC prompt shows for an unsigned uninstaller (every 1.30.x one is unsigned).
    InitPluginsDir
    CreateDirectory "$PLUGINSDIR\old-machine"
    CopyFiles /SILENT "$hclUninstaller" "$PLUGINSDIR\old-machine\${UNINSTALL_FILENAME}"
    ExecShellWait "runas" "$PLUGINSDIR\old-machine\${UNINSTALL_FILENAME}" '/S /KEEP_APP_DATA /allusers --updated _?=$hclMachineDir'

    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $0 != ""
      MessageBox MB_OK|MB_ICONSTOP "The all-users copy in $hclMachineDir was not removed, so nothing was installed. Run this installer again and allow the Windows prompt, or remove the old copy from Settings > Apps."
      Quit
    ${endif}
  ${endif}
!macroend
