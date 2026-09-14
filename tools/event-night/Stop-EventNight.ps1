param([switch]$NonInteractive)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'tools\local-qa\LocalQa.Common.ps1')
. (Join-Path $PSScriptRoot 'EventNight.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'JustKvíz - event-night stop a export'

function Complete-StopWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'JustKvíz - EVENT NIGHT STOP' -ForegroundColor White
  Write-Host '=====================================' -ForegroundColor DarkGray
  $paths = Get-EventNightPaths $repoRoot
  $state = Get-EventNightState $paths
  if ($null -eq $state) {
    Write-QaInfo 'Žádný event-night proces spuštěný launcherem není evidován.'
    Write-QaInfo 'Cizí Node/Java procesy nebyly ukončeny.'
    Complete-StopWindow
    exit 0
  }
  if ([string]$state.repositoryRoot -ne $repoRoot -or
      [string]$state.projectId -ne $script:EventNightProjectId -or
      -not (Test-EventNightWorker $state.emulators ([string]$state.runToken))) {
    Throw-QaError 'Run-state nebo worker nelze bezpečně ověřit; nic nebylo ukončeno.' 'Požádejte vývojáře o kontrolu .local-data/event-night/run-state.json.'
  }

  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $script:EventNightProjectId
  Set-EventNightEmulatorEnvironment $script:EventNightProjectId

  $healthFailed = $false
  Remove-Item -LiteralPath $paths.HealthPath -Force -ErrorAction SilentlyContinue
  try {
    Write-QaInfo 'Před exportem aktualizuji candidate preflight health...'
    Invoke-EventNightHealth $repoRoot $nodeTool $paths | Out-Null
  } catch {
    $healthFailed = $true
    Write-QaWarning 'Preflight health se nepodařilo aktualizovat; data přesto bezpečně exportuji bez readiness metadat.'
  }

  Write-QaInfo 'Exportuji běžící Auth/Firestore/Storage emulator data do staging snapshotu...'
  Export-EventNightSnapshot $repoRoot $pnpmTool $paths -Promote | Out-Null
  Write-QaSuccess 'Nový snapshot je ověřený; předchozí known-good stav zůstal v backups.'
  Write-QaInfo 'Ukončuji pouze identitou ověřený event-night worker...'
  Stop-EventNightWorker $state.emulators ([string]$state.runToken)
  Remove-Item -LiteralPath $paths.StatePath -Force
  Write-QaSuccess 'Event-night prostředí bylo zastaveno po úspěšném exportu.'
  if ($healthFailed) {
    Write-QaWarning 'Snapshot je uložen, ale poslední browser health je UNVERIFIED.'
  }
  Complete-StopWindow
  if ($healthFailed) { exit 2 }
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-QaWarning 'Při chybě exportu zůstává worker spuštěný a poslední known-good snapshot se nepřepisuje.'
  Complete-StopWindow
  exit 1
}
