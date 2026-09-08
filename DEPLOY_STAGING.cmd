@echo off
setlocal
cd /d "%~dp0"
if not exist ".tools\node22\node.exe" (
  echo Node 22 is required at .tools\node22\node.exe
  exit /b 1
)
".tools\node22\node.exe" tools\staging\deploy.mjs filmovy-kviz-v2-staging
exit /b %errorlevel%
