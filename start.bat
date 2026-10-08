@echo off
rem UTF-8 console so the app's Chinese logs stop rendering as GBK mojibake
chcp 65001 >nul
cd /d "%~dp0"
call npm start
pause
