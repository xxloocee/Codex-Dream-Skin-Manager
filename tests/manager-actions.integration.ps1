[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManagerScript,
  [Parameter(Mandatory = $true)][string]$SkillRoot
)

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-manager-integration-' + [guid]::NewGuid().ToString('N'))
$stateRoot = Join-Path $testRoot 'state'
$fixtureSkillRoot = Join-Path $testRoot 'windows'
$sourceSkillRoot = [System.IO.Path]::GetFullPath($SkillRoot)
$sourceInjectorPath = Join-Path $sourceSkillRoot 'scripts\injector.mjs'
$sourceInjectorHashBefore = if (Test-Path -LiteralPath $sourceInjectorPath -PathType Leaf) {
  (Get-FileHash -LiteralPath $sourceInjectorPath -Algorithm SHA256).Hash
} else { '' }
Copy-Item -LiteralPath $SkillRoot -Destination $fixtureSkillRoot -Recurse
$fixtureSkillRoot = [System.IO.Path]::GetFullPath($fixtureSkillRoot)
if ([string]::Equals($sourceSkillRoot, $fixtureSkillRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Integration fixture must not alias the supplied SkillRoot.'
}
$SkillRoot = $fixtureSkillRoot
. (Join-Path $SkillRoot 'scripts\runtime-version.ps1')

function Invoke-Manager {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$Arguments)
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ManagerScript @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  $text = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
  return $text | ConvertFrom-Json
}

function Assert-Equal {
  param($Expected, $Actual, [string]$Message)
  if ("$Expected" -cne "$Actual") { throw "$Message Expected '$Expected', got '$Actual'." }
}

function Assert-True {
  param([bool]$Value, [string]$Message)
  if (-not $Value) { throw $Message }
}

try {
  $catalogImages = @(Get-ChildItem -LiteralPath (Join-Path $SkillRoot 'presets') -File |
    Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' } | Select-Object -First 2)
  if ($catalogImages.Count -lt 2) { throw 'At least two preset images are required for the catalog test.' }
  $catalog = [ordered]@{
    schemaVersion = 1
    themes = @(
      [ordered]@{ id = 'catalog-one'; name = '目录主题一'; image = $catalogImages[0].Name; category = 'dream'; tags = @('云层','柔光'); appearance = 'light'; focusX = 0.5; focusY = 0.5; safeArea = 'left'; taskMode = 'ambient'; accent = '#7788CC' },
      [ordered]@{ id = 'catalog-two'; name = '目录主题二'; image = $catalogImages[1].Name; category = 'nature'; tags = @('森林'); appearance = 'auto'; focusX = 0.4; focusY = 0.6; safeArea = 'auto'; taskMode = 'auto'; accent = '' }
    )
  }
  [System.IO.File]::WriteAllText((Join-Path $SkillRoot 'presets\catalog.json'), (($catalog | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $common = @('-SkillRoot', $SkillRoot, '-StateRoot', $stateRoot)
  $concurrentStateRoot = Join-Path $testRoot 'concurrent-state'
  $concurrentOutputA = Join-Path $testRoot 'concurrent-a.json'
  $concurrentOutputB = Join-Path $testRoot 'concurrent-b.json'
  $concurrentErrorA = Join-Path $testRoot 'concurrent-a.err'
  $concurrentErrorB = Join-Path $testRoot 'concurrent-b.err'
  $concurrentArguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $ManagerScript + '" -Action Status -SkillRoot "' + $SkillRoot + '" -StateRoot "' + $concurrentStateRoot + '"'
  $concurrentA = Start-Process -FilePath 'powershell.exe' -ArgumentList $concurrentArguments `
    -RedirectStandardOutput $concurrentOutputA -RedirectStandardError $concurrentErrorA -PassThru -WindowStyle Hidden
  $concurrentB = Start-Process -FilePath 'powershell.exe' -ArgumentList $concurrentArguments `
    -RedirectStandardOutput $concurrentOutputB -RedirectStandardError $concurrentErrorB -PassThru -WindowStyle Hidden
  $concurrentA.WaitForExit()
  $concurrentB.WaitForExit()
  $outputDeadline = (Get-Date).AddSeconds(2)
  while (((Get-Item -LiteralPath $concurrentOutputA).Length -eq 0 -or
      (Get-Item -LiteralPath $concurrentOutputB).Length -eq 0) -and (Get-Date) -lt $outputDeadline) {
    Start-Sleep -Milliseconds 50
  }
  $concurrentOutputLengths = @(
    (Get-Item -LiteralPath $concurrentOutputA).Length,
    (Get-Item -LiteralPath $concurrentOutputB).Length
  )
  Assert-True (@($concurrentOutputLengths | Where-Object { $_ -gt 0 }).Count -ge 1) 'Concurrent first-run Status produced no successful result.'
  if ($concurrentOutputLengths[0] -eq 0) {
    Assert-True ([System.IO.File]::ReadAllText($concurrentErrorA).Contains('already running')) 'Concurrent Status A failed for an unexpected reason.'
  }
  if ($concurrentOutputLengths[1] -eq 0) {
    Assert-True ([System.IO.File]::ReadAllText($concurrentErrorB).Contains('already running')) 'Concurrent Status B failed for an unexpected reason.'
  }
  Assert-True (Test-Path -LiteralPath (Join-Path $concurrentStateRoot 'active-theme\theme.json') -PathType Leaf) 'Concurrent first-run initialization did not create the active theme.'
  Write-Host 'PASS: first-run theme initialization is protected across manager processes'
  $initial = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $catalogTheme = @($initial.themes | Where-Object { $_.id -eq 'preset-catalog-one' })
  $catalogThemeTwo = @($initial.themes | Where-Object { $_.id -eq 'preset-catalog-two' })
  Assert-Equal 1 $catalogTheme.Count 'Status did not load the preset catalog.'
  Assert-Equal 1 $catalogThemeTwo.Count 'Status did not load the second preset catalog entry.'
  Assert-Equal '目录主题一' $catalogTheme[0].name 'Catalog display name was not returned.'
  Assert-Equal 'dream' $catalogTheme[0].category 'Catalog category was not returned.'
  Assert-True (@($catalogTheme[0].tags) -contains '柔光') 'Catalog tags were not returned.'
  Assert-Equal 'preset' $catalogTheme[0].source 'Catalog source was not returned.'
  Assert-Equal 'locked' $catalogTheme[0].positionMode 'Legacy catalog themes did not default to locked movement.'
  Assert-Equal $false $catalogTheme[0].framingEnabled 'Legacy catalog themes unexpectedly enabled custom framing.'
  $presetRows = @($initial.themes | Where-Object { $_.isPreset })
  $duplicatePresetIds = @($presetRows | Group-Object id | Where-Object { $_.Count -gt 1 })
  Assert-Equal 0 $duplicatePresetIds.Count 'Status returned duplicate preset identities.'
  Assert-Equal 0 @($presetRows | Where-Object { $_.themeDirectory }).Count 'Preset rows exposed a deletable saved-theme directory.'
  $gothicRow = @($presetRows | Where-Object { $_.id -eq 'preset-gothic-void-crusade' })
  Assert-Equal 1 $gothicRow.Count 'Directory preset package was not returned by Status.'
  Write-Host 'PASS: preset catalog metadata is returned by status'
  $null = Invoke-Manager -Arguments (@(
      '-Action', 'ApplyTheme', '-ImagePath', $catalogTheme[0].imagePath,
      '-Name', $catalogTheme[0].name, '-Appearance', $catalogTheme[0].appearance,
      '-FocusX', "$($catalogTheme[0].focusX)", '-FocusY', "$($catalogTheme[0].focusY)",
      '-SafeArea', $catalogTheme[0].safeArea, '-TaskMode', $catalogTheme[0].taskMode,
      '-Accent', $catalogTheme[0].accent
    ) + $common)
  $appliedPreset = [System.IO.File]::ReadAllText((Join-Path $stateRoot 'active-theme\theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-Equal 'light' $appliedPreset.appearance 'Preset appearance was not applied.'
  Assert-Equal '0.5' $appliedPreset.art.focusX 'Preset horizontal focus was not applied.'
  Assert-Equal '0.5' $appliedPreset.art.focusY 'Preset vertical focus was not applied.'
  Assert-True (-not (@($appliedPreset.art.PSObject.Properties.Name) -contains 'positionMode')) 'Preset apply did not preserve legacy framing.'
  Assert-Equal 'left' $appliedPreset.art.safeArea 'Preset safe area was not applied.'
  Assert-Equal 'ambient' $appliedPreset.art.taskMode 'Preset task mode was not applied.'
  Assert-Equal '#7788CC' $appliedPreset.palette.accent 'Preset accent was not applied.'
  Assert-Equal 'preset-catalog-one' $appliedPreset.id 'Preset identity was not preserved on apply.'
  Assert-Equal 'dream' $appliedPreset.category 'Preset category was not preserved on apply.'
  Assert-True (@($appliedPreset.tags) -contains '柔光') 'Preset tags were not preserved on apply.'
  Write-Host 'PASS: preset visual parameters are applied to the active theme'
  $null = Invoke-Manager -Arguments (@('-Action', 'ApplyTheme', '-ImagePath', $gothicRow[0].imagePath) + $common)
  $appliedGothic = [System.IO.File]::ReadAllText((Join-Path $stateRoot 'active-theme\theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-Equal 'preset-gothic-void-crusade' $appliedGothic.id 'Directory preset identity was not preserved on apply.'
  Assert-Equal 'Codex Dream Skin' $appliedGothic.promoTitle 'Directory preset metadata was not preserved on apply.'
  Assert-Equal '#c8a55a' $appliedGothic.colors.accent 'Directory preset palette metadata was not preserved on apply.'
  Write-Host 'PASS: packaged preset metadata is applied without staging a saved theme'
  $customTagsImage = Join-Path $testRoot 'custom-tags.jpg'
  Copy-Item -LiteralPath $catalogImages[0].FullName -Destination $customTagsImage -Force
  # Keep the image valid but make its content unique so ApplyTheme does not
  # intentionally resolve it back to the matching built-in preset metadata.
  $customTagsStream = [System.IO.File]::Open($customTagsImage, [System.IO.FileMode]::Append)
  try { $customTagsStream.WriteByte(0) } finally { $customTagsStream.Dispose() }
  $multiTagResult = Invoke-Manager -Arguments (@(
      '-Action', 'ImportTheme', '-ImagePath', $customTagsImage,
      '-Name', '带标签主题', '-Appearance', 'auto',
      '-TagsJson', '[1,2]', '-KeepCurrent'
    ) + $common)
  $multiTagTheme = [System.IO.File]::ReadAllText((Join-Path $multiTagResult.themeDirectory 'theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-True (@($multiTagTheme.tags) -contains '1' -and @($multiTagTheme.tags) -contains '2') 'TagsJson did not bind multiple tags.'
  $singleTagResult = Invoke-Manager -Arguments (@(
      '-Action', 'ImportTheme', '-ImagePath', $customTagsImage,
      # Numeric JSON avoids native PowerShell quote stripping while still
      # exercising the PowerShell 5.1 single-element-array unwrapping bug.
      '-Name', '单标签主题', '-TagsJson', '[1]', '-KeepCurrent'
    ) + $common)
  $singleTaggedTheme = [System.IO.File]::ReadAllText((Join-Path $singleTagResult.themeDirectory 'theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-True (@($singleTaggedTheme.tags).Count -eq 1 -and @($singleTaggedTheme.tags)[0] -eq '1') 'TagsJson did not preserve a single tag under Windows PowerShell.'
  $null = Invoke-Manager -Arguments (@('-Action', 'Pause') + $common)
  $null = Invoke-Manager -Arguments (@('-Action', 'ResetTheme') + $common)
  $resetStatus = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-Equal '目录主题一' $resetStatus.activeTheme 'ResetTheme did not restore the first catalog theme.'
  Assert-Equal $false $resetStatus.isPaused 'ResetTheme did not clear the paused state.'
  Write-Host 'PASS: reset restores the default catalog theme without restoring Codex files'
  $null = Invoke-Manager -Arguments (@('-Action', 'Pause') + $common)
  $before = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $beforeHash = (Get-FileHash -LiteralPath $before.activeImage -Algorithm SHA256).Hash
  $activeThemePath = Join-Path $stateRoot 'active-theme\theme.json'
  $beforeThemeHash = (Get-FileHash -LiteralPath $activeThemePath -Algorithm SHA256).Hash
  $beforeThemeWrite = (Get-Item -LiteralPath $activeThemePath).LastWriteTimeUtc.Ticks
  $beforeImageWrite = (Get-Item -LiteralPath $before.activeImage).LastWriteTimeUtc.Ticks
  $beforeArchiveCount = @(Get-ChildItem -LiteralPath (Join-Path $stateRoot 'images') -File).Count
  $sourceImage = Get-ChildItem -LiteralPath (Join-Path $SkillRoot 'presets') -File |
    Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' } | Select-Object -First 1
  if (-not $sourceImage) { throw 'No preset image is available for the integration test.' }

  $null = Invoke-Manager -Arguments (@(
      '-Action', 'ImportTheme', '-ImagePath', $sourceImage.FullName,
      '-Name', '集成测试主题', '-Appearance', 'dark', '-FocusX', '0.72', '-FocusY', '0.45',
      '-PositionX', '0.35', '-PositionY', '-0.2', '-Zoom', '1.6',
      '-PositionMode', 'free', '-FramingEnabled', 'true',
      '-SafeArea', 'right', '-TaskMode', 'banner', '-Accent', '#12AB34', '-KeepCurrent'
    ) + $common)

  $after = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $afterHash = (Get-FileHash -LiteralPath $after.activeImage -Algorithm SHA256).Hash
  Assert-Equal $before.activeTheme $after.activeTheme 'Save-only changed the active theme name.'
  Assert-Equal $beforeHash $afterHash 'Save-only changed the active theme image.'
  Assert-Equal $beforeThemeHash (Get-FileHash -LiteralPath $activeThemePath -Algorithm SHA256).Hash 'Save-only changed active theme metadata.'
  Assert-Equal $beforeThemeWrite (Get-Item -LiteralPath $activeThemePath).LastWriteTimeUtc.Ticks 'Save-only rewrote active theme metadata.'
  Assert-Equal $beforeImageWrite (Get-Item -LiteralPath $after.activeImage).LastWriteTimeUtc.Ticks 'Save-only rewrote active image.'
  Assert-Equal $beforeArchiveCount @(Get-ChildItem -LiteralPath (Join-Path $stateRoot 'images') -File).Count 'Save-only created an image archive.'
  Assert-Equal $true $after.isPaused 'Save-only changed the paused state.'
  Assert-Equal 0 @(Get-ChildItem -LiteralPath (Join-Path $stateRoot 'themes') -Directory -Filter '.manager-tmp-*').Count 'Save-only left a temporary directory.'

  $saved = @($after.themes | Where-Object { $_.name -eq '集成测试主题' })
  Assert-Equal 1 $saved.Count 'The saved theme was not returned by Status.'
  $themePath = Join-Path $saved[0].themeDirectory 'theme.json'
  $theme = [System.IO.File]::ReadAllText($themePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-Equal 'dark' $theme.appearance 'Appearance was not saved.'
  Assert-Equal '0.72' $theme.art.focusX 'Horizontal focus was not saved.'
  Assert-Equal '0.45' $theme.art.focusY 'Vertical focus was not saved.'
  Assert-Equal '0.35' $theme.art.positionX 'Horizontal image position was not saved.'
  Assert-Equal '-0.2' $theme.art.positionY 'Vertical image position was not saved.'
  Assert-Equal '1.6' $theme.art.zoom 'Image zoom was not saved.'
  Assert-Equal 'free' $theme.art.positionMode 'Image movement mode was not saved.'
  Assert-Equal '0.35' $saved[0].positionX 'Status did not return horizontal image position.'
  Assert-Equal '-0.2' $saved[0].positionY 'Status did not return vertical image position.'
  Assert-Equal '1.6' $saved[0].zoom 'Status did not return image zoom.'
  Assert-Equal 'free' $saved[0].positionMode 'Status did not return image movement mode.'
  Assert-Equal $true $saved[0].framingEnabled 'Status did not mark explicit custom framing.'
  Assert-Equal 'right' $theme.art.safeArea 'Safe area was not saved.'
  Assert-Equal 'banner' $theme.art.taskMode 'Task mode was not saved.'
  Assert-Equal '#12AB34' $theme.palette.accent 'Accent was not saved.'
  Write-Host 'PASS: save-only preserves active theme and paused state'

  Assert-Equal '1.5' $after.managerApiVersion 'Manager API version is missing.'
  Assert-Equal '1' $after.themeSchemaVersion 'Theme schema version is missing.'
  Assert-True (@($after.supportedActions) -contains 'ValidateImage') 'Supported actions do not include ValidateImage.'
  Assert-True (@($after.supportedActions) -contains 'ResetTheme') 'Supported actions do not include ResetTheme.'
  Assert-True (@($after.supportedActions) -contains 'DeleteTheme') 'Supported actions do not include DeleteTheme.'
  Assert-True (-not (@($after.supportedActions) -contains 'EmergencyRestore')) 'Supported actions advertise an unavailable EmergencyRestore action.'
  Assert-True -Value ($after.statusKind -in @('stopped','running','paused','stale','mismatch','uninspectable')) -Message 'Status kind is not structured.'
  Write-Host 'PASS: status exposes versions and capabilities'

  $validated = Invoke-Manager -Arguments (@('-Action', 'ValidateImage', '-ImagePath', $sourceImage.FullName) + $common)
  Assert-True ($validated.width -gt 0 -and $validated.height -gt 0) 'Image dimensions were not returned.'
  Assert-True ($validated.format -in @('png','jpg','jpeg','webp')) 'Image format was not returned.'
  $invalidImage = Join-Path $stateRoot 'broken.png'
  [System.IO.File]::WriteAllText($invalidImage, 'not an image', [System.Text.Encoding]::UTF8)
  $rejectedInvalidImage = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'ValidateImage', '-ImagePath', $invalidImage) + $common) } catch { $rejectedInvalidImage = $true }
  Assert-Equal $true $rejectedInvalidImage 'ValidateImage accepted corrupt image bytes.'

  $oversizedImage = Join-Path $stateRoot 'oversized.jpg'
  $oversizedStream = [System.IO.File]::Open($oversizedImage, [System.IO.FileMode]::CreateNew)
  try { $oversizedStream.SetLength((16 * 1024 * 1024) + 1) } finally { $oversizedStream.Dispose() }
  $rejectedOversizedImage = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'ValidateImage', '-ImagePath', $oversizedImage) + $common) } catch { $rejectedOversizedImage = $true }
  Assert-Equal $true $rejectedOversizedImage 'ValidateImage accepted an image above 16 MB.'

  $webpImage = Join-Path $stateRoot 'preview-check.webp'
  [byte[]]$webpBytes = @(
    0x52,0x49,0x46,0x46,0x16,0x00,0x00,0x00,0x57,0x45,0x42,0x50,
    0x56,0x50,0x38,0x58,0x0A,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x63,0x00,0x00,0x63,0x00,0x00
  )
  [System.IO.File]::WriteAllBytes($webpImage, $webpBytes)
  $webp = Invoke-Manager -Arguments (@('-Action', 'ValidateImage', '-ImagePath', $webpImage) + $common)
  Assert-Equal 'webp' $webp.format 'WebP format was not identified.'
  Assert-Equal $false $webp.canPreview 'WebP preview capability was not reported conservatively.'
  Write-Host 'PASS: image preflight validates real metadata'

  $normalizedRoot = [System.IO.Path]::GetFullPath($stateRoot).TrimEnd('\').ToUpperInvariant()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $lockHash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedRoot)) | ForEach-Object { $_.ToString('x2') }) -join ''
  } finally { $sha.Dispose() }
  $writeMutex = New-Object System.Threading.Mutex($false, ('Local\CodexDreamSkin-Write-' + $lockHash.Substring(0, 24)))
  $ownsMutex = $writeMutex.WaitOne([TimeSpan]::FromSeconds(2))
  try {
    Assert-Equal $true $ownsMutex 'The integration test could not acquire the manager write mutex.'
    $rejectedConcurrentWrite = $false
    try { $null = Invoke-Manager -Arguments (@('-Action', 'Pause', '-LockTimeoutSeconds', '1') + $common) } catch { $rejectedConcurrentWrite = $true }
    Assert-Equal $true $rejectedConcurrentWrite 'A concurrent manager write bypassed the named mutex.'
  } finally {
    if ($ownsMutex) { $writeMutex.ReleaseMutex() }
    $writeMutex.Dispose()
  }
  Write-Host 'PASS: cross-process write mutex rejects concurrent writes'

  $archiveRoot = Join-Path $stateRoot 'images'
  $extension = $sourceImage.Extension.ToLowerInvariant()
  Copy-Item -LiteralPath $sourceImage.FullName -Destination (Join-Path $archiveRoot ('art-duplicate-a' + $extension))
  Copy-Item -LiteralPath $sourceImage.FullName -Destination (Join-Path $archiveRoot ('art-duplicate-b' + $extension))
  $null = Invoke-Manager -Arguments (@('-Action', 'ApplyTheme', '-ThemeDirectory', $saved[0].themeDirectory) + $common)
  $sourceHash = (Get-FileHash -LiteralPath $sourceImage.FullName -Algorithm SHA256).Hash
  $matchingArchives = @(Get-ChildItem -LiteralPath $archiveRoot -File -Filter 'art-*' | Where-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash -eq $sourceHash })
  Assert-Equal 1 $matchingArchives.Count 'Duplicate image archives were not cleaned by content hash.'
  Write-Host 'PASS: duplicate image archives are safely deduplicated'

  $activeSavedStatus = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-Equal $saved[0].id $activeSavedStatus.activeThemeId 'Status did not expose the active theme id.'
  $rejectedActiveDelete = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $saved[0].themeDirectory) + $common) } catch { $rejectedActiveDelete = $true }
  Assert-Equal $true $rejectedActiveDelete 'DeleteTheme removed the active theme.'
  Assert-True (Test-Path -LiteralPath $saved[0].themeDirectory -PathType Container) 'Rejected active theme deletion removed its directory.'

  $activeThemeFile = Join-Path $stateRoot 'active-theme\theme.json'
  $activeThemeJson = [System.IO.File]::ReadAllText($activeThemeFile, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($activeThemeFile, '{bad-active-theme', [System.Text.Encoding]::UTF8)
  $rejectedUnreadableActiveDelete = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $saved[0].themeDirectory) + $common) } catch { $rejectedUnreadableActiveDelete = $true }
  Assert-Equal $true $rejectedUnreadableActiveDelete 'DeleteTheme continued when the active theme could not be verified.'
  Assert-True (Test-Path -LiteralPath $saved[0].themeDirectory -PathType Container) 'Unreadable active theme handling removed the saved theme.'
  [System.IO.File]::WriteAllText($activeThemeFile, $activeThemeJson, [System.Text.Encoding]::UTF8)

  $unmanagedTheme = Join-Path $stateRoot 'unmanaged-delete-test'
  Copy-Item -LiteralPath $saved[0].themeDirectory -Destination $unmanagedTheme -Recurse
  $rejectedUnmanagedDelete = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $unmanagedTheme) + $common) } catch { $rejectedUnmanagedDelete = $true }
  Assert-Equal $true $rejectedUnmanagedDelete 'DeleteTheme accepted a directory outside the managed theme root.'
  Assert-True (Test-Path -LiteralPath $unmanagedTheme -PathType Container) 'Rejected unmanaged deletion removed its directory.'

  $outsideJunctionTarget = Join-Path $testRoot 'outside-junction-target'
  New-Item -ItemType Directory -Path $outsideJunctionTarget | Out-Null
  $sentinel = Join-Path $outsideJunctionTarget 'sentinel.txt'
  [System.IO.File]::WriteAllText($sentinel, 'keep', [System.Text.Encoding]::UTF8)
  $junctionTheme = Join-Path $stateRoot 'themes\junction-delete-test'
  New-Item -ItemType Junction -Path $junctionTheme -Target $outsideJunctionTarget | Out-Null
  $rejectedJunctionDelete = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $junctionTheme) + $common) } catch { $rejectedJunctionDelete = $true }
  Assert-Equal $true $rejectedJunctionDelete 'DeleteTheme accepted a direct-child junction.'
  Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) 'Rejected junction deletion touched the external sentinel.'

  $nestedJunctionTheme = Join-Path $stateRoot 'themes\nested-junction-delete-test'
  Copy-Item -LiteralPath $saved[0].themeDirectory -Destination $nestedJunctionTheme -Recurse
  $nestedThemeFile = Join-Path $nestedJunctionTheme 'theme.json'
  $nestedTheme = [System.IO.File]::ReadAllText($nestedThemeFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $nestedTheme.id = 'nested-junction-delete-test'
  [System.IO.File]::WriteAllText($nestedThemeFile, (($nestedTheme | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $nestedSentinelRoot = Join-Path $testRoot 'nested-junction-target'
  New-Item -ItemType Directory -Path $nestedSentinelRoot | Out-Null
  $nestedSentinel = Join-Path $nestedSentinelRoot 'sentinel.txt'
  [System.IO.File]::WriteAllText($nestedSentinel, 'keep', [System.Text.Encoding]::UTF8)
  $nestedLink = Join-Path $nestedJunctionTheme 'linked-assets'
  $nestedJunctionCreated = $false
  try { New-Item -ItemType Junction -Path $nestedLink -Target $nestedSentinelRoot | Out-Null; $nestedJunctionCreated = $true } catch { Write-Host 'SKIP: nested junction deletion test is unavailable on this Windows host' }
  if ($nestedJunctionCreated) {
    $rejectedNestedJunctionDelete = $false
    try { $null = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $nestedJunctionTheme) + $common) } catch { $rejectedNestedJunctionDelete = $true }
    Assert-Equal $true $rejectedNestedJunctionDelete 'DeleteTheme accepted a nested junction.'
    Assert-True (Test-Path -LiteralPath $nestedJunctionTheme -PathType Container) 'Rejected nested junction deletion removed the theme.'
    Assert-True (Test-Path -LiteralPath $nestedSentinel -PathType Leaf) 'Rejected nested junction deletion touched the external sentinel.'
  }

  $unmarkedQuarantine = Join-Path $stateRoot ('.manager-delete-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $unmarkedQuarantine | Out-Null
  $unmarkedSentinel = Join-Path $unmarkedQuarantine 'sentinel.txt'
  [System.IO.File]::WriteAllText($unmarkedSentinel, 'keep', [System.Text.Encoding]::UTF8)
  $null = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-True (Test-Path -LiteralPath $unmarkedSentinel -PathType Leaf) 'Status deleted an unmarked directory that only matched the quarantine name prefix.'
  Write-Host 'PASS: pending cleanup requires a valid manager quarantine marker'

  $pendingCleanupTheme = Join-Path $stateRoot 'themes\pending-cleanup-delete-test'
  Copy-Item -LiteralPath $saved[0].themeDirectory -Destination $pendingCleanupTheme -Recurse
  $pendingThemeFile = Join-Path $pendingCleanupTheme 'theme.json'
  $pendingTheme = [System.IO.File]::ReadAllText($pendingThemeFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $pendingTheme.id = 'pending-cleanup-delete-test'
  $pendingTheme.name = '待清理删除测试'
  [System.IO.File]::WriteAllText($pendingThemeFile, (($pendingTheme | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $pendingImage = Join-Path $pendingCleanupTheme "$($pendingTheme.image)"
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $denyDelete = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity, [System.Security.AccessControl.FileSystemRights]::Delete,
    [System.Security.AccessControl.AccessControlType]::Deny)
  $denyDeleteChildren = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity, [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,
    [System.Security.AccessControl.AccessControlType]::Deny)
  $pendingDirectoryAcl = Get-Acl -LiteralPath $pendingCleanupTheme
  $pendingDirectoryAcl.AddAccessRule($denyDeleteChildren)
  Set-Acl -LiteralPath $pendingCleanupTheme -AclObject $pendingDirectoryAcl
  $pendingAcl = Get-Acl -LiteralPath $pendingImage
  $pendingAcl.AddAccessRule($denyDelete)
  Set-Acl -LiteralPath $pendingImage -AclObject $pendingAcl
  $pendingQuarantine = $null
  try {
    $pendingResult = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $pendingCleanupTheme) + $common)
    Assert-Equal $true $pendingResult.deleted 'Cleanup failure did not preserve logical deletion success.'
    Assert-Equal $true $pendingResult.cleanupPending 'Cleanup failure was not exposed as pending.'
    Assert-True (-not (Test-Path -LiteralPath $pendingCleanupTheme)) 'Logically deleted theme remained in the saved theme root.'
    $pendingQuarantine = Get-ChildItem -LiteralPath $stateRoot -Directory -Filter '.manager-delete-*' |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.manager-delete.json') -PathType Leaf } |
      Select-Object -First 1
    Assert-True ($null -ne $pendingQuarantine) 'Cleanup failure did not retain a quarantine directory.'
  } finally {
    if ($null -eq $pendingQuarantine) {
      $pendingQuarantine = Get-ChildItem -LiteralPath $stateRoot -Directory -Filter '.manager-delete-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.manager-delete.json') -PathType Leaf } |
        Select-Object -First 1
    }
    if ($null -ne $pendingQuarantine) {
      $cleanupDirectoryAcl = Get-Acl -LiteralPath $pendingQuarantine.FullName
      $cleanupDirectoryAcl.RemoveAccessRuleSpecific($denyDeleteChildren)
      Set-Acl -LiteralPath $pendingQuarantine.FullName -AclObject $cleanupDirectoryAcl
      $quarantinedImage = Join-Path $pendingQuarantine.FullName "$($pendingTheme.image)"
      if (Test-Path -LiteralPath $quarantinedImage -PathType Leaf) {
        $cleanupAcl = Get-Acl -LiteralPath $quarantinedImage
        $cleanupAcl.RemoveAccessRuleSpecific($denyDelete)
        Set-Acl -LiteralPath $quarantinedImage -AclObject $cleanupAcl
      }
      $null = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
      Assert-True (-not (Test-Path -LiteralPath $pendingQuarantine.FullName)) 'A later manager invocation did not retry pending quarantine cleanup.'
    }
  }
  Write-Host 'PASS: pending theme deletion cleanup is retried'

  $finalDeleteTheme = Join-Path $stateRoot 'themes\final-delete-retry-test'
  Copy-Item -LiteralPath $saved[0].themeDirectory -Destination $finalDeleteTheme -Recurse
  $finalDeleteThemeFile = Join-Path $finalDeleteTheme 'theme.json'
  $finalDeleteThemeData = [System.IO.File]::ReadAllText($finalDeleteThemeFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  $finalDeleteThemeData.id = 'final-delete-retry-test'
  [System.IO.File]::WriteAllText($finalDeleteThemeFile, (($finalDeleteThemeData | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $finalQuarantine = $null
  $previousFinalFailure = $env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE
  try {
    $env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE = '1'
    $finalDeleteResult = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $finalDeleteTheme) + $common)
    Assert-Equal $true $finalDeleteResult.cleanupPending 'Final quarantine directory failure was not exposed as pending.'
    $finalQuarantine = Get-ChildItem -LiteralPath $stateRoot -Directory -Filter '.manager-delete-*' |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.manager-delete.json') -PathType Leaf } |
      Select-Object -First 1
    Assert-True ($null -ne $finalQuarantine) 'Final quarantine directory failure lost its retry marker.'
  } finally {
    if ($null -eq $finalQuarantine) {
      $finalQuarantine = Get-ChildItem -LiteralPath $stateRoot -Directory -Filter '.manager-delete-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName '.manager-delete.json') -PathType Leaf } |
        Select-Object -First 1
    }
    if ($null -ne $finalQuarantine) {
      if ($null -eq $previousFinalFailure) {
        Remove-Item Env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE -ErrorAction SilentlyContinue
      } else {
        $env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE = $previousFinalFailure
      }
      $null = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
      Assert-True (-not (Test-Path -LiteralPath $finalQuarantine.FullName)) 'Final quarantine marker was not retried after directory deletion became available.'
    }
    if ($null -eq $previousFinalFailure) {
      Remove-Item Env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE -ErrorAction SilentlyContinue
    } else {
      $env:CODEX_DREAM_SKIN_TEST_FAIL_FINAL_QUARANTINE_REMOVE = $previousFinalFailure
    }
  }
  Write-Host 'PASS: final quarantine removal failure preserves retry provenance'

  $null = Invoke-Manager -Arguments (@('-Action', 'ResetTheme') + $common)
  $deleteResult = Invoke-Manager -Arguments (@('-Action', 'DeleteTheme', '-ThemeDirectory', $saved[0].themeDirectory) + $common)
  Assert-Equal $true $deleteResult.deleted 'DeleteTheme did not report a successful deletion.'
  Assert-Equal $false $deleteResult.cleanupPending 'Normal DeleteTheme unexpectedly left cleanup pending.'
  Assert-Equal $saved[0].id $deleteResult.id 'DeleteTheme returned the wrong theme id.'
  Assert-True (-not (Test-Path -LiteralPath $saved[0].themeDirectory)) 'DeleteTheme left the theme directory behind.'
  $afterDelete = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-Equal 0 @($afterDelete.themes | Where-Object { $_.id -eq $saved[0].id }).Count 'Deleted theme is still returned by Status.'
  Write-Host 'PASS: saved theme deletion enforces active and managed-path boundaries'

  $null = Invoke-Manager -Arguments (@('-Action', 'Pause') + $common)
  $batchBefore = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $batchThemePath = Join-Path $stateRoot 'active-theme\theme.json'
  $batchThemeHash = (Get-FileHash -LiteralPath $batchThemePath -Algorithm SHA256).Hash
  $batchImageHash = (Get-FileHash -LiteralPath $batchBefore.activeImage -Algorithm SHA256).Hash
  $requestRoot = Join-Path $stateRoot 'requests'
  New-Item -ItemType Directory -Force -Path $requestRoot | Out-Null
  $requestPath = Join-Path $requestRoot 'batch-one.json'
  $batchRequest = [ordered]@{ schemaVersion = 1; items = @(
    [ordered]@{ imagePath = $sourceImage.FullName; name = '批量主题一'; category = 'nature'; tags = @('森林','收藏'); appearance = 'auto'; focusX = 0.13; focusY = 0.5; positionX = 0.25; positionY = -0.2; zoom = 1.3; positionMode = 'free'; framingEnabled = $true; safeArea = 'auto'; taskMode = 'auto'; accent = '' }
  ) }
  [System.IO.File]::WriteAllText($requestPath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $batchResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $requestPath) + $common)
  Assert-Equal 1 $batchResult.imported 'Batch import did not save the valid item.'
  Assert-Equal 0 $batchResult.skipped 'Batch import unexpectedly skipped a unique item.'
  $batchAfter = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-Equal $batchThemeHash (Get-FileHash -LiteralPath $batchThemePath -Algorithm SHA256).Hash 'Batch import changed active theme metadata.'
  Assert-Equal $batchImageHash (Get-FileHash -LiteralPath $batchAfter.activeImage -Algorithm SHA256).Hash 'Batch import changed the active image.'
  Assert-Equal $true $batchAfter.isPaused 'Batch import changed the paused state.'
  $savedBatchTheme = [System.IO.File]::ReadAllText((Join-Path $batchResult.results[0].themeDirectory 'theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-Equal 'nature' $savedBatchTheme.category 'Batch import did not preserve the package category.'
  Assert-True (@($savedBatchTheme.tags) -contains '森林') 'Batch import did not preserve package tags.'
  Assert-Equal '0.25' $savedBatchTheme.art.positionX 'Batch import did not preserve horizontal image position.'
  Assert-Equal '-0.2' $savedBatchTheme.art.positionY 'Batch import did not preserve vertical image position.'
  Assert-Equal '1.3' $savedBatchTheme.art.zoom 'Batch import did not preserve image zoom.'
  Assert-Equal 'free' $savedBatchTheme.art.positionMode 'Batch import did not preserve image movement mode.'
  Assert-Equal '2' $savedBatchTheme.managerFingerprintVersion 'Batch import did not version its visual fingerprint.'
  $batchStatusTheme = @($batchAfter.themes | Where-Object { $_.name -eq '批量主题一' })
  Assert-Equal 1 $batchStatusTheme.Count 'Imported batch theme was not returned by status.'
  Assert-Equal 'nature' $batchStatusTheme[0].category 'Status did not return the saved category.'
  Assert-True (@($batchStatusTheme[0].tags) -contains '收藏') 'Status did not return the saved tags.'
  Assert-Equal 'free' $batchStatusTheme[0].positionMode 'Status did not return the batch movement mode.'
  Assert-Equal $true $batchStatusTheme[0].framingEnabled 'Status did not mark batch custom framing.'

  $savedBatchTheme.managerFingerprintVersion = 1
  $savedBatchTheme.managerFingerprint = 'legacy-fingerprint'
  [System.IO.File]::WriteAllText((Join-Path $batchResult.results[0].themeDirectory 'theme.json'),
    (($savedBatchTheme | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)

  $duplicatePath = Join-Path $requestRoot 'batch-duplicate.json'
  $batchRequest.items[0].name = '重复名称不应复制图片'
  [System.IO.File]::WriteAllText($duplicatePath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $duplicateResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $duplicatePath) + $common)
  Assert-Equal 0 $duplicateResult.imported 'An exact visual duplicate was imported again.'
  Assert-Equal 1 $duplicateResult.skipped 'An exact visual duplicate was not reported as skipped.'

  $variantPath = Join-Path $requestRoot 'batch-variant.json'
  $batchRequest.items[0].positionX = 0.26
  [System.IO.File]::WriteAllText($variantPath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $variantResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $variantPath) + $common)
  Assert-Equal 1 $variantResult.imported 'The same image with different framing was incorrectly skipped.'

  $modeVariantPath = Join-Path $requestRoot 'batch-mode-variant.json'
  $batchRequest.items[0].positionX = 0.25
  $batchRequest.items[0].positionMode = 'locked'
  [System.IO.File]::WriteAllText($modeVariantPath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $modeVariantResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $modeVariantPath) + $common)
  Assert-Equal 1 $modeVariantResult.imported 'The same image with a different movement mode was incorrectly skipped.'

  $legacyVariantPath = Join-Path $requestRoot 'batch-legacy-variant.json'
  $batchRequest.items[0].name = '旧主题构图保真'
  $batchRequest.items[0].positionX = 0.0
  $batchRequest.items[0].positionY = 0.0
  $batchRequest.items[0].zoom = 1.0
  $batchRequest.items[0].positionMode = 'locked'
  $batchRequest.items[0].framingEnabled = $false
  [System.IO.File]::WriteAllText($legacyVariantPath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $legacyVariantResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $legacyVariantPath) + $common)
  Assert-Equal 1 $legacyVariantResult.imported 'Legacy framing was incorrectly deduplicated with explicit framing.'
  $legacyTheme = [System.IO.File]::ReadAllText((Join-Path $legacyVariantResult.results[0].themeDirectory 'theme.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert-True (-not (@($legacyTheme.art.PSObject.Properties.Name) -contains 'positionMode')) 'Legacy batch import wrote explicit framing fields.'
  $legacyStatus = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $legacyStatusTheme = @($legacyStatus.themes | Where-Object { $_.name -eq '旧主题构图保真' })
  Assert-Equal $false $legacyStatusTheme[0].framingEnabled 'Legacy batch import did not preserve framing compatibility.'

  $tooManyPath = Join-Path $requestRoot 'batch-too-many.json'
  $tooMany = [ordered]@{ schemaVersion = 1; items = @(1..51 | ForEach-Object {
    [ordered]@{ imagePath = $sourceImage.FullName; name = "主题 $_"; appearance = 'auto'; focusX = 0.5; focusY = 0.5; safeArea = 'auto'; taskMode = 'auto'; accent = '' }
  }) }
  [System.IO.File]::WriteAllText($tooManyPath, (($tooMany | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $countBeforeReject = @((Invoke-Manager -Arguments (@('-Action', 'Status') + $common)).themes).Count
  $rejectedTooMany = $false
  try { $null = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $tooManyPath) + $common) } catch { $rejectedTooMany = $true }
  Assert-Equal $true $rejectedTooMany 'Batch import accepted more than 50 items.'
  Assert-Equal $countBeforeReject @((Invoke-Manager -Arguments (@('-Action', 'Status') + $common)).themes).Count 'Rejected batch wrote partial themes.'
  Write-Host 'PASS: batch import is atomic, deduplicated, and limited to 50 items'

  $engineRoot = Join-Path $testRoot 'installed-engine'
  New-Item -ItemType Directory -Force -Path (Join-Path $engineRoot 'scripts'), (Join-Path $engineRoot 'assets') | Out-Null
  $sourceInjector = Join-Path $SkillRoot 'scripts\injector.mjs'
  $engineInjector = Join-Path $engineRoot 'scripts\injector.mjs'
  [System.IO.File]::WriteAllText($sourceInjector, 'setInterval(() => {}, 1000);', [System.Text.UTF8Encoding]::new($false))
  Copy-Item -LiteralPath $sourceInjector -Destination $engineInjector -Force
  foreach ($runtimeAsset in @(
    'assets\renderer-inject.js',
    'assets\dream-skin.css',
    'assets\selectors.json',
    'assets\safe-css-validator.mjs',
    'assets\theme-package-validator.mjs',
    'scripts\image-metadata.mjs'
  )) {
    $sourceRuntimeAsset = Join-Path $SkillRoot $runtimeAsset
    if (Test-Path -LiteralPath $sourceRuntimeAsset -PathType Leaf) {
      $engineRuntimeAsset = Join-Path $engineRoot $runtimeAsset
      $engineRuntimeDirectory = [System.IO.Path]::GetDirectoryName($engineRuntimeAsset)
      New-Item -ItemType Directory -Force -Path $engineRuntimeDirectory | Out-Null
      Copy-Item -LiteralPath $sourceRuntimeAsset -Destination $engineRuntimeAsset -Force
    }
  }
  $engineProcess = $null
  try {
    $engineProcess = Start-Process -FilePath (Get-Command node.exe).Source `
      -ArgumentList @($engineInjector, '--watch', '--port', '9345', '--browser-id', 'test-browser') -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
    $engineProcess.Refresh()
    $engineState = [ordered]@{
      schemaVersion = 3; platform = 'windows'; port = 9345; injectorPid = $engineProcess.Id
      injectorStartedAt = $engineProcess.StartTime.ToUniversalTime().ToString('o')
      injectorPath = $engineInjector; nodePath = $engineProcess.Path
      runtimeFingerprint = (Get-DreamSkinRuntimeFingerprint -SkillRoot $engineRoot)
      codexExe = $engineProcess.Path; codexPackageRoot = $SkillRoot
      codexPackageFullName = 'test'; codexPackageFamilyName = 'test'; browserId = 'test-browser'
    }
    [System.IO.File]::WriteAllText((Join-Path $stateRoot 'state.json'), (($engineState | ConvertTo-Json -Depth 5) + "`r`n"), [System.Text.Encoding]::UTF8)
    $engineStatus = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
    Assert-True ($engineStatus.statusKind -in @('running','paused')) 'An installed engine with the same runtime fingerprint was marked stale.'
    Assert-Equal $true $engineStatus.isRunning 'An installed engine with the same runtime fingerprint was not reported as running.'
    Write-Host 'PASS: installed engine runtime remains current when its path differs'
    [System.IO.File]::WriteAllText((Join-Path $engineRoot 'assets\dream-skin.css'), 'tampered engine runtime', [System.Text.Encoding]::UTF8)
    $tamperedEngineStatus = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
    Assert-Equal 'stale' $tamperedEngineStatus.statusKind 'A modified installed engine was not marked stale.'
    Assert-Equal $false $tamperedEngineStatus.isRunning 'A modified installed engine was reported as running.'
    Write-Host 'PASS: status detects installed engine content changes'
  } finally {
    if ($null -ne $engineProcess) {
      Stop-Process -Id $engineProcess.Id -Force -ErrorAction SilentlyContinue
      $engineProcess.WaitForExit()
    }
  }

  $mismatchState = [ordered]@{
    schemaVersion = 3; platform = 'windows'; port = 9345; injectorPid = $PID
    injectorStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
    injectorPath = (Join-Path $SkillRoot 'scripts\injector.mjs'); nodePath = (Get-Process -Id $PID).Path
    codexExe = (Get-Process -Id $PID).Path; codexPackageRoot = $SkillRoot
    codexPackageFullName = 'test'; codexPackageFamilyName = 'test'; browserId = 'test-browser'
  }
  [System.IO.File]::WriteAllText((Join-Path $stateRoot 'state.json'), (($mismatchState | ConvertTo-Json -Depth 5) + "`r`n"), [System.Text.Encoding]::UTF8)
  $mismatch = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-True -Value ($mismatch.statusKind -in @('mismatch','uninspectable')) -Message 'A reused PID was not rejected by strict identity validation.'
  Assert-Equal $false $mismatch.isRunning 'A mismatched PID was reported as running.'
  Write-Host 'PASS: status rejects mismatched injector identity'

  $mismatchState.injectorPid = 2147483000
  $mismatchState.injectorStartedAt = '2000-01-01T00:00:00.0000000Z'
  [System.IO.File]::WriteAllText((Join-Path $stateRoot 'state.json'), (($mismatchState | ConvertTo-Json -Depth 5) + "`r`n"), [System.Text.Encoding]::UTF8)
  $stale = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-Equal 'stale' $stale.statusKind 'A missing PID was not reported as stale.'
  Assert-Equal $false $stale.isRunning 'A stale PID was reported as running.'
  Write-Host 'PASS: status identifies stale injector state'

  [System.IO.File]::WriteAllText((Join-Path $SkillRoot 'presets\catalog.json'), '{bad-catalog', [System.Text.Encoding]::UTF8)
  $catalogFallback = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  Assert-True (@($catalogFallback.themes | Where-Object { $_.isPreset }).Count -ge 2) 'A corrupt catalog prevented fallback preset scanning.'
  Assert-True (-not [string]::IsNullOrWhiteSpace("$($catalogFallback.catalogMessage)")) 'A corrupt catalog did not return a diagnostic message.'
  Write-Host 'PASS: corrupt preset catalog falls back safely'

  [System.IO.File]::WriteAllText((Join-Path $stateRoot 'state.json'), '{not-json', [System.Text.Encoding]::UTF8)
  $rejectedCorruptState = $false
  try {
    $null = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  } catch {
    $rejectedCorruptState = $true
  }
  Assert-Equal $true $rejectedCorruptState 'Status accepted a corrupt state file.'
  Write-Host 'PASS: status rejects corrupt state files'
  if ($sourceInjectorHashBefore) {
    $sourceInjectorHashAfter = (Get-FileHash -LiteralPath $sourceInjectorPath -Algorithm SHA256).Hash
    Assert-Equal $sourceInjectorHashBefore $sourceInjectorHashAfter 'Integration test modified the supplied SkillRoot injector.'
    Write-Host 'PASS: integration fixture leaves the supplied runtime injector unchanged'
  }
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
