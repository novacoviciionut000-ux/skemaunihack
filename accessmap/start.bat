@echo off
REM AccessMap Windows Launcher (bypasses execution policy restrictions)
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
