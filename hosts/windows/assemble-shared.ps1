[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'build\CodexDreamSkinManager' }
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$buildRoot = [IO.Path]::GetFullPath((Join-Path $root 'build')).TrimEnd('\')
if (-not $destination.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be inside the project build directory.' }
if (Test-Path -LiteralPath $destination) { throw 'Output already exists. Choose a new output directory or remove the previous build first.' }
$runtimeNode = (Resolve-Path -LiteralPath $NodeExecutable).Path
$nodeLicense = Join-Path (Split-Path -Parent $runtimeNode) 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) { throw 'Node LICENSE must be beside node.exe.' }
$runtime = (& $runtimeNode -p 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})') | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $runtime.platform -ne 'win32' -or $runtime.arch -ne 'x64' -or $runtime.version -notmatch '^22\.\d+\.\d+$' -or [version]$runtime.version -lt [version]'22.22.2') { throw 'Use Windows x64 Node >=22.22.2 <23.' }
$version = (Get-Content -LiteralPath (Join-Path $root 'windows\VERSION') -Raw).Trim()
Push-Location $root
try {
  & npm.cmd run build:core
  if ($LASTEXITCODE -ne 0) { throw 'Core compilation failed.' }
  & npm.cmd run build:ui
  if ($LASTEXITCODE -ne 0) { throw 'UI compilation failed.' }
  $compiled = Join-Path $root ('build\host-windows-' + [guid]::NewGuid().ToString('N'))
  $intermediate = $compiled + '-obj\'
  & dotnet publish (Join-Path $PSScriptRoot 'DreamSkin.SharedHost.csproj') -c Release -o $compiled "-p:BaseIntermediateOutputPath=$intermediate" "-p:Version=$version" "-p:InformationalVersion=$version" '-p:IncludeSourceRevisionInInformationalVersion=false'
  if ($LASTEXITCODE -ne 0) { throw 'Windows host compilation failed.' }
} finally { Pop-Location }
# Resolve original runtime dependency terms from this publish's actual assets graph.
$assets = Get-Content -LiteralPath (Join-Path $intermediate 'project.assets.json') -Raw | ConvertFrom-Json
$nugetMaterials = @()
foreach ($package in @(
  @{ Id = 'Microsoft.Web.WebView2'; Files = @('LICENSE.txt','NOTICE.txt') },
  @{ Id = 'Newtonsoft.Json'; Files = @('LICENSE.md') }
)) {
  $library = @($assets.libraries.PSObject.Properties | Where-Object { $_.Name.StartsWith($package.Id + '/', [StringComparison]::OrdinalIgnoreCase) -and $_.Value.type -eq 'package' })
  if ($library.Count -ne 1) { throw "Ambiguous or missing runtime dependency: $($package.Id)" }
  foreach ($name in $package.Files) {
    $material = $null
    foreach ($folder in $assets.packageFolders.PSObject.Properties.Name) {
      $candidate = Join-Path (Join-Path $folder $library[0].Value.path) $name
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $material = $candidate; break }
    }
    if (-not $material) { throw "NuGet original license/notice missing: $($library[0].Name)/$name" }
    $nugetMaterials += @{ Source = $material; Relative = $library[0].Name + '/' + $name }
  }
}

New-Item -ItemType Directory -Path $destination | Out-Null
Get-ChildItem -LiteralPath $compiled | Copy-Item -Destination $destination -Recurse
foreach ($directory in @('ui', 'updater', 'runtime\node', 'windows\assets', 'windows\presets', 'windows\runtime\node', 'THIRD_PARTY\Codex-Dream-Skin', 'THIRD_PARTY\Node.js')) {
  New-Item -ItemType Directory -Path (Join-Path $destination $directory) -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $root 'build\shared') -Destination (Join-Path $destination 'shared') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'packaging\update-public-key.pem') -Destination (Join-Path $destination 'updater\public-key.pem')
Copy-Item -LiteralPath (Join-Path $root 'build\ui\manager') -Destination (Join-Path $destination 'ui\manager') -Recurse
Copy-Item -Path (Join-Path $root 'windows\assets\*') -Destination (Join-Path $destination 'windows\assets') -Recurse
Copy-Item -Path (Join-Path $root 'windows\presets\*') -Destination (Join-Path $destination 'windows\presets') -Recurse
# Ship the reviewed default wallpaper instead of the upstream reference image.
Copy-Item -LiteralPath (Join-Path $root 'windows\presets\paper-light.jpg') -Destination (Join-Path $destination 'windows\assets\dream-reference.jpg') -Force
$catalog = Get-Content -LiteralPath (Join-Path $root 'windows\presets\catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$preset = $catalog.themes | Where-Object { $_.id -eq 'paper-light' }
$themeFile = Join-Path $destination 'windows\assets\theme.json'
$theme = Get-Content -LiteralPath $themeFile -Raw -Encoding UTF8 | ConvertFrom-Json
$theme.id = 'preset-paper-light'; $theme.name = $preset.name; $theme.image = 'dream-reference.jpg'; $theme.appearance = $preset.appearance
$theme.art = [pscustomobject]@{ focusX = $preset.focusX; focusY = $preset.focusY; safeArea = $preset.safeArea; taskMode = $preset.taskMode }
$theme | Add-Member -NotePropertyName palette -NotePropertyValue ([pscustomobject]@{ accent = $preset.accent }) -Force
[IO.File]::WriteAllText($themeFile, ($theme | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
foreach ($relative in @('runtime\node', 'windows\runtime\node')) {
  Copy-Item -LiteralPath $runtimeNode -Destination (Join-Path $destination "$relative\node.exe")
  Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $destination "$relative\LICENSE")
}
foreach ($relative in @('LICENSE', 'THIRD_PARTY_NOTICES.md')) { Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $destination }
Copy-Item -LiteralPath (Join-Path $root 'macos\LICENSE') -Destination (Join-Path $destination 'THIRD_PARTY\Codex-Dream-Skin\LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'macos\NOTICE.md') -Destination (Join-Path $destination 'THIRD_PARTY\Codex-Dream-Skin\NOTICE.md')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $destination 'THIRD_PARTY\Node.js\LICENSE')
foreach ($dependency in @('react','react-dom','scheduler')) {
  Copy-Item -LiteralPath (Join-Path $root "node_modules\$dependency\LICENSE") -Destination (Join-Path $destination "THIRD_PARTY\$dependency-LICENSE.txt")
}
foreach ($material in $nugetMaterials) {
  $target = Join-Path (Join-Path $destination 'THIRD_PARTY') $material.Relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath $material.Source -Destination $target
}
& $runtimeNode (Join-Path $root 'tools\stage-shared-resources.mjs') --stage windows $destination
if ($LASTEXITCODE -ne 0) { throw 'Platform resource staging failed.' }
Write-Output "Created manager package: $destination"
