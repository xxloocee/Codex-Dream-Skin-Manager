# 原生宿主与默认打包

Windows 的 WPF/WebView2 与 macOS 的 AppKit/WKWebView 加载相同的 `ui/manager` 静态页面。
壳启动包内 Node，通过标准输入输出的 NDJSON 与 `core` 通信，不另开 HTTP 服务。窗口、系统菜单、原生文件选择和解码留在壳中，业务逻辑在共享核心。

## 构建入口

先在根目录执行 `npm ci`。Windows 运行 `build.ps1`（内部调用 `hosts/windows/assemble-shared.ps1`），macOS 运行 `bash macos/scripts/build-app.sh`（内部调用 `hosts/macos/assemble-shared.sh`）。
Windows 需要 .NET SDK 8、Node 22.22.2 及其 LICENSE；macOS 需要 Swift/macOS SDK，构建时准备包内 Node。

Windows 默认包位于 `build/DreamSkin`，启动根目录 `DreamSkin.exe`。
macOS 默认包位于 `build/macos/Dream Skin.app`，直接打开应用。`build-dmg.sh` 将新应用装入 DMG。
两个系统统一使用 `dreamskin://` 协议。后端断开时，共享页面提供“重新连接”，重新建立会话且不自动重放操作。

用户数据目录、Windows 安装路径/AppId 和 macOS Bundle ID 保留。签名更新 ZIP 的旧名目录属于旧客户端兼容协议，详见 [品牌迁移说明](../docs/dream-skin-migration.md)。

## 包内布局

```text
Windows 包根 / macOS Contents/Resources
  shared/             编译后的 core、contracts、platforms
  ui/manager/         共用的静态 UI
  runtime/node/       业务核心的 Node
  windows/ 或 macos/  平台脚本、资源、预设与运行时 Node
  THIRD_PARTY/        分发许可证
```

macOS 可执行文件在 `Contents/MacOS/DreamSkinSharedHost`；首次启动初始化内置主题。
公共运行时由 `runtime/` 生成到两端，平台资源清单为 `packaging/shared-resources.json`。
品牌迁移的 Windows 本地构建与打包结果见 [品牌迁移验证记录](../docs/brand-migration-validation.md)。v3.4.0 正式包由 Tag CI 构建 Windows x64 和 macOS 双架构；macOS 实机验收继续暂缓。
