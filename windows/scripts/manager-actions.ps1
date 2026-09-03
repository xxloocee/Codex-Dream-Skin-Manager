[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Status','ApplyTheme','DeleteTheme','ImportTheme','ImportBatch','Pause','Resume','ResetTheme','ValidateImage')]
  [string]$Action,
  [Parameter(Mandatory = $true)][string]$SkillRoot,
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
  [string]$ThemeDirectory,
  [string]$ImagePath,
  [string]$Name,
  [string]$ThemeId = 'custom',
  [string]$Category = 'custom',
  [string[]]$Tags = @(),
  [string]$TagsJson = '',
  [string]$RequestPath,
  [ValidateSet('auto','light','dark')][string]$Appearance = 'auto',
  [ValidateRange(0.0, 1.0)][double]$FocusX = 0.5,
  [ValidateRange(0.0, 1.0)][double]$FocusY = 0.5,
  [ValidateRange(-1.0, 1.0)][double]$PositionX = 0.0,
  [ValidateRange(-1.0, 1.0)][double]$PositionY = 0.0,
  [ValidateRange(1.0, 2.0)][double]$Zoom = 1.0,
  [ValidateSet('locked','free')][string]$PositionMode = 'locked',
  [ValidateSet('true','false')][string]$FramingEnabled = 'false',
  [ValidateSet('auto','left','right','center','none')][string]$SafeArea = 'auto',
  [ValidateSet('auto','ambient','banner','full','off')][string]$TaskMode = 'auto',
  [ValidatePattern('^$|^#[0-9A-Fa-f]{6}$')][string]$Accent = '',
  [switch]$KeepCurrent,
  [ValidateRange(1, 30)][int]$LockTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
if ($TagsJson) {
  try {
    $tagsJsonText = $TagsJson.Trim()
    # PowerShell 5.1 unwraps a one-item JSON array into a scalar. Keep the
    # parsed result wrapped, but first require array syntax so a JSON string
    # cannot be accepted as a tag list by accident.
    if (-not $tagsJsonText.StartsWith('[') -or -not $tagsJsonText.EndsWith(']')) {
      throw 'tags JSON must be an array.'
    }
    # Use -InputObject instead of the pipeline: Windows PowerShell 5.1 emits
    # a JSON array as one Object[] pipeline item, which otherwise turns
    # [1,2] into a single tag containing "1 2".
    $parsedValue = ConvertFrom-Json -InputObject $tagsJsonText -ErrorAction Stop
    if ($null -eq $parsedValue) {
      $parsedTags = @()
    } elseif ($parsedValue -is [System.Array]) {
      $parsedTags = @($parsedValue)
    } else {
      # PowerShell 5.1 unwraps a one-item JSON array into its scalar value.
      # The bracket check above proves the source was still an array.
      $parsedTags = @($parsedValue)
    }
    if (@($parsedTags | Where-Object { $null -eq $_ }).Count -gt 0) {
      throw 'tags JSON must be an array.'
    }
    $Tags = @($parsedTags | ForEach-Object { "$_" })
  } catch {
    throw '主题标签 JSON 无效。'
  }
}
$scripts = Join-Path $SkillRoot 'scripts'
. (Join-Path $scripts 'common-windows.ps1')
. (Join-Path $scripts 'theme-windows.ps1')
. (Join-Path $scripts 'runtime-version.ps1')

$paths = Get-DreamSkinThemePaths -StateRoot $StateRoot
$ManagerDeleteMarkerName = '.manager-delete.json'
$UseCustomFraming = $FramingEnabled -eq 'true' -or $PositionX -ne 0.0 -or $PositionY -ne 0.0 -or
  $Zoom -ne 1.0 -or $PositionMode -eq 'free'

function ConvertTo-ManagerTheme {
  param(
    [string]$Id,
    [string]$ThemeName,
    [string]$ThemeImage,
    [string]$Directory,
    [bool]$Preset,
    [string]$Category = 'uncategorized',
    [object[]]$Tags = @(),
    [string]$Source = 'saved',
    [int]$Order = 0,
    [string]$AddedAt = '',
    [string]$ThemeAppearance = 'auto',
    [double]$ThemeFocusX = 0.5,
    [double]$ThemeFocusY = 0.5,
    [double]$ThemePositionX = 0.0,
    [double]$ThemePositionY = 0.0,
    [double]$ThemeZoom = 1.0,
    [string]$ThemePositionMode = 'locked',
    [bool]$ThemeFramingEnabled = $false,
    [string]$ThemeSafeArea = 'auto',
    [string]$ThemeTaskMode = 'auto',
    [string]$ThemeAccent = ''
  )
  return [ordered]@{
    id = $Id
    name = $ThemeName
    imagePath = $ThemeImage
    themeDirectory = $Directory
    isPreset = $Preset
    category = $Category
    tags = @($Tags)
    source = $Source
    order = $Order
    addedAt = $AddedAt
    appearance = $ThemeAppearance
    focusX = $ThemeFocusX
    focusY = $ThemeFocusY
    positionX = $ThemePositionX
    positionY = $ThemePositionY
    zoom = $ThemeZoom
    positionMode = $ThemePositionMode
    framingEnabled = $ThemeFramingEnabled
    safeArea = $ThemeSafeArea
    taskMode = $ThemeTaskMode
    accent = $ThemeAccent
  }
}

function ConvertTo-ManagerPresetOption {
  param(
    [Parameter(Mandatory = $true)][object]$Preset,
    [int]$Order = 0
  )
  $tags = @()
  foreach ($tag in @($Preset.tags)) {
    if (-not [string]::IsNullOrWhiteSpace("$tag")) { $tags += "$tag" }
  }
  return ConvertTo-ManagerTheme -Id "$($Preset.id)" -ThemeName "$($Preset.name)" `
    -ThemeImage "$($Preset.imagePath)" -Directory '' -Preset $true `
    -Category $(if ($Preset.category) { "$($Preset.category)" } else { 'uncategorized' }) `
    -Tags $tags -Source 'preset' -Order $Order `
    -ThemeAppearance $(if ($Preset.appearance) { "$($Preset.appearance)" } else { 'auto' }) `
    -ThemeFocusX $(if ($null -ne $Preset.focusX) { [double]$Preset.focusX } else { 0.5 }) `
    -ThemeFocusY $(if ($null -ne $Preset.focusY) { [double]$Preset.focusY } else { 0.5 }) `
    -ThemePositionX $(if ($null -ne $Preset.positionX) { [double]$Preset.positionX } else { 0.0 }) `
    -ThemePositionY $(if ($null -ne $Preset.positionY) { [double]$Preset.positionY } else { 0.0 }) `
    -ThemeZoom $(if ($null -ne $Preset.zoom) { [double]$Preset.zoom } else { 1.0 }) `
    -ThemePositionMode $(if ($Preset.positionMode) { "$($Preset.positionMode)" } else { 'locked' }) `
    -ThemeFramingEnabled ([bool]$Preset.framingEnabled) `
    -ThemeSafeArea $(if ($Preset.safeArea) { "$($Preset.safeArea)" } else { 'auto' }) `
    -ThemeTaskMode $(if ($Preset.taskMode) { "$($Preset.taskMode)" } else { 'auto' }) `
    -ThemeAccent $(if ($Preset.accent) { "$($Preset.accent)" } else { '' })
}

function Test-ManagerThemeFraming {
  param([object]$Theme)
  if (-not $Theme -or -not $Theme.art) { return $false }
  $names = @($Theme.art.PSObject.Properties.Name)
  return $names -contains 'positionX' -or $names -contains 'positionY' -or
    $names -contains 'zoom' -or $names -contains 'positionMode'
}

function Read-ManagerPresetCatalog {
  param([Parameter(Mandatory = $true)][string]$PresetRoot)
  $catalogPath = Join-Path $PresetRoot 'catalog.json'
  if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) { return $null }
  Assert-DreamSkinNoReparseComponents -Path $catalogPath
  try { $catalog = (Read-DreamSkinUtf8File -Path $catalogPath) | ConvertFrom-Json -ErrorAction Stop } catch {
    throw '内置主题目录不是有效 JSON。'
  }
  if ($null -eq $catalog -or $catalog -is [string] -or $catalog -is [array] -or "$($catalog.schemaVersion)" -ne '1') {
    throw '内置主题目录 schemaVersion 必须为 1。'
  }
  $entries = @($catalog.themes)
  if ($entries.Count -lt 1 -or $entries.Count -gt 100) { throw '内置主题目录必须包含 1 到 100 项。' }
  $seen = @{}
  $result = @()
  $allowedCategories = @('dream','nature','cyber','minimal','dark','warm')
  for ($index = 0; $index -lt $entries.Count; $index++) {
    $entry = $entries[$index]
    $id = "$($entry.id)"
    $name = "$($entry.name)".Trim()
    $imageName = "$($entry.image)"
    $category = "$($entry.category)"
    if ($id -notmatch '^[a-z0-9][a-z0-9-]{0,63}$' -or $seen.ContainsKey($id)) { throw "内置主题 ID 无效或重复：$id" }
    if (-not $name -or $name.Length -gt 80) { throw "内置主题名称无效：$id" }
    if ([System.IO.Path]::IsPathRooted($imageName) -or [System.IO.Path]::GetFileName($imageName) -cne $imageName) {
      throw "内置主题图片必须是目录根部的相对文件名：$id"
    }
    if ($category -notin $allowedCategories) { throw "内置主题分类无效：$id" }
    $imagePath = [System.IO.Path]::GetFullPath((Join-Path $PresetRoot $imageName))
    if (-not (Test-DreamSkinThemePathWithin -Path $imagePath -Root $PresetRoot)) { throw "内置主题图片越界：$id" }
    Assert-DreamSkinImageFile -Path $imagePath -SkipImageMetadata
    $tags = @($entry.tags | ForEach-Object { "$_".Trim() })
    if ($tags.Count -gt 8 -or @($tags | Where-Object { -not $_ -or $_.Length -gt 20 }).Count -gt 0) { throw "内置主题标签无效：$id" }
    $appearance = if ($entry.appearance) { "$($entry.appearance)" } else { 'auto' }
    $safeArea = if ($entry.safeArea) { "$($entry.safeArea)" } else { 'auto' }
    $taskMode = if ($entry.taskMode) { "$($entry.taskMode)" } else { 'auto' }
    if ($appearance -notin @('auto','light','dark') -or $safeArea -notin @('auto','left','right','center','none') -or
      $taskMode -notin @('auto','ambient','banner','full','off')) { throw "内置主题参数无效：$id" }
    $accent = "$($entry.accent)"
    if ($accent -and $accent -notmatch '^#[0-9A-Fa-f]{6}$') { throw "内置主题强调色无效：$id" }
    $focusX = if ($null -ne $entry.focusX) { [double]$entry.focusX } else { 0.5 }
    $focusY = if ($null -ne $entry.focusY) { [double]$entry.focusY } else { 0.5 }
    if ([double]::IsNaN($focusX) -or [double]::IsInfinity($focusX) -or [double]::IsNaN($focusY) -or
      [double]::IsInfinity($focusY) -or $focusX -lt 0 -or $focusX -gt 1 -or $focusY -lt 0 -or $focusY -gt 1) {
      throw "内置主题焦点无效：$id"
    }
    $seen[$id] = $true
    $themeContract = $entry | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $themeContract | Add-Member -NotePropertyName schemaVersion -NotePropertyValue 1 -Force
    $themeContract | Add-Member -NotePropertyName id -NotePropertyValue "preset-$id" -Force
    $themeContract | Add-Member -NotePropertyName name -NotePropertyValue $name -Force
    $themeContract | Add-Member -NotePropertyName image -NotePropertyValue $imageName -Force
    $themeContract | Add-Member -NotePropertyName category -NotePropertyValue $category -Force
    $themeContract | Add-Member -NotePropertyName tags -NotePropertyValue @($tags) -Force
    $themeContract | Add-Member -NotePropertyName appearance -NotePropertyValue $appearance -Force
    $themeContract | Add-Member -NotePropertyName art -NotePropertyValue ([pscustomobject][ordered]@{
      focusX = $focusX
      focusY = $focusY
      safeArea = $safeArea
      taskMode = $taskMode
    }) -Force
    if (-not $themeContract.PSObject.Properties['palette']) {
      $themeContract | Add-Member -NotePropertyName palette -NotePropertyValue ([pscustomobject]@{})
    }
    if ($accent) {
      $themeContract.palette | Add-Member -NotePropertyName accent `
        -NotePropertyValue $accent.ToUpperInvariant() -Force
    }
    $result += [ordered]@{
      id = "preset-$id"; name = $name; imagePath = $imagePath; themeDirectory = ''; isPreset = $true
      category = $category; tags = @($tags); source = 'preset'; order = $index; addedAt = ''
      appearance = $appearance; focusX = $focusX; focusY = $focusY; safeArea = $safeArea
      positionX = 0.0; positionY = 0.0; zoom = 1.0; positionMode = 'locked'; framingEnabled = $false
      taskMode = $taskMode; accent = $accent.ToUpperInvariant(); themeContract = $themeContract
    }
  }
  return @($result)
}

function Get-ManagerDirectoryPresetEntries {
  param([Parameter(Mandatory = $true)][string]$PresetRoot)
  $result = @()
  if (-not (Test-Path -LiteralPath $PresetRoot -PathType Container)) { return @() }
  foreach ($directory in @(Get-ChildItem -LiteralPath $PresetRoot -Directory -Force -ErrorAction SilentlyContinue)) {
    try {
      $loaded = Read-DreamSkinTheme -ThemeDirectory $directory.FullName -SkipImageMetadata
      $id = "$($loaded.Theme.id)"
      if ($id -notmatch '^preset-[A-Za-z0-9_-]{1,72}$') { continue }
      $tags = @($loaded.Theme.tags | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") } |
        ForEach-Object { "$_" })
      $result += [ordered]@{
        id = $id
        name = if ($loaded.Theme.name) { "$($loaded.Theme.name)" } else { $directory.Name }
        imagePath = $loaded.ImagePath
        themeDirectory = ''
        isPreset = $true
        category = if ($loaded.Theme.category) { "$($loaded.Theme.category)" } else { 'uncategorized' }
        tags = $tags
        source = 'preset'
        order = 1000 + $result.Count
        addedAt = ''
        appearance = if ($loaded.Theme.appearance) { "$($loaded.Theme.appearance)" } else { 'auto' }
        focusX = if ($null -ne $loaded.Theme.art.focusX) { [double]$loaded.Theme.art.focusX } else { 0.5 }
        focusY = if ($null -ne $loaded.Theme.art.focusY) { [double]$loaded.Theme.art.focusY } else { 0.5 }
        positionX = if ($null -ne $loaded.Theme.art.positionX) { [double]$loaded.Theme.art.positionX } else { 0.0 }
        positionY = if ($null -ne $loaded.Theme.art.positionY) { [double]$loaded.Theme.art.positionY } else { 0.0 }
        zoom = if ($null -ne $loaded.Theme.art.zoom) { [double]$loaded.Theme.art.zoom } else { 1.0 }
        positionMode = if ($loaded.Theme.art.positionMode) { "$($loaded.Theme.art.positionMode)" } else { 'locked' }
        framingEnabled = Test-ManagerThemeFraming -Theme $loaded.Theme
        safeArea = if ($loaded.Theme.art.safeArea) { "$($loaded.Theme.art.safeArea)" } else { 'auto' }
        taskMode = if ($loaded.Theme.art.taskMode) { "$($loaded.Theme.art.taskMode)" } else { 'auto' }
        accent = if ($loaded.Theme.palette.accent) { "$($loaded.Theme.palette.accent)" } else { '' }
        themeContract = $loaded.Theme
      }
    } catch {
      # A malformed optional preset must not hide the catalog or saved themes.
    }
  }
  return @($result)
}

function Get-ManagerPresetCandidates {
  param([Parameter(Mandatory = $true)][string]$PresetRoot)
  $candidates = @()
  $catalog = $null
  try { $catalog = Read-ManagerPresetCatalog -PresetRoot $PresetRoot } catch {}
  if ($null -ne $catalog) {
    $candidates += @($catalog)
  } else {
    foreach ($image in @(Get-ChildItem -LiteralPath $PresetRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' })) {
      $id = [System.IO.Path]::GetFileNameWithoutExtension($image.Name)
      $fallback = [ordered]@{
        id = "preset-$id"
        name = (Get-Culture).TextInfo.ToTitleCase(($id -replace '-', ' '))
        imagePath = $image.FullName
        category = 'uncategorized'
        tags = @()
        appearance = 'auto'
        focusX = 0.5
        focusY = 0.5
        positionX = 0.0
        positionY = 0.0
        zoom = 1.0
        positionMode = 'locked'
        framingEnabled = $false
        safeArea = 'auto'
        taskMode = 'auto'
        accent = ''
      }
      $candidates += $fallback
    }
  }
  $candidates += @(Get-ManagerDirectoryPresetEntries -PresetRoot $PresetRoot)
  $unique = @()
  $seen = @{}
  foreach ($candidate in $candidates) {
    $id = "$($candidate.id)"
    if (-not $id -or $seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    $unique += $candidate
  }
  return @($unique)
}

function Get-ManagerPresetByImagePath {
  param(
    [Parameter(Mandatory = $true)][string]$PresetRoot,
    [Parameter(Mandatory = $true)][string]$ImagePath
  )
  try { $target = [System.IO.Path]::GetFullPath($ImagePath) } catch { return $null }
  foreach ($candidate in @(Get-ManagerPresetCandidates -PresetRoot $PresetRoot)) {
    try {
      $candidatePath = [System.IO.Path]::GetFullPath("$($candidate.imagePath)")
      if ([string]::Equals($candidatePath, $target, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $candidate
      }
    } catch {}
  }
  return $null
}

function ConvertTo-ManagerPresetThemeContract {
  param([Parameter(Mandatory = $true)][object]$Preset)
  if ($Preset.themeContract) {
    return ($Preset.themeContract | ConvertTo-Json -Depth 12 | ConvertFrom-Json)
  }
  $theme = [pscustomobject][ordered]@{
    schemaVersion = 1
    id = "$($Preset.id)"
    name = "$($Preset.name)"
    image = ''
    category = if ($Preset.category) { "$($Preset.category)" } else { 'uncategorized' }
    tags = @($Preset.tags)
    appearance = if ($Preset.appearance) { "$($Preset.appearance)" } else { 'auto' }
    art = [pscustomobject][ordered]@{
      focusX = if ($null -ne $Preset.focusX) { [double]$Preset.focusX } else { 0.5 }
      focusY = if ($null -ne $Preset.focusY) { [double]$Preset.focusY } else { 0.5 }
      safeArea = if ($Preset.safeArea) { "$($Preset.safeArea)" } else { 'auto' }
      taskMode = if ($Preset.taskMode) { "$($Preset.taskMode)" } else { 'auto' }
    }
    palette = [pscustomobject]@{}
  }
  if ($Preset.accent) {
    $theme.palette | Add-Member -NotePropertyName accent -NotePropertyValue "$($Preset.accent)" -Force
  }
  return $theme
}

function Get-ManagerWriteMutexName {
  param([Parameter(Mandatory = $true)][string]$Root)
  $normalized = [System.IO.Path]::GetFullPath($Root).TrimEnd('\').ToUpperInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
    $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
  } finally {
    $sha.Dispose()
  }
  return 'Local\CodexDreamSkin-Write-' + $hash.Substring(0, 24)
}

function Invoke-ManagerWriteLock {
  param([Parameter(Mandatory = $true)][scriptblock]$Operation)
  $mutex = New-Object System.Threading.Mutex($false, (Get-ManagerWriteMutexName -Root $paths.Root))
  $operationLock = $null
  $recoveryLockHeld = $env:CODEX_DREAM_SKIN_RECOVERY_LOCK_HELD -eq '1'
  $acquired = $false
  try {
    if (-not $recoveryLockHeld) {
      $operationLock = Enter-DreamSkinOperationLock
    }
    try {
      $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($LockTimeoutSeconds))
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }
    if (-not $acquired) {
      throw '另一个换肤操作正在进行，请稍后重试。'
    }
    & $Operation
  } finally {
    if ($acquired) {
      try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
    if ($null -ne $operationLock) {
      Exit-DreamSkinOperationLock -Mutex $operationLock
    }
  }
}

function New-ManagerCustomTheme {
  param([Parameter(Mandatory = $true)][string]$ThemeName)
  $theme = [pscustomobject][ordered]@{
    schemaVersion = 1
    id = if ($ThemeId) { $ThemeId } else { 'custom' }
    name = $ThemeName
    image = ''
    category = if ($Category) { $Category } else { 'custom' }
    tags = @($Tags)
    appearance = $Appearance
    art = [pscustomobject][ordered]@{
      focusX = $FocusX
      focusY = $FocusY
      safeArea = $SafeArea
      taskMode = $TaskMode
    }
    palette = [pscustomobject]@{}
  }
  if ($Accent) {
    $theme.palette | Add-Member -NotePropertyName accent -NotePropertyValue $Accent.ToUpperInvariant()
  }
  if ($UseCustomFraming) {
    $theme.art | Add-Member -NotePropertyName positionX -NotePropertyValue $PositionX
    $theme.art | Add-Member -NotePropertyName positionY -NotePropertyValue $PositionY
    $theme.art | Add-Member -NotePropertyName zoom -NotePropertyValue $Zoom
    $theme.art | Add-Member -NotePropertyName positionMode -NotePropertyValue $PositionMode
  }
  return $theme
}

function Save-ManagerThemeDirectly {
  param(
    [Parameter(Mandatory = $true)][string]$SourceImage,
    [Parameter(Mandatory = $true)][string]$ThemeName,
    [Parameter(Mandatory = $true)][object]$Theme,
    [string]$SafeCssPath,
    [string]$LicensePath
  )
  $trimmed = $ThemeName.Trim()
  if (-not $trimmed -or $trimmed.Length -gt 80 -or $trimmed -match '[\u0000-\u001f]') {
    throw '主题名称必须包含 1 到 80 个可见字符。'
  }
  $source = [System.IO.Path]::GetFullPath($SourceImage)
  Assert-DreamSkinImageFile -Path $source
  Ensure-DreamSkinManagedDirectory -Path $paths.Root -Root $paths.Root
  Ensure-DreamSkinManagedDirectory -Path $paths.Saved -Root $paths.Root

  $id = (Get-Date).ToString('yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $temporary = Join-Path $paths.Saved ('.manager-tmp-' + [guid]::NewGuid().ToString('N'))
  $destination = Join-Path $paths.Saved $id
  Assert-DreamSkinNoReparseComponents -Path $temporary
  Assert-DreamSkinNoReparseComponents -Path $destination
  if (Test-Path -LiteralPath $destination) { throw "主题目录已存在：$destination" }

  try {
    Ensure-DreamSkinManagedDirectory -Path $temporary -Root $paths.Root
    $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
    $imageName = 'art' + $extension
    $targetImage = Join-Path $temporary $imageName
    Assert-DreamSkinNoReparseComponents -Path $targetImage
    Copy-Item -LiteralPath $source -Destination $targetImage -Force
    Assert-DreamSkinImageFile -Path $targetImage

    $Theme.id = $id
    $Theme.name = $trimmed
    $Theme.image = $imageName
    Write-DreamSkinTheme -ThemeDirectory $temporary -Theme $Theme
    if ($SafeCssPath) {
      $safeCssSource = [System.IO.Path]::GetFullPath($SafeCssPath)
      Assert-DreamSkinNoReparseComponents -Path $safeCssSource
      Assert-DreamSkinSafeCssFile -Path $safeCssSource
      Copy-Item -LiteralPath $safeCssSource -Destination (Join-Path $temporary 'theme.css') -Force
      Assert-DreamSkinSafeCssFile -Path (Join-Path $temporary 'theme.css')
    }
    if ($LicensePath) {
      $licenseSource = [System.IO.Path]::GetFullPath($LicensePath)
      Assert-DreamSkinNoReparseComponents -Path $licenseSource
      if (-not (Test-Path -LiteralPath $licenseSource -PathType Leaf) -or
        (Get-Item -LiteralPath $licenseSource).Length -lt 1 -or
        (Get-Item -LiteralPath $licenseSource).Length -gt 64KB) { throw '主题 LICENSE.txt 无效。' }
      Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $temporary 'LICENSE.txt') -Force
    }
    $null = Read-DreamSkinTheme -ThemeDirectory $temporary
    Move-Item -LiteralPath $temporary -Destination $destination
    Assert-DreamSkinNoReparseComponents -Path $destination
    return Read-DreamSkinTheme -ThemeDirectory $destination
  } finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-ManagerThemeFingerprint {
  param(
    [Parameter(Mandatory = $true)][string]$SourceImage,
    [Parameter(Mandatory = $true)][object]$Theme
  )
  $imageHash = (Get-FileHash -LiteralPath ([System.IO.Path]::GetFullPath($SourceImage)) -Algorithm SHA256).Hash
  $accent = if ($Theme.palette -and $Theme.palette.accent) { "$($Theme.palette.accent)".ToUpperInvariant() } else { '' }
  $normalized = [ordered]@{
    imageHash = $imageHash
    framingEnabled = Test-ManagerThemeFraming -Theme $Theme
    appearance = if ($Theme.appearance) { "$($Theme.appearance)" } else { 'auto' }
    focusX = if ($Theme.art -and $null -ne $Theme.art.focusX) { [double]$Theme.art.focusX } else { 0.5 }
    focusY = if ($Theme.art -and $null -ne $Theme.art.focusY) { [double]$Theme.art.focusY } else { 0.5 }
    positionX = if ($Theme.art -and $null -ne $Theme.art.positionX) { [double]$Theme.art.positionX } else { 0.0 }
    positionY = if ($Theme.art -and $null -ne $Theme.art.positionY) { [double]$Theme.art.positionY } else { 0.0 }
    zoom = if ($Theme.art -and $null -ne $Theme.art.zoom) { [double]$Theme.art.zoom } else { 1.0 }
    positionMode = if ($Theme.art -and $Theme.art.positionMode) { "$($Theme.art.positionMode)" } else { 'locked' }
    safeArea = if ($Theme.art -and $Theme.art.safeArea) { "$($Theme.art.safeArea)" } else { 'auto' }
    taskMode = if ($Theme.art -and $Theme.art.taskMode) { "$($Theme.art.taskMode)" } else { 'auto' }
    accent = $accent
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($normalized | ConvertTo-Json -Compress -Depth 5))
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

$ManagerFingerprintVersion = 2

function Get-ManagerSavedFingerprints {
  $fingerprints = @{}
  foreach ($saved in @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)) {
    try {
      $loaded = Read-DreamSkinTheme -ThemeDirectory $saved.Path -SkipImageMetadata
      # Stored fingerprints from older manager versions omit custom-framing fields.
      # Recompute unless the theme explicitly records the current fingerprint version.
      $fingerprintVersion = 0
      if ($null -ne $loaded.Theme.managerFingerprintVersion) {
        [void][int]::TryParse("$($loaded.Theme.managerFingerprintVersion)", [ref]$fingerprintVersion)
      }
      $fingerprint = if ($fingerprintVersion -eq $ManagerFingerprintVersion -and $loaded.Theme.managerFingerprint) {
        "$($loaded.Theme.managerFingerprint)"
      } else {
        Get-ManagerThemeFingerprint -SourceImage $loaded.ImagePath -Theme $loaded.Theme
      }
      if ($fingerprint) { $fingerprints[$fingerprint] = $saved.Path }
    } catch {}
  }
  return $fingerprints
}

function Read-ManagerBatchRequest {
  if (-not $RequestPath) { throw '批量导入缺少请求文件。' }
  $requestsRoot = Join-Path $paths.Root 'requests'
  Ensure-DreamSkinManagedDirectory -Path $requestsRoot -Root $paths.Root
  $fullPath = [System.IO.Path]::GetFullPath($RequestPath)
  if (-not (Test-DreamSkinThemePathWithin -Path $fullPath -Root $requestsRoot) -or
    -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw '批量导入请求必须位于受管 requests 目录。' }
  try { $request = (Read-DreamSkinUtf8File -Path $fullPath) | ConvertFrom-Json -ErrorAction Stop } catch {
    throw '批量导入请求不是有效 JSON。'
  }
  if ($null -eq $request -or $request -is [string] -or $request -is [array] -or "$($request.schemaVersion)" -ne '1') {
    throw '批量导入请求 schemaVersion 必须为 1。'
  }
  $items = @($request.items)
  if ($items.Count -lt 1 -or $items.Count -gt 50) { throw '批量导入一次只能包含 1 到 50 项。' }
  return [pscustomobject]@{ Path = $fullPath; Items = $items }
}

function ConvertTo-ManagerBatchTheme {
  param([Parameter(Mandatory = $true)][object]$Item)
  $itemName = "$($Item.name)".Trim()
  if (-not $itemName -or $itemName.Length -gt 80 -or $itemName -match '[\u0000-\u001f]') { throw '主题名称必须包含 1 到 80 个可见字符。' }
  $appearanceValue = if ($Item.appearance) { "$($Item.appearance)" } else { 'auto' }
  $safeAreaValue = if ($Item.safeArea) { "$($Item.safeArea)" } else { 'auto' }
  $taskModeValue = if ($Item.taskMode) { "$($Item.taskMode)" } else { 'auto' }
  $categoryValue = if ($Item.category) { "$($Item.category)" } else { 'custom' }
  $tagsValue = @($Item.tags | ForEach-Object { "$_".Trim() })
  if ($appearanceValue -notin @('auto','light','dark') -or $safeAreaValue -notin @('auto','left','right','center','none') -or
    $taskModeValue -notin @('auto','ambient','banner','full','off')) { throw '主题外观参数无效。' }
  if ($categoryValue -notin @('dream','nature','cyber','minimal','dark','warm','custom','uncategorized')) { throw '主题分类无效。' }
  if ($tagsValue.Count -gt 8 -or @($tagsValue | Where-Object { -not $_ -or $_.Length -gt 20 }).Count -gt 0) { throw '主题标签无效。' }
  $focusXValue = if ($null -ne $Item.focusX) { [double]$Item.focusX } else { 0.5 }
  $focusYValue = if ($null -ne $Item.focusY) { [double]$Item.focusY } else { 0.5 }
  $positionXValue = if ($null -ne $Item.positionX) { [double]$Item.positionX } else { 0.0 }
  $positionYValue = if ($null -ne $Item.positionY) { [double]$Item.positionY } else { 0.0 }
  $zoomValue = if ($null -ne $Item.zoom) { [double]$Item.zoom } else { 1.0 }
  $positionModeValue = if ($Item.positionMode) { "$($Item.positionMode)" } else { 'locked' }
  $itemProperties = @($Item.PSObject.Properties.Name)
  $hasFramingFields = $itemProperties -contains 'positionX' -or $itemProperties -contains 'positionY' -or
    $itemProperties -contains 'zoom' -or $itemProperties -contains 'positionMode'
  $framingEnabledValue = if ($itemProperties -contains 'framingEnabled') {
    [bool]$Item.framingEnabled
  } else { $hasFramingFields }
  if ([double]::IsNaN($focusXValue) -or [double]::IsInfinity($focusXValue) -or [double]::IsNaN($focusYValue) -or
    [double]::IsInfinity($focusYValue) -or $focusXValue -lt 0 -or $focusXValue -gt 1 -or
    $focusYValue -lt 0 -or $focusYValue -gt 1) { throw '主题焦点必须是 0 到 1 之间的有限数字。' }
  if ([double]::IsNaN($positionXValue) -or [double]::IsInfinity($positionXValue) -or
    [double]::IsNaN($positionYValue) -or [double]::IsInfinity($positionYValue) -or
    [double]::IsNaN($zoomValue) -or [double]::IsInfinity($zoomValue) -or
    $positionXValue -lt -1 -or $positionXValue -gt 1 -or $positionYValue -lt -1 -or
    $positionYValue -gt 1 -or $zoomValue -lt 1 -or $zoomValue -gt 2) {
    throw '图片位置必须是 -1 到 1、缩放必须是 1 到 2 之间的有限数字。'
  }
  if ($positionModeValue -notin @('locked','free')) { throw '图片移动模式无效。' }
  $accentValue = "$($Item.accent)"
  if ($accentValue -and $accentValue -notmatch '^#[0-9A-Fa-f]{6}$') { throw '强调色必须是 #RRGGBB。' }
  $theme = [pscustomobject][ordered]@{
    schemaVersion = 1; id = 'custom'; name = $itemName; image = ''; category = $categoryValue
    tags = @($tagsValue); appearance = $appearanceValue
    art = [pscustomobject][ordered]@{
      focusX = $focusXValue; focusY = $focusYValue
      safeArea = $safeAreaValue; taskMode = $taskModeValue
    }
    palette = [pscustomobject]@{}
  }
  if ($framingEnabledValue) {
    $theme.art | Add-Member -NotePropertyName positionX -NotePropertyValue $positionXValue
    $theme.art | Add-Member -NotePropertyName positionY -NotePropertyValue $positionYValue
    $theme.art | Add-Member -NotePropertyName zoom -NotePropertyValue $zoomValue
    $theme.art | Add-Member -NotePropertyName positionMode -NotePropertyValue $positionModeValue
  }
  if ($accentValue) { $theme.palette | Add-Member -NotePropertyName accent -NotePropertyValue $accentValue.ToUpperInvariant() }
  return $theme
}

function Remove-ManagerDuplicateImageArchives {
  if (-not (Test-Path -LiteralPath $paths.Images -PathType Container)) { return }
  $seen = @{}
  $candidates = @(Get-ChildItem -LiteralPath $paths.Images -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^art-' } | Sort-Object LastWriteTimeUtc -Descending)
  foreach ($file in $candidates) {
    try {
      Assert-DreamSkinNoReparseComponents -Path $file.FullName
      $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
      if ($seen.ContainsKey($hash)) {
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction Stop
      } else {
        $seen[$hash] = $file.FullName
      }
    } catch {
      # Archive cleanup is best effort and must never invalidate a completed theme write.
    }
  }
}

function Get-ManagerInjectorStatus {
  param([AllowNull()][object]$State)
  if ($null -eq $State) {
    return [pscustomobject]@{ Kind = 'stopped'; Message = '未检测到皮肤注入器。'; Running = $false }
  }
  if (-not $State.injectorPid) {
    return [pscustomobject]@{ Kind = 'stale'; Message = '状态文件缺少注入器进程编号。'; Running = $false }
  }

  $processId = [int]$State.injectorPid
  $visibleProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $visibleProcess) {
    return [pscustomobject]@{ Kind = 'stale'; Message = "记录的注入器进程已不存在（PID $processId）。"; Running = $false }
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  if (-not $process) {
    return [pscustomobject]@{ Kind = 'uninspectable'; Message = "进程存在，但系统不允许核验其命令行（PID $processId）。"; Running = $false }
  }

  $expectedInjector = if ($State.injectorPath) {
    "$($State.injectorPath)"
  } elseif ($State.skillRoot) {
    Join-Path "$($State.skillRoot)" 'scripts\injector.mjs'
  } else { $null }
  $processPath = Get-DreamSkinProcessExecutablePath -ProcessInfo $process
  $commandLine = "$($process.CommandLine)"
  if (-not $processPath -or -not $commandLine) {
    return [pscustomobject]@{ Kind = 'uninspectable'; Message = "无法核验注入器进程身份（PID $processId）。"; Running = $false }
  }

  $matches = [System.IO.Path]::GetFileName("$processPath") -ieq 'node.exe'
  if ($State.nodePath) {
    $matches = $matches -and (Test-DreamSkinPathEqual -Left $processPath -Right "$($State.nodePath)")
  }
  $matches = $matches -and [bool]($expectedInjector -and
    (Test-DreamSkinCommandLineToken -CommandLine $commandLine -Token $expectedInjector) -and
    (Test-DreamSkinCommandLineToken -CommandLine $commandLine -Token '--watch'))
  if ($State.port) {
    $portPattern = '(?i)(?:^|\s)--port(?:=|\s+)' + [regex]::Escape("$($State.port)") + '(?=$|\s)'
    $matches = $matches -and [regex]::IsMatch($commandLine, $portPattern)
  } else { $matches = $false }
  if ($State.browserId) {
    $browserPattern = '(?:^|\s)(?i:--browser-id)(?:=|\s+)' + [regex]::Escape("$($State.browserId)") + '(?=$|\s)'
    $matches = $matches -and [regex]::IsMatch($commandLine, $browserPattern)
  }
  $startedAt = Get-DreamSkinProcessStartedAt -ProcessId $processId
  if ($State.injectorStartedAt) {
    $matches = $matches -and
      (Test-DreamSkinTimestampEqual -Left $startedAt -Right $State.injectorStartedAt)
  }
  if (-not $matches) {
    return [pscustomobject]@{ Kind = 'mismatch'; Message = "PID $processId 存在，但不是记录的 Dream Skin 注入器。"; Running = $false }
  }
  if (-not (Test-DreamSkinRuntimeCurrent -SkillRoot $SkillRoot -RecordedInjectorPath $expectedInjector `
      -RecordedFingerprint "$($State.runtimeFingerprint)")) {
    return [pscustomobject]@{
      Kind = 'stale'
      Message = '皮肤运行时已更新，需要重新应用后才能使用新功能。'
      Running = $false
    }
  }
  return [pscustomobject]@{ Kind = 'running'; Message = "皮肤注入器正在运行（PID $processId）。"; Running = $true }
}

function Get-ManagerImageMetadata {
  param([Parameter(Mandatory = $true)][string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  try { Assert-DreamSkinImageFile -Path $fullPath } catch { throw "图片验证失败：$($_.Exception.Message)" }
  $node = Get-DreamSkinNodeRuntime
  $metadataScript = Join-Path $scripts 'image-metadata.mjs'
  $output = @(& $node.Path $metadataScript '--check' $fullPath 2>&1)
  if ($LASTEXITCODE -ne 0) { throw '图片验证失败：图片已损坏，或超过 16384 像素 / 5000 万像素限制。' }
  try { $metadata = ($output -join "`n") | ConvertFrom-Json -ErrorAction Stop } catch {
    throw '图片验证失败：元数据工具返回了无效结果。'
  }
  $format = [System.IO.Path]::GetExtension($fullPath).TrimStart('.').ToLowerInvariant()
  $canPreview = $format -ne 'webp'
  return [ordered]@{
    path = $fullPath
    format = $format
    width = [int]$metadata.width
    height = [int]$metadata.height
    bytes = [long](Get-Item -LiteralPath $fullPath).Length
    canPreview = $canPreview
    previewMessage = if ($canPreview) { '' } else { 'WebP 可以保存并应用，但当前 WPF 预览器可能无法显示。' }
  }
}

function Assert-ManagerDeleteTreeSafe {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($ThemeDirectory)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw '主题目录包含不安全的重解析点，拒绝删除。'
    }
    if (-not $item.PSIsContainer) { continue }
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
      if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '主题目录包含不安全的重解析点，拒绝删除。'
      }
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
}

function Remove-ManagerTreeSafe {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  $pending = New-Object 'System.Collections.Generic.Stack[object]'
  $pending.Push([pscustomobject]@{ Path = $ThemeDirectory; Expanded = $false })
  while ($pending.Count -gt 0) {
    $node = $pending.Pop()
    $item = Get-Item -LiteralPath $node.Path -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw '主题目录在删除过程中出现不安全的重解析点，已停止删除。'
    }
    if ($item.PSIsContainer -and -not $node.Expanded) {
      $pending.Push([pscustomobject]@{ Path = $item.FullName; Expanded = $true })
      foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)) {
        if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw '主题目录在删除过程中出现不安全的重解析点，已停止删除。'
        }
        $pending.Push([pscustomobject]@{ Path = $child.FullName; Expanded = $false })
      }
      continue
    }
    Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
  }
}

function Write-ManagerDeleteMarker {
  param(
    [Parameter(Mandatory = $true)][string]$ThemeDirectory,
    [Parameter(Mandatory = $true)][string]$ThemeId,
    [Parameter(Mandatory = $true)][string]$QuarantineName
  )
  $markerPath = Join-Path $ThemeDirectory $ManagerDeleteMarkerName
  Assert-DreamSkinNoReparseComponents -Path $markerPath
  $marker = [ordered]@{
    schemaVersion = 1
    themeId = $ThemeId
    quarantineName = $QuarantineName
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  Write-DreamSkinUtf8FileAtomically -Path $markerPath -Content (($marker | ConvertTo-Json -Depth 3) + [Environment]::NewLine)
  return $markerPath
}

function Assert-ManagerDeleteQuarantine {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  $directory = Get-Item -LiteralPath $ThemeDirectory -Force -ErrorAction Stop
  if (-not $directory.PSIsContainer -or $directory.Name -notmatch '^\.manager-delete-[0-9a-f]{32}$') {
    throw '删除隔离目录名称无效。'
  }
  $parent = [System.IO.Directory]::GetParent($directory.FullName)
  if ($null -eq $parent -or -not [string]::Equals(
      $parent.FullName.TrimEnd('\'), [System.IO.Path]::GetFullPath($paths.Root).TrimEnd('\'),
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '删除隔离目录不在受管状态根目录中。'
  }
  $markerPath = Join-Path $directory.FullName $ManagerDeleteMarkerName
  Assert-DreamSkinNoReparseComponents -Path $markerPath
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw '删除隔离目录缺少来源标记。' }
  try {
    $marker = (Read-DreamSkinUtf8File -Path $markerPath) | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw '删除隔离目录来源标记无效。'
  }
  if ($marker.schemaVersion -ne 1 -or -not $marker.themeId -or
      -not [string]::Equals("$($marker.quarantineName)", $directory.Name,
        [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '删除隔离目录来源标记无效。'
  }
  if (Test-Path -LiteralPath (Join-Path $directory.FullName 'theme.json') -PathType Leaf) {
    $theme = Read-DreamSkinTheme -ThemeDirectory $directory.FullName -SkipImageMetadata
    if (-not [string]::Equals("$($theme.Theme.id)", "$($marker.themeId)",
        [System.StringComparison]::OrdinalIgnoreCase)) {
      throw '删除隔离目录的主题与来源标记不匹配。'
    }
  }
}

function Remove-ManagerDeleteQuarantineSafe {
  param([Parameter(Mandatory = $true)][string]$ThemeDirectory)
  Assert-ManagerDeleteQuarantine -ThemeDirectory $ThemeDirectory
  Assert-ManagerDeleteTreeSafe -ThemeDirectory $ThemeDirectory
  foreach ($child in @(Get-ChildItem -LiteralPath $ThemeDirectory -Force -ErrorAction Stop |
      Where-Object { $_.Name -ne $ManagerDeleteMarkerName })) {
    Remove-ManagerTreeSafe -ThemeDirectory $child.FullName
  }
  $markerPath = Join-Path $ThemeDirectory $ManagerDeleteMarkerName
  $markerContent = Read-DreamSkinUtf8File -Path $markerPath
  try {
    Remove-Item -LiteralPath $markerPath -Force -ErrorAction Stop
    if ($env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE -eq '1') {
      throw 'simulated final quarantine directory removal failure'
    }
    Remove-Item -LiteralPath $ThemeDirectory -Force -ErrorAction Stop
  } catch {
    # Keep provenance available if the final directory removal is denied or
    # temporarily blocked after the marker itself was removed.
    if ((Test-Path -LiteralPath $ThemeDirectory -PathType Container) -and
        -not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
      try {
        Write-DreamSkinUtf8FileAtomically -Path $markerPath -Content $markerContent
      } catch {}
    }
    throw
  }
}

function Remove-ManagerPendingDeleteTrees {
  param([Parameter(Mandatory = $true)][string]$Root)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
  foreach ($pending in @(Get-ChildItem -LiteralPath $Root -Directory -Force -Filter '.manager-delete-*' -ErrorAction SilentlyContinue)) {
    try {
      Assert-DreamSkinNoReparseComponents -Path $pending.FullName
      Remove-ManagerDeleteQuarantineSafe -ThemeDirectory $pending.FullName
    } catch {
      # A locked quarantine is retained for a later manager invocation.
    }
  }
}

if ($Action -notin @('ValidateImage', 'Status')) {
  Invoke-ManagerWriteLock {
    Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot | Out-Null
    Remove-ManagerPendingDeleteTrees -Root $paths.Root
  } | Out-Null
}

switch ($Action) {
  'Status' {
    Invoke-ManagerWriteLock {
    Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot | Out-Null
    Remove-ManagerPendingDeleteTrees -Root $paths.Root
    $active = $null
    try { $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata } catch {}
    $state = Read-DreamSkinState -Path $paths.State
    $identity = Get-ManagerInjectorStatus -State $state
    $paused = Test-DreamSkinPaused -StateRoot $StateRoot
    $statusKind = if ($identity.Running -and $paused) { 'paused' } else { $identity.Kind }
    $themes = @()
    $presetIds = @{}
    $catalogMessage = ''
    $presetRoot = Join-Path $SkillRoot 'presets'
    if (Test-Path -LiteralPath $presetRoot -PathType Container) {
      $catalogThemes = $null
      try { $catalogThemes = Read-ManagerPresetCatalog -PresetRoot $presetRoot } catch { $catalogMessage = $_.Exception.Message }
      if ($null -ne $catalogThemes) {
        foreach ($catalogTheme in @($catalogThemes)) {
          $option = ConvertTo-ManagerPresetOption -Preset $catalogTheme -Order $themes.Count
          $themes += $option
          $presetIds["$($option.id)"] = $true
        }
      } else {
        foreach ($candidate in @(Get-ManagerPresetCandidates -PresetRoot $presetRoot)) {
          if ($presetIds.ContainsKey("$($candidate.id)")) { continue }
          $option = ConvertTo-ManagerPresetOption -Preset $candidate -Order $themes.Count
          $themes += $option
          $presetIds["$($option.id)"] = $true
        }
      }
      foreach ($directoryPreset in @(Get-ManagerDirectoryPresetEntries -PresetRoot $presetRoot)) {
        $directoryPresetId = "$($directoryPreset.id)"
        if ($presetIds.ContainsKey($directoryPresetId)) { continue }
        $option = ConvertTo-ManagerPresetOption -Preset $directoryPreset -Order $themes.Count
        $themes += $option
        $presetIds[$directoryPresetId] = $true
      }
    }
    foreach ($saved in @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)) {
      # Older installations staged official presets under themes/. Keep those
      # files for runtime compatibility, but expose the catalog entry only once
      # and never classify it as a deletable user theme.
      $loaded = Read-DreamSkinTheme -ThemeDirectory $saved.Path -SkipImageMetadata
      if ($presetIds.ContainsKey("$($saved.Id)")) { continue }
      $themes += ConvertTo-ManagerTheme -Id $saved.Id -ThemeName $saved.Name `
        -ThemeImage $loaded.ImagePath -Directory $saved.Path -Preset $false `
        -Category $(if ($loaded.Theme.category) { "$($loaded.Theme.category)" } else { 'custom' }) `
        -Tags @($loaded.Theme.tags | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") }) -Source 'saved' `
        -Order (1000 + $themes.Count) -AddedAt "$($saved.LastWriteTimeUtc)" `
        -ThemeAppearance $(if ($loaded.Theme.appearance) { "$($loaded.Theme.appearance)" } else { 'auto' }) `
        -ThemeFocusX $(if ($null -ne $loaded.Theme.art.focusX) { [double]$loaded.Theme.art.focusX } else { 0.5 }) `
        -ThemeFocusY $(if ($null -ne $loaded.Theme.art.focusY) { [double]$loaded.Theme.art.focusY } else { 0.5 }) `
        -ThemePositionX $(if ($null -ne $loaded.Theme.art.positionX) { [double]$loaded.Theme.art.positionX } else { 0.0 }) `
        -ThemePositionY $(if ($null -ne $loaded.Theme.art.positionY) { [double]$loaded.Theme.art.positionY } else { 0.0 }) `
        -ThemeZoom $(if ($null -ne $loaded.Theme.art.zoom) { [double]$loaded.Theme.art.zoom } else { 1.0 }) `
        -ThemePositionMode $(if ($loaded.Theme.art.positionMode) { "$($loaded.Theme.art.positionMode)" } else { 'locked' }) `
        -ThemeFramingEnabled $(Test-ManagerThemeFraming -Theme $loaded.Theme) `
        -ThemeSafeArea $(if ($loaded.Theme.art.safeArea) { "$($loaded.Theme.art.safeArea)" } else { 'auto' }) `
        -ThemeTaskMode $(if ($loaded.Theme.art.taskMode) { "$($loaded.Theme.art.taskMode)" } else { 'auto' }) `
        -ThemeAccent $(if ($loaded.Theme.palette.accent) { "$($loaded.Theme.palette.accent)" } else { '' })
    }
    $nodeVersion = ''
    try { $nodeVersion = "$(& (Get-DreamSkinNodeRuntime).Path --version 2>$null)".Trim() } catch {}
    $codexVersion = ''
    try {
      if ($state -and $state.codexExe -and (Test-Path -LiteralPath "$($state.codexExe)" -PathType Leaf)) {
        $codexVersion = (Get-Item -LiteralPath "$($state.codexExe)").VersionInfo.ProductVersion
      }
    } catch {}
    $stateSchema = 0
    if ($state -and $state.schemaVersion) { [void][int]::TryParse("$($state.schemaVersion)", [ref]$stateSchema) }
    [ordered]@{
      isRunning = [bool]$identity.Running
      isPaused = [bool]$paused
      statusKind = $statusKind
      statusMessage = $identity.Message
      activeThemeId = if ($active -and $active.Theme.id) { "$($active.Theme.id)" } else { '' }
      activeTheme = if ($active -and $active.Theme.name) { "$($active.Theme.name)" } else { '' }
      activeImage = if ($active) { "$($active.ImagePath)" } else { '' }
      activeFocusX = if ($active -and $null -ne $active.Theme.art.focusX) { [double]$active.Theme.art.focusX } else { 0.5 }
      activeFocusY = if ($active -and $null -ne $active.Theme.art.focusY) { [double]$active.Theme.art.focusY } else { 0.5 }
      activePositionX = if ($active -and $null -ne $active.Theme.art.positionX) { [double]$active.Theme.art.positionX } else { 0.0 }
      activePositionY = if ($active -and $null -ne $active.Theme.art.positionY) { [double]$active.Theme.art.positionY } else { 0.0 }
      activeZoom = if ($active -and $null -ne $active.Theme.art.zoom) { [double]$active.Theme.art.zoom } else { 1.0 }
      activePositionMode = if ($active -and $active.Theme.art.positionMode) { "$($active.Theme.art.positionMode)" } else { 'locked' }
      activeFramingEnabled = if ($active) { Test-ManagerThemeFraming -Theme $active.Theme } else { $false }
      managerApiVersion = '1.5'
      themeSchemaVersion = 1
      stateSchemaVersion = $stateSchema
      injectorVersion = '1'
      nodeVersion = $nodeVersion
      codexVersion = $codexVersion
      supportedActions = @('Status','ApplyTheme','DeleteTheme','ImportTheme','ImportBatch','Pause','Resume','ResetTheme','ValidateImage')
      catalogMessage = $catalogMessage
      themes = @($themes)
    } | ConvertTo-Json -Depth 8
    }
  }
  'ValidateImage' {
    if (-not $ImagePath) { throw '请选择需要验证的图片。' }
    Get-ManagerImageMetadata -Path $ImagePath | ConvertTo-Json -Depth 4
  }
  'ApplyTheme' {
    Invoke-ManagerWriteLock {
      if ($ThemeDirectory) {
        $result = Use-DreamSkinSavedTheme -ThemeDirectory $ThemeDirectory -StateRoot $StateRoot
      } elseif ($ImagePath) {
        $presetRoot = Join-Path $SkillRoot 'presets'
        $preset = if (Test-Path -LiteralPath $presetRoot -PathType Container) {
          Get-ManagerPresetByImagePath -PresetRoot $presetRoot -ImagePath $ImagePath
        } else { $null }
        if ($preset) {
          $presetTheme = ConvertTo-ManagerPresetThemeContract -Preset $preset
          $presetName = if ($preset.name) { "$($preset.name)" } else { $Name }
          $result = Set-DreamSkinActiveTheme -ImagePath $ImagePath -Theme $presetTheme `
            -Name $presetName -StateRoot $StateRoot
        } else {
          $result = Set-DreamSkinActiveTheme -ImagePath $ImagePath `
            -Theme (New-ManagerCustomTheme -ThemeName $Name) -Name $Name -StateRoot $StateRoot
        }
      } else { throw 'ApplyTheme requires ThemeDirectory or ImagePath.' }
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Remove-ManagerDuplicateImageArchives
      [ordered]@{
        id = if ($result.Theme.id) { "$($result.Theme.id)" } else { '' }
        name = "$($result.Theme.name)"
        imagePath = "$($result.ImagePath)"
        category = if ($result.Theme.category) { "$($result.Theme.category)" } else { '' }
        tags = @($result.Theme.tags)
      } | ConvertTo-Json -Depth 8
    }
  }
  'DeleteTheme' {
    Invoke-ManagerWriteLock {
      if ([string]::IsNullOrWhiteSpace($ThemeDirectory)) { throw '请选择需要删除的主题。' }
      $target = [System.IO.Path]::GetFullPath($ThemeDirectory).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
      if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw '需要删除的主题目录不存在。' }
      $savedRoot = [System.IO.Path]::GetFullPath($paths.Saved).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
      $parent = [System.IO.Directory]::GetParent($target)
      if ($null -eq $parent -or -not [string]::Equals(
          $parent.FullName.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar),
          $savedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '只能删除“我的”主题库中的直接子目录。'
      }
      Assert-DreamSkinNoReparseComponents -Path $target
      $loaded = Read-DreamSkinTheme -ThemeDirectory $target -SkipImageMetadata
      $active = $null
      if (Test-Path -LiteralPath $paths.Active -PathType Container) {
        $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata
      }
      if ($active -and $active.Theme.id -and [string]::Equals(
          "$($active.Theme.id)", "$($loaded.Theme.id)", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '当前正在使用该主题，请先应用其他主题后再删除。'
      }
      Assert-ManagerDeleteTreeSafe -ThemeDirectory $target
      $quarantine = Join-Path $paths.Root ('.manager-delete-' + [guid]::NewGuid().ToString('N'))
      Assert-DreamSkinNoReparseComponents -Path $quarantine
      $markerPath = Write-ManagerDeleteMarker -ThemeDirectory $target -ThemeId "$($loaded.Theme.id)" `
        -QuarantineName ([System.IO.Path]::GetFileName($quarantine))
      try {
        [System.IO.Directory]::Move($target, $quarantine)
      } catch {
        Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
        throw
      }
      $cleanupPending = $false
      try {
        Assert-DreamSkinNoReparseComponents -Path $quarantine
        Assert-ManagerDeleteQuarantine -ThemeDirectory $quarantine
        $quarantined = Read-DreamSkinTheme -ThemeDirectory $quarantine -SkipImageMetadata
        if (-not [string]::Equals("$($quarantined.Theme.id)", "$($loaded.Theme.id)",
            [System.StringComparison]::OrdinalIgnoreCase)) {
          throw '主题在删除过程中发生变化。'
        }
        Remove-ManagerDeleteQuarantineSafe -ThemeDirectory $quarantine
      } catch {
        $cleanupPending = $true
      }
      [ordered]@{ id = "$($loaded.Theme.id)"; name = "$($loaded.Theme.name)"; deleted = $true; cleanupPending = $cleanupPending } |
        ConvertTo-Json -Depth 4
    }
  }
  'ImportTheme' {
    Invoke-ManagerWriteLock {
      if (-not $ImagePath) { throw '请选择背景图片。' }
      if (-not $Name -or -not $Name.Trim()) { throw '请输入主题名称。' }
      $theme = New-ManagerCustomTheme -ThemeName $Name.Trim()
      $saved = Save-ManagerThemeDirectly -SourceImage $ImagePath -ThemeName $Name.Trim() -Theme $theme
      if (-not $KeepCurrent) {
        $null = Use-DreamSkinSavedTheme -ThemeDirectory $saved.Directory -StateRoot $StateRoot
        Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
        Remove-ManagerDuplicateImageArchives
      }
      [ordered]@{ id = "$($saved.Theme.id)"; name = "$($saved.Theme.name)"; themeDirectory = "$($saved.Directory)" } | ConvertTo-Json -Depth 4
    }
  }
  'ImportBatch' {
    $batch = Read-ManagerBatchRequest
    Invoke-ManagerWriteLock {
      $known = Get-ManagerSavedFingerprints
      $results = @()
      $imported = 0
      $skipped = 0
      $failed = 0
      foreach ($item in $batch.Items) {
        $itemName = if ($item.name) { "$($item.name)" } else { '' }
        try {
          $source = [System.IO.Path]::GetFullPath("$($item.imagePath)")
          Assert-DreamSkinImageFile -Path $source
          $batchTheme = ConvertTo-ManagerBatchTheme -Item $item
          $fingerprint = Get-ManagerThemeFingerprint -SourceImage $source -Theme $batchTheme
          if ($known.ContainsKey($fingerprint)) {
            $skipped++
            $results += [ordered]@{ name = $itemName; status = 'skipped'; message = '相同图片和主题参数已存在。'; themeDirectory = "$($known[$fingerprint])" }
            continue
          }
          $batchTheme | Add-Member -NotePropertyName managerFingerprintVersion -NotePropertyValue $ManagerFingerprintVersion -Force
          $batchTheme | Add-Member -NotePropertyName managerFingerprint -NotePropertyValue $fingerprint -Force
          $savedBatchTheme = Save-ManagerThemeDirectly -SourceImage $source -ThemeName $itemName -Theme $batchTheme `
            -SafeCssPath "$($item.safeCssPath)" -LicensePath "$($item.licensePath)"
          $known[$fingerprint] = $savedBatchTheme.Directory
          $imported++
          $results += [ordered]@{ name = $itemName; status = 'imported'; message = ''; themeDirectory = "$($savedBatchTheme.Directory)" }
        } catch {
          $failed++
          $results += [ordered]@{ name = $itemName; status = 'failed'; message = $_.Exception.Message; themeDirectory = '' }
        }
      }
      [ordered]@{ imported = $imported; skipped = $skipped; failed = $failed; results = @($results) } | ConvertTo-Json -Depth 8
    }
  }
  'ResetTheme' {
    Invoke-ManagerWriteLock {
      $presetRoot = Join-Path $SkillRoot 'presets'
      $defaultTheme = @(Get-ManagerPresetCandidates -PresetRoot $presetRoot) | Select-Object -First 1
      if ($null -eq $defaultTheme) { throw '没有可用于重置的内置主题。' }
      $theme = ConvertTo-ManagerPresetThemeContract -Preset $defaultTheme
      $result = Set-DreamSkinActiveTheme -ImagePath "$($defaultTheme.imagePath)" -Theme $theme `
        -Name "$($defaultTheme.name)" -StateRoot $StateRoot
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Remove-ManagerDuplicateImageArchives
      [ordered]@{
        id = if ($result.Theme.id) { "$($result.Theme.id)" } else { '' }
        name = "$($result.Theme.name)"
        imagePath = "$($result.ImagePath)"
        category = if ($result.Theme.category) { "$($result.Theme.category)" } else { '' }
        tags = @($result.Theme.tags)
      } | ConvertTo-Json -Depth 8
    }
  }
  'Pause' {
    Invoke-ManagerWriteLock {
      Set-DreamSkinPaused -Paused $true -StateRoot $StateRoot | Out-Null
      [ordered]@{ isPaused = $true } | ConvertTo-Json
    }
  }
  'Resume' {
    Invoke-ManagerWriteLock {
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      [ordered]@{ isPaused = $false } | ConvertTo-Json
    }
  }
}
