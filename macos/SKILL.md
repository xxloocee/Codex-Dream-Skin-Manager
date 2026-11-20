---
name: codex-dream-skin-studio
description: Manage Codex wallpapers, themes and appearance through the shared Dream Skin desktop manager on macOS.
compatibility: macOS 13+, official Codex Desktop app, bundled Node.js 22.22.2
---

# Dream Skin on macOS

The user entry is `Dream Skin.app`. Automatically updated older installations may retain the `Codex Dream Skin.app` filename. Its AppKit/WKWebView host runs the same React UI and Node core as Windows. This document describes the project; installing it as an agent skill is optional.

## Workflow

1. Download the App/DMG from the project release, move the app to a writable local location such as Applications, then open it. The package contains its own Node runtime. First launch initializes bundled presets.
2. Use the shared theme library to preview a preset or import media. Use theme settings to save parameters; saving alone does not apply a skin.
3. Import `.cdskin` packages or supported Mac ZIP packages through the manager. Core validates the archive, metadata, media and Safe CSS before publication. Original license bytes remain with the theme.
4. Apply the chosen theme. Confirm a Codex restart only when prompted. Use the displayed runtime and renderer state to assess the result; a material preview alone is not proof of successful injection.
5. Pause, resume, reset or restore the original appearance through the shared interface. Reconnect after a backend disconnect; do not replay an uncertain write operation under a new ID.

## Runtime boundaries

- Do not modify the official Codex app, `app.asar` or its signature.
- Use the package's signed Node runtime, not Codex's internal Node installation.
- CDP uses loopback and checks the owning Codex process and renderer identity.
- Preserve native navigation, project controls, tasks, composer and keyboard focus. Decoration stays non-interactive.
- Wallpaper files must not be screenshots that cover the native interface. `appearance: auto` follows Codex/system appearance.
- Retain archive traversal, links, size, format, Safe CSS, media decode and update signature checks.
- Require user confirmation for deletion and necessary Codex restarts. Stop only a watcher whose recorded identity matches.

## Source ownership

- `ui/manager`, `contracts`, `core`: shared interaction, protocol and business rules.
- `runtime`: authoritative payload, session, verification, media-cache, CDP and watcher code; platform copies are generated.
- `hosts/macos`: native window, menus, dialogs and preview decoding.
- `macos/scripts`: process discovery, engine installation, theme staging/publication, signing and appearance restoration used by platform adapters.

Build with root `npm ci` and `bash macos/scripts/build-app.sh`; `build-dmg.sh` creates the DMG. See [README](README.md), [usage](GUI使用说明.md), [updater](UPDATER.md) and [contributor instructions](../CONTRIBUTING.md). Tests, builds and live/visual acceptance require a separate request under the project rules.
