# Private Windows status/publication primitives used by the shared manager.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Status','ApplyTheme')][string]$Action,
  [Parameter(Mandatory = $true)][string]$SkillRoot,
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
  [string]$ThemeDirectory,
  [switch]$DeferLiveApply,
  [switch]$OpacityOnly,
  [string]$RefreshRequestPath
)
$ErrorActionPreference = 'Stop'
if ($OpacityOnly -and ($Action -ne 'ApplyTheme' -or $DeferLiveApply)) {
  throw 'Opacity-only updates require immediate theme application.'
}
if ($OpacityOnly -and ($env:CODEX_MANAGER_RUNTIME_INTERNAL -ne '1' -or
  $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD -ne '1' -or -not $RefreshRequestPath)) {
  throw 'Opacity-only updates require a locked shared-manager refresh request.'
}
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')
. (Join-Path $PSScriptRoot 'runtime-version.ps1')
$paths = Get-DreamSkinThemePaths -StateRoot $StateRoot

function Get-ManagerInjectorStatus {
  param([AllowNull()][object]$State)
  if ($null -eq $State) {
    return [pscustomobject]@{ Kind = 'stopped'; Message = '未检测到皮肤注入器。'; Running = $false }
  }
  if (-not $State.injectorPid) {
    if ($State.connectionOnly -is [bool] -and $State.connectionOnly) {
      return [pscustomobject]@{ Kind = 'stopped'; Message = 'Codex 已连接，皮肤尚未启用。'; Running = $false }
    }
    return [pscustomobject]@{ Kind = 'stale'; Message = '状态文件缺少注入器进程编号。'; Running = $false }
  }

  $processId = [int]$State.injectorPid
  $visibleProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $visibleProcess) {
    return [pscustomobject]@{ Kind = 'stale'; Message = "记录的注入器进程已不存在（PID $processId）。"; Running = $false }
  }
  # A restart can reuse the old injector's PID for an unrelated process.
  # A readable, different start time proves the saved watcher has ended; it
  # does not indicate an unsafe live injector that needs forced recovery.
  $currentStartedAt = Get-DreamSkinProcessStartedAt -ProcessId $processId
  if ($currentStartedAt -and $State.injectorStartedAt) {
    if ((Test-DreamSkinTimestampEqual -Left $State.injectorStartedAt -Right $State.injectorStartedAt) -and
      -not (Test-DreamSkinTimestampEqual -Left $currentStartedAt -Right $State.injectorStartedAt)) {
      return [pscustomobject]@{
        Kind = 'stale'
        Message = "原皮肤注入器已结束，PID $processId 已由其他进程使用；可重新应用皮肤。"
        Running = $false
      }
    }
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -OperationTimeoutSec 3 -ErrorAction SilentlyContinue
  if (-not $process) {
    return [pscustomobject]@{ Kind = 'uninspectable'; Message = "进程存在，但系统不允许核验其命令行（PID $processId）。"; Running = $false }
  }

  $expectedInjector = if ($State.injectorPath) {
    "$($State.injectorPath)"
  } elseif ($State.skillRoot) {
    Join-Path "$($State.skillRoot)" 'scripts\injector.mjs'
  } else { $null }
  $runtimeCurrent = $true
  if ($State.runtimeFingerprint) {
    $runtimeCurrent = Test-DreamSkinRuntimeCurrent -SkillRoot $SkillRoot -RecordedInjectorPath $expectedInjector `
      -RecordedFingerprint "$($State.runtimeFingerprint)"
  }
  if (-not $runtimeCurrent) {
    return [pscustomobject]@{
      Kind = 'stale'
      Message = '皮肤运行时已更新，需要重新应用后才能使用新功能。'
      Running = $false
    }
  }
  $processPath = Get-DreamSkinProcessExecutablePath -ProcessInfo $process
  $commandLine = "$($process.CommandLine)"
  if (-not $processPath -or -not $commandLine) {
    # Some Windows installations hide a packaged Node process' path and
    # command line even from the same-user manager.  Keep the live session
    # usable when the PID is still a node process and its recorded start time
    # matches exactly; a reused PID cannot pass this continuity check.
    $continuity = $false
    if ($State.injectorStartedAt -and "$($process.Name)" -ieq 'node.exe') {
      try {
        $startedAt = Get-DreamSkinProcessStartedAt -ProcessId $processId
        $continuity = Test-DreamSkinTimestampEqual -Left $startedAt -Right "$($State.injectorStartedAt)"
      } catch { $continuity = $false }
    }
    if ($continuity) {
      return [pscustomobject]@{
        Kind = 'running'
        Message = "皮肤注入器正在运行（PID $processId；Windows 未提供进程路径，已依据启动时间确认）。"
        Running = $true
      }
    }
    return [pscustomobject]@{ Kind = 'uninspectable'; Message = "无法核验注入器进程身份（PID $processId）。"; Running = $false }
  }

  $matches = [System.IO.Path]::GetFileName("$processPath") -ieq 'node.exe'
  if ($State.nodePath) {
    $matches = $matches -and (Test-DreamSkinPathEqual -Left $processPath -Right "$($State.nodePath)")
  }
  $matches = $matches -and [bool]($expectedInjector -and
    (Test-DreamSkinCommandLineToken -CommandLine $commandLine -Token $expectedInjector) -and
    (Test-DreamSkinCommandLineToken -CommandLine $commandLine -Token '--watch'))
  if ($State.port) {
    $portPattern = '(?i)(?:^|\s)--port(?:=|\s+)' + [regex]::Escape("$($State.port)") + '(?=$|\s)'
    $matches = $matches -and [regex]::IsMatch($commandLine, $portPattern)
  } else { $matches = $false }
  if ($State.browserId) {
    $browserPattern = '(?:^|\s)(?i:--browser-id)(?:=|\s+)' + [regex]::Escape("$($State.browserId)") + '(?=$|\s)'
    $matches = $matches -and [regex]::IsMatch($commandLine, $browserPattern)
  }
  $startedAt = Get-DreamSkinProcessStartedAt -ProcessId $processId
  if ($State.injectorStartedAt) {
    $matches = $matches -and
      (Test-DreamSkinTimestampEqual -Left $startedAt -Right $State.injectorStartedAt)
  }
  if (-not $matches) {
    return [pscustomobject]@{ Kind = 'mismatch'; Message = "PID $processId 存在，但不是记录的 Dream Skin 注入器。"; Running = $false }
  }
  if (-not $State.runtimeFingerprint) {
    return [pscustomobject]@{ Kind = 'uninspectable'; Message = '状态文件缺少运行时指纹，无法确认注入器版本。'; Running = $false }
  }
  return [pscustomobject]@{ Kind = 'running'; Message = "皮肤注入器正在运行（PID $processId）。"; Running = $true }
}

function Invoke-ManagerLiveApplyIfRunning {
  param([switch]$OpacityOnly)
  $state = Read-DreamSkinState -Path $paths.State
  $identity = Get-ManagerInjectorStatus -State $state
  # The packaged Node process can be running while Windows hides its command
  # line and executable path. The recorded port/browser pair is independently
  # verified by the renderer probe, so keep using that live session instead
  # of forcing a Codex restart merely because PID identity is uninspectable.
  $hasLiveSession = $null -ne $state -and $state.port -and $state.browserId
  if (-not $identity.Running -and -not $hasLiveSession) { return $false }
  $live = Invoke-DreamSkinLiveApply -StateRoot $StateRoot -OpacityOnly:$OpacityOnly
  # Only this failure means the theme was committed but the live session did
  # not apply it. Callers may reconcile startup; validation/write errors must
  # keep failing without being mistaken for a recoverable connection race.
  if (-not $live.Applied) { throw "DREAM_SKIN_LIVE_APPLY_FAILED: $($live.Message)" }
  $script:liveVerification = $live.Verification | ConvertFrom-Json
  return $true
}


if ($Action -eq 'Status') {
  $active = $null
  try { $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata } catch {}
  $state = Read-DreamSkinState -Path $paths.State
  $identity = Get-ManagerInjectorStatus -State $state
  $paused = Test-DreamSkinPaused -StateRoot $StateRoot
  [ordered]@{
    isRunning = [bool]$identity.Running
    isPaused = [bool]$paused
    statusKind = if ($identity.Running -and $paused) { 'paused' } else { $identity.Kind }
    statusMessage = $identity.Message
    activeThemeId = if ($active) { "$($active.Theme.id)" } else { '' }
  } | ConvertTo-Json -Depth 4 -Compress
  return
}
# The platform caller holds the operation lock and supplies a verified snapshot.
$snapshotRoot = Join-Path $StateRoot 'manager-operations\snapshots'
if (-not $ThemeDirectory -or -not (Test-DreamSkinThemePathWithin -Path $ThemeDirectory -Root $snapshotRoot)) {
  throw 'Theme publication requires a manager snapshot.'
}
if ($OpacityOnly -and (Test-DreamSkinPaused -StateRoot $StateRoot)) {
  throw 'Opacity-only updates cannot resume a paused skin.'
}
if ($OpacityOnly) {
  $fixedSkillRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  $applicationRoot = Split-Path -Parent $fixedSkillRoot
  $fixedStateRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'))
  if (-not (Test-DreamSkinPathEqual -Left $SkillRoot -Right $fixedSkillRoot) -or
    -not (Test-DreamSkinPathEqual -Left $StateRoot -Right $fixedStateRoot)) {
    throw 'Opacity-only refresh must use the installed manager runtime and state.'
  }
  $requestFile = [IO.Path]::GetFullPath($RefreshRequestPath)
  $requestsRoot = Join-Path $fixedStateRoot 'manager-operations\requests'
  Assert-DreamSkinNoReparseComponents -Path $requestFile
  if ([IO.Path]::GetDirectoryName($requestFile) -ine $requestsRoot -or
    [IO.Path]::GetFileName($requestFile) -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$' -or
    -not (Test-Path -LiteralPath $requestFile -PathType Leaf) -or
    (Get-Item -LiteralPath $requestFile).Length -gt 16KB) {
    throw 'Invalid shared-manager opacity refresh request.'
  }
  $refreshRequest = (Read-DreamSkinUtf8File -Path $requestFile) | ConvertFrom-Json
  if ($refreshRequest.schemaVersion -ne 1 -or $refreshRequest.refresh.opacityOnly -isnot [bool] -or
    $refreshRequest.refresh.opacityOnly -ne $true) {
    throw 'The manager request does not authorize an opacity-only refresh.'
  }
  $expectedSnapshot = Join-Path $snapshotRoot ([IO.Path]::GetFileNameWithoutExtension($requestFile))
  if (-not (Test-DreamSkinPathEqual -Left $ThemeDirectory -Right $expectedSnapshot)) {
    throw 'The opacity-only snapshot does not match its manager request.'
  }
  $probeResult = Invoke-DreamSkinPowerShellScript -ScriptPath (Join-Path $PSScriptRoot 'manager-platform.ps1') `
    -ArgumentList @('-Action', 'Probe', '-ApplicationRoot', $applicationRoot)
  if ($probeResult.ExitCode -ne 0) { throw 'Could not inspect the opacity-only runtime session.' }
  $probe = ($probeResult.Output -join "`n") | ConvertFrom-Json
  $encodedProbe = 'base64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($probe | ConvertTo-Json -Depth 10 -Compress)))
  $managerNode = Get-DreamSkinValidatedNodeRuntime -Path (Join-Path $applicationRoot 'runtime\node\node.exe')
  $refreshCheck = Invoke-DreamSkinNative -FilePath $managerNode.Path -ArgumentList @(
    (Join-Path $applicationRoot 'shared\core\apply-worker.mjs'), 'check-refresh', $applicationRoot, $requestFile, $encodedProbe
  ) -DiscardStderr
  if ($refreshCheck.ExitCode -ne 0) { throw 'The active session or watcher cannot perform this opacity-only refresh.' }
  $node = Get-DreamSkinNodeRuntime
  $checkedThemes = @()
  foreach ($directory in @($ThemeDirectory, $paths.Active)) {
    $checked = Invoke-DreamSkinNative -FilePath $node.Path -ArgumentList @(
      (Join-Path $PSScriptRoot 'injector.mjs'), '--check-payload', '--theme-dir', $directory
    ) -DiscardStderr
    if ($checked.ExitCode -ne 0) { throw 'Could not verify the opacity-only theme before publication.' }
    $payload = ($checked.Output -join "`n") | ConvertFrom-Json
    if ($payload.pass -ne $true -or $payload.artMetadata.video -ne $true -or
      "$($payload.opacityUpdateKey)" -cnotmatch '^[a-f0-9]{64}$' -or -not $payload.themeId) {
      throw 'Opacity-only publication requires an existing valid video theme.'
    }
    $checkedThemes += $payload
  }
  if ("$($checkedThemes[0].themeId)" -cne "$($checkedThemes[1].themeId)" -or
    "$($checkedThemes[0].opacityUpdateKey)" -cne "$($checkedThemes[1].opacityUpdateKey)") {
    throw 'Opacity-only publication cannot change the active video, theme or non-opacity settings.'
  }
}
Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot -PrepareOnly | Out-Null
$saved = Read-DreamSkinTheme -ThemeDirectory $ThemeDirectory -SkipImageMetadata
$css = Join-Path $ThemeDirectory 'theme.css'
if (-not (Test-Path -LiteralPath $css -PathType Leaf)) { $css = $null }
if ($css) { Assert-DreamSkinSafeCssFile -Path $css }
$result = Set-DreamSkinActiveTheme -ImagePath $saved.ImagePath -Theme $saved.Theme -SafeCssPath $css -SkipImageArchive -StateRoot $StateRoot -OpacityOnly:$OpacityOnly
if (-not $OpacityOnly) { Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null }
$applied = if ($DeferLiveApply) { $false } else { Invoke-ManagerLiveApplyIfRunning -OpacityOnly:$OpacityOnly }
[ordered]@{ id = "$($result.Theme.id)"; rendererApplied = [bool]$applied; rendererVerification = $script:liveVerification } | ConvertTo-Json -Depth 20 -Compress
