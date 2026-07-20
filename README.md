# Codex Dream Skin Manager

基于 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 开发的 Windows 便携式 WPF 管理器，为其增加主题浏览、导入、应用、暂停、重置和紧急恢复操作界面。

当前版本：`1.0.0`。项目仅支持 Windows，并以微软商店版 Codex 为目标环境。

## 项目来源与致谢

本项目复用 Codex Dream Skin 的 Windows 脚本、主题运行机制和恢复流程，并在此基础上增加可视化管理界面与主题管理能力；构建和运行边界仍以该上游项目为基础。

本软件的操作界面由群友“花落情已逝”基于上述上游项目开发。感谢 [Fei-Away](https://github.com/Fei-Away) 及 Codex Dream Skin 的所有贡献者提供底层换肤能力，也感谢“花落情已逝”完成本项目的可视化操作体验。

## 功能

- 浏览 31 套内置主题和已保存主题，支持名称、标签、分类、来源与排序筛选。
- 单击主题只更新预览；“应用选中主题”才会切换活动主题。
- 批量导入最多 50 张图片，按图片内容和视觉参数去重。
- 导入、导出 `.cdskin` 主题包，并保留分类、标签和视觉参数。
- 调整焦点、安全区、任务页模式、外观和强调色，并预览实际裁切效果。
- 暂停或继续皮肤显示。
- “重置皮肤”恢复内置目录第一套主题并清除暂停状态，不停止注入器。
- “紧急恢复原始外观”独立调用恢复脚本，在管理脚本异常时仍可使用。
- 单实例运行，并通过跨进程写锁避免并发修改主题状态。

## 环境要求

- Windows 10 或 Windows 11。
- 微软商店版 Codex。
- Node.js 22 或更高版本。
- 构建时需要 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 `windows` 目录作为底层脚本来源。
- GitHub Actions 固定使用 Codex Dream Skin 提交 `3af1d6d62f3a0388cc640d2f497ac3100998938e`；本地构建应使用同一提交以复现 CI 产物。
- 使用 Windows 自带的 .NET Framework 编译器，不需要安装 .NET SDK。

## 构建与运行

先准备两个项目目录，例如：

```text
github\
├── Codex-Dream-Skin\
└── CodexDreamSkinManager\
```

在本项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 `
  -SkillRoot "..\Codex-Dream-Skin\windows"
```

构建脚本会：

1. 编译并执行 45 项 C# 测试。
2. 复制外部项目的完整 Windows 脚本。
3. 覆盖本项目维护的 `manager-actions.ps1`、`presets` 和可再分发默认图片。
4. 附带本项目许可证，以及外部项目的软件许可证和 NOTICE。
5. 对组合后的目录执行 13 组 PowerShell 隔离集成验证。
6. 生成可直接运行的发布目录。

最终产物：

```text
build\CodexDreamSkinManager\
├── CodexDreamSkinManager.exe
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── THIRD_PARTY\
└── windows\
    ├── scripts\
    └── presets\
```

运行 `build\CodexDreamSkinManager\CodexDreamSkinManager.exe`。不要只复制 EXE；旁边的 `windows` 目录是运行时依赖。

仅执行测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 `
  -TestsOnly `
  -SkillRoot "..\Codex-Dream-Skin\windows"
```

## 操作语义

| 操作 | 结果 |
|---|---|
| 保存主题 | 写入主题库，不切换活动主题，不改变暂停状态 |
| 保存并应用 | 保存主题、切换活动主题并重启 Codex |
| 重置皮肤 | 恢复第一套内置主题并清除暂停，不停止注入器 |
| 紧急恢复原始外观 | 退出换肤并调用独立恢复流程 |

## 项目结构

```text
src/                 WPF 应用、服务层和数据模型
tests/               C# 单元/界面结构测试与 PowerShell 集成测试
windows/scripts/     本项目维护的管理动作脚本
windows/presets/     内置主题目录与图片
assets/              应用图标
tools/               项目维护工具
build.ps1            统一测试、组装与构建入口
```

架构边界保持简单：WPF 只负责交互和状态展示，`DreamSkinService` 负责管理动作协议，PowerShell 脚本负责 Windows 状态和主题文件写入。管理器不会直接修改 Codex 官方安装文件。

## 安全边界

- 不请求管理员权限。
- 不修改 `WindowsApps`、`app.asar` 或 Codex 官方二进制文件。
- 不读取、展示或记录 API Key、登录信息和对话内容。
- 图片和主题包经过格式、体积、像素、路径、重解析点和元数据校验。
- 启用与紧急恢复前由 WPF 窗口请求确认。
- 构建清理只允许发生在项目 `build` 目录内，并拒绝 junction/symlink。

安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露漏洞细节。

## 已知限制

- WebP 可以保存和应用；WPF 能否直接预览取决于系统图像编解码器。
- EXE 未进行商业代码签名，Windows 可能显示“未知发布者”。
- 外部 Codex Dream Skin 项目的完整测试仍有一个既有失败：桌面配置使用多行数组时没有按其测试预期拒绝；本项目的管理器测试不受影响。

## 参与贡献

提交修改前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。Pull Request 应保持范围明确，并通过 `build.ps1` 的完整测试和构建。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。你可以使用、复制、修改、合并、发布和再分发本项目代码，但必须保留原版权声明和许可证文本。

构建产物会同时携带本项目 LICENSE。来自 Codex Dream Skin 的软件文件按其独立 MIT License 提供，对应许可证和 NOTICE 位于发布目录的 `THIRD_PARTY` 中。外部项目中未明确授权再分发的 `dream-reference.jpg` 不会进入发布包，而是由本项目维护的中性图片替换。官方 CI 产物固定使用上述依赖提交；本地构建的实际依赖版本由传入的 `-SkillRoot` 决定。详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
