[CmdletBinding()]
param([ValidateSet('Check','Install')][string]$Action, [string]$ExpectedVersion = '', [string]$ApprovedHash = '',
  [Parameter(Mandatory = $true)][ValidateSet('stdin')][string]$ManifestSource)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$managerExpectedVersion = $ExpectedVersion
$script:DreamSkinUpdateStage = 'checking'
$script:DreamSkinInstallerLaunchAttempted = $false
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
try {
  . (Join-Path $PSScriptRoot 'check-update.ps1')
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $currentText = ([IO.File]::ReadAllText($script:DreamSkinVersionPath)).Trim()
  # Only the Node caller supplies this manifest, after Ed25519 verification.
  # Do not re-fetch an unsigned manifest in PowerShell.
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  $manifestText = [Console]::In.ReadToEnd()
  if (-not $manifestText -or [Text.Encoding]::UTF8.GetByteCount($manifestText) -gt 1MB) { throw 'Invalid verified manifest size.' }
  $release = $manifestText | ConvertFrom-Json
  if ($release.schemaVersion -ne 1 -or $release.draft -cne $false -or $release.prerelease -cne $false) { throw 'Invalid verified manifest.' }
  $result = ConvertTo-DreamSkinUpdateResult -Release $release -CurrentVersionText $currentText
  if ($Action -eq 'Install') {
    if (-not $managerExpectedVersion -or -not $ApprovedHash) { throw 'A bound update approval is required.' }
    $result = Install-DreamSkinUpdate -Result $result -Expected $managerExpectedVersion -ApprovedHash $ApprovedHash
  }
  $result | ConvertTo-Json -Compress
} catch {
  # Return only application-owned stages/reasons, never arbitrary stderr,
  # local paths or signed download URLs from an underlying exception.
  $reason = $script:DreamSkinUpdateStage
  if (($_.Exception -is [Net.WebException] -and $_.Exception.Status -eq [Net.WebExceptionStatus]::Timeout) -or
      $_.Exception -is [TimeoutException]) {
    $reason = 'downloadTimeout'
  } elseif ($_.Exception.Message -eq 'The downloaded installer checksum does not match the release manifest.' -or
            $_.Exception.Message -eq 'The installer checksum in update.json does not match SHA256SUMS.txt.') {
    $reason = 'checksumMismatch'
  } elseif ($_.Exception.Message -eq 'The downloaded installer is empty.') {
    $reason = 'installerEmpty'
  }
  [pscustomobject]@{ updateError = $reason; installerLaunchAttempted = $script:DreamSkinInstallerLaunchAttempted } | ConvertTo-Json -Compress
} finally { [Net.ServicePointManager]::SecurityProtocol = $previousProtocol }
