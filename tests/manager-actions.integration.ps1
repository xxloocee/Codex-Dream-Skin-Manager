[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ManagerScript,
  [Parameter(Mandatory = $true)][string]$SkillRoot
)

$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-manager-integration-' + [guid]::NewGuid().ToString('N'))
$stateRoot = Join-Path $testRoot 'state'
$fixtureSkillRoot = Join-Path $testRoot 'windows'
Copy-Item -LiteralPath $SkillRoot -Destination $fixtureSkillRoot -Recurse
$SkillRoot = $fixtureSkillRoot

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
  $initial = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $catalogTheme = @($initial.themes | Where-Object { $_.id -eq 'preset-catalog-one' })
  $catalogThemeTwo = @($initial.themes | Where-Object { $_.id -eq 'preset-catalog-two' })
  Assert-Equal 1 $catalogTheme.Count 'Status did not load the preset catalog.'
  Assert-Equal 1 $catalogThemeTwo.Count 'Status did not load the second preset catalog entry.'
  Assert-Equal '目录主题一' $catalogTheme[0].name 'Catalog display name was not returned.'
  Assert-Equal 'dream' $catalogTheme[0].category 'Catalog category was not returned.'
  Assert-True (@($catalogTheme[0].tags) -contains '柔光') 'Catalog tags were not returned.'
  Assert-Equal 'preset' $catalogTheme[0].source 'Catalog source was not returned.'
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
  Assert-Equal 'left' $appliedPreset.art.safeArea 'Preset safe area was not applied.'
  Assert-Equal 'ambient' $appliedPreset.art.taskMode 'Preset task mode was not applied.'
  Assert-Equal '#7788CC' $appliedPreset.palette.accent 'Preset accent was not applied.'
  Write-Host 'PASS: preset visual parameters are applied to the active theme'
  $null = Invoke-Manager -Arguments (@(
      '-Action', 'ApplyTheme', '-ImagePath', $catalogThemeTwo[0].imagePath,
      '-Name', $catalogThemeTwo[0].name, '-Appearance', $catalogThemeTwo[0].appearance,
      '-FocusX', "$($catalogThemeTwo[0].focusX)", '-FocusY', "$($catalogThemeTwo[0].focusY)",
      '-SafeArea', $catalogThemeTwo[0].safeArea, '-TaskMode', $catalogThemeTwo[0].taskMode
    ) + $common)
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
  Assert-Equal 'right' $theme.art.safeArea 'Safe area was not saved.'
  Assert-Equal 'banner' $theme.art.taskMode 'Task mode was not saved.'
  Assert-Equal '#12AB34' $theme.palette.accent 'Accent was not saved.'
  Write-Host 'PASS: save-only preserves active theme and paused state'

  Assert-Equal '1.2' $after.managerApiVersion 'Manager API version is missing.'
  Assert-Equal '1' $after.themeSchemaVersion 'Theme schema version is missing.'
  Assert-True (@($after.supportedActions) -contains 'ValidateImage') 'Supported actions do not include ValidateImage.'
  Assert-True (@($after.supportedActions) -contains 'ResetTheme') 'Supported actions do not include ResetTheme.'
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

  $null = Invoke-Manager -Arguments (@('-Action', 'Pause') + $common)
  $batchBefore = Invoke-Manager -Arguments (@('-Action', 'Status') + $common)
  $batchThemePath = Join-Path $stateRoot 'active-theme\theme.json'
  $batchThemeHash = (Get-FileHash -LiteralPath $batchThemePath -Algorithm SHA256).Hash
  $batchImageHash = (Get-FileHash -LiteralPath $batchBefore.activeImage -Algorithm SHA256).Hash
  $requestRoot = Join-Path $stateRoot 'requests'
  New-Item -ItemType Directory -Force -Path $requestRoot | Out-Null
  $requestPath = Join-Path $requestRoot 'batch-one.json'
  $batchRequest = [ordered]@{ schemaVersion = 1; items = @(
    [ordered]@{ imagePath = $sourceImage.FullName; name = '批量主题一'; category = 'nature'; tags = @('森林','收藏'); appearance = 'auto'; focusX = 0.13; focusY = 0.5; safeArea = 'auto'; taskMode = 'auto'; accent = '' }
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
  $batchStatusTheme = @($batchAfter.themes | Where-Object { $_.name -eq '批量主题一' })
  Assert-Equal 1 $batchStatusTheme.Count 'Imported batch theme was not returned by status.'
  Assert-Equal 'nature' $batchStatusTheme[0].category 'Status did not return the saved category.'
  Assert-True (@($batchStatusTheme[0].tags) -contains '收藏') 'Status did not return the saved tags.'

  $duplicatePath = Join-Path $requestRoot 'batch-duplicate.json'
  $batchRequest.items[0].name = '重复名称不应复制图片'
  [System.IO.File]::WriteAllText($duplicatePath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $duplicateResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $duplicatePath) + $common)
  Assert-Equal 0 $duplicateResult.imported 'An exact visual duplicate was imported again.'
  Assert-Equal 1 $duplicateResult.skipped 'An exact visual duplicate was not reported as skipped.'

  $variantPath = Join-Path $requestRoot 'batch-variant.json'
  $batchRequest.items[0].focusX = 0.14
  [System.IO.File]::WriteAllText($variantPath, (($batchRequest | ConvertTo-Json -Depth 8) + "`r`n"), [System.Text.Encoding]::UTF8)
  $variantResult = Invoke-Manager -Arguments (@('-Action', 'ImportBatch', '-RequestPath', $variantPath) + $common)
  Assert-Equal 1 $variantResult.imported 'The same image with different focus was incorrectly skipped.'

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
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
