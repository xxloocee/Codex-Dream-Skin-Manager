# Dream Skin 品牌迁移

## 目标与边界

将产品品牌统一为 **Dream Skin**，保留现有功能和兼容边界。品牌源码、Windows 本地构建及发布配置已完成；仓库已更名为 [xxloocee/Dream-Skin](https://github.com/xxloocee/Dream-Skin)。v3.4.0 使用新品牌发布，由 Tag CI 构建 Windows x64 和 macOS 双架构包；macOS 实机验证继续暂缓。旧仓库地址继续作为更新协议身份，由 GitHub 重定向到新仓库。

最终 Logo 使用 [Dream Skin 品牌资源](../assets/branding/dream-skin.svg)：黑底展示居中的镂空 D 形标记，Dream 为靛紫、Skin 为紫粉；Windows EXE 与七帧 ICO 使用一致的 Logo。

## 当前功能与代码归属

| 功能 | 主要代码 |
| --- | --- |
| 控制台、目标应用切换、连接状态、应用/暂停/继续/重置/恢复皮肤 | `ui/manager/src/main.tsx`、`ApplicationTarget.tsx`，`core/runtime-*`、`apply-worker.mts`，`platforms/` |
| 本地主题库、分类筛选、预览、参数编辑与保存 | `ui/manager/src/Theme*.tsx`、`ClaudeAppearancePanel.tsx`，`core/theme-*`、`library-*` |
| 图片/动图/MP4 导入、去重、原素材保存、`.cdskin` 导入导出 | `ui/manager/src/ImportPanel.tsx`、`PackagePanel.tsx`，`core/source-snapshots.mts`、`package-*`、`media-resources.mts` |
| 社区浏览、搜索、排序、下载应用、`dreamskin://` 链接 | `ui/manager/src/Community*.tsx`，`core/community*`，`platforms/community-http.mts`、两端原生壳 |
| 启动动画、各目标独立参数与状态 | `StartupAnimationControls.tsx`，`core/startup-animation*`、`claude-service.mts`，`runtime/` 与 Windows 适配 |
| 三种界面风格、语言、目录/网站入口、操作历史与失败恢复 | `ui/manager/src/`，`core/operations.mts`、`operation-store.mts`、`maintenance*`，两端原生壳 |
| 更新检查、签名/hash 校验、下载安装与结果回执 | `core/updates.mts`，`platforms/updates.mts`、`update-manifest.mts`，`windows/scripts/check-update.ps1`、`macos/scripts/gui-*` |
| Windows/macOS 构建、安装、打包与发布 | `build.ps1`、`hosts/`、`packaging/`、`tools/package-*.ps1`、`macos/scripts/build-*`、`.github/workflows/` |

Windows 支持 Codex、Claude Desktop Code、DSH rc、DSH Next；macOS 当前支持 Codex。共享 UI/业务位于 `ui/manager/`、`core/`、`contracts/`；`runtime/` 是公共注入源，平台差异保留在 `platforms/` 和原生壳。

## 迁移清单

| 范围 | 迁移后 | 涉及文件 |
| --- | --- | --- |
| 网页与原生窗口名称、安装器产品信息 | `Dream Skin` | `ui/manager/index.html`、`hosts/windows/ManagerWindow.cs`、Windows `.csproj`、`hosts/macos/Info.plist`、`main.swift`、安装器及现行用户提示 |
| Windows 程序、默认源码构建目录 | `DreamSkin.exe`、`build/DreamSkin/` | Windows `.csproj`、`build.ps1`、`assemble-shared.ps1`、打包脚本、更新器本地 EXE 检查 |
| macOS 常规应用与 DMG | `Dream Skin.app`、`DreamSkin-v<版本>.dmg` | macOS `assemble-shared.sh`、`build-app.sh`、`build-dmg.sh` |
| 常规发布附件 | `DreamSkin-v<版本>-windows-x64-setup.exe` / `portable.zip`、`DreamSkin-v<版本>-macos-<架构>.dmg` | 安装器、打包脚本、CI、`tools/create-update-manifest.py` |
| 使用与开发说明 | 新品牌与构建入口，说明旧发布包仍使用旧名 | `README.md`、`CONTRIBUTING.md`、`hosts/README.md`、现行平台使用/更新说明 |

## 必须保留的兼容边界

- **用户数据与安装身份**：保留 Windows `%LOCALAPPDATA%\CodexDreamSkin`、默认安装目录 `%LOCALAPPDATA%\Programs\CodexDreamSkinManager`、AppId `{A4A6B717-9DB4-4C21-9AF1-7F9EA5D2CF5E}`；保留 macOS `~/Library/Application Support/CodexDreamSkinStudio`、部署目录及 Bundle ID `cc.dreamskin.manager`。不搬移主题、缓存、参数、历史记录或登录项标识。
- **Windows 旧版更新**：旧客户端只认 `CodexDreamSkinManager-v<版本>-windows-x64-setup.exe`。发布流程将新安装器复制为该旧名附件，一起进入 `SHA256SUMS.txt` 与签名 `update.json`；更新器继续使用此兼容名称。安装退出 helper 同时识别新旧 EXE，仅作用于目标安装目录；安装器清理该目录旧 EXE 和旧品牌快捷方式，协议入口改指新 EXE。
- **macOS 旧版更新**：签名更新 ZIP 继续使用 `CodexDreamSkin-<版本>-<架构>.zip`，内层继续为 `Codex Dream Skin.app`，满足旧版清单与路径校验。常规 DMG 内使用 `Dream Skin.app`；独立 `gui-v*` 通道的 `DreamSkin-<版本>-universal.zip` 也使用新名称，该归档不属于 v3.4.0 附件。常规包与更新载荷复用构建，内部品牌均为 Dream Skin。自动更新仍替换原有安装路径，不强行更名旧 `.app` 路径。手动升级应退出旧应用并替换原安装，避免保留同 Bundle ID 的两份应用；不自动扫描或删除其他应用。
- **更新信任**：公开仓库为 `xxloocee/Dream-Skin`，签名清单、更新检查常量及 macOS `channel.repository` 继续使用旧 `xxloocee/Codex-Dream-Skin-Manager`。两条 macOS 发布工作流固定此更新身份，避免跟随 `github.repository` 更名而使旧客户端拒绝新包；上传 Release 仍使用实际新仓库。保留版本递增规则、标签、清单格式、公钥与签名/hash 校验。重定向只处理网络传输，签名内容中的旧 URL 不变；不要在旧路径另建仓库或单独改写清单 URL。历史更新测试保留旧身份。
- **社区与主题**：保留 `https://api.dreamskin.cc`、`dreamskin://`、主题 ID、`.cdskin`/ZIP 格式、Skin API 及能力声明。保留现有网络 User-Agent，避免将品牌改名扩大为服务端兼容变更。
- **内部与上游**：不全局替换 `Codex`。真实目标应用的进程名、路径、选择器、注入标记、脚本/包内部标识、图标源文件名保持稳定；上游来源、版权、第三方许可及历史发布记录保留原文。本轮不修改公共运行时，因此无需生成两端镜像。

## 实施与验收

1. 写入本文；按清单修改品牌、构建入口、安装与发布配置，再同步现行文档及受影响的已有测试预期。
2. 独立静态审查新旧名称引用、CI 附件集合、更新清单、安装退出/快捷方式及 macOS ZIP 根目录的一致性。
3. 已执行 Windows 本地构建与相应验证；逐项结果见 [品牌迁移验证记录](brand-migration-validation.md)。真实安装、升级、协议链接、登录项和主题保留尚有验收缺口，源码审查、本地打包和一次皮肤应用不能代替这些结果。macOS 实机验证按用户要求暂缓；v3.4.0 正式包由 Tag CI 构建并核对附件。
4. 已提交推送品牌代码并更名仓库，同步公开链接与本地 `origin`；本次按用户授权发布 v3.4.0。回退使用迁移前源码重新构建；迁移不改用户数据格式，无数据反向迁移。

## 状态

- 已完成：功能梳理、迁移范围与兼容方案；品牌源码、构建/安装/发布配置和现行文档迁移，已提交推送并更名仓库。品牌发布版本为 v3.4.0，README 下载表使用新附件名称，旧版自动更新附件继续保留；正式构建和附件以该 Tag 的 Actions 与 Release 为准。
- Windows：版本 3.3.2 构建通过，最终 Logo 候选位于 `build/DreamSkin-logo-cutout-20261120-201611/`，入口 `DreamSkin.exe`。新 EXE 与七帧 ICO 的 Logo 一致。用户运行该候选，确认界面满意并成功应用皮肤；不将该反馈外推为全部目标、导入、视频或升级已验收。
- 自动化与打包：Node.js 22.22.2 回归 90/90（共享 60、Windows 30）、core 与 UI 检查通过；更新、清单、签名、转换器选择及安装退出 helper fixture 检查通过。修正四处既有测试预期或 fixture，生产逻辑未因此改变。官方 ISCC 本地安装包构建成功；便携包 308 个文件的内容哈希及 sidecar 与候选匹配。生产社区接口只读列表、详情、缩略图及生产解析验证通过，未下载或应用社区包。具体命令、日志和覆盖范围统一见 [品牌迁移验证记录](brand-migration-validation.md)。
- 未验收：机器无 Windows Sandbox，未运行真实安装/卸载、HKCU 协议注册与唤起、快捷方式点击或线上生产自动升级；隔离 fixture 与本地打包不替代这些结果。
- 暂缓：macOS 实机验证；迁移阶段未做本地 macOS 构建，v3.4.0 的双架构正式构建交由 Tag CI。
- 后续阶段：补齐记录中尚未完成的安装、升级与发布验收。仓库更名已完成，旧更新身份继续保留；如需彻底移除旧 URL，须另行设计客户端与签名清单的过渡版本。
