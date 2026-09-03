Set-StrictMode -Version 2.0

$script:TonightRepairBaseUrl = 'http://localhost:5000'

function Get-TonightRepairPaths {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $directory = Join-Path $RepoRoot '.local-data\tonight-repair'
  return [pscustomobject]@{
    Directory = $directory
    CandidateReport = Join-Path $directory 'candidate-manifest.json'
    ProgressReport = Join-Path $directory 'repair-progress.json'
    GoNoGoReport = Join-Path $directory 'go-no-go-report.json'
  }
}

function Invoke-TonightRepairCheck {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$EventPaths,
    [Parameter(Mandatory = $true)][psobject]$RepairPaths
  )

  New-Item -ItemType Directory -Path $RepairPaths.Directory -Force | Out-Null
  $env:EVENT_NIGHT_BASE_URL = $script:TonightRepairBaseUrl
  $env:EVENT_NIGHT_CANDIDATE_MANIFEST = $EventPaths.CandidateManifest
  $env:TONIGHT_REPAIR_CHECK_OUTPUT = $RepairPaths.CandidateReport
  $env:PLAYWRIGHT_EXECUTABLE_PATH = Resolve-EventNightBrowser
  $scriptPath = Join-Path $RepoRoot 'tools\tonight-repair\repair-check.mjs'
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $NodeTool.Path $scriptPath 2>&1 | ForEach-Object { Write-Host "$_" }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $RepairPaths.CandidateReport -PathType Leaf)) {
    Throw-QaError 'Lokální kontrola repair queue selhala.' 'Kandidát nebyl změněn; zkontrolujte event-night logy.'
  }
  return Get-Content -LiteralPath $RepairPaths.CandidateReport -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Invoke-TonightGoNoGo {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][psobject]$NodeTool,
    [Parameter(Mandatory = $true)][psobject]$EventPaths,
    [Parameter(Mandatory = $true)][psobject]$RepairPaths
  )

  $env:EVENT_NIGHT_CANDIDATE_MANIFEST = $EventPaths.CandidateManifest
  $env:TONIGHT_REPAIR_CHECK_OUTPUT = $RepairPaths.CandidateReport
  $env:TONIGHT_GO_NO_GO_OUTPUT = $RepairPaths.GoNoGoReport
  $scriptPath = Join-Path $RepoRoot 'tools\tonight-repair\verify-go-no-go.mjs'
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $NodeTool.Path $scriptPath 2>&1 | ForEach-Object { Write-Host "$_" }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $RepairPaths.GoNoGoReport -PathType Leaf)) {
    Throw-QaError 'Technický go/no-go verifier selhal.' 'Preflight nebyl obejit; pro dnešní večer použijte V1.'
  }
  return Get-Content -LiteralPath $RepairPaths.GoNoGoReport -Raw -Encoding UTF8 | ConvertFrom-Json
}
