[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,
  [string]$PackageRoot = (Join-Path $PSScriptRoot '..\build\CodexDreamSkinManager'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
$package = [System.IO.Path]::GetFullPath($PackageRoot)
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$executable = Join-Path $package 'CodexDreamSkinManager.exe'

$requiredFiles = @(
  'CodexDreamSkinManager.exe',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY\Codex-Dream-Skin\LICENSE',
  'THIRD_PARTY\Codex-Dream-Skin\NOTICE.md',
  'windows\scripts\manager-actions.ps1',
  'windows\scripts\apply-theme-and-recover.ps1',
  'windows\presets\catalog.json'
)
foreach ($relativePath in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $package $relativePath) -PathType Leaf)) {
    throw "Release package is incomplete: $relativePath"
  }
}

$productVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
if ($productVersion -ne $Version) {
  throw "EXE ProductVersion ($productVersion) does not match release version ($Version)."
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
$baseName = "CodexDreamSkinManager-v$Version-windows"
$archive = Join-Path $output "$baseName.zip"
$checksum = Join-Path $output "$baseName.sha256"
foreach ($path in @($archive, $checksum)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

Compress-Archive -LiteralPath $package -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($checksum, "$hash  $([System.IO.Path]::GetFileName($archive))`r`n",
  [System.Text.Encoding]::ASCII)

Write-Host "Release archive: $archive"
Write-Host "SHA-256: $hash"
