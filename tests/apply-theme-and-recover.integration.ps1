[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RecoveryScript)

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-recovery-test-' + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $testRoot 'windows\scripts'
$stateRoot = Join-Path $testRoot 'local\CodexDreamSkin'
$themeDirectory = Join-Path $stateRoot 'themes\selected'
$imagePath = Join-Path $testRoot 'selected.jpg'
$logPath = Join-Path $testRoot 'operations.log'
$kindPath = Join-Path $testRoot 'status-kind.txt'

function Write-Utf8([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.Encoding]::UTF8)
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ("$Expected" -cne "$Actual") { throw "$Message Expected '$Expected', got '$Actual'." }
}

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Write-TestState {
  $state = [ordered]@{
    schemaVersion = 3; platform = 'windows'; port = 9335; injectorPid = $PID
    injectorStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    injectorPath = 'C:\fixture\injector.mjs'; nodePath = 'C:\fixture\node.exe'
    codexExe = 'C:\fixture\Codex.exe'; codexPackageRoot = 'C:\fixture'
    codexPackageFullName = 'fixture'; codexPackageFamilyName = 'fixture'; browserId = 'fixture-browser'
  }
  Write-Utf8 (Join-Path $stateRoot 'state.json') (($state | ConvertTo-Json -Depth 5) + "`r`n")
}

function Invoke-Recovery([switch]$UseImage) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $arguments = @('-SkillRoot', (Join-Path $testRoot 'windows'))
    if ($UseImage) {
      $arguments += @(
        '-ImagePath', $imagePath, '-Name', 'Selected image',
        '-PositionX', '0.4', '-PositionY', '-0.3', '-Zoom', '1.5', '-PositionMode', 'free',
        '-FramingEnabled', 'true'
      )
    } else {
      $arguments += @('-ThemeDirectory', $themeDirectory)
    }
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
      (Join-Path $scripts 'apply-theme-and-recover.ps1') @arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine) }
}

try {
  New-Item -ItemType Directory -Force -Path $scripts, $themeDirectory | Out-Null
  Copy-Item -LiteralPath $RecoveryScript -Destination (Join-Path $scripts 'apply-theme-and-recover.ps1')
  Write-Utf8 (Join-Path $themeDirectory 'theme.json') '{"name":"Selected","image":"background.jpg"}'
  Write-Utf8 (Join-Path $themeDirectory 'background.jpg') 'fixture-image'
  Write-Utf8 $imagePath 'fixture-image'

  Write-Utf8 (Join-Path $scripts 'common-windows.ps1') @'
function Get-DreamSkinThemePaths {
  param([string]$StateRoot)
  [pscustomobject]@{ Root = $StateRoot; State = (Join-Path $StateRoot 'state.json') }
}
function Enter-DreamSkinOperationLock {
  $mutex = [System.Threading.Mutex]::new($false, $env:RECOVERY_TEST_MUTEX)
  $acquired = $false
  try { $acquired = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { $mutex.Dispose(); throw 'recovery operation lock is already held' }
  return $mutex
}
function Exit-DreamSkinOperationLock {
  param([System.Threading.Mutex]$Mutex)
  try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() }
}
function Read-DreamSkinState {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-Content -LiteralPath $Path -Raw) | ConvertFrom-Json
}
function Write-DreamSkinState {
  param([string]$Path, [object]$State)
  if ($env:RECOVERY_TEST_FAIL_SANITIZED -eq '1' -and "$($State.injectorStartedAt)" -like '2000-*') {
    throw 'simulated sanitized state write failure'
  }
  [System.IO.File]::WriteAllText($Path, (($State | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
}
function Archive-DreamSkinStateFile {
  param([string]$Path)
  $archive = Join-Path (Split-Path -Parent $Path) ('state.archived-' + [guid]::NewGuid().ToString('N') + '.json')
  Move-Item -LiteralPath $Path -Destination $archive
  return $archive
}
function Get-DreamSkinCodexInstall { return [pscustomobject]@{ Executable = 'C:\fixture\Codex.exe' } }
function Get-DreamSkinCodexProcesses { param([object]$Codex) return @() }
function Start-DreamSkinCodex {
  param([object]$Codex)
  Add-Content -LiteralPath $env:RECOVERY_TEST_LOG -Value 'fallback'
  return $null
}
'@
  Write-Utf8 (Join-Path $scripts 'theme-windows.ps1') @'
function Read-DreamSkinTheme {
  param([string]$ThemeDirectory)
  if (-not (Test-Path -LiteralPath (Join-Path $ThemeDirectory 'theme.json'))) { throw 'missing theme' }
  return [pscustomobject]@{ Theme = [pscustomobject]@{ name = 'Selected' } }
}
function Assert-DreamSkinImageFile { param([string]$Path) if (-not (Test-Path -LiteralPath $Path)) { throw 'missing image' } }
'@
  Write-Utf8 (Join-Path $scripts 'manager-actions.ps1') @'
param([string]$Action,[string]$SkillRoot,[string]$StateRoot,[string]$ThemeDirectory,[string]$ImagePath,
  [string]$Name,[string]$Appearance,[double]$FocusX,[double]$FocusY,
  [double]$PositionX,[double]$PositionY,[double]$Zoom,[string]$PositionMode,[string]$FramingEnabled,
  [string]$SafeArea,[string]$TaskMode,[string]$Accent)
if ($Action -eq 'Status') {
  [ordered]@{ statusKind = (Get-Content -LiteralPath $env:RECOVERY_TEST_KIND -Raw).Trim() } | ConvertTo-Json
} elseif ($Action -eq 'ApplyTheme') {
  if ($Name -eq 'Selected image' -and
      ($PositionX -ne 0.4 -or $PositionY -ne -0.3 -or $Zoom -ne 1.5 -or
       $PositionMode -ne 'free' -or $FramingEnabled -ne 'true')) {
    throw 'custom framing arguments were not preserved'
  }
  Add-Content -LiteralPath $env:RECOVERY_TEST_LOG -Value 'apply'
  [ordered]@{ applied = $true } | ConvertTo-Json
} else { throw "unexpected action: $Action" }
'@
  Write-Utf8 (Join-Path $scripts 'restore-dream-skin.ps1') @'
param([switch]$ForceRestart,[switch]$NoRelaunch)
Add-Content -LiteralPath $env:RECOVERY_TEST_LOG -Value 'restore'
Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\state.json') -Force -ErrorAction SilentlyContinue
'@
  Write-Utf8 (Join-Path $scripts 'start-dream-skin.ps1') @'
param([switch]$RestartExisting)
Add-Content -LiteralPath $env:RECOVERY_TEST_LOG -Value 'start'
'@

  $previousLocalAppData = $env:LOCALAPPDATA
  $previousLog = $env:RECOVERY_TEST_LOG
  $previousKind = $env:RECOVERY_TEST_KIND
  $previousMutex = $env:RECOVERY_TEST_MUTEX
  $previousFailSanitized = $env:RECOVERY_TEST_FAIL_SANITIZED
  $env:LOCALAPPDATA = Join-Path $testRoot 'local'
  $env:RECOVERY_TEST_LOG = $logPath
  $env:RECOVERY_TEST_KIND = $kindPath
  $env:RECOVERY_TEST_MUTEX = 'Local\DreamSkinRecoveryTest.' + [guid]::NewGuid().ToString('N')
  Remove-Item Env:RECOVERY_TEST_FAIL_SANITIZED -ErrorAction SilentlyContinue
  try {
    Write-TestState
    Write-Utf8 $kindPath 'mismatch'
    $mismatch = Invoke-Recovery
    Assert-Equal 0 $mismatch.ExitCode 'Mismatch recovery failed.'
    Assert-Equal "restore`r`napply`r`nstart" ((Get-Content -LiteralPath $logPath) -join "`r`n") 'Mismatch recovery order changed.'
    Assert-True ($null -ne (Get-Process -Id $PID -ErrorAction SilentlyContinue)) 'Mismatch recovery terminated the unrelated PID.'
    Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter 'state.archived-*.json').Count -eq 1) 'Mismatch state was not archived.'
    Write-Host 'PASS: mismatch recovery archives the bad PID association without terminating it'

    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $stateRoot -Filter 'state.archived-*.json' | Remove-Item -Force
    Write-TestState
    Write-Utf8 $kindPath 'mismatch'
    $imageRecovery = Invoke-Recovery -UseImage
    Assert-Equal 0 $imageRecovery.ExitCode 'Image recovery with an empty accent failed.'
    Assert-Equal "restore`r`napply`r`nstart" ((Get-Content -LiteralPath $logPath) -join "`r`n") 'Image recovery order changed.'
    Write-Host 'PASS: image recovery omits an empty accent argument safely'

    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $stateRoot -Filter 'state.archived-*.json' | Remove-Item -Force
    Write-TestState
    Write-Utf8 $kindPath 'uninspectable'
    $uninspectable = Invoke-Recovery
    Assert-True ($uninspectable.ExitCode -ne 0) 'Uninspectable recovery unexpectedly succeeded while the PID remained alive.'
    $operations = @((Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue))
    Assert-True ($operations -contains 'restore') 'Uninspectable recovery did not close Codex first.'
    Assert-True ($operations -contains 'fallback') 'Uninspectable recovery did not reopen Codex after aborting.'
    Assert-True ($operations -notcontains 'apply') 'Uninspectable recovery changed the theme before proving the old process exited.'
    Assert-True ($operations -notcontains 'start') 'Uninspectable recovery started a second watcher.'
    Assert-True (@($operations | Where-Object { $_ -eq 'fallback' }).Count -eq 1) 'Uninspectable recovery reopened Codex more than once.'
    Assert-True (Test-Path -LiteralPath (Join-Path $stateRoot 'state.json')) 'Uninspectable recovery did not restore diagnostic state.'
    Assert-True ($null -ne (Get-Process -Id $PID -ErrorAction SilentlyContinue)) 'Uninspectable recovery terminated the unknown PID.'
    Write-Host 'PASS: uninspectable recovery aborts safely before applying the theme'

    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $stateRoot -Filter 'state.archived-*.json' | Remove-Item -Force
    Write-TestState
    Write-Utf8 $kindPath 'mismatch'
    $env:RECOVERY_TEST_FAIL_SANITIZED = '1'
    $writeFailure = Invoke-Recovery
    Assert-True ($writeFailure.ExitCode -ne 0) 'Sanitized state write failure unexpectedly succeeded.'
    $restoredAfterWriteFailure = Get-Content -LiteralPath (Join-Path $stateRoot 'state.json') -Raw | ConvertFrom-Json
    Assert-Equal $PID ([int]$restoredAfterWriteFailure.injectorPid) 'Original state was not restored after sanitized write failure.'
    Assert-True (@(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue) -contains 'fallback') 'Write failure did not reopen Codex.'
    Remove-Item Env:RECOVERY_TEST_FAIL_SANITIZED -ErrorAction SilentlyContinue
    Write-Host 'PASS: sanitized state write failure restores the original diagnostic state'

    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $stateRoot -Filter 'state.archived-*.json' | Remove-Item -Force
    Write-TestState
    Write-Utf8 $kindPath 'mismatch'
    $heldMutex = [System.Threading.Mutex]::new($false, $env:RECOVERY_TEST_MUTEX)
    $heldMutex.WaitOne() | Out-Null
    try {
      $blocked = Invoke-Recovery
      Assert-True ($blocked.ExitCode -ne 0) 'Recovery ignored an existing operation lock.'
      Assert-True (-not (Test-Path -LiteralPath $logPath)) 'Recovery performed work while another operation held the lock.'
    } finally {
      $heldMutex.ReleaseMutex()
      $heldMutex.Dispose()
    }
    Write-Host 'PASS: recovery honors the cross-stage operation lock'
  } finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:RECOVERY_TEST_LOG = $previousLog
    $env:RECOVERY_TEST_KIND = $previousKind
    if ($null -eq $previousMutex) { Remove-Item Env:RECOVERY_TEST_MUTEX -ErrorAction SilentlyContinue } else { $env:RECOVERY_TEST_MUTEX = $previousMutex }
    if ($null -eq $previousFailSanitized) { Remove-Item Env:RECOVERY_TEST_FAIL_SANITIZED -ErrorAction SilentlyContinue } else { $env:RECOVERY_TEST_FAIL_SANITIZED = $previousFailSanitized }
  }
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
