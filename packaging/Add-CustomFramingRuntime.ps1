[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$WindowsRoot
)

$ErrorActionPreference = 'Stop'

function Replace-ExactlyOnce {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $Text = $Text.Replace("`r`n", "`n")
  $Old = $Old.Replace("`r`n", "`n")
  $New = $New.Replace("`r`n", "`n")
  $first = $Text.IndexOf($Old, [System.StringComparison]::Ordinal)
  $last = $Text.LastIndexOf($Old, [System.StringComparison]::Ordinal)
  if ($first -lt 0 -or $first -ne $last) {
    throw "Cannot patch custom theme framing: expected one $Label anchor."
  }
  return $Text.Substring(0, $first) + $New + $Text.Substring($first + $Old.Length)
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Content)
  $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

$root = [System.IO.Path]::GetFullPath($WindowsRoot)
$injectorPath = Join-Path $root 'scripts\injector.mjs'
$commonPath = Join-Path $root 'scripts\common-windows.ps1'
$startPath = Join-Path $root 'scripts\start-dream-skin.ps1'
$trayPath = Join-Path $root 'scripts\tray-dream-skin.ps1'
$rendererPath = Join-Path $root 'assets\renderer-inject.js'
$cssPath = Join-Path $root 'assets\dream-skin.css'
foreach ($path in @($injectorPath, $commonPath, $startPath, $trayPath, $rendererPath, $cssPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Cannot patch custom theme framing; runtime file is missing: $path"
  }
}

$injector = Get-Content -LiteralPath $injectorPath -Raw -Encoding UTF8
$injector = Replace-ExactlyOnce $injector @'
const THEME_CHOICES = {
  appearance: new Set(["auto", "light", "dark"]),
'@ @'
const THEME_CHOICES = {
  appearance: new Set(["auto", "light", "dark"]),
  positionMode: new Set(["locked", "free"]),
'@ 'injector position mode choice'
$injector = Replace-ExactlyOnce $injector @'
function normalizedChoice(value, name, choices, fallback) {
'@ @'
function normalizedRange(value, name, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return number;
}

function normalizedChoice(value, name, choices, fallback) {
'@ 'injector range normalizer'
$injector = Replace-ExactlyOnce $injector @'
      focusY: normalizedUnit(art.focusY, "art.focusY"),
      safeArea: normalizedChoice(art.safeArea, "art.safeArea", THEME_CHOICES.safeArea, "auto"),
'@ @'
      focusY: normalizedUnit(art.focusY, "art.focusY"),
      positionX: normalizedRange(art.positionX, "art.positionX", -1, 1, 0),
      positionY: normalizedRange(art.positionY, "art.positionY", -1, 1, 0),
      zoom: normalizedRange(art.zoom, "art.zoom", 1, 2, 1),
      positionMode: normalizedChoice(art.positionMode, "art.positionMode", THEME_CHOICES.positionMode, "locked"),
      framingEnabled: ["positionX", "positionY", "zoom", "positionMode"]
        .some((name) => Object.prototype.hasOwnProperty.call(art, name)),
      safeArea: normalizedChoice(art.safeArea, "art.safeArea", THEME_CHOICES.safeArea, "auto"),
'@ 'injector art configuration'
Write-Utf8NoBom $injectorPath $injector

$common = Get-Content -LiteralPath $commonPath -Raw -Encoding UTF8
$common = Replace-ExactlyOnce $common @'
  try { Wait-Process -Id $processId -Timeout 5 -ErrorAction Stop } catch {}
'@ @'
  try { Wait-Process -Id $processId -Timeout 15 -ErrorAction Stop } catch {}
  $exitDeadline = (Get-Date).AddSeconds(5)
  while ((Get-Process -Id $processId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $exitDeadline) {
    Start-Sleep -Milliseconds 200
  }
'@ 'recorded injector shutdown timeout'
Write-Utf8NoBom $commonPath $common

$start = Get-Content -LiteralPath $startPath -Raw -Encoding UTF8
$start = Replace-ExactlyOnce $start @'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')
'@ @'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')
. (Join-Path $PSScriptRoot 'runtime-version.ps1')
'@ 'start runtime fingerprint helper'
$start = Replace-ExactlyOnce $start @'
  $state = $null
  $daemon = $null
  try {
'@ @'
  $state = $null
  $daemon = $null
  $runtimeFingerprint = Get-DreamSkinRuntimeFingerprint -SkillRoot (Split-Path -Parent $PSScriptRoot)
  if (-not $runtimeFingerprint) { throw 'The rendering runtime fingerprint could not be calculated.' }
  try {
'@ 'startup fingerprint before injector process'
$start = Replace-ExactlyOnce $start @'
    Start-Sleep -Milliseconds 500
    if ($daemon.HasExited) { throw "The injector exited during startup. See $StderrPath" }

    $injectorStartedAt = Get-DreamSkinProcessStartedAt -ProcessId $daemon.Id
'@ @'
    Start-Sleep -Milliseconds 500
    if ($daemon.HasExited) { throw "The injector exited during startup. See $StderrPath" }
    $currentRuntimeFingerprint = Get-DreamSkinRuntimeFingerprint -SkillRoot (Split-Path -Parent $PSScriptRoot)
    if ($currentRuntimeFingerprint -cne $runtimeFingerprint) {
      throw 'The rendering runtime changed while the injector was starting; retry the operation.'
    }

    $injectorStartedAt = Get-DreamSkinProcessStartedAt -ProcessId $daemon.Id
'@ 'startup fingerprint stability check'
$start = Replace-ExactlyOnce $start @'
      nodeVersion = $node.Version
      codexExe = $codex.Executable
'@ @'
      nodeVersion = $node.Version
      runtimeFingerprint = $runtimeFingerprint
      codexExe = $codex.Executable
'@ 'start runtime fingerprint state'
Write-Utf8NoBom $startPath $start

$tray = Get-Content -LiteralPath $trayPath -Raw -Encoding UTF8
$tray = Replace-ExactlyOnce $tray @'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

Assert-DreamSkinPort -Port $Port
$SkillRoot = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$paths = Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
'@ @'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

function Invoke-DreamSkinTrayWrite {
  param([Parameter(Mandatory = $true)][scriptblock]$Operation)
  $operationLock = Enter-DreamSkinOperationLock
  try { & $Operation } finally { Exit-DreamSkinOperationLock -Mutex $operationLock }
}

Assert-DreamSkinPort -Port $Port
$SkillRoot = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$paths = Invoke-DreamSkinTrayWrite {
  Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
}
'@ 'tray operation lock helper'
$tray = Replace-ExactlyOnce $tray @'
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
'@ @'
      Invoke-DreamSkinTrayWrite {
        Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      }
      $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
'@ 'tray apply pause write'
$tray = Replace-ExactlyOnce $tray @'
        Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
        $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
'@ @'
        Invoke-DreamSkinTrayWrite {
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
        }
        $session = Get-DreamSkinLiveSessionContext -StateRoot $StateRoot
'@ 'tray resume pause write'
$tray = Replace-ExactlyOnce $tray @'
        Set-DreamSkinPaused -Paused $true -StateRoot $StateRoot | Out-Null
        $removal = Invoke-DreamSkinLiveRemove -StateRoot $StateRoot
'@ @'
        $removal = Invoke-DreamSkinTrayWrite {
          Set-DreamSkinPaused -Paused $true -StateRoot $StateRoot | Out-Null
          Invoke-DreamSkinLiveRemove -StateRoot $StateRoot
        }
'@ 'tray pause write'
$tray = Replace-ExactlyOnce $tray @'
          $null = Set-DreamSkinActiveTheme -ImagePath $dialog.FileName -Theme $null -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
'@ @'
          Invoke-DreamSkinTrayWrite {
            $null = Set-DreamSkinActiveTheme -ImagePath $dialog.FileName -Theme $null -StateRoot $StateRoot
            Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          }
'@ 'tray image write'
$tray = Replace-ExactlyOnce $tray @'
        $saved = Save-DreamSkinCurrentTheme -Name $name -StateRoot $StateRoot
'@ @'
        $saved = Invoke-DreamSkinTrayWrite {
          Save-DreamSkinCurrentTheme -Name $name -StateRoot $StateRoot
        }
'@ 'tray save write'
$tray = Replace-ExactlyOnce $tray @'
          $null = Use-DreamSkinSavedTheme -ThemeDirectory $savedPath -StateRoot $StateRoot
          Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
'@ @'
          Invoke-DreamSkinTrayWrite {
            $null = Use-DreamSkinSavedTheme -ThemeDirectory $savedPath -StateRoot $StateRoot
            Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
          }
'@ 'tray saved theme write'
$tray = Replace-ExactlyOnce $tray @'
      Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
'@ @'
      Invoke-DreamSkinTrayWrite {
        Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
      }
      Start-DreamSkinPowerShell -Script $startScript -Arguments @('-Port', "$Port", '-PromptRestart')
'@ 'tray double click pause write'
Write-Utf8NoBom $trayPath $tray

$renderer = Get-Content -LiteralPath $rendererPath -Raw -Encoding UTF8
$renderer = Replace-ExactlyOnce $renderer @'
    "--dream-art-position",
    "--dream-focus-x",
'@ @'
    "--dream-art-position",
    "--dream-art-fill",
    "--dream-focus-x",
'@ 'renderer fill cleanup property'
$renderer = Replace-ExactlyOnce $renderer @'
    "dream-art-standard",
    "dream-focus-left",
'@ @'
    "dream-art-standard",
    "dream-art-framed",
    "dream-art-free",
    "dream-focus-left",
'@ 'renderer framing classes'
$renderer = Replace-ExactlyOnce $renderer @'
    appearance: "dark",
    accent: [108, 131, 142],
'@ @'
    appearance: "dark",
    accent: [108, 131, 142],
    average: [108, 131, 142],
'@ 'renderer default fill color'
$renderer = Replace-ExactlyOnce $renderer @'
  let samplingNativeShell = false;
  let observer = null;
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;
'@ @'
  let samplingNativeShell = false;
  let observer = null;
  let resizeObserver = null;
  const artResizeTargets = new Set();
  window.__CODEX_DREAM_SKIN_DISABLED__ = false;
'@ 'renderer resize observer state'
$renderer = Replace-ExactlyOnce $renderer @'
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      accent: safeAccent,
'@ @'
      focusY: hasNumber(art.focusY) ? clamp(art.focusY) : null,
      positionX: hasNumber(art.positionX) ? clamp(art.positionX, -1, 1) : 0,
      positionY: hasNumber(art.positionY) ? clamp(art.positionY, -1, 1) : 0,
      zoom: hasNumber(art.zoom) ? clamp(art.zoom, 1, 2) : 1,
      positionMode: ["locked", "free"].includes(art.positionMode) ? art.positionMode : "locked",
      framingEnabled: art.framingEnabled === true,
      accent: safeAccent,
'@ 'renderer framing normalization'
$renderer = Replace-ExactlyOnce $renderer @'
  const clearSkinDom = () => {
'@ @'
  const clearArtLayout = () => {
    const targets = new Set([document.body, ...document.querySelectorAll(".dream-task")]);
    const homeArt = document.querySelector(".dream-home > div:first-child > div:first-child > div:first-child");
    if (homeArt) targets.add(homeArt);
    for (const target of targets) {
      target?.style.removeProperty("--dream-art-size");
      target?.style.removeProperty("--dream-art-position");
    }
    resizeObserver?.disconnect();
    artResizeTargets.clear();
  };

  const clearSkinDom = () => {
    clearArtLayout();
'@ 'renderer surface layout cleanup'
$renderer = Replace-ExactlyOnce $renderer @'
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
'@ @'
          appearance: averageBrightness >= .58 ? "light" : "dark",
          accent: resolvedAccent,
          average: average.map((channel) => Math.round(channel)),
'@ 'renderer analyzed fill color'
$renderer = Replace-ExactlyOnce $renderer @'
    const focusY = config.focusY ?? profile.focusY;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
'@ @'
    const focusY = config.focusY ?? profile.focusY;
    const customFraming = config.framingEnabled || config.positionMode === "free" || Math.abs(config.positionX) > .0001 ||
      Math.abs(config.positionY) > .0001 || config.zoom > 1.0001;
    const appearance = config.appearance === "auto" ? detectShellAppearance() : config.appearance;
'@ 'renderer resolved position'
$renderer = Replace-ExactlyOnce $renderer @'
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    for (const value of ["left", "center", "right"]) {
'@ @'
    root.classList.toggle("dream-art-standard", profile.aspect < 1.75);
    root.classList.toggle("dream-art-framed", customFraming);
    root.classList.toggle("dream-art-free", config.positionMode === "free");
    for (const value of ["left", "center", "right"]) {
'@ 'renderer zoom state'
$renderer = Replace-ExactlyOnce $renderer @'
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
'@ @'
    root.style.setProperty("--dream-art-position", `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`);
    const average = Array.isArray(profile.average) ? profile.average : profile.accent;
    root.style.setProperty("--dream-art-fill",
      `color-mix(in oklab, rgb(${average.join(" ")}) 32%, var(--dream-canvas))`);
'@ 'renderer art position variable'
$renderer = Replace-ExactlyOnce $renderer @'
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
'@ @'
  if (previous?.scheduler?.timeout) clearTimeout(previous.scheduler.timeout);
  if (previous?.resizeListener) window.removeEventListener("resize", previous.resizeListener);
  previous?.resizeObserver?.disconnect();
  if (previous?.artUrl) URL.revokeObjectURL(previous.artUrl);
'@ 'renderer previous resize cleanup'
$renderer = Replace-ExactlyOnce $renderer @'
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
'@ @'
    if (state?.scheduler?.timeout) clearTimeout(state.scheduler.timeout);
    if (state?.resizeListener) window.removeEventListener("resize", state.resizeListener);
    state?.resizeObserver?.disconnect();
    if (state?.artUrl) URL.revokeObjectURL(state.artUrl);
'@ 'renderer resize cleanup'
$renderer = Replace-ExactlyOnce $renderer @'
  observer = new MutationObserver(() => {
'@ @'
  resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => scheduleEnsure())
    : null;
  const resizeListener = () => scheduleEnsure();
  window.addEventListener("resize", resizeListener);
  observer = new MutationObserver(() => {
'@ 'renderer resize listener'
$renderer = Replace-ExactlyOnce $renderer @'
    ensure, cleanup, observer, timer, scheduler, artUrl, profile, config, installToken, version: "1.2.0",
'@ @'
    ensure, cleanup, observer, timer, scheduler, resizeListener, resizeObserver, artUrl, profile, config, installToken, version: "1.2.0",
'@ 'renderer resize state'
$renderer = Replace-ExactlyOnce $renderer @'
  const ensure = () => {
'@ @'
  const syncArtResizeTargets = (targets) => {
    if (!resizeObserver) return;
    const next = new Set(targets.filter(Boolean));
    for (const target of artResizeTargets) {
      if (!next.has(target)) {
        resizeObserver.unobserve(target);
        artResizeTargets.delete(target);
      }
    }
    for (const target of next) {
      if (!artResizeTargets.has(target)) {
        resizeObserver.observe(target);
        artResizeTargets.add(target);
      }
    }
  };

  const applyArtSizing = (root) => {
    const customFraming = root.classList.contains("dream-art-framed");
    const layoutFor = (width, height) => {
      if (!customFraming || width <= 0 || height <= 0) return null;
      const aspect = profile.aspect > 0 ? profile.aspect : defaultProfile.aspect;
      const imageWidth = Math.max(width, height * aspect) * config.zoom;
      const imageHeight = Math.max(height, width / aspect) * config.zoom;
      const free = config.positionMode === "free";
      const rangeX = free ? (imageWidth + width) / 2 : Math.max(0, (imageWidth - width) / 2);
      const rangeY = free ? (imageHeight + height) / 2 : Math.max(0, (imageHeight - height) / 2);
      return {
        size: `${imageWidth.toFixed(2)}px ${imageHeight.toFixed(2)}px`,
        position: `${((width - imageWidth) / 2 + config.positionX * rangeX).toFixed(2)}px ` +
          `${((height - imageHeight) / 2 + config.positionY * rangeY).toFixed(2)}px`,
      };
    };
    const setLayout = (element, width, height) => {
      if (!element) return;
      const layout = layoutFor(width, height);
      if (layout) {
        element.style.setProperty("--dream-art-size", layout.size);
        element.style.setProperty("--dream-art-position", layout.position);
      } else {
        element.style.removeProperty("--dream-art-size");
        element.style.removeProperty("--dream-art-position");
      }
    };
    const tasks = [...document.querySelectorAll(".dream-task")];
    for (const task of tasks) {
      const height = root.classList.contains("dream-task-banner")
        ? Math.min(window.innerHeight * .46, 520)
        : task.clientHeight;
      setLayout(task, task.clientWidth, height);
    }
    const homeArt = document.querySelector(".dream-home > div:first-child > div:first-child > div:first-child");
    setLayout(homeArt, homeArt?.clientWidth ?? 0, homeArt?.clientHeight ?? 0);
    setLayout(document.body, document.documentElement.clientWidth, document.documentElement.clientHeight);
    syncArtResizeTargets([...tasks, homeArt, document.body]);
  };

  const ensure = () => {
'@ 'renderer art sizing function'
$renderer = Replace-ExactlyOnce $renderer @'
    shellMain.classList.toggle("dream-home-shell", Boolean(home));

    let chrome = document.getElementById(CHROME_ID);
'@ @'
    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    applyArtSizing(root);

    let chrome = document.getElementById(CHROME_ID);
'@ 'renderer art sizing call'
Write-Utf8NoBom $rendererPath $renderer

$css = Get-Content -LiteralPath $cssPath -Raw -Encoding UTF8
$cssExtension = @'

/* Custom framing is manager-owned. Legacy themes without framing values keep
   the original responsive background rules. */
html.codex-dream-skin.dream-art-framed .dream-task::before,
html.codex-dream-skin.dream-art-framed .dream-home > div:first-child > div:first-child > div:first-child,
html.codex-dream-skin.dream-art-framed:has(main.main-surface.dream-home-shell) body,
html.codex-dream-skin.dream-art-framed:is(.dream-task-ambient, .dream-task-banner):has(main.main-surface:not(.dream-home-shell)) body {
  background-position: var(--dream-art-position) !important;
  background-size: var(--dream-art-size, cover) !important;
}

html.codex-dream-skin.dream-art-free .dream-task::before,
html.codex-dream-skin.dream-art-free .dream-home > div:first-child > div:first-child > div:first-child,
html.codex-dream-skin.dream-art-free:has(main.main-surface.dream-home-shell) body,
html.codex-dream-skin.dream-art-free:is(.dream-task-ambient, .dream-task-banner):has(main.main-surface:not(.dream-home-shell)) body {
  background-color: var(--dream-art-fill, var(--dream-canvas)) !important;
}
'@
if ($css.Contains('Custom framing is manager-owned.')) {
  throw 'Cannot patch custom theme framing: CSS extension already exists.'
}
Write-Utf8NoBom $cssPath ($css.TrimEnd() + $cssExtension + [Environment]::NewLine)

foreach ($assertion in @(
  @{ Path = $injectorPath; Text = 'positionX: normalizedRange(art.positionX' },
  @{ Path = $commonPath; Text = 'Wait-Process -Id $processId -Timeout 15' },
  @{ Path = $commonPath; Text = '$exitDeadline = (Get-Date).AddSeconds(5)' },
  @{ Path = $startPath; Text = '$runtimeFingerprint = Get-DreamSkinRuntimeFingerprint' },
  @{ Path = $startPath; Text = '$currentRuntimeFingerprint = Get-DreamSkinRuntimeFingerprint' },
  @{ Path = $trayPath; Text = 'function Invoke-DreamSkinTrayWrite' },
  @{ Path = $trayPath; Text = 'Invoke-DreamSkinTrayWrite {' },
  @{ Path = $rendererPath; Text = 'const applyArtSizing = (root) =>' },
  @{ Path = $cssPath; Text = 'dream-art-free .dream-task::before' }
)) {
  if (-not (Select-String -LiteralPath $assertion.Path -SimpleMatch $assertion.Text -Quiet)) {
    throw "Custom theme framing runtime verification failed: $($assertion.Path)"
  }
}
