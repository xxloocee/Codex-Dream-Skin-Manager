# Windows 平台

唯一用户入口是 `DreamSkin.exe`。它使用 WPF/WebView2 承载共享 React UI，通过包内 Node 运行共享 core。安装版由 `packaging/CodexDreamSkinManager.iss` 创建快捷方式和 dreamskin 协议；便携版须完整解压后启动。

源码构建：在仓库根目录安装 Node.js 22.22.2、.NET SDK 8，执行 `npm ci` 后运行 `build.ps1`。输出为 `build/DreamSkin`，本机构建命令不自动运行测试。

Dream Skin 品牌迁移保留原安装目录和用户数据。安装器覆盖升级时处理原目录的新旧管理器入口；旧发布包仍使用 `CodexDreamSkinManager.exe`，新源码不会改变已下载的包。

`windows/scripts` 保留共享核心所需的平台原语：读取进程状态、发布主题、启动/连接 Codex、暂停与恢复外观、回收站和媒体解码。`platform-theme.ps1` 负责状态及应用快照发布，主题库和导入导出由共享 core 管理。旧托盘和独立脚本安装入口已移除。

管理器调用 Windows PowerShell 5.1 时使用进程级 `RemoteSigned`，通过统一入口将控制台及管道输出设为无 BOM 的 UTF-8，不修改系统代码页或用户全局执行策略。启动平台操作前，只清除应用自带 `windows/scripts/*.ps1` 的下载区域标记，不处理用户选取的文件；含中文的脚本使用 UTF-8 BOM 编码。

主题下载、包导入、去重和预设配置合成由共享 core 负责。平台启动只在活动主题缺失时初始化，并校验现有活动快照；不清除旧预设、不迁移主题库，也不在启动时重新合并库配置。

用户数据位于 `%LOCALAPPDATA%/CodexDreamSkin`，语言设置位于同目录的 `language.txt`。运行时通过本机 CDP 连接官方 Codex 客户端，不修改官方二进制。需要重启 Codex 时，界面会先请求确认。

常规操作均通过共享页面完成；后端断线可点击“重新连接”。

Windows 3.3.2 的本地构建、安装包和便携包已完成，尚未正式发布；测试结果与尚未完成的实机验收见 [品牌迁移验证记录](../docs/brand-migration-validation.md)。
