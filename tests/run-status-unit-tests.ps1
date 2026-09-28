[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path ([IO.Path]::GetTempPath()) ('dreamskin-status-tests-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $output | Out-Null
  $csc = @('C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
    'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe') |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $csc) { throw 'The .NET Framework C# compiler was not found.' }
  $references = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Xml.dll',
    'System.Drawing.dll','System.Windows.Forms.dll')
  foreach ($name in @('System.Xaml','WindowsBase','PresentationCore','PresentationFramework',
      'System.IO.Compression','System.IO.Compression.FileSystem')) {
    $assembly = Get-ChildItem -LiteralPath 'C:\Windows\Microsoft.NET\assembly' -Filter "$name.dll" -Recurse |
      Select-Object -First 1
    if (-not $assembly) { throw "Missing framework assembly: $name" }
    $references += $assembly.FullName
  }
  $sources = @(Get-ChildItem -LiteralPath (Join-Path $root 'src') -Filter '*.cs' | Select-Object -ExpandProperty FullName)
  $sources += @((Join-Path $PSScriptRoot 'ManagerTests.cs'), (Join-Path $PSScriptRoot 'StatusReadTests.cs'))
  $exe = Join-Path $output 'ManagerStatusTests.exe'
  $resource = '/resource:' + (Join-Path $root 'assets\donation-wechat.png') + ',CodexDreamSkinManager.DonationQr.png'
  & $csc /nologo /target:exe /platform:anycpu /main:CodexDreamSkinManager.ManagerTests "/out:$exe" `
    $resource @($references | ForEach-Object { '/reference:' + $_ }) $sources
  if ($LASTEXITCODE -ne 0) { throw 'Status unit test compilation failed.' }
  & $exe --status-read-only
  if ($LASTEXITCODE -ne 0) { throw 'C# status unit tests failed.' }
  & (Join-Path $PSScriptRoot 'status-read.unit.ps1') -Root $root
} finally {
  $resolved = [IO.Path]::GetFullPath($output)
  if ($resolved.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($resolved).StartsWith('dreamskin-status-tests-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
