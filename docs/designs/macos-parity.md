# Windows parity pass

Scope: the current Windows MainWindow.cs controls and ThemePackageService.cs formatVersion 1 contract.

- Library: search/tag/category/source filters; catalog/name sorting; multi-file import with deduplication; clear filters.
- Actions: apply, pause/resume, reset, restore original appearance with restart confirmation, refresh, source media download, version check.
- Delete: deny active/pending/default recovery identities at UI and disk mutation; bundled presets to Trash, custom themes permanently removed after confirmation.
- Packages: bounded ZIP parser/writer for .cdskin formatVersion 1; root-only allowlisted files, size limits, CRC, duplicate/name/link checks, Safe CSS validation and existing macOS media validation. ZIP community import remains available. Metadata translates palette.accent to colors.accent.
- Editor/import: name/category/tags, appearance, accent including removal, independent focal point/position, framing toggle, range mode, zoom, safe area, task mode, bubble/surface opacity, reset/reload, save original/copy/save and apply, illustrative preview.
- Mutations: serialize with existing theme-switch shell lock; config optimistic hash check before replacement; staged media import; operation log and per-item batch results. No automatic application just by selecting a preview.
- Native platform distinction: use Mac release/update flow, Finder Trash, existing macOS engine. The upstream Mac updater does not distribute this custom GUI build.

Validation boundary: compile and package only until testing is explicitly requested. No running tests or GUI interaction in this pass.
