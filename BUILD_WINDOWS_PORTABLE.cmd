@echo off
setlocal
cd /d "%~dp0"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\build_windows_portable.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" goto success
echo BUILD FAILED. See WINDOWS_BUILD.log.
goto end

:success
echo BUILD SUCCESS. See the release folder.

:end
pause
exit /b %EXIT_CODE%
