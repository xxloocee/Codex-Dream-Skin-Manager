if (-not (Get-Command Read-DreamSkinUtf8File -ErrorAction SilentlyContinue)) {
  . (Join-Path $PSScriptRoot 'config-utf8.ps1')
}

$script:DreamSkinMaxImageBytes = 128 * 1024 * 1024
$script:DreamSkinMaxVideoBytes = 128 * 1024 * 1024

function Assert-DreamSkinNoReparseComponents {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $current = $fullPath
  while ($true) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Managed Dream Skin path contains a junction or symbolic link: $current"
      }
    }
    $currentNormalized = $current.TrimEnd('\')
    $rootNormalized = $root.TrimEnd('\')
    if ($currentNormalized.Equals($rootNormalized, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $parent = [System.IO.Path]::GetDirectoryName($current)
    if (-not $parent -or $parent.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $current = $parent
  }
}

function Ensure-DreamSkinManagedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  if (-not ($fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith($fullRoot + '\', [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Managed Dream Skin path escaped its state root: $fullPath"
  }
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
    throw "Managed Dream Skin path is a file, not a directory: $fullPath"
  }
  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
    throw "Managed Dream Skin directory could not be created: $fullPath"
  }
}

function Get-DreamSkinValidatedImageMetadata {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Get-Command Get-DreamSkinNodeRuntime -ErrorAction SilentlyContinue)) {
    throw 'Node.js runtime validation is unavailable for image metadata checks.'
  }
  $node = Get-DreamSkinNodeRuntime
  $metadataScript = Join-Path $PSScriptRoot 'image-metadata.mjs'
  $output = @(& $node.Path $metadataScript '--check' ([System.IO.Path]::GetFullPath($Path)) 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Image metadata is invalid or exceeds the 16384px / 50MP safety limit: $Path"
  }
  try { $metadata = ($output -join "`n") | ConvertFrom-Json -ErrorAction Stop } catch {
    throw "Image metadata helper returned invalid output: $Path"
  }
  if ($null -eq $metadata -or $null -eq $metadata.width -or $null -eq $metadata.height) {
    throw "Image metadata is invalid or exceeds the 16384px / 50MP safety limit: $Path"
  }
}

function Assert-DreamSkinImageFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$SkipImageMetadata
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Image does not exist: $fullPath"
  }
  $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
  if ($extension -notin @('.png', '.apng', '.jpg', '.jpeg', '.webp', '.gif', '.mp4')) {
    throw "Unsupported image format: $extension"
  }
  $length = (Get-Item -LiteralPath $fullPath -Force).Length
  if ($length -lt 1) { throw 'Theme image cannot be empty.' }
  $maxBytes = if ($extension -eq '.mp4') { $script:DreamSkinMaxVideoBytes } else { $script:DreamSkinMaxImageBytes }
  if ($length -gt $maxBytes) {
    if ($extension -eq '.mp4') { throw 'Theme video exceeds the 128 MiB limit.' }
    throw 'Theme image exceeds the 128 MiB limit.'
  }
  if (-not $SkipImageMetadata) {
    Get-DreamSkinValidatedImageMetadata -Path $fullPath
  }
}

function Assert-DreamSkinVideoDecodable {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
  )
  if ([System.IO.Path]::GetExtension($Path) -ine '.mp4') { return }
  Assert-DreamSkinImageFile -Path $Path
  $node = Get-DreamSkinNodeRuntime
  $stateFile = (Get-DreamSkinThemePaths -StateRoot $StateRoot).State
  $output = @(& $node.Path (Join-Path $PSScriptRoot 'validate-video-file.mjs') $Path $stateFile 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw (($output | ForEach-Object { "$_" }) -join "`n")
  }
}

function Assert-DreamSkinSafeCssFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  Assert-DreamSkinNoReparseComponents -Path $fullPath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Theme Safe CSS does not exist: $fullPath"
  }
  if (-not (Get-Command Get-DreamSkinNodeRuntime -ErrorAction SilentlyContinue)) {
    throw 'Node.js runtime validation is unavailable for Safe CSS checks.'
  }
  $node = Get-DreamSkinNodeRuntime
  $validator = Join-Path $PSScriptRoot 'validate-safe-css-file.mjs'
  if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
    throw 'Safe CSS validator is missing from the runtime engine.'
  }
  $output = @(& $node.Path $validator $fullPath 2>&1)
  if ($LASTEXITCODE -ne 0) {
    $detail = ($output -join "`n").Trim()
    throw $(if ($detail) { $detail } else { 'Theme Safe CSS failed validation.' })
  }
}

function Get-DreamSkinThemePaths {
  param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'))
  $fullRoot = [System.IO.Path]::GetFullPath($StateRoot)
  return [pscustomobject]@{
    Root = $fullRoot
    Active = Join-Path $fullRoot 'active-theme'
    Saved = Join-Path $fullRoot 'themes'
    Images = Join-Path $fullRoot 'images'
    PauseFile = Join-Path $fullRoot 'paused'
    State = Join-Path $fullRoot 'state.json'
  }
}

function Test-DreamSkinThemePathWithin {
  param([string]$Path, [string]$Root)
  if (-not $Path -or -not $Root) { return $false }
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $inside = $fullPath.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith($fullRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $inside) { return $false }

    $current = $fullPath.TrimEnd('\')
    while ($true) {
      if (-not (Test-Path -LiteralPath $current)) { return $false }
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $false
      }
      if ($current.Equals($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
      $parent = [System.IO.Path]::GetDirectoryName($current)
      if (-not $parent -or $parent.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
      }
      $current = $parent.TrimEnd('\')
    }
  } catch {
    return $false
  }
}

function Read-DreamSkinTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [switch]$SkipImageMetadata
  )
  $directory = [System.IO.Path]::GetFullPath($ThemeDirectory)
  Assert-DreamSkinNoReparseComponents -Path $directory
  $themePath = Join-Path $directory 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $themePath
  if (-not (Test-Path -LiteralPath $themePath -PathType Leaf)) {
    throw "Theme metadata is missing: $themePath"
  }
  try {
    $theme = (Read-DreamSkinUtf8File -Path $themePath) | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Theme metadata is invalid JSON: $themePath"
  }
  if ($null -eq $theme -or $theme -is [string] -or $theme -is [array] -or -not $theme.image) {
    throw "Theme metadata must be an object with a relative image path: $themePath"
  }
  $image = "$($theme.image)"
  if ([System.IO.Path]::IsPathRooted($image)) { throw 'Theme image path must be relative.' }
  $imagePath = [System.IO.Path]::GetFullPath((Join-Path $directory $image))
  if (-not (Test-DreamSkinThemePathWithin -Path $imagePath -Root $directory) -or
    -not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
    throw 'Theme image must remain inside its theme directory and exist.'
  }
  Assert-DreamSkinImageFile -Path $imagePath -SkipImageMetadata:$SkipImageMetadata
  return [pscustomobject]@{
    Directory = $directory
    ThemePath = $themePath
    ImagePath = $imagePath
    Theme = Normalize-DreamSkinThemeContract -Theme $theme
  }
}

function Normalize-DreamSkinThemeContract {
  param([Parameter(Mandatory = $true)][object]$Theme)
  if ($null -eq $Theme -or $Theme -is [string] -or $Theme -is [array]) {
    throw 'Theme contract must be a JSON object.'
  }
  if (-not $Theme.PSObject.Properties['id'] -or -not $Theme.PSObject.Properties['id'].Value) {
    $Theme | Add-Member -NotePropertyName id -NotePropertyValue 'custom' -Force
  }
  if (-not $Theme.PSObject.Properties['appearance'] -or -not $Theme.PSObject.Properties['appearance'].Value) {
    $Theme | Add-Member -NotePropertyName appearance -NotePropertyValue 'auto' -Force
  }
  if (-not $Theme.PSObject.Properties['art'] -or -not $Theme.PSObject.Properties['art'].Value) {
    $Theme | Add-Member -NotePropertyName art -NotePropertyValue `
      ([pscustomobject]@{ focusX = $null; focusY = $null; bubbleOpacity = 0.0; surfaceOpacity = 0.3; safeArea = 'auto'; taskMode = 'auto' }) -Force
  }
  return $Theme
}

function Write-DreamSkinTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [Parameter(Mandatory = $true)][object]$Theme
  )
  Assert-DreamSkinNoReparseComponents -Path $ThemeDirectory
  New-Item -ItemType Directory -Force -Path $ThemeDirectory | Out-Null
  Assert-DreamSkinNoReparseComponents -Path $ThemeDirectory
  $Theme = Normalize-DreamSkinThemeContract -Theme $Theme
  $json = $Theme | ConvertTo-Json -Depth 8
  $themePath = Join-Path $ThemeDirectory 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $themePath
  Write-DreamSkinUtf8FileAtomically -Path $themePath -Content ($json + "`r`n")
}

function Get-DreamSkinActiveThemeAppearance {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  try {
    $appearance = "$((Read-DreamSkinTheme -ThemeDirectory $ThemeDirectory).Theme.appearance)"
    if ($appearance -in @('light', 'dark')) { return $appearance }
  } catch {}
  return 'auto'
}

function Initialize-DreamSkinThemeStore {
  param(
    [Parameter(Mandatory = $true)][string]$SkillRoot,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
    # Replacing the active theme needs directories, not validation of
    # the old/default image. The replacement's temporary copy is validated later.
    [switch]$PrepareOnly
  )
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  foreach ($directory in @($paths.Root, $paths.Active, $paths.Saved, $paths.Images)) {
    Ensure-DreamSkinManagedDirectory -Path $directory -Root $paths.Root
  }
  if ($PrepareOnly) { return $paths }
  $assetRoot = Join-Path $SkillRoot 'assets'
  $bundledTheme = Read-DreamSkinTheme -ThemeDirectory $assetRoot
  $assetImage = $bundledTheme.ImagePath
  $assetImageName = [System.IO.Path]::GetFileName($assetImage)
  $bundledPresetId = "$($bundledTheme.Theme.id)"
  if ($bundledPresetId -cnotmatch '^preset-[A-Za-z0-9_-]{1,72}$') {
    throw "Bundled theme id must be a safe preset id: $bundledPresetId"
  }
  $activeTheme = Join-Path $paths.Active 'theme.json'
  Assert-DreamSkinNoReparseComponents -Path $activeTheme
  if (-not (Test-Path -LiteralPath $activeTheme -PathType Leaf)) {
    Ensure-DreamSkinManagedDirectory -Path $paths.Active -Root $paths.Root
    Assert-DreamSkinNoReparseComponents -Path (Join-Path $paths.Active $assetImageName)
    $activeImage = Join-Path $paths.Active $assetImageName
    Copy-Item -LiteralPath $assetImage -Destination $activeImage -Force
    Assert-DreamSkinNoReparseComponents -Path $activeImage
    Assert-DreamSkinImageFile -Path $activeImage
    $imageArchive = Join-Path $paths.Images $assetImageName
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Copy-Item -LiteralPath $assetImage -Destination $imageArchive -Force
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Assert-DreamSkinImageFile -Path $imageArchive
    Assert-DreamSkinNoReparseComponents -Path $activeTheme
    Copy-Item -LiteralPath (Join-Path $assetRoot 'theme.json') -Destination $activeTheme -Force
  }
  $null = Read-DreamSkinTheme -ThemeDirectory $paths.Active
  return $paths
}

function New-DreamSkinThemeImageName {
  param([Parameter(Mandatory = $true)][string]$Extension)
  return 'art-' + (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' +
    [guid]::NewGuid().ToString('N').Substring(0, 8) + $Extension.ToLowerInvariant()
}

function Set-DreamSkinActiveTheme {
  param(
    [Parameter(Mandatory = $true)][string]$ImagePath,
    [AllowNull()][object]$Theme,
    [string]$Name,
    [AllowNull()][string]$SafeCssPath,
    [switch]$SkipImageArchive,
    [switch]$OpacityOnly,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
  )
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Active -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Images -Root $paths.Root
  $source = [System.IO.Path]::GetFullPath($ImagePath)
  # The copied temporary file is the trust boundary. Avoid parsing the same
  # source media twice before validating that immutable snapshot.
  Assert-DreamSkinImageFile -Path $source -SkipImageMetadata
  $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
  if ($OpacityOnly -and $extension -ne '.mp4') { throw 'Opacity-only updates require a video theme.' }
  $oldImage = $null
  try { $oldImage = (Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata).ImagePath } catch {}
  if ($null -eq $Theme) {
    $Theme = [pscustomobject]@{
      schemaVersion = 1
      id = 'custom'
      name = '自定义主题'
      appearance = 'auto'
      art = [pscustomobject]@{ focusX = $null; focusY = $null; bubbleOpacity = 0.0; surfaceOpacity = 0.3; safeArea = 'auto'; taskMode = 'auto' }
    }
  }
  $imageName = New-DreamSkinThemeImageName -Extension $extension
  $target = Join-Path $paths.Active $imageName
  $temporary = Join-Path $paths.Active ('.dream-tmp-' + [guid]::NewGuid().ToString('N') + $extension)
  $temporaryCss = $null
  try {
    if ($SafeCssPath) {
      $safeCssSource = [System.IO.Path]::GetFullPath($SafeCssPath)
      Assert-DreamSkinSafeCssFile -Path $safeCssSource
      $temporaryCss = Join-Path $paths.Active ('.dream-tmp-' + [guid]::NewGuid().ToString('N') + '.css')
      Assert-DreamSkinNoReparseComponents -Path $temporaryCss
      Copy-Item -LiteralPath $safeCssSource -Destination $temporaryCss -Force
      Assert-DreamSkinSafeCssFile -Path $temporaryCss
    }
    Assert-DreamSkinNoReparseComponents -Path $target
    Assert-DreamSkinNoReparseComponents -Path $temporary
    Copy-Item -LiteralPath $source -Destination $temporary -Force
    Assert-DreamSkinNoReparseComponents -Path $temporary
    Assert-DreamSkinImageFile -Path $temporary
    if (-not $OpacityOnly) { Assert-DreamSkinVideoDecodable -Path $temporary -StateRoot $StateRoot }
    Move-Item -LiteralPath $temporary -Destination $target -Force
    Assert-DreamSkinNoReparseComponents -Path $target
    Assert-DreamSkinImageFile -Path $target -SkipImageMetadata
    $Theme | Add-Member -NotePropertyName image -NotePropertyValue $imageName -Force
    if ($Name) { $Theme | Add-Member -NotePropertyName name -NotePropertyValue $Name -Force }
    $Theme = Normalize-DreamSkinThemeContract -Theme $Theme
    $activeCss = Join-Path $paths.Active 'theme.css'
    Assert-DreamSkinNoReparseComponents -Path $activeCss
    if ($temporaryCss) {
      Move-Item -LiteralPath $temporaryCss -Destination $activeCss -Force
      $temporaryCss = $null
      Assert-DreamSkinSafeCssFile -Path $activeCss
    } else {
      Remove-Item -LiteralPath $activeCss -Force -ErrorAction SilentlyContinue
    }
    Write-DreamSkinTheme -ThemeDirectory $paths.Active -Theme $Theme
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    if ($temporaryCss) { Remove-Item -LiteralPath $temporaryCss -Force -ErrorAction SilentlyContinue }
  }
  $sameImage = $oldImage -and ([System.IO.Path]::GetFullPath($oldImage) -ieq [System.IO.Path]::GetFullPath($target))
  if ($oldImage -and -not $sameImage -and
    (Test-DreamSkinThemePathWithin -Path $oldImage -Root $paths.Active)) {
    Remove-Item -LiteralPath $oldImage -Force -ErrorAction SilentlyContinue
  }
  if (-not $SkipImageArchive) {
    $imageArchive = Join-Path $paths.Images $imageName
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Copy-Item -LiteralPath $target -Destination $imageArchive -Force
    Assert-DreamSkinNoReparseComponents -Path $imageArchive
    Assert-DreamSkinImageFile -Path $imageArchive
  }
  return Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata
}

function ConvertTo-DreamSkinCanonicalJsonValue {
  param([AllowNull()][object]$Value)
  if ($null -eq $Value -or $Value -is [string] -or $Value -is [char] -or
    $Value -is [System.ValueType]) {
    return $Value
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $canonicalDictionary = [ordered]@{}
    [string[]]$keys = @($Value.Keys | ForEach-Object { "$_" })
    [System.Array]::Sort($keys, [System.StringComparer]::Ordinal)
    foreach ($key in $keys) {
      $canonicalDictionary[$key] = ConvertTo-DreamSkinCanonicalJsonValue -Value $Value[$key]
    }
    return [pscustomobject]$canonicalDictionary
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $canonicalItems = @()
    foreach ($item in $Value) {
      $canonicalItems += ,(ConvertTo-DreamSkinCanonicalJsonValue -Value $item)
    }
    return ,$canonicalItems
  }
  $canonicalObject = [ordered]@{}
  [string[]]$propertyNames = @($Value.PSObject.Properties | ForEach-Object Name)
  [System.Array]::Sort($propertyNames, [System.StringComparer]::Ordinal)
  foreach ($propertyName in $propertyNames) {
    $canonicalObject[$propertyName] = ConvertTo-DreamSkinCanonicalJsonValue `
      -Value $Value.PSObject.Properties[$propertyName].Value
  }
  return [pscustomobject]$canonicalObject
}

function Get-DreamSkinThemeRuntimeContentFingerprint {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  $loaded = Read-DreamSkinTheme -ThemeDirectory $ThemeDirectory -SkipImageMetadata
  $runtimeTheme = $loaded.Theme | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $runtimeTheme.image = '<runtime-image>'
  $runtimeTheme = Normalize-DreamSkinThemeContract -Theme $runtimeTheme
  $canonicalTheme = ConvertTo-DreamSkinCanonicalJsonValue -Value $runtimeTheme
  $themeBytes = [System.Text.Encoding]::UTF8.GetBytes(
    ($canonicalTheme | ConvertTo-Json -Depth 8 -Compress)
  )
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $themeHash = ([System.BitConverter]::ToString($hasher.ComputeHash($themeBytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $hasher.Dispose()
  }
  $imageHash = (Get-FileHash -LiteralPath $loaded.ImagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $cssPath = Join-Path $loaded.Directory 'theme.css'
  $cssIdentity = 'absent'
  if (Test-Path -LiteralPath $cssPath -PathType Leaf) {
    Assert-DreamSkinNoReparseComponents -Path $cssPath
    if ((Get-Item -LiteralPath $cssPath -Force).Length -gt 256KB) {
      throw 'Theme CSS exceeds the 256 KB limit.'
    }
    $cssIdentity = (Get-FileHash -LiteralPath $cssPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $identity = "dreamskin-runtime-theme/1`0theme.json`0$themeHash`0image`0$imageHash`0theme.css`0$cssIdentity"
  $identityBytes = [System.Text.Encoding]::UTF8.GetBytes($identity)
  $identityHasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString(
      $identityHasher.ComputeHash($identityBytes)
    )).Replace('-', '').ToLowerInvariant()
  } finally {
    $identityHasher.Dispose()
  }
}

function Set-DreamSkinPaused {
  param(
    [Parameter(Mandatory = $true)][bool]$Paused,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
  )
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  if ($Paused) {
    Assert-DreamSkinNoReparseComponents -Path $paths.PauseFile
    Write-DreamSkinUtf8FileAtomically -Path $paths.PauseFile -Content "paused`r`n"
  } else {
    if (Test-Path -LiteralPath $paths.PauseFile) { Assert-DreamSkinNoReparseComponents -Path $paths.PauseFile }
    Remove-Item -LiteralPath $paths.PauseFile -Force -ErrorAction SilentlyContinue
  }
  return $Paused
}

function Test-DreamSkinPaused {
  param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'))
  return (Test-Path -LiteralPath (Get-DreamSkinThemePaths -StateRoot $StateRoot).PauseFile -PathType Leaf)
}

function Get-DreamSkinLiveSessionContext {
  param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'))
  $paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
  $state = $null
  try { $state = Read-DreamSkinState -Path $paths.State } catch { $state = $null }
  if ($null -eq $state -or -not $state.port -or -not $state.browserId) { return $null }
  $port = 0
  if (-not [int]::TryParse("$($state.port)", [ref]$port)) { return $null }
  Assert-DreamSkinPort -Port $port
  $browserId = "$($state.browserId)".Trim()
  if (-not (Test-DreamSkinBrowserId -Value $browserId)) { return $null }
  if (-not (Get-Command Get-DreamSkinNodeRuntime -ErrorAction SilentlyContinue) -or
    -not (Get-Command Invoke-DreamSkinNative -ErrorAction SilentlyContinue)) {
    return $null
  }
  $node = Get-DreamSkinNodeRuntime
  $injector = Join-Path $PSScriptRoot 'injector.mjs'
  if (-not (Test-Path -LiteralPath $injector)) { return $null }
  return [pscustomobject]@{
    Paths = $paths
    State = $state
    Port = $port
    BrowserId = $browserId
    NodePath = $node.Path
    Injector = $injector
  }
}

function New-DreamSkinOperationToken {
  $pidPart = [string]$PID
  $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $seq = Get-Random -Minimum 1 -Maximum 99999999
  return "${pidPart}:${ms}:${seq}"
}

function Show-DreamSkinOperationUi {
  param(
    [Parameter(Mandatory = $true)][object]$Session,
    [Parameter(Mandatory = $true)][ValidateSet('begin', 'finish')][string]$Phase,
    [string]$Kind = 'apply',
    [string]$Token,
    [ValidateSet('success', 'error', 'cancelled')][string]$UiState = 'success',
    [string]$Message = '',
    [int]$TimeoutMs = 3000
  )
  $argumentList = @($Session.Injector, "--port", "$($Session.Port)", "--browser-id", $Session.BrowserId, "--timeout-ms", "$TimeoutMs")
  if ($Phase -eq 'begin') {
    if ($Kind -notin @('apply', 'pause', 'switch')) { throw "Invalid operation kind: $Kind" }
    $token = if ($Token) { $Token } else { New-DreamSkinOperationToken }
    $argumentList += @('--begin-operation', '--operation-kind', $Kind, '--operation-token', $token)
    $probe = Invoke-DreamSkinNative -FilePath $Session.NodePath -ArgumentList $argumentList -DiscardStderr
    $printed = (($probe.Output -join "`n").Trim() -split "`n" | Select-Object -Last 1).Trim()
    if ($probe.ExitCode -ne 0 -or -not $printed) {
      return [pscustomobject]@{ Ok = $false; Token = $token; Message = '无法在 Codex 窗口显示进度。' }
    }
    return [pscustomobject]@{ Ok = $true; Token = $printed; Message = '' }
  }
  if (-not $Token) { throw 'Finish operation requires a token.' }
  if ($Message.Length -gt 240 -or $Message -match "[\r\n]") { throw 'Invalid operation message.' }
  $argumentList += @(
    '--finish-operation',
    '--operation-ui-state', $UiState,
    '--operation-message', $Message,
    '--operation-token', $Token
  )
  $probe = Invoke-DreamSkinNative -FilePath $Session.NodePath -ArgumentList $argumentList -DiscardStderr
  return [pscustomobject]@{
    Ok = ($probe.ExitCode -eq 0)
    Token = $Token
    Message = if ($probe.ExitCode -eq 0) { '' } else { '无法更新 Codex 窗口内的操作状态。' }
  }
}

# Mirror macOS pause: mark paused, show in-app loading, then strip the live skin over CDP.
# Writing only the pause file leaves CSS in the renderer until the watcher polls.
function Invoke-DreamSkinLiveRemove {
  param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
    [int]$TimeoutMs = 8000,
    [string]$PauseNoSessionMessage = '没有可连接的活动会话；已记录暂停，当前窗口可能仍显示皮肤。',
    [string]$PauseSucceededMessage = '皮肤已暂停',
    [string]$PauseFailedMessage = '已记录暂停，但卸下当前皮肤失败；可重试暂停或完全恢复。'
  )
  if ($TimeoutMs -lt 250 -or $TimeoutMs -gt 120000) {
    throw "Invalid live-remove timeout: $TimeoutMs"
  }
  foreach ($message in @($PauseNoSessionMessage, $PauseSucceededMessage, $PauseFailedMessage)) {
    if ([string]::IsNullOrWhiteSpace($message) -or $message.Length -gt 240 -or $message -match "[\r\n]") {
      throw 'Invalid live-remove message.'
    }
  }
  $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
  if ($null -eq $session) {
    return [pscustomobject]@{
      Attempted = $false
      Removed = $false
      Message = $PauseNoSessionMessage
    }
  }

  $token = $null
  $begin = Show-DreamSkinOperationUi -Session $session -Phase begin -Kind pause -TimeoutMs 3000
  if ($begin.Ok) { $token = $begin.Token }

  $argumentList = @(
    $session.Injector,
    '--remove',
    '--port', "$($session.Port)",
    '--browser-id', $session.BrowserId,
    '--timeout-ms', "$TimeoutMs"
  )
  if ($token) { $argumentList += @('--operation-token', $token) }
  if (Test-Path -LiteralPath $session.Paths.Active) {
    $argumentList += @('--theme-dir', $session.Paths.Active)
  }

  $removal = Invoke-DreamSkinNative -FilePath $session.NodePath -ArgumentList $argumentList -DiscardStderr
  if ($removal.ExitCode -eq 0) {
    if ($token) {
      $null = Show-DreamSkinOperationUi -Session $session -Phase finish -Token $token `
        -UiState success -Message $PauseSucceededMessage -TimeoutMs 1500
    }
    return [pscustomobject]@{
      Attempted = $true
      Removed = $true
      Message = $PauseSucceededMessage
    }
  }
  if ($token) {
    $null = Show-DreamSkinOperationUi -Session $session -Phase finish -Token $token `
      -UiState error -Message $PauseFailedMessage -TimeoutMs 1500
  }
  return [pscustomobject]@{
    Attempted = $true
    Removed = $false
    Message = $PauseFailedMessage
  }
}

function Invoke-DreamSkinLiveApply {
  param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
    [int]$TimeoutMs = 8000,
    [switch]$OpacityOnly
  )
  if ($TimeoutMs -lt 250 -or $TimeoutMs -gt 120000) {
    throw "Invalid live-apply timeout: $TimeoutMs"
  }
  $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
  if ($null -eq $session) {
    return [pscustomobject]@{
      Attempted = $false
      Applied = $false
      Message = '没有可连接的活动会话，无法确认皮肤已应用。'
    }
  }
  if (-not (Test-Path -LiteralPath $session.Paths.Active -PathType Container)) {
    return [pscustomobject]@{
      Attempted = $false
      Applied = $false
      Message = '活动主题目录不存在，无法应用皮肤。'
    }
  }

  $argumentList = @(
    $session.Injector,
    '--apply-live',
    '--port', "$($session.Port)",
    '--browser-id', $session.BrowserId,
    '--theme-dir', $session.Paths.Active,
    '--timeout-ms', "$TimeoutMs"
  )
  if ($OpacityOnly) { $argumentList += '--opacity-only' }
  $application = Invoke-DreamSkinNative -FilePath $session.NodePath -ArgumentList $argumentList -DiscardStderr
  return [pscustomobject]@{
    Attempted = $true
    Applied = ($application.ExitCode -eq 0)
    Verification = ($application.Output -join "`n")
    Message = if ($application.ExitCode -eq 0) {
      '皮肤已应用。'
    } else {
      '活动主题已保存，但当前 Codex 窗口未通过皮肤应用校验。'
    }
  }
}

function Get-DreamSkinLiveRendererStatus {
  param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
    [bool]$Paused = $false,
    [int]$TimeoutMs = 3000
  )
  if ($TimeoutMs -lt 250 -or $TimeoutMs -gt 120000) {
    throw "Invalid live-status timeout: $TimeoutMs"
  }
  $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
  if ($null -eq $session) {
    return [pscustomobject]@{
      Verified = $false
      Status = 'degraded'
      Message = '没有可验证的 Codex 渲染会话，无法确认皮肤显示状态。'
    }
  }

  $mode = if ($Paused) { '--verify-removed' } else { '--verify-live' }
  $argumentList = @(
    $session.Injector,
    $mode,
    '--port', "$($session.Port)",
    '--browser-id', $session.BrowserId,
    '--timeout-ms', "$TimeoutMs"
  )
  if (-not $Paused) {
    if (-not (Test-Path -LiteralPath $session.Paths.Active -PathType Container)) {
      return [pscustomobject]@{
        Verified = $false
        Status = 'degraded'
        Message = '活动主题目录不存在，无法确认皮肤显示状态。'
      }
    }
    $argumentList += @('--theme-dir', $session.Paths.Active)
  }
  $verification = Invoke-DreamSkinNative -FilePath $session.NodePath -ArgumentList $argumentList -DiscardStderr
  $verified = $verification.ExitCode -eq 0
  return [pscustomobject]@{
    Verified = $verified
    Status = if ($verified) { if ($Paused) { 'removed' } else { 'applied' } } else { 'degraded' }
    Message = if ($verified) {
      if ($Paused) { '当前 Codex 渲染器已卸下皮肤。' } else { '当前 Codex 渲染器已应用活动主题。' }
    } else {
      '当前 Codex 渲染状态未通过校验，无法确认活动主题是否已显示。'
    }
  }
}
