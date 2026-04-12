@echo off
setlocal enabledelayedexpansion

set HOST_NAME=com.telemost.transcriber
set SCRIPT_DIR=%~dp0
set HOST_PATH=%SCRIPT_DIR%host.py
set BAT_PATH=%SCRIPT_DIR%host.bat
set MANIFEST_PATH=%SCRIPT_DIR%%HOST_NAME%.json

:: Get extension ID
if not "%~1"=="" (
  set EXT_ID=%~1
) else (
  set /p EXT_ID="Enter Chrome extension ID: "
)

if "!EXT_ID!"=="" (
  echo Error: extension ID is required.
  echo Usage: %~nx0 ^<extension-id^>
  echo Find it at chrome://extensions with Developer mode enabled.
  exit /b 1
)

:: Create host.bat wrapper (Chrome on Windows cannot execute .py directly)
(
  echo @python "%%~dp0host.py"
) > "%BAT_PATH%"

:: Generate manifest with absolute path to host.bat
(
  echo {
  echo   "name": "%HOST_NAME%",
  echo   "description": "Telemost Transcriber AI Assistant native host",
  echo   "path": "!BAT_PATH:\=\\!",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://!EXT_ID!/"]
  echo }
) > "%MANIFEST_PATH%"

:: Register in Windows registry
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

echo.
echo === Installation complete ===
echo Manifest: %MANIFEST_PATH%
echo Host:     %BAT_PATH%
echo Extension ID: !EXT_ID!
echo.
echo Restart Chrome to activate the native host.

endlocal
