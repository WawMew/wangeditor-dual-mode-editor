@echo off
setlocal
cd /d "%~dp0"

set "PORT=8321"
if not "%~1"=="" set "PORT=%~1"

title wangEditor static server - port %PORT%

echo.
echo   ==========================================================
echo    wangEditor dual-mode rich text editor - local server
echo   ==========================================================
echo.
echo    Editor :  http://127.0.0.1:%PORT%/index.html
echo    Test   :  http://127.0.0.1:%PORT%/_selftest.html
echo.
echo    Keep this window open while using the editor.
echo    Press Ctrl+C here to stop the server.
echo.

set "PWSH=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"

"%PWSH%" -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port %PORT% -Root "%~dp0."
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo   [FAILED] server exited with code %RC%
echo   Server stopped.
echo.
pause
