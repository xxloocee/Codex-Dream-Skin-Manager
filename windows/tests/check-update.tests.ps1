[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$UpdateScript
)

$ErrorActionPreference = 'Stop'

function Assert-Equal([object]$Expected, [object]$Actual, [string]$Message) {
  if ("$Expected" -cne "$Actual") {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Message) {
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notmatch $Pattern) {
      throw "$Message Unexpected error: $($_.Exception.Message)"
    }
    return
  }
  throw "$Message Expected an error."
}

. $UpdateScript

$installerName = 'CodexDreamSkinManager-v1.7.0-windows-x64-setup.exe'
$installerUrl = "https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases/download/v1.7.0/$installerName"
$checksumUrl = 'https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases/download/v1.7.0/SHA256SUMS.txt'
$release = [pscustomobject]@{
  tag_name = 'v1.7.0'
  draft = $false
  prerelease = $false
  html_url = 'https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases/tag/v1.7.0'
  assets = @(
    [pscustomobject]@{ name = $installerName; browser_download_url = $installerUrl },
    [pscustomobject]@{ name = 'SHA256SUMS.txt'; browser_download_url = $checksumUrl }
  )
}

$result = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
Assert-Equal 'v1.6.0' $result.currentVersion 'Current version was not normalized.'
Assert-Equal 'v1.7.0' $result.latestVersion 'Latest version was not normalized.'
Assert-Equal $true $result.updateAvailable 'Newer release was not detected.'
Assert-Equal $installerName $result.installerAssetName 'Installer asset was not selected exactly.'
Assert-Equal $installerUrl $result.installerAssetUrl 'Installer URL was not preserved.'
Assert-Equal $checksumUrl $result.checksumAssetUrl 'Checksum URL was not preserved.'

$same = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.7.0'
Assert-Equal $false $same.updateAvailable 'Current release was treated as newer.'

$duplicate = $release.PSObject.Copy()
$duplicate.assets = @($release.assets) + @([pscustomobject]@{
  name = $installerName
  browser_download_url = $installerUrl
})
Assert-Throws { ConvertTo-DreamSkinUpdateResult -Release $duplicate -CurrentVersionText '1.6.0' } `
  'exactly one.*installer' 'Duplicate installer assets were accepted.'

$missingChecksum = $release.PSObject.Copy()
$missingChecksum.assets = @($release.assets[0])
Assert-Throws { ConvertTo-DreamSkinUpdateResult -Release $missingChecksum -CurrentVersionText '1.6.0' } `
  'exactly one.*checksum' 'A missing checksum manifest was accepted.'

$prerelease = $release.PSObject.Copy()
$prerelease.prerelease = $true
Assert-Throws { ConvertTo-DreamSkinUpdateResult -Release $prerelease -CurrentVersionText '1.6.0' } `
  'prerelease' 'A prerelease was accepted.'

$foreign = $release.PSObject.Copy()
$foreign.assets = @(
  [pscustomobject]@{ name = $installerName; browser_download_url = "https://example.com/$installerName" },
  $release.assets[1]
)
Assert-Throws { ConvertTo-DreamSkinUpdateResult -Release $foreign -CurrentVersionText '1.6.0' } `
  'GitHub release URL' 'A foreign installer URL was accepted.'

$hash = ('ab' * 32)
$manifest = "$hash  $installerName`n$('cd' * 32)  unrelated.zip`n"
Assert-Equal $hash (Get-DreamSkinExpectedChecksum -Manifest $manifest -AssetName $installerName) `
  'The exact installer checksum was not selected.'
Assert-Throws {
  Get-DreamSkinExpectedChecksum -Manifest ($manifest + "$hash *$installerName`n") -AssetName $installerName
} 'exactly one checksum' 'Duplicate checksum entries were accepted.'
Assert-Throws {
  Get-DreamSkinExpectedChecksum -Manifest ($manifest + "$('x' * 64)  $installerName`n") -AssetName $installerName
} 'malformed' 'A malformed non-empty checksum line was ignored.'

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('dream-skin-update-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  $fixture = Join-Path $temporaryRoot $installerName
  [System.IO.File]::WriteAllText($fixture, 'verified installer fixture', [System.Text.UTF8Encoding]::new($false))
  $actualHash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-DreamSkinInstallerChecksum -Path $fixture -ExpectedHash $actualHash
  Assert-Throws { Assert-DreamSkinInstallerChecksum -Path $fixture -ExpectedHash ('00' * 32) } `
    'checksum.*match' 'A checksum mismatch was accepted.'

  $script:DreamSkinStateRoot = Join-Path $temporaryRoot 'state'
  $script:MockInstallerSource = $fixture
  $script:MockChecksumText = "$actualHash  $installerName`n"
  $script:LaunchCount = 0
  $realDownload = (Get-Command Invoke-DreamSkinUpdateDownload -CommandType Function).ScriptBlock
  try {
    function Invoke-DreamSkinUpdateDownload {
      param([string]$Url, [string]$Destination, [int]$TimeoutSeconds)
      if ($Destination.EndsWith('SHA256SUMS.txt', [System.StringComparison]::Ordinal)) {
        [System.IO.File]::WriteAllText($Destination, $script:MockChecksumText, [System.Text.UTF8Encoding]::new($false))
      } else {
        Copy-Item -LiteralPath $script:MockInstallerSource -Destination $Destination
      }
    }
    function Start-Process {
      param([string]$FilePath, [string]$WorkingDirectory, [switch]$PassThru)
      if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw 'The updater tried to launch a missing installer or working directory.'
      }
      $script:LaunchCount++
      return [pscustomobject]@{ Id = 4242 }
    }

    $installResult = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    $started = Install-DreamSkinUpdate -Result $installResult -Expected 'v1.7.0'
    Assert-Equal $true $started.installerStarted 'Verified update did not report a started installer.'
    Assert-Equal 1 $script:LaunchCount 'Verified update did not launch exactly once.'

    $script:LaunchCount = 0
    $mismatchedVersion = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    Assert-Throws { Install-DreamSkinUpdate -Result $mismatchedVersion -Expected 'v1.8.0' } `
      'latest release changed' 'An unexpected release version reached the launch boundary.'
    Assert-Equal 0 $script:LaunchCount 'Version mismatch launched an installer.'

    $script:LaunchCount = 0
    $script:MockChecksumText = "$('00' * 32)  $installerName`n"
    $badChecksum = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    Assert-Throws { Install-DreamSkinUpdate -Result $badChecksum -Expected 'v1.7.0' } `
      'checksum.*match' 'A mismatched downloaded installer reached the launch boundary.'
    Assert-Equal 0 $script:LaunchCount 'Checksum mismatch launched an installer.'

    $script:LaunchCount = 0
    $script:MockChecksumText = "$('11' * 32)  unrelated.zip`n"
    $missingChecksumEntry = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    Assert-Throws { Install-DreamSkinUpdate -Result $missingChecksumEntry -Expected 'v1.7.0' } `
      'exactly one checksum' 'A missing installer checksum reached the launch boundary.'
    Assert-Equal 0 $script:LaunchCount 'Missing installer checksum launched an installer.'

    $script:LaunchCount = 0
    $script:MockChecksumText = "$actualHash  $installerName`n$actualHash *$installerName`n"
    $duplicateChecksumEntry = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    Assert-Throws { Install-DreamSkinUpdate -Result $duplicateChecksumEntry -Expected 'v1.7.0' } `
      'exactly one checksum' 'Duplicate installer checksums reached the launch boundary.'
    Assert-Equal 0 $script:LaunchCount 'Duplicate installer checksums launched an installer.'

    $script:LaunchCount = 0
    $script:MockChecksumText = "$actualHash  $installerName`n$('x' * 64)  $installerName`n"
    $malformedChecksumEntry = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText '1.6.0'
    Assert-Throws { Install-DreamSkinUpdate -Result $malformedChecksumEntry -Expected 'v1.7.0' } `
      'malformed' 'A malformed checksum line reached the launch boundary.'
    Assert-Equal 0 $script:LaunchCount 'Malformed checksum manifest launched an installer.'
  } finally {
    Set-Item -Path Function:\Invoke-DreamSkinUpdateDownload -Value $realDownload
    Remove-Item -Path Function:\Start-Process -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'PASS: update release and checksum contract'
