@echo off
REM AccessMap Windows Launcher - Root forwarder
setlocal
cd /d "%~dp0accessmap"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0accessmap\start.ps1" %*
