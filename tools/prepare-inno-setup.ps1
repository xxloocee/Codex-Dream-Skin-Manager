[CmdletBinding()]
param(
  [string]$ToolRoot = (Join-Path $PSScriptRoot '..\build\.tools\InnoSetup'),
  [string]$Version = '6.7.3',
  [string]$BootstrapSha256 = '9C73C3BAE7ED48D44112A0F48E66742C00090BDB5BEF71D9D3C056C66E97B732',
  [string]$CompilerSha256 = '0A8757031B33777E4C9CBFFEE40F11A5062B36D25CBE144C1DB73B6102B80AD7',
  [string]$SignerOrganization = 'Pyrsys B.V.'
)

$ErrorActionPreference = 'Stop'

function Assert-NoReparsePoint {
  param([Parameter(Mandatory)][string]$Path)

  $current = [System.IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Inno Setup path must not contain a reparse point: $current"
      }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if (-not $parent -or $parent.FullName -eq $current) { break }
    $current = $parent.FullName
  }
}

function Assert-OfficialExecutable {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$Description
  )

  Assert-NoReparsePoint -Path $Path
  $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if (-not $actualHash.Equals($ExpectedSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Description hash mismatch: expected $ExpectedSha256, got $actualHash."
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "$Description signature is not valid: $($signature.StatusMessage)"
  }
  $organizationPattern = "(?:^|,\s*)O=$([regex]::Escape($SignerOrganization))(?:,|$)"
  if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch $organizationPattern) {
    throw "$Description signer is not $SignerOrganization."
  }
}

$tool = [System.IO.Path]::GetFullPath($ToolRoot)
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace 'build')).TrimEnd('\')
if (-not $tool.StartsWith(($buildRoot + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Inno Setup tool root must remain inside build: $tool"
}
Assert-NoReparsePoint -Path $tool

$iscc = Join-Path $tool 'ISCC.exe'
if (Test-Path -LiteralPath $iscc -PathType Leaf) {
  Assert-OfficialExecutable -Path $iscc -ExpectedSha256 $CompilerSha256 -Description 'Inno Setup compiler'
  Write-Output $iscc
  exit 0
}

New-Item -ItemType Directory -Force -Path $tool | Out-Null
$download = Join-Path $tool "innosetup-$Version.exe"
$url = "https://github.com/jrsoftware/issrc/releases/download/is-$($Version.Replace('.', '_'))/innosetup-$Version.exe"
if (-not (Test-Path -LiteralPath $download -PathType Leaf)) {
  Invoke-WebRequest -Uri $url -OutFile $download -UseBasicParsing
}

Assert-OfficialExecutable -Path $download -ExpectedSha256 $BootstrapSha256 -Description 'Inno Setup bootstrap'

$process = Start-Process -FilePath $download -ArgumentList @(
  '/VERYSILENT',
  '/SUPPRESSMSGBOXES',
  '/NORESTART',
  '/PORTABLE=1',
  ("/DIR=`"$tool`"")
) -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Inno Setup bootstrap failed: $($process.ExitCode)" }
if (-not (Test-Path -LiteralPath $iscc -PathType Leaf)) {
  throw "Inno Setup compiler was not installed at $iscc"
}
Assert-OfficialExecutable -Path $iscc -ExpectedSha256 $CompilerSha256 -Description 'Inno Setup compiler'
Write-Output $iscc
