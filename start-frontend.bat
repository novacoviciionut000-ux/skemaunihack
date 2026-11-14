@echo off
setlocal
cd /d "%~dp0accessmap\frontend"

echo ==> Pornire Frontend AccessMap Vite (:3000)...
call npm.cmd run dev
pause
