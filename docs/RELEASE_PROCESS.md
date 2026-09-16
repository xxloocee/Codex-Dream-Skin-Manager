# 版本发布清单

**每次发布前必须完整阅读本文，并按顺序执行。** 请把清单复制到本次发布记录中逐项确认；任一必需项未完成时，停止发布，不得推送 Tag。

## 1. 先确认发布模式

当前自动发布流程只支持以下资产：

- `CodexDreamSkinManager-vX.Y.Z-windows-x64-setup.exe`
- `CodexDreamSkinManager-vX.Y.Z-windows-x64-portable.zip`
- `CodexDreamSkinManager-vX.Y.Z-macos-universal.dmg`
- `SHA256SUMS.txt`

目标四架构流程启用后，改为发布：

| 平台 | 架构 | 文件名 |
|---|---|---|
| macOS | Apple Silicon / ARM64 | `CodexDreamSkinManager-vX.Y.Z-macos-arm64.dmg` |
| macOS | Intel / x64 | `CodexDreamSkinManager-vX.Y.Z-macos-x64.dmg` |
| Windows | ARM64 | `CodexDreamSkinManager-vX.Y.Z-windows-arm64-setup.exe` |
| Windows | x64 | `CodexDreamSkinManager-vX.Y.Z-windows-x64-setup.exe` |
| 全平台 | 校验清单 | `SHA256SUMS.txt` |

四架构改造完成前必须使用当前模式。不得把 universal DMG 或 Windows x64 包重命名成其他架构。便携包可以继续作为额外资产，但不能代替安装包，并且必须写入 `SHA256SUMS.txt`。

## 2. 发布前准备

### 2.1 确定版本

版本必须使用 `X.Y.Z`，Tag 必须使用 `vX.Y.Z`。同步更新：

- `src/AssemblyInfo.cs`
- `windows/VERSION`
- `macos/VERSION`
- `macos/package.json`
- `windows/scripts/injector.mjs`
- `macos/scripts/injector.mjs`
- `macos/scripts/common-macos.sh`
- `README.md` 中的当前版本和下载文件名
- 包含旧版本号或旧资产名的测试

检查旧版本残留，逐项判断；历史发布说明中的旧版本通常应保留：

```powershell
$OldVersion = '1.6.0' # 替换为上一正式版本
rg -n --fixed-strings -e $OldVersion -e "v$OldVersion" README.md src windows macos .github tests
```

### 2.2 编写更新说明

每个版本必须在打 Tag 前创建 `.github/release-notes/vX.Y.Z.md`。当前流水线只检查文件是否存在，内容必须人工评审，并满足以下要求：

- 使用中文，面向普通用户；
- 说明主要更新、修复和兼容性变化；
- 列出本次实际发布的安装包；
- 说明升级步骤、已知问题和规避方式；
- 提供上一正式版本到本版本的比较链接；
- 不得保留 `TODO`、`待补充`或占位链接。

模板：

```markdown
# Codex Dream Skin Manager vX.Y.Z

一句话概括本次版本。

## 主要更新

- ...

## 修复与兼容性

- 无。

## 安装包

- 按第 1 节选定的发布模式逐项列出实际文件名和适用架构。

## 升级说明

- ...

## 已知问题

- 无。

**完整变更记录**：https://github.com/xxloocee/Codex-Dream-Skin-Manager/compare/v上一版本...vX.Y.Z
```

### 2.3 发布前检查

- [ ] 发布提交已经进入 `origin/main`，工作区没有无关改动。
- [ ] 版本文件、README 和更新说明中的版本一致。
- [ ] 常规 Build、跨平台运行时检查和发布相关测试通过。
- [ ] LICENSE、第三方 NOTICE 和素材授权检查完成。
- [ ] GitHub 上不存在同名 Tag 和 Release。
- [ ] 本次发布已获得推送 Tag 和创建 Release 的授权。

## 3. 构建与发布

### 3.1 当前模式

当前 `.github/workflows/release.yml` 是唯一正式发布入口。推送 Tag 后，它会构建 Windows x64 Setup、Windows x64 Portable、macOS universal DMG，生成 `SHA256SUMS.txt`，并创建 GitHub Release。

四项资产必须来自同一个提交。任一任务失败时停止发布，不得手工上传来源不明的本地产物补齐。

### 3.2 启用四架构模式的条件

只有以下条件全部满足，才能切换到四架构资产：

- Windows 构建和安装脚本支持受限的 `x64`/`arm64` 参数，并分别携带匹配架构的 Node.js；
- Inno Setup 配置、安装/卸载测试和应用内更新均能识别 Windows 架构；
- macOS 分别使用 `DREAMSKIN_ARCHS=arm64` 和 `DREAMSKIN_ARCHS=x86_64` 构建，且 `lipo -archs` 只报告目标架构；
- GitHub Actions 使用四架构矩阵，在对应架构设备完成安装或启动烟雾测试；
- `publish` 作业发现目标 Release 已存在时失败，不再使用 `--clobber` 覆盖已发布资产。

### 3.3 发布 Tag

全部检查通过并取得授权后，由维护者在本次发布提交上执行：

```bash
git tag -a vX.Y.Z -m "Codex Dream Skin Manager vX.Y.Z"
git push origin vX.Y.Z
```

Tag 推送会触发正式发布。Tag 不得复用、移动或强制覆盖。当前工作流仍包含 `--clobber` 分支，因此已经成功发布的 Tag 禁止重新运行 `publish` 作业。

## 4. 发布后检查

- [ ] Release 标题、Tag 和中文更新说明正确。
- [ ] 资产名称和数量符合第 1 节选定的模式，没有空文件或重复文件。
- [ ] 下载所有资产和 `SHA256SUMS.txt`，重新校验 SHA-256。
- [ ] 安装包内应用版本和运行时版本均为 `X.Y.Z`。
- [ ] Windows 安装、启动、检查更新和卸载通过。
- [ ] macOS DMG 可挂载，应用可启动；四架构模式下分别核对 `arm64` 和 `x86_64`。
- [ ] 每个安装包的 Release 下载地址可访问。
- [ ] 保存 CI 链接、校验摘要和烟雾测试结果。

校验清单格式必须是“小写 SHA-256、两个空格、文件名”。在包含下载资产的目录执行：

```bash
sha256sum --check SHA256SUMS.txt
```

当前 macOS 应用仅使用 ad-hoc codesign，没有 Developer ID 签名或 Apple 公证；Windows 安装包也没有商业代码签名。发布说明不得声称安装包已经过受信任签名或公证。

## 5. 发布失败时

- Tag 推送前发现问题：修复并重新执行发布前检查。
- 构建任务部分失败：停止发布，不得发布残缺资产。
- Release 已公开后发现文件名、摘要或程序错误：保留原 Tag，发布递增的补丁版本。
- 不得通过 `--clobber` 静默替换用户可能已经下载的同名资产。
- 发现安全或数据损坏风险：先按权限流程停止自动更新或撤下受影响资产，再发布修复版本。
