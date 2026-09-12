@echo off
title FreshFlow Admin Preview
cd /d D:\FreshFlow\web-admin

REM If port 5273 is already serving, just open the browser (no duplicate process)
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient; try{$c.Connect('127.0.0.1',5273); $c.Close(); exit 0}catch{exit 1}"
if %errorlevel%==0 (
  echo [FreshFlow] Port 5273 already running - opening browser...
  start http://localhost:5273
  timeout /t 3 /nobreak >nul
  exit /b 0
)

echo [FreshFlow] Starting dev server on http://localhost:5273 ...
echo Stop: close this window, or press Ctrl+C here.
npm run dev -- --open --strictPort
pause
