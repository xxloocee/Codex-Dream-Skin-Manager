"""Generate the public update.json attachment from finalized release packages."""

import argparse
import hashlib
import json
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", args.tag):
        parser.error("The release tag must be a stable vMAJOR.MINOR.PATCH version.")

    base_url = "https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases"
    package_names = [
        f"CodexDreamSkinManager-{args.tag}-windows-x64-setup.exe",
        f"CodexDreamSkinManager-{args.tag}-windows-x64-portable.zip",
        f"CodexDreamSkinManager-{args.tag}-macos-x64.dmg",
        f"CodexDreamSkinManager-{args.tag}-macos-arm64.dmg",
    ]
    checksum_path = args.directory / "SHA256SUMS.txt"
    checksums = {}
    for line in checksum_path.read_text(encoding="utf-8").splitlines():
        entry = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not entry or entry[2] in checksums:
            raise ValueError("Malformed or duplicate SHA256SUMS.txt entry.")
        checksums[entry[2]] = entry[1]
    if set(checksums) != set(package_names):
        raise ValueError("SHA256SUMS.txt must list exactly the four release packages.")

    assets = []
    for name in package_names + ["SHA256SUMS.txt"]:
        path = args.directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size <= 0:
            raise ValueError(f"Missing, empty or symlinked release asset: {name}")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        sha256 = digest.hexdigest()
        if name in checksums and checksums[name] != sha256:
            raise ValueError(f"Release checksum mismatch: {name}")
        assets.append({
            "name": name,
            "browser_download_url": f"{base_url}/download/{args.tag}/{name}",
            "sha256": sha256,
        })

    # Keep the established release fields so both platform updaters can reuse
    # their version comparison and exact asset selection contracts.
    manifest = {
        "schemaVersion": 1,
        "tag_name": args.tag,
        "html_url": f"{base_url}/tag/{args.tag}",
        "draft": False,
        "prerelease": False,
        "assets": assets,
    }
    (args.directory / "update.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
