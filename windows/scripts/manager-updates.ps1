[CmdletBinding()]
param([ValidateSet('Check','Install')][string]$Action, [string]$ExpectedVersion = '', [string]$ApprovedHash = '',
  [string]$OperationId = '', [string]$ResultPath = '',
  [Parameter(Mandatory = $true)][ValidateSet('stdin')][string]$ManifestSource)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$managerExpectedVersion = $ExpectedVersion
$managerOperationId = $OperationId
$managerResultPath = $ResultPath
$script:DreamSkinUpdateStage = 'checking'
$script:DreamSkinInstallerLaunchAttempted = $false
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
function Write-DreamSkinManagerResult {
  param([bool]$InstallerStarted, [AllowNull()][object]$UpdateError)
  if ($Action -ne 'Install') { return }
  # The result path comes only from the native backend. Keep publication in
  # its private updates directory and never follow a linked result file.
  $directory = Join-Path $script:DreamSkinStateRoot 'updates'
  Assert-DreamSkinPlainDirectory -Path $script:DreamSkinStateRoot
  Assert-DreamSkinPlainDirectory -Path $directory
  if (-not $managerOperationId -or -not $managerExpectedVersion -or
      [IO.Path]::GetDirectoryName($managerResultPath) -ine $directory -or
      [IO.Path]::GetFileName($managerResultPath) -cnotmatch '^manager-[a-f0-9]{64}\.json$') { throw 'Invalid internal update receipt identity.' }
  $value = [ordered]@{ operationId = $managerOperationId; expectedVersion = $managerExpectedVersion;
    installerStarted = $InstallerStarted; installerLaunchAttempted = $script:DreamSkinInstallerLaunchAttempted; updateError = $UpdateError }
  $temporary = Join-Path $directory ('.manager-' + [guid]::NewGuid().ToString('N') + '.tmp')
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($value | ConvertTo-Json -Compress))
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  # A result is published once per operation, using a same-directory rename.
  [IO.File]::Move($temporary, $managerResultPath)
}
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
    Write-DreamSkinManagerResult -InstallerStarted $true -UpdateError $null
  }
  $result | ConvertTo-Json -Compress
} catch {
  # Return only application-owned stages/reasons, never arbitrary stderr,
  # local paths or signed download URLs from an underlying exception.
  $reason = $script:DreamSkinUpdateStage
  $exception = $_.Exception
  $timedOut = $false
  while ($null -ne $exception) {
    if ($exception -is [TimeoutException] -or
        ($exception -is [Net.WebException] -and $exception.Status -eq [Net.WebExceptionStatus]::Timeout) -or
        ($exception -is [Net.Sockets.SocketException] -and $exception.SocketErrorCode -eq [Net.Sockets.SocketError]::TimedOut)) { $timedOut = $true }
    $exception = $exception.InnerException
  }
  if ($timedOut) {
    $reason = 'downloadTimeout'
  } elseif ($_.Exception.Message -eq 'The downloaded installer checksum does not match the release manifest.' -or
            $_.Exception.Message -eq 'The installer checksum in update.json does not match SHA256SUMS.txt.') {
    $reason = 'checksumMismatch'
  } elseif ($_.Exception.Message -eq 'The downloaded installer is empty.') {
    $reason = 'installerEmpty'
  }
  try { Write-DreamSkinManagerResult -InstallerStarted $false -UpdateError $reason }
  catch { # Preserve the controlled stdout result if durable publication failed.
  }
  [pscustomobject]@{ updateError = $reason; installerLaunchAttempted = $script:DreamSkinInstallerLaunchAttempted } | ConvertTo-Json -Compress
} finally { [Net.ServicePointManager]::SecurityProtocol = $previousProtocol }
