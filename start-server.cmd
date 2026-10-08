@echo off
setlocal
cd /d "%~dp0"
set PORT=8321
echo.
echo   wangEditor dual-mode editor
echo   Open: http://127.0.0.1:%PORT%/index.html
echo   Self-test: http://127.0.0.1:%PORT%/_selftest.html
echo   Press Ctrl+C to stop.
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
echo Python not found. Install Python, or open index.html directly in a browser.
pause
