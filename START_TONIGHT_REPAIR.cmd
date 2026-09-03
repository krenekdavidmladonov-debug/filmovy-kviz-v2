@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\tonight-repair\Start-TonightRepair.ps1"
exit /b %ERRORLEVEL%
