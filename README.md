# Codex Dream Skin Manager

为 Codex 桌面客户端更换背景、管理主题和调整界面外观。Windows 提供可视化管理器，macOS 提供原生菜单栏客户端。

## 下载与安装

当前版本：`1.7.9`。前往 [GitHub Releases](https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases) 下载对应安装包：

| 平台 | 系统要求 | 安装包 |
| --- | --- | --- |
| Windows 安装版 | Windows 10/11 x64 | `CodexDreamSkinManager-v1.7.9-windows-x64-setup.exe` |
| Windows 便携版 | Windows 10/11 x64 | `CodexDreamSkinManager-v1.7.9-windows-x64-portable.zip` |
| macOS Intel | macOS 13+ | `CodexDreamSkinManager-v1.7.9-macos-x64.dmg` |
| macOS Apple Silicon | macOS 13+ | `CodexDreamSkinManager-v1.7.9-macos-arm64.dmg` |

请先安装 Codex 桌面客户端。发布包已内置 Node.js，无需单独配置运行环境；Windows 便携版须完整解压，不能只复制 EXE。`SHA256SUMS.txt` 提供下载包校验值。

## 主要功能

以下为 **Windows 管理器**的主要能力，具体以所用版本为准：

- **主题库**：浏览内置与自定义主题，按名称、标签、分类筛选，先预览再应用。
- **图片与动态背景**：支持 PNG/APNG、JPEG、WebP、GIF 和 MP4；批量导入、自动去重，导入导出 `.cdskin` 主题包。
- **外观调节**：调整背景位置、缩放、移动范围、浅深色外观和强调色；独立设置消息气泡与输入框、工具面板等背景的不透明度。
- **主题编辑与素材保存**：编辑内置或已保存主题的参数，将原始图片或视频保存到本地。
- **启用与恢复**：应用主题、暂停/继续、重置默认主题或恢复原始外观；显示连接异常并按需恢复。
- **检查更新**：通过发布附件 `update.json` 检查新版本，无需 GitHub API；确认后下载、校验并启动安装程序。

**macOS 功能有所不同**：使用菜单栏管理，支持更换背景、导入 ZIP 主题及暂停/恢复，不包含 Windows 的同款主题库和 `.cdskin` 管理界面。详见 [macOS 使用说明](macos/README.md)。

## 快速上手

1. 打开管理器，选择主题查看预览，或添加自己的图片、视频。
2. 点击 **应用皮肤**。需要重启 Codex 时会先请求确认，请保存未完成的输入。
3. 在 **主题设置**中调整取景和透明度；日常可暂停/继续，异常时可重新应用主题或恢复原始外观。

“保存主题”只加入主题库，“保存并应用”才会切换当前主题。“重置皮肤”切回默认主题，“恢复原始外观”则退出换肤。

## 使用须知

- **视频与预览**：MP4 支持标准非分片 H.264/AVC、H.265/HEVC，最大 128 MiB、60 秒、60 FPS；应用前需连接 Codex 并通过实际解码校验，HEVC 支持取决于设备与客户端。管理器只显示视频封面，动图预览以首帧为主，实际背景在 Codex 中播放。
- **删除主题**：内置主题素材进入回收站；“我的”主题及其本地图片会永久删除。当前活动主题和默认恢复主题不可删除。
- **兼容性**：Codex 更新可能影响换肤连接。界面仍有皮肤不代表注入器连接正常；提示需要恢复时，可先刷新状态，再重新应用主题。
- **安装提示**：Windows EXE 和安装包未商业签名，SmartScreen 可能提示未知发布者。

管理器不请求管理员权限，也不修改 Codex 官方二进制文件。Windows 底层运行时与故障排查见 [Windows 运行时说明](windows/README.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 从源码构建

Windows 需 Node.js 22+（安装目录包含其 `LICENSE`），使用系统自带的 .NET Framework 编译器，无需安装 .NET SDK：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -SkillRoot ".\windows"
```

该命令会执行测试并构建，产物位于 `build\CodexDreamSkinManager\`。开发与贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，macOS 构建见 [平台文档](macos/README.md)。

共享渲染代码位于 `runtime/`；修改后运行 `node tools/sync-runtime-assets.mjs`，同步到 Windows 和 macOS 的资源目录。

## 致谢与许可

基于 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的换肤运行时开发，感谢上游作者及贡献者。可视化操作界面由群友“花落情已逝”基于上游项目开发。

本项目采用 [MIT License](LICENSE)，再分发须保留版权和许可证声明。第三方组件及素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
