function Get-DreamSkinRuntimeFingerprint {
  param([Parameter(Mandatory = $true)][string]$SkillRoot)
  try {
    $currentInjector = [System.IO.Path]::GetFullPath((Join-Path $SkillRoot 'scripts\injector.mjs'))
    $baseRuntimeFiles = @(
      $currentInjector,
      (Join-Path $SkillRoot 'assets\renderer-inject.js'),
      (Join-Path $SkillRoot 'assets\dream-skin.css')
    )
    $extendedRuntimeFiles = @(
      (Join-Path $SkillRoot 'assets\selectors.json'),
      (Join-Path $SkillRoot 'assets\safe-css-validator.mjs'),
      (Join-Path $SkillRoot 'assets\theme-package-validator.mjs'),
      (Join-Path $SkillRoot 'scripts\image-metadata.mjs')
    )
    # Treat the generated validator set as one versioned unit. A legacy engine
    # either has all of it or is fingerprinted by the original three files.
    $runtimeFiles = if (@($extendedRuntimeFiles | Where-Object {
      -not (Test-Path -LiteralPath $_ -PathType Leaf)
    }).Count -eq 0) { $baseRuntimeFiles + $extendedRuntimeFiles } else { $baseRuntimeFiles }
    $componentHashes = @()
    foreach ($runtimeFile in $runtimeFiles) {
      if (-not (Test-Path -LiteralPath $runtimeFile -PathType Leaf)) { return '' }
      $componentHashes += (Get-FileHash -LiteralPath $runtimeFile -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($componentHashes.Count -lt 3) { return '' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes(($componentHashes -join '|'))
      return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
      $sha.Dispose()
    }
  } catch {
    # Runtime files can be replaced or temporarily inaccessible during an update.
    # Treat an unreadable fingerprint as stale instead of failing Status/recovery.
    return ''
  }
}

function Test-DreamSkinRuntimeCurrent {
  param(
    [Parameter(Mandatory = $true)][string]$SkillRoot,
    [Parameter(Mandatory = $true)][string]$RecordedInjectorPath,
    [AllowEmptyString()][string]$RecordedFingerprint = ''
  )

  if ([string]::IsNullOrWhiteSpace($RecordedFingerprint)) { return $false }
  try {
    $recordedInjector = [System.IO.Path]::GetFullPath($RecordedInjectorPath)
    $recordedScripts = [System.IO.Path]::GetDirectoryName($recordedInjector)
    $recordedRoot = [System.IO.Path]::GetDirectoryName($recordedScripts)
    $expectedInjector = [System.IO.Path]::GetFullPath((Join-Path $recordedRoot 'scripts\injector.mjs'))
    if (-not [string]::Equals($recordedInjector, $expectedInjector,
        [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
  } catch {
    return $false
  }
  $currentFingerprint = Get-DreamSkinRuntimeFingerprint -SkillRoot $SkillRoot
  $recordedRuntimeFingerprint = Get-DreamSkinRuntimeFingerprint -SkillRoot $recordedRoot
  return $currentFingerprint -and $recordedRuntimeFingerprint -and
    [string]::Equals($currentFingerprint, $RecordedFingerprint, [System.StringComparison]::OrdinalIgnoreCase) -and
    [string]::Equals($recordedRuntimeFingerprint, $RecordedFingerprint, [System.StringComparison]::OrdinalIgnoreCase)
}
