[CmdletBinding()]
param(
  [switch]$Json,
  [switch]$Interactive,
  [switch]$Install,
  [string]$ExpectedVersion = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:DreamSkinRepository = 'xxloocee/Codex-Dream-Skin-Manager'
$script:DreamSkinReleaseApi = "https://api.github.com/repos/$script:DreamSkinRepository/releases/latest"
$script:DreamSkinReleasePage = "https://github.com/$script:DreamSkinRepository/releases/latest"
$script:DreamSkinMaximumChecksumBytes = 1MB
$script:DreamSkinMaximumInstallerBytes = 512MB
$script:DreamSkinEngineRoot = Split-Path -Parent $PSScriptRoot
$script:DreamSkinVersionPath = Join-Path $script:DreamSkinEngineRoot 'VERSION'
. (Join-Path $PSScriptRoot 'localization-windows.ps1')
$script:DreamSkinStateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$script:DreamSkinLanguage = Resolve-DreamSkinLanguage -StateRoot $script:DreamSkinStateRoot

function Get-DreamSkinUpdateText {
  param([Parameter(Mandatory = $true)][string]$Key, [object[]]$FormatArguments = @())
  Get-DreamSkinText -Key $Key -Language $script:DreamSkinLanguage -FormatArguments $FormatArguments
}

function ConvertTo-DreamSkinVersion {
  param([Parameter(Mandatory = $true)][string]$Value)
  $normalized = $Value.Trim()
  if ($normalized.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalized = $normalized.Substring(1)
  }
  if ($normalized -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Invalid release version: $Value"
  }
  $parsed = $null
  if (-not [version]::TryParse($normalized, [ref]$parsed)) {
    throw "Invalid release version: $Value"
  }
  return $parsed
}

function Assert-DreamSkinReleaseAssetUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$AssetName
  )
  $uri = $null
  $expectedPath = "/$script:DreamSkinRepository/releases/download/$Tag/$AssetName"
  if (-not [uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
    $uri.Scheme -cne 'https' -or $uri.Host -cne 'github.com' -or
    $uri.AbsolutePath -cne $expectedPath -or $uri.Query -or $uri.Fragment) {
    throw "Release asset is not an exact GitHub release URL: $AssetName"
  }
}

function Get-DreamSkinReleaseAsset {
  param(
    [Parameter(Mandatory = $true)][object]$Release,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Tag
  )
  $assets = @($Release.assets | Where-Object { "$($_.name)" -ceq $Name })
  if ($assets.Count -ne 1) {
    throw "The release must contain exactly one $Label asset named '$Name'."
  }
  $url = "$($assets[0].browser_download_url)"
  Assert-DreamSkinReleaseAssetUrl -Url $url -Tag $Tag -AssetName $Name
  return [pscustomobject]@{ Name = $Name; Url = $url }
}

function ConvertTo-DreamSkinUpdateResult {
  param(
    [Parameter(Mandatory = $true)][object]$Release,
    [Parameter(Mandatory = $true)][string]$CurrentVersionText
  )
  $current = ConvertTo-DreamSkinVersion -Value $CurrentVersionText
  if (-not $Release.tag_name) { throw 'GitHub did not return a release tag.' }
  $tag = "$($Release.tag_name)"
  $latest = ConvertTo-DreamSkinVersion -Value $tag
  $normalizedTag = 'v' + $latest.ToString()
  if ($tag -cne $normalizedTag) {
    throw "GitHub returned a non-canonical release tag: $tag"
  }
  if ($Release.draft -eq $true) { throw 'GitHub returned a draft release.' }
  if ($Release.prerelease -eq $true) { throw 'GitHub returned a prerelease.' }

  $releaseUrl = "$($Release.html_url)"
  $releaseUri = $null
  $expectedReleasePath = "/$script:DreamSkinRepository/releases/tag/$tag"
  if (-not [uri]::TryCreate($releaseUrl, [UriKind]::Absolute, [ref]$releaseUri) -or
    $releaseUri.Scheme -cne 'https' -or $releaseUri.Host -cne 'github.com' -or
    $releaseUri.AbsolutePath -cne $expectedReleasePath -or $releaseUri.Query -or $releaseUri.Fragment) {
    throw 'GitHub returned an invalid release page URL.'
  }

  $updateAvailable = $latest -gt $current
  $installerName = ''
  $installerUrl = ''
  $checksumUrl = ''
  if ($updateAvailable) {
    $installerName = "CodexDreamSkinManager-$normalizedTag-windows-x64-setup.exe"
    $installer = Get-DreamSkinReleaseAsset -Release $Release -Name $installerName `
      -Label 'Windows installer' -Tag $tag
    $checksum = Get-DreamSkinReleaseAsset -Release $Release -Name 'SHA256SUMS.txt' `
      -Label 'checksum manifest' -Tag $tag
    $installerUrl = $installer.Url
    $checksumUrl = $checksum.Url
  }

  return [pscustomobject][ordered]@{
    currentVersion = 'v' + $current.ToString()
    latestVersion = $normalizedTag
    updateAvailable = $updateAvailable
    releaseUrl = $releaseUrl
    installerAssetName = $installerName
    installerAssetUrl = $installerUrl
    checksumAssetUrl = $checksumUrl
    installerStarted = $false
    installerProcessId = 0
  }
}

function Get-DreamSkinExpectedChecksum {
  param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$AssetName
  )
  $matches = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($Manifest -split "`r?`n")) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $entry = [regex]::Match($line, '^([0-9A-Fa-f]{64}) [ *](.+)$')
    if (-not $entry.Success) {
      throw 'The release checksum manifest contains a malformed non-empty line.'
    }
    if ($entry.Groups[2].Value -ceq $AssetName) {
      $matches.Add($entry.Groups[1].Value.ToLowerInvariant())
    }
  }
  if ($matches.Count -ne 1) {
    throw "The release checksum manifest must contain exactly one checksum for '$AssetName'."
  }
  return $matches[0]
}

function Assert-DreamSkinInstallerChecksum {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedHash
  )
  if ($ExpectedHash -cnotmatch '^[0-9a-f]{64}$') {
    throw 'The expected installer checksum is invalid.'
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'The downloaded installer is missing.'
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The downloaded installer cannot be a reparse point.'
  }
  if ($item.Length -le 0 -or $item.Length -gt $script:DreamSkinMaximumInstallerBytes) {
    throw 'The downloaded installer size is outside the allowed range.'
  }
  $actualHash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -cne $ExpectedHash) {
    throw 'The downloaded installer checksum does not match the release manifest.'
  }
}

function Assert-DreamSkinPlainDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    [void][System.IO.Directory]::CreateDirectory($Path)
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "The update directory cannot be a reparse point: $Path"
  }
}

function Invoke-DreamSkinUpdateDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )
  $null = Invoke-WebRequest -Uri $Url -Headers @{
    Accept = 'application/octet-stream'
    'User-Agent' = 'CodexDreamSkinManager'
  } -Method Get -UseBasicParsing -TimeoutSec $TimeoutSeconds -OutFile $Destination
}

function Get-DreamSkinLatestRelease {
  $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'CodexDreamSkinManager' }
  return Invoke-RestMethod -Uri $script:DreamSkinReleaseApi -Headers $headers -Method Get -TimeoutSec 12
}

function Install-DreamSkinUpdate {
  param(
    [Parameter(Mandatory = $true)][object]$Result,
    [string]$Expected = ''
  )
  if (-not $Result.updateAvailable) { throw 'No newer release is available to install.' }
  if ($Expected) {
    $expectedParsed = ConvertTo-DreamSkinVersion -Value $Expected
    if (('v' + $expectedParsed.ToString()) -cne "$($Result.latestVersion)") {
      throw "The latest release changed from $Expected to $($Result.latestVersion). Check for updates again."
    }
  }

  Assert-DreamSkinPlainDirectory -Path $script:DreamSkinStateRoot
  $updatesRoot = Join-Path $script:DreamSkinStateRoot 'updates'
  Assert-DreamSkinPlainDirectory -Path $updatesRoot
  $downloadRoot = Join-Path $updatesRoot (
    $Result.latestVersion + '-' + [guid]::NewGuid().ToString('N'))
  [void][System.IO.Directory]::CreateDirectory($downloadRoot)
  Assert-DreamSkinPlainDirectory -Path $downloadRoot
  $checksumPath = Join-Path $downloadRoot 'SHA256SUMS.txt'
  $installerDownload = Join-Path $downloadRoot ($Result.installerAssetName + '.download')
  $installerPath = Join-Path $downloadRoot $Result.installerAssetName
  $keepDownload = $false
  try {
    Invoke-DreamSkinUpdateDownload -Url $Result.checksumAssetUrl -Destination $checksumPath -TimeoutSeconds 30
    $checksumItem = Get-Item -LiteralPath $checksumPath -Force
    if (($checksumItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $checksumItem.Length -le 0 -or $checksumItem.Length -gt $script:DreamSkinMaximumChecksumBytes) {
      throw 'The release checksum manifest size or file type is invalid.'
    }
    $manifest = [System.IO.File]::ReadAllText($checksumItem.FullName, [System.Text.Encoding]::UTF8)
    $expectedHash = Get-DreamSkinExpectedChecksum -Manifest $manifest -AssetName $Result.installerAssetName
    Invoke-DreamSkinUpdateDownload -Url $Result.installerAssetUrl -Destination $installerDownload -TimeoutSeconds 180
    Assert-DreamSkinInstallerChecksum -Path $installerDownload -ExpectedHash $expectedHash
    Move-Item -LiteralPath $installerDownload -Destination $installerPath
    Assert-DreamSkinInstallerChecksum -Path $installerPath -ExpectedHash $expectedHash
    $process = Start-Process -FilePath $installerPath -WorkingDirectory $downloadRoot -PassThru
    if ($null -eq $process -or $process.Id -le 0) { throw 'The verified installer could not be started.' }
    $keepDownload = $true
    $Result.installerStarted = $true
    $Result.installerProcessId = $process.Id
    return $Result
  } finally {
    if (-not $keepDownload) {
      Remove-Item -LiteralPath $downloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Confirm-DreamSkinInteractiveUpdate {
  param([Parameter(Mandatory = $true)][object]$Result)
  Add-Type -AssemblyName System.Windows.Forms
  if (-not $Result.updateAvailable) {
    [void][System.Windows.Forms.MessageBox]::Show(
      (Get-DreamSkinUpdateText -Key 'UpToDate' -FormatArguments @($Result.currentVersion)),
      (Get-DreamSkinUpdateText -Key 'UpdateTitle'),
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    )
    return $false
  }
  $choice = [System.Windows.Forms.MessageBox]::Show(
    ((Get-DreamSkinUpdateText -Key 'UpdateAvailable' -FormatArguments @($Result.latestVersion)) +
      [Environment]::NewLine + [Environment]::NewLine +
      (Get-DreamSkinUpdateText -Key 'UpdateQuestion')),
    (Get-DreamSkinUpdateText -Key 'UpdateTitle'),
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Information
  )
  return $choice -eq [System.Windows.Forms.DialogResult]::Yes
}

function Invoke-DreamSkinUpdateMain {
  if (-not (Test-Path -LiteralPath $script:DreamSkinVersionPath -PathType Leaf)) {
    throw "Installed version file is missing: $script:DreamSkinVersionPath"
  }
  $currentText = ([System.IO.File]::ReadAllText($script:DreamSkinVersionPath)).Trim()
  $previousProtocol = [Net.ServicePointManager]::SecurityProtocol
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Get-DreamSkinLatestRelease
    $result = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText $currentText
    $shouldInstall = $Install
    if ($Interactive) { $shouldInstall = Confirm-DreamSkinInteractiveUpdate -Result $result }
    if ($shouldInstall) {
      $result = Install-DreamSkinUpdate -Result $result -Expected $ExpectedVersion
    }
    if ($Json) { $result | ConvertTo-Json -Compress }
    if (-not $Json -and -not $Interactive) {
      Write-Host "$($result.currentVersion) -> $($result.latestVersion); update=$($result.updateAvailable); started=$($result.installerStarted)"
    }
  } finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-DreamSkinUpdateMain
  } catch {
    if ($Json) {
      [pscustomobject]@{ error = $_.Exception.Message; releaseUrl = $script:DreamSkinReleasePage } |
        ConvertTo-Json -Compress
    }
    if ($Interactive) {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show(
        ((Get-DreamSkinUpdateText -Key 'UpdateFailed') + [Environment]::NewLine +
          [Environment]::NewLine + $_.Exception.Message),
        (Get-DreamSkinUpdateText -Key 'UpdateTitle'),
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      )
    }
    throw
  }
}
