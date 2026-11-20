# Dream Skin

<p align="center">
  <img src="assets/branding/dream-skin.svg" width="160" alt="Dream Skin Logo">
</p>

<p align="center"><strong>为 AI 桌面客户端换上喜欢的背景，集中管理主题与界面外观。</strong></p>

<p align="center">
  <a href="#下载与安装">下载安装</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#主要功能">主要功能</a> ·
  <a href="#平台支持">平台支持</a> ·
  <a href="#使用须知">使用须知</a> ·
  <a href="#从源码构建">源码构建</a>
</p>

支持 Codex；Windows 版还支持 Claude Desktop 的 Code 页面、DSH rc（社区版 DeepSeek Harness）及 DSH Next。Windows 和 macOS 共用管理界面、业务核心和 Codex 换肤运行时，由各自的原生窗口承载。

## 下载与安装

**当前已发布版本：`3.3.2`** · [前往 GitHub Releases 下载](https://github.com/xxloocee/Dream-Skin/releases)

| 选择版本 | 系统要求 | 已发布安装包 |
| --- | --- | --- |
| Windows 安装版 | Windows 10/11 x64 | `CodexDreamSkinManager-v3.3.2-windows-x64-setup.exe` |
| Windows 便携版 | Windows 10/11 x64 | `CodexDreamSkinManager-v3.3.2-windows-x64-portable.zip` |
| macOS Intel | macOS 13+ | `CodexDreamSkinManager-v3.3.2-macos-x64.dmg` |
| macOS Apple Silicon | macOS 13+ | `CodexDreamSkinManager-v3.3.2-macos-arm64.dmg` |

- **先安装目标客户端**：Codex、Claude Desktop、DSH rc 或 DSH Next。
- **无需另装 Node.js**：发布包已内置运行环境。
- **便携版完整解压后运行**：不能只复制 EXE。
- **下载校验**：使用发布页中的 `SHA256SUMS.txt` 核对文件。

> [!NOTE]
> Dream Skin 品牌源码与本地 Windows 构建已完成，品牌新版尚未正式发布。上表保留已发布附件的原名称；原有主题和设置继续使用现有数据目录。

<details>
<summary>品牌迁移后的程序名称与发布包命名</summary>

| 项目 | 迁移后的名称 |
| --- | --- |
| Windows 入口 | `DreamSkin.exe` |
| macOS 常规应用 | `Dream Skin.app` |
| Windows 安装包 | `DreamSkin-v3.3.2-windows-x64-setup.exe` |
| Windows 便携包 | `DreamSkin-v3.3.2-windows-x64-portable.zip` |
| macOS Intel 安装包 | `DreamSkin-v3.3.2-macos-x64.dmg` |
| macOS Apple Silicon 安装包 | `DreamSkin-v3.3.2-macos-arm64.dmg` |

以上以当前源码版本举例，**不表示这些新名称的附件已经可下载**。旧客户端所需的更新附件名称继续保留兼容。

Logo 使用居中的镂空 D 形标记，Dream 为靛紫、Skin 为紫粉。

- [品牌迁移说明](docs/dream-skin-migration.md)：迁移范围与代码清单。
- [品牌迁移验证记录](docs/brand-migration-validation.md)：Windows 本地构建与验证结果、macOS 暂缓范围。

</details>

## 快速上手

1. **选择应用与主题**：打开管理器，在左侧选择目标应用；选择主题查看预览，或导入自己的图片、视频。
2. **应用皮肤**：点击 **应用皮肤**。需要重启 Codex 时会先请求确认，请保存未完成的输入。
3. **调整与日常使用**：在 **主题设置** 中调整取景和透明度；日常可暂停/继续，异常时可重新应用主题或恢复原始外观。

### 几个按钮的区别

| 操作 | 作用 |
| --- | --- |
| 保存主题 | 只加入主题库 |
| 保存并应用 | 保存并切换当前主题 |
| 重置皮肤 | 切回默认主题 |
| 恢复原始外观 | 退出换肤 |

## 主要功能

Windows 与 macOS 的 Codex 管理共用以下功能，系统差异由平台适配层处理。

| 功能 | 可以做什么 |
| --- | --- |
| **本地主题库** | 浏览内置与自定义主题，按名称、标签、分类筛选，先预览再应用 |
| **社区主题库** | 在软件内浏览、搜索、筛选和下载 [DreamSkin 社区主题](https://dreamskin.cc/gallery) |
| **图片与动态背景** | 使用 PNG/APNG、JPEG、WebP、GIF、MP4；批量导入、自动去重，导入导出 `.cdskin` 主题包 |
| **外观调节** | 调整背景位置、缩放、移动范围、浅深色外观、强调色与透明度 |
| **主题编辑与素材保存** | 编辑内置或已保存主题的参数，将原始图片、视频保存到本地 |
| **启用与恢复** | 应用、暂停/继续、重置默认主题、恢复原始外观，并按需恢复异常连接 |
| **启动动画** | 使用默认动画或主题视频，开启、关闭或恢复默认选择 |
| **检查更新** | 从发布附件检查新版本；Windows 验签后下载安装，已启用签名通道的 macOS 支持重启更新 |

### 社区主题怎么用

- **找主题**：按名称或作者搜索，按最新、下载热度或收藏数排序，筛选浅深色并翻页。
- **看详情**：查看背景预览、作者、许可和支持平台。
- **应用主题**：点击后下载并应用；已经下载时直接使用本地副本。
- **区分来源**：社区下载不会进入“我的”；卡片显示“已下载”标记，重开后恢复。

当前社区功能不包含账号、收藏写入、评论或投稿。

### 透明度怎么调

| 设置 | 影响范围 |
| --- | --- |
| 全窗口皮肤 | 连续背景与统一半透明底色 |
| 面板不透明度 | 输入框、右侧浮层、设置等独立面板；不影响侧栏、顶部菜单栏和聊天区整体底色 |
| 消息气泡不透明度 | 单独调整消息气泡 |

### 启动动画什么时候播放

在控制台开启启动动画；选中视频主题后点击 **设为启动动画**，即可复用主题视频，也可 **恢复默认动画**。

- **Codex**：仅在管理器实际启动 Codex 后播放，静音播放一次，可跳过；切换皮肤不会触发。
- **DSH rc / DSH Next**：管理器实际启动或重启所选 DSH 后，在背景应用成功后尝试播放一次已启用的动画。
- **选择失效时**：视频被删除、不可用或无法开始播放时，回退内置动画。
- **关闭开关时**：保留动画选择。

### 更新如何进行

通过发布附件 `update.json` 检查新版本，无需 GitHub API。

| 平台 | 更新方式 |
| --- | --- |
| Windows | 用内置公钥验证 `update.json.sig`，下载并校验安装包，再启动安装程序 |
| macOS 正式签名通道 | 显示下载进度，校验后点击 **重启并更新**，自动替换应用并保留旧应用供恢复 |
| macOS 未配置签名通道的源码构建 | 提供手动下载 |

尚未启用签名通道的 macOS 旧版，需要先手动安装一次。

## 平台支持

| 目标应用 | Windows | macOS |
| --- | --- | --- |
| Codex | 支持 | 支持 |
| Claude Desktop · Code 页面 | 支持 | 暂不支持 |
| DSH rc | 支持 | 暂不支持 |
| DSH Next | 支持 | 暂不支持 |

Windows 中在左侧图标切换目标应用。各应用共用主题与素材，分别保存皮肤参数、当前状态及启动动画。

<details>
<summary>macOS：系统适配与使用文档</summary>

使用相同的管理页面，另外适配菜单栏、ZIP 导入、原生媒体转换和应用更新。发布者配置签名密钥后，正式版支持应用内下载并重启更新。

- [GUI 使用说明](macos/GUI使用说明.md)
- [更新服务部署](macos/UPDATER.md)

</details>

<details>
<summary>Claude Desktop：首次连接前需要做什么</summary>

1. 在 Claude 中通过 `Developer → Enable Main Process Debugger` 手动开启原生连接入口。
2. 打开 **Code 页面**。
3. 在管理器左侧切换到 Claude，再应用主题。

支持图片、动图、MP4，以及暂停/继续、重置与恢复。Claude 进程退出后需要重新连接应用。

Codex 专用 CSS 和消息气泡透明度不套用到 Claude。

</details>

<details>
<summary>DSH rc / DSH Next：连接、重启与动画行为</summary>

**版本识别**

- DSH rc 的鲸鱼图标带 `rc` 标记。
- DSH Next 使用彩色鲸鱼图标，不叠加文字，排在 rc 下方。
- 两个版本可以同时安装，操作仅作用于所选版本。

**连接与启动**

- 点击 **应用、重置或继续** 时，优先复用目标应用的连接。
- 未启动时自动启动；缺少主进程调试入口时会重启，并自动传入连接参数。
- 完整退出 DSH 后，再次点击 **应用、重置或继续**，可恢复背景及动画配置。
- 直接从原版快捷方式启动的新进程，不由管理器接管。

> [!WARNING]
> 重启会退出所选 DSH 应用，请先处理正在进行的任务。状态刷新、参数保存和启动动画设置不会触发自动重启。

**主题、参数与动画**

- 支持图片、动图、MP4，以及暂停、继续、重置与恢复。
- 与 Codex、Claude 共用主题和素材；两个 DSH 版本各自保存皮肤参数、当前状态、操作记录及启动动画，社区版沿用原有 DSH 配置。
- 管理器实际启动或重启 DSH 后，在背景应用成功后尝试播放一次已启用的启动动画。
- 普通换肤、参数保存和动画设置不会重播动画。

真实客户端重启、注入、动态媒体及新文档恢复尚待实机验收。

</details>

## 使用须知

### 视频格式与预览

| 项目 | 支持范围 |
| --- | --- |
| 视频格式 | 标准非分片 MP4，H.264/AVC 或 H.265/HEVC |
| 文件大小 | 最大 128 MiB |
| 视频时长 | 最长 60 秒 |
| 帧率 | 最高 60 FPS |
| 播放速度 | 0.25×–2× |
| 管理器预览 | 视频显示封面，动图以首帧为主；实际背景在 Codex 中播放 |

> [!IMPORTANT]
> 导入保存只检查文件格式和媒体限制，无需先使用静态皮肤或连接 Codex。应用时按需建立连接并进行实际解码校验；HEVC 是否可用取决于设备与客户端。

视频使用单个视频元素原生循环播放。如果首尾画面不连续，请在视频制作阶段调整衔接。

<details>
<summary>视频封面生成、解码检查与错误记录</summary>

- **首次启动解码检查**：既接受已呈现的视频帧，也接受读取到的实际解码像素，避免因窗口尚未绘制而误报失败。
- **Windows 内置视频**：随包附带与视频内容匹配的静态封面。
- **导入视频的封面**：先使用系统缩略图；失败后使用管理器已有的 WebView2 取帧，最后尝试 PATH 中可选的 FFmpeg，不改写原视频。
- **编码限制**：WebView2 不支持的编码，仍可能需要 FFmpeg 才能生成封面。
- **错误记录**：取帧失败代码记录在下述缓存目录的 `preview-errors.log`，不记录素材路径或内容。

</details>

### 删除主题

| 主题或素材 | 删除行为 |
| --- | --- |
| 内置主题素材 | 进入回收站 |
| “我的”主题及其本地图片 | **永久删除** |
| Codex 当前活动主题、默认恢复主题 | 不可删除 |
| 仅用于 Claude Desktop、DSH rc 或 DSH Next 的主题源 | 可以删除；已应用的背景副本继续保留 |

若被删除的主题源也被选为启动动画，后续启动会回退内置动画。

### 预览缓存 · Windows

缓存目录：

```text
%LOCALAPPDATA%\CodexDreamSkin\preview-cache-v1
```

图片、动图首帧与视频封面会继续复用；素材内容或预览尺寸变化、缓存缺失或损坏时才重新生成。缓存不可写时仍可预览，但无法持久保存。

<details>
<summary>缓存容量与缩略图并发策略</summary>

| 项目 | 策略 |
| --- | --- |
| 缩略图任务 | 先准备可见区域，再以最多 20 个任务并发准备其余主题 |
| 详情预览 | 另留一个请求位 |
| Windows 原生解码 | 最多 20 个并发 |
| 缓存上限 | 128 MiB／256 张，超过后淘汰较早生成的图片 |

</details>

### 兼容性与安装提示

- **连接异常**：Codex 更新可能影响换肤连接。界面仍有皮肤不代表注入器连接正常；提示需要恢复时，可先刷新状态，再重新应用主题。
- **Windows 安装**：EXE 和安装包未商业签名，SmartScreen 可能提示未知发布者。
- **权限与文件**：管理器不请求管理员权限，也不修改 Codex 官方二进制文件。

[Windows 运行时与故障排查](windows/README.md) · 安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 从源码构建

### 环境准备

| 环境 | 要求 |
| --- | --- |
| 所有平台 | Node.js 22.22.2（含 LICENSE） |
| Windows | .NET SDK 8、WebView2 Runtime |
| macOS | Xcode Command Line Tools |

先在仓库根目录安装依赖：

```bash
npm ci
```

### 构建命令

**Windows**

```powershell
.\build.ps1
```

**macOS**

```bash
bash macos/scripts/build-app.sh
```

| 平台 | 默认输出 |
| --- | --- |
| Windows | `build/DreamSkin/` |
| macOS | `build/macos/Dream Skin.app` |

构建入口只构建新管理器，不执行测试。已有输出时可指定新目录。

<details>
<summary>源码目录与公共运行时同步</summary>

| 目录 | 职责 |
| --- | --- |
| `ui/manager/` | 共享 React 页面 |
| `core/`、`contracts/` | 共享业务、状态及通信契约 |
| `runtime/` | 共享渲染、CDP、watcher 和媒体缓存 |
| `platforms/` | 平台适配 |
| `hosts/windows/`、`hosts/macos/` | 原生薄壳 |

公共运行时修改后，生成两端镜像：

```bash
node tools/sync-runtime-assets.mjs
```

</details>

- [参与贡献](CONTRIBUTING.md) · [打包布局](hosts/README.md)
- 3.0.0 起已切换到共享管理器入口；当前发布内容、验证范围与已知限制见 [版本说明](.github/release-notes/v3.3.2.md)。

## 致谢与许可

基于 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的换肤运行时开发，感谢上游作者及贡献者。可视化操作界面由群友“花落情已逝”基于上游项目开发。

本项目采用 [MIT License](LICENSE)，再分发须保留版权和许可证声明。第三方组件及素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
