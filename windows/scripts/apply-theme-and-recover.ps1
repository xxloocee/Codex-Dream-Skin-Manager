[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SkillRoot,
  [string]$ThemeDirectory,
  [string]$ImagePath,
  [string]$Name,
  [ValidateSet('auto','light','dark')][string]$Appearance = 'auto',
  [ValidateRange(0.0, 1.0)][double]$FocusX = 0.5,
  [ValidateRange(0.0, 1.0)][double]$FocusY = 0.5,
  [ValidateRange(-1.0, 1.0)][double]$PositionX = 0.0,
  [ValidateRange(-1.0, 1.0)][double]$PositionY = 0.0,
  [ValidateRange(1.0, 2.0)][double]$Zoom = 1.0,
  [ValidateSet('locked','free')][string]$PositionMode = 'locked',
  [ValidateSet('true','false')][string]$FramingEnabled = 'false',
  [ValidateSet('auto','left','right','center','none')][string]$SafeArea = 'auto',
  [ValidateSet('auto','ambient','banner','off')][string]$TaskMode = 'auto',
  [ValidatePattern('^$|^#[0-9A-Fa-f]{6}$')][string]$Accent = ''
)

$ErrorActionPreference = 'Stop'
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$scripts = $PSScriptRoot
$managerScript = Join-Path $scripts 'manager-actions.ps1'
$restoreScript = Join-Path $scripts 'restore-dream-skin.ps1'
$startScript = Join-Path $scripts 'start-dream-skin.ps1'
. (Join-Path $scripts 'common-windows.ps1')
. (Join-Path $scripts 'theme-windows.ps1')

function Invoke-RecoveryManager {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $managerScript @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine)
  }
  return ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
}

function Start-RecoveryFallbackCodex {
  try {
    $codex = Get-DreamSkinCodexInstall
    if ((Get-DreamSkinCodexProcesses -Codex $codex).Count -eq 0) {
      $null = Start-DreamSkinCodex -Codex $codex
    }
  } catch {
    Write-Warning "Codex could not be reopened after recovery failed: $($_.Exception.Message)"
  }
}

if (-not (Test-Path -LiteralPath $managerScript -PathType Leaf) -or
  -not (Test-Path -LiteralPath $restoreScript -PathType Leaf) -or
  -not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
  throw 'Theme recovery scripts are incomplete.'
}
if (-not $ThemeDirectory -and -not $ImagePath) {
  throw 'Theme recovery requires ThemeDirectory or ImagePath.'
}

# Validate the selected theme before stopping Codex or changing the active theme.
if ($ThemeDirectory) {
  $null = Read-DreamSkinTheme -ThemeDirectory $ThemeDirectory
} else {
  Assert-DreamSkinImageFile -Path ([System.IO.Path]::GetFullPath($ImagePath))
  if (-not $Name -or -not $Name.Trim()) { throw 'Theme name is required.' }
}

$operationLock = $null
$previousRecoveryLockHeld = $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD
try {
  $operationLock = Enter-DreamSkinOperationLock
  $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD = '1'
  $common = @('-SkillRoot', $SkillRoot, '-StateRoot', $StateRoot)
  try {
    $status = (Invoke-RecoveryManager -Arguments (@('-Action', 'Status') + $common)) |
      ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Cannot safely inspect Dream Skin before recovery: $($_.Exception.Message)"
  }
  $kind = "$($status.statusKind)".ToLowerInvariant()
  if ($kind -eq 'error') {
    throw 'Dream Skin state cannot be inspected safely. Use emergency restore before retrying.'
  }

  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  $statePath = $paths.State
  $originalState = $null
  $archivePath = $null
  $oldInjectorPid = 0
  $originalStateArchived = $false
  $restoreCompleted = $false

  try {
    if ($kind -in @('mismatch','uninspectable')) {
      $originalState = Read-DreamSkinState -Path $statePath
      if ($null -eq $originalState) { throw 'Recovery state disappeared before it could be inspected.' }
      $oldInjectorPid = [int]$originalState.injectorPid
      $sanitized = $originalState | ConvertTo-Json -Depth 8 | ConvertFrom-Json
      $unusedPid = [int]::MaxValue
      while (Get-Process -Id $unusedPid -ErrorAction SilentlyContinue) { $unusedPid-- }
      $sanitized.injectorPid = $unusedPid
      $sanitized.injectorStartedAt = '2000-01-01T00:00:00.0000000Z'
      $archivePath = Archive-DreamSkinStateFile -Path $statePath
      if (-not $archivePath) { throw 'Recovery state disappeared before it could be archived.' }
      $originalStateArchived = $true
      Write-DreamSkinState -Path $statePath -State $sanitized
    }

    & $restoreScript -ForceRestart -NoRelaunch
    $restoreCompleted = $true

    if ($kind -eq 'uninspectable' -and $oldInjectorPid -gt 0) {
      try { Wait-Process -Id $oldInjectorPid -Timeout 5 -ErrorAction Stop } catch {}
      if (Get-Process -Id $oldInjectorPid -ErrorAction SilentlyContinue) {
        Write-DreamSkinState -Path $statePath -State $originalState
        throw 'The uninspectable recorded process did not exit after Codex closed. Recovery stopped without terminating it.'
      }
    }

    $applyArguments = @('-Action', 'ApplyTheme', '-SkillRoot', $SkillRoot, '-StateRoot', $StateRoot)
    if ($ThemeDirectory) {
      $applyArguments += @('-ThemeDirectory', $ThemeDirectory)
    } else {
      $applyArguments += @(
        '-ImagePath', $ImagePath, '-Name', $Name, '-Appearance', $Appearance,
        '-FocusX', "$FocusX", '-FocusY', "$FocusY", '-SafeArea', $SafeArea,
        '-PositionX', "$PositionX", '-PositionY', "$PositionY", '-Zoom', "$Zoom",
        '-PositionMode', $PositionMode,
        '-FramingEnabled', "$FramingEnabled",
        '-TaskMode', $TaskMode
      )
      if (-not [string]::IsNullOrWhiteSpace($Accent)) {
        $applyArguments += @('-Accent', $Accent)
      }
    }
    $null = Invoke-RecoveryManager -Arguments $applyArguments
    & $startScript -RestartExisting

    [ordered]@{
      recovered = $true
      previousStatus = $kind
      archivedState = if ($archivePath) { "$archivePath" } else { '' }
    } | ConvertTo-Json -Depth 4
  } catch {
    if (-not $restoreCompleted -and $originalStateArchived -and $null -ne $originalState) {
      try { Write-DreamSkinState -Path $statePath -State $originalState } catch {
        Write-Warning "The original diagnostic state remains archived at $archivePath"
      }
    }
    Start-RecoveryFallbackCodex
    throw
  }
} finally {
  if ($null -eq $previousRecoveryLockHeld) {
    Remove-Item Env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD -ErrorAction SilentlyContinue
  } else {
    $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD = $previousRecoveryLockHeld
  }
  if ($null -ne $operationLock) {
    Exit-DreamSkinOperationLock -Mutex $operationLock
  }
}
