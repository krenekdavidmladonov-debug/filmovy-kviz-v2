@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\event-night\Prepare-EventNight.ps1"
exit /b %ERRORLEVEL%
