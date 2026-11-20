# Dream Skin for Windows

Open `DreamSkin.exe` to browse themes, import images or videos, edit appearance, and apply or restore skins. Windows and macOS share the React interface and Node business core; WPF/WebView2 provides the native window and file dialogs. Previously released packages retain their original executable name.

Download the x64 installer or portable ZIP from [GitHub Releases](https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases). The Dream Skin brand changes are complete in local source and the Windows build, but have not been officially released; published downloads retain their original names. Windows 10/11, .NET Framework 4.8 and WebView2 Evergreen Runtime are required. The package includes Node.js. Extract the complete portable package before opening the EXE. The installer creates shortcuts and registers `dreamskin://` links.

Select a theme to preview it, then choose Apply. Importing or saving a theme alone does not change Codex. The manager asks before a required Codex restart. Pause, resume, reset and restore are available in the shared interface. Use Reconnect if the backend disconnects; accepted operations are not automatically replayed.

User themes and runtime state are under `%LOCALAPPDATA%/CodexDreamSkin`; language preferences use `language.txt` in that directory. The runtime connects to official Codex over local CDP without modifying its binaries.

## Build from source

Install Node.js 22.22.2 with its LICENSE and .NET SDK 8, then run from the repository root:

```powershell
npm ci
.\build.ps1
```

The output is `build/DreamSkin`. `build.ps1` calls `hosts/windows/assemble-shared.ps1` to assemble the shared UI/core, native host, Node and platform resources directly from source. It does not run tests. Packaging uses `tools/package-release.ps1` and `tools/package-installer.ps1`.

`windows/scripts` contains platform operations for process discovery, Codex startup, theme publication, decoding and appearance restoration. Theme editing and library operations belong to `core/`; common injection code belongs to `runtime/` and is generated into platform packages.

The manager invokes Windows PowerShell 5.1 with process-scoped `RemoteSigned` and sets console and pipeline output to UTF-8 without BOM through its shared entry point. It does not change the system code page or the user's global execution policy. It removes download zone markers only from bundled `windows/scripts/*.ps1` files before platform operations; user-selected files are excluded. Scripts containing Chinese use UTF-8 with BOM.

The shared core handles downloads, package imports, deduplication and preset configuration merging. Platform startup initializes a missing active theme and validates the existing snapshot; it does not remove old presets, migrate the library or merge library settings back into the active theme.

The local Windows 3.3.2 build, installer and portable package are complete and remain unreleased. See the [brand migration validation record](../docs/brand-migration-validation.md) for test results and remaining device validation.

See [contributor instructions](../CONTRIBUTING.md) for development and verification, and [third-party notices](../THIRD_PARTY_NOTICES.md) for redistribution requirements.
