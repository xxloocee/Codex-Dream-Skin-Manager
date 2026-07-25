[CmdletBinding()]
param(
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [string]$PackageRoot = (Join-Path $PSScriptRoot '..\build\CodexDreamSkinManager'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'),
  [string]$IsccPath
)

$ErrorActionPreference = 'Stop'
$expectedCompilerSha256 = '0A8757031B33777E4C9CBFFEE40F11A5062B36D25CBE144C1DB73B6102B80AD7'
$expectedSignerOrganization = 'Pyrsys B.V.'

function Assert-OfficialInnoSetupCompiler {
  param([Parameter(Mandatory)][string]$Path)

  $current = [System.IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Inno Setup compiler path must not contain a reparse point: $current"
      }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if (-not $parent -or $parent.FullName -eq $current) { break }
    $current = $parent.FullName
  }

  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if (-not $actualHash.Equals($expectedCompilerSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Inno Setup compiler hash mismatch: expected $expectedCompilerSha256, got $actualHash."
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "Inno Setup compiler signature is not valid: $($signature.StatusMessage)"
  }
  $organizationPattern = "(?:^|,\s*)O=$([regex]::Escape($expectedSignerOrganization))(?:,|$)"
  if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch $organizationPattern) {
    throw "Inno Setup compiler signer is not $expectedSignerOrganization."
  }
}

$package = [System.IO.Path]::GetFullPath($PackageRoot)
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$executable = Join-Path $package 'CodexDreamSkinManager.exe'
$iss = Join-Path $PSScriptRoot '..\packaging\CodexDreamSkinManager.iss'

foreach ($requiredPath in @(
    $executable,
    (Join-Path $package 'LICENSE'),
    (Join-Path $package 'THIRD_PARTY_NOTICES.md'),
    (Join-Path $package 'THIRD_PARTY\Codex-Dream-Skin\LICENSE'),
    (Join-Path $package 'THIRD_PARTY\Codex-Dream-Skin\NOTICE.md'),
    (Join-Path $package 'THIRD_PARTY\Node.js\LICENSE'),
    (Join-Path $package 'windows\scripts\manager-actions.ps1'),
    (Join-Path $package 'windows\scripts\apply-theme-and-recover.ps1'),
    (Join-Path $package 'windows\presets\catalog.json'),
    (Join-Path $package 'windows\runtime\node\node.exe'),
    $iss
  )) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Installer input is incomplete: $requiredPath"
  }
}

$installerDefinition = [System.IO.File]::ReadAllText($iss, [System.Text.Encoding]::UTF8)
foreach ($requiredDirective in @(
    'PrivilegesRequired=lowest',
    'DefaultDirName={localappdata}\Programs\CodexDreamSkinManager',
    'Source: "{#PackageRoot}\*"',
    'Filename: "{app}\{#AppExeName}"'
  )) {
  if (-not $installerDefinition.Contains($requiredDirective)) {
    throw "Installer definition is missing required contract: $requiredDirective"
  }
}

$productVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
if (-not $Version) { $Version = $productVersion }
if ($productVersion -ne $Version) {
  throw "EXE ProductVersion ($productVersion) does not match installer version ($Version)."
}

if (-not $IsccPath) {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) { $IsccPath = $command.Source }
}
if (-not $IsccPath) {
  foreach ($candidate in @(
      (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
      (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    )) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $IsccPath = $candidate; break }
  }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
  throw 'Inno Setup compiler ISCC.exe was not found. Run tools\prepare-inno-setup.ps1 first.'
}
$IsccPath = [System.IO.Path]::GetFullPath($IsccPath)
Assert-OfficialInnoSetupCompiler -Path $IsccPath

New-Item -ItemType Directory -Force -Path $output | Out-Null
$baseName = "CodexDreamSkinManager-v$Version-setup"
$installer = Join-Path $output "$baseName.exe"
$checksum = Join-Path $output "$baseName.sha256"
foreach ($path in @($installer, $checksum)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

& $IsccPath '/Qp' "/DAppVersion=$Version" "/DPackageRoot=$package" "/DOutputDir=$output" $iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Inno Setup did not produce the expected installer: $installer"
}
$installerVersion = "$((Get-Item -LiteralPath $installer).VersionInfo.ProductVersion)".Trim()
if ($installerVersion -ne $Version) {
  throw "Installer ProductVersion ($installerVersion) does not match $Version."
}

$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($checksum, "$hash  $([System.IO.Path]::GetFileName($installer))`r`n",
  [System.Text.Encoding]::ASCII)
Write-Host "Installer: $installer"
Write-Host "SHA-256: $hash"
