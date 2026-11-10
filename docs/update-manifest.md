# 静态更新清单

## 目标与范围

本清单通道检查更新时只读取 GitHub Release 静态附件，不再请求 GitHub REST API。Windows 先在 Node 侧用内置 Ed25519 公钥验证 `update.json.sig`，再复用 PowerShell 的版本比较、安装包 URL 白名单、SHA-256 校验和安装确认。macOS 已配置的正式签名通道继续校验 `gui-manifest.sig` 并支持应用内更新；未配置签名通道的源码构建仍提供手动下载。

macOS 普通 DMG 未配置独立 GUI 签名通道时，原生管理器的手动和后台检查均复用此静态清单入口，并按内置 `macos/VERSION` 比较版本。用户确认后仅打开发布页下载 DMG。已配置的 `gui-v*` 签名通道继续使用其独立更新机制，不因签名通道检查失败而回退到本通道。

固定入口：

```text
https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases/latest/download/update.json
```

## macOS 签名更新的代理

管理器的签名更新检查与安装包下载统一经 `macos/scripts/gui-update.sh` 启动。入口优先沿用显式的 `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` 环境配置；没有这些配置时，使用 `scutil --proxy` 读取当前生效的 macOS 安全网页代理（HTTPSProxy / HTTPSPort），并在没有显式 `no_proxy` / `NO_PROXY` 时沿用系统排除主机列表。所有更新目标均为 HTTPS。

空字符串视为未配置：启动 Node 前清除空的 `https_proxy`、`http_proxy` 和 `no_proxy`，避免它们遮蔽有效的大写变量；大小写变量均非空时，小写优先。

入口启用内置 Node.js 22.22.2 的 `--use-env-proxy`，因此清单、签名、安装包以及经白名单核对的重定向请求均使用同一代理配置；没有配置代理时继续直连。此适配支持固定 HTTP CONNECT 代理，不解析 PAC，也不将仅配置的 SOCKS 代理转换为 HTTP 代理；不要求开启 TUN。代理连接失败会中止本次请求，不自动绕过代理直连。已有签名、下载大小、SHA-256 及应用身份校验继续生效。

此修复需随新版应用安装后生效，不能改变旧版中已经启动的下载连接。已使用内置 Node.js 22.22.2 在临时隔离夹具中通过 19 项审计检查，覆盖系统代理解析、大小写及空变量优先级、排除主机、IPv6、真实更新脚本的验签与重定向、下载数据完整性、代理失败停止请求及 `exec` 进程身份；另通过 Bash 语法和差异空白检查。未运行仓库完整测试、构建或真实安装验收，未更改本机代理设置及已安装应用。

## 数据格式

`schemaVersion` 为 `1`。为复用现有版本比较和附件选择逻辑，保留已有 release 字段名；这些字段来自发布流程生成的静态文件，不来自 GitHub API。

| 字段 | 内容 |
| --- | --- |
| `tag_name` | 严格的稳定版本标签 `vMAJOR.MINOR.PATCH` |
| `html_url` | 本仓库对应标签的发布页 |
| `draft` / `prerelease` | 均为 `false` |
| `assets` | 四个平台安装/便携包和 `SHA256SUMS.txt` |
| `assets[].name` | 完整附件名 |
| `assets[].browser_download_url` | 本仓库对应标签的 HTTPS 下载地址 |
| `assets[].sha256` | 附件实际内容的 64 位小写 SHA-256 |

清单不包含自身的校验值。`update.json.sig` 是原始 `update.json` 字节的 Ed25519 签名（Base64 文本）；签名与 macOS GUI 清单复用 `DREAMSKIN_GUI_SIGNING_KEY`。Windows 安装包的 hash 必须同时与已验签的 `update.json`、`SHA256SUMS.txt` 和下载内容一致；版本确认和下载前后校验继续生效。

Windows 包内 `updater/public-key.pem` 来自源码中的 `packaging/update-public-key.pem`。Node 下载 latest 清单后，仅将其中的严格版本标签用于定位同仓库、同标签的签名；验签通过后才将原始清单经 UTF-8 stdin 交给 PowerShell，PowerShell 不再重新读取未签名清单。安装前再次验签，并核对批准时的清单摘要、公钥摘要、版本及安装包 hash；任何变化均要求重新检查。缺签、错签、下载失败均停止自动更新，不回退到未签名来源。

## 生成与发布

1. Release 工作流等待 Windows x64、macOS x64/ARM64 构建完成。
2. 校验四个包的文件名集合，生成 `SHA256SUMS.txt`。
3. `tools/create-update-manifest.py` 核对包内容与校验清单一致，生成 `dist/update.json`。
4. `tools/sign-update-manifest.mjs` 使用发布私钥签出 `dist/update.json.sig`；现有脚本签出 macOS `gui-manifest.json` / `gui-manifest.sig`。
5. 将四个包、两个 macOS 更新 ZIP、校验清单和两组签名清单一同上传到对应 Release。

正式 Release 在构建前要求 Secret 存在、为 Ed25519 且与固定公钥匹配，缺失或不匹配直接失败，不再降级成未签名发布。Windows 组包复制公钥；macOS 正式通道也校对派生公钥。发布私钥不得写入源码或包。密钥轮换需要单独分发信任更新。

### Fork 发布配置

源码内置的是上游公钥，fork 不改就无法发布（Release 工作流会因密钥不匹配直接失败）：

1. 生成自己的 Ed25519 密钥：`openssl genpkey -algorithm ed25519 -out update-private.pem`，私钥妥善保管，不要提交。
2. 导出公钥覆盖 `packaging/update-public-key.pem`：`openssl pkey -in update-private.pem -pubout -out packaging/update-public-key.pem`，并提交。
3. 在 fork 仓库 Settings → Secrets 中配置 `DREAMSKIN_GUI_SIGNING_KEY`，值为私钥 PEM 全文。
4. 本地可用 `DREAMSKIN_GUI_SIGNING_KEY_FILE=update-private.pem node tools/sign-update-manifest.mjs --check-key` 确认私钥与固定公钥匹配。
5. 上述步骤只配置签名信任根。Fork 还须将 `platforms/updates.mts`、`windows/scripts/check-update.ps1`、`tools/create-update-manifest.py` 以及手动检查入口 `macos/scripts/check-update-macos.sh` 中的仓库地址改为自己的仓库；这些入口目前不会自动读取 `GITHUB_REPOSITORY`。否则 Windows 客户端仍请求上游清单，并因公钥不同而拒绝更新。

首个带签名清单的版本需要用户手动安装一次；之后才走验签更新。

生成器只接受稳定版本标签，不访问网络。`update.json` 和安装包绑定同一标签，避免检查后新版本发布导致混用附件。客户端安装前仍重新检查版本；版本发生变化时要求重新检查更新。

## 首次上线与失败处理

- 新代码需要随含 `update.json` 的版本发布。旧版客户端不会自动获得新检查逻辑；遇到 API 限流的旧客户端首次升级需手动下载。
- 现有 v1.7.9 没有此附件。本次代码修改不补传旧 Release，也不触发发布。
- Windows 下载清单失败时报告错误并给出发布页地址，不回退 API，也不把网络失败当作“已是最新版”。
- macOS 清单下载失败时保留发布页面跳转的备用检查，只提取稳定版本标签并打开发布页，不通过备用路径自动下载安装包。
- 清单格式或 Windows 下载校验异常时终止操作。
- Windows 错误分两类提示：连接失败、超时、HTTP 5xx/429 提示“无法连接 GitHub”；缺签名附件（4xx）、签名不符、格式或主机不合法提示“签名或格式校验失败”。两类都不自动安装。
- 旧的独立入口 `windows/scripts/check-update.ps1` 不做 Ed25519 验签，因此只检查版本并打开发布页；`-Install` 直接报错，安装只能经管理器的验签流程。
- 已发布旧版不会因配置 Secret 自动获得新逻辑。Windows 本次修改及 macOS 已实现的签名通道须随新版本发布后生效；新客户端访问没有签名附件的旧 Release 会拒绝自动更新，可手动下载。此项源码修改不补传旧 Release、不触发发布。

## 实施记录

本次修改客户端获取入口、发布清单生成与文档，并给已有 macOS 数据夹具补充清单字段；不修改版本号。签名验证另有 `tests/update-manifest.test.mjs` 覆盖（有效签名、篡改、错钥、缺签、网络错误、越界重定向、非稳定版本）。遵循项目要求，不运行本地测试、构建或可视化验证；上线后的附件跳转与安装流程需在发布后验收。

独立静态审查已完成：补齐 macOS 清单格式、稳定发布状态和规范标签检查后，复查未发现阻塞缺陷。该结论不代表真实网络下载、CI 生成或安装流程已经验证。

## 共享管理器迁移（P4-D，源码已写，未验证）

共享核心统一稳定版本比较、五分钟批准提案、明确下载批准和独立更新操作记录。Windows 继续使用本清单与原安装器流程，下载前额外核对用户批准的版本和 installer SHA-256；任何变化都要求重新检查和批准，原三方 hash、大小和路径检查保留。

共享预览包使用独立安装身份，只提供对应版本发布页，不用正式版安装器覆盖预览。macOS 普通发布继续手动下载；独立签名 GUI 通道使用其配置仓库和公钥，签名失败不回退普通通道。后台检查失败保持安静，不自动下载安装。安装器启动不等于安装成功，未知结果只查询原记录，不自动重装。

本次迁移未执行网络检查、下载、安装、构建、测试或独立检查，原实施记录中的历史审查不覆盖 P4-D 新增范围。

## 2026-11 更新签名收敛

Windows 签名验签及正式发布缺钥失败的实现以本节为准。上面的实施记录与迁移说明保留历史事实，不代表本次候选的验证结果。此次只配置发布 Secret 和修改源码，不运行真实用户更新、不进行发布，验证范围见交付记录。

## macOS 下载完成后的重启交接

下载、验签和应用身份校验完成后，任务进入 `readyToRestart`，保留当前会话内的暂存包，不启动安装器，也不开始等待退出的 120 秒计时。点击“重启并更新”后才记录交接意图并启动安装器；原生壳收到启动确认后正常退出。安装器仍在替换前校验应用，保留旧版备份，且不会强制结束管理器或 Codex。

重复点击或重试同一重启请求不会启动第二个安装器。明确的启动前失败会恢复待重启状态，可复用下载包再次重启；启动结果不明确时继续通过回执核对，不自动重放安装。页面正常自动刷新状态，仅在结果待核对或查询失败时显示“核对结果”，此按钮只读取任务及回执。

暂存交接仍绑定当前管理器会话：若未点击重启就退出整个管理器，下次打开会将该准备任务标记为未安装并允许重新检查、下载；本次不增加跨会话下载恢复。旧版已经交给安装器的历史任务继续沿用原有回执核对。等待重启期间保留现有更新忙碌保护。

## 下载进度与 Windows 结果回执

更新弹框分为版本信息、任务状态与底部操作区，按钮统一保留间距。Windows 安装包使用流式下载，通过既有进度协议上报实际接收字节，界面显示百分比和已下载/总大小；服务器未返回总大小时，只显示已下载大小和不定进度。下载完成后分别显示校验、安装准备状态，不把 100% 下载进度当作安装成功。

Windows 安装包下载期限和安装事务等待均为 30 分钟；macOS 大包下载及准备事务等待同样为 30 分钟。小型更新清单和签名检查继续使用较短的等待时间。

Windows 更新脚本把受控结果原子写入 `updates/manager-<operation ID 的 SHA-256>.json`，独立于进程通信。查询会核对任务身份和目标版本，消费超时后迟到的回执并清除旧超时错误：明确未启动安装器的失败允许重新检查并重试；已启动只标记为安装器交接；启动结果不明确时继续等待核对。安装器标准输出与错误重定向到下载目录，避免占用更新协议管道。

后续查询也核对本地 `windows/VERSION` 和管理器可执行文件，确认本地版本达到目标版本后才标记已安装。取消交互安装器不会自动重装，也不凭进程消失推断安装失败。本实现不包含增量更新、跨会话断点续传或对已安装旧客户端的直接修补，需随新包分发后生效。
