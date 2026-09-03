@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\event-night\Stop-EventNight.ps1"
exit /b %ERRORLEVEL%
