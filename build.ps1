[CmdletBinding()]
param(
  [switch]$TestsOnly,
  [string]$SkillRoot = (Join-Path $env:USERPROFILE 'Desktop\CodexDreamSkin\windows')
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$packageRoot = Join-Path $build 'CodexDreamSkinManager'
$packageWindows = Join-Path $packageRoot 'windows'

function Assert-NoReparsePointInPath([string]$Path, [string]$Boundary) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullBoundary = [System.IO.Path]::GetFullPath($Boundary).TrimEnd('\')
  if ($fullPath -ne $fullBoundary -and
      -not $fullPath.StartsWith(($fullBoundary + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the allowed build boundary: $fullPath"
  }
  $current = $fullBoundary
  $relative = $fullPath.Substring($fullBoundary.Length).TrimStart('\')
  $components = @($current)
  if ($relative) {
    foreach ($component in $relative.Split('\')) {
      $current = Join-Path $current $component
      $components += $current
    }
  }
  foreach ($componentPath in $components) {
    if (-not (Test-Path -LiteralPath $componentPath)) { continue }
    $item = Get-Item -LiteralPath $componentPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to use a reparse point inside the build package path: $componentPath"
    }
  }
}

function Assert-NoReparsePointTree([string]$RootPath) {
  if (-not (Test-Path -LiteralPath $RootPath)) { return }
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push([System.IO.Path]::GetFullPath($RootPath))
  while ($pending.Count -gt 0) {
    $currentPath = $pending.Pop()
    $item = Get-Item -LiteralPath $currentPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to delete a build package containing a reparse point: $currentPath"
    }
    if (-not $item.PSIsContainer) { continue }
    foreach ($child in Get-ChildItem -LiteralPath $currentPath -Force) {
      if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to delete a build package containing a reparse point: $($child.FullName)"
      }
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
}

function New-RunnableWindowsPackage([string]$SourceRoot, [string]$DestinationRoot) {
  $source = [System.IO.Path]::GetFullPath($SourceRoot)
  $destination = [System.IO.Path]::GetFullPath($DestinationRoot)
  $dependencyRoot = Split-Path -Parent $source
  $buildRoot = [System.IO.Path]::GetFullPath($build).TrimEnd('\')
  if (-not $destination.StartsWith(($buildRoot + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to assemble a package outside the build directory: $destination"
  }
  $requiredSourceFiles = @(
    'scripts\start-dream-skin.ps1',
    'scripts\restore-dream-skin.ps1',
    'scripts\common-windows.ps1',
    'scripts\theme-windows.ps1'
  )
  foreach ($relativePath in $requiredSourceFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $relativePath) -PathType Leaf)) {
      throw "The CodexDreamSkin Windows package is incomplete: $relativePath"
    }
  }
  $dependencyLicense = Join-Path $dependencyRoot 'macos\LICENSE'
  $dependencyNotice = Join-Path $dependencyRoot 'macos\NOTICE.md'
  foreach ($requiredLegalFile in @($dependencyLicense, $dependencyNotice)) {
    if (-not (Test-Path -LiteralPath $requiredLegalFile -PathType Leaf)) {
      throw "The CodexDreamSkin license material is missing: $requiredLegalFile"
    }
  }
  $replacementDefaultImage = Join-Path $root 'windows\presets\paper-light.jpg'
  if (-not (Test-Path -LiteralPath $replacementDefaultImage -PathType Leaf)) {
    throw 'The redistributable default theme image is missing: windows\presets\paper-light.jpg'
  }
  $projectLicense = Join-Path $root 'LICENSE'
  if (-not (Test-Path -LiteralPath $projectLicense -PathType Leaf)) {
    throw 'The project LICENSE file is missing.'
  }

  Assert-NoReparsePointInPath -Path $destination -Boundary $buildRoot
  if (Test-Path -LiteralPath $destination) {
    Assert-NoReparsePointTree -RootPath $destination
    Remove-Item -LiteralPath $destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Recurse
  Copy-Item -Path (Join-Path $root 'windows\*') -Destination $destination -Recurse -Force
  $framingPatch = Join-Path $root 'packaging\Add-CustomFramingRuntime.ps1'
  if (-not (Test-Path -LiteralPath $framingPatch -PathType Leaf)) {
    throw 'The custom framing runtime patch is missing.'
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $framingPatch -WindowsRoot $destination
  if ($LASTEXITCODE -ne 0) { throw 'The custom framing runtime patch failed.' }
  Copy-Item -LiteralPath $replacementDefaultImage `
    -Destination (Join-Path $destination 'assets\dream-reference.jpg') -Force

  $packageDirectory = Split-Path -Parent $destination
  $thirdPartyDirectory = Join-Path $packageDirectory 'THIRD_PARTY\Codex-Dream-Skin'
  $packagedLicense = Join-Path $thirdPartyDirectory 'LICENSE'
  $packagedNotice = Join-Path $thirdPartyDirectory 'NOTICE.md'
  $packagedProjectLicense = Join-Path $packageDirectory 'LICENSE'
  $packageNotices = Join-Path $packageDirectory 'THIRD_PARTY_NOTICES.md'
  foreach ($packageWritePath in @(
      $packageDirectory,
      $thirdPartyDirectory,
      $packagedLicense,
      $packagedNotice,
      $packagedProjectLicense,
      $packageNotices
    )) {
    Assert-NoReparsePointInPath -Path $packageWritePath -Boundary $buildRoot
  }
  New-Item -ItemType Directory -Force -Path $thirdPartyDirectory | Out-Null
  Copy-Item -LiteralPath $dependencyLicense -Destination $packagedLicense -Force
  Copy-Item -LiteralPath $dependencyNotice -Destination $packagedNotice -Force
  Copy-Item -LiteralPath $projectLicense -Destination $packagedProjectLicense -Force
  Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.md') `
    -Destination $packageNotices -Force

  $requiredPackageFiles = $requiredSourceFiles + @(
    'scripts\manager-actions.ps1',
    'scripts\apply-theme-and-recover.ps1',
    'scripts\runtime-version.ps1',
    'presets\catalog.json'
  )
  foreach ($relativePath in $requiredPackageFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $destination $relativePath) -PathType Leaf)) {
      throw "The assembled manager package is incomplete: $relativePath"
    }
  }
  $packagedDefaultImage = Join-Path $destination 'assets\dream-reference.jpg'
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $packagedDefaultImage).Hash -ne
      (Get-FileHash -Algorithm SHA256 -LiteralPath $replacementDefaultImage).Hash) {
    throw 'The assembled manager package contains an unexpected default theme image.'
  }
}

$packageFullPath = [System.IO.Path]::GetFullPath($packageRoot)
$buildFullPath = [System.IO.Path]::GetFullPath($build).TrimEnd('\')
if (-not $packageFullPath.StartsWith(($buildFullPath + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean a package outside the build directory: $packageFullPath"
}
Assert-NoReparsePointInPath -Path $packageFullPath -Boundary $buildFullPath
if (-not $TestsOnly -and (Test-Path -LiteralPath $packageFullPath)) {
  Assert-NoReparsePointTree -RootPath $packageFullPath
  Remove-Item -LiteralPath $packageFullPath -Recurse -Force
}

$cscCandidates = @(
  'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
  'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework C# compiler was not found.' }

function Resolve-GacAssembly([string]$Name) {
  $assembly = Get-ChildItem -LiteralPath 'C:\Windows\Microsoft.NET\assembly' -Recurse `
    -Filter "$Name.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $assembly) { throw "Required .NET assembly was not found: $Name.dll" }
  return $assembly.FullName
}

$wpfReferences = @(
  (Resolve-GacAssembly 'System.Xaml'),
  (Resolve-GacAssembly 'WindowsBase'),
  (Resolve-GacAssembly 'PresentationCore'),
  (Resolve-GacAssembly 'PresentationFramework')
)
$compressionReferences = @(
  (Resolve-GacAssembly 'System.IO.Compression'),
  (Resolve-GacAssembly 'System.IO.Compression.FileSystem')
)

$testExe = Join-Path $build 'ManagerTests.exe'
$sources = @(Get-ChildItem -LiteralPath (Join-Path $root 'src') -Filter '*.cs' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$testSources = @((Join-Path $root 'tests\ManagerTests.cs')) + $sources

& $csc /nologo /target:exe /platform:anycpu /out:$testExe /main:CodexDreamSkinManager.ManagerTests `
  /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Xml.dll `
  /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  $($compressionReferences | ForEach-Object { '/reference:' + $_ }) `
  $($wpfReferences | ForEach-Object { '/reference:' + $_ }) `
  $testSources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $testExe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$managerScript = Join-Path $root 'windows\scripts\manager-actions.ps1'
if (-not (Test-Path -LiteralPath $managerScript)) { throw 'manager-actions.ps1 is missing.' }
$recoveryScript = Join-Path $root 'windows\scripts\apply-theme-and-recover.ps1'
if (-not (Test-Path -LiteralPath $recoveryScript)) { throw 'apply-theme-and-recover.ps1 is missing.' }
$runtimeVersionScript = Join-Path $root 'windows\scripts\runtime-version.ps1'
if (-not (Test-Path -LiteralPath $runtimeVersionScript)) { throw 'runtime-version.ps1 is missing.' }
foreach ($scriptToParse in @($managerScript, $recoveryScript, $runtimeVersionScript)) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($scriptToParse, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if (@($parseErrors).Count -ne 0) { throw $parseErrors[0].Message }
}

$runtimeVersionTest = Join-Path $root 'tests\runtime-version.test.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeVersionTest `
  -RuntimeVersionScript $runtimeVersionScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$integrationTest = Join-Path $root 'tests\manager-actions.integration.ps1'
if (-not (Test-Path -LiteralPath $SkillRoot -PathType Container)) {
  throw "The CodexDreamSkin Windows package is required for integration tests: $SkillRoot"
}
New-RunnableWindowsPackage -SourceRoot $SkillRoot -DestinationRoot $packageWindows
$runtimeFramingTest = Join-Path $root 'tests\custom-framing-runtime.test.mjs'
& node $runtimeFramingTest $packageWindows
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$packagedManagerScript = Join-Path $packageWindows 'scripts\manager-actions.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $integrationTest `
  -ManagerScript $packagedManagerScript -SkillRoot $packageWindows
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$recoveryIntegrationTest = Join-Path $root 'tests\apply-theme-and-recover.integration.ps1'
$packagedRecoveryScript = Join-Path $packageWindows 'scripts\apply-theme-and-recover.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $recoveryIntegrationTest `
  -RecoveryScript $packagedRecoveryScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($TestsOnly) { exit 0 }

$legacyAppExe = Join-Path $build 'CodexDreamSkinManager.exe'
if (Test-Path -LiteralPath $legacyAppExe) { Remove-Item -LiteralPath $legacyAppExe -Force }
$appExe = Join-Path $packageRoot 'CodexDreamSkinManager.exe'
$appIcon = Join-Path $root 'assets\CodexDreamSkinManager.ico'
if (-not (Test-Path -LiteralPath $appIcon -PathType Leaf)) { throw 'CodexDreamSkinManager.ico is missing.' }
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /out:$appExe `
  ('/win32icon:' + $appIcon) `
  /main:CodexDreamSkinManager.Program `
  /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.Xml.dll `
  /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  $($compressionReferences | ForEach-Object { '/reference:' + $_ }) `
  $($wpfReferences | ForEach-Object { '/reference:' + $_ }) `
  $sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Add-Type -AssemblyName System.Drawing
$embeddedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($appExe)
if ($null -eq $embeddedIcon) { throw 'The built EXE does not expose an associated icon.' }
try {
  if ($embeddedIcon.Width -lt 16 -or $embeddedIcon.Height -lt 16) { throw 'The embedded EXE icon is invalid.' }
} finally {
  $embeddedIcon.Dispose()
}

Write-Host "Built runnable package: $packageRoot"
