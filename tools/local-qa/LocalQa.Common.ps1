Set-StrictMode -Version 2.0

$script:LocalQaProjectId = 'demo-filmovy-kviz-v2'
$script:LocalQaLoginUrl = 'http://localhost:5173/admin/login'
$script:LocalQaPorts = [ordered]@{
  'Emulator UI' = 4000
  'Emulator Hub' = 4400
  'Emulator Logging' = 4500
  'Firebase Hosting' = 5000
  'Functions Emulator' = 5001
  'Vite' = 5173
  'Firestore Emulator' = 8080
  'Authentication Emulator' = 9099
  'Storage Emulator' = 9199
}

function Write-QaInfo {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-QaSuccess {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[OK]   $Message" -ForegroundColor Green
}

function Write-QaWarning {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "[POZOR] $Message" -ForegroundColor Yellow
}

function Throw-QaError {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [Parameter(Mandatory = $true)][string]$NextStep
  )

  throw [System.InvalidOperationException]::new("$Message`nCo udělat: $NextStep")
}

function Test-LoopbackHost {
  param([Parameter(Mandatory = $true)][string]$HostName)
  return $HostName -in @('127.0.0.1', 'localhost', '::1', '[::1]')
}

function Get-ExistingUniquePaths {
  param([string[]]$Candidates)

  $seen = @{}
  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    try {
      $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
      $key = $resolved.ToLowerInvariant()
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $resolved
      }
    } catch {
      # Optional discovery candidate is absent.
    }
  }
}

function Get-CommandCandidate {
  param([Parameter(Mandatory = $true)][string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
    return $command.Source
  }
  return $null
}

function Invoke-ExecutableVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$Arguments = @('--version')
  )

  $previousErrorAction = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 wraps native stderr (including `java -version`)
    # as ErrorRecord objects. They are expected version output, not failures.
    $ErrorActionPreference = 'Continue'
    $output = (& $Executable @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { return $null }
    return $output
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-VersionMajor {
  param([string]$VersionText)
  if ($VersionText -match '(?m)(?:^|\s|\")v?(\d+)(?:\.|\"|\s|$)') {
    return [int]$matches[1]
  }
  return $null
}

function Resolve-NodeTool {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $toolCandidates = @()
  $toolRoot = Join-Path $RepoRoot '.tools'
  if (Test-Path -LiteralPath $toolRoot) {
    $toolCandidates += Get-ChildItem -LiteralPath $toolRoot -Filter 'node.exe' -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
  }

  $codexRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
  $candidates = @(
    (Get-CommandCandidate 'node.exe'),
    (Join-Path $RepoRoot '.tools\node22\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
    (Join-Path $codexRoot 'node\bin\node.exe')
  )
  $candidates += $toolCandidates

  foreach ($candidate in Get-ExistingUniquePaths -Candidates $candidates) {
    $version = Invoke-ExecutableVersion $candidate
    $major = Get-VersionMajor $version
    if ($null -ne $major -and $major -ge 22) {
      return [pscustomobject]@{ Path = $candidate; Version = $version; Major = $major }
    }
  }

  Throw-QaError 'Node.js 22 nebo novější nebyl nalezen.' 'Nainstalujte Node.js 22 LTS, nebo spusťte QA znovu z Codex prostředí, které obsahuje lokální runtime.'
}

function Resolve-JavaTool {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $toolCandidates = @()
  $toolRoot = Join-Path $RepoRoot '.tools'
  if (Test-Path -LiteralPath $toolRoot) {
    $toolCandidates += Get-ChildItem -LiteralPath $toolRoot -Filter 'java.exe' -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
  }

  $javaHomeCandidate = $null
  if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $javaHomeCandidate = Join-Path $env:JAVA_HOME 'bin\java.exe'
  }

  $programCandidates = @()
  foreach ($base in @(
    (Join-Path $env:ProgramFiles 'Eclipse Adoptium'),
    (Join-Path $env:ProgramFiles 'Microsoft'),
    (Join-Path $env:ProgramFiles 'Java')
  )) {
    if (Test-Path -LiteralPath $base) {
      $programCandidates += Get-ChildItem -Path (Join-Path $base '*\bin\java.exe') -File -ErrorAction SilentlyContinue |
        ForEach-Object { $_.FullName }
    }
  }

  $candidates = @((Get-CommandCandidate 'java.exe'), $javaHomeCandidate)
  $candidates += $toolCandidates
  $candidates += $programCandidates
  foreach ($candidate in Get-ExistingUniquePaths -Candidates $candidates) {
    $version = Invoke-ExecutableVersion $candidate @('-version')
    $major = Get-VersionMajor $version
    if ($null -ne $major -and $major -ge 21) {
      $javaHome = Split-Path -Parent (Split-Path -Parent $candidate)
      return [pscustomobject]@{ Path = $candidate; Home = $javaHome; Version = ($version -split "`r?`n")[0]; Major = $major }
    }
  }

  Throw-QaError 'Java 21 nebo novější nebyla nalezena.' 'Nainstalujte Temurin JDK 21 a spusťte launcher znovu.'
}

function Resolve-PnpmTool {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool
  )

  $nodeDirectory = Split-Path -Parent $NodeTool.Path
  $env:Path = "$nodeDirectory;$env:Path"
  $codexRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
  $moduleCandidates = @(
    (Join-Path $codexRoot 'node\node_modules\pnpm\bin\pnpm.mjs')
  )
  foreach ($modulePath in Get-ExistingUniquePaths -Candidates $moduleCandidates) {
    $shimDirectory = Join-Path $RepoRoot '.local-data\local-qa\bin'
    $shimPath = Join-Path $shimDirectory 'pnpm.cmd'
    New-Item -ItemType Directory -Path $shimDirectory -Force | Out-Null
    $shimContent = "@echo off`r`n`"$($NodeTool.Path)`" `"$modulePath`" %*`r`n"
    [System.IO.File]::WriteAllText($shimPath, $shimContent, [System.Text.Encoding]::ASCII)
    $version = Invoke-ExecutableVersion $shimPath
    $major = Get-VersionMajor $version
    if ($null -ne $major -and $major -ge 11) {
      return [pscustomobject]@{ Path = $shimPath; PrefixArguments = @(); Version = $version; Major = $major; Mode = 'izolovaný Node 22 shim' }
    }
  }

  $directCandidates = @(
    (Get-CommandCandidate 'pnpm.cmd'),
    (Get-CommandCandidate 'pnpm.exe'),
    (Join-Path $env:LOCALAPPDATA 'pnpm\pnpm.cmd'),
    (Join-Path $env:APPDATA 'npm\pnpm.cmd'),
    (Join-Path $codexRoot 'bin\fallback\pnpm.cmd')
  )

  foreach ($candidate in Get-ExistingUniquePaths -Candidates $directCandidates) {
    $version = Invoke-ExecutableVersion $candidate
    $major = Get-VersionMajor $version
    if ($null -ne $major -and $major -ge 11) {
      return [pscustomobject]@{ Path = $candidate; PrefixArguments = @(); Version = $version; Major = $major; Mode = 'pnpm' }
    }
  }

  $corepackCandidates = @(
    (Get-CommandCandidate 'corepack.cmd'),
    (Join-Path $nodeDirectory 'corepack.cmd'),
    (Join-Path $RepoRoot '.tools\node22\corepack.cmd')
  )
  $oldCorepackNetwork = $env:COREPACK_ENABLE_NETWORK
  $env:COREPACK_ENABLE_NETWORK = '0'
  try {
    foreach ($candidate in Get-ExistingUniquePaths -Candidates $corepackCandidates) {
      $version = Invoke-ExecutableVersion $candidate @('pnpm', '--version')
      $major = Get-VersionMajor $version
      if ($null -ne $major -and $major -ge 11) {
        return [pscustomobject]@{ Path = $candidate; PrefixArguments = @('pnpm'); Version = $version; Major = $major; Mode = 'Corepack' }
      }
    }
  } finally {
    $env:COREPACK_ENABLE_NETWORK = $oldCorepackNetwork
  }

  Throw-QaError 'pnpm 11 nebo novější nebyl nalezen.' 'Nainstalujte pnpm 11, aktivujte jej přes Corepack, nebo spusťte QA znovu z Codex prostředí.'
}

function Resolve-GitTool {
  $codexRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
  $candidates = @(
    (Get-CommandCandidate 'git.exe'),
    (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'),
    (Join-Path $codexRoot 'native\git\cmd\git.exe')
  )
  foreach ($candidate in Get-ExistingUniquePaths -Candidates $candidates) {
    $version = Invoke-ExecutableVersion $candidate
    if (-not [string]::IsNullOrWhiteSpace($version)) {
      return [pscustomobject]@{ Path = $candidate; Version = $version }
    }
  }
  return $null
}

function Invoke-PnpmTool {
  param(
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $allArguments = @($PnpmTool.PrefixArguments) + $Arguments
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $PnpmTool.Path @allArguments 2>&1 | ForEach-Object { Write-Host "$_" }
    $exitCode = $LASTEXITCODE
    return $exitCode
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

function Get-DotEnvValues {
  param([Parameter(Mandatory = $true)][string]$Path)

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $value = $matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$matches[1]] = $value
    }
  }
  return $values
}

function Assert-SafeLocalConfiguration {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ProjectId
  )

  if (-not $ProjectId.StartsWith('demo-') -or $ProjectId -ne $script:LocalQaProjectId) {
    Throw-QaError "Nebezpečné Firebase project ID '$ProjectId'. Launcher se odmítl spustit." "Použijte pouze $script:LocalQaProjectId."
  }

  $packagePath = Join-Path $RepoRoot 'package.json'
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  $emulatorScript = [string]$package.scripts.emulators
  if ($emulatorScript -notmatch 'firebase\s+emulators:start' -or
      $emulatorScript -notmatch '--project\s+demo-filmovy-kviz-v2' -or
      $emulatorScript -match '(?i)deploy') {
    Throw-QaError 'Projektový emulator script nelze bezpečně potvrdit.' 'Neobcházejte kontrolu. Požádejte vývojáře o kontrolu package.json.'
  }

  $examplePath = Join-Path $RepoRoot 'apps\web\.env.example'
  $localPath = Join-Path $RepoRoot 'apps\web\.env.local'
  if (-not (Test-Path -LiteralPath $localPath)) {
    $exampleValues = Get-DotEnvValues $examplePath
    if ($exampleValues['VITE_FIREBASE_PROJECT_ID'] -ne $ProjectId -or
        $exampleValues['VITE_FIREBASE_USE_EMULATORS'] -ne 'true' -or
        $exampleValues['VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT'] -ne 'false') {
      Throw-QaError 'Bezpečnou lokální konfiguraci nelze vytvořit z .env.example.' 'Požádejte vývojáře o kontrolu emulator konfigurace.'
    }
    Copy-Item -LiteralPath $examplePath -Destination $localPath
    Write-QaInfo 'Vytvořena bezpečná apps/web/.env.local z emulator-only příkladu.'
  }

  $values = Get-DotEnvValues $localPath
  $safeValues = Get-DotEnvValues $examplePath
  foreach ($key in @(
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_USE_EMULATORS',
    'VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT'
  )) {
    if ($values[$key] -ne $safeValues[$key]) {
      Throw-QaError "apps/web/.env.local nemá bezpečnou demo hodnotu $key." 'Nahraďte lokální soubor obsahem apps/web/.env.example. Neukládejte sem production konfiguraci.'
    }
  }
}

function Set-SafeChildEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$JavaTool,
    [Parameter(Mandatory = $true)][string]$ProjectId
  )

  foreach ($name in @('GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'FIREBASE_TOKEN')) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
  $safeWebValues = Get-DotEnvValues (Join-Path $RepoRoot 'apps\web\.env.example')
  foreach ($key in $safeWebValues.Keys) {
    Set-Item -Path "Env:$key" -Value $safeWebValues[$key]
  }
  $env:GCLOUD_PROJECT = $ProjectId
  $env:GOOGLE_CLOUD_PROJECT = $ProjectId
  $env:VITE_FIREBASE_PROJECT_ID = $ProjectId
  $env:VITE_FIREBASE_USE_EMULATORS = 'true'
  $env:VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT = 'false'
  $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'
  $env:XDG_CONFIG_HOME = Join-Path $RepoRoot '.local-data\local-qa\firebase-config'
  New-Item -ItemType Directory -Path $env:XDG_CONFIG_HOME -Force | Out-Null
  $env:JAVA_HOME = $JavaTool.Home
  $env:Path = "$(Split-Path -Parent $NodeTool.Path);$(Split-Path -Parent $PnpmTool.Path);$(Split-Path -Parent $JavaTool.Path);$env:Path"
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMilliseconds = 400
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-LocalQaPage {
  try {
    $response = Invoke-WebRequest -Uri $script:LocalQaLoginUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200 -and $response.Content -match '<div id="root"></div>'
  } catch {
    return $false
  }
}

function Get-PortOwnerText {
  param([Parameter(Mandatory = $true)][int]$Port)
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $process) { return "$($process.ProcessName), PID $($connection.OwningProcess)" }
    return "PID $($connection.OwningProcess)"
  } catch {
    return 'neznámý proces'
  }
}

function Get-LocalQaPaths {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)
  $dataDirectory = Join-Path $RepoRoot '.local-data\local-qa'
  return [pscustomobject]@{
    DataDirectory = $dataDirectory
    StatePath = Join-Path $dataDirectory 'run-state.json'
    EmulatorLog = Join-Path $dataDirectory 'emulators.log'
    ViteLog = Join-Path $dataDirectory 'vite.log'
  }
}

function Get-LocalQaState {
  param([Parameter(Mandatory = $true)][string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  try {
    return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ProcessStartUtc {
  param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)
  return $Process.StartTime.ToUniversalTime().ToString('o')
}

function Test-TrackedWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedRole,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  try {
    $processId = [int]$Worker.pid
    $process = Get-Process -Id $processId -ErrorAction Stop
    if ((Get-ProcessStartUtc $process) -ne [string]$Worker.startedAtUtc) { return $false }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    $commandLine = [string]$cim.CommandLine
    return $commandLine -match 'LocalQa\.Worker\.ps1' -and
      $commandLine.Contains([string]$ExpectedToken) -and
      $commandLine.Contains([string]$ExpectedRole)
  } catch {
    return $false
  }
}

function Test-ManagedQaState {
  param(
    [Parameter(Mandatory = $true)][psobject]$State,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ProjectId
  )
  if ($null -eq $State -or
      [string]$State.repositoryRoot -ne $RepoRoot -or
      [string]$State.projectId -ne $ProjectId -or
      [string]::IsNullOrWhiteSpace([string]$State.runToken)) { return $false }
  return (Test-TrackedWorker $State.emulators 'emulators' $State.runToken) -and
    (Test-TrackedWorker $State.vite 'vite' $State.runToken)
}

function Stop-TrackedWorker {
  param(
    [Parameter(Mandatory = $true)][psobject]$Worker,
    [Parameter(Mandatory = $true)][string]$ExpectedRole,
    [Parameter(Mandatory = $true)][string]$ExpectedToken
  )

  if (-not (Test-TrackedWorker $Worker $ExpectedRole $ExpectedToken)) {
    $existing = Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
      Throw-QaError "Proces $ExpectedRole nebylo možné bezpečně identifikovat; nebyl ukončen." 'Zavřete pouze příslušné QA procesy ručně nebo požádejte vývojáře o pomoc.'
    }
    return
  }

  & taskkill.exe /PID ([int]$Worker.pid) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0 -and (Get-Process -Id ([int]$Worker.pid) -ErrorAction SilentlyContinue)) {
    Throw-QaError "Proces $ExpectedRole se nepodařilo ukončit." 'Zkuste STOP_LOCAL_QA.cmd znovu.'
  }
}

function ConvertTo-QuotedProcessArgument {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Start-LocalQaWorker {
  param(
    [Parameter(Mandatory = $true)][string]$WorkerScript,
    [Parameter(Mandatory = $true)][string]$Role,
    [Parameter(Mandatory = $true)][string]$RunToken,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$PnpmTool,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$JavaTool,
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  $prefix = [string]::Join('|', @($PnpmTool.PrefixArguments))
  $arguments = @(
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (ConvertTo-QuotedProcessArgument $WorkerScript),
    '-Role', $Role,
    '-RunToken', $RunToken,
    '-RepoRoot', (ConvertTo-QuotedProcessArgument $RepoRoot),
    '-PnpmExecutable', (ConvertTo-QuotedProcessArgument $PnpmTool.Path),
    '-PnpmPrefix', (ConvertTo-QuotedProcessArgument $prefix),
    '-NodeDirectory', (ConvertTo-QuotedProcessArgument (Split-Path -Parent $NodeTool.Path)),
    '-JavaHome', (ConvertTo-QuotedProcessArgument $JavaTool.Home),
    '-ProjectId', $ProjectId,
    '-LogPath', (ConvertTo-QuotedProcessArgument $LogPath)
  )
  return Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Wait-ForPorts {
  param(
    [Parameter(Mandatory = $true)][int[]]$Ports,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$WorkerProcess,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)][string]$FailureLabel
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $WorkerProcess.Refresh()
    if ($WorkerProcess.HasExited) {
      Throw-QaError "$FailureLabel skončil před dokončením startu." 'Podívejte se do .local-data/local-qa logů nebo požádejte vývojáře o pomoc.'
    }
    $missing = @($Ports | Where-Object { -not (Test-TcpPort $_) })
    if ($missing.Count -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  Throw-QaError "$FailureLabel se nepodařilo spustit v časovém limitu." 'Zkontrolujte .local-data/local-qa logy a zkuste launcher znovu.'
}

function Wait-ForLocalQaPage {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$WorkerProcess,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $WorkerProcess.Refresh()
    if ($WorkerProcess.HasExited) {
      Throw-QaError 'Vite dev server skončil před dokončením startu.' 'Podívejte se do .local-data/local-qa/vite.log.'
    }
    if (Test-LocalQaPage) { return }
    Start-Sleep -Milliseconds 400
  }
  Throw-QaError 'Lokální web se nepodařilo spustit v časovém limitu.' 'Podívejte se do .local-data/local-qa/vite.log.'
}

function Test-ExternalDemoEnvironment {
  param([Parameter(Mandatory = $true)][string]$ProjectId)

  $locator = Join-Path $env:TEMP "hub-$ProjectId.json"
  if (-not (Test-Path -LiteralPath $locator)) { return $false }
  try {
    $hub = Get-Content -LiteralPath $locator -Raw | ConvertFrom-Json
    $hubOrigin = $null
    foreach ($originText in @($hub.origins)) {
      $origin = [Uri]$originText
      if (Test-LoopbackHost $origin.Host -and $origin.Port -eq 4400 -and $origin.Scheme -eq 'http') {
        $hubOrigin = $origin.GetLeftPart([System.UriPartial]::Authority)
        break
      }
    }
    if ($null -eq $hubOrigin) { return $false }

    $hubProcessId = [int]$hub.pid
    $hubProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $hubProcessId" -ErrorAction Stop
    $hubCommandLine = [string]$hubProcess.CommandLine
    if ($hubProcess.Name -ne 'node.exe' -or
        -not $hubCommandLine.Contains('firebase.js') -or
        -not $hubCommandLine.Contains('emulators:start') -or
        -not $hubCommandLine.Contains("--project $ProjectId")) { return $false }

    $emulators = Invoke-RestMethod -Uri "$hubOrigin/emulators" -TimeoutSec 3
    $expected = @{
      auth = 9099; firestore = 8080; functions = 5001; hosting = 5000; storage = 9199; ui = 4000
    }
    foreach ($name in $expected.Keys) {
      $entry = $emulators.$name
      if ($null -eq $entry -or -not (Test-LoopbackHost ([string]$entry.host)) -or [int]$entry.port -ne $expected[$name]) {
        return $false
      }
    }
    return Test-LocalQaPage
  } catch {
    return $false
  }
}

function Show-LocalQaReady {
  param([switch]$AlreadyRunning)
  Write-Host ''
  if ($AlreadyRunning) {
    Write-QaSuccess 'Správné lokální QA prostředí již běží. Další procesy nebyly spuštěny.'
  } else {
    Write-QaSuccess 'Kvízová platforma běží lokálně.'
  }
  Write-Host ''
  Write-Host 'Adresa: http://localhost:5173/admin/login'
  Write-Host ''
  Write-Host 'Login:'
  Write-Host 'admin@example.test'
  Write-Host 'LocalQuiz123!'
  Write-Host ''
  Write-Host 'Po testování spusťte STOP_LOCAL_QA.cmd.'
}
