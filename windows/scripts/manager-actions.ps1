[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Status','ApplyTheme','ImportTheme','ImportBatch','Pause','Resume','ResetTheme','ValidateImage')]
  [string]$Action,
  [Parameter(Mandatory = $true)][string]$SkillRoot,
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'),
  [string]$ThemeDirectory,
  [string]$ImagePath,
  [string]$Name,
  [string]$RequestPath,
  [ValidateSet('auto','light','dark')][string]$Appearance = 'auto',
  [ValidateRange(0.0, 1.0)][double]$FocusX = 0.5,
  [ValidateRange(0.0, 1.0)][double]$FocusY = 0.5,
  [ValidateSet('auto','left','right','center','none')][string]$SafeArea = 'auto',
  [ValidateSet('auto','ambient','banner','off')][string]$TaskMode = 'auto',
  [ValidatePattern('^$|^#[0-9A-Fa-f]{6}$')][string]$Accent = '',
  [switch]$KeepCurrent,
  [ValidateRange(1, 30)][int]$LockTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$scripts = Join-Path $SkillRoot 'scripts'
. (Join-Path $scripts 'common-windows.ps1')
. (Join-Path $scripts 'theme-windows.ps1')

$paths = if ($Action -eq 'ValidateImage') {
  Get-DreamSkinThemePaths -StateRoot $StateRoot
} else {
  Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
}

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
    safeArea = $ThemeSafeArea
    taskMode = $ThemeTaskMode
    accent = $ThemeAccent
  }
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
      $taskMode -notin @('auto','ambient','banner','off')) { throw "内置主题参数无效：$id" }
    $accent = "$($entry.accent)"
    if ($accent -and $accent -notmatch '^#[0-9A-Fa-f]{6}$') { throw "内置主题强调色无效：$id" }
    $focusX = if ($null -ne $entry.focusX) { [double]$entry.focusX } else { 0.5 }
    $focusY = if ($null -ne $entry.focusY) { [double]$entry.focusY } else { 0.5 }
    if ([double]::IsNaN($focusX) -or [double]::IsInfinity($focusX) -or [double]::IsNaN($focusY) -or
      [double]::IsInfinity($focusY) -or $focusX -lt 0 -or $focusX -gt 1 -or $focusY -lt 0 -or $focusY -gt 1) {
      throw "内置主题焦点无效：$id"
    }
    $seen[$id] = $true
    $result += [ordered]@{
      id = "preset-$id"; name = $name; imagePath = $imagePath; themeDirectory = ''; isPreset = $true
      category = $category; tags = @($tags); source = 'preset'; order = $index; addedAt = ''
      appearance = $appearance; focusX = $focusX; focusY = $focusY; safeArea = $safeArea
      taskMode = $taskMode; accent = $accent.ToUpperInvariant()
    }
  }
  return @($result)
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
    id = 'custom'
    name = $ThemeName
    image = ''
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
  return $theme
}

function Save-ManagerThemeDirectly {
  param(
    [Parameter(Mandatory = $true)][string]$SourceImage,
    [Parameter(Mandatory = $true)][string]$ThemeName,
    [Parameter(Mandatory = $true)][object]$Theme
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
    appearance = if ($Theme.appearance) { "$($Theme.appearance)" } else { 'auto' }
    focusX = if ($Theme.art -and $null -ne $Theme.art.focusX) { [double]$Theme.art.focusX } else { 0.5 }
    focusY = if ($Theme.art -and $null -ne $Theme.art.focusY) { [double]$Theme.art.focusY } else { 0.5 }
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

function Get-ManagerSavedFingerprints {
  $fingerprints = @{}
  foreach ($saved in @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)) {
    try {
      $loaded = Read-DreamSkinTheme -ThemeDirectory $saved.Path -SkipImageMetadata
      $fingerprint = if ($loaded.Theme.managerFingerprint) {
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
    $taskModeValue -notin @('auto','ambient','banner','off')) { throw '主题外观参数无效。' }
  if ($categoryValue -notin @('dream','nature','cyber','minimal','dark','warm','custom','uncategorized')) { throw '主题分类无效。' }
  if ($tagsValue.Count -gt 8 -or @($tagsValue | Where-Object { -not $_ -or $_.Length -gt 20 }).Count -gt 0) { throw '主题标签无效。' }
  $focusXValue = if ($null -ne $Item.focusX) { [double]$Item.focusX } else { 0.5 }
  $focusYValue = if ($null -ne $Item.focusY) { [double]$Item.focusY } else { 0.5 }
  if ([double]::IsNaN($focusXValue) -or [double]::IsInfinity($focusXValue) -or [double]::IsNaN($focusYValue) -or
    [double]::IsInfinity($focusYValue) -or $focusXValue -lt 0 -or $focusXValue -gt 1 -or
    $focusYValue -lt 0 -or $focusYValue -gt 1) { throw '主题焦点必须是 0 到 1 之间的有限数字。' }
  $accentValue = "$($Item.accent)"
  if ($accentValue -and $accentValue -notmatch '^#[0-9A-Fa-f]{6}$') { throw '强调色必须是 #RRGGBB。' }
  $theme = [pscustomobject][ordered]@{
    schemaVersion = 1; id = 'custom'; name = $itemName; image = ''; category = $categoryValue
    tags = @($tagsValue); appearance = $appearanceValue
    art = [pscustomobject][ordered]@{ focusX = $focusXValue; focusY = $focusYValue; safeArea = $safeAreaValue; taskMode = $taskModeValue }
    palette = [pscustomobject]@{}
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
  if ($State.injectorStartedAt) { $matches = $matches -and $startedAt -eq "$($State.injectorStartedAt)" }
  if (-not $matches) {
    return [pscustomobject]@{ Kind = 'mismatch'; Message = "PID $processId 存在，但不是记录的 Dream Skin 注入器。"; Running = $false }
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

switch ($Action) {
  'Status' {
    $active = $null
    try { $active = Read-DreamSkinTheme -ThemeDirectory $paths.Active -SkipImageMetadata } catch {}
    $state = Read-DreamSkinState -Path $paths.State
    $identity = Get-ManagerInjectorStatus -State $state
    $paused = Test-DreamSkinPaused -StateRoot $StateRoot
    $statusKind = if ($identity.Running -and $paused) { 'paused' } else { $identity.Kind }
    $themes = @()
    $catalogMessage = ''
    $presetRoot = Join-Path $SkillRoot 'presets'
    if (Test-Path -LiteralPath $presetRoot -PathType Container) {
      $catalogThemes = $null
      try { $catalogThemes = Read-ManagerPresetCatalog -PresetRoot $presetRoot } catch { $catalogMessage = $_.Exception.Message }
      if ($null -ne $catalogThemes) {
        $themes += @($catalogThemes)
      } else {
        foreach ($image in Get-ChildItem -LiteralPath $presetRoot -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' }) {
          $id = [System.IO.Path]::GetFileNameWithoutExtension($image.Name)
          $displayName = (Get-Culture).TextInfo.ToTitleCase(($id -replace '-', ' '))
          $themes += ConvertTo-ManagerTheme -Id "preset-$id" -ThemeName $displayName `
            -ThemeImage $image.FullName -Directory '' -Preset $true -Category 'uncategorized' `
            -Tags @() -Source 'preset' -Order $themes.Count
        }
      }
    }
    foreach ($saved in @(Get-DreamSkinSavedThemes -StateRoot $StateRoot -SkipImageMetadata)) {
      $loaded = Read-DreamSkinTheme -ThemeDirectory $saved.Path -SkipImageMetadata
      $themes += ConvertTo-ManagerTheme -Id $saved.Id -ThemeName $saved.Name `
        -ThemeImage $loaded.ImagePath -Directory $saved.Path -Preset $false `
        -Category $(if ($loaded.Theme.category) { "$($loaded.Theme.category)" } else { 'custom' }) `
        -Tags @($loaded.Theme.tags) -Source 'saved' -Order (1000 + $themes.Count) -AddedAt "$($saved.LastWriteTimeUtc)" `
        -ThemeAppearance $(if ($loaded.Theme.appearance) { "$($loaded.Theme.appearance)" } else { 'auto' }) `
        -ThemeFocusX $(if ($null -ne $loaded.Theme.art.focusX) { [double]$loaded.Theme.art.focusX } else { 0.5 }) `
        -ThemeFocusY $(if ($null -ne $loaded.Theme.art.focusY) { [double]$loaded.Theme.art.focusY } else { 0.5 }) `
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
      activeTheme = if ($active -and $active.Theme.name) { "$($active.Theme.name)" } else { '' }
      activeImage = if ($active) { "$($active.ImagePath)" } else { '' }
      managerApiVersion = '1.2'
      themeSchemaVersion = 1
      stateSchemaVersion = $stateSchema
      injectorVersion = '1'
      nodeVersion = $nodeVersion
      codexVersion = $codexVersion
      supportedActions = @('Status','ApplyTheme','ImportTheme','ImportBatch','Pause','Resume','ResetTheme','ValidateImage')
      catalogMessage = $catalogMessage
      themes = @($themes)
    } | ConvertTo-Json -Depth 8
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
        $result = Set-DreamSkinActiveTheme -ImagePath $ImagePath `
          -Theme (New-ManagerCustomTheme -ThemeName $Name) -Name $Name -StateRoot $StateRoot
      } else { throw 'ApplyTheme requires ThemeDirectory or ImagePath.' }
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Remove-ManagerDuplicateImageArchives
      [ordered]@{ name = "$($result.Theme.name)"; imagePath = "$($result.ImagePath)" } | ConvertTo-Json -Depth 4
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
          $batchTheme | Add-Member -NotePropertyName managerFingerprint -NotePropertyValue $fingerprint -Force
          $savedBatchTheme = Save-ManagerThemeDirectly -SourceImage $source -ThemeName $itemName -Theme $batchTheme
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
      $catalogThemes = @(Read-ManagerPresetCatalog -PresetRoot $presetRoot)
      if ($catalogThemes.Count -lt 1) { throw '没有可用于重置的内置主题。' }
      $defaultTheme = $catalogThemes[0]
      $theme = [pscustomobject][ordered]@{
        schemaVersion = 1
        id = "$($defaultTheme.id)"
        name = "$($defaultTheme.name)"
        image = ''
        category = "$($defaultTheme.category)"
        tags = @($defaultTheme.tags)
        appearance = "$($defaultTheme.appearance)"
        art = [pscustomobject][ordered]@{
          focusX = [double]$defaultTheme.focusX
          focusY = [double]$defaultTheme.focusY
          safeArea = "$($defaultTheme.safeArea)"
          taskMode = "$($defaultTheme.taskMode)"
        }
        palette = [pscustomobject]@{}
      }
      if ($defaultTheme.accent) {
        $theme.palette | Add-Member -NotePropertyName accent -NotePropertyValue "$($defaultTheme.accent)"
      }
      $result = Set-DreamSkinActiveTheme -ImagePath "$($defaultTheme.imagePath)" -Theme $theme `
        -Name "$($defaultTheme.name)" -StateRoot $StateRoot
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Remove-ManagerDuplicateImageArchives
      [ordered]@{ name = "$($result.Theme.name)"; imagePath = "$($result.ImagePath)" } | ConvertTo-Json -Depth 4
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
