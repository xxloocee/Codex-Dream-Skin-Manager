# 参与贡献

感谢你愿意改进 Codex Dream Skin Manager。这个项目优先接受范围明确、能够验证的修改。

## 开发环境

- Windows 10/11。
- Node.js 22+。
- 本项目仓库已包含同步后的 `windows/` 与 `macos/` 运行时；如需比较上游变更，再配置 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 远端即可。
- 不需要 .NET SDK；构建使用 Windows 自带的 .NET Framework 编译器。

## 开发流程

1. 创建独立分支。
2. 只修改解决当前问题所需的文件，避免顺手重构。
3. 为行为变化补充相应的 C# 或 PowerShell 回归测试。
4. 运行完整构建：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 `
  -SkillRoot ".\windows"
```

macOS 运行时测试需要在 macOS 上执行；若机器未安装官方 ChatGPT，可跳过需签名客户端的集成段：

```bash
cd macos
NODE="$(command -v node)" CODEX_DREAM_SKIN_SKIP_SIGNED_RUNTIME_TESTS=1 CODEX_DREAM_SKIN_SKIP_DOCTOR=1 npm test
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
