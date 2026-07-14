!include LogicLib.nsh

!define OLLAMA_SETUP_URL "https://ollama.com/download/OllamaSetup.exe"

!ifndef BUILD_UNINSTALLER
Var OllamaInstalled
Var OllamaDownloadStatus
Var OllamaInstallerPath
Var OllamaInstallerExitCode
Var OllamaWhereOutput
Var OllamaDownloadScript

!macro customInstall
  Call EnsureOllamaInstalled
!macroend

Function DetectOllama
  StrCpy $OllamaInstalled "0"

  IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" 0 +2
    StrCpy $OllamaInstalled "1"
  IfFileExists "$LOCALAPPDATA\Ollama\ollama.exe" 0 +2
    StrCpy $OllamaInstalled "1"
  IfFileExists "$PROGRAMFILES\Ollama\ollama.exe" 0 +2
    StrCpy $OllamaInstalled "1"
  IfFileExists "$PROGRAMFILES64\Ollama\ollama.exe" 0 +2
    StrCpy $OllamaInstalled "1"

  ${If} $OllamaInstalled == "1"
    Return
  ${EndIf}

  nsExec::ExecToStack 'cmd.exe /C where ollama.exe'
  Pop $0
  Pop $OllamaWhereOutput
  ${If} $0 == "0"
    StrCpy $OllamaInstalled "1"
  ${EndIf}
FunctionEnd

Function EnsureOllamaInstalled
  Call DetectOllama
  ${If} $OllamaInstalled == "1"
    DetailPrint "Ollama detected."
    Return
  ${EndIf}

  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "RiftCoach uses Ollama for local AI reviews, but Ollama was not found on this PC.$\r$\n$\r$\nDownload and run the official Ollama installer now?" IDYES download IDNO skip
    skip:
      DetailPrint "Ollama installation skipped."
      Return
  ${EndIf}

  download:
    InitPluginsDir
    StrCpy $OllamaInstallerPath "$PLUGINSDIR\OllamaSetup.exe"
    StrCpy $OllamaDownloadScript "$PLUGINSDIR\DownloadOllama.ps1"
    DetailPrint "Downloading Ollama from ${OLLAMA_SETUP_URL}..."

    FileOpen $0 "$OllamaDownloadScript" w
    FileWrite $0 "$$ErrorActionPreference = 'Stop'$\r$\n"
    FileWrite $0 "$$ProgressPreference = 'SilentlyContinue'$\r$\n"
    FileWrite $0 "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12$\r$\n"
    FileWrite $0 "Invoke-WebRequest -Uri '${OLLAMA_SETUP_URL}' -OutFile $$args[0]$\r$\n"
    FileClose $0

    nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$OllamaDownloadScript" "$OllamaInstallerPath"'
    Pop $OllamaDownloadStatus
    Pop $OllamaWhereOutput

    ${If} $OllamaDownloadStatus != "0"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "RiftCoach installed, but Ollama could not be downloaded automatically.$\r$\n$\r$\nDownload status: $OllamaDownloadStatus$\r$\nManual installer: ${OLLAMA_SETUP_URL}"
      ${EndIf}
      DetailPrint "Ollama download failed with status: $OllamaDownloadStatus"
      Return
    ${EndIf}

    DetailPrint "Running Ollama installer..."
    ${If} ${Silent}
      ExecWait '"$OllamaInstallerPath" /VERYSILENT /NORESTART' $OllamaInstallerExitCode
    ${Else}
      ExecWait '"$OllamaInstallerPath"' $OllamaInstallerExitCode
    ${EndIf}

    DetailPrint "Ollama installer exited with code $OllamaInstallerExitCode."
    Call DetectOllama
    ${If} $OllamaInstalled == "1"
      DetailPrint "Ollama installed."
    ${Else}
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION "RiftCoach installed, but Ollama was still not detected after the Ollama installer finished.$\r$\n$\r$\nIf you installed Ollama to a custom location, restart RiftCoach or install Ollama manually from ${OLLAMA_SETUP_URL}."
      ${EndIf}
    ${EndIf}
FunctionEnd
!endif
