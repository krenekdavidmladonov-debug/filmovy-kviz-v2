param([switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'LocalQa.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - zastavení lokálního QA'

function Complete-StopWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - ZASTAVENÍ LOKÁLNÍHO QA' -ForegroundColor White
  Write-Host '=================================================' -ForegroundColor DarkGray
  $paths = Get-LocalQaPaths $repoRoot
  $state = Get-LocalQaState $paths.StatePath
  if ($null -eq $state) {
    Write-QaInfo 'Žádné procesy spuštěné launcherem nejsou evidovány.'
    Write-QaInfo 'Cizí Node/Java procesy nebyly ukončeny.'
    Complete-StopWindow
    exit 0
  }
  if ([string]$state.repositoryRoot -ne $repoRoot -or [string]$state.projectId -ne $script:LocalQaProjectId) {
    Throw-QaError 'Soubor QA stavu nepatří tomuto projektu nebo bezpečnému demo prostředí.' 'Nic nebylo ukončeno. Požádejte vývojáře o kontrolu .local-data/local-qa/run-state.json.'
  }

  Write-QaInfo 'Ukončuji pouze ověřené procesy spuštěné launcherem...'
  Stop-TrackedWorker $state.vite 'vite' $state.runToken
  Stop-TrackedWorker $state.emulators 'emulators' $state.runToken
  Remove-Item -LiteralPath $paths.StatePath -Force
  Write-QaSuccess 'Lokální QA prostředí bylo bezpečně zastaveno.'
  Write-QaInfo 'Logy zůstaly v .local-data/local-qa. Cizí procesy nebyly ukončeny.'
  Complete-StopWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Complete-StopWindow
  exit 1
}
