[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Probe','Apply','Inspect','RuntimeProbe','Pause','Restore','CommitCommunity')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ApplicationRoot,
  [string]$RequestPath,
  [switch]$FunctionsOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$SkillRoot = Join-Path $ApplicationRoot 'windows'
$Worker = Join-Path $ApplicationRoot 'shared\core\apply-worker.mjs'
$Node = Join-Path $ApplicationRoot 'runtime\node\node.exe'

function Get-ManagerPlatformDigest {
  param([object]$Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 8 -Compress))) | ForEach-Object { $_.ToString('x2') }) -join '' }
  finally { $sha.Dispose() }
}
function Get-ManagerPlatformProbe {
  $state = Read-DreamSkinState -Path (Join-Path $StateRoot 'state.json')
  $port = if ($state -and $state.port) { [int]$state.port } else { 9335 }
  Assert-DreamSkinPort -Port $port
  $codex = Get-DreamSkinCodexInstall
  $identity = Get-DreamSkinVerifiedCdpIdentity -Port $port -Codex $codex
  if ($null -eq $identity) {
    $registered = Get-DreamSkinVerifiedCdpIdentityForAnyRegistered -Port $port
    if ($null -ne $registered) { $codex = $registered.Codex; $identity = $registered.Identity }
  }
  $processes = @(Get-DreamSkinCodexProcesses -Codex $codex | Sort-Object ProcessId | ForEach-Object {
    [ordered]@{ id = [int]$_.ProcessId; startedAt = (Get-DreamSkinProcessStartedAt -ProcessId ([int]$_.ProcessId)) }
  })
  $paused = [bool](Test-DreamSkinPaused -StateRoot $StateRoot)
  $browser = if ($identity) { "$($identity.BrowserId)" } else { '' }
  $watcherVerified = $false
  if ($state -and $state.injectorPid -and $state.injectorStartedAt -and $state.injectorPath -and $state.nodePath) {
    $watcher = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.injectorPid)" -ErrorAction SilentlyContinue
    $watcherStart = Get-DreamSkinProcessStartedAt -ProcessId ([int]$state.injectorPid)
    if ($watcher -and $watcherStart) {
      $watcherVerified = [bool]((Test-DreamSkinTimestampEqual -Left $watcherStart -Right $state.injectorStartedAt) -and
        (Test-DreamSkinPathEqual -Left (Get-DreamSkinProcessExecutablePath -ProcessInfo $watcher) -Right $state.nodePath) -and
        (Test-DreamSkinCommandLineToken -CommandLine "$($watcher.CommandLine)" -Token $state.injectorPath) -and
        (Test-DreamSkinCommandLineToken -CommandLine "$($watcher.CommandLine)" -Token '--watch') -and
        [regex]::IsMatch("$($watcher.CommandLine)", ('(?:^|\s)--port(?:=|\s+)' + [regex]::Escape("$port") + '(?=$|\s)')) -and
        $identity -and $state.browserId -ceq $browser -and
        [regex]::IsMatch("$($watcher.CommandLine)", ('(?:^|\s)--browser-id(?:=|\s+)' + [regex]::Escape($browser) + '(?=$|\s)')))
    }
  }
  # Only the verified listening browser owns this session. Renderer/GPU child
  # processes and watcher turnover do not change an existing CDP connection.
  $owners = if ($identity) { @(Get-DreamSkinPortListeners -Port $port | Sort-Object OwningProcess -Unique | ForEach-Object {
    [ordered]@{ id = [int]$_.OwningProcess; startedAt = (Get-DreamSkinProcessStartedAt -ProcessId ([int]$_.OwningProcess)) }
  }) } else { $processes }
  $runtime = [ordered]@{ executable = "$($codex.Executable)"; owners = $owners; browser = $browser; port = $port }
  [pscustomobject]@{
    fingerprint = Get-ManagerPlatformDigest ([ordered]@{ runtime = $runtime; paused = $paused })
    runtimeSessionId = if ($identity) { Get-ManagerPlatformDigest $runtime } else { $null }
    # A stale saved browser must be reconnected once before helpers can use it.
    # Watcher/PID observations themselves never prevent a live skin switch.
    startRequired = [bool]($null -eq $identity -or -not $state -or -not $state.port -or "$($state.browserId)" -cne $browser)
    recoveryRequired = $false
    watcherVerified = $watcherVerified
    processRunning = [bool]($processes.Count -gt 0)
    paused = $paused
    port = $port
  }
}
function Invoke-ManagerPlatformWorker {
  param([string]$Mode, [string]$VerifyPath)
  $arguments = @($Worker, $Mode, $ApplicationRoot, $RequestPath)
  if ($VerifyPath) { $arguments += $VerifyPath }
  $text = & $Node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Manager transaction helper refused the request.' }
  return ($text -join "`n") | ConvertFrom-Json
}
function Invoke-ManagerRuntimeWorker {
  param([string]$Mode, [object]$Probe)
  $runtimeProbeText = $Probe | ConvertTo-Json -Depth 10 -Compress
  $runtimeProbeEncoded = 'base64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtimeProbeText))
  $runtimeArgs = @((Join-Path $ApplicationRoot 'shared\core\runtime-worker.mjs'), $Mode, $ApplicationRoot, $runtimeProbeEncoded)
  if ($Mode -in @('check','check-appearance','record-engine')) { $runtimeArgs += $RequestPath }
  $runtimeText = & $Node @runtimeArgs
  if ($LASTEXITCODE -ne 0) { throw 'Runtime state changed or the command is unsafe.' }
  return ($runtimeText -join "`n") | ConvertFrom-Json
}

if ($FunctionsOnly) { return }
$lock = $null
$previousHeld = $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD
$effects = [ordered]@{ themeCommitted = $false; rendererApplied = $false; codexRestarted = $false }
$committedRevision = $null
$rendererUnavailable = $false
if ($Action -eq 'Pause') { $effects.pausedCommitted = $false; $effects.rendererRemoved = $false }
if ($Action -eq 'Restore') {
  $effects.pausedCommitted = $false; $effects.rendererRemoved = $false
  $effects.appearanceRestored = $false; $effects.runtimeDetached = $false; $effects.backupArchived = $false
}
if ($Action -eq 'Inspect') { $effects.rendererApplied = $null }
$verifyPath = $null
$verifyOutput = $null
try {
  if ($Action -notin @('Probe','RuntimeProbe','Inspect')) {
    $lock = Enter-DreamSkinOperationLock -TimeoutMilliseconds 5000
    $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD = '1'
  }
  $before = Get-ManagerPlatformProbe
  if ($Action -eq 'Probe') { $before | ConvertTo-Json -Compress; return }
  if ($Action -eq 'RuntimeProbe') {
    $captured = Invoke-ManagerRuntimeWorker -Mode 'capture' -Probe $before
    $captured | ConvertTo-Json -Depth 10 -Compress; return
  }
  if ($Action -eq 'Inspect') {
    if (-not $before.runtimeSessionId -or $before.paused) { throw 'No active renderer session.' }
    $output = & (Join-Path $PSScriptRoot 'verify-dream-skin.ps1') -InProcess -ReadOnly
    $encoded = 'base64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($output -join "`n")))
    $mappedText = & $Node $Worker inspect $ApplicationRoot $encoded
    if ($LASTEXITCODE -ne 0) { throw 'The active payload could not be verified.' }
    $mapped = ($mappedText -join "`n") | ConvertFrom-Json
    $after = Get-ManagerPlatformProbe
    if ($after.fingerprint -cne $before.fingerprint -or $after.runtimeSessionId -cne $before.runtimeSessionId) { throw 'Runtime changed during observation.' }
    [ordered]@{ effects = @{ themeCommitted = $true; rendererApplied = $true; codexRestarted = $false }; committedRevision = $mapped.committedRevision; verifiedRendererRevision = $mapped.verifiedRendererRevision; runtimeSessionId = $after.runtimeSessionId } | ConvertTo-Json -Compress
    return
  }
  Assert-DreamSkinNoReparseComponents -Path $RequestPath
  $requestsRoot = Join-Path $StateRoot 'manager-operations\requests'
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($RequestPath)) -ine [IO.Path]::GetFullPath($requestsRoot) -or
      [IO.Path]::GetFileName($RequestPath) -cnotmatch '^[a-f0-9-]{36}\.json$' -or
      (Get-Item -LiteralPath $RequestPath).Length -gt 16KB) { throw 'Invalid manager request location.' }
  $request = (Read-DreamSkinUtf8File -Path $RequestPath) | ConvertFrom-Json
  $upgrade = $null -ne $request.runtimeCommand -and $request.runtimeCommand.method -eq 'runtime.upgrade'
  if ($upgrade) { $effects.runtimeUpgraded = $false }
  if ($Action -eq 'Apply' -and $null -ne $request.runtimeCommand) { $effects.pausedCommitted = $false; $effects.rendererRemoved = $false }
  if ($Action -eq 'Restore') {
    if ($request.runtimeCommand.method -ne 'skin.restore') { throw 'Invalid restore descriptor.' }
    $null = Invoke-ManagerRuntimeWorker -Mode 'check' -Probe $before
    $restoreArguments = @{ RestoreBaseTheme = $true; ForceRestart = [bool]$request.confirmed; ManagerRequestPath = $RequestPath;
      ManagerApplicationRoot = $ApplicationRoot; ManagerPrecondition = "$($before.fingerprint)"; ManagerEffects = $effects }
    $null = & (Join-Path $PSScriptRoot 'restore-dream-skin.ps1') @restoreArguments 6>$null 3>$null
    $afterRestore = Get-ManagerPlatformProbe
    $rendererUnavailable = -not [bool]$afterRestore.processRunning -and -not $afterRestore.runtimeSessionId
    [ordered]@{ effects = $effects; rendererUnavailable = $rendererUnavailable; committedRevision = $null; verifiedRendererRevision = $null; runtimeSessionId = $null } | ConvertTo-Json -Depth 6 -Compress
    return
  }
  if ($Action -eq 'Pause') {
    if ($request.runtimeCommand.method -ne 'skin.pause') { throw 'Invalid pause descriptor.' }
    $null = Invoke-ManagerRuntimeWorker -Mode 'check' -Probe $before
    $effects.pausedCommitted = $null
    $null = Set-DreamSkinPaused -Paused $true -StateRoot $StateRoot
    $effects.pausedCommitted = [bool](Test-DreamSkinPaused -StateRoot $StateRoot)
    if ($before.runtimeSessionId) {
      $effects.rendererRemoved = $null
      $removal = Invoke-DreamSkinLiveRemove -StateRoot $StateRoot
      if (-not $removal.Removed) { throw 'The live skin removal could not be confirmed.' }
      $afterPause = Get-ManagerPlatformProbe
      if ($afterPause.runtimeSessionId -cne $before.runtimeSessionId -or -not $afterPause.paused) { throw 'The paused renderer session changed.' }
      $effects.rendererRemoved = $true
    } else {
      $afterPause = Get-ManagerPlatformProbe
      if ($before.processRunning -or $afterPause.processRunning -or -not $afterPause.paused) { $effects.rendererRemoved = $null; throw 'The renderer state is unknown.' }
      $rendererUnavailable = $true
    }
    [ordered]@{ effects = $effects; rendererUnavailable = $rendererUnavailable; committedRevision = $null; verifiedRendererRevision = $null; runtimeSessionId = $afterPause.runtimeSessionId } | ConvertTo-Json -Depth 6 -Compress
    return
  }
  if ($Action -eq 'Apply') {
    $refreshProbe = 'base64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($before | ConvertTo-Json -Depth 10 -Compress)))
    $null = Invoke-ManagerPlatformWorker -Mode 'check-refresh' -VerifyPath $refreshProbe
    if ($null -ne $request.runtimeCommand) { $null = Invoke-ManagerRuntimeWorker -Mode 'check' -Probe $before }
    $repair = $null -ne $request.runtimeCommand -and $request.runtimeCommand.method -eq 'runtime.repair'
    $recoverByApply = $null -eq $request.runtimeCommand -and $before.recoveryRequired
    $recoverSession = $repair -or $recoverByApply
    if ($request.schemaVersion -ne 1 -or "$($request.preflightFingerprint)" -cne "$($before.fingerprint)" -or
        ($before.recoveryRequired -and -not $recoverSession) -or (($upgrade -or $before.startRequired -or ($recoverSession -and $before.recoveryRequired)) -and $request.confirmed -ne $true)) { throw 'Manager precondition changed.' }
    $snapshot = Invoke-ManagerPlatformWorker -Mode 'prepare'
    if ($null -ne $request.runtimeCommand) { $effects.pausedCommitted = $null; $effects.rendererRemoved = $false }
    $applyArguments = @('-Action','ApplyTheme','-SkillRoot',$SkillRoot,'-StateRoot',$StateRoot,'-ThemeDirectory',"$($snapshot.directory)")
    if ($null -ne $request.refresh -and $request.refresh.opacityOnly -eq $true) { $applyArguments += @('-OpacityOnly','-RefreshRequestPath',$RequestPath) }
    # From this boundary the old flow may already have changed the renderer,
    # even when its process later reports failure. Only verify can claim true.
    $effects.rendererApplied = $null
    if ($upgrade -or $before.startRequired -or ($recoverSession -and $before.recoveryRequired)) {
      if ($upgrade) { $effects.runtimeUpgraded = $null }
      $effects.codexRestarted = if ($before.processRunning) { $null } else { $false }
      $effects.themeCommitted = $null
      $restarted = $false
      $startArguments = @{
        RestartExisting = [bool]$request.confirmed
        RequestedThemeAppearance = "$($snapshot.appearance)"
        ThemeApplyArguments = @($applyArguments + '-DeferLiveApply')
        ManagerPrecondition = "$($before.fingerprint)"
        ManagerApplicationRoot = $ApplicationRoot
        RequireFreshSession = [bool]($upgrade -or ($recoverSession -and $before.recoveryRequired))
        ManagerVerification = [ref]$verifyOutput
        ManagerRestarted = [ref]$restarted
      }
      $null = & (Join-Path $PSScriptRoot 'start-dream-skin.ps1') @startArguments
      $effects.codexRestarted = [bool]$restarted
      $effects.themeCommitted = $true
      $committedRevision = "$($request.expectedRevision)"
    } else {
      $effects.themeCommitted = $null
      $apply = Invoke-DreamSkinPowerShellScript -ScriptPath (Join-Path $PSScriptRoot 'platform-theme.ps1') -ArgumentList $applyArguments -SwitchParameters @('-DeferLiveApply','-SkipThemes','-OpacityOnly')
      if ($apply.ExitCode -ne 0) { throw 'The hot apply did not finish. A restart will not be attempted automatically.' }
      $applied = ($apply.Output -join "`n") | ConvertFrom-Json
      if ($applied.rendererApplied -ne $true -or -not $applied.rendererVerification) { throw 'The live renderer did not report a completed apply.' }
      $verifyOutput = $applied.rendererVerification | ConvertTo-Json -Depth 20 -Compress
      $effects.themeCommitted = $true
      $committedRevision = "$($request.expectedRevision)"
    }
  }
  # Verify actual content while still holding the operation lock. The helper
  # compares the exact immutable publication snapshot, not only its theme ID.
  if ($Action -ne 'Apply') {
    $verificationBefore = Get-ManagerPlatformProbe
    if (-not $verificationBefore.runtimeSessionId) { throw 'No verified renderer session.' }
    $verifyOutput = & (Join-Path $PSScriptRoot 'verify-dream-skin.ps1') -InProcess
  }
  $verifyPath = Join-Path $requestsRoot ([IO.Path]::GetFileNameWithoutExtension($RequestPath) + '.verify.' + [guid]::NewGuid().ToString('N'))
  Assert-DreamSkinNoReparseComponents -Path $requestsRoot
  $verifyStream = [IO.File]::Open($verifyPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($verifyOutput -join "`n")); $verifyStream.Write($bytes, 0, $bytes.Length) }
  finally { $verifyStream.Dispose() }
  $mapped = Invoke-ManagerPlatformWorker -Mode 'verify' -VerifyPath $verifyPath
  $after = Get-ManagerPlatformProbe
  if (-not $after.runtimeSessionId -or ($Action -ne 'Apply' -and $after.runtimeSessionId -cne $verificationBefore.runtimeSessionId) -or
      ($Action -eq 'Apply' -and -not $before.startRequired -and -not $upgrade -and $after.runtimeSessionId -cne $before.runtimeSessionId)) { throw 'Renderer session changed during application.' }
  $effects.rendererApplied = $true
  if ($upgrade) {
    $launchProof = Invoke-ManagerRuntimeWorker -Mode 'record-engine' -Probe $after
    $effects.runtimeUpgraded = [bool]$launchProof.runtimeUpgraded
  }
  if ($null -ne $request.runtimeCommand) { $effects.pausedCommitted = -not [bool]$after.paused }
  if ($Action -in @('Inspect','CommitCommunity')) { $effects.themeCommitted = $true }
  if ($Action -eq 'CommitCommunity') { $effects.codexRestarted = $true }
  $result = [ordered]@{ effects = $effects; committedRevision = "$($mapped.committedRevision)"; verifiedRendererRevision = "$($mapped.verifiedRendererRevision)"; runtimeSessionId = "$($after.runtimeSessionId)" } | ConvertTo-Json -Compress
  if ($Action -in @('Apply','CommitCommunity')) {
    $encodedResult = 'base64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result))
    $null = & $Node $Worker settle $ApplicationRoot $RequestPath $encodedResult
    if ($LASTEXITCODE -ne 0) { throw 'The publication receipt could not be saved.' }
  }
  $result
} catch {
  if ($Action -in @('Probe','RuntimeProbe')) { throw }
  # Unknown effects remain unknown; do not turn a post-commit failure into a
  # claim that no theme was saved or that a restart succeeded.
  [ordered]@{ effects = $effects; committedRevision = $committedRevision; verifiedRendererRevision = $null; runtimeSessionId = $null } | ConvertTo-Json -Compress
} finally {
  if ($verifyPath) { try { [IO.File]::Delete($verifyPath) } catch {} }
  if ($null -eq $previousHeld) { Remove-Item Env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD -ErrorAction SilentlyContinue }
  else { $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD = $previousHeld }
  if ($null -ne $lock) { Exit-DreamSkinOperationLock -Mutex $lock }
}
