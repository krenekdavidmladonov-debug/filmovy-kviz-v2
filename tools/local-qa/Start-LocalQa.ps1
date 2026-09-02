param(
  [string]$ProjectId = 'demo-filmovy-kviz-v2',
  [switch]$SkipBrowser,
  [switch]$NonInteractive,
  [switch]$DiagnosticsOnly,
  [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'LocalQa.Common.ps1')
$Host.UI.RawUI.WindowTitle = 'Kvízová platforma - lokální QA'

$startedWorkers = @()
$stateWasWritten = $false

function Complete-LauncherWindow {
  if (-not $NonInteractive) {
    Write-Host ''
    Read-Host 'Stiskněte Enter pro zavření tohoto informačního okna' | Out-Null
  }
}

try {
  Write-Host ''
  Write-Host 'KVÍZOVÁ PLATFORMA - LOKÁLNÍ HUMAN QA' -ForegroundColor White
  Write-Host '=======================================' -ForegroundColor DarkGray
  Write-QaInfo 'Ověřuji bezpečnost a lokální nástroje...'

  Assert-SafeLocalConfiguration $repoRoot $ProjectId
  $nodeTool = Resolve-NodeTool $repoRoot
  $javaTool = Resolve-JavaTool $repoRoot
  $pnpmTool = Resolve-PnpmTool $repoRoot $nodeTool
  $gitTool = Resolve-GitTool
  Set-SafeChildEnvironment $repoRoot $nodeTool $pnpmTool $javaTool $ProjectId

  Write-QaSuccess "Node.js: $($nodeTool.Version)  [$($nodeTool.Path)]"
  Write-QaSuccess "pnpm: $($pnpmTool.Version) přes $($pnpmTool.Mode)  [$($pnpmTool.Path)]"
  Write-QaSuccess "Java: $($javaTool.Version)  [$($javaTool.Path)]"
  if ($null -ne $gitTool) {
    Write-QaInfo "Git (pro start není nutný): $($gitTool.Version)  [$($gitTool.Path)]"
  } else {
    Write-QaWarning 'Git nebyl nalezen, ale pro lokální QA start není potřeba.'
  }

  if ($DiagnosticsOnly) {
    Write-QaSuccess 'Diagnostika prerequisites dokončena; žádný proces nebyl spuštěn.'
    Complete-LauncherWindow
    exit 0
  }

  $paths = Get-LocalQaPaths $repoRoot
  New-Item -ItemType Directory -Path $paths.DataDirectory -Force | Out-Null
  $state = Get-LocalQaState $paths.StatePath
  if ($null -ne $state -and (Test-ManagedQaState $state $repoRoot $ProjectId)) {
    $allPortsReady = @($script:LocalQaPorts.Values | Where-Object { -not (Test-TcpPort $_) }).Count -eq 0
    if ($allPortsReady -and (Test-LocalQaPage)) {
      Show-LocalQaReady -AlreadyRunning
      if (-not $SkipBrowser) { Start-Process $script:LocalQaLoginUrl }
      Complete-LauncherWindow
      exit 0
    }
    Throw-QaError 'Dříve spuštěné QA prostředí není kompletní.' 'Spusťte STOP_LOCAL_QA.cmd a potom START_LOCAL_QA.cmd znovu.'
  }

  if ($null -ne $state) {
    $trackedPidsStillExist = @(
      foreach ($workerState in @($state.emulators, $state.vite)) {
        if ($null -ne (Get-Process -Id ([int]$workerState.pid) -ErrorAction SilentlyContinue)) { $true }
      }
    ).Count -gt 0
    if ($trackedPidsStillExist) {
      Throw-QaError 'Existuje neověřitelný starý QA stav a některý evidovaný PID je aktivní.' 'Spusťte STOP_LOCAL_QA.cmd; pokud odmítne proces ukončit, požádejte vývojáře o pomoc.'
    }
    Remove-Item -LiteralPath $paths.StatePath -Force
  }

  if (Test-ExternalDemoEnvironment $ProjectId) {
    Write-QaInfo 'Bylo rozpoznáno externě spuštěné bezpečné demo QA prostředí.'
    Write-QaInfo 'Obnovuji idempotentní emulator seed...'
    $seedExit = Invoke-PnpmTool $pnpmTool @('seed:emulators')
    if ($seedExit -ne 0) {
      Throw-QaError 'Lokální emulator seed selhal.' 'Zkontrolujte běžící emulátory a zkuste launcher znovu.'
    }
    Show-LocalQaReady -AlreadyRunning
    Write-QaWarning 'Tyto procesy nebyly spuštěny launcherem; STOP_LOCAL_QA.cmd je proto nebude ukončovat.'
    if (-not $SkipBrowser) { Start-Process $script:LocalQaLoginUrl }
    Complete-LauncherWindow
    exit 0
  }

  foreach ($entry in $script:LocalQaPorts.GetEnumerator()) {
    if (Test-TcpPort ([int]$entry.Value)) {
      $owner = Get-PortOwnerText ([int]$entry.Value)
      Throw-QaError "Port $($entry.Value) ($($entry.Key)) už používá jiná nebo nepotvrzená aplikace: $owner." 'Ukončete konfliktní aplikaci. Neukončujte plošně všechny Node nebo Java procesy.'
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.bin\firebase.cmd')) -or
      -not (Test-Path -LiteralPath (Join-Path $repoRoot 'apps\web\node_modules\.bin\vite.cmd'))) {
    Write-QaInfo 'Projektové dependencies nejsou kompletní. Spouštím bezpečné pnpm install --frozen-lockfile...'
    $installExit = Invoke-PnpmTool $pnpmTool @('install', '--frozen-lockfile')
    if ($installExit -ne 0) {
      Throw-QaError 'Projektové dependencies se nepodařilo nainstalovat.' 'Zkontrolujte internetové připojení a zkuste launcher znovu.'
    }
  }

  $runToken = [Guid]::NewGuid().ToString('N')
  $workerScript = Join-Path $PSScriptRoot 'LocalQa.Worker.ps1'
  Write-QaInfo 'Spouštím Firebase Emulator Suite pro demo-filmovy-kviz-v2...'
  $emulatorProcess = Start-LocalQaWorker $workerScript 'emulators' $runToken $repoRoot $pnpmTool $nodeTool $javaTool $ProjectId $paths.EmulatorLog
  $startedWorkers += [pscustomobject]@{ Process = $emulatorProcess; Role = 'emulators' }
  Wait-ForPorts @(4000, 4400, 4500, 5000, 5001, 8080, 9099, 9199) $emulatorProcess $StartupTimeoutSeconds 'Firebase emulátory'
  Write-QaSuccess 'Firebase emulátory jsou připravené.'

  Write-QaInfo 'Provádím idempotentní emulator-only seed...'
  $seedExit = Invoke-PnpmTool $pnpmTool @('seed:emulators')
  if ($seedExit -ne 0) {
    Throw-QaError 'Lokální emulator seed selhal.' 'Podívejte se do .local-data/local-qa/emulators.log.'
  }
  Write-QaSuccess 'Lokální uživatelé a kvízová data jsou připravená.'

  Write-QaInfo 'Spouštím Vite na 127.0.0.1:5173...'
  $viteProcess = Start-LocalQaWorker $workerScript 'vite' $runToken $repoRoot $pnpmTool $nodeTool $javaTool $ProjectId $paths.ViteLog
  $startedWorkers += [pscustomobject]@{ Process = $viteProcess; Role = 'vite' }
  Wait-ForPorts @(5173) $viteProcess $StartupTimeoutSeconds 'Vite dev server'
  Wait-ForLocalQaPage $viteProcess $StartupTimeoutSeconds

  $statePayload = [ordered]@{
    schemaVersion = 1
    projectId = $ProjectId
    repositoryRoot = $repoRoot
    runToken = $runToken
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    emulators = [ordered]@{ pid = $emulatorProcess.Id; startedAtUtc = Get-ProcessStartUtc $emulatorProcess }
    vite = [ordered]@{ pid = $viteProcess.Id; startedAtUtc = Get-ProcessStartUtc $viteProcess }
  }
  $statePayload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $paths.StatePath -Encoding UTF8
  $stateWasWritten = $true

  Show-LocalQaReady
  if (-not $SkipBrowser) {
    Start-Process $script:LocalQaLoginUrl
    Write-QaSuccess 'Přihlašovací stránka byla otevřena ve výchozím prohlížeči.'
  }
  Complete-LauncherWindow
  exit 0
} catch {
  Write-Host ''
  Write-Host '[CHYBA]' -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red

  if (-not $stateWasWritten -and $startedWorkers.Count -gt 0) {
    Write-QaInfo 'Uklízím pouze procesy spuštěné tímto neúspěšným pokusem...'
    foreach ($worker in @($startedWorkers | Sort-Object { if ($_.Role -eq 'vite') { 0 } else { 1 } })) {
      try {
        $process = $worker.Process
        $process.Refresh()
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
      } catch {
        Write-QaWarning "Proces $($worker.Role) se nepodařilo automaticky uklidit."
      }
    }
  }
  Complete-LauncherWindow
  exit 1
}
