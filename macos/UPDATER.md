# Native GUI update channel

The signed native GUI channel has a separate release version (`macos/GUI_VERSION`) from the skin engine (`macos/VERSION`). Automatic installation only consumes signed `gui-v*` releases. Ordinary DMGs without a configured GUI signing channel use the existing static `update.json` check against `macos/VERSION` and offer to open the ordinary release page for manual download; they never use that fallback for automatic installation.

## Publisher setup (fork or upstream)

1. Generate a long-lived Ed25519 signing key locally and keep a secure backup. Do not commit the private key.
2. Add its PEM contents to the repository Actions secret `DREAMSKIN_GUI_SIGNING_KEY`.
3. Set `macos/GUI_VERSION`, then push `gui-v<version>` or manually dispatch `Native macOS GUI release` with the matching version.
4. The workflow builds the universal app, derives the pinned public key from the publisher secret, signs the manifest, and publishes the complete GitHub Release. The user download is `CodexDreamSkin-<version>-universal.zip` containing `Codex Dream Skin.app`. Separate architecture-labelled update archives retain the legacy `Codex Dream Skin GUI.app` root required by already-installed 0.1.x updaters; new updater code accepts either root. Updating preserves the installed application's filename.

The workflow uses `GITHUB_REPOSITORY`, so a fork and the upstream project do not share a hard-coded publisher. Each maintainer owns their release repository and private signing key. Keep the same signing key between versions; rotating it requires a separately distributed trust update.

Local build:

```bash
DREAMSKIN_UPDATE_REPOSITORY=OWNER/REPO \
DREAMSKIN_GUI_SIGNING_KEY_FILE=/absolute/private/publisher-key.pem \
bash macos/scripts/build-local-gui.sh
```

Alternatively supply `DREAMSKIN_GUI_PUBLIC_KEY` for a build machine that does not publish. Builds without publisher configuration still work and use the ordinary release check described above. No private key is copied into the app.

## Runtime

- Checks shortly after launch and every 24 hours. Unchanged/error background checks remain quiet; each new version generates one notification.
- Ordinary-release notifications offer manual download; signed GUI notifications offer verified installation. Each channel remembers its notified version separately. A failure in the configured signed channel does not fall back to an unsigned channel.
- Automatic installation only considers stable `gui-v*` releases from the configured repository. The signature and installation checks below apply to that channel.
- Ed25519 validates the exact manifest bytes. Download URLs derive from the pinned repository, version and architecture. SHA-256, size, bundle identifier, GUI version, code signature and next-version channel/key must match before installation.
- The user confirms download/install. An external helper waits for the manager to quit normally, swaps only its app bundle, retains the previous bundle, and relaunches it. Codex, engine deployment and theme data are not touched.
- A failed replacement or LaunchServices launch restores the previous bundle. A successful `open` is not proof that every later UI action is crash-free; the retained bundle enables manual rollback.
- Logs and result metadata are under `~/Library/Application Support/CodexDreamSkinStudio/updates/`.
- A writable local app parent directory is required. Apps on a mounted DMG cannot update in place.

The release workflow uses ad-hoc code signing and publisher-signed update manifests. It does not claim Apple Developer ID notarization. The initial downloaded installation may require macOS approval. There is no automatic merge of upstream source changes; maintainers review, merge and release a new GUI version.

## Validation boundary

This implementation was compiled and its scripts syntax-checked. The project instructions prohibit running tests or visual verification without a separate request, so the replacement/relaunch flow has not been exercised against the user's running app.
