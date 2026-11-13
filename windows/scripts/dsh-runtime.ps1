param(
  [Parameter(Mandatory = $true)][ValidateSet('inventory', 'prepare')][string]$Action,
  [ValidateSet('dsh', 'dsh-next')][string]$Target = 'dsh',
  [string]$ExpectedExecutable = '',
  [int]$ExpectedProcessId = 0,
  [string]$ExpectedStartTime = '0'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$executableName = if ($Target -eq 'dsh-next') { 'DSH NEXT.exe' } else { 'DeepSeek Harness.exe' }
$registrationPattern = if ($Target -eq 'dsh-next') { '^DSH NEXT(?:\s+\d.*)?$' } else { '^DeepSeek Harness(?:\s+\d.*)?$' }
$label = if ($Target -eq 'dsh-next') { 'DSH Next' } else { 'DSH rc' }

function Get-DshInventory {
  $paths = @()
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    foreach ($registration in @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $registrationPattern })) {
      if ($registration.InstallLocation) { $paths += Join-Path $registration.InstallLocation $executableName }
      if ($registration.DisplayIcon) {
        $icon = ($registration.DisplayIcon -replace ',\s*-?\d+$', '').Trim('"')
        if ([IO.Path]::GetFileName($icon) -ieq $executableName) { $paths += $icon }
        elseif ($Target -eq 'dsh-next' -and [IO.Path]::GetFileName($icon) -ieq 'uninstallerIcon.ico') {
          $paths += Join-Path ([IO.Path]::GetDirectoryName($icon)) $executableName
        }
      }
    }
  }
  $paths = @($paths | Where-Object { [IO.Path]::IsPathRooted($_) -and (Test-Path -LiteralPath $_ -PathType Leaf) } | ForEach-Object { [IO.Path]::GetFullPath($_) } | Sort-Object -Unique)
  $applications = @()
  foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = '$executableName'")) {
    # The backend uses this same exe in Node mode; never close backend/helpers.
    if (!$entry.ExecutablePath -or $paths -inotcontains $entry.ExecutablePath -or !$entry.CommandLine -or
        $entry.CommandLine -match '(?i)--type(?:=|\s)|(?:^|\s)--(?:run-as-node|ms-enable-electron-run-as-node|expose-internals)(?:=|\s|$)|\.[cm]?js(?:["\s]|$)') { continue }
    $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if (!$process) { continue }
    $startTime = $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()
    if ($process.Path -ine $entry.ExecutablePath) { throw "$label process changed during discovery; retry applying the skin." }
    $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $entry.ProcessId -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort }
    })
    $applications += [pscustomobject]@{ pid = [int]$entry.ProcessId; executable = $entry.ExecutablePath; startTime = $startTime; listeners = $listeners }
  }
  return [pscustomobject]@{ installations = $paths; applications = $applications }
}

function Assert-DshExpectedProcess($Inventory) {
  if (!$ExpectedExecutable -or $Inventory.installations -inotcontains $ExpectedExecutable) { throw "$label executable is not a registered installation." }
  if ($ExpectedProcessId -eq 0) {
    if ($ExpectedStartTime -ne '0' -or $Inventory.applications.Count -ne 0) { throw "$label process changed before preparation; retry applying the skin." }
    return
  }
  if ($Inventory.applications.Count -ne 1) { throw "Expected one registered $label desktop main process before restarting it." }
  $app = $Inventory.applications[0]
  if ($app.pid -ne $ExpectedProcessId -or $app.executable -ine $ExpectedExecutable -or $app.startTime -ne $ExpectedStartTime) {
    throw "$label process changed before preparation; retry applying the skin."
  }
}

function Stop-DshMainProcess {
  # Restart Manager sends the normal ENDSESSION_CLOSEAPP notifications. A DSH
  # window's WM_CLOSE alone hides to tray, while session-end follows its cleanup.
  # Register only this process identity, never executable files or services.
  if (-not ('DreamSkinDshRestartManager' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DreamSkinDshRestartManager {
  [StructLayout(LayoutKind.Sequential)]
  public struct UniqueProcess { public int ProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME StartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string ServiceName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint SessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern uint RmStartSession(out uint handle, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern uint RmRegisterResources(uint handle, uint files, string[] names, uint apps, UniqueProcess[] processes, uint services, string[] serviceNames);
  [DllImport("rstrtmgr.dll")] public static extern uint RmGetList(uint handle, out uint needed, ref uint count, [In, Out] ProcessInfo[] processes, ref uint reasons);
  [DllImport("rstrtmgr.dll")] public static extern uint RmShutdown(uint handle, uint flags, IntPtr callback);
  [DllImport("rstrtmgr.dll")] public static extern uint RmEndSession(uint handle);
}
'@
  }
  $identity = [DreamSkinDshRestartManager+UniqueProcess]::new()
  $identity.ProcessId = $ExpectedProcessId
  $time = [UInt64]::Parse($ExpectedStartTime)
  $fileTime = [Runtime.InteropServices.ComTypes.FILETIME]::new()
  $fileTime.dwLowDateTime = [BitConverter]::ToInt32([BitConverter]::GetBytes([UInt32]($time -band 4294967295)), 0)
  $fileTime.dwHighDateTime = [BitConverter]::ToInt32([BitConverter]::GetBytes([UInt32]($time -shr 32)), 0)
  $identity.StartTime = $fileTime
  $session = [uint32]0
  $key = [Text.StringBuilder]::new(33)
  $code = [DreamSkinDshRestartManager]::RmStartSession([ref]$session, 0, $key)
  if ($code -ne 0) { throw "$label normal shutdown could not start (Windows error $code)." }
  try {
    $code = [DreamSkinDshRestartManager]::RmRegisterResources($session, 0, $null, 1, @($identity), 0, $null)
    if ($code -ne 0) { throw "$label normal shutdown registration failed (Windows error $code)." }
    $needed = [uint32]0; $count = [uint32]0; $reasons = [uint32]0
    $code = [DreamSkinDshRestartManager]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reasons)
    if ($code -ne 234 -or $needed -ne 1 -or $reasons -ne 0) { throw "$label normal shutdown did not identify only its registered main process." }
    $rows = [DreamSkinDshRestartManager+ProcessInfo[]]::new(1)
    $count = [uint32]1
    $code = [DreamSkinDshRestartManager]::RmGetList($session, [ref]$needed, [ref]$count, $rows, [ref]$reasons)
    if ($code -ne 0 -or $count -ne 1 -or $reasons -ne 0 -or $rows[0].Process.ProcessId -ne $ExpectedProcessId -or
        $rows[0].Process.StartTime.dwLowDateTime -ne $identity.StartTime.dwLowDateTime -or $rows[0].Process.StartTime.dwHighDateTime -ne $identity.StartTime.dwHighDateTime) {
      throw "$label normal shutdown target changed; no restart was attempted."
    }
    Assert-DshExpectedProcess (Get-DshInventory)
    # 0 means graceful shutdown. Neither ForceShutdown nor ShutdownOnlyRegistered
    # (which requires RegisterApplicationRestart) is appropriate here.
    $code = [DreamSkinDshRestartManager]::RmShutdown($session, 0, [IntPtr]::Zero)
    if ($code -ne 0) { throw "$label did not accept normal shutdown (Windows error $code); no restart was attempted." }
  } finally { [void][DreamSkinDshRestartManager]::RmEndSession($session) }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ($true) {
    $process = Get-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue
    if (!$process -or $process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $ExpectedStartTime) { break }
    if ([DateTime]::UtcNow -ge $deadline) { throw "$label did not close normally within 15 seconds; no restart was attempted." }
    Start-Sleep -Milliseconds 200
  }
}

function Start-DshApplication {
  $fresh = Get-DshInventory
  if ($fresh.installations -inotcontains $ExpectedExecutable -or $fresh.applications.Count -ne 0) { throw "$label installation or process changed before launch; no restart was attempted." }
  Start-Process -FilePath $ExpectedExecutable -ArgumentList @('--inspect=127.0.0.1:0') -WorkingDirectory ([IO.Path]::GetDirectoryName($ExpectedExecutable)) -WindowStyle Hidden
}

$inventory = Get-DshInventory
if ($Action -eq 'prepare') {
  Assert-DshExpectedProcess $inventory
  if ($ExpectedProcessId -ne 0) { Stop-DshMainProcess }
  Start-DshApplication
  $inventory = Get-DshInventory
}
ConvertTo-Json -InputObject $inventory -Depth 5 -Compress
