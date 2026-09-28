[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('dreamskin-status-unit-' + [guid]::NewGuid().ToString('N'))
$skill = Join-Path $fixture 'engine'
$state = Join-Path $fixture 'state'
$scripts = Join-Path $skill 'scripts'
$manager = Join-Path $Root 'windows\scripts\manager-actions.ps1'
$script:passed = 0
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Run-Case([string]$Name, [scriptblock]$Body) {
  & $Body
  $script:passed++
  Write-Host "PASS: $Name"
}
function Invoke-Read([string]$Action, [switch]$WithoutThemes) {
  $arguments = @{ Action = $Action; SkillRoot = $skill; StateRoot = $state }
  if ($Action -eq 'Status') { $arguments.Quick = $true; $arguments.SkipThemes = $WithoutThemes }
  $json = & $manager @arguments
  Assert-True ($global:DreamSkinStatusTestForbiddenCalls -eq 0) 'A read invoked a write, Node or renderer probe.'
  return ($json | ConvertFrom-Json)
}
try {
  New-Item -ItemType Directory -Path $scripts -Force | Out-Null
  $global:DreamSkinStatusTestForbiddenCalls = 0
  foreach ($name in @('common-windows.ps1', 'theme-windows.ps1', 'runtime-version.ps1')) {
    $source = (Join-Path $Root "windows\scripts\$name").Replace("'", "''")
    $wrapper = ". '$source'`r`n"
    if ($name -eq 'common-windows.ps1') {
      $wrapper += @'
function Deny-StatusTestOperation {
  $global:DreamSkinStatusTestForbiddenCalls++
  throw 'Unexpected expensive or mutating operation during read.'
}
function Get-DreamSkinNodeRuntime { Deny-StatusTestOperation }
function Enter-DreamSkinOperationLock { Deny-StatusTestOperation }
'@
    }
    if ($name -eq 'theme-windows.ps1') {
      $wrapper += @'
function Initialize-DreamSkinThemeStore { Deny-StatusTestOperation }
function Get-DreamSkinValidatedImageMetadata { Deny-StatusTestOperation }
function Get-DreamSkinLiveRendererStatus { Deny-StatusTestOperation }
'@
    }
    [IO.File]::WriteAllText((Join-Path $scripts $name), $wrapper, [Text.UTF8Encoding]::new($true))
  }
  Run-Case 'Fresh quick status creates no state directories and returns an empty JSON array' {
    $result = Invoke-Read Status -WithoutThemes
    Assert-True ($result.statusKind -eq 'stopped') 'Fresh state should be stopped.'
    Assert-True ($result.rendererStatus -eq 'unchecked') 'Quick status must not claim renderer verification.'
    Assert-True ($result.themes -is [array] -and $result.themes.Count -eq 0) 'Empty themes must remain an array.'
    Assert-True (-not (Test-Path -LiteralPath $state)) 'Status initialized the theme store.'
  }
  Run-Case 'Empty catalog is read-only and preserves array shape' {
    $result = Invoke-Read ListThemes
    Assert-True ($result.themes -is [array] -and $result.themes.Count -eq 0) 'Empty catalog must remain an array.'
    Assert-True (-not (Test-Path -LiteralPath $state)) 'Catalog created the theme store.'
  }
  $preset = Join-Path $skill 'presets\preset-unit'
  New-Item -ItemType Directory -Path $preset -Force | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $preset 'art.png'), [byte[]]@(1,2,3))
  [IO.File]::WriteAllText((Join-Path $preset 'theme.json'), '{"id":"preset-unit","name":"Unit","image":"art.png","palette":{},"art":{"focusX":0.5,"focusY":0.5}}')
  Run-Case 'Singleton catalog reads metadata without decoding media or launching Node' {
    $result = Invoke-Read ListThemes
    Assert-True ($result.themes -is [array] -and $result.themes.Count -eq 1) 'Singleton catalog must be a one-item array.'
    Assert-True ($result.themes[0].id -eq 'preset-unit') 'Preset missing.'
    $status = Invoke-Read Status
    Assert-True ($status.themes -is [array] -and $status.themes.Count -eq 1) 'Combined status lost singleton array shape.'
  }
  Run-Case 'Broken active image cannot prevent quick status or catalog loading' {
    $active = Join-Path $state 'active-theme'
    New-Item -ItemType Directory -Path $active -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $active 'theme.json'), '{"id":"broken","image":"missing.png"}')
    $before = [IO.File]::ReadAllText((Join-Path $active 'theme.json'))
    $result = Invoke-Read Status -WithoutThemes
    Assert-True ($result.activeThemeId -eq '') 'Missing active media must not be reported as valid.'
    Assert-True ((Invoke-Read ListThemes).themes.Count -eq 1) 'Broken active theme hid the catalog.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $active 'theme.json')) -ceq $before) 'Read rewrote the active theme.'
  }
  Run-Case 'Corrupt state is reported while the independent catalog remains available' {
    [IO.File]::WriteAllText((Join-Path $state 'state.json'), '{bad json')
    $failed = $false
    try { $null = Invoke-Read Status -WithoutThemes } catch { $failed = $true }
    Assert-True $failed 'Invalid state was silently accepted.'
    Assert-True ((Invoke-Read ListThemes).themes.Count -eq 1) 'State corruption hid catalog.'
  }
  Run-Case 'Malformed saved theme is skipped with a warning, valid themes survive' {
    $saved = Join-Path $state 'themes\saved'
    $broken = Join-Path $state 'themes\broken'
    New-Item -ItemType Directory -Path $saved, $broken -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $saved 'art.png'), [byte[]]@(1))
    [IO.File]::WriteAllText((Join-Path $saved 'theme.json'), '{"id":"saved","name":"Saved","image":"art.png"}')
    [IO.File]::WriteAllText((Join-Path $broken 'theme.json'), '{bad json')
    $result = Invoke-Read ListThemes
    Assert-True ($result.themes.Count -eq 2) 'A bad entry discarded valid themes.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($result.catalogMessage)) 'Skipped entry was not reported.'
  }
  Run-Case 'PrepareOnly retains directory and transaction recovery without reading old/default images' {
    & {
      . (Join-Path $Root 'windows\scripts\theme-windows.ps1')
      $script:preparedDirectories = @()
      $script:recovered = 0
      function Ensure-DreamSkinManagedDirectory { param($Path, $Root); $script:preparedDirectories += $Path }
      function Invoke-DreamSkinThemeReplacementRecovery { param($Paths); $script:recovered++ }
      function Read-DreamSkinTheme { throw 'Old/default image validation was invoked.' }
      $result = Initialize-DreamSkinThemeStore -SkillRoot $skill -StateRoot $state -PrepareOnly
      Assert-True ($result.Root -eq $state) 'Wrong prepared state root.'
      Assert-True ($script:preparedDirectories.Count -eq 4) 'Required directories were not prepared.'
      Assert-True ($script:recovered -eq 1) 'Transaction recovery was skipped.'
      $fullInitFailed = $false
      try { Initialize-DreamSkinThemeStore -SkillRoot $skill -StateRoot $state | Out-Null } catch { $fullInitFailed = $true }
      Assert-True $fullInitFailed 'Full initialization must retain image validation.'
    }
  }
  Write-Host "PASS: $script:passed status PowerShell unit tests"
} finally {
  Remove-Variable DreamSkinStatusTestForbiddenCalls -Scope Global -ErrorAction SilentlyContinue
  $resolved = [IO.Path]::GetFullPath($fixture)
  if ($resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($resolved).StartsWith('dreamskin-status-unit-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
