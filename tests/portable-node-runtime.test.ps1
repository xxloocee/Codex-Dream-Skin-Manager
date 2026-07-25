[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SkillRoot,
  [Parameter(Mandatory = $true)][string]$NodeSource
)

$ErrorActionPreference = 'Stop'

function Assert-Equal {
  param($Expected, $Actual, [string]$Message)
  if ("$Expected" -cne "$Actual") { throw "$Message Expected '$Expected', got '$Actual'." }
}

$packagedNode = [System.IO.Path]::GetFullPath((Join-Path $SkillRoot 'runtime\node\node.exe'))
$nodeLicense = Join-Path (Split-Path -Parent $SkillRoot) 'THIRD_PARTY\Node.js\LICENSE'
if (-not (Test-Path -LiteralPath $packagedNode -PathType Leaf)) {
  throw "The packaged Node.js executable is missing: $packagedNode"
}
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) {
  throw "The packaged Node.js license is missing: $nodeLicense"
}

. (Join-Path $SkillRoot 'scripts\common-windows.ps1')
$runtime = Get-DreamSkinNodeRuntime
Assert-Equal $packagedNode ([System.IO.Path]::GetFullPath($runtime.Path)) `
  'Runtime resolution did not prefer the packaged Node.js executable.'
$originalPath = $env:PATH
try {
  $env:PATH = ''
  $runtimeWithoutPath = Get-DreamSkinNodeRuntime
  Assert-Equal $packagedNode ([System.IO.Path]::GetFullPath($runtimeWithoutPath.Path)) `
    'Runtime resolution required Node.js on PATH even though the package runtime exists.'
} finally {
  $env:PATH = $originalPath
}
Assert-Equal (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeSource).Hash `
  (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedNode).Hash `
  'The packaged Node.js executable does not match the selected build runtime.'

$reportedVersion = "$(& $packagedNode -p 'process.versions.node')".Trim()
Assert-Equal $runtime.Version $reportedVersion 'The packaged Node.js version probe was inconsistent.'

$fallbackRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-node-fallback-' + [guid]::NewGuid().ToString('N'))
$fallbackScripts = Join-Path $fallbackRoot 'scripts'
try {
  New-Item -ItemType Directory -Force -Path $fallbackScripts | Out-Null
  Copy-Item -LiteralPath (Join-Path $SkillRoot 'scripts\common-windows.ps1') -Destination $fallbackScripts
  Copy-Item -LiteralPath (Join-Path $SkillRoot 'scripts\config-utf8.ps1') -Destination $fallbackScripts
  . (Join-Path $fallbackScripts 'common-windows.ps1')
  $originalPath = $env:PATH
  try {
    $env:PATH = Split-Path -Parent ([System.IO.Path]::GetFullPath($NodeSource))
    $fallbackRuntime = Get-DreamSkinNodeRuntime
    Assert-Equal ([System.IO.Path]::GetFullPath($NodeSource)) ([System.IO.Path]::GetFullPath($fallbackRuntime.Path)) `
      'Runtime resolution did not fall back to Node.js on PATH when the package runtime was absent.'
  } finally {
    $env:PATH = $originalPath
  }
} finally {
  if (Test-Path -LiteralPath $fallbackRoot) { Remove-Item -LiteralPath $fallbackRoot -Recurse -Force }
}

$engineStateRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-node-engine-' + [guid]::NewGuid().ToString('N'))
try {
  . (Join-Path $SkillRoot 'scripts\theme-windows.ps1')
  $engine = Install-DreamSkinRuntimeEngine -SkillRoot $SkillRoot -StateRoot $engineStateRoot
  $engineNode = Join-Path $engine.Root 'runtime\node\node.exe'
  Assert-Equal (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedNode).Hash `
    (Get-FileHash -Algorithm SHA256 -LiteralPath $engineNode).Hash `
    'The installed runtime engine did not preserve the packaged Node.js executable.'
  $originalPath = $env:PATH
  try {
    $env:PATH = ''
    . (Join-Path $engine.Scripts 'common-windows.ps1')
    $engineRuntime = Get-DreamSkinNodeRuntime
    Assert-Equal ([System.IO.Path]::GetFullPath($engineNode)) ([System.IO.Path]::GetFullPath($engineRuntime.Path)) `
      'The installed runtime engine required Node.js on PATH.'
  } finally {
    $env:PATH = $originalPath
  }
} finally {
  if (Test-Path -LiteralPath $engineStateRoot) { Remove-Item -LiteralPath $engineStateRoot -Recurse -Force }
}

Write-Host "PASS: packaged Node.js $reportedVersion is licensed, executable, preferred, PATH-independent, copied into the installed engine, and preserves PATH fallback"
