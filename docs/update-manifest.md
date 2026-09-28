# 静态更新清单

## 目标与范围

本清单通道检查更新时只读取 GitHub Release 静态附件，不再请求 GitHub REST API。Windows 保留版本比较、安装包 URL 白名单、SHA-256 校验和安装确认；macOS 保留打开发布页手动下载的行为。

macOS 普通 DMG 未配置独立 GUI 签名通道时，原生管理器的手动和后台检查均复用此静态清单入口，并按内置 `macos/VERSION` 比较版本。用户确认后仅打开发布页下载 DMG。已配置的 `gui-v*` 签名通道继续使用其独立更新机制，不因签名通道检查失败而回退到本通道。

固定入口：

```text
https://github.com/xxloocee/Codex-Dream-Skin-Manager/releases/latest/download/update.json
```

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

清单不包含自身的校验值。Windows 安装包的 hash 必须同时与 `update.json`、`SHA256SUMS.txt` 和下载内容一致；版本确认和下载前后校验继续生效。

## 生成与发布

1. Release 工作流等待 Windows x64、macOS x64/ARM64 构建完成。
2. 校验四个包的文件名集合，生成 `SHA256SUMS.txt`。
3. `tools/create-update-manifest.py` 核对包内容与校验清单一致，生成 `dist/update.json`。
4. 将四个包、校验清单和 `update.json` 一同上传到对应 Release。

生成器只接受稳定版本标签，不访问网络。`update.json` 和安装包绑定同一标签，避免检查后新版本发布导致混用附件。客户端安装前仍重新检查版本；版本发生变化时要求重新检查更新。

## 首次上线与失败处理

- 新代码需要随含 `update.json` 的版本发布。旧版客户端不会自动获得新检查逻辑；遇到 API 限流的旧客户端首次升级需手动下载。
- 现有 v1.7.9 没有此附件。本次代码修改不补传旧 Release，也不触发发布。
- Windows 下载清单失败时报告错误并给出发布页地址，不回退 API，也不把网络失败当作“已是最新版”。
- macOS 清单下载失败时保留发布页面跳转的备用检查，只提取稳定版本标签并打开发布页，不通过备用路径自动下载安装包。
- 清单格式或 Windows 下载校验异常时终止操作。

## 实施记录

本次修改客户端获取入口、发布清单生成与文档，并给已有 macOS 数据夹具补充清单字段；不修改版本号，不新增测试。遵循项目要求，不运行本地测试、构建或可视化验证；上线后的附件跳转与安装流程需在发布后验收。

独立静态审查已完成：补齐 macOS 清单格式、稳定发布状态和规范标签检查后，复查未发现阻塞缺陷。该结论不代表真实网络下载、CI 生成或安装流程已经验证。

CatPaw 状态读取发现四个已有看板错误及不相关的 FR-004。本任务不修复该看板，范围与实施记录保留在本文档中。
