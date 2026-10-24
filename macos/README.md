# macOS 平台

唯一用户入口是 `Codex Dream Skin.app`，使用 AppKit/WKWebView 承载与 Windows 相同的 React UI，并运行包内 Node/core。菜单栏提供窗口与页面导航，不再维护第二套主题界面或 SwiftBar 插件。

需要 macOS 13+。源码构建需要 Node.js 22.22.2、Swift/macOS SDK，在仓库根目录执行：

```bash
npm ci
bash macos/scripts/build-app.sh
# 制作 DMG：
bash macos/scripts/build-dmg.sh
```

默认应用输出为 `build/macos/Codex Dream Skin.app`，DMG 在 `macos/release`。构建脚本准备包内 Node、共享 UI/core、平台脚本与主题，不自动运行测试。首次打开管理器会初始化内置主题。

平台脚本保留 Codex 发现、启动、CDP 连接、主题发布、原生图片转换和外观恢复。主题库、编辑、导入导出及社区流程统一使用共享 core。
用户主题位于 `~/Library/Application Support/CodexDreamSkinStudio`；部署的引擎位于 `~/.codex/codex-dream-skin-studio`。源码清理不操作这些用户目录。

## 启动环境保护

管理器发现 `HOME` 或 `CFFIXED_USER_HOME` 与 macOS 账户目录不一致，或设置了 `DREAMSKIN_PREVIEW=1` 时，仅启动只读后端，不初始化主题库，也不开放换肤、恢复、登录项等原生写操作。不要通过改写 `HOME` 为正式客户端选择另一套数据。

正式启动、重启和恢复前会核验现有 Codex 进程的数据环境；无法读取、多个实例配置不一致或自定义 profile 参数无法保留时，拒绝操作，不自动猜测目录。已有的绝对路径 `CODEX_HOME` 会保留，外观配置也从该目录读取；不会创建或搬迁项目及聊天数据库。

Codex 子进程使用核验过的 `HOME`、`CODEX_HOME` 和系统临时目录，不继承 `CFFIXED_USER_HOME`。这些保护不会修复或合并以前误建的 profile；相关目录应先保留。

## 动态主题透明度

修改当前动态主题的背景遮罩、消息气泡或面板不透明度并保存后，管理器通过现有连接更新 CSS，保留视频节点、素材 URL 和播放位置，不重新加载视频或重启 Codex。暂停的主题仍保持暂停；状态变化或连接不可用时明确显示已保存但未应用。

背景遮罩控制整张背景上方的底色，降低数值可让背景更明显。面板不透明度仅控制输入框和独立工具面板，不控制全窗口底色。未配置背景遮罩的旧主题仍使用深色 58%、浅色 64% 的原有默认值，不会因保存其他设置而写入新值。

严格热刷新要求当前运行时已加载这项能力；旧 watcher 或旧 renderer 不会因保存参数而被强行替换。应先通过管理器明确更新皮肤运行时，再测试透明度。首次加载新运行时与后续透明度保存是两个不同操作；保存失败不得自动启动客户端或重播视频。

管理器分别保留最近一次热应用与校验的 `last-hot-apply.json`、`last-hot-verify.json` 诊断，仅含退出码、皮肤版本、遮罩数值和结构校验结果，不含聊天文本、页面截图或原始错误输出。界面区分主题库已保存、应用失败与结果未确认，不将它们统称为更新成功。

使用说明见 [GUI使用说明.md](GUI使用说明.md)，签名更新通道见 [UPDATER.md](UPDATER.md)。
