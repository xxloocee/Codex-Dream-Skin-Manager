[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WindowsRoot
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($WindowsRoot)
$renderer = Join-Path $root 'assets\renderer-inject.js'
$css = Join-Path $root 'assets\dream-skin.css'
$injector = Join-Path $root 'scripts\injector.mjs'
foreach ($path in @($renderer, $css, $injector)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Shared runtime asset is missing: $path"
  }
}

# Framing is part of the canonical runtime/template. Keep this script as a
# packaging-time guard for downstream callers that still invoke the old hook;
# it must never mutate a generated asset after synchronization.
$rendererText = Get-Content -LiteralPath $renderer -Raw -Encoding UTF8
$cssText = Get-Content -LiteralPath $css -Raw -Encoding UTF8
$injectorText = Get-Content -LiteralPath $injector -Raw -Encoding UTF8
if ($rendererText -notmatch 'data-dream-art-framing' -or
    $rendererText -notmatch '__DREAM_SKIN_THEME_JSON__') {
  throw 'The canonical renderer is missing the shared framing or payload contract.'
}
if ($cssText -notmatch 'data-dream-art-framing') {
  throw 'The canonical CSS is missing the shared framing contract.'
}
if ($injectorText -notmatch 'positionMode' -or $injectorText -notmatch 'positionX') {
  throw 'The platform injector is missing normalized framing fields.'
}
Write-Output 'Shared runtime framing contract is already synchronized.'
