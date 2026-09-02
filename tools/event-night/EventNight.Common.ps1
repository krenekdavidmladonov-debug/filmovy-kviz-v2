Set-StrictMode -Version 2.0

$script:EventNightProjectId = 'demo-filmovy-kviz-v2'
$script:EventNightUrl = 'http://localhost:5000/admin/login'
$script:EventNightPorts = [ordered]@{
  'Emulator UI' = 4000
  'Emulator Hub' = 4400
  'Emulator Logging' = 4500
  'Firebase Hosting' = 5000
  'Functions Emulator' = 5001
  'Firestore Emulator' = 8080
  'Authentication Emulator' = 9099
  'Storage Emulator' = 9199
}

function Get-EventNightPaths {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $dataDirectory = Join-Path $RepoRoot '.local-data\event-night'
  return [pscustomobject]@{
    DataDirectory = $dataDirectory
    SnapshotDirectory = Join-Path $dataDirectory 'emulator-data'
    ExportStaging = Join-Path $dataDirectory 'export-staging'
    BackupDirectory = Join-Path $dataDirectory 'backups'
    StatePath = Join-Path $dataDirectory 'run-state.json'
    BuildManifest = Join-Path $dataDirectory 'build-manifest.json'
    HealthPath = Join-Path $dataDirectory 'health.json'
    EmulatorLog = Join-Path $dataDirectory 'emulators.log'
    CandidateManifest = Join-Path $RepoRoot '.local-data\tomorrow-candidate\candidate-manifest.json'
  }
}

function Set-EventNightEmulatorEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectId)

  if ($ProjectId -ne $script:EventNightProjectId -or -not $ProjectId.StartsWith('demo-')) {
    Throw-QaError "Nepovolené event-night project ID '$ProjectId'." "Použijte pouze $script:EventNightProjectId."
  }
  $env:GCLOUD_PROJECT = $ProjectId
  $env:GOOGLE_CLOUD_PROJECT = $ProjectId
  $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
  $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
  $env:FUNCTIONS_EMULATOR_HOST = '127.0.0.1:5001'
  $env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
}

function Assert-EventNightPath {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $localRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot '.local-data\event-night'))
  $resolved = [System.IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($localRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Throw-QaError "Event-night cesta opustila povolený lokální adresář: $resolved" 'Nepokračujte a požádejte vývojáře o kontrolu launcheru.'
  }
}

function Get-EventNightFileRecords {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string[]]$ExcludedNames = @()
  )

  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $rootPrefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
  return @(
    Get-ChildItem -LiteralPath $Root -File -Recurse |
      Where-Object { $_.Name -notin $ExcludedNames } |
      Sort-Object FullName |
      ForEach-Object {
        $fullName = [System.IO.Path]::GetFullPath($_.FullName)
        if (-not $fullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
          Throw-QaError "Soubor opustil kontrolovaný event-night adresář: $fullName" 'Nepokračujte a požádejte vývojáře o kontrolu launcheru.'
        }
        [ordered]@{
          path = $fullName.Substring($rootPrefix.Length).Replace('\', '/')
          bytes = $_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
  )
}

function Get-EventNightGitHead {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool
  )

  $head = (& $GitTool.Path -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
    Throw-QaError 'Nelze určit release HEAD pro production build.' 'Zkontrolujte Git checkout a spusťte přípravu znovu.'
  }
  return $head
}

function New-EventNightBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $dist = Join-Path $RepoRoot 'apps\web\dist'
  $records = @(Get-EventNightFileRecords $dist)
  if ($records.Count -eq 0 -or -not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
    Throw-QaError 'Production build je prázdný nebo neobsahuje index.html.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    projectId = $script:EventNightProjectId
    sourceHead = Get-EventNightGitHead $RepoRoot $GitTool
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    files = $records
  }
  New-Item -ItemType Directory -Path $Paths.DataDirectory -Force | Out-Null
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Paths.BuildManifest -Encoding UTF8
}

function Assert-EventNightRecords {
  param(
    [Parameter(Mandatory = $true)][object[]]$Expected,
    [Parameter(Mandatory = $true)][object[]]$Actual,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ($Expected.Count -ne $Actual.Count) {
    Throw-QaError "$Label nesouhlasí: jiný počet souborů." 'Spusťte bezpečnou přípravu znovu; nepoužívejte neověřená data.'
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    $left = $Expected[$index]
    $right = $Actual[$index]
    if ([string]$left.path -ne [string]$right.path -or
        [long]$left.bytes -ne [long]$right.bytes -or
        [string]$left.sha256 -ne [string]$right.sha256) {
      Throw-QaError "$Label nesouhlasí u souboru '$($right.path)'." 'Spusťte bezpečnou přípravu znovu; nepoužívejte poškozená data.'
    }
  }
}

function Assert-EventNightBuildManifest {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$GitTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  if (-not (Test-Path -LiteralPath $Paths.BuildManifest -PathType Leaf)) {
    Throw-QaError 'Chybí manifest production buildu.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath $Paths.BuildManifest -Raw | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.projectId -ne $script:EventNightProjectId) {
    Throw-QaError 'Manifest buildu nemá bezpečný event-night formát nebo demo projekt.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  $head = Get-EventNightGitHead $RepoRoot $GitTool
  if ([string]$manifest.sourceHead -ne $head) {
    Throw-QaError 'Production build neodpovídá aktuálnímu release HEAD.' 'Spusťte PREPARE_EVENT_NIGHT.cmd na správném release commitu.'
  }
  $actual = @(Get-EventNightFileRecords (Join-Path $RepoRoot 'apps\web\dist'))
  Assert-EventNightRecords @($manifest.files) $actual 'SHA-256 manifest production buildu'
}

function Get-EventNightCandidate {
  param([Parameter(Mandatory = $true)][psobject]$Paths)

  if (-not (Test-Path -LiteralPath $Paths.CandidateManifest -PathType Leaf)) {
    Throw-QaError 'Chybí lokální manifest vybraného kvízu.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath $Paths.CandidateManifest -Raw | ConvertFrom-Json
  if ([int]$manifest.schemaVersion -ne 1 -or
      [string]$manifest.projectId -ne $script:EventNightProjectId -or
      [string]::IsNullOrWhiteSpace([string]$manifest.candidate.quizId)) {
    Throw-QaError 'Candidate manifest není bezpečný nebo je neúplný.' 'Spusťte PREPARE_EVENT_NIGHT.cmd znovu.'
  }
  return $manifest.candidate
}

function New-EventNightSnapshotManifest {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotDirectory,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  if (-not (Test-Path -LiteralPath (Join-Path $SnapshotDirectory 'firebase-export-metadata.json') -PathType Leaf)) {
    Throw-QaError 'Firebase emulator export neobsahuje metadata.' 'Ponechte poslední known-good snapshot a přípravu nebo backup zopakujte.'
  }
  $candidate = Get-EventNightCandidate $Paths
  $health = if (Test-Path -LiteralPath $Paths.HealthPath -PathType Leaf) {
    Get-Content -LiteralPath $Paths.HealthPath -Raw | ConvertFrom-Json
  } else { $null }
  $manifest = [ordered]@{
    schemaVersion = 1
    projectId = $script:EventNightProjectId
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    candidateQuizId = [string]$candidate.quizId
    readiness = if ($null -eq $health) { $null } else { [ordered]@{
      status = [string]$health.readiness.status
      blockers = [int]$health.readiness.blockers
      warnings = [int]$health.readiness.warnings
    } }
    files = @(Get-EventNightFileRecords $SnapshotDirectory @('.event-night-manifest.json'))
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $SnapshotDirectory '.event-night-manifest.json') -Encoding UTF8
}

function Assert-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$SnapshotDirectory,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $manifestPath = Join-Path $SnapshotDirectory '.event-night-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Throw-QaError 'Persistentní snapshot nemá event-night manifest.' 'Nejdřív spusťte PREPARE_EVENT_NIGHT.cmd.'
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $candidate = Get-EventNightCandidate $Paths
  if ([int]$manifest.schemaVersion -ne 1 -or
      [string]$manifest.projectId -ne $script:EventNightProjectId -or
      [string]$manifest.candidateQuizId -ne [string]$candidate.quizId) {
    Throw-QaError 'Persistentní snapshot nepatří demo projektu nebo vybranému kvízu.' 'Nepokračujte; vytvořte nový snapshot přes PREPARE_EVENT_NIGHT.cmd.'
  }
  $actual = @(Get-EventNightFileRecords $SnapshotDirectory @('.event-night-manifest.json'))
  Assert-EventNightRecords @($manifest.files) $actual 'SHA-256 manifest persistentního snapshotu'
  return $manifest
}

function Backup-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$Paths,
    [string]$Reason = 'before-start'
  )

  Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  New-Item -ItemType Directory -Path $Paths.BackupDirectory -Force | Out-Null
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
  $target = Join-Path $Paths.BackupDirectory "$stamp-$Reason"
  Assert-EventNightPath $RepoRoot $target
  Copy-Item -LiteralPath $Paths.SnapshotDirectory -Destination $target -Recurse
  Assert-EventNightSnapshot $target $Paths | Out-Null
  return $target
}

function Test-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  try {
    $processId = [int]$Worker.pid
    $process = Get-Process -Id $processId -ErrorAction Stop
    $expectedStartUtc = [DateTime]::Parse(
      [string]$Worker.startedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
    if ($process.StartTime.ToUniversalTime().Ticks -ne $expectedStartUtc.Ticks) { return $false }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    $commandLine = [string]$cim.CommandLine
    return $commandLine -match 'EventNight\.Worker\.ps1' -and $commandLine.Contains($ExpectedToken)
  } catch {
    return $false
  }
}

function Start-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('Fresh', 'Import')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$RunToken,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$JavaTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $workerScript = Join-Path $PSScriptRoot 'EventNight.Worker.ps1'
  $prefix = [string]::Join('|', @($PnpmTool.PrefixArguments))
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-QuotedProcessArgument $workerScript),
    '-Mode', $Mode, '-RunToken', $RunToken, '-RepoRoot', (ConvertTo-QuotedProcessArgument $RepoRoot),
    '-PnpmExecutable', (ConvertTo-QuotedProcessArgument $PnpmTool.Path), '-PnpmPrefix', (ConvertTo-QuotedProcessArgument $prefix),
    '-NodeDirectory', (ConvertTo-QuotedProcessArgument (Split-Path -Parent $NodeTool.Path)),
    '-JavaHome', (ConvertTo-QuotedProcessArgument $JavaTool.Home), '-ProjectId', $script:EventNightProjectId,
    '-LogPath', (ConvertTo-QuotedProcessArgument $Paths.EmulatorLog)
  )
  return Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Stop-EventNightWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  if (-not (Test-EventNightWorker $Worker $ExpectedToken)) {
    if ($null -ne (Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue)) {
      Throw-QaError 'Event-night proces nelze bezpečně identifikovat; nebyl ukončen.' 'Neukončujte plošně Node/Java. Požádejte vývojáře o kontrolu.'
    }
    return
  }
  & taskkill.exe /PID ([int]$Worker.pid) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0 -and $null -ne (Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue)) {
    Throw-QaError 'Event-night proces se nepodařilo ukončit.' 'Zkuste STOP_EVENT_NIGHT.cmd znovu.'
  }
}

function Test-EventNightPage {
  try {
    $response = Invoke-WebRequest -Uri $script:EventNightUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200 -and $response.Content -match '<div id="root"></div>'
  } catch { return $false }
}

function Wait-ForEventNightPage {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$WorkerProcess,
    [int]$TimeoutSeconds = 180
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $WorkerProcess.Refresh()
    if ($WorkerProcess.HasExited) {
      Throw-QaError 'Event-night emulátory skončily během startu.' 'Zkontrolujte .local-data/event-night/emulators.log.'
    }
    if (Test-EventNightPage) { return }
    Start-Sleep -Milliseconds 400
  }
  Throw-QaError 'Production Hosting Emulator se nepodařilo spustit.' 'Zkontrolujte event-night log a port 5000.'
}

function Resolve-EventNightBrowser {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
  )
  foreach ($candidate in Get-ExistingUniquePaths $candidates) { return $candidate }
  Throw-QaError 'Chrome ani Edge nebyl nalezen pro lokální health check.' 'Nainstalujte Chrome/Edge a spusťte launcher znovu.'
}

function Invoke-EventNightHealth {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$Paths
  )

  $env:EVENT_NIGHT_BASE_URL = 'http://localhost:5000'
  $env:EVENT_NIGHT_CANDIDATE_MANIFEST = $Paths.CandidateManifest
  $env:EVENT_NIGHT_HEALTH_OUTPUT = $Paths.HealthPath
  $env:PLAYWRIGHT_EXECUTABLE_PATH = Resolve-EventNightBrowser
  $scriptPath = Join-Path $RepoRoot 'tools\event-night\health-check.mjs'
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $NodeTool.Path $scriptPath 2>&1 | ForEach-Object { Write-Host "$_" }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $Paths.HealthPath -PathType Leaf)) {
    Throw-QaError 'Event-night browser health check selhal.' 'Zkontrolujte lokální emulátory a .local-data/event-night logy.'
  }
  return Get-Content -LiteralPath $Paths.HealthPath -Raw | ConvertFrom-Json
}

function Export-EventNightSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$Paths,
    [switch]$Promote
  )

  Assert-EventNightPath $RepoRoot $Paths.ExportStaging
  if (Test-Path -LiteralPath $Paths.ExportStaging) {
    Remove-Item -LiteralPath $Paths.ExportStaging -Recurse -Force
  }
  $exportExit = Invoke-PnpmTool $PnpmTool @('event-night:export')
  if ($exportExit -ne 0) {
    Throw-QaError 'Graceful Firebase emulator export selhal.' 'Běžící data nebyla nahrazena; zkontrolujte log a export zopakujte.'
  }
  New-EventNightSnapshotManifest $Paths.ExportStaging $Paths
  Assert-EventNightSnapshot $Paths.ExportStaging $Paths | Out-Null
  if (-not $Promote) { return $Paths.ExportStaging }

  New-Item -ItemType Directory -Path $Paths.BackupDirectory -Force | Out-Null
  $previous = $null
  if (Test-Path -LiteralPath $Paths.SnapshotDirectory) {
    Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $previous = Join-Path $Paths.BackupDirectory "$stamp-before-export"
    Assert-EventNightPath $RepoRoot $previous
    Move-Item -LiteralPath $Paths.SnapshotDirectory -Destination $previous
  }
  try {
    Move-Item -LiteralPath $Paths.ExportStaging -Destination $Paths.SnapshotDirectory
    Assert-EventNightSnapshot $Paths.SnapshotDirectory $Paths | Out-Null
  } catch {
    if ($null -ne $previous -and -not (Test-Path -LiteralPath $Paths.SnapshotDirectory)) {
      Move-Item -LiteralPath $previous -Destination $Paths.SnapshotDirectory
    }
    throw
  }
  return $Paths.SnapshotDirectory
}

function Get-EventNightState {
  param([Parameter(Mandatory = $true)][psobject]$Paths)
  if (-not (Test-Path -LiteralPath $Paths.StatePath -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $Paths.StatePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Write-EventNightReady {
  param([Parameter(Mandatory = $true)][psobject]$Health)

  Write-Host ''
  Write-QaSuccess 'Kvízová platforma běží lokálně.'
  Write-Host ''
  Write-Host "Kvíz: $($Health.candidateTitle)"
  $readiness = if ([int]$Health.readiness.blockers -eq 0) { 'READY' } else { "BLOCKED — $($Health.readiness.blockers) problémů" }
  Write-Host "Připravenost: $readiness"
  Write-Host "URL: $script:EventNightUrl"
  Write-Host ''
  Write-Host 'Login:'
  Write-Host 'admin@example.test'
  Write-Host 'LocalQuiz123!'
  Write-Host ''
  Write-Host 'Po skončení vždy spusťte STOP_EVENT_NIGHT.cmd.'
}
