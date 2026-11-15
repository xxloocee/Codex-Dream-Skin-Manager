[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallRoot,
  [Parameter(Mandatory)][string]$LogPath
)

$ErrorActionPreference = 'Stop'

function Write-InstallLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Value ("{0:o} {1}" -f [DateTime]::UtcNow, $Message) -Encoding UTF8
}

function Stop-InstalledProcess($Entry, [string]$Executable) {
  $process = Get-Process -Id $Entry.ProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return }
  try {
    # Pin the process handle and confirm its identity before termination.
    $null = $process.Handle
    if ($process.HasExited) { return }
    if ($process.MainModule.FileName -ine $Executable -or
        [Math]::Abs(($process.StartTime.ToUniversalTime() - $Entry.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1) {
      throw '进程身份已改变，未结束该进程，请重试安装。'
    }
    Write-InstallLog "立即结束 $Executable，PID $($Entry.ProcessId)"
    $process.Kill()
    # Wait only for Windows to complete termination and release the image.
    $process.WaitForExit()
  } catch {
    if (-not $process.HasExited) { throw }
  } finally { $process.Dispose() }
}

try {
  $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  Write-InstallLog "用户已确认关闭安装目录内的管理器及后台进程：$root"

  # Stop task sources before finding their independent PowerShell workers.
  foreach ($relative in @('CodexDreamSkinManager.exe', 'runtime\node\node.exe')) {
    $executable = Join-Path $root $relative
    $name = [IO.Path]::GetFileName($executable)
    foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = '$name'" | Where-Object {
      $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $executable
    })) {
      Stop-InstalledProcess $entry $executable
    }
  }

  # Both bundled invocation wrappers carry the actual script path in nested
  # Base64 JSON. Decode as data, never evaluate the command or match root text
  # in arbitrary parameters. This also identifies workers whose parent exited.
  $scriptsRoot = Join-Path $root 'windows\scripts'
  foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'")) {
    if (-not $entry.ExecutablePath -or -not $entry.CommandLine) { continue }
    try {
      $encoded = [regex]::Match($entry.CommandLine, '(?i)(?:^|\s)-EncodedCommand\s+"?([A-Za-z0-9+/=]+)"?(?=\s|$)')
      if (-not $encoded.Success) { continue }
      $command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded.Groups[1].Value))
      $nested = [regex]::Match($command, "\[Convert\]::FromBase64String\('([A-Za-z0-9+/=]+)'\)", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
      if (-not $nested.Success) { continue }
      $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($nested.Groups[1].Value)) | ConvertFrom-Json
      $script = if ($request.script -is [string]) { $request.script } elseif ($request.ScriptPath -is [string]) { $request.ScriptPath } else { '' }
      if (-not $script -or -not [IO.Path]::IsPathRooted($script)) { continue }
      $script = [IO.Path]::GetFullPath($script)
      if ([IO.Path]::GetDirectoryName($script) -ine $scriptsRoot -or [IO.Path]::GetExtension($script) -ine '.ps1') { continue }
    } catch { continue } # Other PowerShell invocations are outside this install.
    Stop-InstalledProcess $entry $entry.ExecutablePath
  }

  # A worker may have started a bundled Node before it was terminated. End
  # those runtimes last, without stopping Codex or an unrelated node.exe.
  foreach ($relative in @('runtime\node\node.exe', 'windows\runtime\node\node.exe')) {
    $executable = Join-Path $root $relative
    $name = [IO.Path]::GetFileName($executable)
    foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = '$name'" | Where-Object {
      $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $executable
    })) {
      Stop-InstalledProcess $entry $executable
    }
  }
  $marker = Join-Path $root 'updater\installation-complete.json'
  if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force }
  Write-InstallLog '管理器及其后台进程已结束，继续安装。'
  exit 0
} catch {
  try { Write-InstallLog $_.Exception.Message } catch { }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
