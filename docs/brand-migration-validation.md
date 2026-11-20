# Dream Skin 品牌迁移验证

日期：2026-11-20。验证当前本地候选，不代表已发布新版本。

## 范围与结论

- Windows 候选：`build/DreamSkin-logo-cutout-20261120-201611/DreamSkin.exe`，产品名 Dream Skin，版本 `3.3.2`，x64。
- 用户已运行此候选，确认最终 Logo/文字外观满意，并实际成功应用皮肤；未将这项反馈外推为所有目标应用与媒体场景都通过。
- 本轮完成 Windows/共享自动回归、本地打包、旧版更新兼容、安装关闭脚本隔离验证及社区公开接口只读验证。未发现本次品牌迁移引入的产品功能缺陷。
- 独立只读复核已完成，核对测试改动、原始日志、隔离脚本与文档，未发现阻塞问题；未重复运行测试或安装器。
- macOS 构建与实机验证按用户要求暂缓；发布任何 macOS 新包前仍须单独验证。

## 已执行结果

| 项目 | 结果与覆盖范围 |
| --- | --- |
| 项目运行时 | 正式回归使用 Node.js `22.22.2`；仅对子进程前置 PATH，不修改系统配置 |
| 共享编译与 UI 类型检查 | `npm run build:core`、`npm run check:ui` 均通过 |
| 共享回归 | 60 项通过、0 失败；覆盖通信、操作状态、主题事务、Windows worker、主题包往返、社区解析/下载重试、更新验签/交接 |
| Windows 运行时回归 | 30 项通过、0 失败；覆盖媒体元数据、主题路径边界、CSS 层次、注入与 watcher 等隔离场景 |
| Windows 既有更新脚本测试 | 通过；临时 LOCALAPPDATA/TEMP，模拟下载和安装器启动，错误版本/hash/清单不进入启动边界 |
| 发布清单生成 | 25 项检查通过；运行真实生成器，核对新旧附件集合和实际字节 hash，损坏包、重复 checksum、缺兼容别名均被拒绝 |
| 清单签名验证 | 5 项检查通过；生产验签函数接受临时 Ed25519 密钥签名的真实生成清单，拒绝篡改与错钥；未读取生产私钥 |
| 旧版更新兼容 | 32 项检查通过；HEAD 旧转换器与当前转换器均从验签后的新清单及历史格式清单精确选择旧名安装器，并匹配清单、SHA256SUMS 与素材字节；历史格式清单未单独进行签名试验 |
| 安装关闭 helper | 15 项检查通过；实际运行未修改的 `packaging/windows-install.ps1`，结束临时安装目录内 6 个新/旧管理器、Node、编码 PowerShell 测试进程，保留外目录 4 个同名对照；清除测试完成回执，结束后清理测试进程 |
| Windows 安装包 | 真实 `tools/package-installer.ps1` 编译通过；ISCC 固定 hash 与官方签名检查通过，安装包产品名 Dream Skin、版本 `3.3.2` |
| Windows 便携包 | 真实 `tools/package-release.ps1` 打包通过；ZIP 的 308 个文件逐项内容 hash 与候选目录一致，校验文件匹配 |
| 社区在线读取 | 使用生产 `FixedCommunityHTTP` 和解析器读取公开列表、一个主题详情及缩略图均成功；未下载主题包或应用社区皮肤 |
| 图标与身份 | 候选 EXE 内嵌 7 帧图标与当前 ICO 一致；新名称与协议/快捷方式定义对应，数据目录、AppId、固定更新公钥及仓库地址保持兼容 |

正式 Node 回归合计 **90 项通过、0 失败**。8 项 macOS/POSIX 用例排除在本轮范围外，名称筛选省略的用例不计入 runner 的 skipped 数；未运行 macOS 专属文件。初轮 Node 24 输出仅作为失败诊断记录，不作为正式验收结果。

## 回归命令

以下命令在仓库根目录、Node `22.22.2` 环境中执行：

```powershell
npm run build:core
npm run check:ui
node --test --test-reporter=tap --test-skip-pattern="[Mm][Aa][Cc][Oo][Ss]|power observation ignores input inactivity" tests/shared-manager.test.mjs tests/shared-library-transactions.test.mjs tests/shared-library-worker.test.mjs tests/shared-community.test.mjs tests/update-manifest.test.mjs
node --test --test-reporter=tap windows/tests/theme-schema-contract.test.mjs windows/tests/theme-path-containment.test.mjs windows/tests/image-metadata.test.mjs windows/tests/payload-template-integrity.test.mjs windows/tests/injector-bootstrap.test.mjs windows/tests/injector-one-shot.test.mjs windows/tests/injector-window-readiness.test.mjs windows/tests/injector-watch-lifecycle.test.mjs windows/tests/renderer-inject.test.mjs
```

本地打包命令（输入为已构建候选，未重复构建应用）：

```powershell
.\tools\package-installer.ps1 -Version 3.3.2 -PackageRoot build\DreamSkin-logo-cutout-20261120-201611 -OutputDirectory build\brand-validation-20261120\packages -IsccPath build\.tools\InnoSetup\ISCC.exe
.\tools\package-release.ps1 -Version 3.3.2 -PackageRoot build\DreamSkin-logo-cutout-20261120-201611 -OutputDirectory build\brand-validation-20261120\packages
```

本地证据均在 `build/brand-validation-20261120/`：`node22-final-summary.log` 及对应原始日志、`installer-build.log`、`portable-build.log`、`portable-verification.json`。`windows/REPORT.md` 保存更新、签名、旧版选择与 helper 的命令和边界；Node 22 验签日志为 `windows/signing-tests-node22.log`，成功 helper 原始结果位于 `windows/helper-fixture-dc34ed2b82e84c349c27644647d68a16/results.json`。社区只读验证脚本与结果为 `community-live-smoke.mjs`、`community-live-result.json`。这些是本机生成物，不加入发布源码。

## 验证中修正的既有测试

4 处失败在迁移前 HEAD 已存在，属于旧预期或测试调用方式过期；仅修正既有测试，未为通过测试改变生产行为：

- `tests/shared-manager.test.mjs`：比较确认文案的明确字段内容，替代不再成立的原对象引用断言。
- `tests/shared-library-worker.test.mjs`：解码 PowerShell 两层编码，只拦截临时回收脚本的精确路径；保留真实回收器禁止执行的测试哨兵。
- `windows/tests/payload-template-integrity.test.mjs`：明确检查现有 accessibility/community/surfaces 三层声明顺序。
- `windows/tests/theme-path-containment.test.mjs`：保持路径越界必须拒绝，匹配现行错误文案。

## 尚未验收

- 真实 Windows 新安装、旧安装覆盖升级、卸载、系统快捷方式点击、`dreamskin://` 系统唤起及登录项。安装脚本中的身份/路径保持静态核对通过，helper 有真实隔离进程验证，但不能替代完整安装行为。
- 原因：本机没有可用的 Windows Sandbox；仅指定安装 `/DIR` 仍会写固定 HKCU 协议/卸载键与真实 Shell 目录。实际管理器还可能连接同一用户已运行实例，因此本轮未操作这些系统入口或用户数据。后续在独立 Windows 环境验证安装前后主题、参数、历史和链接均保留。
- 真实公开 Release 的生产签名、在线下载、自动覆盖升级和回滚。临时密钥/假附件证明兼容逻辑，不能代替生产发布链路。
- 全部客户端与图片、动图、H.264/HEVC 的真实解码、导入预览和播放交互。自动回归与用户的一次换肤反馈不等于这些场景均验收。
- macOS 按用户要求暂缓；未运行该平台构建、测试或实机验收。

尚未提交、推送、修改仓库名称或正式发布。历史数据、安装身份和主题协议继续按 [迁移文档](dream-skin-migration.md) 保留。
