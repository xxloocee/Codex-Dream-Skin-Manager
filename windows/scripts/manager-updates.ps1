[CmdletBinding()]
param([ValidateSet('Check','Install')][string]$Action, [string]$ExpectedVersion = '', [string]$ApprovedHash = '')
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
  $result = ConvertTo-DreamSkinUpdateResult -Release (Get-DreamSkinLatestRelease) -CurrentVersionText $currentText
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
