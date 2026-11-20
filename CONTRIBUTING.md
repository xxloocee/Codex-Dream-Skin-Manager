# 参与贡献

项目只维护一套共享管理器，不保留旧 UI、旧入口或双轨兼容开关。

## 开发环境与构建

根目录执行 `npm ci`，使用 Node.js 22.22.2。Windows 安装 .NET SDK 8，运行时使用 WebView2 Evergreen；macOS 安装 Xcode Command Line Tools。

```powershell
.\build.ps1
# 需要另一个输出目录时：
.\build.ps1 -OutputRoot build\manager-local
```

```bash
bash macos/scripts/build-app.sh
bash macos/scripts/build-app.sh --output /absolute/path/Dream\ Skin.app
```

构建不自动运行测试。遵循 AGENTS.md，默认只修改源码；得到明确指示后再执行相应测试、构建或实机验证，并报告实际结果。

品牌迁移依据见 [Dream Skin 品牌迁移](docs/dream-skin-migration.md)。默认 Windows 包为 `build/DreamSkin/DreamSkin.exe`，macOS 为 `build/macos/Dream Skin.app`；历史数据目录与更新兼容名称不随显示品牌更改。

品牌源码与 Windows 本地构建、打包已完成，尚未正式发布；验证结果及 macOS 暂缓范围统一见 [品牌迁移验证记录](docs/brand-migration-validation.md)。

## 代码归属

页面和交互放 `ui/manager/`；主题、素材、导入导出、操作记录与公共业务放 `core/`；接口放 `contracts/`。壳只承担窗口、文件选择、媒体解码、系统菜单和进程通信。平台差异放 `platforms/` 及其调用的原生脚本。

公共注入资源只改 `runtime/` 和 `tools/selectors.json`，随后用 `node tools/sync-runtime-assets.mjs` 更新两端生成镜像。新增平台脚本时同步 `packaging/shared-resources.json`。打包直接使用共享源码，不继承旧包。

## 提交说明

说明解决的问题、关键改动及实际运行的验证。未运行的检查明确写出；旧报告不代表新候选通过。不提交 build、个人配置、用户主题状态或凭据。提交、push 和发布须获得明确授权。
