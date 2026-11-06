# macOS application updates

When `DREAMSKIN_GUI_SIGNING_KEY` is configured, the official `v*` release workflow packages signed updates alongside the DMGs. It uses `macos/VERSION` for both the application version and updater version. The existing independent `gui-v*` channel continues to use `macos/GUI_VERSION`. Each installed app follows the repository, tag prefix, channel and public key embedded at build time.

Builds without a configured signing channel use the static `update.json` check against `macos/VERSION` and offer manual download. An old app with automatic updates disabled must be manually replaced once with a signed-channel build before it can update in the app.

## Publisher setup (fork or upstream)

1. Generate a long-lived Ed25519 signing key locally and keep a secure backup. Do not commit the private key.
2. Add its PEM contents to the repository Actions secret `DREAMSKIN_GUI_SIGNING_KEY`.
3. The public half of that same key must be stored in `packaging/update-public-key.pem`. For official releases, update the usual release metadata, including `macos/VERSION`, then publish a matching `v<version>` tag through the normal release process. `Release` requires the secret for both tag builds and manual dispatch: a missing key, a key that differs from the pinned public key, or a missing signed archive fails the release. Its manual dispatch builds the packages without publishing.
4. With the secret configured, the workflow builds separate arm64 and x64 apps and embeds the derived public key. In addition to the DMGs, it publishes `CodexDreamSkin-<version>-arm64.zip`, `CodexDreamSkin-<version>-x64.zip`, `gui-manifest.json` and `gui-manifest.sig`. Both ZIPs contain a `Codex Dream Skin.app` root. The signed manifest binds each archive's architecture, byte count and SHA-256. `SHA256SUMS.txt` and `update.json` also include the update ZIPs. The same key signs `update.json.sig`; Windows verifies it with its embedded copy of the pinned public key before selecting its exact installer and checksum entries.

The independent `Native macOS GUI release` workflow remains available: set `macos/GUI_VERSION`, then publish `gui-v<version>` or manually dispatch that workflow with the matching version. It builds a universal app and publishes `CodexDreamSkin-<version>-universal.zip`; its architecture-labelled update ZIPs contain the same universal app. It does not replace the official channel or become GitHub's latest release.

The workflow uses `GITHUB_REPOSITORY`, so a fork and the upstream project do not share a hard-coded publisher. Each maintainer owns their release repository and private signing key. Keep the same signing key between versions; rotating it requires a separately distributed trust update.

Local build for the official channel:

```bash
DREAMSKIN_UPDATE_REPOSITORY=OWNER/REPO \
DREAMSKIN_UPDATE_TAG_PREFIX=v \
DREAMSKIN_GUI_SIGNING_KEY_FILE=/absolute/private/publisher-key.pem \
bash macos/scripts/build-app.sh
```

Alternatively supply `DREAMSKIN_GUI_PUBLIC_KEY` for a build machine that does not publish. Omit `DREAMSKIN_UPDATE_TAG_PREFIX` (or set it to `gui-v`) for the independent GUI channel. No private key is copied into the app.

## Runtime

- Checks shortly after launch and every 24 hours. Unchanged/error background checks remain quiet; each new version generates one notification.
- Manual builds offer a release-page download; configured signed channels offer verified installation when the app can be replaced. Each channel remembers its notified version separately. A failure in a configured signed channel does not fall back to an unsigned channel.
- The official channel discovers the stable version through `releases/latest/download/update.json`, then fetches the signed manifest and archive from that exact `v<version>` release. It does not use the GitHub API. The independent GUI channel uses the GitHub releases API to find a stable `gui-v*` release.
- Ed25519 validates the exact manifest bytes. Download URLs derive from the pinned repository, version and architecture. SHA-256, size, bundle identifier, updater version, code signature and next-version channel/key must match before installation. Official updates also check the application version.
- Signed update ZIPs are limited to 1 GiB to accommodate the bundled themes and universal Node.js runtime. Archive downloads have a ten-minute timeout; the complete preparation process has a twenty-minute limit.
- After the user chooses download/install, the UI shows downloaded bytes and percentage, followed by verification and preparation status. Once ready, choose **Restart and update**. An external helper waits for the manager to quit normally, swaps only its app bundle, retains the previous bundle, and relaunches it. The installed application's filename is preserved. Codex, engine deployment and theme data are not touched.
- A download or verification failure before the installer starts allows **Check again and retry**. If installer startup or completion is uncertain, the UI queries the same operation instead of launching another installer. Operation identities are saved before submission; after restart, the UI queries the original installation receipt.
- A failed replacement or LaunchServices launch restores the previous bundle. A successful `open` is not proof that every later UI action is crash-free; the retained bundle enables manual rollback.
- Logs and result metadata are under `~/Library/Application Support/CodexDreamSkinStudio/updates/`.
- A writable local app parent directory is required. Apps on a mounted DMG cannot update in place.

The release workflow uses ad-hoc code signing and publisher-signed update manifests. It does not claim Apple Developer ID notarization. The initial downloaded installation may require macOS approval. There is no automatic merge of upstream source changes; maintainers review, merge and release a new GUI version.

## Validation boundary

The local baseline was built and installed for an authorized update trial. `npm run build:core`, `npm run build:ui` and both Swift architecture builds completed. `codesign --verify --deep --strict` passed; its repository, version and public key were checked, and no private signing key was found in the packaged resources. The user reported a successful in-app update from GUI 0.1.12 to 0.1.14. Forced rollback and Windows installation have not been exercised in this macOS environment.
