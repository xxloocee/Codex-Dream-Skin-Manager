# Codex Dream Skin Manager

为 Codex 桌面客户端更换背景、管理主题和调整界面外观。Windows 和 macOS 共用一套管理界面、业务核心和换肤运行时，由各自的原生窗口承载。

## 下载与安装

当前版本：`3.1.1`。前往 [GitHub Releases](https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases) 下载对应安装包：

| 平台 | 系统要求 | 安装包 |
| --- | --- | --- |
| Windows 安装版 | Windows 10/11 x64 | `CodexDreamSkinManager-v3.1.1-windows-x64-setup.exe` |
| Windows 便携版 | Windows 10/11 x64 | `CodexDreamSkinManager-v3.1.1-windows-x64-portable.zip` |
| macOS Intel | macOS 13+ | `CodexDreamSkinManager-v3.1.1-macos-x64.dmg` |
| macOS Apple Silicon | macOS 13+ | `CodexDreamSkinManager-v3.1.1-macos-arm64.dmg` |

请先安装 Codex 桌面客户端。发布包已内置 Node.js，无需单独配置运行环境；Windows 便携版须完整解压，不能只复制 EXE。`SHA256SUMS.txt` 提供下载包校验值。

## 主要功能

两端共用以下主要功能，系统差异由平台适配层处理：

- **主题库**：浏览内置与自定义主题，按名称、标签、分类筛选，先预览再应用。
- **图片与动态背景**：支持 PNG/APNG、JPEG、WebP、GIF 和 MP4；批量导入、自动去重，导入导出 `.cdskin` 主题包。
- **外观调节**：调整背景位置、缩放、移动范围、浅深色外观和强调色；全窗口皮肤使用连续背景与统一半透明底色。面板不透明度仅控制输入框、右侧浮层、设置等独立面板，不影响侧栏、顶部菜单栏和聊天区整体底色；消息气泡不透明度另行设置。
- **主题编辑与素材保存**：编辑内置或已保存主题的参数，将原始图片或视频保存到本地。
- **启用与恢复**：应用主题、暂停/继续、重置默认主题或恢复原始外观；显示连接异常并按需恢复。
- **启动动画**：在控制台开启或关闭启动动画；选中视频主题后点击“设为启动动画”，直接复用主题视频，也可“恢复默认动画”。仅在管理器实际启动 Codex 后播放，视频静音播放一次，可跳过；切换皮肤不会触发。所选视频被删除、不可用或无法开始播放时回退内置动画，关闭开关会保留动画选择。
- **检查更新**：通过发布附件 `update.json` 检查新版本，无需 GitHub API；确认后下载、校验并启动安装程序。

**macOS**：使用相同的管理页面，另外适配菜单栏、ZIP 导入、原生媒体转换和应用更新。独立签名更新通道由发布者配置。详见 [GUI 使用说明](macos/GUI使用说明.md) 和 [更新服务部署](macos/UPDATER.md)。

## 快速上手

1. 打开管理器，选择主题查看预览，或添加自己的图片、视频。
2. 点击 **应用皮肤**。需要重启 Codex 时会先请求确认，请保存未完成的输入。
3. 在 **主题设置**中调整取景和透明度；日常可暂停/继续，异常时可重新应用主题或恢复原始外观。

“保存主题”只加入主题库，“保存并应用”才会切换当前主题。“重置皮肤”切回默认主题，“恢复原始外观”则退出换肤。

## 使用须知

- **视频与预览**：MP4 支持标准非分片 H.264/AVC、H.265/HEVC，最大 128 MiB、60 秒、60 FPS。导入保存只检查文件格式和媒体限制，无需先使用静态皮肤或连接 Codex；应用时按需建立连接并通过实际解码校验，HEVC 支持取决于设备与客户端。首次启动的解码检查既接受已呈现的视频帧，也接受读取到的实际解码像素，避免因窗口尚未绘制而误报失败。视频主题可设置 0.25×–2× 播放速度，使用单个视频元素原生循环播放；素材首尾画面不连续时，应在视频制作阶段调整衔接。管理器只显示视频封面，动图预览以首帧为主，实际背景在 Codex 中播放。Windows 内置视频随包附带按视频内容匹配的静态封面；导入视频在系统缩略图失败时使用管理器已有的 WebView2 取帧，最后尝试 PATH 中可选的 FFmpeg，不改写原视频。WebView2 不支持的编码仍可能需要 FFmpeg 才能生成封面；取帧失败代码记录在下述缓存目录的 `preview-errors.log`，不记录素材路径或内容。
- **删除主题**：内置主题素材进入回收站；“我的”主题及其本地图片会永久删除。当前活动主题和默认恢复主题不可删除。
- **预览缓存（Windows）**：图片、动图首帧和视频封面保存在 `%LOCALAPPDATA%\CodexDreamSkin\preview-cache-v1`，重开管理器继续复用；素材内容或预览尺寸变化、缓存缺失或损坏时才重新生成。先准备可见区域，再以最多 20 个缩略图任务并发准备其余主题，详情预览另留一个请求位，Windows 原生解码最多 20 个并发。缓存上限为 128 MiB／256 张，超过后淘汰较早生成的图片；缓存不可写时仍可预览，但无法持久保存。
- **兼容性**：Codex 更新可能影响换肤连接。界面仍有皮肤不代表注入器连接正常；提示需要恢复时，可先刷新状态，再重新应用主题。
- **安装提示**：Windows EXE 和安装包未商业签名，SmartScreen 可能提示未知发布者。

管理器不请求管理员权限，也不修改 Codex 官方二进制文件。Windows 底层运行时与故障排查见 [Windows 运行时说明](windows/README.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 从源码构建

需要 Node.js 22.22.2（含 LICENSE）并先在仓库根目录执行 `npm ci`。
Windows 另需 .NET SDK 8 和 WebView2 Runtime；macOS 需要 Xcode Command Line Tools。

```powershell
# Windows
.\build.ps1
```

```bash
# macOS
bash macos/scripts/build-app.sh
```

默认输出分别为 `build/CodexDreamSkinManager/` 和 `build/macos/Codex Dream Skin.app`。
构建入口只构建新管理器，不执行测试。已有输出时可指定新目录。

- `ui/manager/`：共享 React 页面。
- `core/` 与 `contracts/`：共享业务、状态及通信契约。
- `runtime/`：共享渲染、CDP、watcher 和媒体缓存。
- `platforms/`：平台适配；`hosts/windows/` 与 `hosts/macos/`：原生薄壳。

公共运行时修改后用 `node tools/sync-runtime-assets.mjs` 生成两端镜像。
开发说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，打包布局见 [hosts/README.md](hosts/README.md)。
3.0.0 起已切换到共享管理器入口。当前发布内容、验证范围与已知限制见 [版本说明](.github/release-notes/v3.1.1.md)。

## 致谢与许可

基于 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的换肤运行时开发，感谢上游作者及贡献者。可视化操作界面由群友“花落情已逝”基于上游项目开发。

本项目采用 [MIT License](LICENSE)，再分发须保留版权和许可证声明。第三方组件及素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
