param(
  [Parameter(Mandatory = $true)][ValidateSet('Fresh', 'Import')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$RunToken,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$PnpmExecutable,
  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PnpmPrefix,
  [Parameter(Mandatory = $true)][string]$NodeDirectory,
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if ($ProjectId -ne 'demo-filmovy-kviz-v2' -or -not $ProjectId.StartsWith('demo-')) {
  throw "Refusing event-night worker start for non-demo project '$ProjectId'."
}
if ([string]::IsNullOrWhiteSpace($RunToken)) { throw 'Refusing event-night worker start without a tracking token.' }

foreach ($name in @('GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG', 'FIREBASE_TOKEN')) {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
$env:GCLOUD_PROJECT = $ProjectId
$env:GOOGLE_CLOUD_PROJECT = $ProjectId
$env:VITE_FIREBASE_API_KEY = 'demo-api-key'
$env:VITE_FIREBASE_AUTH_DOMAIN = 'demo-filmovy-kviz-v2.firebaseapp.com'
$env:VITE_FIREBASE_PROJECT_ID = $ProjectId
$env:VITE_FIREBASE_STORAGE_BUCKET = 'demo-filmovy-kviz-v2.appspot.com'
$env:VITE_FIREBASE_MESSAGING_SENDER_ID = '000000000000'
$env:VITE_FIREBASE_APP_ID = '1:000000000000:web:demo'
$env:VITE_FIREBASE_USE_EMULATORS = 'true'
$env:VITE_FIREBASE_ALLOW_NON_DEMO_PROJECT = 'false'
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'
$env:XDG_CONFIG_HOME = Join-Path $RepoRoot '.local-data\event-night\firebase-config'
New-Item -ItemType Directory -Path $env:XDG_CONFIG_HOME -Force | Out-Null
$env:JAVA_HOME = $JavaHome
$env:Path = "$NodeDirectory;$(Split-Path -Parent $PnpmExecutable);$(Join-Path $JavaHome 'bin');$env:Path"

$prefixArguments = if ([string]::IsNullOrWhiteSpace($PnpmPrefix)) { @() } else { @($PnpmPrefix -split '\|') }
$eventArguments = if ($Mode -eq 'Import') { @('event-night:emulators') } else { @('event-night:emulators:fresh') }

Push-Location $RepoRoot
try {
  "[$([DateTime]::UtcNow.ToString('o'))] Starting event-night $Mode for $ProjectId." | Set-Content -LiteralPath $LogPath -Encoding UTF8
  $ErrorActionPreference = 'Continue'
  & $PnpmExecutable @prefixArguments @eventArguments 2>&1 |
    ForEach-Object { "$_" } |
    Out-File -LiteralPath $LogPath -Append -Encoding UTF8
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  exit $exitCode
} catch {
  $_ | Out-String | Add-Content -LiteralPath $LogPath -Encoding UTF8
  exit 1
} finally {
  Pop-Location
}
