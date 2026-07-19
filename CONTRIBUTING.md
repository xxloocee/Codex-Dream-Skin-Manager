# 参与贡献

感谢你愿意改进 Codex Dream Skin Manager。这个项目优先接受范围明确、能够验证的修改。

## 开发环境

- Windows 10/11。
- Node.js 22+。
- 本项目与 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的本地副本。
- 不需要 .NET SDK；构建使用 Windows 自带的 .NET Framework 编译器。

## 开发流程

1. 创建独立分支。
2. 只修改解决当前问题所需的文件，避免顺手重构。
3. 为行为变化补充相应的 C# 或 PowerShell 回归测试。
4. 运行完整构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 `
  -SkillRoot "..\Codex-Dream-Skin\windows"
```

5. 如果修改 UI，请附上截图并说明已验证的窗口尺寸或交互路径。

## Pull Request 要求

- 说明问题、解决方式和关键取舍。
- 列出实际运行的验证，不要用代码阅读代替测试结果。
- 不提交 `build/`、`.catpaw/`、`.codegraph/`、IDE 状态或本机配置。
- 不包含密钥、账号信息、用户主题状态或 Codex 对话数据。
- 一个 Pull Request 聚焦一个问题；无关改动应拆分。

## 提交安全问题

漏洞和潜在敏感数据泄露请遵循 [SECURITY.md](SECURITY.md)，不要创建公开 Issue。
