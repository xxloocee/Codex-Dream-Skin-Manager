[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$RuntimeVersionScript)

$ErrorActionPreference = 'Stop'
. $RuntimeVersionScript

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ("$Expected" -cne "$Actual") { throw "$Message Expected '$Expected', got '$Actual'." }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-runtime-version-' + [guid]::NewGuid().ToString('N'))
try {
  $scripts = Join-Path $testRoot 'scripts'
  $assets = Join-Path $testRoot 'assets'
  New-Item -ItemType Directory -Force -Path $scripts, $assets | Out-Null
  $injector = Join-Path $scripts 'injector.mjs'
  $renderer = Join-Path $assets 'renderer-inject.js'
  $css = Join-Path $assets 'dream-skin.css'
  foreach ($file in @($injector, $renderer, $css)) {
    [System.IO.File]::WriteAllText($file, 'fixture', [System.Text.Encoding]::UTF8)
  }

  $startedAt = [datetime]::UtcNow
  foreach ($file in @($injector, $renderer, $css)) {
    [System.IO.File]::SetLastWriteTimeUtc($file, $startedAt.AddMinutes(-1))
  }
  $fingerprint = Get-DreamSkinRuntimeFingerprint -SkillRoot $testRoot
  Assert-Equal $true (Test-DreamSkinRuntimeCurrent -SkillRoot $testRoot `
    -RecordedInjectorPath $injector -RecordedFingerprint $fingerprint) `
    'An unchanged runtime was incorrectly marked stale.'

  $installedRoot = Join-Path $testRoot 'installed-engine'
  $installedScripts = Join-Path $installedRoot 'scripts'
  $installedAssets = Join-Path $installedRoot 'assets'
  New-Item -ItemType Directory -Force -Path $installedScripts, $installedAssets | Out-Null
  $otherInjector = Join-Path $installedScripts 'injector.mjs'
  $installedRenderer = Join-Path $installedAssets 'renderer-inject.js'
  $installedCss = Join-Path $installedAssets 'dream-skin.css'
  Copy-Item -LiteralPath $injector -Destination $otherInjector
  Copy-Item -LiteralPath $renderer -Destination $installedRenderer
  Copy-Item -LiteralPath $css -Destination $installedCss
  Assert-Equal $true (Test-DreamSkinRuntimeCurrent -SkillRoot $testRoot `
    -RecordedInjectorPath $otherInjector -RecordedFingerprint $fingerprint) `
    'An installed runtime with the same content fingerprint was incorrectly marked stale.'

  [System.IO.File]::WriteAllText($installedRenderer, 'tampered engine fixture', [System.Text.Encoding]::UTF8)
  Assert-Equal $false (Test-DreamSkinRuntimeCurrent -SkillRoot $testRoot `
    -RecordedInjectorPath $otherInjector -RecordedFingerprint $fingerprint) `
    'A modified installed runtime was incorrectly reported as current.'

  [System.IO.File]::WriteAllText($renderer, 'updated fixture', [System.Text.Encoding]::UTF8)
  [System.IO.File]::SetLastWriteTimeUtc($renderer, $startedAt.AddMinutes(-2))
  Assert-Equal $false (Test-DreamSkinRuntimeCurrent -SkillRoot $testRoot `
    -RecordedInjectorPath $injector -RecordedFingerprint $fingerprint) `
    'Changed renderer content with an older timestamp was not marked stale.'

  Assert-Equal $false (Test-DreamSkinRuntimeCurrent -SkillRoot $testRoot `
    -RecordedInjectorPath $injector -RecordedFingerprint '') `
    'A legacy state without a runtime fingerprint was not marked stale.'

  Assert-Equal '' (Get-DreamSkinRuntimeFingerprint -SkillRoot ("$testRoot`0")) `
    'An unreadable runtime path raised instead of producing an empty fingerprint.'

  Write-Host 'PASS: runtime fingerprints detect changed, relocated, and legacy injector states'
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
