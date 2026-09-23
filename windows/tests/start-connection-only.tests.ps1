[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
# Import definitions only. All process, CDP, theme and config operations below
# are mocks; real state serialization is exercised solely inside our temp root.
. (Join-Path $Root 'scripts\common-windows.ps1')
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dreamskin-connect-' + [guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA
$source = [System.IO.File]::ReadAllText((Join-Path $Root 'scripts\start-dream-skin.ps1'))
$imports = '(?m)^\.\s+\(Join-Path \$PSScriptRoot ''(?:common-windows|theme-windows|localization-windows)\.ps1''\)\r?\n'
if ([regex]::Matches($source, $imports).Count -ne 3) { throw 'Could not isolate startup imports.' }
$source = [regex]::Replace($source, $imports, '')
$source = $source.Replace('$Injector = Join-Path $PSScriptRoot ''injector.mjs''', '$Injector = ''mock-injector.mjs''')
$source = $source.Replace('(Split-Path -Parent $PSScriptRoot)', '''mock-skill-root''')
$source = $source.Replace('$ConfigPath = Join-Path $HOME ''.codex\config.toml''', '$ConfigPath = Join-Path $StateRoot ''fixture-config.toml''')
if ($source.Contains('$PSScriptRoot') -or $source.Contains('$HOME')) { throw 'Startup fixture contains an unisolated path.' }
$startBlock = [scriptblock]::Create($source)

# Load only the status function, never the manager script's top-level actions.
$tokens = $null; $parseErrors = $null
$managerAst = [System.Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $Root 'scripts\manager-actions.ps1'), [ref]$tokens, [ref]$parseErrors)
$statusFunction = @($managerAst.FindAll({ param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ManagerInjectorStatus'
}, $true))
if ($parseErrors.Count -or $statusFunction.Count -ne 1) { throw 'Could not isolate manager status.' }
. ([scriptblock]::Create($statusFunction[0].Extent.Text))

function Assert-FixturePath { param([string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($fixtureRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Attempted access outside fixture: $Path"
  }
}
function Enter-DreamSkinOperationLock { param([int]$TimeoutMilliseconds); return 'fixture-lock' }
function Exit-DreamSkinOperationLock { param([object]$Mutex); $script:lockExited = $true }
function Resolve-DreamSkinLanguage { param([string]$StateRoot); return 'en-US' }
function Get-DreamSkinNodeRuntime { return [pscustomobject]@{ Path = 'mock-node.exe'; Version = '22.23.1' } }
function Get-DreamSkinRuntimeFingerprint { param([string]$SkillRoot); return 'fixture' }
function Get-DreamSkinCodexInstall {
  return [pscustomobject]@{ Executable = 'C:\fixture\Codex.exe'; PackageRoot = 'C:\fixture';
    PackageFullName = 'OpenAI.Codex_fixture'; PackageFamilyName = 'OpenAI.Codex_fixture'; Version = '1' }
}
function Get-DreamSkinThemePaths { param([string]$StateRoot)
  Assert-FixturePath $StateRoot
  return [pscustomobject]@{ Root = $StateRoot; Active = (Join-Path $StateRoot 'active'); PauseFile = (Join-Path $StateRoot 'paused') }
}
function Ensure-DreamSkinManagedDirectory { param([string]$Path, [string]$Root)
  Assert-FixturePath $Path
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}
function Initialize-DreamSkinThemeStore { param([string]$SkillRoot, [string]$StateRoot)
  return Get-DreamSkinThemePaths $StateRoot
}
function Test-DreamSkinPaused { param([string]$StateRoot); return $script:paused }
function Set-DreamSkinPaused { param([bool]$Paused, [string]$StateRoot); $script:paused = $Paused }
function Test-DreamSkinPendingAppearanceTransaction { param([string]$BackupPath); Assert-FixturePath $BackupPath; return $false }
function Get-DreamSkinCodexStatePathCandidate { param([object]$State); return $null }
function Get-DreamSkinCodexInstallFromState { param([object]$State); return $null }
function Get-DreamSkinCodexProcesses { param([object]$Codex)
  # Windows PowerShell 5.1 PSCustomObject does not inherit scalar .Count=1
  # unlike CIM process objects; model that property explicitly.
  if ($script:cdpReady) { return [pscustomobject]@{ ProcessId = 900; Count = 1 } }
  return ,@()
}
function Get-DreamSkinVerifiedCdpIdentity { param([int]$Port, [object]$Codex)
  if ($script:cdpReady) { return [pscustomobject]@{ BrowserId = 'fixture-browser' } }
  return $null
}
function Get-DreamSkinVerifiedCdpIdentityForAnyRegistered { param([int]$Port); return $null }
function Test-DreamSkinPortAvailable { param([int]$Port); return $true }
function Start-DreamSkinCodexForDebugging { param([object]$Codex, [string[]]$Arguments, [int]$Port, [int[]]$PreserveProcessIds)
  $script:events += 'connect'
  if ($script:failConnect) { throw 'fixture connection failed' }
  $script:cdpReady = $true
  return [pscustomobject]@{ Strategy = 'fixture' }
}
function Stop-DreamSkinCodex { param([object]$Codex, [int[]]$PreserveProcessIds, [switch]$AllowForce)
  $script:events += 'stop'; $script:cdpReady = $false
}
function Start-DreamSkinCodex { param([object]$Codex); $script:events += 'ordinary-start'; return 901 }
function Stop-DreamSkinRecordedInjector { param([object]$State); return $true }
function Get-DreamSkinActiveThemeAppearance { param([string]$ThemeDirectory)
  $script:events += 'read-selected-theme'; return 'dark'
}
function Install-DreamSkinBaseTheme { param([string]$ConfigPath, [string]$BackupPath, [string]$AppearanceTheme, [switch]$PassThruTransaction)
  Assert-FixturePath $ConfigPath; Assert-FixturePath $BackupPath
  if ($script:cdpReady) { throw 'Appearance written while Codex was running' }
  $script:events += "install-$AppearanceTheme"
  return [pscustomobject]@{ SchemaVersion = 2 }
}
function Complete-DreamSkinAppearanceTransaction { param([string]$BackupPath, [object]$Transaction); $script:events += 'commit' }
function ConvertTo-DreamSkinProcessArgument { param([string]$Value); return $Value }
function Get-DreamSkinProcessStartedAt { param([int]$ProcessId); return '2026-09-23T00:00:00.0000000Z' }
function Start-Process { [CmdletBinding()] param([string]$FilePath, [object[]]$ArgumentList, [string]$WindowStyle,
  [switch]$PassThru, [string]$RedirectStandardOutput, [string]$RedirectStandardError)
  $script:events += 'injector'
  return [pscustomobject]@{ Id = 4242; HasExited = $false }
}
function Get-Process { [CmdletBinding()] param([int]$Id); throw 'Unexpected real process inspection' }
function Stop-Process { [CmdletBinding()] param([object]$InputObject, [switch]$Force); throw 'Unexpected process stop' }
function Get-CimInstance { [CmdletBinding()] param([string]$ClassName, [string]$Filter); throw 'Unexpected CIM inspection' }
function Invoke-DreamSkinNative { param([string]$FilePath, [object[]]$ArgumentList, [switch]$DiscardStderr)
  if ($ArgumentList -notcontains '--verify') { throw 'Unexpected native operation' }
  $script:events += 'verify'
  return [pscustomobject]@{ ExitCode = 0; Output = @('{"pass":true}') }
}
function Start-Sleep { param([int]$Milliseconds, [int]$Seconds) }
function Write-Host { param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Object)
  $script:messages += ($Object -join ' ')
}
function Reset-Fixture {
  $script:events = @(); $script:messages = @(); $script:lockExited = $false
  $script:cdpReady = $false; $script:failConnect = $false; $script:paused = $true
}
function Assert-NoActiveAnnouncement {
  if (@($script:messages | Where-Object { $_ -like 'Codex Dream Skin is active*' }).Count) {
    throw 'Connection preparation falsely announced a running skin.'
  }
}

try {
  $env:LOCALAPPDATA = $fixtureRoot
  $statePath = Join-Path $fixtureRoot 'CodexDreamSkin\state.json'
  Reset-Fixture
  & $startBlock -ConnectOnly
  $connection = Read-DreamSkinState -Path $statePath
  $status = Get-ManagerInjectorStatus -State $connection
  if (($script:events -join ',') -cne 'connect' -or -not $script:paused -or
    -not $script:lockExited -or $connection.schemaVersion -ne 3 -or
    -not $connection.connectionOnly -or $connection.injectorPid -or $status.Running -or $status.Kind -cne 'stopped') {
    throw 'ConnectOnly loaded the old skin, changed appearance/pause, or claimed an injector.'
  }
  Assert-NoActiveAnnouncement

  # Both the check and real startup must reject an unapproved restart, with
  # byte-identical state and no appearance/process operations.
  $connectionBytes = [System.IO.File]::ReadAllBytes($statePath)
  foreach ($check in @($true, $false)) {
    $script:events = @(); $failure = $null
    try { & $startBlock -CheckOnly:$check } catch { $failure = $_ }
    if ($null -eq $failure -or $failure.Exception.Message -notlike 'DREAM_SKIN_RESTART_REQUIRED:*' -or
      $script:events.Count -ne 0 -or -not (Test-DreamSkinBytesEqual $connectionBytes ([System.IO.File]::ReadAllBytes($statePath)))) {
      throw "Final startup mutated state or bypassed restart consent (check=$check; error=$failure; events=$($script:events -join ','))."
    }
  }

  $script:events = @()
  & $startBlock -RestartExisting
  $running = Read-DreamSkinState -Path $statePath
  if (($script:events -join ',') -cne 'stop,read-selected-theme,install-dark,connect,injector,verify,commit' -or
    $running.connectionOnly -or $running.injectorPid -ne 4242 -or $script:paused) {
    throw 'Final startup failed to close, configure, reconnect, verify and replace connection-only state.'
  }

  # The reader must reject a mixed connection-only/injector identity and must
  # retain the mandatory injector fields for ordinary schema-3 states.
  foreach ($malformed in @(
    [pscustomobject]@{ connectionOnly = $true; injectorPid = 42 },
    [pscustomobject]@{ connectionOnly = $false; injectorPid = $null }
  )) {
    $candidate = $connection | ConvertTo-Json | ConvertFrom-Json
    $candidate.connectionOnly = $malformed.connectionOnly
    if ($null -ne $malformed.injectorPid) { $candidate | Add-Member -NotePropertyName injectorPid -NotePropertyValue $malformed.injectorPid }
    Write-DreamSkinState -Path $statePath -State $candidate
    $failure = $null
    try { $null = Read-DreamSkinState -Path $statePath } catch { $failure = $_ }
    if ($null -eq $failure) { throw 'State reader accepted a malformed schema-3 identity.' }
  }

  # Failed connection preparation creates no running state and never touches
  # appearance or launches an injector. All launch/rollback methods are mocks.
  Assert-FixturePath $statePath
  Remove-Item -LiteralPath $statePath -Force
  Reset-Fixture
  $script:failConnect = $true
  $failure = $null
  try { & $startBlock -ConnectOnly } catch { $failure = $_ }
  if ($null -eq $failure -or $failure.Exception.Message -cne 'fixture connection failed' -or
    (Test-Path -LiteralPath $statePath) -or -not $script:lockExited -or
    ($script:events -join ',') -cne 'connect,stop,ordinary-start') {
    throw 'Failed connection claimed success or failed its isolated rollback.'
  }
  Assert-NoActiveAnnouncement
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
  $tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedFixture.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetFileName($resolvedFixture) -notlike 'dreamskin-connect-*') { throw 'Unsafe fixture cleanup path.' }
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'PASS: connection-only startup stays stopped, preserves pause, validates state, requires restart consent and finalizes native appearance.'
